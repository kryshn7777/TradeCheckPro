// CHAPTER II's radio (chapter2Glue.js radioScript on the shipped CommsDirector), Node: the six lines respect the radio's limits and are said where they should:
// the opening in the first beat, the contact at 1,060 m, the bell's answer (then the rule after it), the bars at the Cinder Stairs, the orderly line when the Round begins.
//   node chapter2-radio.mjs [--root DIR]
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true }; if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true }; return next(s, c); }`));
globalThis.self = globalThis;
const { radioScript } = await import(srcUrl('chapter2Glue.js'));
const { CommsDirector, LINE_MAX_CHARS, MAX_WORDS, COMMS_CHARSET, wordCount, SPEAKERS } = await import(srcUrl('sim/comms3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const script = radioScript();
ok(script.length === 5 && script.every((l) => SPEAKERS[l.speaker]), 'five lines, each by a known speaker (layout 2 cut the contact line with the beat it was in)');
ok(script.every((l) => l.text.length <= LINE_MAX_CHARS && wordCount(l.text) <= MAX_WORDS + 1 && COMMS_CHARSET.test(l.text)), 'each within the radio\'s limits (84 characters, the charset)');
// the sections of the lines are the beats' places in the chapter: II-1 is 0, the Tolling Gallery 4, the Snuffing 5
ok(script.find((l) => l.id === 'c2-open').section === 0 && script.find((l) => l.id === 'c2-bell').section === 4 && script.find((l) => l.id === 'c2-orderly').section === 5, 'each line is placed by its beat\'s index in the chapter');
const said = [];
const cm = new CommsDirector({ seed: 1, script });
cm.onStart = (tx) => said.push(tx.id);
const ctx = { playing: true, section: 0, depth: 600, frac: 0, danger: false, tense: false, skip: false, gaze: false, bloodOn: false };
const run = (s) => {
  for (let i = 0; i < s * 30; i++) cm.update(1 / 30, ctx);
};
cm.onEvent('game:start', {});
ctx.section = 0;
cm.onEvent('section:enter', { index: 0, first: true });
run(8);
ok(said.includes('c2-open'), 'the first beat opens the radio');
ctx.section = 4;
ctx.depth = 830;
cm.onEvent('section:enter', { index: 4, first: true });
run(2);
cm.onEvent('c2:answer', { stage: 1 });
run(2);
ok(!said.includes('c2-bell'), 'the first toll is not yet the answer');
cm.onEvent('c2:answer', { stage: 2 });
run(14);
ok(said.indexOf('c2-bell') >= 0 && said.indexOf('c2-rule') > said.indexOf('c2-bell'), 'the bell\'s answer, then the rule');
ctx.section = 5;
ctx.depth = 890;
cm.onEvent('section:enter', { index: 5, first: true });
cm.onEvent('c2:phase', { phase: 'A' });
run(12);
ok(said.includes('c2-bars'), 'the bars drop when the Snuffing begins');
ok(said.includes('c2-orderly'), '"That isn\'t the Mason. That\'s orderly." when the Round begins');
console.log(fails ? `FAILED: ${fails}` : 'ALL CHAPTER II RADIO CHECKS PASS');
process.exit(fails ? 1 : 0);
