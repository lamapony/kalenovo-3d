// Наличники of улица Толстихина: a small library of window-trim types, each named after the
// street-imagery frame it was measured from (crops of the ref windows, round 4b). Pure (no
// three.js): a type resolves to a list of parts in window-local metres, x across the window
// (0 = centre), y up from the bottom of the glazed opening (0) to its top (wh), z out of the wall
// from the casing face. Parts are convex polygons (prisms) or boxes, plus a few pierced templates
// from templates.js. Roles pick the colour: 'frame' (casing, sill), 'crown' (crown boards) and
// 'insert' (the contrasting carving: filigree, darts, diamonds, outlines, crests).
//
//  east-003  small pediment on a deep frieze board, white outline and plaque (also west-032)
//  east-004  tall round arch (кокошник) over closed shutters, a small rosette
//  east-005  pediment with a pierced filigree fan on a white cornice band, drop ears at the sill
//  east-007  flat projecting cornice over a plain frieze with a diamond plaque
//  east-012  low carved frieze (white leaf darts) under a thin cornice (also east-019)
//  east-016  pediment over a frieze carrying a diamond between two darts, white drops
//  east-027  segmental arch with a curled crest on top, teal with cream
//  east-030  white pediment with pierced filigree, scalloped apron under the sill (also west-002)
//  west-024  stepped pediment with horns, white diamond and darts, two-tone
import { hashString } from './spec.js';

export const NALICHNIK_TYPES = {
  'east-003': { crown: 'plaque', apron: 'none', panels: 'plain' },
  'east-004': { crown: 'round-arch', apron: 'none', panels: 'plain' },
  'east-005': { crown: 'filigree', apron: 'ears', panels: 'plain', band: 'crown' },
  'east-007': { crown: 'cornice', apron: 'none', panels: 'plain' },
  'east-012': { crown: 'frieze', apron: 'none', panels: 'outlined' },
  'east-016': { crown: 'dart', apron: 'ears', panels: 'outlined' },
  'east-027': { crown: 'arch-crest', apron: 'none', panels: 'inset' },
  'east-030': { crown: 'filigree', apron: 'scallop', panels: 'outlined', band: 'crown' },
  'west-024': { crown: 'dart', apron: 'none', panels: 'outlined', horns: true },
};
export const NALICHNIK_TYPE_NAMES = Object.keys(NALICHNIK_TYPES);

// Type of a carved наличник: the passport type, else from the observed crown shape, else a
// deterministic pick among the common pediment types. Plain / no trim returns null.
export function nalichnikType(nal, id = '') {
  if (!nal || nal.style === 'none' || nal.style === 'plain') return null;
  if (nal.type && NALICHNIK_TYPES[nal.type]) return nal.type;
  if (nal.shape === 'kokoshnik') return 'east-027';
  if (nal.shape === 'trapezoid') return 'east-007';
  const pool = nal.shape === 'pediment' ? ['east-005', 'east-016', 'east-030'] : ['east-030', 'east-016', 'east-012', 'east-005'];
  return pool[hashString(id) % pool.length];
}

const box = (x, y, w, h, d, z, role) => ({ kind: 'box', x, y, w, h, d, z, role });
const poly = (pts, d, z, role) => ({ kind: 'poly', pts, d, z, role });
const diamond = (x, y, w, h, z, role) => poly([[x, y - h / 2], [x + w / 2, y], [x, y + h / 2], [x - w / 2, y]], .015, z, role);
// Thin bar between two points (a rotated box as a 4-point polygon).
function bar(a, b, t, d, z, role) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * t / 2, ny = dx / l * t / 2;
  return poly([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], d, z, role);
}
function arc(cx, y, w, rise, n = 10) {
  // Segmental arch polygon (convex): chord w at height y, rise above it.
  const r = (w * w / 4 + rise * rise) / (2 * rise), cy = y + rise - r, a0 = Math.asin(Math.min(1, w / 2 / r));
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = -a0 + 2 * a0 * i / n; pts.push([cx + Math.sin(a) * r, cy + Math.cos(a) * r]); }
  return pts;
}

// Fan of leaf petals: base centre (x, y), half width rx, height ry; 7 petals and a half rosette.
export function fanInsert(x, y, rx, ry, z, n = 7) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i + .5) / n, ux = Math.cos(a), uy = Math.sin(a);
    const len = 1 - .25 * Math.abs(ux), tipX = x + ux * rx * len, tipY = y + uy * ry * len;
    const midX = x + ux * rx * len * .55, midY = y + uy * ry * len * .55, px = -uy * .028, py = ux * .028;
    out.push(poly([[x + ux * .05, y + uy * .05], [midX + px, midY + py], [tipX, tipY], [midX - px, midY - py]], .015, z, 'insert'));
  }
  const disc = [];
  for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8; disc.push([x + Math.cos(a) * .065, y + Math.sin(a) * .065]); }
  out.push(poly(disc, .02, z, 'insert'));
  return out;
}

// Parts of one наличник. ww/wh: glazed opening. Returns { parts, top } (top: highest y).
export function nalichnikParts(typeName, ww, wh) {
  const T = NALICHNIK_TYPES[typeName];
  if (!T) return { parts: [], top: wh };
  const cw = .1, W = ww + 2 * cw, parts = [];
  // Casing: narrow side boards, a head board, a sill with a drip.
  parts.push(box(-ww / 2 - cw / 2, -.06, cw, wh + .14, .04, 0, 'frame'), box(ww / 2 + cw / 2, -.06, cw, wh + .14, .04, 0, 'frame'));
  parts.push(box(0, wh, W, .08, .04, 0, 'frame'));
  parts.push(box(0, -.08, W + .12, .05, .12, .02, 'frame'), box(0, -.12, W, .04, .03, 0, 'frame'));
  const y0 = wh + .08, k = Math.min(1.25, Math.max(.8, wh / 1.25)); // crown scale follows the window height
  let top = y0;
  if (T.crown === 'filigree') {
    const band = T.band;
    parts.push(box(0, y0, W + .08, .1 * k, .045, 0, band), box(0, y0 + .1 * k, W + .16, .04, .1, .02, band));
    const y1 = y0 + .14 * k, ph = .3 * k, hw = W / 2 + .02;
    parts.push(poly([[-hw, y1], [hw, y1], [0, y1 + ph]], .035, 0, 'crown'));
    parts.push(bar([-hw - .02, y1], [0, y1 + ph + .02], .04, .02, .035, band), bar([0, y1 + ph + .02], [hw + .02, y1], .04, .02, .035, band));
    // Carved fan (веер) in the pediment: leaf petals radiating from a half rosette at the
    // middle of the base, the white board showing between them.
    parts.push(...fanInsert(0, y1 + .02, Math.min(W * .36, ph * 1.05), ph * .78, .036));
    parts.push(box(0, y1 + ph, .05, .11 * k, .04, 0, band));
    top = y1 + ph + .11 * k;
  } else if (T.crown === 'dart') {
    const fh = .14 * k;
    parts.push(box(0, y0, W + .04, fh, .04, 0, 'crown'), box(0, y0 + fh, W + .14, .04, .1, .02, 'crown'));
    const y1 = y0 + fh + .04, ph = (T.horns ? .27 : .24) * k, hw = W / 2 + .03;
    parts.push(poly([[-hw, y1], [hw, y1], [0, y1 + ph]], .035, 0, 'crown'));
    if (T.horns) for (const s of [-1, 1]) parts.push(poly([[s * hw, y1], [s * (hw + .07), y1 + .09 * k], [s * (hw - .06), y1 + .03]], .035, 0, 'crown'));
    const fy = y0 + fh / 2;
    parts.push(diamond(0, fy, .13, .085 * k, .042, 'insert'));
    for (const s of [-1, 1]) parts.push(poly(s < 0 ? [[-.1, fy], [-W / 2 + .07, fy - .025], [-W / 2 + .07, fy + .025]] : [[.1, fy], [W / 2 - .07, fy + .025], [W / 2 - .07, fy - .025]], .015, .042, 'insert'));
    parts.push(diamond(0, y1 + ph * .38, .1, .08 * k, .037, 'insert'));
    if (!T.horns) parts.push(bar([-hw - .02, y1], [0, y1 + ph + .02], .035, .015, .035, 'insert'), bar([0, y1 + ph + .02], [hw + .02, y1], .035, .015, .035, 'insert'));
    top = y1 + ph;
  } else if (T.crown === 'plaque') {
    const fh = .2 * k;
    parts.push(box(0, y0, W + .04, fh, .04, 0, 'crown'));
    parts.push(box(0, y0 + .01, W + .06, .025, .045, .002, 'insert'), box(0, y0 + fh - .03, W + .1, .035, .06, .002, 'insert'));
    parts.push(box(0, y0 + fh * .42, .16, .06 * k, .012, .042, 'insert'));
    const y1 = y0 + fh, ph = .19 * k, hw = W / 2 + .05;
    parts.push(poly([[-hw, y1], [hw, y1], [0, y1 + ph]], .035, 0, 'crown'));
    parts.push(bar([-hw - .02, y1], [0, y1 + ph + .02], .04, .02, .035, 'insert'), bar([0, y1 + ph + .02], [hw + .02, y1], .04, .02, .035, 'insert'));
    top = y1 + ph + .02;
  } else if (T.crown === 'cornice') {
    const fh = .24 * k;
    parts.push(box(0, y0, W + .1, .03, .07, .01, 'crown'), box(0, y0 + .03, W + .04, fh, .04, 0, 'crown'));
    parts.push(box(0, y0 + .03 + fh, W + .2, .07, .16, .04, 'crown'));
    parts.push(diamond(0, y0 + .03 + fh / 2, .2, .09 * k, .042, 'insert'));
    top = y0 + .1 + fh;
  } else if (T.crown === 'frieze') {
    const fh = .15 * k;
    parts.push(box(0, y0, W + .06, fh, .04, 0, 'crown'), box(0, y0 + fh, W + .16, .05, .12, .03, 'crown'));
    const n = Math.max(3, Math.round(W / .2)), fy = y0 + fh / 2;
    for (let i = 0; i < n; i++) { const x = -W / 2 + .08 + (W - .16) * (i + .5) / n; parts.push(diamond(x, fy, Math.min(.13, (W - .16) / n * .8), .045 * k, .042, 'insert')); }
    top = y0 + fh + .05;
  } else if (T.crown === 'arch-crest' || T.crown === 'round-arch') {
    const round = T.crown === 'round-arch', bh = .07 * k;
    parts.push(box(0, y0, W + .04, bh, .04, 0, 'crown'));
    const rise = (round ? .32 : .2) * k, pts = arc(0, y0 + bh, W + .04, rise);
    parts.push(poly(pts, .035, 0, 'crown')); // the chord closes the polygon
    top = y0 + bh + rise;
    if (round) parts.push(diamond(0, y0 + bh + rise * .45, .12, .12, .037, 'insert'));
    else {
      parts.push({ kind: 'tpl', tpl: 'kokoshnik', x: 0, y: top - .06, w: .56, h: .26 * k, z: .02, role: 'insert' });
      for (const s of [-1, 1]) parts.push(diamond(s * (W / 2 - .02), y0 + bh + .04, .1, .07, .04, 'insert'));
      top += .2 * k;
    }
  }
  if (T.apron === 'ears' || T.apron === 'scallop') {
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + .02);
      parts.push(box(x, -.24, .06, .12, .03, .01, T.apron === 'ears' && T.crown === 'dart' ? 'insert' : 'frame'));
      parts.push(diamond(x, -.27, .08, .09, .012, T.apron === 'ears' && T.crown === 'dart' ? 'insert' : 'frame'));
    }
  }
  if (T.apron === 'scallop') parts.push({ kind: 'tpl', tpl: 'apron', x: 0, y: -.13, w: W - .04, h: .5, z: .01, role: 'frame' });
  return { parts, top };
}
