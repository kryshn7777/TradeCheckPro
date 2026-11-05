// LEVEL_FUN_PLAN P6, the medals UI (Node, no browser): ui/medals.js (thresholds in seconds per section and difficulty from
// data/par-3d.js, the next medal to chase, the rows / tally / section-end line from the schema-3 save) and UI3D headless (a
// recording 2D context stands in for the VR canvases): the 'split' → next title card line (a toast when no card shows, at
// the goal a toast), the Records screen per difficulty (tabs, eight rows, every glyph >= 28 logical px, inside the
// 1024 x 768 panel), the menu's Records button, the victory splits, the six-row Comfort settings page (Wind squalls) still
// inside the panel, and the save round trip (SaveStore sectionSplit → the rows the screen shows). Prints the medal table.
//   node medals.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
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
const { DIFFICULTY, DIFFICULTY_ORDER, EventBus, SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { PAR_3D } = await import(srcUrl('data/par-3d.js'));
const { medalFor } = await import(srcUrl('sim/splits3d.js'));
const M = await import(srcUrl('ui/medals.js'));
const S = await import(srcUrl('meta/save.js'));
const { UI3D } = await import(srcUrl('ui/ui3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};

// ---- ui/medals.js ------------------------------------------------------------------------------------------------------
const L = new Level3D(undefined, 'normal');
const ids = L.sections.map((s) => s.id);
{
  let good = true;
  console.log('  medal thresholds (s): section  par / gold / silver / brass');
  for (const d of DIFFICULTY_ORDER) {
    const row = [];
    for (const id of ids) {
      const par = PAR_3D[d][id];
      const t = M.medalTimes(par);
      row.push(`${id} ${par}/${t[0].time}/${t[1].time}/${t[2].time}`);
      // a split at each shown time earns that medal (the times are rounded down: showing them never overpromises)
      good = good && t.every((m) => medalFor(m.time, par) === m.medal) && t[0].time === Math.floor(par * 10 + 1e-6) / 10;
    }
    console.log(`    ${d}: ${row.join(' · ')}`);
  }
  ok(good, 'medalTimes: gold = par, silver = 1.4 x, brass = 2 x (tenths, rounded down), each earns its medal (sim/splits3d.js medalFor)');
}
ok(
  M.fmtSplit(72.44) === '1:12.4' && M.fmtSplit(9.96) === '0:10.0' && M.fmtSplit(0) === '0:00.0' && M.fmtSplit(NaN) === '—' && M.fmtSplit(600) === '10:00.0',
  'fmtSplit: m:ss.d (1:12.4, 0:10.0, 10:00.0; — for no time)',
);
{
  const n1 = M.nextMedal(null, 14);
  const n2 = M.nextMedal(30, 14); // slower than brass (28)
  const n3 = M.nextMedal(20, 14); // brass (<= 28), not silver (19.6)
  const n4 = M.nextMedal(19, 14); // silver
  const n5 = M.nextMedal(14, 14); // gold
  ok(n1.medal === 'brass' && n1.cut === null && n2.medal === 'brass' && n2.cut === 2 && n3.medal === 'silver' && Math.abs(n3.cut - 0.4) < 1e-9 && n4.medal === 'gold' && n4.cut === 5 && n5 === null && M.nextMedal(10, null) === null, 'nextMedal: the next better medal, its time and the seconds to cut (none at gold or without a par)');
}
ok(
  M.splitLine(0, 72.44, 'silver') === 'I · 1:12.4 · SILVER' && M.splitLine(7, 23.4, null) === 'VIII · 0:23.4' && M.splitLine(2, 17, 'gold', true) === 'III · 0:17.0 · GOLD · NEW BEST',
  'splitLine: "I · 1:12.4 · SILVER" (no medal: the time only; a new best says so)',
);
// SPLIT DELTA against your best: a word and a sign, not colour alone
ok(
  M.fmtDelta(41.2, 43.5) === '-2.3 vs best' && M.fmtDelta(44.6, 43.5) === '+1.1 vs best' && M.fmtDelta(10, 10.04) === '±0.0 vs best' && M.fmtDelta(10, 9.95) === '+0.1 vs best' && M.fmtDelta(9.95, 10) === '-0.1 vs best',
  'fmtDelta: "-2.3 vs best" faster, "+1.1 vs best" slower, rounded to tenths symmetrically, "±0.0 vs best" level',
);
ok(M.fmtDelta(10, null) === null && M.fmtDelta(10, 0) === null && M.fmtDelta(10, undefined) === null && M.fmtDelta(NaN, 10) === null && M.fmtDelta(0, 10) === null, 'fmtDelta: no previous best (the first time) or no time -> null');
ok(
  M.splitLine(2, 41.2, null, false, 43.5) === 'III · 0:41.2 · -2.3 vs best' && M.splitLine(2, 41.2, 'gold', true, 43.5) === 'III · 0:41.2 · -2.3 vs best · GOLD · NEW BEST' && M.splitLine(0, 44.6, 'silver', false, 43.5) === 'I · 0:44.6 · +1.1 vs best · SILVER' && M.splitLine(0, 44.6, 'silver', false, null) === 'I · 0:44.6 · SILVER',
  'splitLine with the previous best: "III · 0:41.2 · -2.3 vs best" (no previous best: unchanged)',
);
ok(M.splitTone('III · 0:41.2 · -2.3 vs best') === 'ahead' && M.splitTone('I · 0:44.6 · +1.1 vs best · SILVER') === 'behind' && M.splitTone('I · 0:44.6 · ±0.0 vs best') === null && M.splitTone('I · 0:44.6 · SILVER') === null, 'splitTone: green ahead / amber behind / neither level or without a delta');

// ---- the save → the rows the Records screen shows -----------------------------------------------------------------------
const store = new S.SaveStore({ primary: new S.MemoryAdapter(), secondary: null, legacyGetItem: null, debounceMs: 10 });
await store.load();
store.sectionSplit({ difficulty: 'normal', section: 's1', time: 13.5, medal: medalFor(13.5, PAR_3D.normal.s1) });
store.sectionSplit({ difficulty: 'normal', section: 's3', time: 30, medal: medalFor(30, PAR_3D.normal.s3) });
store.sectionSplit({ difficulty: 'normal', section: 's3', time: 22, medal: medalFor(22, PAR_3D.normal.s3) });
store.sectionSplit({ difficulty: 'nightmare', section: 's7', time: 100, medal: medalFor(100, PAR_3D.nightmare.s7) });
{
  const rows = M.recordRows(L.sections, store.sectionRecords('normal'), PAR_3D.normal);
  const t = M.medalTally(rows);
  ok(
    rows.length === 8 && rows[0].numeral === 'I' && rows[0].name === L.sections[0].name && rows[0].medal === 'gold' && rows[0].next === null && rows[2].best === 22 && rows[2].medal === 'silver' && rows[2].next.medal === 'gold' && rows[1].best === null && rows[1].next.medal === 'brass',
    `recordRows from the schema-3 save: S1 13.5 s gold, S3 kept the faster 22 s (silver: next gold <= ${M.fmtSplit(rows[2].next.time)}), S2 unplayed (next brass)`,
  );
  ok(t.gold === 1 && t.silver === 1 && t.brass === 0 && t.played === 2 && M.tallyLine(t) === '1 gold · 1 silver · 2 of 8 played' && M.tallyLine(M.medalTally(M.recordRows(L.sections, {}, PAR_3D.abyss))) === '', 'medalTally / tallyLine ("1 gold · 1 silver · 2 of 8 played"; empty when nothing was played)');
  const nm = M.recordRows(L.sections, store.sectionRecords('nightmare'), PAR_3D.nightmare);
  ok(nm[6].best === 100 && nm[6].medal === 'brass' && M.targetText(nm[6]).startsWith('Silver ≤ ') && M.targetText(M.recordRows(L.sections, {}, null)[0]) === '—', 'per difficulty: Nightmare S7 100 s brass (next: silver); Sandbox (no par): no target');
}

// ---- UI3D headless: a recording 2D context for the VR canvases ----------------------------------------------------------
function rec2d() {
  const texts = [];
  const st = { font: '10px sans-serif' };
  const ctx = new Proxy(st, {
    get(t, k) {
      if (k === 'texts') return texts;
      if (k === 'measureText') return (s) => ({ width: String(s).length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1] || 10) * 0.56) });
      if (k === 'fillText') return (s, x, y, maxW) => texts.push({ s: String(s), x, y, font: t.font, maxW, fill: t.fillStyle });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  return ctx;
}
const pxOf = (font) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || 0);
const bus = new EventBus();
const settings = Object.assign({}, SETTINGS_DEFAULTS);
const game = { bus, level: L, settings, difficultyKey: 'normal', diff: DIFFICULTY.normal, save: { sectionRecords: (d) => store.sectionRecords(d), continueInfo: () => null }, state: 'playing', time: 0, deaths: 0 };
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

{
  bus.emit('game:start', {});
  // S1 played whole: the split arrives, then the S2 section:enter (game.js _enterSection emits both in this order)
  bus.emit('split', { index: 0, section: 's1', time: 12.9, par: PAR_3D.normal.s1, medal: medalFor(12.9, PAR_3D.normal.s1), recorded: true, difficulty: 'normal' });
  bus.emit('section:enter', { index: 1, section: L.sections[1], first: true, mode: 'progress' });
  // (the save holds 13.5 s for S1 and the event carries no prevBest here: the UI falls back to reading the save)
  ok(ui._title.name === L.sections[1].name && ui._title.split === 'I · 0:12.9 · -0.6 vs best · GOLD · NEW BEST', `section end: the next title card carries "${ui._title.split}"`);
  const t = paint(function (ctx) {
    this._vr = { titleC: { ctx, cw: 1024, ch: 288, tex: {} } };
    this._paintTitle();
  });
  ok(t.ctx.texts.some((x) => x.s === ui._title.split && x.y < 288 && pxOf(x.font) >= 28), 'VR: the split line is drawn on the title card canvas (inside its 288 px, >= 28 px): no new mesh');
  // a section re-entered (not first: no card) shows the line as a toast
  bus.emit('split', { index: 1, section: 's2', time: 40, par: PAR_3D.normal.s2, medal: medalFor(40, PAR_3D.normal.s2), recorded: true, difficulty: 'normal' });
  bus.emit('section:enter', { index: 2, section: L.sections[2], first: false, mode: 'progress' });
  ok(ui._toast.text === 'II · 0:40.0' && ui._toast.t > 0, `no title card: the split shows as a toast ("${ui._toast.text}")`);
  // the goal: S8's split is a toast at once
  bus.emit('split', { index: 7, section: 's8', time: 22, par: PAR_3D.normal.s8, medal: medalFor(22, PAR_3D.normal.s8), recorded: true, difficulty: 'normal' });
  ok(ui._toast.text.startsWith('VIII · 0:22.0 · GOLD'), `the goal: S8's split toasts at once ("${ui._toast.text}")`);
  // Sandbox: no medal, never recorded
  bus.emit('split', { index: 2, section: 's3', time: 9, par: null, medal: null, recorded: false, difficulty: 'sandbox' });
  ok(ui._pendingSplit && ui._pendingSplit.line === 'III · 0:09.0', 'Sandbox: the time only (no medal, not recorded)');
  const v = paint(function (ctx) {
    this._victoryInfo = { time: 200, best: 200, isNew: true, recorded: true, difficultyKey: 'normal', falls: 0, lowestHp: 0.8, itemsUsed: 1, label: 'Normal' };
    this._paintVictory(ctx);
  });
  ok(ui._runSplits.filter(Boolean).length === 4 && v.regions.some((r) => r.act === 'restart') && v.regions.some((r) => r.act === 'menu') && inPanel(v) && glyphs(v) && v.ctx.texts.some((x) => x.s === '0:12.9'), 'VR victory: this run\'s splits in a grid, the teaser and both buttons still inside the panel, every glyph >= 28 px');
  bus.emit('game:restart', {});
  ok(ui._runSplits.length === 0 && ui._pendingSplit === null, 'a new run forgets the last run\'s splits');
}
{
  const shots = DIFFICULTY_ORDER.map((d) => {
    ui._action('rec-tab', { diff: d }, true);
    return [d, paint(ui._paintRecords)];
  });
  const good = shots.every(([, p]) => p.regions.filter((r) => r.act === 'rec-tab').length === 3 && p.regions.some((r) => r.act === 'back') && inPanel(p) && glyphs(p));
  const n = shots[0][1].ctx.texts;
  ok(good && n.some((x) => x.s === 'I') && n.some((x) => x.s === 'VIII') && n.some((x) => x.s === '0:13.5') && n.some((x) => x.s === 'Gold') && n.some((x) => x.s === '1 gold · 1 silver · 2 of 8 played'), 'VR Records: difficulty tabs + Back, eight rows (I..VIII: best, medal, next), the tally; inside the panel, every glyph >= 28 px');
  ok(ui._recDiff === 'abyss' && shots[2][1].ctx.texts.some((x) => /No whole section played on Abyss/.test(x.s)), 'a tab switches the difficulty shown (Abyss: nothing played yet)');
  game.state = 'menu';
  const menu = paint(ui._paintMenu);
  const rb = menu.regions.find((r) => r.act === 'records');
  ok(!!rb && inPanel(menu) && glyphs(menu) && menu.regions.filter((r) => ['settings', 'controls', 'about', 'records', 'sandbox'].indexOf(r.act) >= 0).length === 5, 'VR menu: a Records button (the best times ride on it) beside Settings / Controls / About, inside the panel');
  ui._action('records', {}, true);
  ok(ui.current === 'records', 'the Records action opens its screen (here show() only records it: no DOM before init)');
  ui._vrTab = 0;
  ui._vrSetPage = 0;
  const set = paint(ui._paintSettings);
  ok(set.regions.some((r) => r.act === 'set' && r.key === 'windSqualls') && set.regions.some((r) => r.act === 'height-page') && inPanel(set) && glyphs(set), 'VR Settings › Comfort: six rows (Wind squalls On / Off) and the Player height link still fit the panel');
  ui._vrTab = 1;
  const disp = paint(ui._paintSettings);
  ok(disp.regions.some((r) => r.act === 'set' && r.key === 'bloodWriting') && disp.regions.some((r) => r.act === 'set' && r.key === 'livingFlame') && disp.regions.some((r) => r.act === 'calibrate') && inPanel(disp) && glyphs(disp), 'VR Settings › Display: seven rows (Blood writing, Living flame On / Off) and the Brightness link still fit the panel');
  ui._vrTab = 3;
  const acc = paint(ui._paintSettings);
  ok(acc.regions.some((r) => r.act === 'set' && r.key === 'ghost') && acc.regions.some((r) => r.act === 'reset-settings') && inPanel(acc) && glyphs(acc), 'VR Settings › Access: the Ghost lantern On / Off row and Reset still fit the panel');
  ui._vrTab = 0;
}

// ---- SPLIT DELTA: the listener order (meta/save.js binds its 'split' listener at boot, BEFORE the UI) ------------------------
{
  const bus2 = new EventBus();
  const store2 = new S.SaveStore({ primary: new S.MemoryAdapter(), secondary: null, legacyGetItem: null, debounceMs: 10 });
  await store2.load();
  store2.sectionSplit({ difficulty: 'normal', section: 's4', time: 50, medal: null });
  // SaveService._wire's listener, bound first (game.js awaits the save before it builds the UI)
  bus2.on('split', (e) => e.recorded && store2.sectionSplit({ difficulty: e.difficulty, section: e.section, time: e.time, medal: e.medal }));
  const game2 = { bus: bus2, level: L, settings, difficultyKey: 'normal', diff: DIFFICULTY.normal, save: { sectionRecords: (d) => store2.sectionRecords(d), continueInfo: () => null }, state: 'playing', time: 0, deaths: 0 };
  const ui2 = new UI3D(game2);
  ui2._bindBus();
  ui2._xr = true;
  // game.js _split: reads the previous best into the event, then emits
  const emitSplit = (time) => {
    const r = store2.sectionRecords('normal').s4;
    bus2.emit('split', { index: 3, section: 's4', time, par: PAR_3D.normal.s4, medal: medalFor(time, PAR_3D.normal.s4), recorded: true, difficulty: 'normal', prevBest: r && r.best > 0 ? r.best : null });
    bus2.emit('section:enter', { index: 4, section: L.sections[4], first: true, mode: 'progress' });
    ui2._lastTitle.text = '';
    return ui2._title.split;
  };
  const a = emitSplit(45);
  ok(/^IV · 0:45\.0 · -5\.0 vs best\b/.test(a) && /NEW BEST$/.test(a) && store2.sectionRecords('normal').s4.best === 45, `the save kept the new best first, the card still reads the delta against the OLD best ("${a}")`);
  const t = paint(function (ctx) {
    ui2._vr = { titleC: { ctx, cw: 1024, ch: 288, tex: {} } };
    ui2._paintTitle.call(ui2);
  });
  ok(t.ctx.texts.some((x) => x.s === a && x.fill === M.AHEAD_COLOR), 'VR: a faster split is drawn green on the title card (the sign and the word say it too)');
  const b = emitSplit(46.1);
  ok(/^IV · 0:46\.1 · \+1\.1 vs best/.test(b) && !/NEW BEST/.test(b) && M.splitTone(b) === 'behind', `a slower split reads "+1.1 vs best" in amber ("${b}")`);
  // the old path (no prevBest in the event) shows why the event carries it: the save already holds this very split
  bus2.emit('split', { index: 3, section: 's4', time: 44, par: PAR_3D.normal.s4, medal: null, recorded: true, difficulty: 'normal' });
  ok(!/-1\.0 vs best/.test(ui2._pendingSplit.line), `without prevBest the UI would read the overwritten best ("${ui2._pendingSplit.line}"): game.js must send it`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
