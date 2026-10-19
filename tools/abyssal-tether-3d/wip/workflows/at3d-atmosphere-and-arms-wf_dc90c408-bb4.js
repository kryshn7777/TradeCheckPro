export const meta = {
  name: 'at3d-atmosphere-and-arms',
  description: 'Atmospheric fog + debris (GPU-cheap, procedural) and Blender-made realistic grapple launcher + high-detail rigged gloved hands/forearms, each with critic loops',
  phases: [
    { title: 'Atmosphere', detail: 'fog volumes, low fog, dust motes, grit streams, event rubble, drips; before/after critic loop; Quest budget' },
    { title: 'Arms', detail: 'Blender high-poly launcher + gloved hands/forearms, baked to game meshes, finger rig; render critic loop; handsView integration + in-engine critic' },
  ],
}

const SP = '/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad'
const REPO = '/home/user/TradeCheckPro'
const G = REPO + '/public/abyssal-tether-3d'
const OUT = SP + '/3d/visuals'
const PY = SP + '/blender-venv/bin/python'

const CTX = `PROJECT: ABYSSAL TETHER 3D — original grappling traversal-horror game for Meta Quest 3 (WebXR, three.js r170 vendored at
${G}/vendor/three: three.module.min.js, addons/loaders/GLTFLoader.js, addons/utils/BufferGeometryUtils.js; the full npm package
three@0.170.0 can be fetched with "npm pack" if you need another addon — vendor only what you use, with its licence) + desktop.
Code: ${G}/src (game.js orchestrates; render/fx.js = FX (dust, bursts, debris, fade; update(dt, game, head, threat) is called by
game.js every frame), render/handsView.js = the player's hands, launchers and lantern, render/ropeView.js = the tethers,
render/renderer3d.js = renderer/scene/fog/lights, render/levelView.js = level meshes, render/materials.js = shared materials).
Setting: an inverted stone cathedral-machine shaft built by the "Lanternwrights" (brass, iron, ashlar, lamps), descending into flesh
and dark; the player wears two wrist-mounted grapple launchers and carries a lantern. Original IP only — do not imitate any
existing game's gear or arms. Contract: ${SP}/CONTRACT3D.md. Owner's standard: "studio level", "high definition like a VR game,
not low poly", "realistic". Quest budget for the WHOLE frame (stereo): ≤ 150 draw calls, ≤ 350k triangles; the level uses ~20–60
calls and ~20–40k tris today, so there is room, but every addition must be measured and reported.
Headless Blender: ${PY} (bpy 5.2.2; import bpy BEFORE bmesh/mathutils; numpy + Pillow available; Cycles CPU). The 4 CPUs are shared
with other Blender/Chromium jobs: render previews at ≤ 1280×720 with ≤ 48 samples + denoise, and keep bakes to what you need.
Screenshots of the game: headless Chromium via Playwright (NODE_PATH=$(npm root -g)), args --use-angle=swiftshader
--enable-unsafe-swiftshader --ignore-gpu-blocklist; the game exposes window.AT3D.debug (warp(i), freeze(on), step(s, {render}),
teleport, setInput) — see ${SP}/3d/video/video.cjs and ${SP}/3d/e2e/e2e.cjs for working examples of serving the game,
driving it, posing the camera (game._setLook) and taking screenshots; the e2e has a mock-XR section showing hands in XR.
Lint: cd ${REPO} && npx eslint public/abyssal-tether-3d/ tools/. Level checks: node ${SP}/3d/level/verify.mjs.
CONCURRENCY RULES: other workflows edit other files at the same time: NEVER edit levelView.js, materials.js, renderer3d.js
(environment-art workflow), src/game.js, src/sim/*, src/input/*, src/ui/*, src/audio/*, src/data/* (player-feel workflow, which is
also changing the player's eye height to real 1:1 scale — eyes ≈1.6 m above the floor instead of 0.88 m; design for that).
If you need a hook in a file you do not own, write the exact proposed diff in your report (proposals) instead of editing it.
Do NOT git commit or push. Put scratch files under ${OUT}/<your-label>/.`

const REPORT = {
  type: 'object',
  properties: {
    changes: { type: 'array', items: { type: 'string' } },
    before: { type: 'array', items: { type: 'string' } },
    after: { type: 'array', items: { type: 'string' } },
    budget: { type: 'string' },
    proposals: { type: 'array', items: { type: 'string' } },
  },
  required: ['changes', 'before', 'after', 'budget', 'proposals'],
}
const CRIT = {
  type: 'object',
  properties: { score: { type: 'number' }, mustFix: { type: 'array', items: { type: 'string' } } },
  required: ['score', 'mustFix'],
}

async function atmosphereLane() {
  let notes = 'First round.'
  const history = []
  let last = null
  for (let round = 1; round <= 3; round++) {
    const r = await agent(`${CTX}

ROLE: VFX technical artist, round ${round}/3.${round === 1 ? ` RESUMED STEP: a previous attempt of exactly this step was cut off by an account usage limit after doing real work. Its partial edits are still on disk: src/render/fx.js (+≈550 lines), new src/render/atmosphere.js (≈990 lines) and src/render/debris.js (≈710 lines), scratch files under ${OUT}/atmos/. Review them, keep what is good, finish, then do the screenshots and budget report.` : ''} OWNER ASK (verbatim): "Add atmospheric fog as well and debris. Render procedurally or
what you think might be well optimised for this."
${notes}
Build it in src/render/fx.js plus NEW files (e.g. src/render/atmosphere.js, src/render/debris.js), driven from FX.update (game.js
already calls it every frame with the game, the head position and threat). Recommended design (improve on it if you can):
1. VOLUMETRIC-LOOKING FOG without raymarching: an InstancedMesh of large soft camera-facing fog cards anchored in world space
   around the player (recycled as the player descends), slowly drifting/rotating, alpha from a procedurally generated tileable
   noise texture (canvas, 256² or 512², made once at load), very low per-card opacity, faded near the camera (no clipping into the
   eye) and with distance, tinted by the current section fog colour (renderer3d exposes the theme/fog colour — read it, do not edit
   renderer3d), and LIT by the player's lantern (brighter near the lantern, warm), plus the creature's emissive glow when it is near.
   Low-lying fog sheets over ledges/pits (horizontal scrolling noise planes) where they read well. One or two draw calls total.
2. DEBRIS: (a) dust motes: one Points draw call, motion computed in the VERTEX SHADER from a time uniform (zero CPU per frame),
   catching the lantern light; (b) grit streams trickling from walls/cracks (instanced streak quads); (c) EVENT RUBBLE: pooled
   InstancedMesh pebbles/chunks with simple CPU physics and bounces off level solids (game.level.querySolids), spawned by the
   creature moving nearby (stronger the closer/faster it is — it is "architecture that learned to hunt", the shaft sheds stone as
   it passes), hard landings, crumbling/fragile anchors, rope jolts and the S8 gate slam (listen on game.bus for existing events:
   grep the code for emit( to find them); (d) water drips in wet/deep sections. Reuse the existing FX dust/debris code paths where
   they exist rather than duplicating them.
3. Quality tiers: honour settings.reducedEffects (fewer/no cards) and keep a desktop-high option; no per-frame allocations; no shader
   recompiles at runtime (precompile at load like the rest of FX); total added ≤ 6 draw calls, ≤ 8k triangles, overdraw controlled.
4. Take BEFORE (round 1 only) and AFTER screenshots at identical camera poses: every section S1–S8 (warp + pose looking out into the
   shaft and down), plus 2 shots with the creature close (S5/S7) and 1 landing-rubble shot, at 960×540, into ${OUT}/atmos/r${round}/.
   LOOK at them yourself and iterate before reporting. Report draw calls/triangles before vs after (renderer.info) and FX cpu ms.
Gates: lint; verify.mjs; the e2e (NODE_PATH=$(npm root -g) node ${SP}/3d/e2e/e2e.cjs) once at the end must still pass.`,
      { label: `atmos:r${round}`, phase: 'Atmosphere', schema: REPORT })
    if (!r) break
    last = r
    const c = await agent(`${CTX}

ROLE: art director for VR horror. Open with Read and compare BEFORE: ${(history[0] ? history[0].before : r.before).join(', ')}
AFTER: ${r.after.join(', ')}. Score 0–10 how much the new fog and debris add depth, scale, dread and "studio quality" without
muddying readability (anchors, ledges and the route must stay readable; the player must still see where to swing), and how cheap it
looks (banding, card edges, popping, sprite-y dust, uniform repetition). List MUST-FIX items, specific and actionable.`,
      { label: `atmos-critic:r${round}`, phase: 'Atmosphere', schema: CRIT })
    history.push({ round, before: r.before, budget: r.budget, score: c ? c.score : null })
    if (!c || (c.score >= 8.5 && c.mustFix.length === 0)) break
    notes = `Art director score ${c.score}/10. MUST FIX:\n- ${c.mustFix.join('\n- ')}\nPrevious round changes: ${r.changes.join(' | ').slice(0, 2500)}`
  }
  return { last, history }
}

async function armsLane() {
  const MODEL = {
    type: 'object',
    properties: {
      builder: { type: 'string' },
      glb: { type: 'string' },
      renders: { type: 'array', items: { type: 'string' } },
      triangles: { type: 'string' },
      bones: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
    },
    required: ['builder', 'glb', 'renders', 'triangles', 'bones', 'notes'],
  }
  let notes = 'First round. Read src/render/handsView.js first: keep what the current launchers/lantern do (aiming origin, muzzle, rope attach point, lantern) so the new assets can replace them 1:1.'
  let model = null
  const hist = []
  for (let round = 1; round <= 3; round++) {
    model = await agent(`${CTX}

ROLE: lead weapon/prop artist + character technical artist, round ${round}/3.${round === 1 ? ` RESUMED STEP: a previous attempt of exactly this step was cut off by an account usage limit after doing real work. Its partial edits are still on disk: ${REPO}/tools/abyssal-tether-3d/build_hands.py (≈3,270 lines) and scratch output under ${OUT}/arms/. Run it, look at what it makes, continue from it rather than starting over.` : ''} OWNER ASK (verbatim): "Make gun more realistic. Render
on Blender. Also give player arms with high definitions like a VR game and not low poly."
"Gun" = the wrist-mounted GRAPPLE LAUNCHER on each hand. Write/extend ${REPO}/tools/abyssal-tether-3d/build_hands.py (deterministic,
commented, CLI like build_mason.py: --out, --render, --samples, --res) that builds IN BLENDER:
A) THE LAUNCHER (left + right, mirrored): a believable, mechanical, hand-built Lanternwright tool — machined brass and blued/oiled
   iron, a cable drum with visible wound cable, a spring/pneumatic firing chamber, a barbed grapple head seated in the muzzle, a
   pressure/tension gauge with a needle (separate object so it can animate), leather straps and buckles to the forearm, rivets,
   screws, knurling, wear on edges (curvature-based), oil/soot in crevices. Separate animatable parts with pivots: drum (spins on
   reel), gauge needle, grapple head (leaves on fire), trigger lever, a recoil slide.
B) THE ARMS: gloved hands + forearms to just past the elbow (heavy leather work gloves with stitching, cracked leather, cloth sleeve
   with a cuff, the launcher strapped over the forearm). One skinned mesh per hand with an armature: forearm, wrist, and 3 bones per
   finger + thumb (≤ 20 bones), weights painted for clean knuckle bends; shape keys or bone poses for OPEN, GRIP (fist on the
   handle), TRIGGER (index squeezing), POINT. Mirror for left/right.
C) HIGH-POLY → GAME: model the detail high (subdivision, bevels, stitching, rivets), then bake normal + AO (+ curvature-driven base
   colour wear, roughness, metalness) onto game meshes: per hand + launcher LOD0 ≤ 14k triangles, LOD1 ≈ 40 %; one 2048² texture
   set per side or a shared atlas (albedo sRGB, normal OpenGL, ORM); export ${G}/assets/models/player_arms.glb (both sides, armatures,
   pose actions or shape keys, named animatable launcher parts with sensible pivots/axes documented) ≤ 8 MB.
D) RENDERS (Cycles, look at every one): first-person view (as the player sees them, ~1.6 m eye height, hands at waist-to-chest height,
   lantern light), a close-up of the launcher mechanism, a three-quarter turntable of one arm, and the finger poses side by side;
   into ${OUT}/arms/r${round}/. Iterate until they look like a shipped AAA VR game's hands and gear, not a prototype.
${notes}`,
      { label: `arms-model:r${round}`, phase: 'Arms', schema: MODEL })
    if (!model) break
    const c = await agent(`${CTX}

ROLE: art director (AAA VR). Open these renders with Read: ${model.renders.join(', ')}. Score 0–10 for realism and craft: do the
launcher and gloved arms look like hero assets of a shipped VR game (material definition, believable mechanics and scale, silhouette,
wear, stitching, knuckle deformation in the poses, no low-poly faceting, no texture stretching, no bake artefacts)? List MUST-FIX
items, specific and actionable (name the part, what is wrong, what to do).`,
      { label: `arms-critic:r${round}`, phase: 'Arms', schema: CRIT })
    hist.push({ round, score: c ? c.score : null, triangles: model.triangles })
    if (!c || (c.score >= 8.5 && c.mustFix.length === 0)) break
    notes = `Critic score ${c.score}/10. MUST FIX:\n- ${c.mustFix.join('\n- ')}\nYour previous builder: ${model.builder}`
  }
  if (!model) return { hist }
  let inNotes = ''
  let integ = null
  for (let round = 1; round <= 2; round++) {
    integ = await agent(`${CTX}

ROLE: gameplay graphics programmer, round ${round}/2. Integrate ${model.glb} (built by ${model.builder}; bones/parts: ${model.bones.join(', ')};
notes: ${model.notes.slice(0, 2000)}) into src/render/handsView.js (and src/render/ropeView.js only for the rope origin):
- Load with GLTFLoader (async; keep the current procedural hands/launchers as the fallback until it loads or if it fails). Precompile
  its materials/textures at load (no first-use hitch). Attach to the XR controller GRIP spaces with a correct grip offset/rotation
  (hands must sit naturally on the controllers — check the WebXR grip-space convention), and on desktop place them in view as the
  current desktop hands are.
- Finger posing every frame from the controller analog values: read the XR session's inputSources gamepads directly in handsView
  (trigger = buttons[0].value, squeeze = buttons[1].value, thumb touch if present) — read-only, do not edit src/input/*. Smooth the
  values; blend OPEN/GRIP/TRIGGER/POINT. Desktop: drive from the existing intents (held/pressed/yank).
- Launcher animation: fire kick (recoil slide + grapple head leaves the muzzle; the rope must visibly start AT the muzzle), cable drum
  spins with rope length change (reel in/out) at the right rate for the drum radius, gauge needle follows rope tension (the physics
  exposes rope.tension; a slip clutch may be added by another workflow — use whatever exists), subtle vibration under high tension.
- The lantern stays (keep its light and placement logic).
- Budget: report calls/tris added (stereo); LOD1 when the hands are far is not needed (always close) — use LOD0 but keep it within
  the 14k/hand budget; skinning cost note.
- Screenshots: desktop view and the e2e mock-XR view (hands visible, posed open/grip/trigger, rope from the muzzle) at 960×540 into
  ${OUT}/arms-int/r${round}/ — look at them.
${inNotes}
Gates: lint; e2e once at the end (it has XR hand checks — keep them passing or update the checks if the contract legitimately changed).`,
      { label: `arms-int:r${round}`, phase: 'Arms', schema: REPORT })
    if (!integ) break
    const c = await agent(`${CTX}

ROLE: VR art director. Open with Read: ${integ.after.join(', ')}. Score 0–10: do the hands/launchers look and sit right in first person
(scale vs the 1.6 m eye height, wrist angle on the controller, material read under the lantern, rope leaving the muzzle, no
clipping/z-fighting, no floating gaps)? MUST-FIX list, specific.`,
      { label: `arms-int-critic:r${round}`, phase: 'Arms', schema: CRIT })
    if (!c || (c.score >= 8.5 && c.mustFix.length === 0)) break
    inNotes = `Critic score ${c.score}/10. MUST FIX:\n- ${c.mustFix.join('\n- ')}`
  }
  return { hist, model, integ }
}

const [atmos, arms] = await parallel([
  () => (phase('Atmosphere'), atmosphereLane()),
  () => armsLane(),
])
return { atmos, arms }
