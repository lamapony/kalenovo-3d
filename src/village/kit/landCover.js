// Pure land cover around улица Толстихина (no three.js), after the satellite crops of the
// street: behind every passport plot a long fenced strip (огород / покос) runs on away from
// the street, mown hay in swaths, potato rows or rough unmown grass; pole fences on the strip
// boundaries and across the far ends; a back lane (задворки) along the strip ends, dirt tracks
// down some strip boundaries and out into the fields; hay stacks on mown strips; birch clumps
// and shrubs on the field edges. Nothing here is a building.
// Output: mask shapes for a second terrain mask (R mown hay, value = swath brightness;
// G tilled potato field; B dirt track; A rough grass / weedy boundary), fence segments, stacks
// and trees. World frame as layout.js (x east, z south).
import { chainage } from './layout.js';
import { randomGenerator } from '../../geo.js';

export const LAND_RES = 1; // metres per texel of the land-cover mask
const CH = { hay: 0, potato: 1, track: 2, rough: 3 };
export const FIELD_FENCE_COLOR = '#6a6255';

function worldRect(frame, x0, x1, z0, z1) {
  const [x, z] = frame.world((x0 + x1) / 2, (z0 + z1) / 2);
  return { x, z, w: Math.abs(x1 - x0), d: Math.abs(z1 - z0), angle: frame.angle };
}
function strip(a, b, w) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || .01;
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: len, d: w, angle: Math.atan2(dz, dx) };
}
const shape = (r, ch, v, f) => ({ ...r, ch: CH[ch], v, f });

// Strip length behind a plot: smooth along the street (so the back lane is a gentle curve),
// 35..80 m, plus a little per-plot jitter.
export function stripLength(s, seed, jitter = 0) {
  const ph = (seed % 997) / 997 * Math.PI * 2;
  return Math.max(35, Math.min(80, 55 + 17 * Math.sin(s / 95 + ph) + 6 * Math.sin(s / 37 + ph * 1.7) + jitter));
}

// Strip use from a seeded draw: about half mown hay, a quarter potato, a quarter rough grass.
export function stripUse(u) { return u < .5 ? 'hay' : u < .75 ? 'potato' : 'rough'; }

export function landCover(plots, lines, { seed = 4242 } = {}) {
  const shapes = [], fences = [], stacks = [], trees = [], lanes = [];
  const rows = { N: [], S: [] };
  for (const plot of plots) {
    if (plot.filler || !plot.frame || !plot.passport?.house || plot.zBack === undefined) continue;
    const c = chainage(plot.frame.x, plot.frame.z, lines);
    rows[plot.passport.side]?.push({ plot, c });
  }
  for (const [side, row] of Object.entries(rows)) {
    row.sort((a, b) => a.c.line - b.c.line || a.c.s - b.c.s);
    const sideSeed = seed ^ (side === 'N' ? 0x1f2e : 0x3d4c);
    let prev = null;
    row.forEach((item, k) => {
      const { plot, c } = item, F = plot.frame, r = randomGenerator((plot.seed ^ sideSeed) >>> 0 || 1);
      const L = stripLength(c.s, sideSeed, (r() - .5) * 6), z0 = plot.zBack - .4, z1 = plot.zBack - L;
      const use = stripUse(r());
      const x0 = plot.s0 + .3, x1 = plot.s1 - .3;
      item.L = L; item.use = use;
      if (use === 'hay') {
        // Mowing swaths along the strip, alternating light (just cut) and darker (regrowth).
        const n = Math.max(2, Math.round((x1 - x0) / 2.6));
        for (let i = 0; i < n; i++) shapes.push(shape(worldRect(F, x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n, z1, z0), 'hay', i % 2 ? .62 : 1, .5));
        // Hay stacks (зароды) on about half of the mown strips.
        const m = r() < .55 ? 1 + (r() < .35 ? 1 : 0) : 0;
        for (let j = 0; j < m; j++) {
          const lx = x0 + 2.5 + r() * Math.max(.1, x1 - x0 - 5), lz = z1 + 7 + r() * Math.max(.1, L - 18);
          const [x, z] = F.world(lx, lz);
          stacks.push({ x, z, angle: F.angle + Math.PI / 2 + (r() - .5) * .5, len: 3.4 + r() * 1.8, w: 2.1 + r() * .6, h: 2.1 + r() * .7 });
        }
      } else if (use === 'potato') shapes.push(shape(worldRect(F, x0, x1, z1 + 1.5, z0 - 1), 'potato', 1, 1.2));
      else shapes.push(shape(worldRect(F, x0, x1, z1, z0), 'rough', .85, 2.5));
      // Weedy margin along the boundary at the +x edge (and the -x edge of a row's first plot).
      const edges = [plot.s1]; if (!prev) edges.push(plot.s0);
      const crossTrack = k % 7 === 3 && k < row.length - 1;
      for (const ex of edges) {
        shapes.push(shape(worldRect(F, ex - .9, ex + .9, z1, z0), 'rough', .75, .7));
        if (crossTrack && ex === plot.s1) {
          // A dirt track down this boundary from the back fences to the lane; no fence here.
          shapes.push(shape(strip(F.world(ex, plot.zBack + .5), F.world(ex, z1 - 3.5), 3.2), 'track', 1, 1));
        } else fences.push({ a: F.world(ex, plot.zBack - .2), b: F.world(ex, z1), kind: 'boundary' });
        // Birch clumps and shrubs where the boundaries meet the lane.
        if (r() < .3) {
          const [bx, bz] = F.world(ex + (r() - .5) * 2, z1 - 1.2), n = 1 + Math.floor(r() * 3);
          for (let t = 0; t < n; t++) trees.push({ x: bx + (r() - .5) * 4, z: bz + (r() - .5) * 4, scale: .5 + r() * .35 });
        }
        for (let lz = z0 - 6; lz > z1 + 4; lz -= 9 + r() * 12) if (r() < .22) { const [sx, sz] = F.world(ex + (r() - .5) * 1.2, lz); trees.push({ x: sx, z: sz, scale: .2 + r() * .12, shrub: true }); }
      }
      // Far end of the strip.
      fences.push({ a: F.world(plot.s0, z1), b: F.world(plot.s1, z1), kind: 'end' });
      // Back lane through the strip ends (continuous while the plots are neighbours).
      const lp = F.world((plot.s0 + plot.s1) / 2, z1 - 3.5);
      if (prev && prev.c.line === c.line && c.s - prev.c.s < 45) lanes.push([prev.lp, lp]);
      item.lp = lp;
      // Now and then a track leaves the lane for the fields, curving a little.
      if (k % 11 === 5) {
        const [ax, az] = F.world(0, 0), [bx, bz] = F.world(0, -1);
        let p = lp, ang = Math.atan2(bx - ax, bz - az);
        const seg = 4 + Math.floor(r() * 3);
        for (let i = 0; i < seg; i++) {
          ang += (r() - .5) * .5;
          const q = [p[0] + Math.sin(ang) * 40, p[1] + Math.cos(ang) * 40];
          lanes.push([p, q]); p = q;
        }
      }
      prev = item;
    });
  }
  for (const [a, b] of lanes) shapes.push(shape(strip(a, b, 3.2), 'track', 1, 1));
  return { shapes, fences, stacks, trees, lanes, rows };
}

// Cut fence segments where they would run through a building (rects in the plan.js / layout
// convention, margin in metres): returns the remaining pieces of at least `minLen`.
export function clearFences(segments, blocked, { step = 1.5, minLen = 3 } = {}) {
  const out = [];
  for (const s of segments) {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / step));
    let start = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = s.a[0] + dx * t, z = s.a[1] + dz * t, free = !blocked(x, z);
      if (free && start === null) start = t;
      if ((!free || i === n) && start !== null) {
        const end = free ? t : (i - 1) / n;
        if ((end - start) * len >= minLen) out.push({ ...s, a: [s.a[0] + dx * start, s.a[1] + dz * start], b: [s.a[0] + dx * end, s.a[1] + dz * end] });
        start = null;
      }
    }
  }
  return out;
}
