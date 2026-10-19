# Integration decisions (lead)
- [input] Adopt portraitZoneMinY = 0.5 as the default (left stick zone starts at half height in portrait).
- [input] Renderer must read getTouchOverlay() each frame and only draw when visible; zones/jumpFlash/fireRatio/armed available.
- [camera/level] On 844x390 touch, first tutorial anchor t1 sits at screen y≈0 at spawn → reduce touch look-down and/or move t1; verify first anchors are comfortably visible on phones.
- [input] Death screen: canvas tap → anyPressed only; consider allowing a tap anywhere to respawn on touch (game decides via anyPressed when state==='dead' after a short delay).
- [input] Re-run input e2e (scratchpad/input/sync-e2e.sh && node e2e.js) after render.js lands.
- [camera] snapTo should apply the resting look-down offset (avoid ~100u glide after respawn/restart).
- [render] headless 1280x720 S7 render ≈20 ms/frame (software raster) — profile & cut cost (cache layers, cull).
- [game] dynamic resolution can't distinguish 30 Hz displays — acceptable; maybe base on rAF interval vs measured work time.
- [level] hints/triggers absent at the time of game agent test — confirm level agent adds them.
- [creature/audio] add windup seconds to creature:attack payload (audio currently reads creature.attack.windup internal).
- [ui/level] Phone landscape: section title card overlaps the first tutorial anchor at the top centre — shrink/raise title on short landscape or keep anchors out of that band at spawn.
- [level] Mid-layer sign "HERE THE DESCENT BEGINS…" partly hidden behind S1 start platform; check sign placements vs world walls.
- [level/render] Far decor very large (ribs 2280x1500, towers/shafts 3000 tall, multiple light shafts) → main render cost; trim.
- [creature] renderGlow uses 'lighter' (4x cost on CPU raster); render ~2ms close-up — consider hairlines/fills.
- [render] darkness buffer 1/3 res nearest-neighbour — check edge crawl in motion.

# 3D integration notes
- [level/creature] S6→S7: s7-roof (y -287..-284, hole = landing footprint x[-34,10] z[-11,11]) sits 1 m above s7-landing (top -288) → creature (2 m thick) cannot pass → ~2.6 relocations/run. Open a ≥4 m creature passage somewhere that is NOT a lethal trap next to the S7 checkpoint; re-run level verify.mjs + creature reallevel/stuckreal sims.
- [handsView] use renderer.setLanternParent(socket, ZERO, {bulb:false}) instead of hiding lanternBulb directly.
- [game] renderer.precompile() after creature/hands/UI meshes exist (avoid first-use shader hitches).
- [game] check game.fade stays 0.7 for 7 s after start (headless timing?).
- [render] environment art is greybox-like in wide views → environment-art pass (architectural detail kit, trims, buttresses, arches, light shafts).
- [ui] hints in VR must use VR text; Game owns setUIMode.
