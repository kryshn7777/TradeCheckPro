# ABYSSAL TETHER 3D: GRAPHICS PLAN (final)

*Lead technical art direction, written 2026-10-19. This plan supersedes the three candidates in `plans/plans/`. The
creature is specified in the companion file
`/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad/plans/CREATURE_RIG_PLAN.md`;
this file lists its packages so the whole schedule is in one place.*

**Inputs.**
- Read in full: the five research reports (`plans/research/{quest,three,blender,art,audit}.md`) and the three candidate
  plans (`plans/plans/{quest-fidelity,showcase,art-direction}.md`).
- Re-checked against the live tree at 12:00–12:10:
  - `src/render/*`, `src/sim/creature3d.js`, `game.js` loader lines;
  - `tools/abyssal-tether-3d/{build_env_kit,build_hands}.py`;
  - `docs/abyssal-tether-3d/ENGINE_EXTENSIONS.md` (E01, E17, E25, E29);
  - the creature workflow's newest r2 export (`scratchpad/mason2/final/r2/export/export_report.json`, 11:59).
- Verified in the three r170 source (`plans/three-full/package/src`) for the corrections in §0.3.

**Rules this step followed.** Nothing under `/home/user/TradeCheckPro` was edited. No Blender and no Chromium were run.
Figures marked **(est.)** are model-based estimates; they must be replaced by the device baseline in G02. Meta's
developer pages could not be fetched from the sandbox, so the research step read them through search extracts. They are
linked in §9 so they can be re-checked.

**Notation.**
- **GL draws** = `renderer.info.render.calls` in an XR session. three r170 has no multiview, so this counts both eyes:
  one object = 2 GL draws.
- **Unique tris** = scene triangles counted once. `info.render.triangles` in XR is about 2× that.
- **[DEVICE]** = needs a Quest 3/3S and a human. Everything else is provable headlessly.
- **Effort** is in agent-hours (h). CPU wall time for bakes is listed separately.

---

## 0. The decision on one page

### 0.1 Scores (0–10 per criterion)

| Plan | (a) Visual gain the owner will notice | (b) Quest 72 fps safety | (c) Creature fear | (d) Feasibility with our tooling | Total /40 |
|---|---|---|---|---|---|
| **quest-fidelity** | 8 | **9** | 8 | **8** | **33** |
| **art-direction** | **9** | 7 | **9** | 7 | 32 |
| **showcase** | 8 | 7 | 7 | 6 | 28 |

**Why these scores.**
- **quest-fidelity** has the best engineering:
  - budgets as code;
  - an in-session 72 fps governor that only flips uniforms;
  - a custom lantern term (cookie, wet lobe and shadow hook without adding a light loop);
  - a once-per-frame custom shadow target;
  - attack clips phase-locked to the sim;
  - a GI volume baked in Node in minutes, which survives level churn.

  Its art direction is thinner: no look book, and few rules for how each section should feel.
- **art-direction** has the best look and the best creature:
  - looks as data;
  - 14 gated postcards;
  - section-by-section look passes;
  - identity edits to the r2 design;
  - a performance script;
  - motion-quality metrics on clips (anticipation, overshoot, follow-through);
  - a sync layer that cuts the scrape sound on the freeze frame.

  It loses Quest-safety points:
  - its leg-shadow design does not work in r170 (§0.3);
  - it has no in-session governor beyond foveation.
- **showcase** has the best commercial framing:
  - money frames;
  - an early creature-reveal milestone;
  - a store honesty policy;
  - the Ultra tier with an offline capture director.

  It lights every section with full Cycles lightmaps. Each layout change by the other workflows then means a 30–60 min
  re-bake. It also has the largest scope.

**Spine:** quest-fidelity. **Grafted from art-direction:**
- the Look Book and postcards (G01);
- the section look passes (G11);
- the Mason identity contract (C00);
- the modular skinned kit and the performance script;
- the motion-quality gates;
- the sync layer;
- the env kit built on task #8's v1.

**Grafted from showcase:**
- money-frame ordering;
- the M2 "creature reveal slice" milestone;
- the Desktop Ultra tier and capture director (G12, G13);
- the store honesty policy;
- parametric clips.

### 0.2 The honest frame (for the owner and every builder)

Quest 3 is a mobile tile-based GPU (Adreno 740 class, about 1.7–1.8 TFLOPS by our arithmetic). It shades about 5.9 Mpx
per stereo frame at render scale 1.0, in a 13.8 ms frame at 72 Hz ([Meta device comparison][m-devcomp];
[Meta render scale][m-scale]; quest.md §1–4). Today's shader with 3 lights already uses most of the per-pixel budget, so
**per-pixel cost cannot grow 10×**.

**On Quest, "10×" comes from content and direction:**
- light baked once and sampled cheaply;
- 4× the texels at *less* VRAM (KTX2);
- 4–5× the triangles where stereo can see them;
- lit air computed analytically in the shaders that already run;
- a skinned creature that *performs*;
- staged FX and sound locked to its motion.

**Not on Quest:**
- full-screen post-processing: it costs a resolve and loses fixed foveation ([Meta loads/stores][m-loads];
  [three #26904][t-26904]);
- point-light shadows, which need 6 extra renders ([Meta WebXR BP][m-bp]);
- raymarched fog;
- transmission;
- WebGPU, which runs on a slow WebGL2 fallback on Quest ([three #30560][t-30560]).

**The Desktop Ultra tier** runs on the same assets with real shadows, bloom, GTAO and reflections. That is where
"like Unreal" is honestly reachable. Ultra footage never goes on the Quest store page.

### 0.3 Corrections to all three candidate plans (verified 12:00–12:10)

| # | Finding | Evidence | Consequence in this plan |
|---|---|---|---|
| K1 | **`src/render/atmosphere.js` already exists.** Task #8 landed it at 12:06: fog cards, mist sheets, a 64³ noise field, and `FxLighting` / `FX_LIGHT_GLSL` shared by dust, grit and drips. `debris.js` (rubble, grit trickles, drips) also exists. All three plans propose a *new* `atmosphere.js` | `ls src/render`; `atmosphere.js` L1–L111, `debris.js` L1–L15 | The look engine lives in **`src/render/look/`** (`installLook`, `patchLook`). Particle work **extends** task #8's modules (G09). It does not replace them |
| K2 | **`FxLighting` finds the lantern by name:** the `PointLight` inside group `Lantern` | `atmosphere.js` L69–L79 | Removing the lantern `PointLight` (quest-fidelity's custom lantern) would turn off all FX lighting. G03 publishes the lantern state as shared look uniforms, and `FxLighting` reads them (a 10-line change, coordinated with task #8) |
| K3 | **Emptying the global `fog_fragment` and switching to `CustomToneMapping` breaks unpatched shaders.** Task #8's FX `ShaderMaterial`s include the fog chunk, and a global grade that reads grade uniforms gets zeros (black) in any material that never received them | three r170 chunk order (three.md §1.4); `UniformsUtils.clone` per material (three.md §2.5) | Every look patch is guarded by `#ifdef AT_LOOK`. Unpatched materials keep today's fog and a plain AgX curve with constant parameters. A **scene audit gate** fails any lit mesh without the look key |
| K4 | **art-direction's leg-shadow proxy on layer 1 cannot work.** The r170 shadow pass tests caster layers against the **main** camera | `WebGLShadowMap.js` L335: `object.layers.test( camera.layers )` | Use quest-fidelity's custom depth render target: an LOD2 proxy that shares the skeleton, rendered once per frame (C04) |
| K5 | **Rendering any render target while presenting uses the XR camera** unless `renderer.xr.enabled` is set false around the call | `WebGLRenderer.js` L1154–1158; `CubeCamera.js` L132–165 and `PMREMGenerator.js` L111–113 use exactly this toggle | Shadow, PMREM and any capture pass save and restore `xr.enabled` and `getRenderTarget()` |
| K6 | **Every `render()` call resets `renderer.info`** | `WebGLRenderer.js` L1212 (`frame++`), L1224 (`info.reset()`) | A second render call (the shadow pass) would hide its own cost and reset the main stats. Set `info.autoReset = false` and reset once per frame in `Renderer3D` |
| K7 | Task #8's env kit v1 (`assets/models/env/ch1_env_kit.glb`, no UVs, AO in `COLOR_0`) and arms (`build_hands.py` → `player_arms.glb`, 17-bone arms, 2048² atlas) are in flight | file headers | G06 extends v1 (UV0 trims, relief tiles, figure kit). G10 integrates the arms rather than rebuilding them |
| K8 | The creature workflow's r2 export (11:59) is **static**: a 124 k / 34 k / 7 k triangle LOD set with 4 materials, plus a new 6.3 MB rigid `mason_kit.glb` whose `Mason_Head` is 23.8 k triangles | `export_report.json` | The new rigid kit is the **interim fallback** through today's `CreatureView`. The rigged Mason is a rest-pose rebuild (CREATURE_RIG_PLAN §3) |

### 0.4 Milestones the owner will see

| Milestone | Packages | What the owner sees | Effort to here (h) |
|---|---|---|---|
| **M1 "The look changes"** | G00–G03 | Lit air and halos, the cage-bar lantern, per-section grade, crisp KTX2 textures, flicker-safe lamps. Before/after postcards | ≈ 62 |
| **M2 "Creature reveal slice"** | C00–C04, G04, G11 for S5 and S7 | The rigged, skinned Mason in S5 (Listen, Rear, Snap) and S7 (Spiral) on Quest tier and Desktop High. Owner device check [DEVICE] | ≈ 210 |
| **M3 "Chapter I built"** | G05–G10, C05–C07, G11 for all sections | Every section dressed, baked, wet, with particles. 17 fear beats live. 15 postcards pass their gates | ≈ 390 |
| **M4 "Demo ship-ready"** | G12, G14, G15 (G13 optional) | Desktop High and Ultra, a 45-min soak, the before/after proof book, store frames | ≈ 430 |
| **M5 "Full descent"** | G16 | Chapters II–V | +220 |

---

## 1. What "10×" concretely means

### 1.1 The scorecard (regenerated by the verifier at every milestone)

| # | Measure | Before (audit) | After (gate) | How it is measured |
|---|---|---|---|---|
| 1 | Texel density on route walls ≤ 3 m | 256 px/m (1024² over 4 m), 64 px/m on the canvas fallback | **≥ 512 px/m** on trims; **≥ 1024 px/m** on hands, rope and anchors; plus a 0.5 m detail normal | texel-density lint (UV area vs world area) and screen-space UV derivatives at 200 route poses |
| 2 | Texture VRAM | ≈ 84 MB RGBA8 (15 × 1K JPEG) | ≤ 70 MB for the world sets at **4× the texels** | GL format tally (`compressedTexImage2D`) |
| 3 | Unique visible triangles, worst view | ≈ 82 k per eye | 300–450 k | `renderer.info` at postcards and on the bot descent |
| 4 | Raw boxes visible within 30 m of the route | all 164 solids | **0** | ID render pass |
| 5 | Lamps that light the world | 2 pooled point lights | all 13 lamps baked with bounce and AO, 2 dynamic, plus hero-room lightmaps | lamp-pool ROI tests |
| 6 | Lit air | none | in-scatter halos for the lantern and 2 lamps, height pooling, fog dome | halo ROI ≥ 1.25× baseline |
| 7 | Occlusion | tile-scale ORM AO only | volume AO, per-module AO, chamber lightmaps, and the Mason's leg shadow | corner ROI ≤ 0.8× open wall |
| 8 | Wet specular on route walls | none | per M1 (S1 0.1 → S8 0.7) | highlight moves with a 10 cm lantern move |
| 9 | Grade and banding | one ACES curve, 8-bit banding | AgX plus a per-section grade, dithered | banding index ≤ 25 % of baseline |
| 10 | Particles | dots, plus landing puffs covering 55 % of the screen at ≥ 4 layers | 4 lantern-lit GPU systems | ≥ 4 layers on ≤ 5 % of the screen |
| 11 | Near field | flat orange primitives | baked 2K arms and launchers (task #8), rope v2, anchors v2 | detail energy ≥ 3× in the hand mask |
| 12 | Creature | 65 rigid parts (≈ 5 k unique tris), 0 clips, no UVs | ≈ 60 k triangles skinned on ≈ 182 bones, 25 clips, 9 procedural layers, 2 baked 2K atlases | asset gate and rig report |
| 13 | Creature-linked FX | 1 (debris on burst) | 12 | FX/event mapping tests |
| 14 | Fear beats supported | ≈ 5 | 17 in Chapter I, 24 across the game | fear-sim and postcards |
| 15 | Postcards passing all look gates | 0 | **15 in Chapter I + the Ten** (§1.2) | lookcheck and the critic |
| 16 | Desktop | same as Quest | High and Ultra: shadows, bloom, GTAO, PMREM, 124 k creature | desktop postcards |
| — | Per-pixel shader cost (reported as a cost, not a feature) | baseline | about +20–40 % | SwiftShader A/B, then device |

**Proof for the owner (G15).**
- A private before/after book of every postcard.
- A blind preference test in the headset: ≥ 80 % of testers prefer the new build on every shot [DEVICE].
- The critic panel: ≥ +2 points on a 5-point quality scale and ≥ +1 on fear, per shot.

### 1.2 "At least 10": the Ten

The owner's words were "at least 10 the graphics". That reads as 10× the graphics, and also as at least ten showcase
images. This plan delivers both: the scorecard above, and **the Ten**, ten hero shots across the game (art.md §15). They
are captured before and after at every milestone, double as trailer frames, and are fixed in
`src/data/looks/postcards.js`.

| # | Shot | Chapter | Built in |
|---|---|---|---|
| T1 | S1 colossus window | I | G06, G08, G11 |
| T2 | S4 the Pour | I | C03, G08, G11 |
| T3 | S5 the bulging wall | I | C06, G11 |
| T4 | S7 the Spiral pass | I | C03, C05, G11 |
| T5 | S9 the Linger | I | C05, G11 |
| T6 | II the lit town | II | G16 |
| T7 | II the Snuff | II | G16 |
| T8 | III the Rise through the water | III | G16 |
| T9 | IV the Gathering | IV | G16 |
| T10 | V Stilled in white | V | G16 |

Chapter I also has **15 gating postcards** (P01–P15, §1.3). Five of them are T1–T5.

### 1.3 Per-section before/after checklist (Chapter I)

Before = audit.md §2, §4 and the e2e screenshots. Every checkbox is a gate in G00's harness, or a critic rubric item
where marked (critic). Section colours and wetness follow the bible (§3.9).

**S1 Threshold** (48 m; postcards P01 Colossus window = T1, P02 First anchor near field)
- *Before:* fog plus dark slabs; the statue is a primitive cylinder and cone; light shafts are uniform pale cylinders;
  the colossus is a black cut-out.
- *After:*
  - [ ] Threshold arch with 3 Lanternwright statues (figure kit), lightmapped (G07).
  - [ ] Teal shafts with analytic thickness and lantern-lit motes inside (G09).
  - [ ] Colossus seen through a window cut in the shaft wall, with a lit rim and window glints (G08).
  - [ ] Dry ash on top faces (wet 0.10).
  - [ ] No raw box within 30 m.
  - [ ] P02 hands at 0.6 m: ≥ 1024 px/m, the "toy orange" flag clear (critic).
  - [ ] Threshold-lamp in-scatter halo.

**S2 Long Swing** (50 m; P03 mid-swing along the chain run)
- *Before:* chains are squashed tori; boxes; one grid course pattern repeating.
- *After:*
  - [ ] Real chain links within 15 m, cards beyond.
  - [ ] Machinery bracket and double arch.
  - [ ] A line of lamps receding for depth (volume-lit pools).
  - [ ] Pillar parallax reveal on the swing.
  - [ ] Wet 0.15.
  - [ ] One far call delayed by distance (≈ 0.2 s).

**S3 Broken Gallery** (40 m; P04 through the broken arcade)
- *Before:* box voussoirs; no drips.
- *After:*
  - [ ] Collapsed arcade with a hanging cage silhouetted against shaft light.
  - [ ] First ribs grown through masonry.
  - [ ] **First drips** with streak, splash ring and glint (wet 0.30).
  - [ ] Verdigris accent.
  - [ ] One grit sift from above as a pre-cue.

**S4 Listening Vault** (52 m, fog to 170 m; P05 the Pour = T2)
- *Before:* the widest reveal and the flattest image: cut-out colossi, the creature a dark smudge.
- *After:*
  - [ ] A 100 m+ far wall with blind arcades for scale, lit haze behind the Pour path.
  - [ ] Mason LOD2 against its background at a luminance ratio ≥ 1.3.
  - [ ] ≥ 30 leg protrusions counted on the silhouette.
  - [ ] Catwalk lightmapped (G07).
  - [ ] Sparse motes at many depths for void parallax.
  - [ ] Lamphold glow in floor cracks at 10 %.
  - [ ] Scrape audio delayed by d/343.

**S5 Gullet Stair** (54 m; P06 bulging wall = T3, P07 the Rear at 6 m, P15 the Listen at 8–10 m)
- *Before:* the attack reads as a "rust dartboard with 10 pale spikes"; legs read as thin trusses.
- *After:*
  - [ ] Wall bulges with dust and travelling knocks (C06).
  - [ ] Grit rain before the pursuit from above.
  - [ ] The Rear: portal opening onto a lit throat, plate-lift wave, arms flaring.
  - [ ] Head-on asymmetry test passes (no dartboard).
  - [ ] Ember key, rust accent, wet 0.50.
  - [ ] The Listen: a true freeze with the arms open.

**S6 Two Descents** (80 m; P08 leg wave through the colonnade)
- *Before:* boxes; no peripheral staging.
- *After:*
  - [ ] Colonnade of piers along the divide as occluders for the Leg Forest.
  - [ ] Stone-Still at the light's edge.
  - [ ] Lamp Dip.
  - [ ] Drips; frayed rope fibres.
  - [ ] Wet 0.60.
  - [ ] Gap-pass flicker < 3 Hz (flash gate).

**S7 Hollow Nave** (136 m; P09 the Spiral = T4, P10 nave vista)
- *Before:* black cut-out towers, uniform shafts.
- *After:*
  - [ ] Inverted spire with a lightmapped base.
  - [ ] The Spiral at 6–8 m with debris through the lantern light.
  - [ ] False Retreat and Ceiling Crossing.
  - [ ] Pit-glow key.
  - [ ] Nave vista in ≥ 3 depth plateaus.
  - [ ] This is the frame-budget worst case: it must pass G14.

**S8 Last Throat** (142 m; P11 looking up at the pursuit through ash, P12 the Still Lamp chamber)
- *Before:* repeating floor courses; flat dark.
- *After:*
  - [ ] Still Lamp chamber, warm and lightmapped.
  - [ ] Ash and debris rain.
  - [ ] Pursuit from above, dark on haze.
  - [ ] Wet 0.70.
  - [ ] Grate slam.
  - [ ] Amber → white-gold near the grate.

**S9 The Mark** (task #6 hook; P13 the Linger = T5, P14 the coil walls wide)
- *Before:* not built.
- *After:*
  - [ ] Motes stop (the hush).
  - [ ] Mark Lamp `#f4ead2`.
  - [ ] The crown 3 m away for 1.5–3 s, arms sweeping before the lantern.
  - [ ] Coil plates on the walls match the creature kit.
  - [ ] Hero lightmap.

**All sections:**
- [ ] Value bands B0–B4 within the look sheet.
- [ ] Anchors ≥ 1.5:1 contrast against their local background.
- [ ] ≤ 1 flash pair per second.
- [ ] Budgets met at the section's worst moment.
- [ ] 0 program links after gameplay starts.
- [ ] Critic ≥ 7/10 for craft and ≥ 7/10 for dread, with no identity flags.

---

## 2. Rendering tiers and exact budgets

### 2.1 Tiers

Tiers are chosen **at session start or in the menu**, behind a fade, followed by `compileAsync`. Light counts, shadow
flags and defines never change mid-session. Inside a session only the governor (§2.5) acts, and only through uniforms
and visibility.

| Feature | **Quest** (Quest 3/3S; default) | **Desktop High** | **Desktop Ultra** (+ Capture) |
|---|---|---|---|
| Target | 72 Hz, GPU p95 ≤ 11.5 ms, CPU p95 ≤ 8 ms | 1440p at 60 fps on GTX 1660 Super / RTX 3060 class | 1440p at 60 fps on RTX 3070 class; 4K at 30; Capture runs offline |
| Resolution | `framebufferScaleFactor` 1.0 (never < 0.85, [VRC Perf.4][m-vrc4]). **Sharp** sub-tier 1.2 only if device p95 GPU ≤ 9.2 ms at 1.0 | DPR ≤ 2 with `perfDiag` adaptive scale | DPR 2; Capture 2560×1440–3840×2160 with 16–64× accumulated SSAA |
| Refresh | `session.updateTargetFrameRate(72)` ([Meta WebXR frames][m-frames]) | vsync | vsync / frame-stepped |
| AA | 4× MSAA on the base layer path (no `'layers'` on vanilla r170) | 4× MSAA | MSAA + SMAA; Capture accumulation |
| Foveation | dynamic 0.66 ↔ 1.0 ([Meta WebXR FFR][m-ffr]) | — | — |
| Dynamic lights | custom lantern term + 2 env `PointLight`s (3 evaluations per lit pixel) | lantern + 6 env | lantern + 8 env |
| Baked light | GI volume everywhere, per-module AO, hero-room lightmaps | same, volume at 0.5 m | same |
| Shadows | **no three.js shadow maps.** One custom creature-only lantern depth target, 512², 36 Hz, encounters only (C04) | lantern spot shadow 1024² PCFSoft; creature, hands and props cast | lantern point shadow PCFSoft 1024 cube + creature spot 2048² |
| Post | **0 passes.** Grade, fog, in-scatter, dither, grain and vignette run in-material | bloom at half resolution + SMAA + OutputPass | GTAO + UnrealBloom + grade pass (same GLSL) + film grain + SMAA + OutputPass |
| Reflections | none. The lantern's wet lobe only; box-projected PMREM on water in Chapter III only | box-projected PMREM 128 on wet/metal masks | PMREM broad + clearcoat on wet stone and flesh |
| Fog | HDR fog before tone mapping, analytic in-scatter (3 lights), height pooling, ALU noise, fog dome; task #8 fog cards and mist sheets | same | + raymarched shaft volumes (16 steps) in hero rooms |
| Creature | LOD0 ≤ 60 k (cap 70 k) / LOD1 ≤ 18 k / LOD2 ≤ 6 k, 2 materials, `MeshStandardMaterial` + patches | LOD0 124 k (r2 game size) | 124 k + `MeshPhysicalMaterial` clearcoat and sheen, casts both shadows |
| Surfaces | trims, tileables, 0.5 m detail, wet/drip mask | same | + near POM on masonry (6–12 steps) |
| Particles | ≤ 4 systems, ≤ 3 k live, blended ≤ 25 % of the screen, ≤ 3 deep | 8 systems, 10 k | 8 systems, 20 k, depth-texture soft particles |

**Quest sub-tiers:**
- **Quest-Sharp:** scale 1.2 (≈ panel-native); device-certified only.
- **Quest-Low:** Quest 2, or a Quest 3S thermal fallback. Scale 0.9, 1K textures, creature LOD1 as LOD0, 1 env light,
  no leg shadow, particles at 50 %. Only if the store listing includes Quest 2 (decision D6).

### 2.2 Quest frame allocation (worst moment, vanilla r170, no multiview; est., rescaled after G02)

| GPU bucket | ms p95 | Contents |
|---|---|---|
| World opaque shading | 4.9 | kit, sections, albedo/normal/ORM, GI volume or lightmap, lantern term + 2 env, wetness |
| World vertex work (×2 eyes) | 0.6 | ≤ 300 k unique visible tris |
| Look engine on lit pixels | 0.7 | HDR fog, in-scatter ×3, height fog + noise, AgX grade, dither, grain |
| The Mason | 0.4 typical / **1.5** at attack coverage | skinned LOD0 ×2 eyes, wet lobe, wrap/back-light, rim, pits |
| Mason leg shadow | 0.3 | encounters only; 0 otherwise |
| Near field | 0.7 | arms, launchers, lantern, ropes (5–20 % of the view) |
| Vista + fog dome | 0.4 | dome only where nothing else drew |
| Transparent FX | 1.2 | task #8 fog cards and sheets, particles, shafts, halos, decals; ≤ 25 % coverage cap |
| UI | 0.2 | menus, the death panel |
| Reserve | 1.0 | thermal and compositor variance |
| **Total** | **≤ 11.5** of 13.8 ms ([Meta device comparison][m-devcomp]) | |

| CPU main thread | ms p95 |
|---|---|
| Simulation: physics, rope, creature sim + fear director, threat, beats | 2.7 (E29 2.5 + 0.15 director) |
| Mason view: mixer, spine, IK for 30 legs, springs, bone matrices, data texture | 0.7 |
| Scene update, culling, kit re-pack, LOD | 0.9 |
| Draw submission (≤ 200 GL draws, uniforms) | 2.4 |
| FX and atmosphere update, governor, audio scheduling | 0.6 |
| GC and streaming reserve | 0.7 |
| **Total** | **≤ 8.0** |

**Gate rule.** If G02's device baseline shows today's world shading above about 6 ms GPU at the worst pose, features
are cut in reverse gain-per-ms order (§2.5 ladder plus §2.6) **before** any new one is added.

### 2.3 Counts (Quest; the source for `budgets.json`)

| Budget | Typical | Worst moment | With super-three multiview (if G14 adopts it) |
|---|---|---|---|
| GL draws (both eyes) | **≤ 150** | **≤ 200** | ≤ 140 / ≤ 200, each covering both eyes |
| — world (kit buckets, sections, chambers) | ≤ 32 objects | | |
| — dynamic level (anchors, hazards, glyphs, plaques, movers) | ≤ 12 objects | | |
| — Mason | ≤ 2 objects (4 GL) + 1 shadow draw per frame | | |
| — near field | ≤ 6 objects | | |
| — FX (fog cards 1, particles ≤ 4, shafts 1, halos 1, decals ≤ 2) | ≤ 9 objects | | |
| — vista, dome, fog cards | ≤ 4 objects | | |
| — UI | ≤ 4 objects | | |
| Unique visible tris | ≤ 300 k | ≤ 450 k | ≤ 400 k / ≤ 600 k |
| — Mason | LOD0 ≤ 60 k (Ch I), cap 70 k; LOD1 ≤ 18 k; LOD2 ≤ 6 k | | |
| Bones | ≤ 255 (planned 182 in Ch I, 221 in Ch V), ≤ 4 influences | | |
| Dynamic light evaluations per lit pixel | 3 | 3 | 3 |
| Texture samples per lit world pixel | ≤ 6: albedo, normal, ORM, GI volume *or* lightmap, detail *or* drip | 7 inside the leg-shadow frustum | |
| Texture samples per creature pixel | ≤ 4: atlas albedo, normal, ORM, detail array | | |
| Unique GL programs | ≤ 24 per chapter; **0 links after gameplay starts** | | + XR variants precompiled after session start |
| Particles | ≤ 4 systems, ≤ 3,000 live | | |
| Blended coverage | ≤ 25 % of the screen, ≤ 3 layers deep, nothing within 0.5 m of the eyes | | |
| Opaque overdraw | ≤ 1.5× average | | |
| Allocations per frame (steady) | 0 B | | |

Meta's native guidance for Quest 3 is under 200 draw calls and 1.5 M triangles, both soft
([device comparison][m-devcomp]). Meta's WebXR guide warns that about 1,000 individual draws would drop below 72 fps
([WebXR perf workflow][m-wf]). Our draw budget is deliberately conservative because CPU draw submission is doubled
without multiview ([three #20368][t-20368]).

### 2.4 Memory and download

| Item | Resident VRAM (est.) |
|---|---|
| World tileables: masonry 2K, metal 2K, near rock 2K + 1K normal, rockFar 1K, flesh 1K, detail normal 512² | ≈ 35 MB |
| Trim sheets: masonry 2K, iron 2K | ≈ 22 MB |
| Kit geometry (≈ 40 modules × 2 LODs, quantized) | ≈ 8 MB |
| GI volumes, current section ±1 (S7 alone is 80×136×80 RGBA8 = 3.5 MB) | ≤ 8 MB |
| Hero-room lightmaps + prop atlases (±1) | ≤ 27 MB |
| Mason: 2 × 2K atlases (albedo, normal, ORM) + detail array + LOD meshes | ≈ 40 MB |
| Arms and launchers (task #8 2K atlas), lantern, rope | ≈ 18 MB |
| FX atlases, noise, drips | ≈ 4 MB |
| UI canvases | ≈ 10 MB |
| Render targets (leg shadow 512² depth) | ≈ 1 MB |
| **Total** | **≈ 175 MB**, against a ≤ 300 MB cap (quest.md §10). JS heap ≤ 256 MB |

VRAM per 2K texture with mips: ASTC 4×4 is 5.6 MB and ETC1 is 2.8 MB, against 22.4 MB for RGBA8 (quest.md §9).

**Measured encode sizes** (quest-fidelity §3.4, `plans/qf/ktx_size.mjs`). A 1K masonry normal is 1.3 MB in UASTC+Zstd
and 0.93 MB at UASTC level 0 + RDO 3. ETC1S albedo is 152 KB. So a 2K UASTC normal is 3.7–5.2 MB, the dominant download
term.

**Policy:**

| Content | Encoding |
|---|---|
| Hero normals (masonry, iron, both trims, Mason crown and body) | 2K UASTC |
| Bulk albedo and ORM | ETC1S |
| Mason crown albedo | UASTC |
| Rock | 1K normal + the shared detail normal |
| Lightmaps | dLDR in UASTC |

| Pack | Budget | Contents (est.) |
|---|---|---|
| Boot (menu, Threshold, UI, transcoder ≈ 0.3 MB gz) | ≤ 8 MB | |
| **Chapter I core** (boot → S1–S3 playable) | **≤ 25 MB** | first head-tracked frame ≤ 4 s |
| Chapter I late (prefetched while S1 plays: Mason, S4–S9) | ≤ 35 MB | Mason ≈ 14, S4–S9 volumes/chambers/lightmaps ≈ 10, props ≈ 4, audio ≈ 5 |
| **Chapter I total** | **≤ 60 MB** | inside RELEASE's `--max-core-mb 60` |
| Each of Chapters II–V | ≤ 30 MB | |
| Desktop Ultra pack (never fetched on Quest) | ≤ 60 MB | |
| **Quest whole game** | **≤ 180 MB** | |

These supersede E29's "Chapter I ≤ 15 MB", which cannot carry the ask (decision D2).

### 2.5 The 72 fps governor (`src/render/quality.js`, G02)

- **Input:** XR frame intervals from rAF timestamps (a missed 72 Hz frame shows as ≈ 27.8 ms) and main-thread ms.
- **Stepping:** down after 0.5 s over budget, up after 2 s of headroom.
- **Mechanism:** uniforms and visibility only. No recompiles, ever.

| Level | Change | Est. saving |
|---|---|---|
| 0 | Full quality; FFR 0.66 | — |
| 1 | FFR 1.0; env-light in-scatter off (the lantern's stays); particle cap 75 % | 0.3–0.8 ms |
| 2 | Leg shadow at 18 Hz; kit LOD distances ×0.75; Mason LOD bias +1 beyond 15 m; halo cap 50 %; drip streaks off | 0.5–1.0 ms |
| 3 | Leg shadow off; particles 50 %; fog noise off; task #8 fog cards at 50 % | 0.3–0.6 ms |

### 2.6 Not on Quest, by design

- EffectComposer or any full-screen pass. On vanilla r170 there is no XR composer path ([three #26904][t-26904]).
- three.js shadow maps of any kind (`castShadow` toggles change program keys).
- `transmission` (it re-renders the opaque scene per eye), iridescence, broad clearcoat.
- Raymarched fog; POM; PMREM on general surfaces.
- Morph targets on the Mason's body.
- `logarithmicDepthBuffer`.
- More than 3 dynamic light evaluations.
- `'layers'` on vanilla r170: the Layers path falls back to an explicit MSAA blit (quest.md §8).
- WebGPURenderer ([three #30560][t-30560]).

### 2.7 Desktop budgets

| Tier | Draws | Unique tris | Heavy items (est.) |
|---|---|---|---|
| High | ≤ 400 | ≤ 1.5 M | spot shadow 0.5–1 ms; half-resolution bloom 0.3–0.6 ms |
| Ultra | ≤ 600 | ≤ 3 M | GTAO 1.5–2.5; bloom 0.5–1; point shadow (6 passes) 1–2; SMAA 0.3–0.5 |
| Capture | — | — | offline, 16–64 accumulated sub-samples per frame, optional 180° shutter |

### 2.8 Budget changes that need the owner's sign-off

| Document | Today | Proposed |
|---|---|---|
| CONTRACT3D | ≤ 150 draws / ≤ 350 k stereo tris at the worst moment | ≤ 150 GL draws typical / ≤ 200 worst; ≤ 450 k unique worst (≈ 900 k stereo) |
| ART_AUDIO_PLAN §0.4 | Mason ≤ 25 k | LOD0 ≤ 60 k (cap 70 k) |
| E29 | Chapter I pack ≤ 15 MB | Chapter I ≤ 60 MB with a ≤ 25 MB core |

All of them stay inside Meta's soft guidance ([device comparison][m-devcomp]).

---

## 3. Art-direction bible (summary; the full bible becomes `docs/abyssal-tether-3d/ART_BIBLE.md` in G01)

Source: art.md §4–15. These rules are checkable, and G00's `lookcheck` enforces the numeric ones.

### 3.1 Pillars
1. **One light you can name.** The lantern is the key light. Every other light has a source the player can point at.
2. **Wet stone, worn iron, old hands.** Wear obeys gravity. Darkness comes from light, never from black albedo.
3. **Fear lives at the edge of the light.** The lantern pool's rim (6–10 m), the fog edge and the periphery are where
   the Mason is glimpsed.
4. **The building is the body.** The Mason is ≥ 85 % masonry and iron. What is alive shows only in the joints.
5. **Show the cause.** Every scare has a visible or audible cause a moment before it lands.

### 3.2 Value bands (display sRGB after tone mapping; on Quest's LCD, black shows as grey)

| Band | sRGB | Content | Gate |
|---|---|---|---|
| B0 | 0–14 | death fade only | ≤ 1 % of pixels in gameplay postcards |
| B1 | 18–34 | far fog floor | nothing the player must read |
| B2 | 30–65 | shadowed form ≤ 15 m; the Mason in shadow | ≥ 1.3:1 against B1, or a rim/edge |
| B3 | 65–170 | lit form | albedo plausible (stone 60–170) |
| B4 | 170–255 | sources, wet glints, pits | ≤ 3 % typical, ≤ 8 % peak |

**Readability:** anchors, hazards and the Mason's outline when it matters need ≥ 1.5:1 against their local background.
Every gradient is dithered: Quest 3's LCD bands dark gradients and cannot show deep black ([MIXED][mixed-dim]).

### 3.3 Colour meaning
- **Warm amber** (`#ffb46a` lantern, `#e0a050` lamps): yours, human, safe.
- **Cool slate-teal** (fog `#141719`–`#252b30`, shafts `#6fa3b5`): the world, distance.
- **Pale cold green-white** `#b8f0e0`: the Mason sensing.
- **Rust and verdigris** at low saturation: decay and iron.
- **Rules:**
  - **C1.** The Mason never emits warm light. The one exception is a 0.5 s warm pit flare after a snuff in Chapter II.
  - **C2.** World saturation ≤ 0.6 in the grade. Saturation is spent on the safe light, the pits and a chapter's
    promise colour.
  - **C3.** Shadows lean cool and light leans warm. Chapter V inverts this.

### 3.4 Lighting rules
- **L1** Motivated light only. The hemisphere light is a fog-coloured floor (B1–B2), never a key.
- **L2** The lantern is a camera light: cage-bar cookie, in-scatter halo, pool radius 6–10 m.
- **L3** Fixed light count: the custom lantern term + 2 env `PointLight`s + hemisphere floor + 1 `LightProbe`.
- **L4** Bake the world: GI volume, module AO, hero lightmaps.
- **L5** Silhouette over detail beyond 20 m.
- **L6** Wet rim near the route.
- **L7** Lamp Dip: lamps within 15 m of the crown dim toward 40 % over ≥ 0.4 s and lean toward it.
- **L8** Flicker limits (WCAG 2.3.1 as the proxy for ISO 9241-391, [W3C][wcag], [Meta BP][m-bpo]):
  - fast modulation < 10 %;
  - dips ≥ 10 % at most 1 per second, each ≥ 150 ms and ramped;
  - full-field steps ramp over ≥ 100 ms;
  - the attack wind-up's 6 Hz strobe becomes ramped pulses ≤ 3 Hz with < 10 % full-field modulation.

  Today's lamps and lantern sit at exactly 3 flash pairs per second (`plans/scripts/flicker_check.mjs`). The target is
  ≤ 1.
- **L9** Dark adaptation: instant drop, then +0.6 EV over 4 s, through the exposure uniform.
- **L10** Chapter V inversion: fog brighter than forms; shadows are shelter.

### 3.5 Materials

| Class | Albedo (sRGB) | Roughness dry → wet | Metal | Note |
|---|---|---|---|---|
| Masonry | 90–160 | 0.85 → 0.35 | 0 | wet albedo × 0.55–0.7 (porous) |
| Slate | 55–90 | 0.75 → 0.25 | 0 | wet albedo × 0.7 |
| Statue stone | 120–170 | 0.6, polished at touch points | 0 | soot on fingertips |
| Wrought iron | 50–70 | 0.55, worn edges 0.3 | 0.6–1 at worn edges | rust weeps *down* |
| Mortar-flesh (Mason) | 110–140 grey-pink | 0.25, always wet | 0 | wrap + back-light; no pores, no veins |
| Gauntlets | 60–110 leather, 70 iron | 0.5 / 0.35 | mixed | highest texel density in the game |

**Rules:**
- **M1** Wetness rises with depth: S1 0.10 → S8 0.70. Chapter III is soaked; Chapter IV is dry.
- **M2** Wear obeys gravity: soot up, stains down, grime in AO corners, polish at contact points, rope grooves on rings.
- **M3** Texel density per §1.1.
- **M4** No black albedo.
- **M5** No tiling texture covers more than about 4 m without a variation layer.
- **M6** The Mason uses the world's stone and iron. Only mortar-flesh is unique to it.
- **M7** Phosphor anchors keep their identity in every palette.

### 3.6 Set dressing
- **D1** Three zones per frame:
  - personal (≤ 2 m): stereo-true props;
  - action (2–30 m): relief on walls;
  - vista (> 30 m): ≥ 1 silhouette per section.
- **D2** Within 15 m of the route, per 10 m of descent: ≥ 1 story prop and ≥ 4 secondary props.
- **D3** Voids stay empty.
- **D4** Known-size props at every Mason reveal point: a 2.1 m doorway, a statue, a lamp, a chain with 10 cm links.
- **D5** Story props follow the canon.
- **D6** No raw box within 30 m of the route. Collision stays boxes; relief is recessed ≤ 0.15 m and protrudes ≤ 0.05 m on
  play surfaces.

### 3.7 Sound–picture rules
- **A1** Audio never before the visual; ≤ 100 ms after it for contacts. Observers detect audio-leading at about 75 ms
  ([Maempel/Dixon & Spitz][sync]).
- **A2** Far events are delayed by distance / 343 s, capped at 0.6 s.
- **A3** Every visible Mason motion near the player has a sound.
- **A4** Every Mason sound within 25 m has a visible correlate.
- **A5** Freezes cut sound and motion on the same frame.
- **A6** Haptics are the third channel.
- **A7** Pre-cues come from the exact place of the coming appearance.
- **A8** Breath and heartbeat never drop out.

Full spec: CREATURE_RIG_PLAN §9.

### 3.8 Safety
- **S1** Flash safety per L8, as a CI gate.
- **S2** Near-eye: no geometry within 0.6 m of the eyes except the player's own hands; no particles within 0.5 m.
- **S3** Startle budget: ≤ 1 loud startle per ~5 min, never in a rest space.
- **S4** Slow loom near; a fast loom only after a ≥ 0.35 s telegraph.
- **S5** No forced view: gaze only *times* reveals.
- **S6** Trypophobia-safe: pits few, large and spaced ([Cole & Wilkins][holes]).
- **S7** `reducedEffects` lowers intensity, not difficulty.
- **S8** Store flashing-images warning.

### 3.9 Chapter I section looks (seed values for `looks-ch1.js`)

| § | Fog | Key | Accent | Shadow tint | Highlight tint | Sat | Wet | Particulates |
|---|---|---|---|---|---|---|---|---|
| S1 | `#252b30` | `#6fa3b5` | `#e0a050` | `#1a2530` | `#fff1dc` | 0.70 | 0.10 | slow dust in shafts |
| S2 | `#22282d` | `#6fa3b5` | `#e0a050` | `#19232b` | `#ffeed8` | 0.70 | 0.15 | dust, chain sway |
| S3 | `#23231f` | `#7c9a9c` | `#3f6b63` | `#1c211e` | `#f2ead6` | 0.65 | 0.30 | dust, first drips |
| S4 | `#1b2226` | `#5b8c9b` | `#b8f0e0` | `#142027` | `#e8f4f0` | 0.60 | 0.20 | sparse motes at many depths |
| S5 | `#211b19` | `#8a5a3c` | `#7a3b22` | `#241a17` | `#ffd9b0` | 0.60 | 0.50 | grit from seams |
| S6 | `#1b1918` | `#5a7d86` | `#9a4a2a` | `#1a1a1c` | `#f4e2cc` | 0.55 | 0.60 | drips, frayed fibres |
| S7 | `#141719` | `#4f7f8c` | `#b8f0e0` | `#10171b` | `#e6f2f0` | 0.50 | 0.40 | debris off the spire |
| S8 | `#120f0e` | `#d9b878` | `#e0a050` → `#f4e6c0` | `#170f0c` | `#fff0d0` | 0.55 | 0.70 | ash and debris rain |
| S9 | `#1a1410` | `#f4ead2` | dark amber | `#140e0b` | `#fff6e2` | 0.45 | 0.20 | **none: motes stop** |

**Chapters II–V** (art.md §6.2):
- **II Lamphold:** honey sandstone, brass, wax, soot.
- **III The Mere:** everything wet, silver highlights, black water.
- **IV The Keeping:** bone, chalk, ochre; dry; saturation 0.35; bone dust lit only inside the cone.
- **V The Still Flame:** inverted, fog lighter than forms, saturation 1.0 → 0.15.

### 3.10 The Mason's look
Identity, shape language, materials, clips and the fear beats are in CREATURE_RIG_PLAN §1, §4 and §8. In one line:
*architecture that learned to hunt*. It has no eyes, no antennae and no insect mandibles. The portal opens by
telescoping and retracting, never as a scissor. Glow lives only deep in the pits.

---

## 4. Work packages

### 4.0 Rules for every builder

1. **New modules plus small hooks.** Other workflows edit `src/` now. Every existing-file edit is a short, named hook,
   and the old path stays behind a URL flag: `?look=0`, `?ktx2=0`, `?gi=0`, `?kit=0`, `?mason=kit|standin`,
   `?lantern=legacy`, `?tier=quest|high|ultra`.
2. **`game.js` is never edited directly by a package.** Each package adds its hook to `docs/abyssal-tether-3d/HOOKS.md`
   (created by G00), and the integration owner applies the batch in one change.
3. **Task #8 files** (`atmosphere.js`, `debris.js`, `fx.js`, `build_env_kit.py`, `build_hands.py`) are extended only
   **after** task #8 merges, and with its owner's agreement.
4. **Fixed counts, uniforms not defines.** No light is ever added or removed, nothing toggles `castShadow`,
   `scene.environment` or material defines during play, and **0 program links happen after gameplay starts** (hard gate).
5. **Every lit material goes through `patchLook()`.** `assetLoader` patches GLTF materials on load, and the scene audit
   gate fails any lit mesh whose program key lacks `AT_LOOK`.
6. **Zero allocation per frame** in steady state.
7. **CPU-heavy steps** (Blender bakes, Cycles, KTX2 encodes, Chromium renders) run at `nice 19`, crop-test first, and
   only when the shared CPUs are free.
8. **Every package ends with:**
   - budgets green;
   - postcards rendered before and after;
   - a critic soft gate where visual;
   - the e2e descent green with zero console errors.

### 4.1 Lanes (file ownership) and order

Packages in the same lane touch the same files and run **in sequence**. Different lanes run **in parallel**.

| Lane | Owns (new) | Touches (existing, by hook) | Packages, in order |
|---|---|---|---|
| **P** Proof and data | `tools/abyssal-tether-3d/verify/**`, `src/data/looks/**`, `docs/.../{ART_BIBLE,HOOKS,PERF_PROTOCOL}.md` | `game.js` debug API (via HOOKS) | G00 → G01 → (G15) |
| **R** Renderer core | `src/render/look/**`, `src/render/assetLoader.js`, `src/render/quality.js`, `src/render/gi/**`, `src/render/surfaces.js`, `vendor/three/addons/**`, `tools/abyssal-tether-3d/{post,encode_textures,bake_volume}.mjs` | `renderer3d.js`, `materials.js`, `atmosphere.js` L69–111 (one adapter, with #8) | G02 → G03 → G04 → G05 |
| **L** Level art | `src/render/kit/**`, `tools/abyssal-tether-3d/kit/**`, `assets/kit/**`, `assets/chambers/**` | `levelView.js` (one hook), `build_env_kit.py` (with #8) | G06 → G07 → G08 |
| **F** FX | `src/render/fx2/**` | `fx.js`, `debris.js`, `atmosphere.js` (with #8) | G09 |
| **N** Near field | `assets/models/rope/**`, `tools/abyssal-tether-3d/props/**` | `handsView.js`, `ropeView.js` | G10 |
| **M** Mason view | `src/render/mason/**`, `tools/abyssal-tether-3d/mason/**` | `creatureView.js` (adapter), `game.js` loader (via HOOKS) | C00 → C01 → C02 → C03 → C04 → C06 → C07 |
| **S** Mason sim | `src/sim/creature/director.js` (inside E01's split) | E01 `body.js` (contract request to task #6) | C05 |
| **T** Tiers | `src/render/tiers/**`, `src/render/post/**`, `src/dev/**` | `renderer3d.js` (after lane R is done) | G12 → G13 |
| **D** Device | `perf.html`, device docs | — | G14 |
| **X** Integration | look data, dressing overrides, staging data | many, sequentially | G11 → G15 → G16 |

**Waves** (what can run at the same time):

```text
Wave 0  G00 (P) ‖ G01 (P, after G00's first 6 h) ‖ C00 (M)
Wave 1  G02 (R) ‖ C01 (M, Blender) ‖ G06a kit modules (L, Blender) ‖ G10 (N, after task #8 arms land)
Wave 2  G03 (R) ‖ C02 (M) ‖ C05 (S, after E01) ‖ G06b dresser (L)
Wave 3  G04 (R) ‖ C03 (M) ‖ G09 (F, after G03) ‖ G07 (L, after per-section layout freeze)
Wave 4  G05 (R) ‖ C04 (M, after G03) ‖ G08 (L)        ── M2: G11 for S5 + S7 ──
Wave 5  C06 (M + F) ‖ G11 remaining sections (X) ‖ G12 (T)
Wave 6  C07 (M) ‖ G14 (D) [DEVICE] ‖ G13 (T, optional)
Wave 7  G15 (X)  ── M4 ──
Wave 8  G16 (X): Chapters II–V, one chapter at a time
```

**Critical path:**

```text
C00 → C01 → C02 → C03 → C04 → C06 → G11 (S4–S9) → G14 → G15
```

That is ≈ 175–190 h of sequential agent work. With 4–5 builder lanes, Chapter I takes about 3–4 calendar weeks of agent
time plus the device sessions.

---

### G00 · Proof harness and budgets as code · lane P · 20 h

- **Goal.** Make every later claim provable without a headset, and make "10×" a number.
- **Deliverables** (in `tools/abyssal-tether-3d/verify/`; extends E28's harness promotion, task #6):

  | File | What it does |
  |---|---|
  | `budgets.json` | §2.3 and §2.4 as data |
  | `gates.mjs` | Playwright + Chromium SwiftShader + mock XR (from `scratchpad/3d/{e2e,review-perf,game/xr-mock.js}`). Reports GL draws, tris, programs, links after gameplay start, texture bytes by GL format, overdraw, allocations per frame, RT passes per frame |
  | `shader-lint.mjs` | Counts `texture(` / `texelFetch` per linked fragment program, light loops, `discard`; fails over the §2.3 ledger |
  | `scene-audit.mjs` | Every lit mesh's program key contains `AT_LOOK`; no `KHR_materials_*` upgrades on Quest |
  | `postcards.mjs` | Renders P01–P15 and the Ten at desktop 1280×720 and mock-XR stereo; writes PNGs and JSON |
  | `lookcheck.mjs` | Pure Node (pngjs). Value-band fractions; ROI contrast; banding index; silhouette separation from an ID pass; chroma vs the look's saturation |
  | `flash-check.mjs` | WCAG 2.3.1 general-flash pairs per 1 s window over 64×64 luminance grids at a fixed 60 Hz step |
  | `asset-gate.mjs` | `gltf-transform validate`, joints ≤ 255, influences ≤ 4 summing to 1 ± 1e-3, KTX2-only images, required custom attributes, LOD triangle ceilings |
  | `texel-density.mjs` | UV-area vs world-area lint per asset; screen-space UV-derivative sampling on route poses |
  | `critic/critic-pack.mjs`, `critic/rubric.md` | Contact sheets plus a rubric for the multimodal critic panel (the scratchpad `judge_craft`, `judge_horror` and `judge_orig` pattern): craft, dread, identity flags (eyes, antennae, mandibles, face, "known creature"), "toy look", "boxes read as boxes", "dartboard". **Soft gate** |
  | `creature-lab.html`, `creature-lab.mjs` | Loads only the Mason and replays recorded deterministic sim traces (`traces/*.json`). Used by CREATURE_RIG_PLAN §10 |

- **Debug API** (requested through `HOOKS.md`; only with `?verify=1`):
  - `AT3D.debug.pose(p)`, `.freezeTime(bool)`, `.idPass(layer)`, `.renderInfo()`, `.lights.setTime(t)`;
  - `.creature.perform(behaviour, t)`, `.creature.clip(name, t)`.
- **Docs:**
  - `docs/abyssal-tether-3d/HOOKS.md`: the one list of `game.js` / `renderer3d.js` hooks for the integration owner.
  - `docs/abyssal-tether-3d/PERF_PROTOCOL.md`: the 15-minute device protocol (OVR Metrics, the `perf.html` fly-through,
    a 45-min soak).
- **Acceptance.**
  1. Runs green on today's build and writes `baseline.json`. Counts match the audit within ±10 % (38–66 GL draws,
     ≤ 163 k stereo tris).
  2. A deliberately inflated test scene fails with a readable message.
  3. Determinism: the same postcard rendered twice gives SSIM ≥ 0.995.
  4. `lookcheck` flags the known defects: the S4 cut-outs and the head-on dartboard.
  5. `flash-check` reproduces `flicker_check.mjs`'s 3 pairs/s.
  6. `asset-gate` fails today's `mason_kit.glb` (no UVs, no skin), as expected.
- **Dependencies:** none.

### G01 · Look Book and bible lock · lane P · 8 h

- **Goal.** Freeze what "10×" looks like as data before content is built.
- **Deliverables:**
  - `docs/abyssal-tether-3d/ART_BIBLE.md` (§3 in full, from art.md §4–15).
  - `src/data/looks/looks-ch1.js`: three-free data with one look per section S1–S9:

    | Field | Contents |
    |---|---|
    | `grade` | `{exposure, lift, gamma, gain, saturation, contrast, shadowTint, highlightTint, threatShift}` |
    | `fog` | `{color, near, far, heightDensity, heightFalloff, noiseAmp, scatter, domeTop, domeBottom}` |
    | `wet` | 0–1 |
    | `wear` | tags |
    | `particulates` | particle settings |
    | `lampDip` | L7 parameters |
    | `flicker` | L8 parameters |
    | `bands` | band targets |
    | `mason` | `{wet, dust, soot, glowCeil}` |
    | `promiseColour` | the chapter's promise colour, where shown |

  - `src/data/looks/postcards.js`: P01–P15 and the Ten. Each entry holds a pose, a seed, a creature pose, required ROIs
    and band targets.
  - `docs/abyssal-tether-3d/LOOKDEV.md`: optional Cycles lookdev frames per postcard, rendered when CPUs are free. They
    are compared by band fractions and pool falloff, never by pixel match.
- **Acceptance.** `looks-lint.mjs` passes when:
  - the data imports in Node with no three.js or DOM;
  - the schema is valid and S1–S9 are complete;
  - saturation ≤ 0.6 except tagged promise colours;
  - flicker parameters are within L8;
  - every postcard references a valid section and existing anchors.
- **Dependencies:** G00 (schema check only).

### G02 · Platform enablers and device baseline · lane R · 16 h (+1 h [DEVICE], +≈ 30 min encode CPU)

- **Goal.** Ship the switches every later package needs, and measure the real Quest frame before spending budget.
- **Deliverables:**
  - **Vendor from `three@0.170.0`** into `vendor/three/addons/` (exact list and SHA-256 prefixes in three.md §5):
    - `loaders/KTX2Loader.js`, `utils/WorkerPool.js`, `libs/ktx-parse.module.js`, `libs/zstddec.module.js`,
      `math/ColorSpaces.js`;
    - `libs/basis/basis_transcoder.{js,wasm}`;
    - `libs/meshopt_decoder.module.js`;
    - `utils/SkeletonUtils.js`, `geometries/DecalGeometry.js`.

    Add them to the PWA precache.
  - `src/render/assetLoader.js`:
    - a shared `KTX2Loader.detectSupport(renderer)`, `MeshoptDecoder` and `GLTFLoader`;
    - a JPEG fallback;
    - an `onMaterial` hook that later calls `patchLook`;
    - it reads clip extras from `gltf.parser.json.animations[i].extras`.
  - `tools/abyssal-tether-3d/package.json` (tools-local) and `post.mjs`:
    - `@gltf-transform` 4.5.1, `ktx2-encoder` 0.6.0 and `meshoptimizer`;
    - `prune({keepAttributes: true, keepExtras: true})`;
    - one `ktx2()` pass per texture class, then `meshopt` (blender.md A7).
  - `encode_textures.mjs` with the §2.4 policy. **Not gltfpack:** it drops `uv1` and `_spine_s`.
  - Re-encode today's 15 maps at 1024² as the first proof.
  - `src/render/quality.js`: the tier table (§2.1) and the governor (§2.5).
  - **Renderer hooks** (via `HOOKS.md`):
    - `session.updateTargetFrameRate(72)`;
    - `setFramebufferScaleFactor(tier.scale)` before the session;
    - `compileAsync` precompile on the menu **and** in-session behind the enter-VR fade;
    - `info.autoReset = false` with one reset per frame (K6);
    - a capability log: ASTC, ETC, `OCULUS_multiview`, `WEBGL_multi_draw`, `KHR_parallel_shader_compile`,
      `EXT_disjoint_timer_query_webgl2`, `supportedFrameRates`, base-layer type.
  - `perf.html` + **[DEVICE] `docs/abyssal-tether-3d/DEVICE_BASELINE.md`**:
    - OVR Metrics GPU and CPU p95 at S1 start, S4 sighting, S5 attack close, S7 nave and S8 throat;
    - plus quest.md §21's draw-call and fill sweeps.

    These numbers rescale every (est.) in this plan.
- **Quest cost:** GPU −0.2 to −0.5 ms (bandwidth; est.). VRAM for the 15 maps 84 → ≈ 21 MB. Transcoding runs in workers.
- **Acceptance.**
  1. No world texture is uploaded as RGBA8: all go through `compressedTexImage2D`, in the format `detectSupport`
     chooses for a mocked ASTC/ETC extension list.
  2. KTX2 vs JPEG at 1K on 6 golden poses: SSIM ≥ 0.92 and mean luminance within 3 %. This catches sRGB/linear mistakes.
  3. A normal-orientation sphere lit from +X has the right gradient sign.
  4. The mock-XR log shows `updateTargetFrameRate(72)`.
  5. Governor unit test: injected 27.8 ms intervals step down within 0.5 s and recover after 2 s.
  6. `?ktx2=0` boots on JPEG.
  7. Boot-to-first-frame regresses ≤ 10 %.
  8. [DEVICE] the baseline is filled in.
- **Dependencies:** G00.

### G03 · Look engine: lantern, lit air, grade · lane R · 18 h

- **Goal.** The biggest perceived jump per millisecond, and the lighting language every other package is judged
  under.
- **Deliverables** (`src/render/look/`):
  - `lookEngine.js`: `installLook()`, which replaces `installRadialFog()` (`materials.js` L808).
    - Global chunks are replaced **guarded by `#ifdef AT_LOOK`**, so unpatched shaders keep today's fog and a constant
      AgX curve (K3).
    - `patchLook(material, {gi, creature, wet, grade})` chains existing `onBeforeCompile` and `customProgramCacheKey`
      callbacks, defines `AT_LOOK`, and injects one shared uniform object: lantern, env lights, scatter, GI volume, grade,
      threat, exposure.
  - **HDR fog before tone mapping:**
    - fog colour is linearised with `sRGBTransferEOTF`;
    - analytic single-scatter **in-scatter** for the lantern and both env lights, using the closed form checked in
      `plans/scripts/inscatter_check.mjs` ([Sun et al. 2005][sun05]; three.md §2.6);
    - an exponential **height term** per section;
    - an **ALU value-noise** density term (no texture fetch).
  - `lantern.js`: **the lantern as a custom direct-light term** inside the patched lights chunk.
    - It builds an `IncidentLight` and calls three's own `RE_Direct`, so the BRDF is identical to today's.
    - Attenuation uses `getDistanceAttenuation` with today's 30 m range and 1.6 decay.
    - **Cage-bar cookie:** analytic, in the lantern's local frame; the bars come from the lantern model's JSON (G10).
    - **Hood mask:** Chapter IV's cone, in the same term. This answers E21/E25's "spot + fill" without a second light;
      a contract note goes to task #6.
    - **Wet coat lobe:** a second GGX lobe for the lantern only, on wet and flesh masks.
    - **Shadow hook** for C04.
    - **Flicker** rewritten to L8.
    - The three.js lantern `PointLight` is removed, so `NUM_POINT_LIGHTS` goes 3 → 2 (fixed). The `Lantern` group stays
      for naming. `?lantern=legacy` restores the old light.
  - `grade.js`:
    - `CustomToneMapping` = AgX + lift/gamma/gain + split tone + saturation + contrast;
    - threat shift ramped over ≥ 1 s;
    - triangular dither plus 1–2 LSB grain;
    - the exposure-adaptation uniform (L9).
  - `fogDome.js`: an inverted sphere drawn last, `depthWrite false`, using the same fog code.
  - `themes/ch1.js`: reads `looks-ch1.js` and blends over the existing ±9 m theme band.
  - **Adapter for task #8** (K2): `FxLighting` reads `look.uniforms.lantern*` instead of a `PointLight`.
  - **`renderer3d.js` fixes:**
    - env-lamp fast swing ≤ 0.08 amplitude, character moved into < 0.5 Hz gutters;
    - the ×0.4 dip ramped over ≥ 150 ms;
    - Lamp Dip uniforms per env light (L7);
    - the wind-up glow strobe capped at ≤ 3 Hz with < 10 % modulation.
- **Technique note.** Evaluating the lantern in world space also makes it immune to the super-three multiview per-eye
  light offset (quest.md §5.2).
- **Quest cost (est.):**

  | Term | GPU |
  |---|---|
  | Lantern term (replaces the light it removes) | ≈ ±0 |
  | Cookie | +0.05 |
  | Coat lobe | +0.05–0.1 |
  | In-scatter ×3 | +0.25–0.4 |
  | Height fog + noise | +0.1 |
  | Grade + dither | +0.05–0.1 |
  | Dome | +0.1–0.3 |
  | **Total** | **+0.5–0.9 ms** |

  +2 GL draws (dome); 0 MB; programs recompile once at boot.
- **Desktop extras.** The same chunks. Ultra moves the grade into a post pass behind `AT_GRADE_POST`, so nothing is
  graded twice.
- **Acceptance.**
  1. 0 program links over a full scripted descent after warm-up.
  2. `scene-audit` is green.
  3. **Halo:** fog ROI luminance 0.5–3° around the lantern ≥ 1.25× baseline, falling off radially, and moving with the
     lantern.
  4. **Dome:** looking down the shaft, dome pixels have stddev > 0 (not a flat clear colour).
  5. **Banding:** index ≤ 25 % of baseline on the S4 and S7 fog gradients.
  6. **Value bands:** within the look sheets on P01–P15.
  7. **Cookie:** an FFT peak at the bar frequency on a near wall lit at 1.5 m, with a bar count equal to the lantern
     model's.
  8. **Flash:** `flash-check` ≤ 1 pair/s in S1, S2, S6 and S8; ≤ 2 pairs/s during a wind-up.
  9. **BRDF parity:** with the cookie and lobe off, a golden A/B against the legacy `PointLight` gives SSIM ≥ 0.98.
  10. SwiftShader relative frame time ≤ +15 % at the S7 pose.
  11. Task #8's fog cards still light from the lantern (an ROI check).
- **Dependencies:** G02.

### G04 · Baked GI: irradiance and AO volume · lane R · 14 h (+ minutes of CPU)

- **Goal.** Every one of the 13 lamps lights its surroundings with bounce and soft occlusion; corners darken; the Mason,
  the arms and the particles pick up lamp colour. The baker runs in Node in minutes, so level churn costs nothing.
- **Deliverables:**
  - `tools/abyssal-tether-3d/bake_volume.mjs`:
    - imports `src/data/level-data-3d.js` and `src/sim/level3d.js`;
    - 1 m voxels inside each `section.shaft` (S7 is 80×136×80);
    - 64–128 cosine rays per voxel with 3D-DDA against the boxes, plus kit proxy boxes from G06;
    - direct light from `level.lights` with occlusion, one bounce with per-bucket albedo, and a dim fog/sky term;
    - voxels inside solids are pushed out;
    - RGB is sqrt-encoded irradiance and A is visibility (AO).
  - Outputs: `assets/volumes/s<N>.bin` (RGBA8) and `.json` (min, size, dims, content hash).
  - `src/render/gi/giVolume.js`:
    - a `Data3DTexture` with `LinearFilter`;
    - two volumes cross-fade over the ±9 m theme band;
    - `MAX_3D_TEXTURE_SIZE` is queried at runtime ([web3dsurvey][w3d]).
  - **Sampling** through `patchLook({gi:true})`:
    - per fragment on world, kit and arms;
    - per vertex on the Mason and particles;
    - `indirect += vol.rgb`, `indirect *= vol.a`, `direct *= mix(1, vol.a, 0.35)`;
    - sampled at `worldPos + N·0.5 voxel` against leaks.
  - The hemisphere light drops to a fog floor.
  - One `LightProbe` is always present, with coefficients from the volume as the fallback.
- **Quest cost:** +0.2–0.4 ms (1 trilinear 3D fetch). ≤ 8 MB resident. ≈ 3–5 MB download.
  - **Candidate saving:** `ENV_LIGHTS` 2 → 1 in fully volume-lit sections. Software raster measured −23 % frame time
    for 2 → 0 env lights (audit §3). A/B on device in G14.
- **Desktop extras.** 0.5 m voxels.
- **Acceptance.**
  1. Deterministic bytes.
  2. Unit tests:
     - a voxel inside a solid has A = 0;
     - irradiance 1 m from an isolated lamp is within ±10 % of the analytic point-light value;
     - no direct light behind a wall.
  3. A corner ROI is ≤ 0.8× an open-wall ROI on 3 poses.
  4. Each lamp pool is ≥ 15 % brighter with the volume than without.
  5. **Leak test:** a wall ≥ 1 m thick between a lamp and an ROI gives a ≤ 5 % rise.
  6. No luminance step above 3 % across section boundaries.
  7. All 8 sections re-bake in ≤ 5 min.
- **Dependencies:** G03.

### G05 · Surfaces 2.0: 2K sets, wetness, wear, decals · lane R · 20 h (+≈ 1 h encode CPU)

- **Goal.** Crisp near-field texels, wet specular that slides under the lantern, and wear that obeys gravity.
- **Deliverables:**
  - `build_textures.py --size 2048 --png`:
    - 2K hero sets: masonry, iron, near rock;
    - 1K for the rest;
    - a shared 0.5 m **detail normal** (512²);
    - a 256² drip-streak mask.

    These go through `encode_textures.mjs`.
  - `src/render/surfaces.js` (chained through `patchLook`):
    - **Specular anti-aliasing on the perturbed normal:** roughness is widened by the screen-space variance of the
      normal-mapped normal (about 8 ALU). r170's geometric AA ignores normal maps, and the wasm encoder makes its own
      mips, so per-mip Toksvig is a stretch goal.
    - **Wetness:**
      - section `wet` + height + drip mask;
      - porous albedo × 0.55–0.7;
      - roughness → 0.25–0.35;
      - normals slightly flattened;
      - top-face pooling (reuses `vAtTop`);
      - drip streaks below ledges.
    - **Wear:**
      - soot above lamp positions;
      - rust weep below iron;
      - grime from the volume's AO;
      - polish on anchors;
      - `aoMapIntensity` 0.3–0.5 where the volume or a lightmap already supplies AO (no double darkening, blender.md
        A8).
  - **Build-time decals** (`DecalGeometry`, merged per atlas, `MultiplyBlending` + `polygonOffset`):
    - soot plumes and mineral runs;
    - claw scrapes and mortar trails **along the Mason's known paths**;
    - chalk tallies.
- **Quest cost:** +0.15–0.3 ms; samples = 6 (the cap); +2–4 GL draws (decals); world textures ≤ 70 MB; download
  ≈ 16–20 MB.
- **Desktop extras.** Clearcoat on wet stone and box-projected PMREM (G12).
- **Acceptance.**
  1. Texel-density lint: ≥ 512 px/m on route walls within 3 m.
  2. Near-field postcard (hand on a wall at 0.8 m): Laplacian variance ≥ 3× baseline.
  3. **Wet:** S8 floor specular peak ≥ 1.5× the dry value; a 10 cm lantern move shifts the highlight centroid in the wet
     ROI, not in the dry ROI.
  4. **Shimmer:** temporal luminance std over 30 frames of ±2 mm head jitter is ≤ 1.1× the dry baseline.
  5. Albedo texels within sRGB 30–200 (M4).
  6. **Decal lint:** every soot decal sits above a lamp; every stain sits below a ledge or drip point.
- **Dependencies:** G02, G03, G04 (and G06 trims for trim-sheet materials).

### G06 · Environment kit v2 and the dresser · lane L · 36 h (+≈ 1 h CPU)

- **Goal.**
  - No raw box within 30 m of the route.
  - Stereo-true relief where hands and anchors are.
  - A story prop every 10 m of descent.
  - Collision boxes untouched.
- **Deliverables:**
  - **G06a, kit modules** (with task #8, extending `build_env_kit.py` v1, which today has no UVs and AO in
    `COLOR_0`):
    - **trim-sheet UV0** for architecture: `kit/build_trims.py` produces masonry and iron trims at 2K, baked high →
      low at 512 px/m;
    - **relief tiles** (1 m, 200–400 tris, recessed ≤ 0.15 m and protruding ≤ 0.05 m);
    - ashlar 4×4 (3 variants + 2 broken), 4×2, 2×4, string course, plinth, pilaster/buttress, lancet window, corbel lips
      2 m and 4 m, ribbed-vault segment, stair flight, rubble lip;
    - iron I-beam 4/8 m, grating, rivet band, bracket, **real chain links**;
    - growth ribs;
    - a **figure kit**: one robed statue body in 6 poses, shared later with the Kept;
    - per-module AO in `COLOR_0` (kept from v1), and LOD0/LOD1 per module.
  - **G06b, the dresser:**
    - `src/render/kit/dressLevel.js`: a **pure, three-free** function `dressLevel(levelData, rules) → instances`. It
      classifies faces, tiles panels chosen by `hash(id, face, cell)`, puts trims on exposed edges and lips under ledges,
      skips buried and void-facing faces, and places story props per D2.
    - It runs **at load in the browser** (churn-proof: a level-data edit re-dresses automatically), and **in Node** for
      lints and for G07's chamber export.
    - Hand overrides go in `src/data/dressing/ch1-overrides.js`.
  - `src/render/kit/kitView.js`:
    - one `InstancedMesh` per (module, LOD, material bucket) per 64 m band, re-packed near the head like today's solids;
    - hides box faces for dressed solids;
    - per-instance tint, wetness seed and AO scale.

    One hook in `levelView.js`.
- **Quest cost:** +150–200 k visible tris; +0.3–0.6 ms vertex work (×2 eyes); ≤ 32 instanced objects in view (+≈ 30–40
  GL draws against today's box buckets); geometry ≈ 8 MB; trims 22 MB; download ≈ 4 MB + 10 MB.
- **Desktop extras.** LOD0 at all distances; denser relief.
- **Acceptance.**
  1. **Collision invariants** (Node): 64 samples per dressed face; every play-surface instance protrudes ≤ 0.05 m and
     recesses ≤ 0.15 m. The bot replay gives identical deaths and timings.
  2. **"No raw box":** ID pass at every route pose, ID pixels within 30 m = 0.
  3. Coverage ≥ 90 % of each box face within 30 m of a route sample.
  4. Story-prop density ≥ 1 per 10 m of descent within 15 m.
  5. Determinism: the same level gives the same instance hash; dressing ≤ 200 ms per section on desktop.
  6. Budgets at every postcard. The critic's "boxes read as boxes" flag clears.
- **Dependencies:** G02 (pipeline), G01 (looks); task #8's v1 merged.

### G07 · Hero-room lightmaps · lane L · 18 h (+1–2 h Cycles CPU)

- **Goal.** Lightmap-quality contact light and colour bleed where the composition depends on shadow *shapes*:
  - S1 Threshold arch;
  - S4 Vault catwalk wall;
  - S7 spire base;
  - S8 Still Lamp chamber;
  - S9 Mark chamber.
- **Deliverables:**
  - `tools/abyssal-tether-3d/export_dress.mjs`: the dresser's instances inside a chamber AABB, as JSON.
  - `build_chamber.py`:
    - instances merged per bucket;
    - UV1 at 16 tx/m;
    - Cycles `DIFFUSE` with `pass_filter={'DIRECT','INDIRECT'}` at 384 spp, AO in alpha;
    - pyoidn `RTLightmap`, then dilation;
    - dLDR with `Bmax` → UASTC;
    - a content-hash skip (blender.md A4–A8).
  - Output: `assets/chambers/<id>.glb` + `_lm.ktx2`.
  - At runtime: `lightMap` on `uv1` with intensity π·Bmax. The chamber replaces the instanced dressing inside its AABB.
    The lightmap alpha occludes the lantern in crevices at no extra fetch.
- **Quest cost:** ≈ 0 GPU (the lightmap fetch replaces the volume fetch there); ≤ 6 merged objects per chamber;
  ≤ 27 MB resident; ≈ 1.5 MB download per chamber.
- **Acceptance.**
  1. **Grey-card calibration:** baked vs real-time light within 5 % (blender.md A5).
  2. No seam step above 4 % across island borders.
  3. A mip-2 bleed check.
  4. A re-bake is skipped when the hash is unchanged.
  5. Bakes run only after each room's layout freeze is recorded.
- **Dependencies:** G06, a per-room layout freeze from the level owners (task #6), and free CPUs.

### G08 · Vista and reveals · lane L · 10 h

- **Goal.** The S1, S4 and S7 wide shots stop reading as cut-outs. The Pour and the Spiral stand out against lit haze.
- **Deliverables** (`src/render/kit/vista.js`):
  - task #8's far colossus, column, spire and arcade get an **unlit-with-lit-edge** material: a fog-tinted rim, baked
    vertex AO, and window glints;
  - 2–3 layered fog cards per vista, ≤ 10 % of the screen;
  - S4 far-wall staging with lit haze behind the Pour path;
  - the S1 window cut;
  - the S7 spire silhouette.
- **Quest cost:** ≤ 4 objects, ≤ 30 k tris, ≤ 0.4 ms.
- **Acceptance.**
  1. Mason LOD2 against its background at S4 and S7: luminance ratio ≥ 1.3.
  2. ≥ 3 depth plateaus in the far field of P01, P05 and P10.
  3. Fog-card coverage ≤ 10 %.
- **Dependencies:** G03, G06.

### G09 · Particles 2.0, light shafts, halos · lane F · 16 h

- **Goal.** Air with depth and causality: lit motes in depth layers, grit, drips, bloom without a pass, and the overdraw
  hot spot fixed. This **extends task #8's `atmosphere.js` and `debris.js`**, which are already instanced, pooled and lit
  through `FxLighting`.
- **Deliverables:**
  - `src/render/fx2/motes.js`:
    - instanced quads facing the **head**, not each eye's view plane (no stereo rivalry);
    - motion in the vertex shader;
    - lit per vertex by the lantern and the GI volume;
    - an **analytic soft fade** against the section's shaft planes (no depth reads);
    - a near-eye fade at 0.5 m;
    - a mote type per chapter.

    This replaces `fx.js`'s 900 dust points.
  - Landing puffs re-authored as small, short-lived quads.
  - `fx2/shafts.js`: analytic cone thickness, scrolling noise, motes only inside beams.
  - `fx2/halos.js`: constant angular size, fog fade, CPU raycast occlusion at 4–8 Hz against level AABBs; fresnel shells
    on the pits.
  - Shaft breath (V18): fog density and mote drift modulated below 0.2 Hz with the wind bed.
  - The **creature FX hooks** are delivered in C06, inside these pools.
- **Quest cost:** transparents ≤ 1.2 ms including task #8's cards; ≤ 4 particle systems + 1 shaft + 1 halo object;
  ≈ 3 MB.
- **Acceptance.**
  1. **Overdraw** at three worst moments (a landing looking down, strike chips near the face, S7 debris rain):
     - transparent average ≤ 1.0–1.5;
     - ≥ 4 layers on ≤ 5 % of the screen (today 55 %);
     - blended coverage ≤ 25 %.
  2. Motes within 2 m of the lantern are ≥ 3× brighter than motes at 8 m (Spearman ρ ≤ −0.6).
  3. No particle within 0.5 m of the eyes.
  4. 0 B allocated per frame.
- **Dependencies:** G03 (lighting uniforms), task #8 merged.

### G10 · Near field: arms, launchers, rope, lantern, anchors · lane N · 12 h

- **Goal.** The near field is in 100 % of frames and is the player's ruler for the Mason's size
  ([Frontiers in VR 2022][bodyscale]). Today it reads as orange toys.
- **Deliverables:**
  - **Integration acceptance** for task #8's `player_arms.glb`: 17-bone arms, launchers one draw each, a 2048² baked atlas
    at ≥ 1024 px/m. `handsView.js` keeps the procedural fallback.
  - **Lantern prop:** cage bars from `lantern_cage.json`, the **same data as G03's cookie**; a world-locked flame card;
    a glass emissive.
  - **Rope v2** (`ropeView.js`):
    - 8 sides;
    - a 512² twisted-fibre normal map scrolled with reel-out;
    - wet darkening by section wetness;
    - tension shown as a fibre sheen, not an emissive glow;
    - fray fibres near frayed rings.
  - **Anchors v2:** phosphor inlay, rope grooves worn into the rings, shape codes kept.
- **Quest cost:** ≈ 20–30 k tris; ≤ 0.7 ms; ≈ 18 MB VRAM; draws ±2.
- **Acceptance.**
  1. Texel density ≥ 1024 px/m over 90 % of the arms' surface.
  2. Detail energy in the hand mask at P02 ≥ 3× baseline. The critic's "toy look" flag clears.
  3. The cookie's bar count and angles match the lantern model (one data source).
  4. Anchors ≥ 1.5:1 contrast in all 9 looks.
  5. A periodic twist signal along the rope ROI.
  6. XR-mock e2e: hands follow the controllers.
- **Dependencies:** G02, G03; task #8's arms merged.

### Mason packages (lanes M and S): full spec in CREATURE_RIG_PLAN §11

| ID | Package | Effort | Depends on |
|---|---|---|---|
| **C00** | Identity contract and r2 reconciliation (portal, combs, fronds, stone arms, pits, glow budget, counts, module list) | 5 h | task #2's design freeze |
| **C01** | Modular skinned kit in Blender: rest pose, ownership weights, LODs, 2 atlases, custom attributes | 32 h (+2 h CPU) | C00, G02 (`post.mjs`) |
| **C02** | Armature, clip library (25 Chapter I clips) and motion-quality metrics | 26 h (+8–16 h optional human polish) | C01 |
| **C03** | `MasonRigView` runtime: assembly, layered animation on the sim, phase locking, LOD, bounds, fallback chain | 30 h | C01, C02, G03 |
| **C04** | Mason shading, states, near-eye variant and the custom lantern leg shadow | 16 h | C03, G03 (G04 optional) |
| **C05** | Fear director in the sim (menace measure, startle budget, LINGER, HIDE, FALSE_RETREAT, RISE, CEILING, knock answer) | 22 h | E01 (task #6) |
| **C06** | Sync layer: Mason voice, FX and haptics locked to motion | 14 h | C03, C05, G09 |
| **C07** | Creature acceptance: critic-reviewed frame sequences, budgets, e2e, device | 10 h | C04, C06 |

### G11 · Section look passes S1–S9 · lane X · 40 h

- **Goal.** Author each section to its look sheet and postcards. This is where direction becomes the frame.
- **Per section:**
  - tuned `looks-ch1.js` entry;
  - dresser overrides;
  - hero set piece;
  - volume and chamber bakes;
  - Mason staging data (E17 `creaturePaths`, hold points, director weights);
  - drip points and particulates;
  - passing postcards.
- **Order:** S5 and S7 first (they gate M2), then S4, S1, S9, S8, S6, S3, S2.
- **Effort by section:** S1 3, S2 3, S3 4, S4 5, S5 6, S6 4, S7 7, S8 5, S9 3.
- **Acceptance per section:**
  - the §1.3 checklist is all ticked;
  - `lookcheck` and budgets pass at the postcards and at the E29 worst moment;
  - critic ≥ 7/10 for craft and ≥ 7/10 for dread, with no identity flags;
  - `flash-check` passes in lamp-heavy sections;
  - the section's beats pass fear-sim and sync-check;
  - the bot descent passes E28 V14.
- **Dependencies:** G03–G10 and C03–C06 as each section needs them.

### G12 · Desktop High and Ultra tiers · lane T · 20 h

- **Goal.** An honest "Unreal-like" look where the hardware allows it, on the same assets. Quest is never touched.
- **Deliverables:**
  - `src/render/tiers/tiers.js`: detection, settings hook, `?tier=`. Switching happens only in the menu behind a fade,
    then `compileAsync`.
  - `src/render/post/composer.js` (a dynamic import; **never loaded while `renderer.xr.isPresenting`**):
    - High: RenderPass → half-resolution UnrealBloom → SMAA → OutputPass.
    - Ultra: RenderPass (HalfFloat, 4 samples) → GTAOPass → UnrealBloom → GradePass (the **same** GLSL as G03,
      materials compiled with `AT_GRADE_POST`) → FilmPass → SMAA → OutputPass.
  - **Lights and shadows:**
    - High: lantern spot shadow (PCFSoft 1024²).
    - Ultra: lantern point shadow (PCFSoft 1024 cube) + a creature spot shadow.
    - 6–8 env lights.
  - **Surfaces:**
    - box-projected PMREM per section;
    - clearcoat on wet stone and flesh, sheen on fronds;
    - near POM on masonry (Ultra);
    - raymarched shaft volumes in hero rooms (Ultra);
    - particles ×3–5;
    - the 124 k Mason GLB.
- **Acceptance.**
  1. Desktop postcards per tier with effects detected: bloom energy around emitters; GTAO corner darkening against High;
     a non-empty lantern shadow mask behind the creature at P07.
  2. **XR isolation:** in mock XR, `composer.render` calls = 0 over 600 frames, and the XR program-key set equals the
     Quest set.
  3. **Same grade:** at P10, with bloom, GTAO and shadows off, Ultra's post grade matches High's in-material grade at
     SSIM ≥ 0.98.
- **Dependencies:** G03, G05, C04, G06.

### G13 · Capture director and photo mode (optional, for the store) · lane T · 18 h

- **Goal.** Trailer and store frames at store resolutions with perfect anti-aliasing, from real deterministic play.
- **Deliverables:**
  - `src/dev/replay.js`: records intents, head and hand poses at 72 Hz, seed and step counts; plays back through
    `AT3D.debug`. Dev and capture builds only.
  - `src/dev/photoMode.js`.
  - `tools/abyssal-tether-3d/capture/director.mjs`:
    - Halton-jittered subframes accumulated in a float target (16–64× SSAA);
    - an optional 180° shutter;
    - a critically damped head path;
    - output to PNG and then ffmpeg.
  - Two profiles:
    - `quest-faithful`: the same shaders, assets and lights as Quest;
    - `ultra`.
  - `capture/manifest.json` records the provenance of every asset.
- **Store honesty policy:**
  - The Quest store uses only device captures or `quest-faithful` renders. Device captures are labelled "Captured on
    Meta Quest 3" ([VRC.Quest.Asset.10][vrc-a10]).
  - Ultra footage goes to the web, press and any PC listing, labelled "PC".
- **Acceptance.**
  1. Two replays of 60 s give identical sim-state and bone-matrix hashes every second.
  2. `quest-faithful` at 1× vs the real-time Quest tier: SSIM ≥ 0.97.
  3. The production bundle contains no `photoMode` or `replay` code.
- **Dependencies:** G12, C03; E02/E03 determinism from task #6.

### G14 · Quest hardening and multiview spike · lane D · 14 h (+≈ 4 h [DEVICE])

- **Goal.** Hold 72 Hz p95 on Quest 3 and 3S for 45 minutes, and take the multiview CPU win if it is real.
- **Deliverables:**
  - `?mv=1`: the import map switches to `super-three@0.181.0`, the build Meta's IWSDK ships, re-vendoring the matching
    GLTFLoader and BufferGeometryUtils. It uses `multiviewStereo: true` and requests `'layers'` **only** with
    multiview ([Meta web multiview][m-mv]; quest.md §5.2).
  - An in-session precompile after the session starts (the view count enters program keys).
  - A/B tests:
    - `ENV_LIGHTS` 2 → 1 (G04);
    - the leg-shadow tier (C04);
    - the Quest-Sharp scale.
  - LOD tables; FFR tuning; streaming of the current section ±1, with `renderer.info.memory` back to baseline ±5 % after
    a swap.
  - Thermal soak; a Quest 3S check; the Quest 2 decision.
- **Acceptance.**
  - Headless: `?mv=1` boots in mock XR (fallback path), with budgets unchanged.
  - **[DEVICE]** OVR Metrics at every postcard and E29 worst moment:
    - GPU p95 ≤ 11.5 ms; CPU p95 ≤ 8 ms;
    - stale frames < 1 %;
    - a 45-min soak with no sustained drop below 72 fps ([VRC Perf.1][m-vrc1]);
    - the leg shadow ≤ 0.4 ms or it ships off.
  - Multiview is adopted only with ≥ 20 % CPU improvement on the worst scene and no visual regression.
- **Dependencies:** G11 for S7 and S8 at least.

### G15 · The 10× proof book and store frames · lane X · 12 h

- **Deliverables:**
  - A private before/after **postcard book** (P01–P15 and T1–T5) with the §1.1 scorecard filled in from gate outputs.
  - The critic-panel summary.
  - The **[DEVICE] blind preference** protocol and its results.
  - ≥ 5 Quest-tier store screenshots (device-captured, or `quest-faithful` per the policy).
  - Ultra key art. The Mason appears only as silhouette or crown; no flesh close-ups (RELEASE §13).
- **Acceptance.** Every gate is green; the scorecard meets every target; ≥ 80 % blind preference on every shot.
- **Dependencies:** all Chapter I packages.

### G16 · Chapters II–V · lane X · 4 × 55 h ≈ 220 h

- **Per chapter** (the template proven in G11):
  - look sheet and postcards, **the chapter's Ten shot built first**;
  - ≤ 3 new texture sets (one 2K hero, the rest 1K);
  - ≈ 15 kit modules;
  - volume variants per lighting state;
  - 2–3 chamber lightmaps;
  - chapter FX;
  - the Mason's chapter state, vertebra count and chapter clips (CREATURE_RIG_PLAN §4.3).

| Ch | Look tech (all inside §2 budgets) |
|---|---|
| II Lamphold | ≈ 3,000-lamp field as one instanced draw with a per-instance `lit` attribute (E25). **Lit and snuffed GI volumes cross-faded by snuff progress**, so a whole town goes out with no light-count change. Wax and soot. Ember seams on the Mason for 10 s after each snuff (C1 warm flare) |
| III The Mere | Water surface: fresnel, scrolling normals, **box-projected PMREM 128**, the only PMREM on Quest. Underwater fog swap. A flash-safe caustic term in the lantern cookie. Mist pooled by height fog. Streaming water on the Mason |
| IV The Keeping | **Hooded lantern = the cookie's hood mask.** Bone-dust motes lit only inside the cone. Kept figures from the figure kit with impostors beyond 40 m. Figure-plates prominent |
| V The Still Flame | Inverted grade. A stillness band uniform. ≤ 3 beam cones. Particle time scale from the light mask. The Mason's per-segment stone ramp |

- **Acceptance per chapter:**
  - all G00 gates;
  - E28 V1–V15;
  - postcard critic ≥ 7/10;
  - a pack ≤ 30 MB;
  - flash-check on the chapter's light events (II snuff waves, III caustics, V the Flame).
- **Dependencies:** G11, G14, and task #6's chapter framework (E04, E17–E25).

### 4.2 Effort summary

| Group | Packages | h |
|---|---|---|
| Proof and data | G00, G01 | 28 |
| Renderer core | G02–G05 | 68 |
| Level art | G06–G08 | 64 |
| FX and near field | G09, G10 | 28 |
| The Mason | C00–C07 | 155 |
| Integration | G11 | 40 |
| Tiers and hardening | G12, G14 | 34 |
| Proof | G15 | 12 |
| **Chapter I total** | | **≈ 429 h** (+ G13 18 h optional; + 8–16 h human animation polish recommended) |
| Chapters II–V | G16 | ≈ 220 h |
| **Game total** | | **≈ 650 h** |

**Other time:**
- Blender and Cycles CPU: ≈ 5–7 h for Chapter I, run off-peak.
- Encodes: ≈ 1–2 h.
- Device sessions: ≈ 6 h.

---

## 5. Verification architecture

| Layer | Tool | Proves | When |
|---|---|---|---|
| Asset | `asset-gate`, `gltf-transform validate`, KTX2 header checks, texel density | formats, joints, weights, attributes, no Physical upgrades on Quest, density | every export |
| Unit (Node) | volume baker tests, dresser invariants, clip metrics, in-scatter mirror, governor, flash-check | maths and rules | CI |
| Render gates | `gates.mjs` (SwiftShader + mock XR + GL hook) | draws, tris, programs, links after start = 0, texture formats and bytes, overdraw, allocations, RT passes | every package |
| Look gates | `postcards` + `lookcheck` | value bands, banding, halo, AO corners, wetness, silhouette separation, asymmetry, leg count, depth plateaus | every visual package |
| Relative cost | SwiftShader A/B per feature | no feature exceeds its relative-cost cap. **A proxy only**; never quoted as Quest ms | every package |
| Judgement (soft) | critic panel on contact sheets and frame sequences | craft, dread, identity (no eyes, antennae, mandibles or face), "toy look", "boxes read as boxes" | G06, G10, G11, C01–C07 |
| Device [DEVICE] | OVR Metrics, `perf.html`, `ovrgpuprofiler`, soak | GPU p95, CPU p95, stale frames, 45-min thermal | M1, M2, M4, each chapter |

SwiftShader cannot measure Adreno GPU time, thermal throttling, real FFR or MSAA behaviour, or how the LCD shows darks.
Those are only decided on a headset.

---

## 6. Risks

| # | Risk | L / I | Mitigation |
|---|---|---|---|
| R1 | **No device GPU numbers yet.** Every ms is an estimate | certain / high | G02 baseline first; the reverse gain-per-ms cut rule; the governor; kill switches per feature |
| R2 | Today's shading already uses most of the GPU | medium / high | The biggest wins (KTX2, GI volume, rig) cost ≤ 0.4 ms each; render scale stays 1.0 |
| R3 | Collisions with task #8's files and shaders (K1–K3) | high / medium | the `look/` namespace; `AT_LOOK` guards; the `FxLighting` adapter; extend after #8 merges |
| R4 | Level-data churn invalidates bakes | high / medium | Node volume baker; dresser at load; chamber lightmaps only after a layout freeze, with hash skips |
| R5 | An unpatched material loses the lantern after the `PointLight` is removed | medium / high | `assetLoader` auto-patch; the scene-audit gate; `?lantern=legacy` |
| R6 | CPU draw submission (no multiview) limits kit density | medium / medium | instancing; ≤ 150 GL draws typical; the G14 multiview spike |
| R7 | Download size (2K UASTC normals at 3.7–5.2 MB each) | certain / medium | measured policy; UASTC level 0 + RDO 3 if it passes the headset check; lazy packs |
| R8 | Shader-variant growth causes mid-game hitches (VRC exempts only fades and loading) | medium / high | ≤ 24 programs; 0-links gate; `compileAsync` in session |
| R9 | Photosensitivity regressions | medium / high | flash-check in CI on every light event |
| R10 | Quest LCD turns darkness to murk | high / medium | value bands with a B1 floor; dither; device review of P05, P07, P11 |
| R11 | Owner expectation: "Unreal" seen on Quest | medium / high | tiers labelled; the store honesty policy; the §0.2 framing in every report |
| R12 | Thermal throttling over 45 min | medium / high | 1 ms reserve; the governor; the Quest-Low fallback |
| R13 | KTX2 normal-map quality from the wasm encoder | medium / medium | the normal-sphere test; SSIM gates; UASTC for hero albedo in dark sections |

---

## 7. Decisions needed from the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Accept this plan's spine (quest-fidelity) with the grafts and corrections in §0 | Approve |
| D2 | Budget changes in §2.8: ≤ 200 GL draws worst, ≤ 450 k unique tris worst, Mason LOD0 ≤ 60–70 k, Chapter I pack ≤ 60 MB | Approve; device-confirmed in G14 |
| D3 | The creature identity edits (CREATURE_RIG_PLAN §1.3) | Approve before C01's bakes |
| D4 | The leg-shadow tier on Quest | Build it; ship only if ≤ 0.4 ms on device |
| D5 | Multiview via super-three | Spike in G14; adopt only on a measured CPU win |
| D6 | Quest 2 | Not at launch (Quest 3 + 3S; RELEASE §5) |
| D7 | A human animation polish (8–16 h) on `rear_windup`, `strike`, `roar_display`, `linger_breathe` | Recommended |
| D8 | Device time: ≈ 15 min at M1, M2 and M4; the blind panel at M4 | Required; no agent can measure Quest GPU time |
| D9 | Store honesty policy (G13) | Approve |

---

## 8. New files (summary)

**Runtime** (`public/abyssal-tether-3d/`):
- `src/render/look/{lookEngine,lantern,grade,fogDome}.js`, `src/render/look/themes/ch1.js`
- `src/render/{assetLoader,quality,surfaces}.js`, `src/render/gi/giVolume.js`
- `src/render/kit/{dressLevel,kitView,vista}.js`
- `src/render/fx2/{motes,shafts,halos}.js`
- `src/render/mason/*` (CREATURE_RIG_PLAN §6.1)
- `src/render/tiers/tiers.js`, `src/render/post/composer.js`, `src/dev/{replay,photoMode}.js`
- `src/sim/creature/director.js`
- `src/data/looks/{looks-ch1,postcards}.js`, `src/data/dressing/ch1-overrides.js`, `perf.html`
- `vendor/three/addons/{loaders/KTX2Loader,utils/WorkerPool,libs/ktx-parse.module,libs/zstddec.module,math/ColorSpaces,libs/basis/*,libs/meshopt_decoder.module,utils/SkeletonUtils,geometries/DecalGeometry}.js`
- `assets/{volumes,kit,chambers}/…`, `assets/models/mason/…`, KTX2 texture sets

**Tools** (`tools/abyssal-tether-3d/`):
- `package.json`, `post.mjs`, `encode_textures.mjs`, `bake_volume.mjs`, `export_dress.mjs`, `build_chamber.py`
- `kit/{build_trims,…}.py` (with `build_env_kit.py`)
- `mason/*` (CREATURE_RIG_PLAN §3)
- `verify/**` (G00), `capture/director.mjs`

**Docs** (`docs/abyssal-tether-3d/`): `ART_BIBLE.md`, `HOOKS.md`, `PERF_PROTOCOL.md`, `DEVICE_BASELINE.md`,
`LOOKDEV.md`, `MASON_GAME_SPEC.md`, `MASON_ANIM_NOTES.md`; plus the budget updates in §2.8 once D2 is accepted.

---

## 9. Sources

**Meta** (read by the research step through search extracts; developers.meta.com did not resolve from the sandbox):
- [m-devcomp] Device optimization comparison (Quest 3: 72 Hz, 13.8 ms, < 200 draws, < 1.5 M triangles): https://developers.meta.com/horizon/resources/device-optimization-comparison/
- [m-scale] Render scale (1680×1760 per eye at 1.0; ≈ 1.2 panel-native): https://developers.meta.com/horizon/essentials/render-scale
- [m-bp] WebXR performance best practices (KTX2/Basis; point-light shadows need 6 maps; bake static light): https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
- [m-wf] WebXR performance workflow (~1,000 draws would drop below 72 fps): https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/
- [m-loads] Loads, stores, passes (MSAA on tile; separate resolve ≈ 3 ms): https://developers.meta.com/vr/blog/loads-stores-passes-and-advanced-gpu-pipelines/
- [m-mv] Web multiview (`OCULUS_multiview` with MSAA; 25–50 % CPU reduction): https://developers.meta.com/horizon/documentation/web/web-multiview/
- [m-ffr] WebXR fixed foveated rendering: https://developers.meta.com/horizon/documentation/web/webxr-ffr/
- [m-frames] WebXR frames (`updateTargetFrameRate`): https://developers.meta.com/horizon/documentation/web/webxr-frames/
- [m-vrc1] VRC.Quest.Performance.1 (≥ 60 fps sustained; 45 min; fades exempt): https://developers.meta.com/horizon/resources/vrc-quest-performance-1/
- [m-vrc4] VRC.Quest.Performance.4 (render scale ≥ 85 %, recommended): https://developers.meta.com/horizon/resources/vrc-quest-performance-4/
- [vrc-a10] VRC.Quest.Asset.10 (representative screenshots; "Captured on" labels): https://developers.meta.com/horizon/resources/vrc-quest-asset-10/
- [m-bpo] Best-practices overview (ISO 9241-391): https://developers.meta.com/horizon/resources/bp-overview/
- Project Flowerbed (KTX2, instancing, no post resolves): https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/
- Above Par-adowski (baked vertex lighting, 90 Hz): https://developers.meta.com/horizon/blog/above-par-adowski-webxr-mini-golf/

**three.js:**
- [t-20368] Issue #20368 (multiview not planned for WebGLRenderer): https://github.com/mrdoob/three.js/issues/20368
- [t-26904] PR #26904 (EffectComposer support in WebXR reverted): https://github.com/mrdoob/three.js/pull/26904
- [t-30560] Issue #30560 (WebGPURenderer WebGL2 fallback overhead): https://github.com/mrdoob/three.js/issues/30560
- r176 release notes (multiview in WebGPURenderer only): https://github.com/mrdoob/three.js/releases/tag/r176
- KTX2Loader docs: https://threejs.org/docs/pages/KTX2Loader.html
- **Verified locally in r170** (`plans/three-full/package/src`):
  - `renderers/webgl/WebGLShadowMap.js` L72–75 and L335;
  - `renderers/WebGLRenderer.js` L1154–1158, L1212, L1224;
  - `cameras/CubeCamera.js` L132–165;
  - `extras/PMREMGenerator.js` L111–113;
  - `renderers/webgl/WebGLObjects.js` L46–54 (one skeleton update per frame per skeleton).

**Hardware, display and web platform:**
- UploadVR Quest 3 specs (25 PPD): https://uploadvr.com/quest-3-specs
- Wikipedia, Meta Quest 3: https://en.wikipedia.org/wiki/Meta_Quest_3
- [mixed-dim] MIXED, Quest LCD dimming hands-on: https://mixed-news.com/en/meta-quest-display-dimming-hands-on/
- MDN `OVR_multiview2`: https://developer.mozilla.org/docs/Web/API/OVR_multiview2
- MDN `WEBGL_compressed_texture_astc`: https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_compressed_texture_astc
- MDN `KHR_parallel_shader_compile`: https://developer.mozilla.org/docs/Web/API/KHR_parallel_shader_compile
- [w3d] web3dsurvey `MAX_3D_TEXTURE_SIZE`: https://web3dsurvey.com/webgl2/parameters/MAX_3D_TEXTURE_SIZE

**Look, perception and safety:**
- [sun05] Sun et al. 2005, analytic single scattering: https://www.cs.columbia.edu/~bosun/sig05.htm
- [wcag] W3C WCAG 2.3.1: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- [sync] Maempel 2011 (Dixon & Spitz thresholds): https://www.simpk.de/fileadmin/user_upload_sim/Dokumente/Forschung/Themen/Abteilung_III/Publikationen/Heide_Maempel_2011_Die_Wahrnehmung_audiovisueller_Synchronitaet_in_elektronischen_Medien.pdf
- [holes] Cole & Wilkins 2013: https://repository.essex.ac.uk/7734/
- [bodyscale] Frontiers in VR 2022, body-based scaling: https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2022.869603/pdf
- fxguide on Lagarde's wet surfaces: https://www.fxguide.com/?p=43362

**Project inputs (read, not edited):**
- `plans/research/{quest,three,blender,art,audit}.md`
- `plans/plans/{quest-fidelity,showcase,art-direction}.md`
- `plans/qf/ktx_size.mjs` (measured sizes)
- `plans/scripts/{inscatter_check,flicker_check}.mjs`
- `src/render/{atmosphere,debris,creatureView,renderer3d,materials}.js`, `src/sim/creature3d.js`
- `tools/abyssal-tether-3d/{build_env_kit,build_hands}.py`
- `docs/abyssal-tether-3d/ENGINE_EXTENSIONS.md`
- `scratchpad/mason2/final/r2/{stats.json,export/export_report.json,hero.png,export/lod0.png}`

[m-devcomp]: https://developers.meta.com/horizon/resources/device-optimization-comparison/
[m-scale]: https://developers.meta.com/horizon/essentials/render-scale
[m-bp]: https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
[m-wf]: https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/
[m-loads]: https://developers.meta.com/vr/blog/loads-stores-passes-and-advanced-gpu-pipelines/
[m-mv]: https://developers.meta.com/horizon/documentation/web/web-multiview/
[m-ffr]: https://developers.meta.com/horizon/documentation/web/webxr-ffr/
[m-frames]: https://developers.meta.com/horizon/documentation/web/webxr-frames/
[m-vrc1]: https://developers.meta.com/horizon/resources/vrc-quest-performance-1/
[m-vrc4]: https://developers.meta.com/horizon/resources/vrc-quest-performance-4/
[vrc-a10]: https://developers.meta.com/horizon/resources/vrc-quest-asset-10/
[m-bpo]: https://developers.meta.com/horizon/resources/bp-overview/
[t-20368]: https://github.com/mrdoob/three.js/issues/20368
[t-26904]: https://github.com/mrdoob/three.js/pull/26904
[t-30560]: https://github.com/mrdoob/three.js/issues/30560
[mixed-dim]: https://mixed-news.com/en/meta-quest-display-dimming-hands-on/
[w3d]: https://web3dsurvey.com/webgl2/parameters/MAX_3D_TEXTURE_SIZE
[sun05]: https://www.cs.columbia.edu/~bosun/sig05.htm
[wcag]: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
[sync]: https://www.simpk.de/fileadmin/user_upload_sim/Dokumente/Forschung/Themen/Abteilung_III/Publikationen/Heide_Maempel_2011_Die_Wahrnehmung_audiovisueller_Synchronitaet_in_elektronischen_Medien.pdf
[holes]: https://repository.essex.ac.uk/7734/
[bodyscale]: https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2022.869603/pdf
