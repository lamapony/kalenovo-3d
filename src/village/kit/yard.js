// Pure, seeded yard content for the main-street plots (no three.js): what a lived-in Siberian
// village plot holds behind and beside the house. Generic and illustrative (not observed):
// vegetable beds, a banya, a shed, a woodpile (поленница), a greenhouse, an outhouse and a few
// garden trees and shrubs. Everything is in the plot's house frame (x along the street,
// +z toward the street) as axis-aligned rects {x, z, w, d}; nothing overlaps the house, its
// annex, the passport outbuildings, the front garden or another item, and all stays inside
// the plot.
import { randomGenerator } from '../../geo.js';

export const YARD_SIZES = {
  banya: [3.4, 3.8], shed: [2.8, 2.4], woodpile: [3.6, 1.0], outhouse: [1.2, 1.3],
  greenhouse: [3, 6], appleTree: [2.6, 2.6], shrub: [1.8, 1.8], birch: [1.2, 1.2],
};
const MARGIN = .7; // clear space kept around buildings and between items

export const rectOverlap = (a, b, m = 0) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + m && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + m;
export const rectInside = (r, box, m = 0) =>
  r.x - r.w / 2 >= box.x0 + m && r.x + r.w / 2 <= box.x1 - m && r.z - r.d / 2 >= box.z0 + m && r.z + r.d / 2 <= box.z1 - m;

// plot: { s0, s1, zBack, zFacade, garden, yardSide, seed }
// blockers: local rects already taken (house incl. a 1 m apron, annex, passport outbuildings).
// kinds: passport outbuilding kinds present (a shed in the passport means no extra shed).
export function yardLayout(plot, blockers = [], { kinds = [] } = {}) {
  const random = randomGenerator((plot.seed ^ 0x6a09e667) >>> 0 || 1);
  const box = { x0: plot.s0 + .4, x1: plot.s1 - .4, z0: plot.zBack + .4, z1: plot.zFacade - .2 };
  const items = [];
  const taken = () => [...blockers, ...items];
  const free = (r, m = MARGIN) => rectInside(r, box) && !taken().some(b => rectOverlap(b, r, b.soft || r.soft ? .2 : m));
  // Try candidate positions inside a sub-box; returns the placed item or null.
  const place = (kind, w, d, sub, tries = 24, extra = {}) => {
    for (let i = 0; i < tries; i++) {
      const x = sub.x0 + w / 2 + random() * Math.max(0, sub.x1 - sub.x0 - w);
      const z = sub.z0 + d / 2 + random() * Math.max(0, sub.z1 - sub.z0 - d);
      const r = { kind, x, z, w, d, ...extra };
      if (free(r)) { items.push(r); return r; }
    }
    return null;
  };
  const back = blockers.find(b => b.kind === 'house');
  const houseBack = back ? back.z - back.d / 2 : plot.zFacade - 6;
  const behind = { x0: box.x0, x1: box.x1, z0: box.z0, z1: Math.min(houseBack - .8, box.z1) };
  const depth = behind.z1 - behind.z0, width = box.x1 - box.x0;
  if (depth < 3 || width < 4) return items;

  // 1. Vegetable beds at the back, rows running away from the street (most plots).
  if (random() < .85 && depth > 7) {
    const bw = Math.min(width - 2, 6 + random() * 6), bd = Math.min(depth * .5, 5 + random() * 6);
    place('beds', bw, bd, { ...behind, z1: behind.z0 + bd + 1.5 }, 12, { soft: true, rows: random() < .75 ? 'z' : 'x', pitch: .65 + random() * .2 });
  }
  // 2. Greenhouse near the beds (polycarbonate arch or film tunnel).
  if (random() < .6) place('greenhouse', 3, 4 + Math.round(random() * 2) * 1, behind, 24, { film: random() < .4 });
  // 3. Banya at a back corner, a shed near the yard side.
  const [bwid, bdep] = YARD_SIZES.banya;
  if (random() < .65 && !kinds.includes('banya')) place('banya', bwid, bdep, behind, 30, { seed: Math.floor(random() * 1e6) });
  const yardSub = plot.yardSide > 0 ? { ...behind, x0: (box.x0 + box.x1) / 2 - 2, z0: behind.z1 - 8 } : { ...behind, x1: (box.x0 + box.x1) / 2 + 2, z0: behind.z1 - 8 };
  if (random() < .7 && !kinds.includes('shed')) place('shed', YARD_SIZES.shed[0] + random() * .8, YARD_SIZES.shed[1] + random() * .6, yardSub, 30, { seed: Math.floor(random() * 1e6) });
  // 4. Woodpile against a side fence or along the back of the house.
  if (random() < .85) {
    const len = 2.6 + random() * 2.4, along = random() < .5;
    const w = along ? len : 1, d = along ? 1 : len;
    const side = random() < .5 ? box.x0 + w / 2 + .1 : box.x1 - w / 2 - .1;
    const r = { kind: 'woodpile', w, d, x: along ? (box.x0 + box.x1) / 2 + (random() - .5) * (width - w) : side, z: behind.z1 - d / 2 - random() * Math.max(0, depth - d), h: 1.3 + random() * .5 };
    if (free(r, .3)) items.push(r); else place('woodpile', w, d, behind, 20, { h: r.h });
  }
  // 5. Outhouse at a back corner.
  if (random() < .6) place('outhouse', 1.2, 1.3, { ...behind, z1: behind.z0 + 4 }, 20);
  // 6. Garden trees and shrubs (soft: may stand close to beds and fences).
  const trees = random() < .8 ? 1 + Math.floor(random() * 3) : 0;
  for (let i = 0; i < trees; i++) place(random() < .2 ? 'birch' : 'appleTree', 2.2, 2.2, box, 20, { scale: .75 + random() * .5, seed: Math.floor(random() * 1e6) });
  const shrubs = Math.floor(random() * 3);
  for (let i = 0; i < shrubs; i++) place('shrub', 1.6, 1.6, box, 16, { scale: .7 + random() * .6, seed: Math.floor(random() * 1e6) });
  return items;
}

// Which yard items stop a walker (soft items and trees do not).
export const SOLID_YARD = new Set(['banya', 'shed', 'greenhouse', 'outhouse', 'woodpile']);
