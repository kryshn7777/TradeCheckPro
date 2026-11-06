// PUZZLE FOCUS (docs/abyssal-tether-3d/plans/PUZZLE_FOCUS.md): the camera beat (sim/focusBeat.js), the trigger (sim/puzzleFocus.js), the radio
// integration (CommsDirector.focus) and the glue's modes (puzzleFocusGlue.js), in Node.
//   - the beat: IDLE -> TURN (0.8 s, smoothstep, never linear) -> HOLD (1.5 s, or the line's hold) -> RELEASE -> IDLE; the shortest yaw arc
//     across +-pi; the pitch clamped; any look input cancels the pan at once and it never resumes; an unsafe frame cancels it; already
//     looking (< 12 degrees) never pans; a headset NEVER gets a look delta; no snap back after the release; no allocation per update
//   - the trigger: first sight (range + line of sight, or within 6 m), occluded and far = no beat, the nudge 40 s later, the hint step on the
//     20 s highlight's rising edge, each step once per puzzle per run (a death keeps it), the 25 s cooldown, the glance once per puzzle
//     (again only 120 s later and still pending), busy / not playing = nothing, the current section + its neighbour only; a new run resets
//   - the line: deterministic per (seed, puzzle, step, run); the signal arc (an uplink voice needs the signal, a deep section speaks local)
//   - the radio: a focus line goes through the shipped director: one transmission at a time, never overlapping, below a story line, once
//     per run, never during danger
//   - the glue: ?focus=off|cues, the setting, Reduced effects = cues; the setting's default and sanitising; the Chapter I / II puzzle types
//   node focus-beat.mjs [--root DIR]
import { spawnSync } from 'node:child_process';
import { srcUrl } from '../../verify/root.mjs';

const FB = await import(srcUrl('sim/focusBeat.js'));
const PF = await import(srcUrl('sim/puzzleFocus.js'));
const TXT = await import(srcUrl('data/puzzle-focus-text.js'));
const CM = await import(srcUrl('sim/comms3d.js'));
const CFG = await import(srcUrl('sim/config3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

// ---- a desktop look the beat drives (what Game._setLook does: the rig yaw and the camera pitch) ----
function rig(yaw, pitch) {
  return { yaw, pitch };
}
function inp(r, tx, ty, tz, o) {
  return Object.assign({ yaw: r.yaw, pitch: r.pitch, ex: 0, ey: 0, ez: 0, tx, ty, tz, safe: true, xr: false }, o || {});
}
function apply(r, b) {
  r.yaw += b.dYaw;
  r.pitch += b.dPitch;
}

// ================================================================= the beat =================================================================
{
  // a fixture straight behind and a little below: yaw pi, pitch -atan(2/10)
  const b = new FB.FocusBeat();
  const r = rig(0, 0);
  const T = { x: 0, y: -2, z: 10 };
  const ty = FB.yawTo(0, 0, T.x, T.z);
  ok(near(Math.abs(ty), Math.PI), `yawTo: a target behind (+z) is yaw +-pi (${ty.toFixed(3)})`);
  const pan = b.start(T.x, T.y, T.z, { yaw: r.yaw, pitch: r.pitch, ex: 0, ey: 0, ez: 0, pan: true });
  ok(pan && b.state === FB.TURN && b.lookTarget.on, 'start: TURN, panning, the look target on');
  const trace = [];
  let t = 0;
  let turnEnd = -1;
  let rolled = false;
  while (b.active && t < 5) {
    b.update(DT, inp(r, T.x, T.y, T.z));
    if (b.dYaw !== b.dYaw || b.dPitch !== b.dPitch) rolled = true;
    apply(r, b);
    t += DT;
    trace.push({ t, yaw: r.yaw, pitch: r.pitch, st: b.state });
    if (turnEnd < 0 && b.state === FB.HOLD) turnEnd = t;
  }
  ok(near(turnEnd, FB.TURN_T, 1.5 * DT), `TURN lasts ${FB.TURN_T} s (HOLD from ${turnEnd.toFixed(3)} s)`);
  const at = (s) => trace.reduce((a, x) => (Math.abs(x.t - s) < Math.abs(a.t - s) ? x : a), trace[0]);
  const frac = (s) => Math.abs(FB.wrapAngle(at(s).yaw)) / Math.PI;
  ok(near(frac(0.4), 0.5, 0.04) && frac(0.2) < 0.2 && frac(0.6) > 0.8, `eased, never linear: at 25 / 50 / 75 % of the turn ${(frac(0.2) * 100).toFixed(0)} / ${(frac(0.4) * 100).toFixed(0)} / ${(frac(0.6) * 100).toFixed(0)} % of the angle (smoothstep 16 / 50 / 84)`);
  const tp = FB.pitchTo(0, 0, 0, T.x, T.y, T.z);
  const endTurn = at(FB.TURN_T);
  ok(near(Math.abs(FB.wrapAngle(endTurn.yaw)), Math.PI, 0.02) && near(endTurn.pitch, tp, 0.02), `the turn ends on the target (yaw ${endTurn.yaw.toFixed(3)}, pitch ${endTurn.pitch.toFixed(3)} vs ${tp.toFixed(3)})`);
  const holdT = trace.filter((x) => x.st === FB.HOLD).length * DT;
  ok(near(holdT, FB.HOLD_T, 2 * DT), `HOLD ${holdT.toFixed(2)} s (${FB.HOLD_T} s)`);
  const rel = trace.filter((x) => x.st === FB.RELEASE);
  ok(rel.length > 0 && rel.every((x) => near(x.yaw, rel[0].yaw, 1e-9)) && near(Math.abs(FB.wrapAngle(rel[rel.length - 1].yaw)), Math.PI, 0.02), 'RELEASE drives nothing and the view stays on the target (no snap back)');
  ok(!b.active && !b.lookTarget.on && b.glow === 0 && !rolled, `IDLE after ${t.toFixed(2)} s (turn + hold + ${FB.RELEASE_T} s release), the target off; only yaw and pitch ever change (no roll output exists)`);
  let maxRate = 0;
  for (let i = 1; i < trace.length; i++) maxRate = Math.max(maxRate, Math.abs(FB.wrapAngle(trace[i].yaw - trace[i - 1].yaw)) / DT);
  ok(maxRate < (1.6 * Math.PI) / FB.TURN_T, `the fastest moment of a 180 degree glance: ${maxRate.toFixed(2)} rad/s (smoothstep peak 1.5 x angle / time)`);
}
{
  // the shortest arc across +-pi: from yaw 3.0 to a target at yaw -3.0 goes UP through pi (0.28 rad), never round through 0 (6 rad)
  const b = new FB.FocusBeat();
  const r = rig(3.0, 0);
  const T = { x: -Math.sin(-3.0) * 10, y: 0, z: -Math.cos(-3.0) * 10 };
  b.start(T.x, T.y, T.z, { yaw: r.yaw, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true });
  let minYaw = Infinity;
  let maxYaw = -Infinity;
  for (let i = 0; i < 60; i++) {
    b.update(DT, inp(r, T.x, T.y, T.z));
    apply(r, b);
    minYaw = Math.min(minYaw, r.yaw);
    maxYaw = Math.max(maxYaw, r.yaw);
  }
  ok(minYaw >= 3.0 - 1e-9 && near(maxYaw - 3.0, 2 * Math.PI - 6, 0.01) && near(FB.wrapAngle(r.yaw), -3.0, 0.01), `shortest arc across +-pi: 3.0 -> -3.0 turns +${(maxYaw - 3).toFixed(3)} rad (never through 0)`);
  // and the other way, from an unwrapped rig yaw (the rig accumulates turns: 7 rad)
  const b2 = new FB.FocusBeat();
  const r2 = rig(7, 0);
  const T2 = { x: -Math.sin(6.5) * 10, y: 0, z: -Math.cos(6.5) * 10 };
  b2.start(T2.x, T2.y, T2.z, { yaw: r2.yaw, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true });
  for (let i = 0; i < 60; i++) {
    b2.update(DT, inp(r2, T2.x, T2.y, T2.z));
    apply(r2, b2);
  }
  ok(near(r2.yaw, 6.5, 0.01), `an unwrapped rig yaw (7 rad) turns the short way to 6.5 (${r2.yaw.toFixed(3)})`);
  ok(FB.pitchTo(0, 0, 0, 0, -50, 1) === -FB.PITCH_MAX && FB.pitchTo(0, 0, 0, 0.1, 50, 0) === FB.PITCH_MAX, `the pitch is clamped to +-${FB.PITCH_MAX} rad (inside the desktop look limit, so never clamped there: no false cancel)`);
}
{
  // any look input cancels at once and gracefully: the pan stops, the beat (line, glow) carries on, it never pans again
  const b = new FB.FocusBeat();
  const r = rig(0, 0);
  const T = { x: 10, y: 0, z: 0 };
  b.start(T.x, T.y, T.z, { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true });
  for (let i = 0; i < 12; i++) {
    b.update(DT, inp(r, T.x, T.y, T.z));
    apply(r, b);
  }
  const mid = r.yaw;
  r.yaw += 0.03; // the mouse moved
  b.update(DT, inp(r, T.x, T.y, T.z));
  const afterInput = { d: b.dYaw, pan: b.pan, why: b.cancelled, st: b.state };
  let anyDelta = false;
  while (b.active) {
    b.update(DT, inp(r, T.x, T.y, T.z));
    if (b.dYaw !== 0 || b.dPitch !== 0) anyDelta = true;
    apply(r, b);
  }
  ok(mid !== 0 && afterInput.d === 0 && !afterInput.pan && afterInput.why === 'input' && afterInput.st === FB.TURN, 'mouse input mid-turn: the pan stops that frame (cancelled: input), the beat carries on');
  ok(!anyDelta && near(r.yaw, mid + 0.03, 1e-12), 'after a cancel no look delta ever again; the player keeps their look');
  // a pitch input (touch drag up) cancels the same way
  const c = new FB.FocusBeat();
  const r3 = rig(0, 0);
  c.start(0, 5, -10, { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true });
  c.update(DT, inp(r3, 0, 5, -10));
  apply(r3, c);
  r3.pitch -= 0.01;
  c.update(DT, inp(r3, 0, 5, -10));
  ok(!c.pan && c.cancelled === 'input' && c.dPitch === 0, 'a pitch drag cancels it too');
  // unsafe (a fall, a wind-up) cancels
  const u = new FB.FocusBeat();
  const r4 = rig(0, 0);
  u.start(10, 0, 0, { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true });
  u.update(DT, inp(r4, 10, 0, 0));
  apply(r4, u);
  u.update(DT, inp(r4, 10, 0, 0, { safe: false }));
  ok(!u.pan && u.cancelled === 'unsafe' && u.dYaw === 0, 'an unsafe frame (a fall, a fast swing, a wind-up) cancels the pan');
}
{
  // already looking at it (< 12 degrees): no pan, the cues only
  const b = new FB.FocusBeat();
  const T = { x: -Math.sin(0.15) * 10, y: 0, z: -Math.cos(0.15) * 10 };
  const pan = b.start(T.x, T.y, T.z, { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true });
  ok(!pan && b.skipped === 'looking' && b.active && b.lookTarget.on, 'looking within 12 degrees (8.6 here): no pan, the beat still runs (line, glow)');
  const b2 = new FB.FocusBeat();
  const T2 = { x: -Math.sin(0.3) * 10, y: 0, z: -Math.cos(0.3) * 10 };
  ok(b2.start(T2.x, T2.y, T2.z, { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true }), 'at 17 degrees it pans');
  ok(near(FB.viewAngleTo(0, 0, 0, 0, 0, 0, 0, -5), 0) && near(FB.viewAngleTo(0, 0, 0, 0, 0, 0, 0, 5), Math.PI) && near(FB.viewAngleTo(0, 0.5, 0, 0, 0, 0, Math.sin(0.5), -Math.cos(0.5)), 0, 1e-6), 'viewAngleTo: ahead 0, behind pi, pitched view matches');
}
{
  // THE HEADSET: never a look delta, from start to IDLE, even when the caller asks for a pan; the gaze guide only
  const b = new FB.FocusBeat();
  const r = rig(0.3, 0);
  const pan = b.start(0, -3, 12, { yaw: 0.3, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true, xr: true });
  let any = false;
  let glowMax = 0;
  let n = 0;
  while (b.active && n < 1000) {
    b.update(DT, inp(r, 0, -3, 12, { xr: true }));
    if (b.dYaw !== 0 || b.dPitch !== 0) any = true;
    glowMax = Math.max(glowMax, b.glow);
    n++;
  }
  ok(!pan && b.skipped === 'xr' && !any && glowMax === 1 && r.yaw === 0.3, `VR: no pan, ${n} frames and not one look delta; the gaze guide (glow ${glowMax}, the look target) is all it gets`);
  // a headset put on mid-beat: the pan stops at once
  const c = new FB.FocusBeat();
  const r2 = rig(0, 0);
  c.start(10, 0, 0, { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true });
  c.update(DT, inp(r2, 10, 0, 0));
  apply(r2, c);
  c.update(DT, inp(r2, 10, 0, 0, { xr: true }));
  ok(!c.pan && c.dYaw === 0 && c.cancelled === 'xr', 'entering VR mid-pan stops it that frame');
  const h = new FB.FocusBeat();
  h.start(1, 0, 0, { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, pan: true, hold: 3.2 });
  let ht = 0;
  const r5 = rig(0, 0);
  while (h.active) {
    h.update(DT, inp(r5, 1, 0, 0));
    apply(r5, h);
    if (h.state === FB.HOLD) ht += DT;
  }
  ok(near(ht, 3.2, 2 * DT), `a longer line holds the glance longer (${ht.toFixed(2)} s for a 3.2 s line)`);
}

// ================================================================= the trigger ===============================================================
/** A small Objectives3D double: section 0 a bell at (0, 0, -10), section 1 a haul ring at (0, -40, -5); a nook in section 1. */
function world(opt) {
  const o = opt || {};
  const fixtures = [
    { id: 'bell-s1', kind: 'bell', x: 0, y: 0, z: -10, anchor: null },
    { id: 'cw-s2', kind: 'haul', x: 0, y: -40, z: -5, anchor: { x: 0, y: -40, z: -5 } },
  ];
  const fxDone = [false, false];
  const O = {
    objectives: [
      { id: 'obj-s1', index: 0, section: 0, seal: 0, fx: [0] },
      { id: 'obj-s2', index: 1, section: 1, seal: 1, fx: [1] },
    ],
    fixtures,
    done: [false, false],
    sealOpen: [false, false],
    seals: [],
    nooks: [{ id: 'nook-s4', section: 1, cx: 8, cy: -40, cz: 0, lure: false, fixture: -1 }],
    fixtureDone: (i) => fxDone[i],
    _fxDone: fxDone,
  };
  const L = {
    sections: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
    blocked: !!o.blocked,
    rays: 0,
    segmentBlocked() {
      this.rays++;
      return this.blocked;
    },
    sectionIndexAt: (y) => (y > -20 ? 0 : 1),
  };
  return { O, L };
}
const ctxOf = (o) => Object.assign({ playing: true, busy: false, section: 0, ex: 0, ey: 0, ez: 0, signal: 1, hintOn: false, names: null }, o || {});
function run(pf, seconds, ctx) {
  const out = [];
  for (let t = 0; t < seconds; t += DT) {
    const tr = pf.update(DT, ctx);
    if (tr && tr.glance) pf.noteGlance(tr.puzzle); // (the glue does this when the beat really panned)
    if (tr) out.push({ t: pf.clock, id: tr.puzzle.id, step: tr.step, line: tr.line ? tr.line.id : null, glance: tr.glance, occluded: tr.occluded });
  }
  return out;
}
{
  const { O, L } = world();
  const pf = new PF.PuzzleFocus({ seed: 3 });
  ok(pf.build(O, L, { chapter: 1 }) === 3 && pf.bySection[0].length === 1 && pf.bySection[1].length === 2, 'build: one puzzle per objective (bell, haul) + the nook, cached per section');
  // far away (40 m): nothing
  let ev = run(pf, 2, ctxOf({ ez: 30 }));
  ok(ev.length === 0, 'out of its first-sight range (16 m for a bell): no beat');
  ev = run(pf, 2, ctxOf({ ez: 2 }));
  ok(ev.length === 1 && ev[0].id === 'obj:obj-s1' && ev[0].step === 'first' && ev[0].glance && /^pf-bell-1/.test(ev[0].line), `in range with a clear line of sight: the first-sight beat (${ev[0] && ev[0].line}), a glance`);
  ev = run(pf, 20, ctxOf({ ez: 2 }));
  ok(ev.length === 0, 'once per puzzle: no second first-sight beat, and the 25 s cooldown holds everything else');
  ev = run(pf, 25, ctxOf({ ez: 2 }));
  ok(ev.length === 1 && ev[0].step === 'nudge' && near(ev[0].t - pf.puzzles[0].firstAt, PF.NUDGE_AFTER, 0.05) && !ev[0].glance && /^pf-bell-2/.test(ev[0].line), `the nudge ${PF.NUDGE_AFTER} s after the first, still pending: a line and the cues, no second glance within ${PF.REPAN} s`);
  // the hint step on the highlight's rising edge (after the cooldown)
  run(pf, 26, ctxOf({ ez: 2 }));
  ev = run(pf, 1, ctxOf({ ez: 2, hintOn: true }));
  ok(ev.length === 1 && ev[0].step === 'hint' && /^pf-bell-3/.test(ev[0].line), 'the 20 s highlight comes on: the escalation line');
  ev = run(pf, 200, ctxOf({ ez: 2, hintOn: true }));
  ok(ev.length === 0, 'every step once per puzzle per run (200 s more: nothing)');
  // a death in the same section: nothing is reset (the glue never resets on a death)
  // the glance comes back after 120 s if a step is still due: simulated by a fresh nudge flag
  pf.puzzles[0].nudged = false;
  pf.lastBeat = -1e9;
  ev = run(pf, 1, ctxOf({ ez: 2 }));
  ok(ev.length === 1 && ev[0].glance, `still pending ${PF.REPAN} s after the last glance: the glance is allowed again`);
  // a new run: everything again
  pf.reset(1);
  ev = run(pf, 1, ctxOf({ ez: 2 }));
  ok(ev.length === 1 && ev[0].step === 'first', 'a new run (reset): the first-sight beat again');
  // the puzzle done: never
  pf.reset(2);
  O._fxDone[0] = true;
  O.done[0] = true;
  ev = run(pf, 60, ctxOf({ ez: 2, hintOn: true }));
  ok(ev.length === 0, 'a done objective (or one marked done by a warp / Continue) gets no beat');
}
{
  // occluded: far + blocked = nothing; within 6 m = the beat (cues), a far occluded fixture never gets a glance
  const { O, L } = world({ blocked: true });
  const pf = new PF.PuzzleFocus({ seed: 3 });
  pf.build(O, L, { chapter: 1 });
  let ev = run(pf, 3, ctxOf({ ez: 2 }));
  ok(ev.length === 0 && L.rays > 0 && L.rays <= Math.ceil(3 / PF.LOS_EVERY) + 1, `behind a wall at 12 m: no beat; the sight ray ran ${L.rays} times in 3 s (<= every ${PF.LOS_EVERY} s)`);
  ev = run(pf, 1, ctxOf({ ez: -6 }));
  ok(ev.length === 1 && ev[0].glance, 'within 6 m it fires even through the floor (the S1 bell hangs under the grating), within reach: the glance allowed');
  const w2 = world({ blocked: true });
  const pf2 = new PF.PuzzleFocus({ seed: 3 });
  pf2.build(w2.O, w2.L, { chapter: 1 });
  pf2.puzzles[0].def = Object.assign({}, pf2.puzzles[0].def, { see: 60 });
  pf2._hintWas = false;
  ev = run(pf2, 1, ctxOf({ ez: 40, hintOn: true }));
  ok(ev.length === 1 && ev[0].step === 'hint' && !ev[0].glance && ev[0].occluded, 'the hint step at an occluded fixture out of reach (50 m): the line and the cues, never a glance');
}
{
  // busy / not playing / the neighbour section only
  const { O, L } = world();
  const pf = new PF.PuzzleFocus({ seed: 3 });
  pf.build(O, L, { chapter: 1 });
  ok(run(pf, 2, ctxOf({ ez: 2, busy: true })).length === 0 && run(pf, 2, ctxOf({ ez: 2, playing: false })).length === 0, 'busy (a beat running, a story line on air, unsafe) or not playing (paused, dead, a cutscene): nothing');
  let ev = run(pf, 1, ctxOf({ section: 0, ex: 0, ey: -35, ez: -5 }));
  ok(ev.length === 1 && ev[0].id === 'obj:obj-s2', 'the next section down (the neighbour) is watched too: its haul ring seen from above');
  pf.reset(0);
  ev = run(pf, 1, ctxOf({ section: 2, ex: 0, ey: -35, ez: -5 }));
  ok(ev.length === 0, 'a section above the player is not (only the current one + the next)');
}
{
  // determinism + the signal arc
  const list = TXT.PUZZLE_TYPES.bell.first;
  const a = PF.pickVariant(list, 1, 7, 'obj:obj-s1#first', 0);
  ok(a === PF.pickVariant(list, 1, 7, 'obj:obj-s1#first', 0), 'the variant is deterministic for (seed, puzzle, step, run)');
  const seen = new Set();
  for (let r = 0; r < 40; r++) seen.add(PF.pickVariant(list, 1, 7, 'obj:obj-s1#first', r).speaker);
  ok(seen.size === 2, `over runs both variants are heard (${[...seen].join(', ')})`);
  let local = 0;
  for (let r = 0; r < 200; r++) if (PF.pickVariant(TXT.PUZZLE_TYPES.fork.first, 0.2, 7, 'x', r).speaker === 'ELIAS') local++;
  ok(local === 200, 'below the uplink threshold (signal 0.2: S7 / S8) only the local voices (Elias, Vesper)');
  let up1 = 0;
  let up2 = 0;
  for (let r = 0; r < 400; r++) {
    if (PF.pickVariant(list, 1, 7, 'k', r).speaker === 'TICK') up1++;
    if (PF.pickVariant(list, 0.45, 7, 'k', r).speaker === 'TICK') up2++;
  }
  ok(up1 > up2 && up2 > 0, `deeper = more Elias / Vesper: the uplink variant ${((up1 / 400) * 100).toFixed(0)} % at five bars, ${((up2 / 400) * 100).toFixed(0)} % at signal 0.45`);
  // every objective step of Chapter I's deep end keeps a local variant
  let deepOk = true;
  for (const T of Object.values(TXT.PUZZLE_TYPES)) for (const s of TXT.FOCUS_STEPS) if (T[s] && T[s].length && !T[s].some((v) => v.speaker === 'ELIAS' || v.speaker === 'VESPER')) deepOk = false;
  ok(deepOk, 'every step of every type has an Elias or Vesper variant (the deep end is never mute)');
  // quiet sections: the beat runs, no line
  const pf = new PF.PuzzleFocus({ seed: 1 });
  const lv = { sections: [{ id: 'c2-1' }, { id: 'c2-2' }, { id: 'c2-3' }, { id: 'c2-4' }], byId: {}, segmentBlocked: () => false, sectionIndexAt: (y) => (y > -10 ? 2 : 3), data: { c2: { names: [{ id: 'N2-3', x: 0, y: 0, z: -5 }, { id: 'N2-4', x: 0, y: -50, z: -5 }] } } };
  const O = { objectives: [], fixtures: [], done: [], nooks: [], seals: [], fixtureDone: () => false };
  pf.build(O, lv, { chapter: 2 });
  let ev = run(pf, 1, ctxOf({ section: 2, ez: 0, names: new Set() }));
  ok(ev.length === 1 && ev[0].id === 'name:N2-3' && /^pf-name-1/.test(ev[0].line), 'Chapter II: a Name in sight gets Maren or Elias');
  pf.lastBeat = -1e9;
  ev = run(pf, 1, ctxOf({ section: 3, ey: -50, ez: 0, names: new Set() }));
  ok(ev.length === 1 && ev[0].id === 'name:N2-4' && ev[0].line === null, 'the Waking Hall (a rest beat, "no chatter"): the Name gets the cues only, no line');
  pf.reset(1);
  ev = run(pf, 1, ctxOf({ section: 2, ez: 0, names: new Set(['N2-3']) }));
  ok(ev.length === 0, 'a Name already found: no beat');
}
{
  // the puzzle types of both chapters map from the level data
  const T = (id, kind, ch) => PF.puzzleTypeOf({ id, kind }, ch);
  ok(T('bell-s1', 'bell', 1) === 'bell' && T('cw-s2', 'haul', 1) === 'haul' && T('winch-s3', 'winch', 1) === 'winch' && T('lamp-s4a', 'lamp', 1) === 'lamp' && T('key-s5', 'breach', 1) === 'breach' && T('fx-s6-safe', 'hook', 1) === 'fork' && T('arena-s7', 'survive', 1) === 'survive', 'Chapter I: bell, haul, winch, lamp, breach, fork, survive');
  ok(T('door-c2-2-0', 'hook', 2) === 'knocker' && T('bell-c2-9-3', 'bell', 2) === 'peal' && T('clap-c2-12-W', 'haul', 2) === 'clapper' && T('bell-c2-12-pawl', 'bell', 2) === 'pawl' && T('lever-c2-12', 'haul', 2) === 'lever', 'Chapter II: knocker, peal, clapper, pawl, lever');
}
{
  // the real level data: every objective of both chapters is a puzzle (none silently skipped)
  const LD = await import(srcUrl('data/level-data-3d.js'));
  const C2 = await import(srcUrl('data/chapter2-data.js'));
  const d1 = LD.LEVEL_DATA_3D || LD.default;
  const d2 = C2.buildChapter2();
  const types = (d, ch) => d.objectives.map((o) => PF.puzzleTypeOf(d.fixtures.find((f) => f.id === o.ids[0]), ch));
  const t1 = types(d1, 1);
  const t2 = types(d2, 2);
  ok(t1.every(Boolean) && t1.length === 7, `Chapter I: all ${t1.length} objectives map to a puzzle type (${t1.join(', ')})`);
  ok(t2.every(Boolean), `Chapter II: all ${t2.length} objectives map to a puzzle type (${[...new Set(t2)].join(', ')})`);
  ok(d1.nooks.length === 3 && d2.c2.names.length === 5 && d2.anchors.some((a) => a.id === 'c2-1-ring0') && d2.anchors.some((a) => a.id === 'c2-3-ring0') && d2.anchors.some((a) => a.id === 'c2-2-lift-ring'), 'the places worth a look exist: three Masons\' rests (one the lure), five Names, the swinging rings and the lift');
}

// ================================================================= the radio ================================================================
{
  const cm = new CM.CommsDirector({ seed: 4, script: [] });
  // (the radio voices: TICK, ODESSA, ODESSA: the same latency as the story line, so the priority decides)
  const lines = [1, 2, 4].map((i) => TXT.PUZZLE_FOCUS_LINES[i]).map((v) => CM.commsLine(v.id, v.speaker, v.text, { when: { focus: v.type }, prio: CM.FOCUS_PRIO, ttl: 20 }));
  const story = CM.commsLine('story-x', 'ODESSA', 'A story line, Elias.', { when: { ev: 'none' }, prio: 2, ttl: 20 });
  const x = { playing: true, section: 0, depth: 5, frac: 0.1, danger: false, tense: false, skip: false, gaze: false, bloodOn: false };
  const q1 = cm.focus(lines[0]);
  const q2 = cm.focus(lines[0]);
  cm._trigger(story, 0);
  cm.focus(lines[1]);
  let overlap = false;
  let started = 0;
  cm.onStart = () => {
    if (cm._onAir) overlap = true;
    cm._onAir = true;
    started++;
  };
  cm.onEnd = () => {
    cm._onAir = false;
  };
  for (let i = 0; i < 60 * 20; i++) cm.update(DT, x);
  const ids = cm.log.map((l) => l.id);
  ok(q1 && !q2, 'CommsDirector.focus queues a line once per run (a second call is ignored)');
  ok(ids[0] === 'story-x' && ids.indexOf(lines[0].id) > 0 && ids.indexOf(lines[1].id) > 0 && ids.filter((i) => i === lines[0].id).length === 1, `a story line first (priority 2 > ${CM.FOCUS_PRIO}), then the focus lines, each exactly once (${ids.join(', ')})`);
  let seq = true;
  for (let i = 1; i < cm.log.length; i++) if (cm.log[i].t0 < cm.log[i - 1].t1) seq = false;
  ok(!overlap && seq && started === 3, 'one transmission at a time, never overlapping');
  // danger: nothing starts, a stale focus line is dropped (never played late)
  const cd = new CM.CommsDirector({ seed: 4, script: [] });
  cd.focus(CM.commsLine('pf-x', 'TICK', 'A stale one.', { when: { focus: 'bell' }, prio: CM.FOCUS_PRIO, ttl: 7 }));
  const xd = Object.assign({}, x, { danger: true });
  for (let i = 0; i < 60 * 10; i++) cd.update(DT, xd);
  for (let i = 0; i < 60 * 5; i++) cd.update(DT, x);
  ok(cd.log.length === 0, 'during an attack wind-up nothing starts, and the focus line goes stale (ttl 7 s): never played late');
  ok(CM.FOCUS_PRIO > 1 && CM.FOCUS_PRIO < 2, `focus priority ${CM.FOCUS_PRIO}: above the flavour lines, below the story and the beats`);
}

// ================================================================= the glue / setting ======================================================
{
  const G = PF;
  {
    ok(G.focusUrlMode('?sw=0&focus=off') === 'off' && G.focusUrlMode('?focus=cues&x=1') === 'cues' && G.focusUrlMode('?x=1') === '', '?focus=off|cues');
    ok(G.focusMode('auto', '', false) === 'auto' && G.focusMode('auto', '', true) === 'cues' && G.focusMode('cues', '', false) === 'cues' && G.focusMode('auto', 'off', false) === 'off' && G.focusMode('bogus', '', false) === 'auto', 'the mode: the URL over the setting; Reduced effects never turns the view (cues)');
  }
  ok(CFG.SETTINGS_DEFAULTS.puzzleFocus === 'auto', 'Settings: Puzzle focus defaults to auto (glance on desktop, cues in VR)');
  const s = CFG.sanitizeUxSettings(Object.assign({}, CFG.SETTINGS_DEFAULTS, { puzzleFocus: 'sideways' }));
  const s2 = CFG.sanitizeUxSettings(Object.assign({}, CFG.SETTINGS_DEFAULTS, { puzzleFocus: 'cues' }));
  ok(s.puzzleFocus === 'auto' && s2.puzzleFocus === 'cues', 'sanitised: anything but cues / off is auto');
}

// ================================================================= no allocation per frame ================================================
{
  const code = `
const FB = await import('${srcUrl('sim/focusBeat.js')}');
const PF = await import('${srcUrl('sim/puzzleFocus.js')}');
const meas = (f, n) => { for (let i = 0; i < 400000; i++) f(); global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < n; i++) f(); return process.memoryUsage().heapUsed - h0; };
const b = new FB.FocusBeat();
const inp = { yaw: 0.5, pitch: 0.5, ex: 0.5, ey: 0.5, ez: 0.5, tx: 3.5, ty: 1.5, tz: 7.5, safe: true, xr: false };
const so = { yaw: 0.5, pitch: 0.5, ex: 0.5, ey: 0.5, ez: 0.5, pan: true, hold: 4 };
// the frames of a glance (TURN and HOLD, panning, the look fed back), and the idle frames (most of the game); the start / the state changes
// happen once per beat (>= 25 s apart) and are not per-frame work
b.start(3.5, 1.5, 7.5, so);
const turn = meas(() => { b.t = 0.3; b.update(1 / 72, inp); inp.yaw += b.dYaw; inp.pitch += b.dPitch; }, 500000);
b.state = FB.HOLD;
const hold = meas(() => { b.t = 0.3; b.update(1 / 72, inp); inp.yaw += b.dYaw; inp.pitch += b.dPitch; }, 500000);
b.stop();
const idle = meas(() => b.update(1 / 72, inp), 500000);
const beat = Math.max(turn, hold, idle);
const fx = [{ id: 'a', kind: 'bell', x: 0, y: 0, z: -100 }, { id: 'b', kind: 'lamp', x: 5, y: 0, z: -100 }];
const O = { objectives: [{ id: 'o', index: 0, section: 0, seal: 0, fx: [0, 1] }], fixtures: fx, done: [false], sealOpen: [false], seals: [], nooks: [], fixtureDone: () => false };
const L = { sections: [{ id: 's1' }], segmentBlocked: () => false, sectionIndexAt: () => 0 };
const pf = new PF.PuzzleFocus({ seed: 1 });
pf.build(O, L, { chapter: 1 });
const ctx = { playing: true, busy: false, section: 0, ex: 0, ey: 0, ez: 0, signal: 1, hintOn: false, names: null };
const trig = meas(() => pf.update(1 / 72, ctx), 500000);
console.log(JSON.stringify({ beat, turn, hold, idle, trig }));
`;
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { encoding: 'utf8' });
  let A = null;
  try {
    A = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    A = null;
  }
  ok(!!A && A.beat < 32768 && A.trig < 32768, `no allocation per frame (fresh process, 500k frames each): the glance's TURN ${A ? A.turn : '?'} B, HOLD ${A ? A.hold : '?'} B, idle ${A ? A.idle : '?'} B; the trigger ${A ? A.trig : '?'} B` + (A ? '' : ': ' + (r.stderr || '').slice(0, 200)));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
