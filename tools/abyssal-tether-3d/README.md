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

## Rock textures (Poly Haven, CC0)

Planned: download CC0 rock/stone sets (albedo, normal, roughness, AO at 1k–2k, KTX2 for Quest) from Poly Haven
into `public/abyssal-tether-3d/assets/textures/` for the shaft walls, ledges and the Mason's masonry. This needs
`polyhaven.com`, `api.polyhaven.com` and `dl.polyhaven.org` allowed in the cloud environment's network settings.
