// URL switches: ?webgl=1 forces the WebGL2 backend, ?quality=low|high,
// ?debug=1 shows the stats overlay, ?tod=afternoon|sunset|night picks the
// time of day, ?view=street|bird a named screenshot camera, ?nohud=1 hides
// every overlay, ?tm=agx swaps ACES for AgX tone mapping,
// ?season=summer swaps the first snow for a hazy August day (no snow on roofs,
// no falling snow, grass and dry dirt roads; default stays first snow),
// ?fov=deg sets the vertical camera field of view (default 64).
// Inspection camera: ?cam=x,z,yawDeg,pitchDeg,heightAboveGround in local metres, or
// ?cam=ll:lat,lon,yaw,pitch,height in degrees, where yaw may be N or S to look
// perpendicular to улица Толстихина at its north or south side (street imagery framing).
// Pure so it can be unit tested.
export const TODS = ['afternoon', 'sunset', 'night'];
export const VIEWS = ['street', 'bird'];
export const SEASONS = ['winter', 'summer'];

function parseCamera(raw) {
  if (!raw) return null;
  if (raw.startsWith('ll:')) {
    const parts = raw.slice(3).split(',');
    const lat = Number(parts[0]), lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const side = ['N', 'S'].includes((parts[2] || '').toUpperCase()) ? parts[2].toUpperCase() : null;
    const yaw = side ? null : Number(parts[2] ?? 0);
    const pitch = Number(parts[3] ?? 0), height = Number(parts[4] ?? 1.7);
    if (!side && !Number.isFinite(yaw)) return null;
    if (!Number.isFinite(pitch) || !Number.isFinite(height)) return null;
    return { lat, lon, side, yaw, pitch, height };
  }
  const cam = raw.split(',').map(Number);
  return cam.length >= 2 && cam.every(Number.isFinite)
    ? { x: cam[0], z: cam[1], yaw: cam[2] ?? 0, pitch: cam[3] ?? 0, height: cam[4] ?? 1.7 }
    : null;
}

export function parseParams(search = '') {
  const query = new URLSearchParams(search);
  const flag = name => ['1', 'true', 'yes', ''].includes(query.get(name) ?? 'no');
  const quality = query.get('quality') === 'low' ? 'low' : 'high';
  const camera = parseCamera(query.get('cam') || '');
  const tod = TODS.includes(query.get('tod')) ? query.get('tod') : 'afternoon';
  const view = VIEWS.includes(query.get('view')) ? query.get('view') : null;
  // Tone mapping comparison switch: ?tm=agx (ACES is the default look).
  const toneMapping = query.get('tm') === 'agx' ? 'agx' : 'aces';
  const season = SEASONS.includes(query.get('season')) ? query.get('season') : 'winter';
  const fovRaw = Number(query.get('fov'));
  const fov = query.has('fov') && Number.isFinite(fovRaw) && fovRaw >= 10 && fovRaw <= 120 ? fovRaw : null;
  return { forceWebGL: flag('webgl'), quality, debug: flag('debug'), camera, tod, view, nohud: flag('nohud'), toneMapping, season, fov };
}
