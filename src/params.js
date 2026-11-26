// URL switches: ?webgl=1 forces the WebGL2 backend, ?quality=low|high,
// ?debug=1 shows the stats overlay. Pure so it can be unit tested.
export function parseParams(search = '') {
  const query = new URLSearchParams(search);
  const flag = name => ['1', 'true', 'yes', ''].includes(query.get(name) ?? 'no');
  const quality = query.get('quality') === 'low' ? 'low' : 'high';
  // Inspection camera for screenshots: ?cam=x,z,yawDeg,pitchDeg,heightAboveGround
  const cam = (query.get('cam') || '').split(',').map(Number);
  const camera = cam.length >= 2 && cam.every(Number.isFinite)
    ? { x: cam[0], z: cam[1], yaw: cam[2] ?? 0, pitch: cam[3] ?? 0, height: cam[4] ?? 1.7 }
    : null;
  return { forceWebGL: flag('webgl'), quality, debug: flag('debug'), camera };
}
