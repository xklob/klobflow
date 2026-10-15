import {add, mul, distance} from './core.mjs';

const configKey=c=>JSON.stringify([c.mode,c.staffCount,c.pacerEnabled,c.pacerRpm,c.pacerDirection,c.pacerPattern,c.pacerOffset,c.pacerCountdown,
  c.cx,c.cy,c.scale,c.rotation,c.circleSeparation,c.tolerance,c.planeCorners,c.planeAspect,c.calibrationRotation,c.calibrationImageAspect,
  c.facing,c.mirror,c.zoom,c.led,c.threshold,c.minLength,c.staffColors,c.fps]);
const enabled=g=>g.config.pacerEnabled&&['circles','antispin'].includes(g.config.mode);
const finitePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const clear=s=>Boolean(s&&Number.isFinite(s.confidence)&&s.confidence>=.55&&!s.blurred&&!s.occluded&&finitePoint(s.a)&&finitePoint(s.b));
const squared=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;

/** Runtime-only exercise. Missing observations never stop the dots or become scores. */
export class MovingPacer {
  constructor(){this.reset();}
  reset(){this.key=null;this.time=null;this.state='off';this.elapsedMs=0;this.countdownMs=0;this.clearStatistics();}
  clearStatistics(){this.history=[];this.sampleTime=null;}
  reconfigure(before,after){if(configKey(before)!==configKey(after))this.reset();}
  ready(g){this.state=enabled(g)?'ready':'off';this.elapsedMs=0;this.countdownMs=0;this.clearStatistics();}
  synchronize(time,g){
    const key=configKey(g.config)+`:${g.width}:${g.height}`;
    if(this.key!==key){this.reset();this.key=key;this.ready(g);}
    const previous=this.time;this.time=time;
    if(previous!==null&&(time<previous||time-previous>750)){this.ready(g);return;}
    let remaining=previous===null?0:time-previous;
    if(this.state==='countdown'){
      const used=Math.min(remaining,this.countdownMs);this.countdownMs-=used;remaining-=used;
      if(this.countdownMs===0)this.state='running';
    }
    if(this.state==='running')this.elapsedMs+=remaining;
  }
  command(operation,time,g){
    if(!['start','pause','resume','restart','stop'].includes(operation))throw Error('Unknown moving-dot operation');
    if(!Number.isFinite(time))throw Error('Moving dots require a finite timestamp');
    this.synchronize(time,g);
    if(operation==='start'||operation==='restart'){
      if(!enabled(g))throw Error('Enable moving dots in Circles or Antispin before starting');
      this.elapsedMs=0;this.countdownMs=g.config.pacerCountdown*1000;this.state=this.countdownMs>0?'countdown':'running';this.clearStatistics();
    }else if(operation==='pause'){
      if(this.state==='running'||this.state==='countdown')this.state='paused';
      this.countdownMs=0;this.clearStatistics();
    }else if(operation==='resume'&&this.state==='paused'){
      this.countdownMs=g.config.pacerCountdown*1000;this.state=this.countdownMs>0?'countdown':'running';this.clearStatistics();
    }else if(operation==='stop')this.ready(g);
  }
  update(time,staffs,g){
    if(!Number.isFinite(time))throw Error('Moving dots require a finite timestamp');
    this.synchronize(time,g);
    const c=g.config,active=enabled(g),phase=(this.elapsedMs*c.pacerRpm/60000)%1;
    const frame={enabled:active,state:this.state,phase,elapsedSeconds:this.elapsedMs/1000,countdownMs:this.countdownMs,rpm:c.pacerRpm,
      targets:[],feedback:[],valid:false,onTarget:false,meanError:null,onTargetPercent:null,measuredPercent:null};
    if(!active)return frame;
    const sign=c.pacerDirection==='cw'?1:-1,theta=sign*2*Math.PI*phase;
    const count=c.mode==='antispin'?1:c.staffCount;
    const planeTargets=c.mode==='antispin'?[[g.point(Math.cos(theta),0),g.point(0,Math.sin(theta))]]:
      g.circles.slice(0,count).map((center,i)=>{
        const angle=theta*(i===1&&c.pacerPattern==='opposite'?-1:1)+(c.rotation+(i===1?c.pacerOffset:0))*Math.PI/180;
        const delta=mul([Math.cos(angle),Math.sin(angle)],g.radius);return [add(center,delta),add(center,mul(delta,-1))];
      });
    frame.targets=planeTargets.map(pair=>pair.map(p=>g.project(p)));
    if(this.state!=='running')return frame;
    const selected=staffs.slice(0,count);
    const measured=selected.length===count&&selected.every(clear)?selected.map(s=>g.rectify(s)):[];
    frame.valid=measured.length===count&&measured.every(clear);
    if(frame.valid){
      frame.feedback=measured.flatMap((s,i)=>{
        const pair=planeTargets[i],swap=squared(s.a,pair[1])+squared(s.b,pair[0])<squared(s.a,pair[0])+squared(s.b,pair[1]);
        return [s.a,s.b].map((point,j)=>{
          const targetIndex=swap?1-j:j,target=pair[targetIndex],error=distance(point,target)/(2*g.radius)*100;
          return {tip:j?selected[i].b:selected[i].a,target:frame.targets[i][targetIndex],error,onTarget:error<=c.tolerance,
            ...(c.mode==='antispin'?{axis:targetIndex?'vertical':'horizontal'}:{})};
        });
      });
      frame.onTarget=frame.feedback.every(cue=>cue.onTarget);
    }
    if(this.sampleTime!==time){
      this.history.push({time,valid:frame.valid,onTarget:frame.onTarget,error:frame.valid?frame.feedback.reduce((n,cue)=>n+cue.error,0)/frame.feedback.length:null});
      this.sampleTime=time;
    }
    this.history=this.history.filter(sample=>time-sample.time<=5000);
    const measuredHistory=this.history.filter(sample=>sample.valid);
    frame.measuredPercent=this.history.length?measuredHistory.length/this.history.length*100:null;
    if(measuredHistory.length){
      frame.meanError=measuredHistory.reduce((n,sample)=>n+sample.error,0)/measuredHistory.length;
      frame.onTargetPercent=measuredHistory.filter(sample=>sample.onTarget).length/measuredHistory.length*100;
    }
    return frame;
  }
}
