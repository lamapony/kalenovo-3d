import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolveHouse, roofGeometry, windowSlots, wallHeight, ridgeToHouse, clipPolygon, polygonArea, boardPolygons, MANSARD_UPPER_PITCH, PLATE_LIFT,
} from '../src/village/kit/spec.js';
import { layoutMainStreet, fencePlan, chainage, frameOf, GATE_WIDTH } from '../src/village/kit/layout.js';
import { loadPassports, streetLines, passportLocal } from '../src/village/passports.js';
import { collectFootprints, wayLines, planVillage, rectsOverlap, inRect } from '../src/village/plan.js';

const readPublic = f => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const doc = JSON.parse(fs.readFileSync(new URL('../data/main-street-houses.json', import.meta.url), 'utf8'));
const meta = readPublic('meta.json'), osm = readPublic('osm.geojson').features, gba = readPublic('buildings-gba.geojson').features;
const passports = loadPassports(doc);
const lines = streetLines(osm, meta, doc.street);
const main = layoutMainStreet(passports, meta, lines);

const house = (over = {}) => ({
  id: 'test-house', house: {
    widthM: 6, depthM: 8, floors: 1,
    wall: { material: 'log', color: '#443322', logDiameterCm: 24, cornerJoint: 'saddle' },
    roof: { shape: 'gable', ridge: 'perpendicular', pitchDeg: 35, material: 'slate', color: '#bbbbbb', overhangM: .4, gableFinish: 'planks', gableColor: '#443322' },
    windows: { street: 3, side: 2, frameColor: '#ffffff', nalichnik: { style: 'carved-crown', color: '#3355aa' }, shutters: { type: 'wooden', color: '#2255aa' } },
    chimney: true, porch: null, veranda: false, basementM: .3, notes: '', ...over,
  },
});
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('log wall height is a whole number of courses near 2.7 m', () => {
  const w = wallHeight('log', 1, .24);
  assert.ok(Number.isInteger(w.courses) && w.courses >= 12 && w.courses <= 14);
  assert.ok(near(w.height, w.courses * w.pitch));
  assert.equal(wallHeight('siding', 1).height, 2.75);
  assert.equal(wallHeight('planks', 2).height, 5.6);
  assert.ok(near(wallHeight('planks', 1, .24, 3.1).height, 3.1));
});

test('gable roof: ridge height, eave drop and overhang follow the pitch', () => {
  const spec = resolveHouse(house());
  const rg = roofGeometry(spec);
  const t = Math.tan(35 * Math.PI / 180);
  // Perpendicular ridge: span is the width (6 m).
  assert.equal(rg.S, 6); assert.equal(rg.L, 8);
  assert.ok(near(rg.ridgeY, spec.wallH + PLATE_LIFT + 3 * t));
  assert.ok(near(rg.eaveY, spec.wallH + PLATE_LIFT - .4 * t));
  assert.equal(rg.slopes.length, 2);
  assert.equal(rg.gableWalls.length, 2);
  // Gable wall apex sits under the ridge.
  assert.ok(near(Math.max(...rg.gableWalls[0].poly.map(p => p[1])), rg.ridgeY - PLATE_LIFT));
  // Ridge frame -> house: the ridge runs along z (gable to the street).
  const [a, b] = rg.ridges[0].map(p => ridgeToHouse('perpendicular', p));
  assert.ok(near(a[0], 0) && near(b[0], 0) && Math.abs(b[2] - a[2]) > 8);
});

test('hip roof: ridge shortened by the span, four slopes, no gable walls', () => {
  const spec = resolveHouse(house({ widthM: 10, depthM: 6, roof: { ...house().house.roof, shape: 'hip', ridge: 'parallel', pitchDeg: 25 } }));
  const rg = roofGeometry(spec);
  assert.equal(rg.slopes.length, 4);
  assert.equal(rg.gableWalls.length, 0);
  const [a, b] = rg.ridges[0];
  assert.ok(near(Math.abs(b[0] - a[0]), 10 - 6));
  assert.equal(rg.hips.length, 4);
});

test('mansard roof: steep lower slope, shallow upper slope, pentagon gable', () => {
  const spec = resolveHouse(house({ widthM: 8.6, depthM: 11.6, floors: 1.5, wall: { material: 'siding', color: '#a98b62', cornerJoint: null }, roof: { ...house().house.roof, shape: 'mansard', pitchDeg: 72, gableFinish: 'siding' } }));
  const rg = roofGeometry(spec);
  assert.equal(rg.slopes.length, 4);
  assert.equal(rg.gableWalls[0].poly.length, 5);
  const lowerRun = 8.6 * .11;
  assert.ok(near(rg.kneeY - spec.wallH - PLATE_LIFT, lowerRun * Math.tan(72 * Math.PI / 180)));
  const upper = (rg.ridgeY - rg.kneeY) / (4.3 - lowerRun);
  assert.ok(near(upper, Math.tan(MANSARD_UPPER_PITCH * Math.PI / 180)));
  // House 45 in the photo: about 6.5-7 m to the ridge from the plinth.
  assert.ok(rg.ridgeY > 6 && rg.ridgeY < 7.5, `ridge ${rg.ridgeY}`);
});

test('half-hip, shed and cross-gable roofs are well formed', () => {
  for (const shape of ['half-hip', 'shed', 'gable-cross']) {
    const spec = resolveHouse(house({ widthM: 9, depthM: 7, roof: { ...house().house.roof, shape, ridge: 'parallel' } }));
    const rg = roofGeometry(spec);
    assert.ok(rg.slopes.length >= 1, shape);
    for (const s of rg.slopes) {
      assert.ok(s.pts.length >= 3, shape);
      assert.ok(Math.abs(s.eave[0] ** 2 + s.eave[1] ** 2 + s.eave[2] ** 2 - 1) < 1e-6);
      assert.ok(s.down[1] <= 1e-9, `${shape} down-slope must point down`);
    }
    assert.ok(rg.ridgeY > spec.wallH, shape);
  }
});

test('window slots stay inside the wall, apart, and avoid doors', () => {
  const xs = windowSlots(6, 3, .92);
  assert.equal(xs.length, 3);
  for (const x of xs) assert.ok(Math.abs(x) + .46 <= 3 - .5 + 1e-9);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= .92 + .45 - 1e-9);
  assert.equal(windowSlots(2, 3, 1).length, 1);
  assert.equal(windowSlots(1.4, 2, 1).length, 0);
  assert.ok(windowSlots(6, 3, .92, { avoid: [[-.5, .5]] }).every(x => Math.abs(x) > .9));
});

test('board polygons tile the gable without gaps', () => {
  const tri = [[-3, 0], [3, 0], [0, 2.2]];
  const area = Math.abs(polygonArea(tri));
  for (const pattern of ['vertical', 'horizontal', 'sunburst']) {
    const boards = boardPolygons(tri, { pattern, board: .14 });
    const sum = boards.reduce((s, b) => s + Math.abs(polygonArea(b.poly)), 0);
    assert.ok(Math.abs(sum - area) < 1e-6, `${pattern}: ${sum} vs ${area}`);
  }
  assert.deepEqual(clipPolygon([[0, 0], [2, 0], [2, 2], [0, 2]], 1, 0, 1).length, 4);
});

test('fence plan: palisade gardens, flush and front fences', () => {
  const p = (type, setback, extra = {}) => ({ setbackM: setback, fence: { type, color: '#ffffff', heightM: 1.2, lengthM: 6, gate: null, ...extra } });
  assert.equal(fencePlan(p('picket', 12)).kind, 'palisade');
  assert.equal(fencePlan(p('picket', 7)).kind, 'flush');
  assert.equal(fencePlan(p('plank', 12)).kind, 'flush');
  assert.equal(fencePlan(p('plank', 25)).kind, 'front');
  assert.deepEqual(fencePlan(p('lattice', 9, { gardenM: 4.3 })), { kind: 'palisade', garden: 4.3 });
  assert.deepEqual(fencePlan(p('profiled', 16, { gardenM: 0 })), { kind: 'flush', garden: 0 });
  assert.equal(fencePlan({ setbackM: 10, fence: null }), null);
});

test('frame helpers: facade normal and chainage', () => {
  const f = frameOf(0, 0, 90); // facade faces east (+x)
  const [x, z] = f.world(0, 1);
  assert.ok(near(x, 1) && near(z, 0));
  const c = chainage(5, 3, [[[0, 0], [10, 0]]]);
  assert.ok(near(c.s, 5) && near(c.distance, 3));
});

test('main street layout: every passport house placed, none overlapping, all inside their plots', () => {
  const houses = main.plots.filter(p => p.house);
  assert.equal(houses.length, passports.filter(p => p.house).length);
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++)
    assert.ok(!rectsOverlap(houses[i].house, houses[j].house, -.3), `${houses[i].id} overlaps ${houses[j].id}`);
  for (const plot of houses) assert.ok(inRect(plot.house.x, plot.house.z, plot.rect), plot.id);
  // The family house is in the layout with its label passport.
  assert.ok(main.plots.some(p => p.id === 'tolstikhina-45' && p.house));
});

test('main street fences: gates are gaps in the colliders, gates fit their runs', () => {
  let gates = 0;
  for (const plot of main.plots) for (const f of plot.fences) {
    for (const g of f.gates) {
      gates++;
      assert.ok(g.t - g.width / 2 >= 0 && g.t + g.width / 2 <= f.t1 + 1e-6, `${plot.id} gate outside its run`);
      assert.ok(g.width <= (GATE_WIDTH[g.type] ?? 1) + 1e-6);
      const [gx, gz] = [f.a[0] + (f.b[0] - f.a[0]) * g.t / f.t1, f.a[1] + (f.b[1] - f.a[1]) * g.t / f.t1];
      const blocked = main.colliders.some(c => {
        const dx = c.b[0] - c.a[0], dz = c.b[1] - c.a[1], L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((gx - c.a[0]) * dx + (gz - c.a[1]) * dz) / L2));
        return Math.hypot(gx - c.a[0] - t * dx, gz - c.a[1] - t * dz) < .05;
      });
      assert.ok(!blocked, `${plot.id}: a collider crosses the gate centre`);
    }
  }
  assert.ok(gates > 20);
});

test('passport plots replace the generic village: no generic house or fence inside them', () => {
  const plan = planVillage({
    footprints: collectFootprints(osm, gba, meta), lines: wayLines(osm, meta), halfSize: meta.halfSizeM,
    reserved: main.reserved, skipGba: new Set(passports.map(p => p.footprintIndex).filter(i => i !== null)), reservedFences: main.colliders,
  });
  const plots = main.plots.filter(p => p.house);
  for (const r of plan.rects) for (const p of plots) assert.ok(!rectsOverlap(r, p.rect, -.05), `generic ${r.kind} inside ${p.id}`);
  for (const gp of plan.plots) for (const f of gp.fences) {
    const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
    for (let d = f.t0; d <= f.t1; d += .5) {
      const x = f.a[0] + (f.b[0] - f.a[0]) * d / len, z = f.a[1] + (f.b[1] - f.a[1]) * d / len;
      for (const p of plots) assert.ok(!inRect(x, z, p.rect, -.6), `generic fence inside ${p.id}`);
    }
  }
  // Generic houses still exist elsewhere in the village.
  assert.ok(plan.plots.length > 100, `only ${plan.plots.length} generic houses left`);
});

test('passport positions convert to finite local coordinates', () => {
  for (const plot of main.plots.filter(p => p.house)) {
    const [x, z] = passportLocal(plot.passport, meta);
    assert.ok(Number.isFinite(x) && Number.isFinite(z));
  }
});

test('the kit can express the school style: ochre plank siding, turquoise carved frames, tall windows, porch', () => {
  const school = resolveHouse(house({
    widthM: 14, depthM: 9,
    wall: { material: 'planks', color: '#b98a4e', cornerJoint: 'boxed' },
    roof: { ...house().house.roof, ridge: 'parallel', material: 'slate', color: '#9c9e9a' },
    windows: { street: 5, side: 2, frameColor: '#f2f2ee', heightM: 1.8, widthM: 1.1, nalichnik: { style: 'carved', color: '#2fb3a6' }, shutters: null },
    porch: { side: 'front', roofed: true },
  }));
  assert.equal(school.wall.material, 'planks');
  assert.equal(school.windows.height, 1.8);
  assert.equal(school.windows.nalichnik.color, '#2fb3a6');
  assert.equal(windowSlots(14, 5, 1.1).length, 5);
  assert.ok(school.windows.sill + 1.8 < school.wallH);
});
