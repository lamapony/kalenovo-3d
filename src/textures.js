// CC0 PBR texture sets from public/textures/<name>/{color,normal,rough}.jpg (see CREDITS.md).
import * as THREE from 'three/webgpu';

const loader = new THREE.TextureLoader();
const cache = new Map();
const base = `${import.meta.env?.BASE_URL ?? '/'}textures/`;

function load(url, srgb) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

export function textureSet(name) {
  if (!cache.has(name)) {
    cache.set(name, {
      color: load(`${base}${name}/color.jpg`, true),
      normal: load(`${base}${name}/normal.jpg`, false),
      rough: load(`${base}${name}/rough.jpg`, false),
    });
  }
  return cache.get(name);
}
