import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Guide,Scorer,defaults,patchConfig,distance} from '../public/core.mjs';
import {TimingCoach,FitHelper} from '../public/practice.mjs';
import {MovingPacer} from '../public/pacer.mjs';
import {AlignmentFeedback} from '../public/feedback.mjs';
import {FlowStreak} from '../public/streak.mjs';
import {demoFrame,resetDemoPacer} from '../public/demo.mjs';
const config=(patch={})=>patchConfig(defaults,{mode:'antispin',staffCount:2,scale:.2,circleSeparation:1.4,tempoEnabled:true,...patch});
const guide=(patch={})=>new Guide(config(patch),640,480);
const pose=(g,i,phase,r=1)=>({a:g.project(g.antispinPoint(r*Math.cos(phase),0,i)),b:g.project(g.antispinPoint(0,r*Math.sin(phase),i)),confidence:1});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function compare(a,b){if(typeof b==='number')near(a,b);else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>compare(a[i],v));}else if(b&&typeof b==='object')for(const k in b)compare(['occluded','blurred'].includes(k)?!!a[k]:a[k],b[k]);else assert.equal(a,b);}

test('two crosses measure all four tips, and the summary includes staff B',()=>{
 const g=guide(),a=pose(g,0,.8),b=pose(g,1,-.8),scorer=new Scorer();
 assert.equal(g.lines.length,4);near(scorer.score(0,[a,b],g).deviation,0);
 assert.ok(scorer.score(20,[b,a],g).deviation>10);
 const off={a:g.antispinPoint(.6,.2,1),b:g.antispinPoint(.1,.8,1),confidence:1};
 compare(g.cues([a,off]).map(c=>c.error),[0,0,10,5]);
 const coach=new AlignmentFeedback(),frame=(time,staffs)=>({time,width:640,height:480,config:g.config,staffs,feedback:g.cues(staffs)});
 let summary;for(let i=0;i<3;i++)summary=coach.update(frame(i*20,[a,off])).summary;
 assert.match(summary.detail,/Horizontal tips \(A\+B\): 5.0%/);assert.match(summary.detail,/Vertical tips \(A\+B\): 2.5%/);
 const streak=new FlowStreak();for(let t=0;t<=2000;t+=20)streak.update(frame(t,[a,b]));
 assert.equal(streak.update(frame(2020,[a,off])).state,'recovering');
 assert.equal(streak.update(frame(2240,[a,off])).seconds,0);
 for(const bad of [null,{...b,occluded:true},{...b,blurred:true},{...b,confidence:.4}]){assert.equal(g.cues([a,bad]).length,0);assert.equal(scorer.score(2300,[a,bad],g).deviation,null);}
 const overlap=guide({circleSeparation:0});compare(overlap.lines.slice(0,2),overlap.lines.slice(2));
});

test('two-staff fit recovers the centers, separation and full staff length',()=>{
 const actual=guide({cx:.55,cy:.45,rotation:27}),initial=guide({scale:.32,circleSeparation:1,rotation:27}),fit=new FitHelper();fit.begin();let patch;
 for(let i=0;i<=20;i++)patch=fit.update(i*100,[pose(actual,0,i*Math.PI/10),pose(actual,1,-i*Math.PI/10+Math.PI/2)],initial,1,1,1)||patch;
 compare(patch,{scale:.2,cx:.55,cy:.45,circleSeparation:1.4});
 fit.begin(false,true);patch=null;for(let i=0;i<=20;i++)patch=fit.update(3000+i*100,[pose(actual,0,.8),pose(actual,1,.3)],initial,1,1,1)||patch;
 compare(patch,{scale:.2});assert.ok(!('circleSeparation' in patch));assert.ok(!('cx' in patch));
});

test('two-staff targets retain rigid length and every endpoint must follow its own pair',()=>{
 for(const pattern of ['same','opposite'])for(const offset of [0,90,180])for(const direction of ['cw','ccw']){
  const g=guide({rotation:23,pacerEnabled:true,pacerCountdown:0,pacerRpm:30,pacerPattern:pattern,pacerOffset:offset,pacerDirection:direction}),p=new MovingPacer();p.command('start',0,g);
  for(let t=0;t<=2000;t+=100){const theta=t*Math.PI/1000*(direction==='cw'?1:-1),f=p.update(t,[pose(g,0,theta),pose(g,1,theta*(pattern==='same'?1:-1)+offset*Math.PI/180)],g);assert.equal(f.onTarget,true);assert.equal(f.feedback.length,4);for(const pair of f.targets)near(distance(...pair),g.radius);}
  const f=p.update(2020,[pose(g,0,0),null],g);assert.equal(f.valid,false);assert.equal(f.targets.length,2);
  const single=new Guide(patchConfig(g.config,{staffCount:1}),640,480);p.reconfigure(g.config,single.config);const reset=p.update(2040,[pose(single,0,0),null],single);assert.equal(reset.state,'ready');assert.equal(reset.targets.length,1);
 }
});

test('two-staff antispin geometry, timing, scores and moving guides agree with Android',()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/native-two-staff-antispin.json',import.meta.url)));
 for(const c of cases){const g=new Guide(c.config,640,480),p=new MovingPacer(),beat=new TimingCoach(),scorer=new Scorer();p.command('start',0,g);beat.reset(0);compare(g.json(),c.guide);
  for(const f of c.frames){compare(g.cues(f.staffs),f.feedback);compare(scorer.score(f.time,f.staffs,g),f.metrics);compare(beat.update(f.time,f.staffs,g),f.beat);compare(p.update(f.time,f.staffs,g),f.pacer);}
 }
});

test('the generated demo respects two-staff antispin without collapsing either cross',()=>{
 resetDemoPacer();const c=config(),f=demoFrame(c,1000);assert.equal(f.config.staffCount,2);assert.equal(f.guide.lines.length,4);assert.equal(f.feedback.length,4);near(f.metrics.deviation,0);assert.notDeepEqual(f.staffs[0],f.staffs[1]);
});
