# Holsters: the rope guns on the hips, bare hands for walking

> "Keep the rope guns in holsters on each side and walk bare-handed. The current speed must be the same for bare-handed walking, but for rope-gun walking the speed must be reduced by 20 percent."

(The request said "bare-footed"; read as bare-handed, i.e. guns holstered. If something else was meant, the speed rule is one constant: `HOLSTER.walkMul` in `sim/holster3d.js`.)

## The rule

| State | Ground walk |
|---|---|
| Both guns holstered (the start of every run, and after every respawn) | exactly the old speed (`runMaxSpeed` 5.5 m/s) |
| Either gun out (drawn, or still on its way to / from the hip) | **0.8 x** that (4.4 m/s) |

Only the **ground run** is slowed (`Player3D.walkMul`, read in the grounded branch of `Physics3D.step`). The air, the swing, the reel, the pump, the jump and the adrenaline multiplier are untouched, so swinging feels as before. The verify harness never sets `walkMul`, so the sim baseline is unchanged (3167 values identical).

## How the guns come and go

- **Draw:** a trigger press (mouse button, VR trigger, touch ROPE button) on a holstered hand draws that hand's gun (0.14 s from the hip to the hand). The press that draws is held back and fired the moment the gun is out, if the trigger is still held: no shot is lost, a quick tap that is released first just draws. Hands draw independently.
- **Stow:** **H** (desktop) or **right stick click** (VR) stows both when any gun is out (and draws both otherwise). A gun that is out, with nothing on its line and the player standing on the ground, goes back by itself after **3.5 s**; it is never put away in the air, with a line out or in flight, or with the trigger held.
- **Bare hands:** while stowed the hand is free (the grip still climbs and grabs; the aim laser, reticle and wall dot are hidden). A death or respawn puts both away.
- `?holster=off` keeps both guns in the hands at the old speed (for the bots, the e2e runs and captures).

## What it looks like

The launcher rig, its muzzle and its gauge glass hang from a pivot under each arm: identity = in the hand (the old look); stowed, the pivot rides on the hip (0.27 m to the side, 0.64 m under the eyes, barrel down, sights forward, a little outward) with an eased draw / stow path. Two leather sleeves (one instanced draw call, frustum-culled: the hips are out of view unless the player looks down, so a run pays nothing for them most of the time) stay on the hips whether or not the gun is in them. A short leather-and-click sound marks each draw and stow.

## Files

`sim/holster3d.js` (state, the press filter, auto-stow) · `sim/physics3d.js` (`walkMul`, the ground run) · `game.js` (`_updateHolster`, the intent, `?holster=off`, reset on respawn) · `input/` (`holsterPressed`: H, right stick click) · `render/handsView.js` (`_buildHolsters`, `_updateHolsters`, laser gating) · `audio/audio3d.js` (`_sfxHolster`) · `ui/ui3d.js` (controls pages) · test `tests/bag/holster.mjs`.

## Not done / honest limits

- Not run on a headset: the hip position (0.27 m / 0.64 m) assumes a standing player; a seated player's holsters sit lower relative to the hands. The right-stick click may be hit by accident while turning; if it is, move it to a hip-grip gesture (the bag already owns the right hip).
- The e2e bots were written for guns always in hand: run with `?holster=off`, or expect their first shot to take 0.14 s longer.
- The holster sleeves are plain boxes in one leather material; a modelled holster (GLB) would be a Blender job.
