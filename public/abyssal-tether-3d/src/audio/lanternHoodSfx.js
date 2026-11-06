/* THE LANTERN — audio/lanternHoodSfx.js
 * THE HOOD (plans/LANTERN_HOOD.md): the two designed sounds of covering the lantern, on the 'lantern:hood' {on} bus event.
 *   cover   'lantern.hood'    a gloved palm closing over the warm glass (a soft muffled slap, leather and canvas rustling) and the
 *                             flame's breath choking down to a thin hiss: close, small, in the left hand.
 *   uncover 'lantern.unhood'  the hand lifting off and the starved flame catching its air again: a breathy whoomp swelling up, a
 *                             tick of the hot glass, the roar settling: a little louder than the cover (the light is back, and so is
 *                             what it draws).
 * Registered through the SFX engine's extension points (audio3d.js registerSfx / registerSfxRoute, SFX_DESIGN.md §6) by
 * registerLanternHoodSfx(audio); without the engine it does nothing. Pure data + one route: deterministic (the engine's 'cycle'
 * rule, no random calls), allocation-free (the engine's reused opts()). Node-importable.
 */

export const HOOD_SFX_ID = 'lantern.hood';
export const UNHOOD_SFX_ID = 'lantern.unhood';

export const HOOD_RECIPE = Object.freeze({
  bus: 'player',
  prio: 1,
  gap: 0.15,
  level: 0.42,
  send: 0.05,
  space: 'hand',
  maxInst: 1,
  vary: Object.freeze({ rule: 'cycle', n: 3, pitch: 0.05, level: 0.08, time: 0.08 }),
  note: 'the hood: a gloved palm closes over the warm glass, leather and canvas rustle, the flame chokes to a thin hiss',
  layers: Object.freeze([
    // the palm on the glass: a soft, low, muffled slap
    Object.freeze({ t: 'tone', w: 'sine', f: 150, f2: 82, sw: 0.04, a: 0.003, d: 0.07, g: 0.55 }),
    Object.freeze({ t: 'noise', src: 'pink', ft: 'lowpass', f: 900, q: 0.7, a: 0.003, d: 0.05, g: 0.5 }),
    // the leather / canvas rustle as the fingers close round it
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1600, f2: 700, sw: 0.18, q: 1.2, at: 0.02, a: 0.04, h: 0.05, d: 0.12, g: 0.28 }),
    Object.freeze({ t: 'ticks', src: 'white', f: 1800, f2: 3600, q: 4, n: 5, span: 0.16, at: 0.02, d: 0.006, g: 0.1, falloff: 0.5 }),
    // the flame's breath choking down: a band of air sweeping low and thinning to a hiss
    Object.freeze({ t: 'noise', src: 'brown', ft: 'bandpass', f: 420, f2: 180, sw: 0.22, q: 1.4, at: 0.01, a: 0.02, h: 0.04, d: 0.2, g: 0.35 }),
    Object.freeze({ t: 'noise', src: 'white', ft: 'highpass', f: 5200, q: 0, at: 0.16, a: 0.05, h: 0.08, d: 0.25, g: 0.05 }),
  ]),
});

export const UNHOOD_RECIPE = Object.freeze({
  bus: 'player',
  prio: 1,
  gap: 0.15,
  level: 0.5,
  send: 0.08,
  space: 'hand',
  maxInst: 1,
  vary: Object.freeze({ rule: 'cycle', n: 3, pitch: 0.05, level: 0.08, time: 0.08 }),
  note: 'the uncover: the hand lifts, the starved flame catches its air: a breathy whoomp swelling, a tick of hot glass, the roar settling',
  layers: Object.freeze([
    // the hand lifting off (a dry brush of leather)
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1300, f2: 2200, sw: 0.08, q: 1.5, a: 0.01, d: 0.06, g: 0.2 }),
    // the flare-back: air rushing into the flame, a low whoomp swelling then settling
    Object.freeze({ t: 'noise', src: 'brown', ft: 'lowpass', f: 160, f2: 620, sw: 0.14, q: 1.1, at: 0.03, a: 0.09, h: 0.05, d: 0.32, g: 0.7 }),
    Object.freeze({ t: 'tone', w: 'sine', f: 62, f2: 96, sw: 0.12, at: 0.03, a: 0.08, d: 0.22, g: 0.32 }),
    // the hot glass ticking as the heat comes back
    Object.freeze({ t: 'modal', f: 2350, r: Object.freeze([1, 2.4, 4.1]), m: Object.freeze([0.3, 0.12, 0.05]), dk: Object.freeze([1, 0.6, 0.4]), at: 0.12, d: 0.04, g: 0.5 }),
    // the flame's roar settling into its steady breath
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: 520, f2: 360, sw: 0.4, q: 1.6, at: 0.08, a: 0.1, h: 0.15, d: 0.4, g: 0.3, lfo: Object.freeze([9, 0.35]) }),
  ]),
});

/** Route: 'lantern:hood' {on}: the cover or the flare-back at the left hand (the lantern hangs from the left bracer). */
export function lanternHoodRoute(p, E) {
  const o = E.opts();
  o.hand = 'left';
  E.play(p && p.on ? HOOD_SFX_ID : UNHOOD_SFX_ID, 0.6, o);
}

/** Adds the recipes and the route to the game's audio (once). Returns true when the engine took them. */
export function registerLanternHoodSfx(audio) {
  if (!audio || typeof audio.registerSfx !== 'function' || typeof audio.registerSfxRoute !== 'function') return false;
  const a = audio.registerSfx(HOOD_SFX_ID, HOOD_RECIPE);
  const b = audio.registerSfx(UNHOOD_SFX_ID, UNHOOD_RECIPE);
  if (!a || !b) return false;
  audio.registerSfxRoute('lantern:hood', lanternHoodRoute);
  return true;
}
