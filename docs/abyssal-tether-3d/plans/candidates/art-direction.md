# ABYSSAL TETHER 3D — Overhaul plan, art direction first

*Independent plan for the "10× graphics + a rigged, crazy-scary centipede" milestone. Written 2026-10-19.*
*Angle: decide the look and the creature's performance first, then build only the technology that look needs.*

**Inputs.** I read all five research reports in `plans/research/` (`quest.md`, `three.md`, `blender.md`, `art.md`, `audit.md`)
and checked the code they describe:
- `src/sim/creature3d.js` (states and `body` payload), `src/render/*`, `src/data/level-data-3d.js` (8 sections, 13 lights);
- `docs/abyssal-tether-3d/{CHAPTERS,ENGINE_EXTENSIONS,ART_AUDIO_PLAN,RELEASE}.md`;
- the in-flight creature build `scratchpad/mason2/final/build_r2.py` (r2 renders, `stats.json`, export log);
- the in-flight `tools/abyssal-tether-3d/build_env_kit.py` and `build_hands.py`;
- the existing headless harness (`scratchpad/3d/e2e/e2e.cjs`, `3d/review-perf/*`, `3d/level/{sim,bot,routes}.mjs`).

Nothing under `/home/user/TradeCheckPro` was edited. No Blender renders and no Chromium were run.

**Notation.**
- **GL draws** = `renderer.info.render.calls` in an XR session. three r170 has no multiview, so this counts both eyes:
  one object = 2 GL draws ([three #20368](https://github.com/mrdoob/three.js/issues/20368); `WebGLRenderer.js`, verified
  in `quest.md` §3).
- **Unique tris** = scene triangles counted once. `info.render.triangles` in XR is about 2× that.
- **(derived)** = my own arithmetic or estimate. It must be calibrated on a headset (WP03).
- **[DEVICE]** = a step that needs a real Quest 3/3S and a human. Everything else is provable headlessly.
- **Effort** is in agent-hours. Blender/Cycles CPU wall-time is listed separately.

---

## 0. Summary

### 0.1 What "10×" can honestly mean on Quest 3

The owner asked for "at least 10× the graphics" and a rigged, crazy-scary centipede. Earlier they asked for "studio level,
like a game made on Unreal Engine".

Quest 3 is an Adreno 740-class mobile tiler. At render scale 1.0 it shades 1680×1760 px per eye, in stereo, in a 13.8 ms
frame at 72 Hz ([Meta device comparison](https://developers.meta.com/horizon/resources/device-optimization-comparison/);
[Meta render scale](https://developers.meta.com/horizon/essentials/render-scale)). Today's per-pixel shading already uses
most of the fragment budget (`quest.md` §4). On Quest, a full-screen post pass also loses fixed foveation and costs a
resolve ([Meta: loads, stores, passes](https://developers.meta.com/vr/blog/loads-stores-passes-and-advanced-gpu-pipelines/)),
and point-light shadows cost 6 extra scene renders
([Meta WebXR best practices](https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/)).

So "10×" on Quest cannot come from desktop-Unreal features. It has to come from four things:

1. **Authored content:**
   - geometry with real relief;
   - 2–4× today's texels on trims plus a 0.5 m detail layer, at *lower* VRAM thanks to KTX2;
   - baked light everywhere.
2. **A unified lighting language,** done in-shader:
   - one named light (the lantern) with a cookie;
   - light visible in the air (analytic in-scatter);
   - wet specular that slides as you swing;
   - a graded, dithered image.
3. **A creature that performs:**
   - a ~220-bone skinned body;
   - ≥ 17 acted clips;
   - eight procedural layers;
   - a fear director that stages 24 beats;
   - sound, haptics and FX locked to its motion.
4. **A desktop "Unreal tier"** on the same assets: shadows, bloom, GTAO, more lights.

The *art direction* is what multiplies these into a different-looking game, so it comes first.

**The 10× scorecard** (proved in WP21; "before" values are from `audit.md`):

| Measure | Before | After (target) | Factor |
|---|---|---|---|
| Texel density on route walls ≤ 3 m | ~256 px/m (1024 px per 4 m tile) | ≥ 512 px/m on trims (≥ 1024 hands/anchors) + 0.5 m detail layer | ×2–4 texels, ×8 perceived with detail and relief |
| Unique visible geometry (worst view) | ~82 k tris per eye | 300–450 k unique | ×4–5 |
| Raw boxes visible within 30 m of route | most surfaces | 0 | — |
| Lighting | 3 dynamic lights, flat ambient | baked irradiance/AO everywhere + hero lightmaps + in-scatter + cookie | qualitative |
| Creature | 65 rigid parts, 0 clips, 0 textures | ~220-bone modular skinned body, ≥ 17 clips, 2 baked 2048² atlases | — |
| Fear beats supported | ~5 | 24 | ×5 |
| Postcards passing the look gates | 0 | 14 (Chapter I) + 10 (II–V) | — |

The owner's "at least 10" also gets a literal answer: ten cross-chapter postcards, plus fourteen for Chapter I, each
before and after (WP21).

### 0.2 Work packages in order

The order puts direction first, then the creature (the owner's named ask), then the world. Two tracks run in parallel
after WP05:
- **Track M (Mason):** WP06 → WP11.
- **Track W (World):** WP12 → WP16.

| # | Work package | Track | Effort (h) | Depends on |
|---|---|---|---|---|
| WP01 | **Look Book and bible lock**: per-section looks as data, 14 postcards, the Mason performance script | Direction | 10 | — |
| WP02 | **Proof harness**: postcards, look metrics, budget gates, creature lab, sync, flash and asset gates | Direction | 20 | WP01 |
| WP03 | **Enablers and device baseline**: KTX2/meshopt, `updateTargetFrameRate`, `compileAsync`, dynamic FFR, OVR baseline | Direction | 12 (+1 DEVICE) | WP02 |
| WP04 | **Mason identity contract**: reconcile r2 with the guardrails, counts per chapter, module list | M | 5 | WP01 |
| WP05 | **Look engine**: AgX grade, HDR fog with in-scatter, height fog, lantern spot with cookie, flicker safety | Direction/W | 14 | WP02 |
| WP06 | **Mason modular skinned kit** (Blender): rest pose, ownership weights, 2 atlases, LODs | M | 30 (+2 CPU) | WP04, WP03 |
| WP07 | **Mason armature and clip library**: acted clips with events | M | 24 (+8–16 human, optional) | WP06 |
| WP08 | **CreatureRig runtime**: assembly, layered animation, sim mapping | M | 28 | WP06, WP07, WP05 |
| WP09 | **Mason shading and states**, plus the lantern leg-shadow | M | 14 | WP08, WP05, WP12 |
| WP10 | **Fear director**: AI staging behaviours in the sim | M | 22 | WP01, E01 |
| WP11 | **Sync layer**: sound, haptics and FX for every Mason motion | M | 14 | WP08, WP10, WP15 |
| WP12 | **Baked light**: irradiance/AO volumes, hero lightmaps, probes | W | 24 (+2 CPU) | WP05 |
| WP13 | **Environment kit v2 and dressing builder** | W | 34 | WP03, WP01 |
| WP14 | **Surfaces 2.0**: 2K KTX2 sets, wetness and drips, wear, decals | W | 20 | WP03, WP05, WP13 |
| WP15 | **Atmosphere and particles 2.0** | W | 14 | WP05 |
| WP16 | **Near field**: arms, launchers, rope v2, lantern, anchors v2 | W | 12 | WP03, WP05 |
| WP17 | **Section look passes S1–S9**, postcard-gated | both | 40 | WP05, WP08–16 |
| WP18 | **Desktop high tier** ("Unreal tier") | Tier | 14 | WP05, WP09, WP12, WP14 |
| WP19 | **Quest hardening and multiview spike** | Tier | 14 (+4 DEVICE) | WP17 |
| WP20 | **Chapters II–V art kits and Mason variants** | Game | 170 | WP17, WP19, E-ext |
| WP21 | **The 10× proof**: before/after book, blind panel, store frames | Proof | 10 | all |

**Totals.**
- Chapter I scope (WP01–WP19 and WP21): ≈ **377 agent-hours**.
- The full five-chapter game: ≈ **547 agent-hours**.
- Plus ~4–6 h of Blender CPU wall-time, ~5 h of device sessions, and an optional 8–16 h human animation polish.

---

## 1. Ground rules this plan respects

1. **Do not fight the in-flight workflows; build on them.** At the time of writing:
   - **Task #2** is finishing the r2 *Ossuary Column* design and its static game export.
   - **Task #6** builds the engine extensions E01–E29 and Chapters II–V. It owns `creature3d.js` → `src/sim/creature/*`
     (E01/E17), `audio3d.js` (E26) and the harness promotion (E28).
   - **Task #8** builds atmosphere/debris (`fx.js`), `build_env_kit.py` (env kit v1) and `build_hands.py` (HD arms and
     launchers).

   Every WP below names its touchpoints with these workflows. Sim changes (WP10) go *into* the E01 module split as a
   contract request, never around it (ENGINE_EXTENSIONS §0 rule 9).
2. **Sim and data stay three-free and deterministic** (ENGINE_EXTENSIONS §0 rules 1–3). All look data (`looks-*.js`,
   `postcards-*.js`, `performance.js`, `dressing/*.js`) is plain data that Node can import.
3. **Fixed counts, uniforms not defines.** No light is ever added or removed at runtime, and nothing toggles `castShadow`,
   `scene.environment` or material defines during play. A quality tier is chosen at session start. Every variant is
   precompiled behind a fade (`quest.md` §11; `three.md` §7). Hard gate: **0 program links after gameplay starts.**
4. **The player owns the view.** Nothing rotates or locks the camera, and gaze only *times* reveals (CHAPTERS §3.2;
   art.md §2.7).
5. **Flash safety is a gate, not a setting.** WCAG 2.3.1's general-flash rule is the proxy
   ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)); Meta points developers to
   ISO 9241-391 ([Meta best practices](https://developers.meta.com/horizon/resources/bp-overview/)). Today's lamps and
   lantern sit at exactly 3 flash pairs per second (`art.md` §0.7). The attack wind-up's ~6 Hz glow strobe (`audit.md`
   §2.7) is a likely failure when the crown fills the view. WP05 fixes both.
6. **Identity guardrails** (owner, `art.md` §2.9): no eyes, no antennae, no insect mandibles, and no resemblance to any
   existing creature. Every Mason deliverable passes the originality critic and the silhouette tests (WP02, WP04).

---

## 2. The art-direction contract (what every WP serves)

This condenses `art.md` §4–15 into rules a verifier can check. The full bible becomes `docs/.../ART_BIBLE.md` in WP01.

### 2.1 Pillars
1. **One light you can name.** The lantern is the key. Every other light has a source the player can point at.
2. **Wet stone, worn iron, old hands.** Wear obeys gravity. Darkness comes from light, never from black albedo.
3. **Fear lives at the edge of the light.** The pool's rim (6–10 m), the fog edge and the periphery are where the Mason is
   glimpsed.
4. **The building is the body.** The Mason is ≥ 85 % masonry and iron. What is alive shows only in the joints.
5. **Show the cause.** Every scare has a visible or audible cause a moment before it lands.

### 2.2 Value bands (display sRGB after tone mapping; on Quest's LCD, black is grey)

| Band | sRGB | Content | Gate (lookcheck) |
|---|---|---|---|
| B0 | 0–14 | death fade only | ≤ 1 % of pixels in any gameplay postcard |
| B1 | 18–34 | far fog floor | nothing the player must read |
| B2 | 30–65 | shadowed form ≤ 15 m, the Mason in shadow | separated from B1 by ≥ 1.3:1, or by a rim/edge |
| B3 | 65–170 | lit form | — |
| B4 | 170–255 | sources, wet glints, pits | ≤ 3 % typical, ≤ 8 % peak |

**Readability:** anchors, hazards and the Mason's outline when it matters need ≥ 1.5:1 against their local background.

### 2.3 Colour meaning
- warm = yours / safe;
- cool slate-teal = the world / distance;
- pale cold green-white `#b8f0e0` = the Mason sensing;
- world saturation ≤ 0.6 in the grade;
- saturation is spent on the safe light, the pits, and a chapter's "promise colour";
- **the Mason never emits warm light** (except the 0.5 s warm flare after a snuff, Chapter II);
- Chapter V inverts all of this.

### 2.4 Lighting rules
- **L1** Motivated light only.
- **L2** The lantern is a camera light: spot, cage-bar cookie, in-scatter halo.
- **L3** Fixed light count: lantern + 2 env + hemisphere floor + 1 LightProbe.
- **L4** Bake the world.
- **L5** Silhouette over detail beyond 20 m.
- **L6** Wet rim near the route.
- **L7** Lamp Dip: lamps within 15 m of the crown dim toward 40 % over ≥ 0.4 s and lean toward it.
- **L8** Flicker limits:
  - fast modulation < 10 %;
  - dips ≥ 10 % at most 1 per second, each ≥ 150 ms and ramped;
  - full-field steps ramp over ≥ 100 ms.
- **L9** Dark adaptation: instant drop, +0.6 EV over 4 s.
- **L10** Chapter V inversion.

### 2.5 The Mason's performance doctrine
Fear comes from **anticipation, uncertainty, lingering and slow looming**, not from polygons
([Grupe & Nitschke 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC4276319/);
[arXiv 2508.10586](https://arxiv.org/abs/2508.10586);
[BMC Biology 2020](https://bmcbiol.biomedcentral.com/articles/10.1186/s12915-020-00825-0)). The rig must therefore support:
- a **true freeze** (no idle sway at all; Troxler fading makes a still, dark Mason vanish in the periphery:
  [Kanai & Kamitani](https://bicr.atr.jp/~kmtn/pdf/KanaiKamitaniJCogNeuroPre.pdf));
- **head-turn attention without eyes** ([Langton, Watt & Bruce 2000](https://storre.stir.ac.uk/bitstream/1893/21045/1/LangtonWattBruce_2000.pdf));
- a **leg wave** that reads as life at distance: a retrograde metachronal wave, body undulation ~2.5 rad ahead
  ([Diaz et al. 2023, JEB](https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf));
- **telegraphed fast looms**, and slow looms for dread.

**Sound–picture contract:** audio never before the visual, and ≤ 100 ms after it for contacts. Observers detect
audio-leading at about 75 ms and video-leading at about 188 ms
([Maempel 2011 reporting Dixon & Spitz](https://www.simpk.de/fileadmin/user_upload_sim/Dokumente/Forschung/Themen/Abteilung_III/Publikationen/Heide_Maempel_2011_Die_Wahrnehmung_audiovisueller_Synchronitaet_in_elektronischen_Medien.pdf)).
Far events are delayed by d / 343 s, capped at 0.6 s.

---

## 3. Performance budget (frame allocation)

These are allocations, not measurements. No Quest GPU timing exists yet (`audit.md` §3). WP03 measures the real baseline,
and every number marked (derived) is then rescaled. The frame-level caps come from `quest.md` §2 and §19, Meta's device
page ([device comparison](https://developers.meta.com/horizon/resources/device-optimization-comparison/)) and VRC
Performance.1, which requires ≥ 60 fps sustained at an allowed refresh rate, tested over 45 min
([VRC.Quest.Performance.1](https://developers.meta.com/horizon/resources/vrc-quest-performance-1/)). Our target stays
72 fps.

### 3.1 Per-frame allocation at the worst moment (Quest 3/3S @ 72 Hz, vanilla r170, no multiview)

| System | GPU ms p95 (derived) | Main-thread CPU ms | GL draws (both eyes) | Unique tris | Resident MB (tex + geo) |
|---|---|---|---|---|---|
| World opaque: kit, sections, volume GI, hero lightmaps, wetness | 5.0 | 0.6 (cull, instance repack) | 60 | 220 k | 95 + 25 |
| Look engine: fog, in-scatter, height fog, dome, grade, dither | 0.7 | 0.05 | 2 | 1 k | 1 |
| Lantern spot + cookie, 2 env lights | inside world shading | 0.05 | 0 | — | — |
| Lantern creature-only shadow (encounters; shadow tier only) | 0.8 | 0.1 | 1 (shadow pass, once per frame) | 6 k (proxy) | 4 |
| The Mason (LOD0, lunge close) | 1.5 (0.4 at mid range) | 0.9 | 4 | 70 k | 35 + 8 |
| Arms, launchers, lantern prop, rope | 0.7 | 0.3 | 12 | 22 k | 18 + 2 |
| Anchors, glyphs, halos, light shafts | 0.6 | 0.2 | 16 | 10 k | 4 |
| Particles: motes, grit, drips, chips, debris | 0.8 | 0.2 | 10 | 6 k | 3 |
| Figures, statues, story props | inside world | 0.2 | 20 | 60 k | 12 + 6 |
| UI, wrist, panels | 0.2 | 0.2 | 8 | 2 k | 10 |
| Sim: physics, creature AI and director, threat, beats | — | 2.5 (E29) | — | — | — |
| Audio scheduling | — | 0.4 | — | — | — |
| three.js draw submission | — | 2.5 | — | — | — |
| **Total** | **≤ 11.3 (cap 11.5)** | **≤ 8.0** | **≤ 150 typical / ≤ 200 worst** | **≤ 300 k typical / ≤ 450 k worst** | **≤ 270 MB** |

**Notes and caps:**
- **Draws.** ≤ 150 GL draws typical keeps today's CONTRACT3D figure (`audit.md` §3). ≤ 200 worst is inside `quest.md`'s
  200 typical / 280 worst.
- **Triangles.** ≤ 450 k unique worst (≈ 900 k in `info.render.triangles`) is a raise from CONTRACT3D's 350 k stereo. The
  owner must approve it (Decision D2). It stays inside Meta's soft < 1.5 M guidance. Raise to `quest.md`'s 600 k only
  after the WP19 device sweep.
- **Texture samples per lit world pixel ≤ 6:** albedo, normal, ORM, 3D volume, detail, drip/lightmap. WebGL2 guarantees 16
  units ([webgl2fundamentals](https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html)); keep a
  ledger per material.
- **Blended coverage** ≤ 25 % of the screen, ≤ 3 layers deep. Particles ≤ 4 systems, ≤ 3 k live.
- **0 full-screen post passes on Quest. 0 shadow maps** except the gated creature-only lantern shadow (WP09).
- **Memory.** Resident textures ≤ 300 MB compressed (≈ 180 MB planned for Chapter I, leaving room for the next-chapter
  seam). JS heap ≤ 256 MB, with 0 B/frame steady-state allocation.

### 3.2 Three tiers

| Budget | Quest 3/3S (vanilla r170) | Quest 3/3S + super-three multiview (if WP19 proves it) | Desktop high |
|---|---|---|---|
| GL draws typical / worst | 150 / 200 | 140 / 200, each covering both eyes | ≤ 600 |
| Unique tris typical / worst | 300 k / 450 k | 400 k / 600 k | ≤ 3 M |
| Dynamic lights | lantern spot + 2 env | same | lantern + 6–8 |
| Shadows | creature-only lantern spot, 1024², BasicShadowMap, shadow tier only | same | lantern PCFSoft + creature + props |
| Post | none (grade in-shader) | none | GTAO + bloom + SMAA + LUT + grain |
| Creature LOD0 | 70 k | 70 k | 130 k (r2 game LOD) |
| Framebuffer scale | 1.0 (never < 0.85, VRC.Quest.Performance.4) | 1.1–1.2 only with ≥ 20 % GPU headroom | devicePixelRatio ≤ 2 |
| FFR | dynamic 0.66 ↔ 1.0 | same | n/a |

Sources: multiview via `OCULUS_multiview` in super-three/IWSDK, with Meta's claim of 25–50 % *CPU* reduction for
CPU-bound apps ([Meta web multiview](https://developers.meta.com/horizon/documentation/web/web-multiview/); `quest.md`
§5). VRC render-scale guidance: [VRC.Quest.Performance.4](https://developers.meta.com/horizon/resources/vrc-quest-performance-4/).

### 3.3 Download and pack sizes (conflict to resolve)

- **The conflict.** E29 caps the Chapter I pack at ≤ 15 MB, and RELEASE caps the core tier at ≤ 60 MB (`--max-core-mb 60`).
  A 10× Chapter I does not fit 15 MB.
- **Estimate (derived).** KTX2 UASTC+zstd with RDO ≈ 2–3 MB per 2048² map; ETC1S ≈ 0.5–0.9 MB.

  | Content | Estimate |
  |---|---|
  | Creature | 12–14 MB |
  | World textures | 18–22 MB |
  | Volumes and hero lightmaps | ~8 MB |
  | Kit meshes | ~4 MB |
  | Arms and launchers | ~6–8 MB |
  | **Chapter I total** | **≈ 50–55 MB** |

- **Proposal (Decision D3).**
  - Chapter I ≤ 55 MB, split into an S1–S3 core of ≤ 25 MB, so first head-tracked frame stays ≤ 4 s.
  - Load the creature and S4–S9 content lazily while S1 plays. The Mason is not needed before the S3 call or the S4
    sighting.
  - Chapters II–V ≤ 30 MB each. Whole game ≤ 175 MB.

---

## 4. Work packages

Every WP uses the same fields: **Goal · Deliverables · Technique · Quest cost · Desktop extras · Acceptance (headless) ·
Dependencies · Effort.** Paths are relative to `/home/user/TradeCheckPro` unless absolute.

---

### WP01 — Look Book and bible lock

**Goal.** Freeze what "10×" looks like, and how the Mason performs, before anything is built. Everything is
machine-readable so that WP02 can test against it.

**Deliverables.**
- `docs/abyssal-tether-3d/ART_BIBLE.md`: the condensed bible (§2 here plus `art.md` §4–15), the decisions in §9, and the
  r2 reconciliation summary from WP04.
- `public/abyssal-tether-3d/src/data/looks/looks-ch1.js`: three-free data with one look per section S1–S9.

  | Field | Contents |
  |---|---|
  | `grade` | `{exposure, lift, gamma, gain, saturation, contrast, shadowTint, highlightTint, threatShift}` |
  | `fog` | `{color, near, far, heightDensity, heightFalloff, noiseAmp, scatter, domeTop, domeBottom}` |
  | `wet` | 0–1 (M1: S1 0.10 → S8 0.70) |
  | `wear` | tags |
  | `particulates` | `{kind, density, litBoost}` |
  | `lampDip` | L7 parameters |
  | `flicker` | `{fastAmp ≤ 0.08, dipRate ≤ 1, dipRampMs ≥ 150}` |
  | `bands` | `{b0Max, b1Floor, b4Typ, b4Peak}` |
  | `mason` | `{wet, dust, soot, plateDensity, glowCeil}` |
  | `promiseColour` | the chapter's promise colour, if this section shows it |

  Values start from `art.md` §6.1 and CHAPTERS §4.4.
- `src/data/looks/postcards-ch1.js`: 14 Chapter I postcards (§5) and 10 cross-chapter stubs. Each has:
  - section, camera position and quaternion, sim time seed, `freezeTime`;
  - a creature pose (`{behaviour, clip, t, pathPoint}` or null);
  - required ROIs: anchor ids, the creature mask, a fog-gradient patch and a lamp-pool patch;
  - per-postcard band and contrast targets.
- `src/data/mason/performance.js`: the **Mason performance script**, the single source WP07–WP11 read. For each
  behaviour (§6.6) it gives:
  - entry conditions (sim state and `perf.mode`);
  - clips, weights and crossfade times;
  - procedural layer settings;
  - timing (anticipation, hold, release, in seconds);
  - sync cues (audio ids, haptic patterns, FX ids);
  - guards (minimum distance, rate limits).

  It registers all 24 beats with chapter coverage.
- `docs/abyssal-tether-3d/LOOKDEV.md`: how to render a **Cycles lookdev frame** per postcard (level boxes, the env kit,
  target lights), to be run when CPUs are free, and how real-time frames are compared to it (value-band fractions and
  lamp-pool falloff, never a pixel match).

**Technique.** Art direction as data. Postcards are chosen at "anchor as camera" moments (`art.md` §2.7): the next anchor
frames the reveal.

**Quest cost.** 0 (data only, about 10 KB).

**Desktop extras.** Desktop postcards at 1920×1080.

**Acceptance (headless).** `node tools/abyssal-tether-3d/verify/looks-lint.mjs` passes when:
- all three files import in Node with no three.js or DOM;
- the schema validates and every section S1–S9 has a look;
- world saturation ≤ 0.6 (C2), except tagged promise colours;
- flicker parameters are within L8;
- every postcard references a valid section and existing anchors;
- every one of the 24 beats maps to ≥ 1 clip or layer, ≥ 1 sync cue and ≥ 1 guard;
- the chapter coverage of `art.md` §9.2 is met.

**Dependencies.** None.

**Effort.** 10 h.

---

### WP02 — Proof harness (headless)

**Goal.** Make every later WP provable without a headset:
- fixed-pose screenshots on desktop and in mock-XR stereo;
- look metrics against the Look Book;
- budget gates;
- a standalone creature lab;
- A/V-sync and flash analysers;
- asset gates.

This extends E28's harness promotion (task #6) rather than duplicating it.

**Deliverables** (in `tools/abyssal-tether-3d/verify/`):

| File | What it does |
|---|---|
| `postcards.mjs` | Playwright + Chromium (SwiftShader) boots `index.html?verify=1`, applies `AT3D.debug.pose(postcard)`, and renders desktop 1280×720 plus mock-XR stereo (reuses `scratchpad/3d/game/xr-mock.js`). Writes `out/postcards/<id>.{desktop,xr}.png` and `<id>.json`: `info.render` calls, tris and programs; texture tally by format; program links since gameplay start |
| `lookcheck.mjs` | Pure Node (pngjs). Value-band fractions; ROI contrast (anchor bbox vs a 12 px ring); fog **banding** (longest equal-value run along scanlines in the fog ROI); **Mason silhouette separation** (mask from `AT3D.debug.idPass('creature')`: mean luminance inside vs a ring outside, or rim-pixel fraction); mean chroma of non-emissive pixels vs the look's saturation |
| `budgets.mjs` | Stereo calls/tris at each postcard and along a bot descent (worst-moment list from E29 plus §5). Program links during play = 0. GPU texture MB by format (KTX2 formats known). Geometry MB. Per-frame allocation (reuses `review-perf/perf-alloc.cjs`) |
| `creature-lab.html` + `creature-lab.mjs` | Loads only the Mason (kit, clips, material) and replays recorded sim traces `traces/*.json` (`body` and `perf` per 60 Hz frame, recorded in Node from the deterministic sim). Computes rig metrics (WP08) and renders turntables and clip contact sheets |
| `sync-check.mjs` | Logs bus events, rig visual-event frames and audio scheduling (`audio.debugLog`: id, `ctx.currentTime` start, gain changes). Reports Δ distributions (WP11) |
| `flash-check.mjs` | Steps 60 frames per second (`debug.step(1/60)`), reads 64×64 relative-luminance grids, and counts WCAG 2.3.1 general-flash pairs per 1 s window for every 10°-equivalent window (≈ 10 % of the image width) |
| `asset-gate.mjs` | `gltf-transform validate`, plus: joints ≤ 255 assembled; influences ≤ 4 with sum 1 ± 1e-3; no `KHR_materials_clearcoat` / `_transmission` / `_iridescence` in Quest assets; all images `image/ktx2`; `uv1` on lightmapped primitives; `_spine_s` on the creature; triangles per LOD and materials per asset within spec |
| `fear-sim.mjs` | Node, on `sim.mjs`: seeds × difficulties × bot behaviours (careful, stall, idle near wall); checks WP10 |
| `critic.md` + `critic-pack.mjs` | Contact sheets and a rubric for a multimodal critic panel: craft, dread, and identity/originality with explicit flags for eyes, antennae, mandibles, "known creature" and "toy look". Scores go to `out/critic-*.json`. **Soft gate**; the deterministic gates above are hard |

**Debug API additions** (`game.js`, via the integration owner):
- `AT3D.debug.pose(p)`, `.freezeTime(bool)`, `.idPass(layer)`, `.lookStats()`, `.anchorsOnScreen()`;
- `.creature.perform(behaviour, t)` and `.creature.clip(name, t)`;
- `.lights.setTime(t)` for deterministic flicker.

All of it is stripped unless `?verify=1`.

**Technique.** Reuse `scratchpad/3d/e2e/e2e.cjs`, `3d/review-perf/{lib,perf-render}.cjs` (it already measures overdraw
and program links), `3d/game/xr-mock.js` and the level bot.

**Quest cost.** 0 (verify-only code paths).

**Desktop extras.** The same postcards at 1920×1080 for the desktop tier.

**Acceptance (harness self-test on today's build).**
- 14 postcards render on desktop and in stereo.
- The budget JSON matches the existing e2e numbers within ±2 %.
- Determinism: the same postcard twice gives SSIM ≥ 0.995.
- `lookcheck` reproduces known defects. It must flag:
  - the S4 colossal cut-outs (B0 violations);
  - the creature's head-on "dartboard" low separation.
- `flash-check` reproduces `plans/scripts/flicker_check.mjs`'s 3 pairs/s for env lamps in S1/S2.
- `asset-gate` fails on `mason_kit.glb` (no UVs, no skin), as expected.

**Dependencies.** WP01. Coordinate with E28 (task #6).

**Effort.** 20 h.

---

### WP03 — Enablers and device baseline

**Goal.** Ship the platform switches the bible needs from day one, and measure the real Quest frame before any budget is
spent.

**Deliverables.**
- **Vendor from `three@0.170.0`** (exact list and hashes in `three.md` §5):
  - `KTX2Loader`, `WorkerPool`, `ktx-parse`, `zstddec`, `ColorSpaces`;
  - `basis_transcoder.{js,wasm}`;
  - `meshopt_decoder.module.js`, `SkeletonUtils.js`, `DecalGeometry.js`;
  - add them to `docs/abyssal-tether-3d/pwa/gen-precache.mjs`.
- **Tools** (`tools/abyssal-tether-3d/`):
  - `package.json` (tools-local), `post.mjs` (gltf-transform 4.5.1 + `ktx2-encoder` 0.6.0 + meshoptimizer, as verified
    offline in `blender.md` A7);
  - `encode_textures.mjs`: per-class policy — UASTC+zstd for normals and ORM, ETC1S for bulk albedo, UASTC for hero
    albedo; RDO on; full mips.
- **Renderer:**
  - `session.updateTargetFrameRate(72)` after session start (never called today:
    [Meta WebXR frames](https://developers.meta.com/horizon/documentation/web/webxr-frames/));
  - FFR as a dynamic knob: 0.66 when GPU EMA < 9 ms, 1.0 above 10.5 ms, with hysteresis
    ([Meta WebXR FFR](https://developers.meta.com/horizon/documentation/web/webxr-ffr/));
  - `compileAsync` precompile behind fades and inside the XR session
    ([MDN KHR_parallel_shader_compile](https://developer.mozilla.org/docs/Web/API/KHR_parallel_shader_compile));
  - a dev perf overlay (`renderer.info`, frame-ms EMA, link counter);
  - a device report: extensions (ASTC, ETC, `OCULUS_multiview`, `WEBGL_multi_draw`, `KHR_parallel_shader_compile`,
    `EXT_disjoint_timer_query_webgl2`), `supportedFrameRates`, base-layer type.
- **First proof:** re-encode today's 15 maps (5 sets) to KTX2 at the same 1024².
- **`docs/abyssal-tether-3d/DEVICE_BASELINE.md` [DEVICE]:** OVR Metrics captures of today's build:
  - S1 start, S4 sighting, S5 attack close, S7 nave, S8 throat;
  - GPU ms, CPU ms, fps, stale frames;
  - plus `quest.md` §21's draw-call and fill sweeps.

  These numbers rescale every (derived) cost in this plan.

**Technique.** `quest.md` §7–11; `blender.md` §2 and A7–A8.

**Quest cost (derived).**
- Texture VRAM for the same 15 maps: ≈ 84 MB → ≈ 21 MB (UASTC/ETC1S vs RGBA8).
- Less bandwidth, which helps fragment-bound frames.
- Transcoding moves off the main thread into workers at load.
- 0 draws, 0 tris.

**Desktop extras.** KTX2 transcodes to BC7 automatically. Same overlay.

**Acceptance.**
- `asset-gate` passes on the re-encoded sets.
- Wall ROIs before and after re-encoding: SSIM ≥ 0.98.
- Texture tally drops ≥ 3.5×.
- The mock-XR log shows `updateTargetFrameRate(72)`.
- 0 program links during a full bot descent after start.
- Boot-to-first-frame regresses ≤ 10 %.
- [DEVICE] `DEVICE_BASELINE.md` is filled in.

**Dependencies.** WP02.

**Effort.** 12 h + ~1 h of a human with a Quest 3.

---

### WP04 — Mason identity contract and r2 reconciliation

**Goal.** Lock what the in-game Mason is before rigging. Reconcile the r2 *Ossuary Column* with the identity guardrails,
the canon and the sim.

**Deliverables.** `docs/abyssal-tether-3d/MASON_GAME_SPEC.md`.

1. **Canon.**
   - r2 is the base design (`build_r2.py` header): split masonry vertebrae held open by sinew; a lancet-portal crown with
     stone-tracery combs; 7 bored listening pits; buttress legs with a free knee pier, a wrong-way iron ankle and a
     grapnel; fused cage, ladder and bell as scale cues.
   - Canon (CHAPTERS §2.3) adds **the ring of raised, empty stone arms**.
2. **Guardrail edits** (review items for the creature workflow, task #2):

   | Feature | Rule |
   |---|---|
   | (a) Portal | Opens by **retracting the tracery combs into the jambs** while the archivolt orders recede (telescoping), and the cracked **ventral third drops asymmetrically**. Never animate the two combs as a lateral scissor pair: that is the mandible read |
   | (b) Throat teeth | Stay in staggered rows (no rings, already r2's rule). Visible only with the portal open; darkening with depth |
   | (c) Fiddlehead fronds | Short (≤ 0.5× crown height), clustered, curl and uncurl only. **No lit tips, never a symmetric long pair** (the antenna read) |
   | (d) Stone arms | 8 carved stone forearms on the outer archivolt (robed sleeves, open empty palms, sooted fingertips), 2 rigid joints each. They *perform* offering, reaching and closing (§6.3) |
   | (e) Pits | 7, deep, glow only at the bottom. Never a hole cluster (trypophobia: [Cole & Wilkins 2013](https://repository.essex.ac.uk/7734/)) |
   | (f) Glow budget | Pits and throat ember only |
   | (g) Wall dressing | r2's rubble collars, oil trails and grit are environment FX in the game, not creature mesh |

3. **Counts per chapter.** Segments 20 / 22 / 24 / 28 / 32 (E17). Legs:
   - Chapter I: 24 boned (10 lead + 14 cosmetic);
   - Chapter V: 40 boned (10 lead + 30 cosmetic);
   - plus a bone-less **rib-leg fringe** (2 short iron bars per vertebra, vertex-animated), so there are **≥ 50 visible
     legs** at 60 m (bible §8);
   - joints ≤ 255 at 32 segments (§6.1: 221).
4. **Module list and LOD targets.**

   | Module | Variants | LOD0 / LOD1 / LOD2 tris |
   |---|---|---|
   | crown (portal, arms, fronds, pits, gullet, throat) + neck | 1 | 20 k / 6 k / 1.5 k |
   | vertebra | 4 | 1.0 k / 0.3 k / 0.08 k |
   | ring vertebra (back rings for endings) | 1 | — |
   | figure-plate overlays | 4 | — |
   | tail | 1 | — |
   | leg templates: hauling, reach, broken, stunted | 4 | 0.4 k / 0.12 k / 0.03 k |
   | attachments: cage, ladder, bell | — | — |

5. **Atlas plan.**
   - Atlas A (crown and neck) 2048²: ≈ 500 px/m.
   - Atlas B (body and legs) 2048²: overlapping UV islands per module variant; ≥ 300 px/m.
   - Channels: albedo RGB + emissive mask in A; tangent normal; ORM.
6. **Silhouette tests** (bible §8):
   - (a) LOD2 crawling at 60 m: "a long thing with many legs";
   - (b) reared at 8 m: nobody reports eyes, a face, antennae or pincers;
   - (c) frozen in the periphery: ≥ half of viewers lose track of it.

**Technique.** Review r2's `hero`, `approach`, `full`, `silhouette`, `silhouette_below` and `detail` renders against the
guardrail table in `art.md` §2.9. Write paint-over notes per guardrail.

**Quest cost.** 0.

**Acceptance.**
- `verify/spec-lint.mjs`: counts within budgets (tris per LOD, joints ≤ 255 at 32 segments, 2 materials, ≤ 4 maps per
  atlas).
- The critic panel on r2's silhouette and approach renders raises no identity flags.
- Sign-off by the creature workflow (task #2) is recorded in the spec.

**Dependencies.** WP01. Runs while task #2 finishes.

**Effort.** 5 h.

---

### WP05 — Look engine (the bible's lighting language in shaders)

**Goal.** One shared shader layer that implements L1–L10:
- the lantern as a camera light;
- light that lives in the air;
- cool shadows and warm light;
- no banding, no flash hazard;
- a threat-reactive grade.

Everything else is judged under it, so it comes before content.

**Deliverables.**
- `src/render/atmosphere.js`:
  - `installAtmosphere()` replaces `installRadialFog`. The fog chunk is emptied; fog runs **before tone mapping** in linear
    HDR.
  - Analytic single-scatter **in-scatter** for the lantern and both env lights, using the closed form in `three.md` §2.6
    (verified against numerics in `plans/scripts/inscatter_check.mjs`).
  - Exponential **height fog** per section.
  - A 32³ tiling-noise density term (1 fetch).
  - `patchAtmosphere(material, {volume, creature, wet, grade})`, which chains `onBeforeCompile` and
    `customProgramCacheKey`, plus one shared-uniforms object.
- `src/render/grade.js`:
  - `CustomToneMapping` = AgX + lift/gamma/gain + split-tone + saturation + contrast;
  - threat offsets ramped over ≥ 1 s;
  - triangular dither and grain at 1–2 LSB;
  - an exposure-adaptation uniform for L9.
  - Section looks blend over the existing ±9 m theme band.
- `src/render/lantern.js`:
  - the lantern becomes a `SpotLight` (cone ≈ 140°, penumbra 0.7, decay 1.6), aimed by a blend of hand and head
    forward;
  - an **analytic cage-bar cookie** (ALU only, no texture);
  - a world-locked flame card;
  - a flicker model rewritten to L8.
  - The light count stays at 3 (spot + 2 env), so per-pixel cost does not grow.
- **Fog dome:** 1 draw, inverted sphere, the same fog and in-scatter code, so void pixels get the gradient and the halo.
- **`renderer3d.js` fixes:**
  - `_updateEnvLights`: fast swing amplitude ≤ 0.08, character moved into < 0.5 Hz gutters, the ×0.4 dip ramped over
    ≥ 150 ms;
  - a **Lamp Dip** uniform per env light, driven by creature distance (L7);
  - the creature wind-up's 6 Hz glow strobe becomes ramped pulses ≤ 3 Hz with < 10 % full-field modulation.
- `material.dithering = true` on world, dome and creature materials.

**Technique.** `three.md` §1.4, §2.6, §2.16; `art.md` L1–L10. Analytic single scattering:
[Sun et al. 2005](https://www.cs.columbia.edu/~bosun/sig05.htm).

**Quest cost (derived).**

| Item | GPU |
|---|---|
| In-scatter, 3 lights | ≈ 0.3 ms |
| Height fog + noise | ≈ 0.2 ms |
| AgX + grade + dither | ≈ 0.1 ms |
| Spot + cookie instead of point | ≈ +0.1–0.2 ms |
| Dome | ≈ 0.1 ms |
| **Total** | **+0.6–0.9 ms** |

Draws +2 GL (dome), 1 k tris, +0.13 MB (noise 32³ RGBA8). Program count unchanged: every material recompiles once, at
boot.

**Desktop extras.** The same chunks. LUT and grain can move to the composer (WP18) behind a define, so nothing is graded
twice.

**Acceptance.**
- Postcards S1–S8: `lookcheck` band fractions within each look sheet.
- **Banding:** longest equal-value run in the fog ROI ≤ 6 px (today's value is recorded first).
- **Halo:** around the lantern in a fog ROI, luminance at 0.5 m vs 2 m off-axis ≥ 1.5×, and it moves with the lantern
  (two poses).
- **Cookie:** periodic bar pattern detected on a near wall (FFT peak at the bar frequency).
- **flash-check:** ≤ 1 flash pair per 1 s window in every window over 30 s captures in S1, S2, S6 and S8. Attack wind-up
  capture ≤ 2 pairs/s.
- **Budgets:** +≤ 2 GL draws; 0 program links during play.
- Lamp Dip: creature-lab trace with a lamp at 10 m → lamp intensity falls to 40 % ± 5 % with a ≥ 0.4 s ramp.

**Dependencies.** WP02, WP01.

**Effort.** 14 h.

---

### WP06 — Mason modular skinned kit (Blender)

**Goal.** Turn r2 into a rest-pose, **modular, skinned, baked** game kit that the runtime can assemble at any segment
count (20–32) into one skinned mesh per material.

**Why modular rather than one whole-body rig** (this departs from `blender.md` B1–B3):
- The game needs a different body length per chapter (E17: 20 / 22 / 24 / 28 / 32).
- Figure-plates are added per Mason kill and per gathered Kept (E08, E17).
- Endings need per-segment states: `comeApart`, the stone ramp.
- Modules let one baked atlas serve every length, with overlapping UVs for higher texel density.

Seams are handled the way `blender.md` B4 handles flesh across vertebrae: each vertebra module's tail-end flesh disc is
weighted to its own bone and to a symbolic `next` bone, which the assembler remaps to the following vertebra.

**Deliverables.**
- `tools/abyssal-tether-3d/mason/build_mason_game.py`: the r2 generator promoted from the scratchpad with the creature
  workflow's agreement, deterministic with seed 1313, with `--rest --modules`. It does:
  - **Rest pose:** spine straight along −Y, legs in the canonical neutral pose. Wall-dressing functions still draw their
    random numbers but emit nothing, so the RNG stream and the approved look are preserved (`blender.md` B2).
  - **Ownership weights** through an `owner()` context in the accumulator; rigid parts at 1.0; flesh as a 2-bone
    smoothstep on `spine_s`; ≤ 3 influences; never auto-weights (`blender.md` B4).
  - **Per-module LOD0/1/2.** Weights are applied before decimation, then limit and normalize run again.
  - **2 atlases** baked selected-to-active from the r2 render mesh: albedo (+ emissive mask in A), tangent normal with
    exported tangents, ORM. AO at 256 spp with OIDN, island margin 8 px, bake margin 16 px.
  - **Custom attributes:** `_SPINE_S` (seam pulse), `_SWAY` (strands, chains), `_PART` (plate id for the lift wave) and
    `_MASK` (flesh / stone / iron / rib-fringe / pit / throat, packed).
  - No `Coat Weight` (it would export `KHR_materials_clearcoat` and silently switch to `MeshPhysicalMaterial`).
  - `export_apply=False` (keeps shape keys possible).
- Output to `public/abyssal-tether-3d/assets/models/mason/`:
  - `mason_kit2.glb`: modules, each with its local bone fragment and canonical bone names;
  - `mason_{crown,body}_{albedo,normal,orm}.ktx2` via `post.mjs`.
- Lab render sheet: module sheet; assembled 20- and 32-segment rest pose; silhouettes. Run when CPUs are free.

**Technique.** `blender.md` B2–B4, B8 and A3 bake helpers; bpy 5.2 API notes (`blender.md` §2.1).

**Quest cost (assembled, derived).**

| Item | Chapter I (20 seg, 24 legs) | Chapter V (32 seg, 40 legs) |
|---|---|---|
| LOD0 tris | ≈ 20 + 20×1.0 + 24×0.4 ≈ 50 k | ≈ 20 + 32 + 16 ≈ 68 k |
| LOD1 / LOD2 tris | ≤ 20 k / ≤ 6 k | ≤ 20 k / ≤ 6 k |

- 2 draws (4 GL).
- Textures: 2 × (3 × 5.6 MB) ≈ 34 MB resident (UASTC → ASTC 4×4).
- Geometry ≈ 6–8 MB (quantized).
- Download ≈ 12–14 MB with ETC1S albedo and RDO UASTC.

**Desktop extras.** The same modules at r2 game tessellation (≈ 130 k LOD0). Optional 4096² atlases.

**Acceptance.**
- `asset-gate`: validate clean; at 32 segments joints ≤ 255, influences ≤ 4 with sum 1, 2 materials, no clearcoat
  extension, KTX2 only; LOD triangle targets ± 5 %.
- **creature-lab assembly tests** at 20, 24 and 32 segments:
  - paired seam vertices ≤ 1 cm apart at rest;
  - at a 60° bend and 25° twist between neighbours, mean flesh-band edge stretch ≤ 1.5× and no inverted triangles;
  - assembled bounding box length = 1.5 m × seg × taper profile ± 2 %.
- **Detail retention:** an LOD0 lab close-up at 2 m vs r2 `detail.png`'s crop composition, SSIM ≥ 0.75 on structure
  (normal-map seams flagged by a seam-gradient metric).
- **Silhouette:** LOD2 at 60 m on grey haze → critic "long thing with many legs" ≥ 4/5, and a **flank protrusion count
  ≥ 30** along the silhouette.
- No identity flags at 8 m reared (pose from WP07's `rear_windup` frame, once available).

**Dependencies.** WP04, WP03 (`post.mjs`). Task #2's r2 export must have landed.

**Effort.** 30 h + ~1–2 h CPU bake wall-time (crown atlas ≈ 15–25 min, body ≈ 15–25 min; `blender.md` Part C).

---

### WP07 — Mason armature and clip library (performance authoring)

**Goal.** Author the Mason as an actor: anticipation, overshoot and follow-through, with event markers so sound and FX
land on the frame.

**Deliverables.**
- `tools/abyssal-tether-3d/mason/clips_mason.py`:
  - builds the canonical armature with DEF/CTL bone collections (§6.1);
  - keys clips by code with Bezier ease, auto-clamped handles and per-bone phase offsets;
  - adds F-curve noise for tremble, baked by sampling;
  - stashes each action on an NLA track; writes events as action custom props → glTF animation extras;
  - exports `mason_clips.glb` (armature and animations only, the same bone names as the kit);
  - uses `export_animation_mode='ACTIONS'`, `export_force_sampling=True`, root never keyed (`blender.md` B6).
- The clip set in §6.3: 17 Chapter I clips (crown, arms, fronds, leg templates, additives), each with events.
- `docs/abyssal-tether-3d/MASON_ANIM_NOTES.md`: a timing sheet in frames per clip, and the checklist for an optional human
  polish pass on `rear_windup`, `strike` and `roar_display`, the moments players remember (`blender.md` Part D).

**Technique.**
- `blender.md` B5–B6; Blender 5.x action slots and channelbags (`blender.md` §2.1).
- GLTFLoader r170 does not copy animation extras to `clip.userData`, so the runtime reads
  `gltf.parser.json.animations[i].extras`.
- Root tracks are stripped at load.

**Quest cost.** CPU ≈ 0.1–0.2 ms for the mixer (≤ 4 active actions on ~50 crown/arm bones). Download ≈ 0.3 MB
(meshopt-compressed samplers).

**Desktop extras.** None needed. Same clips.

**Acceptance.**
- `asset-gate`: the expected clip names and durations; events parse and lie inside the clip range; no `root.*` tracks; the
  only `spine_*` tracks are on `breathe_seams` (additive, spine_00–05).
- **Motion-quality metrics** in creature-lab:
  - **anticipation:** in `rear_windup`, `strike` and `knock_x3`, crown displacement is opposite to the main action in the
    first 10–20 % of the clip, with ≥ 5 % of the main amplitude;
  - **overshoot:** portal open peaks 5–15 % above its settle value;
  - **follow-through:** arm and frond phase offsets ≥ 2 frames between neighbours;
  - **loops:** wrap discontinuity ≤ 0.5° on every bone.
- Clip contact sheets (8 frames each) go to the critic panel. Dread rubric ≥ 7/10 for `listen`, `rear_windup` and
  `linger_breathe`.

**Dependencies.** WP06 (bone names), WP01 (performance script).

**Effort.** 24 h. Optional human polish: 8–16 h.

---

### WP08 — CreatureRig runtime (assembly, layered animation, sim mapping)

**Goal.** The in-engine Mason:
- assembled for the chapter's segment count;
- driven by the existing sim payload, plus `body.perf` (WP10);
- clip layers and eight procedural layers;
- 2 draws per eye, zero per-frame allocation.

**Deliverables** (in `src/render/mason/`; the StandIn fallback in `game.js` stays):

| File | Contents |
|---|---|
| `masonAssembler.js` | Concatenates module geometries per material and per LOD for `seg` and the leg layout. Remaps joint indices (`next` → following vertebra). Recomputes `_spine_s`. Builds one `Skeleton` shared by LOD0/1/2. Applies `extraPlates` (rebuilt behind a death or chapter fade, never mid-play) |
| `masonRig.js` | Per-frame pipeline (§6.4): mixer → spine from sim → compose additive deltas → P-FOCUS → lead-leg IK → cosmetic metachronal legs → P-SPRING → P-TIMESCALE → `updateMatrixWorld` → bounding sphere from sim bounds → per-bone data texture (glow, hide, stone, wet, dust, curl, jitter) |
| `masonGait.js` | Retrograde metachronal wave (phase φᵢ = φ₀ − 2πi/λ + ωt, ω from crawl speed, duty factor 0.65 slow → 0.5 fast, undulation lead ≈ 2.5 rad). Feet projected onto the clinging plane from `body.up`. Analytic 2-bone IK with a fixed metatarsus back-bend and grapnel orientation. Plant detection emits `mason:plant {leg, x, y, z, intensity}` on the bus |
| `masonPerformance.js` | Reads `body`, `perf` and `performance.js`. Crossfades, weights and **time-warps** (`rear_windup` is warped so `full@` lands on the sim's wind-up end and `strike` so `contact@` lands on the sim's strike frame). Dispatches clip events as `mason:anim {clip, event, x, y, z}` |
| `creatureView.js` | Becomes a thin adapter. The old rigid-kit path stays behind a flag until WP17 signs off |

**Technique.**
- **Run the mixer first, then compose its additive delta onto the procedural spine** (`blender.md` B9: the mixer writes
  local TRS from the binding's original values, so the procedural code and the mixer must not both own a spine bone).
- Spine bones are flat under the root for cheap world-space writes (`three.md` §4.3).
- `SkinnedMesh.boundingSphere` is computed once and goes stale, so it is set every frame from the sim's spine and foot
  bounds (`quest.md` §15).
- LODs share one Skeleton and switch on nearest-point distance (LOD0 < 15 m, LOD1 < 42 m, LOD2 beyond).

**Quest cost (derived).**
- CPU when visible ≈ 0.6–0.9 ms: mixer 0.15, 221 bone matrices 0.15, 40-leg IK 0.1, springs 0.05, data texture 0.05,
  `matrixWorld` 0.2. Hidden: ≤ 0.05 ms.
- GPU skinning ≈ 0.2 ms at LOD0 (≈ 40 k verts × 2 eyes × 16 `texelFetch`).
- 4 GL draws. Bone texture 32×32 RGBA32F, 16 KB uploaded per frame.

**Desktop extras.** LOD distances ×2; the 130 k hero LOD.

**Acceptance** (creature-lab replays recorded deterministic sim traces: `s4-sighting`, `s5-stalk-attack`, `s7-spiral`,
`listen-freeze`, `linger`, `false-retreat`):
- **Lead legs:** planted grapnel tip within 5 cm of the sim foot (p95), ≤ 15 cm max.
- **Cosmetic legs:** planted feet within 10 cm of the clinging plane; planted-foot world drift ≤ 2 cm per frame (no
  skating).
- Spine bone origins equal sim spine points within ±1 mm.
- The bounding sphere contains 100 % of sampled CPU-skinned vertices every frame.
- No NaNs. **0 B per-frame allocation** (perf-alloc).
- Rig CPU p95 ≤ 0.25 ms in desktop Chromium (≈ ≤ 1 ms on Quest, assuming a ×4 factor to be confirmed by WP03).
- `rear_windup`'s `full@` event fires within ±1 frame of the sim's wind-up end; `strike`'s `contact@` within ±1 frame of
  `creature:strike`.
- **e2e:** a full bot descent with the new creature has no console errors; deaths and causes within ±10 % of baseline
  (the sim is unchanged); creature-close stereo GL draws +≤ 4 vs today.

**Dependencies.** WP06, WP07, WP05 (shading hook). The sim payload is existing; `body.perf` is optional until WP10.

**Effort.** 28 h.

---

### WP09 — Mason shading, states and the lantern leg-shadow

**Goal.** Make the body read as *wet stone, worn iron, mortar-flesh* under one lantern. Implement the state looks the
fear beats and chapters need. Put the legs' shadow on the wall before the body is seen.

**Deliverables.**
- `src/render/mason/masonMaterial.js`: `MeshStandardMaterial` plus patches.

  | Feature | Implementation |
  |---|---|
  | Maps | Atlas albedo, normal, ORM. A **detail texture array** (masonry / iron / flesh, 512², 1 fetch indexed by `_MASK`) replaces today's 3-fetch triplanar |
  | Flesh | Wrap diffuse + back-light translucency on the mask (`three.md` §2.5) |
  | Rim | Fresnel tinted toward fog colour, so the outline separates from haze (B2 vs B1) |
  | Wet | Specular: roughness falls with `wet` × mask; mortar-flesh is always wet (≈ 0.25) |
  | Pits | Glow sits at the bottom of real stereo geometry, so depth reads in VR; throat ember |
  | State inputs | Per-bone data texture: glow, **hide** (all emissive 0, plates flush), **stone ramp**, **dust coat** (breaches), **soot/wax** (II), **wet streaming** (III), **stilled tint** (V) |
  | Vertex animation | Seam-breath pulse along `_spine_s`; rib-fringe metachronal vertex animation; plate-lift wave (P-JITTER) |
  | GI | Irradiance-volume sampled **per vertex** (WP12), so it darkens in niches and takes on lamp colour |
  | Near eye | A **near-eye dither variant** (separate precompiled program), swapped only when any crown vertex is < 1.0 m from the eye; never with geometry < 0.6 m (S2 near-eye rule) |

- **Lantern leg-shadow (shadow tier).**
  - A `SpotLight.shadow` with `BasicShadowMap` at 1024².
  - The **only caster** is an LOD2 shadow proxy on layer 1, so the shadow camera sees it and the main camera does not.
  - Updated only while the creature is < 25 m and in the lantern's hemisphere (`shadow.autoUpdate`), and faded with
    `shadow.intensity`. No runtime recompiles.
  - Tier chosen at session start. `quest-high` = on, if the WP19 device A/B shows ≤ 0.8 ms.

**Technique.** `three.md` §2.4, §2.5, §2.18; `art.md` §8, §10.

**Quest cost (derived).**
- Creature pixels: 4 fragment samples (albedo, normal, ORM, detail; volume is per vertex). ≈ 0.3 ms at 15 % coverage,
  ≤ 1.2 ms at 40 % (lunge).
- Shadow tier: proxy pass ≈ 0.2–0.4 ms, plus 1 tap on lit pixels ≈ 0.2–0.4 ms. ≤ 0.8 ms while active.
- Textures +1 MB (detail array) + 4 MB (shadow map).
- Programs +3: base, near-dither, shadow variant. All precompiled.

**Desktop extras.** `MeshPhysicalMaterial` clearcoat on flesh, sheen on fronds, PCFSoft 2048² shadows, the 130 k LOD.

**Acceptance** (creature-lab postcards: reared at 6 m lit only by the lantern; crawling at 15 m lit by a lamp; silhouette at
40 m on haze; hide at the light edge):
- **Separation:** creature mask vs surrounding ring luminance ≥ 1.3:1, *or* rim pixels ≥ 2 % of the mask boundary.
- **Wet:** the top 1 % luminance inside the flesh mask is in B4, and the highlight centroid moves when the lantern moves
  10 cm.
- **Hide:** emissive pixels in the mask = 0; plate displacement = 0; bone deltas = 0 over 1 s.
- **Glow budget:** emissive pixels only inside the pit and throat masks.
- **Stone ramp:** luminance and saturation change monotonically tail → head.
- **Near eye:** in the `linger` trace, no creature fragment is within 0.6 m of the eye (depth readback in the lab).
- **Shadow tier:** +1 shadow-pass draw and +6 k tris in mock XR; a leg-shadow ROI on the wall darkens ≥ 25 % when a leg
  crosses the lantern.
- **flash-check** during wind-up ≤ 2 pairs/s.

**Dependencies.** WP08, WP05. WP12 for the volume; the fallback is the hemisphere plus the LightProbe.

**Effort.** 14 h.

---

### WP10 — Fear director: AI staging behaviours (sim)

**Goal.** Give the sim the behaviours the beats need:
- holding still, lingering, hiding;
- false retreats, rising from below, ceiling crossings;
- knock answers, plate turns, lantern hunger;

all paced by a menace measure and a startle budget, deterministic and testable in Node. Today's sim has
listen/snap/burst/attack/stall (`audit.md` §2.7); this adds the *staging* layer on top.

**Deliverables** (inside the E01 module split, as a contract request to task #6; three-free; `U.rng` seeded per section):
- `src/sim/creature/director.js`:
  - **menace measure:** integrates proximity × visibility × threat. Above its ceiling for N s, it schedules a withdrawal
    or a false retreat; below its floor, it schedules a pre-cue or an approach. This is a pacing *principle*, not a
    borrowed behaviour ([Game Developer on Alien: Isolation](https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation));
  - **startle budget:** ≤ 1 loud startle per ~5 min, never in rest spaces (bible S3);
  - a behaviour picker with per-beat cooldowns.
- **New behaviours** (`perf.mode`):

  | Mode | Behaviour |
  |---|---|
  | `LINGER` | Crown holds 2.5–4 m from the head for 1.5–3 s (Normal ≥ 2.5 m) |
  | `HIDE` | Stone-still camouflage at the light's edge, never within 2× the kill radius |
  | `FALSE_RETREAT` | Retracts along its trail; ~6 s silence; relocates behind or above |
  | `RISE` | Emerges from below, 30 → 10 m over 6–10 s |
  | `CEILING` | Inverted crossing above; emits `creature:ropeTouch` |
  | `KNOCK_ANSWER` | E10 |
  | `PLATE_TURN` | Plates roll to face the player in sequence |
  | `LANTERN_HUNGER` | Focus switches to the lantern |
  | `SNUFF` / `GATHER` / `STILLED` | Chapter modes; share the E17 and E23 hooks |

- **`body.perf` payload:** `{ mode, t, dur, focusKind: 'head'|'hand'|'lantern'|'decoy', focus{x,y,z}, freeze 0..1,
  hide 0..1, rearT, contactIn (s), armsReach 0..1, iris 0..1, knock, startle }`.
- **Events:** `creature:freeze`, `creature:unfreeze`, `creature:linger {phase}`, `creature:hide {phase}`,
  `creature:retreat {false: true}`, `creature:ropeTouch {hand}`, `creature:knock {count}`, `creature:startle`.
- Presets per difficulty and per mode (dormant / sighting / stalk / hunt / frenzy / escape).

**Technique.** `art.md` §2.6 and §9; CHAPTERS §3.2 dread grammar. Honest senses: audio never lies about where the Mason
is; silence may hide it.

**Quest cost.** CPU ≤ 0.15 ms: ≤ 4 extra line-of-sight tests per creature tick, reusing existing checks.

**Desktop extras.** None.

**Acceptance** (`fear-sim.mjs`: 50 seeds × 3 difficulties × S4–S8 routes, with careful, stall and idle-near-wall bots):
- `LINGER`: min head-to-eye distance ≥ 2.5 m on Normal (≥ 1.0 m on Abyss); hold 1.5–3 s; ≤ 1 systemic linger per
  chapter.
- `HIDE`: never within 2× the kill radius.
- Every strike within 8 m is preceded by a wind-up ≥ 0.35 s (S4 rule).
- `FALSE_RETREAT`: creature audio intensity 0 for ≥ 5.5 s while the heartbeat and breath buses stay non-zero (audio-graph
  mock).
- ≤ 1 `creature:startle` per 5 min of run time.
- Screen-time proxy ≤ 10 % (E28).
- Careful-bot death rate within ±15 % of current tuning; stall deaths still at ~15 / 10 / 6 s.
- The determinism hash is equal across two runs. The Chapter I regression (E28 V14) passes.

**Dependencies.** WP01; E01 (task #6).

**Effort.** 22 h.

---

### WP11 — Sync layer (sound, haptics and FX for every Mason motion)

**Goal.** Implement A1–A8:
- every visible Mason motion near the player has a sound;
- every Mason sound within 25 m has a visible correlate;
- contacts are synced to ≤ 100 ms after the visual;
- far events are delayed by distance;
- freezes cut sound and motion on the same frame.

**Deliverables.**
- **Mason voice** (through the E26 contract with task #6: a `masonVoice` section inside `audio3d.js`, or a new
  `src/audio/masonVoice.js`):
  - subscribes to `mason:plant`, `mason:anim`, `creature:freeze` / `unfreeze` / `linger` / `ropeTouch` and the existing
    `creature:*` events;
  - the **scrape bed is gated by rig motion energy** (Σ bone angular speed), so the freeze cuts it on the same frame;
  - per-plant click and grind, delayed by d/343 s (capped at 0.6 s);
  - portal grind, comb clack, arm stone scrape, pit suction, knocks;
  - breath and heartbeat never drop (CHAPTERS §3.2.3).
- **FX in `src/render/fx.js`** (coordinate with task #8):
  - V2 grit rain and seam sifting when the creature is above;
  - V9 chips on a strike miss, at the true strike point;
  - V10 seam-breath puffs at seam bones;
  - V11 plant dust and chips (4–8 particles per plant within 20 m);
  - V12 wall bulge on `wall:bulge`;
  - V13 snuff puff.
- **Haptics (A6):** plant ticks within 10 m; rope thrum on `ropeTouch`; three taps for a knock; a buzz for bulges under a
  gripped wall.

**Technique.** `art.md` §2.5 and §14.

**Quest cost.** GPU ≤ 0.2 ms (inside WP15's pooled systems; 0 new draws). CPU ≤ 0.2 ms. ≤ 8 concurrent creature voices.

**Desktop extras.** More particles per plant.

**Acceptance** (`sync-check.mjs` on lab traces and on an e2e S5/S7 segment):
- **A1:** contact events, Δ(audio start − visual frame) ∈ [0, 100] ms at p95.
- **A2:** far events, Δ = d/343 ± 40 ms.
- **A5:** scrape bed < −40 dB within ≤ 1 frame of rig motion energy reaching 0.
- **A4:** ≥ 95 % of creature audio emissions within 25 m have a visible correlate within ±100 ms.
- **A7:** the pre-cue audio position is within 1 m of the first visible creature point.
- The haptic log has an entry for every plant within 10 m.

**Dependencies.** WP08, WP10, WP15.

**Effort.** 14 h.

---

### WP12 — Baked light (the GI look on a mobile budget)

**Goal.** Every lamp lights its surroundings with soft bounce and contact darkening, and dynamic objects (Mason, arms,
Kept) pick it up. This is the largest "looks expensive" win per millisecond (`three.md` §3 rank 2; `quest.md` §20).

**Deliverables.**
- `tools/abyssal-tether-3d/bake_volume.mjs` (Node, CPU only, no Blender), per section:
  - an **irradiance + AO volume** at 1 m voxels (S7 is the largest at 80×136×80);
  - slab-test rays against the level boxes plus kit proxy boxes;
  - static lights from `level.lights` + a sky/fog bounce term; AO in alpha; invalid voxels inside solids pushed out;
  - outputs `assets/volumes/sN.bin` (RGBA8, sqrt-encoded) + `sN.json`.
- **Sampling** through `patchAtmosphere({volume: true})`: `indirect += vol.rgb`, `indirect *= vol.a`,
  `direct *= mix(1, vol.a, 0.35)`. Two volumes cross-fade over the ±9 m theme band.
- **Hero lightmaps** (Blender Cycles; `blender.md` A2–A8) only for authored rooms where shadow *shapes* are part of the
  composition: S1 Threshold arch, S4 Vault catwalk wall, S7 spire base, S8 Still Lamp chamber, S9 Mark chamber.
  - Outputs `assets/sections/sN_hero.glb` + `sN_hero_lm.ktx2` (dLDR with `Bmax` in extras; lightmap alpha = AO, which
    drives the free lantern-occlusion trick).
- **SH probe fallback:** one `LightProbe` always present, coefficients lerped from a probe grid.
- **Calibration:** a grey-card scene confirms `lightMapIntensity = π·Bmax` within 5 % (`blender.md` A5).

**Quest cost (derived).**
- +1 trilinear 3D fetch per world fragment ≈ 0.2–0.4 ms; ≈ +0.1 ms for the lightmap fetch on hero pixels.
- **Candidate saving:** with the volume carrying lamp light, `ENV_LIGHTS` 2 → 1 could save one light loop per lit pixel.
  `audit.md` measured −23 % frame time for 2 → 0 env lights on software raster. A/B on device (WP19).
- VRAM: volumes ≤ 8 MB resident (±1 section); hero lightmaps ≤ 27 MB resident.
- Download: ≈ 5 MB volumes (gzip), ≈ 6 MB lightmaps.

**Desktop extras.** 0.5 m voxels; full-section lightmaps; plus the real-time lantern shadow (WP18).

**Acceptance.**
- **Node unit tests:**
  - deterministic hash;
  - irradiance 1 m from an isolated lamp within ±10 % of the analytic point-light value;
  - no valid voxel inside a solid.
- **Postcards:**
  - lamp-pool ROI luminance ratio (2 m vs 6 m) ≥ 2.5×;
  - corner ROIs ≤ 0.75× wall-centre luminance (contact darkening).
- **Creature lab:** mean creature luminance in a dark niche ≤ 0.7× its value on an open lit wall.
- Grey-card calibration within 5 %.
- 0 new program links; +0 GL draws (hero GLBs replace dressing meshes).

**Dependencies.** WP05. WP13 for kit proxies (a first pass can bake against boxes only).

**Effort.** 24 h + ~2 h CPU (volumes take minutes; hero lightmaps ≈ 5 rooms × 5–15 min at 1024², `blender.md` Part C).

---

### WP13 — Environment kit v2 and dressing builder

**Goal.**
- **No raw box within 30 m of the route** (D6).
- Stereo-true relief where hands and anchors are.
- A story prop every 10 m of descent (D2).
- Vista silhouettes that read as forms on haze, not black cut-outs.

**Deliverables.**
- **Extend `tools/abyssal-tether-3d/build_env_kit.py`** (v1 is in flight under task #8 and has no UVs; v2 adds):
  - **trim-sheet UV0** on architectural parts;
  - **relief tiles** (1 m, 200–400 tris; recessed ≤ 0.15 m and protruding ≤ 0.05 m on play surfaces);
  - ashlar panels 4×4 (3 variants + 2 broken), string course, plinth, pilaster/buttress, lancet window, corbel lip,
    ribbed-vault segment;
  - iron I-beam, grating, rivet band, bracket; **real chain links** within 15 m (cards beyond);
  - rubble lips; growth ribs;
  - a **figure kit** (one statue body, 6 poses), shared later with the Kept (IV).
- **Dresser:** `tools/abyssal-tether-3d/dress_level.mjs` is a deterministic, rule-based dresser over the level boxes:
  - classify faces; tile panels chosen by `hash(id, face, cell)`;
  - trims on exposed edges; skip buried faces;
  - write `src/data/dressing/ch1-dress.js` (instance lists per module, three-free).

  LevelView draws one `InstancedMesh` per module per material bucket, repacked near the head as today (`three.md` §2.10).
- **Far HLOD:** colossus, column, spire and arcade (v1) get an **unlit-with-lit-edge** material (fog-tinted rim, baked
  vertex AO), so they read as forms on haze.
- **Story props** per section from the look data: statues, tally marks, dropped lanterns, scaffolds swallowed by masonry,
  rope grooves.

**Technique.** `blender.md` A1–A3; `art.md` §2.4 and §13. Collision stays boxes (CHAPTERS §3.2.7).

**Quest cost (derived).**
- +150–200 k unique visible tris; GPU ≈ 0.3–0.6 ms of vertex work, negligible fragment change (it replaces box faces).
- +16–24 GL draws (8–12 module buckets).
- Geometry ≈ +12 MB quantized. Download ≈ 4 MB (meshopt).

**Desktop extras.** Denser relief beyond 8 m; more props; POM on masonry (WP18).

**Acceptance.**
- **Dressing lint** (Node):
  - every collision-box face within 30 m of any route sample is ≥ 90 % covered by kit modules (area from instance AABBs);
  - no kit geometry protrudes > 5 cm outside any box face the bot route touches;
  - story-prop density ≥ 1 per 10 m of descent within 15 m of the route.
- **Postcards:** the critic's "boxes read as boxes" flag clears on all 14; budgets within §3.1; 0 new program links.

**Dependencies.** WP03, WP01. Built on task #8's v1.

**Effort.** 34 h.

---

### WP14 — Surfaces 2.0

**Goal.** Crisp near-field texel density, wet specular that moves under the lantern, and wear that obeys gravity
(M1–M7).

**Deliverables.**
- **`build_textures.py`:**
  - **2048² hero sets:** masonry tile, masonry trim, iron trim, near rock. 1024² for the rest.
  - PNG output → KTX2 via `encode_textures.mjs`.
  - **Toksvig-adjusted roughness per mip** (stops wet-specular sparkle in stereo; three's geometric AA ignores normal
    maps, `three.md` §1.5).
  - A 0.5 m **detail-normal** set (512², 1 fetch).
- **`materials.js` patches** (chained through `patchAtmosphere`):
  - **wetness:** section `wet` + height + drip mask → albedo × 0.55–0.7 (porous), roughness → 0.25–0.35, normals
    slightly flattened;
  - a time-scrolled 256² **drip-streak** mask and top-face pooling (reuses `vAtTop`);
  - **gravity-true wear:** soot above lamps, stains below ledges, grime in AO corners;
  - `aoMapIntensity` 0.3–0.5 where the volume or lightmap already supplies AO.
- **Build-time decals** (`DecalGeometry`, `MultiplyBlending`, 1–2 merged meshes per section):
  - soot plumes, mineral runs;
  - **claw scrapes and mortar trails along the creature's sim paths** (known in advance);
  - chalk tally marks, rope grooves on rings.

**Technique.** `three.md` §2.5, §2.12, §2.13; wet-surface parameters after Lagarde
([fxguide](https://www.fxguide.com/?p=43362)) and [Jensen et al. 1999](https://groups.csail.mit.edu/graphics/pubs/wet_materials_egwr99.pdf).

**Quest cost (derived).**
- +0.3–0.5 ms ALU and fetches, offset by KTX2 bandwidth savings.
- Samples per lit pixel = 6 (the cap).
- +2–4 GL draws (decals).
- World textures ≈ 70 MB resident. Download ≈ 18–22 MB.

**Desktop extras.** Clearcoat on wet stone; box-projected PMREM per section; POM up close.

**Acceptance.**
- **Texel-density lint:** route walls within 3 m ≥ 512 px/m (instance scale × texture resolution).
- **Near-field postcard** (hand on a wall at 0.8 m): Laplacian variance in the wall ROI ≥ 3× baseline.
- **Wet:** a 5-frame lantern sweep (10 cm steps) moves the specular centroid in the wet ROI and not in the dry ROI.
- **Shimmer:** at a static pose with ±2 mm head jitter, temporal luminance std in the wet ROI ≤ threshold, with Toksvig
  on vs off.
- **Decal lint:** every soot decal sits above a lamp; every stain sits below a ledge or drip point.

**Dependencies.** WP03, WP05, WP13 (trims).

**Effort.** 20 h.

---

### WP15 — Atmosphere and particles 2.0

**Goal.** Air you can see:
- lantern-lit motes in depth layers (vista depth comes from motion parallax, `art.md` §2.2);
- light shafts with volume;
- event particulates as causal cues;

all inside the overdraw caps. Today, landing puffs cover 55 % of the screen at ≥ 4 layers (`audit.md` §3).

**Deliverables.**
- `src/render/particles.js` (coordinate with task #8's atmosphere/debris work): GPU-animated instanced quads.
  - Billboards face the **head**, not each eye's view plane, so there is no stereo rivalry.
  - **Analytic soft fade** against the known shaft planes; no depth reads (`three.md` §2.11).
  - Near-eye fade at ≥ 0.5 m.
  - Lantern and volume lighting per particle in the vertex shader.
  - Three systems: ambient motes (type per chapter), event bursts (grit, chips, dust, puffs, embers), drips (streak plus
    splash ring).
- **Light shafts:** analytic cone thickness, scrolling noise, motes inside the beam.
- **Halos:** glow billboards with CPU occlusion raycasts (≤ 8 per second); fresnel shells on the pits.
- **Shaft breath (V18):** fog density and mote drift modulated below 0.2 Hz with the wind bed.
- Landing puffs reworked: small and near-faded.

**Technique.** `three.md` §2.7, §2.11, §2.15; `quest.md` §16.

**Quest cost.** ≤ 4 particle systems (8 GL) + ≤ 7 shaft draws; ≤ 3 k live particles; blended coverage ≤ 25 %; GPU ≤ 0.8 ms
at the worst moment.

**Desktop extras.** Particle caps ×5; true soft particles from a depth texture; bloom on halos.

**Acceptance.**
- **Overdraw probe** (`perf-render` od) at three worst moments: a landing looking down; strike chips near the face; S7
  debris rain.
  - transparent average ≤ 1.5;
  - ≥ 4 layers on ≤ 5 % of the screen;
  - blended coverage ≤ 25 %.
- **Lit motes:** mote luminance vs lantern distance, Spearman ρ ≤ −0.6.
- No particle within 0.5 m of the eye (sampled positions).
- 0 B per-frame allocation.

**Dependencies.** WP05 (WP12 for the volume term).

**Effort.** 14 h.

---

### WP16 — Near field: arms, launchers, rope, lantern, anchors

**Goal.** The player measures the Mason against their own hands, so the near field must look real (body-based scaling,
[Frontiers in VR 2022](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2022.869603/pdf)).

**Deliverables.**
- **Integration acceptance for `player_arms.glb`** (built by task #8's `build_hands.py`: 17-bone arms, launchers as one
  draw each, 2048² baked atlas).
- **Rope v2:** braided normal-map texture (512² KTX2); UV twist along the length; a tension sheen; wet and fray states for
  Chapters III and V.
- **Lantern prop:** world-locked flame card (L8 flicker); glass emissive; a cage whose geometry matches WP05's analytic
  cookie.
- **Anchors v2:** phosphor inlay; rope-groove decals; shape codes kept (CHAPTERS §3.2.6); readable in every palette.

**Quest cost.** Arms and launchers ≈ 4 skinned GL draws, ≈ 20 k tris, ≈ 17 MB textures. Rope +1 fetch. Anchors +0.

**Desktop extras.** The higher arm LOD; shadowed lantern.

**Acceptance.**
- **Lab postcard** (hands at 0.5 m under the lantern): texel density ≥ 1024 px/m (M3); mean chroma within the look (the
  "toy orange" flag clears).
- **Anchor readability** ROI contrast ≥ 1.5:1 in all 9 section looks, at default and darkest brightness.
- **Rope:** a periodic twist signal along the rope ROI.

**Dependencies.** WP03, WP05; task #8.

**Effort.** 12 h.

---

### WP17 — Section look passes S1–S9 (art-directed integration)

**Goal.** Author each section to its look sheet:
- dressing and the hero set piece;
- bake, wetness and particulates;
- the Mason's staging for that section;
- passing postcards.

This is where "art direction first" pays off: every pass is judged against data written in WP01.

**Deliverables per section.**
- Tuned `looks-ch1.js` entry.
- Hand-authored overrides in `ch1-dress.js`.
- A hero-set-piece GLB where listed.
- Volume and hero-lightmap bakes.
- Mason staging data (E17 `creaturePaths`, hold points, director weights).
- Passing postcards.

Specifics per section are in §5.

**Quest cost.** Each section stays within §3.1 at its worst moment: the E29 list plus the §5 postcards.

**Desktop extras.** Desktop postcards per section.

**Acceptance (per section).**
- Postcards pass `lookcheck` and `budgets`.
- Critic ≥ 7/10 for craft and ≥ 7/10 for dread, with **no identity flags**.
- The section's Mason beats pass `fear-sim` and `sync-check`.
- `flash-check` passes in lamp-heavy sections.
- A bot descent passes E28 V14 (Chapter I regression).

**Dependencies.** WP05 and WP08–WP16.

**Effort.** 40 h: S1 3, S2 3, S3 4, S4 5, S5 6, S6 4, S7 7, S8 5, S9 3.

---

### WP18 — Desktop high tier ("Unreal tier")

**Goal.** Honestly meet "like Unreal" where the hardware allows it: desktop browsers (and trailer capture), on the same
assets.

**Deliverables.**
- `src/render/tiers.js`: `quest`, `quest-high` (shadow tier) and `desktop-high`.
- An `EffectComposer` chain: `RenderPass` → `GTAOPass` → `UnrealBloomPass` → SMAA → `LUTPass` (grade from the looks) →
  `OutputPass`. **Bypassed whenever `renderer.xr.isPresenting`**; the in-material grade is skipped by a define so nothing
  is graded twice (`three.md` §6).
- Lantern `PointLight` shadow (PCFSoft, cube 1024²) with creature and prop casters.
- 6–8 env lights.
- Clearcoat on wet stone and flesh.
- Per-section PMREM (box-projected).
- The 130 k creature LOD.
- POM on near masonry.
- Particles ×5.
- Optional raymarched fog volumes in hero rooms.

**Quest cost.** 0 (code-split, never loaded in XR).

**Acceptance.**
- Desktop postcards at tier `desktop-high`: effects detected (bloom energy around emitters, GTAO corner darkening vs the
  quest tier); `lookcheck` bands still within the looks.
- **Mock XR:** entering VR disables the composer (no extra render targets; GL draws equal to the quest tier ±2).
- Desktop GPU timing via `EXT_disjoint_timer_query_webgl2` where a real GPU is available; SwiftShader timing is not
  meaningful.

**Dependencies.** WP05, WP09, WP12, WP14.

**Effort.** 14 h.

---

### WP19 — Quest hardening and multiview spike [DEVICE-gated]

**Goal.** Hold 72 Hz p95 on Quest 3 and 3S for 45 minutes, and take the multiview CPU win if it is real.

**Deliverables.**
- A `super-three@0.181.0` import-map flag (`?mv=1`, re-vendoring the matching `GLTFLoader` and `BufferGeometryUtils`).
  `multiviewStereo: true`, and `'layers'` requested **only** with multiview. On vanilla r170 the Layers path disables
  multisampled render-to-texture and forces an explicit resolve (`quest.md` §8).
- A precompile pass inside the XR session (multiview adds a program variant).
- Lantern lighting offset check: super-three sets lights once per combined camera (`quest.md` §5.2).
- Section LOD tables. Dynamic FFR tuning.
- Streaming: hold the current section ±1; dispose; `renderer.info` back to baseline ±5 % after a chapter swap.
- The env-light 2 → 1 A/B (WP12) and the shadow-tier A/B (WP09).
- A 45-minute thermal soak; Quest 3S check; the Quest 2 decision.

**Quest cost (target).** −25–50 % CPU submission with multiview (Meta's claim for CPU-bound apps; community GPU results
are mixed, `quest.md` §5.1). GPU neutral.

**Acceptance.**
- **Headless:** `?mv=1` boots on desktop and in mock XR (fallback path), with budgets unchanged.
- **[DEVICE]** OVR Metrics at the E29 worst moments and the §5 postcards:
  - GPU p95 ≤ 11.5 ms; CPU main p95 ≤ 8 ms;
  - 72 fps sustained, with no stale-frame bursts;
  - 45-minute soak without throttling below 72.
  - Shadow tier ≤ 0.8 ms or it is off.

**Dependencies.** WP17.

**Effort.** 14 h + ~4 h device sessions.

---

### WP20 — Chapters II–V: art kits and Mason variants

**Goal.** Carry the bible into the four paid chapters with the same pipeline and gates. Built on task #6's chapter
framework (E04, E17–E25).

**Per chapter** (template proven in WP17):
- look sheet and postcards;
- ≤ 3 new texture sets (2048² hero, 1024² bulk);
- kit modules and hero set pieces;
- volume and hero-lightmap bakes;
- chapter VFX;
- the Mason's chapter state (shader) and chapter clips;
- budgets at the E29 worst moments.

| Ch | Look and materials | Chapter tech | Mason state and clips | Postcards | Effort |
|---|---|---|---|---|---|
| **II Lamphold** | honey sandstone, brass, wax, soot; warm grade, saturation 0.65 → 0.5 when snuffed | Lamp-field: ~3,000 instanced quads with a `lit` attribute, 2 draws (E25). Snuff wave L8-ramped. In-the-Walls bulges (V12) | Soot and wax runs; **C1 warm pit flare 0.5 s, then cold**; ember seams for 10 s after a snuff. Clips `snuff_close`, `breach_out`, `wedged` | Lit town · the Snuff | 45 h |
| **III The Mere** | everything wet; silver highlights; black water | Water surface (scrolling normals, fresnel, depth tint, no render targets). Underwater mode (fog swap, low-pass, **flash-safe** caustic flicker) | `wet` = 1: streaming water as vertex drip lines plus particle sheets on emergence. Clips `plunge_dive`, `bell_knock`, `rise_surface` | Rise through the water | 45 h |
| **IV The Keeping** | bone, chalk, ochre; dry and rough; saturation 0.35 | Hooded lantern spot 60° / 16 m; **bone dust lit inside the cone** (the mechanic made visible). Kept figures with a stone-creep shader | Figure-plates prominent. Clips `gather_pull`, `tail_payout` | The Gathering | 40 h |
| **V The Still Flame** | inverted grade (fog lighter than forms; saturation 1.0 → 0.15) | Stillness band (`uStillY`); stilled motes; ≤ 3 beam cones | Stone-pale; per-segment **stone ramp**; shadow as its silhouette. Clips `bow`, `stone_lock`, `come_apart` (segments → falling figure instances), `settle` | Stilled in white | 40 h |

**Quest cost.** Each chapter fits §3.1. New resident textures ≤ 70 MB per chapter. Download ≤ 30 MB per chapter.

**Acceptance (per chapter).**
- All WP02 gates.
- E28 verification gates V1–V15.
- Postcard critic ≥ 7/10.
- The chapter's beats pass `fear-sim` and `sync-check`.
- `flash-check` on the chapter's light events: II snuff waves, III caustics, V Flame ramp.

**Dependencies.** WP17, WP19; task #6's E-extensions.

**Effort.** 170 h.

---

### WP21 — The 10× proof

**Goal.** Show the owner a measured 10×, not a claim.

**Deliverables.**
- A before/after **postcard book** (14 Chapter I + 10 cross-chapter) as a private HTML page, with the §0.1 scorecard
  filled in from gate outputs.
- The critic-panel summary.
- A [DEVICE] blind-preference protocol: ≥ 80 % of testers prefer the new build on every shot (`art.md` §15).
- Trailer frames and store screenshots, captured in the desktop tier and **labelled by tier** (the store must not imply
  desktop effects on Quest).

**Acceptance.** Every gate is green; the scorecard shows each target met.

**Dependencies.** All.

**Effort.** 10 h.

---

## 5. Section-by-section direction (Chapter I, WP17)

Fog, key and accent are the existing `theme()` values. Section sizes are from `level-data-3d.js`. Wet values follow M1.

| § | Size | Emotion and look | Hero set piece and dressing | Bake | The Mason here (beats) | Postcards |
|---|---|---|---|---|---|---|
| **S1 Threshold** | 48 m, 22×22 | Awe. Teal shafts from above, amber lamps; dry (wet 0.10), ash on tops; slow lit dust in shafts | The Threshold arch with **3 lamp-bearing Lanternwright statues** (figure kit), plaque, chains; the far colossus seen through a **window cut in the shaft wall** | volume + hero lightmap (arch) | Absent. A far knock or scrape below, delayed by distance | **P01** Colossus window · **P02** First anchor near field (hands, ring, rope at 0.6 m) |
| **S2 Long Swing** | 50 m, 45×22 | Teal and amber; wet 0.15; chain sway | Long chain run (real links within 15 m), machinery bracket, double arch; **a line of lamps receding** for depth | volume | One far call (distance delay ≈ 0.2 s) | **P03** Mid-swing along the chain run |
| **S3 Broken Gallery** | 40 m | Verdigris accent; wet 0.30, **first drips** with splash rings | Collapsed arcade with a hanging cage and bones; **first ribs grown through masonry** ("its work") | volume | A call; one **grit sift from above** (pre-cue; beat 3 in miniature) | **P04** Through the broken arcade: cage silhouette against the shaft light |
| **S4 Listening Vault** | 52 m, fogFar 170 | Cold teal; sparse motes at many depths (void parallax) | A **100 m+ far wall with blind arcades for scale** (so the Pour reads); catwalk and machinery; Lamphold glow in floor cracks at 10 % | volume + hero lightmap (catwalk) | **The Pour** (#1): LOD2 with a visible leg wave; the crown turns to you mid-path (`roar_display`, muted); scrape delayed by d/343 | **P05** The Pour, framed by the next anchor |
| **S5 Gullet Stair** | 54 m, 18×18 | Ember key, rust accent; wet 0.50; grit sifting from seams | Narrow gullet, 3 ribs, cages, a spiralling stair; walls tagged `hollow` | volume | **In the Walls** (#2) → **Grit Rain** stalking from above (#3) → first **Listen** (#5) → first **Rear** (#8) | **P06** Bulging wall, dust from the seams · **P07** The Rear at 6 m (portal open, lantern-lit) |
| **S6 Two Descents** | 80 m, 44×22 | Rust accent; wet 0.60; drips; frayed rope fibres | **A colonnade of piers along the shaft divide** as occluders for the Leg Forest | volume | **Leg Forest** (#21); **Stone-Still** at the light's edge (#6); Lamp Dip (#4) | **P08** The leg wave through the colonnade gaps |
| **S7 Hollow Nave** | 136 m, 80×80 | Pit-glow key `#b8f0e0`; debris raining off the spire | **The inverted spire** (unique, lightmapped base); nave arcades; colossal scale cues | volume + hero lightmap (spire base) | **The Spiral** (#12), **False Retreat** (#11), **Ceiling Crossing** (#13) | **P09** Spiral pass at 6–8 m · **P10** Nave vista |
| **S8 Last Throat** | 142 m, 40×40 | Warm `#ffd9a0` from below: the **betrayed safety**; ash and debris rain | The **Still Lamp chamber** (warm, lightmapped); the grate | volume + hero lightmap (chamber) | Pursuit from above (#3 into a looming overhead); gate slam | **P11** Looking up at the pursuit through ash · **P12** The Still Lamp chamber |
| **S9 The Mark** | hook (task #6) | Mark Lamp `#f4ead2`; **motes stop** (hush) | The walls are its coils (coil plates match the kit) | volume + hero lightmap | **The Linger** (#7) at 3 m with Lantern Hunger (#18) | **P13** The Linger · **P14** The coil walls, wide |

**Cross-chapter postcards** (WP20): II lit town · II the Snuff · III Rise through the water · IV the Gathering · V Stilled in
white, plus S4 Pour, S5 bulging wall, S7 Spiral and S9 Linger (shared with Chapter I). That makes `art.md` §15's ten
shots.

---

## 6. The rigged Mason: consolidated specification

### 6.1 Armature (canonical bone names; assembled per chapter)

| Group | Bones, Ch I (20 seg, 24 legs) | Bones, Ch V (32 seg, 40 legs) | Driven by |
|---|---|---|---|
| `root` | 1 | 1 | sim head frame |
| `spine_00…spine_{N−1}` | 20 | 32 | **P-SPINE**: one bone per sim spine point (`body.spine`, `body.up`, `body.scale`), plus `breathe_seams` additive on 00–05 |
| `tail_0..1` | 2 | 2 | P-SPRING drag |
| `neck`, `crown` | 2 | 2 | clips + **P-FOCUS** |
| `arch_0..2` (archivolt orders) | 3 | 3 | clips (recede/telescope on open) |
| `comb_{L,R}_{0,1}` (tracery combs) | 4 | 4 | clips (retract into the jambs; never a scissor) |
| `hinge_0..1` (ventral third) | 2 | 2 | clips (asymmetric drop) |
| `gullet_0..2` | 3 | 3 | clips (leaf-scale peristalsis) |
| `pit_0..6` | 7 | 7 | clips + data texture (dilate = leaf scale) |
| `arm_{0..7}_{0,1}` (stone arms) | 16 | 16 | clips + P-FOCUS + P-SPRING |
| `frond_{0..5}_{0,1}` (fiddlehead clusters) | 12 | 12 | clips + shader curl |
| `leg_{id}_{0..3}`, lead legs ×4 bones | 10 × 4 = 40 | 10 × 4 = 40 | sim limbs (`body.limbs[10]`) via analytic IK |
| `leg_{id}_{0..2}`, cosmetic legs ×3 bones | 14 × 3 = 42 | 30 × 3 = 90 | **P-GAIT** metachronal wave |
| Attachments: cage, ladder, bell, `chain_0..3` | 7 | 7 | rigid / P-SPRING |
| **Total joints** | **161** | **221** | ≤ 255 keeps `JOINTS_0` as u8 (`blender.md` B3) |

Rib-leg fringe: no bones; vertex-shader metachronal motion. Visible legs at 60 m ≥ 50.

### 6.2 Skinning strategy

| Part | Weights |
|---|---|
| Stones, iron bands, figure-plates, rings, teeth, combs, arms, grapnels | owner bone = 1.0 |
| Flesh, marrow, discs between vertebrae | `spine_k` / `next` by `t = smoothstep(spine_s)` (`next` is remapped at assembly) |
| Leg strut root flesh | `spine_k` → `leg_0` over the first 20 % of the strut |
| Leg joints with a flesh wrap | 2-bone blend across a 10 cm band only |
| Gum between comb roots, hinge membrane | 2–3 nearest bones by angle + `crown` |
| Strands, hanging chains | owner bone + a `_SWAY` attribute for the vertex shader |

**Rules.**
- ≤ 3 influences authored; linear blend only (glTF has no dual-quaternion; `blender.md` B8).
- Unit-scale bones in the bind pose; taper lives in the mesh. At runtime, uniform per-bone scale follows `body.scale`, as
  today.
- **Twist clamp:** ≤ 25° relative twist between neighbouring spine frames, enforced in the rig, against candy-wrapping.
- **No auto-weights.** Heat-map weighting fails on kitbashed, intersecting geometry (`blender.md` B4).

### 6.3 Clip list (Chapter I: 17 clips; chapter clips in WP20)

Authored at 30 fps, in place; root is never keyed. "Override" clips are masked to the crown/arm/frond subtree unless
stated.

| # | Clip | Length | Layer | Content (the acting) | Events (extras) | Beats |
|---|---|---|---|---|---|---|
| 1 | `crown_idle` | 6.0 s loop | override | archivolts breathe ±2°; combs micro-chatter; fronds slow curl; arms drift | — | crawl, 20 |
| 2 | `listen` | 3.2 s loop | override | crown tilts L 8°, holds, R 6°; **arms open wide and still**; fronds unfurl then freeze; pits dilate in pulses | `pulse@0.4,1.6,2.4` | 5 |
| 3 | `notice_snap` | 0.45 s | override (xfade 0.08 s) | 0.35 s lag (from P-FOCUS), then a snap with 12 % overshoot; arms twitch toward the sound | `snap@0.1` | 5 |
| 4 | `rear_windup` | 0.75 s, **warped** to the sim's 0.5–0.75 s | override + additive on neck and spine 00–03 | **anticipation dip** (crown −0.2 m, 0–15 %); rear articulation over the sim's 1.3 m rear; archivolts recede; combs retract; hinge drops at 60 %; arms flare to a full ring at 85 % | `open@0.6`, `full@0.9` | 8 |
| 5 | `strike` | 0.35 s, warped | override | thrust articulation; the **portal slams shut at contact** | `contact@0.16` (= sim strike) | 9 |
| 6 | `recoil` | 0.6 s | additive | nose-to-tail shiver; comb chatter; arms fold | `clack@0.05` | 10 |
| 7 | `roar_display` | 2.5 s | override | full open with 10 % overshoot; gullet peristalsis; arms raised as if offering; pits flare (≤ 3 Hz) | `open@0.55`, `peak@1.1`, `close@2.1` | 1 (S4), Mark |
| 8 | `linger_breathe` | 3.0 s loop | override | arms sweep slowly in front, **feeling the air before the lantern**; pits inhale; crown micro-tilts | `inhale@0.3,1.8` | 7 |
| 9 | `arms_reach` | 1.4 s | override (arm mask), layered over 8 or 2 | two arms reach toward the lantern, asymmetric | `reach@0.9` | 18 |
| 10 | `arms_close` | 1.1 s | override (arm mask) | arms close like hands around a flame | `closed@0.85` | 19 (II), 24 |
| 11 | `knock_x3` | 2.0 s | override | crown knocks the stone three times, each with anticipation | `knock@0.45,0.95,1.45` | 15 |
| 12 | `breathe_seams` | 5.0 s loop | additive (neck, spine 00–05, gullet) | heave ±3 cm; gullet swell (~0.2 Hz) | `exhale@2.6` | 20 (off in Listen) |
| 13 | `flinch` | 0.5 s | additive | crown recoil; combs clench | — | debris hit, lamp shatter |
| 14 | `retreat_fold` | 1.4 s | additive | neck pull-back; arms fold flat; fronds curl tight | — | 11 |
| 15 | `leg_probe` | 0.8 s | override (leg chain template, retargeted per lead leg by renaming tracks at load) | two feeling taps before planting | `tap@0.25,0.5` | 3, 21 |
| 16 | `leg_scrabble` | 0.4 s loop | additive (leg template) | frantic re-grip tremor | — | 10 |
| 17 | `take_close` | 1.0 s | override | arms close around the view from the edges inward (first-person-safe) | `dark@0.8` | 24 |

**Chapter clips (WP20):** `snuff_close`, `breach_out`, `wedged` (II) · `plunge_dive`, `bell_knock`, `rise_surface` (III) ·
`gather_pull`, `tail_payout` (IV) · `bow`, `stone_lock`, `come_apart`, `settle` (V).

### 6.4 Procedural layers and per-frame order

| Order | Layer | Where | What it does | Off when |
|---|---|---|---|---|
| 1 | Mixer | `masonPerformance` → `AnimationMixer` | override and additive clips, crossfades, time-warps | timescale 0 (freeze) |
| 2 | **P-SPINE** | `masonRig` | spine bones ← sim trail frames (`body.spine`/`up`/`scale`), composed with the additive delta (bind⁻¹ · mixed) | — |
| 3 | **P-FOCUS** | `masonRig` | crown and arms look-at, critically damped (lag 0.3–0.5 s, then a small snap on target switch). Targets: head (breath), noisy hand (rope), lantern (want), decoy (IV horns). Clamped cone | `hide` |
| 4 | **P-GAIT** | `masonGait` | lead legs: IK to sim feet. Cosmetic legs: retrograde metachronal wave with duty factor and lift by speed; `leg_probe` on unknown surfaces; emits `mason:plant` | freeze (legs keep their poses: a raised leg *stays raised*) |
| 5 | **P-SPRING** | `masonRig` | arms sway, chains, strands, tail drag | freeze, hide |
| 6 | **P-TIMESCALE** | `masonRig` + mixer | per-bone time scale: 0 = true freeze (Listen, Hide, Stilled in V) | — |
| 7 | **P-JITTER** | vertex shader | plate shiver (`body.jitter`) and the travelling plate-lift wave (`_PART`, `_spine_s`) | freeze |
| 8 | **P-HIDE** | shader + rig | emissive 0, plates flush to the wall normal | — |
| 9 | **P-WORLD** | renderer, FX | Lamp Dip (L7), wall bulges (≤ 2 travelling points as uniforms), grit emitters at plants | — |
| 10 | **P-NEAR** | material variant | dither fade when < 1 m; nothing < 0.6 m from the eye | — |

Then: `updateMatrixWorld` → bounding sphere ← sim bounds → bone data texture → three runs `skeleton.update()` once per
frame.

### 6.5 Sim payload → rig mapping (existing fields, plus `perf` from WP10)

| Sim field (`creature3d.js`) | Consumed by |
|---|---|
| `body.spine`, `body.up`, `body.scale` (seg × 3) | P-SPINE (one bone each); LOD selection (nearest spine point); bounding sphere |
| `body.head` (frame) | `root` / `crown` base frame |
| `body.focus {x, y, z, amount}` | P-FOCUS target and weight (until `perf.focusKind` exists) |
| `body.limbs[10] {seg, side, hip, foot, planted, lift}` | lead-leg IK targets and swing arcs; `planted` edge → `mason:plant` |
| `body.frondOpen` | `listen` / arms-open blend weight; frond curl |
| `body.glow` | pit emissive (shaped ≤ 3 Hz, L8) |
| `body.lunge` | P-SPINE thrust weight; `strike` time-warp |
| `body.jitter` | P-JITTER amplitude |
| `body.listen` | `listen` weight; P-TIMESCALE legs → 0; bed cut |
| `body.visible`, `hideDistance` | mesh visibility |
| `creature.state` | the performance state machine (§6.6) |
| `creature:attack {windup}` | `rear_windup` warp so `full@` lands at the wind-up end |
| `creature:strike {hit, x, y, z}` | `strike` contact; FX chips; `take_close` if `hit` |
| `body.perf` (WP10) | mode-specific clips and layers (§6.6) |
| E17 additions: `seg`, `stone[]`, `wet`, `plates`, `hidden`, `rings` | assembler (seg, plates), data texture (stone, wet), visibility (hidden) |

### 6.6 Performance state machine

| Sim state / `perf.mode` | Base clip | Additives | Layers | Shader | Audio |
|---|---|---|---|---|---|
| DORMANT / DISTANT (crawl) | `crown_idle` | `breathe_seams` 1.0 | gait normal; focus 0.2 | glow 0.3 | scrape gated by motion |
| OBSERVING | `crown_idle` → `listen` 0.5 | breathe 0.6 | focus on the head, lag 0.4 s | glow 0.5 | low drone |
| Listen (`body.listen`) | `listen` | breathe **0** | **TIMESCALE legs 0; springs off** | pits pulse | **bed cut on the freeze frame**; chitter on the pulses |
| `HIDE` | hold the current pose | none | **all frozen**; plates flush | **emissive 0** | drone at −12 dB (never silent) |
| APPROACHING / PURSUING | `crown_idle` (fast) | breathe 0.3 | gait fast (duty 0.5); focus 1.0 | glow 0.6 | loud scrape; plant clicks |
| BURST | `crown_idle` | P-JITTER 0.55 | gait surge | — | burst |
| ATTACK wind-up | `rear_windup` (warped) | — | focus locked; P-SPINE rear | glow ramps (≤ 3 Hz) | rising grind; clack at `full@` |
| Strike | `strike` | — | P-SPINE thrust | — | **stone clap at `contact@`** |
| RECOVERING | `recoil` → `crown_idle` | `leg_scrabble` | gait high frequency | — | click storm, then quiet |
| `LINGER` | `linger_breathe` + `arms_reach` | — | focus lantern → head | pits inhale | suction; rope haptic hum |
| `FALSE_RETREAT` | `retreat_fold` | — | P-SPINE retract | glow 0 | fade, then 6 s silence (breath and heartbeat stay) |
| `KNOCK_ANSWER` | `knock_x3` | — | — | — | knocks + dust + haptics on the same frame |
| `CEILING` | `crown_idle` | — | inverted gait; arms hang under gravity (springs) | — | overhead pan; rope thrum on touch |
| `RISE` | `roar_display` held at 0.3 | — | P-SPINE climbs | pits fade up from 0 | sub-rumble rising in pitch |

### 6.7 The 24 fear beats: where each lives

Beat definitions are in `art.md` §9.2.

| # | Beat | Sim (WP10 / E17) | Rig and look (WP07–09) | Sync (WP11) | Guard | Ch |
|---|---|---|---|---|---|---|
| 1 | The Pour | `sighting` path | LOD2, low-frequency gait, `roar_display` turn | delay d/343 | — | I |
| 2 | In the Walls | E17 hidden path, `wall:bulge` | P-WORLD bulge | knock on the bulge peak ≤ 50 ms | bulge ≤ 0.25 m; never underfoot | I, II |
| 3 | Grit Rain | PURSUING above | inverted gait | grit 0.5–1 s before the crescendo | cosmetic debris | I |
| 4 | Lamp Dip | head < 15 m from a lamp | P-WORLD L7 | drone envelope | L8 ramps | all |
| 5 | The Listen | `body.listen` | `listen` + `notice_snap`; true freeze | bed cut on the freeze frame | fair telegraph | all |
| 6 | Stone-Still | `HIDE` | P-HIDE | drone −12 dB | never < 2× kill radius | I, IV |
| 7 | The Linger | `LINGER` | `linger_breathe` | suction, rope hum | ≥ 2.5 m on Normal | I (Mark), IV, V |
| 8 | The Rear | ATTACK wind-up | `rear_windup` + plate-lift wave | grind, clack | ≥ 0.35 s | all |
| 9 | The Snap | strike | `strike` + chips | clap ≤ 30 ms after contact | never < 0.6 m from the eye | all |
| 10 | Recoil and Scrabble | RECOVERING | `recoil` + `leg_scrabble` | click storm | — | all |
| 11 | False Retreat | `FALSE_RETREAT` | `retreat_fold` | 6 s silence | audio never lies | I, II |
| 12 | The Spiral | E17 path `spiral-s7` | helix gait | grinds pan behind → front | ≥ 5 m (V7) | I |
| 13 | Ceiling Crossing | `CEILING` | arms hang (springs) | `ropeTouch` thrum | cosmetic touch | I, II |
| 14 | The Rise | `RISE` | slow loom | rising sub-rumble | slow only | III |
| 15 | Knock Answer | `KNOCK_ANSWER` (E10) | `knock_x3` | knock + dust + haptic on the same frame | — | I–IV |
| 16 | Plate Turn | `PLATE_TURN` | per-plate roll wave (procedural) | soft grind per plate | — | IV |
| 17 | The Gather | E17 `gather` | `gather_pull` | grind, settling knock | — | IV |
| 18 | Lantern Hunger | `LANTERN_HUNGER` | P-FOCUS → lantern; `arms_reach` | pit inhale | — | IV, V, Mark |
| 19 | The Snuff | E17 `snuffRadius` | `snuff_close`; C1 flare | pop on the light-off frame | L8 | II |
| 20 | Seam Breath | DISTANT / OBSERVING / RECOVERING | `breathe_seams` + seam puffs | exhale hiss | off in Listen | all |
| 21 | Leg Forest | PURSUING alongside | gait behind occluders | clicks match the wave | gap-pass rate < 3 Hz | I, II |
| 22 | Tail Pay-out | E17 path | LOD by distance along the body | endless grind | — | IV |
| 23 | Stilled | E23 / E17 stillness | P-TIMESCALE per bone; stone ramp | scrape cut per lit segment | lurch ≤ 1 m near the player | V |
| 24 | The Taking | strike `hit` | `take_close` + death fade | heartbeat stops on the fade frame | fade done before < 0.8 m | all |

---

## 7. Risk list

| # | Risk | L | I | Mitigation | Owner WP |
|---|---|---|---|---|---|
| R1 | **No device GPU numbers yet.** The fragment budget may be smaller than allocated | H | H | WP03 baseline first; every cost marked (derived) is rescaled; tiers; dynamic FFR; the env-light 2 → 1 A/B; the shadow tier optional | WP03, WP19 |
| R2 | **Headless keyframing looks stiff;** the Mason is "competent, not terrifying" | M | H | Anticipation, overshoot and phase-offset metrics as gates; procedural layers carry life; an optional 8–16 h human polish on `rear_windup`, `strike`, `roar_display` | WP07 |
| R3 | **r2 identity drift:** tracery combs read as mandibles, fronds as antennae, throat teeth as a worm maw | M | H | WP04 guardrail edits; the "portal, not scissor" animation rule; silhouette and critic gates at 8 m and 60 m | WP04, WP06 |
| R4 | **Modular seams** gap or candy-wrap at bends and twists | M | M | `next`-bone remap; flesh discs; twist clamp ≤ 25°; seam-gap and stretch gates | WP06, WP08 |
| R5 | **Variable segment count vs sim** (E17 changes `seg`; sim and rig disagree) | L | M | One bone per sim spine point; the assembler takes `seg` from chapter data; a lab test at 20/24/32 | WP08 |
| R6 | **Pack size:** Chapter I at ~50–55 MB vs E29's 15 MB | H | M | Decision D3; ETC1S for bulk; RDO UASTC; lazy S4+ tier; the 60 MB core cap respected | WP03 |
| R7 | **CPU contention for bakes** (4 shared cores) | H | M | Volumes in Node (minutes); lightmaps only for 5 hero rooms; bakes scheduled when CPUs are free | WP06, WP12 |
| R8 | **Shader variants and compile hitches** (VRC exempts only fades and loading) | M | H | Uniforms not defines; tiers at session start; `compileAsync` inside XR; the 0-links-during-play gate | WP03, WP05 |
| R9 | **super-three multiview** breaks onBeforeCompile patches or offsets the lantern light per eye | M | M | Flag-gated spike; vanilla budgets are the baseline; lantern term moved to world space if the offset shows | WP19 |
| R10 | **Flash safety:** the 6 Hz wind-up glow, lamps at exactly 3 pairs/s, II snuff waves, III caustics | H | H | L8 rewrite; flash-check gate on every lamp-heavy postcard and every chapter light event | WP05, WP20 |
| R11 | **Overdraw** from particles at the face (55 % of the screen at ≥ 4 layers today) | H | M | Size caps; near-eye fade; the overdraw gate | WP15 |
| R12 | **Concurrent edits** by tasks #2, #6, #8 on `creature3d.js`, `creatureView.js`, `fx.js`, `audio3d.js` | H | M | Contract requests; adapters (the old view kept behind a flag); WP08 lands after E01; FX additions coordinated with #8 | all |
| R13 | **Stale SkinnedMesh bounds** pop the creature out at screen edges | M | M | Bounding sphere set per frame from the sim; containment gate | WP08 |
| R14 | **Quest LCD blacks** turn designed darkness into murk | H | M | Value bands with a B1 floor; dithering; brightness calibration (T12); in-headset review of P05, P07, P11 | WP05, WP17 |
| R15 | **KTX2 quality:** wasm encoder normal-map mode, banding in darks | M | M | SSIM gates; a normal-map test sphere; UASTC for hero albedo in dark sections | WP03, WP14 |
| R16 | **GLTFLoader silently switches to Physical** (clearcoat in Blender materials) | M | M | Asset-gate rejects `KHR_materials_*` in Quest assets | WP02 |
| R17 | **Owner expectation:** "Unreal" seen on Quest | M | H | Two tiers clearly labelled; postcards captured in each tier; the honest framing in §0.1 | WP18, WP21 |
| R18 | **Leg-shadow tier too costly** | M | L | LOD2 proxy, update gating, shadow intensity fade; off if > 0.8 ms; the leg-shadow beat still works through Lamp Dip and grit | WP09, WP19 |
| R19 | **Thermal throttling** in a 45-minute soak | M | H | ≥ 1.5 ms GPU headroom target; dynamic FFR; particle caps scale with frame time | WP19 |
| R20 | **SwiftShader screenshots** differ from Quest's look (no ASTC, different precision) | H | L | Gates are relative (bands, ratios, SSIM to self), not absolute colour; the device review of P01–P14 in WP19/21 | WP02 |

L = likelihood, I = impact (H/M/L).

---

## 8. Dependencies and critical path

```text
WP01 ─► WP02 ─► WP03 ─┬─► WP05 ─┬────────────► WP12 ─► WP13 ─► WP14 ─┐
                      │         │              WP15, WP16 ───────────┤
                      │         └──► (look engine used by both) ─────┤
WP01 ─► WP04 ─► WP06 ─► WP07 ─► WP08 ─► WP09 ──────────────────────────┤
WP01 ─► WP10 (with E01) ──────────────► WP11 ─────────────────────────┤
                                                                      ▼
                                                       WP17 ─► WP19 ─► WP20 ─► WP21
                                                       WP18 (after WP09, WP12, WP14)
```

- **Critical path (Chapter I):** WP01 → WP02 → WP03 → WP04 → WP06 → WP07 → WP08 → WP09 → WP11 → WP17 (S4–S9) → WP19 →
  WP21 ≈ 205 h of sequential agent work.
- **Parallel tracks:** Track W (WP12–WP16, ≈ 104 h) and WP10 (22 h) run beside it. With three agents in parallel,
  Chapter I is about 2–3 calendar weeks of agent time plus device sessions.
- **External gates:** task #2 (r2 export) before WP06; E01 (task #6) before WP10's merge; task #8 (env kit v1, arms)
  before WP13 and WP16.

---

## 9. Decisions needed from the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | **The Mason's identity edits** (WP04): portal retracts rather than scissors; short clustered fronds with no lit tips; add the canon ring of stone arms; teeth only in the throat | Approve. Protects the "no mandibles / antennae, original IP" rule without losing r2's horror |
| D2 | **Raise the triangle contract** from 350 k (stereo) to 450 k unique worst (≈ 900 k stereo); the creature's LOD0 from ART_AUDIO_PLAN's 25 k to 70 k | Approve, with device confirmation in WP19 |
| D3 | **Pack sizes:** Chapter I ≤ 55 MB (S1–S3 core ≤ 25 MB, the rest lazy), chapters II–V ≤ 30 MB each, under the 60 MB core cap | Approve. E29's 15 MB is incompatible with the 10× ask |
| D4 | **Quest shadow tier** (creature-only lantern leg-shadow) | Build it; ship it only if the device A/B shows ≤ 0.8 ms |
| D5 | **Multiview via super-three** (Meta's own IWSDK uses it) | Spike in WP19; adopt only on measured CPU gain and no visual regressions |
| D6 | **Human animation polish** (8–16 h) for `rear_windup`, `strike`, `roar_display` | Recommended: the moments players will remember |
| D7 | **Quest 2** | Not at launch (RELEASE §5 already recommends Quest 3 + 3S) |

---

## 10. Effort summary

| Phase | WPs | Agent-hours | Other |
|---|---|---|---|
| Direction and proof | WP01–WP03 | 42 | 1 h device |
| The Mason | WP04, WP06–WP11 | 137 | ~2 h Blender CPU; 8–16 h optional human animation |
| The world (Chapter I) | WP05, WP12–WP17 | 158 | ~2 h Blender CPU |
| Tiers and hardening | WP18, WP19 | 28 | ~4 h device |
| Proof | WP21 | 10 | device blind panel |
| **Chapter I total** | | **≈ 377** | |
| Chapters II–V | WP20 | 170 | per-chapter bakes ~1 h CPU each |
| **Game total** | | **≈ 547** | |

---

## 11. Sources

**Hardware, platform and API limits**
- Meta, Device optimization comparison (Quest 3: 13.8 ms at 72 Hz, < 200 draw calls, < 1.5 M triangles, GPU ~2.5× Quest 2): https://developers.meta.com/horizon/resources/device-optimization-comparison/
- Meta, Render scale (1680×1760 per eye at 1.0; ≈ 1.2 matches the panel): https://developers.meta.com/horizon/essentials/render-scale
- Meta, WebXR performance best practices (KTX2/Basis; point-light shadows need 6 maps; overdraw): https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
- Meta, WebXR performance workflow (draw-call CPU cost; CPU- vs GPU-bound): https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/
- Meta, Web multiview (`OCULUS_multiview` with MSAA; 25–50 % CPU reduction for CPU-bound apps): https://developers.meta.com/horizon/documentation/web/web-multiview/
- Meta, WebXR fixed foveated rendering: https://developers.meta.com/horizon/documentation/web/webxr-ffr/
- Meta, WebXR frames (`updateTargetFrameRate`): https://developers.meta.com/horizon/documentation/web/webxr-frames/
- Meta blog, Loads, stores, passes and advanced GPU pipelines (resolve cost; tile memory): https://developers.meta.com/vr/blog/loads-stores-passes-and-advanced-gpu-pipelines/
- Meta, VRC.Quest.Performance.1 (≥ 60 fps sustained; 45 min; fades exempt): https://developers.meta.com/horizon/resources/vrc-quest-performance-1/
- Meta, VRC.Quest.Performance.4 (render scale ≥ 85 %, recommended): https://developers.meta.com/horizon/resources/vrc-quest-performance-4/
- Meta, Project Flowerbed WebXR case study (KTX2, instancing, no post resolves): https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/
- Meta, best-practices overview (ISO 9241-391 reference): https://developers.meta.com/horizon/resources/bp-overview/
- three.js issue #20368 (multiview not planned for WebGLRenderer): https://github.com/mrdoob/three.js/issues/20368
- three.js PR #26904 (EffectComposer support in WebXR reverted): https://github.com/mrdoob/three.js/pull/26904
- MDN, KHR_parallel_shader_compile: https://developer.mozilla.org/docs/Web/API/KHR_parallel_shader_compile
- MDN, OVR_multiview2: https://developer.mozilla.org/docs/Web/API/OVR_multiview2
- WebGL2 minimum limits (16 texture units): https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html
- glTF-Blender-IO exporter manual (sampling, actions, extras): https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst
- Sun et al. 2005, analytic single scattering: https://www.cs.columbia.edu/~bosun/sig05.htm
- Code verified locally by the research reports: three@0.170.0 (`WebGLRenderer`, `WebXRManager`, `SkinnedMesh`, `AnimationUtils`, `KTX2Loader`), super-three 0.170.1 / 0.181.0, `@iwsdk/core` 1.0.1, Blender 5.2 glTF exporter 5.2.40 (`quest.md`, `three.md`, `blender.md`).

**Safety and perception**
- W3C, WCAG 2.3.1 three flashes or below threshold: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- Grupe & Nitschke 2013, uncertainty and anticipation in anxiety: https://pmc.ncbi.nlm.nih.gov/articles/PMC4276319/
- Proxemic threat and physiology in VR (arXiv 2508.10586): https://arxiv.org/abs/2508.10586
- BMC Biology 2020, looming speed and defensive behaviour: https://bmcbiol.biomedcentral.com/articles/10.1186/s12915-020-00825-0
- Kanai & Kamitani, Troxler fading: https://bicr.atr.jp/~kmtn/pdf/KanaiKamitaniJCogNeuroPre.pdf
- Langton, Watt & Bruce 2000, head orientation as an attention cue: https://storre.stir.ac.uk/bitstream/1893/21045/1/LangtonWattBruce_2000.pdf
- Diaz et al. 2023 (JEB), centipede locomotion, body–leg phase: https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf
- Maempel 2011, reporting Dixon & Spitz audio–video sync thresholds: https://www.simpk.de/fileadmin/user_upload_sim/Dokumente/Forschung/Themen/Abteilung_III/Publikationen/Heide_Maempel_2011_Die_Wahrnehmung_audiovisueller_Synchronitaet_in_elektronischen_Medien.pdf
- Cole & Wilkins 2013, fear of holes: https://repository.essex.ac.uk/7734/
- Frontiers in VR 2022, body-based scaling: https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2022.869603/pdf
- Game Developer, the AI of Alien: Isolation (pacing principle only): https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation
- fxguide on Lagarde's wet surfaces: https://www.fxguide.com/?p=43362 ; Jensen et al. 1999, Rendering of Wet Materials: https://groups.csail.mit.edu/graphics/pubs/wet_materials_egwr99.pdf

**Project inputs** (read, not edited)
- `plans/research/{quest,three,blender,art,audit}.md`
- `docs/abyssal-tether-3d/{CHAPTERS,ENGINE_EXTENSIONS,ART_AUDIO_PLAN,RELEASE,vrc-checklist}.md`
- `public/abyssal-tether-3d/src/{sim/creature3d.js, render/*, data/level-data-3d.js, game.js}`
- `tools/abyssal-tether-3d/{build_env_kit.py, build_hands.py, build_mason.py, README.md}`
- `scratchpad/mason2/final/build_r2.py` (r2 header, `export_game`), `r2/stats.json`, `r2/export.log`
- `scratchpad/3d/{e2e/e2e.cjs, review-perf/*, level/*}`
- Section inventory script used for §5: `plans/scripts/sec_inventory2.mjs`
