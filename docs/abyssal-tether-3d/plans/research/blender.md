# Blender (bpy 5.2.2, headless) → glTF → three.js r170: asset pipeline for the environment and the rigged Mason

Research for ABYSSAL TETHER 3D, written 2026-10-19. Companion to `plans/research/quest.md`, which covers the Quest 3 hardware
and runtime limits. This report does not repeat those limits; it cites them by section ("quest.md §15").

**How this was researched.** Every claim about Blender, the glTF exporter or three.js is marked with how it was checked:

- **[src]** means read in source code on this machine. That covers the glTF exporter inside the bpy wheel
  (`blender-venv/lib/python3.13/site-packages/bpy/5.2/scripts/addons_core/io_scene_gltf2`, add-on version **5.2.40**), the vendored
  three.js r170 (`public/abyssal-tether-3d/vendor/three`), the full `three@0.170.0` npm package (`plans/three-full`) and the npm
  packages named below.
- **[bpy]** means checked by introspecting the live `bpy` 5.2.2 LTS module in small, render-free scripts:
  `plans/scripts/bpy_api_probe{,2,3,4}.py`.
- **[run]** means run here. `ktx2-encoder` was tested in Node by `plans/scripts/ktx2_probe.mjs`, and section areas were
  measured by `plans/scripts/level_area2.mjs`.
- **[web]** means taken from a web source, linked inline and listed at the end. `docs.blender.org`, `registry.khronos.org` and
  `hackmd.io` did not resolve from this sandbox, so where those were needed I used search extracts or the GitHub copy of the
  docs.
- **[derived]** means my own arithmetic or estimate. Each one must be measured before it is relied on.

No Blender renders and no Chromium were run, as instructed.

---

## 0. Bottom line

1. **The toolchain we need is already here, offline, apart from one gap.** bpy 5.2.2 ships Cycles, **OIDN 2.5**, Draco and
   **meshoptimizer** [src: `bpy/lib`], and glTF exporter 5.2.40. The gap is KTX2 encoding.
   - The gltf-transform CLI `uastc`/`etc1s` commands shell out to the native KTX-Software `ktx` CLI, version **4.4.0 or later**
     [src: `@gltf-transform/cli@4.5.1/src/transforms/toktx.ts`].
   - The npm `gltfpack` is a wasm build. Its README says texture compression needs the *native* binary [src].
   - GitHub releases are blocked here (HTTP 403), so neither native binary can be downloaded.
   - **`ktx2-encoder@0.6.0` (npm, pure wasm Basis Universal encoder) works offline in Node** [run]. It produced ETC1S/BasisLZ
     and UASTC+Zstd KTX2 files with correct sRGB/linear transfer flags and full mip chains, at about 1 s for a 256² image.
     **Use it with `@gltf-transform/core` for every texture.**
2. **Pipeline shape:**
   - Blender exports GLB with PNG textures and **no compression**.
   - A Node post-step (`@gltf-transform` + `ktx2-encoder` + `meshoptimizer`) does KTX2, quantization and meshopt.
   - three.js loads the result with `KTX2Loader` + `MeshoptDecoder`, which must be vendored from `three@0.170.0`.
   - Use **gltf-transform, not gltfpack**, for these assets. gltfpack by default drops vertex attributes no material uses,
     unless `-kv` is set. That would strip the lightmap UV (`TEXCOORD_1`) and the creature's `_SPINE_S` attribute. Its UV
     quantization also relies on `KHR_texture_transform`, which a lightmap we bind ourselves would not receive.
   - gltf-transform `quantize()` leaves [0,1] UVs exactly normalized, with no transform [src: `quantize.ts`]. Its `prune()` has
     `keepAttributes`/`keepExtras` switches [src].
3. **Environment "10×" is mostly baked light.**
   - Build sections from modular kit pieces with trim-sheet UV0, then join each section per material.
   - Give each section a second UV map, which the exporter writes as `TEXCOORD_1` and GLTFLoader maps to `uv1` [src].
   - Bake Cycles `DIFFUSE` with `pass_filter={'DIRECT','INDIRECT'}` and `uv_layer="Lightmap"` into a float image.
   - Denoise with OIDN's `RTLightmap` filter (pyoidn 2.5.1 has a manylinux wheel).
   - Encode to sRGB 8-bit in [0, Bmax] ("dLDR", the scheme Unity uses on mobile), then UASTC KTX2.
   - In three: `mat.lightMap = tex; tex.channel = 1; mat.lightMapIntensity = Math.PI * Bmax`. The π factor is verified in the
     r170 shader: irradiance is multiplied by albedo/π.
4. **Measured section areas give realistic lightmap sizes** [run + derived]. At 8 texels/m, sections s1–s6 need ≈ 512–1150 px
   square, s7 ≈ 2100 and s8 ≈ 1460. Allowing ~1.6× for kit relief and 16 texels/m along the play path, the whole game's
   lightmaps come to ≈ 40 MB of compressed VRAM, of which the current section ±1 holds ≤ 27 MB. Bake time is about **1–3 min per
   1024² at 256 spp** on these 4 shared cores, so roughly 30–60 min for the full level at 8 texels/m [derived, measure first].
5. **The Mason's current game export cannot be rigged as is.** `mason2/final/build_r2.py:export_game()` exports a **static,
   posed** mesh: it crawls a curved wall, with 13 legs lifted mid-step and wall rubble and oil trails fused in. It also has:
   - LOD0 = 130 k triangles against the ≤ 70 k Quest budget in quest.md §15.
   - **4 materials**, which means 4 skinned draws per eye.
   - `Coat Weight` set, so it exports `KHR_materials_clearcoat`, which makes three use `MeshPhysicalMaterial`.
   - `export_apply=True`, which disables shape keys.
   - No exported tangents for a baked normal map.
   - 24-sample AO with no denoise.

   Section B2 lists the fixes.
6. **Rig strategy: hybrid.**
   - About 200 deform bones: 27 spine, ~24 crown/maw/gullet/frond, 4 per leg for ~34 legs, a few attachments.
   - Rigid parts get **one bone at weight 1.0, assigned at build time from part ownership**. Do not use Blender's heat-map
     auto-weights, which fail on kitbashed, intersecting geometry.
   - Flesh gets a smooth 2-bone blend computed from the per-vertex `spine_s` coordinate the build already makes.
   - The spine and legs stay **procedural at runtime**: the sim's breadcrumb trail plus analytic leg IK, as `creatureView.js`
     already does. Blender clips drive the crown, maw, gullet and fronds, plus additive "breath/roar" layers. Keep under 255
     joints so `JOINTS_0` stays `u8` [src].
7. **Exporter facts that shape the rig** [src/bpy]:
   - Constraints, IK, Spline IK, drivers, F-curve modifiers and NLA blending are **not exported**. They only survive through
     **sampling**, which is on by default (`export_force_sampling=True`). Bake explicitly anyway.
   - B-Bones and dual-quaternion "Preserve Volume" are lost. glTF only defines linear blend skinning.
   - More than 4 influences are truncated to the top 4 and renormalized. three r170 reads only `JOINTS_0`/`WEIGHTS_0`.
   - `export_apply=True` blocks shape keys.
   - Unassigned actions are not exported. Stash each clip on an NLA track and use `export_animation_mode='ACTIONS'`.
   - Action custom properties become glTF *animation extras*, but **GLTFLoader r170 does not copy them to
     `AnimationClip.userData`**. Read them from `gltf.parser.json.animations[i].extras`.
   - Timeline/pose markers are never exported.
   - `KHR_animation_pointer` (material animation) is not loaded by r170.
8. **Blender 5.x API changes that break older scripts** [bpy]:
   - `Action.fcurves` is gone. Use slots, layers, strips and channelbags; `pose_bone.keyframe_insert()` still works.
   - The compositor is `scene.compositing_node_group` with a `NodeGroupOutput`.
   - `anim_utils.BakeOptions` has no defaults.
   - The bake operator takes `uv_layer=` and `target='VERTEX_COLORS'`.
   - The default view transform is AgX.
9. **Honesty.** On Quest this pipeline buys:
   - Soft baked GI, contact darkening and glow spill on every static surface.
   - ~4× texture resolution at equal VRAM.
   - A 70 k-triangle, ~200-bone creature with baked macro detail.

   Shadows from moving lights, real-time GI and screen-space effects stay desktop-tier (quest.md §0, §13). The baked look can
   be very good, but it is a baked look.

---

## 1. What exists today, and what it means for the plan

| Item | Location | State | Implication |
|---|---|---|---|
| Kit builder | `tools/abyssal-tether-3d/build_mason.py` | ~5 k-tri rigid kit (`Mason_Segment_0..2`, `Mason_Head`, fronds, pits, girder limbs, hook). The runtime assembles 65 instances as rigid bones of one `SkinnedMesh` (`creatureView.js`) | The runtime already writes bone `matrixWorld` from the sim. The new rig keeps that model and adds authored clips |
| Texture sets | `tools/abyssal-tether-3d/build_textures.py`, `fetch_polyhaven.py` | 1024² tileable albedo/normal/ORM sets (rock, masonry, metal, rockFar, flesh), JPEG | Re-bake at 2048², save PNG and convert to KTX2. ORM packing already matches three (R=AO, G=rough, B=metal) |
| Hero creature | `scratchpad/mason2/final/build_r2.py` (r2, 209 KB, still being edited) | 1.75 M tris, 27 vertebrae, **46 legs** (13 lifted), spine 29.5 m, 22 material groups. Per-vertex `spine_s` and `glow` attributes | The approved design. The game build must come from the **same generator** in a rest pose (B2) |
| Game export attempt | `build_r2.py: export_game()` | Rebuilds at game tessellation, merges into 4 atlas materials (StoneIron 2048, FleshWet 2048, ToothBone 1024, Emissive 512), decimates to LOD0/1/2 = 130 k/36 k/9 k, smart-UVs, bakes albedo/rough/normal/AO/emit selected-to-active, exports `mason_hero_lod{0,1,2}.glb` | Good bones of a bake pipeline. Static and posed, with the issues listed in B2 |
| Sim body | `src/sim/creature3d.js` | `SEG = 20` spine points (1.5 m links) and **10 limbs** (`LIMBS` table) | The rig samples the sim's spine polyline at each bone's rest arc length, not at the 20 points. Legs beyond 10 need a cheap gait (B6.4) |
| Level | `src/data/level-data-3d.js` | 8 sections of box solids, `InstancedMesh` per bucket, box-projected world UVs, decor merged per 64 m band | Static solids and decor become baked per-section GLBs. Crumbling ledges, hazards and anchors stay dynamic and are lit by probes |

**Measured section areas** [run: `plans/scripts/level_area2.mjs`]. The figure is inner shaft walls plus non-wall solids, as
boxes. Lightmap sizes assume 70% packing.

| Section | Height | Visible area (boxes) | Square side @ 8 tx/m | Square side @ 16 tx/m |
|---|---|---|---|---|
| s1 Threshold | 48 m | 5 079 m² | 681 px | 1 362 px |
| s2 Long Swing | 50 m | 9 661 m² | 940 | 1 880 |
| s3 Broken Gallery | 40 m | 7 181 m² | 810 | 1 620 |
| s4 Listening Vault | 52 m | 8 835 m² | 899 | 1 798 |
| s5 Gullet Stair | 54 m | 5 956 m² | 738 | 1 476 |
| s6 Two Descents | 80 m | 14 308 m² | 1 144 | 2 288 |
| s7 Hollow Nave | 136 m | 48 924 m² | 2 115 | 4 230 |
| s8 Last Throat | 142 m | 23 300 m² | 1 460 | 2 920 |

Kit relief adds roughly 1.4–1.8× surface area [derived].

---

## 2. Toolchain facts (versions, offline availability)

| Tool | Version | Offline here? | Use | Notes |
|---|---|---|---|---|
| `bpy` | 5.2.2 LTS | yes (`scratchpad/blender-venv`) | modelling, rigging, baking, export | Bundles OIDN 2.5, Embree, meshoptimizer, Draco [src: `bpy/lib`] |
| glTF exporter (`io_scene_gltf2`) | 5.2.40 | yes | GLB export | Meshopt option (`EXT_`/`KHR_meshopt_compression`). Optional gltfpack hook needs a gltfpack path in add-on prefs [src: `exp/export.py:426`] |
| `@gltf-transform/core`/`extensions`/`functions` | 4.5.1 | npm registry | post-process | `meshopt()` wraps `reorder` + `quantize` [src]. `prune({keepAttributes, keepExtras})` [src]. `quantize` skips UVs outside [0,1] [src] |
| `@gltf-transform/cli` | 4.5.1 | npm, but `uastc`/`etc1s` need native `ktx` ≥ 4.4.0 | `inspect`, `validate` only | [src: `toktx.ts` L40, L437] |
| `ktx2-encoder` | 0.6.0 | **yes, verified** [run] | KTX2 ETC1S/UASTC (+HDR) in Node | Needs an `imageDecoder` in Node (use `pngjs`). Its gltf-transform `ktx2()` applies one option set to every texture matching `slots`, so run it once per texture class [src: `dist/gltf-transform/ktx2.js`] |
| `meshoptimizer` | 1.2.x (pinned by gltf-transform CLI 4.5.1) / 1.3.0 | npm | encoder for `meshopt()` | Runtime decoder: `three/examples/jsm/libs/meshopt_decoder.module.js` (in `three@0.170.0`) |
| `gltfpack` (npm) | 1.3.0 | yes, wasm | not recommended here | No texture compression in the npm build. Drops unused attributes unless `-kv`, extras unless `-ke`, named nodes unless `-kn` [src: README, `-h`] |
| `pyoidn` | 2.5.1.0 | PyPI manylinux x86_64 wheel | lightmap denoise | `filter_type="RTLightmap"` on NumPy arrays [web: PyPI] |
| `xatlas` (Python) | 0.0.11 | PyPI cp313 manylinux wheel | optional lightmap charting | Blender's `uv.pack_islands(shape_method='CONCAVE')` is enough to start |
| `pyktx` | 4.4.2 | **no Linux wheel** (sdist needs libktx) | — | Not usable here |
| three.js addons to vendor | r170 | in `plans/three-full/package/examples/jsm` | runtime | `loaders/KTX2Loader.js`, `utils/WorkerPool.js`, `libs/basis/basis_transcoder.{js,wasm}`, `libs/meshopt_decoder.module.js`, `utils/SkeletonUtils.js` (optional) |

**Install (once):**

```bash
# Python side, into the existing Blender venv (pyoidn only needs numpy, already present: numpy 2.5.4)
scratchpad/blender-venv/bin/pip install pyoidn==2.5.1.0
# Node side, in a tools-local folder (not the game's package.json)
npm i @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 \
      meshoptimizer@1.2 ktx2-encoder@0.6.0 pngjs@7.0.0
```

### 2.1 Blender 5.x API changes our scripts must respect [bpy]

| Topic | 5.2 reality | Old code that breaks |
|---|---|---|
| Actions | `Action.fcurves`/`groups` **removed** (5.0). F-curves live in `action.layers[0].strips[0].channelbag(slot).fcurves`. Helpers: `bpy_extras.anim_utils.action_ensure_channelbag_for_slot(action, slot)`, `action_get_channelbag_for_slot` ([5.0 change log](https://docs.blender.org/api/5.0/change_log.html)) | `action.fcurves.new(...)` |
| Keying | `pose_bone.keyframe_insert("rotation_quaternion", frame=f, group=name)` creates the slot, layer and strip automatically. Verified: slot `OBR`, 1 layer, 1 strip, 4 F-curves | — |
| NLA | `track = ad.nla_tracks.new(); track.strips.new(name, start, action)`. `NlaStrip.action_slot` exists | — |
| Baking actions | `anim_utils.bake_action(obj, *, action, frames, bake_options)`. `BakeOptions` has **no defaults**: pass all 12 fields (`only_selected, do_pose, do_object, do_visual_keying, do_constraint_clear, do_parents_clear, do_clean, do_location, do_rotation, do_scale, do_bbone, do_custom_props`) | `bake_action(obj, frame_start, frame_end, ...)` |
| Compositor | `scene.compositing_node_group = bpy.data.node_groups.new(..., "CompositorNodeTree")`, output via `NodeGroupOutput` (as `build_r2.py:setup_compositor` already does) | `scene.use_nodes; scene.node_tree` |
| Bake operator | `bpy.ops.object.bake(type, pass_filter, uv_layer, margin, margin_type={'ADJACENT_FACES','EXTEND'}, target={'IMAGE_TEXTURES','VERTEX_COLORS'}, use_selected_to_active, cage_extrusion, max_ray_distance, cage_object, normal_space, use_clear, ...)` | — |
| UV packing | `uv.pack_islands(rotate, rotate_method='ANY', scale, merge_overlap, margin_method='FRACTION', margin, pin, shape_method='CONCAVE')`. `uv.smart_project(angle_limit, margin_method, rotate_method, island_margin, area_weight, correct_aspect, scale_to_bounds)`. `uv.lightmap_pack` still exists | — |
| Colour | Float images default to `Linear Rec.709`. Scene view transform defaults to **AgX**. "Khronos PBR Neutral sRGB" and "ACES 1.3/2.0 sRGB" are available | `'Linear'` colourspace name |
| Bone collections | `arm.collections.new("DEF").assign(bone)` | bone layers |

---

# Part A — Environment art

## A1. Modular kit design (scriptable rules)

**Grid and pivots:**
- 0.5 m snap, 4 m module. Wall panels are 4×4 m, plus 4×2, 2×4 and 8×8 m (rock).
- Pivot at the bottom-left-back corner, with the face toward the play space at local +Y (Blender), which becomes glTF −Z.
- Name pieces `KIT_<set>_<piece>_<var>`, with `_LOD1` for a cheaper variant (the same convention `creatureView.js` already
  understands).

**Sets for the Underspire** ("inverted cathedral-machine"):

| Set | Pieces | UV0 | Material bucket |
|---|---|---|---|
| Masonry | ashlar wall 4×4 (3 variants + 2 broken), string course, plinth, pilaster/buttress 1×8, lancet window 4×8, ribbed-vault segment, corbel ledge lip 2/4 m, stair flight, rubble pile | **trim sheet** 2048², horizontal strips (courses, mouldings, voussoirs) tiled along u | `masonry` |
| Iron | I-beam 4/8 m, grating 2×2, rivet band, bracket, pipe run, cage frame | trim sheet 2048² | `metal` |
| Rock | shaft rock panel 8×8 (displaced), outcrop, scree | tileable 2048² (rock set), UV by box projection at build | `rock` |
| Growth | "ribs grown through masonry", flesh seams, tendon cables (the predator's work) | tileable flesh set | `flesh` |
| Hero props | statue, Still Lamp, machinery, plaques, gate | **unique** UV0 baked from high-poly, atlased per section (A3) | `props` |

**Collision rule.** Physics and the rope ray-casts stay on the existing boxes.
- On play surfaces, visual relief is **recessed into** the box face by ≤ 0.15 m and protrudes ≤ 0.05 m. That keeps hands, rope
  contact and anchors honest.
- Larger protrusions (buttresses, ribs, corbels) are allowed only where the player cannot touch them, or must become new boxes
  in the level data.

**Trim-sheet texel density.** Strips are authored at **512 px/m**, so a 2048² sheet holds 4 m-long tiles in strips of
0.25–1 m.
- Quest 3 renders ~1680 px across ~104° per eye by default (quest.md §1). That is ≈ 16–18 px/degree, about 1 px ≈ 1 mm at 1 m
  [derived].
- So 512 px/m is pixel-matched at about 2 m, a typical wall distance while swinging. 1024 px/m is matched at arm's reach.
- Arm's-reach surfaces (anchors, ledge lips) get extra density from tiled detail textures, not from bigger unique maps. Panel
  specs are 25 PPD on 2064×2208 panels ([UploadVR](https://uploadvr.com/quest-3-specs),
  [Wikipedia](https://en.wikipedia.org/wiki/Meta_Quest_3)).
- Community norms agree: ~1024 px/m for first-person and higher for close VR
  ([Polycount](https://polycount.com/discussion/comment/2304795)).

## A2. Building a section from level data (recipe)

1. **Dump level data** (Node, ~10 lines). Import `src/data/level-data-3d.js` and write `LEVEL_DATA_3D` (sections, solids,
   decor, lights, anchors) to `build/level.json`. A working example of reading it is `plans/scripts/level_area2.mjs`.
2. **Blender builder** (`tools/abyssal-tether-3d/build_section.py --section s3`):
   - For each solid in the section, classify it as wall, ledge, pillar, bridge or grate.
   - Tile each exposed face with kit panels, choosing variants by `hash(id, face, cell)`.
   - Add trims on exposed edges (string course on top edges, corbel lips under ledges).
   - Skip faces buried in other solids or facing the void outside the shaft.
   - Place decor items as kit/hero pieces.
   - Pieces are linked duplicates (`object.data` shared) while building.
3. **Realize and join.** Make pieces single-user, apply transforms, and `bpy.ops.object.join()` **per material bucket**. A section
   then has ≈ 4–6 meshes: masonry, metal, rock, flesh, props, glow. This is the "merged static mesh" strategy, and the fewest
   draw calls (≈ 5 per section per eye).
   - Instancing kit pieces with a per-instance lightmap scale/offset (Unity's `lightmapScaleOffset` approach) saves memory but
     needs an instanced attribute and an `onBeforeCompile` UV transform.
   - GLTFLoader r170 attaches custom `EXT_mesh_gpu_instancing` attributes as **plain** `BufferAttribute`s, not instanced ones
     [src: `GLTFLoader.js` ~L1790]. So that route needs a sidecar JSON and runtime construction. Keep it for later chapters if
     memory gets tight.
4. **UV0** is already set by the kit pieces (trim/tileable). **UV1** = lightmap (A4).
5. **Emissive and light proxies for the bake.** Convert each `lights[]` entry (lamps, the Still Lamp, far cold sources) to a
   Blender point or spot light.
   - Add small emissive proxies where the runtime draws glows: anchor glyph inlays, plaque phosphor, the gate lamp. The walls
     then receive their spill.
   - Use **no fog volume** in the bake. Fog is a runtime shader effect, and a volume would multiply bake cost.
   - The world colour is black (the abyss), or a very dim cold tint for "far" sections.

## A3. High → low baking: normal, AO, curvature (hero props, trim sheets, creature)

**Trim sheet.**
- Build the high-poly strips procedurally: bevelled ashlar courses with displacement noise, chips, mortar joints, rivets.
- The low-poly is a flat plane with UVs = [0,1]².
- Bake normal, AO and height selected-to-active.

**Hero props.** Each gets a decimated or retopologized low-poly, unique UV0, and the same bakes. Atlas several props per
section into one 2048² image (A9).

```python
# bpy 5.2 — selected-to-active bake helper (pattern already used by build_r2.py:bake_pass)
def bake(sc, low, highs, img, typ, samples=1, extr=0.05, dist=0.25, pass_filter=None, uv=None, clear=True):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for h in highs: h.select_set(True)
    low.select_set(True); bpy.context.view_layer.objects.active = low
    for slot in low.material_slots:               # EVERY material on the low mesh needs the target image node ACTIVE
        nt = slot.material.node_tree
        n = next((x for x in nt.nodes if x.type == "TEX_IMAGE" and x.image == img), None) or nt.nodes.new("ShaderNodeTexImage")
        n.image = img; nt.nodes.active = n
    sc.cycles.samples = samples
    kw = dict(type=typ, use_clear=clear, margin=16, margin_type="ADJACENT_FACES", target="IMAGE_TEXTURES")  # clear=False when atlasing several bakes into one image
    if highs: kw.update(use_selected_to_active=True, cage_extrusion=extr, max_ray_distance=dist)
    if pass_filter: kw["pass_filter"] = pass_filter
    if typ == "NORMAL": kw["normal_space"] = "TANGENT"       # OpenGL +Y: what glTF and three expect
    if uv: kw["uv_layer"] = uv; low.data.uv_layers.active = low.data.uv_layers[uv]   # see note on T48693 below
    bpy.ops.object.bake(**kw)
```

| Map | Bake | Samples | Notes |
|---|---|---|---|
| Base colour | `DIFFUSE`, `pass_filter={'COLOR'}` | 1 | Already used by `export_game` |
| Tangent normal | `NORMAL`, `TANGENT` | 1–4 | **Export tangents** (`export_tangents=True`) so three uses the MikkTSpace frame the bake used. Otherwise r170 derives tangents in the shader and seams appear. r170 enables `vertexTangents` when the geometry has a `tangent` attribute and a normal map [src: `WebGLPrograms.js` L295] |
| AO | `AO` on the low mesh, or selected-to-active from the high mesh | 128–256 | 24 samples (current `export_game`) is visibly noisy. Denoise with pyoidn (`filter_type="RT"`, pass albedo + normal bakes as auxiliaries) |
| Roughness / metal | `ROUGHNESS`; metal = 0/1 per material | 1 | **Pack ORM** (R=AO, G=rough, B=metal) into one image. Feed it through a `Separate Color` node: G → Roughness, B → Metallic, R → the `glTF Material Output` group's `Occlusion` input. The exporter then writes one shared texture for `occlusionTexture` and `metallicRoughnessTexture` ([exporter docs](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst)) |
| Emissive | `EMIT` | 1 | Creature pits, embers, phosphor |
| Curvature | **No Cycles curvature bake type.** Build an emission shader from Geometry → **Pointiness** (Cycles-only, per-vertex, fine on dense high-poly), or the Bevel-normal minus geometry-normal edge mask, then bake `EMIT` selected-to-active | 4–16 | **Authoring input only.** Use it to drive edge wear and grime in the Blender procedural material *before* the final base-colour bake. Do not ship it to Quest; it would be a wasted texture sample |
| Thickness / cavity | AO node with "Inside" enabled → emission → `EMIT` | 16 | Authoring input for flesh subsurface tint and grime |

**Bake settings** ([Blender manual, Render Baking](https://docs.blender.org/manual/en/4.5/render/cycles/baking.html)):
- Selected-to-active casts rays from the low toward the high mesh, controlled by Extrusion / Max Ray Distance (or a cage).
- Avoid hard Edge Split on the low mesh: the cage is built from smooth normals.
- Margin 16 px for 2048² atlases with mips (8 px at 1024²). Island margin in packing ≈ the same in UV units
  (`margin_method='FRACTION'`, `margin = px / res`).
- `export_game`'s `island_margin=0.0015` (3 px at 2048) with a 6 px bake margin will bleed at mip 2 and below.

**Note on `uv_layer`.** An old bug report says `uv_layer=` was ignored and the *active* UV map baked
([T48693](https://developer.blender.org/T48693)). Set the target map as `uv_layers.active` as well; the helper does this. Restore
UV0 as `active` and `active_render` before export. The exporter writes **every** UV map in layer order: `uv_layers[0]` →
`TEXCOORD_0`, `uv_layers[1]` → `TEXCOORD_1` [src: `primitive_extract.py` L110–113].

## A4. Lightmap UVs: creation, texel density, packing

```python
def lightmap_uv(ob, res, pad_px=4, priority=1.0):
    me = ob.data
    if "Lightmap" not in me.uv_layers:
        me.uv_layers.new(name="Lightmap")                 # must be the SECOND layer → TEXCOORD_1 → three 'uv1'
    me.uv_layers.active = me.uv_layers["Lightmap"]
    me.uv_layers[0].active_render = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()                  # uniform texel density over the whole section
    # optional per-object priority: scale this object's islands by sqrt(priority) about their centroid here
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="ANY", scale=True, merge_overlap=False,
                            shape_method="CONCAVE", margin_method="FRACTION", margin=pad_px / res)
    bpy.ops.object.mode_set(mode="OBJECT")
```

- **Do it on the joined section mesh**, or on all section meshes selected together, so one atlas covers the whole section.
  `pack_islands(scale=True)` scales uniformly, so relative densities survive.
- **Density targets** [derived from the section table plus quest.md §10 memory budget]:

| Surface | Lightmap density | Why |
|---|---|---|
| Within ~8 m of the main route (ledges, anchor walls, bridges) | **16 tx/m** (6 cm) | Contact shadows and glow pools read up close |
| Rest of the shaft walls | **8 tx/m** (12.5 cm) | Low-frequency light. The dynamic lantern supplies the sharp detail |
| Colossal far structures, Outer Dark | 2–4 tx/m, or **vertex-colour bake** (`target='VERTEX_COLORS'`) and unlit | As Above Par-adowski did with unlit vertex-colour baking (quest.md §18) |

- **Sizes:** 1024² for s1–s5, 2048² for s6 and s8, and 2× 2048² for s7 (split the nave by height). That is ≈ 40 MB of ASTC for
  the whole game and ≤ 27 MB resident with ±1 sections (UASTC → ASTC 4×4 = 1 B/px, +33% mips) [derived].
- **Padding:** ≥ 4 px at 1024² and 8 px at 2048² keeps mips 0–2 clean. Unity's defaults are 2–4 texel padding, and it warns
  that downscaling needs more ([Unity lightmap UVs](https://docs.unity3d.com/ru/2021.1/Manual/LightingGiUvs-GeneratingLightmappingUVs.html)).
  Alternatively, ship lightmaps with 4 mip levels only.

## A5. Lightmap bake (per section)

```python
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"
sc.cycles.samples = 384                     # dark scenes need more; measure noise at 256/384/512 on a 256² crop first
sc.cycles.use_denoising = False             # the bake path does not run the render denoiser; denoise afterwards
sc.cycles.max_bounces = 6; sc.cycles.diffuse_bounces = 4; sc.cycles.glossy_bounces = 1
sc.cycles.transparent_max_bounces = 4; sc.cycles.volume_bounces = 0
lm = bpy.data.images.new(f"LM_{sec}", res, res, alpha=False, float_buffer=True)   # Linear Rec.709
cov = bpy.data.images.new(f"LMcov_{sec}", res, res, alpha=False, float_buffer=False)
# 1) lighting only: albedo divided out → three multiplies by its own albedo (and by detail textures)
bake(sc, section_obj, [], lm, "DIFFUSE", samples=384, pass_filter={"DIRECT", "INDIRECT"}, uv="Lightmap")
# 2) coverage mask (texels inside islands) for re-dilation after denoising: bake a white emission with margin 0
# 3) optional: AO in the same UV (for occluding the dynamic lantern, A8) — type "AO", 128 samples
lm.filepath_raw = f"{out}/{sec}_lm.exr"; lm.file_format = "OPEN_EXR"; lm.use_half_precision = True; lm.save()
```

- **What the bake contains.** Cycles' diffuse light passes are the factor that multiplies diffuse colour (E/π, outgoing radiance
  per unit albedo). three r170 computes `irradiance += lightMap.rgb * lightMapIntensity` and then
  `indirectDiffuse += irradiance * albedo / π` [src: `lights_fragment_maps.glsl.js`, `lights_physical_pars_fragment.glsl.js`
  L506–508, `bsdfs`]. So **`lightMapIntensity = π`** for a linear lightmap. That matches the three.js r155 note that light-map
  intensities must be multiplied by π once legacy lights are off
  ([three.js forum, r155 lighting](https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733/1)).
- **Calibration (do once).** Put a 50%-grey plane under one Blender point light of known W. Bake it, and also export the light
  through glTF (`export_import_convert_lighting_mode='SPEC'`: cd = W / 4π × 683 [src: `lights.py`, `conversion.py`]).
  - In three, render the plane once with the baked lightmap and once with the exported real-time light.
  - Luminance should match within ~5%. If not, fix the constant before baking 8 sections.
  - Use the same tonemapper on both sides. The game uses `ACESFilmicToneMapping` at exposure 1.2
    [src: `renderer3d.js` L120]. r170 also has `AgXToneMapping`/`NeutralToneMapping`, which match Blender's AgX and Khronos PBR
    Neutral view transforms for lookdev.
- **Static vs dynamic light.** Bake the level's lamps, glows and far sources. Keep the **lantern** dynamic (it moves) and remove
  most of the environment `PointLight` pool. This cuts shader cost (quest.md §14) and replaces hard-edged real-time falloff
  with soft bounce. Flickering lamps cannot flicker if baked. Either keep 1–2 of them dynamic near the player, or bake their
  contribution into a separate channel and modulate it per section at runtime (stretch goal).
- **Time** [derived]. 1 M texels × 256 spp ≈ 270 M samples. At roughly 1.5–3 M samples/s on 4 contended cores, that is
  **1.5–3 min per 1024²** and 6–12 min per 2048². The full level at 8 tx/m is about 30–60 min, and 16 tx/m on the route adds
  ~60%. Measure on a 256² crop before scheduling, and bake sections sequentially with `--threads`.

**Denoise** with OIDN's lightmap-specific filter (added in OIDN 1.1, built for lightmaps;
[80.lv](https://80.lv/articles/intel-ships-open-image-denoise-1-4), [oidnDenoise man page](https://www.mankier.com/1/oidnDenoise),
[pyoidn](https://pypi.org/project/pyoidn/)):

```python
import numpy as np, pyoidn
px = np.empty(res * res * 4, np.float32); lm.pixels.foreach_get(px)
rgb = np.ascontiguousarray(px.reshape(res, res, 4)[..., :3])
den = pyoidn.denoise(rgb, hdr=True, filter_type="RTLightmap")      # no albedo/normal auxiliaries for RTLightmap
# re-dilate: keep denoised texels inside the coverage mask, then grow islands outward ~pad_px iterations (numpy 3x3 fill)
```

Fallback without pyoidn: the compositor `Denoise` node (inputs Image, Albedo, Normal, HDR, Prefilter, Quality [bpy]) fed
from an Image node, rendered through an otherwise empty scene. It uses OIDN's general "RT" filter, not RTLightmap.

## A6. Encoding HDR → LDR for the web

| Scheme | Store | Decode in three r170 | Quest quality | Verdict |
|---|---|---|---|---|
| **dLDR-style scaled sRGB** | `rgb8 = sRGB(clamp(L / Bmax))`, Bmax = 99.9th percentile per section (in the manifest) | **none**: `tex.colorSpace = SRGBColorSpace` (set automatically from the KTX2 DFD) and `lightMapIntensity = π · Bmax` | UASTC→ASTC 4×4 sRGB. The sRGB curve gives fine steps in darks, which matters in a near-black game | **Recommended.** Unity uses dLDR on mobile because RGBM block-compresses badly ([Unity lightmap encoding](https://docs.unity3d.com/Manual/Lightmaps-TechnicalInformation.html)) |
| RGBM (M in alpha, range 6–8) | RGB·M | `onBeforeCompile` on `lights_fragment_maps` | Block artifacts and banding with compression (same Unity page) | Only if a section has huge dynamic range (Still Lamp chamber) |
| UASTC HDR (`ktx2-encoder` `isHDR: true`) | half-float-quality ASTC HDR | `KTX2Loader` r170 uses native ASTC HDR **only if** `getSupportedProfiles()` includes `'hdr'`. Otherwise it transcodes to **uncompressed RGBA half (8 B/px)** [src: `KTX2Loader.js` L159, L720–738] | Unknown on Quest Browser | Probe `WEBGL_compressed_texture_astc.getSupportedProfiles()` on the headset first |
| EXR/HDR via `EXRLoader` | float | native | 8–16 B/px, no compression | Desktop tier only |

**Alpha channel.** Store the section **AO** (from A5 step 3) in A, as RGBA UASTC. A8 uses it to darken the dynamic lantern
light in crevices.

**Orientation.** Blender's `image.pixels` are bottom-up. Write PNGs top-down (`np.flipud`), because glTF UVs have a top-left
origin and the exporter flips V. KTX2 textures load with `flipY = false`, so do **not** set `isYFlip`. If you ever load a
PNG lightmap with `TextureLoader`, set `flipY = false` on it.

## A7. Export and post-process

```python
bpy.ops.export_scene.gltf(filepath=f"{out}/{sec}.glb", export_format="GLB", use_selection=True, export_yup=True,
    export_apply=True,               # environment has no shape keys, so applying modifiers is fine here
    export_texcoords=True, export_normals=True, export_tangents=True, export_attributes=True,
    export_extras=True,              # material/scene custom props → extras (lightmap file, Bmax)
    export_materials="EXPORT", export_image_format="AUTO", export_lights=False, export_cameras=False,
    export_animations=False, export_draco_mesh_compression_enable=False, export_meshopt_compression_enable=False)
```

- Put `{"lightmap": "s3_lm.ktx2", "bmax": 0.42, "channel": 1}` in each material's custom properties. They arrive as
  `material.userData` [src: GLTFLoader `assignExtrasToUserData` L3642].
- **Do not embed the lightmap** as a glTF texture; glTF has no lightmap slot. Hubs and WebGi each invented their own extensions
  ([search summary](https://webgi.xyz/docs/api/classes/Asset_Management.GLTFMaterialsLightMapExtension)). A sidecar KTX2 plus
  extras needs no loader plugin.

**Node post-process** (`tools/abyssal-tether-3d/post.mjs`). This pattern ran successfully with ktx2-encoder in
`plans/scripts/ktx2_probe.mjs`; the gltf-transform half follows the 4.5.1 sources.

```js
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { PNG } from 'pngjs';
const imageDecoder = async (b) => { const p = PNG.sync.read(Buffer.from(b)); return { data: new Uint8Array(p.data), width: p.width, height: p.height }; };
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(process.argv[2]);
const common = { generateMipmap: true, imageDecoder };
await doc.transform(
  prune({ keepAttributes: true, keepExtras: true }),   // keep uv1 (lightmap) and _SPINE_S even though no material uses them
  dedup(),
  // one pass per texture class — ktx2() applies the same options to every texture it matches
  ktx2({ ...common, slots: /baseColor|emissive/, isUASTC: false, qualityLevel: 192, isPerceptual: true, isSetKTX2SRGBTransferFunc: true }),
  ktx2({ ...common, slots: /normal/, isUASTC: true, isNormalMap: true, needSupercompression: true, uastcLDRQualityLevel: 2, isPerceptual: false, isSetKTX2SRGBTransferFunc: false }),
  ktx2({ ...common, slots: /occlusion|metallicRoughness/, isUASTC: true, needSupercompression: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeTexcoord: 14, quantizeNormal: 10 }),
);
await io.write(process.argv[3], doc);
// lightmaps (not referenced by the glTF): encodeToKTX2(png, { ...common, isUASTC: true, needSupercompression: true,
//   isPerceptual: true, isSetKTX2SRGBTransferFunc: true }) → s3_lm.ktx2
```

- **Hero/creature albedo:** UASTC. **Bulk rock albedo/ORM:** ETC1S. That follows the policy in quest.md §9.
- Verified outputs [run]: ETC1S → colour model 163, BasisLZ. UASTC → model 166, Zstd. sRGB transfer = 2, linear = 1. 9 mip
  levels for 256².
- Encode time is about 0.8–1.2 s per 256². Expect ~20–60 s per 2048² UASTC map single-threaded [derived].
- Validate with `npx gltf-transform validate out.glb` (gltf-validator is pure JS; no `ktx` needed).

## A8. Loading in three.js r170

```js
import { KTX2Loader } from './vendor/three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from './vendor/three/addons/libs/meshopt_decoder.module.js';
const ktx2 = new KTX2Loader().setTranscoderPath('vendor/three/addons/libs/basis/').detectSupport(renderer);
gltfLoader.setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);   // GLTFLoader L270/L277; EXT_meshopt only in r170
const gltf = await gltfLoader.loadAsync(`assets/sections/${id}.glb`);
gltf.scene.traverse((o) => {
  if (!o.isMesh || !o.material.userData.lightmap) return;
  const m = o.material, ud = m.userData;
  ktx2.loadAsync(`assets/sections/${ud.lightmap}`).then((t) => {
    t.channel = 1;                                   // uv1 ← TEXCOORD_1 (GLTFLoader ATTRIBUTES L2228)
    m.lightMap = t; m.lightMapIntensity = Math.PI * ud.bmax; m.needsUpdate = true;
  });
});
```

- Use the **r170 meshopt extension name.** r170's GLTFLoader understands `EXT_meshopt_compression` but **not**
  `KHR_meshopt_compression`, which first appears in our copies at 0.186.1 [src]. Keep Blender's default `EXT_` if you ever use
  the in-exporter meshopt option.
- **AO interplay.** `aoMap` multiplies *all* indirect diffuse, **including the lightmap** [src: `aomap_fragment.glsl.js` L5–7].
  The bake already contains occlusion, so drop the tileable ORM's AO to `aoMapIntensity ≈ 0.3–0.5` (micro-cavity only) on
  lightmapped materials. Otherwise crevices are darkened twice.
- **Lantern occlusion trick** (cheap, big win). The lantern is the only strong real-time light, and it has no shadows (quest.md
  §13). In `onBeforeCompile`, after `lights_fragment_end`, multiply `reflectedLight.directDiffuse` (and `directSpecular`) by
  `mix(1.0, lmAO, k)`, where `lmAO = texture2D(lightMap, vLightMapUv).a` and k ≈ 0.6–0.8. This adds no texture sample, because
  the lightmap is already fetched. Crevices stop glowing under the lantern.
- **Dynamic objects** (creature, hands, rope, crumbling ledges, anchors) receive no lightmap. Use a baked **SH probe grid**:
  - In Blender, render a 64×32 equirect panorama with Cycles at each probe point (every ~4 m along the route, 64–128 spp; tiny
    renders, to be scheduled when the CPUs are free).
  - Project each panorama to 9 SH coefficients in NumPy and write `probes.json`.
  - At runtime, keep **one** `THREE.LightProbe` and interpolate its SH from the 8 nearest probes around the creature or player
    each frame. A light probe adds to irradiance in every standard material at negligible cost.
- Per-pixel samples on a lit wall: albedo + normal + ORM + lightmap = 4 (+1 detail). That is within quest.md §19's ≤ 6.

## A9. LODs, HLOD and texture atlasing

- **Section LOD.** Static geometry is mostly within fog range, so LOD is per 64 m band, as `levelView` already does.
  - **LOD1** = `Decimate` with `decimate_type='DISSOLVE'` (planar), `angle_limit` 5°, `delimit={'UV','SEAM','MATERIAL'}`
    [bpy: `DecimateModifier.delimit`]. Mark lightmap island borders as seams first, because the UV delimit may only look at
    one UV map (unverified). LOD1 then keeps island borders and reuses LOD0's lightmap. If texels swim, give LOD1 its own
    small bake.
  - Do not use COLLAPSE on lightmapped meshes; it smears UV borders.
- **Far HLOD for the Outer Dark and colossal silhouettes.** Bake `COMBINED` (albedo × light) to the far mesh's own UV, or to
  vertex colours, and render it **unlit** (`MeshBasicMaterial`, 1 sample, no lighting cost). Fog caps it anyway.
- **Atlasing unique props.**
  - Join a section's hero props, `average_islands_scale`, and `pack_islands` into a shared UV0.
  - Bake each prop's high-poly into the shared images. Only the first pass uses `use_clear=True`; later passes write into the
    same images.
  - The result is one `props` material per section.
- **Trim sheets and tileables** are shared by every section, so they are loaded once per chapter.

## A10. Per-section budget after the overhaul [derived, checked against quest.md §19]

| Item | Quest 3 (72 Hz) | Desktop high tier |
|---|---|---|
| Static draws per visible section | ≤ 6 merged meshes (×2 eyes without multiview) | same + shadow pass |
| Static triangles in view | 150–300 k (×10 today's ~20 k) | 1–2 M |
| Lightmaps resident | ≤ 27 MB (UASTC) | EXR/half allowed |
| Material maps | trim/tileable 2048² KTX2 (UASTC normals, ETC1S bulk) | same, plus 4 K detail |
| Dynamic lights | lantern + ≤ 2 | 6–8 + shadows |

---

# Part B — The rigged Mason

## B1. Strategy: what Blender authors and what the runtime drives

| Layer | Driven by | Why |
|---|---|---|
| Spine (27 bones), root | **Runtime**: sim breadcrumb trail, sampled at each bone's rest arc length `s` (stored as bone extras) | Locomotion is path-following and emergent (clings to walls, retracts, lunges). Clips cannot express it |
| Legs (~34 × 4 bones) | **Runtime**: analytic 2-bone IK (as now) for planted legs, plus a metachronal wave gait for the rest (B6.4) | Feet must land on real geometry |
| Crown root, maw petals, gullet rings, fronds | **Blender clips** (override layer), with runtime aiming of the crown toward `body.focus` | Hand-shaped timing: roar, strike, listen |
| Breathing / heave on the first ~6 spine bones | **Blender additive clip**, composed onto the procedural pose (B9) | Adds life on top of the procedural spine |
| Seam pulse, pit flare, frond curl, saliva sway, plate jitter | **Vertex shader** (`_SPINE_S`, per-bone data texture), as `creatureView` does today | No bones, and runs for free on the GPU |

Locomotion reference. Real centipedes move with a **retrograde metachronal wave**: the swing phase travels front to back
([Frontiers in Neural Circuits 2021](https://www.frontiersin.org/journals/neural-circuits/articles/10.3389/fncir.2021.706064/pdf)).
Body undulation leads the leg wave by ≈ 2.5 rad at speed ([APS 2020 abstract](https://archive.aps.org/mar/2020/u22/3)).
- Copying that *motion law* on our masonry-and-iron design makes it read as alive and wrong, without borrowing any existing
  game creature.
- Keep the maw as a **radial iris** (petals rotating outward around the crown axis, like a rose window splitting). It must never
  move as lateral pincers, which is the bug/mandible read the design brief forbids.

## B2. A rest-pose game build from `build_r2.py` (required changes)

| Issue in current `export_game()` | Fix |
|---|---|
| Mesh is **posed** (curved wall path, lifted legs) and has wall dressing fused in: rubble collars, oil trails, grit, wall cracks | Add `--rest`. `spine_pos(s) = (0, -s, 0)`, frame T = −Y (tailward), D = +Z (dorsal), S = +X. Legs use a canonical neutral pose: knee pier up, grapnel at a ground plane ≈ 1.6 m below the belly, not lifted. Wall dressing functions **still draw their random numbers but emit nothing**, so the sequential RNG keeps every other part identical to the approved design (the docstring warns that changing anything reshuffles everything after it) |
| LOD0 130 k / LOD1 36 k / LOD2 9 k | Quest: **≤ 70 k / 20 k / 6 k** (quest.md §15). Keep 130 k as the desktop-tier LOD0 |
| 4 atlas materials → 4 skinned draws per eye | **2 materials**: (a) crown + neck (unique 2048² atlas: albedo, normal, ORM, emissive); (b) body + legs (2048² atlas). Emissive folds into both as `emissiveMap`. Ember/Pit stay in the atlas, not their own material |
| `Coat Weight` on FleshWet/ToothBone → `KHR_materials_clearcoat` → `MeshPhysicalMaterial` [src: GLTFLoader L750–761] | Remove it. Fake wetness with low roughness plus a cheap rim term in the existing custom shader |
| `export_apply=True` | Apply modifiers in the build (meshes are final data). Export with `export_apply=False` so shape keys stay possible |
| No tangents exported for a baked normal map | `export_tangents=True` |
| AO 24 spp, no denoise, `island_margin=0.0015`, bake margin 6 | AO 128–256 spp + OIDN `RT` (albedo + normal auxiliaries), island margin 8 px / res, bake margin 16 |
| Unique UVs for 46 legs spread texel density thin: ≈ 850 m² of surface in 2 × 2048² ≈ **80–110 px/m** [derived] | **Overlap leg UVs.** Build legs from ~4 base variants (size and kind still vary per instance) that share UV islands, which frees ~40% of the body atlas. Crown gets its own 2048² at ≈ 220 px/m [derived]. Add micro detail with the existing tileable masonry/metal/flesh sets as a UV-based detail layer (1 sample via a texture array indexed by material class, instead of today's triplanar 3 samples) |
| `export_attributes=True` with `_SPINE_S` | Keep it. Also keep `prune({keepAttributes: true})`. GLTFLoader lowercases custom names, so the attribute arrives as `_spine_s` [src: GLTFLoader L4686] |

## B3. Armature layout

**Rest pose:**
- Head at the origin facing +Y (Blender), body along −Y, dorsal +Z. That exports to glTF +Y up with the head facing −Z,
  three's forward.
- Every bone has **unit scale**. Taper (`kprof`) lives in the mesh, never in bone scale. Non-uniform scale under rotation is not
  decomposable to glTF TRS; `export_hierarchy_flatten_bones` exists only as a workaround for that.

| Group | Bones | Hierarchy | Extras (bone custom props → glTF node extras [src: `joints.py` L108–110]) |
|---|---|---|---|
| `root` | 1 | — | — |
| `neck`, `spine_00 … spine_26` | 28 | chain from `root`, `use_connect` | `{"s": 1.95, "k": 0.86}` = rest arc length, girth |
| `tail_0`, `tail_1` | 2 | from `spine_26` | `s` |
| `crown` | 1 | from `neck` | — |
| `maw_{n,e,s,w}_{0,1}` | 8 | from `crown` (petal hinge → tip) | `{"axis": "radial"}` |
| `gullet_0..2` | 3 | from `crown`, leaf bones (non-uniform scale allowed only on leaves) | — |
| `frond_00..11` | 12 | from `crown` (1 bone each; curl stays in the vertex shader) | `{"phase": …, "len": …}` |
| `leg_{L,R}{nn}_{0..3}` | 4 per leg: `_0` femur (flying-buttress strut + knee pier), `_1` shank, `_2` iron metatarsus (bent back), `_3` grapnel | from the owning `spine_k` | `{"side": -1, "slot": 7, "reach": 6.8, "kind": "normal|reach|broken|lifted"}` |
| `cage`, `lantern`, `chain_{0..3}_{0,1}` | ~10 | from owning spine bone | — |
| **Total** | **≈ 200 with 34 legs; ≈ 250 with all 46** | | |

- **Keep deform bones ≤ 255.** The exporter writes `JOINTS_0` as `u8` when the maximum joint index is under 256, otherwise
  `u16` [src: `primitive_attributes.py`]. The ≤ 256-bone runtime budget (quest.md §15) lands in the same place.
- **Recommended leg count for the game build: 30–34**, about 15–17 per side, including the two forelegs that rear beside the
  crown.
  - The hero render can keep 46.
  - Every leg must be driven every frame, and beyond ~34 the extra legs add CPU, bones and triangles for little added read in
    fog.
- **Bone collections:** `DEF` (exported) and `CTL` (authoring only, `use_deform=False`), with `export_def_bones=True`. Since
  2022 the exporter keeps non-deform bones only when objects are parented to them
  ([commit](https://developer.blender.org/rBA807a64cdfc50de1cfb263f2eb68680feddb66ec7)) [src: `tree.py` L731].

```python
def build_rig(coll, vert_s, legs, crown_c):
    arm = bpy.data.armatures.new("MasonRig"); rig = bpy.data.objects.new("MasonRig", arm); coll.objects.link(rig)
    bpy.context.view_layer.objects.active = rig; rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT"); eb = arm.edit_bones
    root = eb.new("root"); root.head, root.tail = (0, 0, 0), (0, 0, 0.5)
    prev = root
    for k, s in enumerate(vert_s):
        b = eb.new(f"spine_{k:02d}")
        s1 = vert_s[k + 1] if k + 1 < len(vert_s) else s + 1.0
        b.head, b.tail = (0, -s, 0), (0, -s1, 0)
        b.align_roll(Vector((0, 0, 1)))                    # local Z = dorsal, explicit
        b.parent = prev; b.use_connect = k > 0; prev = b
    for L in legs:                                      # joints from the rest-pose leg builder
        parent = eb[f"spine_{L['vert']:02d}"]
        for j, (h, t) in enumerate(L["joints"]):        # femur, shank, metatarsus, grapnel
            b = eb.new(f"leg_{L['name']}_{j}"); b.head, b.tail = h, t
            b.align_roll(Vector(L["plane_normal"])); b.parent = parent; b.use_connect = j > 0; parent = b
    # crown / maw / gullet / fronds likewise …
    bpy.ops.object.mode_set(mode="OBJECT")
    for k, s in enumerate(vert_s):
        arm.bones[f"spine_{k:02d}"]["s"] = float(s)        # → node extras → bone.userData.s in three
    return rig
```

## B4. Skinning: rigid where hard, smooth where flesh, never auto-weights

**Record ownership at build time.**
- Add an owner context to the `Acc` accumulator: `with owner("spine_07"): build_vertebra(...)`, and
  `with owner("leg_L07_1"): …` for each leg segment.
- Every `add()` / `add_tube()` call stamps a per-vertex `bone` index and an optional `(bone2, w2)` pair.
- The generator already knows which vertebra, leg segment or petal each stone, girder or tooth belongs to.
- Blender's `ARMATURE_AUTO` (bone heat) needs watertight, non-intersecting meshes. It is the wrong tool for kitbashed masonry,
  and the outcome would not be deterministic.

| Part | Weights |
|---|---|
| Vertebra stones, iron bands, carved glyphs, seams, skyline set pieces, rebar, pierce hooks | owner `spine_k` = **1.0** |
| Discs, marrow, flesh and tendons spanning vertebrae | `spine_k` / `spine_{k+1}` from **`spine_s`**: `t = smoothstep((s − s_k)/(s_{k+1} − s_k))` |
| Leg strut voussoirs + knee pier | `leg_x_0` = 1.0 |
| Flesh tube along the strut | blend `spine_k` → `leg_x_0` over the first 20% of the strut arc (arc parameter recorded at build) |
| Shank / metatarsus / grapnel | `leg_x_1` / `_2` / `_3` = 1.0. 2-bone blend only across a 10 cm band at the joints, if a flesh wrap exists |
| Crown voussoirs, oculi, listening pits | `crown` = 1.0 |
| Maw petal stones and teeth | `maw_d_0` or `_1` = 1.0 |
| Gum/flesh between petals | 2–3 nearest petal bones by angle, plus `crown` |
| Gullet rings | `gullet_j` by depth, smooth (2 bones) |
| Fronds | `frond_nn` = 1.0 (curl in the vertex shader along the bone axis) |
| Saliva strands, hanging chains | owner bone 1.0, plus a per-vertex `_SWAY` attribute for the vertex shader |

```python
def write_weights(ob, bone_names, g1, w1, g2, w2):      # numpy arrays, one entry per mesh vertex
    ob.vertex_groups.clear()
    for n in bone_names: ob.vertex_groups.new(name=n)    # group index == bone index
    bm = bmesh.new(); bm.from_mesh(ob.data)
    dl = bm.verts.layers.deform.verify()
    for v in bm.verts:
        i = v.index; d = v[dl]
        d[int(g1[i])] = float(w1[i])
        if w2[i] > 0.0: d[int(g2[i])] = float(w2[i])
    bm.to_mesh(ob.data); bm.free()
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)     # safety net (we write ≤ 3)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    ob.parent = rig; ob.matrix_parent_inverse.identity()                           # skinned node transform must be identity
    mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = rig; mod.use_deform_preserve_volume = False
```

- **Influences.** glTF stores weights in sets of 4. The exporter keeps the 4 highest and renormalizes, with a warning
  [src: `primitive_attributes.py` L68–135, `primitive_extract.py` L1560+]. three r170 maps only `JOINTS_0`/`WEIGHTS_0` to
  `skinIndex`/`skinWeight` and normalizes on load [src: GLTFLoader L2232–2233, L3801]. **Author ≤ 4**; we write ≤ 3.
- **Linear blend only.** `use_deform_preserve_volume` (dual quaternion) is not representable in glTF. Avoid candy-wrapping on
  twisting flesh with an extra twist bone, or by keeping twist on rigid parts.
- **LODs.**
  - Apply weights on LOD0 *before* decimating; the Decimate modifier is expected to interpolate vertex groups (verify on the
    first LOD). Then run limit + normalize again.
  - Rigid stones are separate islands, so COLLAPSE never welds two rigid parts together.
  - LOD1/2 meshes are parented to the **same** rig with their own Armature modifier. They export as several skinned meshes
    sharing one joint list, and three shows one at a time.

## B5. Optional control rig for authoring (bake before export)

For hand-authored set-piece clips (the "emerges from the vault wall" scripted sighting), build a control rig in the CTL
collection:
- **Spline IK** on the spine, following a curve.
- IK legs to target empties.
- Damped Track on the crown toward a "player" empty.

Then **bake to the DEF bones** and delete the constraints:

```python
from bpy_extras import anim_utils as au
opts = au.BakeOptions(only_selected=False, do_pose=True, do_object=False, do_visual_keying=True,
                      do_constraint_clear=True, do_parents_clear=False, do_clean=True,
                      do_location=True, do_rotation=True, do_scale=False, do_bbone=False, do_custom_props=False)
au.bake_action(rig, action=bpy.data.actions["emerge"], frames=range(1, 241), bake_options=opts)
```

- Even with `export_force_sampling=True` [src default], which evaluates the depsgraph per frame
  [src: `sampling_cache.py` L50], bake explicitly. Constraints whose targets are *other objects* with their own actions sample
  inconsistently in `ACTIONS` mode. The exporter manual's advice: "Do not sample animation can lead to wrong animation export"
  ([exporter docs](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst)).
- **Spline IK + stretch bakes badly.** Bone Y-scale compounds down the chain
  ([Blender Artists](https://blenderartists.org/t/spline-ik-bake-and-export-problem/700647),
  [#52063](https://projects.blender.org/blender/blender/issues/52063)). Set `y_scale_mode='NONE'` (or `FIT_CURVE` without
  stretch) and `inherit_scale='NONE'` on the chain. Or use the documented workaround: an unparented deform chain with Copy
  Transforms from the control chain.
- **B-Bones are lost on export** ([three.js forum](https://discourse.threejs.org/t/load-glf-to-display-animations-with-bendy-bone-exported-by-blender/14199),
  [BlenderNation](https://www.blendernation.com/2021/10/25/convert-bendy-bones-to-standard-bones/)). Keep `bbone_segments = 1`
  on DEF bones.

## B6. Clips

### B6.1 Clip list (authored at 30 fps, in place)

| Clip | Length | Type | Bones keyed | Events (action custom prop `events`, JSON) |
|---|---|---|---|---|
| `idle_breathe` | 4 s loop | additive | `neck`, `spine_00..05` (heave), `gullet_*`, `maw_*_0` (flex), `frond_*` | — |
| `listen` | 3 s loop | override | `crown` (tilt sequence), `frond_*` tremble, `maw_*` closed tight | `pulse@0.4,1.6,2.4` (pit flare) |
| `roar` | 2.5 s | override + additive (neck rear) | `crown`, `maw_*` (full iris open with 10% overshoot), `gullet_*` expand, `frond_*` flare, `neck/spine_00..03` rear | `open@0.55`, `peak@1.1` (audio sync) |
| `strike` | 1.2 s | override + additive | wind-up rear → snap. Maw opens at 60% and slams shut on `contact` | `contact@0.78` (sim lunge timing must match) |
| `flinch` | 0.6 s | additive | crown recoil, maw clench | — |
| `retreat` | 1.5 s | additive | neck pull-back, fronds fold | — |
| `death_or_sealed` (finale) | 4 s | override | crown, maw, fronds collapse | `still@3.2` |

**Root motion policy.**
- Clips never key `root` translation. The sim owns world motion, and the strike distance is the sim's lunge.
- Cinematic set pieces with root motion get their own clips, played with the rig parked at a scene anchor.
- Strip any stray root tracks at load: `clip.tracks = clip.tracks.filter(t => !t.name.startsWith('root.'))`.

**Animation principles in code.** Headless keying produces mechanical motion unless the generator builds in:
- anticipation (the wind-up),
- overshoot and settle on the maw,
- follow-through by phase-offsetting each petal and frond by 2–4 frames,
- ease curves (Bezier keys with auto-clamped handles).

F-curve `NOISE` modifiers are fine for tremble; sampling bakes them [src]. A human pass in the Blender UI on `roar` and
`strike` would still be worth paying for.

### B6.2 Authoring and stashing (bpy 5.2, verified pattern [bpy])

```python
def new_clip(rig, name, f0, f1, loop=False, events=None, additive=False):
    for pb in rig.pose.bones: pb.matrix_basis = Matrix.Identity(4)  # reset pose between clips (assign; don't mutate a copy)
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    act.use_frame_range = True; act.frame_start, act.frame_end = f0, f1; act.use_cyclic = loop
    act["loop"] = int(loop); act["additive"] = int(additive)
    if events: act["events"] = json.dumps(events)                   # → glTF animations[i].extras
    return act

def key_rot(rig, bone, frame, quat):
    pb = rig.pose.bones[bone]; pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = quat
    pb.keyframe_insert("rotation_quaternion", frame=frame, group=bone)   # creates slot/layer/strip in 5.x

def stash(rig, act):
    tr = rig.animation_data.nla_tracks.new(); tr.name = act.name
    tr.strips.new(act.name, int(act.frame_start), act); tr.mute = True
    rig.animation_data.action = None
```

- **Loops:** key frame N equal to frame 0. three wraps from N back to 0 without a hitch.
- **`scene.render.fps = 30`.**

### B6.3 Export settings for the rig (every option checked against the 5.2.40 source)

```python
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
    export_apply=False, export_texcoords=True, export_normals=True, export_tangents=True,
    export_attributes=True, export_extras=True, export_materials="EXPORT", export_image_format="AUTO",
    export_skins=True, export_def_bones=True, export_influence_nb=4, export_all_influences=False,
    export_rest_position_armature=True, export_leaf_bone=False, export_hierarchy_flatten_bones=False,
    export_animations=True, export_animation_mode="ACTIONS",   # every active/stashed action → its own glTF animation
    export_merge_animation="ACTION",                           # merge by action name: same-named rig + shape-key actions → one clip
    export_force_sampling=True, export_frame_step=1, export_anim_slide_to_zero=True,
    export_optimize_animation_size=True, export_reset_pose_bones=True, export_bake_animation=False,
    export_morph=True, export_morph_normal=False, export_morph_animation=True,
    export_lights=False, export_cameras=False,
    export_draco_mesh_compression_enable=False, export_meshopt_compression_enable=False)
```

Defaults confirmed in source:
- `export_animation_mode='ACTIONS'`, `export_force_sampling=True`, `export_reset_pose_bones=True`,
  `export_rest_position_armature=True`, `export_optimize_animation_size=True`.
- `export_def_bones=False`, `export_leaf_bone=False`, `export_tangents=False`, `export_attributes=False`.
- `export_merge_animation='ACTION'`, `export_morph_normal=True`.

Override the non-defaults explicitly, as above. "Unassociated actions are not exported" (exporter docs), which is why every
clip is stashed.

Post-process with the same `post.mjs`. Add `keepExtras` (already set) and leave animations alone. gltf-transform `meshopt()`
compresses animation samplers too.

### B6.4 Legs beyond the sim's 10

- `creature3d.js` `LIMBS` has 10 entries with plant/step logic. Extend it to all ~32 legs, but give **only the ~10 front legs
  full foothold search**.
- The rest run a **retrograde metachronal wave**: phase = `φ0 − 2π·i/λ + ω·t`, with ω scaled by crawl speed.
  - Each foot target is a cheap ray-free projection onto the body's clinging surface normal: the `body.up` the sim already
    keeps per spine point.
  - Lift height comes from a swing curve.
  - IK is the same analytic 2-bone (femur + shank) solve, with the metatarsus held at a fixed back-bend and the grapnel
    oriented to the surface.
- Cost [derived]: 32 analytic solves ≈ 0.05–0.1 ms in JS. That is within quest.md §15's ≤ 1 ms creature-sim budget.

## B7. Shape keys (morph targets)

- **Export:** `export_morph=True`. `export_morph_normal=False` saves memory unless the shape changes lighting a lot.
  `export_try_sparse_sk=True` is the default; it shrinks the *file*, not VRAM. Shape keys and `export_apply=True` are mutually
  exclusive [src tooltip].
- **three r170 cost.** Morphs live in a float `DataArrayTexture` of `vertexCount × targets` vec4s (×2 with normals)
  [src: `WebGLMorphtargets.js`] **for the whole primitive**, plus a per-vertex loop in the vertex shader.
  - 40 k verts × 3 targets ≈ 1.9 MB and 3 extra texel fetches per vertex per eye [derived].
- **Recommendation for Quest: no morph targets on the main body.**
  - Gullet peristalsis uses `gullet_*` leaf-bone scale.
  - Pit membranes and frond curl use the vertex shader.
  - If a morph is ever worth it (wet maw lips), give it its own small mesh, which costs one extra skinned draw.
- If you do use one, name its shape-key action exactly like the rig clip (for example `roar`), so `export_merge_animation='ACTION'`
  makes one glTF animation. Shape-key drivers export only when the mesh is a direct child of the armature (exporter docs).

## B8. What the Blender 5.2 glTF exporter drops or changes

| Blender feature | In the GLB | What to do |
|---|---|---|
| IK, Spline IK, Copy/Damped Track, Child Of, any constraint | not exported. Resolved only through sampled keys | Bake to DEF bones (B5). Keep constraint targets inside the rig |
| Drivers on bones | sampled | Bake |
| Drivers on shape keys | exported only if the mesh is a direct child of the armature | Parent mesh → rig |
| F-curve modifiers (Noise, Cycles), NLA strip blending, extrapolation | sampled per action. Cross-track NLA blending is not merged (except `SCENE` mode) | One action per clip |
| Timeline / pose markers | **dropped** | Action custom props → animation extras, read via `gltf.parser.json` |
| Action custom props | animation `extras` [src: `action.py` L1011] | GLTFLoader r170 **does not** copy them to `clip.userData` [src] |
| Bone custom props | node `extras` (from `bone`, not `pose_bone`) [src: `joints.py` L110] | `bone.userData` in three |
| B-Bones | lost | `bbone_segments = 1` |
| Preserve Volume (dual quaternion) | lost (LBS only) | Twist bones |
| Bone envelopes | ignored (vertex groups only) | — |
| Non-uniform scale under rotation | non-decomposable → wrong | Unit-scale bones, leaf-only scale |
| > 4 weights | top 4, renormalized; three reads `JOINTS_0` only | Author ≤ 4 |
| Non-deform bones | exported unless `export_def_bones=True` | Use DEF/CTL collections |
| Modifiers | applied only with `export_apply=True`, which **blocks shape keys** | Apply in the build script |
| Skinned mesh node transform | ignored by glTF semantics | Identity under the rig |
| Procedural shader nodes (Noise, Voronoi, AO, Pointiness, Bevel) | dropped | Bake to images |
| Coat Weight > 0 | `KHR_materials_clearcoat` → `MeshPhysicalMaterial` | Remove for Quest |
| Emission strength > 1 | `KHR_materials_emissive_strength` (r170 supports it [src]) | fine |
| Material / light animation | `KHR_animation_pointer` (only with sampled export). **r170 GLTFLoader has no `KHR_animation_pointer`** [src] | Drive from code |
| Area / hemi lights | not exported (point/spot/sun only) [src: `lights.py` L40] | Lights are for baking only anyway |
| Second UV map | exported as `TEXCOORD_1` (all UV layers are written) | Lightmaps |
| Custom attributes | only names starting with `_` and only with `export_attributes=True` | `_SPINE_S`, `_SWAY` |
| Geometry-node instances / GPU instancing | `export_gn_mesh`, `export_gpu_instances` (children of an empty → `EXT_mesh_gpu_instancing`) | r170 loads TRS. Custom instance attributes are not instanced [src] |

## B9. three.js r170 integration

```js
const gltf = await gltfLoader.loadAsync('assets/models/mason_rig.glb');
const extras = (gltf.parser.json.animations || []).map((a) => a.extras || {});
gltf.animations.forEach((c, i) => { c.userData = extras[i]; c.tracks = c.tracks.filter((t) => !t.name.startsWith('root.')); });
const bones = {}; gltf.scene.traverse((o) => { if (o.isBone) bones[o.name] = o; });
const lods = []; gltf.scene.traverse((o) => { if (o.isSkinnedMesh) { o.frustumCulled = false; lods.push(o); } });
const mixer = new THREE.AnimationMixer(gltf.scene);
const breath = gltf.animations.find((c) => c.name === 'idle_breathe');
THREE.AnimationUtils.makeClipAdditive(breath);                       // reference = frame 0 [src: AnimationUtils L214]
mixer.clipAction(breath, undefined, THREE.AdditiveAnimationBlendMode).play();
// at load, per spine bone: b.userData.bindQuatInv = b.quaternion.clone().invert()  (pose before any mixer update)
// three composes additive quaternions as mixed = base · delta, so delta = base⁻¹ · mixed

function update(dt, body) {
  mixer.update(dt);                       // writes local TRS: crown subtree (override) + additive deltas on spine_00..05
  for (const b of spineBones) {           // procedural pose, composed with whatever the mixer added
    const delta = _q.copy(b.userData.bindQuatInv).multiply(b.quaternion);   // additive delta = bind⁻¹ · mixed
    sampleTrailFrame(body, b.userData.s, _m);                             // world frame from the sim trail at arc length s
    toParentLocal(b, _m, _pos, _qProc);                                    // world → parent-local (parent already updated)
    b.position.copy(_pos); b.quaternion.copy(_qProc).multiply(delta);
    b.updateMatrixWorld(false);
  }
  solveLegs(body, bones);                 // analytic IK → leg_* local rotations
  rootBone.updateMatrixWorld(true);
}
```

- **Order matters.** `AnimationMixer` writes to bones' local TRS. For bones that no override action drives, its base is the
  *binding's original value*, not this frame's procedural pose. So run the mixer first, extract the additive delta, and compose
  it onto the procedural pose. Do not try to let the mixer and the procedural code both "own" a spine bone.
- **Culling.** `SkinnedMesh.boundingSphere` is computed once if null [src: `SkinnedMesh.js` L65–116]. Either set
  `frustumCulled = false` with the view's existing `hideDistance`, or update the sphere from the spine bounds each frame
  (quest.md §15).
- **LOD.** Toggle `visible` on the LOD meshes by head distance. All share the same `Bone` objects, and only the visible mesh
  uploads a bone texture.
- **Bone texture.** About 200 bones is a 32×32 RGBA32F texture, ~16 KB per frame (quest.md §15).
- **Materials.** Keep the creature's custom shader (`creatureView.js` folds material classes into attributes and drives glow,
  curl and jitter from a per-bone data texture). Switch its inputs from the kit's rigid parts to the skinned GLB: baked atlas
  (albedo/normal/ORM/emissive) plus a detail texture array, ≤ 5 samples per pixel.

---

# Part C — Orchestration, timings, validation

```text
0  once:   pip install pyoidn into blender-venv; npm i the Node tools (section 2)
1  node    tools/abyssal-tether-3d/dump_level.mjs            → build/level.json
2  bpy     build_section.py --section sN --lm-density 8 --route-density 16 --samples 384
             kit placement → join per bucket → UV1 pack → lightmap + AO bake → EXR
3  bpy     lm_encode.py sN   (pyoidn RTLightmap → dilate → Bmax → sRGB PNG RGBA (rgb=light, a=AO))
4  bpy     export GLB (PNG textures, extras: lightmap file, bmax)
5  node    post.mjs sN.glb → public/abyssal-tether-3d/assets/sections/sN.glb  (+ sN_lm.ktx2 via ktx2-encoder)
6  bpy     build_r2.py --rest --game --lods 70000,20000,6000 --legs 32
             rest-pose rebuild → ownership weights → rig → 2-atlas bake (hero mesh → LOD0) → clips → GLB
7  node    post.mjs mason_rig.glb → assets/models/mason_rig.glb
8  node    npx gltf-transform inspect / validate on every output; budget check script (tris, draws, bones ≤ 255, tex MB)
```

| Step | Est. CPU time on these 4 shared cores [derived] |
|---|---|
| Section kit build + join + UV pack | 1–3 min each |
| Lightmap bake 1024² @ 384 spp | 2–5 min (s7: 2× 2048² ≈ 15–30 min) |
| OIDN RTLightmap 1024² / 2048² | ~2–5 s / ~10–20 s |
| KTX2 UASTC 2048² (ktx2-encoder, single-threaded) | ~20–60 s per map |
| Creature: rebuild + weights + LOD decimate | 2–4 min (the r2 build reached "meshes built" in ~28 s; decimating 1.75 M → 70 k is the slow part) |
| Creature bakes, 2 × 2048² (albedo, normal, ORM, emissive; AO 256 spp) | 15–40 min |

**Acceptance checks per asset:**
- `gltf-transform validate` clean.
- Joint count ≤ 255; max influences ≤ 4 with sum = 1 ± 1e-3.
- `uv1` present on lightmapped primitives; `_spine_s` present on the creature.
- No `KHR_materials_clearcoat` in Quest builds; texture MIME all `image/ktx2`.
- File sizes within the PWA budget (quest.md §10: ≤ 150 MB for the whole game).

---

# Part D — Honest framing for the owner

- **What Quest 3 gets:**
  - Every static surface lit by soft, bounced, baked light with contact darkening and glow spill.
  - Trim-sheet masonry at ~512 px/m with real relief.
  - 2K compressed textures at the VRAM cost of today's 1K JPEGs (quest.md §9).
  - A ~70 k-triangle, ~200-bone skinned Mason with baked macro detail from the 1.75 M-triangle hero model. It has authored
    roar, strike and listen performances and a 30-legged metachronal crawl.

  That is a large, visible step. "10×" is fair for geometry, texture resolution and lighting quality.
- **What it does not get:** real-time shadows from the lantern or creature, screen-space effects, real-time GI, or
  volumetrics. Baked light cannot react to moving objects; probes approximate it. The desktop tier can add shadows, bloom and
  GTAO on the same assets.
- **Risk to watch:** headless keyframing alone will give competent but stiff performances. Budget a short human animation pass
  in the Blender UI for `roar` and `strike`, the two moments players will remember.

---

# Part E — Open questions to verify

1. Does Quest Browser expose ASTC **HDR** (`getSupportedProfiles()` includes `'hdr'`)? If yes, UASTC-HDR lightmaps load
   natively in r170 (A6).
2. Is the old `uv_layer` bake bug (T48693) still present in 5.2? The recipe sidesteps it by setting the active UV, but a
   one-minute check lets us simplify.
3. Lightmap calibration constant: confirm π (A5) with the grey-card test before baking all sections.
4. Measured Cycles throughput on a 256² crop, to replace the bake-time estimates.
5. KTX2 encode quality settings: compare UASTC level 2 + RDO against ETC1S q192 on the masonry albedo on the headset (banding
   in darks).
6. Confirm `ktx2-encoder` normal-map mode output with three's normal decode (visual check on a test sphere).

---

## Sources

**Verified locally (source code / live module):**
- glTF exporter 5.2.40 (`bpy/5.2/scripts/addons_core/io_scene_gltf2`): `__init__.py` (options and defaults),
  `blender/exp/primitive_extract.py`, `primitive_attributes.py`, `joints.py`, `tree.py`, `lights.py`,
  `animation/action.py`, `animation/sampled/sampling_cache.py`, `export.py` (gltfpack hook)
- bpy 5.2.2 LTS introspection: `plans/scripts/bpy_api_probe.py`, `bpy_api_probe2.py`, `bpy_api_probe3.py`, `bpy_api_probe4.py`
- three.js r170: vendored `GLTFLoader.js`; `three@0.170.0` `lights_fragment_maps.glsl.js`, `lights_physical_pars_fragment.glsl.js`,
  `aomap_fragment.glsl.js`, `WebGLMaterials.js`, `WebGLPrograms.js`, `WebGLMorphtargets.js`, `SkinnedMesh.js`,
  `AnimationUtils.js`, `KTX2Loader.js`, `constants.js`; `three@0.186.1` `GLTFLoader.js` (KHR_meshopt)
- npm: `@gltf-transform/cli@4.5.1` (`src/transforms/toktx.ts`), `@gltf-transform/functions@4.5.1` (`prune.ts`, `quantize.ts`,
  `meshopt.ts`), `gltfpack@1.3.0` (README, `-h`), `ktx2-encoder@0.6.0` (types, `dist/gltf-transform/ktx2.js`; encoding run in
  `plans/scripts/ktx2_probe.mjs`)
- PyPI JSON: pyoidn 2.5.1.0, xatlas 0.0.11, pyktx 4.4.2 (no Linux wheel)
- Project files: `tools/abyssal-tether-3d/README.md`, `build_mason.py`; `scratchpad/mason2/final/build_r2.py`, `t_r2*/stats.json`;
  `src/render/creatureView.js`, `src/sim/creature3d.js`, `src/render/renderer3d.js`, `src/data/level-data-3d.js`

**Web:**
- glTF-Blender-IO exporter docs (GitHub copy of the manual page): https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst
- Blender 5.0 Python API change log: https://docs.blender.org/api/5.0/change_log.html
- Blender ActionKeyframeStrip / ActionChannelbag API: https://docs.blender.org/api/5.0/bpy.types.ActionKeyframeStrip.html , https://docs.blender.org/api/5.0/bpy.types.ActionChannelbag.html
- Blender manual, Render Baking: https://docs.blender.org/manual/en/4.5/render/cycles/baking.html
- Bake `uv_layer` bug report T48693: https://developer.blender.org/T48693 ; custom-UV bake commit: https://projects.blender.org/archive/blender-archive/commit/fd0b7428
- glTF exporter commits (sampling bakes constraints; deform-bones-only): https://lists.blender.org/pipermail/bf-extensions-cvs/2019-May/008163.html , https://developer.blender.org/rBA807a64cdfc50de1cfb263f2eb68680feddb66ec7
- Spline IK bake issues: https://blenderartists.org/t/spline-ik-bake-and-export-problem/700647 , https://projects.blender.org/blender/blender/issues/52063
- B-Bones lost on export: https://discourse.threejs.org/t/load-glf-to-display-animations-with-bendy-bone-exported-by-blender/14199 , https://www.blendernation.com/2021/10/25/convert-bendy-bones-to-standard-bones/
- three.js r155 lighting changes (×π for light maps): https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733/1
- Unity lightmap encoding (dLDR vs RGBM on mobile): https://docs.unity3d.com/Manual/Lightmaps-TechnicalInformation.html
- Unity lightmap UV padding/pack margin: https://docs.unity3d.com/ru/2021.1/Manual/LightingGiUvs-GeneratingLightmappingUVs.html , https://docs.unity3d.com/ja/2022.3/ScriptReference/LightingSettings-lightmapPadding.html
- OIDN RTLightmap filter: https://80.lv/articles/intel-ships-open-image-denoise-1-4 , https://www.mankier.com/1/oidnDenoise , https://pypi.org/project/pyoidn/
- The Lightmapper add-on (Blender lightmap workflow incl. OIDN): https://github.com/dirkk0/The_Lightmapper
- WebGi lightmap extension (example of a custom glTF lightmap extension): https://webgi.xyz/docs/api/classes/Asset_Management.GLTFMaterialsLightMapExtension
- KTX-Software (tools are native binaries): https://github.com/uberlambda/ktx-software (mirror) ; gltf-transform CLI: https://gltf-transform.dev/cli
- Texel density norms: https://polycount.com/discussion/comment/2304795 , https://www.strayspark.studio/blog/texture-resolution-guide-games-512-1k-2k-4k
- Quest 3 display (2064×2208/eye, ~25 PPD): https://uploadvr.com/quest-3-specs , https://en.wikipedia.org/wiki/Meta_Quest_3
- Centipede gait (retrograde metachronal wave; body–leg phase lead): https://www.frontiersin.org/journals/neural-circuits/articles/10.3389/fncir.2021.706064/pdf , https://archive.aps.org/mar/2020/u22/3 , https://sicb.org/?p=37551
- Meta / WebXR hardware and budget sources: see `plans/research/quest.md` § Sources (Meta WebXR best practices, Flowerbed, Above Par-adowski, device comparison)
