// Named screenshot cameras (?view=street|bird), derived from the data rather
// than hard-coded, so they follow the OSM street and the DEM. Pure (no
// three.js) so they run under node:test. Returned objects match the ?cam=
// inspection camera: { x, z, yaw, pitch (degrees), height above ground (m) }.
// Yaw follows src/controls.js: the camera looks along (-sin yaw, -cos yaw).
import { toLocal } from './geo.js';
import { streetLines, nearestOnLines } from './village/passports.js';

const DEG = 180 / Math.PI;
export const STREET_NAME = 'улица Толстихина';
export const STREET_ANCHOR_X = 0;

export function yawTowards(from, to) {
  return Math.atan2(-(to[0] - from[0]), -(to[1] - from[1])) * DEG;
}

// Eye level on the named street where it crosses x = anchorX, looking east
// along it towards the first vertex at least `ahead` metres down the road.
export function streetView(features, meta, { name = STREET_NAME, anchorX = STREET_ANCHOR_X, ahead = 300, height = 1.7, pitch = -1.5 } = {}) {
  const lines = features
    .filter(f => f.properties?.name === name && f.geometry?.type === 'LineString')
    .map(f => f.geometry.coordinates.map(c => toLocal(c[0], c[1], meta)));
  let best = null;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      if ((a[0] - anchorX) * (b[0] - anchorX) > 0) continue; // segment does not cross x = anchorX
      const t = (anchorX - a[0]) / (b[0] - a[0] || 1);
      const point = [anchorX, a[1] + t * (b[1] - a[1])];
      // Prefer the crossing closest to the scene centre if the street crosses twice.
      if (!best || Math.abs(point[1]) < Math.abs(best.point[1])) best = { line, i, point };
    }
  }
  if (!best) return null;
  const { line, i, point } = best;
  const step = line[i + 1][0] > line[i][0] ? 1 : -1; // walk towards larger x (east)
  let k = step > 0 ? i + 1 : i, target = line[k];
  while (Math.hypot(target[0] - point[0], target[1] - point[1]) < ahead && line[k + step]) { k += step; target = line[k]; }
  return { x: point[0], z: point[1], yaw: yawTowards(point, target), pitch, height, target };
}

// High above the village centre (scene origin = the OSM place node), pulled
// back from the highest DEM sample so the houses sit in the lower half of the
// frame and the highest hills fill the top.
export function birdView(farHeights, { gridSize: n, halfSizeM: half }, { height = 160, pitch = -19, back = 260 } = {}) {
  let peak = 0;
  for (let i = 1; i < farHeights.length; i++) if (farHeights[i] > farHeights[peak]) peak = i;
  const step = half * 2 / (n - 1);
  const target = [-half + (peak % n) * step, -half + Math.floor(peak / n) * step];
  const len = Math.hypot(target[0], target[1]) || 1;
  const x = -target[0] / len * back, z = -target[1] / len * back;
  return { x, z, yaw: yawTowards([x, z], target), pitch, height, target, peakElevation: farHeights[peak] };
}

// Street imagery framing (?cam=ll:lat,lon,N|S,pitch,height): the camera stands at
// (lat, lon) and looks perpendicular to the nearest segment of the named street,
// towards its north (N) or south (S) side. A numeric yaw is used as is.
export function refCamera(features, meta, { lat, lon, side = null, yaw = 0, pitch = 0, height = 1.7 }, { name = STREET_NAME } = {}) {
  const [x, z] = toLocal(lon, lat, meta);
  if (!side) return { x, z, yaw, pitch, height };
  const lines = streetLines(features, meta, name);
  const { dir } = nearestOnLines(x, z, lines);
  if (!dir) return { x, z, yaw: side === 'N' ? 0 : 180, pitch, height };
  let nx = -dir[1], nz = dir[0];
  if ((side === 'N') !== (nz < 0)) { nx = -nx; nz = -nz; }
  return { x, z, yaw: Math.atan2(-nx, -nz) * DEG, pitch, height };
}
