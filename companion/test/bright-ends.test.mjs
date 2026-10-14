import test from 'node:test';
import assert from 'node:assert/strict';
import {StaffDetector,StaffTracker,defaults,center,distance,angle,angleDifference,length,Guide,Scorer} from '../public/core.mjs';

// Abstract geometry learned from the private clips: broad luminous ends, a dark
// grip, patterned surroundings and a white window edge. No recording pixels.
function image(theta,sweep){
 const w=320,h=240,pixels=new Int32Array(w*h),samples=sweep?17:1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let r=12,g=20,b=40;const dx=x/h-.8,dy=y/h-.5;
  for(let n=0;n<samples;n++){
   const a=theta+(samples===1?0:sweep*(n/(samples-1)-.5)),along=dx*Math.cos(a)+dy*Math.sin(a),across=-dx*Math.sin(a)+dy*Math.cos(a),radius=.012+.045*(Math.abs(along)/.34)**4;
   if(Math.abs(along)>.34||Math.abs(along)<.1||Math.abs(across)>radius)continue;
   r+=240/samples;g+=100/samples;b+=200/samples;
  }
  if(x>=27&&x<=30&&y<170||x>=27&&x<=55&&y<170&&y%24<3)r=g=b=255;
  pixels[y*w+x]=(255<<24)|(Math.min(255,Math.round(r))<<16)|(Math.min(255,Math.round(g))<<8)|Math.min(255,Math.round(b));
 }
 return pixels;
}
test('paired bright ends stay on a single staff beside a branched window edge',()=>{
 const detector=new StaffDetector(),tracker=new StaffTracker(),config={...defaults,staffCount:1};
 for(let i=0;i<24;i++){
  const theta=.4+i*.28,time=1000+i*67,sweep=i<4?0:.6;
  const s=tracker.update(detector.detect(image(theta,sweep),320,240,config,tracker.hints(time,1)),time,1)[0];
  assert.ok(s&&!s.occluded,`lost frame ${i}`);assert.ok(distance(center(s),[.8,.5])<.05);assert.ok(angleDifference(angle(s),theta)<.1);assert.ok(Math.abs(length(s)-.68)<.07);
  if(sweep){assert.ok(s.blurred);assert.equal(new Scorer().score(time,[s],new Guide(config,320,240)).deviation,null);}
 }
});
