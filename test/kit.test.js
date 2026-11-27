import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolveHouse, roofGeometry, windowSlots, wallHeight, ridgeToHouse, clipPolygon, polygonArea, boardPolygons, MANSARD_UPPER_PITCH, PLATE_LIFT,
} from '../src/village/kit/spec.js';
import { layoutMainStreet, fencePlan, chainage, frameOf, GATE_WIDTH, pillarStations } from '../src/village/kit/layout.js';
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
  for (const pattern of ['vertical', 'horizontal', 'chevron', 'sunburst']) {
    const boards = boardPolygons(tri, { pattern, board: .14 }).filter(b => !b.disc);
    const sum = boards.reduce((s, b) => s + Math.abs(polygonArea(b.poly)), 0);
    assert.ok(Math.abs(sum - area) < 1e-6, `${pattern}: ${sum} vs ${area}`);
  }
  assert.deepEqual(clipPolygon([[0, 0], [2, 0], [2, 2], [0, 2]], 1, 0, 1).length, 4);
});

test('sunburst gable: radial rays from the base centre plus a half-sun disc', () => {
  const tri = [[-3, 0], [3, 0], [0, 2.2]];
  const boards = boardPolygons(tri, { pattern: 'sunburst', rayDeg: 15 });
  const rays = boards.filter(b => !b.disc);
  assert.equal(rays.length, 12);
  // Every ray is a wedge whose vertices include the foot point (0, 0).
  for (const r of rays) assert.ok(r.poly.some(([x, y]) => Math.hypot(x, y) < 1e-9));
  const disc = boards.find(b => b.disc);
  assert.ok(disc && disc.poly.every(([x, y]) => y >= -1e-9 && Math.hypot(x, y) <= .55 + 1e-9));
});

test('brick pillars flank every gate and space the spans', () => {
  const gates = [{ t: 5, width: 3 }];
  const ts = pillarStations([[0, 3.3], [6.7, 13]], gates);
  assert.ok(ts.some(t => Math.abs(t - 3.28) < 1e-9) && ts.some(t => Math.abs(t - 6.72) < 1e-9));
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] > .6);
  assert.ok(ts[0] === 0 && ts[ts.length - 1] === 13);
  assert.ok(!ts.some(t => t > 3.5 && t < 6.5), 'no pillar inside the gate opening');
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

// ---------------------------------------------------------------- round 2 ----
import { yardLayout, rectOverlap, rectInside, SOLID_YARD } from '../src/village/kit/yard.js';
import { groundShapes, maskBounds, rasterizeMask, sampleMask } from '../src/village/kit/groundMask.js';
import { annexFootprint } from '../src/village/kit/spec.js';

test('yard layout: items stay inside the plot, clear of the house and of each other, deterministic', () => {
  const plot = { s0: -12, s1: 14, zBack: -26, zFacade: 4, garden: 2, yardSide: 1, seed: 12345 };
  const house = { kind: 'house', x: 0, z: 0, w: 9, d: 10 };
  const a = yardLayout(plot, [house]), b = yardLayout(plot, [house]);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 3, `only ${a.length} items`);
  const box = { x0: plot.s0, x1: plot.s1, z0: plot.zBack, z1: plot.zFacade };
  for (const it of a) {
    assert.ok(rectInside(it, box), `${it.kind} outside the plot`);
    assert.ok(!rectOverlap(it, house), `${it.kind} overlaps the house`);
  }
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++)
    if (SOLID_YARD.has(a[i].kind) && SOLID_YARD.has(a[j].kind)) assert.ok(!rectOverlap(a[i], a[j]), `${a[i].kind} overlaps ${a[j].kind}`);
  // A passport shed means no generic shed.
  for (let s = 1; s < 40; s++) assert.ok(!yardLayout({ ...plot, seed: s }, [house], { kinds: ['shed'] }).some(i => i.kind === 'shed'));
  // Too small a plot gets nothing.
  assert.deepEqual(yardLayout({ ...plot, s0: -2, s1: 2 }, [house]), []);
});

test('main street yards: every passport house gets lived-in content, solid items collide', () => {
  const houses = main.plots.filter(p => p.house);
  const withBeds = houses.filter(p => p.yard.some(y => y.kind === 'beds')).length;
  assert.ok(withBeds > houses.length * .6, `${withBeds} of ${houses.length} plots have beds`);
  for (const p of houses) for (const y of p.yard) {
    assert.ok(inRect(y.x, y.z, p.rect), `${y.id} outside its plot`);
    assert.ok(!rectsOverlap(y, p.house, .3) || y.kind === 'birch', `${y.id} overlaps its house`);
    if (SOLID_YARD.has(y.kind)) assert.ok(main.rects.includes(y), `${y.id} not collidable`);
  }
  // Side fences reach the back of the plot and every house plot has a back fence.
  for (const p of houses) assert.ok(p.fences.some(f => f.role === 'back'), `${p.id} has no back fence`);
});

test('annex footprint matches the veranda placement', () => {
  const spec = resolveHouse(house({ veranda: true, widthM: 8, depthM: 6, roof: { ...house().house.roof, ridge: 'parallel' } }));
  const a = annexFootprint(spec, -1);
  assert.equal(a.side, -1);
  assert.ok(near(a.x1, -4) && a.w > 2 && a.d > 3);
  assert.equal(annexFootprint(resolveHouse(house()), 1), null);
});

test('ground mask: feathered rectangles rasterise into the right channels', () => {
  const shapes = [{ x: 0, z: 0, w: 10, d: 4, angle: 0, ch: 1, v: 1, f: 1 }, { x: 0, z: 0, w: 2, d: 2, angle: Math.PI / 4, ch: 0, v: .5, f: .2 }];
  const m = rasterizeMask(shapes, maskBounds(shapes, 2), .5);
  assert.ok(m.width > 20 && m.height > 8);
  assert.ok(sampleMask(m, 0, 0)[1] > .95, 'gravel at the centre');
  assert.ok(sampleMask(m, 4.8, 0)[1] < .4, 'feathered edge');
  assert.equal(sampleMask(m, 0, 3)[1], 0);
  assert.ok(Math.abs(sampleMask(m, 0, 0)[0] - .5) < .02, 'dirt channel at half strength');
  assert.deepEqual(sampleMask(m, 100, 100), [0, 0, 0, 0]);
});

test('main street ground shapes: drives at gates, yards beside houses, soil under beds', () => {
  const shapes = groundShapes(main.plots, lines);
  assert.ok(shapes.some(s => s.ch === 1), 'gravel drives');
  assert.ok(shapes.some(s => s.ch === 2), 'tilled soil');
  const m = rasterizeMask(shapes, maskBounds(shapes));
  const bed = main.plots.flatMap(p => p.yard).find(y => y.kind === 'beds');
  assert.ok(sampleMask(m, bed.x, bed.z)[2] > .9, 'soil under a bed');
  assert.ok(m.width <= 4096 && m.height <= 4096);
});
