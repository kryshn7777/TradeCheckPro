# Abyssal Tether 3D: Level Fun Plan (objectives, seals and the long way)

> Status: **P1 done** (2026-10-28): seals S1-S7 (hook verb on a route ring), `Objectives3D`, the bar view, run.objectives in the
> save, skitter spawn clamp, seal-gap check + skip probe + climb-out read-out in verify, `tests/objectives/unit.mjs`. Differs
> from the plan: plates live in `level.sealSolids` (built open, not in `level.solids`, so no bake / view / dressing filters were
> needed); S1 is one plate over the whole chimney (two boxes leaked a sight line under the sill); the S6 floor runs under the
> wall footprints; S7 also opens from `s7-sp1` (the spire line skips `s7-n6`); `hold` 0; the save keeps objective ids and stays
> schema 2 (schema 3 comes with P2's splits); no recovery rings added (climb-out is reported: S7 iris 39-61 %).
> **P2 done** (2026-10-28): per-section reach (`sections[i].reach`, `Level3D.reachOf`, `TetherSystem.aimRangeAt`; S4 30/28/26,
> S5 29/27/25, S6 28/27/25, S7-S8 26/25/24; rope length unchanged), bots play with reach − 1.5 m; a fast and a safe line in
> S2-S8 (`routes` in the level data, `FORKS` in verify/routes.mjs, fork probe `tests/objectives/routes.mjs`); supply tier
> `slow` + 6 lore plaques on the safe lines; save schema 3 (per-section best split + medal, `split` events,
> `src/sim/splits3d.js`, generated `src/data/par-3d.js`). Differs from the plan: no new solids at all (fast lines are frayed
> rings, dives and chains, no crumble ledges); S5 / S7 fast lines are new ring columns (S7 is not the spire line: it could
> not be made faster; `s7spire` stays an alternate without `s7-sp2`); S8's main line is the fast one and the safe line rests
> on the wall steps; `s8-e5` re-spaced 5 m lower; three recovery rings (`s4-up`, `s6-up`, `s7-up`) restore climb-out at the
> shorter reach; S3 / S5 / S7 fast lines open their seal with their own hook ring; par = each section's main line.
> **P3 done** (2026-10-28): the first verbs open S1, S2 and S4 (S3, S5-S7 keep their route ring): the S1 bell (`bell-s1`,
> struck by the body at 2.5 / 3 / 3.5 m/s on the t1 swing; the body bounces off it; every toll is a Mason noise), the S2
> counterweight (`s2-cw`, tag `objective`; haul 1.5 / 1.8 / 2.2 s in 4 loud ratchet notches; a haul ring never reels the
> player), the S4 lamps (3 needed, lantern probe 1.5 s within 0.9 m, charge 0.06 / 0.08 / 0.10, never blocks; the baked
> lamp light follows the progress via `uLMK.z`). Ratchet through death, Continue (save strings `lamp-s4a`, `cw-s2#2`) and
> warp; bot steps `ring` / `haul` / `light` on every line and variant; verify fallback probe (no creature / creature live /
> empty lantern); `tests/objectives/verbs.mjs`; par and baseline rewritten. Differs from the plan: all three S4 lamps are on
> the catwalk (its end lamp + two rail lamps), because P2's fast line never stands on the shelf or plinth (item 8: the
> objective sits where the lines converge); the bell is not a level solid (Objectives3D bounces the body: no bake); on a
> screen the probe is the view ray ≤ 2.5 m with no key (E already fires the right tether); reeling in hauls as well as the
> grip; the S2 fast bot hauls while it walks to the lip (keeps the fork ≥ 15 %); no new plaques (hints only).
> **P4 done** (2026-10-28): movers-lite (`src/sim/movers3d.js`: closed-form `pendulum` / `orbit` of `Objectives3D.clock`, in
> its snapshot; carried rings `dynamic`, out of the Y index, `vx/vy/vz`; the rope pulls by the relative velocity; a hook homes
> on the ring's pose at arrival; a ring in its gear's `housing` is not targetable, a hook arriving there falls off, a line on
> it is pulled off; `moverAssist` 0.6 / 0.4 / 0.2), the S3 winch (`winch-s3`, verb `winch`: a line on the gear's ring winds 3
> notches over 0.9 / 1.2 / 1.5 s, ratchet through release / housing / save; replaces the hook), the rockfall lane `rock-s3`
> (period 7 / 6.25 / 5.5 s, on 1.6, lead 1.5, damage 0.3 / 0.4 / 0.5 once per drop; `lane:warn/on/off/hit`; fx rain + level
> rumble + captions), bot steps `wait: { lane }` / `exposed` / `hold` / `winch`, `verify/machines.mjs` (V1 movers ≤ 1.5 m/s and
> clear of solids, lanes in open air; V6 lane probe; any bot line struck fails), `tests/objectives/machines.mjs`; par and
> baseline rewritten. Differs from the plan: the swinging cage is the existing cage decor south of span 1 (its ring replaces
> `s3-f1` on the P2 fast line), not a cage over the span2 → span3 gap; the gear sits on the north wall where the two lines
> meet (in reach of the shelf and of `s3-f2`), not the west wall; amplitudes keep every ring ≤ 1.5 m/s (the plan's ±0.3 rad
> at 7.5 s would be 3.5 m/s); lanes are their own list (`lanes`), not `level.hazards` (no climb edge, dressing or supply rule
> moves); new rule: a seal whose objective is done while the player stands on it over a drop deeper than 3 m opens once they
> are off it; the S2 collapsing span is not built (it changes the lightmap hash: with the P6 re-bake).
> **P5 done** (2026-10-28): the Masons' rests (`nooks`: S4 catwalk end, S5 lure niche, S6 shelf 3; budget 25 / 15 / 8 s per
> visit, warn 5 s before, refill after 20 s outside; `Creature3D.setRefuge`: hidden = no attack starts, stall clock frozen,
> it holds and listens, no hit; a creature-only block box its head and lunges keep out of), the S5 keystone (`key-s5`,
> verb `breach`: a fixture solid in `level.fixtureSolids`, out of `level.solids` and both hashes; a Mason lunge stopped at it,
> at the lure's mouth, or within 2.5 m breaks it; haul fallback at once 8 / 10 / 12 s in 4 loud notches; 200 / 200 seeds per
> difficulty within 40 s, 0 hits), a strike never hits through an active solid (all strikes), the keystone skipped by the
> attack line of sight, shot from the lure it lunges at once; the S7 survive floor (`arena-s7`, verb `survive`, 45 / 60 / 60
> s in 4 stages kept through a death, paused on the landing; done: `{ mode: 'escape' }` via `Creature3D.setOverride`); bot
> steps `haul` (S5) / `waitObj` (S7), forks compare moving time; `tests/creature/nooks.mjs`, `lure.mjs`,
> `tests/objectives/mason.mjs`; par and baseline rewritten. Differs from the plan: no wall niche or alcove geometry (both
> would change the lightmap hash): the rests are rule-based volumes by existing lamps (+ 2 glyph bands, the S4 plaque) and
> the lure niche is the corner of the last step behind a free-standing keystone, its blows mostly stopped at the niche's
> mouth (they come from above, over the 2.5 m stone) and counted as blows; the arena is a fixture of `obj-s7` (no `arenas`
> list) and opens all four quadrants at the last stage, each stage withdrawing a bolt (a quadrant per stage would let you
> drop through after 11 s); skitterlings also keep out of a rest's block; a seal also opens under a body hung on a sound rope
> (not only once off it); S7 adds +29.8 s to the Nightmare / Abyss bot split (over the +25 s cap: the 60 s timers);
> nothing browser-run or playtested.
> **P6 done** (2026-10-28): wind squalls (`squalls` data, `sim/wind3d.js` (the draught moved out of `render/wind.js`, which
> re-exports it), `Objectives3D.windPush` called by `Physics3D.step` after gravity while not grounded; `squall-s6` down
> the S6 throat only, every 26 / 20 / 15 s, 4 s sin², 1.2 / 1.5 / 1.8 m/s² along +z, 2 s telegraph: the wind bed swells,
> "[Wind rising from below]", the wisps gather and turn to its way; Settings › Comfort › Wind squalls, on by default,
> stills them entirely; the bots play with them on, deterministic, plus `squallProbe`: both S6 lines from 6 clock phases
> per difficulty all pass); the medals UI (`src/ui/medals.js`, a Records screen per difficulty on the DOM and the VR
> panel, the split line on the next title card / a toast, the victory splits; no new mesh or draw call); the S2
> collapsing span (`s2-span` a crumble, life 2.5 on Normal; a groan + caption + shake from the first touch) with the
> GI re-bake (its hash moved) and a full lightmap re-bake (hash unchanged, pages refreshed for P2-P5's rings and decor);
> length read-out (no change needed) and the Quest budget with all phases (S1-S8 within 150 calls / 350k; the creature
> in view at LOD0 still 351-381k, as before P1); `tests/objectives/polish.mjs`, `tests/ux/medals.mjs`, e2e checks for
> the victory splits and the Records screens. Differs from the plan: the squall is a schedule like a lane's, not
> `volumes` + `windSquall(t)` (that one cannot be telegraphed `lead` s ahead), switched by its own setting, not by
> reduced effects; the safe stair is sheltered (only the throat line); the S2 span is a crumble on Normal only
> (Nightmare's was one already, Abyss has none); no real niche geometry for the rests (each niche would split a wall:
> re-rolled dressing and decor colliders, new climb edges, the S5 lure geometry its 200-seed test rests on, lines of
> sight from the S4 catwalk / S6 shelf: not cheap; the rests stay rule-based volumes); no length tuning (nothing over its
> band; S7's +29.8 s on Nightmare / Abyss is the owner's 60 s timers); the medal is called brass (open question 7).
> e2e (one launch each): this branch 43 / 48 (descent to victory, victory splits, Records screens, XR budgets S1 / S4 / S7
> pass; failing: the 4 known checks, pre-existing on 24f0a4b (38 / 45 there), plus one start-fade timing cascade).
> **Status: all phases done (P1-P6).**
> Approved scope (12 items). Date 2026-10-28.
> Paths: `src/` = `public/abyssal-tether-3d/src/`, `tools/` = `tools/abyssal-tether-3d/`. Every code claim below names the
> file and function or data field it was read from. Where an approved contract already exists in
> [ENGINE_EXTENSIONS.md](../ENGINE_EXTENSIONS.md) (E07 lamps, E09 interactables, E12 records, E13 movers, E14 dynamic sets,
> E15 moving anchors, E18 volumes) this plan builds the **smallest subset** of it, with the same names, and does not
> fork it.

## 0. What the code says today (the facts this plan rests on)

| Fact | Where |
|---|---|
| Targeting range = `diff.aimRange` (32 / 29 / 27); max rope = aimRange + 4 (`CONFIG.rope.maxLengthBonus`) | `src/sim/physics3d.js` `TetherSystem.findTarget`, `maxRopeLength`; `src/sim/config3d.js` `DIFFICULTY` |
| A solid with `active === false` is skipped by collision, line of sight and raycasts | `physics3d.js` `resolveCollisions` (`s.active === false`); `src/sim/level3d.js` `segmentBlocked`, `raycast` |
| `Level3D.reset()` re-activates **every** solid and anchor (crumbles, broken rings) | `level3d.js` `reset()`; called by `src/game.js` `respawn()`, `_buildWorld()` and `tools/verify/sim.mjs` `Sim.spawn()` |
| `_buildSection` copies only id, name, subtitle, yTop/yBottom, checkpoint, theme, creature, shaft, hints, triggers | `level3d.js` `_buildSection` (new section fields need a pass-through) |
| A checkpoint is awarded on **entering** a section (`mode === 'progress'`), per `diff.checkpoints` (`all` / `alternate` / `none`) | `game.js` `_enterSection`, `level3d.js` `checkpointFor` |
| Creature: one update per rendered frame with variable dt (not deterministic across frame rates) | `game.js` `_updateRun` → `_updateCreature`; ENGINE_EXTENSIONS §3 note |
| A lunge `hit` is decided by **distance only** (`d <= killRadius × strikeMul`); the solid test only shortens a miss | `src/sim/creature3d.js` `_strike` |
| An attack is refused when solid masonry blocks head → player | `creature3d.js` `_startAttack` (`_losBlocked`) |
| The head never comes within `minClear` 1.0 m of a solid; grates are not crawlable and bodies pass through them | `creature3d.js` `CREATURE_TUNING.minClear`, `isStructural`, body push loop (`b.kind === 'grate'`) |
| Annoyed = an aim ray through the body: ×6 speed 0.3 s, ×1.5 for 3 s, cooldown 20 s | `creature3d.js` `_onShot`, `CREATURE_TUNING.annoy` |
| Stall lunge after `stallCommit` 13.5 / 9 / 5 s within `stallRadius` 4.5 m; escape mode `holdOnRecover` keeps it ≤ 12 m above you | `creature3d.js` `DIFF_TUNE`, `_updateStall`, `CREATURE_MODES.escape`, `_steerHunt` |
| Bot sims step only Player / Tethers / Physics (creature optional, non-lethal); snapshot covers `crumble` solids and `fragile` anchors | `tools/verify/sim.mjs` `Sim`, `snapshot()` (`dynSolids`, `dynAnchors`) |
| The bot's "can I hook it" uses `sim.diff.aimRange`; coverage V3 uses `DIFFICULTY[v].aimRange` | `tools/verify/bot.mjs` `targetable`; `verify.mjs` `coverage` |
| One fork today (S6 risky vs safe, risky ≥ 25 % faster) | `tools/verify/routes.mjs` `FORK`; `verify.mjs` fork phase |
| V1 already resolves `…Id` / `ids` references for `lamps`, `movers`, `volumes`, `beats` … | `verify.mjs` `ID_LISTS`, `REF_LISTS`, `idChecks` |
| Lightmap and GI bakes are keyed by a hash of every non-`crumble` solid, every light and the LM decor | `src/render/lightmapFormat.js` `levelLmHash`; `src/render/giFormat.js` `levelGiHash` |
| Baked lamp light is one per-section multiplier at run time (`LOOK.uLMK.z`, `uLMLamp`) | `src/render/lighting.js` `update` |
| `grate` material is alpha-tested and double-sided (overdraw on Quest) | `src/render/materials.js` (`m.grate`, `alphaTest: 0.5`) |
| Out-of-range anchors already dim (0.85 → 0.3) and the laser dot goes hollow beyond range | `src/render/levelView.js` `_updateAnchors`; `src/render/handsView.js` (laser `f.hollow`) |
| In-world text rule: plaques ≤ 12 words, no notes, diaries or voice-over | `docs/abyssal-tether-3d/CHAPTERS.md` §3.2 rule 5 |

**Measured with a 40-line Node script on `Level3D` (normal variant; not committed):** the owner's "104 pairs / 31 cross a
border" reproduces only **without line of sight** (106 / 31). With line of sight the counts are 37 / 6 from the ring
itself and 40 / 7 from a hang point 3 m below it (S3→S4 six pairs, S7→S8 one). Real skips are therefore mostly *fall-and-catch* (the S2 hint teaches "Falling? Fire
again — any anchor will catch you") from swinging bodies, not ring-to-ring chains, so the skip metric below is measured
from the bot's trace points, not from anchor pairs. Natural choke planes found by the same script:

| Border | Choke today | Seal geometry (proposed) |
|---|---|---|
| S1→S2 | well x 3..11 and the void under the Threshold (266 m² open at y −8) | 2 grate boxes, y −9..−8.5: x 3..11 × z −11..11 and x −11..3 × z 4..11 |
| S2→S3 | hall floor opening x −34..−22, z 3..11 at y −38..−35 (96 m²; `s2-floor-a/b`) | 1 box flush with the floor, y −36..−35 |
| S3→S4 | none: gallery and Vault hall are one shaft (894 m² open at y −98) | full grate floor x −34..11, z −11..11, y −98.4..−98 |
| S4→S5 | Gullet mouth hole x −21..−3, z −9..9 (`slabHole('s5-mouth')`) | 1 plug, y −150.6..−150 |
| S5→S6 | `s6-roof` hole x −21..−3, z −9..9 (264 m² open) | 1 plug, y −202.6..−202 |
| S6→S7 | S6 shaft footprint x −34..10, z −11..11 over the `s7-roof` hole | full grate floor, y −284.6..−284 (s7-landing is 3.4 m below) |
| S7→S8 | `s7-floor` hole x −22..18, z −20..20 (1,600 m²) | 4 quadrant plugs (the iris), y −424.6..−424 |
| S8 | the chamber gate (`LEVEL_DATA_3D.gate`) | none: S8 stays a flight |

Every next-section checkpoint lies below its seal (checked against `sections[i].checkpoint`), so "checkpoint i+1 reached"
always implies "seal i open". Route anchor spacing measured along `ROUTES`: S7 ring-to-ring 21.0–24.3 m (spire line up
to 31.7), S8 19.4–26.6 m (wall line 34.1): **a 22 m reach would break S7/S8** (see item 5).

---

## 1. Goal and success metric

**Goal.** Every section is played, not skipped: a section can only be left through its seal, the seal opens on a
diegetic objective with its own verb, skipping lands you on a grate and costs time, and the long way pays.

| Metric | How it is measured | Target |
|---|---|---|
| Skip rate (gate) | Verify **skip probe** (§5.2): a greedy descender bot from every checkpoint, every variant, plus the static airtight test | 0 sections passed with the objective undone |
| Route integrity (gate) | Existing V1/V2/V3/V6/V13 + new objective steps | ALL CHECKS PASS on normal / nightmare / abyss |
| Time-to-complete bands | Bot optimal split per section (already in `verify.mjs` `fullRun().splits`) → human band = 1.6–3× bot; first-play target keeps CHAPTERS §5 (24–28 min Normal) | Each section's bot split rises ≤ 25 s from objectives; total ≤ +3 min |
| Skips in real play (local, no telemetry exists) | Profile stat per section: attaches and split; a "skip" = split < 0.6 × par or < 50 % of route anchors attached | Shown in the dev overlay (`src/ui/perfDiag.js`), playtest sheet |
| Perf (gate) | E29 sim budget (`budget.mjs`: p99 ≤ 2.5 ms), device pass | +≤ 0.05 ms sim, +≤ 4 draw calls, +≤ 6k visible tris, 0 new dynamic lights |

---

## 2. Architecture: one objective / seal system

### 2.1 Data (`src/data/level-data-3d.js`, all lists filtered by `omitIn` / `onlyIn` like today)

```js
// Seal solids are ordinary solids: kind 'grate', field `seal` = the seal id. Built top-down with their section.
S('seal-s2', -34, -22, -36, -35, 3, 11, 'grate', { seal: 'seal-s2' });
seals:      [{ id: 'seal-s2', section: 's2', ids: ['seal-s2'], open: 'slide' /* 'drop'|'iris'|'burst' (view only) */ }],
fixtures:   [ // what a verb acts on; sim positions only, the view draws them (§2.5)
  { id: 'bell-s1',  kind: 'bell',   x: -1.5, y: -4.2, z: -1, r: 0.75, minSpeed: 2.5 },           // body strike
  { id: 'cw-s2',    kind: 'haul',   anchorId: 's2-cw', time: 1.5, notches: 4 },                  // hook + yank
  { id: 'winch-s3', kind: 'hook',   anchorId: 's3-winch', hold: 0.6 },                            // hook = turn
  { id: 'lamp-s4a', kind: 'lamp',   x: -16, y: -104.5, z: -23.4, r: 0.9, time: 1.5, charge: 0.06 },
  { id: 'key-s5',   kind: 'breach', solidId: 'key-s5', hp: 1, r: 2.5, anchorId: 'key-s5-ring', haulTime: 8 },
],
objectives: [{ id: 'obj-s2', section: 's2', verb: 'haul', sealId: 'seal-s2', ids: ['cw-s2'], need: 1,
               by: { abyss: { need: 1 } } }],                 // same `by[difficulty]` pattern as section.creature
nooks:      [{ id: 'nook-s6a', section: 's6', box: {…}, budget: { normal: 25, nightmare: 15, abyss: 8 } }],
arenas:     [{ id: 'arena-s7', section: 's7', box: {…}, sealId: 'seal-s7', stages: 4,
               time: { normal: 45, nightmare: 60, abyss: 60 }, pauseOn: 's7-landing', after: { mode: 'escape' } }],
sections[i].reach = { normal: 28, nightmare: 27, abyss: 25 };  // targeting range only (item 5)
```

Field names follow the V1 convention (`…Id` strings and `ids` arrays are resolved by `verify.mjs` `idChecks`): add
`seals`, `fixtures`, `objectives`, `nooks`, `arenas` to `ID_LISTS` / `REF_LISTS`. `Level3D` gets a pass-through for
`sections[i].reach` / `par` in `_buildSection` and keeps `seal` on built solids (today's `_build` callback for solids
copies only the box, kind, tag, life). Seal solids and fixture solids are **excluded from `levelLmHash`, `levelGiHash`
and the bakes** exactly like `crumble` (one filter each in `lightmapFormat.js`, `giFormat.js`,
`tools/bake/bake_lightmaps.mjs`, `bake_gi.mjs`), so no PR in this plan invalidates the shipped lightmaps. New **lights**
are forbidden by this plan (they change both hashes); new **decor** (plaques) is batched into one PR with a re-bake.

### 2.2 Sim module `src/sim/objectives3d.js` (new, DOM-free, Node-testable, no allocation per step)

```js
export class Objectives3D {
  constructor(level, diff, bus)            // reads level.data lists, variant-filtered, `by[diff.key]` applied
  reset()                                   // new run: every seal closed, all progress 0
  reapply()                                 // after every level.reset(): re-deactivate the solids of open seals
  markDoneThrough(sectionIndex)             // Continue / warp / Sandbox: objectives of sections < i done, silently
  step(dt, player, tethers, stepIntent, t)  // fixed step, right after physics.step (240 Hz): strikes, hauls, hooks,
                                            //   lamps, breach timers, arena clocks, nook occupancy, lanes (item 9)
  setProbe(x, y, z, on)                     // once per frame: lantern hand (XR) / view point ≤ 2.5 m (desktop) / bot
  onStrike(e)                               // bus 'creature:strike' from the Mason (payload x, y, z, hit) → breach hits
  nookAt(player) → nook | null              // the game feeds it to the creature (item 10)
  isOpen(sealId)  progressOf(objId) → 0..1  doneMask (Uint8Array)
  snapshot() / restore(s)                   // bot look-ahead; typed arrays only
  serialize() → number[]  load(arr)         // save: done list + ratchet notches (Continue)
}
```

State lives in typed arrays per objective (`done`, `t`, `notch`, `hp`, `stage`). Every verb is a **ratchet**: progress
moves in notches that survive a death (lamps lit stay lit, haul notches, arena stages), so a retry never repeats more
than one notch. Movers-lite (item 7) and lanes (item 9) are closed-form functions of the run clock `t`
(`game.time` / `Sim.t`), so they need no state beyond `t`.

**Loop order (`game.js` `_stepPhysics`, mirrored in `sim.mjs` `Sim.frame`):** `movers.pose(t)` → `physics.step` →
`objectives.step`. The objective events are emitted from the fixed step, so the bot, the replay and the game agree.

### 2.3 Events (bus)

| Event | Payload | Consumers |
|---|---|---|
| `objective:progress` | `{ id, verb, k, of, x, y, z }` | audio (ratchet clank, bell, lamp catch), captions, haptics |
| `objective:done` | `{ id, section, verb, time }` | view (seal opens), audio sting, ui toast (≤ 3 words), creature override (item 11), records |
| `seal:open` / `seal:land` | `{ id, x, y, z }` / `{ id }` (player landed on a closed seal; once per approach) | view, audio "[Iron grating, locked]" caption |
| `bell:ring` | `{ id, x, y, z, strength }` | audio (also a noise source for the Mason's `_onNoise('wall')` rule) |
| `breach:hit` / `breach:break` | `{ id, hp }` | view (dust, `fx.js` `_startRain`), audio, captions |
| `nook:enter` / `nook:exit` / `nook:warn` | `{ id, left }` | creature, audio duck, haptics |
| `arena:stage` / `arena:pause` | `{ id, stage, of }` / `{ id }` | view (iris quadrant), audio, ui |
| `lane:warn` / `lane:on` / `lane:off` | `{ id, x, y, z, lead }` | fx rain column, audio rumble, captions |
| `split` | `{ section, time, best, par, medal }` | ui, save, audio |

### 2.4 Save, checkpoint and respawn rules

| Situation | Rule |
|---|---|
| Death before the objective is done | Seal closed; notches kept (ratchet). `respawn()` calls `level.reset()` then **`objectives.reapply()`** |
| Death after done, before crossing | Seal stays open (sticky); respawn at the same section's checkpoint, walk on |
| Nightmare `alternate` respawn into an earlier section | Everything already done stays done |
| Abyss `none` | `restart()` → `objectives.reset()` |
| Continue | `run.objectives` (new field; `src/meta/save.js` `cleanRun` must keep it) → `load()`; fallback `markDoneThrough(checkpoint.index)` |
| Sandbox `warpToSection(i)` | `markDoneThrough(i)` then `reapply()`; objectives stay playable |
| Menu attract camera (`_enterAttract`) | all seals open (the path flies through the shaft) |

Save schema 2 → 3 (`save.js` `SAVE_SCHEMA`, `migrateProfile`): `run.objectives` and per-difficulty
`sections: { s1: { best, medal } … }` (item 12). A newer profile is already kept as-is by `migrateProfile`.

### 2.5 View, audio, HUD (nearly free)

- **`src/render/objectivesView.js` (new):** one `InstancedMesh` of opaque iron bars (unit box, the existing `metal`
  material) for all seals, re-packed only on `seal:open` and near the head (≈ 2–3k tris visible for the largest seal):
  **not** the alpha-tested `grate` material, whose double-sided overdraw over 800–1,600 m² floors is the wrong cost at
  15 fps. Opening = bars slide / drop over 0.8 s (render-only translation). Bells, counterweights and winch drums: one
  `InstancedMesh` each from procedural lathe/box geometry (≤ 250 tris per instance, ≤ 8 instances). Total ≤ 4 calls,
  drawn only within the view distance. Kit housings reuse existing decor types `machinery`, `chain`, `cage`, `lamp`.
- **Lamps (S4):** the baked lamp pools already exist; their light is the per-section multiplier `LOOK.uLMK.z`
  (`lighting.js` `update`). Drive it by `0.2 + 0.8 × progressOf('obj-s4')` in S4: zero draw calls, zero new lights.
- **Audio (`src/audio/audio3d.js`):** handlers for the events above built from existing synth voices (bell = two
  inharmonic partials; ratchet = the existing clank path). **Captions (`src/ui/captions.js` `RULES`):** `[A bell tolls]`,
  `[Iron grating grinds open]`, `[A ratchet clacks]`, `[A lamp catches]`, `[Stone cracks]`, `[Stone scraping at the
  opening]`, `[Rocks rattle above]`.
- **HUD:** no markers, no objective list. Feedback is the world (bars, lamps, bell swing), a ≤ 3-word toast through the
  existing `showToast` slot (`ui3d.js`), the in-range anchor brightness that already exists, and a one-time hint per
  verb through the section `hints` queue (≤ 12 words, desktop wording too).

---

## 3. The twelve items

**Section verb map** (one verb per section, each taught in ≤ 10 s by one plaque or hint; intensities from CHAPTERS §5.2):

| § | Beat · Int. | Verb (objective) | Where | Teach line (≤ 12 words) |
|---|---|---|---|---|
| S1 | TEACH · 1 | **Bell**: strike it with your body on the t1 swing | bell 2.5 m east of the t1 arc's low point | "Swing into the bell." |
| S2 | TEACH · 2 | **Counterweight**: hook its ring, yank (haul) 4 notches | ring on a chain over `s2-far` | "Hook the counterweight. Squeeze to haul." (moves today's yank hint up) |
| S3 | TEST · 2 | **Winch**: hook the ring riding a turning gear (moving anchor) | gear housing on the west wall above `s3-shelf` | "Hook the turning ring." |
| S4 | WONDER · 1→3 | **Lamps**: relight 3 lamps with the lantern | catwalk end, `s4-shelf`, `s4-plinth` (on the route) | "Hold your lantern to the cold lamp." |
| S5 | TWIST · 3 | **The Mason as key**: let it strike the keystone (fallback: haul) | niche in the Gullet west wall at `s5-step6` | plaque "LET IT KNOCK." |
| S6 | REMIX · 4 | **Bell, remixed**: hook the bell-ring on either line | 3rd anchor of each line (`s6-sa3`, `s6-ra3`) | none (S1/S2 taught it) |
| S7 | EXAM · 5 | **Survive**: the iris opens in 4 stages while you hang in the nave | `s7-floor` hole | plaque "THE NAVE OPENS FOR THOSE WHO HANG." |
| S8 | ESCAPE · 5 | none: the flight to the chamber gate | — | — |

### Item 1 · Sealed section floors

- **Design.** A seal is 1–4 grate solids at the choke plane of §0 (table). Closed: a floor you stand on and a wall your
  hook cannot see through (`segmentBlocked` counts active solids), so nothing below is targetable. Done: the solids go
  `active = false` (collision, LOS, raycast and the creature already honour it) and the bars slide away. Seals are never
  holed while closed.
- **Data.** Seal solids + `seals[]` (§2.1). V1 additions: every seal solid lies inside its section's shaft rectangle;
  checkpoint i+1 lies below seal i; no anchor of section i+1 sits above seal i; seal boxes overlap no hazard.
- **Touchpoints.** `level3d.js` (`seal` field kept; `reset()` unchanged, followed by `reapply()`); new
  `objectives3d.js`; `game.js` (`_buildWorld` creates it, `_stepPhysics` steps it, `respawn` / `_warp` / `_resumeAt` /
  `restart` per §2.4); `save.js` (§2.4); `objectivesView.js`; `lightmapFormat.js` / `giFormat.js` filters.
- **Tests.** `tools/tests/objectives/unit.mjs` (new): open/close, `reapply` after `level.reset`, sticky across respawn,
  `markDoneThrough`, snapshot/restore round trip, serialize/load, no allocation per step (pattern of
  `tests/creature/allocprof.mjs`).
- **Bot / verify.** Section routes start with earlier objectives done; the skip probe and airtight test (§5.2).
- **Perf.** Sim: ≤ 4 boxes per section in the existing Y buckets; zero cost while closed. View: 1 call.
- **VR comfort.** None (no motion of the player). **Fairness.** A closed seal is a floor: falls onto it hurt like any
  floor; climb-out guaranteed by item 4. **Knobs.** none. **Effort.** M (4 d).

### Item 2 · Objective gates, one verb per section

| Verb | Sim rule (in `Objectives3D.step`) | Data knobs per difficulty | Bot step |
|---|---|---|---|
| Bell (S1) | body centre within `r + 0.38` of the bell and closing speed ≥ `minSpeed`; the bell is a small `metal` solid you bounce off (wall hits below 8.5 m/s do no damage: `CONFIG.health.wallThreshold` × lethal 17) | `minSpeed` 2.5 / 3 / 3.5 | `{ a: 't1' }, { ring: 'bell-s1' }` (pump toward the bell until `objective:done`) |
| Haul (S2, S5 fallback) | hand attached to the haul anchor and `stepIntent.hands[h].yank > 0.5` → `t += dt`; one notch per `time / notches`. A haul anchor carries `haul: true`, and `Physics3D.step` **skips the yank reel** for it (no pull on the player: comfort) | `time` 1.5 / 1.8 / 2.2 s | `{ a: 's2-cw' }, { haul: 'obj-s2' }` (yank = 1 until done) |
| Hook (S3, S6) | `grapple:attach` to the fixture's anchor and held `hold` s | `hold` 0.6 / 0.8 / 1.0 s | existing `{ a: … }` step, plus a phase wait in S3 (item 7) |
| Lamp (S4) | probe within `r` of the wick for `time` s; costs `charge` of the lantern (never blocks: with less charge left the relight takes twice as long and empties it; the lantern never goes dark, `inventory3d.js` `lanternLevel`) | `charge` 0.06 / 0.08 / 0.10 | `{ w: [x, z] }, { light: 'lamp-s4a' }` (probe = body + 0.5 m toward the lamp) |
| Breach (S5) | item 3 | item 3 | haul fallback |
| Survive (S7) | item 11 | item 11 | `{ waitObj: 'obj-s7' }` |

- **Touchpoints.** `objectives3d.js`; `physics3d.js` `Physics3D.step` (one `haul` guard where yank reels);
  `game.js` probe from `input.handPose('left')` (XR, grip held) or the camera ray ≤ 2.5 m + hold E (desktop, the E09
  convention); `inputManager.js` exposes `intent.interact` (E24); `inventory3d.js` gets `spend(charge)`.
  Fixture anchors (`s2-cw`, `s3-winch`, `key-s5-ring`) are new `A()` / `chainRing()` entries tagged `objective`.
- **Tests.** Verb units per kind (thresholds, notches, never-block lamp, haul does not move the player:
  `Physics3D` position unchanged under yank on a `haul` anchor). **Perf.** O(fixtures in the current section) per step.
- **VR comfort.** No verb moves the player (bell bounce is the player's own swing; haul is reel-free). **Fairness.**
  Every verb has no fail state; the lamp never soft-locks on an empty lantern. **Effort.** M (5 d for the four verbs,
  S6 hook verb 0.5 d).

### Item 3 · The Mason as the key (S5)

- **Design.** A niche (1.6 m mouth, so the head's `minClear` 1.0 m keeps the Mason out) is cut into the Gullet west
  wall at `s5-step6`. A cracked keystone pillar (`breach` solid, 2.4 m wide, 2.5 m tall, 0.6 m thick) stands 0.5 m in
  front of the mouth, leaving a 0.9 m side gap to walk in, so almost every line from the shaft to a player in the niche
  crosses it. The keystone holds up the S5 seal plug; breaking it drops the plug. The player stands in the niche (a **lure volume**). The Mason comes:
  it lunges when you stall (`stallCommit`) or when you shoot it (annoyed surge → contact lunge). The wind-up is the
  existing telegraph (0.75 / 0.65 / 0.5 s, crown flare, `[Stone grinding, rising]`). The lunge stops before the first
  solid on its line (`_strike`), which is the keystone; a Mason `creature:strike` whose end point lies within `r` 2.5 m
  of it is a hit; `hp` 1 → `breach:break`, `objective:done`.
- **Safety rules (creature changes, `creature3d.js`).** (1) `_strike`: a strike never hits when an active solid lies on
  head → player (today `hit` is distance-only); (2) a breach solid does not block the creature's *attack* LOS
  (`_losBlocked` variant that skips `breach`), so the attack starts and the stone takes it; (3) inside a lure volume
  `hit` is forced false for the Mason and skitterlings. The player is safe by rule, not only by geometry.
- **If the creature is not near / not present.** Sandbox (creature disabled), a Mason recovering far above, or an
  impatient player: the keystone carries a ring (`key-s5-ring`); hauling it for `haulTime` 8 / 10 / 12 s also breaks
  it. Hauling is loud (each notch is a `bell:ring`-strength noise), so the Mason usually arrives first. The Mason line is
  the fast line (≈ 1 strike), the haul the slow one.
- **Touchpoints.** `creature3d.js` `_strike`, `_losBlocked`/`_startAttack`, a `lure` flag read in `_strike`;
  `objectives3d.js` `onStrike`; `game.js` passes the lure/nook state each frame; level data (niche via an opening in
  `walls('s5-wall', …)`, keystone, ring, plaque).
- **Tests.** `tools/tests/creature/lure.mjs` (new, pattern of `annoy.mjs`): seeded Creature3D at fixed 60 Hz, player in
  the niche on each difficulty → ≥ 95 % of 200 seeds break the keystone within 40 s, 0 hits on the player, stall and
  annoy paths both covered; a strike through a solid never hits (unit). Pacing regression `pacing.mjs LEVEL=real`.
- **Bot / verify.** Route uses the haul fallback (deterministic; no creature RNG in V2/V13).
- **Perf.** One extra segment test per strike (rare). **VR comfort.** None. **Fairness.** Risks in §6 (R4).
- **Knobs.** `haulTime`, keystone `hp` (1 on all), lure volume on/off for skitterlings. **Effort.** M–L (5 d).

### Item 4 · Grate floors under each section

- **Design.** The closed seal **is** the grate floor (no separate floor): where a section already has a floor with one
  hole the seal is a plug; S3 and S6 get full grate floors (§0 table). No holes while closed, so a skip ends on the
  grate. Landing uses today's fall damage (`health3d.js` `landing`): a 20 m drop onto the S3 grate is still lethal, a
  lowered skip survives, and you then rope back up.
- **Climb-out affordance.** V1 check: from every standing spot on a closed seal (the `coverage()` standing-spot grid), at
  least one route anchor of the section above the seal is targetable (exact `findTarget`, section reach), or a climb zone
  (`level.climb`) starts within 1 m. Where it fails, add one recovery `chainRing` (tag `recovery`; Abyss makes half of
  them fragile automatically, `level3d.js` constructor).
- **The Mason's reaction.** Grates are already non-crawlable for it (`isStructural`); on `seal:land` the Mason is not
  told anything new (no extra rule), but `seal:land` is a noise (`_onNoise('wall')`, intensity = impact): skipping is
  loud. Skitterlings that spawn below the player (`SKITTER.below`) must spawn above a closed seal: clamp their offset to
  the seal plane (`skitter3d.js`).
- **Touchpoints / tests.** V1 climb-out check (`verify.mjs`); `seal:land` once per approach (unit); skitter spawn clamp
  (`tests/creature/skitter.mjs`). **Perf.** none extra. **Comfort.** none. **Effort.** S (1.5 d).

### Item 5 · Per-section hook reach

- **Design.** `sections[i].reach` (number or `{ normal, nightmare, abyss }`, default `diff.aimRange`). Proposed:
  S1–S3 32/29/27 (unchanged), S4 30/28/26, S5 29/27/25, S6 28/27/25, S7–S8 26/25/24. Only **targeting** shrinks;
  `maxRopeLength()` stays `diff.aimRange + 4` so every lowering step keeps its rope (V1 rope check unchanged). 22 m is
  rejected: S7/S8 chain spacing is 21–27 m (§0), and the floor per section is set by the harness (below).
- **Read sites.** `TetherSystem.aimRangeAt(player)` (new: the section of `player.y`, cached per section) replaces
  `this.diff.aimRange` in `findTarget`, the `rope:shot` range and the miss length (`fire`); `levelView.js`
  `_updateAnchors` and `handsView.js` laser use `game.tethers.aimRangeAt(game.player)`; `bot.mjs` `targetable` and
  `verify.mjs` `coverage` likewise.
- **How it is shown.** The existing cue: anchors beyond reach dim to 0.3 and the laser dot goes hollow. Diegetic reason:
  rust: mounts below S4 get the rusted tint (one per-section uniform on the existing `mount` material) and S6 opens with
  one hint "The deep rings are rusted. Get closer." (≤ 12 words).
- **Bot effect / floors.** `verify.mjs` records each route's attach distances per section (`grapple:attach` `distance`
  is already logged by `Sim`); gate: max attach distance ≤ reach − 1.5 m on every variant, alt line and scenario. If a
  section fails, its reach rises to the floor, not the route.
- **Tests.** `aimRangeAt` unit; coverage V3 re-run. **Perf.** none. **Comfort.** none. **Fairness.** Section boundaries:
  the reach of the section you are in, so a ring highlighted across a border may dim; acceptable, shown. **Effort.** S (2 d).

### Item 6 · Reward the long way

- **Pickups.** New supply tier `slow` (spots only on the safe line of a fork) with weights favouring battery and first
  aid (`SUP_W.slow = [2.5, 4, 1, 6]`); `pickups3d.js` `TIER_PICK.slow = 1.3` and a third fairness rule in
  `pickSupplies` → `ensure()`: every fork's safe line holds ≥ 1 item per run. No spots on fast lines (V1 check: no
  `supplies[]` within 3 m of a `risk`/`shortcut` anchor's landing). Lantern oil = the existing battery item.
- **Lore.** Plaques only (≤ 12 words, CHAPTERS §3.2.5: no notes, diaries or voice-over), one per safe line, placed in a
  lamp-lit alcove with the supply spots ("Lanternwright cache"); all plaque text in one PR with the lightmap re-bake
  (decor is in `levelLmHash`). Audio "logs" become ambient story sounds with captions only (a distant bell, three
  knocks), no VO. Budget: ≤ 7 new plaques, ≤ 70 words, inside the 900-word chapter limit.
- **Shortcuts cost safety.** Fast lines get `risk`/`shortcut` tags (Abyss already fragilises half the `shortcut` rings,
  `level3d.js`), no recovery ring, crumble ledges (`'crumble'`) where they land, and no supplies.
- **Tests.** `tests/bag/unit.mjs` fairness over 400 seeds with the new rule. **Bot.** none (pickups are not in V2).
  **Perf/comfort.** none. **Knobs.** weights per difficulty (Abyss: safe-line spots favour first aid). **Effort.** S (2 d).

### Item 7 · Moving anchors (E13/E14/E15 subset)

- **Design.** Two closed-form mover kinds only: `pendulum` (chain cages: pivot, plane, length, amp, period, phase) and
  `orbit` (a ring on a gear rim: centre, axis, radius, period, phase), pose = f(run clock t). Data: `movers: [{ id,
  kind, …, carry: { anchors: [...], decor: [...] }, maxSpeed }]` (E13 shape). Uses: S3 winch ring on a turning gear
  (radius 1.6 m, period 12 s, LOS to it only on the near half-turn: the timing puzzle) and one S3 swinging cage ring as
  the fast line across the span2 → span3 gap (pendulum 14 m, ±0.3 rad, 7.5 s).
- **Level3D.** Carried anchors are marked `dynamic` and kept out of the Y index in `level.dynAnchors` (≤ 8); `anchorsNear`
  appends those passing a radius test (E14). Anchor gets `vx, vy, vz`.
- **Rope.** `Rope3D.measure` already reads `anchor.x/y/z` every step, so the rope follows. E15 minimum: the stretch rate
  in `pull()` and the spin cap in `reel()` use the velocity **relative** to the anchor (3 lines). Hook in flight:
  `launch` fixes the flight time, `_arrive` attaches to the anchor's current pose (it homes); with `maxSpeed` ≤ 1.5 m/s
  and flights ≤ 0.45 s the drift is ≤ 0.7 m; the rope view draws to the live pose. `findTarget` adds a moving-anchor
  assist (+0.6 / 0.4 / 0.2 m on `rayAssist`, E15).
- **Render.** `levelView.js` anchor glyphs read live positions for dynamic anchors; carried decor gets per-frame matrices
  (≤ 4 instances).
- **Bots.** `{ wait: { mover: 'mov-s3-gear', phase: [0.10, 0.35] } }` then `{ a: 's3-winch' }`; the look-ahead needs
  no mover state (closed form of `Sim.t`, which `restore()` already rewinds).
- **Tests.** Closed form vs integrated reference within 1 mm; relative-velocity rope test (hanging from a pendulum
  ring conserves relative tangential motion, E15); max anchor speed ≤ 1.5 m/s (V1). **Perf.** ≤ 8 pose evaluations
  per step. **Comfort.** A rope the player chose may carry them ≤ 1.5 m/s along a smooth sine: allowed by CONTRACT rule
  5; no rotation. **Knobs.** period × 1 / 0.9 / 0.8, assist. **Effort.** M (5 d).

### Item 8 · Forks: fast and fragile vs slow and safe

- **Data.** `routes: [{ id: 'r-s3-safe', fork: 'fork-s3', line: 'safe', ids: [...] }, { id: 'r-s3-fast', …, line:
  'fast', ids: [...] }]` (flat, so `idChecks` resolves `ids`). The objective of a forked section is reachable from both
  lines (it sits where they converge, or exists on both like S6).
- **Per section** (reusing what exists): S2 `s2-b2` shortcut (exists) vs floor and catch ring; S3 cage swing (item 7)
  vs the three spans; S4 skip the cradle (a2 → a3 chain) vs the zig-zag; S5 swing-release vs lowering (technique fork,
  no data); S6 the existing fork; S7 spire face rings (`s7spire`) vs the spiral; S8 wall ring (`s8wall`). S1 none.
- **Verify.** `routes.mjs` `FORK` → `FORKS = [{ key, risky, safe, fasterBy }]` (S6 keeps 0.25; others 0.15);
  `verify.mjs` runs two full runs (all-fast, all-safe) and the per-fork comparison; the fast line's min hp and fragile
  count are reported (cost of safety visible in the report). Bots pick the line named in the route list; no new bot AI.
- **Tests.** V2 both lines all variants. **Perf/comfort.** none. **Fairness.** Abyss removes some recovery: fast lines
  must still pass V2 on Abyss. **Effort.** M (3 d).

### Item 9 · Pacing: set-pieces and quiet nooks

**Tension graph** (Int. 1–5; quiet nook = a lamp-lit alcove, item 10 where the creature is lethal):

| § | Arrive | Set-piece (cost) | Peak | Quiet after |
|---|---|---|---|---|
| S1 | 1 | bell (none) | 1 | Threshold lamp |
| S2 | 1 | the long swing; **collapsing span**: `s2-span` becomes `crumble` with `life` 2.5 on Normal (data only) | 2 | far-pier cache (item 6) |
| S3 | 2 | **rockfall lane** across the span2 → span3 gap (data + one sim rule) | 3 | shelf alcove, winch |
| S4 | 1 | sighting (exists); lamps relit one by one | 2 (3 NM/AB) | catwalk nook |
| S5 | 3 | lure the Mason (item 3) | 4 | the niche itself after the break |
| S6 | 3 | the fork; **wind squall** on the throat line (comfort-gated) | 4 | stair shelf-3 nook |
| S7 | 4 | survive arena (item 11) | 5 | none (exam) |
| S8 | 5 | flight | 5 | the chamber |

- **Rockfall lane (cheap).** A hazard (`H(…, 'rockfall')`) with `schedule: { period: 7, on: 1.6, phase, lead: 1.5 }`;
  `Objectives3D.step` sets `active` from the clock (hazards already honour `active`, `physics3d.js` hazard loop) and emits
  `lane:warn` `lead` s before; `fx.js` reuses `_startRain(x, y, z, n, 1.9)` (the `trigger:debris` path), audio rumble,
  caption. Bot: `{ wait: { lane: 'rock-s3', clear: 2.5 } }`.
- **Wind squall (comfort-gated, P6).** A `volumes` entry `{ kind: 'wind', box, dir, accel: 2.0 }`: while airborne or
  hanging inside it, `Physics3D.step` adds `accel × windSquall(t)` horizontally (`src/render/wind.js` is already pure:
  move it to `src/sim/wind3d.js`, render imports it and reads the same clock). Off when `settings.reducedEffects`
  (verify both). Never applied to a grounded player.
- **Not built:** rising hazard. In a descent the equivalent is a front chasing you down (E19); S8 already has
  `escape` pressure. Revisit only if S8 playtests read flat.
- **Tests.** Lane schedule unit + bot crossing; V6 "a bot that ignores the lane is hit". **Perf.** a few boxes; the rain
  column is the existing pool. **Effort.** M (4 d; squall +1 d).

### Item 10 · Hiding nooks

- **Design.** A nook is an alcove with a mouth ≤ 1.8 m wide (the Mason's head, `minClear` 1.0 m, cannot enter) and a
  `nooks[]` safe box. Inside it `creature.hidden = true` (set by `game.js` each frame from `objectives.nookAt`):
  `canAttack` is false in `_updateHunt`, `_strike` never hits (also for skitterlings, which do fit through), the stall
  clock is **frozen** (`_updateStall` neither adds nor resets: hiding does not refresh `stallCommit`), and the creature
  holds at its menace distance listening (OBSERVING, pits lit). Each nook has a **budget** per visit (25 / 15 / 8 s,
  refilled after 20 s outside); 5 s before it runs out `nook:warn` plays `[Stone scraping at the opening]`; at 0 the nook
  stops protecting. No soft-lock: the budget always ends.
- **How the player is told.** A lamp-lit alcove with a carved hand-over-flame glyph (existing `glyphs` decor), the
  threat value eases (`threat3d.js` gets no burst / near-miss spikes while no attack can start), ambience ducks (E18 `hush`
  behaviour through the audio bus), haptic double pulse on entry. One plaque in S4: "THE MASONS' REST. IT CANNOT FOLLOW."
- **Placement.** S4 catwalk end, S5 lure niche (the lure volume of item 3 is a nook with `lure: true`, which keeps
  attacks on), S6 stair shelf 3 (safe line only: item 6), S8 none. Volumes ≤ 24 per section (E18 budget).
- **Touchpoints.** `creature3d.js` (`hidden`, `_updateHunt` canAttack, `_updateStall`, `_strike`); `skitter3d.js`
  (same flag per slot); `game.js`; level data (alcoves via `walls()` openings).
- **Tests.** `tools/tests/creature/nooks.mjs`: seeded pacing at 60 Hz, a player in a nook is never hit while the budget
  lasts on all difficulties; leaving after the budget behaves like today; stall frozen. **Perf.** one AABB test per frame.
  **Comfort.** none. **Fairness.** budgets per difficulty; no nooks on fast lines. **Effort.** M (3 d).

### Item 11 · Survive-the-frenzy arena (S7)

- **Rules.** The arena clock runs while the player is alive, inside the nave box (below the landing, y < −292) and not
  grounded on `s7-landing` (`pauseOn`: camping at the top pauses it, `arena:pause`); hanging, swinging, the perch and
  the closed iris all count. Stage = `time / 4` (45 / 60 / 60 s total): each stage opens one iris quadrant; the quadrant
  over the `s8-landing` lowering point opens last. Stages are ratchets: a death keeps completed stages, the clock
  restarts at the last stage boundary; Abyss restart resets all.
- **The creature.** Frenzy during the arena (today's S7 mode). On `objective:done` the game calls a new
  `creature.setOverride({ mode: 'escape' })` (merged in `_cfgOf` after `by[difficulty]`, cleared on section change), so
  `holdOnRecover` keeps it ≤ 12 m above you and pushes you through the open floor; S8 is `escape` anyway, so the
  handover is seamless. `onRespawn` re-applies the override if the arena is done.
- **Bot / verify.** The bot chains to `s7-n11` (~35–40 s) and hangs: `{ waitObj: 'obj-s7', t: 70 }`, then lowers.
  Deterministic (run clock). V6: a bot that stands on the landing never opens the iris.
- **Tests.** Arena unit (pause rules, ratchet, death); creature override unit; `pacing.mjs LEVEL=real` regression.
- **Perf.** none. **Comfort.** none. **Fairness.** Normal 45 s keeps the S7 time near CHAPTERS' 4 min; recovery rings
  under the spiral stay (2 / 1 / 0). **Effort.** M (3 d).

### Item 12 · Par-time medals per section

- **Records.** Split = run time from entering section i to entering i+1 (S8: to the goal), deaths and respawns included
  (`game.time` already counts while dead). Recorded only when the whole section was played in this run (not after a
  Continue mid-section, never in Sandbox, `recordTimes` false). Best per section × difficulty in
  `save.js` `chapters.ch1.byDiff[d].sections[sid] = { best, medal }` (schema 3; `mergeDiffRecords` keeps the better).
- **Par.** `verify.mjs --write-par` writes `src/data/par-3d.js` (generated, never hand-edited) from the bot's splits;
  medals: gold ≤ 1.0 × bot split (beat the machine), silver ≤ 1.4 ×, brass ≤ 2.0 ×. V14-style check warns when a split
  drifts > 10 % from the par file.
- **UI.** No new HUD element: the next section's title card (`ui3d.js` `showSectionTitle` on `section:enter`) gets one
  line "I · 1:12.4 · SILVER" (title and toast share a VR slot, so no extra draw call); the victory panel lists the 8
  splits; a menu **Records** screen (new entry in `SCREENS`) per difficulty. Leaderboard-free, no ghosts.
- **Tests.** `tests/release/test-save.mjs`: schema 2 → 3 migration, merge keeps the better split, Continue never records
  a partial split. **Perf.** none. **Effort.** M (4 d).

---

## 4. Dependencies and phased delivery

```
Objectives3D core (1) ─┬─ grate/climb-out (4) ─ skip probe (§5) ─── PHASE 1 (skipping fixed)
                       ├─ verbs (2) ─┬─ lamps / bell / haul        PHASE 3
                       │             └─ winch ← movers-lite (7)    PHASE 4
                       ├─ nooks (10) ─ Mason key (3) ─ arena (11)  PHASE 5
reach (5) · forks (8) · rewards (6) · splits (12 data)             PHASE 2   (independent of the verbs)
set-pieces (9): lanes (P4), squall + medals UI (12) + tuning       PHASE 6
```

| Phase | PRs (small, each shippable) | Acceptance |
|---|---|---|
| **P1 Seal the shaft** (≈ 6 d) — **fixes skipping** | (a) `verify.mjs` skip probe + airtight test, report-only, to record today's skips; (b) `objectives3d.js` + seals S1–S7 + view bars + hash filters + save `run.objectives`; every objective temporarily the **hook verb on an existing mid-route anchor** (S1 `t1`, S2 `s2-hook`, S3 `s3-a2`, S4 `s4-a2`, S5 `s5-h4`, S6 `s6-sa3`/`s6-ra3`, S7 `s7-n6`), so routes need no new steps; (c) climb-out check, skitter spawn clamp | skip probe 0 passes on all variants; ALL CHECKS PASS; E29 p99 unchanged ± 0.05 ms; device: ≤ +1 draw call, no lightmap fallback |
| **P2 Reach and routes** (≈ 8 d) | (a) `aimRangeAt` + per-section reach + attach-distance floors; (b) `FORKS` + alt routes S2/S4 + fork cost report; (c) supply tier `slow`, fast-line rules; (d) splits recorded + save schema 3 + `par-3d.js` generator | V2 on both lines all variants; reach floors pass; bag fairness 400 seeds; save migration tests |
| **P3 Verbs I** (≈ 6 d) | S1 bell strike, S2 counterweight haul (reel-free), S4 lamps (probe + `uLMK` drive + charge), hints/plaques/captions/audio | bot routes with `ring` / `haul` / `light` steps green; V13 replay identical with the new intent fields; teach-in-10-s playtest note |
| **P4 Machines** (≈ 8 d) | movers-lite + dynamic anchors + relative rope; S3 winch on the gear and the cage fast line; rockfall lane; S2 collapsing span | mover unit tests; S3 both lines green; lane V6 test; headclear.mjs clean |
| **P5 The Mason** (≈ 10 d) | `_strike` occlusion + lure/hidden flags; nooks; S5 keystone (haul fallback in routes); S7 arena + escape override; plaque/lore PR with the one lightmap re-bake | `lure.mjs`, `nooks.mjs`, arena units, `pacing.mjs LEVEL=real` no regression in careful-play survival; owner playtest |
| **P6 Polish** (≈ 5 d) | wind squall (comfort-gated), medals UI + Records screen, length tuning to 24–28 min, Quest perf pass | device: 72 Hz on the S3/S6/S7 worst views; CHAPTERS §5 length |

---

## 5. Verify-harness plan

### 5.1 How the bots complete objectives

- **`sim.mjs` `Sim`.** Creates `Objectives3D` (and movers) like `Game3D`; steps it after every `physics.step` in the 4
  sub-steps; `spawn()` calls `level.reset()`, then `objectives.reset()`, `markDoneThrough(startSection)`, `reapply()`;
  `snapshot()`/`restore()` include `objectives.snapshot()` and the seal solids join `dynSolids`; the ghost bus swap
  (today only when the creature is on) always covers objectives, so a look-ahead never completes anything for real.
- **Intent.** `makeIntent()` gains `interact` and `probe { x, y, z }`; `INTENT_W`, `writeIntent`, `readIntent` grow
  (V13 replay must reproduce objective completion).
- **`bot.mjs` steps** (added to the `runRoute` dispatch): `{ ring: fixtureId }` pump toward the fixture while attached
  until `progressOf` = 1; `{ haul: objId, hand? }` yank 1 until done; `{ light: fixtureId }` set the probe 0.5 m from the
  body toward the wick and `interact` until done; `{ waitObj: objId }` hold the current line until done;
  `{ wait: { mover, phase: [a, b] } }`; `{ wait: { lane, clear } }`. `targetable()` uses `aimRangeAt`. `routes.mjs`
  stays import-free (the browser e2e loads it as-is).
- **Routes.** Each `ROUTES[sid]` gets its objective steps (P1: none; P3+: per §3); `ALT_ROUTES`, `SCENARIOS` and
  `ROUTE_START` start with `doneThrough`; `s2catch` lands on `s2-floor-a` above the S2 seal, so it hauls first.

### 5.2 The skip probe (new, gating from P1)

1. **Static airtight test (per variant).** For section i with a seal: from every bot trace point and standing spot
   above seal i, no anchor below it is targetable (`findTarget`, section reach, seals closed); a 1 m grid of vertical
   6 m probes just above the seal plane hits an active solid everywhere inside the section's `shaft`.
2. **Greedy descender bot.** From each checkpoint, objectives undone: repeatedly target the **lowest** targetable
   anchor, attach, lower to full rope, release over the lowest visible floor, fire at the lowest ring while falling;
   60 s budget per section. Pass = it never enters section i+1 (`sectionIndexAt`) with objective i undone. It reports
   where it ended (dead / on the grate / stuck), which doubles as the climb-out check.
3. **Today's baseline** (P1a, report-only) is attached to the P1b PR so the owner sees the before/after.

### 5.3 Determinism and gates

- Objectives, movers and lanes are functions of the fixed step and the run clock; the creature is never on the route
  bots' critical path (S5 uses the haul fallback, S7 the clock). V13 hashes trajectory **and** a FNV of the
  `objective:*` event sequence (run, rerun, replay must match).
- Creature-dependent behaviour (lure, nooks, arena pressure) is tested in `tools/tests/creature/` with seeded
  `Creature3D` at a fixed 60 Hz, not in V2.
- E29: a new `objectives` timer row in `SystemTimers` (`TIMED_SYSTEMS`); V12 counts movers ≤ 8, volumes ≤ 24 per section.
- `headclear.mjs` after every seal / niche data change; `--write-baseline` after each phase (V14 shows the moved splits).

---

## 6. Risk register and open questions

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Quest perf (owner already sees 15 fps): big grate floors, extra decor | M / H | Opaque instanced bars, no alpha grate, no new lights, lamps via `uLMK`; ≤ 4 calls; device check in every phase |
| R2 | Seal or decor changes invalidate the shipped lightmaps (`levelLmHash`) → fallback look and cost | H / H | Seal and fixture solids excluded from hashes and bakes like `crumble` (P1); all plaques in one PR with one re-bake |
| R3 | Bot routes break (reach floors, seal planes cutting a swing arc, head clearance) | M / M | Seal planes chosen at existing floors; S3/S6 floors checked against the b1 and lowering arcs with `headclear.mjs`; reach floors from attach distances |
| R4 | Mason key unfair or unreliable (distance-only `hit`, frame-rate creature, Mason far away) | M / H | `_strike` occlusion + lure volume rule; haul fallback; `lure.mjs` 200 seeds × 3 difficulties |
| R5 | Soft-locks: on a closed seal with no way up; empty lantern; arena camping | L / H | Climb-out V1 check; lamp never blocks; arena pause only on the landing; stuck detector "Wake at the last lamp" (CHAPTERS T15) as a backstop |
| R6 | Creature stuck under/over a seal (skitterlings spawning below; `_relocate`) | M / M | Spawn clamp above the seal; `walls.mjs` / `skitter.mjs` with seals closed and open |
| R7 | Save / Continue mismatch (seal reopened after Continue) | L / M | `run.objectives` + `markDoneThrough` fallback; migration tests |
| R8 | Comfort: haul pulling the player, wind squall, moving anchors | M / M | Haul anchors skip the reel; squall ≤ 2 m/s², airborne only, off with reduced effects; movers ≤ 1.5 m/s, translate only |
| R9 | Length creep past 24–28 min | M / M | Objective budget ≤ 25 s bot time per section; tune by notches and stage times, never by geometry |

**Open questions for the owner** (each with the default this plan assumes):

1. Objectives stay done after a death, and partial progress is kept in notches? **Default: yes** (Abyss restarts anyway).
2. S8 stays unsealed (the flight)? **Default: yes.**
3. Reach: harness floors with S7/S8 at 26/25/24 instead of ~22 m (which breaks the 21–27 m chain spacing)? **Default: yes.**
4. Mason key: the haul fallback is available at once (slow, loud) rather than after a wait? **Default: at once.**
5. Arena times 45 / 60 / 60 s, stages kept after a death on Normal and Nightmare? **Default: yes.**
6. Lore by plaques and captioned ambient sounds only, no audio logs or voice (CHAPTERS §3.2.5)? **Default: yes.**
7. Medal thresholds gold ≤ 1.0 ×, silver ≤ 1.4 ×, brass ≤ 2.0 × the bot split, deaths included in the time? **Default: yes.**
8. Sandbox: objectives on for practice, a warp opens every seal above? **Default: yes.**

---

## 7. What I would NOT do

- No objective markers, quest log, minimap, waypoint arrows or completion cutscene; no forced camera, teleport or
  rotation when a seal opens.
- No alpha-tested grate floors, no new dynamic lights, no new Blender kit parts for this work; no full E03 beats or
  E13 movers system (only `pendulum` + `orbit`), no rotating colliders, no rope wrapping.
- No holes in a closed seal, and no seal in S8.
- No route bot that depends on the creature's randomness; no objective without a creature-free fallback.
- No resetting finished objectives on death; no timers that run while the player stands in a safe place.
- No 22 m reach in S7/S8; no shrinking of rope length (only targeting range).
- No audio logs, voice-over or text panels; no leaderboards or ghosts.
- No rising-hazard set-piece until S8 playtests ask for it.
