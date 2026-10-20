# WP-RELEASE: what is wired, how to use it, how it was verified

State of the free Chapter I release engineering (the drafts next to this file, `sw.draft.js`, `gen-precache.mjs`,
`pwa-boot.draft.js`, `entitlement.draft.js`, `manifest.draft.webmanifest`, are now **adopted** as the real files listed
below; keep them only as the original design notes). Plan and VRC context: [../RELEASE.md](../RELEASE.md),
[../vrc-checklist.md](../vrc-checklist.md), [../FREE_RELEASE_PLAN.md](../FREE_RELEASE_PLAN.md).

## Files

| Area | Files |
|---|---|
| Boot | `src/main.js`, `src/platform/earlyXR.js`, `src/platform/loadingScene.js`, `Game3D.bootMinimal()` / `bootContent()` in `src/game.js`, `index.html`, `style.css` (boot actions) |
| PWA | `manifest.webmanifest`, `icons/` (192, 512, 1024, maskable 512/1024, favicon), `src/platform/pwaBoot.js`, service worker template `tools/abyssal-tether-3d/release/sw.template.js`, generator `gen-precache.mjs`, `gen-sw.mjs`; `sw.js` is a git-ignored build artefact |
| Resilience | `src/platform/resilience.js` (context loss, XR reconnect, freeze, watchdog), `src/platform/governor.js` |
| Saves | `src/meta/save.js` (E05) |
| Entitlement | `src/platform/entitlement.js` (E06, dormant) |
| Identity | `src/platform/buildInfo.js` (`channel: 'dev'` in the tree, `'release'` in the dist) |
| Store | `docs/abyssal-tether-3d/store/` (`LISTING.md`, `PRIVACY_POLICY.md`, `SUPPORT.md`, `BUBBLEWRAP.md`, `site/`, `art/`, `screenshots/`, `keyart/`), `tools/abyssal-tether-3d/release/{capture-screens.mjs,make-art.py,make-icons.py,check-listing.mjs}` |
| Build | `tools/abyssal-tether-3d/release/{build-release.mjs,release.config.json}` |
| Tests | `tools/abyssal-tether-3d/tests/release/*` (Node, in `npm run test:at3d`), `tools/abyssal-tether-3d/release/{test-pwa,test-boot,test-resilience,soak}.mjs` (headless Chromium) |

## Commands

```bash
npm run at3d:sw                 # regenerate public/abyssal-tether-3d/sw.js (also runs as `prebuild`, so GitHub Pages deploys a consistent list)
npm run build:at3d-release      # dist-at3d/{web,twa}; -- --minify, -- --smoke
npm run test:at3d               # Node suites incl. save / entitlement / governor / platform
npm run sanity:at3d             # ONE page: immersive boot, stable memory over an accelerated loop, context loss, XR end, saves (verified)
npm run test:at3d-release       # test-pwa.mjs (install / offline / update / bad deploy / sub-path + root) + sanity.mjs
# written but not run to completion (software GL is too slow / memory hungry on the shared machine; run on a quiet box):
#   test-boot.mjs (throttled boot timing), test-resilience.mjs (longer resilience matrix), soak.mjs (45-minute soak)
# always run browser jobs under:  flock /tmp/at3d-browser.lock <cmd>
npm run capture:at3d-store && npm run art:at3d-store        # screenshots (packed to JPEG by pack-screens.py, store pack 13 MB) and art from the real game, then the cover set
node tools/abyssal-tether-3d/release/check-listing.mjs      # listing text limits + art sizes
```

## Boot sequence (RELEASE T1, T2; VRC.Quest.Performance.3)

1. `main.js` imports only `platform/earlyXR.js`. If this launch is the installed immersive app (Digital Goods API
   present, `display-mode: standalone|fullscreen`, or `?autovr=1`; `?autovr=0` disables) it calls
   `navigator.xr.requestSession('immersive-vr')` **synchronously, before game.js is parsed**.
2. `Game3D.bootMinimal()`: settings, bus, renderer, input, XR hooks, the **loading scene** (a lantern on its tether
   with halo, motes and a progress rail, in the real scene), resilience, governor, save service; the loop starts.
3. The early session is handed to `InputManager.enterVR()` (a one-shot wrapper on `navigator.xr.requestSession`) ->
   the first head-tracked frame is the loading scene.
4. `Game3D.bootContent()` runs behind it, yielding to XR frames between steps: remaining modules, audio, threat,
   level, texture manifest, level view, hands, creature kit, UI, shader precompile, menu. `Game3D.boot()` still runs both.
5. If the early request is refused (no activation) the boot screen shows a real **Enter VR** button and **Play on
   screen**; a plain tab keeps the DOM loader and the menu's Enter VR button.

Timings are on `AT3D.debug.platform().bootTimes` (ms since navigation start: `minimal`, `firstFrame`, `xrStart`,
`firstXRFrame`, `content`) and the bus event `game:first-xr-frame`.

## Service worker (RELEASE section 9)

Precache core = every runtime file generated from the tree (assets incl. `lighting/*.bin` and `.ktx2`, models, code, vendor
three.js incl. the Basis transcoder, manifest, icons; today 106 files / 63.5 MB, cap `maxCoreMB` 80), SHA-256 per file,
all-or-nothing install; JPEG/PNG texture fallbacks that have a `.ktx2` sibling are lazy (cached on first use, so textures are
not downloaded twice); unchanged files are copied from the previous cache on update; later chapters (`assets/chapters/chN/**`) are the
lazy tier; excluded: sw.js, docs, previews, `mason_hero.glb`, keystores. Works at any path (every URL resolves against
the registration scope; cache names carry the scope path).

Registration policy (`pwaBoot.serviceWorkerPolicy`): release build: always; dev build on a real host (GitHub Pages
beta): always; dev build on localhost / 127.0.0.1: only with `?sw=1` (a stale worker must never serve old code to a
developer); `?sw=0`: never, and it unregisters the worker and deletes its caches.

Update flow: a launch (and every 30 min / foreground) calls `registration.update()`. A new build downloads in the
background; `game.updates.ready` and bus `app:update-ready { apply }` signal it; the new build starts on the next cold
launch or when `game.updates.apply()` is called (**menu only**: it reloads, which ends an XR session; it refuses while
`game.xrActive`). A half-finished deploy (file missing or hash mismatch) fails the install and leaves players on the
previous build. UI hook for the UX agent: a Settings > About row "Update ready: restart" bound to `game.updates`.

## Resilience (Functional.1/.2)

- WebGL context loss: three.js rebuilds GPU state itself; `Resilience` pauses the run at once, flushes the save, shows
  a notice, recompiles every program on restore and leaves the player in the pause menu exactly where they were. No
  restore within 8 s: a Reload panel (the checkpoint is saved, Continue brings it back).
- XR session end: in the installed immersive app a DOM **Return to VR** panel (a real click = user activation); the
  run is already paused by `Game3D._onXREnd`. `game.exitVR()` marks the end as deliberate (no panel).
  Note: `ui3d.js` has its own 2D "Return to VR" button; both may be shown, they call the same `game.enterVR()`.
- Visibility: `visibilitychange`, `blur`, `pagehide`, XR `visible-blurred` / `hidden` (all existing) plus the page
  `freeze` event and a frame watchdog (no frames for 8 s while playing -> pause).
- Debug: `AT3D.debug.loseContext()` / `restoreContext()` (WEBGL_lose_context), `AT3D.debug.platform()`.

## Frame-time governor (RELEASE section 14.2, VRC.Quest.Performance.1)

`platform/governor.js`, XR only (desktop keeps `ui/perfDiag.js`). Requests `updateTargetFrameRate(72)`; five levels
(foveation 0.5 -> 1.0, viewport scale 1.0 -> 0.7 via `XRView.requestViewportScale` where the runtime has it, fx tier
`quest` -> `low`); degrades after >= 18 % of the last second's frames exceed 1.3 x the frame budget, one step per
1.5 s; recovers one step after 10 s with p95 within 8 % of budget; flapping doubles the wait (to 160 s); hitches
(> 250 ms) and non-play states are ignored. Quality tiers use the semantics fx.js already has:
`settings.reducedEffects === true` pins level >= 3 (fx tier 0), otherwise the governor writes `settings.fxQuality`
(`'quest'` / `'low'`, in memory; removed on session end). `?gov=off` disables it, `?gov=N` pins level N (QA).
Render side (2026-10-20): `Game3D._loop` now calls `renderer.governor.update(frameMs)` every frame (0 while not playing / menu / dead):
in XR `render/renderGovernor.js` only mirrors this governor's level (lighting levers, `gfx:level`), on desktop it steps by itself,
so the tiers exist once. `AT3D.debug.platform().governor` reports level, miss ratio and the last changes; bus event `quality:level`.
Plug-in API for the render quality tiers: `game.governor.onFrame(frameMs)` (feed a frame time),
`game.governor.onStep(fn)` -> unsubscribe, with `fn(tier, foveation, scale, level, why)` (`tier` is `'quest'` or `'low'`);
when the renderer has `setQualityTier(tier)` it is called on every change as well.
**Tune on device**: the thresholds and the level-0 foveation 0.5 are educated defaults.

## Saves (E05, Chapter I scope)

`SaveService` is created in `bootMinimal` (`game.save`). IndexedDB `abyssalTether3d` v2 (`profile`), plus a synchronous
localStorage safety copy (`abyssalTether3d.v2.profile`); load keeps the newest. Today's `abyssalTether3d.v1.*` keys are
migrated on first launch and kept in step (the current UI still reads them); a profile from a newer schema is never
overwritten; failed writes never throw. API for the menu (UI agent):

```js
game.canContinue()                 // boolean
game.save.continueInfo()           // null | { difficulty, label, section, sectionName, checkpoint:{x,y,z,yaw,index},
                                   //          time, deaths, depthMeters, savedAt }
game.continueRun()                 // starts the saved difficulty at the saved checkpoint with the saved clock / deaths
game.save.records('normal')        // { best, fewestDeaths, deepest, runs, completions }
game.save.chapter('ch1')           // { reached, completed, completions, byDiff }
game.save.profile                  // the whole profile (schema in meta/save.js header)
// bus events: continue:changed { available, info }, save:loaded, save:changed { reason }, save:written, save:error,
//             game:continue { info }
```

Rules: a run is saved at every checkpoint (not in Abyss / Sandbox); starting a new run replaces the slot (the menu should
confirm "New run" when `canContinue()`); a victory clears it and sets `chapters.ch1.completed`.

## Entitlement (E06, dormant)

`platform/entitlement.js` (draft behaviour unchanged) is created at content boot as `game.entitlement`; `game.isChapterPlayable(n)`
is true for Chapter I always and for later chapters only while the unlock is owned. No purchase UI, nothing is gated
today. Dev-channel mock: `?entitlement=owned|demo|buy|cancel|offline|error`; the release build ignores it
(`buildInfo.channel`). Bus events `entitlement:change`, `purchase:start`, `purchase:result`. Wiring the buy button to an XR
`select` handler (T11) belongs to the input/UI agents when the paid unlock is built.

## Hook proposals (files I do not own)

1. `render/renderer3d.js`: accept an externally created `WebGLRenderer` or `{canvas, context}` so a future loading phase
   can render before `Renderer3D` is constructed (today the loading scene waits for the render modules, which is within
   budget).
2. `render/*`: expose `renderer.setQualityTier(0|1|2)` so the governor stops writing `settings.fxQuality`.
3. `ui/ui3d.js`: Continue / New run in the menu from the save API above; Settings > About (version from
   `serviceWorkerVersion()` + `BUILD`), "Update ready" row; Settings toggle bound to `settings.reducedEffects`.
4. `input/inputManager.js`: `onSelect(hand, fn)` (E24) for the purchase activation.

## Verification evidence

Measured on software WebGL (headless Chromium, mock WebXR, shared 4-core machine; device numbers are the owner's):

- Node: 46 save, 29 entitlement, 34 governor, 35 platform checks; `npm run test:at3d` all suites pass.
- `sanity.mjs` 12/12: first XR frame 465-733 ms after launch with the loading scene (< 4 s), menu in VR at 1.9-2.7 s;
  geometries 88 / textures 46 / programs 73 / scene objects 235 / bus listeners 124 identical before and after
  3 x 63 simulated seconds across sections; context loss pauses + saves, restore keeps place and clock, resume renders;
  checkpoint in IndexedDB and continuable; system-ended XR -> Return to VR panel -> re-enter; zero console errors.
- `test-pwa.mjs`: install (every core file cached), offline reload with the server stopped, deep link, run + VR offline:
  source tree at sub-path and host root 18/20 on the first run (the 2 failures were the test counting in-page `blob:`
  requests as network requests; fixed), the same checks 10/10 on the built release at the host root (every request in
  the precache list). Update flow (only the changed file downloaded, ready signal, apply, old cache removed) and
  half-finished-deploy rejection (hash mismatch, failing file, repair then update) 12/12; dev policy (no worker on
  localhost without ?sw=1) passed. `?sw=0` purge was fixed after a flaky run and not re-run.
- The 45-minute soak and test-boot / test-resilience were NOT completed: first renders of each new area take 15-55 s on
  software GL and the machine OOM-killed browsers during long runs.
