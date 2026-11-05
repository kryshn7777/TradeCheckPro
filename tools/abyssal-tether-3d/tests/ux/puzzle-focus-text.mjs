// PUZZLE FOCUS script (public/abyssal-tether-3d/src/data/puzzle-focus-text.js; docs/abyssal-tether-3d/plans/PUZZLE_FOCUS.md):
//   - every line inside the radio's limits (COMMS.md: <= 84 characters, <= 2 panel rows of 42, <= 11 words, COMMS_CHARSET; Vesper <= 5 words)
//   - valid speakers (ELIAS, VESPER, TICK, ODESSA, MAREN: never the UPLINK), no duplicate ids, none clashing with the shipped radio's ids
//   - every puzzle type of both chapters covered (Chapter I: bell, haul, winch, lamp, rest, breach, lure, fork, survive; Chapter II: swing,
//     lift, knocker, name, peal, clapper, pawl, lever); an objective type has all three steps (first, nudge, hint), a place a first-sight line
//   - 2-3 variants per type and step counts; every step keeps an Elias / Vesper variant (the deep end); S7 types speak locally only
//   - a direction per line; the lines are exported to voice/lines.csv (status focus) with the subtitle text
//   node puzzle-focus-text.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import { srcUrl, TOOLS_DIR } from '../../verify/root.mjs';

const T = await import(srcUrl('data/puzzle-focus-text.js'));
const C = await import(srcUrl('sim/comms3d.js'));
const C2 = await import(srcUrl('data/chapter2-text.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const L = T.PUZZLE_FOCUS_LINES;
const SPEAK = new Set(['ELIAS', 'VESPER', 'TICK', 'ODESSA', 'MAREN']);

const bad = [];
for (const v of L) {
  const w = C.wordCount(v.text);
  const rows = C.wrapText(v.text);
  if (v.text.length > C.LINE_MAX_CHARS) bad.push(`${v.id}: ${v.text.length} chars`);
  if (w > C.MAX_WORDS) bad.push(`${v.id}: ${w} words`);
  if (rows.length > C.WRAP_LINES || rows.some((r) => r.length > C.WRAP_CHARS)) bad.push(`${v.id}: wraps to ${rows.length} rows`);
  if (!C.COMMS_CHARSET.test(v.text)) bad.push(`${v.id}: charset`);
  if (v.speaker === 'VESPER' && w > 5) bad.push(`${v.id}: Vesper ${w} words`);
}
ok(!bad.length, `all ${L.length} lines inside the radio's limits (84 chars, 2 x 42, 11 words, the charset, Vesper <= 5 words)` + (bad.length ? ': ' + bad.join('; ') : ''));
ok(L.every((v) => SPEAK.has(v.speaker) && C.SPEAKERS[v.speaker]), 'every speaker is in the cast (Elias, Vesper, Tick, Odessa, Maren; never the open channel)');
const ids = L.map((v) => v.id);
ok(new Set(ids).size === ids.length && ids.every((id) => /^pf-[a-z]+-[123][a-c]$/.test(id)), `no duplicate ids, all pf-<type>-<step><variant> (${ids.length})`);
const shipped = new Set([...C.COMMS_SCRIPT.map((l) => l.id), ...C2.CHAPTER2_TEXT.radio.map((r) => r.id)]);
ok(ids.every((id) => !shipped.has(id)), 'no id clashes with the shipped radio (Chapter I script, Chapter II radio)');
ok(new Set(L.map((v) => v.text)).size === L.length && L.every((v) => !C.COMMS_SCRIPT.some((l) => l.text === v.text)), 'no line repeats another, nor a shipped radio line');

const want1 = ['bell', 'haul', 'winch', 'lamp', 'rest', 'breach', 'lure', 'fork', 'survive'];
const want2 = ['swing', 'lift', 'knocker', 'name', 'peal', 'clapper', 'pawl', 'lever'];
const P = T.PUZZLE_TYPES;
ok(want1.every((k) => P[k] && P[k].chapter === 1) && want2.every((k) => P[k] && P[k].chapter === 2) && Object.keys(P).length === want1.length + want2.length, `every puzzle type covered: Chapter I ${want1.join(', ')}; Chapter II ${want2.join(', ')}`);
let steps = true;
for (const t of Object.values(P)) {
  if (!t.first || t.first.length < 1) steps = false;
  if (t.objective && (!t.nudge || !t.nudge.length || !t.hint || !t.hint.length)) steps = false;
  if (!t.objective && (t.nudge || t.hint)) steps = false;
}
ok(steps, 'an objective type has a first-sight line, a nudge and a hint escalation; a place worth a look a first-sight line');
const counts = Object.entries(P).map(([k, t]) => `${k} ${(t.first || []).length + (t.nudge || []).length + (t.hint || []).length}`);
const objOk = Object.values(P).every((t) => !t.objective || ((t.first || []).length + (t.nudge || []).length + (t.hint || []).length >= 3 && (t.first || []).length >= 2));
ok(objOk && L.length >= 60, `line counts (${L.length}): ${counts.join(', ')}`);
let local = true;
for (const t of Object.values(P)) for (const s of T.FOCUS_STEPS) if (t[s] && !t[s].some((v) => v.speaker === 'ELIAS' || v.speaker === 'VESPER')) local = false;
ok(local, 'every step keeps an Elias or Vesper variant (below the uplink threshold the beat still speaks)');
ok(['first', 'nudge', 'hint'].every((s) => P.survive[s].every((v) => v.speaker === 'ELIAS' || v.speaker === 'VESPER')), 'the Hollow Nave (S7, signal 0.33 -> 0.2): Elias and Vesper only');
const sp = new Set(L.map((v) => v.speaker));
ok(sp.size === 5, `variety: all five voices are used (${[...sp].join(', ')})`);
ok(L.every((v) => typeof v.dir === 'string' && v.dir.length >= 8), 'a direction for the actor on every line');
ok(Object.values(P).every((t) => typeof t.source === 'string' && t.source.length > 5 && t.see > 0 && t.where), 'every type names its fixture position source, its first-sight range and where it is');
ok(P.name.quiet && P.name.quiet.indexOf('c2-4') >= 0, 'the Waking Hall (a rest beat: no chatter) is quiet for the Names');

// exported for the VO session
const csv = fs.readFileSync(path.join(TOOLS_DIR, 'voice/lines.csv'), 'utf8');
const rows = csv.split('\n').filter((l) => l.startsWith('pf-'));
ok(rows.length === L.length && L.every((v) => rows.some((r) => r.startsWith(v.id + ',focus,') && r.indexOf(v.speaker) > 0)), `voice/lines.csv carries every focus line (status focus): ${rows.length}`);
const doc = fs.readFileSync(path.join(TOOLS_DIR, '../../docs/abyssal-tether-3d/plans/VO_SCRIPT.md'), 'utf8');
ok(/PUZZLE FOCUS \(\d+ lines/.test(doc) && L.every((v) => doc.indexOf('`' + v.id + '`') >= 0), 'VO_SCRIPT.md lists them (a PUZZLE FOCUS table)');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
