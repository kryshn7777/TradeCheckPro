/* THE LANTERN — audio/masonSightSfx.js
 * The designed cue of the Mason's NOTICE beat (plans/MASON_SIGHT.md): `creature:notice` = it has seen your light and has about half a
 * second before it commits to the chase. A hard stone KNOCK (its crown striking the wall, three blows close together), a low roar
 * swelling under it and a dry chitter: loud and placed in the world, so the warning comes before the chase ("heard before seen").
 *
 * Registered through the SFX engine's extension points (SFX_DESIGN.md §6) by AudioManager3D: registerSfx(NOTICE_ID, NOTICE_RECIPE)
 * and registerSfxRoute('creature:notice', noticeRoute). Pure data + one route: deterministic (the engine's variation rule, no
 * Math.random), allocation-free (the engine's reused opts()).
 */

export const NOTICE_ID = 'creature.notice';

export const NOTICE_RECIPE = Object.freeze({
  bus: 'creature',
  prio: 3,
  gap: 2.5,
  level: 0.75,
  send: 0.35,
  space: 'world',
  floor: 0.55,
  vary: { rule: 'cycle', n: 3, pitch: 0.04, time: 0.12 },
  note: 'the Mason sees your light: three hard stone knocks of its crown on the wall, a low roar swelling under them, a dry chitter',
  layers: [
    // the knocks (stone on stone, 0 / 0.11 / 0.22 s)
    { t: 'modal', f: 260, r: [1, 2.3, 3.9], m: [0.5, 0.2, 0.08], dk: [1, 0.6, 0.35], d: 0.05, g: 1 },
    { t: 'modal', f: 245, r: [1, 2.3, 3.9], m: [0.5, 0.2, 0.08], dk: [1, 0.6, 0.35], at: 0.11, d: 0.05, g: 0.9 },
    { t: 'modal', f: 230, r: [1, 2.3, 3.9], m: [0.55, 0.22, 0.08], dk: [1, 0.6, 0.35], at: 0.22, d: 0.06, g: 1 },
    { t: 'tone', w: 'sine', f: 90, f2: 48, sw: 0.05, a: 0.002, d: 0.12, g: 0.7 },
    // the roar: a sub swell and a growled low band
    { t: 'tone', w: 'sawtooth', f: 52, f2: 61, sw: 0.5, at: 0.15, a: 0.25, h: 0.35, d: 0.5, g: 0.32 },
    { t: 'noise', src: 'brown', ft: 'bandpass', f: 170, f2: 240, sw: 0.4, q: 1.8, at: 0.12, a: 0.25, h: 0.3, d: 0.5, g: 0.6, lfo: [27, 0.7] },
    // the chitter
    { t: 'ticks', src: 'white', f: 1400, f2: 3200, q: 6, n: 10, span: 0.35, at: 0.3, d: 0.006, g: 0.3, falloff: 0.4 },
  ],
});

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Route: plays the notice at the creature (payload {x, y, z, distance}). */
export function noticeRoute(p, E) {
  const o = E.opts();
  o.x = num(p.x, NaN);
  o.y = num(p.y, NaN);
  o.z = num(p.z, NaN);
  if (!(o.x === o.x && o.y === o.y && o.z === o.z)) o.dist = num(p.distance, 20);
  E.play(NOTICE_ID, 0.8, o);
}
