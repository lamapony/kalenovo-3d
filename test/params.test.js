import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParams } from '../src/params.js';

test('defaults: WebGPU preferred, high quality, no debug', () => {
  assert.deepEqual(parseParams(''), { forceWebGL: false, quality: 'high', debug: false, camera: null, tod: 'afternoon', view: null, nohud: false, toneMapping: 'aces', season: 'winter', fov: null });
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

test('time of day, named views, clean screenshots, tone mapping', () => {
  assert.equal(parseParams('?tod=sunset').tod, 'sunset');
  assert.equal(parseParams('?tod=night').tod, 'night');
  assert.equal(parseParams('?tod=noon').tod, 'afternoon');
  assert.equal(parseParams('?view=street').view, 'street');
  assert.equal(parseParams('?view=bird').view, 'bird');
  assert.equal(parseParams('?view=moon').view, null);
  assert.equal(parseParams('?nohud=1').nohud, true);
  assert.equal(parseParams('?nohud').nohud, true);
  assert.equal(parseParams('?tm=agx').toneMapping, 'agx');
});

test('season and field of view', () => {
  assert.equal(parseParams('?season=summer').season, 'summer');
  assert.equal(parseParams('?season=autumn').season, 'winter');
  assert.equal(parseParams('').season, 'winter');
  assert.equal(parseParams('?fov=58.3').fov, 58.3);
  assert.equal(parseParams('?fov=5').fov, null);
  assert.equal(parseParams('?fov=abc').fov, null);
  assert.equal(parseParams('?fov=200').fov, null);
});

test('street imagery camera ?cam=ll:', () => {
  assert.deepEqual(parseParams('?cam=ll:51.7546363,107.1180287,N,0,2.5').camera, { lat: 51.7546363, lon: 107.1180287, side: 'N', yaw: null, pitch: 0, height: 2.5 });
  assert.deepEqual(parseParams('?cam=ll:51.75,107.11,s').camera, { lat: 51.75, lon: 107.11, side: 'S', yaw: null, pitch: 0, height: 1.7 });
  assert.deepEqual(parseParams('?cam=ll:51.75,107.11,45,-3,2').camera, { lat: 51.75, lon: 107.11, side: null, yaw: 45, pitch: -3, height: 2 });
  assert.equal(parseParams('?cam=ll:91,107,N').camera, null);
  assert.equal(parseParams('?cam=ll:51.7,x,N').camera, null);
});
