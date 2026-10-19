# ABYSSAL TETHER 3D: work status (paused 2026-10-19 14:00 UTC)

The owner paused all work. Everything in progress was saved on branch `claude/abyssal-tether-game-3zft6o` as a
work-in-progress commit. **The game code in that commit is unfinished and unverified: do not merge it until each
workstream below is finished and its gates pass** (lint, `npm run verify:at3d -- --chapter ch1 --variant all`,
the route bot, `npm run e2e:at3d`).

## Done and on `main`
- 2D game, 3D WebXR MVP, desktop performance safety net (PRs #1–#3).
- Integration review fixes, five-chapter bible, engine contracts, release plan (PR #4).

## Done in this commit (verified)
- Test harness promoted into the repo (`tools/abyssal-tether-3d/verify`, `e2e`, `tests`; E28 core + E29 sim budget).
  All gates passed on the code at `main` (ALL CHECKS PASS, 33/33 routes, e2e 43/43).
- Plans: `plans/GRAPHICS_PLAN.md` (10x graphics, tiers, budgets, work packages), `plans/CREATURE_RIG_PLAN.md`
  (rig, clips, procedural layers, three.js integration), research reports and the three candidate plans.
  A completeness critic found gaps that are not yet folded in: download budget does not add up (~82–97 MB vs 60 MB),
  no streaming/upload pacing owner, baked GI double-counts the pooled dynamic lamps, comfort and visual
  accessibility missing, UI/loading visuals unowned, Quest Pro / PCVR / low-end desktop tiers missing, M2 schedule
  order.
- `contracts/CONTRACT3D.md` and `contracts/INTEGRATION_NOTES.md` (the module contract the code follows).

## Paused mid-way (partial, uncommitted work saved here as-is)
| Workstream | State | Files |
|---|---|---|
| Integration leftovers (fixers' proposals for the lead) | partly applied | `src/game.js`, `audio3d.js`, `creature3d.js`, `level3d.js`, `ui3d.js`, `creatureView.js`, `level-data-3d.js` |
| Environment art (carved-stone kit, dressing) | round 1 of 2, not critic-reviewed | `src/render/levelView.js` (+~1.9k lines), `materials.js`, `renderer3d.js`, `assets/models/env/ch1_env_kit.glb`, `tools/abyssal-tether-3d/build_env_kit.py` |
| Atmospheric fog + debris | round 1 of 3, not reviewed | `src/render/fx.js`, `src/render/atmosphere.js`, `src/render/debris.js` |
| Realistic launcher + HD gloved arms (Blender) | builder round 1, no GLB yet | `tools/abyssal-tether-3d/build_hands.py` |
| Creature (Ossuary Column) design | refinement round 2 of 3 (round 1 critic: 4/10), production export not started | `tools/abyssal-tether-3d/wip/creature/` (builders, latest renders) |
| Engine M0 (E01 creature split, E02 clocks) | started, partial | `tools/abyssal-tether-3d/wip/m0-partial-E01-E02.patch` (apply on top of this branch) |
| Player feel: 1:1 eye height + calibration, slip-clutch rope physics, head clearance | not started | — |
| Creature rig + animation, graphics work packages, M1–M6 chapters | not started | plans above |

Known issue still open: in VR the eyes sit ~0.88 m above the floor (`InputManager.xrRigPosition` keeps them 0.5 m
above the 0.38 m collision sphere), which makes the world feel too big. Fix design: 1:1 floor mapping plus a height
calibration setting; see the player-feel workflow.

## How to resume
The orchestration scripts used are in `tools/abyssal-tether-3d/wip/workflows/` (they contain absolute paths of the
original cloud session; adjust `SP`/`REPO` paths). Resume order recommended by value: player feel → environment art
→ fog/debris + arms → creature refine/production → creature rig → M0 → graphics work packages → M1–M6.
Blender: `pip install bpy==5.2.2` in a Python 3.13 venv (see `tools/abyssal-tether-3d/README.md`).
