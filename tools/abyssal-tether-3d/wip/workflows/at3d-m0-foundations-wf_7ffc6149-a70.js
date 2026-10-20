export const meta = {
  name: 'at3d-m0-foundations',
  description: 'Engine milestone M0 in a separate git worktree: harness promoted into the repo, clocks, beats v2, chapter framework, creature split, saves v2, entitlement + demo gate; adversarial review',
  phases: [
    { title: 'Harness', detail: 'E28 core + E29 tooling: verification harness promoted into tools/, relative paths, npm script' },
    { title: 'Foundations', detail: 'lane A: E02 clocks -> E03 beats v2 -> E04 chapter framework; lane B: E01 creature split -> E05 saves v2 -> E06 entitlement' },
    { title: 'Review', detail: 'contract conformance, determinism + Chapter I non-regression, code quality/perf; then fixes' },
  ],
}

const SP = '/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad'
const WT = SP + '/wt-m0'
const G = WT + '/public/abyssal-tether-3d'
const DOCS = WT + '/docs/abyssal-tether-3d'
const OUT = SP + '/3d/m0'

const CTX = `PROJECT: ABYSSAL TETHER 3D — original grappling traversal-horror game for Meta Quest 3 (WebXR, three.js r170) + desktop.
Today's game is ONE descent (8 sections, 556 m) that becomes Chapter I of a five-chapter game (free demo + $9.99 unlock).
YOU WORK IN A SEPARATE GIT WORKTREE: ${WT} (branch at3d-m0; node_modules is symlinked; lint with
\`cd ${WT} && npx eslint public/abyssal-tether-3d/ tools/\`). NEVER edit files under /home/user/TradeCheckPro — other workflows are
editing the main tree (player physics/eye height, render, fx, hands). To keep the later merge clean, do NOT change: the rope/player
physics maths in src/sim/physics3d.js (beyond what your extension's contract strictly requires), the XR rig/eye-height code in
src/input/*, and anything in src/render/levelView.js, materials.js, renderer3d.js, fx.js, handsView.js, ropeView.js.
DESIGN SOURCES (read the relevant parts carefully; they are the spec): ${DOCS}/ENGINE_EXTENSIONS.md (ground rules §0, loop
contract §3, contract changes §4, chapter data schema §5, extensions E01–E29, events §7, verification gates §8),
${DOCS}/CHAPTERS.md, ${DOCS}/RELEASE.md (T-tasks, IAP facts), ${DOCS}/pwa/entitlement.draft.js, and the original contract
${SP}/CONTRACT3D.md. Code: ${G}/src (game.js, sim/*, data/*, input/*, ui/*, audio/*, render/*).
Ground rules you must keep: sim/ and data/ stay DOM-free and three-free (importable from Node); fixed 1/240 s step, deterministic
(no Math.random in sim — seeded rng); no per-frame allocation in hot loops; Chapter I must not regress (opt-in by data).
CURRENT HARNESS (scratchpad, hardcoded to the main tree — the Harness phase replaces it for this worktree): ${SP}/3d/level
(sim.mjs, bot.mjs, routes.mjs, verify.mjs, run.mjs), ${SP}/3d/e2e (e2e.cjs + page/), ${SP}/3d/input, ${SP}/3d/creature.
The machine's 4 CPUs are shared with Blender/Chromium jobs: run browser tests sparingly (once per agent, at the end).
COMMITS: commit your finished work in the worktree on branch at3d-m0 (git -C ${WT} add <your files>; commit) with a clear
message ending with these two lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LoR4dzKJaWKoSNtb3vkqDb
Never push. Never rewrite history. Put scratch files under ${OUT}/<your-label>/.`

const REPORT = {
  type: 'object',
  properties: {
    changes: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    gates: { type: 'string' },
    deferred: { type: 'array', items: { type: 'string' } },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['changes', 'commits', 'gates', 'deferred', 'openIssues'],
}

phase('Harness')
const harness = await agent(`${CTX}

ROLE: tools engineer — E28 (core) + E29 tooling. Promote the scratchpad harness into the repository so it runs from ANY checkout:
- ${WT}/tools/abyssal-tether-3d/verify/: sim.mjs, bot.mjs, routes.mjs, verify.mjs, run.mjs (+ README.md). Resolve the game root
  relative to the script file (import.meta.url), overridable with --root. Add the chapter/variant CLI the spec describes
  (\`--chapter ch1|all --variant normal|nightmare|abyss|all\`) — ch1 = today's level until the chapter framework lands; write
  out/verify-<chapter>.json (gitignore out/). Add an npm script "verify:at3d" to the repo package.json.
- ${WT}/tools/abyssal-tether-3d/e2e/: the browser end-to-end (e2e.cjs + page/ runner + sim shim) with relative paths and a --root
  option; it must find playwright via NODE_PATH=$(npm root -g) or a local install; document how to run it.
- Bring along the input tests (${SP}/3d/input) and creature pacing tools (${SP}/3d/creature) that are worth keeping, under
  tools/abyssal-tether-3d/tests/ with relative paths.
- E29 tooling: per-system sim timers in the Node harness (sim ms per frame by system) and a budget report.
- PROVE PARITY: run the old scratchpad harness against the main tree is NOT allowed to change it; instead run the NEW harness
  against this worktree and compare results/numbers with the scratchpad harness output logs (they test the same commit's game
  code): verify must print ALL CHECKS PASS, every route on every variant must pass, e2e must pass once.
Commit when green.`,
  { label: 'harness', phase: 'Harness', schema: REPORT })

phase('Foundations')
const laneA = async () => {
  const steps = [
    { key: 'E02', text: 'E02 Section clocks and determinism (new src/sim/clock3d.js; game.js integration; seeded rng helpers in config3d U if the spec says so).' },
    { key: 'E03', text: 'E03 Beats v2: conditions, actions, sequences, triggers and checkpoint snapshots (new src/sim/beats3d.js; game.js). Migrate Chapter I\'s existing triggers/beats to v2 without behaviour change (prove it with the harness and a deterministic before/after event trace).' },
    { key: 'E04', text: 'E04 Chapter framework (core): src/data/chapters/ (index/registry; ch1 wraps today\'s level-data-3d.js with chapter metadata per §5), per-chapter Level3D loading, seams and depthOffset (continuous depth readout), chapter swap in game.js (dispose/rebuild the views through their EXISTING public methods — if a render file needs a change, write the exact diff as a deferred item instead), harness --chapter support. Add a tiny synthetic test chapter (data only, e.g. chT-test) used ONLY by the harness to prove swaps, seams and depth offsets work; do not ship it in the registry for players.' },
  ]
  const out = []
  for (const s of steps) {
    out.push(await agent(`${CTX}

ROLE: engine programmer, lane A step ${s.key}. Implement exactly the contract in ENGINE_EXTENSIONS.md for: ${s.text}${s.key === 'E02' || s.key === 'E01' ? `\nRESUMED STEP: a previous attempt of this step was cut off by an account usage limit after real work. Its partial, uncommitted edits are in the worktree (git -C ${WT} diff: game.js, sim/config3d.js, sim/creature3d.js and some tools/ files — the other lane's partial work is mixed in, so take only what belongs to your extension). Review, keep what is correct, finish.` : ''}
Read §0, §3, §4, §5, §7, §8 and your extension's section first; also read what the previous lane-A steps committed (git -C ${WT} log -p).
Use the PROMOTED harness in ${WT}/tools/abyssal-tether-3d/ (from the Harness phase: ${harness ? JSON.stringify(harness.changes).slice(0, 1500) : 'see the repo'}).
Add unit/harness tests for your extension (the §8 gates that apply). Gates: lint, verify (ALL CHECKS PASS, all variants), routes all
variants, e2e once at the end. Commit when green. List anything in your extension that you deliberately deferred (UI/render/audio
slices belong to M1) with the exact hook you left for it.`,
      { label: `laneA:${s.key}`, phase: 'Foundations', schema: REPORT }))
  }
  return out
}
const laneB = async () => {
  const steps = [
    { key: 'E01', text: 'E01 Creature module split (src/sim/creature/*, creature3d.js becomes a re-export) with NO behaviour change: prove it with a deterministic before/after trace of the creature (positions/states/events over seeded pacing runs, e.g. the creature pacing tool) — identical output.' },
    { key: 'E05', text: 'E05 Saves v2 (new src/meta/save.js, IndexedDB with a localStorage fallback and a Node-testable in-memory backend; schema versioning and migration from today\'s Storage records; chapter progress, checkpoints, Names, records hooks). Only the Storage part of config3d.js may change.' },
    { key: 'E06', text: 'E06 Entitlement and the demo gate (new src/platform/entitlement.js from docs/abyssal-tether-3d/pwa/entitlement.draft.js: Digital Goods API on the Store build, cached result, restore = listPurchases, a dev/test mock selectable by URL parameter or setting; the gate logic that decides which chapters are playable). UI (end card, purchase button) is E27/M1: expose a clean API + events and document them; do not edit ui3d.js.' },
  ]
  const out = []
  for (const s of steps) {
    out.push(await agent(`${CTX}

ROLE: engine programmer, lane B step ${s.key}. Implement exactly the contract in ENGINE_EXTENSIONS.md for: ${s.text}${s.key === 'E02' || s.key === 'E01' ? `\nRESUMED STEP: a previous attempt of this step was cut off by an account usage limit after real work. Its partial, uncommitted edits are in the worktree (git -C ${WT} diff: game.js, sim/config3d.js, sim/creature3d.js and some tools/ files — the other lane's partial work is mixed in, so take only what belongs to your extension). Review, keep what is correct, finish.` : ''}
Read §0, §3, §4, §7, §8 and your extension's section first; another engineer (lane A) is editing game.js, level3d.js and data/
concurrently in the same worktree — avoid those files unless your contract requires a one-line hook (then keep it minimal and
re-run gates; if their half-finished work breaks a gate, wait for it by re-running later rather than editing their files).
Use the PROMOTED harness in ${WT}/tools/abyssal-tether-3d/. Add tests for your extension. Gates: lint, verify, routes, e2e once at
the end. Commit when green (only your files). List deferred UI/render/audio slices with the hook you left.`,
      { label: `laneB:${s.key}`, phase: 'Foundations', schema: REPORT }))
  }
  return out
}
const [a, b] = await parallel([laneA, laneB])
const built = [...(a || []), ...(b || [])].filter(Boolean)

phase('Review')
const FIND = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { severity: { type: 'string' }, file: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
        required: ['severity', 'file', 'problem', 'evidence', 'fix'],
      },
    },
  },
  required: ['findings'],
}
const summary = built.map((r) => r.changes.join(' | ')).join('\n').slice(0, 6000)
const LENSES = [
  'CONTRACT CONFORMANCE: compare the code on branch at3d-m0 (git -C ' + WT + ' diff b28328f) against ENGINE_EXTENSIONS.md E01–E06, E28, E29, §3, §4, §5, §7, §8: every required field, event, API, data format and gate present and behaving as specified; list gaps and deviations.',
  'DETERMINISM & CHAPTER I NON-REGRESSION: run the harness (all variants, all routes), the creature pacing tool and e2e; check that Chapter I plays exactly as before (traces, timings, creature behaviour), that sim/ and data/ import cleanly in Node without DOM/three, no Math.random in sim, seeded rngs reset on respawn/waking, saves round-trip and migrate old settings.',
  'CODE QUALITY & PERFORMANCE: per-frame allocations in hot loops, sim ms budget from the new timers, error handling (IndexedDB unavailable, Digital Goods unavailable/offline), lint, readability and consistency with the surrounding code, tests that actually test something.',
]
const reviews = (await parallel(LENSES.map((t, i) => () =>
  agent(`${CTX}

ROLE: adversarial reviewer ${i + 1}. What was built: ${summary}
Lens: ${t}
Report only real, evidenced problems with concrete fixes. Do not edit files.`,
    { label: `review:${i + 1}`, phase: 'Review', schema: FIND })))).filter(Boolean)
const findings = reviews.flatMap((r) => r.findings).filter((f) => !/^(nit|info|low)/i.test(f.severity))
log(`${findings.length} review findings`)
let fix = null
if (findings.length) {
  fix = await agent(`${CTX}

ROLE: fixer. Verify each finding (skip with a reason if it does not reproduce), fix it, keep all gates green (lint, verify all
variants, routes, e2e once), and commit.
${findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}: ${f.problem}\n   evidence: ${f.evidence}\n   fix: ${f.fix}`).join('\n')}`,
    { label: 'fix', phase: 'Review', schema: REPORT })
}
return { harness, laneA: a, laneB: b, findings, fix }
