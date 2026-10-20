export const meta = {
  name: 'at3d-player-feel',
  description: 'Apply integration leftovers, realistic pendulum physics (slip clutch, elastic catch, drag), 1:1 player height + calibration, head clearance, adversarial review',
  phases: [
    { title: 'Leftovers', detail: 'apply the integration fixers proposals for the lead' },
    { title: 'Physics', detail: 'tension-limited rope (slip clutch), damped elastic catch, quadratic drag, energy-accurate pendulum; routes re-verified' },
    { title: 'Height', detail: '1:1 real-scale eye height in XR and desktop, calibration UI, head clearance on every route' },
    { title: 'Review', detail: 'adversarial review: VR presence math, physics plausibility, regressions; then fixes' },
  ],
}

const SP = '/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad'
const REPO = '/home/user/TradeCheckPro'
const G = REPO + '/public/abyssal-tether-3d'
const OUT = SP + '/3d/feel'
const JOURNAL = '/root/.claude/projects/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/subagents/workflows/wf_80db7a10-d68/journal.jsonl'

const CTX = `PROJECT: ABYSSAL TETHER 3D — original grappling traversal-horror game for Meta Quest 3 (WebXR) + desktop, three.js r170
(vendored), ES modules under ${G}/src (game.js orchestrates; sim/ = pure simulation: physics3d.js Rope3D/TetherSystem/Physics3D,
config3d.js CONFIG/DIFFICULTY/Storage, level3d.js, creature3d.js, threat3d.js; input/ = inputManager.js, xrInput.js, desktopInput.js;
ui/ui3d.js; audio/audio3d.js; render/*). Contract: ${SP}/CONTRACT3D.md. Units metres/seconds, +Y up, physics fixed step 1/240 s.
The player is a collision SPHERE (CONFIG.player.radius 0.38) that rests on floors; tethers fire from both hands and attach to anchors.
The owner tests on a real Quest 3 and chose "full experience, no comfort options".

TEST HARNESS (scratchpad; paths hardcode ${G}): level verification \`node ${SP}/3d/level/verify.mjs\` (must print ALL CHECKS PASS);
route bot over every section and variant \`node ${SP}/3d/level/run.mjs all all\` (sim.mjs wraps the REAL sim; bot.mjs, routes.mjs);
browser end-to-end \`NODE_PATH=$(npm root -g) node ${SP}/3d/e2e/e2e.cjs\` (headless Chromium + SwiftShader; slow — the machine has 4
busy CPUs, so run it once at the end of your work, not repeatedly); input tests ${SP}/3d/input/test-intent.mjs and run-pw.cjs;
creature pacing ${SP}/3d/creature/ (pacing.mjs, los2.mjs). Lint: \`cd ${REPO} && npx eslint public/abyssal-tether-3d/\`.
Put your own scripts, logs and screenshots under ${OUT}/<your-label>/.

CONCURRENCY RULES: other workflows run at the same time. An environment-art workflow is editing src/render/levelView.js,
src/render/materials.js, src/render/renderer3d.js (NEVER edit those three files). A visuals workflow edits src/render/fx.js,
src/render/handsView.js, src/render/ropeView.js and new render files (do not edit those either). An engine workflow works in a
separate git worktree (ignore it). If one of your gates fails in a file you do not own, re-run once; if it persists, report it with
evidence instead of editing that file. Do NOT git commit or push. Keep edits minimal, idiomatic and commented like the surrounding code.`

const REPORT = {
  type: 'object',
  properties: {
    changes: { type: 'array', items: { type: 'string' } },
    measurements: { type: 'array', items: { type: 'string' } },
    gates: { type: 'string' },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['changes', 'measurements', 'gates', 'openIssues'],
}

phase('Leftovers')
const leftovers = await agent(`${CTX}

ROLE: integration lead's fixer. RESUMED STEP: a previous attempt of exactly this step was cut off by an account usage limit after doing real work. Its partial edits are still on disk in game.js, audio3d.js, creature3d.js, level3d.js, ui3d.js, creatureView.js and level-data-3d.js (see git diff against HEAD b28328f; ignore diffs in fx.js, levelView.js, materials.js, renderer3d.js and new render files, which belong to other workflows). Review each partial change, keep what is correct, finish the rest. The previous review/fix workflow left "proposalsForLead" (and "skipped" items) in its journal:
${JOURNAL} — read every line with "type":"result" whose value has "proposalsForLead". Apply each proposal that is still valid,
verifying first, EXCEPT: anything in levelView.js/materials.js/renderer3d.js (env-art owns them — list those as open issues);
the VR-01 rig-scale/floor-match idea (a later step in this workflow replaces it); and VR-09's extra turnAboutHead call (the
proposal itself says NOT to add it). Must include at least: BUG-1 (Game3D.resume() clears held so an attached rope is not
dropped/kept wrongly — read the review to get the intended behaviour right), BUG-3 (no warp during the victory slam),
VR-05 'hold X to restart' wording in game.js, FallbackRenderer3D.resize fov reset, ui3d.js VR ray renderOrder and wrist plane
order, audio3d gate slam on game:goal, creature3d _updateVictory timing, level3d indexed writes (no per-frame allocation),
creatureView sightingFogCap 0.55 + ui3d sighting title-card change (H2), the S5 'call' trigger (H4/H5) if it now plays the
creature's real cry, and the fragile e2e 'start fade clears' check (fix the harness check, not the game). For H6 (the S6 fork hint
during peak threat), implement the cheapest good option and justify it. Gates: lint, verify.mjs, run.mjs all all.`,
  { label: 'leftovers', phase: 'Leftovers', schema: REPORT })

phase('Physics')
const physics = await agent(`${CTX}

ROLE: physics programmer. OWNER COMPLAINT (verbatim): "Enhance physics and make the pendulum motion more accurate. Sometimes when
user grabs point near to him he spins unrealistically."
Diagnosis to confirm with measurements: Rope3D (src/sim/physics3d.js) is a one-sided distance constraint with UNLIMITED tension.
Attaching to an anchor ~1.2–2 m away while moving 8–12 m/s makes the body orbit at ω = v/L ≈ 5–9 rad/s (≈1 rev/s) under
v²/L ≈ 6–10 g; a taut catch removes all outward radial speed in one step (perfectly inelastic, no stretch).
FIRST write ${OUT}/physics/swingbench.mjs (imports the real sim like ${SP}/3d/level/sim.mjs does) that measures, BEFORE and AFTER:
(1) the "near grab" spin: attach at 1.3/1.6/2.0 m with tangential 6/9/12 m/s → peak ω, peak rope g-load, revolutions in 3 s;
(2) a free pendulum (no input, no drag) L = 4, 8, 15 m at 10° and 60° amplitude: period vs 2π√(L/g)·(large-angle correction) and
energy drift per period (target < 0.5 %/period at 240 Hz); (3) high-speed catches (falls of 5/10/20 m onto a rope) → peak g and
whether the body bounces; (4) two ropes taut at once: stability (no jitter/energy gain); (5) over every bot route on every variant
(run.mjs harness): max ω, max g, count of frames above 4 g.
THEN implement, keeping the code style and the CONTRACT3D API:
a) SLIP CLUTCH / tension limit: the launcher winch has a maximum holding tension (configurable, e.g. CONFIG.rope.maxTensionG ≈ 3.5–4.5 g
   incl. gravity). When the required tension (centripetal + gravity along the rope, plus the catch spring) exceeds it, the line pays
   out (length increases) at the rate that keeps tension at the limit, dissipating the excess energy. This alone removes the
   unrealistic close-anchor spin. Emit a bus/physics event (e.g. 'rope:slip' with hand + intensity) so audio/haptics can react
   later; if the existing physics event pattern supports haptics already, wire a light haptic through the existing path only if
   it needs no edits to files you do not own (input/* is owned by a later step of THIS workflow — write a note for it instead).
b) DAMPED ELASTIC CATCH: when a slack rope goes taut with outward radial speed, resolve it with a stiff spring-damper over a short
   stretch (a few % of length, critically-damped-ish), not an instant velocity kill; no rebound above ~10 % of the impact speed.
c) QUADRATIC AIR DRAG on the body (realistic human: k ≈ 0.5·ρ·Cd·A/m), replacing/combining the existing linear airDrag so terminal
   velocity stays consistent with CONFIG.player.maxFallSpeed; keep ground behaviour unchanged.
d) Accurate integration: keep 240 Hz; if position projection loses/gains energy measurably, fix it (e.g. velocity-consistent
   projection / symplectic update). Reeling must still conserve angular momentum (it already does, capped by reelSpinCap).
e) Rope minimum length: a later step raises the player's eye to real human height (≈1.25 m above the sphere centre), so the
   minimum rope length must keep the HEAD below the anchor: set CONFIG.rope.minLength to ≥ 1.6 m unless your measurements show a
   better value; check that no route depends on shorter ropes.
Tune so the game still FEELS fast and swingy (this is an action game) while removing the unphysical spin/whip; report before/after
for every bench item. ALL routes on ALL variants must still pass (run.mjs all all + verify.mjs); if a route breaks, prefer tuning over
editing level data; if a route genuinely needs a data change, make the smallest one in level-data-3d.js and re-verify. Update the
bot/routes only if timing changed legitimately (they live in ${SP}/3d/level; keep a .bak). Run e2e once at the end.
You may edit: src/sim/physics3d.js, src/sim/config3d.js (rope/player tuning only), src/data/level-data-3d.js (only if forced), and
the scratchpad harness.`,
  { label: 'physics', phase: 'Physics', schema: REPORT })

phase('Height')
const height = await agent(`${CTX}

ROLE: VR systems programmer. OWNER COMPLAINT (verbatim): "player height must be calibrated. The current one makes me feel compressed."
Diagnosis (confirm): InputManager.xrRigPosition (src/input/inputManager.js) puts the eyes CONFIG.player.eyeHeight = 0.5 m above the
collision-sphere centre for everyone (it measures the real eye height and cancels it), and the sphere (radius 0.38) rests on the
floor — so the eyes are ≈0.88 m above the ground: child height, the world feels ~1.8× too big. Desktop uses the same 0.5 m.
The physics step before you changed rope behaviour; its report: ${physics ? JSON.stringify(physics.changes).slice(0, 3000) : '(physics step failed — check the files)'}.
IMPLEMENT:
a) TRUE 1:1 SCALE in XR (local-floor): the real play-space floor maps to the ground under the player's feet:
   rig.y = body.y − radius − heightOffset (so a standing user's real eye height IS their in-game eye height, a seated user is low unless
   they use seated mode). Keep the horizontal recentre logic, the head-pivot turning (VR-09) and the 'local' reference-space path
   (use a sensible standing eye height there). Desktop: the camera eye sits at a standing eye height (≈1.62 m) above the feet
   (eyeHeight relative to the sphere centre ≈ 1.24) — make it a named tuning value.
b) CALIBRATION in Settings (both the desktop DOM settings and the in-VR settings panel in src/ui/ui3d.js): "Player height" with
   modes Standing (real height, default) and Seated (adds an offset so the eyes sit at a reference standing eye height, measured
   from a calibration press), a "Calibrate: stand (or sit) normally and press" action (VR: trigger on the button; a countdown so the
   pose is natural), and a fine offset ±30 cm in 2.5 cm steps, plus Reset. Persist in Storage settings (src/sim/config3d.js
   SETTINGS_DEFAULTS/Storage — only the settings part). Show the current measured eye height in the panel. Hold-Y recentre must keep
   working and must not wipe the calibration.
c) HEAD CLEARANCE: with the head now ≈1.25 m above the sphere centre, audit every bot route on every variant
   (${SP}/3d/level harness): per frame, the head point (body centre + eye offset for a 1.75 m-tall player, eye 1.64 m) vs solids
   (Level3D.querySolids) and vs the rope anchor (head must stay below the anchor when hanging). List every spot where the head is
   inside or within 0.1 m of geometry, with section, time and solid id. Fix them with the smallest level-data changes in
   src/data/level-data-3d.js (raise a ceiling, thin an overhang, move a decor-free slab edge) WITHOUT changing route feasibility;
   re-run verify.mjs and run.mjs all all after every data change. Re-tune the head-in-geometry fade (game.js _updateHeadBlock) for
   the taller head if needed.
d) Anything else that assumed the 0.5 m eye: e2e checks ('rig = body − 1.1'), input tests, UI panel placement distances, the
   attract camera, death/respawn camera, the wrist HUD, creature sight lines in los2.mjs (standing/seated), audio listener
   position, the lantern's default height. Update the harness expectations to the new contract and document the new contract in
   ${SP}/CONTRACT3D.md (§ rig/eye height).
Physics note from the previous step (rope slip haptics), if any, is yours to wire if it only needs input/* changes.
You may edit: src/input/*.js, src/ui/ui3d.js, src/game.js, src/sim/config3d.js (player eye/settings parts), src/data/level-data-3d.js,
src/audio/audio3d.js (listener only, if needed), the scratchpad harness and CONTRACT3D.md. Gates: lint, verify.mjs, run.mjs all all,
input tests, e2e once at the end.`,
  { label: 'height', phase: 'Height', schema: REPORT })

phase('Review')
const FIND = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
          file: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'evidence', 'fix'],
      },
    },
  },
  required: ['findings'],
}
const summary = `Leftovers: ${JSON.stringify(leftovers && leftovers.changes).slice(0, 2500)}
Physics: ${JSON.stringify(physics && physics.changes).slice(0, 2500)} | measurements: ${JSON.stringify(physics && physics.measurements).slice(0, 2000)}
Height: ${JSON.stringify(height && height.changes).slice(0, 2500)} | measurements: ${JSON.stringify(height && height.measurements).slice(0, 1500)}`
const LENSES = [
  { key: 'vr-presence', text: 'VR PRESENCE & MATH: is the eye height now truly 1:1 with the real floor in every state (standing, seated mode, calibrated, hold-Y recentre, respawn, warp, smooth turn, XR enter/exit, local vs local-floor)? Any path still using the old 0.5 m eye? Are UI panels, wrist HUD, hands, lantern and rope origins consistent with the new head height? Do the calibration UI flows work by hand (desktop DOM + VR panel)? Simulate with a mock XR head pose (see the e2e mock-XR code) at 1.45, 1.65 and 1.85 m and seated 1.2 m.' },
  { key: 'physics', text: 'PHYSICS PLAUSIBILITY & FEEL: re-run the swingbench at ' + OUT + '/physics/swingbench.mjs and try to break it: near grabs at 1.0–2.5 m with 4–16 m/s, two-rope pulls, reel-in at max speed under the clutch, yank, release boost, crumbling/fragile anchors, catch after long falls, rope slip during reel-in, ground contact while tethered, determinism (same inputs → same results). Any energy gain, jitter, tunnelling, NaN, rope length exploding, or a route made impossible/trivial? Does it still feel swingy and fast (compare route times before/after)?' },
  { key: 'regression', text: 'REGRESSIONS: run every gate (lint, verify.mjs, run.mjs all all, input tests, creature pacing quick run, e2e once) and diff behaviour vs the committed HEAD (git diff in ' + REPO + '): look for broken contracts (CONTRACT3D), changed public APIs other modules rely on, per-frame allocations added, settings migration bugs (old saved settings without the new keys), and anything the leftovers fixer changed incorrectly.' },
]
const reviews = (await parallel(LENSES.map((l) => () =>
  agent(`${CTX}

ROLE: adversarial reviewer (${l.key}). What changed in this workflow:
${summary}
Review lens: ${l.text}
Report only real, evidenced problems (with how to reproduce), each with a concrete fix. Do not edit game files.`,
    { label: `review:${l.key}`, phase: 'Review', schema: FIND })))).filter(Boolean)
const findings = reviews.flatMap((r) => r.findings).filter((f) => !/^(nit|info|low)/i.test(f.severity))
log(`${findings.length} review findings to fix`)
let fix = null
if (findings.length) {
  fix = await agent(`${CTX}

ROLE: fixer. Verify each finding first (skip with a reason if it does not reproduce), then fix it. Findings:
${findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}: ${f.problem}\n   evidence: ${f.evidence}\n   fix: ${f.fix}`).join('\n')}
You may edit the files the physics/height/leftovers steps edited (never levelView.js, materials.js, renderer3d.js, fx.js,
handsView.js, ropeView.js). Finish with ALL gates green: lint, verify.mjs (ALL CHECKS PASS), run.mjs all all, input tests, e2e.`,
    { label: 'fix', phase: 'Review', schema: REPORT })
}
return { leftovers, physics, height, findings, fix }
