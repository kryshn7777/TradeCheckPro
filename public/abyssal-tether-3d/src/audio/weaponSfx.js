/* THE LANTERN (ABYSSAL TETHER 3D) — audio/weaponSfx.js
 * THE SOLDIERS' WEAPONS (sim/weapons3d.js, plans/SOLDIER_WEAPONS.md): their designed sounds in the sfxBank.js format (SFX_DESIGN.md §c.1):
 * pure data + small routes, no WebAudio, no Math.random (the engine's 'hash' / 'cycle' variation), the engine's reused opts().
 *
 *   grenade:throw    'grenade.throw'    the spoon flying off (a bright iron ping) + the arm's whoosh                         head
 *   grenade:fizz     'grenade.fizz'     the fuse: a hiss with crackle, world-placed where the grenade is (it follows it)    world
 *   grenade:bounce   'grenade.bounce'   cast iron on stone: a dull, heavy clunk with a short ring                           world
 *   grenade:blast    'grenade.blast'    the crack, a sub thump, the stone boom, the grit raining down, and the SHAFT's
 *                                       answer: three slap-backs falling away down the masonry (0.45 / 0.95 / 1.6 s)        world (heard far)
 *   revolver:fire    'revolver.shot'    the hammer tick, the crack, the chest thump, the shaft slapping it back twice       head
 *   revolver:dry     'revolver.dry'     the empty cylinder: the hammer falls on nothing, a dull double click                head
 *   weapon:hit       'weapon.hit'       the hit confirm: a meaty thud through the body you struck (head-locked, short)      head
 *   creature:frighten 'mason.pain'      the Mason's pained screech (a stone-throated shriek sweeping down) + 'mason.flee'
 *                                       the withdrawing rumble: masonry grinding away, many limbs scraping, falling off     world
 *                    (a stagger: the screech alone, shorter)
 *   skitter:killed   'skitter.squish'   a wet crunch: the carapace cracking and what is inside it                           world
 * registerWeaponSfx(audio) adds the recipes and the routes through the engine's extension points (audio3d.js registerSfx /
 * registerSfxRoute); without the engine (no audio, a test double) it does nothing. Node-importable.
 */

const IRON = [1, 2.32, 3.9, 5.1]; // a small cast-iron body: inharmonic, dull
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const F = Object.freeze;

export const WEAPON_RECIPES = F({
  'grenade.throw': F({
    bus: 'player', prio: 1, gap: 0.3, level: F([0.25, 0.5]), send: 0.06, maxInst: 1, vary: F({ rule: 'cycle', n: 4, pitch: 0.05, level: 0.08, time: 0.08 }),
    note: 'the spoon flying off the grenade (a bright little iron ping) and the arm swinging through',
    layers: F([
      F({ t: 'modal', f: 2300, r: F([1, 2.71, 4.2]), m: F([0.4, 0.18, 0.08]), d: 0.06, g: 0.7 }),
      F({ t: 'ticks', src: 'white', f: 3600, f2: 5200, q: 8, n: 2, span: 0.05, d: 0.004, g: 0.25 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: F([480, 700]), f2: F([1200, 2100]), sw: 0.08, q: 1.2, at: 0.04, a: 0.04, h: 0.05, d: 0.07, g: 0.7 }),
    ]),
  }),
  'grenade.fizz': F({
    bus: 'player', prio: 1, gap: 0.2, level: 0.32, send: 0.1, space: 'world', floor: 0.2, maxInst: 2, vary: F({ rule: 'cycle', n: 6, pitch: 0.08, level: 0.1, time: 0.06 }),
    note: 'the fuse burning: a hot hiss with crackle (one of these every 0.3 s, so the sizzle follows the grenade)',
    layers: F([
      F({ t: 'noise', src: 'white', ft: 'highpass', f: 3400, q: 0.7, a: 0.02, h: 0.18, d: 0.08, g: 0.55 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1900, q: 2, a: 0.03, h: 0.14, d: 0.06, g: 0.3 }),
      F({ t: 'ticks', src: 'white', f: 2400, f2: 6000, q: 6, n: F([4, 7]), span: 0.28, d: 0.004, g: 0.35, falloff: 0.1 }),
    ]),
  }),
  'grenade.bounce': F({
    bus: 'player', prio: 0, gap: 0.06, level: F([0.18, 0.5]), send: 0.16, space: 'world', maxInst: 2, vary: F({ rule: 'hash', n: 8, pitch: 0.07, level: 0.1 }),
    note: 'cast iron on stone: a dull heavy clunk, a short ring of the body, a little grit',
    layers: F([
      F({ t: 'modal', f: F([380, 460]), r: IRON, m: F([0.6, 0.25, 0.12, 0.05]), dk: F([1, 0.5, 0.35, 0.25]), d: F([0.05, 0.09]), g: 1 }),
      F({ t: 'tone', w: 'sine', f: 150, f2: 80, sw: 0.02, a: 0.002, d: 0.035, g: F([0.4, 0.7]) }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 900, q: 0, a: 0.002, d: 0.025, g: 0.35 }),
    ]),
  }),
  'grenade.blast': F({
    bus: 'stinger', prio: 3, gap: 0.15, level: F([0.7, 1]), send: 0.65, space: 'world', floor: 0.55, maxInst: 2, vary: F({ rule: 'hash', n: 4, pitch: 0.05, level: 0.05, time: 0.06 }),
    note: 'the blast: a white crack, a sub thump, the stone boom and grit raining down; then the shaft answers, three slap-backs falling away',
    layers: F([
      F({ t: 'noise', src: 'white', ft: 'highpass', f: 1800, q: 0, a: 0.001, d: 0.03, g: 1.2 }),
      F({ t: 'tone', w: 'sine', f: 62, f2: 26, sw: 0.25, a: 0.004, h: 0.05, d: 0.35, g: 1.4 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: F([320, 480]), q: 0.5, a: 0.006, h: 0.12, d: 0.6, g: 1.3 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 700, f2: 260, sw: 0.5, q: 0.8, a: 0.01, h: 0.08, d: 0.4, g: 0.6 }),
      F({ t: 'ticks', src: 'white', f: 1400, f2: 4200, q: 4, n: 18, span: 1.3, at: 0.15, d: 0.012, g: 0.35, falloff: 0.7 }),
      // the shaft answering: three slap-backs, darker and softer each time
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 520, q: 1.2, at: 0.45, a: 0.01, h: 0.05, d: 0.32, g: 0.5 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 380, q: 0.4, at: 0.95, a: 0.02, h: 0.06, d: 0.5, g: 0.42 }),
      F({ t: 'tone', w: 'sine', f: 44, f2: 30, sw: 0.4, at: 0.95, a: 0.02, d: 0.4, g: 0.4 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 240, q: 0.3, at: 1.6, a: 0.05, h: 0.1, d: 0.9, g: 0.3 }),
    ]),
  }),
  'revolver.shot': F({
    bus: 'player', prio: 3, gap: 0.08, level: 0.95, send: 0.5, maxInst: 2, vary: F({ rule: 'cycle', n: 4, pitch: 0.04, level: 0.05, time: 0.05 }),
    note: 'an old service revolver in a stone shaft: the hammer tick, the crack, the chest thump, the shaft slapping it back twice',
    layers: F([
      F({ t: 'ticks', src: 'white', f: 2800, f2: 3800, q: 9, n: 1, span: 0.01, d: 0.004, g: 0.4 }),
      F({ t: 'noise', src: 'white', ft: 'highpass', f: 2400, q: 0, at: 0.012, a: 0.0008, d: 0.022, g: 1.4 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1100, q: 0.9, at: 0.012, a: 0.001, d: 0.06, g: 0.9 }),
      F({ t: 'tone', w: 'sine', f: 120, f2: 48, sw: 0.06, at: 0.012, a: 0.002, d: 0.09, g: 1.1 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 700, q: 0.3, at: 0.014, a: 0.003, d: 0.16, g: 0.7 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 900, q: 1.4, at: 0.14, a: 0.004, d: 0.12, g: 0.42 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 600, q: 1.2, at: 0.42, a: 0.01, d: 0.22, g: 0.26 }),
    ]),
  }),
  'revolver.dry': F({
    bus: 'ui', prio: 1, gap: 0.15, level: 0.4, send: 0.02, vary: F({ rule: 'fixed', n: 1 }),
    note: 'the empty cylinder: the hammer falls on nothing, a dull double click',
    layers: F([
      F({ t: 'modal', f: 1900, r: F([1, 2.6, 4.1]), m: F([0.4, 0.15, 0.06]), d: 0.02, g: 0.7 }),
      F({ t: 'ticks', src: 'white', f: 2200, f2: 3000, q: 7, n: 2, span: 0.07, d: 0.004, g: 0.5 }),
      F({ t: 'tone', w: 'triangle', f: 260, f2: 190, sw: 0.02, at: 0.07, a: 0.002, d: 0.02, g: 0.4 }),
    ]),
  }),
  'weapon.hit': F({
    bus: 'player', prio: 2, gap: 0.12, level: F([0.4, 0.7]), send: 0.04, maxInst: 1, vary: F({ rule: 'cycle', n: 3, pitch: 0.05, level: 0.05 }),
    note: 'the hit confirm: a meaty, dull thud (it went in) and a crack of stone or shell (k = a full hit)',
    layers: F([
      F({ t: 'tone', w: 'sine', f: 95, f2: 52, sw: 0.05, a: 0.003, d: 0.08, g: 1 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 520, q: 0.6, a: 0.003, d: 0.07, g: 0.7 }),
      F({ t: 'ticks', src: 'pink', f: 1300, f2: 2400, q: 5, n: F([2, 4]), span: 0.06, at: 0.01, d: 0.006, g: 0.3 }),
    ]),
  }),
  'mason.pain': F({
    bus: 'creature', prio: 3, gap: 0.4, level: F([0.6, 0.95]), send: 0.5, space: 'world', floor: 0.5, maxInst: 1, vary: F({ rule: 'cycle', n: 3, pitch: 0.05, level: 0.05, time: 0.08 }),
    note: 'the Mason hurt: a stone-throated shriek sweeping down (a sawtooth with a ragged tremor), a grinding chorus under it, the walls ringing',
    layers: F([
      F({ t: 'tone', w: 'sawtooth', f: 1450, f2: 520, sw: 0.7, a: 0.03, h: 0.25, d: 0.4, g: 0.5, lfo: F([17, 0.35]) }),
      F({ t: 'tone', w: 'square', f: 960, f2: 340, sw: 0.8, at: 0.04, a: 0.04, h: 0.2, d: 0.35, g: 0.22, lfo: F([11, 0.4]) }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1800, f2: 700, sw: 0.7, q: 3, a: 0.02, h: 0.3, d: 0.35, g: 0.45 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 300, q: 0.6, a: 0.06, h: 0.4, d: 0.5, g: 0.6 }),
      F({ t: 'ticks', src: 'white', f: 900, f2: 2600, q: 4, n: 10, span: 0.8, at: 0.1, d: 0.01, g: 0.28, falloff: 0.5 }),
    ]),
  }),
  'mason.flee': F({
    bus: 'creature', prio: 2, gap: 1, level: 0.6, send: 0.55, space: 'world', floor: 0.45, maxInst: 1, vary: F({ rule: 'fixed', n: 1 }),
    note: 'it withdraws: masonry grinding away up the shaft, dozens of limbs scraping, falling off into the dark',
    layers: F([
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 260, f2: 140, sw: 2.4, q: 0.5, at: 0.25, a: 0.3, h: 1.2, d: 1.2, g: 0.9 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 600, f2: 300, sw: 2.6, q: 1.5, at: 0.3, a: 0.2, h: 1, d: 1, g: 0.35, lfo: F([6, 0.5]) }),
      F({ t: 'ticks', src: 'pink', f: 700, f2: 2200, q: 3, n: 22, span: 2.8, at: 0.3, d: 0.02, g: 0.4, falloff: 0.85 }),
      F({ t: 'tone', w: 'sine', f: 46, f2: 33, sw: 2.5, at: 0.3, a: 0.4, h: 0.9, d: 1, g: 0.45 }),
    ]),
  }),
  'skitter.squish': F({
    bus: 'creature', prio: 2, gap: 0.08, level: 0.55, send: 0.2, space: 'world', maxInst: 2, vary: F({ rule: 'hash', n: 6, pitch: 0.08, level: 0.08, time: 0.08 }),
    note: 'a skitterling killed: the carapace cracking (a crunch of ticks) and the wet give of what is inside it',
    layers: F([
      F({ t: 'ticks', src: 'white', f: 1600, f2: 4200, q: 5, n: F([5, 8]), span: 0.07, d: 0.006, g: 0.6, falloff: 0.4 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 700, f2: 300, sw: 0.12, q: 2.2, at: 0.02, a: 0.006, h: 0.04, d: 0.09, g: 0.7 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 450, q: 0.8, at: 0.03, a: 0.01, d: 0.12, g: 0.55 }),
      F({ t: 'tone', w: 'sine', f: 210, f2: 90, sw: 0.08, at: 0.02, a: 0.004, d: 0.06, g: 0.3 }),
    ]),
  }),
});

/** Where a payload is (x,y,z) → o; false when it has no finite position. */
function place(o, p) {
  o.x = num(p.x, NaN);
  o.y = num(p.y, NaN);
  o.z = num(p.z, NaN);
  return o.x === o.x && o.y === o.y && o.z === o.z;
}
const hashPos = (x, y, z) => (Math.imul(Math.floor(x * 4), 73856093) ^ Math.imul(Math.floor(y * 4), 19349663) ^ Math.imul(Math.floor(z * 4), 83492791)) | 0;

export const WEAPON_ROUTES = F({
  'grenade:throw'(p, E) {
    E.play('grenade.throw', clamp01(num(p.speed, 9) / 18.5), null);
  },
  'grenade:fizz'(p, E) {
    const o = E.opts();
    if (place(o, p)) E.play('grenade.fizz', 0.5, o);
  },
  'grenade:bounce'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    o.key = hashPos(o.x, o.y, o.z);
    E.play('grenade.bounce', clamp01((num(p.speed, 1) - 0.9) / 6), o);
  },
  'grenade:blast'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    o.key = hashPos(o.x, o.y, o.z);
    E.play('grenade.blast', 1, o);
  },
  'revolver:fire'(p, E) {
    E.play('revolver.shot', 0.5, null);
  },
  'revolver:dry'(p, E) {
    E.play('revolver.dry', 0.5, null);
  },
  'weapon:hit'(p, E) {
    E.play('weapon.hit', p.target === 'mason' ? 1 : 0.5, null);
  },
  'creature:frighten'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    E.play('mason.pain', p.stagger ? 0.2 : 1, o);
    if (p.stagger) return;
    const o2 = E.opts();
    place(o2, p);
    o2.delay = 0.35;
    E.play('mason.flee', 0.5, o2);
  },
  'skitter:killed'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    o.key = hashPos(o.x, o.y, o.z);
    E.play('skitter.squish', 0.5, o);
  },
});

/** Adds the recipes and the routes to the game's audio (once). Returns true when the engine took them. */
export function registerWeaponSfx(audio) {
  if (!audio || typeof audio.registerSfx !== 'function' || typeof audio.registerSfxRoute !== 'function') return false;
  for (const id of Object.keys(WEAPON_RECIPES)) if (!audio.registerSfx(id, WEAPON_RECIPES[id])) return false;
  for (const t of Object.keys(WEAPON_ROUTES)) audio.registerSfxRoute(t, WEAPON_ROUTES[t]);
  return true;
}
