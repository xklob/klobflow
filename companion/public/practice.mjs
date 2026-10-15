import {add,sub,mul,distance,center,length} from './core.mjs';
const mean=a=>a.reduce((s,n)=>s+n,0)/a.length,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export class TimingCoach {
 constructor(){this.reset();}
 reset(time=null){this.epoch=time;this.previous=null;this.hits=[null,null];}
 reconfigure(before,after){
  const changed=keys=>keys.some(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
  if(changed(['tempoEnabled','bpm','tempoSource','audioRate','audioOffsetMs']))this.reset();
  else if(changed(['mode','staffCount','beatPoints','cx','cy','scale','rotation','cubeDepth','circleSeparation','planeCorners','planeAspect','calibrationImageAspect','calibrationRotation','facing','fps','mirror','zoom','led','threshold','minLength','staffColors'])){this.previous=null;this.hits=[null,null];}
 }
 targets(g,index){
  const c=g.config,origin=['circles','antispin'].includes(c.mode)?g.circles[index]:g.center;
  if(c.mode==='cube')return c.beatPoints===8?g.vertices:c.beatPoints===4?g.vertices.slice(0,4):[g.vertices[0],g.vertices[2]];
  const points=c.mode==='antispin'?4:c.beatPoints;
  return Array.from({length:points},(_,i)=>{const a=-Math.PI/2+i*2*Math.PI/points+c.rotation*Math.PI/180,d=[Math.cos(a),Math.sin(a)],r=c.mode==='grid'?g.radius/Math.max(Math.abs(Math.cos(a-c.rotation*Math.PI/180)),Math.abs(Math.sin(a-c.rotation*Math.PI/180))):g.radius;return add(origin,mul(d,r));});
 }
 update(t,staffs,g,tempo=g.config.bpm,externalEpoch=null,ready=true){
  if(!g.config.tempoEnabled||!ready){this.reset();return {enabled:false,bpm:120,phase:0,targets:[],hits:[]};}
  if(externalEpoch!==null)this.epoch=externalEpoch;
  this.epoch??=t;const period=60000/tempo,phase=(((t-this.epoch)/period)%1+1)%1;
  const measured=staffs.slice(0,g.config.staffCount).map(s=>s&&s.confidence>=.55&&!s.occluded&&!s.blurred?g.rectify(s):null),targets=Array.from({length:g.config.staffCount},(_,i)=>this.targets(g,i)),prev=this.previous,dt=prev?t-prev.time:0;
  measured.forEach((s,i)=>{
   const old=prev?.staffs[i];if(!s||!old||dt<1||dt>150){this.hits[i]=null;return;}
   const antispin=g.config.mode==='antispin',oldTips=antispin?g.antispinTips(old,i):[old.a],tips=antispin?g.antispinTips(s,i):[s.a],cycle=pts=>[g.antispinLocal(pts[0],i)[0],g.antispinLocal(pts[1],i)[1]];
   const origin=['circles','antispin'].includes(g.config.mode)?g.circles[i]:g.center,a=antispin?cycle(oldTips):sub(old.a,origin),b=antispin?cycle(tips):sub(s.a,origin),before=Math.atan2(a[1],a[0]),delta=Math.atan2(Math.sin(Math.atan2(b[1],b[0])-before),Math.cos(Math.atan2(b[1],b[0])-before));
   if(Math.hypot(...a)>g.radius*.2&&Math.hypot(...b)>g.radius*.2&&Math.abs(delta)>=.001&&Math.abs(delta)<=1.2)targets[i].forEach((target,j)=>{
    const d=antispin?g.antispinLocal(target,i):sub(target,origin),to=Math.atan2(Math.sin(Math.atan2(d[1],d[0])-before),Math.cos(Math.atan2(d[1],d[0])-before)),raw=to/delta,epsilon=antispin?1e-9:0,fraction=clamp(raw,0,1);
    if(raw>epsilon&&raw<=1+epsilon&&(!antispin||this.hits[i]?.point!==j+1||t-this.hits[i].time>period*2)){const at=prev.time+dt*fraction,nearest=this.epoch+Math.round((at-this.epoch)/period)*period,tip=antispin&&j%2===0?1:0,p=add(oldTips[tip],mul(sub(tips[tip],oldTips[tip]),fraction));this.hits[i]={time:at,offsetMs:at-nearest,error:distance(p,target)/(2*g.radius)*100,point:j+1};}
   });
   if(this.hits[i]&&t-this.hits[i].time>period*2)this.hits[i]=null;
  });
  this.previous={time:t,staffs:measured};return {enabled:true,bpm:tempo,phase,targets:targets.map(l=>l.map(p=>g.project(p))),hits:this.hits.slice(0,g.config.staffCount)};
 }
}
export class FitHelper {
 constructor(){this.cancel();}
 begin(zoom=false,size=false){this.active=true;this.allowZoom=zoom;this.sizeOnly=size;this.start=null;this.lastSample=null;this.samples=[];this.status=size?'Hold each full staff visible to match the guide size.':'Fitting center and size: keep your full staves visible for two seconds.';}
 cancel(){this.active=false;this.start=null;this.lastSample=null;this.samples=[];this.status='';}
 update(t,staffs,g,zoomMin,zoomMax,zoom){
  if(!this.active)return null;
  const measured=staffs.slice(0,g.config.staffCount).map(s=>s&&s.confidence>=.7&&!s.occluded&&!s.blurred?g.rectify(s):null);
  if(measured.length!==g.config.staffCount||measured.some(s=>!s)){this.start=null;this.lastSample=null;this.samples=[];this.status=`Waiting for ${g.config.staffCount} fully visible staff${g.config.staffCount===2?'s':''} to fit the guide.`;return null;}
  // Preserve the entire two-second interval, including at 60 fps; stalls restart collection.
  if(this.lastSample!==null&&(t<this.lastSample||t-this.lastSample>250)){this.start=null;this.samples=[];}
  if(t===this.lastSample)return null;
  this.start??=t;this.lastSample=t;this.samples.push(measured);
  this.status=`Fitting ${Math.min(100,Math.floor((t-this.start)/20))}% · keep the full movement in view`;
  if(t-this.start<2000||this.samples.length<12)return null;
  const all=this.samples.flat(),lengths=all.map(length).sort((a,b)=>a-b),radius=lengths[Math.floor(lengths.length/2)]/2;
  const crossCenters=g.config.mode==='antispin'?Array.from({length:g.config.staffCount},(_,i)=>{
   const endpoints=this.samples.flatMap(s=>[s[i].a,s[i].b]).map(p=>g.local(p));
   return g.point(...[0,1].map(axis=>(Math.min(...endpoints.map(p=>p[axis]))+Math.max(...endpoints.map(p=>p[axis])))/(2*g.radius)));
  }):[];
  const origin=crossCenters.length?[mean(crossCenters.map(p=>p[0])),mean(crossCenters.map(p=>p[1]))]:[mean(all.map(s=>center(s)[0])),mean(all.map(s=>center(s)[1]))],x=g.planeX,y=g.planeY;
  const spanX=Math.max(...all.map(s=>center(s)[0]+length(s)/2))-Math.min(...all.map(s=>center(s)[0]-length(s)/2)),spanY=Math.max(...all.map(s=>center(s)[1]+length(s)/2))-Math.min(...all.map(s=>center(s)[1]-length(s)/2));
  if(this.allowZoom&&!g.calibrated&&zoomMax>zoomMin){
   const extentX=Math.max(...all.map(s=>Math.abs(center(s)[0]-x/2)+length(s)/2)),extentY=Math.max(...all.map(s=>Math.abs(center(s)[1]-y/2)+length(s)/2)),desired=clamp(zoom*Math.min(1.5,x*.41/extentX,y*.41/extentY),zoomMin,zoomMax);this.allowZoom=false;
   if(Math.abs(desired-zoom)>zoom*.08){this.start=null;this.lastSample=null;this.samples=[];this.status='Adjusting camera framing, then refitting the guide…';return {zoom:desired};}
  }
  const scale=g.config.mode==='antispin'?radius*2:this.sizeOnly||['circles','free'].includes(g.config.mode)?radius:Math.max(spanX,spanY)/2/(g.config.mode==='cube'?1+g.config.cubeDepth/2:1),patch={scale:clamp(scale,.1,.48)};
  if(!this.sizeOnly){patch.cx=clamp(origin[0]/x,.1,.9);patch.cy=clamp(origin[1]/y,.1,.9);}
  if(!this.sizeOnly&&g.config.mode==='circles'&&g.config.staffCount===2){const centers=[0,1].map(i=>[mean(this.samples.map(s=>center(s[i])[0])),mean(this.samples.map(s=>center(s[i])[1]))]);patch.circleSeparation=clamp(distance(...centers)/radius,0,1.8);}
  if(!this.sizeOnly&&crossCenters.length===2)patch.circleSeparation=clamp(Math.abs(g.local(crossCenters[1])[0]-g.local(crossCenters[0])[0])/patch.scale,0,1.8);
  this.active=false;this.samples=[];this.status=scale>.48?'Guide reached its size limit. Step back or widen the camera, then fit again.':g.config.mode==='antispin'?'Cross center to each outer end matches one staff length. Check the center after a full cycle.':this.sizeOnly?'Guide diameter / width matches the visible staff length.':'Center and size fitted. Adjust Size for your intended pattern.';return patch;
 }
}
