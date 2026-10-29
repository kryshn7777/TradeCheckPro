// THE HOLDFAST (sim/holdfast3d.js, render/holdfastView.js; docs/abyssal-tether-3d/plans/CREATURE_PACING.md): the wall holds your hand.
// On the real Chapter I level with the real Physics3D / Climb3D / TetherSystem:
//   - the sites (data on the climb zones): S2 S3 S4 (answer) S5 S7 S8 resolve on every variant; never in S1 or on the first two climb
//     patches; at most 1 hold in 4 of a zone; >= 3 m from every objective; the rules reject bad data (S1, a second patch on a small
//     zone, by an objective, a chain, outside its zone);
//   - a hold let go within 0.5 s is free; then the lock: 2.0 / 2.5 / 3.0 s (Normal / Nightmare / Abyss) at 72 Hz, never shorter;
//     the hand cannot let go (grip, stretch, hop, stamina slip), the hold is drawn toward the wall at <= 0.3 m/s;
//   - LOW (<= 35 %): x1.3 longer, harder and faster squeezes (the haptic beat events);
//   - tear free (VR: >= 1.2 m/s away from the wall for 0.15 s; too slow / too short / along the wall: nothing; desktop: Back + Jump,
//     or the grip let go of for 0.4 s): -10 % hp, -0.3 grip, the hand dies (RUINED);
//   - the rope out-pulls it after 1.0 s of reeling (0.8 s: not yet), no cost; a hook shot through its forearm staggers it (it lets
//     go, no cost), a miss does nothing, a shot at a dormant patch makes it flinch (no close for 10 s);
//   - waited out: -15 % (a crushed hand); never lethal alone (a floor of 5 %) over many seeds; determinism (same input, same events);
//   - S4's answer never locks; the view: GLB triangles (LOD0 <= 3 k, LOD1 <= 0.8 k), one skinned draw per live rig, <= 2 live rigs,
//     the dormant look one InstancedMesh; ClimbView leaves the patches without chalk; ?holdfast=off builds nothing.
//   node holdfast.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { srcUrl, SRC_DIR, VENDOR_THREE_URL } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { TetherSystem, Physics3D, Player3D } = await import(srcUrl('sim/physics3d.js'));
const { Holdfast3D, HOLDFAST_TUNING: T, HOLDFAST_DIFF, resolveHoldfastSites, holdfastMode, onPatch } = await import(srcUrl('sim/holdfast3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = CONFIG.PHYSICS_DT;
const EV = ['holdfast:aware', 'holdfast:inhale', 'holdfast:breath', 'holdfast:grip', 'holdfast:close', 'holdfast:squeeze', 'holdfast:release', 'holdfast:tear', 'holdfast:crush', 'holdfast:outpull', 'holdfast:stagger', 'holdfast:flinch', 'holdfast:knock', 'holdfast:answer', 'holdfast:twitch'];

// ---- 1. the sites ---------------------------------------------------------------------------------------------------------
{
  for (const v of ['normal', 'nightmare', 'abyss']) {
    const L = new Level3D(LEVEL_DATA_3D, v);
    const r = resolveHoldfastSites(L);
    const secs = r.sites.map((s) => s.section + 1).join(',');
    ok(r.rejected.length === 0 && secs === '2,3,4,5,7,8', `${v}: every data site resolves (S${secs}), none rejected ${JSON.stringify(r.rejected)}`);
  }
  const L = new Level3D(LEVEL_DATA_3D, 'normal');
  const r = resolveHoldfastSites(L);
  const order = L.climb.slice().sort((a, b) => b.maxY - a.maxY);
  const first2 = order.slice(0, 2).map((z) => z.id);
  ok(first2.every((id) => /^c-s1-/.test(id)) && r.sites.every((s) => !first2.includes(s.zoneId) && s.section > 0), `never in S1 nor on the first two climb patches met (${first2.join(', ')})`);
  ok(r.sites.filter((s) => s.mode === 'answer').map((s) => s.section + 1).join() === '4' && r.sites.filter((s) => s.mode === 'grip').length === 5, "S4 answers (knock, and a hand answers), S2 S3 S5 S7 S8 hold");
  // 1 hold in 4: a zone's stud cells (render/climbView.js) / 4 patches
  let worst = 0;
  for (const z of L.climb) {
    const on = r.sites.filter((s) => s.zone === z);
    if (!on.length) continue;
    const lu = z.ax === 0 ? z.maxZ - z.minZ : z.maxX - z.minX;
    const lv = z.ax === 1 ? z.maxZ - z.minZ : z.maxY - z.minY;
    const cells = Math.max(1, Math.floor(lu / 0.8)) * Math.max(1, Math.floor(lv / 0.9));
    worst = Math.max(worst, on.length / cells);
  }
  ok(worst <= 0.25 + 1e-9, `at most 1 hold in 4: the worst zone has ${(worst * 100).toFixed(1)} % of its holds Holdfast`);
  // the stud grid of render/climbView.js: the patch holds at most a quarter of a zone's studs too
  const fx = LEVEL_DATA_3D.fixtures;
  let minObj = Infinity;
  for (const s of r.sites) {
    for (const f of fx) {
      const pts = [];
      if (Number.isFinite(f.x)) pts.push(f);
      const a = f.anchorId && L.byId[f.anchorId];
      if (a) pts.push(a);
      for (const p of pts) minObj = Math.min(minObj, Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z));
    }
  }
  ok(minObj >= T.minObjective, `never on an objective's critical path: every site >= ${T.minObjective} m from every objective fixture / ring (nearest ${minObj.toFixed(1)} m)`);
  ok(r.sites.every((s) => s.zone.kind !== 'chain' && !s.zone.edge), 'only authored wall zones (never the only route: the route bots never need a climb zone)');
  // the rules reject bad data
  const bad = JSON.parse(JSON.stringify({ sections: LEVEL_DATA_3D.sections.map((s) => ({ id: s.id, yTop: s.yTop, yBottom: s.yBottom, creature: {} })) }));
  const data = Object.assign({}, LEVEL_DATA_3D, { sections: LEVEL_DATA_3D.sections.map((s, i) => Object.assign({}, s, { creature: Object.assign({}, s.creature, { holdfast: bad.sections[i].creature.holdfast }) })) });
  data.sections[0].creature.holdfast = { sites: [{ id: 'x-s1', zone: 'c-s1-west', at: 0, y: -2.5 }] };
  // a small test-only zone of 2 x 2 stud cells on the S2 east wall (1.7 x 1.9 m): one patch at most; two more on c-s2-shaft too close
  data.climb = LEVEL_DATA_3D.climb.concat([{ id: 'c-test-small', kind: 'masonry', minX: 10.6, maxX: 11.05, minZ: -8.5, maxZ: -6.8, minY: -34.5, maxY: -32.6, face: 11, n: { x: -1, y: 0, z: 0 } }]);
  data.sections[1].creature.holdfast = { sites: [{ id: 'x-a', zone: 'c-test-small', at: -7.65, y: -33.55 }, { id: 'x-b', zone: 'c-test-small', at: -7.65, y: -33.0 }, { id: 'x-c', zone: 'c-s2-shaft', at: 5.7, y: -38 }, { id: 'x-d', zone: 'c-s2-shaft', at: 5.7, y: -39.2 }] };
  data.sections[3].creature.holdfast = { sites: [{ id: 'x-chain', zone: 'c-s4-chain', at: 0, y: -105 }, { id: 'x-out', zone: 'c-s4-shelf', at: -9.4, y: -112 }] };
  data.sections[4].creature.holdfast = { sites: [{ id: 'x-key', zone: 'c-s5-west', at: -1.4, y: -196.5 }] };
  const rr = resolveHoldfastSites(new Level3D(data, 'normal'));
  const why = Object.fromEntries(rr.rejected.map((x) => [x.id, x.reason]));
  ok(/tutorial/.test(why['x-s1'] || ''), `a site in S1 is rejected (${why['x-s1']})`);
  ok(rr.sites.filter((s) => s.zoneId === 'c-test-small').length === 1 && /1 hold in 4/.test(why['x-b'] || ''), `a zone of 4 holds takes one patch: the second is rejected (${why['x-b']})`);
  ok(/another patch/.test(why['x-d'] || ''), `two patches on a zone keep ${T.spacing} m apart (${why['x-d']})`);
  ok(/chain/.test(why['x-chain'] || '') && /inside/.test(why['x-out'] || ''), 'a chain and a patch outside its zone are rejected');
  ok(/objective/.test(why['x-key'] || ''), `a site by the S5 keystone is rejected (${why['x-key']})`);
}

// ---- a world: the player clinging to a site ------------------------------------------------------------------------------
function blankClimb() {
  const hand = () => ({ ok: false, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  return { vr: false, grab: { left: false, right: false }, fwd: 0, side: 0, rx: 1, rz: 0, fx: 0, fz: -1, hands: { left: hand(), right: hand() } };
}

function world({ diff = 'normal', site = 'hf-s2-east', hp = 1, vr = true, dy = vr ? -0.45 : 0 } = {}) {
  const D = DIFFICULTY[diff];
  const L = new Level3D(LEVEL_DATA_3D, D.levelVariant);
  const bus = new EventBus();
  const ts = new TetherSystem(L, D, bus, {});
  const ph = new Physics3D(L, D, bus);
  const g = new Holdfast3D(L, D, bus, { climb: ph.climb, tethers: ts });
  const s = g.sites.find((x) => x.id === site);
  // the body 0.55 m out from the patch, 0.45 m below its centre; the right palm on the centre (0.12 m off the face)
  const p = new Player3D(s.x + s.nx * 0.55, s.y + dy, s.z + s.nz * 0.55);
  p.rx = p.x;
  p.ry = p.y;
  p.rz = p.z;
  ph.health.setHp(hp);
  const it = { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: { yank: 0 }, right: { yank: 0 } }, climb: blankClimb() };
  const w = { L, bus, ts, ph, g, s, p, it, c: it.climb, cl: ph.climb, ev: [], t: 0, D, vr, input: { jump: false, back: false, reel: false } };
  for (const type of EV) bus.on(type, (e) => w.ev.push({ type, t: +w.t.toFixed(4), hand: e.hand || null, low: !!e.low, strength: e.strength || 0, reason: e.reason || '' }));
  setPalm(w, 'right', s.x + s.nx * 0.12, s.y, s.z + s.nz * 0.12, false);
  return w;
}
/** The palm at a world point (relative to the body, as the climb intent has it). */
function setPalm(w, h, x, y, z, grab) {
  const b = w.c.hands[h];
  w.c.vr = w.vr;
  b.ok = true;
  b.rx = x - w.p.x;
  b.ry = y - w.p.y;
  b.rz = z - w.p.z;
  w.c.grab[h] = grab;
}
/** One frame at `fps`: probe, physics steps, then the Holdfast (as game.js: after the physics). */
function frame(w, fps = 72) {
  const fdt = 1 / fps;
  w.cl.probe(w.p, w.c);
  let acc = fdt;
  while (acc >= DT - 1e-9) {
    w.ph.step(w.p, w.ts, w.it, DT);
    w.it.jumpPressed = false;
    acc -= DT;
  }
  w.p.rx = w.p.x;
  w.p.ry = w.p.y;
  w.p.rz = w.p.z;
  w.g.setHp(w.ph.health.hp);
  w.g.setHands(w.c.vr, w.c.hands.left, w.c.hands.right);
  w.g.setInput(w.input.jump, w.input.back, w.c.grab.left, w.c.grab.right, w.input.reel);
  w.input.jump = false;
  w.g.update(fdt, w.p);
  const d = w.g.takeDamage();
  if (d > 0) {
    w.ph.health.damage(d, 'holdfast', 0);
    w.minAfterHf = Math.min(w.minAfterHf === undefined ? 1 : w.minAfterHf, w.ph.health.hp);
  }
  w.t += fdt;
}
const run = (w, secs, fps = 72, each) => {
  const n = Math.round(secs * fps);
  for (let i = 0; i < n; i++) {
    if (each) each(w, i);
    frame(w, fps);
  }
};
const has = (w, type) => w.ev.some((e) => e.type === type);
const first = (w, type) => w.ev.find((e) => e.type === type);
const count = (w, type) => w.ev.filter((e) => e.type === type).length;
/** Grab the patch's centre with the right hand (VR) and hold: keeps the palm where it is relative to the body. */
function grab(w, h = 'right') {
  const b = w.c.hands[h];
  w.c.grab[h] = true;
  frame(w);
  return w.cl.hands[h].gripping && onPatch(w.s, w.cl.hands[h].ax, w.cl.hands[h].ay, w.cl.hands[h].az) && b.ok;
}

// ---- 2. the half-second window, the lock per difficulty ----------------------------------------------------------------
{
  const w = world();
  ok(grab(w), 'the right palm takes a hold on the patch (an ordinary climb grab)');
  run(w, 0.35);
  w.c.grab.right = false;
  run(w, 0.2);
  ok(!has(w, 'holdfast:close') && !w.cl.hands.right.gripping && has(w, 'holdfast:grip'), 'a hold let go within 0.5 s is free (the knuckles stir, nothing closes)');
}
for (const diff of ['normal', 'nightmare', 'abyss']) {
  for (const fps of [72, 90]) {
    const w = world({ diff });
    grab(w);
    run(w, 6, fps);
    const c = first(w, 'holdfast:close');
    const r = first(w, 'holdfast:crush');
    const lock = c && r ? r.t - c.t : -1;
    const want = HOLDFAST_DIFF[diff].lock;
    ok(c && Math.abs(c.t - T.closeDelay) < 0.04 && lock >= want - 1e-6 && lock < want + 0.05, `${diff} @${fps} Hz: closes ${c ? c.t.toFixed(3) : '-'} s after the grab, locks ${lock.toFixed(3)} s (want ${want})`);
  }
}
{
  // locked: letting go of the grip, stretching, hopping do nothing; the hold is drawn toward the wall at <= 0.3 m/s
  const w = world();
  grab(w);
  run(w, 0.55);
  const st = w.cl.hands.right;
  const off0 = (st.ax - w.s.x) * w.s.nx + (st.ay - w.s.y) * w.s.ny + (st.az - w.s.z) * w.s.nz;
  w.c.grab.right = false;
  w.it.jumpPressed = true;
  run(w, 0.3);
  const off1 = (st.ax - w.s.x) * w.s.nx + (st.ay - w.s.y) * w.s.ny + (st.az - w.s.z) * w.s.nz;
  ok(st.gripping && st.pinned && w.cl.pinned, 'locked: letting go of the grip and the hop do nothing (the hand is held)');
  ok(off1 < off0 && (off0 - off1) / 0.3 <= T.pull + 1e-6 && off1 >= T.pullTo - 1e-6, `the hold is drawn toward the wall: ${off0.toFixed(3)} -> ${off1.toFixed(3)} m off the face (<= ${T.pull} m/s, stops ${T.pullTo} m off it)`);
  // the stretch limit does not free it either: the palm 0.9 m along the wall from its hold
  w.c.hands.right.ry += 0.9 * w.s.vy;
  w.c.hands.right.rz += 0.9 * w.s.vz;
  w.c.hands.right.rx += 0.9 * w.s.vx;
  run(w, 0.05);
  ok(st.gripping && st.pinned, 'the stretch limit does not free a held hand');
  // stamina at 0 while held: no slip
  w.cl.stamina = 0;
  run(w, 0.05);
  ok(st.gripping && st.pinned, 'an empty grip does not slip out of it');
}

// ---- 3. LOW: harder and longer -----------------------------------------------------------------------------------------
{
  const a = world({ hp: 1 });
  grab(a);
  run(a, 4);
  const b = world({ hp: 0.3 });
  grab(b);
  run(b, 4);
  const la = first(a, 'holdfast:crush').t - first(a, 'holdfast:close').t;
  const lb = first(b, 'holdfast:crush').t - first(b, 'holdfast:close').t;
  const sa = a.ev.filter((e) => e.type === 'holdfast:squeeze');
  const sb = b.ev.filter((e) => e.type === 'holdfast:squeeze');
  const meanA = sa.reduce((x, e) => x + e.strength, 0) / sa.length;
  const meanB = sb.reduce((x, e) => x + e.strength, 0) / sb.length;
  ok(Math.abs(lb / la - T.lowLock) < 0.03 && first(b, 'holdfast:close').low, `LOW (hp 30 %): the lock is x${(lb / la).toFixed(2)} (${la.toFixed(2)} -> ${lb.toFixed(2)} s)`);
  ok(meanB > meanA * 1.25 && sb.length / lb > sa.length / la, `LOW squeezes harder (${meanA.toFixed(2)} -> ${meanB.toFixed(2)}) and faster (${(sa.length / la).toFixed(2)} -> ${(sb.length / lb).toFixed(2)} beats/s): the haptic beats`);
  // a bite while held makes it LOW mid-lock: longer
  const c = world({ hp: 0.6 });
  grab(c);
  run(c, 1.0);
  c.ph.health.damage(0.3, 'skitter', 0);
  run(c, 4);
  const lc = first(c, 'holdfast:crush').t - first(c, 'holdfast:close').t;
  ok(Math.abs(lc - HOLDFAST_DIFF.normal.lock * T.lowLock) < 0.05, `going LOW while held extends the lock (${lc.toFixed(2)} s)`);
}

// ---- 4. tear free ------------------------------------------------------------------------------------------------------
/** A yank of the right palm: `speed` m/s along (dx, dy, dz) (in the wall's frame: n = away from the wall) for `secs`. */
function yank(w, speed, secs, along = 'n') {
  const s = w.s;
  const d = along === 'n' ? [s.nx, s.ny, s.nz] : [s.vx, s.vy, s.vz];
  const h = w.c.hands.right;
  run(w, secs, 72, () => {
    h.rx += (d[0] * speed) / 72;
    h.ry += (d[1] * speed) / 72;
    h.rz += (d[2] * speed) / 72;
  });
}
{
  const w = world();
  grab(w);
  run(w, 0.7);
  const hp0 = w.ph.health.hp;
  const g0 = w.cl.stamina;
  yank(w, 1.45, 0.25);
  const tr = first(w, 'holdfast:tear');
  ok(tr && !w.cl.hands.right.gripping && w.g.sites.find((x) => x.id === 'hf-s2-east').state === 'RUINED', 'VR: a real arm pull (1.45 m/s away from the wall for 0.25 s) tears the hand free: it dies (RUINED)');
  ok(Math.abs(hp0 - w.ph.health.hp - T.tearHp) < 1e-6 && Math.abs(g0 - w.cl.stamina - T.tearGrip) < 0.05, `the tear costs ${((hp0 - w.ph.health.hp) * 100).toFixed(1)} % hp and ${(g0 - w.cl.stamina).toFixed(2)} grip`);
  run(w, 10);
  ok(!has(w, 'holdfast:crush') && count(w, 'holdfast:close') === 1, 'a ruined hand never closes again');
  for (const [sp, secs, along, label] of [
    [1.0, 0.4, 'n', 'too slow (1.0 m/s)'],
    [1.6, 0.08, 'n', 'too short (0.08 s)'],
    [1.6, 0.4, 'v', 'along the wall'],
  ]) {
    const q = world();
    grab(q);
    run(q, 0.6);
    yank(q, sp, secs, along);
    run(q, 0.1);
    ok(!has(q, 'holdfast:tear') && q.cl.hands.right.pinned, `no tear: ${label}`);
  }
}
{
  // desktop: Back + Jump, or the grip let go of for 0.4 s
  const w = world({ vr: false });
  w.c.vr = false;
  w.c.grab.right = true;
  run(w, 0.8);
  ok(has(w, 'holdfast:close') && w.cl.pinned, 'desktop: the cling over the patch closes after 0.5 s');
  w.c.fwd = -1;
  w.input.back = true;
  w.input.jump = true;
  w.it.jumpPressed = true;
  frame(w);
  ok(has(w, 'holdfast:tear') && !w.cl.holding, 'desktop: Back + Jump tears free (the same cost)');
  const q = world({ vr: false });
  q.c.vr = false;
  q.c.grab.right = true;
  run(q, 0.8);
  q.c.grab.right = false;
  run(q, 0.3);
  q.c.grab.right = true;
  run(q, 0.3);
  ok(!has(q, 'holdfast:tear') && q.cl.pinned, 'desktop: F let go of for 0.3 s and taken again: still held');
  q.c.grab.right = false;
  run(q, 0.45);
  ok(has(q, 'holdfast:tear') && !q.cl.holding, 'desktop: F let go of for 0.4 s tears free');
}

// ---- 5. the rope, the hook shot -------------------------------------------------------------------------------------------
{
  const w = world();
  grab(w);
  run(w, 0.6);
  w.input.reel = true;
  run(w, 0.8);
  ok(!has(w, 'holdfast:outpull') && w.cl.pinned, 'reeling a loaded rope for 0.8 s: still held');
  run(w, 0.25);
  const hp = w.ph.health.hp;
  ok(has(w, 'holdfast:outpull') && !w.cl.hands.right.gripping && hp === 1, 'reeling for 1.0 s: the rope out-pulls it, no cost');
  const s = w.g.sites.find((x) => x.id === 'hf-s2-east');
  ok(s.state !== 'RUINED' && s.cd > 0, 'the out-pulled hand lives (retracts, cooldown)');
}
{
  const w = world();
  grab(w);
  run(w, 0.7);
  const s = w.s;
  // a miss: fired along the wall, above it
  w.bus.emit('rope:shot', { hand: 'left', ox: s.x + s.nx * 0.6, oy: s.y + 1.5, oz: s.z + s.nz * 0.6, dx: 0, dy: 1, dz: 0, range: 30 });
  run(w, 0.05);
  ok(!has(w, 'holdfast:stagger') && w.cl.pinned, 'a hook shot that misses the forearm does nothing');
  // through the forearm: from the left hand toward the socket's mouth
  const ox = s.x + s.nx * 0.5 - s.vx * 0.3;
  const oy = s.y + s.ny * 0.5 - s.vy * 0.3;
  const oz = s.z + s.nz * 0.5 - s.vz * 0.3;
  const tx = s.x + s.nx * 0.08;
  const ty = s.y + s.ny * 0.08;
  const tz = s.z + s.nz * 0.08;
  const l = Math.hypot(tx - ox, ty - oy, tz - oz);
  w.bus.emit('rope:shot', { hand: 'left', ox, oy, oz, dx: (tx - ox) / l, dy: (ty - oy) / l, dz: (tz - oz) / l, range: 30 });
  run(w, 0.05);
  ok(has(w, 'holdfast:stagger') && !w.cl.hands.right.gripping && w.ph.health.hp === 1 && first(w, 'holdfast:release').reason === 'shot', 'a hook shot through its forearm staggers it: it lets go, no cost');
  // a dormant patch shot: it flinches, and does not close for flinchCd
  const q = world();
  const s2 = q.s;
  q.bus.emit('rope:shot', { hand: 'left', ox: s2.x + s2.nx * 2, oy: s2.y, oz: s2.z + s2.nz * 2, dx: -s2.nx, dy: -s2.ny, dz: -s2.nz, range: 30 });
  grab(q);
  run(q, 2);
  ok(has(q, 'holdfast:flinch') && !has(q, 'holdfast:close'), 'a shot at a dormant patch: it flinches and does not close (the patch is safe for a while)');
}

// ---- 6. never lethal alone; determinism; S4 answers ----------------------------------------------------------------------
{
  let minHp = 1;
  let n = 0;
  for (let k = 0; k < 40; k++) {
    const hp = 0.04 + (k % 10) * 0.025;
    const w = world({ hp, diff: ['normal', 'nightmare', 'abyss'][k % 3] });
    grab(w);
    if (k % 2) {
      run(w, 0.7);
      yank(w, 1.5, 0.3);
    } else run(w, 5);
    // (a fall after it lets go is the fall's doing: what the Holdfast took is measured right after its own damage)
    const after = w.minAfterHf === undefined ? hp : w.minAfterHf;
    minHp = Math.min(minHp, after);
    if (after > 0 && after >= Math.min(hp, T.hpFloor) - 1e-9) n++;
  }
  ok(n === 40 && minHp > 0, `never lethal alone: 40 runs from 4-26 % hp, crushes and tears: the lowest hp it left ${(minHp * 100).toFixed(1)} % (floor ${T.hpFloor * 100} %)`);
  const a = world({ diff: 'nightmare' });
  const b = world({ diff: 'nightmare' });
  for (const w of [a, b]) {
    grab(w);
    run(w, 1.4);
    yank(w, 1.3, 0.3);
    run(w, 8);
    w.c.grab.right = false;
    run(w, 0.5);
  }
  ok(JSON.stringify(a.ev) === JSON.stringify(b.ev) && a.ev.length > 5, `determinism: the same input gives the same ${a.ev.length} events`);
  const s4 = world({ site: 'hf-s4-answer' });
  grab(s4);
  run(s4, 4);
  ok(has(s4, 'holdfast:answer') && count(s4, 'holdfast:knock') === 3 && !has(s4, 'holdfast:close') && s4.ph.health.hp === 1, 'S4: a hand on the patch is answered (three knocks, the open hand), never locked, no cost');
}

// ---- 7. the view: the GLB's budget, the rigs, the dormant look, the studs, the switch -----------------------------------------
{
  const MODELS = path.join(SRC_DIR, '..', 'assets', 'models');
  const glb = path.join(MODELS, 'holdfast.glb');
  ok(fs.existsSync(glb), 'assets/models/holdfast.glb is there');
  if (fs.existsSync(glb)) {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.pluginCallbacks.unshift(() => ({ name: 'noTex', loadTexture: () => Promise.resolve(null) }));
    const buf = fs.readFileSync(glb);
    const js = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
    ok((js.extensionsRequired || []).includes('KHR_texture_basisu') && (js.extensionsUsed || []).includes('EXT_meshopt_compression'), `holdfast.glb: meshopt geometry + KTX2 textures (${(buf.length / 1e6).toFixed(2)} MB)`);
    ok(buf.length < 3.5e6, `small: ${(buf.length / 1e6).toFixed(2)} MB < 3.5 MB`);
    const gltf = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
    const tris = (o) => (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    const meshes = {};
    gltf.scene.traverse((o) => {
      if (o.isMesh) meshes[o.name] = o;
    });
    const l0 = Object.values(meshes).find((o) => o.isSkinnedMesh && /LOD0/.test(o.name));
    const l1 = Object.values(meshes).find((o) => o.isSkinnedMesh && /LOD1/.test(o.name));
    const dm = Object.values(meshes).find((o) => !o.isSkinnedMesh && /Dormant/.test(o.name));
    ok(l0 && l1 && dm && tris(l0) <= 3000 && tris(l0) >= 1800 && tris(l1) <= 800 && tris(dm) <= 3000, `LOD0 ${l0 && tris(l0)} tris (<= 3 k), LOD1 ${l1 && tris(l1)} (<= 0.8 k), the dormant copy ${dm && tris(dm)}`);
    const bones = new Set();
    l0.skeleton.bones.forEach((b) => bones.add(b.name));
    const need = ['socket', 'forearm', 'hand', 'thumb_1', 'thumb_3'].concat(['index', 'middle', 'ring', 'pinky'].flatMap((f) => [1, 2, 3, 4].map((k) => `${f}_${k}`)));
    ok(need.every((b) => bones.has(b)), `the skeleton: ${bones.size} bones (socket, forearm, hand, 4 fingers x 4 (one knuckle too many), thumb x 3)`);
    const clips = gltf.animations.map((c) => c.name).sort().join(',');
    ok(['answer', 'close', 'dead', 'idle', 'pull', 'reach', 'release', 'retract', 'squeeze', 'stir'].every((c) => clips.includes(c)), `ten clips authored in code: ${clips}`);
    ok(l0.material === l1.material && !Array.isArray(l0.material) && l0.geometry.attributes.color, 'one material (one call per LOD), vertex-colour AO');
    // the view with a fake game: a site held, another awake, the rest dormant
    const { HoldfastView, HOLDFAST_VIEW } = await import(srcUrl('render/holdfastView.js'));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const w = world();
    const game = { renderer: { scene, camera }, holdfast: w.g, player: w.p, state: 'playing', settings: { qualityTier: 'quest' } };
    const v = new HoldfastView(game);
    v.build(gltf);
    grab(w);
    run(w, 0.8);
    camera.position.set(w.s.x + w.s.nx * 0.6, w.s.y + 0.4, w.s.z + w.s.nz * 0.6);
    camera.updateMatrixWorld(true);
    v.update(1 / 72, game);
    ok(v.info.live === 1 && v.info.drawCalls === 1 && v.info.lod[0] === 0 && v.info.triangles === tris(l0), `held at arm's length: 1 live rig at LOD0, ${v.info.drawCalls} draw call, ${v.info.triangles} triangles (x2 eyes)`);
    // posing ran: the palm is near the held hand
    const rig = v.rigs.find((r) => r.site === w.g.held);
    rig.root.updateMatrixWorld(true);
    const hand = rig.bones.hand.getWorldPosition(new THREE.Vector3());
    const st = w.cl.hands.right;
    const dd = hand.distanceTo(new THREE.Vector3(st.ax, st.ay, st.az));
    ok(dd < 0.14, `the IK puts its wrist ${dd.toFixed(3)} m from the held hand (the palm closes over it)`);
    // far: the camera 30 m away -> the dormant look (one instanced call), no rig
    for (const r of v.rigs) r.site = null;
    w.g.reset(w.p);
    camera.position.set(w.s.x + w.s.nx * 30, w.s.y, w.s.z + w.s.nz * 30);
    camera.updateMatrixWorld(true);
    v.update(1 / 72, game);
    ok(v.info.live === 0 && v.info.dormant >= 1 && v.info.drawCalls === 1, `30 m away: no live rig, the dormant look is ${v.info.drawCalls} instanced call for ${v.info.dormant} site(s)`);
    ok(v.rigs.length === HOLDFAST_VIEW.maxLive && HOLDFAST_VIEW.maxLive === 2, 'at most 2 live rigs');
    v.dispose();
  }
  // ClimbView leaves the patches without chalk (the knuckles are the studs)
  {
    const THREE = await import('three');
    const { ClimbView } = await import(srcUrl('render/climbView.js'));
    const L = new Level3D(LEVEL_DATA_3D, 'normal');
    const cv = new ClimbView({ renderer: { scene: new THREE.Scene() }, level: L });
    const sites = resolveHoldfastSites(L).sites;
    let inside = 0;
    const m = new THREE.Matrix4();
    const pp = new THREE.Vector3();
    for (const e of cv.meshes) {
      for (let i = 0; i < e.mesh.count; i++) {
        e.mesh.getMatrixAt(i, m);
        pp.setFromMatrixPosition(m);
        for (const s of sites) if (Math.abs((pp.x - s.x) * s.nx + (pp.y - s.y) * s.ny + (pp.z - s.z) * s.nz) < 0.2 && onPatch(s, pp.x, pp.y, pp.z)) inside++;
      }
    }
    ok(inside === 0, `ClimbView: ${cv.skipped} chalk studs left out on the ${sites.length} patches, none inside one (the knuckles are the studs)`);
    cv.dispose();
  }
  ok(holdfastMode('?holdfast=off') === 'off' && holdfastMode('?hunt=always') === 'off' && holdfastMode('?hunt=always&holdfast=on') === 'on' && holdfastMode('') === 'on', '?holdfast=off|on; ?hunt=always leaves it out');
  const game = fs.readFileSync(path.join(SRC_DIR, 'game.js'), 'utf8');
  ok(/holdfastMode\(\) !== 'off' && typeof HoldfastCls === 'function'/.test(game) && /holdfastMode\(\) === 'off'/.test(game), 'game.js builds neither the sim nor the view when it is off');
  ok(/h\.damage\(dmg, 'holdfast', 0\)/.test(game) && /_updateHoldfast\(dt\)/.test(game), 'game.js steps it with the creatures and takes its damage like a bite');
}

console.log(fails ? `\n${fails} HOLDFAST CHECK(S) FAILED` : '\nTHE HOLDFAST: all checks pass');
process.exitCode = fails ? 1 : 0;
