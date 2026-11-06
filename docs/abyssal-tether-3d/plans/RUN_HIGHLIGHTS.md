# Run highlights

The death and victory cards show the run's best moments. A death card says what you pulled off before you died, and the
victory card lists the run's highlights and gives a share line that streamers can post.

## Data: `src/sim/runHighlights.js`

`RunHighlights(bus, gate)` is a pure class with no DOM, no three.js and no `Math.random`. game.js `_setupHighlights()`
builds it once at boot on the main bus, with the gate `() => this._inRun()`. `start()` calls `reset()`. A death and a
respawn reset nothing.

| Max | Source | Notes |
| --- | --- | --- |
| `maxCatch` | `rope:catch {speed}` (game.js, THE CATCH) | the fall speed a bite saved |
| `bestChain` | `flow:end {n, reason}` | chains cut by `reason: 'death'` do not count |
| `nearMisses`, `closestMiss` | `creature:strike {hit:false, distance}` | only lunges that stop within `NEAR_MISS_M` (4 m) |
| `biggestLand` | `player:land {impact, lethalRatio}` | only landings the player survives (`lethalRatio < 1`, not dead) |
| `topSpeed` | `sample(vx, vy, vz)` from game.js `_updateViews` | while playing and alive; no allocation; snaps of 200 m/s or more are ignored |
| `escapes` | `chase:lost` (Chase Arc, optional) | each event counts once; its payload is not required |
| `knockers` | `knocker:throw` (optional) | each event counts once |

`player:death` stops landings, near misses and speed from counting. `game:respawn` turns them back on.

## Priority table (`HIGHLIGHT_TABLE`)

`best()` returns the first row whose value reaches `best`. That is the death card's single line. `all()` lists every row
whose value reaches `show`, in table order, for the victory block.

| Line | best | show |
| --- | --- | --- |
| Biggest catch: 21 m/s | 12 | 8 |
| Chain x7 | 5 | 3 |
| Lost it once / twice / N times | 1 | 1 |
| 2 near misses | 2 | 1 |
| Walked off a 14 m/s landing | 12 | 9 |
| Top speed 24 m/s | 18 | 12 |
| 3 knockers thrown | 3 | 1 |
| Chain x2 (floor) | 2 | never |
| Top speed 3 m/s (floor) | 1 | never |

The floor rows make sure a short run still gets a death line.

## Share line

`shareLine({chapter, label, time, deaths, splits})` builds:

    THE LANTERN · Ch I · Nightmare · 11:42.3 · 3 deaths · Chain x9 · ◆◆◇

- The time is m:ss.d, or h:mm:ss.d after an hour, in ASCII digits with no locale formatting.
- The highlight is `best()`.
- The run's whole section splits get one glyph each: gold ◆, silver ◈, brass ◇, no medal ·. The medal ids come from
  `sim/splits3d.js` `SPLIT_MEDALS`.
- A segment with no data is left out.

## UI (`ui/ui3d.js`, the death and victory functions only)

- `_fillDeath` adds ` · <best>` to the `deathStats` line.
- `_fillVictory` → `_fillVictoryHighlights`: the first fill lazily builds a Highlights list, the share line (selectable)
  and a "Copy result" button. The button uses `navigator.clipboard.writeText` inside try/catch, falls back to "Select
  the line to copy" and is hidden in XR.
- The VR `_paintDeath` gets one more 28 px amber row. The buttons move down 40 px.
- The VR `_paintVictory` gets one row under the stat cells: up to three highlights, fitted to 30 to 28 px and ellipsized.
  The splits, teaser and buttons move down 32 px and get slightly shorter, so everything stays inside the 1024 × 768
  panel.
- Both rows are drawn on the existing canvas panel, so there are no new draw calls or textures.

Debug: `AT3D.debug.highlights()` returns the maxima, `best` and `all`. Test: `tools/abyssal-tether-3d/tests/ux/highlights.mjs`.
