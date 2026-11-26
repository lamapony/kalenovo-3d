// Fast geometry accumulator: writes transformed boxes, cylinders and template meshes
// straight into growable typed arrays (position, normal, uv, color) for one material.
import * as THREE from 'three/webgpu';

class Grow {
  constructor(size = 4096) { this.a = new Float32Array(size); this.n = 0; }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
  push2(x, y) {
    if (this.n + 2 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = y;
  }
  view() { return this.a.slice(0, this.n); }
}
class GrowIndex {
  constructor(size = 8192) { this.a = new Uint32Array(size); this.n = 0; }
  push(i) {
    if (this.n + 1 > this.a.length) { const b = new Uint32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = i;
  }
  view() { return this.a.slice(0, this.n); }
}

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();

export class MeshBuilder {
  constructor() {
    this.pos = new Grow(); this.nor = new Grow(); this.uv = new Grow(); this.col = new Grow(); this.idx = new GrowIndex();
    this.count = 0; this.matrix = new THREE.Matrix4(); this.normalMatrix = new THREE.Matrix3();
    this.color = [1, 1, 1];
  }
  setMatrix(m) { this.matrix.copy(m); this.normalMatrix.getNormalMatrix(m); return this; }
  setColor(c) { this.color = Array.isArray(c) ? c : [c.r, c.g, c.b]; return this; }
  vertex(x, y, z, nx, ny, nz, u, v, shade = 1) {
    _v.set(x, y, z).applyMatrix4(this.matrix);
    _n.set(nx, ny, nz).applyMatrix3(this.normalMatrix).normalize();
    this.pos.push3(_v.x, _v.y, _v.z); this.nor.push3(_n.x, _n.y, _n.z); this.uv.push2(u, v);
    const c = this.color; this.col.push3(c[0] * shade, c[1] * shade, c[2] * shade);
    return this.count++;
  }
  tri(a, b, c) { this.idx.push(a); this.idx.push(b); this.idx.push(c); }
  quadIdx(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  // Planar quad p0..p3 (counter-clockwise seen from the front), uv per corner.
  quad(p, uvs, shade = 1) {
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[3][0] - p[0][0], by = p[3][1] - p[0][1], bz = p[3][2] - p[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const i = p.map((q, k) => this.vertex(q[0], q[1], q[2], nx, ny, nz, uvs[k][0], uvs[k][1], shade));
    this.quadIdx(i[0], i[1], i[2], i[3]);
  }
  triangle(p, uvs, shade = 1) {
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1;
    const i = p.map((q, k) => this.vertex(q[0], q[1], q[2], nx / l, ny / l, nz / l, uvs[k][0], uvs[k][1], shade));
    this.tri(i[0], i[1], i[2]);
  }

  // Axis-aligned box in the current frame, centred at (cx, cy, cz). UVs in metres (+ offset).
  // faces: optional set of face names to emit ('px','nx','py','ny','pz','nz').
  box(w, h, d, cx = 0, cy = 0, cz = 0, { uo = 0, vo = 0, faces = null, shadeBottom = .82 } = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const F = name => !faces || faces.includes(name);
    // u along the face's horizontal axis, v up (or along z on horizontal faces).
    if (F('pz')) this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x0 + uo, y0 + vo], [x1 + uo, y0 + vo], [x1 + uo, y1 + vo], [x0 + uo, y1 + vo]]);
    if (F('nz')) this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[-x1 + uo, y0 + vo], [-x0 + uo, y0 + vo], [-x0 + uo, y1 + vo], [-x1 + uo, y1 + vo]]);
    if (F('px')) this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[-z1 + uo, y0 + vo], [-z0 + uo, y0 + vo], [-z0 + uo, y1 + vo], [-z1 + uo, y1 + vo]]);
    if (F('nx')) this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[z0 + uo, y0 + vo], [z1 + uo, y0 + vo], [z1 + uo, y1 + vo], [z0 + uo, y1 + vo]]);
    if (F('py')) this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[x0 + uo, -z1 + vo], [x1 + uo, -z1 + vo], [x1 + uo, -z0 + vo], [x0 + uo, -z0 + vo]]);
    if (F('ny')) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0 + uo, z0 + vo], [x1 + uo, z0 + vo], [x1 + uo, z1 + vo], [x0 + uo, z1 + vo]], shadeBottom);
  }

  // Log along local X from x0 to x1, centre (y, z), elliptical radii ry (vertical) and rz (horizontal).
  // arc: [a0, a1] in radians around the axis, 0 = +z (outward), PI/2 = +y. Full ring when omitted.
  log(x0, x1, y, z, ry, rz, { segments = 8, arc = null, caps = [true, true], uo = 0, vo = 0, outward = 1, capColor = null } = {}) {
    const full = !arc, a0 = full ? 0 : arc[0], a1 = full ? Math.PI * 2 : arc[1];
    const seg = full ? segments : Math.max(2, Math.round(segments * (a1 - a0) / (Math.PI * 2)));
    const base = this.count, perim = (ry + rz) * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * i / seg, cz = Math.cos(a) * outward, sy = Math.sin(a);
      // Fake the dark caulked seam between courses: darker toward top/bottom contact.
      const shade = .62 + .38 * Math.pow(Math.max(0, Math.cos(a) * .9 + .1), .55);
      const u = (a / (Math.PI * 2)) * perim + uo;
      let nz = cz / rz, ny = sy / ry; const l = Math.hypot(nz, ny); nz /= l; ny /= l;
      this.vertex(x0, y + sy * ry, z + cz * rz, 0, ny, nz, u, x0 + vo, shade);
      this.vertex(x1, y + sy * ry, z + cz * rz, 0, ny, nz, u, x1 + vo, shade);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2, b = a + 2;
      if (outward > 0) this.quadIdx(a, a + 1, b + 1, b); else this.quadIdx(a, b, b + 1, a + 1);
    }
    const capRing = 8, sideColor = this.color;
    if (capColor) this.color = capColor;
    [[x0, -1, caps[0]], [x1, 1, caps[1]]].forEach(([x, nx, on]) => {
      if (!on) return;
      const centre = this.vertex(x, y, z, nx, 0, 0, .5 + uo * .1, .5, 1.08);
      const ring = [];
      for (let i = 0; i < capRing; i++) {
        const a = i / capRing * Math.PI * 2;
        ring.push(this.vertex(x, y + Math.sin(a) * ry, z + Math.cos(a) * rz, nx, 0, 0, .5 + Math.cos(a) * rz + uo * .1, .5 + Math.sin(a) * ry, 1.0));
      }
      for (let i = 0; i < capRing; i++) {
        const a = ring[i], b = ring[(i + 1) % capRing];
        // Ring runs counter-clockwise seen from +x when going +z -> +y.
        if (nx > 0) this.tri(centre, b, a); else this.tri(centre, a, b);
      }
    });
    this.color = sideColor;
  }

  // Vertical cylinder (pipes, posts), centred at (x, z), from y0 to y1.
  cylinder(r0, r1, y0, y1, x = 0, z = 0, segments = 8, { cap = true } = {}) {
    const base = this.count;
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      this.vertex(x + c * r0, y0, z + s * r0, c, 0, s, a * r0, y0);
      this.vertex(x + c * r1, y1, z + s * r1, c, 0, s, a * r1, y1);
    }
    for (let i = 0; i < segments; i++) { const a = base + i * 2; this.quadIdx(a, a + 1, a + 3, a + 2); }
    if (cap) {
      const centre = this.vertex(x, y1, z, 0, 1, 0, 0, 0), ring = [];
      for (let i = 0; i < segments; i++) { const a = i / segments * Math.PI * 2; ring.push(this.vertex(x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1, 0, 1, 0, Math.cos(a) * r1, Math.sin(a) * r1)); }
      for (let i = 0; i < segments; i++) this.tri(centre, ring[(i + 1) % segments], ring[i]);
    }
  }

  // Append an indexed or non-indexed BufferGeometry through the current matrix (local matrix optional).
  geometry(geo, local = null, { uvScale = 1, uo = 0, vo = 0 } = {}) {
    const m = local ? new THREE.Matrix4().multiplyMatrices(this.matrix, local) : this.matrix;
    const nm = _m3.getNormalMatrix(m);
    const p = geo.attributes.position, n = geo.attributes.normal, t = geo.attributes.uv, base = this.count, c = this.color;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m);
      _n.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push3(_v.x, _v.y, _v.z); this.nor.push3(_n.x, _n.y, _n.z);
      this.uv.push2(t ? t.getX(i) * uvScale + uo : 0, t ? t.getY(i) * uvScale + vo : 0);
      this.col.push3(c[0], c[1], c[2]);
    }
    this.count += p.count;
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  get empty() { return this.count === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.view(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view(), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.view(), 3));
    g.setIndex(new THREE.BufferAttribute(this.idx.view(), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Builders bucketed by material key and spatial tile, so merged meshes still frustum-cull.
export class TiledBuilders {
  constructor(tileSize = 220) { this.tileSize = tileSize; this.map = new Map(); }
  tileOf(x, z) { return `${Math.floor(x / this.tileSize)},${Math.floor(z / this.tileSize)}`; }
  get(material, x, z, lod = 'near') {
    const key = `${material}|${this.tileOf(x, z)}|${lod}`;
    let b = this.map.get(key);
    if (!b) { b = new MeshBuilder(); b.materialKey = material; b.tile = this.tileOf(x, z); b.lod = lod; this.map.set(key, b); }
    return b;
  }
  *entries() { yield* this.map.values(); }
}
