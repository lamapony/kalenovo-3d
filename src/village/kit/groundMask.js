// Pure ground mask for the main street (no three.js): where the ground is trodden dirt (R),
// gravel or paving (G) and tilled soil (B), as feathered world rectangles rasterised into an
// RGBA8 grid that the terrain shader samples. Driven by the passport layout: yards beside the
// houses, worn strips outside the street fences, driveways from each gate to the road, paths
// from wickets, beds, and the trampled ground around sheds, banyas and woodpiles.
import { nearestOnLines } from '../passports.js';

export const MASK_RES = .7; // metres per texel (coarser if the street would not fit maxSize)
const CH = { dirt: 0, gravel: 1, soil: 2 };

function worldRect(frame, x0, x1, z0, z1) {
  const [x, z] = frame.world((x0 + x1) / 2, (z0 + z1) / 2);
  return { x, z, w: Math.abs(x1 - x0), d: Math.abs(z1 - z0), angle: frame.angle };
}
const shape = (rect, ch, v, f) => ({ ...rect, ch: CH[ch], v, f });

// Rect from point a to point b (world), width w: a strip along the segment.
function strip(a, b, w) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || .01;
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: len, d: w, angle: Math.atan2(dz, dx) };
}

export function groundShapes(plots, lines, { roadHalf = 4.5 } = {}) {
  const out = [];
  for (const plot of plots) {
    if (plot.filler || !plot.frame) continue;
    const F = plot.frame, h = plot.passport?.house;
    if (h) {
      const w = h.widthM, d = h.depthM, ys = plot.yardSide ?? 1;
      const edge = ys > 0 ? plot.s1 : plot.s0;
      // Yard beside the house on the gate side, and an apron behind it.
      out.push(shape(worldRect(F, ys * (w / 2 + .2), edge, plot.zFacade, -d / 2 - 5), 'dirt', .9, 1.8));
      out.push(shape(worldRect(F, -w / 2 - .5, w / 2 + .5, -d / 2 - 3.5, -d / 2 + .2), 'dirt', .55, 1.2));
    }
    for (const f of plot.fences) {
      if (f.role === 'side' || f.role === 'back' || f.role === 'return') continue;
      // Worn strip outside the street fence (the path along the fences).
      const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len = Math.hypot(dx, dz) || 1;
      const mid = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
      let nx = -dz / len, nz = dx / len;
      const toRoad = nearestOnLines(mid[0], mid[1], lines);
      if (toRoad.point && (toRoad.point[0] - mid[0]) * nx + (toRoad.point[1] - mid[1]) * nz < 0) { nx = -nx; nz = -nz; }
      const r = strip([f.a[0] + nx * 1.6, f.a[1] + nz * 1.6], [f.b[0] + nx * 1.6, f.b[1] + nz * 1.6], 3.2);
      out.push(shape(r, 'dirt', .62, 1.3));
      for (const g of f.gates) {
        const gx = f.a[0] + dx * g.t / len, gz = f.a[1] + dz * g.t / len;
        const near = nearestOnLines(gx, gz, lines);
        const dist = near.point ? Math.max(1, near.distance - roadHalf + .5) : 4;
        const outer = [gx + nx * dist, gz + nz * dist], inner = [gx - nx * 3.5, gz - nz * 3.5];
        if (g.type === 'wicket') out.push(shape(strip(inner, outer, 1.1), 'dirt', .85, .5));
        else {
          out.push(shape(strip([gx, gz], outer, g.width + .6), 'gravel', 1, .7));
          out.push(shape(strip(inner, [gx, gz], g.width + .4), 'gravel', .8, 1));
        }
      }
    }
    for (const y of plot.yard || []) {
      if (y.kind === 'beds') out.push({ x: y.x, z: y.z, w: y.w + .3, d: y.d + .3, angle: y.angle, ch: CH.soil, v: 1, f: .35 });
      else if (y.kind === 'banya' || y.kind === 'shed' || y.kind === 'woodpile' || y.kind === 'outhouse' || y.kind === 'greenhouse')
        out.push({ x: y.x, z: y.z, w: y.w + 2.4, d: y.d + 2.4, angle: y.angle, ch: CH.dirt, v: .6, f: 1 });
    }
    for (const o of plot.outbuildings || []) out.push({ x: o.x, z: o.z, w: o.w + 2.6, d: o.d + 2.6, angle: o.angle, ch: CH.dirt, v: .65, f: 1.1 });
  }
  return out;
}

export function maskBounds(shapes, pad = 6) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const s of shapes) {
    const r = Math.hypot(s.w, s.d) / 2;
    x0 = Math.min(x0, s.x - r); x1 = Math.max(x1, s.x + r); z0 = Math.min(z0, s.z - r); z1 = Math.max(z1, s.z + r);
  }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
}

// Rasterise shapes into RGBA8 (A unused = 255). Texel (i, j) covers x0 + (i + .5) * res,
// z0 + (j + .5) * res; row 0 is the smallest z. Channels combine by maximum.
export function rasterizeMask(shapes, bounds, res = MASK_RES, maxSize = 4096) {
  res = Math.max(res, (bounds.x1 - bounds.x0) / maxSize, (bounds.z1 - bounds.z0) / maxSize);
  const width = Math.min(maxSize, Math.ceil((bounds.x1 - bounds.x0) / res));
  const height = Math.min(maxSize, Math.ceil((bounds.z1 - bounds.z0) / res));
  const data = new Uint8Array(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const s of shapes) {
    const c = Math.cos(s.angle), sn = Math.sin(s.angle), hw = s.w / 2, hd = s.d / 2, r = Math.hypot(hw, hd);
    const i0 = Math.max(0, Math.floor((s.x - r - bounds.x0) / res)), i1 = Math.min(width - 1, Math.ceil((s.x + r - bounds.x0) / res));
    const j0 = Math.max(0, Math.floor((s.z - r - bounds.z0) / res)), j1 = Math.min(height - 1, Math.ceil((s.z + r - bounds.z0) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = bounds.x0 + (i + .5) * res - s.x, dz = bounds.z0 + (j + .5) * res - s.z;
      const u = dx * c + dz * sn, v = -dx * sn + dz * c;
      const inside = Math.min(hw - Math.abs(u), hd - Math.abs(v));
      if (inside <= 0) continue;
      const k = Math.min(1, inside / Math.max(.01, s.f)) * s.v;
      const idx = (j * width + i) * 4 + s.ch, val = Math.round(k * 255);
      if (val > data[idx]) data[idx] = val;
    }
  }
  return { data, width, height, x0: bounds.x0, z0: bounds.z0, res, sizeX: width * res, sizeZ: height * res };
}

export function sampleMask(mask, x, z) {
  const i = Math.floor((x - mask.x0) / mask.res), j = Math.floor((z - mask.z0) / mask.res);
  if (i < 0 || j < 0 || i >= mask.width || j >= mask.height) return [0, 0, 0];
  const k = (j * mask.width + i) * 4;
  return [mask.data[k] / 255, mask.data[k + 1] / 255, mask.data[k + 2] / 255];
}
