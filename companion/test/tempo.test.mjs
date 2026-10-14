import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {TempoAnalyzer,AudioEnvelope} from '../public/tempo-core.mjs';
const pulse=(t,bpm)=>.3*Math.exp(-(t%(60/bpm))/.045);
test('PCM envelope and tempo match native oracle',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-tempo.json',import.meta.url))),envelope=new AudioEnvelope(),analyzer=new TempoAnalyzer(),states=[];
 for(let i=0;i<48000*10;i++){const t=i/48000,energy=envelope.sample(.65*Math.sin(2*Math.PI*70*t)*Math.exp(-(t%.5)/.035));if(energy!==null){const state=analyzer.observe(1000+(i+1)*1000/48000,energy);if((i+1)%12000===0)states.push(state);}}
 assert.equal(states.length,fixture.states.length);
 for(let i=0;i<states.length;i++)for(const [key,value]of Object.entries(fixture.states[i])){if(typeof value==='number')assert.ok(Math.abs(value-states[i][key])<1e-7,`${i}.${key}`);else assert.equal(states[i][key],value);}
});
test('detects regular beats across the search range, adapts, and loses lock on silence',()=>{
 for(const bpm of [60,90,120,174,200]){const a=new TempoAnalyzer();let s;for(let i=0;i<700;i++)s=a.observe(1000+i*20,pulse(i*.02,bpm));assert.ok(s.bpm&&Math.abs(s.bpm-bpm)<2,`${bpm}: ${JSON.stringify(s)}`);for(let i=0;i<100;i++)s=a.observe(15000+i*20,0);assert.equal(s.bpm,null);}
 const a=new TempoAnalyzer();let s;for(let i=0;i<700;i++)a.observe(1000+i*20,pulse(i*.02,90));for(let i=0;i<700;i++)s=a.observe(15000+i*20,pulse(i*.02,150));assert.ok(Math.abs(s.bpm-150)<2);
});
