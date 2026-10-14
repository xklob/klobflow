// Browser counterpart of Geometry.kt / Perspective.kt / StaffTracker.kt.
// Shared fixture tests compare this implementation with the native engine.
export const defaults = {
  mode: "grid", led: true, threshold: 175, minLength: .22, cx: .5, cy: .5,
  scale: .32, rotation: 0, cubeDepth: .4, circleSeparation: 1, tolerance: 4,
  diagonals: true, trails: true, showGuide: true, showFeedback: true, symmetry: true,
  facing: "front", fps: 60, timing: "tog-same", ratio: "1:1", zoom: 0, mirror: true,
  staffCount: 2, autoFit: true, tempoEnabled: false, bpm: 120, beatPoints: 4,
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
  const c={...previous,...patch};
  const ranges={bpm:[30,240],threshold:[60,250],minLength:[.1,.8],cx:[.1,.9],cy:[.1,.9],scale:[.1,.48],rotation:[-90,90],cubeDepth:[.1,.9],circleSeparation:[0,1.8],tolerance:[1,15],zoom:[0,100],planeAspect:[.25,4],calibrationRotation:[0,3],calibrationImageAspect:[0,4]};
  for(const [key,[lo,hi]] of Object.entries(ranges)) if(!Number.isFinite(c[key])||c[key]<lo||c[key]>hi) throw Error(`${key} must be between ${lo} and ${hi}`);
  for(const [key,choices] of Object.entries({staffCount:[1,2],beatPoints:[2,4,8],mode:["grid","circles","cube","free"],facing:["front","back"],fps:[30,60],timing:["tog-same","split-same","tog-opp","split-opp"],ratio:["1:1","1:3","1:5"]})) if(!choices.includes(c[key])) throw Error(`Invalid ${key}`);
  for(const key of ["autoFit","tempoEnabled","led","diagonals","trails","showGuide","showFeedback","symmetry","mirror"]) if(typeof c[key]!=="boolean") throw Error(`Invalid ${key}`);
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
    if(config.mode==="grid"){
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
    if(this.config.mode==="grid")return minimum(this.lines.map(s=>nearestOnSegment(p,s)),q=>distance(p,q));
    if(this.config.mode==="cube")return minimum(this.vertices,q=>distance(p,q));
    return minimum(this.circles.map(c=>{const d=sub(p,c),len=Math.hypot(...d);return add(c,mul(len<1e-9?[1,0]:mul(d,1/len),this.radius));}),q=>distance(p,q));
  }
  deviation(p){return this.config.mode==="free"?0:distance(p,this.target(p));}
  cues(staffs){
    staffs=staffs.slice(0,this.config.staffCount);
    if(this.config.mode==="free"||staffs.length!==this.config.staffCount||staffs.some(s=>!s||s.confidence<.55))return [];
    const measured=staffs.map(s=>this.rectify(s));if(measured.some(s=>!s))return [];
    return measured.flatMap((s,i)=>[s.a,s.b].map((p,j)=>{const target=this.target(p),error=distance(p,target)/(2*this.radius)*100;return {tip:j?staffs[i].b:staffs[i].a,target:this.project(target),error,onTarget:error<=this.config.tolerance};}));
  }
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
    const good=measured.filter(s=>s&&s.confidence>=.55),coverage=this.history.filter(x=>x[1].filter(s=>s&&s.confidence>=.55).length===g.config.staffCount).length/this.history.length*100;
    const result={deviation:null,angle:null,symmetry:null,steadiness:null,coverage};if(good.length!==g.config.staffCount)return result;
    if(g.config.mode!=="free")result.deviation=Math.sqrt(mean(good.flatMap(s=>[s.a,s.b]).map(p=>g.deviation(p)**2)))/(2*g.radius)*100;
    if(g.lines.length)result.angle=mean(good.map(s=>Math.min(...g.lines.map(l=>angleDifference(angle(s),angle(l))*180/Math.PI))));
    const r=g.config.rotation*Math.PI/180;
    const reflect=p=>{const d=sub(p,g.center),x=d[0]*Math.cos(r)+d[1]*Math.sin(r),y=-d[0]*Math.sin(r)+d[1]*Math.cos(r);return add(g.center,[-x*Math.cos(r)-y*Math.sin(r),-x*Math.sin(r)+y*Math.cos(r)]);};
    const [a,b]=good;
    if(g.config.symmetry&&g.config.staffCount===2)result.symmetry=Math.sqrt(Math.min(distance(reflect(a.a),b.a)**2+distance(reflect(a.b),b.b)**2,distance(reflect(a.a),b.b)**2+distance(reflect(a.b),b.a)**2)/2)/(2*g.radius)*100;
    const speeds=[];
    for(let i=1;i<this.history.length;i++){
      const prev=this.history[i-1],next=this.history[i],dt=(next[0]-prev[0])/1000;
      if(dt<=0||dt>.15||[...prev[1],...next[1]].some(s=>!s||s.confidence<.55))continue;
      speeds.push(mean(Array.from({length:g.config.staffCount},(_,n)=>angleDifference(angle(next[1][n]),angle(prev[1][n]))/dt)));
    }
    const avg=speeds.length?mean(speeds):0;
    if(speeds.length>=12&&avg>.15&&coverage>=90)result.steadiness=Math.sqrt(mean(speeds.map(s=>(s-avg)**2)))/avg*100;
    return result;
  }
}

export class StaffDetector {
  constructor(){this.cosines=Array.from({length:180},(_,i)=>Math.cos(i*Math.PI/180));this.sines=Array.from({length:180},(_,i)=>Math.sin(i*Math.PI/180));}
  detect(argb,w,h,c){
    if(argb.length!==w*h||w<1||h<1)throw Error("Invalid camera pixels");
    const short=Math.min(w,h),mask=new Uint8Array(w*h),value=i=>{const p=argb[i];return Math.max((p>>>16)&255,(p>>>8)&255,p&255);};
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x,p=argb[i],hi=value(i),lo=Math.min((p>>>16)&255,(p>>>8)&255,p&255);
      mask[i]=c.led?hi>=c.threshold&&(hi-lo>35||hi>=Math.min(250,c.threshold+35)):Math.abs(value(i+1)-value(i-1))+Math.abs(value(i+w)-value(i-w))>c.threshold/2;
    }
    const pixels=[];for(let y=4;y<h-4;y++)for(let x=4;x<w-4;x++){const i=y*w+x;if(mask[i]&&(!mask[i-1]||!mask[i+1]||!mask[i-w]||!mask[i+w]))pixels.push([x,y]);}
    if(pixels.length<12)return [];
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
    return result.sort((a,b)=>b.confidence*Math.sqrt(length(b))-a.confidence*Math.sqrt(length(a))).slice(0,8);
  }
}
export class StaffTracker {
  constructor(){this.reset();}
  reset(){this.last=[null,null];this.lastAt=[0,0];this.streak=[0,0];}
  seed(staffs,time){if(![1,2].includes(staffs.length))throw Error("Select each staff");this.last=[staffs[0],staffs[1]||null];this.lastAt=[time,time];this.streak=[0,0];}
  update(candidates,time,count=2){
    const prior=this.last.map((s,i)=>i<count&&s&&time-this.lastAt[i]<1500?s:null);
    const cost=(i,s)=>{const p=prior[i];if(!p)return .22-s.confidence*.1;const delta=Math.max(1,time-this.lastAt[i])/1000,dist=distance(center(p),center(s)),ang=angleDifference(angle(p),angle(s)),ratio=length(s)/length(p);if(dist>.16+delta*1.8||ang>.3+delta*8||ratio<.25||ratio>1.9)return 10;return dist+ang*.13+Math.abs(Math.log(ratio))*.10+(1-s.confidence)*.15;};
    const assignments=[];
    for(let a=-1;a<candidates.length;a++)for(let b=-1;b<(count===1?0:candidates.length);b++)if(a<0||b<0||a!==b){
      if(a>=0&&b>=0&&distanceToSegment(center(candidates[a]),candidates[b])<.025&&angleDifference(angle(candidates[a]),angle(candidates[b]))<.15)continue;
      assignments.push([a,b,(a<0?.55:cost(0,candidates[a]))+(b<0?.55:cost(1,candidates[b]))]);
    }
    assignments.sort((a,b)=>a[2]-b[2]);let best=assignments[0];
    if(prior.every(p=>!p)&&best[0]>=0&&best[1]>=0&&center(candidates[best[0]])[0]>center(candidates[best[1]])[0])best=[best[1],best[0],best[2]];
    const ambiguous=prior.every(Boolean)&&best[0]>=0&&best[1]>=0&&assignments.some(a=>a[0]===best[1]&&a[1]===best[0]&&a[2]-best[2]<.035);
    const selected=best.slice(0,2).map((index,i)=>{
      if(index<0){const p=prior[i],established=this.streak[i]>=3;this.streak[i]=0;return p&&(established||p.occluded)?{...p,confidence:.3,occluded:true}:null;}
      let s=candidates[index];const p=prior[i];if(p&&distance(p.a,s.b)+distance(p.b,s.a)<distance(p.a,s.a)+distance(p.b,s.b))s={...s,a:s.b,b:s.a};
      if(p&&length(s)<length(p)*.72){this.streak[i]=0;return {...s,confidence:.35,occluded:true};}
      this.streak[i]++;return {...s,occluded:false,confidence:ambiguous?Math.min(.4,s.confidence):this.streak[i]<3?Math.min(.5,s.confidence):s.confidence};
    });
    this.last=selected.map((s,i)=>{if(s&&!ambiguous&&!s.occluded){this.lastAt[i]=time;return s;}return s?.occluded&&prior[i]?{...prior[i],occluded:true}:prior[i];});return selected;
  }
}
