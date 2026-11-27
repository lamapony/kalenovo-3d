// Round 4 kit logic: metal flues, veranda ends, picket tops, diamonds, gate patterns,
// second fence runs and the new passport fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveHouse, chimneyPositions, annexFootprint } from '../src/village/kit/spec.js';
import { picketHeightFactor, picketLean, diamondStations, gateOverlay, clipSegment } from '../src/village/kit/fencePatterns.js';
import { applyExtraRuns, layoutMainStreet } from '../src/village/kit/layout.js';
import { validatePassport, loadPassports, streetLines } from '../src/village/passports.js';

const doc = JSON.parse(fs.readFileSync(new URL('../data/main-street-houses.json', import.meta.url), 'utf8'));
const byId = id => structuredClone(doc.houses.find(p => p.id === `tolstikhina-${id}`));

test('metal flues: type and count resolve, positions spread along the ridge on the roof', () => {
  const spec = resolveHouse(byId('n-2267'));
  assert.equal(spec.chimneyType, 'metal-pipe');
  assert.equal(spec.chimneyCount, 2);
  const pos = chimneyPositions(spec, spec.w, () => .5);
  assert.equal(pos.length, 2);
  assert.ok(Math.abs(pos[0].x - pos[1].x) > spec.w * .4, 'two pipes apart along the ridge');
  for (const p of pos) { assert.ok(Math.abs(p.x) < spec.w / 2); assert.ok(p.z > 0 && p.z < spec.d / 2, 'street-side slope'); }
  // Default stays one brick stack.
  const plain = resolveHouse({ ...byId('n-2267'), house: { ...byId('n-2267').house, chimneyType: undefined, chimneyCount: undefined } });
  assert.equal(plain.chimneyType, 'brick'); assert.equal(plain.chimneyCount, 1);
});

test('verandaSide puts the glazed veranda on the observed end', () => {
  const p = byId('s-1220');
  assert.equal(p.house.verandaSide, 'left');
  const left = annexFootprint(resolveHouse(p), 1);
  assert.equal(left.side, -1); assert.ok(left.x1 <= -p.house.widthM / 2 + 1e-9);
  p.house.verandaSide = 'right';
  assert.equal(annexFootprint(resolveHouse(p), -1).side, 1);
});

test('fan pickets dip to the middle of a section and splay symmetrically', () => {
  const n = 9, hs = [...Array(n).keys()].map(k => picketHeightFactor('fan', k, n));
  assert.ok(hs[4] < hs[0] && hs[4] < hs[8]);
  assert.ok(Math.abs(hs[0] - hs[8]) < 1e-9);
  assert.ok(hs.every(h => h >= .7 && h <= 1));
  assert.ok(Math.abs(picketLean('fan', 0, n) + picketLean('fan', 8, n)) < 1e-9);
  assert.equal(picketHeightFactor('pointed', 3, n), 1);
  assert.equal(picketLean('rounded', 3, n), 0);
});

test('diamond inserts: one per long enough section, centred, narrower than the section', () => {
  const st = diamondStations(0, 7.2);
  assert.equal(st.length, 3);
  st.forEach((d, i) => { assert.ok(Math.abs(d.t - (1.2 + 2.4 * i)) < 1e-9); assert.ok(d.w < 2.4); });
  assert.deepEqual(diamondStations(0, 1.2), []);
});

test('gate overlays stay inside the leaf and match the pattern', () => {
  const lw = 1.5, h = 1.9;
  const inside = list => list.every(o => {
    const dx = Math.cos(o.angle) * o.len / 2, dy = Math.sin(o.angle) * o.len / 2;
    return [[o.x - dx, o.y - dy], [o.x + dx, o.y + dy]].every(([x, y]) => x >= -lw / 2 - .1 && x <= lw / 2 + .1 && y >= 0 && y <= h);
  });
  const ch = gateOverlay('chevron', lw, h);
  assert.ok(ch.filter(o => !o.frame).length >= 6);
  assert.ok(ch.some(o => o.angle > 0 && o.angle < Math.PI / 2) && ch.some(o => o.angle > Math.PI / 2 || o.angle < 0), 'both diagonals');
  assert.ok(inside(ch));
  const x = gateOverlay('x', lw, h);
  assert.equal(x.filter(o => !o.frame).length, 2); assert.ok(inside(x));
  assert.equal(gateOverlay('diamond', lw, h).length, 4);
  assert.deepEqual(gateOverlay('vertical', lw, h), []);
});

test('clipSegment clips to the box and rejects outside segments', () => {
  assert.deepEqual(clipSegment([-1, .5], [2, .5], 0, 1, 0, 1), [[0, .5], [1, .5]]);
  assert.equal(clipSegment([2, 2], [3, 3], 0, 1, 0, 1), null);
});

test('extra fence runs replace the end of the street line, never cutting a gate', () => {
  const runs = [
    { x0: -4, z0: 3, x1: -10, z1: 3, role: 'front', type: 'plank', gates: [] },
    { x0: 4, z0: 3, x1: 12, z1: 3, role: 'yard', type: 'plank', gates: [{ t: 2, width: 3.2 }] },
    { x0: 12, z0: 3, x1: 12, z1: -20, role: 'side', type: 'plank', gates: [] },
  ];
  applyExtraRuns(runs, [{ type: 'picket', color: '#ffffff', side: 'right', lengthM: 5 }, { type: 'mesh', color: '#888888', side: 'left', lengthM: 2 }], { s0: -10, s1: 12, zLine: 3 });
  const yard = runs.find(r => r.role === 'yard'), front = runs.find(r => r.role === 'front');
  assert.ok(Math.abs(yard.x1 - 7.8) < 1e-9 && yard.x0 === 4, 'yard run cut back to the extra');
  const extras = runs.filter(r => r.role === 'extra');
  assert.equal(extras.length, 2);
  const pk = extras.find(r => r.type === 'picket');
  assert.ok(Math.abs(pk.x0 - 7.8) < 1e-9 && pk.x1 === 12, 'stops short of the gate (edge + 0.2 m)');
  assert.equal(front.x1, -8); assert.equal(front.x0, -4);
  assert.equal(runs.find(r => r.role === 'side').z1, -20, 'side runs untouched');
});

test('the street layout builds the passport extras and gate patterns', () => {
  const meta = JSON.parse(fs.readFileSync(new URL('../public/data/meta.json', import.meta.url)));
  const osm = JSON.parse(fs.readFileSync(new URL('../public/data/osm.geojson', import.meta.url))).features;
  const main = layoutMainStreet(loadPassports(doc), meta, streetLines(osm, meta, doc.street));
  const plot = main.plots.find(p => p.id === 'tolstikhina-s-2266');
  assert.ok(plot.fences.some(f => f.role === 'extra' && f.type === 'picket'));
  assert.ok(plot.fences.flatMap(f => f.gates).some(g => g.pattern === 'chevron'));
  const pk = main.plots.find(p => p.id === 'tolstikhina-s-1979').fences.find(f => f.type === 'picket');
  assert.equal(pk.picketTop, 'fan'); assert.equal(pk.postColor, '#3f6fa6');
  const garage = main.outbuildings.find(o => o.id === 'tolstikhina-s-2274-ob0');
  assert.equal(garage.material, 'metal'); assert.equal(garage.doorColor, '#c4952e');
});

test('round 4 passport fields are validated', () => {
  const base = byId('s-2274');
  assert.deepEqual(validatePassport(base), []);
  const bad = structuredClone(base);
  bad.house.chimneyType = 'clay'; bad.house.chimneyCount = 5; bad.house.verandaSide = 'east';
  bad.fence.picketTop = 'star'; bad.fence.diamonds = 'white'; bad.fence.gate.pattern = 'zigzag';
  bad.fence.extra = [{ type: 'none', color: '#fff', side: 'up', lengthM: 99 }];
  bad.outbuildings[0].material = 'glass';
  const errors = validatePassport(bad).join('\n');
  for (const k of ['chimneyType', 'chimneyCount', 'verandaSide', 'picketTop', 'fence.diamonds', 'gate.pattern', 'extra.type', 'extra.color', 'extra.side', 'extra.lengthM', 'outbuilding.material']) assert.match(errors, new RegExp(k.replace('.', '\\.')));
});

test('land cover: a strip behind every passport house, smooth lane, fences cleared of buildings', async () => {
  const { landCover, stripLength, stripUse, clearFences } = await import('../src/village/kit/landCover.js');
  const meta = JSON.parse(fs.readFileSync(new URL('../public/data/meta.json', import.meta.url)));
  const osm = JSON.parse(fs.readFileSync(new URL('../public/data/osm.geojson', import.meta.url))).features;
  const lines = streetLines(osm, meta, doc.street);
  const main = layoutMainStreet(loadPassports(doc), meta, lines);
  const a = landCover(main.plots, lines), b = landCover(main.plots, lines);
  assert.deepEqual(a.shapes, b.shapes, 'deterministic');
  const houses = main.plots.filter(p => p.passport?.house && !p.filler).length;
  assert.equal(a.rows.N.length + a.rows.S.length, houses);
  for (const row of Object.values(a.rows)) for (const it of row) assert.ok(it.L >= 35 && it.L <= 80);
  const uses = Object.values(a.rows).flat().map(i => i.use);
  for (const u of ['hay', 'potato', 'rough']) assert.ok(uses.includes(u));
  assert.ok(a.stacks.length > 5 && a.lanes.length > 20 && a.fences.length > houses);
  // Neighbouring strips differ by a few metres only (gentle back lane).
  for (let s = 0; s < 1500; s += 10) assert.ok(Math.abs(stripLength(s + 10, 7) - stripLength(s, 7)) < 6);
  assert.equal(stripUse(.1), 'hay'); assert.equal(stripUse(.6), 'potato'); assert.equal(stripUse(.9), 'rough');
  // Fence pieces avoid a blocked square in the middle of a segment.
  const cut = clearFences([{ a: [0, 0], b: [30, 0] }], (x) => x > 12 && x < 18);
  assert.equal(cut.length, 2);
  assert.ok(cut[0].b[0] <= 12 && cut[1].a[0] >= 18);
  // No strip mask over the street itself.
  for (const sh of a.shapes) if (sh.ch !== 2) assert.ok(Math.min(...lines.map(l => l.reduce((m, p) => Math.min(m, Math.hypot(p[0] - sh.x, p[1] - sh.z)), Infinity))) > 8);
});
