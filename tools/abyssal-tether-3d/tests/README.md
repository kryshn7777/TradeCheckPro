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
| `test-touch.mjs` | WP-TOUCH, the phone / tablet layer: joystick vector (dead zone, rescale, curve, floating base), screen halves + mirror, look-delta and gyro scaling (invert-Y, caps), hold / latch button machine, 56 px layout floor + handedness mirror, touch mode decision, settings sanitising, device profile (pixel-ratio cap, default tier, headroom rule), and the `InputManager` merge (stick to move / climb, drag to look, ropes, reel, jump, grip, bag, pause, multi-touch, layer off). 220 checks. |
| `run-pw.cjs` + `pw/` | Browser: a small scene (`pw/harness.js`) running the game's `InputManager`, `HandsView` and `TetherSystem` through the real three.js `WebXRManager` with a mock WebXR device (`pw/mockxr.js`); screenshots in `input/out/shots/`. |
| `register.mjs`, `hooks.mjs` | Node module hooks that map the browser importmap (`three`, `three/addons/…`) to the game's `vendor/three`, so the input and render modules load in Node. A test imports `./register.mjs` first and loads three.js and the game with dynamic `import()`. |

## physics/

| File | |
|---|---|
| `swingbench.mjs` | Rope physics bench on the real `Player3D` / `TetherSystem` / `Physics3D`: (1) near grab 1.3 / 1.6 / 2.0 m at 6 / 9 / 12 m/s tangential (peak omega, peak load, revolutions in 3 s), (2) free pendulum L = 4 / 8 / 15 m at 10 and 60 degrees (period vs the large-angle formula, energy drift per period), (3) catches after 5 / 10 / 20 m free falls (peak load, rebound, pay-out), (4) two ropes taut at once (energy, jitter, stalled reel), (5) every bot route on every variant (max omega, max load, frames above 4 / 6 / 10 g), (6) reeling in on a conical swing (angular momentum), (7) a typical swing. `node tools/abyssal-tether-3d/tests/physics/swingbench.mjs` prints the tables; `--check` asserts the limits (what `npm run test:at3d` runs); `--only 1,2`, `--variant normal`, `--set rope.maxTensionG=4,rope.catchPeakG=6` (tuning sweeps), `--json`, `--root DIR` (compare against another copy of the game). Loads are in `CONFIG.player.gravity` units, measured as specific force per fixed step. |
| `decor.mjs` | Collision for the environment kit dressing (`sim/decorColliders.js`, `Level3D` decor solids): the part boxes (`src/data/decor-parts-3d.js`) are finite and inside both kits' parts, placement frames to world boxes (axis aligned only), the safety rules (an anchor, a climb grip, an edge hold, a hazard, the spawn / a checkpoint within reach, the headroom over a ledge keep a piece dressing), `querySolids` includes the decor boxes and `querySolidsStatic` / `solids` do not, line of sight and raycast hit them, the player lands on one. `AT3D_DECOR=<json of boxes>` makes `verify` play the bot routes with the dressing solid. |

## health/

| File | |
|---|---|
| `unit.mjs` | `Health3D` / fall damage (`src/sim/health3d.js`): the damage curve per difficulty (0 up to the threshold, convex, 1 at the lethal speed) and the wall curve, the hit cooldown, regeneration (delay + rate, per difficulty), the `health:damage` / `health:low` / `health:recover` events and the low-state hysteresis, hazards (60 hp, cooldown, death on the repeat), Sandbox, god mode, the heartbeat (60 -> 140 bpm), determinism and snapshot / restore, then `Physics3D` on the real level: drops from known heights onto the spawn ledge, the lethal fall still killing, accumulation, a hazard and a creature kill. Pass / fail. |


## bag/

| Script | What it checks |
|---|---|
| `unit.mjs` | The player bag (`src/sim/inventory3d.js`, `pickups3d.js`, `input/bagGesture.js`): apply times (first aid 5 s, bandage 1.5 s, adrenaline 0.6 s, battery 1 s) and heals, `Health3D.heal` (never above full, `health:heal`), cancel on damage / death / input / an inactive run, capacities (1/5/2/3) and refusals, the adrenaline x2 for 10 s and its `Physics3D` multiplier (run cap and acceleration x2, gravity and fall damage unchanged), the authored supply spots (6-10 per section), deterministic seeded picks (~1/3, rarity order, one first aid / adrenaline per section, fairness guarantees over 400 seeds), pickup radius 0.9 m, hand reach 0.35 m + grip, a full bag, checkpoint snapshots, the lantern charge (drain, never dark, low warning, battery) and the VR hip gesture. Pass / fail. |

## climb/

| Script | What it checks |
|---|---|
| `unit.mjs` | Grip climbing (`src/sim/climb3d.js`, level data `climb`, `Physics3D` hook): the authored zones (1-4 per section, <= 14 m tall, `level.climbNear`), the VR hand-delta pull (a hand pulled down 0.5 m lifts the body ~0.5 m, no drift while holding), the throw on release (the low-passed pull velocity x 1.12, capped at 11 m/s), alternating hands, the hand ripped from its hold (stretch), collision safety (pressed into a wall: no tunnelling, no damage), the yank vs grab decision, grip stamina (hang 0.03/s, x0.62 with two hands, x1.7 wet, more while moving, Abyss x1.25, slip at zero, lockout + resume level, refill on the ground in ~2.5 s), the strain warning level, the desktop cling (F, W/S climb, A/D traverse, stops at the zone top, Space hops off, F released drops), grabbing while tethered, determinism (bit-identical), a plain physics intent (the route bot) untouched, death lets go; procedural EDGE holds (deterministic extraction, crumble / hazard exclusion, query cost, nearest-edge hold, x1.5 edge drain without the two-hand discount, authored rate kept, VR + desktop lip mantle, plain-edge Space hop). Pass / fail. |

## render/

| File | |
|---|---|
| `test-scene-detail.mjs` | WP-SCENE-DETAIL (`src/render/sceneDetail*.js`, the render-only scene dressing): the procedural kit (finite, indexed, unit normals, uvs in the atlas, windings, <= 300 triangles per template), the seeded placement (same seed = same checksum, another seed differs, per-section caps and mixes, 5-6 vignettes off the anchors and checkpoints, nothing that dangles or glows near a grapple anchor), the quest budget (<= 3 draw calls, the worst window over a sweep of the whole descent inside every tier cap and <= 15 k stereo triangles, lower tier = subset of the higher), and the view on a fake game (re-pack inside its draw range, tiers, reducedEffects, shader patches land on this three.js build's anchors, dispose). |

## release/

| File | |
|---|---|
| `test-save.mjs` | `meta/save.js` (E05): schema, migration from today's `abyssalTether3d.v1.*` keys, corrupted / newer-schema records, adapters (memory, localStorage, newest-wins load), debounced non-throwing writes, records and completion, `SaveService` wiring and the Continue slot on a fake game bus. |
| `test-entitlement.mjs` | `platform/entitlement.js` (E06): the nine store scenarios (no store, owned, not owned, offline grace, provider down, refund after 24 h, purchase, cancel, purchase outside the store), the chapter gate, the dev-only `?entitlement=` mock and its lock in the release channel. |
| `test-governor.mjs` | `platform/governor.js`: degrade / recover / hysteresis / flapping back-off, hitch and pause exemptions, reducedEffects floor, foveation + fx tier + viewport scale + target frame rate, no allocation per frame. |
| `test-platform.mjs` | Immersive launch detection, the early `requestSession` hand-over, the service-worker registration policy, the precache generator (tiers, excludes, version hash, size gate). |

The browser side of the release work (PWA install / offline / update, immersive boot time, context loss, soak) lives in `../release/` (`test-pwa.mjs`, `test-boot.mjs`, `soak.mjs`).

## creature/

| File | |
|---|---|
| `unit.mjs` | `Creature3D` / `ThreatSystem3D` behaviour checks on a stub shaft: sandbox inert, dormant sections, the sighting, stalk entry and respawn grace, body arrays, non-lethal hunt sections, the victory gate slam, a stalling player caught after a telegraphed wind-up, a steady descent never caught, the threat curve, determinism with a seed, one listener set per bus. Pass / fail. |
| `invariants.mjs` | Report: wall-hug distance, spine points inside solids, link-length error, planted limbs and foothold distance, NaNs, update cost. |
| `pacing.mjs` | Human-pacing pursuit sim: expert / careful / hesitant players descending with pauses and reactions; deaths per run, threat, lunges, near misses and time-to-catch when stalling. `node pacing.mjs 60` (runs per cell); `LEVEL=real` uses the game's level instead of the stub shaft; `ONLY`, `PROF`, `TUNE`, `NOSTALL`, `CAUSES` in its header. |
| `perf.mjs` | `Creature3D.update` cost per call (p50 / p99 / max µs). |
| `allocprof.mjs` | Heap allocation per `Creature3D.update` (V8 sampling profiler, minor-GC objects included; boxed doubles count, so read it as a relative number). |
| `stubShaft.mjs` | The stub 560 m shaft used by the creature tools. |
| `nooks.mjs` | LEVEL_FUN_PLAN P5, the Masons' rests on the real level (seeded, 60 Hz): hidden in a rest no attack starts and nothing hits while its budget lasts (25 / 15 / 8 s), the stall clock is frozen, the head stays out of the rest's block, it listens; after the budget a still player is caught as today; skitterlings never bite there; the threat eases; determinism. `node nooks.mjs [seeds]`. Pass / fail. |
| `lure.mjs` | LEVEL_FUN_PLAN P5, the Mason as the key: 200 seeds x 3 difficulties with the player in the S5 niche (the keystone broken within 40 s in >= 95 %, never a hit), the annoyed path (shot from the niche), a strike never hitting through a solid, the attack line of sight skipping the keystone, what counts as a blow (`Objectives3D.onStrike`), Sandbox. `node lure.mjs [seeds]`. Pass / fail. |

The objectives / seals suites (LEVEL_FUN_PLAN P1-P5) are in `objectives/`: `unit.mjs` (seals), `verbs.mjs` (P3), `routes.mjs` (P2 reach and forks), `machines.mjs` (P4), `mason.mjs` (P5: the S5 keystone and its haul fallback, the S7 survive floor, the escape override, the rests' budgets).

The level's own checks (routes, budgets, determinism) are in `../verify/`.
