# Night vision goggles and the dark that is made on purpose

> "The levels below are so dark they cannot be seen with normal eyes because the lantern is fading. Night vision goggles are a built-in part of the character's advanced equipment. Make the levels down dark intentionally."

## Fiction

The diver's kit is the Perennial's: tether guns, a bag, a wrist display, a radio that is failing. The visor also carries a low-light mode, an image-intensifier pair that has never been needed on the surface. Below the third section the Ember (the lantern) has less and less to burn: the shaft *takes* the light. The darkness is not a bug of the lamps. It is the design: the Keepers dug a place where a naked eye is not meant to see.

## What the player gets

| | |
|---|---|
| Toggle | Desktop **N** · VR **tap Y** (a hold still recentres) · touch **NV** button |
| Look | One grey-green picture, phosphor grain, a soft tube rim (softer and never closing past ~35 % light in a headset), a warm-up bloom, a five-segment cell gauge under the picture |
| Cost | A cell: about **2 minutes** of use, trickling back in about **3 minutes** while the goggles are off. Below 20 % the picture stutters (bounded, dips to ~55 %, never a strobe) and a toast warns. At zero they drop and refuse to start until 12 % is back |
| Sound | A thin electronic whine climbing as the tubes warm up, a quicker one down; captioned as `[Goggles whine up/down]` |
| Hint | The first time the depth darkness passes 0.18 (between the third and fourth section) a toast says how to switch them on |

They are for scouting a stretch (find the trigger, see the ledge), not for wearing all the way down: the player decides when to spend the cell and when to climb by the dim lantern.

## The dark, on purpose (`sim/nightVision3d.js`)

`DEPTH_DARK` is added to the difficulty's darkness by `foldDarkness(base, depth) = 1 - (1 - base)(1 - depth)` (neither can lighten the other, bounded at 1):

| Section | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 |
|---|---|---|---|---|---|---|---|---|
| depth darkness | 0 | .05 | .15 | .28 | .42 | .56 | .68 | .80 |
| lantern strength and reach | 1 | 1 | .88 | .74 | .60 | .47 | .36 | .26 |
| Normal (base .3) folded | .30 | .34 | .41 | .50 | .59 | .69 | .78 | .86 |

Normal at the bottom (.86) is as dark as the Abyss difficulty is at the top (.85); Nightmare and Abyss go darker still. The menu's drifting background is not darkened. `?deepdark=0..1` scales the depth part (0 = the old levels), for testing and for a comfort setting later.

The renderer reads the section blend by height, so the darkness eases in across a section boundary with the theme instead of popping.

## How the picture is made (no post-processing pass)

1. **The scene is lifted** (cheap uniforms, no shader recompile): while the tubes warm up (`nv.k` 0..1) the darkness comes off (`dark *= 1 - 0.92 k`), the ambient and key rise (x3 and x2.3), the baked-light exposure (+80 %) and floor (+0.03) rise, the haze goes pale green.
2. **A multiply triangle** keeps almost only the green channel through a rounded tube mask. **An additive triangle** adds the phosphor floor, grain, warm-up bloom, a slow scan band and the cell gauge. Both are camera-child clip-space triangles (zero parallax in stereo), no depth test, `renderOrder` 860 / 861, below the red health vignette (880) so a hit still shows over the green.
3. Both programs are compiled at load (the meshes exist visible at construction, like the health vignette), so the first toggle never hitches on Quest.

**Cost:** +2 draw calls and two full-view fragment passes of trivial shaders, only while the goggles are on or spooling; 0 otherwise. Reduced effects: no grain animation, no bloom, no band.

## Files

`sim/nightVision3d.js` (state, cell, depth tables) · `render/nightVisionView.js` (the picture) · `render/renderer3d.js` (depth + goggle lift, `depthF`) · `render/lighting.js` (`setNightVision`) · `game.js` (`_updateNightVision`, lantern fade in `_updateLantern`, views, toasts) · `input/` (`nvPressed`: N, Y tap, touch NV) · `audio/audio3d.js` + `ui/captions.js` (the whine) · `ui/ui3d.js` (controls pages) · test `tests/bag/nightvision.mjs`.

## Not done / honest limits

- Not run on a headset. The VR tube rim, the stereo comfort of the grain and the Y-tap-versus-hold feel need a pair of eyes.
- No bag item recharges the goggles (the lantern battery only feeds the lantern). A "goggle cell" pickup is the obvious next step if the loop wants more resource tension.
- The creatures do not react to the goggles yet (an idea: the Mason's eyes bloom in the picture; a lamp or a flash whites it out for a second).
