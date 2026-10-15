import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundFilter} from '../public/background.mjs';
import {filterStaffColors,staffColorNames} from '../public/staff-colors.mjs';
import {recoverSelectedColorEndpoints} from '../public/selected-color-recovery.mjs';
import {defaults,patchConfig,StaffDetector,StaffTracker,Scorer,Guide,center} from '../public/core.mjs';
const w=160,h=120;
function scene(staff=true){
 const p=new Int32Array(w*h).fill(0xff101010);
 for(let y=8;y<112;y++)for(let x=130;x<134;x++)p[y*w+x]=0xfff8f8f8; // sunlight slit
 if(staff)for(let x=24;x<94;x++)for(let y=57;y<62;y++)p[y*w+x]=y===59?0xffffffff:0xffff20dd;
 return p;
}
test('selected LED hue rejects sunlight, preserves white cores and supports multiple colors',()=>{
 const pixels=scene(),filtered=filterStaffColors(pixels,w,h,['pink']);
 assert.equal(filtered[59*w+40],pixels[59*w+40]);assert.equal(filtered[20*w+131],0);
 const found=new StaffDetector().detect(pixels,w,h,{...defaults,staffCount:1,staffColors:['pink']});
 assert.equal(found.length,1);assert.ok(center(found[0])[0]<.8);assert.ok(found[0].confidence>=.55);
 const colors=[0xffff0000,0xffff8800,0xffffff00,0xff00ff00,0xff00ffff,0xff0044ff,0xff8800ff,0xffff00dd,0xffffffff];
 colors.forEach((p,i)=>assert.equal(filterStaffColors(Int32Array.of(p),1,1,[staffColorNames[i]])[0],p|0));
 assert.deepEqual([...filterStaffColors(Int32Array.of(colors[0],colors[5],colors[3]),3,1,['red','blue'])],[colors[0]|0,colors[5]|0,0]);
 assert.deepEqual(patchConfig(defaults,{staffColors:['red','blue','red']}).staffColors,['red','blue']);
 assert.throws(()=>patchConfig(defaults,{staffColors:['ultraviolet']}),/valid staff colors/);
});
test('large overexposed caps retain their white interiors inside selected glow',()=>{
 const pixels=new Int32Array(w*h).fill(0xff101010);
 for(const cx of [38,104])for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const d=(x-cx)**2+(y-60)**2;if(d<=12**2)pixels[y*w+x]=d<=10**2?0xffffffff:0xffff20dd;
 }
 const actual=filterStaffColors(pixels,w,h,['pink']);
 for(const cx of [38,104])for(let y=51;y<=69;y++)for(let x=cx-9;x<=cx+9;x++)if((x-cx)**2+(y-60)**2<=9**2)
  assert.equal(actual[y*w+x],pixels[y*w+x],`white cap interior at ${x},${y}`);
});
test('a local colored reflection cannot flood fill an unrelated white light',()=>{
 const pixels=scene(false);for(let y=55;y<=59;y++)for(let x=127;x<=129;x++)pixels[y*w+x]=0xffff20dd;
 const actual=filterStaffColors(pixels,w,h,['pink']);
 assert.equal(actual[20*w+131],0);assert.equal(actual[100*w+131],0);
 assert.equal(filterStaffColors(new Int32Array(w*h).fill(0xffffffff),w,h,['pink'])[60*w+80],0);
});
test('selected caps recover a white shaft joined to sunlight without admitting the sunlight',()=>{
 const width=384,height=216,pixels=new Int32Array(width*height).fill(0xff101010);
 const rect=(x0,y0,x1,y1,color)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)pixels[y*width+x]=color;};
 for(const [lo,hi] of [[70,150],[164,245]]){rect(lo,104,hi,110,0xffff20dd);rect(lo,106,hi,108,0xffffffff);}
 // The neutral background touches the white core, so flooding the entire
 // neutral component would admit an unrelated light all the way to the edge.
 rect(70,100,110,112,0xffc8c8c8);rect(70,106,150,108,0xffffffff);
 rect(70,104,73,105,0xffff20dd);rect(70,109,73,110,0xffff20dd);rect(90,0,92,104,0xffc8c8c8);
 const c={...defaults,staffCount:1,threshold:250,staffColors:['pink','purple']};
 const masked=filterStaffColors(pixels,width,height,c.staffColors);
 assert.equal(masked[107*width+90],0);assert.equal(masked[10*width+91],0);
 for(const rotate of [false,true])for(const threshold of [175,250]){
  const ww=rotate?height:width,hh=rotate?width:height,frame=rotate?new Int32Array(pixels.length):pixels;
  if(rotate)for(let y=0;y<height;y++)for(let x=0;x<width;x++)frame[x*ww+height-1-y]=pixels[y*width+x];
  const found=new StaffDetector().detect(frame,ww,hh,{...c,threshold});assert.equal(found.length,1);
  const positions=[found[0].a[rotate?1:0]*216,found[0].b[rotate?1:0]*216].sort((a,b)=>a-b);
  assert.ok(Math.abs(positions[0]-70)<1);assert.ok(Math.abs(positions[1]-245)<1);
  assert.equal(found[0].confidence,.7);assert.ok(!found[0].blurred&&!found[0].occluded);
 }
 // With no selected cap evidence at the missing end, white geometry alone
 // must not extend the selected segment into the background.
 rect(70,104,73,105,0xffc8c8c8);rect(70,109,73,110,0xffc8c8c8);
 const unsupported=new StaffDetector().detect(pixels,width,height,c);
 assert.equal(unsupported.length,1);assert.ok(Math.min(unsupported[0].a[0],unsupported[0].b[0])*216>100);
 // An adjacent real staff is a valid seed, but a one-sided colored reflection
 // on a collinear white background line still cannot establish the far cap.
 rect(70,104,72,105,0xffff20dd);
 const reflection=new StaffDetector().detect(pixels,width,height,c);
 assert.equal(reflection.length,1);assert.ok(Math.min(reflection[0].a[0],reflection[0].b[0])*216>100);
});
test('raw recovery cannot promote a white slit with small colored reflections',()=>{
 const width=384,height=216,c={...defaults,staffCount:1,threshold:250,staffColors:['pink','purple']};
 for(const reflections of [[],[104],[5,200]]){
  const p=new Int32Array(width*height).fill(0xff101010);
  for(let y=5;y<=205;y++)for(let x=310;x<=315;x++)p[y*width+x]=0xffffffff;
  for(const top of reflections)for(let y=top;y<=top+5;y++)for(let x=306;x<=309;x++)p[y*width+x]=0xffff20dd;
  assert.deepEqual(new StaffDetector().detect(p,width,height,c),[]);
 }
});
test('a supported clipped-cap conflict stays unscored without a false motion-blur flag',()=>{
 const width=384,height=216,pixels=new Int32Array(width*height).fill(0xff101010);
 const rect=(x0,y0,x1,y1,color)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)pixels[y*width+x]=color;};
 for(const [lo,hi] of [[3,83],[97,178]]){rect(lo,104,hi,110,0xffff20dd);rect(lo,106,hi,108,0xffffffff);}
 rect(3,100,43,112,0xffc8c8c8);rect(3,106,83,108,0xffffffff);
 rect(3,104,6,105,0xffff20dd);rect(3,109,6,110,0xffff20dd);rect(23,0,25,104,0xffc8c8c8);
 for(const threshold of [175,250]){
  const c={...defaults,staffCount:1,threshold,staffColors:['pink','purple']};
  const found=new StaffDetector().detect(pixels,width,height,c);assert.equal(found.length,1);
  assert.equal(found[0].confidence,.5);assert.ok(!found[0].blurred&&!found[0].occluded);
  assert.ok(Math.min(found[0].a[0],found[0].b[0])*216>30,'retain original geometry, not the clipped raw end');
  const tracker=new StaffTracker(),scorer=new Scorer(),guide=new Guide(c,width,height);
  for(const time of [1000,1017,1034])tracker.update([{...found[0],confidence:.8}],time,1);
  for(let time=1051;time<=1153;time+=17){
   const staffs=tracker.update(found,time,1),s=staffs[0],metrics=scorer.score(time,staffs,guide);
   assert.ok(s&&s.confidence<=.5);assert.ok(!s.blurred&&!s.occluded);assert.deepEqual(guide.cues(staffs),[]);
   assert.equal(metrics.deviation,null);assert.equal(metrics.angle,null);assert.equal(metrics.steadiness,null);assert.equal(metrics.coverage,0);
  }
 }
});
test('color recovery needs two interior hue-supported caps and does not reuse a raw staff',()=>{
 const c={...defaults,staffCount:2,threshold:250,staffColors:['pink']};
 const s={a:[60/h,60/h],b:[120/h,60/h],confidence:.8},raw={...s,a:[40/h,60/h]};
 const p=new Int32Array(w*h),cap=(x,color,cy=60)=>{for(let y=cy-1;y<=cy+1;y++)for(let xx=x-1;xx<=x+1;xx++)p[y*w+xx]=color;};
 cap(40,0xffff20dd);cap(120,0xffffffff);
 assert.deepEqual(recoverSelectedColorEndpoints(p,w,h,c,[s],()=>[raw]),[s]);
 cap(120,0xffff20dd);
 for(const candidate of [{...raw,blurred:true},{...raw,occluded:true},{...raw,confidence:.7}])
  assert.deepEqual(recoverSelectedColorEndpoints(p,w,h,c,[s],()=>[candidate]),[s]);
 const pair=recoverSelectedColorEndpoints(p,w,h,c,[s,{...s}],()=>[raw]);
 assert.deepEqual(pair[0],{...raw,confidence:.7});assert.deepEqual(pair[1],s);
 p.fill(0);cap(30,0xffff20dd);cap(120,0xffff20dd);
 assert.deepEqual(recoverSelectedColorEndpoints(p,w,h,c,[s],()=>[{...raw,a:[30/h,.5]}]),[s]);
 p.fill(0);cap(40,0xffff20dd);cap(120,0xffff20dd);
 let calls=0;const rawCheck=()=>{calls++;return [raw];};
 for(const candidate of [{...s,blurred:true},{...s,occluded:true},{...s,confidence:.7}])
  assert.deepEqual(recoverSelectedColorEndpoints(p,w,h,c,[candidate],rawCheck),[candidate]);
 for(const staffColors of [[],['white'],['pink','white']])recoverSelectedColorEndpoints(p,w,h,{...c,staffColors},[s],rawCheck);
 assert.equal(calls,0);
 p.fill(0);cap(3,0xffff20dd);cap(80,0xffff20dd);
 const edgeSelected={...s,a:[20/h,.5],b:[80/h,.5]},edgeRaw={...edgeSelected,a:[3/h,.5]};
 assert.deepEqual(recoverSelectedColorEndpoints(p,w,h,c,[edgeSelected],()=>[edgeRaw]),[{...edgeSelected,confidence:.5}]);
 for(const vertical of [false,true])for(const inset of [4,5]){
  const end=(vertical?h:w)-inset,axis=vertical?1:0,start=vertical?40:80;
  const point=n=>vertical?[.5,n/h]:[n/h,.5];
  const selected={...s,a:point(start),b:point(start+60)},candidate={...s,a:point(start),b:point(end)};
  p.fill(0);cap(vertical?60:start,0xffff20dd,vertical?start:60);cap(vertical?60:end,0xffff20dd,vertical?end:60);
  const [actual]=recoverSelectedColorEndpoints(p,w,h,c,[selected],()=>[candidate]);
  assert.equal(actual.b[axis],(inset===4?start+60:end)/h);
  assert.equal(actual.confidence,inset===4?.5:.7);assert.ok(!actual.blurred);
 }
});
test('fixed background removes static lights but never learns away a stationary foreground staff',()=>{
 const bg=new BackgroundFilter(),empty=scene(false);bg.begin(1000);
 assert.ok(bg.apply(empty,w,h,5999,'camera').every(p=>p===0));assert.equal(bg.status.remainingMs,1);
 for(const t of [6000,6100,6200,6400])bg.apply(empty,w,h,t,'camera');
 assert.equal(bg.status.state,'ready');assert.ok(bg.apply(empty,w,h,6500,'camera').every(p=>p===0));
 const dimmed=empty.map(p=>(p>>>0)===0xfff8f8f8?0xffbfbfbf:p);assert.ok(bg.apply(dimmed,w,h,6550,'camera').every(p=>p===0));
 const detector=new StaffDetector();
 for(const t of [6600,10000,30000]){
  const found=detector.detect(bg.apply(scene(),w,h,t,'camera'),w,h,{...defaults,staffCount:1});
  assert.equal(found.length,1);assert.ok(center(found[0])[0]<.8);
 }
 const changed=bg.apply(empty,w,h,31000,'zoom2');assert.equal(bg.status.state,'off');assert.equal(changed,empty);
 bg.begin(32000);bg.clear();assert.equal(bg.status.state,'off');assert.equal(bg.apply(empty,w,h,40000,'camera'),empty);
});
