/* THE LANTERN (ABYSSAL TETHER 3D) — audio/focusPing.js
 * PUZZLE FOCUS (plans/PUZZLE_FOCUS.md): the spatial 'tick-tick' at a puzzle when a focus beat starts. Most useful in the headset, where
 * the view is never turned: the ear finds the fixture before the eye does. A designed recipe for the SFX engine (sfxDesign.js /
 * sfxBank.js format: three layers, deterministic 'hash' variation by the puzzle's position, no Math.random) and its bus route
 * 'focus:ping' { x, y, z, key }. registerFocusPing(audio) adds both through the engine's extension points (audio3d.js registerSfx /
 * registerSfxRoute); without the engine (no audio, a test double) it does nothing. Pure data + one function: Node-importable.
 */

/** The recipe: two small brass ticks (the suit's scanner locking on), a glassy struck partial under them, a breath of air on top. */
export const FOCUS_PING_RECIPE = Object.freeze({
  bus: 'ui',
  prio: 1,
  gap: 2,
  level: 0.34,
  send: 0.35,
  space: 'world',
  floor: 0.55, // heard across a shaft: a 30 m fixture still ticks
  maxInst: 1,
  vary: Object.freeze({ rule: 'hash', n: 4, pitch: 0.035, level: 0.06, time: 0.08 }),
  note: 'puzzle focus: a scanner lock-on at the fixture, tick-tick and a soft glass ring',
  layers: Object.freeze([
    // tick-tick: two bright, narrow clicks 0.13 s apart
    Object.freeze({ t: 'ticks', src: 'white', f: 3200, f2: 4200, q: 9, n: 2, span: 0.13, d: 0.008, g: 0.55, falloff: 0.15 }),
    // the glass ring: a struck partial set (A5 with glass ratios), short
    Object.freeze({ t: 'modal', f: 880, r: Object.freeze([1, 2.71, 5.12]), m: Object.freeze([1, 0.35, 0.12]), at: 0.02, a: 0.003, d: 0.32, g: 0.28 }),
    // a breath of air rising under it (the lock settling)
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1800, f2: 2600, sw: 0.25, q: 2.5, at: 0.05, a: 0.06, h: 0.05, d: 0.18, g: 0.12 }),
  ]),
});

/** The route: plays the recipe at the event's position; the variant is a hash of it (the same fixture always ticks the same). */
export function focusPingRoute(p, E) {
  const o = E.opts();
  o.x = typeof p.x === 'number' ? p.x : NaN;
  o.y = typeof p.y === 'number' ? p.y : NaN;
  o.z = typeof p.z === 'number' ? p.z : NaN;
  if (!(o.x === o.x && o.y === o.y && o.z === o.z)) o.dist = 12;
  o.key = (p.key | 0) || ((Math.round(o.x * 7) * 73856093) ^ (Math.round(o.y * 7) * 19349663) ^ (Math.round(o.z * 7) * 83492791));
  E.play('focus.ping', 0.5, o);
}

/** Adds the recipe and the route to the game's audio (once). Returns true when the engine took them. */
export function registerFocusPing(audio) {
  if (!audio || typeof audio.registerSfx !== 'function' || typeof audio.registerSfxRoute !== 'function') return false;
  const rec = audio.registerSfx('focus.ping', FOCUS_PING_RECIPE);
  if (!rec) return false;
  audio.registerSfxRoute('focus:ping', focusPingRoute);
  return true;
}
