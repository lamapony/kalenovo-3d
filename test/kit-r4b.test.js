// Round 4b: наличник library, metal gates, facades visible from the street, street windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NALICHNIK_TYPES, NALICHNIK_TYPE_NAMES, nalichnikType, nalichnikParts } from '../src/village/kit/nalichniki.js';
import { resolveHouse } from '../src/village/kit/spec.js';
import { gateOverlay } from '../src/village/kit/fencePatterns.js';
import { layoutMainStreet, facadeBlockers, FACADE_FENCE_LOW } from '../src/village/kit/layout.js';
import { ENUMS, loadPassports, streetLines, validatePassport } from '../src/village/passports.js';

const doc = JSON.parse(fs.readFileSync(new URL('../data/main-street-houses.json', import.meta.url), 'utf8'));
const meta = JSON.parse(fs.readFileSync(new URL('../public/data/meta.json', import.meta.url)));
const osm = JSON.parse(fs.readFileSync(new URL('../public/data/osm.geojson', import.meta.url))).features;
const lines = streetLines(osm, meta, doc.street);
const main = layoutMainStreet(loadPassports(doc), meta, lines);

test('the schema enum lists every library type', () => {
  assert.deepEqual([...ENUMS.nalichnikType].sort(), [...NALICHNIK_TYPE_NAMES].sort());
  assert.ok(NALICHNIK_TYPE_NAMES.length >= 8);
});

test('every type has a crown in the proportions of the ref windows', () => {
  for (const name of NALICHNIK_TYPE_NAMES) {
    const ww = .92, wh = 1.22, { parts, top } = nalichnikParts(name, ww, wh);
    const rise = top - wh;
    assert.ok(rise > .2 * wh && rise < .62 * wh, `${name} crown rise ${rise.toFixed(2)}`);
    const xs = parts.flatMap(p => p.kind === 'poly' ? p.pts.map(q => q[0]) : p.kind === 'box' ? [p.x - p.w / 2, p.x + p.w / 2] : [p.x - p.w / 2, p.x + p.w / 2]);
    assert.ok(Math.max(...xs) - Math.min(...xs) < ww + .62, `${name} not wider than the casing plus a small overhang`);
    assert.ok(parts.some(p => p.role === 'insert'), `${name} carries a contrasting insert`);
    assert.ok(parts.every(p => ['frame', 'crown', 'insert'].includes(p.role)));
  }
  // Crowns differ in silhouette: the arch types are polygons with many points, pediments triangles.
  const tri = n => nalichnikParts(n, .92, 1.22).parts.filter(p => p.kind === 'poly' && p.pts.length === 3 && p.role === 'crown').length;
  assert.ok(tri('east-005') >= 1 && tri('east-016') >= 1 && tri('east-007') === 0 && tri('east-012') === 0);
  assert.ok(nalichnikParts('east-027', .92, 1.22).parts.some(p => p.kind === 'poly' && p.pts.length > 6));
});

test('types resolve from the passport, the crown shape or the id; plain trims stay plain', () => {
  assert.equal(nalichnikType({ style: 'carved-crown', type: 'east-012' }), 'east-012');
  assert.equal(nalichnikType({ style: 'carved-crown', shape: 'kokoshnik' }), 'east-027');
  assert.equal(nalichnikType({ style: 'plain' }), null);
  assert.ok(NALICHNIK_TYPES[nalichnikType({ style: 'carved' }, 'any-id')]);
  for (const p of doc.houses) {
    const n = p.house?.windows?.nalichnik;
    if (n && (n.style === 'carved' || n.style === 'carved-crown') && p.source === 'street') assert.ok(n.type, `${p.id} has a library type`);
  }
});

test('metal gates by default with welded frames; the board patterns only where set', () => {
  const gates = main.plots.flatMap(p => p.fences.flatMap(f => f.gates));
  assert.ok(gates.length > 50 && gates.every(g => g.material === 'metal' || g.material === 'wood'));
  assert.ok(gates.filter(g => g.material === 'metal').length / gates.length > .9);
  for (const pat of ['frame', 'rails']) {
    const o = gateOverlay(pat, 1.5, 1.9);
    assert.ok(o.length >= 3 && o.every(b => Math.abs(b.x) <= .76 && b.y >= 0 && b.y <= 1.9));
  }
});

test('from the street every facade shows over or through its fences', () => {
  assert.deepEqual(facadeBlockers(main, lines), []);
  const lowered = main.plots.flatMap(p => p.fences).filter(f => f.lowSpans?.length);
  assert.ok(lowered.length > 0 && lowered.every(f => f.lowSpans.every(s => s[2] === FACADE_FENCE_LOW)));
});

test('every house has windows to the street', () => {
  for (const p of doc.houses) if (p.house && p.house.widthM >= 4) assert.ok(resolveHouse(p).windows.street >= 2, p.id);
});

test('round 4b fields are validated', () => {
  const p = structuredClone(doc.houses.find(h => h.id === 'tolstikhina-n-2025'));
  assert.deepEqual(validatePassport(p), []);
  p.house.windows.nalichnik.type = 'baroque'; p.house.windows.shutters.panels = 'carved'; p.fence.gate.material = 'glass'; p.fence.hidesFacade = 'yes';
  const e = validatePassport(p).join('\n');
  for (const k of ['nalichnik.type', 'shutters.panels', 'gate.material', 'hidesFacade']) assert.match(e, new RegExp(k.replace('.', '\\.')));
});
