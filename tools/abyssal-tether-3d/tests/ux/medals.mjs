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
  ok(ui._title.name === L.sections[1].name && ui._title.split === 'I · 0:12.9 · GOLD · NEW BEST', `section end: the next title card carries "${ui._title.split}"`);
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
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
