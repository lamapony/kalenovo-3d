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

  cache = {
    crests: [extrude(kok, .036), extrude(ped, .036), extrude(wav, .036), extrude(tra, .04)],
    skirt: extrude(sk, .03),
    rake: extrude(rk, .035, 4),
    towel: extrude(tw, .035),
    diamond: extrude(di, .02, 1),
  };
  return cache;
}
