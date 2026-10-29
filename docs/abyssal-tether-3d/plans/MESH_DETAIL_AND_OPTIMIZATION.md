# MESH_DETAIL_AND_OPTIMIZATION: richer static props, paid for by a cheaper level (2026-10-29)

Owner brief: "Make the models much more detailed (the random static meshes I mean, currently they look low poly as fuck) while constantly
brainstorming sophisticated and effective optimization strategies." Bar: a $3.99 Quest title; static props near the player must hold up at
arm's length in VR. Hard budget (Quest 3, stereo, every section): <= 150 draw calls and <= 350k triangles, with room left for the creatures
(Mason up close +45-125k, a skitterling about +40k and 7 calls).

Measurement: mock-XR harness (quest tier, stereo, `renderer.info` with autoReset off, dressing finished, max over 4 head yaws at each
section's warp point): `attr.mjs` (per-draw attribution, `renderBufferDirect` wrapped) and `budget-lod.mjs` (`WORST=1 HIDE=1`, the Mason at
14 m). Both are scratchpad tools (see the end of this file). Every level object costs 2 calls (one per eye); the lantern shadow pass is off by
default (owner's call), so it costs nothing in these numbers.

## 1. Audit

### 1a. Where the calls and triangles go (before, calls / stereo triangles)

`attr.mjs`, quest tier, max over 4 yaws at each warp point, no creature, the Dresser out of play:

| Contributor | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 |
|---|---|---|---|---|---|---|---|---|
| decor stone / metal / flesh chunks (section slabs, 32 m detail bands, mid tier, kit LOD sets) | 30 / 69k | 32 / 81k | 46 / 114k | **58** / 113k | 44 / 92k | 46 / 142k | 52 / 129k | 42 / 83k |
| hands + launchers (GLB, untouched) | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k |
| pickups / climb studs / UI / debris | 18 / 16k | 10 / 15k | 12 / 17k | 10 / 13k | 16 / 11k | 8 / 10k | 8 / 17k | 8 / 16k |
| anchor mounts (4 shapes) + glyphs | 6 / 12k | 6 / 15k | 8 / 17k | 8 / 17k | 8 / 17k | 8 / 19k | 8 / 12k | 6 / 10k |
| fx / fog / god rays / dust / sky / contact shadows | 12 / 2k | 14 / 3k | 12 / 2k | 14 / 3k | 12 / 2k | 14 / 3k | 14 / 3k | 12 / 1k |
| scene detail (props, decals, puddles) | 6 / 8k | 6 / 9k | 6 / 7k | 6 / 5k | 6 / 8k | 6 / 8k | 6 / 3k | 6 / 9k |
| colossal silhouettes | 4 / 3k | 6 / 4k | 6 / 3k | 6 / 3k | 6 / 4k | 6 / 5k | 6 / 8k | 4 / 7k |
| decor glow / light shafts | 4 / 4k | 4 / 4k | 4 / 4k | 4 / 4k | 4 / 5k | 4 / 10k | 4 / 9k | 4 / 8k |
| body, solids, seals, decals, cogs, light glows | 14 / 21k | 14 / 20k | 14 / 22k | 16 / 23k | 16 / 22k | 16 / 19k | 16 / 26k | 12 / 23k |
| creature placeholders / the Dresser's far view | 2 / 0k | 2 / 0k | 2 / 0k | 4 / 7k | 2 / 0k | 6 / 7k | 4 / 0k | 2 / 0k |
| **total** | **118 / 172k** | **116 / 189k** | **132 / 225k** | **148 / 227k** | **136 / 199k** | **136 / 261k** | **140 / 245k** | **118 / 195k** |

Findings:
- **The calls are the binding constraint, not the triangles.** S4 sits at 148 of 150 with no creature (a Mason adds 4-7, a skitterling 7),
  while the worst triangle count is S6 at 261k of 350k.
- **42 % of every frame's calls are the lit decor of three materials.** One section's stone alone was 14 draws per eye at S4: four 40 m
  section slabs, four 32 m detail bands, two mid-tier bands and four kit-LOD sets (one per section / material / slab); metal 11, flesh 4.
  Many of them hold a few hundred triangles (`decorlod_metal_2_s2`: 0.2k). Some draw nothing at all: three.js still issues (and counts) a
  draw for an empty draw range, so a LOD set whose records are all beyond their limit cost 2 calls for 0 triangles.
- Already done before this pass (so NOT new wins): section culling (head section +-1, neighbours to 28 m x detail scale), fog-far culling
  (`_cullT`), kit LODs per placement, buried-face culling, fixed foveation 0.5 at governor level 0 (1.0 from level 1), the lantern shadow
  map off by default (owner's call), hand / body meshes simplified, the creatures' LOD switches.

### 1b. The props the player sees closest, and the 15 worst offenders

What the player sees within arm's / rope's length: the ledge he stands on (scene-detail props: bones, rubble, crates, barrels, tools,
chains, candles), the anchor he aims at and the chain it hangs from (59 giant chains, up to 24 links each, ~1,300 links in the level), the
Lanternwright statues at the Threshold (the first view of the game) and in S7 / S8, the wall dressing within ~10 m (kit parts: lanterns,
corbels, pipe runs, gear trains; those already have Blender-built rich levels), seal gratings underfoot. Close-up audit shots: scratchpad
`meshes/shots/before/*.png` (the committed tree, `closeups.mjs`).

| # | Prop (system) | Triangles before | Why it reads "low poly" |
|---|---|---|---|
| 1 | Lanternwright statue (`DECOR.statue`, 8 in the level, 6.4-34 m tall) | **~150** | a 7-sided cylinder robe, a box arm, a box lantern, a 5-sided staff: the Threshold's first view |
| 2 | Giant chain link (`DECOR.chain`, ~1,300 links) | 36 a link | a torus with a TRIANGULAR section (3 x 6): every anchor hangs from these |
| 3 | Barrel (scene detail) | 185 | ten 3-sided staves, a 3-sided hoop |
| 4 | Skull (scene detail) | 104 | an 80-triangle icosphere with painted sockets and two boxes for jaws |
| 5 | Small hanging chain (scene detail `chain4` / `chain7`) | 162 / 252 | links are 3-sided 5-segment loops |
| 6 | Broken crate (scene detail) | 120 | eleven boxes, no planks, no nails |
| 7 | Smashed crate (scene detail) | 84 | seven boxes |
| 8 | Dead hand lantern (scene detail) | 128 | boxes and a 20-triangle blob for glass |
| 9 | Femur / broken femur (scene detail) | 75 / 54 | a 5-sided tube with two 20-triangle blobs |
| 10 | Bucket (scene detail) | 72 | eight flat faces, a 3-sided handle |
| 11 | Rope coil (scene detail) | 148 | two 4-sided rings |
| 12 | Pickaxe / hammer / shovel / crowbar (scene detail) | 70 / 32 / 36 / 50 | 5-sided handles, box heads |
| 13 | Rubble block (scene detail) | 80 | an 80-triangle blob |
| 14 | Anchor mounts (instanced, ~15 in view) | ~700 | a plain box wall plate, 6-sided bolts, a 4 x 8 shackle eye (the ring itself is fine: 448) |
| 15 | Seal gratings / bell / counterweight / keystone (`seal_bars`, instanced boxes) | 12 a bar | sharp unbevelled boxes underfoot |

Not offenders: the kit parts (corbels, capitals, lanterns, pipe runs, gear trains, statues in niches) already have Blender-built rich levels
within 6.4 m on Quest; the far silhouettes and colossi are fog-bound. Items 1-14 are rebuilt in this pass (section 3). Item 15 is deferred:
the bars are ONE unit box instanced and stretched per bar (seals, bell, counterweight, keystone, movers), so a bevelled unit box would
stretch its chamfers along each bar; it needs a bar geometry with fixed-size chamfers (vertex-shader offset by the instance scale).

## 2. Optimisation strategies (every idea: what, expected, measured, risk, verdict)

Measured with `attr.mjs` on the working tree (other agents' concurrent work included, e.g. the board writings add 8 calls in S1 / S6):
R1 = `?pack=0&props=0&propshi=0` (this pass switched off), R2 = `?props=0&propshi=0` (the optimisations only), R3 = default (optimisations
plus the detail pass). Calls / stereo triangles, max over 4 yaws.

| Section | before (15:35 tree) | R1: this pass off | R2: optimisations | R3: optimisations + detail | R2 vs R1 | R3 vs R1 |
|---|---|---|---|---|---|---|
| S1 | 120 / 172k | 130 / 175k | 100 / 163k | 102 / 209k | -30 / -12k | -28 / +34k (two statues within 6 m of the spawn at their rich level) |
| S2 | 116 / 189k | 118 / 190k | 94 / 183k | 94 / 191k | -24 / -7k | -24 / +1k |
| S3 | 132 / 225k | 136 / 238k | 100 / 191k | 102 / 199k | -36 / -47k | -34 / -39k |
| S4 | 148 / 227k | **152** / 235k | 102 / 179k | 104 / 183k | -50 / -56k | -48 / -52k |
| S5 | 136 / 199k | 140 / 211k | 108 / 177k | 110 / 182k | -32 / -34k | -30 / -29k |
| S6 | 136 / 261k | 146 / 268k | 108 / 197k | 108 / 200k | -38 / -71k | -38 / -68k |
| S7 | 140 / 245k | 138 / 251k | 98 / 178k | 98 / 176k | -40 / -73k | -40 / -75k |
| S8 | 118 / 195k | 122 / 197k | 90 / 144k | 90 / 149k | -32 / -53k | -32 / -48k |

Calls = the max over the 4 yaws, triangles = the worst yaw. R1 is higher than "before" because of the other agents' concurrent additions
(board writings +8 calls in S1 / S6, comms panel, the richer anchor mounts of this pass: +5..+11k). Split of R2's saving: the lit decor went
from 32-56 calls to 8-12 (O1, O3), the colossal silhouettes from 4-6 to 2 (O2); the decor triangles from 69-143k to 31-73k (O1's cell
culling and pack frustum bounds, O4). The image check (`abviews.mjs`, the same 8 warp views with `?pack=0` and with the packs, desktop
canvas): mean absolute difference 0.6-3.1 of 255, under 3 % of the pixels off by more than 24 (the wet-floor glints, dust motes and the
hand-target highlight: animated, not geometry); same views: calls -9..-21, triangles -0.4..-35k per desktop view.

### Implemented

- **O1 Section packs** (`render/levelView.js` `_packBands`, `LodSet`, `packGeo`, `PACK_*`). Everything lit of one section and one material
  (stone, metal, flesh, rock) is ONE draw: a `LodSet` whose records are the kit placements (with their levels) plus "plain" records, the
  procedural dressing grouped into 12 m cubes per distance tier (section tier: fog only; the 32 m detail tier: `DETAIL_DIST`; mid:
  `MID_DIST`; near: `NEAR_DIST`). The per-record culling that used to be done by issuing or skipping separate draws (slabs, detail bands,
  mid bands, LOD sets) is done by rewriting the index: plain records first, so a kit level change rewrites (and uploads, `addUpdateRange`)
  only the tail; a record is measured to its box (plain) or its sphere (kit); a pack seen from the neighbouring section caps every record
  at `NEIGHBOUR_DIST`; the geometry's bounding sphere is the union of what is drawn now (three.js frustum-culls the whole draw when none of it
  is in view). Expected -22..-46 calls. Risk: bigger single merges during the dressing job (one add per section and material, queued as
  one step), coarser frustum culling (one sphere per section instead of per slab). `?pack=0` restores the old chunks.
- **O2 One colossal draw**: the colossal silhouettes were one mesh per section band (2-3 bands in reach = 4-6 calls); now one soup whose
  index lists the bands in reach, rewritten only when the head's section changes. Expected -2..-4 calls.
- **O3 No empty draws**: three.js issues and counts a draw for an empty draw range; a LOD set (or pack) with nothing in range is now hidden.
  Before, S7 paid 4 calls for nothing.
- **O4 Finer fog culling**: plain dressing is culled per 12 m cube (it was per 40 m slab / 32 m band, drawn whole when any of it was within
  the fog cull distance). Part of R2's triangle drop.
- **O5 (considered, not taken) far-detail cut-off back for metal / flesh**: BUDGET_CH1 folded their 32 m detail bands into the section slabs
  (drawn to the fog, "+10k far relief in S6-S8") to save draws. Inside a pack the cut-off would cost no call, but it changes what is seen
  at 27-40 m, so the packs keep the folded behaviour (no picture change); it stays available as a -5..-10k lever.
- **O6 Props by distance** (section 3): the hero meshes exist only near the head. Scene-detail heroes within 4.5 m (Quest; 7 m desktop, none on
  low) for the nearest items first, capped at +4.2k triangles a window; statue / chain-link rich levels within the kit's `LOD_NEAR`
  (6.4 m on Quest), medium to 15.4 m, far beyond; the far chain link costs what the old one did (36 triangles).
- **O8 Instanced chain links with per-instance distance bins** (`_buildLinks` / `_updateLinks`): the ~1,300 forged links of the giant chains
  are three `InstancedMesh`es (rich / medium / far link, the decor metal material, like the cogs). Every 3rd frame once the head moved, each
  link of the head's section +-1 is binned by its distance (the kit's LOD limits and hysteresis, `MID_DIST`, the fog, the neighbour cap) and
  its matrix written into its level's buffer; each mesh's bounding sphere is that of its drawn links. Up to 3 draws per eye. The first
  version put every link into the packs as a LOD record: three non-indexed levels of 1,300 links = ~46 MB of vertices (the old 36-triangle
  links were ~6 MB); instanced, the links cost 64 bytes each.
- **O7 Compact vertices for all decor**: the plain dressing now goes through the LodSet's 32-byte vertex (16-bit normals, half-float colour;
  it was 44 bytes), and the props GLB is meshopt-compressed with quantised positions / normals / UVs (0.96 -> 0.49 MB).

### Considered and rejected (or already in place)

| Idea | Expected | Verdict |
|---|---|---|
| OVR_multiview2 (one draw for both eyes) | ~-50 % of every call on Quest | three r170's WebGLRenderer has no multiview path (needs an upgrade + WebXR layers); not testable in the mock XR. Biggest possible win, left for a three.js upgrade |
| BatchedMesh / WEBGL_multi_draw | -calls, GPU-side culling | support on Quest Browser unverified; the packs already give one draw per material |
| One instanced draw for the 4 anchor-mount shapes (shape chosen in the vertex shader) | -2..-6 calls | every instance would run all four shapes' vertices (+~20k counted triangles): rejected |
| Frame-governor-driven LOD bias | protects frame time | owner rule: the governor trades resolution only (BUDGET_CH1): rejected |
| Foveation | fill rate | already 0.5 at governor level 0, 1.0 from level 1: no change (a stronger default is the owner's call) |
| Lantern shadow pass | 9 calls / 18k | off by default (owner's call): nothing to gain. With it on, packs are too big to be decor casters (the old small chunks were) |
| Depth pre-pass avoidance | - | three.js does no pre-pass here: nothing to remove |
| Alpha-test instead of blend (decals, cards) | overdraw | fill rate cannot be measured headless; not changed |
| Baked normal maps from high-poly | detail without triangles | the decor has no UVs (world-projected shared sets); a per-prop normal map needs UVs, a material and a draw each: rejected for the level decor. Detail is geometric, with AO / grime / wear baked into vertex colours |
| Trim sheets / atlases | fewer materials | the scene-detail props already share one atlas (one call); the decor shares three world-projected sets: nothing left to merge |
| Rebuilding / compressing `ch1_env_kit.glb` | -2 MB download | a rebuild is not byte-identical (60 of 76 meshes differ): the collider boxes and the bake inputs would move. Untouched; the props ship in their own GLB |
| Small-feature (projected size) culling | a few k triangles | the per-record limits already do it (small kit parts 32 m, chain links 64 m, scene detail 20 m) |
| Welding the non-indexed soups (vertex cache) | -40-60 % vertex memory and vertex work | the dressing is non-indexed by construction (flat per-face UVs); deferred |
| Uint16 indices where the soup allows | -50 % index memory | small; deferred |

## 3. Detail pass

`tools/abyssal-tether-3d/build_props_v2.py` (Blender 5.2 / bpy, procedural, deterministic) -> `assets/models/env/ch1_props_v2.glb`.
Each hero is authored at a fine resolution (real forms, bevelled hard edges, subdivided and displaced: chips, pitting, lumps), decimated to
its budget, then AO (self + mount plane), cavity grime, edge wear and rust are baked into the vertex colour. Palette = the existing linear
albedo of `sceneDetailKit.js` and the kit's grey-AO convention, so nothing changes colour; no new material, texture or light; the lighting
model is untouched.

| Prop class | Where it is drawn | Rich (near) | Medium | Far | Before |
|---|---|---|---|---|---|
| Giant chain link (1,300 in the level) | within 6.4 m / 15.4 m / to 64 m (Quest) | 288 (oval section, weld bulge, hammer facets, pitting) | 96 | 36 | 36 everywhere |
| Lanternwright statue (8) | 6.4 m / 15.4 m / fog | 9,000 stone + 728 iron (pleated robe, rope belt with knot and tails, hood with a face in shadow, sleeves and hands, lantern cage, crooked staff, stepped plinth) | 2,600 + 420 | 800 + 120 | ~150 |
| Scene-detail heroes (ground props) | nearest items within 4.5 m (Quest; 7 m desktop), +4.2k triangles a window at most | skull 900, femur 420 / 360, rib 180, barrel 1,500, broken crate 900, smashed crate 850, hand lantern 760, bucket 640, rope coil 1,000, block 420, tools 200-420 | the old procedural template beyond 4.5 m (54-252) | - | 32-252 |
| Hanging chain (scene detail) | as above | chain4 520, chain7 820 (real stadium links), the sway of the lean template kept | lean | - | 162 / 252 |
| Anchor mount plate (instanced) | every mount within 34 m | rounded, chamfered forged plate, four domed rivets, 8 x 12 shackle eye | - | - | box plate, 6-sided pegs, 4 x 8 eye |

What each hero gained: the skull has carved orbits (painted near black), a nasal cavity, cheekbones, temples, a maxilla with ten teeth, a
dropped mandible with rami and eight teeth; the barrel 14 bulging staves with gaps (three missing, one sprung outward, one broken short), two
riveted flat hoops (the upper one slipped and tilted), base boards; the crates splintered plank ends, bevelled planks and posts, nail heads;
the hand lantern a pan, four posts, frame rails, two panes and a cracked third, a vented cap and a bail; the bucket a dented tapered shell,
rolled rim, two hoops, ears and a handle; the chains forged links; the rope coil a three-strand twisted section; the rubble block chipped
facets; the tools tapered handles, forged heads, a wedge, a socket and a blade.

GLB / download: `ch1_props_v2.glb` 0.96 MB raw -> **0.49 MB** shipped (meshopt + quantised positions, normals, UVs; colours untouched).
`ch1_env_kit.glb` is unchanged (2.89 MB). First load / PWA precache: +0.49 MB (the props load in parallel with the environment kit; until
they arrive the chains and statues are not drawn, like the kit parts; a failed load falls back to the procedural builders). GPU memory: the
chain links are instances (one copy of each level, 64 bytes a link); the 8 statues' three levels sit in the stone / metal packs
(13.7k triangles x 3 vertices x 32 bytes = 1.3 MB each, ~10.5 MB); the scene-detail heroes add ~10k vertices to the kit arrays (CPU) and
nothing to the GPU beyond the existing window buffer (raised to 40k vertices / 14k triangles: +0.9 MB). The plain dressing's move to
32-byte vertices (from 44) saves about a quarter of its vertex memory.

## 4. Verification

PENDING
