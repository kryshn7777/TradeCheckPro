// E29 budget report: sim milliseconds per 60 Hz frame, by system, on the full
// fixed-step stack the game runs today (tether targets + input, 4 × physics with
// collisions and ropes, creature, threat) while the bot plays the chapter's whole
// main route; plus the §8 V12 object-count budgets from the chapter data.
//
//   node budget.mjs [--chapter ch1|all] [--variant normal|…|all] [--root DIR] [--device-factor N]
//
// Node timings are a proxy: the gate (ENGINE_EXTENSIONS §0.8 / E29) is ≤ 2.5 ms per
// frame ON QUEST 3. `--device-factor N` multiplies the Node numbers to estimate a
// slower device (measure N once on the headset, e.g. via the dev perf overlay); the
// device pass stays authoritative.
import { Sim, SystemTimers, loadCreatureModules } from './sim.mjs';
import { Bot } from './bot.mjs';
import { CHAPTERS, chapterIds, variantKeys } from './chapters.mjs';
import { argValue, isMain } from './root.mjs';

export const SIM_BUDGET_MS = 2.5; // per frame, Quest 3 (ENGINE_EXTENSIONS §0.8)
/** §8 V12 count budgets. */
export const COUNT_BUDGETS = { movers: 40, dynamic: 64, volumesPerSection: 24, kept: 24 };

/** The chapter's main route as one list from the spawn (at the fork: `line`, default the risky one). */
export function mainRoute(ch, line) {
  const R = ch.routes;
  const route = [];
  for (const k of R.SECTION_ROUTE) for (const st of R.ROUTES[R.FORK && k === R.FORK.key ? line || R.FORK.risky : k]) route.push(st);
  return route;
}

/** V12: object counts against their budgets (ch1 has no movers / volumes / Kept yet: 0). */
export function countBudgets(level) {
  const d = level.data || {};
  const list = (k) => (Array.isArray(d[k]) ? d[k] : []);
  const dynamic = level.solids.filter((s) => s.kind === 'crumble').length + level.anchors.filter((a) => a.kind === 'fragile').length + list('movers').length;
  const volBySection = {};
  for (const v of list('volumes')) {
    const s = v.section !== undefined ? v.section : level.sectionIndexAt ? level.sectionIndexAt((v.minY + v.maxY) / 2) : -1;
    volBySection[s] = (volBySection[s] || 0) + 1;
  }
  const maxVol = Object.values(volBySection).reduce((m, n) => Math.max(m, n), 0);
  const counts = { movers: list('movers').length, dynamic, volumesPerSection: maxVol, kept: list('kept').length };
  const over = Object.keys(COUNT_BUDGETS).filter((k) => counts[k] > COUNT_BUDGETS[k]);
  return { counts, budgets: COUNT_BUDGETS, ok: over.length === 0, over };
}

/**
 * Plays the chapter's main route with the creature and threat live (non-lethal) and
 * per-system timers on. Returns the timer summary and the route outcome.
 */
export async function measureBudget(chapterId, variant, opts = {}) {
  await loadCreatureModules();
  const ch = CHAPTERS[chapterId];
  const L = ch.makeLevel(variant);
  const timers = new SystemTimers(60 * 900);
  const sim = new Sim(L, variant, { timers, creature: { seed: opts.seed !== undefined ? opts.seed : 0x9e3779b1 } });
  sim.spawn(L.spawn.x, L.spawn.y, L.spawn.z);
  const bot = new Bot(sim, mainRoute(ch), {});
  const r = bot.runRoute();
  const s = timers.summary();
  const factor = opts.deviceFactor || 1;
  const ok = s.perFrameMs.cost.p99 * factor <= SIM_BUDGET_MS;
  return {
    chapter: chapterId,
    variant,
    routeOk: r.ok,
    routeFail: r.fail,
    simSeconds: +r.time.toFixed(1),
    creatureCatches: sim.creatureCatches,
    budgetMs: SIM_BUDGET_MS,
    deviceFactor: factor,
    ok,
    timers: s,
    counts: countBudgets(L),
  };
}

const pad = (s, n) => String(s).padEnd(n);
const ms = (v) => v.toFixed(3);

/** Human-readable table for one measureBudget() result. */
export function formatBudget(b) {
  const rows = [];
  const f = b.deviceFactor;
  rows.push(`  ${b.chapter}/${b.variant}: ${b.timers.frames} frames (${b.simSeconds}s sim, route ${b.routeOk ? 'ok' : 'FAIL ' + b.routeFail}, creature catches ${b.creatureCatches} [non-lethal])`);
  rows.push(`    ${pad('system', 9)} ${pad('mean', 7)} ${pad('p50', 7)} ${pad('p95', 7)} ${pad('p99', 7)} ${pad('max', 7)} calls/frame   (ms per 60 Hz frame${f !== 1 ? ` × device factor ${f}` : ', Node'})`);
  for (const [k, v] of Object.entries(b.timers.perFrameMs)) {
    const whole = k === 'total' || k === 'cpu' || k === 'cost';
    rows.push(`    ${pad(k, 9)} ${pad(ms(v.mean * f), 7)} ${pad(ms(v.p50 * f), 7)} ${pad(ms(v.p95 * f), 7)} ${pad(ms(v.p99 * f), 7)} ${pad(ms(v.max * f), 7)} ${whole ? '' : v.callsPerFrame}`);
  }
  const t = b.timers.perFrameMs.cost;
  rows.push(`    budget ${b.budgetMs} ms/frame (Quest 3): cost p99 ${ms(t.p99 * f)} ms → ${b.ok ? 'OK' : 'OVER'} (${((100 * t.p99 * f) / b.budgetMs).toFixed(1)}% of budget; cost = min(wall, process CPU) per frame)`);
  const c = b.counts;
  rows.push(`    counts (V12): ${Object.entries(c.counts).map(([k, v]) => `${k} ${v}/${c.budgets[k]}`).join(', ')} → ${c.ok ? 'OK' : 'OVER ' + c.over.join(',')}`);
  return rows.join('\n');
}

// -----------------------------------------------------------------------------
if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const chapters = chapterIds(argValue(argv, '--chapter', 'all'));
  const variants = variantKeys(argValue(argv, '--variant', 'all'));
  const deviceFactor = +argValue(argv, '--device-factor', 1) || 1;
  let fail = 0;
  console.log('== Sim budget (E29): ms per frame by system, full stack, main route');
  for (const c of chapters) {
    for (const v of variants) {
      const b = await measureBudget(c, v, { deviceFactor });
      console.log(formatBudget(b));
      if (!b.ok || !b.counts.ok || !b.routeOk) fail++;
    }
  }
  console.log(fail ? `\n${fail} OVER BUDGET / FAILED` : '\nALL WITHIN BUDGET');
  process.exitCode = fail ? 1 : 0;
}
