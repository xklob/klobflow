import test from 'node:test';
import assert from 'node:assert/strict';
import {StaffTracker} from '../public/core.mjs';

const a={a:[.18,.25],b:[.53,.76],confidence:.8};
const b={a:[.80,.72],b:[1.15,.20],confidence:.8};
const established=()=>{const t=new StaffTracker();for(let i=0;i<3;i++)t.update([a],1000+i*17,1);return t;};

test('camera gaps require fresh observations without an intervening empty frame',()=>{
 for(const gap of [300,2000,10000]){
  const t=established(),time=1034+gap;
  assert.ok(t.update([a],time,1)[0].confidence<.55);
  assert.ok(t.update([a],time+17,1)[0].confidence<.55);
  assert.ok(t.update([a],time+34,1)[0].confidence>=.55);
 }
});
test('expired identity does not immediately confirm a new object',()=>{
 assert.ok(established().update([b],11000,1)[0].confidence<.55);
});
test('repeated and rewound timestamps cannot reuse a confirmation streak',()=>{
 assert.deepEqual(established().hints(900,1),[]);
 for(const time of [1034,900]){
  const t=established();
  assert.ok(t.update([a],time,1)[0].confidence<.55);
  assert.ok(t.update([a],time+17,1)[0].confidence<.55);
  assert.ok(t.update([a],time+34,1)[0].confidence>=.55);
 }
 const t=new StaffTracker();for(let i=0;i<10;i++)assert.ok(t.update([a],1000,1)[0].confidence<.55);
});
