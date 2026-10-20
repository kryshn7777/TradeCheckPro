# Abyssal Tether 3D: verification harness

The Node harness that proves every chapter is completable, fair and within budget, on every difficulty
variant, by driving the **real** sim modules (`public/abyssal-tether-3d/src/sim/*`, no stubs) with a route
bot. Contract: `docs/abyssal-tether-3d/ENGINE_EXTENSIONS.md` E28 (harness), E29 (budgets) and §8 (gates).

```bash
npm run verify:at3d                                   # every chapter, every variant (ch1 today)
npm run verify:at3d -- --chapter ch1 --variant abyss  # one chapter / one variant (comma lists work too)
npm run budget:at3d -- --variant normal               # the E29 sim budget table only
node tools/abyssal-tether-3d/verify/run.mjs --route s3,s7spire -v   # quick loop on a route
```

Everything runs from any checkout or worktree and any working directory: the game is found relative to
these scripts (`tools/abyssal-tether-3d/verify` → `<repo>/public/abyssal-tether-3d`). Point the tools
at another copy with `--root <dir>` (a repository root, the game folder or its `src/`) or `AT3D_ROOT`.
Exit code 1 on any failure; the last line is `ALL CHECKS PASS` when green. A full run takes ~10 s on
an idle desktop core.

## Files

| File | What it is |
|---|---|
| `verify.mjs` | The gate. Per chapter and variant: V1 integrity, V2 full runs, section routes, alternate lines, the fork timing, recovery scenarios, V3 anchor coverage, counts, V13 determinism, V12 + E29 budgets, V14 baseline read-out. Writes `out/verify-<chapter>.json` and `out/traces-<chapter>.json`. |
| `run.mjs` | Runs route(s) from their checkpoints and prints one line per route (`--timers` adds ms per frame by system). Also accepts the old positional form `run.mjs abyss s3`. |
| `budget.mjs` | E29: sim ms per 60 Hz frame **by system** on the full stack the game runs (tether targets and input, 4 × physics, collisions, ropes, creature, threat) while the bot plays the main route, plus the V12 object counts. |
| `headclear.mjs` | Head clearance audit (player height contract): every route on every variant and every physics step, the head point (`eyeAboveBody()` = 1.24 m over the body) vs every active solid and vs the rope anchor while hanging. Lists each spot within `--near` (0.1 m) of geometry with variant, route, section, time and solid id; `--eye 1.85` audits a taller player; `--strict` exits 1 on any spot. Run it after level data edits. |
| `compare.mjs` | Diffs two reports (or traces files) value by value: parity proofs and V14 before/after read-outs. |
| `sim.mjs` | `Sim`: the real `Player3D` / `TetherSystem` / `Physics3D` stepped exactly like `Game3D` (per 60 Hz frame: `updateTargets`, `handleInput`, then 4 fixed steps of 1/240 s, jump on the first only), with snapshot / restore for the bot's look-ahead. Options: `timers` (per-system timers), `creature` (Creature3D + ThreatSystem3D after the physics, non-lethal), `record` (intent log for replay). |
| `bot.mjs` | The route bot: aims a ray at the next anchor (it must be exactly what `findTarget` returns), chains hands, pumps / reels, and releases only when a cloned look-ahead lands on the intended platform under 0.85 × lethal impact. The route step grammar is in its header. |
| `routes.mjs` | Chapter I data: `ROUTES` (one per section, checkpoint to checkpoint), `SECTION_ROUTE`, `ALT_ROUTES`, `ROUTE_START` / `ALT_START`, `SCENARIOS` (recovery tests), `FORK` (S6 risky vs safe). Pure data with no imports, because the browser e2e loads it as-is. |
| `chapters.mjs` | Chapter registry for `--chapter`; `ch1` = today's `LEVEL_DATA_3D` level. |
| `root.mjs`, `args.mjs` | Game-root resolution (`--root`, `AT3D_ROOT`) and CLI helpers shared by every tool. |
| `baselines/verify-ch1.json` | The Chapter I numbers at M0 (V14 baseline). |

## What verify checks (and the §8 gate each maps to)

| Phase | Gate | Fails when |
|---|---|---|
| Integrity | V1 | sections not contiguous, a checkpoint not resting on a floor (or on a crumbling ledge), an anchor inside a solid or not mounted (0.45 m behind its normal, or on a chain), a hazard next to a checkpoint, the goal not standable or the gate not in front of it, a lowering step needing more rope than the variant allows, **duplicate ids**, or an `…Id` / `ids` reference in the extension lists (`lamps`, `movers`, `volumes`, `beats`, …) that does not resolve |
| Full runs | V2 | the bot cannot go spawn → goal in one continuous run on each line of the fork (deaths 0, every landing < 0.85 lethal, ends in the goal) |
| Section routes, alternate lines, scenarios | V2 / V6 | any route from its checkpoint, any alternate line or any recovery scenario (a deliberate mistake the level must forgive) fails |
| Fork | CHAPTERS S6 | the risky line (from the fork) is not ≥ 25 % faster than the safe one |
| Coverage | V3 | an anchor is never targetable (exact `findTarget` ray) from any bot trace point or standing spot |
| Determinism | V13 | the bot run, a second bot run and a **replay of the first run's intent log** (no bot, no look-ahead) do not give the same trajectory hash (FNV-1a over the float64 bits of position, velocity and contact state, every frame) |
| Budget | E29 / V12 | the sim's per-frame cost p99 > 2.5 ms (Node; see below), or more than 40 movers, 64 dynamic objects, 24 volumes per section or 24 Kept |
| Baseline | V14 | never fails: lists the values that moved against `baselines/verify-<chapter>.json` |

`--skip-budget` and `--skip-determinism` drop those phases (faster iteration).

## Reports

`out/verify-<chapter>.json` (git-ignored) holds `integrity`, `full` (`<variant>/<line>` with splits per
section), `sections_<variant>`, `alt_<variant>_<route>`, `s6`, `scenarios`, `coverage`, `counts`,
`determinism`, `budget` (the full timer table per variant), `regression` (V14) and `checks` (the
failure list). `out/traces-<chapter>.json` is every bot run's path (x, y, z every 6th frame) per variant.

## The sim budget (E29)

`budget.mjs` wraps the game's own methods on the instances it creates (no source change), so the rows
add up to `total`:

| Row | Covers |
|---|---|
| `targets` | `TetherSystem.updateTargets` (aim rays, once per frame) |
| `input` | `TetherSystem.handleInput` (fire / release / yank) |
| `physics` | `Physics3D.step` minus the two rows below (control, forces, integration, rope constraints, hazards), 4 per frame |
| `collide` | `Physics3D.resolveCollisions` (sphere vs AABB) |
| `rope` | `TetherSystem.step` (fire extension, attach and miss timers, fragile-anchor load and breaks), called at the end of every physics step |
| `creature` | `Creature3D.update` once per frame (non-lethal here: a catch is counted, not applied) |
| `threat` | `ThreatSystem3D.update` once per frame |
| `total` | the whole frame, wall clock |
| `cpu` | the whole frame, process CPU time (`process.cpuUsage`) |
| `cost` | per frame, the smaller of `total` and `cpu`: the gated number |

The first 300 frames (JIT warm-up) are not recorded and the bot's look-ahead frames are never timed.
The gate is **`cost` p99 ≤ 2.5 ms per frame on Quest 3**. On a shared machine the wall clock also counts
the time the process sat descheduled (a load of 20+ on 4 cores pushes wall-clock p99 past 3 ms) and the
process CPU time also counts V8's helper threads, so the gate reads the smaller of the two for every
frame; the system rows are wall clock (their split, not their absolute value, is the point). Node on a
desktop core is several times faster than the headset's browser: read the table as the per-system split
and the headroom, and confirm on the device (dev perf overlay, OVR Metrics). `--device-factor N` scales
the numbers once N is measured on the headset. The route numbers never depend on the timings.

## V14: Chapter I against its baseline

Every run compares all of its numbers with `baselines/verify-ch1.json` and lists what moved (route
times, splits, worst landings, coverage counts, determinism hashes). Movement is expected after a
physics or level change (the elastic catch of E15 re-baselines S6 once); review the list, then record
the new numbers:

```bash
npm run verify:at3d -- --chapter ch1 --write-baseline   # only written when the chapter is green
node tools/abyssal-tether-3d/verify/compare.mjs before.json tools/abyssal-tether-3d/verify/out/verify-ch1.json
```

## Adding a chapter

When a chapter module lands (`src/data/chapters/chN-*.js` exporting `CHAPTER`, E04), add an entry to
`chapters.mjs` (`makeLevel: (v) => new Level3D(CHAPTER, v)`) and a routes module with the same exports
as `routes.mjs`. New route-step kinds for the new systems (`{ wait: { mover } }`, `{ ride }`, `{ swim }`,
`{ knock }`, …, E28) go into `bot.mjs` with the systems that need them; `Sim` then steps those systems
in the §3 order inside `frame()`.

## Parity with the scratchpad harness (M0)

This is the session-scratchpad harness (`sim.mjs`, `bot.mjs`, `routes.mjs`, `verify.mjs`, `run.mjs`)
promoted unchanged in behaviour: on the same game commit, `compare.mjs` finds all 1212 values of the old
`verify.json` and all 59 022 trace values identical in `out/verify-ch1.json` / `out/traces-ch1.json`.
