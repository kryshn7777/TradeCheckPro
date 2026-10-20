// Node tests for meta/save.js (E05): schema, migration from today's Storage keys, corrupted records, adapters,
// debounced writes, newest-wins load, never-throw guarantees, SaveService wiring on a fake game bus.
// Run: node tools/abyssal-tether-3d/tests/release/test-save.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';

const S = await import(srcUrl('meta/save.js'));
const { EventBus } = await import(srcUrl('sim/config3d.js'));

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL:', m);
  }
};
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), _m: m };
}
const v1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [S.V1_PREFIX + k, JSON.stringify(v)]));

// ---- fresh profile ----------------------------------------------------------------------------------------------
{
  const p = S.defaultProfile(1000);
  ok(p.schema === 2 && p.createdAt === 1000 && p.run === null && p.chapters.ch1 && p.totals.deaths === 0, 'default profile shape');
}

// ---- migration from today's v1 keys --------------------------------------------------------------------------------
{
  const ls = memStorage(
    v1({
      'best.normal': 312.5,
      'best.nightmare': 401.2,
      'fewestDeaths.normal': 3,
      'deepest.normal': 556,
      'deepest.abyss': 120,
      'runs.normal': 9,
      'completions.normal': 2,
      settings: { volume: 0.5, haptics: false, lastDifficulty: 'nightmare' },
    }),
  );
  const legacy = S.importLegacy((k) => ls.getItem(k));
  ok(legacy.any, 'legacy keys detected');
  eq(legacy.byDiff.normal, { runs: 9, completions: 2, best: 312.5, fewestDeaths: 3, deepest: 556, lastTime: null, lastDeaths: null }, 'legacy normal record');
  eq(legacy.byDiff.nightmare.best, 401.2, 'legacy nightmare best');
  ok(legacy.byDiff.abyss.deepest === 120 && legacy.byDiff.abyss.best === null, 'legacy abyss deepest only');
  const r = S.migrateProfile(null, legacy, 5);
  ok(r.migrated && !r.newer, 'null + legacy = migrated');
  ok(r.profile.chapters.ch1.completed === true && r.profile.chapters.ch1.byDiff.normal.best === 312.5, 'completion flag from completions.normal');
  ok(r.profile.settings && r.profile.settings.volume === 0.5, 'legacy settings imported');
  ok(r.profile.totals.completions === 2 && r.profile.totals.runs === 9, 'totals from legacy');
  // legacy keys with garbage values are ignored, not fatal
  const bad = S.importLegacy((k) => (k.endsWith('best.normal') ? '"abc"' : k.endsWith('deepest.normal') ? '{bad json' : null));
  ok(!bad.any || !bad.byDiff.normal, 'garbage legacy values ignored');
}

// ---- migration of other shapes / corrupted records -------------------------------------------------------------------
{
  const a = S.migrateProfile({ schema: 1, byDiff: { normal: { best: 100, fewestDeaths: 1, completions: 1 } } }, null).profile;
  ok(a.schema === 2 && a.chapters.ch1.byDiff.normal.best === 100, 'schema 1 flat byDiff migrates');
  const b = S.migrateProfile({ schema: 2, run: { difficulty: 'normal', checkpoint: { x: 'NaN' } }, chapters: { ch1: { byDiff: { normal: { best: -5, runs: 'x', deepest: 40 } } } }, totals: 'oops' }, null);
  ok(b.repaired && b.profile.run === null, 'bad run dropped, repaired flag');
  ok(b.profile.chapters.ch1.byDiff.normal.best === null && b.profile.chapters.ch1.byDiff.normal.runs === 0 && b.profile.chapters.ch1.byDiff.normal.deepest === 40, 'readable fields kept, bad ones reset');
  const c = S.migrateProfile('not an object', null);
  ok(c.profile.schema === 2 && c.repaired, 'garbage record -> fresh profile');
  const newer = { schema: 99, anything: true };
  const d = S.migrateProfile(newer, null);
  ok(d.newer && d.profile === newer, 'newer schema is handed back untouched');
  const e = S.migrateProfile({ schema: 2, chapters: { ch1: { byDiff: { normal: { best: 90 } } } } }, S.importLegacy((k) => (k === S.V1_PREFIX + 'best.normal' ? '80' : null)));
  ok(e.profile.chapters.ch1.byDiff.normal.best === 80, 'merging keeps the better (lower) best time');
}

// ---- SaveStore: load picks the newest, writes are debounced, failures never throw ---------------------------------------
{
  const A = new S.MemoryAdapter();
  const B = new S.MemoryAdapter();
  const t = 1000;
  A.record = { ...S.defaultProfile(1), updatedAt: t, settings: { volume: 0.1 } };
  B.record = { ...S.defaultProfile(1), updatedAt: t + 500, settings: { volume: 0.9 } };
  const store = new S.SaveStore({ primary: A, secondary: B, legacyGetItem: null, debounceMs: 30 });
  const seen = [];
  store.on('save:loaded', (e) => seen.push(e.source));
  await store.load();
  ok(store.profile.settings.volume === 0.9 && seen[0] === 'memory', 'newest updatedAt wins on load');
  const writtenEvents = [];
  store.on('save:written', (e) => writtenEvents.push(e));
  for (let i = 0; i < 10; i++) store.runProgress({ time: i, deaths: 0, deepest: -1 });
  store.checkpointReached({ difficulty: 'normal', checkpoint: { x: 1, y: -50, z: 2, yaw: 0.5, index: 2 }, section: 2, time: 61, deaths: 1, deepest: -52 });
  for (let i = 0; i < 5; i++) store.checkpointReached({ difficulty: 'normal', checkpoint: { x: 1, y: -50 - i, z: 2, yaw: 0.5, index: 2 }, section: 2, time: 61 + i, deaths: 1, deepest: -52 });
  await sleep(120);
  ok(A.writes === 1, `16 mutations within the debounce window cost one write (got ${A.writes})`);
  ok(A.record.run && A.record.run.section === 2 && A.record.run.time === 65, 'checkpoint persisted');
  ok(writtenEvents.length === 1, 'one save:written');
  // failures never throw
  A.failNext = 1;
  const errs = [];
  store.on('save:error', (e) => errs.push(e));
  store.depthReached('normal', 300);
  const res = await store.flush();
  ok(res === true && errs.length === 1 && store.info.primaryOk === false, 'primary failure is reported, secondary still stores it');
  // a listener that throws must not break the store
  store.on('save:changed', () => {
    throw new Error('listener bug');
  });
  ok(store.update((p) => void (p.totals.runs += 0)) !== undefined, 'throwing listener does not break update');
  // update(fn) that throws
  ok(store.update(() => {
    throw new Error('boom');
  }) === false, 'throwing mutation returns false');
  store.close();
}

// ---- records / completion ------------------------------------------------------------------------------------------------
{
  const A = new S.MemoryAdapter();
  const store = new S.SaveStore({ primary: A, secondary: null, legacyGetItem: null, debounceMs: 10 });
  await store.load();
  store.runStarted({ difficulty: 'normal', checkpoint: { x: 0, y: 0, z: 0, yaw: 0, index: -1 }, section: 0, savesRun: true });
  ok(store.profile.run && store.profile.run.kind === 'start', 'run start creates the slot');
  store.checkpointReached({ difficulty: 'normal', checkpoint: { x: 4, y: -120, z: 0, yaw: 1, index: 3 }, section: 3, time: 140, deaths: 2, deepest: -130 });
  store.deathRecorded({ cause: 'impact', difficulty: 'normal', deepestMeters: 135, time: 150 });
  store.deathRecorded({ cause: 'creature', difficulty: 'normal', deepestMeters: 135, time: 160 });
  store.completed({ difficulty: 'normal', time: 600.5, deaths: 4, deepestMeters: 556, recorded: true });
  const r = store.records('normal');
  ok(r.best === 600.5 && r.fewestDeaths === 4 && r.completions === 1 && r.runs === 1 && r.deepest === 556, 'records after a completion');
  ok(store.profile.run === null && store.chapter().completed === true && store.profile.totals.deaths === 2 && store.profile.totals.deathsByCause.creature === 1, 'completion clears the run, sets the flag, counts deaths by cause');
  store.completed({ difficulty: 'normal', time: 700, deaths: 1, deepestMeters: 556, recorded: true });
  ok(store.records('normal').best === 600.5 && store.records('normal').fewestDeaths === 1, 'a slower run keeps the best time, fewer deaths improves');
  store.completed({ difficulty: 'sandbox', time: 99, deaths: 0, deepestMeters: 10, recorded: false });
  ok(store.records('sandbox').best === null && store.records('sandbox').completions === 0, 'sandbox records nothing');
  await store.flush();
  const again = new S.SaveStore({ primary: A, secondary: null, legacyGetItem: null });
  await again.load();
  ok(again.records('normal').best === 600.5 && again.chapter().completed, 'round trip through the adapter');
  again.reset();
  ok(again.records('normal').best === null, 'reset');
}

// ---- localStorage adapter + sync flush + a newer-schema profile is never overwritten ---------------------------------------
{
  const ls = memStorage();
  const lsa = new S.LocalStorageAdapter(ls);
  const store = new S.SaveStore({ primary: null, secondary: lsa, legacyGetItem: null, debounceMs: 5000 });
  await store.load();
  store.checkpointReached({ difficulty: 'nightmare', checkpoint: { x: 0, y: -10, z: 0, yaw: 0, index: 1 }, section: 1, time: 20, deaths: 0, deepest: -10 });
  ok(ls.getItem(S.LS_PROFILE_KEY) === null, 'nothing written before the debounce');
  await store.flush({ sync: true });
  ok(JSON.parse(ls.getItem(S.LS_PROFILE_KEY)).run.section === 1, 'flush writes localStorage synchronously');
  store.close();
  const future = memStorage({ [S.LS_PROFILE_KEY]: JSON.stringify({ schema: 7, hello: 'from the future', updatedAt: 5 }) });
  const s2 = new S.SaveStore({ primary: null, secondary: new S.LocalStorageAdapter(future), legacyGetItem: null, debounceMs: 1 });
  await s2.load();
  s2.depthReached('normal', 5);
  await sleep(20);
  ok(JSON.parse(future.getItem(S.LS_PROFILE_KEY)).hello === 'from the future', 'a newer-schema profile is never overwritten');
  // unavailable storage: still works in memory, flush reports false
  const s3 = new S.SaveStore({ primary: null, secondary: new S.LocalStorageAdapter({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), legacyGetItem: null });
  await s3.load();
  s3.depthReached('normal', 5);
  ok((await s3.flush()) === false && s3.records('normal').deepest === 5, 'blocked storage: no throw, state kept in memory');
}

// ---- mirrorToLegacy keeps today\'s UI keys in step ---------------------------------------------------------------------------
{
  const ls = memStorage(v1({ 'best.normal': 500 }));
  const p = S.defaultProfile();
  p.chapters.ch1.byDiff.normal = { ...S.emptyDiffRecord(), best: 420, fewestDeaths: 2, deepest: 556, runs: 3, completions: 1 };
  p.chapters.ch1.byDiff.abyss = { ...S.emptyDiffRecord(), deepest: 200 };
  S.mirrorToLegacy(p, ls);
  ok(JSON.parse(ls.getItem(S.V1_PREFIX + 'best.normal')) === 420 && JSON.parse(ls.getItem(S.V1_PREFIX + 'deepest.abyss')) === 200, 'v1 keys restored / improved from the profile');
  const ls2 = memStorage(v1({ 'best.normal': 300 }));
  S.mirrorToLegacy(p, ls2);
  ok(JSON.parse(ls2.getItem(S.V1_PREFIX + 'best.normal')) === 300, 'a better v1 value is never overwritten');
}

// ---- SaveService on a fake game ------------------------------------------------------------------------------------------------
{
  const bus = new EventBus();
  const game = {
    bus,
    time: 0,
    deaths: 0,
    deepest: 0,
    sectionIndex: 0,
    difficultyKey: 'normal',
    diff: { checkpoints: 'all', recordTimes: true, label: 'Normal' },
    checkpoint: { x: 0, y: 0, z: 0, yaw: 0, index: -1 },
    level: { sections: [{ name: 'The Sill' }, { name: 'Ringfall' }, { name: 'Underspire' }] },
    _runActive: () => true,
    _continuing: null,
  };
  const store = new S.SaveStore({ primary: new S.MemoryAdapter(), secondary: null, legacyGetItem: null, debounceMs: 5 });
  const lsm = memStorage();
  const svc = new S.SaveService(game, { store, legacyStorage: lsm });
  await svc.init();
  const cont = [];
  bus.on('continue:changed', (e) => cont.push(e.available));
  ok(svc.continueInfo() === null, 'nothing to continue at first');
  bus.emit('game:start', { difficulty: 'normal' });
  ok(svc.continueInfo() === null && store.records('normal').runs === 1, 'a fresh start is not continuable but counts a run');
  game.time = 95;
  game.deaths = 1;
  game.deepest = -140;
  game.sectionIndex = 2;
  game.checkpoint = { x: 3, y: -140, z: 1, yaw: 0.2, index: 2 };
  bus.emit('checkpoint', { index: 2 });
  const info = svc.continueInfo();
  ok(info && info.section === 2 && info.sectionName === 'Underspire' && info.time === 95 && info.depthMeters === 140 && info.label === 'Normal', 'checkpoint makes the run continuable');
  ok(cont.includes(true), 'continue:changed emitted');
  game.deaths = 2;
  game.time = 110;
  bus.emit('player:death', { cause: 'impact' });
  ok(svc.continueInfo().deaths === 2 && store.profile.totals.deathsByCause.impact === 1, 'death updates the continue slot and totals');
  // Continue re-enters the same run without resetting the slot or counting a run
  game._continuing = info;
  bus.emit('game:start', { difficulty: 'normal' });
  game._continuing = null;
  ok(svc.continueInfo() && store.records('normal').runs === 1, 'game:start during Continue keeps the slot and the run count');
  // abyss / sandbox never offer continue
  game.diff = { checkpoints: 'none', recordTimes: true, label: 'Abyss' };
  game.difficultyKey = 'abyss';
  bus.emit('game:start', { difficulty: 'abyss' });
  ok(svc.continueInfo() === null, 'abyss (no checkpoints) has nothing to continue');
  game.diff = { checkpoints: 'all', recordTimes: true, label: 'Normal' };
  game.difficultyKey = 'normal';
  bus.emit('game:victory', { difficultyKey: 'normal', time: 640, deaths: 3, deepestMeters: 556, recorded: true });
  ok(store.records('normal').best === 640 && svc.continueInfo() === null && store.chapter().completed, 'victory records the time, completes the chapter, clears the slot');
  ok(store.profile.totals.playTime > 0, 'play time accumulated');
  bus.emit('settings:changed', { settings: { volume: 0.3, haptics: true, dominantHand: 'left' } });
  ok(store.profile.settings.volume === 0.3, 'settings mirrored into the profile');
  svc.dispose();
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
