// Wooden utility poles with crossarms and sagging wires along village streets (generic rural detail).
import * as THREE from 'three/webgpu';
import { randomGenerator } from '../geo.js';
import { inRect } from './plan.js';
import { lin } from './materials.js';

export function buildPoles(B, lines, plan, ground, { spacing = 42 } = {}) {
  const random = randomGenerator(7311), poles = [];
  const plots = plan.plots, rects = plan.rects;
  const free = (x, z) => !rects.some(r => Math.abs(r.x - x) < 16 && Math.abs(r.z - z) < 16 && inRect(x, z, r, 1)) &&
    !plots.some(p => Math.abs(p.rect.x - x) < 40 && Math.abs(p.rect.z - z) < 40 && inRect(x, z, p.rect, .4));
  const nearHouses = (x, z) => plots.some(p => Math.abs(p.house.x - x) < 70 && Math.abs(p.house.z - z) < 70);
  for (const line of lines) {
    if (line.kind !== 'road' || line.foot) continue;
    const side = random() < .5 ? -1 : 1, off = line.width / 2 + 2.6;
    let run = [], carry = random() * spacing;
    const flush = () => { if (run.length > 1) poles.push(run); run = []; };
    for (let i = 1; i < line.points.length; i++) {
      const [ax, az] = line.points[i - 1], [bx, bz] = line.points[i], len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      let d = carry;
      for (; d < len; d += spacing) {
        let placed = null;
        for (const shift of [0, 3, -3, 6, -6]) {
          const t = Math.min(len, Math.max(0, d + shift));
          const x = ax + (bx - ax) * t / len + nx * off * side, z = az + (bz - az) * t / len + nz * off * side;
          if (free(x, z)) { placed = [x, z]; break; }
        }
        if (placed && nearHouses(...placed)) run.push({ x: placed[0], z: placed[1], y: ground(...placed), yaw: Math.atan2(-(bz - az), bx - ax) });
        else flush();
      }
      carry = d - len;
    }
    flush();
  }
  const wood = lin('#6f5f4f'), arm = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const H = 7.6;
  let count = 0;
  for (const run of poles) {
    const tops = [];
    for (const p of run) {
      const lean = (random() - .5) * .05;
      const m = new THREE.Matrix4().makeRotationY(p.yaw).premultiply(new THREE.Matrix4().makeTranslation(p.x, p.y - .6, p.z));
      m.multiply(new THREE.Matrix4().makeRotationZ(lean));
      const b = B.get('logs', p.x, p.z);
      b.setColor(wood).setMatrix(m);
      b.cylinder(.13, .1, 0, H, 0, 0, 7);
      // Crossarm across the street direction (local z) with insulators.
      arm.multiplyMatrices(m, tmp.makeTranslation(0, H - .45, 0));
      b.setMatrix(arm); b.box(.1, .1, 1.5);
      const ins = B.get('painted', p.x, p.z, 'detail');
      ins.setColor(lin('#e9edf0')).setMatrix(arm);
      for (const k of [-.6, 0, .6]) ins.cylinder(.035, .03, .05, .2, 0, k, 6);
      const top = [];
      for (const k of [-.6, 0, .6]) top.push(new THREE.Vector3(0, H - .45 + .2, k).applyMatrix4(m));
      tops.push(top);
      count++;
    }
    // Wires: sagging polylines between consecutive poles.
    const w = B.get('darkMetal', run[0].x, run[0].z);
    w.setColor([.6, .6, .6]);
    for (let i = 1; i < tops.length; i++) for (let k = 0; k < 3; k++) {
      const a = tops[i - 1][k], c = tops[i][k], segs = 8, sag = .55 + random() * .25;
      let prev = a;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs, p = a.clone().lerp(c, t); p.y -= sag * 4 * t * (1 - t);
        const dir = new THREE.Vector3().subVectors(p, prev), len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
        w.setMatrix(new THREE.Matrix4().compose(prev, q, new THREE.Vector3(1, 1, 1)));
        w.log(0, len, 0, 0, .012, .012, { segments: 3, caps: [false, false] });
        prev = p;
      }
    }
  }
  return count;
}
