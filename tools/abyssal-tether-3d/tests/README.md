# Abyssal Tether 3D: unit tests and creature tools

```bash
npm run test:at3d                      # Node suites: input intent mapping, the uiio fixes, creature units, the physics swing bench checks
npm run test:at3d -- --browser         # + the Playwright input test (desktop + mock WebXR)
npm run test:at3d -- --reports         # + the creature invariants report
```

Every script takes `--root DIR` (or `AT3D_ROOT`) like the harness; by default it tests this checkout.

## input/

| File | |
|---|---|
| `test-intent.mjs` | `InputManager` intent mapping: XR button reading and hysteresis, desktop handlers (pointer lock, mouse look, keys, blur release), a mock `WebXRManager` session (controllers, hands, grip vs ray poses, session end), `HandsView` launcher geometry. 164 checks. |
| `test-uiio-fixes.mjs` | The VR UX fixes: player height (true 1:1 rig at 1.2 / 1.45 / 1.65 / 1.85 m, Seated calibration, fine trim, settings migration), controller loss pauses, hold X, smooth turn pivots about the head, double Enter VR. 142 checks. |
| `run-pw.cjs` + `pw/` | Browser: a small scene (`pw/harness.js`) running the game's `InputManager`, `HandsView` and `TetherSystem` through the real three.js `WebXRManager` with a mock WebXR device (`pw/mockxr.js`); screenshots in `input/out/shots/`. |
| `register.mjs`, `hooks.mjs` | Node module hooks that map the browser importmap (`three`, `three/addons/…`) to the game's `vendor/three`, so the input and render modules load in Node. A test imports `./register.mjs` first and loads three.js and the game with dynamic `import()`. |

## physics/

| File | |
|---|---|
| `swingbench.mjs` | Rope physics bench on the real `Player3D` / `TetherSystem` / `Physics3D`: (1) near grab 1.3 / 1.6 / 2.0 m at 6 / 9 / 12 m/s tangential (peak omega, peak load, revolutions in 3 s), (2) free pendulum L = 4 / 8 / 15 m at 10 and 60 degrees (period vs the large-angle formula, energy drift per period), (3) catches after 5 / 10 / 20 m free falls (peak load, rebound, pay-out), (4) two ropes taut at once (energy, jitter, stalled reel), (5) every bot route on every variant (max omega, max load, frames above 4 / 6 / 10 g), (6) reeling in on a conical swing (angular momentum), (7) a typical swing. `node tools/abyssal-tether-3d/tests/physics/swingbench.mjs` prints the tables; `--check` asserts the limits (what `npm run test:at3d` runs); `--only 1,2`, `--variant normal`, `--set rope.maxTensionG=4,rope.catchPeakG=6` (tuning sweeps), `--json`, `--root DIR` (compare against another copy of the game). Loads are in `CONFIG.player.gravity` units, measured as specific force per fixed step. |

## health/

| File | |
|---|---|
| `unit.mjs` | `Health3D` / fall damage (`src/sim/health3d.js`): the damage curve per difficulty (0 up to the threshold, convex, 1 at the lethal speed) and the wall curve, the hit cooldown, regeneration (delay + rate, per difficulty), the `health:damage` / `health:low` / `health:recover` events and the low-state hysteresis, hazards (60 hp, cooldown, death on the repeat), Sandbox, god mode, the heartbeat (60 -> 140 bpm), determinism and snapshot / restore, then `Physics3D` on the real level: drops from known heights onto the spawn ledge, the lethal fall still killing, accumulation, a hazard and a creature kill. Pass / fail. |

## creature/

| File | |
|---|---|
| `unit.mjs` | `Creature3D` / `ThreatSystem3D` behaviour checks on a stub shaft: sandbox inert, dormant sections, the sighting, stalk entry and respawn grace, body arrays, non-lethal hunt sections, the victory gate slam, a stalling player caught after a telegraphed wind-up, a steady descent never caught, the threat curve, determinism with a seed, one listener set per bus. Pass / fail. |
| `invariants.mjs` | Report: wall-hug distance, spine points inside solids, link-length error, planted limbs and foothold distance, NaNs, update cost. |
| `pacing.mjs` | Human-pacing pursuit sim: expert / careful / hesitant players descending with pauses and reactions; deaths per run, threat, lunges, near misses and time-to-catch when stalling. `node pacing.mjs 60` (runs per cell); `LEVEL=real` uses the game's level instead of the stub shaft; `ONLY`, `PROF`, `TUNE`, `NOSTALL`, `CAUSES` in its header. |
| `perf.mjs` | `Creature3D.update` cost per call (p50 / p99 / max µs). |
| `allocprof.mjs` | Heap allocation per `Creature3D.update` (V8 sampling profiler, minor-GC objects included; boxed doubles count, so read it as a relative number). |
| `stubShaft.mjs` | The stub 560 m shaft used by the creature tools. |

The level's own checks (routes, budgets, determinism) are in `../verify/`.
