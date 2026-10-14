import {defaults,patchConfig} from "./core.mjs";
import {optimizeCamera,applyCameraProfile,applyTrackSettings,setExposure,openCamera,cameraError} from "./camera.mjs";
import {saveSession,listSessions,getSession} from "./sessions.mjs";

export class BrowserCamera {
  constructor(video,{onFrame=()=>{},onStatus=()=>{},onSessions=()=>{}}={}){
    this.video=video;this.onFrame=onFrame;this.onStatus=onStatus;this.onSessions=onSessions;
    this.config={...defaults};try{this.config=patchConfig(this.config,JSON.parse(localStorage.getItem("klobflow.local.config")||"{}"),{restore:true});}catch{}
    this.active=false;this.recording=false;this.finalizing=false;this.generation=0;this.requestId=0;this.configRevision=0;this.pending=new Map();this.unsaved=new Map();this.lastFrame=null;
    this.canvas=document.createElement("canvas");this.context=this.canvas.getContext("2d",{willReadFrequently:true});
    this.recordCanvas=document.createElement("canvas");this.recordContext=this.recordCanvas.getContext("2d");
    this.resumeOnVisible=false;
    this.visibility=()=>{
      if(document.hidden){this.resumeOnVisible=this.active;this.stop().catch(e=>onStatus(e.message));}
      else if(this.resumeOnVisible){this.resumeOnVisible=false;this.start({deviceId:this.deviceId,target:this.target,reuse:true}).catch(e=>onStatus(e.message));}
    };
    document.addEventListener("visibilitychange",this.visibility);
    this.pageHide=()=>{this.resumeOnVisible=this.active;this.stop().catch(()=>{});};
    window.addEventListener("pagehide",this.pageHide);
    window.addEventListener("pageshow",()=>{if(this.resumeOnVisible&&!document.hidden)this.visibility();});
  }
  remember(){try{localStorage.setItem("klobflow.local.config",JSON.stringify(this.config));}catch{}}
  async start({deviceId=this.deviceId,target=this.target||"auto",reuse=false}={}){
    await this.stop();
    const generation=++this.generation,controller=new AbortController();this.controller=controller;
    this.target=target;this.onStatus("Opening your PC camera…");
    if(!navigator.mediaDevices?.getUserMedia)throw Error("Camera access requires localhost or HTTPS and a browser that supports local cameras.");
    let stream;
    try{
      stream=await openCamera({deviceId,signal:controller.signal,onProgress:this.onStatus});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.track=stream.getVideoTracks()[0];this.video.srcObject=stream;await this.video.play();
      const actualId=this.track.getSettings().deviceId;
      if(this.deviceId&&actualId!==this.deviceId){this.config={...this.config,planeCorners:[],zoom:0};this.exposureChoice='auto';}
      this.deviceId=actualId;
      this.exposureChoice??='auto';
      if(this.exposureChoice!=='auto')await setExposure(this.track,this.exposureChoice);
      if(reuse&&this.profile){
        try{await applyCameraProfile(this.track,this.profile);}
        catch{reuse=false;}
      }
      if(!reuse||!this.profile){const result=await optimizeCamera(this.track,this.video,{target,signal:controller.signal,onProgress:this.onStatus});this.profile=result.selected;this.probes=result.probes;}
      if(generation!==this.generation)return;
      this.settings=this.track.getSettings();
      if(this.config.planeCorners.length&&Math.abs(this.settings.width/this.settings.height-this.config.calibrationImageAspect)>.03)this.config={...this.config,planeCorners:[]};
      await this.applyZoom();
      this.video.style.transform=this.config.mirror?"scaleX(-1)":"none";
      this.worker=new Worker(new URL("./tracker-worker.mjs",import.meta.url),{type:"module"});
      this.worker.onmessage=({data})=>{
        if(generation!==this.generation)return;
        if(data.id){const p=this.pending.get(data.id);this.pending.delete(data.id);if(p){clearTimeout(p.timer);data.type==="error"?p.reject(Error(data.error)):p.resolve(data);}}
        if(data.type==="fit"&&data.revision===this.configRevision)this.command({action:"config",config:data.config,fromFit:true}).catch(e=>this.onStatus(e.message));
        if(data.type==="error"){if(data.frame)this.busy=false;this.onStatus(data.error);}
        if(data.type==="frame"){
          if(this.track&&(!this.settingsAt||performance.now()-this.settingsAt>1000)){this.settings=this.track.getSettings();this.settingsAt=performance.now();}
          this.busy=false;const f={...data.frame,cameraReady:this.active,recording:this.recording,finalizing:this.finalizing,elapsedMs:this.recording?Math.max(0,data.frame.time-this.recordingStarted):0,status:this.status,zoom:this.zoom,cameraFps:this.cameraFps||this.profile.measuredFps};
          this.lastFrame=f;
          if(this.recording&&f.time>=this.recordingStarted){this.analysis.push(JSON.stringify(f));this.frameCount++;if(f.metrics.deviation!=null){this.validCount++;this.errorSum+=f.metrics.deviation;}this.analysisBytes+=this.analysis.at(-1).length;if(this.analysisBytes>30_000_000)this.stopRecording().then(()=>this.onStatus("Session saved at the analysis size limit. Start another recording to continue."));}
          this.onFrame(f);
        }
      };
      this.worker.onerror=()=>{this.busy=false;this.onStatus("Camera analysis stopped. Restart the PC camera to try again.");};
      await this.request("config",{config:this.config,restore:true,start:true,zoom:this.zoom,revision:this.configRevision});
      this.active=true;this.busy=false;this.lastSubmitted=0;this.cameraSamples=[];
      this.track.onended=()=>{if(this.active){this.stop().catch(()=>{});this.onStatus("Camera disconnected. Reconnect it and choose Start PC camera.");}};
      this.status=`${this.settings.width} × ${this.settings.height} · PC camera`;
      this.onStatus(this.status);this.remember();this.schedule(generation);
    }catch(e){
      const superseded=generation!==this.generation;
      stream?.getTracks().forEach(t=>t.stop());if(generation===this.generation)await this.stop();
      if(superseded&&controller.signal.aborted&&e.name==='AbortError')return;
      throw Error(cameraError(e));
    }
  }
  request(type,data={}){
    return new Promise((resolve,reject)=>{
      if(!this.worker)return reject(Error("Start the PC camera first"));
      const id=++this.requestId,timer=setTimeout(()=>{this.pending.delete(id);reject(Error("Camera analysis is busy. Try again."));},6000);
      this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({type,id,...data});
    });
  }
  schedule(generation){
    const callback=(time,metadata)=>{if(!this.active||generation!==this.generation)return;this.schedule(generation);this.capture(time,metadata);};
    if(this.video.requestVideoFrameCallback)this.callback=this.video.requestVideoFrameCallback(callback);
    else this.callback=requestAnimationFrame(time=>callback(time,{presentedFrames:Math.floor(this.video.currentTime*(this.settings.frameRate||30))}));
  }
  draw(context,width,height){
    context.save();context.clearRect(0,0,width,height);if(this.config.mirror){context.translate(width,0);context.scale(-1,1);}context.drawImage(this.video,0,0,width,height);context.restore();
  }
  capture(time,metadata){
    if(this.video.readyState<2)return;
    this.cameraSamples.push({time,frames:metadata.presentedFrames});this.cameraSamples=this.cameraSamples.filter(s=>time-s.time<1500);
    if(this.cameraSamples.length>1){const first=this.cameraSamples[0];this.cameraFps=(metadata.presentedFrames-first.frames)*1000/(time-first.time);}
    if(this.recording)this.draw(this.recordContext,this.recordCanvas.width,this.recordCanvas.height);
    // Analyze each delivered camera frame when the worker is ready. Never queue old frames.
    if(this.busy||time===this.lastSubmitted)return;
    const scale=384/Math.max(this.video.videoWidth,this.video.videoHeight),width=Math.max(2,Math.round(this.video.videoWidth*scale)),height=Math.max(2,Math.round(this.video.videoHeight*scale));
    if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
    this.draw(this.context,width,height);
    const image=this.context.getImageData(0,0,width,height);this.busy=true;this.lastSubmitted=time;
    this.worker.postMessage({type:"frame",width,height,time,pixels:image.data.buffer},[image.data.buffer]);
  }
  async applyZoom(){
    const cap=this.track.getCapabilities?.().zoom;
    if(!cap){this.zoom={min:1,max:1,ratio:1};return;}
    const ratio=this.config.zoom===0?cap.min:Math.min(cap.max,Math.max(cap.min,this.config.zoom));
    await applyTrackSettings(this.track,{zoom:ratio});this.settings=this.track.getSettings();
    this.zoom={min:cap.min,max:cap.max,ratio:this.track.getSettings().zoom??ratio};
  }
  async exposure(choice){
    if(!this.track)throw Error('Start the PC camera first.');
    this.settings=await setExposure(this.track,choice);this.exposureChoice=choice;this.cameraSamples=[];if(this.worker){++this.configRevision;await this.request('background',{mode:'clear'});}
  }
  audioTempo(audio){this.worker?.postMessage({type:"audio",audio});}
  async command(command){
    if(command.action==="config"){
      if((this.recording||this.finalizing)&&["mirror","facing","fps"].some(k=>k in command.config&&command.config[k]!==this.config[k]))throw Error("Stop recording before changing camera or mirroring");
      if(!command.fromFit)++this.configRevision;const revision=this.configRevision;
      const next=patchConfig(this.config,command.config),previous=this.config;
      this.config=next;
      try{if(next.zoom!==previous.zoom)await this.applyZoom();if(command.fromFit&&revision!==this.configRevision)return {ok:true,config:this.config};await this.request("config",{config:next,fromFit:!!command.fromFit,zoom:this.zoom,revision});}
      catch(e){this.config=previous;throw e;}
      this.video.style.transform=next.mirror?"scaleX(-1)":"none";this.remember();return {ok:true,config:this.config};
    }
    if(command.action==="calibrate"){
      if(!this.lastFrame)throw Error("Wait for camera frames");
      return this.command({action:"config",config:{planeCorners:command.points,planeAspect:command.aspect,calibrationImageAspect:this.lastFrame.width/this.lastFrame.height}});
    }
    if(command.action==="background"){++this.configRevision;await this.request("background",{mode:command.mode||"capture",time:performance.now()});}
    else if(command.action==="fit")await this.request("fit",{zoom:!!command.zoom,sizeOnly:!!command.sizeOnly,revision:++this.configRevision});
    else if(command.action==="syncBeat")await this.request("syncBeat",{time:performance.now()});
    else if(command.action==="seed")await this.request("seed",{points:command.points,time:performance.now()});
    else if(command.action==="reset")this.worker.postMessage({type:"reset"});
    else if(command.action==="record")await this.startRecording();
    else if(command.action==="stop")await this.stopRecording();
    else throw Error("Unknown camera control");
    return {ok:true,config:this.config};
  }
  async startRecording(){
    if(!this.active||this.recording||this.finalizing)throw Error("Wait for the camera or previous recording to finish");
    if(!window.MediaRecorder||!this.recordCanvas.captureStream)throw Error("Recording is unavailable in this browser. Try Chrome or Edge.");
    const mimeType=["video/webm;codecs=vp9","video/webm;codecs=vp8","video/mp4","video/webm"].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mimeType)throw Error("This browser has no supported video recording format");
    const createdAt=Date.now(),id=`klobflow-${createdAt}`;this.recordCanvas.width=this.settings.width;this.recordCanvas.height=this.settings.height;this.draw(this.recordContext,this.recordCanvas.width,this.recordCanvas.height);
    this.recordStream=this.recordCanvas.captureStream(Math.min(120,this.settings.frameRate||60));
    let recorder;
    try{recorder=new MediaRecorder(this.recordStream,{mimeType,videoBitsPerSecond:8_000_000});}
    catch(e){this.recordStream.getTracks().forEach(t=>t.stop());throw e;}
    this.recorder=recorder;this.chunks=[];this.videoBytes=0;this.analysisBytes=0;this.frameCount=0;this.validCount=0;this.errorSum=0;this.recordingError=null;
    this.analysis=[JSON.stringify({type:"header",schema:1,id,config:this.config,camera:this.settings,note:"Browser capture. Monotonic sample and recording times are approximate video synchronization."})];
    this.recordingStarted=performance.now();
    this.finished=new Promise(resolve=>{this.finishRecording=resolve;});
    recorder.ondataavailable=e=>{if(e.data.size){this.chunks.push(e.data);this.videoBytes+=e.data.size;if(this.videoBytes>256_000_000&&this.recording)this.stopRecording().then(()=>this.onStatus("Session saved at the 256 MB capture limit. Start another recording to continue."));}};
    recorder.onerror=e=>{this.recordingError=e.error?.message||"Video encoder error";this.onStatus(this.recordingError);if(recorder.state!=="inactive")recorder.stop();};
    recorder.onstop=async()=>{
      this.recording=false;this.finalizing=true;
      this.recordStream.getTracks().forEach(t=>t.stop());
      const session={id,createdAt,durationMs:performance.now()-this.recordingStarted,frames:this.frameCount,validFrames:this.validCount,meanDeviation:this.validCount?this.errorSum/this.validCount:null,recordingError:this.recordingError,config:this.config,mimeType,video:new Blob(this.chunks,{type:mimeType}),analysis:new Blob([this.analysis.join("\n")+"\n"],{type:"application/x-ndjson"})};
      this.chunks=[];this.analysis=[];
      try{await saveSession(session);this.onStatus("Practice saved in this browser. Export your video and analysis to keep a backup.");}
      catch{this.unsaved.set(id,session);this.onStatus("Browser storage is full or unavailable. Export this session now; it is only kept in this tab.");}
      this.finalizing=false;this.recorder=null;this.finishRecording(session);this.onSessions();
    };
    recorder.start(1000);this.recording=true;
  }
  async stopRecording(){
    if(this.recorder&&this.recorder.state!=="inactive"){this.recording=false;this.finalizing=true;this.recorder.stop();}
    if(this.finalizing)await this.finished;
  }
  async sessions(){return [...this.unsaved.values(),...await listSessions()];}
  async session(id){return this.unsaved.get(id)||await getSession(id);}
  async stop(){
    this.controller?.abort();++this.generation;this.active=false;
    if(this.callback!==undefined){this.video.cancelVideoFrameCallback?.(this.callback);cancelAnimationFrame(this.callback);}
    this.worker?.terminate();this.worker=null;this.busy=false;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error("Camera stopped"));}this.pending.clear();
    // Release the physical source immediately, before asynchronous recording finalization.
    this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;this.track=null;this.video.pause();this.video.srcObject=null;
    await this.stopRecording();
  }
}
