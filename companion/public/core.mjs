// Browser counterpart of Geometry.kt / Perspective.kt / StaffTracker.kt.
// Shared fixture tests compare this implementation with the native engine.
import {filterStaffColors,staffColorNames} from './staff-colors.mjs';
import {recoverSelectedColorEndpoints} from './selected-color-recovery.mjs';
import {attachCapEvidence} from './cap-evidence.mjs';
import {CapOcclusionGuard} from './cap-occlusion.mjs';
export const defaults = {
  mode: "grid", led: true, staffColors: [], threshold: 175, minLength: .22, cx: .5, cy: .5,
  scale: .32, rotation: 0, cubeDepth: .4, circleSeparation: 1, tolerance: 4,
  streakEffects: true, trackingGraceMs: 1500, alignmentGraceMs: 200,
  pacerEnabled: false, pacerRpm: 20, pacerDirection: "cw", pacerPattern: "opposite",
  pacerOffset: 0, pacerCountdown: 3, pacerDotSize: 16,
  diagonals: true, trails: true, showGuide: true, showFeedback: true, symmetry: true,
  facing: "front", fps: 60, timing: "tog-same", ratio: "1:1", zoom: 0, mirror: true,
  tempoSource: "manual", audioRate: 1, audioOffsetMs: 0,
  staffCount: 2, autoFit: false, tempoEnabled: false, bpm: 120, beatPoints: 4,
  planeCorners: [], planeAspect: 1, calibrationRotation: 0, calibrationImageAspect: 0,
};
export const add = (a,b) => [a[0]+b[0],a[1]+b[1]];
export const sub = (a,b) => [a[0]-b[0],a[1]-b[1]];
export const mul = (a,s) => [a[0]*s,a[1]*s];
export const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
export const center = s => mul(add(s.a,s.b),.5);
export const length = s => distance(s.a,s.b);
export const angle = s => Math.atan2(s.b[1]-s.a[1],s.b[0]-s.a[0]);
export const angleDifference = (a,b) => Math.abs(Math.atan2(Math.sin(2*(a-b)),Math.cos(2*(a-b))))/2;
const clamp = (n,lo,hi) => Math.min(hi,Math.max(lo,n));
export function nearestOnSegment(p,s) {
  const d=sub(s.b,s.a), t=clamp(((p[0]-s.a[0])*d[0]+(p[1]-s.a[1])*d[1])/Math.max(1e-12,d[0]**2+d[1]**2),0,1);
  return add(s.a,mul(d,t));
}
export const distanceToSegment = (p,s) => distance(p,nearestOnSegment(p,s));
const segment = (a,b,confidence=1) => ({a,b,confidence});
const mean = values => values.reduce((a,b)=>a+b,0)/values.length;
const minimum = (values,score) => values.reduce((a,b)=>score(a)<=score(b)?a:b);

export function validateCorners(points) {
  if (!points.length) return;
  if (points.length!==4 || points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1))) throw Error("Choose four corners inside the image");
  let area=0;
  for(let i=0;i<4;i++) {
    const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];
    if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<=.002 || distance(a,b)<=.04)
      throw Error("Tap top left, top right, bottom right, bottom left around a clear rectangle");
    area+=a[0]*b[1]-a[1]*b[0];
  }
  if(area/2<.04) throw Error("Choose a larger practice plane");
}
export function patchConfig(previous,patch,{restore=false}={}) {
  const c={trackingGraceMs:defaults.trackingGraceMs,alignmentGraceMs:defaults.alignmentGraceMs,
    pacerEnabled:defaults.pacerEnabled,pacerRpm:defaults.pacerRpm,pacerDirection:defaults.pacerDirection,pacerPattern:defaults.pacerPattern,
    pacerOffset:defaults.pacerOffset,pacerCountdown:defaults.pacerCountdown,pacerDotSize:defaults.pacerDotSize,...previous,...patch,autoFit:false}; // Legacy startup fitting is now manual only.
  if(!Array.isArray(c.staffColors)||c.staffColors.length>staffColorNames.length||c.staffColors.some(color=>!staffColorNames.includes(color)))throw Error('Choose valid staff colors');
  c.staffColors=[...new Set(c.staffColors)];
  const ranges={pacerRpm:[5,120],pacerOffset:[0,180],pacerCountdown:[0,10],pacerDotSize:[8,28],trackingGraceMs:[0,3000],alignmentGraceMs:[0,1000],audioOffsetMs:[-500,500],bpm:[30,240],threshold:[60,250],minLength:[.1,.8],cx:[.1,.9],cy:[.1,.9],scale:[.1,.48],rotation:[-90,90],cubeDepth:[.1,.9],circleSeparation:[0,1.8],tolerance:[1,50],zoom:[0,100],planeAspect:[.25,4],calibrationRotation:[0,3],calibrationImageAspect:[0,4]};
  for(const [key,[lo,hi]] of Object.entries(ranges)) if(!Number.isFinite(c[key])||c[key]<lo||c[key]>hi) throw Error(`${key} must be between ${lo} and ${hi}`);
  for(const key of ['trackingGraceMs','alignmentGraceMs'])if(!Number.isInteger(c[key]))throw Error(`${key} must be whole milliseconds`);
  if(!Number.isInteger(c.pacerCountdown))throw Error('pacerCountdown must be whole seconds');
  for(const [key,choices] of Object.entries({pacerDirection:["cw","ccw"],pacerPattern:["same","opposite"],tempoSource:["manual","phone","pc"],audioRate:[.5,1,2],staffCount:[1,2],beatPoints:[2,4,8],mode:["grid","circles","cube","free","antispin"],facing:["front","back"],fps:[30,60],timing:["tog-same","split-same","tog-opp","split-opp"],ratio:["1:1","1:3","1:5"]})) if(!choices.includes(c[key])) throw Error(`Invalid ${key}`);
  if(c.mode==='antispin')c.staffCount=1;
  for(const key of ["pacerEnabled","streakEffects","autoFit","tempoEnabled","led","diagonals","trails","showGuide","showFeedback","symmetry","mirror"]) if(typeof c[key]!=="boolean") throw Error(`Invalid ${key}`);
  if(!restore&&(c.facing!==previous.facing||c.zoom!==previous.zoom||c.mirror!==previous.mirror))c.planeCorners=[];
  if(!restore&&c.facing!==previous.facing)c.zoom=0;
  validateCorners(c.planeCorners);
  return c;
}
export function homography(from,to) {
  const rows=from.flatMap((p,i)=>{const q=to[i];return [[p[0],p[1],1,0,0,0,-q[0]*p[0],-q[0]*p[1],q[0]],[0,0,0,p[0],p[1],1,-q[1]*p[0],-q[1]*p[1],q[1]]];});
  for(let col=0;col<8;col++) {
    let pivot=col;for(let i=col+1;i<8;i++)if(Math.abs(rows[i][col])>Math.abs(rows[pivot][col]))pivot=i;
    if(Math.abs(rows[pivot][col])<1e-9)throw Error("Calibration corners are too close or aligned");
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
    const divisor=rows[col][col];for(let j=col;j<9;j++)rows[col][j]/=divisor;
    for(let i=0;i<8;i++)if(i!==col){const f=rows[i][col];for(let j=col;j<9;j++)rows[i][j]-=f*rows[col][j];}
  }
  const h=rows.map(r=>r[8]);
  return p=>{const d=h[6]*p[0]+h[7]*p[1]+1;if(!Number.isFinite(d)||Math.abs(d)<1e-8)return null;const q=[(h[0]*p[0]+h[1]*p[1]+h[2])/d,(h[3]*p[0]+h[4]*p[1]+h[5])/d];return q.every(Number.isFinite)?q:null;};
}
export class Guide {
  constructor(config,width,height) {
    this.config=config;this.width=width;this.height=height;
    const u=Math.min(width,height);this.aspectX=width/u;this.aspectY=height/u;
    this.calibrated=config.planeCorners.length>0;
    this.planeX=this.calibrated?Math.max(1,config.planeAspect):this.aspectX;
    this.planeY=this.calibrated?Math.max(1,1/config.planeAspect):this.aspectY;
    this.center=[config.cx*this.planeX,config.cy*this.planeY];this.radius=config.scale;
    if(this.calibrated){const plane=[[0,0],[this.planeX,0],[this.planeX,this.planeY],[0,this.planeY]],image=config.planeCorners.map(p=>[p[0]*this.aspectX,p[1]*this.aspectY]);this.projection=homography(plane,image);this.inverse=homography(image,plane);}
    const square=[[-1,-1],[1,-1],[1,1],[-1,1]];
    this.vertices=config.mode==="cube"?[-.5,.5].flatMap(z=>square.map(p=>this.point(p[0]+z*config.cubeDepth,p[1]-z*config.cubeDepth))):[-1,0,1].flatMap(x=>[-1,0,1].map(y=>this.point(x,y)));
    this.lines=[];
    if(config.mode==="antispin"){
      this.lines=[segment(this.point(-1,0),this.point(1,0)),segment(this.point(0,-1),this.point(0,1))];
    }else if(config.mode==="grid"){
      for(let i=-1;i<=1;i++)this.lines.push(segment(this.point(i,-1),this.point(i,1)),segment(this.point(-1,i),this.point(1,i)));
      if(config.diagonals)this.lines.push(segment(this.point(-1,-1),this.point(1,1)),segment(this.point(-1,1),this.point(1,-1)));
    }else if(config.mode==="cube"){
      for(let z=0;z<2;z++)for(let i=0;i<4;i++)this.lines.push(segment(this.vertices[z*4+i],this.vertices[z*4+(i+1)%4]));
      for(let i=0;i<4;i++)this.lines.push(segment(this.vertices[i],this.vertices[i+4]));
    }
    this.circles=config.staffCount===1?[this.center]:[this.point(-config.circleSeparation/2,0),this.point(config.circleSeparation/2,0)];
  }
  point(x,y){const r=this.config.rotation*Math.PI/180;return add(this.center,mul([x*Math.cos(r)-y*Math.sin(r),x*Math.sin(r)+y*Math.cos(r)],this.radius));}
  project(p){return this.projection?.(p)||p;}
  rectify(s){
    if(!this.calibrated)return s;
    if(Math.abs(this.width/this.height-this.config.calibrationImageAspect)>.03)return null;
    const a=this.inverse(s.a),b=this.inverse(s.b);
    if([a,b].some(p=>!p||p[0]<-1e-6||p[0]>this.planeX+1e-6||p[1]<-1e-6||p[1]>this.planeY+1e-6))return null;
    return {...s,a,b};
  }
  target(p){
    if(["grid","antispin"].includes(this.config.mode))return minimum(this.lines.map(s=>nearestOnSegment(p,s)),q=>distance(p,q));
    if(this.config.mode==="cube")return minimum(this.vertices,q=>distance(p,q));
    return minimum(this.circles.map(c=>{const d=sub(p,c),len=Math.hypot(...d);return add(c,mul(len<1e-9?[1,0]:mul(d,1/len),this.radius));}),q=>distance(p,q));
  }
  deviation(p){return this.config.mode==="free"?0:distance(p,this.target(p));}
  cues(staffs){
    staffs=staffs.slice(0,this.config.staffCount);
    if(this.config.mode==="free"||staffs.length!==this.config.staffCount||staffs.some(s=>!s||s.confidence<.55||s.blurred||s.occluded))return [];
    const measured=staffs.map(s=>this.rectify(s));if(measured.some(s=>!s))return [];
    return measured.flatMap((s,i)=>{const axes=this.config.mode==='antispin'?this.antispinAxes(s):null;return [s.a,s.b].map((p,j)=>{const target=axes?nearestOnSegment(p,this.lines[axes[j]]):this.target(p),error=distance(p,target)/(2*this.radius)*100;return {tip:j?staffs[i].b:staffs[i].a,target:this.project(target),error,onTarget:error<=this.config.tolerance,...(axes?{axis:axes[j]?'vertical':'horizontal'}:{})};});});
  }
  antispinAxes(s){
    const cost=(a,b)=>distanceToSegment(s.a,this.lines[a])**2+distanceToSegment(s.b,this.lines[b])**2;
    return cost(0,1)<=cost(1,0)?[0,1]:[1,0];
  }
  antispinTips(s){return this.antispinAxes(s)[0]===0?[s.a,s.b]:[s.b,s.a];}
  local(p){const d=sub(p,this.center),r=this.config.rotation*Math.PI/180;return [d[0]*Math.cos(r)+d[1]*Math.sin(r),-d[0]*Math.sin(r)+d[1]*Math.cos(r)];}
  json(){return {
    lines:this.lines.map(s=>({...s,a:this.project(s.a),b:this.project(s.b)})),
    vertices:["grid","cube"].includes(this.config.mode)?this.vertices.map(p=>this.project(p)):[],circles:[],
    paths:this.config.mode==="circles"?this.circles.map(c=>Array.from({length:97},(_,i)=>{const a=i*2*Math.PI/96;return this.project(add(c,mul([Math.cos(a),Math.sin(a)],this.radius)));})):[],
    center:this.project(this.center),span:2*this.radius,aspectX:this.aspectX,aspectY:this.aspectY,calibrated:this.calibrated,
  };}
}
export class Scorer {
  constructor(){this.reset();}
  reset(){this.history=[];}
  score(time,staffs,g){
    const measured=staffs.slice(0,g.config.staffCount).map(s=>s?g.rectify(s):null);this.history.push([time,measured]);this.history=this.history.filter(x=>time-x[0]<=1200);
    const valid=s=>s&&s.confidence>=.55&&!s.blurred&&!s.occluded,good=measured.filter(valid),coverage=this.history.filter(x=>x[1].filter(valid).length===g.config.staffCount).length/this.history.length*100;
    const result={deviation:null,angle:null,symmetry:null,steadiness:null,coverage};if(good.length!==g.config.staffCount)return result;
    if(g.config.mode!=="free")result.deviation=g.config.mode==='antispin'?Math.sqrt(mean(g.cues(staffs).map(c=>c.error**2))):Math.sqrt(mean(good.flatMap(s=>[s.a,s.b]).map(p=>g.deviation(p)**2)))/(2*g.radius)*100;
    if(g.lines.length&&g.config.mode!=='antispin')result.angle=mean(good.map(s=>Math.min(...g.lines.map(l=>angleDifference(angle(s),angle(l))*180/Math.PI))));
    const r=g.config.rotation*Math.PI/180;
    const reflect=p=>{const d=sub(p,g.center),x=d[0]*Math.cos(r)+d[1]*Math.sin(r),y=-d[0]*Math.sin(r)+d[1]*Math.cos(r);return add(g.center,[-x*Math.cos(r)-y*Math.sin(r),-x*Math.sin(r)+y*Math.cos(r)]);};
    const [a,b]=good;
    if(g.config.symmetry&&g.config.staffCount===2)result.symmetry=Math.sqrt(Math.min(distance(reflect(a.a),b.a)**2+distance(reflect(a.b),b.b)**2,distance(reflect(a.a),b.b)**2+distance(reflect(a.b),b.a)**2)/2)/(2*g.radius)*100;
    const speeds=[];
    for(let i=1;i<this.history.length;i++){
      const prev=this.history[i-1],next=this.history[i],dt=(next[0]-prev[0])/1000;
      if(dt<=0||dt>.15||[...prev[1],...next[1]].some(s=>!valid(s)))continue;
      speeds.push(mean(Array.from({length:g.config.staffCount},(_,n)=>angleDifference(angle(next[1][n]),angle(prev[1][n]))/dt)));
    }
    const avg=speeds.length?mean(speeds):0;
    if(speeds.length>=12&&avg>.15&&coverage>=90)result.steadiness=Math.sqrt(mean(speeds.map(s=>(s-avg)**2)))/avg*100;
    return result;
  }
}

// Recover visible end caps from the bright shaft inside a larger colored glow.
// This uses only current pixels. A broad exposure fan, a clipped end, or two
// isolated lights without enough shaft support cannot become a precise staff.
function glowBodyEndpoints(argb,w,h,s){
 const unit=Math.min(w,h),len=length(s)*unit;if(len<24)return null;
 const ax=s.a[0]*unit,ay=s.a[1]*unit,bx=s.b[0]*unit,by=s.b[1]*unit,dx=(bx-ax)/len,dy=(by-ay)/len;
 // The uncertain halo/previous-length outline may cross the edge. Test the observed core instead.
 const margin=Math.min(unit*.12,len*.18),points=[];let peak=0;
 for(let y=Math.max(1,Math.floor(Math.min(ay,by)-margin));y<=Math.min(h-2,Math.ceil(Math.max(ay,by)+margin));y++)for(let x=Math.max(1,Math.floor(Math.min(ax,bx)-margin));x<=Math.min(w-2,Math.ceil(Math.max(ax,bx)+margin));x++){
  const along=(x-ax)*dx+(y-ay)*dy,across=-(x-ax)*dy+(y-ay)*dx;
  if(along<-len*.06||along>len*1.06||Math.abs(across)>margin)continue;
  const p=argb[y*w+x],hi=Math.max(p>>>16&255,p>>>8&255,p&255),lo=Math.min(p>>>16&255,p>>>8&255,p&255),light=lo+(hi-lo)*.25;
  if(hi<80)continue;points.push([x,y,light]);peak=Math.max(peak,light);
 }
 if(peak<45)return null;
 const floor=peak*.72,remaining=new Map(points.filter(p=>p[2]>=floor).map(p=>[p[1]*w+p[0],p])),parts=[];
 // Isolate the shaft's bright connected pieces before measuring its ends.
 // Small detached reflections must not stretch an endpoint into the backdrop.
 while(remaining.size){const first=remaining.keys().next().value,queue=[first],part=[remaining.get(first)];remaining.delete(first);
  for(let n=0;n<queue.length;n++)for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
   const i=queue[n]+oy*w+ox,p=remaining.get(i);if(p){remaining.delete(i);queue.push(i);part.push(p);}
  }
  if(part.length>=6)parts.push(part);
 }
 parts.sort((a,b)=>b.length-a.length);const core=parts.slice(0,2).flat();if(core.length<18||core.some(p=>p[0]<2||p[1]<2||p[0]>=w-2||p[1]>=h-2))return null;
 let mass=0,mx=0,my=0;for(const [x,y,v] of core){mass+=v;mx+=x*v;my+=y*v;}mx/=mass;my/=mass;
 let xx=0,xy=0,yy=0;for(const [x,y,v] of core){xx+=(x-mx)**2*v;xy+=(x-mx)*(y-my)*v;yy+=(y-my)**2*v;}xx/=mass;xy/=mass;yy/=mass;
 const theta=.5*Math.atan2(2*xy,xx-yy),ux=Math.cos(theta),uy=Math.sin(theta);
 if(angleDifference(theta,angle(s))>.20)return null;
 let low=Infinity,high=-Infinity;for(const p of core){p[3]=(p[0]-mx)*ux+(p[1]-my)*uy;p[4]=-(p[0]-mx)*uy+(p[1]-my)*ux;low=Math.min(low,p[3]);high=Math.max(high,p[3]);}
 const extent=high-low;if(extent<len*.82||extent>len*1.12)return null;
 const bins=Array.from({length:16},()=>({mass:0,side:0,square:0,count:0}));
 for(const p of core){const b=bins[Math.min(15,Math.floor((p[3]-low)/extent*16))];b.mass+=p[2];b.side+=p[4]*p[2];b.square+=p[4]**2*p[2];b.count++;}
 const errorLimit=Math.max(1.5,Math.min(unit*.04,extent*.065));
 // Saturated blue/rainbow shafts are darker in white-core luminance than their
 // overexposed caps. Confirm the connecting body at a lower threshold, while
 // measuring cap position and spread only from the bright connected pieces.
 const support=new Int32Array(16);
 for(const p of points){
  if(p[2]<Math.max(45,peak*.28))continue;
  const along=(p[0]-mx)*ux+(p[1]-my)*uy,side=-(p[0]-mx)*uy+(p[1]-my)*ux;
  if(along<low||along>high||Math.abs(side)>errorLimit*.5)continue;
  support[Math.min(15,Math.floor((along-low)/extent*16))]++;
 }
 const supported=b=>b.count>=2;
 if(support.slice(0,6).filter(n=>n>=2).length<4||support.slice(10).filter(n=>n>=2).length<4||support.filter(n=>n>=2).length<10)return null;
 for(const end of [bins.slice(0,3),bins.slice(13)]){
  const mass=end.reduce((n,b)=>n+b.mass,0),side=end.reduce((n,b)=>n+b.side,0)/mass;
  const variance=end.reduce((n,b)=>n+b.square,0)/mass-side**2;
  if(!mass||2*Math.sqrt(Math.max(0,variance))>errorLimit||Math.abs(side)>errorLimit)return null;
 }
 // A curved crescent can have narrow tips but no single straight shaft.
 if(bins.filter(supported).some(b=>Math.abs(b.side/b.mass)>errorLimit))return null;
 // Locate each actual cap across the shaft, rather than projecting an end
 // onto the overall axis (which can miss a cap when the glow is asymmetric).
 const caps=[low,high].map(edge=>{
  const points=core.filter(p=>Math.abs(p[3]-edge)<=Math.min(3,extent*.03));
  if(points.length<3)return null;
  const mass=points.reduce((n,p)=>n+p[2],0),side=points.reduce((n,p)=>n+p[4]*p[2],0)/mass;
  return [(mx+ux*edge-uy*side)/unit,(my+uy*edge+ux*side)/unit];
 });
 const [a,b]=caps;if(!a||!b)return null;
 if(Math.min(...a,...b)<2/unit||Math.max(a[0],b[0])>(w-3)/unit||Math.max(a[1],b[1])>(h-3)/unit)return null;
 return {a,b,confidence:.7,blurred:false};
}

export class StaffDetector {
  constructor(){this.cosines=Array.from({length:180},(_,i)=>Math.cos(i*Math.PI/180));this.sines=Array.from({length:180},(_,i)=>Math.sin(i*Math.PI/180));}
  detect(argb,w,h,c,hints=[]){
    if(argb.length!==w*h||w<1||h<1)throw Error("Invalid camera pixels");
    const original=argb;
    if(c.led)argb=filterStaffColors(argb,w,h,c.staffColors);
    const finish=found=>{
      // Keep the user threshold for discovery; recovery needs sharper bright geometry.
      const recovered=recoverSelectedColorEndpoints(argb,w,h,c,found,()=>this.detect(original,w,h,{...c,staffColors:[],threshold:Math.max(c.threshold,250)},hints));
      return c.led?recovered.map(s=>attachCapEvidence(original,w,h,s)):recovered;
    };
    if(c.led){const lights=ledRegions(argb,w,h,c,hints),recovered=lights.paired&&lights.segments.every(s=>!hints.length||hints.some(p=>length(s)>length(p)*.85))?lights.segments:motionCandidates(argb,w,h,c,hints,lights.segments);if(recovered.length||c.staffCount===1||!lights.crossing)return finish(recovered.map(s=>s.blurred?(glowBodyEndpoints(argb,w,h,s)??s):s));}
    const short=Math.min(w,h),mask=new Uint8Array(w*h),value=i=>{const p=argb[i];return Math.max((p>>>16)&255,(p>>>8)&255,p&255);};
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x,p=argb[i],hi=value(i),lo=Math.min((p>>>16)&255,(p>>>8)&255,p&255);
      mask[i]=c.led?hi>=c.threshold&&(hi-lo>35||hi>=Math.min(250,c.threshold+35)):Math.abs(value(i+1)-value(i-1))+Math.abs(value(i+w)-value(i-w))>c.threshold/2;
    }
    const pixels=[];for(let y=4;y<h-4;y++)for(let x=4;x<w-4;x++){const i=y*w+x;if(mask[i]&&(!mask[i-1]||!mask[i+1]||!mask[i-w]||!mask[i+w]))pixels.push([x,y]);}
    if(pixels.length<12)return finish(c.led?motionCandidates(argb,w,h,c,hints,[]):[]);
    const step=Math.max(1,Math.floor((pixels.length+3499)/3500)),diag=Math.ceil(Math.hypot(w,h)),bins=2*diag+1,votes=new Int32Array(180*bins);
    for(let i=0;i<pixels.length;i+=step){const p=pixels[i];for(let a=0;a<180;a++)votes[a*bins+Math.round(p[0]*this.cosines[a]+p[1]*this.sines[a])+diag]++;}
    const result=[];
    for(let attempt=0;attempt<28;attempt++){
      let maxIndex=0;for(let i=0;i<votes.length;i++)if(votes[i]>votes[maxIndex])maxIndex=i;
      const peak=votes[maxIndex],a=Math.floor(maxIndex/bins),rho=maxIndex%bins-diag;
      if(peak<Math.max(9,Math.trunc(c.minLength*short/step*.3)))break;
      for(let da=-3;da<=3;da++)for(let dr=-7;dr<=7;dr++){const raw=a+da,aa=(raw+180)%180,rr=(raw<0||raw>=180?-rho:rho)+dr+diag;if(rr>=0&&rr<bins)votes[aa*bins+rr]=0;}
      const n=[this.cosines[a],this.sines[a]],d=[-n[1],n[0]],projections=pixels.filter(p=>Math.abs(p[0]*n[0]+p[1]*n[1]-rho)<5).map(p=>p[0]*d[0]+p[1]*d[1]).sort((a,b)=>a-b);
      if(projections.length<12)continue;
      let start=0,bestStart=0,bestEnd=0;
      for(let i=1;i<=projections.length;i++)if(i===projections.length||projections[i]-projections[i-1]>short*.10){if(projections[i-1]-projections[start]>projections[bestEnd]-projections[bestStart]){bestStart=start;bestEnd=i-1;}start=i;}
      const low=projections[bestStart],high=projections[bestEnd],len=high-low;if(len<short*c.minLength)continue;
      const aa=add(mul(n,rho),mul(d,low)),bb=add(mul(n,rho),mul(d,high)),steps=Math.max(8,Math.floor(Math.trunc(len)/2));
      let covered=0,narrow=0,thickness=0;
      for(let i=0;i<=steps;i++){
        const p=add(aa,mul(sub(bb,aa),i/steps));let across=0;
        const masked=off=>{const q=add(p,mul(n,off)),x=Math.round(q[0]),y=Math.round(q[1]);return x>=0&&x<w&&y>=0&&y<h&&mask[y*w+x];};
        for(let off=-9;off<=9;off++)if(masked(off))across++;
        if(across>0)covered++;if(across>0&&!masked(-12)&&!masked(12))narrow++;thickness+=across;
      }
      const support=covered/(steps+1),meanThickness=thickness/(steps+1);
      if(support<.62||narrow/(steps+1)<.55||meanThickness>15||len/(meanThickness+1)<7)continue;
      const s=segment(mul(aa,1/short),mul(bb,1/short),clamp(support*.9+.1*Math.min(1,len/(short*.6)),0,1));
      if(!result.some(old=>angleDifference(angle(old),angle(s))<.14&&(distanceToSegment(center(s),old)<.035||distanceToSegment(center(old),s)<.035)))result.push(s);
    }
    return finish((c.led?motionCandidates(argb,w,h,c,hints,result):result).sort((a,b)=>b.confidence*Math.sqrt(length(b))-a.confidence*Math.sqrt(length(a))).slice(0,8));
  }
}

// Pair the observed luminous halves across a dark grip. Work without a fixed hue:
// rainbow LEDs change color, while their bright geometry remains observable.
function ledRegions(argb,w,h,c,hints){
 const unit=Math.min(w,h),mask=new Uint8Array(w*h),queue=new Int32Array(w*h),weights=new Float64Array(w*h);
 for(let i=0;i<mask.length;i++){const p=argb[i],hi=Math.max(p>>>16&255,p>>>8&255,p&255),lo=Math.min(p>>>16&255,p>>>8&255,p&255);if(hi>=c.threshold&&(hi-lo>35||hi>=Math.min(250,c.threshold+35))){mask[i]=1;weights[i]=hi;}}
 const describe=points=>{
  let mass=0,mx=0,my=0,color=0;for(const i of points){const v=weights[i],p=argb[i];mass+=v;mx+=i%w*v;my+=Math.floor(i/w)*v;if(Math.max(p>>>16&255,p>>>8&255,p&255)-Math.min(p>>>16&255,p>>>8&255,p&255)>35)color++;}mx/=mass;my/=mass;
  let xx=0,xy=0,yy=0;for(const i of points){const x=i%w-mx,y=Math.floor(i/w)-my,v=weights[i];xx+=x*x*v;xy+=x*y*v;yy+=y*y*v;}xx/=mass;xy/=mass;yy/=mass;
  const theta=.5*Math.atan2(2*xy,xx-yy),dx=Math.cos(theta),dy=Math.sin(theta),spread=Math.hypot(xx-yy,2*xy),major=(xx+yy+spread)/2,minor=Math.max(0,(xx+yy-spread)/2);
  let low=Infinity,high=-Infinity;for(const i of points){const a=(i%w-mx)*dx+(Math.floor(i/w)-my)*dy;low=Math.min(low,a);high=Math.max(high,a);}
  const ratio=minor/Math.max(1,major),clipped=points.some(i=>i%w<2||i%w>=w-2||Math.floor(i/w)<2||Math.floor(i/w)>=h-2),blurred=ratio>.008||clipped;
  return {points,color:color/points.length,ratio,clipped,mid:[mx/unit,my/unit],s:{a:[(mx+dx*low)/unit,(my+dy*low)/unit],b:[(mx+dx*high)/unit,(my+dy*high)/unit],confidence:blurred?.5:.8,blurred}};
 };
 const regions=[];
 for(let i=0;i<mask.length;i++)if(mask[i]){let head=0,tail=1;queue[0]=i;mask[i]=0;const points=[];while(head<tail){const at=queue[head++];points.push(at);const x=at%w,y=Math.floor(at/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,k=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[k]){mask[k]=0;queue[tail++]=k;}}}if(points.length>=8&&points.length<w*h*.12)regions.push(describe(points));}
 regions.sort((a,b)=>b.points.length-a.points.length);regions.splice(24);
 const candidates=[];
 for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++){
  const a=regions[i],b=regions[j],axis=Math.atan2(b.mid[1]-a.mid[1],b.mid[0]-a.mid[0]);
  if(Math.min(a.points.length,b.points.length)<Math.max(a.points.length,b.points.length)*.12)continue;
  if((a.ratio<.12&&angleDifference(angle(a.s),axis)>.45)||(b.ratio<.12&&angleDifference(angle(b.s),axis)>.45))continue;
  const merged=describe([...a.points,...b.points]),s=merged.s,len=length(s),gap=distance(a.mid,b.mid)-(length(a.s)+length(b.s))/2;
  if(len<c.minLength||len>1.65||merged.ratio>.16||gap>len*.48)continue;
  if(Math.min(a.color,b.color)<.18&&(a.ratio>.008||b.ratio>.008||a.clipped||b.clipped)&&!hints.some(p=>distance(center(s),center(p))<.15&&len>length(p)*.72&&len<length(p)*1.35))continue;
  candidates.push({s,points:merged.points,complete:true,rank:Math.sqrt(a.points.length*b.points.length)*Math.sqrt(len)/(1+merged.ratio*4)});
 }
 for(const r of regions)if(length(r.s)>=c.minLength&&((r.ratio<.008&&!r.clipped)||(r.ratio<.12&&r.color>.35))){
  candidates.push({s:r.s,points:r.points,complete:r.s.blurred,rank:r.points.length*.5*Math.sqrt(length(r.s))/(1+r.ratio*4)});
 }
 // Prefer full staffs over bright room edges. Half-staff pairs are exclusive.
 candidates.sort((a,b)=>b.rank-a.rank);const selected=[],used=new Set();let complete=false;
 for(const candidate of candidates){if(candidate.points.some(i=>used.has(i)))continue;selected.push(candidate.s);complete||=candidate.complete;candidate.points.forEach(i=>used.add(i));if(selected.length===c.staffCount)break;}
 return {segments:selected,paired:complete,crossing:regions.some(r=>r.ratio>.12&&r.color>.5&&r.points.length>c.minLength*unit*6)};
}

// A long exposure spreads LED energy into a dim fan. Fit its observed light mass,
// only near an already tracked staff. Never turn that uncertain axis into a score.
function motionCandidates(argb,w,h,c,hints,sharp){
 if(!hints.length)return sharp;
 const short=Math.min(w,h),histogram=new Int32Array(256),mask=new Uint8Array(w*h),weights=new Float64Array(w*h),queue=new Int32Array(w*h);let samples=0;
 for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2)if(hints.some(s=>distance([x/short,y/short],center(s))<length(s)*.7+.12)){const p=argb[y*w+x];histogram[Math.max(p>>>16&255,p>>>8&255,p&255)]++;samples++;}
 let median=0,total=0;while(median<255&&(total+=histogram[median])<samples/2)median++;
 const floor=Math.max(24,c.threshold*.14,median+6);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x,p=argb[i],hi=Math.max((p>>>16)&255,(p>>>8)&255,p&255),lo=Math.min((p>>>16)&255,(p>>>8)&255,p&255);
  if(hi<floor||!(hi-lo>Math.max(10,hi*.14)||hi>Math.max(50,c.threshold*.3)))continue;
  if(!hints.some(s=>distance([x/short,y/short],center(s))<length(s)*.7+.12))continue;
  mask[i]=1;weights[i]=Math.max(1,hi-(hi-lo>12?lo:floor));
 }
 const describe=points=>{
  let mass=0,mx=0,my=0;for(const i of points){const v=weights[i];mass+=v;mx+=(i%w)*v;my+=Math.floor(i/w)*v;}mx/=mass;my/=mass;
  let xx=0,xy=0,yy=0;for(const i of points){const dx=i%w-mx,dy=Math.floor(i/w)-my,v=weights[i];xx+=dx*dx*v;xy+=dx*dy*v;yy+=dy*dy*v;}xx/=mass;xy/=mass;yy/=mass;
  const theta=.5*Math.atan2(2*xy,xx-yy),dx=Math.cos(theta),dy=Math.sin(theta),spread=Math.hypot(xx-yy,2*xy),major=(xx+yy+spread)/2,minor=Math.max(0,(xx+yy-spread)/2);
  let low=Infinity,high=-Infinity;for(const i of points){const along=(i%w-mx)*dx+(Math.floor(i/w)-my)*dy;low=Math.min(low,along);high=Math.max(high,along);}
  const ratio=minor/Math.max(1,major),blurred=ratio>.006;
  return {points,ratio,s:{a:[(mx+dx*low)/short,(my+dy*low)/short],b:[(mx+dx*high)/short,(my+dy*high)/short],confidence:blurred?.5:.7,blurred}};
 };
 const components=[];
 for(let i=0;i<mask.length;i++)if(mask[i]){
  let head=0,tail=1;queue[0]=i;mask[i]=0;const points=[];
  while(head<tail){const at=queue[head++];points.push(at);const x=at%w,y=Math.floor(at/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,next=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[next]){mask[next]=0;queue[tail++]=next;}}}
  if(points.length>=12&&points.length<w*h*.18)components.push(describe(points));
 }
 // A dark hand/grip can split the two luminous halves. Join only nearby collinear regions.
 components.sort((a,b)=>b.points.length-a.points.length);components.splice(24);
 for(let i=0;i<components.length;i++)for(let j=i+1;j<components.length;j++){
  const a=components[i],b=components[j];
  const owner=s=>hints.reduce((best,p,n)=>distance(center(s),center(p))<distance(center(s),center(hints[best]))?n:best,0);
  if(owner(a.s)!==owner(b.s))continue;
  const d=sub(center(b.s),center(a.s)),axis=Math.atan2(d[1],d[0]);
  if(a.ratio<.12&&angleDifference(angle(a.s),axis)>.45||b.ratio<.12&&angleDifference(angle(b.s),axis)>.45)continue;
  const joined=describe([...a.points,...b.points]);if(joined.ratio>.14||distance(center(a.s),center(b.s))-(length(a.s)+length(b.s))/2>length(joined.s)*.48||!hints.some(s=>length(joined.s)<length(s)*1.2))continue;
  components[i]=joined;components.splice(j--,1);
 }
 let result=[...sharp];
 for(const component of components){
  let s=component.s;const len=length(s);
  if(component.ratio>.14||len<c.minLength||!hints.some(p=>len>=length(p)*.72&&len<=length(p)*1.2&&distance(center(s),center(p))<.12+length(p)*.25&&angleDifference(angle(s),angle(p))<1.4))continue;
  // Broad blur observes an axis, not exact ends. Retain the recent length for a
  // stable uncertain outline instead of chasing whichever rainbow tip is brightest.
  if(s.blurred){const reference=minimum(hints,p=>distance(center(s),center(p))+angleDifference(angle(s),angle(p))*.1),axis=angle(s),unit=[Math.cos(axis),Math.sin(axis)],d=mul(unit,length(reference)/2);let mid=center(s);
   // If dim light hides an end, its asymmetric extent cannot locate the center
   // along the axis. Keep that part of the recent pose, still explicitly uncertain.
   if(len<length(reference)*.9){const delta=sub(mid,center(reference));mid=sub(mid,mul(unit,delta[0]*unit[0]+delta[1]*unit[1]));}
   s={...s,a:sub(mid,d),b:add(mid,d)};}
  const nearby=old=>distance(center(old),center(s))<.07+len*.12&&length(old)>len*.45&&length(old)<len*1.3&&angleDifference(angle(old),angle(s))<Math.max(.2,3*Math.sqrt(component.ratio));
  if(component.ratio<.003&&result.some(old=>nearby(old)&&length(old)>len*.85))continue;
  result=result.filter(old=>!nearby(old));result.push(s);
 }
 return result;
}
export class StaffTracker {
  constructor(){this.reset();}
  reset(){this.last=[null,null];this.lastAt=[0,0];this.streak=[0,0];this.confirmedAt=[-Infinity,-Infinity];this.motion=[[0,0,0],[0,0,0]];this.updatedAt=null;this.capGuards=[new CapOcclusionGuard(),new CapOcclusionGuard()];this.guardCount=null;}
  seed(staffs,time){if(![1,2].includes(staffs.length))throw Error("Select each staff");this.reset();this.last=[staffs[0],staffs[1]||null];this.lastAt=[time,time];this.updatedAt=time;}
  predicted(i,time){const s=this.last[i];if(!s)return null;const dt=clamp((time-this.lastAt[i])/1000,0,.15),v=this.motion[i],c=add(center(s),[v[0]*dt,v[1]*dt]),a=angle(s)+v[2]*dt,d=mul([Math.cos(a),Math.sin(a)],length(s)/2);return {...s,a:sub(c,d),b:add(c,d)};}
  hints(time,count=2){return this.last.map((s,i)=>i<count&&s&&time>=this.lastAt[i]&&time-this.lastAt[i]<250?this.predicted(i,time):null).filter(Boolean);}
  update(candidates,time,count=2){
    // A restarted/repeated clock cannot supply another independent observation.
    if(this.updatedAt!==null&&time<=this.updatedAt)this.reset();this.updatedAt=time;
    if(this.guardCount!==count){this.capGuards.forEach(guard=>guard.reset());this.guardCount=count;}
    const prior=this.last.map((s,i)=>i<count&&s&&time-this.lastAt[i]<(s.blurred?350:1500)?s:null);
    prior.forEach((s,i)=>{if(!s)this.capGuards[i].reset();});
    for(let i=0;i<prior.length;i++)if(!prior[i]||time-this.lastAt[i]>250){this.streak[i]=0;this.confirmedAt[i]=-Infinity;this.motion[i]=[0,0,0];}
    const cost=(i,s)=>{const p=prior[i];if(!p)return .22-s.confidence*.1;const predicted=this.predicted(i,time),delta=Math.max(1,time-this.lastAt[i])/1000,dist=distance(center(predicted),center(s)),ang=angleDifference(angle(predicted),angle(s)),ratio=length(s)/length(p);if(dist>.16+delta*1.8||ang>.3+delta*20||ratio<.25||ratio>1.4)return 10;return dist+ang*.13+Math.abs(Math.log(ratio))*.10+(1-s.confidence)*.15;};
    const assignments=[];
    for(let a=-1;a<candidates.length;a++)for(let b=-1;b<(count===1?0:candidates.length);b++)if(a<0||b<0||a!==b){
      if(a>=0&&b>=0&&distanceToSegment(center(candidates[a]),candidates[b])<.025&&angleDifference(angle(candidates[a]),angle(candidates[b]))<.15)continue;
      assignments.push([a,b,(a<0?.55:cost(0,candidates[a]))+(b<0?.55:cost(1,candidates[b]))]);
    }
    assignments.sort((a,b)=>a[2]-b[2]);let best=assignments[0];
    if(prior.every(p=>!p)&&best[0]>=0&&best[1]>=0&&center(candidates[best[0]])[0]>center(candidates[best[1]])[0])best=[best[1],best[0],best[2]];
    const ambiguous=prior.every(Boolean)&&best[0]>=0&&best[1]>=0&&assignments.some(a=>a[0]===best[1]&&a[1]===best[0]&&a[2]-best[2]<.035);
    const selected=best.slice(0,2).map((index,i)=>{
      if(index<0){this.confirmedAt[i]=-Infinity;const p=prior[i],established=this.streak[i]>=3;this.streak[i]=0;return p&&(established||p.occluded||p.blurred)?{...p,confidence:.3,occluded:true}:null;}
      let s=candidates[index];const p=prior[i],predicted=p?this.predicted(i,time):null;if(predicted&&distance(predicted.a,s.b)+distance(predicted.b,s.a)<distance(predicted.a,s.a)+distance(predicted.b,s.b))s={...s,a:s.b,b:s.a};
      if(p&&length(s)<length(p)*.72){this.confirmedAt[i]=-Infinity;this.streak[i]=0;return {...s,confidence:.35,occluded:true};}
      // A rejected exposure must not erase the identity of a recently confirmed staff.
      // Only a current, clear, associated observation can resume scoring; predicted/blurred poses never can.
      if(ambiguous)this.confirmedAt[i]=-Infinity;
      if(s.blurred)this.streak[i]=0;else this.streak[i]++;
      const confirmed=!ambiguous&&!s.blurred&&(this.streak[i]>=3||(p&&!p.occluded&&time>=this.confirmedAt[i]&&time-this.confirmedAt[i]<=250));
      if(confirmed)this.confirmedAt[i]=time;
      return {...s,occluded:false,confidence:ambiguous?Math.min(.4,s.confidence):confirmed?s.confidence:Math.min(.5,s.confidence)};
    });
    this.last=selected.map((s,i)=>{if(s&&!ambiguous&&!s.occluded){const p=prior[i],dt=(time-this.lastAt[i])/1000;if(p&&dt>=.008&&dt<=.2){const delta=sub(center(s),center(p)),da=.5*Math.atan2(Math.sin(2*(angle(s)-angle(p))),Math.cos(2*(angle(s)-angle(p))));this.motion[i]=[clamp(delta[0]/dt,-3,3),clamp(delta[1]/dt,-3,3),clamp(da/dt,-30,30)].map((v,j)=>this.motion[i][j]*.35+v*.65);}else this.motion[i]=[0,0,0];this.lastAt[i]=time;return s;}return s?.occluded&&prior[i]?{...prior[i],occluded:true}:prior[i];});
    // Keep current observed coordinates; uncertainty affects scoring, not detector feedback.
    return selected.map((s,i)=>this.capGuards[i].update(s,time));
  }
}
