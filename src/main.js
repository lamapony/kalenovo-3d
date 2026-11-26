import * as THREE from 'three/webgpu';
import './style.css';
import { createTerrain } from './terrain.js';
import { createPaths } from './paths.js';
import { createBuildings } from './buildings.js';
import { createForest } from './forest.js';
import { createAtmosphere } from './atmosphere.js';
import { createWalkControls } from './controls.js';
import { createPost } from './post.js';
import { createStats } from './debug.js';
import { parseParams } from './params.js';
import { birdView, streetView } from './views.js';
import { loadTerrainTextures } from './terrainMaterial.js';
import { keyLightDirection, prepareEnvironment } from './atmosphere.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const canvas = document.querySelector('#scene');
const status = document.querySelector('#status');
const enter = document.querySelector('#enter');
const lightsButton = document.querySelector('#lights');
const params = parseParams(window.location.search);
let renderer;
if (params.nohud) document.body.classList.add('nohud');

async function fetchData(file, type = 'json') {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status}).`);
  return type === 'binary' ? response.arrayBuffer() : response.json();
}

function createFamilyMarker(meta, ground, houses) {
  const spawn = meta.defaultSpawn;
  const facing = houses.filter(h => {
    const dx = h.x - spawn.x, dz = h.z - spawn.z;
    return (-Math.sin(2.15) * dx - Math.cos(2.15) * dz) / (Math.hypot(dx, dz) || 1) > .85;
  });
  const nearest = [...(facing.length ? facing : houses)].sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z))[0];
  // A fictional memory marker beside a nearby house, never an address/identity.
  let x = spawn.x + 8, z = spawn.z - 6;
  if (nearest && Math.hypot(nearest.x - spawn.x, nearest.z - spawn.z) < 100) {
    const dx = spawn.x - nearest.x, dz = spawn.z - nearest.z, len = Math.hypot(dx, dz) || 1;
    x = nearest.x + dx / len * (Math.hypot(nearest.w, nearest.d) / 2 + 1.5);
    z = nearest.z + dz / len * (Math.hypot(nearest.w, nearest.d) / 2 + 1.5);
  }
  // Seat the post on the lowest ground under its base so no side floats.
  const y = Math.min(ground(x, z), ground(x + .1, z), ground(x - .1, z), ground(x, z + .1), ground(x, z - .1));
  const group = new THREE.Group(); group.position.set(x, y, z);
  const wood = new THREE.MeshStandardMaterial({ color: '#6e6856', roughness: 1 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(.15, 1.85, .15), wood); post.position.y = .725; post.castShadow = true; group.add(post);
  const lampMaterial = new THREE.MeshStandardMaterial({ color: '#ffe0a0', emissive: '#ffbe66', emissiveIntensity: 2.2 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(.25, .33, .25), lampMaterial); lamp.position.y = 1.7; group.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(.27, .2, 4), new THREE.MeshStandardMaterial({ color: '#e4e8df', roughness: 1 })); cap.rotation.y = Math.PI / 4; cap.position.y = 1.96; cap.castShadow = true; group.add(cap);
  const light = new THREE.PointLight('#ffd394', 9, 9, 2); light.position.y = 1.65; group.add(light);
  return {
    group, anchor: new THREE.Vector3(x, y + 2.6, z),
    setLights(on) { light.visible = on; lampMaterial.emissiveIntensity = on ? 2.2 : 0; lampMaterial.color.set(on ? '#ffe0a0' : '#74827b'); },
  };
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
  const camera = new THREE.PerspectiveCamera(64, 1, .2, 16000);
  const terrain = createTerrain(meta, dem, nearHeights, farHeights, { textures, lightDirection: keyLightDirection(params.tod) }); scene.add(terrain.mesh);
  const ground = terrain.getGroundHeight;
  const paths = createPaths(osm.features, meta, ground); scene.add(paths.group);
  const houses = createBuildings(osm.features, gba.features, meta, ground); scene.add(houses.group);
  scene.add(createForest(osm.features, meta, ground, paths.exclusions, houses.rects));
  const family = createFamilyMarker(meta, ground, houses.rects); scene.add(family.group);
  const atmosphere = createAtmosphere(scene, camera, { quality: params.quality, tod: params.tod, environment });
  renderer.toneMappingExposure = atmosphere.exposure;
  // ?cam= wins over ?view=; both are inspection cameras for screenshots.
  const preset = params.view === 'street' ? streetView(osm.features, meta)
    : params.view === 'bird' && terrain.farElevations ? birdView(terrain.farElevations, dem.far) : null;
  const controls = createWalkControls(camera, canvas, meta, ground, houses.rects, { inspect: params.camera ?? preset });
  const post = createPost(renderer, scene, camera, { quality: params.quality, tod: params.tod });
  const stats = createStats(renderer, { backend, quality: params.quality, effects: post.enabled, debug: params.debug && !params.nohud, tod: params.tod });

  let lightsOn = true;
  function toggleLights() {
    lightsOn = !lightsOn; houses.setLights(lightsOn); family.setLights(lightsOn);
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
  let previous = performance.now();
  function frame(now) {
    const dt = Math.min((now - previous) / 1000, .05); previous = now;
    controls.update(dt); atmosphere.update(dt);
    post.render();
    stats.frame(now);
    projected.copy(family.anchor).project(camera);
    const distance = camera.position.distanceTo(family.anchor);
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
