// Passport-driven house kit: round-log, clapboard, siding, brick and plaster houses with
// gable, hip, half-hip, mansard, shed and cross-gable roofs, carved window trim (наличники),
// shutters, roller shutters, boarded gables, chimneys, verandas, porches and outbuildings.
// Geometry is stamped into the shared TiledBuilders (merged per material and tile), so the
// whole street adds only a handful of draw calls. House frame: x along the facade, +z to the street.
import * as THREE from 'three/webgpu';
import { randomGenerator } from '../../geo.js';
import { trimTemplates } from '../templates.js';
import { lin, jitter } from '../materials.js';
import { context, groundStats, wallFrames, T, RY, S, mul, basis } from '../house.js';
import { season } from '../../season.js';
import { resolveHouse, roofGeometry, ridgeToHouse, windowSlots, boardPolygons, hashString, annexFootprint } from './spec.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a) || 1; return scl(a, 1 / l); };
const V3 = a => new THREE.Vector3(a[0], a[1], a[2]);

// Newell normal of a planar polygon.
function newell(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return unit(n);
}
// Convex polygon as a triangle fan, wound to face `outward` when given.
function fan(b, pts, uvs, outward = null, shade = 1) {
  let P = pts, U = uvs;
  if (outward && dot(newell(pts), outward) < 0) { P = [...pts].reverse(); U = [...uvs].reverse(); }
  for (let i = 1; i < P.length - 1; i++) b.triangle([P[0], P[i], P[i + 1]], [U[0], U[i], U[i + 1]], shade);
}
// Quad with per-vertex shade (fake occlusion under clapboard laps).
function gquad(b, p, uvs, shades) {
  const n = newell(p);
  const i = p.map((q, k) => b.vertex(q[0], q[1], q[2], n[0], n[1], n[2], uvs[k][0], uvs[k][1], shades[k]));
  b.quadIdx(i[0], i[1], i[2], i[3]);
}

// Unpainted timber (browns of low lightness) uses the rough wood texture; paint uses 'painted'.
const _c = new THREE.Color(), _hsl = {};
export function isRawWood(hex) {
  _c.set(hex).getHSL(_hsl);
  const h = _hsl.h * 360;
  return h >= 8 && h <= 52 && _hsl.l < .48 && _hsl.s < .8;
}
const woodMat = hex => (isRawWood(hex) ? 'logs' : 'painted');
// The rough-wood texture is contrasty (dark grain), so boards read darker than their tint;
// lift raw-wood boards so they match the observed colours.
export const woodTint = hex => (isRawWood(hex) ? lin(hex).map(v => v * 1.35) : lin(hex));
const brighten = (rgb, k, addv = 0) => rgb.map(v => v * k + addv);

// ----------------------------------------------------------------- walls ----

function logWalls(ctx, spec, openings, random) {
  const P = spec.coursePitch, rz = spec.wall.logD / 2, ry = P * .58, n = spec.courses, H = n * P;
  const tint = lin(spec.wall.color);
  const saddle = spec.wall.corner !== 'boxed';
  const ov = rz + .24, capColor = brighten(tint, 1.35, .03);
  const frames = wallFrames(spec.w, spec.d);
  for (const [name, f] of Object.entries(frames)) {
    const ops = openings[name] || [];
    const offset = f.A ? P / 2 : 0, count = f.A ? n : n + 1;
    const end = saddle ? f.L / 2 : f.L / 2 + rz;
    for (let k = 0; k < count; k++) {
      const y = offset + k * P;
      const logTint = jitter(random() < .12 ? tint.map(v => v * .82) : tint, random, .08);
      const uo = random() * 3, vo = random() * 6;
      if (saddle) {
        const cb = ctx.b('logs', f.m, 'detail');
        cb.setColor(logTint);
        cb.log(-f.L / 2 - ov, -f.L / 2 + .02, y, 0, ry, rz, { segments: 8, caps: [true, false], uo, vo, capColor });
        cb.log(f.L / 2 - .02, f.L / 2 + ov, y, 0, ry, rz, { segments: 8, caps: [false, true], uo, vo, capColor });
      }
      let pieces = [[-end, end]];
      for (const o of ops) {
        if (y + ry * .55 <= o.y0 || y - ry * .55 >= o.y1) continue;
        pieces = pieces.flatMap(([a, c]) => (o.x1 <= a || o.x0 >= c) ? [[a, c]] : [[a, o.x0], [o.x1, c]].filter(([p, q]) => q - p > .03));
      }
      const b = ctx.b('logs', f.m);
      b.setColor(logTint);
      for (const [a, c] of pieces) b.log(a, c, y, 0, ry, rz, { segments: 7, arc: [-Math.PI / 2 - .3, Math.PI / 2 + .3], caps: [false, false], uo, vo });
    }
  }
  // Dark caulked core behind the logs, so no light leaks between the courses.
  const core = ctx.b('logs');
  core.setColor(tint.map(v => v * .35));
  core.box(spec.w - .02, H, spec.d - .02, 0, H / 2, 0, { faces: ['px', 'nx', 'pz', 'nz'] });
  if (!saddle) cornerBoards(ctx, spec.w + 2 * rz, spec.d + 2 * rz, H, brighten(tint, 1.1), woodMat(spec.wall.color));
  return { H, surf: rz };
}

function cornerBoards(ctx, w, d, H, tint, material) {
  const t = ctx.b(material);
  t.setColor(tint);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    t.box(.19, H, .035, sx * (w / 2 - .06), H / 2, sz * (d / 2 + .045));
    t.box(.035, H, .19, sx * (w / 2 + .045), H / 2, sz * (d / 2 - .06));
  }
}

// Horizontal clapboard (обшивка доской): tilted boards with a shadowed lap, split at openings.
function boardWalls(ctx, spec, openings, random, H) {
  const tint = woodTint(spec.wall.color), mat = woodMat(spec.wall.color), bh = .15;
  const core = ctx.b(mat);
  core.setColor(tint.map(v => v * .45));
  core.box(spec.w, H, spec.d, 0, H / 2, 0, { faces: ['px', 'nx', 'pz', 'nz'] });
  for (const [name, f] of Object.entries(wallFrames(spec.w, spec.d))) {
    const ops = openings[name] || [], b = ctx.b(mat, f.m);
    for (let y = 0; y < H - .01; y += bh) {
      const y1 = Math.min(H, y + bh);
      let pieces = [[-f.L / 2, f.L / 2]];
      for (const o of ops) {
        if (y1 <= o.y0 + .01 || y >= o.y1 - .01) continue;
        pieces = pieces.flatMap(([a, c]) => (o.x1 <= a || o.x0 >= c) ? [[a, c]] : [[a, o.x0], [o.x1, c]].filter(([p, q]) => q - p > .03));
      }
      b.setColor(jitter(tint, random, .05));
      const uo = random() * 4;
      for (const [a, c] of pieces) {
        // uv: grain of the wood texture runs along v, so v follows the board.
        gquad(b, [[a, y, .03], [c, y, .03], [c, y1, .006], [a, y1, .006]], [[y * .5 + uo, a], [y * .5 + uo, c], [y1 * .5 + uo, c], [y1 * .5 + uo, a]], [.7, .7, 1.04, 1.04]);
        b.quad([[a, y, .006], [c, y, .006], [c, y, .03], [a, y, .03]], [[a, 0], [c, 0], [c, .02], [a, .02]], .5);
      }
    }
  }
  cornerBoards(ctx, spec.w + .06, spec.d + .06, H, brighten(tint, 1.08), mat);
  // Clapboard is framed: a frieze board under the eaves and a water-table board with a drip
  // over the plinth, both standing proud of the laps (logs have neither).
  const fr = ctx.b(mat);
  fr.setColor(brighten(tint, 1.08));
  fr.box(spec.w + .1, .17, spec.d + .1, 0, H - .085, 0, { faces: ['px', 'nx', 'pz', 'nz'] });
  fr.box(spec.w + .14, .13, spec.d + .14, 0, .065, 0, { faces: ['px', 'nx', 'pz', 'nz', 'py'] });
  return { H, surf: .03 };
}

function boxWalls(ctx, spec, H, material) {
  const tint = lin(spec.wall.color);
  const b = ctx.b(material);
  b.setColor(tint);
  b.box(spec.w, H, spec.d, 0, H / 2, 0, { faces: ['px', 'nx', 'pz', 'nz'] });
  if (material === 'siding') {
    // Vinyl corner trims and a starter strip.
    const t = ctx.b('painted');
    t.setColor(lin(spec.windows.frame));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.box(.09, H, .09, sx * (spec.w / 2 + .015), H / 2, sz * (spec.d / 2 + .015));
    t.box(spec.w + .06, .06, spec.d + .06, 0, .03, 0, { faces: ['px', 'nx', 'pz', 'nz'] });
  }
  return { H, surf: .012 };
}

// --------------------------------------------------------------- windows ----

// Window in a wall frame (local z outward, surf = outer wall face). Recessed glass, reveal
// boards, a T-shaped casement, the наличник by style, wooden or roller shutters.
function kitWindow(ctx, frameM, x, y0, ww, wh, spec, { surf, log = false, lit = 0, random, crown = 0, shutters = true, cut = true }) {
  const at = (lx, ly, lz) => mul(frameM, T(lx, ly, lz));
  const W = spec.windows, frameC = lin(W.frame), nal = W.nalichnik, nalC = nal ? lin(nal.color) : frameC;
  const T0 = trimTemplates();
  // Log and clapboard walls are cut around the opening (recessed glass); box walls (siding,
  // brick, plaster) are not, so their glass sits just proud of the wall face.
  const glassZ = log ? -.02 : cut ? surf - .06 : surf + .006;
  const g = ctx.b('kitGlass', at(x, y0, glassZ));
  g.setColor([lit, random(), 0]);
  g.quad([[-ww / 2, 0, 0], [ww / 2, 0, 0], [ww / 2, wh, 0], [-ww / 2, wh, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // Reveal boards (обсада on log walls) from the glass to the wall face.
  const depth = Math.max(.03, surf - glassZ + .01);
  const rv = ctx.b('painted', at(x, y0, cut ? (glassZ + surf) / 2 : surf + .015));
  rv.setColor(log ? brighten(frameC, .85) : frameC);
  rv.box(ww + .1, .05, depth, 0, -.025, 0); rv.box(ww + .1, .05, depth, 0, wh + .025, 0);
  rv.box(.05, wh, depth, -ww / 2 - .025, wh / 2, 0); rv.box(.05, wh, depth, ww / 2 + .025, wh / 2, 0);
  // Casement: frame, centre mullion below the transom, transom (T-shaped переплёт).
  const sb = ctx.b('painted', at(x, y0, glassZ + .022));
  sb.setColor(frameC);
  sb.box(ww, .055, .04, 0, .028, 0); sb.box(ww, .055, .04, 0, wh - .028, 0);
  sb.box(.055, wh, .04, -ww / 2 + .028, wh / 2, 0); sb.box(.055, wh, .04, ww / 2 - .028, wh / 2, 0);
  sb.box(.045, wh * .68, .035, 0, wh * .34, .004);
  sb.box(ww, .05, .035, 0, wh * .68, .004);
  if (ww > .8) sb.box(.04, wh * .32, .03, -ww * .18, wh * .84, .004);
  const z = surf + .016;
  if (nal) {
    // Casing boards stand 4-5 cm proud of the wall; a projecting cornice shelf (полочка) with a
    // moulding under it, and a thick sill board with a drip strip, so they cast real shadows.
    const o = ctx.b('painted', at(x, y0, z));
    o.setColor(nalC);
    o.box(.12, wh + .16, .045, -ww / 2 - .06, wh / 2, .004);
    o.box(.12, wh + .16, .045, ww / 2 + .06, wh / 2, .004);
    o.box(ww + .3, .12, .05, 0, wh + .12, .008);
    o.box(ww + .5, .055, .15, 0, wh + .205, .055);
    o.box(ww + .4, .03, .09, 0, wh + .165, .036);
    o.box(ww + .46, .055, .16, 0, -.035, .06);
    o.box(ww + .3, .06, .03, 0, -.09, .012);
    if (nal.style !== 'plain') {
      // Fretwork: pierced crown on the shelf, drops under it, cut side boards over the casing,
      // and (fully carved style) a pierced apron under the sill.
      const C = T0.carved, crownC = lin(nal.crown ?? nal.color);
      const ci = { kokoshnik: 0, pediment: 1, trapezoid: 2 }[nal.shape] ?? (nal.style === 'carved' ? 0 : crown % 3);
      const k = (ww + .5) / 1.08;
      const cr = ctx.b('painted', at(x, y0 + wh + .232, z + .045), 'detail');
      cr.setColor(crownC);
      cr.geometry(C.crowns[ci], S(k, k * (ci === 0 ? .82 : .9), 1));
      // Contrasting board behind the pierced rosette (the "filigree insert" of the photos).
      const sh = W.shutters;
      if (sh && sh.type === 'wooden') {
        const ins = ctx.b('painted', at(x, y0 + wh + .232, z + .018), 'detail');
        ins.setColor(lin(sh.color));
        ins.box(k * .5, k * (ci === 0 ? .3 : .24), .012, 0, k * (ci === 0 ? .22 : .16), 0);
      }
      const dr = ctx.b('painted', at(x, y0 + wh + .178, z + .1), 'detail');
      dr.setColor(crownC);
      const nd = ww > .8 ? 5 : 3;
      for (let i = 0; i < nd; i++) dr.geometry(C.drop, T(-(ww + .36) / 2 + (ww + .36) * (i + .5) / nd, 0, 0));
      const sd = ctx.b('painted', at(x, y0 - .02, z + .032), 'detail');
      sd.setColor(brighten(nalC, 1.06));
      for (const s of [-1, 1]) sd.geometry(C.side, mul(T(s * (ww / 2 + .06), 0, 0), S(1, wh + .14, 1)));
      if (nal.style === 'carved') {
        const ap = ctx.b('painted', at(x, y0 - .12, z + .01), 'detail');
        ap.setColor(nalC);
        ap.geometry(C.apron, S(ww + .36, 1.15, 1));
      }
    }
  } else {
    // Siding and plain walls: a slim J-trim around the window.
    const o = ctx.b('painted', at(x, y0, surf + .008));
    o.setColor(frameC);
    o.box(.06, wh + .12, .02, -ww / 2 - .03, wh / 2, 0); o.box(.06, wh + .12, .02, ww / 2 + .03, wh / 2, 0);
    o.box(ww + .12, .06, .02, 0, wh + .03, 0); o.box(ww + .16, .04, .08, 0, -.02, .03);
  }
  const sh = W.shutters;
  if (sh && shutters && sh.type === 'wooden') {
    const shC = lin(sh.color), molding = sh.closed ? brighten(shC, .72) : nal && Math.abs(nalC[0] - shC[0]) + Math.abs(nalC[2] - shC[2]) > .08 ? nalC : brighten(shC, 1.4, .02);
    const closed = sh.closed, pw = closed ? ww / 2 : ww / 2 + .03, ph = closed ? wh : wh + .06;
    const zz = closed ? surf + .004 : z - .004;
    const leaf = ctx.b('painted', at(x, y0, zz));
    leaf.setColor(shC);
    const dd = ctx.b('painted', at(x, y0, zz + .022), 'detail');
    dd.setColor(molding);
    for (const side of [-1, 1]) {
      const cx = closed ? side * ww / 4 : side * (ww / 2 + .13 + pw / 2);
      leaf.box(pw - .01, ph, .035, cx, wh / 2, 0);
      // Two raised panels per leaf (filёнки), upper one taller, a raised field with a diamond
      // in each, and two strap hinges on the outer edge.
      for (const [py0, py1] of [[.08, wh * .4], [wh * .46, wh - .08]]) {
        const pwid = pw - .14, phh = py1 - py0, cy = (py0 + py1) / 2;
        dd.box(pwid, .025, .012, cx, py0, 0); dd.box(pwid, .025, .012, cx, py1, 0);
        dd.box(.025, phh, .012, cx - pwid / 2, cy, 0); dd.box(.025, phh, .012, cx + pwid / 2, cy, 0);
      }
      // Raised diamond fields, a shade lighter than the leaf.
      const df = ctx.b('painted', at(x, y0, zz + .02), 'detail');
      df.setColor(brighten(shC, 1.12, .01));
      for (const [py0, py1] of [[.08, wh * .4], [wh * .46, wh - .08]]) {
        const pwid = pw - .14, phh = py1 - py0;
        df.geometry(T0.diamond, mul(T(cx, (py0 + py1) / 2, 0), S(Math.min(pwid * .55, phh * .45), Math.min(phh * .55, pwid * .9), 1)));
      }
      const hg = ctx.b('darkMetal', at(x, y0, zz + .02), 'detail');
      hg.setColor([1.2, 1.2, 1.2]);
      const hx = closed ? side * (ww / 2 - .12) : side * (ww / 2 + .2);
      for (const hy of [wh * .18, wh * .82]) hg.box(.2, .035, .01, hx, hy, 0);
    }
  } else if (sh && shutters && sh.type === 'roller') {
    const rc = lin(sh.color);
    const box = ctx.b('painted', at(x, y0, surf + .1));
    box.setColor(rc);
    box.box(ww + .16, .2, .2, 0, wh + .1, 0);
    box.box(.04, wh, .05, -ww / 2 - .04, wh / 2, -.06); box.box(.04, wh, .05, ww / 2 + .04, wh / 2, -.06);
    if (sh.closed) {
      const r = ctx.b('roller', at(x, y0, surf + .045));
      r.setColor(rc);
      r.box(ww + .06, wh, .02, 0, wh / 2, 0);
    }
  }
}

function doorAt(ctx, frameM, x, w, h, spec, { surf, log, random }) {
  const at = (lx, ly, lz) => mul(frameM, T(lx, ly, lz));
  const dz = log ? -.02 : surf - .04;
  const d = ctx.b('logs', at(x, 0, dz));
  d.setColor(lin(spec.door));
  d.box(w, h, .05, 0, h / 2, 0, { uo: random() * 3 });
  const t = ctx.b('painted', at(x, 0, (dz + surf) / 2));
  t.setColor(lin(spec.windows.nalichnik?.color ?? spec.windows.frame));
  const depth = surf - dz + .02;
  t.box(.1, h + .1, depth, -w / 2 - .05, h / 2, 0); t.box(.1, h + .1, depth, w / 2 + .05, h / 2, 0);
  t.box(w + .2, .12, depth, 0, h + .06, 0);
}

// ------------------------------------------------------------------ roof ----

function buildRoof(ctx, spec, rg, deco, random) {
  const map = q => ridgeToHouse(spec.roof.ridge, q);
  const roofKey = `roof-${spec.roof.material}`, tint = lin(spec.roof.color);
  const t = .05, T0 = trimTemplates();
  const fasciaC = deco.trim, soffitC = [.12, .1, .085];
  for (const s of rg.slopes) {
    let pts = s.pts.map(map);
    const eave = map(s.eave), down = map(s.down), o = map(s.eaveA);
    let n = newell(pts);
    if (n[1] < 0) { pts = pts.reverse(); n = scl(n, -1); }
    const uvOf = q => [dot(sub(q, o), eave), -dot(sub(q, o), down)];
    const top = pts.map(q => add(q, scl(n, t)));
    const b = ctx.b(roofKey);
    b.setColor(tint);
    fan(b, top, top.map(uvOf), n);
    const centre = pts.reduce((a, q) => add(a, scl(q, 1 / pts.length)), [0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const mid = scl(add(a, c), .5), outv = sub(mid, centre);
      fan(b, [a, c, top[(i + 1) % pts.length], top[i]], [[0, 0], [1, 0], [1, .05], [0, .05]], outv, .8);
    }
    const so = ctx.b('logs');
    so.setColor(soffitC);
    fan(so, pts, pts.map(uvOf), scl(n, -1));
    if (!season.summer && n[1] > .28) {
      // Steep slopes (mansard) hold only a thin crust of first snow.
      const st = n[1] > .55 ? .13 + random() * .06 : .045;
      const sn = pts.map(q => add(add(q, scl(sub(centre, q), .025)), scl(n, t + st)));
      const base = pts.map(q => add(add(q, scl(sub(centre, q), .02)), scl(n, t)));
      const sb = ctx.b('snow');
      sb.setColor([1, 1, 1]);
      fan(sb, sn, sn.map(uvOf), n);
      for (let i = 0; i < sn.length; i++) {
        const j = (i + 1) % sn.length, mid = scl(add(base[i], base[j]), .5);
        fan(sb, [base[i], base[j], sn[j], sn[i]], [[0, 0], [1, 0], [1, .1], [0, .1]], sub(mid, centre));
      }
    }
  }
  // Fascia boards along the eaves; carved valance (подзор) under them on decorated houses.
  for (const e of rg.eaves) {
    if (e.short) continue;
    const a = map(e.a), c = map(e.b), out = map(e.out), len = Math.hypot(...sub(c, a));
    let X = unit(sub(c, a));
    if (dot(cross(X, [0, 1, 0]), out) < 0) X = scl(X, -1);
    const mid = add(scl(add(a, c), .5), [0, -.07, 0]);
    const f = ctx.b('painted', basis(V3(add(mid, scl(out, -.005))), V3(X), new THREE.Vector3(0, 1, 0)));
    f.setColor(fasciaC);
    f.box(len, .19, .03);
    if (deco.frieze) {
      const start = add(add(mid, scl(X, -len / 2)), [0, -.07, 0]);
      const v = ctx.b('painted', basis(V3(add(start, scl(out, .01))), V3(X), new THREE.Vector3(0, 1, 0)), 'detail');
      v.setColor(fasciaC);
      v.geometry(T0.rake, S(len, .9, 1));
    }
  }
  // Rake (verge) boards: carved причелины on decorated houses, plain boards otherwise.
  for (const r of rg.rakes) {
    const a = map(r.a), c = map(r.b), len = Math.hypot(...sub(c, a));
    const xPlane = Math.abs(Math.abs(r.a[0]) - Math.abs(r.b[0])) < 1e-3 && Math.abs(r.a[0]) > .1;
    const N = xPlane ? map([Math.sign(r.a[0]), 0, 0]) : map([0, 0, Math.sign(r.a[2] || 1)]);
    const X = unit(sub(c, a));
    let Yd = unit(cross(N, X));
    if (Yd[1] > 0) Yd = scl(Yd, -1);
    const origin = add(add(a, scl(N, .025)), scl(Yd, -.07));
    const rb = ctx.b('painted', basis(V3(origin), V3(X), V3(scl(Yd, -1))), deco.carvedRakes ? 'detail' : 'near');
    rb.setColor(deco.rake);
    if (deco.carvedRakes) {
      rb.geometry(T0.rake, S(len, 1.25, 1));
      const fb = ctx.b('painted', basis(V3(origin), V3(X), V3(scl(Yd, -1))), 'far');
      fb.setColor(deco.rake);
      fb.box(len, .2, .03, len / 2, -.1, 0);
    } else rb.box(len, .24, .035, len / 2, -.1, 0);
  }
  // Ridge and hip caps.
  for (const [a0, b0] of rg.ridges) {
    const a = map(a0), c = map(b0), len = Math.hypot(...sub(c, a));
    const cap = ctx.b(roofKey, basis(V3(add(scl(add(a, c), .5), [0, t + .03, 0])), V3(unit(sub(c, a))), new THREE.Vector3(0, 1, 0)));
    cap.setColor(tint.map(v => v * .82));
    cap.box(len + .04, .06, .32);
  }
  for (const [a0, b0] of rg.hips) {
    const a = map(a0), c = map(b0), len = Math.hypot(...sub(c, a)), X = unit(sub(c, a));
    const up = unit(sub([0, 1, 0], scl(X, X[1])));
    const cap = ctx.b(roofKey, basis(V3(add(scl(add(a, c), .5), scl(up, t + .03))), V3(X), V3(up)));
    cap.setColor(tint.map(v => v * .82));
    cap.box(len, .05, .24);
  }
}

// Gable walls: boards (vertical, horizontal or sunburst) over a dark backing, a cornice
// shelf at the gable base (arched on the "curved eave" gables of the old houses).
function buildGables(ctx, spec, rg, deco, surfOff, random) {
  const map = q => ridgeToHouse(spec.roof.ridge, q);
  const r = spec.roof, gTint = woodTint(r.gableColor), mat = r.gableFinish === 'siding' ? 'siding' : woodMat(r.gableColor);
  for (const gw of rg.gableWalls) {
    const N = gw.axis === 'x' ? map([gw.outward, 0, 0]) : map([0, 0, gw.outward]);
    const toWorld = (c, y, off) => (gw.axis === 'x' ? map([gw.at + gw.outward * off, y, c]) : map([c, y, gw.at + gw.outward * off]));
    const street = N[2] > .7;
    if (r.gableFinish === 'siding' || (spec.wall.material !== 'log' && spec.wall.material !== 'planks' && r.gableFinish !== 'planks')) {
      const b = ctx.b(mat);
      b.setColor(gTint);
      fan(b, gw.poly.map(([c, y]) => toWorld(c, y, surfOff)), gw.poly.map(([c, y]) => [c, y]), N);
    } else {
      const back = ctx.b(mat);
      back.setColor(gTint.map(v => v * .35));
      fan(back, gw.poly.map(([c, y]) => toWorld(c, y, surfOff - .004)), gw.poly.map(([c, y]) => [c, y]), N);
      const pattern = r.gableFinish === 'log' ? 'horizontal' : (street ? r.gableBoards : (r.gableBoards === 'sunburst' ? 'vertical' : r.gableBoards));
      const boards = boardPolygons(gw.poly, { pattern, board: r.gableFinish === 'log' ? .2 : .135 });
      const b = ctx.b(mat);
      for (const { poly, index, angle, disc } of boards) {
        b.setColor(disc ? brighten(gTint, 1.25) : jitter(gTint, random, .06));
        const off = surfOff + (disc ? .03 : index % 2 ? .014 : .006);
        const ca = Math.cos(angle), sa = Math.sin(angle);
        // uv: v along the board (wood grain), u across it.
        fan(b, poly.map(([c, y]) => toWorld(c, y, off)), poly.map(([c, y]) => [-c * sa + y * ca + index * .37, c * ca + y * sa]), N);
      }
      // Trim boards framing the sheathing: along both rakes inside the gable, a base board,
      // and a centre board where diagonal boards meet.
      const tr = ctx.b('painted');
      tr.setColor(deco.trim);
      const cen = gw.poly.reduce((a, q) => [a[0] + q[0] / gw.poly.length, a[1] + q[1] / gw.poly.length], [0, 0]);
      for (let i = 0; i < gw.poly.length; i++) {
        const A = gw.poly[i], Bp = gw.poly[(i + 1) % gw.poly.length];
        const dx = Bp[0] - A[0], dy = Bp[1] - A[1], L = Math.hypot(dx, dy);
        if (L < .3) continue;
        let nx = -dy / L, ny = dx / L;
        if ((cen[0] - A[0]) * nx + (cen[1] - A[1]) * ny < 0) { nx = -nx; ny = -ny; }
        const wd = Math.abs(dy) < 1e-3 ? .12 : .14, o2 = surfOff + .03;
        const q = [A, Bp, [Bp[0] + nx * wd, Bp[1] + ny * wd], [A[0] + nx * wd, A[1] + ny * wd]];
        fan(tr, q.map(([c, y]) => toWorld(c, y, o2)), q.map(([c, y]) => [c, y]), N);
      }
      if (pattern === 'chevron') {
        const top = Math.max(...gw.poly.map(q => q[1])), y0 = Math.min(...gw.poly.map(q => q[1]));
        const q = [[-.06, y0], [.06, y0], [.06, top - .1], [-.06, top - .1]];
        fan(tr, q.map(([c, y]) => toWorld(c, y, surfOff + .03)), q.map(([c, y]) => [c, y]), N);
      }
      // Towel board (полотенце) hanging under the apex of a carved street gable.
      if (street && deco.carvedRakes && rg.shape !== 'shed') {
        const top = Math.max(...gw.poly.map(q => q[1]));
        const T0 = trimTemplates();
        const tw = ctx.b('painted', basis(V3(toWorld(0, top - .06, surfOff + .045)), V3([N[2], 0, -N[0]]), new THREE.Vector3(0, 1, 0)), 'detail');
        tw.setColor(deco.rake);
        tw.geometry(T0.towel, S(1.3, 1.3, 1));
      }
    }
    // Cornice shelf at the gable base (street gable and every gable of a log house).
    if (gw.axis === 'x' && (street || spec.wall.material === 'log') && rg.shape !== 'shed' && spec.wall.material !== 'siding') {
      const hs = rg.S / 2, y0 = rg.y0, archH = street && r.gableArch ? Math.min(1.1, rg.rise * .36) : 0;
      const proj = .3, n = archH ? 18 : 1, pts = [];
      for (let i = 0; i <= n; i++) {
        const c = -hs - .15 + (2 * hs + .3) * i / n, k = Math.abs(c) / (hs * .78);
        pts.push([c, y0 + .02 + (archH && k < 1 ? archH * Math.sqrt(1 - k * k) : 0)]);
      }
      const front = ctx.b('painted'), soff = ctx.b('logs');
      front.setColor(deco.trim); soff.setColor([.13, .11, .09]);
      for (let i = 0; i < pts.length - 1; i++) {
        const [c0, y0a] = pts[i], [c1, y1a] = pts[i + 1];
        const fo = surfOff + proj;
        fan(front, [toWorld(c0, y0a - .2, fo), toWorld(c1, y1a - .2, fo), toWorld(c1, y1a, fo), toWorld(c0, y0a, fo)], [[c0, 0], [c1, 0], [c1, .2], [c0, .2]], N);
        fan(soff, [toWorld(c0, y0a - .2, surfOff), toWorld(c1, y1a - .2, surfOff), toWorld(c1, y1a - .2, fo), toWorld(c0, y0a - .2, fo)], [[c0, 0], [c1, 0], [c1, .3], [c0, .3]], [0, -1, 0]);
        fan(front, [toWorld(c0, y0a, surfOff), toWorld(c0, y0a, fo), toWorld(c1, y1a, fo), toWorld(c1, y1a, surfOff)], [[c0, 0], [c0, .3], [c1, .3], [c1, 0]], [0, 1, 0]);
      }
      if (deco.frieze || archH) {
        // Scalloped valance hanging under the cornice.
        const T0 = trimTemplates();
        for (let i = 0; i < pts.length - 1; i++) {
          const a = toWorld(pts[i][0], pts[i][1] - .2, surfOff + proj + .01), c = toWorld(pts[i + 1][0], pts[i + 1][1] - .2, surfOff + proj + .01);
          const len = Math.hypot(...sub(c, a));
          const X = unit(sub(c, a));
          let up = unit(cross(N, X));
          if (up[1] < 0) up = scl(up, -1);
          const v = ctx.b('painted', basis(V3(a), V3(X), V3(up)), 'detail');
          v.setColor(deco.trim);
          v.geometry(T0.rake, S(len, .8, 1));
        }
      }
    }
  }
}

// Small dormer on a side slope (house 45: on the west slope near the street): a vertical
// window face standing on the slope, siding cheeks, a little gable cap.
function dormer(ctx, spec, rg, dm, deco, random) {
  const side = dm.side === 'right' ? 1 : -1, ridgeAlongZ = spec.roof.ridge === 'perpendicular';
  if (!ridgeAlongZ) return;
  const { w, d } = spec, y0 = spec.wallH + .08;
  const zc = ((dm.at ?? .8) - .5) * d, half = (dm.widthM ?? .9) / 2, hgt = dm.heightM ?? 1.25;
  const pitch = spec.roof.pitchDeg * Math.PI / 180, inset = 1 / Math.tan(pitch);
  const xFace = side * (w / 2 - .02), yb = y0 + .3, yt = yb + hgt;
  const xIn = side * (w / 2 - (yt - y0) * inset - .25);
  const wall = ctx.b(spec.roof.gableFinish === 'siding' ? 'siding' : 'painted');
  wall.setColor(lin(spec.roof.gableColor));
  const out = [side, 0, 0];
  fan(wall, [[xFace, yb, zc - half], [xFace, yb, zc + half], [xFace, yt, zc + half], [xFace, yt, zc - half]], [[0, yb], [1, yb], [1, yt], [0, yt]], out);
  for (const sz of [-1, 1]) fan(wall, [[xFace, yb, zc + sz * half], [xFace, yt, zc + sz * half], [xIn, yt, zc + sz * half]], [[0, yb], [0, yt], [1, yt]], [0, 0, sz]);
  const cap = ctx.b(`roof-${spec.roof.material}`);
  cap.setColor(lin(spec.roof.color));
  const ya = yt + .32;
  for (const sz of [-1, 1]) {
    const a = [xFace + side * .12, yt - .05, zc + sz * (half + .12)], b = [xIn, yt - .05, zc + sz * (half + .12)], c = [xIn, ya, zc], e = [xFace + side * .12, ya, zc];
    fan(cap, [a, b, c, e], [[0, 0], [1, 0], [1, .6], [0, .6]], [0, 1, sz]);
  }
  const frameM = mul(T(xFace, 0, zc), RY(side > 0 ? Math.PI / 2 : -Math.PI / 2));
  kitWindow(ctx, frameM, 0, yb + .22, half * 1.2, hgt - .42, { ...spec, windows: { ...spec.windows, shutters: null, nalichnik: null } }, { surf: .01, log: false, lit: 0, random, cut: false });
  void deco;
}

function chimney(ctx, spec, rg, random) {
  const { L } = rg;
  const pos = ridgeToHouse(spec.roof.ridge, [-L * .18 + (random() - .5) * L * .1, 0, .45]);
  const x = pos[0], z = pos[2], y0 = spec.wallH - .3, top = rg.ridgeY + .6 + random() * .2;
  const b = ctx.b('brick');
  b.setColor(jitter(lin('#8f4f3c'), random, .08));
  b.box(.52, top - y0, .52, x, (top + y0) / 2, z, { uo: random() * 2, vo: random() * 2 });
  b.box(.62, .09, .62, x, top - .1, z, { faces: ['px', 'nx', 'pz', 'nz', 'ny', 'py'] });
  const cap = ctx.b('darkMetal', null, 'detail');
  cap.setColor([1.6, 1.6, 1.6]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cap.box(.03, .22, .03, x + sx * .22, top + .11, z + sz * .22);
  const hood = ctx.b('darkMetal');
  hood.setColor([1.8, 1.8, 1.8]);
  hood.box(.68, .03, .68, x, top + .24, z);
  return new THREE.Vector3(x, top + .35, z).applyMatrix4(ctx.M).toArray();
}

// Lower annex: a glazed veranda (small panes) or a closed plank annex, shed roof against the house.
function annex(ctx, spec, a, deco, random, gsMin) {
  const { x0, x1, z0, z1, glazed, outward } = a;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, H = 2.3;
  const wallC = lin(a.color ?? spec.roof.gableColor), mat = woodMat(a.color ?? spec.roof.gableColor);
  const pl = ctx.b('concrete');
  pl.setColor([1, 1, 1]);
  pl.box(w + .06, .02 - gsMin + .3, d + .06, cx, (gsMin - .3 + .02) / 2, cz, { faces: ['px', 'nx', 'pz', 'nz', 'py'] });
  const body = ctx.b(mat);
  body.setColor(wallC);
  const lower = glazed ? .9 : H;
  body.box(w, lower, d, cx, lower / 2, cz, { faces: ['px', 'nx', 'pz', 'nz'] });
  if (glazed) {
    body.box(w, .3, d, cx, H - .15, cz, { faces: ['px', 'nx', 'pz', 'nz'] });
    const gl = ctx.b('kitGlass');
    const faces = [[[cx, cz + d / 2], [1, 0], [0, 1], w], [[cx, cz - d / 2], [-1, 0], [0, -1], w], [[cx + w / 2, cz], [0, -1], [1, 0], d], [[cx - w / 2, cz], [0, 1], [-1, 0], d]];
    for (const [[fx, fz], [ux, uz], [nx, nz], L] of faces) {
      if (nx === -outward[0] && nz === -outward[1]) continue; // the face against the house
      const n = Math.max(2, Math.round(L / .55));
      gl.setColor([0, random(), 0]);
      const p = (s, y, o = 0) => [fx + ux * s + nx * o, y, fz + uz * s + nz * o];
      gl.quad([p(-L / 2, .92, -.03), p(L / 2, .92, -.03), p(L / 2, H - .3, -.03), p(-L / 2, H - .3, -.03)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      const bars = ctx.b('painted', mul(T(fx, 0, fz), RY(Math.atan2(nx, nz))));
      bars.setColor(deco.glazing);
      for (let i = 0; i <= n; i++) bars.box(.05, H - 1.2, .05, -L / 2 + L * i / n, .9 + (H - 1.2) / 2, 0);
      bars.box(L, .05, .05, 0, 1.5, 0);
      bars.box(L, .06, .08, 0, .92, .01);
    }
  }
  // Shed roof falling away from the house.
  const yHigh = Math.min(spec.wallH - .05, H + .7), yLow = H + .02, ov = .3;
  const ox = outward[0], oz = outward[1];
  const corners = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = cx + sx * (w / 2 + ov), pz = cz + sz * (d / 2 + ov);
    const along = ((px - cx) * ox + (pz - cz) * oz) / ((ox ? w : d) / 2 + ov);
    corners.push([px, yHigh + (yLow - yHigh) * (along + 1) / 2 - (along > 0 ? .05 : 0), pz]);
  }
  const key = `roof-${spec.roof.material}`, tint = lin(spec.roof.color);
  const rb = ctx.b(key);
  rb.setColor(tint);
  const eave = ox ? [0, 0, 1] : [1, 0, 0];
  const top = corners.map(q => add(q, [0, .05, 0]));
  fan(rb, top, top.map(q => [dot(q, eave), q[1] * 1.4 + (q[0] * ox + q[2] * oz) * -1]), [0, 1, 0]);
  const so = ctx.b('logs');
  so.setColor([.12, .1, .085]);
  fan(so, corners, corners.map(q => [q[0], q[2]]), [0, -1, 0]);
  // Gable-like triangles closing the gap under the sloping roof on the side faces.
  return { H };
}

// ----------------------------------------------------------------- house ----

export function buildKitHouse(B, ground, plot) {
  const p = plot.passport, spec = resolveHouse(p);
  const random = randomGenerator(hashString(p.id) ^ 0x51ed);
  const { frame } = plot, angle = frame.angle;
  const { w, d } = spec;
  const pre = context(B, frame.x, frame.z, 0, angle);
  const gs = groundStats(pre, ground, w, d);
  const base = gs.max + spec.basement;
  const ctx = context(B, frame.x, frame.z, base, angle);
  const gsMin = gs.min - base;
  spec.door = pick(random, ['#5d4532', '#6b4b33', '#4f5d4a', '#7a5a3c']);
  const frames = wallFrames(w, d);
  const log = spec.wall.material === 'log';
  const nal = spec.windows.nalichnik;
  // Roof trim (fascia, cornice, carved valance, rakes): the passport trim colour, else the
  // gable boards a shade lighter (plain houses) or the наличник colour (frieze houses).
  const gableTrim = brighten(lin(spec.roof.gableColor), 1.15);
  const trim = spec.roof.trimColor ? lin(spec.roof.trimColor) : spec.roof.frieze && nal ? lin(nal.color) : gableTrim;
  const deco = {
    trim, glazing: nal ? lin(nal.color) : lin(spec.windows.frame),
    rake: spec.roof.trimColor || spec.roof.frieze ? trim : brighten(lin(spec.roof.gableColor), .82),
    carvedRakes: !!spec.roof.frieze,
    frieze: spec.roof.frieze,
  };
  const crown = hashString(p.id) % 4;

  // Openings. Street windows: lower row (plus an upper one in the street gable for 1.5 floors).
  const W = spec.windows, ww = W.width, wh = W.height, sill = W.sill;
  const openings = { front: [], back: [], left: [], right: [] }, wins = [];
  const upperStreet = spec.floors >= 1.5 && spec.floors < 2 && spec.roof.ridge === 'perpendicular' ? 1 : 0;
  const lowerStreet = Math.max(1, W.street - upperStreet - (spec.floors >= 2 ? Math.floor(W.street / 2) : 0));
  const addWin = (name, xs, y0, hh = wh, wdt = ww, kind = 'window') => xs.forEach(x => {
    openings[name].push({ x0: x - wdt / 2 - .05, x1: x + wdt / 2 + .05, y0: y0 - .05, y1: y0 + hh + .05 });
    wins.push({ name, x, y0, hh, wdt, kind });
  });
  addWin('front', windowSlots(w, lowerStreet, ww), sill);
  if (spec.floors >= 2) addWin('front', windowSlots(w, Math.floor(W.street / 2), ww), sill + 2.75);
  const yardSide = plot.yardSide ?? 1;
  const doorWall = spec.porch?.side === 'front' ? 'front' : (spec.porch?.side === 'left' ? 'left' : spec.porch?.side === 'right' ? 'right' : (yardSide > 0 ? 'right' : 'left'));
  // Wall-local x of the door: near the back on a side wall.
  const doorX = doorWall === 'front' ? (yardSide * (w / 2 - .9)) : doorWall === 'right' ? d / 2 - 1.1 : -d / 2 + 1.1;
  const veranda = spec.veranda || spec.annex;
  for (const name of ['left', 'right']) {
    const avoid = name === doorWall ? [[doorX - .7, doorX + .7]] : [];
    addWin(name, windowSlots(d, W.side, ww, { avoid }), sill);
    if (spec.floors >= 2) addWin(name, windowSlots(d, W.side, ww), sill + 2.75);
  }
  if (w > 7) addWin('back', windowSlots(w, 1, ww), sill);
  const annexSide = spec.annex?.side === 'right' ? 'right' : spec.annex?.side === 'left' ? 'left' : (yardSide > 0 ? 'right' : 'left');
  const hasDoor = !(veranda && doorWall === annexSide);
  if (hasDoor) openings[doorWall].push({ x0: doorX - .5, x1: doorX + .5, y0: -.1, y1: 2.0 });

  // Plinth (цоколь) from below the lowest ground point to the floor.
  const pl = ctx.b('concrete');
  pl.setColor(spec.plinthColor ? lin(spec.plinthColor).map(v => v / .58) : [1, 1, 1]);
  const pw = log ? w + .1 : w + .08, pd = log ? d + .1 : d + .08;
  pl.box(pw, .04 - gsMin + .3, pd, 0, (gsMin - .3 + .04) / 2, 0, { faces: ['px', 'nx', 'pz', 'nz', 'py'] });

  const m = spec.wall.material;
  const wallInfo = m === 'log' ? logWalls(ctx, spec, openings, random)
    : m === 'planks' ? boardWalls(ctx, spec, openings, random, spec.wallH)
      : boxWalls(ctx, spec, spec.wallH, m === 'siding' ? 'siding' : m === 'brick' ? 'brick' : 'concrete');
  spec.wallH = wallInfo.H;
  const surf = wallInfo.surf;

  for (const win of wins) {
    const lit = random() < .6 ? .5 + random() * .5 : 0;
    kitWindow(ctx, frames[win.name].m, win.x, win.y0, win.wdt, win.hh, spec, { surf, log, lit, random, crown, shutters: win.name !== 'back', cut: m === 'log' || m === 'planks' });
  }
  if (hasDoor) doorAt(ctx, frames[doorWall].m, doorX, .9, 1.95, spec, { surf, log, random });

  // Roof, gables, upper window in the street gable, chimney.
  const rg = roofGeometry(spec);
  buildRoof(ctx, spec, rg, deco, random);
  buildGables(ctx, spec, rg, deco, log ? surf * .9 : surf, random);
  if (upperStreet) {
    const uh = 1.05, uw = Math.min(1.25, w * .2), y0 = spec.wallH + .65;
    kitWindow(ctx, mul(frames.front.m, T(0, 0, 0)), 0, y0, uw, uh, { ...spec, windows: { ...W, shutters: null } }, { surf, log: false, lit: random() < .3 ? .6 : 0, random, crown, cut: false });
  }
  const chimneyTop = spec.chimney ? chimney(ctx, spec, rg, random) : null;
  for (const dm of spec.roof.dormers || []) dormer(ctx, spec, rg, dm, deco, random);

  // Veranda / annex on the yard side.
  const extraRects = [];
  const af = annexFootprint(spec, yardSide);
  if (af) {
    const { x0, x1, z0, z1, glazed, side } = af;
    annex(ctx, spec, { x0, x1, z0, z1, glazed, outward: [side, 0], color: spec.annex?.color }, deco, random, gsMin);
    const [ax, az] = frame.world((x0 + x1) / 2, (z0 + z1) / 2);
    extraRects.push({ x: ax, z: az, w: af.w, d: af.d, angle, kind: 'annex', id: `${p.id}-annex` });
  }
  if (spec.porch) porch(ctx, ground, spec, frames[doorWall].m, doorWall, doorX, surf, deco, random);
  const top = new THREE.Vector3(0, rg.ridgeY + .9, 0).applyMatrix4(ctx.M);
  return { base, height: rg.ridgeY, chimneyTop, smoke: !!chimneyTop && random() < .75, extraRects, top: top.toArray(), spec };
}

function pick(random, list) { return list[Math.floor(random() * list.length) % list.length]; }

// Porch (крыльцо): a plank deck at floor level on a boarded skirt, solid steps down to the
// ground in front, a balustrade (flat balusters, handrail) on the deck sides and down the
// stairs, and on roofed porches a small gable canopy on two turned posts with a boarded pediment.
function porch(ctx, ground, spec, frameM, wallName, doorX, surf, deco, random) {
  const at = (lx, ly, lz) => mul(frameM, T(lx, ly, lz));
  const Wd = 1.7, D = 1.35, tread = .28;
  const foot = new THREE.Vector3(doorX, 0, surf + D + .6).applyMatrix4(mul(ctx.M, frameM));
  const rise = Math.min(1.4, Math.max(.2, foot.y - ground(foot.x, foot.z)));
  const n = Math.max(2, Math.round(rise / .18));
  const wood = ctx.b('logs', at(doorX, 0, surf));
  const deck = lin('#6f5c47');
  wood.setColor(deck);
  wood.box(Wd, .07, D, 0, -.035, D / 2, { uo: random() });
  wood.setColor(deck.map(v => v * .8));
  wood.box(Wd - .04, rise + .2, .03, 0, -(rise + .2) / 2 - .07, D - .03, { faces: ['pz'] });
  for (const sx of [-1, 1]) wood.box(.03, rise + .2, D, sx * (Wd / 2 - .03), -(rise + .2) / 2 - .07, D / 2, { faces: [sx > 0 ? 'px' : 'nx'] });
  const sw = 1.2;
  for (let k = 1; k < n; k++) {
    const top = -rise * k / n, z0 = D + (k - 1) * tread;
    wood.setColor(jitter(deck, random, .06));
    wood.box(sw, .05, tread + .03, 0, top - .025, z0 + tread / 2 + .015, { uo: random() * 3 });
    wood.setColor(deck.map(v => v * .7));
    wood.box(sw - .02, rise / n, .025, 0, top + rise / n / 2 - .05, z0 + .012, { faces: ['pz'] });
    wood.box(sw, top + rise + .1, tread, 0, (top - rise - .1) / 2 - .05, z0 + tread / 2, { faces: ['px', 'nx'] });
  }
  // Balustrade: flat sawn balusters between a bottom rail and a handrail.
  const rl = ctx.b('painted', at(doorX, 0, surf));
  rl.setColor(deco.trim);
  const runZ = (n - 1) * tread;
  for (const sx of [-1, 1]) {
    const x = sx * (Wd / 2 - .05);
    rl.box(.07, .05, D - .1, x, .9, D / 2 - .05); rl.box(.05, .05, D - .1, x, .08, D / 2 - .05);
    for (let z = .12; z < D - .1; z += .13) rl.box(.025, .8, .09, x, .48, z);
    rl.box(.1, 1.0, .1, x, .45, D - .05);
    if (runZ > .2) {
      // Sloped handrail and balusters down the stairs, outside the treads.
      const xs = sx * (sw / 2 + .05), ang = Math.atan2(rise * (n - 1) / n, runZ), len = Math.hypot(runZ, rise * (n - 1) / n);
      const hr = ctx.b('painted', mul(at(doorX + xs, .9, surf + D), new THREE.Matrix4().makeRotationX(ang)));
      hr.setColor(deco.trim);
      hr.box(.06, .05, len, 0, 0, len / 2);
      for (let k = 1; k < n; k++) rl.box(.025, .8, .09, xs, -rise * k / n + .45, D + (k - .5) * tread);
      rl.box(.09, 1.0, .09, xs, -rise * (n - 1) / n + .45 - .05, D + runZ - .05);
    }
  }
  if (spec.porch.roofed) {
    const H = 2.35, pz = D - .08, rw = Wd + .45, pitch = .62, rs = rw / 2 / Math.cos(pitch);
    const t = ctx.b('painted', at(doorX, 0, surf));
    t.setColor(deco.trim);
    for (const sx of [-1, 1]) {
      const x = sx * (Wd / 2 - .05);
      t.box(.11, H, .11, x, H / 2 - .02, pz);
      t.box(.16, .08, .16, x, H - .1, pz); t.box(.15, .06, .15, x, .95, pz);
      t.box(.07, .07, pz + .1, x, H - .02, pz / 2);
    }
    t.box(Wd + .1, .14, .1, 0, H - .02, pz);
    const ry = H + .06, apex = ry + Math.tan(pitch) * rw / 2, len = D + .45;
    const roofM = `roof-${spec.roof.material}`;
    for (const sx of [-1, 1]) {
      const r = ctx.b(roofM, mul(at(doorX + sx * rw / 4, (ry + apex) / 2, surf + len / 2), new THREE.Matrix4().makeRotationZ(-sx * pitch)));
      r.setColor(lin(spec.roof.color));
      r.box(rs + .04, .04, len, 0, 0, 0, { faces: ['py', 'ny', 'pz', 'px', 'nx'] });
    }
    // Boarded pediment (фронтон) under the canopy, with a carved board on decorated houses.
    const pd = ctx.b(woodMat(spec.roof.gableColor), at(doorX, 0, surf + pz + .06));
    pd.setColor(woodTint(spec.roof.gableColor));
    fan(pd, [[-Wd / 2 - .1, ry, 0], [Wd / 2 + .1, ry, 0], [0, apex - .06, 0]], [[0, 0], [1, 0], [.5, 1]], [0, 0, 1]);
    if (!season.summer) {
      for (const sx of [-1, 1]) {
        const sn = ctx.b('snow', mul(at(doorX + sx * rw / 4, (ry + apex) / 2 + .07, surf + len / 2), new THREE.Matrix4().makeRotationZ(-sx * pitch)));
        sn.setColor([1, 1, 1]); sn.box(rs - .05, .08, len - .06);
      }
    }
  }
  void wallName;
}

// --------------------------------------------------------- outbuildings ----

// Sheds, garages, barns and banyas from passport outbuildings: vertical-board walls in the
// observed colour, single-slope or gable roof of grey slate / corrugated sheet.
export function buildKitOutbuilding(B, ground, r) {
  const random = randomGenerator(r.seed || 7);
  const pre = context(B, r.x, r.z, 0, r.angle);
  const gs = groundStats(pre, ground, r.w, r.d);
  const base = gs.max + .1;
  const ctx = context(B, r.x, r.z, base, r.angle);
  const { w, d } = r, H = r.kind === 'barn' ? 3 : r.kind === 'garage' ? 2.5 : 2.2;
  // Garages: weathered board walls, the observed colour is the doors.
  const wallHex = r.kind === 'garage' && !isRawWood(r.color) ? '#7a6a55' : r.color;
  const tint = woodTint(wallHex), mat = woodMat(wallHex);
  const pl = ctx.b('concrete');
  pl.setColor([1, 1, 1]);
  pl.box(w + .04, .06 - (gs.min - base) + .2, d + .04, 0, (gs.min - base - .2 + .06) / 2, 0, { faces: ['px', 'nx', 'pz', 'nz', 'py'] });
  const core = ctx.b(mat);
  core.setColor(tint.map(v => v * .5));
  core.box(w, H, d, 0, H / 2, 0, { faces: ['px', 'nx', 'pz', 'nz'] });
  // Vertical boards with small gaps and uneven tops.
  for (const [, f] of Object.entries(wallFrames(w, d))) {
    const b = ctx.b(mat, f.m);
    for (let x = -f.L / 2; x < f.L / 2 - .02; x += .17) {
      const bw = Math.min(.155, f.L / 2 - x);
      b.setColor(jitter(tint, random, .09));
      b.box(bw, H, .025, x + bw / 2, H / 2, .014, { uo: random() * 4 });
    }
  }
  const frames = wallFrames(w, d);
  const doorC = lin(r.kind === 'garage' ? r.color : '#5b4a3a').map(v => v * .9);
  if (r.kind === 'garage' || r.kind === 'barn') {
    const gw = Math.min(w - .5, 2.8), gh = H - .3;
    const g = ctx.b('painted', frames.front.m);
    g.setColor(doorC);
    for (const s of [-1, 1]) g.box(gw / 2 - .02, gh, .05, s * gw / 4, gh / 2, .05);
  } else {
    const g = ctx.b(mat, frames.front.m);
    g.setColor(doorC);
    g.box(.85, 1.85, .05, (random() - .5) * Math.max(0, w - 1.4), .93, .05);
  }
  const roofMat = random() < .5 ? 'roof-slate' : 'roof-corrugated', roofC = lin(random() < .5 ? '#a9aaa6' : '#b9b8b2');
  const spec = { w, d, wallH: H, roof: { shape: r.roof === 'gable' ? 'gable' : 'shed', ridge: w >= d ? 'parallel' : 'perpendicular', pitchDeg: r.roof === 'gable' ? 26 : 12, material: roofMat.slice(5), color: '#000000', overhang: .3 } };
  const rg = roofGeometry(spec);
  const map = q => ridgeToHouse(spec.roof.ridge, q);
  for (const s of rg.slopes) {
    let pts = s.pts.map(map);
    const eave = map(s.eave), down = map(s.down), o = map(s.eaveA);
    let n = newell(pts);
    if (n[1] < 0) { pts = pts.reverse(); n = scl(n, -1); }
    const top = pts.map(q => add(q, scl(n, .04)));
    const b = ctx.b(roofMat);
    b.setColor(roofC);
    fan(b, top, top.map(q => [dot(sub(q, o), eave), -dot(sub(q, o), down)]), n);
    const so = ctx.b('logs');
    so.setColor([.12, .1, .085]);
    fan(so, pts, pts.map(q => [q[0], q[2]]), scl(n, -1));
    if (!season.summer && n[1] > .55) {
      const sb = ctx.b('snow');
      sb.setColor([1, 1, 1]);
      fan(sb, top.map(q => add(q, scl(n, .13))), top.map(q => [q[0], q[2]]), n);
    }
  }
  for (const gw of rg.gableWalls) {
    const N = gw.axis === 'x' ? map([gw.outward, 0, 0]) : map([0, 0, gw.outward]);
    const toW = (c, y) => (gw.axis === 'x' ? map([gw.at + gw.outward * .02, y, c]) : map([c, y, gw.at + gw.outward * .02]));
    const b = ctx.b(mat);
    b.setColor(tint);
    fan(b, gw.poly.map(([c, y]) => toW(c, y)), gw.poly.map(([c, y]) => [c, y]), N);
  }
  return { base, height: rg.ridgeY };
}
