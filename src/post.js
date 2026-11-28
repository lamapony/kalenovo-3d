import * as THREE from 'three/webgpu';
import {
  builtinAOContext, clamp, rtt, dot, emissive, float, max, mix, mrt, normalView, output, pass, pow, renderOutput,
  saturation, screenUV, smoothstep, uniform, vec3, vec4,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { season } from './season.js';

// Colour grade per time of day, applied in display space after tone mapping
// (like a grade on top of a camera LUT): lift tints the shadows, gain the
// highlights, gamma the midtones, then saturation and a split tone.
export const GRADES = {
  afternoon: { lift: [-.01, .0, .03], gamma: [1.0, 1.0, 1.02], gain: [1.03, 1.0, .97], saturation: 1.12, split: .035, contrast: 1.1 },
  sunset: { lift: [-.005, -.01, .035], gamma: [1.02, .99, 1.0], gain: [1.06, .99, .92], saturation: 1.1, split: .05, contrast: 1.1 },
  summer: { lift: [0, .003, .01], gamma: [1.0, 1.0, 1.0], gain: [1.0, 1.0, 1.0], saturation: 1.06, split: .01, contrast: 1.1 },
  night: { lift: [-.004, .004, .03], gamma: [.97, 1.0, 1.06], gain: [1.05, 1.0, 1.0], saturation: .95, split: .03, contrast: 1.05 },
};

// TSL post-processing on a RenderPipeline. High quality: GTAO (applied to
// indirect light through builtinAOContext), bloom on bright HDR highlights
// (sunlit snow glints, the sun) and on emissive windows, vignette, grade.
// Low quality: tone mapping, grade and vignette only. Tone mapping and the
// sRGB transform run here through renderOutput so the grade can follow them.
export function createPost(renderer, scene, camera, { quality = 'high', tod = 'afternoon' } = {}) {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
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
      // AO is computed at half resolution anyway; rendering its depth/normal
      // pre-pass at half size saves a full-res run of the terrain shader.
      prePass.setResolutionScale(.5);

      const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
      aoPass.resolutionScale = .5; // sized from the drawing buffer, matches the pre-pass
      aoPass.distanceExponent.value = 1.6;
      aoPass.radius.value = 1.6;
      aoPass.scale.value = 1.35;
      aoPass.thickness.value = 1.6;
      // Edge-aware denoise of the half-res AO (GTAO's per-pixel noise reads
      // as speckle under eaves without a temporal filter).
      // DenoiseNode samples at uv(), so it is baked into its own half-res target.
      const aoDenoise = denoise(aoPass.getTextureNode(), prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
      aoDenoise.radius.value = 4;
      const aoClean = rtt(aoDenoise, null, null, { resolutionScale: .5 });
      scenePass.contextNode = builtinAOContext(aoClean.sample(screenUV).r);
      enabled.push('GTAO');
    } catch (error) {
      console.warn('GTAO unavailable, skipped.', error);
    }
    try {
      scenePass.setMRT(mrt({ output, emissive }));
      const hdr = scenePass.getTextureNode('output');
      // Threshold on HDR luminance: only sunlit snow highlights and the sun pass,
      // emissive windows always do.
      // Summer: the bright overcast sky must not bloom into a veil over the street.
      const glow = season.summer ? bloom(hdr.add(scenePass.getTextureNode('emissive').mul(1.5)), .12, .4, 2.4) : bloom(hdr.add(scenePass.getTextureNode('emissive').mul(1.5)), .22, .55, 1.4);
      color = hdr.add(glow);
      enabled.push('bloom');
    } catch (error) {
      console.warn('Bloom unavailable, skipped.', error);
    }
  }

  const grade = (season.summer && tod === 'afternoon' ? GRADES.summer : GRADES[tod]) ?? GRADES.afternoon;
  const lift = uniform(new THREE.Vector3(...grade.lift));
  const gamma = uniform(new THREE.Vector3(...grade.gamma));
  const gain = uniform(new THREE.Vector3(...grade.gain));
  let display = renderOutput(color, renderer.toneMapping, renderer.outputColorSpace).rgb;
  display = clamp(display, 0, 1);
  display = display.mul(gain).add(lift.mul(float(1).sub(display)));
  display = pow(max(display, 0), float(1).div(gamma));
  display = saturation(display, grade.saturation);
  // Gentle S-curve around mid grey.
  display = clamp(display.sub(.45).mul(grade.contrast).add(.45), 0, 1);
  // Split tone: warm highlights, cool shadows, by display luminance.
  const luma = dot(display, vec3(.2126, .7152, .0722));
  display = display.add(mix(vec3(-.6, -.1, .9), vec3(.8, .25, -.7), smoothstep(.15, .75, luma)).mul(grade.split * .1));
  // Vignette: at most 16% darker in the corners.
  const edge = smoothstep(.35, .98, screenUV.sub(.5).mul(float(1.25)).length());
  pipeline.outputNode = vec4(display.mul(mix(float(1), float(.84), edge)), 1);
  enabled.push('vignette', renderer.toneMapping === THREE.AgXToneMapping ? 'AgX' : 'ACES', 'grade');
  return { pipeline, enabled, render: () => pipeline.render() };
}
