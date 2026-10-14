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
 await page.addInitScript(()=>localStorage.setItem('klobflow.local.config',JSON.stringify({autoFit:true,cx:.42,cy:.61,scale:.37,rotation:17,circleSeparation:.9})));
 await page.goto('/');await page.locator('#local-open').click();
 await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await expect(page.locator('#tracking-label')).toContainText('Both staves tracked');
 await expect(page.locator('#camera-profile')).toContainText('fps measured');
 await expect(page.locator('#local-video')).toHaveCSS('transform','matrix(-1, 0, 0, 1, 0, 0)');
 const started=await page.locator('#local-video').evaluate(v=>v.currentTime);
 await expect.poll(()=>page.locator('#local-video').evaluate(v=>v.currentTime)).toBeGreaterThan(started+2.6);
 for(const [key,value] of Object.entries({cx:.42,cy:.61,scale:.37,rotation:17,circleSeparation:.9}))await expect(page.locator(`[data-config="${key}"]`)).toHaveValue(String(value));
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('klobflow.local.config')).autoFit)).toBe(false);
 for(const button of ['#seed','#calibrate']){
  await page.locator(button).click();
  const before=await page.locator('#view').evaluate(c=>c.toDataURL());
  await expect.poll(()=>page.locator('#view').evaluate(c=>c.toDataURL())).not.toBe(before);
  const time=await page.locator('#local-video').evaluate(v=>v.currentTime);
  await expect.poll(()=>page.locator('#local-video').evaluate(v=>v.currentTime)).toBeGreaterThan(time);
  await page.locator(button).click();
 }
 await page.locator('#fullscreen').click();await page.locator('#focus-record').click();await expect(page.locator('#record')).toContainText('Stop');
 await expect.poll(()=>page.locator('#record').textContent()).toContain('2s');
 await page.locator('#focus-record').click();await page.locator('#exit-fullscreen').click();await expect(page.locator('#sessions')).toContainText('Play video');
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
 await page.locator('#reset-guide').click();
 for(const [key,value] of Object.entries({cx:.5,cy:.5,scale:.32,rotation:0,circleSeparation:1}))await expect(page.locator(`[data-config="${key}"]`)).toHaveValue(String(value));
 await expect(page.locator('#bpm')).toHaveValue('105');await expect(page.locator('#staff-count')).toHaveValue('1');await expect(page.locator('[data-config="mirror"]')).toBeChecked();
 await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'../review/browser-camera.png'});
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
test('color selection and background capture stay usable while the camera runs',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#background-capture')).toBeDisabled();
 await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.locator('[data-color="red"]').click();await page.locator('[data-color="blue"]').click();
 for(const color of ['red','blue'])await expect(page.locator(`[data-color="${color}"]`)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#color-summary')).toContainText(/red.*blue/i);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('klobflow.local.config')).staffColors)).toEqual(['red','blue']);
 await page.locator('[data-color=""]').click();await expect(page.locator('#color-summary')).toHaveText('All colors');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('klobflow.local.config')).staffColors)).toEqual([]);
 await page.locator('[data-color="white"]').click();await expect(page.locator('#tracking-label')).toContainText('Both staves tracked');
 await page.locator('#quick-background').click();await expect(page.locator('#background-overlay')).toBeVisible();
 await expect(page.locator('#streak-hud')).toBeHidden();
 await expect(page.locator('#background-overlay-title')).toContainText(/OUT OF VIEW/);
 const before=await page.locator('#local-video').evaluate(v=>v.currentTime);
 await expect.poll(()=>page.locator('#local-video').evaluate(v=>v.currentTime)).toBeGreaterThan(before+.6);
 await expect(page.locator('#quick-background')).toHaveText('Cancel background capture');
 await page.locator('#quick-background').click();await expect(page.locator('#background-overlay')).toBeHidden();
 await page.locator('#background-capture').click();await expect(page.locator('#background-clear')).toBeVisible({timeout:10000});
 await expect(page.locator('#background-overlay')).toBeHidden();
 await page.locator('[data-config="mirror"]').uncheck();await expect(page.locator('#background-clear')).toBeHidden();
 await page.locator('#background-capture').click();await expect(page.locator('#background-clear')).toBeVisible({timeout:10000});
 await page.locator('#background-clear').click();await expect(page.locator('#background-clear')).toBeHidden();
 await page.locator('#local-open').click();await expect(page.locator('#background-capture')).toBeDisabled();
 expect(errors).toEqual([]);
});
test('a transient source-start failure retries, while an occupied webcam stays recoverable',async({page})=>{
 await page.addInitScript(()=>{
  const real=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.openAttempts=0;
  navigator.mediaDevices.getUserMedia=async c=>{if(++window.openAttempts===1)throw new DOMException('Could not start video source','NotReadableError');return real(c);};
 });
 await page.goto('/');await page.locator('#local-open').click();
 await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 expect(await page.evaluate(()=>window.openAttempts)).toBe(2);
 await page.locator('#local-open').click();
 await page.evaluate(()=>{window.openAttempts=0;navigator.mediaDevices.getUserMedia=async()=>{window.openAttempts++;throw new DOMException('Could not start video source','NotReadableError');};});
 await page.locator('#local-open').click();await expect(page.locator('#message')).toContainText('Close other camera apps or tabs');
 expect(await page.evaluate(()=>window.openAttempts)).toBe(3);await expect(page.locator('#local-open')).toBeEnabled();await expect(page.locator('#record')).toBeDisabled();
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
 await page.locator('#audio-pc').click();await expect(page.locator('#audio-status')).toContainText(/(?:118|119|120|121|122) BPM.*confidence/,{timeout:25000});
 // Real AudioWorklet scheduling and the displayed message hold allow small estimator jitter.
 const bpmError=async(target)=>Math.abs(Number((await page.locator('#beat-pulse').textContent()).match(/^(\d+) BPM/)?.[1]??NaN)-target);
 await expect.poll(()=>bpmError(120)).toBeLessThanOrEqual(2);
 await page.locator('[data-config="audioRate"]').selectOption('0.5');await expect.poll(()=>bpmError(60)).toBeLessThanOrEqual(1);
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

test('unplug clears live scores and source state, then the camera can reopen',async({page})=>{
 await page.addInitScript(()=>{const open=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const stream=await open(c);window.fixtureTrack=stream.getVideoTracks()[0];return stream;};});
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.evaluate(()=>{window.fixtureTrack.stop();window.fixtureTrack.dispatchEvent(new Event('ended'));});
 await expect(page.locator('#tracking-title')).toHaveText('CAMERA DISCONNECTED');
 await expect(page.locator('#source-label')).not.toContainText('LIVE');await expect(page.locator('#connection')).toContainText('STOPPED');
 await expect(page.locator('#local-open')).toHaveText('Use PC camera');await expect(page.locator('#record')).toBeDisabled();await expect(page.locator('#deviation')).toContainText('—');
 await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA');
});

test('recording locks camera choices and restores rejected control values',async({page})=>{
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.locator('#record').click();await expect(page.locator('#record')).toContainText('Stop');
 for(const selector of ['#capture-target','#local-camera-select','#optimize-camera','[data-config="mirror"]'])await expect(page.locator(selector)).toBeDisabled();
 // A queued/programmatic change can still reach the rejection path after controls lock.
 await page.locator('[data-config="mirror"]').evaluate(e=>{e.checked=false;e.dispatchEvent(new Event('change'));});
 await expect(page.locator('[data-config="mirror"]')).toBeChecked();await expect(page.locator('#message')).toContainText('Stop recording');
 await page.locator('#record').click();await expect(page.locator('#record')).toContainText('Record practice');
 await expect(page.locator('#capture-target')).toBeEnabled();
 await page.locator('#bpm').fill('500');await page.locator('#bpm').dispatchEvent('change');await expect(page.locator('#bpm')).toHaveValue('120');
});

test('storage failure preserves immediate video and analysis exports in this tab',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){const request={};queueMicrotask(()=>{request.error=new DOMException('Storage is unavailable','SecurityError');request.onerror?.();});return request;}}});});
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.locator('#record').click();await expect(page.locator('#record')).toContainText('1s');await page.locator('#record').click();
 await expect(page.locator('#sessions')).toContainText('Kept only in this tab');
 for(const name of ['Download video','Export ↗']){
  const download=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();expect(await (await download).failure()).toBeNull();
 }
 await expect(page.locator('#message')).toContainText('Export this session now');
});

test('analysis interruption never removes the ability to finish a recording',async({page})=>{
 await page.addInitScript(()=>{const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(...args){super(...args);if(String(args[0]).includes('tracker-worker'))window.fixtureWorker=this;}};});
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.locator('#record').click();await expect(page.locator('#record')).toContainText('1s');await page.evaluate(()=>window.fixtureWorker.terminate());
 await expect(page.locator('#tracking-title')).toHaveText('NO FRESH FRAMES');await expect(page.locator('#record')).toBeEnabled();await page.locator('#record').click();
 await expect(page.locator('#sessions')).toContainText('Play video');
 // A reported fatal worker error also releases the source and saves without another camera frame.
 await page.locator('#local-open').click();await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA');
 await page.locator('#record').click();await expect(page.locator('#record')).toContainText('1s');
 await page.evaluate(()=>window.fixtureWorker.dispatchEvent(new ErrorEvent('error',{message:'fixture analysis failure'})));
 await expect(page.locator('#local-open')).toHaveText('Use PC camera');await expect(page.locator('#tracking-title')).toHaveText('CAMERA STOPPED');
 await expect(page.getByRole('button',{name:'Play video'})).toHaveCount(2);
});

test('overlay uses display resolution and short fullscreen keeps room for the camera',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await expect(page.locator('#tracking-brief')).toBeHidden();
 await expect.poll(()=>page.locator('#view').evaluate(c=>c.width)).toBeGreaterThan(640);
 const backing=await page.locator('#view').evaluate(c=>({width:c.width,shown:c.getBoundingClientRect().width}));expect(backing.width).toBeGreaterThanOrEqual(backing.shown*.95);
 await page.locator('[data-mode="antispin"]').click();await expect(page.locator('#antispin-footer')).toBeVisible();
 await page.locator('[data-config="tempoEnabled"]').check();await expect(page.locator('#beat-feedback')).toBeVisible();
 await page.setViewportSize({width:390,height:667});await page.locator('#fullscreen').click();
 // Clicking starts requestFullscreen asynchronously; CI can still report the ordinary 267px preview here.
 await expect(page.locator('#practice-view:fullscreen')).toBeVisible();
 await expect.poll(async()=> (await page.locator('#stage').boundingBox()).height).toBeGreaterThan(300);
 await expect.poll(async()=> (await page.locator('.status-row').boundingBox()).height).toBeLessThan(180);
 await expect(page.locator('#tracking-detail')).toBeHidden();await page.locator('#focus-details').click();await expect(page.locator('#tracking-detail')).toBeVisible();
 await page.locator('#focus-details').click();await expect(page.locator('#tracking-detail')).toBeHidden();
 await expect(page.locator('#tracking-brief')).toBeVisible();await expect(page.locator('#tracking-title')).toBeHidden();
 await page.setViewportSize({width:844,height:390});
 await expect.poll(async()=> (await page.locator('#stage').boundingBox()).height).toBeGreaterThan(260);
 const camera=await page.locator('#stage').boundingBox(),side=await page.locator('.status-row').boundingBox();expect(side.x).toBeGreaterThan(camera.x+camera.width);
});

test('visibility and page-cache events resume once, while an explicit stop stays stopped',async({page})=>{
 await page.addInitScript(()=>{const open=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.cameraOpens=0;navigator.mediaDevices.getUserMedia=async c=>{window.cameraOpens++;return open(c);};});
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));});
 await expect(page.locator('#tracking-title')).toHaveText('CAMERA PAUSED');await expect(page.locator('#record')).toBeDisabled();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA');expect(await page.evaluate(()=>window.cameraOpens)).toBe(2);
 await page.locator('#local-open').click();await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('#local-open')).toHaveText('Use PC camera');expect(await page.evaluate(()=>window.cameraOpens)).toBe(2);
});

test('a browser without camera support exits opening state and stays restartable',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined}));
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#tracking-title')).toHaveText('CAMERA DID NOT START');
 await expect(page.locator('#message')).toContainText('localhost or HTTPS');await expect(page.locator('#connection')).toContainText('STOPPED');await expect(page.locator('#local-open')).toBeEnabled();
});

test('a held streak label clears immediately when retained progress ends',async({page})=>{
 await page.addInitScript(()=>{const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{
  set onmessage(handler){super.onmessage=event=>{if(event.data.type==='frame'&&window.fixtureStreak)handler({data:{...event.data,frame:{...event.data.frame,streak:window.fixtureStreak}}});else handler(event);};}
 };window.fixtureStreak={state:'building',seconds:4,bestSeconds:4,level:2,energy:.4,progress:.4};});
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await expect(page.locator('#streak-title')).toContainText('FLOW STREAK');
 await page.evaluate(()=>window.fixtureStreak.state='held');await expect(page.locator('#streak-title')).toContainText('STREAK HELD',{timeout:1000});
 await page.evaluate(()=>{window.fixtureStreak={...window.fixtureStreak,state:'paused',seconds:0,progress:0};});
 await expect(page.locator('#streak-title')).toContainText('STREAK PAUSED',{timeout:1000});await expect(page.locator('#streak-hud')).toHaveAttribute('data-state','paused');
});

test('a delayed settings acknowledgement preserves newer edits, including the same field',async({page})=>{
 await page.addInitScript(()=>{const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{
  set onmessage(handler){super.onmessage=event=>{
   if(event.data.type==='config'&&window.holdNextConfig){window.holdNextConfig=false;window.releaseConfig=()=>{window.configHeld=false;handler(event);};window.configHeld=true;}
   else handler(event);
  };}
 };});
 await page.goto('/');await page.locator('#local-open').click();await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await page.evaluate(()=>window.holdNextConfig=true);await page.locator('[data-config="tempoEnabled"]').check();
 await expect.poll(()=>page.evaluate(()=>window.configHeld)).toBe(true);
 await page.locator('#bpm').fill('105');await page.evaluate(()=>window.releaseConfig());
 await expect(page.locator('#bpm')).toHaveValue('105');await page.locator('#bpm').dispatchEvent('change');await expect(page.locator('#beat-pulse')).toContainText('105 BPM');
 await page.evaluate(()=>window.holdNextConfig=true);await page.locator('#bpm').fill('100');await page.locator('#bpm').dispatchEvent('change');
 await expect.poll(()=>page.evaluate(()=>window.configHeld)).toBe(true);
 await page.locator('#bpm').fill('95');await page.evaluate(()=>window.releaseConfig());
 await expect(page.locator('#bpm')).toHaveValue('95');await page.locator('#bpm').dispatchEvent('change');await expect(page.locator('#beat-pulse')).toContainText('95 BPM');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('klobflow.local.config')).bpm)).toBe(95);
});
