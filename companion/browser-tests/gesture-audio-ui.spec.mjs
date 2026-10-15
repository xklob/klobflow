import {test,expect} from '@playwright/test';
import http from 'node:http';
import {demoFrame,defaults} from '../public/demo.mjs';

test('camera overlay explains the X countdown at large sizes and audio pacing has a readable waiting state',async({page,request})=>{
 await request.post('/api/disconnect',{data:{}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1920,height:1080});await page.goto('/');
 const jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=960;c.height=720;const x=c.getContext('2d');x.fillStyle='#101a20';x.fillRect(0,0,960,720);x.lineWidth=12;x.strokeStyle='#ffffff';for(const s of [[340,200,600,520],[340,520,600,200]]){x.beginPath();x.moveTo(s[0],s[1]);x.lineTo(s[2],s[3]);x.stroke();}x.fillStyle='#b4c6cf';x.font='24px sans-serif';x.fillText('GENERATED TEST IMAGE',28,680);return c.toDataURL('image/jpeg').split(',')[1];}),'base64');
 let config={...defaults,staffCount:1},state='countdown',pacerState='ready',holdFrames=false;const commands=[];
 const phone=http.createServer(async(req,res)=>{
  if(req.url==='/api/live')return res.end(JSON.stringify({protocol:2,version:'0.13.0'}));
  if(req.url==='/api/sessions')return res.end('{"sessions":[]}');
  if(req.url==='/api/control'){
   let body='';for await(const b of req)body+=b;const c=JSON.parse(body);commands.push(c);config={...config,...c.config};
   if(c.action==='gesture')state=c.operation==='cancel'?'cancelled':'idle';
   return res.end(JSON.stringify({ok:true,config}));
  }
  if(req.url==='/api/stream'){
   res.writeHead(200,{'Content-Type':'application/x-klobflow-stream'});
   const timer=setInterval(()=>{if(holdFrames)return;const frame={...demoFrame(config,Date.now()),source:'camera',cameraReady:true,zoom:{min:1,max:1,ratio:1},gesture:{state,active:state==='countdown',remainingMs:4000,progress:.2,title:state==='countdown'?'AUTO-ALIGNMENT IN 4':state==='cancelled'?'ALIGNMENT CANCELLED':'',detail:'Uncross and put the second staff aside. Grip the remaining staff at its midpoint, put your hand at the new center, then hold still.'}};
    if(config.pacerEnabled){frame.audio={running:true,at:frame.time,bpm:120,confidence:.9,holding:false};frame.pacer={...frame.pacer,state:pacerState,audioSynced:true,rpm:pacerState==='running'?30:0};}
    const json=Buffer.from(JSON.stringify(frame)),head=Buffer.alloc(8);head.writeUInt32BE(json.length);head.writeUInt32BE(jpeg.length,4);res.write(Buffer.concat([head,json,jpeg]));
   },33);res.on('close',()=>clearInterval(timer));return;
  }
  res.writeHead(404);res.end();
 });
 await new Promise(r=>phone.listen(0,'127.0.0.1',r));
 try{
  await request.post('/api/pair',{data:{address:`127.0.0.1:${phone.address().port}`}});await page.reload();
  await expect(page.locator('#gesture-overlay')).toBeVisible();await expect(page.locator('#gesture-title')).toHaveText('AUTO-ALIGNMENT IN 4');
  await page.locator('#ui-size').selectOption('large');
  for(const mode of ['circles','antispin','grid','cube','free']){await page.locator(`[data-mode="${mode}"]`).click();await expect(page.locator('#gesture-overlay')).toBeVisible();}
  const fits=()=>page.evaluate(()=>{const a=document.querySelector('#gesture-overlay').getBoundingClientRect(),b=document.querySelector('#stage').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1&&a.bottom<=b.bottom&&a.top>=b.top;});
  await expect.poll(fits).toBe(true);
  await page.locator('[data-mode="circles"]').click();await page.screenshot({path:'../review/gesture/web-gesture.png'});
  await page.locator('#fullscreen').click();await expect.poll(fits).toBe(true);
  await page.locator('#exit-fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
  await page.setViewportSize({width:844,height:390});await page.locator('#fullscreen').click();await expect.poll(fits).toBe(true);
  await page.locator('#gesture-cancel').click();await expect.poll(()=>commands.some(c=>c.action==='gesture'&&c.operation==='cancel')).toBe(true);
  await expect(page.locator('#gesture-title')).toHaveText('ALIGNMENT CANCELLED');
  await page.locator('#exit-fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);await page.setViewportSize({width:1920,height:1080});
  state='idle';config={...config,pacerEnabled:true,tempoEnabled:true,tempoSource:'pc'};pacerState='waitingAudio';
  await expect(page.locator('#pacer-title')).toHaveText('WAITING FOR MUSIC BEAT');await expect(page.locator('#pacer-stats')).toContainText('reliable beat returns');
  await page.locator('#pacer-options summary').click();await expect(page.locator('#pacer-rpm')).toBeDisabled();await expect(page.locator('#pacer-speed-help')).toContainText('4 beats per cycle');
  pacerState='running';await expect(page.locator('#pacer-note')).toContainText('120 BPM → 30.0 cycles/min');
  await page.screenshot({path:'../review/gesture/web-audio-dots.png'});
  state='countdown';await expect(page.locator('#gesture-overlay')).toBeVisible();holdFrames=true;await expect(page.locator('#gesture-overlay')).toBeHidden({timeout:5000});
  expect(errors).toEqual([]);
 }finally{await request.post('/api/disconnect',{data:{}});phone.closeAllConnections();await new Promise(r=>phone.close(r));}
});
