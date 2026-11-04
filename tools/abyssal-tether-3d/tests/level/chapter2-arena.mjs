// CHAPTER II · the set-pieces' geometry (data/chapter2-sets.js), Node:
//   - II-9 THE TOLLING GALLERY: eight bells on a nave, five open the seal across the pit, the Tenor's landing and stand, the Usher's four stations
//   - II-12 THE SNUFFING: the stair is cut at the Well rim and the rim is joined to its last ledge; the Span's 50 plates are 3 m apart, step down less than a metre
//     and are walkable end to end in the real physics; the landing, the lift (the cage 33 m to the Throat's lip), the shutter and the Great Bell are where they
//     should be; the clappers are haul fixtures; the arena solids touch only what they should
//   node chapter2-arena.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js'));
const { LEVEL_DATA_CH2: D } = await import(srcUrl('data/chapter2-data.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const S = new Map(D.solids.map((s) => [s.id, s]));
const inter = (a, b) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0.05 && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > 0.05 && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0.05;

// ---- II-9
{
  const T = D.c2.tolling;
  ok(T.bells.length === 8 && T.need === 5, 'eight bells, five open the way');
  const L = new Level3D(D, 'normal', { freeAttach: true });
  const bus = new EventBus();
  const O = new Objectives3D(L, DIFFICULTY.normal, bus);
  const obj = O.objectives.find((o) => o.id === 'obj-c2-9');
  ok(obj && obj.need === 5 && obj.fx.length === 8, 'the bell objective needs five of eight (Objectives3D reads it)');
  ok(L.sealSolids.some((s) => s.seal === 'seal-c2-9'), 'the seal plate is a seal solid across the pit');
  const seal = S.get('seal-c2-9-floor') || L.sealSolids.find((s) => s.id.includes('seal-c2-9'));
  ok(seal && seal.minX <= -26 && seal.maxX >= 26 && seal.minZ <= -26 && seal.maxZ >= 26, 'the plate covers the whole pit');
  const nave = S.get('c2-9-nave');
  ok(nave && nave.maxX - nave.minX >= 48 && T.bells.every((b) => b.x > nave.minX && b.x < nave.maxX && b.y > nave.maxY + 3 && b.y < nave.maxY + 5), 'the bells hang 3-5 m over the nave, along it');
  ok(S.get('c2-9-tenor-landing') && S.get(T.tenor.standId) && T.tenor.landing.y < T.deckY - 11, `the Tenor's landing is ${(T.deckY - T.tenor.landing.y).toFixed(0)} m under the nave`);
  ok(T.usher.length === 4 && T.usher[0].y < S.get('seal-c2-9-floor').minY && T.usher[1].y > T.usher[0].y + 15 && T.usher[2].y > T.usher[1].y + 15 && T.usher[3].y > T.usher[2].y + 10, 'the Usher answers from under the seal plate and climbs in four stations (20, 18 and 16 m a station)');
}

// ---- II-12
{
  const Q = D.c2.snuffing;
  const yT = Q.yT;
  const lastLedge = D.ledges.filter((l) => l.section === 'c2-12').slice(-1)[0];
  ok(Math.abs(yT - lastLedge.y - Q.rim.d) < 0.01 && Q.rim.d > 60 && Q.rim.d < 66, `the stair stops at the Well rim (d ${Q.rim.d} m, ledge ${lastLedge.id})`);
  const rim = S.get('c2-12-rim');
  const c1 = S.get('c2-12-conn-x');
  const c2 = S.get('c2-12-conn-z');
  ok(rim && c1 && c2 && Math.abs(rim.maxY - lastLedge.y) < 1e-6 && Math.abs(c1.maxY - lastLedge.y) < 1e-6, 'the rim and its connector are level with the last ledge');
  // the Span: 50 plates, adjacent, < 1 m a step, inside the pit
  const pl = Q.span.plates;
  let worst = 0;
  let gapMax = 0;
  for (let i = 1; i < pl.length; i++) {
    const a = S.get(pl[i - 1].id);
    const b = S.get(pl[i].id);
    worst = Math.max(worst, a.maxY - b.maxY);
    const gx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
    const gz = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0);
    gapMax = Math.max(gapMax, Math.hypot(gx, gz));
  }
  ok(pl.length === 50 && worst > 0 && worst < 1.0 && gapMax < 0.2, `the Span: ${pl.length} plates (150 m), at most ${worst.toFixed(2)} m a step, no gap over ${gapMax.toFixed(2)} m`);
  ok(pl.every((p) => { const s = S.get(p.id); return s.minX >= -26 && s.maxX <= 26 && s.minZ >= -26 && s.maxZ <= 26 && s.kind === 'crumble' && s.life >= 1e6; }), 'every plate is inside the pit, a crumble (the view draws it) that never crumbles by weight');
  // arena solids touch only what they should
  const own = D.solids.filter((s) => /^(c2-12-|c2-9-)/.test(s.id) && !/^c2-12-(w|e|n|s)$/.test(s.id));
  const allowed = /conn|lip|rim|landing|span|well-floor|l\d+$/;
  const bad = [];
  for (const a of own) for (const b of D.solids) if (a !== b && !/^c2-\d+-(w|e|n|s)$/.test(b.id) && inter(a, b) && !(allowed.test(a.id) && allowed.test(b.id))) bad.push(`${a.id} x ${b.id}`);
  ok(bad.length === 0, `arena solids overlap nothing they should not (${bad.slice(0, 6).join(', ')})`);
  // walk the whole Span in the real physics, steering plate to plate
  const L = new Level3D(D, 'normal', { freeAttach: true });
  const bus = new EventBus();
  const th = new TetherSystem(L, DIFFICULTY.normal, bus, {});
  const ph = new Physics3D(L, DIFFICULTY.normal, bus);
  const first = S.get(pl[0].id);
  const p = new Player3D((first.minX + first.maxX) / 2, first.maxY + 0.45, (first.minZ + first.maxZ) / 2);
  const DT = CONFIG.PHYSICS_DT;
  let reached = 0;
  let steps = 0;
  for (let i = 1; i < pl.length && p.alive; i++) {
    const tgt = S.get(pl[i].id);
    const tx = (tgt.minX + tgt.maxX) / 2;
    const tz = (tgt.minZ + tgt.maxZ) / 2;
    for (let t = 0; t < 300; t++, steps++) {
      const dx = tx - p.x;
      const dz = tz - p.z;
      const dl = Math.hypot(dx, dz);
      if (dl < 0.5 && p.grounded) break;
      ph.step(p, th, { move: { x: dx / (dl || 1), z: dz / (dl || 1) }, reel: 0, jumpPressed: false, brake: false, hands: {} }, DT);
      if (!p.alive || p.y < tgt.maxY - 3) break;
    }
    if (p.alive && p.grounded && Math.abs(p.y - (tgt.maxY + CONFIG.player.radius)) < 0.4) reached = i;
    else break;
  }
  ok(reached === pl.length - 1, `walking the Span end to end in the real physics: ${reached + 1} of ${pl.length} plates in ${(steps * DT).toFixed(0)} s`);
  // the lift tower
  const tw = Q.tower;
  const land = S.get('c2-12-landing');
  const lip = S.get('c2-12-lip');
  ok(land && lip && Math.abs(land.maxY - tw.landing.y) < 1e-6 && Math.abs(lip.maxY - tw.throat.y) < 1e-6 && tw.cage.drop > 30 && tw.cage.drop < 36, `the Lift: the landing, then ${tw.cage.drop.toFixed(0)} m down to the Throat's lip`);
  const sh = S.get(tw.shutterId);
  ok(sh && sh.minY > lip.maxY + 1.5 && sh.maxY < lip.maxY + 4, 'the shutter sits 2-3 m over the lip');
  const cm = D.movers.find((m) => m.id === tw.cage.moverId);
  ok(cm && cm.kind === 'lift' && cm.carry.anchors.length === 2 && cm.dwell >= 1e4, 'the cage is a lift that waits at the top (the director starts it) and carries two outrigger rings');
  const gb = D.movers.find((m) => m.id === Q.greatBell.moverId);
  ok(gb && gb.kind === 'pendulum' && Math.abs(gb.length * Math.sin(gb.amp) - 12) < 0.1 && gb.period === 12, 'the Great Bell swings 12 m either side of the Well, a stroke every 6 s');
  ok(D.fixtures.some((f) => f.id === Q.clappers.W.fixtureId && f.kind === 'haul') && D.fixtures.some((f) => f.id === Q.clappers.N.fixtureId && f.kind === 'haul'), 'the two clappers are haul fixtures');
  // the Well's two crossings by rope: the iron chandeliers (rim -> three rings -> the gate's sill) and the Great Bell (its crown ring to the rim and to the sill),
  // every shot inside the difficulty's aim range (a necessary condition, not a proof: no bot has crossed it)
  const A = (id) => D.anchors.find((a) => a.id === id);
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const iron = ['c2-12-iron0', 'c2-12-iron1', 'c2-12-iron2'].map(A);
  const sillBox = S.get('c2-12-sill');
  const sillPt = { x: (sillBox.minX + sillBox.maxX) / 2, y: sillBox.maxY, z: (sillBox.minZ + sillBox.maxZ) / 2 };
  const range = DIFFICULTY.normal.aimRange;
  const hops = [d3(Q.rim, iron[0]), d3(iron[0], iron[1]), d3(iron[1], iron[2]), d3(iron[2], sillPt)];
  ok(hops.every((h) => h < range), `the safe line's hops are ${hops.map((h) => h.toFixed(0)).join(', ')} m (aim range ${range} m)`);
  const great = A(Q.greatBell.ringId);
  ok(d3(Q.rim, great) < range && d3(great, sillPt) < range + 12, `the Great Bell's crown is ${d3(Q.rim, great).toFixed(0)} m from the rim and ${d3(great, sillPt).toFixed(0)} m from the sill`);
  ok(Q.clusters.length >= 10 && Q.stalls.length === 40, `${Q.clusters.length} lamp clusters for the Round, ${Q.stalls.length} stall lamps under the pulpit`);
}

console.log(fails ? `FAILED: ${fails}` : 'ALL CHAPTER II ARENA CHECKS PASS');
process.exit(fails ? 1 : 0);
