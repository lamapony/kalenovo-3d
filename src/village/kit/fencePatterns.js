// Pure fence and gate patterns for the main-street kit (no three.js), unit tested.
// Picket tops and the fan-shaped palisade, diamond inserts laid over pickets, and the board
// layouts of gate leaves (vertical, chevron, X, diamond).

// Height factor (relative to the fence height) of picket k of n inside one post section.
// 'fan' (веер): the pickets rise towards both posts in a smooth dip, lowest in the middle,
// as in the white fan palisades of the street imagery; other tops are level.
export function picketHeightFactor(top, k, n) {
  if (top !== 'fan' || n < 3) return 1;
  const u = (k + .5) / n * 2 - 1; // -1 .. 1 across the section
  return .7 + .3 * u * u;
}

// Lean (radians about the fence normal) of picket k of n in a fan section: the boards splay
// outwards from the bottom middle like the ribs of a fan.
export function picketLean(top, k, n) {
  if (top !== 'fan' || n < 3) return 0;
  const u = (k + .5) / n * 2 - 1;
  return -u * .15;
}

// Diamond inserts on a picket run: centres (chainage) of rhombi between the posts, one per
// section of at least 1.6 m, [] when the section is too short.
export function diamondStations(s0, s1, step = 2.4) {
  const L = s1 - s0, n = Math.max(1, Math.ceil(L / step)), out = [];
  for (let i = 0; i < n; i++) {
    const a = s0 + L * i / n, c = s0 + L * (i + 1) / n;
    if (c - a >= 1.6) out.push({ t: (a + c) / 2, w: Math.min(1.5, (c - a) * .62) });
  }
  return out;
}

// Board strips of one gate leaf, leaf-local (x across the leaf from -lw/2 to lw/2, y up from 0
// to h): { x, y, len, angle } centres of overlay boards (angle in radians from +x).
// 'chevron': diagonal boards meeting in a ^ at the leaf centre line; 'x': two crossed braces
// in an inner frame; 'diamond': a rhombus frame. 'vertical' has no overlay.
export function gateOverlay(pattern, lw, h, board = .12) {
  const out = [];
  const m = .1, x0 = -lw / 2 + m, x1 = lw / 2 - m, y0 = .25, y1 = h - .25;
  if (pattern === 'x') {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    out.push({ x: 0, y: (y0 + y1) / 2, len, angle: a }, { x: 0, y: (y0 + y1) / 2, len, angle: Math.PI - a });
    out.push({ x: 0, y: y0, len: dx, angle: 0, frame: true }, { x: 0, y: y1, len: dx, angle: 0, frame: true });
    out.push({ x: x0, y: (y0 + y1) / 2, len: dy, angle: Math.PI / 2, frame: true }, { x: x1, y: (y0 + y1) / 2, len: dy, angle: Math.PI / 2, frame: true });
  } else if (pattern === 'chevron') {
    // Parallel 45-degree boards in each half, clipped to the leaf panel.
    const half = (x1 - x0) / 2, step = board * Math.SQRT2 * 1.9;
    for (const side of [-1, 1]) {
      const xa = side < 0 ? x0 : 0, xb = side < 0 ? 0 : x1;
      // Lines y = y0 + c + side*(x)... boards rise towards the centre line (^).
      for (let c = -half; c < y1 - y0; c += step) {
        // Board: points where y - y0 = c + (side < 0 ? (x - x0) : (x1 - x)) within the panel.
        const pts = [];
        for (const x of [xa, xb]) {
          const y = y0 + c + (side < 0 ? x - x0 : x1 - x);
          pts.push([x, y]);
        }
        const clip = clipSegment(pts[0], pts[1], x0, x1, y0, y1);
        if (clip) {
          const [[ax, ay], [bx, by]] = clip, len = Math.hypot(bx - ax, by - ay);
          if (len > .12) out.push({ x: (ax + bx) / 2, y: (ay + by) / 2, len, angle: Math.atan2(by - ay, bx - ax) });
        }
      }
    }
    out.push({ x: 0, y: (y0 + y1) / 2, len: y1 - y0, angle: Math.PI / 2, frame: true });
  } else if (pattern === 'diamond') {
    const cx = 0, cy = (y0 + y1) / 2, rx = (x1 - x0) * .38, ry = Math.min((y1 - y0) * .36, rx * 1.4);
    const corners = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
      out.push({ x: (ax + bx) / 2, y: (ay + by) / 2, len: Math.hypot(bx - ax, by - ay) + board * .6, angle: Math.atan2(by - ay, bx - ax) });
    }
  }
  return out;
}

// Liang-Barsky clip of segment a-b to the box [x0, x1] x [y0, y1]; null when outside.
export function clipSegment(a, b, x0, x1, y0, y1) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}
