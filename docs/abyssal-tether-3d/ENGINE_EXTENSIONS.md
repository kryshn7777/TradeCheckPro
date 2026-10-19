# ABYSSAL TETHER: Engine Extensions (contracts)

> Companion to [CHAPTERS.md](CHAPTERS.md) (the design; it cites these by number) and
> [ART_AUDIO_PLAN.md](ART_AUDIO_PLAN.md). Date: 2026-10-19. Status: **approved contracts, to be scheduled after the
> current polish pass** (the files they touch, `src/sim/*`, `src/game.js`, `src/render/*`, `src/audio/*`, `src/input/*`,
> `src/ui/*`, are being polished by other agents right now; nothing here has been implemented and no source file was
> edited to write it).
>
> Every extension below is a contract: data format in the level data, sim classes and methods, integration point in the
> loop, bus events, render needs, audio and haptics needs, and what the verification harness must check. Sizes are for
> **one engineer before content**: **S** under a week, **M** 1–2 weeks, **L** 3+ weeks. Priorities: **P0** needed for the
> demo (Chapter I + THE MARK), **P1** for Chapter II, **P2** for Chapters III–V, **P3** replay and polish.
>
> The three pitches numbered their extensions E1–E19 (set-pieces), X1–X22 (systems) and N1–N18 (narrative). This
> document replaces all three with **E01–E29**; the mapping is in §1.

---

## 0. Ground rules (carried from CONTRACT3D, plus what the new systems add)

1. `src/sim/**` and `src/data/**` stay **DOM-free and three.js-free**, importable from Node by absolute path.
2. **Fixed step, deterministic.** Physics stays at `CONFIG.PHYSICS_DT = 1/240`. Every new sim system steps **inside the
   fixed loop** with `PHYSICS_DT` (never frame `dt`). No `Math.random` in sim code: use `U.rng(seed)` seeded per chapter
   and section, reset on waking. Movers, surfaces, beam sweeps and schedules are closed-form functions of a section clock
   wherever possible (E02).
3. **No per-frame allocation in hot loops**: preallocated typed arrays, caller-owned scratch arrays, stamp-based
   de-duplication (as `Level3D` does today).
4. **Collision stays sphere-vs-AABB.** Movers **translate only**; nothing collidable rotates. Wheels, gears, prisms and
   bells rotate visually only.
5. **The player keeps control.** No system may rotate the rig or camera, force a view, or disable input outside pause,
   death and the 0.35 s mantle. Movers translate the player only through contact or a rope the player chose.
6. **Chapter I must not regress.** Every extension is opt-in by data. Chapter I keeps the `legacy` hearing model and its
   tuned creature presets. The harness re-verifies Chapter I at every milestone (E28).
7. **Lint**: `npx eslint public/abyssal-tether-3d/` passes (unused vars are errors except `^[A-Z_]`; `catch {` when the
   error is unused; never name a function `use*`).
8. **Budgets** (E29): sim ≤ 2.5 ms per frame on Quest 3; ≤ 150 draw calls and ≤ 350k visible triangles at every
   set-piece's worst moment; ≤ 10 draw calls per new feature; ≤ 4 dynamic lights plus the lantern; no post-processing;
   textures ≤ 1024² per chapter set.
9. **Ownership** follows the CONTRACT3D file table; a contract change is requested from the owner of the file, never made
   around it.

**Deliberately not built:** rotating colliders; rope wrapping around geometry; fluid simulation (water is volumes with
scripted surfaces); runtime fracturing (debris is a pre-fractured pool); physics debris piles; rideable creature modes;
runtime growth of the creature's segment count; cutscenes or camera control; combat; voice-over.

---

## 1. Summary

| ID | Extension | Files (new or touched) | Size | Pri. | First needed | Depends on | Replaces pitch IDs |
|---|---|---|---|---|---|---|---|
| E01 | Creature module split (no behaviour change) | `src/sim/creature/*`, `creature3d.js` → re-export | M | P0 | before any creature work | — | X12 (split) |
| E02 | Section clocks and determinism | new `src/sim/clock3d.js`, `game.js` | S | P0 | THE MARK | — | X1 |
| E03 | Beats v2: conditions, actions, checkpoint snapshots | new `src/sim/beats3d.js`, `game.js` | M | P0 | THE MARK, the Spiral | E02 | E11, X14, N12 |
| E04 | Chapter framework, seams, depth offset | new `src/data/chapters/*`, `game.js`, `level3d.js` | M | P0 | demo hand-off | E02, E03 | E14, X15, N1 |
| E05 | Saves v2 (IndexedDB) | new `src/meta/save.js`, `config3d.js` `Storage` | S | P0 | demo | — | part of E14, X15, N1 |
| E06 | Entitlement and the demo gate | new `src/platform/entitlement.js` (from `pwa/entitlement.draft.js`) | S | P0 | end card | E04 | E15, X16, N17 |
| E07 | Waking lamps (diegetic checkpoints) | new `src/sim/lamps3d.js`, `game.js`, render | S | P0 | Chapter I | E03 | N2 |
| E08 | Remnants | new `src/sim/remnants3d.js`, new `render/remnantsView.js` | S–M | P0 | Chapter I | E05 | N3 |
| E09 | Interactables and hand gestures | new `src/sim/interact3d.js`, input | S | P0 | THE MARK | E24 | E13, X17, N13 |
| E10 | Knocks and Names | new `src/sim/knock3d.js`, input detector, data | M | P0 | Chapter I Names | E11, E24 | N8 |
| E11 | Noise and hearing v2 (INVESTIGATE, masking, horns, rope telegraph) | new `src/sim/noise3d.js`, creature perception | M | P0/P1 | S4 knock wall / Ch II | E01 | E8, X8, N9, X9 (telegraph) |
| E12 | Records: medals, trials, splits, ghosts, stats | new `src/meta/records.js` | S–M | P0 (ghosts P3) | demo | E05 | E16, X18 |
| E13 | Kinematic movers | new `src/sim/movers3d.js` | M | P0 | THE MARK | E02 | E1, X2, N4 |
| E14 | Level3D dynamic sets and data pass-through | `level3d.js` | S | P0 | THE MARK | E13 | E4, X3 |
| E15 | Rope v2: moving anchors, elastic catch, cutting, anchor flags | `physics3d.js` (Rope3D, TetherSystem), `config3d.js` | S | P0 | THE MARK | E14 | E3, X4 |
| E16 | Moving contacts: carry, relative impacts, inheritance, crush | `physics3d.js` (Physics3D) | M | P0 | THE MARK iris | E14 | E2, X5 |
| E17 | Creature v2: paths, waterline, plunge, gather, stillness, freeze | `src/sim/creature/*`, `creatureView.js` | L | P0→P2 | the Spiral | E01, E11 | E9, X12, N10 |
| E18 | Volumes | new `src/sim/volumes3d.js` | M | P0 (`hush`) / P1 / P2 | THE MARK hush | E13 | E5, X6, N5 |
| E19 | Fronts (rubber-banded waves) | new `src/sim/fronts3d.js` | S–M | P1/P2 | the Snuffing | E13, E18 | E12 |
| E20 | Water, swimming and breath | `physics3d.js`, `config3d.js` | M | P2 | Chapter III | E18, E24 | E6, X7, N5 |
| E21 | Light field and the hooded lantern | new `src/sim/lightfield3d.js`, renderer | M | P0 (lite) / P2 | THE MARK figure | E24 | E7, X10, N6 |
| E22 | The Kept | new `src/sim/kept3d.js`, new `render/keptView.js` | M–L | P0 (scripted) / P2 | THE MARK figure | E21 | N7 |
| E23 | Stillness | new `src/sim/still3d.js`, `threat3d.js` | M | P2 | Chapter V | E17, E19, E21 | X13, N11 |
| E24 | Input and intent extensions | `inputManager.js`, `xrInput.js`, `desktopInput.js` | S | P0→P2 | THE MARK | — | E6/E7 intent, X19 |
| E25 | Renderer extensions | `src/render/*`, new `render/themes/*` | L | P0→P2 | demo | various | E17, X20, N14 |
| E26 | Audio, music and haptics | `audio3d.js`, new `src/audio/music3d.js` | L | P0→P2 | demo | various | E18, X21, N15 |
| E27 | UI extensions | `ui3d.js` | M | P0 | demo | E05, E06, E12 | N16 |
| E28 | Verification harness v2, authoring tools, telemetry | `tools/abyssal-tether-3d/verify/`, `…/blockout/` | M | P0 | M0 | — | E19, X22, N18 |
| E29 | Performance, memory and loading budgets | tooling + gates | S + ongoing | P0 | M0 | — | — |

---

## 2. Build order (engineering)

Milestones match CHAPTERS §13. Each ends with the harness green on every chapter built so far, on every variant, and a
device performance pass.

| Milestone | Extensions | Notes |
|---|---|---|
| **M0 Foundations** (~4 wk) | E01, E02, E03, E04 (core), E05, E06 (+ the Quest purchase spike), E28 (harness promoted, Blender exporter T1, overlay T2), E29 tooling | The purchase spike answers RELEASE §19 Q1–Q4 on device before Chapter II production starts. |
| **M1 Demo** (~6 wk) | E07, E08, E09, E10, E11 (legacy + knocks as noise), E12 (no ghosts), E13 (`steps`, `pendulum`, `bob`), E14, E15, E16, E17 (`path`, hidden path), E18 (`hush`), E21-lite, E22-scripted, E24 (interact, knocks, lantern pose), E25/E26/E27 demo slices | THE MARK needs moving floors (iris), a moving anchor (cradle chain, chandelier), a scripted Kept and a creature path. |
| **M2 Lamphold** (~8 wk) | E11 (full), E13 (all kinds), E17 (`snuff`, `jam`, breach, `safeLight` avoidance, INVESTIGATE, masked hearing), E18 (`safeLight`, `mask`), E19 (`snuff`, `collapse`), E25 (lamp-field, rails, debris pool), E26 (mover voices, score) | Snuffing graybox in week 1. |
| **M3 The Mere** (~8–9 wk) | E18 (`water`, `current`, `air`), E20, E17 (`waterline`, `plunge`, `knockOn`), E25 (water), E26 (underwater, bells) | Drain and Plunge graybox in week 1. |
| **M4 The Keeping** (~8 wk) | E21 (full), E22 (full), E17 (`gather`, horns), E11 (horns), E25 (cone, figures), E26 (Kept, horns) | Kept + lantern greybox room in week 1 (two-hand load risk). |
| **M5 The Still Flame** (~8–9 wk) | E23, E19 (`still`, `dark`), E17 (stillness, shadow, `bow`, `freeze`, `comeApart`, `settle`), E25 (stillness, beams, grade), E26 (silence system), endings, E27 (credits, menu variants) | Halo and Stilling graybox in week 1. |
| **M6 Release** (~5 wk) | E12 ghosts, Full Descent, Pilgrim, E29 gates, VRC sweep | |

---

## 3. The loop after the extensions (integration contract for `Game3D`)

Today `Game3D._frame` reads input, updates targets and tether input once per frame, runs fixed physics steps, then the
creature, threat, progress (hints and the Y-trigger cursor), rig, renderer, UI and audio. After the extensions:

```text
frame(dt):
  intent = input.update(dt)                         // + knocks[], lantern pose, gestures, interact (E24)
  tethers.updateTargets(player, intent)             // unchanged (frame rate)
  tethers.handleInput(player, intent, dt)           // unchanged
  interact.update(dt, intent, player)               // E09 (frame rate; emits events consumed by beats)
  while (acc >= PHYSICS_DT):                        // fixed steps, deterministic
    clock.step(DT)                                  // E02
    movers.step(DT)                                 // E13: writes child boxes, anchor positions, v, per-step d
    volumes.step(DT); volumes.sample(player)        // E18 (+ medium flags for E20)
    light.setLantern(intent.lantern)                // E21 (pose constant within the frame)
    physics.step(player, tethers, stepIntent, DT)   // E15 + E16 + E20 inside; tethers.step at its end (today)
    if first sub-step: knocks.step(intent.knocks)   // E10
    noise.step(DT)                                  // E11 (ring buffer ageing; emitters are bus-driven)
    kept.step(DT, player)                           // E22
    still.step(DT, player)                          // E23
    fronts.step(DT, player)                         // E19
    if (stepIndex % 4 === 0) creature.update(4*DT, player, time)   // E17: fixed 60 Hz (see note)
    beats.step(DT)                                  // E03
    lamps.step(player)                              // E07: kindle → beats.snapshot()
  threat.update(dt, …); records.sample(dt); remnants.update(dt, player, light)
  sections / hints (unchanged; the Y-trigger cursor is replaced by beats)
  rig, renderer.update(dt, game), ui.update(dt), audio.update(dt, game)
```

**Note on the creature.** Today `Creature3D.update(dt)` runs once per rendered frame with a variable `dt`. Beats,
fronts and snapshots need it deterministic, so it moves to a fixed 60 Hz sub-rate. E01 must show, with the existing
seeded pacing runs at 72 and 90 Hz frame rates, that Chapter I's behaviour is equivalent within tolerance (state
sequence identical; positions within 0.1 m) before the switch ships.

**Section windows.** `level.setActiveWindow(sectionIndex)` (E14) is called on section enter: movers, volumes, Kept and
fronts outside the current section ±1 are frozen (closed-form systems recompute on wake; integrated ones keep state).

---

## 4. Contract changes to CONTRACT3D (summary; details in each extension)

| Area | Change | Ext. |
|---|---|---|
| `intent.move` | `{ x, z }` → `{ x, y, z }`; `y` is used only in water (head pitch × stick magnitude; A strokes up) | E20, E24 |
| `intent.hands[h].interact` | grip held on an **untethered** hand (XR) / E held (desktop); grip on a tethered hand stays **yank** | E09, E24 |
| `intent.knocks` | array (≤ 2 per frame) of `{ x, y, z, hand, targetId, speed }` from the knock detector (XR) or K (desktop) | E10, E24 |
| `intent.lantern` | `{ x, y, z, dx, dy, dz }`: left grip pose (XR) or camera (desktop); the bot sets it directly | E21, E24 |
| `intent.gesture` | `{ raise, cup, kneel }` booleans computed from hand poses vs the calibrated head (XR) or held keys (desktop) | E09, E24 |
| `InputManager.onSelect(hand, fn)` | runs `fn` synchronously inside the XR `select` event (purchase activation, T11) | E06, E24 |
| `Player3D` | new fields `inWater`, `submerged`, `breath`, `stillness`, `grabbedT`, `lantern` (`{ on, hooded, white }`); `groundSolid.dynamic` honoured | E16, E20, E22, E23 |
| Death causes | add `'crush'`, `'drown'`, `'kept'`, `'still'` to `'impact'`, `'fall'`, `'hazard'`, `'creature'` | E16, E20, E22, E23 |
| `Level3D` | `dynSolids`, `dynHazards`, `dynAnchors`; `setActiveWindow(i)`; `depthOffset`; new optional object fields passed through | E14 |
| Anchors | `vx, vy, vz` (written by movers); flags `air`, `still`, `held`, `group`, `mountId`, `assist` | E15 |
| `DIFFICULTY[k].rules` | per-difficulty rule numbers (CHAPTERS §4.6): `movingAssist`, `safeDepth`, `breathTime`, `bellowsFull`, `underwaterAimMul`, `cone`, `keptSpeed`, `keptGrabsToKill`, `stillTime`, `stillWarn`, `crownExposure`, `knockTolerance` | all |
| `CONFIG` | `rope.catch`, `water`, `stillness`, `noise` blocks | E11, E15, E20, E23 |
| `Game3D` | `loadChapter`, `prefetchChapter`, `canEnter`, `chapterId`; checkpoint → current lamp; `respawn()` → wake | E04, E06, E07 |
| `window.AT3D.debug` | `chapter(id)`, `lamp(id)`, `beat(id)`, `mover(id, t)`, `rules(partial)`, `snapshot()`, `restore(s)` | E02–E07 |

---

## 5. Chapter data module (complete schema)

Each chapter is one ES module under `src/data/chapters/` exporting `CHAPTER`. It **extends today's `LEVEL_DATA_3D`
shape**, so `new Level3D(CHAPTER, variant)` works unchanged; new systems read their lists from `level.data`, filtered
with the existing `inVariant()` (`omitIn` / `onlyIn`). Generated blockout data (E28 T1) and hand-authored data merge into
one object; generated files are never hand-edited.

```js
// src/data/chapters/ch2-lamphold.js
import { BLOCKOUT } from './ch2-lamphold.blockout.js';   // generated by the Blender exporter
import { SEAM_1_2, SEAM_2_3 } from './seams.js';
export const CHAPTER = merge(BLOCKOUT, SEAM_1_2.in('ch2'), SEAM_2_3.out('ch2'), {
  id: 'ch2', name: 'Lamphold', subtitle: 'Every lamp a bed',
  depthOffset: 600,                                     // depth shown = depthOffset + max(0, −y)
  theme: 'lamphold',                                    // render/audio theme module key (E25, E26)
  creature: { seg: 22, variant: 'v2', plates: 'figure', hearing: 'noise', seed: 2201 },
  spawn: { x, y, z, yaw },                              // = first lamp's standAt
  exit: { lamp: 'L2-12', next: 'ch3', seam: 'seam-2-3' },
  // ---- today's lists (unchanged shape, new optional fields marked +) ----
  sections: [{ id, name, subtitle, yTop, yBottom, shaft, theme, hints, triggers,
               creature: { mode, lethal, speedMul, burstRate, spawnOffsetY, + hearing, + path },
               + beat: 'TEACH', + intensity: 2, + music: { bed, stems }, + cuttable: false }],
  solids:  [{ id, …box, kind, tag, + skin, + group, + still, + hollow, + breach, + collapse, + noCarry, + crushZone }],
  hazards: [{ id, …box, kind, + group, + activeWhen }],
  anchors: [{ id, x, y, z, kind, normal, tag, mount, + air, + still, + held, + group, + mountId, + assist }],
  decor, lights,
  // ---- new lists ----
  lamps: [],          // E07
  movers: [],         // E13
  volumes: [],        // E18
  fronts: [],         // E19
  beats: [],          // E03
  interactables: [],  // E09
  names: [], knockWalls: [], horns: [],   // E10, E11
  creaturePaths: [],  // E17
  kept: [],           // E22
  stillSources: [],   // E23
  medals: { normal: { brass: 0, still: 0 }, nightmare: {…}, abyss: {…} },   // filled from BETA data (E12)
  trials: [{ id: 'T2-3', title: 'Under the Deck', rule: { … } }],            // E12
  music: { stems: 'ch2', cues: { … } },                                       // E26
  byDiff: { nightmare: { /* set-piece overrides */ }, abyss: { … } },
});
```

`byDiff` holds set-piece numbers (front speeds, snuff lead, recovery-hook counts) that differ by difficulty; rule numbers
shared by every chapter live in `DIFFICULTY[k].rules`. Every object a beat, mover, front or volume refers to must have a
stable string `id` (E28 fails the build on a dangling reference).

---

## 6. The extensions

Each entry: **Purpose · Data · Sim API · Integration · Events · Render · Audio/haptics · Verification · Budget ·
Size/priority.** "Harness" means the verification harness v2 (E28).

### E01 · Creature module split · M · P0

- **Purpose.** `creature3d.js` is 2,919 lines and every later chapter extends it. Split it before anyone adds behaviour.
- **Files.** `src/sim/creature/perception.js` (stall model, listening, hearing; later E11), `locomotion.js`
  (surface following, breadcrumbs, limbs, keep-clear, detours), `behaviour.js` (state machine, modes, bursts, attacks,
  sightings), `body.js` (spine, scale, limbs output, crown flags), `index.js` exporting `Creature3D`, `SEG`,
  `CREATURE_STATES`, `CREATURE_TUNING`, `DIFF_TUNE`, `CREATURE_MODES`. `src/sim/creature3d.js` becomes a re-export so
  existing imports keep working.
- **Rule.** No behaviour change. `SEG` becomes an instance field `this.seg` (default 20) with typed arrays sized at
  construction (needed by E17; Chapter I keeps 20).
- **Fixed-rate step.** Add the fixed 60 Hz call path described in §3 and prove equivalence.
- **Verification.** Before/after seeded runs: for 20 seeds × 8 sections × 3 difficulties, record the state sequence,
  positions every 0.5 s and every emitted event; the JSON must be identical (variable-dt path) and equivalent within
  0.1 m / identical state sequence (fixed 60 Hz path). The existing creature pacing and stuck sims re-run green.
- **Timing.** Immediately after the current polish pass, behind a short freeze of creature edits.

### E02 · Section clocks and determinism · S · P0

- **Purpose.** One time base for everything that moves, so routes are learnable, retries are exact, and ghosts and bots
  compare like with like.
- **Sim API** (`src/sim/clock3d.js`):
  ```js
  class SectionClock {
    constructor(sectionCount)
    t                          // seconds in the current section, advanced only by step()
    step(dt)                   // called once per fixed step with PHYSICS_DT
    enter(sectionIndex)        // keeps running; per-section clocks t[i] advance only inside the active window
    timeOf(sectionIndex)       // that section's clock
    snapshot() → { t: Float64Array }   restore(s)
    reset(sectionIndex, t0 = 0)        // on waking: the lamp's section restarts at the lamp's clockT
  }
  ```
  Movers own a local time `m.t += dt × m.timeScale`, where `timeScale` ramps (`rampTo(target, seconds)`) for the
  Stopping, the runaway and still-light (E13, E23).
- **Rules.** Waking resets the woken lamp's section clock to `lamp.clockT` (default 0) and the neighbouring sections' to
  0; sections are authored so that t = 0 is a good phase (the first ride arrives 2–3 s after control returns). Seeded
  RNG streams (`U.rng`) are re-seeded from `chapter.creature.seed + sectionIndex` on waking.
- **Verification.** Determinism test: two runs of the same recorded input log produce bit-identical player trajectories
  (hash of positions per step) on every chapter.

### E03 · Beats v2 (sequences, triggers, checkpoint snapshots) · M · P0

- **Purpose.** Data-driven set-pieces and story beats with exact restore on waking. Replaces the Y-trigger loop in
  `Game3D._updateProgress`; hints keep their own queue.
- **Data.**
  ```js
  beats: [{
    id: 'ch2-beat-stopping', section: 's7', once: true,
    when: { attached: 'ch2-anc-esc-last' },
    do: [
      ['sound', 'ch2.jam.telegraph'],
      ['after', 4, [
        ['moverScale', { group: 'ch2-engine' }, 0, 1.2],
        ['volume', 'ch2-vol-din', { enabled: false }],
        ['music', 'silence', 'sil.ch2.stopping'],
        ['creature', 'path', 'ch2-path-jam', { lethal: false, hold: 'listen' }],
        ['flag', 'jammed', true],
      ]],
    ],
  }, {
    id: 'ch2-beat-runaway',
    when: { any: [{ after: ['ch2-beat-stopping', 24] }, { noiseCount: ['ch2-vol-hall', 3, 0.5, 20] }] },
    do: [['moverScale', { group: 'ch2-engine' }, { byDiff: [1.6, 1.8, 2.0] }, 0.8],
         ['volume', 'ch2-vol-din', { enabled: true }], ['creature', 'mode', 'frenzy'],
         ['lamp', 'enable', 'L2-9'], ['music', 'cue', 'cue.ch2.runaway']],
  }]
  ```
- **Conditions** (combinable with `any`, `all`, `not`): `below: y` · `inBox: box | volumeId` · `attached: anchorId |
  [ids]` · `onSolid: solidId` · `interact: interactableId` · `name: nameId` · `flag: [name, value]` · `after: [beatId,
  seconds]` · `timeInSection: s` · `noiseCount: [volumeId | 'any', count, minLoud, withinSeconds]` · `creatureNear: m` ·
  `frontProgress: [frontId, s]` · `playerStill: s` · `lit: keptId | anchorId` · `stillness: ≥v` · `breath: ≤v` ·
  `entitled: bool` · `difficulty: key | [keys]` · `ending: 'A' | 'B' | 'C'`.
- **Actions:** `hint` · `sound` · `music` (`cue` / `stem` / `silence`) · `rumble` · `trigger` (emits `trigger` and
  `trigger:<name>` exactly as `Game3D._fireTrigger` does today) · `lamp` (`kindle` / `snuff` / `enable`) · `moverStart` ·
  `moverStop` · `moverScale` (target, scale, ramp s) · `moverSet` (id, t) · `solid` (`{ active, fall }`) · `anchor`
  (`{ broken, active }`) · `hazard` · `volume` (`{ enabled, surfaceTo: [y, s] }`) · `front` (`start` / `stop`) ·
  `creature` (`mode` / `path` / `relocate` / `release` / `action`: `plunge` · `knockOn` · `gather` · `bow` · `freeze` ·
  `comeApart` · `settle`) · `kept` (`wake` / `hold`) · `interactEnable` · `noise` · `flag` · `after` (s, [actions]) ·
  `seamSwap` · `demoGate` · `chapterEnd` · `ending`.
- **Legacy.** Every section `triggers[]` entry `{ y, name, data }` compiles to `{ when: { below: y }, do: [['trigger',
  name, data]] }`. Chapter I behaves exactly as today.
- **Sim API** (`src/sim/beats3d.js`): `new Beats(level, ctx)` where `ctx` exposes the systems (movers, volumes, fronts,
  creature, kept, lamps, bus); `step(dt)`; `fire(id)`; `snapshot()`; `restore(s)`; `reset()`.
- **Snapshots.** Taken on every lamp kindle (E07): fired-beat bitset, pending `after` timers with remaining time, flags,
  mover states (E13), solid/anchor/hazard states (`active`, `broken`, `fallen`, `load`), volume states (`enabled`,
  `surfaceY`, target), front states (`s`, `active`), creature mode and path progress, Kept positions and states, clock
  (E02). `restore()` on waking reproduces the world exactly; beats fired before the lamp keep their end state, later
  ones reset.
- **Events.** `beat:fire { id }`.
- **Verification.** Harness: every referenced id exists (dangling ids fail the build); for every lamp, wake → wait 5 s →
  snapshot equals the lamp's snapshot advanced by 5 s; Chapter I trigger timing identical to today.

### E04 · Chapter framework, seams, depth offset · M · P0

- **Registry** (`src/data/chapters/index.js`):
  ```js
  export const CHAPTERS = [
    { id: 'ch1', title: 'The Underspire', load: () => import('./ch1-underspire.js'), depthOffset: 0,
      entitlement: 'demo', next: 'ch2', seamOut: 'seam-1-2', theme: 'underspire' },
    { id: 'ch2', title: 'Lamphold', load: () => importPack('ch2'), depthOffset: 600,
      entitlement: 'full', next: 'ch3', seamIn: 'seam-1-2', seamOut: 'seam-2-3', theme: 'lamphold' },
    // ch3 The Mere (1180), ch4 The Keeping (1700), ch5 The Still Flame (2220)
  ];
  ```
  `ch1-underspire.js` re-exports today's `LEVEL_DATA_3D` merged with Chapter I additions (lamps, beats, names,
  interactables, the hook) and `seam-1-2`. `importPack(id)` resolves the hashed lazy file from the build manifest
  `chapters.manifest.json` (RELEASE T16) in production and a plain path in development.
- **Game3D API.**
  - `prefetchChapter(id) → Promise`: fetches the module, its texture set, kits and music stems into memory (no GPU
    upload). Called at S8 for entitled players and at the hook's purchase for buyers.
  - `loadChapter(id, { difficulty, lampId })`: cold start (menu, Continue, chapter select).
  - `swapChapter(id)`: hot swap at a seam (below). Builds the new `Level3D` and systems, calls
    `creature.reset/setSection`, builds the level view incrementally (≤ 1 frame over budget), precompiles shaders,
    disposes the old chapter's geometry/materials/textures that are not shared (checked with `renderer.info`). **The XR
    session and `setAnimationLoop` stay alive.**
  - `canEnter(id)` (E06), `chapterId`, `level.depthOffset`.
- **Seams.** `src/data/chapters/seams.js` exports `SEAM_1_2` … `SEAM_4_5`. A seam is authored once in its own frame:
  `{ id, solids, anchors, decor, lights, movers, lamps, beats, frame: { ch1: { x, y, z }, ch2: { x, y, z } } }`; each
  chapter merges it at its frame offset, so the seam geometry is identical in both chapters. A swap is only allowed by a
  `seamSwap` beat when the player is **grounded with no rope attached** (Chapter I → II: on the Lamplighters' roof);
  fallback: under the fade sphere ≤ 300 ms. Player position and velocity are transformed by `frameB − frameA`; seam
  movers carry their clocks across.
- **Demo buyers.** After purchase the pack downloads during the chandelier swing and landing; if it is not ready at the
  swap point, the seam's `wait` beat holds the lift (diegetic). On failure the end card returns with the offline line.
- **Depth.** Displayed depth = `depthOffset + max(0, −y)`; `U.depthMeters(y, offset = 0)`.
- **Memory.** At most two chapters' data in memory (current + prefetched next); GPU: the current chapter plus the seam.
- **Events.** `chapter:prefetch { id }`, `chapter:ready { id }`, `chapter:swap { from, to }`, `chapter:complete { id,
  time, deaths, woken }`.
- **Verification.** Harness loads every chapter module; seam consistency (seam objects identical after offsets);
  Node swap test (player state equal after transform; seam mover phase continuous); device: swap hitch ≤ 1 frame over
  budget, no XR session loss, `renderer.info` returns to the pre-swap baseline ±5 %.

### E05 · Saves v2 · S · P0

- **Store.** `src/meta/save.js` (not sim): IndexedDB database `abyssalTether3d`, version 2, stores `profile` (one record)
  and `ghosts`; `navigator.storage.persist()` requested at boot (T3); a localStorage fallback; an in-memory adapter for
  Node tests. Writes are debounced (≥ 1 s), asynchronous and never inside the frame loop; a failed write never throws
  into the game. Settings stay in localStorage through today's `Storage`; the entitlement cache is owned by E06 only.
- **Schema.**
  ```js
  { schema: 2, createdAt, updatedAt,
    run: { chapter, difficulty, lampId, snapshot, time, deaths, woken } | null,
    chapters: { ch1: { reached: true,
      byDiff: { normal: { completed, best, fewestDeaths, medals: { iron, brass, still }, splits: [] } },
      trials: { 'T1-1': true }, unwoken: { normal: true } } },
    names: { 'N1-1': 1729350000000, own: 1729350100000 }, ownPattern: [2, 1, 3],
    endings: { A: false, B: true, C: false, last: 'B' },
    remnants: { ch1: [{ x, y, z, pose, cause, s }] },
    totals: { woken, deathsByCause: { impact, fall, hazard, creature, crush, drown, kept, still }, playTime },
    options: { leaveNoRemnants, traceNames, ghosts, splits } }
  ```
- **Migration.** On first v2 launch, today's localStorage keys (`abyssalTether3d.v1.best.<diff>`,
  `fewestDeaths.<diff>`, `deepest.<diff>`, run and completion counters) are copied into `chapters.ch1.byDiff`; v1 keys
  are left in place, read-only.
- **Your Name.** `ownPattern` is generated once per profile from a seeded RNG (2–4 groups of 1–4 knocks), so every
  player's own Name is different; the Kneeling One knocks *your* pattern.
- **Verification.** Node tests with the in-memory adapter: round trip, migration from a v1 fixture, corrupted record →
  fresh profile (records preserved where readable).

### E06 · Entitlement and the demo gate · S (+ device spike) · P0

- **Adopt** `docs/abyssal-tether-3d/pwa/entitlement.draft.js` as `src/platform/entitlement.js` with its behaviour
  unchanged: SKU `abyssal_tether_full_game` (case-sensitive), Digital Goods API at `https://quest.meta.com/billing`,
  `purchase()` through Payment Request with `data: { sku }`, restore through `listPurchases()`, cached ownership honoured
  offline indefinitely after one verification, 24 h propagation grace, demo outside a store install.
- **Gating.** `Game3D.canEnter(id)` → `entitlement.canPlayChapter(n)` (Chapter I always). The `demoGate` beat action
  pauses the sim and shows the end card (E27) if `state !== 'full'`.
- **Activation.** The end card's buy button is bound with `input.onSelect(hand, fn)` (E24) so `purchase()` runs
  **synchronously inside the XR `select` handler** of the pointing hand (T11). Desktop: a click handler.
- **On success.** Unlock at once, `ensurePack('ch2')` (E04), crumble the panel, resume; confirm with `listPurchases()` in
  the background.
- **M0 device spike.** On an ALPHA store install: (1) does an XR `select` count as user activation for `show()`;
  (2) does the dialog blur or end the session; (3) does `listPurchases()` answer offline; (4) the `data` shape. If (1)
  fails, the owner chooses the fallback (CHAPTERS §14 Q3) before Chapter II production.
- **Events.** `entitlement:change { state, source }`, `purchase:start`, `purchase:result { result }`.
- **Verification.** The draft's nine mocked scenarios run in CI; RELEASE §10.8 on ALPHA.

### E07 · Waking lamps · S · P0

- **Data.**
  ```js
  lamps: [{ id: 'L2-3', x, y, z, standAt: { x, y, z, yaw }, section: 's3', radius: 4,
            litIn: ['normal', 'nightmare'], exam: false, start: false, exit: false, clockT: 0 }]
  ```
  `litIn` lists the difficulties on which the lamp works (Sandbox uses `normal`); chapter-start lamps list all three;
  exam-start lamps list `normal` and `nightmare` (CHAPTERS §3.4). Chapter I gains `lamps[]` equivalent to its eight
  checkpoints plus the perch (L1-7b) and the Mark (L1-9). A chapter without `lamps[]` falls back to today's
  `checkpointFor()`.
- **Sim API** (`src/sim/lamps3d.js`): `new Lamps(level, diffKey)`; `step(player)` kindles a lamp when the body passes
  within `radius` (and the lamp is lit on this difficulty and not yet kindled), returning it; `current`; `reset()`.
- **Integration.** On kindle: `game.checkpoint = lamp.standAt`, `beats.snapshot()` (E03), save the run (E05). On death →
  **waking**: place the player at `standAt`, restore the snapshot, ramp the lantern from 0 over 0.8 s. The game's first
  frame is a waking at L1-1.
- **Events.** `lamp:kindle { id }`, `player:wake { lampId }` (UI: the death panel's button reads **Wake**).
- **Render.** `LampsView` (instanced): cold, kindling (0.6 s flare), lit; flame card.
- **Audio/haptics.** Kindle: soft flare and chime, double pulse on both hands (0.2). Waking: a drawn breath, the lantern
  catching, one long swell (0.3).
- **Verification.** Every `standAt` rests on a floor (today's checkpoint integrity test); no `standAt` on a crumble or
  dynamic solid; lamp spacing: the bot's optimal route time between consecutive Normal lamps ≤ 48 s (proxy for
  ≤ 120 s of median death-free play; recalibrated from telemetry); every exam phase has a lit lamp ≤ 10 s of optimal
  route before its trigger; wake-to-control ≤ 10 s.

### E08 · Remnants · S–M · P0

- **Sim API** (`src/sim/remnants3d.js`): `new Remnants({ maxVisible: 12, maxStored: 24, turn: false })`;
  `add({ x, y, z, cause, section }) → pose | null`; `list`; `update(dt, player, light)` (turning, from Chapter IV);
  `serialize()` / `load(data)`.
- **Pose from cause:** `impact` / `fall` → *lying*; `hazard` → *slumped* (draped over the rebar or blades, stone, no
  wound); `crush` → *kneeling*; `drown` → *curled* (settles on the bottom); `kept` → *reaching*; `still` → *standing,
  lantern raised*; `creature` → **no remnant**: `creature.extraPlates++` for the rest of the chapter.
- **Rules.** Never collide; nudged ≥ 1.5 m from any anchor; oldest crumble to dust beyond 12 visible; Abyss persists them
  across runs (a trail of attempts); off in Sandbox; the *Leave no remnants* option clears and disables them. From
  Chapter IV (`chapter.remnantsTurn = true`), an unlit remnant outside the head's view cone turns to face the player
  (never lethal; never moves position).
- **Render.** `render/remnantsView.js`: one `InstancedMesh` per pose (figure kit), the player's gauntlet variant; crumble
  FX on removal.
- **Events.** `remnant:add { pose, x, y, z }`, `remnant:crumble`.
- **Verification.** Unit: cap, persistence, pose mapping; a remnant never lands within 1.5 m of an anchor.

### E09 · Interactables and hand gestures · S · P0

- **Data.**
  ```js
  interactables: [{ id: 'ch1-int-marklamp', kind: 'take', x, y, z, radius: 0.35, hands: 'left', grip: true, hold: 1.0,
                    enabledWhen: { flag: ['hookReady', true] }, onDone: 'ch1-beat-lift' }]
  ```
  Kinds: `take` (the Mark Lamp), `hood` (IV-1), `altar` (III-2), `flameCup` (ending A: `hands: 'both'`, `gesture:
  'cup'`, `requires: { bow: true }`), `flameKindle` then `raise` (ending B), `door`, `lever`, `bed`.
- **Detection.** XR: the hand(s) within `radius`, grip held, the hand **not tethered**, for `hold` seconds. Gestures from
  hand poses and the calibrated head (T14): `raise` = left hand ≥ 0.1 m above the head; `cup` = both hands within
  0.18 m of each other and of the target; `kneel` = head below 0.75 × standing height (or A held). Desktop: look within
  10° and ≤ 2 m and hold E (F for kindle). The bot sets `intent.hands[h].interact` and `intent.gesture` directly.
- **Sim API** (`src/sim/interact3d.js`): `new Interactions(level, list)`; `update(dt, intent, player, handPoses)`;
  `progressOf(id)`.
- **Events.** `interact:start { id }`, `interact:progress { id, t }`, `interact:done { id }` (beats listen).
- **Render.** A subtle rim on the target while a hand is in range; a progress ring on the object (no HUD).
- **Haptics.** A rising hum for `hold`; a click on done.
- **Verification.** Every interactable is reachable from a standing area (data check: within 0.6 m horizontally of a
  floor at 0.8–1.6 m above it, or flagged `hanging: true`).

### E10 · Knocks and Names · M · P0

- **Detector** (input side, `inputManager.js`): each frame, per **untethered** hand, cast the segment from the previous
  grip position to the current one (≤ 0.3 m) against solids and knockable decor; a hit with inward speed ≥ 1.1 m/s and
  ≥ 70 % of the hand's velocity along the inward normal yields a knock `{ x, y, z, hand, targetId, speed }` into
  `intent.knocks` (0.12 s debounce per hand). Desktop: K raycasts 1.6 m along the view.
- **Data.**
  ```js
  names: [{ id: 'N2-3', title: 'HEDDA', pattern: [1, 3, 2], at: { solid: 'ch2-sol-ledge7' } | { decor: 'id' }
            | { kept: 'id' } | { creature: 'crown' }, radius: 1.2, codex: 'Wound the chandeliers every morning. Never once fell.' }],
  knockWalls: [{ id, x, y, z, normal, pattern: [3], interval: 6, radius: 12,
                 respond: 'echo' | 'door' | 'creature' | 'name', door: 'solidId', name: 'N1-3' }]
  ```
  `pattern` = knocks per group; the notch carving decor is generated from it (render).
- **Matcher** (`src/sim/knock3d.js`, `new Knocks(level, names, knockWalls, tolerance)`): knocks < 0.45 s apart form a
  group; a 0.55–1.3 s gap starts a new group; 1.5 s of silence ends the sequence; compare per target with the
  difficulty's tolerance (±40 / 30 / 30 %, Sandbox ±50 %). A match on a Name's `at` learns it. Knock walls play their
  rhythm within `radius` and respond when answered. Every knock is also `noise.emit(…, 0.6, 'knock')` (E11); a knock
  into a horn mouth is relayed (E11). The tally wall adds a notch per knock.
- **Own Name.** The profile's `ownPattern` (E05). The Kneeling One plays it as knocks in the figure and as haptic pulses
  on both controllers; ending C matches it on `{ creature: 'crown' }` while the crown is bowed.
- **Trace Names** option: grip held 2 s on a carving learns it; the wrist plays a learned Name back as synthetic knocks
  at the hand.
- **Events.** `player:knock { x, y, z, hand, targetId }`, `name:learned { id }`, `knockwall:knock { id }`,
  `knockwall:answered { id }`, `door:open { id }`.
- **Haptics.** Your knock: sharp 12 ms at 0.8; a learned Name: its rhythm on both hands.
- **Verification.** Rhythm-matcher unit tests (every pattern, tolerance edges, rope motion never produces knocks because
  tethered hands are excluded); data check: every knock surface lies at chest height (0.9–1.6 m above a floor) within
  0.6 m of a standing area; the bot reaches every Name's position on Normal by its mastery route.

### E11 · Noise and hearing v2 · M · P0 (legacy + knocks) / P1 (full)

- **Sim API** (`src/sim/noise3d.js`): `new Noise(level, volumes, rules)`; `emit(x, y, z, loud, kind)` into a ring buffer
  of 16 `{ x, y, z, loud, kind, t }`; `floorAt(x, y, z)` (masking); `step(dt)`; `strongestHeard(listener, threshold)`.
- **Sources** (bus listeners): `player:land` (loud = impact / lethal), `player:wallhit`, `rope:jolt`, yank (0.25 per s
  while grip > 0.5 on a tethered hand), reel (0.1 per s), `platform:crumble` (0.6), `grapple:break` (0.7),
  `player:knock` (0.6), `player:splash` (min(1, v / 20)), bell rings (0.4–1.0), raft creaks (0.3), mover `noise` fields,
  and continuous movement (0.05–0.3 by speed).
- **Perception.** `perceived = loud / (1 + (d / 12)²) − floor`; thresholds 0.12 / 0.09 / 0.06 (N / NM / AB). Sources
  under water × 0.25; inside `hush` × 0; `mask` volumes and mover din add to `floor`.
- **Creature hearing** (per section `creature.hearing`): `'legacy'` (Chapter I; today's stall/listen model untouched) or
  `'noise'` (II–V). New state **INVESTIGATE** (between OBSERVING and APPROACHING): the head travels to the strongest
  heard point at approach speed, listens 2–4 s with its pits lit, then resumes its mode; hearing the player again while
  listening calls the existing `_heard()`. **Masked hearing:** when the floor exceeds the source it cannot hear; its
  fronds see within 10 m (`frondSight`).
- **Horns** (Chapter IV): `horns: [{ id, mouth: { x, y, z }, dir, pair: 'hornId', pitch }]`; a noise within 2 m of a
  mouth is re-emitted at the paired mouth (× 0.9) and suppressed at the source (× 0.3); while the creature's path is
  `hidden` inside the network, its audio is routed out of every mouth (E26).
- **Rope telegraph.** When the solid the creature clings to shares a `group` with the mount solid (`anchor.mountId`) of
  an attached anchor, emit `rope:telegraph { hand, intensity }` (≤ 10 Hz; intensity from distance and speed).
- **Events.** `noise:emit { x, y, z, loud, kind }`, `creature:investigate { x, y, z }`, `rope:telegraph`.
- **Verification.** Unit tests (falloff, masking, underwater, horn relay); the creature pacing sims extended per chapter
  (careful play survives Normal; stalling dies at ~15 / 10 / 6 s); Chapter I `legacy` regression identical.

### E12 · Records: medals, trials, splits, ghosts, stats · S–M · P0 (ghosts P3)

- **Module** `src/meta/records.js`: medals per chapter and difficulty from `chapter.medals` thresholds; section splits
  (best per section, delta to best and to ghost); trials as predicates over bus events and beat flags, evaluated live
  (failure known at once) and at chapter end, e.g. `T2-3 Under the Deck`: no `player:land` on solids tagged `span-deck`
  between beats `ch2-beat-span-start` and `ch2-beat-span-end`; Unwoken (no `player:death` in the chapter run); stats.
- **Ghosts.** Recorder at 20 Hz: body position as Int16 at 1 cm relative to the current section's origin, each hand's
  anchor index (Uint16, 0xFFFF = none), section index on change. Best run per chapter × difficulty in IndexedDB (E05),
  ~290 KB per 5 min. Replays **positions**, not inputs, so ghosts survive tuning changes. Playback: one translucent
  figure and two rope lines (3 draw calls).
- **Events.** `medal:earned`, `trial:complete { id }`, `trial:failed { id }`, `split { section, time, delta }`.
- **Verification.** Unit tests for each trial predicate with recorded event logs; ghost round trip.

### E13 · Kinematic movers · M · P0 (`steps`, `pendulum`, `bob`) / P1 (all)

- **Purpose.** Live anchors and moving floors (rule II), plus every scripted motion in set-pieces: the iris, the cradle
  chain, chandeliers, lifts, cranes, the engine, rafts, diving bells, cages, held-ring lifts, prism engines, the
  Throat's ribs, falling debris.
- **Data.**
  ```js
  movers: [{
    id: 'ch2-mov-chand-3', group: 'chandeliers', section: 's3',
    kind: 'pendulum', pivot: { x, y, z }, plane: 'x', length: 30, amp: 0.55, period: 9, phase: 0.25,
    carry: { solids: ['…'], anchors: ['…'], hazards: [], volumes: [], decor: ['…'], lights: [] },
    start: 'auto' | 'beat', timeScale: 1, maxSpeed: 13,
    rail: true, glint: true, noise: 0.15, sound: 'chandelier', tick: 'apex',
    cutsRopes: false, noCarry: false, still: false,
    visual: { rotate: { axis: 'z', rate: 0 } },      // render-only rotation (wheels, gears, prisms)
  }]
  ```
  **Kinds** (children keep their authored offset and **only translate**; authored positions are the pose at t = 0, or
  the rest pose for pendulums):

  | Kind | Parameters | Pose (closed form unless noted) | Used for |
  |---|---|---|---|
  | `pendulum` | `pivot, plane ('x'\|'z'), length, amp (rad), period, phase` | θ = amp·sin(2π(t/period + phase)); offset = (L sinθ along plane axis, L(1 − cosθ), 0); velocity analytic (parallel linkage: never rotates) | chandeliers, cages, the hook's chandelier |
  | `orbit` | `center, axis, radius, period, phase` | children circle the axis keeping orientation | the governor, wheel rim rings |
  | `lift` | `from, to (offsets), travel, dwell: [a, b], ease` | ping-pong between offsets with sine or linear easing | lifts, counterweights, express drops |
  | `path` | `points (offsets), speed \| legs: [{ dur, hold, ease }], loop: 'once'\|'loop'\|'pingpong'` | arc-length parametrised polyline | crane trolleys, runaway trolleys, the Throat's ribs |
  | `escapement` | `points, step: 1.5, tick: 1.2, move: 0.25` | advance `step` metres every `tick`, moving for `move` s | the escapement rail |
  | `steps` | `steps: [{ at, dx, dy, dz, dur, ease }]` | piecewise offsets from `start` | the iris leaves, the cradle chain paying out, the Span's last span, lurches |
  | `bob` | `amp: { x, y, z }, period, phase` | sinusoidal offset | rafts, the Mark chamber's breathing coil plates (5 cm) |
  | `driven` | `pivot, plane, length, damping, gain, maxAmp` | **integrated**: θ̈ = −(g/L)·θ − c·θ̇ + k·F, F = player weight while grounded on a carried solid + yank force while tethered to a carried anchor | hung houses (II-6) |
  | `pulled` | `path, pullAnchor, gain, returnSpeed` | **integrated**: s += gain·yank·dt while the player yanks a tether on `pullAnchor`; returns at `returnSpeed` | counterweight calls, drawbridges |
  | `ballistic` | `v0, gravityScale, drag, floorY, startOn` | **integrated**; suspended while lit by still-light (E23) | debris from fronts (E19), stilled rubble falling |
- **Sim API** (`src/sim/movers3d.js`): `new Movers(level, list, clock)`; `step(dt)` (first thing in each fixed step);
  `poseOf(id)`; `start(id)`, `stop(id)`, `set(id, t)`, `setScale(idOrGroup, scale, rampSeconds)`; `snapshot()` /
  `restore(s)`; `spawnDebris(fromSolidId, v0)` (takes a piece from the pre-fractured pool, ≤ 64 live).
- **Per step.** `t_m += dt × timeScale` (ramped); compute offset and velocity; for every child write the box
  (`minX…maxZ` = base + offset) or point (`x, y, z`), `vx, vy, vz`, and this step's displacement `dx, dy, dz`. Children
  are marked `dynamic` at build (E14). Closed-form kinds outside the active window are skipped and recomputed exactly on
  wake; integrated kinds keep their state and are frozen.
- **Limits.** ≤ 40 active movers per window; carried anchor speed ≤ 13 m/s (`maxSpeed`, verified).
- **Events.** `mover:tick { id }` (escapement ticks, pendulum apexes), `mover:start` / `mover:stop { id }`,
  `mover:arrive { id }` (lifts).
- **Render** (E25). One `InstancedMesh` per mover kit; only moving instances get per-frame matrices; `visual.rotate` is a
  render-only angle; `rail: true` adds the moving ring's path to the section's dashed phosphor line mesh; `glint: true`
  brightens the ring's marker while its velocity points toward the hand that aims at it.
- **Audio** (E26). Mover voices (`sound`), tick/apex events, a rumble through the rope scaled by anchor speed.
- **Verification.** Closed form vs a numerically integrated reference agree within 1 mm; max anchor speed ≤ 13 m/s;
  **crush clearance**: no two solids (≥ 1 dynamic) come closer than 1.2 m in a player-accessible region unless the region
  is tagged `crushZone` and its mover has a ≥ 1.5 s telegraph; the bot supports phase waits (`{ wait: { mover, phase:
  [a, b] } }`) and rides (`{ ride: moverId, release: { phase } }`).

### E14 · Level3D dynamic sets and data pass-through · S · P0

- **Dynamic sets.** At construction `Level3D` reads `data.movers[*].carry` (and Kept-held anchors, E22) and marks those
  objects `dynamic: true`. Dynamic objects are **excluded from the Y-bucket indices** and kept in `level.dynSolids`,
  `level.dynHazards`, `level.dynAnchors`. `querySolids`, `queryHazards`, `anchorsNear`, `segmentBlocked` and `raycast`
  run the static buckets as today, then append active-window dynamic items that pass a cheap AABB or radius test (≤ 64
  per list; same stamp de-duplication; no allocation). Targeting, line of sight, lasers and the creature therefore see
  movers automatically.
- **Active window.** `setActiveWindow(sectionIndex)` limits dynamic queries and stepping to sections i−1…i+1.
- **Pass-through.** The build copies these optional fields (today it rebuilds anchors and solids field by field and would
  drop them):
  - anchors: `air`, `still`, `held`, `group`, `mountId` (solid it is bolted to; filled automatically when an anchor sits
    0.25 m off a solid), `assist`; plus runtime `vx, vy, vz` (0 for static);
  - solids: `skin` (visual set), `group`, `still`, `hollow` (the creature can travel inside), `breach`, `collapse`
    (front id), `noCarry`, `crushZone`, plus runtime `vx…vz`, `dx…dz`;
  - hazards: `group`, `activeWhen` (`'unlit'` for cage occupants);
  - `data.depthOffset` → `level.depthOffset`.
  New top-level lists are read by their systems from `level.data`, filtered with `inVariant`.
- **reset()** also restores dynamic objects to their base pose (movers then re-pose them).
- **Verification.** Query parity (a dynamic box is returned exactly when it overlaps); perf: queries with 64 dynamic items
  cost ≤ 10 % more than today; Chapter I query results unchanged.

### E15 · Rope v2: moving anchors, elastic catch, cutting, anchor flags · S · P0

All in `physics3d.js` (`Rope3D`, `TetherSystem`), with numbers in `config3d.js`.

- **Relative constraint.** `constrain(p)`: radial speed measured **relative to the anchor**, `vr = (v − vA) · n`; remove
  only an outward relative part (`v −= vr · n` when `vr > 0`). The projection already uses the anchor's current position,
  which the movers update before the player integrates. **Release keeps absolute velocity**, so momentum theft needs no
  special code.
- **Reel.** The tangential-gain rule (conserving `v_t · L`) works on the relative velocity: decompose `v − vA`, scale its
  tangential part, add `vA` back.
- **Tension** uses the relative speed: `|v − vA|² / L − g · ny`.
- **Elastic catch** (every high-speed arrest, static or moving anchor): `CONFIG.rope.catch = { speed: 12, stretch: 0.12,
  time: 0.25 }`. When the rope goes taut with relative radial speed above `speed`, the constraint lets the rope stretch up
  to `L · (1 + stretch)` and removes `vr` through a critically damped spring over `time` instead of in one step. Emits
  `rope:catch { hand, speed }`. It changes how Chapter I's frayed-ring arrests feel (S6): the harness re-verifies Chapter
  I, and S6's timing comparison is re-baselined.
- **Moving-anchor assist.** `findTarget` adds `DIFFICULTY[k].rules.movingAssist` (0.6 / 0.4 / 0.2 m) to `rayAssist` for
  anchors moving faster than 0.5 m/s, plus any per-anchor `assist`. The existing stickiness keeps the highlight on a
  moving ring; attachment is instant (no lead needed).
- **Cutting.** Movers flagged `cutsRopes` (falling deck pieces, front debris) test segment(player → anchor) against their
  boxes each step, for flagged active movers only, and sever with release reason `'cut'`. Fronts break anchors with
  reason `'front'` (E19).
- **Anchor flags** in `TetherSystem.step`: `air` → `player.onAir = true` (E20); `still` → targetable and holdable only
  while lit (E23); losing light starts the difficulty's warning, then breaks with reason `'lightlost'`; `held` → the
  anchor's position and velocity are written by its Kept (E22, smoothed).
- **Events.** `rope:catch`; `grapple:release` reasons gain `'cut'`, `'front'`, `'lightlost'`.
- **Verification.** Unit tests: hanging from a pendulum ring conserves relative tangential motion; release velocity
  equals absolute velocity; a 13 m/s arrest with the catch never exceeds 1.12 L and produces no jolt spike above the
  haptic clamp; Chapter I full-route regression.

### E16 · Moving contacts: carry, relative impacts, inheritance, crush · M · P0

All in `Physics3D` (`physics3d.js`).

- **Carry.** If `player.grounded` and `player.groundSolid.dynamic` and not `noCarry`: add the solid's `dx, dy, dz` to the
  player before integration. Running, braking and friction work on the velocity **relative to the ground solid**
  (target = v_solid + v_run).
- **Relative impacts.** In `resolveCollisions`, the normal velocity for a dynamic solid is `(v − vSolid) · n`; only that
  relative component is removed, and lethality uses the relative fall speed. Landing on a descending lift at matched
  speed is gentle; a piston moving into you hits hard.
- **Inheritance.** Velocity is always absolute, so leaving a moving floor (jump, walk-off, release) keeps its speed.
- **Crush.** After the three resolution passes, if residual penetration > 0.12 m remains with at least one dynamic solid
  involved, or two contact normals oppose (dot < −0.5) with a dynamic solid closing: `kill(player, tethers, 'crush')`.
- **Dynamic hazards** (saws, gear teeth) come through `queryHazards` (E14); `activeWhen: 'unlit'` hazards are active only
  while their Kept is unlit (E22).
- **New death causes.** `'crush'`, `'drown'` (E20), `'kept'` (E22), `'still'` (E23); each needs a death line (E27), a
  remnant pose (E08) and an audio sting (E26).
- **Verification.** Unit tests: standing on a lift moving up and down; walking across a moving floor; jumping off a moving
  platform; landing on a slab falling at matched speed is not lethal; a piston closing a 0.6 m gap kills with
  `'crush'`; the crush-clearance check (E13).

### E17 · Creature v2 · L · P0 (path) / P1 / P2

Built on E01's modules. Every mode is opt-in per section or by beat; Chapter I uses only `path` (the Spiral, the hook,
the hidden S5 path) on top of today's modes.

- **Per-chapter body.** `chapter.creature = { seg, variant, plates, hearing, seed }`; `seg` 20 / 22 / 24 / 28 / 32 for
  Chapters I–V, fixed at construction (no runtime growth). `extraPlates` (from Mason kills, E08, and `gather`) is a
  render count only.
- **Paths** (`creaturePaths`):
  ```js
  creaturePaths: [{ id: 'ch1-path-spiral',
    points: [{ x, y, z, speed: 9, hold: 0, listen: false, look: 'player' | 'lamp' | 'flame' | { x, y, z } }],
    lethal: true, hidden: false, snuffRadius: 0, bulge: false,
    rubberBand: { target: 'player' | 'front:<id>', lead: [6, 8], speedMin: 3, speedMax: 14, gain: 0.8 },
    then: 'frenzy' | 'hunt' | 'escape' | 'dormant' | 'hold' }]
  ```
  The head follows the spline (points are authored on surfaces); the body follows the breadcrumb trail as today.
  `hidden: true`: not drawn, no kill, emits `wall:bulge` every ~1.5 m and wall-travel audio (inside solids tagged
  `hollow`); reaching a `breach` solid deactivates it and spills debris (`creature:breach`). `rubberBand` keeps the head
  at a distance window relative to the player or a front. `snuffRadius > 0`: lamps within that distance of the head go
  out (`lamp:snuff`), and `safeLight` volumes whose lamps are all out switch off (E18).
- **`safeLight` avoidance.** Steering (`_detour`) treats enabled `safeLight` volumes as blocked; a player inside one is
  unreachable: it waits at the edge, listening.
- **INVESTIGATE and masked hearing** (E11).
- **`waterline`** `{ volumeId, maxDepth: 1.5 }`: water deeper than `maxDepth` is a boundary for steering; it patrols the
  rim point nearest the player; splashes within 40 m start a BURST to the nearest rim point; a player more than 3 m under
  is unreachable (it listens; the stall model pauses while the breath clock runs).
- **Actions** (by beat):
  - `plunge { depth, duration, offset: 3, mercy: { breathFrac, maxSeconds } }`: the head descends a vertical line into
    the water ≥ 3 m from the player, listening; lethal within the kill radius if it hears the player; withdraws after
    `maxSeconds` or when `player.breath ≤ breathFrac` (Normal 0.25 / 8 s; Nightmare 0.15 / 10 s; Abyss none / 12 s).
  - `knockOn { target, count, interval }`: the Belfry knock (audio at the target; rope haptics if the player is tethered
    to it; the target volume is non-lethal).
  - `gather { radius: 6, pause: [2.5, 2.0, 1.5] }`: an unlit Kept within `radius` of the head stops it for `pause` s and
    is consumed (`kept:gathered`); the pause is applied before any lunge check.
  - `bow { interval: 20, duration: [6, 5, 4] }`: coiled at a point, lowers its crown over it; exposes `crownBox()` (the
    knock target for ending C) and `bowed`.
  - `freeze`: ending B's petrification: `body.stone` ramps to 1 tail-to-head over 0.6 s at the lunge pose, then static
    solids are emitted around each spine point (half-size `scale × 1.2 m`) and static anchors at the back-ring segments
    (`ringSegs`), appended to the level's dynamic lists as static; the creature goes inactive.
  - `comeApart`: ending A: emits `creature:comeApart { spine }` (render swaps segments for falling figure instances);
    inactive; no collision.
  - `settle { path }`: ending C: the emptied body lies along a path (the Throat wall) and emits static ring anchors as in
    `freeze`, without the stone ramp.
- **Stillness** (Chapter V): `stillExposure` integrates while the crown is lit by still-light (E23); at the difficulty's
  threshold (0.3 / 0.45 / 0.6 s) it is **STILLED** (velocity 0, state timers frozen, limbs locked, `body.stone` = 1
  shader flag) and thaws 0.5 s after the light leaves. Steering avoids lit regions (it moves only in shadow).
- **Shadow export.** `shadowBlocks(x0, y0, z0, x1, y1, z1) → bool`: segment against capsules around the spine points
  (radius 3.5 m × scale), ≤ 32 capsules; used by E23 for shade.
- **Outputs added to `body`.** `seg`, `stone` (Float32Array(seg)), `wet` (0–1), `plates` (extra plate count), `bowed`,
  `hidden`, `rings` (positions of back rings, for render and for `freeze`/`settle`).
- **Kill radius** applies at the head only; `lethal: false` paths never kill.
- **Events.** `creature:path { id, phase: 'start' | 'end' }`, `wall:bulge { x, y, z }`, `creature:breach { solidId }`,
  `lamp:snuff { id }`, `creature:investigate`, `creature:plunge { x, y, z, phase }`, `creature:knock { target }`,
  `kept:gathered { id }`, `creature:stilled`, `creature:thawed`, `creature:freeze`, `creature:comeApart`.
- **Render** (CreatureView): variable `seg`; figure-plates and frond-arms (kit v2, ART_AUDIO_PLAN §1.6); shader states:
  wet sheen, listen glow, per-segment stone ramp, plaster/dust coat after breaches; `hidden` not drawn; `comeApart`
  figure instances.
- **Verification.** Pacing sims per chapter (careful Normal play survives; stalling dies at ~15 / 10 / 6 s); path
  near-miss distances (the Spiral ≥ 5 m at 75 % and 125 % of optimal speed; the hook crown ≥ 2.5 m from the cradle chain
  at any rope length; the Stilling overtake ≥ 4 m); plunge mercy timing; gather pause; a "screen time" proxy (fraction of
  bot run time with the head inside the bot camera's frustum within 60 m ≤ 10 %).

### E18 · Volumes · M · P0 (`hush`) / P1 (`safeLight`, `mask`) / P2 (`water`, `current`, `air`, `dark`)

- **Data.**
  ```js
  volumes: [
    { id: 'ch3-vol-mere', kind: 'water', box, surface: { kind: 'static' | 'scripted', y: -12 } },
    { id: 'ch3-vol-sluice', kind: 'current', box, force: { x: 0, y: 0, z: -4 }, vMax: 6,
      schedule: { period: 30, phase: 0, phases: [{ dur: 20, scale: 1 }, { dur: 10, scale: 0 }] } },
    { id: 'ch3-vol-bell-air', kind: 'air', box },
    { id: 'ch2-vol-gallery', kind: 'safeLight', box, lamps: ['lf:ch2-tier12'], enabled: true },
    { id: 'ch1-vol-mark', kind: 'hush', box, duck: 0.85 },
    { id: 'ch2-vol-din', kind: 'mask', box, floor: 0.6, schedule: { period: 4, phases: [{ dur: 1.5, scale: 1 }, { dur: 2.5, scale: 0.3 }] } },
    { id: 'ch4-vol-dark', kind: 'dark', box, ambient: 0, fogFar: 20 },
  ]
  ```
  Volumes can be carried by movers (`carry.volumes`): the Lamplighter's Lift's `safeLight`, the diving bells' `air`.
- **Sim API** (`src/sim/volumes3d.js`): `new Volumes(level, list)`; `step(dt)` (scripted surfaces, schedules);
  `sample(x, y, z, out)` run once per step at the body point and the head point (body + 0.5 m), filling `{ water: {
  depth, surfaceY, inWater, submerged, volumeId }, current: { x, y, z }, air, safeLight, hush, maskFloor, dark }`;
  `setEnabled(id, on)`; `surfaceTo(id, y, seconds)`; `snapshot()` / `restore()`.
- **Schedules** emit `volume:phase { id, phase, lead: 1.5 }` 1.5 s **before** each phase change (the Throat's inhale and
  exhale, hammer beats), so audio can warn.
- **The breath cycle** (V-7) is a `current` in air: exhale `force.y = +18`, `vMax 6`; inhale `force.y = −6`; 9 s period
  (exhale 3 s, pause 1.5 s, inhale 3 s, pause 1.5 s).
- **Budget.** ≤ 24 volumes per section; AABB tests only.
- **Events.** `volume:enter` / `volume:exit { id, kind }`, `volume:phase`.
- **Render / audio.** `dark` overrides ambient and fog; `hush` ducks the ambience and creature buses; `mask` is audible as
  the din; water surfaces and underwater mode (E25, E26).
- **Verification.** Data checks: volumes inside section bounds; no `safeLight` overlaps a crush zone; every `air` volume
  is reachable from water; creature sims confirm `safeLight` is never entered.

### E19 · Fronts (rubber-banded waves) · S–M · P1 (`snuff`, `collapse`) / P2 (`still`, `dark`)

- **Data.**
  ```js
  fronts: [{ id: 'ch2-front-span', kind: 'collapse' | 'snuff' | 'still' | 'dark',
    route: [[x, y, z], …],
    speed: { base: 7, gain: 0.6, targetGap: 22, min: 3, max: 12 },     // byDiff overrides in chapter.byDiff
    warn: 0.7, tag: 'span', start: 'beat' }]
  ```
  Solids, anchors, hazards and lamps tagged `collapse: '<front tag>'` are affected; their arc-length `s` along the route
  is precomputed at load.
- **Sim API** (`src/sim/fronts3d.js`): `start(id)`, `stop(id)`, `step(dt, player)`, `progressOf(id)`, `snapshot()` /
  `restore()`.
- **Per step.** `s_p` = the player's projection onto the route; `gap = s_p − s_f`; `v_f = clamp(base + gain · (gap −
  targetGap), min, max)`; `s_f += v_f · dt`. When `s_f + warn · v_f ≥ s_obj`: `front:warn { id, objId }` (creak, dust).
  When `s_f ≥ s_obj`:
  - `collapse`: solids become ballistic `noCarry` debris from the pool (E13) and their anchors break (`'front'`);
    **anchors ahead of the front never break early**;
  - `snuff`: tagged lamps go out and their `safeLight` volumes switch off;
  - `still`: movers in range freeze (time scale 0), stilled things lock, the creature freezes on contact (E17 `freeze`
    when scripted), and behind the front the player's stillness fills at 4× (death `'still'` in ~3 s);
  - `dark`: lamps go out in a climbing wave of pops; behind it the player's lamp gutters and the same 4× meter applies
    (death `'still'`, death line "Your light went out.").
- **Rules.** A front never kills directly on contact; the mercy floor (`min`) makes a stalling player lose; `max` keeps it
  from teleporting.
- **Events.** `front:start` / `front:stop { id }`, `front:warn`, `front:pass { id, objId }`, `front:progress { id, s, gap }`
  (10 Hz, for audio).
- **Render.** Collapse debris (pre-fractured pool, ≤ 64 live pieces); lamp-field attribute ranges for snuffing; the
  `uStillY` band (E25); lamp pop wave.
- **Verification.** Fairness sims per front on every variant: a bot at 75 % of optimal survives; a bot that stalls 3 s
  loses; route projection is continuous (no jumps at corners); no tagged anchor ahead of the front breaks.

### E20 · Water, swimming and breath · M · P2

In `Physics3D` with numbers in `CONFIG.water` and `DIFFICULTY[k].rules`.

- **Medium.** When `volumes.sample` reports `inWater`: gravity × 0.08 against a buoyancy of × 0.12 (an idle body drifts
  up at ~0.2 m/s); velocity relaxes toward the local current at 2.4 s⁻¹; swimming accelerates 6 m/s² along
  `intent.move` (3D: stick by head yaw, vertical from head pitch × stick magnitude, A strokes up for 0.4 s) to 1.8 m/s;
  swing pump × 0.5; **reel and yank unchanged** (the fast lane); aim range × `underwaterAimMul` (0.5) while submerged;
  no jumping while submerged.
- **Surface entry.** Crossing the surface downward resets `fallPeak`, multiplies velocity by 0.35 and emits
  `player:splash { speed }` (noise min(1, speed / 20)). While the water at the contact point is at least
  `rules.safeDepth` deep (3 / 4 / 5 m), impacts cannot kill; shallower water uses the normal impact rules.
- **Exit and mantle.** A jump within 0.4 m of the surface gives a 5.6 m/s exit. **Mantle** (everywhere, not only water):
  A with the chest against a ledge whose top is ≤ 0.9 m above the body (≤ 1.2 m above the surface) → a 0.35 s
  translation-only climb onto it (`player:mantle`).
- **Breath.** `player.breath` (1 → 0) drains at `1 / rules.breathTime` (22 / 16 / 12 s) while the head point is in water,
  outside `air`, and no tethered anchor has `air`; refills to full in 1.5 s in air and in `rules.bellowsFull` (2 / 3 / 4
  s) on a bellows ring. At 0.5 → heartbeat; at 0.2 → `breath:low`; at 0 → 3 s of darkening (`breath:out`), then
  `kill('drown')` unless the head reaches air.
- **Events.** `player:splash`, `player:submerge`, `player:surface`, `breath:low`, `breath:out`, `player:mantle`.
- **Render / audio.** Water surfaces and underwater mode (E25); master low-pass and pressure bed, the bead gauge on the
  gauntlet (E25), bubbles from a bellows hand (E26).
- **Verification.** Every required underwater leg costs ≤ 70 % of Normal breath at reel speed (bot timing); every
  designed catch pool is ≥ `safeDepth` (Abyss value) over its whole landing footprint, checked by dropping the bot from
  the highest reachable point above it; every shallow-water box adjacent to deep water has a foot-band tide-post within
  3 m (data check).

### E21 · Light field and the hooded lantern · M · P0 (lite) / P2

- **Lantern models** (from `DIFFICULTY[k].rules.cone` and chapter state):
  - *Mark Lamp, unhooded* (THE MARK through Chapter III): half-angle 60° (120° full), range 10 m, plus a 3 m fill;
  - *hooded* (Chapter IV on): half-angle 30° / 25° / 22° and range 16 / 14 / 12 m (N / NM / AB), plus the 3 m fill;
  - *white* (Chapter V): the hooded cone counts as **still-light** for stilled debris and the creature's crown (E23),
    never for the player.
  Pose: `intent.lantern` (left grip pose in XR, the camera on desktop, set directly by the bot).
- **Sim API** (`src/sim/lightfield3d.js`): `new LightField(level, rules)`; `setLantern(pose, model)`;
  `addStatic(id, { x, y, z, radius })` (shrines, lit clusters); `isLit(x, y, z, key) → bool` (point-in-cone or in the
  hand fill, plus `level.segmentBlocked` line of sight; cached per `key` for 4 steps; ≤ 32 line-of-sight tests per step,
  round-robin); `nearestMovingUnlit()` (from E22, for the flame's lean).
- **Render** (E25). The lantern becomes a `SpotLight` (no shadows) plus a small `PointLight` fill: today's single lantern
  light becomes two, inside the ≤ 4 dynamic lights + lantern budget; cone dust motes; the world-locked flame shader (the
  flame always points world-up and never flickers); the scripted lean (beat action `lamp lean`, or toward
  `nearestMovingUnlit` in Chapter IV); the white-burn state.
- **Verification.** Unit tests (cone edges, fill, line of sight, cache); ≤ 32 line-of-sight tests per step measured in the
  harness.

### E22 · The Kept · M–L · P0 (scripted) / P2 (full)

- **Data.**
  ```js
  kept: [{ id: 'ch4-kept-hands-2', x, y, z, yaw, rail: [[x, y, z], …] | null, home: 0,
           speed: null /* rules.keptSpeed */, stepLen: 0.32, reach: 1.0, holds: 'ch4-anc-held-2' | null,
           group: 'stacks-a', pose: 'reach' | 'hold-ring' | 'stand',
           scripted: null | { stopAt: 1.2, nonLethal: true } }]
  ```
  The hook's Kneeling One and the IV-1 lesson figure are `scripted` (never lethal; always stop at `stopAt`).
- **Sim API** (`src/sim/kept3d.js`): `new Kept(level, list, rules, light)`; `step(dt, player)`; `wake(group)`;
  `hold(id)`; `snapshot()` / `restore()`.
- **States.** `STILL` (lit, or within 0.3 s of losing light) → `SHIFTING` (unlit: a step of `stepLen` toward the rail
  point nearest the player every `stepLen / speed` s; toward `home` while the player hangs from its held ring) →
  `REACHING` (within `reach`) → grab. **Light only, never gaze**: head direction is ignored on every difficulty.
- **Grabs.** `rules.keptGrabsToKill` = 2 (N): the first grab staggers 1.2 s, force-releases the nearest tether
  (`'kept'`), and starts a 6 s window; a second grab inside it kills (`'kept'`). 1 (NM, AB): the first grab kills.
- **Held rings.** The anchor `held: keptId` follows the statue's raised hand; each step is eased over 0.2 s so a hanging
  rope does not jolt (velocity written for E15).
- **Interplay.** Shrines (`safeLight` and static lit radii) hold every Kept inside them; the creature's `gather` consumes
  unlit Kept (E17); cage occupants' reach hazards are active only while unlit (`activeWhen`).
- **Limits.** ≤ 24 active Kept per window; beyond 30 m from the player they freeze.
- **Events.** `kept:step { id, x, y, z }`, `kept:still { id }`, `kept:grab { id, lethal }`, `kept:gathered { id }`.
- **Render.** `render/keptView.js`: instanced figure poses; stepping alternates two step poses; dust trickle per step.
- **Audio/haptics.** Stone grind per step (HRTF); a faint tick in the lantern hand for the nearest moving Kept within
  10 m; a grab is a hard squeeze on both hands.
- **Verification.** Unit: a lit Kept never moves; a lit, stationary player is never grabbed. Harness: the bot's lantern
  policy (light the nearest Kept that threatens the route, else the next held ring) completes Chapter IV on every
  variant; no Kept rail passes within 4 m of a main-route hang point unless that hang point is flagged `keptPressure`.

### E23 · Stillness · M · P2

- **Data.**
  ```js
  stillSources: [{ id: 'ch5-still-flame', kind: 'flame', x, y, z, range: 160, rate: 1 },
                 { id: 'ch5-still-prism-2', kind: 'beam', x, y, z, dir: { x, y, z }, angle: 0.12, range: 90,
                   sweep: { axis: 'y', arc: 1.4, period: 30, phase: 0 }, mover: 'ch5-mov-prism-2', rate: 0.5 }]
  ```
  Solids and anchors flagged `still: true` are stilled debris; movers flagged `still: true` freeze in light.
- **Sim API** (`src/sim/still3d.js`): `new Stillness(level, sources, rules, light, creature)`; `isStillLit(x, y, z,
  key)` (cone or point line of sight from any source, or the white lantern cone; ≤ 16 tests per step, cached 4 steps);
  `step(dt, player)`; `snapshot()` / `restore()`.
- **Player.** If lit by a source and not shaded (solid line of sight blocked, or `creature.shadowBlocks`):
  `player.stillness += dt / rules.stillTime × (within 3 m of a flame ? 3 : 1) × source.rate`; otherwise it decays from
  full to 0 in 3 s. Effects: reel and pump × (1 − 0.6 s); aim range × (1 − 0.3 · max(0, (s − 0.6) / 0.4)); the threat
  system **inverts the heartbeat** (it slows as stillness rises, `threat3d.js`); at 1 → `kill('still')`.
- **World.** Movers flagged `still` ramp their time scale to 0 over 0.2 s while lit; ballistic debris is suspended while
  lit; stilled solids and anchors are active only while lit; when light leaves one: `still:warn` and a rim-off warning of
  `rules.stillWarn` (0.8 / 0.6 / 0.4 s), then it falls (ballistic from the pool) and its anchors break
  (`'lightlost'`).
- **Creature.** Crown exposure and freeze (E17).
- **Events.** `still:warn { objId }`, `still:fall { objId }`, `player:stillness { value }` (10 Hz, for audio and haptics).
- **Render.** Pale rim on stilled objects (off during the warning), per-instance stillness tint, beam cones, gauntlet
  stone-creep and the saturation grade from `player.stillness` and the chapter (E25).
- **Verification.** Every light-locked main-route anchor stays lit ≥ 2.5 s per pass on Normal; a bot following the
  authored shadow schedule finishes each section with stillness ≤ 70 % on Normal; every stilled platform on the main
  route has a pool or a recovery anchor below it on Normal.

### E24 · Input and intent extensions · S · P0 → P2

| Intent field | Quest | Desktop | Bot |
|---|---|---|---|
| `move.y` (water only) | head pitch × stick magnitude; A = stroke up 0.4 s | Space up, C down (in water) | set |
| `hands[h].interact` | grip held on an **untethered** hand (grip on a tethered hand stays yank) | E held | set |
| `knocks[]` | knock detector (E10) | K (raycast 1.6 m) | push |
| `lantern` pose | left grip pose | camera pose | set |
| `gesture.raise` / `.cup` / `.kneel` | hand poses vs the calibrated head height (T14) | E held / E held during a bow / C held | set |
| wrist glance (Names, splits) | X during play (unused today) | Tab | — |
| purchase activation | `input.onSelect(hand, fn)` runs `fn` inside the XR `select` handler | click | — |

The knock detector ignores tethered hands and requires the hand to move into the surface, so swinging, reeling and
yanking never produce knocks. Existing mappings are unchanged.

### E25 · Renderer extensions · L · P0 → P2

| Feature | Spec | Budget |
|---|---|---|
| **Chapter themes** | `render/themes/<theme>.js`: materials, texture-set manifest, kit GLBs, decor-type registry, far structures, fog and light defaults; loaded lazily, disposed on swap; `solid.skin` picks the material | ≤ 3 new 1024² sets per chapter |
| **Movers** | per-kit `InstancedMesh`, per-frame matrices for moving instances only; render-only rotation; dashed phosphor rails (one `LineSegments` per section); approach glint (per-instance emissive) | ≤ 10 draws per chapter's mover kits |
| **Waking lamps and the lamp-field** | `LampsView`; Lamphold's ~3,000 lamps as one instanced quad mesh with a per-instance `lit` attribute; snuffing writes attribute ranges | 2 draws |
| **Figures** | figure-kit poses instanced (statues, remnants ≤ 12, Kept ≤ 24); impostor cards beyond 40 m (the Unkindled, the Keeping's far shelves) | ≤ 8 draws |
| **Mason v2** | variable `seg`; figure-plates and frond-arms; back rings; shader states: wet, listen glow, per-segment stone ramp, dust coat; `hidden`; `comeApart` as falling figure instances | ≤ today's creature cost + 4 draws |
| **Water** | one surface plane per water volume (scrolling normals, fresnel, depth tint; no reflections, no render targets); **underwater mode** (fog colour/near/far swap, a caustic flicker on the lantern); scripted surface height uniform | ≤ 2 visible surfaces |
| **Lantern** | spot + fill (E21), world-locked flame, lean, white burn, cone motes; the bead breath gauge on the left gauntlet | 2 lights |
| **Darkness** | ambient and hemisphere to 0 inside `dark` volumes | 0 |
| **Stillness** | `uStillY` band and stillness tint injected with `onBeforeCompile` into rock, masonry, figure and creature materials; pale rim; ≤ 3 additive beam cones; gauntlet stone-creep uniform; **saturation grade folded into materials** (no post-processing) | ≤ 4 draws |
| **Fronts** | collapse debris from a pre-fractured pool (≤ 64 live); lamp pop wave; the still band | ≤ 6 draws |
| **Wall bulges** | pooled (≤ 4) displacement patch + crack decal + dust burst at `wall:bulge` | 2 draws |
| **Knocks and Names** | notch-carving decal atlas; the tally wall as a `CanvasTexture` updated per knock; a Name's lantern glow on learn | 1 draw |
| **UI panels** | end card, ending cards, title cards, the Descent Line, codex (E27) | as today's panels |
| **Shader precompile** | `renderer.compile` on every chapter swap and before every set-piece's first use | — |

Every set-piece stays within ≤ 150 draws and ≤ 350k triangles at its worst moment (E29 lists them).

### E26 · Audio, music and haptics · L · P0 → P2

- **Procedural additions** (in `audio3d.js`, original synthesis like today): knocks (per-Name pitch so rhythms are
  distinct); bells (modal synthesis, 5–7 inharmonic partials, pitch by size); mover voices (≤ 8, nearest first: tick,
  groan, chain, gear, hammer, pendulum creak, lift); water (lapping, splash by speed, a master low-pass ~700 Hz under
  water, pressure bed, bubbles); Kept stone grind; snuff pops (granular cloud); plaster cracks; front sounds (collapse
  cascade behind you, the still chord, the dark pop wave); Mason extras (crown into water, knocks on the bell, gather,
  horn routing to 8 mouths, the overtake grind); the **silence system** (a master duck and low-pass driven by `hush` and
  stillness; breath and heartbeat bypass it); breath states (waking breath, gasp, breath-low); the rope-telegraph creak;
  the elastic-catch twang. Reverb per chapter from generated impulse responses (Lamphold 4 s warm, Winding Floor 2.5 s
  metallic, Mere 6 s, inside a bell 1.2 s, Keeping 3 s dry, Halo 9 s bright).
- **Music** (new `src/audio/music3d.js`, `MusicDirector`): loads each chapter's stems (Opus) with its pack; three looping
  stems (Calm / Pressure / Peak) crossfaded by the threat value and section intensity; cues started by beats with
  sample-accurate scheduling on `AudioContext.currentTime`; silence states (`sil.*`) take the music bus to −∞ over
  1.2 s; pauses with the game. Delivery and loudness: ART_AUDIO_PLAN §5.4.
- **Designed SFX** (foley pack, ART_AUDIO_PLAN §5.3) play through the same spatial graph, layered under the synthesis.
- **Haptics.** `game._haptic` gains patterns (`[[intensity, ms, gap], …]` per hand): the vocabulary is in ART_AUDIO_PLAN
  §5.6 (rope telegraph, mover rumble, bellows buzz, Name rhythms, the freeze).
- **Captions** (T13): every key sound captioned with a direction glyph; visual stand-ins for audio-critical beats (the
  Stopping: movers visibly stop; the Plunge: the crown's glow; the telegraph: a wrist glyph).

### E27 · UI extensions · M · P0

- The **end card** (demo; CHAPTERS §5.6) with the store price string and the XR-select purchase button (E06); ending
  cards; chapter title cards that drift up out of the dark.
- The **waking vocabulary**: "Wake", "Woken N times"; death lines for the new causes (`crush` *"The stone closed."*,
  `drown` *"The water kept you."*, `kept` *"It held you still."*, `still` *"You held still."* / *"Your light went
  out."*).
- **The Descent Line** (chapter select): a carved vertical diorama panel of five strata tiles with medals, Names x / 5,
  trials, the Unwoken lamp, best times, locked or offered states.
- **Codex** (Names: notch glyph + line, page per chapter); **Records** (CHAPTERS §10.6); the **wrist** additions (the
  learned Name rhythm etched, splits, the telegraph glyph).
- **Settings additions:** Leave no remnants, Trace Names, ghosts, splits, captions (T13), brightness calibration (T12),
  large text (T18), Purchases › Restore.
- **Menu**: Return to the Flame, Full Descent, Pilgrim; the Threshold menu scene variants after endings; in-world credits
  (carved panels rising past the epilogue climb; skippable after the first viewing).

### E28 · Verification harness v2, authoring tools, telemetry · M · P0

- **Promote** the level agent's harness (today in a session scratchpad: `sim.mjs`, `bot.mjs`, `routes.mjs`,
  `verify.mjs`) into the repository at `tools/abyssal-tether-3d/verify/`, run with `npm run verify:at3d -- --chapter
  ch1|…|all --variant all`, writing `out/verify-<chapter>.json`.
- **`sim.mjs` v2** drives the whole fixed-step stack of §3 (clock, movers, volumes, physics, knocks, noise, Kept,
  stillness, fronts, creature at 60 Hz, beats, lamps) deterministically, with snapshot and restore.
- **Bot route steps** (additions to today's `{ a }`, `{ p }`, `{ w }`, `{ release }`, `{ goal }`): `{ wait: { mover,
  phase: [a, b] } }`, `{ wait: { beat } }`, `{ ride: moverId, release: { phase } }`, `{ swim: [x, y, z] }`, `{ breathe:
  'air' | anchorId }`, `{ light: keptId | 'policy' }`, `{ knock: nameId }`, `{ interact: id }`, `{ shade: 'creature' |
  solidId }`, `{ gesture: 'raise' | 'cup' }`.
- **Checks** (each fails CI): see §8.
- **T1 Blender blockout exporter** (`tools/abyssal-tether-3d/blockout/export_chapter.py`, bpy like the existing asset
  tools): one collection per section; **unrotated** box meshes → solids (custom properties `kind`, `skin`, `tag`,
  `group`, `omitIn`, `onlyIn`, `still`, `hollow`, `breach`, `collapse`, `crushZone`); empties → anchors (`kind`, `tag`,
  `air`, `held`, `assist`; `mountId` from the parent), lamps (`litIn`, `exam`), interactables, Names (`pattern`), Kept
  (rail = a child polyline), still sources; curves → mover paths, creature paths and front routes; a parent empty with a
  `mover` JSON property defines a mover and its carried children; boxes in a `volumes` collection with `kind` and params.
  Output: `src/data/chapters/chN-<name>.blockout.js` (generated, never edited by hand). Any rotated box or unknown
  property fails the export.
- **T2 in-headset debug overlay** (dev builds): volumes, mover paths and rails, noise rings, the lantern cone and its
  line-of-sight rays, Kept states, stillness, front positions, creature path and state, lamp radii.
- **Telemetry** (playtest builds only, stored locally, exported with `AT3D.telemetry.export()`; nothing leaves the
  device): deaths by cause and section, time per section, hint replays, the **gaze log** (each truth image looked at
  within 15° for ≥ 0.5 s at ≤ 25 m), Mason screen time, deaths per set-piece, minimum breath, maximum stillness, Kept
  grabs, performance samples (fps, draw calls, triangles) per section.

### E29 · Performance, memory and loading budgets · S + ongoing · P0

| Budget | Value | Measured by |
|---|---|---|
| Frame rate | 72 fps sustained over 45 min per chapter (90 Hz where headroom allows) | OVR Metrics on Quest 3 / 3S (RELEASE §14.2) |
| Simulation | ≤ 2.5 ms per frame on Quest 3: movers ≤ 40 closed-form (≈ 0.2 ms), volumes ≤ 24 tests, Kept ≤ 24 with ≤ 32 LOS tests per step, stillness ≤ 16 LOS tests per step, creature as today plus shadow capsules on demand | harness in Node (per-system timers) then device |
| Draw calls / triangles | ≤ 150 / ≤ 350k at the worst moment of: the Spiral, THE MARK unspooling, the Snuffing (lamp-field + Span collapse), the Drain reveal (Unkindled impostors), the Last Shelf (Kept + figures), the Halo (debris + beams), the Stilling (32-segment creature + front) | dev perf overlay (T4) in scripted fly-throughs |
| Lights | ≤ 4 dynamic + the lantern (spot + fill); no shadow-casting lights | review |
| Memory | ≤ 2 chapters of data resident; GPU holds the current chapter + seam; `renderer.info` back to baseline ±5 % after a swap | device |
| Loading | first head-tracked frame ≤ 4 s from launch (T1); chapter swap ≤ 1 frame over budget; no shader hitch on first use (precompile) | stopwatch video, frame timing |
| Pack sizes | Chapter I (demo) ≤ 15 MB; each of II–V ≤ 25 MB including music | build manifest |
| Thermal | no throttling-induced drop below 72 fps after 30 min | device soak (T17) |

---

## 7. Event catalogue (new bus events)

| Event | Payload | Emitted by |
|---|---|---|
| `beat:fire` | `{ id }` | E03 |
| `chapter:prefetch` / `chapter:ready` / `chapter:swap` / `chapter:complete` | `{ id }` / `{ id }` / `{ from, to }` / `{ id, time, deaths, woken }` | E04 |
| `entitlement:change` / `purchase:start` / `purchase:result` | `{ state, source }` / `{}` / `{ result }` | E06 |
| `lamp:kindle` / `player:wake` / `lamp:snuff` | `{ id }` / `{ lampId }` / `{ id }` | E07, E17, E19 |
| `remnant:add` / `remnant:crumble` | `{ pose, x, y, z }` | E08 |
| `interact:start` / `interact:progress` / `interact:done` | `{ id }` / `{ id, t }` / `{ id }` | E09 |
| `player:knock` / `name:learned` / `knockwall:knock` / `knockwall:answered` / `door:open` | `{ x, y, z, hand, targetId }` / `{ id }` / `{ id }` / `{ id }` / `{ id }` | E10 |
| `noise:emit` / `creature:investigate` / `rope:telegraph` | `{ x, y, z, loud, kind }` / `{ x, y, z }` / `{ hand, intensity }` | E11 |
| `medal:earned` / `trial:complete` / `trial:failed` / `split` | `{ chapter, difficulty, medal }` / `{ id }` / `{ id }` / `{ section, time, delta }` | E12 |
| `mover:tick` / `mover:start` / `mover:stop` / `mover:arrive` | `{ id }` | E13 |
| `rope:catch` | `{ hand, speed }` | E15 |
| `grapple:release` reasons | adds `'cut'`, `'front'`, `'lightlost'`, `'kept'` | E15, E19, E22, E23 |
| `player:death` causes | adds `'crush'`, `'drown'`, `'kept'`, `'still'` | E16, E20, E22, E23 |
| `creature:path` / `wall:bulge` / `creature:breach` / `creature:plunge` / `creature:knock` / `creature:stilled` / `creature:thawed` / `creature:freeze` / `creature:comeApart` | see E17 | E17 |
| `volume:enter` / `volume:exit` / `volume:phase` | `{ id, kind }` / `{ id, kind }` / `{ id, phase, lead }` | E18 |
| `front:start` / `front:stop` / `front:warn` / `front:pass` / `front:progress` | `{ id }` / `{ id }` / `{ id, objId }` / `{ id, objId }` / `{ id, s, gap }` | E19 |
| `player:splash` / `player:submerge` / `player:surface` / `breath:low` / `breath:out` / `player:mantle` | `{ speed }` / `{}` … | E20 |
| `kept:step` / `kept:still` / `kept:grab` / `kept:gathered` | `{ id, x, y, z }` / `{ id }` / `{ id, lethal }` / `{ id }` | E22, E17 |
| `still:warn` / `still:fall` / `player:stillness` | `{ objId }` / `{ objId }` / `{ value }` | E23 |

Existing events (`grapple:attach`, `grapple:release`, `grapple:miss`, `grapple:break`, `rope:jolt`, `player:land`,
`player:wallhit`, `player:jump`, `player:death`, `platform:crumble`, `section:enter`, `checkpoint`, `hint`, `trigger`,
`creature:*`) are unchanged.

---

## 8. Verification gates per chapter (the harness must pass all of these on every variant)

| # | Check | Applies to |
|---|---|---|
| V1 | Integrity (today's checks: contiguous sections, lamps on floors, anchors not inside solids, ids unique) plus no dangling ids in beats, movers, fronts, volumes, names, Kept | all |
| V2 | Full route from the chapter's first lamp to its exit lamp completes (bot), and from every lamp to the next | all |
| V3 | The next main-route anchor is **knowable** from each hang point: line of sight within marker range (in the Keeping: inside the lantern cone policy or phosphor-marked; in V: lit or rimmed) | all |
| V4 | Lamp spacing (E07) and every exam phase has a lamp ≤ 10 s of optimal route before it | all |
| V5 | Carried anchor speed ≤ 13 m/s; crush clearance (E13) | II–V |
| V6 | Set-piece fairness: a bot at 75 % of optimal survives; a bot stalling 3 s fails; recovery anchors catch on Normal | every set-piece |
| V7 | Creature near-miss distances for scripted paths (the Spiral ≥ 5 m, THE MARK crown ≥ 2.5 m, the Stilling overtake ≥ 4 m, Phase C of the Snuffing ≥ 4 m, the Drain phase 4 ≥ 15 m) | I, II, III, V |
| V8 | Underwater legs ≤ 70 % of Normal breath; catch pools ≥ Abyss safe depth; shallow water marked | III, IV, V |
| V9 | Kept: a lit Kept never moves; the lantern-policy bot completes; rail clearance | IV |
| V10 | Stillness: light-locked anchors lit ≥ 2.5 s per pass; shadow-schedule bot ends ≤ 70 % stillness; a pool or recovery under every stilled platform | V |
| V11 | Every Name reachable by its mastery route on Normal | all |
| V12 | Budgets: active movers ≤ 40, dynamic objects ≤ 64, volumes ≤ 24 per section, Kept ≤ 24 active, LOS tests per step within E21/E23 limits | all |
| V13 | Determinism: the same input log gives the same trajectory hash twice | all |
| V14 | Chapter I regression: today's routes and S6 timing comparison (re-baselined once for the elastic catch) | I (every milestone) |
| V15 | Seam consistency and the Node swap test (E04) | seams |
