// Cosmetic rewards use observed alignment only. They never alter precision metrics.
export class FlowStreak {
 constructor(){this.reset();}
 reset(clearBest=true){this.time=null;this.key='';this.ms=0;if(clearBest)this.best=0;this.energy=0;this.previousGood=false;this.uncertainSince=null;}
 update({time,config,staffs,feedback=[]}){
  const key=JSON.stringify([config.mode,config.staffCount,config.tolerance,config.cx,config.cy,config.scale,config.rotation,config.cubeDepth,config.circleSeparation,config.planeCorners,config.planeAspect,config.calibrationRotation,config.calibrationImageAspect,config.diagonals,config.facing,config.mirror,config.zoom,config.streakEffects,config.staffColors,config.led,config.threshold,config.minLength]);
  if(key!==this.key||this.time!==null&&time<this.time)this.reset();
  else if(this.time!==null&&time-this.time>250)this.reset(false);
  const dt=this.time===null?0:Math.max(0,time-this.time);this.time=time;this.key=key;
  const count=config.staffCount||2,clear=staffs.slice(0,count).length===count&&staffs.slice(0,count).every(s=>s&&!s.blurred&&!s.occluded&&s.confidence>=.55)&&feedback.length===count*2;
  const good=clear&&feedback.every(c=>Number.isFinite(c.error)&&c.error<=config.tolerance);
  let state;
  if(config.mode==='free'||config.streakEffects===false){this.ms=0;this.energy=0;this.previousGood=false;this.uncertainSince=null;state=config.mode==='free'?'free':'off';}
  else if(!clear){this.uncertainSince??=time;if(time-this.uncertainSince>350)this.ms=0;this.previousGood=false;state='paused';}
  else if(!good){this.ms=0;this.previousGood=false;this.uncertainSince=null;state='ready';}
  else {if(this.uncertainSince!==null&&time-this.uncertainSince>350)this.ms=0;this.uncertainSince=null;if(this.previousGood)this.ms+=dt;this.previousGood=true;state='building';}
  this.best=Math.max(this.best,this.ms);
  const target=state==='building'?Math.min(1,this.ms/10000):0;
  this.energy+=(target-this.energy)*(1-Math.exp(-dt/350));
  const level=this.ms>=10000?4:this.ms>=5000?3:this.ms>=2000?2:1;
  return {state,seconds:this.ms/1000,bestSeconds:this.best/1000,level,energy:this.energy,progress:Math.min(1,this.ms/10000)};
 }
}
export function streakText(flow){
 if(flow.state==='off')return 'STREAK EFFECTS OFF';
 if(flow.state==='free')return 'FREE FLOW · trails without alignment streaks';
 if(flow.state==='paused')return 'STREAK PAUSED · waiting for clear tips';
 if(flow.state==='ready')return 'BUILD YOUR STREAK · keep every tip on the guide';
 return `FLOW STREAK · ${flow.seconds.toFixed(1)}s · LEVEL ${flow.level}`;
}
