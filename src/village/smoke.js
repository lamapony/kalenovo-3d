// Chimney smoke: one instanced Sprite draw for all puffs, animated entirely in TSL.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, time, fract, vec3, vec2, float, sin, cos, smoothstep, uv, mx_noise_float, uniform } from 'three/tsl';
import { randomGenerator } from '../geo.js';

export function createSmoke(sources, { puffs = 12 } = {}) {
  const random = randomGenerator(611);
  const data = new Float32Array(sources.length * puffs * 4);
  let n = 0;
  for (const s of sources) for (let k = 0; k < puffs; k++) {
    data.set([s[0], s[1], s[2], k / puffs + random() * .08], n * 4); n++;
  }
  const attr = new THREE.InstancedBufferAttribute(data, 4);
  const p = instancedBufferAttribute(attr);
  const strength = uniform(1);
  // Unlit sprite: its radiance must follow the time of day (atmosphere LOOKS.smoke),
  // or the puffs glow against the night sky.
  const tint = uniform(new THREE.Color(.3, .31, .34));
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const t = fract(time.mul(.07).add(p.w));
  const wind = vec3(1, 0, -.45).mul(t.mul(t).mul(5.5));
  const wobble = vec3(sin(time.mul(.6).add(p.w.mul(31))), float(0), cos(time.mul(.5).add(p.w.mul(17)))).mul(t.mul(.6));
  material.positionNode = p.xyz.add(vec3(0, t.mul(7.5), 0)).add(wind).add(wobble);
  material.scaleNode = vec2(t.mul(2.6).add(.45));
  material.rotationNode = p.w.mul(40).add(time.mul(.1));
  const d = uv().sub(.5).length();
  const puff = float(1).sub(smoothstep(.12, .5, d)).mul(mx_noise_float(uv().mul(3.5).add(p.w.mul(9))).mul(.35).add(.75));
  material.colorNode = tint.mul(t.mul(.8).add(1));
  // More, fainter puffs so a plume reads as one wisp rather than a string of beads.
  material.opacityNode = puff.mul(smoothstep(0, .08, t)).mul(float(1).sub(t)).mul(.42).mul(strength);
  material.name = 'chimney smoke';
  const sprite = new THREE.Sprite(material);
  sprite.count = n;
  sprite.frustumCulled = false;
  sprite.renderOrder = 2;
  sprite.name = `${sources.length} chimney smoke plumes`;
  return { object: sprite, strength, tint };
}
