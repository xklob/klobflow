import test from 'node:test';
import assert from 'node:assert/strict';
import {Guide,defaults,patchConfig} from '../public/core.mjs';
import {MovingPacer} from '../public/pacer.mjs';
import {FlowStreak,streakText} from '../public/streak.mjs';
import {AlignmentFeedback} from '../public/feedback.mjs';
import {demoFrame,demoPacerCommand,resetDemoPacer} from '../public/demo.mjs';

const config=()=>patchConfig(defaults,{mode:'circles',staffCount:1,pacerEnabled:true,pacerCountdown:0,pacerRpm:20});
function staff(g,t,offset=0){const theta=t/3000*2*Math.PI+offset,c=g.circles[0],v=[Math.cos(theta)*g.radius,Math.sin(theta)*g.radius];return {a:[c[0]+v[0],c[1]+v[1]],b:[c[0]-v[0],c[1]-v[1]],confidence:1};}
const frame=(t,g,staffs,pacer)=>({time:t,width:640,height:480,config:g.config,staffs,pacer,feedback:pacer.enabled?pacer.feedback:g.cues(staffs)});

test('a staff on the circle earns no follow streak until it matches the moving dots',()=>{
 const g=new Guide(config(),640,480),pacer=new MovingPacer(),streak=new FlowStreak();pacer.command('start',0,g);let f;
 for(let t=0;t<=3000;t+=20){const staffs=[staff(g,t,Math.PI/2),null];assert.ok(g.cues(staffs).every(c=>c.onTarget));f=streak.update(frame(t,g,staffs,pacer.update(t,staffs,g)));}
 assert.equal(f.seconds,0);assert.equal(f.energy,0);
 pacer.command('restart',3020,g);streak.reset();
 for(let t=3020;t<=13020;t+=20){const staffs=[staff(g,t-3020),null];f=streak.update(frame(t,g,staffs,pacer.update(t,staffs,g)));}
 assert.ok(Math.abs(f.seconds-10)<1e-8);assert.ok(Math.abs(f.energy-1/3)<1e-8);
 const obscured=[{...staff(g,10020),occluded:true},null],held=streak.update(frame(13040,g,obscured,pacer.update(13040,obscured,g)));
 assert.equal(held.state,'held');assert.equal(held.seconds,10);
 pacer.command('pause',13040,g);const paused=streak.update(frame(13060,g,obscured,pacer.update(13060,obscured,g)));
 assert.equal(paused.state,'practice');assert.equal(paused.seconds,0);assert.equal(paused.energy,0);assert.doesNotMatch(streakText(paused),/hidden|waiting for.*tips/i);
});

test('stopped dots never produce hidden-tip or outside-plane instructions, and restart clears rolling feedback',()=>{
 const g=new Guide(config(),640,480),pacer=new MovingPacer(),coach=new AlignmentFeedback();
 for(const state of ['ready','countdown','paused']){
  const v=coach.update(frame(0,g,[null,null],{enabled:true,state,feedback:[],elapsedSeconds:0}));
  assert.equal(v.state,'practice');assert.equal(v.tracking.confirmed,false);assert.equal(v.summary,null);assert.equal(v.tips.length,0);
  assert.doesNotMatch(v.tracking.title,/HIDDEN|UNCLEAR|OUTSIDE|NOT FOUND|NO STAFF/);
 }
 pacer.command('start',0,g);let v;
 for(let t=0;t<=2000;t+=20){const staffs=[staff(g,t),null];v=coach.update(frame(t,g,staffs,pacer.update(t,staffs,g)));}
 assert.equal(v.summary.title,'100% WITH DOTS');assert.equal(v.state,'aligned');
 pacer.command('restart',2020,g);const staffs=[staff(g,0,Math.PI/2),null];v=coach.update(frame(2020,g,staffs,pacer.update(2020,staffs,g)));
 assert.equal(v.summary,null);assert.equal(v.state,'adjust');assert.match(v.detail,/blue dots/);
});

test('demo exercises require manual start and resets never resume an earlier exercise',()=>{
 resetDemoPacer();const c=config();let f=demoFrame(c,1000);assert.equal(f.pacer.state,'ready');
 demoPacerCommand('start',1000,c);f=demoFrame(c,1100);assert.equal(f.pacer.state,'running');assert.ok(f.pacer.phase>0);
 resetDemoPacer();f=demoFrame(c,1200);assert.equal(f.pacer.state,'ready');assert.equal(f.streak.seconds,0);
 assert.throws(()=>demoPacerCommand('start',1200,{...c,mode:'grid'}));
});
