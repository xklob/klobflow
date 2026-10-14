import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Guide,Scorer,StaffTracker,StaffDetector,defaults,distanceToSegment} from '../public/core.mjs';
import {chooseProfile,cameraProfiles} from '../public/camera.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-core.json',import.meta.url)));
function close(actual,expected,path='root'){
  if(typeof expected==='number')assert.ok(Math.abs(actual-expected)<1e-7,`${path}: ${actual} != ${expected}`);
  else if(Array.isArray(expected)){assert.equal(actual.length,expected.length,path);expected.forEach((e,i)=>close(actual[i],e,`${path}[${i}]`));}
  else if(expected&&typeof expected==='object')for(const [k,v]of Object.entries(expected))close(actual[k]??(['occluded','blurred'].includes(k)?false:actual[k]),v,`${path}.${k}`);
  else assert.equal(actual,expected,path);
}
test('browser projection, scoring, tracking and occlusion match native oracle',()=>{
  const tracker=new StaffTracker();for(const s of fixture.steps)close(tracker.update(s.input,s.time),s.output);
  for(const f of fixture.guides){const g=new Guide(f.config,f.width,f.height);close(g.json(),f.guide);close(g.cues(fixture.staffs),f.feedback);close(new Scorer().score(1000,fixture.staffs,g),f.metrics);}
});
test('browser LED detection agrees with native synthetic image',()=>{
 const w=320,h=240,pixels=new Int32Array(w*h).fill(0xff101510);
 fixture.staffs.forEach((s,i)=>{for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(distanceToSegment([x/h,y/h],s)<.012)pixels[y*w+x]=i?0xffb5a3ff:0xffb6f36b;});
 close(new StaffDetector().detect(pixels,w,h,defaults),fixture.detected);
});
test('measured 720p60 wins over 1080p30; similar cadence retains detail',()=>{
 const profiles=[{width:1920,height:1080,measuredFps:30},{width:1280,height:720,measuredFps:59},{width:640,height:480,measuredFps:60}];
 assert.equal(chooseProfile(profiles).width,1280);
 assert.equal(chooseProfile([{...profiles[0],measuredFps:60},...profiles.slice(1)]).width,1920);
 assert.equal(cameraProfiles({frameRate:{max:120}})[0].fps,120);
 assert.throws(()=>chooseProfile([]));
});
