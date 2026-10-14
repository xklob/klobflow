export function cameraProfiles(capabilities = {}, target = "auto") {
  const fps = target === "auto" ? Math.max(30, Math.min(120, capabilities.frameRate?.max || 60)) : Number(target);
  return [[1280,720],[640,480],[1920,1080],[320,240]].map(([width,height]) => ({width,height,fps}));
}
export function chooseProfile(results) {
  if (!results.length) throw Error("This camera did not produce a usable video mode.");
  const fastest = Math.max(...results.map(r => r.measuredFps));
  // Within 5% of the fastest observed cadence, retain more tracking detail.
  return results.filter(r => r.measuredFps >= fastest * .95).sort((a,b) => b.width*b.height-a.width*a.height)[0];
}
export function measureCadence(video, duration = 850, signal) {
  return new Promise((resolve,reject) => {
    let first=null,last=null,callback=null,timer,done=false;
    const cleanup=()=>{done=true;clearTimeout(timer);if(callback!==null){video.cancelVideoFrameCallback?.(callback);cancelAnimationFrame(callback);}signal?.removeEventListener("abort",abort);};
    const finish=()=>{if(done)return;cleanup();resolve(first&&last&&last.time>first.time?(last.frames-first.frames)*1000/(last.time-first.time):0);};
    const abort=()=>{if(done)return;cleanup();reject(new DOMException("Camera setup canceled","AbortError"));};
    const frame=(now,metadata)=>{if(done)return;const sample={time:now,frames:metadata.presentedFrames};first??=sample;last=sample;if(now-first.time>=duration)finish();else callback=video.requestVideoFrameCallback(frame);};
    if(signal?.aborted)return abort();
    signal?.addEventListener("abort",abort,{once:true});
    timer=setTimeout(finish,duration+1800);
    if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback(frame);
    else {let frames=0,previous=-1;const tick=now=>{if(done)return;if(video.readyState>=2&&video.currentTime!==previous){previous=video.currentTime;frames++;first??={time:now,frames};last={time:now,frames};}if(first&&now-first.time>=duration)finish();else callback=requestAnimationFrame(tick);};callback=requestAnimationFrame(tick);}
  });
}
export async function optimizeCamera(track, video, {target="auto",signal,onProgress=()=>{}}={}) {
  const caps=track.getCapabilities?.() || {},results=[];
  for(const profile of cameraProfiles(caps,target)) {
    if(signal?.aborted)throw new DOMException("Camera setup canceled","AbortError");
    onProgress(`Checking ${profile.width} × ${profile.height} at up to ${profile.fps} fps…`);
    try {
      await track.applyConstraints({width:{exact:profile.width},height:{exact:profile.height},frameRate:{ideal:profile.fps},resizeMode:{ideal:"none"}});
      await video.play();
      // Let exposure / capture cadence settle before comparing modes.
      await measureCadence(video,250,signal);
      const measuredFps=await measureCadence(video,850,signal),settings=track.getSettings();
      if(measuredFps>0)results.push({...profile,width:settings.width,height:settings.height,reportedFps:settings.frameRate,measuredFps});
    } catch(e) {if(e.name==="AbortError")throw e;}
  }
  if(!results.length){
    await track.applyConstraints({width:{ideal:1280},height:{ideal:720},frameRate:{ideal:target==="auto"?60:Number(target)}});
    await video.play();const settings=track.getSettings(),measuredFps=await measureCadence(video,850,signal);
    if(!measuredFps)throw Error("No camera frames arrived. Check camera access or try another camera.");
    results.push({width:settings.width,height:settings.height,fps:settings.frameRate,reportedFps:settings.frameRate,measuredFps});
  }
  const best=chooseProfile(results);
  await track.applyConstraints({width:{exact:best.width},height:{exact:best.height},frameRate:{ideal:best.fps},resizeMode:{ideal:"none"}});
  return {selected:best,probes:results};
}
