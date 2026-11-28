// Low-poly parked vehicles from passport.cars (placed by layout.carPlacements): a hatchback
// and a high-sided army truck with a plank bed. Boxes and wheel cylinders stamped into the
// shared TiledBuilders (painted steel, dark metal, rough wood, window glass).
import * as THREE from 'three/webgpu';
import { context, groundStats } from '../house.js';
import { lin } from '../materials.js';

export function buildCars(B, ground, plots) {
  let n = 0;
  for (const plot of plots) for (const c of plot.cars || []) {
    const pre = context(B, c.x, c.z, 0, c.angle), gs = groundStats(pre, ground, c.w, c.l);
    const ctx = context(B, c.x, c.z, (gs.min + gs.max) / 2, c.angle);
    if (c.vehicle === 'truck') truck(ctx, c); else car(ctx, c);
    n++;
  }
  return n;
}

// Wheels along local z (vehicle length), axles across x.
function wheels(ctx, xs, zs, r, wdt) {
  const t = ctx.b('darkMetal');
  t.setColor([.35, .35, .35]);
  const h = ctx.b('darkMetal', null, 'detail');
  h.setColor([1.6, 1.6, 1.6]);
  for (const z of zs) for (const x of xs) {
    t.log(x - wdt / 2, x + wdt / 2, r, z, r, r, { segments: 10 });
    h.log(x + Math.sign(x) * (wdt / 2), x + Math.sign(x) * (wdt / 2 + .01), r, z, r * .55, r * .55, { segments: 8, caps: [true, true] });
  }
}

function car(ctx, c) {
  const body = ctx.b('paintedMetal'), col = lin(c.color);
  const W = 1.72, L = 4.4;
  body.setColor(col);
  body.box(W, .62, L, 0, .62, 0);
  body.box(W - .04, .12, L - .5, 0, .99, -.1);
  // Cabin: tapered with three stacked boxes; glass band around it.
  body.box(W - .16, .06, 1.9, 0, 1.43, -.25);
  const g = ctx.b('kitGlass');
  g.setColor([0, .3, 0]);
  g.box(W - .14, .36, 2.1, 0, 1.23, -.22);
  const dk = ctx.b('darkMetal');
  dk.setColor([.5, .5, .5]);
  dk.box(W + .02, .16, .12, 0, .42, L / 2 - .02); dk.box(W + .02, .16, .12, 0, .42, -L / 2 + .02);
  const lt = ctx.b('painted', null, 'detail');
  lt.setColor(lin('#e8e2d0'));
  for (const s of [-1, 1]) lt.box(.3, .1, .03, s * .6, .78, L / 2 + .005);
  lt.setColor(lin('#8a1d1d'));
  for (const s of [-1, 1]) lt.box(.25, .14, .03, s * .65, .82, -L / 2 - .005);
  wheels(ctx, [-W / 2 + .1, W / 2 - .1], [L / 2 - .85, -L / 2 + .8], .31, .2);
}

function truck(ctx, c) {
  const cab = ctx.b('paintedMetal'), col = lin(c.color);
  const W = 2.3, L = 6.4, zc = L / 2 - 1.1;
  cab.setColor(col);
  cab.box(W - .3, .9, 1.9, 0, 1.55, zc);          // bonnet + cab lower
  cab.box(W - .4, .85, 1.1, 0, 2.4, zc - .35);    // cab upper
  for (const s of [-1, 1]) cab.box(.35, .12, 1.2, s * (W / 2 - .2), 1.35, zc + .3); // mudguards
  const g = ctx.b('kitGlass');
  g.setColor([0, .2, 0]);
  g.box(W - .38, .45, 1.12, 0, 2.5, zc - .35);
  const fr = ctx.b('darkMetal');
  fr.setColor([.4, .4, .4]);
  fr.box(1.0, .25, L - .4, 0, 1.0, -.1);
  // Plank bed with high slatted sides.
  const wd = ctx.b('logs'), wc = lin('#8a7354').map(v => v * 1.3);
  wd.setColor(wc);
  const bz = -L / 2 + 2.05, bl = 4.1;
  wd.box(W, .1, bl, 0, 1.2, bz);
  for (const s of [-1, 1]) {
    wd.box(.06, .45, bl, s * W / 2, 1.5, bz);
    for (let k = 0; k < 2; k++) wd.box(.05, .12, bl, s * W / 2, 1.95 + k * .32, bz);
    for (let k = 0; k <= 4; k++) wd.box(.08, 1.1, .1, s * W / 2, 1.75, bz - bl / 2 + k * bl / 4);
  }
  wd.box(W, .45, .06, 0, 1.5, bz - bl / 2); wd.box(W, .45, .06, 0, 1.5, bz + bl / 2);
  for (let k = 0; k < 2; k++) wd.box(W, .12, .05, 0, 1.95 + k * .32, bz - bl / 2);
  wheels(ctx, [-W / 2 + .3, W / 2 - .3], [zc + .25, -L / 2 + 1.9, -L / 2 + .75], .55, .38);
  void THREE;
}
