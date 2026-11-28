import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectFootprints, wayLines, planVillage, lineSegments, SegmentGrid, fencePoint, rectsOverlap } from '../src/village/plan.js';

const read = f => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const meta = read('meta.json'), osm = read('osm.geojson').features, gba = read('buildings-gba.geojson').features;
const lines = wayLines(osm, meta);
const plan = planVillage({ footprints: collectFootprints(osm, gba, meta), lines, halfSize: meta.halfSizeM });

test('real data: 450+ houses from split GBA/OSM footprints, all plausible sizes', () => {
  assert.ok(plan.plots.length >= 450, `houses=${plan.plots.length}`);
  for (const p of plan.plots) assert.ok(p.house.w <= 11.01 && p.house.d <= 11.01 && p.house.w >= 4.5 && p.house.d >= 4.5);
  assert.ok(Math.max(...plan.plots.map(p => p.frame.n)) > 1, 'some footprints were split');
});

test('real data: no fence sample inside a road or river clearance', () => {
  const grid = new SegmentGrid(lineSegments(lines));
  let samples = 0;
  for (const p of plan.plots) for (const f of p.fences) for (let d = f.t0; d <= f.t1; d += .5) {
    const [x, z] = fencePoint(f, d);
    assert.ok(!grid.blocked(x, z, 1.0, 2.0), `fence at ${x.toFixed(1)},${z.toFixed(1)} is on a way`);
    samples++;
  }
  assert.ok(samples > 10000);
});

test('real data: houses do not overlap each other', () => {
  const houses = plan.plots.map(p => p.house);
  const cell = new Map();
  for (const h of houses) { const k = `${Math.floor(h.x / 30)},${Math.floor(h.z / 30)}`; (cell.get(k) || cell.set(k, []).get(k)).push(h); }
  for (const h of houses) {
    const gx = Math.floor(h.x / 30), gz = Math.floor(h.z / 30);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of cell.get(`${gx + i},${gz + j}`) || []) {
      if (o !== h) assert.ok(!rectsOverlap(h, o), 'two houses overlap');
    }
  }
});
