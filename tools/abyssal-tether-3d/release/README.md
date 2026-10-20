# Abyssal Tether 3D: release tooling (WP-RELEASE)

Design, APIs and evidence: [docs/abyssal-tether-3d/pwa/WP_RELEASE.md](../../../docs/abyssal-tether-3d/pwa/WP_RELEASE.md).

| Script | What |
|---|---|
| `build-release.mjs` | `npm run build:at3d-release`: clean `dist-at3d/{web,twa}` (game + sw.js + manifest + icons + privacy / support pages + headers + Bubblewrap pack); `--minify`, `--smoke` |
| `release.config.json` | version, hosting path, owner details (studio, contact, domain...) and Bubblewrap settings that the pages and the TWA manifest are filled from |
| `gen-precache.mjs`, `sw.template.js`, `gen-sw.mjs` | service worker + precache generator (`npm run at3d:sw`, also the `prebuild` step) |
| `test-pwa.mjs` | headless Chromium: install, offline (server stopped), update, half-finished deploy, sub-path and host root, `?sw=0` |
| `test-boot.mjs` | immersive boot: first head-tracked frame < 4 s (CPU throttled), loading scene, early session hand-over, plain tab, refused request |
| `test-resilience.mjs` | context loss / restore, XR session end, visibility, saves (IndexedDB, localStorage fallback, Continue) |
| `soak.mjs` | accelerated 45-minute soak: no growth in renderer.info memory / programs / scene objects / listeners / heap, no frame-time creep |
| `capture-screens.mjs`, `make-art.py`, `make-icons.py`, `check-listing.mjs` | store screenshots and art from the real game, designed title lettering, icons, listing checks |
| `lib/` | static server (prefix, headers, outage / blocked-path hooks), Playwright helpers, tiny Markdown converter |

The browser tests use software WebGL: expect minutes, not seconds (first render of each new place in the level takes
10-50 s on a shared CPU), and run one browser test at a time (each game page holds 2-3 GB).
