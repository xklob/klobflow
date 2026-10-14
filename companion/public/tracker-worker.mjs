import {defaults,patchConfig,Guide,StaffDetector,StaffTracker,Scorer,distance} from "./core.mjs";
import {TimingCoach,FitHelper} from "./practice.mjs";
import {FlowStreak} from "./streak.mjs";
const streakCoach=new FlowStreak(),timingCoach=new TimingCoach(),fit=new FitHelper();let zoom={min:1,max:1,ratio:1};
let revision=0;let audio={running:false,bpm:null,confidence:0,at:0,status:"Connect system audio"};
let config={...defaults},detector=new StaffDetector(),tracker=new StaffTracker(),scorer=new Scorer(),previous=0,fps=0,lastFrame=null;
self.onmessage=({data})=>{
  try {
    if(data.type==="config") {revision=data.revision??revision;const old=config;config=patchConfig(config,data.config,{restore:!!data.restore});if(old.staffCount!==config.staffCount||old.zoom!==config.zoom)tracker.reset();scorer.reset();timingCoach.reset();zoom=data.zoom||zoom;if(data.start&&config.autoFit)fit.begin(true);else if(!data.fromFit)fit.cancel();self.postMessage({type:"config",id:data.id,config});return;}
    if(data.type==="audio"){audio=data.audio;return;}
    if(data.type==="reset"){streakCoach.reset();tracker.reset();scorer.reset();timingCoach.reset();return;}
    if(data.type==="fit"){revision=data.revision??revision;fit.begin(!!data.zoom,!!data.sizeOnly);self.postMessage({type:"ack",id:data.id});return;}
    if(data.type==="syncBeat"){timingCoach.reset(data.time);self.postMessage({type:"ack",id:data.id});return;}
    if(data.type==="seed"){
      if(!lastFrame)throw Error("Wait for camera frames");
      if(data.points.length!==config.staffCount*2||data.points.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1)))throw Error("Tap four valid staff endpoints");
      const g=new Guide(config,lastFrame.width,lastFrame.height),p=data.points.map(p=>[p[0]*g.aspectX,p[1]*g.aspectY]);
      const segments=Array.from({length:config.staffCount},(_,i)=>({a:p[i*2],b:p[i*2+1],confidence:1}));
      if(segments.some(s=>distance(s.a,s.b)<.08))throw Error("Staff endpoints are too close together");
      tracker.seed(segments,data.time);scorer.reset();streakCoach.reset();self.postMessage({type:"ack",id:data.id});return;
    }
    if(data.type!=="frame")return;
    const start=performance.now(),{width,height,time}=data,rgba=new Uint8ClampedArray(data.pixels),argb=new Int32Array(width*height);
    for(let i=0;i<argb.length;i++)argb[i]=(255<<24)|(rgba[i*4]<<16)|(rgba[i*4+1]<<8)|rgba[i*4+2];
    const detected=detector.detect(argb,width,height,config,tracker.hints(time,config.staffCount)),staffs=tracker.update(detected,time,config.staffCount),g=new Guide(config,width,height);
    if(previous&&time>previous)fps=fps?fps*.85+1000/(time-previous)*.15:1000/(time-previous);previous=time;
    const fitPatch=fit.update(time,staffs,g,zoom.min,zoom.max,zoom.ratio);if(fitPatch)self.postMessage({type:"fit",config:fitPatch,revision});
    const ready=config.tempoSource==="manual"||(audio.running&&audio.bpm&&audio.confidence>=.6&&time-audio.at>=-100&&time-audio.at<2000);
    lastFrame={streak:streakCoach.update({time,config,staffs,feedback:g.cues(staffs)}),audio,beat:timingCoach.update(time,staffs,g,config.tempoSource==="manual"?config.bpm:(audio.bpm||config.bpm)*config.audioRate,config.tempoSource==="manual"?null:audio.origin+config.audioOffsetMs,ready),fitStatus:fit.status,time,width,height,staffs,config,currentConfig:config,guide:g.json(),feedback:g.cues(staffs),metrics:scorer.score(time,staffs,g),analysisFps:fps,source:"camera"};
    self.postMessage({type:"frame",frame:lastFrame,processingMs:performance.now()-start});
  } catch(e){self.postMessage({type:"error",id:data.id,error:e.message,frame:data.type==="frame"});}
};
