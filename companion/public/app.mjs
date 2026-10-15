import { defaults, demoFrame, demoPacerCommand, resetDemoPacer } from "./demo.mjs";
import { FrameDecoder } from "./stream.mjs";
import { BrowserCamera } from "./browser-camera.mjs";
import {SystemAudio} from "./system-audio.mjs";
import {length,patchConfig} from "./core.mjs";
import {AlignmentFeedback,StableText,direction,capturingBackground} from './feedback.mjs';
import {staffColorNames} from './staff-colors.mjs';
import {FlowStreak,streakText} from './streak.mjs';
const fallbackStreak=new FlowStreak(),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const alignmentFeedback=new AlignmentFeedback();let displayedFeedback={tips:[],state:'paused'};
const $ = (id) => document.getElementById(id);
// Legacy phone packets and older exports have no averagedMetrics. Average them here when the
// shared helper is available; otherwise show the latest sample and label it honestly.
let RollingErrors=null,legacyRolling=null;const legacyAverages=new WeakMap();
const rollingReady=import('./rolling-errors.mjs').then(m=>{RollingErrors=m.RollingErrors||null;}).catch(()=>{});
function averagedFor(f){return f.averagedMetrics&&typeof f.averagedMetrics==='object'?f.averagedMetrics:legacyAverages.get(f)||null;}
function averageLegacy(f,rolling){
  if(f.averagedMetrics||!f.metrics||!RollingErrors)return rolling;
  try{rolling??=new RollingErrors();const out=rolling.update(f.time,f.metrics,f.config);if(out&&typeof out==='object')legacyAverages.set(f,out);}catch{}
  return rolling;
}
// Text size for viewing from across the room. Canvas labels scale with it; the canvas itself is never zoomed.
const uiSizes={compact:.85,comfortable:1,large:1.2};
function applyUiSize(size,{preserveScroll=false}={}){
  if(!(size in uiSizes))size='comfortable';
  // Preserve the section being read, not its old pixel scroll offset, as the text grows.
  const anchors=preserveScroll?[...document.querySelectorAll('.controls,.details')].flatMap(panel=>{
    const bounds=panel.getBoundingClientRect(),top=Math.max(0,bounds.top),bottom=Math.min(innerHeight,bounds.bottom);
    if(bottom<=top||panel.scrollTop<=0||panel.scrollHeight<=panel.clientHeight)return [];
    const visible=el=>{const r=el.getBoundingClientRect();return r.height>0&&r.bottom>top&&r.top<bottom;};
    const meter=panel.querySelector('.audio-meters');
    const element=meter&&visible(meter)?meter:[...panel.children].filter(visible).sort((a,b)=>Math.abs(a.getBoundingClientRect().top-top)-Math.abs(b.getBoundingClientRect().top-top))[0];
    return element?[{panel,element,top:element.getBoundingClientRect().top}]:[];
  }):[];
  document.documentElement.dataset.uiSize=size;$('ui-size').value=size;
  for(const {panel,element,top} of anchors)if(panel.scrollHeight>panel.clientHeight){
    panel.scrollTop+=element.getBoundingClientRect().top-top;
    if(element.classList.contains('audio-meters'))element.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  }
  try{localStorage.setItem('klobflow.uiSize',size);}catch{}
}
// Fades a status box: the old text fades out, then the new text fades in, so two paragraphs never overlap.
// StableText decides when a change may show; urgent changes (for example losing tracking) replace it at once.
class FadeBox {
  constructor(id,{hold=2600,urgent=()=>false,fade=1400}={}){
    this.root=$(id);this.live=this.root.querySelector('.fade-live');
    this.stable=new StableText(hold);this.urgent=urgent;this.fade=fade;this.displayed=null;this.token=0;
  }
  reset(){this.stable.reset();}
  // The content currently on screen (a held change may still be fading out).
  get shown(){return this.displayed;}
  show(content,{immediate=false}={}){
    const now=performance.now(),previous=this.stable.shown;
    const change=immediate?this.stable.force(now,content):this.stable.update(now,content,!!previous&&this.urgent(previous,content));
    if(!change)return false;
    const token=++this.token,half=change.first||change.urgent||reducedMotion.matches?0:this.fade/2;
    for(const a of this.live.getAnimations())a.cancel();
    const apply=()=>{this.root.style.setProperty('--fade',`${half}ms`);if(content.tone)this.root.dataset.tone=content.tone;content.render();this.displayed=content;};
    if(!half){apply();return true;}
    const out=this.live.animate([{opacity:1},{opacity:0}],{duration:half,easing:'ease-in',fill:'forwards'});
    out.onfinish=()=>{if(token!==this.token)return;apply();out.cancel();this.live.animate([{opacity:0},{opacity:1}],{duration:half,easing:'ease-out'});};
    return true;
  }
}
const inactive=state=>state==='paused'||state==='idle';
// Compact fullscreen keeps the coverage value legible without splitting MEASURED across lines.
function syncTrackingBrief(){const title=$('tracking-title').textContent,coverage=title.match(/^(\d+)% MEASURED$/);$('tracking-brief').textContent=coverage?coverage[1]+'%':title;$('tracking-short-label').textContent=coverage?'Measured':'Tracking';}
new MutationObserver(syncTrackingBrief).observe($('tracking-title'),{childList:true,subtree:true,characterData:true});syncTrackingBrief();
const trackingBox=new FadeBox('tracking-box',{urgent:(shown,next)=>shown.pacerState!==next.pacerState||shown.tone==='ok'&&next.tone!=='ok'||next.snapshot!==shown.snapshot});
// Text that names drawn arrows/targets must appear and disappear with them, never fade over absent marks.
const coachingBox=new FadeBox('coaching',{urgent:(shown,next)=>shown.pacerState!==next.pacerState||shown.mode!==next.mode||shown.cues&&!next.cues||shown.state==='aligned'&&next.state!=='aligned'||inactive(next.state)&&!inactive(shown.state)});
const timingBox=new FadeBox('beat-feedback',{urgent:(shown,next)=>shown.paused!==next.paused||Math.abs(shown.bpm-next.bpm)>3});
const streakBox=new FadeBox('streak-hud',{urgent:(shown,next)=>shown.pacerState!==next.pacerState||shown.state==='building'&&next.state!=='building'||['held','recovering'].includes(shown.state)&&['paused','ready'].includes(next.state)||['off','free'].includes(next.state)});
const canvas = $("view"),
  ctx = canvas.getContext("2d"),
  chart = $("chart"),
  chartCtx = chart.getContext("2d");
let config = { ...defaults },
  paired = false,
  localMode = false,
  localStarting = false,
  demo = false,
  replay = null,
  current = null,
  lastTime = null,
  lastArrival = 0,
  seeding = false,
  calibrating = false,
  transport = "lan",
  picks = [],
  lastImage = null;
let streamController = null, nextStreamAt = 0, arrivals = [], previewFps = 0, lastConfigText = "", sourceStalled = false;
let trail = [],
  history = [];
const localCamera = new BrowserCamera($("local-video"), {
  onFrame: f => { if (localMode && !replay) { lastArrival = Date.now(); syncConfig(f.currentConfig); acceptFrame(f); } },
  onStatus: text => { if (localMode) { message(text); enableControls(); } },
  onSessions: () => { if (localMode) loadSessions(); },
  onState: () => {
    if (!localMode) return;
    // Lifecycle changes can arrive without another analyzed frame (unplug, hide, encoder failure).
    if (!localCamera.active && !replay) { resetView(); setCoaching(null, localCamera.phase); }
    connected(false); updateSourceControls();
  },
});
async function updateDeviceList() {
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  $("local-camera-select").replaceChildren(...cameras.map((d,i) => Object.assign(document.createElement("option"), { value: d.deviceId, textContent: d.label || `Camera ${i+1}` })));
  $("local-camera-select").value = localCamera.deviceId || cameras[0]?.deviceId || "";
}
// A failed camera start stays visible (stage and Tracking box) until the next attempt or source change.
let cameraError = "";
function showCameraError(text) {
  cameraError = text || "";
  $("empty-error").hidden = !cameraError; $("empty-error").textContent = "The PC camera did not start. The Tracking box says what to try.";
  if (!current) setCoaching(null);
}
async function startLocal(recheck = false) {
  if (localStarting) return;
  if (localCamera.recording || localCamera.finalizing) { message("Stop recording before changing camera settings."); return; }
  localStarting = true;
  try {
    if (paired) await api("/api/disconnect", {});
    stopStream(); paired = false; demo = false; replay = null; localMode = true;
    resetView(); showCameraError(""); updateSourceControls(); syncConfig(localCamera.config);
    await localCamera.start({deviceId: $("local-camera-select").value || undefined, target: $("capture-target").value, reuse: !recheck && !!localCamera.profile});
    await updateDeviceList();
    updateCameraDetails();
    try { localStorage.setItem("klobflow.lastMode", "local"); } catch {}
    connected(false); loadSessions();
  } catch (e) {
    showCameraError(e.message); message(e.message);
    // An unplugged or renamed webcam must be selectable again without reloading the page.
    try { await updateDeviceList(); } catch {}
  }
  finally { localStarting = false; updateSourceControls(); }
}
function updateSourceControls() {
  $("local-video").hidden = !localMode || !!replay;
  $("local-camera-settings").hidden = !localMode;
  $("phone-camera-setting").hidden = localMode;
  $("phone-fps-setting").hidden = localMode;
  $("local-open").disabled = localStarting;
  $("local-stage").disabled = localStarting;
  $("local-open").textContent = localMode && localCamera.active ? "Stop PC camera" : "Use PC camera";
  $("optimize-camera").disabled = localStarting || localCamera.recording || localCamera.finalizing;
  $("local-camera-select").disabled = localStarting || localCamera.recording || localCamera.finalizing;
  $("capture-target").disabled = localStarting || localCamera.recording || localCamera.finalizing;
  enableControls();
}
$("local-open").onclick = async () => {
  if (localMode && localCamera.active) { localCamera.resumeOnVisible = false; await localCamera.stop(); resetView(); connected(false); updateSourceControls(); }
  else startLocal();
};
$("local-stage").onclick = () => startLocal();
$("local-camera-select").onchange = () => { localCamera.profile = null; startLocal(true); };
$("capture-target").onchange = () => startLocal(true);
$("optimize-camera").onclick = () => startLocal(true);
let exposurePending=false;
$('camera-exposure').onchange=async()=>{
  exposurePending=true;$('camera-exposure').disabled=true;
  try{await localCamera.exposure($('camera-exposure').value);}
  catch(e){message(e.message);$('camera-exposure').value=localCamera.exposureChoice||'auto';}
  finally{exposurePending=false;updateCameraDetails();}
};
function updateCameraDetails(frame=null){
 if(!localMode||!localCamera.active)return;
 const settings=localCamera.settings,profile=localCamera.profile,caps=localCamera.track?.getCapabilities?.()||{};
 const measured=frame?.cameraFps||localCamera.cameraFps||profile.measuredFps;
 $('camera-profile').textContent=`${settings.width} × ${settings.height} · requested ${Math.round(profile.requestedFps||profile.fps)} fps · camera reports ${Math.round(settings.frameRate||0)} fps · ${Math.round(measured)} fps measured live.`+(measured<(settings.frameRate||0)*.8?' Delivery is below the configured rate. Try shorter exposure and check lighting or USB bandwidth.':'');
 $('camera-probes').textContent=(localCamera.probes||[]).map(p=>`${p.width} × ${p.height}: ${Math.round(p.measuredFps)} fps measured, ${Math.round(p.reportedFps||0)} fps reported`).join('; ');
 const supported=!!caps.exposureTime&&caps.exposureMode?.includes('manual');
 $('camera-exposure').disabled=!supported||exposurePending;
 $('camera-exposure').options[0].disabled=supported&&!caps.exposureMode?.includes('continuous');
 if(!exposurePending)$('camera-exposure').value=localCamera.exposureChoice||'auto';
 $('exposure-info').textContent=!supported?'This webcam does not expose shutter control here. Shorten exposure or disable low-light compensation in its camera software.':settings.exposureMode==='manual'&&settings.exposureTime?`Actual exposure: about 1/${Math.round(10000/settings.exposureTime)} s. Shorter settings reduce blur but darken the image.`:'Automatic exposure can lengthen light trails. Try Short or Shorter for spinning; add light if the image gets too dark.';
}
let tutorials={},tutorialMode='';
fetch('/practice-guides.json').then(r=>r.json()).then(data=>{tutorials=data;showTutorial(false);}).catch(()=>{});
function showTutorial(force=false){
  const guide=tutorials[config.mode];if(!guide)return;let dismissed=false;try{dismissed=localStorage.getItem('klobflow.tutorial.'+config.mode)==='1';}catch{}
  $('mode-tutorial').hidden=!force&&dismissed;$('tutorial-title').textContent=guide.title;$('tutorial-steps').replaceChildren(...guide.steps.map(text=>Object.assign(document.createElement('li'),{textContent:text})));tutorialMode=config.mode;expandTutorial(force);
}
function expandTutorial(expanded){$('mode-tutorial').classList.toggle('expanded',expanded);$('tutorial-expand').setAttribute('aria-expanded',String(expanded));$('tutorial-expand').textContent=expanded?'Show first step':'Read all 4 steps';}
$('tutorial-expand').onclick=()=>expandTutorial($('tutorial-expand').getAttribute('aria-expanded')!=='true');
$('show-tutorial').onclick=()=>showTutorial(true);
$('dismiss-tutorial').onclick=()=>{try{localStorage.setItem('klobflow.tutorial.'+config.mode,'1');}catch{}$('mode-tutorial').hidden=true;};
try{applyUiSize(localStorage.getItem('klobflow.uiSize')||'comfortable');}catch{applyUiSize('comfortable');}
$('ui-size').onchange=()=>applyUiSize($('ui-size').value,{preserveScroll:true});
// Overlay labels are sized in screen pixels, so track how large the canvas is displayed.
let viewBox={width:0,height:0},hudBox=null;
// Canvas labels avoid the streak box drawn over the stage (measured after layout, not every frame).
function measureHud(){const e=$('streak-hud');hudBox=e.hidden||e.parentElement!==$('stage')?null:{x:e.offsetLeft-canvas.offsetLeft,y:e.offsetTop-canvas.offsetTop,w:e.offsetWidth,h:e.offsetHeight};}
new ResizeObserver(([entry])=>{viewBox=entry.contentRect;measureHud();if(current)render(current,lastImage);}).observe(canvas);
// MAX POWER may wrap the HUD: reposition canvas labels even on a paused replay.
new ResizeObserver(()=>{measureHud();if(current)render(current,lastImage);}).observe($('streak-hud'));
new ResizeObserver(([entry])=>{chartBox=entry.contentRect;rootPx=parseFloat(getComputedStyle(document.documentElement).fontSize)||20;drawChart();}).observe(chart);
const setText=(id,text)=>{const e=$(id);if(e.textContent!==text)e.textContent=text;};
// Keep the whole preview on screen: the stage gets the height left below the toolbar and status boxes.
function fitStage(){
  if(document.fullscreenElement)return;
  const stage=$('stage'),top=stage.getBoundingClientRect().top+scrollY;
  const footer=$('antispin-footer');
  stage.style.setProperty('--stage-max-h',`${Math.round(Math.max(160,innerHeight-top-12-(footer.hidden?0:footer.offsetHeight+14)))}px`);
}
function setPracticing(on){if(document.body.classList.contains('practicing')!==on){document.body.classList.toggle('practicing',on);fitStage();}}
addEventListener('resize',fitStage);document.addEventListener('fullscreenchange',fitStage);
const layoutWatch=new ResizeObserver(()=>fitStage());for(const e of [document.querySelector('header'),document.querySelector('.stage-toolbar'),document.querySelector('.quick-actions'),document.querySelector('.status-row'),$('antispin-footer')])layoutWatch.observe(e);
// LED colors: an empty list means any color, including rainbow patterns.
const colorNames=colors=>colors.map(c=>c[0].toUpperCase()+c.slice(1)).join(' + ');
for(const chip of document.querySelectorAll('#staff-colors .chip'))chip.onclick=()=>{
  const color=chip.dataset.color,selected=new Set(config.staffColors||[]);
  if(!color)selected.clear();else if(selected.has(color))selected.delete(color);else selected.add(color);
  patch({staffColors:staffColorNames.filter(n=>selected.has(n))});
};
function detectionSummary(c,state='off'){
  const colors=c.staffColors||[],led=c.led===false?'LED detection off (edge mode)':colors.length?`Detecting ${colorNames(colors)} LEDs only`:'Detecting LEDs of any color';
  return `${led} · ${state==='ready'?'background snapshot on':state==='countdown'||state==='capturing'?'capturing background':'no background snapshot'}`;
}
// Background snapshot: a steady countdown overlay the user can read from across the room.
async function backgroundCommand(mode){try{await api('/api/control',{action:'background',mode});trail=[];}catch(e){message(e.message);}}
$('background-capture').onclick=()=>backgroundCommand('capture');
$('background-cancel').onclick=()=>backgroundCommand('cancel');
$('background-clear').onclick=()=>backgroundCommand('clear');
$('quick-fit').onclick=()=>$('fit-guide').click();
$('quick-background').onclick=()=>backgroundCommand(['countdown','capturing'].includes(current?.background?.state)?'cancel':'capture');
$('quick-lights').onclick=()=>{const colors=$('staff-colors');colors.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});colors.querySelector('button:not(:disabled)')?.focus({preventScroll:true});};
$('quick-audio').onclick=()=>{const audio=$('audio-controls');audio.scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'start'});audio.focus({preventScroll:true});};
const pacerSupported=c=>['circles','antispin'].includes(c.mode);
let pacerBusy=false,pacerReadingAt=0,pacerReadingState='';
function showPacer(f=current){
  const enabled=pacerSupported(config)&&config.pacerEnabled,p=f?.pacer;
  $('pacer-settings').hidden=!pacerSupported(config);$('pacer-options').hidden=!enabled;
  $('pacer-second-staff').hidden=config.mode!=='circles'||config.staffCount!==2;
  $('pacer-bar').hidden=!enabled;
  setText('pacer-help',config.mode==='antispin'?'Follow H along the horizontal line and V along the vertical line. The dot pair keeps a constant staff length.':'Match both staff ends to their blue A or B dots. Each pair stays one diameter apart.');
  if(!enabled)return;
  const state=p?.enabled&&p.state!=='off'?p.state:'ready',stalled=sourceStalled&&!replay;
  $('pacer-bar').dataset.state=stalled?'stalled':state;
  setText('pacer-title',stalled?'CAMERA PAUSED':state==='running'?'FOLLOW THE DOTS':state==='countdown'?`START IN ${Math.max(1,Math.ceil(p.countdownMs/1000))}`:state==='paused'?'DOTS PAUSED':'READY TO FOLLOW');
  const key=`${state}|${!!p?.valid}|${stalled}`;
  if(key!==pacerReadingState||performance.now()-pacerReadingAt>=500){
    pacerReadingAt=performance.now();pacerReadingState=key;
    const pct=v=>Number.isFinite(v)?Math.round(v)+'%':'…',gap=Number.isFinite(p?.meanError)?p.meanError.toFixed(1)+'%':'…';
    setText('pacer-stats',stalled?'Waiting for fresh frames. Start again when the camera returns.':state==='running'?p.valid?`Last 5s · ${pct(p.onTargetPercent)} with dots · ${gap} gap · ${pct(p.measuredPercent)} measured`:`Tips unclear · scores paused · ${pct(p.measuredPercent)} measured`:state==='countdown'?'Get into position. Scoring begins when the dots move.':state==='paused'?'Phase is held. Resume when you are ready.':'Press Start dots when you are ready.');
  }
  setText('pacer-note',`${Number(config.pacerRpm||20).toFixed(0)} cycles/min · ${config.pacerDirection==='ccw'?'counterclockwise':'clockwise'} · independent of the beat`);
  const available=(demo||paired||localMode&&localCamera.active)&&!replay&&!pacerBusy;
  for(const operation of ['start','pause','resume','restart','stop']){
    const button=$('pacer-'+operation);
    button.hidden=operation==='start'?state!=='ready':operation==='pause'?!['running','countdown'].includes(state):operation==='resume'?state!=='paused':state==='ready';
    button.disabled=!available||(operation!=='stop'&&(stalled||!f||capturingBackground(f)));
  }
}
async function pacerCommand(operation){
  if(pacerBusy)return;pacerBusy=true;showPacer();
  try{
    await configChain;
    if(demo){demoPacerCommand(operation,performance.now(),config);acceptFrame(demoFrame(config,performance.now()));}
    else await api('/api/control',{action:'pacer',operation});
    message('');
  }catch(e){message(e.message);}finally{pacerBusy=false;showPacer();}
}
for(const operation of ['start','pause','resume','restart','stop'])$('pacer-'+operation).onclick=()=>pacerCommand(operation);
new ResizeObserver(()=>fitStage()).observe($('pacer-bar'));
let backgroundShown={state:'off',readyAt:0};
function showBackground(f){
  const state=f.background?.state||'off',remaining=f.background?.remainingMs||0,snapshot=state==='countdown'||state==='capturing',now=performance.now();
  if(state==='ready'&&(backgroundShown.state==='countdown'||backgroundShown.state==='capturing'))backgroundShown.readyAt=now;
  backgroundShown.state=state;
  const overlay=!replay&&(snapshot||state==='ready'&&now-backgroundShown.readyAt<2200);
  $('background-overlay').hidden=!overlay;
  if(overlay){
    const [title,count,note]=state==='countdown'?['MOVE STAVES OUT OF VIEW',String(Math.max(1,Math.ceil(remaining/1000))),'Keep the camera still. The video stays live.']:state==='capturing'?['CAPTURING BACKGROUND','…','Keep your staves out of view a moment longer.']:['BACKGROUND SAVED','✓','Bring your staves back into view.'];
    setText('background-overlay-title',title);setText('background-count',count);setText('background-overlay-note',note);
  }
  setText('background-status',f.source==='demo'||replay?'Needs a live PC camera or phone.':state==='countdown'?`Countdown ${Math.max(1,Math.ceil(remaining/1000))}: move your staves out of view and keep the camera still.`:state==='capturing'?'Capturing. Keep your staves out of view a moment longer.':state==='ready'?'On. Lights that were in the snapshot are ignored. Recapture after moving the camera or changing the lighting.':'Off. Every bright light in view can be mistaken for a staff.');
  setText('background-capture',state==='ready'?'Recapture background':'Capture background');
}
$('reset-guide').onclick=()=>patch(Object.fromEntries(['cx','cy','scale','rotation','circleSeparation'].map(k=>[k,defaults[k]])));
for(const [id,sizeOnly] of [['fit-guide',false],['fit-size',true]])$(id).onclick=async()=>{try{await api('/api/control',{action:'fit',sizeOnly,zoom:!sizeOnly});}catch(e){message(e.message);}};
$('sync-beat').onclick=async()=>{try{await api('/api/control',{action:'syncBeat'});}catch(e){message(e.message);}};
let taps=[];
$('tap-tempo').onclick=async()=>{systemAudio.stop();const now=performance.now();if(taps.length&&now-taps.at(-1)>2000)taps=[];taps.push(now);taps=taps.slice(-6);if(taps.length>1){const bpm=Math.max(30,Math.min(240,Math.round(60000*(taps.length-1)/(now-taps[0]))));await patch({bpm,tempoEnabled:true,tempoSource:"manual"});if(!demo)$('sync-beat').click();}else message('Keep tapping the beat to set tempo.');};
let audioStarting=false,audioSending=false,audioClock=null;
const systemAudio=new SystemAudio(state=>{if(localMode)localCamera.audioTempo(state);if(config.tempoSource==='pc')pushPcTempo(state);});
async function syncAudioClock(){
 let best=null;
 for(let i=0;i<3;i++){const start=performance.now(),reply=await api('/api/clock'),end=performance.now(),rtt=end-start;if(!Number.isFinite(reply.time))throw Error('Update the phone app to synchronize audio timing.');if(!best||rtt<best.rtt)best={offset:reply.time-(start+end)/2,rtt,at:end};}
 if(best.rtt>300)throw Error('Phone audio synchronization is too slow. Try USB or use phone audio.');audioClock=best;return best;
}
async function pushPcTempo(state){
 if(!paired||config.tempoSource!=='pc'||audioSending)return;
 audioSending=true;
 try{
  if(!audioClock||performance.now()-audioClock.at>20000)await syncAudioClock();
  if(config.tempoSource!=='pc'||!paired)return;
  // Two whole beats preserve phase at Half, Detected and Double rates while older phones
  // still require an origin within their shorter validation window. Keep local phase untouched.
  const period=state.bpm?120000/state.bpm:0,origin=state.holding&&period?state.origin+Math.floor((state.at-state.origin)/period)*period:state.origin;
  await api('/api/control',{action:'audioTempo',running:state.running,bpm:state.bpm,origin:state.bpm?origin+audioClock.offset:0,confidence:state.confidence||0,level:state.level||0,historySeconds:state.historySeconds||0,candidateBpm:state.candidateBpm??null,holding:!!state.holding,holdRemainingMs:state.holdRemainingMs||0,ageMs:Math.max(0,Math.min(5000,performance.now()-(state.at||performance.now())))});
 }catch(e){message(e.message);}finally{audioSending=false;}
}
$('audio-pc').onclick=async()=>{
 if(audioStarting)return;audioStarting=true;enableControls();
 try{systemAudio.stop();const capture=systemAudio.start();await capture;audioClock=null;await patch({tempoSource:'pc',tempoEnabled:true});if(paired)await syncAudioClock();if(systemAudio.state){if(localMode)localCamera.audioTempo(systemAudio.state);await pushPcTempo(systemAudio.state);}message('System audio stays local. Allow several beats for tempo detection.');}
 catch(e){systemAudio.stop();message(e.message);}finally{audioStarting=false;enableControls();}
};
$('audio-phone').onclick=async()=>{systemAudio.stop();try{await api('/api/control',{action:'audioStart'});message('Approve system-audio capture in the Android prompt on your phone.');}catch(e){message(e.message);}};
$('audio-manual').onclick=async()=>{systemAudio.stop();audioClock=null;if(paired)try{await api('/api/control',{action:'audioStop'});}catch(e){message(e.message);}await patch({tempoSource:'manual'});};
function updateAudioStatus(){
 const source=config.tempoSource,manual=source==='manual';
 // Local capture keeps reporting even when video stops. Phone timestamps use its own clock;
 // add wall-clock time since receipt instead of treating the last video timestamp as "now".
 const audio=(source==='pc'?systemAudio.state:current?.config.tempoSource===source?current.audio:null)||{};
 const age=source==='pc'?performance.now()-audio.at:Date.now()-lastArrival+Math.max(0,(current?.time??NaN)-audio.at);
 const fresh=!manual&&!replay&&audio.running&&Number.isFinite(age)&&age>=-100&&age<=2000;
 const bounded=(value,max=1)=>Number.isFinite(value)?Math.max(0,Math.min(max,value)):0;
 const remaining=fresh&&audio.holding?Math.max(0,bounded(audio.holdRemainingMs,15000)-Math.max(0,age)):0;
 const holding=fresh&&audio.holding&&remaining>0,expiredHold=fresh&&audio.holding&&!holding;
 const level=fresh?bounded(audio.level):0,quiet=level<.001;
 const silent=fresh&&!holding&&(audio.status?.startsWith('No shared audio')||(quiet&&!audio.historySeconds&&!audio.bpm&&!(audio.confidence>0)));
 const confidence=fresh&&!silent&&!expiredHold?bounded(audio.confidence):0,percent=Math.round(confidence*100);
 const history=fresh&&!silent?bounded(audio.historySeconds,8):0;
 const candidate=fresh&&!silent&&Number.isFinite(audio.candidateBpm)?audio.candidateBpm:null;
 const locked=fresh&&!silent&&confidence>=.6&&Number.isFinite(audio.bpm)&&audio.bpm>0;
 const soundLabel=manual||!audio.running?'Off':!fresh?'No signal':quiet?'Quiet':'Sound';
 const meterLevel=level<=.001?0:Math.min(1,Math.max(0,(Math.log10(level)+3)/3));
 setText('audio-level-label',soundLabel);setText('audio-confidence-label',`${percent}%`);setText('audio-confidence-heading',holding?'Last beat confidence':'Beat confidence');
 $('audio-confidence').setAttribute('aria-label',holding?'Last beat confidence':'Beat confidence');
 for(const [id,value] of [['audio-level',meterLevel*100],['audio-confidence',percent]]){
  $(id+'-fill').style.width=`${value}%`;$(id).setAttribute('aria-valuenow',String(Math.round(value)));
 }
 $('audio-level').setAttribute('aria-valuetext',`${soundLabel} · ${Math.round(meterLevel*100)}%`);
 const progress=manual?'Connect system audio to begin.':replay?'Live audio meters pause during replay.':!audio.running?(audio.status||'Connect system audio to begin.'):!fresh?'Waiting for fresh audio timing.':expiredHold?'Waiting for a new beat':holding?`Holding tempo · ${Math.ceil(remaining/1000)}s left`:silent?'No shared audio. Play music and check sharing.':locked?'Beat locked':history<2.4?`Collecting audio · ${history.toFixed(1)} / 2.4 s minimum`:candidate?`Possible ${Math.round(candidate)} BPM · not locked`:'Searching for a steady beat';
 setText('audio-progress',progress);
 setText('audio-status',manual?`Manual tempo · ${config.bpm} BPM. Choose phone or PC system audio to detect music.`:(source==='phone'?'Phone audio · ':'PC audio · ')+(locked?`${Math.round(audio.bpm*config.audioRate)} BPM · ${holding?'holding tempo':`${percent}% confidence`}`:!audio.running||!fresh||silent||expiredHold?progress:'Listening for a steady beat')+(paired&&source==='pc'&&audioClock?` · clock ±${Math.round(audioClock.rtt/2)} ms`:''));
}
let sessionVideoUrl = null;
$("close-video").onclick = () => $("video-dialog").close();
$("video-dialog").onclose = () => { $("session-video").pause(); $("session-video").removeAttribute("src"); if (sessionVideoUrl) URL.revokeObjectURL(sessionVideoUrl); sessionVideoUrl = null; };
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const descriptions = {
  antispin: "One staff: trace the horizontal line with one tip and the vertical line with the other. Error measures drift from each assigned line, not shaft angle.",
  grid: "Trace clean lines through the grid. Error measures tip distance to the nearest guide line.",
  circles:
    "Follow overlapping circles. Error measures tip distance from the nearest circumference.",
  cube: "Align staff tips with cube vertices. This is a projected reference, not a measurement of 3D depth.",
  free: "Move freely. Track staves and explore your trails without a grid-alignment score.",
};
async function api(route, body) {
  if (localMode && route === "/api/control") return localCamera.command(body);
  const response = await fetch(
    route,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value;
}
function message(text) {
  $("message").hidden = !text;
  $("message").textContent = text;
}
function connected(value) {
  paired = value;
  $("connection").classList.toggle("connected", value);
  $("connection").replaceChildren(
    Object.assign(document.createElement("i"), {}),
    document.createTextNode(
      value ? (transport === "usb" ? "USB CONNECTED" : "WI-FI CONNECTED") : localMode ? (localCamera.active ? "PC CAMERA" : localCamera.phase === "opening" ? "PC CAMERA OPENING" : "PC CAMERA STOPPED") : demo ? "DEMO MODE" : "PHONE NOT CONNECTED",
    ),
  );
  $("pair-open").textContent = value ? "Disconnect" : "Connect phone ↗";
  if (!value) stopStream();
  enableControls();
}
function enableControls() {
  const available = paired || (localMode && localCamera.active);
  const recording = localMode ? localCamera.recording : !!current?.recording;
  const finalizing = localMode ? localCamera.finalizing : !!current?.finalizing;
  const cameraLocked = recording || finalizing;
  document
    .querySelectorAll("[data-config], [data-mode]")
    .forEach((e) => (e.disabled = !(available || demo) || !!replay));
  $("staff-count").disabled ||= config.mode === "antispin";
  for (const key of ["mirror", "facing", "fps"]) {
    const control = document.querySelector(`[data-config="${key}"]`);
    if (control) control.disabled ||= cameraLocked;
  }
  for (const id of ["local-camera-select", "capture-target", "optimize-camera"]) $(id).disabled = localStarting || cameraLocked;
  for(const id of ["fit-guide","fit-size","sync-beat"])$(id).disabled=!available||!!replay;
  $("audio-pc").disabled=!available||audioStarting||!!replay;
  $("audio-phone").hidden=!paired;
  $("audio-phone").disabled=!paired||!!replay;
  $("sync-beat").disabled=!available||!!replay||config.tempoSource!=="manual";
  $("tap-tempo").disabled=!(available||demo)||!!replay;
  $("calibrate").disabled = !available || !!replay || !current;
  $("reset-guide").disabled=!(available||demo)||!!replay;
  $("clear-calibration").disabled = !available || !!replay || !config.planeCorners?.length;
  $("zoom-wide").disabled = !available || !!replay || !current?.cameraReady;
  $("reset").disabled = !available || !!replay;
  $("seed").disabled = !available || !!replay;
  $("optimize-camera").disabled = localStarting || localCamera.recording || localCamera.finalizing;
  const fresh = Date.now() - lastArrival <= 2000;
  $("record").disabled = !!replay || finalizing || (!recording && (!available || !current?.cameraReady || current.source === "demo" || !fresh));
  if (localMode && !replay) {
    $("record").classList.toggle("recording", recording);
    setText("record", finalizing ? "Saving…" : recording ? `■ Stop · ${Math.floor(Math.max(0, performance.now() - localCamera.recordingStarted) / 1000)}s` : "● Record practice");
  }
  // Background snapshots need live camera frames; never the demo or a replay.
  const live=available&&!replay&&!!current?.cameraReady&&current.source!=="demo",bg=current?.background?.state||"off",snapshot=bg==="countdown"||bg==="capturing";
  $("background-capture").hidden=snapshot;$("background-capture").disabled=!live;
  $("background-cancel").hidden=!snapshot;$("background-cancel").disabled=!live;
  $("background-clear").hidden=bg!=="ready";$("background-clear").disabled=!live;
  $("quick-fit").disabled=$("fit-guide").disabled;
  $("quick-background").disabled=!live;
  setText("quick-background",snapshot?"Cancel background capture":bg==="ready"?"Recapture · 5s":"Background · 5s");
  for(const chip of document.querySelectorAll("#staff-colors .chip"))chip.disabled=!(available||demo)||!!replay||config.led===false;
  showPacer();
}
let controlEditRevision = 0;
const controlEdits = new WeakMap();
function syncConfig(c, {force=false, throughEdit=Infinity} = {}) {
  const text = JSON.stringify(c);
  if (text === lastConfigText && !force) return;
  lastConfigText = text;
  config = { ...config, ...c };
  document.querySelectorAll("[data-config]").forEach((el) => {
    const key = el.dataset.config;
    // A delayed acknowledgement may restore rejected values, but must never
    // replace a newer edit made while that request was in flight.
    if ((controlEdits.get(el) || 0) > throughEdit) return;
    if (!force && document.activeElement === el && ["range","number","text","checkbox"].includes(el.type)) return;
    if (el.type === "checkbox") el.checked = !!config[key];
    else el.value = String(config[key]);
    if (el.type === "range") rangeLabel(el);
  });
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === config.mode),
    );
  $("calibration-info").textContent = config.planeCorners?.length ? "Perspective correction active. Measurements use the calibrated plane. Keep all tips inside it. Recalibrate after moving the camera." : "Mark a rectangle in your movement plane, clockwise from top left. Use width ÷ height = 1 for a square. Zoom, mirror, camera, or rotation changes clear calibration.";
  const colors=config.staffColors||[];
  for(const chip of document.querySelectorAll("#staff-colors .chip"))chip.setAttribute("aria-pressed",String(chip.dataset.color?colors.includes(chip.dataset.color):!colors.length));
  setText("color-summary",config.led===false?"Not used while LED detection is off":colors.length?`Only ${colorNames(colors)}`:"All colors");
  setText("color-help",config.led===false?"Color choice applies only to LED detection. Turn on LED detection to use it.":"Match your staff's current LED setting. Choose one or more colors to ignore other lights; pick two for differently colored staves. White can still match sunlight.");
  enableControls();
  if(tutorialMode!==config.mode)showTutorial(false);
  document.querySelector('.key.b').hidden=config.staffCount===1;
  $("symmetry").closest("article").hidden=config.staffCount===1;
  const symmetry=document.querySelector('[data-config="symmetry"]');symmetry.closest("label").hidden=config.staffCount===1;
  $("mode-description").textContent = descriptions[config.mode];
  const antispin=config.mode==='antispin';
  // Keep every arm of the cross visible, including the bottom turnaround on small previews.
  const footer=$('antispin-footer'),overlayHost=antispin?footer:$('stage');footer.hidden=!antispin;
  for(const id of ['stage-badge','streak-hud'])if($(id).parentElement!==overlayHost)overlayHost.append($(id));
  measureHud();fitStage();
  document.querySelector('[data-config="beatPoints"]').closest('label').hidden=antispin;
  $('antispin-beat-help').hidden=!antispin;
  $('normal-beat-help').hidden=antispin;
  $('angle').closest('article').hidden=antispin;
  $('fit-size').title=antispin?'Set center-to-edge distance to one full staff length':'Set guide width or circle diameter to one staff length';
  $('beat-legend').querySelector('span').textContent=antispin?'Blue rings = outer turnarounds. Alternate the horizontal and vertical tips on successive pulses.':'Blue numbered rings = beat points. The small white dot marks the tip used for timing.';
  $("depth-control").hidden = config.mode !== "cube";
  $("circles-control").hidden = config.mode !== "circles";
  $("error-label").textContent =
    config.mode === "antispin" ? "LINE DRIFT" : config.mode === "cube"
      ? "VERTEX ERROR"
      : config.mode === "circles"
        ? "CIRCLE ERROR"
        : config.mode === "free"
          ? "FREE FLOW"
          : "GRID ERROR";
  $("deviation-hint").textContent =
    config.mode === "cube"
      ? "Tip distance / guide width"
      : config.mode === "circles"
        ? "Radial error / diameter"
        : "Tip distance / guide width";
}
function rangeLabel(el) {
  const value = Number(el.value),
    key = el.dataset.config;
  const output = document.querySelector(`output[for="${el.id}"]`);
  if (output)
    output.textContent =
      key === "rotation" || key === "pacerOffset"
        ? `${value}°`
        : key === "pacerRpm" ? `${value} cycles/min`
        : key === "pacerCountdown" ? `${value} s`
        : key === "pacerDotSize" ? `${value}`
        : key === "threshold"
          ? `${value}`
          : key === "tolerance"
            ? `${value}%`
            : key === "trackingGraceMs" || key === "alignmentGraceMs"
              ? value === 0 ? "Off" : `${value} ms`
            : `${Math.round(value * 100)}%`;
}
let configChain = Promise.resolve();
function patch(update) {
  const throughEdit = controlEditRevision;
  if(update.bpm!==undefined){systemAudio.stop();update={...update,tempoSource:"manual"};}
  configChain = configChain.then(async () => {
    if (demo) {
      try { syncConfig(patchConfig(config,update), {force:true,throughEdit}); trail = []; message(""); }
      catch (e) { message(e.message); syncConfig(config, {force:true,throughEdit}); }
      return;
    }
    try {
      const result = await api("/api/control", {
        action: "config",
        config: update,
      });
      syncConfig(result.config, {force:true,throughEdit});
      trail = [];
      history = [];
      message("");
    } catch (e) {
      message(e.message);
      syncConfig(config, {force:true,throughEdit});
    }
  });
  return configChain;
}
document
  .querySelectorAll("[data-mode]")
  .forEach((b) => (b.onclick = () => patch({ mode: b.dataset.mode })));
document.querySelectorAll("[data-config]").forEach((el) => {
  el.addEventListener("input", () => {
    controlEdits.set(el, ++controlEditRevision);
    if (el.type === "range") rangeLabel(el);
  });
  el.addEventListener("change", () => {
    controlEdits.set(el, ++controlEditRevision);
    patch({
      [el.dataset.config]:
        el.type === "checkbox"
          ? el.checked
          : el.type === "range" || el.type === "number" || ["fps","staffCount","beatPoints","audioRate"].includes(el.dataset.config)
            ? Number(el.value)
            : el.value,
    });
  });
});
function openPair() {
  $("pair-error").textContent = "";
  $("pair-dialog").showModal();
  $("transport").focus();
}
$("pair-open").onclick = async () => {
  if (paired) {
    systemAudio.stop();audioClock=null;
    await api("/api/disconnect", {});
    connected(false);
    resetView();
  } else openPair();
};
$("connect-stage").onclick = openPair;
$("transport").onchange = () => {
  const usb = $("transport").value === "usb";
  $("address-field").hidden = usb; $("phone-address").required = !usb; $("usb-help").hidden = !usb;
};
$("zoom").oninput = () => { document.querySelector('output[for="zoom"]').textContent = `${Number($("zoom").value).toFixed(2)}×`; };
$("zoom").onchange = () => patch({ zoom: Number($("zoom").value) });
$("zoom-wide").onclick = () => patch({ zoom: 0 });
$("cancel-pair").onclick = () => $("pair-dialog").close();
$("pair-form").onsubmit = async (e) => {
  e.preventDefault();
  $("pair-submit").disabled = true;
  $("pair-error").textContent = "";
  try {
    const result = await api("/api/pair", {
      address: $("phone-address").value.trim(),
      transport: $("transport").value,
    });
    systemAudio.stop();audioClock=null;
    transport = result.transport;
    stopStream();
    await localCamera.stop(); localMode = false; updateSourceControls();
    try { localStorage.setItem("klobflow.lastMode", "phone"); } catch {}
    $("pair-dialog").close();
    demo = false;
    replay = null;
    trail = [];
    history = [];
    lastTime = null;
    showCameraError("");
    connected(true);
    message("");
    await loadSessions();
  } catch (err) {
    $("pair-error").textContent = err.message;
  } finally {
    $("pair-submit").disabled = false;
  }
};
function resetView() {
  resetDemoPacer();$('pacer-bar').hidden=true;pacerReadingState='';
  sourceStalled = false;
  fallbackStreak.reset();$('streak-hud').hidden=true;streakBox.reset();
  alignmentFeedback.reset();displayedFeedback={tips:[],state:'paused'};legacyRolling=null;cueMemory.clear();
  $("beat-feedback").hidden=true;timingBox.reset();setPracticing(false);$("background-overlay").hidden=true;backgroundShown={state:'off',readyAt:0};
  current = null;
  lastTime = null;
  lastImage?.close?.();lastImage = null;
  trail = [];
  history = [];
  seeding = false;
  calibrating = false;
  picks = [];
  $("empty-state").hidden = false;
  $("stage-badge").hidden = true;
  $("tracking-label").textContent = "Waiting for your phone";
  $("source-label").textContent = "YOUR PRACTICE VIEW";
  $("live-dot").style.background = "";
  $("seed-message").hidden = true;
  setMetrics(null);
  setCoaching(null);
  drawEmpty();
  drawChart();
}
$("demo-start").onclick = async () => {
  resetDemoPacer();
  systemAudio.stop();
  await localCamera.stop(); localMode = false; updateSourceControls();
  demo = true;
  replay = null;
  lastTime = null;
  showCameraError("");
  connected(false);
  syncConfig(config);
  message(
    "Demo shows generated motion. It is not an assessment of a real practice session.",
  );
};
$("fullscreen").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else
    $("practice-view")
      .requestFullscreen()
      .catch((e) => message(e.message));
};
$("exit-fullscreen").onclick=()=>document.exitFullscreen().catch(e=>message(e.message));
$('focus-details').onclick=()=>{const expanded=$('focus-details').getAttribute('aria-expanded')!=='true';$('focus-details').setAttribute('aria-expanded',String(expanded));$('focus-details').textContent=expanded?'Hide details':'Details';$('practice-view').classList.toggle('show-focus-details',expanded);};
// Both record buttons reflect the same source state, including pending saves and connection loss.
function syncFocusRecord(){const source=$('record'),target=$('focus-record');target.disabled=source.disabled;setText('focus-record',source.textContent.replace('Record practice','Record').trim());target.classList.toggle('recording',source.classList.contains('recording'));}
new MutationObserver(syncFocusRecord).observe($('record'),{attributes:true,attributeFilter:['disabled','class'],childList:true,subtree:true,characterData:true});
$('focus-record').onclick=()=>$('record').click();syncFocusRecord();
$("reset").onclick = async () => {
  try {
    await api("/api/control", { action: "reset" });
    trail = [];
    history = [];
    message("Tracking reset. Hold both staves clearly in frame.");
  } catch (e) {
    message(e.message);
  }
};
$("record").onclick = async () => {
  const action = (localMode ? localCamera.recording : current?.recording) ? "stop" : "record";
  $("record").disabled = true;
  try {
    if (action === "stop" && localMode) message("Stopping and saving your practice…");
    await api("/api/control", { action });
    if (action !== "stop" || !localMode) message(
      action === "record"
        ? localMode ? "Recording in this browser. Video and analysis stay on this PC." : "Recording on your phone. Video and analysis save locally."
        : localMode ? "Saving your practice in this browser." : "Saving your practice on the phone.",
    );
  } catch (e) {
    message(e.message);
  } finally {
    enableControls();
  }
};
$("seed").onclick = () => {
  calibrating = false;
  $("calibrate").textContent = "Calibrate viewing angle";
  seeding = !seeding;
  picks = [];
  $("seed").textContent = seeding ? "Cancel selection" : "Identify staves";
  $("seed-message").hidden = !seeding;
  $("seed-message").textContent = "Hold staves still. Tap staff A, end 1.";
};
$("calibrate").onclick = () => {
  calibrating = !calibrating; seeding = false; picks = [];
  $("seed").textContent = "Identify staves";
  $("calibrate").textContent = calibrating ? "Cancel calibration" : "Calibrate viewing angle";
  $("seed-message").hidden = !calibrating;
  $("seed-message").textContent = "Rectangle in your movement plane: tap top left.";
};
$("clear-calibration").onclick = () => patch({ planeCorners: [] });
canvas.addEventListener("click", async (e) => {
  if ((!seeding && !calibrating) || !current) return;
  const rect = canvas.getBoundingClientRect(),
    scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const x =
      (e.clientX - rect.left - (rect.width - canvas.width * scale) / 2) /
      (canvas.width * scale),
    y =
      (e.clientY - rect.top - (rect.height - canvas.height * scale) / 2) /
      (canvas.height * scale);
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  picks.push([x, y]);
  render(current, lastImage);
  if (picks.length === (calibrating ? 4 : config.staffCount * 2)) {
    try {
      await api("/api/control", calibrating ? { action: "calibrate", points: picks, aspect: Number($("plane-aspect").value) } : { action: "seed", points: picks });
      trail = [];
      message(calibrating ? "Viewing angle calibrated. Keep the camera fixed and the staves in this plane." : "Staff selection applied. Move slowly while tracking settles.");
    } catch (err) {
      message(err.message);
    }
    seeding = false;
    calibrating = false;
    picks = [];
    $("calibrate").textContent = "Calibrate viewing angle";
    $("seed-message").hidden = true;
    $("seed").textContent = "Identify staves";
  } else
    $("seed-message").textContent =
      calibrating ? `Tap ${["top left", "top right", "bottom right", "bottom left"][picks.length]}.` : `Hold still. Tap staff ${picks.length < 2 ? "A" : "B"}, end ${(picks.length % 2) + 1}.`;
});
function drawEmpty() {
  canvas.width = 960;
  canvas.height = 720;
  $("stage").style.removeProperty("--stage-aspect");
  ctx.fillStyle = "#090e09";
  ctx.fillRect(0, 0, 960, 720);
  ctx.strokeStyle = "#263621";
  ctx.lineWidth = 1;
  for (let x = 0; x < 960; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 720);
    ctx.stroke();
  }
  for (let y = 0; y < 720; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(960, y);
    ctx.stroke();
  }
}
function render(frame, image) {
  if (sourceStalled && !replay) frame = {...frame,beat:null,pacer:null,config:{...frame.config,showFeedback:false,streakEffects:false}};
  // Detection runs at a small image size; display overlays use screen resolution so glyphs stay crisp.
  $("stage").style.setProperty("--stage-aspect", String(frame.width / frame.height));
  const fit = viewBox.width && viewBox.height ? Math.min(viewBox.width / frame.width, viewBox.height / frame.height) : 1;
  const raster = Math.min(4096 / Math.max(frame.width, frame.height), Math.max(1, fit * Math.min(2, devicePixelRatio || 1)));
  const rasterWidth = Math.round(frame.width * raster), rasterHeight = Math.round(frame.height * raster);
  if (canvas.width !== rasterWidth || canvas.height !== rasterHeight) { canvas.width = rasterWidth; canvas.height = rasterHeight; }
  const w = canvas.width,
    h = canvas.height,
    u = Math.min(w, h),
    g = frame.guide,
    c = frame.config;
  // Overlay marks are sized in screen pixels: k converts them to canvas pixels at the displayed size.
  const shownScale=viewBox.width&&viewBox.height?Math.min(viewBox.width/w,viewBox.height/h):1;
  const k=(uiSizes[document.documentElement.dataset.uiSize]||1)*(viewBox.width&&viewBox.width<560?.78:1)/Math.max(.05,shownScale);
  ctx.clearRect(0, 0, w, h);
  if (image) ctx.drawImage(image, 0, 0, w, h);
  else if (!localMode || replay) {
    const gradient = ctx.createRadialGradient(
      w / 2,
      h / 2,
      10,
      w / 2,
      h / 2,
      w * 0.7,
    );
    gradient.addColorStop(0, "#20301b");
    gradient.addColorStop(1, "#080c09");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
  const line = (a, b, color, width = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a[0] * u, a[1] * u);
    ctx.lineTo(b[0] * u, b[1] * u);
    ctx.stroke();
  };
  // Localized energy stays beneath guides and measured-tip cues. All dimensions and
  // opacity grow continuously; the fixed accent count avoids particle pop-in.
  const power=c.streakEffects!==false?Math.max(0,Math.min(1,frame.streak?.energy||0)):0;
  if(power>0){
    const scale=Math.max(.6,Math.min(1.5,u/480)),heat=power*power;
    const phase=reducedMotion.matches?-Math.PI/2:frame.time/3600;
    ctx.save();ctx.lineCap='round';
    frame.staffs.forEach(s=>{
      if(!s||s.blurred||s.occluded||s.confidence<.55)return;
      // A narrow luminous wake connects observed endpoints without washing the video.
      line(s.a,s.b,`rgba(255,179,43,${.12*heat})`,(12+20*power)*scale);
      line(s.a,s.b,`rgba(255,222,113,${.28*heat})`,(5+11*power)*scale);
      line(s.a,s.b,`rgba(255,251,232,${.55*heat})`,(2+3*power)*scale);
      for(const tip of [s.a,s.b]){
        const x=tip[0]*u,y=tip[1]*u,halo=(16+64*power)*scale,rim=(12+30*power)*scale;
        const aura=ctx.createRadialGradient(x,y,0,x,y,halo);
        aura.addColorStop(0,`rgba(255,255,246,${.95*power})`);
        aura.addColorStop(.16,`rgba(255,246,191,${.82*power})`);
        aura.addColorStop(.35,`rgba(255,211,89,${.55*power})`);
        aura.addColorStop(.65,`rgba(255,169,43,${.2*power})`);
        aura.addColorStop(1,'rgba(255,169,43,0)');
        ctx.fillStyle=aura;ctx.beginPath();ctx.arc(x,y,halo,0,Math.PI*2);ctx.fill();
        // Six tapered rays turn slowly as one shape, with no flicker or random jitter.
        for(let n=0;n<6;n++){
          const a=phase+n*Math.PI/3,reach=halo*(.76+.1*(n%3));
          const start=rim*.7,half=(1+3*power)*scale;
          ctx.fillStyle=`rgba(255,240,174,${.65*heat})`;ctx.beginPath();
          ctx.moveTo(x+Math.cos(a)*reach,y+Math.sin(a)*reach);
          ctx.lineTo(x+Math.cos(a)*start-Math.sin(a)*half,y+Math.sin(a)*start+Math.cos(a)*half);
          ctx.lineTo(x+Math.cos(a)*start+Math.sin(a)*half,y+Math.sin(a)*start-Math.cos(a)*half);ctx.closePath();ctx.fill();
        }
        ctx.strokeStyle=`rgba(255,215,112,${.28*power})`;ctx.lineWidth=(3+5*power)*scale;
        ctx.beginPath();ctx.arc(x,y,rim,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle=`rgba(255,252,226,${.9*power})`;ctx.lineWidth=(1+1.8*power)*scale;
        ctx.beginPath();ctx.arc(x,y,rim,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.max(0,Math.min(1,frame.streak.progress)));ctx.stroke();
        const core=ctx.createRadialGradient(x,y,0,x,y,(5+11*power)*scale);
        core.addColorStop(0,`rgba(255,255,255,${power})`);core.addColorStop(.35,`rgba(255,253,222,${.9*power})`);core.addColorStop(1,'rgba(255,230,150,0)');
        ctx.fillStyle=core;ctx.beginPath();ctx.arc(x,y,(5+11*power)*scale,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=`rgba(255,253,230,${.95*heat})`;
        for(let n=0;n<4;n++){
          const a=-phase+n*Math.PI/2,r=rim+(7+8*power)*scale;
          ctx.beginPath();ctx.arc(x+Math.cos(a)*r,y+Math.sin(a)*r,(1+2.2*power)*scale,0,Math.PI*2);ctx.fill();
        }
      }
    });
    ctx.restore();
  }
  if (c.showGuide) {
    ctx.beginPath();
    for (const s of g.lines) { ctx.moveTo(s.a[0] * u, s.a[1] * u); ctx.lineTo(s.b[0] * u, s.b[1] * u); }
    for (const circle of g.circles) { ctx.moveTo((circle.center[0] + circle.radius) * u, circle.center[1] * u); ctx.arc(circle.center[0] * u, circle.center[1] * u, circle.radius * u, 0, Math.PI * 2); }
    for (const path of g.paths || []) path.forEach((p, i) => i ? ctx.lineTo(p[0] * u, p[1] * u) : ctx.moveTo(p[0] * u, p[1] * u));
    // A dark casing keeps the white dashed guide readable over bright LEDs and daylight, not only in dark rooms.
    ctx.lineJoin = "round"; ctx.strokeStyle = "#0000008c"; ctx.lineWidth = 4 * k; ctx.stroke();
    ctx.setLineDash([7 * k, 6 * k]); ctx.strokeStyle = "#f4f8eeb8"; ctx.lineWidth = 1.6 * k; ctx.stroke(); ctx.setLineDash([]);
    for (const p of g.vertices) {
      ctx.fillStyle = "#000000b0"; ctx.beginPath(); ctx.arc(p[0] * u, p[1] * u, 4.6 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#eef5e6"; ctx.beginPath(); ctx.arc(p[0] * u, p[1] * u, 2.8 * k, 0, Math.PI * 2); ctx.fill();
    }
  }
  if(c.trails){
    const width=4*Math.max(.5,Math.min(2,u/480))*(1+(c.streakEffects!==false?(frame.streak?.energy||0)*.35:0));
    const visible=s=>s&&!s.occluded&&(s.confidence>=.55||s.blurred),fade=t=>Math.max(0,Math.min(1,1-(frame.time-t)/4200));
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    trail.forEach((f,index)=>f.staffs.forEach((s,n)=>{
      if(!visible(s))return;
      const color=`hsl(${((f.time%4200+4200)%4200)*360/4200} 100% 70%)`,previous=trail[index-1],old=previous?.staffs[n],dt=f.time-(previous?.time??f.time);
      if(visible(old)&&dt>0&&dt<=150&&Math.max(Math.hypot(old.a[0]-s.a[0],old.a[1]-s.a[1]),Math.hypot(old.b[0]-s.b[0],old.b[1]-s.b[1]))<=Math.min(length(old),length(s))*.6){
        ctx.globalAlpha=.72*fade(previous.time)*((old.blurred||s.blurred)?.55:1);
        line(old.a,s.a,color,width);line(old.b,s.b,color,width);
      }
      // Detection marks sit within the stroke, with only a small brightness lift.
      if(!s.blurred&&s.confidence>=.55){ctx.globalAlpha=fade(f.time)*.14;ctx.fillStyle=color;
        for(const p of [s.a,s.b]){ctx.beginPath();ctx.arc(p[0]*u,p[1]*u,width*.48,0,Math.PI*2);ctx.fill();}
      }
    }));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  const at=p=>[p[0]*u,p[1]*u],placed=[];
  if(hudBox&&!$('streak-hud').hidden){const s=Math.max(.05,shownScale),ox=(viewBox.width-w*s)/2,oy=(viewBox.height-h*s)/2;placed.push({x:(hudBox.x-ox)/s,y:(hudBox.y-oy)/s,w:hudBox.w/s,h:hudBox.h/s});}
  const ring=(x,y,r,color,width)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.lineWidth=width+3.5*k;ctx.strokeStyle='#000000c0';ctx.stroke();ctx.lineWidth=width;ctx.strokeStyle=color;ctx.stroke();};
  // Labels sit on dark plates and never overlap: each tries its candidate positions in order.
  const tag=(text,{fill='#0b0f0bf2',ink='#fff',stroke=null,size=15,alpha=1,candidates,force=false})=>{
    const fs=size*k;ctx.font=`700 ${fs}px system-ui, sans-serif`;
    const pw=ctx.measureText(text).width+fs*.9,ph=fs*1.5;
    for(const [index,candidate] of candidates.entries()){
      const [cx,cy]=candidate(pw,ph),r={x:Math.max(1,Math.min(w-pw-1,cx-pw/2)),y:Math.max(1,Math.min(h-ph-1,cy-ph/2)),w:pw,h:ph};
      if(placed.some(o=>r.x<o.x+o.w&&o.x<r.x+r.w&&r.y<o.y+o.h&&o.y<r.y+r.h)&&!(force&&index===candidates.length-1))continue;
      placed.push(r);ctx.globalAlpha=alpha;ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,ph*.3);ctx.fill();
      if(stroke){ctx.lineWidth=1.6*k;ctx.strokeStyle=stroke;ctx.stroke();}
      ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,r.x+r.w/2,r.y+r.h/2+fs*.05);
      ctx.textAlign='start';ctx.textBaseline='alphabetic';ctx.globalAlpha=1;return r;
    }
    return null;
  };
  const beside=(x,y,ux,uy,r)=>(pw,ph)=>{const reach=r+5*k+Math.abs(ux)*pw/2+Math.abs(uy)*ph/2;return [x+ux*reach,y+uy*reach];};
  frame.staffs.forEach((s, n) => {
    if (!s) return;
    const color = n ? "#b5a3ff" : "#b6f36b";
    ctx.globalAlpha = s.occluded ? .35 : s.blurred ? .75 : s.confidence < .55 ? .7 : 1;
    if(s.blurred&&!s.occluded)ctx.setLineDash([8*k,5*k]);
    if (frame.source === "demo" && !image) {
      ctx.shadowBlur = 20;
      ctx.shadowColor = color;
    }
    line(s.a, s.b, color, (frame.source === "demo" && !image ? 6 : 3) * k);
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    for (const p of [s.a, s.b]) {
      // Estimated end: identity color over a dark outline so it survives bright LEDs.
      ring(p[0]*u,p[1]*u,6*k,color,1.8*k);
    }
  });
  ctx.globalAlpha = 1;
  // A letter at each staff's middle names the line; lime and purple identify staves, not scores.
  frame.staffs.forEach((s,n)=>{
    if(!s||n>=(c.staffCount||2))return;
    const x=(s.a[0]+s.b[0])/2*u,y=(s.a[1]+s.b[1])/2*u,note=s.occluded?' · LAST SEEN':s.blurred?' · ENDS UNCLEAR':s.confidence<.55?' · UNSURE':'';
    tag(`${'AB'[n]}${note}`,{fill:n?'#b5a3ff':'#b6f36b',ink:'#10130f',stroke:'#10130f',size:15,alpha:s.occluded?.65:1,force:true,candidates:[()=>[x,y],(pw,ph)=>[x,y-ph*1.2],(pw,ph)=>[x,y+ph*1.2]]});
  });
  if(c.mode==='antispin'){
    if(c.showGuide)g.lines.forEach((s,i)=>{const color=i?'#b5a3ff':'#6dd8ff';line(s.a,s.b,color,2.5*k);const [x,y]=at(s.a);tag(i?'VERTICAL':'HORIZONTAL',{ink:color,size:13,candidates:[beside(x,y,0,-1,12*k),beside(x,y,1,0,12*k)]});});
    if(c.showFeedback)for(const cue of displayedFeedback.tips||[]){const [x,y]=at(cue.tip);tag(cue.axis==='horizontal'?'H TIP':'V TIP',{ink:cue.axis==='horizontal'?'#6dd8ff':'#b5a3ff',size:13,candidates:[beside(x,y,0,-1,20*k),beside(x,y,1,0,20*k),beside(x,y,-1,0,20*k)]});}
  }
  const pacer=frame.pacer?.enabled?frame.pacer:null,pacerDot=Math.max(8*k,(c.pacerDotSize||16)*Math.max(.6,Math.min(1.5,u/480)));
  if(pacer){
    // Solid blue targets stay distinct from hollow measured-tip rings, even with no detections.
    // Their movement is the exercise itself, so reduced-motion does not freeze them.
    const dot=pacerDot;
    pacer.targets.forEach((pair,i)=>pair.forEach((p,j)=>{
      const [x,y]=at(p),label=c.mode==='antispin'?(j?'V':'H'):'AB'[i];
      ctx.beginPath();ctx.arc(x,y,dot,0,Math.PI*2);ctx.fillStyle='#123d59';ctx.fill();ctx.lineWidth=5*k;ctx.strokeStyle='#050b12';ctx.stroke();ctx.lineWidth=2.4*k;ctx.strokeStyle='#73d9ff';ctx.stroke();
      ctx.font=`800 ${Math.max(12*k,dot*.95)}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#e9faff';ctx.fillText(label,x,y);
      placed.push({x:x-dot-3*k,y:y-dot-3*k,w:dot*2+6*k,h:dot*2+6*k});
    }));
    ctx.textAlign='start';ctx.textBaseline='alphabetic';
    // Keep actual observed endpoints visible above the moving target disks.
    frame.staffs.forEach((s,i)=>{if(s&&!s.occluded&&!s.blurred&&s.confidence>=.55)for(const p of [s.a,s.b])ring(p[0]*u,p[1]*u,6*k,i?'#b5a3ff':'#b6f36b',1.8*k);});
  }
  if(frame.beat?.enabled&&!pacer){
    const on=frame.beat.phase<.18,grow=on&&!reducedMotion.matches;
    ctx.font=`700 ${14*k}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    frame.beat.targets.forEach((targets,i)=>targets.forEach((p,j)=>{
      const [x,y]=at(p),r=(grow?10:8)*k;ring(x,y,r,i?'#b5a3ff':'#6dd8ff',(on?3.4:2.4)*k);
      const nx=x+r+7*k,ny=y-r-4*k;ctx.lineWidth=3.5*k;ctx.strokeStyle='#000';ctx.strokeText(String(j+1),nx,ny);ctx.fillStyle='#fff';ctx.fillText(String(j+1),nx,ny);
    }));
    ctx.textAlign='start';ctx.textBaseline='alphabetic';
    if(c.mode!=='antispin')frame.staffs.forEach(s=>{if(s&&s.confidence>=.55){const [x,y]=at(s.a);ring(x,y,8*k,'#6dd8ff',2.5*k);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,4*k,0,Math.PI*2);ctx.fill();tag('BEAT TIP',{ink:'#9ae9ff',size:13,candidates:[beside(x,y,0,-1,10*k),beside(x,y,1,0,10*k),beside(x,y,-1,0,10*k)]});}});
  }
  // Correction cues: amber ring = the tip to move, arrow = which way, white bullseye = where it belongs.
  const cues=c.showFeedback!==false?displayedFeedback.tips||[]:[],labels=[];
  if(!cues.length)cueMemory.clear();
  cues.forEach((cue,i)=>{
    const [tx,ty]=at(cue.tip),[gx,gy]=at(cue.target),dx=gx-tx,dy=gy-ty,dist=Math.hypot(dx,dy);
    // Inside tolerance but not yet confirmed: a plain white ring, never an amber "move" cue.
    if(!cue.onTarget&&cue.error<=c.tolerance){ring(tx,ty,15*k,'#ffffff',3*k);cueMemory.delete(i);return;}
    if(cue.onTarget){
      ring(tx,ty,15*k,'#ffffff',3*k);
      const bx=tx+12*k,by=ty-12*k;ctx.fillStyle='#0b0f0b';ctx.beginPath();ctx.arc(bx,by,7.5*k,0,Math.PI*2);ctx.fill();ctx.lineWidth=1.6*k;ctx.strokeStyle='#fff';ctx.stroke();
      ctx.lineWidth=2.3*k;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(bx-3.4*k,by+.2*k);ctx.lineTo(bx-.9*k,by+2.8*k);ctx.lineTo(bx+3.6*k,by-2.6*k);ctx.stroke();ctx.lineCap='butt';
      cueMemory.delete(i);return;
    }
    const tipR=14*k,targetR=pacer?pacerDot+2*k:17*k,ux=dist?dx/dist:0,uy=dist?dy/dist:-1;
    if(!pacer){ring(gx,gy,targetR,'#ffffff',3.2*k);ctx.fillStyle='#000000c0';ctx.beginPath();ctx.arc(gx,gy,5*k,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(gx,gy,3*k,0,Math.PI*2);ctx.fill();}
    if(dist>tipR+targetR+8*k){
      const sx=tx+ux*(tipR+2*k),sy=ty+uy*(tipR+2*k),ex=gx-ux*(targetR+3*k),ey=gy-uy*(targetR+3*k),head=Math.min(15*k,Math.hypot(ex-sx,ey-sy)*.65);
      const shaft=()=>{ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex-ux*head*.7,ey-uy*head*.7);ctx.stroke();};
      ctx.lineCap='round';ctx.strokeStyle='#000000c0';ctx.lineWidth=9.5*k;shaft();ctx.strokeStyle='#ffb45e';ctx.lineWidth=5*k;shaft();ctx.lineCap='butt';
      ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-ux*head-uy*head*.62,ey-uy*head+ux*head*.62);ctx.lineTo(ex-ux*head+uy*head*.62,ey-uy*head-ux*head*.62);ctx.closePath();
      ctx.lineJoin='round';ctx.lineWidth=3.5*k;ctx.strokeStyle='#000000c0';ctx.stroke();ctx.fillStyle='#ffb45e';ctx.fill();
    }
    ring(tx,ty,tipR,'#ffb45e',3.6*k);
    // Labels must never hide the rings they explain, even when clamped at the canvas edge.
    for(const [x,y,r] of [[tx,ty,tipR],[gx,gy,targetR]])placed.push({x:x-r-2*k,y:y-r-2*k,w:2*r+4*k,h:2*r+4*k});
    const d=direction(dx,dy,cueMemory.get(i)??-1);cueMemory.set(i,d.sector);
    labels.push({tip:`TIP ${d.glyph} ${d.word}`,tx,ty,gx,gy,ux,uy,tipR,targetR});
  });
  // Instructions first, then TARGET names, so crowded scenes keep the most useful words.
  for(const l of labels)tag(l.tip,{stroke:'#ffb45e',ink:'#ffd29e',size:16,candidates:[beside(l.tx,l.ty,-l.ux,-l.uy,l.tipR),beside(l.tx,l.ty,-l.uy,l.ux,l.tipR),beside(l.tx,l.ty,l.uy,-l.ux,l.tipR)]});
  if(!pacer)for(const l of labels)tag('TARGET',{stroke:'#ffffff',size:13,candidates:[beside(l.gx,l.gy,l.ux,l.uy,l.targetR),beside(l.gx,l.gy,-l.uy,l.ux,l.targetR),beside(l.gx,l.gy,l.uy,-l.ux,l.targetR)]});
  for (const p of picks) ring(p[0]*w,p[1]*h,9*k,'#ffffff',2.5*k);
}
const cueMemory=new Map();let sizeReading=null;
function showBeat(f){
 if(f.pacer?.enabled){$('beat-feedback').hidden=true;$('beat-legend').hidden=true;timingBox.reset();return;}
 const beat=f.beat,immediate=!!replay,paused=!beat?.enabled&&f.config.tempoEnabled&&f.config.tempoSource!=='manual',visible=!!beat?.enabled||paused;
 $('beat-legend').hidden=!f.config.tempoEnabled;
 if($('beat-feedback').hidden===visible){$('beat-feedback').hidden=!visible;timingBox.reset();}
 // Only this small dot pulses on the beat; the box text changes slowly.
 $('beat-dot').classList.toggle('on',!!beat?.enabled&&beat.phase<.18);
 if(!visible)return;
 if(paused){
  const why=f.audio?.status?.includes('Following')?'Waiting for fresh audio timing.':f.audio?.status||'Connect system audio or choose manual BPM.';
  timingBox.show({key:`paused|${why}`,paused:true,bpm:0,tone:'wait',render(){$('beat-pulse').textContent='Beat timing paused';$('beat-brief').textContent='Waiting for audio';$('beat-hits').replaceChildren(Object.assign(document.createElement('div'),{textContent:why}));}},{immediate});
  return;
 }
 const bpm=Math.round(beat.bpm),brief=beat.hits.map((hit,i)=>!hit?'Follow the pulse':`${beat.hits.length>1?'AB'[i]+': ':''}${Math.abs(hit.offsetMs)<=75?'On beat':Math.round(Math.abs(hit.offsetMs))+' ms '+(hit.offsetMs<0?'early':'late')} · ${hit.error<=f.config.tolerance?'on target':'off target'}`).join(' / '),rows=beat.hits.map((hit,i)=>{
  if(!hit)return {text:f.config.mode==='antispin'?'Alternate tips at the four outer turnarounds, one per pulse.':`${'AB'[i]} · pass the BEAT TIP across a numbered target on a pulse`,good:false};
  const onBeat=Math.abs(hit.offsetMs)<=75,precise=hit.error<=f.config.tolerance,timing=onBeat?'on beat':`${Math.round(Math.abs(hit.offsetMs))} ms ${hit.offsetMs<0?'early':'late'}`;
  return {text:`${'AB'[i]} · ${f.config.mode==='antispin'?'turnaround':'point'} ${hit.point}: ${timing} · ${precise?'on target':'off target'} (${hit.error.toFixed(1)}%)`,good:onBeat&&precise};
 });
 timingBox.show({key:`${bpm}|${rows.map(r=>r.text).join('|')}`,paused:false,bpm,tone:'timing',render(){$('beat-pulse').textContent=`${bpm} BPM`;$('beat-brief').textContent=brief;$('beat-hits').replaceChildren(...rows.map(r=>Object.assign(document.createElement('div'),{textContent:r.text,className:r.good?'good':''})));}},{immediate});
}
function setCoaching(f,reason='idle') {
  const immediate=!!replay;
  if(!f){
    const stalled=reason==='stalled';
    const phases={opening:['OPENING CAMERA','Keep this tab visible while the camera starts.'],paused:['CAMERA PAUSED','Return to this tab to resume. Any recording has stopped.'],disconnected:['CAMERA DISCONNECTED','Reconnect the webcam, then choose Use PC camera.'],error:['CAMERA STOPPED','Choose Use PC camera to restart. Any recording is in the practice log.'],stopped:['CAMERA STOPPED','Choose Use PC camera when you are ready.']};
    if (localMode && phases[reason]) {
      const [title,detail]=phases[reason];
      trackingBox.show({key:`local|${reason}`,tone:'idle',render(){$('tracking-title').textContent=title;$('tracking-detail').textContent=detail;}},{immediate:true});
    } else
    if(cameraError&&!stalled)trackingBox.show({key:`error|${cameraError}`,tone:'warn',render(){$('tracking-title').textContent='CAMERA DID NOT START';$('tracking-detail').textContent=cameraError;}},{immediate:true});
    else trackingBox.show({key:`idle|${reason}`,tone:'idle',render(){$('tracking-title').textContent=stalled?'NO FRESH FRAMES':'NO CAMERA YET';$('tracking-detail').textContent=stalled?'The camera stream paused. Scores pause until frames return.':'Connect your phone, use your PC camera, or explore the demo.';}},{immediate:!stalled});
    coachingBox.show({key:'idle',state:'idle',mode:config.mode,cues:false,tone:'idle',render(){$('coaching-title').textContent='WAITING';$('coaching-detail').textContent='Alignment feedback appears when your staves are tracked.';}},{immediate:!stalled});
    return;
  }
  const feedback=displayedFeedback,t=feedback.tracking,summary=feedback.summary,pacerState=f.pacer?.enabled?f.pacer.state:'off';
  trackingBox.show({key:`${pacerState}|${t.key}|${t.detail}`,pacerState,tone:t.tone,snapshot:capturingBackground(f),render(){$('tracking-title').textContent=t.title;$('tracking-detail').textContent=t.detail;}},{immediate});
  const tone=feedback.state==='aligned'||feedback.state==='settling'?'ok':feedback.state==='adjust'?'warn':feedback.state==='free'?'idle':'wait';
  const alignment=summary||{...feedback,tone},state=summary?'recent':feedback.state;
  coachingBox.show({key:`${pacerState}|${state}|${alignment.title}|${alignment.detail}`,pacerState,state,mode:f.config.mode,cues:!summary&&!!feedback.cues,tone:alignment.tone,render(){$('coaching-title').textContent=alignment.title;$('coaching-detail').textContent=alignment.detail;}},{immediate});
}
// Alignment errors show 5-second averages of clear samples. Any current uncertainty pauses them at once,
// and live scores return on confirmed observations without waiting for the text fade.
function scoreView(f){
  const raw=f.metrics||{},averaged=averagedFor(f),source=averaged||raw,hold=!replay&&!displayedFeedback.tracking?.confirmed;
  const pick=key=>raw[key]==null||hold?null:source[key]??null;
  return {deviation:pick('deviation'),angle:pick('angle'),symmetry:pick('symmetry'),steadiness:raw.steadiness==null||hold?null:raw.steadiness,coverage:raw.coverage,averaged:!!averaged};
}
function setMetrics(f) {
  const shown=f?scoreView(f):null,tolerance=f?.config.tolerance??config.tolerance;
  for (const [key, suffix] of [
    ["deviation", "%"],
    ["angle", "°"],
    ["symmetry", "%"],
    ["steadiness", "%"],
  ]) {
    const value = shown?.[key];
    $(key).style.color =
      (key === "deviation" || key === "symmetry") &&
      typeof value === "number" &&
      value > tolerance
        ? "#f2c48f"
        : "";
    $(key).replaceChildren(
      document.createTextNode(
        typeof value === "number" ? value.toFixed(1) : "—",
      ),
      Object.assign(document.createElement("small"), { textContent: suffix }),
    );
  }
  const basis=shown&&!shown.averaged?'Latest sample':'5-second average';
  for(const e of document.querySelectorAll('[data-basis]'))if(e.textContent!==basis)e.textContent=basis;
  if (shown && Number.isFinite(shown.coverage))
    $("coverage").textContent =
      `Tracking coverage: ${Math.round(shown.coverage)}% · recent 1.2s`;
  else $("coverage").textContent = "Tracking coverage: —";
}
let chartBox={width:0,height:0},rootPx=20;
function chartValue(f){const raw=f.metrics?.deviation;if(raw==null)return null;const averaged=averagedFor(f);return averaged?averaged.deviation??null:raw;}
function drawChart() {
  const dpr=devicePixelRatio||1,w=chartBox.width||1000,h=chartBox.height||140;
  if(chart.width!==Math.round(w*dpr)||chart.height!==Math.round(h*dpr)){chart.width=Math.round(w*dpr);chart.height=Math.round(h*dpr);}
  chartCtx.setTransform(dpr,0,0,dpr,0,0);chartCtx.clearRect(0,0,w,h);
  const fs=Math.max(11,rootPx*.78),left=fs*2.7,top=fs*.7,bottom=h-fs*.6,tolerance=config.tolerance;
  const values=history.map(chartValue),max=Math.max(10,tolerance*2,...values.map(v=>v??0)),y=v=>bottom-(v/max)*(bottom-top);
  chartCtx.strokeStyle="#34402d";chartCtx.lineWidth=1;
  for(const v of [max/3,max*2/3,max]){chartCtx.beginPath();chartCtx.moveTo(left,y(v));chartCtx.lineTo(w,y(v));chartCtx.stroke();}
  const targetY=y(tolerance);
  chartCtx.fillStyle="#b6f36b12";chartCtx.fillRect(left,targetY,w-left,bottom-targetY);
  chartCtx.strokeStyle="#b6f36b88";chartCtx.setLineDash([5,6]);chartCtx.beginPath();chartCtx.moveTo(left,targetY);chartCtx.lineTo(w,targetY);chartCtx.stroke();chartCtx.setLineDash([]);
  chartCtx.font=`${fs}px system-ui, sans-serif`;chartCtx.fillStyle="#c9dcb5";chartCtx.textAlign="right";
  chartCtx.fillText(`Target ${tolerance}%`,w-4,Math.max(fs,targetY-fs*.35));
  chartCtx.fillStyle="#c3ccb9";chartCtx.fillText(`${Math.ceil(max)}%`,left-fs*.4,top+fs*.35);chartCtx.fillText("0",left-fs*.4,bottom);chartCtx.textAlign="start";
  const first=history[0]?.time??0,last=history.at(-1)?.time??1,span=Math.max(1000,last-first);
  chartCtx.strokeStyle="#b6f36b";chartCtx.lineWidth=2.5;chartCtx.lineJoin="round";chartCtx.beginPath();
  let pen=false;
  history.forEach((f,i)=>{
    const value=values[i];if(value==null){pen=false;return;}
    const x=left+((f.time-first)/span)*(w-left-2);
    if(pen)chartCtx.lineTo(x,y(value));else chartCtx.moveTo(x,y(value));pen=true;
  });
  chartCtx.stroke();
  const basis=history.length&&!history.some(f=>averagedFor(f))?'latest sample':'5-second average';
  if($('chart-basis').textContent!==basis)$('chart-basis').textContent=basis;
}
function acceptFrame(f, image = null) {
  sourceStalled = false;
  if(!f.streak)f={...f,streak:fallbackStreak.update(f)};
  if(!replay){if(current&&(f.time<current.time||f.source!==current.source))legacyRolling=null;legacyRolling=averageLegacy(f,legacyRolling);}
  // During a background snapshot the capture instruction is the only prompt on the stage.
  const flow=f.streak,hud=$('streak-hud'),pacerState=f.pacer?.enabled?f.pacer.state:'off';hud.hidden=f.config.streakEffects===false||capturingBackground(f);
  const flowLabel=()=>f.pacer?.enabled?streakText(flow).replaceAll('the guide','the moving dots'):streakText(flow);
  // The streak state label is held like the status boxes; the counter ticks live within the shown state.
  if(hud.hidden)streakBox.reset();
  else{
    streakBox.show({key:`${pacerState}|${flow.state}`,pacerState,state:flow.state,render(){$('streak-title').textContent=flowLabel();$('streak-title').style.color=flow.state==='recovering'?'var(--slate)':'';hud.dataset.state=flow.state;}},{immediate:!!replay});
    if(streakBox.shown?.state===flow.state)$('streak-title').textContent=flowLabel();
  }
  $('streak-power').style.width=`${flow.progress*100}%`;$('streak-power').parentElement.setAttribute('aria-valuenow',Math.min(30,flow.seconds).toFixed(1));
  $('streak-power').parentElement.setAttribute('aria-valuetext',`${Math.round(flow.progress*100)}% power · ${Math.min(30,flow.seconds).toFixed(1)} of 30 seconds`);
  $('streak-detail').textContent=flow.state==='free'?'Choose a guide to earn alignment streaks.':`Best ${flow.bestSeconds.toFixed(1)}s · full power at 30s`;
  displayedFeedback=alignmentFeedback.update(f);
  current = f;
  showPacer(f);
  if (lastImage && lastImage !== image) lastImage.close?.();
  lastImage = image;
  $("empty-state").hidden = true;
  $("stage-badge").hidden = f.source !== "demo" && !replay;
  $("stage-badge").textContent = replay
    ? "ANALYSIS REPLAY · NO VIDEO"
    : "DEMO · GENERATED MOTION";
  $("source-label").textContent = replay
    ? "SESSION REVIEW"
    : f.source === "demo"
      ? "DEMO · GENERATED MOTION"
      : localMode ? "LIVE FROM YOUR PC CAMERA" : "LIVE FROM YOUR PHONE";
  $("live-dot").style.background = f.source === "demo" ? "#b5a3ff" : "#b6f36b";
  const count=f.config.staffCount||2,shown=scoreView(f);
  const good = f.staffs.slice(0,count).filter((s) => s && s.confidence >= 0.55).length;
  $("tracking-label").textContent = capturingBackground(f) ? "Background snapshot · keep staves out of view"
    : displayedFeedback.tracking.confirmed
      ? (count===1?"One staff tracked":"Both staves tracked") +
        (shown.deviation == null
          ? ""
          : shown.deviation <= f.config.tolerance
            ? " · within target"
            : " · outside target")
      : good === count ? "Precision paused · waiting for clear tips" : `${good} / ${count} staves visible · scores paused`;
  if(localMode&&!replay)updateCameraDetails(f);
  $("camera-info").textContent = replay
    ? `Sample at ${(f.elapsedMs / 1000).toFixed(2)}s`
    : `${f.status ?? "Phone camera"} · ${Math.round(f.analysisFps ?? 0)} analysis fps` + (localMode ? ` · ${Math.round(f.cameraFps || 0)} camera fps` : f.source === "demo" ? "" : ` · ${Math.round(previewFps)} preview fps`);
  $("record").classList.toggle("recording", !!f.recording);
  $("record").textContent = f.finalizing
    ? "Saving…"
    : f.recording
      ? `■ Stop · ${Math.floor(f.elapsedMs / 1000)}s`
      : "● Record practice";
  const previousTrail=trail.at(-1);
  // New detection filters or a new background snapshot invalidate old (possibly false) trails.
  if(previousTrail&&(f.time<previousTrail.time||f.source!==previousTrail.source||f.width!==previousTrail.width||f.height!==previousTrail.height||['facing','mirror','zoom','staffCount','led'].some(k=>f.config[k]!==previousTrail.config[k])||String(f.config.staffColors||[])!==String(previousTrail.config.staffColors||[])||(f.background?.state||'off')!==(previousTrail.background?.state||'off')))trail=[];
  if(trail.at(-1)?.time!==f.time)trail.push(f);
  trail = trail.filter((t) => f.time - t.time < 4200).slice(-512);
  render(f, image);
  if (f.zoom && document.activeElement !== $("zoom")) {
    $("zoom").min = f.zoom.min; $("zoom").max = f.zoom.max; $("zoom").value = f.zoom.ratio;
    $("zoom").disabled = !f.cameraReady || f.zoom.min === f.zoom.max || !!replay;
    document.querySelector('output[for="zoom"]').textContent = `${f.zoom.ratio.toFixed(2)}×`;
  }
  const fitText=f.fitStatus||(f.source==='demo'?'Auto-fit and Match staff length need a live camera. In the demo, use the sliders or Reset guide layout.':'Get into position, then press Auto-fit and spin normally for two seconds with your full staves in view.');
  if($('fit-status').textContent!==fitText)$('fit-status').textContent=fitText;
  // Keep the last size reading briefly so this helper does not flicker while tips blur.
  const visible=f.staffs.filter(s=>s&&s.confidence>=.7&&!s.occluded);const staffLength=visible.length?visible.reduce((n,s)=>n+length(s),0)/visible.length:0;
  if(staffLength&&!f.guide.calibrated)sizeReading={text:`Guide width / staff length: ${(f.guide.span/staffLength).toFixed(2)}×. Match staff length sets this to ${f.config.mode==='antispin'?'2× for the antispin cross (center to edge = one staff)':'1×'}; adjust Size for your pattern.`,time:f.time};
  else if(f.guide.calibrated||!sizeReading||f.time-sizeReading.time>2500||f.time<sizeReading.time)sizeReading={text:f.guide.calibrated?'With angle calibration, size is fitted in the calibrated plane.':'Size help appears when a full staff is clearly visible.',time:-Infinity};
  if($('size-helper').textContent!==sizeReading.text)$('size-helper').textContent=sizeReading.text;
  // Explain the detector minimum in pixels of this camera image (the PC camera reports its full resolution).
  const dims=localMode&&!replay&&localCamera.settings?.width?[localCamera.settings.width,localCamera.settings.height]:[f.width,f.height],edge=Math.min(...dims),minLength=f.config.minLength??config.minLength;
  setText('min-length-help',`The staff's apparent end-to-end length in the camera image, as a percent of the image's shorter edge. Shorter lights are ignored. Here ${Math.round(minLength*100)}% of the ${edge}-pixel edge is ${Math.round(edge*minLength)} pixels; on 1920 × 1080 video, 22% is 238 pixels. This is not the guide size or the staff's real length.`);
  setText('detect-summary',detectionSummary(f.config,f.background?.state));
  setPracticing(true);
  showBackground(f);
  showBeat(f);
  setCoaching(f);
  setMetrics(f);
  if (!replay) {
    history.push(f);
    history = history.filter((t) => f.time - t.time < 30000).slice(-900);
  }
  drawChart();
  enableControls();
}
async function loadSessions() {
  if (!paired && !localMode) return;
  try {
    const { sessions } = localMode ? { sessions: await localCamera.sessions() } : await api("/api/sessions");
    $("sessions").replaceChildren();
    if (!sessions.length)
      $("sessions").append(
        Object.assign(document.createElement("p"), {
          className: "small-note",
          textContent:
            "No recordings yet. Your first session will appear here.",
        }),
      );
    for (const s of sessions) {
      const card = document.createElement("div");
      card.className = "session";
      card.textContent = new Date(s.createdAt).toLocaleString();
      card.append(
        Object.assign(document.createElement("small"), {
          textContent: `${Math.round(s.durationMs / 1000)}s · ${s.validFrames} scored samples${s.temporary ? " · Kept only in this tab. Download video and export analysis now." : ""}${s.recordingError != null ? " · recording error" : ""}`,
        }),
      );
      const review = Object.assign(document.createElement("button"), {
        textContent: "Review",
      });
      review.onclick = async () => {
        try {
          if (localMode) { await loadAnalysis(await (await localCamera.session(s.id)).analysis.text()); return; }
          const r = await fetch(`/api/session?id=${encodeURIComponent(s.id)}`);
          if (!r.ok) throw new Error("Cannot load analysis");
          await loadAnalysis(await r.text());
        } catch (e) {
          message(e.message);
        }
      };
      const download = Object.assign(document.createElement("a"), {
        href: `/api/session?id=${encodeURIComponent(s.id)}`,
        textContent: "Export ↗",
        download: `${s.id}.jsonl`,
      });
      if (localMode) {
        download.removeAttribute("href"); download.setAttribute("role", "button"); download.tabIndex = 0;
        download.onclick = async () => downloadBlob((await localCamera.session(s.id)).analysis, `${s.id}.jsonl`);
        download.onkeydown = e => { if (e.key === "Enter") download.click(); };
        const play = Object.assign(document.createElement("button"), { textContent: "Play video" });
        play.onclick = async () => { const session = await localCamera.session(s.id); sessionVideoUrl = URL.createObjectURL(session.video); $("session-video").src = sessionVideoUrl; $("video-dialog").showModal(); $("session-video").play().catch(() => {}); };
        const save = Object.assign(document.createElement("button"), { textContent: "Download video" });
        save.onclick = async () => { const session = await localCamera.session(s.id); downloadBlob(session.video, `${s.id}.${session.mimeType.includes("mp4") ? "mp4" : "webm"}`); };
        card.append(play, save);
      }
      card.append(review, download);
      $("sessions").append(card);
    }
  } catch (e) {
    message(e.message);
  }
}
$("refresh-sessions").onclick = loadSessions;
async function loadAnalysis(text) {
  if (localCamera.recording || localCamera.finalizing || (!replay && (current?.recording || current?.finalizing))) throw Error("Stop recording before reviewing saved analysis.");
  if (text.length > 30_000_000)
    throw new Error("Analysis export is too large (30 MB limit).");
  const rows = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (rows[0]?.type !== "header" || rows[0]?.schema !== 1)
    throw new Error("Choose a Klobflow analysis export.");
  const frames = rows.slice(1);
  if (!frames.length)
    throw new Error("This session contains no measured frames.");
  for (const f of frames) {
    if (
      !Number.isFinite(f.time) ||
      !Number.isFinite(f.width) ||
      !Number.isFinite(f.height) ||
      f.width < 1 ||
      f.height < 1 ||
      f.width > 8192 ||
      f.height > 8192 ||
      !Array.isArray(f.staffs) ||
      f.staffs.length !== 2 ||
      !f.guide ||
      !f.config ||
      !f.metrics
    )
      throw new Error("Invalid analysis frame.");
  }
  // Older exports have raw samples only; average them in order so scrubbing shows consistent values.
  await rollingReady;
  let rolling=null;for(const f of frames)rolling=averageLegacy(f,rolling);
  resetDemoPacer();
  stopStream();
  replay = frames;
  updateSourceControls();
  history = frames;
  trail = [];
  $("scrubber").max = String(frames.length - 1);
  $("scrubber").value = "0";
  $("replay-control").hidden = false;
  $("return-live").hidden = false;
  $("chart-source").textContent = "RECORDED SESSION";
  showReplay(0);
  message(
    localMode ? "Showing saved analysis. Use Play video in the practice log for the recording." : "Showing saved analysis. The matching video is on the phone in Movies / Klobflow.",
  );
  enableControls();
}
function showReplay(index) {
  const f = replay[index];
  trail = replay.slice(Math.max(0, index - 512), index).filter(f => replay[index].time - f.time < 4200);
  syncConfig(f.config);
  acceptFrame(f);
  document.querySelector('output[for="scrubber"]').textContent =
    `${index + 1} / ${replay.length}`;
}
$("import-analysis").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 30_000_000)
      throw new Error("Choose an export under 30 MB.");
    await loadAnalysis(await file.text());
  } catch (err) {
    message(err.message);
  }
  e.target.value = "";
};
$("scrubber").oninput = (e) => showReplay(Number(e.target.value));
$("return-live").onclick = () => {
  replay = null;
  updateSourceControls();
  trail = [];
  history = [];
  legacyRolling = null;
  lastTime = null;
  $("replay-control").hidden = true;
  $("return-live").hidden = true;
  $("chart-source").textContent = "LAST 30 SECONDS";
  message("");
  if (!paired && !demo && !localMode) resetView();
  enableControls();
};
function stopStream() {
  streamController?.abort(); streamController = null; nextStreamAt = 0;
}
function pauseLiveFeedback() {
  if (!sourceStalled) {
    sourceStalled=true;
    $('streak-hud').hidden=true;$('beat-feedback').hidden=true;streakBox.reset();timingBox.reset();
    if(current)render(current,lastImage);
  }
  setMetrics(null);setCoaching(null,"stalled");
}
async function receiveStream() {
  const controller = new AbortController(); streamController = controller;
  const decoder = new FrameDecoder();
  let pending = null, drawing = false;
  const drawLatest = async () => {
    if (drawing) return;
    drawing = true;
    try {
      while (pending && !controller.signal.aborted) {
        const packet = pending; pending = null;
        const image = await createImageBitmap(new Blob([packet.jpeg], { type: "image/jpeg" }));
        if (controller.signal.aborted) { image.close(); break; }
        const now = performance.now(); arrivals.push(now); arrivals = arrivals.filter(t => now - t < 1500);
        previewFps = arrivals.length > 1 ? (arrivals.length - 1) * 1000 / (now - arrivals[0]) : 0;
        syncConfig(packet.frame.currentConfig || packet.frame.config);
        acceptFrame(packet.frame, image);
        if (packet.frame.error) message(packet.frame.error);
      }
    } catch (e) { if (!controller.signal.aborted) message(e.message); }
    finally { drawing = false; }
  };
  try {
    const response = await fetch("/api/stream", { signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).error || "Camera stream unavailable");
    message("");
    const reader = response.body.getReader();
    while (!controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Camera paused. Reopen Klobflow to resume.");
      const packets = decoder.push(value);
      if (packets.length) {
        pending = packets.at(-1); lastArrival = Date.now(); drawLatest();
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) {
      pauseLiveFeedback();
      $("tracking-label").textContent = "Reconnecting · reopen Klobflow on your phone";
      $("source-label").textContent = "CAMERA PAUSED";
      enableControls(); message(e.message);
    }
  } finally {
    controller.abort();
    if (streamController === controller) { streamController = null; nextStreamAt = Date.now() + 1000; }
  }
}
function loop() {
  updateAudioStatus();
  if (!replay && demo) acceptFrame(demoFrame(config, performance.now()));
  if (paired && !replay && !streamController && Date.now() >= nextStreamAt) receiveStream();
  if ((paired || (localMode && localCamera.active)) && !replay && Date.now() - lastArrival > (current?.pacer?.enabled?750:2000)) {
    pauseLiveFeedback(); enableControls();
    $("tracking-label").textContent = "Waiting for fresh camera frames…";
    $("source-label").textContent = "CAMERA PAUSED";
  }
  if (localMode && !replay) canvas.style.opacity = Date.now() - lastArrival > 200 ? "0" : "1";
  else canvas.style.opacity = "1";
  setTimeout(loop, 33);
}
syncConfig(config);
enableControls();
drawEmpty();
drawChart();
api("/api/status")
  .then((s) => {
    if (s.paired) {
      transport = s.transport;
      connected(true);
      loadSessions();
    } else {
      try { if (localStorage.getItem("klobflow.lastMode") === "local") navigator.permissions?.query({name:"camera"}).then(p => { if (p.state === "granted") startLocal(); }).catch(() => {}); } catch {}
    }
  })
  .catch((e) => message(e.message));
loop();
