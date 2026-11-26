import * as THREE from 'three/webgpu';
import {
  Fn, cameraPosition, color, float, floor, fog, instancedBufferAttribute, mix, normalize, positionWorld,
  sin, smoothstep, uniform, uv, vec3, vec4, exp, max, pow, dot,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { randomGenerator } from './geo.js';
import { sceneSun } from './sun.js';

// Physical sky (Preetham, three's TSL SkyMesh) softened by a haze layer.
// The same haze function colours the distance fog, so terrain at the
// horizon dissolves into exactly the sky colour behind it.
export function createAtmosphere(scene, camera, { quality = 'high' } = {}) {
  const sun = sceneSun();
  const sunDir = new THREE.Vector3(sun.direction.x, sun.direction.y, sun.direction.z).normalize();
  const sunDirNode = uniform(sunDir);

  // Haze radiance by view direction: cool grey overcast, warmer and brighter
  // towards the low sun. Linear values, tone mapped later (AgX).
  const hazeIntensity = uniform(1.0);
  const haze = Fn(([dir]) => {
    const toward = max(dot(dir, sunDirNode), 0);
    const glow = pow(toward, 5).mul(.55).add(pow(toward, 48).mul(.9));
    const base = mix(color('#aab6bf'), color('#ccd4d8'), smoothstep(-.05, .25, dir.y));
    return base.add(color('#f4d9b2').mul(glow)).mul(hazeIntensity);
  });

  const sky = new SkyMesh();
  sky.scale.setScalar(12000);
  sky.turbidity.value = 9;
  sky.rayleigh.value = .55;
  sky.mieCoefficient.value = .012;
  sky.mieDirectionalG.value = .82;
  sky.cloudCoverage.value = .72;
  sky.cloudDensity.value = .55;
  sky.cloudElevation.value = .55;
  sky.cloudScale.value = .00022;
  sky.sunPosition.value.copy(sunDir);
  const skyColor = sky.material.colorNode;
  sky.material.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const physical = skyColor.rgb.mul(1.25);
    // Overcast veil over the whole dome; full haze at and below the horizon.
    const veil = mix(physical, haze(dir), .45);
    return vec4(mix(haze(dir), veil, smoothstep(.0, .32, dir.y)), 1);
  })();
  sky.frustumCulled = false;
  scene.add(sky);

  // Exponential-squared distance haze (~3% at 1 km, ~20% at 3 km, ~70% at
  // 7 km), a little extra low in the valley, and full haze at the 7.5 km
  // edge of the DEM so the world never ends in a visible line.
  const fogDensity = uniform(.00016);
  const fogFactor = Fn(() => {
    const d = positionWorld.sub(cameraPosition).length();
    const dd = d.mul(fogDensity);
    const valley = smoothstep(80, -10, positionWorld.y).mul(smoothstep(150, 1500, d)).mul(.1);
    const square = positionWorld.xz.abs();
    const edge = smoothstep(5600, 7300, max(square.x, square.y));
    return float(1).sub(exp(dd.mul(dd).negate())).add(valley).add(edge).min(1);
  });
  scene.fogNode = fog(haze(normalize(positionWorld.sub(cameraPosition))), fogFactor());

  // Sky fill matched to the haze colour; snow-bounce from below.
  scene.add(new THREE.HemisphereLight('#c9d6e2', '#a6ada6', .85));

  // Sun: late-November afternoon direction from src/sun.js.
  const light = new THREE.DirectionalLight('#ffe1bd', 4.2);
  light.castShadow = true;
  const high = quality === 'high';
  light.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
  light.shadow.bias = -.0004;
  light.shadow.normalBias = .08;
  light.shadow.radius = high ? 3 : 2;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 1200;
  let csm = null;
  if (high) {
    csm = new CSMShadowNode(light, { cascades: 3, maxFar: 320, mode: 'practical', lightMargin: 160 });
    csm.fade = true;
    light.shadow.shadowNode = csm;
    light.position.copy(sunDir).multiplyScalar(500);
    light.target.position.set(0, 0, 0);
  } else {
    Object.assign(light.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110 });
    light.shadow.camera.updateProjectionMatrix();
  }
  scene.add(light, light.target);

  // Camera-following shadow frustum (low quality): snap the centre to whole
  // shadow texels in light space so edges do not shimmer while walking.
  const lightRotation = new THREE.Matrix4().lookAt(sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const lightRotationInverse = lightRotation.clone().invert();
  const texel = 220 / light.shadow.mapSize.x, snapped = new THREE.Vector3();
  function followShadow() {
    snapped.copy(camera.position).applyMatrix4(lightRotationInverse);
    snapped.x = Math.round(snapped.x / texel) * texel; snapped.y = Math.round(snapped.y / texel) * texel;
    snapped.applyMatrix4(lightRotation);
    light.target.position.copy(snapped);
    light.position.copy(snapped).addScaledVector(sunDir, 500);
  }

  const flakes = createSnow(camera);
  scene.add(flakes.mesh);

  return {
    sun, sunDirection: sunDir, sky, light, csm,
    update() {
      if (!csm) followShadow();
      flakes.update();
    },
  };
}

// Falling snow, animated on the GPU: each flake has a fixed offset inside a
// 160 x 75 x 160 m box that wraps around the camera, so no per-frame CPU loop
// or buffer upload is needed. Sprites (not Points) so the flakes keep their
// size on WebGPU, where point primitives are always 1 px.
function createSnow(camera) {
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
  material.positionNode = cameraPosition.add(local);
  const radial = uv().sub(.5).length().mul(2);
  material.colorNode = color('#ffffff');
  material.opacityNode = smoothstep(1, .25, radial).mul(.75);
  const mesh = new THREE.Sprite(material);
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'Falling snow';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let elapsed = 0, last = performance.now();
  return {
    mesh,
    update() {
      const now = performance.now();
      elapsed += Math.min((now - last) / 1000, .05); last = now;
      mesh.visible = !reduced.matches;
      clock.value = elapsed;
    },
    camera,
  };
}
