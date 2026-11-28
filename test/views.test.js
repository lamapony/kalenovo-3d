import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { birdView, streetView, yawTowards } from '../src/views.js';
import { parseHeightmap } from '../src/heightfield.js';

const load = file => readFileSync(new URL(`../public/data/${file}`, import.meta.url));
const meta = JSON.parse(load('meta.json'));
const dem = JSON.parse(load('dem-info.json'));
const osm = JSON.parse(load('osm.geojson'));

test('yaw convention matches controls: forward = (-sin yaw, -cos yaw)', () => {
  assert.ok(Math.abs(yawTowards([0, 0], [0, -10])) < 1e-9); // north
  assert.ok(Math.abs(yawTowards([0, 0], [10, 0]) + 90) < 1e-9); // east
});

test('street view stands on улица Толстихина at x = 0 and looks east along it', () => {
  const v = streetView(osm.features, meta);
  assert.ok(v, 'street found');
  assert.equal(v.x, 0);
  assert.ok(Math.abs(v.z - 172.4) < 1, `z ${v.z}`);
  assert.equal(v.height, 1.7);
  // The first vertex 300 m or more down the road is the bend at about (482, 415).
  assert.ok(Math.abs(v.target[0] - 482) < 1 && Math.abs(v.target[1] - 415.3) < 1, `target ${v.target}`);
  const rad = v.yaw * Math.PI / 180, dir = [-Math.sin(rad), -Math.cos(rad)];
  const len = Math.hypot(482 - v.x, 415.3 - v.z);
  assert.ok(Math.abs(dir[0] - (482 - v.x) / len) < .01 && Math.abs(dir[1] - (415.3 - v.z) / len) < .01);
});

test('bird view is 120-180 m up, looking down towards the highest DEM sample', () => {
  const buffer = load(dem.far.file);
  const far = parseHeightmap(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), dem.far.gridSize);
  const v = birdView(far, dem.far);
  assert.ok(v.height >= 120 && v.height <= 180);
  assert.ok(v.pitch < -15 && v.pitch > -35);
  assert.ok(Math.abs(v.peakElevation - dem.far.max) < 1e-3);
  // The camera sits on the village side, facing the peak.
  const rad = v.yaw * Math.PI / 180, dir = [-Math.sin(rad), -Math.cos(rad)];
  const to = [v.target[0] - v.x, v.target[1] - v.z], len = Math.hypot(...to);
  assert.ok(dir[0] * to[0] / len + dir[1] * to[1] / len > .999);
  assert.ok(Math.hypot(v.x, v.z) < 400);
});
