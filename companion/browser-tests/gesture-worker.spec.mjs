import {test,expect} from '@playwright/test';

for(const count of [1,2])test(`real camera worker detects a two-staff X and fits ${count} selected staff(s)`,async({page})=>{
 await page.route('**/gesture-worker-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Gesture worker</title>'}));await page.goto('/gesture-worker-check');
 const result=await page.evaluate(async count=>{
  const {defaults}=await import('/core.mjs'),worker=new Worker('/tracker-worker.mjs',{type:'module'}),width=320,height=240;
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');let id=0,pending=null,action=null;const events=[];
  worker.onerror=e=>{if(pending){clearTimeout(pending.timer);pending.reject(Error(e.message));pending=null;}};
  worker.onmessage=({data})=>{if(data.type==='gestureFit'){action=data;events.push({type:data.type,config:data.config});return;}if(pending&&(data.type==='error'||data.type===pending.type)){clearTimeout(pending.timer);const p=pending;pending=null;data.type==='error'?p.reject(Error(data.error)):p.resolve(data);}};
  const send=(type,data={})=>new Promise((resolve,reject)=>{const wanted=type==='config'?'config':type==='frame'?'frame':'ack';const timer=setTimeout(()=>{pending=null;reject(Error('Worker timeout'));},5000);pending={type:wanted,resolve,reject,timer};worker.postMessage({type,id:++id,...data});});
  const draw=(time,cross=false)=>{
   ctx.fillStyle='#080808';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.lineCap='round';
   const lines=cross?[[[.48,.25],[.86,.75]],[[.48,.75],[.86,.25]]]:count===1?[[[.5,.7],[.9,.7]]]:[[[.55,.5],[.55,.9]],[[.8,.5],[.8,.9]]];
   for(const [a,b]of lines){ctx.beginPath();ctx.moveTo(a[0]*height,a[1]*height);ctx.lineTo(b[0]*height,b[1]*height);ctx.stroke();}
   return send('frame',{time,width,height,pixels:ctx.getImageData(0,0,width,height).data.buffer});
  };
  try{
   await send('config',{config:{...defaults,mode:'circles',staffCount:count,gestureEnabled:true,pacerEnabled:true,pacerCountdown:0},revision:1});
   let last,trigger,sequence=[],setupFrames=0,applied=false;const first=1000;
   for(let t=first;t<=first+13250;t+=125){
    last=(await draw(t,t<=first+5000||applied)).frame;
    if(!sequence.includes(last.gesture.state))sequence.push(last.gesture.state);
    if(last.gesture.state==='countdown'&&!trigger)trigger={time:t,remaining:last.gesture.remainingMs};
    if(last.gesture.active){setupFrames++;if(last.metrics.deviation!==null||last.feedback.length||last.streak.seconds)throw Error('Calibration received a practice score');}
    if(action){const fit=action;action=null;applied=true;await send('config',{config:fit.config,seeds:fit.seeds,fromGesture:true,time:t,revision:1,zoom:{min:1,max:1,ratio:1}});}
   }
   const config=last.config;
   // Holding the same X again without a release interval cannot queue a second fit.
   for(let t=first+13375;t<=first+20000;t+=125)last=(await draw(t,true)).frame;
   return {trigger,sequence,setupFrames,events,config,lastState:last.gesture.state};
  }finally{worker.terminate();}
 },count);
 expect(result.trigger).toEqual({time:6000,remaining:5000});expect(result.sequence).toContain('success');expect(result.setupFrames).toBeGreaterThan(40);expect(result.events).toHaveLength(1);
 expect(result.config.staffCount).toBe(count);expect(result.config.cx).toBeCloseTo((count===1?.7:.675)/(4/3),1);expect(result.config.cy).toBeCloseTo(.7,1);expect(result.config.scale).toBeCloseTo(.2,1);expect(result.lastState).toBe('idle');
});

test('worker cancel, manual changes, and tap-selection suspension prevent delayed automatic patches',async({page})=>{
 await page.route('**/gesture-cancel-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('/gesture-cancel-check');
 const result=await page.evaluate(async()=>{
  const {defaults}=await import('/core.mjs'),worker=new Worker('/tracker-worker.mjs',{type:'module'}),width=192,height=144,canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');let id=0,actions=0;
  const send=(type,data={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),5000);worker.onmessage=({data})=>{if(data.type==='gestureFit'){actions++;return;}clearTimeout(timer);data.type==='error'?reject(Error(data.error)):resolve(data);};worker.postMessage({type,id:++id,...data});});
  const frame=async t=>{ctx.fillStyle='#080808';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#fff';ctx.lineWidth=3;for(const [a,b]of [[.25,.75],[.75,.25]]){ctx.beginPath();ctx.moveTo(.48*height,a*height);ctx.lineTo(.86*height,b*height);ctx.stroke();}return (await send('frame',{time:t,width,height,pixels:ctx.getImageData(0,0,width,height).data.buffer})).frame;};
  try{
   await send('config',{config:{...defaults,staffCount:1},revision:1});let last;for(let t=0;t<=5000;t+=125)last=await frame(t);const trigger=last.gesture.state;
   await send('gesture',{operation:'cancel',time:5000,revision:2});for(let t=5125;t<=14000;t+=125)last=await frame(t);const cancelled=last.gesture.state;
   await send('config',{config:{cx:.65},revision:3});await send('gesture',{operation:'suspend',time:14000,revision:4});for(let t=14125;t<=21000;t+=125)last=await frame(t);
   return {trigger,cancelled,suspended:last.gesture.state,actions,cx:last.config.cx};
  }finally{worker.terminate();}
 });
 expect(result).toEqual({trigger:'countdown',cancelled:'idle',suspended:'idle',actions:0,cx:.65});
});

test('cancel during physical zoom keeps camera metadata synchronized without applying a delayed fit',async({page})=>{
 await page.route('**/gesture-zoom-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('/gesture-zoom-check');
 const result=await page.evaluate(async()=>{
  const {BrowserCamera}=await import('/browser-camera.mjs'),{defaults}=await import('/core.mjs'),cases=[];
  for(const interruption of ['cancel','source','manual']){
   const calls=[];let finish;const camera=Object.create(BrowserCamera.prototype);
   Object.assign(camera,{config:{...defaults,zoom:1},configRevision:1,generation:1,video:document.createElement('video'),zoom:{min:.5,max:3,ratio:1},remember(){},request:async(type,data)=>{calls.push({type,...data});return {};},applyZoom:()=>new Promise(r=>{finish=()=>{camera.zoom={min:.5,max:3,ratio:1.5};r();};})});
   const action=camera.command({action:'config',config:{zoom:1.5},fromGesture:true});
   if(interruption==='source'){camera.generation++;camera.configRevision++;}
   else if(interruption==='cancel')await camera.command({action:'gesture',operation:'cancel'});
   else await camera.command({action:'config',config:{cx:.65}});
   finish();await action;cases.push({interruption,calls,config:camera.config});
  }
  return cases;
 });
 const cancel=result[0];expect(cancel.calls.map(x=>x.type)).toEqual(['gesture','config']);expect(cancel.calls[1].fromFit).toBe(true);expect(cancel.calls[1].fromGesture).toBeUndefined();expect(cancel.calls[1].zoom.ratio).toBe(1.5);expect(cancel.calls[1].revision).toBe(2);
 expect(result[1].calls).toEqual([]);expect(result[2].calls).toHaveLength(1);expect(result[2].config.cx).toBe(.65);expect(result[2].calls[0].fromGesture).toBe(false);
});
