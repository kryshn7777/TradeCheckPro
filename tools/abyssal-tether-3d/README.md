# ABYSSAL TETHER 3D — asset pipeline

Source tooling for the full-3D / Meta Quest 3 (WebXR) version. Built assets go to
`public/abyssal-tether-3d/assets/` so they deploy with the site over HTTPS (required for WebXR).

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
