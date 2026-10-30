// Node tests for the radio voice clips (docs/abyssal-tether-3d/plans/VO_SCRIPT.md; tools/abyssal-tether-3d/build_voices.py):
//   - the manifest vs the script: every voiced line of COMMS_SCRIPT has a clip (the file exists, Ogg Opus mono 24 kHz, a sane
//     duration within the line's max_s, one ascending word timing per subtitle word inside the clip) or a documented fallback;
//     no clip for a line that is not in the script; the script text hash matches; lines.csv + VO_SCRIPT.md in sync
//     (export-lines.mjs --check) and the 11 specified story-bible lines listed as 'spec';
//   - the size budget: all clips <= 2.5 MB, each <= 48 KB, the manifest <= 32 KB; the folder in the lazy precache tier;
//   - the disclosure: an AI clip -> the manifest names the engine, licence and disclosure; the About credits (DOM + VR) say so;
//   - the director: with the voice hook a line is timed by its clip (speak = the clip, the subtitle holds the squelch + the clip +
//     the tail and ends then), the stuck word stutters inside the clip (+2 repeats), the not-quite voice is slower; no hook, a
//     bad hook or a bad entry = the text timing exactly as before; deterministic;
//   - the player (audio/radio3d.js on the strict mock Web Audio): a decoded clip plays as buffer sources through the chain and
//     no babble oscillator; the stuck word = three sources; the not-quite voice = two sources at 0.94 / 0.94 x 1.012; no clip, a
//     failed load or not decoded yet = the babble; Radio voices OFF = silent and no clip offered; ?comms=off = nothing fetched;
//   - the bank: nothing fetched before the radio is built, the manifest first, then the wanted section's lines, the next, then
//     the anywhere lines, <= 2 at once, the LRU within VOICE_CACHE_S (never the clip on air);
//   - no allocation per frame (a fresh process, --expose-gc): CommsDirector.update and Radio.control with a clip on air.
//   node voice.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { srcUrl, GAME_ROOT, REPO_ROOT, TOOLS_DIR } from '../../verify/root.mjs';
import { MockAudioContext } from '../audio/mockaudio.mjs';

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const warnings = [];
console.warn = (...a) => warnings.push(a.map((x) => (x && x.stack) || String(x)).join(' '));

const VOICE = path.join(GAME_ROOT, 'assets/audio/voice');
const MOCK_URL = pathToFileURL(path.join(TOOLS_DIR, 'tests/audio/mockaudio.mjs')).href;
const CM = await import(srcUrl('sim/comms3d.js'));
const C = await import(srcUrl('sim/config3d.js'));
const { COMMS_SCRIPT, CommsDirector, holdTime, speakTime, voiceHold, voiceStuck, VOICE_LEAD, VOICE_TAIL, NOTQUITE_RATE, STUCK_MAX } = CM;
const manifest = JSON.parse(fs.readFileSync(path.join(VOICE, 'manifest.json'), 'utf8'));
const L = manifest.lines;
const fnv = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
};
const words = (t) => t.split(' ').filter(Boolean);
const csvRows = (() => {
  const txt = fs.readFileSync(path.join(TOOLS_DIR, 'voice/lines.csv'), 'utf8');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"' && txt[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else cell += c;
  }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
})();
const byCsv = Object.fromEntries(csvRows.map((r) => [r.id, r]));

// ===========================================================================================================================
// 1. the manifest vs the script, the files, the budget
// ===========================================================================================================================
{
  const ids = new Set(COMMS_SCRIPT.map((l) => l.id));
  const missing = COMMS_SCRIPT.filter((l) => !L[l.id] && !(manifest.fallback && typeof manifest.fallback[l.id] === 'string' && manifest.fallback[l.id].length > 10)).map((l) => l.id);
  ok(!missing.length, `every script line has a clip or a documented fallback (${Object.keys(L).length} clips, ${Object.keys(manifest.fallback || {}).length} fallback: ${Object.keys(manifest.fallback || {}).join(', ')})` + (missing.length ? ': missing ' + missing.join(', ') : ''));
  const strays = Object.keys(L).filter((id) => !ids.has(id));
  ok(!strays.length, 'no clip for a line that is not in the script' + (strays.length ? ': ' + strays.join(', ') : ''));
  const voiced = COMMS_SCRIPT.filter((l) => l.speaker !== 'UPLINK' && l.kind !== 'echo');
  ok(voiced.every((l) => L[l.id]), `every spoken line (${voiced.length}: Odessa, Tick, Maren, Vesper) has a clip; only the UPLINK echo falls back`);
  const stale = COMMS_SCRIPT.filter((l) => L[l.id] && L[l.id].h !== fnv(l.text)).map((l) => l.id);
  ok(!stale.length, 'every clip was made from the current script text (text hash)' + (stale.length ? ': stale ' + stale.join(', ') + ' (re-run build_voices.py)' : ''));

  const bad = [];
  let total = 0;
  for (const [id, e] of Object.entries(L)) {
    const p = path.join(VOICE, e.f);
    if (!fs.existsSync(p)) {
      bad.push(`${id}: no file`);
      continue;
    }
    const b = fs.readFileSync(p);
    total += b.length;
    const oh = b.indexOf('OpusHead');
    if (b.subarray(0, 4).toString() !== 'OggS' || oh < 0 || oh > 64) bad.push(`${id}: not Ogg Opus`);
    else if (b[oh + 9] !== 1 || b.readUInt32LE(oh + 12) !== 24000) bad.push(`${id}: not mono 24 kHz`);
    if (e.bytes !== b.length) bad.push(`${id}: manifest bytes ${e.bytes} != ${b.length}`);
    if (!/^(odessa|tick|maren|vesper|elias)\/[a-z0-9-]+\.ogg$/.test(e.f) || !e.f.endsWith(`/${id}.ogg`)) bad.push(`${id}: path ${e.f}`);
    const line = COMMS_SCRIPT.find((l) => l.id === id);
    if (line && e.f.split('/')[0] !== line.speaker.toLowerCase()) bad.push(`${id}: speaker folder`);
    if (!(e.d > 0.3 && e.d <= 6.5)) bad.push(`${id}: duration ${e.d}`);
    const max = byCsv[id] ? +byCsv[id].max_s : 6;
    if (e.d > max + 0.15) bad.push(`${id}: ${e.d} s > max ${max} s`);
    if (line) {
      const n = words(line.text).length;
      const w = e.w || [];
      if (w.length !== n) bad.push(`${id}: ${w.length} word timings for ${n} words`);
      for (let i = 0; i < w.length; i++) if (!(w[i][0] >= 0 && w[i][1] >= w[i][0] && w[i][1] <= e.d + 0.05 && (i === 0 || w[i][0] >= w[i - 1][0]))) bad.push(`${id}: word ${i} [${w[i]}]`);
    }
    if (!['ai', 'human'].includes(e.src)) bad.push(`${id}: src ${e.src}`);
  }
  ok(!bad.length, `every clip: Ogg Opus mono 24 kHz, in its speaker's folder, 0.3-6.5 s within its max_s, one ascending word timing per subtitle word` + (bad.length ? ': ' + bad.slice(0, 6).join('; ') : ''));
  const big = Object.entries(L).filter(([, e]) => e.bytes > 48 * 1024);
  ok(total <= 2_500_000 && total === manifest.bytes && !big.length, `size budget: ${(total / 1024).toFixed(0)} KB of 2441 KB for ${Object.keys(L).length} clips, each <= 48 KB`);
  const mb = fs.statSync(path.join(VOICE, 'manifest.json')).size;
  ok(mb <= 32 * 1024, `the manifest is tiny (${(mb / 1024).toFixed(1)} KB)`);
  const onDisk = [];
  for (const d of fs.readdirSync(VOICE)) if (fs.statSync(path.join(VOICE, d)).isDirectory()) for (const f of fs.readdirSync(path.join(VOICE, d))) onDisk.push(`${d}/${f}`);
  const orphan = onDisk.filter((f) => !Object.values(L).some((e) => e.f === f));
  ok(!orphan.length, 'no orphan file in the voice folder' + (orphan.length ? ': ' + orphan.join(', ') : ''));
  const anyAi = Object.values(L).some((e) => e.src === 'ai');
  ok(!anyAi || (manifest.engine && /Kokoro/.test(manifest.engine.name) && /Apache-2\.0/.test(manifest.engine.licence) && /AI/.test(manifest.disclosure)), `AI clips are disclosed in the manifest (${manifest.engine ? manifest.engine.name + ', ' + manifest.engine.licence.split(' ')[0] : 'no AI clips'})`);

  const r = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'voice/export-lines.mjs'), '--check'], { encoding: 'utf8' });
  ok(r.status === 0, 'lines.csv and VO_SCRIPT.md are in sync with comms3d.js (export-lines.mjs --check)' + (r.status ? ': ' + (r.stderr || r.stdout).trim().slice(0, 200) : ''));
  const live = csvRows.filter((x) => x.status === 'live' || x.status === 'no-vo');
  const spec = csvRows.filter((x) => x.status === 'spec');
  ok(live.length === COMMS_SCRIPT.length && live.every((x) => ids.has(x.id) && COMMS_SCRIPT.find((l) => l.id === x.id).text === x.text && x.direction.length > 8 && +x.max_s > 0 && +x.max_s <= 6), `lines.csv: ${live.length} script lines (the subtitle text, a direction, a max length each)`);
  ok(spec.length === 11 && spec.some((x) => x.id === 'ch-last' && x.text === 'He fits now.' && x.kind === 'offmic'), `lines.csv: the ${spec.length} specified story-bible lines (status spec, not in the game), the last "He fits now." off mic`);
}

// ===========================================================================================================================
// 2. the release tier and the disclosure
// ===========================================================================================================================
{
  const G = await import(pathToFileURL(path.join(TOOLS_DIR, 'release/gen-precache.mjs')).href);
  const lazy = (G.DEFAULT_LAZY || []).map(G.globToRegExp);
  const isLazy = (f) => lazy.some((re) => re.test(f));
  ok(isLazy('assets/audio/voice/odessa/s1-open-2.ogg') && isLazy('assets/audio/voice/manifest.json'), 'the voice folder is in the lazy precache tier (never the 80 MB core)');
  const ui = fs.readFileSync(path.join(GAME_ROOT, 'src/ui/ui3d.js'), 'utf8');
  const dom = (ui.match(/d\.aboutCredits\.textContent =\s*'([^']*)'/) || [])[1] || '';
  const vr = (ui.match(/const credits = '([^']*)'/) || [])[1] || '';
  ok(/AI/.test(dom) && /Kokoro/.test(dom) && /AI/.test(vr) && /Kokoro/.test(vr), 'the About credits (page and VR panel) disclose the AI placeholder voices');
  const rel = fs.readFileSync(path.join(REPO_ROOT, 'docs/abyssal-tether-3d/RELEASE.md'), 'utf8');
  ok(/VO_SCRIPT\.md/.test(rel) && /AI/.test(rel), 'RELEASE.md: the AI voice disclosure + the route to real recordings');
}

// ===========================================================================================================================
// 3. the director: timed by the clip
// ===========================================================================================================================
const X = (o) => Object.assign({ playing: true, section: 0, depth: 0, frac: 0, danger: false, tense: false, skip: false, gaze: false, bloodOn: false }, o || {});
{
  const at = (sec) => {
    const cm = new CommsDirector({ seed: 11 });
    cm.update(1 / 60, X({ section: sec }));
    return cm;
  };
  const cm = at(3);
  cm.voice = (id) => L[id] || null;
  const tx = cm.debugSay('s4-knock', {});
  const e = L['s4-knock'];
  ok(tx.voice === e && Math.abs(tx.speak - e.d) < 1e-9 && Math.abs(tx.dur - voiceHold(tx.text, e.d)) < 1e-9 && tx.dur >= VOICE_LEAD + e.d + VOICE_TAIL - 1e-9, `a clip times the line: speak = the clip (${e.d.toFixed(2)} s), the subtitle holds ${tx.dur.toFixed(2)} s (squelch + clip + tail), not the text's ${holdTime(tx.text).toFixed(2)} s`);
  let t = 0;
  while (cm.current && t < 20) {
    cm.update(1 / 60, X({ section: 3 }));
    t += 1 / 60;
  }
  ok(Math.abs(t - tx.dur) < 0.05, `the subtitle leaves when the clip's hold ends (${t.toFixed(2)} s on air)`);

  const plain = at(3);
  const tp = plain.debugSay('s4-knock', {});
  ok(!tp.voice && tp.speak === speakTime(tp.text) && tp.dur === holdTime(tp.text), 'no hook: the text timing, exactly as before');
  const badHook = at(3);
  badHook.voice = () => {
    throw new Error('x');
  };
  const nanHook = at(3);
  nanHook.voice = () => ({ d: NaN, w: [] });
  const tb = badHook.debugSay('s4-knock', {});
  const tn = nanHook.debugSay('s4-knock', {});
  ok(!tb.voice && !tn.voice && tb.dur === holdTime(tb.text) && tn.dur === holdTime(tn.text), 'a throwing hook or a bad entry: the text timing');

  // the stuck word (s7-hang forces it) sits on the word in the clip and adds two repeats
  const c7 = at(6);
  c7.voice = (id) => L[id] || null;
  const t7 = c7.debugSay('s7-hang', {});
  const e7 = L['s7-hang'];
  const rep = t7.glitches.find((g) => g.kind === 'repeat');
  const st = t7.stuck;
  ok(/—/.test(t7.text) && st && rep && rep.w === st.w && st.s <= STUCK_MAX && Math.abs(st.a - e7.w[st.w][0]) < 1e-9 && Math.abs(t7.speak - (e7.d + 2 * st.s)) < 1e-9 && Math.abs(rep.t - (st.a + st.s)) < 1e-6, `the stuck word in the clip: "${t7.text}" (word ${st && st.w} at ${st && st.a.toFixed(2)} s, +2 x ${st && st.s.toFixed(2)} s)`);
  const d1 = at(6);
  const d2 = at(6);
  d1.voice = d2.voice = (id) => L[id] || null;
  const a1 = d1.debugSay('s7-hang', {});
  const a2 = d2.debugSay('s7-hang', {});
  ok(JSON.stringify({ ...a1, line: 0, voice: 0 }) === JSON.stringify({ ...a2, line: 0, voice: 0 }), 'deterministic: the same clip, seed and count give the same timing and glitches');
  const plain7 = at(6).debugSay('s7-hang', {});
  ok(plain7.text === t7.text && JSON.stringify(plain7.glitches.map((g) => g.kind)) === JSON.stringify(t7.glitches.map((g) => g.kind)), 'the clip changes only the timing: the same stuck word and glitch kinds as the text path');
  const c8 = at(7);
  c8.voice = (id) => L[id] || null;
  const t8 = c8.debugSay('s8-warm', {});
  ok(t8.voiceRate === NOTQUITE_RATE && Math.abs(t8.speak - (L['s8-warm'].d + (t8.stuck ? 2 * t8.stuck.s : 0)) / NOTQUITE_RATE) < 1e-9, `the voice that is not quite Odessa plays slower (x${NOTQUITE_RATE}): ${t8.speak.toFixed(2)} s for a ${L['s8-warm'].d.toFixed(2)} s clip`);
  ok(voiceStuck({ d: 1, w: [[0, 0.05]] }, 0) === null && voiceStuck(null, 0) === null && voiceStuck(e7, 99) === null, 'voiceStuck: no stutter on a too-short or missing word');
}

// ===========================================================================================================================
// 4. the player (strict mock Web Audio) and the bank
// ===========================================================================================================================
{
  const RADIO = await import(srcUrl('audio/radio3d.js'));
  const { AudioManager3D } = await import(srcUrl('audio/audio3d.js'));
  const fetched = [];
  globalThis.window = { AudioContext: MockAudioContext, addEventListener() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url) => {
    fetched.push(String(url));
    return Promise.reject(new Error('offline test'));
  };
  const bus = new C.EventBus();
  const settings = Object.assign({}, C.SETTINGS_DEFAULTS, { volume: 0.8 });
  const audio = new AudioManager3D(bus, settings);
  ok(fetched.length === 0, 'nothing is fetched before the audio unlocks (never at boot)');
  audio.unlock();
  const ctx = audio.ctx;
  const radio = audio._radio;
  await new Promise((r) => setTimeout(r, 0));
  ok(radio && radio.bank && fetched.length === 1 && fetched[0] === 'assets/audio/voice/manifest.json', `at unlock: the manifest only (${fetched.join(', ')})`);
  await new Promise((r) => setTimeout(r, 0));
  ok(radio.bank.state === 'failed' && audio.voiceFor('s4-knock') === null, 'no manifest (offline, a 404): no clip offered, the babble speaks');

  // a bank with clips (decoded buffers put directly: Node has no Opus decoder)
  const bank = radio.bank;
  bank.manifest = manifest;
  bank.state = 'ready';
  bank.decode = () => Promise.reject(new Error('no Opus decoder in Node')); // a requested clip fails: the babble keeps it
  const mkBuf = (d) => ctx.createBuffer(1, Math.round(d * 24000), 24000);
  for (const id of ['s4-knock', 's7-hang', 's8-warm', 's8-two', 'back-hot-1']) bank._put(id, mkBuf(L[id].d), L[id]);
  const cm = new CommsDirector({ seed: 4 });
  cm.voice = (id) => audio.voiceFor(id);
  cm.onStart = (tx) => bus.emit('comms:line', tx);
  cm.onEnd = (tx) => bus.emit('comms:end', tx);
  const game = { comms: cm };
  const run = (secs, sec) => {
    for (let i = 0; i < Math.round(secs * 30); i++) {
      ctx.currentTime += 1 / 30;
      cm.update(1 / 30, X({ section: sec }));
      audio.update(1 / 30, game);
    }
  };
  const say = (id, sec) => {
    cm.update(1 / 30, X({ section: sec }));
    const tx = cm.debugSay(id, {});
    const nodes = radio.cur ? radio.cur.nodes.slice() : [];
    return { tx, nodes, clip: radio.cur && radio.cur.clip };
  };
  const srcOf = (nodes, buf) => nodes.filter((n) => n.kind === 'buffersource' && n.buffer === buf);
  let s = say('s4-knock', 3);
  const bk = bank.bufs.get('s4-knock').buf;
  ok(s.clip && s.tx.voice && srcOf(s.nodes, bk).length === 1 && !s.nodes.some((n) => n.kind === 'osc'), 'a decoded clip plays as a buffer source through the radio chain; no babble oscillator');
  run(s.tx.dur + 1, 3);
  s = say('s7-hang', 6);
  const hs = srcOf(s.nodes, bank.bufs.get('s7-hang').buf);
  ok(s.clip && hs.length === 3 && hs.every((n) => n.started), `the stuck word: three sources over the word timing ("${s.tx.text}")`);
  run(s.tx.dur + 1, 6);
  s = say('s8-warm', 7);
  const ws = srcOf(s.nodes, bank.bufs.get('s8-warm').buf);
  ok(s.clip && ws.length === 2 && Math.abs(ws[0].playbackRate.value - 0.94) < 1e-9 && Math.abs(ws[1].playbackRate.value - 0.94 * 1.012) < 1e-9, 'not quite Odessa: the clip at x0.94, doubled by a second copy a hair faster (runtime, no extra file)');
  run(s.tx.dur + 1, 7);
  s = say('s8-two', 7);
  ok(s.clip && s.nodes.filter((n) => n.kind === 'osc').length === 2, 'Vesper: the clip with the suit chime (two sine tones), no squelch');
  run(s.tx.dur + 1, 7);
  s = say('s4-enter', 3);
  ok(!s.clip && !s.tx.voice && s.nodes.some((n) => n.kind === 'osc') && Math.abs(s.tx.dur - holdTime(s.tx.text)) < 1e-9, 'a line whose clip is not decoded yet: the babble, timed by its text');
  ok(bank.queue.includes('s4-enter') || bank.pending.has('s4-enter') || bank.failed.has('s4-enter'), 'and it is queued for its next time on air');
  run(s.tx.dur + 1, 3);
  bank.failed.add('s4-knock');
  bank.bufs.delete('s4-knock');
  s = say('s4-knock', 3);
  ok(!s.clip && s.nodes.some((n) => n.kind === 'osc'), 'a clip that failed to load: the babble');
  run(s.tx.dur + 1, 3);
  s = say('s4-echo', 3);
  ok(!s.clip && !s.tx.voice && radio.cur && radio.cur.nodes.some((n) => n.kind === 'buffersource' && n.loop), 'the UPLINK echo keeps its synthesised breathing (the documented fallback)');
  run(s.tx.dur + 1, 3);
  // a cut clip stops at once; the dropout gaps it
  cm.update(1 / 30, X({ section: 6 }));
  const tc = cm.debugSay('s7-hang', { glitch: 'dropout', at: 0.5, dur: 0.4 });
  const outGain = radio.cur.nodes[0].gain;
  ok(tc.voice && outGain.events >= 4, 'a dropout gaps the clip (the out gain ramps to 0 and back)');
  run(0.3, 6);
  cm._cut(false);
  run(0.5, 6);
  ok(!radio.cur, 'a cut clip stops at once');
  const before = radio.lines;
  settings.radioVoices = false;
  ok(audio.voiceFor('s7-hang') === null, 'Radio voices OFF: no clip offered (captions only, timed by the text)');
  const toff = cm.debugSay('s7-hang', {});
  run(1, 6);
  ok(radio.lines === before && !toff.voice, 'Radio voices OFF: silent');
  settings.radioVoices = true;
  ctx.state = 'suspended';
  ok(audio.voiceFor('s7-hang') === null, 'audio not running (paused, not unlocked): no clip offered');
  ctx.state = 'running';
  run(2, 6);
  ok(warnings.length === 0, 'no warnings from the audio side' + (warnings.length ? ': ' + warnings[0].slice(0, 200) : ''));

  // the bank alone: the order, the parallel cap, the LRU
  const loads = [];
  const resolvers = [];
  const vb = new RADIO.VoiceBank({
    load: (url, as) => {
      loads.push(url);
      if (as === 'json') return Promise.resolve(manifest);
      return new Promise((res) => resolvers.push(() => res(url)));
    },
    decode: (u) => Promise.resolve({ duration: L[path.basename(u, '.ogg')].d, url: u }),
  });
  vb.section = 4;
  await vb.start();
  const first = loads.slice(1).map((u) => path.basename(u, '.ogg'));
  ok(loads[0].endsWith('manifest.json') && first.length === 2 && first.every((id) => L[id].s === 4), `the bank: the manifest, then the wanted section's lines, <= 2 at once (${first.join(', ')})`);
  for (let k = 0; k < 200 && resolvers.length; k++) {
    resolvers.shift()();
    await new Promise((r) => setTimeout(r, 0));
  }
  const order = loads.slice(1).map((u) => L[path.basename(u, '.ogg')].s);
  const rank = (s0) => (s0 === 4 ? 0 : s0 === 5 ? 1 : 2);
  ok(order.every((v, i) => i === 0 || rank(v) >= rank(order[i - 1])), `then the next section's, then the anywhere lines (${order.join(' ')})`);
  ok(vb.seconds <= RADIO.VOICE_CACHE_S + 6 && vb.bufs.size > 0, `decoded clips kept within the LRU budget (${vb.seconds.toFixed(1)} s of ${RADIO.VOICE_CACHE_S} s, ${vb.bufs.size} clips)`);
  vb.pinned = 's4-knock';
  if (!vb.bufs.has('s4-knock')) vb._put('s4-knock', { duration: 2 }, L['s4-knock']);
  for (let k = 0; k < 80; k++) vb._put('fake-' + k, { duration: 3 }, { s: 2 });
  ok(vb.bufs.has('s4-knock') && vb.seconds <= RADIO.VOICE_CACHE_S + 3, 'the LRU never evicts the clip on air');

  // ?comms=off: nothing fetched
  globalThis.location = { search: '?comms=off' };
  fetched.length = 0;
  const audio2 = new AudioManager3D(new C.EventBus(), Object.assign({}, C.SETTINGS_DEFAULTS));
  audio2.unlock();
  audio2._radio.prefetch(3);
  await new Promise((r) => setTimeout(r, 0));
  ok(fetched.length === 0 && audio2._radio.bank.state === 'idle' && audio2.voiceFor('s4-knock') === null, '?comms=off: no clip fetched, none offered');
  delete globalThis.location;
  const s3 = Object.assign({}, C.SETTINGS_DEFAULTS, { radioVoices: false });
  const audio3 = new AudioManager3D(new C.EventBus(), s3);
  audio3.unlock();
  await new Promise((r) => setTimeout(r, 0));
  ok(fetched.length === 0 && audio3._radio.bank.state === 'idle', 'Radio voices OFF at unlock: nothing fetched');
  globalThis.fetch = realFetch;
}

// ===========================================================================================================================
// 5. no allocation per frame (a fresh process)
// ===========================================================================================================================
{
  const code = `
globalThis.self = globalThis;
const { MockAudioContext } = await import('${MOCK_URL}');
globalThis.window = { AudioContext: MockAudioContext, addEventListener() {} };
globalThis.fetch = () => Promise.reject(new Error('offline'));
const CM = await import('${srcUrl('sim/comms3d.js')}');
const C = await import('${srcUrl('sim/config3d.js')}');
const { AudioManager3D } = await import('${srcUrl('audio/audio3d.js')}');
const L = ${JSON.stringify({ 's7-hang': L['s7-hang'] })};
const meas = (f, n) => { for (let i = 0; i < 200000; i++) f(); global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < n; i++) f(); return process.memoryUsage().heapUsed - h0; };
const bus = new C.EventBus();
const audio = new AudioManager3D(bus, Object.assign({}, C.SETTINGS_DEFAULTS));
audio.unlock();
await new Promise((r) => setTimeout(r, 0));
const radio = audio._radio;
radio.bank.manifest = { lines: L }; radio.bank.state = 'ready';
radio.bank._put('s7-hang', audio.ctx.createBuffer(1, 24000 * 3, 24000), L['s7-hang']);
const cm = new CM.CommsDirector({ seed: 3 });
cm.voice = (id) => audio.voiceFor(id);
cm.onStart = (tx) => radio.speak(tx);
const x = { playing: true, section: 6, depth: 300, frac: 0.2, danger: false, tense: false, skip: false, gaze: false, bloodOn: false };
cm.update(1 / 72, x);
cm.debugSay('s7-hang', { glitch: 'static', at: 0.4, dur: 0.6 });
cm.current.dur = 1e9;
const game = { comms: cm };
const now = audio.ctx.currentTime + 0.5;
const director = meas(() => cm.update(1 / 72, x), 300000);
const control = meas(() => radio.control(1 / 72, now, game), 300000);
console.log(JSON.stringify({ director, control, clip: !!(radio.cur && radio.cur.clip) }));
`;
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { encoding: 'utf8' });
  let A;
  try {
    A = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    A = { error: (r.stderr || r.stdout || '').slice(0, 300) };
  }
  ok(A.clip && A.director >= 0 && A.director < 100_000 && A.control >= 0 && A.control < 100_000, `no allocation per frame with a clip on air: CommsDirector.update ${A.director} B, Radio.control ${A.control} B over 300k frames` + (A.error ? ': ' + A.error : ''));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
