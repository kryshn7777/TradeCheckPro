# ABYSSAL TETHER 3D: audit of the current visuals and creature

*Research step of the "10x graphics + rigged, scary centipede" plan. Written 2026-10-19 at about 11:30. Read-only audit:
nothing under `/home/user/TradeCheckPro` was edited. Other workflows are editing `src/` while this is written, so this
describes the code as it stood when read (`creatureView.js` and `renderer3d.js` at 10:04–10:07, `creature3d.js` at
10:20, `level-data-3d.js` at 10:22).*

---

## 0. Verdict in one page

**The engine is a well-engineered, very lean prototype. The art is greybox-plus.** The frame structure is disciplined: a
fixed light count, so programs never recompile; radial fog; an allocation-free hot path; instanced and merged draws; one
skinned draw for the whole creature. It uses only **about 10–45 % of a conservative Quest 3 budget**. But almost
everything the player *sees* is built in code from boxes, cylinders and tori:

- 164 axis-aligned boxes for the level.
- 122 decor items assembled from primitives.
- A creature made of 12 untextured, UV-less kit parts (about 5k unique triangles).

Those are lit by one lantern point light, two pooled point lights and a flat hemisphere ambient. There are no shadows,
reflections, baked lighting, decals or authored meshes. The baked PBR texture sets are good, but they are stretched
across boxes at 2.6 px/cm, about 5× too coarse for arm's length in a Quest 3.

**The creature is the weakest link for the owner's ask.** In game it reads head-on as a rusty plate ringed with pale
spikes: a dartboard or starfish. The attached screenshots show it, and the project's own critic used the same words. It
has:

- no mouth or jaw (the kit has none),
- no textures beyond an albedo tint,
- no deformation between rigid blocks,
- no authored animation,
- no hit or footstep effects.

All its life comes from about six procedural scalars written by the sim. The new *Ossuary Column* concept (round 1
renders) is dramatically scarier, but it is a 1.7 M-triangle offline sculpture. The in-progress game export (round 2)
targets a **static, unrigged** 130 k-triangle LOD0, which is 5× the art plan's 25 k budget. Its layout (27 vertebrae,
26–44 legs) does not match the sim (20 spine points, 10 limbs), and nothing in the engine can play it yet. **There is
currently no rig and no path from that concept to an animated in-game creature.**

**Honest hardware framing.**

- **Plenty of geometry and draw headroom.** Peak today is 66 GL draws and 163 k triangles per stereo frame. Meta's soft
  guidance for Quest 3 is under 200 draws and under 1.5 M triangles ([Meta device comparison][meta-devcomp], via search
  excerpt).
- **Little per-pixel headroom.** The binding limits are fragment ALU, memory bandwidth (all textures upload uncompressed)
  and CPU draw submission (r170 has no multiview, so every draw runs twice).
- **Where the "10x" can come from:** authored geometry and silhouettes, baked or painted lighting, compressed
  higher-resolution textures, decals, a real rig with authored motion, and staged FX. On Quest it cannot come from more
  dynamic lights, real-time shadows or post-processing.

---

## 1. Scope, method, caveats

- **Read in full or in the relevant parts:**
  - `src/render/{renderer3d,materials,creatureView,fx,levelView,handsView,ropeView}.js`
  - `src/sim/creature3d.js`
  - `src/data/level-data-3d.js`
  - `src/game.js` (creature-kit loading, feedback and event wiring)
  - `assets/textures/manifest.json`
  - `tools/abyssal-tether-3d/{README.md,build_mason.py,build_textures.py,fetch_polyhaven.py}`
  - `docs/abyssal-tether-3d/{ART_AUDIO_PLAN.md,vrc-checklist.md}` (budget sections)
- **GLB contents** were measured with a small node script
  (`/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad/plans/research/glbinfo.mjs`).
  Level content counts come from importing `level-data-3d.js` in node.
- **Measurements reused:**
  - The stereo render audit in mock WebXR (draws, triangles, overdraw): `scratchpad/3d/review-perf/out/render-quick.log`
    and `render-audit.json`, run about 07:50. That run predates the cut from 4 to 2 environment lights.
  - CPU timings: `review-perf/out/rcpu.log`.
  - Software-raster GPU A/B: `review-perf/out/gpu.log`.
  - All were taken with Chromium plus **SwiftShader (software)**. They are valid for counts and relative costs, not for
    Quest milliseconds. **No on-device GPU timing exists**, which `vrc-checklist.md` also notes.
- **Images reviewed:**
  - `tools/abyssal-tether-3d/previews/{mason_hero,mason_full,textures}.png`
  - In-game shots: `scratchpad/3d/review-horror/shots/*.png` (08:06–08:33), `scratchpad/3d/e2e/shots/*.png` (11:19, with
    the SwiftShader warning banner), `scratchpad/3d/creature/*.png`, `scratchpad/3d/fix-simgame/shots/*`
  - Creature concept renders: `scratchpad/mason2/final/r1/{hero,approach,full,silhouette}.png`. These are the newest
    *finished* renders. `r2/` is mid-export; only an empty `export/textures/` directory exists so far.
- **No Blender or Chromium was run.**
- **Web access:** `developers.meta.com` and `discourse.threejs.org` were unreachable from this sandbox (proxy 403 / DNS).
  Meta figures are therefore cited from search-engine excerpts of those pages and from the sibling report
  `plans/research/quest.md`, and are marked as such.

---

## 2. What exists

### 2.1 Renderer and frame structure (`render/renderer3d.js`)

| Aspect | Current implementation |
|---|---|
| API | three.js **r170** `WebGLRenderer({antialias:true, powerPreference:'high-performance'})`, `xr.enabled`, `xr.setFoveation(1)` (maximum fixed foveation). Pixel ratio ≤ 2 on desktop. |
| Stereo | Classic per-eye rendering: r170 has no multiview anywhere in `src/` (grepped the npm package). Every draw is issued twice. |
| Output | sRGB output, **ACES Filmic** tone mapping in-shader, exposure 1.2. No post-processing pass, no render targets. |
| Shadows | `shadowMap.enabled = false`. Nothing casts shadows. |
| Camera | `PerspectiveCamera(70°, near 0.05, far 400)` inside a `PlayerRig` group; WebXR overrides the fov. |
| Precompile | `precompile()` forces every object visible, calls `renderer.compile` and `initTexture` for every sampled texture while on the menu. Avoids first-sight hitches. |
| Stats | `stats {calls, triangles, points, programs, frameMs}` from `renderer.info` after each render. |
| Frame rate | `session.updateTargetFrameRate` is never called; `framebufferScaleFactor` is never set (default 1.0). |
| Render order | glyphs 20, glows 15, bursts 31, highlights 60, fade sphere 900, XR hand launchers 960. |

### 2.2 Lighting model

- **Hemisphere ambient**, one per frame:
  - Sky: the section theme's `light`, partly desaturated.
  - Ground: the fog colour plus 6 % of the accent.
  - Intensity: `theme.ambient × 3.2 × (1 − 0.25·threat)`, giving roughly 0.5–1.1 across the eight sections.
- **Lantern:** one warm `PointLight` (0xffb46a, 6.5 cd, range 30 m, decay 1.6, "gentler than physical"), carried at the
  left grip in XR or at the camera on desktop.
  - Procedural flicker: two sines plus a rare dip. A ±6 mm jitter.
  - 35 % intensity when dead.
- **Environment pool:** `ENV_LIGHTS = 2` real PointLights, re-assigned every 0.25 s to the nearest of the level's 13
  authored lights, with fade-out and fade-in on swap and optional flicker. Intensity:
  `candela = intensity × max(6, 0.06·range²) × 1.6`. Every lit fragment pays for all 3 point lights, because three.js
  unrolls the light count. The perf review measured −23 % frame time with 0 env lights versus 2 (`gpu.log`, software
  raster).
- **Everything else that "glows" is unlit or emissive:**
  - lamp bulbs, inlays and statue lanterns: `decorGlow`, vertex colour, fog-capped,
  - light glows: one `Points` draw of soft sprites,
  - anchor glyphs: additive billboards,
  - light shafts: additive cones,
  - the creature's pits and fronds: per-bone emissive.
- **Not present:** environment maps or IBL (no `scene.environment`, no `envMap`), lightmaps, light probes, baked vertex
  lighting, spot lights, shadows, contact shadows, SSAO, bloom, colour grading.
  - Metals therefore get **no reflections**. Iron with ORM metalness of about 0.85 renders near-black except for point-light
    highlights.
  - The only AO is the ORM texture's tile-scale AO channel.

### 2.3 Materials and textures (`render/materials.js`, `assets/textures/`, `tools/.../build_textures.py`)

- **Baked PBR sets.** Five original, seamless-by-construction 1024² sets baked by `build_textures.py` (numpy: FFT noise,
  Worley, warps):

  | Set | Tile | Content |
  |---|---|---|
  | `rock` | 4 m | |
  | `masonry` | 4 m | ashlar courses |
  | `metal` | 2 m | corroded iron |
  | `rockFar` | 16 m | |
  | `flesh` | 1.5 m | wet sinew |

  - Maps per set: `albedo` (sRGB JPEG q85), `normal` (OpenGL, q92), `orm` (AO/rough/metal, q90). 15 JPEGs, 5.7 MB on
    disk.
  - Quality is decent: see `tools/abyssal-tether-3d/previews/textures.png`. Masonry and metal read well on spheres and
    cubes. Rock has a "papery/strata" look.
  - `fetch_polyhaven.py` can swap in CC0 Poly Haven sets in the same manifest format. It is not used: no network.
- **Fallback.** 256² procedural canvas sets are generated at boot on the main thread and disposed when the baked sets
  arrive.
- **Material library.** Every material is created once.
  - `MeshStandardMaterial` with `map`, `normalMap`, and **one ORM texture bound to aoMap, roughnessMap and metalnessMap**.
  - Anisotropy ≤ 4. Base roughness and metalness are 1, so the ORM rules.
  - Materials: `rock`, `masonry`, `crumble` (masonry plus crack overlay, paler), `metal`, `grate` (alpha-test,
    procedural canvas), `decorStone`, `decorMetal`, `decorRock`, `decorFlesh`, `decorGlow`, `lightShaft`, `mount`,
    `glyph`, `hazard`, `colossal` (unlit near-black), `plaque`.
- **Shader patches** (`patchMaterial`, via `onBeforeCompile` with custom program keys):
  - World-metric **box projection**: dominant-axis planar UVs from the instance matrix, so neighbouring boxes' courses
    line up.
  - **Ash** on up-facing faces.
  - A **crack overlay**.
  - A two-scale **macro-noise** albedo modulation against tiling.
  - Per-instance **shape selection** (one InstancedMesh draws several anchor or hazard shapes), emissive inlays.
  - Fog variants: `cap` for silhouettes, `fade` for additive glows.
  - The light-shaft "volumetric fake": facing² × near-fade.
- **Texel density.** 1024 px per 4 m = **2.56 px/cm**. Quest 3 is about 25 PPD at the centre ([UploadVR spec
  table][uploadvr-q3]), so 1° at 1 m ≈ 1.75 cm needs about 14 px/cm for 1:1.
  - Surfaces within about 2 m (ledges underfoot, walls you hang beside) are magnified about 3–5×, which is soft.
  - The repeat is visible as a regular grid on floors. Screenshots `review-horror/shots/A3-s1-east-down.png` and
    `E0-s8-throat-down.png` show the same course pattern repeating.
- **GPU memory.** JPEG and PNG decode to **uncompressed RGBA8**: 1024² × 4 B × 4/3 for mips ≈ 5.6 MB per map, **≈ 84 MB
  for the 15 baked maps**. No KTX2/Basis: `KTX2Loader` and the basis transcoder exist in the r170 npm package but are
  not vendored. No mesh compression either (Draco and meshopt are not vendored). Meta recommends KTX 2.0 / Basis
  Universal for WebXR on Quest, citing a smaller in-memory footprint and more efficient GPU access ([Meta WebXR best
  practices][meta-webxr-bp], via search excerpt). The sibling report `research/quest.md` covers bandwidth.

### 2.4 Fog and atmosphere

- **Radial fog** is installed globally into `ShaderChunk`:
  - It uses distance, not depth, so turning the head never changes what is hidden.
  - The curve is front-loaded: `1 − (1 − t)^2.5` between `fogNear` and `fogFar`.
  - It is a colour fade only: no height falloff, no noise, no scattering around light sources, no animated density.
- **Per-section theme tuple** `(fog, light, accent, fogNear, fogFar, ambient)`. It is blended over ±9 m across section
  boundaries and eased in time; it snaps after teleports.
  - Fog colour is lifted by ×1.3 with a luminance floor of about 30/255, so no section is pure black.
  - Threat (0..1) darkens fog by up to 22 %, pulls `near` in by 30 % and `far` in by 18 %.
  - `scene.background` = fog colour.

  | Section | fogNear–fogFar | ambient |
  |---|---|---|
  | S1 Threshold | 8–90 | 0.34 |
  | S2 Long Swing | 7–85 | 0.30 |
  | S3 Broken Gallery | 6–75 | 0.27 |
  | S4 Listening Vault | 8–170 | 0.25 |
  | S5 Gullet Stair | 4–55 | 0.20 |
  | S6 Two Descents | 5–65 | 0.18 |
  | S7 Hollow Nave | 8–120 | 0.16 |
  | S8 Last Throat | 5–70 | 0.20 |

- **Fog as culling.** Solids beyond fog far + 4 m are dropped from the instanced buffers.
- **Atmospheric FX:** 900 additive dust/ash points wrapped around the head in the vertex shader (density and drift rise
  with threat), plus 7 `shaft-light` additive cones. Nothing else.

### 2.5 Level geometry (`render/levelView.js`, `data/level-data-3d.js`)

- **Content:** 164 solids (95 wall, 32 stone, 26 metal, 5 crumble, 4 bridge, 2 pillar), 62 anchors, 7 hazards, 13
  lights, 122 decor items.
  - Decor breakdown: chain 43, plaque 9, ribs 9, statue 8, glyphs 8, far-structure 7, shaft-light 7, arch 6, lamp 6,
    machinery 4, pipe 4, cage 3, cables 2, girder 2, bones 2, still-lamp 1, grate 1.
- **Solids** are **axis-aligned boxes** drawn as one `InstancedMesh` of a unit cube per material bucket (rock, masonry,
  metal, grate). They are re-packed with the boxes within fog distance whenever the head moves 1.5 m. Per-instance tints
  vary ±13 %.
  - Result: perfectly sharp 90° edges, no bevels, no trims, no silhouette breakup. Every wall is a flat slab.
- **Decor** is built in code from boxes, cylinders and tori (`DECOR.*` builders), merged per 64 m band per material, and
  distance- and frustum-culled.
  - The "Lanternwright statue" is a cylinder robe, a cone hood and box arms.
  - Arches are 11 box voussoirs. Chains are squashed tori (real links only in the lower 45 m).
  - The "ribs" are half-tori in the flesh material.
  - `INTEGRATION_NOTES.md` already records: *"environment art is greybox-like in wide views → environment-art pass"*.
- **Colossal silhouettes:**
  - Sources: a sparse procedural ring of towers and spires beyond the shaft walls, plus 7 authored `far-structure`
    items.
  - Rendering: **unlit near-black** `MeshBasicMaterial` with capped fog, plus lit-window glow points.
  - They read as cut-outs (`B5-s4fix-natural.png`).
- **Other level objects:**
  - Anchors: instanced mounts with phosphor inlays, plus additive glyph billboards (readability-first, shape-coded).
  - Hazards: instanced rebar, spikes and blades.
  - The portcullis gate.
  - Plaque text planes (canvas textures).

### 2.6 FX, rope, hands (`fx.js`, `ropeView.js`, `handsView.js`)

- **FX** (all pooled, so no allocation):
  - Ambient dust: 900 points.
  - Bursts: ≤ 320 additive points (sparks, puffs, chips) with a soft radial-gradient dot texture.
  - Debris: ≤ 140 flat-shaded dodecahedrons in one InstancedMesh.
  - Death or flash fade: a black back-face sphere on the camera.
  - Bus hooks: `grapple:attach|break`, `platform:crumble`, `player:land|wallhit|death`, `creature:burst` (rains
    debris from above if the creature is < 45 m away), `trigger:debris|rumble`.
  - **No FX for `creature:attack`, `creature:strike` or `creature:step`.**
  - No soft particles, flipbook smoke, drips, embers, decals, or trails.
- **Rope:** a 6-sided tube with 32 segments and a parabolic slack sag. `MeshStandardMaterial` with emissive ∝ tension.
  No texture, no fibre twist.
- **Hands:** two procedural brass-and-iron launchers built from about 40 primitives each (`CylinderGeometry`,
  `TorusGeometry`, `BoxGeometry`), flat-coloured `MeshStandardMaterial` with no textures (about 3.5 k triangles each),
  plus a small lantern. They read as toy-like orange shapes in every screenshot.
- **Feedback policy:** haptics, flash and fade only, never camera shake (`game.js` header). This is correct for VR.

### 2.7 The Mason: simulation (`sim/creature3d.js`, 2,919 lines)

**Design.** "A colossal organism fused with the shaft's masonry": a column of 20 spine points hauled along walls by 10
independent hooked limbs, led by a crown of sensory fronds and listening pits. It is DOM-free, three-free,
allocation-free and seeded.

**States** (`CREATURE_STATES`): `DORMANT, DISTANT, OBSERVING, APPROACHING, PURSUING, BURST, ATTACK, RECOVERING`. They run
under a section **mode**:

| Mode | Sections | Lethal | spawnOffsetY |
|---|---|---|---|
| dormant | S1–S3 | no | 240–260 |
| sighting | S4 | no | 220 |
| stalk | S5 | yes | 130 |
| hunt | S6 | yes | 120 |
| frenzy | S7 | yes | 110 |
| escape | S8 | yes | 100 |

Each mode applies multiplier profiles on top of `DIFF_TUNE.{normal,nightmare,abyss}`.

**Hunting logic.**
- It hunts **by sound**:
  - Player still > `listenDelay`: it stops and listens, with pits pulsing.
  - Player still afterwards: it creeps closer.
  - Player moves while it listens: it hears you, its crown snaps toward you and it holds for `snap` seconds.
  - Then it **bursts**: 14–18.5 m/s for 0.9–1.3 s.
- A **stall timer** (6–15 s by difficulty) forces a lunge.
- **Stamina** drains and regenerates, so pressure comes in waves.
- **Attack** = `windup` (0.75 / 0.65 / 0.5 s), during which:
  - the crown rears back 1.3 m,
  - the fronds flare,
  - the glow strobes at about 6 Hz,
  - the body advances at `windupAdv`.
- Then `strike`: a 0.16 s ease-out lerp of the head to the player, or to the reach limit stopped short of masonry. Then
  `recoil` (0.45 s).
- A lunge connects if within `killRadius × 1.6`; ×1.25 for stall lunges.
- Victory sequence: `charge → slam` (on the gate) `→ retreat`.
- S4 sighting: a scripted crossing of the Vault's far wall, rendered as a fog-capped silhouette.

**Spine path.**
- The head clings to the nearest structural surface (walls, pillars, slabs ≥ 6 m in two directions) at 1.45 m hug
  height. Velocity is projected onto the tangent plane, with a sinuous weave (0.32 of speed over a 22 m wavelength).
- **Breadcrumbs**: 0.3 m spacing, 360 kept (about 108 m), each with its surface normal. When the head backs along its
  path, the newest crumbs are consumed, so the body retracts tail-first.
- The 20 spine points sample the trail at arc-length offsets: spacing 1.5 m at the shoulders, tapering 45 % to the tail,
  for a body about 23 m long. A minimum link of 0.82× stops telescoping.
- Then the column **arches off the wall** mid-length (0.65 m, heaving ±18 % at 0.9 rad/s: "breathing masonry").
- Detours around masonry, line-of-sight checks (no strikes through stone), a stuck watchdog, and out-of-sight
  relocation when the player is > 28 m away.

**Limbs.**
- 10 limbs: `[seg, side, reach 5.4–8.6 m, forward bias, weight]`, front-weighted and irregular.
- Each limb finds a grip on a nearby solid surface (hooks bite 0.12 m in, with jitter).
- It steps when over-stretched. Step duration is 0.1–0.3 s, shorter with speed. 3 limbs step at once, or 5 when surging.
  Partners alternate.
- Foot arcs lift 1.1 m along the body up-vector.
- Free limbs grope and sway.
- Each footfall emits a `creature:step`.

**Output for render, audio and haptics** (the contract the view consumes):

| Field | Meaning |
|---|---|
| `body.spine` | Float32Array(20×3), head→tail; [0] is the crown origin, pulled back by `rear` during the wind-up |
| `body.up` | Float32Array(20×3) surface normals |
| `body.scale` | Float32Array(20) taper |
| `body.head` | {x,y,z, fx,fy,fz, ux,uy,uz} |
| `body.focus` | {x,y,z, amount}: the player position, with strength per state (`FOCUS` table) |
| `body.limbs[10]` | {seg, side, reach, weight, hip, foot, planted, lift} |
| `body.frondOpen` | 0..1, from `UNFURL`, flared by the snap and wind-up |
| `body.glow` | 0..1, from `GLOW` × listen pulse × attack strobe |
| `body.lunge` | 0..1 |
| `body.jitter` | 0..1 (BURST 0.55, ATTACK 1) |
| `body.listen` | 0..1 |
| `body.visible` | bool |
| `creature.sighting` | bool |
| `creature.audio` | {x,y,z, distance, intensity, movement, state} |

**Events** on the bus. Every payload carries world `x,y,z`.

| Event | Payload extras |
|---|---|
| `creature:state` | {from, to, distance} |
| `creature:retreat` | |
| `creature:burst` | {distance, commit, reason, snap} |
| `creature:attack` | {windup, distance, cause}, or {gate:true} for the victory slam |
| `creature:strike` | {hit, distance, cause, reason}, at the landing point |
| `creature:step` | {intensity, distance}, rate-limited to 55 ms |
| `creature:call` | {distance, intensity} |
| `creature:sighting` | {duration} |

**Who consumes what.**

| Consumer | What it uses |
|---|---|
| **View** | Only the `body` fields (no events). |
| **FX** | Only `creature:burst` (debris rain). |
| **Game** | `attack`, `strike`, `burst`, near-creature haptics and flashes (flash 0.18 on a near miss, 0.55 on the gate slam). |
| **Audio** | Everything. |

So the visual system ignores strike landings, footfalls and state changes.

### 2.8 The Mason: view (`render/creatureView.js`, 1,252 lines)

**Input kit.** `assets/models/mason_kit.glb` (236 KB), built by `tools/abyssal-tether-3d/build_mason.py`.

- Measured: **12 nodes, 4,990 triangles**, attributes `POSITION, NORMAL` only, so **no UVs**.
- 8 flat PBR materials: `Mason_Frond`, `SensoryGlow`, `StoneMid`, `StonePale`, `Rust`, `Iron`, `StoneDark`,
  `Verdigris`.
- **0 textures, 0 skins, 0 animations.**

| Part | Triangles |
|---|---|
| Segment_0, 1, 2 | 496 / 588 / 496 |
| Tail | 976 |
| Head | 636 |
| Frond_0..2 | 368 each |
| Pit | 48 |
| LimbUpper, LimbLower | 204 each |
| Hook | 238 |

- The optional `Mason_Jaw`, `Mason_Spine` (dorsal) and `Mason_Membrane` that the view supports are **absent**. So in game
  there is **no jaw or mouth opening, no dorsal spines, no membrane**.
- There are no `_LOD1` parts, so the LOD switch never triggers.
- `mason_hero.glb` (64 instanced parts, about 21 k triangles, a posed crawl) is **not used by the game**.

**Assembly** (name-driven and dimension-driven from bounding boxes).
- 65 rigid "bones": 20 spine (head, 18 random block variants, tail), 10 fronds, 5 pits, and 10 limbs × (upper, lower,
  hook).
- All instances are baked into **one merged geometry** as a `SkinnedMesh`, with every vertex weighted 1.0 to its own
  bone. Bone `matrixWorld`s are written directly each frame.
- Result: **one draw call per eye** for the whole creature, about **21.5 k triangles** (measured: +43 k triangles per
  stereo frame with the creature close).
- Kit materials are folded into vertex attributes (colour, metalness, roughness, detail class, emissive).
- A per-bone `DataTexture` carries glow, frond curl and bend length. Fronds bend about one axis in the vertex shader
  (`masonBend`).

**Shading.**
- `MeshStandardMaterial` (vertex colours), patched.
- Optional **albedo-only** tri-planar detail per class, in part-local space: stone ← masonry, rust/iron ← metal, flesh ←
  flesh luminance. That is 3 extra fetches per pixel. The textures are gain-normalised so the kit tone survives.
- **No normal map, no roughness or AO maps, no clearcoat or wetness, no subsurface.**
- Emissive = per-part constant × bone glow.
- Fog is capped during the far sighting, so a dark silhouette survives, and the glow pierces the fog by 35–100 %.

**Animation (all procedural, per frame, from the sim's body).**
- **Spine frames:** forward is the chord between neighbours; up is the sim's surface normal, orthogonalised.
- **Blocks** are scaled by the sim's link spacing ÷ the kit segment length × taper. "Plate jitter": random 9 % lateral
  offsets at 24 Hz while `jitter > 0` (BURST/ATTACK).
- **Crown:**
  - 10 fronds on an irregular ring.
  - Closed: bundled forward. Open: splayed and swept back. Lunge: pushed forward.
  - Idle sway, a turn toward `focus`, and curl driven by `frondOpen`, writhe, lunge and a per-frond bias.
  - Flicker of the glow.
- **5 pits** pulse.
- **Legs:** analytic 2-bone IK from a hip on the rendered flank to the sim's planted foot. The pole points "up off the
  wall and out", girder lengths are scaled to the sim's reach (+4 %), and the legs stretch up to 1.3× before breaking.
  The hook continues the lower bone and curls toward the body.
- **Culling:** hidden beyond 260 m; a bounding sphere is recomputed from the spine and legs each frame.
- **Fallback:** a `StandInCreatureView` in `game.js` (a dark spine of boxes) if the kit or view fails.

**What this means visually.**
- The body is a chain of rigid boxes with visible gaps and interpenetration at bends: there is no skin across blocks.
- The legs are thin black lattice girders that read as scaffolding (`C2-s5-windup.png`).
- Head-on, which is the view the player gets during every attack, the creature is **a flat rust-orange plate with 10
  pale blade-like fronds radiating from it**: a dartboard or starfish (`C2-s5-windup.png`, `C4-s5-strike+0.12.png`,
  `creature/shot_B1_windup.png`).
- At distance it is a small spiky asterisk of glowing dots (`creature/real_s5_player.png`, `shot_A1_player.png`).

### 2.9 Asset tooling and the new creature concept

**`build_mason.py`** (Blender via the `bpy` 5.2.2 module, headless) makes the current kit and hero: boxes, cylinders,
tube sweeps, flat Principled materials and Cycles previews. The previews show a tidy brown block column on orange truss
legs with white whisker-fronds: readable, but closer to a toy or a construction crane than a predator.

**`scratchpad/mason2/final/build_r1.py` / `build_r2.py`**: the *Ossuary Column* concept, newest and in progress.
- The **r1 renders** are a large leap in horror: split masonry vertebrae held open by marrow-dark sinew, a toothed
  maw-crown with glowing oculus pits, chains, a fused cage, tendons and harvestman legs. The silhouette test reads as a
  thorned centipede.
  - Stats: 29.1 m spine, **27 vertebrae, 26 leg slots, 1,697,315 triangles**, 21 material groups. Render-only.
- The **r2 notes** go further: a Gothic lancet-portal crown with stone-tracery fangs, 7 bored ear-canal pits, 150
  throat teeth, **"44+ harvestman-tall cathedral legs"**, and a clearcoat-wet palette.
- **r2's planned game export** (`export_game()`):
  - The creature is rebuilt at game tessellation and merged into **4 atlas materials**: StoneIron 2048², FleshWet
    2048², ToothBone 1024², Emissive 512².
  - Decimated to **LOD0 130 k / LOD1 36 k / LOD2 9 k triangles**.
  - Maps are baked from the render mesh: albedo, roughness, normal, AO, emissive.
  - A per-vertex `_SPINE_S` attribute is shipped "so the seam pulse can crawl head-ward".
- **The r2 export is a single posed, static mesh.** It has no armature, no skin weights and no animation clips.

---

## 3. Budgets: used vs available

| Resource | Today (measured unless marked) | Project contract / plan | Platform guidance | Headroom |
|---|---|---|---|---|
| GL draws per stereo frame | **38–66** (menu 52; worst 66, the death panel) | ≤ 150 (CONTRACT3D) | Quest 3 **< 200** draws, soft ([Meta device comparison][meta-devcomp], search excerpt). Sibling `research/quest.md` sets 200 typical / 280 worst GL draws without multiview. | **About 3×** |
| Triangles per stereo frame | **35 k–163 k**: 17–82 k per eye. S7 nave 117 k; creature close 160 k; landing and debris 149 k | ≤ 350 k (CONTRACT3D); art plan: env ≤ 140 k visible, Mason ≤ 25 k LOD0 | Quest 3 **< 1.5 M** triangles per frame, soft ([Meta device comparison][meta-devcomp]) | **2–9× by contract, about 9× by Meta** |
| Creature | **21.5 k triangles, 1 draw per eye**, 65 rigid bones | ≤ 25 k LOD0 / 10 k LOD1 / 3 k LOD2 (art plan §0.4, §1.6) | – | Fits. r2's 130 k LOD0 is **5.2× over plan**. |
| Real-time lights | lantern + 2 env PointLights + hemisphere (3 point loops per lit pixel) | ≤ 4 env + lantern (spot plus fill), no shadows (art plan §4) | – | Little: each added light is a per-pixel loop on every lit fragment. The 0-vs-2 env-light A/B was −23 % frame time (software raster). |
| Shader programs | 59–68 | – | – | Fine. All are precompiled on the menu. |
| Textures (GPU) | **≈ 84 MB uncompressed RGBA8** for 15 baked maps, plus small canvases | ≤ 3 new 1024² sets per chapter | KTX2/Basis recommended on Quest ([Meta WebXR BP][meta-webxr-bp]) | Five chapters at today's format would be about 84 + 4×50 MB. Compression is the cheapest "10x" enabler. |
| Texel density | 2.56 px/cm (1024 px per 4 m) | – | Quest 3 ≈ 25 PPD centre ([UploadVR][uploadvr-q3]) ≈ 14 px/cm at 1 m | **About 5× too coarse at arm's length** |
| Overdraw | avg 1.7–3.0, p99 4–6. Landing puffs looking down: 3.6 avg transparent layers, 55 % of the screen ≥ 4 layers | – | Sibling report adopts ≤ 1.5× opaque, ≤ 25 % screen blended ≤ 3 deep | Opaque overdraw already above target. Bursts at the face are the worst case. |
| CPU (desktop Chromium) | whole `_loop` avg 2–4 ms, p95 3.6–6.5 ms; `render()` avg 1.4–3.5 ms | – | Quest CPU is several times slower for JS (unmeasured) | Unknown on device |
| GPU (Quest) | **Never measured on device.** Software-raster A/B only: no ORM −31 %, 0 env lights −23 %. | 72 fps target | VRC.Quest.Performance.1: at least 60 fps sustained, at an allowed refresh such as 72 Hz, tested with OVR Metrics Tool for up to 45 min ([VRC Perf.1][vrc-perf1], search excerpt). 13.9 ms at 72 Hz. | Unknown; must be measured |
| Post-processing | none | none (art plan) | Tile-based GPU; post requires full-screen resolves and loses FFR ([Meta GPU pipelines][meta-gpu-pipelines], sibling report) | Keep at zero on Quest; a desktop tier can add it |
| Stereo submission | 2 passes (no multiview in r170) | – | Multiview halves CPU draw submission. In three.js it exists only in `WebGPURenderer` (`src/renderers/common/XRManager.js`, from 0.176) on its WebGL2 backend, and is still absent from `WebGLRenderer` in 0.186. Verified by grepping npm packages; see also `research/three.md`. | Structural; a decision is needed |

**Headroom summary.**
- Geometry and draws have about **3–9×** headroom.
- Textures can grow about **4×** in resolution for *less* memory than today once compressed. ASTC/ETC2 is roughly
  4–8× smaller than RGBA8.
- Per-pixel lighting has roughly **none**. The fragment budget estimate in `research/quest.md` (§4) is about 1,000 FLOP
  per final pixel, and today's MeshStandard with 3 lights, 3–4 fetches, fog and ACES is already in that range.

---

## 4. What the screenshots show (visual read)

| Shot | Read |
|---|---|
| `review-horror/shots/A3-s1-east-down.png`, `E0-s8-throat-down.png`, `D1-s7-nave.png` | Floors are the strongest image today: lantern-lit ashlar with normal-mapped joints. But the course grid repeats over metres, the lighting is a single warm hotspot, and every edge is a perfect box edge. |
| `e2e/shots/02-s1-start.png`, `B5-s4fix-natural.png` | Wide views are fog plus dark slabs. The statue is a primitive hooded silhouette, colossal towers are black cut-outs, light shafts are uniform pale cylinders. Reads as greybox in fog. |
| `C2-s5-windup.png`, `C4-s5-strike+0.12.png` | The attack, the scariest moment in the game: a symmetric rust disc with 10 pale spikes and white dots, legs as thin black trusses. Graphic and readable, but not frightening: no mouth, teeth, wetness, depth, shadow or impact. |
| `creature/real_s5_player.png`, `shot_A1_player.png` | The approach: a tiny glowing asterisk in near-black. The creature is almost invisible apart from its fronds. The lantern doesn't reach it and nothing silhouettes it. |
| `F2-victory+1.3-lookback.png` | Behind the gate the crown's fronds read as pale thorny branches. The rusted bars are the best-looking asset in the game. |
| Hands, in every shot | Saturated orange primitives that dominate the lower frame. They look like plastic toys in front of a horror scene. |
| `mason2/final/r1/*.png` | The target the owner will judge against: teeth, sinew, wet stone, pits, tendons, scale cues. Nothing in the game is close to it yet. |

---

## 5. Ruthless gap list: "prototype" versus "studio"

Priority: **P0** blocks the owner's ask (scary rigged centipede, 10× graphics). **P1** is needed for "studio" polish.
**P2** is desirable.

### 5.1 The creature

1. **P0. There is no real rig and no path from the new design to the game.**
   - The game creature is 65 rigid parts with weight-1 bones. It has no deformation across segments, so blocks
     gap and intersect at bends.
   - The new *Ossuary* export plan is a static, unskinned, posed 130 k mesh. It has 27 vertebrae and 26–44 legs; the
     sim drives 20 spine points and 10 limbs.
   - Nothing in `creatureView.js` can consume it: the view is name-driven around `Mason_Segment_n`, `Mason_Head` and
     so on.
   - A rig strategy must be chosen:
     - (a) a re-kitted modular creature (segment, leg and crown parts) with proper skin weights at segment seams, or
     - (b) a spine-space curve deform of a straight-authored body using `_SPINE_S` plus a cross-section frame, plus
       separate IK leg chains.
   - The sim's segment and limb counts must also be reconciled with the art (the art plan wants 20–32 segments per
     chapter).
2. **P0. No mouth, jaw or maw in game.** The kit lacks `Mason_Jaw`/`Mason_Membrane`/`Mason_Spine`, so the view's jaw
   hinge (`lunge × 0.55 rad`) never runs. The "crown" is a flat plate. The r1 concept's horror lives in the maw: teeth,
   throat glow, parting tracery, drool. Every attack is seen head-on, so this is the single highest-value asset.
3. **P0. Creature over budget versus plan.** The r2 LOD0 is 130 k triangles against the plan's 25 k (§1.6).
   - Stereo without multiview, that is 260 k vertex-skinned triangles per frame for the creature alone.
   - Either the plan's budget is raised (Meta's 1.5 M soft triangle guidance leaves room) or LOD0 is cut to about
     40–60 k with normal-map baking doing the rest.
   - A decision is needed before rigging. Skinned triangles cost more than static ones.
4. **P0. No authored animation.** All motion comes from about 6 scalars (`frondOpen, glow, lunge, jitter, listen,
   focus`), a 1.3 m rear-back and a 0.16 s lerp. Missing:
   - Pose library: listen (head tilt, pit flare), notice or snap, threat display, wind-up coil, strike, recoil,
     retreat, death-kill, sighting crawl.
   - Secondary motion: dangling chains, jaw chatter, frond tremor at different rates, tail drag, ribs and plates
     breathing apart, tendons tightening.
   - Leg gait character: hesitation, a wrong-way joint snap, a "feeling" probe before planting.
   - Studio horror creatures are animated by hand or with authored layered procedural rigs. This one is a math-driven
     spline.
5. **P0. No impact or footstep FX.** `fx.js` ignores `creature:strike`, `creature:attack` and `creature:step`. Missing:
   - masonry chips and dust where hooks bite,
   - wall cracks or decals along its path,
   - a debris burst and pressure wave at the strike point,
   - a fog swirl on the lunge,
   - grit falling from the column above you.
   - The only creature-linked FX is debris rain on `burst`.
6. **P1. Creature materials are albedo-only.** There is no normal map, so blocks are flat-shaded slabs. There are no
   roughness or AO maps, no wet clearcoat or sheen on flesh and mucus, no subsurface or translucency on fronds and
   membranes, and no emissive maps (glow is a per-part scalar). The concept's horror relies on wetness, specular
   breakup and deep crevice AO.
7. **P1. The creature is under-lit and never shadowed.**
   - Lit only by the lantern and the 2 nearest env lights. No rim or silhouette light, no self-occlusion beyond flat
     colour.
   - No shadow on the wall: the classic horror read of a shadow moving before the creature is impossible.
   - At distance it is a glowing asterisk on black: no silhouette against a lit background, no reveal lighting.
8. **P1. Head-on silhouette.** The crown is radially symmetric (10 evenly ringed fronds, 5 pits). It reads as a
   graphic emblem, not an animal. Asymmetry, depth (throat) and occluding teeth are what read as "mouth".
9. **P2.** No creature LODs are authored (the view supports `_LOD1`, but the kit has none). `mason_hero.glb` is unused.
   The plate jitter is uniform random noise rather than grinding stone. The sighting is only a dark smudge.

### 5.2 Environment

10. **P0. The level is boxes.** 164 axis-aligned boxes and primitive-built decor; no authored meshes. The fix is a
    modular Blender kit with trims, bevels, buttresses, corbels, broken edges and rubble, all using the same collision
    boxes ("collision versus art" is already a principle in the art plan §0.2). Geometry headroom is about 3–9×.
11. **P1. Texel density and tiling.** 2.56 px/cm with one projection and no detail layer: blurry within 2 m, repetitive
    beyond. Needed:
    - higher-resolution or compressed sets,
    - a second detail-normal layer at about 0.5 m,
    - trim sheets for edges,
    - vertex-colour or mask blending (soot, moss, damp, flesh growth),
    - decals (cracks, stains, scratch marks, blood-free organic residue).
12. **P1. No baked or precomputed lighting.** No lightmaps, AO bakes, light probes or vertex lighting. Studio mobile VR
    gets its look from **baked lighting plus a few dynamic lights**. That is the cheapest way to get contact shadows,
    bounce light and colour pools on Quest. Needed: Blender-baked lightmaps or vertex AO for the static kit, plus probes
    for the creature.
13. **P1. No reflections.** No envMap or probe cubemaps: metal, wet stone and flesh can't shine. A per-section prefiltered
    cubemap (static, tiny) is cheap.
14. **P1. Distant world is cut-outs.** Colossal structures are unlit black silhouettes and light shafts are uniform
    cones. They need layered fog cards, lit edges, mid-ground set-pieces and parallax. The S4 Vault and S7 Nave are the
    wide reveals and currently the flattest.
15. **P2. Fog is a colour ramp.** No height fog, no noise or animated density, no lantern-halo inscattering. Cheap
    in-shader variants exist: a height term, a noise texture and a light-direction scattering term.

### 5.3 Lighting, FX, presentation

16. **P1. The lantern is a point light.** No cone, no gobo or cookie, no shadow. The plan's E25 (SpotLight plus fill)
    is not built. A cookie-textured spot would sell "flashlight horror" for one light slot.
17. **P1. Particles are prototype.**
    - Additive soft dots and dodecahedron debris.
    - No soft particles (depth fade), no flipbook smoke or dust, no sparks with stretch, no drips, ash or embers with
      lighting.
    - Landing puffs already create 55 % of the screen with ≥ 4 transparent layers, which is the wrong way to spend
      fill-rate.
18. **P1. Player hands and rope look like toys.** Flat-colour primitives with no texture, wear or mixed materials. The
    rope is an untextured 6-sided tube. These are in view 100 % of the time, so they carry outsized weight in
    perceived quality.
19. **P2. Grading.** One global ACES at 1.2 exposure. Section mood is only the fog and ambient tint. Per-section
    grading can be done in-material (LUT-free curves) without post.
20. **P2. Death and kill presentation** is a fade to black with a flash colour. There is no staged kill cam (it must
    stay comfort-safe: no forced camera motion), no creature-specific fade (for example the crown closing over the
    view as a near-plane mask), and no audio-visual sting.

### 5.4 Pipeline and technology

21. **P0. No texture compression.**
    - Every texture is uncompressed on the GPU (about 84 MB today). Scaling art 5× this way is impossible on bandwidth
      and memory grounds.
    - Vendoring `KTX2Loader` and the basis transcoder (both in the r170 npm package) and baking UASTC/ETC1S is a
      prerequisite for any "10x".
    - Meshopt or Draco for the bigger GLBs to come.
22. **P1. No multiview.** CPU submission doubles. Options:
    - stay on WebGLRenderer and keep draws under about 100 objects,
    - adopt the `super-three` fork's `multiviewStereo` (see `research/quest.md` §5), or
    - migrate to `WebGPURenderer` on its WebGL2 backend (TSL rewrite of every `onBeforeCompile` patch).
23. **P1. No on-device measurement.** All perf numbers come from SwiftShader. A Quest 3 (and 3S) OVR Metrics baseline
    is needed **before** the overhaul budget is spent.
    - `updateTargetFrameRate(72)` is not called.
    - The framebuffer scale is not chosen.
24. **P2.**
    - `onBeforeCompile` string patches (about 10 variants) are fragile against three upgrades.
    - Procedural fallback textures cost main-thread time at boot.
    - There is no authoring-to-engine material standard (glTF PBR, ORM packing and KTX2 in one manifest).

---

## 6. Contradictions and decisions the plan must resolve

| Issue | Evidence | Decision needed |
|---|---|---|
| Creature triangle budget | Art plan §0.4/§1.6: ≤ 25 k LOD0 at 32 segments. r2 export: 130 k / 36 k / 9 k. | Raise the plan budget (about 40–60 k LOD0 is plausible within Meta's 1.5 M soft guidance) or decimate harder and bake the detail into normals. |
| Body topology | Sim: `SEG = 20`, 10 limbs (`creature3d.js`). r1: 27 vertebrae, 26 legs. r2: "44+ legs". Art plan: 20–32 segments per chapter. | Fix the counts. Extra legs can be **cosmetic followers** (procedural IK off the sim's 10 grip legs) if the sim stays at 10. |
| Rig form | Engine: rigid kit parts. r2: a static posed sculpture with `_SPINE_S`. | Modular skinned kit, or a spine-space deform of one body mesh plus IK legs. Either needs a new view. |
| "Studio level" versus "no post, ≤ 4 lights" | Owner wants an Unreal look; Quest is a tile-based mobile GPU. | Two tiers: **Quest** (baked lighting, compressed textures, authored geometry, staged FX) and **Desktop** (add real-time shadows, bloom, SSAO and more lights). |
| 72 fps wording | vrc-checklist cites Meta's "72 fps" common-failures page; the current VRC.Quest.Performance.1 page says ≥ 60 fps sustained at an allowed refresh rate ([VRC Perf.1][vrc-perf1]). | Keep 72 Hz as the target. Gate on no sustained drops below 60. |
| Multiview | Not available in r170 WebGLRenderer; upstream only in WebGPURenderer. | Decide before writing new shaders. A TSL migration would invalidate all `onBeforeCompile` patches. |

---

## 7. Where "10x" can and cannot come from on Quest 3 (honest framing)

**Achievable on Quest 3** (Adreno 740, XR2 Gen 2, 2064×2208 per eye ([Wikipedia][wiki-q3])):
- 5–10× geometric detail in the environment (authored modular kit) and creature (40–60 k LOD0, skinned).
- 4× texel density with *lower* memory (KTX2).
- Baked lightmaps and AO with 2–4 dynamic lights.
- Static reflection probes.
- Decals and trim sheets.
- A cookie-lit spot lantern.
- Authored creature animation with procedural layering.
- Staged FX for every creature beat.
- Better particles within an overdraw cap.

These are the things players perceive as "graphics" in VR.

**Not achievable at 72 Hz stereo on Quest:**
- Desktop-Unreal features: dynamic GI (Lumen), virtualised geometry (Nanite), real-time shadows from several lights,
  volumetric fog with shadowed scattering.
- Full-screen post stacks: bloom, SSAO, SSR, motion blur, DOF. Tile-based resolves are expensive and post-processing
  render targets lose fixed foveation ([Meta GPU pipelines][meta-gpu-pipelines]; `research/quest.md`).

Those belong in an optional **desktop tier**.

---

## 8. Sources

**Web** (Meta pages are quoted from search-engine excerpts because `developers.meta.com` was unreachable from this
sandbox; the sibling report `research/quest.md` quotes them in more depth):
- [meta-devcomp]: Meta, *Device optimization comparison* (Quest 3: 72 Hz minimum, 13.8 ms budget, < 200 draw calls,
  < 1.5 M triangles) — https://developers.meta.com/horizon/resources/device-optimization-comparison/
- Meta, *Unity performance* (Quest 3/3S draw-call ranges by workload) — https://developers.meta.com/horizon/documentation/unity/unity-perf/
- [meta-webxr-bp]: Meta, *WebXR performance best practices* (KTX 2.0 / Basis Universal recommended) — https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
- Meta, *WebXR performance optimization workflow* (FFR, draw-call CPU cost) — https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/
- [meta-gpu-pipelines]: Meta, *Advanced GPU pipelines* (tile-based rendering, tile memory) — https://developers.meta.com/horizon/documentation/unity/po-advanced-gpu-pipelines/
- Meta, *Fixed foveated rendering* — https://developers.meta.com/horizon/essentials/fixed-foveated-rendering
- [vrc-perf1]: Meta, *VRC.Quest.Performance.1* (≥ 60 fps sustained, allowed refresh rates, OVR Metrics, 45 min) — https://developers.meta.com/horizon/resources/vrc-quest-performance-1/
- Meta, *Common VRC failures* ("72 frames per second" wording) — https://developers.meta.com/horizon/resources/publish-common-vrc-failures/
- [wiki-q3]: Wikipedia, *Meta Quest 3* (XR2 Gen 2, Adreno 740, 2064×2208 per eye) — https://en.wikipedia.org/wiki/Meta_Quest_3
- [uploadvr-q3]: UploadVR, *Quest 3 specs* (25 PPD; 110°×96° FOV) — https://uploadvr.com/quest-3-specs
- Meta, *Quest compare* (Quest 3 1218 PPI, 25 PPD; Quest 3S 20 PPD) — https://www.meta.com/gb/quest/compare/
- three.js docs, *KTX2Loader* (Basis Universal transcoding, transcoder in `examples/jsm/libs/basis`) — https://threejs.org/docs/pages/KTX2Loader.html
- three.js docs, *XRManager* (multiview flag on the common/WebGPU renderer) — https://threejs.org/docs/pages/XRManager.html
- MDN, *OVR_multiview2* (WebGL2 only; no multisampled backbuffer; Oculus browser's OCULUS_multiview keeps MSAA) — https://developer.mozilla.org/docs/Web/API/OVR_multiview2
- Third-party, low weight: Paradowski, KTX2 memory reduction claim — https://paradowski.com/stories/introducing-zencompress-for-gltf

**Code inspection** (npm registry packages, unpacked under
`/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad/plans/three-full/` and
`.../plans/research/npmcheck/`):
- three 0.170.0 `src/` has no `multiview` string. It ships `examples/jsm/loaders/KTX2Loader.js`, `DRACOLoader.js` and
  `examples/jsm/libs/basis/`.
- three 0.171.0 and 0.172.0: no multiview.
- three 0.186.0: multiview only in `src/renderers/common/XRManager.js`, `Renderer.js` and
  `webgl-fallback/nodes/GLSLNodeBuilder.js` (requires `GL_OVR_multiview2`). Disabled for WebGPU XR ("does not support
  multiview yet"). Absent from `WebGLRenderer.js` and `webxr/WebXRManager.js`.

**Project files** (local):
- `public/abyssal-tether-3d/src/render/renderer3d.js`, `materials.js`, `creatureView.js`, `fx.js`, `levelView.js`,
  `handsView.js`, `ropeView.js`
- `src/sim/creature3d.js`, `src/data/level-data-3d.js`, `src/game.js`
- `public/abyssal-tether-3d/assets/models/mason_kit.glb`, `mason_hero.glb`, `assets/textures/manifest.json`
- `tools/abyssal-tether-3d/README.md`, `build_mason.py`, `build_textures.py`, `fetch_polyhaven.py`, `previews/*.png`
- `docs/abyssal-tether-3d/ART_AUDIO_PLAN.md` (§0.4 budgets, §1.6 Mason kit v2, §4 lighting rules), `vrc-checklist.md`
- Scratchpad (`/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad/`):
  - `3d/review-perf/out/render-quick.log`, `render-audit.json`, `gpu.log`, `rcpu.log`
  - `3d/review-horror/shots/*.png`, `3d/e2e/shots/*.png`, `3d/creature/*.png`
  - `mason2/final/r1/{hero,approach,full,silhouette}.png`, `stats.json`, `final.log`
  - `mason2/final/build_r2.py` (header and `export_game()`)
  - `INTEGRATION_NOTES.md`
- Sibling research: `plans/research/quest.md` (hardware budgets, multiview options, fragment estimate) and
  `plans/research/three.md` (r170 capabilities).

[meta-devcomp]: https://developers.meta.com/horizon/resources/device-optimization-comparison/
[meta-webxr-bp]: https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
[meta-gpu-pipelines]: https://developers.meta.com/horizon/documentation/unity/po-advanced-gpu-pipelines/
[vrc-perf1]: https://developers.meta.com/horizon/resources/vrc-quest-performance-1/
[wiki-q3]: https://en.wikipedia.org/wiki/Meta_Quest_3
[uploadvr-q3]: https://uploadvr.com/quest-3-specs
