// MASON SNAKE ATTACK (plans/MASON_SNAKE_ATTACK.md, Node): the look and the sound of the Mason's snake attack.
//   adapter:  the new sim fields win, the derivation from today's fields (every phase incl. DASH, the lock window), the bus event, forced /
//             held / cycle, the aim frozen on the lock
//   pose:     the envelopes are continuous across every phase boundary (incl. DASH -> RISE), bounded, never NaN, reset their phase timers;
//             the coil rears the head UP into an S with the sim's link lengths; it overshoots on the recoil; the lock stills the sway; the
//             strike squashes then stretches along the locked line; the sway vs reducedEffects; a sim that rears the head itself is not
//             doubled; never in your face (minGap)
//   sound:    the recipes valid + level caps, the routes, the captions, registerMasonAttackSfx
//   glue:     phases -> bus events (halt after a dash, hit on creature:strike, the rattle cadence rising toward the lock), the light flare
//   plus:     no allocation per frame (static + heap sampled), determinism, the wiring (game.js, the views, the light)
//   node test-mason-attack.mjs [--root DIR]
import fs from 'node:fs';
import inspector from 'node:inspector/promises';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';

const { AttackPhase, PHASES, ATTACK_TUNE, NOMINAL, lockWindow, mapSimPhase } = await import(srcUrl('render/mason/attackPhase.js'));
const { SnakePose, SNAKE } = await import(srcUrl('render/mason/snakePose.js'));
const SFX = await import(srcUrl('audio/masonAttackSfx.js'));
const D = await import(srcUrl('audio/sfxDesign.js'));
const CAP = await import(srcUrl('ui/captions.js'));
const { MasonAttackGlue, RATTLE } = await import(srcUrl('masonAttackGlue.js'));
const { EventBus } = await import(srcUrl('sim/config3d.js'));
const { creatureLightPlan } = await import(srcUrl('render/auxShadowLogic.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 72;
const fin = (v) => Number.isFinite(v);

// ---- a creature + body (a straight Mason crawling along -Z on a floor, up +Y) --------------------------------------------------
const SEG = 20;
function makeCreature() {
  const spine = new Float32Array(SEG * 3);
  const up = new Float32Array(SEG * 3);
  for (let i = 0; i < SEG; i++) {
    spine[i * 3] = 0;
    spine[i * 3 + 1] = 1.45;
    spine[i * 3 + 2] = i * 1.5;
    up[i * 3 + 1] = 1;
  }
  return {
    active: true,
    state: 'PURSUING',
    distance: 20,
    attack: { phase: null, t: 0, windup: 0.6, lx: 0, ly: 0, lz: 0, hit: false },
    body: { size: 1, spine, up, visible: true, head: { x: 0, y: 1.45, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 } },
  };
}
const PLAYER = { x: 0, y: 0, z: -10 }; // feet; the eyes at +1.55
/** The frames the views compute (pos, fwd, up, right = fwd x up) for the straight body. */
function frames(c) {
  const F = new Float32Array(SEG * 12);
  const sp = c.body.spine;
  for (let i = 0; i < SEG; i++) {
    const o = i * 12;
    F[o] = sp[i * 3];
    F[o + 1] = sp[i * 3 + 1];
    F[o + 2] = sp[i * 3 + 2];
    F[o + 5] = -1; // forward -Z (toward the head)
    F[o + 7] = 1; // up +Y
    F[o + 9] = 1; // right = f x u = (-Z) x (+Y) = +X
  }
  return F;
}

// ---- 1. the adapter ---------------------------------------------------------------------------------------------------------------
{
  ok(PHASES.join(',') === 'idle,stalk,dash,rise,stare,lock,strike,recoil', `the phases: ${PHASES.join(' ')}`);
  ok(mapSimPhase('lunge') === 'strike' && mapSimPhase('strike') === 'strike' && mapSimPhase('dash') === 'dash' && mapSimPhase('bogus') === 'idle' && mapSimPhase(null) === 'idle', 'the sim names map (lunge = strike, unknown = idle)');
  const W = 0.6;
  const L = lockWindow(W);
  ok(L >= 0.25 - 1e-9 && L <= 0.35 && Math.abs(lockWindow(0.75) - 0.3) < 1e-9 && Math.abs(lockWindow(0.35) - 0.1575) < 1e-9, `the derived lock window: ${L.toFixed(3)} s of a ${W} s wind-up (0.3 s cap, 45 % of a short one)`);

  // derived: every phase
  const c = makeCreature();
  const A = new AttackPhase();
  const seen = new Set();
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      A.update(c, PLAYER, DT);
      seen.add(A.phase);
    }
  };
  c.state = 'DORMANT';
  step(1);
  ok(A.phase === 'idle' && A.source === 'derived', 'DORMANT -> idle');
  c.state = 'PURSUING';
  c.distance = 30;
  step(1);
  ok(A.phase === 'stalk', 'aware, far -> stalk');
  c.state = 'BURST';
  step(1);
  ok(A.phase === 'dash', 'BURST -> dash');
  c.state = 'PURSUING';
  c.distance = 8;
  step(1);
  ok(A.phase === 'stare' && A.changed && A.time === 0, 'aware within 12 m -> stare (the phase timer restarts)');
  c.state = 'ATTACK';
  c.attack.phase = 'windup';
  c.attack.windup = W;
  let riseFrames = 0;
  let lockFrames = 0;
  let aimAtLock = null;
  for (let t = 0; t < W - 1e-9; t += DT) {
    c.attack.t = t;
    PLAYER.x = t * 2; // the player dodges sideways
    A.update(c, PLAYER, DT);
    seen.add(A.phase);
    if (A.phase === 'rise') riseFrames++;
    if (A.phase === 'lock') {
      if (!aimAtLock) aimAtLock = [A.aimX, A.aimY, A.aimZ];
      lockFrames++;
    }
  }
  const lockedStill = aimAtLock && A.aimX === aimAtLock[0] && A.locked;
  ok(riseFrames > 0 && Math.abs(lockFrames * DT - L) < 2 * DT, `windup = rise (${(riseFrames * DT).toFixed(2)} s) + lock (${(lockFrames * DT).toFixed(2)} s ~ ${L.toFixed(2)} s)`);
  ok(lockedStill && Math.abs(aimAtLock[1] - (PLAYER.y + ATTACK_TUNE.eye)) < 1e-9, `the aim freezes on the lock (aim x ${aimAtLock && aimAtLock[0].toFixed(2)} while the player moved to ${PLAYER.x.toFixed(2)})`);
  c.attack.phase = 'strike';
  c.attack.t = 0.08;
  c.attack.lx = 1;
  c.attack.ly = 1.2;
  c.attack.lz = -9;
  A.update(c, PLAYER, DT);
  seen.add(A.phase);
  ok(A.phase === 'strike' && Math.abs(A.t01 - 0.5) < 1e-9 && A.aimX === 1 && A.aimZ === -9 && A.locked, 'strike: t01 over 0.16 s, the aim = the lunge end point');
  c.attack.phase = 'recoil';
  c.attack.t = 0.225;
  A.update(c, PLAYER, DT);
  seen.add(A.phase);
  ok(A.phase === 'recoil' && Math.abs(A.t01 - 0.5) < 1e-9 && !A.locked, 'recoil: t01 over 0.45 s, the aim live again');
  c.attack.phase = 'lunge';
  c.attack.t = 0;
  A.update(c, PLAYER, DT);
  ok(A.phase === 'strike', "an attack.phase 'lunge' is a strike too");
  ok(['idle', 'stalk', 'dash', 'rise', 'stare', 'lock', 'strike', 'recoil'].every((p) => seen.has(p)), `the derivation reaches every phase (${[...seen].join(' ')})`);
  c.attack.phase = null;
  c.state = 'RECOVERING';
  c.distance = 5;
  A.update(c, PLAYER, DT);
  ok(A.phase === 'stare', 'after a strike (RECOVERING, near) it holds the coil and stares');
  c.body.visible = false;
  A.update(c, PLAYER, DT);
  ok(A.phase === 'idle', 'hidden body -> idle');
  c.body.visible = true;

  // the new sim's fields win
  const B = new AttackPhase();
  const n = makeCreature();
  n.state = 'ATTACK';
  n.attack.phase = 'windup'; // the old fields say windup ...
  n.attackPhase = 'stare'; // ... the new ones say stare
  n.attackT01 = 0.4;
  n.aimX = 3;
  n.aimY = 2;
  n.aimZ = -7;
  B.update(n, PLAYER, DT);
  ok(B.source === 'sim' && B.phase === 'stare' && B.t01 === 0.4 && B.aimX === 3 && B.aimZ === -7, 'the new fields are preferred over the derivation (attackPhase, attackT01, aimX/Y/Z)');
  B.onPhaseEvent({ phase: 'lock', t: 0, dur: 0.3, tx: 4, ty: 1, tz: -8 });
  n.attackPhase = 'lock';
  n.aimX = NaN;
  B.update(n, PLAYER, DT);
  ok(B.phase === 'lock' && B.dur === 0.3 && B.aimX === 4 && B.aimZ === -8 && B.locked, 'creature:phase gives the duration and the locked point when the aim fields are missing');
  n.attackPhase = 'dash';
  B.update(n, PLAYER, DT);
  ok(B.phase === 'dash', "the new sim's dash");
  n.attackPhase = 'whatever';
  B.update(n, PLAYER, DT);
  ok(B.phase === 'idle', 'an unknown sim phase is idle');

  // forced
  const Fz = new AttackPhase();
  ok(Fz.force('strike', 0.5) && Fz.held && Fz.update(makeCreature(), PLAYER, DT).phase === 'strike' && Fz.t01 === 0.5 && Fz.source === 'forced', 'force(strike, 0.5) holds the strike at 0.5');
  ok(!Fz.force('nonsense') && Fz.force('') && !Fz.forced, 'an unknown name is refused; force("") returns to the sim');
  Fz.force('cycle');
  const order = [];
  for (let i = 0; i < Math.round(20 / DT); i++) {
    Fz.update(null, PLAYER, DT);
    if (Fz.changed) order.push(Fz.phase);
  }
  ok(order.slice(0, 10).join(' ') === 'stalk dash rise stare lock strike recoil stare lock strike', `the cycle: ${order.slice(0, 11).join(' ')} ...`);
  // start-to-start of the strikes in the loop: stare + lock + strike + recoil = 2.6 s (the owner's "every 3 to 5 s" is the sim's; the loop is a demo)
  ok(NOMINAL.lock >= 0.25 && NOMINAL.lock <= 0.35 && NOMINAL.strike >= 0.15 && NOMINAL.strike <= 0.25 && NOMINAL.recoil >= 0.4 && NOMINAL.recoil <= 0.6, 'the nominal timings: lock 0.25-0.35, strike 0.15-0.25, recoil 0.4-0.6 s');
}

// ---- 2. the pose ----------------------------------------------------------------------------------------------------------------
const cycleRun = (reduced, seconds, fn) => {
  const A = new AttackPhase();
  const P = new SnakePose();
  A.force('cycle');
  const c = makeCreature();
  const F = frames(c);
  const F0 = frames(c);
  const S = new Float32Array(SEG).fill(1);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    A.update(c, PLAYER, DT);
    P.update(DT, A, reduced);
    F.set(F0);
    S.fill(1);
    P.apply(F, S, SEG, 1);
    fn(A, P, F, S, i);
  }
};
{
  // continuity across every boundary (no jumps in the envelopes / the head point; the strike's stretch is driven, bounded per frame)
  let maxJump = 0;
  let maxHeadJump = 0;
  let maxFast = 0;
  const moves = [];
  const marks = [];
  let nan = 0;
  let maxCoil = 0;
  let minCoil = 1;
  let prev = null;
  let ph = '';
  const boundaries = new Set();
  let dashToRise = 0;
  cycleRun(false, 14, (A, P, F) => {
    for (let k = 0; k < F.length; k++) if (!fin(F[k])) nan++;
    if (prev) {
      const fast = A.phase === 'strike' || A.phase === 'recoil' || prev.phase === 'strike';
      const j = Math.abs(P.coil - prev.coil);
      if (!fast && j > maxJump) maxJump = j;
      const hj = Math.hypot(F[0] - prev.hx, F[1] - prev.hy, F[2] - prev.hz);
      moves.push(hj);
      if (A.changed) marks.push(moves.length - 1);
      if (!fast && hj > maxHeadJump) maxHeadJump = hj;
      if (fast && hj > maxFast) maxFast = hj;
      if (A.changed) boundaries.add(prev.phase + '>' + A.phase);
      if (A.changed && prev.phase === 'dash' && A.phase === 'rise') dashToRise = hj;
    }
    if (P.coil > maxCoil) maxCoil = P.coil;
    if (A.phase === 'recoil' && P.coil < minCoil) minCoil = P.coil;
    prev = { coil: P.coil, hx: F[0], hy: F[1], hz: F[2], phase: A.phase };
    ph = A.phase;
  });
  ok(nan === 0, 'no NaN in the frames over 14 s of the cycle');
  ok(maxJump < 0.06, `the coil eases outside the strike / recoil (largest per-frame change ${maxJump.toFixed(3)} at 72 Hz)`);
  ok(maxHeadJump < 0.3 && maxFast < 2, `the head moves smoothly (largest per-frame move ${maxHeadJump.toFixed(3)} m; the lunge / whip back ${maxFast.toFixed(2)} m)`);
  // continuity AT the boundaries: the move on a boundary frame is never a step beyond its neighbours' (no pop)
  let pop = 0;
  for (const m of marks) {
    const neigh = Math.max(moves[m - 1] || 0, moves[m - 2] || 0, moves[m + 1] || 0, moves[m + 2] || 0);
    pop = Math.max(pop, moves[m] - (1.5 * neigh + 0.05));
  }
  ok(pop <= 0, `no pop at any of the ${marks.length} phase boundaries (worst excess ${pop.toFixed(3)} m)`);
  ok(boundaries.has('dash>rise') && dashToRise < 0.3, `DASH -> RISE is continuous (head moved ${dashToRise.toFixed(3)} m on that frame); boundaries: ${[...boundaries].join(' ')}`);
  ok(maxCoil > 1.05 && maxCoil < 1.3, `the recoil whips back past the coil (peak ${maxCoil.toFixed(3)}: overshoot) and stays bounded`);
  ok(ph.length > 0, 'ran');
}
{
  // the shape: the head rears UP off the body into an S, the link lengths are the sim's, the head looks at you
  const A = new AttackPhase();
  const P = new SnakePose();
  A.force('stare', 0.3);
  const c = makeCreature();
  const F = frames(c);
  const S = new Float32Array(SEG).fill(1);
  A.update(c, PLAYER, DT);
  P.update(DT, A, false);
  P.apply(F, S, SEG, 1);
  const K = SNAKE.links;
  let lenErr = 0;
  for (let i = 0; i < K; i++) {
    const d = Math.hypot(F[i * 12] - F[(i + 1) * 12], F[i * 12 + 1] - F[(i + 1) * 12 + 1], F[i * 12 + 2] - F[(i + 1) * 12 + 2]);
    lenErr = Math.max(lenErr, Math.abs(d - 1.5));
  }
  const rise = F[1] - 1.45;
  // an S: the neck goes UP (link 3-4 nearly vertical) and the head tips forward / down (the head's forward points at the eyes)
  const midUp = F[4 * 12 + 1] - F[5 * 12 + 1];
  const fy = F[4];
  const toEye = [PLAYER.x - F[0], PLAYER.y + ATTACK_TUNE.eye - F[1], PLAYER.z - F[2]];
  const tl = Math.hypot(...toEye);
  const look = (F[3] * toEye[0] + F[4] * toEye[1] + F[5] * toEye[2]) / tl;
  ok(rise > 3.5 && rise < 7.5, `the head rears ${rise.toFixed(2)} m above the crawl`);
  ok(midUp > 1.2 && fy < 0.2, `the S: the middle of the neck climbs ${midUp.toFixed(2)} m per link, the head tips forward/down (fwd.y ${fy.toFixed(2)})`);
  ok(lenErr < 0.15, `the sim's link lengths are kept (worst ${lenErr.toFixed(3)} m)`);
  ok(look > 0.85, `the head looks at the player's eyes (cos ${look.toFixed(3)})`);
  ok(S.every((v) => v === 1), 'the stare keeps the block sizes');
  // the anchor and the body behind are untouched
  const F0 = frames(c);
  let behind = 0;
  for (let i = K + 1; i < SEG; i++) for (let k = 0; k < 3; k++) behind = Math.max(behind, Math.abs(F[i * 12 + k] - F0[i * 12 + k]));
  ok(behind === 0, 'the body behind the coil is the sim body');
  // up / right orthonormal on the reared links
  let orth = 0;
  for (let i = 0; i <= K; i++) {
    const o = i * 12;
    const dfu = F[o + 3] * F[o + 6] + F[o + 4] * F[o + 7] + F[o + 5] * F[o + 8];
    const lu = Math.hypot(F[o + 6], F[o + 7], F[o + 8]);
    orth = Math.max(orth, Math.abs(dfu), Math.abs(lu - 1));
  }
  ok(orth < 1e-4, `the reared frames stay orthonormal (worst ${orth.toExponential(1)})`);
  // never in your face: the player right over the coil
  const Pn = new SnakePose();
  const near = { x: F[0], y: F[1] + 0.5, z: F[2] - 2, head: true }; // 2 m in front of where the coiled head would be
  const An = new AttackPhase();
  An.force('stare', 0.5);
  An.update(c, near, DT);
  Pn.update(DT, An, false);
  const Fn = frames(c);
  Pn.apply(Fn, null, SEG, 1);
  const gap = Math.hypot(Fn[0] - near.x, Fn[1] - near.y, Fn[2] - near.z);
  ok(gap > SNAKE.minGap * 0.8 && Pn.lastScale < 1, `a player right over it: the S flattens (scale ${Pn.lastScale.toFixed(2)}), the head stays ${gap.toFixed(2)} m away`);
  // a sim that rears the head itself is not doubled
  const c2 = makeCreature();
  const Fr = frames(c2);
  for (let i = 0; i < K; i++) Fr[i * 12 + 1] += (K - i) * 0.8; // the sim lifted the head 5.6 m
  const Pr = new SnakePose();
  Pr.update(DT, A, false);
  Pr.apply(Fr, null, SEG, 1);
  ok(Pr.lastScale < 0.2, `the new sim already rears the head: the S shrinks (scale ${Pr.lastScale.toFixed(2)})`);
  // coil 0: identity
  const Pz = new SnakePose();
  const Az = new AttackPhase();
  Az.update(makeCreature(), PLAYER, DT);
  Pz.update(DT, Az, false);
  const Fi = frames(c);
  const Fi0 = frames(c);
  Pz.apply(Fi, null, SEG, 1);
  ok(!Pz.active && Fi.every((v, k) => v === Fi0[k]) && Pz.headOk, 'stalk / idle: nothing applied, the frames are the sim frames');
}
{
  // the lock stills the sway; the eyes flare; the jaw gapes; the strike squashes then stretches along the locked line
  let swayStare = 0;
  let swayLockEnd = 1;
  let eyesLock = 0;
  let jawLock = 0;
  let squash = 0;
  let stretch = 0;
  let thin = 1;
  let lightLock = 0;
  let lightStrike = 0;
  let headAlongLock = 0;
  let resets = 0;
  cycleRun(false, 9, (A, P, F, S) => {
    if (A.phase === 'stare') swayStare = Math.max(swayStare, P.sway);
    if (A.phase === 'lock' && A.t01 > 0.6) swayLockEnd = Math.min(swayLockEnd, P.sway);
    if (A.phase === 'lock') {
      eyesLock = Math.max(eyesLock, P.eyes);
      jawLock = Math.max(jawLock, P.jaw);
      lightLock = Math.max(lightLock, P.lightFlare);
    }
    if (A.phase === 'strike') {
      squash = Math.min(squash, P.stretch);
      stretch = Math.max(stretch, P.stretch);
      thin = Math.min(thin, S[0]);
      lightStrike = Math.max(lightStrike, P.lightFlare);
      if (P.stretch > 0.9) headAlongLock = Math.max(headAlongLock, -F[2]); // toward -Z (the player)
    }
    if (A.changed && A.time !== 0) resets++;
  });
  ok(swayStare > 0.9 && swayLockEnd < 0.25, `the sway: ${swayStare.toFixed(2)} while it stares, ${swayLockEnd.toFixed(2)} by the end of the lock (it goes STILL)`);
  ok(eyesLock > 2.4 && jawLock > 1.2, `the lock tell: the eyes flare to ${eyesLock.toFixed(2)} (the face's own peak is 1.9), the jaw gapes ${jawLock.toFixed(2)}`);
  ok(squash < -0.15 && stretch > 0.95 && thin < 0.95, `the strike: a squash (${squash.toFixed(2)} m) then the stretch (${stretch.toFixed(2)}), the front thins (${thin.toFixed(3)})`);
  ok(headAlongLock > 0, `the stretch throws the head along the locked line (head z ${(-headAlongLock).toFixed(2)})`);
  ok(lightLock > 0.6 && lightStrike >= 1.2, `the light: a pulse on the lock (${lightLock.toFixed(2)}), a flare on the strike (${lightStrike.toFixed(2)})`);
  ok(resets === 0, 'every phase change restarts the phase timer');
  // the dash: low and forward
  const A = new AttackPhase();
  const P = new SnakePose();
  A.force('dash', 0.5);
  const c = makeCreature();
  A.update(c, PLAYER, DT);
  P.update(DT, A, false);
  const F = frames(c);
  P.apply(F, null, SEG, 1);
  ok(F[1] < 1.45 - 0.5 && F[2] < -0.6 && P.scaleOf(0) < 1, `the dash: the front pressed down (${(F[1] - 1.45).toFixed(2)} m) and drawn forward (${(-F[2]).toFixed(2)} m), stretched thin`);
}
{
  // reducedEffects: less sway, no squash, a damped recoil, a smaller flare
  const run = (red) => {
    const r = { sway: 0, squash: 0, overshoot: 0, flare: 0, swing: 0 };
    let lastYaw = null;
    cycleRun(red, 9, (A, P, F) => {
      if (A.phase === 'stare') {
        r.sway = Math.max(r.sway, P.sway);
        const yaw = Math.atan2(F[3], -F[5]);
        if (lastYaw !== null) r.swing = Math.max(r.swing, Math.abs(yaw));
        lastYaw = yaw;
      }
      if (A.phase === 'strike') r.squash = Math.min(r.squash, P.stretch);
      if (A.phase === 'recoil') r.overshoot = Math.max(r.overshoot, P.coil - 1);
      r.flare = Math.max(r.flare, P.lightFlare);
    });
    return r;
  };
  const full = run(false);
  const red = run(true);
  ok(red.sway <= full.sway * SNAKE.reducedSway + 1e-6 && red.sway > 0, `the sway with reducedEffects: ${red.sway.toFixed(2)} vs ${full.sway.toFixed(2)} (x ${SNAKE.reducedSway})`);
  ok(red.swing < full.swing, `the head's swing: ${(red.swing * 57.3).toFixed(1)} vs ${(full.swing * 57.3).toFixed(1)} deg`);
  ok(red.squash === 0 && full.squash < 0, 'no squash frames with reducedEffects');
  ok(red.overshoot < full.overshoot && red.overshoot < 0.03, `the recoil overshoot: ${red.overshoot.toFixed(3)} vs ${full.overshoot.toFixed(3)}`);
  ok(red.flare <= 0.3 + 1e-9 && full.flare >= 1.2, `the light flare: ${red.flare.toFixed(2)} vs ${full.flare.toFixed(2)}`);
}
{
  // determinism: two runs, identical frames
  const sig = () => {
    let h = 0;
    cycleRun(false, 6, (A, P, F) => {
      for (let k = 0; k < 36; k++) h = (Math.imul(h, 31) + Math.round(F[k] * 1e4)) | 0;
    });
    return h;
  };
  ok(sig() === sig(), 'deterministic: two runs of the cycle give the same frames');
  const src = ['render/mason/attackPhase.js', 'render/mason/snakePose.js', 'audio/masonAttackSfx.js', 'masonAttackGlue.js'].map((f) => fs.readFileSync(SRC_DIR + '/' + f, 'utf8')).join('\n');
  ok(!/Math\.random\(/.test(src) && !/Date\.now\(|performance\.now\(/.test(src), 'no Math.random / wall clock in the attack modules');
}

// ---- 3. the sounds ----------------------------------------------------------------------------------------------------------------
{
  const ids = Object.values(SFX.MASON_ATTACK_IDS);
  const R = SFX.MASON_ATTACK_RECIPES;
  ok(ids.length === 8 && ids.every((id) => R[id]), `eight recipes: ${ids.join(' ')}`);
  const plan = new D.Plan();
  let probs = [];
  let maxLevel = 0;
  for (const id of ids) {
    const rec = D.compileRecipe(id, R[id]);
    probs = probs.concat(D.validateRecipe(rec));
    for (const k of [0, 1]) {
      D.resolveRecipe(rec, k, 0, plan, 21600);
      maxLevel = Math.max(maxLevel, plan.level);
    }
  }
  ok(probs.length === 0, `the recipes are valid${probs.length ? ': ' + probs.join('; ') : ''}`);
  ok(maxLevel <= SFX.LEVEL_CAP + 1e-9, `level caps: the loudest plays at ${maxLevel.toFixed(2)} <= ${SFX.LEVEL_CAP}`);
  ok(ids.every((id) => R[id].space === 'world' && R[id].bus === 'creature'), 'all world-space on the creature bus (distance, occlusion, the master / SFX volume)');
  const lock = R['mason.lock'];
  const rat = R['mason.rattle'];
  ok(lock.vary.rule === 'fixed' && lock.prio === 3 && lock.floor >= 0.5, 'the lock tick: the same every time, top priority, carries at distance');
  ok(rat.level[1] > rat.level[0] && rat.layers.some((L) => L.t === 'ticks') && rat.layers.some((L) => L.t === 'modal'), 'the rattle: grit ticks + stone plates, louder with the tension');
  const st = R['mason.strike'];
  ok(st.layers.some((L) => L.t === 'noise' && L.f2 < L.f / 4), 'the strike whoosh falls (Doppler-ish)');
  const dash = R['mason.dash'];
  ok(dash.layers.some((L) => L.f2 > L.f) && dash.layers.some((L) => L.f2 < L.f && L.at > 0), 'the dash: a rumble rising, then falling past');
  // routes
  const played = [];
  const E = {
    _o: {},
    opts() {
      this._o = { x: NaN, y: NaN, z: NaN, dist: NaN };
      return this._o;
    },
    play(id, k, o) {
      played.push(`${id}:${k}:${Number.isFinite(o.x) ? 'at' : 'dist'}`);
    },
  };
  for (const p of ['dash', 'halt', 'rise', 'stare', 'lock', 'strike', 'recoil', 'hit']) SFX.masonAttackRoute({ phase: p, x: 1, y: 2, z: 3, k: 1 }, E);
  SFX.masonRattleRoute({ k: 0.5, x: 1, y: 2, z: 3 }, E);
  SFX.masonRattleRoute({ k: 0.5 }, E);
  SFX.masonAttackRoute({ phase: 'lock' }, E);
  ok(
    played.join('|') === 'mason.dash:1:at|mason.halt:1:at|mason.rise:1:at|mason.lock:1:at|mason.strike:1:at|mason.recoil:1:at|mason.hit:1:at|mason.rattle:0.5:at|mason.lock:0.7:dist',
    `the routes: ${played.join(' | ')}`,
  );
  const reg = { ids: [], routes: [] };
  const fake = {
    registerSfx(id) {
      reg.ids.push(id);
      return {};
    },
    registerSfxRoute(t) {
      reg.routes.push(t);
    },
  };
  ok(SFX.registerMasonAttackSfx(fake) && reg.ids.length === 8 && reg.routes.join(',') === 'mason:attack,mason:rattle', 'registerMasonAttackSfx adds 8 recipes and 2 routes');
  ok(SFX.registerMasonAttackSfx(null) === false && SFX.registerMasonAttackSfx({}) === false, 'no engine: nothing');
  // captions
  const cap = (p) => {
    const r = CAP.captionForEvent('mason:attack', { phase: p });
    return r ? r.text : null;
  };
  ok(cap('rise') === '[STONE RATTLING]' && cap('lock') === '[IT LOCKS ON]' && cap('strike') === '[LUNGE]' && cap('dash') === '[IT SURGES]' && cap('recoil') === null, 'captions: [STONE RATTLING] [IT LOCKS ON] [LUNGE] [IT SURGES]');
  ok(CAP.CAPTION_EVENTS.includes('mason:attack'), 'the caption tracker listens to mason:attack');
}

// ---- 4. the glue ------------------------------------------------------------------------------------------------------------------
function makeGame() {
  const bus = new EventBus();
  const c = makeCreature();
  const game = { bus, state: 'playing', victoryT: -1, creature: c, player: { x: 0, y: 0, z: -10, alive: true }, settings: { reducedEffects: false }, audio: null, creatureView: { isRig: true, snake: null } };
  const log = [];
  let t = 0;
  const w = {};
  bus.on('mason:attack', (p) => {
    log.push(p.phase);
    if (p.phase === 'lock' && !w.lockT) w.lockT = t;
  });
  const rattles = [];
  bus.on('mason:rattle', (p) => rattles.push([t, p.k]));
  const g = new MasonAttackGlue(game);
  return Object.assign(w, {
    game,
    c,
    g,
    log,
    rattles,
    run(s) {
      for (let i = 0; i < Math.round(s / DT); i++) {
        t += DT;
        g.update(DT);
      }
    },
  });
}
{
  const W = makeGame();
  const { c, g, log, rattles } = W;
  c.state = 'PURSUING';
  c.distance = 30;
  W.run(1);
  c.state = 'BURST';
  W.run(1.5);
  c.state = 'PURSUING';
  c.distance = 8;
  W.run(2);
  c.state = 'ATTACK';
  c.attack.phase = 'windup';
  c.attack.windup = 0.6;
  for (let t = 0; t < 0.6; t += DT) {
    c.attack.t = t;
    W.run(DT);
  }
  c.attack.phase = 'strike';
  for (let t = 0; t < 0.16; t += DT) {
    c.attack.t = t;
    W.run(DT);
  }
  W.game.bus.emit('creature:strike', { hit: true, x: 0, y: 1, z: -10 });
  c.attack.phase = 'recoil';
  for (let t = 0; t < 0.45; t += DT) {
    c.attack.t = t;
    W.run(DT);
  }
  c.attack.phase = null;
  c.state = 'RECOVERING';
  c.distance = 6;
  W.run(1.5);
  ok(log.join(' ') === 'dash halt stare rise lock strike hit recoil', `the bus: ${log.join(' ')}`);
  ok(W.game.creatureView.snake === g.pose, 'the view gets the pose');
  const coiled = rattles.length;
  ok(coiled >= 8, `the rattle: ${coiled} grains while coiled`);
  // the cadence rises toward the lock (stare t01 -> 1): the first gaps are longer than the last ones before the attack
  const gaps = [];
  const pre = rattles.filter(([t]) => t < W.lockT); // the run up to the lock (the rattle stops dead on it)
  for (let i = 1; i < pre.length; i++) gaps.push(pre[i][0] - pre[i - 1][0]);
  ok(gaps.length >= 5 && gaps[0] > gaps[gaps.length - 1] + 0.05 && Math.max(...gaps) <= RATTLE.slow + 0.03 && Math.min(...gaps) >= RATTLE.fast - 0.03, `the rattle gaps tighten (${gaps.slice(0, 6).map((v) => v.toFixed(2)).join(' ')} s)`);
  ok(rattles.every(([, k]) => k >= 0 && k <= 1), 'rattle k in 0..1');
  // the forced cycle + the light flare
  const W2 = makeGame();
  W2.g.debugPhase('cycle');
  let flare = 0;
  for (let i = 0; i < Math.round(9 / DT); i++) {
    W2.g.update(DT);
    flare = Math.max(flare, W2.g.lightFlare);
  }
  const lp = creatureLightPlan({ visible: true, state: 'ATTACK', dist: 5, listen: 0, flare }, { enabled: true, creatureReach: 30 });
  const lp0 = creatureLightPlan({ visible: true, state: 'ATTACK', dist: 5, listen: 0, flare: 0 }, { enabled: true, creatureReach: 30 });
  ok(flare >= 1.2 && lp.candela > lp0.candela * 1.6 && lp.candela <= lp0.candela * 1.73 && lp.range === lp0.range, `the red glow: candela ${lp0.candela.toFixed(1)} -> ${lp.candela.toFixed(1)} on the strike, the same range (budget)`);
  ok(W2.g.debugState().phase.length > 0 && W2.g.debugPhase('') && W2.g.phase.forced === '', 'debugPhase / debugState');
  // not playing: nothing coils
  const W3 = makeGame();
  W3.c.state = 'PURSUING';
  W3.c.distance = 5;
  W3.game.state = 'menu';
  W3.run(1);
  ok(W3.g.phase.phase === 'idle' && W3.log.length === 0, 'menus / death: idle, silent');
}

// ---- 5. no allocation per frame ---------------------------------------------------------------------------------------------------
{
  const strip = (file, names) => {
    const src = fs.readFileSync(SRC_DIR + '/' + file, 'utf8');
    return names
      .map((name) => {
        const a = src.indexOf('\n  ' + name + '(');
        if (a < 0) throw new Error(file + ' ' + name);
        const b = src.indexOf('\n  }\n', a);
        return src.slice(a, b);
      })
      .join('\n')
      .replace(/\/\/[^\n]*/g, '');
  };
  const hot =
    strip('render/mason/attackPhase.js', ['update', 'onPhaseEvent']) +
    strip('render/mason/snakePose.js', ['update', 'apply', '_chain', '_head', '_canon', 'scaleBlocks']) +
    strip('masonAttackGlue.js', ['update', '_emit', '_head']).replace(/registerMasonAttackSfx\([^)]*\)/, '');
  const bad = [/\bnew\s/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.(map|filter|slice|concat|join|bind)\(/].filter((r) => r.test(hot));
  ok(hot.length > 6000 && bad.length === 0, `static: the per-frame paths build nothing${bad.length ? ' — found ' + bad.join(' ') : ''}`);
  const W = makeGame();
  const F = frames(W.c);
  const F0 = frames(W.c);
  const S = new Float32Array(SEG);
  W.g.debugPhase('cycle');
  const frame = () => {
    W.g.update(DT);
    F.set(F0);
    S.fill(1);
    W.g.pose.apply(F, S, SEG, 1);
  };
  for (let i = 0; i < 20000; i++) frame();
  const N = 20000;
  const chunks = [];
  for (let c = 0; c < 5; c++) {
    const session = new inspector.Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 64 });
    for (let i = 0; i < N; i++) frame();
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();
    let bytes = 0;
    (function walk(n) {
      const f = n.callFrame || {};
      if (/(attackPhase|snakePose|masonAttackGlue)\.js/.test(f.url || '')) bytes += n.selfSize || 0;
      if (process.env.MASON_ALLOC && n.selfSize && /(attackPhase|snakePose|masonAttackGlue)/.test(f.url || '')) console.log('ALLOC', f.functionName, f.lineNumber, n.selfSize);
      for (const ch of n.children || []) walk(ch);
    })(profile.head);
    chunks.push(bytes / N);
  }
  const med = chunks.slice().sort((x, y) => x - y)[2];
  ok(W.g.events > 20 && med < 0.5, `heap sampled over 5 x ${N} frames of the cycle (${W.g.events} events, ${W.g.rattles} rattles): median ${med.toFixed(2)} B / frame in the attack modules (chunks ${chunks.map((v) => v.toFixed(2)).join(' ')})`);
}

// ---- 6. the wiring ----------------------------------------------------------------------------------------------------------------
{
  const g = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  ok(/import \{ MasonAttackGlue \} from '\.\/masonAttackGlue\.js'/.test(g) && /this\._setupHood\(\);\n\s*this\._setupMasonAttack\(\);/.test(g), 'game.js: MasonAttackGlue built with the bus (_setupMasonAttack next to the other glues)');
  const iu = g.indexOf('this.masonAttack.update(dt)');
  const iv = g.indexOf('cv.update(this.creature, dt');
  ok(iu > 0 && iv > iu && /if \(this\.masonAttack\) this\.masonAttack\.update\(dt\);[^\n]*\n\s*\} catch \(err\) \{\n\s*this\._fault\('masonAttack', err\);/.test(g), "game.js: masonAttack.update(dt) in _updateViews before the creature view, guarded by _fault('masonAttack')");
  ok(/masonPhase: \(phase, o\) =>/.test(g), 'game.js: AT3D.debug.masonPhase(phase, u)');
  const rig = fs.readFileSync(SRC_DIR + '/render/masonRigView.js', 'utf8');
  ok(/sn\.apply\(F, null, SEG, size\)/.test(rig) && /sn\.scaleBlocks\(S\)/.test(rig) && /this\.eyes\.boost\(sn\.eyes\)/.test(rig) && /this\.mandibles\.hold = hold0;/.test(rig), 'the rig: the cobra over the frames before the head fit, the block scales, the eye flare, the jaw (the hold restored)');
  const kit = fs.readFileSync(SRC_DIR + '/render/creatureView.js', 'utf8');
  ok(/snk\.apply\(F, null, SEG/.test(kit), 'the kit view bends with the same pose');
  const r3 = fs.readFileSync(SRC_DIR + '/render/renderer3d.js', 'utf8');
  ok(/c\.flare = ma \? num\(ma\.lightFlare, 0\) : 0;/.test(r3) && /_syncCreatureLight\(game, head\) \{/.test(r3), 'the light: _syncCreatureLight reads the flare and follows the coiled head');
  ok(!/creature3d/.test(fs.readFileSync(SRC_DIR + '/masonAttackGlue.js', 'utf8').replace(/\/\*[\s\S]*?\*\//, '')), 'the glue never imports the sim creature');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL MASON ATTACK CHECKS PASS');
process.exit(fails ? 1 : 0);
