# Abyssal Tether 3D: browser end-to-end test

`e2e.cjs` plays the real game in headless Chromium (software WebGL), desktop and mock WebXR:

1. boot to the menu with zero console errors and no stand-in modules; start Normal with a real click;
   the start fade clears within ~0.7 s of game time;
2. real mouse / keyboard in S1: arrow keys aim at the first ring, LMB fires the right tether, W swings,
   letting go lands on the sill;
3. **the whole descent in one continuous run**, creature live: the harness bot's verified routes
   (`../verify/bot.mjs` + `../verify/routes.mjs`, served to the page as `/__e2e/*`) drive
   `AT3D.debug.setInput` / `AT3D.debug.step`; deaths respawn at the checkpoint and retry the section;
4. victory panel, best time stored and shown again after a reload, a 15 m fall kills and Enter respawns,
   the creature closes in on a player stalling in S5 / S7, and the descent again at human pacing (5 s
   look-around on every landing, `--hesitate S`, 0 skips it);
5. mock WebXR (`page/xr-mock.js`): Enter VR by clicking the DOM button, trigger tether, stick swing,
   release, B pause / resume, and stereo draw calls / triangles within 150 / 350k in S1, S4 and S7.

```bash
npm run e2e:at3d                                    # this checkout's game
node tools/abyssal-tether-3d/e2e/e2e.cjs --root /path/to/other/checkout --skip-xr
```

| Option | |
|---|---|
| `--root DIR` | game to test (repository root, `public/abyssal-tether-3d` or its `src/`; default: this checkout; also `AT3D_ROOT`) |
| `--out DIR` | where `e2e-result.json` and `shots/*.png` go (default `e2e/out/`, git-ignored) |
| `--port N` | fixed port for the built-in static server (default: a free one on 127.0.0.1) |
| `--skip-descent`, `--skip-xr`, `--hesitate S` | drop parts (S = seconds of look-around per landing in the human-pacing descent) |
| `--headed` | show the browser |

Requirements: Node 20+, and Playwright with Chromium. The script uses a local install
(`npm i -D playwright`) or the global one (`npm i -g playwright`, i.e. what
`NODE_PATH=$(npm root -g)` would find; it looks there by itself), then
`npx playwright install chromium` once. No other server is needed: `e2e.cjs` serves the game folder
itself. A full run takes ~15–30 min of wall time on a shared 4-core machine (the descent is played
twice); `--hesitate 0 --skip-xr` is the quick form. The table at the end lists every check; exit code
1 when any failed.

`page/runner.mjs` is the in-page driver (the bot's `Sim` interface on top of the running `Game3D`,
look-ahead on a private `Physics3D` and bus), `page/sim-shim.mjs` stands in for `../verify/sim.mjs`
in the browser, `playwright.cjs` finds Playwright for every browser test.
