// Pure village layout (no three.js): footprints -> plots -> houses, outbuildings, fences.
// Everything is in local metres (x east, z south) as produced by geo.toLocal.
import { toLocal, polygons, clipSegment, segmentDistanceSq, randomGenerator } from '../geo.js';

// ---------------------------------------------------------------- roads ----

const ROAD_WIDTHS = {
  primary: 9, secondary: 8, tertiary: 7, unclassified: 5, residential: 5, living_street: 4.5,
  service: 3.6, track: 3.4, pedestrian: 2.4, footway: 1.6, path: 1.4, cycleway: 1.6, bridleway: 1.6, steps: 1.4,
};
export const FOOT_HIGHWAYS = new Set(['footway', 'path', 'cycleway', 'bridleway', 'steps', 'pedestrian']);

export function wayWidth(props) {
  if (props.layer === 'waterway') return props.waterway === 'river' ? 17 : 3.2;
  return ROAD_WIDTHS[props.highway] ?? 4.5;
}

// OSM road/waterway ways as clipped local polylines. Clipping can split a way.
export function wayLines(features, meta) {
  const lines = [];
  for (const feature of features) {
    const props = feature.properties || {};
    if (props.layer !== 'road' && props.layer !== 'waterway') continue;
    const g = feature.geometry;
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    const width = wayWidth(props), kind = props.layer === 'road' ? 'road' : 'water';
    const limit = meta.halfSizeM - width;
    for (const part of parts) {
      let current = null;
      for (let i = 1; i < part.length; i++) {
        const clipped = clipSegment(toLocal(...part[i - 1], meta), toLocal(...part[i], meta), limit);
        if (!clipped) { current = null; continue; }
        const [a, b] = clipped;
        const last = current && current.points[current.points.length - 1];
        if (!last || Math.hypot(last[0] - a[0], last[1] - a[1]) > .01) {
          current = { points: [a], width, kind, highway: props.highway, waterway: props.waterway, name: props.name, foot: FOOT_HIGHWAYS.has(props.highway) };
          lines.push(current);
        }
        current.points.push(b);
      }
    }
  }
  return lines.filter(l => l.points.length > 1);
}

export function lineSegments(lines) {
  const segments = [];
  for (const line of lines) for (let i = 1; i < line.points.length; i++) {
    segments.push({ a: line.points[i - 1], b: line.points[i], width: line.width, kind: line.kind, foot: line.foot });
  }
  return segments;
}

// Uniform grid over segments for nearest/clearance queries.
export class SegmentGrid {
  constructor(segments, cell = 40) {
    this.cell = cell; this.cells = new Map(); this.segments = segments;
    segments.forEach((s, i) => {
      const pad = s.width / 2 + 8;
      for (let x = Math.floor((Math.min(s.a[0], s.b[0]) - pad) / cell); x <= Math.floor((Math.max(s.a[0], s.b[0]) + pad) / cell); x++)
        for (let z = Math.floor((Math.min(s.a[1], s.b[1]) - pad) / cell); z <= Math.floor((Math.max(s.a[1], s.b[1]) + pad) / cell); z++) {
          const key = x * 73856 + z; let list = this.cells.get(key); if (!list) this.cells.set(key, list = []); list.push(i);
        }
    });
  }
  near(x, z, radius) {
    const out = new Set(), c = this.cell;
    for (let gx = Math.floor((x - radius) / c); gx <= Math.floor((x + radius) / c); gx++)
      for (let gz = Math.floor((z - radius) / c); gz <= Math.floor((z + radius) / c); gz++)
        for (const i of this.cells.get(gx * 73856 + gz) || []) out.add(i);
    return [...out].map(i => this.segments[i]);
  }
  nearest(x, z, maxDist, filter = () => true) {
    let best = null, bestD = maxDist * maxDist;
    for (const s of this.near(x, z, maxDist)) {
      if (!filter(s)) continue;
      const d = segmentDistanceSq(x, z, s.a, s.b);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return null;
    const dx = best.b[0] - best.a[0], dz = best.b[1] - best.a[1], len = Math.hypot(dx, dz) || 1;
    const t = Math.max(0, Math.min(1, ((x - best.a[0]) * dx + (z - best.a[1]) * dz) / (len * len)));
    return { segment: best, dist: Math.sqrt(bestD), point: [best.a[0] + dx * t, best.a[1] + dz * t], dir: [dx / len, dz / len] };
  }
  // True when (x,z) is closer than half width + margin to any segment of the given kind(s).
  blocked(x, z, margin, waterMargin = margin) {
    for (const s of this.near(x, z, 12)) {
      const m = s.kind === 'water' ? waterMargin : margin;
      if (segmentDistanceSq(x, z, s.a, s.b) < (s.width / 2 + m) ** 2) return true;
    }
    return false;
  }
}

// ------------------------------------------------------------ rectangles ----

// Minimum-area enclosing rectangle among all footprint edge orientations (w >= d).
export function fitRectangle(ring) {
  let best;
  for (let i = 1; i < ring.length; i++) {
    const a = Math.atan2(ring[i][1] - ring[i - 1][1], ring[i][0] - ring[i - 1][0]);
    if (!Number.isFinite(a) || (ring[i][0] === ring[i - 1][0] && ring[i][1] === ring[i - 1][1])) continue;
    const c = Math.cos(a), s = Math.sin(a);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * c + z * s, v = -x * s + z * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const w = maxU - minU, d = maxV - minV;
    if (!best || w * d < best.area) {
      const u = (maxU + minU) / 2, v = (maxV + minV) / 2;
      best = { x: u * c - v * s, z: u * s + v * c, w, d, angle: a, area: w * d };
    }
  }
  if (best && best.w < best.d) { [best.w, best.d] = [best.d, best.w]; best.angle += Math.PI / 2; }
  return best;
}

// rect: {x, z, w, d, angle}; w spans local x = (cos a, sin a), d spans local z = (-sin a, cos a).
export function inRect(x, z, rect, margin = 0) {
  const c = Math.cos(rect.angle), s = Math.sin(rect.angle), dx = x - rect.x, dz = z - rect.z;
  return Math.abs(dx * c + dz * s) < rect.w / 2 + margin && Math.abs(-dx * s + dz * c) < rect.d / 2 + margin;
}

export function rectCorners(r, margin = 0) {
  const c = Math.cos(r.angle), s = Math.sin(r.angle), hw = r.w / 2 + margin, hd = r.d / 2 + margin;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [r.x + u * hw * c - v * hd * s, r.z + u * hw * s + v * hd * c]);
}

export function rectsOverlap(a, b, margin = 0) {
  if (Math.hypot(a.x - b.x, a.z - b.z) > Math.hypot(a.w, a.d) / 2 + Math.hypot(b.w, b.d) / 2 + 2 * margin) return false;
  const ac = rectCorners(a, margin), bc = rectCorners(b, margin);
  for (const r of [a, b]) for (const angle of [r.angle, r.angle + Math.PI / 2]) {
    const cx = Math.cos(angle), cz = Math.sin(angle), project = p => p[0] * cx + p[1] * cz;
    const ap = ac.map(project), bp = bc.map(project);
    if (Math.max(...ap) <= Math.min(...bp) || Math.max(...bp) <= Math.min(...ap)) return false;
  }
  return true;
}

class RectGrid {
  constructor(cell = 24) { this.cell = cell; this.cells = new Map(); this.items = []; }
  add(rect) {
    const i = this.items.push(rect) - 1, r = Math.hypot(rect.w, rect.d) / 2 + 2, c = this.cell;
    for (let x = Math.floor((rect.x - r) / c); x <= Math.floor((rect.x + r) / c); x++)
      for (let z = Math.floor((rect.z - r) / c); z <= Math.floor((rect.z + r) / c); z++) {
        const key = x * 73856 + z; let list = this.cells.get(key); if (!list) this.cells.set(key, list = []); list.push(i);
      }
  }
  near(x, z, radius) {
    const out = new Set(), c = this.cell;
    for (let gx = Math.floor((x - radius) / c); gx <= Math.floor((x + radius) / c); gx++)
      for (let gz = Math.floor((z - radius) / c); gz <= Math.floor((z + radius) / c); gz++)
        for (const i of this.cells.get(gx * 73856 + gz) || []) out.add(i);
    return [...out].map(i => this.items[i]);
  }
  overlaps(rect, margin = 0, ignore = null) {
    return this.near(rect.x, rect.z, Math.hypot(rect.w, rect.d) / 2 + margin + 2).some(r => r !== ignore && r.owner !== ignore && rectsOverlap(r, rect, margin));
  }
  contains(x, z, margin = 0) { return this.near(x, z, 1).some(r => inRect(x, z, r, margin)); }
}

// ------------------------------------------------------------ footprints ----

export function collectFootprints(osmFeatures, gbaFeatures, meta) {
  const out = [];
  const add = (feature, source) => {
    for (const poly of polygons(feature.geometry)) out.push({ ring: poly[0].map(p => toLocal(...p, meta)), source, props: feature.properties || {} });
  };
  osmFeatures.filter(f => f.properties?.layer === 'building').forEach(f => add(f, 'osm'));
  gbaFeatures.forEach(f => add(f, 'gba'));
  return out;
}

function hashSeed(...values) {
  let h = 2166136261;
  for (const v of values) { h ^= Math.round(v * 100) & 0xffffffff; h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Splits a footprint rectangle into plots along the street direction.
// Returns the frame (front vector f toward the street) and per-plot house slots.
export function splitFootprint(rect, street, random) {
  const axisU = [Math.cos(rect.angle), Math.sin(rect.angle)], axisV = [-Math.sin(rect.angle), Math.cos(rect.angle)];
  let f;
  if (street) {
    const t = street.dir, toStreet = [street.point[0] - rect.x, street.point[1] - rect.z];
    const parallelU = Math.abs(t[0] * axisU[0] + t[1] * axisU[1]) >= Math.abs(t[0] * axisV[0] + t[1] * axisV[1]);
    f = parallelU ? axisV : axisU;
    if (f[0] * toStreet[0] + f[1] * toStreet[1] < 0) f = [-f[0], -f[1]];
  } else {
    // No mapped street: long side along the (unmapped) street, facade to the sunny south.
    f = axisV;
    if (f[1] < -.05 || (Math.abs(f[1]) <= .05 && f[0] < 0)) f = [-f[0], -f[1]];
  }
  const s = [f[1], -f[0]];
  const alongU = Math.abs(s[0] * axisU[0] + s[1] * axisU[1]) > .5;
  const Ls = alongU ? rect.w : rect.d, Lf = alongU ? rect.d : rect.w;
  let n = 1;
  if (Ls > 16) n = Math.max(2, Math.round(Ls / (12.5 + random() * 4.5)));
  const angle = Math.atan2(-f[0], f[1]);
  const slots = [];
  for (let i = 0; i < n; i++) {
    const s0 = -Ls / 2 + i * Ls / n, s1 = s0 + Ls / n, ws = s1 - s0;
    slots.push({ index: i, s0, s1, ws });
  }
  return { f, s, angle, Ls, Lf, n, slots };
}

// Plausible house size for a slot of width ws and footprint depth Lf.
export function houseSize(ws, Lf, n, random) {
  let w, d;
  if (n === 1 && ws <= 12.5 && Lf <= 12.5) {
    // A footprint of ordinary house size: keep its proportions.
    w = clamp(ws, 5.6, 11); d = clamp(Lf, 5.6, 11);
  } else {
    w = clamp(Math.min(ws - 1.2, 6.5 + random() * 3), 5.2, 10);
    d = clamp(Lf >= 7 ? 7.5 + random() * 3 : Lf + 1.5, 6, 11);
    if (Lf > 6) d = Math.min(d, Math.max(6, Lf));
  }
  // Rural houses are rarely deeper than 1.6x their width.
  if (d > w * 1.6) d = w * 1.6;
  if (w > d * 1.7) w = d * 1.7;
  return { w, d };
}

function local(frame, sc, fc) {
  return [frame.cx + frame.s[0] * sc + frame.f[0] * fc, frame.cz + frame.s[1] * sc + frame.f[1] * fc];
}

function frameRect(frame, sc, fc, w, d, extra = {}) {
  const [x, z] = local(frame, sc, fc);
  return { x, z, w, d, angle: frame.angle, ...extra };
}

// ------------------------------------------------------------- planning ----

export function planVillage({ footprints, lines, halfSize, seed = 83 }) {
  const roadSegs = lineSegments(lines);
  const roadGrid = new SegmentGrid(roadSegs);
  const grid = new RectGrid();
  const fits = [];
  // 1. Fit and deduplicate (OSM first: it has precedence over overlapping GBA detections).
  for (const fp of footprints) {
    const rect = fitRectangle(fp.ring);
    if (!rect || rect.w < 1.8 || rect.d < 1.8) continue;
    if (Math.abs(rect.x) + rect.w > halfSize || Math.abs(rect.z) + rect.w > halfSize) continue;
    if (fits.some(o => rectsOverlap(o.rect, rect))) continue;
    fits.push({ rect, fp });
  }
  const footGrid = new RectGrid();
  fits.forEach(({ rect }) => footGrid.add(rect));

  const plots = [], standalone = [], rects = [];
  const addRect = (r, owner) => { r.owner = owner; grid.add(r); rects.push(r); return r; };

  // 2. Houses and in-footprint outbuildings.
  fits.forEach(({ rect, fp }, index) => {
    const random = randomGenerator(hashSeed(seed, index, rect.x, rect.z));
    const area = rect.w * rect.d;
    if (area < 30 || (rect.d < 4 && rect.w < 9)) {
      const street = roadGrid.nearest(rect.x, rect.z, 40, s => s.kind === 'road');
      const frame = splitFootprint(rect, street, random);
      const kind = area < 14 ? 'shed' : random() < .5 ? 'banya' : 'shed';
      const alongS = Math.abs(frame.s[0] * Math.cos(rect.angle) + frame.s[1] * Math.sin(rect.angle)) > .5;
      const w = clamp(alongS ? rect.w : rect.d, 2.4, 6), d = clamp(alongS ? rect.d : rect.w, 2.2, 5);
      const ob = { x: rect.x, z: rect.z, w, d, angle: frame.angle, kind, seed: hashSeed(seed, index, 7) };
      if (grid.overlaps(ob, .2)) return;
      standalone.push(ob); addRect({ ...ob }, ob);
      return;
    }
    const street = roadGrid.nearest(rect.x, rect.z, 70, s => s.kind === 'road' && !s.foot);
    const frame = splitFootprint(rect, street, random);
    Object.assign(frame, { cx: rect.x, cz: rect.z });
    const { Lf, n } = frame;
    frame.slots.forEach(slot => {
      const { w, d } = houseSize(slot.ws, Lf, n, random);
      const slack = Math.max(0, slot.ws - w);
      const sc = (slot.s0 + slot.s1) / 2 + (random() - .5) * slack * .5;
      const fc = Lf / 2 - d / 2;
      const ridge = random() < .68 ? 'z' : 'x';
      // Side with more room between house and slot edge becomes the yard (porch + gate side).
      const leftRoom = sc - w / 2 - slot.s0, rightRoom = slot.s1 - (sc + w / 2);
      const yardSide = Math.abs(leftRoom - rightRoom) < .3 ? (random() < .5 ? -1 : 1) : (rightRoom > leftRoom ? 1 : -1);
      const house = frameRect(frame, sc, fc, w, d, { kind: 'house', ridge, yardSide, seed: hashSeed(seed, index, slot.index, 1) });
      if (grid.overlaps(house, .3)) {
        // Shrink to the footprint before giving up (min sizes can push into a neighbour).
        house.w = Math.max(4.5, Math.min(house.w, slot.ws - .4)); house.d = Math.max(4.5, Math.min(house.d, Lf));
        if (grid.overlaps(house, .2)) return;
      }
      const plot = { id: plots.length, frame, slot, angle: frame.angle, house, outbuildings: [], fences: [], seed: hashSeed(seed, index, slot.index, 2) };
      addRect(house, plot);
      // Annex (сени / веранда) behind the house on the yard side.
      if (random() < .72) {
        const aw = clamp(w * (.5 + random() * .4), 2.6, w), ad = 2.2 + random() * 1.1;
        const ax = yardSide * (w - aw) / 2, az = -d / 2 - ad / 2;
        const annex = frameRect(frame, sc + ax, fc + az, aw, ad, { kind: 'annex' });
        if (!grid.overlaps(annex, .15)) { house.annex = { x: ax, z: az, w: aw, d: ad }; addRect(annex, plot); }
      }
      // Porch on the yard side: on the annex side wall if there is one, else on the house side wall.
      if (house.annex) house.porch = { x: house.annex.x + yardSide * (house.annex.w / 2), z: house.annex.z, side: yardSide };
      else house.porch = { x: yardSide * w / 2, z: -d / 2 + Math.min(1.4, d * .25), side: yardSide };
      // Outbuildings filling the rest of the footprint depth (homestead rows go back from the street).
      let back = -Lf / 2, room = Lf - d - (house.annex ? house.annex.d : 0) - 1.2;
      while (room >= 3) {
        const bd = Math.min(room, 4 + random() * 6), bw = clamp(slot.ws - 1 - random() * 2, 3, 9);
        const bs = sc + (random() - .5) * Math.max(0, slot.ws - bw) * .6;
        const kind = bd * bw > 34 ? 'barn' : 'shed';
        const ob = frameRect(frame, bs, back + bd / 2, bw, bd, { kind, seed: hashSeed(seed, index, slot.index, back) });
        if (!grid.overlaps(ob, .2)) { plot.outbuildings.push(ob); addRect(ob, plot); }
        const gap = .8 + random() * 1.5;
        back += bd + gap; room -= bd + gap;
      }
      plots.push(plot);
    });
  });

  // 3. Plot bounds (front yard toward the street, garden behind).
  for (const plot of plots) {
    const { frame, slot, house } = plot, random = randomGenerator(plot.seed);
    const first = slot.index === 0, last = slot.index === frame.n - 1;
    let s0 = slot.s0 - (first ? 1.5 + random() * 2.5 : 0), s1 = slot.s1 + (last ? 1.5 + random() * 2.5 : 0);
    const minWidth = house.w + 4.5;
    if (s1 - s0 < minWidth) { const grow = (minWidth - (s1 - s0)) / 2; if (first) s0 -= grow; if (last) s1 += grow; }
    // Front fence: on the street line when a mapped road is near (village plots meet the street),
    // otherwise a small front garden in front of the house.
    let setback = 2.5 + random() * 3.5;
    const [mx, mz] = local(frame, (s0 + s1) / 2, frame.Lf / 2);
    for (let d = .4; d <= 14; d += .4) {
      const px = mx + frame.f[0] * d, pz = mz + frame.f[1] * d;
      if (roadGrid.blocked(px, pz, 1.4, 2.5)) { setback = Math.max(.6, d - .5); break; }
    }
    const garden = 9 + random() * 14;
    plot.bounds = { s0, s1, f0: -frame.Lf / 2 - garden, f1: frame.Lf / 2 + setback };
    const b = plot.bounds;
    plot.rect = frameRect(frame, (b.s0 + b.s1) / 2, (b.f0 + b.f1) / 2, b.s1 - b.s0, b.f1 - b.f0);
  }

  // 4. Extra yard buildings: banya and shed in the garden, only where nothing else stands.
  for (const plot of plots) {
    const { frame, bounds: b, house } = plot, random = randomGenerator(plot.seed ^ 0x5bd1e995);
    const wishes = [];
    if (random() < .62) wishes.push({ kind: 'banya', w: 3.2 + random() * 1.2, d: 3.6 + random() * 1.2 });
    if (random() < .45) wishes.push({ kind: 'shed', w: 2.6 + random() * 2.4, d: 2.4 + random() * 1.6 });
    const sc = (frame.s[0] * (house.x - frame.cx) + frame.s[1] * (house.z - frame.cz));
    for (const wish of wishes) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const side = (attempt + (wish.kind === 'banya' ? 0 : 1)) % 2 ? 1 : -1;
        const bs = clamp(sc + side * (b.s1 - b.s0) * (.18 + random() * .2), b.s0 + wish.w / 2 + 1, b.s1 - wish.w / 2 - 1);
        const occupiedBack = Math.min(-frame.Lf / 2, ...plot.outbuildings.map(o => frame.f[0] * (o.x - frame.cx) + frame.f[1] * (o.z - frame.cz) - o.d / 2));
        const bf = occupiedBack - 2.5 - wish.d / 2 - random() * 5;
        if (bf - wish.d / 2 < b.f0 + .8) continue;
        const ob = frameRect(frame, bs, bf, wish.w, wish.d, { kind: wish.kind, seed: hashSeed(plot.seed, attempt, wish.w) });
        if (grid.overlaps(ob, 1.2) || footGrid.overlaps(ob, 1) || roadGrid.blocked(ob.x, ob.z, Math.hypot(ob.w, ob.d) / 2 + 1, Math.hypot(ob.w, ob.d) / 2 + 3)) continue;
        if (Math.abs(ob.x) > halfSize - 20 || Math.abs(ob.z) > halfSize - 20) continue;
        plot.outbuildings.push(ob); addRect(ob, plot); break;
      }
    }
  }

  // 5. Fences: front with gates, sides, optional back. Clipped against roads, buildings and earlier fences.
  const fenceGrid = new Map(), fenceCell = 2;
  const fenceKey = (x, z) => Math.floor(x / fenceCell) * 73856 + Math.floor(z / fenceCell);
  const nearFence = (x, z, owner, radius) => {
    const gx = Math.floor(x / fenceCell), gz = Math.floor(z / fenceCell);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++)
      for (const p of fenceGrid.get(i * 73856 + j) || []) if (p.owner !== owner && (p.x - x) ** 2 + (p.z - z) ** 2 < radius * radius) return true;
    return false;
  };
  const step = .4;
  function clipLine(a, b, owner, inside = null) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), count = Math.max(1, Math.round(len / step));
    const ok = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const free = Math.abs(x) < halfSize - 12 && Math.abs(z) < halfSize - 12 &&
        !roadGrid.blocked(x, z, 1.1, 2.2) && !grid.contains(x, z, .45) && !nearFence(x, z, owner, .9) &&
        !(inside && inside(x, z));
      ok.push(free);
    }
    const runs = [];
    let start = -1;
    for (let i = 0; i <= count + 1; i++) {
      if (i <= count && ok[i]) { if (start < 0) start = i; continue; }
      if (start >= 0) {
        const t0 = start / count, t1 = (i - 1) / count;
        if ((t1 - t0) * len >= 1.2) runs.push({ t0: t0 * len, t1: t1 * len });
        start = -1;
      }
    }
    return { len, runs };
  }
  function commit(a, b, len, run, owner) {
    for (let d = run.t0; d <= run.t1 + 1e-6; d += step) {
      const t = d / len, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, key = fenceKey(x, z);
      let list = fenceGrid.get(key); if (!list) fenceGrid.set(key, list = []); list.push({ x, z, owner });
    }
  }
  for (const plot of plots) {
    const { frame, bounds: b, house } = plot, random = randomGenerator(plot.seed ^ 0x27d4eb2d);
    const frontStyle = random() < .78 ? 'picket' : 'solid';
    const sideStyle = random() < .5 ? frontStyle : random() < .55 ? 'solid' : 'rail';
    const height = frontStyle === 'picket' ? 1.25 + random() * .3 : 1.6 + random() * .35;
    const paint = random();
    const P = (sc, fc) => local(frame, sc, fc);
    const sides = [];
    sides.push({ side: 'front', a: P(b.s0, b.f1), b: P(b.s1, b.f1), style: frontStyle, height });
    if (plot.slot.index === 0) sides.push({ side: 'left', a: P(b.s0, b.f1), b: P(b.s0, b.f0), style: sideStyle, height: sideStyle === 'rail' ? 1.2 : height });
    sides.push({ side: 'right', a: P(b.s1, b.f1), b: P(b.s1, b.f0), style: sideStyle, height: sideStyle === 'rail' ? 1.2 : height });
    if (random() < .55) sides.push({ side: 'back', a: P(b.s0, b.f0), b: P(b.s1, b.f0), style: random() < .6 ? 'rail' : sideStyle, height: 1.2 });
    const houseSc = frame.s[0] * (house.x - frame.cx) + frame.s[1] * (house.z - frame.cz);
    for (const side of sides) {
      const { len, runs } = clipLine(side.a, side.b, plot);
      for (const run of runs) {
        const fence = { a: side.a, b: side.b, t0: run.t0, t1: run.t1, style: side.style, height: side.height, side: side.side, paint, gates: [], owner: plot.id };
        plot.fences.push(fence); commit(side.a, side.b, len, run, plot);
      }
    }
    // Gates on the front fence: a wicket by the yard side of the house, a wide gate beyond it if room allows.
    const fronts = plot.fences.filter(f => f.side === 'front');
    if (fronts.length) {
      const yardEdge = houseSc + house.yardSide * (house.w / 2);
      const wish = [];
      wish.push({ type: 'wicket', width: 1, at: yardEdge + house.yardSide * 1.1 });
      if (random() < .7) wish.push({ type: 'gate', width: 3.2, at: yardEdge + house.yardSide * 3.6 });
      for (const g of wish) {
        // distance along the front fence from b.s0
        let placed = false;
        for (const shift of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
          const center = g.at - b.s0 + shift * house.yardSide * .9;
          for (const fence of fronts) {
            if (center - g.width / 2 - .3 < fence.t0 || center + g.width / 2 + .3 > fence.t1) continue;
            if (fence.gates.some(o => Math.abs(o.t - center) < (o.width + g.width) / 2 + .6)) continue;
            fence.gates.push({ type: g.type, width: g.width, t: center }); placed = true; break;
          }
          if (placed) break;
        }
        if (!placed && g.type === 'wicket') {
          // Fall back to the middle of the longest front run.
          const fence = fronts.reduce((a, c) => (c.t1 - c.t0 > a.t1 - a.t0 ? c : a));
          if (fence.t1 - fence.t0 > 2.2) fence.gates.push({ type: 'wicket', width: 1, t: (fence.t0 + fence.t1) / 2 });
        }
      }
    }
  }

  return { plots, standalone, rects, roadGrid, footprintCount: fits.length };
}

// Points along a fence run, for vegetation and tests.
export function fencePoint(fence, d) {
  const len = Math.hypot(fence.b[0] - fence.a[0], fence.b[1] - fence.a[1]) || 1, t = d / len;
  return [fence.a[0] + (fence.b[0] - fence.a[0]) * t, fence.a[1] + (fence.b[1] - fence.a[1]) * t];
}
