import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParams } from '../src/params.js';

test('defaults: WebGPU preferred, high quality, no debug', () => {
  assert.deepEqual(parseParams(''), { forceWebGL: false, quality: 'high', debug: false, camera: null });
});

test('switches', () => {
  const p = parseParams('?webgl=1&quality=low&debug=1');
  assert.equal(p.forceWebGL, true);
  assert.equal(p.quality, 'low');
  assert.equal(p.debug, true);
  assert.equal(parseParams('?webgl=0').forceWebGL, false);
  assert.equal(parseParams('?quality=ultra').quality, 'high');
});

test('inspection camera', () => {
  assert.deepEqual(parseParams('?cam=1,2,90,-10,50').camera, { x: 1, z: 2, yaw: 90, pitch: -10, height: 50 });
  assert.deepEqual(parseParams('?cam=1,2').camera, { x: 1, z: 2, yaw: 0, pitch: 0, height: 1.7 });
  assert.equal(parseParams('?cam=a,b').camera, null);
});
