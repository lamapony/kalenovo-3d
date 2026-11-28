// Node materials (three/webgpu + TSL) for village content. Works on WebGPU and its WebGL2 fallback.
import * as THREE from 'three/webgpu';
import {
  texture, uv, vec2, vec3, float, mix, smoothstep, normalWorld, positionWorld, vertexColor, normalMap,
  uniform, color, mx_noise_float, fract, clamp,
} from 'three/tsl';
import { textureSet } from '../textures.js';
import { season } from '../season.js';

export const SNOW_COLOR = '#eef2f6';

// Mean linear albedo of each colour map (measured offline), used to normalise tints.
export const TEXTURE_MEAN = {
  logs: [.148, .124, .098], planks: [.062, .059, .051], painted: [.449, .382, .306],
  metal: [.402, .449, .426], slate: [.174, .148, .127], brick: [.246, .158, .098],
};

// Snow settling on up-facing surfaces (sills, rails, picket tips) via world normal + noise.
export function snowCap(baseColor, { threshold = .62, strength = 1 } = {}) {
  if (season.summer) return baseColor;
  const n = mx_noise_float(positionWorld.mul(2.7)).mul(.18);
  const k = smoothstep(threshold, threshold + .22, normalWorld.y.add(n)).mul(strength);
  return mix(baseColor, color(SNOW_COLOR), k);
}

// Textured PBR material with metre-based UVs scaled per set. tintNode multiplies albedo.
export function pbrMaterial({ set, scale = [1, 1], tintNode = null, uvNode = null, snow = false, snowThreshold = .62,
  roughness = 1, roughnessBias = 0, metalness = 0, normalScale = 1, useNormal = true, colorize = null, name } = {}) {
  // Albedo is divided by the texture's mean colour, so tints are the intended albedo.
  const mean = TEXTURE_MEAN[set];
  const m = new THREE.MeshStandardNodeMaterial();
  const t = textureSet(set);
  const uvS = (uvNode ?? uv()).mul(vec2(1 / scale[0], 1 / scale[1]));
  let albedo = texture(t.color, uvS).rgb;
  if (mean) albedo = albedo.mul(vec3(1 / mean[0], 1 / mean[1], 1 / mean[2]));
  if (colorize) albedo = colorize(albedo, uvS);
  if (tintNode) albedo = albedo.mul(tintNode);
  if (snow) albedo = snowCap(albedo, { threshold: snowThreshold });
  m.colorNode = albedo;
  if (useNormal) m.normalNode = normalMap(texture(t.normal, uvS), vec2(normalScale, normalScale));
  m.roughnessNode = clamp(texture(t.rough, uvS).r.mul(roughness).add(roughnessBias), .04, 1);
  m.metalnessNode = float(metalness);
  m.name = name || set;
  return m;
}

export function createVillageMaterials() {
  const lights = uniform(1);
  const tint = vertexColor();
  const mats = {
    logs: pbrMaterial({ set: 'logs', scale: [.9, 1.9], tintNode: tint, roughness: 1, normalScale: 1.3, name: 'logs' }),
    planks: pbrMaterial({ set: 'planks', scale: [2.2, 2.2], tintNode: tint, snow: true, normalScale: 1.2, name: 'planks' }),
    painted: pbrMaterial({ set: 'painted', scale: [1.3, 1.3], tintNode: tint, snow: true, snowThreshold: .7, name: 'painted' }),
    // Horizontal lap siding: painted wood with a dark groove every 16 cm.
    siding: pbrMaterial({
      set: 'painted', scale: [1.6, 1.6], tintNode: tint, name: 'siding',
      colorize: (c) => {
        const v = fract(uv().y.div(.16));
        const groove = smoothstep(0, .07, v).mul(smoothstep(1, .9, v)).mul(.35).add(.65);
        return c.mul(groove);
      },
    }),
    metal: pbrMaterial({ set: 'metal', scale: [1.1, 1.1], tintNode: tint, metalness: .45, roughness: .85, roughnessBias: .05, name: 'metal roof' }),
    slate: pbrMaterial({ set: 'slate', scale: [1.5, 1.5], tintNode: tint, roughness: 1, normalScale: 1.4, name: 'slate roof' }),
    snow: pbrMaterial({ set: 'snow', scale: [2.4, 2.4], tintNode: vec3(1.02, 1.03, 1.06), roughness: .9, normalScale: .8, name: 'roof snow' }),
    brick: pbrMaterial({ set: 'brick', scale: [1.1, 1.1], tintNode: tint, snow: true, snowThreshold: .8, name: 'brick' }),
  };
  // Plinth concrete: procedural, no texture needed.
  const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const cn = mx_noise_float(positionWorld.mul(1.9)).mul(.08).add(mx_noise_float(positionWorld.mul(9)).mul(.04));
  concrete.colorNode = snowCap(tint.mul(vec3(.58, .57, .54).add(cn)), { threshold: .75 });
  concrete.name = 'concrete';
  mats.concrete = concrete;

  const darkMetal = new THREE.MeshStandardNodeMaterial({ roughness: .55, metalness: .6 });
  darkMetal.colorNode = snowCap(tint.mul(vec3(.18, .18, .19)), { threshold: .8 });
  darkMetal.name = 'dark metal';
  mats.darkMetal = darkMetal;

  // Window glass: dark reflective by day; warm interior glow with curtains when lights are on.
  // Vertex colour: r = this window's lamp brightness (0 = dark room), g = curtain tone, b = unused.
  const glass = new THREE.MeshStandardNodeMaterial({ roughness: .08, metalness: .1 });
  glass.colorNode = vec3(.05, .07, .09);
  const wuv = uv();
  const sideCurtain = smoothstep(.2, .32, wuv.x).mul(smoothstep(.8, .68, wuv.x));
  const tulle = mx_noise_float(vec2(wuv.x.mul(40), wuv.y.mul(3))).mul(.12).add(.88);
  const room = mix(float(.35), float(1), sideCurtain).mul(tulle).mul(smoothstep(-.1, .7, wuv.y).mul(.3).add(.7));
  const warm = mix(color('#ffb35c'), color('#ffd9a0'), tint.g);
  glass.emissiveNode = warm.mul(room).mul(tint.r).mul(lights).mul(2.4);
  glass.name = 'window glass';
  mats.glass = glass;

  // Interior darkness behind open doorways / gaps.
  const dark = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  dark.colorNode = vec3(.03, .03, .03);
  mats.dark = dark;

  return { mats, lights };
}

// Tint helpers: sRGB hex -> linear [r,g,b] for vertex colours.
const _c = new THREE.Color();
export function lin(hex, mul = 1) { _c.set(hex); return [_c.r * mul, _c.g * mul, _c.b * mul]; }
export function jitter(rgb, random, amount = .08) { const k = 1 + (random() - .5) * 2 * amount; return rgb.map(v => v * k); }
