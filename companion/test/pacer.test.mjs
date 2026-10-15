import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Guide,defaults,patchConfig,add,mul,distance} from '../public/core.mjs';
import {MovingPacer} from '../public/pacer.mjs';

const guide=(patch={})=>new Guide(patchConfig(defaults,{mode:'circles',staffCount:1,pacerEnabled:true,pacerCountdown:0,pacerRpm:30,...patch}),640,480);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function close(a,b){
  if(typeof b==='number')near(a,b);
  else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>close(a[i],v));}
  else if(b&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const k in b)close(a[k],b[k]);}
  else assert.equal(a,b);
}
function poses(g,phase,shift=0){
  const c=g.config,theta=(c.pacerDirection==='cw'?1:-1)*2*Math.PI*phase;
  const pairs=c.mode==='antispin'?[[g.point(Math.cos(theta),0),g.point(0,Math.sin(theta))]]:
    g.circles.map((center,i)=>{
      const a=theta*(i===1&&c.pacerPattern==='opposite'?-1:1)+(c.rotation+(i?c.pacerOffset:0))*Math.PI/180;
      const delta=mul([Math.cos(a),Math.sin(a)],g.radius);return [add(center,delta),add(center,mul(delta,-1))];
    });
  return pairs.map(pair=>({a:g.project(add(pair[0],[shift,0])),b:g.project(add(pair[1],[shift,0])),confidence:.9,occluded:false,blurred:false}));
}

test('pacer settings validate, round-trip, and old settings remain stopped by default',()=>{
  const legacy={...defaults};for(const key of Object.keys(legacy))if(key.startsWith('pacer'))delete legacy[key];
  const restored=patchConfig(legacy,{}, {restore:true});assert.equal(restored.pacerEnabled,false);assert.equal(restored.pacerRpm,20);assert.equal(restored.pacerCountdown,3);
  const c=patchConfig(defaults,{pacerEnabled:true,pacerRpm:22.5,pacerDirection:'ccw',pacerPattern:'same',pacerOffset:90,pacerCountdown:0,pacerDotSize:24});
  close(patchConfig(defaults,JSON.parse(JSON.stringify(c)),{restore:true}),c);
  for(const patch of [{pacerEnabled:'true'},{pacerRpm:4},{pacerRpm:121},{pacerRpm:'20'},{pacerCountdown:1.5},{pacerCountdown:11},{pacerDotSize:7},{pacerDotSize:29},{pacerOffset:181},{pacerDirection:'left'},{pacerPattern:'split'}])assert.throws(()=>patchConfig(defaults,patch));
});
test('dots require explicit start and unsupported or disabled modes stay off',()=>{
  const p=new MovingPacer(),g=guide();let f=p.update(0,poses(g,0),g);
  assert.equal(f.state,'ready');assert.equal(f.targets.length,1);assert.equal(f.valid,false);assert.equal(f.meanError,null);
  assert.equal(p.update(500,poses(g,.25),g).phase,0);
  p.command('start',500,g);f=p.update(500,poses(g,0),g);assert.equal(f.state,'running');assert.equal(f.valid,true);assert.equal(f.onTarget,true);
  p.reset();assert.equal(p.update(600,poses(g,0),g).state,'ready');
  for(const off of [guide({pacerEnabled:false}),guide({mode:'grid'}),guide({mode:'free'})]){
    assert.equal(p.update(700,[],off).state,'off');assert.deepEqual(p.update(700,[],off).targets,[]);assert.throws(()=>p.command('start',700,off));
  }
  assert.throws(()=>p.command('unknown',700,g));
});
test('speed is elapsed-time based at 30, 60 and 120 fps, with preview direction and staff offset',()=>{
  for(const fps of [30,60,120]){
    const p=new MovingPacer(),g=guide();p.command('start',0,g);let f;
    for(let i=0;i<=fps*1.5;i++)f=p.update(Math.round(i*1000/fps),[],g);
    near(f.phase,.75);near(f.elapsedSeconds,1.5);
  }
  for(const direction of ['cw','ccw'])for(const pattern of ['same','opposite']){
    const p=new MovingPacer(),g=guide({staffCount:2,pacerDirection:direction,pacerPattern:pattern,pacerOffset:90});p.command('start',0,g);
    const f=p.update(500,[],g),sign=direction==='cw'?1:-1;
    close(f.targets[0][0],add(g.circles[0],[0,sign*g.radius]));
    const angle=sign*Math.PI/2*(pattern==='opposite'?-1:1)+Math.PI/2;
    close(f.targets[1][0],add(g.circles[1],mul([Math.cos(angle),Math.sin(angle)],g.radius)));
  }
});
test('circle pairs are diameters and antispin pairs stay rigid through rotation and perspective',()=>{
  for(const mode of ['circles','antispin'])for(const perspective of [false,true]){
    const g=guide({mode,rotation:23,planeCorners:perspective?[[.12,.1],[.87,.16],[.91,.9],[.08,.81]]:[],calibrationImageAspect:4/3}),p=new MovingPacer();p.command('start',0,g);
    for(let t=0;t<=2000;t+=100){
      const frame=p.update(t,poses(g,t/2000%1),g);assert.equal(frame.onTarget,true);assert.equal(frame.valid,true);
      const pair=g.rectify({a:frame.targets[0][0],b:frame.targets[0][1],confidence:1});near(distance(pair.a,pair.b),g.radius*(mode==='circles'?2:1));
      if(mode==='antispin'){near(g.local(pair.a)[1],0);near(g.local(pair.b)[0],0);}
    }
  }
});
test('countdown, pause and resume preserve phase and exclude stopped time',()=>{
  const g=guide({pacerCountdown:1}),p=new MovingPacer();p.command('start',1000,g);
  let f=p.update(1000,poses(g,0),g);assert.equal(f.state,'countdown');assert.equal(f.countdownMs,1000);assert.equal(f.valid,false);
  assert.equal(p.update(1500,[],g).countdownMs,500);assert.equal(p.update(2000,[],g).state,'running');
  near(p.update(2250,[],g).phase,.125);p.command('pause',2300,g);f=p.update(2600,[],g);assert.equal(f.state,'paused');near(f.phase,.15);assert.equal(f.meanError,null);
  p.command('resume',2700,g);assert.equal(p.update(3200,[],g).countdownMs,500);near(p.update(3700,[],g).phase,.15);near(p.update(3900,[],g).phase,.25);
  p.command('stop',3900,g);f=p.update(3900,[],g);assert.equal(f.state,'ready');assert.equal(f.phase,0);assert.equal(f.elapsedSeconds,0);
  p.command('restart',4000,g);assert.equal(p.update(4000,[],g).countdownMs,1000);
});
test('repeated timestamps add no time or statistics and a rewind or suspension requires Start',()=>{
  const g=guide(),p=new MovingPacer();p.command('start',0,g);p.update(0,poses(g,0),g);
  const f=p.update(500,[],g);near(f.phase,.25);near(f.measuredPercent,50);
  const repeated=p.update(500,poses(g,.25),g);near(repeated.phase,.25);near(repeated.measuredPercent,50);
  assert.equal(p.update(499,poses(g,.25),g).state,'ready');assert.equal(p.update(600,[],g).meanError,null);
  p.command('start',600,g);assert.equal(p.update(1351,[],g).state,'ready');
  p.command('start',1400,g);assert.equal(p.update(1500,[],g).state,'running');near(p.update(1600,[],g).phase,.1);
});
test('pacing, geometry and source changes reset; cosmetics preserve an active exercise',()=>{
  let g=guide();const p=new MovingPacer();p.command('start',0,g);p.update(100,[],g);
  const cosmetic=guide({...g.config,pacerDotSize:25,trails:false,streakEffects:false,showGuide:false,bpm:140});p.reconfigure(g.config,cosmetic.config);
  near(p.update(200,[],cosmetic).phase,.1);
  for(const patch of [{scale:.3},{pacerRpm:40},{pacerCountdown:2},{pacerDirection:'ccw'},{tolerance:10},{facing:'back'},{threshold:200},{staffCount:2}]){
    g=guide();p.command('start',300,g);const changed=guide(patch);assert.equal(p.update(400,[],changed).state,'ready');
  }
});
test('joint endpoint matching survives reversal and never lets two tips claim one moving dot',()=>{
  for(const mode of ['circles','antispin']){
    const g=guide({mode}),p=new MovingPacer();p.command('start',0,g);
    const perfect=poses(g,.125),s=perfect[0],f=p.update(250,[{...s,a:s.b,b:s.a}],g);
    assert.equal(f.onTarget,true);near(f.meanError,0);
    if(mode==='antispin')assert.deepEqual(f.feedback.map(c=>c.axis),['vertical','horizontal']);
    const sameTip={...s,a:f.targets[0][0],b:f.targets[0][0]};
    const duplicate=p.update(250,[sameTip],g);assert.equal(duplicate.valid,true);assert.equal(duplicate.onTarget,false);
    assert.equal(new Set(duplicate.feedback.map(c=>JSON.stringify(c.target))).size,2);
  }
  const g=guide(),p=new MovingPacer();p.command('start',0,g);const staticGuidePose=poses(g,.25);
  assert.ok(g.cues(staticGuidePose).every(c=>c.onTarget));assert.equal(p.update(0,staticGuidePose,g).onTarget,false);
});
test('missing, uncertain, nonfinite or unrectifiable tips cannot supply feedback or credit',()=>{
  const g=guide({staffCount:2}),s=poses(g,0);
  for(const bad of [null,{...s[0],confidence:.54},{...s[0],confidence:NaN},{...s[0],blurred:true},{...s[0],occluded:true},{...s[0],a:[NaN,0]}]){
    const p=new MovingPacer();p.command('start',0,g);const f=p.update(0,[bad,s[1]],g);
    assert.equal(f.valid,false);assert.equal(f.onTarget,false);assert.deepEqual(f.feedback,[]);assert.equal(f.meanError,null);assert.equal(f.measuredPercent,0);assert.equal(f.targets.length,2);
  }
  const calibrated=guide({planeCorners:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]],calibrationImageAspect:4/3}),p=new MovingPacer();p.command('start',0,calibrated);
  assert.equal(p.update(0,[{a:[0,0],b:[10,10],confidence:1}],calibrated).valid,false);
});
test('five-second rolling statistics count measured frames and expire through ordinary misses',()=>{
  const g=guide(),p=new MovingPacer();p.command('start',0,g);
  p.update(0,poses(g,0),g);p.update(100,poses(g,.05,2*g.radius*.1),g);
  let f=p.update(200,[],g);near(f.meanError,5);near(f.onTargetPercent,50);near(f.measuredPercent,200/3);
  for(let t=300;t<=5300;t+=100)f=p.update(t,[],g);
  assert.equal(f.state,'running');assert.equal(f.meanError,null);assert.equal(f.onTargetPercent,null);assert.equal(f.measuredPercent,0);
  p.command('pause',5400,g);assert.equal(p.update(5400,[],g).measuredPercent,null);
  p.command('resume',5500,g);f=p.update(5500,poses(g,.7),g);assert.equal(f.measuredPercent,100);
});
test('native pacer oracle matches browser targets, controls, matching and rolling statistics',()=>{
  const cases=JSON.parse(readFileSync(new URL('./fixtures/native-pacer.json',import.meta.url)));
  for(const entry of cases){
    let config=entry.config,g=new Guide(config,entry.width,entry.height);const p=new MovingPacer();
    for(const step of entry.steps){
      if(step.patch){const previous=config;config=patchConfig(config,step.patch);p.reconfigure(previous,config);g=new Guide(config,entry.width,entry.height);}
      if(step.operation)p.command(step.operation,step.time,g);
      close(p.update(step.time,step.staffs,g),step.output);
    }
  }
});
