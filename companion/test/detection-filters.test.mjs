import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundFilter} from '../public/background.mjs';
import {filterStaffColors,staffColorNames} from '../public/staff-colors.mjs';
import {defaults,patchConfig,StaffDetector,center} from '../public/core.mjs';
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
