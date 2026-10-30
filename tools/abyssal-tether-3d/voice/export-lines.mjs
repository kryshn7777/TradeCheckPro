// ABYSSAL TETHER 3D: the voice line table exporter (docs/abyssal-tether-3d/plans/VO_SCRIPT.md).
// Reads the live radio script (src/sim/comms3d.js COMMS_SCRIPT) + the hand-authored direction (voice/direction.mjs) and writes
//   tools/abyssal-tether-3d/voice/lines.csv     one row per line: what build_voices.py renders and what the actors record
//   docs/abyssal-tether-3d/plans/VO_SCRIPT.md   the per-line tables between <!-- LINES:BEGIN --> and <!-- LINES:END -->
// The text of a live line is always the subtitle's (comms3d.js); `pickup` reads the shipped voice manifest: a human recording
// whose script text has changed since it was recorded needs a pickup session.
//   node tools/abyssal-tether-3d/voice/export-lines.mjs [--check]   (--check: exit 1 if lines.csv / VO_SCRIPT.md are stale)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CAST, DIRECTION, SPEC_LINES } from './direction.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const GAME = path.join(REPO, 'public/abyssal-tether-3d');
export const CSV_PATH = path.join(HERE, 'lines.csv');
export const DOC_PATH = path.join(REPO, 'docs/abyssal-tether-3d/plans/VO_SCRIPT.md');
export const MANIFEST_PATH = path.join(GAME, 'assets/audio/voice/manifest.json');
export const COLUMNS = ['id', 'status', 'section', 'speaker', 'kind', 'trigger', 'text', 'say', 'direction', 'max_s', 'ai_pace', 'ai_pitch', 'pickup'];

/** FNV-1a over UTF-16 code units (the same as comms3d.js hashStr; build_voices.py text_hash): the script text a take was made from. */
export function textHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const words = (t) => String(t).split(' ').filter(Boolean);

function triggerOf(line) {
  const out = [];
  for (const w of line.when) {
    if (w.enter) out.push(`entering S${line.section + 1}${w.after ? ` (+${w.after} s)` : ''}`);
    else if (w.depth != null) out.push(`reaching ${w.depth} m in S${line.section + 1}`);
    else if (w.stall) out.push('no progress for 60 s (voiced hint)');
    else if (w.chain) out.push(`${w.gap || 0} s after ${w.chain}`);
    else if (w.restore) out.push(`after a restore (${w.restore})`);
    else if (w.gaze) out.push('3 s looking at a blood writing (Blood writing on)');
    else if (w.skit) out.push('first skitterling contact');
    else if (w.ev) {
      let s = `event ${w.ev}`;
      if (w.match) s += ` ${Object.entries(w.match).map(([k, v]) => `${k}=${v}`).join(' ')}`;
      if (w.text) s += ` (hint about "${w.text}")`;
      out.push(s);
    }
  }
  return out.join(' or ');
}

export async function buildRows(opts = {}) {
  const comms = await import(pathToFileURL(path.join(GAME, 'src/sim/comms3d.js')).href);
  const { COMMS_SCRIPT, holdTime } = comms;
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(opts.manifestPath || MANIFEST_PATH, 'utf8'));
  } catch {
    manifest = null;
  }
  // the longest a take may run: the subtitle's hold (of the spoken form when it is longer: '99.8%' speaks four words) + 0.5 s, <= 6 s (COMMS.md)
  const maxS = (text, say) => Math.min(6, Math.round((Math.max(holdTime(text), say ? holdTime(say.replace(/_/g, ' ')) : 0) + 0.5) * 10) / 10);
  const pickupOf = (id, text) => {
    const e = manifest && manifest.lines && manifest.lines[id];
    if (!e || e.src !== 'human') return '';
    return e.h === textHash(text) ? 'recorded' : 'NEEDED: script changed since the recording';
  };
  const rows = [];
  const problems = [];
  const live = new Set();
  for (const line of COMMS_SCRIPT) {
    live.add(line.id);
    const d = DIRECTION[line.id];
    if (!d) problems.push(`${line.id}: no direction in voice/direction.mjs`);
    const say = d && d.say ? d.say : '';
    if (say && words(say).length !== words(line.text).length) problems.push(`${line.id}: "say" has ${words(say).length} tokens, the subtitle ${words(line.text).length}`);
    const novo = line.speaker === 'UPLINK' || line.kind === 'echo';
    rows.push({
      id: line.id,
      status: novo ? 'no-vo' : 'live',
      section: line.section >= 0 ? `S${line.section + 1}` : 'any',
      speaker: line.speaker,
      kind: line.kind,
      trigger: triggerOf(line),
      text: line.text,
      say,
      direction: d ? d.dir : '',
      max_s: maxS(line.text, say),
      ai_pace: d && d.pace ? d.pace : 1,
      ai_pitch: d && d.pitch ? d.pitch : 0,
      pickup: pickupOf(line.id, line.text),
      _sec: line.section,
    });
  }
  for (const id of Object.keys(DIRECTION)) if (!live.has(id)) problems.push(`${id}: direction for a line that is not in the script`);
  for (const s of SPEC_LINES) {
    if (live.has(s.id)) continue; // built since: the live row above carries it (its direction must move to DIRECTION)
    const say = s.say || '';
    if (say && words(say).length !== words(s.text).length) problems.push(`${s.id}: "say" token count differs from the text`);
    rows.push({ id: s.id, status: 'spec', section: s.section >= 0 ? `S${s.section + 1}` : 'any', speaker: s.speaker, kind: s.kind || 'radio', trigger: s.trigger, text: s.text, say, direction: s.dir, max_s: maxS(s.text, say), ai_pace: 1, ai_pitch: 0, pickup: '', _sec: s.section });
  }
  return { rows, problems };
}

function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows) {
  return COLUMNS.join(',') + '\n' + rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n') + '\n';
}

const md = (s) => String(s).replace(/\|/g, '\\|');
function toMarkdown(rows) {
  const out = [];
  const head = '| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |\n|---|---|---|---|---|---|---|';
  const row = (r) => `| \`${r.id}\` | ${r.section} | ${md(r.trigger)} | **${md(r.text)}**${r.say ? `<br>*say:* ${md(r.say.replace(/_/g, ' '))}` : ''}${r.kind !== 'radio' ? ` *(${r.kind})*` : ''} | ${md(r.direction)} | ${r.max_s} | ${r.pickup || ''} |`;
  for (const sp of ['ODESSA', 'TICK', 'MAREN', 'VESPER', 'UPLINK']) {
    const mine = rows.filter((r) => r.speaker === sp && r.status !== 'spec');
    if (!mine.length) continue;
    out.push(`#### ${sp} (${mine.length} line${mine.length > 1 ? 's' : ''}) — ${CAST[sp].who}`, '', head, ...mine.map(row), '');
  }
  const spec = rows.filter((r) => r.status === 'spec');
  if (spec.length) out.push(`#### Specified, not in the game yet (DARK_STORY_BIBLE.md §4.3: ${spec.length} lines; record them in the same session)`, '', head, ...spec.map((r) => row({ ...r, text: `${r.speaker}: ${r.text}` })), '');
  return out.join('\n');
}

export function spliceDoc(doc, table) {
  const a = doc.indexOf('<!-- LINES:BEGIN -->');
  const b = doc.indexOf('<!-- LINES:END -->');
  if (a < 0 || b < a) return null;
  return doc.slice(0, a) + '<!-- LINES:BEGIN -->\n<!-- generated by tools/abyssal-tether-3d/voice/export-lines.mjs: edit voice/direction.mjs or comms3d.js, then re-run -->\n\n' + table + '\n' + doc.slice(b);
}

async function main() {
  const check = process.argv.includes('--check');
  const { rows, problems } = await buildRows();
  if (problems.length) {
    console.error('export-lines: ' + problems.join('\n  '));
    process.exit(1);
  }
  const csv = toCsv(rows);
  let doc = null;
  try {
    doc = fs.readFileSync(DOC_PATH, 'utf8');
  } catch {
    doc = null;
  }
  const newDoc = doc != null ? spliceDoc(doc, toMarkdown(rows)) : null;
  if (check) {
    const old = fs.existsSync(CSV_PATH) ? fs.readFileSync(CSV_PATH, 'utf8') : '';
    const stale = [old !== csv ? 'lines.csv' : '', newDoc != null && newDoc !== doc ? 'VO_SCRIPT.md' : ''].filter(Boolean);
    if (stale.length) {
      console.error(`export-lines --check: stale ${stale.join(', ')} (run node tools/abyssal-tether-3d/voice/export-lines.mjs)`);
      process.exit(1);
    }
    console.log(`export-lines --check: ${rows.length} rows in sync`);
    return;
  }
  fs.writeFileSync(CSV_PATH, csv);
  if (newDoc != null && newDoc !== doc) fs.writeFileSync(DOC_PATH, newDoc);
  const n = (s) => rows.filter((r) => r.status === s).length;
  console.log(`export-lines: ${rows.length} rows (${n('live')} live, ${n('no-vo')} no VO, ${n('spec')} specified) -> ${path.relative(REPO, CSV_PATH)}${newDoc != null ? ' + VO_SCRIPT.md' : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
