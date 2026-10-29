# BUDGET_CH1: Quest draw-call / triangle trim (2026-10-21)

Budget (OWNER RULE): whole frame <= 150 calls and <= 350k triangles stereo, quest tier, 72 fps. Measured with the mock-XR
harness (enterVR, quest tier, dressing finished, `renderer.info` with autoReset off so the lantern shadow pass is included,
camera at each section's warp point, min calls over 4 frames). The mock counts both eye draws, so every level object is 2 calls;
the shadow pass is mono. Scripts: scratchpad `budget/attr.mjs` (wraps `renderBufferDirect`, attributes every call to its object).

## Before / after (calls / stereo kilo-triangles, no creature in view)

| Section | before | after |
|---|---|---|
| S1 | 129 / 273k | 119 / 217k |
| S2 | 139 / 343k | 115 / 256k |
| S3 | 147 / 371k | 123 / 303k |
| S4 | 145 / 342k | 127 / 302k |
| S5 | 150 / 332k | 137 / 262k |
| S6 | 163 / 393k | 141 / 341k |
| S7 | 152 / 360k | 133 / 305k |
| S8 | 137 / 314k | 122 / 257k |

Other tiers after the trim (S3 / S6 / S7): high 141 / 350k, 147 / 369k, 143 / 321k (richer, not budget-bound); low 112 / 260k, 126 / 297k, 118 / 274k.
Creature at 12-24 m (rig LOD1 now; LOD0 before, `lodDistance` 38): before S3 157 / 493k, S6 162 / 502k, S7 162 / 494k; after S3 132 / 345k,
S6 143 / 381k, S7 141 / 347k.

## Attribution (calls / stereo tris, S6 before -> after)

| Contributor | before | after |
|---|---|---|
| decor stone, section slabs | 8 / 76k | 8 / 64k |
| hands + launchers (12 draws per eye, 2 GLB meshes of 5.4k + 8.4k per hand, untouched) | 24 / 58k | 24 / 58k |
| decor stone, 32 m detail bands (kit panels, buttresses, hero props, relief) | 8 / 55k | 8 / 49k |
| lantern shadow pass (static + dynamic) | 11 / 48k | 9 / 18k |
| level misc (anchor mounts, cogs, rebar, decals, glyphs) | 20 / 35k | 20 / 27k |
| decor flesh | 10 / 29k | 6 / 33k |
| body (9k per eye) | 2 / 18k | 2 / 18k |
| pickups, fx / fog / rays / dust, sky, solids, contact shadows | 32 / 15k | 32 / 15k |
| colossal silhouettes | 10 / 10k | 6 / 5k |
| scene-detail | 6 / 10k | 6 / 9k |
| decor metal (section + mid + detail) | 16 / 23k | 10 / 29k |
| decor glow + shaft | 14 / 12k | 8 / 14k |

## What was cut

- **Shadow pass**: hands, launchers, body and creature LOD1 cast through welded low-poly stand-ins
  (`render/lanternShadowProxy.js`, grid-clustered skinned copies sharing the skeleton; hands 14k -> ~2.5k each, body 9k -> 4k, creature 25k ->
  a few k). Static decor chunks in the shadow pass: 2 -> 1, 9k -> 6k triangles. Shadow pass ~48k -> ~18k tris.
- **Draw calls**: glow/shaft kit parts always in the section chunk (no per-32 m detail chunks); metal and flesh detail-band lists folded into the section slab
  chunks (`FOLD_DETAIL`); colossal silhouettes only +-1 section on quest/low (+-2 on high); plaque distance 22 m x detail scale.
- **Distances (quest detail scale 1 -> 0.85, high 1.35 and low 0.55 unchanged)**: far-detail 38 -> 32 m, mid 64 -> 54 m, neighbour-section chunks 40 -> 28 m (x scale = 24 m),
  cogs <= 46 m x scale, anchor mounts 42 -> 34 m (glyph billboards still carry the route).
- **Content caps (all tiers)**: panelCap [14,16,16,10,12,14,10,10] -> [11,12,12,8,10,10,8,8], lancetsPerFace 14 -> 10, trunksPerFace 3 -> 2, rootsPerFace 3 -> 2,
  far lancet frames 45% -> 30% kept, S6 course 8 -> 11 / pier 7.3 -> 10 / lancets every 3rd tier / one cog less. Scene-detail quest tier: 5.2k -> 4.6k tris, radius 22 -> 20.
- **Creature**: Mason LOD0 -> LOD1 switch at 16 m on quest (11 m low, 38 m high), set from game.js per tier (masonRigView untouched).

## Residual risks

- S6 is still the tightest section (341k stereo, 9k under budget). A creature in view adds about 40k and 2-6 calls at LOD1 (S6 381k); LOD0 close up is +80k more.
  The governor is the only protection there; a lighter LOD0 for the Mason needs the asset work (not in this pass).
- Hands + launchers (58k, 24 calls of which 14 are tiny gauge/screen/sprite draws) and body (18k) are untouched (GLB assets, near field).
- The folded metal/flesh slabs now draw a little more far relief in S6-S8 (+10k vs the old detail tier) in exchange for -8 calls.
- Not measured on a headset; Quest multiview may count calls differently from the mock. Run `npm run at3d:sw` at release (new file lanternShadowProxy.js).

## Environment kit detail pass + collision (2026-10-23)

`tools/abyssal-tether-3d/build_env_kit.py` (Blender, bpy 5.2.2 headless) now bevels, subdivides and weathers every near kit part before the
decimator runs, so the collapse keeps carved detail in the silhouette. Two kits come out of it (`--kit quest|hi`):

| Kit | Used on | Unique triangles | Stereo triangles at S1..S8 (quest tier, mock XR) |
|---|---|---|---|
| `ch1_env_kit.glb` | Quest, phones, reduced effects (and the fallback) | 8.7k -> 10.2k | 224k / 273k / 327k / 318k / 264k / 350k (349.6k) / 315k / 263k, all <= 150 calls |
| `ch1_env_kit_hi.glb` | desktop high tier (`renderer3d.js` picks it by `lighting.tier`) | 15.2k | not budget-bound (high tier) |

Before this pass (same fog) the quest tier was 210k / 248k / 299k / 298k / 248k / 327k / 300k / 252k. Nearly all of a section's triangles are within 10 m
of the head, so distance culling does not buy room: the lean kit's growth (+22 %) is what S6 (the tightest section) leaves under 350k. The
Blender triangle targets per part are `DETAIL_TRIS` (quest) and `DETAIL_TRIS_HI`.

Collision: the parts that project into the open (corbels, buttresses, stair fragments, pipes, columns, bracket, saint, arch, gear train, lanterns, 16 parts)
now collide. `bake/decor_part_boxes.mjs` derives compound boxes per part from the built kit (`src/data/decor-parts-3d.js`); `sim/decorColliders.js` places
them where `LevelView` dressed the part (seeded, the same on every device and kit tier: 479 of 568 placements, 1145 boxes) and drops a placement
that could take an anchor, a grip / edge hold, a walkway's headroom, a hazard's neighbour, the spawn or a checkpoint. They live in `Level3D.decorSolids`
(not in `solids`: the view draws those as slabs and plans against them); `querySolids` includes them, `querySolidsStatic` does not. The bot routes
play identically with and without them (`AT3D_DECOR=<json> npm run verify:at3d`: all variants pass, same splits).

## Geometry optimisation + governor warm-up (2026-10-23, later)

Quest stereo triangles S1..S8 (quest tier, mock XR, the richer lean kit above): 224k / 273k / 327k / 318k / 264k / 350k / 315k / 263k before this pass,
**192k / 231k / 279k / 275k / 224k / 306k / 275k / 224k** after (all below the pre-detail numbers, S6 306k vs 327k), same call counts.

- **Buried faces** (`levelView.js` `cullBuried`, applied to the stone / metal / flesh dressing lists before they are merged): a triangle whose outward
  side (4 cm) lies inside a permanent drawn solid (wall / stone / metal / pillar, 2 cm in from its box; never crumble or bridge) is dropped: 34k of the
  level's 409k decor triangles (9 %), about -17k stereo in the heaviest sections. 0.2 s for the whole level on a desktop. `?cull=0` turns it off. With the
  lantern shadow off (low tier) the frames are identical to within noise; on the quest tier the picture changes only because smaller chunks now qualify as
  static shadow casters (`lanternShadow.js` DECOR_CHUNK_MAX / DECOR_TRI_BUDGET still cap that pass).
- **Models** (`tools/abyssal-tether-3d/simplify_glbs.mjs`, meshoptimizer: edge collapses onto existing vertices, so joints, weights, UVs and tangents stay valid;
  error bound 0.12-0.16 % of each mesh's radius, i.e. sub-millimetre on the hands): Arm 5388 -> 3232, Launcher 8390 -> 5645 (x2 hands), Lantern 1420 -> 1182,
  Body 9162 -> 6441 (-34 % of 38k, about -25k stereo). Hands and body are visually identical in the game (A/B frames), the posed bounds are unchanged.
  Re-run: `simplify_glbs.mjs --out <tmp>` then `compress_glbs.mjs --dir <tmp> --out <models>` (meshopt + quantisation as before).
- **Quest volumetric fog** back to its original cost (`TIER_THICKNESS` quest 1.0; desktop stays 2x). The distance fog is 2x on every tier.
- **Governor warm-up** (`platform/governor.js`, `warmup` 5 s): frames do not count for 5 s after a session start and after play begins or resumes, nor
  while the level is being dressed. The load spikes of a start (shader programs, texture / lightmap uploads, the dressing job) were stepping the governor
  down within a second or two, which switches the god rays off and thins the fog (fx tier 'low' at level 3) for 10+ s of recovery.

## Kit levels of detail (2026-10-23, last)

The kit is one GLB again (`ch1_env_kit.glb`, 2.5 MB), every detailed part at up to three levels built in Blender (`build_env_kit.py`, `--lods 0` for the medium level only):
`ch1_env_<part>_lod0` rich (about 1.65-2.4x the original triangles), `ch1_env_<part>` medium (the former lean kit), `ch1_env_<part>_lod2` far (40 % of the medium
level, min 36; skipped where the silhouette guard would keep it above 80 %: `root_c`, `buttress_lo`). Each level is decimated from the same bevelled / weathered source and
must keep its bounds within 10 % of the source on every axis longer than 0.5 m (the plain collapse took a 4 m buttress to 2.4 m).

Engine (`levelView.js`): every kit placement with levels is a record in a `LodSet`, one per section / material / vertical slab (so the LOD chunks replace the 32 m
detail-band chunks of the kit parts: no extra draw calls). The set owns one merged soup of all levels of all its records (vertices compacted to 32 bytes: position /
uv float32, normal 16-bit snorm, colour half float) and an index buffer holding only the level each record shows now. Every 3rd frame, once the head moved 15 cm, each
record's level is chosen from the distance to its surface: rich within `LOD_NEAR` (10 m) x detailScale, medium to `LOD_MID` (24 m) x detailScale, far beyond, with a 12 %
hysteresis; beyond the old detail-band distance (32 m x detailScale, for the small parts) or the fog cull distance a record is not drawn at all. A change rewrites the
index (tens of thousands of integers) and nothing else: materials, draw calls and chunk culling are untouched. The rich level is not built on the low detail scale.
`?lod=0` shows the medium level everywhere. Kit chunks (`decorlod_*`) are not lantern shadow casters.

Quest stereo triangles S1..S8 (quest tier, mock XR): 173k / 193k / 231k / 227k / 208k / **268k** / 247k / 205k (306k at S6 before the LODs, 350k budget), calls <= 149.
Cost: about +41 MB of chunk vertex data (89 MB against 48 MB with the medium level only: the soup holds three levels of every placement of the whole level).

## Creature head turning (2026-10-23)

Measured on the real level (Mason, 4 sections x 3 seeds x still / moving player, 90 s): the crown's dorsal up flipped by up to 150 degrees in ONE frame (9000 deg/s,
643 frames over 90 s per run) wherever the clinging normal was nearly along the facing (a corner of two surfaces): the projection of the normal onto the plane
perpendicular to the facing is noise there. The view used it raw, so the head and neck snapped. Fixed in the sim (`Creature3D._headUp`: the last up is kept where the
normal is ill-defined, then the roll toward the normal is rate limited, 300 deg/s) and in the shared spine frames (`masonPose.computeFrames`: roll about the facing
rate limited to 7 rad/s, no history after a teleport; the legacy `creatureView` uses it too). The facing is eased along the arc (not the chord) at 4/s with a 280 deg/s cap
(`_updateHeading`: a target behind the crown turns about the up instead of collapsing). View aim (`masonRigView._aim`): the focus gain is eased (it was a step per state, and an
attack dropped it to 0), a player behind the crown fades the aim out instead of flipping the head from side to side, damping 0.55 -> 0.8 and the swing is capped at 290 / 230 deg/s.
Frames over 300 deg/s fell from 651 to 42 per 36 x 90 s runs (the rest are relocations 28-53 m above the player and the cap itself); `tests/creature/headturn.mjs`.

## Nightmare: faster small hunters, one from below, a darker shaft (2026-10-23)

- `CREATURE_VARIANTS.skitterling.speedMulBy`: the skitterling is 7.5x the Mason's pursuit / crawl / burst speeds on Nightmare and Abyss (5x its original 1.5x design speed; Normal keeps
  4.5x = 3x). Measured in the sim (90 s, 5 seeds, S7): lunge peak 75 -> 117 m/s, chase mean 11.2 -> 15.4 m/s, no NaN, nothing outside the level. The sim's own speed ceiling is
  near: even 22.5x only reaches 124 m/s on lunges (chase 21 m/s), so the multiplier is cheap to push but past ~7.5x mostly raises the chase speed.
- `SKITTER.below` / slot 2 (`SkitterGroup._spawnBelow`): on Nightmare and Abyss, in the sections that have skitterlings at all (S6-S8), one more skitterling enters play at a random
  5-16 s after the player enters the section (or respawns), 32-48 m BELOW the player on a random wall (`spawnBelow` -> `Creature3D._enterPlay(..., below)`: it faces up, its
  relocations stay below), and hunts upward. Deterministic per run seed. Three slots / three rig views now (`SKITTER.maxAlive = 3`, `dataSlots = 2`).
- `DIFFICULTY[..].darkness` (Normal 0, Nightmare 0.72, Abyss 0.85): `renderer3d.js` eases it in and applies it to the theme target (ambient x(1-0.95d), fog colour x(1-0.85d), light colour
  x(1-0.5d), a lower fog luminance floor), the level's lamps (x(1-0.6d)) and the baked lightmaps (`lighting.setDarkness`: exposure x(1-0.85d), ambient floor x(1-0.95d)). The player's
  lantern is untouched. Mean frame luminance at the same spots: Nightmare 0.63-0.69 of Normal, Abyss 0.55-0.56.

## The frame governor no longer touches the picture (effects vanishing a few seconds after the start)

Reported on Quest: fog and god rays revert exactly 5 s after the page opens, in the menu too. 5 s is the end of the governor's warm-up
(`WARMUP`): from then on a headset that misses frames steps down, and the old steps changed the picture, not only the resolution
(level 3: fx tier `low` = god rays and fog cards off; level 2: god rays at 2 segments, wet film off, surface detail x0.85; lantern shadow
off at 3; contact shadows, parallax and bevel dropped). Now the governor trades resolution only (foveation, viewport scale; levels 3 / 4
keep fx tier `quest`); god rays, fog, lighting tier, surface look, lantern shadow and contact shadows ignore its level.
`settings.reducedEffects` (the player's own switch) still lowers them. Checked in the mock XR menu: level 4 leaves tier, fx tier,
god-ray segments, fog range and shadow plan equal to level 0. `?gov=off` still turns the governor off entirely.
Not measured on a headset: if frames are missed, the picture now gets blurrier (viewport scale 0.7) instead of thinner.
The menu is not judged any more (`platform/governor.js` and the render-side governor in `game.js` count only `playing` / `dead` frames): an independent review found that resolution and foveation still stepped down in the menu at the end of the 5 s warm-up, which looked like the picture degrading. Play still re-arms the warm-up.

## The Mason v2 (2026-10-23)

The big Mason was redesigned (hooded saint face over a split jaw, bone ribs, skeletal-hand feet; `tools/abyssal-tether-3d/README.md`).
The skitterlings keep the v1 model (`skitter_rig.glb`, 56.7 k / 20.7 k, unchanged).

| `mason_rig.glb` | v1 | v2 |
|---|---|---|
| LOD0 / LOD1 triangles | 56.7 k / 20.7 k | 63.4 k / 23.2 k (+11.7 % / +12.3 %) |
| Draw calls per view | 4 | 4 |
| File (meshopt + KTX2) | 5.4 MB | 5.6 MB (kit 4.4 MB, hero 4.5 MB) |
| Textures | 2 atlases + flat emissive | same (Crown / Body 1024 KTX2, ORM 512) |

The stereo budget harness was not re-run (rise < 15 %). Not measured on a Quest GPU.


## Creature: the body lies on the walls, and it got scarier (sim only, no asset changes)
- **Walls:** the 19 blocks behind the head used to replay the head's trail, which cuts corners (round an outside edge the body ran through the masonry, in an inside corner it hung in the air). `Creature3D._conformBody` now lays every block on the structural surface under it (height = hug x its scale, eased; up vector blended to the surface normal) and pushes it out of any solid, the dressing's boxes included. `tests/creature/walls.mjs` (sections 4-7, 3 seeds, still and moving player, 40 s): block-frames inside masonry 2.3 % -> 0.14 %, mean deviation from the wall height 0.99 m -> 0.28 m (measured with the new height formula), deep penetrations (> 0.6 m) 0.04 %. The head, the pursuit, the strike and the kill logic are untouched.
- **Dread stare:** the first time it comes into pursuit range (14-40 m) it may stop dead and stare for 1.5-2.6 s (55 %, at most once per 28 s, Mason only): a low call, the crown locked on you, then a pressure surge at you (`creature:stare`, burst reason `stare`). `tests/creature/dread.mjs`.
- **Lead:** while hunting it aims where you will be (0.5 s of your velocity, at most 5 m), so a swing across the shaft does not shake it off. Knobs: `CREATURE_TUNING.stare`, `.lead`, `.leadMax`, `.bodyReach / bodyRate / bodyMaxFix / bodyClear`.
- Not done: the rig view does not react to the stare yet (it only holds and sways), and nothing was playtested in VR.

## Creature: the body axes are locked (it no longer whips about while it chases a player who stays close)
When the player stood close and moved to and fro, the head dithered round them: the facing flipped between "where I am going" and "where you are" (a switch at 1.2 m/s), the trail breadcrumbs were eaten and laid again, and the blocks behind the head swung (block tangents up to 6000 deg/s in single frames).
- `Creature3D._lockBody`: each link keeps the length the trail gave it but may turn at most `bodyTurn` 3.4 rad/s (head end) .. `bodyTurnTail` 2.0 (tail end) from its direction last frame; `_lockUps`: each block's up at most `bodyUpTurn` 3 rad/s. The head's facing is a blend of its travel direction and the look at you (no switch), and it turns slower (and with a lower cap) inside 16 m.
- The wall fit (`_conformBody`) is eased as vectors (a normal that flips no longer jumps a block), and only shallow overlaps are pushed out.
- `tests/creature/twist.mjs` (sections 5-6, 8 seeds, a player swinging +-3 m close by, 45 s): facing >150 deg/s 3.4 % -> 2.2 % of frames, block tangents >150 deg/s 2.1 % -> 1.2 %, tangent spikes 6650 -> ~1500 deg/s, block ups capped at 172 deg/s (873-2400 before).
- Trade-off: the lock makes the body lag the trail when the head turns hard, so it clips the walls a little more than the free body with the wall fit (blocks inside masonry 0.14 % -> 0.6 %; 2.3 % before the wall fit at all).
- Not done / unverified: nothing was looked at in VR; some tangent spikes remain (relocations within 9 m, ledge crossings).

## Harder (eight small knobs, all sim / data, no assets)
1. **Loud rope:** `rope:jolt` / `rope:slip` / `player:wallhit` above `DIFF_TUNE.noiseJolt / noiseSlip / noiseWall` (Normal 15 / 0.85 / 9, Nightmare 12 / 0.6 / 7, Abyss 9 / 0.4 / 5) are noise for 0.7 s: while the Mason listens it hears you as if you ran (`Creature3D._onNoise`).
2. **Death memory:** each death in a section (since the last checkpoint) starts the next retry 10 m closer, two steps at most, never closer than `spawnAboveMin` 28 m (`T.deathStep / deathMax`).
3. **Per-difficulty section modes:** a section's `creature.by[difficulty]` overrides mode / lethal / spawn / speed. S4 is a lethal `stalk` on Nightmare and Abyss (no staged sighting there).
4. **Hunger:** every missed strike makes the Mason 5 % faster for the rest of the section, up to +25 % (`T.hunger`); a respawn keeps it, a new section forgets it.
5. **Skitterlings sooner:** S5 has one on Abyss (`skit(0, 0, 1)`), and the one from below comes in 3-9 s there instead of 5-16 s (`SKITTER.below.delayBy`).
6. **Bites cost grip:** a skitterling bite also takes 0.2 / 0.3 / 0.4 of the grip stamina (`SKITTER.gripBite`, `Climb3D.bite`).
7. **Reeling costs grip:** on Nightmare / Abyss, reeling a loaded rope in the air drains the grip stamina (0.03 / 0.05 per s, `DIFFICULTY.climb.reelDrain`) instead of letting it recover.
8. **Unreliable backups:** on Abyss half of the shortcut / recovery rings become fragile (seeded by anchor id). The route and escape anchors are never touched (the S8 bot route needs them).
Tests: `tests/creature/challenge.mjs`; `skitter.mjs` / `unit.mjs` updated for the S5 data, the Abyss delay and the closer first retry. Not playtested: these are first values, every one is a number in `CREATURE_TUNING`, `DIFF_TUNE`, `SKITTER`, `DIFFICULTY.climb` or the level data.

## Section seals (LEVEL_FUN_PLAN P1 "seal the shaft", 2026-10-28)
Seven iron gratings close S1-S7 at their choke planes (`src/data/level-data-3d.js` SEALS AND OBJECTIVES, `src/sim/objectives3d.js`); hooking a ring that is already on the route opens the one below. Cost:
- **Draw calls:** one `InstancedMesh` (`seal_bars`, `src/render/objectivesView.js`) of opaque bars with the level's `metal` material for all seals: +1 call per eye (2 stereo) while a closed seal is within view distance, 0 otherwise. No alpha-tested grate, no shadow-pass caster, no new light, no new texture or asset. The buffer is re-packed only when the set of seals in view or their state changes (and for 1.4 s while one slides open).
- **Triangles:** 534 bars in all (12 tris each); visible per section view (Quest tier, XR stereo, `attr.mjs`): S1 2.1k, S2 2.1k, S3 1.7k, S4 2.9k, S5 1.2k, S6 1.2k, S7 2.1k stereo. The S8 view showed 4.6k: the warp had just opened the iris and it was still sliding; warps / Continue now open seals silently (only a seal opened in play slides).
- **Before -> after** (calls / stereo tris per section view, same harness; the other systems vary by up to ±6 calls between boots): S1 116/160.6k -> 110/162.9k, S2 112/184.3k -> 110/179.8k, S3 126/219.0k -> 126/215.2k, S4 130/208.5k -> 130/204.4k, S5 130/190.6k -> 132/191.6k, S6 134/248.0k -> 136/250.3k, S7 132/229.2k -> 134/232.4k, S8 114/189.3k -> 116/193.2k.
- **Lightmaps:** unchanged and still valid (`bake_lightmaps.mjs --verify`: hash matches). The plates live in `level.sealSolids`, never in `level.solids`, so the slab buckets, the scene dressing, the climb edges, the bakes and both hashes never see them (the hash filters also skip `seal` defensively).
- **Sim (E29, Node):** the new `objectives` row costs p99 0.004 / 0.001 / 0.002 ms per frame (4 steps) on normal / nightmare / abyss; frame cost p99 0.275 / 0.121 / 0.135 ms of the 2.5 ms budget. The bot routes are unchanged: full runs 140.5 / 142.1 / 152.4 s (risky line), every split identical to the run before the seals.
- **Skipping:** the seal-gap check finds no hole (1 m grid of vertical probes over every sealed section's shaft) and no sight line from above a closed seal to an anchor below it (every variant, every trace point and standing spot); the greedy skip-probe bot never gets below a closed seal (S1-S7, all variants: it ends on the grating or the floor around it, with a ring above in sight where it is a grating).
- Not measured on the device: the bars' look under the baked volume light (no lightmap chart) and the Quest frame time.

## Reach and routes (LEVEL_FUN_PLAN P2, 2026-10-28)
Per-section hook reach, a fast and a safe line in every section but S1, supplies and lore on the safe lines, save schema 3 with per-section splits. Data: `src/data/level-data-3d.js` (REACH, FORKS, SUPPLIES, lore plaques), sim: `sim/level3d.js` `reachOf`, `sim/physics3d.js` `TetherSystem.aimRangeAt`, `sim/pickups3d.js`, `sim/splits3d.js`, `data/par-3d.js` (generated), `meta/save.js`; tools: `verify/forks.mjs`, `verify/par.mjs`, `tests/objectives/routes.mjs`.
- **Reach (targeting only; rope length stays aimRange + 4):** S1-S3 32/29/27, S4 30/28/26, S5 29/27/25, S6 28/27/25, S7-S8 26/25/24. The bots play every line with 1.5 m less; the longest shot of any bot line per section (Normal) S4 21.6, S5 14.1, S6 17.2, S7 19.6, S8 24.5 m (`s8-e5`, exactly at the margin). `s8-e5` moved 5 m lower so S8's chain stays in reach; the spire alternate drops `s7-sp2` (31.7 m to the next ring). Cue: rings out of reach dim and the laser dot goes hollow at the section's range (existing), deep mounts redden with the cut (per-instance colour on the existing mount meshes), one S6 hint.
- **Forks (bot, fast / safe s, Normal; NM / Abyss within 1 s):** S2 14.8 / 17.7 (16 %; Abyss 15 %), S3 6.5 / 15.2 (57 %), S4 14.8 / 21.1 (30 %), S5 6.0 / 18.1 (67 %), S6 10.7 / 22.4 (52 %), S7 18.6 / 34.9 (47 %), S8 23.4 / 36.8 (36 %). Full runs all-fast 93.7 / 96.7 / 95.1 s (lowest hp 75.5 / 41.7 / 11.7), all-safe 169.7 / 170.4 / 172.3 s (lowest hp 74.9 / 69.4 / 48.4).
- **New anchors (no new solids or lights):** 13 fast-line rings (`s2-f1`, `s3-f1/f2`, `s5-f1..f3`, `s7-f1..f7`: frayed, tag risk, the column feet are sound hooks) and 3 recovery rings for climb-out at the shorter reach (`s4-up`, `s6-up`, `s7-up`; S7 iris climb-out 78-87 %, was 39-61 %). Lightmap hash unchanged (`bake_lightmaps.mjs --verify`: matches), GI hash unchanged (no solid or light moved).
- **Supplies / lore:** 69 spots, 12 of tier `slow` on safe-line ledges (S2-S6, S8; S7's safe line has no ledge); every run puts an item on each such line (400 seeds), slow spots carry 30 % of the items, mostly batteries and first aid. 6 lore plaques (65 words), each by a slow spot, each 28 m or more from any other plaque.
- **Draw calls / triangles (not measured in the mock-XR harness or on a headset):** a plaque is one mesh drawn within 22 m x detail scale (about 19 m on Quest), so at most +1 call per eye near one of the six; the 15 new chain decors (at most 24 links, about 0.9k triangles each) merge into the existing decor chunks (no new call); anchors are instanced (no new call). No new texture except the six plaque canvases.
- **Sim (E29, Node):** frame cost p99 0.274 / 0.138 / 0.164 ms (P1: 0.275 / 0.121 / 0.135), `objectives` row p99 0.002 ms.
- **Save schema 3:** `byDiff[d].sections[id] = { best, medal }`; schema 2 profiles migrate (run.objectives kept); `split` events from `game.js` (whole sections only: never after a Continue or a warp into the section, never in Sandbox or god mode); medals gold / silver / brass at 1.0 / 1.4 / 2.0 x par. No UI shows them yet (P6).


## First verbs (LEVEL_FUN_PLAN P3, 2026-10-28)
The S1, S2 and S4 seals open on a verb instead of a route ring: the S1 bell (swing into it), the S2 counterweight (hook its ring, haul 4 ratchet notches), the S4 catwalk's three cold lamps (hold the lantern to each). Data: `src/data/level-data-3d.js` (FIXTURES, the bell chain, `s2-cw`, the lamp decors, hints), sim: `sim/objectives3d.js` (verbs, ratchet, save strings), `sim/physics3d.js` (a haul ring is never reeled toward), `sim/inventory3d.js` (`spend`), `sim/creature3d.js` (toll and notches are noises); game: `game.js` (lantern probe, haptics, toasts, debug `probe`), `audio/audio3d.js`, `ui/captions.js`, `meta/save.js`; view: `render/objectivesView.js`, `render/lighting.js`; tools: `verify/bot.mjs` (`ring` / `haul` / `light` steps), `verify/seals.mjs` (`verbProbe`), `verify/forks.mjs`, `tests/objectives/verbs.mjs`.
- **Draw calls:** the bell (5 boxes) and the counterweight (block, band, chain, pulley housing: 4 boxes) are instances of the seal bars' mesh (`seal_bars`, the `metal` material): no new call; in S1 that mesh stays drawn while the bell is in view after the grating has opened (+1 call per eye there, as before the strike). A relit lamp's flame is one octahedron (8 tris) in `lamp_flames`, a second small `InstancedMesh` with the level's emissive `decorGlow` material: +1 call per eye only while a relit S4 lamp is within view distance, 0 while they are cold. The two new rail lamps are the kit's lantern housing (`lit: false`: no glass) merged into the existing metal decor chunks (no new call). Fixture triangles: 108 in all (bell 60, counterweight 48) plus 24 for three flames.
- **Lights:** none added. The S4 lamps' light is the existing baked lamp term: `uLMK.z` × (0.2 + 0.8 × S4 progress) weighted by the frame's section blend (`Lighting._coldLamps`), so relighting a catwalk lamp also brightens the shelf and plinth pools. Lightmap hash unchanged (`bake_lightmaps.mjs --verify`: matches; lamps, chains and anchors are not in it), GI hash unchanged (no solid or light moved). The catwalk end lamp lost its always-on glass (`lit: false`); its flame comes back when relit.
- **Sim (E29, Node):** `objectives` row p99 0.010 / 0.002 / 0.002 ms per frame (P2: 0.002); frame cost p99 0.073 / 0.117 / 0.135 ms (2.5 ms budget).
- **Bot times (Normal / Nightmare / Abyss, s):** main-line splits S1 7.4 → 14.0 (all), S2 16.3 → 18.1 / 18.4 / 18.8, S4 21.1 → 29.9 / 29.9 / 30.3 (≤ 25 s per section, the plan's cap); objective done at S1 5.65, S2 6.05 / 6.35 / 6.75, S4 11.78 s (an empty lantern: 16.33 s). Forks: S2 15.7 / 19.5 (19 %; Abyss 15.8 / 20.2, 22 %), S4 24.0 / 29.9 (20 %). Full runs all-fast 111.9 / 114.9 / 113.4 s (P2: 93.7 / 96.7 / 95.1), all-safe 191.0 / 192.3 / 194.1 s (P2: 169.7 / 170.4 / 172.3). `src/data/par-3d.js` and the V14 baseline rewritten.
- **Skipping:** the skip probe still never passes a closed seal (S1-S7, all variants); the seal-gap check unchanged.
- **Mock XR (`e2e.cjs`, quest tier, max over 4 head yaws after a warp; S4's lamps cold there):** S1 120 calls / 176k stereo triangles, S4 144 / 222k, S7 144 / 292k (budget 150 / 350k). The relit-lamp flame call was not measured in the harness (+2 stereo calls by construction). Not measured on a headset.
- **Live game (`e2e.cjs` descent, Normal, creature live, the bots' routes through `AT3D.debug`):** victory in 170.4 s, 0 deaths, every section first try, 7 seals opened (S1 14.1 s, S2 18.4 s, S4 32.3 s), no console errors. The e2e runner needed the projectile hook's flight in its look-ahead snapshot and in its rope-lost rule (`e2e/page/runner.mjs`, as `verify/sim.mjs` / `bot.mjs`): without that the descent never left S1. Still failing there, unrelated to the verbs: the real-mouse / XR-trigger checks read the anchor 2 frames after the press (the hook flies ~0.13 s) and the start-fade timing check.

## Machines (LEVEL_FUN_PLAN P4, 2026-10-28)
Moving anchors, the S3 winch on a turning gear, a rockfall lane. Data: `src/data/level-data-3d.js` (MOVERS AND LANES, the S3 cage / winch rings, `winch-s3`, S3 hints), sim: `sim/movers3d.js` (new: closed-form `pendulum` / `orbit`, Movers3D), `sim/level3d.js` (dynamic anchors out of the Y index, `anchorsNear` appends them, t = 0 pose), `sim/physics3d.js` (rope pull by the velocity relative to the anchor, a hook homes on a moving ring, a ring in its housing is skipped / missed / pulls the line off, `moverAssist`), `sim/objectives3d.js` (run clock, movers, lanes, the `winch` verb, a seal never opens under the feet over a deep drop), `sim/config3d.js` (`moverAssist` 0.6 / 0.4 / 0.2); game: `game.js` (physics for lane damage, winch haptic, fallback view), `audio/audio3d.js`, `ui/captions.js`, `render/fx.js`; view: `render/objectivesView.js` (mover parts), `render/levelView.js` (live ring mounts, carried decor left out of the chunks, mover sweeps kept clear of the dressing); tools: `verify/machines.mjs` (new), `verify/bot.mjs` (`wait: { lane }`, `exposed`, `hold`, `winch`, a shared `dispatch`), `verify/routes.mjs`, `verify/forks.mjs`, `verify/sim.mjs`, `verify/verify.mjs`, `e2e/page/runner.mjs`, `tests/objectives/machines.mjs` (new).
- **Movers:** the old S3 cage south of the first span and its 15 m chain now swing (pendulum, ±0.08 rad, period 8.6 / 7.74 / 6.88 s) with a frayed ring under the cage: the fast line's catch (it replaces `s3-f1`); a gear half in the S3 north wall turns once every 12 / 10.8 / 9.6 s with the winch ring on its rim (out of the wall 44 % of a turn). Fastest carried ring 1.07 / 1.19 / 1.33 m/s (cap 1.5, V1). Poses are a pure function of `Objectives3D.clock` (in its snapshot): the bots' look-ahead, a re-run and an input replay agree (V13 hashes equal on every variant).
- **Winch (S3's verb):** a line on the ring lets the gear wind 3 notches over 0.9 / 1.2 / 1.5 s (no input); notches survive a release, the housing pulling the line off and a Continue (`winch-s3#k`). Both lines meet it: the safe line from the shelf, the fast line with the free hand while it hangs on `s3-f2`. A missed timing is a wait for the next turn (≤ 6.8 s); hooked from the grating, the seal opens once the player is off it (a new rule for every seal: it waits only over a drop deeper than 3 m).
- **Rockfall lane (`rock-s3`):** the span2 → span3 gap under `s3-a3` (2.5 x 17 x 3 m), period 7 / 6.25 / 5.5 s, stones fall 1.6 s, cued 1.5 s before (`lane:warn`: the level rumble, a crack and a trickle of grit at its top, caption "[Rocks rattle above]"), the stones are the `trigger:debris` rain column ("[Rubble falling]"). A body inside a drop loses 0.3 / 0.4 / 0.5 of its health once per drop (cause `rockfall`, a HAZARD HIT status cue; lethal only when that is all it had). Its own list (not level hazards), so no climb edge, dressing or supply rule moved.
- **Draw calls / triangles:** none added. The cage (34 boxes, its chain and cage) and the gear (36 boxes) are instances of the seals' `seal_bars` mesh (the `metal` material), posed every frame while in view: 840 triangles (≈ 1.7k stereo) in S3 only; the static cage and chain decor left the decor chunks (about 1k triangles fewer). The S3 view now keeps that mesh drawn while a mover is in sight after the S3 seal has opened (+1 call per eye there, as while it was closed). The lane uses the pooled rubble and rain. No light, texture or asset; lightmap hash unchanged (`bake_lightmaps.mjs --verify`: matches; the cage decor keeps its box, only an id was added), GI hash unchanged. Not measured in the mock-XR harness at S3 (it measures S1 / S4 / S7) nor on a headset.
- **Sim (E29, Node):** `objectives` row p99 0.017 / 0.009 / 0.008 ms per frame (P3: 0.010 / 0.002 / 0.002); frame cost p99 0.096 / 0.115 / 0.096 ms (2.5 ms budget). Counts (V12): 2 movers / 40.
- **Bot times (Normal / Nightmare / Abyss, s):** S3 safe (main) 15.2 → 17.0 / 23.8 / 22.0 (winch done at 12.95 / 20.63 / 18.8; ≤ 25 s per section: the plan's cap), S3 fast 6.5 → 11.8 / 11.0 / 9.8; fork S3 31 % / 54 % / 55 % (other forks unchanged: S2 19-22 %, S4 20-21 %, S5 67-73 %, S6 52-53 %, S7 47 %, S8 36-37 %). Full runs all-fast 113.4 / 123.2 / 117.5 (P3 111.9 / 114.9 / 113.4), all-safe 192.9 / 197.6 / 194.4 (P3 191.0 / 192.3 / 194.1). No bot line is ever struck by the lane; without its wait the S3 line is struck in 2 / 1 / 2 of 6 start phases. `src/data/par-3d.js` and the V14 baseline rewritten; `headclear.mjs` clean.
- **Skipping:** the skip probe still never passes a closed seal (S1-S7, all variants); seal gaps and climb-out unchanged (S3 100 / 100 / 99 %).
- **Live game (`e2e.cjs --hesitate 0`, one launch):** the descent (Normal, creature live, the bots' routes through `AT3D.debug`, the e2e runner now steps the movers' clock in its look-ahead and shares the bot's step grammar) reached victory in 171.9 s, 0 deaths, every section first try (S3 16.3 s), 7 seals, no console errors or faults. Mock XR (quest tier): S1 118 calls / 175k stereo triangles, S4 142 / 220k, S7 146 / 293k. 43 / 47 checks pass; the 4 failures are the same as at the end of P3 (start-fade timing, real-mouse and XR-trigger fire read 2 frames after the press, the desktop S1 swing landing): S1 / boot input, untouched by P4.
- Not done: the plan's S2 collapsing span (changing `s2-span` to `crumble` changes the lightmap hash: needs a re-bake, left for the P6 bake), the S3 cage over the span2 → span3 gap (the fast line keeps its P2 shape down the east side, with the old cage made to swing instead) and the gear on the west wall (it sits where the two lines converge, on the north wall).

## The Mason (LEVEL_FUN_PLAN P5, 2026-10-28)
The Masons' rests (item 10), the Mason as the key to S5 (item 3) and the S7 survive floor (item 11). Data: `src/data/level-data-3d.js` (the keystone `key-s5-stone` + ring `key-s5-ring`, fixtures `key-s5` (breach) / `arena-s7` (survive), `nooks`, 2 plaques + 1 tablet, 2 glyph bands, S5 / S7 hints, the S5 fork ids), sim: `sim/level3d.js` (`fixtureSolids`: out of `level.solids` like the seal plates; `segmentBlocked(..., skipKind)`), `sim/objectives3d.js` (breach + survive verbs, `onStrike` on the bus, nooks: budget / warn / spent / refill, `refugeKind` / `refugeBlock`, `creatureOverrideFor`; a seal also opens under a body hung on a sound rope), `sim/creature3d.js` (`setRefuge`, `setOverride`, strike occlusion), `sim/skitter3d.js` (`setRefuge`), `sim/threat3d.js` (eases in a rest); game: `game.js` (refuge every frame, the escape override on objective:done / respawn / warp / section change, haptics, toasts), `audio/audio3d.js`, `ui/captions.js`, `render/fx.js`, `render/objectivesView.js`; tools: `verify/bot.mjs` (`waitObj`, `waited`), `verify/routes.mjs`, `verify/seals.mjs` (`nookIntegrity`, keystone / survive V1, the skip probe may complete a survive objective), `verify/forks.mjs`, `verify/verify.mjs` (forks compare the time spent moving), `tests/creature/nooks.mjs`, `tests/creature/lure.mjs`, `tests/objectives/mason.mjs` (new).
- **Rests (creature side):** a rest = a safe box + a creature-only path-blocking box (no level solid, nothing baked). The player inside one with budget left (25 / 15 / 8 s per visit, refilled after 20 s outside) is `refuge 1`: no attack starts, the stall clock is frozen (neither runs nor resets: hiding never refreshes `stallCommit`), it holds at its stalking distance and listens (OBSERVING, pits lit; it may still surge at the mouth and stop short), its head and its lunges keep out of the block, no strike hits; skitterlings likewise. 5 s before the end `nook:warn` ("[Stone scraping at the opening]", a double-strength haptic), at 0 `nook:spent`: the rest stops protecting. Told by: the place (S4 catwalk end by the lamp you relight, S6 shelf 3 by its wall lamp, S5 the keystone niche), a glyph band (S5, S6), the plaque "THE MASONS' REST. IT CANNOT FOLLOW." (S4), a double haptic pulse on entry, the ambience ducking to 0.5, the threat easing (no burst / near-miss / stillness spikes). No rest on a fast line (V1: no fast-only ring within 6 m), none in S7 / S8. `tests/creature/nooks.mjs` (24 seeds x S6 all difficulties, S4 Nightmare / Abyss): 0 attacks started and 0 hits in a rest, stall frozen 100 %, the head never closer than minClear to the block, after the budget the still player is caught as today (median 1.4-7.3 s after it ran out), skitterlings never bite there.
- **The S5 keystone:** an iron-banded stone (0.6 x 2.5 x 2.4 m) on the last step, 1.4 m out from the west wall; the niche behind it is the lure rest (`refuge 2`: it attacks as ever, no strike hits, no budget is spent while it stands). Safety rules: a strike never hits through an active solid on the line head -> player (also outside the lure), the keystone does not block its attack line of sight (kind `breach` skipped), shot from the niche it lunges at once (`annoyed`). A Mason strike (never a skitterling's, never one that hit) that stopped at the stone, at the lure's mouth with the player in it, or ended within 2.5 m of the stone is a blow; hp 1: it breaks, the S5 plug drops. `tests/creature/lure.mjs`: 200 seeds x 3 difficulties, player still in the niche from the Mason's first entry 80 m up: broken within 40 s in 200 / 200 each (median 17.4 / 13.2 / 8.8 s, p90 18.5 / 18.7 / 17.2), 0 hits; the annoyed path (shot from the niche) 50 / 50 each, no hit. Haul fallback, available at once: its ring, 4 loud notches over 8 / 10 / 12 s (a Mason noise each), ratchet through a release / death / Continue (`key-s5#2`).
- **The S7 survive floor:** the clock runs while alive in the nave box (y -424..-292) and not standing on `s7-landing` (`arena:pause` once per stop); 45 / 60 / 60 s in 4 stages (Sandbox = Normal); a stage is kept through a death (the clock restarts at the last boundary), in the save (`arena-s7#k`), lost on a new run (Abyss: every death). Each stage withdraws one of the iris's four bolts (view; the one over the S8 landing last) with a clank and "[An iron bolt slides back below]"; the iris opens at the last stage (not a quadrant per stage: an open quadrant after 11 s would let you drop through and catch `s8-e1`, a skip of the floor). Done, the game lays `{ mode: 'escape' }` over S7's creature (`Creature3D.setOverride`; re-applied after a respawn / warp, forgotten on another section). A seal now also opens under a body that hangs within 1.6 m above it on a sound rope (not a haul ring): standing on it, it still waits.
- **Draw calls / triangles (not measured in the mock-XR harness or on a headset):** the keystone (4 boxes, 48 triangles; broken: 3 slabs) and the iris bolts (8 boxes, 96 triangles) are instances of the existing `seal_bars` mesh: no new call (in S5 the mesh stays drawn near the step after the plug opens: +1 call per eye there, as while it was closed). The 3 new plaques (S4 rest, S5 "LET IT KNOCK.", S7 tablet "THE NAVE OPENS FOR THOSE WHO HANG.") are +1 call per eye each, only within the plaque distance (~19 m on Quest); the 2 glyph bands merge into the decor chunks. No light, texture or asset. Lightmap hash unchanged (`bake_lightmaps.mjs --verify`: matches), GI hash unchanged (`bake_gi.mjs --verify`: matches): the keystone is a fixture solid, plaques / glyphs / anchors are not hashed.
- **Sim (E29, Node, full stack with the creature live):** `objectives` row p99 0.024 / 0.016 / 0.013 ms per frame (P4: 0.017 / 0.009 / 0.008); frame cost p99 0.142 / 0.157 / 0.138 ms of 2.5 ms (measured while a pacing run shared the CPU).
- **Bot times (Normal / Nightmare / Abyss, s; the bots never use the creature: they haul the keystone and wait out the survive floor):** S5 main (safe) 18.1 / 18.4 / 20.7 -> 26.2 / 28.5 / 32.7, S5 fast 6.0 -> 15.1 / 16.4 / 18.4; S7 main 34.9 -> 49.7 / 64.7 / 64.7 (the plan's cap of +25 s per section is exceeded by 4.8 s on Nightmare / Abyss: the owner's 60 s timers), S7 fast 18.6 -> 53.7 / 68.7 / 68.7 (it reaches the iris first and waits longer). Forks compare the time spent moving (the survive wait left out): S5 42 / 42 / 44 %, S7 42 % (18.6 / 32.2 s moving); others unchanged. Full runs all-fast 157.6 / 180.7 / 179.6 (P4 113.4 / 123.2 / 117.5), all-safe 217.9 / 237.8 / 236.6 (P4 192.9 / 197.6 / 194.4). `src/data/par-3d.js` and the V14 baseline rewritten. Skip probe: no seal passed with its objective undone (S7's probe may complete the survive objective by time: allowed).
- **Creature pacing (`LEVEL=real pacing.mjs 60`, deaths per run before -> after the strike-occlusion rule):** Normal expert 0.00 -> 0.00, careful 0.20 -> 0.20, hesitant 5.30 -> 4.77; Nightmare 0.00 -> 0.00, 2.97 -> 2.77, 32.05 -> 31.43; Abyss 0.02 -> 0.02, 17.08 -> 17.05, 13.38 -> 13.33; time-to-catch when stalling unchanged (median 14.5 / 9.5-9.6 / 5.7-6.7 s). The pacing model descends without stopping: it does not play the S5 lure, the rests or the S7 survive floor.
- Not done / not verified: no browser run (the e2e descent shares the bots' step grammar, `waitObj` included, but was not launched), nothing playtested in VR, the plaques' and keystone's look under the baked light not seen, the S7 floor's 45-60 s under a frenzy Mason not measured with human-pattern players.

## Polish (LEVEL_FUN_PLAN P6, 2026-10-28)
Wind squalls (item 9), the medals UI (item 12), the S2 collapsing span with the re-bake, length / Quest budget read-out, end-to-end checks. Data: `src/data/level-data-3d.js` (`squalls`, `s2-span` a crumble); sim: `sim/wind3d.js` (new: the draught functions moved out of `render/wind.js`, which re-exports them, plus the squall schedule), `sim/objectives3d.js` (squalls: schedule, telegraph, `windPush`, `setSqualls`, `squallNow`), `sim/physics3d.js` (`wind` hook after gravity, only while not grounded; `platform:strain` on a crumble's first touch), `sim/config3d.js` (`windSqualls`, on by default); game: `game.js` (the setting → objectives, `physics.wind`); view / audio / UI: `render/windGusts.js` + `render/sceneDetail.js` + `render/fx.js` (the visible gust), `audio/audio3d.js` (the wind bed swells, a groan on `platform:strain`), `ui/captions.js`, `ui/medals.js` (new), `ui/ui3d.js` (Records screen, split line, victory splits, Wind squalls row); tools: `verify/machines.mjs` (`squallProbe`, squall integrity), `verify/sim.mjs` (squalls on, `AT3D_SQUALLS=0` stills them), `verify/verify.mjs`, `e2e/page/runner.mjs` (the look-ahead feels the wind), `e2e/e2e.cjs` (victory splits, Records screen, VR Records page), `tests/objectives/polish.mjs`, `tests/ux/medals.mjs` (new).
- **Wind squalls:** one squall (`squall-s6`) down the S6 throat (x -11..10, the fast line; the safe stair behind the dividing wall is sheltered): every 26 / 20 / 15 s (Normal / Nightmare / Abyss), 4 s, sin²-shaped (never a jolt), 1.2 / 1.5 / 1.8 m/s² along +z (cap 2), 2 s telegraph (`squall:warn`: the shaft wind and whistle swell, "[Wind rising from below]", the ash wisps thicken, turn to its way and stream). It pushes a body in the air (falling, swinging, hanging: 1.2 m sideways under `s6-ra5` on Normal), never one standing or holding a wall; no camera motion. Settings › Comfort › Wind squalls (default on, saved, sanitised) stills it entirely (no push, no events, nothing seen or heard). A pure function of `Objectives3D.clock`: the bots play with the squalls ON (deterministic, V13 hashes equal); `squallProbe` plays both S6 lines from 6 clock phases per difficulty: 6/6 pass each, the throat pushed in 3-4 of 6 phases (up to 4 s), 10.5-10.8 s (vs 10.5-10.7 still), the stair never pushed. Cost: no draw call (the wisps' existing points, up to twice the tier's share during a gust), no voice (the existing wind bed), sim `objectives` row p99 0.019 / 0.013 / 0.011 ms per frame (P5 0.024 / 0.016 / 0.013), frame cost p99 0.159 / 0.133 / 0.098 ms of 2.5.
- **Medals UI (no new mesh or draw call: all on the existing VR panel / title / toast canvases):** a Records screen (menu button; VR: the best times ride on its button) per difficulty: best split, medal and the next medal's time for I..VIII from the schema-3 save; the split line ("I · 0:12.9 · GOLD", "· NEW BEST") on the next section's title card, a toast when no card shows and at the goal; this run's splits on the victory panel (DOM list, VR 4 x 2 grid). Medal times (s, gold = par / silver 1.4 x / brass 2 x, tenths rounded down), Normal: S1 14/19.6/28, S2 18.1/25.3/36.2, S3 17/23.8/34, S4 29.9/41.8/59.8, S5 26.2/36.6/52.4, S6 10.7/14.9/21.4, S7 49.7/69.5/99.4, S8 23.4/32.7/46.8; gold (par) per section on Nightmare 14 / 18.4 / 23.8 / 29.9 / 28.5 / 10.6 / 64.7 / 23.4 and Abyss 14 / 18.8 / 22 / 30.3 / 32.7 / 10.5 / 64.7 / 23.4 (silver and brass the same factors); the full table is printed by `tests/ux/medals.mjs`. The third medal is named brass, as the plan's open question 7 (owner: yes).
- **S2 collapsing span:** `s2-span` (the lower hall's safety span) is a crumble on Normal, `life` 2.5 (2.25 s standing), Nightmare's own crumbles in 0.65 s, Abyss has none; the first touch groans (`platform:strain`: a light break voice, "[Stone groaning underfoot]", the view shakes it and sheds grit from that moment), `s2-b1` is in reach above it. No bot line stands on it. A crumble is out of both hashes: the lightmap hash did not change (the span was variant-specific, never baked), the GI hash did (`bake_gi.mjs` re-baked, 1.61 MB). `bake_lightmaps.mjs` was re-run as well (the shipped pages predated P2-P5's rings, chains and lamps): 444 charts on 155 solids (was 436), 4.70 M texels, 5 pages, 4.15 MiB on disk (was 4.12), 20 MiB GPU; `--verify` matches. The S2 crumble mesh is the existing `solids_crumble` instanced mesh (+1 call per eye in the lower hall when in view; the bridge it replaces was in a static chunk). Real niche geometry for the rests was not added (see the plan).
- **Length (bot, full runs):** all-fast 157.6 / 180.7 / 179.7 s, all-safe 217.9 / 237.8 / 236.6 s (P5: 157.6 / 180.7 / 179.6, 217.9 / 237.8 / 236.6): unchanged (the Abyss fast run meets the S6 squall: +0.1 s), par within 10 % (not rewritten). Every section's main line × 3 stays far under CHAPTERS §5's first-play minutes (S1-S8 2.5 / 3 / 3 / 3 / 3 / 3.5 / 4 / 2): nothing is too long; the only cap overrun is S7 on Nightmare / Abyss (+29.8 s over P4, the plan's cap +25 s), the owner's 60 s survive timers (left as approved).
- **Quest budget (mock XR, quest tier, `attr.mjs` with all of P1-P6, max over 4 head yaws at each section's warp point, no creature):** S1 112 / 169k, S2 114 / 188k, S3 134 / 226k, S4 146 / 218k (its 3 lamps relit: 142 / 215k at the warp yaw, +2 calls for the flame mesh), S5 140 / 244k, S6 142 / 302k, S7 138 / 281k, S8 124 / 232k (calls / stereo triangles; budget 150 / 350k: all inside, nothing trimmed). At the warp yaw against P1's read-out: S6 136 / 254.6k (P1 136 / 250.3k), S7 138 / 244.0k (P1 134 / 232.4k: the tablet, the iris bolts, the fast-line chains). With the Mason in view at LOD0 (12-24 m, the 25 m Quest LOD switch of PR #14): S3 146 / 351k, S6 140 / 381k, S7 144 / 371k: over 350k by 1-31k, as before P1 (PR #14's own read-out: S6 374k); the level work adds ~7k there. Not trimmed (the creature's LOD distance is PR #14's call); the governor is the protection.
- **End to end (`e2e.cjs --hesitate 0`, one launch per tree):** this branch 43 / 48: the descent (Normal, creature live, squalls on) reached victory in 209.2 s with 2 deaths (creature), the victory panel listed the 8 splits (gold / silver / brass), the Records screen (real menu click, after a reload) showed all 8 bests from the saved profile, the VR menu has Records and its page paints, XR stereo S1 120 / 176k, S4 146 / 220k, S7 148 / 294k, no console errors. Failing: start-fade timing, the real-mouse and XR-trigger fire (read 2 frames after the press while the hook flies ~0.13 s), the S1 swing landing (no rope after the failed mouse fire), and "player stands at the spawn, fade cleared" (a cascade of the start-fade race: only 0.3 s of game time had run before the test froze it, fade 0.10 > 0.05; it passed in P4 and on 24f0a4b, this boot was 25.8 s vs 20.1-20.3 s, so likely machine load; not re-run: browser launches capped). Commit 24f0a4b (its own e2e, worktree): 38 / 45, the same start-fade, mouse, swing and XR-trigger failures (pre-existing, so not fixed here), plus its old runner's descent stalling in S1 (fixed in P3) and its S7 stereo triangles 361k (before PR #14).
- Not measured: anything on a Quest (frame time, the squall's feel, the medals panel's legibility), the squall in a real descent with a human (the e2e descent met it only if its phase fell in S6), the S2 span telegraph's look.


## Addendum: Mason and skitterling detail distances (owner: "1 and 2", the S6 budget fix)

Quest mock-XR harness (stereo, quest tier, the Mason placed at 14 m in view, `HIDE=1` = the Dresser out of play), calls / triangles:

| Section | Before (Mason LOD0 within 25 m) | After (`CREATURE_LOD.quest` = 12) |
|---|---|---|
| S3 | ~351k triangles | 134 calls / 267k |
| S6 | 140 calls / 381k | 138 calls / 301k |
| S7 | ~371k triangles | 138 calls / 283k |

`CREATURE_LOD` is now `{ low: 10, quest: 12, high: Infinity }` (game.js): the full 57 k-triangle Mason only within 12 m on Quest; LOD1 (about 23 k) beyond. The skitterlings' LOD0 -> LOD1 switch is now `SKITTER_LOD` `{ low: 2.5, quest: 3.5, high: 6 }`.

Still over budget (not fixed): S6 on Nightmare / Abyss with 2 / 3 skitterlings in one view at 9 m (about 148 calls / 337k and 156 calls / 378k). Each skitterling costs about 7 calls and 40k stereo triangles at LOD1 (its rig has 4 primitives and only a 21 k-triangle LOD1). A real fix is a LOD2 or merged primitives for `skitter_rig.glb` (an asset task).
