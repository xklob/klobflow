import {StaffDetector,add,sub,mul,distance,center,length,angle,angleDifference} from './core.mjs';

const HOLD=5000,COUNTDOWN=5000,STILL=2000,MAX_GAP=250,RELEASE=1000;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const valid=s=>s&&s.confidence>=.7&&!s.blurred&&!s.occluded&&[...s.a,...s.b].every(Number.isFinite);
const reversed=s=>({...s,a:s.b,b:s.a});
const ordered=(s,anchor)=>distance(s.a,anchor.a)+distance(s.b,anchor.b)<=distance(s.a,anchor.b)+distance(s.b,anchor.a)?s:reversed(s);
const stable=(s,a)=>distance(center(s),center(a))<=Math.max(.012,length(a)*.035)&&Math.abs(length(s)-length(a))<=length(a)*.08&&angleDifference(angle(s),angle(a))<=.10;

// Gesture-only observations never enter the practice tracker or precision scores.
export class CrossScanner {
 constructor(){this.detector=new StaffDetector();this.last=-Infinity;}
 reset(){this.last=-Infinity;}
 scan(pixels,width,height,time,config){
  if(time>=this.last&&time-this.last<125)return null;
  this.last=time;
  const scale=Math.min(1,192/Math.max(width,height)),w=Math.max(2,Math.round(width*scale)),h=Math.max(2,Math.round(height*scale));
  const small=new Int32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)small[y*w+x]=pixels[Math.min(height-1,Math.floor((y+.5)*height/h))*width+Math.min(width-1,Math.floor((x+.5)*width/w))];
  return this.detector.detect(small,w,h,{...config,staffCount:2},[],true);
 }
}
export function findCross(candidates,width,height){
 const unit=Math.min(width,height),x=width/unit,y=height/unit;
 const good=candidates.filter(s=>valid(s)&&length(s)>=.15&&length(s)<=1.65&&[s.a,s.b].every(p=>p[0]>.015&&p[0]<x-.015&&p[1]>.015&&p[1]<y-.015));
 let best=null,rank=-Infinity;
 for(let i=0;i<good.length;i++)for(let j=i+1;j<good.length;j++){
  const a=good[i],b=good[j],u=sub(a.b,a.a),v=sub(b.b,b.a),la=length(a),lb=length(b),den=cross(u,v);
  if(Math.min(la,lb)<Math.max(la,lb)*.55||Math.abs(den)/(la*lb)<.7)continue;
  if(Math.abs(u[0])/la<.3||Math.abs(u[1])/la<.3||Math.abs(v[0])/lb<.3||Math.abs(v[1])/lb<.3||u[0]*u[1]*v[0]*v[1]>=0)continue;
  const delta=sub(b.a,a.a),ta=cross(delta,v)/den,tb=cross(delta,u)/den;
  if(ta<.25||ta>.75||tb<.25||tb>.75)continue;
  const score=a.confidence+b.confidence+Math.min(la,lb)-Math.abs(ta-.5)-Math.abs(tb-.5);
  if(score>rank){rank=score;best=[a,b].sort((p,q)=>{const d=sub(p.b,p.a),e=sub(q.b,q.a);return Math.sign(d[0]*d[1])-Math.sign(e[0]*e[1]);});}
 }
 return best;
}

export class GestureAlignment {
 constructor(){this.suspended=false;this.reset();}
 reset(armed=true){
  this.state='idle';this.armed=armed;this.time=null;this.crossAt=-Infinity;this.crossPose=null;this.holdPose=null;this.holdSince=null;this.releaseSince=null;this.deadline=0;this.started=0;this.until=0;this.waitUntil=0;this.zoomTried=false;this.note='';this.reason='';this.reasonUntil=0;this.clearSamples();this.frame=this.status(0);
 }
 clearSamples(){this.samples=[];this.anchor=null;this.stillSince=null;this.sampleAt=null;}
 get active(){return ['countdown','settling','zooming','applying'].includes(this.state);}
 get scans(){return !this.suspended&&!this.active;}
 cancel(time,message='Alignment cancelled. Make a new X to try again.'){
  this.state='cancelled';this.reason=message;this.until=time+3000;this.armed=false;this.holdSince=null;this.holdPose=null;this.releaseSince=null;this.clearSamples();this.frame=this.status(time);
 }
 suspend(value,time){this.suspended=value;this.reset(false);this.time=time;}
 accept(time,ok=true){
  if(!['zooming','applying'].includes(this.state))return;
  if(!ok){this.cancel(time,'Camera adjustment failed. Guide alignment was not completed.');return;}
  if(this.state==='zooming'){this.state='settling';this.waitUntil=time+600;this.started=time;this.reason='Zoom adjusted. Keep your grips in place while the camera settles.';this.clearSamples();}
  else {this.state='success';this.until=time+4000;this.clearSamples();}
  this.frame=this.status(time);
 }
 status(t,count=2){
  let title='',detail='',remainingMs=0,progress=0;
  if(this.state==='holding'){remainingMs=Math.max(0,HOLD-(t-this.holdSince));progress=1-remainingMs/HOLD;title=`HOLD THE X · ${Math.ceil(remainingMs/1000)}`;detail='Keep both staves crossed and still. Release the X to stop.';}
  if(this.state==='countdown'){remainingMs=Math.max(0,this.deadline-t);progress=1-remainingMs/COUNTDOWN;title=`AUTO-ALIGNMENT IN ${Math.ceil(remainingMs/1000)}`;detail=count===1?'Uncross and put the second staff aside. Grip the remaining staff at its midpoint, put your hand at the new center, then hold still.':'Uncross. Grip each staff at its midpoint, put your hands at the new guide centers, then hold still.';}
  if(this.state==='settling'){remainingMs=this.stillSince===null?STILL:Math.max(0,STILL-(t-this.stillSince));progress=1-remainingMs/STILL;title='HOLD STILL · ALIGNING';detail=this.reason||'Keep your grip positions and both ends of each staff still and visible.';}
  if(this.state==='zooming'){title='ADJUSTING CAMERA ZOOM';detail='Keep your hands at the intended centers. The guide will be measured again after zoom settles.';}
  if(this.state==='applying'){title='APPLYING ALIGNMENT';detail='Keep still for a moment.';}
  if(this.state==='success'){title='ALIGNMENT SET';detail=`Center and guide size now follow your grip positions. ${this.note}Separate the staves before making another X.`;progress=1;}
  if(this.state==='cancelled'){title='ALIGNMENT CANCELLED';detail=this.reason;}
  return {state:this.state,active:this.active,remainingMs,progress:clamp(progress,0,1),title,detail};
 }
 update(t,candidates,staffs,g,zoom={min:1,max:1,ratio:1},blocked=false){
  const c=g.config;
  if(c.gestureEnabled===false||blocked||this.suspended){this.reset(false);return null;}
  if(this.time!==null&&(t<this.time||t-this.time>1000)){if(this.active)this.cancel(t,'Camera frames were interrupted. Make a new X when ready.');else this.reset(false);}
  if(this.time!==null&&t-this.time>MAX_GAP){this.holdSince=null;this.holdPose=null;this.clearSamples();}
  const duplicate=t===this.time;this.time=t;
  if(candidates!==null){
   this.crossAt=t;this.crossPose=findCross(candidates,g.width,g.height);
   if(!this.crossPose){this.holdSince=null;this.holdPose=null;if(this.state==='holding')this.state='idle';this.releaseSince??=t;if(t-this.releaseSince>=RELEASE)this.armed=true;}
   else this.releaseSince=null;
  }
  if(t-this.crossAt>MAX_GAP){this.crossPose=null;this.holdSince=null;this.holdPose=null;if(this.state==='holding')this.state='idle';}
  if(['success','cancelled'].includes(this.state)&&t>=this.until)this.state='idle';
  if(['idle','holding'].includes(this.state)&&this.armed&&this.crossPose&&candidates!==null){
   if(!this.holdPose||!this.crossPose.every((s,i)=>stable(s,this.holdPose[i]))){this.holdPose=this.crossPose;this.holdSince=t;}
   this.state='holding';
   if(t-this.holdSince>=HOLD){this.state='countdown';this.deadline=t+COUNTDOWN;this.armed=false;this.zoomTried=false;this.note='';this.clearSamples();}
  }
  let action=null;
  if(this.state==='countdown'&&t>=this.deadline){this.state='settling';this.started=t;this.waitUntil=t;this.reason='Hold still while the guide measures your grip positions.';this.clearSamples();}
  if(['zooming','applying'].includes(this.state)&&t-this.started>8000)this.cancel(t,'Camera adjustment took too long. Make a new X to try again.');
  if(this.state==='settling'){
   if(t-this.started>25000)this.cancel(t,'Could not get a steady, clear pose. Make a new X to try again.');
   else if(t>=this.waitUntil&&!duplicate){
    const observed=staffs.slice(0,c.staffCount),measured=observed.map(s=>valid(s)?g.rectify(s):null);
    if(measured.length!==c.staffCount||measured.some(s=>!s)){this.clearSamples();this.reason=`Hold ${c.staffCount===1?'one staff':'both staves'} still with every end visible. Uncross the staves so each can be measured.`;}
    else {
     if(!this.anchor||this.sampleAt===null||t-this.sampleAt>MAX_GAP||!measured.every((s,i)=>stable(s,this.anchor[i]))){this.clearSamples();this.anchor=measured;this.stillSince=t;}
     this.sampleAt=t;this.samples.push(measured.map((s,i)=>ordered(s,this.anchor[i])));if(t>=this.reasonUntil)this.reason='Measuring your still pose. Keep gripping each staff at its midpoint.';
     if(t-this.stillSince>=STILL&&this.samples.length>=8){action=this.fit(t,g,zoom);}
    }
   }
  }
  this.frame=this.status(t,c.staffCount);return action;
 }
 fit(t,g,zoom){
  const c=g.config,mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
  const poses=Array.from({length:c.staffCount},(_,i)=>({a:[0,1].map(k=>mean(this.samples.map(s=>s[i].a[k]))),b:[0,1].map(k=>mean(this.samples.map(s=>s[i].b[k]))),confidence:1}));
  poses.sort((a,b)=>g.local(center(a))[0]-g.local(center(b))[0]);
  const centers=poses.map(center),grip=[0,1].map(k=>mean(centers.map(p=>p[k]))),len=mean(poses.map(length));
  const scale=c.mode==='antispin'?len:c.mode==='cube'?len/2/(1+c.cubeDepth/2):len/2;
  if(!this.zoomTried&&!g.calibrated&&zoom.max>zoom.min){
   // Reserve the full intended movement, not just the current shaft orientation.
   const radius=c.mode==='antispin'?len:len/2;
   const extentX=Math.max(...centers.map(p=>Math.abs(p[0]-g.planeX/2)+radius)),extentY=Math.max(...centers.map(p=>Math.abs(p[1]-g.planeY/2)+radius));
   const desired=clamp(zoom.ratio*Math.min(1.5,g.planeX*.42/extentX,g.planeY*.42/extentY,.46/scale),zoom.min,zoom.max);this.zoomTried=true;
   if(Math.abs(desired-zoom.ratio)>zoom.ratio*.08){this.state='zooming';this.started=t;this.clearSamples();return {config:{zoom:desired},seeds:null};}
  }
  const cx=grip[0]/g.planeX,cy=grip[1]/g.planeY;
  if(cx<.1||cx>.9||cy<.1||cy>.9){this.clearSamples();this.reasonUntil=t+2500;this.reason='Bring your grip positions farther inside the camera view, then hold still.';return null;}
  const patch={cx,cy,scale:clamp(scale,.1,.48)};
  if(c.staffCount===2&&['circles','antispin'].includes(c.mode)){
   const a=g.local(centers[0]),b=g.local(centers[1]),separation=Math.abs(b[0]-a[0])/patch.scale;
   if(Math.abs(b[1]-a[1])>Math.max(.025,len*.10)||separation>1.8){this.clearSamples();this.reasonUntil=t+2500;this.reason='Keep your grip positions along the guide’s horizontal axis and a little closer together, then hold still.';return null;}
   patch.circleSeparation=separation;
  }
  this.note=g.calibrated?'Viewing-angle calibration kept the current zoom. ':zoom.max<=zoom.min?'This camera has fixed zoom. ':'';
  if(scale!==patch.scale)this.note+='Guide size reached its limit; adjust camera framing if needed. ';
  this.state='applying';this.started=t;
  return {config:patch,seeds:poses.map(s=>({...s,a:g.project(s.a),b:g.project(s.b)}))};
 }
}
