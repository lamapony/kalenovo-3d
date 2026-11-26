import * as THREE from 'three/webgpu';
import {
  texture, uv, vec2, vec3, float, mix, smoothstep, exp, abs, max, normalMap, mx_noise_float, positionWorld, attribute,
} from 'three/tsl';
import { wayLines } from './village/plan.js';
import { textureSet } from './textures.js';
import { season } from './season.js';

// Cross-section height profile (metres above the sampled ground) for offset o.
function profile(o, hw, bank, water) {
  const a = Math.abs(o);
  if (water) return a > hw ? .1 * Math.sin(Math.PI * Math.min(1, (a - hw) / bank)) : -.02;
  if (a > hw) return .17 * Math.sin(Math.PI * Math.min(1, (a - hw) / bank)) * (1 - .25 * Math.min(1, (a - hw) / bank));
  return .02 * (1 - (a / hw) ** 2);
}

// Continuous ribbon along a polyline, resampled to follow the terrain. uv = (distance, offset) metres,
// uv1 = (half width, bank width) so the shader can place ruts and soft edges in metres.
// fade (0..1) dissolves a free end over fadeStart / fadeEnd metres, so a way that stops
// (dead end, or a T junction inside another road) has no hard cut across the snow.
function ribbonGeometry(points, width, bank, ground, { water = false, lift = .1, columns = 14, step = 2.2, fadeStart = 0, fadeEnd = 0 } = {}) {
  const hw = width / 2, W2 = hw + bank;
  const samples = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) samples.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  if (samples.length < 2) return null;
  let total = 0;
  for (let i = 1; i < samples.length; i++) total += Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]);
  const smooth = t => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
  const fadeAt = d => Math.min(fadeStart > 0 ? smooth(d / fadeStart) : 1, fadeEnd > 0 ? smooth((total - d) / fadeEnd) : 1);
  const pos = [], uvs = [], uv1 = [], fades = [], idx = [];
  let dist = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i], prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
    if (i > 0) dist += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    let tx = next[0] - prev[0], tz = next[1] - prev[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    // Miter: widen at bends so the road keeps its width.
    let miter = 1;
    if (i > 0 && i < samples.length - 1) {
      const ax = p[0] - prev[0], az = p[1] - prev[1], al = Math.hypot(ax, az) || 1;
      miter = Math.min(1.6, 1 / Math.max(.2, Math.abs((ax / al) * tx + (az / al) * tz)));
    }
    const nx = -tz * miter, nz = tx * miter;
    for (let j = 0; j <= columns; j++) {
      const o = -W2 + 2 * W2 * j / columns;
      const x = p[0] + nx * o, z = p[1] + nz * o;
      pos.push(x, ground(x, z) + lift + profile(o, hw, bank, water), z);
      uvs.push(dist, o); uv1.push(hw, bank); fades.push(fadeAt(dist));
    }
    if (i > 0) for (let j = 0; j < columns; j++) {
      const a = (i - 1) * (columns + 1) + j, b = a + columns + 1;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setAttribute('fade', new THREE.Float32BufferAttribute(fades, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Triangle winding above gives downward normals when offsets run left->right; flip if needed.
  const nrm = g.attributes.normal;
  let upSum = 0; for (let i = 0; i < nrm.count; i++) upSum += nrm.getY(i);
  if (upSum < 0) { g.setIndex(idx.map((v, i) => idx[i - (i % 3) + (2 - (i % 3))])); g.computeVertexNormals(); }
  return g;
}

// Two layers per road: 'bank' (snow shoulder, whole ribbon) and 'surface' (packed
// track, alpha = onRoad). Every bank draws before every surface (renderOrder), so
// where ways meet, one road's snow shoulder never paints over another's track.
function roadMaterial(layer) {
  const road = textureSet('road'), ruts = textureSet('ruts'), snow = textureSet('snow');
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const fade = attribute('fade', 'float');
  const d = uv().x, o = uv().y, hw = uv(1).x, bank = uv(1).y, a = abs(o);
  const n1 = mx_noise_float(vec2(d.mul(.21), o.mul(.6))), n2 = mx_noise_float(vec2(d.mul(1.3), o.mul(2.1)));
  const edge = hw.sub(.35).add(n1.mul(.45));
  const onRoad = float(1).sub(smoothstep(edge.sub(.45), edge.add(.35), a));
  // Wheel ruts: one pair near the centre, a second pair on wide roads.
  const c1 = hw.mul(.36).min(.85), c2 = hw.sub(.95);
  const wide = smoothstep(2.6, 3.1, hw);
  const wobble = mx_noise_float(vec2(d.mul(.05), float(3.7))).mul(.18);
  const ar = abs(o.add(wobble));
  const gr = (c, wdt) => exp(ar.sub(c).div(wdt).pow(2).negate());
  const rut = max(gr(c1, .3), gr(c2, .3).mul(wide)).mul(n2.mul(.3).add(.85)).clamp(0, 1);
  const rutCore = max(gr(c1, .12), gr(c2, .12).mul(wide)).mul(smoothstep(-.2, .4, n1));
  const uvR = vec2(o, d).mul(1 / 2.6), uvS = vec2(o, d).mul(1 / 3.2);
  const packed = texture(road.color, uvR).rgb.mul(vec3(.93, .9, .86));
  const dirty = texture(ruts.color, uvR.mul(1.3)).rgb.mul(vec3(.6, .55, .5));
  const bankCol = texture(snow.color, uvS).rgb.mul(vec3(.96, .96, .97));
  // Between the ruts the packed snow is greyed by traffic; ruts are dark, polished and icy.
  const traffic = smoothstep(hw, hw.mul(.3), a).mul(.12).mul(n1.add(1));
  const roadCol = mix(mix(packed, packed.mul(vec3(.82, .8, .78)), traffic), dirty, rut.mul(.85)).mul(float(1).sub(rutCore.mul(.25)));
  m.normalNode = normalMap(texture(road.normal, uvR), vec2(.9, .9));
  m.metalnessNode = float(0);
  if (season.summer) {
    // Dry dirt road: sandy grey-brown, darker compacted ruts, pebbles, grassy fringes.
    const dirt = vec3(.3, .235, .16).mul(n1.mul(.12).add(1)).mul(mx_noise_float(positionWorld.xz.mul(3.1)).mul(.1).add(1));
    const grit = texture(ruts.color, uvR.mul(1.7)).rgb.dot(vec3(.33)).mul(.5).add(.6);
    const rutDirt = mix(dirt.mul(grit), dirt.mul(vec3(.62, .58, .55)), rut.mul(.7));
    const grassy = smoothstep(hw.mul(.55), hw.add(.3), a.add(n2.mul(.5))).mul(.75);
    m.colorNode = mix(rutDirt, vec3(.09, .12, .04), grassy);
    m.roughnessNode = float(.95);
    if (layer === 'bank') {
      // Trampled verge: bare earth breaking up into sparse grass away from the road.
      const verge = mix(dirt.mul(.85), vec3(.12, .15, .05), smoothstep(hw.add(bank.mul(.35)), hw.add(bank), a.add(n2.mul(1.2))).mul(.8));
      m.colorNode = verge;
      m.opacityNode = float(1).sub(smoothstep(hw.add(bank.mul(.6)), hw.add(bank), a.add(n1.mul(.9)))).mul(smoothstep(-.8, -.1, n2.add(.25))).mul(fade);
      m.name = 'road verge (summer)';
    } else {
      m.opacityNode = onRoad.mul(fade);
      m.name = 'dry dirt road';
    }
    return m;
  }
  if (layer === 'bank') {
    m.colorNode = bankCol;
    m.roughnessNode = float(.9);
    m.opacityNode = float(1).sub(smoothstep(hw.add(bank.mul(.45)), hw.add(bank).sub(.05), a.add(n1.mul(.3)))).mul(fade);
    m.name = 'road snow bank';
  } else {
    m.colorNode = roadCol;
    m.roughnessNode = mix(float(.86), float(.52), max(rut.mul(.7), rutCore));
    m.opacityNode = onRoad.mul(fade);
    m.name = 'packed-snow road';
  }
  return m;
}

function iceMaterial() {
  const snow = textureSet('snow');
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const d = uv().x, o = uv().y, hw = uv(1).x, bank = uv(1).y, a = abs(o);
  const n = mx_noise_float(vec2(d.mul(.08), o.mul(.25))).add(mx_noise_float(positionWorld.xz.mul(.4)).mul(.4));
  const snowy = smoothstep(-.1, .35, n).max(smoothstep(hw.sub(1.5), hw.add(.5), a));
  const ice = vec3(.42, .55, .6).add(mx_noise_float(positionWorld.xz.mul(.9)).mul(.05));
  const uvS = vec2(o, d).mul(1 / 3);
  if (season.summer) {
    // Summer: open water, dark and glassy, with a muddy, grassy bank.
    const bankMix = smoothstep(hw.sub(1.2), hw.add(.6), a.add(n.mul(.6)));
    m.colorNode = mix(vec3(.035, .06, .06), vec3(.12, .14, .06), bankMix);
    m.roughnessNode = mix(float(.06), float(.9), bankMix);
  } else {
    m.colorNode = mix(ice, texture(snow.color, uvS).rgb, snowy);
    m.roughnessNode = mix(float(.12), float(.85), snowy);
  }
  m.metalnessNode = float(0);
  m.opacityNode = float(1).sub(smoothstep(hw.add(bank.mul(.4)), hw.add(bank), a)).mul(attribute('fade', 'float'));
  m.name = 'river ice';
  return m;
}

export function createPaths(features, meta, ground) {
  const group = new THREE.Group(), exclusions = [];
  const lines = wayLines(features, meta);
  const bankMat = roadMaterial('bank'), surfaceMat = roadMaterial('surface'), iceMat = iceMaterial();
  // An end shared with another way of the same kind continues the road; any other
  // end is free (dead end or T junction) and fades out.
  const ends = lines.flatMap(l => [l.points[0], l.points[l.points.length - 1]].map(p => ({ p, kind: l.kind })));
  const continued = (line, p) => ends.filter(e => e.kind === line.kind && Math.hypot(e.p[0] - p[0], e.p[1] - p[1]) < 1).length > 1;
  for (const line of lines) {
    const water = line.kind === 'water';
    for (let i = 1; i < line.points.length; i++) exclusions.push({ a: line.points[i - 1], b: line.points[i], radius: line.width / 2 + (water ? 4 : 3) });
    const bank = water ? (line.waterway === 'river' ? 4 : 1.6) : line.foot ? .6 : season.summer ? 5 : 1.9;
    const fadeLen = Math.max(3, line.width * .8);
    const geo = ribbonGeometry(line.points, line.width, bank, ground, {
      water, columns: water ? 12 : line.foot ? 6 : 16, lift: water ? .14 : .1,
      fadeStart: continued(line, line.points[0]) ? 0 : fadeLen,
      fadeEnd: continued(line, line.points[line.points.length - 1]) ? 0 : fadeLen,
    });
    if (!geo) continue;
    const name = `${water ? line.waterway : line.highway} ${line.name || ''}`.trim();
    const layers = water ? [[iceMat, -4]] : [[bankMat, -3], [surfaceMat, -2]];
    for (const [material, order] of layers) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.renderOrder = order;
      mesh.name = `${name} (${material.name})`;
      group.add(mesh);
    }
  }
  group.name = 'OSM winter roads and Ivolga waterways';
  return { group, exclusions, lines };
}
