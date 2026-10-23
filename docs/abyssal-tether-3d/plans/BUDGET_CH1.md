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
