# ABYSSAL TETHER 3D — asset pipeline and test tooling

Source tooling for the full-3D / Meta Quest 3 (WebXR) version. Built assets go to
`public/abyssal-tether-3d/assets/` so they deploy with the site over HTTPS (required for WebXR).

Verification and tests (each folder has its own README):

| Folder | Run | What |
|---|---|---|
| [`verify/`](verify/README.md) | `npm run verify:at3d -- --chapter ch1 --variant all` | the route-bot harness: integrity, every route on every variant, determinism, sim budget per system (ENGINE_EXTENSIONS E28 / E29 / §8) |
| [`e2e/`](e2e/README.md) | `npm run e2e:at3d` | the real game in headless Chromium: desktop input, the whole descent with the creature live, persistence, mock WebXR |
| [`tests/`](tests/README.md) | `npm run test:at3d` | Node unit tests (input, VR UX fixes, creature) and the creature pacing / perf tools |
| [`bake/`](bake/bake_gi.mjs) | `node tools/abyssal-tether-3d/bake/bake_gi.mjs` (`--verify` checks the asset against the level) | bakes the static lighting (AO, lamp/shaft bounce, key visibility) of Chapter I into `public/abyssal-tether-3d/assets/lighting/gi_ch1.bin` (~1 MB, ~10 s, deterministic, no Blender); re-run after any change to level solids or lights (the runtime ignores a stale bake and tests/render/test-lighting.mjs fails) |
| [`bake/`](bake/bake_lightmaps.mjs) | `node tools/abyssal-tether-3d/bake/bake_lightmaps.mjs [--draft] [--budget N] [--workers N] [--preview DIR] [--verify]` | bakes Chapter I's LIGHTMAPS (Quest look): per-face charts on every visible static solid (0.1-0.6 m texels under a 5M-texel budget), direct light from the 13 lamps, light shafts and the shaft key (soft shadows), sky/abyss ambient with baked occlusion, 3 gather bounces with colour bleeding, denoise + dilation, sqrt RGBA8 pages (RGB static irradiance, A flame-lamp direct light that the runtime flickers) into `assets/lighting/lm_ch1_index.json` + `lm_ch1_p<N>.bin` (5 pages, 20 MB of GPU memory, ~4.2 MB on disk, ~1-1.5 min on 4 cores, deterministic for any worker count; last re-baked in LEVEL_FUN_PLAN P6 with the GI). Helpers: `lmCharts.mjs` (visibility, density, MaxRects packing), `lmTrace.mjs` (box-grid ray tracer), `lmTheme.mjs`, `lmWorker.mjs`. Re-run after any change to core solids, lamps, light shafts or shadow-casting decor (the runtime ignores a stale bake; tests/render/test-lighting.mjs fails). Format and design notes: `src/render/lightmapFormat.js`, `src/render/lighting.js` |

## The Mason (predator)

`build_mason.py` is the production builder of the creature (Blender 5.2 / `bpy`, procedural, deterministic, seed 1313).
**v2 (2026-10-23), the hooded saint:** a 29.5 m centipede of 27 split masonry vertebrae (snapped bone ribs round the flanks,
iron staples across the fractures, a skeleton hand clawing out of every third crack) on skeletal-hand feet with iron manacles,
under a head that is a carved saint's face split down the middle: a stone mask in two halves (doors, hairline crack at rest,
broken nose cavity, black orbits full of small clustered bloodshot eyes with milky irises, tear stains, flaked-off patches
showing wet flesh) over human teeth on gum bands, a broken bone mandible that hangs open, three toothed oral discs and an
ember throat behind it, a hood of carved soot-black drapery, a broken halo of thin moulded arcs with thorns, five long bone
arms with skeletal hands, a victim hanging from the jaw. Emissive (`MasonEmissive`, heartbeat-pulsed by `masonRigView.js`)
only in the throat and the coals at the back of two orbits.

**v1 is kept for the small hunters:** `assets/models/skitter_rig.glb` is the original Mason (do not rebuild it from v2);
`build_mason_v1.py` + `mason_rig_clips_v1.py` are the frozen v1 sources (`build_mason_rig.py` picks the v1 clips when the
kit has no head pivots). The byte-exact shipped v1 assets came from `git show 09b6f21:tools/abyssal-tether-3d/build_mason.py`.

| Output | Contents |
|---|---|
| `public/abyssal-tether-3d/assets/models/mason_kit.glb` (5.6 MB) | The rig-ready modular kit: 13 modules with LOD0 and `_LOD1` twins, 2 baked 2048 atlases (MasonCrown, MasonBody; base colour, tangent normal, ORM 512) + the flat `MasonEmissive` material |
| `public/abyssal-tether-3d/assets/models/mason_hero.glb` (5.6 MB) | The assembled, posed creature from the same modules (shared meshes, instanced nodes): root `Mason_Hero_LOD0` (59 k triangles) and `Mason_Hero_LOD1` (25 k). Marketing / cinematic model, not loaded by the runtime |
| `previews/mason_hero.png`, `mason_full.png`, `mason_approach.png`, `mason_kit.png` | Cycles design renders of the render mesh (hero, whole creature, first-person 18 mm view) and a three.js screenshot of the kit modules |
| `wip/creature/` | `build_r1/r2/r3.py` (design history), `pack_glb.py`, `check_glb.mjs`, `harness/` (headless three.js + game checks), `export_report.json` |

Kit modules (Blender +Z up exports as glTF +Y up, head facing -Z; each pivot is at its joint). The part names and
pivots are the contract `CreatureView` loads by name; every module also has a `<Name>_LOD1` twin:

| Part | LOD0 / LOD1 tris | Pivot / orientation | Rig use (CREATURE_RIG_PLAN section 2) |
|---|---|---|---|
| `Mason_Head` | 17.5 k / 6 k | crown centre, face toward +Y (glTF -Z) | module "Crown + neck": owners `crown`, `portal_arch_0..2`, `portal_comb_L0/L1/R0/R1`, `portal_hinge_0/1` (the dropped ventral third, rigid), `gullet_0..2`, `pit_0..6`, `arm_0..4_{0,1}` |
| `Mason_Segment_0..2` | 1.1 k / 0.4 k | block centre; head-ward +Y, dorsal +Z | vertebra variants: stone/iron rigid on `spine_k`, flesh blended `spine_k` -> `spine_k1` by `_SPINE_S` |
| `Mason_Tail` | 0.56 k / 0.2 k | block centre of the last vertebra | `spine_k` / `tail_0` |
| `Mason_LimbUpper` / `Mason_LimbLower` / `Mason_Hook` | 0.64/0.42/0.15 k | joint pin at the origin, bone along +Z | `leg_0` (strut + knee pier) / `leg_1` shank + `leg_2` metatarsus / `leg_3` grapnel; flesh at the strut root blends with `spine_k` |
| `Mason_Frond_0..2` | ~55 / ~18 | root; grows along +Y, curls about +X | `frond` |
| `Mason_Pit` | ~20 / 6 | pit centre, opening +Y | glowing coal only (emissive material); the full pits are part of the head |
| `Mason_PitMembrane` | 87 | pit centre | eardrum (ignored by the legacy view) |

Vertex attributes on every module (underscore names; GLTFLoader lower-cases them): `_SPINE_S` (float, module-local rest
arc length in m, head side = 0), `_MASK` (UNSIGNED_BYTE normalized VEC4: flesh, wet, thickness, class/3 with stone 0,
iron 1/3, flesh 2/3, bone 1), `_OWNER` (UNSIGNED_BYTE VEC4, not normalized: owner bone id, second bone id (255 = none),
weight of the second bone * 255, 0) and `_PART` (float, stone-island id for plate lift / jitter). The owner id ->
canonical bone name table is in the node extras (`rig_module` JSON, plus `pivot_world`, the module's frame in the
posed creature). Rigid parts (stone, iron, bone, teeth) carry one owner; flesh groups carry two. Emissive faces
(throat fissure, pit coal) are in material `MasonEmissive`; everything else uses `MasonCrown` or `MasonBody`
(`MeshStandardMaterial`, no clearcoat/transmission/sheen). Drool, glass and oil are render-only.

Budgets: the rig (what the game draws) is 63.4 k triangles at LOD0 / 23.2 k at LOD1 (v1: 56.7 k / 20.7 k; limit +15 %),
still 4 draw calls; shipped GLBs (meshopt + KTX2, atlases 1024 / ORM 512): `mason_rig.glb` 5.6 MB, `mason_kit.glb` 4.4 MB,
`mason_hero.glb` 4.5 MB. v2 options: `--gamecam x,y,z,lens` + `--lantern W` and the shots `game` (climber's view under the
lantern) and `profile`; previews `previews/mason_approach.png` (game) and `mason_profile.png`. The other `previews/mason_*`
images (hero, full, kit, rig clip sheets) still show v1 and were not re-rendered.

### Run

Always under the shared lock, one Blender at a time (the full creature render mesh is ~2 M triangles; keep the process
under about 4-5 GB: use `--lab head` or `--grain 0` for renders, `--grain 0 --wall-res 0.2` for the export):

```bash
PY=.../blender-venv/bin/python        # pip install bpy==5.2.2
flock /tmp/at3d-blender.lock $PY tools/abyssal-tether-3d/build_mason.py --lab head --out DIR --shots hero,approach --herocam 9,-2,0.6,0,1.8,0,24 --samples 48 --res 1280x720
flock /tmp/at3d-blender.lock $PY tools/abyssal-tether-3d/build_mason.py --grain 0 --out DIR --shots full,silhouette --samples 48 --res 1280x720
flock /tmp/at3d-blender.lock $PY tools/abyssal-tether-3d/build_mason.py --grain 0 --wall-res 0.2 --out DIR --export DIR --shots ""   # kit + hero (~6 min)
node tools/abyssal-tether-3d/wip/creature/check_glb.mjs public/abyssal-tether-3d/assets/models/mason_kit.glb
flock /tmp/at3d-browser.lock node tools/abyssal-tether-3d/wip/creature/harness/verify_kit.cjs --out DIR   # three.js r170 + the real CreatureView
```

Options: `--seed N`, `--samples`, `--res WxH`, `--shots hero,approach,full,silhouette,below,detail`, `--lab head|crown`,
`--grain 0|1`, `--omit ropes,strands,arms,tongue,tether`, `--nobake` (export dry run). `pack_glb.py` runs automatically on
the exported GLBs (it packs `_MASK` / `_OWNER`).

## The Mason rig (WP-CREATURE-RIG)

`build_mason_rig.py` (+ `mason_rig_core.py` kit reader / rest-pose assembly / bone table / skin arrays, `mason_rig_clips.py` the
clips authored in code, `mason_rig_gltf.py` the glTF writer, `mason_rig_preview.py` the Blender contact sheets) turns the rig-ready
kit (`mason_kit.glb` + the leg template of `mason_hero.glb`) into `public/abyssal-tether-3d/assets/models/mason_rig.glb` (8.4 MB raw, 5.6 MB after `compress_glbs.mjs` + `compress_glb_textures.mjs`):
no remodelling, the kit's per-vertex `_OWNER` attribute IS the skin (rigid stone / iron / bone / teeth = 100 % on the owner bone, flesh
= 2 influences by `_SPINE_S`), the kit's two atlases are copied byte for byte (re-encoded JPEG q68 to stay under 8 MB).

```bash
python3 tools/abyssal-tether-3d/build_mason_rig.py                    # numpy + Pillow only, ~6 s: GLB + wip/creature/mason_rig_report.json
flock /tmp/at3d-blender.lock BLENDER_VENV/bin/python tools/abyssal-tether-3d/build_mason_rig.py --out /tmp/x --render tools/abyssal-tether-3d/previews
        # imports the EXPORTED glb into Blender and renders 8 key poses per clip into previews/mason_rig_<clip>.png (<= 2 GB, ~8 min)
node tools/abyssal-tether-3d/tests/render/test-mason-rig.mjs          # structure + clip graph + IK + head fit
```

| | |
|---|---|
| Skeleton | 170 bones: `root`, `neck`, `spine_00..17` (one per sim block, flat under the root: the view writes their world frames), `tail_0/1`, the crown subtree (`crown`, `portal_arch_0..2`, `portal_comb_L0/L1/R0/R1`, `portal_hinge_0/1`, `gullet_0..2`, `pit_0..6`, `arm_0..4_0/1`) and 36 legs: 10 lead (`leg_{L,R}NN_0..3` = IK'd to the sim's planted hooks) + 26 followers (`_0..2`, metachronal wave). `extras.mason` carries P0, the leg chain, leg table, pit directions, clip table (kind, loop, events, phase) |
| Meshes | `Mason_LOD0` 63.4 k tris, `Mason_LOD1` 23.2 k (v2; v1 / skitter_rig: 56.7 k / 20.7 k), one shared skin, 4 primitives (= draw calls) each: MasonCrown, MasonBody (spine) + MasonBody (legs), MasonEmissive. Attributes: `_MASK` (flesh, wet, thickness, class) kept for the shader |
| Clips (30 fps, in place, root never keyed) | base: `crown_idle` `listen` `notice_snap` `rear_windup` (0.75 s, scrubbed over the sim wind-up) `strike` (0.40 s, portal slams at 0.16 s = the sim strike time) `roar_display` `linger_breathe` `take_close`; additive: `recoil` `plate_shiver` `breathe_seams` `portal_snap` `flinch` `retreat_fold`; parametric (time = value x duration): `arms_flare` `pit_dilate` `portal_open`; template `leg_probe` (the view taps the lead legs procedurally on re-plant) |

v2 head: the kit's `Mason_Head` extras carry `pivots` (door, tooth-row, jaw, oral-disc, gullet, arm and eye joints); `mason_rig_core.py` uses them, `meta.headBounds` sizes the head fit (`masonFit.headExtents`). The clips keep v1's names, kinds, durations and events (strike contact 0.16 s) but drive the new anatomy (doors part, jaw drops, discs thrust).

Runtime: `src/render/masonRigView.js` + `src/render/mason/*` (clip graph, pose maths, legs, head fit, material patch); `game.js` loads
the GLB after the kit and swaps views, with the kit `CreatureView` as the automatic fallback (`?mason=kit` forces it).

## The Holdfast (the hand in the wall)

`build_holdfast.py` (Blender 5.2 / `bpy`, procedural, deterministic, seed 4242) builds THE HOLDFAST (`src/sim/holdfast3d.js`,
`src/render/holdfastView.js`, `docs/abyssal-tether-3d/plans/CREATURE_PACING.md`): a grey-pink stone-flesh hand and forearm in a torn
socket of masonry. Every finger has **one knuckle too many** (4 phalanges); slate nails, a wedding band of mortar, extensor tendons of
twisted rope, a split at the wrist showing the fibres, corpse-grey skin with livor in the palm and fingertips, wet.

Pipeline: an anatomy table (joints, radii, the thumb) -> LOW game mesh (finger tubes with ring pairs at every joint, palm, thenar,
forearm, the band and the nails as geometry, the socket crater with a black floor just in front of the wall face) -> HIGH (dense
tubes of the same table, a 0.9 mm voxel union, Laplacian smoothing, subdivision: 2 levels on the hand, 1 on the forearm, ~3.7 M
triangles) + numpy "sculpt" layers (knuckle folds, joint creases, palm lines, Voronoi stone cracks and crazing, veins, rope
tendons, the wrist split, worn tips) and per-vertex albedo / roughness / vein mask -> bake (Cycles: tangent normal, AO, albedo,
roughness + vein mask) at 2048 into one atlas with per-part texel weights (fingers x3, socket x0.22) -> vertex-colour AO (BVH rays)
-> 22 bones (`socket`, `forearm`, `hand`, `index|middle|ring|pinky_1..4`, `thumb_1..3`; finger bones roll so local X is the flex
axis) -> ten clips authored in code (`idle` `stir` `reach` `close` `squeeze` `pull` `release` `retract` `dead` `answer`) -> LOD1
(decimate, ~620 tris, same UVs / weights) and `Holdfast_Dormant` (LOD0 posed by `idle` t=0, static: the instanced far look).

| Output | |
|---|---|
| `public/abyssal-tether-3d/assets/models/holdfast.glb` | `Holdfast_LOD0` (skinned, ~2.3 k tris), `Holdfast_LOD1` (~0.6 k), `Holdfast_Dormant` (static), one material `HoldfastFlesh` (albedo, normal, ORM: R AO, G roughness, B the vein mask; the runtime forces metalness 0), COLOR_0 = AO, ten animations; meshopt + KTX2 (1024 maps) |
| `previews/holdfast_sheet.png` | Cycles contact sheet of the game mesh: dormant, aware, reach, closed on a gauntlet, ruined, the S4 answer, back, palm, macro |

```bash
PY=.../blender-venv/bin/python
flock /tmp/at3d-blender.lock $PY tools/abyssal-tether-3d/build_holdfast.py --out <dir> --renders <dir> [--render] [--bake 2048] [--samples 40]
        # ~10 min + ~5 min of previews; peak ~4 GB (the high is split hand / forearm to stay there); --stage shape = clay renders
GLTF_TOOLS=$TOOLS node tools/abyssal-tether-3d/compress_glbs.mjs --dir <dir> --out <dir2> --only holdfast
GLTF_TOOLS=$TOOLS KTX2_TOOLS=$KTX node tools/abyssal-tether-3d/compress_glb_textures.mjs --dir <dir2> --out public/abyssal-tether-3d/assets/models --only holdfast
node tools/abyssal-tether-3d/tests/creature/holdfast.mjs      # sim rules + the GLB / view budget
```

Runtime: `holdfastView.js` loads the GLB in the background once a run is under way; at most 2 live rigs (AnimationMixer per rig:
the base clip by state, `reach` / `close` scrubbed by the sim's `close`, `squeeze` additive on the beats; then an IK puts the palm on
the held hand with the forearm through the socket's mouth, mirrored for a left hand), the rest one InstancedMesh of the dormant fist.

## Textures

Seamless PBR sets (every map periodic by construction) live in `public/abyssal-tether-3d/assets/textures/` with a
`manifest.json`. Two generations of tooling:

* `build_textures.py` - the original 1024 height-field sculpts (rock strata, ashlar masonry, corroded iron, far rock, sinew).
* `build_textures_hq.py` - the Quest-tier pass (WP-GFX-QUEST-MAT): reuses those sculpts at **2048 px for the hero sets**
  (`rock` 4 m, `masonry` 4 m, `metal` 2 m), adds an extra micro-relief octave, curvature wear (pale arrises, grime in cavities,
  bare-metal edges), wet streaks, low-frequency colour / roughness variation inside the tile, and bakes the new 1024 sets
  `rockFar` (16 m), `flesh` (1.5 m), a shared 512 `detail` micro-normal (0.5 m) and the **decal atlas**
  `decals` (2048 x 1024 RGBA + normal, 4 x 2 cells: two crack types, grime run, moss, blood smear, burn, claw scratches,
  impact). `rubble` and `roots` (`mat_rubble`, `mat_roots`) can be baked on demand (`--sets rubble`) but are not shipped: rubble piles
  reuse the masonry set so they merge into the existing stone draw call.

| Set | Size | Tile | Use |
|---|---|---|---|
| `rock` | 2048 | 4 m | shaft walls, ledges |
| `masonry` | 2048 | 4 m | Lanternwright ashlar: built walls, bridges, the creature's stone |
| `metal` | 2048 | 2 m | corroded iron: girders, bands, grates |
| `rockFar` | 1024 | 16 m | distant structures |
| `flesh` | 1024 | 1.5 m | the creature's exposed tissue |
| `detail` | 512 | 0.5 m | micro normal layered over every macro normal (shader, near only) |
| `decals` | 2048 x 1024 | atlas | instanced-free merged quad decals (one draw call) |

Each set has `albedo` (sRGB), `normal` (OpenGL +Y) and `orm` (R = AO, G = roughness, B = metalness).

**WP-TEX-PBR (2026-10-21)** - `build_textures_art.py` is now the source of the three hero sets (`rock`, `masonry`, `metal`): the calm
layouts plus `enrich_stone` / `enrich_iron` (per-block finish classes, chisel tooth, peck bowls, rock-faced cleavage, spalls, erosion,
hairline cracks, grit joints, damp / lichen in albedo + roughness; iron: dents, blistered rust scale, pitting, scratches, rivet weeps).
Bake: `build_textures_art.py --work W --out OUT --sets rock,masonry,metal`, then
`encode_ktx2.mjs --work W --out OUT --sets rock,masonry,metal` (`--maps orm --orm-size 1024 --orm-rdo 0.8` re-encodes only the ORM; the
2048 ORM costs 4 MB per set, so the shipped ORM stays 1024). Hero KTX2 sizes (MB, albedo / normal / orm): rock 3.84 / 5.38 / 1.24,
masonry 3.90 / 5.39 / 1.21, metal 3.41 / 5.13 / 1.30.

Run (the Blender venv python has numpy + Pillow; ~2.8 GB for a 2048 set, one process at a time):

```bash
PY=.../blender-venv/bin/python
$PY -I tools/abyssal-tether-3d/build_textures_hq.py --work <masters dir> --tilecheck <masters dir>/tilecheck      # all sets (~6 min)
$PY -I tools/abyssal-tether-3d/build_textures_hq.py --work <masters dir> --sets rock,decals                        # some
```

It writes lossless masters to `--work` (PNG; `<set>_normal_h.png` has the **height field in the blue channel**, `_height16.png`
is the same height at 16 bit) and into the game folder only: `manifest.json` (merged) and the **1024 px JPEG fallbacks**
(`<set>_albedo/normal/orm.jpg`, the normal's blue = true z). `--tilecheck` writes 2x2 seam-check sheets.

### GPU compression (KTX2 / Basis Universal)

`encode_ktx2.mjs` turns the masters into `.ktx2` files (full mip chain, bottom-row-first so they match the TextureLoader
orientation) and records them under `"ktx2"` in each manifest entry (`normalHeightInB: true` = blue channel carries height):

| Map | Codec | Notes |
|---|---|---|
| hero albedo (rock, masonry, metal) | UASTC + zstd + RDO 1.5 | 2048; transcodes to ASTC 4x4 (8 bpp) on Quest |
| normals (all sets, B = height) | UASTC + zstd + RDO 0.8 | 2048 for the hero sets, no "normal map mode" (blue is data) |
| ORM | UASTC + zstd + RDO 0.8 | **1024 for the hero sets** (AO / roughness / metal are low frequency), 1024 for the rest |
| other albedo | ETC1S (quality 150) | 1024, ~0.15 MB each |
| decals albedo | ETC1S with alpha slice | 2048 x 1024 |

```bash
mkdir -p $TOOLS && cd $TOOLS && npm init -y && npm i ktx2-encoder@0.6.0 sharp      # once; not shipped
KTX2_TOOLS=$TOOLS node tools/abyssal-tether-3d/encode_ktx2.mjs --work <masters dir> [--sets rock,masonry]
```

(single-threaded WASM: a 2048 UASTC map takes ~100 s; run one process per set side by side.) With Khronos' `toktx`:
`toktx --t2 --encode uastc --uastc_quality 2 --zcmp 19 --genmipmap --assign_oetf srgb out.ktx2 in.png` (`linear` for
normal / ORM; ETC1S: `--encode etc1s --clevel 4 --qlevel 160`; add `--lower_left_maps_to_s0t0` for the bottom-row-first order).

Runtime: `src/render/materials.js` `loadTextureManifest()` uses the vendored `KTX2Loader` + Basis transcoder
(`vendor/three/addons/libs/basis/`, licence notes in `vendor/three/README.txt`) when the manifest entry has `ktx2` and the
browser has Worker + WebAssembly, otherwise (or if any map of a set fails) the JPEG fallbacks load, with no parallax
(the packed height is only used with the KTX2 normals). Memory (ASTC, with mips): a 2048 map = 5.6 MB, a 1024 map = 1.4 MB.

`fetch_polyhaven.py` swaps in CC0 Poly Haven sets (same manifest format) when the network allows
(`polyhaven.com`, `api.polyhaven.com`, `dl.polyhaven.org`); `--list <category>` and `--set name=id` choose assets.

### Geometry compression (EXT_meshopt_compression)

`compress_glbs.mjs` post-processes the five big GLBs (`mason_rig`, `player_arms`, `mason_hero`, `mason_kit`, `player_body`): meshopt
vertex-cache reorder, KHR_mesh_quantization of POSITION (14 bit; the two player GLBs keep float32 positions because
`render/gearSurface.js` reads them in metres), NORMAL / TANGENT (10), TEXCOORD (12), WEIGHTS (8), then EXT_meshopt_compression on every
buffer view (lossless codec, no decoder filters). The custom attributes `_SPINE_S`, `_PART`, `_MASK`, `_OWNER`, JOINTS and COLOR are
never quantized. 26.9 MB -> 18.5 MB (images are untouched here; see the next section). Re-run it after every Blender re-export (the build scripts write
uncompressed GLBs; already-compressed files are skipped):

```bash
mkdir -p $TOOLS && cd $TOOLS && npm init -y && npm i meshoptimizer@0.22.0 @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions   # once; not shipped
GLTF_TOOLS=$TOOLS node tools/abyssal-tether-3d/compress_glbs.mjs [--only mason_rig,player_arms] [--dir D --out D2] [--force]
npm run at3d:sw        # precache list + hashes
```

Runtime: `src/render/glbLoad.js` (`createGLTFLoader` / `loadGLB`) attaches the vendored `MeshoptDecoder`
(`vendor/three/addons/libs/meshopt_decoder.module.js`); the vendored `GLTFLoader` also defaults to it, so loaders created in game.js read the
same files. `tests/render/test-glb-meshopt.mjs` decodes every accessor with that decoder, checks the custom attributes and loads each file
through three's GLTFLoader.

### Texture compression of the GLBs (KHR_texture_basisu / KTX2)

The GLB images used to be 2048 JPEG / WebP, which a browser decodes to RGBA8 (about 22 MB per map with mips, ~230 MB for hands + body +
Mason: Quest tab memory pressure). `compress_glb_textures.mjs` replaces every image of the five GLBs with a KTX2 (Basis Universal, full mips;
KHR_texture_basisu declared required) that is transcoded to ASTC 4x4 on Quest (1 byte / texel: 2048 map = 5.6 MB, 1024 map = 1.4 MB). Sizes:
`player_arms` 2048 albedo / normal / ORM (close up) + 1024 emissive, `player_body` 1024, `mason_*` albedo + normal 1024 (ORM stays 512).
UASTC + zstd for normals / ORM / the hands, ETC1S for body and Mason albedo. Resident total for hands + body + Mason rig is about 27 MB
(was ~230 MB); the GLBs grow from 18.1 to 29.9 MB (the sw precache from 60.4 to 70.6 MB, cap 80). Run it after `compress_glbs.mjs`
(KTX2 images are skipped, so it is idempotent), then `npm run at3d:sw`:

```bash
GLTF_TOOLS=$TOOLS KTX2_TOOLS=$KTX_TOOLS node tools/abyssal-tether-3d/compress_glb_textures.mjs [--only player_arms] [--dir D --out D2]   # ~100 s per 2048 map
```

Runtime: every GLTFLoader that reads these files needs a KTX2Loader: `glbLoad.js` `createGLTFLoader` / `loadGLB` attach it, game.js
(kit + rig loaders) calls `attachKTX2(loader)`, and `Renderer3D` hands the renderer over (`setKTX2Renderer`) for the format detection. The
transcoder workers are ended 4 s after the last GLB finished. A browser without Worker / WebAssembly cannot load these models (the
procedural hands / kit creature fallbacks apply). `tests/render/test-glb-meshopt.mjs` checks the KTX2 images and the resident budget.

## Player arms + tether launchers

`build_hands.py` builds the first-person gloved forearms and the strapped-on grapple launchers in Blender (all from
code, deterministic) and exports `public/abyssal-tether-3d/assets/models/player_arms.glb` (both sides, armatures,
poses, named launcher parts, ≤ 8 MB) plus `previews/hands_*.png` renders. Runtime: `src/render/handsGear.js`
(loader, finger blending, launcher mechanics) driven by `src/render/handsView.js`.

```bash
.venv/bin/python tools/abyssal-tether-3d/build_hands.py --out public/abyssal-tether-3d/assets/models \
    --renders <dir> --render --bake 2048 --samples 40      # ~35 min on 4 cores (bake ~17 min, renders ~15 min)
```

Pipeline: HIGH meshes (voxel-remeshed glove with displaced creases, cracks and stitched seams, canvas sleeve with folds
and a rolled end, launcher with bevels, knurls, wound cable, springs) → LOW game meshes (arm 5.4k + launcher 8.4k tris
per side) → bake normal / AO / material-id / base / detail / edge masks into one 2048² atlas shared by both sides
(mirrored) → numpy compositing per material with curvature-driven edge wear, cavity soot, tarnish and rust →
`arms_albedo` (sRGB), `arms_normal` (OpenGL, MikkTSpace tangents exported), `arms_orm` (R = AO, G = roughness,
B = metalness), `arms_emissive` (1024², lamp / gauge phosphor / lantern glass mask, tinted at runtime). `--cache`
holds the bakes: delete it after geometry changes; `--stage composite` re-composites the look from a cache in seconds.

Nodes (glTF y-up; every side root is in the hand-socket frame: origin = centre of the fist on the handle, −Z = aim,
+Y = up; parent `Arm_L` / `Arm_R` to `input.handSocket(hand)` with an identity transform):

| Node | |
|---|---|
| `Arm_L`, `Arm_R` | side roots |
| `Forearm_X`, `Hand_X`, `{Thumb,Index,Middle,Ring,Pinky}{1,2,3}_X` | 17 skinned bones of `Arm_X_Mesh` (glove + sleeve) |
| `Launcher_X_Mesh` | the launcher, skinned to 6 bones; primitive 2 = the ECG wrist screen (material `Arm_ECG_Screen`, UV 0..1, baseline along the arm toward the hand) |
| `Body_X` (root), `Drum_X`, `Needle_X`, `Slide_X`, `Head_X` (child of Slide), `Trigger_X` | launcher bones |
| `Muzzle_X` | the rope origin (muzzle crown opening) |
| `LanternHook_X` | the lantern's bail point |
| `GrappleHead` | the loose barbed head (origin at its muzzle seat, tip toward −Z) |
| `Lantern`, `Lantern_Socket` | the carried lantern (origin = bail, hangs along −Y; socket = glass core, the light's parent) |
| animations `Open_/Grip_/Trigger_/Point_` + `L/R` | one pose each (frame 0 = bone-local rotations) |

Animated parts (axes in the socket frame, the left side mirrors x; converted to each bone's parent frame at load):
`Drum` +X (+angle = line pays out), `Needle` about the gauge normal (−0.34, 0.80, 0.50), rest = 12 o'clock, dial
−135° … +135° clockwise (0 … 5.5 g, red zone from 80 %), `Trigger` +X (−12° = pulled), `Slide` along −Z (recoil +Z,
14 mm), `Head` scaled to 0 while the line is out.

## Player body (first-person avatar)

`build_body.py` builds the player's own body in Blender (all from code, deterministic) and exports
`public/abyssal-tether-3d/assets/models/player_body.glb` (one skinned mesh, one material, 22 bones, 5 clips) plus
`previews/body_*.png`. Runtime: `src/render/bodyView.js` (setting `showBody`, default on).

```bash
.venv/bin/python tools/abyssal-tether-3d/build_body.py --out public/abyssal-tether-3d/assets/models \
    --renders <dir> --render --samples 40 --res 1280x720     # bake ~10 min, previews ~5 min
```

Pipeline: HIGH meshes (≈290k tris: tubes with cloth folds, rounded strap sections with stitch rows, rivets, laces) -> LOW game
mesh (≈10k tris) -> bake normal / AO / albedo / roughness+metal into one 2048² atlas (procedural materials with edge wear,
cavity dirt and floor mud) -> `body_albedo` (sRGB), `body_normal` (OpenGL), `body_orm` (R = AO, G = roughness, B = metalness),
embedded in the GLB. `--cache` holds the bakes: delete it after geometry changes.

The character faces glTF −Z with the origin on the floor between the feet; eye height 1.62 m, neck base 1.45 m. No head: the neck
is closed by a scarf roll. Bones: `Root, Pelvis, Spine1, Spine2, Neck, Pack, Clavicle_L/R, UpperArm_L/R, Forearm_L/R` (the
forearm is a 10 cm stub that slides into the arms' sleeve opening), `Thigh_L/R, Shin_L/R, Foot_L/R, Toe_L/R, Pouch_L/R`.
Clips (30 fps): `Idle_Stand` 3 s, `Run` 1 s (matches ~3.2 m/s), `Hang_Swing` 2 s, `Fall` 1.5 s, `Land` 0.6 s (once).

## Environment kit (`build_env_kit.py`) and the VR hero props

`build_env_kit.py` (Blender or the `bpy` module, procedural, deterministic, ~2 s without `--render`) writes
`public/abyssal-tether-3d/assets/models/env/ch1_env_kit.glb` (413 KB): modular dressing parts, one mesh each, no UVs (LevelView projects the
shared baked sets in metres), vertex AO in `COLOR_0`, materials named `stone | metal | flesh`. The part table and pivot conventions are
in the script's docstring. WP-GFX-VR-POLISH added three hero parts the eye can linger on from a ledge at 1:1 scale: `ch1_env_geartrain`
(three meshing cogs, bearing blocks, straps, rack bar, chain; ~2.1 k tris), `ch1_env_corbel_hero` (carved corbel head with a dead lantern;
~0.9 k) and `ch1_env_arch_fragment` (crumbling pointed-arch relief with fallen stones; ~0.3 k). LevelView places them in the existing bays
(`_icon`: gear trains replace every other big gear, arch fragments every third saint; the corbel table: every fourth plain corbel on
ledges, at most 6 per section), through the same stone / metal decor lists, so no extra draw call. `--focus a,b --render` renders only the
named parts. Quick part check without the Cycles preview: import the GLB into Blender and render each part with a sun lamp.

```bash
flock /tmp/at3d-blender.lock .../blender-venv/bin/python tools/abyssal-tether-3d/build_env_kit.py [--out DIR]
```

## Props v2 (`build_props_v2.py`): the near-field props rebuilt (MESH_DETAIL_AND_OPTIMIZATION.md)

`build_props_v2.py` (Blender / `bpy`, procedural, deterministic, ~10 s) writes `public/abyssal-tether-3d/assets/models/env/ch1_props_v2.glb`
(0.49 MB after meshopt + quantisation; it does NOT touch `ch1_env_kit.glb`, whose rebuild is not byte-identical: the collider boxes and the
bake inputs would move). Two families:

| Meshes | Used by | Levels / triangles |
|---|---|---|
| `ch1_env_chainlink` (metal, unit pitch, long axis +Y) | `LevelView` decor `chain` (one LOD record per link, `_propRecs`) | `_lod0` 288 / 96 / `_lod2` 36 |
| `ch1_env_lanternwright` (stone) + `_iron` (metal) + `_glow` | `LevelView` decor `statue` (normalised to the decor box) | 9000 / 2600 / 800 and 728 / 420 / 120 |
| `ch1_sd_<template>` (one per scene-detail template: skull, femur, femurBroken, rib, barrel, crateBroken, crateSmash, lantern, bucket, chain4, chain7, pickaxe, hammer, shovel, crowbar, ropeCoil, block) | `render/sceneDetail.js` `addHeroTemplates`: drawn instead of the lean template for the nearest items within `HI_NEAR` | 180-1500 each (`PROP_TRIS`) |

Kit-like parts carry grey AO in `COLOR_0` and no UVs (the engine projects the shared sets); the scene-detail heroes carry the final
linear albedo (AO, cavity grime, edge wear, rust baked in) and UVs already inside their props-atlas cells. The renderer loads the GLB after
the environment kit (`Renderer3D._loadProps`); without it the procedural builders draw everything as before (`?props=0` /
`?propshi=0` force that).

```bash
flock /tmp/at3d-blender.lock .../blender-venv/bin/python tools/abyssal-tether-3d/build_props_v2.py --out DIR [--only skull,barrel] [--stats DIR/stats.json]
GLTF_TOOLS=$TOOLS node tools/abyssal-tether-3d/compress_glbs.mjs --dir DIR --out public/abyssal-tether-3d/assets/models/env --only ch1_props_v2
npm run at3d:sw
```
