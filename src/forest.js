import * as THREE from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  texture, uv, vec2, vec3, float, mix, smoothstep, positionGeometry, positionWorld, normalWorld, mx_noise_float,
  attribute, color, hash, instanceIndex, normalMap, normalView, normalViewGeometry, abs, step, max, cameraViewMatrix, vec4,
} from 'three/tsl';
import { polygons, toLocal, segmentDistanceSq, randomGenerator } from './geo.js';
import { inBuilding } from './buildings.js';
import { inRect, wayLines } from './village/plan.js';
import { textureSet } from './textures.js';
import { snowCap, SNOW_COLOR } from './village/materials.js';
import { createGrass } from './grass.js';
import { season } from './season.js';

const CHUNK = 200, NEAR_DISTANCE = 240;

// ------------------------------------------------------------ geometry ----

// Welds vertices, displaces them randomly and recomputes smooth normals (lumpy clumps).
function jitterGeometry(g, random, amount) {
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const w = mergeVertices(g), p = w.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + (random() - .5) * amount, p.getY(i) + (random() - .5) * amount, p.getZ(i) + (random() - .5) * amount);
  w.computeVertexNormals();
  return w;
}
function withColor(g, rgb) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function stripTo(g, keep) {
  for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  return g.index ? g.toNonIndexed() : g;
}
// Branch cylinder from point a to point b.
function limb(a, b, r0, r1, segments = 5) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, segments, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// Cluster of needle cards around a branch end at c, branch heading a (radians): n quads of
// ~size m, rotated about the branch axis (mostly flat), with uv for the needle texture and
// normals bent away from the cluster centre. top: the leader, cards stand more upright.
function needleCluster(random, c, a, size, n, top = false) {
  const pos = [], nor = [], uvs = [], idx = [];
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  const centre = new THREE.Vector3(...c), q = new THREE.Quaternion(), v = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const roll = top ? (i / n) * Math.PI + random() * .3 : (random() - .5) * 1.4 + (i % 3 === 2 ? Math.PI / 2 : 0);
    const yaw = (random() - .5) * 1.3, droop = -.12 - random() * .25;
    const len = size * (.8 + random() * .45), wid = size * (.55 + random() * .3);
    const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).applyAxisAngle(side, droop);
    const o = centre.clone().addScaledVector(d, (random() - .4) * size * .5).add(new THREE.Vector3(0, (random() - .5) * size * .25, 0));
    q.setFromAxisAngle(d, roll);
    const w = side.clone().applyQuaternion(q);
    const base = pos.length / 3;
    for (const [u, vv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      v.copy(o).addScaledVector(d, (u - .35) * len).addScaledVector(w, (vv - .5) * wid);
      if (top) v.y += (u - .3) * len * .6;
      nrm.subVectors(v, centre).multiplyScalar(1 / size).add(new THREE.Vector3(0, .9, 0)).normalize();
      pos.push(v.x, v.y, v.z); nor.push(nrm.x, nrm.y, nrm.z); uvs.push(u, vv);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g.toNonIndexed();
}

// Needle tuft texture (drawn once on a canvas): a twig along u with paired needle strokes
// fanning forward, denser and longer in the middle, side shoots; alpha = needles.
let needleTex = null;
function needleTexture() {
  if (needleTex) return needleTex;
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d'), random = randomGenerator(911);
  g.clearRect(0, 0, S, S);
  g.lineCap = 'round';
  const twig = (x0, y0, x1, y1, reach, count) => {
    g.strokeStyle = '#5a3f2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    for (let i = 0; i < count; i++) {
      const t = random(), px = x0 + dx * t, py = y0 + dy * t, env = Math.sin(Math.PI * Math.min(1, t * 1.15));
      for (const s of [-1, 1]) {
        const ang = s * (.5 + random() * .7), r = reach * (.45 + .55 * env) * (.7 + random() * .5);
        const ca = Math.cos(ang), sa = Math.sin(ang), ex = px + (ux * ca - uy * sa) * r, ey = py + (uy * ca + ux * sa) * r;
        const l = 70 + random() * 70;
        g.strokeStyle = `rgb(${l * .55 | 0},${l | 0},${l * .45 | 0})`; g.lineWidth = 1.6 + random() * 1.2;
        g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();
      }
    }
  };
  twig(10, S / 2, S - 20, S / 2 + 6, 70, 260);
  for (const [t, s] of [[.35, -1], [.5, 1], [.65, -1], [.75, 1]]) {
    const x = 10 + (S - 30) * t, y = S / 2 + 6 * t;
    twig(x, y, x + 60, y + s * 70, 34, 70);
  }
  needleTex = new THREE.CanvasTexture(cv);
  needleTex.colorSpace = THREE.SRGBColorSpace;
  needleTex.anisotropy = 4;
  return needleTex;
}

// Scots pine: tall bare trunk, crown of needle-card clusters in the top third.
function pineVariant(seed) {
  const random = randomGenerator(seed);
  const H = 13 + random() * 3;
  const trunk = new THREE.CylinderGeometry(.11, .3, H, 8, 6);
  trunk.translate(0, H / 2, 0);
  const tp = trunk.attributes.position;
  const bend = (random() - .5) * .5;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i) / H; tp.setX(i, tp.getX(i) + Math.sin(y * 2.4) * bend); }
  trunk.computeVertexNormals();
  const limbs = [], clumps = [];
  const crownBase = H * (.52 + random() * .1);
  const axis = y => Math.sin(y / H * 2.4) * bend;
  // Branch whorls (Scots pine): every ~0.8 m a whorl of 3-5 branches; each branch ends in a
  // cluster of alpha-tested needle cards (tufts on a twig, see needleTexture) fanned around the
  // branch, mostly near-horizontal so the crown reads as layered tufts from the side and as a
  // star of tufts from above. Card normals are bent outward from the cluster centre (soft,
  // volumetric lighting instead of flat cards).
  const whorls = 6 + Math.floor(random() * 3);
  for (let i = 0; i < whorls; i++) {
    const t = i / (whorls - 1), y = crownBase + t * (H - crownBase - .6) + (random() - .5) * .3;
    const nb = t > .8 ? 3 : 3 + Math.floor(random() * 3), spin = random() * Math.PI * 2;
    for (let k = 0; k < nb; k++) {
      if (random() < .15 && t < .8) continue;
      const a = spin + k / nb * Math.PI * 2 + (random() - .5) * .6;
      const reach = (1 - t * .65) * (1.1 + random() * 1.3);
      const ca = Math.cos(a), sa = Math.sin(a);
      const cx = axis(y) + ca * (reach * .6 + .2), cy = y - reach * .12, cz = sa * (reach * .6 + .2);
      const size = .95 + reach * .45 + (1 - t) * .3;
      clumps.push(needleCluster(random, [cx, cy, cz], a, size, 8 + Math.floor(random() * 3)));
      // A second, smaller tuft cluster halfway along long branches fills the tier.
      if (reach > 1.1) clumps.push(needleCluster(random, [axis(y) + ca * reach * .3, y - reach * .05, sa * reach * .3], a + (random() - .5) * .8, size * .7, 5));
      if (reach > .6) limbs.push(stripTo(limb(new THREE.Vector3(axis(y), y - .25, 0), new THREE.Vector3(axis(y) + ca * reach * .8, y - reach * .1, sa * reach * .8), .06, .025, 4), ['position', 'normal', 'uv']));
    }
  }
  clumps.push(needleCluster(random, [axis(H), H - .45, 0], random() * 6.28, 1.1, 7, true));
  const bark = mergeGeometries([stripTo(trunk, ['position', 'normal', 'uv']), ...limbs]);
  const crown = mergeGeometries(clumps);
  // Far version: trunk + two cones, vertex-coloured, one draw.
  const ft = new THREE.CylinderGeometry(.12, .28, H * .7, 5); ft.translate(0, H * .35, 0);
  const c1 = new THREE.ConeGeometry(2.3, (H - crownBase) * .9, 7); c1.translate(0, crownBase + (H - crownBase) * .4, 0);
  const c2 = new THREE.ConeGeometry(1.4, (H - crownBase) * .6, 7); c2.translate(0, crownBase + (H - crownBase) * .85, 0);
  const far = mergeGeometries([
    withColor(stripTo(ft, ['position', 'normal']), [.42, .3, .22]),
    withColor(stripTo(c1, ['position', 'normal']), [.14, .22, .12]),
    withColor(stripTo(c2, ['position', 'normal']), [.16, .25, .13]),
  ]);
  return { bark, crown, far, H };
}

// Birch: white trunk, upward bare branches, twig haze.
function birchVariant(seed) {
  const random = randomGenerator(seed);
  const H = 9 + random() * 3;
  const lean = new THREE.Vector3((random() - .5) * .6, 0, (random() - .5) * .6);
  const parts = [], haze = [];
  const trunk = new THREE.CylinderGeometry(.05, .17, H, 8, 5);
  trunk.translate(0, H / 2, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i) / H; tp.setX(i, tp.getX(i) + lean.x * y * y); tp.setZ(i, tp.getZ(i) + lean.z * y * y); }
  trunk.computeVertexNormals();
  parts.push(withColor(stripTo(trunk, ['position', 'normal', 'uv']), [1, 0, 0]));
  const trunkAt = y => new THREE.Vector3(lean.x * (y / H) ** 2, y, lean.z * (y / H) ** 2);
  const nb = 7 + Math.floor(random() * 3);
  for (let i = 0; i < nb; i++) {
    const y = H * (.35 + .55 * i / nb) + (random() - .5) * .5, a = random() * Math.PI * 2;
    const len = (2.2 + random() * 1.8) * (1 - i / nb * .45), up = .7 + random() * .5;
    const start = trunkAt(y), dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
    const end = start.clone().addScaledVector(dir, len);
    parts.push(withColor(stripTo(limb(start, end, .05, .016), ['position', 'normal', 'uv']), [.8, 0, 0]));
    // Fine twig mass around the outer half of each branch: the purple-brown winter birch haze.
    const r = .6 + len * .22;
    const blob = jitterGeometry(new THREE.IcosahedronGeometry(r, 1), random, r * .35);
    blob.scale(1, 1.35, 1);
    const mid = start.clone().lerp(end, .78);
    blob.translate(mid.x, mid.y + r * .2, mid.z);
    haze.push(stripTo(blob, ['position', 'normal']));
    for (let k = 0; k < 3; k++) {
      const s = start.clone().lerp(end, .45 + k * .2);
      const d2 = dir.clone().add(new THREE.Vector3((random() - .5) * 1.4, .2 + random() * .4, (random() - .5) * 1.4)).normalize();
      parts.push(withColor(stripTo(limb(s, s.clone().addScaledVector(d2, .8 + random() * .9), .016, .006, 3), ['position', 'normal', 'uv']), [0, 0, 0]));
    }
  }
  {
    const top = jitterGeometry(new THREE.IcosahedronGeometry(1.1, 1), random, .3); top.scale(1, 1.5, 1);
    const p = trunkAt(H * .93); top.translate(p.x, p.y, p.z);
    haze.push(stripTo(top, ['position', 'normal']));
  }
  const ft = new THREE.CylinderGeometry(.06, .16, H * .8, 5); ft.translate(0, H * .4, 0);
  const fh = new THREE.IcosahedronGeometry(2.3, 0); fh.scale(1, 1.5, 1); fh.translate(lean.x * .5, H * .72, lean.z * .5);
  const far = mergeGeometries([
    withColor(stripTo(ft, ['position', 'normal']), [.8, .78, .74]),
    withColor(stripTo(fh, ['position', 'normal']), [.3, .25, .24]),
  ]);
  return { bark: mergeGeometries(parts), haze: mergeGeometries(haze), far, H };
}

// Crossed-quad impostor for distant trees; normals point up so both planes light like the canopy.
function impostorGeometry(width, height) {
  const pos = [], uvs = [], idx = [];
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const b = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      pos.push((u - .5) * width * ax, v * height, (u - .5) * width * az); uvs.push(u, v);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

function impostorMaterials() {
  const seed = hash(instanceIndex).mul(17);
  const u = uv().x.sub(.5), v = uv().y;
  const pine = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: .5, roughness: 1 });
  const n = mx_noise_float(vec2(u.mul(7), v.mul(9)).add(seed));
  const n2 = mx_noise_float(vec2(u.mul(19), v.mul(23)).add(seed.mul(1.7)));
  const crownE = u.div(.34).pow(2).add(v.sub(.75).div(.25).pow(2));
  const crown = float(1).sub(step(float(1).add(n.mul(.75)).add(n2.mul(.25)), crownE));
  const trunk = step(abs(u), float(.024)).mul(step(v, float(.8)));
  pine.opacityNode = max(crown, trunk);
  const needle = mix(color('#263d24'), color('#466338'), n2.mul(.5).add(.5));
  const snowy = smoothstep(.05, .45, n.mul(.6).add(n2.mul(.4)).add(v.sub(.72).mul(2.5)));
  pine.colorNode = mix(vec3(.42, .24, .14), season.summer ? needle : mix(needle, color(SNOW_COLOR), snowy.mul(.6)), crown);
  pine.name = 'pine impostor';
  const birch = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: .5, roughness: 1 });
  const bt = step(abs(u.sub(v.mul(.03))), float(.016)).mul(step(v, float(.82)));
  const hazeE = u.div(.4).pow(2).add(v.sub(.66).div(.32).pow(2));
  const twigs = step(float(.15), mx_noise_float(vec2(u.mul(38), v.mul(30)).add(seed))).mul(step(hazeE, float(1).add(n.mul(.4))));
  if (season.summer) {
    // Summer crown: a leafy mass instead of the purple-brown winter twig haze.
    const leaves = step(hazeE, float(1).add(n.mul(.45))).mul(step(float(-.25), mx_noise_float(vec2(u.mul(16), v.mul(13)).add(seed))));
    birch.opacityNode = max(bt, leaves);
    birch.colorNode = mix(mix(vec3(.1, .16, .05), vec3(.2, .28, .09), n2.mul(.5).add(.5)), vec3(.85, .84, .8), bt);
  } else {
    birch.opacityNode = max(bt, twigs);
    birch.colorNode = mix(vec3(.26, .19, .18), vec3(.85, .84, .8), bt);
  }
  birch.name = 'birch impostor';
  // Crossed cards light like the canopy above them on both faces (DoubleSide would flip the
  // normal of back faces downward and leave one card of every tree black).
  const up = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz.normalize();
  pine.normalNode = up; birch.normalNode = up;
  return { pine, birch };
}

// ------------------------------------------------------------ materials ----

function materials() {
  const variation = hash(instanceIndex).mul(.25).add(.88);
  const barkSet = textureSet('bark');
  const pineBark = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const buv = uv().mul(vec2(2, 7));
  const orange = smoothstep(4, 9, positionGeometry.y);
  pineBark.colorNode = texture(barkSet.color, buv).rgb.mul(mix(vec3(.85, .78, .72), vec3(1.35, .82, .52), orange)).mul(variation);
  pineBark.normalNode = normalMap(texture(barkSet.normal, buv));
  pineBark.name = 'pine bark';

  // Needle cards: alpha-tested tuft texture, tinted per height and instance; back faces keep
  // the outward bent normal (no flip), so both sides of a card light like the crown.
  const needles = new THREE.MeshStandardNodeMaterial({ roughness: .9, side: THREE.DoubleSide, alphaTest: .45 });
  const tex = texture(needleTexture(), uv());
  const nn = mx_noise_float(positionGeometry.mul(1.7)).mul(.5).add(.5);
  const tint = mix(vec3(.75, .85, .8), vec3(1.15, 1.1, .85), nn.mul(.6).add(smoothstep(4, 14, positionGeometry.y).mul(.4))).mul(variation);
  const needleCol = tex.rgb.mul(tint).mul(.85);
  const snowK = smoothstep(.35, .7, normalWorld.y.add(mx_noise_float(positionWorld.mul(.9)).mul(.35)));
  needles.colorNode = season.summer ? needleCol : mix(needleCol, color(SNOW_COLOR), snowK.mul(.85));
  needles.opacityNode = tex.a;
  needles.normalNode = normalViewGeometry;
  needles.roughnessNode = mix(float(.9), float(.8), snowK);
  needles.name = 'pine needles + snow';

  // Birch bark: chalk-white with black lenticels and a dark cracked base; thin twigs dark.
  const birch = new THREE.MeshStandardNodeMaterial({ roughness: .85 });
  const p = positionGeometry;
  const marks = smoothstep(.42, .55, mx_noise_float(vec3(p.x.mul(5), p.y.mul(16), p.z.mul(5))));
  const base = smoothstep(1.6, .3, p.y.add(mx_noise_float(p.mul(3)).mul(.6)));
  const white = vec3(.88, .87, .83);
  const wood = mix(mix(white, vec3(.08, .07, .07), marks.mul(.85)), vec3(.12, .1, .09), base.mul(.85));
  birch.colorNode = mix(vec3(.2, .14, .13), wood, attribute('color', 'vec3').x);
  birch.name = 'birch bark';

  const haze = new THREE.MeshStandardNodeMaterial({ roughness: 1, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  haze.colorNode = season.summer ? mix(vec3(.05, .085, .025), vec3(.12, .17, .05), mx_noise_float(positionGeometry.mul(2.3)).mul(.5).add(.5)).mul(variation) : vec3(.2, .12, .1).mul(variation);
  // Fade toward the silhouette so the twig mass has no hard 'ball' outline.
  const facing = smoothstep(.15, .75, abs(normalView.z));
  const twig = mx_noise_float(positionGeometry.mul(6.5)).add(mx_noise_float(positionGeometry.mul(26)).mul(.7));
  haze.opacityNode = season.summer ? smoothstep(-.35, .2, twig).mul(.92).mul(smoothstep(.05, .45, abs(normalView.z))) : smoothstep(-.05, .55, twig).mul(.3).mul(facing);
  haze.name = 'birch twig haze';

  const far = new THREE.MeshStandardNodeMaterial({ roughness: 1, flatShading: true });
  far.colorNode = snowCap(attribute('color', 'vec3').mul(variation), { threshold: .45 });
  far.name = 'tree far LOD';
  return { pineBark, needles, birch, haze, far };
}

// --------------------------------------------------------------- forest ----

export function createForest(features, meta, ground, exclusions, buildings, options = {}) {
  const plots = options.plots || [];
  const woods = features.filter(f => f.properties.layer === 'wood').flatMap(f => polygons(f.geometry)).map(poly => poly.map(r => r.map(p => toLocal(...p, meta))));
  const random = randomGenerator(918), trees = [], half = meta.halfSizeM - 15;
  const cells = new Map(), cellSize = 80;
  for (const e of exclusions) {
    for (let x = Math.floor((Math.min(e.a[0], e.b[0]) - e.radius) / cellSize); x <= Math.floor((Math.max(e.a[0], e.b[0]) + e.radius) / cellSize); x++)
      for (let z = Math.floor((Math.min(e.a[1], e.b[1]) - e.radius) / cellSize); z <= Math.floor((Math.max(e.a[1], e.b[1]) + e.radius) / cellSize); z++) {
        const key = `${x},${z}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(e);
      }
  }
  const nearPath = (x, z, pad) => (cells.get(`${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`) || []).some(e => segmentDistanceSq(x, z, e.a, e.b) < (e.radius + pad) ** 2);
  // Spatial hash of buildings and plots so village exclusion stays cheap.
  const bcell = 40, bmap = new Map();
  const addB = (r, kind) => {
    const rad = Math.hypot(r.w, r.d) / 2 + 6;
    for (let x = Math.floor((r.x - rad) / bcell); x <= Math.floor((r.x + rad) / bcell); x++)
      for (let z = Math.floor((r.z - rad) / bcell); z <= Math.floor((r.z + rad) / bcell); z++) {
        const k = `${x},${z}`; if (!bmap.has(k)) bmap.set(k, []); bmap.get(k).push({ r, kind });
      }
  };
  buildings.forEach(r => addB(r, 'b'));
  plots.forEach(p => p.rect && addB(p.rect, 'p'));
  const villageAt = (x, z) => {
    let inPlot = false, nearB = Infinity;
    for (const { r, kind } of bmap.get(`${Math.floor(x / bcell)},${Math.floor(z / bcell)}`) || []) {
      if (kind === 'p') { if (inRect(x, z, r, 1.5)) inPlot = true; }
      else if (inBuilding(x, z, r, 5)) nearB = 0;
    }
    return { inPlot, blocked: nearB === 0 };
  };

  // Wood polygon rasterised once (scanline, 10 m cells): dense jittered-grid forest inside it.
  const mcell = 10, mn = Math.ceil(2 * meta.halfSizeM / mcell), mask = new Uint8Array(mn * mn);
  for (const poly of woods) for (let gz = 0; gz < mn; gz++) {
    const z = -meta.halfSizeM + (gz + .5) * mcell, xs = [];
    for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[j];
      if ((az > z) !== (bz > z)) xs.push(ax + (z - az) / (bz - az) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const g0 = Math.max(0, Math.ceil((xs[k] + meta.halfSizeM) / mcell - .5)), g1 = Math.min(mn - 1, Math.floor((xs[k + 1] + meta.halfSizeM) / mcell - .5));
      for (let gx = g0; gx <= g1; gx++) mask[gz * mn + gx] ^= 1;
    }
  }
  const inWood = (x, z) => {
    const gx = Math.floor((x + meta.halfSizeM) / mcell), gz = Math.floor((z + meta.halfSizeM) / mcell);
    return gx >= 0 && gz >= 0 && gx < mn && gz < mn && mask[gz * mn + gx] === 1;
  };
  // Thin the forest near улица Толстихина: the street imagery shows open ground and only the
  // odd pine near the houses, the woods start further out.
  const streetPts = new Map(), scell = 100;
  for (const line of wayLines(features, meta)) {
    if (line.name !== 'улица Толстихина') continue;
    for (let i = 1; i < line.points.length; i++) {
      const [ax, az] = line.points[i - 1], [bx, bz] = line.points[i], len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d <= len; d += 15) {
        const x = ax + (bx - ax) * d / len, z = az + (bz - az) * d / len, k = `${Math.floor(x / scell)},${Math.floor(z / scell)}`;
        if (!streetPts.has(k)) streetPts.set(k, []); streetPts.get(k).push([x, z]);
      }
    }
  }
  const streetDist = (x, z) => {
    let best = Infinity; const gx = Math.floor(x / scell), gz = Math.floor(z / scell);
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) for (const [px, pz] of streetPts.get(`${gx + i},${gz + j}`) || []) best = Math.min(best, Math.hypot(px - x, pz - z));
    return best;
  };
  const keepNearStreet = (x, z) => { const d = streetDist(x, z); return d > 350 || random() < (d < 150 ? .25 : .55); };
  const clearingAt = (x, z) => Math.sin(x * .011 + Math.sin(z * .007) * 2) + Math.cos(z * .013 - x * .004);
  const spacing = 10.5;
  for (let z = -half; z < half; z += spacing) for (let x = -half; x < half; x += spacing) {
    const px = x + random() * spacing, pz = z + random() * spacing;
    if (!inWood(px, pz)) continue;
    const clearing = clearingAt(px, pz);
    if (random() > .88 + clearing * .12 || (clearing < -1.2 && random() < .8)) continue;
    if (nearPath(px, pz, 2.2) || Math.hypot(px - meta.defaultSpawn.x, pz - meta.defaultSpawn.z) < 40) continue;
    const v = villageAt(px, pz);
    if (v.blocked || v.inPlot || !keepNearStreet(px, pz)) continue;
    trees.push({ x: px, y: ground(px, pz), z: pz, scale: .7 + random() * .55, angle: random() * Math.PI * 2, birch: random() < .1 });
  }
  // Sparser trees on the slopes above the village.
  for (let i = 0; i < 40000; i++) {
    const x = (random() * 2 - 1) * half, z = (random() * 2 - 1) * half;
    if (inWood(x, z)) continue;
    const y = ground(x, z), slope = Math.hypot(ground(x + 8, z) - ground(x - 8, z), ground(x, z + 8) - ground(x, z - 8)) / 16;
    if (!(y > 25 && slope > .06 && slope < .55 && random() < .3 + clearingAt(x, z) * .1)) continue;
    if (Math.hypot(x - meta.defaultSpawn.x, z - meta.defaultSpawn.z) < 40 || nearPath(x, z, 2.2)) continue;
    const v = villageAt(x, z);
    if (v.blocked || v.inPlot || !keepNearStreet(x, z)) continue;
    trees.push({ x, y, z, scale: .65 + random() * .6, angle: random() * Math.PI * 2, birch: random() < .38 });
  }
  // Village trees: birches (some pines) in gardens and front yards and along streets,
  // never on roads, houses or fence lines.
  const fcell = 4, fenceCells = new Map();
  for (const plot of plots) for (const f of plot.fences) {
    const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len = Math.hypot(dx, dz) || 1;
    for (let d = f.t0; d <= f.t1; d += 1) {
      const x = f.a[0] + dx * d / len, z = f.a[1] + dz * d / len, k = `${Math.floor(x / fcell)},${Math.floor(z / fcell)}`;
      if (!fenceCells.has(k)) fenceCells.set(k, []); fenceCells.get(k).push([x, z]);
    }
  }
  const nearFence = (x, z, r) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const [fx, fz] of fenceCells.get(`${Math.floor(x / fcell) + i},${Math.floor(z / fcell) + j}`) || []) if ((fx - x) ** 2 + (fz - z) ** 2 < r * r) return true;
    return false;
  };
  const villageTree = (x, z, scale, pr, pineChance = .2) => {
    if (buildings.some(b => Math.abs(b.x - x) < 16 && Math.abs(b.z - z) < 16 && inBuilding(x, z, b, 2.6)) || nearPath(x, z, .5) || nearFence(x, z, 1.4)) return;
    trees.push({ x, y: ground(x, z), z, scale, angle: pr() * 6.28, birch: pr() > pineChance });
  };
  for (const plot of plots) {
    if (plot.filler) continue;
    const pr = randomGenerator(plot.seed ^ 0x9e3779b9);
    const r = plot.rect, c = Math.cos(r.angle), s = Math.sin(r.angle);
    const at = (u, v) => [r.x + u * c - v * s, r.z + u * s + v * c];
    if (pr() < .72) for (let k = 0; k < 1 + Math.floor(pr() * 3); k++) {
      const [x, z] = at((pr() - .5) * (r.w - 3), -r.d / 2 + 2 + pr() * r.d * .35);
      villageTree(x, z, .55 + pr() * .5, pr);
    }
    if (pr() < .55 && !plot.passport) {
      // Front yard, between the house and the street fence (passport plots keep what the photos show).
      const [x, z] = at((pr() < .5 ? -1 : 1) * (r.w / 2 - 1.5 - pr() * 2), r.d / 2 - 1.2 - pr() * 1.5);
      villageTree(x, z, .45 + pr() * .4, pr, .1);
    }
  }
  const streetRandom = randomGenerator(5150);
  for (const line of wayLines(features, meta)) {
    // улица Толстихина is drawn from the street imagery: no invented roadside trees there.
    if (line.kind !== 'road' || line.foot || line.name === 'улица Толстихина') continue;
    for (let i = 1; i < line.points.length; i++) {
      const [ax, az] = line.points[i - 1], [bx, bz] = line.points[i], len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let d = streetRandom() * 12; d < len; d += 9 + streetRandom() * 18) {
        const side = streetRandom() < .5 ? -1 : 1, off = line.width / 2 + 3.9 + streetRandom() * 3;
        const x = ax + (bx - ax) * d / len + nx * off * side, z = az + (bz - az) * d / len + nz * off * side;
        const near = buildings.some(b => Math.abs(b.x - x) < 45 && Math.abs(b.z - z) < 45);
        if (near && Math.hypot(x - meta.defaultSpawn.x, z - meta.defaultSpawn.z) > 9) villageTree(x, z, .6 + streetRandom() * .45, streetRandom, .15);
      }
    }
  }
  for (const e of exclusions) {
    if (e.radius < 9 || random() > .35) continue; // waterways have the larger radius
    const t = random(), side = random() < .5 ? -1 : 1;
    const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], l = Math.hypot(dx, dz) || 1;
    const off = e.radius + 2 + random() * 10;
    const x = e.a[0] + dx * t - dz / l * off * side, z = e.a[1] + dz * t + dx / l * off * side;
    if (Math.abs(x) > half || Math.abs(z) > half || nearPath(x, z, 1) || villageAt(x, z).blocked) continue;
    trees.push({ x, y: ground(x, z), z, scale: .5 + random() * .45, angle: random() * 6.28, birch: true });
  }

  // Field behind the main-street plots: scattered birch clumps and low shrubs (generic
  // vegetation only), a few metres beyond the back fences.
  const fieldRandom = randomGenerator(6271);
  for (const plot of plots) {
    if (!plot.passport || !plot.frame || plot.zBack === undefined) continue;
    for (let lx = plot.s0; lx < plot.s1; lx += 6 + fieldRandom() * 8) {
      if (fieldRandom() > .42) continue;
      const lz = plot.zBack - 4 - fieldRandom() ** 1.6 * 110, [x, z] = plot.frame.world(lx, lz);
      if (Math.abs(x) > half || Math.abs(z) > half || nearPath(x, z, 1.5) || villageAt(x, z).blocked) continue;
      const shrub = fieldRandom() < .55;
      for (let k = 0; k < (shrub ? 1 : 1 + Math.floor(fieldRandom() * 3)); k++) {
        const tx = x + (fieldRandom() - .5) * 4, tz = z + (fieldRandom() - .5) * 4;
        trees.push({ x: tx, y: ground(tx, tz), z: tz, scale: shrub ? .22 + fieldRandom() * .12 : .5 + fieldRandom() * .35, angle: fieldRandom() * 6.28, birch: true });
      }
    }
  }
  // Garden birches chosen by the main-street yard layout.
  for (const t of options.trees || []) trees.push({ x: t.x, y: ground(t.x, t.z), z: t.z, scale: t.scale, angle: random() * 6.28, birch: true });
  const pines = [0, 1, 2, 3, 4].map(i => pineVariant(1000 + i * 77));
  const birches = [0, 1, 2].map(i => birchVariant(2000 + i * 31));
  const mats = materials(), imp = impostorMaterials();
  // Crown width matches the near pine (whorls reach ~3.5 m from the trunk), so the
  // distant canopy closes into a forest mass instead of separate dots.
  const pineImpostor = impostorGeometry(8.5, 15), birchImpostor = impostorGeometry(6.4, 11.5);
  const chunks = new Map();
  trees.forEach((t, i) => {
    const key = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
    let list = chunks.get(key); if (!list) chunks.set(key, list = []);
    t.variant = t.birch ? i % birches.length : i % pines.length;
    list.push(t);
  });
  const group = new THREE.Group(), dummy = new THREE.Object3D();
  const makeMesh = (geometry, material, list, centre, shadow = true) => {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x - centre.x, t.y - .15, t.z - centre.z);
      const squash = .85 + ((t.angle * 7.31) % 1) * .3;
      dummy.scale.set(t.scale * squash, t.scale, t.scale * squash); dummy.rotation.set(0, t.angle, 0); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    return mesh;
  };
  for (const [key, list] of chunks) {
    const [cx, cz] = key.split(',').map(Number);
    const centre = new THREE.Vector3((cx + .5) * CHUNK, 0, (cz + .5) * CHUNK);
    const near = new THREE.Group(), far = new THREE.Group();
    pines.forEach((v, vi) => {
      const sub = list.filter(t => !t.birch && t.variant === vi);
      if (!sub.length) return;
      near.add(makeMesh(v.bark, mats.pineBark, sub, centre), makeMesh(v.crown, mats.needles, sub, centre));
    });
    birches.forEach((v, vi) => {
      const sub = list.filter(t => t.birch && t.variant === vi);
      if (!sub.length) return;
      near.add(makeMesh(v.bark, mats.birch, sub, centre), makeMesh(v.haze, mats.haze, sub, centre, false));
    });
    const farPines = list.filter(t => !t.birch), farBirches = list.filter(t => t.birch);
    if (farPines.length) far.add(makeMesh(pineImpostor, imp.pine, farPines, centre, false));
    if (farBirches.length) far.add(makeMesh(birchImpostor, imp.birch, farBirches, centre, false));
    const lod = new THREE.LOD();
    lod.position.copy(centre);
    lod.addLevel(near, 0); lod.addLevel(far, NEAR_DISTANCE);
    group.add(lod);
  }
  if (options.grass !== false) group.add(createGrass({ plots, buildings, ground, lines: wayLines(features, meta), nearPath }));
  const pineCount = trees.filter(t => !t.birch).length;
  group.name = `${trees.length - pineCount} birches, ${pineCount} ${season.summer ? '' : 'snow-topped '}pines`;
  return group;
}
