import * as THREE from 'three/webgpu';
import {
  Fn, cameraPosition, clamp, color, dot, exp, float, floor, fog, instancedBufferAttribute, max, mix,
  mx_cell_noise_float, mx_fractal_noise_float, normalize, positionWorld, pow, sin, smoothstep, uniform, uv,
  texture, vec2, vec3, vec4,
} from 'three/tsl';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { randomGenerator } from './geo.js';
import { TIMES_OF_DAY, sceneSun, sunDirection } from './sun.js';

// Look presets per time of day (?tod=). Colours are linear radiance before
// exposure and tone mapping. The sun direction always comes from src/sun.js;
// the night moon is artistic (no lunar ephemeris): a fixed direction high in
// the south-east, so the village is lit from the side opposite the sunset.
export const LOOKS = {
  afternoon: {
    light: '#ffe2b6', intensity: 10,
    zenith: [.05, .14, .42], mid: [.3, .46, .86], horizonCool: [.5, .58, .86], horizonWarm: [1.8, 1.32, .72],
    glow: [2.4, 1.72, .9], cloudLit: [1.95, 1.5, 1.15], cloudShade: [.34, .37, .56], coverage: .5,
    aerial: [.15, .2, .5], fogDensity: 1 / 6500, valleyMist: .1, envIntensity: .5, hemi: ['#a4c6ff', '#e6dccd', .16],
    exposure: .78, flakes: [1, .97, .95], sunDisc: 60, smoke: [.34, .35, .39],
  },
  sunset: {
    light: '#ffb27c', intensity: 6.5,
    zenith: [.045, .08, .25], mid: [.3, .3, .56], horizonCool: [.52, .42, .62], horizonWarm: [2.6, 1.25, .48],
    glow: [3.4, 1.4, .5], cloudLit: [2.6, 1.15, .62], cloudShade: [.27, .23, .4], coverage: .48,
    aerial: [.2, .16, .4], fogDensity: 1 / 6000, valleyMist: .16, envIntensity: .38, hemi: ['#8e9cff', '#e7c9b6', .12],
    exposure: .95, flakes: [1, .86, .78], sunDisc: 45, smoke: [.26, .23, .27],
  },
  night: {
    light: '#c2d0ff', intensity: .7, moon: { azimuth: 130, elevation: 32 },
    zenith: [.0035, .007, .02], mid: [.008, .014, .034], horizonCool: [.016, .024, .052], horizonWarm: [.03, .036, .06],
    glow: [.03, .036, .05], cloudLit: [.05, .058, .085], cloudShade: [.008, .011, .02], coverage: .58,
    aerial: [.008, .012, .03], fogDensity: 1 / 5000, valleyMist: .14, envIntensity: .03, hemi: ['#4a64a8', '#2a3048', .35],
    exposure: 1.9, flakes: [.18, .2, .26], sunDisc: 6, smoke: [.016, .019, .03],
  },
};

// Smooth 3 x 3 PCF (each tap is a hardware 2 x 2 compare). three's default
// PCF rotates 5 taps by per-pixel noise, which reads as a dithered screen
// door in the penumbra without TAA; this costs 9 taps and has no noise.
function smoothPCF(texelSpacing) {
  return Fn(({ depthTexture, shadowCoord, depthLayer }) => {
    let sum = float(0);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      let depth = texture(depthTexture, shadowCoord.xy.add(vec2(i * texelSpacing, j * texelSpacing)));
      if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer);
      sum = sum.add(depth.compare(shadowCoord.z));
    }
    return sum.div(9);
  });
}

const HDRI_SUN_U = .5996; // Stierberg Sunrise: brightest texel at u = 0.5996, 3 deg high
const HDRI_SUN_CLAMP = 24; // radiance cap that removes the sun disc but keeps the glow

// Clamp the sun out of the HDRI (the DirectionalLight already provides it; a
// second sun in the irradiance would flatten shadows), then rotate the
// environment so its warm horizon glow sits under the scene's sun.
export function prepareEnvironment(texture) {
  const data = texture.image.data;
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    if (m > HDRI_SUN_CLAMP) { const k = HDRI_SUN_CLAMP / m; data[i] *= k; data[i + 1] *= k; data[i + 2] *= k; }
  }
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

// Direction towards the key light (sun, or the night moon) for a time of day.
export function keyLightDirection(tod = 'afternoon') {
  const look = LOOKS[tod] ?? LOOKS.afternoon;
  const d = look.moon ? sunDirection(look.moon.azimuth, look.moon.elevation) : sceneSun(TIMES_OF_DAY[tod] ?? TIMES_OF_DAY.afternoon).direction;
  return new THREE.Vector3(d.x, d.y, d.z).normalize();
}

export function createAtmosphere(scene, camera, { quality = 'high', tod = 'afternoon', environment = null } = {}) {
  const look = LOOKS[tod] ?? LOOKS.afternoon;
  const sun = sceneSun(TIMES_OF_DAY[tod] ?? TIMES_OF_DAY.afternoon);
  const lightDir = keyLightDirection(tod);
  const lightDirNode = uniform(lightDir);
  const v3 = c => vec3(...c);
  const clock = uniform(0);

  // Sky radiance by view direction: deep zenith blue, a horizon band that is
  // lilac away from the sun and golden towards it, a two-lobe sun glow.
  const horizonColor = Fn(([dir]) => {
    const toward = dot(dir.xz.normalize(), lightDirNode.xz.normalize()).mul(.5).add(.5);
    return mix(v3(look.horizonCool), v3(look.horizonWarm), pow(toward, 2.6));
  });
  const glow = Fn(([dir]) => {
    const mu = max(dot(dir, lightDirNode), 0);
    return v3(look.glow).mul(pow(mu, 7).mul(.45).add(pow(mu, 60).mul(1.1)));
  });
  // Haze: the sky right at the horizon. Fog uses it, so far terrain dissolves
  // into exactly the sky colour behind it (blue-violet away from the sun).
  const haze = Fn(([dir]) => horizonColor(dir).add(glow(dir).mul(.8)));

  // Three stops (zenith, a paler mid sky that warms towards the sun, the
  // horizon band), so orange never mixes straight into blue as a dull pink.
  const skyGradient = Fn(([dir]) => {
    const h = max(dir.y, 0);
    const toward = dot(dir.xz.normalize(), lightDirNode.xz.normalize()).mul(.5).add(.5);
    const mid = mix(v3(look.mid), v3(look.horizonWarm).mul(.55), pow(toward, 5).mul(.55));
    const upper = mix(v3(look.zenith), mid, pow(float(1).sub(h), 2.6));
    return mix(upper, horizonColor(dir), pow(float(1).sub(h), 9)).add(glow(dir));
  });

  // Painterly cloud deck: fractal noise on a plane 2 km up, stretched along
  // the wind, lit by a second sample shifted towards the sun (bright sunward
  // edges, cool violet undersides) plus a silver lining near the sun.
  const clouds = Fn(([dir]) => {
    const h = max(dir.y, 0);
    const plane = dir.xz.div(h.add(.045)).mul(.42).add(vec2(clock.mul(.0035), clock.mul(.0012)));
    const p = plane.mul(vec2(.55, 1.25));
    const n = mx_fractal_noise_float(vec3(p, clock.mul(.004)), 5, 2.05, .52).mul(.55).add(.5);
    const coverage = float(look.coverage);
    const density = smoothstep(coverage, coverage.add(.32), n);
    const toSun = lightDirNode.xz.normalize().mul(vec2(.55, 1.25)).mul(.09);
    const n2 = mx_fractal_noise_float(vec3(p.add(toSun), clock.mul(.004)), 3, 2.05, .52).mul(.55).add(.5);
    const lit = clamp(n.sub(n2).mul(5).add(.55), 0, 1);
    const mu = max(dot(dir, lightDirNode), 0);
    const lining = pow(mu, 10).mul(float(1).sub(density)).mul(2.4);
    const base = mix(v3(look.cloudShade), v3(look.cloudLit), lit.mul(.85).add(pow(mu, 3).mul(.25)));
    const col = base.add(v3(look.glow).mul(lining)).mul(mix(float(1), float(.75), density.mul(density)));
    // Clouds thin out into the horizon haze.
    return vec4(col, density.mul(smoothstep(.015, .2, h)).mul(.92));
  });

  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  skyMaterial.fog = false;
  skyMaterial.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const cloud = clouds(dir);
    let sky = mix(skyGradient(dir), cloud.rgb, cloud.a);
    // Sun (or moon) disc, hidden behind thick cloud.
    const mu = dot(dir, lightDirNode);
    const disc = smoothstep(.99994, .99997, mu).mul(float(1).sub(cloud.a.mul(.9)));
    sky = sky.add(color(look.light).mul(disc).mul(look.sunDisc));
    if (tod === 'night') {
      const cell = mx_cell_noise_float(dir.mul(520));
      const twinkle = sin(clock.mul(1.7).add(cell.mul(80))).mul(.3).add(.7);
      const star = smoothstep(.9975, .9995, cell).mul(twinkle).mul(float(1).sub(cloud.a)).mul(smoothstep(.04, .3, dir.y));
      sky = sky.add(vec3(.55, .6, .75).mul(star));
    }
    // Below and right at the horizon the sky is pure haze.
    return vec4(mix(haze(dir), sky, smoothstep(-.01, .06, dir.y)), 1);
  })();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMaterial);
  sky.scale.setScalar(12000);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.name = 'Sky dome';
  sky.onBeforeRender = () => sky.position.copy(camera.position);
  scene.add(sky);

  // Aerial perspective: exponential distance haze (~13% at 1 km, ~35% at
  // 3 km, ~63% at 7 km), a thin mist pooling in the valley, and full haze at
  // the 7.5 km edge of the DEM so the world never ends in a visible line.
  // The in-scatter colour is a deeper blue-violet than the horizon sky (warm
  // towards the sun), so distant hills turn blue against a bright sky; only
  // at the DEM edge does it become the exact horizon haze.
  const fogDensity = uniform(look.fogDensity);
  const square = positionWorld.xz.abs();
  const edge = smoothstep(5600, 7300, max(square.x, square.y));
  const fogFactor = Fn(() => {
    const d = positionWorld.sub(cameraPosition).length();
    const aerial = float(1).sub(exp(d.mul(fogDensity).negate()));
    const valley = smoothstep(60, -15, positionWorld.y).mul(smoothstep(120, 1600, d)).mul(look.valleyMist);
    return aerial.add(valley).add(edge).min(1);
  });
  const fogColor = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const inscatter = v3(look.aerial).add(glow(dir).mul(.7));
    return mix(inscatter, haze(dir), edge);
  });
  scene.fogNode = fog(fogColor(), fogFactor());

  // Image-based fill: the clamped CC0 HDRI, rotated so its glow sits under
  // the sun (three's equirect lookup puts u at atan2(z, x)).
  if (environment) {
    scene.environment = environment;
    scene.environmentIntensity = look.envIntensity;
    const hdriAngle = (HDRI_SUN_U - .5) * Math.PI * 2;
    const sunAngle = Math.atan2(sun.direction.z, sun.direction.x);
    scene.environmentRotation.set(0, hdriAngle - sunAngle, 0);
  }
  // Small cool sky fill on top, so shadows read blue against warm sunlight.
  const hemi = new THREE.HemisphereLight(look.hemi[0], look.hemi[1], look.hemi[2]);
  scene.add(hemi);

  const light = new THREE.DirectionalLight(look.light, look.intensity);
  light.castShadow = true;
  const high = quality === 'high';
  light.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
  light.shadow.bias = -.0004;
  light.shadow.normalBias = .08;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 1200;
  light.shadow.filterNode = smoothPCF(1.25 / light.shadow.mapSize.x);
  // CSM clones this shadow per cascade and LightShadow.copy drops filterNode.
  const cloneShadow = light.shadow.clone;
  light.shadow.clone = function clone() { const copy = cloneShadow.call(this); copy.filterNode = this.filterNode; return copy; };
  let csm = null;
  if (high) {
    csm = new CSMShadowNode(light, { cascades: 3, maxFar: 320, mode: 'practical', lightMargin: 160 });
    csm.fade = true;
    light.shadow.shadowNode = csm;
    light.position.copy(lightDir).multiplyScalar(500);
    light.target.position.set(0, 0, 0);
  } else {
    Object.assign(light.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110 });
    light.shadow.camera.updateProjectionMatrix();
  }
  scene.add(light, light.target);

  // Camera-following shadow frustum (low quality): snap the centre to whole
  // shadow texels in light space so edges do not shimmer while walking.
  const lightRotation = new THREE.Matrix4().lookAt(lightDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const lightRotationInverse = lightRotation.clone().invert();
  const texel = 220 / light.shadow.mapSize.x, snapped = new THREE.Vector3();
  function followShadow() {
    snapped.copy(camera.position).applyMatrix4(lightRotationInverse);
    snapped.x = Math.round(snapped.x / texel) * texel; snapped.y = Math.round(snapped.y / texel) * texel;
    snapped.applyMatrix4(lightRotation);
    light.target.position.copy(snapped);
    light.position.copy(snapped).addScaledVector(lightDir, 500);
  }

  const flakes = createSnow(camera, look.flakes);
  scene.add(flakes.mesh);

  let elapsed = 0;
  return {
    tod, look, sun, lightDirection: lightDir, sky, light, hemi, csm, exposure: look.exposure,
    update(dt) {
      elapsed += dt; clock.value = elapsed;
      if (!csm) followShadow();
      flakes.update(dt);
    },
  };
}

// Falling snow, animated on the GPU: each flake has a fixed offset inside a
// 160 x 75 x 160 m box that wraps around the camera, so no per-frame CPU loop
// or buffer upload is needed. Sprites (not Points) so the flakes keep their
// size on WebGPU, where point primitives are always 1 px.
function createSnow(camera, tint) {
  const count = 3200, random = randomGenerator(71);
  const offsets = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    offsets.set([random() * 160, random() * 75, random() * 160, .65 + random() * .9], i * 4);
  }
  const data = instancedBufferAttribute(new THREE.InstancedBufferAttribute(offsets, 4));
  const clock = uniform(0);
  const box = vec3(160, 75, 160);
  const drift = vec3(clock.mul(.28).add(sin(clock.mul(.18).add(data.w.mul(40))).mul(.9)), clock.mul(data.w).negate(), sin(clock.mul(.11).add(data.x)).mul(.6));
  // Floored modulo written out: WGSL's % truncates towards zero.
  const shifted = data.xyz.add(drift).sub(cameraPosition).add(vec3(80, 12, 80));
  const local = shifted.sub(box.mul(floor(shifted.div(box)))).sub(vec3(80, 12, 80));
  const material = new THREE.PointsNodeMaterial({ size: .2, sizeAttenuation: true, transparent: true, depthWrite: false });
  material.fog = false;
  material.positionNode = cameraPosition.add(local);
  const radial = uv().sub(.5).length().mul(2);
  material.colorNode = vec3(...tint);
  material.opacityNode = smoothstep(1, .25, radial).mul(.7);
  const mesh = new THREE.Sprite(material);
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'Falling snow';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let elapsed = 0;
  return {
    mesh,
    update(dt) {
      elapsed += Math.min(dt, .05);
      mesh.visible = !reduced.matches;
      clock.value = elapsed;
    },
  };
}
