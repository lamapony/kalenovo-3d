import * as THREE from 'three/webgpu';
import { collectFootprints, wayLines, planVillage, fitRectangle, inRect, fenceColliders } from './village/plan.js';
import { TiledBuilders } from './village/builder.js';
import { createVillageMaterials } from './village/materials.js';
import { buildHouse, buildOutbuilding } from './village/house.js';
import { createFences } from './fences.js';
import { buildPoles } from './village/poles.js';
import { createSmoke } from './village/smoke.js';
import { loadPassports, streetLines } from './village/passports.js';
import { layoutMainStreet } from './village/kit/layout.js';
import { buildKitHouse, buildKitOutbuilding } from './village/kit/house.js';
import { buildKitFences } from './village/kit/fences.js';
import { createKitMaterials } from './village/kit/materials.js';
import passportDoc from '../data/main-street-houses.json';

export { fitRectangle };
// Kept for controls.js / forest.js: point-in-rotated-rectangle test with margin.
export function inBuilding(x, z, rect, margin = 0) { return inRect(x, z, rect, margin); }

const TILE = 220, DETAIL_DISTANCE = 260;
export const FAMILY_HOUSE_ID = 'tolstikhina-45';

// Village: улица Толстихина from house passports (data/main-street-houses.json, built with the
// kit in src/village/kit/), everything else procedural from OSM + GBA footprints, which are
// split into plots along the street; each generic plot gets a log or plank house, outbuildings
// and a fence with gates. Generic content never enters a passport plot.
// Returns rects (houses, annexes, outbuildings) for collisions, plots for vegetation, fence
// colliders, and the family house (label anchor).
export function createBuildings(osm, gba, meta, ground, options = {}) {
  const t0 = performance.now();
  const lines = wayLines(osm, meta);
  const passports = loadPassports(passportDoc);
  const main = layoutMainStreet(passports, meta, streetLines(osm, meta, passportDoc.street));
  const skipGba = new Set(passports.map(p => p.footprintIndex).filter(i => i !== null));
  const plan = planVillage({
    footprints: collectFootprints(osm, gba, meta), lines, halfSize: meta.halfSizeM, seed: options.seed ?? 83,
    reserved: main.reserved, skipGba, reservedFences: main.colliders,
  });
  const { mats, lights } = createVillageMaterials();
  const kit = createKitMaterials();
  Object.assign(mats, kit.mats);
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

  // Main street from passports.
  const mainRects = [...main.rects];
  let family = null;
  for (const plot of main.plots) {
    if (!plot.house) continue;
    const r = buildKitHouse(B, ground, plot);
    place(plot.house, r);
    mainRects.push(...r.extraRects);
    if (plot.id === FAMILY_HOUSE_ID) family = { rect: plot.house, top: r.top, label: 'Толстихина, 45' };
  }
  for (const ob of main.outbuildings) place(ob, buildKitOutbuilding(B, ground, ob));
  const kitFences = buildKitFences(B, ground, main.plots);

  const group = new THREE.Group();
  const tiles = new Map();
  let triangles = 0, drawCalls = 0;
  for (const builder of B.entries()) {
    if (builder.empty) continue;
    const material = mats[builder.materialKey];
    if (!material) throw new Error(`Unknown village material ${builder.materialKey}`);
    const mesh = new THREE.Mesh(builder.build(), material);
    mesh.castShadow = builder.materialKey !== 'glass' && builder.materialKey !== 'kitGlass';
    mesh.receiveShadow = true;
    mesh.name = `${builder.materialKey} ${builder.tile} ${builder.lod}`;
    triangles += mesh.geometry.index.count / 3; drawCalls++;
    let tile = tiles.get(builder.tile);
    if (!tile) {
      const [tx, tz] = builder.tile.split(',').map(Number);
      const centre = new THREE.Vector3((tx + .5) * TILE, 0, (tz + .5) * TILE);
      // 'detail' meshes (carvings, log corner overhangs) only near; 'far' stand-ins only beyond.
      const root = new THREE.Group(), lod = new THREE.LOD(), detail = new THREE.Group(), far = new THREE.Group();
      lod.position.copy(centre); detail.position.copy(centre).negate(); far.position.copy(centre).negate();
      lod.addLevel(detail, 0); lod.addLevel(far, DETAIL_DISTANCE);
      root.add(lod); root.name = `village tile ${builder.tile}`; group.add(root);
      tiles.set(builder.tile, tile = { root, detail, far });
    }
    (builder.lod === 'detail' ? tile.detail : builder.lod === 'far' ? tile.far : tile.root).add(mesh);
  }
  group.add(fences.group);
  const smoke = createSmoke(chimneys);
  group.add(smoke.object);
  const mainHouses = main.plots.filter(p => p.house).length;
  group.name = `Village: ${plan.plots.length} generic + ${mainHouses} passport houses`;
  const stats = {
    houses: plan.plots.length, passportHouses: mainHouses, passportPlots: main.plots.length, rects: plan.rects.length + mainRects.length,
    pickets: fences.pickets, kitFencePieces: kitFences.pieces, poles, chimneys: chimneys.length, triangles, drawCalls, ms: Math.round(performance.now() - t0),
  };
  console.info('Kalenovo village', stats);
  return {
    group,
    rects: [...plan.rects, ...mainRects],
    plots: [...plan.plots, ...main.plots],
    fenceColliders: [...fenceColliders(plan.plots), ...main.colliders],
    family,
    stats,
    smoke,
    setLights(on) { lights.value = on ? 1 : 0; kit.lights.value = on ? 1 : 0; },
  };
}
