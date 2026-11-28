// Pure heightmap helpers (no three.js import) so they run under node:test.
// Grid layout is documented in public/data/dem-info.json: Float32 little-endian,
// row-major, row 0 = z=-half (north), col 0 = x=-half (west), metres above the
// EGM2008 geoid.

// One exaggeration for every terrain piece (near tile, far ring, sampler).
export const VERTICAL_EXAGGERATION = 1.25;

export function parseHeightmap(buffer, gridSize) {
  if (!Number.isInteger(gridSize) || gridSize < 2) throw new Error(`Invalid heightmap grid size ${gridSize}.`);
  const expected = gridSize * gridSize;
  if (!buffer || buffer.byteLength !== expected * 4) {
    throw new Error(`Invalid heightmap size: expected ${expected * 4} bytes for ${gridSize}x${gridSize}, got ${buffer?.byteLength}.`);
  }
  const view = new DataView(buffer);
  const elevations = new Float32Array(expected);
  for (let i = 0; i < expected; i++) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) throw new Error(`Invalid heightmap sample at index ${i}.`);
    elevations[i] = value;
  }
  return elevations;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Returns (x, z) => scene height in metres relative to centerElev, scaled by
// the vertical exaggeration. Bilinear interpolation of the four surrounding
// samples; coordinates outside the grid clamp to its edge.
export function createGroundSampler({ gridSize: n, halfSizeM: half, centerElev, exaggeration = VERTICAL_EXAGGERATION }, elevations) {
  if (elevations.length !== n * n) throw new Error('Heightmap length does not match gridSize.');
  const scale = (n - 1) / (half * 2);
  return (x, z) => {
    const gx = clamp((x + half) * scale, 0, n - 1);
    const gz = clamp((z + half) * scale, 0, n - 1);
    const x0 = Math.min(Math.floor(gx), n - 2), z0 = Math.min(Math.floor(gz), n - 2);
    const tx = gx - x0, tz = gz - z0, i = z0 * n + x0;
    const north = elevations[i] * (1 - tx) + elevations[i + 1] * tx;
    const south = elevations[i + n] * (1 - tx) + elevations[i + n + 1] * tx;
    return (north * (1 - tz) + south * tz - centerElev) * exaggeration;
  };
}

// Lowest and highest ground under an oriented rectangle footprint, sampled on
// a grid no coarser than `spacing` metres (corners, edges and interior).
export function footprintRange(ground, rect, spacing = 1.5) {
  const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
  const nu = Math.max(1, Math.ceil(rect.w / spacing)), nv = Math.max(1, Math.ceil(rect.d / spacing));
  let min = Infinity, max = -Infinity;
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = (i / nu - .5) * rect.w, v = (j / nv - .5) * rect.d;
    const h = ground(rect.x + u * c - v * s, rect.z + u * s + v * c);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return { min, max };
}
