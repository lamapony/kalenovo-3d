import * as THREE from 'three/webgpu';
import { builtinAOContext, emissive, float, mrt, normalView, output, pass, screenUV, smoothstep, mix } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// TSL post-processing on a RenderPipeline. High quality: GTAO (applied to
// indirect light through builtinAOContext), selective bloom on emissive
// surfaces (windows, the lamp), soft vignette. Low quality: vignette only.
// Tone mapping (AgX) and the sRGB transform run once at the end through the
// pipeline's outputColorTransform. Any effect that fails to build is skipped.
export function createPost(renderer, scene, camera, { quality = 'high' } = {}) {
  const pipeline = new THREE.RenderPipeline(renderer);
  const enabled = [];
  const scenePass = pass(scene, camera);
  let color = scenePass.getTextureNode('output');
  const high = quality === 'high';

  if (high) {
    try {
      // GTAO needs single-sampled depth and view normals from a pre-pass.
      const prePass = pass(scene, camera, { samples: 0 });
      prePass.setMRT(mrt({ output: normalView }));
      prePass.transparent = false; // snowflakes must not write AO normals

      const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
      aoPass.resolutionScale = .5;
      aoPass.radius.value = .9;
      aoPass.scale.value = 1.1;
      aoPass.thickness.value = 1.2;
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
      enabled.push('GTAO');
    } catch (error) {
      console.warn('GTAO unavailable, skipped.', error);
    }
    try {
      scenePass.setMRT(mrt({ output, emissive }));
      const glow = bloom(scenePass.getTextureNode('emissive'), .4, .3, 0);
      color = scenePass.getTextureNode('output').add(glow);
      enabled.push('bloom');
    } catch (error) {
      console.warn('Bloom unavailable, skipped.', error);
    }
  }

  // Subtle vignette: at most 14% darker in the corners.
  const edge = smoothstep(.35, .95, screenUV.sub(.5).mul(float(1.25)).length());
  pipeline.outputNode = color.mul(mix(float(1), float(.86), edge));
  enabled.push('vignette', 'ACES');
  return { pipeline, enabled, render: () => pipeline.render() };
}
