import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { polygons, toLocal, randomGenerator } from './geo.js';

// Minimum-area enclosing rectangle among all footprint edge orientations.
export function fitRectangle(ring) {
  let best;
  for (let i = 1; i < ring.length; i++) {
    const a = Math.atan2(ring[i][1] - ring[i - 1][1], ring[i][0] - ring[i - 1][0]);
    const c = Math.cos(a), s = Math.sin(a);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * c + z * s, v = -x * s + z * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const w = maxU - minU, d = maxV - minV;
    if (!best || w * d < best.area) {
      const u = (maxU + minU) / 2, v = (maxV + minV) / 2;
      best = { x: u * c - v * s, z: u * s + v * c, w, d, angle: a, area: w * d };
    }
  }
  if (best && best.w < best.d) { [best.w, best.d] = [best.d, best.w]; best.angle += Math.PI / 2; }
  return best;
}

export function inBuilding(x, z, rect, margin = 0) {
  const c = Math.cos(rect.angle), s = Math.sin(rect.angle), dx = x - rect.x, dz = z - rect.z;
  return Math.abs(dx * c + dz * s) < rect.w / 2 + margin && Math.abs(-dx * s + dz * c) < rect.d / 2 + margin;
}

function overlaps(a, b) {
  const corners = r => {
    const c = Math.cos(r.angle), s = Math.sin(r.angle);
    return [[-1,-1],[-1,1],[1,1],[1,-1]].map(([u,v]) => [r.x + u*r.w/2*c-v*r.d/2*s, r.z+u*r.w/2*s+v*r.d/2*c]);
  };
  const ac = corners(a), bc = corners(b);
  for (const r of [a,b]) for (const angle of [r.angle, r.angle + Math.PI/2]) {
    const project = p => p[0]*Math.cos(angle)+p[1]*Math.sin(angle);
    const ap = ac.map(project), bp = bc.map(project);
    if (Math.max(...ap) <= Math.min(...bp) || Math.max(...bp) <= Math.min(...ap)) return false;
  }
  return true;
}

export function createBuildings(osm, gba, meta, ground) {
  const group = new THREE.Group(), rects = [], batches = new Map(), random = randomGenerator(83);
  const walls = ['#877563', '#8c9992', '#a1aaa0', '#8c9ca3', '#a18a7f', '#747e70'].map(color => new THREE.MeshStandardMaterial({ color, roughness: .96 }));
  const snow = new THREE.MeshStandardMaterial({ color: '#e5e9e2', roughness: .92 });
  const timber = new THREE.MeshStandardMaterial({ color: '#5e6255', roughness: 1 });
  const foundation = new THREE.MeshStandardMaterial({ color: '#858b83', roughness: 1 });
  const windows = new THREE.MeshStandardMaterial({ color: '#dcb782', emissive: '#ffbf6c', emissiveIntensity: .85, roughness: .4 });
  function add(geometry, material, matrix) {
    geometry.applyMatrix4(matrix);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
  }
  const transform = new THREE.Object3D();
  function box(w, h, d, x, y, z, material, matrix) {
    const geometry = new THREE.BoxGeometry(w, h, d); geometry.translate(x, y, z); add(geometry, material, matrix);
  }
  const sources = [...osm.filter(f => f.properties.layer === 'building'), ...gba];
  for (const feature of sources) for (const poly of polygons(feature.geometry)) {
    const ring = poly[0].map(p => toLocal(...p, meta)), rect = fitRectangle(ring);
    if (!rect || rect.w < 1.8 || rect.d < 1.8 || Math.abs(rect.x) + rect.w > meta.halfSizeM || Math.abs(rect.z) + rect.w > meta.halfSizeM) continue;
    // OSM has precedence; overlapping GBA detections must not double up houses.
    if (rects.some(r => overlaps(r, rect))) continue;
    const samples = ring.map(([x,z]) => ground(x,z));
    const base = Math.max(...samples) + .06;
    const bottom = Math.min(...samples) - .25;
    const height = THREE.MathUtils.clamp(Number(feature.properties.height_est) || 3.2, 2.8, 4);
    rect.base = base; rect.height = height; rects.push(rect);
    transform.position.set(rect.x, base, rect.z); transform.rotation.set(0, -rect.angle, 0); transform.updateMatrix();
    const matrix = transform.matrix.clone(), wall = walls[Math.floor(random() * walls.length)];
    box(rect.w, base-bottom+.12, rect.d, 0, (bottom-base)/2, 0, foundation, matrix);
    box(rect.w, height, rect.d, 0, height/2, 0, wall, matrix);
    const roofRise = Math.min(2.7, rect.d * .38), halfW = rect.w/2+.45, halfD = rect.d/2+.45;
    // A closed triangular prism: ridge follows the longer footprint axis.
    const vertices = [
      -halfW,height,-halfD, halfW,height,-halfD, halfW,height+roofRise,0,
      -halfW,height,-halfD, halfW,height+roofRise,0, -halfW,height+roofRise,0,
      -halfW,height+roofRise,0, halfW,height+roofRise,0, halfW,height,halfD,
      -halfW,height+roofRise,0, halfW,height,halfD, -halfW,height,halfD,
      -halfW,height,-halfD, -halfW,height+roofRise,0, -halfW,height,halfD,
      halfW,height,halfD, halfW,height+roofRise,0, halfW,height,-halfD,
    ];
    const roof = new THREE.BufferGeometry(); roof.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3)); roof.computeVertexNormals();
    // Double-sided material also makes all eaves visible at walking height.
    add(roof, snow, matrix);
    for (const side of [-1,1]) {
      const count = Math.max(1, Math.floor(rect.w/3.5));
      for (let j=0; j<count; j++) {
        const x = (j-(count-1)/2)*Math.min(3.4, rect.w/(count+1));
        box(1.14,1.28,.12,x,1.65,side*(rect.d/2+.045),timber,matrix);
        box(.85,.96,.14,x,1.65,side*(rect.d/2+.065),windows,matrix);
        box(.055,.98,.17,x,1.65,side*(rect.d/2+.075),timber,matrix);
        box(.9,.055,.17,x,1.65,side*(rect.d/2+.075),timber,matrix);
      }
      box(rect.w+.15,.14,.14,0,.42,side*(rect.d/2+.035),timber,matrix);
    }
    box(.18,height+.15,.18,-rect.w/2+.08,height/2,rect.d/2+.03,timber,matrix);
    box(.14,2.15,1.18,rect.w/2+.04,1.075,0,timber,matrix);
    box(.17,1.92,.91,rect.w/2+.06,.96,0,wall,matrix);
    if (random() > .35) box(.55,1.6,.55,rect.w*.27,height+roofRise*.65,0,timber,matrix);
  }
  snow.side = THREE.DoubleSide;
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, material); mesh.castShadow = material !== windows; mesh.receiveShadow = true; group.add(mesh);
  }
  group.name = 'Village houses: deduplicated OSM and GBA';
  return { group, rects, setLights(on) { windows.emissiveIntensity = on ? .85 : 0; windows.color.set(on ? '#dcb782' : '#526365'); } };
}
