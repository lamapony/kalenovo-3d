export function toLocal(lon, lat, meta) {
  return [(lon - meta.centerLon) * meta.metersPerDegLon, -(lat - meta.centerLat) * meta.metersPerDegLat];
}

export function polygons(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x, z, rings) {
  return pointInRing(x, z, rings[0]) && !rings.slice(1).some(r => pointInRing(x, z, r));
}

export function segmentDistanceSq(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2;
}

// Liang–Barsky clipping prevents long OSM ways from reaching beyond the DEM.
export function clipSegment(a, b, limit) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  let lo = 0, hi = 1;
  const p = [-dx, dx, -dz, dz], q = [a[0] + limit, limit - a[0], a[1] + limit, limit - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return [[a[0] + lo * dx, a[1] + lo * dz], [a[0] + hi * dx, a[1] + hi * dz]];
}

export function randomGenerator(seed = 714) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
