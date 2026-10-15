import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Guide,Scorer,defaults,patchConfig} from '../public/core.mjs';
import {TimingCoach,FitHelper} from '../public/practice.mjs';
import {AlignmentFeedback} from '../public/feedback.mjs';
import {FlowStreak} from '../public/streak.mjs';

const guide=()=>new Guide({...defaults,mode:'antispin',staffCount:1,scale:.3,tempoEnabled:true},640,480);
const pose=(g,phase,r=1)=>({a:g.point(r*Math.cos(phase),0),b:g.point(0,r*Math.sin(phase)),confidence:1});
const close=(a,b)=>{if(typeof b==='number')assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>close(a[i],v));}else if(b&&typeof b==='object')for(const k in b)close(['occluded','blurred'].includes(k)?!!a[k]:a[k],b[k]);else assert.equal(a,b);};

test('antispin assigns different axes to the two ends and never penalizes the shaft angle',()=>{
 const g=guide(),s=pose(g,.8),scorer=new Scorer();
 assert.equal(g.lines.length,2);assert.deepEqual(g.cues([s,null]).map(c=>c.axis),['horizontal','vertical']);
 assert.ok(scorer.score(1000,[s,null],g).deviation<1e-8);assert.equal(scorer.score(1033,[s,null],g).angle,null);
 const flat={a:g.point(-.5,0),b:g.point(.5,0),confidence:1};close(Math.max(...g.cues([flat,null]).map(c=>c.error)),25);
 const off={a:g.point(.6,.1),b:g.point(-.2,.8),confidence:1};close(g.cues([off,null]).map(c=>c.error),[5,10]);
 close(g.cues([{...off,a:off.b,b:off.a},null]).map(c=>c.error),[10,5]);
 assert.ok(g.cues([{a:g.point(1.3,0),b:g.point(0,.5),confidence:1},null]).some(c=>!c.onTarget));
 for(const bad of [null,{...s,blurred:true},{...s,occluded:true},{...s,confidence:.4}]){assert.equal(g.cues([bad,null]).length,0);assert.equal(scorer.score(1100,[bad,null],g).deviation,null);}
 const config=patchConfig(defaults,{mode:'antispin'});assert.equal(config.staffCount,1);assert.equal(patchConfig(config,{staffCount:2}).staffCount,1);
});

test('antispin alternates four timed outer targets, separates position and rejects gaps',()=>{
 const g=guide();
 for(const direction of [-1,1])for(const delay of [-110,0,110]){
  const coach=new TimingCoach();coach.reset(0);const events=new Map();
  for(let t=0;t<=4100;t+=20){const s=pose(g,direction*(t-delay)*Math.PI/1000,.75),b=coach.update(t,[t%40? s:{...s,a:s.b,b:s.a},null],g);assert.equal(b.targets[0].length,4);if(b.hits[0])events.set(b.hits[0].time,b.hits[0]);}
  assert.ok(events.size>=7);assert.deepEqual([...new Set([...events.values()].map(h=>h.point))].sort(),[1,2,3,4]);
  for(const hit of events.values()){assert.ok(Math.abs(hit.offsetMs-delay)<1);assert.ok(Math.abs(hit.error-12.5)<.1);}
  assert.equal(coach.update(4120,[null,null],g).hits[0],null);assert.equal(coach.update(4140,[pose(g,.8),null],g).hits[0],null);
 }
 const coach=new TimingCoach();for(let t=0;t<1000;t+=33)assert.equal(coach.update(t,[pose(g,.5),null],g).hits[0],null);
});

test('antispin size fit uses full staff length; feedback averages axes and streak needs both to grow',()=>{
 const g=guide(),fit=new FitHelper();fit.begin();let result;
 for(let i=0;i<=20;i++)result=fit.update(1000+i*100,[pose(g,i*2*Math.PI/20),null],g,1,1,1)||result;
 close(result,{scale:.3,cx:.5,cy:.5});
 fit.begin(false,true);for(let i=0;i<=20;i++)result=fit.update(4000+i*100,[pose(g,.5),null],g,1,1,1)||result;
 close(result,{scale:.3});assert.ok(!('cx' in result));
 const coach=new AlignmentFeedback(),streak=new FlowStreak(),off={a:g.point(.6,.1),b:g.point(-.2,.8),confidence:1};
 const frame=(t,s)=>({time:t,width:640,height:480,config:g.config,staffs:[s,null],feedback:g.cues([s,null])});
 for(let i=0;i<4;i++)coach.update(frame(1000+i*20,off));
 const summary=coach.update(frame(1100,pose(g,.5))).summary;assert.match(summary.detail,/Horizontal tip: 4.0%/);assert.match(summary.detail,/Vertical tip: 8.0%/);
 assert.equal(coach.update(frame(7000,null)).summary,null);
 for(let t=0;t<=2500;t+=20)streak.update(frame(t,pose(g,t/1000)));
 close(streak.update(frame(2520,pose(g,2.52))).progress,2.52/30);
 const held=streak.update(frame(2540,off));assert.equal(held.state,'recovering');assert.equal(held.seconds,2.52);
 assert.equal(streak.update(frame(2760,off)).seconds,0);
});

test('all antispin geometry, correction targets, scores and beat events match Android',()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/native-antispin.json',import.meta.url)));
 for(const c of cases){const g=new Guide(c.config,640,480),coach=new TimingCoach(),scorer=new Scorer();coach.reset(0);close(g.json(),c.guide);
  for(const f of c.frames){close(g.cues(f.staffs),f.feedback);close(scorer.score(f.time,f.staffs,g),f.metrics);close(coach.update(f.time,f.staffs,g),f.beat);}
 }
});
