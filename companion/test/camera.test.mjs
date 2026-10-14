import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCameraProfile,applyTrackSettings,setExposure,openCamera,cameraError} from '../public/camera.mjs';
test('a busy camera retries compatible modes without changing the selected device',async()=>{
 const calls=[],delays=[],stream={getTracks:()=>[]};
 const mediaDevices={getUserMedia:async c=>{calls.push(c);if(calls.length<3)throw new DOMException('Could not start video source','NotReadableError');return stream;}};
 assert.equal(await openCamera({deviceId:'webcam',mediaDevices,wait:async ms=>delays.push(ms)}),stream);
 assert.equal(calls.length,3);assert.deepEqual(delays,[300,800]);assert.ok(calls.every(c=>c.video.deviceId.exact==='webcam'&&c.audio===false));assert.equal(calls[1].video.frameRate.ideal,30);
});
test('permission denial does not retry, permanent busy errors explain recovery, and canceled streams close',async()=>{
 let attempts=0;const denied=new DOMException('denied','NotAllowedError');
 await assert.rejects(openCamera({mediaDevices:{getUserMedia:async()=>{attempts++;throw denied;}},wait:async()=>{}}),e=>e===denied);assert.equal(attempts,1);
 const busy=new DOMException('Could not start video source','NotReadableError');
 await assert.rejects(openCamera({mediaDevices:{getUserMedia:async()=>{throw busy;}},wait:async()=>{}}),e=>e===busy);assert.match(cameraError(busy),/Close other camera apps or tabs/);
 const controller=new AbortController();let stopped=false;
 await assert.rejects(openCamera({signal:controller.signal,mediaDevices:{getUserMedia:async()=>{controller.abort();return {getTracks:()=>[{stop:()=>{stopped=true;}}]};}}}),e=>e.name==='AbortError');assert.ok(stopped);
});
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
