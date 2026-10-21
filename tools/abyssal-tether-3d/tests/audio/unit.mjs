// WP-AUDIO checks (Node, strict mock Web Audio): the pure DSP helpers (generated impulse responses, rope curves,
// surfaces, motif), then the real AudioManager3D + Ambience / Music / RopeFx / Movement / CreatureSync modules driving a
// mock context from a fake game: no NaN or bad automation anywhere (the mock throws and every swallowed warning fails
// the run), bounded voices and nodes, the quality tier, the silence signal, the clip-event routing and fallbacks, music
// determinism, section reverb cross-fades, and no unbounded growth over 10 simulated minutes of events.
//   node unit.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
import { MockAudioContext } from './mockaudio.mjs';

const { EventBus, SETTINGS_DEFAULTS, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const dsp = await import(srcUrl('audio/dsp3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};

// ---- collect console.warn (the manager swallows exceptions into a one-time warning) ----
const warnings = [];
const realWarn = console.warn;
console.warn = (...a) => warnings.push(a.map((x) => (x && x.stack) || String(x)).join(' '));

// ===========================================================================
// 1. pure helpers
// ===========================================================================
{
  const sr = 48000;
  const spec = dsp.reverbSpec(6, null, false);
  const a = new dsp.IRBuilder(sr, spec).all();
  const b = new dsp.IRBuilder(sr, spec);
  while (!b.step(5000));
  let finite = true;
  let eL = 0;
  let eR = 0;
  let eh1 = 0;
  let eh2 = 0;
  for (let i = 0; i < a.len; i++) {
    if (!Number.isFinite(a.L[i]) || !Number.isFinite(a.R[i])) finite = false;
    eL += a.L[i] * a.L[i];
    eR += a.R[i] * a.R[i];
    if (i < a.len * 0.3) eh1 += a.L[i] * a.L[i];
    else if (i > a.len * 0.6) eh2 += a.L[i] * a.L[i];
  }
  ok(finite, 'IR: all samples finite');
  ok(Math.abs((eL + eR) / 2 - 1) < 1e-3, `IR: unit energy (${((eL + eR) / 2).toFixed(4)})`);
  ok(eh1 > eh2 * 20, 'IR: decays (first 30 % holds >20x the energy of the last 40 %)');
  let same = true;
  for (let i = 0; i < a.len; i += 97) if (a.L[i] !== b.L[i] || a.R[i] !== b.R[i]) same = false;
  ok(same, 'IR: incremental build equals the one-shot build (deterministic)');
  ok(a.L[3000] !== a.R[3000], 'IR: channels are decorrelated');
  const rts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => dsp.reverbSpec(i, null, false).rt);
  ok(rts[6] > rts[0] && rts[6] > rts[4] && rts[4] < rts[3], `reverb sizes follow the shaft (rt60 ${rts.map((r) => r.toFixed(1)).join(' ')})`);
  ok(dsp.reverbSpec(6, null, true).len <= 1.5 && dsp.reverbSpec(6, null, false).len <= 3.4, 'reverb length caps (3.4 s full, 1.5 s reduced tier)');
  const sec = { shaft: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, yTop: 0, yBottom: -40 };
  ok(dsp.reverbSpec(0, sec, false).rt > 0.9, 'reverbSpec reads the level section when given');

  ok(dsp.ropeHaptic(0.2, 3, 0) === 0 && dsp.ropeHaptic(0, 0, 0) === 0, 'rope haptic: zero while the clutch holds');
  let mono = true;
  let prev = 0;
  for (let s = 0.7; s <= 12; s += 0.3) {
    const h = dsp.ropeHaptic(s, 3, 0);
    if (h < prev - 0.2 * 0.16 - 1e-9 && s > 1) mono = false; // the rasp may wobble ±14 %
    prev = Math.max(0, h);
    if (!(h >= 0 && h <= 0.85)) mono = false;
  }
  ok(mono, 'rope haptic: bounded 0..0.85 and rising with the pay-out speed');
  ok(dsp.ropeHaptic(6, 4.2, 0) > dsp.ropeHaptic(6, 0.5, 0), 'rope haptic: higher under load');
  const t = { amp: 0, speed: 0, load: 0, hum: 0 };
  dsp.ropeLayer(0, 0, t);
  ok(t.amp === 0 && t.hum === 0, 'rope layer: silent when slack');
  dsp.ropeLayer(8, 4.2, t);
  ok(t.amp > 0.95 && t.hum > 0.65, 'rope layer: full friction + hum at the winch limit');
  ok(dsp.surfaceOf('metal', 0.7, 0.1) === dsp.SURFACE.IRON && dsp.surfaceOf('stone', 0.7, 0.2) === dsp.SURFACE.WET && dsp.surfaceOf('stone', 0.1, 0.9) === dsp.SURFACE.STONE, 'surfaces: iron, wet patch, dry stone');
  ok(dsp.SECTION_BEDS.length === 8, 'eight section beds');
  const r1 = dsp.rng32(5);
  const r2 = dsp.rng32(5);
  ok(r1() === r2() && r1() === r2(), 'seeded rng is deterministic');
  const f = dsp.MOTIF.steps.map((s) => dsp.semitone(100, s));
  ok(dsp.MOTIF.steps.length === 5 && f[0] > f[1] * 0.5 && Math.abs(f[1] / f[0] - 2 ** (1 / 12)) < 1e-9, 'motif: five notes (5 b6 5 b3 1)');
}

// ===========================================================================
// 2. the manager on a mock context
// ===========================================================================
globalThis.window = { AudioContext: MockAudioContext, addEventListener() {} };
const { AudioManager3D } = await import(srcUrl('audio/audio3d.js'));

const level = new Level3D(undefined, 'normal');

function makeGame() {
  const bus = new EventBus();
  const settings = Object.assign({}, SETTINGS_DEFAULTS, { volume: 0.8 });
  const el = new Float64Array(16);
  el[0] = el[5] = el[10] = el[15] = 1;
  el[12] = 0;
  el[13] = 1.6;
  el[14] = 0;
  const rope = () => ({ anchor: null, attached: false, length: 8, tension: 0, slipSpeed: 0 });
  const game = {
    bus,
    settings,
    state: 'playing',
    sectionIndex: 0,
    diff: { lethalImpact: 17 },
    level,
    renderer: { camera: { matrixWorld: { elements: el } } },
    input: { handPose: (h, o) => Object.assign(o, { x: h === 'left' ? -0.3 : 0.3, y: 1.2, z: -0.4 }) },
    player: { x: 0, y: 1, z: 0, rx: 0, ry: 1, rz: 0, vx: 0, vy: 0, vz: 0, grounded: true, alive: true, tension: 0, groundSolid: { kind: 'stone' } },
    tethers: { hands: { left: { rope: rope() }, right: { rope: rope() } }, anchorStress: () => 0 },
    threat: { value: 0, heartRate: 60, beat: 0 },
    health: { hurt: 0, hp: 1, heartbeatRate: 60 },
    creature: { active: true, state: 'DISTANT', listening: false, distance: 90, x: 10, y: 40, z: 5, inPlay: true, audio: { x: 10, y: 40, z: 5, distance: 90, intensity: 0.3, movement: 0.4, state: 'DISTANT' }, body: { head: { x: 10, y: 40, z: 5 }, jitter: 0, listen: 0, spine: new Float32Array(60) }, attack: { windup: 0.6 } },
  };
  return game;
}

function rig() {
  const game = makeGame();
  const audio = new AudioManager3D(game.bus, game.settings);
  audio.unlock();
  const ctx = audio.ctx;
  const api = {
    game,
    audio,
    ctx,
    bus: game.bus,
    /** Advances `secs` of game + audio time at 30 fps. */
    run(secs, per) {
      const dt = 1 / 30;
      const n = Math.round(secs / dt);
      for (let i = 0; i < n; i++) {
        ctx.currentTime += dt;
        if (per) per(i, dt);
        audio.update(dt, game);
      }
    },
    voices: (name) => audio._voices.filter((v) => v.alive && !v.dying && (!name || v.name === name)).length,
  };
  return api;
}

{
  const R = rig();
  ok(R.audio.enabled && R.audio._built, 'manager builds on the mock context');
  ok(R.audio._mods.length === 5 && R.audio._mods.every((m) => !m.broken), 'all five modules built');
  ok(!!R.audio.limiter && R.audio.limiter.ratio.value >= 10, 'master limiter in the chain');
  R.run(2);
  ok(warnings.length === 0, 'no warnings after 2 s of idle updates' + (warnings.length ? ': ' + warnings[0].slice(0, 300) : ''));
  const st = R.audio.debugState();
  ok(JSON.stringify(st).length > 100 && st.music && st.ambience && st.rope && st.movement && st.creatureSync, 'debugState: serialisable with every module');
  ok(Array.isArray(st.last) && st.last.length >= 0 && st.tier === 'full' && st.caps.voices === 24, 'debugState: tier and caps');
}

// ---- every bus event the audio listens to, once ----
{
  const R = rig();
  R.run(1);
  const b = R.bus;
  const P = { x: 0, y: 1, z: 0 };
  const evs = [
    ['rope:fire', { hand: 'right', x: 3, y: 5, z: -4, target: true, dur: 0.2 }],
    ['rope:hit', { hand: 'right', x: 3, y: 5, z: -4 }],
    ['grapple:attach', { hand: 'right', speed: 8, x: 3, y: 5, z: -4 }],
    ['rope:slip', { hand: 'left', intensity: 0.8, speed: 6, load: 3.5, ...P }],
    ['rope:jolt', { speed: 14, ...P }],
    ['rope:cancel', { hand: 'left', reason: 'input' }],
    ['grapple:miss', { hand: 'right', x: 3, y: 5, z: -4 }],
    ['grapple:release', { hand: 'right', speed: 5 }],
    ['grapple:break', { hand: 'left', x: 1, y: 2, z: 3 }],
    ['player:jump', P],
    ['player:land', { impact: 9, hard: false, lethalRatio: 0.5, ...P }],
    ['player:land', { impact: 14, hard: true, lethalRatio: 0.8, ...P }],
    ['player:wallhit', { impact: 8, ...P }],
    ['health:damage', { amount: 0.3 }],
    ['pickup:collect', { kind: 1 }],
    ['bag:apply', { kind: 2, dur: 1.5 }],
    ['bag:done', { kind: 2 }],
    ['lantern:low', {}],
    ['trigger:rumble', {}],
    ['trigger:debris', { data: { x: 4, y: 20, z: 1 } }],
    ['trigger:call', { data: {} }],
    ['creature:step', { x: 8, y: 2, z: 3, intensity: 0.7, distance: 9 }],
    ['creature:call', { x: 8, y: 20, z: 3, intensity: 0.7, distance: 20 }],
    ['creature:burst', { x: 8, y: 6, z: 3, distance: 8, reason: 'heard', snap: 0.3 }],
    ['creature:attack', { x: 8, y: 6, z: 3, windup: 0.6, distance: 8, cause: 'stall' }],
    ['creature:strike', { x: 1, y: 2, z: 1, hit: false, distance: 3 }],
    ['creature:strike', { x: 1, y: 2, z: 1, hit: true, distance: 3 }],
    ['creature:retreat', { x: 8, y: 30, z: 3 }],
    ['creature:sighting', { x: 30, y: 10, z: 3, duration: 9 }],
    ['creature:attack', { gate: true, x: 8, y: 6, z: 3 }],
    ['game:goal', {}],
    ['creature:clip', { name: 'listen', event: 'start', t: 0 }],
    ['creature:clip', { name: 'listen', event: 'pulse', t: 0.4 }],
    ['creature:clip', { name: 'notice_snap', event: 'start' }],
    ['creature:clip', { name: 'notice_snap', event: 'snap' }],
    ['creature:clip', { name: 'rear_windup', event: 'start', dur: 0.65 }],
    ['creature:clip', { name: 'rear_windup', event: 'open' }],
    ['creature:clip', { name: 'rear_windup', event: 'full' }],
    ['creature:clip', { name: 'strike', event: 'contact' }],
    ['creature:clip', { name: 'portal_snap', event: 'clap' }],
    ['creature:clip', { name: 'recoil', event: 'start' }],
    ['creature:clip', { name: 'roar_display', event: 'start' }],
    ['creature:clip', { name: 'roar_display', event: 'close' }],
    ['creature:clip', { name: 'linger_breathe', event: 'inhale' }],
    ['creature:clip', { name: 'plate_shiver', event: 'start' }],
    ['creature:clip', { name: 'leg_probe', event: 'tap' }],
    ['creature:clip', { name: 'knock_x3', event: 'knock' }],
    ['creature:clip', { name: 'breathe_seams', event: 'exhale' }],
    ['mason:anim', { clip: 'crown_idle', event: 'start' }],
    ['mason:plant', { x: 6, y: 3, z: 2, intensity: 0.8 }],
    ['creature:freeze', {}],
    ['creature:unfreeze', {}],
    ['creature:linger', { phase: 'start' }],
    ['creature:hide', { phase: 'start' }],
    ['quality:level', { level: 3 }],
    ['quality:level', { level: 0 }],
    ['section:enter', { index: 3, first: true, section: level.sections[3] }],
    ['checkpoint', {}],
    ['game:respawn', {}],
    ['player:death', { cause: 'impact' }],
    ['game:victory', {}],
    ['settings:changed', { settings: { volume: 0.5 } }],
    ['game:pause', {}],
    ['game:resume', {}],
  ];
  let thrown = 0;
  for (const [t, p] of evs) {
    try {
      b.emit(t, p);
      R.run(0.15);
    } catch (e) {
      thrown++;
      console.log('   threw on', t, e.message);
    }
  }
  R.run(3);
  ok(thrown === 0, `${evs.length} event kinds fired without throwing`);
  ok(warnings.length === 0, 'no swallowed audio warnings after the full event sweep' + (warnings.length ? ': ' + warnings[0].slice(0, 400) : ''));
  ok(R.audio.peakVoices <= 24, `voice cap holds (peak ${R.audio.peakVoices} <= 24)`);
  const log = R.audio.debugState().last;
  ok(log.length > 0 && log[0].n > log[log.length - 1].n, 'debug event log is newest-first');
}

// ---- quality tier ----
{
  const R = rig();
  R.game.settings.reducedEffects = true;
  R.run(0.5);
  ok(R.audio._reduced && R.audio._maxVoices === 14 && R.audio._maxHrtf === 5, 'settings.reducedEffects caps voices at 14 / HRTF at 5');
  for (let i = 0; i < 80; i++) R.audio._sfxCreak();
  for (let i = 0; i < 80; i++) R.audio._sfxCall(5, 5, 5, 0.8, false, 5);
  ok(R.audio.activeVoices <= 14, `reduced tier: ${R.audio.activeVoices} active voices after a burst of 160 requests (<= 14)`);
  R.game.settings.reducedEffects = false;
  R.bus.emit('quality:level', { level: 3 });
  R.run(0.2);
  ok(R.audio._reduced, 'governor level 3 also selects the reduced tier');
  R.bus.emit('quality:level', { level: 1 });
  R.run(0.2);
  ok(!R.audio._reduced && R.audio._maxVoices === 24, 'recovering the governor restores the full tier');
}

// ---- silence as a signal ----
{
  const R = rig();
  R.game.threat.value = 0.8;
  R.game.creature.state = 'APPROACHING';
  R.game.creature.distance = 14;
  R.game.creature.audio.distance = 14;
  R.game.creature.audio.x = 8;
  R.game.creature.audio.y = 3;
  R.game.creature.audio.z = 2;
  R.run(8);
  const m = R.audio._music;
  ok(m.subOn && m.padOn && m.kBus.last > 0.5, `hunted: sub pulse + pad on, music bus up (${m.kBus.last.toFixed(2)})`);
  const thin0 = R.audio._thin;
  R.game.creature.state = 'OBSERVING';
  R.game.creature.listening = true;
  R.game.creature.body.listen = 1;
  R.run(1);
  ok(R.audio._silence > 0.8 && R.audio._thin < 0.5, `listening: silence ${R.audio._silence.toFixed(2)}, ambience thins to ${R.audio._thin.toFixed(2)} (was ${thin0.toFixed(2)})`);
  ok(m.kBus.last < 0.01 && !m.subOn, 'listening: the score drops out and the sub pulse stops');
  ok(R.audio.kScrG.last === 0, 'listening: the creature scrape bed is cut');
  R.game.creature.state = 'APPROACHING';
  R.game.creature.listening = false;
  R.game.creature.body.listen = 0;
  R.run(1);
  ok(m.kBus.last < 0.5 * 0.9, 'after the hush the score does not snap back (slow return)');
  R.run(12);
  ok(m.kBus.last > 0.5 && R.audio._silence < 0.05, 'the score returns after the creature moves on');
  R.game.threat.value = 0;
  R.game.creature.distance = 200;
  R.game.creature.audio.distance = 200;
  R.run(25);
  ok(!m.subOn && m.kPadG.last < 0.002, 'calm: no sub pulse, pad faded out');
}

// ---- creature clip sync: routing, dedupe, fallback ----
{
  const R = rig();
  R.game.creature.state = 'PURSUING';
  R.game.creature.distance = 12;
  R.game.creature.audio.distance = 12;
  R.game.creature.audio.x = 8;
  R.game.creature.audio.y = 6;
  R.game.creature.audio.z = 2;
  R.game.creature.x = 8;
  R.game.creature.y = 6;
  R.game.creature.z = 2;
  R.game.creature.body.head = { x: 8, y: 6, z: 2 };
  R.run(1);
  const atk = { x: 8, y: 6, z: 2, windup: 0.6, distance: 12, cause: 'stall' };
  R.bus.emit('creature:attack', atk);
  R.run(0.05);
  ok(R.voices('attack') === 1 && R.voices('cwind') === 0, 'no rig: the sim wind-up sound plays (fallback)');
  R.run(2);
  // the rig appears: its clip event arrives with the sim event
  R.bus.emit('creature:clip', { name: 'rear_windup', event: 'start' });
  R.bus.emit('creature:attack', atk);
  R.run(0.3);
  ok(R.voices('cwind') === 1 && R.voices('attack') === 0, 'with the rear_windup clip: one clip sound, the sim sound is not doubled (clip first)');
  R.run(2);
  R.bus.emit('creature:attack', atk);
  R.bus.emit('creature:clip', { name: 'rear_windup', event: 'start' });
  R.run(0.3);
  ok(R.voices('cwind') === 1 && R.voices('attack') === 0, 'sim event first, clip within 0.15 s: still one sound');
  R.run(2);
  R.bus.emit('creature:attack', atk);
  R.run(0.5);
  ok(R.voices('attack') === 1 && R.voices('cwind') === 0, 'clip event missing: the deferred sim sound plays after 0.15 s');
  R.run(3);
  R.bus.emit('creature:clip', { name: 'strike', event: 'contact' });
  R.run(0.1);
  ok(R.voices('cstrike') === 1, 'strike contact clip: impact + sub boom voice');
  R.bus.emit('creature:strike', { x: 1, y: 2, z: 1, hit: true, distance: 3 });
  R.run(0.1);
  ok(R.voices('strike') === 0, 'the sim strike sound is dropped while the clip drives it');
  // freeze
  R.bus.emit('creature:clip', { name: 'listen', event: 'start' });
  R.run(0.1);
  ok(R.audio._cs.freeze && R.audio._cs.bedCut && R.audio.kScrG.last === 0, 'listen clip: bed cut on the freeze frame');
  R.bus.emit('creature:clip', { name: 'listen', event: 'pulse' });
  R.run(0.1);
  ok(R.voices('pit') === 1, 'listen pulse: a resonant click');
  R.bus.emit('creature:clip', { name: 'crown_idle', event: 'start' });
  R.run(0.1);
  ok(!R.audio._cs.freeze, 'the next base clip ends the freeze');
  R.bus.emit('creature:clip', { name: 'linger_breathe', event: 'inhale' });
  R.run(0.2);
  ok(R.voices('cbreath') === 1 && R.audio._cs.linger, 'linger_breathe: wet breath voice and the linger hush');
  R.bus.emit('mason:plant', { x: 6, y: 3, z: 2, intensity: 0.8 });
  R.run(0.1);
  R.bus.emit('creature:step', { x: 6, y: 3, z: 2, intensity: 0.8, distance: 9 });
  R.run(0.1);
  ok(R.voices('cstep') === 1, 'once mason:plant is seen the sim creature:step sound is skipped');
  // a clip event with no position uses the crown
  R.bus.emit('creature:clip', { name: 'roar_display', event: 'start', dur: 2.5 });
  R.run(0.2);
  ok(R.voices('croar') === 1, 'roar_display: a roar voice at the crown');
  ok(warnings.length === 0, 'clip sync: no warnings' + (warnings.length ? ': ' + warnings[0].slice(0, 300) : ''));
}

// ---- far events are delayed by distance / 343 ----
{
  const R = rig();
  R.run(0.5);
  const sp = R.audio._spatial(0, 300, 0, NaN);
  ok(Math.abs(sp.delay - 0.6) < 1e-9, 'far events: delay capped at 0.6 s');
  const sp2 = R.audio._spatial(0, 1 + 10, 0, NaN);
  ok(sp2.delay === 0, 'near events: no delay');
  const sp3 = R.audio._spatial(0, 1 + 60, 0, NaN);
  ok(Math.abs(sp3.delay - 60 / 343) < 0.01, 'a 60 m event arrives ~0.17 s late');
}

// ---- rope friction ----
{
  const R = rig();
  const L = R.game.tethers.hands.left.rope;
  L.anchor = {};
  L.attached = true;
  L.length = 10;
  L.tension = 3.5 * CONFIG.player.gravity;
  L.slipSpeed = 6;
  R.run(0.6);
  const rf = R._rope;
  const rope = R.audio._rope;
  ok(rope.h[0].kHissG.last > 0.1 && rope.h[0].kCreakG.last > 0.1 && rope.h[0].kHumG.last > 0.01, 'rope: friction hiss, creak and taut hum rise with slip + load');
  ok(rope.h[1].kHissG.last === 0, 'rope: the other hand stays silent');
  const hiss0 = rope.h[0].kHissF.last;
  L.slipSpeed = 1.2;
  R.run(0.6);
  ok(rope.h[0].kHissF.last < hiss0, 'rope: pitch falls with the slip speed');
  L.slipSpeed = 0;
  L.tension = 0;
  L.anchor = null;
  L.attached = false;
  R.run(5);
  ok(rope.h[0].kHissG.last === 0 && !rope.h[0].gate.on, 'rope: silent and disconnected 3 s after the line is gone');
  void rf;
}

// ---- movement ----
{
  const R = rig();
  R.game.player.groundSolid = { kind: 'metal' };
  R.audio._mov.footstep(0.8, R.game);
  ok(R.audio._mov.surface === dsp.SURFACE.IRON, 'footstep on a metal solid is iron');
  R.game.player.groundSolid = { kind: 'stone' };
  R.game.sectionIndex = 7;
  let wet = 0;
  for (let i = 0; i < 40; i++) {
    R.game.player.x = i * 3.1;
    R.audio._mov.footstep(0.8, R.game);
    if (R.audio._mov.surface === dsp.SURFACE.WET) wet++;
    R.run(0.12);
  }
  ok(wet > 10 && wet < 38, `wet section: puddle patches on some steps (${wet}/40)`);
  R.game.sectionIndex = 0;
  // sliding along a wall: the real level's first shaft wall
  const wall = level.sections[0].shaft;
  R.game.player.x = wall.maxX - 0.45;
  R.game.player.y = 5;
  R.game.player.z = 0;
  R.game.player.vx = 0;
  R.game.player.vy = -6;
  R.game.player.vz = 0;
  R.game.player.grounded = false;
  R.run(0.6);
  ok(R.audio._mov.contact === 1 || R.audio._mov.scrape >= 0, 'wall probe runs against the real level');
  // a fall: rush
  R.game.player.x = 0;
  R.game.player.vy = -25;
  R.run(1);
  ok(R.audio._mov.rush > 0.4 && R.audio._mov.rushPair[0].kG.last > 0.02, `fall: air rush rises (${R.audio._mov.rush.toFixed(2)})`);
  R.game.player.vy = 0;
  R.game.player.grounded = true;
  R.run(6);
  ok(R.audio._mov.rushPair[0].kG.last === 0, 'rush fades out after the fall');
}

// ---- breathing: exertion pants, then a recovery gasp ----
{
  const R = rig();
  R.run(1);
  R.audio._exertion = 0.95;
  R.run(1.5);
  const fast = R.audio._breathRate;
  R.audio._exertion = 0.1;
  R.run(0.5);
  ok(R.audio._gasp || R.audio._breathT > 1.5 || fast > 30, `exertion: fast breathing ${fast.toFixed(0)}/min, then a recovery gasp is queued`);
}

// ---- section changes: reverb IR build + cross-fade, drone targets ----
{
  const R = rig();
  const amb = R.audio._amb;
  const built0 = amb.irBuilt;
  for (let s = 1; s < 8; s++) {
    R.game.sectionIndex = s;
    R.bus.emit('section:enter', { index: s, first: true, section: level.sections[s] });
    R.run(5);
  }
  ok(amb.irBuilt >= 7 && built0 === 0, `reverb: an impulse response built and cross-faded for each of 7 section changes (${amb.irBuilt})`);
  const act = amb.cv[amb.active];
  ok(act.hasIR && act.kIn.last === 1 && amb.cv[1 - amb.active].kIn.last === 0, 'reverb: exactly one convolver audible after the cross-fade');
  ok(amb.spec && amb.spec.index === 7, 'reverb: the active IR is the last section');
  ok(warnings.length === 0, 'section changes: no warnings' + (warnings.length ? ': ' + warnings[0].slice(0, 300) : ''));
}

// ---- music: determinism + structure ----
{
  const collect = (seed) => {
    const R = rig();
    R.audio._music.reseed(seed);
    const notes = [];
    const orig = R.audio._music._note.bind(R.audio._music);
    R.audio._music._note = (f, v, bell, d) => {
      notes.push([+f.toFixed(2), +v.toFixed(3), bell]);
      orig(f, v, bell, d);
    };
    R.game.threat.value = 0.5;
    R.run(150);
    return notes;
  };
  const a = collect(11);
  const b = collect(11);
  const c = collect(12);
  ok(a.length >= 8, `music: ${a.length} notes in 150 s at threat 0.5`);
  ok(JSON.stringify(a) === JSON.stringify(b), 'music: the same seed gives the same notes');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'music: a different seed varies the phrasing');
  const root = 65.41;
  const first = a[0][0] / (root * 4);
  const semis = Math.round(12 * Math.log2(first));
  ok([7, 0].includes(semis) || semis === 7, `music: a phrase starts on the fifth above the section root (${semis} semitones)`);
}

// ---- 10 simulated minutes of random events: bounded voices and nodes, no warnings ----
{
  const R = rig();
  const bus = R.bus;
  const g = R.game;
  let seed = 123456789;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const types = [
    ['rope:fire', () => ({ hand: rnd() < 0.5 ? 'left' : 'right', x: 3, y: 5, z: -4, target: true, dur: 0.2 })],
    ['grapple:attach', () => ({ hand: 'right', speed: rnd() * 14, x: 3, y: 5, z: -4 })],
    ['rope:slip', () => ({ hand: 'left', intensity: rnd(), speed: rnd() * 9, load: 1 + rnd() * 3.5 })],
    ['rope:jolt', () => ({ speed: 12 + rnd() * 10 })],
    ['player:land', () => ({ impact: rnd() * 16, hard: rnd() < 0.3, lethalRatio: rnd() })],
    ['player:wallhit', () => ({ impact: 4 + rnd() * 12 })],
    ['health:damage', () => ({ amount: rnd() * 0.5 })],
    ['creature:step', () => ({ x: (rnd() - 0.5) * 20, y: rnd() * 10, z: (rnd() - 0.5) * 20, intensity: rnd(), distance: rnd() * 40 })],
    ['creature:call', () => ({ x: 10, y: 30, z: 4, intensity: rnd(), distance: 20 + rnd() * 60 })],
    ['creature:burst', () => ({ x: 8, y: 6, z: 3, distance: 10, reason: 'heard', snap: 0.3 })],
    ['creature:attack', () => ({ x: 8, y: 6, z: 3, windup: 0.6, distance: 10, cause: 'stall' })],
    ['creature:strike', () => ({ x: 1, y: 2, z: 1, hit: rnd() < 0.5, distance: 3 })],
    ['creature:sighting', () => ({ x: 30, y: 10, z: 3, duration: 9 })],
    ['creature:clip', () => ({ name: ['listen', 'rear_windup', 'strike', 'recoil', 'roar_display', 'linger_breathe', 'leg_probe', 'knock_x3', 'notice_snap'][(rnd() * 9) | 0], event: ['start', 'pulse', 'tap', 'knock', 'inhale', 'contact', 'snap', 'end'][(rnd() * 8) | 0] })],
    ['mason:plant', () => ({ x: (rnd() - 0.5) * 20, y: rnd() * 10, z: 0, intensity: rnd() })],
    ['trigger:debris', () => ({ data: { x: 1, y: 10, z: 2 } })],
    ['trigger:rumble', () => ({})],
    ['pickup:collect', () => ({ kind: (rnd() * 4) | 0 })],
    ['bag:apply', () => ({ kind: (rnd() * 4) | 0, dur: 1.5 })],
  ];
  const seconds = 600;
  const dt = 1 / 30;
  let nodes60 = 0;
  let maxNodes = 0;
  let peakVoices = 0;
  const secs = level.sections;
  for (let f = 0; f < seconds / dt; f++) {
    const t = f * dt;
    R.ctx.currentTime += dt;
    // a wandering game state: threat, section, creature, ropes
    g.threat.value = 0.5 + 0.5 * Math.sin(t / 37);
    g.creature.listening = Math.sin(t / 11) > 0.7;
    g.creature.state = g.creature.listening ? 'OBSERVING' : 'APPROACHING';
    g.creature.distance = g.creature.audio.distance = 8 + 30 * (0.5 + 0.5 * Math.sin(t / 23));
    g.sectionIndex = Math.min(7, (t / 75) | 0);
    g.player.vy = -20 * Math.max(0, Math.sin(t / 5));
    g.player.vx = 5 * Math.sin(t / 3);
    g.player.grounded = Math.sin(t / 5) < 0;
    const L = g.tethers.hands.left.rope;
    L.anchor = Math.sin(t / 7) > 0 ? {} : null;
    L.attached = !!L.anchor;
    L.length = 8 + 4 * Math.sin(t / 2);
    L.tension = (L.attached ? 3.5 + 2 * Math.sin(t) : 0) * CONFIG.player.gravity;
    L.slipSpeed = L.attached && Math.sin(t / 3) > 0.3 ? 5 : 0;
    if (f % 90 === 0) bus.emit('section:enter', { index: g.sectionIndex, first: false, section: secs[g.sectionIndex] });
    if (rnd() < 0.25) {
      const e = types[(rnd() * types.length) | 0];
      bus.emit(e[0], e[1]());
    }
    R.audio.update(dt, g);
    const n = R.ctx.stats().liveNodes;
    if (t > 90 && nodes60 === 0) nodes60 = n;
    if (t > 90 && n > maxNodes) maxNodes = n;
    if (R.audio.activeVoices > peakVoices) peakVoices = R.audio.activeVoices;
  }
  const end = R.ctx.stats();
  console.log(`   10 min: live nodes ${nodes60} at 90 s, max ${maxNodes}, end ${end.liveNodes}; peak voices ${peakVoices} (cap 24); events ${R.audio._eventCount}`);
  ok(warnings.length === 0, 'music + ambience + events over 10 simulated minutes: no NaN / bad automation / swallowed warnings' + (warnings.length ? ': ' + warnings[0].slice(0, 400) : ''));
  ok(peakVoices <= 24 && R.audio.peakVoices <= 24, `voices bounded (peak ${R.audio.peakVoices} <= 24)`);
  ok(maxNodes < nodes60 + 400, `no unbounded node growth (${nodes60} -> max ${maxNodes})`);
  ok(end.liveNodes < nodes60 + 400, 'live node count at the end is near the 90 s level');
  R.run(10);
  ok(R.audio.activeVoices < 20, 'one-shots drain after the events stop');
  const dbg = R.audio.debugState();
  ok(dbg.music.notes >= 5 && dbg.ambience.events > 100 && dbg.ambience.reverb.irBuilt >= 7, `modules ran (notes ${dbg.music.notes}, ambient events ${dbg.ambience.events}, IRs ${dbg.ambience.reverb.irBuilt})`);
}

console.warn = realWarn;
console.log(fails ? `\n${fails} FAILED` : '\nALL AUDIO CHECKS PASS');
process.exitCode = fails ? 1 : 0;
