import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StaffDetector,StaffTracker,Scorer,Guide,defaults,angle,angleDifference,length,center,distance} from '../public/core.mjs';
import {spinFrame} from './motion-fixture.mjs';

test('spinning exposure sweeps stay associated across white, rainbow, grips, and two staves',()=>{
 for(const options of [{sweep:.7,rainbow:true,frameStep:67,rotationStep:1.0},{sweep:1.05,rainbow:true},{sweep:.15},{sweep:.3},{sweep:.7},{sweep:.5,white:true},{sweep:.5,gap:.08},{sweep:.5,rainbow:true,gap:.08},{sweep:.4,rainbow:true,gap:.08,centers:[[.36,.5],[.99,.5]],directions:[1,-1],length:.55}]){
  const detector=new StaffDetector(),tracker=new StaffTracker(),count=options.centers?.length||1,config={...defaults,staffCount:count};
  for(let i=0;i<24;i++){
   const time=1000+i*(options.frameStep||33),theta=i<4?.8:.8+(i-4)*(options.rotationStep||.3);
   const frame={...options,angle:theta,sweep:i<4?0:options.sweep};
   const detected=detector.detect(spinFrame(frame),320,240,config,tracker.hints(time,count)),staffs=tracker.update(detected,time,count);
   if(i<4)continue;
   for(let n=0;n<count;n++){
    const s=staffs[n];assert.ok(s&&!s.occluded,`lost ${JSON.stringify(options)} frame ${i} staff ${n}`);
    assert.ok(angleDifference(angle(s),theta*(options.directions?.[n]||1))<.08,'wrong observed axis');
    assert.ok(Math.abs(length(s)-(options.length||.62))<.06,'lost the luminous endpoints');
    assert.ok(distance(center(s),options.centers?.[n]||[2/3,.5])<.04,'drifted off the staff');
   }
   const score=new Scorer().score(time,staffs,new Guide(config,320,240));
   if(options.sweep>=.3){assert.ok(staffs.slice(0,count).every(s=>s.blurred&&s.confidence<.55));assert.equal(score.deviation,null);}
   else if(i>6)assert.notEqual(score.deviation,null,'slight blur should still give an observed measurement');
  }
  assert.deepEqual(detector.detect(new Int32Array(320*240),320,240,config,tracker.hints(1800,count)),[]);
  assert.ok(tracker.update([],5000,count).every(s=>s===null),'expired light must not keep moving');
 }
});

test('broad blobs cannot become measured staves through motion recovery',()=>{
 const detector=new StaffDetector(),staff={a:[.35,.5],b:[.97,.5],confidence:1};
 for(const fill of [0xffffffff,0xff103010])assert.deepEqual(detector.detect(new Int32Array(320*240).fill(fill),320,240,defaults,[staff]),[]);
 const pixels=new Int32Array(320*240);for(let y=80;y<160;y++)for(let x=115;x<205;x++)pixels[y*320+x]=0xff44ff66;
 assert.deepEqual(detector.detect(pixels,320,240,defaults,[staff]),[]);
});

test('fast rotation uses observed angular motion without flipping the timed endpoint',()=>{
 const tracker=new StaffTracker();let previous=null;
 for(let i=0;i<25;i++){
  const theta=i<4?0:(i-3)*.72,s={a:[.66-.3*Math.cos(theta),.5-.3*Math.sin(theta)],b:[.66+.3*Math.cos(theta),.5+.3*Math.sin(theta)],confidence:1};
  const actual=tracker.update([s],1000+i*33,1)[0];assert.ok(actual&&!actual.occluded);assert.ok(distance(actual.a,s.a)<1e-9);previous=actual;
 }
 assert.ok(previous.confidence>=.55);
});

test('browser motion recovery agrees with the native spinning rainbow oracle',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-motion.json',import.meta.url))),detector=new StaffDetector(),tracker=new StaffTracker();
 for(const step of fixture){
  const actual=tracker.update(detector.detect(spinFrame(step.frame),320,240,defaults,tracker.hints(step.time,2)),step.time,2);
  actual.forEach((s,n)=>{const expected=step.staffs[n];if(!expected)return assert.equal(s,null);assert.ok(s);for(const key of ['a','b'])for(let k=0;k<2;k++)assert.ok(Math.abs(s[key][k]-expected[key][k])<1e-7);assert.ok(Math.abs(s.confidence-expected.confidence)<1e-7);assert.equal(!!s.blurred,expected.blurred);assert.equal(!!s.occluded,expected.occluded);});
 }
});
