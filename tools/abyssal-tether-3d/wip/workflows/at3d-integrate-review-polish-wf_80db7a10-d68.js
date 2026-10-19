export const meta = {
  name: 'at3d-integrate-review-polish',
  description: 'Integrate the 3D Quest game end-to-end, review it with 4 specialist critics, fix by file ownership, environment-art pass, final verification',
  phases: [
    { title: 'Integrate', detail: 'wire all real modules, full in-game playthrough with creature live, apply known integration fixes' },
    { title: 'Review', detail: 'VR UX, Quest performance, horror pacing, adversarial bug hunt' },
    { title: 'Fix', detail: 'fixers grouped by disjoint file ownership' },
    { title: 'Environment art', detail: 'architectural detail kit + level dressing, critic loop on screenshots' },
    { title: 'Verify', detail: 'final end-to-end, level verification, budgets, new creature kit compatibility' },
  ],
}

const SP = '/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad'
const REPO = '/home/user/TradeCheckPro'
const G = REPO + '/public/abyssal-tether-3d'

const CTX = `
CONTEXT: "ABYSSAL TETHER 3D" — a full-3D Meta Quest 3 WebXR grappling horror game (three.js r170 vendored at
${G}/vendor/three, ES modules, no bundler), a port of the finished 2D game in ${REPO}/public/abyssal-tether/.
Read ${SP}/CONTRACT3D.md (interfaces, controls, Quest budget: ≤150 draw calls, ≤350k triangles stereo, no
post-processing, ≤1 shadow light) and ${SP}/INTEGRATION_NOTES.md (bottom section "3D integration notes").
User decisions: FULL 3D movement, NO comfort options (smooth turn, no vignette/tunnelling, full-speed falls),
WebXR (no Unity), creature = the Mason (Blender kit at ${G}/assets/models/mason_kit.glb — may be REPLACED during
this run by a separate creature-art workflow with a scarier redesign that keeps the same node names), original
baked textures in ${G}/assets/textures. All modules are committed and lint-clean.
Module map: src/sim/{config3d,physics3d,level3d,creature3d,threat3d}.js, src/data/level-data-3d.js, src/game.js,
src/main.js, src/render/{renderer3d,levelView,ropeView,fx,materials,creatureView,handsView}.js,
src/input/{inputManager,xrInput,desktopInput}.js, src/ui/ui3d.js, src/audio/audio3d.js, index.html, style.css.
Debug API: window.AT3D = { game, debug: { state(), teleport(x,y,z), setInput(partial|null), step(sec), attach(hand,id),
godMode(b), warp(i), freeze(b) } } (setInput supports hands[h].aimAt = anchor id).
Existing harnesses you can reuse: level verification ${SP}/3d/level/verify.mjs (Node; must keep printing
"ALL CHECKS PASS"), level bot routes in ${SP}/3d/level/routes.mjs + bot.mjs, game tests ${SP}/3d/game/run-tests.cjs and
mock XR ${SP}/3d/game/xr-mock.js, input tests ${SP}/3d/input/, creature sims ${SP}/3d/creature/, render harness
${SP}/3d/render/, ui/audio tests ${SP}/3d/uiaudio/.
Testing: serve ${G} with npx http-server <dir> -p <free port> -s -c-1; Playwright via NODE_PATH=$(npm root -g) node x.cjs;
chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']}). Headless
rendering is slow (software); use AT3D.debug.freeze + step for deterministic sim. LOOK at screenshots with Read.
Lint gate: cd ${REPO} && npx eslint public/abyssal-tether-3d/ must pass. Do NOT git commit.`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['id', 'severity', 'file', 'problem', 'evidence', 'fix'],
      },
    },
  },
  required: ['findings'],
}
const REPORT = {
  type: 'object',
  properties: {
    done: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
    screenshots: { type: 'array', items: { type: 'string' } },
    e2eScript: { type: 'string' },
    budget: { type: 'string' },
  },
  required: ['done', 'verified', 'remaining', 'screenshots', 'e2eScript', 'budget'],
}

// ---------------------------------------------------------------- Integrate
phase('Integrate')
const integ = await agent(`${CTX}

ROLE: integration lead. You may edit ANY file under ${G}/src, ${G}/index.html, ${G}/style.css (not vendor/,
not config3d.js/physics3d.js — propose changes for those instead).
1) Read every module and cross-check every inter-module call/field/event against the real implementations; fix
   mismatches minimally.
2) Apply the "3D integration notes" (S6→S7 creature passage — keep it from becoming a lethal trap near the S7
   checkpoint and re-run ${SP}/3d/level/verify.mjs; handsView lantern bulb via setLanternParent option;
   renderer.precompile() after all meshes exist; check game.fade after start; VR difficulty panel: "NIGHTMARE"
   overflows its card in ${SP}/3d/uiaudio/shots/vr-grid.png — fix the fit).
3) Write a reusable end-to-end script ${SP}/3d/e2e/e2e.cjs that: boots the real game (desktop) with zero console
   errors; starts Normal; uses real mouse/keyboard to tether in S1; then plays the WHOLE descent continuously
   (no warps) by replaying the level bot's verified routes through AT3D.debug.setInput/step with the creature LIVE,
   recording deaths/causes, time, and reaching victory; checks the victory panel + best time persisted across reload;
   then repeats a short section run inside a mock XR session (enterVR → trigger tether → swing → release → B pause →
   resume) and checks stereo draw calls/triangles in 3 representative sections. Print a PASS/FAIL table.
   Make it pass (fix real bugs you find; if the bot dies to the live creature, decide whether it is the bot's
   pacing or an unfair creature behaviour and report).
4) Screenshots of key moments (menu, S1 start, a swing with rope, S4 sighting, creature close in S5/S7, death,
   victory, VR panel) into ${SP}/3d/e2e/shots/ — look at them.
Report precisely what you changed and verified.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

// ---------------------------------------------------------------- Review
phase('Review')
const e2eInfo = integ ? `Integration report — done: ${integ.done.join(' | ')}; remaining: ${integ.remaining.join(' | ')}; e2e script: ${integ.e2eScript}; budget: ${integ.budget}` : 'Integration agent failed; work from the code.'
const CRITICS = [
  { key: 'vr-ux', text: `VR UX & CONTROLS CRITIC. Think like a Quest 3 player in the Quest Browser. Check (mock XR + code reading): Enter VR flow, reference space/floor height, rig vs head alignment, hand/controller mapping (trigger tether, grip yank, sticks, A/B/X/Y), smooth turn feel numbers, reel speeds, aim assist cone/ray assist at VR distances, laser/reticle clarity, which hand gets the lantern, dominant-hand setting, hand-tracking pinch, recenter, panel placement/legibility/size at 1.6 m, wrist HUD readability, hint wording in VR, pausing/blur behaviour, what happens on session end. Everything that would confuse, annoy or break the experience in a headset.` },
  { key: 'perf', text: `QUEST PERFORMANCE AUDITOR. Measure stereo draw calls/triangles/programs per section (all 8 + creature close + UI up), CPU ms per frame split by subsystem (sim, creature, render update, ui, audio), per-frame allocations (heap snapshots / GC counts over long runs), texture memory, shader cost (lights, normal+ORM maps, fog patch), overdraw (fog sprites, glows, particles, transparent panels). Identify the concrete risks for 72–90 Hz on Quest 3 and specific, safe optimizations with expected gains.` },
  { key: 'horror', text: `HORROR & PACING CRITIC. Play through (debug stepping + screenshots + reading creature/audio/threat/ui code) as a first-time player: is the shaft colossal and oppressive, does darkness + lantern + fog work, does the S4 sighting land, is the creature heard before seen, do its approaches/near-misses/retreats create fear-relief-renewed-fear waves, are audio cues (snap, strike, calls, heartbeat) well-timed, is death fair and fast to recover from, is the escape in S8 a climax, is the victory a relief? Give concrete, implementable changes ranked by impact.` },
  { key: 'bugs', text: `ADVERSARIAL BUG HUNTER. Review all 3D modules for correctness bugs with a concrete failure path: state-machine races (pause/death/victory/restart/warp/XR session end mid-action), stuck inputs, listeners leaking across restarts, NaN propagation, division by zero, null derefs on optional subsystems, wrong coordinate spaces (local vs world for hands/rig), time accumulation bugs, localStorage edge cases, resize/DPR, memory leaks (geometries/materials/textures not disposed on rebuild). Reproduce each with Node or Playwright before reporting.` },
]
const reviews = await parallel(CRITICS.map(c => () =>
  agent(`${CTX}\n${e2eInfo}\n\nROLE: ${c.text}\nDo not edit repo files (scratch under ${SP}/3d/review-${c.key}/ is fine). Report findings with severity, file, evidence and an exact fix. Only real, evidenced problems.`,
    { label: `review:${c.key}`, phase: 'Review', schema: FINDINGS })
))
const all = reviews.filter(Boolean).flatMap((r, i) => r.findings.map(f => ({ ...f, from: CRITICS[i].key })))
const ranked = all.filter(f => f.severity !== 'minor').concat(all.filter(f => f.severity === 'minor'))
log(`Review: ${all.length} findings (${all.filter(f => f.severity === 'blocker').length} blocker, ${all.filter(f => f.severity === 'major').length} major)`)

// ---------------------------------------------------------------- Fix
phase('Fix')
const groupOf = (file) => {
  const f = file || ''
  if (/src\/render\//.test(f)) return 'render'
  if (/src\/(ui|audio|input)\//.test(f)) return 'uiio'
  return 'simgame'
}
const GROUPS = {
  simgame: 'src/sim/creature3d.js, src/sim/threat3d.js, src/sim/level3d.js, src/data/level-data-3d.js, src/game.js, src/main.js, index.html, style.css (NOT config3d.js / physics3d.js — write exact proposed diffs for those in your report)',
  render: 'src/render/*.js (renderer3d, levelView, ropeView, fx, materials, creatureView, handsView)',
  uiio: 'src/ui/ui3d.js, src/audio/audio3d.js, src/input/*.js',
}
const FIXREP = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    proposalsForLead: { type: 'array', items: { type: 'string' } },
    gates: { type: 'string' },
  },
  required: ['fixed', 'skipped', 'proposalsForLead', 'gates'],
}
const e2eScript = (integ && integ.e2eScript) || `${SP}/3d/e2e/e2e.cjs`
const fixes = await parallel(Object.keys(GROUPS).map(g => () => {
  const mine = ranked.filter(f => groupOf(f.file) === g)
  if (!mine.length) return Promise.resolve({ fixed: [], skipped: [], proposalsForLead: [], gates: 'no findings' })
  return agent(`${CTX}

ROLE: fixer for file group "${g}". You may edit ONLY: ${GROUPS[g]}. Other fixers edit the other groups concurrently.
Findings to address (verify each first — skip with a reason if it does not reproduce or the fix costs more than it buys):
${mine.map(f => `- [${f.id}][${f.severity}][${f.from}] ${f.file}: ${f.problem}\n  evidence: ${f.evidence}\n  fix: ${f.fix}`).join('\n')}
Regression gates after your edits: lint; node ${SP}/3d/level/verify.mjs ("ALL CHECKS PASS") if you touched sim/data/game;
the e2e script ${e2eScript} must still pass. Report fixed/skipped ids.`, { label: `fix:${g}`, phase: 'Fix', schema: FIXREP })
}))

// ---------------------------------------------------------------- Environment art
phase('Environment art')
const ENVREP = {
  type: 'object',
  properties: {
    changes: { type: 'array', items: { type: 'string' } },
    before: { type: 'array', items: { type: 'string' } },
    after: { type: 'array', items: { type: 'string' } },
    budget: { type: 'string' },
  },
  required: ['changes', 'before', 'after', 'budget'],
}
const CRIT = {
  type: 'object',
  properties: { score: { type: 'number' }, mustFix: { type: 'array', items: { type: 'string' } } },
  required: ['score', 'mustFix'],
}
let envNotes = `Known problem: wide views read like a textured greybox (plain boxes, flat grey planes in fog) instead of a
colossal Lanternwright cathedral-machine; see ${SP}/3d/render/out/sheet_sections.png and sheet_windows.png.`
const envHistory = []
for (let round = 1; round <= 2; round++) {
  const env = await agent(`${CTX}

ROLE: environment artist + technical artist, round ${round}/2.${round === 1 ? ' RESUMED STEP: a previous attempt of exactly this step was cut off by an account usage limit after doing real work. Its partial edits are still on disk: levelView.js (+≈1,860 lines), materials.js, renderer3d.js (git diff against HEAD b28328f), tools/abyssal-tether-3d/build_env_kit.py and assets/models/env/ch1_env_kit.glb. fx.js, atmosphere.js and debris.js belong to another workflow. Review your partial work, take BEFORE shots from HEAD if you have none (git stash is NOT allowed; use git show HEAD:path into a scratch copy of the game instead), finish and polish.' : ''} Make the shaft look like an ancient, colossal,
oppressive cathedral-machine grown through by something alive — readable geometry, unreadable place.
${envNotes}
You may edit: src/render/levelView.js, src/render/materials.js, src/render/renderer3d.js, and add new files under
${G}/assets/models/env/ and ${REPO}/tools/abyssal-tether-3d/ (e.g. build_env_kit.py). Headless Blender:
${SP}/blender-venv/bin/python (bpy 5.2.2, import bpy before bmesh/mathutils; numpy, Pillow available).
Ideas (pick what gives the most impact within budget): a Blender architectural kit exported as GLB (instanced in
three.js) — carved trims/cornices along slab edges, buttresses and pilasters on walls, ribbed vaults under floors,
pointed arches framing openings, corbels holding anchors, colossal statues/columns in the far layer, iron
machinery/chains/cages, organic growth (sinew roots, flesh seams in cracks) creeping down the walls deeper in the
descent; light shafts (cheap additive cards), better distant silhouettes, wall surface variation (stepped courses,
damage), per-section colour/fog identity. Keep collision unchanged (purely visual dressing; never block routes or
anchor sight lines — re-run ${SP}/3d/level/verify.mjs if you touch data). Quest budget is a hard limit (stereo
≤150 calls ≤350k tris; prefer instancing/merging; report numbers). Take BEFORE (round 1) and AFTER screenshots at
the same camera poses (every section + 2 window views) into ${SP}/3d/env/r${round}/ and look at them. Lint + the e2e
script ${e2eScript} must pass.`, { label: `env:r${round}`, phase: 'Environment art', schema: ENVREP })
  if (!env) break
  const crit = await agent(`${CTX}

ROLE: art director. Compare BEFORE: ${env.before.join(', ')}  AFTER: ${env.after.join(', ')} (open them with Read).
Score 0–10 how well the environment now reads as a colossal, oppressive, original cathedral-machine for VR horror,
and list MUST-FIX items (specific, actionable).`, { label: `env-critic:r${round}`, phase: 'Environment art', schema: CRIT })
  envHistory.push({ round, changes: env.changes, budget: env.budget, score: crit ? crit.score : null })
  if (!crit || crit.score >= 8) break
  envNotes = `Art director score ${crit.score}/10. MUST FIX:\n- ${crit.mustFix.join('\n- ')}`
}

// ---------------------------------------------------------------- Verify
phase('Verify')
const final = await agent(`${CTX}

ROLE: release verifier. Run every gate and report honestly: lint; node ${SP}/3d/level/verify.mjs; the e2e script
${e2eScript} (full continuous Normal run with the live creature + mock XR section + budgets); the input, ui/audio and
creature test suites if quick; load the CURRENT ${G}/assets/models/mason_kit.glb (it may have been replaced by the
creature-art workflow) in the real game and confirm CreatureView builds it without faults, then screenshot the
creature close-up in S5 and S7 and look at them. Stereo budget per section. Fix only trivial breakages; list
anything else.`, { label: 'verify', phase: 'Verify', schema: REPORT })

return { integ, findings: all.length, fixes, envHistory, final }
