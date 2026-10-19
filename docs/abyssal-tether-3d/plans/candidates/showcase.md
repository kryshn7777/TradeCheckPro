# ABYSSAL TETHER 3D: overhaul plan, store page first

*This is one of several independent overhaul plans, written 2026-10-19. The angle is **what sells the $9.99 unlock**:
trailer moments, the creature, hero vistas, and a desktop "Ultra" capture tier. Quest 3 has to hold 72 fps throughout.*

*It builds on the five research reports in `plans/research/` (`quest.md`, `three.md`, `blender.md`, `art.md`,
`audit.md`) and on the project docs (`RELEASE.md`, `CHAPTERS.md`, `ART_AUDIO_PLAN.md`, `ENGINE_EXTENSIONS.md`).
Report sections are cited as, for example, "quest.md §15". Nothing under `/home/user/TradeCheckPro` was edited. No
Blender renders and no Chromium were run.*

**How to read the numbers.**
- Device numbers marked **(est.)** are model-based estimates, good to about ±2×. They hold only until WP0's on-device
  baseline exists.
- Meta's developer pages could not be fetched from this sandbox (DNS refusal). Meta figures were read through search
  extracts and are linked so they can be re-checked.
- An **agent-hour** is one agent session-hour of focused work, excluding Blender or encoder CPU wall time, which is
  listed separately.

---

## 0. Summary

### 0.1 The thesis

People pay $9.99 after seeing three things:

1. **The free demo's first and last minute.** The waking opening, and the end card hanging over the lit pit of
   Lamphold. This is where the purchase button lives (CHAPTERS §5.4, §5.6).
2. **The store page.** Cover and hero art, at least 3 screenshots, and a 30–60 s trailer (RELEASE §13).
3. **Word of mouth.** In practice that means one clip of the Mason doing something nobody has seen a VR monster do.

So this plan spends art budget in **frame order of commercial value**. The Mason comes first, then the twelve "money
frames" (§1.2), then everything else. Every work package's acceptance test renders those frames.

### 0.2 What "10×" honestly means here

Quest 3 is a mobile tile-based GPU (Adreno 740-class, about 1.7–1.8 TFLOPS (derived), quest.md §1). It draws about
5.9 Mpx per stereo frame at 72 Hz. Per-pixel shader cost **cannot** grow 10× (quest.md §4).

On Quest, "10×" comes from content and art direction:

| Lever | Today | Target |
|---|---|---|
| Visible triangles | 17–82 k per eye | 150–380 k |
| Texel density | ~64 px/m on route walls | ≥ 512 px/m, at equal or lower VRAM via KTX2 |
| Lamps that light the world | 2 dynamic | all 13 baked, plus in-scattered halos |
| Creature | 5 k-triangle rigid kit, 65 weight-1 bones, 0 clips | 70 k-triangle continuously skinned body, ~210 bones, 24 authored clips, 7 procedural layers, 16 fear beats |
| Creature-linked FX | 1 (debris on burst) | 12 |

On **desktop Ultra** the game can honestly look "like Unreal": real shadows, GTAO, bloom, reflections, 130 k creature,
supersampled capture. **Ultra footage is never presented as Quest footage** (§1.4).

### 0.3 Ordered work packages

| # | Work package | Agent-h | Needs | Unlocks |
|---|---|---|---|---|
| **WP0** | Baseline, money-frame shot list, budget harness, multiview spike build | 12 | — | everything (measurement) |
| **WP1** | Compression and asset pipeline (KTX2, meshopt, vendoring, ledgers) | 14 | WP0 | every new asset |
| **WP2** | Look core: HDR fog + analytic in-scatter, AgX grade, dither, lantern cookie, flicker-safety fix | 16 | WP0 | every frame |
| **WP3** | Mason rig build in Blender (rest pose, ~210 bones, ownership weights, Quest and Ultra LODs, 24 clips) | 32 | design lock, WP1 | WP4 |
| **WP4** | Mason runtime: `MasonRigView` (clips + 7 procedural layers on the existing sim payload) | 30 | WP3, WP2 | WP5 |
| **WP5** | Fear behaviours and creature FX (freeze, linger, lamp dip, grit rain, snap and chips, rise, kill iris) | 24 | WP4 | **MS-A** |
| **WP6** | Hero vistas: kit v1 + lightmap bake pipeline; S7, S1, S4, S9 and the end-card seam vista | 44 | WP1, WP2 | MS-B |
| **WP7** | Near field: gauntlets, lantern, rope, anchors (in 100 % of frames) | 18 | WP1, WP2 | MS-B |
| **WP8** | Quality tiers + desktop High/Ultra (post stack, shadows, PMREM, POM, Ultra creature) | 26 | WP2, WP4, WP6 | WP9 |
| **WP9** | Capture Director: deterministic replay, photo mode, supersampled trailer renders, provenance manifest | 22 | WP0, WP8, WP5 | **MS-B**, WP13 |
| **WP10** | Chapter I rollout: S2, S3, S5, S6, S8, wetness, decals, story props, ambient FX v2 | 40 | WP6 | MS-C |
| **WP11** | Front door and demo funnel: menu vista, waking minute, end-card staging | 12 | WP5, WP6, WP7, WP9 | MS-C |
| **WP12** | Performance hardening: multiview decision, dynamic FFR, LOD, `compileAsync`, memory; continuous gate | 18 | WP0 (runs alongside) | every milestone |
| **WP13a** | Demo store page assets: device screenshots, key art, covers, 30 s teaser | 14 | WP9, WP11 | **MS-C (demo store-ready)** |
| **WP14** | Chapters II–V art packs, trailer shot first (4 × 36 h) | 144 | WP10 + engine chapters (E04, E25) | MS-D |
| **WP13b** | Full 60 s trailer and final screenshots | 8 | WP14 | launch |
| | **Total** | **≈ 474** | | |

**Milestones the owner sees:**
- **MS-A, "Creature reveal slice".** WP0–WP5 plus S7 from WP6, at about 150 agent-h. The rigged Mason in a dressed
  Hollow Nave in both tiers: 3 screenshots, 1 trailer beat, and a Quest device check.
- **MS-B, "Demo hero frames".** About 256 agent-h cumulative (WP0–WP9 plus WP12): all twelve money frames at final quality and Ultra capture
  working.
- **MS-C, "Demo store-ready".** About 322 agent-h: the whole of Chapter I at the hero standard and the demo store page
  assets.
- **MS-D, "Full descent".** Chapters II–V art and the full trailer.

**Parallel tracks.** These cut calendar time:

| Track | Packages |
|---|---|
| Blender | WP3 → WP6 kit → WP10 bakes |
| Runtime | WP2 → WP4 → WP5 → WP8 → WP9 |
| Near-field | WP7 |
| Perf | WP12 |

Blender runs are scheduled when the shared CPUs are free (§8 R8).

### 0.4 Decisions needed from the owner (details in §9)

1. **Store honesty policy.** The Quest store listing uses only Quest-tier footage; Ultra goes to web, press and desktop
   channels.
2. **Demo pack budget.** Raise from 15 MB (E29) to ≤ 45 MB.
3. **Maw design lock.** The r2 "tracery fang" portal-maw, or the art bible's toothless stone iris.
4. **Multiview fork.** Adopt `super-three` only if WP0's spike shows a measured win.
5. **Animation polish.** Budget a short human Blender pass on `strike`, `rear_windup` and `roar`.

---

## 1. What sells the unlock: funnel, money frames, honesty rules

### 1.1 The funnel and where graphics pay

| Funnel stage | What the buyer sees | Graphics that decide it | Plan coverage |
|---|---|---|---|
| Store browse | Cover (2560×1440, 1440², 1008×1440), hero 3000×900, mini 1080×360 | One striking, gore-free image. Key art is judged most strictly ([Meta store marketing materials](https://developers.meta.com/vr/resources/store-marketing-materials/)) | WP8 (Ultra), WP9 (photo mode), WP13a |
| Store page | ≥ 3 screenshots (2560×1440), trailer 30 s–2 min, 16:9, no black bars ([VRC.Quest.Asset.7](https://developers.meta.com/horizon/resources/vrc-quest-asset-7/)). Screenshots must be representative and carry no added text or logos; captures from Quest 3 should say so ([VRC.Quest.Asset.10](https://developers.meta.com/horizon/resources/vrc-quest-asset-10/)) | The Mason in lantern light; one vista; hands and rope in frame for scale. Shoppers often skip trailers and judge by screenshots; trailers should open on gameplay, not logos ([GameDiscoverCo](https://newsletter.gamediscover.co/p/game-trailers-breaking-down-a-key), [Game Developer](https://www.gamedeveloper.com/business/the-simplest-trailer-to-make-for-your-steam-page)) | WP4–WP7, WP9, WP13 |
| Demo minute 0–1 | Menu vista, then darkness, then a lantern kindles at the Threshold | Fog, lit air, the colossus window | WP2, WP6 (S1), WP11 |
| Demo minutes 1–25 | Chapter I | No section noticeably below the trailer | WP10 |
| The purchase moment | THE MARK: the crown 3 m away, then hanging over thousands of lamps; the end card at the swing's apex | The best frame in the demo | WP5 (Linger), WP6 (seam vista), WP11 |
| Word of mouth | A clip: "it stopped and *listened* to me", "it was in the walls" | Fear behaviours, not polygons (art.md §0.2) | WP5 |

### 1.2 The money frames: a fixed, reproducible shot list

These are data in `tools/abyssal-tether-3d/showcase/shots.json`, created in WP0. Every work package renders them
before and after. Each entry has:
- player head and hands pose;
- section clock;
- creature stage: a scripted pose or a seeded sim run of N seconds;
- tiers;
- a `money` tag (cover, screenshot, trailer, funnel or quality).

| ID | Frame | Money tag | Primary WPs |
|---|---|---|---|
| SH01 | **Menu:** the Threshold window with the Outer Dark colossus, shaft breath | cover background, funnel | WP6, WP11 |
| SH02 | **Waking:** the lantern kindles on your gauntlet, the Threshold lamp flares | trailer opener | WP2, WP7, WP11 |
| SH03 | **First swing:** S1 to S2, colossus through the east window | trailer #1 | WP6 |
| SH04 | **The Pour:** S4 Vault, the Mason crossing the far wall at 60–170 m, leg wave, Lamphold glow in the floor cracks | screenshot, trailer | WP4, WP5, WP6 |
| SH05 | **In the walls:** S5 panels bulging beside you, dust from the seams | trailer | WP5, WP10 |
| SH06 | **The Listen:** S5, crown reared at 8–10 m, frozen, arms open, pits dilating | **screenshot (creature)** | WP4, WP5 |
| SH07 | **The Rear:** S5/S7, wind-up at 4 m, iris open onto the lit throat | **screenshot / thumbnail (creature)** | WP3, WP4, WP5 |
| SH08 | **The Spiral:** S7, the crown passing the spire face 6–8 m away, debris through your lantern light | **trailer #2**, screenshot | WP5, WP6 |
| SH09 | **The Nave:** S7 wide vista, rope taut, lamps far below | screenshot (vista) | WP6 |
| SH10 | **The Last Throat:** S8 grit rain, legs planting overhead, dark on haze | trailer | WP5, WP10 |
| SH11 | **The Kneeling One stands:** S9, the lamp swings back | trailer #3, **key-art basis** | WP6, WP7 |
| SH12 | **The Linger:** S9, the crown 3 m from the Mark Lamp in your hand | trailer, screenshot | WP5 |
| SH13 | **The end card:** chandelier apex over the Lamphold pit of lamps | funnel (purchase) | WP6, WP11 |
| SH14 | **Hands on ring:** near-field quality ruler | quality | WP7 |
| SH20–24 | II Snuffing ring · III crown sinking into black water · IV Kept held in the cone · V walking in its shadow through the Halo · V the Stilling climb | trailer #4–11 | WP14 |

### 1.3 Capture provenance (Meta asset rules)

- **Store screenshots and Quest store trailer footage.** Use either:
  - on-device capture of the Quest tier, labelled "Captured on Meta Quest 3" ([VRC.Quest.Asset.10](https://developers.meta.com/horizon/resources/vrc-quest-asset-10/)); or
  - the **`quest-faithful`** Director profile (WP9): identical Quest-tier shaders, assets and lights, with only
    resolution, anti-aliasing and head-path smoothing changed. WP9 proves this with an SSIM test against the real-time
    Quest-tier render.

  Meta's recommended in-headset capture is 1920×1080 at a variable 36 fps and 20 Mbps
  ([Meta: capture VR apps for publishing](https://developers.meta.com/horizon/resources/video-capture-mr-vr/);
  [MQDH media](https://developers.meta.com/horizon/documentation/unity/ts-mqdh-media/)). That is below the
  2560×1440 screenshot size in RELEASE §13. Whether MQDH can capture higher is open (§9).
- **Key art and covers.** These may use the dev-only desktop photo mode on the same scenes, which ART_AUDIO_PLAN §8
  already sanctions. They follow the gore rules: no flesh close-ups, no wounds (RELEASE §13).
- **Ultra footage.** Goes to the website, press kit and any desktop/PC listing, marked "PC". It never goes into the Quest
  store's screenshots or trailer.
- **Manifest.** `capture/manifest.json` records the profile, build hash and device for every published asset. WP13
  validates it.

### 1.4 Why the strict line

Store reviewers judge assets ([asset guidelines](https://developers.meta.com/horizon/resources/asset-guidelines/)).
Buyers who see Ultra bloom and shadows and then get the Quest look refund and review badly. Being honest is also a
sales tactic: the Quest tier in this plan is strong enough to sell on its own.

---

## 2. Tiers: one content set, five renderers

| Feature | **Q3-Base** (Quest 3/3S, default) | **Q3-Sharp** (opt-in after device proof) | **Q2** (only if listed) | **Desktop High** | **Desktop Ultra** / **Capture** |
|---|---|---|---|---|---|
| Resolution | XR scale 1.0, never < 0.85 (quest.md §7) | XR scale 1.1–1.2 | 0.85–0.9 | DPR ≤ 2 | DPR 2 / offline 2560×1440–3840×2160 with 16–64× accumulated SSAA |
| Refresh | `updateTargetFrameRate(72)` | 72 | 72 | vsync | offline (frame-stepped) |
| AA | 4× MSAA (base layer) | 4× MSAA | 4× | 4× MSAA RT | MSAA + accumulation |
| Foveation | dynamic 0.66↔1.0 | same | 1.0 | — | — |
| Dynamic lights | lantern + 2 env (fixed count) | same | lantern + 1 | lantern + 6 | lantern + 6 |
| Baked lighting | lightmaps + AO (UV1), SH probe for dynamics | same | same (1K maps) | same | same |
| Fog | HDR fog + analytic in-scatter (3 lights), height pooling, noise density, fog dome | same | in-scatter lantern only | same | + raymarched shaft volumes (16 steps) |
| Grade | AgX + lift/gamma/gain + split-tone in material shader, dither, grain | same | same | same | same grade code as a post pass; + film grain pass |
| Shadows | none (contact/blob + lantern cookie + baked) | none | none | creature-only spot, 1024², BasicShadowMap | lantern point shadow PCFSoft 1024 cube + creature spot |
| AO | baked | baked | baked | baked | baked + GTAO |
| Bloom | glow cards, in-scatter halos, over-bright emissive into AgX | same | same | same | + UnrealBloom |
| Reflections | none (wet lantern specular only) | PMREM on metal/wet masks only, if headroom | none | PMREM box-projected | PMREM broad + clearcoat on wet stone |
| Creature | LOD0 ≤ 70 k, 2 draws, custom wet lobe | same | LOD1 as LOD0 | LOD0 70 k | **LOD0 130 k**, `MeshPhysicalMaterial` clearcoat, casts shadows |
| Surfaces | trims, tileables, wet/drip mask | same | 1K | same | + near POM on masonry |
| Particles | ≤ 4 draws, ≤ 3 k live, ≤ 25 % blended coverage | same | half | 8 draws / 10 k | 8 draws / 20 k |

**Tier rules:**
- Tiers switch **only at load or in the menu**, behind a fade. Light counts and shadow flags change program keys
  (three.md §2.18 pitfalls).
- Ultra code is dynamically imported and **never loaded while `renderer.xr.isPresenting`**.

---

## 3. Performance budget

### 3.1 Quest 3 at 72 Hz, r170 (no multiview), worst set-piece moment

Units:
- **GL draws** are what `renderer.info.render.calls` reports in XR, so both eyes are counted.
- **Triangles** are visible scene triangles per eye; three submits them twice.
- **ΔGPU** is the change against today's build (est.).

| Subsystem | Objects | GL draws | Tris / eye | ΔGPU ms (est.) | CPU ms (est.) | Resident MB |
|---|---|---|---|---|---|---|
| Static section art (current section + neighbour, merged per bucket) | ≤ 8 | ≤ 16 | 150–250 k | +0.2 to +0.6 (geometry) +0.1 to +0.3 (lightmap) | 0.2 | lightmaps ≤ 27; trims and tileables ≤ 90 |
| Dynamic level (anchors, hazards, crumble, movers, glyphs, plaques) | ≤ 14 | ≤ 28 | ≤ 15 k | 0 | 0.3 | 4 |
| Far HLOD, fog cards, fog dome | ≤ 4 | ≤ 8 | ≤ 10 k | +0.1 to +0.2 | — | 2 |
| **The Mason** (2 skinned meshes, LOD0) | 2 | 4 | ≤ 70 k | +0.3 to +1.0 (≤ 1.5 in a face-filling lunge burst) | ≤ 1.0 (mixer, 210 bones, 32 IK, springs) | 24 textures + 6 geometry |
| Hands, lantern, 2 ropes | 5 | 10 | ≤ 20 k | +0.1 to +0.2 | 0.2 | 4 |
| Particles (motes, bursts, grit, drips, debris) | ≤ 4 | ≤ 8 | ≤ 6 k | +0.2 to +0.6 (overdraw-capped) | 0.1 | 1 |
| Shafts and lamp halos | ≤ 3 | ≤ 6 | ≤ 2 k | +0.1 to +0.3 | 0.05 | 0.5 |
| Decals (soot, rust, scrapes, strike cracks) | ≤ 2 | ≤ 4 | ≤ 5 k | +0.05 to +0.1 | — | 4 |
| Atmosphere and grade (all lit pixels) | — | — | — | +0.3 to +0.6 | — | 0.2 |
| Wet and drip mask (route walls) | — | — | — | +0.15 to +0.3 | — | 0.3 |
| UI, wrist, panels | ≤ 4 | ≤ 8 | ≤ 2 k | ~0 | 0.1 | 2 |
| **Totals** | **≤ 46 typical, ≤ 70 peak** | **≤ 92 typical, ≤ 140 peak** (contract ≤ 150) | **≤ 300 k typical, ≤ 400 k peak** | **+1.6 to +4.5** | **sim ≤ 2.5 (E29) + view ≤ 1.9** | **textures ≤ 200 of the 300 cap** |
| Offsets | | | | KTX2 bandwidth **−0.3 to −1.0**; baked light allows ENV_LIGHTS 2→1 in baked sections **0 to −0.8** (device A/B) | | |
| **Net** | | | | **+0.5 to +4.2** | | |

**Gates:**

| Measure | Gate | Source |
|---|---|---|
| GPU p95 | ≤ 11.5 ms | quest.md §2 |
| Main-thread JS p95 | ≤ 8 ms | quest.md §2 |
| Unique programs per chapter | ≤ 24 | quest.md §11 |
| Blended screen coverage | ≤ 25 %, ≤ 3 layers deep | quest.md §4 |
| Opaque overdraw | ≤ 1.5× average | quest.md §4 |
| Texture samples per lit world pixel | ≤ 6: albedo, normal, ORM, lightmap (AO in A), wet/drip streak, fog noise | quest.md §19 |
| JS heap | ≤ 256 MB, 0 B/frame steady | quest.md §10 |
| Sustained frame rate | ≥ 72 fps for 45 min ([VRC.Quest.Performance.1](https://developers.meta.com/horizon/resources/vrc-quest-performance-1/)) | — |

**If the measured baseline GPU time is above about 7 ms**, the net delta does not fit. WP12 applies this cut list in
order:
1. particle density;
2. env-light in-scatter (keep the lantern's);
3. ENV_LIGHTS 2→1 everywhere;
4. creature LOD0 distance 25→15 m;
5. wet mask only within 8 m of the route;
6. FFR pinned at 1.0;
7. framebuffer scale 0.9 (last resort; never below 0.85).

### 3.2 Downloads and memory (proposed; supersedes E29's 15 MB demo pack, decision §9)

| Pack | Content | Budget |
|---|---|---|
| Boot | Menu vista, Threshold, UI, transcoder (KTX2 subtotal 292 KB gz, three.md §5) | ≤ 8 MB |
| Demo (Ch I + shared) | Trims and tileables (ETC1S albedo, UASTC+RDO normals), 8 lightmaps, Quest creature GLB + atlases, gauntlets, FX atlases | **≤ 45 MB** |
| Each of Ch II–V | 2–3 new texture sets, kit additions, lightmaps, creature chapter variant (geometry only; atlases shared) | ≤ 25 MB |
| Desktop Ultra pack | Ultra creature LOD0, 4K detail textures, post shaders | ≤ 60 MB, **never fetched on Quest** |
| **Quest total** | | **≤ 145 MB** (quest.md §10: ≤ 150 MB) |

### 3.3 Desktop budgets (est.)

| Tier | Target | Draws | Tris | Heavy items |
|---|---|---|---|---|
| High | 1440p60 on GTX 1660 / RTX 3060-class | ≤ 400 | ≤ 1.5 M | creature spot shadow ~0.5–1 ms |
| Ultra (real-time) | 1440p60 on RTX 3070-class, 4K30 | ≤ 600 | ≤ 3 M | GTAO 1.5–2.5 ms; bloom 0.5–1; point shadow (6 passes) 1–2; SMAA/MSAA resolve 0.5 |
| Capture | offline, no real-time target | — | — | 16–64 accumulated sub-samples per frame |

---

## 4. Work packages

Each package lists: **Goal · Deliverables · Technique · Quest cost · Desktop extras · Acceptance (headless) ·
Dependencies · Effort**.

**Shared verifier.** WP0 promotes the existing harness (`scratchpad/3d/e2e/e2e.cjs`, `review-perf/lib.cjs`, the level
bot, and `xr-mock.js`) into the repo at `tools/abyssal-tether-3d/verify/`, as ENGINE_EXTENSIONS E28 already plans.
Every "headless" check below runs there:
- Chromium + SwiftShader + mock WebXR, so stereo counts are real.
- SwiftShader timings are **relative only**. GPU milliseconds come only from device gates run by the owner with OVR
  Metrics.

---

### WP0: Baseline, money-frame shot list, budget harness, multiview spike build

**Goal.** Make "10×" measurable and protect 72 fps *before* any art spend. Record today's twelve money frames as the
"before" set.

**Deliverables**
- **Shot data and budgets.**
  - `tools/abyssal-tether-3d/showcase/shots.json`: §1.2 frames as data.
  - `tools/abyssal-tether-3d/showcase/budgets.json`: §3 as data.
- **`tools/abyssal-tether-3d/showcase/verify-showcase.mjs`.**
  - Stages each shot, renders it per tier (Quest tier in mock-XR stereo at half resolution per eye; desktop at
    1280×720), and writes PNGs.
  - Writes `out/showcase-<tier>.json` with `renderer.info` (calls, triangles, programs, geometries, textures), a texture
    byte ledger by format, creature `info`, and SwiftShader relative frame time.
  - Fails on any budget breach.
- **`tools/abyssal-tether-3d/showcase/imgmetrics.mjs`.** Image metrics:
  - value-band histogram B0–B4 (art.md §5.2);
  - near-field **detail energy** (Laplacian variance inside a hand, wall or creature mask from an ID render);
  - **banding index** (runs of 1-LSB steps in fog gradients);
  - silhouette mask stats (perimeter²/area, protrusion count).
- **Debug API additions** (requested from the `game.js` owner; dev builds only):
  - `AT3D.debug.stage(shot)`: player pose, head and hand override, section clock, creature placement or seeded run,
    freeze;
  - `AT3D.debug.quality(tier)`;
  - `AT3D.debug.renderInfo()`;
  - `AT3D.debug.creaturePose(clip, t)`.
- **`renderer3d.js` changes** (request to the render owner):
  - `session.updateTargetFrameRate(72)` (RELEASE T4);
  - a render-path probe logged into `perfDiag`: base layer type, ASTC, ETC, `OCULUS_multiview`, `WEBGL_multi_draw`,
    `KHR_parallel_shader_compile`, `WEBGL_multisampled_render_to_texture`, `supportedFrameRates`.
- **Multiview spike build** behind `?mv=1`:
  - import map → `super-three@0.181.0` with `multiviewStereo: true` and `'layers'`;
  - matching GLTFLoader and BufferGeometryUtils re-vendored from the same package (quest.md §5.2).
  - The owner A/Bs it on device.
- **`docs/.../DEVICE_PROTOCOL.md`.** The owner's 20-minute checklist: OVR Metrics GPU and CPU p95 at SH03, SH06, SH08,
  SH09, SH13, plus the draw-call sweep and fill sweep from quest.md §21.

**Technique.** Deterministic staging through the debug API. Counts and images are headless; milliseconds come from the
device.

**Quest cost.** 0. Dev-only code is stripped from store builds. Requesting 72 Hz explicitly removes the risk of being
judged at 90 Hz (quest.md §17).

**Desktop extras.** —

**Acceptance (headless)**
1. `verify-showcase --tier quest,desktop --shots all` runs green on today's build and writes 14 "before" PNGs per tier.
2. Reported counts match the audit within ±10 %: 38–66 GL draws, ≤ 163 k triangles per stereo frame (audit §3).
3. `budgets.json` is enforced: a deliberately inflated test scene fails with a readable message.
4. `plans/scripts/flicker_check.mjs` runs in CI and reports the current 3 pairs/s (expected to fail until WP2; recorded
   as baseline).
5. The spike build boots in mock XR (functional only; there is no multiview in SwiftShader).

**Dependencies.** None. **Effort.** 12 h.

---

### WP1: Compression and asset pipeline

**Goal.** 4× texels at ≤ today's VRAM, and one pipeline every later asset goes through.

**Deliverables**
- **Vendor from `three@0.170.0`** into `vendor/three/addons/` (three.md §5):
  - `loaders/KTX2Loader.js`, `utils/WorkerPool.js`, `libs/ktx-parse.module.js`, `libs/zstddec.module.js`,
    `math/ColorSpaces.js`;
  - `libs/basis/basis_transcoder.{js,wasm}`, `libs/meshopt_decoder.module.js`;
  - `utils/SkeletonUtils.js`, `geometries/DecalGeometry.js`.
- **`tools/abyssal-tether-3d/post.mjs`.**
  - `@gltf-transform` 4.5.1 + `ktx2-encoder` 0.6.0 + `meshoptimizer` (blender.md §2, A7).
  - Per-class passes:
    - albedo and emissive: ETC1S q192, sRGB;
    - normals: UASTC + RDO + Zstd, linear, normal mode;
    - ORM: UASTC + Zstd (hero assets) or ETC1S (bulk rock).
  - `prune({keepAttributes: true, keepExtras: true})`, so `uv1`, `_spine_s` and the other custom attributes survive.
  - **No gltfpack**: it drops unused attributes (blender.md §0.2).
- **`tools/abyssal-tether-3d/encode_textures.mjs`** + manifest v2 (`format: "ktx2"`, size, class, bytes).
  `build_textures.py` re-bakes the 5 sets at **2048²**. Roughness is widened by local normal variance (Toksvig at mip 0)
  so wet specular does not sparkle in stereo (three.md §2.13). A custom mip chain is a stretch goal, since `ktx2-encoder`
  mip injection is unverified.
- **Runtime.**
  - `materials.js` loads `.ktx2` through `KTX2Loader.detectSupport(renderer)` and falls back to JPEG.
  - GLTFLoader gets `setKTX2Loader` and `setMeshoptDecoder` for every GLB.
- **`tools/abyssal-tether-3d/asset_budget.mjs`.** Per-pack download MB and estimated GPU MB by transcode target (ASTC
  4×4 = 1 B/px, ETC1 = 0.5 B/px, plus 33 % for mips). Fails over §3.2.
- **PWA precache** update (`gen-precache.mjs`): demo files and the lazy chapter tiers.

**Technique.** Basis Universal → ASTC 4×4 or ETC2 on Quest, BC7 on desktop. Meshopt with quantized attributes, which
also cuts vertex fetch under stereo (three.md §2.14).

**Quest cost.**

| Item | Today | After WP1 |
|---|---|---|
| Draws, triangles | — | 0 change |
| GPU | — | **−0.3 to −1.0 ms** (est., bandwidth) |
| VRAM, 5 sets | ≈ 84 MB (1K RGBA8) | ≈ 70 MB at **2K** |
| Download | — | +292 KB gz transcoder |

**Desktop extras.** BC7 transcode automatically. Desktop High and Ultra may opt into 4K detail maps from the Ultra pack.

**Acceptance (headless)**
1. `npx gltf-transform validate` is clean on every GLB. A KTX2 header check confirms supercompression, transfer
   function (sRGB = 2 / linear = 1) and a full mip chain.
2. Encoding quality: a re-encode of today's 1K sets renders SH03 and SH09 with SSIM ≥ 0.95 against the JPEG baseline
   (same scene).
3. With the 2K swap, near-field detail energy at SH09 and SH14 is ≥ 1.8× baseline. Draw and triangle counts are
   unchanged (±0).
4. The ledger reports ≤ 75 MB GPU for the 5 sets. All world textures report `isCompressedTexture` in the desktop run.
5. e2e descent is green with zero console errors.
6. Device: the owner confirms ASTC and ETC2 transcode targets in the WP0 probe log.

**Dependencies.** WP0. **Effort.** 14 h (+ ~10 min encoder CPU).

---

### WP2: Look core (atmosphere, light and grade in every frame)

**Goal.** The largest perceived jump per millisecond, and one cinematic grade shared by Quest and desktop. Every trailer
frame benefits.

**Deliverables**
- **`src/render/atmosphere.js`**: `installAtmosphere()` replaces `installRadialFog`.
  - Fog chunk emptied; fog mixed in **linear HDR before tone mapping**.
  - **Analytic single-scatter in-scatter** for the lantern and both pooled env lights. Closed form already verified by
    `plans/scripts/inscatter_check.mjs` (three.md §2.6).
  - Exponential **height pooling** per section.
  - 32³ tiling noise density (one 3D fetch).
  - **Fog dome** mesh (rendered last, `depthWrite false`), so the abyss shows halo and gradient instead of the clear
    colour.
  - `patchAtmosphere(material, opts)`: one shared helper that chains `onBeforeCompile` and `customProgramCacheKey`. It
    holds a shared uniform block (lantern, env lights, scatter, threat, grade) and is called by level, creature, hands,
    rope and FX materials.
- **`src/render/grade.js`.**
  - `CustomToneMapping` = AgX + lift/gamma/gain + split-tone (shadows cool, highlights warm) + saturation + contrast.
  - Per-section values from art.md §6.1. A threat drift (−0.1 saturation, +0.05 contrast, green-cyan shadow lift within
    20 m), ramped over ≥ 1 s.
  - Triangular dither plus 1–2 LSB grain. `material.dithering` on world, fog dome and creature.
  - Exposure animation: dark adaptation (L9: instant drop, +0.6 EV over 4 s).
  - The GLSL lives in one exported string, so Ultra's post pass reuses the **same** maths (WP8).
- **Flicker-safety fix (L8).**
  - Env-lamp fast swing ≤ 0.08 amplitude; character moves to slow (< 0.5 Hz) gutters.
  - Rare dips are ramped over ≥ 150 ms; the lantern dip is ≤ 9 %.
  - Target: ≤ 1 flash pair per second in `flicker_check.mjs`.
- **Lantern cookie.** Swinging cage-bar shadows computed in the lantern term from the lantern's local frame. ALU only;
  a 64² cookie texture is the fallback.
- **Lamp halos v2.** Constant angular size, fog fade, CPU-raycast occlusion at 4 Hz against level AABBs.
- **Theme tables.** `src/render/themes/ch1.js` holds the new tuple fields (shadowTint, highlightTint, saturation,
  contrast, exposure, wet, scatter, heightFog), blended over the existing ±9 m band.

**Technique.** ALU-only shader work in the passes that already run. No render targets, no post.

**Quest cost.**

| Item | Cost (est.) |
|---|---|
| GPU | +0.3 to +0.6 ms (in-scatter 3 lights 0.2–0.4, grade and dither 0.05–0.15, cookie ≤ 0.05, height + noise 0.05–0.1) |
| Draws | +1 object (fog dome) = +2 GL draws |
| Triangles | +1 k |
| VRAM | +0.13 MB (noise volume) |
| Programs | 0 (keys replace the old fog variants) |

**Desktop extras.** Ultra moves the grade into a post pass (`AT_GRADE_POST` define skips it in materials) and adds real
bloom on top of the same HDR image.

**Acceptance (headless)**
1. Value bands at every shot: B4 (≥ sRGB 170) ≤ 8 % of pixels; < 2 % of pixels below sRGB 14 outside the death fade.
2. Banding index on the SH04 and SH09 fog gradients is ≤ 25 % of baseline (dither works).
3. **"Lit air"**: mean luminance in a ring 0.5–3° around the lantern's screen position at SH02/SH03 is ≥ 1.25× baseline.
4. `flicker_check.mjs` passes at ≤ 1 pair/s, for lamps, lantern and the WP5 Lamp Dip.
5. Program count unchanged ±2. A JS mirror of the shader's in-scatter maths matches `inscatter_check.mjs` within 1e-6.
6. e2e green. The death fade, flash and section theme blend still pass the existing checks.
7. Device: GPU delta at SH09 ≤ +0.7 ms.

**Dependencies.** WP0. **Effort.** 16 h.

---

### WP3: Mason rig build (Blender)

**Goal.** Turn the approved design into a game-ready **rigged, skinned, animated** GLB with Quest and Ultra LODs. The
approved design is the r2 *Ossuary Column*: 29.5 m spine, 27 vertebrae, 46–53 legs, 2.14 M render triangles (`mason2/final/r2/stats.json`).
The full specification is §5. This package is the Blender half.

**Deliverables**
- **`tools/abyssal-tether-3d/mason/build_mason_rig.py`.**
  - Imports the creature workflow's generator with `--rest --game --legs 32 --vertebrae <per chapter>`.
  - Rest-pose rebuild. Wall dressing draws its random numbers but emits nothing, so the RNG sequence and the approved
    look are unchanged (blender.md B2).
- **Ownership stamping.** The generator's `owner(...)` context stamps per-vertex bone index and blend weight at build
  time. **No heat-map auto-weights.**
- **Armature.** About 210 deform bones (§5.2), in `DEF` and `CTL` collections, unit-scale bones, `bbone_segments = 1`.
- **LODs and meshes.**
  - Quest LOD0 ≤ 70 k, LOD1 ≤ 20 k, LOD2 ≤ 6 k (silhouette with a vertex-animated leg fringe).
  - **Ultra LOD0 ≤ 130 k.** Today's r2 export, at 124 k, is the right size for it.
  - All LODs parented to the **same** rig.
- **Materials and bakes.**
  - **2 materials / 2048² atlases:** `MasonCrown` (crown, maw, throat, neck) and `MasonBody` (vertebrae, plates, legs,
    attachments). Emissive pits stay in-atlas.
  - Overlapped UVs for 4 leg variants, which frees about 40 % of the body atlas (blender.md B2).
  - Bakes: albedo, tangent normal (`export_tangents=True`), ORM, emissive. AO at 256 spp with OIDN.
  - Vertex colours: `wet`, `thickness`, `flesh` masks.
  - **No `Coat Weight`** in the Quest GLB, which keeps three on `MeshStandardMaterial`.
- **Custom attributes:**

  | Attribute | Use |
  |---|---|
  | `_SPINE_S` | arc length; seam pulse, breathing |
  | `_PLATE` | plate id; jitter, lift wave, plate turn |
  | `_SWAY` | strands, chains |
  | `_LEGPHASE` | LOD2 leg fringe wave |

- **`tools/abyssal-tether-3d/mason/clips.py`.** The 24 clips in §5.5, keyed with anticipation, overshoot and follow-
  through offsets and auto-clamped Béziers. Stashed on NLA tracks; events in the action custom property `events`.
- **Outputs.**
  - `assets/models/mason_rig_ch1.glb`: Quest geometry, skin and clips. Textures are external KTX2 through the
    manifest, so chapter variants share them.
  - `assets/textures/mason/*.ktx2`.
  - `assets/models/mason_rig_ultra.glb` (Ultra pack).
  - `mason_rig.report.json`: bones, triangles per LOD and material, clip list and durations, bytes.
- **`tools/abyssal-tether-3d/mason/check_rig.mjs`.** Node + gltf-transform checks:
  - joints ≤ 255, so `JOINTS_0` stays u8;
  - ≤ 4 influences, each set summing to 1 ± 1e-3;
  - no `KHR_materials_clearcoat` in the Quest file;
  - required attributes present;
  - clip names, durations and events parse;
  - LOD triangle ceilings;
  - texture MIME `image/ktx2` only.
- Per-chapter vertebra variants (E17 `seg` 20/22/24/28/32 → about 30→48 m) from the same generator in WP14, sharing
  atlases.

**Technique.** blender.md B2–B8. bpy 5.2 slots, layers and strips for actions. `export_animation_mode='ACTIONS'`,
`export_def_bones=True`, `export_apply=False`, sampled export. Then `post.mjs`.

**Quest cost.** The runtime cost is in WP4. Files: Quest GLB about 3 MB of geometry and clips (meshopt) plus 2 atlases
of about 12 MB (ETC1S albedo, ORM and emissive; UASTC normals).

**Desktop extras.** Ultra LOD0 130 k plus clearcoat parameters (Ultra GLB only).

**Acceptance (headless)**
1. `check_rig.mjs` green.
2. **Deformation test.** Node + three r170 + CPU `SkinnedMesh.applyBoneTransform` on 3 canonical poses (crawl S-curve,
   rear, coil):
   - rigid stones stay rigid (per-island edge-length change < 1 %);
   - flesh rings lose < 15 % cross-section area (no candy-wrapping);
   - gaps between neighbouring vertebra shells < 3 cm.
3. **Silhouette test.** Headless renders of the LOD2 crawl at 60 m and the LOD0 rear at 8 m (binary masks). Protrusion
   count along the body edge ≥ 40 at 60 m: "a long thing with many legs" (art.md §8 test a).
4. **Originality and fear review** by the existing vision-judge step (`scratchpad/judge_horror`, `judge_orig` pattern)
   on the rear, listen and crawl poses: no eyes, antennae, insect mandibles or face. It must score "scarier" than the
   current kit.
5. Bake QA: no seams over 2 px at mip 0–2. AO noise (std-dev in flat regions) under the threshold.

**Dependencies.** Design lock from the creature workflow (§9 decision 3), and WP1 `post.mjs`.

**Effort.** 32 h, plus about 1–1.5 h Blender CPU (rebuild, decimate, 2 × 2048² bakes) and 15 min encode.

---

### WP4: Mason runtime (`MasonRigView`)

**Goal.** The rigged creature driven by the **existing** sim payload, with clips and procedural layers. 2 draws per eye,
a drop-in replacement for `CreatureView` with layered fallback.

**Deliverables**
- **`src/render/masonRigView.js`.** Same API as `CreatureView`: `new MasonRigView(scene, gltf, opts)`,
  `update(creature, dt, camera)`, `setTextures(t)`, `info`, `dispose()`. It also subscribes to bus events. Submodules in
  `src/render/mason/`:

  | Module | Does |
  |---|---|
  | `spineSampler.js` | centripetal Catmull–Rom through `body.spine`; arc-length table; roll from `body.up`; per-bone frame at normalized arc length |
  | `gait.js` | 10 sim-planted legs via analytic IK; 22 follower legs on a metachronal wave; foot-surface projection with round-robin AABB probes |
  | `focus.js` | crown aim: critically damped lag 0.3–0.5 s plus a snap on target switch; targets head, hand or lantern |
  | `springs.js` | arms, chains, strands; disabled while frozen |
  | `clipGraph.js` | sim state and scalars → base clip, crossfades, additive weights, parametric scrubs (§5.7) |
  | `masonMaterial.js` | the shader patch set (§5.4), via `patchAtmosphere` |
  | `lod.js` | 25 m / 60 m switch with 2 m hysteresis; one skeleton shared |
  | `bounds.js` | per-frame bounding sphere from spine and leg extents |

- **`game.js` wiring** (request to owner):
  - load `mason_rig_ch1.glb` with KTX2 and meshopt;
  - prefer `MasonRigView`, falling back to `CreatureView` + `mason_kit.glb`, then `StandInCreatureView`;
  - `_fault` reporting as today.
- **Debug.** `AT3D.debug.creaturePose(clip, t)` and a layer-mask toggle, so staging can isolate layers.

**Technique.** §5.6 per-frame order: mixer first → procedural spine composes the additive deltas
(`delta = bind⁻¹·mixed`) → focus → gait → springs → bounds. Zero allocation, with preallocated scratch.

**Quest cost.**

| Item | Cost |
|---|---|
| Draws | 2 skinned objects = **4 GL draws** when visible; 0 beyond 260 m (existing `hideDistance`) |
| Triangles | LOD0 ≤ 70 k (within 25 m), LOD1 ≤ 20 k (25–60 m), LOD2 ≤ 6 k |
| CPU (est.) | 0.4–0.7 ms; **budget ≤ 1.0 ms** (mixer with ≤ 4 active actions, 210 bones, 32 analytic IK, springs) |
| GPU (est.) | +0.3 to +1.0 ms when on screen; up to about 1.5 ms in a face-filling lunge, a short burst |
| Bone texture | 32×32 RGBA32F, 16 KB per frame |
| VRAM | ≈ 24 MB textures + 6 MB geometry |

**Desktop extras.** Ultra GLB with `MeshPhysicalMaterial` clearcoat on wet flesh and mortar, `castShadow`, LOD0 130 k,
LOD switch at 60 m.

**Acceptance (headless)**
1. **e2e full descent green** with the creature live and zero console errors. The fallback test (rename the GLB) ends in
   `CreatureView`.
2. Budgets at SH04, SH06, SH07, SH08 and SH12: the creature adds ≤ 4 GL draws and ≤ 70 k triangles per eye.
3. **Zero per-frame allocation.** The existing `perf-alloc` harness over 600 frames with the creature in ATTACK and
   BURST cycles shows 0 B/frame of heap growth.
4. **Culling.** For 200 random sim bodies (30 m, arched, coiled), the per-frame sphere contains all CPU-skinned
   vertices. No false culls at screen edges.
5. **Feet.** Planted sim legs: rendered foot within 5 cm of `limb.foot`. Followers: foot within 10 cm of the projected
   surface plane. No leg exceeds 1.15× rest length.
6. **Clip graph unit tests** in Node: synthetic sweeps of every `CREATURE_STATES`, and of `lunge`, `listen`, `jitter`,
   `frondOpen` and `glow`, give the expected weights in the §5.7 table. Crossfades are continuous: no bone jumps over
   2° between frames.
7. **Determinism.** The same sim seed and inputs give identical bone-matrix hashes across two runs.
8. **CPU.** `update()` ≤ 0.25 ms median on desktop Node (a proxy: about 4× that on Quest; device gate ≤ 1.0 ms).
9. Creature shots are rendered for review in both tiers.

**Dependencies.** WP3, WP2 (shared atmosphere, so fog matches), WP1. **Effort.** 30 h.

---

### WP5: Fear behaviours and creature FX ("crazy scary")

**Goal.** Fear in VR comes from anticipation, uncertainty, lingering presence and causes the player can see
(art.md §0.2, §2.6), not from polygon count. This package builds the beats in §5.9 so each one is reproducible for the
trailer and systemic in play.

**Deliverables**
- **Sim payload additions.** Requested from the creature sim owner (E01/E17). All are optional and backward compatible;
  Chapter I's legacy tuning is unchanged unless a beat enables them:

  | Field / event | Meaning |
  |---|---|
  | `body.freeze` (bool) | true freeze: legs, springs and breath stop |
  | `body.hide` (0..1) | Stone-Still camouflage |
  | `body.linger` | `{active, x, y, z, focus}` |
  | `body.focusKind` | `'head' \| 'hand' \| 'lantern' \| 'point'` |
  | `body.length` | metres |
  | `creature:step` | gains `limb`, `nx, ny, nz` |
  | `creature:ropeTouch` | `{hand, x, y, z}` (new event) |
  | `creature:listen` | `{phase: 'start' \| 'end'}` (new event) |

  E17's planned `seg`, `wet`, `stone`, `hidden` and `plates` are used as specified there.
- **View-side derivations** when the fields are absent, so WP5 ships before the sim change:
  - freeze ≈ `listen > 0.6 && headSpeed < 0.1`;
  - focusKind from the hearing cause (`creature:burst.reason`);
  - hide only when sim-provided.
- **`src/render/fx.js` v2 hooks**, all pooled:
  - `creature:step` → dust and chips at the foot (4–8 particles, within 20 m) plus a 0.25 s contact darkening decal;
  - `creature:attack` → plate-lift wave and a fog swirl (a fog-noise offset uniform);
  - `creature:strike` → chip spray, debris, and a strike crack decal (pooled, ≤ 4), plus a lamp shatter if one is within
    3 m;
  - **grit rain** pre-cue 0.5–1 s before the scrape crescendo whenever the head is above the player within 25 m;
  - seam-breath puffs (beat 20);
  - the snuff puff (Chapter II);
  - the **Take iris** (beat 24): a head-locked ring occluder closing from the periphery, ramped, ending in the fade.
- **Lamp Dip (L7).** Env lights and baked-lamp halos within 15 m of the head dim toward 40 % over ≥ 0.4 s; flame cards
  lean toward the crown. A theme-layer uniform; no program change.
- **Near-eye guard.**
  - A precompiled creature variant with dithered `discard` fade inside 0.6 m of the eye. It is swapped in only while
    the head is within 3 m, because `discard` disables early-Z/LRZ for the whole draw on Adreno (three.md pitfalls).
  - Strike targets are clamped so the crown never passes within 0.6 m of the eyes on a miss.
- **`tools/abyssal-tether-3d/showcase/beats.json`.** Reproducible beat set-ups for the trailer (Spiral, Linger, Rise,
  Pour, Ceiling crossing, Listen, Rear and Snap) driven by E17 `path` data or debug staging.

**Quest cost.**

| Item | Cost (est.) |
|---|---|
| Particle draws | ≤ 2 extra, inside the ≤ 4 total by sharing the pool |
| Live particles | ≤ 400 extra |
| Decals | +1 object (pooled cracks) = +2 GL draws |
| CPU | ≤ 0.2 ms |
| GPU | 0.1–0.3 ms during bursts; blended coverage kept ≤ 25 % |
| Lamp Dip, freeze, hide | ≈ 0 |

**Desktop extras.** Ultra: more chips (×4), lit smoke cards, a bloom kick on the iris clack. Shadowed legs sweep across
lit walls before the body appears: on Ultra this is the lantern shadow; on Quest it is an optional encounter-only spot
shadow, tested in WP12.

**Acceptance (headless)**
1. **Event → FX mapping** unit tests. FX spawn within 1 frame of the bus event. Audio for the same event is scheduled
   ≤ 100 ms after the visual and never before (A1; checked through bus and AudioContext timestamps in the page).
2. **True freeze.** With `freeze`, all bone matrices are constant (max delta < 1e-5) over 60 frames, springs are
   disabled, and the scrape bed duck fires on the same frame (A5).
3. **Lamp Dip** ramps at ≥ 0.4 s. `flicker_check.mjs` covers dip plus lamp flicker at ≤ 1 pair/s.
4. **Near-eye.** In a scripted miss lunge, a depth readback of a creature-only render shows the nearest fragment ≥ 0.6 m
   from the eye.
5. **Blended coverage** at the SH08 debris moment (additive-only ID render) ≤ 25 % of pixels.
6. **Reproducibility.** Each `beats.json` beat rendered twice gives SSIM ≥ 0.98.
7. **Telegraph.** In 200 seeded attacks, wind-up ≥ 0.35 s before every strike inside 8 m (S4).
8. Pacing sims (E17) unchanged: careful Normal survives, a stalling player dies on schedule.

**Dependencies.** WP4, plus the creature sim owner for the optional fields. **Effort.** 24 h.

**MS-A ships here** (with S7 from WP6).

---

### WP6: Hero vistas (Chapter I money frames first)

**Goal.** Bring the frames that sell (SH01, SH03, SH04, SH08, SH09, SH11, SH13) to final quality **before** the rest of
the level, and prove the environment pipeline on them.

**Order inside the package:**
1. **S7 Hollow Nave**: the Spiral is both a creature shot and a vista, and completes MS-A;
2. **S1 Threshold**: the trailer opener and menu;
3. **S4 Listening Vault**: the Pour;
4. **S9 Mark chamber + the Lamphold seam vista**: the purchase moment.

**Deliverables**
- **Kit v1 (Blender).** `tools/abyssal-tether-3d/kit/build_kit.py` (blender.md A1–A3) produces:
  - masonry trim sheet 2048² (courses, mouldings, voussoirs) and iron trim 2048²;
  - ashlar panels (3 variants + 2 broken), string course, corbel lips, buttress, lancet window, ribbed vault segment,
    rubble lip;
  - iron beams, brackets, chains with real links;
  - the **figure kit**: Kneeling One, Lanternwright, LOD0 about 2 k, LOD1 about 600, shared with ART_AUDIO_PLAN §1.4.
  - Collision stays boxes; relief is recessed ≤ 0.15 m and protrudes ≤ 0.05 m on play surfaces.
- **Section pipeline.**
  - `dump_level.mjs` → `build_section.py --section sN` (face tiling by hash; join per material bucket; UV1 pack at
    16 tx/m on route and 8 tx/m elsewhere).
  - `bake_section.py`: Cycles DIFFUSE direct + indirect at 384 spp; AO in alpha.
  - `lm_encode.py`: pyoidn `RTLightmap`, dilate, dLDR Bmax, UASTC.
  - Export `sN.glb` + `sN_lm.ktx2` (blender.md A2–A7).
  - Calibration once, with a grey card (blender.md A5).
- **Runtime: `src/render/sectionArt.js`.**
  - Streams current ±1 section GLBs.
  - `lightMap` on `uv1`, intensity π·Bmax; ORM AO drops to 0.3–0.5 on lightmapped materials.
  - **Lantern occlusion trick**: lightmap alpha AO scales the lantern's direct term (no extra fetch).
  - SH probe grid (`probes.json`) feeds the one fixed `LightProbe` for dynamic objects.
  - The instanced boxes stay as the hidden collision mirror and a fallback.
- **Far HLOD.**
  - Colossus, spire and Outer Dark baked COMBINED to vertex colour, unlit.
  - Rim edges lit by haze and lit windows.
  - **3 layered fog cards** per vista for parallax depth.
  - One silhouette per section (D1).
- **Light shafts v2.** Analytic cone thickness + scrolling noise + motes inside (three.md §2.7).
- **Ambient particles v2 core** (needed for vista depth): head-facing instanced quads; analytic wall-plane soft fade;
  lantern-lit motes; per-section mote type.
- **The Lamphold seam vista (SH13).**
  - About 3,000 lamp impostors as **one instanced quad draw** (E25 lamp-field) with per-instance flicker phase.
  - Tiered town silhouettes as layered cards.
  - The warm glow below the Vault floor cracks (P15).

**Quest cost (per section in view).**

| Item | Cost (est.) |
|---|---|
| Draws | ≤ 6 merged meshes (12 GL draws) + neighbour ≤ 6, replacing about 8–12 instanced box and decor draws; seam vista +2 GL draws (lamp field) + 2 (cards); shafts +2 |
| Triangles | 150–250 k visible |
| GPU | geometry +0.2 to +0.6 ms; lightmap fetch +0.1 to +0.3 ms; offset by optionally dropping to 1 env light in fully baked sections (device A/B) |
| Lightmaps | ≤ 27 MB resident |
| Trims | ≈ 28 MB |
| Download | demo pack +≈ 12 MB |

**Desktop extras.** Ultra adds:
- lantern shadow over the kit relief;
- GTAO;
- box-projected PMREM on wet stone and iron;
- near POM on masonry;
- 4× motes;
- raymarched shaft volumes.

**Acceptance (headless)**
1. **No raw box within 30 m** at SH01, SH03, SH04, SH08, SH09, SH11 and SH13. Scene introspection counts visible
   legacy unit-box instances (`levelView` solids InstancedMesh) within 30 m: must be 0.
2. **Budgets** at those shots: ≤ 140 GL draws, ≤ 400 k triangles per eye peak; programs ≤ 24 in Chapter I.
3. **Lightmap calibration.** The grey-card scene's baked luminance is within 5 % of the real-time light's. Every section
   GLB has `uv1` on lightmapped primitives; KTX2 and GLB validate.
4. **Image metrics against WP0's before set:**
   - near-field detail energy ≥ 2× at SH09;
   - **depth layering**: ≥ 3 distinct luminance plateaus in the far field of SH01, SH04 and SH13;
   - value bands still pass.
5. **Collision unchanged.** The deterministic bot replay of every route gives identical deaths and timings to baseline
   (art is non-colliding).
6. **Streaming.** At section boundaries the headless frame-time trace shows no frame > 2× the median (relative). The
   GPU memory ledger stays within ±5 % of baseline after 3 boundary crossings.
7. **Vision-judge rubric** on before/after pairs: ≥ +2 points on a 5-point quality scale, ≥ +1 on fear, per shot.
8. Device: GPU p95 at SH09 and SH13 within §3 gates.

**Dependencies.** WP1, WP2 (WP5 for SH04, SH08, SH12 staging).

**Effort.** 44 h, plus about 2–3 h Blender CPU (kit bakes and 4 section bakes; s7 is 2 × 2048² ≈ 15–30 min,
blender.md Part C).

---

### WP7: Near field (gauntlets, lantern, rope, anchors)

**Goal.** Hands and ropes are in **every** screenshot. They are the player's scale ruler for the Mason (art.md §2.3)
and today they read as orange toys (audit §2.6). Replace them with authored, worn brass, iron and leather.

**Deliverables**
- `tools/abyssal-tether-3d/props/build_gauntlets.py`: high → low bake, **≥ 1024 px/m**, one 1024² atlas plus the shared
  detail texture.
- `assets/models/gauntlets.glb`: ≤ 8 k triangles per hand, 1 material, launcher mechanism as separate rigid nodes for
  the existing animation.
- Lantern: cage, glass, a world-locked flame card, the cookie source for WP2. ≤ 3 k triangles.
- `handsView.js` loads the GLB, with the procedural fallback kept.
- **Rope v2** in `ropeView.js`:
  - 8-sided tube;
  - twisted-fibre normal map with UV scroll tied to reel;
  - wet darkening by section wetness;
  - tension shown as a subtle fibre highlight, not emissive glow;
  - fray fibres near frayed rings.
- **Anchors kit v2.** Ring, hook and cracked diamond with phosphor inlay; rope grooves worn into rings (M2). Instanced
  as today.

**Quest cost.**

| Item | Cost (est.) |
|---|---|
| Objects | hands 2 + lantern 1 + ropes 2 = 10 GL draws (about today's count; procedural hands are already merged) |
| Triangles | ≈ 20 k |
| GPU | ≤ 0.2 ms (hands can cover 5–15 % of the view) |
| VRAM | ≈ 4 MB |

**Desktop extras.** Hands cast the lantern shadow on Ultra. 2K atlas from the Ultra pack.

**Acceptance (headless)**
1. Near-field detail energy in the hand mask at SH14 ≥ 3× baseline.
2. UV texel-density script on `gauntlets.glb`: ≥ 1024 px/m over 90 % of the surface area.
3. GL draw delta ≤ +4 against WP0 at every shot.
4. XR-mock e2e: hands follow controllers. Focus-loss hides hands and ropes (RELEASE T10).
5. Value bands: brass highlights stay within B4 ≤ 8 %.

**Dependencies.** WP1, WP2. **Effort.** 18 h (+ about 20 min Blender CPU).

---

### WP8: Quality tiers + desktop High/Ultra

**Goal.** An honest "like Unreal Engine" look on desktop, for capture and for desktop players, without touching the
Quest path.

**Deliverables**
- **`src/render/quality.js`.**
  - Tier table from §2, detection (XR, GPU string, devicePixelRatio), settings UI hook, and a `?q=` override.
  - Switching only at the menu, behind a fade, followed by `compileAsync`.
- **`src/render/post/ultraComposer.js`** (dynamic import):
  1. `RenderPass` into a HalfFloat target with 4 samples;
  2. `GTAOPass`;
  3. `UnrealBloomPass` (HDR threshold);
  4. `GradePass` (the **same** AgX and grade GLSL as WP2);
  5. `FilmPass` grain;
  6. `OutputPass`.
  - Materials compile with `AT_GRADE_POST`, so nothing is graded twice.
  - Vendor list: the `postprocessing/` and `shaders/` files plus `math/SimplexNoise.js`. All are present in
    `three@0.170.0` (checked locally).
- **Ultra lighting.**
  - Lantern `PointLight` shadow, PCFSoft, 1024 cube. Creature, hands and props cast; walls receive.
  - Creature `SpotLight` shadow on High.
  - 6 env lights.
  - Per-section PMREM, box-projected.
  - Clearcoat on wet world stone.
  - Near POM (6–12 steps) on masonry.
  - Raymarched shaft volumes.
  - Particles ×4.
  - Ultra creature GLB.
- **Guard.** `renderer.xr.isPresenting` → composer is never called. Entering VR from desktop Ultra falls back to the
  Quest program set behind the enter-VR fade.

**Quest cost.** **0.** The code is never loaded in XR, and the program set is identical.

**Desktop cost.** §3.3.

**Acceptance (headless)**
1. `verify-showcase --tier ultra,high` renders all shots with no errors. Desktop draw and triangle budgets hold.
2. **XR isolation.** In mock XR, a spy shows `composer.render` calls = 0 over 600 frames. The Quest-tier program-key
   hash equals WP0's Quest set plus WP2–WP7 additions, with no Ultra keys.
3. **Same grade.** At SH09, with bloom, GTAO and shadows disabled, the Ultra post-graded image matches High's
   in-material graded image (SSIM ≥ 0.98).
4. **Effects present.** GTAO lowers mean luminance in contact-AO masks by ≥ 10 %. A bloom halo radius > 0 around lamps.
   A lantern shadow mask is non-empty on walls behind the creature at SH07.
5. Relative frame times are logged per tier (informational; no gate in SwiftShader).

**Dependencies.** WP2, WP4, WP6. **Effort.** 26 h.

---

### WP9: Capture Director (trailer factory)

**Goal.** The sim is fixed-step and seeded (ENGINE_EXTENSIONS §0 rule 2). Use that to record real headset play on Quest
and re-render it offline at store resolutions, with perfect anti-aliasing, real motion blur and a stabilised head
path. Two profiles: `quest-faithful` and `ultra`.

**Deliverables**
- **`src/dev/replay.js`** (dev and capture builds only).
  - Records per fixed-step index: intents (`debugSetInput` shape), head and hand poses at 72 Hz, seed, difficulty,
    checkpoint snapshot (E03).
  - Recording uses an allocation-free ring buffer, then serializes to `.atrec` (gzip JSON).
  - Playback drives `AT3D.debug.setInput`, `AT3D.debug.step` and pose overrides.
  - It records **step counts per frame**, so variable frame `dt` cannot desynchronize the sim.
- **`src/dev/photoMode.js`** (never in store builds, ART_AUDIO_PLAN §8): freeze sim, free camera, FOV and roll lock,
  DOF (Ultra only), hide HUD and wrist.
- **`tools/abyssal-tether-3d/capture/director.mjs`.** Playwright on a GPU capture machine; SwiftShader also works
  offline, only slowly. For each output frame:
  1. step the sim 1/fps;
  2. render N **sub-pixel-jittered** subframes (Halton projection jitter) accumulated in a float target, giving
     16–64× SSAA;
  3. optionally spread subframes across sim substeps for a **180° shutter**, which gives real motion blur;
  4. smooth the head path with a critically damped filter; horizon lock is optional;
  5. write PNG sequences → ffmpeg H.264 or ProRes at 2560×1440, 3840×2160 and 1080×1920.
- **`tools/abyssal-tether-3d/showcase/trailer.json`.** The 11 trailer shots (ART_AUDIO_PLAN §8) and 14 postcards, each
  with a replay file, beat, duration and profile.
- **`capture/manifest.json`.** Provenance for every exported asset (§1.3).

**Quest cost.** 0 in store builds. In dev builds recording costs ≤ 0.05 ms and 0 B per frame.

**Desktop extras.** This is the desktop showcase tool. It also feeds the desktop attract mode (WP11).

**Acceptance (headless)**
1. **Determinism.** Record 60 s in mock XR with the creature live. Two replays give identical sim-state and bone-matrix
   hashes at every second.
2. **Representativeness.** A 3 s clip in `quest-faithful` at 1x subsampling matches the real-time Quest-tier render of
   the same frames at the same resolution with SSIM ≥ 0.97. With 16× it differs only in AA (edge-mask-only differences).
3. A 10 s SH08 Spiral clip encodes, plays (ffprobe: 2560×1440, 60 fps, the expected duration), and its manifest entry
   validates.
4. **Store bundle check.** A grep of the production bundle finds no `photoMode` or `replay` code.

**Dependencies.** WP0, WP5, WP8 (for the `ultra` profile). **Effort.** 22 h.

**MS-B ships after WP9.**

---

### WP10: Chapter I rollout (the whole demo at hero standard)

**Goal.** No section of the free demo is visibly worse than the trailer.

**Deliverables**
- **Sections.** Build and bake S2, S3, S5, S6 and S8.
- **Wetness and drips** (`onBeforeCompile` through `patchAtmosphere`; three.md §2.5).
  - Wetness by depth (M1: S1 0.1 → S8 0.7); porous albedo darkening; roughness drops to 0.15–0.3.
  - Time-scrolled streak mask on vertical faces; top-face pooling.
  - Drip points: streak, splash ring and glint (V3), with audio hooks.
- **Build-time decals.** Merged per atlas with `MultiplyBlending` and `polygonOffset`:
  - soot above lamps; rust weeping below iron straps; grime in AO corners;
  - **claw scrapes and dark residue along the Mason's S5–S8 path**;
  - Lanternwright chalk marks near anchors.
- **Story props** (D2: ≥ 1 story prop and ≥ 4 secondary props per 10 m within 15 m of the route): the 13 statues in one
  figure language (P4), the split statue (P5), dropped lanterns, tally marks, swallowed scaffolds.
- **Relief tiles** within 8 m of the route (three.md §2.10): stereo-true depth where you hang.
- **Ambient FX v2** completed: grit sift (V2), drips (V3), shaft breath (V18), per-section mote types.
- Section grade values for all 8 sections.

**Quest cost.** As WP6 per section. Wetness +0.15 to +0.3 ms. Decals +2 GL draws per section.

**Desktop extras.** As WP6.

**Acceptance (headless)**
1. **Full-route sweep.** Sample every 2 m along each bot route (all 8 sections, all variants):
   - 0 legacy boxes visible within 30 m;
   - max GL draws ≤ 150;
   - max triangles per eye ≤ 400 k;
   - programs ≤ 24.
2. **Texel density** ≥ 512 px/m on route walls within 3 m (screen-space UV-derivative sampling at 200 route poses).
3. e2e descent green; route timings and deaths identical to baseline replay.
4. **Vision judge** on 24 random route frames: no frame scores below the WP6 hero-frame mean − 1.
5. Resident memory with ±1 section ≤ §3 budgets. The demo pack is ≤ 45 MB in `asset_budget.mjs`.

**Dependencies.** WP6 (pipeline), WP5 (claw-path data). **Effort.** 40 h, plus about 3–4 h Blender CPU.

---

### WP11: Front door and demo funnel

**Goal.** The demo's first and last minute are the conversion moments, so they must be the best-looking minutes in the
product.

**Deliverables**
- **Menu scene (VR and desktop).**
  - Threshold window vista with the colossus.
  - Shaft breath (fog density cycling below 0.2 Hz).
  - A distant call; on 1 visit in 3, the Pour silhouette crosses a far wall.
  - Carved in-world logo panel.
  - VR: static vista (no camera motion). Desktop: an attract camera that plays Director shots, so the attract loop *is*
    the trailer.
- **The waking minute (P1)** polished:
  - dead lantern → Threshold lamp flare → lantern catch, with an exposure ramp (L9);
  - in-scatter bloom-in;
  - first motes lit as the light catches.
- **End-card staging (SH13).**
  - The chandelier apex frames the lit pit.
  - Once per playthrough, a crown sinks through the lamp tiers far below, and the lamps it passes dim (Lamp Dip at
    vista distance).
  - The panel is carved stone at hand height and readable over the vista.

**Quest cost.** Menu scene ≤ 60 GL draws. End-card scene within the set-piece budget.

**Desktop extras.** Ultra attract loop.

**Acceptance (headless)**
1. SH01, SH02, SH13 and a new SH02b (waking +20 s) pass budgets and image metrics.
2. End-card text contrast ≥ 4.5:1 against its rendered backdrop (measured on the render).
3. The boot path is not regressed: menu assets are in the boot pack, ≤ 8 MB. Time from page load to the first rendered
   menu frame (headless) is ≤ baseline + 10 %. Device: first head-tracked frame ≤ 4 s (RELEASE T1).
4. The desktop attract loop plays 60 s of Director shots with no console errors.

**Dependencies.** WP5, WP6, WP7, WP9. **Effort.** 12 h.

---

### WP12: Performance hardening (continuous gate)

**Goal.** Hold 72 fps p95 on Quest 3 with all the art in.

**Deliverables**
- **Multiview decision** from WP0's spike.
  - If adopted: re-vendor `super-three@0.181.0` as a matched set (core, GLTFLoader, KTX2Loader, BufferGeometryUtils);
    request `'layers'`; precompile **after** session start (program keys gain a view count); check the lantern lighting
    offset per eye (quest.md §5.2).
  - If not: stay on r170 and keep GL draws ≤ 150.
- **Dynamic quality.**
  - FFR 0.66 ↔ 1.0 with hysteresis on a frame-timing proxy.
  - Particle caps and LOD distance scaler.
  - Optional encounter-only creature spot shadow (1024², `BasicShadowMap`, `autoUpdate` only within 25 m). Shipped
    only if the device shows < 1 ms (quest.md §13).
- **Compile and memory.**
  - `compileAsync` precompile of every variant (creature LODs, near-eye variant, decals, fog dome, particles) inside the
    session behind fades.
  - A program ledger: ≤ 24 per chapter.
  - Dispose audit on section and chapter swaps.
- **Quest 2 tier** (only if the listing includes it): LOD1 as LOD0, 1K textures, lantern + 1 light.
- **Thermal soak checklist** (RELEASE T17).

**Quest cost.** Recovers 0.5–2 ms CPU (multiview, if adopted) and adapts GPU load.

**Acceptance**
1. Headless: unique program keys after a full descent ≤ 24. `renderer.info.programs.length` is constant after the first
   gameplay frame (no mid-game compiles). `renderer.info.memory` is back to baseline ±5 % after a chapter swap.
2. Device (owner):
   - OVR Metrics GPU p95 ≤ 11.5 ms and main-thread p95 ≤ 8 ms at every money frame and every E29 set-piece worst
     moment;
   - 45-minute soak with no sustained drop below 72 fps;
   - stale frames < 1 %.

**Dependencies.** WP0. It runs alongside every package and gates each milestone. **Effort.** 18 h.

---

### WP13a: Demo store page assets

**Goal.** A store page that sells the demo the day Chapter I ships, honestly.

**Deliverables**
- **Screenshots.**
  - ≥ 5 on-device screenshots captured by the owner through MQDH from the `shots.json` poses (SH03, SH06, SH07, SH08,
    SH09, SH12), labelled "Captured on Meta Quest 3".
  - If device capture cannot reach 2560×1440, use `quest-faithful` Director renders at 2560×1440 **without** the
    "captured on" label, with provenance recorded (decision §9).
- **Key art and covers.**
  - Concept: the Kneeling One wearing your gauntlets before an unmoving flame, a tether into the dark (ART_AUDIO_PLAN
    §8). Built in Ultra photo mode from SH11.
  - Crops: hero 3000×900, landscape 2560×1440, square 1440², portrait 1008×1440, mini 1080×360.
  - The Mason appears only as silhouette or crown; no flesh close-ups (RELEASE §13).
- **Logo and icon** (1024 master).
- **30 s demo teaser** from Director `quest-faithful` captures plus on-device footage. Opens on gameplay within the
  first 2 s; no logo cold open.

**Acceptance (headless)**
1. `store_assets_check.mjs`: sizes and formats per RELEASE §13; no text in screenshots (OCR-free check: compare against
   the clean render); device label present where provenance says device; teaser 16:9, duration 30 s ± 1, no black bars.
2. **Key-art flesh coverage.** In an ID render of the Ultra frame, `FleshWet`-class pixels ≤ 3 % of the image and none
   within the central 30 %.
3. Every asset is listed in `capture/manifest.json`.

**Dependencies.** WP9, WP11, WP10 (for representative screenshots). **Effort.** 14 h agent + 1 owner device session.

---

### WP14: Chapters II–V art packs (4 × 36 h)

**Goal.** Each chapter delivers its trailer shot **first**, then the rest of the chapter. Same pipeline, same budgets.

| Chapter | Trailer shot built first | New tech | Texture sets (KTX2) | Mason chapter state | Special budget |
|---|---|---|---|---|---|
| II Lamphold | SH20: a ring of lamps going out above you (the Snuffing) | Lamp field (≈ 3,000 instanced quads with a per-instance `lit` attribute); snuffable lamps baked to a **separate lightmap layer** blended per region (lit/snuffed); soot and ember shader state | honey sandstone, brass, wax/soot | 22 vertebrae; plaster dust coat; ember seams after snuffing (C1 warm flare → cold) | lamp field 2 draws; +1 lightmap layer ≤ 10 MB |
| III The Mere | SH21: the crown sinking into black water beside you | Water surfaces (scrolling normals, fresnel, depth tint, no reflections or RTs); underwater fog swap; streaming-water vertex shader on plates | wet slate, bronze bell, silt | 24 vertebrae; **wet** = highest specular in the game; drips off plates | ≤ 2 water surfaces |
| IV The Keeping | SH22: holding a Kept still in the lantern cone while swinging | Hooded lantern cone (spot term) with lit bone dust inside the cone; Kept figures (figure kit poses, impostors beyond 40 m) | bone/chalk, ochre plaster, shelf timber | 28 vertebrae; figure-plates prominent; `gather_pull` clip | figures ≤ 8 draws |
| V The Still Flame | SH23/SH24: walking in its shadow through the white Halo; the Stilling climb | Stillness band shader (`uStillY`), inverted grade (fog lighter than forms), beam cones ≤ 3, stilled particles | frozen water (glass-smooth), chalk stone | 32 vertebrae; **stone ramp** per segment (`body.stone`); `bow`, `sealed` clips | beams ≤ 3 cones |

**Per-chapter deliverables.**
- Theme module (E25).
- 2–3 KTX2 texture sets and kit additions.
- Section builds and bakes.
- Chapter grade and particles.
- Creature chapter variant GLB (geometry only; shared atlases) and state shader.
- Chapter `shots.json` and `beats.json`.
- Director replays for its trailer shot.

**Quest cost.** Same §3 ceilings at every E29 set-piece worst moment. Pack ≤ 25 MB.

**Acceptance (headless, per chapter)**
1. `verify-showcase --chapter chN` green: budgets, value bands, no raw boxes within 30 m, programs ≤ 24.
2. The trailer-shot replay renders in both profiles.
3. `asset_budget.mjs` pack ≤ 25 MB.
4. E28 verification gates (the other workflow's) still green.

**Dependencies.** WP10 pipeline, plus the engine chapter framework (E04, E25, E17 states) from the parallel engine
workflow. **Effort.** 144 h, plus about 4–6 h Blender CPU per chapter.

### WP13b: Full trailer (60 s) and final screenshot set

Runs shots 1→11 (ART_AUDIO_PLAN §8) from wonder to the climb, with a 30 s cut (shots 1, 3, 4, 7, 9, 10) and a vertical
1080×1920 cut for social. Acceptance as WP13a. **Effort.** 8 h. **Dependencies.** WP14.

---

## 5. The creature: rig, skinning, clips, layers, integration, fear

### 5.1 Inputs and locks

- **Design.** The creature workflow's r2 *Ossuary Column* (`scratchpad/mason2/final/build_r2.py`; export finished
  11:26):

  | LOD | Triangles | Materials | File |
  |---|---|---|---|
  | Hero (render) | 2.14 M | — | — |
  | Export LOD0 | 124 k | 4 | 29.7 MB PNG-embedded GLB |
  | Export LOD1 | 33 k | 4 | 23.9 MB PNG-embedded GLB |
  | Export LOD2 | 8 k | 4 | 22.0 MB PNG-embedded GLB |

  These exports are **static and posed**, with no armature (audit §2.9).
- **Fixed identity.** "Architecture that learned to hunt": no eyes, no antennae, **no insect mandibles**.
- **Open lock (§9 decision 3).** r2's crown is a rose-window portal-maw: four tracery jaws, stone-tracery fangs, and
  150 throat teeth. The art bible (art.md §8) wants a **toothless stone iris** onto a vaulted nave-throat, and flags
  circular toothed maws as a "taken" trope.
  - The rig supports both. The maw is **4 radial petal chains** (`maw_{n,e,s,w}_{0,1}`) that open **outward around the
    crown axis**, like a rose window splitting. They never close laterally like pincers. Teeth, if kept, are rigid on
    petal bones.
  - Store key art avoids the maw in close-up regardless (gore rules, RELEASE §13).

### 5.2 Armature (≈ 210 deform bones, under the u8 joint limit)

| Group | Bones | Parent | Driven by | Extras |
|---|---|---|---|---|
| `root` | 1 | — | runtime (world, uniform chapter scale) | `length` |
| `neck`, `spine_00…26` | 28 | **`root` (flat)**: runtime writes world frames directly, no parent-local maths | P-SPINE + additive breath/heave | `s` (rest arc length), `k` (girth) |
| `tail_0`, `tail_1` | 2 | `spine_26` | P-SPINE (sampled) | `s` |
| `crown` | 1 | `neck` | base clips + P-FOCUS aim | — |
| `maw_{n,e,s,w}_{0,1}` | 8 | `crown` | clips (iris open/snap), parametric | `axis: radial` |
| `gullet_0..2` | 3 | `crown` (leaf, scale allowed) | clips (peristalsis) | — |
| `arm_00..11_{0,1}` (stone "fronds": raised empty arms) | 24 | `crown` | clips + P-SPRING + P-FOCUS spread | `phase`, `len` |
| `pit_0..4` | 5 | `crown` (leaf scale = dilation) | `pit_dilate` (parametric on `listen`) | — |
| `leg_{L,R}{00..15}_{0..3}` (femur strut / shank / iron metatarsus / grapnel) | 128 | owning `spine_k` | P-GAIT (IK) + additive scrabble | `side`, `slot`, `reach`, `kind`, `simLimb` (−1 = follower) |
| `cage`, `ladder`, `chain_{0..3}_{0,1}` | ≈ 10 | owning spine bone | P-SPRING | — |
| **Total** | **≈ 210** | | | |

**Why a flat spine.**
- The sim gives world positions. A flat spine makes each spine bone's local matrix equal its world matrix, so writing
  the procedural pose is one matrix write and no parent chain walk.
- The authoring CTL rig in Blender can still be a chain (spline IK for set-piece clips), baked to DEF bones before
  export (blender.md B5).

**Length per chapter.**
- E17 grows `seg` from 20 to 32 across chapters, about 30 m to 48 m (ART_AUDIO_PLAN §1.6).
- The generator builds a per-chapter vertebra count. Each chapter has its own geometry-only GLB, about 3 MB, sharing the
  KTX2 atlases.
- The rig samples the sim spline by **normalized arc length** (`u = s / L_rest`), so small sim/rig length mismatches
  stretch evenly.
- Chapter I: set the sim's link spacing so `body.length ≈ 29.5 m`, which matches the approved design. The fallback is a
  uniform root scale of `L_sim / L_rest`.

**Sim legs vs rig legs.**
- The sim drives **10** hooked limbs (`body.limbs[i] = {seg, side, reach, weight, hip, foot, planted, lift}`).
- The rig has **32** legs, 16 per side; r2's hero has 46–53. Beyond about 34, extra legs add CPU, bones and triangles
  for little added read in fog (blender.md B3).
- At load, each sim limb maps to the rig leg on the same side with the nearest rest arc length among the front 20
  (`simLimb` extra).
- The other 22 are **followers** on a retrograde metachronal wave (P-GAIT).

### 5.3 Skinning

- **Rigid where hard.**
  - Every stone, iron strap, plate, petal stone, tooth, grapnel and attachment: weight **1.0** to its owner bone,
    stamped at generation time.
  - Rigid parts are separate islands, so decimation never welds two of them together.
- **Smooth where flesh.** Mortar-flesh, discs, marrow and tendons between vertebra `k` and `k+1` blend
  `t = smoothstep((s − s_k)/(s_{k+1} − s_k))` from `_SPINE_S`.
  - Strut flesh blends spine → femur over the first 20 % of the strut.
  - Petal gums blend the 2–3 nearest petal bones by angle, plus `crown`.
  - Gullet rings blend by depth.
- **Limits.**
  - ≤ 3 influences authored, ≤ 4 enforced (`vertex_group_limit_total`, normalize).
  - Linear blend skinning only: no dual quaternion, no B-Bones (glTF limits, blender.md B8).
  - Twist stays on rigid parts, so candy-wrapping cannot appear.
- **LODs.** Weights go on LOD0 **before** decimating, then limit and normalize run again. All LODs are bound to the same
  joints.

### 5.4 LODs, materials and the creature shader

| LOD | Quest | Ultra | Switch | Notes |
|---|---|---|---|---|
| LOD0 | ≤ 70 k tris, 2 draws | ≤ 130 k, 2 draws | < 25 m (Ultra < 60 m) | full rig |
| LOD1 | ≤ 20 k | ≤ 33 k | 25–60 m | arms 1 bone; maw rigid |
| LOD2 | ≤ 6 k | ≤ 8 k | > 60 m | vista silhouette; legs as a **vertex-animated fringe** (`_LEGPHASE`, the same metachronal phase as P-GAIT), so the leg wave still reads at 60–170 m (art.md §8 test a) |

**Quest shader** (one `MeshStandardMaterial` per atlas, patched through `patchAtmosphere` plus
`masonMaterial.js`). Texture samples ≤ 5 per pixel (albedo, normal, ORM, emissive, detail-array layer):

| Feature | Technique | Cost |
|---|---|---|
| Wet lobe (Quest substitute for clearcoat) | A second GGX lobe **for the lantern light only**, masked by vertex `wet`. Cheaper than clearcoat, which adds a lobe per light plus an env lookup (three.md §2.4) | about 15 ALU |
| Wrap diffuse + back-light translucency | `(N·L + w)/(1 + w)`, plus `saturate(−N·L)·thickness`, tinted blood-amber (thickness from vertex colour) | low |
| Silhouette rim | fog-colour Fresnel rim, so the outline separates from haze (B2 ≥ 1.3:1 against B1) | low |
| Emissive pits | atlas emissive × `body.glow` × pit dilation; glow pierces fog 35–100 % (existing) | free |
| Seam pulse | `_SPINE_S` travelling wave crawling head-ward during listen and attack | free |
| Breathing displacement | normal offset × flesh mask × slow noise; 0 when frozen | vertex, ×2 eyes |
| Plate jitter / lift wave / plate turn | per-`_PLATE` rotation and offset about the plate pivot from a small data texture (the existing per-bone data-texture pattern) | vertex |
| Hide (Stone-Still) | emissive → 0; rim → 0; wet → 0.3; plates settle flush | uniform |
| Chapter states | `wet` (III), dust coat (II), `stone` per segment (V), ember seams (II), stilled tint (V) | uniforms (E17 outputs) |
| Near-eye dither | separate precompiled variant, swapped in within 3 m (WP5) | only when near |

**Ultra.** `MeshPhysicalMaterial` with clearcoat 0.6–1.0 at roughness 0.08–0.2 on wet masks, PMREM env, casts both
shadows.

### 5.5 Clip list (authored at 30 fps; root translation never keyed)

Clip types:
- **Base** clips override only the crown subtree (crown, maw, gullet, arms, pits) plus a neck pose.
- **Additive** clips are converted with `makeClipAdditive` at load.
- **Parametric** clips are paused actions whose `time = value × duration` is set from a sim scalar each frame. That
  gives authored shape with sim-exact timing.

| # | Clip | Type | Length | Bones | Events (action extras) | Used by |
|---|---|---|---|---|---|---|
| 1 | `crown_idle` | base, loop | 4 s | crown, arms, maw closed | — | default |
| 2 | `listen` | base, loop | 3 s | crown tilt sequence, arms tremble, maw clenched | `pulse@0.4,1.6,2.4` | beat 5 |
| 3 | `rear_windup` | base, time-warped to the sim windup (0.5–0.75 s) | 0.75 s | neck rear, arms flare to full ring, maw starts opening | `open@0.55` | beat 8 |
| 4 | `strike` | base | 0.4 s | crown thrust, maw snap | `contact@0.16`, matching the sim's 0.16 s strike lerp | beat 9 |
| 5 | `recoil` | base | 0.45 s | crown recoil, arms fold | — | beat 10 |
| 6 | `roar` (threat display) | base | 2.5 s | full iris open with 10 % overshoot, gullet expand, arms flare | `open@0.55`, `peak@1.1` | Rise exit, sighting turn |
| 7 | `arms_close` (`snuff_close`) | base | 1.2 s | arms close like hands around a flame | `close@0.9` | beat 19 (II) |
| 8 | `take_close` | base | 1.5 s | arms and maw close inward | `dark@1.2` | beat 24 (kill) |
| 9 | `crown_up` | base, hold loop | 2 s | crown vertical, arms trailing | — | beat 14 (Rise) |
| 10 | `knock_x3` | base | 2 s | crown strikes | `knock@0.3,0.8,1.3` | beat 15 |
| 11 | `gather_pull` | base | 4 s | crown + front-4-leg additive | `seat@3.2` | beat 17 (IV) |
| 12 | `bow` | base | 3 s | crown lowers | — | V |
| 13 | `sealed` (finale) | base | 4 s | collapse | `still@3.2` | V endings |
| 14 | `breathe_seams` | additive, loop | 5 s (0.2 Hz) | neck, spine_00..05 heave; `gullet_*` | `exhale@2.1` → seam puffs | beat 20; **off in Listen** |
| 15 | `plate_shiver` | additive, loop | 0.5 s | spine_00..10 micro-roll | — | `jitter` > 0 |
| 16 | `arms_flare` | additive, **parametric** on `frondOpen` | 1 s | arms spread | — | listen, rear |
| 17 | `arms_reach` | additive | 1.5 s | arms toward the focus | — | beat 18 (lantern hunger) |
| 18 | `arms_sweep` | additive, loop | 2 s | arms sweep the air before the lantern | — | beat 7 (Linger) |
| 19 | `pit_dilate` | additive, **parametric** on `listen` and pulses | 1.2 s | pit scale | — | beat 5 |
| 20 | `iris_open` | additive, **parametric** on wind-up phase / `lunge` | 0.6 s | maw petals radial open | `clack@1.0` (full open) | beat 8 |
| 21 | `iris_snap` | additive | 0.25 s | maw slam shut | `clap@0.12` | beat 9 (miss) |
| 22 | `flinch` | additive | 0.6 s | crown recoil, maw clench | — | strike blocked by masonry |
| 23 | `retreat` | additive | 1.5 s | neck pull-back, arms fold | — | `creature:retreat`, false retreat |
| 24 | `scrabble` | additive, loop | 0.8 s | metatarsus and grapnel twitch on all legs | — | beat 10 |

- **Events.** Clip events are read from `gltf.parser.json.animations[i].extras`, because GLTFLoader r170 does not copy
  them to `clip.userData` (blender.md §0.7). They are dispatched to FX and audio at the exact clip time.
- **Animation pass.** Headless keyframing gives competent but stiff motion. A short human pass in the Blender UI on
  `rear_windup`, `strike` and `roar` is recommended (blender.md Part D); these are the moments players remember and
  trailers show.

### 5.6 Procedural layers and per-frame order (`MasonRigView.update`)

```
0  read sim body (+ events since last frame)            // allocation-free
1  clipGraph.update(body, dt)   → base action + crossfade; additive weights; parametric times
2  mixer.update(dt × timeScale) → crown subtree local TRS; additive deltas on spine_00..10, legs
3  P-SPINE  for each spine/tail bone: frame = spineSampler.frameAt(u = s / L_rest)
            (position on centripetal Catmull–Rom through body.spine; forward = arc tangent;
             up = body.up interpolated, orthogonalised; arch heave already in sim spine)
            bone.matrix = frame · additiveDelta(bone)   // delta = bind⁻¹ · mixed (blender.md B9)
4  P-FOCUS  crown aim toward focus target (head | hand | lantern | point) with a critically damped
            lag of 0.3–0.5 s, a 6–10° snap on target switch, and a yaw/pitch cone limit; arms spread
            toward the focus. Instant perfect tracking is forbidden: it reads as a turret (art.md §2.6)
5  P-GAIT   sim legs: analytic 2-bone IK (femur + shank) to limb.foot; metatarsus at a fixed back-bend;
            grapnel aligned to the surface normal; stretch ≤ 1.15 then the foot slides
            followers: retrograde metachronal wave φ_i = φ0 − 2π·i/λ + ω·t, ω ∝ head speed, duty 0.65,
            body undulation phase-led ≈ 2.5 rad (Diaz et al. 2023); foot = projection onto the clinging
            plane (spine point + body.up) at reach; ≤ 4 AABB probes per frame (round-robin, within 15 m of
            the camera) to stop feet floating in the air; plant → view FX event (dust) when within 20 m
6  P-SPRING arms, chains, cage, strands: damped springs with gravity (inverted crawl = chandelier of
            hands); OFF when body.freeze
7  P-JITTER / P-HIDE / P-TIMESCALE → shader uniforms (plate data texture, hide, stone ramp, wet);
            timeScale 0 on frozen bones (Listen, Stilled)
8  bounds: boundingSphere from spine and foot extents (fixes the stale lazy sphere, quest.md §15)
9  LOD select (distance, hysteresis); three uploads one bone texture per frame
```

### 5.7 State and scalar → clip mapping (the existing sim drives everything)

| Sim input (existing unless marked) | Base clip | Additive / parametric | Procedural | FX / audio sync |
|---|---|---|---|---|
| `DORMANT`, `DISTANT` | `crown_idle` | `breathe_seams` 1.0 | gait at a slow ω; springs on | seam puffs on `exhale` |
| `OBSERVING`, `listen` < 0.3 | `crown_idle` | `breathe_seams` 0.6 | focus on head | — |
| `OBSERVING` / listen ≥ 0.3 (or `body.freeze`*) | `listen` | `pit_dilate`(listen), `arms_flare`(frondOpen); **breathe 0** | **true freeze**: legs timeScale 0, springs off, one leg held mid-step | scrape bed cut on the freeze frame (A5); pit pulse chitter on `pulse` |
| `APPROACHING`, `PURSUING` | `crown_idle` | `plate_shiver`(jitter) | gait ω ∝ speed; focus by `focusKind`* | step dust; grit rain if above the player |
| `BURST` | `crown_idle` | `plate_shiver` 1, `arms_flare` 1 | gait at high ω | debris (existing), fog swirl |
| `ATTACK` wind-up (`creature:attack`) | `rear_windup` (time-warped to `windup`) | `iris_open`(phase), plate-lift wave | crown rear from sim `spine[0]` | rising grind locked to the rear; stone clack at `clack` |
| strike (`creature:strike`) | `strike` (`contact` aligned to the event) | `iris_snap` on a miss | spine thrust from the sim lerp | chips, crack decal, clap ≤ 30 ms from the visual |
| `RECOVERING` | `recoil` | `scrabble` 1 → 0 over 0.8 s | gait at very high ω for 0.8 s | click storm, then quiet |
| `creature:retreat` | — | `retreat` | retract along the trail (sim) | — |
| sighting (`creature.sighting`) | `crown_idle` → `roar` at the mid-path turn | — | LOD2 fringe gait | audio delayed by distance / 343 s (A2) |
| `body.linger`* | `crown_idle` | `arms_sweep`, `arms_reach`, `pit_dilate` | focus on the lantern, then the head | pit inhale per dilation; rope haptics |
| `body.hide`* | `crown_idle` (frozen) | all 0 | freeze + plates flush | drone at −12 dB, never silent |
| strike hit (kill) | `take_close` | — | — | Take iris occluder; heartbeat stops as the fade completes |

\* = optional new payload field from WP5. Without it, the view derives it (WP5).

### 5.8 Integration contract with the existing sim

**Reads (unchanged contract, audit §2.7).**
- `body.spine` (Float32Array 20×3), `body.up`, `body.scale`, `body.head`, `body.focus`, `body.limbs[10]`.
- `body.frondOpen`, `body.glow`, `body.lunge`, `body.jitter`, `body.listen`, `body.visible`.
- `creature.sighting`, `creature.state`.
- From E17 when present: `seg`, `wet`, `stone`, `hidden`, `plates`, `rings`.

**Subscribes to bus events** (new for the view; FX and audio already consume some):
- `creature:state`, `creature:attack`, `creature:strike`, `creature:step`, `creature:burst`, `creature:call`,
  `creature:retreat`, `creature:sighting`;
- E17's `creature:path`, `wall:bulge`, `lamp:snuff`.

**Never writes sim state.** The view is pure; determinism and the Node-importable sim rule are untouched (ENGINE_EXTENSIONS §0 rules 1–2).

**Fallback chain.** `MasonRigView` → `CreatureView` (kit) → `StandInCreatureView`. All use the same API and the same
`_fault` reporting.

### 5.9 Fear behaviours (supported beats; numbering from art.md §9)

| Beat | What the player perceives | Trailer value | Rig / clips | Sim hook | FX / sync | Guard | WP |
|---|---|---|---|---|---|---|---|
| 1 The Pour | body pours across the far Vault wall; leg wave ripples; head and tail never in view together | **high** (SH04) | LOD2 fringe gait, `roar` turn | existing sighting | far grind delayed by distance | — | 4, 5, 6 |
| 2 In the Walls | wall panels bulge in sequence beside you, dust from seams, knocks travel | high (SH05) | none (world shader) | E17 `hidden` path, `wall:bulge` | bulge displacement + crack + dust; knock on the bulge peak ≤ 50 ms | bulge ≤ 0.25 m; never underfoot | 5, 10 |
| 3 Grit Rain | grit falls through your light, then the scrape overhead; look up: legs planting on the ceiling | high (SH10) | inverted gait, springs with gravity | head above the player | grit 0.5–1 s pre-cue; plant puffs | cosmetic only | 5 |
| 4 Lamp Dip | lamps dim and flames lean toward something unseen | medium | — | head < 15 m from a lamp | ramp ≥ 0.4 s with the drone envelope | L8 | 5 |
| 5 The Listen | everything stops, one leg raised; the arms open and **slowly turn to your head**; pits dilate | **highest (SH06)** | `listen` + `pit_dilate` + `arms_flare`; freeze | existing `listen` (+ `freeze`) | scrape cut on the frame; chitter on pulses | a fair "be still" telegraph | 4, 5 |
| 6 Stone-Still | it stops at the edge of the light, pits dark, plates flush; it is wall until a leg moves | high (word of mouth) | hide state | `hide` (new) | drone −12 dB | never within 2× the kill radius | 5 |
| 7 The Linger | the crown 3 m away for 1.5–3 s; arms sweep before your lantern | **high (SH12)** | `arms_sweep`, `arms_reach`, `pit_dilate` | `linger` (new; scripted at S9) | pit inhale; rope hum | ≥ 2.5 m Normal, never < 1.0 m | 5 |
| 8 The Rear | the crown rears; arms flare to a ring; plates lift in a wave; the iris opens onto the lit throat | **highest (SH07)** | `rear_windup`, `iris_open`, plate-lift | existing wind-up | grind + clack | telegraph ≥ 0.35 s | 4, 5 |
| 9 The Snap | the body straightens like a thrown chain; on a miss the iris snaps shut and the crown hits the wall behind you | high | `strike`, `iris_snap` | existing strike | chips, crack, clap ≤ 30 ms | no geometry < 0.6 m from the eyes | 5 |
| 10 Recoil and Scrabble | a shiver nose to tail, hooks scrabble to re-grip | medium | `recoil`, `scrabble` | `RECOVERING` | click storm | — | 4 |
| 11 False Retreat | it withdraws; 6 s of silence; a knock behind and above you | medium (audio-led) | `retreat` | E17 path / lull | — | audio never lies | 5 |
| 12 The Spiral | it coils head-first down the spire past you, debris raining | **trailer #2 (SH08)** | crawl on a helix | E17 `path` `spiral-s7` | debris through the lantern light | ≥ 5 m (bot-verified) | 5, 6 |
| 13 Ceiling Crossing | it crosses overhead upside down; arms hang like a chandelier of hands; one brushes your rope | high | springs with gravity | `ropeTouch` (new) | rope haptic thrum | cosmetic | 5 |
| 14 The Rise | five cold points surface out of the fog beneath you, then the ring of arms | high (III: through water) | `crown_up` | path / approach from below | sub rumble rising | slow loom only | 5, 14 |
| 20 Seam Breath | at rest, seams exhale grit in a slow rhythm | medium | `breathe_seams` | DISTANT, OBSERVING | dry hiss per cycle | off in Listen | 4, 5 |
| 24 The Taking | arms close around your view from the edges inward; darkness falls in from the periphery | medium (never in the trailer) | `take_close` | strike hit | stone closing; heartbeat stops at the fade | fade completes before anything is < 0.8 m; no flash | 5 |

Chapter-specific beats (15 Knock Answer, 16 Plate Turn, 17 Gather, 18 Lantern Hunger, 19 Snuff, 21 Leg Forest,
22 Tail Pay-out, 23 Stilled) land in WP14 on the same rig. Their clips are already in §5.5.

**Safety rails** (art.md §11): near-eye ≥ 0.6 m; flash L8; startle budget ≤ 1 loud startle per ~5 min; slow loom near;
no forced view; pits few and large (trypophobia).

---

## 6. The planned five-chapter game

- **One content pipeline.** Kit → section build → bake → KTX2 → section GLB. One creature generator and rig, with
  per-chapter vertebra variants and shared atlases. One `patchAtmosphere` and grade with per-chapter theme values.
- **"Trailer shot first" rule.** Each chapter's first art deliverable is its set-piece trailer shot (CHAPTERS §3.1 rule
  11), rendered through the Director in both profiles. If a chapter slips, the trailer still has its shot.
- **Creature progression** by chapter: wear (I slate and soot, II wax and ember seams, III streaming wet, IV bone dust
  and figure-plates, V chalk-pale and stone ramp) and length (≈ 30 → 48 m). Shader states and geometry variants, never
  new rigs (§5).
- **Budgets per chapter.** The same §3 ceilings; ≤ 24 programs; pack ≤ 25 MB; E29 set-piece worst moments listed in
  each chapter's `shots.json`.

---

## 7. Verification strategy

| Layer | Tool | What it proves | When |
|---|---|---|---|
| Asset | `gltf-transform validate`, `check_rig.mjs`, KTX2 header checks, `asset_budget.mjs` | formats, joints ≤ 255, weights, attributes, no clearcoat in Quest, pack sizes | every export |
| Unit (Node) | clip-graph sweeps, spine sampler, IK feet error, in-scatter mirror, flicker check, bounds containment | maths and mappings | CI |
| Integration (headless Chromium + SwiftShader + mock XR) | `verify-showcase.mjs` (money frames per tier), full-route sweep, e2e descent, perf-alloc | budgets (GL draws, triangles, programs, memory), zero allocation, no console errors, collision unchanged, no raw boxes | every WP |
| Image | `imgmetrics.mjs` (value bands, detail energy, banding, lit air, depth plateaus, blended coverage, silhouette protrusions), SSIM pairs | visual claims as numbers; representativeness of `quest-faithful` | every WP |
| Judgement | vision-judge step (existing `judge_*` pattern) on before/after money frames | "scarier" and "higher quality", plus originality (no eyes, antennae, mandibles) | WP3, WP6, WP10 |
| Device (owner) | OVR Metrics, `ovrgpuprofiler`, `DEVICE_PROTOCOL.md` | GPU p95 ≤ 11.5 ms, CPU p95 ≤ 8 ms, 45-min soak | MS-A, MS-B, MS-C, each chapter |

**The "10×" scorecard** (reported at each milestone, against WP0's baseline):

| Measure | Before | After |
|---|---|---|
| Visible triangles per eye | 17–82 k | 150–380 k |
| Route texel density | ~64 px/m | ≥ 512 px/m |
| Lamps lighting the world | 2 | 13 baked + halos |
| Creature | 5 k rigid | 70 k skinned, ~210 bones |
| Creature clips | 0 | 24 |
| Fear beats | ~5 | 16 in Chapter I + 8 later |
| Creature FX hooks | 1 | 12 |
| Raw boxes within 30 m | many | 0 |
| Per-pixel shader cost | baseline | about +20–40 % |

The last row is reported honestly as a cost, not a feature.

---

## 8. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **No on-device GPU baseline exists** (audit §3). All ms figures are ±2×. If baseline > 7 ms, the art does not fit | med / high | WP0 device protocol before WP6 spend; §3.1 cut list; MS-A device gate |
| R2 | **Store representativeness**: Ultra footage read as Quest footage; screenshots rejected or refunds | med / high | §1.3 provenance policy; `quest-faithful` SSIM test (WP9); manifest validated in WP13 |
| R3 | **Creature design not locked**; maw conflict (fangs vs toothless iris); originality drift toward taken tropes (toothed circular maw, biomech) | high / high | §9 decision 3 before WP3 bakes; the rig supports both; vision-judge originality check; radial-only maw motion |
| R4 | **Pack size**: E29's 15 MB demo pack is incompatible with 2K KTX2 + lightmaps + creature | high / med | ETC1S bulk, UASTC+RDO normals only, shared atlases; §3.2 budget (≤ 45 MB) needs owner sign-off |
| R5 | **Headless keyframing looks stiff**; the strike and rear are the remembered moments | med / high | parametric clips and procedural layers carry most life; a human Blender pass on 3 clips (decision 5) |
| R6 | **super-three multiview fork** diverges from r170 chunks or our `onBeforeCompile` patches; per-eye lantern offset | med / med | adopt only on a measured win; precompile after session start; keep r170 as default |
| R7 | **Baked light vs dynamic events** (crumbling ledges, movers, Chapter II snuffing, Chapter V stillness) | high / med | dynamic objects lit by SH probes + lantern; II uses a separate snuffable lightmap layer; keep 1–2 dynamic env lights |
| R8 | **CPU contention**: Blender bakes and encoders compete with other workflows | high / med | crop tests first (blender.md E4); bake sequentially; schedule off-peak; cache outputs |
| R9 | **SwiftShader cannot measure GPU ms**: late discovery of fill-rate problems | high / high | early device sessions at MS-A; relative A/B trends headless; overdraw and blended-coverage metrics as proxies |
| R10 | **Program and variant growth** (tiers, near-eye variant, decals) causes compile hitches | med / med | ≤ 24 programs per chapter ledger; `compileAsync` in session behind fades; no runtime define toggles |
| R11 | **Skinned culling and bounds** for a 30–48 m body | low / med | per-frame bounds from the sim (WP4 test 4) |
| R12 | **Ownership and merge conflicts**: sim, `game.js` and render files are being edited by other workflows | high / med | contract requests (E01/E17 owners); feature flags; new modules over edits; fallback chain |
| R13 | **Photosensitivity**: new FX (strike, iris clack, Lamp Dip, kill iris) break L8 | med / high | `flicker_check` + FX in CI; ramps ≥ 100–400 ms; `reducedEffects` halves intensity |
| R14 | **Ultra grade drifts from Quest**, making the Ultra look a different game | med / med | one GLSL grade source; WP8 SSIM ≥ 0.98 test with effects off |
| R15 | **ASTC availability or quality** on Quest Browser; HDR ASTC unknown | low / med | probe in WP0; dLDR lightmaps (no HDR dependency); ETC2 fallback automatic |
| R16 | **Quest 3 LCD black levels**: dark money frames look murky on device | high / med | value-band rules (B1 floor); dither; exposure calibration setting (T12); judge device captures, not desktop |
| R17 | **Device capture resolution** (default 1920×1080, variable 36 fps) below the 2560×1440 screenshot spec | med / med | verify MQDH limits; fallback `quest-faithful` renders with honest labelling (decision 1) |
| R18 | **Chapter II–V art depends on the engine chapter framework** (E04, E25, E17) from the parallel workflow | high / high | WP14 starts with trailer-shot greyboxes on stubs; the pipeline is ready from WP10 |

---

## 9. Decisions for the owner

1. **Store honesty policy (R2, R17).** Recommended:
   - The Quest store uses only device captures or `quest-faithful` renders.
   - Ultra goes to the website, press kit and any desktop/PC store, labelled PC.
   - `quest-faithful` renders carry no "captured on device" label.
2. **Download budgets (R4).** Demo ≤ 45 MB, chapters ≤ 25 MB each, total ≤ 145 MB on Quest; the Ultra pack is desktop
   only.
3. **Maw lock (R3).** The r2 tracery-fang portal-maw, or the art bible's toothless stone iris onto a vaulted
   nave-throat. Either rigs the same way; the iris is the safer originality bet. Decide before WP3 bakes.
4. **Multiview.** Run the WP0 device spike (about 1 hour of owner time). Adopt only with ≥ 20 % CPU improvement on the
   worst scene.
5. **Human animation pass** on `rear_windup`, `strike` and `roar` (about 1–2 animator days).
6. **Quest 2** in the listing or not. It adds a tier (WP12).
7. **Triangle contract.** Raise CONTRACT3D's 350 k visible triangles to ≤ 400 k peak, after the WP0 draw and triangle
   sweep on device.

---

## 10. Sources

**Meta (store, capture, performance).** Read through search extracts; developers.meta.com did not resolve from this
sandbox.
- VRC.Quest.Asset.10 ("Captured on" labels; representative screenshots): https://developers.meta.com/horizon/resources/vrc-quest-asset-10/
- VRC.Quest.Asset.7 (trailer length and 16:9): https://developers.meta.com/horizon/resources/vrc-quest-asset-7/
- Store marketing materials (key art judged most strictly): https://developers.meta.com/vr/resources/store-marketing-materials/
- Asset guidelines: https://developers.meta.com/horizon/resources/asset-guidelines/
- VRC checklist: https://developers.meta.com/horizon/resources/publish-quest-req
- Capture MR and VR apps for publishing (1920×1080, 36 fps variable, 20 Mbps): https://developers.meta.com/horizon/resources/video-capture-mr-vr/
- MQDH media capture: https://developers.meta.com/horizon/documentation/unity/ts-mqdh-media/
- Device optimization comparison (Quest 3: 13.8 ms at 72 Hz, < 200 draws, < 1.5 M triangles): https://developers.meta.com/horizon/resources/device-optimization-comparison/
- VRC.Quest.Performance.1: https://developers.meta.com/horizon/resources/vrc-quest-performance-1/
- WebXR performance best practices (KTX2; shadow-casting point lights): https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
- WebXR performance workflow: https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/
- Web multiview: https://developers.meta.com/horizon/documentation/web/web-multiview/
- WebXR fixed foveation: https://developers.meta.com/horizon/documentation/web/webxr-ffr/
- WebXR frame rate API: https://developers.meta.com/horizon/documentation/web/webxr-frames/
- Render scale (1680×1760 per eye at 1.0): https://developers.meta.com/horizon/essentials/render-scale
- Loads, stores, passes (MSAA resolve cost): https://developers.meta.com/vr/blog/loads-stores-passes-and-advanced-gpu-pipelines/
- Project Flowerbed (KTX2, instancing, no post): https://developers.meta.com/horizon/blog/project-flowerbed-a-webxr-case-study/
- Above Par-adowski (baked vertex lighting): https://developers.meta.com/horizon/blog/above-par-adowski-webxr-mini-golf/

**three.js.**
- r176 release (multiview in WebGPURenderer only): https://github.com/mrdoob/three.js/releases/tag/r176
- Issue #20368 (multiview for WebGLRenderer closed): https://github.com/mrdoob/three.js/issues/20368
- Issue #30560 (WebGPURenderer WebGL2 fallback overhead): https://github.com/mrdoob/three.js/issues/30560
- PR #26904 (EffectComposer support in WebXR reverted): https://github.com/mrdoob/three.js/pull/26904
- KTX2Loader docs: https://threejs.org/docs/pages/KTX2Loader.html
- r170 source read locally: `plans/three-full/package` (postprocessing passes, KTX2Loader, meshopt decoder, SkeletonUtils, DecalGeometry present and sized)

**Hardware and display.**
- UploadVR, Quest 3 specs (25 PPD): https://uploadvr.com/quest-3-specs
- Wikipedia, Meta Quest 3: https://en.wikipedia.org/wiki/Meta_Quest_3
- UploadVR, XR2 Gen 2: https://www.uploadvr.com/snapdragon-xr2-gen-2/
- MDN `OVR_multiview2`: https://developer.mozilla.org/docs/Web/API/OVR_multiview2

**Marketing.**
- GameDiscoverCo on trailers (gameplay first; many viewers skip): https://newsletter.gamediscover.co/p/game-trailers-breaking-down-a-key
- Game Developer, the simplest trailer for a store page: https://www.gamedeveloper.com/business/the-simplest-trailer-to-make-for-your-steam-page

**Fear, perception and safety** (via art.md):
- Grupe & Nitschke 2013: https://pmc.ncbi.nlm.nih.gov/articles/PMC4276319/
- Proxemic lingering (arXiv 2508.10586): https://arxiv.org/abs/2508.10586
- Looming speed (BMC Biology 2020): https://bmcbiol.biomedcentral.com/articles/10.1186/s12915-020-00825-0
- Centipede gait (Diaz et al. 2023): https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf
- WCAG 2.3.1: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html

**Project.**
- Research reports: `plans/research/{quest,three,blender,art,audit}.md`
- Docs: `docs/abyssal-tether-3d/{RELEASE,CHAPTERS,ART_AUDIO_PLAN,ENGINE_EXTENSIONS}.md`
- Creature: `scratchpad/mason2/final/r2/{stats.json,export/export_report.json}`, `r1/hero.png`
- Harness: `scratchpad/3d/{e2e/e2e.cjs,review-perf/lib.cjs,video/video.cjs}`
- Code: `src/render/{creatureView,renderer3d}.js`, `src/game.js` (`AT3D.debug`, attract mode, kit loading)
