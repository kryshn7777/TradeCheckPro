/* THE LANTERN (ABYSSAL TETHER 3D) — knockerSfx.js
 * The KNOCKER's designed sounds (sim/knocker3d.js), in the format of sfxBank.js (plans/SFX_DESIGN.md): pure data + small
 * routes, no WebAudio, no Math.random. sfxBank.js spreads KNOCKER_RECIPES into its RECIPES and KNOCKER_ROUTES into its ROUTES,
 * so the engine registers and subscribes them like every other designed sound (registerSfx / registerRoute contract).
 *
 *   knocker:throw   'knocker.throw'  the arm's whoosh (k = throw speed / 18.5) + the clockwork rattling in the hand   head
 *   knocker:bounce  'prop.cell' on stone / wet / debris, 'knocker.clink' on iron and grates (k = impact speed)       world
 *                   (the dropped-prop bounce: a dense little metal clink, reused)
 *   knocker:land    'knocker.wind'   the wind-up ratchet: 12 pawl ticks over 0.4 s and the spring tightening           world
 *   knocker:clack   'knocker.knock'  brass on stone: a struck-brass ring (partials 1, 2.03, 3.11, 4.4) + a stone thud;
 *                                    the 7-beat pattern is fixed, the pitch of each beat is the hash of its place in
 *                                    the bar (the same bar always sounds the same), k = the beat's accent             world
 *   knocker:end     'knocker.clunk'  done: the spring runs out, a heavy last clunk and four slowing ticks              world
 *                   'knocker.lost'   lost down the shaft: two faint clacks far below, mostly reverb                    world
 *   knocker:refuse  'knocker.no'     a soft, dull double click (cooldown / one already knocking / none left)           head
 * World sounds: distance, air absorption, wall occlusion (-5 dB + lowpass) and the speed of sound, like the others.
 */
import { hashPos } from './sfxDesign.js';

const BRASS = [1, 2.03, 3.11, 4.4]; // a small cast-brass body: near-harmonic, bright
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

export const KNOCKER_RECIPES = {
  'knocker.throw': {
    bus: 'player', prio: 1, gap: 0.2, level: [0.22, 0.5], send: 0.05, maxInst: 1, vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.08, time: 0.1 },
    note: 'the arm swinging through (a pink band sweeping up with the speed) + the clockwork rattling loose in the hand',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: [520, 760], f2: [1300, 2300], sw: 0.08, q: 1.3, a: 0.05, h: [0.02, 0.06], d: 0.07, g: 0.8 },
      { t: 'ticks', src: 'white', f: 2600, f2: 4600, q: 8, n: [3, 6], span: 0.16, d: 0.005, g: 0.18, falloff: 0.5 },
      { t: 'tone', w: 'sine', f: 140, f2: 95, sw: 0.05, a: 0.01, d: 0.05, g: [0.1, 0.25] },
    ],
  },
  'knocker.clink': {
    bus: 'player', prio: 0, gap: 0.05, level: [0.15, 0.45], send: 0.14, space: 'world', maxInst: 2, vary: { rule: 'hash', n: 8, pitch: 0.06, level: 0.1 },
    note: 'brass on iron: a bright clink with a short ring and a tick of the striker',
    layers: [
      { t: 'modal', f: 980, r: BRASS, m: [0.4, 0.22, 0.12, 0.06], dk: [1, 0.65, 0.45, 0.3], d: [0.05, 0.09], g: 1 },
      { t: 'ticks', src: 'white', f: 3200, f2: 5200, q: 9, n: [1, 3], span: 0.08, at: 0.01, d: 0.005, g: 0.15 },
    ],
  },
  'knocker.wind': {
    bus: 'player', prio: 1, gap: 0.3, level: 0.42, send: 0.16, space: 'world', floor: 0.2, maxInst: 2, vary: { rule: 'hash', n: 4, pitch: 0.04, level: 0.06, time: 0.05 },
    note: 'the wind-up: a ratchet pawl clicking over 12 teeth in 0.4 s, the mainspring tightening under it (a rising whine)',
    layers: [
      { t: 'ticks', src: 'white', f: 2400, f2: 3900, q: 10, n: 12, span: 0.4, d: 0.006, g: 0.5, falloff: -0.2 },
      { t: 'ticks', src: 'pink', f: 700, f2: 1100, q: 5, n: 12, span: 0.4, at: 0.004, d: 0.008, g: 0.3 },
      { t: 'tone', w: 'triangle', f: 520, f2: 880, sw: 0.18, a: 0.08, h: 0.24, d: 0.06, g: 0.06 },
      { t: 'modal', f: 1240, r: BRASS, m: [0.2, 0.1, 0.05, 0.03], d: 0.05, at: 0.41, g: 0.6 },
    ],
  },
  'knocker.knock': {
    bus: 'player', prio: 1, gap: 0.05, level: [0.3, 0.6], send: 0.22, space: 'world', floor: 0.25, maxInst: 3, vary: { rule: 'hash', n: 7, pitch: 0.07, level: 0.05, time: 0.06 },
    note: 'one knock: the striker on its brass plate (a short bright ring) against the stone it lies on (a dull thud)',
    layers: [
      { t: 'noise', src: 'white', ft: 'highpass', f: 2600, q: 0, a: 0.001, d: 0.006, g: 0.45 },
      { t: 'modal', f: [690, 740], r: BRASS, m: [0.55, 0.3, 0.16, 0.08], dk: [1, 0.6, 0.42, 0.3], d: [0.05, 0.08], g: 1 },
      { t: 'tone', w: 'sine', f: 170, f2: 92, sw: 0.02, a: 0.002, d: [0.025, 0.04], g: [0.45, 0.7] },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 600, q: 0, a: 0.002, d: 0.02, g: 0.35 },
    ],
  },
  'knocker.clunk': {
    bus: 'player', prio: 1, gap: 0.3, level: 0.5, send: 0.24, space: 'world', floor: 0.2, maxInst: 2, vary: { rule: 'fixed', n: 1 },
    note: 'the end: the spring runs out (four slowing ticks), the striker drops with a heavy clunk and the brass rings down',
    layers: [
      { t: 'ticks', src: 'white', f: 2000, f2: 3200, q: 8, n: 4, span: 0.32, d: 0.006, g: 0.3, falloff: 0.5 },
      { t: 'modal', f: 430, r: BRASS, m: [0.6, 0.28, 0.12, 0.05], dk: [1, 0.55, 0.4, 0.3], d: 0.16, at: 0.36, g: 1 },
      { t: 'tone', w: 'sine', f: 120, f2: 64, sw: 0.03, at: 0.36, a: 0.002, d: 0.07, g: 0.7 },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 480, q: 0, at: 0.36, a: 0.002, d: 0.04, g: 0.4 },
    ],
  },
  'knocker.lost': {
    bus: 'player', prio: 0, gap: 0.5, level: 0.3, send: 0.7, space: 'world', floor: 0.18, maxInst: 1, vary: { rule: 'fixed', n: 1 },
    note: 'lost down the shaft: two faint brass clacks far below, mostly the shaft answering (reverb), then nothing',
    layers: [
      { t: 'modal', f: 760, r: BRASS, m: [0.4, 0.15, 0.06, 0.03], d: 0.05, g: 0.7 },
      { t: 'modal', f: 700, r: BRASS, m: [0.3, 0.12, 0.05, 0.02], d: 0.05, at: 0.42, g: 0.45 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 900, q: 2, a: 0.002, d: 0.03, g: 0.2 },
    ],
  },
  'knocker.no': {
    bus: 'ui', prio: 1, gap: 0.25, level: 0.32, send: 0, vary: { rule: 'fixed', n: 1 },
    note: 'refused: a soft, dull double click of the catch (not now)',
    layers: [
      { t: 'tone', w: 'triangle', f: 240, f2: 180, sw: 0.02, a: 0.002, d: 0.025, g: 0.6 },
      { t: 'tone', w: 'triangle', f: 200, f2: 150, sw: 0.02, at: 0.09, a: 0.002, d: 0.03, g: 0.5 },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 900, q: 0, a: 0.001, d: 0.012, g: 0.3 },
    ],
  },
};

/** Where a payload is (x,y,z) → o; false when it has no finite position. */
function place(o, p) {
  o.x = num(p.x, NaN);
  o.y = num(p.y, NaN);
  o.z = num(p.z, NaN);
  return o.x === o.x && o.y === o.y && o.z === o.z;
}

const METALLIC = { metal: 1, bridge: 1, iron: 1, grate: 1 };

export const KNOCKER_ROUTES = {
  'knocker:throw'(p, E) {
    E.play('knocker.throw', clamp01(num(p.speed, 9) / 18.5), null);
  },
  'knocker:bounce'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    o.key = hashPos(o.x, o.y, o.z, 0.15);
    E.play(METALLIC[p.kind] ? 'knocker.clink' : 'prop.cell', clamp01((num(p.speed, 1) - 0.9) / 6.1), o);
  },
  'knocker:land'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    o.key = hashPos(o.x, o.y, o.z, 0.5);
    E.play('knocker.wind', 0.5, o);
  },
  'knocker:clack'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    o.key = num(p.idx, 0) | 0; // the beat's place in the bar: the same bar always rings the same
    E.play('knocker.knock', clamp01(num(p.accent, 1)), o);
  },
  'knocker:end'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    if (p.reason === 'done') E.play('knocker.clunk', 0.5, o);
    else if (p.reason === 'lost') E.play('knocker.lost', 0.5, o);
  },
  'knocker:refuse'(p, E) {
    if (p.reason === 'off' || p.reason === 'busy' || p.reason === 'dead') return; // nothing to say outside play
    E.play('knocker.no', 0.5, null);
  },
};
