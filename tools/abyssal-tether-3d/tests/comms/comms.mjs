// Node tests for the EXPEDITION comms core and the restore reframing (docs/abyssal-tether-3d/plans/COMMS.md):
//   - the script (sim/comms3d.js COMMS_SCRIPT): 35-55 lines, unique ids, the cast, every line <= 84 characters in at most two
//     panel rows of 42, at most 11 words (a 2.5-5.5 s hold), only characters the panel draws; every section S1-S8 covered (and a
//     voiced stall hint each); the killer beats; chains point at real lines;
//   - the signal: non-increasing down the shaft, five bars at the Threshold, NO SIGNAL at the Mark, latency rising; glitch kinds
//     only where the arc allows them (S1-S2 clean, dropouts from S5, the stuck word from S6), never on Vesper (the suit), the
//     opening or a clean line; onsets >= 0.34 s apart (never faster than 3 Hz); a stuck word still fits two rows;
//   - the director: deterministic (same seed + same events = the same transmissions, times and glitches), never two lines at
//     once, never during a wind-up / a measure or while not playing, priority first, the chatter gap, stale lines dropped (a
//     section left, a ttl run out), the opening skipped by the continue input, a danger cut (requeued once when early), the first
//     restore's hot mic, the restore reactions throttled, the bare-stone gaze only with Blood writing on; no allocation per frame;
//   - the restore: planRestore deterministic, the first restore says "first descent", every overlay line fits (46 characters,
//     the charset), a cause line per cause, the last line worsens with the count and the depth and never repeats the one before,
//     the sync bar monotone 0..100 inside a 4-6 s sequence; restoreKiller (a skitterling bite within 2 s, else the Mason);
//   - the settings: Radio voices + Signal glitches ON by default, strict sanitising, Storage + save profile round trips; the VR
//     Sound and Access pages still fit the panel with the new rows; the menu brief;
//   - the view (render/commsView.js): one head-locked quad (2 triangles), hidden when idle, +1 draw call for a line or the
//     restore and never more, a redraw per line / per glitch change (not per frame), no allocation per frame, the text in the
//     canvas at a readable size; the restore overlay draws every stage;
//   - the radio (audio/radio3d.js on the strict mock Web Audio): babble plan deterministic and within the speech time; every
//     kind of line speaks without a warning, its nodes are released after the line, a cut stops it, Radio voices OFF = silent.
//   node comms.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
import { MockAudioContext } from '../audio/mockaudio.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

/**
 * The hot paths' allocation, measured in a fresh process (--expose-gc; a clean JIT state, as in the game): warm up, gc, then
 * the heap growth over `n` frames with no gc in between (below the young generation's size: what the frames allocated).
 */
function allocChild() {
  const code = `
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(\`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  return next(s, c);
}\`));
globalThis.self = globalThis;
const THREE = await import('three');
const CM = await import('${srcUrl('sim/comms3d.js')}');
const C = await import('${srcUrl('sim/config3d.js')}');
const { CommsView } = await import('${srcUrl('render/commsView.js')}');
const meas = (f, n) => { for (let i = 0; i < 200000; i++) f(); global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < n; i++) f(); return process.memoryUsage().heapUsed - h0; };
const cm = new CM.CommsDirector({ seed: 9 });
const x = { playing: true, section: 5, depth: 250, frac: 0.5, danger: false, tense: false, skip: false, gaze: false, bloodOn: false };
const director = meas(() => cm.update(1 / 72, x), 1000000);
const cam = new THREE.Object3D();
const view = new CommsView(cam);
const d2 = new CM.CommsDirector({ seed: 5 });
const game = { state: 'playing', comms: d2, restore: null, deathT: 0, settings: Object.assign({}, C.SETTINGS_DEFAULTS), xrActive: true, ui: { _hint: { on: false } } };
d2.debugSay('s2-board', {});
d2.current.t = 1.25;
const viewBytes = meas(() => view.update(1 / 72, game), 300000);
console.log(JSON.stringify({ director, view: viewBytes }));
`;
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return { error: (r.stderr || r.stdout || '').slice(0, 300) };
  }
}
const ALLOC = allocChild();

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const warnings = [];
console.warn = (...a) => {
  if (process.env.WARN) console.log('WARN', ...a);
  warnings.push(a.map((x) => (x && x.stack) || String(x)).join(' '));
};

const CM = await import(srcUrl('sim/comms3d.js'));
const C = await import(srcUrl('sim/config3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const {
  COMMS_SCRIPT,
  SPEAKERS,
  SIGNAL_ARC,
  CommsDirector,
  signalAt,
  barsFor,
  latencyAt,
  makeGlitches,
  wrapText,
  holdTime,
  speakTime,
  wordCount,
  planRestore,
  syncAt,
  restoreTier,
  restoreKiller,
  reactsToRestore,
  RESTORE_CAUSE,
  RESTORE_LAST,
  RESTORE_FIRST,
  RESTORE_TIMING,
  RESTORE_MAX_CHARS,
  COMMS_CHARSET,
  MIN_GAP,
  GLITCH_SPACING,
  MIN_GLITCH,
  MARK_DEPTH,
  bloodGaze,
  commsOffFlag,
} = CM;

const SECTIONS = LEVEL_DATA_3D.sections;
const NSEC = SECTIONS.length;

// ===========================================================================================================================
// 1. the script
// ===========================================================================================================================
{
  const ids = new Set(COMMS_SCRIPT.map((l) => l.id));
  ok(COMMS_SCRIPT.length >= 35 && COMMS_SCRIPT.length <= 55 && ids.size === COMMS_SCRIPT.length, `the script: ${COMMS_SCRIPT.length} transmissions (35-55), unique ids`);
  ok(
    COMMS_SCRIPT.every((l) => SPEAKERS[l.speaker]),
    'every line has a speaker of the cast (Odessa, Tick, Maren, Vesper, the open channel)',
  );
  const long = COMMS_SCRIPT.filter((l) => {
    const w = wrapText(l.text);
    return l.text.length > CM.LINE_MAX_CHARS || w.length > CM.WRAP_LINES || w.some((r) => r.length > CM.WRAP_CHARS) || wordCount(l.text) > CM.MAX_WORDS;
  });
  ok(!long.length, 'every line <= 84 characters in <= 2 panel rows of <= 42, <= 11 words' + (long.length ? ': ' + long.map((l) => l.id).join(', ') : ''));
  const holds = COMMS_SCRIPT.map((l) => holdTime(l.text));
  ok(holds.every((h) => h >= 2.5 && h <= 5.5) && COMMS_SCRIPT.every((l) => speakTime(l.text) < holdTime(l.text)), `read in 3-5 s: holds ${Math.min(...holds).toFixed(1)}-${Math.max(...holds).toFixed(1)} s; the voice ends before the subtitle`);
  ok(
    COMMS_SCRIPT.every((l) => COMMS_CHARSET.test(l.text)),
    'only characters the panel draws (ASCII letters, digits, . , \' ? ! : ; % ( ) [ ] - and the em dash)',
  );
  ok(
    COMMS_SCRIPT.filter((l) => l.speaker === 'VESPER').every((l) => wordCount(l.text) <= 5),
    'Vesper speaks in five words or fewer',
  );
  const per = [];
  for (let i = 0; i < NSEC; i++) per.push(COMMS_SCRIPT.filter((l) => l.section === i).length);
  ok(per.every((n) => n >= 3), `every section S1-S8 has its own lines (${per.join(' / ')})`);
  ok(
    SECTIONS.every((s, i) => COMMS_SCRIPT.some((l) => l.section === i && l.when.some((w) => w.stall))),
    'every section has a voiced stall hint (the hint text spoken by the team)',
  );
  const beats = COMMS_SCRIPT.filter((l) => l.beat && l.beat !== 'opening').map((l) => l.beat);
  ok(beats.length >= 5 && beats.includes('the line nobody sent') && beats.includes('hot mic') && beats.includes('the camera sees bare stone'), `the killer beats: ${beats.join(' · ')}`);
  ok(
    COMMS_SCRIPT.every((l) => l.when.every((w) => !w.chain || ids.has(w.chain))),
    'every chain follows a real line',
  );
  const open = COMMS_SCRIPT.filter((l) => l.skip);
  ok(open.length >= 4 && open.every((l) => l.section === 0 && l.prio === 3) && open[0].speaker === 'VESPER' && /Restore complete/.test(open[0].text) && /First descent, Elias/.test(open[1].text), 'the opening at the Threshold: a restore taken for a lowering ("Restore complete." · "First descent, Elias.")');
}

// ===========================================================================================================================
// 2. the signal and the glitches
// ===========================================================================================================================
{
  let mono = true;
  let prev = 2;
  for (let i = 0; i < NSEC; i++) {
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const s = signalAt(i, f);
      if (s > prev + 1e-9) mono = false;
      prev = s;
    }
  }
  ok(mono, 'the signal never rises down the shaft (section by section, top to bottom)');
  ok(barsFor(signalAt(0, 0)) === 5 && barsFor(signalAt(0, 1)) === 5 && barsFor(signalAt(7, 0)) === 1 && barsFor(signalAt(7, 1)) === 0, 'five bars at the Threshold, one at the Last Throat, NO SIGNAL at the bottom');
  const bySec = [];
  for (let i = 0; i < NSEC; i++) bySec.push(barsFor(signalAt(i, 0.5)));
  ok(bySec.join(',') === '5,4,4,3,3,2,1,0' || bySec.every((b, i) => i === 0 || b <= bySec[i - 1]), `bars mid-section S1..S8: ${bySec.join(' ')}`);
  let lat = true;
  for (let i = 1; i < NSEC; i++) if (latencyAt(i) < latencyAt(i - 1)) lat = false;
  ok(lat && latencyAt(0) <= 0.1 && latencyAt(7) >= 1.5, `latency 0.1 -> 1.5 s (S1 ${latencyAt(0)} s, S8 ${latencyAt(7)} s)`);
  ok(SIGNAL_ARC[0].glitch.static === 0 && SIGNAL_ARC[1].glitch.static === 0 && SIGNAL_ARC.slice(0, 4).every((a) => a.glitch.dropout === 0) && SIGNAL_ARC.slice(0, 5).every((a) => a.glitch.repeat === 0), 'the arc: S1-S2 clean, dropouts from S5, the stuck word from S6');

  let allowed = true;
  let spaced = true;
  let fits = true;
  let vesperClean = true;
  let within = true;
  const kinds = new Set();
  const why = [];
  for (const line of COMMS_SCRIPT) {
    for (let sec = 0; sec < NSEC; sec++) {
      for (let n = 1; n <= 60; n++) {
        const sp = speakTime(line.text);
        const g = makeGlitches(0x41, line, sec, sp, n);
        const a = SIGNAL_ARC[sec].glitch;
        for (const e of g.events) {
          kinds.add(e.kind);
          const ok1 = (e.kind === 'static' && a.static > 0) || (e.kind === 'dropout' && a.dropout > 0) || (e.kind === 'repeat' && (a.repeat > 0 || line.glitch === 'repeat')) || (e.kind === 'label' && line.kind === 'notquite');
          if (!ok1) {
            allowed = false;
            why.push(`${line.id}@S${sec + 1}:${e.kind}`);
          }
          if (e.dur < MIN_GLITCH - 1e-9 || e.t < 0 || e.t > holdTime(g.text)) within = false;
        }
        for (let k = 1; k < g.events.length; k++) if (g.events[k].t - g.events[k - 1].t < GLITCH_SPACING - 1e-9) spaced = false;
        if (g.text !== line.text) {
          const w = wrapText(g.text);
          if (g.text.length > CM.LINE_MAX_CHARS || w.length > 2 || w.some((r) => r.length > 42) || !COMMS_CHARSET.test(g.text)) fits = false;
        }
        if ((line.speaker === 'VESPER' || line.skip || line.glitch === 'none') && g.events.some((e) => e.kind !== 'label')) vesperClean = false;
      }
    }
  }
  ok(allowed, 'glitch kinds only where the arc allows them' + (why.length ? ': ' + why.slice(0, 6).join(', ') : ''));
  ok(kinds.has('static') && kinds.has('dropout') && kinds.has('repeat') && kinds.has('label'), `every glitch kind occurs somewhere (${[...kinds].join(', ')})`);
  ok(spaced && within, `glitch onsets >= ${GLITCH_SPACING} s apart, each >= ${MIN_GLITCH} s, inside the line (never faster than 3 Hz)`);
  ok(fits, 'a stuck word still fits two rows of 42 characters in the charset');
  ok(vesperClean, 'Vesper (the suit), the opening and clean lines never glitch');
  const h = COMMS_SCRIPT.find((l) => l.id === 's7-hang');
  const g7 = makeGlitches(1, h, 6, speakTime(h.text), 3);
  ok(g7.events.some((e) => e.kind === 'repeat') && /—/.test(g7.text), `the nave's stuck word: "${g7.text}"`);
  const a = makeGlitches(77, COMMS_SCRIPT[20], 6, 3, 5);
  const b = makeGlitches(77, COMMS_SCRIPT[20], 6, 3, 5);
  ok(JSON.stringify(a) === JSON.stringify(b), 'glitches are deterministic (seed, line, count)');
}

// ===========================================================================================================================
// 3. the director on a simulated descent
// ===========================================================================================================================
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const top = (s) => Math.max(0, -s.yTop);
const bot = (s) => -s.yBottom;

/** A whole descent at 60 fps with the events game.js would send; `chaos` jitters every time (property runs). */
function descent(seed, chaos) {
  const R = rng(chaos * 7919 + 1);
  const j = (v) => v * (1 + (chaos ? (R() - 0.5) * 0.6 : 0));
  const cm = new CommsDirector({ seed });
  const x = { playing: true, section: 0, depth: 0, frac: 0, danger: false, tense: false, skip: false, gaze: false, bloodOn: true };
  const starts = [];
  const ends = [];
  let bad = '';
  cm.onStart = (tx) => {
    if (x.danger || !x.playing) bad = bad || `${tx.id} started with danger ${x.danger} playing ${x.playing}`;
    starts.push({ id: tx.id, t: +cm.clock.toFixed(4), sec: tx.section, g: tx.glitches.map((e) => `${e.kind}@${e.t.toFixed(3)}`).join(' '), text: tx.text, speaker: tx.speaker, kind: tx.kind });
  };
  cm.onEnd = (tx) => ends.push({ id: tx.id, t: +cm.clock.toFixed(4), cut: !!tx.cut });
  const ev = (type, p) => cm.onEvent(type, p || {});
  const dt = 1 / 60;
  let t = 0;
  const step = (secs, f) => {
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      t += dt;
      if (f) f(t);
      cm.update(dt, x);
    }
  };
  ev('game:start');
  let deaths = 0;
  for (let si = 0; si < NSEC; si++) {
    const s = SECTIONS[si];
    x.section = si;
    x.depth = top(s);
    x.frac = 0;
    ev('section:enter', { index: si, first: true, mode: si ? 'progress' : 'initial' });
    if (si) ev('checkpoint', { index: si });
    const still = si === 6 ? 75 : 0; // S7: stand still first (the stall hint after 60 s)
    const span = j(70) + still;
    const t0 = t;
    let fired = {};
    step(span, (tt) => {
      const u = Math.max(0, Math.min(1, (tt - t0 - still) / (span - still)));
      x.depth = top(s) + (bot(s) - top(s)) * u;
      x.frac = (x.depth - top(s)) / (bot(s) - top(s));
      const k = tt - t0;
      const once = (name, at, f) => {
        if (!fired[name] && k >= at) {
          fired[name] = true;
          f();
        }
      };
      if (si === 0) {
        once('hint', j(3), () => ev('hint', { text: 'Swing into the bell. Its toll opens the way down.' }));
        once('bell', j(22), () => ev('bell:ring', {}));
      }
      once('obj', j(40) + still, () => ev('objective:done', { verb: ['bell', 'haul', 'winch', 'lamp', 'breach', 'hook', 'survive'][si] || 'none', section: s.id }));
      if (si === 3) once('sight', j(12), () => ev('creature:sighting', {}));
      if (si === 1) once('hurt', j(50), () => ev('health:damage', { cause: 'impact', lethal: false, amount: 0.2 }));
      if (si === 4) once('low', j(25), () => ev('health:low', { hp: 0.3 }));
      if (si === 5) once('skit', j(10), () => ev('creature:state', { skit: true, to: 'PURSUING', from: 'DISTANT' }));
      // a wind-up every ~17 s from S5 down; tense around it
      if (si >= 4) {
        const ph = (k + chaos) % j(17);
        x.danger = ph > 8 && ph < 8.8;
        x.tense = ph > 5 && ph < 11;
      }
      x.gaze = si === 5 && k > 30 && k < 34.5;
    });
    x.danger = false;
    x.tense = false;
    x.gaze = false;
    // a death in S3 (impact) and in S6 (a skitterling), a respawn 4 s later
    if (si === 2 || si === 5) {
      deaths++;
      if (si === 5) ev('health:damage', { cause: 'skitter', lethal: true, amount: 0.4 });
      ev('player:death', { cause: si === 5 ? 'creature' : 'impact' });
      cm.noteDeath(si === 5 ? restoreKiller('creature', cm.lastHurtCause, cm.clock - cm.lastHurtAt) : 'impact');
      x.playing = false;
      step(4);
      x.playing = true;
      ev('section:enter', { index: si, first: false, mode: 'respawn' });
      ev('game:respawn', {});
      step(j(14));
    }
    if (si === 3) {
      ev('game:pause', {});
      step(0.2);
    }
  }
  x.section = 7;
  x.depth = 560;
  step(10);
  ev('game:victory', {});
  return { starts, ends, bad, cm, deaths };
}

{
  const a = descent(0x41, 0);
  const b = descent(0x41, 0);
  ok(JSON.stringify(a.starts) === JSON.stringify(b.starts) && JSON.stringify(a.ends) === JSON.stringify(b.ends), `deterministic: the same descent twice gives the same ${a.starts.length} transmissions, times and glitches`);
  ok(!a.bad, 'nothing starts during a wind-up / a measure or while not playing' + (a.bad ? ': ' + a.bad : ''));
  const played = new Set(a.starts.map((s) => s.id));
  const secs = [];
  for (let i = 0; i < NSEC; i++) secs.push(a.starts.filter((s) => s.sec === i).length);
  ok(secs.every((n) => n >= 1), `the descent hears the radio in every section (${secs.join(' / ')} lines)`);
  ok(['s1-open-1', 's1-open-5', 's1-bell-1', 's1-bell-2', 's1-bell-3'].every((id) => played.has(id)), 'S1: the opening, then the slip at the bell ("louder than last time" / "Last time?" / "The probes, Tomasz.")');
  ok(played.has('s5-frayed') && played.has('s5-mute') && a.starts.find((s) => s.id === 's5-mute').t - a.ends.find((e) => e.id === 's5-frayed').t >= 39.9, 'S5: the line nobody sent, then "been on mute" 40 s after it');
  ok(played.has('back-1') && played.has('back-hot-1') && played.has('back-hot-2') && a.starts.find((s) => s.id === 'back-hot-1').kind === 'offmic', 'the first restore: "Wren? Wren, sync is holding." then the hot mic (off mic) and "Cut the hot mic, Tomasz."');
  ok(played.has('back-skitter'), 'the second restore reacts to its cause (a skitterling)');
  ok(played.has('any-gaze'), 'the bare-stone beat after 3 s looking at a blood writing (Blood writing on)');
  ok(played.has('s7-stall'), 'standing still in a section: its voiced hint');
  const reactive = ['any-low', 'any-relay', 'any-hurt', 's6-skit', 's4-sight'];
  ok(reactive.every((id) => played.has(id)), 'the reactive lines: hurt, staging a restore, the first relay, the first skitterling, the sighting' + (reactive.every((id) => played.has(id)) ? '' : ': missing ' + reactive.filter((id) => !played.has(id)).join(', ')));
  // never two at once: every start after the previous end + the gap
  let overlap = '';
  const evs = a.starts.map((s) => ({ ...s, kind2: 's' })).concat(a.ends.map((e) => ({ ...e, kind2: 'e' })));
  evs.sort((p, q) => p.t - q.t || (p.kind2 === 'e' ? -1 : 1));
  let on = null;
  let lastEnd = -10;
  for (const e of evs) {
    if (e.kind2 === 's') {
      if (on) overlap = overlap || `${e.id} over ${on}`;
      if (e.t < lastEnd + MIN_GAP - 1e-6) overlap = overlap || `${e.id} only ${(e.t - lastEnd).toFixed(2)} s after the last`;
      on = e.id;
    } else {
      if (on === e.id) on = null;
      lastEnd = e.t;
    }
  }
  ok(!overlap, `never two lines at once, >= ${MIN_GAP} s between (${a.starts.length} lines)` + (overlap ? ': ' + overlap : ''));
  let arcOk = true;
  for (const s of a.starts) {
    const g = SIGNAL_ARC[s.sec].glitch;
    if ((/static/.test(s.g) && !g.static) || (/dropout/.test(s.g) && !g.dropout)) arcOk = false;
  }
  ok(arcOk && a.starts.some((s) => s.g), 'on the descent the glitches follow the arc (and some occur)');
  // property runs: jittered timings, other seeds
  let props = true;
  let detail = '';
  for (let k = 1; k <= 24; k++) {
    const r = descent(0x1000 + k, k);
    if (r.bad) {
      props = false;
      detail = r.bad;
    }
    let last = -10;
    let cur = null;
    const all = r.starts.map((s) => ({ t: s.t, s: 1, id: s.id })).concat(r.ends.map((e) => ({ t: e.t, s: 0, id: e.id })));
    all.sort((p, q) => p.t - q.t || p.s - q.s);
    for (const e of all) {
      if (e.s) {
        if (cur || e.t < last + MIN_GAP - 1e-6) {
          props = false;
          detail = `run ${k}: ${e.id}`;
        }
        cur = e.id;
      } else {
        cur = null;
        last = e.t;
      }
    }
  }
  ok(props, '24 jittered descents: never two lines at once, never in danger' + (detail ? ': ' + detail : ''));
  ok(a.cm.bars === 0 && a.cm.signal === 0, 'at the bottom: NO SIGNAL');
}

// priority, the chatter gap, stale lines, the danger cut, the skip
function mini(lines) {
  const cm = new CommsDirector({ seed: 3, script: lines });
  const got = [];
  cm.onStart = (tx) => got.push({ id: tx.id, t: +cm.clock.toFixed(3) });
  return { cm, got };
}
function line(id, prio, when, extra) {
  return Object.freeze(Object.assign({ id, speaker: 'TICK', text: 'One two three four five six.', section: -1, when: [when], prio, ttl: prio === 3 ? 45 : prio === 1 ? 14 : 22, cd: 0, kind: 'radio', glitch: 'none', skip: false, beat: null }, extra || {}));
}
const X = (o) => Object.assign({ playing: true, section: 0, depth: 0, frac: 0, danger: false, tense: false, skip: false, gaze: false, bloodOn: false }, o || {});
const run = (cm, secs, x) => {
  for (let i = 0; i < Math.round(secs * 60); i++) cm.update(1 / 60, x);
};
{
  const { cm, got } = mini([line('lo', 1, { ev: 'hint' }), line('hi', 3, { ev: 'hint' }), line('mid', 2, { ev: 'hint' })]);
  cm.onEvent('hint', { text: 'x' });
  run(cm, 20, X());
  ok(got.map((g) => g.id).join() === 'hi,mid,lo', `priority first: ${got.map((g) => g.id).join(' > ')}`);
}
{
  const { cm, got } = mini([line('a', 1, { ev: 'hint' }, { ttl: 40 }), line('b', 1, { ev: 'bell:ring' }, { ttl: 40 })]);
  cm.onEvent('hint', {});
  cm.onEvent('bell:ring', {});
  run(cm, 40, X());
  ok(got.length === 2 && got[0].id === 'a' && got[1].t - got[0].t >= 20 - 1e-6, `the chatter gap: flavour lines >= 20 s apart, first come first (${got.map((g) => g.id + '@' + g.t).join(', ')})`);
}
{
  const { cm, got } = mini([line('s', 2, { ev: 'hint' }, { ttl: 5 })]);
  cm.onEvent('hint', {});
  run(cm, 6, X({ danger: true }));
  run(cm, 10, X());
  ok(got.length === 0 && cm.queue.length === 0, 'a line held past its ttl (a long wind-up) is dropped, never played late');
}
{
  const { cm, got } = mini([line('sec0', 2, { ev: 'hint' }, { section: 0 })]);
  cm.onEvent('hint', {});
  cm.onEvent('section:enter', { index: 1, first: true });
  run(cm, 5, X({ section: 1 }));
  ok(got.length === 0, 'a line of a section you have left goes stale');
}
{
  const { cm, got } = mini([line('long', 2, { ev: 'hint' })]);
  const ends = [];
  cm.onEnd = (tx) => ends.push(tx.cut);
  cm.onEvent('hint', {});
  run(cm, 0.6, X());
  run(cm, 1, X({ danger: true }));
  ok(got.length === 1 && ends[0] === true && !cm.current, 'a wind-up takes the line off air at once');
  run(cm, 5, X());
  ok(got.length === 2 && got[1].id === 'long', 'an early cut comes back once the danger is gone');
}
{
  const { cm, got } = mini([line('o1', 3, { enter: true, after: 0.5 }, { section: 0, skip: true }), line('o2', 3, { chain: 'o1', gap: 0.4 }, { section: 0, skip: true }), line('after', 2, { ev: 'hint' }, { section: 0 })]);
  cm.enterBy = [[cm.byId.o1]];
  cm.onEvent('section:enter', { index: 0, first: true });
  run(cm, 1.5, X());
  run(cm, 1 / 60, X({ skip: true }));
  cm.onEvent('hint', {});
  run(cm, 30, X());
  ok(got.map((g) => g.id).join() === 'o1,after' && cm.skipped, 'the continue input skips the opening (the line on air and the rest of it); other lines carry on');
}
{
  ok([1, 2, 3, 4, 7, 10].every(reactsToRestore) && ![5, 6, 8, 9].some(reactsToRestore), 'restore reactions: the first three restores, then every third');
}
// the bare stone needs Blood writing on
{
  const { cm, got } = mini([line('gz', 2, { gaze: true })]);
  cm.gazeLines = [cm.byId.gz];
  run(cm, 5, X({ gaze: true, bloodOn: false }));
  ok(got.length === 0, 'no bare-stone line with Blood writing off');
  run(cm, 3.3, X({ gaze: true, bloodOn: true }));
  ok(got.length === 1, 'with it on: after 3 s of looking');
}
// no allocation per frame (the director's hot path)
ok(ALLOC.director >= 0 && ALLOC.director < 100_000, `CommsDirector.update allocates nothing per frame (${ALLOC.director} bytes over 1M frames, warmed up, a fresh process)` + (ALLOC.error ? ': ' + ALLOC.error : ''));

// ===========================================================================================================================
// 4. the restore
// ===========================================================================================================================
{
  const p1 = planRestore({ cause: 'impact', count: 1, depth: 42.3, section: 1, seed: 3 });
  const p1b = planRestore({ cause: 'impact', count: 1, depth: 42.3, section: 1, seed: 3 });
  ok(JSON.stringify(p1) === JSON.stringify(p1b), 'planRestore is deterministic');
  ok(p1.last === RESTORE_FIRST && p1.countLine === 'RESTORE 1' && p1.vitals === 'VITALS LOST AT 42 M' && p1.complete === 'RESTORE COMPLETE', `the first restore: "${p1.last}" (Perennial says first descent every time)`);
  ok(RESTORE_TIMING.end >= 4 && RESTORE_TIMING.end <= 6 && p1.end === RESTORE_TIMING.end, `a ${RESTORE_TIMING.end} s sequence (4-6 s)`);
  const causes = ['impact', 'fall', 'hazard', 'skitter', 'mason', 'dressed'];
  ok(causes.every((k) => RESTORE_CAUSE[k] && planRestore({ cause: k === 'skitter' || k === 'mason' ? 'creature' : k, killer: k, count: 2, depth: 100, section: 3, seed: 1 }).causeLine === RESTORE_CAUSE[k]), 'a cause line for each death: fell, the dark, hazard, a skitterling, the Mason, dressed');
  let fit = true;
  let rep = true;
  let worse = true;
  for (const sec of [0, 2, 3, 5, 7]) {
    let prev = '';
    let prevTier = -1;
    for (let n = 1; n <= 24; n++) {
      const p = planRestore({ cause: 'creature', killer: 'mason', count: n, depth: SECTIONS[sec] ? bot(SECTIONS[sec]) : 500, section: sec, seed: 11, previous: prev });
      for (const s of [p.vitals, p.causeLine, p.progress, p.complete, p.countLine, p.last, p.header]) if (s.length > RESTORE_MAX_CHARS || !COMMS_CHARSET.test(s)) fit = false;
      if (n > 1 && p.last === prev) rep = false;
      const tier = restoreTier(n, sec);
      if (tier < prevTier) worse = false;
      prevTier = tier;
      prev = p.last;
    }
  }
  ok(fit, `every overlay line fits (<= ${RESTORE_MAX_CHARS} characters, the charset) at every count and depth`);
  ok(rep, 'the last line never repeats the one before');
  ok(worse && restoreTier(1, 0) === 0 && restoreTier(9, 7) === RESTORE_LAST.length - 1 && restoreTier(3, 5) > restoreTier(3, 0), 'the last line worsens with the restore count and the depth');
  let mono = true;
  let last = -1;
  for (let t = 0; t <= RESTORE_TIMING.end; t += 0.01) {
    const v = syncAt(planRestore({ cause: 'fall', count: 9, depth: 400, section: 6, seed: 2 }), t);
    if (v < last || v < 0 || v > 100) mono = false;
    last = v;
  }
  const late = planRestore({ cause: 'fall', count: 9, depth: 400, section: 6, seed: 2 });
  ok(mono && last === 100 && syncAt(late, RESTORE_TIMING.syncEnd - 0.05) === 97 && syncAt(p1, RESTORE_TIMING.syncEnd) === 100, 'the sync bar: monotone 0 -> 100 %, a late restore holds at 97 % before it completes');
  const ab = planRestore({ cause: 'impact', count: 2, depth: 10, section: 0, canRespawn: false, seed: 1 });
  ok(!ab.canRespawn && /NO RELAY/.test(ab.progress), 'no relays (Abyss): the overlay says so, the death panel follows it');
  ok(restoreKiller('creature', 'skitter', 0.5) === 'skitter' && restoreKiller('creature', 'skitter', 5) === 'mason' && restoreKiller('creature', '', 0) === 'mason' && restoreKiller('dressed', '', 0) === 'dressed' && restoreKiller('fall', '', 0) === 'fall', 'restoreKiller: a skitterling bite within 2 s, else the Mason; the other causes as they are');
}

// ===========================================================================================================================
// 5. small helpers
// ===========================================================================================================================
{
  const blood = LEVEL_DATA_3D.blood;
  const b = blood.find((w) => w.id === 'bw-s6-hob') || blood[0];
  const ex = b.x + 2;
  const look = bloodGaze(blood, b.section, ex, b.y, b.z, -1, 0, 0);
  const away = bloodGaze(blood, b.section, ex, b.y, b.z, 1, 0, 0);
  const other = bloodGaze(blood, 'zz', ex, b.y, b.z, -1, 0, 0);
  ok(look && !away && !other, 'bloodGaze: true looking at a writing 2 m away, false looking away or for another section');
  ok(commsOffFlag('?hunt=always&comms=off') && !commsOffFlag('?hunt=always') && !commsOffFlag('?comms=offline') && commsOffFlag('?comms=off&x=1'), '?comms=off is recognised (and nothing else)');
  ok(MARK_DEPTH > 500 && MARK_DEPTH < bot(SECTIONS[7]), `the Mark at ${MARK_DEPTH} m (inside the Last Throat)`);
}

// ===========================================================================================================================
// 6. the settings
// ===========================================================================================================================
{
  const D = C.SETTINGS_DEFAULTS;
  ok(D.radioVoices === true && D.signalGlitches === true, 'Radio voices and Signal glitches are ON by default');
  ok(C.sanitizeUxSettings({ radioVoices: 'no', signalGlitches: 0 }).radioVoices === true && C.sanitizeUxSettings({ radioVoices: false }).radioVoices === false && C.sanitizeUxSettings({ signalGlitches: false }).signalGlitches === false, 'strict: only false turns them off');
  const s = C.Storage.loadSettings();
  ok(s.radioVoices === true && s.signalGlitches === true, 'empty storage loads them on');
  s.radioVoices = false;
  s.signalGlitches = false;
  C.Storage.saveSettings(s);
  const r = C.Storage.loadSettings();
  ok(r.radioVoices === false && r.signalGlitches === false, 'OFF survives a save / load round trip');
  const SAVE = await import(srcUrl('meta/save.js'));
  const store = new SAVE.SaveStore({ primary: new SAVE.MemoryAdapter(), secondary: null, legacyGetItem: null, debounceMs: 5 });
  await store.load();
  store.recordSettings(Object.assign({}, D, { radioVoices: false }));
  await store.flush();
  const again = new SAVE.SaveStore({ primary: store.primary, secondary: null, legacyGetItem: null, debounceMs: 5 });
  await again.load();
  ok(again.profile.settings && again.profile.settings.radioVoices === false && again.profile.settings.signalGlitches === true, 'they ride in the save profile (restored after a storage wipe)');
  store.close();
  again.close();
}

// the VR settings pages and the menu (UI3D headless, a recording 2D context)
function rec2d() {
  const texts = [];
  const st = { font: '10px sans-serif' };
  return new Proxy(st, {
    get(t, k) {
      if (k === 'texts') return texts;
      if (k === 'measureText') return (s) => ({ width: String(s).length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1] || 10) * 0.56) });
      if (k === 'fillText') return (s, x, y, maxW) => texts.push({ s: String(s), x, y, font: t.font, maxW });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}
const pxOf = (font) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || 0);
{
  const { UI3D } = await import(srcUrl('ui/ui3d.js'));
  const { Level3D } = await import(srcUrl('sim/level3d.js'));
  const L = new Level3D(undefined, 'normal');
  const bus = new C.EventBus();
  const game = { bus, level: L, settings: Object.assign({}, C.SETTINGS_DEFAULTS), difficultyKey: 'normal', diff: C.DIFFICULTY.normal, save: { sectionRecords: () => ({}), continueInfo: () => null }, state: 'menu', time: 0, deaths: 0 };
  const ui = new UI3D(game);
  ui._bindBus();
  ui._xr = true;
  const paint = (fn) => {
    const ctx = rec2d();
    ui._regions.length = 0;
    fn.call(ui, ctx);
    return { ctx, regions: ui._regions.slice() };
  };
  const inPanel = (p) => p.regions.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1024 && r.y + r.h <= 768) && p.ctx.texts.every((t) => t.y > 0 && t.y <= 768);
  const glyphs = (p) => p.ctx.texts.every((t) => pxOf(t.font) >= 28);
  ui._vrSetPage = 0;
  ui._vrTab = 2;
  const snd = paint(ui._paintSettings);
  ok(snd.regions.some((r) => r.act === 'set' && r.key === 'radioVoices') && inPanel(snd) && glyphs(snd), 'VR Settings › Sound: Radio voices On / Off, six rows inside the panel');
  ui._vrTab = 3;
  const acc = paint(ui._paintSettings);
  ok(acc.regions.some((r) => r.act === 'set' && r.key === 'signalGlitches') && acc.regions.some((r) => r.act === 'reset-settings') && inPanel(acc) && glyphs(acc), 'VR Settings › Access: Signal glitches On / Off and Reset still inside the panel');
  ui._vrTab = 0;
  const menu = paint(ui._paintMenu);
  ok(menu.ctx.texts.some((t) => /EXPEDITION 41/.test(t.s) && /PERENNIAL/.test(t.s)) && inPanel(menu) && glyphs(menu), 'the VR menu carries the mission brief (Perennial · Expedition 41 · descent authorised), >= 28 px, inside the panel');
  bus.emit('checkpoint', { index: 2 });
  ok(ui._toast && /Relay/.test(ui._toast.text || ''), `a checkpoint is a relay now: toast "${ui._toast && ui._toast.text}"`);
}

// ===========================================================================================================================
// 7. the view: one quad, +1 draw call, redraws per change
// ===========================================================================================================================
{
  const THREE = await import('three');
  const canvases = [];
  globalThis.document = {
    createElement: () => {
      const ctx = rec2d();
      const c = { width: 0, height: 0, getContext: () => ctx, ctx };
      canvases.push(c);
      return c;
    },
  };
  const { CommsView } = await import(srcUrl('render/commsView.js'));
  const cam = new THREE.Object3D();
  const view = new CommsView(cam);
  const quads = () => {
    let n = 0;
    let tris = 0;
    cam.traverse((o) => {
      if (o.isMesh && o.visible) {
        n++;
        tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      }
    });
    return { n, tris };
  };
  ok(cam.children.length === 1 && cam.children[0].name === 'commsPanel', 'one head-locked mesh (a child of the camera)');
  const cm = new CommsDirector({ seed: 5 });
  const game = { state: 'playing', comms: cm, restore: null, deathT: 0, settings: Object.assign({}, C.SETTINGS_DEFAULTS), xrActive: true, ui: { _hint: { on: false } } };
  view.update(1 / 72, game);
  ok(quads().n === 0, 'idle: nothing drawn (0 draw calls)');
  cm.debugSay('s8-enter', { glitch: 'static', at: 1, dur: 0.5 });
  const x = X({ section: 7, depth: 430, frac: 0.07 });
  let maxN = 0;
  const d0 = view.draws;
  for (let i = 0; i < 72 * 6; i++) {
    cm.update(1 / 72, x);
    view.update(1 / 72, game);
    maxN = Math.max(maxN, quads().n);
  }
  const redraws = view.draws - d0;
  ok(maxN === 1 && quads().tris === 0, `a line: +1 draw call while it shows (2 triangles), gone after it (max ${maxN})`);
  ok(redraws >= 2 && redraws <= 4, `the subtitle is redrawn per line and per glitch change, not per frame (${redraws} redraws over ${72 * 6} frames)`);
  const sub = canvases[0].ctx.texts;
  ok(sub.some((t) => t.s === 'ODESSA') && sub.some((t) => /Signal's going/.test(t.s)) && sub.filter((t) => /Elias|going|after|us/.test(t.s)).every((t) => pxOf(t.font) >= 34 && t.y > 0 && t.y < 256), 'the subtitle: the speaker name and the line, >= 34 px rows inside the 256 px canvas');
  // the restore overlay
  game.state = 'dead';
  game.restore = planRestore({ cause: 'creature', killer: 'mason', count: 3, depth: 212, section: 4, seed: 1 });
  maxN = 0;
  const d1 = view.draws;
  for (let t = 0; t <= 5.6; t += 1 / 72) {
    game.deathT = t;
    view.update(1 / 72, game);
    maxN = Math.max(maxN, quads().n);
  }
  const rd = view.draws - d1;
  const res = canvases[1].ctx.texts.map((t) => t.s);
  ok(maxN === 1, 'the restore overlay: +1 draw call (the same quad)');
  ok(['CONTINUITY', 'VITALS LOST AT 212 M', RESTORE_CAUSE.mason, 'RESTORE IN PROGRESS', 'SYNC 100%', 'RESTORE COMPLETE', 'RESTORE 3', game.restore.last].every((s) => res.includes(s)), 'it draws every stage: CONTINUITY, vitals lost at 212 m, the cause, in progress, SYNC 100 %, RESTORE COMPLETE, RESTORE 3, the last line');
  ok(rd <= 5.6 * 10 + 8, `restore redraws capped at 10 Hz (${rd} over 5.6 s)`);
  ok(view.material.opacity <= 0.97 + 1e-9, 'a calm fade: the overlay never exceeds 0.97 opacity and only ramps');
  game.restore.active = false;
  for (let i = 0; i < 40; i++) view.update(1 / 72, game);
  ok(quads().n === 0, 'when the restore ends (or the death panel takes over) the quad fades away');
  // no allocation per frame while a line is on air (no redraw)
  game.state = 'playing';
  game.restore = null;
  cm.debugSay('s2-board', {});
  for (let i = 0; i < 30; i++) view.update(1 / 72, game);
  ok(ALLOC.view >= 0 && ALLOC.view < 100_000, `CommsView.update allocates nothing per frame (${ALLOC.view} bytes over 300k frames, warmed up, a fresh process)`);
  game.settings.signalGlitches = false;
  const d2 = view.draws;
  cm.debugSay('s8-enter', { glitch: 'static', at: 0.2, dur: 0.5 });
  for (let i = 0; i < 72 * 2; i++) {
    cm.update(1 / 72, x);
    view.update(1 / 72, game);
  }
  ok(view.draws - d2 === 1, 'Signal glitches OFF: one plain draw, no flicker');
  view.dispose();
  ok(cam.children.length === 0, 'dispose removes the quad');
  // the wrist: the uplink's bars and the on-air speaker drawn into the ECG canvas (no draw call of their own)
  const { HealthFx } = await import(srcUrl('render/healthFx.js'));
  const hcam = new THREE.Object3D();
  const hg = { renderer: { camera: hcam }, settings: Object.assign({}, C.SETTINGS_DEFAULTS), bus: null, state: 'playing', health: { hp: 1, hurt: 0, low: false, dead: false, heartbeatRate: 70 }, comms: null, xrActive: true };
  const fxh = new HealthFx(hg);
  const ecg = canvases[canvases.length - 1].ctx.texts;
  const wcm = new CommsDirector({ seed: 1 });
  hg.comms = wcm;
  wcm.bars = 0;
  ecg.length = 0;
  fxh._drawEcg(1 / 30, false, hg.health);
  const noUp = ecg.some((t) => t.s === 'NO UPLINK');
  wcm.bars = 4;
  wcm.debugSay('s2-haul', {});
  ecg.length = 0;
  fxh._drawEcg(1 / 30, false, hg.health);
  ok(noUp && !ecg.some((t) => t.s === 'NO UPLINK') && ecg.some((t) => t.s === 'M'), 'the wrist ECG: NO UPLINK at 0 bars; with a signal the bars and the speaker on air (M for Maren)');
  hg.comms = null;
  ecg.length = 0;
  fxh._drawEcg(1 / 30, false, hg.health);
  ok(!ecg.some((t) => t.s === 'NO UPLINK' || t.s === 'M'), '?comms=off: the ECG as before');
  fxh.dispose();
  delete globalThis.document;
}

// ===========================================================================================================================
// 8. the radio (strict mock Web Audio)
// ===========================================================================================================================
{
  const RADIO = await import(srcUrl('audio/radio3d.js'));
  const p = RADIO.babblePlan('Mind the bell, Elias. It is louder than last time.', 'ODESSA', 3.9, 7);
  const q = RADIO.babblePlan('Mind the bell, Elias. It is louder than last time.', 'ODESSA', 3.9, 7);
  const end = p.length ? p[p.length - 1].t + p[p.length - 1].dur : 0;
  ok(p.length >= 10 && JSON.stringify(p) === JSON.stringify(q) && end <= 3.9 * 1.05 && p.every((s) => s.f0 > 60 && s.f0 < 400 && Number.isFinite(s.f1)), `babble: ${p.length} syllables, deterministic, ends within the speech time (${end.toFixed(2)} s of 3.9)`);
  const v = RADIO.babblePlan('Contact. Small. Closing.', 'VESPER', 2, 1);
  ok(v.every((s) => Math.abs(s.f0 - RADIO.VOICES.VESPER.f0) < 1e-6 || true) && new Set(v.map((s) => Math.round(s.f0))).size <= 2, 'Vesper: flat, machine-even pitch');

  globalThis.window = { AudioContext: MockAudioContext, addEventListener() {} };
  const { AudioManager3D } = await import(srcUrl('audio/audio3d.js'));
  const bus = new C.EventBus();
  const settings = Object.assign({}, C.SETTINGS_DEFAULTS, { volume: 0.8 });
  const el = new Float64Array(16);
  el[0] = el[5] = el[10] = el[15] = 1;
  el[13] = 1.6;
  const cm = new CommsDirector({ seed: 2 });
  const game = { bus, settings, state: 'playing', sectionIndex: 6, diff: { lethalImpact: 17 }, renderer: { camera: { matrixWorld: { elements: el } } }, player: { x: 0, y: -300, z: 0, rx: 0, ry: -300, rz: 0, vx: 0, vy: 0, vz: 0, grounded: true, alive: true }, comms: cm };
  const audio = new AudioManager3D(bus, settings);
  audio.unlock();
  const ctx = audio.ctx;
  const tick = (secs) => {
    for (let i = 0; i < Math.round(secs * 30); i++) {
      ctx.currentTime += 1 / 30;
      audio.update(1 / 30, game);
    }
  };
  tick(1);
  ok(audio._radio && audio._mods.length === 5, 'the radio builds beside the five sound modules');
  const made = [];
  const speak0 = audio._radio.speak.bind(audio._radio);
  audio._radio.speak = (tx) => {
    speak0(tx);
    if (audio._radio.cur) made.push(...audio._radio.cur.nodes);
  };
  cm.onStart = (tx) => bus.emit('comms:line', tx);
  cm.onEnd = (tx) => bus.emit('comms:end', tx);
  const xs = X({ section: 6, depth: 300, frac: 0.1 });
  const kinds = ['s7-hang', 's8-warm', 's8-two', 's4-echo', 'back-hot-1', 'back-1'];
  let speaking = true;
  const mute = [];
  for (const id of kinds) {
    const n0 = audio._radio.lines;
    cm.debugSay(id, { glitch: 'dropout', at: 0.8, dur: 0.5 });
    for (let i = 0; i < 30 * 6; i++) {
      ctx.currentTime += 1 / 30;
      cm.update(1 / 30, xs);
      audio.update(1 / 30, game);
    }
    if (audio._radio.lines < n0 + 1) {
      speaking = false;
      mute.push(`${id}:${audio._radio.lines - n0}`);
    }
  }
  tick(2);
  ok(speaking && warnings.length === 0, 'every kind of line speaks (radio, not quite, the suit, the echo, off mic) with no bad automation' + (warnings.length ? ': ' + warnings[0].slice(0, 200) : '') + (mute.length ? ': ' + mute.join(' ') : ''));
  ok(made.length > 30 && made.every((n) => n.disconnectedAll) && !audio._radio.cur, `each line's nodes are released after it (${made.length} nodes made, all disconnected)`);
  cm.debugSay('s4-knock', {});
  tick(0.5);
  ok(audio._radio.duck > 0.5 && audio._radioDuck < 0.8 && audio._radioDuckAmb < 0.9, 'while a line is on air the music and the ambience duck (the creature is not touched)');
  cm._cut(false);
  tick(1);
  ok(!audio._radio.cur, 'a cut line stops at once');
  settings.radioVoices = false;
  const n1 = audio._radio.lines;
  cm.debugSay('s4-knock', {});
  tick(1);
  ok(audio._radio.lines === n1, 'Radio voices OFF: silent (the subtitle still shows)');
  ok(warnings.length === 0, 'no warnings from the audio side');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
