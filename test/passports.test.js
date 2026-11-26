import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  validatePassports, validatePassport, loadPassports, passportLocal, facadeDirection, yawFromVector,
  streetLines, nearestOnLines, yawTowardStreet, yawDelta, passportRect, overlappingHouses, isHex,
} from '../src/village/passports.js';

const readPublic = f => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const rawDoc = fs.readFileSync(new URL('../data/main-street-houses.json', import.meta.url), 'utf8');
const doc = JSON.parse(rawDoc);
const meta = readPublic('meta.json'), osm = readPublic('osm.geojson').features, gba = readPublic('buildings-gba.geojson').features;
const street = streetLines(osm, meta, doc.street);

test('main-street-houses.json passes the schema', () => {
  assert.deepEqual(validatePassports(doc), []);
  assert.equal(loadPassports(doc).length, doc.houses.length);
});

test('passport ids are unique', () => {
  const ids = doc.houses.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('family house 45 is present as an owner passport', () => {
  const p = doc.houses.find(h => h.id === 'tolstikhina-45');
  assert.ok(p, 'tolstikhina-45 missing');
  assert.equal(p.source, 'owner');
  assert.equal(p.house.roof.shape, 'mansard');
  assert.equal(p.house.widthM, 8.6);
  assert.equal(p.house.depthM, 11.6);
});

test('data holds derived parameters only: no URLs, no image data', () => {
  assert.ok(!/https?:|google|data:image|base64/i.test(rawDoc));
  assert.ok(rawDoc.length < 400_000);
});

test('every passport is within 60 m of the street centreline', () => {
  assert.ok(street.length > 0, 'street centreline not found');
  for (const p of doc.houses) {
    const [x, z] = passportLocal(p, meta);
    const { distance } = nearestOnLines(x, z, street);
    assert.ok(distance <= 60, `${p.id} is ${distance.toFixed(1)} m from the street`);
  }
});

test('passport side matches its position relative to the street', () => {
  for (const p of doc.houses) {
    const [x, z] = passportLocal(p, meta);
    const { point, dir, distance } = nearestOnLines(x, z, street);
    if (distance < 3) continue; // too close to the centreline to tell
    // The street runs roughly WNW-ESE: orient the segment west -> east, then north (-z) is to its left.
    const s = dir[0] >= 0 ? 1 : -1;
    const cross = s * (dir[0] * (z - point[1]) - dir[1] * (x - point[0]));
    assert.equal(cross < 0 ? 'N' : 'S', p.side, `${p.id} lies on the other side of the street`);
  }
});

test('no two houses overlap by footprint', () => {
  assert.deepEqual(overlappingHouses(doc.houses, meta), []);
});

test('facades face the street side, not away from it', () => {
  for (const p of doc.houses) {
    if (!p.house) continue;
    const [x, z] = passportLocal(p, meta);
    const toward = yawTowardStreet(x, z, street);
    assert.ok(Math.abs(yawDelta(p.facadeYawDeg, toward)) <= 90, `${p.id} yaw ${p.facadeYawDeg} vs street ${toward.toFixed(0)}`);
  }
});

test('footprint references point at real GBA footprints', () => {
  for (const p of doc.houses) {
    if (p.footprintIndex === null) continue;
    assert.ok(p.footprintIndex < gba.length, `${p.id} footprintIndex out of range`);
  }
});

// ------------------------------------------------------------------ unit ----

test('facade direction and yaw conventions', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  let [x, z] = facadeDirection(0); close(x, 0); close(z, 1);       // south
  [x, z] = facadeDirection(90); close(x, 1); close(z, 0);           // east
  close(yawFromVector(0, -1), 180);                                 // north
  close(yawFromVector(-1, 0), -90);                                 // west
  close(yawDelta(170, -170), -20);
  close(yawDelta(-170, 170), 20);
});

test('yawTowardStreet faces the nearest segment', () => {
  const line = [[[-50, 0], [50, 0]]];
  assert.ok(Math.abs(yawTowardStreet(0, -10, line) - 0) < 1e-9);          // north of an E-W road: faces south
  assert.ok(Math.abs(Math.abs(yawTowardStreet(0, 10, line)) - 180) < 1e-9); // south of it: faces north
  assert.equal(nearestOnLines(5, -10, line).distance, 10);
});

test('passportRect puts width along the street', () => {
  const p = { lat: meta.centerLat, lon: meta.centerLon, facadeYawDeg: 0, house: { widthM: 10, depthM: 6 } };
  const r = passportRect(p, meta);
  assert.ok(Math.abs(r.x) < 1e-9 && Math.abs(r.z) < 1e-9);
  assert.ok(Math.abs(Math.cos(r.angle) - 1) < 1e-9, 'facade facing +z -> width along x');
  assert.equal(passportRect({ ...p, house: null }, meta), null);
});

test('overlappingHouses finds overlapping rectangles only', () => {
  const base = { facadeYawDeg: 0, house: { widthM: 10, depthM: 8 } };
  const lonPerM = 1 / meta.metersPerDegLon;
  const a = { ...base, id: 'a', lat: meta.centerLat, lon: meta.centerLon };
  const b = { ...base, id: 'b', lat: meta.centerLat, lon: meta.centerLon + 9 * lonPerM };
  const c = { ...base, id: 'c', lat: meta.centerLat, lon: meta.centerLon + 30 * lonPerM };
  assert.deepEqual(overlappingHouses([a, b, c], meta), [['a', 'b']]);
});

test('validator rejects bad enums, colours, duplicates and missing parts', () => {
  const good = structuredClone(doc.houses.find(p => p.source === 'street' && p.house));
  assert.deepEqual(validatePassport(good), []);
  const bad = structuredClone(good);
  bad.house.roof.shape = 'dome';
  bad.house.wall.color = 'beige';
  bad.side = 'E';
  const errs = validatePassport(bad);
  assert.ok(errs.some(e => e.includes('roof.shape')));
  assert.ok(errs.some(e => e.includes('wall.color')));
  assert.ok(errs.some(e => e.includes('side')));
  const noParts = { ...structuredClone(good), house: null, fence: null };
  assert.ok(validatePassport(noParts).some(e => e.includes('house or a fence')));
  const dup = { ...doc, houses: [good, good] };
  assert.ok(validatePassports(dup).some(e => e.includes('duplicate id')));
  assert.ok(validatePassports({ ...doc, version: 2 }).some(e => e.includes('version')));
  const streetUnknownRoof = structuredClone(good);
  streetUnknownRoof.house.roof.color = null;
  assert.ok(validatePassport(streetUnknownRoof).some(e => e.includes('roof.color')), 'only satellite passports may omit roof colour');
  assert.ok(isHex('#a1B2c3') && !isHex('#abc') && !isHex('a1b2c3'));
});
