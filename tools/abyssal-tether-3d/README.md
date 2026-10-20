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

`build_mason.py` builds the creature procedurally in Blender and exports glTF binaries:

| Output | Contents |
|---|---|
| `public/abyssal-tether-3d/assets/models/mason_kit.glb` | Modular parts for in-engine procedural assembly and animation (~5k triangles total) |
| `public/abyssal-tether-3d/assets/models/mason_hero.glb` | The assembled creature crawling head-first down a wall (64 instanced parts, ~21k triangles) |
| `previews/mason_hero.png`, `previews/mason_full.png` | Cycles preview renders |

Kit parts (Blender +Z up is exported as glTF +Y up; each part's pivot is at its joint):

| Part | Pivot / orientation | Use |
|---|---|---|
| `Mason_Segment_0..2` | block centre; spine along local +Y (toward the head), dorsal +Z | body blocks (3 variants), scale down toward the tail |
| `Mason_Tail` | block centre | last segment with dragging chain |
| `Mason_Head` | crown centre; front face at +Y | the crenellated crown (no face, no eyes) |
| `Mason_Frond_0..2` | frond root; grows along +Y, curls about +X | sensory fronds around the crown rim (animate: sweep/curl toward sound) |
| `Mason_Pit` | pit centre; opening along +Y | recessed listening pits (emissive) |
| `Mason_LimbUpper` / `Mason_LimbLower` | joint pin at the origin; bone runs along +Z | lattice-girder bones for 2-bone IK legs |
| `Mason_Hook` | hook root; curls about +X | foot hook planted on walls |

Materials are plain PBR (base colour, metallic, roughness, emissive) so they survive glTF export unchanged;
`Mason_SensoryGlow` and `Mason_Frond` are emissive.

### Run

With Blender installed:

```bash
blender -b -P tools/abyssal-tether-3d/build_mason.py -- --out public/abyssal-tether-3d/assets/models --render
```

Or headless with the `bpy` module (what produced the committed files):

```bash
python3.13 -m venv .venv && .venv/bin/pip install bpy==5.2.2
.venv/bin/python tools/abyssal-tether-3d/build_mason.py --out out --render --samples 32 --res 1280x720
```

Options: `--seed N` (variation), `--samples`, `--res WxH`, `--rock <albedo.jpg>` (texture the preview wall).

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
