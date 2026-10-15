import {test,expect} from '@playwright/test';
import {writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const pageErrors=new WeakMap();
const controlledDemoClocks=new WeakSet();
const videoFile=join(tmpdir(),`klobflow-pacer-blank-${process.pid}.y4m`);
test.use({launchOptions:{executablePath:process.env.KLOBFLOW_BROWSER,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${videoFile}`]}});
test.beforeAll(()=>{
  const width=320,height=240,pixels=Buffer.alloc(width*height*1.5,128);pixels.fill(16,0,width*height);
  writeFileSync(videoFile,Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`),...Array.from({length:30},()=>[Buffer.from('FRAME\n'),pixels]).flat()]));
});
test.afterAll(()=>rmSync(videoFile,{force:true}));
test.beforeEach(async({page,request})=>{
  await request.post('/api/disconnect',{data:{}});
  const errors=[];pageErrors.set(page,errors);page.on('pageerror',e=>errors.push(e.message));
});
test.afterEach(async({page})=>expect(pageErrors.get(page)).toEqual([]));

async function range(page,id,value){
  await page.locator(id).fill(String(value));
  await page.locator(id).dispatchEvent('change');
  if(controlledDemoClocks.has(page))await page.clock.runFor(66);
}
async function paceSettings(page){
  if(!await page.locator('#pacer-options').evaluate(el=>el.open))await page.getByText('Pace settings',{exact:true}).click();
}
async function openDemo(page){
  await page.goto('/');await page.locator('#demo-start').click();
  await expect(page.locator('#stage-badge')).toBeVisible();
  await expect(page.locator('#stage-badge')).toHaveText('DEMO · GENERATED MOTION');
}
async function demo(page,mode='circles'){
  await openDemo(page);
  await page.locator(`[data-mode="${mode}"]`).click();
  await page.locator('[data-config="pacerEnabled"]').check();
  await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
  await paceSettings(page);
}
async function inspectTargetLabels(page){
  await page.addInitScript(()=>{
    const proto=CanvasRenderingContext2D.prototype,clear=proto.clearRect,fill=proto.fillText;
    window.pacerLabels=[];
    proto.clearRect=function(...args){
      if(this.canvas.id==='view')window.pacerLabels=[];
      return clear.apply(this,args);
    };
    proto.fillText=function(text,x,y,...args){
      if(this.canvas.id==='view'&&['H','V'].includes(text))window.pacerLabels.push({text,x,y});
      return fill.call(this,text,x,y,...args);
    };
  });
}
const targetLabels=page=>page.evaluate(()=>window.pacerLabels);
async function practiceTitles(page,tracking,coaching=tracking){
  await expect(page.locator('#tracking-title, #coaching-title')).toHaveText([tracking,coaching],{timeout:900});
}
async function runningTitles(page){
  // Explicit exercise actions bypass the ordinary 2.6-second feedback hold.
  await Promise.all([
    expect(page.locator('#tracking-title')).not.toContainText(/READY|PAUSED/,{timeout:900}),
    expect(page.locator('#coaching-title')).not.toContainText(/READY|PAUSED/,{timeout:900}),
    expect(page.locator('#streak-title')).not.toContainText('guide dots are stopped',{timeout:900}),
  ]);
}
async function fullscreenFits(page,viewport){
  await expect.poll(()=>page.evaluate(minimumHeight=>{
    const view=document.querySelector('#practice-view'),bounds=view.getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect();
    return {
      horizontal:view.scrollWidth<=view.clientWidth+1&&bounds.left>=-1&&bounds.right<=innerWidth+1,
      vertical:view.scrollHeight<=view.clientHeight+1,
      wholePreview:stage.top>=0&&stage.bottom<=innerHeight+1,
      usablePreview:stage.height>minimumHeight,
    };
  },viewport.height>500?300:90)).toEqual({horizontal:true,vertical:true,wholePreview:true,usablePreview:true});
}

test('moving guides require Start and support countdown, pause, resume, restart and stop',async({page})=>{
  await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
  await demo(page);
  // Exercise UI transitions with continuous model time; host stalls belong to the separate gap tests.
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  controlledDemoClocks.add(page);
  await expect(page.locator('#pacer-start')).toBeVisible();
  await expect(page.locator('#pacer-pause')).toBeHidden();
  await expect(page.locator('#pacer-restart')).toBeHidden();
  await expect(page.locator('#pacer-stop')).toBeHidden();
  // Enabling the exercise alone must never start the motion clock.
  await page.clock.runFor(400);
  await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
  await practiceTitles(page,'GUIDE DOTS READY','READY TO FOLLOW');
  await range(page,'#pacer-countdown',3);
  await page.locator('#pacer-start').click();
  await expect(page.locator('#pacer-title')).toHaveText(/START IN [1-3]/,{timeout:900});
  await practiceTitles(page,'GET READY');
  await expect(page.locator('#pacer-stats')).toContainText('Scoring begins when the dots move');
  await page.locator('#pacer-pause').click();
  await expect(page.locator('#pacer-title')).toHaveText('DOTS PAUSED',{timeout:900});
  await practiceTitles(page,'GUIDE DOTS PAUSED');
  await page.locator('#pacer-resume').click();
  await expect(page.locator('#pacer-title')).toHaveText(/START IN [1-3]/,{timeout:900});
  await practiceTitles(page,'GET READY');
  await page.clock.runFor(3100);
  await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS',{timeout:900});
  await runningTitles(page);
  await expect(page.locator('#pacer-stats')).toContainText(/Last 5s.*\d+% with dots/);
  await page.locator('#pacer-restart').click();
  await expect(page.locator('#pacer-title')).toHaveText(/START IN [1-3]/,{timeout:900});
  await practiceTitles(page,'GET READY');
  await page.locator('#pacer-stop').click();
  await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW',{timeout:900});
  await practiceTitles(page,'GUIDE DOTS READY','READY TO FOLLOW');
  await expect(page.locator('#streak-title')).toContainText('guide dots are stopped',{timeout:900});
  await range(page,'#pacer-countdown',0);
  await page.locator('#pacer-start').click();
  await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS',{timeout:900});
  await runningTitles(page);
  await range(page,'#pacer-dot-size',24);
  await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
  await range(page,'#pacer-rpm',31);
  await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
  await page.locator('#pacer-start').click();
  await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
  await range(page,'[data-config="rotation"]',15);
  await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
});

test('returning from analysis replay leaves demo moving guides ready for a new Start',async({page})=>{
  const {demoFrame,defaults,resetDemoPacer}=await import('../public/demo.mjs');
  resetDemoPacer();
  const frame={...demoFrame({...defaults,mode:'circles',pacerEnabled:true,pacerCountdown:0},1000),elapsedMs:0};
  const buffer=Buffer.from([{type:'header',schema:1},frame].map(row=>JSON.stringify(row)).join('\n'));
  await demo(page);await range(page,'#pacer-countdown',0);
  await page.locator('#pacer-start').click();
  await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS',{timeout:900});
  // Freeze only the demo clock so the 750ms suspend guard cannot mask a missing replay reset.
  await page.evaluate(()=>{const now=performance.now();Object.defineProperty(performance,'now',{configurable:true,value:()=>now});});
  await page.locator('#import-analysis').setInputFiles({name:'pacer-replay.jsonl',mimeType:'application/x-ndjson',buffer});
  await expect(page.locator('#stage-badge')).toHaveText('ANALYSIS REPLAY · NO VIDEO');
  await page.locator('#return-live').click();
  await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW',{timeout:900});
  await practiceTitles(page,'GUIDE DOTS READY','READY TO FOLLOW');
  await expect(page.locator('#pacer-start')).toBeEnabled();
  await expect(page.locator('#pacer-pause')).toBeHidden();
  await page.locator('#pacer-start').click();
  await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS',{timeout:900});
  await runningTitles(page);
});

test('mode-specific settings and beat feedback follow the effective moving-guide mode',async({page})=>{
  await openDemo(page);
  await expect(page.locator('#pacer-settings')).toBeHidden();
  await page.locator('[data-mode="circles"]').click();
  await expect(page.locator('#pacer-settings')).toBeVisible();
  await page.locator('[data-config="tempoEnabled"]').check();
  await expect(page.locator('#beat-feedback')).toBeVisible();
  await page.locator('[data-config="pacerEnabled"]').check();
  await expect(page.locator('#beat-feedback')).toBeHidden();
  await paceSettings(page);
  for(const [id,min,max] of [['#pacer-rpm','5','120'],['#pacer-countdown','0','10'],['#pacer-dot-size','8','28'],['#pacer-offset','0','180']]){
    await expect(page.locator(id)).toHaveAttribute('min',min);
    await expect(page.locator(id)).toHaveAttribute('max',max);
  }
  await expect(page.locator('#pacer-second-staff')).toBeVisible();
  await page.locator('[data-config="pacerDirection"]').selectOption('ccw');
  await page.locator('[data-config="pacerPattern"]').selectOption('same');
  await range(page,'#pacer-offset',90);
  await page.locator('#staff-count').selectOption('1');
  await expect(page.locator('#pacer-second-staff')).toBeHidden();
  await page.locator('#staff-count').selectOption('2');
  await expect(page.locator('#pacer-second-staff')).toBeVisible();
  await expect(page.locator('#pacer-offset')).toHaveValue('90');
  await page.locator('[data-mode="antispin"]').click();
  await expect(page.locator('#pacer-settings')).toBeVisible();
  await expect(page.locator('#pacer-second-staff')).toBeHidden();
  await expect(page.locator('#staff-count')).toHaveValue('1');
  await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
  await page.locator('[data-mode="grid"]').click();
  await expect(page.locator('#pacer-settings')).toBeHidden();
  await expect(page.locator('#pacer-bar')).toBeHidden();
  await expect(page.locator('#beat-feedback')).toBeVisible();
  await page.locator('[data-mode="circles"]').click();
  await expect(page.locator('[data-config="pacerEnabled"]')).toBeChecked();
  await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
  await page.locator('[data-config="pacerEnabled"]').uncheck();
  await expect(page.locator('#pacer-bar')).toBeHidden();
  await expect(page.locator('#beat-feedback')).toBeVisible();
});

test('reduced motion preserves essential moving targets and Pause freezes their positions',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await inspectTargetLabels(page);
  await demo(page,'antispin');await range(page,'#pacer-countdown',0);
  await page.locator('#pacer-start').click();
  await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
  await expect.poll(async()=>(await targetLabels(page)).map(p=>p.text).sort()).toEqual(['H','V']);
  const running=await targetLabels(page);
  await expect.poll(()=>targetLabels(page)).not.toEqual(running);
  await page.locator('#pacer-pause').click();
  await expect(page.locator('#pacer-title')).toHaveText('DOTS PAUSED');
  const paused=await targetLabels(page);
  await page.waitForTimeout(350);
  expect(await targetLabels(page)).toEqual(paused);
  await page.locator('#pacer-resume').click();
  await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
  await expect.poll(()=>targetLabels(page)).not.toEqual(paused);
});

for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1920,height:1080}]){
  test(`large-text moving-guide controls fit ${viewport.width}×${viewport.height} and remain reachable in fullscreen`,async({page})=>{
    await page.setViewportSize(viewport);await demo(page,'antispin');
    await page.locator('#ui-size').selectOption('large');
    await range(page,'#pacer-dot-size',28);await range(page,'#pacer-countdown',0);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('#fullscreen').click();
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
    await expect(page.locator('#pacer-start')).toBeInViewport({ratio:1});
    await fullscreenFits(page,viewport);
    await page.locator('#pacer-start').click();
    await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
    await expect(page.locator('#pacer-pause')).toBeInViewport({ratio:1});
    await fullscreenFits(page,viewport);
    await page.locator('#pacer-pause').click();
    await expect(page.locator('#pacer-title')).toHaveText('DOTS PAUSED');
    for(const id of ['#pacer-resume','#pacer-restart','#pacer-stop','#exit-fullscreen'])await expect(page.locator(id)).toBeInViewport({ratio:1});
    await fullscreenFits(page,viewport);
    if(viewport.height<500){
      await page.locator('#focus-details').click();
      await expect(page.locator('#focus-details')).toHaveAttribute('aria-expanded','true');
      await expect(page.locator('#coaching-detail')).toBeVisible();
      await fullscreenFits(page,viewport);
      for(const id of ['#pacer-resume','#pacer-restart','#pacer-stop','#exit-fullscreen'])await expect(page.locator(id)).toBeInViewport({ratio:1});
      await page.locator('#focus-details').click();
      await expect(page.locator('#focus-details')).toHaveAttribute('aria-expanded','false');
      await fullscreenFits(page,viewport);
    }
    await page.locator('#pacer-stop').click();
    await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
    await page.locator('#exit-fullscreen').click();
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
  });
}

test.describe('PC camera moving guides',()=>{
  test('worker commands persist settings without persisting runtime or scoring missing tips',async({page})=>{
    // Auto-reopen is conditional on a persisted granted permission, not merely accepting a fake prompt.
    await page.context().grantPermissions(['camera']);
    await inspectTargetLabels(page);
    await page.addInitScript(()=>{
      if(!localStorage.getItem('klobflow.local.config'))localStorage.setItem('klobflow.local.config',JSON.stringify({mode:'antispin',pacerEnabled:true,pacerCountdown:0}));
      const OriginalWorker=window.Worker;window.pacerWorkerCommands=[];window.pacerWorkerFrame=null;
      window.Worker=class extends OriginalWorker{
        constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='frame')window.pacerWorkerFrame=data.frame;});}
        postMessage(data,...args){
          if(data.type==='pacer'||data.type==='config')window.pacerWorkerCommands.push({type:data.type,operation:data.operation,config:data.config});
          return super.postMessage(data,...args);
        }
      };
    });
    await page.goto('/');await page.locator('#local-open').click();
    await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
    await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
    await paceSettings(page);
    await range(page,'#pacer-rpm',35);
    await page.locator('[data-config="pacerDirection"]').selectOption('ccw');
    await range(page,'#pacer-dot-size',22);
    await page.locator('#pacer-start').click();
    await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
    await expect.poll(()=>page.evaluate(()=>window.pacerWorkerCommands.some(c=>c.type==='pacer'&&c.operation==='start'))).toBe(true);
    await expect.poll(async()=>(await targetLabels(page)).map(p=>p.text).sort()).toEqual(['H','V']);
    const before=await targetLabels(page);await expect.poll(()=>targetLabels(page)).not.toEqual(before);
    const measured=await page.evaluate(()=>window.pacerWorkerFrame);
    expect(measured.config).toMatchObject({pacerRpm:35,pacerDirection:'ccw',pacerDotSize:22});
    expect(measured.pacer.valid).toBe(false);expect(measured.pacer.meanError).toBeNull();
    expect(measured.pacer.onTargetPercent).toBeNull();expect(measured.streak.seconds).toBe(0);
    await expect(page.locator('#pacer-stats')).not.toContainText(/100%|NaN/);
    await page.locator('#pacer-pause').click();
    await expect(page.locator('#pacer-title')).toHaveText('DOTS PAUSED');
    await page.locator('#pacer-resume').click();
    await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
    await page.locator('#pacer-restart').click();
    await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
    await page.locator('#pacer-stop').click();
    await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
    await page.locator('#pacer-start').click();
    await expect(page.locator('#pacer-title')).toHaveText('FOLLOW THE DOTS');
    await expect.poll(()=>page.evaluate(()=>window.pacerWorkerCommands.filter(c=>c.type==='pacer').map(c=>c.operation))).toEqual(['start','pause','resume','restart','stop','start']);
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('klobflow.local.config')))).toMatchObject({pacerEnabled:true,pacerRpm:35,pacerDirection:'ccw',pacerDotSize:22,pacerCountdown:0});
    // The granted camera source reopens automatically; the exercise must still wait for Start.
    await page.reload();
    await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PC CAMERA',{timeout:30000});
    await expect(page.locator('#pacer-title')).toHaveText('READY TO FOLLOW');
    await paceSettings(page);
    await expect(page.locator('#pacer-rpm')).toHaveValue('35');
    await expect(page.locator('[data-config="pacerDirection"]')).toHaveValue('ccw');
    await expect(page.locator('#pacer-dot-size')).toHaveValue('22');
    expect(await page.evaluate(()=>window.pacerWorkerCommands.some(c=>c.type==='pacer'))).toBe(false);
    await page.locator('#local-open').click();
  });
});
