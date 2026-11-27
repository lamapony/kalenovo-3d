import * as THREE from 'three/webgpu';
import './style.css';
import { createTerrain } from './terrain.js';
import { createPaths } from './paths.js';
import { createBuildings, mainStreetLayout } from './buildings.js';
import { groundShapes, maskBounds, rasterizeMask } from './village/kit/groundMask.js';
import { landCover, LAND_RES } from './village/kit/landCover.js';
import { createForest } from './forest.js';
import { createAtmosphere } from './atmosphere.js';
import { createWalkControls } from './controls.js';
import { createPost } from './post.js';
import { createStats } from './debug.js';
import { parseParams } from './params.js';
import { birdView, refCamera, streetView } from './views.js';
import { loadTerrainTextures } from './terrainMaterial.js';
import { keyLightDirection, prepareEnvironment } from './atmosphere.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { setSeason } from './season.js';

const canvas = document.querySelector('#scene');
const status = document.querySelector('#status');
const enter = document.querySelector('#enter');
const lightsButton = document.querySelector('#lights');
const params = parseParams(window.location.search);
const season = setSeason(params.season);
let renderer;
if (params.nohud) document.body.classList.add('nohud');

async function fetchData(file, type = 'json') {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status}).`);
  return type === 'binary' ? response.arrayBuffer() : response.json();
}

// Label over the family house (passport tolstikhina-45, "Толстихина, 45"), built by the kit.
function createFamilyMarker(family) {
  const anchor = family ? new THREE.Vector3(...family.top) : null;
  return { anchor, label: family?.label ?? '' };
}

async function createRenderer() {
  if (!params.forceWebGL && !navigator.gpu) console.info('WebGPU not available, using the WebGL2 backend.');
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', forceWebGL: params.forceWebGL });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, params.quality === 'high' ? 1.75 : 1.25));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = params.toneMapping === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  return backend;
}

async function start() {
  const base = import.meta.env.BASE_URL;
  const [backend, meta, dem, nearHeights, farHeights, osm, gba, textures, environment] = await Promise.all([
    createRenderer(),
    fetchData('meta.json'), fetchData('dem-info.json'),
    fetchData('heightmap-513.f32', 'binary'), fetchData('heightmap-far-7500m-257.f32', 'binary'),
    fetchData('osm.geojson'), fetchData('buildings-gba.geojson'),
    loadTerrainTextures(base),
    // CC0 HDRI (public/env/CREDITS.md), float data so the sun can be clamped out.
    new HDRLoader().setDataType(THREE.FloatType).loadAsync(`${base}env/stierberg_sunrise_1k.hdr`).then(prepareEnvironment),
  ]);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(params.fov ?? 64, 1, .2, 16000);
  const street = mainStreetLayout(osm.features, meta);
  const shapes = groundShapes(street.main.plots, street.lines);
  const groundMask = rasterizeMask(shapes, maskBounds(shapes));
  // Fields, hay strips and tracks around the street (second mask, coarser).
  const land = landCover(street.main.plots, street.lines);
  const landMask = rasterizeMask(land.shapes, maskBounds(land.shapes), LAND_RES);
  const terrain = createTerrain(meta, dem, nearHeights, farHeights, { textures, lightDirection: keyLightDirection(params.tod), groundMask, landMask }); scene.add(terrain.mesh);
  const ground = terrain.getGroundHeight;
  const paths = createPaths(osm.features, meta, ground, { textures }); scene.add(paths.group);
  const houses = createBuildings(osm.features, gba.features, meta, ground, { street, land }); scene.add(houses.group);
  scene.add(createForest(osm.features, meta, ground, paths.exclusions, houses.rects, { plots: houses.plots, trees: houses.gardenBirches, fieldTrees: houses.fieldTrees }));
  const family = createFamilyMarker(houses.family);
  const atmosphere = createAtmosphere(scene, camera, { quality: params.quality, tod: params.tod, environment });
  renderer.toneMappingExposure = atmosphere.exposure;
  // ?cam= wins over ?view=; both are inspection cameras for screenshots.
  const preset = params.view === 'street' ? streetView(osm.features, meta)
    : params.view === 'bird' && terrain.farElevations ? birdView(terrain.farElevations, dem.far) : null;
  const inspect = params.camera?.lat !== undefined ? refCamera(osm.features, meta, params.camera) : params.camera;
  const controls = createWalkControls(camera, canvas, meta, ground, houses.rects, { inspect: inspect ?? preset, fences: houses.fenceColliders });
  const post = createPost(renderer, scene, camera, { quality: params.quality, tod: params.tod });
  const stats = createStats(renderer, { backend, quality: params.quality, effects: post.enabled, debug: params.debug && !params.nohud, tod: params.tod });

  // three's renderer also updates LODs from each shadow camera, so cascades would
  // pick levels by their own distance (missing or extra shadow casters). Update
  // every LOD once per frame from the view camera instead.
  const lods = [];
  scene.traverse(o => { if (o.isLOD) { o.autoUpdate = false; lods.push(o); } });
  scene.updateMatrixWorld();  houses.smoke.tint.value.setRGB(...atmosphere.look.smoke);

  // Summer daylight: windows dark, no chimney smoke.
  let lightsOn = !season.summer;
  houses.setLights(lightsOn); lightsButton.setAttribute('aria-pressed', String(lightsOn));
  lightsButton.querySelector('span').textContent = `Тёплый свет: ${lightsOn ? 'вкл.' : 'выкл.'}`;
  houses.smoke.object.visible = !season.summer;
  function toggleLights() {
    lightsOn = !lightsOn; houses.setLights(lightsOn);
    lightsButton.setAttribute('aria-pressed', String(lightsOn));
    lightsButton.querySelector('span').textContent = `Тёплый свет: ${lightsOn ? 'вкл.' : 'выкл.'}`;
  }
  lightsButton.addEventListener('click', toggleLights);
  document.addEventListener('keydown', event => { if (event.code === 'KeyL' && !event.repeat) toggleLights(); });
  document.querySelector('#reset').addEventListener('click', controls.reset);
  enter.addEventListener('click', () => controls.lock());
  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize); resize();
  renderer.onDeviceLost = () => {
    status.hidden = false; status.textContent = 'Графика приостановлена. Обновите страницу, чтобы вернуться к прогулке.';
  };
  const label = document.querySelector('#marker'), projected = new THREE.Vector3();
  if (family.anchor) label.textContent = family.label;
  let previous = performance.now();
  function frame(now) {
    const dt = Math.min((now - previous) / 1000, .05); previous = now;
    controls.update(dt); atmosphere.update(dt);
    camera.updateMatrixWorld();
    for (const lod of lods) lod.update(camera);
    post.render();
    stats.frame(now);
    const distance = family.anchor ? camera.position.distanceTo(family.anchor) : Infinity;
    if (family.anchor) projected.copy(family.anchor).project(camera);
    const show = distance < 65 && projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < .85 && Math.abs(projected.y) < .75;
    label.hidden = !show;
    if (show) label.style.transform = `translate(${(projected.x * .5 + .5) * canvas.clientWidth}px,${(-projected.y * .5 + .5) * canvas.clientHeight}px) translate(-50%,-100%)`;
  }
  // Compile every pipeline before the first visible frame to avoid a hitch.
  await renderer.compileAsync(scene, camera).catch(() => {});
  renderer.setAnimationLoop(frame);
  status.hidden = true; enter.disabled = false; enter.textContent = 'Начать прогулку';
  console.info(`Kalenovo: ${backend}, ${params.quality} quality (${post.enabled.join(', ')}), ${params.tod}; sun ${atmosphere.sun.elevation.toFixed(1)}° high, azimuth ${atmosphere.sun.azimuth.toFixed(0)}°; ${houses.rects.length} deduplicated houses, ${paths.exclusions.length} path segments.`);
}

start().catch(error => {
  console.error(error); renderer?.dispose();
  status.hidden = false;
  status.textContent = 'Не удалось открыть пейзаж. Нужен браузер с WebGPU или WebGL2 и файлы public/data; обновите страницу.';
  enter.disabled = false; enter.textContent = 'Попробовать снова';
  enter.addEventListener('click', () => window.location.reload(), { once: true });
});
