// House passports for the main street (data/main-street-houses.json): pure helpers, no three.js.
// A passport holds parameters observed in public street imagery (or satellite where there is none).
// Local frame as in geo.toLocal: x east, z south, metres.
//
// facadeYawDeg is the direction the street facade faces, as a rotation about +y applied to a house
// modelled with its facade towards +z (three.js `rotation.y = yaw`): facade normal = (sin yaw, cos yaw).
// 0 = faces south (+z), 90 = east (+x), 180 = north, -90 = west.
import { toLocal } from '../geo.js';
import { rectsOverlap } from './plan.js';

export const PASSPORT_VERSION = 1;

export const ENUMS = {
  source: ['street', 'satellite', 'owner'],
  confidence: ['high', 'medium', 'low'],
  side: ['N', 'S'],
  wallMaterial: ['log', 'siding', 'planks', 'brick', 'plaster'],
  cornerJoint: ['saddle', 'dovetail', 'boxed'],
  roofShape: ['gable', 'hip', 'half-hip', 'mansard', 'shed', 'gable-cross'],
  ridge: ['parallel', 'perpendicular'],
  roofMaterial: ['slate', 'profiled', 'metal-tile', 'seam', 'soft-tile', 'corrugated'],
  gableFinish: ['planks', 'siding', 'log'],
  nalichnik: ['none', 'plain', 'carved', 'carved-crown'],
  shutters: ['none', 'wooden', 'roller'],
  porchSide: ['front', 'left', 'right'],
  fence: ['picket', 'plank', 'profiled', 'stripe', 'lattice', 'mesh', 'metal-rail', 'concrete', 'none'],
  // Optional phase B refinements (kit details checked against the photos).
  gableBoards: ['vertical', 'horizontal', 'sunburst', 'chevron'],
  annexSide: ['left', 'right', 'yard'],
  fencePattern: ['vertical', 'horizontal'],
  gateSide: ['left', 'right'],
  crownShape: ['kokoshnik', 'pediment', 'trapezoid'],
  gate: ['swing', 'double', 'sliding'],
  outbuilding: ['shed', 'garage', 'banya', 'barn', 'greenhouse'],
  floors: [1, 1.5, 2],
};

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = v => typeof v === 'string' && HEX.test(v);

// Validate a whole passports document. Returns a list of error strings (empty = valid).
// Satellite passports may leave attributes that cannot be seen from above as null
// (walls, windows, roof shape/colour when not legible); street/owner passports may not.
export function validatePassports(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['document is not an object'];
  if (doc.version !== PASSPORT_VERSION) errors.push(`version must be ${PASSPORT_VERSION}`);
  if (typeof doc.street !== 'string' || !doc.street) errors.push('street missing');
  if (typeof doc.source !== 'string' || !doc.source) errors.push('source missing');
  if (!Array.isArray(doc.houses) || !doc.houses.length) return [...errors, 'houses must be a non-empty array'];
  const ids = new Set();
  for (const p of doc.houses) {
    const e = validatePassport(p);
    errors.push(...e.map(m => `${p?.id ?? '?'}: ${m}`));
    if (ids.has(p?.id)) errors.push(`duplicate id ${p.id}`);
    ids.add(p?.id);
  }
  return errors;
}

export function validatePassport(p) {
  const errors = [];
  const err = m => errors.push(m);
  const num = (v, name, min, max) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) err(`${name} must be a number in [${min}, ${max}]`);
  };
  const oneOf = (v, list, name) => { if (!list.includes(v)) err(`${name} "${v}" not in ${list.join('|')}`); };
  const hex = (v, name) => { if (!isHex(v)) err(`${name} must be #rrggbb`); };
  const opt = (v, fn) => { if (v !== null && v !== undefined) fn(v); };
  if (!p || typeof p !== 'object') return ['passport is not an object'];

  if (typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) err('id must be kebab-case');
  if (!Array.isArray(p.refs)) err('refs must be an array');
  else for (const r of p.refs) if (typeof r !== 'string' || !/^(east|west|sat)\/\d{3}$/.test(r)) err(`bad ref ${r}`);
  oneOf(p.source, ENUMS.source, 'source');
  oneOf(p.confidence, ENUMS.confidence, 'confidence');
  if (p.source === 'street' && !p.refs?.length) err('street passport needs refs');
  num(p.lat, 'lat', 51.70, 51.80);
  num(p.lon, 'lon', 107.05, 107.15);
  oneOf(p.side, ENUMS.side, 'side');
  num(p.setbackM, 'setbackM', 0, 60);
  num(p.facadeYawDeg, 'facadeYawDeg', -180, 180);
  if (p.footprintIndex !== null && !(Number.isInteger(p.footprintIndex) && p.footprintIndex >= 0)) err('footprintIndex must be an integer or null');
  if (typeof p.mergedFootprint !== 'boolean') err('mergedFootprint must be boolean');
  if (p.footprintIndex === null && p.mergedFootprint) err('mergedFootprint without footprintIndex');
  if (typeof p.notes !== 'string') err('notes must be a string');
  const sat = p.source === 'satellite';

  if (p.house !== null) {
    const h = p.house;
    if (!h || typeof h !== 'object') err('house must be an object or null');
    else {
      num(h.widthM, 'house.widthM', 3, 30);
      num(h.depthM, 'house.depthM', 3, 30);
      if (!(sat && h.floors === null)) oneOf(h.floors, ENUMS.floors, 'house.floors');
      if (h.wall === null) { if (!sat) err('house.wall required'); } else {
        oneOf(h.wall?.material, ENUMS.wallMaterial, 'wall.material');
        hex(h.wall?.color, 'wall.color');
        opt(h.wall?.logDiameterCm, v => num(v, 'wall.logDiameterCm', 10, 45));
        if (h.wall?.cornerJoint !== null) oneOf(h.wall?.cornerJoint, ENUMS.cornerJoint, 'wall.cornerJoint');
      }
      const r = h.roof;
      if (!r || typeof r !== 'object') err('house.roof required');
      else {
        if (!(sat && r.shape === null)) oneOf(r.shape, ENUMS.roofShape, 'roof.shape');
        if (!(sat && r.ridge === null)) oneOf(r.ridge, ENUMS.ridge, 'roof.ridge');
        if (!(sat && r.pitchDeg === null)) num(r.pitchDeg, 'roof.pitchDeg', 5, 80);
        if (!(sat && r.material === null)) oneOf(r.material, ENUMS.roofMaterial, 'roof.material');
        if (!(sat && r.color === null)) hex(r.color, 'roof.color');
        if (!(sat && r.overhangM === null)) num(r.overhangM, 'roof.overhangM', 0, 1.5);
        if (r.gableFinish !== null) oneOf(r.gableFinish, ENUMS.gableFinish, 'roof.gableFinish');
        opt(r.gableColor, v => hex(v, 'roof.gableColor'));
        opt(r.gableBoards, v => oneOf(v, ENUMS.gableBoards, 'roof.gableBoards'));
        opt(r.trimColor, v => hex(v, 'roof.trimColor'));
        opt(r.dormers, v => {
          if (!Array.isArray(v)) return err('roof.dormers must be an array');
          for (const dm of v) { oneOf(dm.side, ['left', 'right'], 'dormer.side'); opt(dm.at, a => num(a, 'dormer.at', 0, 1)); }
        });
        for (const k of ['gableArch', 'frieze', 'hipUpper']) opt(r[k], v => { if (typeof v !== 'boolean') err(`roof.${k} must be boolean`); });
      }
      if (h.windows === null) { if (!sat) err('house.windows required'); } else {
        const w = h.windows;
        num(w?.street, 'windows.street', 0, 12);
        num(w?.side, 'windows.side', 0, 12);
        hex(w?.frameColor, 'windows.frameColor');
        opt(w?.heightM, v => num(v, 'windows.heightM', .5, 2.6));
        opt(w?.widthM, v => num(v, 'windows.widthM', .4, 2));
        opt(w?.nalichnik, n => { oneOf(n.style, ENUMS.nalichnik, 'nalichnik.style'); hex(n.color, 'nalichnik.color'); opt(n.crownColor, v => hex(v, 'nalichnik.crownColor')); opt(n.crownShape, v => oneOf(v, ENUMS.crownShape, 'nalichnik.crownShape')); });
        opt(w?.shutters, s => {
          oneOf(s.type, ENUMS.shutters, 'shutters.type'); hex(s.color, 'shutters.color');
          opt(s.closed, v => { if (typeof v !== 'boolean') err('shutters.closed must be boolean'); });
        });
      }
      for (const k of ['chimney', 'veranda']) if (!(sat && h[k] === null) && typeof h[k] !== 'boolean') err(`house.${k} must be boolean`);
      opt(h.porch, v => { oneOf(v.side, ENUMS.porchSide, 'porch.side'); if (typeof v.roofed !== 'boolean') err('porch.roofed must be boolean'); });
      if (!(sat && h.basementM === null)) num(h.basementM, 'house.basementM', 0, 2);
      opt(h.plinthColor, v => hex(v, 'house.plinthColor'));
      opt(h.wallHeightM, v => num(v, 'house.wallHeightM', 2, 7));
      opt(h.annex, a => {
        oneOf(a.side, ENUMS.annexSide, 'annex.side');
        opt(a.widthM, v => num(v, 'annex.widthM', 1, 12)); opt(a.depthM, v => num(v, 'annex.depthM', 1, 15));
        opt(a.color, v => hex(v, 'annex.color'));
        if (typeof a.glazed !== 'boolean') err('annex.glazed must be boolean');
      });
      if (typeof h.notes !== 'string') err('house.notes must be a string');
    }
  }

  opt(p.fence, f => {
    oneOf(f.type, ENUMS.fence, 'fence.type');
    hex(f.color, 'fence.color');
    if (f.type === 'stripe') hex(f.color2, 'fence.color2'); else opt(f.color2, v => hex(v, 'fence.color2'));
    num(f.heightM, 'fence.heightM', 0, 3.5);
    num(f.lengthM, 'fence.lengthM', 0, 80);
    opt(f.yardType, v => oneOf(v, ENUMS.fence, 'fence.yardType'));
    opt(f.yardColor, v => hex(v, 'fence.yardColor'));
    opt(f.pattern, v => oneOf(v, ENUMS.fencePattern, 'fence.pattern'));
    opt(f.gateSide, v => oneOf(v, ENUMS.gateSide, 'fence.gateSide'));
    opt(f.gardenM, v => num(v, 'fence.gardenM', 0, 12));
    opt(f.yardLengthM, v => num(v, 'fence.yardLengthM', 1, 30));
    opt(f.drive, v => oneOf(v, ['gravel', 'paving'], 'fence.drive'));
    opt(f.pillarColor, v => hex(v, 'fence.pillarColor'));
    opt(f.gate, g => {
      oneOf(g.type, ENUMS.gate, 'gate.type');
      hex(g.color, 'gate.color');
      if (typeof g.roofed !== 'boolean' || typeof g.wicket !== 'boolean') err('gate.roofed/wicket must be boolean');
    });
  });
  if (p.house === null && p.fence === null) err('passport needs a house or a fence');

  if (!Array.isArray(p.outbuildings)) err('outbuildings must be an array');
  else for (const o of p.outbuildings) {
    oneOf(o.kind, ENUMS.outbuilding, 'outbuilding.kind');
    if (typeof o.roof !== 'string') err('outbuilding.roof must be a string');
    hex(o.color, 'outbuilding.color');
    if (!Array.isArray(o.approxOffsetM) || o.approxOffsetM.length !== 2 || !o.approxOffsetM.every(Number.isFinite)) err('outbuilding.approxOffsetM must be [along, back]');
  }
  return errors;
}

// ------------------------------------------------------------------ geometry ----

export function passportLocal(p, meta) {
  return toLocal(p.lon, p.lat, meta);
}

// Facade normal (unit vector in x, z) for a yaw in degrees.
export function facadeDirection(yawDeg) {
  const a = yawDeg * Math.PI / 180;
  return [Math.sin(a), Math.cos(a)];
}

// Yaw (degrees, -180..180) of a facade facing along the vector (dx, dz).
export function yawFromVector(dx, dz) {
  return Math.atan2(dx, dz) * 180 / Math.PI;
}

// Local polylines of a named OSM street (LineString / MultiLineString features).
export function streetLines(features, meta, name) {
  const lines = [];
  for (const f of features) {
    if (f.properties?.name !== name) continue;
    const g = f.geometry;
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const part of parts) lines.push(part.map(([lon, lat]) => toLocal(lon, lat, meta)));
  }
  return lines;
}

// Nearest point on a set of polylines: { distance, point: [x, z], dir: unit segment direction }.
export function nearestOnLines(x, z, lines) {
  let best = { distance: Infinity, point: null, dir: null };
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
    const px = a[0] + t * dx, pz = a[1] + t * dz, d = Math.hypot(x - px, z - pz);
    if (d < best.distance) { const l = Math.sqrt(len2); best = { distance: d, point: [px, pz], dir: [dx / l, dz / l] }; }
  }
  return best;
}

// Yaw of a facade at (x, z) facing perpendicular to the nearest street segment, towards the street.
export function yawTowardStreet(x, z, lines) {
  const { point, dir } = nearestOnLines(x, z, lines);
  if (!point) return 0;
  let nx = -dir[1], nz = dir[0];
  if (nx * (point[0] - x) + nz * (point[1] - z) < 0) { nx = -nx; nz = -nz; }
  return yawFromVector(nx, nz);
}

// Signed smallest difference between two yaws, degrees in (-180, 180].
export function yawDelta(a, b) {
  const d = ((a - b) % 360 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

// Oriented house rectangle in the plan.js convention: w along (cos angle, sin angle), d across.
// w = widthM runs along the street (perpendicular to the facade normal), d = depthM.
export function passportRect(p, meta) {
  if (!p.house) return null;
  const [x, z] = passportLocal(p, meta);
  return { x, z, w: p.house.widthM, d: p.house.depthM, angle: -p.facadeYawDeg * Math.PI / 180 };
}

// Pairs of passport ids whose house rectangles overlap (shrunk by `margin` metres on each side).
export function overlappingHouses(passports, meta, margin = 0) {
  const rects = passports.map(p => [p.id, passportRect(p, meta)]).filter(([, r]) => r);
  const shrunk = rects.map(([id, r]) => [id, { ...r, w: Math.max(.1, r.w - 2 * margin), d: Math.max(.1, r.d - 2 * margin) }]);
  const pairs = [];
  for (let i = 0; i < shrunk.length; i++) for (let j = i + 1; j < shrunk.length; j++)
    if (rectsOverlap(shrunk[i][1], shrunk[j][1])) pairs.push([shrunk[i][0], shrunk[j][0]]);
  return pairs;
}

// Parse + validate; throws with all errors so a bad file fails loudly at load time.
export function loadPassports(doc) {
  const errors = validatePassports(doc);
  if (errors.length) throw new Error(`invalid passports:\n${errors.join('\n')}`);
  return doc.houses;
}
