import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Guide,defaults,Scorer,StaffTracker} from '../public/core.mjs';import {TimingCoach,FitHelper} from '../public/practice.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-practice.json',import.meta.url)));
function close(a,b){if(typeof b==='number')assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>close(a[i],v));}else if(b&&typeof b==='object')for(const k in b)close(a[k],b[k]);else assert.equal(a,b);}
test('beat crossings and fit decisions agree with native oracle',()=>{
 const g=new Guide(fixture.config,640,480),coach=new TimingCoach();coach.reset(0);
 for(const frame of fixture.timing)close(coach.update(frame.time,frame.staffs,g),frame.beat);
 const fit=new FitHelper();fit.begin(true);let result;
 for(let i=0;i<22;i++)result=fit.update(1000+i*100,[fixture.fitStaff,null],g,1,8,1)||result;
 close(result,fixture.fit);
});
test('single staff scores independently, has two cues and no two-prop symmetry',()=>{
 const g=new Guide({...defaults,staffCount:1},640,480),s={a:g.point(-1,-1),b:g.point(-1,1),confidence:1};
 assert.equal(new Scorer().score(1000,[s,null],g).deviation,0);assert.equal(new Scorer().score(1000,[s,null],g).symmetry,null);assert.equal(g.cues([s,null]).length,2);
 const tracker=new StaffTracker();for(let i=0;i<5;i++)assert.equal(tracker.update([s],1000+i*33,1)[1],null);
});
test('size fit waits through uncertainty and can be cancelled before applying',()=>{
 const g=new Guide({...defaults,staffCount:1},640,480),fit=new FitHelper();fit.begin();for(let i=0;i<100;i++)assert.equal(fit.update(1000+i*33,[null,null],g,1,8,1),null);assert.equal(fit.active,true);fit.cancel();assert.equal(fit.active,false);
});
