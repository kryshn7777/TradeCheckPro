# Red roaches

Owner's brief (2026-11-05): "Add tiny super tiny skitterlings. Super optimized. Often spawning near player out of camera like cockroaches in red colour."

**Lore line.** *The Masons never cleaned up after themselves. Something else does: red, glossy, the length of a fingernail, and it does not like the light.*

They are **not** the Skitterling (`sim/skitter3d.js`, the small fast red hunter that bites). Red roaches are ambient dread with a little play: you catch one
in the corner of your eye scuttling away, you hear a dry tick-tick-tick behind you and turn and it is gone; later three of them dash across the ledge in
front of you and scatter from your lantern. **They never hurt you.** Everything is in both chapters; Settings switch "Roaches" (on by default) removes
them completely for players who hate bugs.

| Part | File |
|---|---|
| Pure sim (no three.js, no DOM): pool, spawn planner, behaviour, events | `src/sim/roaches.js` |
| View: ONE InstancedMesh, gait in the vertex shader, the context glue | `src/render/roachView.js` |
| Sounds (mixed into the audio manager) | `src/audio/roachSfx.js` |
| Captions | `src/ui/captions.js` (`roach:*` rules, low priority) |
| Wiring | `src/game.js` (per run, `_updateViews`, respawn / warp, debug API) |
| Setting | `settings.roaches` (`config3d.js`), Display tab on desktop, Access page in a headset (the VR Display page is full) |
| Tests | `tools/abyssal-tether-3d/tests/creature/roaches.mjs` (in `run-tests.mjs`) |

## Behaviour

One state per roach, cockroach rhythm: bursts of speed, dead stops, the antennae always moving.

| State | What it does | Leaves for |
|---|---|---|
| IDLE | sits, antennae sweep (0.3-2.0 s) | DART (a new heading +-70 deg) |
| DART | runs 0.30-0.85 m/s for 0.12-0.65 s with a wobble | FREEZE (60 %) or another DART with a sharp turn |
| FREEZE | stops dead 0.15-1.1 s, antennae twitch hard (reacts 0.12 s slower) | DART with a sharp turn |
| FLEE | runs 1.0-1.55 m/s AWAY from the threat, along its face; keeps running while the threat stays, 0.6 s more | HIDE (70 %) or FREEZE |
| HIDE | runs to the nearest edge of its patch (a crack, the lip of a ledge, the foot of a box standing on the face) | gone (despawned) |
| SMEAR | squished: a flattened dark wet smear, 14 s, shrinking away over the last 4 | the slot is free |

A roach also goes to HIDE when its life (7-18 s) runs out, when it is more than 13 m from the head, or when the cap drops below the count (the governor
stepped up); it is dropped at once beyond 20 m or when the box it stands on goes inactive (a crumbled ledge, an opened seal).

**Fear** (each needs a 0.06-0.2 s reaction, +0.12 s when frozen, so a quick hand can still catch one): the lantern (within 2 m of it, or within 6.5 m inside a
~30 deg cone along the view; both scaled by the lantern's brightness, none below 15 %), a hand within 0.55 m (or within 1.6 m moving faster than 1.2 m/s),
the body moving faster than 1 m/s within 1.4 m, a landing within 3.2 m, a swing faster than 4 m/s within 4.5 m.

**Squish**: a hand within 9 cm of it (XR: the palm on the wall), or a boot: grounded, moving (> 0.3 m/s) or landing, the roach on a floor within 22 cm of
the feet. One `roach:squish` event, the smear, a wet crunch.

**Surfaces.** Every level box is an AABB, so a roach lives on one face of one box: its position stays on that plane (3 mm off it), its heading is an angle
on the face. Its **patch** is the face clipped to +-3 m around where it appeared; the boxes standing on that patch (up to 6) are gathered once at spawn,
so every frame after is plain arithmetic: run into the patch edge or a box's foot and it turns (a flight slides along it), in HIDE it is gone.

## Spawning

**Often, near, out of camera.** Wanted population near the player: 6 / 8 / 10 / 12 / 14 / 16 / 19 / 22 in S1..S8 (deeper sections reuse the last), +10 % per
remains weight within 9 m (a skeleton 2, a bloodstain 1; `sim/remainsPlan.js`), up to +80 %; the cap clamps it. A spawn at most every 0.16 s while below
the wanted count (a failed frame retries 0.05 s later).

One attempt = one ray: a direction 72-180 deg off the horizontal view axis (behind or beside you), a distance 2-9 m; 60 % a **floor** (a ray straight
down from 0.4 m above head height at that point, must land on a box's top face), 40 % a **wall** (a horizontal ray from chest / knee height, must land on
a vertical face 2-9 m away). The point is accepted only if it is inside its face (5 cm margin), 2-9 m from the head, **outside the view frustum**
(the camera's own frustum widened by 18 % plus 5 cm; in a headset at least tan 55 deg x tan 52 deg, both eyes), outside the **quiet zones** (7 m around
the spawn and every checkpoint), and nothing stands on the spot. Half of them appear already running away from you (the one in the corner of the eye),
half sitting.

**The crack burst.** Grabbing a hold (`climb:grab`) rolls a deterministic die (seed, grab count, section): 0 / 5 / 8 / 10 / 12 / 14 / 16 / 18 % in S1..S8, at
most once per 40 s, never in a quiet zone. The wall is found with 6 short rays around the hand (within the frame's ray budget), the crack is 0.4-0.9 m to
one side of the hand on that face, 5-9 roaches pour out one every 70 ms, fanning away from the hand, then hide. One `roach:burst` event.

## Out-of-camera test

`inView(head, x, y, z)` (pure): with d = p - head, z' = d . forward, x' = d . right, y' = d . up, the point is in view when z' > -pad and
|x'| <= z' tanH (1 + 0.18) + pad and |y'| <= z' tanV (1 + 0.18) + pad, pad = 5 cm. tanH / tanV come from the camera's projection (`1 / P[0]`, `1 / P[5]`;
three copies the XR camera's combined projection into the user camera), floored at 1.45 / 1.30 in a headset. Occlusion is not used: a point behind a
wall but inside the frustum is still refused (cheap and strict). A roach that is already alive may run into view: that is the point.

## Sound (`audio/roachSfx.js`)

Designed, not random: every variation comes from a counter through an integer hash (no `Math.random()`, the noise buffers start at hashed offsets).
Placed at the roach (HRTF while there is room, the 'flat' panner for direction) with a small thing's distance law 1 / (1 + (d / 2.5)^1.6), silent past 9-14 m.

| Event | Sound |
|---|---|
| `roach:skitter` {x,y,z,n,speed} every 0.3-0.7 s while one runs within 7 m | 3-9 dry chitin clicks (band-passed noise, 3.2-6.8 kHz, 4 ms decay) in the tripod's strong-weak-strong rhythm, faster with speed; a breath of rustle when 3+ run |
| `roach:scatter` {x,y,z,n} when 2+ start fleeing in the same frame (0.5 s apart) | two overlapping trains of 10-30 clicks, accelerating then thinning as they get away, a falling band of rustle |
| `roach:squish` {x,y,z} | the shell cracking (three bright ticks in 25 ms), a squelch (brown noise through a band falling 1.4 kHz -> 380 Hz), a tiny low pop |
| `roach:burst` {x,y,z,n} | a soft knock and a rising band of rustle inside the wall, then a stream of 20-50 clicks pouring out, two stragglers |

Captions (low priority: they never push another line off): `[Dry ticking, close]` (2+ running, 20 s cooldown), `[Tiny legs scattering]` (3+), `[A wet crunch]`,
`[Skittering pours out of the wall]`.

## Budget

| | Quest | desktop |
|---|---|---|
| Cap (alive at once) | 48 (governor 1: 28, 2: 16, >= 3: none) | 96 |
| Draw calls | **+1** (one InstancedMesh for every roach and smear; +2 in the stereo mock without multiview) | +1 |
| Triangles | 27 per roach: at most 1,296 mono / 2,592 stereo | at most 2,592 |
| Upload | the instance matrices + one vec4 each, whole buffers: at most 7.5 KB a frame | same |
| CPU (Node, sim + instance writes, pool held full, 1000 frames) | ~0.017-0.02 ms a frame at 48 alive | ~0.017-0.022 ms at 94-96 alive |
| Allocations | none per frame (20 000-frame heap test: +3.4 KB, the measuring noise) | |
| Ray casts | at most 2 a frame, against the sim's own y-bucketed copy of the level's boxes | |

Measured by `tests/creature/roaches.mjs` (the numbers vary with the machine's load). No shadow casting, no lights, no textures, no assets: the model is
procedural and the shader is a ShaderMaterial on the shared fog chunks and the shared lantern uniforms (`LOOK.uLanternW / uLanternC / uLanternR`).

**How it stays allocation-free.** Typed-array pool; one payload object per event type; the RNG returns 30-bit integers (a small integer is never boxed; the
caller scales it); numbers go into and out of helpers through typed-array "registers" (a double passed to a call that is not inlined is boxed by V8); the
sim keeps its own y-bucketed copy of the level's boxes (`Level3D.raycast` builds four arrays per box it tests); the view uploads whole buffers (three's
update ranges allocate a record and, because three clears them with `length = 0`, a new backing store every frame).

## Tuning knobs (`ROACH` in `sim/roaches.js`)

`cap`, `govScale`, `pop`, `hotBonus` / `hotMax` / `hotRadius`, `spawnGap`, `rMin` / `rMax`, `offAngle`, `fovPad`, `quiet`, `raysPerFrame`, `len` / `size`,
`speed`, `idle` / `dart` / `freeze` / `life`, `hideFar` / `dropFar`, `fear` (light / hand / body radii and speeds), `react`, `calm`, `squish`, `smear` /
`smearFade`, `territory`, `obstacles`, `burst` (chance per section, cooldown, n, gap, reach), `skitter` (range, gap), `scatterGap`. A run's sim also has
`popMul` (x the wanted population) and `enabled`.

## Debug

`AT3D.debug.roaches.state()` (alive, cap, target, section, remains weight, by state, stats, the view's shown / triangles / calls), `.burst()` (a crack burst
beside the right hand), `.clear()`. The sim is `AT3D.game.roaches` (`placeAt(solid, face, x, y, z, state, heading)` for tests and captures).

## Not verified

Not seen or heard on a headset: the scale (3.4 cm x 0.7-1.3) and the frustum floor were chosen on paper for the Quest's field of view; the squish by palm
needs a real hand on a real wall to tune (9 cm); the sounds were checked on the strict mock audio context, not by ear. The captures are the desktop
software renderer with a narrowed lens (a 3.4 cm insect at 70 deg is a few pixels).
