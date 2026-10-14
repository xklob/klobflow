import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StaffDetector,StaffTracker,Scorer,Guide,defaults,center,length,angle,angleDifference,distance} from '../public/core.mjs';

// A bright shaft with a much wider colored halo, two visible caps and a dark grip.
// Synthetic pixels only. A halo is not a rotating exposure fan.
function bodyFrame(theta,red=false,cx=2/3,bulbs=false){
 const w=320,h=240,pixels=new Int32Array(w*h).fill(0xff101510);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const dx=x/h-cx,dy=y/h-.5,a=dx*Math.cos(theta)+dy*Math.sin(theta),b=-dx*Math.sin(theta)+dy*Math.cos(theta);
  if(Math.abs(a)<.04||Math.abs(a)>.34||Math.abs(b)>.055)continue;
  if(bulbs&&Math.abs(a)<.28)continue;
  pixels[y*w+x]=red?0xffaf0000:0xffdc2882;
  if(Math.abs(a)<=.31&&Math.abs(b)<=.010)pixels[y*w+x]=red?0xffff0000:0xfffff0f0;
 }
 return pixels;
}
test('visible shaft caps recover precision through a broad colored halo and dark grip',()=>{
 for(const red of [false,true]){
  const detector=new StaffDetector(),tracker=new StaffTracker(),config={...defaults,staffCount:1};
  for(let i=0;i<12;i++){
   const theta=.2+i*.12,time=1000+i*17,staff=tracker.update(detector.detect(bodyFrame(theta,red),320,240,config,tracker.hints(time,1)),time,1)[0];
   assert.ok(staff&&!staff.occluded&&!staff.blurred,`lost visible body ${red}/${i}`);
   assert.ok(angleDifference(angle(staff),theta)<.025);assert.ok(distance(center(staff),[2/3,.5])<.01);
   assert.ok(Math.abs(length(staff)-.62)<.012,'use the observed bright caps, not the halo boundary');
   if(i>=2)assert.notEqual(new Scorer().score(time,[staff],new Guide(config,320,240)).deviation,null);
  }
 }
});
test('a clipped glow or isolated bulbs cannot supply recovered precise endpoints',()=>{
 const detector=new StaffDetector(),config={...defaults,staffCount:1};
 for(const pixels of [bodyFrame(0,false,.13),bodyFrame(0,false,2/3,true)]){
  assert.ok(detector.detect(pixels,320,240,config).every(s=>s.blurred||s.confidence<.55));
 }
});
test('detached bright reflections cannot extend a recovered shaft cap',()=>{
 const pixels=bodyFrame(0);for(let y=118;y<=121;y++)for(let x=70;x<=73;x++)pixels[y*320+x]=0xffffffff;
 const staff=new StaffDetector().detect(pixels,320,240,{...defaults,staffCount:1})[0];
 assert.ok(staff&&!staff.blurred);assert.ok(Math.abs(Math.min(staff.a[0],staff.b[0])-(2/3-.31))<.012);
 assert.ok(Math.abs(length(staff)-.62)<.012);
});
test('browser glow endpoint recovery matches Android on the same synthetic images',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-glow.json',import.meta.url)));
 for(const row of fixture){
  const actual=new StaffDetector().detect(bodyFrame(row.angle,row.red),320,240,{...defaults,staffCount:1});
  assert.equal(actual.length,row.staffs.length);
  actual.forEach((s,i)=>{const expected=row.staffs[i];for(const key of ['a','b'])for(let k=0;k<2;k++)assert.ok(Math.abs(s[key][k]-expected[key][k])<1e-7);assert.equal(s.confidence,expected.confidence);assert.equal(s.blurred,expected.blurred);});
 }
});
