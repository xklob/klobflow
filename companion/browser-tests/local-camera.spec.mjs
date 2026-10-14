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
