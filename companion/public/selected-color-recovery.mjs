// A selected hue can identify a cap even when its white shaft touches sunlight
// and is removed by the color mask. Recover only fresh, supported raw geometry.
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const length=s=>distance(s.a,s.b);
const sharp=s=>!s.blurred&&!s.occluded&&s.confidence>=.8;
function selectedHue(pixel,threshold){
  const hi=Math.max(pixel>>>16&255,pixel>>>8&255,pixel&255);
  const lo=Math.min(pixel>>>16&255,pixel>>>8&255,pixel&255);
  return hi>=threshold&&hi-lo>hi*.2;
}

function colorBeyondEnd(filtered,w,h,s,threshold){
  const unit=Math.min(w,h),len=length(s)*unit;
  if(!(len>0))return false;
  const dx=(s.b[0]-s.a[0])*unit/len,dy=(s.b[1]-s.a[1])*unit/len;
  for(const [p,sign] of [[s.a,-1],[s.b,1]]){
    const px=p[0]*unit,py=p[1]*unit;let hits=0;
    for(let step=Math.max(8,len*.08);step<=len*.50;step++)for(let across=-4;across<=4;across++){
      const x=Math.round(px+sign*dx*step-dy*across),y=Math.round(py+sign*dy*step+dx*across);
      if(x>=0&&x<w&&y>=0&&y<h&&selectedHue(filtered[y*w+x],threshold)&&++hits>=6)return true;
    }
  }
  return false;
}

function supportedCap(filtered,w,h,p,dx,dy,allowClipped=false){
  const unit=Math.min(w,h),px=p[0]*unit,py=p[1]*unit,radius=4;
  // A clipped neighborhood cannot establish a fully visible cap.
  if(px<0||py<0||px>w-1||py>h-1)return false;
  if(!allowClipped&&(px<radius||py<radius||px>w-1-radius||py>h-1-radius))return false;
  let hits=0,positive=0,negative=0;
  for(let y=Math.max(0,Math.floor(py-radius));y<=Math.min(h-1,Math.ceil(py+radius));y++)
    for(let x=Math.max(0,Math.floor(px-radius));x<=Math.min(w-1,Math.ceil(px+radius));x++){
      if(Math.hypot(x-px,y-py)>radius||!selectedHue(filtered[y*w+x],80))continue;
      const across=-(x-px)*dy+(y-py)*dx;
      hits++;if(across>=.75)positive++;if(across<=-.75)negative++;
      // A colored reflection on one side of a white line is not a cap.
      if(hits>=6&&positive>=2&&negative>=2)return true;
    }
  return false;
}

export function recoverSelectedColorEndpoints(filtered,w,h,c,selected,detectRaw){
  if(!c.led||!c.staffColors?.length||c.staffColors.includes('white')||
      !selected.some(s=>sharp(s)&&colorBeyondEnd(filtered,w,h,s,c.threshold)))return selected;
  // The corridor scan only triggers work. Actual evidence uses distinct pixels
  // around both ends of a newly detected segment, never a prior staff length.
  const raw=detectRaw(),used=new Set(),unit=Math.min(w,h);
  return selected.map(s=>{
    if(!sharp(s))return s;
    const sl=length(s);if(!(sl>0))return s;
    const dx=(s.b[0]-s.a[0])/sl,dy=(s.b[1]-s.a[1])/sl;
    let chosen=-1,chosenLength=Infinity,contradiction=false;
    for(let i=0;i<raw.length;i++){
      const r=raw[i],rl=length(r);
      if(used.has(i)||!sharp(r)||rl<sl*1.10||rl>sl*1.40)continue;
      const delta=Math.atan2(r.b[1]-r.a[1],r.b[0]-r.a[0])-Math.atan2(dy,dx);
      if(Math.abs(Math.atan2(Math.sin(2*delta),Math.cos(2*delta)))/2>.12)continue;
      let a=r.a,b=r.b;
      if(distance(s.a,b)+distance(s.b,a)<distance(s.a,a)+distance(s.b,b))[a,b]=[b,a];
      if(Math.min(distance(s.a,a),distance(s.b,b))>Math.max(4/unit,sl*.025))continue;
      const low=(a[0]-s.a[0])*dx+(a[1]-s.a[1])*dy,high=(b[0]-s.a[0])*dx+(b[1]-s.a[1])*dy;
      const rawDx=(b[0]-a[0])/rl,rawDy=(b[1]-a[1])/rl;
      if(low>sl*.04||high<sl*.96)continue;
      if(!supportedCap(filtered,w,h,a,rawDx,rawDy)||!supportedCap(filtered,w,h,b,rawDx,rawDy)){
        if(supportedCap(filtered,w,h,a,rawDx,rawDy,true)&&supportedCap(filtered,w,h,b,rawDx,rawDy,true))contradiction=true;
        continue;
      }
      if(rl<chosenLength){chosen=i;chosenLength=rl;}
    }
    // Strong observed evidence can contradict the shortened span without proving
    // a fully visible cap. Withhold precision without inventing motion blur.
    if(chosen<0)return contradiction?{...s,confidence:Math.min(.5,s.confidence)}:s;
    used.add(chosen);
    return {...raw[chosen],confidence:Math.min(.7,raw[chosen].confidence)};
  });
}
