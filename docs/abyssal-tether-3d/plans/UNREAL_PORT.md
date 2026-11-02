# Unreal Engine port (Quest standalone first)

> Owner decision: move Abyssal Tether to **Unreal Engine**, **Quest standalone first**, built and tested on the owner's **Windows PC with Unreal 5**. The web build stays the reference (and the free demo) until the port passes the same checks.

## What this is, honestly
- **Quest standalone in Unreal is the mobile renderer**: no Lumen, no Nanite, baked lighting, instanced stereo, fixed foveation. Unreal's headline visuals are a PC strength; here the win is steadier frame times, native memory, better tooling and the store path, not a prettier image by itself. The web budget (150 draw calls, 350k stereo triangles, 72 Hz) is the starting target; nothing is measured until it runs on a headset.
- **I cannot run the Unreal Editor in the cloud container** (50+ GB, Epic login). Everything on the Unreal side is written blind and the owner builds it. So the port is split to keep as much as possible verifiable here.
- **Effort (an estimate, not a promise):** months, not weeks. The logic is ~15k lines of JavaScript; the rendering, audio, input and UI (~55k lines) are re-made with engine features.

## What carries over, what is rebuilt
| Part | Web build | Unreal |
|---|---|---|
| Level data, constants, difficulties, story text, voice lines | JSON-exportable (`unreal/data/`) | used as is |
| Game logic (`src/sim/`, 15k lines, no three.js / DOM) | JavaScript | **ported to C++ (`unreal/core/`), verified here against the JS** |
| Models, textures, voice clips | GLB (meshopt, KTX2), OGG | re-exported from the Blender sources (`tools/*.py`) as raw glTF / FBX; textures to ASTC; the clips imported as they are |
| Lighting | custom lightmaps + probes + fog cards | Unreal baked lighting (Lightmass) + exponential height fog; hand-made effects rebuilt in Niagara / materials |
| Audio | WebAudio synthesis (ambience, rope, radio chain) | rebuilt in MetaSounds (or FMOD) |
| Input / VR rig / hands | WebXR | OpenXR via the Meta XR plugin; the grapple guns and hands as Blueprints + C++ |
| Menus, subtitles, story intro | DOM + canvas | UMG widgets |
| Creatures (Mason, skitterlings, Dresser, Holdfast) | rigged GLB + JS brains | skeletal meshes + the C++ brains |

## Method: verify the logic here, build the engine side on the PC
1. **Golden data from the JS** (`unreal/tools/`): `export-data.mjs` writes the constants and Chapter I level data as JSON; `golden-traces.mjs` records the player's state after every fixed step of scripted scenarios (and the existing `tools/abyssal-tether-3d/verify` traces / 3167 baseline values are the larger regression set).
2. **A standalone C++17 library `unreal/core/`** (CMake, no Unreal code): ported module by module, each checked against the golden numbers with `ctest` (doubles, `-ffp-contract=off`, so the arithmetic matches the JS).
3. **The Unreal project** (`unreal/AbyssalTether/`, owner builds) links the library as a module and adds the VR pawn, rope view, level assembly, effects, audio and UI.

## Phases and gates
| # | Deliverable | Gate |
|---|---|---|
| 0 | data export, golden traces, C++ library scaffold, JSON reader | `ctest` green (done) |
| 1 | config, `Level3D` (solids, raycast, sections), player + `Physics3D` (walk, jump, fall, land) | the 7 golden scenarios match to 1e-9 |
| 2 | ropes / `TetherSystem`, grapple targeting, climb, movers, health | the bot traces of `verify` match |
| 3 | objectives, bag, pickups, hint, comms director, threat, creature brains, goggles / holsters / story timelines | the 3167 baseline values match |
| 4 | Unreal project: VR pawn, hands, rope, level assembly, collision, first lit section on the Quest | owner plays section 1 on the headset |
| 5 | all 8 sections, creatures, audio, UI, story intro, voices | a full descent |
| 6 | Quest performance pass, store build | 72 Hz held, budget measured on the headset |

## Owner setup on the Windows PC (do while phases 1-3 run here)
1. Epic Games Launcher, **Unreal Engine 5.5** (or the version Meta's current Unreal docs name; check them before installing).
2. **Visual Studio 2022** with the "Game development with C++" workload.
3. **Android Studio + NDK** as in Epic's Android / Quest setup guide; a Quest 3 in developer mode; Meta Quest Developer Hub.
4. The **Meta XR plugin** (OculusXR) for the chosen engine version.
5. Git + Git LFS (the models and textures are large).
Tell me the exact engine version you installed; I write the C++ for that version.

## Risks / unknowns
- JS and C++ floating point can differ in the last digits (`Math.hypot`, `exp`); traces are compared to a tolerance, and the gameplay-relevant numbers (the 3167) must match exactly.
- The custom lightmap / GI bake and the effects (god rays, lantern shadow, fog) have no one-to-one Unreal equivalent: the look will be re-tuned, not copied.
- Blender sources export fine; the existing GLBs use meshopt / KTX2 (not importable by Unreal): export from the sources.
- Unreal on Quest has long cook / deploy times: iteration is slower than the web build.
