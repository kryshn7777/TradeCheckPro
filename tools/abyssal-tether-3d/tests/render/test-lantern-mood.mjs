// The living flame (render/lanternMood.js, settings.livingFlame): the lantern's light reads the danger. Threat dims it and shifts it
// blue-white monotonically; a refuge is perfectly still; a fall gutters it warmer; a squall leans and dims it; a Mason burst shudders it;
// every oscillation <= 12 Hz and the outputs are slew-limited (never a strobe); reducedEffects halves it; the setting off is the
// identity; deterministic; no allocation per call.
//   node test-lantern-mood.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const M = await import(srcUrl('render/lanternMood.js'));
const { SETTINGS_DEFAULTS, sanitizeUxSettings } = await import(srcUrl('sim/config3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 240;
const base = { speed: 0, threat: 0, burst: false, refuge: false, squall: 0, reduced: false, enabled: true };
const inp = (o) => Object.assign({}, base, o);
/** Runs `secs` with the inputs `o`, returns the trace and the final state. */
function run(o, secs, dt = DT, m = M.createLanternMood()) {
  const I = inp(o);
  const tr = { i: [], h: [], s: [], x: [], y: [] };
  for (let n = Math.round(secs / dt), k = 0; k < n; k++) {
    M.lanternMood(dt, I, m);
    tr.i.push(m.intensityMul);
    tr.h.push(m.hueShift);
    tr.s.push(m.scale);
    tr.x.push(m.jx);
    tr.y.push(m.jy);
  }
  return { tr, m };
}
const mean = (a, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i];
  return s / (a.length - from);
};
const settled = (o) => {
  const { tr } = run(o, 12);
  const from = Math.round(8 / DT);
  return { i: mean(tr.i, from), h: mean(tr.h, from), s: mean(tr.s, from) };
};

// identity when calm
{
  const c = settled({});
  ok(Math.abs(c.i - 1) < 1e-9 && Math.abs(c.h) < 1e-9 && Math.abs(c.s - 1) < 1e-9, 'calm: identity (intensity 1, no hue shift, scale 1)');
}

// monotonic dimming + blue shift with the threat
{
  let prev = null;
  let mono = true;
  const rows = [];
  for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const c = settled({ threat: t });
    rows.push(`${t}: x${c.i.toFixed(3)} hue ${c.h.toFixed(3)} scale ${c.s.toFixed(3)}`);
    if (prev && !(c.i < prev.i && c.h < prev.h && c.s < prev.s)) mono = false;
    prev = c;
  }
  ok(mono, `threat dims, shrinks and blue-shifts the flame monotonically (${rows.join('; ')})`);
  ok(prev.i < 0.7 && prev.h < -0.5, `at full threat it is clearly dimmer (x${prev.i.toFixed(2)}) and blue-white (hue ${prev.h.toFixed(2)})`);
}

// fast fall gutters warm; squall dims and leans; burst shudders
{
  const f = settled({ speed: 30 });
  ok(f.i < 0.85 && f.h > 0.3, `a fast fall gutters: dimmer (x${f.i.toFixed(2)}) and warmer (hue +${f.h.toFixed(2)})`);
  const slow = settled({ speed: 5 });
  ok(Math.abs(slow.i - 1) < 1e-9, 'a slow drop (5 m/s) leaves the flame alone');
  const { tr } = run({ squall: 1 }, 6);
  const from = Math.round(3 / DT);
  ok(mean(tr.i, from) < 0.85 && mean(tr.x, from) > 0.012, `a squall dims (x${mean(tr.i, from).toFixed(2)}) and leans the flame (${(mean(tr.x, from) * 100).toFixed(1)} cm)`);
  const b = run({ burst: true }, 3).tr;
  let lo = Infinity;
  let hi = -Infinity;
  let xs = 0;
  for (let i = Math.round(1 / DT); i < b.i.length; i++) {
    lo = Math.min(lo, b.i[i]);
    hi = Math.max(hi, b.i[i]);
    xs = Math.max(xs, Math.abs(b.x[i]));
  }
  ok(hi - lo > 0.08 && xs > 0.008, `a Mason burst shudders: intensity swing ${(hi - lo).toFixed(3)}, shake ${(xs * 100).toFixed(1)} cm`);
  const nb = run({ threat: 0.7 }, 12).tr;
  let nlo = Infinity;
  let nhi = -Infinity;
  for (let i = Math.round(9 / DT); i < nb.i.length; i++) {
    nlo = Math.min(nlo, nb.i[i]);
    nhi = Math.max(nhi, nb.i[i]);
  }
  ok(nhi - nlo < 0.01, `an honest tell: no shudder without a burst (threat 0.7 alone swings ${(nhi - nlo).toFixed(4)})`);
}

// refuge: perfectly still and steady, whatever else is going on
{
  const { tr, m } = run({ refuge: true, threat: 1, burst: true, squall: 1, speed: 30 }, 10);
  const from = Math.round(6 / DT);
  let dev = 0;
  for (let i = from; i < tr.i.length; i++) dev = Math.max(dev, Math.abs(tr.i[i] - 1), Math.abs(tr.h[i]), Math.abs(tr.s[i] - 1), Math.abs(tr.x[i]), Math.abs(tr.y[i]));
  ok(dev < 1e-3 && m.still > 0.999, `in a Masons' rest the flame is still and steady (max deviation ${dev.toExponential(1)}, still ${m.still.toFixed(4)})`);
}

// bounded rate of change + no oscillation above 12 Hz (worst case: everything at once)
{
  const o = { threat: 0.8, burst: true, squall: 1, speed: 30 };
  const { tr } = run(o, 10);
  let maxRate = 0;
  for (let i = 1; i < tr.i.length; i++) maxRate = Math.max(maxRate, Math.abs(tr.i[i] - tr.i[i - 1]) / DT);
  ok(maxRate <= M.RATE.intensity + 1e-6, `intensity slew <= ${M.RATE.intensity}/s (${maxRate.toFixed(2)}/s)`);
  // dominant frequency: count local extrema of each output over the settled window (2 per cycle)
  const hz = (a) => {
    let n = 0;
    const from = Math.round(2 / DT);
    for (let i = from + 1; i < a.length - 1; i++) if ((a[i] - a[i - 1]) * (a[i + 1] - a[i]) < 0) n++;
    return n / 2 / ((a.length - from) * DT);
  };
  const f = [hz(tr.i), hz(tr.s), hz(tr.x), hz(tr.y)];
  ok(Math.max(...f) <= M.MAX_HZ, `no oscillation above ${M.MAX_HZ} Hz (intensity ${f[0].toFixed(1)}, scale ${f[1].toFixed(1)}, x ${f[2].toFixed(1)}, y ${f[3].toFixed(1)} Hz)`);
  // a single frame at 10 Hz (a hitch) never jumps more than the slew limit
  const m = M.createLanternMood();
  M.lanternMood(0.1, inp({ threat: 1, burst: true }), m);
  ok(1 - m.intensityMul <= M.RATE.intensity * 0.1 + 1e-9, `a 100 ms hitch with a full threat moves the intensity by <= ${(M.RATE.intensity * 0.1).toFixed(2)} (${(1 - m.intensityMul).toFixed(3)})`);
  // abrupt input step (a burst starting): the envelope eases in, no frame-to-frame jump
  const s = M.createLanternMood();
  run({}, 1, DT, s);
  let jump = 0;
  let prev = s.intensityMul;
  const I = inp({ burst: true, threat: 1 });
  for (let k = 0; k < 240; k++) {
    M.lanternMood(DT, I, s);
    jump = Math.max(jump, Math.abs(s.intensityMul - prev));
    prev = s.intensityMul;
  }
  ok(jump <= M.RATE.intensity * DT + 1e-9, `a burst starting eases in (max step ${jump.toFixed(4)} per 1/240 s)`);
}

// reducedEffects halves the effect exactly
{
  const o = { threat: 0.8, burst: true, squall: 0.7, speed: 20 };
  const a = run(o, 5).tr;
  const b = run(Object.assign({ reduced: true }, o), 5).tr;
  let err = 0;
  let any = 0;
  for (let i = 0; i < a.i.length; i++) {
    err = Math.max(err, Math.abs((b.i[i] - 1) - 0.5 * (a.i[i] - 1)), Math.abs(b.h[i] - 0.5 * a.h[i]), Math.abs((b.s[i] - 1) - 0.5 * (a.s[i] - 1)), Math.abs(b.x[i] - 0.5 * a.x[i]));
    any = Math.max(any, Math.abs(a.i[i] - 1));
  }
  ok(err < 1e-12 && any > 0.2, `reducedEffects halves every output (error ${err.toExponential(1)})`);
}

// setting off = identity (and turning it back on eases in)
{
  const m = M.createLanternMood();
  run({ threat: 1, burst: true, squall: 1, speed: 30 }, 2, DT, m);
  M.lanternMood(DT, inp({ threat: 1, burst: true, squall: 1, speed: 30, enabled: false }), m);
  ok(m.intensityMul === 1 && m.hueShift === 0 && m.scale === 1 && m.jx === 0 && m.jy === 0 && m.still === 0 && m.jitter === 0, 'livingFlame off: the identity, at once');
  M.lanternMood(DT, inp({ threat: 1, burst: true }), m);
  ok(1 - m.intensityMul < 0.03, `switched back on it eases in from calm (x${m.intensityMul.toFixed(4)} after one frame)`);
  ok(SETTINGS_DEFAULTS.livingFlame === true, 'settings: livingFlame defaults to on');
  const s = { livingFlame: 'no' };
  sanitizeUxSettings(s);
  const s2 = { livingFlame: false };
  sanitizeUxSettings(s2);
  ok(s.livingFlame === true && s2.livingFlame === false, 'settings: livingFlame sanitised (on unless explicitly false)');
}

// determinism (same inputs, same outputs, bit for bit), and garbage inputs stay finite
{
  const o = { threat: 0.6, burst: true, squall: 0.5, speed: 18 };
  const a = run(o, 4).tr;
  const b = run(o, 4).tr;
  ok(a.i.every((v, i) => v === b.i[i]) && a.x.every((v, i) => v === b.x[i]) && a.h.every((v, i) => v === b.h[i]), 'deterministic: two runs are bit-identical');
  const m = M.createLanternMood();
  M.lanternMood(NaN, inp({ threat: NaN, speed: Infinity, squall: -3 }), m);
  M.lanternMood(1 / 72, { threat: 'x' }, m);
  ok([m.intensityMul, m.hueShift, m.scale, m.jx, m.jy, m.jitter].every(Number.isFinite), 'garbage inputs keep every output finite');
}

// lanternMoodInputs: reads the live game without allocating; BURST / ATTACK only; refuge 1 only (the lure niche is not safe)
{
  const game = { state: 'playing', player: { alive: true, vy: -20 }, threat: { value: 0.4 }, creature: { state: 'PURSUING', refuge: 0 }, objectives: { squallNow: { k: 0.5, rise: 0 } }, settings: { reducedEffects: true } };
  const I = M.lanternMoodInputs(game, null);
  ok(I.speed === 20 && I.threat === 0.4 && I.burst === false && I.refuge === false && I.squall === 0.5 && I.reduced === true && I.enabled === true, 'inputs: fall speed, threat, squall, reducedEffects read off the game');
  game.creature.state = 'ATTACK';
  game.creature.refuge = 2;
  const J = M.lanternMoodInputs(game, I);
  ok(J === I && I.burst === true && I.refuge === false, 'inputs: ATTACK is a burst; the lure niche (refuge 2) is not a rest; the object is reused');
  game.creature.refuge = 1;
  game.settings.livingFlame = false;
  M.lanternMoodInputs(game, I);
  ok(I.refuge === true && I.enabled === false, 'inputs: a Masons\' rest (refuge 1); livingFlame off');
  M.lanternMoodInputs({ state: 'menu', player: { alive: true, vy: -30 }, threat: { value: 1 } }, I);
  ok(I.speed === 0 && I.threat === 0, 'inputs: nothing outside play');
}

// applyLanternHue
{
  const c = { r: 1, g: 0.7, b: 0.4 };
  M.applyLanternHue(c, -1);
  ok(c.b > c.r * 0.95, 'hue -1: blue-white');
  const w = { r: 1, g: 0.7, b: 0.4 };
  M.applyLanternHue(w, 1);
  ok(w.g < 0.55 && w.b < 0.3, 'hue +1: deep warm');
}

console.log(fails ? `${fails} FAILED` : 'lantern mood: all pass');
process.exitCode = fails ? 1 : 0;
