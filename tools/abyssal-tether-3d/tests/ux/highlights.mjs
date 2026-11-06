// RUN HIGHLIGHTS (docs/abyssal-tether-3d/plans/RUN_HIGHLIGHTS.md), Node, no browser: sim/runHighlights.js fed an event stream on a
// real EventBus (the maxima: catch, chain, near misses, the biggest landing survived, top speed, escapes, knockers), the gate (no
// counting outside a run), a death resets nothing and start()'s reset() does, the priority table (best() / all()), the share
// line (stable, ASCII digits, medal glyphs), no per-frame allocation in sample(); UI3D headless (a recording 2D context): the
// death card's stats line, the VR death / victory canvases get one more row, all inside the 1024 x 768 panel at >= 28 px.
//   node highlights.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const { DIFFICULTY, EventBus, SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const H = await import(srcUrl('sim/runHighlights.js'));
const { UI3D } = await import(srcUrl('ui/ui3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};

// ---- the module -----------------------------------------------------------------------------------------------------------
const bus = new EventBus();
let inRun = true;
const hl = new H.RunHighlights(bus, () => inRun);
const feed = () => {
  bus.emit('rope:catch', { speed: 14.2 });
  bus.emit('rope:catch', { speed: 21.4 });
  bus.emit('rope:catch', { speed: 9 });
  bus.emit('flow:end', { n: 3, reason: 'land', scored: true });
  bus.emit('flow:end', { n: 7, reason: 'land', scored: true });
  bus.emit('flow:end', { n: 12, reason: 'death', scored: false }); // a chain cut by a death is not a highlight
  bus.emit('creature:strike', { hit: false, distance: 2.5 });
  bus.emit('creature:strike', { hit: false, distance: 1.2 });
  bus.emit('creature:strike', { hit: false, distance: 9 }); // too far to count
  bus.emit('creature:strike', { hit: true, distance: 0 });
  bus.emit('player:land', { impact: 13.6, lethalRatio: 0.8 });
  bus.emit('player:land', { impact: 30, lethalRatio: 1.7 }); // lethal: not survived
  bus.emit('player:land', { impact: 5, lethalRatio: 0.3 });
  for (let i = 0; i < 60; i++) hl.sample(0, -i * 0.4, 3); // a fall to 24 m/s
};
feed();
ok(Math.abs(hl.maxCatch - 21.4) < 1e-9 && hl.bestChain === 7 && hl.nearMisses === 2 && Math.abs(hl.closestMiss - 1.2) < 1e-9 && Math.abs(hl.biggestLand - 13.6) < 1e-9 && hl.topSpeed > 23.7 && hl.topSpeed < 24, 'the event stream gives the maxima: catch 21.4, chain x7 (a death-cut chain not), 2 near misses (closest 1.2 m; a hit or a far miss not), biggest landing survived 13.6, top speed ~24');
ok(hl.escapes === 0 && hl.knockers === 0 && hl.state().closestMiss === 1.2, 'without the Chase Arc (no chase:lost) and no knocker:throw: zero, nothing breaks');
bus.emit('chase:lost', { duration: 12, closest: 3, knockers: 1, nearMisses: 1 });
bus.emit('chase:lost', {});
bus.emit('knocker:throw', {});
ok(hl.escapes === 2 && hl.knockers === 1, 'chase:lost (with or without its fields) counts an escape; knocker:throw a knocker');
// a death resets nothing; while dead no landing / near miss / speed counts; the respawn re-arms
bus.emit('player:death', { cause: 'impact' });
bus.emit('player:land', { impact: 16, lethalRatio: 0.9 });
bus.emit('creature:strike', { hit: false, distance: 0.5 });
hl.sample(0, -60, 0);
ok(hl.maxCatch > 21 && hl.bestChain === 7 && hl.nearMisses === 2 && hl.biggestLand < 14 && hl.topSpeed < 24, 'a death resets nothing mid-run; nothing counts while dead');
bus.emit('game:respawn', {});
bus.emit('player:land', { impact: 14.5, lethalRatio: 0.95 });
ok(hl.biggestLand === 14.5, 'after the respawn the run goes on counting (14.5 m/s landing)');
inRun = false;
bus.emit('rope:catch', { speed: 40 });
bus.emit('flow:end', { n: 20, reason: 'land' });
ok(hl.maxCatch < 22 && hl.bestChain === 7, 'the gate: nothing counts outside a run (menu, victory)');
inRun = true;

// ---- the priority table ---------------------------------------------------------------------------------------------------
ok(hl.best() === 'Biggest catch: 21 m/s', `best(): the catch first ("${hl.best()}")`);
const all = hl.all();
ok(all.join(' | ') === 'Biggest catch: 21 m/s | Chain x7 | Lost it twice | 2 near misses | Walked off a 15 m/s landing | Top speed 24 m/s | 1 knocker thrown', `all() in priority order: ${all.join(' | ')}`);
{
  const b = new EventBus();
  const h = new H.RunHighlights(b);
  const seq = [];
  seq.push(h.best());
  h.sample(0, -3, 0);
  seq.push(h.best()); // the floor: top speed
  b.emit('flow:end', { n: 2 });
  seq.push(h.best()); // the floor: a short chain beats the speed floor
  b.emit('chase:lost', {});
  seq.push(h.best());
  b.emit('creature:strike', { hit: false, distance: 1 });
  b.emit('creature:strike', { hit: false, distance: 1 });
  seq.push(h.best()); // escapes still outrank near misses
  b.emit('flow:end', { n: 9 });
  seq.push(h.best());
  b.emit('rope:catch', { speed: 11 }); // below the catch's best threshold
  seq.push(h.best());
  ok(seq.join(' | ') === ' | Top speed 3 m/s | Chain x2 | Lost it once | Lost it once | Chain x9 | Chain x9', `the priority table: ${seq.map((s) => s || '(none)').join(' → ')}`);
  ok(H.HIGHLIGHT_TABLE.every((r) => typeof r.line(1) === 'string' && r.best > 0 && r.show > 0), 'every row of the table has a line and thresholds');
}

// ---- the share line -------------------------------------------------------------------------------------------------------
const splits = [{ index: 0, medal: 'gold' }, null, { index: 2, medal: 'gold' }, { index: 3, medal: 'brass' }];
const info = { chapter: 1, label: DIFFICULTY.nightmare.label, time: 702.34, deaths: 3, splits };
const s1 = hl.shareLine(info);
ok(s1 === `THE LANTERN · Ch I · ${DIFFICULTY.nightmare.label} · 11:42.3 · 3 deaths · Biggest catch: 21 m/s · ◆◆◇`, `the share line: "${s1}"`);
ok(hl.shareLine(info) === s1 && !/\d,\d/.test(hl.shareLine({ chapter: 2, label: 'Normal', time: 3725.06, deaths: 1 })), 'stable (same input, same line) and no locale commas');
{
  const h = new H.RunHighlights(new EventBus());
  const x = h.shareLine({ chapter: 2, label: 'Normal', time: 3725.06, deaths: 1, splits: [{ medal: 'silver' }, { medal: null }] });
  ok(x === 'THE LANTERN · Ch II · Normal · 1:02:05.1 · 1 death · ◈·', `chapter II, past the hour, one death, silver / no medal, no highlight: "${x}"`);
  ok(H.clock(0) === '0:00.0' && H.clock(59.96) === '1:00.0' && H.clock(702.34) === '11:42.3', 'clock(): m:ss.d (tenths)');
}

// ---- reset on a new run -----------------------------------------------------------------------------------------------------
hl.reset();
ok(hl.maxCatch === 0 && hl.bestChain === 0 && hl.nearMisses === 0 && hl.biggestLand === 0 && hl.topSpeed === 0 && hl.escapes === 0 && hl.knockers === 0 && hl.best() === '' && hl.all().length === 0, 'reset() (start(): a new run) clears every maximum');

// ---- no per-frame allocation ------------------------------------------------------------------------------------------------
{
  if (global.gc) global.gc();
  for (let i = 0; i < 1000; i++) hl.sample(0.25, -1, 0.5); // warm
  // best of three rounds (a JIT / background compile can land in one); 32 bytes a call would be 64 MB in every round
  let grown = Infinity;
  for (let round = 0; round < 3 && grown >= 3_000_000; round++) {
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2_000_000; i++) {
      if (i & 1) hl.sample(0.25, -1, 0.5);
      else hl.sample(0.5, -2, 0.25);
    }
    grown = Math.min(grown, process.memoryUsage().heapUsed - h0);
  }
  ok(grown < 3_000_000, `sample() does not allocate (heap grew ${grown} bytes over 2M calls)`);
}

// ---- UI3D headless ----------------------------------------------------------------------------------------------------------
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
const L = new Level3D(undefined, 'normal');
const gbus = new EventBus();
const game = { bus: gbus, level: L, settings: Object.assign({}, SETTINGS_DEFAULTS), difficultyKey: 'nightmare', diff: DIFFICULTY.nightmare, chapter: 1, save: { sectionRecords: () => ({}), continueInfo: () => null }, state: 'dead', time: 300, deaths: 3 };
game.highlights = new H.RunHighlights(gbus);
const ui = new UI3D(game);
ui._bindBus();
ui._xr = true;
const paint = (fn) => {
  const ctx = rec2d();
  ui._regions.length = 0;
  fn.call(ui, ctx);
  return { ctx, regions: ui._regions.slice() };
};
// the text may sit at y <= 768 and its glyphs inside: a baseline at least 6 px above the bottom; a region inside the panel
const inPanel = (p) => p.regions.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1024 && r.y + r.h <= 768) && p.ctx.texts.every((t) => t.y > 0 && t.y <= 762);
const glyphs = (p) => p.ctx.texts.every((t) => pxOf(t.font) >= 28);
const overlap = (p) => {
  // no text baseline inside a button region (the row does not run under the buttons)
  return p.ctx.texts.filter((t) => p.regions.some((r) => t.y > r.y + 4 && t.y - pxOf(t.font) * 0.75 < r.y - 2 && Math.abs(t.x - (r.x + r.w / 2)) < r.w / 2));
};
{
  gbus.emit('rope:catch', { speed: 21.2 });
  gbus.emit('flow:end', { n: 7 });
  gbus.emit('creature:strike', { hit: false, distance: 2 });
  gbus.emit('creature:strike', { hit: false, distance: 3 });
  for (const lines of [1, 2]) {
    const msg = lines === 1 ? 'Short.' : 'A message long enough to wrap onto a second line of the death card, as the long ones do.';
    ui._deathInfo = ui._deathFrom({ cause: 'impact', deaths: 3, depthMeters: 120, time: 300, canRespawn: true, message: msg });
    const d = paint(ui._paintDeath);
    const row = d.ctx.texts.find((t) => t.s === 'Biggest catch: 21 m/s');
    ok(!!row && pxOf(row.font) >= 28 && inPanel(d) && glyphs(d) && overlap(d).length === 0 && d.regions.some((r) => r.act === 'continue') && d.regions.some((r) => r.act === 'quit'), `VR death (${lines}-line message): the highlight is one more row (>= 28 px), the buttons and prompt still inside the panel, nothing under a button`);
  }
  const dl = [];
  const vic = (splits, names) => {
    ui._runSplits = splits;
    ui._victoryInfo = Object.assign({ time: 702.34, best: 702.34, isNew: true, recorded: true, difficultyKey: 'nightmare', falls: 3, lowestHp: 0.4, itemsUsed: 2, label: DIFFICULTY.nightmare.label }, names ? { names: 3 } : {});
    const v = paint(ui._paintVictory);
    dl.push(v);
    return v;
  };
  for (const [sp, tag] of [
    [[], 'no splits (the hook)'],
    [[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ index: i, time: 30 + i, medal: i % 2 ? 'gold' : null })), 'eight splits'],
  ]) {
    const v = vic(sp, false);
    const row = v.ctx.texts.find((t) => /Biggest catch: 21 m\/s/.test(t.s));
    ok(!!row && pxOf(row.font) >= 28 && row.s.indexOf('Chain x7') > 0 && inPanel(v) && glyphs(v) && overlap(v).length === 0 && v.regions.some((r) => r.act === 'restart') && v.regions.some((r) => r.act === 'menu'), `VR victory, ${tag}: the highlights row ("${row && row.s}") at >= 28 px, everything inside the panel, nothing under a button`);
  }
  // no highlights module: the cards paint as before (no extra row)
  const keep = game.highlights;
  game.highlights = null;
  ui._runSplits = [];
  const v0 = paint(ui._paintVictory);
  const d0 = paint(ui._paintDeath);
  game.highlights = keep;
  ok(inPanel(v0) && inPanel(d0) && !v0.ctx.texts.some((t) => /catch/.test(t.s)) && v0.regions.find((r) => r.act === 'restart').y === 670, 'without the highlights module the death / victory cards paint as before');
  {
    const bad = dl.flatMap((p) => p.ctx.texts.filter((t) => /catch/.test(t.s) && t.s.length * pxOf(t.font) * 0.56 > 1024 - 64 + 1));
    ok(bad.length === 0, 'the highlight rows are fitted / ellipsized to the panel width');
  }
  const sh = ui._highlightsOf(ui._victoryInfo);
  ok(sh.share.startsWith('THE LANTERN · Ch I · ') && sh.lines[0] === 'Biggest catch: 21 m/s' && ui._highlightBest() === 'Biggest catch: 21 m/s', `UI: the share line from the victory info ("${sh.share}")`);
  ui._xr = false;
  ui._copyResult(); // (no DOM, no clipboard: a no-op, never a throw)
  ok(true, '_copyResult() without a clipboard / DOM does not throw');

  // the DOM victory block on a minimal fake document: the list, the share line, the Copy result button (desktop only)
  const el = (tag) => {
    const n = { tag, className: '', children: [], style: {}, hidden: false, _t: '', on: {} };
    Object.defineProperty(n, 'textContent', {
      get: () => n._t + n.children.map((c) => c.textContent).join(''),
      set: (v) => {
        n._t = String(v);
        n.children.length = 0;
      },
    });
    n.append = (...c) => c.forEach((x) => n.children.push(typeof x === 'string' ? el('#text') : x));
    n.appendChild = (c) => n.children.push(c);
    n.addEventListener = (t, fn) => (n.on[t] = fn);
    n.querySelector = (sel) => n.children.find((c) => c.className === sel.slice(1)) || null;
    return n;
  };
  globalThis.document = { createElement: el };
  const parent = el('div');
  parent.insertBefore = (c) => parent.children.push(c);
  ui.dom = { vNote: Object.assign(el('p'), { parentNode: parent }) };
  ui._fillVictoryHighlights(ui._victoryInfo);
  const d = ui.dom;
  const items = d.vHlList.children.map((c) => c.textContent);
  ok(parent.children[0] === d.vHl && !d.vHl.hidden && items[0] === 'Biggest catch: 21 m/s' && items.includes('Chain x7') && d.vShare.textContent === sh.share && !d.vCopy.hidden, `DOM victory: a Highlights list (${items.join(' / ')}), the share line and the Copy result button`);
  let copied = null;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: (t) => ((copied = t), Promise.resolve()) } }, configurable: true });
  d.vCopy.on.click();
  await Promise.resolve();
  await Promise.resolve();
  ok(copied === sh.share && d.vCopy.querySelector('.btn-label').textContent === 'Copied', 'Copy result writes the share line to the clipboard ("Copied")');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } }, configurable: true });
  d.vCopy.on.click();
  await new Promise((r) => setTimeout(r, 0));
  ok(d.vCopy.querySelector('.btn-label').textContent === 'Select the line to copy', 'a refused clipboard says so (the line stays on the card to select)');
  ui._xr = true;
  ui._fillVictoryHighlights(ui._victoryInfo);
  ok(d.vCopy.hidden && parent.children.length === 1, 'in XR the Copy result button is hidden; refilling reuses the block');
  ui._xr = false;
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
