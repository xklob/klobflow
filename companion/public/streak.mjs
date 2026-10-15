// Cosmetic rewards use observed alignment only. They never alter precision metrics.
export class FlowStreak {
 constructor(){this.reset();}
 reset(clearBest=true){this.time=null;this.key='';this.ms=0;if(clearBest)this.best=0;this.energy=0;this.previousGood=false;this.interruptedSince=null;this.interruptionLimit=Infinity;}
 update({time,config,staffs,feedback=[],pacer=null}){
  // Older recordings/phones omit these settings. Preserve the defaults there too.
  const trackingGrace=config.trackingGraceMs??1500,alignmentGrace=config.alignmentGraceMs??200;
  const key=JSON.stringify([config.mode,config.staffCount,config.tolerance,trackingGrace,alignmentGrace,config.cx,config.cy,config.scale,config.rotation,config.cubeDepth,config.circleSeparation,config.planeCorners,config.planeAspect,config.calibrationRotation,config.calibrationImageAspect,config.diagonals,config.facing,config.mirror,config.zoom,config.streakEffects,config.staffColors,config.led,config.threshold,config.minLength,config.pacerEnabled,config.pacerRpm,config.pacerDirection,config.pacerPattern,config.pacerOffset,config.pacerCountdown]);
  if(key!==this.key||this.time!==null&&time<this.time)this.reset();
  else if(this.time!==null&&time-this.time>250)this.reset(false);
  const dt=this.time===null?0:Math.max(0,time-this.time);this.time=time;this.key=key;
  const following=!!config.pacerEnabled&&['circles','antispin'].includes(config.mode);
  if(following)feedback=pacer?.enabled&&pacer.state==='running'?pacer.feedback:[];
  const count=config.staffCount||2,clear=(!following||pacer?.valid===true)&&staffs.slice(0,count).length===count&&staffs.slice(0,count).every(s=>s&&!s.blurred&&!s.occluded&&s.confidence>=.55)&&feedback.length===count*2;
  const good=clear&&feedback.every(c=>Number.isFinite(c.error)&&c.error<=config.tolerance);
  let state;
  if(config.mode==='free'||config.streakEffects===false){this.ms=0;this.energy=0;this.previousGood=false;this.interruptedSince=null;this.interruptionLimit=Infinity;state=config.mode==='free'?'free':'off';}
  else if(following&&(!pacer?.enabled||pacer.state!=='running')){this.ms=0;this.energy=0;this.previousGood=false;this.interruptedSince=null;this.interruptionLimit=Infinity;state='practice';}
  else if(!good){
   this.interruptedSince??=time;
   // A switch between uncertain and off-target must not restart the grace clock.
   this.interruptionLimit=Math.min(this.interruptionLimit,clear?alignmentGrace:trackingGrace);
   if(this.interruptionLimit===0||time-this.interruptedSince>this.interruptionLimit)this.ms=0;
   this.previousGood=false;state=this.ms>0?(clear?'recovering':'held'):(clear?'ready':'paused');
  }else {
   if(this.interruptedSince!==null&&time-this.interruptedSince>this.interruptionLimit)this.ms=0;
   this.interruptedSince=null;this.interruptionLimit=Infinity;
   if(this.previousGood)this.ms+=dt;this.previousGood=true;state='building';
  }
  this.best=Math.max(this.best,this.ms);
  // Forgiveness keeps earned effects, never hidden or off-target time.
  const progress=Math.min(1,this.ms/30000);
  if(state==='building')this.energy=progress;
  else if(state!=='held'&&state!=='recovering')this.energy*=Math.exp(-dt/350);
  // Legacy wire field only; current renderers and labels use continuous power.
  const level=1+Math.floor(progress*3);
  return {state,seconds:this.ms/1000,bestSeconds:this.best/1000,level,energy:this.energy,progress};
 }
}
export function streakText(flow){
 if(flow.state==='off')return 'STREAK EFFECTS OFF';
 if(flow.state==='practice')return 'STREAK PAUSED · guide dots are stopped';
 if(flow.state==='free')return 'FREE FLOW · trails without alignment streaks';
 if(flow.state==='held')return 'STREAK HELD · reacquiring tips';
 if(flow.state==='recovering')return 'STREAK HELD · return to the guide';
 if(flow.state==='paused')return 'STREAK PAUSED · waiting for clear tips';
 if(flow.state==='ready')return 'BUILD YOUR STREAK · keep every tip on the guide';
 return `FLOW STREAK · ${flow.seconds.toFixed(1)}s · ${flow.progress>=1?'MAX POWER':`GLOW ${Math.floor(flow.progress*100)}%`}`;
}
