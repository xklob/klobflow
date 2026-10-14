import test from 'node:test';
import assert from 'node:assert/strict';
import {RollingErrors} from '../public/rolling-errors.mjs';
import {defaults,patchConfig} from '../public/core.mjs';
test('five-second errors expire, preserve other metrics and pause on current uncertainty',()=>{
 const avg=new RollingErrors();avg.update(0,{deviation:0,angle:10,symmetry:4},defaults);avg.update(1000,{deviation:10,angle:20},defaults);
 assert.equal(avg.update(4000,{deviation:20,angle:30,symmetry:8},defaults).deviation,10);
 assert.deepEqual(avg.update(5001,{deviation:30,angle:40,symmetry:10,steadiness:7,coverage:80},defaults),{deviation:20,angle:30,symmetry:9,steadiness:7,coverage:80});
 assert.deepEqual(avg.update(5050,{deviation:null,angle:null,symmetry:null},defaults),{deviation:null,angle:null,symmetry:null});
 assert.equal(avg.update(6001,{deviation:40},defaults).deviation,30);
});
test('changed targets and backward replay reset the averaging window',()=>{
 const avg=new RollingErrors();avg.update(100,{deviation:50},defaults);const changed={...defaults,scale:.4};assert.equal(avg.update(200,{deviation:2},changed).deviation,2);assert.equal(avg.update(0,{deviation:1},changed).deviation,1);
});
test('legacy startup fit settings restore framing with automatic startup disabled',()=>{
 const saved={...defaults,autoFit:true,cx:.36,cy:.57,scale:.27,rotation:12,zoom:2};assert.deepEqual(patchConfig(defaults,saved,{restore:true}),{...saved,autoFit:false});
});
