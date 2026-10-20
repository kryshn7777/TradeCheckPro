# Free release (Chapter I demo): autopilot plan and state

Owner instruction (2026-10-20): "Fully run without manual intervention till you finish all the work needed for the free
release. Polished and well made like a VR game." The owner authorised merging verified PRs to `main` without asking.

**Scope of the free release:** Chapter I (today's 8-section descent) as a complete, polished, free Meta Quest 3 WebXR game
with an ending hook ("Chapters II-V: coming"); the $9.99 unlock stays dormant in code (entitlement module present, no
purchasable content yet). Chapters II-V are NOT in this release.

**Definition of done** (all must hold; each is a gate or a checked artefact):
1. Gameplay and physics verified: `npm run verify:at3d -- --chapter ch1 --variant all`, `run.mjs all all`, test suites, e2e all green.
2. Player: 1:1 height + calibration (done, PR #6); realistic swing (done, PR #6); realistic launcher + HD gloved arms (WP-ARMS).
3. World: carved-stone cathedral-machine environment (WP-ENV), atmospheric fog + debris (WP-FOG), lighting/material upgrade (WP-GFX).
4. Creature: scary, rigged, animated, hunts using the rig, kit fallback kept (WP-CREATURE-ART, WP-CREATURE-RIG).
5. Audio: wired rope slip/haptics, creature sound sync, designed ambience and adaptive music within sourcing rules (WP-AUDIO).
6. UI/comfort/accessibility: menus, end card, brightness calibration, comfort vignette option, colour-safe cues, captions for audio pre-cues (WP-UX).
7. Release engineering: immersive-PWA boot (first head-tracked frame <= 4 s), service worker + precache, WebGL context-loss
   recovery, save data, 72 fps governor, VRC checklist items that can be done in code, store art + screenshots + trailer
   generated from the real game, privacy policy text, build/upload scripts (WP-RELEASE).
8. Final QA: adversarial review, full-descent soak, budget report (<= 150 calls / <= 350k tris stereo), gameplay video (WP-QA).

**Owner-only actions (cannot be done from here; listed in RELEASE.md section "Owner actions"):** Meta developer org, DDA, tax/bank,
domain + host, signing keystore, App ID, IARC, Data Use Checkup, headset testing and feel tuning, store submission.

## Work packages and state (update as work lands)
| WP | What | Owner files | State |
|---|---|---|---|
| WP-FOG | fog cards, dust, grit, event rubble, drips | render/fx.js, atmosphere.js, debris.js | agent running |
| WP-ARMS | Blender launcher + gloved arms + handsView integration | tools/build_hands.py, assets/models/player_arms.glb, render/handsView.js, ropeView.js | agent running |
| WP-ENV | carved-stone environment kit + level dressing, critic loop | render/levelView.js, materials.js, renderer3d.js, tools/build_env_kit.py, assets/models/env | partial in tree; to launch |
| WP-CREATURE-ART | finish Ossuary Column design (critic loop) + rig-ready production export | tools/wip/creature, assets/models/mason_* | partial; to launch |
| WP-CREATURE-RIG | armature, skinning, clips, MasonRigView, sim mapping | render/mason/*, render/creatureView.js | after CREATURE-ART |
| WP-GFX | GRAPHICS_PLAN work packages for Chapter I (baked lighting, trims, wetness, volume fog, tiers) | render/* | after ENV + FOG |
| WP-AUDIO | audio3d + haptics + music | audio/*, input haptics hook | after ARMS |
| WP-UX | ui3d menus, end card, comfort, accessibility | ui/*, game.js | to launch |
| WP-RELEASE | PWA boot split, SW, context loss, saves, governor, store assets, docs | main.js, index.html, pwa/*, game.js boot | to launch |
| WP-QA | adversarial review, soak, video, final report | all | last |

## Rules for every agent
- Work in /home/user/TradeCheckPro on branch `claude/abyssal-tether-game-3zft6o`; edit only your owned files.
- Run at most ONE Blender process at a time, wrapped as `flock /tmp/at3d-blender.lock <cmd>` (16 GB RAM, 4 CPUs shared).
- Run the browser e2e (`npm run -s e2e:at3d`) at most once per task, at the end; headless Chromium is slow and memory-hungry.
- Gates before reporting done: eslint, `verify:at3d`, `run.mjs all all`, `tests/run-tests.mjs`.
- Do not git commit/push; the lead commits. No git stash.
- Quest budget: whole frame <= 150 draw calls and <= 350k triangles stereo; no per-frame allocation in hot loops; sim stays deterministic and DOM/three-free.
- Original IP only.
