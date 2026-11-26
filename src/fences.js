// Plot fences: штакетник (instanced pickets), сплошной забор (board panels following the ground),
// жердевой (rail) fences, wickets and roofed vehicle gates. Runs come pre-clipped from village/plan.js.
import * as THREE from 'three/webgpu';
import { texture, vec2, vec3, positionWorld, normalWorld, attribute, float, clamp } from 'three/tsl';
import { textureSet } from './textures.js';
import { snowCap, lin, jitter, TEXTURE_MEAN } from './village/materials.js';
import { randomGenerator } from './geo.js';

const FENCE_PAINT = ['#8a8276', '#8a8276', '#7b746a', '#958a7a', '#6f8f6a', '#6c8aa3', '#8a6a52', '#c9c2b2', '#5d7f99', '#8f9c78'];

// Instanced wood: world-space UVs on vertical faces so scaled instances keep board proportions.
function instancedWoodMaterial() {
  const t = textureSet('planks');
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const u = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
  const uvW = vec2(u.add(positionWorld.y.mul(normalWorld.y)), positionWorld.y).mul(vec2(1 / 2.2, 1 / 2.2));
  const mean = TEXTURE_MEAN.planks;
  m.colorNode = snowCap(texture(t.color, uvW).rgb.mul(vec3(1 / mean[0], 1 / mean[1], 1 / mean[2])).mul(attribute('tint', 'vec3')), { threshold: .55 });
  m.roughnessNode = clamp(texture(t.rough, uvW).r.add(.1), .3, 1);
  m.metalnessNode = float(0);
  m.name = 'fence wood (instanced)';
  return m;
}

function picketGeometry() {
  const w = .085, s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, .9); s.lineTo(0, 1); s.lineTo(-w / 2, .9); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: .022, bevelEnabled: false });
  g.translate(0, 0, -.011);
  return g;
}

export function createFences(plots, ground, B, { tileSize = 220 } = {}) {
  const pickets = new Map(), posts = new Map();
  const add = (map, x, z, item) => {
    const key = `${Math.floor(x / tileSize)},${Math.floor(z / tileSize)}`;
    let list = map.get(key); if (!list) map.set(key, list = []); list.push(item);
  };
  const up = new THREE.Vector3(0, 1, 0);
  let totalPickets = 0;

  // Street-side life: a bench by the wicket and the odd woodpile along the front fence (outside).
  function streetLife(f, { P, ux, uz, ox, oz, random }) {
    const inRun = (t, half) => t - half > f.t0 + .2 && t + half < f.t1 - .2 && !f.gates.some(g => Math.abs(g.t - t) < g.width / 2 + half + .3);
    // Frame: x along the fence, z outward toward the street.
    const flip = (-uz * ox + ux * oz) < 0 ? -1 : 1;
    const X = new THREE.Vector3(ux * flip, 0, uz * flip), Z = new THREE.Vector3().crossVectors(X, up);
    const wicket = f.gates.find(g => g.type === 'wicket');
    if (wicket && random() < .45) {
      const t = wicket.t + (random() < .5 ? -1 : 1) * (wicket.width / 2 + 1.1);
      if (inRun(t, .75)) {
        const [bx, bz] = P(t), x = bx + ox * .5, z = bz + oz * .5, y = ground(x, z);
        const b = B.get('planks', x, z);
        b.setMatrix(new THREE.Matrix4().makeBasis(X, up, Z).setPosition(x, y, z));
        b.setColor(lin('#8d7b66'));
        b.box(1.5, .05, .34, 0, .46, 0);
        for (const lx of [-.6, .6]) b.box(.07, .48, .3, lx, .22, 0);
        b.box(1.5, .13, .03, 0, .78, -.17);
        for (const lx of [-.6, .6]) b.box(.06, .45, .05, lx, .62, -.17);
      }
    }
    if (random() < .2) {
      const L = 2 + random() * 1.4, t = f.t0 + .6 + L / 2 + random() * Math.max(0, f.t1 - f.t0 - L - 1.2);
      if (!inRun(t, L / 2)) return;
      const [cx, cz] = P(t), x = cx + ox * .38, z = cz + oz * .38, y = ground(x, z) - .03;
      // Logs lie across the pile (along Z), stacked in staggered rows along X.
      const LX = Z.clone(), LZ = new THREE.Vector3().crossVectors(LX, up);
      const frame = new THREE.Matrix4().makeBasis(LX, up, LZ).setPosition(x, y, z);
      const w = B.get('logs', x, z);
      w.setMatrix(frame);
      const rows = 5 + Math.floor(random() * 3), cols = Math.floor(L / .18);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols - (r % 2); c++) {
        w.setColor(jitter(lin('#9a7c5c'), random, .12));
        w.log(-.21, .21, .09 + r * .165, -L / 2 + .09 + c * .18 + (r % 2) * .09, .085, .085, { segments: 6, caps: [true, true], uo: random() * 3, vo: random() * 3, capColor: jitter(lin('#e3c79a'), random, .1) });
      }
      const sn = B.get('snow', x, z);
      sn.setMatrix(frame);
      sn.box(.5, .09, L - .05, 0, .09 + rows * .165 + .01, 0);
    }
  }

  for (const plot of plots) {
    const random = randomGenerator(plot.seed ^ 0x1b873593);
    const pc = plot.rect;
    const paintIndex = Math.floor((plot.fences[0]?.paint ?? random()) * FENCE_PAINT.length) % FENCE_PAINT.length;
    const paint = lin(FENCE_PAINT[paintIndex]);
    const gatePaint = lin(FENCE_PAINT[(paintIndex + 3) % FENCE_PAINT.length]).map(v => v * .85);
    for (const f of plot.fences) {
      const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      // Rails and braces go on the plot side.
      let nx = -uz, nz = ux;
      const mx = f.a[0] + ux * (f.t0 + f.t1) / 2, mz = f.a[1] + uz * (f.t0 + f.t1) / 2;
      if ((pc.x - mx) * nx + (pc.z - mz) * nz < 0) { nx = -nx; nz = -nz; }
      const P = d => [f.a[0] + ux * d, f.a[1] + uz * d];
      const yaw = Math.atan2(-uz, ux);
      // Panel intervals between gates.
      let spans = [[f.t0, f.t1]];
      for (const g of f.gates) {
        const g0 = g.t - g.width / 2 - .08, g1 = g.t + g.width / 2 + .08;
        spans = spans.flatMap(([a, c]) => (g1 <= a || g0 >= c) ? [[a, c]] : [[a, g0], [g1, c]].filter(([p, q]) => q - p > .3));
      }
      const h = f.height, tint = jitter(paint, random, .05);
      for (const [s0, s1] of spans) {
        const n = Math.max(1, Math.ceil((s1 - s0) / 2.4)), step = (s1 - s0) / n;
        const postPos = [];
        for (let i = 0; i <= n; i++) {
          const d = s0 + i * step, [x, z] = P(d), y = ground(x, z);
          postPos.push([x, y, z, d]);
          add(posts, x, z, { x, y, z, yaw, h: h + .08, s: f.style === 'rail' ? .13 : .1, tint: tint.map(v => v * .78) });
        }
        for (let i = 0; i < n; i++) {
          const [x0, y0, z0] = postPos[i], [x1, y1, z1] = postPos[i + 1];
          const L3 = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
          const X = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
          const frameAt = (yOff, off) => {
            const o = new THREE.Vector3((x0 + x1) / 2 + nx * off, (y0 + y1) / 2 + yOff, (z0 + z1) / 2 + nz * off);
            const Z = new THREE.Vector3().crossVectors(X, up).normalize(), Y = new THREE.Vector3().crossVectors(Z, X);
            return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(o);
          };
          if (f.style === 'picket') {
            const rails = B.get('planks', x0, z0);
            rails.setColor(tint.map(v => v * .9));
            for (const ry of [.28, h - .3]) { rails.setMatrix(frameAt(ry, .035)); rails.box(L3, .075, .035); }
            const count = Math.max(1, Math.round(L3 / .15));
            for (let k = 0; k < count; k++) {
              const t = (k + .5) / count, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
              add(pickets, x, z, { x, y: ground(x, z) + .04, z, yaw, h: h * (.97 + random() * .06), tint: jitter(tint, random, .04) });
              totalPickets++;
            }
          } else if (f.style === 'solid') {
            const b = B.get('planks', x0, z0);
            b.setColor(tint);
            // Boards follow the ground between posts: a skewed slab.
            const t2 = .013, gap = .06;
            // Quad winding a->b->top gives normal n0 = (-uz, ux); that face sits on the +n0 side.
            const n0x = -uz, n0z = ux;
            const corners = (o) => [
              [x0 + n0x * o, y0 + gap, z0 + n0z * o], [x1 + n0x * o, y1 + gap, z1 + n0z * o],
              [x1 + n0x * o, y1 + h, z1 + n0z * o], [x0 + n0x * o, y0 + h, z0 + n0z * o]];
            b.setMatrix(new THREE.Matrix4());
            const fr = corners(t2), bk = corners(-t2), da = postPos[i][3];
            const uvF = [[da, y0 + gap], [da + step, y1 + gap], [da + step, y1 + h], [da, y0 + h]];
            b.quad(fr, uvF); b.quad([bk[1], bk[0], bk[3], bk[2]], [uvF[1], uvF[0], uvF[3], uvF[2]]);
            b.quad([fr[3], fr[2], bk[2], bk[3]], [[da, 0], [da + step, 0], [da + step, .03], [da, .03]]);
            // Horizontal battens on the plot side.
            b.setColor(tint.map(v => v * .85));
            for (const ry of [.35, h - .35]) { b.setMatrix(frameAt(ry, .04)); b.box(L3, .09, .03); }
          } else {
            // Rail fence: two or three peeled poles.
            const r = B.get('logs', x0, z0);
            r.setColor(jitter(lin('#8f7a62'), random, .08));
            const levels = h > 1.1 ? [.45, .85, h - .05] : [.45, h - .05];
            for (const ry of levels) {
              r.setMatrix(frameAt(ry, 0));
              r.log(-L3 / 2 - .1, L3 / 2 + .1, 0, 0, .045, .05, { segments: 6, uo: random() * 2, vo: random() * 4 });
            }
          }
        }
      }
      // Gates.
      for (const g of f.gates) {
        const [cx, cz] = P(g.t), y = ground(cx, cz);
        const gh = g.type === 'gate' ? Math.max(h, 1.75) + .05 : h + .05;
        const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(cx, y, cz);
        const b = B.get('planks', cx, cz);
        b.setMatrix(frame);
        b.setColor(gatePaint);
        const leafs = g.type === 'gate' ? [[-g.width / 4, g.width / 2 - .05], [g.width / 4, g.width / 2 - .05]] : [[0, g.width - .06]];
        // Gate-local +z is (sin yaw, cos yaw) in world xz; braces go on the plot side.
        const side = Math.sign(Math.sin(yaw) * nx + Math.cos(yaw) * nz) || 1;
        for (const [lx, lw] of leafs) {
          b.box(lw, gh - .1, .03, lx, .08 + (gh - .1) / 2, 0, { uo: lx });
          b.box(lw - .04, .1, .03, lx, .35, side * .03);
          b.box(lw - .04, .1, .03, lx, gh - .35, side * .03);
          // Diagonal brace.
          const diag = Math.hypot(lw - .1, gh - .8), ang = Math.atan2(gh - .8, lw - .1);
          b.setMatrix(new THREE.Matrix4().multiplyMatrices(frame, new THREE.Matrix4().makeTranslation(lx, gh / 2 + .05, side * .03).multiply(new THREE.Matrix4().makeRotationZ(ang))));
          b.box(diag, .09, .03);
          b.setMatrix(frame);
        }
        const ph = g.type === 'gate' ? gh + .45 : gh + .2, ps = g.type === 'gate' ? .17 : .12;
        const pb = B.get('planks', cx, cz);
        pb.setMatrix(frame);
        pb.setColor(gatePaint.map(v => v * .8));
        for (const s of [-1, 1]) pb.box(ps, ph + .3, ps, s * (g.width / 2 + ps / 2 - .02), (ph - .3) / 2, 0);
        if (g.type === 'gate') {
          // Top beam with a little gable roof (ворота с козырьком).
          pb.box(g.width + ps * 2 + .3, .16, .16, 0, ph - .05, 0);
          const roofW = g.width + ps * 2 + .6;
          for (const s of [-1, 1]) {
            const m = new THREE.Matrix4().multiplyMatrices(frame, new THREE.Matrix4().makeTranslation(0, ph + .13, s * .2).multiply(new THREE.Matrix4().makeRotationX(s * .55)));
            pb.setMatrix(m); pb.box(roofW, .03, .5);
            const sn = B.get('snow', cx, cz);
            sn.setMatrix(new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, .07, 0)));
            sn.box(roofW - .06, .1, .46);
          }
        }
      }
      if (f.side === 'front') streetLife(f, { P, ux, uz, ox: -nx, oz: -nz, random });
    }
  }

  // Instanced meshes per tile, with distant picket tiles dropped by a LOD.
  const group = new THREE.Group();
  group.name = `Fences: ${totalPickets} pickets`;
  const material = instancedWoodMaterial();
  const picketGeo = picketGeometry();
  const postGeo = new THREE.BoxGeometry(1, 1, 1); postGeo.translate(0, .5, 0);
  const dummy = new THREE.Object3D();
  function instanced(geometry, items, scaleFn) {
    const geo = geometry.clone();
    const tint = new Float32Array(items.length * 3);
    items.forEach((it, i) => tint.set(it.tint, i * 3));
    geo.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 3));
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.yaw, 0); scaleFn(dummy.scale, it); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  for (const [key, items] of pickets) {
    const [tx, tz] = key.split(',').map(Number);
    const centre = new THREE.Vector3((tx + .5) * tileSize, 0, (tz + .5) * tileSize);
    const mesh = instanced(picketGeo, items, (s, it) => s.set(1, it.h, 1));
    const lod = new THREE.LOD();
    lod.position.copy(centre); mesh.position.copy(centre).negate();
    const holder = new THREE.Group(); holder.add(mesh);
    lod.addLevel(holder, 0); lod.addLevel(new THREE.Object3D(), 340);
    group.add(lod);
  }
  for (const items of posts.values()) group.add(instanced(postGeo, items, (s, it) => s.set(it.s, it.h, it.s)));
  return { group, pickets: totalPickets };
}
