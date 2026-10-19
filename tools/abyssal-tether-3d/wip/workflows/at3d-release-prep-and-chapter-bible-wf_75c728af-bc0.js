export const meta = {
  name: 'at3d-release-prep-and-chapter-bible',
  description: 'Research + scaffold the Meta Horizon Store release (WebXR PWA, VRCs, $9.99 IAP unlock) and design the 5-chapter game via competing plans, judges and synthesis',
  phases: [
    { title: 'Release research', detail: 'Meta PWA packaging, VRCs, Digital Goods IAP, offline, store assets: verified from official docs' },
    { title: 'Chapter pitches', detail: '3 designers pitch different 5-chapter plans (2-3 h total)' },
    { title: 'Judge', detail: 'fun/VR-feel, scope realism + engine feasibility, originality + horror' },
    { title: 'Bible', detail: 'synthesize the final chapter bible + engine extension contracts' },
  ],
}

const SP = '/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad'
const REPO = '/home/user/TradeCheckPro'
const G = REPO + '/public/abyssal-tether-3d'
const DOCS = REPO + '/docs/abyssal-tether-3d'

const CTX = `
CONTEXT: "ABYSSAL TETHER" — an original VR grappling traversal-horror game (descend a colossal cathedral-machine,
"the Underspire", on two hand tethers while "the Mason", a predator fused with the architecture, hunts you). A
full-3D Meta Quest 3 WebXR build exists in ${G} (three.js r170 vendored, ES modules; read ${G}/../abyssal-tether/README.md
for the 2D original's design and lore, ${SP}/CONTRACT3D.md for the 3D architecture, ${SP}/SPEC.md for the original spec,
${G}/src/data/level-data-3d.js for the current 556 m, 8-section descent with READ/CHOICE/COMMIT/RISK/RECOVERY/REWARD/
ESCALATION comments). Mechanics today: two tethers (trigger per hand), grip yank, reel, swing pump, jump, fragile anchors,
crumbling ledges, hazards, creature stalking/lunging/listening, checkpoints, difficulties Normal/Nightmare/Abyss/Sandbox.
OWNER DECISIONS: release on the Meta Horizon Store as a WebXR PWA; business model = FREE DEMO (Chapter 1) + $9.99 in-app
unlock of the full game; full release = 5 chapters, ~2–3 hours for a first-time player, studio-level polish; full 3D
movement, no comfort options; no Unity. Other agents are concurrently polishing the existing build (do not edit files
under ${G}/src or ${G}/assets). Write only where your step says.`

// ------------------------------------------------------------ Release research
phase('Release research')
const RELEASE = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    keyFacts: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
    ownerActions: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'keyFacts', 'openQuestions', 'ownerActions'],
}
const releaseP = agent(`${CTX}

ROLE: release engineer for Meta Horizon Store submission of a WebXR PWA. Use WebSearch/WebFetch (load them with
ToolSearch) and read the OFFICIAL Meta developer docs (developers.meta.com/horizon/...): PWA overview, packaging
(Bubblewrap and/or ovr-platform-util create-pwa), PWA distribution/submission, in-app purchases in WebXR PWAs (Digital
Goods API + Payment Request: item IDs, getDigitalGoodsService service URL, listPurchases/restore, consume vs durable,
what happens offline / outside the store install), VRCs (performance 72 fps, input/tracking loss, pause on focus loss /
headset removal, boundary, app must not crash on suspend/resume, store asset specs), comfort rating, age rating (IARC),
privacy policy and data-use requirements, content guidelines. Quote and cite every requirement you rely on (URL +
date). Where docs are ambiguous, say so and propose how to verify (e.g. in the developer dashboard).
Then write, in ${DOCS}/ (create it):
 - RELEASE.md: the end-to-end release plan: account/org setup, app creation, PWA packaging steps with exact commands,
   manifest requirements for WebXR PWAs (display/scope/start_url/icons/xr), service-worker/offline strategy, versioning,
   ALPHA/BETA channels for device testing, IAP design for "free demo + $9.99 full-game unlock" (durable item id,
   unlock/restore flow, offline grace, anti-tamper realism for a web app), VRC checklist mapped to concrete engineering
   tasks in our codebase, store assets list with sizes, privacy policy outline, age/comfort rating answers draft,
   timeline, and an explicit OWNER ACTIONS list (things only the human can do).
 - vrc-checklist.md: every VRC with status (unknown/likely-pass/needs-work) for our build and the task to close it.
 - pwa/ (subfolder): scaffolding the owner can run later: a twa-manifest / bubblewrap config template or the
   ovr-platform-util command template, a draft webmanifest for the 3D game (do not overwrite the game's files; put the
   proposed version here), and a service worker DRAFT (sw.draft.js) with a precache list strategy.
Do not edit anything outside ${DOCS}.`, { label: 'release-engineer', phase: 'Release research', schema: RELEASE })

// ------------------------------------------------------------ Chapter pitches
phase('Chapter pitches')
const PITCH = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    path: { type: 'string' },
    summary: { type: 'string' },
    newMechanics: { type: 'array', items: { type: 'string' } },
    engineExtensions: { type: 'array', items: { type: 'string' } },
    estMinutes: { type: 'number' },
  },
  required: ['title', 'path', 'summary', 'newMechanics', 'engineExtensions', 'estMinutes'],
}
const ANGLES = [
  { key: 'set-pieces', text: 'SET-PIECE DRIVEN: each chapter builds to an unforgettable VR moment (a collapsing bridge chase, swinging under the Mason as it crawls overhead, a flooded descent in total darkness lit by your lantern, a free-fall through the nave catching chains, the final escape up/down the throat). Escalation and spectacle, carefully paced with quiet.' },
  { key: 'systems', text: 'SYSTEMS DRIVEN: each chapter introduces ONE new traversal mechanic that deepens the tether (e.g. swinging pendulum anchors, rotating machinery anchors, updraft shafts, rope-burn/overheat, flooded sections where the tether is your only air route, dark zones navigated by sound) and remixes earlier ones; strong replay value (speedrun routes, collectibles, per-chapter medals).' },
  { key: 'narrative', text: 'NARRATIVE/HORROR DRIVEN: environmental storytelling of the Lanternwrights and what became of them, the Still Lamp\'s secret, the Mason\'s origin; dread built through the unseen, sound, false safety and relief; each chapter a distinct mood and color; ending(s) that recontextualize the descent. Minimal text, no cutscenes that take control away in VR.' },
]
const pitches = await parallel(ANGLES.map(a => () => agent(`${CTX}

ROLE: lead game designer pitching a 5-chapter plan. ANGLE: ${a.text}
Constraints: Chapter 1 = the existing descent, polished (it is the FREE DEMO — it must end on a hook that sells the
unlock). Chapters 2–5 new: ~25–40 min each for a first-timer, distinct environments (palette/fog/materials), new
set-pieces/mechanics, creature encounters that escalate (and at least one where the Mason is NOT the only danger), a
finale. Every mechanic must be implementable in our engine (fixed-step sphere-vs-AABB physics + rope constraints; we
can add kinematic moving solids/anchors, volumes (water/updraft/darkness), triggers, scripted creature paths) —
list the engine extensions precisely. Respect VR: player keeps control, no forced camera moves, readable anchors.
Original IP only. Write your pitch to ${DOCS}/pitches/${a.key}.md (create folders): logline, chapter-by-chapter
(environment, mood, mechanics, set-pieces, creature beats, collectibles, length), progression/replay, demo hook,
engine extensions, art/audio needs, risks.`, { label: `pitch:${a.key}`, phase: 'Chapter pitches', schema: PITCH })))
const validPitches = pitches.filter(Boolean)

// ------------------------------------------------------------ Judge
phase('Judge')
const JUDGE = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, score: { type: 'number' }, why: { type: 'string' } }, required: ['title', 'score', 'why'] } },
    bestIdeas: { type: 'array', items: { type: 'string' } },
  },
  required: ['scores', 'bestIdeas'],
}
const LENSES = [
  'FUN & VR FEEL: which plan would be most thrilling and replayable in a headset with two tethers, and sells a $9.99 unlock after the demo?',
  'FEASIBILITY & SCOPE: which plan can actually be built to studio quality with our engine and a procedural/Blender art pipeline, within realistic scope, with the least risky engine extensions? Penalize vague or unbuildable mechanics.',
  'HORROR & ORIGINALITY: which plan delivers the strongest dread/relief pacing and the most original world (not derivative of any existing game), with escalating creature encounters?',
]
const pitchList = validPitches.map(p => `- "${p.title}" (${p.path}): ${p.summary} | mechanics: ${p.newMechanics.join('; ')} | engine: ${p.engineExtensions.join('; ')} | ~${p.estMinutes} min`).join('\n')
const judgements = await parallel(LENSES.map((l, i) => () => agent(`${CTX}

ROLE: judge. LENS: ${l}
Read each pitch file in full:\n${pitchList}
Score each 0–10 under your lens and list the best ideas from ANY pitch that the final bible should include.`,
  { label: `judge:${i + 1}`, phase: 'Judge', schema: JUDGE })))

// ------------------------------------------------------------ Bible
phase('Bible')
const jtxt = judgements.filter(Boolean).map((j, i) => `Judge ${i + 1}: ${j.scores.map(s => s.title + '=' + s.score).join(', ')}; best ideas: ${j.bestIdeas.join(' | ')}`).join('\n')
const BIBLE = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    chapters: { type: 'array', items: { type: 'string' } },
    engineWork: { type: 'array', items: { type: 'string' } },
    artWork: { type: 'array', items: { type: 'string' } },
    audioWork: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'chapters', 'engineWork', 'artWork', 'audioWork'],
}
const bible = await agent(`${CTX}

ROLE: creative director. Synthesize the final game design from the pitches and the judges.
Pitches:\n${pitchList}\nJudges:\n${jtxt}
Write ${DOCS}/CHAPTERS.md — the production bible: logline; pillars; the 5 chapters (for each: name, environment &
palette, mood, length target, beat sheet with READ/CHOICE/COMMIT/RISK/RECOVERY/REWARD/ESCALATION per segment,
mechanics introduced/remixed, set-pieces, creature beats, hazards, collectibles/lore, checkpoint plan, music/ambience
cue list); the demo cut and its ending hook; progression & save system; replay (difficulties, medals/times,
collectibles, chapter select); the ending(s). Then ${DOCS}/ENGINE_EXTENSIONS.md: precise contracts for every engine
addition (data formats in level data, sim classes, events, render needs, verification needs for the level bot),
prioritized and sized; ${DOCS}/ART_AUDIO_PLAN.md: per-chapter Blender kit lists, materials/textures, creature variants
or poses, VFX, lighting, and the audio plan (what stays procedural, what needs designed SFX/music, sourcing rules:
original or properly licensed only). Be concrete enough that separate teams can build from it.`,
  { label: 'creative-director', phase: 'Bible', schema: BIBLE })

const release = await releaseP
return { release, pitches: validPitches.map(p => ({ title: p.title, min: p.estMinutes })), judgements: judgements.filter(Boolean).map(j => j.scores), bible }
