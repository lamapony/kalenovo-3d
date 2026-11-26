import * as THREE from 'three/webgpu';
import { color, float, mix, mx_fractal_noise_float, mx_noise_float, normalWorldGeometry, positionWorld, cameraPosition, smoothstep, vec3 } from 'three/tsl';

// Procedural first-snow ground (no textures): thin snow on flats, exposed
// earth and dry grass on steeper and sun-facing slopes, rock on the steepest
// faces, plus large-scale variation so the snow is never one flat white.
export function createTerrainMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .95, metalness: 0 });
  const p = positionWorld.xz;
  const n = normalWorldGeometry;
  // 1 - n.y: 0 on flat ground, ~0.1 at 27 degrees, ~0.3 at 45 degrees.
  const slope = float(1).sub(n.y);
  const distance = positionWorld.sub(cameraPosition).length();
  const detailFade = smoothstep(260, 60, distance); // fine noise would shimmer far away

  const large = mx_fractal_noise_float(vec3(p.mul(.0021), 0), 3, 2, .5);
  const mid = mx_noise_float(vec3(p.mul(.027), 1.7));
  const fine = mx_noise_float(vec3(p.mul(.31), 3.1)).mul(detailFade);

  // Snow holds less on steep slopes and on slopes facing the low southern sun (+z is south).
  const southFacing = n.z.max(0).mul(slope.mul(8).min(1));
  const snowLine = float(.085).add(large.mul(.045)).add(mid.mul(.02)).sub(southFacing.mul(.035));
  const onSlope = smoothstep(snowLine.sub(.035), snowLine.add(.03), slope);
  // First snow is thin: a few grass patches show through even on flat ground.
  const thin = smoothstep(.66, .86, mid.mul(.55).add(large.mul(.25)).add(fine.mul(.3)).add(.5));
  const snowCover = float(1).sub(onSlope).mul(float(1).sub(thin.mul(.4)));

  const grass = mix(color('#80775f'), color('#676552'), mid.mul(.5).add(.5));
  const earth = mix(grass, color('#5d564b'), smoothstep(.12, .25, slope));
  const rock = mix(color('#6f6d68'), color('#57544f'), fine.mul(.5).add(.5));
  const ground = mix(earth, rock, smoothstep(.24, .4, slope.add(large.mul(.06))));
  const snow = mix(color('#dfe5e5'), color('#eef1ef'), fine.mul(.5).add(.5)).mul(large.mul(.035).add(1));

  material.colorNode = mix(ground, snow, snowCover);
  material.roughnessNode = mix(float(.97), float(.82), snowCover);
  return material;
}
