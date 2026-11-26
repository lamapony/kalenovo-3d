import * as THREE from 'three/webgpu';
import { collectFootprints, wayLines, planVillage, fitRectangle, inRect } from './village/plan.js';
import { TiledBuilders } from './village/builder.js';
import { createVillageMaterials } from './village/materials.js';
import { buildHouse, buildOutbuilding } from './village/house.js';
import { createFences } from './fences.js';
import { buildPoles } from './village/poles.js';
import { createSmoke } from './village/smoke.js';

export { fitRectangle };
// Kept for controls.js / forest.js: point-in-rotated-rectangle test with margin.
export function inBuilding(x, z, rect, margin = 0) { return inRect(x, z, rect, margin); }

const TILE = 220, DETAIL_DISTANCE = 260;

// Procedural village from OSM + GBA footprints. Merged footprints are split into plots along the
// street; each plot gets a log or plank house, outbuildings and a fence with gates.
// Returns rects (houses, annexes, outbuildings) used for collisions, and plots for vegetation.
export function createBuildings(osm, gba, meta, ground, options = {}) {
  const t0 = performance.now();
  const lines = wayLines(osm, meta);
  const plan = planVillage({ footprints: collectFootprints(osm, gba, meta), lines, halfSize: meta.halfSizeM, seed: options.seed ?? 83 });
  const { mats, lights } = createVillageMaterials();
  const B = new TiledBuilders(TILE);

  const chimneys = [];
  const place = (target, r) => { target.base = r.base; target.height = r.height; if (r.smoke && r.chimneyTop) chimneys.push(r.chimneyTop); };
  for (const plot of plan.plots) {
    place(plot.house, buildHouse(B, ground, plot.house));
    for (const ob of plot.outbuildings) place(ob, buildOutbuilding(B, ground, ob));
  }
  for (const ob of plan.standalone) place(ob, buildOutbuilding(B, ground, ob));
  const fences = createFences(plan.plots, ground, B, { tileSize: TILE });
  const poles = options.poles === false ? 0 : buildPoles(B, lines, plan, ground);

  const group = new THREE.Group();
  const tiles = new Map();
  let triangles = 0, drawCalls = 0;
  for (const builder of B.entries()) {
    if (builder.empty) continue;
    const material = mats[builder.materialKey];
    if (!material) throw new Error(`Unknown village material ${builder.materialKey}`);
    const mesh = new THREE.Mesh(builder.build(), material);
    mesh.castShadow = builder.materialKey !== 'glass';
    mesh.receiveShadow = true;
    mesh.name = `${builder.materialKey} ${builder.tile} ${builder.lod}`;
    triangles += mesh.geometry.index.count / 3; drawCalls++;
    let tile = tiles.get(builder.tile);
    if (!tile) {
      const [tx, tz] = builder.tile.split(',').map(Number);
      const centre = new THREE.Vector3((tx + .5) * TILE, 0, (tz + .5) * TILE);
      const root = new THREE.Group(), lod = new THREE.LOD(), detail = new THREE.Group();
      lod.position.copy(centre); detail.position.copy(centre).negate();
      lod.addLevel(detail, 0); lod.addLevel(new THREE.Object3D(), DETAIL_DISTANCE);
      root.add(lod); root.name = `village tile ${builder.tile}`; group.add(root);
      tiles.set(builder.tile, tile = { root, detail });
    }
    (builder.lod === 'detail' ? tile.detail : tile.root).add(mesh);
  }
  group.add(fences.group);
  const smoke = createSmoke(chimneys);
  group.add(smoke.object);
  group.name = `Village: ${plan.plots.length} houses, ${plan.rects.length - plan.plots.length} other buildings`;
  const stats = { houses: plan.plots.length, rects: plan.rects.length, pickets: fences.pickets, poles, chimneys: chimneys.length, triangles, drawCalls, ms: Math.round(performance.now() - t0) };
  console.info('Kalenovo village', stats);
  return {
    group,
    rects: plan.rects,
    plots: plan.plots,
    stats,
    setLights(on) { lights.value = on ? 1 : 0; },
  };
}
