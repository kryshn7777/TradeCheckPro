// SECTION TRIALS (docs/abyssal-tether-3d/plans/SECTION_TRIALS.md), Node, no browser: meta/trials.js (the key per chapter and
// difficulty, the fixed supply seed, the result maths and medals against par, a worse time never overwrites, Untouched is an OR,
// storage failures swallowed), trialGlue.js on a real EventBus (the clock held at 0 until the first input / movement, damage
// clears Untouched, the next section ends the trial, a death fails it, the card), game.js routing through the real Game3D
// prototype (R / Again / rise again re-run the trial, the fixed seed, no v1 stats, the section bookkeeping skipped), a PROFILE
// SNAPSHOT byte-identical before and after a simulated trial (meta/save.js SaveService + SaveStore on a MemoryAdapter, the real
// bus events of a trial; the same events outside a trial do change it), and UI3D headless (a recording 2D context): the VR
// Records' Practise buttons on reached rows only, the trial card (done / fell), all inside the 1024 x 768 panel at >= 28 px.
//   node trials.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import fs from 'node:fs';
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL, SRC_DIR } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const T = await import(srcUrl('meta/trials.js'));
// the v1 Storage (sim/config3d.js) and the trial bests both read localStorage: an in-memory one, so this test can watch it
const LS = T.memoryStorage();
globalThis.localStorage = LS;
const { DIFFICULTY, DIFFICULTY_ORDER, EventBus, SETTINGS_DEFAULTS, U } = await import(srcUrl('sim/config3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { PAR_3D } = await import(srcUrl('data/par-3d.js'));
const { medalFor } = await import(srcUrl('sim/splits3d.js'));
const { medalTimes, fmtSplit } = await import(srcUrl('ui/medals.js'));
const S = await import(srcUrl('meta/save.js'));
const { TrialGlue } = await import(srcUrl('trialGlue.js'));
const { trialCard, trialRows } = await import(srcUrl('ui/trialCard.js'));
const { UI3D } = await import(srcUrl('ui/ui3d.js'));
const { Game3D } = await import(srcUrl('game.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};

// ---- meta/trials.js ------------------------------------------------------------------------------------------------------
ok(
  T.trialKey(1, 'normal') === 'abyssalTether3d.v2.trials.ch1.normal' && T.trialKey(2, 'abyss') === 'abyssalTether3d.v2.trials.ch2.abyss' && T.trialKey('2', 'nightmare') === 'abyssalTether3d.v2.trials.ch2.nightmare' && T.trialKey(7, 'normal') === 'abyssalTether3d.v2.trials.ch1.normal',
  'trialKey: abyssalTether3d.v2.trials.ch<N>.<diff> (chapter 1 or 2)',
);
ok(T.trialSeed(0) === 0x7a1a1 && T.trialSeed(3) === 0x7a1a1 + 3 && T.trialSeed(-4) === 0x7a1a1, 'trialSeed: the fixed supply seed 0x7a1a1 + section index');
{
  const par = PAR_3D.normal.s3; // 17 s
  const mt = medalTimes(par);
  const g = T.trialResult({ time: mt[0].time, par, prevBest: 20, untouched: true });
  const s = T.trialResult({ time: mt[1].time, par, prevBest: 20 });
  const b = T.trialResult({ time: mt[2].time, par, prevBest: 20 });
  const n = T.trialResult({ time: par * 2.5, par, prevBest: 20 });
  ok(g.medal === 'gold' && s.medal === 'silver' && b.medal === 'brass' && n.medal === null && [g, s, b, n].every((r) => r.medal === medalFor(r.time, par)), 'trialResult: the medal against par is splits3d medalFor (gold / silver / brass / none at each shown time)');
  ok(g.delta === Math.round((mt[0].time - 20) * 100) / 100 && g.delta < 0 && g.isNew && g.deltaText === `-${(20 - mt[0].time).toFixed(1)} vs best` && n.delta > 0 && !n.isNew && n.deltaText.startsWith('+'), `trialResult: the delta vs the trial best (${g.deltaText} / ${n.deltaText}); faster is a new best`);
  const first = T.trialResult({ time: 30, par: null, prevBest: null, untouched: true });
  ok(first.isNew && first.delta === null && first.deltaText === null && first.medal === null && first.untouched && g.untouched && !s.untouched, 'trialResult: the first time is new (no delta); no par, no medal; Untouched only when no damage');
  const none = T.trialResult({ time: 0, par, untouched: true });
  ok(none.time === null && none.medal === null && !none.isNew && !none.untouched, 'trialResult: no time, no result');
}
{
  const st = T.memoryStorage();
  const a = T.saveTrialBest(1, 'normal', 's3', 25, false, st);
  const b = T.saveTrialBest(1, 'normal', 's3', 30, true, st); // worse, but untouched
  const c = T.saveTrialBest(1, 'normal', 's3', 22, false, st);
  const r = T.loadTrials(1, 'normal', st).s3;
  ok(a.isNew && a.saved && !b.isNew && b.best === 25 && b.previous === 25 && c.isNew && c.previous === 25 && r.best === 22 && r.runs === 3, 'saveTrialBest: a worse time never overwrites the best (25 -> 30 kept 25 -> 22)');
  ok(r.untouched === true && b.untouched && c.untouched, 'saveTrialBest: Untouched is an OR (a clean finish once stays)');
  T.saveTrialBest(1, 'nightmare', 's3', 40, false, st);
  T.saveTrialBest(2, 'normal', 's3', 50, false, st);
  ok(T.loadTrials(1, 'nightmare', st).s3.best === 40 && T.loadTrials(2, 'normal', st).s3.best === 50 && T.loadTrials(1, 'normal', st).s3.best === 22 && T.loadTrials(1, 'abyss', st).s3 === undefined && st.size === 3, 'per chapter and difficulty: one key each, kept apart');
  ok(!T.saveTrialBest(1, 'normal', 'S 3!', 10, false, st).saved && !T.saveTrialBest(1, 'normal', 's3', -1, false, st).saved && !T.saveTrialBest(1, 'normal', 's3', NaN, false, st).saved, 'saveTrialBest: a bad section id or time is refused');
}
{
  const bad = { getItem: () => { throw new Error('quota'); }, setItem: () => { throw new Error('quota'); } };
  let threw = false;
  let r1, r2, r3, r4;
  try {
    r1 = T.loadTrials(1, 'normal', bad);
    r2 = T.saveTrialBest(1, 'normal', 's1', 12, true, bad);
    const half = T.memoryStorage();
    half.setItem(T.trialKey(1, 'normal'), '{not json');
    r3 = T.loadTrials(1, 'normal', half);
    const ro = { getItem: () => null, setItem: () => { throw new Error('read only'); } };
    r4 = T.saveTrialBest(1, 'normal', 's1', 12, true, ro);
  } catch {
    threw = true;
  }
  ok(!threw && JSON.stringify(r1) === '{}' && r2.saved === false && JSON.stringify(r3) === '{}' && r4.saved === false && r4.isNew, 'storage failures swallowed (getItem / setItem throw, garbage JSON): nothing kept, nothing thrown');
}

// ---- trialGlue.js on a real bus --------------------------------------------------------------------------------------------
const L = new Level3D(undefined, 'normal');
function fakeGame(storage) {
  const bus = new EventBus();
  const shows = [];
  const g = {
    bus,
    state: 'playing',
    time: 0,
    trial: null,
    level: L,
    player: { x: 0, y: -40, z: 0 },
    checkpoint: { x: 0, y: -40, z: 0, index: 2 },
    ui: { show: (n, i) => shows.push([n, i]), hideHint() {} },
    shows,
    _setState(s) {
      this.state = s;
    },
  };
  g._trials = new TrialGlue(g);
  g._trials.storage = storage;
  return g;
}
const idle = { move: { x: 0, z: 0 }, jumpPressed: false, reel: 0, hands: { left: { pressed: false, held: false }, right: { pressed: false, held: false } } };
const walk = { move: { x: 0, z: -1 }, jumpPressed: false, reel: 0, hands: { left: { pressed: false, held: false }, right: { pressed: false, held: false } } };
{
  const st = T.memoryStorage();
  const g = fakeGame(st);
  const ends = [];
  g.bus.on('trial:end', (e) => ends.push(e));
  g.trial = T.newTrial(2, 'normal', 1, 's3');
  for (let k = 0; k < 90; k++) {
    g.time += 1 / 60;
    g._trials.tick(idle);
  }
  const held = g.time === 0 && !g.trial.armed;
  g.time += 1 / 60;
  g._trials.tick(walk);
  for (let k = 0; k < 600; k++) {
    g.time += 1 / 60;
    g._trials.tick(idle);
  }
  ok(held && g.trial.armed && Math.abs(g.trial.t - 10) < 0.02 && Math.abs(g.time - 10) < 0.02, `the clock waits at 0 through 1.5 s of standing still, arms on the first input, then counts (${g.trial.t.toFixed(2)} s)`);
  const g2 = fakeGame(st);
  g2.trial = T.newTrial(0, 'normal', 1, 's1');
  g2.time = 1;
  g2.player.y -= 2; // a fall off the checkpoint arms it too
  g2._trials.tick(idle);
  ok(g2.trial.armed, 'movement off the checkpoint (a fall, a push) arms the clock without input');
  g.bus.emit('health:damage', { amount: 0.1 });
  ok(g.trial.untouched === false, 'health:damage clears Untouched');
  ok(!g._trials.sectionEntered(2, 'progress') && !g._trials.sectionEntered(3, 'warp') && !g._trials.sectionEntered(1, 'respawn') && !g.trial.done, 'the trial runs on through a warp, a respawn or the same section');
  ok(g._trials.sectionEntered(3, 'progress') && g.trial.done && g.state === 'dead' && g._deathShown === true && g.shows.some(([n, i]) => n === 'death' && i && i.trial), "the next section in 'progress' ends it: the run freezes on the card (the death screen in trial mode)");
  const r = g.trial.result;
  ok(ends.length === 1 && ends[0].idx === 2 && Math.abs(ends[0].time - 10) < 0.02 && ends[0].medal === medalFor(r.time, PAR_3D.normal.s3) && ends[0].isNew && !ends[0].untouched && !ends[0].failed && T.loadTrials(1, 'normal', st).s3.best === r.time, `trial:end { time ${r.time.toFixed(2)}, medal ${ends[0].medal}, new, not untouched } and the trial best kept`);
  // a death
  const g3 = fakeGame(st);
  const e3 = [];
  g3.bus.on('trial:end', (e) => e3.push(e));
  g3.trial = T.newTrial(2, 'normal', 1, 's3');
  g3._trials.tick(walk);
  g3.time = 4;
  g3._trials.tick(idle);
  g3._trials.died('fall');
  ok(g3.trial.done && g3.trial.failed && e3.length === 1 && e3[0].failed && e3[0].time == null && T.loadTrials(1, 'normal', st).s3.runs === 1 && trialCard(g3.trial).title === 'Fell at 0:04.0', 'a death fails the attempt: nothing kept, the card reads "Fell at 0:04.0"');
  // the card lines
  const c = trialCard(g.trial, 'The Gallery');
  ok(c.kicker === 'Section trial · III · The Gallery' && c.title === fmtSplit(r.time) && c.line2.includes('FIRST TIME') && c.tone === 'plain',`the card: "${c.kicker}" / "${c.title}" / "${c.line1}" / "${c.line2}"`);
  const g4 = fakeGame(st);
  g4.trial = T.newTrial(2, 'normal', 1, 's3');
  g4._trials.tick(walk);
  g4.time = 9;
  g4._trials.tick(idle);
  g4._trials.sectionEntered(3, 'progress');
  const c4 = trialCard(g4.trial);
  ok(/^-1\.0 vs best · NEW BEST · UNTOUCHED$/.test(c4.line2) && c4.tone === 'new' && c4.medal === 'gold' && c4.line1 === 'Gold · par 0:17.0', `a faster clean run: "${c4.line1}" / "${c4.line2}"`);
}

// ---- game.js: the real Game3D prototype on stubs ---------------------------------------------------------------------------
{
  const P = Game3D.prototype;
  const calls = [];
  const stub = Object.assign(Object.create(P), { trial: T.newTrial(4, 'nightmare', 1, 's5'), state: 'dead', victoryT: -1, player: {}, startTrial: (...a) => (calls.push(a), true), diff: DIFFICULTY.nightmare, bus: new EventBus() });
  P.restart.call(stub);
  P.respawn.call(stub);
  stub.state = 'paused';
  P.respawn.call(stub);
  ok(calls.length === 3 && calls.every((a) => a[0] === 'nightmare' && a[1] === 4 && a[2] === 1), 'game.js: R (restart), Again / rise again (respawn from the card) and Restart section (paused) all re-run startTrial with the same args');
  // v1 stats and depth: untouched by a trial
  const before = LS.size;
  const s2 = Object.assign(Object.create(P), { trial: T.newTrial(1, 'normal'), difficultyKey: 'normal', deepest: -200, _fault: () => {} });
  P._bumpStat.call(s2, 'runs.normal');
  P._recordDepth.call(s2);
  const s2b = Object.assign(Object.create(P), { trial: null, difficultyKey: 'normal', deepest: -200, _fault: () => {} });
  P._bumpStat.call(s2b, 'runs.sandbox');
  ok(LS.size === before + 1 && LS.getItem('abyssalTether3d.v1.runs.normal') === null,'game.js: _bumpStat / _recordDepth write nothing during a trial (the v1 stats)');
  // the fixed supply seed
  const seeds = [];
  const s3 = Object.assign(Object.create(P), {
    trial: T.newTrial(5, 'normal'),
    bag: { reset() {}, seed() {}, snapshot() {} },
    settings: Object.assign({}, SETTINGS_DEFAULTS),
    _kn: {},
    knocker: null,
    pickups: { setLevel() {}, reset: (s) => seeds.push(s), snapshot() {} },
    level: L,
    player: {},
    difficultyKey: 'normal',
  });
  P._resetBag.call(s3);
  P._resetBag.call(s3);
  ok(seeds.length === 2 && seeds[0] === 0x7a1a1 + 5 && seeds[1] === seeds[0] && LS.getItem('abyssalTether3d.v1.supplyRuns') === null, 'game.js: a trial seeds the supplies 0x7a1a1 + section, every attempt, and leaves the supply-run counter alone');
  // the next section ends the trial before the section bookkeeping (no checkpoint, no split, no title card)
  const evs = [];
  const bus = new EventBus();
  ['section:enter', 'checkpoint', 'split'].forEach((t) => bus.on(t, () => evs.push(t)));
  const s4 = Object.assign(Object.create(P), { level: L, bus, trial: T.newTrial(3, 'normal', 1, 's4'), sectionIndex: 3, _seen: [], splits: null, _creatureSection: 3, checkpoint: { index: 3 }, diff: DIFFICULTY.normal });
  s4._trials = { sectionEntered: (i, m) => m === 'progress' && i > 3 };
  P._enterSection.call(s4, 4, 'progress');
  ok(s4.sectionIndex === 3 && evs.length === 0, 'game.js: _enterSection(idx + 1, progress) ends the trial before any section:enter / checkpoint / split');
  const src = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  ok(/startTrial\(diffKey, idx, chapter\) \{/.test(src) && /this\._warp\(i\)/.test(src) && /trial: \(i, diff\) =>/.test(src) && /quitToMenu\(\) \{\n[^\n]*\n\s*this\.trial = null;/.test(src) && /if \(!this\._trialStarting\) this\.trial = null;/.test(src), 'game.js: startTrial (start + _warp), AT3D.debug.trial(i), the menu and any other start clear game.trial');
  ok(/const on = !!g && !this\.trial && /.test(src) && /_beginVictory\(\) \{\n\s*if \(this\.trial && this\._trials && this\._trials\.complete\(\)\) return;/.test(src), 'game.js: no ghost in a trial; the last section ends at the goal (no victory, no ghost save)');
}

// ---- PROFILE SNAPSHOT: a trial leaves the save byte-identical ------------------------------------------------------------
{
  let clock = 1_700_000_000_000;
  const mem = new S.MemoryAdapter();
  const store = new S.SaveStore({ primary: mem, secondary: null, legacyGetItem: null, debounceMs: 0, now: () => clock });
  const bus = new EventBus();
  const g = {
    bus,
    trial: null,
    time: 0,
    deaths: 0,
    deepest: -12,
    sectionIndex: 0,
    difficultyKey: 'normal',
    diff: DIFFICULTY.normal,
    checkpoint: { x: 0, y: -12, z: 0, yaw: 0, index: 0 },
    objectives: null,
    level: L,
    _runActive: () => true,
    _fault: (n, e) => {
      throw e;
    },
  };
  const svc = new S.SaveService(g, { store, legacyStorage: null });
  await svc.init();
  // a real run first: started, a checkpoint, a split, a death (the save has something to lose)
  bus.emit('game:start', { difficulty: 'normal' });
  g.time = 20;
  g.sectionIndex = 1;
  g.checkpoint = { x: 1, y: -60, z: 2, yaw: 0, index: 1 };
  bus.emit('checkpoint', { index: 1 });
  bus.emit('split', { index: 0, section: 's1', time: 15, medal: 'silver', recorded: true, difficulty: 'normal' });
  bus.emit('player:death', { cause: 'fall' });
  await svc.flush();
  clock += 60_000;
  const snap = JSON.stringify(store.profile);
  const rec = JSON.stringify(mem.record);
  const writes = mem.writes;
  // the trial: what game.js and trialGlue.js emit, with game.trial set (startTrial sets it before start())
  const st = T.memoryStorage();
  g._trials = new TrialGlue(g);
  g._trials.storage = st;
  g.state = 'playing';
  g.ui = null;
  g._setState = (s) => (g.state = s);
  g.player = { x: 1, y: -60, z: 2 };
  for (let attempt = 0; attempt < 2; attempt++) {
    g.trial = T.newTrial(2, 'normal', 1, 's3');
    g.time = 0;
    g.state = 'playing';
    bus.emit('game:start', { difficulty: 'normal' });
    bus.emit('section:enter', { index: 2, mode: 'warp' });
    g._trials.tick(walk);
    g.time = 12.5;
    g._trials.tick(idle);
    bus.emit('health:damage', { amount: 0.2 });
    bus.emit('objective:done', {});
    bus.emit('objective:progress', {});
    if (attempt === 0) {
      bus.emit('player:death', { cause: 'creature' });
      g._trials.died('creature');
    } else {
      bus.emit('checkpoint', { index: 3 });
      bus.emit('split', { index: 2, section: 's3', time: 12.5, medal: 'gold', recorded: true, difficulty: 'normal' });
      g._trials.sectionEntered(3, 'progress');
      bus.emit('game:victory', { time: 12.5, difficultyKey: 'normal', deaths: 0, deepestMeters: 100 });
    }
    bus.emit('game:pause', {});
    bus.emit('game:continue', { info: { time: 3 } });
  }
  g.trial = null; // quitToMenu clears it before game:menu
  bus.emit('game:menu', {});
  await svc.flush();
  await svc.flush({ sync: true });
  ok(JSON.stringify(store.profile) === snap && JSON.stringify(mem.record) === rec && mem.writes === writes, `PROFILE SNAPSHOT: byte-identical (${snap.length} bytes, ${writes} writes) after two trial attempts (a death, a finish with a split, a checkpoint, a pause, a victory event)`);
  ok(T.loadTrials(1, 'normal', st).s3.best === 12.5 && st.size === 1, 'the trial best went to its own key only');
  // the control: the same events outside a trial DO change the profile (the snapshot test can fail)
  bus.emit('game:start', { difficulty: 'normal' });
  bus.emit('player:death', { cause: 'creature' });
  await svc.flush();
  ok(JSON.stringify(store.profile) !== snap, 'control: the same events outside a trial change the profile');
  svc.dispose();
}

// ---- UI3D headless ---------------------------------------------------------------------------------------------------------
function rec2d() {
  const texts = [];
  const st = { font: '10px sans-serif' };
  const ctx = new Proxy(st, {
    get(t, k) {
      if (k === 'texts') return texts;
      if (k === 'measureText') return (s) => ({ width: String(s).length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1] || 10) * 0.56) });
      if (k === 'fillText') return (s, x, y, maxW) => texts.push({ s: String(s), x, y, font: t.font, maxW, align: t.textAlign });
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
{
  const store = new S.SaveStore({ primary: new S.MemoryAdapter(), secondary: null, legacyGetItem: null, debounceMs: 10 });
  await store.load();
  store.sectionSplit({ difficulty: 'normal', section: 's1', time: 13.5, medal: 'gold' });
  store.sectionSplit({ difficulty: 'normal', section: 's3', time: 22, medal: 'silver' });
  const st = T.memoryStorage();
  T.saveTrialBest(1, 'normal', 's5', 30, true, st);
  const calls = [];
  const bus = new EventBus();
  const game = {
    bus,
    level: L,
    settings: Object.assign({}, SETTINGS_DEFAULTS),
    difficultyKey: 'normal',
    diff: DIFFICULTY.normal,
    chapter: 1,
    save: { sectionRecords: (d) => store.sectionRecords(d), records: (d) => store.records(d), continueInfo: () => null },
    state: 'menu',
    time: 0,
    deaths: 0,
    startTrial: (d, i) => (calls.push([d, i]), (game.state = 'playing'), true),
  };
  const ui = new UI3D(game);
  ui._bindBus();
  ui._xr = true;
  ui._trialStorage = st;
  const paint = (fn) => {
    const ctx = rec2d();
    ui._regions.length = 0;
    fn.call(ui, ctx);
    return { ctx, regions: ui._regions.slice() };
  };
  const inPanel = (p) => p.regions.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1024 && r.y + r.h <= 768) && p.ctx.texts.every((t) => t.y > 0 && t.y <= 768);
  const glyphs = (p) => p.ctx.texts.every((t) => pxOf(t.font) >= 28);
  // reached: S1, S3 (splits), S5 (a trial time); everything above 'deepest' on any timed difficulty
  const rows = ui._recordRowsFor('normal');
  const tr = trialRows(rows, L.sections, game.save, 'normal', 1, st);
  ok(tr[0].reached && !tr[1].reached && tr[2].reached && tr[4].reached && tr[4].best === 30 && tr[4].untouched && !tr[7].reached, 'trialRows: reached = S1, a split or a trial time on this difficulty (S2 / S8 not yet)');
  store.depthReached('nightmare', U.depthMeters(L.sections[6].yTop) + 2);
  const tr2 = trialRows(rows, L.sections, game.save, 'normal', 1, st);
  ok(tr2[5].reached && tr2[6].reached && !tr2[7].reached, 'trialRows: a section whose top is above the deepest point on any timed difficulty is reached (S7 by Nightmare depth)');
  ui._action('rec-tab', { diff: 'normal' }, true);
  const p = paint(ui._paintRecords);
  const pr = p.regions.filter((r) => r.act === 'trial');
  const labels = p.ctx.texts.filter((t) => t.s === 'PRACTISE');
  const rowTexts = p.ctx.texts.filter((t) => t.y > 210 && t.y < 690 && t.s !== 'PRACTISE');
  const right = rowTexts.every((t) => t.align === 'center' || t.x + t.s.length * pxOf(t.font) * 0.56 <= 804);
  ok(pr.length === 7 && pr.every((r) => r.diff === 'normal' && r.w >= 160 && r.h >= 44) && labels.length === 7 && inPanel(p) && glyphs(p) && right, `VR Records: a Practise button on the 7 reached rows only (x 804..980, >= 28 px), the other columns end left of it; inside the panel`);
  const sec = pr[2].section;
  ui._activateRegion(pr[2], pr[2].x + 4);
  ok(calls.length === 1 && calls[0][0] === 'normal' && calls[0][1] === Number(sec), `pointing + trigger on a Practise row calls game.startTrial('normal', ${sec})`);
  // the trial card: done, and fell
  game.state = 'dead';
  game.trial = T.newTrial(2, 'normal', 1, 's3');
  Object.assign(game.trial, { done: true, t: 16.4, attempt: 3, result: Object.assign(T.trialResult({ time: 16.4, par: PAR_3D.normal.s3, prevBest: 18, untouched: true }), { best: 16.4 }) });
  const d1 = paint(ui._paintDeath);
  const need = (p2, acts) => acts.every((a) => p2.regions.some((r) => r.act === a));
  ok(need(d1, ['continue', 'trial-records', 'quit']) && inPanel(d1) && glyphs(d1) && d1.ctx.texts.some((t) => t.s === '0:16.4') && d1.ctx.texts.some((t) => /^Gold · par 0:17\.0$/.test(t.s)) && d1.ctx.texts.some((t) => t.s === '-1.6 vs best · NEW BEST · UNTOUCHED') && d1.ctx.texts.some((t) => t.s === 'AGAIN'), 'VR trial card (the death panel in trial mode): 0:16.4, Gold · par, "-1.6 vs best · NEW BEST · UNTOUCHED", Again / Records / Menu; inside, >= 28 px');
  game.trial = T.newTrial(2, 'normal', 1, 's3');
  Object.assign(game.trial, { done: true, failed: true, t: 7.2, result: { time: null, par: 17, best: 16.4, at: 7.2 } });
  const d2 = paint(ui._paintDeath);
  ok(need(d2, ['continue', 'trial-records', 'quit']) && inPanel(d2) && glyphs(d2) && d2.ctx.texts.some((t) => t.s === 'Fell at 0:07.2') && d2.ctx.texts.some((t) => t.s === 'Trial best 0:16.4'), 'VR trial card after a death: "Fell at 0:07.2", the trial best; inside, >= 28 px');
  game.trial = null;
  const d3 = paint(ui._paintDeath);
  ok(need(d3, ['continue', 'restart', 'quit']) && !d3.regions.some((r) => r.act === 'trial-records'), 'without a trial the death panel is the death panel (Continue / Restart descent / Menu)');
  ok(DIFFICULTY_ORDER.length === 3, '(three timed difficulties on the Records tabs)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
