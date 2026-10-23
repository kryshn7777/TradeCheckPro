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
  ['input: WP-TOUCH (joystick vector / dead zone / curve, floating base, look + gyro scaling, hold / latch buttons, handedness mirror, 56 px layout floor, mode decision, settings sanitising, device profile, InputManager integration: stick/look/ropes/reel/jump/grip/bag/pause)', 'input/test-touch.mjs'],
  ['creature: behaviour units', 'creature/unit.mjs'],
  ['creature: WP-SKITTER (variant config: exactly 4.5x speeds, 0.45 scale, wind-up/reach, spawn data S6-S8, safe entry distance, determinism, tagged events, damage path, Mason trigger link)', 'creature/skitter.mjs'],
  ['health: fall damage curve, cooldown, regen, events, difficulty scaling, determinism, Physics3D drops and hazards', 'health/unit.mjs'],
  ['bag: apply times, cancel on damage, caps, adrenaline timing + speed multiplier, heal API, deterministic fair spawns, pickups, lantern charge, VR gesture', 'bag/unit.mjs'],
  ['climb: WP-CLIMB (zones, VR hand-delta pull + throw, alternating hands, stretch, collision safety, grip stamina drain / slip / refill / difficulty, desktop cling + hop, rope + grip, determinism)', 'climb/unit.mjs'],
  ['audio: WP-AUDIO (impulse responses, rope/footstep/music/creature-clip modules, voice cap, reduced tier, 10 simulated minutes no growth, NaN-free)', 'audio/unit.mjs'],
  ['physics: swing bench checks (near grab, pendulum, catches, two ropes, bot routes, reel)', 'physics/swingbench.mjs', ['--check']],
  ['physics: decor collision (kit part boxes inside both kits, placement frames, safety rules, Level3D decor solids, line of sight / raycast, landing on one)', 'physics/decor.mjs'],
  ['release: save data (E05: schema, migration, adapters, SaveService, Continue slot)', 'release/test-save.mjs'],
  ['release: entitlement (E06: nine store scenarios, chapter gate, release-channel mock lock)', 'release/test-entitlement.mjs'],
  ['release: XR governor (steps, hysteresis, reduced effects, no allocation)', 'release/test-governor.mjs'],
  ['render: baked GI (deterministic bake, level hash, asset size, format) + render governor hook', 'render/test-lighting.mjs'],
  ['render: surface detail (hq shader patch, KTX2 manifest, decal atlas)', 'render/test-surface.mjs'],
  ['render: scene detail (WP-SCENE-DETAIL: kit soundness, seeded placement determinism, section mixes, vignettes, anchor clearance, tier budgets <= 3 calls / 15 k stereo triangles, view re-pack + shader patches)', 'render/test-scene-detail.mjs'],
  ['render: geometry-compressed GLBs (EXT_meshopt_compression decode, custom attributes, GLTFLoader + vendored decoder, byte savings)', 'render/test-glb-meshopt.mjs'],
  ['render: GFX-PARITY (edge bevel / puddle / probe-box shader chunks, contact shadows, dropped props physics, wear maps, gauge glass, finger curls)', 'render/test-gfx-parity.mjs'],
  ['render: WP-SHADOWS (tier table + governor / reducedEffects reduction, cone fit, cache-refresh thresholds, receiver shader chunks, static box proxy, caster layers)', 'render/test-lantern-shadow.mjs'],
  ['render: rigged Mason (mason_rig.glb structure: bones, skin, LODs, clips; clip graph phase lock; IK; head fit)', 'render/test-mason-rig.mjs'],
  ['render: creature locomotion (metachronal gait: planted feet, stride clock; body spring chain bounds)', 'render/test-creature-motion.mjs'],
  ['release: platform (immersive launch, early XR request, SW policy, precache generator)', 'release/test-platform.mjs'],
  ['ux: WP-UX (settings persistence + sanitising, snap turn, comfort vignette rules, display helpers, caption mapping + tracker, first-run tutorial)', 'ux/unit.mjs'],
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
