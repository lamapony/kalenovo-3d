import * as THREE from 'three/webgpu';
import { VERTICAL_EXAGGERATION, createGroundSampler, parseHeightmap } from './heightfield.js';
import { createTerrainMaterial } from './terrainMaterial.js';

export { VERTICAL_EXAGGERATION, createGroundSampler };
let activeGroundHeight;

export function getGroundHeight(x, z) {
  if (!activeGroundHeight) throw new Error('Terrain must be loaded before sampling ground height.');
  return activeGroundHeight(x, z);
}

// Builds an indexed n x n grid plus a skirt: every perimeter vertex is
// duplicated `skirtDepth` metres lower and joined to the edge, which hides
// hairline gaps between tiles and the far edge of the world.
function gridGeometry(n, positionAt, { keepQuad, skirtDepth }) {
  const ring = [];
  for (let i = 0; i < n - 1; i++) ring.push(i);
  for (let j = 0; j < n - 1; j++) ring.push(j * n + n - 1);
  for (let i = n - 1; i > 0; i--) ring.push((n - 1) * n + i);
  for (let j = n - 1; j > 0; j--) ring.push(j * n);
  const positions = new Float32Array((n * n + ring.length) * 3), p = [0, 0, 0];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    positionAt(i, j, p);
    positions.set(p, (j * n + i) * 3);
  }
  const indices = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    if (keepQuad && !keepQuad(i, j)) continue;
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Normals from the surface only, so the skirt does not tilt edge normals
  // (the terrain material reads slope from the normal).
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array;
  ring.forEach((top, r) => {
    const k = (n * n + r) * 3;
    positions[k] = positions[top * 3]; positions[k + 1] = positions[top * 3 + 1] - skirtDepth; positions[k + 2] = positions[top * 3 + 2];
    normals[k] = normals[top * 3]; normals[k + 1] = normals[top * 3 + 1]; normals[k + 2] = normals[top * 3 + 2];
    const b = ring[(r + 1) % ring.length], la = n * n + r, lb = n * n + (r + 1) % ring.length;
    // Wound so the skirt faces outward.
    indices.push(top, b, la, b, lb, la);
  });
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// Copernicus GLO-30 near tile (walkable) plus a far ring that fills the horizon.
export function createTerrain(meta, dem, nearBuffer, farBuffer, { textures, lightDirection } = {}) {
  const centerElev = meta.centerElev, ve = VERTICAL_EXAGGERATION;
  const nearN = dem.near.gridSize, nearHalf = dem.near.halfSizeM;
  const near = parseHeightmap(nearBuffer, nearN);
  activeGroundHeight = createGroundSampler({ gridSize: nearN, halfSizeM: nearHalf, centerElev }, near);
  const material = createTerrainMaterial(textures, { lightDirection });
  const group = new THREE.Group();
  group.name = 'Copernicus DEM GLO-30 terrain';

  // Near tile: one vertex per DEM sample (7 m spacing). The grid is cubic
  // resampled from 30 m, so a denser mesh would not add real relief.
  const nearStep = nearHalf * 2 / (nearN - 1);
  const nearMesh = new THREE.Mesh(gridGeometry(nearN, (i, j, p) => {
    p[0] = -nearHalf + i * nearStep; p[1] = (near[j * nearN + i] - centerElev) * ve; p[2] = -nearHalf + j * nearStep;
  }, { skirtDepth: 25 }), material);
  nearMesh.receiveShadow = true;
  nearMesh.name = `Near terrain ${nearN} (Copernicus GLO-30)`;
  group.add(nearMesh);

  // Far ring: the coarse grid over +-7.5 km with a hole where the near tile is.
  // Quads that straddle the near edge get their inner vertices moved onto the
  // edge with the near tile's height (minus 0.6 m), so the meshes meet
  // without overlapping (no z-fighting) and without a visible step.
  let far = null;
  if (farBuffer) {
    const n = dem.far.gridSize, half = dem.far.halfSizeM, step = half * 2 / (n - 1);
    far = parseHeightmap(farBuffer, n);
    const inner = new Uint8Array(n * n);
    const geometry = gridGeometry(n, (i, j, p) => {
      let x = -half + i * step, z = -half + j * step, y = (far[j * n + i] - centerElev) * ve;
      if (Math.abs(x) < nearHalf && Math.abs(z) < nearHalf) {
        inner[j * n + i] = 1;
        if (Math.abs(x) > nearHalf - step) x = Math.sign(x) * nearHalf;
        if (Math.abs(z) > nearHalf - step) z = Math.sign(z) * nearHalf;
        y = activeGroundHeight(x, z) - .6;
      }
      p[0] = x; p[1] = y; p[2] = z;
    }, {
      skirtDepth: 400,
      keepQuad: (i, j) => { const a = j * n + i; return !(inner[a] && inner[a + 1] && inner[a + n] && inner[a + n + 1]); },
    });
    const farMesh = new THREE.Mesh(geometry, createTerrainMaterial(textures, { lightDirection, far: true }));
    farMesh.name = `Far terrain ring ${half / 1000} km (Copernicus GLO-30)`;
    farMesh.receiveShadow = true;
    group.add(farMesh);
  }

  return { mesh: group, getGroundHeight, elevations: near, farElevations: far };
}
