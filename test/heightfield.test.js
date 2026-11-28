import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGroundSampler, footprintRange, parseHeightmap, VERTICAL_EXAGGERATION } from '../src/heightfield.js';

const toBuffer = values => new Float32Array(values).buffer;
const dataFile = name => { const b = readFileSync(new URL(`../public/data/${name}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const dem = JSON.parse(readFileSync(new URL('../public/data/dem-info.json', import.meta.url)));
const meta = JSON.parse(readFileSync(new URL('../public/data/meta.json', import.meta.url)));

test('parseHeightmap reads little-endian Float32 rows', () => {
  const view = new DataView(new ArrayBuffer(16));
  [1, 2, 3, 4].forEach((v, i) => view.setFloat32(i * 4, v, true));
  assert.deepEqual([...parseHeightmap(view.buffer, 2)], [1, 2, 3, 4]);
});

test('parseHeightmap rejects wrong sizes and non-finite samples', () => {
  assert.throws(() => parseHeightmap(toBuffer([1, 2, 3]), 2), /Invalid heightmap size/);
  assert.throws(() => parseHeightmap(toBuffer([1, 2, 3, NaN]), 2), /Invalid heightmap sample/);
  assert.throws(() => parseHeightmap(toBuffer([1]), 1), /grid size/);
});

test('committed DEM files match the sizes in dem-info.json', () => {
  for (const part of [dem.near, dem.far]) {
    const heights = parseHeightmap(dataFile(part.file), part.gridSize);
    assert.equal(heights.length, part.gridSize ** 2);
    let min = Infinity, max = -Infinity;
    for (const h of heights) { min = Math.min(min, h); max = Math.max(max, h); }
    assert.ok(Math.abs(min - part.min) < 1e-3 && Math.abs(max - part.max) < 1e-3, `${part.file} range`);
  }
  assert.equal(dem.near.halfSizeM, meta.halfSizeM, 'near grid covers the same area as the scene');
});

// 3x3 grid over +-10 m: x = -10, 0, 10 (columns), z = -10, 0, 10 (rows, north first).
const grid = new Float32Array([
  0, 10, 20,
  30, 40, 50,
  60, 70, 80,
]);
const sampler = createGroundSampler({ gridSize: 3, halfSizeM: 10, centerElev: 40, exaggeration: 1 }, grid);

test('sampler hits grid nodes exactly, including corners and edges', () => {
  assert.equal(sampler(-10, -10), 0 - 40);
  assert.equal(sampler(10, -10), 20 - 40);
  assert.equal(sampler(-10, 10), 60 - 40);
  assert.equal(sampler(10, 10), 80 - 40);
  assert.equal(sampler(0, 0), 0);
  assert.equal(sampler(10, 0), 50 - 40);
});

test('sampler interpolates bilinearly between nodes', () => {
  assert.equal(sampler(-5, -10), 5 - 40);
  assert.equal(sampler(-10, -5), 15 - 40);
  assert.equal(sampler(-5, -5), 20 - 40);
  // col 1.25, row 1.75: north 40*.75+50*.25 = 42.5, south 70*.75+80*.25 = 72.5
  assert.ok(Math.abs(sampler(2.5, 7.5) - (42.5 * .25 + 72.5 * .75 - 40)) < 1e-9);
  // A non-planar grid shows the bilinear cross term.
  const saddle = createGroundSampler({ gridSize: 2, halfSizeM: 1, centerElev: 0, exaggeration: 1 }, new Float32Array([0, 1, 1, 0]));
  assert.equal(saddle(0, 0), .5);
  assert.ok(Math.abs(saddle(-.5, -.5) - .375) < 1e-9);
});

test('sampler clamps outside the grid to the edge', () => {
  assert.equal(sampler(-500, -500), sampler(-10, -10));
  assert.equal(sampler(500, 0), sampler(10, 0));
  assert.equal(sampler(0, 1e6), sampler(0, 10));
});

test('vertical exaggeration scales relative to centerElev', () => {
  const scaled = createGroundSampler({ gridSize: 3, halfSizeM: 10, centerElev: 40 }, grid);
  assert.equal(scaled(10, 10), (80 - 40) * VERTICAL_EXAGGERATION);
  assert.equal(scaled(0, 0), 0);
});

test('real near grid: spawn height matches meta.json and samples are continuous', () => {
  const heights = parseHeightmap(dataFile(dem.near.file), dem.near.gridSize);
  const ground = createGroundSampler({ gridSize: dem.near.gridSize, halfSizeM: dem.near.halfSizeM, centerElev: meta.centerElev, exaggeration: 1 }, heights);
  const spawn = meta.defaultSpawn;
  assert.ok(Math.abs(ground(spawn.x, spawn.z) + meta.centerElev - spawn.elev) < 1.5, 'spawn elevation within 1.5 m of meta');
  // Step 1 m across the whole tile: no jump larger than the steepest DEM slope allows.
  let worst = 0;
  for (let x = -1800; x < 1800; x += 1) worst = Math.max(worst, Math.abs(ground(x + 1, 300) - ground(x, 300)));
  assert.ok(worst < 2, `max 1 m step ${worst}`);
});

test('footprintRange finds min and max under a rotated rectangle', () => {
  const plane = (x, z) => x * .1 + z * .05;
  const rect = { x: 0, z: 0, w: 10, d: 4, angle: 0 };
  const { min, max } = footprintRange(plane, rect);
  assert.ok(Math.abs(min - (-.5 - .1)) < 1e-9 && Math.abs(max - (.5 + .1)) < 1e-9);
  const rotated = footprintRange(plane, { ...rect, angle: Math.PI / 2 });
  assert.ok(Math.abs(rotated.max - (.2 + .25)) < 1e-9);
});
