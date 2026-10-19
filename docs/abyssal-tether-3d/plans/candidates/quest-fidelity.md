# ABYSSAL TETHER 3D — Quest-first fidelity overhaul plan

*Planning step, written 2026-10-19. Angle: **show the most on a Quest 3 at a locked 72 fps.** We want the best visual gain per
millisecond: baked light, compressed textures, and material and VFX tricks. The desktop tier is a bonus built on the same
assets.*

**Inputs.**
- Research reports, read in full: `plans/research/{quest,three,blender,art,audit}.md`.
- Game code, read only: `public/abyssal-tether-3d/src`.
- Docs: `CHAPTERS.md`, `ENGINE_EXTENSIONS.md` (E17, E25, E29), `ART_AUDIO_PLAN.md` §0.4, `RELEASE.md`.
- The creature workflow's newest export: `scratchpad/mason2/final/r2/export/export_report.json`, written 11:26.

**New checks made for this plan.**
1. **KTX2 file sizes, measured** on the game's real masonry set (§3.4). Script `plans/qf/ktx_size.mjs`; outputs in `plans/qf/out/`.
2. **Three r170 shadow internals, read in source.** These decide how the Mason's lantern shadow can work (WP C6):
   - The shadow pass tests object layers against the *main* camera (`WebGLShadowMap.js` L331–339).
   - `shadowMap.render()` is public and gated by `autoUpdate`/`needsUpdate` (L72–75).
   - `receiveShadow` is a uniform, not a define (`WebGLRenderer.js` L2093–2096).
3. **`AnimationAction.time` and `.paused`** can be set directly (`AnimationAction.js` L52–62). Phase-locked clips depend on this.

Nothing under `/home/user/TradeCheckPro` was edited. No Blender renders and no Chromium were run. Numbers marked **(est.)** are
model-based estimates and must be replaced by device measurement (WP Q0 gives the protocol). Sources are listed in §11.

---

## 0. The plan on one page

**The honest frame.**
- Quest 3 is a ~1.7–1.8 TFLOPS mobile tiler. It shades about **5.9 Mpx per stereo frame** at render scale 1.0, in a 13.9 ms
  frame ([quest.md §1–4]; [Meta render scale][m-scale]; [Meta device comparison][m-devcomp]).
- Today's MeshStandard shader with 3 lights is already near the per-pixel budget. **Per-pixel cost cannot grow 10×.**
- So on Quest, "10×" has to come from **content**:
  - light that is baked once and sampled cheaply;
  - 4× the texels at *less* VRAM (KTX2);
  - 5× the triangles where the player can see them in stereo;
  - a rigged creature with authored performances;
  - air that is lit, done analytically in the fog chunk;
  - VFX that are capped by overdraw.
- **Post-processing, real-time point shadows, raymarched volumes, and transmission are not used on Quest.** They go in the
  desktop tier, which is where an "Unreal-like" look (bloom, GTAO, real shadows) is possible.
- What Quest gets is a well-art-directed, baked-light look of the kind good native Quest titles have. It is not desktop UE5.

**Five decisions this plan makes** (each is explained where it is used):
1. **GI = a baked irradiance/AO volume on instanced kit geometry.** The volume is baked by a Node script in minutes, survives
   level churn, and also lights the Mason, the hands and the particles. Each kit module carries baked AO, and Cycles lightmaps
   go **only on 4–5 hero chambers** after their layout freezes. Full-level lightmaps are the fallback if the volume looks too
   soft (decision D4).
2. **The lantern becomes a custom shader light, not a three.js `PointLight`.** One code path carries its BRDF, a cage-bar
   cookie, a wet "coat" lobe and the Mason's shadow. No light loop is added and no program changes.
3. **The Mason is one skinned rig of about 217 bones (≤ 255).** The sim stays authoritative:
   - the spine follows the sim trail;
   - 10 legs follow the sim's IK;
   - the other 22 legs (2 raised forelegs, 20 followers) walk a metachronal wave.

   Blender clips add the performance on top, and attack clips are **phase-locked** to the sim's timers. LOD0 is ≤ 60 k
   triangles in 2 draws per eye; the desktop LOD0 is the 124 k export.
4. **Nothing on Quest needs a full-screen pass or a runtime recompile.** Grade, fog, in-scatter, vignette and grain all live in
   materials. Every feature is switched by uniform or visibility, so a **72 fps governor** can turn it down mid-session.
5. **Budgets are code.** One `budgets.json` file is checked by a headless verifier on every work package. GPU milliseconds can
   only be measured on a headset; the device protocol is in WP Q0.

**Execution order** (two tracks in parallel: **Q** = rendering and world, **C** = creature):

| # | WP | One line | Gain per Quest ms | Effort (agent-h) |
|---|---|---|---|---|
| 1 | **Q0** | Measurement, budgets-as-code, 72 fps governor, golden-shot rig | enabler | 12 |
| 2 | **Q1** | KTX2/meshopt pipeline + 2K texture sets | ★★★★★ (≤ 0 ms) | 14 |
| 3 | **Q2** | Light & air: custom lantern light, HDR analytic in-scatter fog, fog dome, AgX grade, dither | ★★★★★ | 16 |
| 4 | **C1** | Mason game build + ~217-bone rig + LODs + 2 atlases (Blender) | ★★★★☆ | 24 |
| 5 | **Q3** | Baked irradiance/AO volume, all 8 sections; lights the world, the Mason and the particles | ★★★★★ | 14 |
| 6 | **C2** | Mason clip library (~20 bpy-authored clips with events) | ★★★★☆ | 18 |
| 7 | **C3** | MasonRigView: layered animation on the sim, phase-locked attacks, materials, LOD | ★★★★☆ | 28 |
| 8 | **C5** | Fear behaviours + menace director (freeze, hide, linger, false retreat, rise, ceiling pass) | ★★★★★ (CPU only) | 20 |
| 9 | **C4** | Mason FX + audio-visual sync (steps, chips, grit, seam breath, lamp dip, bulges) | ★★★★☆ | 12 |
| 10 | **Q4** | Wet surfaces, drip streaks, gravity-true wear, specular AA | ★★★★☆ | 8 |
| 11 | **Q5** | Particles 2.0 (lantern-lit, analytic soft fade), light shafts, halos, decals | ★★★☆☆ | 18 |
| 12 | **C6** | The Mason's lantern shadow on the walls (custom depth RT, encounters only) | ★★★★☆ | 8 |
| 13 | **Q6** | Near-field hero assets: gauntlets, lantern, rope, anchors | ★★★★☆ | 14 |
| 14 | **Q7** | Environment kit + JS kit dresser: no raw box within 30 m, all 8 sections | ★★★☆☆ | 44 |
| 15 | **Q8** | Hero-chamber lightmaps (Cycles) after layout freeze | ★★★☆☆ | 18 |
| 16 | **Q9** | Vista and reveals: far silhouettes, fog cards, S4/S7 staging | ★★★☆☆ | 10 |
| 17 | **Q11** | Multiview spike + render-scale dial ("spend the headroom"); needs a headset | dial | 6 |
| 18 | **Q10** | Desktop high tier: composer bloom/GTAO/SMAA, real shadows, clearcoat, HD Mason | desktop | 16 |
| 19 | **Q12** | Chapters II–V rollout (per-chapter packs and features) | — | ~200 |
| 20 | **Q13** | Certification polish: soaks, postcard shots, blind test, VRC | — | 12 |

Totals:
- **Chapter I + the creature + the desktop tier: about 312 agent-hours.**
- **Chapters II–V: about 200 agent-hours more.**
- Machine time on these shared CPUs: about 6–8 h of bakes and encodes.
- Owner time: about 6 h of on-device measurement.
- Recommended: 6–10 h of a human animator's polish on four hero clips.

**Milestones.**

| Milestone | Work packages | Outcome |
|---|---|---|
| **M1** | Q0, Q1, Q2 | The look changes. Lit air, grade and sharp textures, with no new geometry |
| **M2** | C1, C2, C3, Q3 | The Mason is alive and the world has GI |
| **M3** | C4, C5, C6, Q4, Q5 | Fear, wetness and FX |
| **M4** | Q6, Q7, Q8, Q9 | The world is built |
| **M5** | Q10, Q11, Q13 | Chapter I demo ships |
| **M6** | Q12 | Chapters II–V |

---

## 1. What "10×" means, as a scorecard the owner can check

| Measure | Today (audit) | Quest 3 target | Factor |
|---|---|---|---|
| Texel density on route walls | 256 px/m (1024² over 4 m), JPEG | ≥ 512 px/m (2K sets, trim sheets); ≥ 1024 px/m on hands, rope and anchors | 2–4× linear, 4–16× texels |
| Texture VRAM | ≈ 84 MB uncompressed RGBA8 | ≈ 35 MB ASTC/ETC for the world sets at 4× the texels | 0.4× memory |
| Visible scene triangles per eye | 17–82 k | 250–400 k (kit relief near the route, LODs, fog as LOD) | ≈ 5× |
| Raw boxes within 30 m of the route | all 164 solids | 0 | — |
| Lights that shape the world | lantern + 2 pooled point lights | lantern (cookie, coat lobe, Mason shadow) + 2 dynamic + **all 13 level lights baked with bounce and AO** | every lamp lights its room |
| Lit air | none | lantern + 2 env in-scatter halos, height-pooled fog, fog dome | new |
| Occlusion | tile-scale ORM AO only | volume AO everywhere + per-module AO + chamber lightmaps + the Mason's lantern shadow | new |
| Mason unique triangles | ≈ 5 k kit (21.5 k assembled) | 60 k LOD0 Quest / 124 k desktop | 3–12× |
| Mason deformation | 65 rigid blocks, gaps at bends | ~217-bone skin: rigid stone, blended flesh seams | — |
| Mason authored clips | 0 | ~20 (base + additive, phase-locked) | — |
| Fear beats the rig and AI support | ~5 | 15 in Chapter I (24 across the game; art.md §9) | 3–5× |
| Particle systems | dust points + bursts | 4 lantern-lit GPU systems + shafts + halos + decals, overdraw-capped | — |
| Dark gradients | 8-bit banding | dithered and graded per section | — |

**Proof of 10× (owner-facing).**
- Ten postcard shots (art.md §15) taken from fixed poses, before and after. Headless versions are captured at every
  milestone; headset versions at M3 and M5.
- A blind preference test with ≥ 80 % preferring the new build.
- The table above, regenerated by the verifier.

---

## 2. Quest-first rules: the cost model every WP obeys

| # | Rule | Why (cited in research) |
|---|---|---|
| R1 | **Per-pixel work is a fixed ledger.** World lit pixel: ≤ 5 texture samples typical, 6 with detail or drips, 7 inside the Mason-shadow frustum. ≤ 3 light evaluations. Everything else is ALU in the patched chunks | ~1,000 FLOP per final pixel budget (quest.md §4) |
| R2 | **No full-screen pass and no eye-buffer resolve on Quest.** Grade, fog, in-scatter, grain and vignette run in-material. Bloom is faked with halos and in-scatter | Resolve ≈ 0.5–3 ms, and FFR is lost on intermediates ([Meta loads/stores][m-loads]; [EffectComposer XR revert][t-26904]) |
| R3 | **A fixed light set.** Lantern (custom term) + 2 env `PointLight`s + hemisphere floor. No three.js shadow maps on Quest; the Mason shadow is a custom depth render target | Point shadow = 6 passes ([Meta WebXR BP][m-bp]); light count changes recompile programs |
| R4 | **Switch by uniform or visibility only.** No runtime recompiles, ≤ 24 programs per chapter, `compileAsync` behind fades | VRC exempts fades and loading only ([VRC Perf.1][m-vrc1]) |
| R5 | **Triangles where stereo sees them.** Real relief within ~10 m, silhouettes beyond 30 m. Fog is the LOD | Stereo disparity fades with distance (art.md §2.2) |
| R6 | **Bake what does not move; the lantern lights what does** | Baked-light WebXR titles ([Above Par-adowski][m-apa], [Flowerbed][m-flower]) |
| R7 | **Compress everything** (KTX2 UASTC/ETC1S, meshopt). VRAM is bandwidth on a tiler | ([Meta WebXR BP][m-bp]) |
| R8 | **Transparents are overdraw.** Blended coverage ≤ 25 % of the screen, ≤ 3 layers deep, nothing within 0.5 m of the eyes | quest.md §16; audit (landing puffs: 55 % of the screen at ≥ 4 layers today) |
| R9 | **Design darkness for an LCD.** Use value bands B0–B4, dither every gradient, keep no detail in near-black | Quest 3 LCD shows dark as grey ([MIXED][mixed-dim]) |
| R10 | **CPU draw submission is the hidden bottleneck** (no multiview in r170: every object is drawn twice). Zero allocations per frame | ([three #20368][t-20368]; [Wonderland][wl-prof]) |
| R11 | **Every feature has a kill switch the governor can flip, and a budget line the verifier checks** | — |

**Not on Quest, by design:**
- EffectComposer and any post pass;
- `PointLight` shadows, and three.js shadow maps at all;
- `transmission` and iridescence;
- raymarched fog;
- PMREM on general surfaces (water in Chapter III only);
- broad clearcoat;
- POM;
- morph targets on the Mason's body;
- `logarithmicDepthBuffer`;
- more than 3 dynamic light evaluations;
- WebGPURenderer ([three #30560][t-30560]).

---

## 3. Budgets (the source for `budgets.json`)

These figures replace CONTRACT3D's "≤ 150 draws / ≤ 350 k triangles", ART_AUDIO_PLAN's "Mason ≤ 25 k" and E29's "Chapter I
≤ 15 MB". All of those were set before compression and the rig, and are incompatible with the owner's ask (decision D1).
Draw counts are **GL draws as `renderer.info.render.calls` reports them in XR (both eyes)**.

### 3.1 Frame time (Quest 3 / 3S, render scale 1.0, 4× MSAA, dynamic FFR, 72 Hz)

| GPU bucket (p95 ≤ 11.5 ms of a 13.9 ms frame) | Allocation | Contents |
|---|---|---|
| World opaque shading | 5.5 ms | kit and walls: albedo, normal, ORM, GI volume or lightmap, lantern term, 2 env lights, wetness, fog and in-scatter, grade |
| World vertex work (×2 eyes) | 0.6 ms | ≤ 300 k visible unique triangles |
| The Mason | 0.4 ms typical, **1.5 ms** at attack coverage | skinned LOD0 ×2 eyes, coat lobe, SSS wrap, pits |
| Near field (hands, lantern, rope, anchors) | 0.7 ms | hands can cover 10–20 % of the view |
| Vista + fog dome | 0.4 ms | dome only where nothing else drew |
| Transparent FX | 1.2 ms | ≤ 25 % coverage cap |
| Mason lantern shadow | 0.3 ms | encounters only |
| UI panels | 0.3 ms | menus and the death panel |
| Reserve (thermal, compositor variance) | 1.0 ms | |
| **Total** | **11.5 ms** | Meta lists 13.8 ms for 72 Hz ([device comparison][m-devcomp]) |

| CPU main thread (p95 ≤ 8 ms) | Allocation |
|---|---|
| Simulation (physics, rope, creature sim, threat, beats) | 3.0 ms |
| Mason view (mixer, IK, springs, bone matrices) | 0.6 ms |
| Scene update (matrixWorld, culling, kit re-pack, LOD) | 1.0 ms |
| Draw submission (≤ 200 GL draws, uniforms) | 2.4 ms |
| FX update, governor, audio scheduling | 0.5 ms |
| GC and streaming reserve | 0.5 ms |

**Gate, measured on a headset (WP Q0 protocol).** Today's build is never measured on device (audit §3). **Rule:** at M1, if
today's world shading measures above about 6 ms GPU on the worst pose, features are cut in reverse gain-per-ms order from the
table in §3.5 before any new one is added.

### 3.2 Counts

| Budget | Quest 3 typical | Quest 3 peak | Desktop high |
|---|---|---|---|
| GL draws (both eyes, r170, no multiview) | ≤ 200 | ≤ 280 | ≤ 600 |
| — world (kit instanced + walls + chamber) | ≤ 38 objects | | |
| — Mason | ≤ 2 objects (+1 shadow draw, once per frame) | | |
| — near field | ≤ 8 | | |
| — FX (particles ≤ 4, shafts, halos, decals ≤ 2) | ≤ 8 | | |
| — vista (dome, HLOD, fog cards) | ≤ 4 | | |
| — movers, props, figures (Chapters II+) | ≤ 10 | | |
| — UI | ≤ 4 | | |
| Visible unique triangles | ≤ 400 k | ≤ 600 k | ≤ 3 M |
| — Mason | LOD0 ≤ 60 k / LOD1 ≤ 18 k / LOD2 ≤ 6 k | | 124 k |
| Bones | ≤ 255 (planned ≈ 217), ≤ 4 influences | | same |
| Unique GL programs | ≤ 24 per chapter (+ XR variants precompiled) | | ≤ 40 |
| Dynamic light evaluations per lit pixel | 3 (lantern term + 2 env) | 3 | 6–8 + shadows |
| Texture samples per lit world pixel | ≤ 5 (6 with detail/drips) | 7 in the Mason-shadow frustum | ≤ 10 |
| Particles | ≤ 4 draws, ≤ 3 k live | | ≤ 8 draws, ≤ 20 k |
| Blended coverage | ≤ 25 %, ≤ 3 deep | | ≤ 60 % |
| Allocations per frame (steady state) | 0 B | | 0 B |

Meta's native guidance for Quest 3 is under 200 draw calls and under 1.5 M triangles, both soft
([device comparison][m-devcomp]). Meta's WebXR guide warns that about 1,000 individual draws would drop below 72 fps
([WebXR perf workflow][m-wf]). If the multiview spike (Q11) is adopted, draws count once for both eyes, and the draw budget
becomes ≤ 140 typical / ≤ 200 peak GL draws, each covering both eyes (quest.md §19).

### 3.3 Memory (resident, Quest)

| Item | VRAM (est.) |
|---|---|
| World tileable sets: masonry 2K, metal 2K, rock 2K with 1K normal, rockFar 1K, flesh 1K, shared detail normal 512² | ≈ 35 MB |
| Trim sheets (masonry trim 2K, iron trim 2K) | ≈ 22 MB |
| Kit geometry (~36 modules × 2 LODs, quantized) | ≈ 6 MB |
| GI volumes, current section ±1 (S7 alone = 80×136×80 RGBA8 = 3.5 MB) | ≤ 8 MB |
| Hero-chamber lightmaps + prop atlases (current ±1) | ≤ 30 MB |
| Mason: crown atlas 2K (UASTC albedo/normal, ETC1S ORM, emissive 1K) + body atlas 2K + meshes | ≈ 28 MB |
| Near field (gauntlet 2K set, lantern, rope) | ≈ 14 MB |
| FX atlases, drips, noise | ≈ 4 MB |
| UI canvases | ≈ 10 MB |
| Render targets (Mason shadow 512² depth, etc.) | ≈ 2 MB |
| **Total** | **≈ 160 MB**, against a ≤ 300 MB budget (quest.md §10) |

VRAM per 2K texture with mips: ASTC 4×4 = 5.6 MB, ETC1/ETC2-RGB = 2.8 MB (quest.md §9). The JS heap stays ≤ 256 MB.

### 3.4 Download (measured, not guessed)

I encoded the game's own 1024² masonry set with `ktx2-encoder@0.6.0` (Basis Universal wasm, the same encoder the pipeline
will use). Script: `plans/qf/ktx_size.mjs`, run at `nice 19`.

| Map (1024², full mips) | Mode | File size | Encode time |
|---|---|---|---|
| masonry albedo | ETC1S q128 | **152 KB** | ~1 s |
| masonry albedo | UASTC + RDO 1.0 + Zstd | 923 KB | ~30 s |
| masonry normal | UASTC + Zstd | **1,300 KB** | ~30 s |
| masonry normal | UASTC + RDO 4.0 + Zstd | 1,072 KB | 31 s |
| masonry normal | UASTC level 0 + RDO 3.0 + Zstd | **929 KB** | 8.5 s |
| masonry ORM | UASTC + RDO 1.0 + Zstd | 1,099 KB | 32 s |
| masonry ORM | ETC1S q192 | **219 KB** | 2.8 s |

What this means:
- At 2K (×4) a UASTC normal is **3.7–5.2 MB**. That is the dominant download term.
- RDO 1.0 barely helped. Level-0 UASTC with RDO 3 saved 30 %; its visual quality must be checked in the headset (Q1).
- Today's 15 JPEGs total 5.7 MB.

**Policy that follows:**

| Content | Albedo | Normal | ORM |
|---|---|---|---|
| Hero sets (masonry, iron, both trims, creature crown) | ETC1S (crown albedo: UASTC) | **2K UASTC** | ETC1S, or UASTC for the creature |
| Rock | 2K ETC1S | 1K UASTC + the shared 512² detail normal | 2K ETC1S |
| rockFar, flesh | 1K ETC1S | 1K UASTC | 1K ETC1S |
| Lightmaps | UASTC | — | — |

| Pack | Budget | Contents (est. from the measurements) |
|---|---|---|
| **Core** (boot → S1–S4 playable; the PWA precache) | **≤ 45 MB** (under `gen-precache --max-core-mb 60`) | code + vendor incl. Basis transcoder ≈ 1.5; world sets ≈ 16; trims ≈ 10; kit ≈ 3; S1–S4 volumes ≈ 2; Mason LOD2 + 512² atlas ≈ 1; hands/lantern/rope ≈ 4; core audio ≈ 4; UI ≈ 2 |
| **Chapter I late** (prefetched at start) | ≤ 30 MB | Mason LOD0/1 + atlases + clips ≈ 15; S5–S8 volumes, chambers and lightmaps ≈ 8; props ≈ 4; music and foley ≈ 3 |
| **Each of Chapters II–V** (lazy) | ≤ 45 MB | 3 new sets ≈ 12; kit ≈ 3; chambers and volumes ≈ 10; music ≈ 5; Mason wear masks ≈ 1; misc |
| **Whole game** | ≤ 255 MB worst case, target ≤ 220 MB | quest.md's 150 MB was a conservative derivation, not a platform limit |

### 3.5 Quality tiers and the 72 fps governor

**Session tiers** (chosen before `requestSession`; may change light or program sets, compiled behind the loading fade):

| Tier | Render scale | Textures | Mason | Lights | Other |
|---|---|---|---|---|---|
| **Q3-High** | 1.1–1.2, only if certified by device data (Q11) | as Base | as Base | as Base | 1.2 ≈ the Quest 3 panel's native resolution ([Meta render scale][m-scale]) |
| **Q3-Base** (default, Quest 3/3S) | 1.0 | 2K hero / 1K rest | LOD0 60 k | lantern + 2 env | everything in this plan |
| **Q-Low** (Quest 2, or Quest 3S thermal fallback) | 0.9 (VRC floor 0.85, [VRC Perf.4][m-vrc4]) | 1K everywhere | LOD1 as LOD0 | lantern + 1 env | no Mason shadow, particles at 50 % |
| **Desktop High** | DPR ≤ 2 | as Base, BC7 transcode | HD 124 k | 6–8 + shadows | composer chain (Q10) |

**In-session governor** (`src/render/quality.js`): uniform or visibility only, so it never recompiles. It reads the XR frame
interval from rAF timestamps, where a missed frame at 72 Hz shows as about 27.8 ms, plus the main-thread ms. It steps down
after 0.5 s over budget and up after 2 s of headroom. Steps are taken cheapest-loss first:

| Level | Change | Est. saving |
|---|---|---|
| 0 | full quality; FFR 0.66 (medium) | — |
| 1 | FFR 1.0 (Meta's high level, [WebXR FFR][m-ffr]); env-light in-scatter off; particle cap 75 % | 0.3–0.8 ms |
| 2 | Mason shadow at 18 Hz; kit LOD distances ×0.75; Mason LOD bias +1 beyond 15 m; halo cap 50 %; drip streaks off | 0.5–1.0 ms |
| 3 | Mason shadow off; particle cap 50 %; fog-noise term off; decor band cull ×0.8 | 0.3–0.6 ms |

The frame rate is set explicitly with `session.updateTargetFrameRate(72)`; three r170 never calls it
([Meta WebXR frames][m-frames]).

---

## 4. Work packages

Template for each package: **Goal · Deliverables · Technique · Quest cost · Desktop extras · Acceptance (headless) ·
Dependencies · Effort.** Paths are relative to `public/abyssal-tether-3d/` for runtime code and to the repo root for `tools/`.
Other workflows are editing `src/` now, so every WP adds **new modules plus small hooks** and keeps the old path as a fallback
behind a flag.

---

### Q0 — Measurement, budgets-as-code, 72 fps governor *(prerequisite for everything)*

- **Goal.**
  - Every later WP can be proven with numbers.
  - The game holds 72 fps through a governor.
  - The owner can measure the GPU on a Quest in 15 minutes.
- **Deliverables.**
  - `tools/abyssal-tether-3d/verify/render/`: promote the scratchpad harness (`3d/review-perf/lib.cjs`, `xr-mock-pitch.js`,
    `page/glhook.js`, `page/rprobe.mjs`). Add:
    - `budgets.json` (§3);
    - `gates.cjs`: calls, triangles, programs, texture bytes by GL format, overdraw, allocations per frame, link count after
      warm-up;
    - a **shader static lint**: counts `texture(`/`texelFetch` in each linked fragment program, light loops, `discard`;
    - `poses.json`: 8 sections × 4 views, the 10 postcard poses, and creature scenarios;
    - `goldens/` and `roi.cjs` (region-of-interest luminance metrics).
  - `src/render/quality.js`: tiers and governor (§3.5). `src/ui/perfHud.js`: a dev-only wrist overlay showing fps, missed
    frames, CPU ms, calls, triangles and governor level.
  - `perf.html`: device perf scene. A scripted fly-through of each section's worst pose writes a JSON file (frame intervals,
    missed-frame ratio, CPU ms, GPU ms when `EXT_disjoint_timer_query_webgl2` exists, which is to be probed). Plus
    `docs/abyssal-tether-3d/PERF_PROTOCOL.md`: OVR Metrics capture, 45-min soak, and how to hand the JSON back.
  - Renderer hooks:
    - `updateTargetFrameRate(72)` once the session starts;
    - `setFramebufferScaleFactor(tier.scale)` before the session;
    - a capability log of enabled features, extensions (ASTC, ETC, `OCULUS_multiview`, `WEBGL_multi_draw`,
      `KHR_parallel_shader_compile`, timer query) and `supportedFrameRates`;
    - `precompile()` moves to `renderer.compileAsync`, plus an in-session warm-up behind the enter-VR fade (quest.md §11).
- **Technique.** Reuse the proven Playwright + SwiftShader + mock-XR harness. Today it already reports draws, triangles,
  programs and overdraw per section (`review-perf/out/render-quick.log`).
- **Quest cost.** Governor ≤ 0.05 ms CPU. The HUD is dev-only.
- **Desktop.** `perfDiag.js` adaptive resolution stays.
- **Acceptance.**
  1. `node tools/abyssal-tether-3d/verify/render/gates.cjs --all` runs on today's build and writes `baseline.json`.
  2. Governor unit test: an injected run of 27.8 ms intervals steps down within 0.5 s and recovers after 2 s.
  3. Shader lint fails a planted material with 7 samples.
  4. The XR mock records an `updateTargetFrameRate(72)` call.
  5. Link count after warm-up is 0 across a scripted S1→S8 descent.
- **Dependencies.** None.
- **Effort.** 12 agent-h, plus about 1 h of the owner's headset time.

---

### Q1 — Compression pipeline and 2K texture sets

- **Goal.** 4× the texels for less VRAM, with no main-thread decode hitches. The prerequisite for every art WP.
- **Deliverables.**
  - Vendored from `three@0.170.0`:
    - `KTX2Loader.js`, `utils/WorkerPool.js`, `libs/ktx-parse.module.js`, `libs/zstddec.module.js`, `math/ColorSpaces.js`;
    - `libs/basis/basis_transcoder.{js,wasm}` (675 KB, 292 KB gzip; three.md §5);
    - `libs/meshopt_decoder.module.js`.
  - `src/render/assetLoader.js`: shared `KTX2Loader` (`detectSupport(renderer)`), `MeshoptDecoder`, `GLTFLoader` wiring, and a
    JPEG fallback when KTX2 fails.
  - `tools/abyssal-tether-3d/post.mjs`: `@gltf-transform` with `prune({keepAttributes, keepExtras})`, `dedup`, one `ktx2()`
    pass per texture class, and `meshopt` (blender.md A7).
  - `encode_textures.mjs`: the policy table from §3.4.
  - `build_textures.py --size 2048 --png`.
  - `manifest.json` v2: per map `{ktx2, jpg, mode, size}`.
  - New maps: shared detail normal 512²; drip-streak mask 256².
- **Technique.**
  - **Specular anti-aliasing in-shader on the *perturbed* normal.** Widen roughness by the screen-space variance of the
    normal-mapped normal; about 8 ALU. r170's built-in geometric AA uses only the unperturbed normal (three.md §1.5), and the
    encoder makes its own mips, so a per-mip Toksvig bake is not available.
  - ETC1S for bulk albedo and ORM; UASTC for hero normals (§3.4).
- **Quest cost.**
  - GPU about −0.2 to −0.5 ms (est.; less bandwidth).
  - VRAM 84 → ≈ 35 MB for the world sets.
  - Download ≈ 16 MB for the world sets (vs 5.7 MB of JPEGs).
  - Worker transcode at load, behind the loading screen.
- **Desktop.** KTX2Loader transcodes to BC7 automatically.
- **Acceptance.**
  1. glhook: no world-set upload through `texImage2D` with RGBA8; all through `compressedTexImage2D` in ASTC/ETC formats
     (desktop SwiftShader gets BC or RGBA; the test asserts the format *chosen* by `detectSupport` given a mocked extension
     list).
  2. The VRAM accountant total is within budget.
  3. **Colour-space parity:** at 1K/1K (KTX2 vs JPEG) on 6 golden poses, SSIM ≥ 0.92 and mean luminance within 3 %. This
     catches sRGB/linear mistakes.
  4. **Normal orientation sphere:** lit from +X, the luminance gradient has the right sign.
  5. `?noktx2` boots on the JPEG fallback.
  6. Shader lint: world ≤ 5 samples.
- **Dependencies.** Q0.
- **Effort.** 14 agent-h, plus about 1 h of encoding CPU time.

---

### Q2 — Light & air: the custom lantern light, analytic atmosphere, grade

- **Goal.** The largest perceived jump for the least GPU:
  - lit air and halos;
  - a lantern that casts cage-bar shadows and wet glints;
  - a cinematic per-section grade without banding.
- **Deliverables.**
  - `src/render/atmosphere.js`:
    - `installAtmosphere()` replaces `installRadialFog()` (`materials.js` L796).
    - `patchAtmosphere(material, opts)`: chains existing `onBeforeCompile` and cache keys, injects shared uniforms (lantern,
      env lights, scatter, GI volume, grade, threat), and is used by level, kit, Mason, hands, rope and FX materials.
    - A **fog dome**: an inverted sphere around the head, drawn last, `depthWrite false`.
  - `src/render/lanternLight.js`: **the lantern as a custom direct-light term** inside the patched lights chunk.
    - It builds an `IncidentLight` and calls three's own `RE_Direct`, so the BRDF is identical to today.
    - Attenuation uses `getDistanceAttenuation` with the current 30 m range and 1.6 decay.
    - **Cookie:** procedural cage bars in the lantern's local frame. The bars come from the same JSON as the lantern model
      (Q6). A hood mask is used for Chapter IV's cone.
    - **Wet coat lobe:** a second GGX lobe for the lantern only, on wet or flesh masks.
    - A hook for the Mason shadow (C6).
    - Flicker within art.md L8.
  - The three.js lantern `PointLight` is removed, so `NUM_POINT_LIGHTS` 3 → 2 (fixed). The hemisphere keeps its existence as a
    fog-floor fill.
  - `src/render/themes/ch1.js`: per-section grade tuples (shadow and highlight tint, saturation, contrast, exposure, wetness)
    keyed by section id, using art.md §6.1 values. No level-data edit is needed.
  - Flicker fixes for env lamps (art.md L8): fast swing amplitude ≤ 0.08, the dip ramped over ≥ 150 ms.
- **Technique.**
  - Empty `fog_fragment`. Mix the fog **in linear HDR before tone mapping**, add analytic single scattering for the lantern and
    both env lights (closed form checked in `plans/scripts/inscatter_check.mjs`), an exponential height term per section, and
    an **ALU value-noise** density term (no texture sample).
  - `CustomToneMapping` = AgX + lift/gamma/gain + split tone + saturation, plus a threat shift.
  - `dithering` plus 1–2 LSB triangular grain.
  - The exposure uniform carries dark adaptation (L9).
  - These are three.md §2.6 and §2.16; the lantern term is new in this plan.
- **Why a custom lantern.**
  - The same light count gives a cookie, a coat lobe and a shadow hook in one place.
  - Its world-space evaluation is also immune to the multiview fork's light-offset caveat (quest.md §5.2).
  - Index-matching a three.js `PointLight` inside the unrolled loop is fragile, because the lantern is reparented to the
    controller grip and three sorts lights by traversal order.
- **Quest cost (est.).**

  | Term | GPU |
  |---|---|
  | Lantern term (replaces the point light it removes) | ≈ ±0 |
  | Cookie | +0.05 |
  | Coat lobe (wet pixels) | +0.05–0.1 |
  | In-scatter ×3 | +0.25–0.4 |
  | Height fog + noise | +0.1 |
  | Grade + dither | +0.05–0.1 |
  | Fog dome (looking into the void) | +0.1–0.3 |
  | **Total** | **+0.5–0.9 ms**, +1 draw, 0 MB |
- **Desktop.** The same, plus real bloom (Q10) with the in-material grade compiled out.
- **Acceptance.**
  1. Link count stays 0 after warm-up over a full descent: no recompiles from the new terms.
  2. **ROI metrics** on golden poses, compared with `?atmo=0`:
     - lantern halo ROI (1.5 m around the lantern, in fog): luminance ≥ +12 %, falling off radially;
     - looking down the shaft: dome pixels have stddev > 0 (not a flat clear colour);
     - a fog-gradient ROI has no empty 8-bit histogram bins across its range (dither works).
  3. Value bands per pose: ≤ 2 % of pixels below sRGB 18 (except the death fade); ≤ 8 % at or above 170.
  4. `plans/scripts/flicker_check.mjs` reports ≤ 1 flash pair per second for the lantern, the lamps and the lamp dip.
  5. The cookie shows the cage's bar count. In an angular scan of a wall lit at 1.5 m, the luminance minima equal the bar
     count.
  6. SwiftShader relative frame time ≤ +15 % at the S7 nave pose.
- **Dependencies.** Q0. Q1 is not required.
- **Effort.** 16 agent-h.

---

### Q3 — Baked GI: irradiance and AO volume for all 8 sections

- **Goal.**
  - Every one of the 13 level lights lights its surroundings with bounce and soft occlusion, not only the 2 pooled lights.
  - Corners darken.
  - The Mason, the hands and the particles pick up lamp colour as they pass.
  - The baker survives level-data churn: it runs in minutes in Node and needs no Blender.
- **Deliverables.**
  - `tools/abyssal-tether-3d/bake_volume.mjs`:
    - imports `src/data/level-data-3d.js` and `src/sim/level3d.js`;
    - builds a uniform grid of the box solids;
    - casts 64–128 cosine rays per voxel with 3D-DDA;
    - collects direct light from `level.lights` (colour, intensity, range; occlusion-tested);
    - adds one bounce, using a per-bucket albedo, and a dim fog/sky term;
    - writes RGB = sqrt-encoded irradiance and A = visibility.
  - Output: `assets/volumes/s<N>.bin` (RGBA8) and `.json` (min, size, dims, content hash).
  - `src/render/giVolume.js`: loads into a `Data3DTexture` with `LinearFilter`, cross-fades two volumes over the existing ±9 m
    theme band, and holds the shared uniforms.
  - Sampling:
    - **per fragment** in world, kit and hands materials;
    - **per vertex** in the Mason and particles;
    - indirect diffuse += `vol.rgb`;
    - indirect × `vol.a`;
    - direct × `mix(1, vol.a, 0.35)`.
  - The hemisphere drops to a fog floor.
- **Technique.** three.md §2.1. One voxel is 1 m; quest-tier S7 is 80×136×80. `MAX_3D_TEXTURE_SIZE` is queried at runtime
  ([web3dsurvey][w3d]).
- **Quest cost.**
  - +0.2–0.4 ms GPU (1 trilinear 3D fetch).
  - VRAM ≤ 8 MB resident.
  - Download ≈ 3–5 MB for all sections, gzipped (est.).
  - Bake about 1–3 min for S7 on one core (est.).
- **Desktop.** 0.5 m voxels.
- **Acceptance.**
  1. Determinism: the same input gives the same bytes.
  2. Unit tests:
     - a voxel inside a solid has A = 0;
     - irradiance falls monotonically with distance from an isolated lamp;
     - a voxel behind a wall gets no direct light from the lamp.
  3. ROI: a corner ROI is ≤ 0.8× the luminance of an open-wall ROI on 3 poses.
  4. ROI: each of the 13 lamp pools is ≥ 15 % brighter with the volume than without.
  5. No luminance step above 3 % across a section boundary in a vertical sweep.
  6. Re-baking all 8 sections takes ≤ 5 min on CI.
- **Dependencies.** Q2, for the shared patch helper.
- **Effort.** 14 agent-h.

---

### C1 — The Mason game build and rig (Blender)

- **Goal.** Turn the approved *Ossuary Column* design (r2) into a rest-pose, skinned, LODded, two-material game asset driven by
  the sim. §5 has the full rig contract.
- **Deliverables.**
  - **Promote** `scratchpad/mason2/final/build_r2.py` into the repository as `tools/abyssal-tether-3d/mason/build_mason_v2.py`.
    Add the flags `--rest --game --legs 32 --lods 60000,18000,6000 --materials 2`.
    - In rest mode, wall-dressing functions still draw their random numbers but emit nothing, so the design stays
      bit-identical everywhere else (blender.md B2).
  - `rig_mason.py`:
    - armature per §5.1;
    - **ownership weights recorded at build time**: rigid parts are 1.0 on their owner bone, flesh blends two bones by
      `spine_s` (blender.md B4). Never heat-map auto-weights;
    - ≤ 4 influences, normalized;
    - LOD weights re-applied after decimation.
  - `bake_mason.py`: 2 atlases at 2048²:
    - **crown + neck** (unique UVs, about 220 px/m);
    - **body + legs** (legs share 4 overlapped UV variants);
    - maps: albedo, normal (tangents exported), ORM, emissive;
    - AO at 128–256 spp, denoised with OIDN;
    - island and bake margins 8 px / 16 px (blender.md A3).
  - Vertex attributes: `_SPINE_S`, `_MASK` (r = flesh, g = wet, b = thickness for SSS), `_SWAY` (strands and chains).
  - `export_mason.py`: exporter settings per blender.md B6.3. No `Coat Weight`, so no `KHR_materials_clearcoat`.
    `export_apply=False`. Bone extras: `s`, `k`, `side`, `slot`, `kind`.
  - `post.mjs` produces:
    - `assets/models/mason_rig.glb` (Quest: LOD0/1/2 sharing one skeleton);
    - `mason_rig_hd.glb` (desktop: the 124 k export, 4 atlases);
    - `rig_report.json`.
- **Quest cost.**
  - LOD0 ≤ 60 k triangles. ≤ 2 draws per eye (crown, body); LOD2 is 1.
  - ≈ 217 bones, so the bone texture is 32×32 RGBA32F, 16 KB uploaded per frame (quest.md §15).
  - VRAM ≈ 28 MB.
  - Download ≈ 15 MB (est. from §3.4).
- **Desktop.** The HD GLB.
- **Acceptance (Node, headless).**
  1. `gltf-transform validate` is clean.
  2. Joints ≤ 255; influences ≤ 4, summing to 1 ± 1e-3.
  3. Triangles: LOD0 ≤ 60 k, LOD1 ≤ 18 k, LOD2 ≤ 6 k.
  4. Materials: ≤ 2 for LOD0/1, 1 for LOD2.
  5. Every image is `image/ktx2`.
  6. No `KHR_materials_clearcoat` or `_transmission`.
  7. `_spine_s` is present; spine bone `s` extras strictly increase; the rest-pose spine is colinear within 1 cm.
  8. **Rigidity test** (three.js in Node with CPU skinning): pose ±35° bends at 5 spine bones plus IK-posed legs.
     - Every rigid island (stones, iron, tracery) keeps its edge lengths within 1 mm.
     - Flesh edges stretch ≤ 30 %.
     - ≤ 0.1 % of flesh triangles flip.
     - This proves "stone stays stone, flesh stretches, nothing tears".
- **Dependencies.**
  - The creature-design freeze from workflow #2. Decisions D2 and D3 must be settled before the bakes.
  - Q1 (`post.mjs`).
- **Effort.** 24 agent-h, plus about 1.5 h of CPU (decimating 1.75 M → 60 k, bakes).

---

### C2 — The clip library (Blender, bpy-authored)

- **Goal.** About 20 performances that make the Mason an actor. The list is in §5.4.
- **Deliverables.**
  - `tools/abyssal-tether-3d/mason/anim_mason.py`:
    - keying helpers for anticipation, overshoot and settle, 2–4 frame follow-through offsets per petal or arm, eased Bezier
      keys, and F-curve noise for tremble;
    - every clip stashed on its own NLA track;
    - events in action custom properties, which become glTF animation extras;
    - Blender 5.x slots/channelbags API (blender.md §2.1).
  - `clips.json`: name, kind (override or additive), loop, duration, phase-lock spec, bone mask, events.
  - Optional but recommended: a **human polish pass** in the Blender UI on `rear_windup`, `strike_snap`, `linger_reach` and
    `take_close`, 6–10 h. Headless keying alone reads stiff (blender.md Part D).
- **Quest cost.** ≈ 0.3 MB download (quantized, meshopt). Mixer ≤ 0.2 ms CPU.
- **Acceptance (Node).**
  1. `clips.json` matches the GLB's animation list.
  2. Additive clips: the frame-0 delta is identity within 0.1°.
  3. Loops: first and last keys match within 0.1° / 1 mm.
  4. No `root` translation tracks; no tracks outside each clip's bone mask.
  5. Per-bone angular speed ≤ 1,440°/s, except clips flagged `snap`.
  6. Events parse and fall inside the clip.
  7. Phase-locked clips put `contact` at their documented normalized time.
- **Dependencies.** C1.
- **Effort.** 18 agent-h, plus an optional 6–10 h human pass.

---

### C3 — MasonRigView: the runtime

- **Goal.** Play the rig on top of the sim with no change to gameplay timing. A crazy-scary read at every distance, inside the
  Mason budget.
- **Deliverables** (in `src/render/mason/`; same public API as `CreatureView`; selected by flag; the old view and the stand-in
  remain fallbacks):

  | File | Contents |
  |---|---|
  | `masonRigView.js` | Load; LOD swap with a shared skeleton (0.25 s dither cross-fade, hysteresis); per-frame bounding sphere from the spine and foot bounds (the stale lazy sphere is a known r170 pitfall, quest.md §15); near-eye dither fade at ≥ 0.6 m (art.md S2); per-bone data texture (glow, hidden-for-chapter-length, curl) |
  | `masonAnimator.js` | Mixer layer stack; phase-locked actions (§5.5); additive deltas composed onto the procedural spine (blender.md B9 pattern) |
  | `masonGait.js` | 10 sim legs: analytic 2-bone IK to `body.limbs[i].foot`. 2 raised forelegs (clip + IK) and 20 followers on a metachronal wave. Rib-leg fringe: vertex-shader parameters |
  | `masonFocus.js` | P-FOCUS: critically damped crown and arm look-at, 0.3–0.5 s lag, then a snap |
  | `masonSprings.js` | P-SPRING on arms, chains and strands. Off during a freeze |
  | `masonMaterial.js` | Patch on MeshStandardMaterial (below) |

  `masonMaterial.js` adds:
  - wrap diffuse plus lantern back-light translucency on `_MASK.r`;
  - the coat lobe from Q2 on `_MASK.g`;
  - a fog-coloured fresnel rim for silhouettes;
  - emissive pits set deep in real geometry, so stereo shows depth;
  - **P-HIDE**: emissive and rim to 0;
  - plate jitter and a travelling plate-lift wave in the vertex shader from `_spine_s`;
  - GI volume sampled per vertex;
  - per-chapter wear uniforms: soot, wax runs, wet, bone dust, the stone ramp;
  - ≤ 5 samples: atlas albedo, normal, ORM, emissive, shared wear mask.
- **Quest cost.**
  - CPU ≤ 0.6 ms p95 (est.; the desktop proxy gate is ≤ 0.2 ms).
  - GPU 0.4 ms typical, 1.5 ms at attack coverage.
  - 2 objects (4 GL draws) at LOD0.
  - ≤ 4 programs: body, crown, LOD2, dither-fade variant, all precompiled.
- **Desktop.** HD GLB, `MeshPhysicalMaterial` clearcoat and sheen on flesh and fronds, a real shadow (Q10).
- **Acceptance** (SwiftShader + XR mock + seeded sim scenarios through the existing hooks):
  1. Sim-driven feet within 0.15 m of `body.limbs[i].foot` while planted.
  2. The windup clip reaches ≥ 80 % iris or portal open at windup end, ±1 frame. The `contact` event coincides with
     `creature:strike` ±1 frame.
  3. **True freeze:** bone matrices are bitwise stable for 30 frames during `listen`; additive weights and spring velocities are
     0 on the freeze frame.
  4. The bounding sphere contains every bone in all 600 frames of a chase.
  5. Budgets: ≤ 2 objects, ≤ 60 k triangles per eye, 0 B allocated per frame.
  6. **Silhouette metrics:**
     - LOD2 rendered flat black on grey at 60 m: ≥ 30 leg protrusions counted along the outline (the "lots of legs" read).
     - The head-on crown at 8 m is **not radially symmetric**: correlation with its own rotation by 360°/n, n = 5…12, is
       < 0.85. This is the anti-dartboard test (audit §2.8).
  7. Golden shots C-windup, C-listen, C-pour and C-linger: SSIM against the approved shots.
  8. A soft-gate judge rubric (the scratchpad `judge_*` pattern): "eyes, antennae, mandibles or a face?" must be no.
- **Dependencies.** C1, C2, Q2. Q3 is optional (the volume).
- **Effort.** 28 agent-h.

---

### C4 — Mason FX and audio-visual sync

- **Goal.** Every Mason action has a visible cause and an exactly timed sound (art.md §14). The visual layer stops ignoring
  `creature:step`, `strike` and `attack` (audit §2.6).
- **Deliverables.**
  - `src/render/creatureFx.js`:

    | Event | Effect |
    |---|---|
    | `step` | 4–8 dust and chip particles; a hook-bite decal from a ring buffer of ≤ 64; a haptic tick hook within 10 m |
    | `strike` miss | chip spray + debris; lamp shatter when near |
    | `strike` hit | `take_close` iris, then the fade |
    | `attack` | plate-lift wave + grit sifting from the first 6 segments |
    | `call` | lamp dip + seam puffs |
    | head 8–25 m above the player | grit rain |
    | beat #20 | seam-breath puffs from seam sockets |

  - `src/render/lampDip.js`: art.md L7. Env lamps within 15 m dim toward 40 % over ≥ 0.4 s and their flame cards lean.
  - Wall bulges: ≤ 2 travelling bulge points as uniforms on wall instances, a crack decal, and dust (`wall:bulge`, E17).
  - The sync contract written into the event catalogue:
    - audio never before the visual, and ≤ 100 ms after it for contacts;
    - far events delayed by distance / 343 s, capped at 0.6 s;
    - freezes cut sound and motion on the same frame.
- **Quest cost.** Shares the Q5 particle pool (0 new draws). Decals add 1 draw. ≤ 0.2 ms typical.
- **Acceptance.**
  1. FX spawn on the same frame as the bus event.
  2. Particle counts per event are within spec; pools never allocate; the decal ring stays ≤ 64.
  3. Lamp-dip ramps are ≥ 0.4 s, and `flicker_check` passes.
  4. An instrumented audio-graph mock shows contact sounds scheduled at ≥ the visual frame time and ≤ +100 ms after it.
- **Dependencies.** Q5 (pool), C3.
- **Effort.** 12 agent-h.

---

### C5 — Fear behaviours and the menace director (sim side)

- **Goal.** "Crazy scary" is mostly staging and timing (art.md §0.2). Give the AI the behaviours the rig can now perform:
  holding still, lingering, slow looming, false retreats and approaches from above or below.
- **Deliverables.** These touch the sim, so they are additive and flag-gated, coordinated with the E17 owner.
  - `src/sim/creatureFear.js`:
    - a **menace meter** (paced pressure with a "backstage" withdrawal; art.md §2.6);
    - a startle budget (≤ 1 loud startle per ~5 min, art.md S3);
    - new behaviours: `FREEZE` (true listen), `HIDE` (stone-still at the lantern's edge), `LINGER`, `FALSE_RETREAT`
      (retract → 6 s of silence → a knock from behind and above), `RISE` (slow loom from below), `CEILING_PASS` with
      `creature:ropeTouch`;
    - focus kinds: head, rope hand, lantern.
  - Contract additions to `body`, read-only:
    - `attack {phase, u, dur}`, `freeze`, `hide`, `focusKind`, `speed`, `gaitPhase`;
    - `trailSample(s, out)`, sampling the existing 360-crumb breadcrumb trail at arc length *s* (§5.6).
  - Pacing sims per chapter under `tools/abyssal-tether-3d/verify/`.
- **Quest cost.** +0.1–0.2 ms sim CPU.
- **Acceptance** (Node, seeded, 20 bot runs each):

  | Behaviour | Pass condition |
  |---|---|
  | LINGER | crown 2.5–4 m from the head for 1.5–3 s; never inside the kill radius on Normal; ≤ 1 systemic linger per chapter |
  | HIDE | never within 2× the kill radius |
  | FALSE_RETREAT | silence lasts 5.5–6.5 s; the knock comes from > 120° off the player's facing |
  | RISE | closing speed ≤ 3 m/s inside 30 m |
  | Startle budget | ≤ 1 per 5 min |
  | Screen time | ≤ 10 % (E17 proxy) |
  | Fairness | survival of careful Normal play unchanged against the baseline |

- **Dependencies.** C3 to see the result. Path beats ride on E17 (another workflow).
- **Effort.** 20 agent-h.

---

### C6 — The Mason's lantern shadow (custom, encounters only)

- **Goal.** The scariest single image for the cost (three.md §2.18): leg shadows sweeping across the lantern-lit wall before
  the body is seen.
- **Deliverables.** `src/render/lanternShadow.js`.
  - A separate shadow scene holds an **LOD2 proxy `SkinnedMesh` that shares the Mason's `Skeleton`**.
  - A perspective camera at the lantern is fitted to the Mason's bounds.
  - It renders into a 512² (Quest) or 1024² (High) `WebGLRenderTarget` with a `DepthTexture`, **once per frame (not per
    eye)**, at 36 Hz. The governor can drop it to 18 Hz or off.
  - The depth is sampled in the Q2 lantern term: 1 tap, branched on the frustum.
  - It is active only when the Mason is within 25 m and inside the lantern's range, and fades by uniform.
- **Why not three.js shadows.**
  - r170's shadow pass tests object layers against the **main** camera (`WebGLShadowMap.js` L335), so a "shadow-only" proxy
    cannot be built with layers.
  - A three.js `SpotLight` would add a light loop to every lit pixel.
  - Toggling `castShadow` recompiles programs.
  - This design keeps `NUM_*_SHADOWS = 0` forever.
- **Quest cost.**
  - Depth pass of 6 k triangles: ~0.1 ms. Receiver fetch and ALU: 0.1–0.3 ms. **≤ 0.4 ms while active, 0 otherwise**
    (est.).
  - One small render-target switch *before* the eye pass. This is not a resolve of the eye buffer.
  - 1 MB VRAM.
- **Desktop.** Superseded by the real PCFSoft lantern shadow (Q10).
- **Acceptance.**
  1. A golden pose with the Mason between the lantern and a wall: the shadow ROI is ≤ 70 % of its lit surroundings. With the
     shadow disabled the ROI is identical.
  2. Toggling causes no program link.
  3. Shadow-edge jitter ≤ 2 px between frames at a fixed pose.
  4. Exactly 1 RT render per frame (glhook).
- **Dependencies.** Q2, C3.
- **Effort.** 8 agent-h.

---

### Q4 — Wet surfaces and gravity-true wear

- **Goal.** Speculars that slide as you swing are the cheapest "next-gen" cue there is (art.md §2.3). Physically placed wear
  ends the "random grunge" look.
- **Deliverables.** `src/render/surfaces.js` (a patch):
  - wetness per section (art.md M1: S1 0.1 → S8 0.7);
  - porous albedo darkening ×0.55–0.7 and roughness 0.85 → 0.35;
  - drip streaks on vertical faces below ledges (256² streak mask scrolled in world V);
  - puddle pooling on up faces;
  - soot above lamp positions, rust weep below iron, grime from the volume's AO, polish on anchors and handholds;
  - the shared detail normal blended within 6 m.
- **Quest cost.** +0.15–0.3 ms GPU. +1 sample (drip *or* detail, per material class). 0 draws. +0.3 MB.
- **Acceptance.**
  1. S8 floor under the lantern: specular peak ≥ 1.5× the dry baseline.
  2. Moving the lantern 0.3 m moves the highlight: the ROI frame difference exceeds a threshold.
  3. **Shimmer:** over 30 frames of slow head motion, temporal luminance variance in a 64² ROI is ≤ 1.1× baseline (specular AA
     works).
  4. Albedo texels stay in sRGB 30–200 (no black albedo, art.md M4).
  5. Value bands still pass.
- **Dependencies.** Q1, Q2, Q3.
- **Effort.** 8 agent-h.

---

### Q5 — Particles 2.0, light shafts, halos, decals

- **Goal.** Air with depth and causality: lit motes, grit, drips. Bloom without a pass. Story through grime. Fix the overdraw
  hot spot.
- **Deliverables.**

  | File | Contents |
  |---|---|
  | `src/render/particles2.js` | Instanced quads facing the **head** (no stereo rivalry); spawn and seed attributes, motion in the vertex shader; **lit per vertex by the lantern and the GI volume**; analytic soft fade against the section's shaft planes; near-eye fade at 0.5 m; one 512² atlas. ≤ 4 draws: ambient motes per chapter, events (sparks, puffs, chips, grit, dust), drips, a chapter special |
  | `lightShafts.js` | Analytic cone thickness + scrolling noise + motes inside |
  | `halos.js` | Constant angular size; fog fade; CPU raycast occlusion at 4–8 Hz against level boxes |
  | `decals.js` | Projection at level build into one merged `MultiplyBlending` mesh per atlas: soot, rust weep, mineral runs, ichor and claw scrapes along Mason paths, chalk marks. A runtime ring buffer for hook bites |

  Landing puffs are re-authored to small, short-lived quads.
- **Quest cost.** Transparents ≤ 1.2 ms GPU at the ≤ 25 % coverage cap. ≤ 8 objects (16 GL draws). ≈ 3 MB.
- **Acceptance.**
  1. Overdraw harness, landing-puff pose looking down: transparent average ≤ 1.0, coverage at ≥ 4 layers ≤ 5 % (today 55 %).
  2. Live particles ≤ 3,000 and blended coverage ≤ 25 % at scripted worst moments.
  3. Motes within 2 m of the lantern are ≥ 3× brighter on average than motes at 8 m.
  4. No particle pixels within 0.5 m of the eyes.
  5. 0 B allocated per frame.
- **Dependencies.** Q2, Q3.
- **Effort.** 18 agent-h.

---

### Q6 — Near-field hero assets: gauntlets, lantern, rope, anchors

- **Goal.** These are in view 100 % of the time. They are also the ruler the player uses to judge the Mason's size (art.md
  §2.3). Today they read as orange toys (audit §2.6).
- **Coordination.** Workflow #8 is already doing a "Blender launcher and HD arms" pass. This WP adopts its output and adds
  only what is missing.
- **Deliverables.**
  - `tools/abyssal-tether-3d/build_gauntlets.py`: high → low bakes producing `assets/models/hands_v2.glb`.
    - ≤ 10 k triangles per hand, 1 material.
    - 2K set at ≥ 1024 px/m: leather, iron, brass, greying stone creep (E08).
  - Lantern model: cage bars from the **same JSON as the Q2 cookie**, plus a flame card and a halo.
  - Rope: 8 sides, a 512² fibre-twist normal map tiled along its length, wet darkening, fray fibres.
  - Anchors v2: rope grooves worn into the rings.
- **Quest cost.** +20–30 k triangles; +0.2–0.3 ms GPU; ≈ 14 MB VRAM; draws ±2.
- **Acceptance.**
  1. Node texel-density check (UV area against world area): ≥ 1024 px/m on the gauntlets.
  2. A golden close-up of the hands at 0.4 m.
  3. The cookie's bar count and angles equal the lantern model's (one data source).
- **Dependencies.** Q1, Q2.
- **Effort.** 14 agent-h.

---

### Q7 — Environment kit and the JS kit dresser: all 8 sections

- **Goal.** No raw box within 30 m of the route. Real relief that reads in stereo. The collision boxes stay untouched.
- **Key choice (Quest-first and churn-proof).**
  - Kit **modules** come from Blender. **Placement** is computed in JS at load from the level data, by deterministic rules.
  - So a level-data edit by another workflow re-dresses automatically, the download stays small (modules plus trims, not
    unique section meshes), and draws stay one instanced draw per module and LOD per bucket.
  - The alternative, merged lightmapped section meshes, costs about 20 MB more download and a 30–60 min Cycles re-bake per
    layout change (blender.md A5). Here it is used only for hero chambers (Q8).
- **Deliverables.**
  - `tools/abyssal-tether-3d/kit/build_kit.py`: about 36 modules, each with LOD0 and LOD1 and **per-module AO baked into vertex
    colours** (valid for every instance):
    - masonry: ashlar 4×4 (3 variants + 2 broken), 4×2, 2×4, string course, corbel lips 2 m / 4 m, plinth, pilaster or
      buttress, lancet window, voussoir arch set, stair flight, rubble lip and pile;
    - rock: panel 8×8 displaced ×2, outcrop;
    - iron: I-beam 4 m / 8 m, grating, rivet band, bracket, pipe, chain-link set;
    - flesh rib growth;
    - statue v2 (robed, raised arms, shared by all 13), lamp v2, plaque v2, cage.
  - `build_trims.py`: 2 trim sheets at 2K, high → low baked.
  - Outputs: `assets/kit/underspire_kit.glb` and the trims (KTX2).
  - `src/render/kitDresser.js`:
    - tiles exposed box faces with module instances (hash-chosen variants, edge trims, ledge lips; buried and void-facing
      faces skipped);
    - relief recessed ≤ 0.15 m and protruding ≤ 0.05 m on play surfaces (blender.md A1);
    - per-instance tint, wetness seed and AO scale;
    - one `InstancedMesh` per (module, LOD, bucket) per 64 m band, re-packed near the head as today;
    - box dressing hidden for dressed solids.
- **Quest cost.**
  - 150–260 k visible triangles; +0.3–0.6 ms GPU vertex (×2 eyes).
  - ≤ 32 instanced objects in view (+~44 GL draws vs the box buckets).
  - VRAM ≈ 6 MB geometry + 22 MB trims. Download ≈ 3 + 10 MB.
- **Desktop.** LOD0 at every distance, POM on masonry, extra modules.
- **Acceptance.**
  1. **Collision invariants** (Node): sample 64 points per dressed face; every play-surface instance protrudes ≤ 0.05 m and
     recesses ≤ 0.15 m against its host box face.
  2. **"No raw box" render-ID pass:** boxes drawn in a flat ID colour, everything else black. At every route pose, ID pixels
     within 30 m = 0.
  3. Draws and triangles per pose within budget.
  4. Determinism: the same level gives the same instance hash.
  5. Dressing takes ≤ 200 ms per section on desktop.
  6. Goldens: 8 sections × 2 views.
- **Dependencies.** Q1, Q3, Q4.
- **Effort.** 44 agent-h, plus about 1 h CPU for trim bakes.

---

### Q8 — Hero-chamber lightmaps (after layout freeze)

- **Goal.** Lightmap-quality contact light and colour bleed where the camera lingers.
  - Chapter I chambers: S1 threshold gate and statues; S4 Vault catwalk and far wall; S7 nave spire base; S8 grate; S9 Mark
    chamber.
- **Deliverables.**
  - `tools/abyssal-tether-3d/export_dress.mjs`: writes the dresser's instances inside a chamber AABB to JSON.
  - `build_chamber.py`:
    - instances → merged per bucket;
    - UV1 packed at 16 tx/m;
    - Cycles DIFFUSE bake (direct + indirect, 384 spp), AO in alpha;
    - OIDN `RTLightmap`, dilated;
    - dLDR encode, then UASTC KTX2;
    - a content-hash skip (blender.md A4–A8).
  - Output: `assets/chambers/<id>.glb` and `_lm.ktx2`.
  - At runtime the chamber replaces the instanced dressing inside its AABB. The lightmap's alpha occludes the lantern in
    crevices (blender.md A8).
- **Quest cost.** About 0 GPU (the lightmap fetch replaces the volume fetch there). ≤ 6 merged objects per chamber. ≤ 30 MB
  resident. ≈ 1.5 MB download per chamber. Bakes take 5–30 min CPU each.
- **Acceptance.**
  1. **Calibration grey card:** baked vs real-time lit plane within 5 % luminance (blender.md A5). Run once.
  2. Seams: no step above 4 % across island borders on goldens.
  3. Mip-2 bleed check.
  4. A re-bake is skipped when the content hash is unchanged.
- **Dependencies.** Q7; a per-section layout freeze from the level owners.
- **Effort.** 18 agent-h, plus 1–2 h CPU.

---

### Q9 — Vista and reveals

- **Goal.** The S4 and S7 wide shots stop reading as cut-outs (audit §5.2 #14). The Mason's Pour and Spiral stand out against
  lit haze.
- **Deliverables.** `src/render/vista.js`:
  - far HLOD colossi from kit pieces: unlit, COMBINED baked to vertex colour, lit edges and window glints;
  - 2–3 depth layers of fog cards, ≤ 10 % coverage;
  - S4 far-wall staging with lit haze behind the Pour path (silhouette separation ≥ 1.3:1, art.md §5.2);
  - the S7 spire silhouette.
- **Quest cost.** ≤ 4 draws, ≤ 30 k triangles, ≤ 0.4 ms.
- **Acceptance.**
  1. At S4 and S7 poses: Mason LOD2 against its background has a luminance ratio ≥ 1.3.
  2. Fog-card coverage ≤ 10 %.
  3. Vista budgets met.
- **Dependencies.** Q2, Q7.
- **Effort.** 10 agent-h.

---

### Q11 — Multiview spike and the render-scale dial *(needs a headset)*

- **Goal.** Decide with data whether CPU draw headroom can be doubled, and spend leftover GPU on sharpness.
- **Deliverables.**
  - `?mv=1`: the import map switches to `super-three@0.181.0` (what Meta's IWSDK ships), with `multiviewStereo: true` plus the
    `'layers'` feature (quest.md §5.2).
  - Do **not** add `'layers'` on vanilla r170: it falls back to an explicit MSAA blit (quest.md §8).
  - An A/B with OVR Metrics on S7 Spiral and Mason-lunge poses; a decision record.
  - Render-scale certification: Q3-High (1.1 or 1.2) ships only if p95 GPU ≤ 9.2 ms at 1.0 on the worst pose. 1.2 adds about
    44 % fragment work.
- **Acceptance.**
  - Headless: boots under the mock with super-three (falls back to non-multiview); programs compile.
  - Device: a `perf.html` JSON pair whose missed-frame ratio and CPU ms the verifier compares.
- **Dependencies.** Q0. Best after Q7.
- **Effort.** 6 agent-h, plus 2 h of the owner's device time.

---

### Q10 — Desktop high tier

- **Goal.** The "Unreal-like" tier, honestly on hardware that can run it. Same assets, same art rules.
- **Deliverables.** `src/render/desktopTier.js`, gated to non-XR and a boot-time preset:
  - `EffectComposer`: RenderPass → GTAOPass (half resolution) → UnrealBloomPass → SMAA → LUTPass → OutputPass. The in-material
    grade is compiled out while the composer is active (three.md §6);
  - a real PCFSoft lantern `PointLight` shadow;
  - 6–8 env lights;
  - clearcoat on wet world surfaces and the Mason; sheen on fronds;
  - box-projected PMREM per section;
  - the HD Mason; kit LOD0 everywhere; ×4 particles; DPR ≤ 2.

  **Entering VR from desktop** switches to the Q3 presets behind the enter-VR fade, then `compileAsync`.
- **Cost.** Target 1440p at 60 fps on a GTX 1660-class GPU. `perfDiag` adaptive resolution stays.
- **Acceptance.**
  1. Desktop goldens.
  2. Under the XR mock, glhook shows 0 extra render-target passes per eye.
  3. The set of XR programs equals the Q3-Base set.
- **Dependencies.** Q2–Q9.
- **Effort.** 16 agent-h.

---

### Q12 — Chapters II–V rollout *(per chapter, ≈ 50 agent-h each)*

**Shared per-chapter work:**
- ≤ 3 new texture sets (one 2K hero, the rest 1K);
- about 15 new kit modules;
- volumes per lighting state;
- 2–3 lightmapped hero chambers;
- grade tuples;
- Mason segment count and wear uniforms;
- the same gates;
- a chapter swap returns `renderer.info` to baseline ±5 % (E29).

| Ch | Quest-first features (all inside §3 budgets) |
|---|---|
| **II Lamphold** | **Lamp field**: ~3,000 instanced flame quads with a per-instance `lit` attribute, 2 draws (E25). **Two GI volumes, lit and snuffed, cross-faded by snuff progress (E19).** A whole town "goes out" with no light-count change. Wax and soot decals, ember particles, the movers kit. Mason: soot and wax runs; ember seams for 10 s after each snuff (art.md C1) |
| **III The Mere** | Water surface per volume: fresnel, scrolling normals, **box-projected PMREM 128 per section**, the only PMREM on Quest. Underwater mode: fog swap and a caustic cookie in the lantern term. Height-pooled mist. Mason: wet uniform, plate drips, the highest specular in the game |
| **IV The Keeping** | **Hooded lantern = the cookie's hood mask** in the same lantern term. Bone-dust motes lit only inside the cone (the mechanic made visible). Kept figures instanced with LOD and impostors beyond 40 m. The darkest grade. Mason: figure-plates and the Gather clip |
| **V The Still Flame** | Inverted grade: fog brighter than forms. A stillness band uniform. ≤ 3 beam cones. Particle time scale from the light mask. Mason: stone ramp per segment; the full 32-segment body (the hidden-bone mask is cleared) |

**Effort.** ≈ 200 agent-h for four chapters, plus about 1 h of bake CPU per chapter.

---

### Q13 — Certification polish

- 45-minute soaks per chapter on a headset ([VRC Perf.1][m-vrc1]).
- The 10 postcard shots, before and after.
- The blind preference test (≥ 80 %).
- The flash audit (ISO 9241-391 via WCAG 2.3.1 as a proxy; [W3C][wcag]).
- The VRC checklist and a budget report from the verifier.
- **Effort.** 12 agent-h, plus owner and tester time.

---

## 5. The Mason in detail

### 5.1 Rig contract (≈ 217 bones, ≤ 255 so `JOINTS_0` stays u8)

**Rest pose:**
- Head at the origin facing Blender +Y; body along −Y; dorsal +Z. This exports to glTF +Y up, with the head facing −Z.
- Unit-scale bones only. Taper lives in the mesh. Non-uniform scale is allowed on leaves only (blender.md B3).

| Group | Bones | Parent | Driven by | Extras |
|---|---|---|---|---|
| `root` | 1 | — | never animated (root tracks stripped at load) | — |
| `neck`, `spine_00…26` | 28 | chain from root | **P-SPINE** (sim trail) ∘ additive clips on `neck`/`spine_00–05` | `s` (rest arc length), `k` (girth) |
| `tail_0…1` | 2 | `spine_26` | P-SPINE | `s` |
| `crown` | 1 | `neck` | base clips + **P-FOCUS** | — |
| `iris_00…07` + `iris_v` | 9 | `crown` | clips (iris open/snap). Hinge axes **radial** (rose-window leaves) or one asymmetric ventral hinge (r2 lancet portal). **Never lateral pincers** | `axis` |
| `gullet_0…2` | 3 | `crown` | clips (leaf scale = peristalsis) | — |
| `pit_0…4` | 5 | `crown` | clips (dilate = leaf scale) + glow | — |
| `arm_00…09_{0,1,2}` (crown appendages: stone arms per the bible, or r2 fronds) | 30 | `crown` | clips + **P-SPRING**; curl in the vertex shader for fronds | `phase`, `len` |
| `leg_{L,R}{00…15}_{0…3}` (femur strut, shank, iron metatarsus, grapnel) | 128 | owning `spine_k` | **10 sim legs**: IK to `body.limbs[i].foot`. **20 followers**: metachronal gait. **2 raised forelegs**: clip-driven plus IK. Clips touch only the forelegs (`gather_pull`, listen raise) | `side`, `slot`, `reach`, `kind`, `simLimb` (0–9 or −1) |
| `cage`, `bell`, `chain_{0…3}_{0,1}` | 10 | owning spine bone | P-SPRING | — |
| **Total** | **≈ 217** | | | |

**Legs.**
- r2 has 46–53 leg slots. The Quest rig drives **32**: the 10 sim legs, the 2 raised forelegs and 20 followers.
- Broken and stunted extra legs are rigid-attached to their spine bone.
- **Rib legs**, 2 per segment, are a vertex-shader fringe driven by `_spine_s` plus the gait-phase uniform, with zero bones.
  Total visible legs stay ≥ 50, so the centipede reads at 60 m (art.md §8).

**Chapter length.**
- One master rig. Chapter I uses the r2 body (27 vertebrae, 29.5 m), which fits the sim's ~23 m column plus trail.
- Longer chapters (E17: 22–32 segments) use a 32-vertebra build.
- Shorter ones hide tail vertebrae through the per-bone *hidden* mask: the vertex shader collapses those vertices onto the
  last visible bone at zero cost.

### 5.2 Skinning rules (summary of blender.md B4; non-negotiable)

- **Rigid parts** (stones, iron bands, tracery, teeth or fangs if kept, pits, rebar, hooks) are 1.0 on their owner bone, from
  ownership recorded at build time.
- **Flesh between vertebrae** blends `spine_k`/`spine_{k+1}` by `smoothstep` on `spine_s`.
- **Strut flesh** blends spine → femur over the first 20 % of the strut.
- **Gum and flesh between iris leaves** use the 2–3 nearest leaves plus `crown`.
- ≤ 4 influences; written ≤ 3. Linear blend only (no dual quaternion in glTF). Twist goes on rigid parts.

### 5.3 LODs and materials (Quest)

| LOD | Triangles | Draws/eye | Shown | Notes |
|---|---|---|---|---|
| LOD0 | ≤ 60 k | 2 (crown, body) | < 15 m head distance | full material |
| LOD1 | ≤ 18 k | 2 | 15–42 m | same atlases, sampled at mip 1+ |
| LOD2 | ≤ 6 k | 1 | > 42 m, sightings, **shadow proxy** | 512² atlas; leg fringe still animates (art.md §8) |

Shader ledger (fragment):

| Term | Cost |
|---|---|
| Atlas albedo, normal, ORM, emissive | 4 samples |
| Shared wear mask (chapter wear) | 1 sample |
| Lantern term: BRDF + coat lobe on wet + back-light translucency on flesh | ALU |
| 2 env lights | standard |
| Fog rim, pits, in-scatter, grade | ALU |
| GI volume | per **vertex** |
| **Total** | ≤ 5 samples |

No `MeshPhysicalMaterial` on Quest: the GLTFLoader would silently upgrade any clearcoat extension (three.md §7).

### 5.4 Clip list (30 fps, in place, no root motion)

| # | Clip | Kind | Length | Bone mask | Drives the read | Events |
|---|---|---|---|---|---|---|
| 1 | `crawl_hold` | base loop | 4 s | crown subtree, neck, spine 0–5 | neutral predatory carriage, slight sway | — |
| 2 | `rear_windup` | base, **phase-locked** to the sim windup (0.5–0.75 s) | authored 0.75 s | + forelegs | crown curls back (the sim does the 1.3 m rear); arms flare to a full ring; iris opens onto the lit throat; plate-lift wave | `open@0.55` |
| 3 | `strike_snap` | base, **phase-locked** (sim strike 0.16 s + 0.24 s settle) | 0.4 s | crown subtree | arms sweep forward; iris snaps shut at contact | `contact@0.16` (end of the sim strike phase, u = 1) |
| 4 | `recoil` | base | 0.45 s (sim recoil) | crown, neck | recoil and shiver | — |
| 5 | `coil_grip` | base loop | 3 s | crown, arms, forelegs | the Spiral posture | — |
| 6 | `listen_freeze` | base pose + minute pit pulses | 3 s loop | crown subtree, one foreleg raised | arms wide; slow crown tilt sequence | `pulse@0.4,1.6,2.4` |
| 7 | `linger_reach` | base | 3 s | crown, arms | arms reach toward the lantern, sweep the air, pits draw breath | `inhale@0.8,2.0` |
| 8 | `take_close` | base | 1.2 s | crown, arms | arms close in like an iris around the view (beat #24) | `dark@1.0` |
| 9 | `breathe_seams` | additive loop | 5 s (~0.2 Hz) | spine 0–10, plates | plates rise and fall a few cm | `exhale@2.5` (seam puffs) |
| 10 | `plate_shiver` | additive loop | 0.5 s | spine plates | grinding stone, not uniform noise | — |
| 11 | `arms_flare` | additive pose | 1 s | arms | weight = `body.frondOpen` | — |
| 12 | `arms_sweep` | additive loop | 2 s | arms | Linger and Lantern Hunger | — |
| 13 | `arms_close` | additive | 0.8 s | arms | the Snuff (II) and hide | `close@0.6` |
| 14 | `pit_dilate` | additive loop | 1.6 s | pits | weight = `body.glow` | `pulse@0.2` |
| 15 | `iris_open` | additive pose | 0.6 s | iris | weight = `body.lunge` / roar | — |
| 16 | `roar_call` | additive | 2.5 s | crown, neck, gullet, iris | the call | `open@0.55`, `peak@1.1` |
| 17 | `flinch` | additive | 0.6 s | crown | hit by debris or light | — |
| 18 | `retreat_fold` | additive | 1.5 s | crown, arms | arms fold for the withdrawal | — |
| 19 | `knock_x3` | base | 2 s | crown, neck | the Knock Answer (beat #15) | `knock@0.4,0.9,1.4` |
| 20 | `gather_pull` | base | 3 s | front 4 legs, crown | Chapter IV Gather | `seat@2.4` |

**Phase locking.**
- For clips 2–4 the view sets `action.paused = true` and writes `action.time = u × clipDuration` each frame, where *u* comes
  from `body.attack {phase, u, dur}` (added in C5).
- The animation can then never drift from the sim's kill timing, whatever the difficulty's windup (0.75 / 0.65 / 0.5 s,
  `DIFF_TUNE`).

### 5.5 Procedural layers and per-frame order

| Layer | What | Where |
|---|---|---|
| **P-SPINE** | Each spine bone takes a world frame from `trailSample(s_k)`: position, path tangent, and surface normal from `body.up`. Fallback without C5: a centripetal Catmull-Rom through the 20 sim points, extended along the trail tangent. The sim's 20 points stay the gameplay truth | `masonAnimator` |
| **P-GAIT** | 10 sim legs: analytic 2-bone IK from the hip on the rendered flank to the planted foot; lift arc from `limbs[i].lift`. 20 followers: phase φᵢ = φ₀ − 2π·i/λ + ω·t, with ω from `body.speed`. Body undulation leads the leg wave by ~2.5 rad ([Diaz et al. 2023][jeb]). Feet project onto the clinging plane; with no surface, the foot gropes. Rib fringe in the vertex shader | `masonGait` |
| **P-FOCUS** | Crown (and arms, partially) look at the focus target with a critically damped lag of 0.3–0.5 s, then a small snap on a target switch. Instant tracking reads as a turret (art.md §2.6) | `masonFocus` |
| **P-SPRING** | Damped springs on arms, chains, strands and cage, with gravity. Zeroed on freeze | `masonSprings` |
| **P-JITTER** | Plate shiver and the travelling plate-lift wave, in the vertex shader from `_spine_s` and the bone data texture | `masonMaterial` |
| **P-TIMESCALE** | Per-bone time scale: 0 in freeze, and in Chapter V's light per lit segment | animator + material |
| **P-HIDE** | Emissive 0, rim 0, `arms_close`, plates flush to the wall normal | material + animator |
| **P-WORLD** | Lamp dip, wall bulges, grit emitters | C4 |

**Per-frame order** (≤ 0.6 ms on Quest, est.; zero allocation):
1. `mixer.update(dt)`, with phase-locked actions written first.
2. Additive deltas extracted for the spine bones (`bind⁻¹ · mixed`).
3. P-SPINE writes local TRS, then composes the delta.
4. P-FOCUS post-multiplies on `neck` and `crown`.
5. P-GAIT: IK, then followers. A freeze holds the last pose.
6. P-SPRING.
7. One `root.updateMatrixWorld(true)`.
8. Bounding sphere from spine and foot bounds.
9. Bone data texture update (glow, hidden, curl).
10. C6 shadow camera fit.

three then runs `skeleton.update()` once per frame, even in stereo (three.md §1.5).

### 5.6 Integration with the existing sim payloads (no gameplay change)

| Sim output (existing, `creature3d.js`) | Rig use |
|---|---|
| `body.spine`, `body.up`, `body.scale` | P-SPINE input (fallback path). `scale` only modulates the breathing heave; taper lives in the mesh |
| `body.head {x,y,z,f*,u*}` | crown base frame |
| `body.focus {x,y,z,amount}` | P-FOCUS target and maximum turn |
| `body.limbs[10] {seg, side, reach, hip, foot, planted, lift}` | the 10 sim legs, mapped by `simLimb` bone extras |
| `body.frondOpen` | `arms_flare` weight |
| `body.glow` | pit emissive + `pit_dilate` weight |
| `body.lunge` | `iris_open` weight + spine-thrust emphasis on the first 4 bones |
| `body.jitter` | `plate_shiver` weight + vertex-shader jitter amplitude |
| `body.listen` | `listen_freeze` weight; ≥ 0.9 means a true freeze |
| `body.visible`, `creature.sighting` | visibility; LOD2 plus fog cap during sightings |
| `creature:state {from,to}` | base-layer cross-fade table (below) |
| `creature:attack {windup}` | arm `rear_windup` phase lock (duration = `windup`) |
| `creature:strike {hit}` | `strike_snap` → miss: chips (C4); hit: `take_close` |
| `creature:step {intensity}` | C4 dust, chips, decal; follower gait phase nudge |
| `creature:call` | `roar_call` + lamp dip |
| `creature:retreat` | `retreat_fold` |
| `creature:burst {snap}` | plate-lift wave + grit; P-FOCUS snap |

| Sim state | Base layer | Additives |
|---|---|---|
| DORMANT, DISTANT | `crawl_hold` | `breathe_seams` 1.0; slow gait |
| OBSERVING | `crawl_hold` → `listen_freeze` by `body.listen` | breathe 0 during listen |
| APPROACHING, PURSUING | `crawl_hold` | breathe 0.5; gait by speed |
| BURST | `crawl_hold` | `plate_shiver` by jitter; fast gait |
| ATTACK | `rear_windup` → `strike_snap` (phase-locked) | `iris_open` by lunge |
| RECOVERING | `recoil` | scrabble gait (beat #10) |
| New in C5: LINGER / HIDE / FALSE_RETREAT / RISE | `linger_reach` / `crawl_hold` + P-HIDE / `retreat_fold` / `crawl_hold` crown-up | per beat |

**Contract additions (C5, read-only, flag-gated):** `body.attack {phase,u,dur}`, `freeze`, `hide`, `focusKind`, `speed`,
`gaitPhase`, `trailSample(s, out)`.

### 5.7 Fear behaviours: Chapter I beats and what implements each

From art.md §9's 24 beats, Chapter I ships these 15. The others land with Chapters II–V.

| Beat | Perceived | Rig / view | Sim | FX / world |
|---|---|---|---|---|
| #1 The Pour (S4) | liquid masonry across the far wall; leg wave at 60–170 m | LOD2 + low-frequency gait | existing sighting | Q9 lit haze; audio delayed by d/343 |
| #3 Grit Rain | grit through the lantern light, then legs on the ceiling | P-GAIT inverted | head above player | C4 grit 0.5–1 s before the scrape |
| #4 Lamp Dip | lamps dim and lean toward it | — | head < 15 m from a lamp | C4 `lampDip` (ramped) |
| #5 The Listen | everything stops, one leg raised, crown turns to your head | `listen_freeze`, `pit_dilate`, P-FOCUS; breathe and springs off | `freeze` | audio cut on the same frame |
| #6 Stone-Still | it becomes wall at the light's edge | P-HIDE + freeze | `hide` | Troxler-friendly: no emissive, no motion |
| #7 The Linger (S9) | crown 3 m from your head, staying | `linger_reach`, `arms_sweep`, P-FOCUS lantern → head | LINGER | rope haptic hum |
| #8 The Rear | the full-ring telegraph | `rear_windup` + plate-lift | ATTACK windup | grind locked to the rear |
| #9 The Snap | a stone clap on a miss, chips | `strike_snap`, `iris_snap` | strike | C4 chips; clap ≤ 30 ms |
| #10 Recoil and Scrabble | a shiver nose to tail, frantic re-grip | `recoil`, fast gait | RECOVERING | click storm |
| #11 False Retreat | withdraws; 6 s of silence; a knock behind and above | `retreat_fold` | FALSE_RETREAT | silence; knock |
| #12 The Spiral (S7) | coils down the spire past you at 6–8 m | `coil_grip` + helical gait | E17 path | debris rain |
| #13 Ceiling Crossing | arms hang like a chandelier; one brushes your rope | P-SPRING with gravity | CEILING_PASS, `ropeTouch` | rope thrum |
| #14 The Rise | 5 cold points, then the ring, out of the void below | `crawl_hold` crown-up | RISE (slow) | in-scatter makes the pits read in fog |
| #20 Seam Breath | grit puffs at seams in rhythm | `breathe_seams` | DISTANT, OBSERVING, RECOVERING | C4 seam puffs |
| #24 The Taking | arms close over the view from the edges | `take_close` | strike hit | fade completes before 0.8 m (art.md S2) |

**Originality guard** (owner brief and art.md §2.9): no eyes, no antennae, no insect mandibles.
- The iris opens **radially or as a hinged portal**, never as lateral pincers.
- The glow sits only deep inside the pits.
- The pits stay few and large (trypophobia-safe).
- The C3 head-on asymmetry test and the judge rubric enforce this.

---

## 6. The 8 current sections: what each gets

| Section | Hero visual delivered | From | Worst moment the gates measure |
|---|---|---|---|
| S1 Threshold | teal shafts with lit motes; threshold-lamp in-scatter; statues v2; colossus window vista; gate chamber lightmapped; dry ash | Q2 Q5 Q7 Q8 Q9 | start pose, looking down |
| S2 Long Swing | chain sway; pillar-parallax reveal; first far call delayed by distance | Q7 Q5 C4 | swing past the pillars |
| S3 Broken Gallery | first drips, wetness 0.3, verdigris accent, grit sifting from above | Q4 Q5 C4 | gallery from the bridge |
| S4 Listening Vault | **The Pour**: LOD2 crossing the far wall in lit haze, readable leg wave; lightmapped catwalk; void-parallax motes | C3 Q9 Q8 Q5 | Pour reveal |
| S5 Gullet Stair | wall bulges, then pursuit from above; grit rain; ember key; wetness 0.5 | C4 C5 Q4 | lunge on the stair |
| S6 Two Descents | leg forest through colonnade gaps; drips; frayed rope fibres | C3 C5 Q7 Q6 | peripheral pass |
| S7 Hollow Nave | **The Spiral** at 6–8 m; debris rain; false retreats; lightmapped spire base; the widest vista | C1–C6 Q8 Q9 | Spiral pass (the frame-budget worst case) |
| S8 Last Throat | pursuit from above; ash rain; wetness 0.7; grate slam; amber → white-gold near the grate | C4 Q4 Q5 | grate slam |
| (S9 The Mark, planned) | **the Linger** at 3 m; motes stop; the Mark Lamp | C5 Q2 | Linger |

---

## 7. Verification architecture

### 7.1 Headless (CI)

Every gate below runs headless and fails CI. Nothing here needs a headset.

| Layer | Tooling | Proves |
|---|---|---|
| Asset checks | Node: `gltf-transform validate`, `glb-check.mjs`, `clip-check.mjs`, the rigidity test, the texel-density check, KTX2 header checks (format, transfer function, mips) | rig, weights, LODs, clips, compression, texel density |
| Sim checks | Node: seeded pacing sims, fear-behaviour assertions, determinism | fear behaviours and fairness |
| Render gates | Playwright + Chromium SwiftShader + mock XR + glhook (promoted from `scratchpad/3d/review-perf`) | draws, triangles, programs, link count after warm-up, texture bytes by format, overdraw, allocations per frame, shader static lint (samples, discard), RT passes per frame |
| Visual gates | goldens + `roi.cjs` | SSIM against approved shots; ROI luminance tests (halo, AO corners, shadow, wetness, motes); value-band histograms; banding bins; asymmetry and leg-count silhouette metrics |
| Relative cost | SwiftShader A/B per feature (precedent: `gpu.log` measured −23 % with 0 env lights) | no feature exceeds its relative-cost cap. A *proxy* only; never quoted as Quest ms |
| Safety | `flicker_check.mjs` | ≤ 1 flash pair per second |
| Soft gate | vision-model judge (the scratchpad `judge_*` pattern) with an art.md rubric | "no face, eyes, antennae, mandibles"; reads as a long many-legged thing; value bands |

### 7.2 On the headset (the owner; about 15 min per milestone)

Headless SwiftShader cannot measure Adreno GPU time, thermal throttling, real FFR/MSAA behaviour or how the LCD shows darks.
So:
1. Open `perf.html?route=all` in Quest Browser with OVR Metrics running. The page flies through each section's worst pose
   and saves `perf-<date>.json`.
2. Hand the JSON back. The verifier checks the p95 frame interval, missed-frame ratio ≤ 1 %, CPU ms, and GPU ms when the timer
   extension exists.
3. Capture the 10 postcard shots from fixed poses (M3, M5).
4. At M5, run a 45-min soak per chapter (VRC.Quest.Performance.1).

---

## 8. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **No on-device GPU numbers exist** (audit §3); every ms here is an estimate | certain | high | Q0 device protocol at M1; reverse gain-per-ms cut rule (§3.1); the governor; per-feature kill switches |
| 2 | Today's base shading already uses most of the GPU, leaving < 3 ms for new features | medium | high | Measure first. The biggest wins (Q1 textures, Q3 volume, C1 rig) cost ≤ 0.4 ms each; render scale stays at 1.0 |
| 3 | Level-data churn by other workflows invalidates bakes | high | medium | Volume baked in Node in minutes; JS kit dresser; lightmaps only after a per-section layout freeze, with content-hash skips |
| 4 | Creature design churn (crown with or without teeth, leg count, fronds or stone arms) | high | high | The rig contract is generator-driven and name-based; iris bones support both hinge styles; decisions D2/D3 before C1 bakes |
| 5 | Headless-keyed clips read stiff | high | high | Procedural layers carry most of the life; animation-principles helpers; a human pass on 4 hero clips (6–10 h) |
| 6 | CPU draw submission (no multiview) limits kit density | medium | medium | Instanced modules; draw budget gates; the Q11 multiview spike |
| 7 | Download size: 2K UASTC normals at 3.7–5.2 MB each | certain | medium | Measured policy (§3.4): 2K UASTC normals only on hero sets; level-0 UASTC + RDO 3 (−30 %) if it passes the headset check; packs streamed lazily |
| 8 | Shader variant growth → mid-game hitches (VRC) | medium | high | ≤ 24 programs per chapter; link count = 0 after warm-up as a CI gate; `compileAsync` behind fades |
| 9 | Overdraw spikes with the creature or bursts near the face | medium | medium | 25 % coverage gate; near-eye fades at 0.5 / 0.6 m; head-facing quads |
| 10 | Photosensitivity regressions (lamp dips, strike flashes, pit pulses) | medium | high | `flicker_check` in CI; L8 ramps; `reducedEffects` (art.md S7) |
| 11 | Quest Browser feature unknowns: ASTC HDR, `WEBGL_multi_draw`, parallel compile, timer query, `requestViewportScale` | certain | low–medium | Q0 capability log; no design depends on them |
| 12 | Concurrent edits to `src/` | high | medium | New modules plus small hooks; old paths kept behind flags; one integration owner per hook file |
| 13 | Thermal throttling over 45 minutes | medium | high | 1 ms reserve; the governor; a Q-Low fallback tier |
| 14 | KTX2 transcoder memory spikes and the CSP for wasm or blob workers | low | medium | Transcode behind loading; one worker pool; CSP note in RELEASE |
| 15 | The custom lantern term diverges from three's BRDF | low | medium | It calls three's own `RE_Direct`; a golden A/B against the old PointLight before the cookie is added |
| 16 | The C6 proxy-shadow design is unproven | medium | low | It is isolated: off = zero cost; 8 h WP; three's SpotLight shadow is the fallback if the cost is accepted |

---

## 9. Decisions needed from the owner

1. **D1: Accept the revised budgets.**
   - ≤ 200 GL draws typical / ≤ 280 peak.
   - ≤ 400 k visible triangles.
   - Mason LOD0 ≤ 60 k.
   - Chapter I ≤ 75 MB (≤ 45 MB core); whole game ≤ 220–255 MB.

   These replace ≤ 150 draws, ≤ 350 k triangles, a 25 k Mason and a 15 MB demo, which cannot carry "10×".
2. **D2: The crown.** r2's lancet portal with stone-tracery fangs and a toothed throat, or the bible's tooth-free stone iris
   onto a vaulted "nave-throat"? The owner's brief bans only eyes, antennae and insect mandibles.
   - **Recommendation:** keep r2's portal, but open it as a hinge or iris, and keep the teeth as stone tracery. Avoid any
     ring-of-teeth read.
   - It must be chosen before the C1 bakes.
3. **D3: Legs.** 32 rigged plus a rib-leg fringe (≥ 50 visible) on Quest, with all r2 legs on desktop only (recommended).
4. **D4: GI strategy.** Volume + instanced kit + hero-chamber lightmaps (recommended), or full-level lightmaps (about 20 MB
   more and re-bakes on every layout change).
5. **D5: Quest 2.** Keep the Q-Low tier for a Quest 2 store listing, or drop Quest 2.
6. **D6: Budget a human animation pass** (6–10 h) for `rear_windup`, `strike_snap`, `linger_reach` and `take_close`.
7. **D7: Device time.** The owner or a tester runs the 15-minute `perf.html` protocol at M1, M3 and M5. No agent can measure
   Quest GPU time from here.

---

## 10. Summary of deliverable paths (new)

**Runtime** (`public/abyssal-tether-3d/`):
- `src/render/`: `quality.js`, `assetLoader.js`, `atmosphere.js`, `lanternLight.js`, `giVolume.js`, `surfaces.js`,
  `particles2.js`, `lightShafts.js`, `halos.js`, `decals.js`, `kitDresser.js`, `vista.js`, `lampDip.js`, `creatureFx.js`,
  `lanternShadow.js`, `desktopTier.js`, `themes/ch1.js`.
- `src/render/mason/`: `masonRigView.js`, `masonAnimator.js`, `masonGait.js`, `masonFocus.js`, `masonSprings.js`,
  `masonMaterial.js`.
- `src/sim/creatureFear.js`, `src/ui/perfHud.js`, `perf.html`.
- `vendor/three/addons/`: the KTX2Loader set, basis transcoder and meshopt decoder.
- `assets/`: `volumes/`, `kit/`, `chambers/`, `models/mason_rig.glb`, `models/mason_rig_hd.glb`, `models/hands_v2.glb`,
  KTX2 texture sets.

**Tools** (`tools/abyssal-tether-3d/`):
- `post.mjs`, `encode_textures.mjs`, `bake_volume.mjs`, `export_dress.mjs`, `build_gauntlets.py`;
- `kit/build_kit.py`, `kit/build_trims.py`, `build_chamber.py`;
- `mason/{build_mason_v2,rig_mason,bake_mason,anim_mason,export_mason}.py`;
- `verify/render/{gates.cjs, roi.cjs, budgets.json, poses.json, goldens/}`, `verify/{glb-check,clip-check}.mjs`.

**Docs:** `docs/abyssal-tether-3d/PERF_PROTOCOL.md`, plus budget updates to CONTRACT3D, ART_AUDIO_PLAN §0.4 and E29 once
D1 is accepted.

---

## 11. Sources

**Meta** (several developers.meta.com pages could only be read through search extracts from this sandbox; see quest.md):
- [m-devcomp] Device optimization comparison (Quest 3: 13.8 ms at 72 Hz, < 200 draws, < 1.5 M triangles):
  https://developers.meta.com/horizon/resources/device-optimization-comparison/
- [m-scale] Render scale (1680×1760 per eye at 1.0; ≈ 1.2 is panel-native): https://developers.meta.com/horizon/essentials/render-scale
- [m-bp] WebXR performance best practices (KTX2/Basis; point-light shadows need 6 maps; bake static lighting):
  https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
- [m-wf] WebXR performance workflow (~1,000 draws would drop below 72 fps):
  https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/
- [m-loads] Loads, stores, passes (MSAA on tile; separate resolve ≈ 3 ms):
  https://developers.meta.com/vr/blog/loads-stores-passes-and-advanced-gpu-pipelines/
- [m-ffr] WebXR fixed foveated rendering: https://developers.meta.com/horizon/documentation/web/webxr-ffr/
- [m-frames] WebXR frames (`updateTargetFrameRate`): https://developers.meta.com/horizon/documentation/web/webxr-frames/
- [m-mv] Web multiview (25–50 % CPU reduction): https://developers.meta.com/horizon/documentation/web/web-multiview/
- [m-vrc1] VRC.Quest.Performance.1: https://developers.meta.com/horizon/resources/vrc-quest-performance-1/
- [m-vrc4] VRC.Quest.Performance.4 (≥ 85 % render scale, recommended): https://developers.meta.com/horizon/resources/vrc-quest-performance-4/
- [m-flower] Project Flowerbed case study: https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/
- [m-apa] Above Par-adowski (baked vertex lighting): https://developers.meta.com/horizon/blog/above-par-adowski-webxr-mini-golf/

**three.js**
- [t-20368] Issue #20368 (multiview only in WebGPURenderer): https://github.com/mrdoob/three.js/issues/20368
- [t-26904] PR #26904 (EffectComposer support in WebXR reverted): https://github.com/mrdoob/three.js/pull/26904
- [t-30560] Issue #30560 (WebGPURenderer WebGL2 fallback overhead): https://github.com/mrdoob/three.js/issues/30560
- AnimationAction (`time`, `paused`, `timeScale`): https://threejs.org/docs/#api/en/animation/AnimationAction
- Source read locally (`plans/three-full/package`, r170):
  - `src/renderers/webgl/WebGLShadowMap.js` L72–75 (gate), L331–339 (layers test against the main camera);
  - `src/renderers/WebGLRenderer.js` L1216–1218 and L2093–2096;
  - `src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js` L119;
  - `src/animation/AnimationAction.js` L52–62.

**Other**
- [mixed-dim] MIXED, Quest display dimming hands-on (LCD blacks): https://mixed-news.com/en/meta-quest-display-dimming-hands-on/
- [wl-prof] Wonderland Engine, profiling WebXR applications: https://wonderlandengine.com/news/profiling-webxr-applications/
- [w3d] web3dsurvey `MAX_3D_TEXTURE_SIZE`: https://web3dsurvey.com/webgl2/parameters/MAX_3D_TEXTURE_SIZE
- [jeb] Diaz et al. 2023, centipede locomotion (JEB): https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf
- [wcag] W3C WCAG 2.3.1, three flashes: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- KTX-Software / Basis Universal: https://github.com/BinomialLLC/basis_universal ; `ktx2-encoder@0.6.0` (npm)

**Local artefacts from this step:** `plans/qf/ktx_size.mjs`, `plans/qf/ktx_size2.mjs`, `plans/qf/out/*.ktx2` (measured sizes
in §3.4), `plans/qf/jpg2png.py`.

**Research inputs:** `plans/research/quest.md`, `three.md`, `blender.md`, `art.md`, `audit.md`. Their own sources are listed
in each report.
