import * as THREE from 'three/webgpu';
import {
  cameraPosition, cameraViewMatrix, clamp, float, floor, uniform, mix, mx_cell_noise_float, mx_fractal_noise_float,
  mx_noise_float, normalWorldGeometry, positionWorld, smoothstep, texture, vec2, vec3, vec4,
  step, fract,
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
  // Village ground: trodden dirt and gravel (both seasons), patchy summer grass.
  trail: { file: 'rocky_trail', tile: 2, mean: [.298, .222, .147], summerOnly: true },
  sgrass: { file: 'sparse_grass', tile: 2, mean: [.077, .044, .004], summerOnly: true },
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
  const entries = await Promise.all(Object.entries(SETS).filter(([, set]) => !set.summerOnly || season.summer).map(async ([key, set]) => {
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
export function createTerrainMaterial(textures, { lightDirection = new THREE.Vector3(0, 1, 0), far = false, groundMask = null } = {}) {
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
  // Village ground mask (src/village/kit/groundMask.js): R trodden dirt, G gravel/paving,
  // B tilled soil, sampled with a little positional wobble so edges are never straight.
  let maskR = float(0), maskG = float(0), maskB = float(0), maskA = float(0);
  if (groundMask && !far) {
    const mt = new THREE.DataTexture(groundMask.data, groundMask.width, groundMask.height, THREE.RGBAFormat);
    // Mipmapped: distant terrain then reads a small, cache-friendly level of the 20 MB mask.
    mt.magFilter = THREE.LinearFilter; mt.minFilter = THREE.LinearMipmapLinearFilter; mt.generateMipmaps = true; mt.needsUpdate = true;
    const wob = vec2(breakup, mid).mul(1.2); // reuse the ground noises: no extra noise cost
    const muv = p.add(wob).sub(vec2(groundMask.x0, groundMask.z0)).div(vec2(groundMask.sizeX, groundMask.sizeZ));
    const inside = step(0, muv.x).mul(step(muv.x, 1)).mul(step(0, muv.y)).mul(step(muv.y, 1));
    const m = texture(mt, muv).mul(inside);
    const edge = fine.mul(.35).add(breakup.mul(.15));
    maskR = smoothstep(.25, .75, m.r.add(edge)); maskG = smoothstep(.3, .7, m.g.add(edge.mul(.5))); maskB = smoothstep(.4, .6, m.b); maskA = smoothstep(.45, .55, m.a);
  }
  // Winter only needs the dirt colour where wheels wear through the snow: no texture there.
  const trailMap = far || !season.summer ? vec3(...SETS.trail.mean).mul(fine.mul(.25).add(1)) : mix(texture(tex.trail.map, p.div(tex.trail.tile)).rgb, vec3(...SETS.trail.mean), flatten);
  const trailN = far || !season.summer ? vec3(0, 0, 1) : decode(texture(tex.trail.normal, p.div(tex.trail.tile)));
  // ?season=summer: no snow. Patchy steppe grass (the sparse-grass photo texture white-balanced
  // to the green of the street imagery), dry yellow patches, darker weedy clumps, bare spots;
  // sandy trodden dirt in yards and along fences, gravel at the gates, tilled soil in the beds.
  const summer = season.summer;
  let summerGround = null, summerN = null;
  if (summer) {
    const sg = far ? vec3(.11, .16, .04) : sample(tex.sgrass, 'map').rgb.mul(vec3(1.7, 3.5, 11));
    const sgN = far ? vec3(0, 0, 1) : decode(sample(tex.sgrass, 'normal'));
    const tone = mid.mul(.8).add(breakup.mul(.45)).add(large.mul(.6)).add(slope.mul(3));
    const dryK = smoothstep(-.1, .6, tone), lushK = smoothstep(.05, -.55, tone);
    let field = sg.mul(mix(vec3(1), vec3(1.4, 1.2, .85), dryK.mul(.8))).mul(mix(vec3(1), vec3(.78, .98, .8), lushK));
    const weeds = smoothstep(.3, .7, breakup.mul(.6).add(fine.mul(.6)));
    field = field.mul(mix(float(1), float(.72), weeds.mul(.6)));
    const dirt = trailMap.mul(fine.mul(.12).add(1));
    const bare = clamp(smoothstep(.72, .9, patch.add(breakup.mul(.12))).mul(.6).add(smoothstep(.12, .24, slope)), 0, 1);
    const trod = clamp(maskR.mul(fine.mul(.25).add(.85)).max(bare), 0, 1);
    const gravel = mix(trailMap, vec3(.32, .26, .19), .3).mul(vec3(1.15, 1.12, 1.08)).mul(fine.mul(.12).add(1));
    const soilC = vec3(.08, .058, .042).mul(fine.mul(.2).add(1));
    // Concrete paving tiles (0.4 m, dark joints, slight per-tile tone) on paved drives.
    const tile = vec2(fract(p.x.div(.4)), fract(p.y.div(.4)));
    const joint = smoothstep(.0, .04, tile.x).mul(smoothstep(1, .96, tile.x)).mul(smoothstep(0, .04, tile.y)).mul(smoothstep(1, .96, tile.y));
    const tileTone = mx_cell_noise_float(vec3(floor(p.div(.4)), 5.5)).mul(.18).add(.9);
    const paving = mix(vec3(.12, .11, .1), vec3(.38, .34, .3).mul(tileTone), joint).mul(fine.mul(.1).add(1));
    summerGround = mix(mix(mix(mix(mix(field, dirt, trod), gravel, maskG), soilC, maskB), paving, maskA), rock, rockMix);
    summerN = mix(mix(sgN, trailN, trod.max(maskG)), rockN, rockMix);
  }
  // Winter: trampled grey snow in yards and paths, wheel-worn dirt showing at the gates.
  const trampled = snow.mul(mix(vec3(1), vec3(.8, .79, .8), maskR.mul(.85)));
  const worn = mix(trampled, trailMap.mul(.75), maskG.max(maskA).mul(smoothstep(-.3, .5, mid.add(fine)).mul(.55)));
  material.colorNode = summer ? summerGround : mix(ground, worn, snowCover);

  // Normals: tangent-space blend, then into world space for the XZ
  // projection (tangent +x = +u, bitangent +z = +v for OpenGL-style maps).
  const groundN = mix(grassN, rockN, rockMix);
  const strength = mix(float(.35), float(1), detailFade);
  const tn = summer ? summerN : mix(groundN, snowN.mul(vec3(.8, .8, 1)), snowCover);

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
