import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCameraProfile,applyTrackSettings,setExposure} from '../public/camera.mjs';
test('1080p falls back from unsupported 60 fps to a required 30 fps mode',async()=>{
 const calls=[],track={applyConstraints:async c=>{calls.push(c);if(c.frameRate.min>30)throw new DOMException('unsupported','OverconstrainedError');}};
 const actual=await applyCameraProfile(track,{width:1920,height:1080,fps:60});
 assert.equal(actual.requestedFps,30);assert.equal(calls.at(-1).width.exact,1920);assert.ok(calls.at(-1).frameRate.min>15);
});
test('zoom and exposure preserve frame rate and resolution, and automatic clears manual exposure',async()=>{
 let constraints={width:{exact:1920},height:{exact:1080},frameRate:{min:28.5,ideal:30,max:30}},settings={frameRate:30,width:1920,height:1080};
 const track={getConstraints:()=>constraints,getSettings:()=>settings,getCapabilities:()=>({exposureMode:['manual','continuous'],exposureTime:{min:5,max:1000,step:5}}),applyConstraints:async c=>{constraints=c;settings={...settings,...Object.assign({},...c.advanced)};}};
 await applyTrackSettings(track,{zoom:1.2});await setExposure(track,'120');
 assert.equal(constraints.frameRate.min,28.5);assert.equal(constraints.width.exact,1920);assert.equal(settings.exposureMode,'manual');assert.equal(settings.exposureTime,85);assert.equal(settings.zoom,1.2);
 await applyCameraProfile(track,{width:1280,height:720,fps:30});assert.equal(settings.exposureMode,'manual');assert.equal(settings.exposureTime,85);assert.equal(constraints.width.exact,1280);
 await setExposure(track,'auto');assert.equal(settings.exposureMode,'continuous');assert.ok(constraints.advanced.every(c=>!('exposureTime' in c)));assert.equal(constraints.frameRate.ideal,30);
 await assert.rejects(()=>setExposure({getCapabilities:()=>({})},'120'),/does not expose/);
});
