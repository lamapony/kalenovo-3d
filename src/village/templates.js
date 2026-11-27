// Carved trim templates (наличники, причелины, подзоры) as thin extrusions in metres.
// Each template is built once and stamped into merged geometry by MeshBuilder.geometry().
import * as THREE from 'three/webgpu';

const DEPTH = .032;
function extrude(shape, depth = DEPTH, curveSegments = 5) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
  g.translate(0, 0, -depth / 2);
  return g;
}
function circleHole(x, y, r) { const p = new THREE.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); return p; }
function polyHole(points) { const p = new THREE.Path(); p.moveTo(...points[0]); points.slice(1).forEach(q => p.lineTo(...q)); p.closePath(); return p; }

let cache;
export function trimTemplates() {
  if (cache) return cache;
  // 1. Kokoshnik crest: arched top with a sun hole and two diamonds. Base width 1 (x -0.5..0.5).
  const kok = new THREE.Shape();
  kok.moveTo(-.56, 0); kok.lineTo(.56, 0); kok.lineTo(.56, .07); kok.lineTo(.5, .09);
  kok.quadraticCurveTo(.42, .36, .06, .4); kok.lineTo(0, .48); kok.lineTo(-.06, .4);
  kok.quadraticCurveTo(-.42, .36, -.5, .09); kok.lineTo(-.56, .07); kok.closePath();
  kok.holes.push(circleHole(0, .22, .065));
  for (const s of [-1, 1]) kok.holes.push(polyHole([[s * .27, .07], [s * .33, .14], [s * .27, .21], [s * .21, .14]]));

  // 2. Pediment crest: triangular frontoncik with an inset triangle hole.
  const ped = new THREE.Shape();
  ped.moveTo(-.6, 0); ped.lineTo(.6, 0); ped.lineTo(.6, .05); ped.lineTo(0, .34); ped.lineTo(-.6, .05); ped.closePath();
  ped.holes.push(polyHole([[-.36, .07], [0, .25], [.36, .07]]));

  // 3. Wave crest: low board with three bumps and drilled dots.
  const wav = new THREE.Shape();
  wav.moveTo(-.56, 0); wav.lineTo(.56, 0); wav.lineTo(.56, .1);
  wav.quadraticCurveTo(.4, .26, .22, .14); wav.quadraticCurveTo(0, .34, -.22, .14); wav.quadraticCurveTo(-.4, .26, -.56, .1); wav.closePath();
  for (const x of [-.34, 0, .34]) wav.holes.push(circleHole(x, x === 0 ? .17 : .1, .03));

  // 3b. Trapezoid crown: a solid board crown with sloped sides and a small peak.
  const tra = new THREE.Shape();
  tra.moveTo(-.56, 0); tra.lineTo(.56, 0); tra.lineTo(.56, .05); tra.lineTo(.42, .2); tra.lineTo(.12, .22);
  tra.lineTo(0, .34); tra.lineTo(-.12, .22); tra.lineTo(-.42, .2); tra.lineTo(-.56, .05); tra.closePath();

  // 4. Skirt under the sill: straight top, scalloped bottom (5 scallops), width 1.
  const sk = new THREE.Shape();
  sk.moveTo(-.5, 0); sk.lineTo(.5, 0); sk.lineTo(.5, -.07);
  for (let i = 0; i < 5; i++) { const cx = .4 - i * .2; sk.absarc(cx, -.07, .1, 0, Math.PI, true); }
  sk.lineTo(-.5, 0); sk.closePath();

  // 5. Rake board (причелина): length 1 along x (0..1), 0.24 high, scalloped lower edge (14 scallops).
  const rk = new THREE.Shape(), n = 14, r = .5 / n;
  rk.moveTo(0, 0); rk.lineTo(1, 0); rk.lineTo(1, -.12);
  for (let i = 0; i < n; i++) { const cx = 1 - r - i * 2 * r; rk.absarc(cx, -.12, r, 0, Math.PI, true); }
  rk.lineTo(0, 0); rk.closePath();

  // 6. Gable towel (полотенце): hanging board under the apex.
  const tw = new THREE.Shape();
  tw.moveTo(-.12, 0); tw.lineTo(.12, 0); tw.lineTo(.12, -.55); tw.lineTo(.2, -.62); tw.lineTo(0, -.85); tw.lineTo(-.2, -.62); tw.lineTo(-.12, -.55); tw.closePath();
  tw.holes.push(circleHole(0, -.3, .05), polyHole([[0, -.58], [.06, -.66], [0, -.74], [-.06, -.66]]));

  // 7. Shutter diamond overlay.
  const di = new THREE.Shape();
  di.moveTo(0, -.5); di.lineTo(.5, 0); di.lineTo(0, .5); di.lineTo(-.5, 0); di.closePath();

  // --- Carved наличник parts (fretwork: pierced holes, cut profiles, drops). Symmetric about
  // x = 0 so they never need a mirrored (negative-scale) stamp.
  // 8. Tall pierced kokoshnik crown: ogee shoulders, a finial ball, a sun rosette (centre hole
  // and a ring of drilled petals) and teardrop / diamond fretwork in the shoulders. Width 1.08.
  const rk2 = new THREE.Shape();
  rk2.moveTo(-.54, 0); rk2.lineTo(.54, 0); rk2.lineTo(.54, .06);
  rk2.bezierCurveTo(.5, .24, .26, .24, .14, .44); rk2.lineTo(.05, .52);
  rk2.absarc(0, .58, .055, -Math.PI / 2 + .9, Math.PI * 1.5 - .9, false);
  rk2.lineTo(-.05, .52); rk2.lineTo(-.14, .44); rk2.bezierCurveTo(-.26, .24, -.5, .24, -.54, .06); rk2.closePath();
  rk2.holes.push(circleHole(0, .27, .062));
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; rk2.holes.push(circleHole(Math.cos(a) * .12, .27 + Math.sin(a) * .12, .018)); }
  for (const s of [-1, 1]) {
    rk2.holes.push(polyHole([[s * .3, .05], [s * .35, .1], [s * .3, .17], [s * .25, .1]]));
    rk2.holes.push(circleHole(s * .43, .08, .022));
    rk2.holes.push(polyHole([[s * .17, .06], [s * .2, .1], [s * .17, .13], [s * .14, .1]]));
  }
  // 9. Pierced pediment crown: triangle with a stepped top, a row of diamonds and a rosette.
  const rp2 = new THREE.Shape();
  rp2.moveTo(-.56, 0); rp2.lineTo(.56, 0); rp2.lineTo(.56, .06); rp2.lineTo(.08, .36); rp2.lineTo(.05, .43);
  rp2.absarc(0, .47, .045, -Math.PI / 2 + .8, Math.PI * 1.5 - .8, false); rp2.lineTo(-.08, .36); rp2.lineTo(-.56, .06); rp2.closePath();
  rp2.holes.push(circleHole(0, .2, .05));
  for (const s of [-1, 1]) for (const x of [.2, .36]) rp2.holes.push(polyHole([[s * x, .05], [s * (x + .04), .095], [s * x, .14 - x * .12], [s * (x - .04), .095]]));
  // 10. Pierced trapezoid crown with a raised middle and drilled dots.
  const rt2 = new THREE.Shape();
  rt2.moveTo(-.56, 0); rt2.lineTo(.56, 0); rt2.lineTo(.56, .06); rt2.lineTo(.44, .22); rt2.lineTo(.14, .24); rt2.lineTo(.05, .36);
  rt2.absarc(0, .4, .045, -Math.PI / 2 + .8, Math.PI * 1.5 - .8, false); rt2.lineTo(-.14, .24); rt2.lineTo(-.44, .22); rt2.lineTo(-.56, .06); rt2.closePath();
  rt2.holes.push(circleHole(0, .17, .045));
  for (const s of [-1, 1]) { rt2.holes.push(polyHole([[s * .22, .06], [s * .3, .06], [s * .3, .16], [s * .22, .16]])); rt2.holes.push(circleHole(s * .42, .1, .022)); }
  // 11. Side board (unit height, 0.16 wide): cut profile on both edges (foot, two bites, an
  // ear at the top) and three pierced diamonds; stamped scaled to the window height.
  const sbd = new THREE.Shape(), hw = .06;
  sbd.moveTo(-.085, 0); sbd.lineTo(.085, 0); sbd.lineTo(.085, .05); sbd.lineTo(hw, .08);
  for (const y of [.36, .64]) { sbd.lineTo(hw, y - .05); sbd.quadraticCurveTo(hw - .035, y, hw, y + .05); }
  sbd.lineTo(hw, .9); sbd.lineTo(.1, .95); sbd.lineTo(.1, 1); sbd.lineTo(-.1, 1); sbd.lineTo(-.1, .95); sbd.lineTo(-hw, .9);
  for (const y of [.64, .36]) { sbd.lineTo(-hw, y + .05); sbd.quadraticCurveTo(-hw + .035, y, -hw, y - .05); }
  sbd.lineTo(-hw, .08); sbd.lineTo(-.085, .05); sbd.closePath();
  for (const y of [.22, .5, .78]) sbd.holes.push(polyHole([[0, y - .045], [.022, y], [0, y + .045], [-.022, y]]));
  // 12. Apron under the sill (подзор): width 1, scalloped lower edge with a central pendant,
  // a row of drilled dots.
  const ap = new THREE.Shape();
  ap.moveTo(-.5, 0); ap.lineTo(.5, 0); ap.lineTo(.5, -.08);
  for (let i = 0; i < 2; i++) { const cx = .4 - i * .2; ap.absarc(cx, -.08, .1, 0, Math.PI, true); }
  ap.lineTo(.1, -.14); ap.lineTo(.04, -.2); ap.absarc(0, -.24, .045, Math.PI / 2 - .7, Math.PI / 2 + .7 - Math.PI * 2, true); ap.lineTo(-.1, -.14);
  ap.lineTo(-.1, -.08);
  for (let i = 0; i < 2; i++) { const cx = -.2 - i * .2; ap.absarc(cx, -.08, .1, 0, Math.PI, true); }
  ap.lineTo(-.5, 0); ap.closePath();
  for (const x of [-.4, -.2, .2, .4]) ap.holes.push(circleHole(x, -.045, .018));
  ap.holes.push(polyHole([[0, -.02], [.035, -.06], [0, -.1], [-.035, -.06]]));
  // 13. Drop (капелька): a small turned pendant hung under the crown shelf.
  const dr = new THREE.Shape();
  dr.moveTo(-.018, 0); dr.lineTo(.018, 0); dr.lineTo(.018, -.04); dr.absarc(0, -.07, .032, Math.PI / 2 - 1, Math.PI / 2 + 1 - Math.PI * 2, true); dr.lineTo(-.018, -.04); dr.closePath();

  cache = {
    carved: { crowns: [extrude(rk2, .04, 4), extrude(rp2, .04, 3), extrude(rt2, .04, 3)], side: extrude(sbd, .03, 2), apron: extrude(ap, .03, 3), drop: extrude(dr, .03, 3) },
    crests: [extrude(kok, .036), extrude(ped, .036), extrude(wav, .036), extrude(tra, .04)],
    skirt: extrude(sk, .03),
    rake: extrude(rk, .035, 4),
    towel: extrude(tw, .035),
    diamond: extrude(di, .02, 1),
  };
  return cache;
}
