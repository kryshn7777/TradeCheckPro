# LOADING_OPTIMIZATION: time to playable and loading hitches (2026-10-30)

Owner's request: "Try to further optimize the procedural level loading." The previous pass (MESH_DETAIL_AND_OPTIMIZATION.md, BUDGET_CH1.md)
cut DRAW CALLS; this pass is about TIME: boot -> menu, Start -> first playable frame, and the long frames while the level is still being
built (the dressing job, GLB / texture arrivals, shader compiles). Nothing the player sees changes (byte-identical geometry, A/B shots
below), the per-section culling and the section packs stay, the sim / verify / bake inputs are untouched.

Nothing here ran on a Quest. All numbers are from this container (4 shared cores, headless Chromium, SwiftShader software GL) with CDP
CPU throttling (`Emulation.setCPUThrottlingRate`) as a stand-in for the Quest's Snapdragon. Software GL makes every rendered frame and
every shader compile far slower than a real GPU, so only the JavaScript (main-thread) costs and their RATIOS carry over; the absolute
seconds do not.

## 1. The profile (how to re-run)

`?loadprof=1` (src/platform/loadProfile.js; without the flag nothing is installed) writes `window.AT3D.loadProfile`:
`performance.mark` phase marks (`bootMinimal`, `earlyModules`, `minimal`, `lateModules`, `attract`, `textureManifest`, `levelCache`,
`levelView`, `views+ui`, `content`, `start`, `warpN`, `envKitArrived/Done`, `propsArrived/Done`, `dressingDone`, `assets:kit/rig/
skitterRig`), method timers wrapped around the game / renderer / LevelView instances from the outside (count, total, max, every call
over 40 ms with its start time), every frame's main-thread cost (the game loop callback), measuring windows after Start (3 s) and each
warp (2 s: frames, longest frame, frames > 12 ms / > 33 ms, long tasks), a `longtask` PerformanceObserver, the JS heap at each mark
(`--enable-precise-memory-info`) and the resource timings (module / KTX2 / GLB fetches). `loadProfile.report()` returns the compact table.

Scripts (scratchpad `loadprof/`, Playwright through tools/abyssal-tether-3d/release/lib/browser.mjs, one browser at a time under
`flock /tmp/at3d-browser.lock`):

| script | what |
|---|---|
| `prof.mjs <out.json> <cpuRate> <extraQuery> <sections> <menuMs> [reuse]` | boot, menu, Start, warp S2..S8, `finishDressing` time; `reuse`: a 2nd load in the same context (the cache hit) |
| `show.mjs <out.json>` | the table of a run |
| `cpu.mjs <prefix> <rate>` | CDP CPU profiles per phase (boot / menu / start / warps / finish), self + inclusive time of the game's functions |
| `geohash.mjs '' <rate>` | builds a FRESH LevelView 4x in one page (LOADOPT off / on / off / on): build + dressing ms and an FNV hash of every chunk's bytes, LodSet records, decals, cogs, colliders |
| `cachecheck.mjs <rate>` | the cache round trip: run 1 procedural + save, run 2 restored: same hash, boot marks of both |
| `ab-load.mjs <dir>` + `ab-diff.py <dir>` | screenshots S1-S8 at the warp cameras: A `?loadopt=0`, B1 default (procedural, saves), B2 default (restored) |
| `progs.mjs` | which shader programs compile after the menu (cache keys new after Start / each warp) |

`?loadopt=0` turns every change of this pass off (the original code paths): it is the "before" of every table below, run back to back
with the "after" on the same tree (the mesh-detail pass was editing levelView.js at the same time, so commits are not comparable). The
browser runs serve a frozen copy of the game (`AT3D_ROOT=<copy> node prof.mjs ...`): an edit to any file of the build between two runs
changes the cache key (correctly a miss), and the before / after must see the same code.

## 2. Before: where the time goes

CPU profile of the boot (unthrottled, sampled, inclusive ms; `cpu.mjs`): of ~6.2 s sampled up to the menu, 3.5 s is rendering (SwiftShader:
the loading scene, the env probe; on a Quest this is GPU time), then the level build `Renderer3D.buildLevel` 784 ms (`LevelView.build`
545: `_buildDecor` 255, the decor's section packs `_packBands` 222, plaques 86; `lighting.setLevel` 141; `precompile` 122), the
renderer's construction 492 (procedural fallback textures 138, FX noise 163, env probe), the env kit / props GLB parse 111 + 92.
The menu then uploads the lightmap array (2.4 s of `texSubImage3D` in software GL), builds the hands' gear environment (1 s) and
precompiles (1.4 s of driver compile in software GL).

The procedural level is NOT finished at the menu: `LevelView.build` merges the authored decor, then the DRESSING JOB (the Dresser's
plan of piers / arcades / ribs / kit placements, the buried-face culling, the section packs) runs a few ms per frame: 8 ms per frame
on the menu, 2 ms while playing, nothing during the loading scene. Measured on its own (`geohash.mjs`: a fresh LevelView, one job
step per call, unthrottled, two runs each):

| dressing job (unthrottled) | before (`?loadopt=0`) |
|---|---|
| build (boot critical path) | 251-651 ms |
| job CPU total | 1.47-2.51 s |
| steps / longest step | 1268 / 106-202 ms |
| steps > 12 ms / > 33 ms | 24-31 / 13-19 |
| where the long steps are | section-pack merges 1.08-1.28 s total, max 123-202 ms (the buried-face culling inside them is ~60 %); the flush that draws a finished section's kit placements all at once (8 steps, max 47-64 ms); `_collideDecor` 25-37 ms |

At 4x CPU throttling (our Quest stand-in) every one of those is 4x: a ~1 s build on the critical path, ~6-9 s of job CPU, ~25 frames of
50-800 ms. With 2 ms per playing frame (144 ms of job per second at 72 Hz) the lower sections are dressed tens of seconds after Start:
a fast player can reach an undressed section (no kit parts, no decor colliders yet) and every long step is a dropped XR frame. The
whole dressed level is 3.17 M vertices / ~102 MB of vertex arrays (37 chunks).

Other measured causes (not the procedural level, see section 4): Start itself (`game.start` ~0.2-0.5 s unthrottled: the audio graph
built on the first gesture, `_unlockAudio` 152 ms; the section title DOM); the Dresser / Holdfast GLBs arrive after Start and their
shader programs were compiled on first sight (the only programs new after the menu: `progs.mjs` found 75 programs on the menu, none new
after Start, HoldfastFlesh x4 / at3dDresserV2 at the warps where they first showed).

## 3. What was done (kept)

All of it is behind `LOADOPT.on` (render/levelBuildFast.js; `?loadopt=0` = the original code), and every geometry change is checked
byte for byte: `geohash.mjs` builds the level 4x in one page (off / on / off / on) and hashes every chunk's attribute bytes, LodSet
records, decals, cogs and decor colliders: identical in every run (e.g. `69671a93` x4, `c711d0a6` x4 on two tree states).

1. **Faster, bit-identical build steps** (render/levelBuildFast.js, two 2-line hooks in levelView.js):
   - `cullBuriedFast`: the buried-face test on plain float arrays against the few solids near the WHOLE geometry (one spatial query per
     geometry instead of one per triangle), same arithmetic in the same order; a geometry with > 48 candidate solids, interleaved or
     normalised attributes falls back to the original loop. Node test: 600 random soups on the real level, bytes equal.
   - `kitGeoFast`: a kit placement (clone, matrix, normal matrix, mirror fix, tint, metric UVs) on plain arrays with three's own
     Vector3.applyMatrix4 / applyMatrix3 / normalize arithmetic; Node test: 60 rotated / scaled / mirrored placements, bytes equal.
2. **The dressing job time-sliced** (levelView.js `_pumpDressing`, small edits): a section pack's culling + packing + compaction now
   runs ONE geometry per step before its merge (`precullStep`; `_packBands` skips what it did: `CULLED` / `_culled`, idempotent anyway);
   a finished section's flush draws its kit placements 6 per step (`_emitKitPlan(..., limit)`) before the flush, the plan waiting meanwhile
   so the lists and their order are unchanged; the final flush the same.
3. **The dressing budget adapts to the frame** (`dressBudgetMs`, `game._frameWorkMs` = the last loop's main-thread time without the job):
   what is left of 10 ms, 1-6 ms while playing (was a fixed 2), 2-10 ms otherwise (was 8). And the job starts behind the loading scene
   (4 ms per loading frame; it used to wait for the menu).
4. **The dressed level cached in IndexedDB** (render/levelCache.js; hooks: `LevelView.build` / `_restoreDressed`, `Renderer3D` creates
   and ticks it, `game._prefetchLevelCache` starts the read in bootMinimal and the build waits for it at most 4 s). Once a run has dressed
   the whole level (built with the kit and props present, no job error, nothing under the view's root it would not know how to rebuild),
   every merged chunk (attribute arrays + LodSet records), the decals, the cogs, the decor colliders and the stats are written, 1 MB slice
   per frame, under a SHA-256 key of: every source file of the build (the static import closure of levelView.js, level3d.js and the level
   data, three.js included, parsed at run time from the page's own files: 22 files), the env kit and props GLB bytes, the variant, the query
   string and the schema; the detail tier and the layout signature are checked at restore. The next boot with the same inputs restores it
   in place of the decor merge and the whole dressing job: no job at all, every section dressed and every decor collider in the sim from the
   first menu frame. Round trip checked in the browser (`cachecheck.mjs`): restored level hash == procedural hash.
5. **Dresser / Holdfast programs compiled when their GLBs arrive** (game.js `_updateViews`, like the creature GLBs already were), not on
   first sight in S2 / S3.
6. **The loading profile** (`?loadprof=1`, section 1) so all of this can be re-measured.

## 4. Ideas measured and rejected / not done

| idea | result | decision |
|---|---|---|
| Build the packs in a Web Worker | `prof.mjs` probe: a module worker importing levelBuildFast.js (`import 'three'`) fails to load (its error event fires): workers do not get the page's import map, and the game ships unbundled ES modules. The Dresser + packer are ~4k lines inside levelView.js whose imports (materials.js, boardWriting / bloodWriting, objectivesView) pull canvas / DOM code, and levelView.js was under concurrent edit by the mesh-detail pass. A worker would need a bundling step or a second copy of the build, plus the main-thread fallback. | rejected for now; the cache removes the same work on every boot after the first |
| Bake the dressed level offline into the precache | ~102 MB of vertex arrays; the precache core is 79.5 / 80 MB | rejected (the IndexedDB cache stores it per device instead) |
| Stream: build only S1 +- 1 at boot | the dressing job already goes top section first; deferring the authored decor's packs changes the pack record order (not byte-identical) and the precompile's coverage, for ~0.2 s | not done |
| Split the section-pack merge itself (`LodSet.add`) | after this pass the remaining long dressing steps are these merges (9-11 steps > 12 ms unthrottled, max 31-57 ms): one copy of the whole pack + bounds. An incremental LodSet is a change to the packs (the mesh-detail pass's code) | not done; next step if first-run hitches matter (later runs have no job) |
| compileAsync / precompile only S1 | no program is missing after the menu (75 programs, none new after Start); the only first-sight compiles were the Dresser / Holdfast | done for those two (item 5) |
| Build the audio graph (noise / impulse responses) before Start | `_unlockAudio` 152 ms unthrottled at Start | not ours (audio); recommended |
| One shared KTX2 transcoder pool | materials.js and glbLoad.js each run a 2-worker Basis transcoder (WASM compiled twice), off the main thread | not changed |
| Trim the module graph | perfDiag / pwaBoot are already dynamic; the late modules load behind the loading scene in parallel | not changed |

Found on the way, NOT changed (it would change the picture): the section packs' vertex colours. `compactVertices` builds
`new THREE.Float16BufferAttribute(floatColours)`, whose r170 constructor is `new Uint16Array(array)`: the colours are truncated to the
integers 0 / 1, and the pack merge (`mergeGeometries`) then makes them a plain Uint16 attribute uploaded as UNSIGNED_SHORT, so the
shader reads 0.0 / 1.0 per channel instead of the tints. Measured (`progs.mjs`, `decorpack_stone_0`): a `Uint16Array` colour attribute,
not half-float, not normalised, its only values 0 and 1, on a `vertexColors: true` material. Worth a look by the mesh-detail
pass (the fix is `toHalfFloat` per element and keeping the half-float flag through the merge, a visible change to review on its own).

## 5. After

**The dressing job** (`geohash.mjs`, unthrottled, the same page building the level off / on / off / on, so both sides see the same tree
and the same machine load; two such pages on two tree states):

| dressing job (unthrottled) | before (`?loadopt=0`) | after |
|---|---|---|
| geometry hash (all chunks, records, decals, cogs, colliders) | 69671a93 | 69671a93 (byte-identical) |
| build on the boot critical path | 251-651 ms | 221-379 ms |
| job CPU total | 1.47-2.51 s | 1.25-2.16 s (-15 to -30 %) |
| steps / longest step / p99 step | 1268 / 106-202 ms / 33-58 ms | 9228 / 31-57 ms / 1.9-4.4 ms |
| steps > 12 ms / > 33 ms | 24-31 / 13-19 | 11-22 / 0-8 |
| section-pack merges (total / longest / > 12 ms) | 0.89-1.28 s / 123-202 ms / 15-16 | 0.31-0.41 s / 31-57 ms / 9-11 |
| kit flush (longest) | 47-64 ms (8 steps) | 3.8-7.9 ms (147 steps) |

The remaining long steps are the section-pack merges themselves (section 4). Divide by the per-frame budget for the frames they take;
multiply by ~4 for a Quest.

**The cache** (`cachecheck.mjs`, unthrottled, frozen copy of the tree, final code; an earlier run of the previous revision agreed): run 1
with an empty store built procedurally (the build did not wait for the key: 0.3 ms), finished the job and saved (37 chunks, 100.2 MB of
arrays, 1141 decor colliders); run 2 in the same browser profile restored it: level hash `ea65f824` in both, colliders 1141 in both,
`restored: true`. Run 2 read 99.3 MB (key + read) in 0.9 s beside the late modules; the build waited 0.44 s for it. Boot to menu
(`content`) 4.35 s (empty store) -> 2.47 s (restored), and no dressing job at all after it (run 1's job ended 2.2 s after the menu,
unthrottled, on the menu's budget). JS heap at the end of each run: 343 MB (procedural + save) vs 298 MB (restored). An earlier attempt on the live tree showed the invalidation working: the mesh-detail pass changed levelView.js between the
two runs and run 2 missed ("stale") and built procedurally.

**The whole session at 2x CPU throttling** (`prof.mjs`, frozen copy of the tree, boot -> 6 s menu -> Start -> warp S3, S6 ->
`finishDressing`; single runs). 4x throttling was the plan, but at 4x the renderer process grew to ~8.5 GB and was OOM-killed in BOTH
modes (also with `?loadopt=0`), so those runs gave no data; 2x completed. The machine is shared with other agents' browsers (some run
without the lock): the "after, first run" column ran under visibly heavier load (its module load, `lighting.setLevel` and GI decode,
code this pass does not touch, took ~2x longer than in the other two), so only the large differences mean anything; the per-step
table above is the reliable comparison of the procedural work.

| at 2x | before (`?loadopt=0`) | after, first run (procedural, then saved) | after, cache hit |
|---|---|---|---|
| build waits for the cache | - | 0.47 s (the key; since then not waited for when nothing is stored) | 1.06 s (key + 99.3 MB read) |
| `Renderer3D.buildLevel` | 1.36 s | 1.59 s | 1.23 s (`_buildDecor` still runs: plaques, gate, links) |
| boot -> menu (`content`) | 5.82 s | 8.89 s (load, see above) | 4.80 s |
| dressing job CPU | 5.5 s (14 frames of it in 38 s, the rest in `finishDressing`) | ~9.8 s (same pattern) | 0 (no job) |
| level fully dressed + decor colliders | only when `finishDressing` forced it (44 s) | idem (63 s) | at the menu |
| longest single dressing call | 485 ms (a pack merge) | 378 ms (a pack merge) | - |
| JS heap at the menu / at the end | 71 / 354 MB | 69 / 326 MB | 157 / 344 MB |
| frames after Start / warps (`windows`) | software GL renders at ~0.3-3 fps here: the windows hold 0-1 frames each and measure SwiftShader, not loading | | |

Heap: with the cache the dressed geometry (~100 MB of arrays) is there from the menu instead of arriving during play; the end state is the
same level (the procedural run's heap passes through more garbage on the way). Nothing stays referenced twice: the read arrays become
the attributes.

**A/B screenshots** (`ab-load.mjs`, S1-S8 at the warp cameras, quest tier, frozen sim, `R.time = 100`, textures / baked light / creature kit
loaded; mean absolute difference 0-255 and share of changed pixels):

| | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 |
|---|---|---|---|---|---|---|---|---|
| noise floor: A vs A2 (the same `?loadopt=0` build, two runs) | 0.62 / 55 % | 0.09 / 7 % | 0.22 / 8 % | 0.12 / 17 % | 0.05 / 9 % | 0.42 / 12 % | 0.10 / 9 % | 0.03 / 0.6 % |
| A vs B1 (after, procedural) | 0.92 / 73 % | 0.32 / 10 % | 0.34 / 12 % | 0.34 / 25 % | 0.15 / 17 % | 0.61 / 20 % | 0.14 / 16 % | 0.02 / 1.4 % |
| A vs B2 (after, restored from the cache) | 1.56 / 82 % | 0.39 / 13 % | 0.39 / 15 % | 0.52 / 27 % | 0.27 / 24 % | 0.63 / 24 % | 0.23 / 22 % | 0.05 / 2.8 % |

The geometry is byte-identical in all three (hashes above); the diff images (scratchpad `loadprof/ab/diff-*.png`) show only animated
things, in A vs A2 as in A vs B: the rain streaks and motes, the carried lantern's light pool and flicker on the walls, the hands and the
held item, a chain link. They are a little larger for B (its frames come at other moments of those animations: the job, the save and the
restore change how much happens before the shot), but no object is missing, added or moved. Not exactly 0: the shots could not be made
fully deterministic here (frame-count / wall-clock driven particles and flicker).

**Shader programs** (`progs.mjs`): before, the Dresser / Holdfast programs (at3dDresserV2, HoldfastFlesh x3-4) compiled on first sight
(new at the S5 / S8 warps); after, they compile right after Start when their GLBs arrive, and no warp adds a program (77 on the menu, 81
after Start, 80-81 at every warp).

**Other checks**: `?hunt=always` session (boot, Start, S3 / S6 / S8, `finishDressing`): no page error. Every `prof.mjs` / `cachecheck` /
`ab-load` run: no page error. Worker probe (every `prof.mjs` run): the module worker's error event fires (no import map in workers).

**Verification**: `npm run test:at3d` all 55 suites pass (new: `render/test-loading.mjs`); `npm run verify:at3d` all checks pass, the
3167 baseline values identical, the baked GI / lightmap suite passes (level data, sim and bake inputs untouched); eslint clean on the
changed files; `gen-sw.mjs` 177 core files / 79.6 MB (<= 80). `test-pwa.mjs` 18/23 (twice): offline boot, no faults, a run and VR
pass; the failing checks are lazy-tier files requested during the offline run (dresser.glb, holdfast.glb, assets/audio/voice/
manifest.json: kept out of the 80 MB core by earlier passes) and the last step's navigation after the update phase; not code this pass
changed (the level cache's own fetches, all core files, were served offline). The Quest draw-call / triangle budget is unchanged by
construction (the same 37 chunks with byte-identical buffers); the budget harness itself was not re-run by this pass.

## 6. Risks and how they are contained

- **Cache staleness**: the key hashes the build's whole static import closure (parsed at run time, so a new import is covered without
  editing a list), three.js, the level data, both GLBs, the variant and the query string; the detail tier and the layout signature are
  compared at restore; the snapshot only exists if the dressing produced nothing the restore does not rebuild (any new object under the
  view's root: no save). A Node test walks the real closure (every file exists, the import map is the page's). What it cannot see: a
  build input that is not a static import (a dynamic `import()` or a fetched file used by the dressing) — none today; document it there.
- **Partial / concurrent writes**: the old entries are cleared first and the manifest is written last; slices are keyed by a save id;
  every read is size-checked (Assembler); any failure is a miss and the procedural path runs. One entry in all (~100 MB on disk).
- **Memory**: a read allocates each array once and drops each slice as it is copied; a read that arrives after the build (4 s bound) or
  for another variant is dropped, never held; a save copies 1 MB per frame.
- **Fallbacks**: no IndexedDB / crypto.subtle / fetch, private mode, quota, a bad entry, the kit or props not parsed at build: the original
  synchronous build + job. `?levelcache=0` disables the cache, `?loadopt=0` everything here.
- **First run** still runs the job (now ~15-30 % less CPU, sliced, adaptive); its remaining long steps are the pack merges (section 4).
  The adaptive budget is a trade: on a busy frame the job gets less than the old fixed 8 ms on the menu, so on a first run the level can
  finish dressing later in wall time (no frame is pushed past ~10 ms of work by it in exchange; the loading-scene frames now help). In this
  container, whose frames take seconds, it ran at its 1-2 ms floor, which is why `finishDressing` did most of the work in the profiles.
- **Plain pages without HTTP caching** fetch the env kit and props GLBs twice (the key hashes their bytes): 3.3 MB, from the cache on the
  PWA (service worker) and on a normal host with cache headers; seen on the test server only.
- **Not run on a Quest**: the throttled numbers approximate the CPU; the GPU-side effects (uploads, compiles) were not measured on hardware.
