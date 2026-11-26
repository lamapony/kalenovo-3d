// Procedural rural Siberian houses and outbuildings (generic architecture, no real addresses).
// Geometry is stamped into TiledBuilders keyed by material, so the whole village is a few
// hundred merged draw calls. House local frame: x along the street facade, +z toward the street.
import * as THREE from 'three/webgpu';
import { randomGenerator } from '../geo.js';
import { trimTemplates } from './templates.js';
import { lin, jitter } from './materials.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RY = a => new THREE.Matrix4().makeRotationY(a);
const S = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
const mul = (...ms) => ms.reduce((acc, m) => acc.multiply(m), new THREE.Matrix4());
function basis(origin, X, Y) {
  const x = X.clone().normalize(), y = Y.clone().normalize(), z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}
const pick = (random, list) => list[Math.floor(random() * list.length) % list.length];

export const PALETTE = {
  logs: ['#9c8268', '#8d735a', '#a48b70', '#7f6a56', '#b09372', '#93806c'],
  siding: ['#9cbcb0', '#8aa7c4', '#dcc683', '#c08a72', '#ece5d2', '#97b585', '#a9b1bd', '#d6a879', '#b9c9a0'],
  trim: ['#f6f3ea', '#f6f3ea', '#f6f3ea', '#f6f3ea', '#c3d8ea', '#5d88bd', '#f2e7c9'],
  shutter: ['#4d7db3', '#5b9270', '#3b6f9f', '#f2efe6', '#2f5f8c', '#7aa6c9'],
  metal: ['#5f8a66', '#8a4b3b', '#647a8a', '#99603a', '#8c969c', '#47757f', '#6d8f4d'],
  slate: ['#b4b6b0', '#a6a9a4', '#9da29e', '#b9b3a6'],
  door: ['#7a5539', '#8a6444', '#557a62', '#62789a', '#8b4a3c'],
  planks: ['#8f877b', '#7d766c', '#9a8e7c', '#857d72'],
};

const LOG_P = .22, LOG_RY = .125, LOG_RZ = .135;

// Context bound to one building: world matrix + tiled builders.
function context(B, x, z, base, angle) {
  const M = mul(T(x, base, z), RY(-angle));
  const tmp = new THREE.Matrix4();
  return {
    M, x, z, base, angle,
    b(material, local = null, lod = 'near') {
      const builder = B.get(material, x, z, lod);
      builder.setMatrix(local ? tmp.multiplyMatrices(M, local) : M);
      return builder;
    },
    world(lx, lz) {
      const c = Math.cos(angle), s = Math.sin(angle);
      return [x + lx * c - lz * s, z + lx * s + lz * c];
    },
  };
}

function groundStats(ctx, ground, w, d, extra = []) {
  const pts = [];
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) pts.push([(i / 2 - .5) * w, (j / 2 - .5) * d]);
  pts.push(...extra);
  const hs = pts.map(([lx, lz]) => ground(...ctx.world(lx, lz)));
  return { min: Math.min(...hs), max: Math.max(...hs) };
}

// Four wall frames: local x along the wall, local +z outward, y up.
function wallFrames(w, d) {
  return {
    front: { m: T(0, 0, d / 2), L: w, A: true },
    back: { m: mul(T(0, 0, -d / 2), RY(Math.PI)), L: w, A: true },
    right: { m: mul(T(w / 2, 0, 0), RY(Math.PI / 2)), L: d, A: false },
    left: { m: mul(T(-w / 2, 0, 0), RY(-Math.PI / 2)), L: d, A: false },
  };
}
// House-local (x, z) -> wall-local x for a wall frame name.
function toWallX(name, x, z) {
  return name === 'front' ? x : name === 'back' ? -x : name === 'right' ? -z : z;
}

// --------------------------------------------------------------- walls ----

function logWalls(ctx, w, d, courses, openings, tint, random) {
  const frames = wallFrames(w, d), ov = .3, H = courses * LOG_P;
  for (const [name, f] of Object.entries(frames)) {
    const ops = openings[name] || [];
    const offset = f.A ? LOG_P / 2 : 0;
    const count = f.A ? courses : courses + 1;
    for (let k = 0; k < count; k++) {
      const y = offset + k * LOG_P;
      if (y > H + .01) break;
      const b = ctx.b('logs', f.m);
      b.setColor(jitter(tint, random, .07));
      const uo = random() * 3, vo = random() * 6;
      // Corner overhangs (full rings, capped ends).
      const capColor = tint.map(v => v * 1.35);
      b.log(-f.L / 2 - ov, -f.L / 2, y, 0, LOG_RY, LOG_RZ, { segments: 7, caps: [true, false], uo, vo, capColor });
      b.log(f.L / 2, f.L / 2 + ov, y, 0, LOG_RY, LOG_RZ, { segments: 7, caps: [false, true], uo, vo, capColor });
      // In-wall part: outer half only, split around openings.
      let pieces = [[-f.L / 2, f.L / 2]];
      for (const o of ops) {
        if (y + LOG_RY * .55 <= o.y0 || y - LOG_RY * .55 >= o.y1) continue;
        pieces = pieces.flatMap(([a, c]) => (o.x1 <= a || o.x0 >= c) ? [[a, c]] : [[a, o.x0], [o.x1, c]].filter(([p, q]) => q - p > .02));
      }
      for (const [a, c] of pieces) b.log(a, c, y, 0, LOG_RY, LOG_RZ, { segments: 6, arc: [-Math.PI / 2 - .35, Math.PI / 2 + .35], caps: [false, false], uo, vo });
    }
  }
  return H;
}

function boxWalls(ctx, material, w, h, d, tint, trimTint, { corners = true } = {}) {
  const b = ctx.b(material);
  b.setColor(tint);
  b.box(w, h, d, 0, h / 2, 0, { faces: ['px', 'nx', 'pz', 'nz'] });
  if (corners) {
    const t = ctx.b('painted');
    t.setColor(trimTint);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.box(.13, h, .13, sx * (w / 2 + .02), h / 2, sz * (d / 2 + .02));
    // Base board and frieze.
    t.box(w + .1, .16, d + .1, 0, .08, 0, { faces: ['px', 'nx', 'pz', 'nz', 'py'] });
    t.box(w + .08, .2, d + .08, 0, h - .1, 0, { faces: ['px', 'nx', 'pz', 'nz'] });
  }
}

// ------------------------------------------------------------- windows ----

// Window in a wall frame (local z outward). surf: wall outer surface offset; cut: true for log walls.
function windowAt(ctx, frameM, x, y0, ww, wh, style, { surf = 0, logWall = false, shutters = false, crest = true, lit = 0, random }) {
  const T0 = trimTemplates();
  const at = (lx, ly, lz) => mul(frameM, T(lx, ly, lz));
  const trimTint = style.trim;
  const glassZ = logWall ? -.01 : surf + .012;
  const g = ctx.b('glass', at(x, y0, glassZ));
  g.setColor([lit, random(), 0]);
  g.quad([[-ww / 2, 0, 0], [ww / 2, 0, 0], [ww / 2, wh, 0], [-ww / 2, wh, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const t = ctx.b('painted', at(x, y0, 0));
  t.setColor(trimTint);
  if (logWall) {
    // Reveal boards (обсада) covering the cut log ends.
    const depth = LOG_RZ * 2 + .02;
    t.box(ww + .08, .05, depth, 0, -.025, 0);
    t.box(ww + .08, .05, depth, 0, wh + .025, 0);
    t.box(.05, wh, depth, -ww / 2 - .025, wh / 2, 0);
    t.box(.05, wh, depth, ww / 2 + .025, wh / 2, 0);
  }
  // Casement bars: centre mullion and transom (T-shaped переплёт).
  const bars = ctx.b('painted', at(x, y0, glassZ + .022), 'detail');
  bars.setColor(trimTint);
  bars.box(.045, wh, .035, 0, wh / 2, 0);
  bars.box(ww, .045, .035, 0, wh * .7, 0);
  // Outer trim (наличник).
  const z = (logWall ? LOG_RZ + .02 : surf + .03);
  const o = ctx.b('painted', at(x, y0, z));
  o.setColor(trimTint);
  o.box(.11, wh + .14, .035, -ww / 2 - .055, wh / 2, 0);
  o.box(.11, wh + .14, .035, ww / 2 + .055, wh / 2, 0);
  o.box(ww + .34, .1, .04, 0, wh + .1, .004);
  o.box(ww + .38, .045, .1, 0, -.04, .03);
  if (crest) {
    const d = ctx.b('painted', at(x, y0 + wh + .15, z), 'detail');
    d.setColor(trimTint);
    d.geometry(T0.crests[style.crest], S((ww + .34) / 1.12, style.crestScale, 1));
    const s = ctx.b('painted', at(x, y0 - .065, z), 'detail');
    s.setColor(trimTint);
    s.geometry(T0.skirt, S((ww + .24), 1, 1));
  }
  if (shutters) {
    const pw = ww / 2 + .04;
    const sh = ctx.b('painted', at(x, y0, z - .006));
    sh.setColor(style.shutter);
    for (const side of [-1, 1]) sh.box(pw, wh + .04, .03, side * (ww / 2 + .11 + pw / 2), wh / 2, 0);
    const dd = ctx.b('painted', at(x, y0, z + .012), 'detail');
    dd.setColor(trimTint);
    for (const side of [-1, 1]) {
      const cx = side * (ww / 2 + .11 + pw / 2);
      dd.geometry(T0.diamond, mul(T(cx, wh * .5, 0), S(pw * .62, pw * .62, 1)));
      dd.box(pw - .06, .035, .012, cx, wh * .88, 0);
      dd.box(pw - .06, .035, .012, cx, wh * .12, 0);
    }
  }
}

function doorAt(ctx, frameM, x, w, h, style, { surf = 0, logWall = false, random }) {
  const at = (lx, ly, lz) => mul(frameM, T(lx, ly, lz));
  const z = logWall ? -.02 : surf + .02;
  const dp = ctx.b('planks', at(x, 0, z));
  dp.setColor(lin(style.door));
  dp.box(w, h, .05, 0, h / 2, 0, { uo: random() * 3 });
  const t = ctx.b('painted', at(x, 0, logWall ? 0 : surf));
  t.setColor(style.trim);
  const depth = logWall ? LOG_RZ * 2 + .03 : .06;
  t.box(.09, h + .08, depth, -w / 2 - .045, h / 2, 0);
  t.box(.09, h + .08, depth, w / 2 + .045, h / 2, 0);
  t.box(w + .18, .1, depth, 0, h + .05, 0);
  const handle = ctx.b('darkMetal', at(x + w * .35, 1, z + .05), 'detail');
  handle.setColor([1, 1, 1]);
  handle.box(.03, .16, .04);
}

// ---------------------------------------------------------------- roofs ----

// Gable roof over a w x d body whose walls end at height H. ridge: 'z' or 'x'.
function gableRoof(ctx, { w, d, H, ridge, pitch, eave = .45, gov = .4, roofMat, roofTint, trimTint, snowCover = 1, rakes = true, frontRake = true, wallOut = 0, random }) {
  const along = ridge === 'z' ? V(0, 0, 1) : V(1, 0, 0), across = ridge === 'z' ? V(1, 0, 0) : V(0, 0, 1), up = V(0, 1, 0);
  const hs = (ridge === 'z' ? w : d) / 2 + wallOut, lr = (ridge === 'z' ? d : w) + 2 * (gov + wallOut);
  const ta = Math.tan(pitch), ca = Math.cos(pitch), sa = Math.sin(pitch);
  const Hr = H + .1, ridgeY = Hr + hs * ta, eaveY = Hr - eave * ta, Ls = (hs + eave) / ca, t = .045;
  const snowT = .16 + random() * .08;
  for (const s of [-1, 1]) {
    const midA = s * (hs + eave) / 2, midY = (ridgeY + eaveY) / 2;
    const origin = across.clone().multiplyScalar(midA).addScaledVector(up, midY);
    const Y = across.clone().multiplyScalar(s * sa).addScaledVector(up, ca);
    const D = across.clone().multiplyScalar(s * ca).addScaledVector(up, -sa);
    const F = basis(origin, along, Y);
    const zSign = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(F)).dot(D) >= 0 ? 1 : -1;
    const sheet = ctx.b(roofMat, mul(F, T(0, t / 2, 0)));
    sheet.setColor(roofTint);
    sheet.box(lr, t, Ls, 0, 0, 0, { uo: random() * 2 });
    const soffit = ctx.b('planks', mul(F, T(0, -.02, 0)));
    soffit.setColor([.2, .17, .14]);
    soffit.box(lr - .02, .03, Ls - .02, 0, 0, 0, { faces: ['ny', 'px', 'nx'] });
    // Snow slab from just below the ridge toward (and past) the eave, with a rounded cornice.
    const start = -Ls / 2 + .07, end = -Ls / 2 + Ls * snowCover + (snowCover >= 1 ? .06 : 0);
    if (end - start > .4) {
      const sn = ctx.b('snow', mul(F, T(0, t + snowT / 2 - .01, zSign * (start + end) / 2)));
      sn.setColor([1, 1, 1]);
      sn.box(lr - .06, snowT, end - start, 0, 0, 0, { uo: random() * 4, vo: random() * 4 });
      const cornice = ctx.b('snow', mul(F, T(0, t + snowT * .45, zSign * end)));
      cornice.log(-lr / 2 + .03, lr / 2 - .03, 0, 0, snowT * .55, snowT * .5, { segments: 6, caps: [true, true] });
    }
    // Fascia board along the eave.
    const fascia = ctx.b('painted', basis(across.clone().multiplyScalar(s * (hs + eave - .02)).addScaledVector(up, eaveY - .05), along, up));
    fascia.setColor(trimTint);
    fascia.box(lr, .17, .03);
  }
  // Ridge cap.
  const cap = ctx.b(roofMat, basis(up.clone().multiplyScalar(ridgeY + t + .015), along, up));
  cap.setColor(roofTint.map(v => v * .8));
  cap.box(lr + .02, .05, .26);
  // Rake boards (причелины) and the towel at each gable end.
  const T0 = trimTemplates();
  for (const e of [-1, 1]) {
    const endPos = along.clone().multiplyScalar(e * (lr / 2 - .02));
    for (const s of [-1, 1]) {
      const start = endPos.clone().addScaledVector(across, s * (hs + eave)).addScaledVector(up, eaveY - .01);
      const dir = across.clone().multiplyScalar(-s * ca).addScaledVector(up, sa);
      const nrm = across.clone().multiplyScalar(s * sa).addScaledVector(up, ca);
      const fancy = rakes && (frontRake ? e === 1 : true);
      const rb = ctx.b('painted', basis(start, dir, nrm), fancy ? 'near' : 'near');
      rb.setColor(trimTint);
      if (fancy) rb.geometry(T0.rake, S(Ls, 1, 1));
      else rb.box(Ls, .16, .03, Ls / 2, -.08, 0);
    }
    if (rakes && (frontRake ? e === 1 : true)) {
      const tw = ctx.b('painted', basis(endPos.clone().addScaledVector(up, ridgeY - .04), across.clone().multiplyScalar(e), up), 'detail');
      tw.setColor(trimTint);
      tw.geometry(T0.towel);
    }
  }
  return { ridgeY, eaveY, hs, lr, along, across, Hr };
}

// Single-slope roof over a box w x d: high edge at -z side (local) unless flipped.
function shedRoof(ctx, local, { w, d, yHigh, yLow, over = .3, roofMat, roofTint, random, snow = true }) {
  const run = d + 2 * over, drop = yHigh - yLow + (yHigh - yLow) / d * 2 * over;
  const a = Math.atan2(yHigh - yLow, d), L = Math.hypot(run, drop), t = .045;
  const midY = (yHigh + yLow) / 2;
  const F = mul(local, T(0, midY, 0), new THREE.Matrix4().makeRotationX(a));
  const sheet = ctx.b(roofMat, mul(F, T(0, t / 2, 0)));
  sheet.setColor(roofTint);
  sheet.box(w + 2 * over, t, L, 0, 0, 0, { uo: random() * 2 });
  const so = ctx.b('planks', mul(F, T(0, -.02, 0)));
  so.setColor([.2, .17, .14]);
  so.box(w + 2 * over - .02, .03, L - .02, 0, 0, 0, { faces: ['ny'] });
  if (snow) {
    const st = .15 + random() * .06;
    const sn = ctx.b('snow', mul(F, T(0, t + st / 2 - .01, .03)));
    sn.box(w + 2 * over - .08, st, L - .04, 0, 0, 0, { uo: random() * 4 });
    const cornice = ctx.b('snow', mul(F, T(0, t + st * .45, L / 2)));
    cornice.log(-(w + 2 * over) / 2 + .04, (w + 2 * over) / 2 - .04, 0, 0, st * .5, st * .5, { segments: 6 });
  }
}

function chimney(ctx, x, z, yBase, yTop, brick = true, random) {
  if (brick) {
    const b = ctx.b('brick');
    b.setColor(jitter(lin(random() < .7 ? '#9a5b45' : '#b7a89a'), random, .1));
    b.box(.52, yTop - yBase, .52, x, (yTop + yBase) / 2, z, { uo: random() * 2, vo: random() * 2 });
    b.box(.64, .1, .64, x, yTop - .12, z, { faces: ['px', 'nx', 'pz', 'nz', 'ny'] });
    const c = ctx.b('concrete');
    c.setColor([1, 1, 1]);
    c.box(.66, .06, .66, x, yTop + .03, z);
    const sn = ctx.b('snow');
    sn.box(.6, .07, .6, x, yTop + .09, z, { faces: ['py', 'px', 'nx', 'pz', 'nz'] });
    const pipe = ctx.b('darkMetal', null, 'detail');
    pipe.setColor([1, 1, 1]);
    pipe.cylinder(.08, .08, yTop + .06, yTop + .32, x, z, 8);
  } else {
    const p = ctx.b('darkMetal');
    p.setColor([1.2, 1.2, 1.2]);
    p.cylinder(.1, .1, yBase, yTop, x, z, 10, { cap: false });
    p.cylinder(.22, .02, yTop + .12, yTop + .32, x, z, 10);
  }
  return new THREE.Vector3(x, yTop + .35, z).applyMatrix4(ctx.M).toArray();
}

function plinth(ctx, w, d, yBottom, yTop = .04) {
  const c = ctx.b('concrete');
  c.setColor([1, 1, 1]);
  c.box(w, yTop - yBottom, d, 0, (yTop + yBottom) / 2, 0, { faces: ['px', 'nx', 'pz', 'nz', 'py'] });
}

// Porch with steps, rails and a small canopy, in front of a door on a side wall.
function porch(ctx, ground, { px, pz, side, roofMat, roofTint, style, random }) {
  const sd = side, gl = ground(...ctx.world(px + sd * 1.5, pz)) - ctx.base;
  const top = -.08, depth = 1.25, width = 1.6;
  const p = ctx.b('planks');
  p.setColor(lin(pick(random, PALETTE.planks)));
  p.box(depth, .1, width, px + sd * (depth / 2 + .1), top - .05, pz, { uo: random() * 2 });
  // Posts under the platform down to the ground.
  for (const zz of [-1, 1]) p.box(.12, Math.max(.1, top - gl + .2), .12, px + sd * (depth + .02), (top + gl - .2) / 2, pz + zz * (width / 2 - .08));
  const drop = top - .1 - gl;
  const n = Math.max(0, Math.round(drop / .19));
  const rise = drop / (n + 1);
  for (let i = 0; i < n; i++) {
    const y = top - .1 - (i + 1) * rise;
    p.box(.3, Math.max(.06, y - gl + .15), 1.1, px + sd * (depth + .25 + i * .3), (y + gl - .15) / 2, pz);
  }
  // Rails.
  const r = ctx.b('painted');
  r.setColor(style.trim);
  for (const zz of [-1, 1]) {
    const z = pz + zz * (width / 2 - .04);
    r.box(depth, .05, .06, px + sd * (depth / 2 + .1), top + .9, z);
    for (let k = 0; k < 4; k++) r.box(.045, .9, .045, px + sd * (.25 + k * (depth - .2) / 3), top + .45, z);
  }
  // Canopy on two posts.
  const postX = px + sd * (depth + .02);
  for (const zz of [-1, 1]) r.box(.1, 2.35, .1, postX, top + 1.17, pz + zz * (width / 2 - .05));
  const local = mul(T(px + sd * (depth / 2 + .1), 0, pz), RY(sd > 0 ? Math.PI / 2 : -Math.PI / 2));
  shedRoof(ctx, local, { w: width - .1, d: depth + .2, yHigh: 2.55, yLow: 2.25, over: .2, roofMat, roofTint, random });
}

// ---------------------------------------------------------------- house ----

export function houseStyle(random) {
  const log = random() < .6;
  const metalRoof = random() < .62;
  return {
    log,
    logTint: lin(pick(random, PALETTE.logs)),
    siding: lin(pick(random, PALETTE.siding)),
    trim: lin(pick(random, PALETTE.trim)),
    shutter: lin(pick(random, PALETTE.shutter)),
    shutters: random() < .38,
    roofMat: metalRoof ? 'metal' : 'slate',
    roofTint: lin(metalRoof ? pick(random, PALETTE.metal) : pick(random, PALETTE.slate)),
    door: pick(random, PALETTE.door),
    crest: Math.floor(random() * 3),
    crestScale: .8 + random() * .45,
    pitch: (30 + random() * 12) * Math.PI / 180,
    snowCover: metalRoof && random() < .3 ? .55 + random() * .3 : 1,
    paintedGable: random() < .45,
  };
}

export function buildHouse(B, ground, h) {
  const random = randomGenerator(h.seed);
  const style = houseStyle(random);
  const extra = h.annex ? [[h.annex.x - h.annex.w / 2, h.annex.z - h.annex.d / 2], [h.annex.x + h.annex.w / 2, h.annex.z - h.annex.d / 2]] : [];
  const pre = context(B, h.x, h.z, 0, h.angle);
  const gs = groundStats(pre, ground, h.w, h.d, extra);
  const base = gs.max + .3 + random() * .25;
  const ctx = context(B, h.x, h.z, base, h.angle);
  const { w, d } = h;
  const courses = 12 + (random() < .5 ? 1 : 0);
  const H = style.log ? courses * LOG_P : 2.75;
  const frames = wallFrames(w, d);
  // Openings per wall (wall-local coordinates).
  const ww = .95 + random() * .15, wh = 1.28 + random() * .12, sill = .88;
  const openings = { front: [], back: [], left: [], right: [] }, windows = [];
  const addWindows = (name, n, L, avoid = []) => {
    if (n <= 0) return;
    const spacing = Math.min(2.2, (L - .9) / n);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * spacing;
      if (avoid.some(([a, c]) => x + ww / 2 + .3 > a && x - ww / 2 - .3 < c)) continue;
      openings[name].push({ x0: x - ww / 2, x1: x + ww / 2, y0: sill, y1: sill + wh });
      windows.push({ name, x, spacing });
    }
  };
  const gableFront = h.ridge === 'z';
  addWindows('front', gableFront ? (w >= 7.2 ? 3 : 2) : Math.max(2, Math.min(5, Math.round(w / 2.3))), w);
  // Door / porch side wall.
  const porchWall = h.porch.side > 0 ? 'right' : 'left';
  const doorX = h.annex ? null : toWallX(porchWall, h.porch.x, h.porch.z);
  const sideN = Math.max(1, Math.min(3, Math.round(d / 2.9)));
  for (const name of ['left', 'right']) {
    const avoid = [];
    if (name === porchWall && doorX !== null) avoid.push([doorX - .6, doorX + .6]);
    addWindows(name, name === porchWall ? sideN - 1 : sideN, d, avoid);
  }
  if (!h.annex) addWindows('back', w > 7 ? 1 : 0, w);
  if (doorX !== null) openings[porchWall].push({ x0: doorX - .48, x1: doorX + .48, y0: 0, y1: 2.0, door: true });

  // Plinth from below the lowest ground point under the footprint up to the floor.
  plinth(ctx, w + .1, d + .1, gs.min - base - .35);
  if (style.log) logWalls(ctx, w, d, courses, openings, style.logTint, random);
  else boxWalls(ctx, 'siding', w, H, d, style.siding, style.trim);

  // Windows.
  const shutterOK = style.shutters;
  for (const win of windows) {
    const f = frames[win.name];
    const lit = random() < .72 ? .55 + random() * .45 : 0;
    windowAt(ctx, f.m, win.x, sill, ww, wh, style, { logWall: style.log, shutters: shutterOK && win.spacing > ww + 1.05 && win.name !== 'back', crest: win.name !== 'back', lit, random });
  }
  if (doorX !== null) doorAt(ctx, frames[porchWall].m, doorX, .92, 1.98, style, { logWall: style.log, random });

  // Gables and roof.
  const wallOut = style.log ? LOG_RZ : 0;
  const roof = gableRoof(ctx, { w, d, H, ridge: h.ridge, pitch: style.pitch, roofMat: style.roofMat, roofTint: style.roofTint, trimTint: style.trim, snowCover: style.snowCover, wallOut: style.log ? .06 : 0, random });
  const gableNames = gableFront ? ['front', 'back'] : ['right', 'left'];
  for (const name of gableNames) {
    const f = frames[name], half = f.L / 2 + wallOut;
    const apex = roof.ridgeY - .06, z = style.log ? .07 : .004;
    const g = ctx.b(style.paintedGable || !style.log ? 'siding' : 'planks', f.m);
    g.setColor(style.paintedGable || !style.log ? style.siding : lin(pick(random, PALETTE.planks)));
    g.triangle([[-half, H, z], [half, H, z], [0, apex, z]], [[-half, H], [half, H], [0, apex]]);
    const tb = ctx.b('painted', f.m);
    tb.setColor(style.trim);
    tb.box(f.L + 2 * wallOut + .1, .14, .05, 0, H + .05, z + .03);
    if (name === gableNames[0]) {
      // Attic window on the street gable.
      const ah = Math.min(.7, (apex - H) * .42), aw = .55;
      if (ah > .35) windowAt(ctx, mul(f.m, T(0, 0, z - .001)), 0, H + (apex - H) * .2, aw, ah, style, { surf: 0, crest: true, lit: random() < .2 ? .5 : 0, random });
    }
  }
  // Chimney through the roof near the ridge.
  const cAlong = (random() - .5) * roof.lr * .35, cAcross = (random() < .5 ? -1 : 1) * (.3 + random() * .4);
  const cx = gableFront ? cAcross : cAlong, cz = gableFront ? cAlong : cAcross;
  const chimneyTop = chimney(ctx, cx, cz, H - .2, roof.ridgeY + .55 + random() * .3, true, random);

  // Annex (сени / веранда) with a shed roof.
  if (h.annex) {
    const a = h.annex, Ha = 2.35;
    const actx = ctx; // same frame
    const annexWall = random() < .5 ? 'planks' : 'siding';
    const tint = annexWall === 'planks' ? lin(pick(random, PALETTE.planks)) : style.siding;
    const local = T(a.x, 0, a.z);
    plinth({ b: (m, l) => actx.b(m, l ? mul(local, l) : local) }, a.w + .06, a.d + .06, gs.min - base - .35);
    const body = actx.b(annexWall, local);
    body.setColor(tint);
    body.box(a.w, Ha, a.d, 0, Ha / 2, 0, { faces: ['px', 'nx', 'nz', 'pz'] });
    const tr = actx.b('painted', local);
    tr.setColor(style.trim);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tr.box(.11, Ha, .11, sx * (a.w / 2 + .01), Ha / 2, sz * (a.d / 2 + .01));
    // Veranda glazing on the back wall.
    const backM = mul(local, T(0, 0, -a.d / 2), RY(Math.PI));
    const nv = Math.max(1, Math.floor((a.w - .6) / 1.0));
    for (let i = 0; i < nv; i++) {
      const x = (i - (nv - 1) / 2) * ((a.w - .4) / nv);
      windowAt(ctx, backM, x, .95, .7, .85, style, { surf: 0, crest: false, lit: random() < .4 ? .5 : 0, random });
    }
    // Door on the yard side.
    const sideM = mul(local, T(h.yardSide * a.w / 2, 0, 0), RY(h.yardSide > 0 ? Math.PI / 2 : -Math.PI / 2));
    doorAt(ctx, sideM, 0, .9, 1.95, style, { surf: 0, random });
    const eaveH = gableFront ? H - .05 : roof.eaveY - .12;
    shedRoof(ctx, mul(local, RY(Math.PI)), { w: a.w, d: a.d, yHigh: Math.min(eaveH, Ha + .75), yLow: Ha - .05, over: .25, roofMat: style.roofMat, roofTint: style.roofTint, random });
  }
  // Porch in front of the door.
  const pp = h.annex ? { px: h.porch.x + h.yardSide * .03, pz: h.porch.z } : { px: h.porch.x + h.yardSide * (style.log ? LOG_RZ : .03), pz: h.porch.z };
  porch(ctx, ground, { ...pp, side: h.yardSide, roofMat: style.roofMat, roofTint: style.roofTint, style, random });
  return { base, height: roof.ridgeY, chimneyTop, smoke: random() < .7 };
}

// ---------------------------------------------------------- outbuildings ----

export function buildOutbuilding(B, ground, ob) {
  const random = randomGenerator(ob.seed || 1);
  const pre = context(B, ob.x, ob.z, 0, ob.angle);
  const gs = groundStats(pre, ground, ob.w, ob.d);
  const base = gs.max + .12;
  const ctx = context(B, ob.x, ob.z, base, ob.angle);
  const { w, d } = ob;
  const metal = random() < .45;
  const roofMat = metal ? 'metal' : 'slate';
  const roofTint = metal ? lin(pick(random, PALETTE.metal), .85) : lin(pick(random, PALETTE.slate), .92);
  const style = { trim: lin(pick(random, ['#d8d2c4', '#bfb8aa', '#f2efe6'])), door: pick(random, PALETTE.door), crest: 0, crestScale: 1, shutter: [1, 1, 1] };
  const frames = wallFrames(w, d);
  if (ob.kind === 'banya') {
    const courses = 9, H = courses * LOG_P;
    plinth(ctx, w + .08, d + .08, gs.min - base - .3);
    const openings = { front: [{ x0: -.38, x1: .38, y0: 0, y1: 1.75, door: true }], right: [{ x0: -.3, x1: .3, y0: .95, y1: 1.4 }] };
    logWalls(ctx, w, d, courses, openings, jitter(lin(pick(random, PALETTE.logs)), random, .06).map(v => v * .9), random);
    windowAt(ctx, frames.right.m, 0, .95, .6, .45, style, { logWall: true, crest: false, lit: random() < .25 ? .7 : 0, random });
    doorAt(ctx, frames.front.m, 0, .76, 1.73, style, { logWall: true, random });
    const roof = gableRoof(ctx, { w, d, H, ridge: 'z', pitch: (24 + random() * 8) * Math.PI / 180, eave: .35, gov: .45, roofMat, roofTint, trimTint: style.trim, rakes: false, wallOut: .06, random });
    for (const name of ['front', 'back']) {
      const g = ctx.b('planks', frames[name].m);
      g.setColor(lin(pick(random, PALETTE.planks)));
      const half = w / 2 + LOG_RZ;
      g.triangle([[-half, H, .07], [half, H, .07], [0, roof.ridgeY - .06, .07]], [[-half, H], [half, H], [0, roof.ridgeY]]);
    }
    const chimneyTop = chimney(ctx, w * .22, -d * .2, H - .2, roof.ridgeY + .9, false, random);
    return { base, height: roof.ridgeY, chimneyTop, smoke: random() < .2 };
  }
  const H = ob.kind === 'barn' ? 2.6 + random() * .5 : 2.1 + random() * .35;
  const tint = lin(pick(random, PALETTE.planks), .85 + random() * .2);
  plinth(ctx, w + .04, d + .04, gs.min - base - .25, .08);
  const body = ctx.b('planks');
  body.setColor(tint);
  body.box(w, H, d, 0, H / 2, 0, { faces: ['px', 'nx', 'pz', 'nz'], uo: random() * 3 });
  const posts = ctx.b('planks');
  posts.setColor(tint.map(v => v * .8));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.box(.14, H, .14, sx * (w / 2), H / 2, sz * (d / 2));
  if (ob.kind === 'barn') {
    const gw = Math.min(2.8, w - 1);
    const door = ctx.b('planks', frames.front.m);
    door.setColor(tint.map(v => v * .75));
    door.box(gw, H - .4, .06, 0, (H - .4) / 2, .03);
    door.box(.08, H - .4, .08, 0, (H - .4) / 2, .07);
    // Z-braces.
    for (const sx of [-1, 1]) {
      door.box(gw / 2 - .1, .1, .04, sx * gw / 4, .4, .08);
      door.box(gw / 2 - .1, .1, .04, sx * gw / 4, H - .8, .08);
    }
    const ridge = w >= d ? 'x' : 'z';
    const roof = gableRoof(ctx, { w, d, H, ridge, pitch: (20 + random() * 8) * Math.PI / 180, eave: .35, gov: .3, roofMat, roofTint, trimTint: style.trim, rakes: false, random });
    const gNames = ridge === 'z' ? ['front', 'back'] : ['right', 'left'];
    for (const name of gNames) {
      const f = frames[name], half = f.L / 2;
      const g = ctx.b('planks', f.m);
      g.setColor(tint);
      g.triangle([[-half, H, .005], [half, H, .005], [0, roof.ridgeY - .06, .005]], [[-half, H], [half, H], [0, roof.ridgeY]]);
    }
    return { base, height: roof.ridgeY };
  }
  // Shed: door + single-slope roof falling to the back.
  doorAt(ctx, frames.front.m, (random() - .5) * Math.max(0, w - 1.4), .85, 1.8, style, { surf: 0, random });
  shedRoof(ctx, RY(Math.PI), { w, d, yHigh: H + .45, yLow: H, over: .3, roofMat, roofTint, random });
  return { base, height: H + .5 };
}
