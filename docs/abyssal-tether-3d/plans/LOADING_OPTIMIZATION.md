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

TBD

## 3. What was done (kept)

TBD

## 4. Ideas measured and rejected / not done

TBD

## 5. After

TBD

## 6. Risks and how they are contained

TBD
