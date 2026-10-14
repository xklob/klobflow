import {defaults,patchConfig,Guide,StaffDetector,StaffTracker,Scorer,distance} from "./core.mjs";
let config={...defaults},detector=new StaffDetector(),tracker=new StaffTracker(),scorer=new Scorer(),previous=0,fps=0,lastFrame=null;
self.onmessage=({data})=>{
  try {
    if(data.type==="config") {config=patchConfig(config,data.config,{restore:!!data.restore});scorer.reset();self.postMessage({type:"config",id:data.id,config});return;}
    if(data.type==="reset"){tracker.reset();scorer.reset();return;}
    if(data.type==="seed"){
      if(!lastFrame)throw Error("Wait for camera frames");
      if(data.points.length!==4||data.points.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1)))throw Error("Tap four valid staff endpoints");
      const g=new Guide(config,lastFrame.width,lastFrame.height),p=data.points.map(p=>[p[0]*g.aspectX,p[1]*g.aspectY]);
      const segments=[{a:p[0],b:p[1],confidence:1},{a:p[2],b:p[3],confidence:1}];
      if(segments.some(s=>distance(s.a,s.b)<.08))throw Error("Staff endpoints are too close together");
      tracker.seed(segments,data.time);scorer.reset();self.postMessage({type:"ack",id:data.id});return;
    }
    if(data.type!=="frame")return;
    const start=performance.now(),{width,height,time}=data,rgba=new Uint8ClampedArray(data.pixels),argb=new Int32Array(width*height);
    for(let i=0;i<argb.length;i++)argb[i]=(255<<24)|(rgba[i*4]<<16)|(rgba[i*4+1]<<8)|rgba[i*4+2];
    const detected=detector.detect(argb,width,height,config),staffs=tracker.update(detected,time),g=new Guide(config,width,height);
    if(previous&&time>previous)fps=fps?fps*.85+1000/(time-previous)*.15:1000/(time-previous);previous=time;
    lastFrame={time,width,height,staffs,config,currentConfig:config,guide:g.json(),feedback:g.cues(staffs),metrics:scorer.score(time,staffs,g),analysisFps:fps,source:"camera"};
    self.postMessage({type:"frame",frame:lastFrame,processingMs:performance.now()-start});
  } catch(e){self.postMessage({type:"error",id:data.id,error:e.message,frame:data.type==="frame"});}
};
