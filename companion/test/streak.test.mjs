import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Guide,defaults,Scorer,patchConfig} from '../public/core.mjs';
import {FlowStreak} from '../public/streak.mjs';
const config={...defaults,staffCount:1,mode:'circles',scale:.23};
const guide=(c=config)=>new Guide(c,640,480);
const staff=(g=guide())=>({a:g.point(-1,0),b:g.point(1,0),confidence:1});
const update=(coach,time,staffs=[staff(),null],g=guide())=>coach.update({time,config:g.config,staffs,feedback:g.cues(staffs)});
function build(coach){for(let t=0;t<=1000;t+=20)update(coach,t);}
test('native and browser streak thresholds, uncertainty and decay agree',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-streak.json',import.meta.url))),coach=new FlowStreak();
 for(const step of fixture.steps){const result=update(coach,step.time,step.staffs,guide(step.config));for(const key of Object.keys(step.output))typeof result[key]==='number'?assert.ok(Math.abs(result[key]-step.output[key])<1e-8,`${key} at ${step.time}`):assert.equal(result[key],step.output[key]);}
});
test('30 and 60 fps award identical elapsed alignment and levels',()=>{
 for(const fps of [30,60]){const coach=new FlowStreak();let result;for(let i=0;i<=fps*10;i++){result=update(coach,Math.round(i*1000/fps));if(i===fps*2)assert.equal(result.level,2);if(i===fps*5)assert.equal(result.level,3);}assert.equal(result.seconds,10);assert.equal(result.level,4);assert.equal(result.progress,1);assert.ok(result.energy>.95);}
});
test('brief uncertainty pauses without credit and sustained uncertainty resets',()=>{
 const coach=new FlowStreak();build(coach);const s=staff();
 assert.equal(update(coach,1020,[{...s,blurred:true},null]).state,'held');assert.equal(update(coach,1200).seconds,1);assert.equal(update(coach,1220).seconds,1.02);
 update(coach,1240,[{...s,occluded:true},null]);for(let t=1400;t<=2800;t+=200)update(coach,t,[null,null]);assert.equal(update(coach,2820).seconds,0);assert.equal(update(coach,2840).bestSeconds,1.02);
});
test('a normal behind-the-back pass holds earned glow but awards no unseen time or precision',()=>{
 const coach=new FlowStreak();build(coach);const g=guide(),hidden={...staff(),occluded:true,confidence:.3},before=update(coach,1020,[hidden,null]);
 for(let t=1040;t<=2400;t+=20){const v=update(coach,t,[hidden,null]);assert.equal(v.state,'held');assert.equal(v.seconds,1);assert.equal(v.energy,before.energy);assert.equal(new Scorer().score(t,[hidden,null],g).deviation,null);}
 assert.equal(update(coach,2420).seconds,1);assert.equal(update(coach,2440).seconds,1.02);
 update(coach,2460,[hidden,null]);const off={...staff(),a:g.point(-1.3,0)};assert.equal(update(coach,2480,[off,null]).seconds,1.02);assert.equal(update(coach,2480,[off,null]).state,'recovering');assert.equal(update(coach,2680,[off,null]).state,'ready');
});
test('one off-guide or missing tip cannot hide in an average or earn a streak',()=>{
 const g=guide({...defaults,staffCount:2}),a={a:g.point(-1,-1),b:g.point(-1,1),confidence:1},b={a:g.point(1,-1),b:g.point(1,1),confidence:1},off={...b,b:g.point(1.12,1)},coach=new FlowStreak();
 update(coach,0,[a,b],g);assert.equal(update(coach,100,[a,b],g).seconds,.1);assert.ok(new Scorer().score(200,[a,off],g).deviation<g.config.tolerance);assert.equal(update(coach,200,[a,off],g).state,'recovering');assert.equal(update(coach,220,[a,null],g).seconds,.1);assert.equal(update(coach,240,[a,{...b,confidence:.54}],g).seconds,.1);assert.equal(update(coach,420,[a,null],g).state,'paused');
});
test('free flow, disabled effects and target adjustments cannot carry credit',()=>{
 const coach=new FlowStreak();build(coach);assert.equal(update(coach,1020,[staff(),null],guide({...config,cx:.52})).seconds,0);assert.equal(update(coach,1040,[staff(),null],guide({...config,mode:'free'})).state,'free');const off=update(coach,1060,[staff(),null],guide({...config,streakEffects:false}));assert.equal(off.state,'off');assert.equal(off.energy,0);
 const cube=guide({...config,mode:'cube'}),s={a:cube.vertices[0],b:cube.vertices[2],confidence:1};update(coach,1080,[s,null],cube);assert.equal(update(coach,1100,[s,null],cube).state,'building');
});
test('suspension cannot add time and backward replay resets history',()=>{
 const coach=new FlowStreak();build(coach);const resumed=update(coach,2000);assert.equal(resumed.seconds,0);assert.equal(resumed.bestSeconds,1);const seek=update(coach,0);assert.equal(seek.seconds,0);assert.equal(seek.bestSeconds,0);
});
test('changing the LED filter cannot preserve credit from a previous false match',()=>{
 const coach=new FlowStreak();build(coach);const result=update(coach,1020,[staff(),null],guide({...config,staffColors:['pink']}));
 assert.equal(result.seconds,0);assert.equal(result.bestSeconds,0);
});

test('a brief off-target blip freezes earned time while cues and raw error stay off target',()=>{
 const coach=new FlowStreak(),g=guide();build(coach);const off={...staff(),a:g.point(-1.3,0)},before=update(coach,1020,[off,null]);
 assert.equal(before.state,'recovering');assert.equal(before.seconds,1);assert.ok(new Scorer().score(1020,[off,null],g).deviation>config.tolerance);assert.equal(g.cues([off,null])[0].onTarget,false);
 const held=update(coach,1140,[off,null]);assert.equal(held.seconds,1);assert.equal(held.energy,before.energy);
 assert.equal(update(coach,1180).seconds,1);assert.equal(update(coach,1200).seconds,1.02);
});
test('zero forgiveness is strict and maximum tracking grace holds only already earned time',()=>{
 for(const kind of ['tracking','alignment']){
  const g=guide({...config,trackingGraceMs:0,alignmentGraceMs:0}),coach=new FlowStreak();for(let t=0;t<=1000;t+=20)update(coach,t,[staff(g),null],g);
  const bad=kind==='tracking'?null:{...staff(g),a:g.point(-1.3,0)};
  assert.equal(update(coach,1020,[bad,null],g).seconds,0);
 }
 const g=guide({...config,trackingGraceMs:3000}),coach=new FlowStreak();for(let t=0;t<=1000;t+=20)update(coach,t,[staff(g),null],g);
 for(let t=1020;t<=4020;t+=20){const f=update(coach,t,[null,null],g);assert.equal(f.state,'held');assert.equal(f.seconds,1);}
 assert.equal(update(coach,4040,[staff(g),null],g).seconds,0);
});
test('alternating interruptions cannot extend the grace deadline or accumulate unearned time',()=>{
 const coach=new FlowStreak(),g=guide(),off={...staff(),a:g.point(-1.3,0)};build(coach);
 assert.equal(update(coach,1020,[off,null]).seconds,1);
 for(let t=1040;t<=1220;t+=20)assert.equal(update(coach,t,t%40?[off,null]:[null,null]).seconds,1);
 assert.equal(update(coach,1240,[null,null]).seconds,0);assert.equal(update(coach,1260).seconds,0);
 assert.equal(update(coach,1280).seconds,.02);
});
test('forgiveness settings validate, persist and default when restoring older settings',()=>{
 const c=patchConfig(defaults,{trackingGraceMs:3000,alignmentGraceMs:1000});assert.deepEqual(patchConfig(defaults,JSON.parse(JSON.stringify(c)),{restore:true}),c);
 const legacy={...defaults};delete legacy.trackingGraceMs;delete legacy.alignmentGraceMs;
 const restored=patchConfig(legacy,{});assert.equal(restored.trackingGraceMs,1500);assert.equal(restored.alignmentGraceMs,200);
 for(const [key,max]of [['trackingGraceMs',3000],['alignmentGraceMs',1000]])for(const value of [-1,max+1,.5,NaN])assert.throws(()=>patchConfig(defaults,{[key]:value}));
});
