import * as THREE from 'three';
import { toLocal, clipSegment } from './geo.js';

export function createPaths(features, meta, ground) {
  const group = new THREE.Group(), exclusions = [];
  const road = new THREE.MeshStandardMaterial({ color: '#aeb8b1', roughness: 1, side: THREE.DoubleSide });
  const ice = new THREE.MeshStandardMaterial({ color: '#849f9e', roughness: .38, metalness: .12, side: THREE.DoubleSide });
  const bank = new THREE.MeshStandardMaterial({ color: '#e2e8e1', roughness: 1, side: THREE.DoubleSide });
  function ribbon(a, b, width, material, offset) {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < .01) return;
    const nx = -dz / length, nz = dx / length, count = Math.ceil(length / 3);
    const positions = [], indices = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count, x = a[0] + dx * t, z = a[1] + dz * t;
      // Crosswise tessellation keeps broad river ribbons attached to the ground.
      for (let j = 0; j <= 4; j++) {
        const across = (j / 4 - .5) * width;
        const px = x + nx * across, pz = z + nz * across;
        positions.push(px, ground(px, pz) + offset, pz);
      }
      if (i < count) for (let j = 0; j < 4; j++) {
        const k = i * 5 + j;
        indices.push(k, k + 5, k + 1, k + 1, k + 5, k + 6);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true; group.add(mesh);
  }
  for (const feature of features) {
    const layer = feature.properties.layer;
    if (!['road', 'waterway'].includes(layer)) continue;
    const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
    const water = layer === 'waterway';
    const width = water ? (feature.properties.waterway === 'river' ? 17 : 3.2) : (feature.properties.highway === 'tertiary' ? 6.5 : 4.5);
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const clipped = clipSegment(toLocal(...line[i - 1], meta), toLocal(...line[i], meta), meta.halfSizeM - width);
      if (!clipped) continue;
      const [a, b] = clipped;
      exclusions.push({ a, b, radius: width / 2 + (water ? 4 : 3) });
      if (water) ribbon(a, b, width + 2, bank, .23);
      ribbon(a, b, width, water ? ice : road, water ? .29 : .24);
      if (!water) {
        // A pale central snow strip leaves two quiet, worn wheel tracks.
        ribbon(a, b, width * .2, bank, .26);
      }
    }
  }
  group.name = 'OSM winter roads and Ivolga waterways';
  return { group, exclusions };
}
