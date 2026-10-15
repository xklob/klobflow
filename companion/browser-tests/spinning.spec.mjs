import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spinFrame} from '../test/motion-fixture.mjs';
const width=320,height=240,path=join(tmpdir(),'klobflow-spinning-rainbow.y4m');
const frames=[Buffer.from(`YUV4MPEG2 W${width} H${height} F60:1 Ip A1:1 C420jpeg\n`)];
for(let i=0;i<360;i++){
 const spinning=i>=90&&i<300,theta=spinning?.8+(i-90)*.15:.8;
 const rgb=spinFrame({angle:theta,sweep:spinning?.5:0,rainbow:true,gap:.08}),yuv=Buffer.alloc(width*height*1.5);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=rgb[y*width+x],r=(p>>>16)&255,g=(p>>>8)&255,b=p&255;yuv[y*width+x]=Math.round(16+.257*r+.504*g+.098*b);
  if(x%2===0&&y%2===0){let u=0,v=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const q=rgb[(y+dy)*width+x+dx],r=(q>>>16)&255,g=(q>>>8)&255,b=q&255;u+=128-.148*r-.291*g+.439*b;v+=128+.439*r-.368*g-.071*b;}
   const index=(y/2)*(width/2)+x/2;yuv[width*height+index]=Math.round(u/4);yuv[width*height*1.25+index]=Math.round(v/4);
  }
 }
 frames.push(Buffer.from('FRAME\n'),yuv);
}
writeFileSync(path,Buffer.concat(frames));
test.use({launchOptions:{executablePath:process.env.KLOBFLOW_BROWSER,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${path}`]}});
test('rainbow spins stay observed, blur is explained, and clear frames regain precision',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('klobflow.local.config',JSON.stringify({staffCount:1,autoFit:false,mirror:false})));
 await page.goto('/');await page.locator('#local-open').click();
 await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
 await expect(page.locator('#tracking-label')).toContainText('One staff tracked',{timeout:15000});
 await expect(page.locator('#camera-profile')).toContainText('camera reports');
 await page.locator('#record').click();
 await expect(page.locator('#coaching-title')).toHaveText('PRECISION PAUSED',{timeout:8000});
 await expect(page.locator('.feedback-legend')).toContainText('move that tip to the white bullseye');
 await expect(page.locator('#record')).toContainText('6s',{timeout:10000});await page.locator('#record').click();
 await expect(page.locator('#sessions')).toContainText('Play video');
 const rows=await page.evaluate(async()=>{const {listSessions}=await import('/sessions.mjs');return (await (await listSessions())[0].analysis.text()).trim().split('\n').slice(1).map(JSON.parse);});
 const blurred=rows.filter(f=>f.staffs[0]?.blurred&&!f.staffs[0].occluded);
 expect(blurred.length).toBeGreaterThan(15);expect(blurred.every(f=>f.metrics.deviation===null)).toBe(true);
 expect(blurred.every(f=>['paused','held'].includes(f.streak.state))).toBe(true);
 for(let i=1;i<rows.length;i++)if(rows[i-1].staffs[0]?.blurred&&rows[i].staffs[0]?.blurred&&rows[i].streak.state==='held')expect(rows[i].streak.seconds).toBeLessThanOrEqual(rows[i-1].streak.seconds);
 expect(rows.every(f=>Number.isFinite(f.streak.seconds))).toBe(true);
 expect(rows.some(f=>f.metrics.deviation!==null)).toBe(true);
 expect(rows.filter(f=>f.staffs[0]&&!f.staffs[0].occluded).length/rows.length).toBeGreaterThan(.9);
 await page.screenshot({path:'../review/rainbow-spin-browser.png'});expect(errors).toEqual([]);
});
