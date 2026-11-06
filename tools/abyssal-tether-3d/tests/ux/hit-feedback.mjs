// HIT FEEDBACK (docs/abyssal-tether-3d/plans/HIT_FEEDBACK.md), in Node: what a Mason hit (30 %) / a skitterling bite (10 %) looks, sounds
// and feels like, against the fixed SIM contract (`player:hit` + `game.knock`) and a local fake of it.
//   1. the punch envelope (render/hitFeedback.js): peak per source, 80 ms attack, 0.7 s decay, one-shot, <= 2 pulses / s under a hit
//      storm, Reduced effects / gentle halve it
//   2. the camera curves: neutral at k = 0, the desktop eye 1.62 -> 0.30 m, the roll <= 10 deg away from the attacker, a headset NEVER
//      rolls and moves <= 0.12 m (none with comfort / Reduced effects / gentle), gentle desktop = none; the stand-in knock's timings
//   3. the glue on a fake game (hitFeedbackGlue.js): game.knock == null tolerated; a debug Mason hit drops / rolls / returns EXACTLY to
//      neutral; resets on death / respawn / menu mid-knock (no stuck offsets); the SIM's knock followed when present; the double haptic
//      pulse and a bite's buzz; the muffle (Mason only); the ring event; VR / gentle / Reduced effects
//   4. the sounds (audio/hitFeedbackSfx.js): compile + validate, registered with their routes, peak <= -12 dBFS, the ring's decay length
//   5. the vignette (render/healthFx.js): the punch on the existing mesh (+0 draw calls, no sampler), the legacy flash consumed, the held
//      vignette, the '-30%' tick on the ECG canvas, reset
//   6. captions; 7. the setting (default, sanitize, round trip, the UI rows); 8. no per-frame allocation (static + heap sampled); 9. wiring
//   node hit-feedback.mjs [--root DIR]
import '../input/register.mjs';
import fs from 'node:fs';
import inspector from 'node:inspector/promises';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';
import { renderPlan, measure, SR } from '../audio/sfxRender.mjs';

const THREE = await import('three');
const HF = await import(srcUrl('render/hitFeedback.js'));
const { HitFeedbackGlue, RING_K, HAPTIC } = await import(srcUrl('hitFeedbackGlue.js'));
const SFX = await import(srcUrl('audio/hitFeedbackSfx.js'));
const D = await import(srcUrl('audio/sfxDesign.js'));
const CAP = await import(srcUrl('ui/captions.js'));
const { EventBus, SETTINGS_DEFAULTS, UX_LIMITS, sanitizeUxSettings, VIEW, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { HIT, Punch, punchEnv, punchPeak, hitCam, rollSide, stumble, heldVig, knockK, knockMuffle, LocalKnock } = HF;

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const DEG = Math.PI / 180;

// ---- 1. the punch ------------------------------------------------------------------------------------------------------------
{
  ok(punchEnv(-0.1) === 0 && punchEnv(0) === 0 && near(punchEnv(HIT.attack), 1) && punchEnv(HIT.attack + HIT.decay) === 0 && punchEnv(5) === 0, 'punchEnv: 0 at the start, 1 at 80 ms, 0 from 0.78 s on');
  let mono = true;
  for (let t = HIT.attack; t < HIT.attack + HIT.decay; t += 0.01) if (punchEnv(t + 0.01) > punchEnv(t) + 1e-12) mono = false;
  ok(HIT.attack === 0.08 && HIT.decay === 0.7 && mono, 'the decay only falls (80 ms attack, 0.7 s decay)');
  ok(near(punchPeak('mason', false, false), 0.58) && near(punchPeak('skitter', false, false), 0.58 * 0.35) && near(punchPeak('mason', true, false), 0.29) && near(punchPeak('mason', false, true), 0.29) && near(punchPeak('mason', true, true), 0.29), 'peaks: Mason 0.58 (the strongest), a bite 35 % of it, gentle or Reduced effects halve it');
  const p = new Punch();
  p.hit(0.58);
  let peak = 0;
  let peakT = 0;
  for (let i = 1; i <= 60; i++) {
    const v = p.step(DT);
    if (v > peak) {
      peak = v;
      peakT = i * DT;
    }
  }
  ok(near(peak, 0.58, 0.01) && peakT >= 0.06 && peakT <= 0.1 && p.value === 0, `one hit: one punch to ${f2(peak)} at ${f2(peakT)} s, gone within 1 s`);
  // a hit storm at 10 Hz for 4 s: never more than 2 rises per second
  const q = new Punch();
  let prev = 0;
  let rising = false;
  const rises = [];
  for (let i = 0; i < 240; i++) {
    if (i % 6 === 0) q.hit(0.58);
    const v = q.step(DT);
    if (v > prev + 1e-9 && !rising) {
      rising = true;
      rises.push(i * DT);
    } else if (v < prev - 1e-9) rising = false;
    prev = v;
  }
  let maxPerS = 0;
  for (let t = 0; t < 4; t += 0.05) maxPerS = Math.max(maxPerS, rises.filter((r) => r >= t && r < t + 1).length);
  ok(maxPerS <= 2 && q.starts <= 8, `a 10 Hz hit storm: at most ${maxPerS} pulses in any second (<= 2: never a strobe), ${q.starts} punches in 4 s`);
}

// ---- 2. the camera curves + the stand-in knock ------------------------------------------------------------------------------------
{
  const out = { drop: 0, roll: 0 };
  const desk = { xr: false, gentle: false, calm: false, comfort: false };
  hitCam(0, 1, desk, out);
  ok(out.drop === 0 && out.roll === 0, 'k = 0: no drop, no roll');
  hitCam(1, 1, desk, out);
  ok(near(VIEW.standEye - out.drop, 0.3) && near(Math.abs(out.roll), 10 * DEG), `desktop flat on the ground: the eye at ${f2(VIEW.standEye - out.drop)} m above the feet, roll ${f2(out.roll / DEG)} deg`);
  let maxRoll = 0;
  for (let k = 0; k <= 1; k += 0.05) for (const s of [-1, -0.5, 0.6, 1, 3]) maxRoll = Math.max(maxRoll, Math.abs(hitCam(k, s, desk, out).roll));
  ok(maxRoll <= 10 * DEG + 1e-9, `the roll never exceeds 10 deg (max ${f2(maxRoll / DEG)})`);
  hitCam(1, 1, { ...desk, calm: true }, out);
  ok(near(Math.abs(out.roll), 5 * DEG), 'Reduced effects: half the roll');
  hitCam(1, 1, { ...desk, gentle: true }, out);
  ok(out.drop === 0 && out.roll === 0, 'gentle (desktop): no drop, no roll (pure vignette + sound)');
  let vrOk = true;
  for (let k = 0; k <= 1.2; k += 0.05) {
    hitCam(k, 1, { xr: true, gentle: false, calm: false, comfort: false }, out);
    if (out.roll !== 0 || out.drop > 0.12 + 1e-9 || out.drop < 0) vrOk = false;
  }
  ok(vrOk, 'VR: never a roll, the rig at most 0.12 m down');
  const offs = ['calm', 'comfort', 'gentle'].every((key) => {
    hitCam(1, 1, { xr: true, gentle: false, calm: false, comfort: false, [key]: true }, out);
    return out.drop === 0 && out.roll === 0;
  });
  ok(offs, 'VR with Reduced effects, the comfort vignette or gentle: no movement at all');
  // the side: away from the attacker
  const yaw = 0; // looking down -Z: right is +X
  ok(rollSide(1, 0, yaw, 1) < 0 && rollSide(-1, 0, yaw, 1) > 0, 'pushed right (attacker on the left) the head falls right (negative z roll); pushed left: positive');
  ok(near(rollSide(0, 1, yaw, 1), 0.6) && near(rollSide(0, -1, yaw, -1), -0.6) && near(rollSide(NaN, 0, 0, 1), 0.6), 'straight on (or no direction): the fallback side at 0.6');
  ok(near(rollSide(0, -1, Math.PI / 2, 1), rollSide(1, 0, 0, 1)), 'the side follows the view yaw');
  ok(stumble(0) === 0 && near(stumble(0.3 * HIT.stumbleDur), 1) && stumble(HIT.stumbleDur) === 0, 'the bite stumble: a 0.45 s bump');
  ok(heldVig(0) === 0 && near(heldVig(1), HIT.vig) && heldVig(0.5) < HIT.vig + 1e-9, 'the held vignette follows k');
  ok(knockK(null) === 0 && knockK({ phase: 'none', k: 1 }) === 0 && knockK({ phase: 'down', k: NaN }) === 0 && knockK({ phase: 'down', k: 2 }) === 1, 'knockK: null / none / NaN = standing, clamped');
  ok(knockMuffle(null) === 0 && knockMuffle({ phase: 'down' }) === 1 && knockMuffle({ phase: 'rise', t: 1.2, dur: 2.4 }) < 0.5 && knockMuffle({ phase: 'rise', t: 2.4, dur: 2.4 }) === 0, 'the muffle: closed while down, open by the end of the rise');
  // the stand-in knock
  const bus = new EventBus();
  const ev = [];
  for (const t of ['player:down', 'player:rise', 'player:up']) bus.on(t, (e) => ev.push([t, e.dur, e.local]));
  const L = new LocalKnock(bus);
  L.start(HIT.down, HIT.rise);
  let flatAt = -1;
  let riseAt = -1;
  let upAt = -1;
  let mono = true;
  let prevK = 1;
  for (let i = 1; i <= 260; i++) {
    L.step(DT);
    const t = i * DT;
    if (flatAt < 0 && L.k >= 0.99) flatAt = t;
    if (riseAt < 0 && L.phase === 'rise') riseAt = t;
    if (riseAt >= 0 && L.phase === 'rise') {
      if (L.k > prevK + 1e-12) mono = false;
      prevK = L.k;
    }
    if (upAt < 0 && L.phase === 'none') upAt = t;
  }
  ok(flatAt > 0 && flatAt <= 0.25 + DT && Math.abs(riseAt - 1.1) <= DT + 1e-9 && Math.abs(upAt - 3.5) <= DT + 1e-9 && mono, `stand-in: flat by ${f2(flatAt)} s, rises at ${f2(riseAt)} s, up at ${f2(upAt)} s (the contract: 0.25 / 1.1 / +2.4), the rise only climbs`);
  ok(ev.length === 3 && ev[0][0] === 'player:down' && near(ev[0][1], 1.1) && ev[1][0] === 'player:rise' && near(ev[1][1], 2.4) && ev[2][0] === 'player:up' && ev.every((e) => e[2] === true), 'stand-in: player:down {1.1} / player:rise {2.4} / player:up once each, marked local');
  ok(L.k === 0 && L.moveMul === 1 && !L.active, 'stand-in: back to standing (k 0, moveMul 1, inactive)');
}

// ---- 3. the glue on a fake game ---------------------------------------------------------------------------------------------------
const R = CONFIG.player.radius;
function fakeGame(o = {}) {
  const bus = new EventBus();
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  camera.rotation.order = 'YXZ';
  rig.add(camera);
  scene.add(rig);
  const sockets = { left: new THREE.Object3D(), right: new THREE.Object3D() };
  const base = { x: 0.2, y: -0.2, z: -0.48 };
  sockets.left.position.set(-base.x, base.y, base.z);
  sockets.right.position.set(base.x, base.y, base.z);
  camera.add(sockets.left, sockets.right);
  const haptics = [];
  const g = {
    bus,
    state: 'playing',
    time: 0,
    xrActive: !!o.xr,
    settings: Object.assign({}, SETTINGS_DEFAULTS, o.settings || {}),
    renderer: { rig, camera, scene },
    player: { x: 0, y: R, z: 0, rx: 0, ry: R, rz: 0, alive: true },
    health: { hp: 0.7 },
    healthFx: { hitFlash: 0, hitVig: 0, hitDizzy: 0, hitTick: 0, hitTickT: 1 },
    input: { sockets, tuning: { desktopHand: base }, mode: o.xr ? 'xr' : 'desktop' },
    fallPose: { _applied: false },
    deathScene: { active: false },
    audio: o.audio || null,
    knock: o.knock === undefined ? null : o.knock,
    creature: null,
    _hapticBoth(i, ms) {
      haptics.push([i, ms, this.time]);
    },
  };
  g.haptics = haptics;
  g.hf = new HitFeedbackGlue(g);
  g.hitFeedback = g.hf;
  g.baseY = R + VIEW.standEye - R; // the rig's y as _placeRig puts it (feet at 0)
  return g;
}
/** One game frame in the order game.js runs it: the run clock, the rig placed, applyCam, then the views (update). */
function frame(g, dt = DT) {
  if (g.state === 'playing' || g.state === 'dead') g.time += dt;
  g.renderer.rig.position.set(0, g.baseY, 0);
  g.hf.applyCam();
  g.hf.update(dt);
}
const eye = (g) => g.renderer.rig.position.y; // feet at y = 0
const neutral = (g) =>
  g.renderer.rig.position.y === g.baseY &&
  g.renderer.camera.rotation.z === 0 &&
  g.healthFx.hitFlash === 0 &&
  g.healthFx.hitVig === 0 &&
  g.healthFx.hitDizzy === 0 &&
  g.hf.pose === 0 &&
  g.input.sockets.right.position.y === -0.2 &&
  g.input.sockets.right.position.z === -0.48 &&
  g.input.sockets.left.position.y === -0.2;
{
  // game.knock == null: a Mason hit through the debug helper, the stand-in knock
  const g = fakeGame();
  const ring = [];
  g.bus.on('hit:ring', (e) => ring.push([e.source, e.k]));
  const evs = [];
  for (const t of ['player:down', 'player:rise', 'player:up']) g.bus.on(t, () => evs.push(t));
  let threw = false;
  try {
    for (let i = 0; i < 10; i++) frame(g);
  } catch (err) {
    threw = err;
  }
  ok(!threw && neutral(g), 'game.knock == null: frames run, everything neutral');
  g.hf.debugHit('mason');
  let peak = 0;
  let minEye = 9;
  let maxRoll = 0;
  let vigMax = 0;
  const samples = {};
  for (let i = 0; i < 60 * 4; i++) {
    frame(g);
    peak = Math.max(peak, g.healthFx.hitFlash);
    vigMax = Math.max(vigMax, g.healthFx.hitVig);
    minEye = Math.min(minEye, eye(g));
    maxRoll = Math.max(maxRoll, Math.abs(g.renderer.camera.rotation.z));
    if (i === 15) samples.fall = eye(g);
    if (i === 60) samples.down = eye(g);
    if (i === 140) samples.rise = eye(g);
  }
  ok(near(peak, 0.58, 0.02) && near(vigMax, HIT.vig, 0.02), `a Mason hit: the punch peaks at ${f2(peak)}, the held vignette ${f2(vigMax)}`);
  ok(near(minEye, 0.3, 0.01) && maxRoll > 5 * DEG && maxRoll <= 10 * DEG + 1e-9, `desktop: the eye drops to ${f2(minEye)} m, rolls ${f2(maxRoll / DEG)} deg`);
  ok(samples.fall < 0.4 && near(samples.down, 0.3, 0.01) && samples.rise > 0.35 && samples.rise < 1.5, `falls fast (eye ${f2(samples.fall)} m at 0.25 s), holds (${f2(samples.down)} m at 1 s), rises slowly (${f2(samples.rise)} m at 2.3 s)`);
  ok(neutral(g), 'after player:up: EXACTLY neutral (rig y, camera roll 0, vignette, pose, the hands)');
  ok(evs.join() === 'player:down,player:rise,player:up' && g.hf.stats.local === 1, 'the stand-in ran (down, rise, up) because game.knock is missing');
  ok(ring.length === 1 && ring[0][0] === 'mason' && ring[0][1] === RING_K.mason, "'hit:ring' { mason, k 1 } for the sound and the caption");
  const h = g.haptics;
  ok(h.length === 2 && h[0][0] === 1 && h[0][1] === 60 && h[1][0] === 1 && h[1][1] === 90 && h[1][2] - h[0][2] >= 0.11 - 1e-9 && h[1][2] - h[0][2] < 0.14, `haptics: a hard double pulse 1.0 x 60 ms, ${Math.round((h[1] ? h[1][2] - h[0][2] : 0) * 1000)} ms later 1.0 x 90 ms`);
  // the hands sink while down (desktop), and only then
  g.hf.debugHit('mason');
  for (let i = 0; i < 40; i++) frame(g);
  ok(g.input.sockets.right.position.y < -0.25 && g.input.sockets.left.position.z > -0.46, 'desktop: the virtual hands sink while down');
  // a death mid-knock: neutral at once
  g.bus.emit('player:death', {});
  g.state = 'dead';
  g.deathScene.active = true;
  frame(g);
  ok(neutral(g) && g.hf.knock() === null, 'a death mid-knock: neutral on the next frame (no stuck offset, no knock)');
  // respawn / menu mid-knock
  for (const [evt, st] of [['game:respawn', 'playing'], ['game:menu', 'menu'], ['game:restart', 'playing']]) {
    g.state = 'playing';
    g.deathScene.active = false;
    g.hf.debugHit('mason');
    for (let i = 0; i < 30; i++) frame(g);
    const was = eye(g) < 1 && g.renderer.camera.rotation.z !== 0;
    g.bus.emit(evt, {});
    g.state = st;
    frame(g);
    ok(was && neutral(g), `${evt} mid-knock: neutral at once`);
  }
}
{
  // a skitterling bite: smaller, no knock, one buzz, a stumble
  const g = fakeGame();
  for (let i = 0; i < 5; i++) frame(g);
  g.hf.debugHit('skitter');
  let peak = 0;
  let minEye = 9;
  let maxRoll = 0;
  let pose = 0;
  for (let i = 0; i < 90; i++) {
    frame(g);
    peak = Math.max(peak, g.healthFx.hitFlash);
    minEye = Math.min(minEye, eye(g));
    maxRoll = Math.max(maxRoll, Math.abs(g.renderer.camera.rotation.z));
    pose = Math.max(pose, g.hf.pose);
  }
  ok(near(peak, 0.58 * 0.35, 0.01) && pose === 0 && g.hf.stats.local === 0, `a bite: the punch ${f2(peak)} (35 %), no knock`);
  ok(VIEW.standEye - minEye <= HIT.stumbleDrop + 1e-6 && VIEW.standEye - minEye > 0.05 && maxRoll <= HIT.stumbleRoll + 1e-9 && neutral(g), `a bite: a stumble (${f2(VIEW.standEye - minEye)} m, ${f2(maxRoll / DEG)} deg), then neutral`);
  ok(g.haptics.length === 1 && g.haptics[0][0] === HAPTIC.skitter[0] && g.haptics[0][1] === HAPTIC.skitter[1], 'a bite: one short buzz (0.55 x 45 ms)');
}
{
  // VR: the camera is never rotated, the rig at most 0.12 m down, none in comfort
  const g = fakeGame({ xr: true });
  g.renderer.camera.rotation.z = 0.123; // a sentinel for "the headset's own": never written
  for (let i = 0; i < 3; i++) frame(g);
  g.hf.debugHit('mason');
  let maxDrop = 0;
  let pose = 0;
  let touched = false;
  let vig = 0;
  for (let i = 0; i < 240; i++) {
    frame(g);
    maxDrop = Math.max(maxDrop, g.baseY - eye(g));
    pose = Math.max(pose, g.hf.pose);
    vig = Math.max(vig, g.healthFx.hitVig);
    if (g.renderer.camera.rotation.z !== 0.123 || g.renderer.camera.rotation.x !== 0) touched = true;
  }
  ok(!touched && maxDrop <= 0.12 + 1e-9 && maxDrop > 0.1, `VR: the headset camera never rotated, the rig down at most ${f2(maxDrop)} m`);
  ok(pose > 0.99 && vig > 0.8 && g.input.sockets.right.position.y === -0.2, 'VR: the cues are the body pose and the held vignette; the real hands are never moved');
  const g2 = fakeGame({ xr: true, settings: { reducedEffects: true } });
  g2.hf.debugHit('mason');
  let d2 = 0;
  for (let i = 0; i < 120; i++) {
    frame(g2);
    d2 = Math.max(d2, g2.baseY - eye(g2));
  }
  const g3 = fakeGame({ xr: true, settings: { vignette: 0.5 } });
  g3.hf.debugHit('mason');
  let d3 = 0;
  for (let i = 0; i < 120; i++) {
    frame(g3);
    d3 = Math.max(d3, g3.baseY - eye(g3));
  }
  ok(d2 === 0 && d3 === 0, 'VR with Reduced effects / the comfort vignette: the rig never moves');
}
{
  // gentle / Reduced effects (desktop)
  const g = fakeGame({ settings: { hitFeedback: 'gentle' } });
  const ring = [];
  g.bus.on('hit:ring', (e) => ring.push(e.k));
  g.hf.debugHit('mason');
  let peak = 0;
  let moved = false;
  let vig = 0;
  let dz = 0;
  for (let i = 0; i < 240; i++) {
    frame(g);
    peak = Math.max(peak, g.healthFx.hitFlash);
    vig = Math.max(vig, g.healthFx.hitVig);
    dz = Math.max(dz, Math.abs(g.healthFx.hitDizzy));
    if (eye(g) !== g.baseY || g.renderer.camera.rotation.z !== 0) moved = true;
  }
  ok(near(peak, 0.29, 0.01) && !moved && vig > 0.8 && dz === 0 && ring[0] === RING_K.gentle, `gentle: half the punch (${f2(peak)}), the view never moves, the vignette held without sway, the shorter ring (k ${ring[0]})`);
  const g2 = fakeGame({ settings: { reducedEffects: true } });
  g2.hf.debugHit('mason');
  let p2 = 0;
  let dz2 = 0;
  let roll2 = 0;
  for (let i = 0; i < 120; i++) {
    frame(g2);
    p2 = Math.max(p2, g2.healthFx.hitFlash);
    dz2 = Math.max(dz2, Math.abs(g2.healthFx.hitDizzy));
    roll2 = Math.max(roll2, Math.abs(g2.renderer.camera.rotation.z));
  }
  ok(near(p2, 0.29, 0.01) && dz2 === 0 && roll2 <= 5 * DEG + 1e-9, `Reduced effects: half the punch, no sway (no vignette pump), half the roll (${f2(roll2 / DEG)} deg)`);
  const g3 = fakeGame();
  g3.hf.debugHit('mason');
  let dz3 = 0;
  for (let i = 0; i < 120; i++) {
    frame(g3);
    dz3 = Math.max(dz3, Math.abs(g3.healthFx.hitDizzy));
  }
  ok(dz3 > 0.01 && dz3 <= HIT.dizzyAmp * HIT.vig + 1e-9, `full: the slow dizzy sway of the rim, bounded (${f2(dz3)} NDC at ${HIT.dizzyHz} Hz)`);
}
{
  // the SIM's knock present: followed; no stand-in on a real hit; the stand-in only for a synthetic hit the SIM ignored
  const knock = { phase: 'none', t: 0, dur: 0, k: 0, moveMul: 1, active: false };
  const g = fakeGame({ knock });
  frame(g);
  g.bus.emit('player:hit', { source: 'mason', amount: 0.3, hp: 0.7, x: -1, y: 1.8, z: 0, dx: 1, dz: 0, down: true });
  ok(g.hf.local.phase === 'none' && g.hf.stats.local === 0, 'a real hit with the SIM in the build: no stand-in (the SIM knocks)');
  knock.phase = 'down';
  knock.k = 1;
  knock.dur = 1.1;
  frame(g);
  ok(near(eye(g), 0.3, 1e-6) && g.renderer.camera.rotation.z < 0, `the SIM's knock followed: eye ${f2(eye(g))} m, rolled ${f2(g.renderer.camera.rotation.z / DEG)} deg (pushed right: the head falls right)`);
  knock.phase = 'rise';
  knock.k = 0.5;
  knock.t = 1.2;
  knock.dur = 2.4;
  frame(g);
  const mid = eye(g);
  knock.phase = 'none';
  knock.k = 0;
  frame(g);
  ok(mid > 0.3 && mid < 1.62 && eye(g) === g.baseY && g.renderer.camera.rotation.z === 0 && g.hf.pose === 0 && g.healthFx.hitVig === 0, 'its rise followed, then the view neutral the frame it reports none');
  g.hf.debugHit('mason');
  ok(g.hf.local.phase === 'down' && g.hf.knock() === g.hf.local, 'a synthetic hit the SIM ignored: the stand-in runs');
}
{
  // the muffle (fake audio: the engine's _hitT clock)
  const audio = { _hitT: 0, ids: [], routes: [], registerSfx(id) { this.ids.push(id); return {}; }, registerSfxRoute(t) { this.routes.push(t); } };
  const g = fakeGame({ audio });
  frame(g);
  ok(audio.ids.join() === 'hit.ring,hit.thump,hit.gasp' && audio.routes.join() === 'hit:ring,player:rise', 'registered once the audio exists: three recipes, the routes hit:ring and player:rise');
  g.hf.debugHit('mason');
  const ts = [];
  for (let i = 0; i < 240; i++) {
    frame(g);
    ts.push(audio._hitT);
    audio._hitT = Math.max(0, audio._hitT - DT); // the engine counts it down each frame
  }
  ok(ts[30] >= 1 && ts[100] > 0.3 && ts[100] < ts[70] && ts[200] < 0.2 && ts[239] === 0, `the world muffle: closed while down (${f2(ts[30])}), opening over the rise (${f2(ts[100])} at 1.7 s, ${f2(ts[200])} at 3.4 s), open after`);
  const g2 = fakeGame({ audio: Object.assign({}, audio, { _hitT: 0 }) });
  frame(g2);
  g2.hf.debugHit('skitter');
  let m2 = 0;
  for (let i = 0; i < 60; i++) {
    frame(g2);
    m2 = Math.max(m2, g2.audio._hitT);
  }
  ok(m2 === 0, 'a bite: no muffle');
  ok(SFX.holdHitMuffle(null, 1) === false && SFX.holdHitMuffle({ _hitT: 2 }, 0.5) === true, 'holdHitMuffle: no audio = nothing; never opens a muffle someone else closed');
  const a2 = { _hitT: 2 };
  SFX.holdHitMuffle(a2, 0.5);
  ok(a2._hitT === 2, '... (a death / the engine own big-hit ring keeps its own)');
}

// ---- 4. the sounds -------------------------------------------------------------------------------------------------------------
{
  const NYQ = SR * 0.45;
  const recs = { [SFX.RING_SFX_ID]: SFX.RING_RECIPE, [SFX.THUMP_SFX_ID]: SFX.THUMP_RECIPE, [SFX.GASP_SFX_ID]: SFX.GASP_RECIPE };
  const problems = [];
  const compiled = {};
  for (const [id, r] of Object.entries(recs)) {
    compiled[id] = D.compileRecipe(id, r);
    problems.push(...D.validateRecipe(compiled[id], NYQ));
  }
  ok(problems.length === 0 && Object.keys(recs).every((id) => /^[a-z]+(\.[a-z]+)*$/.test(id) && recs[id].note.length > 10), 'three designed recipes compile and validate (finite, in range, node budget), named, with design notes' + (problems.length ? ': ' + problems.join('; ') : ''));
  ok(SFX.RING_RECIPE.bus === 'ui' && SFX.THUMP_RECIPE.bus === 'player' && SFX.RING_RECIPE.vary.rule === 'fixed', 'the ring on the UI bus (head-locked, not behind its own muffle); the thump on the player bus (muffled with the world); fixed (deterministic)');
  const plan = new D.Plan();
  let worst = 0;
  for (const id of Object.keys(compiled)) {
    for (const k of [0, 0.3, 0.55, 1]) {
      D.resolveRecipe(compiled[id], k, 0, plan, NYQ);
      const m = measure(renderPlan(plan));
      worst = Math.max(worst, m.peak);
    }
  }
  ok(worst <= 0.2512, `hearing safety: every recipe peaks at ${(20 * Math.log10(worst)).toFixed(1)} dBFS (<= -12) before the master limiter`);
  const decay40 = (k) => {
    D.resolveRecipe(compiled[SFX.RING_SFX_ID], k, 0, plan, NYQ);
    const buf = renderPlan(plan);
    const m = measure(buf);
    const fl = m.peak * 0.01;
    let last = 0;
    for (let i = buf.length - 1; i >= 0; i--) if (Math.abs(buf[i]) > fl) {
      last = i;
      break;
    }
    return { t: last / SR, peak: m.peak };
  };
  const big = decay40(1);
  const small = decay40(RING_K.skitter);
  const gentle = decay40(RING_K.gentle);
  ok(big.t >= 2.0 && big.t <= 3.2, `the Mason ring rings ~2.5 s (to -40 dB: ${f2(big.t)} s)`);
  ok(small.t < big.t * 0.6 && small.peak < big.peak * 0.6 && gentle.t < big.t, `a bite rings shorter (${f2(small.t)} s) and quieter (${(20 * Math.log10(small.peak / big.peak)).toFixed(1)} dB); gentle shorter too (${f2(gentle.t)} s)`);
  ok(SFX.RING_RECIPE.layers.some((L) => L.f >= 3100 && L.f <= 3400) && SFX.RING_RECIPE.layers.some((L) => L.f >= 4000 && L.f <= 4200) && SFX.RING_RECIPE.layers.some((L) => L.lfo), 'the ring: a sine pair ~3.3 + ~4.1 kHz, a beating partial and a slow tremolo (the wobble)');
  const played = [];
  const E = { opts: () => ({}), play: (id, k) => played.push([id, k]) };
  SFX.hitRingRoute({ source: 'mason', k: 1 }, E);
  SFX.hitRingRoute({ source: 'skitter', k: 0.3 }, E);
  SFX.hitGaspRoute({}, E);
  ok(played.map((p) => p.join(':')).join() === 'hit.ring:1,hit.thump:1,hit.ring:0.3,hit.thump:0.25,hit.gasp:0.6', 'the routes: ring + thump at the event k (a bite: a small thump), the gasp on the rise');
  ok(SFX.registerHitFeedbackSfx(null) === false && SFX.registerHitFeedbackSfx({}) === false, 'no engine: nothing registered, no throw');
  const src = fs.readFileSync(SRC_DIR + '/audio/hitFeedbackSfx.js', 'utf8') + fs.readFileSync(SRC_DIR + '/hitFeedbackGlue.js', 'utf8') + fs.readFileSync(SRC_DIR + '/render/hitFeedback.js', 'utf8');
  ok(!/Math\.random/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')), 'no Math.random in the hit feedback modules');
}

// ---- 5. the vignette (render/healthFx.js) -------------------------------------------------------------------------------------
{
  const texts = [];
  const rec2d = () =>
    new Proxy(
      { font: '10px sans-serif', globalAlpha: 1 },
      {
        get(t, k) {
          if (k === 'fillText') return (s, x, y) => texts.push({ s: String(s), x, y, a: t.globalAlpha });
          if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
          if (k in t) return t[k];
          return () => {};
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      },
    );
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => rec2d() }) };
  const { HealthFx } = await import(srcUrl('render/healthFx.js'));
  const cam = new THREE.Object3D();
  const bus = new EventBus();
  const game = { renderer: { camera: cam }, settings: Object.assign({}, SETTINGS_DEFAULTS), bus, state: 'playing', health: { hp: 1, hurt: 0, low: false, dead: false, heartbeatRate: 70 }, xrActive: false };
  const fx = new HealthFx(game);
  const meshes = () => {
    let n = 0;
    cam.traverse((o) => {
      if (o.isMesh) n++;
    });
    return n;
  };
  const n0 = meshes();
  const frag = fx.material.fragmentShader;
  ok('uHit' in fx.material.uniforms && /uniform float uHit;/.test(frag) && !/sampler/.test(frag) && n0 === 2, `the punch is a uniform on the EXISTING vignette mesh (${n0} head-locked meshes as before: the vignette + the low-health line; no sampler)`);
  fx.update(1 / 60, game);
  ok(!fx.vignette.visible, 'whole and unhit: the vignette hidden');
  bus.emit('health:damage', { amount: 0.3 });
  fx.hitFlash = 0.58;
  fx.update(1 / 60, game);
  const u = fx.material.uniforms;
  ok(fx.vignette.visible && near(u.uHit.value, 0.58) && u.uFlash.value === 0, 'a hit: uHit = the punch, the legacy health:damage flash consumed (no double flash)');
  fx.hitFlash = 0;
  fx.hitVig = 0.85;
  fx.update(1 / 60, game);
  ok(u.uVig.value >= 0.85 - 1e-9 && u.uHaze.value > 0.5 && u.uRange.value.x < 0.6 - 0.1, 'knocked down: the rim closes in red-black and the centre hazes');
  fx.hitTick = 30;
  fx.hitTickT = 0.3;
  texts.length = 0;
  fx._drawEcg(1 / 30, false, game.health);
  const tk = texts.find((t) => t.s === '-30%');
  ok(!!tk && tk.a > 0 && tk.a <= 1, "the '-30%' tick drawn on the ECG canvas (the wrist screen / the HUD copy: no new texture)");
  fx.hitTick = 10;
  fx.hitTickT = 1;
  texts.length = 0;
  fx._drawEcg(1 / 30, false, game.health);
  ok(!texts.some((t) => /^-\d+%$/.test(t.s)), 'an aged tick is gone');
  fx.hitVig = 0.6;
  bus.emit('game:respawn', {});
  ok(fx.hitVig === 0 && fx.hitFlash === 0 && fx.hitTick === 0, 'healthFx.reset clears the hit inputs');
  fx.dispose();
  delete globalThis.document;
}

// ---- 6. captions ---------------------------------------------------------------------------------------------------------------
{
  const m = CAP.captionForEvent('player:hit', { source: 'mason' });
  const s = CAP.captionForEvent('player:hit', { source: 'skitter' });
  const r = CAP.captionForEvent('hit:ring', { source: 'mason' });
  ok(m && m.text === '[Hit]' && s && s.text === '[Skitterling bite]' && r && r.text === '[High-pitched ringing]' && CAP.captionForEvent('hit:ring', { source: 'skitter' }) === null, 'captions: [Hit], [Skitterling bite], [High-pitched ringing] (the Mason only)');
  ok(CAP.CAPTION_EVENTS.includes('player:hit') && CAP.CAPTION_EVENTS.includes('hit:ring') && new Set(CAP.CAPTION_EVENTS).size === CAP.CAPTION_EVENTS.length && [m, s, r].every((x) => CAP.KIND_SHAPE[x.kind]), 'the caption tracker listens to both, once, with known kinds');
  ok(s.group === CAP.RULES.skitBite.group, "the bite caption collapses with the existing '[A sharp bite]' (one line)");
}

// ---- 7. the setting ---------------------------------------------------------------------------------------------------------------
{
  ok(SETTINGS_DEFAULTS.hitFeedback === 'full' && UX_LIMITS.hitFeedbacks.join() === 'full,gentle', "the setting: hitFeedback 'full' (default) | 'gentle'");
  const keys = Object.keys(SETTINGS_DEFAULTS);
  ok(keys.indexOf('hitFeedback') === keys.indexOf('lanternHood') + 1 && keys.indexOf('hitFeedback') < keys.indexOf('touchControls'), 'appended at the end of the WP-UX block');
  const a = sanitizeUxSettings({ ...SETTINGS_DEFAULTS, hitFeedback: 'nope' });
  const b = sanitizeUxSettings(JSON.parse(JSON.stringify({ ...SETTINGS_DEFAULTS, hitFeedback: 'gentle' })));
  const c = sanitizeUxSettings({ ...SETTINGS_DEFAULTS, hitFeedback: undefined });
  ok(a.hitFeedback === 'full' && b.hitFeedback === 'gentle' && c.hitFeedback === 'full', 'sanitized: junk / missing -> full; gentle survives a JSON round trip');
  const ui = fs.readFileSync(SRC_DIR + '/ui/ui3d.js', 'utf8');
  ok(/key: 'hitFeedback', tab: 'access',[^\n]*desktop: true/.test(ui) && /key: 'hitFeedback', tab: 'audio',[^\n]*vr: true/.test(ui), 'the UI: Settings › Access on the desktop, the VR Sound page (the VR Access page is full)');
}

// ---- 8. no per-frame allocation ---------------------------------------------------------------------------------------------------
{
  const strip = (file, names) => {
    const src = fs.readFileSync(SRC_DIR + '/' + file, 'utf8');
    return names
      .map((name) => {
        let a = src.indexOf('\n  ' + name + '(');
        let end = src.indexOf('\n  }\n', a);
        if (a < 0) {
          a = src.indexOf('\nexport function ' + name + '(');
          end = src.indexOf('\n}\n', a);
        }
        if (a < 0) throw new Error('no ' + name + ' in ' + file);
        return src.slice(a, end);
      })
      .join('\n')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/registerHitFeedbackSfx\([^)]*\)/, '');
  };
  const hot =
    strip('hitFeedbackGlue.js', ['update', 'applyCam', '_haptics', '_writeFx', '_camLive', '_sinkHands', '_restoreHands', '_unrollCamera', 'knock']) +
    strip('render/hitFeedback.js', ['punchEnv', 'knockK', 'rollSide', 'hitCam', 'stumble', 'heldVig', 'knockMuffle', 'timerMuffle']);
  const bad = [/\bnew\s/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.(map|filter|slice|concat|join|bind)\(/].filter((r) => r.test(hot));
  ok(hot.length > 2500 && bad.length === 0, `static: the per-frame paths (update, applyCam, the curves) build nothing${bad.length ? ' — found ' + bad.join(' ') : ''}`);
  const g = fakeGame({ audio: { _hitT: 0, registerSfx: () => ({}), registerSfxRoute() {} } });
  const run = (n) => {
    for (let i = 0; i < n; i++) {
      if (i % 300 === 0) g.hf.onHit(g.hf._hit); // a knock every 5 s (the debug payload, reused)
      frame(g);
    }
  };
  g.hf._hit.down = true;
  g.hf._hit.source = 'mason';
  run(20000); // warm up
  const N = 12000;
  const chunks = [];
  for (let c = 0; c < 5; c++) {
    const session = new inspector.Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 64 });
    run(N);
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();
    let bytes = 0;
    (function walk(n) {
      const f = n.callFrame || {};
      if (/hitFeedback(Glue)?\.js|hitFeedbackSfx\.js/.test(f.url || '')) bytes += n.selfSize || 0;
      if (process.env.HIT_ALLOC && n.selfSize && /hitFeedback/.test(f.url || '')) console.log('ALLOC', f.functionName, f.lineNumber, n.selfSize);
      for (const ch of n.children || []) walk(ch);
    })(profile.head);
    chunks.push(bytes / N);
  }
  const med = chunks.slice().sort((x, y) => x - y)[2];
  ok(g.hf.stats.hits > 60 && med < 0.5, `heap sampled over 5 x ${N} frames with ${g.hf.stats.hits} knocks: median ${med.toFixed(2)} B / frame in the hit modules (chunks ${chunks.map((v) => v.toFixed(2)).join(' ')})`);
}

// ---- 9. the wiring ---------------------------------------------------------------------------------------------------------------
{
  const g = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  ok(/import \{ HitFeedbackGlue \} from '\.\/hitFeedbackGlue\.js'/.test(g) && /this\._setupHood\(\);\n\s*this\._setupHitFeedback\(\);/.test(g), 'game.js: HitFeedbackGlue built with the bus (_setupHitFeedback after _setupHood)');
  ok(/if \(this\.hitFeedback\) this\.hitFeedback\.update\(dt\);[^\n]*\n\s*\} catch \(err\) \{\n\s*this\._fault\('hitFeedback', err\);/.test(g), "game.js: hitFeedback.update(dt) once a frame in _updateViews, guarded by _fault('hitFeedback')");
  const views = g.slice(g.indexOf('\n  _updateViews(dt) {'));
  ok(views.indexOf('this.hitFeedback.update(dt)') > 0 && views.indexOf('this.hitFeedback.update(dt)') < views.indexOf('fx.update(dt, this)'), 'game.js: the update runs before healthFx reads its inputs');
  ok(/this\._applySpeedFov\(\);\n\s*this\._applyHitCam\(\);\n\s*\}/.test(g) && /if \(this\.hitFeedback\) this\.hitFeedback\.applyCam\(\);/.test(g), 'game.js: _applyHitCam at the end of _updateRig (after the death / opening cams)');
  ok(/hit: \(source, down\) => \(this\.hitFeedback \? this\.hitFeedback\.debugHit\(source, down\) : null\)/.test(g), 'game.js: AT3D.debug.hit(source, down)');
  const bv = fs.readFileSync(SRC_DIR + '/render/bodyView.js', 'utf8');
  ok(/if \(xr && hf && hf\.pose > 0\) _Nt\.y -= HIT\.bodyDrop/.test(bv), 'bodyView: the knocked-down body in a headset (the neck target lowers; the IK crouches it)');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
