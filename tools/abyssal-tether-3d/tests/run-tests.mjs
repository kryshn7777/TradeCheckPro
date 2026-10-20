// Runs the Abyssal Tether 3D Node test suites (input intent mapping, the uiio fixes,
// creature behaviour) and, with --browser, the Playwright input test.
//
//   npm run test:at3d -- [--root DIR] [--browser] [--reports]
//
// --reports also prints the creature invariants report (not pass/fail). Pacing,
// perf and allocation tools are run by hand (see README.md). Exit code 1 on a failure.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argValue, hasFlag } from '../verify/args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const root = argValue(argv, '--root', null);
const pass = root ? ['--root', root] : [];

const suites = [
  ['input: intent mapping', 'input/test-intent.mjs'],
  ['input: uiio fixes (eye height, controller loss, hold X, head-pivot turn, double Enter VR)', 'input/test-uiio-fixes.mjs'],
  ['creature: behaviour units', 'creature/unit.mjs'],
  ['health: fall damage curve, cooldown, regen, events, difficulty scaling, determinism, Physics3D drops and hazards', 'health/unit.mjs'],
  ['bag: apply times, cancel on damage, caps, adrenaline timing + speed multiplier, heal API, deterministic fair spawns, pickups, lantern charge, VR gesture', 'bag/unit.mjs'],
  ['physics: swing bench checks (near grab, pendulum, catches, two ropes, bot routes, reel)', 'physics/swingbench.mjs', ['--check']],
  ['release: save data (E05: schema, migration, adapters, SaveService, Continue slot)', 'release/test-save.mjs'],
  ['release: entitlement (E06: nine store scenarios, chapter gate, release-channel mock lock)', 'release/test-entitlement.mjs'],
  ['release: XR governor (steps, hysteresis, reduced effects, no allocation)', 'release/test-governor.mjs'],
  ['render: baked GI (deterministic bake, level hash, asset size, format) + render governor hook', 'render/test-lighting.mjs'],
  ['render: surface detail (hq shader patch, KTX2 manifest, decal atlas)', 'render/test-surface.mjs'],
  ['release: platform (immersive launch, early XR request, SW policy, precache generator)', 'release/test-platform.mjs'],
];
if (hasFlag(argv, '--reports')) suites.push(['creature: invariants report', 'creature/invariants.mjs']);
if (hasFlag(argv, '--browser')) suites.push(['input: Playwright desktop + mock WebXR', 'input/run-pw.cjs']);

let failed = 0;
for (const [name, file, extra] of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, file), ...(extra || []), ...pass], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  if (!ok) failed++;
  const tail = out.trim().split('\n').slice(-1)[0];
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${tail}`);
  if (!ok || hasFlag(argv, '-v') || file.includes('invariants')) console.log(out.replace(/^/gm, '      '));
}
console.log(failed ? `\n${failed} SUITE(S) FAILED` : '\nALL SUITES PASS');
process.exitCode = failed ? 1 : 0;
