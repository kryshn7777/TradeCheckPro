# THE HOOD: cover your lantern

Light keeps you alive (you read the holds by it), but light draws the Mason: since MASON_SIGHT.md it **sees the lantern-bearer** and
chases. The lantern has no off switch, and breaking the line of sight was the only counterplay. The hood puts one in your hands: cover
the flame and it stops SEEING you **from afar**. It does not stop HEARING you, and since MASON_BODY_SIGHT_LEASH.md (2026-11-06) it
**sees your body up close** (within `bodyRange` 12 / 14 / 16 m in a clear line) whatever the lantern does: the hood hides you only
beyond that.

## What the player does

| | cover | toggle |
|---|---|---|
| Headset | put the right hand over the lantern on the left bracer (the right grip pose within **12 cm** of the lantern) and **squeeze the right grip**; it stays covered while the grip stays squeezed and the hand within 18 cm | a **quick left stick click** (released within 0.3 s; a held click stays the brake) |
| Desktop | **hold V** (V was free in `desktopInput.js`) | - |
| Touch | **hold HOOD** (a button above the goggles) | - |

Settings > Comfort > **Lantern hood**: `hold` (default: covered while the input is held; a stick tap latches it, pressing the hold input
takes the latch back) | `toggle` (each press of the input flips it). In the headset the grip that covers the lantern is not a climb grab
and not a rope yank; a right hand already holding on (climb3d gripping with it last frame) does not start a hood. A soft haptic tick
when the palm closes. The view never moves (VR comfort).

What happens: the flame shrinks to a slit (the light x(1 - 0.93 k), its range x(0.25 + 0.75 (1 - k)), the bulb and the glass glow x(1 -
0.8 k), the idle flicker stilled) and the shaft goes black. A gloved palm closes over the glass with a muffled slap and the flame chokes
to a hiss; on the uncover the starved flame catches its air again (`audio/lanternHoodSfx.js`: `lantern.hood` / `lantern.unhood`,
registered with `registerSfx` / `registerSfxRoute`, at the left hand).

## The rules (sim/lanternHood.js)

- `k` (0..1) slews in over **0.25 s** and out over **0.2 s** (linear); `on` = `k > 0.6`.
- **Re-hood lock-out 0.6 s** after an uncover: no strobing the hood to beat the notice count (which needs 0.5 s of CONTINUOUS sight;
  the lock-out guarantees every uncover shows the light for longer than a notice commit). A brush that never reached `on` starts no
  lock-out. A toggle press inside it is refused.
- Not live (dead, the menu, the victory, a new run, a restart): off at once.
- The lantern drains at **x0.3** while fully covered (x(1 - 0.7 k)): a starved flame burns slowly (`Inventory3D.update(dt, health,
  live, drainMul)`).
- Contract (others depend on it): the bus event **`lantern:hood {on}`** on every change of `on`, and **`game.hood`** with `{on, k}` (the
  LanternHood itself; also `lightMul`, `rangeMul`, `drainMul`, `mode`, `lock`, `stats`).

## What it does to the hunters

- **The Mason** (`game.js` `_updateCreature`): `lit = charge > 0 && !hood.on` goes into `setSight`. Unlit, `MasonSense` never sees you
  **beyond `bodyRange`** (12 / 14 / 16 m; inside it it sees the body: MASON_BODY_SIGHT_LEASH.md): a notice in progress from farther
  breaks at the next 0.1 s line-of-sight sample (no commit), a chase in progress keeps only its `memory` (3 / 3 / 4 s) and drops back
  to the sound hunt; with the Mason within bodyRange covering changes nothing (it keeps the chase). It **still hears you**: the sound hunt, the stall clock, listening, stall lunges all work.
  Uncovered again, it notices you at the next sample (0.10-0.17 s after the release in the tests at ~20 m).
- **The swarm** (`render/roachView.js`): it only fled your light; the light ratio is multiplied by `(1 - hood.k)` explicitly (the ratio
  is taken against the already-hooded `lanternBase`, so the hood would cancel out). Covered, the tiny red ones stop fleeing and creep up.
- **You**: you cannot read the holds in the dark (the light is 7 % of itself, its range 25 %).
- `render/lanternMood.js`: covered counts as still (the idle flicker suppressed) and the visible flame is pinched, also with the Living
  flame setting off (the hood is gameplay).

## Balance (measured: is hood camping a free win?)

No. The counters do the work without tuning: the camper is found by sound and by the stall clock.

`tests/creature/pacing.mjs` with `HOOD=1` (`LEVEL=real HOOD=1 node pacing.mjs 20`), the REAL level, scripted careful players who never
react, the hunt gate OFF (as in MASON_SIGHT.md's balance note):

**Hood camper: seconds from the stall until caught, lantern lit vs covered (careful player, never reacts)**
| diff | stall kind | lantern | n | caught | median | p90 | never caught (400 s) |
|---|---|---|---|---|---|---|---|
| normal | still | lit | 10 | 7 | 9.1 | 80.8 | 3 |
| normal | sway | lit | 10 | 8 | 17.7 | 26.2 | 2 |
| normal | still | covered | 10 | 7 | 11.3 | 85.9 | 3 |
| normal | sway | covered | 10 | 7 | 19.3 | 30.1 | 3 |
| nightmare | still | lit | 8 | 7 | 10.0 | 41.1 | 1 |
| nightmare | sway | lit | 12 | 7 | 15.8 | 40.2 | 5 |
| nightmare | still | covered | 8 | 6 | 10.4 | 15.8 | 2 |
| nightmare | sway | covered | 12 | 7 | 15.8 | 35.1 | 5 |
| abyss | still | lit | 8 | 6 | 12.2 | 31.7 | 2 |
| abyss | sway | lit | 6 | 6 | 10.6 | 61.3 | 0 |
| abyss | still | covered | 8 | 6 | 12.4 | 22.6 | 2 |
| abyss | sway | covered | 6 | 6 | 13.3 | 45.2 | 0 |

**Hood at every pause: deaths per full run, lantern lit vs covered whenever the player is not moving**
| diff | player | lantern | deaths/run | runs finished | covered s/run |
|---|---|---|---|---|---|
| normal | careful | lit | 0.95 | 20/20 | 0.0 |
| normal | careful | covered | 0.85 | 20/20 | 238.0 |
| normal | hesitant | lit | 27.60 | 14/20 | 0.0 |
| normal | hesitant | covered | 10.25 | 19/20 | 818.7 |
| nightmare | careful | lit | 4.60 | 20/20 | 0.0 |
| nightmare | careful | covered | 2.55 | 20/20 | 344.3 |
| nightmare | hesitant | lit | 53.30 | 0/20 | 0.0 |
| nightmare | hesitant | covered | 40.30 | 0/20 | 1381.2 |

Read: a covered staller is caught as often as a lit one (Normal 14/20 vs 15/20, Nightmare 13/20 vs 14/20, Abyss 12/14 vs 12/14) and
only 0-2 s later at the median: the stall clock and the sound hunt find him. Hooding at every pause takes back part of what sight added
(MASON_SIGHT.md: hesitant Normal 2.95 -> 27.6 deaths with sight; covered at every pause 10.25; careful Nightmare 4.6 -> 2.55): that is
the intended counterplay (cover the light while you stand and read the route), and it still costs the light you read the route by,
which the bots do not model. Nightmare hesitant players still do not finish (40 deaths a run). No counter was tuned.

**With body sight (MASON_BODY_SIGHT_LEASH.md, measured 2026-11-06, same commands):** hooding at every pause takes back less:
Normal hesitant 6.80 lit -> 3.25 covered (2.50 before body sight), Nightmare hesitant 24.95 -> 20.00 (12.45 before), careful 0.00 /
0.05; the covered camper is caught as often as the lit one (covered / lit: Normal 13/20 / 13/20, Nightmare 14/20 / 12/20, Abyss 13/19 /
13/19).

`tests/creature/hood.mjs` keeps a smaller version (stub shaft, 16 stallers per difficulty, Normal + Nightmare) as a pass/fail guard:
covered campers must be caught nearly as often as lit ones, with a median under 60 s.

Knobs, all in `sim/lanternHood.js` `HOOD` (no creature code changed): `lockout`, `coverTime`, `drainHooded`, `lightCut`.

## Switches and debug

- `AT3D.debug.hood(true | false | null)`: force covered / uncovered / back to the input; returns `{on, k, mode, lock, forced, stats}`.
- The input: `InputManager.hood` (held), `intent.hood`, `intent.hoodToggle` (`_edges.hoodToggle`); `INPUT_TUNING.hoodReach` 0.12 m,
  `hoodKeep` 0.18 m, `hoodTapS` 0.3 s.

## Cost

Deterministic, no random calls; no allocation per frame (`update` / `_flip` / `_emit` / `reset` checked statically, the event payloads are
two reused objects; the XR input path reuses one vector). No new textures, samplers, draw calls or materials (the light, the bulb scale
and the glass glow uniform already existed). One more touch button (DOM).

## Files

`src/sim/lanternHood.js`, `src/lanternHoodGlue.js` (built in `game._setupHood()`, stepped by `game._updateHood()` at the top of
`_updateRun`, before the bag), `src/audio/lanternHoodSfx.js`; edits: `game.js` (setup, step, `lit`, `_updateLantern`, the drain, debug),
`input/inputManager.js`, `input/desktopInput.js`, `input/touchInput.js`, `input/touchLogic.js`, `sim/inventory3d.js`, `sim/config3d.js`
(`lanternHood` setting, `UX_LIMITS.lanternHoods`, sanitize), `ui/ui3d.js` (one Comfort row), `render/roachView.js`,
`render/lanternMood.js`. Tests: `tools/abyssal-tether-3d/tests/creature/hood.mjs`, `creature/pacing.mjs` (`opts.hood`, `HOOD=1`).
