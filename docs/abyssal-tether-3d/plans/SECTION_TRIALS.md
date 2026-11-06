# Section trials

Section trials are a practice loop in the style of Getting Over It or a speedrun: you replay the section that keeps killing
you. A 20-minute Quest session can be four tight attempts at one section.

## What the player sees

- **Records screen.** Every section you have reached has a **Practise** action: a button in the TRIAL column of the VR panel,
  or a button in the last column of the desktop table. A section counts as reached if any of these is true:
  - It is section I.
  - It has a whole-section split or a trial time on that difficulty.
  - Its top is above the deepest point you reached on any timed difficulty (Normal, Nightmare or Abyss). Sandbox unlocks
    nothing here, because a warp reaches everything.
- **The trial.** You start at that section's checkpoint, on the difficulty chosen in the Records tab:
  - The Mason is live.
  - The supplies always use the same seed (`0x7a1a1 + section index`), so every attempt has the same layout.
  - The HUD clock stays at 0:00 until your first input or movement. It stops when you enter the next section. For the last
    section, it stops at the goal.
- **The result card.** The card shows:
  - your time
  - the medal against par
  - the delta against your trial best (`-1.6 vs best`), with a sign and a word, plus `NEW BEST` or `FIRST TIME`
  - `UNTOUCHED` if you took no damage

  After a death, the card says `Fell at 0:07.2` and shows your trial best. A single press starts the next attempt: Enter,
  A, pointing with the trigger, a click, or the **Again** button. R (hold X in VR) does the same. **Records** returns to
  the Records screen. **Menu** quits.

## Modules

| File | Role |
| --- | --- |
| `src/meta/trials.js` | Pure. Holds `trialKey(ch, diff)`, `trialSeed(idx)`, `loadTrials` / `saveTrialBest` (storage injectable; `memoryStorage()` for tests), `trialResult({time, par, prevBest, untouched})`, `newTrial`, and `trialTick` (the clock, no allocation). |
| `src/trialGlue.js` | `TrialGlue(game)`, built lazily by the first `startTrial`. Listens to `health:damage` and clears Untouched. `tick(intent)` arms and runs the clock. `sectionEntered(idx, mode)` and `complete()` end a trial. `died(cause)` marks the attempt as failed. |
| `src/ui/trialCard.js` | Pure. `trialRows` decides which rows are reached and holds the trial bests. `trialCard` builds the card's lines. |
| `src/game.js` | Holds `startTrial(diffKey, idx[, chapter])` and the guards described below. |
| `src/ui/ui3d.js` | Holds the Practise column (in `_fillRecords` and `_paintRecords`) and the trial card. The card is the death screen in trial mode: `_fillTrial` and `_paintTrial`. |
| `src/meta/save.js` | `SaveService._wire` ignores every run event while `game.trial` is set. |

### Storage

Trial bests are stored in `localStorage['abyssalTether3d.v2.trials.ch<N>.<diff>']` as
`{ <section id>: { best, untouched, runs } }`. This key is separate from the profile.

- A worse time never overwrites the best.
- `untouched` is an OR: once you finish a section clean, it stays set.
- All storage errors are swallowed, including quota errors, private mode, missing storage and garbage JSON.

## game.js

`startTrial(diffKey, idx)` is modelled on `continueRun`. It runs these steps in order:

1. `setChapter` for the chapter.
2. Set `this.trial = newTrial(idx, diff, ch)`. This happens before `start()`, so the save service already ignores
   `game:start`.
3. `start(diffKey)`, with `_trialStarting` set so that `start()` keeps the trial.
4. Invalidate the ghost recorder.
5. `_warp(idx)` for sections after I.
6. `splits.partial()`.
7. Set `time = 0` and emit `trial:start`.

`AT3D.debug.trial(i[, diff])` starts a trial. `AT3D.debug.trial()` returns the live trial.

### Guards

These rules hold for as long as `game.trial` is set:

- **Save.** `meta/save.js` ignores every bus event except `settings:changed` and `game:menu`. That covers `runStarted`,
  `checkpointReached`, `runProgress`, `runObjectives`, `sectionSplit`, `deathRecorded`, `completed`, the play-time count and
  the pagehide write. The trial never writes the main run, the Continue slot, the splits, the medals or the totals.
- **v1 stats.** `_bumpStat` and `_recordDepth` return early. `start()` does not change `lastDifficulty`. `_resetBag` uses the
  trial seed and does not change `supplyRuns`.
- **Ghost.** The recorder is invalidated, the victory is intercepted so no ghost is saved, and `_updateGhost` hides the
  ghost.
- **Leaving the trial.** `quitToMenu` and any other `start()` (a new game, Continue, the next chapter) clear `game.trial`.

### The flow

- **End of the section.** `_enterSection(idx > trial.idx, 'progress')` calls `TrialGlue.complete()` and returns before any
  section bookkeeping. No `section:enter`, `checkpoint` or `split` fires. For the last section, `_beginVictory` calls the
  same `complete()`, so no victory, no ghost and no records follow.
- **The card.** `complete()` saves the trial best, stores the result on `game.trial.result`, freezes the run in the `dead`
  state (with no death: `_deathShown`, no death scene), shows `ui.show('death', { trial: true })`, and emits `trial:end`.
- **Next attempt.** Every existing path back into the game re-runs the trial: Enter, A, the trigger, a click, Continue and
  R. They work because `respawn()` and `restart()` route to `startTrial(trial.diff, trial.idx, trial.ch)`. Pause, then
  Restart section, does the same.
- **Death.** `_onPlayerDeath` calls `TrialGlue.died()` instead of the CONTINUITY restore, and no depth or death record is
  written. The death scene plays, then the death panel appears in trial mode.

## The card and the Records panel

The card reuses the death screen's DOM and the VR death canvas. No screen is added to `SCREENS`, and no draw call or
texture is added.

- **Desktop.** The kicker, the message and the stats show the card's lines. The primary button reads **Again**. The
  second button becomes **Records** (`trial-records`) while a trial is set, and goes back to **Restart descent** after
  it.
- **VR.** `_paintTrial` draws the time at 84 px, the medal dot and line at 34 px, the delta line at 28 px, and the
  Again, Records and Menu buttons.
- **The Records panel in VR.** The columns move left to make room for the Practise column: numeral at 46, name at 122
  (175 px), best at 308, medal at 416, next at 556 (236 px), and the Practise button at 804 to 980. All text is at least
  28 px.

## Tests

`tools/abyssal-tether-3d/tests/ux/trials.mjs` is registered in `run-tests.mjs`. It covers:

- the key and the seed
- the result maths and the medals, which match `medalFor`
- a worse time never overwriting the best, and Untouched being an OR
- swallowed storage failures
- the glue's clock, damage handling, end of section and death
- the `game.js` routing and guards, called on the real `Game3D.prototype` with stubs
- **a profile snapshot.** The test builds a `SaveService` and a `SaveStore` on a `MemoryAdapter`, plays a real run first,
  then replays the bus events of two trial attempts: a death, then a finish with a split, a checkpoint, a pause and a
  victory event. The profile and the adapter record are byte-identical before and after, with no extra writes. A control
  run shows that the same events outside a trial do change the profile.
- the UI3D headless checks: Practise buttons appear only on reached rows, the other columns end left of them, a VR hit
  calls `startTrial`, and the trial card renders both when a section is done and after a death. Everything stays inside
  the 1024 × 768 panel at 28 px or more.
