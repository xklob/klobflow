import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Guide,defaults,Scorer,StaffTracker} from '../public/core.mjs';import {TimingCoach,FitHelper} from '../public/practice.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-practice.json',import.meta.url)));
function close(a,b){if(typeof b==='number')assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>close(a[i],v));}else if(b&&typeof b==='object')for(const k in b)close(a[k],b[k]);else assert.equal(a,b);}
test('beat crossings and fit decisions agree with native oracle',()=>{
 const g=new Guide(fixture.config,640,480),coach=new TimingCoach();coach.reset(0);
 for(const frame of fixture.timing)close(coach.update(frame.time,frame.staffs,g),frame.beat);
 const fit=new FitHelper();fit.begin(true);let result;
 for(let i=0;i<22;i++)result=fit.update(1000+i*100,[fixture.fitStaff,null],g,1,8,1)||result;
 close(result,fixture.fit);
});
test('single staff scores independently, has two cues and no two-prop symmetry',()=>{
 const g=new Guide({...defaults,staffCount:1},640,480),s={a:g.point(-1,-1),b:g.point(-1,1),confidence:1};
 assert.equal(new Scorer().score(1000,[s,null],g).deviation,0);assert.equal(new Scorer().score(1000,[s,null],g).symmetry,null);assert.equal(g.cues([s,null]).length,2);
 const tracker=new StaffTracker();for(let i=0;i<5;i++)assert.equal(tracker.update([s],1000+i*33,1)[1],null);
});
test('size fit waits through uncertainty and can be cancelled before applying',()=>{
 const g=new Guide({...defaults,staffCount:1},640,480),fit=new FitHelper();fit.begin();for(let i=0;i<100;i++)assert.equal(fit.update(1000+i*33,[null,null],g,1,8,1),null);assert.equal(fit.active,true);fit.cancel();assert.equal(fit.active,false);
});

test('fit retains a full cycle at 30, 60 and 120 fps, including a zero timestamp',()=>{
 const g=new Guide({...defaults,mode:'antispin',staffCount:1,scale:.3},640,480);
 for(const fps of [30,60,120]){
  const fit=new FitHelper();fit.begin();let result=null;
  for(let i=0;i<=fps*2;i++){
   const phase=Math.PI/4+i*Math.PI/fps,s={a:g.point(Math.cos(phase),0),b:g.point(0,Math.sin(phase)),confidence:1};
   result=fit.update(Math.round(i*1000/fps),[s,null],g,1,1,1)||result;
  }
  close(result,{cx:.5,cy:.5,scale:.3});
 }
});
test('fit restarts observed time after a stall or backward timestamp',()=>{
 const g=new Guide({...defaults,mode:'circles',staffCount:1},640,480),s={a:[.3,.4],b:[.7,.4],confidence:1};
 for(const restart of [500,5000]){
  const fit=new FitHelper();fit.begin();
  for(let i=0;i<12;i++)assert.equal(fit.update(1000+i*17,[s,null],g,1,1,1),null);
  assert.equal(fit.update(restart,[s,null],g,1,1,1),null);
  for(let i=1;i<20;i++)assert.equal(fit.update(restart+i*100,[s,null],g,1,1,1),null);
  assert.ok(fit.update(restart+2000,[s,null],g,1,1,1));
 }
});
test('cosmetic settings retain beat phase and hits; geometry drops crossings without desynchronizing',()=>{
 const c={...defaults,mode:'circles',staffCount:1,tempoEnabled:true},g=new Guide(c,640,480),coach=new TimingCoach();coach.reset(0);
 const spin=t=>{const a=(t-1500)*Math.PI/1000,d=[Math.cos(a)*g.radius,Math.sin(a)*g.radius];return {a:g.center.map((n,i)=>n+d[i]),b:g.center.map((n,i)=>n-d[i]),confidence:1};};
 let before;
 for(let t=1250;t<=1700;t+=20)before=coach.update(t,[spin(t),null],g);
 assert.ok(before.hits[0]);
 const display={...c,trails:false,showGuide:false,showFeedback:false,streakEffects:false,trackingGraceMs:3000,alignmentGraceMs:1000,tolerance:8,timing:'split-opp',ratio:'1:3',symmetry:false};coach.reconfigure(c,display);
 const after=coach.update(1710,[spin(1710),null],new Guide(display,640,480));close(after.phase,.42);assert.deepEqual(after.hits,before.hits);
 const geometry={...display,scale:.4};coach.reconfigure(display,geometry);
 const moved=coach.update(1750,[spin(1750),null],new Guide(geometry,640,480));close(moved.phase,.5);assert.equal(moved.hits[0],null);
 const clock={...geometry,bpm:90};coach.reconfigure(geometry,clock);assert.equal(coach.update(1760,[spin(1760),null],new Guide(clock,640,480)).phase,0);
});
