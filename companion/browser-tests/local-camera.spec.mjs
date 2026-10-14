import { test,expect } from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const videoFile=join(tmpdir(),'klobflow-led-camera.y4m');
const w=320,h=240,frames=[Buffer.from(`YUV4MPEG2 W${w} H${h} F60:1 Ip A1:1 C420jpeg\n`)];
for(let i=0;i<60;i++){
 const pixels=Buffer.alloc(w*h*1.5,128);pixels.fill(25,0,w*h);
 const shift=Math.round(Math.sin(i/60*Math.PI*2)*10);
 for(let y=45;y<195;y++)for(let d=-2;d<=2;d++){
  pixels[y*w+Math.round(45+y*.32)+shift+d]=235;
  pixels[y*w+Math.round(270-y*.32)+shift+d]=235;
 }
 frames.push(Buffer.from('FRAME\n'),pixels);
}
writeFileSync(videoFile,Buffer.concat(frames));
test.use({launchOptions:{executablePath:process.env.KLOBFLOW_BROWSER,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${videoFile}`]}});
test.beforeEach(async({request})=>{await request.post('/api/disconnect',{data:{}});});
test('PC camera tracks locally, stays live during selection, records and reopens',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.locator('#local-open').click();
 await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await expect(page.locator('#tracking-label')).toContainText('Both staves tracked');
 await expect(page.locator('#camera-profile')).toContainText('fps measured');
 await expect(page.locator('#local-video')).toHaveCSS('transform','matrix(-1, 0, 0, 1, 0, 0)');
 for(const button of ['#seed','#calibrate']){
  await page.locator(button).click();
  const before=await page.locator('#view').evaluate(c=>c.toDataURL());
  await expect.poll(()=>page.locator('#view').evaluate(c=>c.toDataURL())).not.toBe(before);
  const time=await page.locator('#local-video').evaluate(v=>v.currentTime);
  await expect.poll(()=>page.locator('#local-video').evaluate(v=>v.currentTime)).toBeGreaterThan(time);
  await page.locator(button).click();
 }
 await page.locator('#record').click();await expect(page.locator('#record')).toContainText('Stop');
 await expect.poll(()=>page.locator('#record').textContent()).toContain('2s');
 await page.locator('#record').click();await expect(page.locator('#sessions')).toContainText('Play video');
 await page.getByRole('button',{name:'Play video'}).click();
 await expect.poll(()=>page.locator('#session-video').evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(2);
 await page.locator('#close-video').click();
 const saved=await page.evaluate(async()=>{const {listSessions}=await import('/sessions.mjs');const s=(await listSessions())[0];return {frames:s.frames,bytes:s.video.size,analysis:await s.analysis.text()};});
 expect(saved.frames).toBeGreaterThan(4);expect(saved.bytes).toBeGreaterThan(1000);
 const rows=saved.analysis.trim().split('\n').map(JSON.parse);expect(rows[0].type).toBe('header');expect(rows.slice(1).some(f=>f.metrics.deviation!==null)).toBe(true);
 await page.locator('#staff-count').selectOption('1');await expect(page.locator('#tracking-label')).toContainText('One staff tracked');
 await page.locator('#fit-size').click();await expect(page.locator('#fit-status')).toContainText('matches the visible staff length',{timeout:10000});
 await expect(page.locator('#size-helper')).toContainText(/1.0[0-5]×/);
 await page.locator('[data-config="tempoEnabled"]').check();await page.locator('#bpm').fill('105');await page.locator('#bpm').dispatchEvent('change');await expect(page.locator('#beat-pulse')).toContainText('105 BPM');
 await page.screenshot({path:'../review/browser-camera.png',fullPage:true});
 await page.locator('#local-open').click();await expect(page.locator('#empty-state')).toBeVisible();
 await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA');
 expect(errors).toEqual([]);
});
test('denied camera permission gives a recoverable message',async({page})=>{
 await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});
 await page.goto('/');await page.locator('#local-open').click();
 await expect(page.locator('#message')).toContainText('Allow camera access');
 await expect(page.locator('#local-open')).toBeEnabled();await expect(page.locator('#record')).toBeDisabled();
});

test('PC system-audio pipeline detects a beat, pauses on silence, and preserves manual tempo',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{
  const ctx=new AudioContext(),destination=ctx.createMediaStreamDestination(),buffer=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate),samples=buffer.getChannelData(0);
  for(let i=0;i<samples.length;i++){const t=i/ctx.sampleRate;samples[i]=.65*Math.sin(2*Math.PI*70*t)*Math.exp(-(t%.5)/.035);}
  const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(destination);source.start();await ctx.resume();
  const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);const video=canvas.captureStream(1);
  window.audioFixture={ctx,source};return new MediaStream([...destination.stream.getAudioTracks(),...video.getVideoTracks()]);
 };});
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.locator('#audio-pc').click();await expect(page.locator('#audio-status')).toContainText(/120 BPM.*confidence/,{timeout:25000});
 await expect(page.locator('#beat-pulse')).toContainText('120 BPM');
 await page.locator('[data-config="audioRate"]').selectOption('0.5');await expect(page.locator('#beat-pulse')).toContainText('60 BPM');
 await page.evaluate(()=>window.audioFixture.source.stop());await expect(page.locator('#audio-status')).toContainText('No shared audio',{timeout:6000});await expect(page.locator('#beat-pulse')).toHaveText('Beat timing paused');
 await page.locator('#audio-manual').click();await expect(page.locator('#audio-status')).toContainText('Manual tempo');await expect(page.locator('#beat-pulse')).toContainText('120 BPM');
 await page.evaluate(()=>window.audioFixture.ctx.close());expect(errors).toEqual([]);
});
test('a shared screen without audio explains the missing track and cleans up',async({page})=>{
 await page.addInitScript(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{const c=document.createElement('canvas');c.width=16;c.height=16;const stream=c.captureStream(1);window.noAudioTrack=stream.getVideoTracks()[0];return stream;};});
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.locator('#audio-pc').click();await expect(page.locator('#message')).toContainText('No audio was shared');await expect.poll(()=>page.evaluate(()=>window.noAudioTrack.readyState)).toBe('ended');
 await expect(page.locator('#audio-status')).toContainText('Manual tempo');
});

test('PC audio is clock-synchronized before forwarding tempo to an Android companion',async({page})=>{
 const http=await import('node:http'),{demoFrame,defaults}=await import('../public/demo.mjs');let config={...defaults},commands=[],audio=null;
 await page.addInitScript(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{
  const ctx=new AudioContext(),dest=ctx.createMediaStreamDestination(),buffer=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate),p=buffer.getChannelData(0);
  for(let i=0;i<p.length;i++){const t=i/ctx.sampleRate;p[i]=.65*Math.sin(2*Math.PI*70*t)*Math.exp(-(t%.5)/.035);}
  const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(dest);source.start();await ctx.resume();const c=document.createElement('canvas');c.width=16;c.height=16;const video=c.captureStream(1);window.audioFixture={ctx,source};return new MediaStream([...dest.stream.getAudioTracks(),...video.getVideoTracks()]);
 };});
 await page.goto('/');const jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=240;return c.toDataURL('image/jpeg').split(',')[1];}),'base64');
 const clock=()=>performance.now()+600000;
 const phone=http.createServer(async(req,res)=>{
  if(req.url==='/api/live')return res.end(JSON.stringify({protocol:2,version:'0.5.0'}));
  if(req.url==='/api/clock')return res.end(JSON.stringify({time:clock()}));
  if(req.url==='/api/sessions')return res.end('{"sessions":[]}');
  if(req.url==='/api/control'){let body='';for await(const c of req)body+=c;const command=JSON.parse(body);commands.push(command);if(command.config)config={...config,...command.config};if(command.action==='audioTempo')audio=command;return res.end(JSON.stringify({ok:true,config}));}
  if(req.url==='/api/stream'){res.writeHead(200,{'Content-Type':'application/x-klobflow-stream'});const timer=setInterval(()=>{const time=clock(),frame={...demoFrame(config,time),source:'camera',cameraReady:true,audio:audio?{...audio,at:time,status:'Following PC system audio'}:null},json=Buffer.from(JSON.stringify(frame)),head=Buffer.alloc(8);head.writeUInt32BE(json.length);head.writeUInt32BE(jpeg.length,4);res.write(Buffer.concat([head,json,jpeg]));},50);res.on('close',()=>clearInterval(timer));return;}res.writeHead(404);res.end();
 });
 await new Promise(resolve=>phone.listen(0,'127.0.0.1',resolve));
 try{
  await page.locator('#pair-open').click();await page.locator('#transport').selectOption('lan');await page.locator('#phone-address').fill(`127.0.0.1:${phone.address().port}`);await page.locator('#pair-submit').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PHONE');
  await page.locator('#audio-pc').click();await expect.poll(()=>commands.some(c=>c.action==='audioTempo'&&c.bpm===120),{timeout:25000}).toBe(true);
  const sample=commands.filter(c=>c.action==='audioTempo'&&c.bpm===120).at(-1);expect(Math.abs(sample.origin-clock())).toBeLessThan(1500);expect(sample.ageMs).toBeLessThan(2000);expect(sample.confidence).toBeGreaterThanOrEqual(.6);
  await expect(page.locator('#audio-status')).toContainText('clock ±');await page.locator('#audio-manual').click();await expect.poll(()=>config.tempoSource).toBe('manual');
  await page.evaluate(()=>window.audioFixture.ctx.close());
 }finally{await page.request.post('/api/disconnect',{data:{}});phone.closeAllConnections();await new Promise(resolve=>phone.close(resolve));}
});
