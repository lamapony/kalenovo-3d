// Pure layout of the main-street plots from house passports (no three.js): house rects,
// plot extents between neighbours, fence runs (front garden палисадник, yard line with gates,
// side fences between plots), outbuildings, and the reserved areas where the generic
// procedural village must not build. World frame: x east, z south (geo.toLocal).
import { passportLocal, nearestOnLines } from '../passports.js';
import { rectsOverlap } from '../plan.js';
import { hashString, resolveHouse, annexFootprint } from './spec.js';
import { yardLayout, SOLID_YARD } from './yard.js';
import { randomGenerator } from '../../geo.js';

// Fence types that form a low front garden in front of the house.
export const PALISADE_TYPES = new Set(['picket', 'lattice', 'mesh', 'metal-rail', 'concrete']);
export const SOLID_TYPES = new Set(['plank', 'profiled', 'stripe']);
export const OUTBUILDING_SIZE = { shed: [3, 3.4], garage: [3.6, 6], barn: [6, 7], banya: [3.4, 3.8], greenhouse: [3, 6] };
export const GATE_WIDTH = { double: 3.2, swing: 2.8, sliding: 4 };
export const WICKET_WIDTH = 1;
const MAX_YARD = 14, BACK_DEPTH = 20, ROAD_CLEAR = 6.2;
// Weathered board colours for fences between and behind plots (grey timber, a few faded paints).
export const BOARD_PALETTE = ['#6c6153', '#5f574d', '#776a5a', '#655c50', '#585f63', '#5f6b58', '#6e6658', '#4f6670'];

// Chainage (distance along the polyline) of the nearest point on a set of polylines.
export function chainage(x, z, lines) {
  let best = { distance: Infinity };
  lines.forEach((line, li) => {
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (!len) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (len * len)));
      const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best.distance) best = { distance: d, line: li, s: acc + t * len, dir: [dx / len, dz / len] };
      acc += len;
    }
  });
  return best;
}

// Local house frame helpers: +x along the facade, +z toward the street.
export function frameOf(x, z, yawDeg) {
  const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return {
    x, z, yaw: yawDeg, angle: -a,
    world: (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c],
  };
}
function localRect(frame, x0, x1, z0, z1, extra = {}) {
  const [x, z] = frame.world((x0 + x1) / 2, (z0 + z1) / 2);
  return { x, z, w: Math.abs(x1 - x0), d: Math.abs(z1 - z0), angle: frame.angle, ...extra };
}

// Front garden depth and where the fence line sits, from the fence type and the setback.
export function fencePlan(p) {
  const f = p.fence;
  if (!f || f.type === 'none') return null;
  const setback = p.setbackM;
  const palisade = PALISADE_TYPES.has(f.type);
  if (typeof f.gardenM === 'number') {
    if (f.gardenM <= 0) return { kind: 'flush', garden: 0 };
    return { kind: palisade ? 'palisade' : 'front', garden: f.gardenM };
  }
  if (palisade) {
    const garden = setback >= 8.5 ? Math.min(8, Math.max(1.2, setback - 7.5)) : 0;
    return { kind: garden > 0 ? 'palisade' : 'flush', garden };
  }
  if (setback > 20) return { kind: 'front', garden: Math.min(4, Math.max(1, setback - 9.5)) };
  return { kind: 'flush', garden: 0 };
}

// Main-street layout. passports: validated passports; lines: local street polylines.
export function layoutMainStreet(passports, meta, lines) {
  const items = passports.map(p => {
    const [x, z] = passportLocal(p, meta);
    const c = chainage(x, z, lines);
    const frame = frameOf(x, z, p.facadeYawDeg);
    const ax = [Math.cos(p.facadeYawDeg * Math.PI / 180), -Math.sin(p.facadeYawDeg * Math.PI / 180)];
    const sign = Math.sign(ax[0] * c.dir[0] + ax[1] * c.dir[1]) || 1; // +x along increasing chainage?
    const half = p.house ? p.house.widthM / 2 : Math.max(1.5, (p.fence?.lengthM ?? 4) / 2);
    return { p, x, z, frame, c, sign, half, seed: hashString(p.id) };
  });
  // Plot extents: split the gap to the next passport on the same side and street line.
  for (const side of ['N', 'S']) {
    const row = items.filter(i => i.p.side === side).sort((a, b) => a.c.line - b.c.line || a.c.s - b.c.s);
    row.forEach(i => { i.lo = MAX_YARD * .6; i.hi = MAX_YARD * .6; });
    for (let k = 1; k < row.length; k++) {
      const a = row[k - 1], b = row[k];
      if (a.c.line !== b.c.line) continue;
      const gap = (b.c.s - a.c.s) - a.half - b.half;
      if (gap > 2 * MAX_YARD) continue;
      const m = Math.max(.3, gap / 2);
      a.hi = Math.min(MAX_YARD, m); b.lo = Math.min(MAX_YARD, m);
      a.next = b; b.prev = a;
    }
  }
  const plots = [], rects = [], reserved = [], colliders = [], outbuildings = [];
  for (const it of items) {
    const { p, frame } = it;
    // lo/hi are along the chainage; convert to house-local -x / +x.
    const extNeg = it.sign > 0 ? it.lo : it.hi, extPos = it.sign > 0 ? it.hi : it.lo;
    const s0 = -it.half - extNeg, s1 = it.half + extPos;
    const h = p.house, w = h?.widthM ?? 0, d = h?.depthM ?? 0;
    const plan = fencePlan(p);
    const garden = plan?.garden ?? 0;
    const zFacade = h ? d / 2 : 0;
    const zFront = zFacade + garden;
    const zBack = h ? -d / 2 - BACK_DEPTH : -BACK_DEPTH;
    const plot = { id: p.id, passport: p, frame, s0, s1, zFront, zBack, zFacade, garden, plan, fences: [], gates: [], outbuildings: [], seed: it.seed, house: null };
    if (h) {
      plot.house = localRect(frame, -w / 2, w / 2, -d / 2, d / 2, { kind: 'house', id: p.id });
      rects.push(plot.house);
    }
    // Yard side: the side with more room; gates and the drive go there.
    const gateSide = p.fence?.gateSide;
    const yardSide = gateSide === 'right' ? 1 : gateSide === 'left' ? -1 : h ? ((s1 - w / 2) >= (-w / 2 - s0) ? 1 : -1) : 1;
    plot.yardSide = yardSide;
    const fence = p.fence;
    const runs = [];
    const run = (x0, z0, x1, z1, type, color, color2, height, role) => {
      if (Math.hypot(x1 - x0, z1 - z0) < .4) return;
      runs.push({ x0, z0, x1, z1, type, color, color2, height, role, gates: [], pattern: type === fence?.type ? fence?.pattern : undefined });
    };
    if (fence && plan) {
      const solid = SOLID_TYPES.has(fence.type);
      const yardType = fence.yardType ?? (solid ? fence.type : 'plank');
      const yardColor = fence.yardType ? (fence.yardColor ?? fence.gate?.color ?? fence.color) : solid ? fence.color : (fence.gate?.color && fence.gate.color !== fence.color ? fence.gate.color : '#6d6255');
      const yardHeight = solid ? fence.heightM : Math.max(1.6, fence.heightM);
      const yardEdge = h ? yardSide * (w / 2) : 0;
      const yardEnd = yardSide > 0 ? s1 : s0;
      if (!h) {
        run(-it.half, 0, it.half, 0, fence.type, fence.color, fence.color2, fence.heightM, 'yard');
      } else if (plan.kind === 'palisade') {
        // Front garden across the house front; it runs on to the far plot edge only when the
        // observed fence is longer than the house front plus its returns.
        const longer = fence.lengthM > w + 2 * garden + 1;
        const far = longer ? (yardSide > 0 ? s0 : s1) : -yardSide * (w / 2 + .4);
        const lo = yardSide > 0 ? far : yardEdge - .4, hi = yardSide > 0 ? yardEdge + .4 : far;
        run(lo, zFront, hi, zFront, fence.type, fence.color, fence.color2, fence.heightM, 'front');
        const returnX = yardSide > 0 ? hi : lo;
        run(returnX, zFront, returnX, zFacade + .05, fence.type, fence.color, fence.color2, fence.heightM, 'return');
        if (!longer) {
          run(far, zFront, far, zFacade + .05, fence.type, fence.color, fence.color2, fence.heightM, 'return');
          run(-yardSide * w / 2, zFacade + .05, yardSide > 0 ? s0 : s1, zFacade + .05, yardType, yardColor, fence.color2, yardHeight, 'front');
        }
        // Yard line on the facade line, from the house corner to the plot edge, with the gate.
        const yEnd = fence.yardLengthM ? yardEdge + yardSide * fence.yardLengthM : yardEnd;
        run(yardEdge, zFacade + .05, yEnd, zFacade + .05, yardType, yardColor, fence.color2, yardHeight, 'yard');
      } else if (plan.kind === 'front') {
        // House set far back: one fence across the plot; gates start next to the house.
        const x0 = yardSide > 0 ? s0 : s1, x1 = yardSide > 0 ? s1 : s0;
        run(x0, zFront, x1, zFront, fence.type, fence.color, fence.color2, fence.heightM, 'yard');
        const r = runs[runs.length - 1];
        if (r) r.gateStart = Math.max(.35, Math.abs(yardEdge - x0) + .5);
      } else {
        // Flush with the facade on both sides of the house; the yard side carries the gate.
        run(-w / 2, zFacade + .05, s0, zFacade + .05, fence.type, fence.color, fence.color2, fence.heightM, yardSide < 0 ? 'yard' : 'front');
        run(w / 2, zFacade + .05, s1, zFacade + .05, fence.type, fence.color, fence.color2, fence.heightM, yardSide > 0 ? 'yard' : 'front');
      }
      // Gate (and wicket) on the yard run, next to the house.
      const yard = runs.find(r => r.role === 'yard') ?? runs[0];
      if (fence.gate && yard) {
        const gw = GATE_WIDTH[fence.gate.type] ?? 3;
        const L = Math.hypot(yard.x1 - yard.x0, yard.z1 - yard.z0);
        const wants = [];
        if (fence.gate.wicket) wants.push({ type: 'wicket', width: WICKET_WIDTH, color: fence.gate.color, roofed: false });
        wants.push({ type: fence.gate.type, width: gw, color: fence.gate.color, roofed: fence.gate.roofed });
        let t = yard.gateStart ?? .35;
        for (const g of wants) {
          if (t + g.width + .2 > L) { g.width = Math.max(0, L - t - .25); if (g.width < .9) break; }
          const u = (t + g.width / 2) / L;
          yard.gates.push({ ...g, t: t + g.width / 2, lx: yard.x0 + (yard.x1 - yard.x0) * u, lz: yard.z0 + (yard.z1 - yard.z0) * u });
          t += g.width + .35;
        }
      }
    }
    // Outbuildings from the passport offsets [along, back], pushed clear of the house.
    for (const [k, o] of (p.outbuildings || []).entries()) {
      const [ow, od] = OUTBUILDING_SIZE[o.kind] ?? [3, 3.4];
      let ox = o.approxOffsetM[0], oz = -o.approxOffsetM[1];
      const make = () => localRect(frame, ox - ow / 2, ox + ow / 2, oz - od / 2, oz + od / 2, { kind: o.kind, id: `${p.id}-ob${k}`, roof: o.roof, color: o.color, seed: it.seed + k * 17 });
      let r = make();
      for (let tries = 0; tries < 12 && [...rects, ...outbuildings].some(q => rectsOverlap(q, r, .05)); tries++) {
        if (Math.abs(ox) >= Math.abs(oz)) ox += Math.sign(ox || 1) * .6; else oz -= .6;
        r = make();
      }
      r.local = { x: ox, z: oz, w: ow, d: od, kind: o.kind };
      outbuildings.push(r); plot.outbuildings.push(r);
    }
    // Lived-in yard: seeded generic content behind and beside the house (see yard.js).
    plot.yard = [];
    if (h) {
      const spec = resolveHouse(p), af = annexFootprint(spec, yardSide);
      const blockers = [{ kind: 'house', x: 0, z: 0, w: w + 2, d: d + 2 }];
      if (af) blockers.push({ kind: 'annex', x: (af.x0 + af.x1) / 2, z: (af.z0 + af.z1) / 2, w: af.w + 1, d: af.d + 1 });
      for (const o of plot.outbuildings) blockers.push({ ...o.local, w: o.local.w + 1, d: o.local.d + 1 });
      for (const r of runs) for (const g of r.gates) if (g.lx !== undefined && g.type !== 'wicket') blockers.push({ kind: 'drive', x: g.lx, z: zFacade - 3.5, w: g.width + 1.2, d: 7 });
      const items = yardLayout({ s0, s1, zBack, zFacade, garden, yardSide, seed: it.seed }, blockers, { kinds: (p.outbuildings || []).map(o => o.kind) });
      for (const item of items) {
        const { x: ix, z: iz, w: iw, d: id, ...props } = item;
        const r = localRect(frame, ix - iw / 2, ix + iw / 2, iz - id / 2, iz + id / 2, { ...props, id: `${p.id}-${item.kind}-${plot.yard.length}`, local: item });
        plot.yard.push(r);
        if (SOLID_YARD.has(item.kind)) rects.push(r);
      }
    }
    // Fences between plots (one per boundary), at the ends of a row and along the back:
    // weathered boards, a few faded paints, vertical or horizontal, seeded per plot.
    if (h || fence) {
      const fr = randomGenerator(it.seed ^ 0x3c6ef372);
      const board = () => ({ color: BOARD_PALETTE[Math.floor(fr() * BOARD_PALETTE.length)], height: 1.5 + fr() * .5, pattern: fr() < .2 ? 'horizontal' : 'vertical' });
      const zStart = h ? zFacade - .3 : 0;
      const prevOnNeg = it.sign > 0 ? it.prev : it.next;
      const sideRun = (x, b) => { run(x, zStart, x, zBack, 'plank', b.color, null, b.height, 'side'); const r2 = runs[runs.length - 1]; if (r2) r2.pattern = b.pattern; };
      sideRun(s1, board());
      if (!prevOnNeg) sideRun(s0, board());
      if (h) { const b = board(); run(s0, zBack, s1, zBack, 'plank', b.color, null, Math.min(1.6, b.height), 'back'); const r2 = runs[runs.length - 1]; if (r2) r2.pattern = fr() < .5 ? 'horizontal' : 'vertical'; }
    }
    // World segments.
    for (const r of runs) {
      const a = frame.world(r.x0, r.z0), b = frame.world(r.x1, r.z1), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const f = { a, b, t0: 0, t1: len, pattern: r.pattern, type: r.type, color: r.color, color2: r.color2, height: r.height, role: r.role, gates: r.gates, owner: p.id };
      plot.fences.push(f);
      let spans = [[0, len]];
      for (const g of r.gates) {
        const g0 = g.t - g.width / 2, g1 = g.t + g.width / 2;
        spans = spans.flatMap(([u, v]) => (g1 <= u || g0 >= v) ? [[u, v]] : [[u, g0], [g1, v]].filter(([q, w2]) => w2 - q > .05));
      }
      for (const [u, v] of spans) colliders.push({ a: [a[0] + (b[0] - a[0]) * u / len, a[1] + (b[1] - a[1]) * u / len], b: [a[0] + (b[0] - a[0]) * v / len, a[1] + (b[1] - a[1]) * v / len] });
    }
    // Reserved: the whole plot from the street-side fence line to the back of the yard.
    plot.rect = localRect(frame, s0, s1, zBack, Math.max(zFront, zFacade) + .8);
    // Generic content also keeps out of the strip between the plot and the road.
    reserved.push(localRect(frame, s0, s1, Math.max(zFront, zFacade), Math.max(zFront, zFacade) + 5));
    reserved.push(plot.rect);
    plots.push(plot);
    const zLine = Math.max(zFront, zFacade) + .05;
    it.plot = plot;
    it.endPos = frame.world(it.sign > 0 ? s1 : s0, zLine); // end toward increasing chainage
    it.endNeg = frame.world(it.sign > 0 ? s0 : s1, zLine);
  }
  // Gaps between passport plots on the same side: the street fence line continues with
  // weathered boards (a village street is fenced end to end), and generic content keeps off it.
  const fillers = [];
  for (const side of ['N', 'S']) {
    const row = items.filter(i => i.p.side === side && i.plot).sort((a, b) => a.c.line - b.c.line || a.c.s - b.c.s);
    for (let k = 1; k < row.length; k++) {
      const a = row[k - 1], b = row[k];
      if (a.c.line !== b.c.line) continue;
      const p0 = a.endPos, p1 = b.endNeg, len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (len < .6 || len > 60) continue;
      const f = { a: p0, b: p1, t0: 0, t1: len, type: 'plank', color: '#6c6153', height: 1.7, role: 'filler', gates: [], owner: `${a.p.id}+` };
      const plot = { id: `${a.p.id}-gap`, filler: true, fences: [f], outbuildings: [], seed: a.seed ^ 0x9e37, frame: a.frame, rect: { x: (p0[0] + p1[0]) / 2, z: (p0[1] + p1[1]) / 2, w: len, d: .8, angle: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) } };
      fillers.push(plot);
      reserved.push({ ...plot.rect, w: len, d: .6 });
      colliders.push({ a: p0, b: p1 });
    }
  }
  plots.push(...fillers);
  rects.push(...outbuildings);
  return { plots, rects, reserved, colliders, outbuildings };
}

// Front fence line must keep clear of the road: distance from the street centreline.
export function fenceClearOfRoad(plot, lines) {
  return plot.fences.filter(f => f.role !== 'side').every(f => [f.a, f.b].every(([x, z]) => nearestOnLines(x, z, lines).distance >= ROAD_CLEAR - 1.5));
}
