# The skitterlings: one species, two tiers

Owner (2026-11-05): "Add tiny super tiny skitterlings ... like cockroaches in red colour", then "I mean I need the skitterlings to be roaches".
So there is ONE creature family, ONE name the player reads (**skitterlings**) and ONE look: a red, glossy, wet-chitin cockroach. This page
supersedes the "not the Skitterling enemy" note that [ROACHES.md](ROACHES.md) had.

| | **Swarm skitterlings** | **Hunter skitterlings** |
|---|---|---|
| What | tiny (3.4 cm x 0.7-1.3), ambient, **harmless**: they appear near you out of camera, flee the lantern, can be squished | the big ones (a ~0.48 m body, antennae to ~0.6 m ahead) that **hunt and bite** (a bite costs health and grip, never an instant kill) |
| Sim (unchanged by the reskin) | `src/sim/roaches.js` (code name "roaches"), plans/ROACHES.md | `src/sim/skitter3d.js` (`SkitterGroup` of `Creature3D` variant `skitterling`), WP-SKITTER |
| View | `src/render/roachView.js`: ONE InstancedMesh | `src/render/skitterlingView.js`: one InstancedMesh per LOD |
| Model | the 27-triangle swarm model | LOD0 the 156-triangle hunter model; LOD1 the swarm model |
| Where | everywhere, more deeper | the data's sections (S6-S8; S5 on Abyss), plus one from below on Nightmare / Abyss |
| Setting | "Tiny skitterlings" (storage key `roaches`): off = none, ever | gameplay: always on (`?skitter=off` for QA) |

In code and docs say **swarm skitterling(s)** and **hunter skitterling(s)**. Identifiers keep their history: `roach*` = swarm, `skitter*` =
hunter. A swarm skitterling never becomes a threat; the hunters' rules (speeds, scale 0.45, reach, wind-up, lunge, damage, sounds) are untouched.

## The shared body (`src/render/skitterlingModel.js`)

One builder module and ONE shader source for both tiers, so they are visibly the same animal:

- `buildSwarmGeometry()` (27 tris): the swarm's model as it was (the hunters' far LOD).
- `buildHunterGeometry()` (156 tris): a flat domed oval shield (12 around x 3 bands + a flat belly), the pronotum's rim and the wing-case seam
  in the shader, a small head tucked under the shield with mouthparts, long fine three-segment antennae (to 1.5 body units ahead), six legs of
  femur + tibia as crossed blades with two spines on each tibia, two cerci.
- `SKITTERLING_VERT / _FRAG`, `makeSkitterlingMaterial(hunter)`: the gait is in the vertex shader. Legs carry `aRig = (2 + 0.1 x pair, weight,
  tripod phase, side)`; the **alternating tripod** is L1 R2 L3 (phase 0) against R1 L2 R3 (phase PI). The `HUNTER` define adds a per-instance
  `aPose = (rear, lunge, glint, shiver)`: the front pair rises and paws, the antennae lift, the other legs brace; in the lunge the front legs are
  thrown forward and the rest flung back. Lit by the carried lantern only (the shared `LOOK` uniforms), the level's fog; no textures, no toon
  bands, no outlines.
- **No eyes.** Roaches look eyeless: the hunter gets a faint red sheen on the head and the front of the shield that follows the sim's `glow`
  (x 0.11, rim-weighted). The Mason's two red eyes stay its own.

## The hunter view (`src/render/skitterlingView.js`)

Driven entirely by the sim's public body state, no change to the sim:

- **Frame**: `body.head` (the point the sim crawls at, `CREATURE_TUNING.hug x 0.45` = 0.65 m off the wall, the facing, the dorsal up). The roach
  lies ON the wall under that point, its head where the sim's head is, its up the dorsal normal, its forward the facing flattened onto the wall.
- **Gait**: a phase advanced by the distance run (`speed / 0.32 m` cycles a second, capped at 16 Hz: a blur of legs, not a strobe).
- **Attack telegraph**: the wind-up (`attack.phase === 'windup'`) rears it on its hind legs (the body tips up to 0.62 rad about the hind feet,
  front legs up and pawing, antennae raised); the strike leaves the wall and flies at you along the sim's lunge (the hug offset goes to 0); the
  recoil drops it back over `postStrike`.
- **LOD**: LOD0 within 10 m (desktop) / 6 m (Quest) / 4 m (low) of the camera, 0.75 m hysteresis; the swarm model beyond.
- `game.skitterView`; debug: `AT3D.debug.creature.placeSkitter([{x, y, z, ux, uy, uz, fx, fy, fz, speed, rear, leap}])` (synthetic hunters on a
  surface point), `clearSkitter()`, `spawnSkitter(n)` (real ones), `skitter()`; `AT3D.debug.skitterlings.hunters()`. The swarm's API is
  `AT3D.debug.skitterlings.{state, burst, clear}`; `AT3D.debug.roaches` is the same object.

What it replaced: three skinned clones of the original Mason rig (`skitter_rig.glb`, 5.4 MB, LOD0 56.7 k / LOD1 20.7 k triangles, about 7 draw
calls and 40 k stereo triangles EACH at LOD1, BUDGET_CH1.md's open "S6 Nightmare / Abyss over budget" item), with mandibles, eyes, maw,
stinger, leg IK and a mixer per clone. The GLB, `mason/skitterClone.js` and `SKITTER_VIEW` / `makeSkitterViews` / `cloneSkitterScenes` are
removed. The `variant` option inside `MasonRigView` (and `mason/skitterMaterial.js`, `GAIT_SKITTER`) is now unused by the game and left for the
Mason agent to retire (its file is being edited in parallel).

## Budget

| | hunters (all of them) | swarm |
|---|---|---|
| Draw calls | **<= 2** (LOD0 mesh + LOD1 mesh; 1 when all are in one LOD) | 1 |
| Triangles | 156 near / 27 far each; 3 at LOD0 = 468 mono / **936 stereo** | 27 each |
| CPU (Node, view only) | ~0.4 us a frame with 3 hunters | ~0.02 ms a frame at the cap |
| Allocation | none per frame (20 000-frame heap test) | none |
| Download | **-5.4 MB** (no GLB) | none |

Quest budget 150 calls / 350 k stereo triangles: the hunters went from ~7 calls + ~40 k stereo triangles each (up to ~21 calls / ~120 k for
three) to at most 2 calls / under 1 k triangles for all three. Measured in the game: see the captures below.

## Tests

`tools/abyssal-tether-3d/tests/creature/skitterlings.mjs` (in run-tests.mjs): the shared model / shader, the far LOD = the swarm model, LOD0 in
150-250, alternating tripods (both models), the hunter view on the real sim (Nightmare S7, 90 s: one instance per hunter, orthonormal frames on
the dorsal normal, on the wall under the head, the wind-up rears it, the strike throws it, the gait clock runs), determinism, zero allocation,
CPU, the LOD switch, the old saved `roaches: false` still hiding the swarm, no user-visible "roach" string in `src`, captions, the wiring.
`creature/roaches.mjs` (the swarm) and `creature/skitter.mjs` (the hunter sim) are unchanged in substance. The old look was pinned by
`render/test-mason-rig.mjs` ("SKITTER_VIEW.headK 0.4-0.7": the skitterling's crown in proportion to its worm body); that check now asserts
the Mason rig builds no skitterling clones.

## Not verified

Headset feel (the 0.48 m body at Quest field of view, the rear-up read at 2-3 m in stereo), the gait read in motion (captures are stills),
sound by ear (the hunters keep the Mason's tagged sounds, pitched up: a skittering cockroach may want its own click layer later).
