import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Guide,defaults} from '../public/core.mjs';
import {MovingPacer} from '../public/pacer.mjs';
import {TempoHold} from '../public/tempo-core.mjs';
const guide=(patch={})=>new Guide({...defaults,mode:'circles',staffCount:1,pacerEnabled:true,pacerCountdown:0,tempoEnabled:true,tempoSource:'pc',...patch},640,480);
const audio=(t,bpm=120)=>({running:true,bpm,origin:Math.floor(t/(60000/bpm))*(60000/bpm),confidence:.9,at:t});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function close(a,b){if(typeof b==='number')near(a,b);else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>close(a[i],v));}else if(b&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const k in b)close(a[k],b[k]);}else assert.equal(a,b);}
test('four beats per cycle follow audio rather than saved RPM, with rate and offset controls',()=>{
 for(const mode of ['circles','antispin'])for(const count of [1,2])for(const rate of [.5,1,2]){
  const g=guide({mode,staffCount:count,audioRate:rate}),p=new MovingPacer();p.command('start',0,g);
  for(let t=0;t<=2500;t+=50){const f=p.update(t,[],g,audio(t));assert.equal(f.state,'running');near(f.rpm,30*rate);near(f.phase,t*rate/2000%1);assert.equal(f.targets.length,count);}
 }
 const g=guide({audioRate:2,audioOffsetMs:125}),p=new MovingPacer();p.command('start',0,g);
 let last;for(let t=0;t<=500;t+=25){last=p.update(t,[],g,audio(t));near(last.phase,(.375+t/1000)%1);near(last.rpm,60);}
 const changed=p.update(525,[],g,{...audio(525),origin:200}),delta=(changed.phase-last.phase+1)%1;assert.ok(delta>=.021249&&delta<=.028751);
 assert.equal(p.update(550,[],g,{...audio(550),origin:NaN}).state,'waitingAudio');
});
test('qualified audio hold moves dots for 15 seconds, then freezes and excludes scores',()=>{
 const g=guide(),p=new MovingPacer(),hold=new TempoHold();p.command('start',0,g);let last,stopped;
 for(let t=0;t<=19500;t+=20){const a=hold.update(t<=3500?audio(t):{...audio(t),bpm:null,confidence:0});last=p.update(t,[],g,a);
  if(t<18500){assert.equal(last.state,'running');near(last.phase,t/2000%1);}else{assert.equal(last.state,'waitingAudio');assert.equal(last.valid,false);assert.equal(last.meanError,null);stopped??=last.phase;near(last.phase,stopped);}}
 p.command('pause',19500,g);assert.equal(p.update(19600,[],g,audio(19600)).state,'paused');p.command('resume',19600,g);const resumed=p.update(19600,[],g,audio(19600));assert.equal(resumed.state,'running');near(resumed.phase,last.phase);
 assert.equal(p.update(20400,[],g,audio(20400)).state,'ready');
});
test('audio dots agree with Android through tempo changes, holds, missing audio and explicit controls',()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/native-audio-pacer.json',import.meta.url)));
 for(const entry of cases){const g=new Guide(entry.config,640,480),p=new MovingPacer();for(const s of entry.steps){if(s.operation)p.command(s.operation,s.time,g);p.update(s.time,[],g,s.audio);close(p.update(s.time,s.staffs,g,s.audio),s.output);}}
});
