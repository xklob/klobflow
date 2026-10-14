import test from 'node:test';
import assert from 'node:assert/strict';
import {AlignmentFeedback} from '../public/feedback.mjs';
import {defaults} from '../public/core.mjs';
const staff={a:[.2,.2],b:[.7,.7],confidence:1};
const frame=(time,error=1,blurred=false)=>({time,config:{...defaults,staffCount:1},staffs:[{...staff,blurred},null],feedback:[0,1].map(()=>({error,onTarget:error<=4,tip:[.2,.2],target:[.2,.2]}))});
test('coaching does not flash between alignment and blur during intermittent detection',()=>{
 const coach=new AlignmentFeedback();const titles=new Set(),details=new Set();for(let i=0;i<200;i++){const v=coach.update(frame(i*33,1,i%5===0));titles.add(v.title);details.add(v.detail);}
 assert.deepEqual([...titles],['PRECISION PAUSED']);assert.equal(details.size,1);
 for(let i=200;i<300;i++)coach.update(frame(i*33));assert.equal(coach.update(frame(10000)).state,'aligned');
 assert.equal(coach.update(frame(10033,1,true)).state,'paused');
});
test('tip labels use tolerance hysteresis and never call an off-target tip aligned',()=>{
 const coach=new AlignmentFeedback();for(let i=0;i<100;i++)coach.update(frame(i*33));
 assert.ok(coach.update(frame(3400,3.9)).tips.every(t=>t.onTarget));
 assert.ok(coach.update(frame(3433,4.1)).tips.every(t=>!t.onTarget));
 for(let i=0;i<40;i++)assert.ok(coach.update(frame(3500+i*33,i%2?3.9:4.1)).tips.every(t=>!t.onTarget));
});
test('all-green tips never receive instructions for absent correction arrows during settling',()=>{
 const coach=new AlignmentFeedback();coach.update(frame(0));const confirming=coach.update(frame(650));
 assert.doesNotMatch(confirming.title,/OFF GUIDE|MOVE ORANGE/i);
 const settling=coach.update(frame(1000));assert.ok(settling.tips.every(t=>t.onTarget));
 assert.doesNotMatch(settling.title,/OFF GUIDE|MOVE ORANGE/i);assert.doesNotMatch(settling.detail,/amber|orange|white TARGET|along.*arrow/i);
 const hidden=new AlignmentFeedback();for(const time of [0,650,1000])hidden.update({...frame(time,12),config:{...defaults,staffCount:1,showFeedback:false}});
 const v=hidden.update({...frame(1200,12),config:{...defaults,staffCount:1,showFeedback:false}});assert.doesNotMatch(v.detail,/along.*arrow|into.*TARGET ring/i);
});
