import * as THREE from 'three/webgpu';
import './style.css';
import { createTerrain } from './terrain.js';
import { createPaths } from './paths.js';
import { createBuildings } from './buildings.js';
import { createForest } from './forest.js';
import { createAtmosphere } from './atmosphere.js';
import { createWalkControls } from './controls.js';

const canvas=document.querySelector('#scene');
const status=document.querySelector('#status');
const enter=document.querySelector('#enter');
const lightsButton=document.querySelector('#lights');
let renderer;

async function fetchData(file,type='json') {
  const response=await fetch(`${import.meta.env.BASE_URL}data/${file}`);
  if(!response.ok) throw new Error(`Could not load ${file} (${response.status}).`);
  return type==='binary' ? response.arrayBuffer() : response.json();
}

function createFamilyMarker(meta,ground,houses) {
  const spawn=meta.defaultSpawn;
  const facing=houses.filter(h=>{
    const dx=h.x-spawn.x,dz=h.z-spawn.z;
    return (-Math.sin(2.15)*dx-Math.cos(2.15)*dz)/(Math.hypot(dx,dz)||1)>.85;
  });
  const nearest=[...(facing.length?facing:houses)].sort((a,b)=>Math.hypot(a.x-spawn.x,a.z-spawn.z)-Math.hypot(b.x-spawn.x,b.z-spawn.z))[0];
  // A fictional memory marker beside a nearby house, never an address/identity.
  let x=spawn.x+8,z=spawn.z-6;
  if(nearest && Math.hypot(nearest.x-spawn.x,nearest.z-spawn.z)<100){
    const dx=spawn.x-nearest.x,dz=spawn.z-nearest.z,len=Math.hypot(dx,dz)||1;
    x=nearest.x+dx/len*(Math.hypot(nearest.w,nearest.d)/2+1.5);
    z=nearest.z+dz/len*(Math.hypot(nearest.w,nearest.d)/2+1.5);
  }
  const group=new THREE.Group(); group.position.set(x,ground(x,z),z);
  const wood=new THREE.MeshStandardMaterial({color:'#6e6856',roughness:1});
  const post=new THREE.Mesh(new THREE.BoxGeometry(.15,1.65,.15),wood); post.position.y=.825; post.castShadow=true; group.add(post);
  const lampMaterial=new THREE.MeshStandardMaterial({color:'#ffe0a0',emissive:'#ffbe66',emissiveIntensity:1.5});
  const lamp=new THREE.Mesh(new THREE.BoxGeometry(.25,.33,.25),lampMaterial); lamp.position.y=1.7; group.add(lamp);
  const cap=new THREE.Mesh(new THREE.ConeGeometry(.27,.2,4),new THREE.MeshStandardMaterial({color:'#e4e8df',roughness:1})); cap.rotation.y=Math.PI/4; cap.position.y=1.96; group.add(cap);
  const light=new THREE.PointLight('#ffd394',7,7,2); light.position.y=1.65; group.add(light);
  return {group,anchor:new THREE.Vector3(x,ground(x,z)+2.6,z),setLights(on){light.visible=on;lampMaterial.emissiveIntensity=on?1.5:0;lampMaterial.color.set(on?'#ffe0a0':'#74827b');}};
}

async function start(){
  renderer=new THREE.WebGPURenderer({canvas,antialias:true,powerPreference:'high-performance'});
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.05;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(64,1,.08,4200);
  const [meta,heightmap,osm,gba]=await Promise.all([
    fetchData('meta.json'),fetchData('heightmap.f32','binary'),fetchData('osm.geojson'),fetchData('buildings-gba.geojson'),
  ]);
  const terrain=createTerrain(meta,heightmap); scene.add(terrain.mesh);
  const paths=createPaths(osm.features,meta,terrain.getGroundHeight); scene.add(paths.group);
  const houses=createBuildings(osm.features,gba.features,meta,terrain.getGroundHeight); scene.add(houses.group);
  scene.add(createForest(osm.features,meta,terrain.getGroundHeight,paths.exclusions,houses.rects,{plots:houses.plots}));
  const family=createFamilyMarker(meta,terrain.getGroundHeight,houses.rects); scene.add(family.group);
  const atmosphere=createAtmosphere(scene,camera);
  const controls=createWalkControls(camera,canvas,meta,terrain.getGroundHeight,houses.rects);
  let lightsOn=true;
  function toggleLights(){
    lightsOn=!lightsOn; houses.setLights(lightsOn); family.setLights(lightsOn);
    lightsButton.setAttribute('aria-pressed',String(lightsOn));
    lightsButton.querySelector('span').textContent=`Тёплый свет: ${lightsOn?'вкл.':'выкл.'}`;
  }
  lightsButton.addEventListener('click',toggleLights);
  document.addEventListener('keydown',event=>{if(event.code==='KeyL'&&!event.repeat)toggleLights();});
  document.querySelector('#reset').addEventListener('click',controls.reset);
  enter.addEventListener('click',()=>controls.lock());
  const resize=()=>{renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix();};
  window.addEventListener('resize',resize); resize();
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault(); status.hidden=false; status.textContent='Графика приостановлена. Обновите страницу, чтобы вернуться к прогулке.';
  });
  const label=document.querySelector('#marker'), projected=new THREE.Vector3();
  let previous=performance.now(),elapsed=0;
  function frame(now){
    const dt=Math.min((now-previous)/1000,.05); previous=now; elapsed+=dt;
    controls.update(dt); atmosphere.update(dt,elapsed);
    renderer.render(scene,camera);
    projected.copy(family.anchor).project(camera);
    const distance=camera.position.distanceTo(family.anchor);
    const show=distance<65&&projected.z>-1&&projected.z<1&&Math.abs(projected.x)<.85&&Math.abs(projected.y)<.75;
    label.hidden=!show;
    if(show)label.style.transform=`translate(${(projected.x*.5+.5)*canvas.clientWidth}px,${(-projected.y*.5+.5)*canvas.clientHeight}px) translate(-50%,-100%)`;
  }
  renderer.setAnimationLoop(frame);
  status.hidden=true; enter.disabled=false; enter.textContent='Начать прогулку';
  // Read-only scene statistics make data omissions inspectable during development.
  console.info(`Kalenovo: ${houses.rects.length} deduplicated houses, ${paths.exclusions.length} path segments.`,scene.children.find(o=>o.name.endsWith('snow-topped pines'))?.name);
}

start().catch(error=>{
  console.error(error); renderer?.dispose();
  status.hidden=false; status.textContent='Не удалось открыть пейзаж. Проверьте поддержку WebGL и наличие файлов public/data, затем обновите страницу.';
  enter.disabled=false; enter.textContent='Попробовать снова';
  enter.addEventListener('click',()=>window.location.reload(),{once:true});
});
