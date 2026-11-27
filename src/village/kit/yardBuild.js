// Geometry for the generic yard content of the main-street plots (layout in yard.js):
// vegetable beds with crop rows, polycarbonate/film greenhouses, firewood stacks, outhouses,
// small apple-like garden trees and bird-cherry shrubs. Banyas and sheds use the generic
// village outbuildings. Everything is merged into the shared TiledBuilders.
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomGenerator } from '../../geo.js';
import { lin, jitter } from '../materials.js';
import { context, groundStats, T, mul } from '../house.js';
import { buildOutbuilding } from '../house.js';
import { buildKitOutbuilding } from './house.js';
import { season } from '../../season.js';

// Lumpy crown blobs, built once (low poly, smooth normals).
let blobs = null;
function crownBlobs() {
  if (blobs) return blobs;
  blobs = [0, 1, 2].map(k => {
    const random = randomGenerator(77 + k * 13);
    let g = new THREE.IcosahedronGeometry(1, 1);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = mergeVertices(g);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = .8 + random() * .4;
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * .85, p.getZ(i) * s);
    }
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
    return g;
  });
  return blobs;
}

function placeCtx(B, ground, r, lift = .02) {
  const pre = context(B, r.x, r.z, 0, r.angle);
  const gs = groundStats(pre, ground, r.w, r.d);
  return { ctx: context(B, r.x, r.z, gs.min + lift, r.angle), gs };
}

function beds(B, ground, r, random) {
  const { ctx } = placeCtx(B, ground, r, -.02);
  const it = r.local, pitch = it.pitch ?? .7, alongZ = it.rows !== 'x';
  const L = alongZ ? r.d : r.w, W = alongZ ? r.w : r.d;
  const n = Math.max(2, Math.floor(W / pitch));
  // Soil, crops and garden foliage share the procedural 'concrete' material (tint x noise):
  // no extra material, so no extra draw calls per tile and shadow cascade.
  // Detail level only: beyond ~220 m the tilled-soil ground mask carries the beds.
  const soil = ctx.b('concrete', null, 'detail'), crop = soil;
  soil.setColor(lin('#3a2a1e').map(v => v / .58));
  const kinds = [[.55, .3], [.35, .22], [.5, .45]]; // potato, onion/greens, cabbage-like
  for (let i = 0; i < n; i++) {
    const o = -W / 2 + (i + .5) * W / n;
    const box = (b, w, h, len, c, y = h / 2) => (alongZ ? b.box(w, h, len, o, y, c) : b.box(len, h, w, c, y, o));
    box(soil, pitch * .62, .16, L, 0);
    if (season.summer && (i % 7) !== 6) {
      const [cw, ch] = kinds[Math.floor((i / 3)) % kinds.length];
      const seg = .7 + random() * .3, m = Math.max(1, Math.floor((L - .4) / seg));
      for (let k = 0; k < m; k++) {
        if (random() < .08) continue;
        crop.setColor(jitter(lin(['#40702c', '#4f7a30', '#355f2a'][Math.floor(i / 3) % 3]).map(v => v / .57), random, .15));
        const c = -L / 2 + .2 + (k + .5) * (L - .4) / m, hh = ch * (.7 + random() * .6);
        box(crop, cw * (.8 + random() * .4), hh, seg * .92, c, .16 + hh / 2);
        soil.setColor(lin('#3a2a1e').map(v => v / .58));
      }
    }
  }
}

function greenhouse(B, ground, r) {
  const { ctx } = placeCtx(B, ground, r, 0);
  const film = !!r.local.film, len = r.d, half = r.w / 2, h = film ? 1.9 : 2.2;
  const M = new THREE.Matrix4().makeRotationY(Math.PI / 2); // tunnel axis along local z
  // Film / polycarbonate: one shared translucent material (no shadows, no depth write) up close;
  // beyond the detail distance an opaque milky stand-in (no transparent pass, fewer draws).
  for (const [key, lod, tint] of [['greenhouseCover', 'detail', film ? lin('#eef0ea') : lin('#dce8e4')], ['concrete', 'far', (film ? lin('#e4e6e2') : lin('#cfd9d6')).map(v => v / .57)]]) {
    const cover = ctx.b(key, M, lod);
    cover.setColor(tint);
    cover.log(-len / 2, len / 2, 0, 0, h, half, { segments: 12, arc: [0, Math.PI], caps: [false, false] });
    // End walls: half-discs as triangle fans.
    for (const x of [-len / 2, len / 2]) {
      const c = cover.vertex(x, 0, 0, Math.sign(x), 0, 0, .5, 0), ring = [];
      for (let i = 0; i <= 10; i++) { const a = Math.PI * i / 10; ring.push(cover.vertex(x, Math.sin(a) * h, Math.cos(a) * half, Math.sign(x), 0, 0, .5 + Math.cos(a) * .5, Math.sin(a))); }
      for (let i = 0; i < 10; i++) cover.tri(c, ring[i], ring[i + 1]);
    }
  }
  const ribs = ctx.b(film ? 'logs' : 'darkMetal', M);
  ribs.setColor(film ? lin('#6d5b48') : [2.2, 2.2, 2.2]);
  const n = Math.max(2, Math.round(len / (film ? 1.2 : 1)));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + len * i / n;
    ribs.log(x - .025, x + .025, 0, 0, h + .015, half + .015, { segments: 10, arc: [0, Math.PI], caps: [false, false] });
  }
  ribs.log(-len / 2, len / 2, h - .02, 0, .03, .03, { segments: 4, caps: [false, false] });
  // Door frame on one end.
  ribs.box(.04, 1.8, .04, len / 2 + .01, .9, -.4); ribs.box(.04, 1.8, .04, len / 2 + .01, .9, .4);
}

function woodpile(B, ground, r, random) {
  const { ctx } = placeCtx(B, ground, r, 0);
  const h = r.local.h ?? 1.5;
  // Firewood stack on the rough-wood material (pale cut ends), no extra material.
  const b = ctx.b('logs');
  b.setColor(jitter(lin('#a07a52'), random, .08));
  b.box(r.w, h, r.d, 0, h / 2, 0, { faces: ['px', 'nx', 'pz', 'nz'], uo: random(), vo: random() });
  // Board roof on top, slightly sloped.
  const roof = ctx.b('logs', mul(T(0, h + .06, 0), new THREE.Matrix4().makeRotationX(.08)));
  roof.setColor(lin('#5f5649').map(v => v * 1.3));
  roof.box(r.w + .25, .04, r.d + .3);
  if (!season.summer) { const sn = ctx.b('snow', T(0, h + .14, 0)); sn.setColor([1, 1, 1]); sn.box(r.w + .2, .1, r.d + .25); }
}

function tree(B, ground, r, random, shrub) {
  const s = r.local.scale ?? 1, y0 = ground(r.x, r.z) - .05;
  const M = new THREE.Matrix4().makeRotationY(random() * Math.PI * 2).setPosition(r.x, y0, r.z);
  const bark = B.get('logs', r.x, r.z);
  bark.setMatrix(M); bark.setColor(lin(shrub ? '#4e4036' : '#5a4a3e'));
  const trunkH = shrub ? .3 : 1.1 * s, lean = (random() - .5) * .3;
  if (!shrub) bark.cylinder(.09 * s, .06 * s, 0, trunkH, 0, 0, 6, { cap: false });
  // Main limbs (visible in winter, hidden in the crown in summer).
  const limbs = shrub ? 5 : 4;
  for (let i = 0; i < limbs; i++) {
    const a = i / limbs * Math.PI * 2 + random(), len = (shrub ? 1.1 : 1.5) * s, up = shrub ? 1.2 : .9;
    const dir = new THREE.Vector3(Math.cos(a) * .7 + lean, up, Math.sin(a) * .7).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    bark.setMatrix(new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().compose(new THREE.Vector3(0, trunkH * .9, 0), q, new THREE.Vector3(1, 1, 1))));
    bark.cylinder(.045 * s, .015 * s, 0, len, 0, 0, 4, { cap: false });
  }
  if (!season.summer) return;
  const f = B.get('concrete', r.x, r.z, 'near');
  const green = shrub ? lin('#3d5a2a') : lin(random() < .5 ? '#4a6a2c' : '#3f6230');
  const n = shrub ? 4 : 6, B0 = crownBlobs();
  for (let i = 0; i < n; i++) {
    const a = random() * Math.PI * 2, rr = (shrub ? .45 : .7) * s * random();
    const size = (shrub ? .6 : .85) * s * (.75 + random() * .5);
    const y = shrub ? .55 * s + random() * .4 * s : trunkH + .8 * s + random() * .9 * s;
    f.setMatrix(M); f.setColor(jitter(green.map(v => v / .57), random, .12));
    f.geometry(B0[i % 3], new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * rr + lean, y, Math.sin(a) * rr), new THREE.Quaternion(), new THREE.Vector3(size, size * .85, size)));
  }
}

// Build all yard items of the main-street plots. Returns smoke sources (banyas) and a list of
// birches for the forest (it owns the birch geometry).
export function buildYards(B, ground, plots) {
  const birches = [], chimneys = [];
  for (const plot of plots) for (const r of plot.yard || []) {
    const random = randomGenerator((r.local.seed ?? r.x * 13 + r.z * 7) >>> 0 || 3);
    switch (r.kind) {
      case 'beds': beds(B, ground, r, random); break;
      case 'greenhouse': greenhouse(B, ground, r); break;
      case 'woodpile': woodpile(B, ground, r, random); break;
      case 'appleTree': tree(B, ground, r, random, false); break;
      case 'shrub': tree(B, ground, r, random, true); break;
      case 'birch': tree(B, ground, r, random, false); break; // small garden tree (no extra forest draws)
      case 'outhouse': buildKitOutbuilding(B, ground, { ...r, kind: 'outhouse', roof: 'shed', color: random() < .3 ? '#5d7a8a' : '#6e6252', w: 1.2, d: 1.3 }); break;
      case 'banya': case 'shed': {
        const res = buildOutbuilding(B, ground, { x: r.x, z: r.z, w: r.w, d: r.d, angle: r.angle, kind: r.kind, seed: r.local.seed || 11 });
        if (res.chimneyTop && res.smoke) chimneys.push(res.chimneyTop);
        break;
      }
      default: break;
    }
  }
  return { birches, chimneys };
}
