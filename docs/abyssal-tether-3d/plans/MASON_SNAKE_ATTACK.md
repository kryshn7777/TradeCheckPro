# MASON SNAKE ATTACK — visuals + audio (render / audio side)

Owner: "it comes near the player, it sees like a snake, it plans to attack, and then immediately it attacks every 3 to 5 seconds,
and again it stares at the player ... like a snake." + "it slowly comes at normal speed, and then when it is nearby ... it suddenly
comes at a much higher speed and then positions itself to attack."

The SIM agent owns the choreography (sim/creature3d.js: STALK -> DASH -> RISE -> STARE -> LOCK -> STRIKE -> RECOIL -> STARE ...).
This plan is the **look and the sound** of it. Nothing here edits creature3d.js, masonSight.js, health or physics.

## 1. Contract and the adapter (`render/mason/attackPhase.js`, pure)

`AttackPhase.update(creature, player, dt)` gives one phase per frame: `idle | stalk | dash | rise | stare | lock | strike | recoil`,
`t01` (0..1 in the phase), `time` (s in the phase), `dur`, the aim point `aimX/Y/Z`, `locked`, `changed`, `source`.

* **New fields first** (after the SIM merge): `creature.attackPhase`, `attackT01`, `aimX/aimY/aimZ`; the bus `creature:phase
  {phase, t, dur, tx, ty, tz}` adds the duration and the locked point.
* **Derived fallback** (today's sim): `attack.phase` 'windup' = RISE then LOCK (the last `min(0.3 s, 0.45 x windup)` is LOCK, the aim
  frozen on where you stood when it began), 'strike'/'lunge' = STRIKE (t01 over 0.16 s, the aim = the lunge's end point `attack.lx..`),
  'recoil' = RECOIL (0.45 s); state BURST = DASH; an aware state within 12 m = STARE (it holds the coil and stares, also after a hit
  while you get up); an aware state further out = STALK; anything else IDLE.
* **Forced** (`AT3D.debug.masonPhase(phase, u)`): a phase held at u (captures) or, with no u, played at its nominal length;
  `'cycle'` loops the whole choreography (stalk 3 s, dash 2, rise 0.9, stare 1.6, lock 0.3, strike 0.2, recoil 0.5, stare ...).

## 2. Rig capabilities found

* `MasonRigView` (mason_rig.glb): 20 spine bones posed from frames `F` (pos, fwd, up, right x 20, from `computeFrames` +
  `BodyMotion`), per-bone uniform scale `S`, a HeadFit, lead-leg IK, crown aim spring, `Mandibles` (hold override), `Eyes`
  (unlit red slits + halo points), `Maw` (follows the jaw), the emissive pits. 4 + 2 + 2 + 2 + 1 draw calls.
* `CreatureView` (kit fallback) poses its blocks from the same `computeFrames` F.
* So the snake is a **procedural layer over F** (no clips, no new meshes, no textures, no draw calls): `SnakePose.apply(F, S, n)`
  runs after the body motion and before the head fit in both views.

## 3. Poses (`render/mason/snakePose.js`, pure, zero allocation)

The front 7 links (spine 0..6, anchored at spine 7 on the sim body) are rebuilt as a chain with the **same link lengths**:
link j (from the anchor to the head) leaves at pitch `theta_j` off the body's forward toward its up and yaw `psi_j` toward the aim:

| link (anchor -> head) | 1 | 2 | 3 | 4 | 5 | 6 | 7 (head) |
|---|---|---|---|---|---|---|---|
| cobra S pitch (deg) | 22 | 52 | 78 | 84 | 58 | 18 | -18 |

then blended with the sim chain by the **coil** envelope (0 = the sim body exactly). The head frame looks at the smoothed aim point.
If the sim already lifts the head (after the SIM merge it may rear it itself) the curve shrinks by that much (no double rear); if the
coiled head would come within 4.5 m of the aim point the S flattens (never in your face).

| phase | coil (spring) | sway | jaw | eyes | light | other |
|---|---|---|---|---|---|---|
| stalk | 0 | 0 | sim | sim | sim | the existing crawl |
| dash | 0 | 0 | chomp | 1.4 | +0.2 | front blocks LOWERED 0.6 m and DRAWN FORWARD 0.7 m (a low surge), blocks 4 % thinner |
| rise | 0 -> 1 (smooth, w 7) | fades in | 0.55 | 1.2 | 0 | the head tracks the aim (6 /s) |
| stare | 1 | 6 deg yaw, 3 deg weave at 0.75 Hz slowing to 0.45 Hz | 0.6 | 1.3 | 0 | |
| lock (0.25-0.35 s) | 1.06 (pulls back: anticipation) | -> 0 in 0.1 s (STILL) | GAPES 1.25 | FLARE 2.6 in 0.06 s | pulse +0.7 | the aim frozen on the locked point |
| strike (0.15-0.25 s) | -> 0 (w 45) | 0 | SNAPS shut | 2.2 | flare +1.2 | 1.5 frames of squash (pull back 0.25 m, blocks +8 %), then the front EXTENDS 1.8 m along the locked line, blocks -8 % (the smear is the stretch) |
| recoil (0.4-0.6 s) | -> 1 (w 14, zeta 0.42: ~12 % overshoot) | fades in | reopens 0.5 | 1.3 | decays | the stretch decays in 0.2 s, the aim re-acquires (8 /s) |

reducedEffects: sway x 0.35, no squash, the overshoot damped (zeta 0.8), no light flare beyond +0.3. Only the creature moves:
the camera is never touched (VR comfort). Deterministic: the sway is a phase accumulator, no Math.random.

## 4. Light (aux shadow creature mode)

`creatureLightPlan(c, plan)` gets `c.flare` (0..1.2): candela x (1 + 0.6 x flare), within the existing ATTACK boost / range
(11 m) so the aux map budget is unchanged; `Renderer3D._syncCreatureLight` reads `game.masonAttack.lightFlare` and moves the glow
to the coiled head (`pose.headX..`) while coiled. Same one light, same path.

## 5. Sound (`audio/masonAttackSfx.js`, registerSfx / registerSfxRoute)

All world-space at the coiled head (distance, air, occlusion, speed of sound from the engine), bus `creature`, master / SFX
volume by the engine's buses, reducedEffects by the engine's voice tier; levels <= 0.7.

| id | event | design |
|---|---|---|
| `mason.rattle` | `mason:rattle {k}` every 0.34 -> 0.13 s while coiled (k = tension, rising toward LOCK) | a dry stone-on-stone rattle: a burst of 5-9 grit ticks (band 1.4-3.6 kHz), a hollow knock of two stone plates (modal 310 Hz), a breathy hiss band (4.5 kHz) rising with k |
| `mason.lock` | `mason:attack {phase:'lock'}` | THE DODGE DEADLINE: a sharp stone **tick** (a bright modal click 2.2 kHz + a short 1.18 kHz tone) and the hiss cut dead; readable without sight |
| `mason.strike` | `phase:'strike'` | a whip-crack / stone whoosh: a white crack, a pink band sweeping 2.6 kHz -> 380 Hz (Doppler-ish fall), a low body 120 -> 55 Hz |
| `mason.recoil` | `phase:'recoil'` | a heavy settle: a stone scrape band falling, a dull thud, three loose-stone ticks |
| `mason.hit` | `phase:'hit'` (creature:strike hit) | a muffled impact thud: a sub 70 -> 38 Hz, a low-passed brown slam, cloth + body |
| `mason.dash` | `phase:'dash'` | a surge: a stone-scrape rumble rising (brown band 140 -> 520 Hz), then Dopplering down past (900 -> 260 Hz), grit ticks |
| `mason.halt` | the dash ends into rise / stare | the hard decel scrape: a falling scrape band, a skid of ticks, a settling thud |

Captions (ui/captions.js, `mason:attack`): `[STONE RATTLING]` (rise), `[IT LOCKS ON]` (lock), `[LUNGE]` (strike), `[IT SURGES]` (dash).

## 6. Wiring

`masonAttackGlue.js` (game root, like chaseGlue.js): the adapter, the SnakePose envelopes, the bus events above, the light flare,
`view.snake = pose` for the rig and the kit view, the SFX registration once audio exists. game.js: `_setupMasonAttack()` next to
`_setupPuzzleFocus()`, one guarded `update(dt)` in `_updateViews`, and `AT3D.debug.masonPhase(phase, u)`.

## 7. Tests (`tests/render/test-mason-attack.mjs`) and the visual check

Adapter (new fields preferred, derivation, every phase incl. dash, the lock window), pose curves (continuity at the phase
boundaries incl. dash -> rise, bounds, no NaN, link lengths kept, the timers reset on a phase change), sway vs reducedEffects,
recipes valid + routes + captions + level caps, no per-frame allocation (static + heap sampled), determinism. Contact sheet:
`docs/abyssal-tether-3d/plans/img/mason-snake-attack.jpg` (stalk, dash, rise/stare, lock, strike, recoil at 6-10 m, a real level).

## 8. Status (hand-back)

In: everything in §1-§7 except the visual capture. Node: `test-mason-attack.mjs` all PASS (incl. heap-sampled 0 B / frame), the rig /
motion / aux shadow / face / mandibles / sfx / ux / chase tests PASS, the budget harness within budget, lint clean.
NOT verified: the in-browser look (the contact sheet was never captured: the shared browser lock was blocked), so the coil's height
(~6 m), the lead legs reaching down from the reared links and the reading in the dark / in a headset still need a look; the capture
script (forces each phase on a synthetic Mason via `AT3D.debug.creature.place` + `AT3D.debug.masonPhase(phase, u)`) is in the hand-back.
