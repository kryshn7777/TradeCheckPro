# Abyssal Tether 3D: unit tests and creature tools

```bash
npm run test:at3d                      # Node suites: input intent mapping, the uiio fixes, creature units
npm run test:at3d -- --browser         # + the Playwright input test (desktop + mock WebXR)
npm run test:at3d -- --reports         # + the creature invariants report
```

Every script takes `--root DIR` (or `AT3D_ROOT`) like the harness; by default it tests this checkout.

## input/

| File | |
|---|---|
| `test-intent.mjs` | `InputManager` intent mapping: XR button reading and hysteresis, desktop handlers (pointer lock, mouse look, keys, blur release), a mock `WebXRManager` session (controllers, hands, grip vs ray poses, session end), `HandsView` launcher geometry. 164 checks. |
| `test-uiio-fixes.mjs` | The VR UX fixes: eye-height calibration, controller loss pauses, hold X, smooth turn pivots about the head, double Enter VR. 101 checks. |
| `run-pw.cjs` + `pw/` | Browser: a small scene (`pw/harness.js`) running the game's `InputManager`, `HandsView` and `TetherSystem` through the real three.js `WebXRManager` with a mock WebXR device (`pw/mockxr.js`); screenshots in `input/out/shots/`. |
| `register.mjs`, `hooks.mjs` | Node module hooks that map the browser importmap (`three`, `three/addons/…`) to the game's `vendor/three`, so the input and render modules load in Node. A test imports `./register.mjs` first and loads three.js and the game with dynamic `import()`. |

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
