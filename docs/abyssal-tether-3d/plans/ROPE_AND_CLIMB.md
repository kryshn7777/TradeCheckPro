# Rope pull, launcher recharge, rope climbing, free climbing

Four changes to how the rope and the hands work, from play feedback:

> "when the user shoots the rope and pulls his arm back, the rope extends, but I need him to go forward, like the rope is pulling him"
> "you cannot continuously shoot the rope and then grapple it ... some sort of cooldown ... shown on your wrist"
> "shoot rope with one hand and then grab that rope and then try to go up ... climbing with the own rope"
> "the user can climb freely at any point ... grab any surface he wants, make sure all surfaces have collision"

## 1. Hand pull (VR): drawing a hand back reels the line in

`sim/ropePull.js`, `Game._prepareRopePull`, `Physics3D.step`.

With a line out, the hand's distance behind the body along the line is `s = (hand - body) . n` (n = unit vector anchor -> body). Its smoothed
rate beyond a deadzone, times a gain, is a reel speed (`intent.hands[h].pull`, m/s) that the winch (`Rope3D.reel`) applies: the body is
pulled toward the anchor by the stroke. Pushing the hand forward again pays no line out (a ratchet: pull, reset, pull). Numbers in
`CONFIG.rope.handPull` (deadzone 0.35 m/s, gain 1.5, cap 12 m/s, smoothing 0.06 s). A haul ring ignores it (hauling never moves you), the
grip yank (17 m/s) still wins over it, and a hand that is gripping a climb hold does not pull.

## 2. Launcher recharge, shown on the wrist

`TetherSystem.cooldownTime / charge`, `healthFx._drawRope`, `settings.ropeCooldown` (default 1.5 s, 0 = none; Settings > Rope).

Each hand has its own launcher. A trigger pull that fires (a hit or a whiff) starts the recharge; a second pull during it is refused
(`rope:dry`, the bar flashes red). A pull in the last quarter second is queued while the trigger stays held. The line itself stays out for as
long as the trigger is held; the recharge runs meanwhile, so holding a line costs nothing. A dead player starts charged. The bars (L / R)
are drawn into the wrist ECG canvas under the trace, so the VR wrist screen and the desktop HUD copy both show them at no extra draw call.

Only the player's trigger (`handleInput`) is gated: `fire()` / `attach()` (the debug API, the tests), and the verification sim (its settings
carry `ropeCooldown: 0`: the bots solve the level, not the recharge) are not.

## 3. Climbing your own rope

`Climb3D._ropeNear`, `Climb3D.ropeHeld`, `Physics3D.step`.

With a line out on one hand, the other hand (which has no line of its own: its grip would be the yank) can grip it. The hold is the nearest
point of the segment from the anchor to the hand that holds the launcher, within `CONFIG.climb.ropeReach` (0.3 m). Then the existing
hand-delta locomotion does the rest: draw the hand down the line and the body goes up it. While a hand grips the line it takes in the slack
behind the climber (`rope.length = distance to the anchor`), so it is taut when you let go: you stay where you climbed to, and the stick
(reel out) lets line out to come down. The grip costs `ropeMul` (0.5) of the normal hanging drain (the harness carries you), lets go when
the line comes off, and never takes a haul ring's line or the hand's own line.

## 4. Free climbing: any solid surface is a hold

`Climb3D._surfaceNear`, `CONFIG.climb.surface / surfaceMul`.

In VR, a palm within `reachVR` (0.24 m) of any active solid's surface (floors, walls, ledges, pillars, slabs, the kit dressing that
collides) hovers and grabs; the hand snaps onto the face. The hold is the lowest grade (`surfaceMul` 1.8 x the hanging drain; authored holds 1,
edges 1.5). A hand with a line out keeps its grip for the yank, and a palm inside a solid (a clipped hand) or a fallen ledge is no hold.
`CONFIG.climb.surface = false` brings back the old rule (authored zones and exposed edges only).

### Limits (honest)

* Desktop cling is unchanged (authored zones and edges): surface holds are VR only.
* "All surfaces have collision" is true of the level's solids and of the kit dressing that has boxes. The colossal cog wheels (placed at
  arbitrary angles by the dressing planner, `sim/decorColliders.js` only takes axis-aligned frames) and the purely visual silhouettes do
  not collide: they can be flown through, and a rope or a hand does not catch on them. Colliders for them need oriented-box collision.
* Not measured on a headset: the pull gain, the deadzone and the recharge time are first guesses for tuning.

Tests: `tests/physics/ropehand.mjs` (hand pull, recharge), `tests/climb/freeclimb.mjs` (surface and rope holds).
