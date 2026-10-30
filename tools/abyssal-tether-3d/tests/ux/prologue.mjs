// The opening story (sim/prologue3d.js): its length, its three jobs (why the company exists, the descent, the task), what it must NOT
// give away, the typewriter, the presses, the tear, determinism, and the setting.
//   node prologue.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const P = await import(srcUrl('sim/prologue3d.js'));
const { sanitizeUxSettings, SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const text = P.PAGES.map((p) => p.lines.map((l) => l.t).join(' ')).join(' ');
const upper = text.toUpperCase();

ok(P.TOTAL >= 35 && P.TOTAL <= 60, 'the whole story runs ' + P.TOTAL.toFixed(1) + ' s with no presses (35-60 s)');
ok(P.PAGES.length === 6 && P.PAGES[0].tone === 0 && P.PAGES[4].tone === 4, 'six pages; the tone grows from clinical (0) to the addendum (4)');
let rising = true;
for (let i = 1; i < 5; i++) if (P.PAGES[i].tone < P.PAGES[i - 1].tone) rising = false;
ok(rising, 'the record only gets darker page by page (up to the addendum)');
ok(P.PAGES[4].lines[P.PAGES[4].lines.length - 1].k === 'cut' && P.PAGES[4].lines[P.PAGES[4].lines.length - 1].t.endsWith(', but'), 'the addendum is torn off mid-sentence ("..., but")');
ok(/ADDENDUM/.test(upper) && /BEFORE THE LAMP/.test(upper) && /NEVER MEANT TO BE DISTURBED/.test(upper) && /DORMANT/.test(upper) && /FIRST STONE/.test(upper), 'the monition: something before the lamp, dormant, never to be disturbed');
ok(/KEEP THE LIGHT ON/.test(upper) && /EMBER/.test(upper), 'job 1: why the company exists (the light, the Ember)');
ok(/556 METRES/.test(upper) && /FELL SILENT/.test(upper) && /LOWERING A PERSON/.test(upper), 'job 2: the descent (556 m, the probes, a person)');
ok(/GO DOWN/.test(upper) && /KINDLING/.test(upper) && /CARRY IT BACK/.test(upper), 'job 3: what the player must do (go down, a fresh kindling, bring it back)');
// the player finds the rest below: none of it is told here
const banned = ['WREN', 'ODESSA', 'DESSA', 'VELL', 'HESPER', 'FITTING', 'MASON', 'DRESSER', 'HOLDFAST', 'LANTERNWRIGHT', 'KEEPER', 'MENDER', 'STILL FLAME', 'STILL ONE', 'CONTINUITY', 'RESTORE', 'COPY', 'KNOCK', 'STATUE', 'STONE DEAD', 'FORTY', 'KEPT'];
const leaked = banned.filter((w) => upper.includes(w));
ok(leaked.length === 0, 'it gives none of the secrets away (' + (leaked.join(', ') || 'none leaked') + ')');
let fit = true;
for (const p of P.PAGES) for (const l of p.lines) if (l.t.length > 120 || !/^[\x20-\x7e·]+$/.test(l.t)) fit = false;
ok(fit, 'every line is printable and fits the page (<= 120 characters)');

{
  // typing: deterministic, monotone, complete
  const run = () => {
    const ev = [];
    const pro = new P.Prologue3D((t, a) => ev.push(t + (a === undefined ? '' : ':' + a)));
    let t = 0;
    const snap = [];
    while (!pro.done && t < 120) {
      pro.update(DT);
      t += DT;
      if (Math.floor(t * 60) % 60 === 0) snap.push([pro.page, pro.chars[0], pro.chars[1], +pro.tone.toFixed(3)].join(','));
    }
    return { ev: ev.join('|'), t, snap: snap.join(';'), pro };
  };
  const a = run();
  const b = run();
  ok(a.ev === b.ev && a.snap === b.snap, 'deterministic: two runs give identical events and timelines');
  ok(a.pro.done && !a.pro.active, 'it ends by itself');
  ok(Math.abs(a.t - P.TOTAL) < 0.4, 'and takes the planned time (' + a.t.toFixed(1) + ' s vs ' + P.TOTAL.toFixed(1) + ')');
  ok(/page:0\|page:1\|page:2\|page:3\|page:4\|dark\|cut\|page:5\|end:false/.test(a.ev), 'events in order: pages 0-4, the dark, the cut, the title, the end (' + a.ev + ')');
}
{
  // the typewriter reveals text at the page's speed and never beyond the line
  const pro = new P.Prologue3D();
  pro.update(0.1);
  ok(pro.chars[0] === 0, 'nothing is typed during the lead-in');
  for (let i = 0; i < 60 * 3; i++) pro.update(DT);
  ok(pro.chars[0] > 0 && pro.chars[0] <= P.PAGES[0].lines[0].t.length, 'then it types');
}
{
  // presses: the first finishes the page, the next turns it; skipAll ends it; presses after the end do nothing
  const pro = new P.Prologue3D();
  for (let i = 0; i < 60; i++) pro.update(DT);
  pro.advance();
  const n = P.PAGES[0].lines.reduce((s, l) => s + l.t.length, 0);
  ok(pro.page === 0 && pro.chars.slice(0, 4).reduce((s, c) => s + c, 0) === n, 'a press types the rest of the page at once');
  pro.advance();
  ok(pro.page === 1 && pro.chars[0] === 0, 'the next press turns the page');
  pro.skipAll();
  ok(pro.done && !pro.active, 'skipAll ends it');
  pro.advance();
  pro.update(DT);
  ok(pro.done, 'presses after the end do nothing');
}
{
  // every page can be walked with presses alone, ending with the title
  const ev = [];
  const pro = new P.Prologue3D((t, a) => ev.push(t + (a === undefined ? '' : ':' + a)));
  let n = 0;
  while (!pro.done && n < 100) {
    pro.update(DT);
    pro.advance();
    n++;
  }
  ok(pro.done && n <= 30, 'pressing through takes ' + n + ' presses and ends (not stuck on the cut)');
  ok(ev[ev.length - 1] === 'end:false', 'ending by presses is not a skip');
}
{
  // the tear: the glitch rises through the cut line, the static runs, the depth gauge loses its number
  const pro = new P.Prologue3D();
  let lost = false;
  let maxGlitch = 0;
  let cutAt = -1;
  let t = 0;
  while (!pro.done && t < 120) {
    pro.update(DT);
    t += DT;
    if (pro.page === 4) {
      lost = lost || pro.depthLost;
      maxGlitch = Math.max(maxGlitch, pro.glitch);
      if (pro.cut >= 0 && cutAt < 0) cutAt = t;
    }
  }
  ok(lost && maxGlitch === 1 && cutAt > 0, 'the gauge loses its number, the glitch reaches 1 and the cut happens on the addendum');
}
{
  // the setting: on by default, off only when explicitly off
  const d = SETTINGS_DEFAULTS || {};
  ok(d.storyIntro === true, 'Settings: Story intro is on by default');
  const san = (o) => sanitizeUxSettings(Object.assign({}, o)).storyIntro;
  ok(san({ storyIntro: false }) === false && san({}) === true && san({ storyIntro: 'x' }) === true, 'only an explicit false turns it off');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
