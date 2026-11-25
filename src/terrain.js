import * as THREE from 'three';
export const VERTICAL_EXAGGERATION = 1.25;
let activeGroundHeight;

// World-space meters, relative to centerElev. Coordinates outside the DEM clamp
// to its edge. This is bilinear interpolation of all four Float32 grid samples.
export function createGroundSampler(meta, elevations) {
  const { gridSize: n, halfSizeM: half, centerElev } = meta;
  return (x, z) => {
    const gx = THREE.MathUtils.clamp((x + half) / (half * 2) * (n - 1), 0, n - 1);
    const gz = THREE.MathUtils.clamp((z + half) / (half * 2) * (n - 1), 0, n - 1);
    const x0 = Math.min(Math.floor(gx), n - 2), z0 = Math.min(Math.floor(gz), n - 2);
    const tx = gx - x0, tz = gz - z0, i = z0 * n + x0;
    const north = elevations[i] * (1 - tx) + elevations[i + 1] * tx;
    const south = elevations[i + n] * (1 - tx) + elevations[i + n + 1] * tx;
    return (north * (1 - tz) + south * tz - centerElev) * VERTICAL_EXAGGERATION;
  };
}

export function getGroundHeight(x, z) {
  if (!activeGroundHeight) throw new Error('Terrain must be loaded before sampling ground height.');
  return activeGroundHeight(x, z);
}

export function createTerrain(meta, buffer) {
  const expected = meta.gridSize ** 2;
  if (buffer.byteLength !== expected * 4) throw new Error('Invalid heightmap size.');
  const view = new DataView(buffer);
  const elevations = new Float32Array(expected);
  for (let i = 0; i < expected; i++) {
    elevations[i] = view.getFloat32(i * 4, true);
    if (!Number.isFinite(elevations[i])) throw new Error('Invalid heightmap sample.');
  }
  activeGroundHeight = createGroundSampler(meta, elevations);
  // Half-cell tessellation limits the bilinear/triangle discrepancy to 16 cm.
  const n = (meta.gridSize - 1) * 2 + 1, half = meta.halfSizeM, step = half * 2 / (n - 1);
  const geometry = new THREE.PlaneGeometry(half * 2, half * 2, n - 1, n - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(n * n * 3), color = new THREE.Color();
  const snow = new THREE.Color('#d9e0da'), earth = new THREE.Color('#858c80');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), y = getGroundHeight(x, z);
    positions.setY(i, y);
    const dx = (getGroundHeight(x + step, z) - getGroundHeight(x - step, z)) / (2 * step);
    const dz = (getGroundHeight(x, z + step) - getGroundHeight(x, z - step)) / (2 * step);
    const slope = Math.hypot(dx, dz);
    const patch = (Math.sin(x * .027 + Math.sin(z * .019)) + Math.cos(z * .033 + x * .011)) * .035;
    const clearing = Math.exp(-((x - meta.defaultSpawn.x) ** 2 + (z - meta.defaultSpawn.z) ** 2) / 50000);
    color.copy(snow).lerp(earth, THREE.MathUtils.clamp(slope * 1.7 + patch - clearing * .17, .015, .67));
    color.multiplyScalar(1 + Math.sin(x * .14) * Math.cos(z * .12) * .018);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  mesh.name = 'Copernicus terrain';
  return { mesh, getGroundHeight, elevations };
}
