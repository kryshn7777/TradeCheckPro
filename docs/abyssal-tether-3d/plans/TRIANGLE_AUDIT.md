# TRIANGLE_AUDIT: which meshes cost the most triangles, and what could be cheaper (2026-11-03)

Question: "see what meshes are consuming a lot of triangles and if we can eliminate them or replace them with a cheaper version".

Method: every shipped GLB read directly (accessor counts of each mesh primitive; instances counted from the node list), then cross-checked
against how the runtime uses it (which LOD, from what distance, how many at once, doubled for stereo). Numbers are triangles, not vertices.
`MESH_DETAIL_AND_OPTIMIZATION.md` has the static-level audit (draw calls and the level's decor); this file covers the character and prop GLBs
that doc left "untouched", plus the creatures' LOD chains.

## 1. The shipped models

| File | Size | Meshes (triangles) | In the runtime? |
|---|---|---|---|
| `mason_rig.glb` | 5.4 MB | LOD0 **63,361** (4 parts), LOD1 23,239 | yes: the Mason, LOD0 within 38 m, LOD1 beyond |
| `skitter_rig.glb` | 5.3 MB | LOD0 **56,722**, LOD1 20,677 | yes: skitterlings, LOD1 from 6 m out to the fog, LOD0 only on top of you |
| `mason_hero.glb` | 4.4 MB | 83,714 (21,000-triangle head + 15 modules) | **no loader**; already excluded from the PWA precache |
| `mason_kit.glb` | 4.3 MB | 34,972 (21,000-triangle head) | loaded by `game.js` (precached) as the legacy `CreatureView` |
| `player_arms.glb` | 12.7 MB | 19,327: Launcher L/R 5,647 / 5,610, Arm L 3,232, glove 3,232, lantern 1,182, grapple head 424 | yes, always on screen: ~38k stereo triangles, 22 calls |
| `player_body.glb` | 2.3 MB | 6,441 | yes |
| `dresser.glb` | 1.7 MB | LOD0 22,530, LOD1 7,629, LOD2 2,202 | yes (LOD chain already 3 deep) |
| `holdfast.glb` | 2.0 MB | LOD0 2,306, LOD1/2 619 | yes |
| `env/ch1_env_kit.glb` | 2.8 MB | 41,967 over 76 meshes (largest: geartrain 4,199, saint 3,592, corbel hero 3,199) | yes, with 3 levels per part (see the static audit) |
| `env/ch1_props_v2.glb` | 0.47 MB | 24,628 (Lanternwright statue 8,999 + 2,600 + ...) | yes, with levels |

## 2. Where the triangles actually go at run time (stereo = x2)

1. **The creatures, not the props.** A Mason inside 38 m is 63k x 2 = **127k** triangles on its own, more than a third of the 350k Quest
   budget. A skitterling at 6 m+ is 20.7k x 2 = **41k** each, and two are in play from S6 on: **83k** for two creatures that are 0.45 scale.
   The Mason has two levels with a 38 m switch; the skitterling has two with a 6 m switch and nothing coarser, so a skitterling 60 m
   away in the fog is still 20k triangles of veins and legs that are sub-pixel (`masonRigView.js` itself notes "sub-pixel beyond ~70 m").
2. **The hands and launchers: ~19k x 2 = 38k, every frame, the whole game.** The two launchers (5.6k each) are the largest single
   consumer among things the player always sees, but they are also the thing at arm's length in VR, where detail pays.
3. **`mason_kit.glb` (4.3 MB, precached) is the legacy creature.** With the rig as the default it is a download the player pays for a
   fallback. Worth checking whether the rig can load without it (see 3d).
4. The static level is already the subject of `MESH_DETAIL_AND_OPTIMIZATION.md` (packs, per-cell culling, instanced links): nothing to
   add here.

## 3. What could be eliminated or made cheaper (ranked by triangles saved per unit of risk)

| # | Change | Saves (stereo) | Risk | Status |
|---|---|---|---|---|
| a | **A third level for the skitterling**: ~4k triangles beyond ~18 m (legs as tapered boxes, no veins), LOD1 20k between 6 and 18 m | ~32k per skitterling beyond 18 m, ~64k with two | low: they are small and fast; export through the existing `simplify_glbs.mjs` (meshoptimizer keeps skin weights) or `build_mason_rig.py` | **not done** |
| b | **A middle level for the Mason** (~30k) between ~14 and 38 m; LOD0 only inside ~14 m | ~66k while it is 14-38 m away (its normal stalking distance) | medium: needs a visual check at the switch; same export route | **not done** |
| c | Launchers 5.6k -> ~3k each (`simplify_glbs.mjs` PLAN already lists 0.5 ratio / 0.0016 error) | ~10k | medium: they are the hero object at arm's length; check in a headset | **not done** |
| d | Drop `mason_kit.glb` from the precache when the rig loads | 4.3 MB less download, no triangles | low-medium: it is the fallback if the rig fails | **not done** |
| e | `mason_hero.glb` (83k, 4.4 MB) is not loaded or precached | disk only | none | nothing to change |
| f | The `Lanternwright` statue levels, the geartrain, corbels | small | n/a | already 3-level kits |

What this pass did instead (all measured, see their tests): the creature's **mandibles** are procedural and cost 676 triangles in two draw
calls, shown only at full detail (LOD0); the **leg dust** is one pooled draw with a hard per-tier cap; neither adds to the per-frame
triangle budget in a way that matters (< 1 % of the Mason's own).

## 4. Why none of (a)-(d) was applied here

The two creature LODs are baked into the skinned GLBs together with their bone weights and texture atlases. Producing a new level means
either re-running `build_mason_rig.py` (Blender 5.x and a 15-30 minute bake; only Blender 4.0.2 is installed in this environment) or
decimating the skinned mesh in Node with meshoptimizer (`simplify_glbs.mjs`, which needs `meshoptimizer` and `@gltf-transform/*` installed
and **a visual check of the result** at the new switch distances). I could not look at a rendered result of a new level here, and a
creature that pops or loses its legs is worse than 30k extra triangles, so I left the models alone and recorded the ranked list.

Suggested order when someone can look at a headset: (a), then (d), then (b); (c) last.
