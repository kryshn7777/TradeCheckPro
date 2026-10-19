# THE MASON: CREATURE RIG PLAN (final)

*Lead technical art direction, written 2026-10-19. Companion to
`/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad/plans/GRAPHICS_PLAN.md`,
which holds the tiers, the shared look engine (`src/render/look/`), the verification harness (G00) and the schedule.
This file is the full specification of the rigged, skinned and animated Mason, and of the fear it must produce.*

**Inputs.**
- `plans/research/{blender,three,quest,art,audit}.md`.
- The three candidate plans (quest-fidelity §5, showcase §5, art-direction §6).
- The live sim contract: `src/sim/creature3d.js` (`SEG = 20`, 10 `LIMBS`, the `body` payload).
- `src/render/creatureView.js` (public API, L1–L56, L346+).
- `game.js` (loader lines 70, 985–1026).
- `ENGINE_EXTENSIONS.md` (E01, E17, E25, E26).
- The creature workflow's approved r2 design and export (`scratchpad/mason2/final/r2/{stats.json,hero.png}`,
  `export/{export_report.json,lod0.png}`, 11:59).

**Rules.** Nothing under `/home/user/TradeCheckPro` was edited. No Blender or Chromium was run.

---

## 0. Summary

**What we build.**
- **The body.** The approved r2 *Ossuary Column* is rebuilt in rest pose as a **modular skinned kit**: a crown, 4
  vertebra variants, leg templates and attachments. It is baked into **2 × 2048² atlases** and assembled at load into
  one skinned body for any chapter length.
- **The rig.** About **182 bones** in Chapter I and 221 in Chapter V, always ≤ 255 so joint indices stay 8-bit.
  - Stone and iron are **rigid** (weight 1.0 to the owning bone).
  - **Mortar-flesh is skinned** across neighbouring bones from a per-vertex arc-length coordinate.
  - Weights are never painted by Blender's auto-weighting.
- **Quest cost.** LOD0 ≤ 60 k triangles in Chapter I (cap 70 k), drawn as **2 skinned objects = 4 GL draws**. LOD1 is
  ≤ 18 k and LOD2 ≤ 6 k (the silhouette, and the shadow proxy).
- **The performance.**
  - **25 authored clips** for Chapter I (base, additive, parametric and leg templates), keyed by code with anticipation,
    overshoot and follow-through, and gated by motion metrics.
  - **9 procedural layers** on top of the existing sim: spine on the sim path, leg IK onto level geometry plus a
    metachronal follower gait, a crown and arms that aim at sound, springs, plate jitter, true freeze, hide, breathing
    and tremor, and world reactions. A near-eye safety variant (P-NEAR) sits beside them.
  - Attack clips are **phase-locked to the sim's timers**, so the animation can never drift from the kill timing.
- **The fear.** A fear director in the sim (menace measure, startle budget, linger, hide, false retreat, rise, ceiling
  pass) stages **17 beats in Chapter I and 24 across the game**. A sync layer locks sound, haptics and FX to motion: the
  scrape stops on the very frame the legs stop.

**Why this will be scary.** Fear in VR comes from anticipation, uncertainty, lingering and slow looming, not from
polygons ([Grupe & Nitschke 2013][grupe]; [arXiv 2508.10586][linger]; [BMC Biology 2020][loom]). The rig is designed
around six capabilities:
- **a true freeze:** Troxler fading makes a still, dark Mason vanish in the periphery ([Kanai & Kamitani][troxler]);
- **head-turn attention without eyes** ([Langton, Watt & Bruce 2000][langton]);
- **a leg wave** that reads as life at 60 m ([Diaz et al. 2023][diaz]; [Troje BioMotion][biomotion]);
- a crown that **stops 3 m from your face and stays** ([arXiv 2508.10586][linger]);
- telegraphed fast looms;
- a portal that opens onto a lit, receding throat.

**Packages** (lane M = view, lane S = sim; schedule in GRAPHICS_PLAN §4):

| ID | Package | Effort |
|---|---|---|
| C00 | Identity contract and r2 reconciliation | 5 h |
| C01 | Modular skinned kit in Blender (rest pose, weights, LODs, atlases, attributes) | 32 h + ≈ 2 h CPU |
| C02 | Armature and clip library (25 clips) with motion-quality gates | 26 h (+ 8–16 h optional human polish) |
| C03 | `MasonRigView` runtime (assembly, layers, phase lock, LOD, bounds, fallback) | 30 h |
| C04 | Shading, states, near-eye variant and the lantern leg shadow | 16 h |
| C05 | Fear director (sim, through the E01 split) | 22 h |
| C06 | Sync layer (voice, FX, haptics) | 14 h |
| C07 | Creature acceptance: critic-reviewed sequences, budgets, e2e, device | 10 h |
| | **Total** | **155 h** |

---

## 1. Inputs, locks and identity

### 1.1 Design state (as found at 12:05)

| Item | Value | Source |
|---|---|---|
| Approved design | r2 *Ossuary Column*, seed 1313, spine 29.45 m, **27 vertebrae**, 46–53 leg slots, 2.14 M render triangles, 22 material groups | `r2/stats.json`, `final.log` |
| Crown | Rose-window portal maw: concentric tracery archivolts, four tracery "jaws" (combs), toothed throat, throat ember, bored pits | `r2/hero.png` |
| Game export (11:59) | **Static and posed**. LOD0 124,291 / LOD1 34,354 / LOD2 7,087 triangles in 4 materials (StoneIron, FleshWet, ToothBone, Emissive) with a `_SPINE_S` attribute. No armature, skin or clips | `export/export_report.json` |
| New rigid kit (11:59) | `mason_kit.glb`, 6.3 MB, for today's `CreatureView`: `Mason_Head` 23,763 triangles, 3 segment variants, girder limbs, pits, membranes, 3 fronds | same |
| Today's view | 65 rigid kit parts merged into one weight-1 `SkinnedMesh` (1 draw per eye); 10 girder legs by 2-bone IK; fronds bent in the vertex shader; a per-bone data texture | `creatureView.js` L1–L56 |
| Sim | `SEG = 20` spine points (1.5 m links, tapering 45 %, ≈ 23 m); 10 `LIMBS` (front-weighted); a 360-crumb breadcrumb trail (≈ 108 m) with surface normals | `creature3d.js` L62, L210; audit §2.7 |

**Read of the r2 renders.**
- **Hero:** a vertical portal of stone rings, with tracery fangs, a toothed throat and a warm ember. Strong, but
  head-on it is a round, concentric, toothed opening. That sits close to the "circular toothed maw" trope (art.md §2.9)
  and to the radial "dartboard" read the audit criticised.
- **LOD0 export:** a dark spiky mass. The dorsal spines read well; the leg wave does not yet read.

The identity edits below fix the head-on read without losing r2's horror.

### 1.2 Identity contract (C00; owner decision D3 in the graphics plan)

The fixed identity is **architecture that learned to hunt**. It has no eyes, no antennae and no insect mandibles, and
must not resemble any existing game's creature.

| # | Feature | Rule (the generator and the clips must obey it) |
|---|---|---|
| a | **Portal** | It opens by **telescoping the archivolt orders backward** and **retracting the tracery combs into the jambs**. The cracked **ventral third drops asymmetrically** on two hinges. **The combs never rotate toward each other** (no scissor or pincer motion): that is the mandible read |
| b | **Throat** | When open, the portal shows a **receding vaulted "nave-throat"**: arches diminishing into the dark, with the pits glowing at the bottom. Teeth sit only *inside* the throat, in staggered rows (never a ring), darkening with depth. The rim reads as tracery, not teeth. Recommendation: cut rim-visible teeth by ≥ 50 % against r2 |
| c | **Fronds** | Short fiddlehead clusters, ≤ 0.5× the crown's height. They curl and uncurl only. **No lit tips, and never a symmetric long pair** (the antenna read) |
| d | **Stone arms** (canon: "the ring of raised, empty stone arms") | 8 carved stone forearms in robed sleeves, open empty palms, sooted fingertips, 2 rigid joints each. Placed **asymmetrically** on the outer archivolt (3 high-left, 2 right, 3 low), which breaks the radial symmetry. They *perform* offering, reaching and closing |
| e | **Pits** | 7 deep bored pits (r2), spaced, glowing only at the bottom so stereo reads depth. Never a cluster of small holes (trypophobia: [Cole & Wilkins][holes]) |
| f | **Glow budget** | Pits and throat only, in pale cold `#b8f0e0`. **The throat ember changes from warm to cold** (bible C1: the Mason never emits warm light, except a 0.5 s warm flare after a snuff in Chapter II). Nothing on the body glows |
| g | **Material ratio** | ≥ 85 % masonry and iron on the visible surface. Mortar-flesh ≤ 15 %, only in joints, on the underside and where plates lift. No pipes or tubes (the biomechanical trope) |
| h | **Wall dressing** | r2's rubble collars, oil trails and grit become environment FX and decals (C06, G05), not creature mesh |
| i | **Head-on asymmetry** | The crown at 8 m, reared and head-on, must **fail rotational self-similarity**: correlation with itself rotated by 360°/n, n = 5…12, < 0.85. This is the anti-dartboard gate |
| j | **Originality** | The critic panel flags eyes, face, antennae, pincers, "known creature", "toy" and "scaffolding". All must be absent at 8 m reared and at 60 m crawling |

### 1.3 Decisions this plan takes (to be confirmed by the owner)

| # | Decision | Choice | Why |
|---|---|---|---|
| DM1 | Rig form | **Modular skinned kit, assembled at load** (art-direction), with **arc-length spine sampling** (quest-fidelity, showcase) | One bake serves all 5 chapter lengths (E17). Per-segment states (stone ramp, extra plates, `comeApart`) come for free. Overlapped UVs raise texel density. Arc-length sampling decouples the art's vertebra count from the sim's `seg` |
| DM2 | Legs | **30 boned legs in Chapter I** (10 sim-driven lead, 2 raised forelegs, 18 followers) → 40 in Chapter V, plus a bone-less **rib-leg fringe** (2 per vertebra). r2's broken and stunted extras are rigid | ≥ 50 visible legs so the centipede reads at 60 m (bible §8); beyond ≈ 34 boned legs the extra CPU, bones and triangles add little in fog (blender.md B3) |
| DM3 | Vertebrae per chapter | I 27 (the approved r2 proportions, 29.5 m) · II 28 · III 30 · IV 33 · V 36. Module length scaled so the body runs ≈ 30 → 48 m (ART_AUDIO_PLAN §1.6) | Bones stay ≤ 255 and LOD0 ≤ 70 k in Chapter V |
| DM4 | Quest material | `MeshStandardMaterial` plus patches. **No clearcoat on Quest** | GLTFLoader silently upgrades to `MeshPhysicalMaterial` on `KHR_materials_clearcoat` (three.md §2.4); the look engine's lantern wet lobe gives the wet highlight more cheaply |
| DM5 | Leg shadow | A **custom depth render target** of the LOD2 proxy, once per frame | r170's shadow pass tests caster layers against the *main* camera (`WebGLShadowMap.js` L335), so a shadow-only proxy cannot be built with layers |

---

## 2. Rig specification

### 2.1 Conventions

- **Blender rest pose:** head at the origin facing **+Y**, body along **−Y**, dorsal **+Z**, right side **+X**. This
  exports to glTF **+Y up with the head facing −Z** (three.js forward).
- **Bones:**
  - every bone has **unit scale** in bind pose; taper lives in the mesh;
  - non-uniform scale is allowed **only on leaf bones** (`gullet_*`, `pit_*`), because non-uniform scale under rotation
    cannot be decomposed into glTF TRS (blender.md B3, B8);
  - `bbone_segments = 1` (B-Bones are lost on export);
  - roll: spine local Z = dorsal; leg bones roll to the leg's plane normal.
- **Collections:** `DEF` (deform, exported with `export_def_bones=True`) and `CTL` (authoring only,
  `use_deform=False`).
- **The skinned mesh node** is an identity child of the armature, as glTF requires.

### 2.2 Bone list, naming and counts

All names are canonical and identical across the kit, the clips and the runtime.

| Group | Name pattern | Ch I | Ch V | Parent | Driven by | Bone extras (custom props → glTF node extras → `bone.userData`) |
|---|---|---|---|---|---|---|
| Root | `root` | 1 | 1 | — | identity at the world origin; never animated (root tracks stripped at load) | `{rig:"mason", ver}` |
| Neck | `neck` | 1 | 1 | `root` (flat) | P-SPINE at s = 0 (`body.head` frame) ∘ additive | `{s:0}` |
| Spine | `spine_00` … `spine_26` (Ch I) / `spine_35` (Ch V) | 27 | 36 | `root` (**flat**: world frames written directly) | P-SPINE ∘ additive clips on `spine_00–05` (breath) and `spine_00–10` (shiver) | `{s, k}` = rest arc length (m), girth |
| Tail | `tail_0`, `tail_1` | 2 | 2 | last spine bone | P-SPINE (sampled) + P-SPRING drag | `{s}` |
| Crown | `crown` | 1 | 1 | `neck` | base clips + P-FOCUS | — |
| Portal archivolts | `portal_arch_0..2` | 3 | 3 | `crown` | clips: recede/telescope (translation along the crown axis allowed) | `{order}` |
| Portal combs | `portal_comb_L0`, `_L1`, `_R0`, `_R1` | 4 | 4 | `crown` | clips: retract along their own long axis into the jambs; **never rotate toward each other** | `{axis:"retract"}` |
| Portal hinge | `portal_hinge_0`, `_1` | 2 | 2 | `crown` | clips: asymmetric ventral drop | — |
| Gullet | `gullet_0..2` | 3 | 3 | `crown` | clips: leaf scale (peristalsis) | `{depth}` |
| Pits | `pit_0..6` | 7 | 7 | `crown` | parametric dilate (leaf scale) + per-pit glow in the data texture | `{dir:[x,y,z]}` (pit facing, for sound aiming) |
| Stone arms | `arm_0..7_{0,1}` | 16 | 16 | `crown` | clips + P-FOCUS spread + P-SPRING (secondary only) | `{phase, len}` |
| Fronds | `frond_0..5` | 6 | 6 | `crown` | clips + vertex-shader curl along the bone axis | `{phase, len}` |
| Lead legs | `leg_{L\|R}{NN}_{0..3}` (femur strut + knee pier, shank, iron metatarsus bent back, grapnel) | 10 × 4 = 40 | 40 | owning `spine_k` | **IK to `body.limbs[i].foot`** | `{kind:"lead", simLimb:i, side, slot, s, reach}` |
| Forelegs | `leg_L00_{0..3}`, `leg_R00_{0..3}` | 2 × 4 = 8 | 8 | `spine_00` | clip-raised (listen, rear, linger) + IK when planting | `{kind:"fore", side, slot:0, s, reach}` |
| Followers | `leg_{L\|R}{NN}_{0..2}` (femur, shank, metatarsus; grapnel rigid on `_2`) | 18 × 3 = 54 | 28 × 3 = 84 | owning `spine_k` | **P-GAIT metachronal wave** | `{kind:"follow", side, slot, s, reach, simLimb:-1}` |
| Attachments | `att_cage`, `att_ladder`, `att_bell`, `chain_0_{0,1}`, `chain_1_{0,1}` | 7 | 7 | owning spine bone | rigid / P-SPRING | `{sway}` |
| **Total joints** | | **182** | **221** | | | ≤ 255 keeps `JOINTS_0` u8 (blender.md B3) |

**Notes on legs.**
- `NN` is the slot index from front to back **per side**. Lead legs are built at the sim's `LIMBS` attach points,
  dumped by `dump_sim_contract.mjs` (§3, S1), so each sim limb has a geometric twin.
- Broken and stunted r2 leg slots are rigid geometry on their spine bone, with no bones.
- **The rib-leg fringe** is 2 short iron bars per vertebra. It has **no bones**: the vertex shader animates it from
  `_LEGPHASE` with the gait phase uniform. Visible legs: Chapter I = 30 + 54 + broken extras ≥ 50.

### 2.3 Limits

- ≤ 255 joints (u8 `JOINTS_0`); ≤ 4 influences per vertex (≤ 3 authored). three r170 reads only
  `JOINTS_0`/`WEIGHTS_0`, and the exporter truncates to the top 4 and renormalises (blender.md B4).
- **Linear blend skinning only.** glTF has no dual-quaternion; `use_deform_preserve_volume = False`.
- **Twist clamp:** ≤ 25° of relative twist between neighbouring spine frames, enforced at runtime. Twist is carried on
  rigid parts, which prevents candy-wrapping.
- Bone texture: 182 bones → a 32×32 RGBA32F texture, 16 KB uploaded per frame. three updates a skeleton **once per frame
  per skeleton** (`WebGLObjects.js` L46–54), so crown, body and LOD meshes share one.

### 2.4 Rigid versus skinned parts

**Ownership is recorded at build time**, never painted by heat-map auto-weights, which fail on kitbashed, intersecting
geometry (blender.md B4).

| Part | Weights |
|---|---|
| Vertebra stones, iron straps, carved figure-plates, rebar, pierce hooks, dorsal spines | owner `spine_k` = **1.0** |
| Mortar-flesh, discs, marrow and tendons between vertebrae | `spine_k` / `next` with `t = smoothstep((s − s_k)/(s_{k+1} − s_k))` from `_SPINE_S`. `next` is remapped to `spine_{k+1}` at assembly |
| Neck flesh | `neck` / `spine_00` by `_SPINE_S` |
| Leg strut voussoirs + knee pier | `leg_x_0` = 1.0 |
| Flesh tube at the strut root | `spine_k` → `leg_x_0` over the first 20 % of the strut arc (arc parameter recorded at build) |
| Shank, metatarsus, grapnel | `leg_x_1` / `_2` / `_3` = 1.0; a 2-bone blend only across a 10 cm band where a flesh wrap exists |
| Crown voussoirs, archivolt stones, oculi, pits (stone) | `crown` or `portal_arch_j` = 1.0 |
| Combs, tracery fangs | `portal_comb_*` = 1.0 |
| Ventral third | `portal_hinge_*` = 1.0 |
| Throat teeth | the nearest `gullet_j` or `portal_arch_j` = 1.0 (rigid rows) |
| Gum and flesh between combs and hinges | the 2–3 nearest portal bones by angle + `crown` |
| Gullet rings | `gullet_j` by depth, smooth across 2 bones |
| Pit membranes | `pit_j` = 1.0 (dilation by leaf scale) |
| Stone arms | `arm_n_0` / `_1` = 1.0 (rigid stone joints; no fleshy wrist) |
| Fronds | `frond_n` = 1.0 (curl in the vertex shader) |
| Saliva strands, hanging chains, rope | owner bone 1.0 + a `_SWAY` weight for vertex-shader sway |

### 2.5 Modules and assembly

**Module list** (`MASON_GAME_SPEC.md`, C00). LOD figures are triangles.

| Module | Variants | LOD0 / LOD1 / LOD2 | Material |
|---|---|---|---|
| Crown + neck (portal, combs, hinge, gullet, throat, pits, arms, fronds) | 1 | 20 k / 6 k / 1.5 k | MasonCrown |
| Vertebra (plates, straps, flesh discs, dorsal spines, rib-fringe bars) | 4 | 1.0 k / 0.3 k / 0.08 k (Ch V: 0.9 k) | MasonBody |
| Ring vertebra (back rings for endings) | 1 | 1.1 k / 0.3 k / 0.08 k | MasonBody |
| Figure-plate overlay (hooded backs, raised arms, one wearing the player's gauntlets) | 4 | 0.3 k each | MasonBody |
| Tail | 1 | 0.8 k / 0.25 k / 0.06 k | MasonBody |
| Leg templates: lead/fore (4-bone), follower (3-bone), broken, stunted | 4 | 0.4 k / 0.12 k / 0.03 k | MasonBody |
| Attachments: cage, ladder, bell, chains | 4 | 1.5 k total | MasonBody |

**Assembly** (`masonAssembler.js`; at load behind the loading fade, and also runnable in Node for tests and lab
renders):
1. Read the chapter's vertebra count (§1.3 DM3), lead-leg layout (from `sim_contract.json` baked into the kit's
   extras), follower slots and `extraPlates`.
2. For vertebra k, pick a variant by `hash(seed, k)`. Apply the taper `kprof(s_k)` as a **uniform scale baked into the
   copied geometry** (bones stay unit scale) and offset it along −Y by the cumulative rest length.
3. Remap joint indices from each module's local fragment to canonical bones. `next` → `spine_{k+1}`; on the last
   vertebra, `next` → `tail_0`.
4. Concatenate per material and per LOD; recompute `_spine_s`; build **one `Skeleton`** shared by every LOD mesh.
5. Rebuild only behind a fade (a death or a chapter swap), never mid-play. That covers `extraPlates` added by kills and
   by `gather`.

**Overlapped UVs.** All instances of a vertebra variant and of a leg template share UV islands. One body atlas therefore
serves any length at ≥ 300 px/m.

### 2.6 LODs, materials, maps and attributes

| | Quest | Desktop High / Ultra |
|---|---|---|
| LOD0 | ≤ 60 k Ch I (cap 70 k Ch V), shown < 15 m from the nearest spine point | ≈ 124 k (the same modules at r2 game tessellation) |
| LOD1 | ≤ 18 k, 15–42 m | ≈ 34 k |
| LOD2 | ≤ 6 k, > 42 m, sightings, **shadow proxy**; 1 material, 512² atlas, rib fringe animated | ≈ 8 k |
| Materials (LOD0/1) | **2:** `MasonCrown` (atlas 2048², ≈ 500 px/m) and `MasonBody` (2048², ≥ 300 px/m, overlapped) | same; optional 4K atlases in the Ultra pack |

**Maps per atlas:**
- **albedo**, sRGB, with an **emissive mask in A** (the colour comes from uniforms, cold by C1);
- **normal**, tangent space, MikkTSpace, with **tangents exported**;
- **ORM**: R = AO, G = roughness, B = metalness.

A shared **detail texture array** (512² × 3: masonry, iron, flesh) is fetched once and indexed by material class,
replacing today's 3-fetch triplanar. The fallback is a 2D atlas with `fract()`.

**Vertex attributes** are exported with a leading underscore, and GLTFLoader lowercases them. The total is 11 attribute
slots, under WebGL2's guaranteed 16.

| Attribute | Type | Use |
|---|---|---|
| `_SPINE_S` | float | rest arc length (m): flesh weights, seam pulse, breathing, stone ramp |
| `_MASK` | vec4 | r = flesh, g = wet, b = thickness (SSS), a = class/3 (stone 0, iron 1, flesh 2, bone 3) |
| `_PART` | float | plate id: lift wave, plate turn, jitter pivot |
| `_SWAY` | float | strands and chains |
| `_LEGPHASE` | vec2 | rib-fringe gait phase offset and amplitude |

**Never in Quest assets:** `KHR_materials_clearcoat`, `_sheen`, `_transmission`, `_iridescence`. The asset gate rejects
them.

---

## 3. Blender recipe (bpy 5.2.2, headless, scriptable)

**Folder:** `tools/abyssal-tether-3d/mason/`.

**Interpreter:**
`/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad/blender-venv` (see
`tools/abyssal-tether-3d/README.md`).

**Run discipline:** `nice -n 19`, Cycles `--threads 2`, a 256² crop test before every full bake, and only when the
shared CPUs are free.

| Step | Script / call | What it does | Key settings |
|---|---|---|---|
| S0 | once | `pip install pyoidn==2.5.1.0` into the venv; Node tools from G02 (`@gltf-transform` 4.5.1, `ktx2-encoder` 0.6.0, `meshoptimizer`, `pngjs`) | — |
| S1 | `node tools/abyssal-tether-3d/mason/dump_sim_contract.mjs` | Imports `src/sim/creature3d.js` (three-free) and writes `build/sim_contract.json`: `SEG`, link spacing and taper, the `LIMBS` table (seg, side, reach, forward bias, weight), crown rear distance, hug height | read-only |
| S2 | `build_mason_game.py --rest --seed 1313` (r2 generator promoted from `scratchpad/mason2/final/build_r2.py` with task #2's agreement) | **Rest-pose rebuild**: `spine_pos(s) = (0, −s, 0)`, frame T = −Y, D = +Z, S = +X; legs in a canonical neutral pose (knee pier up, grapnel on a plane 1.6 m below the belly). **Wall-dressing functions still draw their random numbers but emit nothing**, so every other part stays identical to the approved design (blender.md B2) | `--rest` |
| S3 | same, `--modules` | Emits the crown+neck module once, **4 vertebra variants** (r2 vertebrae k = 3, 9, 15, 21, normalised to a 1.09 m rest length with the taper removed), the tail, leg templates and attachments; each in collection `MOD_<name>`. Applies the C00 identity edits (portal kinematics, throat teeth, cold throat glow, short fronds, 8 asymmetric stone arms). LOD2 comes from a **coarse silhouette mode** (`--lod2`: spine tube, leg sticks, crown disc, fringe), not from decimation, so the legs stay crisp at distance | `--modules --lod2` |
| S4 | inside the generator: `with owner(bone, bone2=None, w2=0, blend=None):` | **Ownership stamping.** Every `Acc.add` / `add_tube` writes per-vertex `own_b1`, `own_b2`, `own_w2` and `spine_s`. `blend="spine_s"` computes `w2 = smoothstep(...)` toward `next`; `blend="strut"` blends over the first 20 % of the strut arc. Gum between combs is resolved after the build by angle (2–3 nearest portal bones + `crown`) | §2.4 table |
| S5 | `rig_mason.py` | Builds each module's armature fragment with canonical names (§2.2): `arm.edit_bones.new`, `b.align_roll(...)`, `use_connect` only within leg chains; collections `DEF`/`CTL`; custom props on `arm.bones[n]["s"]`, `["k"]`, `["simLimb"]`, … (blender.md B3 snippet) | unit-scale bones |
| S6 | `rig_mason.py` | **Writes weights** from the stamped attributes (numpy → bmesh deform layer; blender.md B4 `write_weights`), then `vertex_group_limit_total(limit=4)` and `vertex_group_normalize_all`. Parents each mesh to the rig with an identity transform and an Armature modifier with `use_deform_preserve_volume=False`. **Never `ARMATURE_AUTO`** | ≤ 3 influences authored |
| S7 | `rig_mason.py --lods 60000,18000,6000` | Per-module LOD1 by `Decimate` COLLAPSE **after** weighting; rigid stones are separate islands, so nothing welds. Then limit and normalise again. LOD2 from S3's coarse mode, weighted by ownership | verify that the vertex groups survive on the first LOD |
| S8 | `bake_mason.py --uv` | UVs: `smart_project`, then `pack_islands(rotate=True, shape_method='CONCAVE', margin_method='FRACTION', margin=8/2048)`; **overlapped** islands per variant and template. Targets: crown ≈ 500 px/m, body ≥ 300 px/m. Restore UV0 as `active` and `active_render` | island margin 8 px |
| S9 | `bake_mason.py --bake` | **Selected-to-active** from r2's render-resolution parts onto LOD0 (blender.md A3 `bake()` helper): `DIFFUSE{COLOR}` → albedo; `NORMAL` TANGENT → normal; `ROUGHNESS`; metal from class; `AO` at **256 spp** + **pyoidn `RT`** with albedo and normal auxiliaries; `EMIT` → emissive mask (into albedo A). Pack ORM. Bake margin 16 px; cage extrusion ≈ 0.05; max ray ≈ 0.25 (tuned per module). Curvature (Pointiness emission) and cavity are **authoring inputs** for edge wear and grime before the final albedo bake; they are never shipped | ≈ 15–25 min CPU per atlas |
| S10 | `anim_mason.py` | Builds the **clip armature** (canonical names: neck, spine_00–10, the crown subtree, one lead-leg and one follower template) and keys the 25 clips (§4) with the helpers in §4.1. Each action is **stashed on a muted NLA track** (unassigned actions are not exported). Action custom props: `loop`, `kind` (base / additive / parametric / template), `mask` (bone regexes), `phaseLock` (`windup` / `strike` / null), `events` (JSON `[{name, u}]`). Blender 5.x: F-curves live in `action.layers[0].strips[0].channelbag(slot)`; `pose_bone.keyframe_insert(..., group=name)` creates the slot, layer and strip (blender.md §2.1) | 30 fps; root never keyed |
| S11 | `export_mason.py` | Three GLBs: `mason_kit2.glb` (modules + bone fragments + LODs, no animations), `mason_clips.glb` (armature + animations), `mason_kit2_hd.glb` (desktop). Settings below | — |
| S12 | `node tools/abyssal-tether-3d/post.mjs` | `prune({keepAttributes:true, keepExtras:true})`, `dedup`, `ktx2()` per class (crown albedo UASTC; body albedo ETC1S; normals UASTC; creature ORM UASTC), `meshopt` with **`EXT_meshopt_compression`** (r170 cannot read `KHR_meshopt_compression`; blender.md A8). **Not gltfpack**: it drops `_spine_s` and the other custom attributes | → `public/abyssal-tether-3d/assets/models/mason/` |
| S13 | `node tools/abyssal-tether-3d/verify/asset-gate.mjs` + `mason/check_rig.mjs` | Gates in §10.1, plus `rig_report.json` | CI |
| S14 | `lab_render.py` (Cycles, **when CPUs are free**) | Module sheet; the assembled 27-vertebra rest pose; posed crawl S-curve, rear and coil; silhouettes at 8 m and 60 m on grey haze. Feeds the critic (§10.8) | 64–128 spp + OIDN |

**Export settings** (every option checked against the 5.2.40 exporter source, blender.md B6.3):

```python
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
    export_apply=False, export_texcoords=True, export_normals=True, export_tangents=True,
    export_attributes=True, export_extras=True, export_materials="EXPORT", export_image_format="AUTO",
    export_skins=True, export_def_bones=True, export_influence_nb=4, export_all_influences=False,
    export_rest_position_armature=True, export_leaf_bone=False, export_hierarchy_flatten_bones=False,
    export_animations=is_clips, export_animation_mode="ACTIONS", export_merge_animation="ACTION",
    export_force_sampling=True, export_frame_step=1, export_anim_slide_to_zero=True,
    export_optimize_animation_size=True, export_reset_pose_bones=True, export_bake_animation=False,
    export_morph=False, export_lights=False, export_cameras=False,
    export_draco_mesh_compression_enable=False, export_meshopt_compression_enable=False)
```

**Exporter pitfalls** (blender.md §0.7, B8):
- Constraints, IK, Spline IK and drivers are **not exported**. They survive only through sampling, so bake any CTL-rig
  clip to DEF bones first. Spline IK needs `y_scale_mode='NONE'`.
- Action custom props become glTF *animation extras*, but **GLTFLoader r170 does not copy them to `clip.userData`**. The
  runtime reads `gltf.parser.json.animations[i].extras`.
- Timeline and pose markers are dropped: use the `events` prop.
- `KHR_animation_pointer` (material animation) is not loaded by r170: drive materials from code.
- `Coat Weight > 0` exports clearcoat: forbidden in Quest files.
- Custom attributes need a leading underscore and `export_attributes=True`.

---

## 4. Animation clip list (Chapter I: 25 clips)

Clips are authored at 30 fps, in place, and **never key `root`**; root tracks are stripped at load.

**Kinds:**
- **Base:** overrides the crown subtree (`crown`, `portal_*`, `gullet_*`, `pit_*`, `arm_*`, `frond_*`) plus a neck pose,
  unless a mask says otherwise.
- **Additive:** `AnimationUtils.makeClipAdditive` at load, with frame 0 as the reference.
- **Parametric:** a paused action whose `time = value × duration` is set from a sim scalar every frame.
- **Template:** one leg chain, retargeted per leg at load by renaming tracks.

Event times are normalised (`u` ∈ [0, 1]).

| # | Clip | Length | Loop | Kind | Bone mask | What it shows | Fear beat(s) | Events |
|---|---|---|---|---|---|---|---|---|
| 1 | `crown_idle` | 6.0 s | yes | base | crown subtree | archivolts breathe ±2°, combs micro-chatter, fronds slow curl, arms drift asymmetrically | crawl; #20 | — |
| 2 | `listen` | 3.2 s | yes | base | crown subtree + `leg_L00` raised | crown tilts left 8°, holds, then right 6°; **arms open wide and still**; fronds unfurl then freeze; pits pulse | #5 | `pulse@0.125, 0.5, 0.75` |
| 3 | `notice_snap` | 0.45 s | no | base (cross-fade 0.08 s) | crown, arms | after P-FOCUS's lag, a snap with 12 % overshoot; arms twitch toward the sound | #5 | `snap@0.22` |
| 4 | `rear_windup` | 0.75 s | no | base, **phase-locked** to the sim wind-up (0.75 / 0.65 / 0.5 s) | crown subtree + additive `neck`, `spine_00–03` + forelegs | **anticipation dip** (crown −0.2 m, u 0–0.15); rear articulation over the sim's 1.3 m rear; archivolts telescope back; combs retract; ventral hinge drops at 0.6; arms flare to a full ring at 0.85 | #8 | `open@0.6`, `full@0.9` |
| 5 | `strike` | 0.40 s | no | base, **phase-locked** to the sim strike (0.16 s lerp + 0.24 s settle) | crown subtree | thrust articulation; **the portal slams shut at contact** | #9 | `contact@0.4` (= end of the sim strike) |
| 6 | `recoil` | 0.6 s | no | additive | neck, `spine_00–10`, combs, arms | nose-to-tail shiver; comb chatter; arms fold | #10 | `clack@0.08` |
| 7 | `roar_display` | 2.5 s | no | base | crown subtree, neck | full open with 10 % overshoot; gullet peristalsis; arms raised as if offering; pits flare (≤ 3 Hz) | #1 turn, #14 exit, Mark | `open@0.22`, `peak@0.44`, `close@0.84` |
| 8 | `linger_breathe` | 3.0 s | yes | base | crown subtree | arms sweep slowly in front, **feeling the air before the lantern**; pits inhale; crown micro-tilts | #7 | `inhale@0.1, 0.6` |
| 9 | `take_close` | 1.0 s | no | base | crown subtree | arms close around the player's view from the edges inward; portal closes (first-person safe) | #24 | `dark@0.8` |
| 10 | `knock_x3` | 2.0 s | no | base | crown, neck | three crown knocks on the stone, each with anticipation | #15 | `knock@0.22, 0.47, 0.72` |
| 11 | `crown_up` | 2.0 s | yes | base | crown subtree | crown vertical, arms trailing: the rising posture | #14 | — |
| 12 | `coil_grip` | 3.0 s | yes | base | crown subtree + forelegs | the Spiral posture: crown turned inward, arms gripping the column | #12 | — |
| 13 | `breathe_seams` | 5.0 s | yes | additive | neck, `spine_00–05`, `gullet_*` | heave ±3 cm, gullet swell (≈ 0.2 Hz). **Off in Listen and Hide** | #20 | `exhale@0.52` (seam puffs) |
| 14 | `plate_shiver` | 0.5 s | yes | additive | `spine_00–10` (micro-roll) | grinding stone, not uniform noise; weight = `body.jitter` | BURST, ATTACK | — |
| 15 | `arms_flare` | 1.0 s | — | parametric additive | arms | spread by `body.frondOpen` | #5, #8 | — |
| 16 | `arms_reach` | 1.4 s | no | additive | arms (2 nearest the focus lead) | two arms reach toward the lantern, asymmetric | #18, #7 | `reach@0.64` |
| 17 | `arms_sweep` | 2.0 s | yes | additive | arms | sweeping the air before the lantern | #7 | — |
| 18 | `arms_close` | 1.1 s | no | additive | arms | arms close like hands around a flame | #6 hide; #19 (Ch II) | `closed@0.77` |
| 19 | `pit_dilate` | 1.2 s | — | parametric additive | `pit_*` | dilation by `body.listen` + pulses; per-pit weight toward the sound (§5.3) | #5 | `pulse@0.17` |
| 20 | `portal_open` | 0.6 s | — | parametric additive | `portal_*` | opening by wind-up u / `body.lunge` | #8 | `clack@1.0` |
| 21 | `portal_snap` | 0.25 s | no | additive | `portal_*` | slam shut | #9 (miss) | `clap@0.48` |
| 22 | `flinch` | 0.5 s | no | additive | crown, combs | crown recoil, combs clench | debris hit, lamp shatter, strike blocked by masonry | — |
| 23 | `retreat_fold` | 1.4 s | no | additive | neck, arms, fronds | neck pulls back, arms fold flat, fronds curl tight | #11, `creature:retreat` | — |
| 24 | `leg_probe` | 0.8 s | no | template | one 4-bone leg chain | two feeling taps on an unknown surface before planting | #3, #21 | `tap@0.31, 0.62` |
| 25 | `leg_scrabble` | 0.4 s | yes | template additive | one leg chain | frantic re-grip tremor | #10 | — |

### 4.1 Animation principles as code, and motion-quality gates

**Helpers in `anim_mason.py`:**
- `anticipate(bone, axis, amount, f0, f1)`;
- `overshoot(bone, target, pct, settle_frames)`;
- `follow_through(chain, delay_frames=2..4)`;
- `ease()`: Bezier keys with auto-clamped handles;
- `tremble(bone, amp, freq)`: an F-curve `NOISE` modifier, which sampling bakes.

Headless keyframing alone reads stiff (blender.md Part D), so these gates are **hard** (C02):

| Metric | Gate |
|---|---|
| Anticipation | In `rear_windup`, `strike` and `knock_x3`, crown displacement is opposite to the main action in the first 10–20 % of the clip, with ≥ 5 % of the main amplitude |
| Overshoot | `portal_open` and `roar_display` peak 5–15 % above their settle value |
| Follow-through | Neighbouring arms, fronds and combs are phase-offset by ≥ 2 frames |
| Loops | wrap discontinuity ≤ 0.5° on every bone; first and last keys within 0.1° / 1 mm |
| Additives | frame-0 delta is identity within 0.1° |
| Speed | per-bone angular speed ≤ 1,440°/s, except clips flagged `snap` |
| Hygiene | no `root.*` tracks; no tracks outside each clip's mask; the only `spine_*` tracks are in `breathe_seams`, `plate_shiver`, `recoil` and the neck part of `rear_windup` |
| Events | parse; lie inside the clip; phase-locked clips put `contact` and `full` at their documented `u` |
| Dread (soft) | critic score from 8-frame contact sheets ≥ 7/10 for `listen`, `rear_windup`, `linger_breathe`, `take_close` |

**Optional human polish** (8–16 h; owner decision D7) on `rear_windup`, `strike`, `roar_display` and `linger_breathe`.
An animator opens the saved `.blend`, edits on the CTL rig, bakes to DEF (blender.md B5 `bake_action` with all 12
`BakeOptions` fields), and re-runs S11–S13 with the same action names.

### 4.2 Chapter clips (lands with G16)

| Chapter | Clips |
|---|---|
| II | `snuff_close` (`arms_close` + C1 warm flare), `breach_out`, `wedged` |
| III | `plunge_dive`, `bell_knock`, `rise_surface` |
| IV | `gather_pull` (front 4 legs + crown), `tail_payout` |
| V | `bow`, `stone_lock`, `come_apart` (segments → falling figure instances), `settle`, `sealed` |

---

## 5. Procedural layers

### 5.1 P-SPINE: the spine follows the sim path (`spineSampler.js`)

1. **Arc-length table** each frame, with preallocated arrays:
   - (a) a **centripetal Catmull–Rom through `body.spine[0..seg−1]`**, which already contains the sim's mid-length
     arch heave and the wind-up rear;
   - (b) beyond the sim tail, the **breadcrumb trail** through `body.trailSample(s, out)` (§6.5), blended over the last
     link. The art body (29.5 m in Chapter I) is longer than the sim's ≈ 23 m column by design, and continues along the
     path it has already crawled.
   - **Fallback without `trailSample`:** extrapolate along the last tangent, relaxing onto the clinging plane from the
     last `body.up`.
2. **For each spine and tail bone with rest arc length `s_k`:**
   - position = curve(s_k);
   - forward = tangent;
   - up = `body.up` interpolated, Gram–Schmidt orthogonalised;
   - roll limited so neighbouring frames twist ≤ 25°.
3. **The neck** takes `body.head`'s frame (`x,y,z, f*, u*`) at s = 0.
4. **Bone matrix** (flat under `root`, so local = world) = procedural frame ∘ additive delta (§6.8).
5. **The sim stays the gameplay truth.** Kill radius, line of sight and collision use the sim's 20 points; the rig only
   draws.

### 5.2 P-GAIT: leg IK onto level geometry and the metachronal wave (`masonGait.js`)

**Lead legs (10).** Each sim limb `i` maps to the leg whose `simLimb` extra is `i`.
- Analytic 2-bone IK (femur strut + shank) from the hip on the rendered flank to `body.limbs[i].foot` when `planted`.
  The pole points "up off the wall and out", as today's view does.
- The swing arc comes from `limbs[i].lift`.
- The **iron metatarsus holds a fixed back-bend**: the wrong-way ankle.
- The grapnel aligns to the surface normal.
- Stretch is allowed to 1.15×; beyond that, the foot slides.
- An unplanted sim limb gropes (a sway on a slow noise).

**Forelegs (2).** Raised by clips during listen, rear and linger; otherwise they IK-plant near the crown.

**Followers (18 → 28).** A **retrograde metachronal wave** ([Diaz et al. 2023][diaz]):
- phase φᵢ = φ₀ − 2π·i/λ + ω·t, with λ ≈ 7 legs per wavelength and ω ∝ crawl speed;
- duty factor 0.65 when slow, 0.5 when fast;
- the body-undulation phase leads the leg wave by ≈ 2.5 rad.

Foot targets:
- each target is the projection onto the clinging plane (spine point + `body.up`) at the leg's reach;
- **≤ 4 AABB probes per frame** (round-robin, legs within 15 m of the camera) against `level.querySolids`, so feet never
  float in the air;
- the first plant onto a new surface plays `leg_probe`.

**Plant events.** Each plant emits `mason:plant {leg, x, y, z, nx, ny, nz, intensity}` on the bus (C06), rate-limited
to 55 ms like `creature:step`.

**Rib fringe.** Vertex shader: offset = `_LEGPHASE.y × swing(uGaitPhase + _LEGPHASE.x)`. Zero bones.

**Freeze.** All legs hold their pose; **a raised leg stays raised**.

**Cost:** about 0.1 ms in JS for 30 analytic solves (est.).

### 5.3 P-FOCUS: the crown, arms and pits aim at sound (`masonFocus.js`)

- **Target, by `focusKind`:**
  - `head`: breath;
  - `hand`: the noisy rope hand;
  - `lantern`: want;
  - `point`: a sound decoy, such as the knock horns in Chapter IV.

  Without C05 it falls back to `body.focus` (position + amount) and the hearing cause in `creature:burst.reason`.
- **Crown yaw and pitch** are driven by a **critically damped spring**:
  - lag 0.3–0.5 s;
  - cone limits ±70° yaw and ±45° pitch;
  - on a target switch: hold the lag, then **snap 6–10° with 12 % overshoot** (`notice_snap`).

  **Instant perfect tracking is forbidden**: it reads as a gun turret (art.md §2.6).
- **Arms and fronds** spread toward the focus with a 2–4 frame delay per arm.
- **Pits listen directionally.** Each pit's dilation weight is `max(0, dot(pit.dir, toSound))^2`, written to the data
  texture, so the pits facing the sound open widest.

### 5.4 P-SPRING (`masonSprings.js`)

- Damped springs with gravity on arms (secondary only), chains, strands, the cage and the tail.
- During an inverted crawl the arms hang down: a chandelier of hands.
- **Off in freeze and hide.**

### 5.5 P-JITTER (vertex shader)

- Plate shiver: amplitude from `body.jitter`, about each `_PART` pivot.
- A **travelling plate-lift wave** along `_spine_s` during the wind-up and bursts: ≤ 3 cm along the normal, phase-led
  head → tail.

### 5.6 P-TIMESCALE (data texture + mixer)

- A per-bone time scale (0 = true freeze) and per-action `timeScale`.
- Used for Listen, Hide and Chapter V's Stilled (lit segments 0).

### 5.7 P-HIDE (shader + rig)

- Emissive 0, rim 0, wet 0.3.
- Plates settle flush to the wall normal; `arms_close`.
- All motion 0 (Stone-Still).

### 5.8 P-BREATH and tremor

- `breathe_seams` (additive).
- Vertex breathing on the flesh mask: normal offset × slow noise × (1 − freeze).
- A seam pulse crawling head-ward along `_spine_s` during listen and attack.
- Tremor: noise modifiers in `listen` (arms) and `plate_shiver`.
- All of it is **zero during a freeze**, so the contrast tells.

### 5.9 P-WORLD and P-NEAR

- **P-WORLD** (C06, with G03 and G09): Lamp Dip toward 40 % within 15 m, wall bulges (≤ 2 travelling points), grit
  emitters at plants, seam puffs on `exhale`.
- **P-NEAR** (C04): a dither-fade program variant swapped in while any crown vertex is within 1.0 m of the eye. No
  geometry ever comes within 0.6 m.

### 5.10 Per-frame order (`MasonRigView.update`, zero allocation)

| # | Step | Est. Quest CPU |
|---|---|---|
| 0 | Read `body` (and events queued since the last frame) | — |
| 1 | `masonAnimator`: clip graph → base cross-fades, additive weights, **phase-locked and parametric `time` writes** | 0.03 |
| 2 | `mixer.update(dt × timeScale)` | 0.15 |
| 3 | P-SPINE: frames for 30 (Ch I) to 39 (Ch V) neck, spine and tail bones, composed with additive deltas | 0.10 |
| 4 | P-FOCUS: crown, arms, pit weights | 0.02 |
| 5 | P-GAIT: lead IK, followers, ≤ 4 probes, plant events | 0.10 |
| 6 | P-SPRING | 0.05 |
| 7 | P-TIMESCALE / P-JITTER / P-HIDE → data texture (glow, hide, stone, wet, dust, curl, pit weights, plate lift) | 0.05 |
| 8 | `root.updateMatrixWorld(true)` | 0.15 |
| 9 | Bounding sphere from spine and foot extents; LOD select; leg-shadow camera fit | 0.03 |
| | **Total** | **≈ 0.7 ms** (desktop proxy gate ≤ 0.25 ms; ≈ 0.05 ms when hidden) |

three then runs `skeleton.update()` once per frame for the shared skeleton.

---

## 6. three.js r170 integration spec

### 6.1 Modules (`public/abyssal-tether-3d/src/render/mason/`)

| File | Contents |
|---|---|
| `masonRigView.js` | `export class MasonRigView`: the **same public API as `CreatureView`**: `constructor(scene, assets, options)`, `update(creature, dt, camera)`, `setTextures(sets)` (compat no-op), `info`, `dispose()`. Adds `bindBus(bus)` and `isRig = true` |
| `masonAssembler.js` | §2.5 assembly (three-free core + a thin three wrapper) |
| `spineSampler.js` | §5.1 |
| `masonGait.js` | §5.2 |
| `masonFocus.js` | §5.3 |
| `masonSprings.js` | §5.4 |
| `masonAnimator.js` | mixer, clip graph (§6.6), phase lock (§6.7), additive composition (§6.8), event dispatch (`mason:anim`) |
| `masonData.js` | per-bone data texture (RGBA32F, 1 texel row per field group) |
| `masonMaterial.js` | §6.9 shader patch through `patchLook({creature:true})` |
| `masonShadow.js` | §6.10 custom leg shadow |
| `masonDebug.js` | creature-lab hooks (`clip(name, t)`, `perform(behaviour, t)`, layer masks) |

### 6.2 What replaces what

| Today (`creatureView.js`) | New |
|---|---|
| 65 rigid kit parts merged into one weight-1 SkinnedMesh | Assembled modular kit, **continuously skinned** (rigid stone, blended flesh), 2 skinned objects sharing one Skeleton |
| Block scaling by link spacing; gaps and interpenetration at bends | Arc-length sampled spine bones; the flesh discs blend across neighbours; twist clamp |
| 10 girder legs, 2-bone IK | 10 lead legs (IK to the same sim feet) + 2 forelegs + 18 followers on a metachronal wave + a rib fringe |
| 10 fronds bent in the vertex shader around one axis | 8 stone arms (2 bones each, clips + springs) + 6 short fronds (shader curl) |
| 5 pits pulsing | 7 pits with per-pit directional dilation |
| Optional `Mason_Jaw` hinge (absent in the kit) | Portal: archivolts telescope, combs retract, ventral hinge drops; throat revealed |
| Plate jitter: random 9 % lateral at 24 Hz | `plate_shiver` clip + a travelling plate-lift wave |
| Albedo-only triplanar detail (3 fetches) | Baked atlases (albedo, normal, ORM) + a 1-fetch detail array |
| Scalars only (`frondOpen`, `glow`, `lunge`, `jitter`, `listen`, `focus`) | The same scalars drive parametric clips and weights, **plus** 25 authored clips and the C05 `perf` payload |
| Bounding sphere recomputed from the spine and legs | Kept (§6.11) |
| LOD1 only if the kit has `_LOD1` parts (none do) | LOD0/1/2 sharing a skeleton; LOD2 doubles as the shadow proxy |

### 6.3 Loading and the fallback chain

- **`game.js` hook** (through `HOOKS.md`; the integration owner applies it):
  1. Load `assets/models/mason/mason_kit2.glb` + `mason_clips.glb` through `assetLoader` (KTX2 + meshopt).
  2. Construct `MasonRigView`.
  3. On any error, `_fault('masonRigView', err)` and fall back.
- **Fallback chain:** `MasonRigView` → `CreatureView` with `assets/models/mason_kit.glb` → `StandInCreatureView`. All
  three share one API. That kit file is today's 236 KB kit until the creature workflow copies its r2 rigid kit
  (`scratchpad/mason2/final/r2/export/mason_kit.glb`, 6.3 MB) into place; the r2 kit is then the interim look.
- **Flags:** `?mason=rig|kit|standin`. The default switches to `rig` when C07 passes.
- **Precompile:** all creature programs (crown, body, LOD1, LOD2, near-eye variant, shadow depth material) are compiled
  through `compileAsync` on the menu **and** inside the XR session behind the enter-VR fade. Hard gate: 0 links after
  gameplay starts.

### 6.4 Sim payload → rig (existing fields; no gameplay change)

| Sim output | Rig use |
|---|---|
| `body.spine`, `body.up` (Float32Array 20×3) | P-SPINE curve; LOD distance (nearest spine point); bounds |
| `body.scale` | breathing heave amplitude only (taper lives in the mesh) |
| `body.head {x,y,z, fx,fy,fz, ux,uy,uz}` | `neck` frame |
| `body.focus {x,y,z, amount}` | P-FOCUS target and weight until `perf.focusKind` exists |
| `body.limbs[10] {seg, side, reach, hip, foot, planted, lift}` | lead-leg IK; `planted` rising edge → `mason:plant` |
| `body.frondOpen` | `arms_flare` parametric time; frond curl |
| `body.glow` | pit emissive (shaped ≤ 3 Hz, L8) and `pit_dilate` |
| `body.lunge` | `portal_open` time; spine-thrust emphasis on `spine_00–03` |
| `body.jitter` | `plate_shiver` weight; P-JITTER amplitude |
| `body.listen` | `listen` base weight; ≥ 0.9 → true freeze |
| `body.visible`, `creature.sighting` | visibility; LOD2 + fog cap during sightings |
| `creature:state {from, to}` | clip graph |
| `creature:attack {windup}` | arms the `rear_windup` phase lock (duration = `windup`) |
| `creature:strike {hit, x,y,z}` | `strike` contact; miss → `portal_snap` + chips (C06); hit → `take_close` |
| `creature:step {intensity}` | follower phase nudge (the lead plants already emit `mason:plant`) |
| `creature:call` | `roar_display` (muted variant at vista distance) + Lamp Dip |
| `creature:retreat` | `retreat_fold` |
| `creature:burst {snap, reason}` | `notice_snap` + plate-lift wave; `reason` → focus kind |
| E17 (when present): `seg`, `stone[]`, `wet`, `plates`, `hidden`, `rings` | assembler (seg → vertebrae), data texture (stone, wet), visibility (hidden), extra plates |

### 6.5 Contract additions requested from task #6 (E01/E17)

All are read-only, flag-gated and optional; the view has a fallback for each.

| Field / event | Meaning | View fallback when absent |
|---|---|---|
| `body.attack {phase: 'windup'\|'strike'\|'recoil'\|null, u, dur}` | the attack timer, for phase locking | time-warp from the `creature:attack` event timestamp + `windup`, and the `creature:strike` event |
| `body.trailSample(s, out)` (or a read-only `body.trail` view) | world position + surface normal at arc length `s` along the breadcrumb trail | extrapolate the last tangent onto the last `body.up` plane |
| `body.speed` | head crawl speed (m/s) | head displacement / dt, smoothed |
| `body.perf {mode, t, dur, focusKind, focus{x,y,z}, freeze, hide, armsReach, startle}` | C05 staging | freeze ≈ `listen > 0.6 && speed < 0.1`; focusKind from `burst.reason`; hide only when the sim provides it |
| `creature:freeze` / `creature:unfreeze` | true freeze edges | derived from `listen` |
| `creature:linger {phase}`, `creature:hide {phase}`, `creature:retreat {false: true}`, `creature:ropeTouch {hand,x,y,z}`, `creature:knock {count}`, `creature:startle` | C05 beats | — |

### 6.6 Sim state → clips and layers

| Sim state / `perf.mode` | Base clip | Additive / parametric | Procedural | Shader | Audio (C06) |
|---|---|---|---|---|---|
| DORMANT, DISTANT | `crown_idle` | `breathe_seams` 1.0 | slow gait; springs on; focus 0.2 | glow 0.3 | scrape bed gated by motion |
| OBSERVING, listen < 0.3 | `crown_idle` | `breathe_seams` 0.6 | focus on the head, lag 0.4 s | glow 0.5 | low drone |
| Listen (≥ 0.3) / `perf.freeze` | `listen` (+ `notice_snap` on a target switch) | `pit_dilate`(listen), `arms_flare`(frondOpen); **breathe 0** | **true freeze**: legs timescale 0, springs off, `leg_L00` held raised | pits pulse | **bed cut on the freeze frame**; chitter on `pulse` |
| `HIDE` | hold the pose | all 0; `arms_close` | everything frozen; plates flush | **emissive 0**, rim 0 | drone −12 dB (never silent) |
| APPROACHING, PURSUING | `crown_idle` | `plate_shiver`(jitter), breathe 0.3 | gait ∝ speed (duty 0.5); focus 1.0 | glow 0.6 | scrape + plant clicks |
| BURST | `crown_idle` | `plate_shiver` 1, `arms_flare` 1 | gait surge; plate-lift wave | — | burst |
| ATTACK wind-up | `rear_windup` (**phase-locked**) | `portal_open`(u) | crown rear from sim `spine[0]`; focus locked | glow ramp ≤ 3 Hz | rising grind locked to u; clack at `full` |
| Strike | `strike` (**phase-locked**) | `portal_snap` on a miss | spine thrust from the sim lerp | — | **stone clap at `contact`** |
| RECOVERING | `recoil` → `crown_idle` | `leg_scrabble` 1 → 0 over 0.8 s | gait at high frequency | — | click storm, then quiet |
| `LINGER` | `linger_breathe` | `arms_reach`, `arms_sweep`, `pit_dilate` | focus lantern → head; near-eye guard | pits inhale | suction per inhale; rope haptic hum |
| `FALSE_RETREAT` | `crown_idle` | `retreat_fold` | spine retracts along the trail (sim) | glow 0 | fade, then ≈ 6 s silence (breath and heartbeat stay) |
| `RISE` | `crown_up` | `pit_dilate` | slow climb | pits fade up from 0 | sub-rumble rising in pitch |
| `CEILING` | `crown_idle` | — | inverted gait; arms hang under gravity | — | overhead pan; rope thrum on touch |
| `KNOCK_ANSWER` | `knock_x3` | — | — | — | knock + dust + haptic on the same frame |
| Sighting (S4 Pour) | `crown_idle` → `roar_display` (muted) at the mid-path turn | — | LOD2 fringe gait | fog cap | audio delayed by d/343 |
| Strike hit | `take_close` | — | — | — | heartbeat stops as the fade completes |

Cross-fades are 0.15–0.25 s, except `notice_snap` (0.08 s). The clip graph is a pure function of
(state, scalars, perf, events), so it can be unit-tested in Node.

### 6.7 Phase locking

```js
// masonAnimator.js — attack clips are paused actions scrubbed by the sim's own timer (r170 AnimationAction.time/.paused)
const atk = body.attack || this._derivedAttack;            // {phase, u, dur}; derived from events if the sim lacks it
const w = this.act.rear_windup, s = this.act.strike;
const CONTACT = 0.4 * s.getClip().duration;                // strike clip: contact at u = 0.4 (0.16 s of 0.40 s)
if (atk.phase === 'windup') {                              // scrub the whole wind-up clip over the sim's wind-up
  w.enabled = true; w.paused = true; w.time = atk.u * w.getClip().duration; w.setEffectiveWeight(1);
} else if (atk.phase === 'strike') {                       // scrub 0 → contact over the sim's 0.16 s strike lerp
  s.enabled = true; s.paused = true; s.time = atk.u * CONTACT; s.setEffectiveWeight(1);
} else if (atk.phase === 'recoil' && s.paused) {           // after contact the settle tail plays free under `recoil`
  s.paused = false;
}
```

- The animation can never drift from the kill timing, whatever the difficulty's wind-up (0.75 / 0.65 / 0.5 s,
  `DIFF_TUNE`).
- **Event dispatch:** while scrubbing, `masonAnimator` fires each clip event whose `u` the scrub crosses, emitting
  `mason:anim {clip, event, x,y,z}` once per crossing.

### 6.8 Additive composition with the procedural spine (blender.md B9)

```js
// at load, per spine bone (pose before any mixer update): b.userData.bindQuatInv = b.quaternion.clone().invert();
mixer.update(dt);                                         // writes local TRS: crown subtree + additive deltas
for (const b of spineBones) {                             // flat under root: local == world
  _delta.copy(b.userData.bindQuatInv).multiply(b.quaternion);      // additive delta = bind⁻¹ · mixed
  spineSampler.frameAt(b.userData.s, _pos, _q);                    // procedural world frame
  b.position.copy(_pos).addScaledVector(_up, heave);               // heave from breathe_seams translation, if any
  b.quaternion.copy(_q).multiply(_delta);
}
```

The mixer and the procedural code never both "own" a spine bone. The mixer's base for bones that no override action
drives is the binding's original value, so the delta must be extracted, then composed.

### 6.9 Material (`masonMaterial.js`)

`MeshStandardMaterial` per atlas, patched through `patchLook({creature:true})` (GRAPHICS_PLAN G03).

| Feature | Implementation | Cost |
|---|---|---|
| Maps | atlas albedo (emissive mask in A), normal (vertex tangents), ORM; detail array (1 fetch by class) | **4 samples** |
| Wet | the look engine's **lantern wet lobe** on `_MASK.g`; mortar-flesh always ≈ 0.25 roughness | ≈ 15 ALU |
| Flesh | wrap diffuse `(N·L + w)/(1 + w)` + back-light translucency `saturate(−N·L)·thickness` tinted blood-amber, on `_MASK.r` | low |
| Rim | fog-tinted Fresnel rim, so the outline separates from haze (B2 ≥ 1.3:1 against B1) | low |
| Emissive | mask × cold `#b8f0e0` × `body.glow` × per-pit dilation weight; glow pierces fog 35–100 % (as today) | free |
| GI | the irradiance volume sampled **per vertex** (G04), so the Mason darkens in niches and takes lamp colour | vertex |
| States | data texture: glow, hide, **stone ramp** (V), dust coat (breaches), soot and wax (II), wet streaming (III), stilled tint (V), plate lift | uniforms |
| Vertex | breathing on flesh, seam pulse, P-JITTER, rib fringe, frond curl | vertex ×2 eyes |
| Near eye | a separate precompiled dither variant, swapped only within 1.0 m | only when near |

**Quest never uses `MeshPhysicalMaterial`. Ultra** loads `mason_kit2_hd.glb` with clearcoat 0.6–1.0 at roughness
0.08–0.2 on wet masks, sheen on fronds, PMREM, and real shadows.

### 6.10 The lantern leg shadow (`masonShadow.js`, Quest shadow tier)

**Design.**
- A private `shadowScene` holds an **LOD2 proxy `SkinnedMesh` that shares the Mason's `Skeleton`**, using a depth-only
  material.
- A `PerspectiveCamera` sits at the lantern, fitted to the Mason's bounding sphere. FOV ≤ 120°; the shadow is disabled
  when the lantern is inside the sphere.
- It renders into a `WebGLRenderTarget(512, 512, {depthTexture: new DepthTexture()})`, 1024² on High.
- The lantern term samples it: **1 tap**, with a slope bias, branched on the shadow frustum.

**Schedule.** Once per frame, not per eye, at **36 Hz**, before the eye pass. Active only while the Mason is within 25 m
and in the lantern's range; it fades by uniform. The governor can drop it to 18 Hz or off.

**r170 pitfalls (verified):**
1. Save `renderer.xr.enabled` and set it false around the render, or three swaps in the XR `ArrayCamera`
   (`WebGLRenderer.js` L1154–1158; `CubeCamera.js` L132–165 does the same).
2. Save and restore `renderer.getRenderTarget()`, the XR framebuffer.
3. With `renderer.info.autoReset = false` and one reset per frame, so the shadow draw is counted and the main stats are
   not wiped (L1212, L1224).
4. The shadow render bumps `info.render.frame`, so the shared skeleton updates twice in that frame. That is harmless
   (16 KB).

**Cost and fallback.**
- **Quest cost (est.):** ≤ 0.4 ms while active (6 k-triangle depth pass + 1 tap on lit pixels), 0 otherwise; 1 MB.
- **Ships only if** G14's device A/B shows ≤ 0.4 ms. Otherwise the leg-shadow beat is carried by Lamp Dip, grit and
  sound.

### 6.11 Bounds, LOD, near-eye

- **Bounds:** `SkinnedMesh.boundingSphere` is computed once and goes stale (quest.md §15), so it is **set every frame**
  from the spine and foot extents. `hideDistance` 260 m is kept.
- **LOD:**
  - distance from the camera to the **nearest spine point** (not the head): LOD0 < 15 m, LOD1 15–42 m, LOD2 beyond,
    with 2 m hysteresis;
  - a hard switch, covered by fog and motion; a 0.25 s dither cross-fade only if the budget gate allows it;
  - Desktop distances ×2.
- **Near-eye:**
  - the strike target is clamped so the crown never passes within 0.6 m of the eyes on a miss;
  - the dither variant is used within 1.0 m;
  - `take_close` completes its fade before anything is within 0.8 m.

### 6.12 Allocation and determinism

- All scratch vectors, matrices and arrays are preallocated.
- **0 B per frame** steady (`perf-alloc` harness).
- The view never writes sim state, so the sim's Node-importable, seeded determinism is untouched
  (ENGINE_EXTENSIONS §0).

---

## 7. LOD and performance budget

| Item | Quest typical | Quest worst (lunge filling the view) | Desktop High | Desktop Ultra |
|---|---|---|---|---|
| Visible objects / GL draws | 2 / 4 (+1 shadow draw per frame in the shadow tier) | same | 2 / 2 + shadow casters | 2 / 2 + 7 shadow passes |
| Triangles | LOD0 ≤ 60 k (Ch I), cap 70 k; LOD1 ≤ 18 k; LOD2 ≤ 6 k | ≤ 60 k | 124 k | 124 k |
| Bones / influences | 182 (Ch I), 221 (Ch V) / ≤ 4 | | | |
| GPU (est.) | 0.4 ms | **≤ 1.5 ms** (short bursts); leg shadow ≤ 0.4 ms | — | — |
| CPU (est.) | ≈ 0.7 ms visible, ≈ 0.05 ms hidden | ≤ 1.0 ms | | |
| Texture samples per creature pixel | 4 | 4 (+0 for the shadow: the Mason does not receive its own) | 6 | 8 |
| Programs | ≤ 5: crown, body, LOD2, near-eye, shadow depth | | | |
| VRAM | ≈ 40 MB (2 × 3 maps at 2K ASTC + detail array + geometry) | | | |
| Download | ≈ 14 MB (crown UASTC albedo; body ETC1S albedo; UASTC normals; meshopt geometry + clips ≈ 3 MB) | | | |

---

## 8. Fear moments and staging rules

### 8.1 Staging rules (apply to every beat)

| # | Rule | Source |
|---|---|---|
| ST1 | **The anchor is the camera.** The player looks at the next anchor, so reveals are framed through or behind it, along the swing arc, or in the gap a pillar opens as they swing past. Nothing moves the view | art.md §2.7 |
| ST2 | **Gaze only times a reveal.** A scripted reveal holds until the head is within ~35° of it (soft timeout), but gaze never decides *whether* it moves ("moves when unwatched" is rejected as unoriginal) | CHAPTERS §0 |
| ST3 | **It never fits the frame in action space.** At 110° × 96° FOV, a 30 m body fits only from ≥ 13.5 m (48 m: ≥ 21.6 m). Inside that, it always continues behind an occluder or into fog | art.md §2.6 (derived) |
| ST4 | **A known-size object at every reveal** (doorway, statue, lamp, 10 cm chain links). Hands and rope are the body ruler | [Frontiers in VR 2022][bodyscale] |
| ST5 | **The lantern pool's edge (6–10 m) is the glimpse line.** Legs planting just beyond it, catching a sliver of light, are the primary glimpse | art.md L2 |
| ST6 | **Show the cause first:** sound from the exact place, then grit, lamp dip or rope hum, then a part (a leg, an arm, its shadow), then the silhouette, and the whole body only at authored wonder beats | art.md §2.6, A7 |
| ST7 | **Slow loom near; fast loom only after a ≥ 0.35 s telegraph.** Above is the instinctive threat direction; below is vertigo | [BMC Biology 2020][loom]; [Yilmaz & Meister][yilmaz]; [Meehan 2002][meehan] |
| ST8 | **The linger beats the pass:** stopping at 3 m and staying is more arousing than the approach | [arXiv 2508.10586][linger] |
| ST9 | **True freezes in the periphery** (emissive off, motion off) make it vanish, then reappear when a leg moves | [Kanai & Kamitani][troxler] |
| ST10 | **Pressure is paced:** a menace measure withdraws it after sustained pressure; false retreats; ≤ 1 loud startle per ~5 min; screen time ≤ 10 % per chapter | [Alien: Isolation AI][alien] (principle only); CHAPTERS §3.2 |
| ST11 | **Safety:** near-eye ≥ 0.6 m; fades complete before 0.8 m; no flash (≤ 1 pair/s); no forced view; pits few and large | art.md §11 |
| ST12 | **Honest senses:** audio never lies about where it is; silence may hide it | art.md §2.6 |

### 8.2 The 24 beats (Chapter I set marked ●; 17 in Chapter I)

| # | Beat | What the player perceives | Staging | Rig / clips | Sim hook | FX / audio sync | Guard | Ch |
|---|---|---|---|---|---|---|---|---|
| 1 ● | **The Pour** | the body pours across a far wall like liquid masonry; the leg wave ripples; head and tail never in view together | 60–170 m, S4 far wall, framed by the next anchor; lit haze behind (P05 / T2) | LOD2 + low-frequency gait; `roar_display` (muted) at the turn | existing sighting + OBSERVING pause | scrape delayed by d/343; far plate grind | — | I |
| 2 ● | **In the Walls** | stone panels beside you bulge one after another; dust sifts; knocks travel with the bulge | 2–8 m, S5 walls parallel to the route (P06 / T3) | none (world shader) | E17 hidden path, `wall:bulge` | knock on the bulge peak ≤ 50 ms; haptic tick if gripping that wall | bulge ≤ 0.25 m; never underfoot | I, II |
| 3 ● | **Grit Rain** | grit falls through the lantern light, then the scrape overhead; look up: legs planting on the ceiling, dark on haze | creature 8–25 m above, ≤ 10 m horizontal (P11) | inverted gait; `leg_probe`; springs with gravity | head above the player | grit 0.5–1 s before the scrape crescendo; plant puffs and clicks | debris cosmetic | I |
| 4 ● | **The Lamp Dip** | lamps dim and their flames lean toward something unseen | every lamp within 15 m of the crown | P-WORLD L7 | head < 15 m from a lamp | drone envelope drives the dim | ramps ≥ 0.4 s (L8) | all |
| 5 ● | **The Listen** | everything stops, one leg raised mid-step; the ring of arms opens wide and **slowly turns to your head**; the pits facing you dilate in pulses | 6–25 m (P15) | `listen` + `notice_snap` + `pit_dilate` + `arms_flare`; true freeze | `body.listen` / `perf.freeze` | **scrape bed cut on the freeze frame**; chitter on `pulse` | a fair "be still" telegraph | all |
| 6 ● | **Stone-Still** | it stops at the edge of the light, pits dark, plates flush; it is wall until a leg moves | 8–20 m, in the periphery, outside the lantern pool | P-HIDE + freeze + `arms_close` | `HIDE` | drone −12 dB, never silent | never within 2× the kill radius | I, IV |
| 7 ● | **The Linger** | the crown comes to **3 m from your head and stays** 1.5–3 s; the arms sweep the air before your lantern; the pits draw breath | 2.5–4 m at eye height (S9 Mark; P13 / T5) | `linger_breathe` + `arms_reach` + `arms_sweep`; focus lantern → head | `LINGER` (scripted at S9; systemic ≤ 1 per chapter) | pit inhale per dilation; rope haptic hum | ≥ 2.5 m on Normal, never < 1.0 m; no sudden motion | I, IV, V |
| 8 ● | **The Rear** | the crown rears; arms flare to a full ring; plates lift in a wave; **the portal telescopes open onto the lit throat** | within kill radius × 2.5 (P07) | `rear_windup` (phase-locked) + `portal_open` + plate-lift | existing ATTACK wind-up | rising grind locked to u; stone clack at `full` | telegraph ≥ 0.35 s | all |
| 9 ● | **The Snap** | the body straightens like a thrown chain; on a miss the portal slams shut with a stone clap and the crown hits the wall behind you | through the space where you were | `strike` (phase-locked) + `portal_snap` | `creature:strike` | chips + crack decal + clap ≤ 30 ms after contact | crown never < 0.6 m from the eyes | all |
| 10 ● | **Recoil and Scrabble** | a shiver nose to tail; hooks scrabble to re-grip in a frantic leg wave | after a miss | `recoil` + `leg_scrabble`; high-frequency gait | RECOVERING | click storm, then quiet | — | all |
| 11 ● | **The False Retreat** | it withdraws tail-first along its trail; sound fades; ≈ 6 s of silence; a single knock *behind and above* | S7 | `retreat_fold`; spine retract | `FALSE_RETREAT` | silence except breath and heartbeat | audio never lies | I, II |
| 12 ● | **The Spiral** | it coils head-first down the spire past you, legs gripping in a helical wave, debris raining | 6–8 m at your height, S7 (P09 / T4) | `coil_grip` + helical gait | E17 path `spiral-s7` | grinds pan behind → front; debris through the lantern light | ≥ 5 m (bot-verified) | I |
| 13 ● | **Ceiling Crossing** | it crosses overhead upside-down; the arms hang like a chandelier of hands; one **brushes your rope** | 4–8 m above | inverted gait; springs with gravity | `CEILING`, `creature:ropeTouch` | rope haptic thrum + creak spike on contact | cosmetic touch; the rope never breaks | I, II |
| 14 ● | **The Rise** | five cold points surface out of the fog *beneath* you, then the ring of arms, then the crown filling the void below | 30 → 10 m below over 6–10 s (S7/S8 opportunistic; III hero) | `crown_up`; pits fade up | `RISE` | sub-rumble rising in pitch | closing speed ≤ 3 m/s inside 30 m | I (opt.), III |
| 15 ● | **The Knock Answer** | it knocks back on the stone in your rhythm, three times; dust puffs at each knock | E10 knock sites | `knock_x3` | `KNOCK_ANSWER` (E10) | knock + dust + haptic on the same frame | — | I–IV |
| 16 | Plate Turn | as it passes, plates roll a few degrees one after another to face you; one wears your gauntlets | 5–12 m | procedural per-plate roll wave on `_PART` | `PLATE_TURN` | soft grind per plate | — | IV |
| 17 | The Gather | it hooks a statue off a shelf and presses it between its plates; the figure's arm stays raised | 30–40 m, watched from an alcove | `gather_pull` | E17 `gather` | grind, settling knock | — | IV |
| 18 | Lantern Hunger | the crown follows **the lantern, not your head**; the arms reach for it like hands to a fire | any linger | P-FOCUS → lantern; `arms_reach` | `LANTERN_HUNGER` | pit inhale on reach | — | IV, V, Mark |
| 19 | The Snuff | the arms close around a lamp; the light dies with a soft pop and ash; its pits flare warm, then cold | Ch II | `snuff_close`; C1 flare | E17 `snuffRadius` | pop on the light-off frame; dark-adaptation dip | L8 ramps | II |
| 20 ● | **Seam Breath** | at rest, mortar seams exhale grit in a slow rhythm; plates rise and fall a few cm; puffs drift at the light's edge before you see it | DISTANT, OBSERVING, RECOVERING | `breathe_seams` + seam emitters | — | dry exhale hiss per `exhale` | off in Listen (the contrast tells) | all |
| 21 ● | **The Leg Forest** | it passes behind a colonnade at the edge of view; only the wave of legs shows through the gaps | 6–15 m, S6 (P08) | P-GAIT; occluders do the work | PURSUING alongside | clicks match the leg wave | gap-pass rate of backlit legs < 3 Hz (L8) | I, II |
| 22 | Tail Pay-out | the head is long gone; the body is *still coming* out of the breach | Ch IV Gathering | P-SPINE length; LOD along the body | E17 path | a grind that will not end | — | IV |
| 23 | Stilled | in the Flame's light it locks mid-motion; in shadow it lurches like stop-motion | Ch V | P-TIMESCALE per bone; stone ramp | E23 / E17 stillness | scrape cut per lit segment | lurch ≤ 1 m per step near the player | V |
| 24 ● | **The Taking** | the ring of arms closes around your view from the edges inward; darkness falls in from the periphery; later a new figure-plate appears in its body: *it wears you now* | Mason kill | `take_close` + the fade; `extraPlates` + 1 | `creature:strike {hit:true}` | stone closing; heartbeat stops as the fade completes | fade done before anything < 0.8 m; no flash | all |

**Chapter I** ships beats 1–15, 20, 21 and 24 (17, with #14 opportunistic). No scripted beat repeats in the same form;
systemic beats (3–10, 20) recur through the AI and play out differently each time.

### 8.3 The fear director (C05, lane S)

The director lives in `src/sim/creature/director.js`, inside E01's module split. It is three-free and seeded per
section.

- **Menace measure:** it integrates proximity × visibility × threat.
  - Above its ceiling for N s, it schedules a withdrawal or a false retreat.
  - Below its floor, it schedules a pre-cue or an approach.
- **Startle budget:** ≤ 1 loud startle per ~5 min; never in rest spaces.
- **Behaviour picker** with per-beat cooldowns. The modes are `LINGER`, `HIDE`, `FALSE_RETREAT`, `RISE`, `CEILING`,
  `KNOCK_ANSWER`, `PLATE_TURN`, `LANTERN_HUNGER`; the chapter modes (`SNUFF`, `GATHER`, `STILLED`) share E17/E23 hooks.
- **Outputs:** `body.perf` and the events in §6.5. Presets per difficulty and per mode (dormant, sighting, stalk, hunt,
  frenzy, escape).
- **Quest CPU:** ≤ 0.15 ms (≤ 4 extra line-of-sight tests per tick, reusing the existing checks).

---

## 9. Audio sync hooks

**Owner.** Task #6 owns `audio3d.js` (E26). C06 adds `src/audio/masonVoice.js` as a bus subscriber, through the E26
contract.

### 9.1 Events emitted for sync

| Event | Payload | Emitted by | Sound | Visual correlate | Haptic | Timing rule |
|---|---|---|---|---|---|---|
| `mason:plant` | `{leg, x,y,z, nx,ny,nz, intensity}` | `masonGait` on the plant frame | click + grind (by surface) | 4–8 dust and chip particles; hook-bite decal (ring buffer ≤ 64) | light tick within 10 m | audio at the plant frame, ≤ 100 ms after (A1); far: + d/343 (A2) |
| `mason:anim` | `{clip, event, x,y,z}` | `masonAnimator` on event crossing | `open`/`full`: portal grind and clack; `contact`/`clap`: stone clap; `knock`: knock; `inhale`: suction; `exhale`: dry hiss; `pulse`: chitter; `dark`: stone closing | `clap`: chips + crack decal; `knock`: dust puff; `exhale`: seam puffs | `knock`: 3 taps | contacts ≤ 30 ms after the visual (the clap); others ≤ 100 ms |
| `creature:freeze` / `unfreeze` | `{}` | sim (C05) or the view's derived edge | **scrape bed to 0 on the same frame** | motion energy 0 | — | same frame (A5) |
| `creature:ropeTouch` | `{hand, x,y,z}` | sim (C05) | rope creak spike | rope tension flicker | rope thrum | same frame |
| `creature:call` (existing) | `{distance, intensity}` | sim | call | Lamp Dip | — | far: + d/343 |
| `wall:bulge` (E17) | `{x,y,z}` | sim | knock | bulge displacement + crack + dust | buzz if gripping that wall | knock on the bulge peak ≤ 50 ms |

### 9.2 Continuous coupling

- **Scrape bed gain** = f(**rig motion energy**: the sum of leg-bone angular speed plus spine point speed). It is
  published every frame in a shared typed array, not on the bus. When the legs stop, the bed stops on the same frame.
- **Drone** follows the menace measure. Lamp Dip intensity follows the drone's envelope.
- **Distance delay:** far events are scheduled at `ctx.currentTime + min(d/343, 0.6)`. Near events stay tight.
- **Pre-cues** (grit, scrape) are positioned at the exact place of the coming appearance: ≤ 1 m from the first visible
  creature point (A7).
- **Breath and heartbeat** never drop out (A8). False-retreat silence keeps them.
- **≤ 8 concurrent creature voices.** Haptics are rate-limited.

---

## 10. Acceptance tests

All headless tests run in G00's harness. The creature lab replays deterministic sim traces recorded in Node:
`s4-sighting`, `s5-stalk-attack`, `s7-spiral`, `listen-freeze`, `linger`, `false-retreat`, `ceiling-pass`, `rise`.

### 10.1 Asset (C01, C02)
1. `gltf-transform validate` is clean.
2. Joints ≤ 255 assembled at 27, 30 and 36 vertebrae; influences ≤ 4, each set summing to 1 ± 1e-3.
3. Triangles: LOD0 ≤ 60 k (Chapter I assembly), ≤ 70 k (Chapter V); LOD1 ≤ 18 k; LOD2 ≤ 6 k; ± 5 %.
4. Materials: 2 for LOD0/1, 1 for LOD2.
5. Every image is `image/ktx2`. No `KHR_materials_clearcoat`, `_sheen`, `_transmission` or `_iridescence`.
6. `_spine_s`, `_mask`, `_part`, `_sway` and `_legphase` are present.
7. Bone extras: `s` strictly increases along the spine; every lead leg has a `simLimb` 0–9, each used once.
8. **RNG parity:** a hash of the part-parameter stream from `--rest` equals r2's for every non-dressing part.
9. Clip names, durations, `kind`, `mask` and `events` match `clips.json`.

### 10.2 Deformation (Node + three r170 CPU skinning, `applyBoneTransform`)

Poses: crawl S-curve, rear, coil, and ±35° bends at 5 spine bones with IK-posed legs.

| Check | Gate |
|---|---|
| Rigidity | every rigid island (stone, iron, tracery, teeth, arms) keeps its edge lengths within 1 mm |
| Flesh | mean flesh-band edge stretch ≤ 1.5×; ≤ 0.1 % flipped triangles |
| Candy-wrap | flesh-ring cross-section loss < 15 % at a 25° twist |
| Seams | paired seam vertices ≤ 1 cm apart at rest; vertebra-shell gaps ≤ 3 cm at a 60° bend + 25° twist |
| Assembly length | equals the sum of module rest lengths × taper within 2 % |

### 10.3 Clips (C02)
- §4.1 gates (anticipation, overshoot, follow-through, loops, additive identity, speed, hygiene, events).

### 10.4 Runtime (C03)

| Check | Gate |
|---|---|
| Lead legs | planted grapnel tip within 5 cm of `body.limbs[i].foot` (p95), ≤ 15 cm max |
| Followers | planted feet within 10 cm of the clinging plane; planted-foot drift ≤ 2 cm per frame (no skating); no leg beyond 1.15× rest length |
| Spine | origins on the sim curve within 1 mm for s ≤ L_sim; neighbour twist ≤ 25° |
| True freeze | bone matrices bitwise stable for 30 frames during `listen` and `HIDE`; additive weights and spring velocities 0 on the freeze frame |
| Phase lock | `rear_windup` `full` fires within ±1 frame of the wind-up end; `strike` `contact` within ±1 frame of `creature:strike`, at all three difficulties |
| Bounds | the sphere contains 100 % of sampled CPU-skinned vertices every frame of a 600-frame chase |
| Clip graph | Node sweeps of every `CREATURE_STATES` and scalar give the §6.6 weights; no bone jumps > 2° between frames on a cross-fade |
| Determinism | the same seed gives identical bone-matrix hashes in two runs |
| Allocation | 0 B per frame over 600 frames of ATTACK/BURST cycles |
| CPU | `update()` ≤ 0.25 ms median in desktop Chromium (≈ 4× on Quest; device gate ≤ 1.0 ms) |
| LOD | switches at 15 / 42 m ± 2 m with hysteresis; no popping flag from the critic on the LOD sequence |

### 10.5 Look and silhouette (C04)

| Check | Gate |
|---|---|
| Separation | creature mask against its surrounding ring luminance ≥ 1.3:1, *or* rim pixels ≥ 2 % of the mask boundary, at P05, P07, P09 and P15 |
| Wet | the top 1 % luminance in the flesh mask is in B4; the highlight centroid moves when the lantern moves 10 cm |
| Hide | emissive pixels in the mask = 0; plate displacement = 0; bone deltas = 0 over 1 s |
| Glow budget | emissive pixels only inside the pit and throat masks; hue is cold (no warm emitters except the Chapter II flare) |
| **Anti-dartboard** | head-on crown at 8 m reared: rotational self-correlation < 0.85 for n = 5…12 |
| **Leg read** | LOD2 at 60 m, flat black on grey: ≥ 30 leg protrusions counted along the outline |
| Near-eye | in the `linger` and strike-miss traces, the nearest creature fragment is ≥ 0.6 m from the eye (depth readback) |
| Leg shadow | +1 RT render per frame and +6 k triangles in mock XR; a wall ROI behind a crossing leg darkens ≥ 25 %; toggling causes 0 program links |
| Flash | `flash-check` during a wind-up ≤ 2 pairs/s; all other creature states ≤ 1 |

### 10.6 Sim and fear (C05, `fear-sim.mjs`: 50 seeds × 3 difficulties × S4–S8 routes; careful, stall and idle-near-wall bots)

| Behaviour | Gate |
|---|---|
| LINGER | crown 2.5–4 m from the head for 1.5–3 s; ≥ 2.5 m on Normal (≥ 1.0 m on Abyss); ≤ 1 systemic linger per chapter |
| HIDE | never within 2× the kill radius |
| FALSE_RETREAT | creature audio intensity 0 for 5.5–6.5 s while breath and heartbeat stay non-zero; the knock comes from > 120° off the player's facing |
| RISE | closing speed ≤ 3 m/s inside 30 m |
| Telegraph | every strike inside 8 m is preceded by a wind-up ≥ 0.35 s |
| Startle | ≤ 1 `creature:startle` per 5 min |
| Screen time | ≤ 10 % (E28 proxy) |
| Fairness | careful-bot death rate within ±15 % of current tuning; stall deaths still at ~15 / 10 / 6 s |
| Determinism | same hash across two runs; the Chapter I regression (E28 V14) passes |

### 10.7 Sync (C06, `sync-check.mjs`)
- **A1:** contact events, Δ(audio start − visual frame) ∈ [0, 100] ms at p95; the clap ≤ 30 ms.
- **A2:** far events Δ = d/343 ± 40 ms (capped at 0.6 s).
- **A5:** the scrape bed is below −40 dB within ≤ 1 frame of rig motion energy reaching 0.
- **A4:** ≥ 95 % of creature audio emissions within 25 m have a visible correlate within ±100 ms.
- **A7:** the pre-cue position is within 1 m of the first visible creature point.
- The haptic log has an entry for every plant within 10 m.

### 10.8 Rendered frame sequences reviewed by a critic (C07)

Rendered in the creature lab (headless Chromium/SwiftShader, Quest tier: mock-XR left eye 1024×1024 and desktop
1280×720), and again in Desktop High. They are saved as numbered PNG sequences plus an 8-frame contact sheet each, then
scored by the multimodal critic panel (G00 rubric) in **two independent passes**, using the median.

| Seq | Content | Frames | Camera |
|---|---|---|---|
| SEQ-01 | Turntable, LOD0/1/2 at rest and in the crawl | 3 × 36 @ 10° | orbit at 12 m |
| SEQ-02 | **The Listen** (freeze, arms open, crown turn, pit pulses) | 72 @ 24 fps | player pose at 9 m, lantern lit |
| SEQ-03 | **The Rear + Snap** (miss) | 36 @ 30 fps | player pose at 6 m head-on |
| SEQ-04 | **The Linger** | 72 @ 24 fps | player pose at 3 m, lantern in hand |
| SEQ-05 | **The Pour** at 60–170 m | 96 @ 12 fps | S4 catwalk pose |
| SEQ-06 | **The Leg Forest** through a colonnade | 48 @ 24 fps | S6 pose, periphery |
| SEQ-07 | Recoil and Scrabble | 24 @ 30 fps | 8 m |
| SEQ-08 | **Identity:** head-on reared at 8 m, three lighting set-ups (lantern only, lamp, haze back-light) | 3 stills | 8 m |
| SEQ-09 | Stone-Still at the light's edge, then a leg moves | 48 @ 24 fps | periphery at 30° off-axis |
| SEQ-10 | The Taking (first person) | 30 @ 30 fps | eye |
| SEQ-11 | Ceiling Crossing with the rope touch | 48 @ 24 fps | looking up from the rope |
| SEQ-12 | **The Spiral** at 6–8 m | 72 @ 24 fps | S7 pose |

**Pass bar:**
- dread ≥ 7/10 and craft ≥ 7/10 on every sequence;
- **0 identity flags** (eyes, face, antennae, pincers, "known creature") and 0 "toy", "scaffolding" or "dartboard"
  flags;
- in pairwise comparisons with today's kit at matched poses, the new Mason is judged scarier in ≥ 9 of 10 pairs.

Fails go back to C02 (clips) or C04 (material) with the critic's notes. Cycles lab renders (S14) of SEQ-03, SEQ-04 and
SEQ-08 are a lookdev reference, compared by value bands, never by pixel match.

### 10.9 Budgets
- ≤ 2 creature objects (4 GL draws) + 1 shadow draw.
- ≤ 60 k triangles per eye at LOD0 in Chapter I.
- ≤ 5 creature programs; 0 links after gameplay starts.
- Creature-close stereo GL draws +≤ 4 against today.

### 10.10 End to end
- A full bot descent with `?mason=rig` has no console errors; deaths and causes within ±10 % of baseline (the sim is
  unchanged).
- The fallback test (rename `mason_kit2.glb`) ends in `CreatureView` with the rigid kit, then the stand-in.
- `?mason=kit` and `?mason=standin` both boot.

### 10.11 Device [DEVICE]
- OVR Metrics at P07 (Rear), P09 (Spiral), P13 (Linger) and P15 (Listen): GPU p95 ≤ 11.5 ms and CPU p95 ≤ 8 ms.
- A/B against `?mason=standin` gives the creature's own cost: ≤ 1.5 ms GPU at attack coverage, ≤ 1.0 ms CPU.
- Leg shadow ≤ 0.4 ms or it ships off.
- A 45-min soak.

---

## 11. Work packages (lanes M and S)

**C00 · Identity contract and r2 reconciliation · 5 h**
- **Deliverables:** `docs/abyssal-tether-3d/MASON_GAME_SPEC.md` holding:
  - the §1.2 table with paint-over notes on r2's `hero`, `approach`, `full`, `silhouette`, `silhouette_below` and
    `detail` renders;
  - counts per chapter (§1.3);
  - the module list and LOD targets (§2.5);
  - the atlas plan (§2.6);
  - the silhouette tests.
- **Acceptance:**
  - `spec-lint.mjs` (counts within budgets; joints ≤ 255 at 36 vertebrae);
  - the critic panel raises no identity flags on r2's silhouette renders after the paint-over notes;
  - **task #2's sign-off recorded**.
- **Dependencies:** task #2's design freeze.

**C01 · Modular skinned kit (Blender) · 32 h + ≈ 2 h CPU**
- **Deliverables:**
  - steps S1–S9 and S11–S14 (§3);
  - `tools/abyssal-tether-3d/mason/{dump_sim_contract.mjs, build_mason_game.py, rig_mason.py, bake_mason.py, export_mason.py, lab_render.py, check_rig.mjs}`;
  - `assets/models/mason/{mason_kit2.glb, mason_kit2_hd.glb, *.ktx2}`, `rig_report.json`.
- **Acceptance:** §10.1 and §10.2; the lab module sheet reviewed by the critic.
- **Dependencies:** C00; G02 (`post.mjs`, encoders).

**C02 · Armature and clip library · 26 h (+ 8–16 h optional human polish)**
- **Deliverables:**
  - `anim_mason.py` and `mason_clips.glb`;
  - `clips.json`;
  - `docs/abyssal-tether-3d/MASON_ANIM_NOTES.md` (timing sheets, the polish checklist).
- **Acceptance:** §10.3; contact sheets with critic dread ≥ 7/10 on the four hero clips.
- **Dependencies:** C01 (bone names).

**C03 · `MasonRigView` runtime · 30 h**
- **Deliverables:**
  - `src/render/mason/*` (§6.1);
  - the `game.js` loader hook (HOOKS.md);
  - the `creatureView.js` adapter;
  - creature-lab traces.
- **Acceptance:** §10.4, §10.9, §10.10.
- **Dependencies:** C01, C02, G03 (look patch).

**C04 · Shading, states, near-eye and the leg shadow · 16 h**
- **Deliverables:** `masonMaterial.js`, `masonShadow.js`, `masonData.js` state fields, and the near-eye variant.
- **Acceptance:** §10.5.
- **Dependencies:** C03, G03; G04 is optional (volume per vertex; the fallback is the LightProbe).

**C05 · Fear director (sim) · 22 h**
- **Deliverables:**
  - `src/sim/creature/director.js`;
  - the `body.perf` payload and the §6.5 contract fields and events (a contract request to task #6's E01/E17);
  - per-difficulty presets;
  - `tools/abyssal-tether-3d/verify/fear-sim.mjs`.
- **Acceptance:** §10.6.
- **Dependencies:** E01 (task #6) merged.

**C06 · Sync layer · 14 h**
- **Deliverables:**
  - `src/audio/masonVoice.js` (through E26);
  - creature FX in G09's pools: plant dust and chips, strike chips and crack, grit rain, seam puffs, wall-bulge dust,
    hook-bite decals;
  - `lampDip` wiring (G03 uniforms);
  - haptic patterns.
- **Acceptance:** §10.7; FX spawn within 1 frame of their event; pools never allocate.
- **Dependencies:** C03, C05, G09.

**C07 · Creature acceptance · 10 h**
- **Deliverables:**
  - SEQ-01…SEQ-12 rendered and critic-scored (two passes);
  - the budget report;
  - the e2e and fallback runs;
  - [DEVICE] the §10.11 measurements;
  - the switch of the default to `?mason=rig`.
- **Acceptance:** §10.8–§10.11 all green.
- **Dependencies:** C04, C06.

---

## 12. Risks and decisions

| # | Risk | L / I | Mitigation |
|---|---|---|---|
| CR1 | **Headless keyframing looks stiff:** "competent, not terrifying" | high / high | Procedural layers carry most of the life; parametric and phase-locked clips; motion-quality gates; the critic loop; the optional 8–16 h human polish on 4 clips (D7) |
| CR2 | **Identity drift:** the round toothed portal reads as a worm maw; combs as mandibles; fronds as antennae | medium / high | C00 edits; "telescope, never scissor" in the clip gates; the anti-dartboard and critic identity gates at 8 m and 60 m |
| CR3 | **Modular seams** gap or candy-wrap at bends and twists | medium / medium | `next`-bone remap; flesh discs; twist clamp ≤ 25°; seam and stretch gates (§10.2) |
| CR4 | **Design churn** from task #2 (r2 still being edited at 12:00) | high / high | C00 waits for a recorded freeze; the generator is name- and owner-driven, so a re-run is cheap; the portal bones support either hinge style |
| CR5 | **The sim contract** additions slip (E01 is task #6's) | medium / medium | Every addition has a view-side fallback (§6.5); C03 ships without C05 |
| CR6 | Concurrent edits to `creatureView.js` and `game.js` | high / medium | New modules; an adapter; HOOKS.md; the old view kept behind `?mason=kit` |
| CR7 | Bake CPU contention | high / medium | Crop tests; off-peak scheduling; content-hash skips; overlapped UVs mean one bake for every chapter |
| CR8 | Creature fill cost when a lunge fills the view | medium / medium | 4 samples per pixel; no clearcoat; the near-eye variant only when near; governor LOD bias; the device A/B |
| CR9 | Leg shadow too costly on Quest | medium / low | Encounter-only, 36 Hz, LOD2 proxy, governor; it ships off if > 0.4 ms. The beat still works through Lamp Dip, grit and sound |
| CR10 | Photosensitivity from the wind-up glow and pit pulses | medium / high | Pulses ≤ 3 Hz with < 10 % full-field modulation; flash-check in CI |

**Decisions for the owner** (also in GRAPHICS_PLAN §7):
- **D3:** approve the §1.2 identity edits before C01's bakes.
- **D4:** the leg-shadow tier ships only if ≤ 0.4 ms on device.
- **D7:** budget the human polish pass.
- **DM1–DM5** in §1.3 are this plan's technical choices; they change only on new evidence.

---

## 13. Sources

**Locomotion, perception and fear:**
- [diaz] Diaz et al. 2023 (JEB), centipede locomotion; body undulation leads the leg wave by ~2.5 rad: https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf
- Frontiers in Neural Circuits 2021 (retrograde metachronal wave): https://www.frontiersin.org/journals/neural-circuits/articles/10.3389/fncir.2021.706064/pdf
- [biomotion] Troje & Westhoff, the "life detector" (BioMotion Lab): https://www.biomotionlab.ca/the-inversion-effect-in-biological-motion-maybe-there-are-two-of-them/
- [grupe] Grupe & Nitschke 2013, uncertainty and anticipation in anxiety: https://pmc.ncbi.nlm.nih.gov/articles/PMC4276319/
- [linger] Proxemic threat and physiology in VR (arXiv 2508.10586): https://arxiv.org/abs/2508.10586
- [loom] BMC Biology 2020, looming speed and defensive behaviour: https://bmcbiol.biomedcentral.com/articles/10.1186/s12915-020-00825-0
- [yilmaz] Yilmaz & Meister 2013, looming response: https://meisterlab.caltech.edu/documents/8117/yilmaz_2013_looming_response.pdf
- [meehan] Meehan et al. 2002, physiological presence over a virtual pit: https://www.cs.uky.edu/~sgware/reading/papers/meehan2002psysiological.pdf
- [troxler] Kanai & Kamitani, Troxler fading: https://bicr.atr.jp/~kmtn/pdf/KanaiKamitaniJCogNeuroPre.pdf
- [langton] Langton, Watt & Bruce 2000, head orientation as an attention cue: https://storre.stir.ac.uk/bitstream/1893/21045/1/LangtonWattBruce_2000.pdf
- [alien] Game Developer, the AI of Alien: Isolation (pacing principle only): https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation
- [holes] Cole & Wilkins 2013, fear of holes: https://repository.essex.ac.uk/7734/
- [bodyscale] Frontiers in VR 2022, body-based scaling: https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2022.869603/pdf
- Maempel 2011, reporting Dixon & Spitz audio-video sync thresholds: https://www.simpk.de/fileadmin/user_upload_sim/Dokumente/Forschung/Themen/Abteilung_III/Publikationen/Heide_Maempel_2011_Die_Wahrnehmung_audiovisueller_Synchronitaet_in_elektronischen_Medien.pdf
- W3C WCAG 2.3.1: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html

**Pipeline and engine:**
- glTF-Blender-IO exporter manual (sampling, actions, extras): https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst
- Blender 5.0 Python API change log (actions, slots, channelbags): https://docs.blender.org/api/5.0/change_log.html
- Spline IK bake issues: https://projects.blender.org/blender/blender/issues/52063
- B-Bones lost on export: https://discourse.threejs.org/t/load-glf-to-display-animations-with-bendy-bone-exported-by-blender/14199
- three.js AnimationAction (`time`, `paused`): https://threejs.org/docs/#api/en/animation/AnimationAction
- Meta WebXR best practices (no shadow-casting point lights; bake): https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
- Meta device optimization comparison (Quest 3 budgets): https://developers.meta.com/horizon/resources/device-optimization-comparison/
- **Verified locally** in three r170 (`plans/three-full/package/src`):
  - `renderers/webgl/WebGLShadowMap.js` L335;
  - `renderers/WebGLRenderer.js` L1154–1158, L1212, L1224;
  - `cameras/CubeCamera.js` L132–165;
  - `renderers/webgl/WebGLObjects.js` L46–54;
  - `objects/SkinnedMesh.js` (lazy bounding sphere);
  - `animation/AnimationUtils.js` (`makeClipAdditive`);
  - `loaders/GLTFLoader.js` (extras, attribute lowercasing, `EXT_meshopt_compression` only).
- **Verified locally** in the Blender 5.2.40 exporter: `primitive_attributes.py` (u8/u16 joints, top-4 weights),
  `joints.py` (bone extras), `action.py` (animation extras).

**Project inputs (read, not edited):**
- `plans/research/{blender,three,quest,art,audit}.md`
- `plans/plans/{quest-fidelity,showcase,art-direction}.md`
- `src/sim/creature3d.js`, `src/render/creatureView.js`, `src/game.js`
- `docs/abyssal-tether-3d/ENGINE_EXTENSIONS.md`
- `scratchpad/mason2/final/{build_r2.py, r2/stats.json, r2/hero.png, r2/export/export_report.json, r2/export/lod0.png}`

[diaz]: https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf
[biomotion]: https://www.biomotionlab.ca/the-inversion-effect-in-biological-motion-maybe-there-are-two-of-them/
[grupe]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4276319/
[linger]: https://arxiv.org/abs/2508.10586
[loom]: https://bmcbiol.biomedcentral.com/articles/10.1186/s12915-020-00825-0
[yilmaz]: https://meisterlab.caltech.edu/documents/8117/yilmaz_2013_looming_response.pdf
[meehan]: https://www.cs.uky.edu/~sgware/reading/papers/meehan2002psysiological.pdf
[troxler]: https://bicr.atr.jp/~kmtn/pdf/KanaiKamitaniJCogNeuroPre.pdf
[langton]: https://storre.stir.ac.uk/bitstream/1893/21045/1/LangtonWattBruce_2000.pdf
[alien]: https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation
[holes]: https://repository.essex.ac.uk/7734/
[bodyscale]: https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2022.869603/pdf
