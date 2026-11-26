// Pure passport -> build spec for the main-street house kit (no three.js), so dimensions,
// roof shapes and window layouts are unit tested. House-local frame: x along the street
// facade, +z toward the street, y up from the floor (top of the plinth).
// Roofs are first described in a "ridge frame": X' along the ridge (body length L),
// Z' across it (span S); ridgeToHouse() maps that frame into the house frame.
import { randomGenerator } from '../../geo.js';

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}

const pick = (random, list) => list[Math.floor(random() * list.length) % list.length];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const MANSARD_UPPER_PITCH = 22;
export const PLATE_LIFT = .08; // roof structure sits a little above the wall top

// Wall height from the material: log walls are a whole number of courses.
export function wallHeight(material, floors, logD = .24, target = null) {
  if (material === 'log') {
    const pitch = logD * .86;
    const courses = Math.round((target ?? (floors >= 2 ? 5.4 : 2.72)) / pitch);
    return { height: courses * pitch, courses, pitch };
  }
  return { height: target ?? (floors >= 2 ? 5.6 : 2.75), courses: 0, pitch: 0 };
}

// Passport -> resolved house spec. Satellite passports may leave walls, windows and roof
// details null; those get plausible village defaults chosen deterministically from the id.
export function resolveHouse(p) {
  const h = p.house;
  if (!h) return null;
  const random = randomGenerator(hashString(p.id));
  const w = h.widthM, d = h.depthM;
  const floors = h.floors ?? 1;
  const wallIn = h.wall ?? {
    material: random() < .7 ? 'log' : 'planks',
    color: pick(random, ['#4b3a2b', '#5a4733', '#3e3226', '#6b5a48']),
    cornerJoint: null,
  };
  const material = wallIn.material;
  const logD = (wallIn.logDiameterCm ?? 24) / 100;
  const wall = {
    material, color: wallIn.color, logD,
    corner: wallIn.cornerJoint ?? (material === 'log' ? 'saddle' : material === 'planks' ? 'boxed' : null),
  };
  const wh = wallHeight(material, floors, logD, h.wallHeightM ?? null);
  const r = h.roof ?? {};
  const shape = r.shape ?? 'gable';
  const roof = {
    shape,
    ridge: r.ridge ?? (w >= d ? 'parallel' : 'perpendicular'),
    pitchDeg: r.pitchDeg ?? (shape === 'hip' ? 25 : 30),
    material: r.material ?? (r.color ? 'profiled' : 'slate'),
    color: r.color ?? pick(random, ['#b8b7b1', '#a9aaa5', '#bdb6a8']),
    overhang: r.overhangM ?? .4,
    gableFinish: r.gableFinish ?? (material === 'log' ? 'planks' : material === 'siding' ? 'siding' : 'planks'),
    gableColor: r.gableColor ?? (material === 'log' ? '#5a4a3a' : wallIn.color),
    gableBoards: r.gableBoards ?? 'vertical',
    gableArch: r.gableArch ?? false,
    frieze: r.frieze ?? false,
    trimColor: r.trimColor ?? null,
  };
  const win = h.windows ?? {
    street: roof.ridge === 'parallel' ? clamp(Math.round(w / 2.4), 2, 4) : (w >= 6.5 ? 3 : 2),
    side: clamp(Math.round(d / 3), 1, 3),
    frameColor: '#d9d5ca',
    nalichnik: { style: 'plain', color: '#e2ded3' },
    shutters: null,
  };
  const nal = win.nalichnik ?? { style: 'plain', color: win.frameColor };
  const sh = win.shutters && win.shutters.type !== 'none' ? win.shutters : null;
  return {
    id: p.id, w, d, floors, wall, wallH: wh.height, courses: wh.courses, coursePitch: wh.pitch,
    roof,
    windows: {
      street: win.street, side: win.side, frame: win.frameColor,
      nalichnik: nal.style === 'none' ? null : { style: nal.style, color: nal.color, crown: nal.crownColor ?? nal.color, shape: nal.crownShape ?? null },
      shutters: sh ? { type: sh.type, color: sh.color, closed: !!sh.closed } : null,
      width: material === 'log' ? .92 : 1.0, height: material === 'log' ? 1.22 : 1.3, sill: material === 'log' ? .74 : .9,
    },
    chimney: h.chimney ?? random() < .6,
    porch: h.porch ?? null,
    veranda: h.veranda ?? false,
    annex: h.annex ?? null,
    basement: h.basementM ?? .3,
    plinthColor: h.plinthColor ?? (material === 'log' || material === 'planks' ? '#57514a' : '#8b8a84'),
  };
}

// Even window centres along a wall of length L, at least `margin` from the corners and
// `minGap` apart, skipping `avoid` intervals (doors). Fewer windows are returned if n do not fit.
export function windowSlots(L, n, ww, { margin = .5, minGap = .45, avoid = [] } = {}) {
  let k = Math.max(0, Math.round(n));
  while (k > 0 && k * ww + (k - 1) * minGap > L - 2 * margin) k--;
  if (!k) return [];
  const usable = L - 2 * margin, step = usable / k;
  const xs = [];
  for (let i = 0; i < k; i++) xs.push(-L / 2 + margin + step * (i + .5));
  return xs.filter(x => !avoid.some(([a, b]) => x + ww / 2 + .15 > a && x - ww / 2 - .15 < b));
}

// Ridge frame -> house frame. 'parallel': ridge along x (X' = x, Z' = z).
// 'perpendicular': ridge along z, gable to the street (rotation by -90 degrees about y).
export function ridgeToHouse(ridge, [X, Y, Z]) {
  return ridge === 'perpendicular' ? [-Z, Y, X] : [X, Y, Z];
}
export function ridgeFrameSize(spec) {
  return spec.roof.ridge === 'perpendicular' ? { L: spec.d, S: spec.w } : { L: spec.w, S: spec.d };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };

// Slope record: polygon (counter-clockwise seen from outside/above), unit eave direction and
// unit down-slope direction (both in the ridge frame), used for roofing UVs.
function slope(pts, eaveA, eaveB) {
  const eave = norm(sub(eaveB, eaveA));
  // Down-slope: perpendicular to the eave within the slope plane, pointing to the eave.
  const centre = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
  const toEave = sub(eaveA, centre);
  const along = toEave[0] * eave[0] + toEave[1] * eave[1] + toEave[2] * eave[2];
  const down = norm([toEave[0] - eave[0] * along, toEave[1] - eave[1] * along, toEave[2] - eave[2] * along]);
  return { pts, eave, down, eaveA, eaveB };
}

// Pure roof description in the ridge frame (see top). Returns slopes, gable wall polygons,
// rake (verge) edges, ridge and hip lines, eave lines and key heights.
export function roofGeometry(spec) {
  const { L, S } = ridgeFrameSize(spec);
  const r = spec.roof, shape = r.shape;
  const y0 = spec.wallH, lift = PLATE_LIFT;
  const pitch = r.pitchDeg * Math.PI / 180, t = Math.tan(pitch);
  const e = shape === 'mansard' ? Math.min(r.overhang, .3) : r.overhang, g = r.overhang * .9;
  const hs = S / 2, hl = L / 2;
  const out = { slopes: [], gableWalls: [], rakes: [], ridges: [], hips: [], eaves: [], L, S, e, g, y0, shape };
  if (shape === 'mansard') {
    const lowerRun = S * .11, k = hs - lowerRun, yk = y0 + lift + lowerRun * t;
    const tu = Math.tan(MANSARD_UPPER_PITCH * Math.PI / 180), yR = yk + k * tu, yE = y0 + lift - e * t;
    for (const s of [-1, 1]) {
      const eA = [-hl - g, yE, s * (hs + e)], eB = [hl + g, yE, s * (hs + e)];
      const kA = [-hl - g, yk, s * k], kB = [hl + g, yk, s * k], rA = [-hl - g, yR, 0], rB = [hl + g, yR, 0];
      out.slopes.push(slope(s > 0 ? [eA, eB, kB, kA] : [eB, eA, kA, kB], eA, eB));
      out.slopes.push(slope(s > 0 ? [kA, kB, rB, rA] : [kB, kA, rA, rB], kA, kB));
      out.eaves.push({ a: eA, b: eB, out: [0, 0, s] });
      for (const x of [-hl - g, hl + g]) { out.rakes.push({ a: [x, yE, s * (hs + e)], b: [x, yk, s * k] }); out.rakes.push({ a: [x, yk, s * k], b: [x, yR, 0] }); }
    }
    out.ridges.push([[-hl - g, yR, 0], [hl + g, yR, 0]]);
    for (const sx of [-1, 1]) out.gableWalls.push({ axis: 'x', at: sx * hl, outward: sx, poly: [[-hs, y0], [hs, y0], [k, yk - lift], [0, yR - lift], [-k, yk - lift]] });
    Object.assign(out, { ridgeY: yR, eaveY: yE, kneeY: yk, rise: yR - y0 });
    return out;
  }
  if (shape === 'shed') {
    // High side at -Z' (away from the street when the ridge is parallel to it).
    const yLow = y0 + lift, yHigh = yLow + S * t;
    const yHi = yHigh + e * t, yLo = yLow - e * t, hiZ = -(hs + e), loZ = hs + e;
    const a = [-hl - g, yLo, loZ], b = [hl + g, yLo, loZ], c = [hl + g, yHi, hiZ], d = [-hl - g, yHi, hiZ];
    out.slopes.push(slope([a, b, c, d], a, b));
    out.eaves.push({ a, b, out: [0, 0, 1] });
    out.rakes.push({ a, b: d }, { a: b, b: c });
    for (const sx of [-1, 1]) out.gableWalls.push({ axis: 'x', at: sx * hl, outward: sx, poly: [[-hs, y0], [hs, y0], [-hs, yHigh - lift]] });
    out.gableWalls.push({ axis: 'z', at: -hs, outward: -1, poly: [[-hl, y0], [hl, y0], [hl, yHigh - lift], [-hl, yHigh - lift]] });
    Object.assign(out, { ridgeY: yHi, eaveY: yLo, rise: yHigh - y0, high: [d, c] });
    return out;
  }
  const yR = y0 + lift + hs * t, yE = y0 + lift - e * t;
  if (shape === 'hip') {
    const rx = Math.max(0, hl - hs), X = hl + e, Z = hs + e;
    const R0 = [-rx, yR, 0], R1 = [rx, yR, 0];
    for (const s of [-1, 1]) {
      const a = [-X, yE, s * Z], b = [X, yE, s * Z];
      out.slopes.push(slope(s > 0 ? [a, b, R1, R0] : [b, a, R0, R1], a, b));
      out.eaves.push({ a, b, out: [0, 0, s] });
    }
    for (const sx of [-1, 1]) {
      const a = [sx * X, yE, sx * Z], b = [sx * X, yE, -sx * Z], R = sx > 0 ? R1 : R0;
      out.slopes.push(slope([a, b, R], a, b));
      out.eaves.push({ a, b, out: [sx, 0, 0] });
      out.hips.push([[sx * X, yE, Z], R], [[sx * X, yE, -Z], R]);
    }
    if (rx > 0) out.ridges.push([R0, R1]);
    Object.assign(out, { ridgeY: yR, eaveY: yE, rise: yR - y0 });
    return out;
  }
  if (shape === 'half-hip') {
    const f = .38, zk = hs * f, yk = yR - zk * t, c = zk; // hip at the same pitch as the slopes
    const X = hl + g;
    for (const s of [-1, 1]) {
      const a = [-X, yE, s * (hs + e)], b = [X, yE, s * (hs + e)];
      const kb = [X, yk, s * zk], rb = [X - c, yR, 0], ra = [-X + c, yR, 0], ka = [-X, yk, s * zk];
      out.slopes.push(slope(s > 0 ? [a, b, kb, rb, ra, ka] : [b, a, ka, ra, rb, kb], a, b));
      out.eaves.push({ a, b, out: [0, 0, s] });
      out.rakes.push({ a, b: ka }, { a: b, b: kb });
    }
    for (const sx of [-1, 1]) {
      const A = [sx * X, yk, sx * zk], B = [sx * X, yk, -sx * zk], R = [sx * (X - c), yR, 0];
      out.slopes.push(slope([A, B, R], A, B));
      out.eaves.push({ a: A, b: B, out: [sx, 0, 0], short: true });
      out.hips.push([A, R], [B, R]);
      out.gableWalls.push({ axis: 'x', at: sx * hl, outward: sx, poly: [[-hs, y0], [hs, y0], [zk, yk - lift], [-zk, yk - lift]] });
    }
    out.ridges.push([[-X + c, yR, 0], [X - c, yR, 0]]);
    Object.assign(out, { ridgeY: yR, eaveY: yE, kneeY: yk, rise: yR - y0 });
    return out;
  }
  // gable (and the main body of a cross gable)
  for (const s of [-1, 1]) {
    const a = [-hl - g, yE, s * (hs + e)], b = [hl + g, yE, s * (hs + e)], rb = [hl + g, yR, 0], ra = [-hl - g, yR, 0];
    out.slopes.push(slope(s > 0 ? [a, b, rb, ra] : [b, a, ra, rb], a, b));
    out.eaves.push({ a, b, out: [0, 0, s] });
    out.rakes.push({ a, b: ra }, { a: b, b: rb });
  }
  out.ridges.push([[-hl - g, yR, 0], [hl + g, yR, 0]]);
  for (const sx of [-1, 1]) out.gableWalls.push({ axis: 'x', at: sx * hl, outward: sx, poly: [[-hs, y0], [hs, y0], [0, yR - lift]] });
  Object.assign(out, { ridgeY: yR, eaveY: yE, rise: yR - y0 });
  if (shape === 'gable-cross') {
    // Cross wing toward +Z' (the street when the main ridge is parallel to it): a narrower
    // gable whose ridge runs from the main ridge out past the wall, same pitch, lower ridge.
    const Sc = Math.min(L * .5, 6, S * 1.1), hc = Sc / 2, yRc = y0 + lift + hc * t, yEc = y0 + lift - e * t;
    const front = hs + g, back = 0;
    for (const s of [-1, 1]) {
      const a = [s * (hc + e), yEc, front], b = [s * (hc + e), yEc, back + hc * .2], R1 = [0, yRc, back], R0 = [0, yRc, front];
      out.slopes.push(slope(s > 0 ? [b, a, R0, R1] : [a, b, R1, R0], s > 0 ? b : a, s > 0 ? a : b));
      out.rakes.push({ a, b: R0 });
    }
    out.ridges.push([[0, yRc, back], [0, yRc, front]]);
    out.gableWalls.push({ axis: 'z', at: hs, outward: 1, poly: [[-hc, y0], [hc, y0], [0, yRc - lift]] });
    out.cross = { Sc, ridgeY: yRc };
  }
  return out;
}

// Polygon (2D) clipped by the half-plane a*x + b*y <= c (Sutherland-Hodgman).
export function clipPolygon(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// Boards covering a 2D polygon: bands of width `board` in direction `angle` (radians from the
// x axis; 0 = horizontal boards, PI/2 = vertical). 'sunburst' splits at x = cx into two halves
// of diagonal boards meeting in a chevron. Returns polygons (each a board) with an index.
export function boardPolygons(poly, { pattern = 'vertical', board = .14, cx = 0 } = {}) {
  const halves = pattern === 'sunburst' ? [[-1, Math.PI * .25], [1, Math.PI * .75]] : [[0, pattern === 'horizontal' ? 0 : Math.PI / 2]];
  const boards = [];
  for (const [side, angle] of halves) {
    let base = poly;
    if (side < 0) base = clipPolygon(poly, 1, 0, cx);
    if (side > 0) base = clipPolygon(poly, -1, 0, -cx);
    if (base.length < 3) continue;
    // Band normal n = (-sin, cos) for boards running along the angle direction.
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    const proj = base.map(p => p[0] * nx + p[1] * ny);
    const lo = Math.min(...proj), hi = Math.max(...proj);
    for (let s = Math.floor(lo / board) * board, i = 0; s < hi; s += board, i++) {
      let b = clipPolygon(base, nx, ny, s + board);
      b = clipPolygon(b, -nx, -ny, -s);
      if (b.length >= 3 && Math.abs(polygonArea(b)) > 1e-4) boards.push({ poly: b, index: i + (side > 0 ? 1000 : 0), angle });
    }
  }
  return boards;
}
