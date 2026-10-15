import {test,expect} from '@playwright/test';

test('real camera worker keeps moving targets separate from measured tips and honors exercise controls',async({page})=>{
 await page.route('**/pacer-worker-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Moving dot worker</title>'}));await page.goto('/pacer-worker-check');
 const result=await page.evaluate(async()=>{
  const {defaults}=await import('/core.mjs'),worker=new Worker('/tracker-worker.mjs',{type:'module'}),w=160,h=120;
  let id=0;
  const send=(type,data={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timeout')),5000);worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.onmessage=({data})=>{clearTimeout(timer);data.type==='error'?reject(Error(data.error)):resolve(data);};worker.postMessage({type,id:++id,...data});});
  const frame=async(time,lit=true)=>{
   const rgba=new Uint8ClampedArray(w*h*4);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=lit&&x>=44&&x<=116&&y>=58&&y<=62?255:12;rgba[i]=rgba[i+1]=rgba[i+2]=v;rgba[i+3]=255;}
   return (await send('frame',{width:w,height:h,time,pixels:rgba.buffer})).frame;
  };
  try{
   await send('config',{config:{...defaults,mode:'circles',staffCount:1,pacerEnabled:true,pacerCountdown:0,scale:.3,pacerRpm:20},restore:true});
   let ready;for(let t=1000;t<=1100;t+=20)ready=await frame(t);
   await send('pacer',{operation:'start',time:1100});const queued=await send('frame',{width:w,height:h,time:1099,pixels:new ArrayBuffer(w*h*4)});let running;for(let t=1120;t<=1400;t+=20)running=await frame(t);
   await send('pacer',{operation:'pause',time:1400});const paused=await frame(1420),later=await frame(1600);
   await send('config',{config:{pacerDotSize:24}});const cosmetic=await frame(1620);
   await send('pacer',{operation:'resume',time:1620});const resumed=await frame(1720);
   await send('config',{config:{pacerRpm:40}});const reconfigured=await frame(1740);
   await send('pacer',{operation:'start',time:1740});let missing;for(let t=1760;t<=1960;t+=20)missing=await frame(t,false);
   await send('background',{mode:'capture',time:1960});const background=await frame(1980,false);
   let blocked=false;try{await send('pacer',{operation:'start',time:1980});}catch(e){blocked=/background snapshot/.test(e.message);}
   await send('pacer',{operation:'stop',time:1980});
   return {ready,queued,running,paused,later,cosmetic,resumed,reconfigured,missing,background,blocked};
  }finally{worker.terminate();}
 });
 expect(result.ready.pacer.state).toBe('ready');expect(result.ready.pacer.targets[0]).toHaveLength(2);expect(result.ready.streak.state).toBe('practice');
 expect(result.ready.staffs[0].confidence).toBeGreaterThanOrEqual(.55);
 expect(result.queued.type).toBe('frameSkipped');
 expect(result.running.pacer.state).toBe('running');expect(result.running.pacer.phase).toBeCloseTo(.1,6);expect(result.running.pacer.valid).toBe(true);
 expect(result.running.feedback).toEqual(result.running.pacer.feedback);expect(result.running.pacer.onTarget).toBe(false);
 expect(result.paused.pacer.state).toBe('paused');expect(result.later.pacer.phase).toBe(result.paused.pacer.phase);expect(result.cosmetic.pacer.phase).toBe(result.paused.pacer.phase);
 expect(result.paused.feedback).toEqual([]);expect(result.paused.streak.seconds).toBe(0);
 expect(result.resumed.pacer.phase).toBeGreaterThan(result.paused.pacer.phase);expect(result.reconfigured.pacer.state).toBe('ready');
 expect(result.missing.pacer.state).toBe('running');expect(result.missing.pacer.valid).toBe(false);expect(result.missing.feedback).toEqual([]);expect(result.missing.pacer.targets[0]).toHaveLength(2);
 expect(result.background.pacer.state).toBe('ready');expect(result.background.streak.seconds).toBe(0);expect(result.blocked).toBe(true);
});

test('two-staff antispin passes through the actual image worker and a missing B cannot score',async({page})=>{
 await page.route('**/two-staff-worker-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Two staff worker</title>'}));await page.goto('/two-staff-worker-check');
 const result=await page.evaluate(async()=>{
  const {defaults,Guide}=await import('/core.mjs'),worker=new Worker('/tracker-worker.mjs',{type:'module'}),width=320,height=240;
  const config={...defaults,mode:'antispin',staffCount:2,scale:.28,circleSeparation:1.8,pacerEnabled:true,pacerCountdown:0,pacerRpm:20};
  const g=new Guide(config,width,height),canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');let id=0;
  const send=(type,data={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timeout')),5000);worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.onmessage=({data})=>{clearTimeout(timer);data.type==='error'?reject(Error(data.error)):resolve(data);};worker.postMessage({type,id:++id,...data});});
  const frame=async(time,b=true)=>{
   ctx.fillStyle='#101410';ctx.fillRect(0,0,width,height);ctx.lineWidth=4;ctx.lineCap='round';ctx.strokeStyle='#ffffff';
   for(let i=0;i<(b?2:1);i++){const phase=i?-.7:.7,a=g.antispinPoint(Math.cos(phase),0,i),z=g.antispinPoint(0,Math.sin(phase),i);ctx.beginPath();ctx.moveTo(a[0]*height,a[1]*height);ctx.lineTo(z[0]*height,z[1]*height);ctx.stroke();}
   return (await send('frame',{width,height,time,pixels:ctx.getImageData(0,0,width,height).data.buffer})).frame;
  };
  try{
   await send('config',{config,restore:true});let ready;for(let t=1000;t<=1500;t+=20)ready=await frame(t);
   await send('pacer',{operation:'start',time:1500});const running=await frame(1520);let missing;
   for(let t=1540;t<=2540;t+=20)missing=await frame(t,false);
   return {ready,running,missing};
  }finally{worker.terminate();}
 });
 expect(result.ready.config.staffCount).toBe(2);expect(result.ready.guide.lines).toHaveLength(4);expect(result.ready.metrics.deviation).not.toBeNull();
 expect(result.running.pacer.valid).toBe(true);expect(result.running.pacer.targets).toHaveLength(2);expect(result.running.feedback).toHaveLength(4);
 expect(result.missing.pacer.valid).toBe(false);expect(result.missing.pacer.targets).toHaveLength(2);expect(result.missing.feedback).toEqual([]);expect(result.missing.metrics.deviation).toBeNull();
});
