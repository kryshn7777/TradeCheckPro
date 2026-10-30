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
with the "after" on the same tree (the mesh-detail pass was editing levelView.js at the same time, so commits are not comparable).

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
| build (boot critical path) | 292-405 ms |
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
| Build the packs in a Web Worker | `prof.mjs` probe: a module worker importing levelBuildFast.js (`import 'three'`) fails: workers do not get the page's import map, and the game ships unbundled ES modules. The Dresser + packer are ~4k lines inside levelView.js whose imports (materials.js, boardWriting / bloodWriting, objectivesView) pull canvas / DOM code, and levelView.js was under concurrent edit by the mesh-detail pass. A worker would need a bundling step or a second copy of the build, plus the main-thread fallback. | rejected for now; the cache removes the same work on every boot after the first |
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
shader reads 0.0 / 1.0 per channel instead of the tints. See `progs.mjs` (pack colours) for the values; worth a look by the mesh-detail
pass (the fix is `toHalfFloat` per element and keeping the half-float flag through the merge, a visible change to review on its own).

## 5. After

TBD

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
- **First run** still runs the job (now ~20-30 % less CPU, sliced, adaptive); its remaining long steps are the pack merges (section 4).
- **Not run on a Quest**: the throttled numbers approximate the CPU; the GPU-side effects (uploads, compiles) were not measured on hardware.
