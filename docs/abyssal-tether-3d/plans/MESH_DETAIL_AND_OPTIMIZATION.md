# MESH_DETAIL_AND_OPTIMIZATION: richer static props, paid for by a cheaper level (2026-10-29)

Owner brief: "Make the models much more detailed (the random static meshes I mean, currently they look low poly as fuck) while constantly
brainstorming sophisticated and effective optimization strategies." Bar: a $3.99 Quest title; static props near the player must hold up at
arm's length in VR. Hard budget (Quest 3, stereo, every section): <= 150 draw calls and <= 350k triangles, with room left for the creatures
(Mason up close +45-125k, a skitterling about +40k and 7 calls).

Measurement: mock-XR harness (quest tier, stereo, `renderer.info` with autoReset off, dressing finished, max over 4 head yaws at each
section's warp point): `attr.mjs` (per-draw attribution, `renderBufferDirect` wrapped) and `budget-lod.mjs` (`WORST=1 HIDE=1`, the Mason at
14 m). Both are scratchpad tools (see the end of this file). Every level object costs 2 calls (one per eye); the lantern shadow pass is off by
default (owner's call), so it costs nothing in these numbers.

## 1. Audit

### 1a. Where the calls and triangles go (before, calls / stereo triangles)

`attr.mjs`, quest tier, max over 4 yaws at each warp point, no creature, the Dresser out of play:

| Contributor | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 |
|---|---|---|---|---|---|---|---|---|
| decor stone / metal / flesh chunks (section slabs, 32 m detail bands, mid tier, kit LOD sets) | 30 / 69k | 32 / 81k | 46 / 114k | **58** / 113k | 44 / 92k | 46 / 142k | 52 / 129k | 42 / 83k |
| hands + launchers (GLB, untouched) | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k | 22 / 38k |
| pickups / climb studs / UI / debris | 18 / 16k | 10 / 15k | 12 / 17k | 10 / 13k | 16 / 11k | 8 / 10k | 8 / 17k | 8 / 16k |
| anchor mounts (4 shapes) + glyphs | 6 / 12k | 6 / 15k | 8 / 17k | 8 / 17k | 8 / 17k | 8 / 19k | 8 / 12k | 6 / 10k |
| fx / fog / god rays / dust / sky / contact shadows | 12 / 2k | 14 / 3k | 12 / 2k | 14 / 3k | 12 / 2k | 14 / 3k | 14 / 3k | 12 / 1k |
| scene detail (props, decals, puddles) | 6 / 8k | 6 / 9k | 6 / 7k | 6 / 5k | 6 / 8k | 6 / 8k | 6 / 3k | 6 / 9k |
| colossal silhouettes | 4 / 3k | 6 / 4k | 6 / 3k | 6 / 3k | 6 / 4k | 6 / 5k | 6 / 8k | 4 / 7k |
| decor glow / light shafts | 4 / 4k | 4 / 4k | 4 / 4k | 4 / 4k | 4 / 5k | 4 / 10k | 4 / 9k | 4 / 8k |
| body, solids, seals, decals, cogs, light glows | 14 / 21k | 14 / 20k | 14 / 22k | 16 / 23k | 16 / 22k | 16 / 19k | 16 / 26k | 12 / 23k |
| creature placeholders / the Dresser's far view | 2 / 0k | 2 / 0k | 2 / 0k | 4 / 7k | 2 / 0k | 6 / 7k | 4 / 0k | 2 / 0k |
| **total** | **118 / 172k** | **116 / 189k** | **132 / 225k** | **148 / 227k** | **136 / 199k** | **136 / 261k** | **140 / 245k** | **118 / 195k** |

Findings:
- **The calls are the binding constraint, not the triangles.** S4 sits at 148 of 150 with no creature (a Mason adds 4-7, a skitterling 7),
  while the worst triangle count is S6 at 261k of 350k.
- **42 % of every frame's calls are the lit decor of three materials.** One section's stone alone was 14 draws per eye at S4: four 40 m
  section slabs, four 32 m detail bands, two mid-tier bands and four kit-LOD sets (one per section / material / slab); metal 11, flesh 4.
  Many of them hold a few hundred triangles (`decorlod_metal_2_s2`: 0.2k). Some draw nothing at all: three.js still issues (and counts) a
  draw for an empty draw range, so a LOD set whose records are all beyond their limit cost 2 calls for 0 triangles.
- Already done before this pass (so NOT new wins): section culling (head section +-1, neighbours to 28 m x detail scale), fog-far culling
  (`_cullT`), kit LODs per placement, buried-face culling, fixed foveation 0.5 at governor level 0 (1.0 from level 1), the lantern shadow
  map off by default (owner's call), hand / body meshes simplified, the creatures' LOD switches.

### 1b. The props the player sees closest, and the 15 worst offenders

What the player sees within arm's / rope's length: the ledge he stands on (scene-detail props: bones, rubble, crates, barrels, tools,
chains, candles), the anchor he aims at and the chain it hangs from (59 giant chains, up to 24 links each, ~1,300 links in the level), the
Lanternwright statues at the Threshold (the first view of the game) and in S7 / S8, the wall dressing within ~10 m (kit parts: lanterns,
corbels, pipe runs, gear trains; those already have Blender-built rich levels), seal gratings underfoot. Close-up audit shots: scratchpad
`meshes/shots/before/*.png` (the committed tree, `closeups.mjs`).

| # | Prop (system) | Triangles before | Why it reads "low poly" |
|---|---|---|---|
| 1 | Lanternwright statue (`DECOR.statue`, 8 in the level, 6.4-34 m tall) | **~150** | a 7-sided cylinder robe, a box arm, a box lantern, a 5-sided staff: the Threshold's first view |
| 2 | Giant chain link (`DECOR.chain`, ~1,300 links) | 36 a link | a torus with a TRIANGULAR section (3 x 6): every anchor hangs from these |
| 3 | Barrel (scene detail) | 185 | ten 3-sided staves, a 3-sided hoop |
| 4 | Skull (scene detail) | 104 | an 80-triangle icosphere with painted sockets and two boxes for jaws |
| 5 | Small hanging chain (scene detail `chain4` / `chain7`) | 162 / 252 | links are 3-sided 5-segment loops |
| 6 | Broken crate (scene detail) | 120 | eleven boxes, no planks, no nails |
| 7 | Smashed crate (scene detail) | 84 | seven boxes |
| 8 | Dead hand lantern (scene detail) | 128 | boxes and a 20-triangle blob for glass |
| 9 | Femur / broken femur (scene detail) | 75 / 54 | a 5-sided tube with two 20-triangle blobs |
| 10 | Bucket (scene detail) | 72 | eight flat faces, a 3-sided handle |
| 11 | Rope coil (scene detail) | 148 | two 4-sided rings |
| 12 | Pickaxe / hammer / shovel / crowbar (scene detail) | 70 / 32 / 36 / 50 | 5-sided handles, box heads |
| 13 | Rubble block (scene detail) | 80 | an 80-triangle blob |
| 14 | Anchor mounts (instanced, ~15 in view) | ~700 | a plain box wall plate, 6-sided bolts, a 4 x 8 shackle eye (the ring itself is fine: 448) |
| 15 | Seal gratings / bell / counterweight / keystone (`seal_bars`, instanced boxes) | 12 a bar | sharp unbevelled boxes underfoot |

Not offenders: the kit parts (corbels, capitals, lanterns, pipe runs, gear trains, statues in niches) already have Blender-built rich levels
within 6.4 m on Quest; the far silhouettes and colossi are fog-bound. Items 1-13 are rebuilt in this pass (section 3); 14-15 are listed
with a plan (section 2, rejected / deferred).

## 2. Optimisation strategies (every idea: what, expected, measured, risk, verdict)

PENDING

## 3. Detail pass

PENDING

## 4. Verification

PENDING
