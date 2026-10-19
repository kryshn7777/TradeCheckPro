# Quest 3 + Meta Quest Browser WebXR rendering: hard limits, and what the best WebXR titles do

Research for ABYSSAL TETHER 3D ("the Mason" graphics overhaul). Written 2026-10-19.

**How this was researched.** Meta's developer site (developers.meta.com) and several other doc hosts could not be fetched
directly from this sandbox (DNS/proxy refusal). Meta pages were read through search-engine extraction, so quoted Meta numbers
are as the search tool reported them; each one is linked so it can be re-checked. Three.js behaviour is **verified from source
code**, not from forum posts. I pulled and read `three@0.170.0` (what we vendor), `three@0.176.0`, `@0.177.0`, `@0.180.0`,
`@0.186.1`, `super-three@0.170.1` and `@0.181.0` (the A-Frame/Meta fork), and Meta's `@iwsdk/core@1.0.1`. The copies are under
`/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad/plans/three-full`, `.../plans/three-later` and `.../plans/research/iwsdk`.
Numbers marked **(derived)** are my own arithmetic or estimates, not published figures. They must be confirmed on a headset.

---

## 0. Bottom line

1. **The hardware is a ~2 TFLOPS mobile tiler drawing about 5.9 Mpx per frame in stereo.** Quest 3 and 3S render 1680×1760 per
   eye by default. A 13.9 ms frame at 72 Hz leaves room for roughly **today's per-pixel shader cost**, not 10× of it. On Quest, a
   "10×" look has to come from **content** baked offline: lightmaps/AO, higher-resolution *compressed* textures, more geometry
   with LODs, and art direction (fog, emissive glints, silhouettes). Per-pixel desktop features will not deliver it. Desktop
   can take real-time shadows, bloom and more lights as a separate tier.
2. **Vanilla three.js r170 has no multiview.** Every object is drawn **twice**, once per eye (verified in `WebGLRenderer.js`).
   `renderer.info.render.calls` in XR therefore already counts both eyes. Upstream three.js added multiview **only to
   `WebGPURenderer`** (r176+, `OVR_multiview2`) and closed the WebGLRenderer request as won't-do (issue #20368, Aug 2026).
3. **Meta's own WebXR SDK (IWSDK 1.0.1) ships `super-three@0.181.0`.** That is the A-Frame fork, which adds
   **`OCULUS_multiview` (MSAA-capable) to the classic `WebGLRenderer`** behind `new WebGLRenderer({ multiviewStereo: true })`.
   `super-three@0.170.1` carries the same patch. It is the only realistic multiview route for our onBeforeCompile-heavy WebGL
   code. Meta claims a 25–50 % CPU reduction for CPU-bound apps. Community GPU results are mixed. **Spike and measure it.**
4. **Do not move to `WebGPURenderer` for Quest in this release.** On Quest it runs its WebGL2 fallback, which has a known
   per-object UBO overhead (three.js #30560: 12 fps vs 60 fps for WebGLRenderer in Chrome, and 19 vs 57 on a Pixel 8a, in
   Jan 2026). WebGPU+WebXR in Quest Browser is still experimental and flag-gated (Browser 146–152 release notes). Every
   custom shader would also need a rewrite in TSL.
5. **Post-processing as a separate pass is not practical at 72 Hz on Quest.** It costs a full-resolution store, a reload and an
   extra pass. It also **loses fixed foveation**, because FFR applies only to the XR layer's own framebuffer. Do grading,
   tonemapping, grain and vignette **inside the material shaders**, and fake bloom with additive glow sprites. Real bloom
   belongs in a desktop tier.
6. **There is no shadow-mapped point light on Quest.** A point-light shadow is 6 extra scene renders, and Meta's WebXR
   best-practices page singles this out. Use baked lighting, contact/blob shadows and lantern cookies instead. Desktop can have
   shadows.
7. **KTX2 is mandatory for the texture upgrade.** On Quest, KTX2Loader maps UASTC to ASTC 4×4 (1 B/px) and ETC1S to ETC1/ETC2
   (0.5–1 B/px). Today's JPEGs decode to RGBA8 (4 B/px). A 2K ASTC texture uses the **same VRAM as a 1K JPEG does now**.
8. **Call `session.updateTargetFrameRate(72)` explicitly.** Meta documents 90 Hz as the Browser default on Quest 2, and the
   game does not request a rate today. Keep framebuffer scale at or above 0.85: VRC.Quest.Performance.4 asks for ≥85 % render
   scale, now "recommended" rather than required.

---

## 1. Hardware facts (Quest 3 / 3S)

| Item | Value | Source |
|---|---|---|
| SoC / GPU | Snapdragon XR2 Gen 2, Adreno 740-class | [UploadVR XR2 Gen 2](https://www.uploadvr.com/snapdragon-xr2-gen-2/) |
| GPU vs Quest 2 | Meta's device page: ~2.5× Quest 2; Qualcomm: up to 2.5× peak | [Meta device comparison](https://developers.meta.com/horizon/resources/device-optimization-comparison/), [UploadVR](https://uploadvr.com/quest-3-gpu-twice-powerful/) |
| GPU clock levels | Level 0–5: 285 / 350 / 456 / 492 / 545 / 599 MHz. Level 5 needs CPU/GPU trading or dynamic resolution | [Meta CPU & GPU levels](https://developers.meta.com/horizon/documentation/unity/os-cpu-gpu-levels/), [UploadVR clock boost](https://www.uploadvr.com/meta-quest-3-gpu-clock-speed-performance-boost/) |
| Adreno 740 ALUs | 1536 FP32 ALUs (third-party). Snapdragon 8 Gen 2 phone: 680 MHz ≈ 2.09 TFLOPS | [NanoReview 8 Gen 2](https://nanoreview.net/en/soc-compare/qualcomm-snapdragon-8-gen-2-vs-qualcomm-snapdragon-7s-gen-2) |
| Quest 3 FP32 peak **(derived)** | 1536 × 2 × 0.545–0.599 GHz ≈ **1.7–1.8 TFLOPS** | arithmetic |
| CPU | 2 performance + 4 efficiency cores; CPU only ~33 % faster than XR2 Gen 1 | [UploadVR XR2 Gen 2](https://www.uploadvr.com/snapdragon-xr2-gen-2/) |
| RAM / app memory cap | 8 GB physical. **5.75 GiB** PSS cap for native apps (Quest 3/3S); 4.4 GiB on Quest 2/Pro | [Meta memory (po-memory-ram)](https://developers.meta.com/horizon/documentation/unity/po-memory-ram/) |
| Default eye buffer (render scale 1.0) | **1680×1760 per eye on Quest 3 and 3S**. Quest 3 panel 2064×2208 (≈1.2 scale); 3S panel 1832×1920 (≈1.09) | [Meta render scale](https://developers.meta.com/horizon/essentials/render-scale) |
| Refresh rates | Display accepts 72–207 Hz (Horizon OS 2.7). Browser sets rate through `updateTargetFrameRate` (Browser ≥16.4) | [Meta display refresh rate](https://developers.meta.com/vr/documentation/native/android/mobile-display-refresh-rate/), [Meta WebXR frames](https://developers.meta.com/horizon/documentation/web/webxr-frames/) |

Quest 3S has the **same SoC and the same default eye buffer** as Quest 3, so one budget covers both. Quest 2 has about 40 % of
the GPU and needs a lower tier; see section 17.

---

## 2. Frame budgets at 72 / 90 Hz

- **72 Hz = 13.9 ms. Meta lists 13.8 ms** for Quest 3 ([device comparison](https://developers.meta.com/horizon/resources/device-optimization-comparison/)).
  90 Hz = 11.1 ms. Meta's Runtime Optimizer targets **14.2 ms (~70 fps)** for VR apps ([Meta Unity best practices / Runtime Optimizer](https://developers.meta.com/vr/documentation/unity/unity-quest-runtime-optimizer/)).
- **CPU and GPU are pipelined.** In Quest Browser, the page's main thread runs the XR rAF callback: game simulation, three.js
  scene update, and recording GL commands. Chromium's GPU process then executes them. Each side must fit in a frame on its
  own. Wonderland Engine's profiling notes call **CPU draw-call overhead the most common WebXR bottleneck**: browsers validate
  every WebGL call and marshal it across processes ([Wonderland WebGL performance](https://wonderlandengine.com/about/webgl-performance/),
  [Wonderland profiling](https://wonderlandengine.com/news/profiling-webxr-applications/)). They also measure **GC pauses of
  0.1–10 ms**, which is why zero allocations per frame matters.
- Meta's workflow: first find out whether you are CPU- or GPU-bound. One test is to render nothing and see if frame time
  changes. Measure with OVR Metrics Tool (fps, CPU/GPU utilisation, stale frames) and `ovrgpuprofiler`
  ([Meta WebXR perf workflow](https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/),
  [Meta WebXR perf tools](https://developers.meta.com/horizon/documentation/web/webxr-perf-tools/)).

**Adopted split for 72 Hz (derived):** main-thread JS **≤ 8 ms p95**, with sim + creature + rope ≤ 3 ms, three.js
update/cull/skinning ≤ 1.5 ms and draw submission ≤ 3 ms. GPU **≤ 11.5 ms p95**, which leaves ~2 ms for compositor work and
thermal variance. 90 Hz is allowed only if both p95 values sit ≥ 20 % under the 11.1 ms budget on the worst scene.

---

## 3. Draw calls and triangles

**Meta's published numbers are for native apps, which use multiview by default:**

| Device | Draw calls | Triangles / frame | Source |
|---|---|---|---|
| Quest 3 (device comparison page) | **< 200** | **< 1.5 M** | [Meta device comparison](https://developers.meta.com/horizon/resources/device-optimization-comparison/) |
| Quest 2 (same page) | < 100 | < 750 K | same |
| Quest 3/3S (older perf page, by sim load) | 200–300 busy / 400–600 medium / 700–1000 light | 1.3–1.8 M | [Meta Unity perf](https://developers.meta.com/horizon/documentation/unity/unity-perf/) |

Meta calls both limits "soft". Draw-call capacity depends on state changes between draws, and triangles that span many tiles
cost more. Meta's WebXR guide warns that **1000 individual draw calls would likely drop a Quest app below 72 fps**
([WebXR perf workflow](https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/)).

**Translating to our stack (verified in code).** In r170, `WebGLRenderer.render()` loops `renderScene()` once per sub-camera
of the XR `ArrayCamera` (`src/renderers/WebGLRenderer.js` ~L1249–1257). Every visible object costs **2 GL draws**, its vertex
shader runs twice, and `info.render.calls` reports both eyes. WebGL call overhead is also higher than native. So:

- **Budget in "GL draws per frame", which is what `renderer.info.render.calls` shows in XR.** Quest 3 without multiview:
  **≤ 200 GL draws typical (≈100 scene objects), ≤ 280 worst case (≈140 objects)**. With multiview: ≤ 140 GL draws, each
  covering both eyes. The existing `CONTRACT3D.md` limit of "150 draw calls" should be restated in these units.
- **Triangles: ≤ 400 k visible scene triangles typical, ≤ 600 k peak.** Without multiview that is 0.8–1.2 M vertex-shaded
  triangles per frame, inside Meta's 1.5 M. This raises today's 350 k contract. Spend the extra on silhouettes and the
  creature, not on sub-pixel detail.
- Draw-count tools already available in r170: `InstancedMesh`, merged static geometry, and `BatchedMesh`. BatchedMesh
  falls back to a loop of draws when `WEBGL_multi_draw` is missing (code verified), so check that extension on device. The
  creature already collapses about 65 parts into 1 skinned draw (`creatureView.js` header).

---

## 4. Fragment cost, overdraw and resolution

- **Pixels per frame (derived).** At scale 1.0: 1680×1760×2 = **5.91 Mpx/frame**, or 426 Mpx/s at 72 Hz. At 1.2 (panel-native
  on Quest 3): 8.5 Mpx (+44 %). At 0.85: 4.27 Mpx (−28 %).
- **ALU per pixel (derived).** ~1.7 TFLOPS × 13.9 ms ≈ 23 GFLOP per frame, or about 3,900 FLOP per pixel at 100 % utilisation.
  Real shaders reach maybe 40–50 % of peak. Subtract ~1–2 ms of compositor/timewarp and the vertex work, and divide by
  1.3–1.5× overdraw. That leaves **on the order of 1,000 FLOP, a few hundred scalar ops, per final pixel**. A
  MeshStandardMaterial with 3 point lights, 3–4 texture fetches, fog and ACES is already in that range. **Per-pixel shader
  complexity cannot grow 10×.**
- **Overdraw.** Meta recommends front-to-back opaque sorting (three does this by default) and warns that transparents rendered
  back-to-front overdraw ([Meta WebXR best practices](https://developers.meta.com/vr/documentation/web/webxr-perf-bp/)). Project
  Flowerbed's write-up: good Quest WebXR performance means **minimising overdraw and avoiding large texture resolves such as
  post-process effects** ([Flowerbed case study](https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/)).
- **Adopted limits:** opaque overdraw ≤ 1.5× on average. Blended (additive/alpha) coverage ≤ 25 % of the screen, at most 3
  layers deep, in the worst moment, such as a creature burst near the face. No full-screen transparent quads on Quest.
- **Render-scale floor:** **VRC.Quest.Performance.4** asks for ≥ 85 % render scale for most of the experience; since
  2024-07-31 it is "recommended", not required ([VRC.Quest.Performance.4](https://developers.meta.com/horizon/resources/vrc-quest-performance-4/),
  [render scale](https://developers.meta.com/horizon/essentials/render-scale)). In WebXR, render scale is
  `framebufferScaleFactor`, relative to the 1680×1760 recommended size.

---

## 5. Multiview (`OVR_multiview2` / `OCULUS_multiview`) and three.js

### 5.1 What Quest Browser offers
- **`OCULUS_multiview`** is enabled by default in Quest Browser. It is WebGL 2 only and works like `OVR_multiview2` **plus
  MSAA**. `OVR_multiview2` is behind a `chrome://flags` toggle there. Meta calls multiview the recommended way to render on
  Quest and says **"only CPU-bound experiences will benefit… a CPU usage reduction of 25%–50% is often achievable"**. Setup
  uses a WebXR Layers projection layer with `textureType: 'texture-array'`
  ([Meta web multiview](https://developers.meta.com/horizon/documentation/web/web-multiview/); three.js issue
  [#20368](https://github.com/mrdoob/three.js/issues/20368) quotes the same 25–50 %).
- Plain `OVR_multiview2` cannot render to a multisampled target, so it requires `antialias: false`
  ([MDN OVR_multiview2](https://developer.mozilla.org/docs/Web/API/OVR_multiview2)). That is why Meta's MSAA variant matters.
- **Field results are mixed.** A Babylon.js test saw lower CPU but higher GPU load (47 → 40 fps)
  ([Babylon forum](https://forum.babylonjs.com/t/4-1-0-beta-22-high-gpu-usage-with-empty-scene-in-oculus-quest-vr-mode-with-usemultiview/8174)).
  Other Quest 3 users saw no FPS change
  ([Babylon 2024 thread](https://forum.babylonjs.com/t/multiview-in-webxr-using-quest-3-in-2024/48191)). PlayCanvas devs
  relay Meta's "20–50 %" figure ([PlayCanvas forum](https://forum.playcanvas.com/t/question-for-devs-on-webxr-multiview-rendering/36605)).
  Switching render targets mid-frame under multiview causes **flicker**, which Meta says is by design
  ([Babylon flicker thread](https://forum.babylonjs.com/t/gui-elements-cause-flickering-on-meta-quest-3-with-webxr-multiview-layers/58169)).

### 5.2 What three.js actually supports (verified in source)
| Build | Multiview in `WebGLRenderer`? | Notes |
|---|---|---|
| **three r170 (vendored)** | **No.** No reference to multiview in `src/` | Stereo = 2 draws per object |
| three r176–r186 | **No** (0 matches in `WebGLRenderer.js` / `webxr/WebXRManager.js` in r186.1) | `WebGPURenderer({ multiview: true })` gained `OVR_multiview2` multiview in **r176** ("WebGPURenderer: Add Multiview support", @cabanier, [r176 notes](https://github.com/mrdoob/three.js/releases/tag/r176)). Mugen87: no plans for WebGLRenderer; #20368 closed Aug 2026 |
| **super-three 0.170.1 / 0.181.0** (A-Frame fork, `supermedium/three.js`) | **Yes**: `new WebGLRenderer({ multiviewStereo: true })`, using `OCULUS_multiview` with `framebufferTextureMultisampleMultiviewOVR`, so **MSAA is kept** | Adds `WebGLMultiview.js` and `WebGLMultiviewRenderTarget`; WebXRManager creates a `texture-array` projection layer |
| **Meta IWSDK `@iwsdk/core@1.0.1`** | Uses `three: npm:super-three@0.181.0` and constructs `WebGLRenderer({ antialias: true, multiviewStereo: true })` (`dist/init/world-initializer.js`) | Meta's own three.js stack picks the fork |

**Caveats of the super-three path, from reading its code:**
1. **Lights are not per-view.** `WebGLProgram.js` carries `// TODO: fix light transforms here?`. Lights are set up once in
   the view space of the combined XR camera. That camera sits between the eyes and slightly behind them (r170
   `setProjectionFromUnion`: x ≈ IPD/2, z offset ≈ IPD / fov-sum). Fragments use per-eye view matrices, so near lights such as
   the **carried lantern** are offset by a few cm per eye. Expect slightly different falloff and speculars between eyes. Check
   this on device; if it shows, compute the lantern term in world space inside our patched chunk.
2. **One more program variant per material.** `numMultiviewViews` is in the program key. Desktop-compiled programs recompile
   on entering VR, so **precompile after the session starts** (see §11).
3. Multiview is only used when the session goes down the **WebXR Layers** path (`createProjectionLayer`). Our sessions request
   only `['local-floor','bounded-floor']` (`src/input/xrInput.js:27`, `src/game.js:1320`). Add `'layers'` *together with*
   multiview. Without multiview, see the MSAA pitfall in §8.
4. `RawShaderMaterial` would not get the view-indexed matrix `#define`s. We use none (grep), and `ShaderMaterial` plus
   onBeforeCompile patches are fine because the fork rewrites the prefix.
5. `super-three@0.170.1` is a post-r170 dev snapshot. It ships a split build (`three.module.min.js` imports
   `./three.core.min.js`) and includes r171 deprecations. `0.181.0` is the version Meta ships in IWSDK. Either means
   re-vendoring the matching `GLTFLoader` / `BufferGeometryUtils` from the same package.

**Recommendation:** run a 1-day spike before committing graphics budgets. Swap the import map to `super-three@0.181.0` (or
0.170.1), set `multiviewStereo: true`, request `'layers'`, and A/B the worst scene with OVR Metrics. Count multiview as a
**CPU** win (more draw calls for the overhaul), not a GPU win.

---

## 6. Fixed foveated rendering (`setFoveation`)

- Quest Browser exposes `fixedFoveation` (0..1) on `XRWebGLLayer` and `XRProjectionLayer`. The browser maps the value to its
  low/medium/high levels, and it can change **every frame**, taking effect on the next one. Levels can also be requested
  upfront with `'low|medium|high-fixed-foveation-level'` optional features. High-contrast and text-heavy content shows the
  artefacts most ([Meta WebXR FFR](https://developers.meta.com/horizon/documentation/web/webxr-ffr/),
  [MDN fixedFoveation](https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/fixedFoveation)).
- In three r170, `renderer.xr.setFoveation(v)` writes `glProjLayer.fixedFoveation` or `glBaseLayer.fixedFoveation`, defaulting
  to **1.0, the maximum** (`WebXRManager.js` L29–30, L653–668). We already set 1.
- **FFR only applies to the XR layer's framebuffer.** Anything drawn into our own render targets, such as a post-process
  source, gets no foveation savings. Meta's Unity docs note that apps with post-processing or intermediate passes gain a lot
  from engine-level foveation for this reason ([Meta Unity OpenXR settings](https://developers.meta.com/horizon/documentation/unity/unity-openxr-settings/)).
- **Adopted:** use FFR as the **per-frame dynamic-quality knob**. Run 0.66 (medium) when GPU time is under 9 ms and 1.0 when
  it rises above 10.5 ms, with hysteresis. Keep subtitles and UI near the centre of view or on composition layers. Our dark,
  low-contrast scenes hide FFR well, but bright glyphs and the lantern flare at the periphery will show it.

---

## 7. Framebuffer scale and dynamic resolution

- In three r170, `renderer.xr.setFramebufferScaleFactor(s)` is read **at session start** only. Changing it while presenting
  just warns (`WebXRManager.js` L192–200), so it is a per-session quality tier, not a dynamic knob.
- `XRView.requestViewportScale()` / `recommendedViewportScale` are the WebXR dynamic-resolution API (Chrome 90+)
  ([MDN](https://developer.mozilla.org/docs/Web/API/XRView/requestViewportScale)). **Three r170–r186 never call it** (grep),
  and **Quest Browser support is unverified**. Treat it as a stretch goal that needs a WebXRManager patch.
- Quest's native "dynamic resolution", which also unlocks GPU level 5 (599 MHz), is a native/OpenXR feature. Unity apps get
  it ([Meta CPU/GPU levels](https://developers.meta.com/horizon/documentation/unity/os-cpu-gpu-levels/)), but there is no
  WebXR equivalent I could find. The browser manages clocks.
- **Adopted tiers:** Quest 3/3S use **1.0**. Try **1.1–1.2** only if the multiview spike leaves GPU headroom, because 1.2 is
  about panel-native on Quest 3 and the image is visibly sharper. Never go below 0.85. Dynamic quality inside a session comes
  from FFR level, particle caps and LOD distances, not from resolution.

---

## 8. MSAA

- Quest GPUs are tilers. 4× MSAA resolved **on-chip** costs close to nothing, and Meta runs MSAA framebuffers "at close to the
  same speed as non-MSAA". A **separate resolve** stores 4× data to memory, loads it back and writes again, which Meta
  estimates "could easily add 3 ms" ([Meta: loads, stores, passes](https://developers.meta.com/vr/blog/loads-stores-passes-and-advanced-gpu-pipelines/)).
  Meta's Unity doc puts lazily allocated 4× MSAA at about 90 MB per eye of memory saved at the Quest 3 default resolution
  ([Meta Unity OpenXR settings Quest](https://developers.meta.com/horizon/documentation/unity/unity-openxr-settings-quest/)).
- **Our current path (r170, no `'layers'` requested)** most likely uses `XRWebGLLayer` with `antialias: true`, where the
  browser owns the multisampled framebuffer. Confirm on device by checking whether `renderer.xr.getBaseLayer()` is an
  `XRWebGLLayer`.
- **Pitfall in vanilla r170 (code-verified):** on the Layers path, if the projection layer supplies a depth texture,
  `setRenderTargetTextures` **disables `WEBGL_multisampled_render_to_texture`**. It logs "Render-to-texture extension was
  disabled because an external texture was provided" and falls back to a multisampled renderbuffer plus `blitFramebuffer`,
  which is exactly the expensive explicit resolve. **So do not add `'layers'` to vanilla r170.** Add it only with the
  super-three multiview path, which attaches with `framebufferTextureMultisampleMultiviewOVR` and resolves implicitly.
- **Adopted:** keep `antialias: true` (4×). Thin geometry such as tethers, girder lattices and fronds needs it. Do not use
  alpha-to-coverage on large surfaces.

---

## 9. Texture compression (KTX2 / Basis → ASTC / ETC2)

- Meta: use **KTX 2.0 / Basis Universal**. It cuts in-memory size and texture bandwidth even when files are not smaller than
  JPEG ([Meta WebXR best practices](https://developers.meta.com/vr/documentation/web/webxr-perf-bp/)). The device comparison page
  recommends **ASTC** on Quest 2 and 3 ([device comparison](https://developers.meta.com/horizon/resources/device-optimization-comparison/)).
  Project Flowerbed ships KTX2 Basis made with gltf-transform
  ([Flowerbed](https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/)).
- `WEBGL_compressed_texture_astc` is baseline WebGL ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_compressed_texture_astc)).
  Adreno GPUs support ASTC LDR and ETC2. **Confirm `getSupportedExtensions()` once on the headset.**
- **How r170's KTX2Loader picks formats** (`examples/jsm/loaders/KTX2Loader.js` L650–760) on a GPU with ASTC + ETC2 and no
  BC: **UASTC → ASTC 4×4 at 8 bpp**. **ETC1S → ETC1 RGB at 4 bpp, or ETC2 RGBA-EAC at 8 bpp with alpha.** Fallback is
  RGBA32.
- **VRAM per texture with full mips (derived):**

| Size | RGBA8 (today's JPG/PNG once decoded) | UASTC→ASTC 4×4 | ETC1S→ETC1 |
|---|---|---|---|
| 1024² | 5.6 MB | 1.4 MB | 0.7 MB |
| 2048² | 22.4 MB | 5.6 MB | 2.8 MB |
| 4096² | 89.5 MB | 22.4 MB | 11.2 MB |

- **Policy:**
  - **UASTC** (+ Zstd supercompression) for normal maps, the creature and anything shown up close.
  - **ETC1S** for bulk albedo/ORM on distant rock.
  - **2K** for hero sets: Mason masonry, iron and flesh, plus near-wall rock. 1K elsewhere. 4K never on Quest.
  - Normal maps need `KHR_texture_basisu` + UASTC + `--normal_mode`.
- **Vendoring needed:** `KTX2Loader.js`, `utils/WorkerPool.js`, `libs/basis/basis_transcoder.{js,wasm}`. Transcoding runs in
  workers at load time; do it behind the loading screen. Tooling: KTX-Software `toktx` or gltf-transform
  `uastc` / `etc1s` after the Blender export, since Blender does not write KTX2.

---

## 10. Memory limits

- Native apps on Quest 3/3S are capped at **5.75 GiB PSS**. Exceeding it may not crash at once, but low-memory kills follow
  ([Meta memory](https://developers.meta.com/horizon/documentation/unity/po-memory-ram/)).
- The **browser has no published per-tab limit.** Field reports describe tab kills with ~200 MB GLBs, and GL memory that is
  not released until the session ends after repeated scene switches
  ([Babylon OOM thread](https://forum.babylonjs.com/t/switching-scenes-in-a-webxr-session-makes-quest-2-go-out-of-memory/47868),
  [three.js forum](https://discourse.threejs.org/t/webxr-browser-crash/44356)). Chromium's renderer, GPU and browser processes
  all count against the device.
- **Adopted budget (derived, conservative):**
  - Textures ≤ 300 MB resident (compressed), geometry ≤ 100 MB.
  - JS heap ≤ 256 MB steady, with no per-frame allocation.
  - Streaming: hold only the current section ±1 of the 8-section level. Dispose geometry/textures explicitly; the WebGL
    context is never recreated mid-session.
  - Downloads: ≤ 150 MB for the whole game (PWA). For scale, Above Par-adowski was 14 MB in total.

---

## 11. Shader-compile hitches

- Every unique define set compiles a separate GL program: lights count, fog, maps, skinning, vertex colours, onBeforeCompile
  `customProgramCacheKey`, tone mapping, and the multiview view count in the fork. Program compile and link is blocking unless
  `KHR_parallel_shader_compile` is available. r170 `renderer.compileAsync()` polls `COMPLETION_STATUS_KHR` when that
  extension exists (`WebGLRenderer.js` L1034–1074, `WebGLProgram.js` L1041–1050)
  ([MDN KHR_parallel_shader_compile](https://developer.mozilla.org/docs/Web/API/KHR_parallel_shader_compile)).
- Chromium keeps an on-disk **GPU program cache**, so second launches are faster. The cache is keyed to browser and driver
  versions, and a browser update throws it away ([Chromium shader_disk_cache](https://chromium.googlesource.com/chromium/src/+/539fc83/content/browser/gpu/shader_disk_cache.cc),
  [gpu finch features](https://chromium.googlesource.com/chromium/src/+/798e59c5275d4131797e8ea2e96e6c6000256b58/gpu/config/gpu_finch_features.cc)).
- **Adopted:**
  - Cap at **≤ 24 unique programs per chapter**.
  - Keep a fixed light count (already done; a light-count change triggers recompiles).
  - Run `compileAsync` **inside the XR session** behind a fade, because the XR target can change program keys.
  - Pre-warm every FX, creature-state and section material with one hidden draw during the loading fade.
  - Never toggle `material.defines`, maps or `fog` at runtime. Drive changes through uniforms instead.

---

## 12. Post-processing in WebXR

- **EffectComposer does not support WebXR.** Maintainers say its multi-pass design "does not perform well in XR". The common
  practice is to bypass the composer while presenting
  ([three.js forum](https://discourse.threejs.org/t/is-it-possible-to-use-threejs-postprocessing-in-web-vr/36333)).
- r170 applies `toneMapping` **in each material's shader** when rendering to the XR target. That is why our ACES costs no
  extra pass.
- **Cost of one custom full-screen pass on Quest (derived):**
  - Scene into an RGBA8 RT: 5.9 Mpx × 4 B ≈ 24 MB stored.
  - Read back for the composite pass: ~24 MB, plus a 5.9 Mpx fragment pass.
  - FFR is lost on the scene pass (§6).
  - MSAA must resolve on store, and Meta's estimate for a separate resolve is ~3 ms (§8).
  - Realistically **2–4 ms of a 13.9 ms frame** before any bloom blur chain. Bloom's downsample/upsample chain adds several
    more small passes.
- **What works on Quest:**
  1. Do grading in-shader. Swap to `CustomToneMapping` / override `tonemapping_pars_fragment` with an ACES-plus-grade curve
     and lift/gamma/gain for each section theme, plus hash-noise film grain. Each costs a few ALU ops per pixel.
  2. Fake bloom with **additive billboards and halo cards** on emissive sources: lantern, listening pits, glyphs. We already
     have light glows.
  3. Use emissive textures and a fog "glow pierce" (already in creatureView).
  4. Make the vignette **in-shader** (darken by view angle with `gl_FragCoord` relative to the per-eye viewport), not as a
     full-screen blended quad.
  5. For damage/fear pulses, use a head-locked ring mesh that covers only the periphery, at small overdraw.
- **Desktop tier:** EffectComposer or pmndrs `postprocessing` (one merged effect pass) with bloom + SMAA + vignette, plus
  optional GTAO. This is where an "Unreal-like" look is possible.

---

## 13. Real-time shadows

- Meta: the shadow-map pass counts against the scene's draw-call and triangle budgets, and high-resolution maps can make you
  fragment-bound. **Shadow-casting point lights are "particularly problematic" because they need 6 shadow maps per frame.**
  Bake static lighting and use probes for dynamic objects ([Meta WebXR best practices](https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/)).
- r170 `PointLightShadow._viewportCount = 6` (verified). Shadow maps are rendered **once per frame**, not per eye. Each caster
  adds 6 draws, and every receiving material gets a shadow-sampling variant with PCF cost.
- **Adopted for Quest:** **0 real-time shadow maps** in the default tier. Instead:
  - Bake **lightmaps + AO** for static geometry in Blender, via a second UV set.
  - Use **contact/blob shadows**, projected decals under the creature's feet and body.
  - Use a lantern **light cookie** (projected texture in the lantern term).
  - Apply screen-independent "self-shadow" darkening in creature vertex colours.
- **Optional experiment:** one spot shadow, 1024², creature-only casters, updated every other frame, during a
  scripted reveal only. Ship it only if the device A/B shows < 1 ms.
- **Desktop tier:** a lantern shadow (point or spot, PCFSoft).

---

## 14. Light count in forward rendering

- r170 forward rendering unrolls light loops (`NUM_POINT_LIGHTS`). **Every lit fragment pays for every light slot**, and
  changing the count recompiles programs. Our renderer already pins this: lantern + `ENV_LIGHTS = 2`
  (`renderer3d.js` L45–49). Meta's Unity guidance: avoid excess per-pixel lights; Forward+ helps native engines
  ([Meta Unity best practices](https://developers.meta.com/horizon/documentation/unity/unity-best-practices-intro/)).
  Three's WebGLRenderer has no clustered lighting.
- **Adopted:**
  - **Quest:** ≤ 3 dynamic point lights (lantern + 2 env), fixed count.
  - Everything else is fake: emissive, baked lightmaps, vertex-lit glow, and an additive "light card" volume.
  - Hemisphere/ambient is free.
  - The creature's listening pits glow through emissive and a halo sprite, not through lights.
  - **Desktop:** up to 6–8 point lights.

---

## 15. Skinned meshes (the rigged Mason)

- r170 does GPU skinning with a **float bone `DataTexture`**. Its size is `ceil(sqrt(bones×4)/4)×4`, so there is **no
  hard bone cap** like the old uniform-array limit of ~75 on mobile. Each vertex makes **16 `texelFetch`es** for 4 bone
  matrices (`skinning_pars_vertex`, `Skeleton.computeBoneTexture`). With no multiview, that skinning runs **per eye**.
- **Cost (derived):** 256 bones is a 32×32 RGBA32F texture, 16 KB uploaded per frame. CPU bone-matrix update for 256 bones
  in JS is well under 0.3 ms. A 60 k-vertex creature skinned twice is about 2 M texel fetches per frame, small next to the
  fragment load. **The creature's real cost is screen coverage, fragment shading and overdraw** when it fills the view
  during a lunge.
- **Culling pitfall (verified):** `Frustum.intersectsObject` computes a SkinnedMesh's `boundingSphere` **once** if it is null,
  then reuses it. A creature tens of metres long that moves through the shaft will be culled wrongly. **Set
  `boundingSphere` each frame** from the spine-path bounds (cheap), or set `frustumCulled = false` with a manual distance
  check (the view already has `hideDistance`).
- **Adopted creature budget (Quest):**
  - ≤ 2 skinned draws (body + crown/fronds), ≤ 4 with multiview off.
  - ≤ 256 bones, ≤ 4 influences per vertex.
  - **LOD0 ≤ 70 k triangles**, LOD1 ≤ 20 k, LOD2 ≤ 6 k (silhouette in fog).
  - ≤ 4 texture samples per pixel (triplanar detail counts as 3: budget it).
  - Frond and plate jitter stay in the vertex shader, as today.
  - Simulation (IK for ~10+ legs) ≤ 1 ms of the 3 ms sim budget.
- Unity's old "<30 bones on mobile" advice
  ([Unity manual](https://docs.unity3d.com/2017.2/Documentation/Manual/ModelingOptimizedCharacters.html)) assumed
  uniform-array skinning. It does not apply to three's texture skinning, but bone count still costs CPU and upload.

---

## 16. Particles

- **Use GPU-animated instanced quads**: `InstancedBufferGeometry` with spawn time, seed and velocity attributes, and motion
  computed in the vertex shader from a `uTime` uniform. That is 1 draw per system (2 GL draws without multiview) and no
  per-particle CPU work. `THREE.Points` is cheaper still, but points are square, have an implementation-defined maximum size,
  and pop when their centre leaves the view. That is acceptable only for tiny dust motes.
- There are no soft particles on Quest: the XR depth buffer cannot be sampled mid-frame without an extra pass. Fade by camera
  distance and by angle instead.
- Overdraw is the real limit. Additive and alpha particles at 5.9 Mpx add up fast.
- **Adopted budget:**
  - ≤ 4 particle draws.
  - ≤ 3,000 live particles in total.
  - Big smoke/fog cards ≤ 8 on screen, each ≤ 15 % of the screen.
  - Total blended coverage ≤ 25 %, as in §4.
- Project Flowerbed's trick: render each plant type as **one instanced draw**, with per-instance morph weights. The same
  approach suits debris, chips and stalactites
  ([Flowerbed](https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/), via search summary).

---

## 17. Frame rate, Space Warp, WebGPU and Quest 2

- **Frame rate:** call `session.updateTargetFrameRate(72)`; `supportedFrameRates` is supported in Browser ≥ 16.4. Meta's docs
  name 90 Hz as the Browser default on Quest 2
  ([Meta WebXR frames](https://developers.meta.com/horizon/documentation/web/webxr-frames/)). Without the call we may be judged
  against 11.1 ms. Three r170 never calls it (grep).
- **WebXR Space Warp** exists on Quest Browser 24.2+ as a draft Layers extension. It needs `'layers'` + `'space-warp'`, a
  `texture-array` projection layer, and **motion-vector + depth output from every material**
  ([Meta WebXR Space Warp](https://developers.meta.com/horizon/documentation/web/webxr-space-warp/)). Three has no support, and
  Godot's attempt showed edge artefacts ([Godot PR #99433](https://github.com/godotengine/godot/pull/99433)). Fast rope
  swinging is a worst case for extrapolation. **Not for v1.**
- **WebGPU on Quest:** these are experimental features. Browser 146.0 (Apr 2026) added WebGPU and WebXR depth projection;
  149.1 added WebGPU space-warp layers; 150.1 added WebGPU foveation; 152.1 added WebGPU composition layers. Developer reports
  say the WebXR–WebGPU binding is still behind `chrome://flags`
  ([Meta Browser release notes](https://developers.meta.com/horizon/release-notes/web/),
  [Meta forum](https://communityforums.atmeta.com/questions-and-discussions-26/webgpu-compute-into-webxr-on-quest-175646)).
  Not shippable in 2026.
- **Quest 2** (if the store listing keeps it) has < 100 draw calls / < 750 k triangles native (Meta), 1440×1540 default, and
  4.4 GiB. It needs its own tier: scale 0.85–0.9, FFR 1.0, 1 env light, 1K textures, creature LOD1 as its LOD0.

---

## 18. What the best WebXR titles do

| Title / stack | What they did | Source |
|---|---|---|
| **Project Flowerbed** (Meta, three.js + ECSY) | KTX2/Basis through gltf-transform. Instanced plants with per-instance morph weights. Minimal overdraw, **no post-process resolves**. 72 Hz. Admits each texture variant is its own draw call and that texture arrays would fix it | [Meta case study](https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/), [UploadVR](https://www.uploadvr.com/project-flowerbed-webxr-minigolf-open-source-demos/) |
| **Above Par-adowski** (three.js + A-Frame; Webby WebXR game of the year) | **Unlit vertex-colour baked lighting** from Blender, with no real-time lights and no lightmap textures. PhysX (wasm) at 0.2 ms/frame on Quest 2. **90 Hz**, 14 MB in total | [Meta blog](https://developers.meta.com/horizon/blog/above-par-adowski-webxr-mini-golf/), [Paradowski](https://paradowski.com/stories/above-par-adowski-webxr-mini-golf) |
| **Meta IWSDK** (2025, three.js) | `super-three@0.181.0` with `multiviewStereo: true`, `antialias: true`; Havok physics in workers | npm `@iwsdk/core@1.0.1` (code), [Meta IWSDK blog](https://developers.meta.com/horizon/blog/immersive-web-sdk-new-era-spatial-web-development/) |
| **Wonderland Engine titles** (e.g. HoverFit) | Aggressive batching, since draw calls are the #1 bottleneck. Zero-GC runtime. 72 fps on Quest 3 / 60 on Quest 2 targets | [Wonderland profiling](https://wonderlandengine.com/news/profiling-webxr-applications/), [HoverFit](https://wonderlandengine.com/news/hoverfit-gamifying-fitness-in-webxr/) |

The pattern: the best-looking WebXR titles get their look from **baked lighting, compressed textures, instancing and art
direction**. None of them runs real-time shadows or a post-processing stack on Quest.

---

## 19. Per-frame budget to adopt

| Budget (per frame unless noted) | **Quest 3/3S @72 Hz, r170 as-is** | **Quest 3/3S @72 Hz, super-three multiview** | **Desktop high tier @60–144 Hz** |
|---|---|---|---|
| Main-thread JS p95 | ≤ 8 ms | ≤ 8 ms | ≤ 6 ms |
| GPU p95 | ≤ 11.5 ms | ≤ 11.5 ms | n/a (target 1440p60 on GTX 1660-class) |
| GL draws (`info.render.calls`) | ≤ 200 typ / ≤ 280 peak | ≤ 140 typ / ≤ 200 peak | ≤ 600 |
| Visible scene triangles | ≤ 400 k typ / ≤ 600 k peak | ≤ 600 k typ / ≤ 900 k peak | ≤ 3 M |
| Framebuffer scale | 1.0 (never < 0.85) | 1.0, 1.1–1.2 if GPU headroom shown | devicePixelRatio ≤ 2 |
| Fixed foveation | dynamic 0.66 ↔ 1.0 | dynamic 0.66 ↔ 1.0 | n/a |
| MSAA | 4× (base-layer path; no `'layers'`) | 4× via `OCULUS_multiview` multisample | 4× MSAA or SMAA |
| Dynamic point lights | 3 fixed (lantern + 2) | 3 fixed | 6–8 |
| Shadow maps | 0 (optional 1×1024² spot, creature-only, if < 1 ms) | same | lantern shadow (PCFSoft) |
| Post-processing passes | 0 (in-shader grade/grain/vignette, glow sprites) | 0 | bloom + SMAA + vignette (+GTAO) |
| Texture samples per lit pixel | ≤ 6 (albedo, normal, ORM, lightmap, +2 detail/cookie) | ≤ 6 | ≤ 10 |
| Blended screen coverage | ≤ 25 %, ≤ 3 layers | same | ≤ 60 % |
| Particles | ≤ 4 draws, ≤ 3 k live | same | ≤ 8 draws, ≤ 20 k |
| Creature | ≤ 70 k tris LOD0, ≤ 256 bones, ≤ 2 draws | same | ≤ 150 k tris |
| Unique GL programs / chapter | ≤ 24 | ≤ 24 (+ XR variants precompiled) | ≤ 40 |
| Resident textures | ≤ 300 MB compressed (KTX2) | same | ≤ 1 GB |
| JS heap | ≤ 256 MB, 0 B/frame steady | same | same |
| Refresh rate | `updateTargetFrameRate(72)` | 72 (90 only with ≥ 20 % headroom) | vsync |

---

## 20. Where a real "10×" can come from on Quest within these limits

These are honest levers. Each fits the table above.

1. **Baked lighting and AO** (Blender Cycles → lightmap UV2 or vertex colour, as Above Par-adowski did). This is the largest
   visual jump for the least runtime cost.
2. **Texture resolution ×4 at equal VRAM.** 2K ASTC costs the same as 1K RGBA8 does today.
3. **Geometry ×2–3** with LODs. Multiview, if the spike proves it, frees CPU for more unique draws.
4. **A skinned, 200+-bone Mason** with vertex-shader secondary motion: plate jitter, frond curl, breathing.
5. **Atmosphere from shaders**, not passes: height fog plus animated noise in the existing radial-fog chunk, light shafts as
   additive cards, lantern cookie, wet-surface specular from a static env map (one PMREM cubemap per section).
6. **In-shader grading and grain per section**, plus fake bloom halos.
7. **GPU particles** for dust, drips, chips and spores.
8. A **desktop high tier** with real shadows, bloom and GTAO. That tier can honestly be called "Unreal-like"; standalone Quest
   cannot.

---

## 21. On-device verification protocol

1. **Draw-call sweep.** A debug scene adds N identical lit meshes (N = 50 … 500). Record main-thread ms (`chrome://inspect`
   trace) and OVR Metrics fps for vanilla r170 and for super-three multiview. This yields **our** real draw-call ceiling and
   replaces the derived numbers in §3.
2. **Fill sweep.** A full-screen-coverage test with 1/2/3 point lights and FFR 0 / 0.66 / 1 at scale 0.85 / 1.0 / 1.2. Read
   GPU time from `ovrgpuprofiler` / OVR Metrics.
3. **Worst-case soak.** For each chapter: creature lunge near the face + debris burst + rope. Run 45 minutes (VRC.Performance.1
   wording) and watch stale frames and thermal throttling.
4. **Render-path check.** Log `session.enabledFeatures`, the base layer type, `renderer.capabilities`,
   `getSupportedExtensions()` (look for ASTC, ETC, `OCULUS_multiview`, `WEBGL_multi_draw`, `KHR_parallel_shader_compile`,
   `WEBGL_multisampled_render_to_texture`), `supportedFrameRates` and `view.recommendedViewportScale`.

---

## 22. Open questions and unverified points

- Exact GPU clocks the Browser runs WebXR at, and whether any WebXR path reaches level 5 (599 MHz).
- Whether Quest Browser implements `requestViewportScale`.
- Whether `session.renderState.layers` is defined without the `'layers'` feature on current Quest Browser, which decides
  which r170 path we are on today.
- How large the super-three multiview **lighting offset** (§5.2) is for the lantern at 0.3–1 m.
- Real per-tab memory ceiling of Quest Browser on Quest 3.
- Meta doc numbers were read through search extraction because the host could not be fetched. Re-check the device comparison
  table and the VRC.Quest.Performance.4 status before quoting them externally.

---

## Sources

Meta (developers.meta.com):
- Device optimization comparison (Quest 3 vs Quest 2): https://developers.meta.com/horizon/resources/device-optimization-comparison/
- Unity perf / draw-call tiers: https://developers.meta.com/horizon/documentation/unity/unity-perf/
- WebXR performance best practices: https://developers.meta.com/vr/documentation/web/webxr-perf-bp/ (also /horizon/)
- WebXR performance workflow: https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/
- WebXR performance tools: https://developers.meta.com/horizon/documentation/web/webxr-perf-tools/
- Multiview WebGL rendering: https://developers.meta.com/horizon/documentation/web/web-multiview/
- WebXR fixed foveated rendering: https://developers.meta.com/horizon/documentation/web/webxr-ffr/
- WebXR frames (frame rate API): https://developers.meta.com/horizon/documentation/web/webxr-frames/
- WebXR Space Warp: https://developers.meta.com/horizon/documentation/web/webxr-space-warp/
- Render scale: https://developers.meta.com/horizon/essentials/render-scale
- VRC.Quest.Performance.4: https://developers.meta.com/horizon/resources/vrc-quest-performance-4/
- CPU and GPU levels: https://developers.meta.com/horizon/documentation/unity/os-cpu-gpu-levels/
- Memory (po-memory-ram): https://developers.meta.com/horizon/documentation/unity/po-memory-ram/
- Loads, stores, passes (MSAA resolve cost): https://developers.meta.com/vr/blog/loads-stores-passes-and-advanced-gpu-pipelines/
- Unity OpenXR settings Quest (MSAA memory): https://developers.meta.com/horizon/documentation/unity/unity-openxr-settings-quest/
- Unity OpenXR settings (foveation and intermediate passes): https://developers.meta.com/horizon/documentation/unity/unity-openxr-settings/
- Unity best practices (lights/shadows): https://developers.meta.com/horizon/documentation/unity/unity-best-practices-intro/
- Display refresh rate: https://developers.meta.com/vr/documentation/native/android/mobile-display-refresh-rate/
- Browser release notes: https://developers.meta.com/horizon/release-notes/web/
- Project Flowerbed case study: https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/
- Above Par-adowski: https://developers.meta.com/horizon/blog/above-par-adowski-webxr-mini-golf/
- IWSDK announcement: https://developers.meta.com/horizon/blog/immersive-web-sdk-new-era-spatial-web-development/

three.js:
- r176 release notes ("WebGPURenderer: Add Multiview support"): https://github.com/mrdoob/three.js/releases/tag/r176
- r170 release notes: https://github.com/mrdoob/three.js/releases/tag/r170
- Issue #20368 (OCULUS_multiview; closed, WebGPURenderer only): https://github.com/mrdoob/three.js/issues/20368
- Issue #30560 (WebGPURenderer UBO overhead): https://github.com/mrdoob/three.js/issues/30560
- Forum: EffectComposer in WebXR: https://discourse.threejs.org/t/is-it-possible-to-use-threejs-postprocessing-in-web-vr/36333
- Forum: WebXR browser crash: https://discourse.threejs.org/t/webxr-browser-crash/44356
- Source read locally: three@0.170.0 / 0.176.0 / 0.177.0 / 0.180.0 / 0.186.1, super-three@0.170.1 / 0.181.0, @iwsdk/core@1.0.1 (npm registry)

Other:
- MDN OVR_multiview2: https://developer.mozilla.org/docs/Web/API/OVR_multiview2
- MDN XRWebGLLayer.fixedFoveation: https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/fixedFoveation
- MDN XRView.requestViewportScale: https://developer.mozilla.org/docs/Web/API/XRView/requestViewportScale
- MDN WEBGL_compressed_texture_astc: https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_compressed_texture_astc
- MDN KHR_parallel_shader_compile: https://developer.mozilla.org/docs/Web/API/KHR_parallel_shader_compile
- Chromium shader disk cache: https://chromium.googlesource.com/chromium/src/+/539fc83/content/browser/gpu/shader_disk_cache.cc
- UploadVR XR2 Gen 2: https://www.uploadvr.com/snapdragon-xr2-gen-2/
- UploadVR Quest 3 GPU clock boost: https://www.uploadvr.com/meta-quest-3-gpu-clock-speed-performance-boost/
- UploadVR Flowerbed + Mini-Golf: https://www.uploadvr.com/project-flowerbed-webxr-minigolf-open-source-demos/
- NanoReview Snapdragon 8 Gen 2 (Adreno 740 ALUs/TFLOPS): https://nanoreview.net/en/soc-compare/qualcomm-snapdragon-8-gen-2-vs-qualcomm-snapdragon-7s-gen-2
- Babylon.js multiview reports: https://forum.babylonjs.com/t/4-1-0-beta-22-high-gpu-usage-with-empty-scene-in-oculus-quest-vr-mode-with-usemultiview/8174 , https://forum.babylonjs.com/t/multiview-in-webxr-using-quest-3-in-2024/48191 , https://forum.babylonjs.com/t/gui-elements-cause-flickering-on-meta-quest-3-with-webxr-multiview-layers/58169
- Babylon.js Quest OOM: https://forum.babylonjs.com/t/switching-scenes-in-a-webxr-session-makes-quest-2-go-out-of-memory/47868
- PlayCanvas multiview discussion: https://forum.playcanvas.com/t/question-for-devs-on-webxr-multiview-rendering/36605
- Wonderland Engine profiling / WebGL performance / HoverFit: https://wonderlandengine.com/news/profiling-webxr-applications/ , https://wonderlandengine.com/about/webgl-performance/ , https://wonderlandengine.com/news/hoverfit-gamifying-fitness-in-webxr/
- Godot WebXR Space Warp PR: https://github.com/godotengine/godot/pull/99433
- Paradowski case study: https://paradowski.com/stories/above-par-adowski-webxr-mini-golf
- Meta community forum (WebGPU in WebXR on Quest): https://communityforums.atmeta.com/questions-and-discussions-26/webgpu-compute-into-webxr-on-quest-175646
- Unity manual (mobile bone guidance, historical): https://docs.unity3d.com/2017.2/Documentation/Manual/ModelingOptimizedCharacters.html
