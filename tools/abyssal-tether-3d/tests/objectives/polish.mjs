// LEVEL_FUN_PLAN P6 "polish" on the real level (Node): the S6 wind squalls (sim/objectives3d.js + sim/wind3d.js: data and
// knobs per difficulty, the schedule and its sin² gust, the telegraph `lead` s before, events only near, the push on a body
// in the air inside the box and never on the ground or outside it, a hanging body swung aside, the comfort cap, the setting
// that stills them (no push, no events), snapshot / restore determinism, captions, the squall probe of every S6 line) and the
// S2 collapsing span (a crumble on Normal: it groans at the first touch and gives way after 2.25 s, Nightmare's after 0.65 s,
// none on Abyss; out of both bake hashes, the shipped lightmaps / GI still match).
//   node polish.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import fs from 'node:fs';
import { srcUrl, GAME_ROOT } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus, SETTINGS_DEFAULTS, sanitizeUxSettings } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Objectives3D, SQUALL_MAX_ACCEL } = await import(srcUrl('sim/objectives3d.js'));
const W = await import(srcUrl('sim/wind3d.js'));
const RW = await import(srcUrl('render/wind.js'));
const { captionForEvent } = await import(srcUrl('ui/captions.js'));
const { levelLmHash, LM_INDEX_NAME } = await import(srcUrl('render/lightmapFormat.js'));
const { levelGiHash, readHeader } = await import(srcUrl('render/giFormat.js'));
const { squallProbe } = await import('../../verify/machines.mjs');
const R = await import('../../verify/routes.mjs');

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = CONFIG.PHYSICS_DT;
const EVENTS = ['squall:warn', 'squall:on', 'squall:off', 'platform:strain', 'platform:crumble'];

function rig(v = 'normal', key) {
  const L = new Level3D(undefined, v);
  const bus = new EventBus();
  const ev = [];
  const d = DIFFICULTY[key || v];
  const O = new Objectives3D(L, d, bus);
  for (const t of EVENTS) bus.on(t, (e) => ev.push([t, +O.clock.toFixed(3), e]));
  const T = new TetherSystem(L, d, bus, {});
  const ph = new Physics3D(L, d, bus);
  O.physics = ph;
  ph.wind = O;
  const p = new Player3D(0, 0, 0);
  return { L, bus, ev, O, T, ph, p };
}
const at = (O, t) => {
  O.clock = t;
  O.reapply();
};
/** Steps physics + objectives for `secs` with no input. */
function run(r, secs, intent) {
  const it = intent || { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: { yank: 0 }, right: { yank: 0 } } };
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    r.ph.step(r.p, r.T, it, DT);
    r.O.step(DT, r.p, r.T, it, r.O.clock);
  }
}

// ---- the shared wind module ------------------------------------------------------------------------------------------
ok(RW.windAngle === W.windAngle && RW.windGust === W.windGust && RW.windSquall === W.windSquall, 'render/wind.js re-exports the draught from sim/wind3d.js (the view and the sim read the same functions)');

// ---- data and knobs -------------------------------------------------------------------------------------------------
{
  const want = { normal: [26, 1.2], nightmare: [20, 1.5], abyss: [15, 1.8], sandbox: [26, 1.2] };
  const rows = [];
  let good = true;
  for (const key of Object.keys(want)) {
    const v = DIFFICULTY[key].levelVariant;
    const O = new Objectives3D(new Level3D(undefined, v), DIFFICULTY[key], null);
    const q = O.squalls.find((s) => s.id === 'squall-s6');
    if (!q) {
      good = false;
      continue;
    }
    rows.push(`${key} every ${q.period} s, ${q.on} s, lead ${q.lead} s, ${q.accel} m/s²`);
    good = good && q.period === want[key][0] && q.accel === want[key][1] && q.accel <= SQUALL_MAX_ACCEL && q.on === 4 && q.lead === 2 && q.dx === 0 && q.dz === 1;
  }
  ok(good && SQUALL_MAX_ACCEL === 2, `squall-s6 knobs per difficulty (more often and a little harder): ${rows.join(' | ')}; never over ${SQUALL_MAX_ACCEL} m/s²`);
  const L = new Level3D(undefined, 'normal');
  const O = new Objectives3D(L, DIFFICULTY.normal, null);
  const q = O.squalls[0];
  const stair = L.byId['s6-safe3'];
  ok(q.section === 5 && q.minX >= -11 && stair.maxX <= q.minX, 'the squall blows down the throat (S6 east of the dividing wall); the safe stair is sheltered');
}

// ---- schedule, gust shape, telegraph, hearing --------------------------------------------------------------------------
{
  const r = rig();
  const q = r.O.squalls[0];
  // a body floating mid-throat (no gravity matters here: only the objectives step)
  r.p.reset(0, -240, 0);
  const start = q.period * (1 - q.phase) - 3; // 3 s before a gust starts
  at(r.O, start);
  let peak = 0;
  for (let i = 0; i < Math.round(8 / DT); i++) {
    r.O.step(DT, r.p, r.T, null, r.O.clock);
    peak = Math.max(peak, r.O.squallNow.k);
  }
  const warn = r.ev.find((e) => e[0] === 'squall:warn');
  const on = r.ev.find((e) => e[0] === 'squall:on');
  const off = r.ev.find((e) => e[0] === 'squall:off');
  ok(!!warn && !!on && !!off && Math.abs(on[1] - warn[1] - q.lead) < 0.01 && Math.abs(off[1] - on[1] - q.on) < 0.01, `telegraph ${warn && (on[1] - warn[1]).toFixed(2)} s before the gust (lead ${q.lead}), the gust lasts ${on && off && (off[1] - on[1]).toFixed(2)} s (on ${q.on})`);
  ok(Math.abs(peak - 1) < 1e-3 && W.squallK(q, 0) === 0 && Math.abs(W.squallK(q, q.on / 2) - 1) < 1e-9 && W.squallK(q, q.on) === 0, 'the gust is sin²-shaped: 0 at its edges, 1 at its middle (it rises and falls, never a jolt)');
  ok(W.squallRise(q, q.period - q.lead / 2) === 0.5 && W.squallRise(q, 1) === 0, 'squallNow.rise climbs 0 → 1 over the telegraph (the view and the audio swell before the push)');
  // far away: no events
  const f = rig();
  f.p.reset(-30, -100, 0);
  at(f.O, start);
  for (let i = 0; i < Math.round(8 / DT); i++) f.O.step(DT, f.p, f.T, null, f.O.clock);
  ok(f.ev.length === 0 && f.O.squallNow.k === 0, 'a player far from the throat hears nothing (events within 12 m of the box only)');
}

// ---- the push --------------------------------------------------------------------------------------------------------
{
  const r = rig();
  const q = r.O.squalls[0];
  const mid = q.period * (1 - q.phase) + q.on / 2 - 0.5; // 1 s window around the gust's peak
  at(r.O, mid);
  r.p.reset(0, -240, 0); // in the air, mid-throat
  const v0 = { x: r.p.vx, z: r.p.vz };
  let maxA = 0;
  let pvz = r.p.vz;
  for (let i = 0; i < Math.round(1 / DT); i++) {
    r.ph.step(r.p, r.T, { move: { x: 0, z: 0 }, reel: 0, hands: { left: { yank: 0 }, right: { yank: 0 } } }, DT);
    r.O.step(DT, r.p, r.T, null, r.O.clock);
    maxA = Math.max(maxA, (r.p.vz - pvz) / DT);
    pvz = r.p.vz;
  }
  const dvz = r.p.vz - v0.z;
  ok(dvz > 0.9 * q.accel * 0.8 && dvz < q.accel * 1.01 && Math.abs(r.p.vx - v0.x) < 0.05, `a body falling through the gust's peak second gains ${dvz.toFixed(2)} m/s along +z (accel ${q.accel} m/s² x the sin² gust, drag aside)`);
  ok(maxA <= SQUALL_MAX_ACCEL + 1e-6, `comfort: the push never exceeds ${SQUALL_MAX_ACCEL} m/s² (peak ${maxA.toFixed(2)})`);

  // grounded: no push (stand on the S6 throat's crumbling ledge? use the S7 landing: outside; so stand on a floor inside the box)
  const g = rig();
  at(g.O, mid);
  const ledge = g.L.byId['s6-ledge'];
  g.p.reset(4, ledge.maxY + g.p.radius + 0.001, -4);
  run(g, 0.05);
  const before = [g.p.vx, g.p.vz, g.p.grounded];
  g.O.windPush(g.p, DT); // what Physics3D would never call for a grounded body anyway
  run(g, 0.3);
  ok(before[2] && g.p.grounded && Math.abs(g.p.vz) < 1e-6 && Math.abs(g.p.vx) < 1e-6, 'a body standing on a ledge inside the box is never pushed (Physics3D asks only while not grounded)');

  // outside the box (the safe stair's air) and between gusts: none
  const o = rig();
  at(o.O, mid);
  o.p.reset(-24, -235, 0);
  run(o, 0.5);
  const b = rig();
  at(b.O, mid + q.on + 1);
  b.p.reset(0, -240, 0);
  run(b, 0.5);
  ok(Math.abs(o.p.vz) < 1e-6 && Math.abs(b.p.vz) < 1e-6, 'no push outside the box (the stair) nor between gusts');

  // switched off (Settings › Comfort › Wind squalls): no push, no events, nothing to see or hear
  const s = rig();
  s.O.setSqualls(false);
  at(s.O, q.period * (1 - q.phase) - 3);
  s.p.reset(0, -240, 0);
  let k = 0;
  for (let i = 0; i < Math.round(8 / DT); i++) {
    s.ph.step(s.p, s.T, { move: { x: 0, z: 0 }, reel: 0, hands: { left: { yank: 0 }, right: { yank: 0 } } }, DT);
    s.O.step(DT, s.p, s.T, null, s.O.clock);
    k = Math.max(k, s.O.squallNow.k, s.O.squallNow.rise, s.O.squallAt(0));
    if (!s.p.alive) break;
  }
  ok(Math.abs(s.p.vz) < 1e-6 && s.ev.filter((e) => e[0].startsWith('squall')).length === 0 && k === 0, 'setSqualls(false): no push, no squall events, squallNow stays 0 (view and audio calm)');
  ok(SETTINGS_DEFAULTS.windSqualls === true && sanitizeUxSettings({ windSqualls: false }).windSqualls === false && sanitizeUxSettings({ windSqualls: 'x' }).windSqualls === true, 'setting windSqualls: on by default, saved off stays off, junk reads as on');
}

// ---- a hanging body is swung aside; determinism ------------------------------------------------------------------------
{
  const hang = (on) => {
    const r = rig();
    r.O.setSqualls(on);
    const q = r.O.squalls[0];
    at(r.O, q.period * (1 - q.phase) - 0.5);
    const a = r.L.byId['s6-ra5'];
    r.p.reset(a.x, a.y - 8, a.z);
    const it = { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: { yank: 0, aim: null }, right: { yank: 0, aim: null } } };
    r.T.attach(r.p, 'right', a);
    let maxDz = 0;
    for (let i = 0; i < Math.round(5 / DT); i++) {
      r.ph.step(r.p, r.T, it, DT);
      r.O.step(DT, r.p, r.T, it, r.O.clock);
      maxDz = Math.max(maxDz, r.p.z - a.z);
    }
    return { maxDz, x: r.p.x, y: r.p.y, z: r.p.z, alive: r.p.alive };
  };
  let h1;
  let h0;
  try {
    h1 = hang(true);
    h0 = hang(false);
  } catch (err) {
    h1 = h0 = null;
    console.log('  (hang rig failed: ' + err.message + ')');
  }
  ok(!!h1 && h1.alive && h1.maxDz > 0.3 && h0.maxDz < 0.05, `hanging 8 m under s6-ra5 through a gust: swung ${h1 ? h1.maxDz.toFixed(2) : '?'} m along its way (still air: ${h0 ? h0.maxDz.toFixed(2) : '?'} m); the rope holds, no rotation is applied`);
  const h2 = h1 ? hang(true) : null;
  ok(!!h2 && h2.x === h1.x && h2.y === h1.y && h2.z === h1.z, 'the same start, the same gust: a bit-identical path (a pure function of the run clock)');
  // snapshot / restore: the clock rewinds the gust
  const r = rig();
  const q = r.O.squalls[0];
  at(r.O, q.period * (1 - q.phase) + 1);
  const snap = r.O.snapshot();
  const k1 = r.O.squallAt(0);
  run(r, 1);
  r.O.restore(snap);
  ok(r.O.squallAt(0) === k1 && k1 > 0, 'snapshot / restore rewinds the squall with the run clock (the bots look ahead through it)');
}

// ---- captions --------------------------------------------------------------------------------------------------------
ok(
  captionForEvent('squall:warn', {}).text === '[Wind rising from below]' && captionForEvent('squall:on', {}).text === '[A gust pushes you]' && captionForEvent('platform:strain', {}).text === '[Stone groaning underfoot]',
  'captions: [Wind rising from below] (telegraph), [A gust pushes you], [Stone groaning underfoot] (a crumbling span)',
);

// ---- the S2 collapsing span ------------------------------------------------------------------------------------------
{
  const give = (key) => {
    const v = DIFFICULTY[key].levelVariant;
    const r = rig(v, key);
    const s = r.L.byId[v === 'nightmare' ? 's2-span-nm' : 's2-span'];
    if (!s) return null;
    r.p.reset((s.minX + s.maxX) / 2, s.maxY + r.p.radius + 0.001, 0);
    let t = 0;
    while (t < 5 && s.active !== false) {
      run(r, DT);
      t += DT;
    }
    const strain = r.ev.filter((e) => e[0] === 'platform:strain');
    return { t, kind: s.kind, strain: strain.length, warnAt: strain.length ? strain[0][2].time : null, fell: r.ev.some((e) => e[0] === 'platform:crumble'), L: r.L, s };
  };
  const n = give('normal');
  const nm = give('nightmare');
  const ab = new Level3D(undefined, 'abyss');
  ok(!!n && n.kind === 'crumble' && n.fell && Math.abs(n.t - 2.25) < 0.02 && n.strain === 1 && Math.abs(n.warnAt - 2.25) < 1e-9, `Normal: the S2 span is a crumble that groans at the first touch (once, 'platform:strain' with its 2.25 s) and gives way after ${n ? n.t.toFixed(2) : '?'} s`);
  ok(!!nm && nm.fell && Math.abs(nm.t - 0.65) < 0.02 && nm.strain === 1, `Nightmare: its own span gives way after ${nm ? nm.t.toFixed(2) : '?'} s, with the same telegraph`);
  ok(!ab.byId['s2-span'] && !ab.byId['s2-span-nm'], 'Abyss: no span');
  n.L.reset();
  ok(n.s.active === true && n.s.load === 0 && !n.s.fallen, 'level.reset() (a respawn) restores the span whole');
  // out of both hashes; the shipped bakes still match the level
  const dir = `${GAME_ROOT}/assets/lighting`;
  const idx = JSON.parse(fs.readFileSync(`${dir}/${LM_INDEX_NAME}`, 'utf8'));
  const L = new Level3D(undefined, 'normal');
  const gi = readHeader(fs.readFileSync(`${dir}/gi_ch1.bin`));
  ok(!('s2-span' in idx.solids) && levelLmHash(L, Object.keys(idx.solids)) === idx.hash, 'the span is not in the lightmaps (a crumble): the lightmap hash matches the shipped bake');
  ok(gi && gi.hash === levelGiHash(L), 'the GI bake was re-baked with the span out of it: its hash matches the level');
}

// ---- the squall probe: every S6 line from 6 phases, squalls on --------------------------------------------------------
{
  const fails0 = [];
  const res = await squallProbe((v) => new Level3D(undefined, v), 'normal', R, (m) => fails0.push(m));
  const row = res && res['squall-s6'];
  const lines = row ? Object.entries(row.lines).map(([k, l]) => `${k} ${l.ok}/${l.runs} ok, pushed ${l.pushed}/${l.runs} (max ${l.maxPush} s), ${l.min}-${l.max} s`) : [];
  ok(!!row && fails0.length === 0 && row.lines.s6 && row.lines.s6.pushed > 0 && row.lines.s6safe && row.lines.s6safe.pushed === 0, `squall probe (Normal, 6 phases): ${lines.join(' | ')}${fails0.length ? ' — ' + fails0.join('; ') : ''}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
