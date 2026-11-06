# PUZZLE FOCUS: a glance and a line at every puzzle

> The owner: *"Also during every puzzle I need the camera to be focused there with a dialogue from player or from mic, suggesting the
> player to check it out."* When the player reaches a puzzle (a seal's fixture, or a place worth a look), the game guides their attention
> to it: the view is drawn toward it for a moment (desktop / touch only) and someone says one short line about it: Elias thinking aloud in
> the suit, Vesper (the suit AI), or the uplink (Tick reading the suit's scanner, Odessa, Maren for the lore and the carved words).
> Settings › Rope › **Puzzle focus**: Glance (auto, the default) / Cues / Off. `?focus=off|cues` overrides it (the e2e and the bots pass
> `focus=off`).

## 1. How it works

| Part | File | What it does |
|---|---|---|
| The lines | `src/data/puzzle-focus-text.js` | Pure data: per puzzle TYPE and STEP (first sight / nudge / hint escalation) 1-2 variants with a speaker, the text and the actor's direction. 81 lines. |
| The trigger | `src/sim/puzzleFocus.js` | Pure: the puzzle list per section (from Objectives3D + the level), when a step fires, the ratchet, the cooldown, which variant (deterministic, on the signal arc). |
| The camera beat | `src/sim/focusBeat.js` | Pure state machine IDLE -> TURN -> HOLD -> RELEASE: a look delta per frame (yaw + pitch, never roll), cancelled by any look input, never in a headset. |
| The glue | `src/puzzleFocusGlue.js` | Per frame (game.js `_updateViews`): the safety gates, the line to the radio (`CommsDirector.focus`), the beat through `Game._setLook`, the glow, the bus events. |
| The radio | `src/sim/comms3d.js` | `CommsDirector.focus(line)`: a new trigger kind, priority `FOCUS_PRIO` 1.5 (above the flavour lines, below the story and the beats), short ttl (7 s: stale lines are dropped, never played late), once per run. |
| The ping | `src/audio/focusPing.js` | A designed SFX recipe `focus.ping` (three layers: a tick-tick, a glass partial, a breath of air; 'hash' variation by position, no Math.random) and its route `focus:ping`, registered through audio3d.js `registerSfx` / `registerSfxRoute`. |
| The glow | `src/render/objectiveHintView.js` | A second instance of the 20 s hint's glow (the same visual language), one target, while a beat runs. |
| The voices | `assets/audio/voice/<speaker>/pf-*.ogg` | Kokoro-82M fp32 placeholders (status `focus` in `voice/lines.csv`, performances in `voice/performance.json`), human takes override them as for every line (VO_SCRIPT.md §4). |

### Steps (each at most once per puzzle per run)

- **first**: the puzzle comes into view: within its type's range (below) with a clear line of sight (`level.segmentBlocked` from the eye,
  0.9 m clearance at the fixture, at most every 0.25 s and for the nearest candidate only), or within 6 m of it whatever is in between (the
  S1 bell hangs under the grating). Watched: the current section and the next one down.
- **nudge**: 40 s after the first beat, the puzzle still pending and the player still in its section (objective types only).
- **hint**: the existing 20 s highlight (`sim/objectiveHint.js`) has just come on for this section's objective: the escalation line names
  the mark (objective types only; it waits for the cooldown while the highlight stays on).

### Rules

- A global **cooldown of 25 s** between two beats; nothing while a beat runs, while a priority-3 line (the opening, a story beat) is on air,
  while not playing (menu, pause, death, the restore, the victory, the intro / any cutscene state: only `game.state === 'playing'`), and
  never while unsafe (below).
- **The glance ratchet**: the view turns at most once per puzzle per run; again only when the puzzle is still pending and 120 s have passed
  since its last glance. A death keeps everything (nothing is reset on `player:death`); a new run (`game:start` / `game:restart`) resets.
  Nothing is saved.
- **Safety** (no pan, and no new beat): falling faster than 8 m/s, swinging faster than 7 m/s on a rope, a climb transition (mantling, the
  hop lock), THE CATCH's hit-stop, a creature attack wind-up / burst / a Dresser measure / a skitterling lunge (the radio's own danger
  test), an Usher coiling or whipping (Chapter II), dead / restoring / victory / not playing.
- **Occluded and out of reach** (farther than 30 m, the rope's reach, and no line of sight): the beat has the line and the cues, never a
  glance.
- **Already looking** (within 12 degrees): no pan, just the line and the cues.

### The camera (desktop / touch)

TURN 0.8 s (smoothstep of the shortest yaw arc across ±π and of the pitch, clamped to ±1.2 rad, inside the desktop look limit of 1.48),
HOLD max(1.5 s, the line's hold, ≤ 4 s) following the fixture (damped; a moving ring stays framed), RELEASE 0.35 s (nothing driven, the
glow fades). No snap back: the player keeps the new look. **Any look input cancels it at once**: the beat compares the look each frame
with the one it set last frame; any difference (mouse, arrow keys, touch drag, gyro, a snap turn, anything else that turns the view) stops
the pan for good, the line and the cues carry on. Applied through `Game._setLook(yaw, pitch)` (the rig's yaw, the camera's pitch): the
same API the respawn facing and the XR exit use. Never roll.

### The headset (VR comfort)

**The view is never turned and the rig never moves.** `FocusBeat` forces `pan` off when `xr` and never outputs a look delta (tested for
every frame of a beat, and for a headset put on mid-pan). Instead the gaze guide:

- the fixture glows (the 20 s hint's quad: constant angular size, additive, through walls; reduced effects: no pulse);
- `focus:look` { x, y, z, t, id, type, step } on the bus and `game.focusBeat.lookTarget` { x, y, z, on } for the lantern's lean / brighten
  toward it (the lantern mood work owns renderer3d.js: this module only emits the event and exposes the target);
- `focus:ping` { x, y, z }: a spatial tick-tick AT the fixture (HRTF, distance, air absorption, occlusion: the SFX engine's world sounds);
- the line as usual (the subtitle panel is the radio's head-locked one; the radio voice at the earpiece, Elias / Vesper dry in the suit).

**Cues** mode (the setting, `?focus=cues`, or Reduced effects) is exactly the headset behaviour on every platform.

### Lines, voices and the signal arc

The variant is a deterministic hash of (seed, puzzle, step, run): a replay hears the same line, another run may hear the other. An uplink
voice (Tick, Odessa, Maren) needs the radio's signal ≥ 0.4 (Chapter I S1-S6; Lamphold until the Snuffing) and is weighted by the signal
(46 % of the picks at five bars, 29 % at 0.45 in the bell's case): the deeper, the likelier Elias or Vesper. Every step of every type has an
Elias or Vesper variant; the Hollow Nave (S7) speaks only locally. The rest beats of Lamphold (II-4 the Waking Hall, II-13 the Soot Throat)
stay quiet ("no chatter", chapter2-text.js decision 4): their beats are cues only. Every line is within the radio's limits (84 characters,
2 rows of 42, 11 words, the charset, Vesper ≤ 5 words); voices keep their COMMS.md / VO_DIRECTION.md character (Elias muttering, Tick quick
and pleased with his scanner, Odessa warm and patient, Maren dry and exact, Vesper a readout).

## 2. Every puzzle type, both chapters

Chapter I's S8 (the Last Throat) has no puzzle: it is the escape to the grate (a glance there would fight the run). Chapter II's II-13 hook
is a scripted lowering, not a puzzle.

| Type | Where | Fixture position (source) | First sight (m) | First sight | Nudge (40 s later) | Hint escalation (on the 20 s highlight) |
|---|---|---|---|---|---|---|
| **bell** | I · S1 The Threshold | fixture bell-s1 (x, y, z) | 16 | ELIAS: *A bell. Why is there a bell down here?*<br>TICK: *Wren, your scanner's pinging brass under you. Big. Hollow.* | ODESSA: *That bell's hung to be struck, Elias. Swing into it.*<br>ELIAS: *Hung to be struck. So strike it. Swing hard.* | TICK: *Marked the bell for you, Wren. Swing into it hard.*<br>VESPER: *Bell marked. Strike it.* |
| **haul** | I · S2 The Long Swing | fixture cw-s2: its ring s2-cw | 18 | MAREN: *A counterweight. Lanternwright work. That chain lowers something.*<br>ELIAS: *A counterweight on a chain. That's my way down.* | TICK: *Wren, the counterweight. Hook it and haul. It ratchets.*<br>ELIAS: *Hook the weight. Haul. One notch at a time.* | ODESSA: *The counterweight's marked, Elias. Hook it and haul.*<br>VESPER: *Counterweight marked. Haul it.* |
| **winch** | I · S3 Broken Gallery | fixture winch-s3: its ring s3-winch on the turning gear (moves) | 22 | TICK: *Something's moving on your scanner, Wren. A gear. Still turning.*<br>ELIAS: *That gear's still turning. There's a ring on it.* | MAREN: *Their gears carried people, Elias. Let it carry you.*<br>ELIAS: *Catch the ring as it comes round. Let it carry me.* | TICK: *Marked the gear ring. Hook it when it's out, Wren.*<br>VESPER: *Gear ring marked. Time it.* |
| **lamp** | I · S4 The Listening Vault | fixtures lamp-s4a/b/c (x, y, z): the nearest one not yet lit | 14 | MAREN: *Cold lamps. They lit them to pass. Hold your light close.*<br>ELIAS: *A dead lamp. Wick's still there. My lantern, then.* | ODESSA: *Three cold lamps, Elias. Your lantern to each wick.*<br>ELIAS: *Still dark ones. Lantern to the wick. Hold it there.* | TICK: *Marked the dark wicks, Wren. Hold your lantern there.*<br>VESPER: *Cold wicks marked.* |
| **rest** (a place) | I · S4, S6: the Masons' rests (nooks) | level nooks (box centre) | 10 | MAREN: *A Masons' rest. It cannot follow you in. Remember it.*<br>ELIAS: *Lamp-lit corner. Carved glyphs. Somewhere to hide.* | — | — |
| **breach** | I · S5 The Gullet Stair | fixture key-s5: the keystone solid (centre) | 14 | ELIAS: *That stone's holding the grating up. A keystone.*<br>TICK: *Scanner says one stone's carrying the whole grate. Huh.* | MAREN: *Let it knock, they wrote. Its blows break stone.*<br>ELIAS: *Hide in the niche. Let it hit the stone. Or haul.* | TICK: *Keystone marked. Hide and let it knock, or haul the ring.*<br>VESPER: *Keystone marked. Loud option: haul.* |
| **lure** (a place) | I · S5: the lure niche behind the keystone | level nook nook-s5 (box centre) | 8 | MAREN: *That niche. 'Let it knock. Do not knock back.' Get in.*<br>ELIAS: *A niche behind the keystone. Small enough to hide in.* | — | — |
| **fork** | I · S6 The Two Descents | fixtures fx-s6-safe / fx-s6-risk: their rings (the nearer pending) | 22 | MAREN: *Two ways down, Elias. The slow stair or the quick rings.*<br>ELIAS: *Two ways down. Stairs, or those rings. Choose.* | ELIAS: *Pick a way. Hook the last ring on either line.*<br>VESPER: *Two routes. Either suffices.* | VESPER: *Route rings marked. Hook one.*<br>TICK: *Marked both last rings, Wren. Either one opens it.* |
| **survive** | I · S7 The Hollow Nave | objective obj-s7: its seal, the iris (centre of its top) | 40 | ELIAS: *The iris. It won't open while I stand on the landing.*<br>VESPER: *Iris sealed. Hang below.* | ELIAS: *Off the landing. Hang in the nave. Hold on.*<br>VESPER: *Landing pauses it. Descend.* | VESPER: *Iris marked. Keep hanging.*<br>ELIAS: *Hang on, Elias. It opens for the ones who hang.* |
| **swing** (a place) | II · II-1 The Lowering, II-3 The Chandeliers: the swinging rings | anchors c2-1-ring0, c2-3-ring0 (pendulum movers: moves) | 26 | TICK: *That ring's swinging, Wren. Catch it on the way in.*<br>ELIAS: *A ring on a chain, swinging. Catch it as it comes.* | — | — |
| **lift** (a place) | II · II-2 The Street of Doors: the counterweight lift | anchor c2-2-lift-ring (a lift mover: moves) | 20 | TICK: *Lift on the wall, Wren. Ring on top. Free ride.*<br>ELIAS: *A lift on the wall. Counterweighted. Still running.* | — | — |
| **knocker** | II · II-2 The Street of Doors | fixtures door-c2-2-0 / -1: their knocker rings | 12 | MAREN: *A knocker. 'Knock, and be known.' Hook it, Elias.*<br>ELIAS: *A door with a knocker. Somebody's name behind it.* | MAREN: *Knock first, Elias. Their names are behind the doors.*<br>ELIAS: *Hook the knocker. Knock. Be known.* | TICK: *Marked the knocker, Wren. Hook it, that's a knock.*<br>VESPER: *Knocker marked. Hook it.* |
| **name** (a place) | II · II-2, II-3, II-9: the Names (II-4 cues only) (cues only in c2-4, c2-13) | c2.names: the lit slab of each Name | 12 | MAREN: *A name, carved and lit. Read it to me, Elias.*<br>ELIAS: *Someone's name, lit like a grave. Go and read it.* | — | — |
| **peal** | II · II-9 The Tolling Gallery | fixtures bell-c2-9-0..7 (x, y, z): the nearest unrung | 26 | MAREN: *Ring the morning, they wrote. Five bells, Elias. Then listen.*<br>ELIAS: *Bells. A whole row of them. Swing into them?* | TICK: *That's five bells to open the floor, Wren. Swing through.*<br>ELIAS: *Five bells. Swing from the beam. One after another.* | TICK: *Marked the bells you haven't rung. Swing through them.*<br>VESPER: *Unrung bells marked.* |
| **clapper** | II · II-12 The Snuffing (the Well): the clapper rings | fixtures clap-c2-12-W / -N: their haul rings | 16 | ELIAS: *A clapper ring on the rim. Haul it, a bell speaks.*<br>MAREN: *Clapper rings. Haul one and a bell speaks over there.* | ELIAS: *Put the bell where I'm not. Haul the clapper.*<br>VESPER: *Clapper ring. Haul to toll.* | VESPER: *Clapper marked. Haul it.*<br>ELIAS: *There. The clapper. Haul it and get clear.* |
| **pawl** | II · II-12 The Snuffing: the gate pawl | fixture bell-c2-12-pawl (x, y, z) | 18 | ELIAS: *The gate's pawl. Hit it hard enough and it breaks.*<br>MAREN: *That pawl holds the gate. Iron breaks to a blow.* | ELIAS: *Swing into the pawl. Faster. It wants a real blow.*<br>VESPER: *Pawl intact. Strike harder.* | VESPER: *Pawl marked. Strike it.*<br>ELIAS: *The pawl. Full swing, Elias. Break it.* |
| **lever** | II · II-12 The Snuffing (the Lift tower): the cage lever | fixture lever-c2-12: its ring | 12 | ELIAS: *A lever on the landing. The cage goes down on it.*<br>VESPER: *Cage lever. Haul once.* | ELIAS: *Haul the lever. Ride the cage down. Go.* | VESPER: *Lever marked. Haul it.*<br>ELIAS: *The lever. Now, Elias. Haul it.* |

Objective types map from the level data (`sim/puzzleFocus.js puzzleTypeOf`): Chapter I by the fixture's verb (hook = the S6 fork), Chapter
II by the fixture's id (`door-c2-2-*` knocker, `bell-c2-9-*` peal, `clap-c2-12-*` clapper, `bell-c2-12-pawl`, `lever-c2-12`). One puzzle
per objective (a multi-fixture objective, the lamps, the peal, the fork, points at its nearest pending fixture, live: the winch ring and
the swinging rings move). The places: the Masons' rests and the lure niche (`level.nooks`, the box centre; the lure only while its
keystone stands), the Names (`c2.names`, until found), the swinging rings `c2-1-ring0` / `c2-3-ring0` and the lift ring `c2-2-lift-ring`.

## 3. Hooks (for the merge)

| File | Function / place | Change |
|---|---|---|
| `src/game.js` | imports | `import { PuzzleFocusGlue } from './puzzleFocusGlue.js'` |
| `src/game.js` | constructor (beside `objectiveHint`) | `this.puzzleFocus = null; this.focusBeat = null;` |
| `src/game.js` | `_bootMinimal` (after `this.bus = new EventBus()`) | `this._setupPuzzleFocus();` |
| `src/game.js` | new `_setupPuzzleFocus()` (before `_updateObjectiveHint`) | builds the glue, `focusBeat` = its beat |
| `src/game.js` | `_updateViews` (after `_updateObjectiveHint`) | `this.puzzleFocus.update(dt)` in a try |
| `src/game.js` | `debugApi()` | `focus: { state, puzzles, ready }` (before `comms`) |
| `src/sim/comms3d.js` | `CommsDirector.focus(line)`, `FOCUS_PRIO` | the new trigger kind |
| `src/sim/config3d.js` | `SETTINGS_DEFAULTS.puzzleFocus = 'auto'`, `sanitizeUxSettings` | the setting |
| `src/ui/ui3d.js` | `SETTINGS_SCHEMA` (Rope tab, after Catch pause) | the Puzzle focus row (Glance / Cues / Off) |
| `tools/.../e2e/e2e.cjs`, `free-attach.cjs` | the page query | `&focus=off` |
| `tools/.../voice/export-lines.mjs`, `build_voices.py` | status `focus` | the lines exported and voiced |

## 4. Tests

- `tests/ux/focus-beat.mjs`: the state machine timings, smoothstep, the shortest arc across ±π (and an unwrapped rig yaw), the pitch clamp,
  cancel on yaw / pitch input and on an unsafe frame, no pan when looking, the headset never gets a look delta, the trigger (range, line of
  sight, 6 m, the neighbour section, busy / not playing, once per step, the cooldown, the glance ratchet, a new run, done objectives, quiet
  sections, Names found), the variants (deterministic, the signal arc), the radio (`focus` once per run, below a story line, never
  overlapping, stale in danger), the setting and `?focus=`, every objective of both chapters' real data mapped, no allocation per frame.
- `tests/ux/puzzle-focus-text.mjs`: the limits, the charset, the speakers, ids, every type and step, local variants, directions, the export.
- `tests/comms/voice.mjs`: the focus clips (made from the current text), the manifest budget (48 KB).
- `tests/ux/medals.mjs`: the VR Rope page with the new row still fits the panel.
- Browser: `flock /tmp/at3d-browser.lock node tools/abyssal-tether-3d/release/test-puzzle-focus.mjs [--out DIR]` (S1 bell behind the
  player: the view turns to it, a line, the events, the glow; S2 counterweight: mouse input mid-turn cancels it; `?focus=cues`: never turns).

## 5. Not verified

Nothing has run on a headset: the glow + ping as a gaze guide (is it enough to find a fixture behind you?), the comfort of the head-locked
line during it, and the lantern lean (owned by the lantern mood work; it has the event and the target). Nobody has listened to the 81 new
AI placeholder clips by ear (measured only: duration, loudness, peak, word alignment). The desktop glance's feel (0.8 s / 1.5 s) was
checked in the software renderer only, at stepped frames.
