// Dry winter grass tufts poking through the snow along fences, roadsides and house plinths.
// Instanced per chunk, hidden beyond ~170 m, with a TSL wind sway (no onBeforeCompile).
import * as THREE from 'three/webgpu';
import { vec3, float, mix, sin, cos, time, positionLocal, positionGeometry, attribute, hash, instanceIndex, color, smoothstep } from 'three/tsl';
import { randomGenerator } from './geo.js';
import { inRect, fencePoint } from './village/plan.js';

const CHUNK = 120, VISIBLE = 175;

function tuftGeometry(seed) {
  const random = randomGenerator(seed), pos = [], nor = [], idx = [];
  const blades = 7 + Math.floor(random() * 4);
  for (let b = 0; b < blades; b++) {
    const a = random() * Math.PI * 2, h = .28 + random() * .38, w = .018 + random() * .012;
    const lean = .15 + random() * .35, dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const r0 = random() * .06, base = pos.length / 3;
    const ring = [[0, w], [.5, w * .65], [1, 0]];
    for (const [t, ww] of ring) {
      const off = r0 + lean * h * t * t, y = h * t * (1 - lean * .25 * t);
      if (ww > 0) {
        pos.push(dx * off + px * ww, y, dz * off + pz * ww, dx * off - px * ww, y, dz * off - pz * ww);
        nor.push(0, 1, 0, 0, 1, 0);
      } else { pos.push(dx * off, y, dz * off); nor.push(0, 1, 0); }
    }
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function grassMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 1 });
  const h = positionGeometry.y;
  const variation = hash(instanceIndex).mul(.35).add(.8);
  m.colorNode = mix(color('#4d4130'), color('#cdb67f'), smoothstep(0, .45, h)).mul(variation);
  const phase = attribute('phase', 'float');
  const gust = sin(time.mul(.55).add(phase.mul(.35))).mul(.5).add(.5);
  const sway = sin(time.mul(1.9).add(phase)).mul(.06).add(gust.mul(.09));
  const bend = h.mul(h).mul(4);
  m.positionNode = positionLocal.add(vec3(sway.mul(bend), float(0), cos(time.mul(1.3).add(phase.mul(1.7))).mul(.03).mul(bend)));
  m.name = 'dry grass (wind)';
  return m;
}

export function createGrass({ plots, buildings, ground, lines = [], nearPath }) {
  const random = randomGenerator(4401), items = [];
  const blocked = (x, z) => buildings.some(r => Math.abs(r.x - x) < 14 && Math.abs(r.z - z) < 14 && inRect(x, z, r, .15));
  const push = (x, z, s = 1) => { items.push({ x, z, y: ground(x, z), s: s * (.7 + random() * .6), a: random() * 6.28 }); };
  // Along fences, both sides, skipping gates.
  for (const plot of plots) for (const f of plot.fences) {
    const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
    for (let d = f.t0; d < f.t1; d += .55 + random() * .6) {
      if (f.gates.some(g => Math.abs(g.t - d) < g.width / 2 + .3)) continue;
      if (random() < .35) continue;
      const [x, z] = fencePoint(f, d), side = random() < .5 ? -1 : 1, off = .12 + random() * .45;
      const px = x + nx * off * side, pz = z + nz * off * side;
      if (!blocked(px, pz)) push(px, pz);
    }
  }
  // Roadsides: on and just beyond the snow berms.
  for (const line of lines) {
    if (line.kind !== 'road') continue;
    for (let i = 1; i < line.points.length; i++) {
      const [ax, az] = line.points[i - 1], [bx, bz] = line.points[i], len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let d = 0; d < len; d += .9 + random() * 1.2) {
        if (random() < .4) continue;
        const side = random() < .5 ? -1 : 1, off = line.width / 2 + .9 + random() * 2.6;
        const x = ax + (bx - ax) * d / len + nx * off * side, z = az + (bz - az) * d / len + nz * off * side;
        if (!blocked(x, z)) push(x, z, 1.1);
      }
    }
  }
  // Around plinths and outbuilding corners.
  for (const r of buildings) {
    const c = Math.cos(r.angle), s = Math.sin(r.angle), n = Math.ceil((r.w + r.d) / 2.2);
    for (let k = 0; k < n; k++) {
      if (random() < .45) continue;
      const t = random() * 2 - 1, edge = Math.floor(random() * 4), m = .25 + random() * .5;
      const u = edge < 2 ? t * r.w / 2 : (edge === 2 ? 1 : -1) * (r.w / 2 + m);
      const v = edge < 2 ? (edge === 0 ? 1 : -1) * (r.d / 2 + m) : t * r.d / 2;
      const x = r.x + u * c - v * s, z = r.z + u * s + v * c;
      if (!blocked(x, z) && !(nearPath && nearPath(x, z, -2.6))) push(x, z, .9);
    }
  }
  const chunks = new Map();
  for (const it of items) {
    const key = `${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`;
    let l = chunks.get(key); if (!l) chunks.set(key, l = []); l.push(it);
  }
  const material = grassMaterial(), variants = [11, 23, 37].map(tuftGeometry);
  const group = new THREE.Group(), dummy = new THREE.Object3D();
  for (const [key, list] of chunks) {
    const [cx, cz] = key.split(',').map(Number), centre = new THREE.Vector3((cx + .5) * CHUNK, 0, (cz + .5) * CHUNK);
    const holder = new THREE.Group();
    variants.forEach((geo, vi) => {
      const sub = list.filter((_, i) => i % variants.length === vi);
      if (!sub.length) return;
      const g = geo.clone(), phase = new Float32Array(sub.length);
      const mesh = new THREE.InstancedMesh(g, material, sub.length);
      sub.forEach((it, i) => {
        dummy.position.set(it.x - centre.x, it.y - .04, it.z - centre.z); dummy.rotation.set(0, it.a, 0); dummy.scale.setScalar(it.s); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix); phase[i] = it.x * .21 + it.z * .13 + (i % 7) * .4;
      });
      g.setAttribute('phase', new THREE.InstancedBufferAttribute(phase, 1));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.receiveShadow = true;
      holder.add(mesh);
    });
    const lod = new THREE.LOD(); lod.position.copy(centre);
    lod.addLevel(holder, 0); lod.addLevel(new THREE.Object3D(), VISIBLE);
    group.add(lod);
  }
  group.name = `${items.length} dry grass tufts`;
  return group;
}
