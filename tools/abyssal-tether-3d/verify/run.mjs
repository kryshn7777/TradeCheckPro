// Runs route(s) from their checkpoints, per variant: the quick loop while authoring
// a route (verify.mjs runs everything).
//
//   node run.mjs [--chapter ch1] [--variant normal|nightmare|abyss|all] [--route s3,s7spire|all] [-v] [--timers] [--root DIR]
//   node run.mjs [variant|all] [routeKey|all] [-v]        (the scratchpad harness's form)
//
// `all` routes = the section routes plus the alternate lines. -v prints every
// completed step and the last events; --timers prints sim ms per frame by system.
import { Sim } from './sim.mjs';
import { Bot } from './bot.mjs';
import { CHAPTERS, chapterIds, variantKeys } from './chapters.mjs';
import { argValue, hasFlag, positional } from './root.mjs';

const argv = process.argv.slice(2);
const pos = positional(argv);
const verbose = hasFlag(argv, '-v', '--verbose');
const withTimers = hasFlag(argv, '--timers');
const variants = variantKeys(argValue(argv, '--variant', pos[0] || 'all'));
const routeArg = argValue(argv, '--route', pos[1] || 'all');

let allOk = true;
for (const cid of chapterIds(argValue(argv, '--chapter', 'ch1'))) {
  const ch = CHAPTERS[cid];
  const R = ch.routes;
  const starts = Object.assign({}, R.ROUTE_START, R.ALT_START || {});
  const routes = Object.assign({}, R.ROUTES, R.ALT_ROUTES || {});
  const keys = routeArg === 'all' ? Object.keys(routes) : routeArg.split(',');
  for (const k of keys) if (!routes[k]) throw new Error(`${cid}: unknown route '${k}' (known: ${Object.keys(routes).join(', ')})`);
  for (const v of variants) {
    const level = ch.makeLevel(v);
    for (const key of keys) {
      const sim = new Sim(level, v, { timers: withTimers });
      const cp = level.sections[starts[key]].checkpoint;
      sim.spawn(cp.x, cp.y, cp.z);
      const bot = new Bot(sim, routes[key], { verbose });
      const t0 = Date.now();
      const r = bot.runRoute();
      const ok = r.ok && r.deaths === 0 && r.maxLand < 0.85;
      allOk = allOk && ok;
      console.log(
        `${cid} ${v.padEnd(9)} ${key.padEnd(7)} ${ok ? 'PASS' : 'FAIL'} t=${r.time.toFixed(1)}s maxLand=${r.maxLand.toFixed(2)}${r.maxLandAt ? '@' + r.maxLandAt.y.toFixed(0) : ''} deaths=${r.deaths} attaches=${r.attaches.length} la=${r.lookaheads} (${Date.now() - t0}ms)` +
          (r.fail ? `\n     ${r.fail}` : '') +
          (r.misTarget.length ? `\n     misTarget ${JSON.stringify(r.misTarget.slice(0, 5))}` : ''),
      );
      if (verbose || !ok) console.log('     events', JSON.stringify(sim.events.slice(-14)));
      if (withTimers) {
        const s = sim.timers.summary().perFrameMs;
        console.log('     ms/frame mean (p99): ' + Object.entries(s).map(([n, o]) => `${n} ${o.mean.toFixed(3)} (${o.p99.toFixed(3)})`).join(' | '));
      }
    }
  }
}
console.log(allOk ? 'ALL PASS' : 'SOME FAIL');
process.exitCode = allOk ? 0 : 1;
