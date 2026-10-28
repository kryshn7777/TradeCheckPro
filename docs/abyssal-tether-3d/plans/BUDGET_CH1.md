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

