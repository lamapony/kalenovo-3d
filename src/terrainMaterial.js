import * as THREE from 'three/webgpu';
import {
  cameraPosition, cameraViewMatrix, clamp, float, floor, uniform, mix, mx_cell_noise_float, mx_fractal_noise_float,
  mx_noise_float, normalWorldGeometry, positionWorld, smoothstep, texture, vec2, vec3, vec4,
  dot,
} from 'three/tsl';
import { season } from './season.js';

// CC0 PBR maps from Poly Haven (public/textures/terrain/CREDITS.md). Real
// size of one texture tile in metres, from each asset's published dimensions.
// `mean` is the linear average albedo of each diffuse map (measured offline);
// far away the maps fade to it, so no tile pattern survives into the distance.
const SETS = {
  snow: { file: 'snow_02', tile: 2, mean: [.379, .379, .389] },
  grass: { file: 'withered_grass', tile: 2, mean: [.426, .304, .202] },
  rock: { file: 'rock_ground_02', tile: 3, mean: [.19, .165, .12] },
};

export async function loadTerrainTextures(baseUrl, { anisotropy = 8 } = {}) {
  const loader = new THREE.TextureLoader();
  const load = async (file, srgb) => {
    const tex = await loader.loadAsync(`${baseUrl}textures/terrain/${file}`);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = anisotropy;
    return tex;
  };
  const entries = await Promise.all(Object.entries(SETS).map(async ([key, set]) => {
    const [map, normal] = await Promise.all([load(`${set.file}_diff_1k.jpg`, true), load(`${set.file}_nor_gl_1k.jpg`, false)]);
    return [key, { map, normal, tile: set.tile, mean: set.mean }];
  }));
  return Object.fromEntries(entries);
}

// First-snow ground: thin snow on flats that settles into the hollows of the
// dry grass, exposed earth on steeper and sun-facing slopes, rock on the
// steepest faces. Every map is world-projected on XZ and sampled at two
// scales (the second rotated, ~3.7x larger); a low-frequency noise and the
// view distance choose between them, so the 2-3 m tiles never repeat
// visibly. Snow carries wind-drift relief and tiny glints (see below).
// `far: true` builds the cheap variant for the horizon ring (beyond 1.8 km):
// maps replaced by their mean albedo, no drift relief, no glints.
export function createTerrainMaterial(textures, { lightDirection = new THREE.Vector3(0, 1, 0), far = false } = {}) {
  const glintLight = uniform(lightDirection.clone().normalize());
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .95, metalness: 0 });
  const p = positionWorld.xz;
  const n = normalWorldGeometry;
  // 1 - n.y: 0 on flat ground, ~0.1 at 27 degrees, ~0.3 at 45 degrees.
  const slope = float(1).sub(n.y);
  const distance = positionWorld.sub(cameraPosition).length();
  const detailFade = smoothstep(300, 70, distance); // fine noise would shimmer far away

  const large = mx_fractal_noise_float(vec3(p.mul(.0021), 0), 3, 2, .5);
  const mid = mx_noise_float(vec3(p.mul(.027), 1.7));
  const breakup = mx_noise_float(vec3(p.mul(.09), 5.3));
  const fine = mx_noise_float(vec3(p.mul(.31), 3.1)).mul(detailFade);

  // Two-scale sampling; far away only the large, rotated scale remains.
  const rot = vec2(p.x.mul(.8253).sub(p.y.mul(.5646)), p.x.mul(.5646).add(p.y.mul(.8253)));
  const scaleMix = clamp(smoothstep(-.4, .4, breakup).mul(.55).add(smoothstep(20, 120, distance)), 0, 1);
  const flatten = smoothstep(40, 320, distance).mul(.92);
  const sample = (set, key) => {
    if (far) return key === 'map' ? vec4(vec3(...set.mean), 1) : vec4(.5, .5, 1, 1);
    const a = texture(set[key], p.div(set.tile));
    const b = texture(set[key], rot.div(set.tile * 3.7).add(.37));
    const flat = key === 'map' ? vec4(vec3(...set.mean), 1) : vec4(.5, .5, 1, 1);
    return mix(mix(a, b, scaleMix), flat, flatten);
  };
  const tex = textures;
  const snowAlbedo = sample(tex.snow, 'map').rgb;
  const grassAlbedo = sample(tex.grass, 'map').rgb;
  const rockAlbedo = sample(tex.rock, 'map').rgb;
  const decode = t => t.rgb.mul(2).sub(1);
  const snowN = decode(sample(tex.snow, 'normal'));
  const grassN = decode(sample(tex.grass, 'normal'));
  const rockN = decode(sample(tex.rock, 'normal'));

  // Snow holds less on steep slopes and on slopes facing the low southern sun (+z is south).
  const southFacing = n.z.max(0).mul(slope.mul(8).min(1));
  const snowLine = float(.085).add(large.mul(.045)).add(mid.mul(.02)).sub(southFacing.mul(.035));
  const onSlope = smoothstep(snowLine.sub(.035), snowLine.add(.03), slope);
  // First snow is thin: grass patches show through even on flat ground, and
  // the snow settles between the tufts first (grass brightness as height).
  const grassHeight = grassAlbedo.g.mul(2.2).sub(.55).mul(detailFade);
  const patch = mid.mul(.55).add(large.mul(.25)).add(fine.mul(.3)).add(.5);
  const thin = smoothstep(.66, .95, patch.add(grassHeight.mul(.22)));
  const snowCover = clamp(float(1).sub(onSlope).mul(float(1).sub(thin.mul(.55))), 0, 1);

  // Albedos normalised to plausible values (texture means measured offline):
  // snow ~0.82, frozen dry grass darker and less orange than the summer photo.
  const grass = grassAlbedo.mul(vec3(.6, .76, .86)).mul(mid.mul(.14).add(1));
  const earth = mix(grass, grassAlbedo.mul(vec3(.36, .36, .4)), smoothstep(.12, .25, slope));
  const rock = rockAlbedo.mul(1.15);
  const rockMix = smoothstep(.24, .4, slope.add(large.mul(.06)));
  const ground = mix(earth, rock, rockMix);
  // Snow takes a faint blue in hollows and on the far, large-scale dips.
  const snow = snowAlbedo.mul(2.15).mul(large.mul(.07).add(1)).mul(mix(vec3(.93, .96, 1.0), vec3(1), smoothstep(-.3, .3, mid)));
  // ?season=summer: no snow. Steppe grass (the withered-grass texture's luminance carried
  // into olive and yellow-green, as in the street imagery and the owner's 2013 photo), bare
  // sandy earth in patches, on steeper ground and near the village, rock on the steepest.
  const summer = season.summer;
  let summerGround = null;
  if (summer) {
    const lum = dot(grassAlbedo, vec3(.3, .59, .11)).div(.33);
    const lush = vec3(.115, .165, .055), dry = vec3(.23, .22, .1);
    const green = mix(lush, dry, smoothstep(-.35, .55, mid.mul(.7).add(large.mul(.6)).add(slope.mul(3)))).mul(lum.mul(.55).add(.45));
    const dirt = grassAlbedo.mul(vec3(.66, .64, .6)).mul(fine.mul(.15).add(1));
    const dirtMask = clamp(smoothstep(.62, .86, patch).mul(.8).add(smoothstep(.1, .22, slope)), 0, 1);
    summerGround = mix(mix(green, dirt, dirtMask), rock, rockMix);
  }
  material.colorNode = summer ? summerGround : mix(ground, snow, snowCover);

  // Normals: tangent-space blend, then into world space for the XZ
  // projection (tangent +x = +u, bitangent +z = +v for OpenGL-style maps).
  const groundN = mix(grassN, rockN, rockMix);
  const strength = mix(float(.35), float(1), detailFade);
  const tn = summer ? groundN : mix(groundN, snowN.mul(vec3(.8, .8, 1)), snowCover);

  // Wind-packed drifts: a low (~0.3 m) procedural relief, stretched along the
  // wind, that the grazing winter sun picks out. Normal only, from finite
  // differences of the height noise.
  const drift = q => mx_noise_float(vec3(q.x.mul(.028), q.y.mul(.065), 9.1));
  const h0 = drift(p), e = 1.2;
  const slopeX = drift(p.add(vec2(e, 0))).sub(h0).div(e), slopeZ = drift(p.add(vec2(0, e))).sub(h0).div(e);
  const driftAmp = summer ? float(0) : snowCover.mul(smoothstep(700, 120, distance)).mul(.24);
  const base = far ? n : n.sub(vec3(slopeX, 0, slopeZ).mul(driftAmp)).normalize();

  const t = vec3(1, 0, 0), b = vec3(0, 0, 1);
  const tilted = vec3(tn.x.mul(strength), tn.y.mul(strength), tn.z);
  const world = t.mul(tilted.x).add(b.mul(tilted.y)).add(base.mul(tilted.z)).normalize();

  // Glints: rare 2.5 cm cells whose facet faces the half vector between the
  // key light and the eye, so they flash in sunlight (shadows still apply,
  // and they never darken the diffuse). Which cells flash changes with the
  // view direction, so the snow twinkles while walking.
  const view = cameraPosition.sub(positionWorld).normalize();
  const half = glintLight.add(view).normalize();
  const cellPos = vec3(positionWorld.mul(40));
  const cell = mx_cell_noise_float(cellPos.add(floor(view.mul(14)).mul(7.31)));
  const glint = summer ? float(0) : smoothstep(.9955, .9975, cell).mul(snowCover).mul(smoothstep(35, 5, distance)).mul(smoothstep(.02, .12, glintLight.y));
  const shaded = far ? world : mix(world, half, glint).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(shaded, 0)).xyz.normalize();

  material.roughnessNode = summer ? float(.95) : far ? mix(float(.96), float(.78), snowCover) : mix(mix(float(.96), float(.78), snowCover), float(.22), glint);
  return material;
}
