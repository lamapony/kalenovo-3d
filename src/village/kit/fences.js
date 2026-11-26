// Main-street fences from passports: штакетник (pointed pickets), сплошной plank fence,
// профнастил (real trapezoid ribs on steel posts), painted stripe boards, diamond lattice,
// chain-link mesh, metal rails, decorative concrete panels; double/swing gates and wickets,
// optionally roofed. Merged into the shared TiledBuilders; every piece follows the ground.
import * as THREE from 'three/webgpu';
import { jitter } from '../materials.js';
import { randomGenerator } from '../../geo.js';
import { isRawWood, woodTint } from './house.js';
import { season } from '../../season.js';

const UP = new THREE.Vector3(0, 1, 0);
let picketGeo = null;
function picket() {
  if (picketGeo) return picketGeo;
  const w = .085, s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, .92); s.lineTo(0, 1); s.lineTo(-w / 2, .92); s.closePath();
  picketGeo = new THREE.ExtrudeGeometry(s, { depth: .02, bevelEnabled: false });
  picketGeo.translate(0, 0, -.01);
  return picketGeo;
}
const woodKey = hex => (isRawWood(hex) ? 'logs' : 'painted');

export function buildKitFences(B, ground, plots) {
  let pieces = 0;
  for (const plot of plots) {
    const random = randomGenerator(plot.seed ^ 0x2545f491);
    const centre = plot.rect ? [plot.rect.x, plot.rect.z] : [plot.frame.x, plot.frame.z];
    for (const f of plot.fences) {
      const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len = Math.hypot(dx, dz);
      if (len < .3) continue;
      const ux = dx / len, uz = dz / len;
      const X = new THREE.Vector3(ux, 0, uz), Z = new THREE.Vector3().crossVectors(X, UP);
      const mx = f.a[0] + dx / 2, mz = f.a[1] + dz / 2;
      const plotSide = Math.sign((centre[0] - mx) * Z.x + (centre[1] - mz) * Z.z) || 1;
      const P = t => [f.a[0] + ux * t, f.a[1] + uz * t];
      const M = (t, yOff = 0) => { const [x, z] = P(t); return new THREE.Matrix4().makeBasis(X, UP, Z).setPosition(x, ground(x, z) + yOff, z); };
      let spans = [[0, len]];
      for (const g of f.gates) {
        const g0 = g.t - g.width / 2 - .1, g1 = g.t + g.width / 2 + .1;
        spans = spans.flatMap(([a, c]) => (g1 <= a || g0 >= c) ? [[a, c]] : [[a, g0], [g1, c]].filter(([p, q]) => q - p > .25));
      }
      const color = woodTint(f.color), h = f.height;
      for (const [s0, s1] of spans) pieces += fenceSpan(B, ground, f, { s0, s1, P, M, X, Z, plotSide, color, h, random });
      for (const g of f.gates) gate(B, ground, f, g, { P, M, plotSide, random });
    }
  }
  return { pieces };
}

function posts(B, f, { s0, s1, P, M, step = 2.4, size = .1, key = 'logs', tint, h, steel = false }) {
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const t = s0 + (s1 - s0) * i / n, [x, z] = P(t);
    const b = B.get(steel ? 'darkMetal' : key, x, z);
    b.setMatrix(M(t)); b.setColor(steel ? [1.4, 1.4, 1.4] : tint);
    b.box(size, h + .35, size, 0, (h - .35) / 2, 0);
  }
  return n + 1;
}

function rails(B, f, { s0, s1, P, M, plotSide, key, tint, heights, size = [.07, .035] }) {
  // One rail per post interval so it follows the ground.
  const n = Math.max(1, Math.ceil((s1 - s0) / 2.4));
  for (let i = 0; i < n; i++) {
    const a = s0 + (s1 - s0) * i / n, c = s0 + (s1 - s0) * (i + 1) / n, [x, z] = P(a);
    const b = B.get(key, x, z);
    for (const y of heights) {
      b.setMatrix(M((a + c) / 2, y)); b.setColor(tint);
      b.box(c - a, size[0], size[1], 0, 0, plotSide * .04);
    }
  }
}

function fenceSpan(B, ground, f, o) {
  const { s0, s1, P, M, plotSide, color, h, random } = o;
  const L = s1 - s0;
  let count = 0;
  if (f.type === 'picket' || f.type === 'stripe' || f.type === 'plank') {
    const painted = !isRawWood(f.color) || f.type === 'stripe';
    const key = f.type === 'stripe' ? 'painted' : woodKey(f.color);
    const pitch = f.type === 'picket' ? .15 : f.type === 'stripe' ? .125 : .165;
    const bw = f.type === 'picket' ? .085 : f.type === 'stripe' ? .1 : .15;
    rails(B, f, { s0, s1, P, M, plotSide, key, tint: color.map(v => v * .85), heights: [.3, h - .3] });
    // Painted stripe palisades carry a flat cap board along the top.
    if (f.type === 'stripe') rails(B, f, { s0, s1, P, M, plotSide: 0, key, tint: color, heights: [h + .07], size: [.04, .14] });
    count += posts(B, f, { s0, s1, P, M, key, tint: color.map(v => v * .8), h, size: f.type === 'plank' ? .14 : .1 });
    if (f.type === 'plank' && f.pattern === 'horizontal') {
      // Horizontal slabs (горбыль) between the posts, uneven widths, ends overlapping the posts.
      const m = Math.max(1, Math.ceil(L / 2.4));
      for (let i = 0; i < m; i++) {
        const a = s0 + L * i / m, c = s0 + L * (i + 1) / m, b = B.get(key, ...P(a));
        for (let y = .05; y < h - .05;) {
          const sh = Math.min(h - y, .16 + random() * .12);
          b.setMatrix(M((a + c) / 2, y + sh / 2)); b.setColor(jitter(color, random, .14));
          b.log(-(c - a) / 2 - .08, (c - a) / 2 + .08, 0, -plotSide * .02, sh * .5, .045, { segments: 5, arc: [-Math.PI / 2, Math.PI / 2], outward: -plotSide, caps: [false, false], uo: random() * 3, vo: random() * 5 });
          y += sh * .92; count++;
        }
      }
      return count;
    }
    const n = Math.max(1, Math.round(L / pitch));
    for (let k = 0; k < n; k++) {
      const t = s0 + (k + .5) * L / n, [x, z] = P(t);
      const c2 = f.type === 'stripe' && k % 2 && f.color2 ? woodTint(f.color2) : color;
      const b = B.get(key, x, z);
      const hh = f.type === 'plank' ? h * (.95 + random() * .1) : f.type === 'picket' ? h * (.98 + random() * .04) : h;
      b.setMatrix(M(t, .05));
      b.setColor(jitter(c2, random, painted ? .04 : .12));
      if (f.type === 'picket') b.geometry(picket(), new THREE.Matrix4().makeScale(1, hh, 1));
      else b.box(f.type === 'plank' ? bw * (.8 + random() * .4) : bw, hh, .025, 0, hh / 2, 0, { uo: random() * 5 });
      count++;
    }
  } else if (f.type === 'profiled') {
    // Trapezoid ribs (С8/С20) across the whole span, bottom following the ground.
    const key = 'paintedMetal', period = .23, cols = [0, .08, .38, .46];
    const b = B.get(key, ...P(s0));
    b.setMatrix(new THREE.Matrix4()); b.setColor(color);
    const n = Math.max(1, Math.round(L / period)), pts = [];
    for (let k = 0; k <= n; k++) for (const c of (k < n ? cols : [0])) {
      const t = s0 + (k + c) * L / n, [x, z] = P(t), y = ground(x, z) + .05;
      const off = (c > .05 && c < .4 ? .025 : 0) * -plotSide;
      pts.push([x + o.Z.x * off, y, z + o.Z.z * off, t]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0, z0, t0] = pts[i], [x1, y1, z1, t1] = pts[i + 1];
      const q = [[x0, y0, z0], [x1, y1, z1], [x1, y1 + h, z1], [x0, y0 + h, z0]];
      b.quad(q, [[t0, 0], [t1, 0], [t1, h], [t0, h]]);
      b.quad([q[1], q[0], q[3], q[2]], [[t1, 0], [t0, 0], [t0, h], [t1, h]], .85);
    }
    count += posts(B, f, { s0, s1, P, M, h, size: .06, steel: true });
    rails(B, f, { s0, s1, P, M, plotSide, key: 'darkMetal', tint: [1.3, 1.3, 1.3], heights: [.35, h - .3], size: [.04, .02] });
  } else if (f.type === 'lattice') {
    const key = 'painted', step = .26, y0 = .1, y1 = h - .06;
    count += posts(B, f, { s0, s1, P, M, key, tint: color, h, size: .08 });
    rails(B, f, { s0, s1, P, M, plotSide, key, tint: color, heights: [y0, y1], size: [.06, .04] });
    const n = Math.max(1, Math.ceil(L / 2.4));
    for (let i = 0; i < n; i++) {
      const a = s0 + L * i / n, c = s0 + L * (i + 1) / n, base = M(a);
      const b = B.get(key, ...P(a));
      b.setColor(color);
      const W = c - a;
      // Two families of slats: x - y = k * step and x + y = k * step (panel-local metres).
      for (const fam of [1, -1]) {
        const k0 = Math.floor((fam > 0 ? -y1 : y0) / step) - 1, k1 = Math.ceil((fam > 0 ? W - y0 : W + y1) / step) + 1;
        for (let k = k0; k <= k1; k++) {
          const cc = k * step;
          const lo = fam > 0 ? Math.max(0, cc + y0) : Math.max(0, cc - y1), hi = fam > 0 ? Math.min(W, cc + y1) : Math.min(W, cc - y0);
          if (hi - lo < .05) continue;
          const p0 = [lo, fam > 0 ? lo - cc : cc - lo], p1 = [hi, fam > 0 ? hi - cc : cc - hi];
          const sl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          const m = base.clone().multiply(new THREE.Matrix4().makeTranslation((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, fam * .012)).multiply(new THREE.Matrix4().makeRotationZ(Math.atan2(p1[1] - p0[1], p1[0] - p0[0])));
          b.setMatrix(m);
          b.box(sl, .045, .018);
        }
      }
    }
  } else if (f.type === 'mesh') {
    count += posts(B, f, { s0, s1, P, M, h, size: .05, steel: true });
    const b = B.get('meshFence', ...P(s0));
    b.setMatrix(new THREE.Matrix4()); b.setColor(color);
    const n = Math.max(1, Math.ceil(L / 2));
    for (let i = 0; i < n; i++) {
      const t0 = s0 + L * i / n, t1 = s0 + L * (i + 1) / n, [x0, z0] = P(t0), [x1, z1] = P(t1), g0 = ground(x0, z0) + .05, g1 = ground(x1, z1) + .05;
      b.quad([[x0, g0, z0], [x1, g1, z1], [x1, g1 + h, z1], [x0, g0 + h, z0]], [[t0, 0], [t1, 0], [t1, h], [t0, h]]);
    }
    rails(B, f, { s0, s1, P, M, plotSide, key: 'paintedMetal', tint: color, heights: [h], size: [.03, .03] });
  } else if (f.type === 'metal-rail') {
    count += posts(B, f, { s0, s1, P, M, h, size: .06, key: 'paintedMetal', tint: color });
    rails(B, f, { s0, s1, P, M, plotSide, key: 'paintedMetal', tint: color, heights: [.35, h * .6, h - .05], size: [.04, .04] });
  } else if (f.type === 'concrete') {
    const n = Math.max(1, Math.ceil(L / 2));
    for (let i = 0; i < n; i++) {
      const t0 = s0 + L * i / n, t1 = s0 + L * (i + 1) / n, b = B.get('euroFence', ...P(t0));
      b.setMatrix(M((t0 + t1) / 2)); b.setColor([1, 1, 1]);
      b.box(t1 - t0 - .12, h * .78, .06, 0, h * .39 + .02, 0);
    }
    const tint = color.map(v => v / .58);
    count += posts(B, f, { s0, s1, P, M, h, size: .14, key: 'concrete', tint, step: 2 });
  }
  return count;
}

function gate(B, ground, f, g, { P, M, plotSide, random }) {
  const [x, z] = P(g.t), color = woodTint(g.color);
  const profiled = f.type === 'profiled';
  const h = Math.max(f.height, g.type === 'wicket' ? f.height : Math.min(2.1, f.height + .1));
  const leaves = g.type === 'wicket' ? [[0, g.width - .06]] : [[-g.width / 4, g.width / 2 - .05], [g.width / 4, g.width / 2 - .05]];
  const key = profiled ? 'paintedMetal' : woodKey(g.color);
  const b = B.get(key, x, z);
  const base = M(g.t, .07);
  for (const [lx, lw] of leaves) {
    b.setMatrix(base); b.setColor(color);
    if (profiled) {
      for (let k = 0; k < Math.round(lw / .115); k++) b.box(.06, h - .1, .03 + (k % 2) * .02, lx - lw / 2 + .06 + k * .115, (h - .1) / 2, 0);
      b.box(lw, .05, .05, lx, h - .1, 0);
    } else {
      const n = Math.max(2, Math.round(lw / .13));
      for (let k = 0; k < n; k++) { b.setColor(jitter(color, random, .05)); b.box(lw / n - .012, h - .1, .03, lx - lw / 2 + (k + .5) * lw / n, (h - .1) / 2, 0); }
      b.setColor(color.map(v => v * .85));
      b.box(lw - .04, .1, .03, lx, .35, plotSide * .03); b.box(lw - .04, .1, .03, lx, h - .4, plotSide * .03);
      const diag = Math.hypot(lw - .1, h - .85), ang = Math.atan2(h - .85, lw - .1);
      b.setMatrix(base.clone().multiply(new THREE.Matrix4().makeTranslation(lx, h / 2 - .02, plotSide * .03)).multiply(new THREE.Matrix4().makeRotationZ(ang)));
      b.box(diag, .09, .03);
    }
  }
  const pk = profiled ? 'darkMetal' : woodKey(g.color);
  const pb = B.get(pk, x, z);
  pb.setMatrix(M(g.t)); pb.setColor(profiled ? [1.4, 1.4, 1.4] : color.map(v => v * .8));
  const ps = profiled ? .08 : .15, ph = h + (g.roofed ? .5 : .15);
  for (const s of [-1, 1]) pb.box(ps, ph + .35, ps, s * (g.width / 2 + ps / 2), (ph - .35) / 2, 0);
  if (g.roofed) {
    pb.box(g.width + ps * 2 + .3, .16, .16, 0, ph, 0);
    const rw = g.width + ps * 2 + .6;
    for (const s of [-1, 1]) {
      pb.setMatrix(M(g.t).multiply(new THREE.Matrix4().makeTranslation(0, ph + .2, s * .2)).multiply(new THREE.Matrix4().makeRotationX(s * .55)));
      pb.box(rw, .03, .5);
      if (!season.summer) {
        const sn = B.get('snow', x, z);
        sn.setMatrix(M(g.t).multiply(new THREE.Matrix4().makeTranslation(0, ph + .27, s * .2)).multiply(new THREE.Matrix4().makeRotationX(s * .55)));
        sn.setColor([1, 1, 1]); sn.box(rw - .06, .1, .46);
      }
    }
  }
}
