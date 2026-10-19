# three.js r170 technique inventory for the Abyssal Tether 3D visual upgrade

**Scope.** This report lists the rendering techniques that three.js **r170** (`three@0.170.0`, the version vendored in `public/abyssal-tether-3d/vendor/three`) actually ships. For each one it says whether it works inside WebXR on Quest 3, roughly what it costs, and how this game would use it. It ends with a ranked list by **visual gain per millisecond on Quest 3**, a vendoring list, and pitfalls.

**Method.**
- **r170 source.** I unpacked the real package (`npm pack three@0.170.0`) into `plans/three-full/package` and read the code. File and line references below point there.
- **Later versions.** I also packed later versions (0.172, 0.174, 0.175, 0.176, 0.178, 0.180, 0.186.1) to check when features such as multiview arrived.
- **This game's renderer.** I read `src/render/*.js` so every proposal fits the code as it is.
- **Hardware and API limits.** These are cited at the end. Where a URL could only be reached through search results (the developers.meta.com pages refused direct fetches), I name the page and quote what the search surfaced.
- **What I did not do.** No Blender runs, no Chromium, no device measurements. The rule was not to touch anything under `/home/user/TradeCheckPro`.

> **Honesty box: what "10x the graphics" can mean on a Quest 3**
>
> **Hardware.**
> - Quest 3 is an Adreno 740 at 640 MHz (Snapdragon XR2 Gen 2). Meta puts it at roughly 2.5x a Quest 2 GPU [S6][S16].
> - At render scale 1.0 it shades 1680×1760 px per eye, two eyes per frame. A render scale of about 1.2 matches the physical 2064×2208 panel [S8].
>
> **Budget.**
> - At 72 Hz the frame budget is 13.8 ms [S6].
> - Meta's draw-call guidance for Quest 3 is "< 200" per frame, and "< 1.5 M" triangles [S6].
>
> **What r170 lacks.**
> - WebGLRenderer r170 has **no multiview**. Every draw call and every vertex is processed twice, once per eye (see §1.2).
> - There is **no XR-capable post-processing** (see §1.3).
> - So the GPU will not get 10x faster, and a full-screen "Unreal" stack (SSAO, SSR, bloom chain, volumetric raymarching) is **not** available on standalone Quest.
>
> **What is achievable.** A different-looking game, where most of the change comes from:
> 1. **Light and air:** baked bounce light and occlusion everywhere, plus volumetric-looking fog lit by the lantern.
> 2. **Surfaces:** compressed textures at 2x resolution, wet specular response, real geometric relief instead of boxes.
> 3. **A hero creature:** about 10x the triangle count of today's 5k-triangle kit, with real skinning, wet clearcoat flesh, and a lantern shadow.
> 4. **A unified cinematic grade.**
>
> Nearly all of this is ALU work or a single texture fetch inside the shaders that already run, which is the only kind of addition a tile-based mobile GPU tolerates in stereo.
>
> The desktop tier (non-XR) can add the real post stack on top (§6).

---

## 0. Where the renderer stands today (from the code)

| Area | Today (r170, `src/render/*`) | Consequence for the upgrade |
|---|---|---|
| Output | `ACESFilmicToneMapping`, exposure 1.2, sRGB out, no post, `antialias: true` (MSAA), `setFoveation(1)` (max) | Tone mapping runs **inside every material's fragment shader** (§1.4). Grading must happen there too. |
| Lights | 1 lantern `PointLight` + **2** pooled env `PointLight`s (fixed count, no recompiles) + `HemisphereLight` | Every lit fragment pays for 3 lights. The rest of the level's lamps only "read" through glows and emissive. Baked light is the way to light everything (§2.1). |
| Fog | Global `ShaderChunk` patch (`installRadialFog`): radial distance fog with a front-loaded curve. Applied **after** tone mapping and sRGB encode (r170 chunk order). | This is the hook for analytic in-scattering (§2.6). The fog should move before tone mapping. |
| World geometry | **Instanced unit boxes** per material bucket, re-packed near the head. World-space dominant-axis UVs via `onBeforeCompile`. Merged decor per 64 m band. | Fine for draw calls, but every wall is a flat box. Stereo exposes flat normal-mapped surfaces at grappling range (§2.10). |
| Textures | 5 PBR sets (rock, masonry, metal, rockFar, flesh), 1024², **JPEG** albedo/normal/ORM | About 84 MB VRAM if uploaded as RGBA8 with mips (estimate: 15 maps × 1024² × 4 B × 1.33). Main-thread JPEG decode. KTX2 fixes both (§2.13). |
| Creature | `mason_kit.glb`: 12 meshes, 4,990 triangles, no textures, no skin or animation. Assembled into one `SkinnedMesh` with one **rigid** bone per part (about 65 parts). | The new rigged Mason replaces this with a continuously skinned mesh (§2.8). |
| Precompile | `renderer.compile()` (synchronous) + `initTexture` | Must become `compileAsync` once the shader variant count grows (§2.17). |
| Session | `requestSession('immersive-vr', {optionalFeatures: ['local-floor','bounded-floor','hand-tracking']})`: **no `'layers'`** | three uses the `XRWebGLLayer` path, not the projection-layer path (§1.2). |

Cost classes used below. These are estimates for Quest 3 at render scale 1.0, stereo, 72 Hz. They are model-based (op and fetch counts relative to the current Standard + 3-light shader), so treat them as ±2x and confirm with OVR Metrics Tool GPU time:

- **Free:** < 0.1 ms
- **Low:** 0.1–0.5 ms
- **Medium:** 0.5–1.5 ms
- **High:** 1.5–4 ms
- **Prohibitive:** > 4 ms, or structurally broken in XR

---

## 1. r170 facts that constrain everything (verified in source)

### 1.1 Budget numbers (cited)
- **Meta device comparison [S6].**
  - Quest 3 target 72 Hz (90 recommended), 13.8 ms frame budget.
  - Draw calls < 200, triangles < 1.5M per frame.
  - Panel 2064×2208 per eye, GPU about 2.5x Quest 2.
- **Meta Unity perf doc [S15].** Quest 3 draw-call tiers by app type: "200-300 busy / 400-600 medium / 700-1000 light".
- **WebXR draw-call budget for this game.** WebXR adds JavaScript plus three's per-draw uniform work, and r170 doubles every draw for stereo. The existing renderer's own rule is "≤150 calls for BOTH eyes". Keep it.
- **VRC.Quest.Performance.1 [S7]** requires a **sustained rendering rate of ≥ 60 fps**, while interactive apps must run at a 72/80/90/… Hz display rate. Loading screens and full-screen fades are exempt.
  - Practically: target 72 fps with a margin, so dips stay above 60.
  - The exemption matters: shader compiles and uploads must happen behind fades and menus (§2.17).
- **Tile-based GPU [S9][S11].**
  - Rendering to an intermediate target and copying to the swapchain costs a "resolve": about 0.5 ms per eye buffer on Quest by Meta's napkin math, or 1–1.5 ms per the RenderDoc guide.
  - MSAA and fixed foveation only apply when the final pass writes **directly** to the swapchain.
  - MSAA samples live in tile memory, so 4x MSAA is nearly free.
- **Default WebXR resolution.** WebXR renders at the headset's recommended resolution [S22]: 1680×1760 per eye on Quest 3 at render scale 1.0 [S8].

### 1.2 No multiview in r170 WebGLRenderer, so stereo doubles vertex and draw work
- **r170 has no multiview path.** `src/renderers/webxr/WebXRManager.js` has no multiview code. `WebGLRenderer.render` loops `camera.cameras` and calls `renderScene` once per eye (`WebGLRenderer.js:1233-1255`).
- **Every draw is issued twice and every vertex shader runs twice.** This includes skinning, morphs, and instancing.
- **Later versions don't fix it for WebGLRenderer.** I grepped the npm packages. Multiview (`OVR_multiview2`) appears **only in `WebGPURenderer`'s `src/renderers/common/XRManager.js`**, from **0.176.0** onward (absent in 0.175.0). It is still absent from `WebGLRenderer`/`WebXRManager` in **0.186.1**.
- **So moving three versions is not a multiview shortcut.** Getting multiview means migrating to WebGPURenderer with TSL node materials. Every `onBeforeCompile` patch in `materials.js` and `creatureView.js` would have to be rewritten. Not recommended for this production.
- **Meta's view.** Meta's WebXR perf workflow lists multiview and instancing as the main draw-call reducers [S12][S13]. We get the instancing half.
- **Implication for the rig.** Vertex-heavy features (skinning, morphs, displaced tiles) cost 2x. Fragment work is unaffected, because each eye is a separate set of pixels anyway.
- **What the session gets today.** The game does not request `'layers'`, so three uses `new XRWebGLLayer(session, gl, {antialias, ...})` (`WebXRManager.js:278-300`).
- **If the session asks for `'layers'`** (three's own `VRButton` does), three uses `XRWebGLBinding.createProjectionLayer` with a 4-sample render target. It goes through `WEBGL_multisampled_render_to_texture` (`WebXRManager.js:309-348`, `WebGLTextures.js:2084-2088`), the on-tile resolve path Meta funded [S5].
  - Worth an A/B on device. It is a one-word change, but it is **not** a visual feature.

### 1.3 No post-processing in XR on r170
- **Composer support was removed.** Three.js reverted EffectComposer support in WebXR in PR #26904 (Oct 2023) [S3]. `EffectComposer`'s full-screen quad camera is replaced by the XR `ArrayCamera` inside `render()`, so the stock composer breaks in a session.
- **The official route arrives later.** It is `renderer.setEffects([...])` plus `outputBufferType: HalfFloatType` in **r182** (PR #32461) [S4]. The maintainers flagged that the double-pass approach is "quite noticeable performance-wise" there.
- **On Quest it is costly regardless of API.** Each full-screen pass is a render-target switch on a tiler: a resolve, a per-pixel copy, and MSAA and foveation lost on intermediates [S9][S11].
- **Conclusion: Quest gets zero full-screen passes.** Bloom, LUT grading, AO and fog all have to be done inside material shaders or as geometry.

### 1.4 Per-material tone mapping, colour space and fog order
- **Chunk order in r170** (`meshphysical.glsl.js`, tail): `opaque_fragment` → `tonemapping_fragment` → `colorspace_fragment` → `fog_fragment` → `premultiplied_alpha_fragment` → `dithering_fragment`.
- **When tone mapping applies.** Only when the target is the canvas or the XR render target (`WebGLRenderer.js:1800-1806`). That is always the case on Quest.
- **Fog is not tone-mapped.** `fogColor` is uploaded in the **output** colour space (`UniformsUtils.getUnlitUniformColorSpace`). So fog mixes in sRGB after tone mapping.
  - That is fine for plain haze. It is wrong for lantern in-scattering, which must be HDR so it rolls off through the tone curve. §2.6 moves the fog mix before `tonemapping_fragment`.
- **The grading hook.** `CustomToneMapping` exists as a hook. `tonemapping_pars_fragment` ends with `vec3 CustomToneMapping( vec3 color ) { return color; }`, which can be replaced through `ShaderChunk`, the same way `installRadialFog` already patches chunks. AgX (`AgXToneMapping`) and Khronos Neutral (`NeutralToneMapping`) are both present.

### 1.5 Other verified r170 behaviours that matter here
- **`aoMap` only darkens indirect light** (`aomap_fragment.glsl.js`): `indirectDiffuse`, plus clearcoat, sheen and env specular occlusion. **`lightMap` adds to `irradiance`** inside `RE_IndirectDiffuse` (`lights_fragment_maps.glsl.js`). This game is lit mostly by the lantern (direct light), so a stock aoMap barely shows. Patch it to also scale `directDiffuse` partially (§2.1).
- **Shadows.**
  - The shadow pass runs once per frame, not per eye.
  - Depth is RGBA-packed (`MeshDepthMaterial({depthPacking: RGBADepthPacking})`, `WebGLShadowMap.js:24`). Sampling is a manual `texture2DCompare`.
  - `PCFShadowMap` is **17 taps**, `PCFSoftShadowMap` 16 taps, `BasicShadowMap` 1 tap (`shadowmap_pars_fragment.glsl.js`).
  - `LightShadow` has `autoUpdate`, `needsUpdate` and `intensity`, so shadows can be frozen or faded **without** a program change. Toggling `castShadow` changes `NUM_*_SHADOWS` and recompiles.
- **Skinning** (§2.8): no bone-count uniform limit.
  - Bones are packed into a float `DataTexture` sized `ceil(sqrt(4·N)/4)·4` (`Skeleton.js:161-182`) and read with `texelFetch` (`skinning_pars_vertex`).
  - `skeleton.update()` runs **once per frame** even in stereo (`WebGLObjects.js:47-56`).
  - `SkinnedMesh.computeBoundingSphere()` CPU-skins every vertex once, lazily, and then goes stale. Set it manually.
- **Morph targets.** Stored in a `DataArrayTexture` and looped over `MORPHTARGETS_COUNT` per vertex, skipping zero influences (`morphtarget_vertex`).
- **BatchedMesh.**
  - Uses `WEBGL_multi_draw` when present. Otherwise it **loops plain draws** (`WebGLRenderer.js:867-889`).
  - Does per-instance frustum culling and sorting on the CPU in `onBeforeRender` **per eye camera** (`BatchedMesh.js:1246+`).
  - Has per-instance matrix and colour only.
- **Transmission** (`MeshPhysicalMaterial.transmission > 0`): for an `ArrayCamera`, r170 re-renders **all opaque objects** into a 4x MSAA half-float mipmapped target **for each eye** before the main pass (`WebGLRenderer.js:1233-1245, 1461-1500`). That is prohibitive on Quest.
- **Geometric specular anti-aliasing is built in.** It is based on the *unperturbed* normal: `roughness += max(dFdx/dFdy of nonPerturbedNormal)` (`lights_physical_fragment`). Normal-map shimmer on wet surfaces is not covered, which is why §2.13 adds Toksvig mips.
- **`compileAsync`.** It is `compile()` plus polling `program.isReady()`, non-blocking when `KHR_parallel_shader_compile` exists (`WebGLRenderer.js:1032-1090`).
  - `compile()` compiles **every** material in the scene, hidden objects included (`scene.traverse`), but gathers **lights** only from visible objects (`traverseVisible`).
  - It does **not** warm the shadow-pass depth materials.
- **Programs compiled outside XR are reused in XR.** The program key's `outputColorSpace` and `toneMapping` match for a null target and the XR target (`WebGLPrograms.js:169, 202`). So precompiling on the menu, before entering VR, is valid.

---

## 2. Technique inventory

Each entry covers: **what it is in r170**, **whether it works in WebXR on Quest**, **cost**, **how we use it here**, and a **verdict**.

### 2.1 Baked lighting: irradiance and AO volume (custom), lightMap with a UV channel, aoMap

- **r170 API.**
  - `material.lightMap` with `lightMapIntensity`. The UV set is chosen with `texture.channel`: 0 = `uv`, 1 = `uv1`, … (`Texture.js:38`). GLTFLoader maps `TEXCOORD_n` and `texCoord` onto that.
  - `material.aoMap` with `aoMapIntensity` reads **R**, so the existing ORM layout works.
  - `Data3DTexture` (WebGL2 `sampler3D`) for volumes.
  - There is **no** built-in irradiance volume or probe grid in r170 WebGL (grep: none). `misc/ProgressiveLightMap.js` is an in-browser accumulator, not a baker for this game.
- **Works in XR:** yes, all of it. It is plain fragment work.
- **Cost.**
  - Lightmap or AO map: **Free–Low** (1 fetch).
  - Volume: **Low**, one trilinear 3D fetch per fragment, about 0.2–0.4 ms full-screen.
  - VRAM: about 1.5–4 MB per section at 1 m voxels (RGBA8).
- **How we use it here (the single biggest "looks expensive" win).**
  1. **Irradiance and AO volume per section, baked by a small Node script, not Blender.**
     - The level is axis-aligned boxes plus `level.lights`. For every voxel (1 m grid inside `section.shaft`; the largest, S7, is 80×136×80 voxels), cast rays against the boxes with a slab test and a uniform-grid acceleration.
     - Store RGB = sum of visible static lights' irradiance plus a sky/fog bounce term, and A = ambient visibility (AO).
     - Ship as RGBA8 (sqrt-encode RGB), upload as `Data3DTexture` with `LinearFilter`.
     - Sample in every world material at `worldPos + N·0.5 voxel`. Add `vol.rgb` to indirect irradiance, multiply `indirectDiffuse` by `vol.a`, and multiply `directDiffuse` by `mix(1, vol.a, ~0.35)`. The partial direct AO keeps contact darkening visible under the lantern.
     - **Result:** every lamp in the level now lights its surroundings with soft occlusion, not only the 2 pooled `PointLight`s, and corners and niches darken. That is the "GI" look.
     - Sample the same volume **per vertex** in the creature shader, so the Mason darkens in niches and picks up lamp colour as it crawls past.
     - Cross-fade two volumes over the existing ±9 m theme-blend band.
     - Use one bake per difficulty variant, or one shared bake. The error from variant-only solids is soft and acceptable.
     - WebGL2 limits: `MAX_3D_TEXTURE_SIZE` is ≥ 256 by spec, and web3dsurvey reports ≥ 2048 on every surveyed device [S27]. 80×136×80 fits. Query it at runtime anyway.
  2. **`lightMap` on `uv1` only for authored, unique static set pieces** (statues, arches, the Still Lamp chamber, machinery). Bake them in Blender Cycles with the existing bpy pipeline.
     - Instanced modules cannot use lightmaps, because instances share UVs.
  3. **Per-module baked AO in the ORM R channel** for instanced kit modules (§2.10). Self-occlusion is intrinsic to the mesh, so it is valid for every instance. The volume handles inter-object light.
- **Verdict:** **Tier 1** (rank #2).

### 2.2 LightProbe (SH) and LightProbeGenerator

- **r170 API.** `LightProbe` (9 SH coefficients, summed globally into `lightProbe[9]`, `lights_pars_begin`). Generated with `addons/lights/LightProbeGenerator.js` (6,480 B): `fromCubeTexture`, async `fromCubeRenderTarget` (GPU readback).
- **Works in XR:** yes. Changing whether a probe exists changes `numLightProbes` in the program key, so keep **one probe always present** and only change its coefficients, the same pattern as the fixed PointLight pool.
- **Cost:** **Free**, about equal to the hemisphere light it would replace.
- **Use here.** Per-section ambient with directional colour, for example the cold "far" light flooding the S7 vault from one side. Generate it from a per-section cube capture at load, or from Blender-baked cubemaps, and lerp coefficients in the theme blend.
  - It is global, not per object, so it cannot replace §2.1. It is the **fallback** if the volume baker slips.
- **Verdict:** Tier 2 (cheap, small gain once §2.1 exists).

### 2.3 PMREM environment maps for reflections

- **r170 API.**
  - `PMREMGenerator` (`src/extras/PMREMGenerator.js`): `fromScene(scene, sigma, near, far)`, `fromCubemap`, `fromEquirectangular`. The output is a CubeUV atlas of width `3·max(cubeSize, 112)` and height `4·cubeSize`.
  - Sampling (`cube_uv_reflection_fragment`) is 2 mip levels × 1 bilinear fetch for radiance, plus about 2 more for irradiance. That is roughly **4 fetches plus ALU per fragment** on `MeshStandardMaterial`, more with clearcoat.
- **Works in XR:** yes. Build at **load** time, never during a session frame (6 face renders plus blur passes).
- **Cost:**
  - **Medium** on the pixels that use it (about 0.3–0.8 ms if it covers most of the screen).
  - VRAM: cubeSize 128 gives a 384×512 half-float atlas, about 1.5 MB per section.
- **Use here.**
  - **What it adds.** In a dark shaft, reflections mostly show glows, lit windows and lamp flames. That is valuable on wet stone and iron, but secondary to direct lantern specular, which is already free.
  - **Build it.** Make one capture per section at load: a `CubeCamera` at the section centre, static lights on, then PMREM.
  - **Assign it per material**, on wet and metal materials only. Do **not** set it as `scene.environment`, which would add the fetches to every material.
  - **Box-project it** with an `onBeforeCompile` patch on the env lookup, intersecting the reflection ray with the section's known shaft AABB (`section.shaft`). Without this, reflections slide wrongly in a 600 m vertical shaft.
- **Verdict:** Tier 2 for Quest (metals and wet masks only). On the desktop tier, use it broadly.

### 2.4 MeshPhysicalMaterial: clearcoat, sheen, transmission (and iridescence, anisotropy)

- **r170 API.** `MeshPhysicalMaterial`. GLTFLoader auto-creates it when a glTF uses `KHR_materials_clearcoat`, `_sheen`, `_transmission`, `_iridescence`, `_anisotropy`, `_volume`, `_ior`, `_specular` or `_dispersion` (vendored `GLTFLoader.js:489-507`). Blender's Principled BSDF coat and sheen export to these. Watch for it, because it silently upgrades materials to Physical.
- **Per-light cost (`RE_Direct_Physical`).**
  - **Clearcoat** adds a second GGX lobe per light (about +30–40 ALU each), a clearcoat normal, and a second IBL lookup when `envMap` is set.
  - **Sheen** adds a Charlie BRDF per light.
  - **Iridescence** is heavy ALU (thin-film Fresnel).
  - **Transmission** adds the per-eye opaque re-render pass (§1.5).
- **Works in XR:** clearcoat, sheen and iridescence yes. Transmission works, but it is **prohibitive**.
- **Cost on Quest with 3 lights:**
  - Clearcoat: **Medium** on the pixels it covers.
  - Sheen: Low–Medium.
  - Iridescence: Medium–High.
  - Transmission: **Prohibitive**.
- **Use here.**
  - **The Mason's flesh and sinew gets `MeshPhysicalMaterial` with clearcoat**, even on Quest. Clearcoat about 0.6–1.0, clearcoat roughness 0.08–0.2, over a rougher base: a thin wet membrane over tissue. The lantern then draws a sharp moving wet highlight across the body, the scariest material read for the money.
    - It only costs on the creature's pixels. Usually 0–15 % of the screen; up to about 40 % during an attack, which is a short burst.
  - **Fronds and membrane: sheen** for a velvety back-scatter on the sensory fronds. Desktop tier only, unless profiling shows headroom.
  - **World stone:** stays `MeshStandardMaterial` with the wetness injection (§2.5), not clearcoat. The walls cover the whole screen, and a second lobe on 100 % of pixels is not worth it on Quest. The desktop tier can switch to clearcoat.
  - **Never use** transmission or iridescence in the Quest build.
- **Verdict:** Tier 1 on the creature, desktop-only elsewhere.

### 2.5 `onBeforeCompile` shader injections (the project's existing mechanism)

- **r170 API.** `material.onBeforeCompile(shader)` plus `material.customProgramCacheKey()`. `materials.js` already uses both and patches global chunks in `installRadialFog`.
  - **Stability.** Chunk names are r170-specific, which is one more reason to stay pinned to r170.
  - **Shared uniforms.** Global custom uniforms (lantern position, volume, grade) must be added per material in `onBeforeCompile` (`shader.uniforms.atX = SHARED.atX`).
    - `UniformsUtils.clone` copies Vector, Color and Texture values per material (`UniformsUtils.js:7-35`).
    - So putting them into `ShaderLib` does not give live shared values.
    - Write one `patchAtmosphere(material)` helper. It should chain any existing callback and cache key, and every module (level, creature, hands, rope, fx) should call it.
- **Works in XR:** yes. These are ordinary shader edits.

| Injection | What it does here | Cost (Quest) | Verdict |
|---|---|---|---|
| **Wetness and drips** | World-height or section-driven wet mask. Water darkens albedo by 30–50 %, roughness drops to about 0.15–0.3, the normal map flattens slightly. On vertical faces, add a **time-scrolled drip-streak mask** (1 fetch of a 256² tiling streak texture) and a top-face pooling term (reuse `vAtTop`). Turns lantern specular into moving glints. | **Low** (1–2 fetches + ALU) | **Tier 1** (rank #5) |
| **Triplanar** | 3x fetches per map: 9 fetches for albedo, normal and ORM. Today's dominant-axis box UVs are 1x. Use authored UVs for kit modules and the creature. If blending is needed, use *biplanar* (2x) only on the organic ribs and growths. | High if broad | Avoid on Quest, except biplanar on organics |
| **Parallax occlusion (POM)** | Not built into r170 (only `bumpMap`, `normalMap`, and per-vertex `displacementMap`). A 6–12 step loop on masonry would fix the "flat wall in stereo" problem at grappling range. | **Medium–High** because walls fill the view while you hang on them | Near-only (< 6–8 m, steps fade with distance) on masonry, or prefer real relief geometry (§2.10). Tier 3. |
| **Dissolve / erosion** | Noise threshold plus `discard`, with an emissive or ichor rim. For the Mason pulling free of masonry, crumbling ledges, and death. | ALU-Low, but `discard` disables early-Z/LRZ for that draw on Adreno | Compile it as a **separate variant** swapped in only during the effect, precompiled. Tier 2. |
| **Vertex wobble / breathing** | After `#include <skinning_vertex>`, displace flesh along the normal with low-frequency noise × a flesh weight (vertex colour), threat-scaled. Pits pulse, sinew breathes. | **Low** (vertex, ×2 eyes) | **Tier 1** with the creature |
| **Rim / wrap / fake SSS** | In the creature's direct-light function: wrap diffuse `(N·L + w)/(1 + w)` plus back-light translucency `saturate(dot(-N, L))·thickness` tinted blood-amber (thickness = vertex colour or texture A). Add a fog-colour fresnel rim so the silhouette reads in the dark. | **Low** | **Tier 1** with the creature |
| **AO on direct light** | After `aomap_fragment`: `reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, k)`. | Free | Tier 1 (with §2.1) |

### 2.6 Fog volumes: layered noise planes vs raymarch vs **analytic** (recommended)

- **r170 API.** `Fog` and `FogExp2` only. `addons/shaders/VolumeShader.js` and the cloud examples raymarch 3D textures, which is desktop material.
- **Raymarch on Quest is prohibitive.**
  - Even 16 steps × 1 3D-noise fetch × 2 × 1680×1760 px × 72 Hz is about 6.8 G fetches/s, before lighting the samples.
  - It also needs scene depth, which XR does not expose mid-pass (§2.11).
- **Layered noise planes are Medium, scaling with overdraw.**
  - Each camera-facing layer covers most of the view inside the shaft.
  - 4–6 layers give 4–6x full-screen blended overdraw with 1 fetch each.
  - Blending stays in tile memory, so it is cheaper than on desktop, but fragment work adds up.
- **Recommended: an analytic atmosphere in the existing global fog chunk.** It costs **ALU only**, about **20–30 ALU per light per fragment, Low (≈0.2–0.4 ms for 3 lights)**.
  1. **Move fog before tone mapping.** Replace `fog_fragment` with an empty chunk. Do the fog mix at the start of `tonemapping_fragment` in linear HDR. Linearise `fogColor` with r170's `sRGBTransferEOTF`.
  2. **Add lantern in-scattering** (single scattering, isotropic phase, homogeneous medium [S20]). For a view ray from the eye with direction **v** to the fragment at distance *d*, and a light at view-space position **s**:
     - `b = −s·v`, `h = sqrt(|s|² − b²)`
     - `L_in = σ · I_light · ( atan((d + b)/h) − atan(b/h) ) / h`
     - I checked this closed form against numeric integration (relative error < 1e-9; `plans/scripts/inscatter_check.mjs`).
     - This produces the halo around the hand lantern, the visible cone of lit air as the lantern swings, and the haze glow around each env lamp, none of which exist today.
     - Apply it for the lantern and both pooled env lights. Optionally apply it to the gate and Still Lamp with a fixed light.
  3. **Optional height and density modulation.** Use the existing radial fog, plus an exponential-height term per section (denser low in each section, so the "abyss below" reads), plus a very low-frequency 3D-noise density (1 fetch of a 32³ tiling noise). This breaks up the uniform haze.
  4. **Add a fog dome.** A large inverted sphere around the head (1 draw, `depthWrite false`, rendered last) using the same fog and in-scatter code. Pixels that hit nothing (looking down the abyss) then get the halo and the gradient instead of the flat `scene.background` clear colour.
- **GLSL sketch** (fragment, view space; `vAtView = mvPosition.xyz` from the patched `fog_vertex`):

```glsl
// replaces '#include <tonemapping_fragment>' (fog_fragment chunk emptied)
#ifdef USE_FOG
  float atD = length( vAtView );
  vec3  atV = vAtView / atD;
  vec3  atS = ( viewMatrix * vec4( atLanternPos, 1.0 ) ).xyz;   // per eye: viewMatrix differs
  float atB = -dot( atS, atV );
  float atH = sqrt( max( dot( atS, atS ) - atB * atB, 1e-4 ) );
  float atI = ( atan( ( atD + atB ) / atH ) - atan( atB / atH ) ) / atH;
  float atF = atFogFactor( atD );
  vec3  atFog = sRGBTransferEOTF( vec4( fogColor, 1.0 ) ).rgb;  // fogColor arrives in output space
  gl_FragColor.rgb = mix( gl_FragColor.rgb, atFog, atF )
                   + atLanternColor * atScatter * atI * ( 1.0 - 0.5 * atF );    // + 2 env lights likewise
#endif
#if defined( TONE_MAPPING )
  gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif
```

- **Caveat.** There is no occlusion in the in-scatter integral. For the hand lantern that is invisible. For env lamps, cap intensity and range so their haze does not leak through walls.
- **Verdict:** **Tier 1, rank #1.** This is the "Unreal volumetric fog" read for a few dozen ALU.

### 2.7 God-ray cards / light shafts

- **r170 API.** Nothing XR-ready. `addons/shaders/GodRaysShader.js` is a screen-space post pass, so it is desktop only. The game already has an additive `lightShaft` material with a facing-ratio and near-fade patch.
- **Works in XR:** yes, as geometry.
- **Cost:** **Low** (overdraw only where beams are).
- **Upgrade.**
  1. Make the cone or box mesh compute **analytic thickness**: the ray-cone intersection length in the fragment shader, about 15 ALU. Beams then look volumetric from any angle, including from inside, instead of looking like planes.
  2. Multiply by 1 fetch of slowly scrolling noise.
  3. Fade with the fog factor and near distance (already present).
  4. Add a few instanced **dust motes** that only show inside beam volumes. Test analytically in the particle vertex shader against the beam's cone parameters.
- **Verdict:** Tier 2 (rank #10).

### 2.8 SkinnedMesh + AnimationMixer for the rigged Mason, with procedural bones on top

- **r170 API.**
  - `SkinnedMesh` and `Skeleton`: a bone texture with no bone limit. A 256-bone skeleton is a 32×32 RGBA32F texture, 16 KB uploaded per frame.
  - The vertex shader does 4 bone matrices = 16 `texelFetch` per vertex per eye.
  - `AnimationMixer` and `AnimationAction`: `play`, `fadeIn`/`fadeOut`, `crossFadeFrom`/`crossFadeTo`, `setEffectiveWeight`, `setEffectiveTimeScale`, `warp`, `syncWith`, `setLoop`.
  - Additive clips: `AnimationUtils.makeClipAdditive(clip)` sets `clip.blendMode = AdditiveAnimationBlendMode` (`AnimationUtils.js:214`, assignment at line 331), and `mixer.clipAction(clip)` inherits it (`AnimationMixer.js:516-536`).
  - `AnimationUtils.subclip`.
  - `addons/utils/SkeletonUtils.js` (8,802 B) for `clone` and `retarget`. Not vendored yet.
- **Works in XR:** yes.
- **Cost:**
  - **Low–Medium.** Vertex work is ×2 for the eyes; mixer and IK cost is CPU.
  - Estimates: about 0.3–0.6 ms GPU at 30–60k vertices on screen; about 0.2–0.4 ms of JS for 3–4 actions × 150 bones plus IK.
  - When the Mason is hidden (`hideDistance`) both drop to about 0.
- **Recommended rig and runtime design.** The sim already owns the motion: 20 spine points from `sim/creature3d.js` and planted hooks for 10 legs. So clips should add **life**, not locomotion.
  1. **Spine.** Put one bone per sim spine point (20, or 40 with in-betweens) **flat under the armature root**. Drive them procedurally every frame from `creature.body`, with a position and a frame from the path tangent and the clinging-surface normal, as `creatureView` does now.
  2. **Legs.** 10 chains of 3–4 bones (coxa, femur, tibia, hook), children of their spine bones. Solve analytic 2-bone IK toward the sim's planted hook (reuse the current solver). An additive "gait tremor" clip runs on top.
  3. **Crown.** Fronds as 10 chains of 3–4 bones driven by damped springs plus an additive "flare" clip at threat. Listening pits and the jaw (the optional `Mason_Jaw`) are clip-driven.
  4. **Masonry plates.** Rigid-weighted to the spine, with an additive "plate shiver" clip whose weight equals surge or threat.
  5. **Per-frame order:**
     - `mixer.update(dt)` (normal + additive layers, `crossFadeTo` between stalk / observe / lunge / recover sets)
     - spine bones ← sim
     - leg IK
     - frond springs
     - `root.updateMatrixWorld(true)`
     - `mesh.boundingSphere.set(simCentre, simRadius)`. The stale lazy sphere from §1.5 would cull wrongly, because the bones move far from the mesh origin.
     - three then calls `skeleton.update()` once per frame.
  6. **LODs.** Make 2 `SkinnedMesh`es sharing the **same `Skeleton`** (LOD0 about 40–60k triangles, LOD1 about 8–12k), switched by distance (the existing `lodDistance` 42 m). There is one bone texture.
  7. **Material.** One `MeshPhysicalMaterial` (clearcoat) for flesh, sinew and the stone shell, using vertex-colour or ORM masks for wetness and thickness, plus emissive pits. That keeps the whole Mason at **1–2 draws per eye**.
     - The current kit folds materials into vertex attributes the same way. Keep that discipline: one draw per material, so the material count is the draw count.
  8. **Texturing.** Unwrap UVs in Blender, with a 2048² KTX2 atlas set and a 1024² set for LOD1. Avoid the current local-space triplanar (9 fetches). If triplanar is ever needed on a skinned mesh, compute it in **bind-pose** space (the `position` attribute before skinning) so it does not swim.
- **Verdict:** **Tier 1** (the owner's explicit ask).

### 2.9 Morph targets

- **r170 API.** `geometry.morphAttributes` plus `mesh.morphTargetInfluences`, stored as a `DataArrayTexture` fetched by `gl_VertexID`.
  - The loop runs over **all** targets for **every** vertex of the geometry and skips only zero influences.
  - Morphs combine with skinning.
  - `InstancedMesh.setMorphAt` gives per-instance morph weights through `morphTexture`.
- **Works in XR:** yes.
- **Cost:** **Low** per active target, but each active target costs on every vertex of that geometry.
- **Use here.**
  - Facial-type shapes on the crown are best done as morphs: pits dilating, the membrane spreading, a "listening" flare.
  - Put the **crown in its own SkinnedMesh** (shared skeleton, +1 draw) so the 4–6 crown morphs do not run on 50k body vertices.
  - Instanced breathing on the decor "ribs" (`setMorphAt`) is a cheap ambient-horror touch.
- **Verdict:** Tier 2.

### 2.10 InstancedMesh and BatchedMesh (geometry density without draw calls)

- **r170 API.** `InstancedMesh` (already used everywhere here). `BatchedMesh` gained `addInstance`, `deleteGeometry`, `optimize`, `setInstanceCount` and `setGeometrySize` in r170 [S2].
- **Works in XR:** yes. Caveats:
  - BatchedMesh does real single-draw multi-draw only with `WEBGL_multi_draw`, and r170 falls back to a JS loop of draws without it. Whether Quest Browser exposes it is unverified; log `renderer.extensions.has('WEBGL_multi_draw')` in perfDiag on device.
  - Per-instance culling and sorting runs per eye on the CPU.
  - Only matrix and colour per instance. The project's `aShape`/`iShape` per-instance tricks would need a data texture indexed by batch id.
- **Cost:** **Low** (triangles are cheap next to fragments). Budget about 300–500k *unique* triangles per frame, so 0.6–1M submitted in stereo, against Meta's < 1.5M [S6].
- **Use here.** Replace raw boxes with **instanced Blender kit modules**:
  - beveled ashlar blocks with chipped arrises
  - broken-course wall panels with real recessed joints
  - rubble lips on ledges
  - organic rib growths
  - iron straps, bolts and chains
- **How to keep draw calls flat.** Stay with **one InstancedMesh per module per material bucket**, re-packed near the head exactly like today's solids. Expect +6–12 calls per eye.
  - A close-range "relief tile" layer, 1 m tiles with about 200–400 triangles of real displacement instanced over wall faces within about 8 m, fixes the stereo-flat-wall problem without POM.
  - Use BatchedMesh only if module variety exceeds about 12 and `WEBGL_multi_draw` is confirmed.
- **Verdict:** **Tier 1** (rank #8).

### 2.11 Points / sprite particles with soft depth fade

- **r170 API.** `Points` with `PointsMaterial` (`gl_PointSize *= scale / -mvPosition.z`, screen-aligned squares), `Sprite`, `InstancedMesh` billboards.
  - Soft particles need the scene depth texture.
  - In XR the depth attachment is the swapchain's (projection-layer path `depthTexture`, `WebXRManager.js:331-340`). Sampling it mid-frame means ending the pass and resolving depth on a tiler, plus a feedback loop. **Not viable.**
- **Works in XR:** Points, yes, but they are screen-aligned per eye, have no rotation, and are capped by the point-size range. Large Points can show stereo mismatch.
- **Cost:** **Low–Medium**, dominated by overdraw.
- **Use here ("particles 2.0").**
  1. **Instanced quads billboarded toward the head position, not the per-eye view plane.** Both eyes then see the same quad, with no stereo rivalry.
  2. **Analytic soft fade.** The shaft walls are axis-aligned and known per section (`section.shaft`). In the vertex shader, compute each particle's distance to the nearest wall plane and fade within about 0.5 m. Add a near-eye fade and a fog fade. This gives soft particles with **zero** depth reads.
  3. **Light particles in the vertex shader** with the lantern (`N·L` toward the lantern, 1/d²) plus the irradiance volume (§2.1). Dust glows when it passes the lantern, the single most "next-gen" particle read.
  4. **Content:** falling grit and ash (exists), drips from the wet mask (§2.5), spores and sensory "pollen" around the crown, embers from lamps, and debris (exists).
  5. Cap the overdraw: small sizes, `depthWrite false`, additive or premultiplied blending, and alpha from a 64² atlas.
- **Verdict:** Tier 1–2 (rank #9).

### 2.12 Decals (DecalGeometry)

- **r170 API.** `addons/geometries/DecalGeometry.js` (9,217 B). It clips the **target mesh's whole geometry** against a projector box, on the CPU, using `mesh.matrixWorld`. It ignores instance matrices and skinning.
- **Works in XR:** yes (static geometry).
- **Cost:** **Free–Low**, if merged into one mesh per decal atlas.
- **Use here.**
  - Bake decals at **level build** time. For an instanced box, pass a proxy `Mesh(unitBox)` with `matrixWorld` set to that instance's matrix. Merge all decals per atlas into one mesh, adding +1–2 draws.
  - Content:
    - soot above lamps
    - grime, mineral runs and moss at joints
    - claw scrapes and **ichor trails where the Mason crawls** (the sim's path is known)
    - Lanternwright chalk marks near anchors
  - Use **`MultiplyBlending`** for grime. Multiply is order-independent, so it needs no sorting and no depth issues. Add `polygonOffset` against z-fighting.
  - Do **not** decal the skinned creature; bake that detail into its textures.
- **Verdict:** Tier 2 (rank #11).

### 2.13 Textures: KTX2Loader + Basis transcoder, Toksvig roughness, anisotropy

- **r170 API.** `addons/loaders/KTX2Loader.js` with a WorkerPool transcode.
  - Its target table: UASTC → **ASTC 4x4** when `WEBGL_compressed_texture_astc` is available; ETC1S → **ETC2** first on ETC2 hardware; BC7/BPTC on desktop (`KTX2Loader.js:641-700`).
  - The vendored `GLTFLoader` already supports `setKTX2Loader` (`KHR_texture_basisu`) and `setMeshoptDecoder` (`EXT_meshopt_compression`, `KHR_mesh_quantization`) (`GLTFLoader.js:263-277`).
- **Works in XR:** yes. Adreno supports ASTC and ETC2 natively; confirm with `detectSupport(renderer)` on device.
- **Cost:** **negative.**
  - ASTC 4x4 is 8 bpp, ETC2 RGB is 4 bpp, against 32 bpp RGBA8 from JPEG. That is 4–8x less VRAM and texture bandwidth, which on a tiler directly speeds up fragment-bound frames.
  - Transcoding runs in workers, so there are no main-thread JPEG decode hitches.
- **Use here.**
  - Move the 5 PBR sets to **2048²**:
    - normals and ORM as **UASTC + zstd** (to ASTC)
    - albedo as **ETC1S** (to ETC2), or UASTC for hero sets
    - the creature atlas as 2048² UASTC
  - VRAM goes from about 84 MB (today, 1024² JPEG to RGBA8) to about 85–110 MB at **4x the texels**. That is the "crisp up close" leap in VR.
  - Bake **Toksvig-adjusted roughness into each mip** of the ORM (widen roughness where normal-map variance is high) in `tools/abyssal-tether-3d/build_textures.py`. This stops wet-surface specular from sparkling in stereo; three's built-in geometric anti-aliasing ignores normal maps (§1.5).
  - Keep `anisotropy = maxAniso` (already set).
  - Download size is the trade-off: UASTC+zstd 2k maps are a few MB each (estimate). Use the PWA precache `--lazy` globs per chapter.
- **Verdict:** **Tier 1, rank #3.** It enables the higher texel density at no GPU cost.

### 2.14 Mesh compression: MeshoptDecoder vs DRACO

- **r170 files.**
  - `addons/libs/meshopt_decoder.module.js`: 24,850 B (6.5 KB gzip), WASM embedded (base and SIMD builds), no separate file.
  - `DRACOLoader.js` (13,699 B) plus `libs/draco/gltf/draco_decoder.wasm` (192,420 B) and `draco_wasm_wrapper.js` (58,456 B).
- **Works in XR:** yes. These are load-time only.
- **Recommendation: meshopt** via `gltfpack -cc`:
  - tiny decoder
  - very fast decode
  - keeps **quantized attributes on the GPU** (`KHR_mesh_quantization`: smaller VRAM and vertex fetch, which matters at ×2 eyes)
  - compresses **animation** too (the Mason's clips)
- Draco only shrinks the download, decodes slowly, and expands to float.
- **Verdict:** Tier 1 (pipeline), with KTX2.

### 2.15 Emissive bloom alternatives for XR

- **Post bloom is not an option on Quest.** `UnrealBloomPass` is a multi-pass full-screen chain (§1.3).
- **`Lensflare` won't work in XR.** It uses `renderer.copyFramebufferToTexture` for occlusion (`Lensflare.js:213,225`), which is wrong per eye and a tiler stall.
- **Alternatives, all geometry or in-shader:**
  1. **In-scatter halos** (§2.6). In fog, the halo is physically the bloom.
  2. **Glow billboards** at every emitter (the existing `lightGlows` Points draw). Keep a constant angular size, fade with the fog, and test occlusion with a few **CPU raycasts per second** against the level boxes instead of a GPU readback.
  3. **Fresnel shells.** A slightly inflated copy of the pit and eye-free sensory geometry, additive, `pow(1 − N·V, k)`. 1 extra small draw on the creature.
  4. **Over-bright emissive into AgX.** AgX desaturates very bright values toward white the way film does, so emitters "burn" convincingly without bloom (§2.16).
- **Verdict:** Tier 1–2 (rank #12), and part of §2.6.

### 2.16 Output: AgX vs ACES, and colour grading with a LUT

- **r170 tone mappers** (`tonemapping_pars_fragment`): Linear, Reinhard, Cineon, ACESFilmic (with three's 1/0.6 exposure tweak), **AgX** (Filament / Blender-derived, Rec.2020 inset/outset with clamp gamut mapping [S21]), **Neutral** (Khronos PBR Neutral), Custom.
- **Cost:** all **Free–Low**. AgX is about 2 mat3 multiplies plus log2, a polynomial and pow. It runs per material fragment, so overdraw multiplies it, but it is still tiny.
- **AgX vs ACES for this game.**
  - ACES hue-skews bright saturated colours. The warm `0xffb46a` lantern core goes yellow, and saturated amber and red emissives clip in hue.
  - AgX keeps the hue and walks highlights toward white. That is the filmic look horror lighting relies on: the lantern flame, the burning pits.
  - AgX is lower contrast out of the box, so pair it with a grade.
  - Neutral is for product colour fidelity, not mood.
  - **Recommendation: AgX plus a grade.**
- **Grading without a pass.** Set `renderer.toneMapping = THREE.CustomToneMapping` and replace `CustomToneMapping` in `ShaderChunk.tonemapping_pars_fragment` with:
  - `AgXToneMapping(color)` (defined earlier in the same chunk)
  - then lift/gamma/gain
  - cool shadows / warm highlights split-tone
  - saturation
  - optionally a **32³ LUT** (`Data3DTexture`, 128 KB). Author it in Resolve and load with `LUTCubeLoader` (3,181 B, returns `texture3D`). Sample it in a perceptual encoding: AgX returns linear, so apply pow(1/2.2) before the lookup and undo it after.
  - Under `#ifdef AT_GRADE`, set by the shared patch helper, so unpatched materials still compile.
  - Drive it from **threat**: desaturate and push toward red as the Mason closes in. Use **section looks** through the existing theme blend.
- **Add dithering.** Set `material.dithering = true` (±0.5/255 triangle dither, `dithering_pars_fragment`) on world, fog-dome and creature materials. Dark fog gradients on the Quest 3 panels band badly in 8-bit, and this costs a few ALU.
- **Desktop tier.** `LUTPass` and `OutputPass` (r170 `OutputPass` applies `renderer.toneMapping`, AgX included) can do the same grade as a post chain.
- **Verdict:** **Tier 1** (rank #6).

### 2.17 `renderer.compileAsync` and pre-warming

- **r170 API.** `renderer.compileAsync(scene, camera, targetScene?)` → Promise (§1.5).
- **Works in XR:** yes. Programs compiled before the session are reused (§1.5).
- **Cost:** no frame cost; it removes hitches.
- **Use here.**
  - Replace the synchronous `renderer.compile` in `Renderer3D.precompile()`.
  - Run it behind the menu and fades, which VRC exempts [S7].
  - Include every **variant**: dissolve, creature LOD0/LOD1/crown, decals, fog dome, particle atlases.
  - Also **force one shadow-map render** with the creature visible during loading, because `compile()` does not warm shadow-pass depth materials.
  - Keep `initTexture` for uploads. KTX2 uploads are cheap because mips come precomputed.
  - `KHR_parallel_shader_compile` availability on Quest Browser is unverified. `compileAsync` falls back to 10 ms polling, so it is safe either way.
- **Verdict:** **Tier 1** (required for VRC as variant count grows).

### 2.18 Other r170 features worth using

- **Lantern spot shadow (creature only).** Add a `SpotLight` co-located with the lantern: wide cone of about 110–130°, aimed along the hand. Only the Mason (and hands) have `castShadow`; walls `receiveShadow`.
  - Use `BasicShadowMap` (1 tap) at 1024², or VSM at 512². **Not** PCF's 17 taps.
  - Freeze with `shadow.autoUpdate=false` and `needsUpdate` only while the creature is within about 25 m. Fade with `shadow.intensity`. Neither causes a recompile.
  - The shadow pass runs once per frame, not per eye.
  - **Gain:** the legs' shadows sweeping across the lit wall before you see the body. Arguably the scariest single visual in the plan.
  - **Cost:** **Medium** while active (est. 0.4–1.2 ms), 0 otherwise.
  - **Verdict: Tier 1** (rank #7).
- **`alphaToCoverage`.** With MSAA in XR, cut-out fronds, cilia, grates and chain links get smooth edges with no sorting (`Material.alphaToCoverage`). **Free.** Tier 1.
- **`toneMappingExposure` animation.** Global uniform, **free**: lantern-flicker "pumping" and an eye-adaptation drift when entering lit chambers. Tier 1.
- **Avoid these:**
  - `logarithmicDepthBuffer`: writes `gl_FragDepth`, which kills early-Z.
  - `reverseDepthBuffer` (new in r170 [S2]): needs `EXT_clip_control`; not worth the XR risk.

---

## 3. Ranked list: highest visual gain per ms on Quest 3

Gain is judged on what a player in the headset notices in a dark, foggy, vertical horror space. Cost is a Quest 3 estimate (render scale 1.0, stereo, 72 Hz). "When active" means the cost is zero when the effect is off-screen or out of range.

| # | Technique (r170 mechanism) | Visual gain | Est. GPU cost | Gain/ms |
|---|---|---|---|---|
| 1 | **Analytic lantern + lamp in-scattering in the fog chunk, HDR fog before tone mapping, fog dome** (`ShaderChunk` patch, §2.6) | Very high: volumetric halos, lit air, depth | 0.2–0.4 ms (ALU only) | ★★★★★ |
| 2 | **Baked irradiance + AO volume per section** (`Data3DTexture`, Node baker over level AABBs; also per-vertex on the Mason, §2.1) | Very high: every lamp lights the world, soft GI and contact darkening | 0.2–0.4 ms (1 fetch) | ★★★★★ |
| 3 | **KTX2 2048² sets (UASTC normal/ORM → ASTC, ETC1S albedo → ETC2) + Toksvig roughness mips** (§2.13) | High: 4x texels, no shimmer, no decode hitches | ≤ 0 (bandwidth drops) | ★★★★★ |
| 4 | **Rigged Mason: SkinnedMesh 40–60k triangles, clearcoat flesh, wrap/back-light SSS, rim, breathing vertices, emissive pits; mixer layers + procedural spine, IK and springs** (§2.8, §2.4, §2.5) | Very high: the owner's ask, and the game's scare engine | 0.3–1.0 ms when on screen | ★★★★☆ |
| 5 | **Wetness + drip-streak injection on world materials** (`onBeforeCompile`, §2.5) | High: moving specular glints under the lantern | 0.15–0.3 ms | ★★★★☆ |
| 6 | **AgX + in-shader grade (CustomToneMapping, optional 32³ LUT), threat-reactive, plus dithering** (§2.16) | Medium-high: cohesive cinematic look, no banding | 0.05–0.15 ms | ★★★★☆ |
| 7 | **Lantern SpotLight shadow, Mason-only casters** (`BasicShadowMap`/VSM, `shadow.autoUpdate`, §2.18) | Very high in encounters: leg shadows on the walls | 0.4–1.2 ms when active | ★★★★☆ |
| 8 | **Instanced Blender kit modules + near-wall relief tiles replacing raw boxes** (`InstancedMesh`, §2.10) | High: real stereo relief, broken silhouettes | 0.2–0.6 ms (tris, +6–12 draws/eye) | ★★★☆☆ |
| 9 | **Particles 2.0: head-facing instanced billboards, analytic soft fade vs shaft planes, lantern-lit** (§2.11) | Medium-high: lit dust, drips, spores | 0.2–0.6 ms (overdraw-capped) | ★★★☆☆ |
| 10 | **Volumetric god-ray volumes (analytic cone thickness + noise + motes)** (§2.7) | Medium | 0.1–0.3 ms | ★★★☆☆ |
| 11 | **Build-time decals, MultiplyBlending grime + ichor trails** (`DecalGeometry`, §2.12) | Medium: story and age | 0.05–0.2 ms | ★★★☆☆ |
| 12 | **Bloom substitutes: glow billboards with CPU occlusion, fresnel shells, over-bright emissive into AgX** (§2.15) | Medium | 0.05–0.2 ms | ★★★☆☆ |
| 13 | **Per-section LightProbe SH** (fallback or complement to #2, §2.2) | Low-medium | ~0.02 ms | ★★☆☆☆ |
| 14 | **Box-projected per-section PMREM on metal and wet materials only** (§2.3) | Medium on metal and wet stone | 0.3–0.8 ms on covered pixels | ★★☆☆☆ |
| 15 | **Crown morph targets in a separate crown SkinnedMesh** (§2.9) | Medium (close encounters) | ~0.05–0.1 ms | ★★☆☆☆ |
| 16 | **Near-only POM on masonry** (§2.5). Prefer #8's relief tiles. | Medium | 0.5–1.5 ms | ★☆☆☆☆ |
| 17 | `alphaToCoverage`, exposure animation, `compileAsync` pre-warm (§2.17, §2.18) | Enablers (edge quality, no hitches) | ≈ 0 | n/a, do all |
| (dial) | `renderer.xr.setFramebufferScaleFactor(1.2)`: native panel resolution [S8] | High clarity | +44 % on **all** fragment work | Spend leftover budget here last |

**Not for the Quest build:**
- any full-screen post pass (bloom, LUT pass, SSAO/GTAO, SSR, god-ray post) (§1.3)
- `transmission` (§1.5)
- raymarched volumetrics (§2.6)
- `PointLight` cube shadows (6 passes)
- more than 3 dynamic point lights (each costs on every lit fragment)
- broad clearcoat, iridescence or anisotropy on world surfaces
- full-screen POM
- `logarithmicDepthBuffer`

**Budget sanity check.**
- **Adding it up.** Items 1–12 together are roughly **+2.5 to +5.5 ms** of GPU time in the worst case: creature close, shadow active, beams and particles in view.
- **72 Hz.** If the current build measures ≤ about 7 ms GPU on Quest 3 (**measure first**: OVR Metrics Tool GPU time, plus `Renderer3D.stats`), the Tier-1 set fits 72 Hz (13.8 ms [S6]) with margin.
- **90 Hz (11.1 ms).** Drop #14 and #16, cap #9, and keep #7 to encounters only.
- **The dial.** Use the leftover margin on the framebuffer-scale dial.

---

## 4. How the pieces fit the existing code (implementation notes)

1. **One shared patch helper.** Add `patchAtmosphere(material, {volume, creature, grade})` in `materials.js`.
   - It chains existing `onBeforeCompile` callbacks and `customProgramCacheKey`.
   - It injects shared uniforms: lantern and 2 env light positions and colours, scatter coefficient, volume texture with min and inverse size, grade LUT and params, threat.
   - It sets defines.
   - It replaces `installRadialFog` with `installAtmosphere`: the fog chunk emptied, fog + in-scatter + tone mapping at `tonemapping_fragment`, and a `vAtView` varying in `fog_vertex`.
   - It also patches `CustomToneMapping`.
   - Every module's materials call it: level, creature, hands, rope, FX.
2. **Volume baker.** Add `tools/abyssal-tether-3d/bake_volume.mjs`. It imports `data/level-data-3d.js` and `sim/level3d.js` to enumerate solids and lights, and writes `assets/volumes/s<N>.bin` (RGBA8) plus JSON (min, size, dims).
   - CPU only. No Blender, no browser.
3. **Rig contract for the creature team.**
   - Bone naming: `Spine_00..`, `Leg_<i>_{Coxa,Femur,Tibia,Hook}`, `Frond_<i>_{0..3}`, `Jaw`, `Pit_<i>`.
   - Spine bones are **children of the root** (flat), so world-space sim placement is a cheap local write.
   - Clips: idle-breathe, plate-shiver, frond-flare, pit-dilate, jaw-gape, lunge-snap, recoil. Exported as glTF actions. Additive conversion happens at runtime with `makeClipAdditive(clip.clone())`.
   - Pack with `gltfpack -cc -tc` (meshopt + KTX2).
   - Physical-material extensions should come only from the intended flesh material (§2.4).
4. **Fixed counts, no recompiles.**
   - Light set: lantern `PointLight` + 2 env `PointLight`s + 1 `SpotLight` (shadow) + 1 `LightProbe` + hemisphere. The hemisphere could be removed once the volume exists.
   - **Always present.** Animate intensities and `shadow.intensity`, never existence.

---

## 5. Files to vendor (exact r170 paths, sizes)

The import map maps `three/addons/` → `./vendor/three/addons/`. Keep the relative layout, because `KTX2Loader.js` imports `../utils/WorkerPool.js`, `../libs/ktx-parse.module.js`, `../libs/zstddec.module.js` and `../math/ColorSpaces.js`.

**Source:** `three-full/package/examples/jsm/<path>` → **destination:** `public/abyssal-tether-3d/vendor/three/addons/<path>`.

| Path (under `addons/`) | Bytes | gzip -9 | Needed for |
|---|---|---|---|
| `loaders/KTX2Loader.js` | 27,164 | 6,960 | KTX2 / `KHR_texture_basisu` |
| `utils/WorkerPool.js` | 1,712 | 608 | KTX2Loader dependency |
| `libs/ktx-parse.module.js` | 19,440 | 5,514 | KTX2Loader dependency |
| `libs/zstddec.module.js` | 39,754 | 17,132 | KTX2Loader dependency (zstd-supercompressed UASTC) |
| `math/ColorSpaces.js` | 2,462 | 860 | KTX2Loader dependency |
| `libs/basis/basis_transcoder.js` | 57,529 | 15,060 | transcoder (`setTranscoderPath('./vendor/three/addons/libs/basis/')`) |
| `libs/basis/basis_transcoder.wasm` | 527,333 | 245,408 | transcoder. Fetched as an ArrayBuffer and instantiated in a Blob-URL worker, so no special MIME is needed. A future CSP must allow `worker-src blob:` and wasm compilation. |
| **KTX2 subtotal** | **675,394** | **291,542** | |
| `libs/meshopt_decoder.module.js` | 24,850 | 6,460 | `EXT_meshopt_compression` (WASM inline) |
| `utils/SkeletonUtils.js` | 8,802 | 2,359 | cloning or retargeting the rigged Mason |
| `geometries/DecalGeometry.js` | 9,217 | 2,296 | build-time decals |
| `loaders/LUTCubeLoader.js` | 3,181 | 1,101 | `.cube` grade LUT (or `LUTImageLoader.js` 2,894 / 985) |
| `lights/LightProbeGenerator.js` | 6,480 | 1,608 | per-section SH (optional) |
| *(not recommended)* `loaders/DRACOLoader.js` + `libs/draco/gltf/draco_decoder.wasm` + `draco_wasm_wrapper.js` | 13,699 + 192,420 + 58,456 | 4,195 + 63,240 + 11,524 | DRACO (prefer meshopt) |

- **Precache.** Add these to the PWA precache (`docs/abyssal-tether-3d/pwa/gen-precache.mjs`).
- **SHA-256 prefixes for provenance:**
  - `basis_transcoder.js` 8478b5b6d6b74e7d
  - `basis_transcoder.wasm` 6cf17dc889352c42
  - `KTX2Loader.js` fbf80e9b0237ffe2
  - `meshopt_decoder.module.js` 01f48524f4bac614
- **Offline tools** (build machine only, not vendored): KTX-Software `toktx` or `basisu` for KTX2, and `gltfpack` (meshoptimizer) [S24][S25].

---

## 6. Desktop high tier (non-XR only, same materials)

Gate everything behind `!renderer.xr.isPresenting` plus a quality setting. Same r170 package:

- **`EffectComposer` chain:** `RenderPass` → `GTAOPass` → `UnrealBloomPass` → `FilmPass` (grain) → `LUTPass` → `OutputPass`.
  - With a composer, tone mapping moves to `OutputPass`. The in-material `CustomToneMapping` grade must then be skipped through a define, to avoid grading twice.
- **Lantern `PointLight` shadow** (`PCFSoftShadowMap`, cube, 6 passes).
- Clearcoat on wet world stone, `scene.environment` PMREM broadly, sheen on fronds.
- POM on all masonry.
- Raymarched local fog volumes (`VolumeShader`-style).
- KTX2 transcodes to BC7 on desktop automatically.
- Pixel ratio up to 2.
- The existing `perfDiag` adaptive resolution keeps it safe on weak GPUs.

---

## 7. Pitfalls checklist

- **GLTFLoader upgrades materials silently.** Any `KHR_materials_*` extension on a glTF makes it a `MeshPhysicalMaterial`, along with that cost.
- **Don't toggle light existence.** Never toggle `castShadow`, add or remove lights, or add or remove `scene.environment` at runtime. Each changes program keys and causes mid-game compiles (§1.5, §2.2).
- **SkinnedMesh culling goes stale.** Its bounding sphere is computed once from the first pose. Set it from sim points every frame, or the Mason pops out at screen edges (§1.5).
- **Morph cost is per geometry.** It applies to every vertex, so isolate crown morphs (§2.9).
- **`discard` disables early depth** for that draw on Adreno. Use dissolve and dither-fade variants only while the effect is active.
- **Texture units.** WebGL2 guarantees 16 fragment texture units [S26]. A creature material with map, normal, ORM ×3 slots, emissive, volume, LUT and env is about 9–10. Keep a ledger.
- **Fog chunk order is r170-specific** (§1.4). Pin three at r170 for the Quest build; any upgrade means re-auditing every chunk patch.
- **Points are per-eye screen squares.** Use head-facing instanced quads for anything larger than a few pixels (§2.11).
- **Measure on device before and after each item.** Use OVR Metrics Tool GPU time and frame-rate graph; VRC judges sustained ≥ 60 fps [S7]. Also use `renderer.info` (calls and triangles per eye) through `Renderer3D.stats`.

---

## Sources

- [S1] three r170 npm package (inspected locally): https://www.npmjs.com/package/three/v/0.170.0. The r170 release notes are S2.
- [S2] three.js r170 release notes (BatchedMesh resizing/optimize, reversed-Z, CompressedArrayTexture fix on Quest): https://github.com/mrdoob/three.js/releases/tag/r170
- [S3] three.js PR #26904, "WebXRManager: Revert support of EffectComposer": https://github.com/mrdoob/three.js/pull/26904 (issue list: https://github.com/mrdoob/three.js/issues?q=EffectComposer+WebXR)
- [S4] three.js PR #32461, "WebGLRenderer: Add outputBufferType and setEffects()" (milestone r182; maintainer performance concerns): https://github.com/mrdoob/three.js/pull/32461
- [S5] three.js PR #22558, WebXR cleanup + `ext_multisampled_render_to_texture` (Oculus-funded): https://github.com/mrdoob/three.js/pull/22558
- [S6] Meta, Device optimization comparison (Quest 3: 72 Hz / 90 recommended, 13.8 ms, < 200 draw calls, < 1.5M triangles, 2064×2208, ~2.5x Quest 2 GPU): https://developers.meta.com/horizon/resources/device-optimization-comparison/
- [S7] Meta, VRC.Quest.Performance.1 (≥ 60 fps sustained rendering; 72/80/90… Hz display; loading screens and fades exempt): https://developers.meta.com/horizon/resources/vrc-quest-performance-1/
- [S8] Meta, Render scale (Quest 3 default 1680×1760 per eye at 1.0; ≈1.2 matches the physical panel): https://developers.meta.com/horizon/essentials/render-scale and https://developers.meta.com/horizon/documentation/native/android/os-render-scale
- [S9] Meta blog, "Loads, Stores, Passes, and Advanced GPU Pipelines" (resolve cost ≈ 0.5 ms per eye buffer; MSAA in tile memory): https://developers.meta.com/horizon/blog/loads-stores-passes-and-advanced-gpu-pipelines/
- [S10] Meta blog, "PC Rendering Techniques to Avoid when Developing for Mobile VR": https://developers.meta.com/horizon/blog/pc-rendering-techniques-to-avoid-when-developing-for-mobile-vr/
- [S11] Meta, "Using RenderDoc Meta Fork to Optimize Your App, Part 1" (intermediate-target resolve 1–1.5 ms; FFR only when writing to the swapchain): https://developers.meta.com/horizon/documentation/unity/po-renderdoc-optimizations-1/
- [S12] Meta, WebXR Performance Optimization Workflow (multiview and instancing to cut draw calls; FFR): https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/
- [S13] Meta, Web multiview: https://developers.meta.com/horizon/documentation/web/web-multiview/ ; MDN `OVR_multiview2`: https://developer.mozilla.org/docs/Web/API/OVR_multiview2
- [S14] Meta blog, Quest developer best practices (state changes as the real draw-call cost): https://developers.meta.com/horizon/blog/down-the-rabbit-hole-w-oculus-quest-developer-best-practices-the-store/
- [S15] Meta, Unity performance doc (Quest 3 draw-call tiers by app type): https://developers.meta.com/horizon/documentation/unity/unity-perf/
- [S16] Wikipedia, Meta Quest 3 (Snapdragon XR2 Gen 2, Adreno 740 @ 640 MHz): https://en.wikipedia.org/wiki/Meta_Quest_3
- [S17] MDN, `XRWebGLLayer.fixedFoveation` (0..1, per frame, null if unsupported): https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/fixedFoveation
- [S18] three.js docs, KTX2Loader: https://threejs.org/docs/pages/KTX2Loader.html
- [S19] Basis Universal: https://github.com/BinomialLLC/basis_universal
- [S20] Sun, Ramamoorthi, Narasimhan, Nayar, "A Practical Analytic Single Scattering Model for Real Time Rendering" (SIGGRAPH 2005): https://www.cs.columbia.edu/~bosun/sig05.htm ; point-light in-scattering integral note (after Miles Macklin): https://scrapbox.io/shivaduke-cg/Fog
- [S21] three.js PR #27413 (AgX naming, Rec.2020 gamut mapping by clamp): https://github.com/mrdoob/three.js/pull/27413
- [S22] Meta community forum, WebXR renders at the headset's recommended resolution; layers for video: https://communityforums.atmeta.com/discussions/WebXRDevelopment/aliasing-video-texture-in-webxr-in-quest-headsets/1306305
- [S23] Meta, Unity OpenXR settings (foveation modes): https://developers.meta.com/horizon/documentation/unity/unity-openxr-settings/
- [S24] meshoptimizer / gltfpack: https://github.com/zeux/meshoptimizer
- [S25] KTX-Software (toktx): https://github.com/KhronosGroup/KTX-Software
- [S26] WebGL2 minimum limits (16 fragment and 16 vertex texture units): https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html
- [S27] web3dsurvey, WebGL2 `MAX_3D_TEXTURE_SIZE` (≥ 2048 on all surveyed devices): https://web3dsurvey.com/webgl2/parameters/MAX_3D_TEXTURE_SIZE

**Local verification artefacts:**
- `plans/three-full/package` (r170 source)
- `plans/three-ver/*` (later-version tarballs used for the multiview check)
- `plans/scripts/inscatter_check.mjs` (closed-form in-scatter check)
- `plans/scripts/glbinfo.mjs` (GLB stats: `mason_kit.glb` / `mason_hero.glb`, 4,990 triangles, no skins, animations or textures)
