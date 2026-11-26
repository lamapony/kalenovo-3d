import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRectangle, splitFootprint, houseSize, planVillage, rectsOverlap, inRect, fencePoint, SegmentGrid, lineSegments } from '../src/village/plan.js';
import { randomGenerator, segmentDistanceSq } from '../src/geo.js';

// Rectangle ring (closed) centred at (cx, cz), w along angle a, d across.
function ring(cx, cz, w, d, a = 0) {
  const c = Math.cos(a), s = Math.sin(a);
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]];
  return pts.map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}
const road = (points, width = 7) => ({ points, width, kind: 'road', highway: 'tertiary', foot: false });

test('fitRectangle recovers a rotated rectangle', () => {
  const r = fitRectangle(ring(10, -4, 20, 8, .6));
  assert.ok(Math.abs(r.w - 20) < 1e-6 && Math.abs(r.d - 8) < 1e-6);
  assert.ok(Math.abs(r.x - 10) < 1e-6 && Math.abs(r.z + 4) < 1e-6);
  assert.ok(Math.abs(Math.sin(r.angle - .6)) < 1e-6);
});

test('a long merged block along a street splits into several plots', () => {
  const rect = fitRectangle(ring(0, 0, 50, 9));
  const street = { dir: [1, 0], point: [0, 14] };
  const split = splitFootprint(rect, street, randomGenerator(1));
  assert.ok(split.n >= 3 && split.n <= 4, `n=${split.n}`);
  assert.ok(Math.abs(split.Ls - 50) < 1e-6 && Math.abs(split.Lf - 9) < 1e-6);
  // Facade (f) points toward the street at +z.
  assert.ok(split.f[1] > .99);
  const widths = split.slots.map(s => s.ws);
  assert.ok(widths.every(w => Math.abs(w - 50 / split.n) < 1e-9));
});

test('a block perpendicular to the street stays one deep homestead', () => {
  const rect = fitRectangle(ring(0, 0, 9, 26)); // long axis along z, street runs along x
  const split = splitFootprint(rect, { dir: [1, 0], point: [0, 30] }, randomGenerator(2));
  assert.equal(split.n, 1);
  assert.ok(split.Lf > 25 && split.f[1] > .99);
});

test('ordinary footprints keep their proportions; split slots get plausible houses', () => {
  const r = randomGenerator(3);
  const one = houseSize(9, 7.5, 1, r);
  assert.ok(Math.abs(one.w - 9) < 1e-9 && Math.abs(one.d - 7.5) < 1e-9);
  for (let i = 0; i < 200; i++) {
    const h = houseSize(12 + r() * 6, 8 + r() * 6, 3, r);
    assert.ok(h.w >= 5.2 && h.w <= 10 && h.d >= 6 && h.d <= 11, JSON.stringify(h));
  }
});

function samplePlan() {
  const footprints = [
    { ring: ring(0, 0, 52, 9), source: 'gba', props: {} },     // merged row of houses along the street
    { ring: ring(-5, 40, 9, 24), source: 'gba', props: {} },    // deep homestead across the street
    { ring: ring(30, 38, 8.5, 7.5), source: 'gba', props: {} }, // single house
    { ring: ring(40, -14, 3.2, 2.6), source: 'gba', props: {} },// shed-size detection
  ];
  const lines = [road([[-120, 20], [120, 20]])];
  return { plan: planVillage({ footprints, lines, halfSize: 1800, seed: 5 }), lines };
}

test('planVillage builds non-overlapping houses facing the street', () => {
  const { plan } = samplePlan();
  assert.ok(plan.plots.length >= 5, `plots=${plan.plots.length}`);
  const houses = plan.plots.map(p => p.house);
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) assert.ok(!rectsOverlap(houses[i], houses[j]), `houses ${i},${j} overlap`);
  for (const h of houses) {
    const front = [-Math.sin(h.angle), Math.cos(h.angle)];
    const toRoad = [0, 20 - h.z];
    assert.ok(front[0] * toRoad[0] + front[1] * toRoad[1] > 0, 'facade turned away from the street');
    assert.ok(h.w >= 4.5 && h.w <= 11 && h.d >= 4.5 && h.d <= 11);
  }
  assert.equal(plan.standalone.length, 1);
});

test('rects contain every house, annex and outbuilding; none overlap', () => {
  const { plan } = samplePlan();
  const kinds = new Set(plan.rects.map(r => r.kind));
  assert.ok(kinds.has('house'));
  for (const p of plan.plots) {
    assert.ok(plan.rects.includes(p.house));
    for (const o of p.outbuildings) assert.ok(plan.rects.includes(o));
  }
  for (let i = 0; i < plan.rects.length; i++) for (let j = i + 1; j < plan.rects.length; j++) {
    assert.ok(!rectsOverlap(plan.rects[i], plan.rects[j]), `${plan.rects[i].kind} overlaps ${plan.rects[j].kind}`);
  }
});

test('fences never cross roads or buildings, and plots get gates', () => {
  const { plan, lines } = samplePlan();
  const segs = lineSegments(lines);
  let gates = 0, fronts = 0;
  for (const p of plan.plots) {
    if (p.fences.some(f => f.side === 'front')) { fronts++; if (p.fences.some(f => f.gates.length)) gates++; }
    for (const f of p.fences) {
      assert.ok(f.t1 > f.t0);
      for (let d = f.t0; d <= f.t1; d += .25) {
        const [x, z] = fencePoint(f, d);
        for (const s of segs) assert.ok(segmentDistanceSq(x, z, s.a, s.b) >= (s.width / 2 + 1) ** 2, 'fence inside road clearance');
        for (const r of plan.rects) assert.ok(!inRect(x, z, r, .3), `fence crosses ${r.kind}`);
      }
      for (const g of f.gates) assert.ok(g.t - g.width / 2 >= f.t0 - 1e-9 && g.t + g.width / 2 <= f.t1 + 1e-9, 'gate outside its fence run');
    }
  }
  assert.ok(fronts > 0);
  assert.equal(gates, fronts, 'every plot with a front fence has a gate');
});

test('front fences sit on the street line when a road is close', () => {
  const { plan } = samplePlan();
  const grid = new SegmentGrid(lineSegments([road([[-120, 20], [120, 20]])]));
  const near = plan.plots.filter(p => Math.abs(p.house.z - 20) < 20);
  assert.ok(near.length);
  for (const p of near) for (const f of p.fences.filter(f => f.side === 'front')) {
    const [x, z] = fencePoint(f, (f.t0 + f.t1) / 2);
    const hit = grid.nearest(x, z, 30);
    assert.ok(hit && hit.dist < 7.5, `front fence ${hit?.dist?.toFixed(2)} m from road centre`);
  }
});

test('planning is deterministic', () => {
  const a = samplePlan().plan, b = samplePlan().plan;
  const strip = p => JSON.stringify(p.plots.map(q => [q.house.x, q.house.z, q.house.w, q.house.d, q.fences.map(f => [f.t0, f.t1, f.gates.length])]));
  assert.equal(strip(a), strip(b));
});
