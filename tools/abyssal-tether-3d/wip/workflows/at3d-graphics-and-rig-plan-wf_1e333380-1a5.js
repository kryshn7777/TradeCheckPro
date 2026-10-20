export const meta = {
  name: 'at3d-graphics-and-rig-plan',
  description: 'Research + judge-panel plan for a 10x graphics overhaul and a rigged, animated, terrifying creature (plans only, no repo edits)',
  phases: [
    { title: 'Research', detail: '5 parallel researchers: Quest 3 WebXR limits, three.js r170 techniques, Blender bake/rig/export pipeline, horror visual language, audit of current visuals' },
    { title: 'Plan', detail: '3 independent overhaul plans from different angles' },
    { title: 'Synthesize', detail: 'judge the plans, merge into GRAPHICS_PLAN.md and CREATURE_RIG_PLAN.md' },
    { title: 'Critique', detail: 'completeness critic, then revision' },
  ],
}

const SP = '/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad'
const REPO = '/home/user/TradeCheckPro'
const GAME = REPO + '/public/abyssal-tether-3d'
const OUT = SP + '/plans'

const CONTEXT = `PROJECT: "ABYSSAL TETHER 3D" — an original grappling traversal-horror game for Meta Quest 3 (WebXR, three.js r170
vendored at ${GAME}/vendor/three — only three.module.min.js, addons/loaders/GLTFLoader.js and addons/utils/BufferGeometryUtils.js
are vendored; the full npm package three@0.170.0 is reachable from the npm registry if you need to inspect other addons — use
"npm pack three@0.170.0" into ${OUT}/three-full and extract there). Desktop browser is a secondary target (mouse/keyboard).
The player descends a vertical abyss swinging on two hand tethers; a predator called the Mason hunts them. The Mason is ORIGINAL IP:
"architecture that learned to hunt" — a very long, many-legged creature built of masonry/iron/flesh, with a crown of sensory fronds
and listening pits, NO eyes, NO antennae, NO insect mandibles; it must not resemble any existing game's creature. Players call it
"the centipede". Sim + render code: ${GAME}/src (sim/creature3d.js = behaviour/spine path, render/creatureView.js = current view that
assembles a Blender-made KIT of rigid parts procedurally from ${GAME}/assets/models/mason_kit.glb; render/renderer3d.js,
levelView.js, materials.js, fx.js, handsView.js, ropeView.js; data/level-data-3d.js = 8 sections). Asset tooling: ${REPO}/tools/abyssal-tether-3d
(Blender headless via the bpy 5.2.2 module in ${SP}/blender-venv; see README.md there). Release docs: ${REPO}/docs/abyssal-tether-3d/.
Business: free demo + $9.99 unlock on the Meta Horizon Store; 5 chapters (~2–3 h) planned. Perf gate: Meta VRC — 72 fps on Quest 3
(stereo); current scene is ~15–40 draw calls and ~20k triangles, no shadows, no post-processing, a carried PointLight lantern plus a
small pool of environment PointLights, radial fog, MeshStandardMaterial with tileable baked PBR sets (albedo/normal/ORM).

THE OWNER'S ASK (verbatim): "I am expecting at least 10x the graphics in the final version along with our new centipede rigged and crazy scary."
Earlier they said they want it "highly polished to studio level", "like a game made on Unreal Engine". Be honest about the hardware:
Quest 3 is a mobile GPU (Adreno 740) rendering stereo at 72–90 Hz; the goal is the best-looking WebXR horror game possible on it plus a
higher desktop tier — not a promise of desktop-Unreal features on standalone Quest.

RULES: Do NOT edit any file under ${REPO} (other workflows are editing src/ right now). Write only under ${OUT}/. Do NOT run Blender
renders or Chromium (the CPUs are busy with other workflows); reading code, small node scripts and web research are fine. Web
research: load WebSearch/WebFetch via ToolSearch if you need them; cite sources (URLs) for factual claims about hardware/API limits.`

const RESEARCH = [
  { key: 'quest', prompt: `RESEARCH TOPIC: Quest 3 + Meta Quest Browser WebXR rendering — hard limits and what top-tier WebXR titles do.
Cover: GPU/CPU budgets at 72/90 Hz stereo (draw calls, triangles, fragment cost, overdraw), multiview (OVR_multiview2) support in
three.js r170 WebXRManager and its caveats, fixed foveated rendering (setFoveation), framebuffer scale, MSAA, texture compression
(KTX2/Basis → ASTC/ETC2) support in Quest Browser, memory limits, shader-compile hitches, post-processing in WebXR (what is and is
not practical: bloom/tonemap via a single fullscreen pass vs EffectComposer), real-time shadows cost, light count cost in forward
rendering, skinned-mesh cost (bone counts, GPU skinning), particle approaches, dynamic resolution. Give concrete numeric budgets
we should adopt per frame, with sources.` },
  { key: 'three', prompt: `RESEARCH TOPIC: three.js r170 technique inventory for a big visual upgrade (inspect the real r170 source via npm pack).
For each candidate technique give: what it is in r170 (class/addon/file), whether it works inside WebXR on Quest, cost class, and how
we would use it here: baked lightmaps (lightMap + uv channel) and AO maps, LightProbe / irradiance volumes, PMREM env maps for
reflections, MeshPhysicalMaterial (clearcoat for wet stone/flesh, sheen, transmission cost), onBeforeCompile shader injections
(triplanar, wetness/drips, parallax occlusion, dissolve, vertex wobble), SkinnedMesh + AnimationMixer (layering, additive clips,
crossFade, bone-texture limits) and driving bones procedurally on top of clips, morph targets, InstancedMesh/BatchedMesh, KTX2Loader +
basis transcoder files that would need vendoring (exact paths and sizes), MeshoptDecoder/DRACO, Points/sprite particles with soft
depth fade, fog volumes (layered noise planes vs raymarch), god-ray cards, decals (DecalGeometry), emissive bloom alternatives for XR,
output tone mapping (AgX vs ACES), color grading via LUT in a final pass, renderer.compileAsync precompile. Write a ranked list of the
techniques with the highest visual gain per ms on Quest.` },
  { key: 'blender', prompt: `RESEARCH TOPIC: Blender (bpy 5.2.2, headless) → glTF → three.js asset pipeline for (a) environment art and (b) a rigged,
animated creature. (a) Modular kit building, high→low poly normal/AO/curvature baking with Cycles, lightmap baking per level section
to a second UV set (UV packing, texel density, denoising, HDR→LDR/RGBM encoding for web), how to export lightmaps and load them in
three.js (uv1/lightMap, channel mapping), LODs, texture atlasing, KTX2 conversion tools available offline (toktx / basisu via npm?).
(b) Rigging a very long many-legged creature: armature layout (spine chain one bone per segment, leg chains, crown petals/jaw bones,
frond chains), rigid binding of hard parts (100% weight) + smooth skinning for flesh/membranes, max 4 influences, bone count limits,
exporting NLA actions as glTF animation clips, shape keys as morph targets, root motion vs in-place cycles, and what the glTF exporter
in Blender 5.x drops or changes (constraints, IK — must bake). Check the existing tooling in ${REPO}/tools/abyssal-tether-3d and the
creature workflow outputs under ${SP}/mason2 (final/ builds) to tailor recommendations. Give step-by-step recipes we can script.` },
  { key: 'art', prompt: `RESEARCH TOPIC: horror visual language and the specific visual elements that most raise perceived quality and fear in
VR — WITHOUT copying any existing game. Cover lighting (single motivated light, contrast, colour temperature, darkness that still
reads in a headset, flicker), atmosphere (particulates, fog layering, drips, breath), material storytelling (wet vs dry, specular
response, scale cues, wear), set dressing density, sound–visual sync, creature staging in VR (reveal choreography, silhouette, scale,
proximity, peripheral motion, freezes, false retreats, tracking the player's head, appearing above/below in a vertical space), camera-
free fear techniques (since the player controls the view), and comfort-safe intensity. Then write a concrete ART DIRECTION BIBLE for
this game: palette per section, lighting rules, material rules, VFX list, and a "Mason fear moments" list (≥ 15 specific animated
behaviours/staging beats the rig and AI should support, each tied to an animation clip or procedural layer). Keep the Mason's
identity rules (no eyes/antennae/mandibles; architecture that learned to hunt).` },
  { key: 'audit', prompt: `RESEARCH TOPIC: audit of the CURRENT visuals and creature implementation. Read ${GAME}/src/render/*.js, src/sim/creature3d.js,
src/data/level-data-3d.js, assets/textures/manifest.json, ${REPO}/tools/abyssal-tether-3d/*.py and README, and look at the preview
images in ${REPO}/tools/abyssal-tether-3d/previews/ and any screenshots under ${SP}/3d (use Read on PNG/JPG files; also look at the
newest creature renders under ${SP}/mason2/final/). Produce: what exists (lighting model, materials, textures, fog, fx, creature
assembly and animation approach, how the sim drives the view — the burst/attack payloads, spine path, states), measured or
estimated budgets used vs available, and a ruthless gap list: everything that currently reads as "prototype" rather than "studio".
Note that other workflows are editing these files right now; describe the code as it stands.` },
]

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    reportPath: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
  },
  required: ['reportPath', 'keyPoints'],
}

const PLAN_ANGLES = [
  { key: 'quest-fidelity', angle: 'QUEST-FIRST FIDELITY: maximise what the Quest 3 actually shows at a locked 72 fps — baked lighting, compressed textures, material and VFX tricks with the best visual gain per millisecond; desktop tier is a bonus.' },
  { key: 'showcase', angle: 'SHOWCASE / STORE-PAGE FIRST: maximise what sells the $9.99 unlock — trailer moments, the creature, hero vistas, a desktop "Ultra" tier (post-processing, shadows, higher res) for capture, while keeping Quest at 72 fps.' },
  { key: 'art-direction', angle: 'ART-DIRECTION FIRST: a coherent, authored look per section and a terrifying creature performance (rig + animation + AI staging + audio sync) before raw tech; tech serves the art bible.' },
]

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    planPath: { type: 'string' },
    topPackages: { type: 'array', items: { type: 'string' } },
  },
  required: ['planPath', 'topPackages'],
}

phase('Research')
const research = await parallel(RESEARCH.map((r) => () =>
  agent(`${CONTEXT}

${r.prompt}

Write your full report (markdown, with sources) to ${OUT}/research/${r.key}.md and return its path plus 8–15 key points.`,
    { label: `research:${r.key}`, phase: 'Research', schema: RESEARCH_SCHEMA })))
const reports = research.filter(Boolean)
log(`${reports.length}/${RESEARCH.length} research reports written`)
const reportList = reports.map((r) => `- ${r.reportPath}`).join('\n')

phase('Plan')
const plans = (await parallel(PLAN_ANGLES.map((p) => () =>
  agent(`${CONTEXT}

Read ALL research reports first:
${reportList}

YOUR TASK: write an independent overhaul plan from this angle — ${p.angle}
The plan must cover BOTH (1) the graphics overhaul for all 8 current sections + the planned 5-chapter game and (2) the rigged,
animated, terrifying creature (armature/skinning strategy, clip list, procedural layers on top of clips, engine integration with the
existing sim payloads, fear behaviours). Organise it as ordered WORK PACKAGES; for each: goal, concrete deliverables (files/modules),
technique, Quest cost estimate (ms, draw calls, tris, MB), desktop-tier extras, acceptance test (how a headless verifier proves it
works — screenshots, budgets, e2e), dependencies, and effort in agent-hours. Include a perf budget table and a risk list.
Write it to ${OUT}/plans/${p.key}.md; return its path and the top work packages in order.`,
    { label: `plan:${p.key}`, phase: 'Plan', schema: PLAN_SCHEMA })))).filter(Boolean)

phase('Synthesize')
const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    graphicsPlanPath: { type: 'string' },
    rigPlanPath: { type: 'string' },
    scores: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['graphicsPlanPath', 'rigPlanPath', 'scores', 'summary'],
}
const synth = await agent(`${CONTEXT}

Research reports:
${reportList}
Candidate plans:
${plans.map((p) => `- ${p.planPath}`).join('\n')}

YOUR TASK (lead technical art director): read everything. Score each plan 0–10 on (a) visual gain the owner will notice, (b) Quest
72 fps safety, (c) creature fear, (d) feasibility with our tooling (headless Blender + three.js r170, agents as the team). Then write the
FINAL plans, taking the winner as the spine and grafting the best ideas from the others:
1. ${OUT}/GRAPHICS_PLAN.md — quality targets (what "10x" concretely means here, as a before/after checklist per section), rendering
   tiers (Quest / desktop High / desktop Ultra) with exact budgets, the art-direction bible summary, and ordered work packages
   (deliverables, files touched, technique, cost, acceptance test, effort) that can each be handed to one builder agent, grouped so
   packages touching the same files are sequential and others can run in parallel.
2. ${OUT}/CREATURE_RIG_PLAN.md — the rig spec (bone list/naming, counts, which parts are rigid-bound vs skinned, influences), the
   Blender build/rig/skin/bake/export recipe as scriptable steps, the animation clip list (name, length, loop, what it shows, which
   fear beat it serves), procedural layers (spine following the sim path, leg IK onto level geometry, crown/frond aiming at sound,
   breathing/tremor), the three.js integration spec against the existing creatureView/creature3d API (what replaces what, how the sim
   states map to clips, how to keep a kit fallback), LOD/perf budget, the "fear moments" list with staging rules, audio sync hooks,
   and acceptance tests (rendered frame sequences reviewed by a critic, budgets, e2e).
Return both paths, the scores (one line per plan), and a 6–10 line summary for the owner (plain words).`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA })
if (!synth) return { error: 'synthesis failed', reports, plans }

phase('Critique')
const CRIT_SCHEMA = {
  type: 'object',
  properties: {
    gaps: { type: 'array', items: { type: 'string' } },
    wrongClaims: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['gaps', 'wrongClaims', 'verdict'],
}
const crit = await agent(`${CONTEXT}

Completeness and correctness critic. Read ${synth.graphicsPlanPath} and ${synth.rigPlanPath} (and the research reports under
${OUT}/research/ to check claims). Find: (1) GAPS — anything a studio-quality horror VR game needs that the plans skip (asset types,
sections, VFX, UI/hands visuals, loading/streaming, texture memory, shader warm-up, comfort, accessibility of visuals, testing,
store capture), modalities not covered, work packages with no acceptance test, budgets that don't add up; (2) WRONG CLAIMS — any
statement about Quest/WebXR/three.js r170/Blender behaviour that is false or unsupported (verify against the r170 source or docs).
Be specific. Verdict: one paragraph.`,
  { label: 'critic', phase: 'Critique', schema: CRIT_SCHEMA })

let revised = null
if (crit && (crit.gaps.length || crit.wrongClaims.length)) {
  revised = await agent(`${CONTEXT}

Revise the final plans in place: ${synth.graphicsPlanPath} and ${synth.rigPlanPath}.
Critic gaps:
- ${crit.gaps.join('\n- ')}
Critic wrong claims:
- ${crit.wrongClaims.join('\n- ') || '(none)'}
Fix every wrong claim (verify first; if the critic is wrong, keep the text and add a one-line note why). Close every real gap with
concrete additions (work packages, budgets, acceptance tests). Keep the documents well organised. Return a short changelog.`,
    { label: 'revise', phase: 'Critique' })
}

return { synth, critic: crit, revised, reports: reports.map((r) => r.reportPath), plans: plans.map((p) => p.planPath) }
