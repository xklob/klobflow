import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaults,Guide,patchConfig,distance,center,length,distanceToSegment} from '../public/core.mjs';
import {GestureAlignment,CrossScanner,findCross} from '../public/gesture.mjs';
const X=[{a:[.48,.25],b:[.86,.75],confidence:1},{a:[.48,.75],b:[.86,.25],confidence:1}];
const pose=(cx=.7,cy=.7,len=.4)=>({a:[cx-len/2,cy],b:[cx+len/2,cy],confidence:1});
const guide=(patch={})=>new Guide({...defaults,staffCount:1,...patch},640,480);
function hold(a,g){for(let t=0;t<=5000;t+=125)assert.equal(a.update(t,X,[],g),null);assert.equal(a.state,'countdown');assert.equal(a.frame.remainingMs,5000);}
function countdown(a,g,staffs){for(let t=5125;t<=10000;t+=125)assert.equal(a.update(t,null,staffs,g),null);assert.equal(a.state,'settling');}
function settle(a,g,staffs,zoom={min:1,max:1,ratio:1},start=10125,end=12000){let action;for(let t=start;t<=end;t+=125)action=a.update(t,null,staffs,g,zoom)||action;return action;}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('X recognition requires two diagonals, a central crossing and five steady observed seconds',()=>{
 assert.equal(findCross([X[0]],640,480),null);
 assert.equal(findCross([pose(),pose(.7,.4)],640,480),null);
 assert.equal(findCross([pose(.7,.5),{a:[.7,.2],b:[.7,.8],confidence:1}],640,480),null);
 assert.equal(findCross(X.map(s=>({...s,blurred:true})),640,480),null);
 assert.equal(findCross(X.map(s=>({...s,confidence:.69})),640,480),null);
 assert.equal(findCross(X,640,480).length,2);
 const g=guide(),a=new GestureAlignment();
 for(let t=0;t<5000;t+=125)a.update(t,X,[],g);
 assert.equal(a.state,'holding');a.update(5000,[],[],g);assert.equal(a.state,'idle');
 for(let t=5125;t<10125;t+=125)a.update(t,X,[],g);
 assert.equal(a.state,'holding');a.update(10125,X,[],g);assert.equal(a.state,'countdown');
 const moving=new GestureAlignment();
 for(let t=0;t<=10000;t+=125)moving.update(t,X.map(s=>({...s,a:[s.a[0]+.06*Math.sin(t/400),s.a[1]],b:[s.b[0]+.06*Math.sin(t/400),s.b[1]]})),[],g);
 assert.notEqual(moving.state,'countdown');
});

test('every mode fits midpoint center and mode-specific size after separate countdown and still interval',()=>{
 for(const mode of ['grid','circles','cube','free','antispin'])for(const staffCount of [1,2]){
  const g=guide({mode,staffCount}),a=new GestureAlignment();hold(a,g);
  const staffs=staffCount===1?[pose()]:[pose(.55),pose(.8)];countdown(a,g,staffs);
  assert.equal(a.update(10125,null,staffs,g),null);
  const action=settle(a,g,staffs,undefined,10250);
  assert.ok(action);assert.equal(a.state,'applying');assert.equal(a.frame.active,true);
  near(action.config.cx,(staffCount===1?.7:.675)/(4/3));near(action.config.cy,.7);
  near(action.config.scale,mode==='antispin'?.4:mode==='cube'?1/6:.2);
  if(staffCount===2&&['circles','antispin'].includes(mode))near(action.config.circleSeparation,.25/action.config.scale);
  assert.equal(action.seeds.length,staffCount);a.accept(12000);assert.equal(a.state,'success');assert.equal(a.frame.active,false);
 }
});

test('moving, missing, blurred and clipped poses cannot finish calibration; endpoint reversal is harmless',()=>{
 const g=guide(),a=new GestureAlignment();hold(a,g);countdown(a,g,[]);
 for(let t=10125;t<=14000;t+=125)assert.equal(a.update(t,null,[pose(.7+.08*Math.sin(t/500))],g),null);
 for(let t=14125;t<=17000;t+=125)assert.equal(a.update(t,null,[{...pose(),occluded:true}],g),null);
 let action;
 for(let t=17125;t<=19125;t+=125){const s=pose();action=a.update(t,null,[t%250?{...s,a:s.b,b:s.a}:s],g)||action;}
 assert.ok(action);near(action.config.cy,.7);
});

test('cancel, suspend, source gaps and release gating prevent queued or repeated alignment',()=>{
 const g=guide(),a=new GestureAlignment();hold(a,g);a.cancel(5000);
 for(let t=5125;t<=13000;t+=125)assert.equal(a.update(t,X,[pose()],g),null);
 assert.equal(a.state,'idle');
 for(let t=13125;t<=14250;t+=125)a.update(t,[],[pose()],g);
 for(let t=14375;t<=19375;t+=125)a.update(t,X,[pose()],g);
 assert.equal(a.state,'countdown');a.update(21000,null,[pose()],g);assert.equal(a.state,'cancelled');
 a.accept(21100);assert.equal(a.state,'cancelled');
 a.suspend(true,21200);for(let t=21200;t<=28000;t+=125)a.update(t,X,[pose()],g);assert.equal(a.state,'idle');
 const off=new GestureAlignment();hold(off,g);off.update(5125,null,[pose()],guide({gestureEnabled:false}));assert.equal(off.state,'idle');
 const gap=new GestureAlignment();for(let t=0;t<=4875;t+=125)gap.update(t,X,[],g);gap.update(5200,X,[],g);assert.equal(gap.state,'holding');assert.equal(gap.frame.remainingMs,5000);
 const backwards=new GestureAlignment();hold(backwards,g);backwards.update(1000,X,[],g);assert.equal(backwards.state,'cancelled');
});

test('zoom waits for application and fresh measurements; perspective calibration retains its crop',()=>{
 let g=guide({mode:'circles'});const a=new GestureAlignment();hold(a,g);countdown(a,g,[pose(2/3,.5,.3)]);
 const zoom={min:.5,max:4,ratio:1},action=settle(a,g,[pose(2/3,.5,.3)],zoom);near(action.config.zoom,1.5);assert.equal(a.state,'zooming');
 for(let t=12125;t<=12500;t+=125)assert.equal(a.update(t,null,[pose(2/3,.5,.3)],g,zoom),null);
 a.accept(12500);g=new Guide(patchConfig(g.config,action.config),640,480);
 for(let t=12625;t<13100;t+=125)assert.equal(a.update(t,null,[pose(2/3,.5,.45)],g,{...zoom,ratio:1.5}),null);
 let final;for(let t=13125;t<=15125;t+=125)final=a.update(t,null,[pose(2/3,.5,.45)],g,{...zoom,ratio:1.5})||final;
 assert.ok(final);near(final.config.scale,.225);assert.equal(final.config.zoom,undefined);
 const p=guide({mode:'circles',planeCorners:[[.05,.05],[.95,.1],[.93,.95],[.03,.9]],calibrationImageAspect:4/3}),b=new GestureAlignment();hold(b,p);
 const s=pose(.5,.6,.3),image={...s,a:p.project(s.a),b:p.project(s.b)};countdown(b,p,[image]);
 const adjusted=settle(b,p,[image],zoom);near(adjusted.config.cx,.5);near(adjusted.config.cy,.6);near(adjusted.config.scale,.15);assert.equal(adjusted.config.zoom,undefined);
});

test('two rotated crosses fit both hand centers and reseed A before B without changing rotation',()=>{
 const g=guide({mode:'antispin',staffCount:2,rotation:30}),a=new GestureAlignment();hold(a,g);
 const origin=[.7,.6],dx=[Math.cos(Math.PI/6)*.1,Math.sin(Math.PI/6)*.1];
 const grips=[origin.map((v,k)=>v+dx[k]),origin.map((v,k)=>v-dx[k])],staffs=grips.map(p=>pose(...p));
 countdown(a,g,staffs);const action=settle(a,g,staffs);assert.ok(action);assert.equal(action.config.rotation,undefined);
 const fitted=new Guide(patchConfig(g.config,action.config),640,480);
 fitted.circles.forEach((p,i)=>assert.ok(distance(p,center(action.seeds[i]))<1e-8));
});

test('raw-image X scanning recognizes white and rainbow crosses and is rate limited independently of tracking',()=>{
 const w=192,h=144;
 for(const colors of [[0xffffffff,0xffffffff],[0xffff0033,0xff00ccff]]){
  const scanner=new CrossScanner(),pixels=new Int32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=X.findIndex(s=>distanceToSegment([x/h,y/h],s)<.012);pixels[y*w+x]=i>=0?colors[i]:0xff080808;}
  const lines=scanner.scan(pixels,w,h,0,defaults);assert.equal(findCross(lines,w,h).length,2);assert.equal(scanner.scan(pixels,w,h,124,defaults),null);assert.ok(scanner.scan(pixels,w,h,125,defaults));
  const a=new GestureAlignment(),g=guide();for(let t=0;t<=5000;t+=125)a.update(t,scanner.scan(pixels,w,h,t+250,defaults),[],g);assert.equal(a.state,'countdown');
 }
 const scanner=new CrossScanner();assert.equal(findCross(scanner.scan(new Int32Array(w*h),w,h,0,defaults),w,h),null);
});

test('gesture setting validates and persists independently of legacy automatic startup fitting',()=>{
 assert.equal(patchConfig(defaults,{gestureEnabled:false}).gestureEnabled,false);
 assert.equal(patchConfig(defaults,{autoFit:true}).autoFit,false);
 assert.throws(()=>patchConfig(defaults,{gestureEnabled:'true'}));
});

test('native and browser gesture timing, instructions and fitted settings agree in every mode',()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/native-gesture.json',import.meta.url),'utf8'));
 for(const fixture of cases){
  const g=new Guide(fixture.config,640,480),a=new GestureAlignment(),staffs=g.config.staffCount===1?[pose()]:[pose(.55),pose(.8)],expected=new Map(fixture.frames.map(f=>[f.time,f]));
  for(let t=0;t<=12000;t+=125){const action=a.update(t,t<=5000?X:null,staffs,g),row=expected.get(t);if(!row)continue;assert.equal(a.frame.state,row.status.state);assert.equal(a.frame.active,row.status.active);assert.equal(a.frame.title,row.status.title);assert.equal(a.frame.detail,row.status.detail);assert.equal(a.frame.remainingMs,row.status.remainingMs);near(a.frame.progress,row.status.progress);assert.equal(!!action,!!row.patch);if(action)for(const [key,value]of Object.entries(row.patch))near(action.config[key],value);}
 }
});
