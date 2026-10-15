import test from 'node:test';
import assert from 'node:assert/strict';
import {Guide,Scorer,defaults} from '../public/core.mjs';

test('coverage and speed history exclude uncertain ends even with a high confidence value',()=>{
 for(const flag of ['blurred','occluded']){
  const g=new Guide({...defaults,staffCount:1,mode:'circles'},640,480),scorer=new Scorer();
  const sample=(time,uncertain)=>{const angle=time/1000;return {a:g.point(Math.cos(angle),Math.sin(angle)),b:g.point(-Math.cos(angle),-Math.sin(angle)),confidence:1,[flag]:uncertain};};
  for(let time=0;time<=1000;time+=20){const score=scorer.score(time,[sample(time,true),null],g);assert.equal(score.coverage,0);assert.equal(score.deviation,null);assert.equal(score.steadiness,null);}
  const recovered=scorer.score(1020,[sample(1020,false),null],g);assert.ok(Math.abs(recovered.coverage-100/52)<1e-9);assert.equal(recovered.steadiness,null);
  let score;for(let time=1040;time<=2300;time+=20)score=scorer.score(time,[sample(time,false),null],g);
  assert.equal(score.coverage,100);assert.notEqual(score.steadiness,null);
 }
});
