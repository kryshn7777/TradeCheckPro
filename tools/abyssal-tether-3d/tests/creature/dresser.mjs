// THE DRESSER (sim/dresser3d.js, render/dresserView.js; docs/abyssal-tether-3d/plans/DRESSER.md): the inverse of the Mason's hunt
// gate. Checks, on the real Chapter I level with the real TetherSystem / Physics3D / Health3D / Creature3D:
//   - the gate on every difficulty (whole 0.75 / 0.70 / 0.65, spoiled below whole - 0.05, the hysteresis band keeps its state);
//   - measure -> saw -> cut: 3.0 s + 1.0 s, never faster (60 / 72 / 90 Hz frames);
//   - it never enters play within 22 m (entries >= 30 m, relocations >= 22 m) over many seeds, sections and difficulties;
//   - losing sight of the whole of you cancels a measure (a block of stone put between); a grapple shot through its body
//     staggers it for 2.5 s, cancels the measure, once per 12 s (a miss, a shot into a wall in front: nothing);
//   - at most one ring per 8 s (Abyss: rearm 4 s), Normal 14 s; never your only anchor while you stand; the cut releases the
//     rope and you fall (Level3D.reset restores the ring); 'dressed' only when whole and within 1.6 m (not spoiled, not in the
//     grace); a respawn resets it (out of play, re-enters >= 30 m with the grace); determinism (same seed = same events);
//   - THE CORRIDOR: an hp sweep 100 -> 0 -> 100 (real damage, real regen) with the Mason's gate: the Dresser hunts >= 75 (down to
//     70 by the hysteresis), neither in between, the Mason <= 35 and its 14 s scent window, never both; the regen clock (a hit to
//     50 % on Normal: it can see you again 11 s later);
//   - the view: near LOD <= 12 k triangles, far <= 4.5 k, one skinned mesh (one call) + the outline decal; glints beyond 60 m;
//   - the switch: ?dresser=off|always|on, ?hunt=always leaves it out; game.js builds neither sim nor view when off; the verify
//     harness never builds it (its baselines are untouched).
//   node dresser.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { srcUrl, SRC_DIR, TOOLS_DIR, VENDOR_THREE_URL } from '../../verify/root.mjs';
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
const { Health3D } = await import(srcUrl('sim/health3d.js'));
const { Creature3D, CREATURE_TUNING } = await import(srcUrl('sim/creature3d.js'));
const { Dresser3D, DRESSER_TUNING: T, DRESSER_DIFF, cuttable, dresserMode } = await import(srcUrl('sim/dresser3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const EV = ['dresser:measure', 'dresser:saw', 'dresser:cut', 'dresser:cancel', 'dresser:dress', 'dresser:spoiled', 'dresser:whole', 'dresser:stagger', 'dresser:appear'];
const S6 = 5;

function world({ seed = 5, diff = 'normal', gate = false } = {}) {
  const D = DIFFICULTY[diff];
  const L = new Level3D(LEVEL_DATA_3D, D.levelVariant);
  const bus = new EventBus();
  const ts = new TetherSystem(L, D, bus, {});
  const ph = new Physics3D(L, D, bus);
  const d = new Dresser3D(L, D, bus, { seed, tethers: ts });
  if (gate) d.setGate(true);
  const w = { L, bus, ts, ph, d, ev: [], frame: 0, p: null, D };
  for (const type of EV) bus.on(type, (e) => w.ev.push({ type, t: d.t, frame: w.frame, reason: e.reason || '', id: e.anchorId || '' }));
  return w;
}
/** Steps `secs` of frames (physics at 240 Hz when on), feeding hp. */
function run(w, secs, { dt = 1 / 60, physics = true, hp, until } = {}) {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) {
    if (physics) {
      const k = Math.max(1, Math.round(dt / CONFIG.PHYSICS_DT));
      for (let j = 0; j < k; j++) {
        w.ts.step(w.p, dt / k);
        w.ph.step(w.p, w.ts, {}, dt / k);
      }
    }
    if (hp !== undefined) w.d.setHp(hp);
    w.d.update(dt, w.p, 0);
    w.frame++;
    if (until && until(w)) return true;
  }
  return false;
}
const has = (w, type) => w.ev.some((e) => e.type === type);
const first = (w, type) => w.ev.find((e) => e.type === type);

/** Hangs the player under a cuttable route ring of S6 and places the Dresser on a wall 9-14 m away that sees the whole of them. */
function hang(opts = {}) {
  const sec = opts.sec ?? S6;
  const L0 = new Level3D(LEVEL_DATA_3D, DIFFICULTY[opts.diff || 'normal'].levelVariant);
  const ids = L0.anchors.filter((a) => a.section === sec && cuttable(a) && a.tag === 'route').map((a) => a.id);
  for (const id of ids) {
    const w = world(opts);
    const a = w.L.anchors.find((x) => x.id === id);
    w.p = new Player3D(a.x, a.y - 3.5, a.z);
    w.ts.attach(w.p, 'right', a);
    for (let i = 0; i < 360; i++) {
      w.ts.step(w.p, CONFIG.PHYSICS_DT);
      w.ph.step(w.p, w.ts, {}, CONFIG.PHYSICS_DT);
    }
    if (w.p.grounded || !w.ts.hands.right.rope.attached) continue;
    w.d.reset(w.p);
    for (let k = 0; k < 64; k++) {
      const r = w.d.debugPlace(w.p, (k / 64) * Math.PI * 2, 1.5);
      if (!r) continue;
      w.d._measureDist(w.p);
      if (w.d.distance >= 9 && w.d.distance <= 14 && w.d._seesWhole(w.p)) {
        w.anchor = a;
        return w;
      }
    }
  }
  return null;
}

// ---- the gate, every difficulty --------------------------------------------------------------------------------------
for (const diff of ['normal', 'nightmare', 'abyss']) {
  const whole = DRESSER_DIFF[diff].whole;
  const w = hang({ diff, gate: true, seed: 3 });
  ok(!!w, `${diff}: a hanging scene with the Dresser 9-14 m away in sight`);
  if (!w) continue;
  run(w, 0.2, { hp: 1 });
  ok(w.d.armed && w.d.state !== 'SPOILED', `${diff}: whole (hp 1.00): armed, hunting (${w.d.state})`);
  run(w, 0.5, { hp: whole - 0.03 });
  ok(w.d.armed, `${diff}: hp ${(whole - 0.03).toFixed(2)} (inside the 5-point hysteresis): still armed`);
  w.ev.length = 0;
  run(w, 0.5, { hp: whole - 0.06 });
  ok(!w.d.armed && w.d.state === 'SPOILED' && has(w, 'dresser:spoiled'), `${diff}: hp ${(whole - 0.06).toFixed(2)}: spoiled (mask turned away), 'dresser:spoiled'`);
  run(w, 0.5, { hp: whole - 0.01 });
  ok(!w.d.armed && w.d.state === 'SPOILED', `${diff}: hp ${(whole - 0.01).toFixed(2)} on the way up: still spoiled (hysteresis)`);
  w.ev.length = 0;
  run(w, 30, { hp: whole - 0.06 });
  ok(!has(w, 'dresser:measure') && !has(w, 'dresser:cut') && !w.d.caughtPlayer, `${diff}: spoiled for 30 s with a rope in its range: no measure, no cut, no dressing`);
  run(w, 0.3, { hp: whole });
  ok(w.d.armed && w.d.state !== 'SPOILED', `${diff}: hp ${whole.toFixed(2)}: whole again, armed`);
}

// ---- measure -> saw -> cut timing (never faster), at three frame rates -------------------------------------------------
{
  let minMeasure = Infinity;
  let minSaw = Infinity;
  let maxMeasure = 0;
  let cuts = 0;
  for (const dt of [1 / 60, 1 / 72, 1 / 90]) {
    for (const seed of [1, 2, 3]) {
      const w = hang({ seed });
      if (!w) continue;
      run(w, 40, { dt, until: (x) => has(x, 'dresser:cut') });
      const m = first(w, 'dresser:measure');
      const s = first(w, 'dresser:saw');
      const c = first(w, 'dresser:cut');
      if (!m || !s || !c) continue;
      cuts++;
      minMeasure = Math.min(minMeasure, s.t - m.t);
      maxMeasure = Math.max(maxMeasure, s.t - m.t);
      minSaw = Math.min(minSaw, c.t - s.t);
    }
  }
  ok(cuts >= 6, `measure -> saw -> cut happened in ${cuts}/9 runs (60, 72, 90 Hz)`);
  ok(minMeasure >= T.measureTime - 1e-6 && maxMeasure <= T.measureTime + 1 / 59, `the measure lasts ${T.measureTime} s (${minMeasure.toFixed(3)}..${maxMeasure.toFixed(3)} s), never less`);
  ok(minSaw >= T.cutTime - 1e-6, `the saw lasts ${T.cutTime} s before the ring goes (min ${minSaw.toFixed(3)} s)`);
}

// ---- never within 22 m when it enters play ---------------------------------------------------------------------------
{
  let minEntry = Infinity;
  let minReloc = Infinity;
  let entries = 0;
  let worlds = 0;
  for (const diff of ['normal', 'nightmare', 'abyss']) {
    for (const sec of [2, 3, 5]) {
      const L0 = new Level3D(LEVEL_DATA_3D, DIFFICULTY[diff].levelVariant);
      const spots = L0.anchors.filter((a) => a.section === sec).filter((_, i) => i % 3 === 0).slice(0, 6);
      spots.push(L0.sections[sec].checkpoint);
      for (let i = 0; i < spots.length; i++) {
        const w = world({ diff, seed: 100 + i * 7 + sec });
        worlds++;
        const q = spots[i];
        w.p = { x: q.x, y: q.y - (q.yaw === undefined ? 3 : 0), z: q.z, alive: true, grounded: false };
        w.d.reset(w.p);
        // the player wanders down the section: relocations happen too
        for (let f = 0; f < 60 * 25; f++) {
          w.p.y -= 0.04;
          w.d.update(1 / 60, w.p, 0);
        }
        entries += w.d.stats.spawns;
        minEntry = Math.min(minEntry, w.d.stats.minEntryDist);
        minReloc = Math.min(minReloc, w.d.stats.minRelocDist);
      }
    }
  }
  ok(entries >= worlds && worlds >= 36, `every one of ${worlds} runs entered play (${entries} entries) over 3 difficulties x S3 / S4 / S6`);
  ok(minEntry >= T.spawnMin - 1e-6, `every entry at least ${T.spawnMin} m away (closest ${minEntry.toFixed(1)} m)`);
  ok(minReloc >= T.neverWithin - 1e-6 && Math.min(minEntry, minReloc) >= 22, `every relocation at least ${T.neverWithin} m away (closest ${minReloc === Infinity ? 'none' : minReloc.toFixed(1) + ' m'})`);
}

// ---- losing sight of the whole of you cancels a measure ----------------------------------------------------------------
{
  const w = hang({ seed: 11 });
  run(w, 20, { until: (x) => has(x, 'dresser:measure') });
  const d = w.d;
  ok(d.state === 'MEASURE', 'a measure under way');
  const ex = d.x + d.nx * T.eye;
  const ey = d.y + d.ny * T.eye;
  const ez = d.z + d.nz * T.eye;
  const mx = (ex + w.p.x) / 2;
  const my = (ey + w.p.y + 0.4) / 2;
  const mz = (ez + w.p.z) / 2;
  w.L.addDecorColliders([[mx - 1.2, my - 1.6, mz - 1.2, mx + 1.2, my + 1.6, mz + 1.2]]); // a pillar between you and it
  const t0 = d.t;
  run(w, 2, { until: (x) => has(x, 'dresser:cancel') });
  const c = first(w, 'dresser:cancel');
  ok(!!c && c.reason === 'sight' && c.t - t0 <= T.losGrace + 0.05, `a pillar in the way: the measure is cancelled ('${c && c.reason}', ${c ? (c.t - t0).toFixed(2) : '-'} s)`);
  run(w, 6);
  ok(!has(w, 'dresser:cut'), 'and no ring is cut while it cannot see you');
}

// ---- a grapple shot through its body staggers it (once per 12 s) -------------------------------------------------------
{
  const w = hang({ seed: 13 });
  run(w, 20, { until: (x) => has(x, 'dresser:measure') });
  const d = w.d;
  const shoot = (aimAt, extra) => {
    const ox = w.p.x;
    const oy = w.p.y + 1.2;
    const oz = w.p.z;
    let dx = aimAt[0] - ox;
    let dy = aimAt[1] - oy;
    let dz = aimAt[2] - oz;
    const l = Math.hypot(dx, dy, dz);
    dx /= l;
    dy /= l;
    dz /= l;
    w.bus.emit('rope:shot', Object.assign({ hand: 'left', ox, oy, oz, dx, dy, dz, range: 32 }, extra));
  };
  const chest = () => [d.x + d.nx * 1.7, d.y + d.ny * 1.7, d.z + d.nz * 1.7];
  ok(d.state === 'MEASURE', 'a measure under way before the shot');
  shoot(chest());
  ok(d.state === 'STAGGER' && has(w, 'dresser:stagger'), "a shot through its body: STAGGER, 'dresser:stagger'");
  const cc = w.ev.filter((e) => e.type === 'dresser:cancel').pop();
  ok(!!cc && cc.reason === 'stagger', 'the measure is cancelled by the stagger');
  run(w, T.staggerTime - 0.1);
  ok(d.state === 'STAGGER' && !has(w, 'dresser:cut'), `it stays staggered ${T.staggerTime} s (no cut)`);
  run(w, 0.3);
  ok(d.state !== 'STAGGER', 'then it recovers');
  run(w, 2);
  const n1 = w.ev.filter((e) => e.type === 'dresser:stagger').length;
  shoot(chest());
  ok(w.ev.filter((e) => e.type === 'dresser:stagger').length === n1, 'a second shot 5 s later: no stagger (12 s cooldown)');
  run(w, T.staggerCooldown - 4.4);
  const c2 = chest();
  shoot([w.p.x - (c2[0] - w.p.x), c2[1], w.p.z - (c2[2] - w.p.z)]);
  ok(w.ev.filter((e) => e.type === 'dresser:stagger').length === n1, 'a shot the other way: nothing');
  // a block of stone in front of it: the shot hits the stone
  const c3 = chest();
  const bx = w.p.x + (c3[0] - w.p.x) * 0.5;
  const by = w.p.y + 1.2 + (c3[1] - w.p.y - 1.2) * 0.5;
  const bz = w.p.z + (c3[2] - w.p.z) * 0.5;
  w.L.addDecorColliders([[bx - 0.6, by - 0.6, bz - 0.6, bx + 0.6, by + 0.6, bz + 0.6]]);
  shoot(c3);
  ok(w.ev.filter((e) => e.type === 'dresser:stagger').length === n1, 'a shot into the stone in front of it: nothing');
  w.L.clearDecorColliders();
  shoot(chest());
  ok(w.ev.filter((e) => e.type === 'dresser:stagger').length === n1 + 1, 'after the cooldown a clean shot staggers it again');
}

// ---- at most one ring per 8 s; Normal waits longer ----------------------------------------------------------------------
for (const [diff, gap] of [
  ['abyss', T.cutGap],
  ['normal', DRESSER_DIFF.normal.rearm + T.measureTime + T.cutTime],
]) {
  const w = hang({ diff, seed: 21 });
  if (!w) {
    ok(false, `${diff}: no scene`);
    continue;
  }
  const home = { x: w.p.x, y: w.p.y, z: w.p.z };
  const cuts = [];
  w.bus.on('dresser:cut', () => cuts.push(w.d.t));
  for (let k = 0; k < 600 * 2; k++) {
    // whenever the rope is gone: hang again from the nearest sound ring by the first spot
    if (!w.ts.hands.right.rope.attached) {
      const near = w.L.anchors
        // a sound ring near the first one that you hang from in the open (by a wall it would come and dress you instead)
        .filter((a) => cuttable(a) && !/^key/.test(a.id) && Math.hypot(a.x - home.x, a.y - home.y, a.z - home.z) < 20 && !(w.d._findSurface(a.x, a.y - 3.5, a.z, 3.2, {}) < 3.2))
        .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y, a.z - home.z) - Math.hypot(b.x - home.x, b.y - home.y, b.z - home.z))[0];
      if (!near) break;
      w.p.x = near.x;
      w.p.y = near.y - 3.5;
      w.p.z = near.z;
      w.p.vx = w.p.vy = w.p.vz = 0;
      w.p.grounded = false;
      w.ts.attach(w.p, 'right', near);
    }
    // the player looks up at the ring they hang from (game.js feeds the head camera: the Dresser only hops out of view)
    const an = w.ts.hands.right.rope.anchor;
    if (an) w.d.setView(w.p.x, w.p.y + 1.2, w.p.z, an.x - w.p.x, an.y - w.p.y - 1.2, an.z - w.p.z);
    run(w, 0.1);
  }
  let minGap = Infinity;
  for (let i = 1; i < cuts.length; i++) minGap = Math.min(minGap, cuts[i] - cuts[i - 1]);
  ok(cuts.length >= 3 && minGap >= gap - 1e-6 && minGap >= T.cutGap - 1e-6, `${diff}: ${cuts.length} rings cut in 120 s, never two within ${gap} s (closest ${minGap.toFixed(2)} s)`);
}

// ---- never your only anchor while you stand ----------------------------------------------------------------------------
{
  const w = world({ seed: 31 });
  const cp = w.L.sections[S6].checkpoint;
  w.p = new Player3D(cp.x, cp.y, cp.z);
  w.d.reset(w.p);
  const rings = w.L.anchors
    .filter((a) => cuttable(a) && Math.hypot(a.x - cp.x, a.y - cp.y, a.z - cp.z) < 14)
    .sort((a, b) => Math.hypot(a.x - cp.x, a.y - cp.y, a.z - cp.z) - Math.hypot(b.x - cp.x, b.y - cp.y, b.z - cp.z));
  run(w, 1.5);
  w.ts.attach(w.p, 'right', rings[0]);
  run(w, 1);
  let placed = false;
  for (let k = 0; k < 64 && !placed; k++) {
    if (!w.d.debugPlace(w.p, (k / 64) * Math.PI * 2, 1.5)) continue;
    w.d._measureDist(w.p);
    placed = w.d.distance >= 8 && w.d.distance <= 14 && w.d._seesWhole(w.p);
  }
  ok(placed && w.p.grounded, 'standing on the S6 landing with one rope, the Dresser in sight');
  run(w, 25);
  ok(!has(w, 'dresser:measure') && !has(w, 'dresser:cut') && w.ts.hands.right.rope.attached, 'standing with one rope for 25 s: it never measures it, never cuts it');
  w.ts.attach(w.p, 'left', rings[1]);
  run(w, 30, { until: (x) => has(x, 'dresser:cut') });
  const att = (h) => w.ts.hands[h].rope.attached;
  ok(has(w, 'dresser:cut') && (att('left') || att('right')), 'with a second rope it measures and cuts one ring: the other rope still holds');
}
{
  // standing on something when the saw ends: the cut is withheld (no physics: the flag is set by hand)
  const w = hang({ seed: 41 });
  run(w, 20, { until: (x) => has(x, 'dresser:saw') });
  w.p.grounded = true;
  run(w, 2, { physics: false });
  const c = w.ev.filter((e) => e.type === 'dresser:cancel').pop();
  ok(!has(w, 'dresser:cut') && !!c && c.reason === 'grounded', `standing (one rope) as the saw ends: no cut ('${c && c.reason}')`);
}

// ---- the cut releases the rope and you fall ----------------------------------------------------------------------------
{
  const w = hang({ seed: 51 });
  let y0 = 0;
  run(w, 30, {
    until: (x) => {
      if (has(x, 'dresser:cut') && !y0) y0 = x.p.y;
      return !!y0;
    },
  });
  const a = w.anchor;
  ok(a.broken && a.cut, 'the ring is cut (anchor.broken, anchor.cut)');
  ok(!w.ts.hands.right.rope.attached, 'the rope on it let go');
  let minY = w.p.y;
  for (let i = 0; i < 60; i++) {
    run(w, 1 / 60);
    minY = Math.min(minY, w.p.y);
  }
  ok(minY < y0 - 1 || w.p.grounded, `and you fall (${(y0 - minY).toFixed(1)} m in a second)`);
  w.L.reset();
  ok(!a.broken && !a.cut, 'Level3D.reset (a respawn) restores the ring');
}

// ---- 'dressed': only whole, only within 1.6 m ---------------------------------------------------------------------------
{
  const mk = (gate, hp) => {
    const w = world({ seed: 61, gate });
    const cp = w.L.sections[S6].checkpoint;
    w.p = { x: cp.x, y: cp.y, z: cp.z, alive: true, grounded: false };
    w.d.setHp(hp);
    w.d.reset(w.p);
    w.d.debugPlace(w.p, Math.PI, 1.5);
    return w;
  };
  const putAt = (w, off) => {
    const d = w.d;
    // in front of its chest (along its facing, which lies on the wall: horizontal here), your body upright
    w.p.x = d.x + d.nx * 1.8 + d.fx * off;
    w.p.y = d.y + d.ny * 1.8 + d.fy * off - 0.35;
    w.p.z = d.z + d.nz * 1.8 + d.fz * off;
  };
  let w = mk(true, 1);
  putAt(w, 2.0);
  run(w, 0.1, { physics: false, hp: 1 });
  ok(!w.d.caughtPlayer, 'whole, 2.0 m from its body: not dressed');
  putAt(w, 1.2);
  run(w, 0.05, { physics: false, hp: 1 });
  ok(w.d.caughtPlayer && w.d.caughtCause === 'dressed' && has(w, 'dresser:dress'), "whole, 1.2 m from its body: DRESSED (cause 'dressed')");
  w = mk(true, 0.5);
  putAt(w, 0.6);
  run(w, 1, { physics: false, hp: 0.5 });
  ok(!w.d.caughtPlayer, 'not whole (hp 0.50), 0.6 m from it: never dressed');
  w = mk(false, 1);
  w.d._graceT = 2;
  putAt(w, 1.0);
  run(w, 1, { physics: false, hp: 1 });
  ok(!w.d.caughtPlayer, 'inside the entry grace: never dressed');
}

// ---- a respawn resets it ----------------------------------------------------------------------------------------------
{
  const w = hang({ seed: 71 });
  run(w, 30, { until: (x) => has(x, 'dresser:cut') });
  const cp = w.L.sections[S6].checkpoint;
  w.L.reset();
  w.ts.releaseAll(w.p, 'reset');
  w.p.reset(cp.x, cp.y, cp.z);
  w.d.onRespawn(w.p);
  ok(!w.d.inPlay && w.d.state === 'DORMANT' && !w.d.target && w.d.stats.cuts === 0, 'onRespawn: out of play, no target, stats reset');
  run(w, 1 / 60, { physics: false });
  ok(w.d.inPlay && w.d.distance >= T.spawnMin && w.d._graceT > T.grace - 0.1, `it re-enters ${w.d.distance.toFixed(1)} m away with the ${T.grace} s grace`);
}

// ---- determinism ---------------------------------------------------------------------------------------------------------
{
  const trace = (seed) => {
    const w = hang({ seed });
    run(w, 40);
    return JSON.stringify(w.ev.map((e) => [e.type, e.frame, e.reason, e.id])) + `|${w.d.x.toFixed(4)},${w.d.y.toFixed(4)},${w.d.z.toFixed(4)}`;
  };
  const a = trace(81);
  const b = trace(81);
  ok(a === b && a.length > 40, 'the same seed and inputs: the same events, frame for frame');
  const w1 = world({ seed: 1 });
  const w2 = world({ seed: 2 });
  for (const w of [w1, w2]) {
    const cp = w.L.sections[S6].checkpoint;
    w.p = { x: cp.x, y: cp.y, z: cp.z, alive: true };
    w.d.reset(w.p);
    run(w, 1 / 60, { physics: false });
  }
  ok(w1.d.x !== w2.d.x || w1.d.y !== w2.d.y, 'another seed: another entry point');
}

// ---- THE CORRIDOR: the hp sweep with the Mason's gate ------------------------------------------------------------------
{
  const D = DIFFICULTY.normal;
  const L = new Level3D(LEVEL_DATA_3D, 'normal');
  const bus = new EventBus();
  const h = new Health3D(D, bus);
  const c = new Creature3D(L, D, bus, { seed: 9 });
  c.setHuntGate(true);
  const d = new Dresser3D(L, D, bus, { seed: 9 });
  d.setGate(true);
  const cp = L.sections[S6].checkpoint;
  const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
  c.reset(p);
  c.setSection(S6, L.sections[S6], p);
  d.reset(p);
  const rows = [];
  let t = 0;
  let lowEnd = -1;
  const frame = (dt) => {
    h.step(dt);
    c.setHurt(h.low);
    c.update(dt, p, t);
    d.setHp(h.hp);
    d.setRival(c._gate && (c._armed || c._withdraw));
    d.update(dt, p, t);
    t += dt;
    if (!h.low && lowEnd < 0 && rows.length && rows[rows.length - 1].low) lowEnd = t;
    rows.push({ t, hp: h.hp, low: h.low, dr: d.armed, ms: c._armed, wd: c._withdraw, din: d.inPlay });
  };
  for (let i = 0; i < 120; i++) frame(1 / 60);
  // down: a hit of 1 point every 0.2 s down to 1 %
  const down0 = rows.length;
  while (h.hp > 0.015) {
    h.damage(0.01, 'fall', 0);
    for (let i = 0; i < 12; i++) frame(1 / 60);
  }
  const downRows = rows.slice(down0);
  // up: Normal's own regeneration (6 s, then 5 %/s), then 30 s at full health
  const up0 = rows.length;
  for (let i = 0; i < 60 * 60; i++) frame(1 / 60);
  const upRows = rows.slice(up0);
  const eps = 1e-6;
  ok(
    downRows.every((r) => r.dr === r.hp >= 0.7 - eps),
    'down: the Dresser hunts while hp >= 70 (75 - the hysteresis) and stops below',
  );
  ok(
    downRows.every((r) => r.ms === r.hp <= 0.35 + eps),
    'down: the Mason hunts only at hp <= 35',
  );
  ok(
    downRows.every((r) => !(r.hp > 0.35 + eps && r.hp < 0.7 - eps) || (!r.dr && !r.ms)),
    'down: between 35 and 70 neither hunts',
  );
  ok(rows.every((r) => !(r.dr && r.ms)), 'never both at once (the Dresser waits while the Mason has your scent)');
  {
    // and it leaves play: within T.leaveMax of the Mason arming it is gone (one big creature in view at a time)
    let since = -1;
    let bad = 0;
    for (const r of rows) {
      if (r.ms || r.wd) {
        if (since < 0) since = r.t;
        if (r.t - since > T.leaveMax + 0.1 && r.din) bad++;
      } else since = -1;
    }
    ok(bad === 0 && rows.some((r) => r.ms), `while the Mason hunts the Dresser leaves play within ${T.leaveMax} s and stays out`);
  }
  const scentEnd = upRows.find((r) => !r.ms && !r.wd);
  ok(lowEnd > 0 && !!scentEnd && Math.abs(scentEnd.t - lowEnd - CREATURE_TUNING.huntHold) < 9.2, `up: the Mason keeps your scent ${CREATURE_TUNING.huntHold} s after hp >= 50 (+ its withdraw), then leaves`);
  ok(
    upRows.every((r) => !r.dr || (r.hp >= 0.75 - eps && !r.ms && !r.wd)),
    'up: the Dresser hunts again only at hp >= 75 with the Mason gone',
  );
  ok(
    upRows.every((r) => !(r.hp >= 0.5 && r.hp < 0.75 - eps && !r.ms && !r.wd) || !r.dr),
    'up: between 50 and 75 (the scent gone) neither hunts',
  );
  ok(upRows[upRows.length - 1].dr && !upRows[upRows.length - 1].ms, 'at full health: the Dresser hunts, the Mason does not');
  // the regen clock: a single hit to 50 % on Normal, then it can see you again 6 + (75 - 50) / 5 = 11 s later
  const h2 = new Health3D(D, bus);
  const d2 = new Dresser3D(L, D, bus, { seed: 4 });
  d2.setGate(true);
  d2.reset(p);
  h2.damage(0.5, 'fall', 0);
  let t2 = 0;
  let back = -1;
  for (let i = 0; i < 60 * 20 && back < 0; i++) {
    h2.step(1 / 60);
    d2.setHp(h2.hp);
    d2.update(1 / 60, p, 0);
    t2 += 1 / 60;
    if (d2.armed) back = t2;
  }
  ok(Math.abs(back - 11) < 0.1, `the regen clock: hit to 50 % on Normal, whole again ${back.toFixed(2)} s later (6 + 25 / 5 = 11 s)`);
}

// ---- the view's budget ---------------------------------------------------------------------------------------------------
{
  const THREE = await import('three');
  const { buildDresserGeometry, DresserView, GLOW_DIST } = await import(srcUrl('render/dresserView.js'));
  const near = buildDresserGeometry(0).index.count / 3;
  const far = buildDresserGeometry(1).index.count / 3;
  ok(near <= 12000, `near LOD ${near} triangles (<= 12000)`);
  ok(far <= 4500, `far LOD ${far} triangles (<= 4500)`);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 400);
  scene.add(camera);
  const v = new DresserView({ renderer: { scene, camera } });
  const meshes = [];
  v.root.traverse((o) => o.isMesh && meshes.push(o));
  ok(v.meshes.every((m) => m.isSkinnedMesh && m.skeleton === v.skeleton && m.material === v.material), 'two LODs: skinned meshes on one skeleton and one material');
  ok(meshes.length === 3 && v.bones.length === 32, `three meshes under it (near, far, glints), ${v.bones.length} bones; the measuring line and the chalk outline are part of the skinned mesh`);
  const body = { visible: true, x: 0, y: 0, z: 0, ux: 1, uy: 0, uz: 0, fx: 0, fy: 1, fz: 0, lx: 5, ly: 1, lz: 0, walk: 0, speed: 0, measure: 0, cut: 0, stagger: 0, spoiled: 0, glow: 0.4, tick: 0, line: { on: false, x: 0, y: 0, z: 0, taut: 0 }, outline: { on: false, x: 0, y: 0, z: 0, nx: 1, ny: 0, nz: 0, grow: 0, alpha: 0, seed: 0 } };
  const game = { dresser: { isNull: false, body, targetHand: 'right' }, renderer: { scene, camera, qualityTier: 'quest' }, settings: {} };
  const drawn = () => {
    let n = 0;
    let tris = 0;
    scene.traverseVisible((o) => {
      if (o.isMesh) {
        n++;
        tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      }
    });
    return { n, tris };
  };
  camera.position.set(8, 1.8, 0);
  v.update(1 / 60, game);
  let r = drawn();
  ok(v.lod === 0 && r.n === 1 && v.info.drawCalls === 1 && v.info.triangles === near, `at 8 m: the near LOD, 1 call, ${v.info.triangles} triangles`);
  camera.position.set(35, 1.8, 0);
  v.update(1 / 60, game);
  r = drawn();
  ok(v.lod === 1 && r.n === 1 && v.info.triangles === far, `at 35 m (Quest switch ${25} m): the far LOD, 1 call, ${v.info.triangles} triangles`);
  camera.position.set(GLOW_DIST + 10, 1.8, 0);
  v.update(1 / 60, game);
  r = drawn();
  ok(r.n <= 1 && r.tris <= 4, `beyond ${GLOW_DIST} m: only the eye glints (${r.n} call, ${r.tris} triangles)`);
  body.outline.on = true;
  body.outline.alpha = 1;
  body.outline.x = 6;
  body.outline.y = 1;
  body.outline.z = 3;
  body.outline.nx = 0;
  body.outline.nz = -1;
  body.measure = 1;
  body.line.on = true;
  body.line.x = 3;
  body.line.y = 1;
  body.line.z = 2;
  camera.position.set(8, 1.8, 0);
  if (!v.outlineTex) v.outlineTex = { isStandIn: true }; // no canvas in Node: a stand-in so the outline path runs
  v.update(1 / 60, game);
  r = drawn();
  const cb = v.bones[v.bones.length - 1];
  ok(v.outline.visible && cb.scale.y === 1 && r.n === 1 && v.info.drawCalls === 1, `measuring: the body, the line to your ring and the chalk outline (its own bone, ${cb.position.length().toFixed(1)} m out) in ONE call`);
  ok(v.meshes[0].boundingSphere.radius >= cb.position.length(), 'the frustum bounds reach the outline and the ring');
  body.visible = false;
  body.outline.on = false;
  v.update(1 / 60, game);
  ok(!v.root.visible && v.info.drawCalls === 0, 'out of play: nothing drawn');
  v.dispose();
}

// ---- the switch ----------------------------------------------------------------------------------------------------------
{
  ok(dresserMode('') === 'on' && dresserMode('?foo=1') === 'on', 'no flag: on (gated by your health)');
  ok(dresserMode('?dresser=off') === 'off' && dresserMode('?sw=0&dresser=off&x=1') === 'off', '?dresser=off: off');
  ok(dresserMode('?dresser=always') === 'always', '?dresser=always: on, no health gate');
  ok(dresserMode('?hunt=always') === 'off' && dresserMode('?hunt=always&dresser=always') === 'always', '?hunt=always (the e2e, the capture tools): off unless a dresser= flag asks');
  const game = fs.readFileSync(path.join(SRC_DIR, 'game.js'), 'utf8');
  ok(/dm !== 'off' && typeof DresserCls === 'function'/.test(game) && /dresserMode\(\) === 'off'/.test(game), 'game.js builds neither the sim nor the view when it is off');
  ok(/setGate\(dm !== 'always'\)/.test(game), "game.js turns the health gate on unless ?dresser=always");
  ok(/d\.setRival\(!!\(c && !c\.isNull && \(\(c\._gate && \(c\._armed \|\| c\._withdraw\)\) \|\| c\.sighting\)\)\)/.test(game), 'game.js: it gives way to the Mason (its gate armed, withdrawing, or its staged S4 pass)');
  const verifyDir = path.join(TOOLS_DIR, 'verify');
  const usesIt = fs.readdirSync(verifyDir).filter((f) => f.endsWith('.mjs') && /dresser3d|Dresser3D/.test(fs.readFileSync(path.join(verifyDir, f), 'utf8')));
  ok(usesIt.length === 0, 'the verify harness (route bots, baselines) never builds it');
  const noDresser = world({ seed: 1 });
  const cp1 = noDresser.L.sections[0].checkpoint;
  noDresser.p = { x: cp1.x, y: cp1.y, z: cp1.z, alive: true };
  noDresser.d.reset(noDresser.p);
  run(noDresser, 5, { physics: false });
  ok(!noDresser.d.inPlay, 'S1 (no dresser data): never in play');
  const sand = new Dresser3D(new Level3D(LEVEL_DATA_3D, 'normal'), DIFFICULTY.sandbox, new EventBus(), { seed: 1 });
  ok(!sand.enabled, 'Sandbox (no predator): disabled');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
