import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { polygons, toLocal, pointInPolygon, segmentDistanceSq, randomGenerator } from './geo.js';
import { inBuilding } from './buildings.js';

export function createForest(features, meta, ground, exclusions, buildings) {
  const woods = features.filter(f => f.properties.layer === 'wood').flatMap(f => polygons(f.geometry)).map(poly => poly.map(r => r.map(p => toLocal(...p, meta))));
  const random = randomGenerator(918), trees = [], half = meta.halfSizeM - 15;
  // A small spatial hash makes road/river rejection independent of way length.
  const cells = new Map(), cellSize = 80;
  for (const e of exclusions) {
    for (let x = Math.floor((Math.min(e.a[0],e.b[0])-e.radius)/cellSize); x <= Math.floor((Math.max(e.a[0],e.b[0])+e.radius)/cellSize); x++) {
      for (let z = Math.floor((Math.min(e.a[1],e.b[1])-e.radius)/cellSize); z <= Math.floor((Math.max(e.a[1],e.b[1])+e.radius)/cellSize); z++) {
        const key = `${x},${z}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(e);
      }
    }
  }
  for (let i = 0; i < 24000 && trees.length < 4800; i++) {
    const x = (random()*2-1)*half, z = (random()*2-1)*half, y = ground(x,z);
    const inWood = woods.some(poly => pointInPolygon(x,z,poly));
    const slope = Math.hypot(ground(x+8,z)-ground(x-8,z),ground(x,z+8)-ground(x,z-8))/16;
    const onSlope = y > 25 && slope > .06 && slope < .55 && random() < .36;
    if (!inWood && !onSlope) continue;
    if (Math.hypot(x-meta.defaultSpawn.x,z-meta.defaultSpawn.z) < 40 || slope > .75) continue;
    if ((cells.get(`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`) || []).some(e => segmentDistanceSq(x,z,e.a,e.b) < (e.radius+2.2)**2)) continue;
    if (buildings.some(r => inBuilding(x,z,r,5))) continue;
    trees.push({ x,y,z,scale: .7+random()*.9, angle: random()*Math.PI*2 });
  }
  const group = new THREE.Group(), needleParts = [], snowParts = [];
  for (const [radius,height,y] of [[2.1,4.8,3.7],[1.65,4.2,5.4],[1.15,3.4,7]]) {
    const needle = new THREE.ConeGeometry(radius,height,7); needle.translate(0,y,0); needleParts.push(needle);
    const cap = new THREE.ConeGeometry(radius*.86,height*.87,7); cap.translate(0,y+height*.08,0); snowParts.push(cap);
  }
  const trunk = new THREE.CylinderGeometry(.15,.24,3,5); trunk.translate(0,1.5,0);
  const parts = [[trunk,'#6c6557'],[mergeGeometries(needleParts),'#455e54'],[mergeGeometries(snowParts),'#d3dfd6']];
  const dummy = new THREE.Object3D();
  for (const [geometry,color] of parts) {
    const mesh = new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color,roughness:1,flatShading:true}),trees.length);
    trees.forEach((t,i) => { dummy.position.set(t.x,t.y-.12,t.z); dummy.scale.setScalar(t.scale); dummy.rotation.y=t.angle; dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix); });
    mesh.instanceMatrix.needsUpdate=true; mesh.castShadow=true; mesh.receiveShadow=true; mesh.computeBoundingSphere(); group.add(mesh);
  }
  needleParts.forEach(g=>g.dispose()); snowParts.forEach(g=>g.dispose());
  group.name = `${trees.length} snow-topped pines`;
  return group;
}
