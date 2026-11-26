// Node materials for the main-street kit (three/webgpu + TSL, WebGPU and WebGL2).
// Roofing is procedural on metre UVs written by the kit: u runs along the eave, v up the slope.
// Each profile gives a height h(u, v); its derivatives perturb the normal (tangent frame from
// the UV derivatives), valleys get a little occlusion, and the albedo is tint * weathering.
// Tints come from vertex colours (passport colours, linear).
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, mix, smoothstep, fract, floor, sin, cos, uv, vertexColor, normalMap, texture,
  mx_noise_float, mx_cell_noise_float, positionWorld, clamp, max, step, uniform, cameraPosition,
} from 'three/tsl';
import { textureSet } from '../../textures.js';
import { TEXTURE_MEAN, snowCap } from '../materials.js';
import { season } from '../../season.js';

const TAU = Math.PI * 2;

// Tangent-space normal from height slopes (dh/du, dh/dv), packed for normalMap().
function slopeNormal(du, dv, strength = 1) {
  const n = vec3(du.mul(-strength), dv.mul(-strength), float(1)).normalize();
  return normalMap(n.mul(.5).add(.5));
}

// Weathering shared by all roofs: large blotches, streaks running down the slope, and
// (for slate and soft tile) lichen/moss in the valleys and along the lower courses.
function weather(u, v, amount = 1) {
  const blotch = mx_noise_float(vec2(u.mul(.35), v.mul(.5))).mul(.5).add(.5);
  const streak = mx_noise_float(vec2(u.mul(3.1), v.mul(.18))).mul(.5).add(.5);
  return float(1).sub(blotch.mul(.16).add(streak.mul(.12)).mul(amount));
}

function roofMaterial(kind) {
  const m = new THREE.MeshStandardNodeMaterial();
  const tint = vertexColor();
  const u = uv().x, v = uv().y;
  const far = smoothstep(18, 70, positionWorld.sub(cameraPosition).length()); // fade fine relief far away
  let albedo, du, dv, rough, metal, ao;
  if (kind === 'slate') {
    // Asbestos-cement wave sheet (шифер): 8 waves per 1.13 m sheet, sheets 1.75 m long laid
    // with a 0.15 m overlap, every course shifted by one wave; aged grey with lichen.
    const P = .1413, row = floor(v.div(1.6)), uu = u.add(row.mul(P));
    const ph = uu.div(P).mul(TAU);
    du = cos(ph).mul(.5 * TAU / .1413 * .02);
    const fv = fract(v.div(1.6));
    dv = smoothstep(.0, .025, fv).sub(1).mul(-.35); // lip of the course above
    ao = sin(ph).mul(.5).add(.5).mul(.22).add(.78).mul(smoothstep(0, .04, fv).mul(.35).add(.65));
    const t = textureSet('slate'), mean = TEXTURE_MEAN.slate;
    const grime = texture(t.color, vec2(u, v).mul(1 / 1.7)).rgb.mul(vec3(1 / mean[0], 1 / mean[1], 1 / mean[2]));
    const lichen = smoothstep(.25, .7, mx_noise_float(vec2(u.mul(.9), v.mul(1.4)).add(7.1))).mul(smoothstep(.2, -.6, sin(ph)).mul(.5).add(.5));
    albedo = tint.mul(grime.mul(.55).add(.45)).mul(weather(u, v, 1.1)).mul(mix(vec3(1), vec3(.62, .66, .5), lichen.mul(.55)));
    rough = float(.95); metal = float(0);
  } else if (kind === 'corrugated') {
    // Galvanised corrugated iron, 76 mm pitch.
    const ph = u.div(.076).mul(TAU);
    du = cos(ph).mul(.32); dv = float(0);
    ao = sin(ph).mul(.5).add(.5).mul(.18).add(.82);
    const rust = smoothstep(.45, .8, mx_noise_float(vec2(u.mul(.6), v.mul(.25)).add(3.3)));
    albedo = mix(tint.mul(weather(u, v, .9)), vec3(.32, .2, .12), rust.mul(.45));
    rough = mix(float(.42), float(.85), rust); metal = mix(float(.55), float(.1), rust);
  } else if (kind === 'profiled') {
    // Trapezoid profiled sheet (профнастил С20): narrow raised ribs every 0.275 m.
    const P = .275, f = fract(u.div(P));
    const rise = step(f, .07), fall = step(.2, f).mul(step(f, .27));
    du = rise.sub(fall).mul(2.2);
    dv = float(0);
    ao = mix(float(1), float(.86), smoothstep(.3, .27, f).mul(smoothstep(.2, .23, f)).add(smoothstep(.07, .0, f).mul(.5)));
    albedo = tint.mul(weather(u, v, .55));
    rough = float(.5); metal = float(.3);
  } else if (kind === 'metal-tile') {
    // Metal tile (металлочерепица "Монтеррей"): 0.35 m step courses with a dark shadow line
    // under each step, and a 0.37 m wave across.
    const ph = u.div(.37).mul(TAU), fv = fract(v.div(.35));
    du = cos(ph).mul(.55);
    dv = smoothstep(.0, .08, fv).mul(-.9).add(.45);
    ao = smoothstep(.0, .14, fv).mul(.45).add(.55).mul(sin(ph).mul(.5).add(.5).mul(.15).add(.85));
    albedo = tint.mul(weather(u, v, .45));
    rough = float(.38); metal = float(.32);
  } else if (kind === 'seam') {
    // Standing seam: a narrow raised seam every 0.5 m, slight oil-canning between.
    const f = fract(u.div(.5));
    const edge = smoothstep(.0, .015, f).sub(smoothstep(.035, .05, f));
    du = smoothstep(0, .02, f).mul(step(f, .02)).mul(2).sub(step(.03, f).mul(step(f, .05)).mul(2)).add(mx_noise_float(vec2(u.mul(2), v.mul(.7))).mul(.05));
    dv = float(0);
    ao = float(1).sub(edge.mul(.08));
    albedo = tint.mul(weather(u, v, .5));
    rough = float(.42); metal = float(.4);
  } else {
    // Soft (bitumen) shingle: staggered 0.33 m tabs with dark gaps and per-tab colour.
    const row = floor(v.div(.2)), uu = u.add(row.mul(.165)), cell = vec2(floor(uu.div(.33)), row);
    const fu = fract(uu.div(.33)), fv = fract(v.div(.2));
    const gap = smoothstep(.0, .03, fu).mul(smoothstep(1, .97, fu)).mul(smoothstep(0, .06, fv));
    const jit = mx_cell_noise_float(vec3(cell, 1.7)).mul(.3).add(.85);
    du = float(0); dv = smoothstep(0, .08, fv).mul(-.6).add(.3);
    ao = gap.mul(.4).add(.6);
    albedo = tint.mul(jit).mul(weather(u, v, .8));
    rough = float(.92); metal = float(0);
  }
  const k = float(1).sub(far.mul(.75));
  m.normalNode = slopeNormal(du.mul(k), dv.mul(k));
  m.colorNode = snowCap(albedo.mul(mix(ao, float(1).sub(float(1).sub(ao).mul(.5)), far)), { threshold: .9 });
  m.roughnessNode = rough;
  m.metalnessNode = metal;
  m.name = `roof ${kind}`;
  return m;
}

// Chain-link mesh (сетка-рабица): diamond wires by alpha test; wires thicken with distance
// so they do not dissolve into noise. uv = (metres along the fence, height).
function meshFenceMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: .5, roughness: .6, metalness: .5 });
  const u = uv().x, v = uv().y, s = .055;
  const dist = positionWorld.sub(cameraPosition).length();
  const wdt = clamp(dist.mul(.006).add(.09), .09, .5);
  const a = fract(u.add(v).div(s)), b = fract(u.sub(v).div(s));
  const wire = max(step(a, wdt), step(b, wdt));
  m.opacityNode = max(wire, smoothstep(40, 90, dist).mul(.6));
  m.colorNode = vertexColor();
  m.name = 'chain-link mesh';
  return m;
}

// Decorative concrete panels (еврозабор): stone courses of random pastel tints.
function euroFenceMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: .95 });
  const u = uv().x, v = uv().y, row = floor(v.div(.11));
  const uu = u.add(row.mul(.13)), cell = vec2(floor(uu.div(.26)), row);
  const c = mx_cell_noise_float(vec3(cell, 3.1)), c2 = mx_cell_noise_float(vec3(cell, 8.4));
  const stone = mix(mix(vec3(.38, .33, .24), vec3(.24, .32, .4), step(.55, c)), vec3(.48, .22, .1), step(.8, c2)).mul(c2.mul(.3).add(.85));
  const fu = fract(uu.div(.26)), fv = fract(v.div(.11));
  const joint = smoothstep(.0, .04, fu).mul(smoothstep(1, .96, fu)).mul(smoothstep(0, .08, fv)).mul(smoothstep(1, .92, fv));
  m.colorNode = mix(vec3(.5, .5, .48), stone, joint).mul(vertexColor());
  m.name = 'euro concrete fence';
  return m;
}

// Painted logs: the log texture under a paint film that is worn on the log crowns.
export function createKitMaterials() {
  const mats = {};
  for (const k of ['slate', 'corrugated', 'profiled', 'metal-tile', 'seam', 'soft-tile']) mats[`roof-${k}`] = roofMaterial(k);
  mats.meshFence = meshFenceMaterial();
  // Painted steel (profiled fence sheets, rails, gate leaves).
  const pm = new THREE.MeshStandardNodeMaterial({ roughness: .5, metalness: .3 });
  pm.colorNode = snowCap(vertexColor(), { threshold: .8 });
  pm.name = 'painted steel';
  mats.paintedMetal = pm;
  mats.euroFence = euroFenceMaterial();
  // Roller shutter slats: horizontal ribs every 4 cm.
  const roller = new THREE.MeshStandardNodeMaterial({ roughness: .6, metalness: .1 });
  const fv = fract(uv().y.div(.045));
  roller.colorNode = vertexColor().mul(smoothstep(0, .2, fv).mul(.25).add(.75));
  roller.normalNode = slopeNormal(float(0), smoothstep(.0, .2, fv).sub(.5).mul(.6));
  roller.name = 'roller shutter';
  mats.roller = roller;
  // Window glass for the kit: sky reflection with a darker room behind, curtains and tulle
  // (vertex colour r = lamp, g = curtain tone), so daylight windows read like the photos.
  const lights = uniform(season.summer ? 0 : 1);
  const glass = new THREE.MeshStandardNodeMaterial({ roughness: .05, metalness: .15 });
  const wuv = uv();
  const tulle = smoothstep(.15, .4, mx_noise_float(vec2(wuv.x.mul(30), wuv.y.mul(2.2))).mul(.5).add(.5)).mul(.18);
  const curtain = smoothstep(.22, .12, wuv.x).add(smoothstep(.78, .88, wuv.x)).min(1);
  const room = mix(vec3(.04, .05, .06), vec3(.42, .4, .36), tulle.add(curtain.mul(.25)));
  glass.colorNode = mix(room, vertexColor().g.mul(vec3(.5, .2, .15)).add(vec3(.25, .22, .2)), curtain.mul(.6));
  const warm = mix(vec3(1, .62, .3), vec3(1, .84, .6), vertexColor().g);
  glass.emissiveNode = warm.mul(vertexColor().r).mul(lights).mul(mix(float(.6), float(1.6), tulle.add(curtain.mul(.3)))).mul(2.2);
  glass.name = 'kit window glass';
  mats.kitGlass = glass;
  Object.assign(mats, yardMaterials());
  return { mats, lights };
}

// Yard content reuses the shared materials (concrete noise for soil, crops, foliage and
// greenhouse covers; rough wood for firewood): no extra draw calls.
function yardMaterials() {
  return {};
}

