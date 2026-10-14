import {test,expect} from '@playwright/test';

test('real browser worker captures background, keeps stationary staves, and changes LED filters',async({page})=>{
 await page.route('**/worker-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Worker check</title>'}));
 await page.goto('/worker-check');
 const result=await page.evaluate(async()=>{
  const {defaults}=await import('/core.mjs'),worker=new Worker('/tracker-worker.mjs',{type:'module'}),w=160,h=120;
  const send=(type,data={})=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Worker timed out')),5000);
   worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};
   worker.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timer);reject(Error(data.error));}else{clearTimeout(timer);resolve(data);}};
   worker.postMessage({type,...data});
  });
  const frame=async(time,staff=false)=>{
   const rgba=new Uint8ClampedArray(w*h*4);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4;let r=16,g=16,b=16;
    if(y>=8&&y<112&&x>=130&&x<134)r=g=b=248;
    if(staff&&x>=24&&x<94&&y>=57&&y<62){r=255;g=y===59?255:32;b=y===59?255:221;}
    rgba[i]=r;rgba[i+1]=g;rgba[i+2]=b;rgba[i+3]=255;
   }
   return (await send('frame',{width:w,height:h,time,pixels:rgba.buffer})).frame;
  };
  try{
   await send('config',{id:1,config:{...defaults,staffCount:1},start:true});
   await send('background',{id:2,mode:'capture',time:1000});
   const countdown=await frame(2000);for(const t of [6000,6100,6200,6400])await frame(t);
   const background=await frame(6450);let held;
   for(const t of [6500,6550,6600,6650,8000,8050,8100,8150])held=await frame(t,true);
   await send('background',{id:3,mode:'clear'});
   await send('config',{id:4,config:{staffColors:['pink']}});
   let selected;for(const t of [8200,8250,8300,8350])selected=await frame(t,true);
   await send('config',{id:5,config:{staffColors:['blue']}});const rejected=await frame(8400,true);
   return {countdown,background,held,selected,rejected};
  }finally{worker.terminate();}
 });
 expect(result.countdown.background.state).toBe('countdown');expect(result.countdown.staffs[0]).toBeNull();
 expect(result.background.background.state).toBe('ready');expect(result.background.staffs[0]).toBeNull();
 for(const f of [result.held,result.selected]){expect(f.staffs[0].confidence).toBeGreaterThanOrEqual(.55);expect((f.staffs[0].a[0]+f.staffs[0].b[0])/2).toBeLessThan(.8);expect(f.metrics.deviation).not.toBeNull();expect(f.averagedMetrics.deviation).not.toBeNull();}
 expect(result.selected.background.state).toBe('off');expect(result.rejected.staffs[0]).toBeNull();expect(result.rejected.metrics.deviation).toBeNull();
});
