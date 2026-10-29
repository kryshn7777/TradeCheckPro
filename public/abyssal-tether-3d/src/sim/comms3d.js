/* ABYSSAL TETHER 3D — comms3d.js (EXPEDITION: the comms core and the restore reframing; docs/abyssal-tether-3d/plans/COMMS.md)
 * Elias Wren goes down the sealed shaft for PERENNIAL in 2291. Four voices talk to him over a wireless uplink (Odessa Vance,
 * the programme director; Tomasz "Tick" Ilic, the uplink tech; Dr. Maren Soll, the historian; Vesper, the suit AI). The
 * signal fails as the shaft deepens. A death is no longer "waking at a lamp": CONTINUITY restores him at the last relay.
 *
 * This module is the pure, deterministic part (DOM-free, three.js-free, runs in Node; seeded; no Math.random, no clock but dt):
 *   COMMS_SCRIPT      the Chapter I transmissions (speaker, text, trigger, priority, the killer beats)
 *   SIGNAL_ARC        the signal per section (S1 clear -> S8 nearly gone, NO SIGNAL at the Mark) and which glitches it allows
 *   CommsDirector     the scheduler: bus events + a per-frame context in, one transmission at a time out (never overlapping,
 *                     never during an attack wind-up / a measure, priority + chatter cooldown, stale lines dropped), the signal
 *                     0..1 and its bars, deterministic glitch events per transmission
 *   planRestore()     the CONTINUITY restore sequence shown instead of the death panel (cause line, sync, RESTORE N, a last
 *                     line that worsens with the count and the depth)
 *   bloodGaze()       the "camera sees bare stone" beat: is the view resting on a blood writing (Settings › Display only)?
 * The presentation lives elsewhere: render/commsView.js (the subtitle panel and the restore overlay: one head-locked quad),
 * audio/radio3d.js (the synthesised radio voices: a PLACEHOLDER for real VO), render/healthFx.js (the signal bars on the ECG).
 * game.js owns one director, feeds it the bus and the context, and forwards its lines to the bus ('comms:line' / 'comms:end').
 * Nothing here changes the simulation: comms is presentation keyed on events (`?comms=off` turns all of it off).
 */

// ---- speakers ------------------------------------------------------------------------------------------------------------
/** The cast (FUTURE_STORY_PLAN §2.1). colour + shape: never colour alone (colour-blind safe). `local`: in the suit, not on the uplink. */
export const SPEAKERS = Object.freeze({
  ODESSA: Object.freeze({ key: 'ODESSA', label: 'ODESSA', who: 'Odessa Vance, programme director', color: '#e6b85c', shape: 'diamond', initial: 'O', local: false }),
  TICK: Object.freeze({ key: 'TICK', label: 'TICK', who: 'Tomasz "Tick" Ilic, uplink tech', color: '#64d3e0', shape: 'circle', initial: 'T', local: false }),
  MAREN: Object.freeze({ key: 'MAREN', label: 'MAREN', who: 'Dr. Maren Soll, historian of the Lanternwrights', color: '#f2eee4', shape: 'triangle', initial: 'M', local: false }),
  VESPER: Object.freeze({ key: 'VESPER', label: 'VESPER', who: 'Vesper, suit AI', color: '#a9b2b8', shape: 'square', initial: 'V', local: true }),
  UPLINK: Object.freeze({ key: 'UPLINK', label: 'UPLINK', who: 'the open channel (no speaker)', color: '#d06a5a', shape: 'cross', initial: '?', local: false }),
});

// ---- text limits (the subtitle panel: at most 2 lines of 42 characters, read in 3-5 s) ------------------------------------
export const LINE_MAX_CHARS = 84;
export const WRAP_CHARS = 42;
export const WRAP_LINES = 2;
export const MAX_WORDS = 11;
export const HOLD_MIN = 2.5;
export const HOLD_MAX = 5.5;
/** Every character the subtitle panel and the restore overlay draw (plain system fonts: ASCII and the em dash). */
export const COMMS_CHARSET = /^[A-Za-z0-9 .,'?!:;%()[\]—-]*$/;

function wordCount(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const w = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (w && !inWord) n++;
    inWord = w || (inWord && (c === 39 || c === 46) && i + 1 < text.length && /[A-Za-z0-9]/.test(text[i + 1]));
  }
  return n;
}
export { wordCount };

/** Seconds a line stays on the panel: max(2.5, words / 2.6 + 1) (FUTURE_STORY_PLAN §2.2), capped at 5.5. */
export function holdTime(text) {
  const t = wordCount(text) / 2.6 + 1;
  return t < HOLD_MIN ? HOLD_MIN : t > HOLD_MAX ? HOLD_MAX : t;
}

/** Seconds the voice speaks (the babble the radio plays): words at ~2.9 a second plus the pauses at the punctuation. */
export function speakTime(text) {
  let p = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === ',' || c === ';' || c === ':' || c === '—') p += 0.16;
    else if ((c === '.' || c === '?' || c === '!') && (i + 1 >= text.length || text[i + 1] === ' ')) p += 0.26;
  }
  const t = wordCount(text) / 2.9 + 0.2 + p;
  const max = holdTime(text) - 0.45;
  return t < 0.6 ? 0.6 : t > max ? max : t;
}

/** Greedy word wrap at `width` characters (the panel wraps by measured width; this is the data rule the tests hold). */
export function wrapText(text, width = WRAP_CHARS) {
  const words = String(text).split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!w) continue;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---- the signal ----------------------------------------------------------------------------------------------------------
/**
 * The degradation arc of Chapter I (FUTURE_STORY_PLAN §2.4: five bars at the Threshold, failing toward the Mark). Per section:
 * the signal at its top (it falls linearly to the next section's value by its bottom; S8 falls to 0 at the Mark), the uplink
 * latency (s a reply takes), and the chance per transmission of each glitch the arc allows there. S1-S2 are clean.
 */
export const SIGNAL_ARC = Object.freeze([
  Object.freeze({ id: 's1', signal: 1.0, latency: 0.1, glitch: Object.freeze({ static: 0, dropout: 0, repeat: 0 }) }),
  Object.freeze({ id: 's2', signal: 0.94, latency: 0.2, glitch: Object.freeze({ static: 0, dropout: 0, repeat: 0 }) }),
  Object.freeze({ id: 's3', signal: 0.82, latency: 0.35, glitch: Object.freeze({ static: 0.2, dropout: 0, repeat: 0 }) }),
  Object.freeze({ id: 's4', signal: 0.7, latency: 0.5, glitch: Object.freeze({ static: 0.35, dropout: 0, repeat: 0 }) }),
  Object.freeze({ id: 's5', signal: 0.58, latency: 0.7, glitch: Object.freeze({ static: 0.45, dropout: 0.25, repeat: 0 }) }),
  Object.freeze({ id: 's6', signal: 0.46, latency: 0.9, glitch: Object.freeze({ static: 0.55, dropout: 0.4, repeat: 0.12 }) }),
  Object.freeze({ id: 's7', signal: 0.33, latency: 1.1, glitch: Object.freeze({ static: 0.65, dropout: 0.5, repeat: 0.2 }) }),
  Object.freeze({ id: 's8', signal: 0.2, latency: 1.5, glitch: Object.freeze({ static: 0.75, dropout: 0.6, repeat: 0.25 }) }),
]);
/** Depth (m) of the Mark (the S8 grate): no signal from here down. */
export const MARK_DEPTH = 544;
/** Signal thresholds of 5, 4, 3, 2, 1 bars (below the last: NO SIGNAL). */
export const BAR_STEPS = Object.freeze([0.86, 0.66, 0.46, 0.26, 0.06]);

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** The arc's signal in section `index` at `frac` (0 at its top .. 1 at its bottom); non-increasing down the shaft. */
export function signalAt(index, frac) {
  const n = SIGNAL_ARC.length;
  if (!(index >= 0)) return SIGNAL_ARC[0].signal;
  if (index >= n) return 0;
  const i = index | 0;
  const a = SIGNAL_ARC[i].signal;
  const b = i + 1 < n ? SIGNAL_ARC[i + 1].signal : 0;
  const f = clamp(frac === frac ? frac : 0, 0, 1);
  return a + (b - a) * f;
}

export function barsFor(signal) {
  for (let i = 0; i < BAR_STEPS.length; i++) if (signal >= BAR_STEPS[i]) return 5 - i;
  return 0;
}

export function latencyAt(index) {
  const i = clamp(index | 0, 0, SIGNAL_ARC.length - 1);
  return SIGNAL_ARC[i].latency;
}

// ---- deterministic randomness --------------------------------------------------------------------------------------------
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}
function mix(a, b) {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
/** mulberry32 over a 32-bit state object (no closure allocation per call). */
function rnd(st) {
  st.s = (st.s + 0x6d2b79f5) >>> 0;
  let t = st.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Smooth 1D value noise in [-1, 1] (the signal's slow wander). */
function vnoise(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = (mix(seed, i) / 4294967296) * 2 - 1;
  const b = (mix(seed, i + 1) / 4294967296) * 2 - 1;
  return a + (b - a) * u;
}

// ---- the script ----------------------------------------------------------------------------------------------------------
/**
 * One transmission. `when` (one trigger or a list): { enter, after } first entry of `section` (+after s) · { depth } the
 * player at or below `depth` m in `section` · { ev, match, text } a bus event (payload fields equal / a hint containing
 * `text`) · { chain, gap } `gap` s after the line `chain` ENDS · { stall } no progress in `section` for STALL s · { restore }
 * after a respawn ('first' | a cause | 'many') · { gaze } 3 s looking at a blood writing (Blood writing ON only) ·
 * { skit } the first skitterling contact. prio 3 (beats, the opening) > 2 (story) > 1 (flavour, voiced hints). `section`
 * -1: anywhere. `kind`: radio | offmic (the hot mic) | notquite (a voice that is not quite the speaker) | echo (the channel
 * plays something back). `glitch`: 'none' keeps it clean, 'repeat' forces the stuck word. `skip`: the opening (continue skips).
 */
function L(id, speaker, text, o) {
  return Object.freeze({
    id,
    speaker,
    text,
    section: o.section != null ? o.section : -1,
    when: Object.freeze(Array.isArray(o.when) ? o.when.map((w) => Object.freeze(w)) : [Object.freeze(o.when)]),
    prio: o.prio != null ? o.prio : 2,
    ttl: o.ttl != null ? o.ttl : o.prio === 3 ? 45 : o.prio === 1 ? 14 : 22,
    cd: o.cd || 0, // > 0: repeatable after cd s
    kind: o.kind || 'radio',
    glitch: o.glitch || null,
    skip: !!o.skip,
    beat: o.beat || null,
  });
}

export const COMMS_SCRIPT = Object.freeze([
  // ---- S1 THE THRESHOLD: the opening (the restore he takes for a lowering), then Odessa's slip at the bell ----
  L('s1-open-1', 'VESPER', 'Restore complete. Continuity 99.8%.', { section: 0, when: { enter: true, after: 1.4 }, prio: 3, skip: true, beat: 'opening', glitch: 'none' }),
  L('s1-open-2', 'ODESSA', 'First descent, Elias. History.', { section: 0, when: { chain: 's1-open-1', gap: 0.4 }, prio: 3, skip: true, glitch: 'none' }),
  L('s1-open-3', 'TICK', "Uplink's clean, five bars. I've got your eyes and your heart.", { section: 0, when: { chain: 's1-open-2', gap: 0.5 }, prio: 3, skip: true, glitch: 'none' }),
  L('s1-open-4', 'MAREN', "Nobody's stood there since 1791. Read me every board you pass.", { section: 0, when: { chain: 's1-open-3', gap: 0.5 }, prio: 3, skip: true, glitch: 'none' }),
  L('s1-open-5', 'ODESSA', "The Ember's dimming, Elias. Bring us a kindling. Take your time.", { section: 0, when: { chain: 's1-open-4', gap: 0.5 }, prio: 3, skip: true, glitch: 'none' }),
  L('s1-bell-1', 'ODESSA', "Mind the bell, Elias. It's louder than last time.", { section: 0, when: [{ ev: 'hint', text: 'bell' }, { ev: 'bell:ring' }], prio: 2, ttl: 45, beat: 'the slip' }),
  L('s1-bell-2', 'TICK', 'Last time?', { section: 0, when: { chain: 's1-bell-1', gap: 0.35 }, prio: 2 }),
  L('s1-bell-3', 'ODESSA', 'The probes, Tomasz. Focus.', { section: 0, when: { chain: 's1-bell-2', gap: 0.3 }, prio: 2 }),
  L('s1-stall', 'TICK', 'Fire at the glowing ring and hold. Let the rope work.', { section: 0, when: { stall: true }, prio: 1 }),
  // ---- S2 THE LONG SWING ----
  L('s2-board', 'MAREN', "'It does not send us back.' Cheerful people, the Lanternwrights.", { section: 1, when: { depth: 24 }, prio: 1 }),
  L('s2-haul', 'MAREN', "That chain's been oiled. Recently. Write that down, Tomasz.", { section: 1, when: { ev: 'objective:done', match: { verb: 'haul' } }, prio: 2 }),
  L('s2-stall', 'TICK', "Hook the counterweight and haul. That's your way down.", { section: 1, when: { stall: true }, prio: 1 }),
  // ---- S3 BROKEN GALLERY ----
  L('s3-enter', 'MAREN', 'Closed from this side. So someone was still inside.', { section: 2, when: { enter: true, after: 3 }, prio: 2 }),
  L('s3-winch', 'TICK', "Gear's turning. Five hundred years, and it still turns.", { section: 2, when: { ev: 'objective:done', match: { verb: 'winch' } }, prio: 1 }),
  L('s3-stall', 'TICK', 'Ride the gear. Hook its ring and hold on.', { section: 2, when: { stall: true }, prio: 1 }),
  // ---- S4 THE LISTENING VAULT: the channel plays your breathing back ----
  L('s4-enter', 'ODESSA', "A hundred metres, Elias. Vitals good. Signal's thinning.", { section: 3, when: { enter: true, after: 1.5 }, prio: 2 }),
  L('s4-sight', 'TICK', 'Did you see that? Something big, out in the dark.', { when: { ev: 'creature:sighting' }, prio: 2, ttl: 10 }),
  L('s4-knock', 'MAREN', "If something knocks, don't knock back. Their rule. I'd keep it.", { section: 3, when: { depth: 108 }, prio: 2 }),
  L('s4-echo', 'UPLINK', '[Your breathing comes back on the channel. Two seconds late.]', { section: 3, when: { depth: 124 }, prio: 2, kind: 'echo', glitch: 'none', beat: 'the late breath' }),
  L('s4-stall', 'ODESSA', 'The cold lamps, Elias. Hold your lantern to each one.', { section: 3, when: { stall: true }, prio: 1 }),
  // ---- S5 THE GULLET STAIR: the line nobody sent ----
  L('s5-enter', 'ODESSA', "Contact above you, Elias. Keep moving. Don't look for it.", { section: 4, when: { enter: true, after: 1 }, prio: 2 }),
  L('s5-frayed', 'TICK', 'Careful in the middle. Those rings are frayed. They hold once.', { section: 4, when: { enter: true, after: 14 }, prio: 3, beat: 'the line nobody sent' }),
  L('s5-mute', 'TICK', 'Sorry, been on mute for two minutes. Did I miss anything?', { when: { chain: 's5-frayed', gap: 40 }, prio: 3, ttl: 60 }),
  L('s5-key', 'TICK', 'That was loud. Everything down there heard that.', { section: 4, when: { ev: 'objective:done', match: { verb: 'breach' } }, prio: 2 }),
  L('s5-stall', 'TICK', 'The keystone: hide and let it knock, or haul its ring.', { section: 4, when: { stall: true }, prio: 1 }),
  // ---- S6 THE TWO DESCENTS: the first skitterlings ----
  L('s6-enter', 'VESPER', 'Signal degraded. Latency rising.', { section: 5, when: { enter: true, after: 0.8 }, prio: 2 }),
  L('s6-fork', 'MAREN', "The Throat is 'for the late'. I'd like you early, Elias.", { section: 5, when: { enter: true, after: 5 }, prio: 1 }),
  L('s6-skit', 'VESPER', 'Contact. Small. Closing.', { when: { skit: true }, prio: 2, ttl: 8 }),
  L('s6-stall', 'MAREN', "Either way down will do. Standing still won't.", { section: 5, when: { stall: true }, prio: 1 }),
  // ---- S7 THE HOLLOW NAVE: the stuck word ----
  L('s7-enter', 'MAREN', 'Nothing to stand on. A church you can only hang in.', { section: 6, when: { enter: true, after: 2 }, prio: 1 }),
  L('s7-hang', 'TICK', 'The floor unbolts while you hold. So hold, Wren.', { section: 6, when: { depth: 296 }, prio: 2, glitch: 'repeat' }),
  L('s7-iris', 'ODESSA', 'The iris is open. Go now, Elias.', { section: 6, when: { ev: 'objective:done', match: { verb: 'survive' } }, prio: 2, ttl: 10 }),
  L('s7-stall', 'TICK', 'Chain the rings. Fire the next before you let go.', { section: 6, when: { stall: true }, prio: 1 }),
  // ---- S8 THE LAST THROAT: two hearts, the voice that is not quite Odessa, the uplink lost ----
  L('s8-enter', 'ODESSA', "Signal's going, Elias. Whatever you hear after this, it's us.", { section: 7, when: { enter: true, after: 1 }, prio: 3, beat: 'it is us' }),
  L('s8-two', 'VESPER', 'Heart rates: two. Recalibrating.', { section: 7, when: { depth: 470 }, prio: 2, beat: 'two hearts (foreshadow)' }),
  L('s8-probes', 'TICK', 'Probes all died at five-fifty-six. No pressure, Wren.', { section: 7, when: { depth: 500 }, prio: 2 }),
  L('s8-warm', 'ODESSA', "Keep coming down, Elias. It's warm down here.", { section: 7, when: { depth: 526 }, prio: 3, kind: 'notquite', beat: 'not quite Odessa' }),
  L('s8-lost', 'VESPER', 'Uplink lost.', { section: 7, when: { depth: 538 }, prio: 3, ttl: 12 }),
  L('s8-stall', 'ODESSA', 'The grate, Elias. Run for the light.', { section: 7, when: { stall: true }, prio: 1 }),
  // ---- anywhere: hurt, staging, the first relay, the bare stone ----
  L('any-hurt', 'TICK', 'Vesper says that was minor. I say ow. Easy, Wren.', { when: { ev: 'health:damage', match: { lethal: false } }, prio: 1, ttl: 8 }),
  L('any-low', 'ODESSA', 'Vitals red. Staging a restore at the last relay.', { when: { ev: 'health:low' }, prio: 2, ttl: 8, cd: 75 }),
  L('any-relay', 'TICK', "That lamp's a relay now. Anything happens, we restore you there.", { when: { ev: 'checkpoint' }, prio: 2, ttl: 25 }),
  L('any-gaze', 'TICK', "What are you looking at? Your feed's just stone.", { when: { gaze: true }, prio: 2, ttl: 6, beat: 'the camera sees bare stone' }),
  // ---- after a restore (the radio reacts; the first one leaves the mic hot) ----
  L('back-1', 'TICK', 'Wren? Wren, sync is holding. Welcome back.', { when: { restore: 'first' }, prio: 3, ttl: 20, glitch: 'none' }),
  L('back-hot-1', 'TICK', '...did he see it? The body?', { when: { chain: 'back-1', gap: 0.9 }, prio: 3, kind: 'offmic', glitch: 'none', beat: 'hot mic' }),
  L('back-hot-2', 'ODESSA', 'Cut the hot mic, Tomasz.', { when: { chain: 'back-hot-1', gap: 0.25 }, prio: 3, glitch: 'none' }),
  L('back-impact', 'ODESSA', 'Restore logged. Slower on the rope this time, Elias.', { when: { restore: 'impact' }, prio: 2, ttl: 15, cd: 1 }),
  L('back-skitter', 'MAREN', 'Whatever that was, the boards warned us about it.', { when: { restore: 'skitter' }, prio: 2, ttl: 15, cd: 1 }),
  L('back-mason', 'ODESSA', 'It came for you when you bled. Noted.', { when: { restore: 'mason' }, prio: 2, ttl: 15, cd: 1 }),
  L('back-dressed', 'TICK', 'Your feed went square for a second. Then black.', { when: { restore: 'dressed' }, prio: 2, ttl: 15, cd: 1 }),
  L('back-many', 'ODESSA', "Fidelity holding. You're fine, Elias. You're fine.", { when: { restore: 'many' }, prio: 2, ttl: 15, cd: 1 }),
]);

/** No progress (depth or an objective) in a section this long: its voiced hint (once per section). */
export const STALL_TIME = 60;
/** Gaze this long at a blood writing (Blood writing ON) for the bare-stone beat. */
export const GAZE_TIME = 3;
/** Silence between two transmissions (s). */
export const MIN_GAP = 0.7;
/** At most one flavour line (prio <= 1) per this many seconds (FUTURE_STORY_PLAN §2.2). */
export const CHATTER_GAP = 20;
/** Glitch visuals never flash faster than 3 Hz: onsets at least this far apart, each at least MIN_GLITCH long. */
export const GLITCH_SPACING = 0.34;
export const MIN_GLITCH = 0.17;
/** The restore reactions: on the first three restores of a run, then every third. */
export function reactsToRestore(n) {
  return n >= 1 && (n <= 3 || (n - 1) % 3 === 0);
}

/**
 * Deterministic glitch events of one transmission: [{ kind: 'static' | 'dropout' | 'repeat' | 'label', t, dur }], sorted,
 * onsets >= GLITCH_SPACING apart. Only the kinds SIGNAL_ARC allows in `section`; none for the suit (Vesper), the opening or a
 * line marked clean. Returns { events, text } (text: the display text, with the stuck word when a repeat fires).
 */
export function makeGlitches(seed, line, section, speak, n) {
  const events = [];
  let text = line.text;
  const sp = SPEAKERS[line.speaker];
  const i = clamp(section | 0, 0, SIGNAL_ARC.length - 1);
  if (line.kind === 'notquite') events.push({ kind: 'label', t: Math.min(0.7, speak * 0.3), dur: 0.5 });
  if (line.glitch === 'none' || line.skip || !sp || sp.local) return { events, text };
  const g = SIGNAL_ARC[i].glitch;
  const st = { s: mix(mix(seed >>> 0, hashStr(line.id)), n | 0) };
  const span = Math.max(0.4, speak - 0.5);
  if (g.static > 0 && rnd(st) < g.static) {
    const k = rnd(st) < g.static * 0.5 ? 2 : 1;
    for (let j = 0; j < k; j++) events.push({ kind: 'static', t: 0.25 + rnd(st) * span, dur: MIN_GLITCH + rnd(st) * 0.2 });
  }
  if (g.dropout > 0 && rnd(st) < g.dropout) events.push({ kind: 'dropout', t: 0.35 + rnd(st) * Math.max(0.2, speak - 1), dur: 0.35 + rnd(st) * 0.4 });
  const wantRepeat = line.glitch === 'repeat' || (g.repeat > 0 && rnd(st) < g.repeat);
  if (wantRepeat) {
    const words = text.split(' ');
    // a word of 3-7 letters after the first, the line still in two panel lines
    for (let tries = 0; tries < 6; tries++) {
      const w = 1 + Math.floor(rnd(st) * Math.max(1, words.length - 1));
      const bare = (words[w] || '').replace(/[^A-Za-z']/g, '');
      if (bare.length < 3 || bare.length > 7) continue;
      const stuck = words.slice(0, w).concat([bare + '—', bare + '—'], words.slice(w)).join(' ');
      if (stuck.length > LINE_MAX_CHARS || wrapText(stuck).length > WRAP_LINES || wrapText(stuck).some((l) => l.length > WRAP_CHARS)) continue;
      text = stuck;
      events.push({ kind: 'repeat', t: Math.min(span, 0.2 + (speak * w) / Math.max(1, words.length)), dur: 0.45 });
      break;
    }
  }
  events.sort((a, b) => a.t - b.t);
  // never faster than 3 Hz: drop an onset that comes too soon after the previous event's onset or end
  const out = [];
  let lastOn = -10;
  let lastEnd = -10;
  for (const e of events) {
    if (e.dur < MIN_GLITCH) e.dur = MIN_GLITCH;
    if (e.t - lastOn < GLITCH_SPACING || e.t < lastEnd + GLITCH_SPACING * 0.5) continue;
    out.push(e);
    lastOn = e.t;
    lastEnd = e.t + e.dur;
  }
  return { events: out, text };
}

// ---- the director ----------------------------------------------------------------------------------------------------------
const QUEUE_MAX = 8;
const LOG_MAX = 64;

/**
 * The scheduler. game.js: onEvent(type, payload) for the bus events it subscribes to (DIRECTOR_EVENTS), update(dt, ctx) once a
 * frame while a run is on (ctx: { playing, section, depth, frac, danger, tense, skip, gaze, bloodOn }), onStart / onEnd
 * callbacks forward the transmissions to the bus. Readable state: current (the transmission on air or null), signal (0..1),
 * bars (0..5), latency, clock, deaths, lastHurtCause / lastHurtAt (the restore tells a skitterling from the Mason).
 */
export const DIRECTOR_EVENTS = Object.freeze([
  'game:start',
  'game:restart',
  'game:menu',
  'game:pause',
  'game:victory',
  'section:enter',
  'checkpoint',
  'hint',
  'bell:ring',
  'objective:done',
  'health:damage',
  'health:low',
  'creature:sighting',
  'creature:state',
  'dresser:appear',
  'player:death',
  'game:respawn',
]);

export class CommsDirector {
  /** @param {{seed?:number, script?:object[]}} [opts] */
  constructor(opts) {
    const o = opts || {};
    this.seed = (o.seed | 0) >>> 0 || 0x51a7e;
    this.script = o.script || COMMS_SCRIPT;
    this.byId = Object.create(null);
    this.byEv = Object.create(null);
    this.enterBy = [];
    this.depthBy = [];
    this.stallBy = [];
    this.chainBy = Object.create(null);
    this.restoreBy = Object.create(null);
    this.gazeLines = [];
    this.skitLines = [];
    for (const line of this.script) {
      this.byId[line.id] = line;
      for (const w of line.when) {
        if (w.enter) (this.enterBy[line.section] || (this.enterBy[line.section] = [])).push(line);
        else if (w.depth != null) (this.depthBy[line.section] || (this.depthBy[line.section] = [])).push(line);
        else if (w.stall) (this.stallBy[line.section] || (this.stallBy[line.section] = [])).push(line);
        else if (w.chain) (this.chainBy[w.chain] || (this.chainBy[w.chain] = [])).push(line);
        else if (w.restore) this.restoreBy[w.restore] = line;
        else if (w.gaze) this.gazeLines.push(line);
        else if (w.skit) this.skitLines.push(line);
        else if (w.ev) (this.byEv[w.ev] || (this.byEv[w.ev] = [])).push({ line, w });
      }
    }
    for (const list of this.depthBy) if (list) list.sort((a, b) => depthOf(a) - depthOf(b));
    this.queue = [];
    this.log = [];
    this.onStart = null;
    this.onEnd = null;
    this.reset(true);
  }

  /** A new run (or the menu): silence, every line available again, the signal back to the Threshold's. */
  reset(fresh) {
    this.clock = 0;
    this.current = null;
    this.queue.length = 0;
    this.said = Object.create(null); // id -> clock when it last started
    this.section = 0;
    this.frac = 0;
    this.depth = 0;
    this.signal = SIGNAL_ARC[0].signal;
    this.bars = 5;
    this.latency = SIGNAL_ARC[0].latency;
    this.count = 0; // transmissions started this run
    this.deaths = 0;
    this.lastHurtCause = '';
    this.lastHurtAt = -1e9;
    this.lastDeathCause = 'impact';
    this._hurt = false;
    this._nextOk = 0;
    this._lastChatter = -1e9;
    this._depthNext = [];
    this._maxDepth = 0;
    this._progressAt = 0;
    this._stalled = Object.create(null);
    this._gazeT = 0;
    this._skitSeen = false;
    this._restoreLast = '';
    this._lowFirst = true;
    this.skipped = false;
    if (fresh) this.log.length = 0;
  }

  // ---- events --------------------------------------------------------------------------------------------------------------
  onEvent(type, p) {
    const e = p || {};
    switch (type) {
      case 'game:start':
      case 'game:restart':
      case 'game:menu':
        this._cut(false);
        this.reset(false);
        return;
      case 'game:victory':
        this._cut(false);
        this.queue.length = 0;
        return;
      case 'game:pause':
        this._cut(true); // a pause takes the line off air (an early one comes back)
        return;
      case 'section:enter':
        this._enter(e.index | 0, !!e.first);
        return;
      case 'player:death':
        this.deaths++;
        this._cut(false);
        this._dropBelow(3); // the queue keeps only the beats
        return;
      case 'game:respawn':
        this._onRespawn();
        return;
      case 'health:damage':
        this.lastHurtCause = String(e.cause || '');
        this.lastHurtAt = this.clock;
        if (e.lethal) return;
        if (this._hurt) return;
        this._hurt = true;
        break;
      case 'creature:state':
        if (e.skit && !this._skitSeen && (e.to === 'APPROACHING' || e.to === 'PURSUING' || e.to === 'BURST' || e.to === 'ATTACK')) {
          this._skitSeen = true;
          for (const line of this.skitLines) this._trigger(line, 0);
        }
        return;
      case 'objective:done':
      case 'hint':
      case 'checkpoint':
        this._progressAt = this.clock;
        break;
      default:
        break;
    }
    const list = this.byEv[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const { line, w } = list[i];
      if (w.text && !(typeof e.text === 'string' && e.text.toLowerCase().indexOf(w.text) >= 0)) continue;
      if (w.match && !matches(w.match, e)) continue;
      if (line.section >= 0 && line.section !== this.section) continue;
      this._trigger(line, 0);
    }
  }

  _enter(index, first) {
    this.section = index;
    this._progressAt = this.clock;
    // lines tied to another section go stale at once (a warp, a respawn into an earlier section)
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (q.line.section >= 0 && q.line.section !== index) this.queue.splice(i, 1);
    }
    const dl = this.depthBy[index];
    this._depthNext = dl ? dl.slice() : [];
    if (!first) return;
    const list = this.enterBy[index];
    if (list) for (const line of list) this._trigger(line, enterAfter(line));
  }

  _onRespawn() {
    const n = this.deaths;
    if (!reactsToRestore(n)) return;
    const R = this.restoreBy;
    const many = R.many || null;
    let line;
    if (n === 1) line = R.first;
    else {
      const byCause = R[this.lastDeathCause] || R.impact;
      line = n >= 4 && many && this._restoreLast !== many.id ? many : byCause;
      if (line && line.id === this._restoreLast) line = line === many ? byCause : many || line; // never the same reaction twice running
    }
    if (!line) return;
    this._restoreLast = line.id;
    this._trigger(line, 1.6, true);
  }

  /** The cause of the death the restore reacts to: game.js sets it with the killer resolved (skitter / mason). */
  noteDeath(cause) {
    this.lastDeathCause = cause;
  }

  // ---- queue ---------------------------------------------------------------------------------------------------------------
  _trigger(line, delay, force) {
    const said = this.said[line.id];
    if (said !== undefined && !force && !(line.cd > 0 && this.clock - said >= line.cd)) return false;
    for (let i = 0; i < this.queue.length; i++) if (this.queue[i].line === line) return false;
    const lat = SPEAKERS[line.speaker] && SPEAKERS[line.speaker].local ? 0 : line.skip ? 0 : latencyAt(this.section);
    const due = this.clock + (delay || 0) + lat;
    if (this.queue.length >= QUEUE_MAX) {
      // full: the lowest priority, oldest entry makes room (never for a lower priority line)
      let wi = -1;
      for (let i = 0; i < this.queue.length; i++) if (wi < 0 || this.queue[i].prio < this.queue[wi].prio || (this.queue[i].prio === this.queue[wi].prio && this.queue[i].due < this.queue[wi].due)) wi = i;
      if (this.queue[wi].prio > line.prio) return false;
      this.queue.splice(wi, 1);
    }
    this.said[line.id] = this.clock; // a trigger books it (a stale drop still counts: lines are not retried)
    this.queue.push({ line, due, expires: due + line.ttl, prio: line.prio });
    return true;
  }

  _dropBelow(prio) {
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].prio < prio) this.queue.splice(i, 1);
  }

  /** Takes the line off air. requeue: an early cut (< 40 % spoken, priority >= 2) comes back once. */
  _cut(requeue) {
    const c = this.current;
    if (!c) return;
    this.current = null;
    c.cut = true;
    this._nextOk = this.clock + MIN_GAP;
    this._logEnd(c);
    if (this.onEnd) this.onEnd(c);
    if (requeue && c.prio >= 2 && !c.requeued && c.t < c.speak * 0.4) {
      this.queue.push({ line: c.line, due: this.clock + MIN_GAP, expires: this.clock + c.line.ttl, prio: c.prio, requeued: true });
    }
  }

  // ---- per frame -----------------------------------------------------------------------------------------------------------
  /**
   * @param {number} dt seconds
   * @param {{playing:boolean, section:number, depth:number, frac:number, danger:boolean, tense:boolean, skip:boolean, gaze:boolean, bloodOn:boolean}} x
   */
  update(dt, x) {
    const d = dt > 0 ? (dt > 0.25 ? 0.25 : dt) : 0;
    this.clock += d;
    const sec = x.section | 0;
    if (sec !== this.section && sec >= 0) this.section = sec;
    this.depth = x.depth || 0;
    this.frac = x.frac || 0;
    // the signal: the arc, a slow deterministic wander, nothing at the Mark, nothing during a dropout
    let s = signalAt(this.section, this.frac);
    if (s > 0.02) s += 0.025 * vnoise(this.clock * 0.35, this.seed);
    if (this.section >= SIGNAL_ARC.length - 1 && this.depth >= MARK_DEPTH) s = 0;
    s = clamp(s, 0, 1);
    this.signal = s;
    this.latency = latencyAt(this.section);
    const cur = this.current;
    this.bars = cur && glitchOn(cur, 'dropout') ? 0 : barsFor(s);

    if (x.playing) {
      // depth triggers of this section (sorted: only the next one is checked)
      const dn = this._depthNext;
      while (dn.length && this.depth >= depthOf(dn[0])) this._trigger(dn.shift(), 0);
      // progress + the stall hint
      if (this.depth > this._maxDepth + 2) {
        this._maxDepth = this.depth;
        this._progressAt = this.clock;
      }
      if (this.clock - this._progressAt >= STALL_TIME && !this._stalled[this.section]) {
        this._stalled[this.section] = true;
        const sl = this.stallBy[this.section];
        if (sl) for (const line of sl) this._trigger(line, 0);
      }
      // the bare stone: a blood writing looked at for GAZE_TIME s (only while Blood writing is on)
      if (x.bloodOn && x.gaze) {
        this._gazeT += d;
        if (this._gazeT >= GAZE_TIME) {
          this._gazeT = -1e9;
          for (const line of this.gazeLines) this._trigger(line, 0);
        }
      } else if (this._gazeT > 0) this._gazeT = 0;
      // the opening is skippable with the continue input
      if (x.skip) this.skipOpening();
    }

    // the line on air: danger (an attack wind-up, a measure) takes it off; otherwise it runs out
    if (cur) {
      if (x.danger && cur.t < cur.dur - 0.4) this._cut(true);
      else {
        cur.t += d;
        if (cur.t >= cur.dur) this._end(cur);
      }
    }
    if (this.current || !x.playing || x.danger || this.clock < this._nextOk) return;
    this._pick(x);
  }

  _pick(x) {
    const q = this.queue;
    let best = -1;
    for (let i = q.length - 1; i >= 0; i--) {
      const e = q[i];
      if (this.clock > e.expires || (e.line.section >= 0 && e.line.section !== this.section)) {
        q.splice(i, 1); // stale: dropped, never retried
        if (best > i) best--;
        continue;
      }
      if (e.due > this.clock) continue;
      if (e.prio <= 1 && (x.tense || this.clock - this._lastChatter < CHATTER_GAP)) continue;
      if (best < 0 || e.prio > q[best].prio || (e.prio === q[best].prio && e.due <= q[best].due)) best = i; // ties: the earlier queued
    }
    if (best < 0) return;
    const e = q[best];
    q.splice(best, 1);
    this._start(e.line, e.requeued);
  }

  _start(line, requeued) {
    this.count++;
    const speak = speakTime(line.text);
    const g = makeGlitches(this.seed, line, this.section, speak, this.count);
    const text = g.text;
    const sp = SPEAKERS[line.speaker] || SPEAKERS.UPLINK;
    const tx = {
      n: this.count,
      id: line.id,
      line,
      speaker: line.speaker,
      label: sp.label,
      color: sp.color,
      shape: sp.shape,
      text,
      lines: wrapText(text),
      kind: line.kind,
      prio: line.prio,
      section: this.section,
      signal: this.signal,
      speak: text === line.text ? speak : speakTime(text),
      dur: holdTime(text),
      t: 0,
      t0: this.clock,
      glitches: g.events,
      skip: line.skip,
      cut: false,
      requeued: !!requeued,
    };
    this.current = tx;
    this.said[line.id] = this.clock;
    if (line.prio <= 1) this._lastChatter = this.clock;
    if (this.log.length >= LOG_MAX) this.log.shift();
    this.log.push({ n: tx.n, id: tx.id, t0: +this.clock.toFixed(3), t1: -1, section: this.section, glitches: tx.glitches.map((ev) => ev.kind) });
    if (this.onStart) this.onStart(tx);
  }

  _end(tx) {
    this.current = null;
    this._nextOk = this.clock + MIN_GAP;
    this._logEnd(tx);
    if (this.onEnd) this.onEnd(tx);
    const ch = this.chainBy[tx.id];
    if (ch) for (const line of ch) this._trigger(line, chainGap(line, tx.id));
  }

  _logEnd(tx) {
    for (let i = this.log.length - 1; i >= 0; i--) {
      if (this.log[i].n === tx.n) {
        this.log[i].t1 = +this.clock.toFixed(3);
        this.log[i].cut = !!tx.cut;
        break;
      }
    }
  }

  /** The continue input during the opening: the line on air and the rest of the opening go. */
  skipOpening() {
    let any = false;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].line.skip) {
        this.queue.splice(i, 1);
        any = true;
      }
    }
    const c = this.current;
    if (c && c.skip) {
      this._cut(false);
      any = true;
    }
    // the chain stops: the remaining opening lines are booked as said
    if (any) {
      this.skipped = true;
      for (const line of this.script) if (line.skip && this.said[line.id] === undefined) this.said[line.id] = this.clock;
    }
    return any;
  }

  /** Debug / captures: put a line on air now (opts.glitch forces one glitch event of that kind at opts.at s). */
  debugSay(id, opts) {
    const line = this.byId[id];
    if (!line) return null;
    const o = opts || {};
    this._cut(false);
    this.queue.length = 0;
    this._start(line, false);
    const c = this.current;
    if (o.glitch && c) {
      const at = o.at != null ? +o.at : 0.6;
      c.glitches.length = 0;
      c.glitches.push({ kind: o.glitch, t: at, dur: Math.max(MIN_GLITCH, o.dur || 0.6) });
    }
    if (c && o.t != null) c.t = +o.t;
    return c;
  }
}

function depthOf(line) {
  for (const w of line.when) if (w.depth != null) return w.depth;
  return 0;
}
function enterAfter(line) {
  for (const w of line.when) if (w.enter) return w.after || 0;
  return 0;
}
function chainGap(line, from) {
  for (const w of line.when) if (w.chain === from) return w.gap || 0;
  return 0;
}
function matches(m, e) {
  for (const k in m) {
    const want = m[k];
    const v = e[k];
    if (want === false ? !!v : v !== want) return false;
  }
  return true;
}

/** Is a glitch of `kind` (or any, kind omitted) active at the transmission's time? */
export function glitchOn(tx, kind) {
  const g = tx && tx.glitches;
  if (!g) return false;
  for (let i = 0; i < g.length; i++) {
    const e = g[i];
    if ((!kind || e.kind === kind) && tx.t >= e.t && tx.t < e.t + e.dur) return true;
  }
  return false;
}

// ---- the restore ---------------------------------------------------------------------------------------------------------
/** The restore overlay's timeline (s after the death; the continue input skips it from DEATH_PANEL_DELAY on). */
export const RESTORE_TIMING = Object.freeze({ cause: 0.45, progress: 1.25, syncStart: 1.5, syncEnd: 3.7, complete: 3.95, last: 4.45, end: 5.6 });
/** Characters per overlay line (the overlay draws them at a fixed size). */
export const RESTORE_MAX_CHARS = 46;

/** The clinical first line by cause (the death causes are unchanged: impact, fall, hazard, creature, dressed). */
export const RESTORE_CAUSE = Object.freeze({
  impact: 'BLUNT IMPACT',
  fall: 'FREE FALL. NO FLOOR READ',
  hazard: 'PENETRATING TRAUMA. IRONWORK',
  skitter: 'MULTIPLE BITES. SMALL CONTACTS',
  mason: 'LARGE CONTACT. REMAINS NOT FOUND',
  dressed: 'PRECISION CUTS. REMAINS SQUARED',
});

/**
 * The last line, by tier (worse with the restore count and the depth). Tier = min(3, floor((count - 1) / 2)) + the depth band
 * (0 above the Vault, 1 to the Gullet, 2 below). The first restore always repeats the opening: Perennial says "first descent"
 * every time. {d}: this body's depth; {n}: the restore count. Chapter I stays subtle (the serials and the 41 come later).
 */
export const RESTORE_LAST = Object.freeze([
  Object.freeze(['Pattern stable. Welcome back, Elias.', 'Fidelity 99.8%. Highest on record.']),
  Object.freeze(['Previous body left at {d} m. Do not retrieve.', 'Grey patches on both hands. Within tolerance.']),
  Object.freeze(['Fade progression 0.4%. Proceed.', 'Previous body still reading warm. Disregard.']),
  Object.freeze(['Restore count corrected: {n}.', 'Kit serial W-41 verified. First descent.']),
  Object.freeze(['Two patterns on file. Keeping the newer.', 'Previous body: {d} m. It has moved.']),
  Object.freeze(['First descent, Elias. First descent.', 'Do not look for the other bodies, Elias.']),
]);
export const RESTORE_FIRST = 'First descent, Elias. History.';

export function restoreTier(count, section) {
  const band = section >= 5 ? 2 : section >= 3 ? 1 : 0;
  return Math.min(RESTORE_LAST.length - 1, Math.min(3, Math.floor((Math.max(1, count) - 1) / 2)) + band);
}

/** The killer of a 'creature' death: a skitterling bite within the last 2 s, else the Mason. */
export function restoreKiller(cause, lastHurtCause, sinceHurt) {
  if (cause === 'creature') return lastHurtCause === 'skitter' && sinceHurt <= 2 ? 'skitter' : 'mason';
  return RESTORE_CAUSE[cause] ? cause : 'impact';
}

/**
 * The restore sequence of one death (pure, deterministic). o: { cause, killer, count, depth, section, canRespawn, seed,
 * previous } (previous: the last line shown before, never repeated). Returns the plan the overlay draws and game.js times.
 */
export function planRestore(o) {
  const count = Math.max(1, o.count | 0);
  const depth = Math.max(0, Math.round(o.depth || 0));
  const section = o.section | 0;
  const key = o.killer && RESTORE_CAUSE[o.killer] ? o.killer : RESTORE_CAUSE[o.cause] ? o.cause : 'impact';
  let last;
  if (count === 1) last = RESTORE_FIRST;
  else {
    const pool = RESTORE_LAST[restoreTier(count, section)];
    let i = mix((o.seed | 0) >>> 0, count * 31 + section) % pool.length;
    let cand = fill(pool[i], depth, count);
    if (cand === o.previous) {
      i = (i + 1) % pool.length;
      cand = fill(pool[i], depth, count);
    }
    last = cand;
  }
  const T = RESTORE_TIMING;
  const canRespawn = o.canRespawn !== false;
  return {
    active: true,
    count,
    depth,
    section,
    cause: o.cause || 'impact',
    killer: key,
    header: 'CONTINUITY',
    vitals: `VITALS LOST AT ${depth} M`,
    causeLine: RESTORE_CAUSE[key],
    progress: canRespawn ? 'RESTORE IN PROGRESS' : 'NO RELAY ON THIS DESCENT',
    complete: canRespawn ? 'RESTORE COMPLETE' : 'RESTORING AT THE THRESHOLD',
    countLine: `RESTORE ${count}`,
    last,
    canRespawn,
    timing: T,
    end: T.end,
    // a deeper / later restore hesitates at the top of the sync (a pause, never a flash)
    hesitate: restoreTier(count, section) >= 2 ? 0.25 + 0.1 * Math.min(3, restoreTier(count, section) - 2) : 0,
  };
}

function fill(s, d, n) {
  return s.replace('{d}', String(d)).replace('{n}', String(n));
}

/** Sync percent at `t` s into the sequence (0..100, integer, monotone; a later restore pauses just short of the top). */
export function syncAt(plan, t) {
  const T = plan.timing || RESTORE_TIMING;
  if (t <= T.syncStart) return 0;
  const hes = plan.hesitate || 0;
  const u = clamp((t - T.syncStart) / Math.max(0.1, T.syncEnd - T.syncStart - hes), 0, 1);
  let pct = Math.round((u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2) * 100);
  if (hes > 0 && t < T.syncEnd && pct > 97) pct = 97; // holds at 97 % for `hes` s, then completes
  return pct;
}

// ---- the bare stone (Blood writing ON): what the view rests on ---------------------------------------------------------------
/**
 * Is the eye (ex, ey, ez) looking along the unit (fx, fy, fz) at a blood writing of `sectionId` within `maxDist` m and `cosMin`
 * of the view axis? list: LEVEL_DATA_3D.blood entries ({ section, x, y, z }). No allocation.
 */
export function bloodGaze(list, sectionId, ex, ey, ez, fx, fy, fz, maxDist = 7, cosMin = 0.966) {
  if (!list) return false;
  const m2 = maxDist * maxDist;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (sectionId && b.section !== sectionId) continue;
    const dx = b.x - ex;
    const dy = b.y - ey;
    const dz = b.z - ez;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > m2 || d2 < 0.04) continue;
    const c = (dx * fx + dy * fy + dz * fz) / Math.sqrt(d2);
    if (c >= cosMin) return true;
  }
  return false;
}

/** `?comms=off` turns the whole Expedition layer off (radio, subtitles, signal bars, the restore overlay): tests, captures. */
export function commsOffFlag(search) {
  return /[?&]comms=off\b/.test(String(search || ''));
}
