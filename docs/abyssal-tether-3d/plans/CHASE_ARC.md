# THE CHASE ARC

A Mason chase used to just end: its memory ran out and it went back to listening. Horror needs the release. The chase arc gives every
chase a start (a heartbeat in your ears), a measured middle, and an end you feel: a long shaky breath out, the score dropping away for a
few seconds, and a line that tells you what you just survived.

## Modules

| file | role |
|---|---|
| `src/sim/chaseArc.js` | `ChaseArc(bus)`: pure bookkeeping of one chase at a time, from bus events. Node-safe, no Math.random, no allocation per frame. |
| `src/chaseGlue.js` | `ChaseGlue(game)`: builds the arc on `game.bus`; the heartbeat, the toast, the music duck, the watchdog, the debug hooks. |
| `src/audio/chaseSfx.js` | `registerChaseSfx(audio)`: the designed recipes `chase.pulse` / `chase.exhale` and their routes (SFX_DESIGN.md §6 extension points). |
| `game.js` | `_setupChase()` next to `_setupPuzzleFocus()`, `this.chase.update(dt)` in `_updateViews` (try / `_fault('chase')`), `AT3D.debug.chase`. |
| `tools/abyssal-tether-3d/tests/creature/chase-arc.mjs` | the Node test (registered in `run-tests.mjs`). |

## The arc (sim/chaseArc.js)

States: `idle` -> `pending` (a notice) -> `chasing` (the commit) -> `settle` (sight lost) -> `idle`.

| bus event | what the arc does |
|---|---|
| `creature:notice` {distance} (masonSight.js) | idle -> pending (the chase's clock starts here); in settle: holds the window open for the commit |
| `creature:sight` {on:true} | the commit: -> chasing; the first one of a chase emits **`chase:start {}`**; in settle it is the SAME chase (merged) |
| `creature:sight` {on:false, reason:'lost' \| 'blocked'} | chasing -> settle for `CHASE.merge` = 3 s; the lost moment is recorded |
| `creature:strike` {hit:false} | a near miss (counted in pending / chasing / settle). `skit` payloads (skitterlings) are ignored |
| `creature:strike` {hit:true} | it caught you: the chase ends silently (no release for a catch) |
| `knocker:throw` | a knocker thrown during the chase |
| `player:death` | the chase ends silently; nothing at all until `game:respawn` / a new run |
| `game:start` / `game:restart` / `game:menu` / `game:respawn` / `game:victory` | forget the chase, silently |

`update(dt, nearDist)` runs the arc's clock (the sum of dt; paused = not called), the pending window (`CHASE.pending` = 1.5 s: a notice
that does not commit was a glimpse, no chase), the settle window, and keeps the closest distance. `nearDist` is the Mason's own read-out,
`game.creature.sight.nearDist` (masonSight.js: the nearest of its crown / front blocks to the player, `1e9` when it is out of play;
values >= 1e8 are ignored). The notice / commit / strike distances also count.

When the settle window closes without a re-notice: **`chase:lost {duration, closest, knockers, nearMisses}`**
- `duration` s: from the first notice (or the commit, when the notice was on its 3 s cooldown) to the LAST sight-off of the chase (the
  settle window is not counted);
- `closest` m; `knockers`, `nearMisses` counts.

Merge: a re-notice / re-commit within 3 s of losing it continues the same chase (one start, one lost, the duration runs over both).
Because of the window, the release lands 3 s after masonSight's own memory ran out (4 / 5 / 6 s after the line of sight broke): by then
you are sure.

Never a lost after a death: a death clears the chase and sets `dead` until a respawn / new run, so the Mason's own `creature:sight off
'blocked'` that follows a kill is ignored, and so is a death inside the settle window. Both payloads are reused objects (copy them).

## The glue (chaseGlue.js)

- **Heartbeat**: while chasing, `chase:pulse` {k, d} every `pulseInterval(d)`: 0.9 s at 24 m or more, 0.5 s at 4 m or less (the cap: never
  faster), linear between; `k` = 0 far .. 1 near. `chase:start` plays the first beat itself. In the settle window the beat slows to 1.15 s
  at k 0.3 (it has lost you; you do not know yet). Only while `game.state === 'playing'`, alive, no victory.
- **Release** on `chase:lost`: the toast for 3 s through `game._toast(text, 3)` and the score ducked 4 s through
  `game.audio._music.duck(4)` (`Music3D.duck`, audio/music3d.js), so the exhale lands in a quiet room.
- **Watchdog**: if the arc is chasing but the Mason's `sight` is neither chasing nor noticing (it was reset or left play without a
  sight-off, e.g. a section warp), the arc treats it as a sight-off 'blocked'.
- **No vignette**: the only screen vignette is the low-health one (render/healthFx.js); there is no comfort-safe pulse hook, so none is
  added. The headset camera is never touched.
- Timing note: `_updateViews` runs on real time, so during THE CATCH slow motion the chase clock runs at real time (what the player felt).

### The toast text

`chaseToast(e)`:

```
LOST IT · 14.2 s · closest 3.1 m · 1 knocker
LOST IT · 31.0 s · closest 2.4 m · 2 knockers · 1 near miss
LOST IT · 6.0 s · 3 near misses
```

One decimal (`toFixed`, never locale formatting: `1234.6 s`, no commas), ` · ` separators, `closest` left out when nothing was measured,
`knocker(s)` / `near miss(es)` pluralised and left out at zero.

## The sounds (audio/chaseSfx.js)

Both `rule: 'fixed'` (one designed sound each: the heartbeat must read as the same heart), head-locked, bus `psych`.

| id | routes | design |
|---|---|---|
| `chase.pulse` | `chase:start` (k 0.6), `chase:pulse` (k from the payload) | lub-dub: a 64 -> 41 Hz sine kick with a brown-noise body, the dub 0.22 s later at 56 -> 37 Hz and softer, a low pink band (the blood in the ears) swelling through it. 0.9 s; level 0.30 .. 0.50 with k; prio 1, max 2 voices |
| `chase.exhale` | `chase:lost` (k = 0.3 + duration / 30, capped 1) | a long shaky breath out: a pink band 1150 -> 520 Hz with a 7.5 Hz tremor, a hiss band 2500 -> 1300 Hz with an 11 Hz flutter, a brown-noise chest emptying, a quiet sine falling 98 -> 73 Hz under it. ~5 s; prio 2, one voice |

Registered by the glue once `game.audio` exists (`registerSfx` / `registerSfxRoute`, the focusPing.js pattern); `audio3d.js` is untouched.

## Debug

`AT3D.debug.chase.state()` (the arc: state, elapsed, closest, counts, the last release, stats; pulses / toasts / ducks),
`AT3D.debug.chase.start(dist)` (a chase now, as a commit at `dist` m; the watchdog leaves it alone), `AT3D.debug.chase.lost()` (the
release now, skipping the settle window).

## Budget

No draw calls, no textures, no materials; two recipes in the existing SFX engine (at most 2 + 1 voices). Per frame: a few number updates,
no allocation (the test checks the source of the per-frame paths and samples the heap over 100 000 chasing frames).

## Verification

`node tools/abyssal-tether-3d/tests/creature/chase-arc.mjs`: the scripted stream (duration 14.2 s, closest 3.1 m, 1 knocker, 2 near misses,
the skitterling strike ignored), no lost after a death / in the settle window / after a hit, run / menu / respawn resets, the merge at
2.4 s and 2.95 s (one chase) vs 3.5 s (two), a glimpse, the real Creature3D + MasonSense on the stub shaft (lantern dark -> memory 4 s ->
sight off -> lost exactly 3 s later, closest = the smallest `sight.nearDist`), the heartbeat intervals, the toast strings, the duck, the
watchdog and debug hooks, the recipes and routes, no allocation, the game.js wiring. Not verified in a browser / headset (no capture run).
