/* THE LANTERN — audio/masonAttackSfx.js
 * MASON SNAKE ATTACK (plans/MASON_SNAKE_ATTACK.md §5): the designed sounds of the Mason's snake attack, in the sfxBank.js format
 * (SFX_DESIGN.md §c.1). All world-space at the coiled head (masonAttackGlue.js puts x, y, z there): distance, air absorption,
 * occlusion and the speed of sound are the engine's; the creature bus, so the master / SFX volume apply; the engine's reduced tier
 * caps the voices. Pure data + two routes, no Math.random (the engine's 'cycle' / 'hash' variation), the engine's reused opts().
 *
 *   mason:rattle {k}                 'mason.rattle'  a grain of the dry stone-on-stone rattle while it is coiled and swaying: grit ticks,
 *                                                    two plates knocking, a breathy hiss; k = the tension (louder, faster, hissier
 *                                                    toward the lock; the glue sends the grains 0.34 -> 0.13 s apart)
 *   mason:attack {phase:'lock'}      'mason.lock'    THE DODGE DEADLINE: one sharp stone tick (a bright modal click + a short pure tone),
 *                                                    readable without sight; the rattle stops dead under it
 *   mason:attack {phase:'strike'}    'mason.strike'  the whip-crack / stone whoosh: a crack, a band falling 2.6 kHz -> 380 Hz (Doppler-ish),
 *                                                    a low body falling under it
 *   mason:attack {phase:'recoil'}    'mason.recoil'  the heavy settle: a falling scrape, a dull thud, three loose stones
 *   mason:attack {phase:'hit'}       'mason.hit'     a muffled impact thud (the player's own whine / flash are not here)
 *   mason:attack {phase:'dash'}      'mason.dash'    the surge: a stone-scrape rumble rising, then Dopplering down past, grit
 *   mason:attack {phase:'halt'}      'mason.halt'    the hard decel scrape into the coil
 *   mason:attack {phase:'rise'}      'mason.rise'    the rear: plates grinding up, a long hiss drawn in
 */

export const MASON_ATTACK_IDS = Object.freeze({
  rattle: 'mason.rattle',
  lock: 'mason.lock',
  strike: 'mason.strike',
  recoil: 'mason.recoil',
  hit: 'mason.hit',
  dash: 'mason.dash',
  halt: 'mason.halt',
  rise: 'mason.rise',
});
export const LEVEL_CAP = 0.75; // no attack sound above this (the notice knock is 0.75: the loudest Mason cue stays the notice)

const F = Object.freeze;
const STONE = F([1, 2.31, 3.86]); // a stone plate: dull, inharmonic

export const MASON_ATTACK_RECIPES = F({
  'mason.rattle': F({
    bus: 'creature',
    prio: 1,
    gap: 0.08,
    level: F([0.22, 0.42]),
    send: 0.18,
    space: 'world',
    floor: 0.2,
    maxInst: 3,
    vary: F({ rule: 'cycle', n: 5, pitch: 0.07, level: 0.1, time: 0.15 }),
    note: 'one grain of the coiled rattle: dry grit ticks, two stone plates knocking, a breathy hiss that rises with the tension',
    layers: F([
      F({ t: 'ticks', src: 'white', f: 1400, f2: 3600, q: 7, n: F([5, 9]), span: F([0.12, 0.09]), d: 0.005, g: 0.55, falloff: 0.25 }),
      F({ t: 'modal', f: F([300, 330]), r: STONE, m: F([0.35, 0.16, 0.06]), dk: F([1, 0.6, 0.4]), d: 0.025, g: 0.55 }),
      F({ t: 'modal', f: F([262, 290]), r: STONE, m: F([0.3, 0.14, 0.05]), dk: F([1, 0.6, 0.4]), at: 0.045, d: 0.022, g: 0.4 }),
      F({ t: 'noise', src: 'white', ft: 'bandpass', f: F([3800, 5200]), q: 1.6, a: 0.02, h: 0.04, d: 0.07, g: F([0.06, 0.24]) }),
    ]),
  }),
  'mason.rise': F({
    bus: 'creature',
    prio: 2,
    gap: 1.2,
    level: 0.5,
    send: 0.3,
    space: 'world',
    floor: 0.3,
    maxInst: 1,
    vary: F({ rule: 'cycle', n: 3, pitch: 0.05, time: 0.08 }),
    note: 'the rear: stone plates grinding up (a rising band with a slow judder), a long hiss drawn in, a low creak',
    layers: F([
      F({ t: 'noise', src: 'brown', ft: 'bandpass', f: 160, f2: 420, sw: 0.35, q: 1.7, a: 0.12, h: 0.3, d: 0.3, g: 0.75, lfo: F([14, 0.55]) }),
      F({ t: 'ticks', src: 'pink', f: 700, f2: 1600, q: 5, n: 12, span: 0.6, d: 0.008, g: 0.25, falloff: -0.3 }),
      F({ t: 'noise', src: 'white', ft: 'bandpass', f: 3200, f2: 5200, sw: 0.5, q: 1.4, at: 0.1, a: 0.3, h: 0.2, d: 0.25, g: 0.12 }),
      F({ t: 'tone', w: 'sawtooth', f: 46, f2: 58, sw: 0.5, a: 0.2, h: 0.3, d: 0.3, g: 0.12 }),
    ]),
  }),
  'mason.lock': F({
    bus: 'creature',
    prio: 3,
    gap: 0.25,
    level: 0.7,
    send: 0.12,
    space: 'world',
    floor: 0.6, // the deadline must carry: it is the one sound you dodge by
    maxInst: 1,
    vary: F({ rule: 'fixed', n: 1 }),
    note: 'THE DODGE DEADLINE: one sharp stone tick (a bright click + a short pure tone), dry, the same every time',
    layers: F([
      F({ t: 'noise', src: 'white', ft: 'highpass', f: 3000, q: 0, a: 0.0008, d: 0.004, g: 0.7 }),
      F({ t: 'modal', f: 2200, r: F([1, 2.71, 4.43]), m: F([0.6, 0.25, 0.1]), dk: F([1, 0.55, 0.35]), d: 0.03, g: 1 }),
      F({ t: 'tone', w: 'sine', f: 1180, a: 0.001, h: 0.035, d: 0.03, g: 0.42 }),
      F({ t: 'tone', w: 'sine', f: 140, f2: 90, sw: 0.02, a: 0.001, d: 0.03, g: 0.4 }),
    ]),
  }),
  'mason.strike': F({
    bus: 'creature',
    prio: 3,
    gap: 0.3,
    level: 0.72,
    send: 0.2,
    space: 'world',
    floor: 0.5,
    maxInst: 2,
    vary: F({ rule: 'cycle', n: 3, pitch: 0.05, level: 0.05, time: 0.06 }),
    note: 'the whip-crack lunge: a crack, a stone whoosh falling 2.6 kHz -> 380 Hz (Doppler-ish), a heavy body falling under it',
    layers: F([
      F({ t: 'noise', src: 'white', ft: 'highpass', f: 2400, q: 0, a: 0.0008, d: 0.008, g: 0.8 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 2600, f2: 380, sw: 0.07, q: 1.3, a: 0.01, h: 0.04, d: 0.12, g: 0.85 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 700, f2: 220, sw: 0.1, q: 0.6, a: 0.01, h: 0.05, d: 0.14, g: 0.6 }),
      F({ t: 'tone', w: 'sine', f: 120, f2: 55, sw: 0.08, a: 0.004, d: 0.14, g: 0.55 }),
      F({ t: 'ticks', src: 'white', f: 1800, f2: 3400, q: 6, n: 6, span: 0.14, at: 0.02, d: 0.005, g: 0.2, falloff: 0.5 }),
    ]),
  }),
  'mason.recoil': F({
    bus: 'creature',
    prio: 2,
    gap: 0.4,
    level: 0.55,
    send: 0.3,
    space: 'world',
    floor: 0.3,
    maxInst: 1,
    vary: F({ rule: 'cycle', n: 3, pitch: 0.06, level: 0.06, time: 0.08 }),
    note: 'the snap back into the coil: a heavy scrape falling, a dull settling thud, three loose stones',
    layers: F([
      F({ t: 'noise', src: 'brown', ft: 'bandpass', f: 520, f2: 180, sw: 0.18, q: 1.5, a: 0.02, h: 0.12, d: 0.18, g: 0.75 }),
      F({ t: 'tone', w: 'sine', f: 82, f2: 48, sw: 0.06, at: 0.2, a: 0.004, d: 0.12, g: 0.6 }),
      F({ t: 'modal', f: 190, r: STONE, m: F([0.45, 0.2, 0.08]), dk: F([1, 0.6, 0.4]), at: 0.2, d: 0.05, g: 0.6 }),
      F({ t: 'ticks', src: 'pink', f: 900, f2: 2200, q: 5, n: 3, span: 0.3, at: 0.24, d: 0.007, g: 0.3, falloff: 0.4 }),
    ]),
  }),
  'mason.hit': F({
    bus: 'creature',
    prio: 3,
    gap: 0.5,
    level: 0.68,
    send: 0.15,
    space: 'world',
    floor: 0.6,
    maxInst: 1,
    vary: F({ rule: 'cycle', n: 2, pitch: 0.04, level: 0.04 }),
    note: 'the strike lands: a muffled body thud (a sub falling 70 -> 38 Hz, a low-passed slam, cloth and leather)',
    layers: F([
      F({ t: 'tone', w: 'sine', f: 70, f2: 38, sw: 0.08, a: 0.003, d: 0.2, g: 1 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 420, f2: 160, sw: 0.08, q: 0.5, a: 0.002, d: 0.09, g: 0.85 }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1100, q: 1, at: 0.005, a: 0.004, d: 0.04, g: 0.25 }),
    ]),
  }),
  'mason.dash': F({
    bus: 'creature',
    prio: 2,
    gap: 1.2,
    level: 0.62,
    send: 0.28,
    space: 'world',
    floor: 0.35,
    maxInst: 1,
    vary: F({ rule: 'cycle', n: 3, pitch: 0.05, level: 0.05, time: 0.1 }),
    note: 'the surge: a stone-scrape rumble rising fast, then Dopplering down past (900 -> 260 Hz), grit spraying',
    layers: F([
      F({ t: 'noise', src: 'brown', ft: 'bandpass', f: 140, f2: 520, sw: 0.35, q: 1.2, a: 0.25, h: 0.35, d: 0.35, g: 0.8, lfo: F([19, 0.45]) }),
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 900, f2: 260, sw: 0.4, q: 1.6, at: 0.55, a: 0.08, h: 0.25, d: 0.35, g: 0.45 }),
      F({ t: 'tone', w: 'sawtooth', f: 38, f2: 62, sw: 0.4, a: 0.3, h: 0.3, d: 0.35, g: 0.18 }),
      F({ t: 'ticks', src: 'white', f: 1200, f2: 3000, q: 5, n: 16, span: 1.1, at: 0.1, d: 0.006, g: 0.3, falloff: -0.2 }),
    ]),
  }),
  'mason.halt': F({
    bus: 'creature',
    prio: 2,
    gap: 0.8,
    level: 0.56,
    send: 0.25,
    space: 'world',
    floor: 0.35,
    maxInst: 1,
    vary: F({ rule: 'cycle', n: 2, pitch: 0.05, time: 0.06 }),
    note: 'the hard stop into the coil: a skid of stone scraping down, a settling thud, grit',
    layers: F([
      F({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1300, f2: 300, sw: 0.12, q: 1.4, a: 0.01, h: 0.1, d: 0.16, g: 0.75 }),
      F({ t: 'ticks', src: 'white', f: 1500, f2: 2800, q: 6, n: 9, span: 0.24, d: 0.005, g: 0.35, falloff: 0.6 }),
      F({ t: 'tone', w: 'sine', f: 95, f2: 50, sw: 0.05, at: 0.16, a: 0.003, d: 0.12, g: 0.55 }),
      F({ t: 'noise', src: 'brown', ft: 'lowpass', f: 380, q: 0, at: 0.16, a: 0.003, d: 0.08, g: 0.45 }),
    ]),
  }),
});

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The recipe a `mason:attack` phase plays ('' : none: stalk / stare / idle are the body's own sounds). */
export function attackSfxFor(phase) {
  switch (phase) {
    case 'rise':
      return MASON_ATTACK_IDS.rise;
    case 'lock':
      return MASON_ATTACK_IDS.lock;
    case 'strike':
      return MASON_ATTACK_IDS.strike;
    case 'recoil':
      return MASON_ATTACK_IDS.recoil;
    case 'hit':
      return MASON_ATTACK_IDS.hit;
    case 'dash':
      return MASON_ATTACK_IDS.dash;
    case 'halt':
      return MASON_ATTACK_IDS.halt;
    default:
      return '';
  }
}

function place(o, p) {
  o.x = num(p.x, NaN);
  o.y = num(p.y, NaN);
  o.z = num(p.z, NaN);
  return o.x === o.x && o.y === o.y && o.z === o.z;
}

/** Route: mason:attack {phase, x, y, z, k}. */
export function masonAttackRoute(p, E) {
  const id = attackSfxFor(p && p.phase);
  if (!id) return;
  const o = E.opts();
  if (!place(o, p)) o.dist = 8;
  E.play(id, clamp01(num(p.k, 0.7)), o);
}

/** Route: mason:rattle {k, x, y, z}. */
export function masonRattleRoute(p, E) {
  const o = E.opts();
  if (!place(o, p)) return;
  E.play(MASON_ATTACK_IDS.rattle, clamp01(num(p.k, 0.3)), o);
}

/** Adds the recipes and the routes to the game's audio (once). Returns true when the engine took them. */
export function registerMasonAttackSfx(audio) {
  if (!audio || typeof audio.registerSfx !== 'function' || typeof audio.registerSfxRoute !== 'function') return false;
  for (const id of Object.keys(MASON_ATTACK_RECIPES)) if (!audio.registerSfx(id, MASON_ATTACK_RECIPES[id])) return false;
  audio.registerSfxRoute('mason:attack', masonAttackRoute);
  audio.registerSfxRoute('mason:rattle', masonRattleRoute);
  return true;
}
