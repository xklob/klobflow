import {defaults,patchConfig,Guide,StaffDetector,StaffTracker,Scorer,distance} from "./core.mjs";
import {TimingCoach,FitHelper} from "./practice.mjs";
import {BackgroundFilter} from "./background.mjs";
import {RollingErrors} from "./rolling-errors.mjs";
import {FlowStreak} from "./streak.mjs";
import {MovingPacer} from "./pacer.mjs";
import {GestureAlignment,CrossScanner} from "./gesture.mjs";
const gesture=new GestureAlignment(),crossScanner=new CrossScanner();
const background=new BackgroundFilter(),rollingErrors=new RollingErrors(),streakCoach=new FlowStreak(),timingCoach=new TimingCoach(),pacerCoach=new MovingPacer(),fit=new FitHelper();let zoom={min:1,max:1,ratio:1};
let revision=0,pacerFrameFloor=-Infinity;let audio={running:false,bpm:null,confidence:0,at:0,status:"Connect system audio"};
let config={...defaults},detector=new StaffDetector(),tracker=new StaffTracker(),scorer=new Scorer(),previous=0,fps=0,lastFrame=null;
self.onmessage=({data})=>{
  try {
    if(data.revision!==undefined)revision=data.revision;
    if(data.type==="config") {
      revision=data.revision??revision;const old=config;config=patchConfig(config,data.config,{restore:!!data.restore});
      if(old.staffCount!==config.staffCount||old.zoom!==config.zoom||old.mirror!==config.mirror||old.facing!==config.facing||old.led!==config.led||JSON.stringify(old.staffColors)!==JSON.stringify(config.staffColors))tracker.reset();
      if(old.zoom!==config.zoom||old.mirror!==config.mirror||old.facing!==config.facing)background.clear();
      scorer.reset();timingCoach.reconfigure(old,config);pacerCoach.reconfigure(old,config);zoom=data.zoom||zoom;
      if(data.fromGesture){
        if(data.seeds)tracker.seed(data.seeds,data.time);
        gesture.accept(data.time);pacerFrameFloor=Math.max(pacerFrameFloor,data.time);rollingErrors.reset();streakCoach.reset();
      }else if(!data.fromFit){fit.cancel();gesture.reset();crossScanner.reset();}
      self.postMessage({type:"config",id:data.id,config});return;
    }
    if(data.type==="gesture"){
      if(data.revision!==undefined)revision=data.revision;
      if(data.operation==='cancel')gesture.cancel(data.time);
      else if(data.operation==='suspend'||data.operation==='resume')gesture.suspend(data.operation==='suspend',data.time);
      else if(data.operation==='failed')gesture.accept(data.time,false);
      else throw Error('Choose cancel, suspend or resume');
      crossScanner.reset();self.postMessage({type:'ack',id:data.id});return;
    }
    if(data.type==="background"){
      if(!['capture','clear','cancel'].includes(data.mode))throw Error('Choose capture, clear or cancel');
      if(data.mode==='capture')background.begin(data.time);else background.clear();
      tracker.reset();scorer.reset();timingCoach.reset();pacerCoach.reset();rollingErrors.reset();streakCoach.reset();fit.cancel();gesture.reset(false);crossScanner.reset();
      self.postMessage({type:'ack',id:data.id});return;
    }
    if(data.type==="audio"){audio=data.audio;return;}
    if(data.type==="reset"){rollingErrors.reset();streakCoach.reset();tracker.reset();scorer.reset();timingCoach.reset();pacerCoach.reset();pacerFrameFloor=-Infinity;gesture.suspend(false,data.time??0);gesture.reset();crossScanner.reset();fit.cancel();return;}
    if(data.type==="pacer"){
      if(!lastFrame)throw Error("Wait for camera frames before starting the guide dots.");
      if(['start','resume','restart'].includes(data.operation)&&['countdown','capturing'].includes(background.status.state))throw Error("Finish the background snapshot before starting the guide dots.");
      if(!Number.isFinite(data.time))throw Error("Invalid exercise time");
      if(gesture.active&&data.operation!=="stop")throw Error("Finish or cancel gesture alignment before starting the dots.");
      pacerCoach.command(data.operation,data.time,new Guide(config,lastFrame.width,lastFrame.height));pacerFrameFloor=data.time;streakCoach.reset();
      self.postMessage({type:"ack",id:data.id});return;
    }
    if(data.type==="fit"){revision=data.revision??revision;gesture.reset(false);crossScanner.reset();fit.begin(!!data.zoom,!!data.sizeOnly);self.postMessage({type:"ack",id:data.id});return;}
    if(data.type==="syncBeat"){timingCoach.reset(data.time);self.postMessage({type:"ack",id:data.id});return;}
    if(data.type==="seed"){
      if(!lastFrame)throw Error("Wait for camera frames");
      if(data.points.length!==config.staffCount*2||data.points.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1)))throw Error("Tap four valid staff endpoints");
      const g=new Guide(config,lastFrame.width,lastFrame.height),p=data.points.map(p=>[p[0]*g.aspectX,p[1]*g.aspectY]);
      const segments=Array.from({length:config.staffCount},(_,i)=>({a:p[i*2],b:p[i*2+1],confidence:1}));
      if(segments.some(s=>distance(s.a,s.b)<.08))throw Error("Staff endpoints are too close together");
      tracker.seed(segments,data.time);gesture.reset(false);crossScanner.reset();scorer.reset();streakCoach.reset();pacerCoach.reset();rollingErrors.reset();self.postMessage({type:"ack",id:data.id});return;
    }
    if(data.type!=="frame")return;
    // A captured frame queued before a control must not rewind that control's clock.
    // Acknowledge the skipped image so BrowserCamera can submit the next fresh frame.
    if(data.time<pacerFrameFloor){self.postMessage({type:"frameSkipped",id:data.id});return;}
    const start=performance.now(),{width,height,time}=data,rgba=new Uint8ClampedArray(data.pixels),argb=new Int32Array(width*height);
    for(let i=0;i<argb.length;i++)argb[i]=(255<<24)|(rgba[i*4]<<16)|(rgba[i*4+1]<<8)|rgba[i*4+2];
    const foreground=background.apply(argb,width,height,time,`${config.facing}:${config.mirror}:${config.zoom}`);
    const detected=detector.detect(foreground,width,height,config,tracker.hints(time,config.staffCount)),staffs=tracker.update(detected,time,config.staffCount),g=new Guide(config,width,height);
    const blocked=fit.active||['countdown','capturing'].includes(background.status.state);
    const cross=config.gestureEnabled&&gesture.scans&&!blocked?crossScanner.scan(foreground,width,height,time,config):null;
    const wasActive=gesture.active,gestureAction=gesture.update(time,cross,staffs,g,zoom,blocked);
    if(!wasActive&&gesture.active){pacerCoach.reset();streakCoach.reset();rollingErrors.reset();}
    if(gestureAction)self.postMessage({type:'gestureFit',...gestureAction,revision});
    const scoringStaffs=gesture.active?Array(config.staffCount).fill(null):staffs;
    if(previous&&time>previous)fps=fps?fps*.85+1000/(time-previous)*.15:1000/(time-previous);previous=time;
    const fitPatch=fit.update(time,staffs,g,zoom.min,zoom.max,zoom.ratio);if(fitPatch)self.postMessage({type:"fit",config:fitPatch,revision});
    const ready=config.tempoSource==="manual"||(audio.running&&audio.bpm&&audio.confidence>=.6&&time-audio.at>=-100&&time-audio.at<2000&&(!audio.holding||time-audio.at<audio.holdRemainingMs));
    const metrics=scorer.score(time,scoringStaffs,g);
    const pacer=pacerCoach.update(time,scoringStaffs,g,audio),feedback=gesture.active?[]:pacer.enabled?pacer.feedback:g.cues(staffs);
    lastFrame={gesture:gesture.frame,background:background.status,averagedMetrics:rollingErrors.update(time,metrics,config),streak:streakCoach.update({time,config,staffs:scoringStaffs,feedback,pacer}),pacer,audio,beat:timingCoach.update(time,scoringStaffs,g,config.tempoSource==="manual"?config.bpm:(audio.bpm||config.bpm)*config.audioRate,config.tempoSource==="manual"?null:audio.origin+config.audioOffsetMs,ready),fitStatus:fit.status,time,width,height,staffs,config,currentConfig:config,guide:g.json(),feedback,metrics,analysisFps:fps,source:"camera"};
    self.postMessage({type:"frame",frame:lastFrame,processingMs:performance.now()-start});
  } catch(e){self.postMessage({type:"error",id:data.id,error:e.message,frame:data.type==="frame"});}
};
