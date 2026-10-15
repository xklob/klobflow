import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {TempoAnalyzer,TempoHold,AudioEnvelope} from '../public/tempo-core.mjs';
const pulse=(t,bpm)=>.3*Math.exp(-(t%(60/bpm))/.045);
test('PCM envelope and tempo match native oracle',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-tempo.json',import.meta.url))),envelope=new AudioEnvelope(),analyzer=new TempoAnalyzer(),states=[];
 for(let i=0;i<48000*10;i++){const t=i/48000,energy=envelope.sample(.65*Math.sin(2*Math.PI*70*t)*Math.exp(-(t%.5)/.035));if(energy!==null){const state=analyzer.observe(1000+(i+1)*1000/48000,energy);if((i+1)%12000===0)states.push(state);}}
 assert.equal(states.length,fixture.states.length);
 for(let i=0;i<states.length;i++)for(const [key,value]of Object.entries(fixture.states[i])){if(typeof value==='number')assert.ok(Math.abs(value-states[i][key])<1e-7,`${i}.${key}`);else assert.equal(states[i][key],value);}
 const dropoutStates=[];for(let i=0;i<=900;i++){const state=analyzer.observe(11020+i*20,0);if([0,100,350,750,800,900].includes(i))dropoutStates.push(state);}
 assert.equal(dropoutStates.length,fixture.dropoutStates.length);
 for(let i=0;i<dropoutStates.length;i++)for(const [key,value]of Object.entries(fixture.dropoutStates[i])){if(typeof value==='number')assert.ok(Math.abs(value-dropoutStates[i][key])<1e-7,`dropout ${i}.${key}`);else assert.equal(dropoutStates[i][key],value);}
});
test('detects regular beats across the search range, adapts, and loses lock on silence',()=>{
 for(const bpm of [60,90,120,174,200]){const a=new TempoAnalyzer();let s;for(let i=0;i<700;i++)s=a.observe(1000+i*20,pulse(i*.02,bpm));assert.ok(s.bpm&&Math.abs(s.bpm-bpm)<2,`${bpm}: ${JSON.stringify(s)}`);for(let i=0;i<100;i++)s=a.observe(15000+i*20,0);assert.equal(s.holding,true);assert.ok(s.bpm);for(let i=100;i<850;i++)s=a.observe(15000+i*20,0);assert.equal(s.bpm,null);assert.equal(s.holding,false);}
 const a=new TempoAnalyzer();let s;for(let i=0;i<700;i++)a.observe(1000+i*20,pulse(i*.02,90));for(let i=0;i<700;i++)s=a.observe(15000+i*20,pulse(i*.02,150));assert.ok(Math.abs(s.bpm-150)<2);
});
test('input meter preserves short peaks, decays through silence, and resets after capture gaps',()=>{
 const a=new TempoAnalyzer();assert.equal(a.observe(1000,1).level,1);
 let state;for(let i=1;i<=12;i++)state=a.observe(1000+i*20,0);
 assert.ok(Math.abs(state.level-Math.exp(-240/180))<1e-9);
 for(let i=13;i<=80;i++)state=a.observe(1000+i*20,0);
 assert.ok(state.level<.001);assert.equal(state.bpm,null);assert.equal(state.candidateBpm,null);assert.equal(state.confidence,0);assert.equal(state.historySeconds,0);
 a.observe(2620,.8);state=a.observe(4000,0);
 assert.equal(state.level,0);assert.equal(state.historySeconds,0);assert.equal(state.candidateBpm,null);
});
test('beat diagnostics distinguish collecting, uncertain rhythm, steady sound, and a locked beat',()=>{
 const a=new TempoAnalyzer();let state;
 for(let i=0;i<50;i++)state=a.observe(1000+i*20,pulse(i*.02,120));
 assert.equal(state.historySeconds,.98);assert.equal(state.confidence,0);assert.equal(state.candidateBpm,null);assert.equal(state.bpm,null);
 for(let i=50;i<700;i++)state=a.observe(1000+i*20,pulse(i*.02,120));
 assert.equal(state.historySeconds,8);assert.equal(state.candidateBpm,120);assert.equal(state.bpm,120);assert.ok(state.confidence>=.6);
 const uncertain=new TempoAnalyzer();
 for(let i=0;i<700;i++)state=uncertain.observe(1000+i*20,.2*(.6+.3*Math.sin(i*1.314)+.1*Math.cos(i*.137)));
 assert.ok(state.level>.05);assert.ok(state.candidateBpm>=60);assert.ok(state.confidence>0&&state.confidence<.6);assert.equal(state.bpm,null);
 const steady=new TempoAnalyzer();for(let i=0;i<700;i++){state=steady.observe(1000+i*20,.2);assert.equal(state.bpm,null,'A steady tone must not acquire a beat during startup');assert.equal(state.holding,false);}
 assert.equal(state.level,.2);assert.equal(state.historySeconds,8);assert.equal(state.bpm,null);assert.equal(state.candidateBpm,null);assert.equal(state.confidence,0);
});
const estimate=(at,bpm=120)=>({running:true,bpm,origin:1000,confidence:bpm===null?.2:.9,level:.1,at,status:'Listening',historySeconds:5,candidateBpm:bpm,holding:false,holdRemainingMs:0});
const qualify=()=>{const hold=new TempoHold();for(let t=1000;t<=4000;t+=20)hold.update(estimate(t));return hold;};
test('tempo hold requires stable seconds, keeps phase and current level, and expires at 15 seconds',()=>{
 const brief=new TempoHold();for(let t=1000;t<4000;t+=20)brief.update(estimate(t));assert.equal(brief.update(estimate(4000,null)).holding,false);
 const hold=qualify();const low={...estimate(4020,null),level:0,historySeconds:0};const kept=hold.update(low);
 assert.equal(kept.holding,true);assert.equal(kept.bpm,120);assert.equal(kept.origin,1000);assert.equal(kept.confidence,.9);assert.equal(kept.level,0);assert.equal(kept.historySeconds,0);assert.equal(kept.holdRemainingMs,14980);
 assert.equal(hold.update(estimate(18999,null)).holdRemainingMs,1);
 const expired=hold.update(estimate(19000,null));assert.equal(expired.bpm,null);assert.equal(expired.holding,false);
});
test('brief confidence returns cannot extend a hold, while a new stable run can qualify again',()=>{
 const hold=qualify();hold.update(estimate(4020,null));hold.update(estimate(10000));
 assert.equal(hold.update(estimate(10020,null)).holdRemainingMs,8980);
 for(let t=11000;t<=14000;t+=20)hold.update(estimate(t));
 assert.equal(hold.update(estimate(14020,null)).holdRemainingMs,14980);
});
test('stopping, reversing time, or observing a different tempo clears the old hold',()=>{
 const stopped=qualify();stopped.update({...estimate(4020,null),running:false});assert.equal(stopped.update(estimate(4040,null)).holding,false);
 const reversed=qualify();assert.equal(reversed.update(estimate(2000,null)).holding,false);
 const changed=qualify();assert.equal(changed.update(estimate(4020,150)).bpm,150);assert.equal(changed.update(estimate(4040,null)).holding,false);
 const gaps=new TempoHold();for(let t=1000;t<=5000;t+=200)gaps.update(estimate(t));assert.equal(gaps.update(estimate(5020,null)).holding,false);
});
