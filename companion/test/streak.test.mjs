import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Guide,defaults,Scorer} from '../public/core.mjs';
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
 assert.equal(update(coach,1020,[{...s,blurred:true},null]).state,'paused');assert.equal(update(coach,1200).seconds,1);assert.equal(update(coach,1220).seconds,1.02);
 update(coach,1240,[{...s,occluded:true},null]);update(coach,1400,[null,null]);update(coach,1580,[null,null]);assert.equal(update(coach,1600).seconds,0);assert.equal(update(coach,1620).bestSeconds,1.02);
});
test('one off-guide or missing tip cannot hide in an average or earn a streak',()=>{
 const g=guide({...defaults,staffCount:2}),a={a:g.point(-1,-1),b:g.point(-1,1),confidence:1},b={a:g.point(1,-1),b:g.point(1,1),confidence:1},off={...b,b:g.point(1.12,1)},coach=new FlowStreak();
 update(coach,0,[a,b],g);assert.equal(update(coach,100,[a,b],g).seconds,.1);assert.ok(new Scorer().score(200,[a,off],g).deviation<g.config.tolerance);assert.equal(update(coach,200,[a,off],g).state,'ready');assert.equal(update(coach,220,[a,null],g).state,'paused');assert.equal(update(coach,240,[a,{...b,confidence:.54}],g).state,'paused');
});
test('free flow, disabled effects and target adjustments cannot carry credit',()=>{
 const coach=new FlowStreak();build(coach);assert.equal(update(coach,1020,[staff(),null],guide({...config,cx:.52})).seconds,0);assert.equal(update(coach,1040,[staff(),null],guide({...config,mode:'free'})).state,'free');const off=update(coach,1060,[staff(),null],guide({...config,streakEffects:false}));assert.equal(off.state,'off');assert.equal(off.energy,0);
 const cube=guide({...config,mode:'cube'}),s={a:cube.vertices[0],b:cube.vertices[2],confidence:1};update(coach,1080,[s,null],cube);assert.equal(update(coach,1100,[s,null],cube).state,'building');
});
test('suspension cannot add time and backward replay resets history',()=>{
 const coach=new FlowStreak();build(coach);const resumed=update(coach,2000);assert.equal(resumed.seconds,0);assert.equal(resumed.bestSeconds,1);const seek=update(coach,0);assert.equal(seek.seconds,0);assert.equal(seek.bestSeconds,0);
});
