# HIT FEEDBACK: what a hit looks, sounds and feels like

The owner: "when the mason hits us, we won't die immediately, but we will lose like 30% of our health per every hit. The skittlings
cause 10% damage, the mason does 30% damage, and every hit the player camera goes like red and a high pitched sound and then he falls
down for a moment and slowly gets up."

Two owners. **SIM** (another branch): the damage (30 % / 10 %), the cadence, the dodge, the knockdown state machine `sim/knockdown.js`
(`game.knock`), the input lock, the devour at 0 hp. **FEEDBACK** (this plan): everything the player sees, hears and feels. The two meet
only at the fixed contract below; this side never edits `sim/creature3d.js`, `sim/health3d.js`, `sim/physics3d.js` or `sim/knockdown.js`.

## The contract (both sides implement exactly this)

- bus `player:hit` `{ source: 'mason'|'skitter', amount, hp, x, y, z (attacker head), dx, dz (unit, attacker -> player), down }`,
  emitted in addition to `health:damage`.
- `game.knock`: `phase` ('none'|'down'|'rise'), `t`, `dur`, `k` (0 standing .. 1 flat), `moveMul`, `active`; bus `player:down {dur}`,
  `player:rise {dur}`, `player:up {}`. Mason = full knockdown (~1.1 s down + ~2.4 s rise); skitterling = a stumble (`down:false`).
- `game.knock` may be absent (the SIM branch not merged): every consumer treats `null` as standing. `AT3D.debug.hit(source, down = true)`
  emits a synthetic `player:hit` and, only while `game.knock` is missing or idle, drives a LOCAL stand-in knock (inside
  `hitFeedbackGlue.js`, marked) with the contract's timings, emitting `player:down / rise / up` with `local: true`.

## Modules

| file | what |
|---|---|
| `src/render/hitFeedback.js` | PURE curves (Node-tested): the punch envelope, its peak per source / mode, the knock camera (drop + roll, desktop vs VR), the held vignette, the muffle, the stand-in knock stepper |
| `src/hitFeedbackGlue.js` | the glue (`game.hitFeedback`), `PuzzleFocusGlue` pattern: bus listeners, the envelopes on the SIM clock, the camera offsets, haptics, the ECG tick, the debug hit, resets |
| `src/audio/hitFeedbackSfx.js` | designed recipes `hit.ring` (tinnitus), `hit.thump` (impact), `hit.gasp` (the breath getting up), routes `player:hit` / `player:rise`, and `holdHitMuffle(audio, m)` (the smallest public hook on the existing world muffle) |
| `render/healthFx.js` | +1 uniform `uHit` on the EXISTING vignette (same mesh, same draw call) and the inputs `hitFlash` / `hitVig` / `hitDizzy`, the `-30%` tick on the existing ECG canvas |
| `render/bodyView.js` | one knob: `game.hitFeedback.pose` lowers the neck target (the existing IK crouches the body; VR cue) |
| `ui/captions.js` | `[Hit]`, `[High-pitched ringing]` (`hit:ring`), `[Skitterling bite]` |
| `sim/config3d.js`, `ui/ui3d.js` | `hitFeedback: 'full' | 'gentle'` (end of the WP-UX block, `UX_LIMITS.hitFeedbacks`, sanitized), one Access row |
| `game.js` | `_setupHitFeedback()` after `_setupHood()`, `update(dt)` beside the chase update in `_updateViews` (before healthFx reads it), `_applyHitCam()` at the end of `_updateRig`, `AT3D.debug.hit` |

## 1. Red screen (the existing vignette, +0 draw calls)

- **Punch**: one-shot, 80 ms smoothstep attack, 0.7 s quadratic decay (zero at 0.78 s). Peak at the rim 0.58 (Mason), 0.35 x that for a
  skitterling bite. The wash is blood-dark (linear 0.20, 0.008, 0.006): a LUMINANCE DROP plus warmth, so it reads without hue
  (colour-safe). While it runs the legacy `health:damage` flash is consumed (no double flash).
- **Never a strobe**: a new punch can start only 0.5 s after the last one started (<= 2 pulses / s); a hit inside that window only lifts
  the running peak.
- **Held vignette**: while knocked down the rim closes in red-black and the centre hazes, following `knock.k` (eases out over the rise).
  A slow (0.3 Hz, +-0.04 NDC) "dizzy" sway of the rim radius, never with Reduced effects / gentle (no pump).
- Reduced effects or `gentle`: the punch halved, no sway.

## 2. The sound

- `hit.ring` (ui bus: head-locked, NOT behind the world muffle): a sine pair 3.3 kHz + 4.1 kHz with a 3 Hz beating partial and a slow
  0.7 Hz tremolo, 8 ms attack, ~2.5 s decay. k = 1 Mason, 0.55 gentle, 0.3 skitterling (shorter, quieter). (The legacy `_sfxRing` in
  audio3d still rings at ~3.3 kHz on any `health:damage` >= 0.25; the designed pair sits on it.)
- `hit.thump` (player bus, under the muffle): a 90 -> 45 Hz body blow, brown-noise impact, a 55 Hz tail.
- `hit.gasp` on `player:rise`: a strained breath in as he gets up (synthesised noise bands; no recordings).
- Muffle: the world mix (the existing `muffle` lowpass in audio3d, through `holdHitMuffle`) closes to ~1.4 kHz on a Mason hit and opens
  again over the rise. Skitterling: no muffle.
- Hearing safety: every recipe peaks <= -12 dBFS in the offline render at k = 1; the engine's master compressor + limiter + soft clip
  follow; master / SFX volume and mute apply (the engine's buses).

## 3. Fall and get up (driven by `knock.k` / `phase`)

- **Desktop / touch**: the eye drops from 1.62 m to 0.30 m above the feet and rolls up to 10 degrees away from the attacker (the side of
  `dx, dz` in the view; straight on: a fixed side), following `k` (the SIM's fast ease down, hold, slow ease-out rise). The virtual hands
  sink a little (input sockets, put back exactly; never while the free-fall flail owns them). Applied after the rig is placed
  (`_applyHitCam`, after the death / opening cams); the roll is written only while non-zero and zeroed once.
- **VR**: the headset camera is NEVER rotated; at most a smooth vertical rig offset of <= 0.12 m x k, and none with Reduced effects, the
  comfort vignette on, or `gentle`. The cues are the vignette, the whine, the haptics and the body: `pose` lowers the body's neck target
  0.45 m, so the existing pelvis / leg IK crouches the body you see when you look down. Real hands are never moved. Ropes stay drawn.
- Skitterling bite: a 0.45 s stumble (desktop: 0.12 m dip, 2.5 degree roll; VR: nothing but the cues).
- `gentle`: no drop, no roll, no VR offset (pure vignette + sound).
- Everything returns exactly to neutral on `player:up`, death, respawn, restart and menu (tested).

## 4. Haptics

Mason: a hard double pulse in both hands, 1.0 x 60 ms, 50 ms gap, 1.0 x 90 ms (scheduled from the next frame so it replaces the
generic `health:damage` buzz). Skitterling: one 0.55 x 45 ms buzz. Through `game._hapticBoth` (the haptics setting and strength apply).

## 5. Captions / HUD

`player:hit` -> `[Hit]` (Mason) / `[Skitterling bite]` (grouped with the existing bite line), `hit:ring` -> `[High-pitched ringing]`.
A floating `-30%` / `-10%` tick on the ECG canvas (the wrist screen and the desktop HUD copy: no new texture), 1.2 s. The heart rate
already jumps on damage (health3d).

## 6. Setting

`hitFeedback`: 'full' (default) | 'gentle'. Settings > Access > "Hit effects".

## 7. Tests: `tests/ux/hit-feedback.mjs` (registered)

Envelope (peak, attack, decay, one-shot, <= 2 pulses/s, reduced / gentle scaling); the camera curves for a fake knock (neutral at start
and end, roll <= 10 deg, desktop drop to 0.3 m, VR never rolls and <= 0.12 m, gentle none); `game.knock == null` tolerated; the glue
on a fake game (resets on death / respawn / menu, no stuck offsets, the stand-in timings, haptic calls); recipes compile / validate /
peak <= -12 dBFS / decay length, routes registered; captions; settings default + round trip + the UI row; no per-frame allocation
(static + heap sampled); the wiring.

## 8. Budget

+0 draw calls, +0 textures / samplers (one float uniform on the vignette's own unlit ShaderMaterial). Pure functions write into
preallocated objects; no `Math.random`.
