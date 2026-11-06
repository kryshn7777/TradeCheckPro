# TUTORIAL v2 and the ASSIST PACK

Two small bundles that let more players finish the descent: six more one-time hints, each shown exactly when it becomes relevant, and
two input assists for players with RSI or who play seated and cannot hold a button down for a minute.

(A third assist, "Mason mercy", was planned and dropped: the owner made Mason hits non-lethal (30 % of max health, a red flash, a whine,
a knockdown), which another work package owns. Nothing of it is in the code.)

## Tutorial v2 (`src/ui/tutorial.js`)

The existing rules hold for every step: at most **twice** per step, at least **25 s** between two tutorial hints, never over a menu or a
level hint, never while dead / in the victory, never in danger, and `settings.tutorialHints = false` silences all of it. Learned steps
are persisted in Storage `tutorial` (they survive restarts). "Danger" is now: moving faster than 12 m/s, a Mason chase on
(`game.chase.arc.chasing`), or a Holdfast hand locked on yours (`game.holdfast.held`).

The new steps are **queued** by the event that makes them relevant and shown at the next quiet moment inside a window
(`WINDOW`: sight 20 s, chain 12 s, rest 8 s; the dark and the fuel wait as long as needed). Order when several wait: sight, rest, jet,
nv, chain.

| step | shown on | learned on | VR / desktop / touch |
|---|---|---|---|
| `sight` | the first `creature:notice` (sim/masonSight.js; skitterlings ignored) | `lantern:hood` {on:true}, or `chase:lost` | "It sees your LIGHT; a hit costs 30% health. Break the line or [Grip] your hand over the lantern." / hold [V] / hold [HOOD] |
| `chain` | `flow:link` {n:2} (sim/flow3d.js) | `flow:end` {n >= 3} | "Fire the next tether before you land: chains feed your lantern." |
| `guide` | hanging on a line > 2 s with `settings.releaseGuide` on (after the reel lesson) | `grapple:release` {reason:'input'} (physics3d.js: the ROPE's let-go, not climb3d's `climb:release`), once shown | "The dotted arc is where you land if you let go." + Trigger / Mouse button / ROPE |
| `rest` | `nook:enter` (sim/objectives3d.js) | the moment it is shown (once ever) | "A Masons' rest: it cannot strike you here. It will not last." |
| `nv` | `nv:dark`: game.js `_updateNightVision`, the first time depth darkness >= 0.18; with the hints off the old toast is shown instead | `nv:on` | Tap [Y] / Press [N] / Tap [NV] |
| `jet` | `jetpack:can` (the first fuel can) | `jetpack:ignite` | Both triggers / J / JUMP in the air |

The guide is only learned by a rope let-go after it has been shown: players let go of ropes all the time, so learning on any let-go would
mean it never shows. A reel hint shown twice and never learned no longer blocks the hints after it in the chain.

## Assist pack

Settings > **Assist** (a new page: the VR Comfort, Access and Rope pages already hold all the rows that fit at >= 28 px). Each row has a
one-line explanation under it in VR and its description on the desktop.

### Grip: Hold | Toggle (`gripMode`, default `hold`)

`input/assistLatch.js` `stepGripToggle`, driven by `input/inputManager.js` (`_updateClimbXR` per hand; the desktop F / touch GRIP cling
as one latch):

- one squeeze grabs; the grab stays while the grip is released; the next squeeze lets go;
- a squeeze with nothing taken within 0.35 s drops by itself (no sticky hand); a hold that ends without us (a slip, a hop, a mantle, the
  stamina, a death) drops the latch so the next squeeze grabs again;
- a squeeze that belongs to the bag (hip zone, open radial, a knocker in the hand), the hood or a menu toggles nothing;
- **the Holdfast**: a locked hand cannot be let go any other way, so the squeeze that lets a latched grip go is the pull: the input says
  `input:gripRelease` {hand}, game.js calls `holdfast.assistPull(hand)` and the hand comes free as an **out-pull** (`holdfast:outpull`
  {assist:true}, no cost, the Holdfast hand lives). In `hold` mode nothing changes (VR: a real arm pull; desktop: let go of F 0.4 s).

### Rope latch (`ropeLatch`, default off)

VR triggers and the desktop mouse / keys: a tap fires and stays attached, the next tap lets go (`_handPhysical`: only a fresh press
counts and it flips the tether). A line that ends on its own (`grapple:miss`, `grapple:break`, a non-input `rope:cancel` /
`grapple:release`) unlatches, so the next tap fires again. A press over a panel is a click and latches nothing. The touch layer keeps
its own `touchRopeMode` latch (the setting is skipped while the touch layer is active). The hood's left stick click (a quick tap toggles,
a held click brakes) is untouched.

## Rules kept

Deterministic (no `Math.random`), no allocation per frame in the update paths (preallocated event payloads, fixed-key state objects), no
new textures, materials or draw calls, the view never moves.

## Tests

- `tools/abyssal-tether-3d/tests/ux/unit.mjs`: the v2 steps (texts exist and fit, each fires on its event, learned on its own event,
  never while dead / in a menu / in a chase / held by a Holdfast / mid-swing, the 25 s gap, the window, twice max, stays learned after a
  restart, the real emitters exist, `Tutorial.update` allocates nothing).
- `tools/abyssal-tether-3d/tests/input/test-assist.mjs`: the state machines, the real InputManager (mock headset + desktop), the REAL
  Holdfast3D freed by a toggle release, the rope latch, settings defaults / sanitize / round trip, the VR Assist page.
