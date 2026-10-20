# ABYSSAL TETHER 3D — asset pipeline and test tooling

Source tooling for the full-3D / Meta Quest 3 (WebXR) version. Built assets go to
`public/abyssal-tether-3d/assets/` so they deploy with the site over HTTPS (required for WebXR).

Verification and tests (each folder has its own README):

| Folder | Run | What |
|---|---|---|
| [`verify/`](verify/README.md) | `npm run verify:at3d -- --chapter ch1 --variant all` | the route-bot harness: integrity, every route on every variant, determinism, sim budget per system (ENGINE_EXTENSIONS E28 / E29 / §8) |
| [`e2e/`](e2e/README.md) | `npm run e2e:at3d` | the real game in headless Chromium: desktop input, the whole descent with the creature live, persistence, mock WebXR |
| [`tests/`](tests/README.md) | `npm run test:at3d` | Node unit tests (input, VR UX fixes, creature) and the creature pacing / perf tools |

## The Mason (predator)

`build_mason.py` is the production builder of the creature (Blender 5.2 / `bpy`, procedural, deterministic, seed 1313):
"architecture that learned to hunt", a 29.5 m predator of 27 split masonry vertebrae with wet sinew, rib legs (flying
buttress, wrong-way bone shank, iron ankle, grapnel foot), a crown made of a broken rose-window **wheel** behind a
**lancet portal** (three stepped archivolt orders of small wedge voussoirs sunk in flesh) whose cracked ventral third
has dropped open onto a 5.6 m throat of ten receding rings of teeth/ribs with one far glow, seven listening pits
(a few sealed by eardrums), a ring of five raised stone arms, drool, tongue. Ember only in the throat and the pits.
No eyes, antennae or mandibles.

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
| `Mason_Pit` | ~40 | pit centre, opening +Y | glowing coal only (emissive material); the full pits are part of the head |
| `Mason_PitMembrane` | 87 | pit centre | eardrum (ignored by the legacy view) |

Vertex attributes on every module (underscore names; GLTFLoader lower-cases them): `_SPINE_S` (float, module-local rest
arc length in m, head side = 0), `_MASK` (UNSIGNED_BYTE normalized VEC4: flesh, wet, thickness, class/3 with stone 0,
iron 1/3, flesh 2/3, bone 1), `_OWNER` (UNSIGNED_BYTE VEC4, not normalized: owner bone id, second bone id (255 = none),
weight of the second bone * 255, 0) and `_PART` (float, stone-island id for plate lift / jitter). The owner id ->
canonical bone name table is in the node extras (`rig_module` JSON, plus `pivot_world`, the module's frame in the
posed creature). Rigid parts (stone, iron, bone, teeth) carry one owner; flesh groups carry two. Emissive faces
(throat fissure, pit coal) are in material `MasonEmissive`; everything else uses `MasonCrown` or `MasonBody`
(`MeshStandardMaterial`, no clearcoat/transmission/sheen). Drool, glass and oil are render-only.

Budgets (`export_report.json`): assembled by today's `CreatureView` (head + 18 segments + tail + 10 legs + fronds +
pits) 48.8 k triangles at LOD0 (limit 60 k), about 17 k at LOD1 (limit 25 k), 2 draw calls per eye.

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

## Textures

Original tileable PBR sets (1024², seamless by construction) are baked by `build_textures.py` into
`public/abyssal-tether-3d/assets/textures/` with a `manifest.json`:

| Set | Tile | Use |
|---|---|---|
| `rock` | 4 m | shaft walls, ledges |
| `masonry` | 4 m | Lanternwright ashlar: built walls, bridges, the creature's stone |
| `metal` | 2 m | corroded iron: girders, bands, grates |
| `rockFar` | 16 m | distant structures |
| `flesh` | 1.5 m | the creature's exposed tissue (fibres run along v) |

Each set has `albedo` (sRGB), `normal` (OpenGL +Y, linear) and `orm` (R = AO, G = roughness, B = metalness, linear),
so one ORM texture feeds three.js `aoMap`, `roughnessMap` and `metalnessMap`. Run with the Blender venv Python;
`--preview` renders `previews/textures.png`, `--tilecheck <dir>` writes 2×2 seam-check sheets.

`fetch_polyhaven.py` swaps in CC0 Poly Haven sets (same manifest format) when the network allows
(`polyhaven.com`, `api.polyhaven.com`, `dl.polyhaven.org`); `--list <category>` and `--set name=id` choose assets.

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
