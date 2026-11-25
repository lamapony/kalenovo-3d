import * as THREE from 'three';
import { randomGenerator } from './geo.js';

export function createAtmosphere(scene, camera) {
  const sky = new THREE.Color('#d6e0df');
  scene.background = sky; scene.fog = new THREE.FogExp2(sky, .00082);
  scene.add(new THREE.HemisphereLight('#e8f1f1','#8b9384',2.15));
  const sun = new THREE.DirectionalLight('#fff0d7',2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-100,right:100,top:100,bottom:-100,near:1,far:600});
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias=-.0003; sun.shadow.normalBias=.12; sun.shadow.radius=3;
  scene.add(sun,sun.target);
  const count = 1800, positions = new Float32Array(count*3), speeds = new Float32Array(count), random = randomGenerator(71);
  for(let i=0;i<count;i++){ positions[i*3]=(random()-.5)*160; positions[i*3+1]=random()*75-12; positions[i*3+2]=(random()-.5)*160; speeds[i]=.65+random()*.9; }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const canvas = document.createElement('canvas'); canvas.width=32; canvas.height=32;
  const ctx=canvas.getContext('2d');
  const fade=ctx.createRadialGradient(16,16,2,16,16,15); fade.addColorStop(0,'rgba(255,255,255,1)'); fade.addColorStop(.5,'rgba(255,255,255,.8)'); fade.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=fade; ctx.fillRect(0,0,32,32);
  const material = new THREE.PointsMaterial({color:'#ffffff',size:.15,map:new THREE.CanvasTexture(canvas),transparent:true,opacity:.72,depthWrite:false,sizeAttenuation:true});
  const flakes=new THREE.Points(geometry,material); flakes.frustumCulled=false; scene.add(flakes);
  const lastCamera = camera.position.clone();
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  return {
    update(dt,time){
      sun.position.set(camera.position.x-240,camera.position.y+110,camera.position.z+180);
      sun.target.position.copy(camera.position);
      const deltaX=camera.position.x-lastCamera.x, deltaY=camera.position.y-lastCamera.y, deltaZ=camera.position.z-lastCamera.z;
      lastCamera.copy(camera.position);
      flakes.position.copy(camera.position);
      if(reduced.matches) { flakes.visible=false; return; }
      flakes.visible=true;
      for(let i=0;i<count;i++){
        positions[i*3]-=deltaX; positions[i*3+1]-=deltaY; positions[i*3+2]-=deltaZ;
        positions[i*3]+=Math.sin(time*.18+i)*dt*.18+dt*.28;
        positions[i*3+1]-=dt*speeds[i];
        positions[i*3]=((positions[i*3]+80)%160+160)%160-80;
        positions[i*3+1]=((positions[i*3+1]+12)%75+75)%75-12;
        positions[i*3+2]=((positions[i*3+2]+80)%160+160)%160-80;
      }
      geometry.attributes.position.needsUpdate=true;
    }
  };
}
