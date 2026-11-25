import * as THREE from 'three';
import { inBuilding } from './buildings.js';

export function createWalkControls(camera, canvas, meta, ground, buildings, onReset) {
  const keys=new Set(), euler=new THREE.Euler(0,0,0,'YXZ');
  const spawn=meta.defaultSpawn, limit=meta.halfSizeM-12;
  let dragging=false, pointerId=null, yaw=0, pitch=0;
  function applyLook(){ euler.set(pitch,yaw,0); camera.quaternion.setFromEuler(euler); }
  function reset(){
    keys.clear();
    camera.position.set(spawn.x,ground(spawn.x,spawn.z)+1.7,spawn.z);
    // The DEM rises to the southwest: frame the village against Malan-Khada.
    yaw=2.15; pitch=.025; applyLook(); onReset?.();
  }
  function look(dx,dy){ yaw-=dx*.0022; pitch=THREE.MathUtils.clamp(pitch-dy*.0022,-Math.PI/2+.04,Math.PI/2-.04); applyLook(); }
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0) return;
    canvas.focus();
    if(document.pointerLockElement===canvas) return;
    dragging=true; pointerId=event.pointerId; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup',()=>{dragging=false;pointerId=null;});
  canvas.addEventListener('pointercancel',()=>{dragging=false;pointerId=null;});
  canvas.addEventListener('lostpointercapture',()=>{dragging=false;pointerId=null;});
  document.addEventListener('pointermove',event=>{
    if(document.pointerLockElement===canvas || (dragging && event.pointerId===pointerId)) look(event.movementX,event.movementY);
  });
  document.addEventListener('pointerlockerror',()=>{
    document.querySelector('#look-hint').textContent='Удерживайте мышь и тяните, чтобы осмотреться';
  });
  document.addEventListener('pointerlockchange',()=>{
    dragging=false; keys.clear(); document.body.classList.toggle('locked',document.pointerLockElement===canvas);
    document.querySelector('#look-hint').textContent=document.pointerLockElement===canvas ? 'Esc освобождает курсор' : 'Можно зажать и тянуть мышью · Esc освобождает курсор';
  });
  document.addEventListener('keydown',event=>{
    if(event.target instanceof HTMLButtonElement && ['Enter','Space'].includes(event.code)) return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if(event.code==='KeyR' && !event.repeat) reset();
  });
  document.addEventListener('keyup',event=>keys.delete(event.code));
  window.addEventListener('blur',()=>{keys.clear();dragging=false;});
  document.addEventListener('visibilitychange',()=>keys.clear());
  function blocked(x,z){return buildings.some(r=>inBuilding(x,z,r,.45));}
  reset();
  return {
    reset,
    async lock(){
      canvas.focus();
      try {
        if(!canvas.requestPointerLock) throw new Error('Pointer lock unavailable');
        await canvas.requestPointerLock();
      } catch {
        document.querySelector('#look-hint').textContent='Удерживайте мышь и тяните, чтобы осмотреться';
      }
    },
    update(dt){
      let forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
      let side=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
      const length=Math.hypot(forward,side);
      if(length){
        forward/=length; side/=length;
        const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight'))?8:3.4;
        const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed*dt;
        const dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*speed*dt;
        const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.4));
        for(let i=0;i<steps;i++){
          const x=THREE.MathUtils.clamp(camera.position.x+dx/steps,-limit,limit);
          if(!blocked(x,camera.position.z)) camera.position.x=x;
          const z=THREE.MathUtils.clamp(camera.position.z+dz/steps,-limit,limit);
          if(!blocked(camera.position.x,z)) camera.position.z=z;
        }
      }
      camera.position.y=ground(camera.position.x,camera.position.z)+1.7;
    }
  };
}
