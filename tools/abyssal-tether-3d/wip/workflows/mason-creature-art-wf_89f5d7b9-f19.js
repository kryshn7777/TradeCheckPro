export const meta = {
  name: 'mason-creature-art',
  description: 'Design a far scarier, highly detailed Mason predator in Blender: 3 competing concepts, judge panel, critique/refine loop, then game-ready export',
  phases: [
    { title: 'Concepts', detail: '3 distinct horror directions, each fully built + rendered in headless Blender' },
    { title: 'Judge', detail: '3 judges (horror, craft, originality/game-readability) score all concepts from renders' },
    { title: 'Refine', detail: 'critic -> builder loop on the winning design, grafting the best ideas from runners-up' },
    { title: 'Production', detail: 'game kit with stable part names, LODs, baked normal maps; hero GLB; previews; verify in three.js' },
  ],
}

const SP = '/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad'
const PY = SP + '/blender-venv/bin/python'
const REPO = '/home/user/TradeCheckPro'
const OUT = SP + '/mason2'

const CONTEXT = `
CONTEXT — ABYSSAL TETHER, a vertical grappling horror game (2D web game shipped; now a full-3D Meta Quest 3 WebXR
version is being built). Its predator is "the Mason": a gigantic organism fused with the architecture of the
Underspire (an inverted cathedral-machine built downward into the earth by the vanished Lanternwrights). It hunts
the player down a colossal shaft, crawling along the walls. The user calls it "the centipede" and says the current
model (${REPO}/tools/abyssal-tether-3d/previews/mason_hero.png, mason_full.png — LOOK at them with the Read tool,
built by ${REPO}/tools/abyssal-tether-3d/build_mason.py) "does not look scary at all" and wants us to GO ALL OUT on
detail in Blender. Your work must make players' skin crawl in VR.

Identity to KEEP (so it stays original and on-brand): a long, many-legged body plan (yes, centipede-like length and
leg count is welcome), BUT it is not a bug: no insect head, no antennae, no mandibles/forcipules, no eyes. It is
architecture that learned to hunt — masonry, corroded iron, chains, girders — grown through with something alive.
Its front end is a crown/head structure with pale sensory fronds and glowing "listening pits", and it may open into
something horrifying (a split maw, a ring of stone-shard teeth, a throat lit from inside). Do not copy any existing
game's creature (the user's inspiration game has a giant centipede predator — ours must not look like a realistic
giant centipede; it must look like the cathedral itself crawling).

What makes it SCARY (use many of these, deliberately): wrongness of proportion (too-long, too-thin, too-many limbs;
limbs longer than the body is wide, joints bending the wrong way), sharpness (hooks, rebar spines, shards),
exposed organic tissue between masonry plates (wet sinew, tendons, veins, membranes stretched between girder legs),
things piercing flesh (chains, rebar, bolts), asymmetry and damage (missing plates, broken limbs, fused debris),
scale cues (lantern-sized pits, a dangling human-scale cage or ladder fused into it), a mouth/crown that opens,
dripping strands, subtle bioluminescence in wounds, a silhouette that reads as a predator from 50 m away, and a
low, looming camera composition. Detail level: high — bevels, chipped stone (displacement/noise), cracks, rivets,
rust scale, layered plates, tendons, small spines; but every part must still be buildable procedurally by script.

TOOLING: headless Blender 5.2.2 as a Python module: run scripts with ${PY} script.py (import bpy FIRST, then bmesh,
mathutils; numpy is available). Cycles CPU rendering works (4 cores, shared with other jobs — keep previews at
1280x720, 32–64 samples + denoise; use simple world fog sparingly, volumetrics are slow). Useful: bmesh ops, curves
with bevel + per-point radius converted to mesh (depsgraph evaluated → bpy.data.meshes.new_from_object), modifiers
applied via depsgraph (Displace with a procedural texture, Subdivision, Bevel, Solidify, Remesh, Decimate),
Principled BSDF incl. Subsurface Weight/Radius, Emission, Coat for wetness; procedural textures (Noise, Voronoi,
Musgrave-like) for render-time materials. For glTF export the materials must become plain PBR (base color /
metallic / roughness / normal / emissive images) — bake procedural materials to textures when exporting (Cycles
bake: DIFFUSE color, NORMAL from high-poly selected-to-active, ROUGHNESS, EMIT). The existing kit naming/pivot
contract (read ${REPO}/tools/abyssal-tether-3d/README.md) must be preserved in the final export.
Always LOOK at your renders with the Read tool before claiming anything; iterate until they look genuinely
frightening and well-crafted. Never edit repo files except where your step says so.`

const CONCEPTS = [
  {
    key: 'ossuary',
    brief: `DIRECTION A — "OSSUARY COLUMN": the body is a spine of stacked masonry vertebrae fused with real-looking
exposed bone and wet sinew; every block is cracked open to show tendon and marrow-dark tissue; ribs of carved stone
arc out like flying buttresses and end in hooked legs; the crown is a cathedral rose-window ring that splits into a
four-way maw lined with stone-shard teeth, pale fronds unfurling from the gaps, listening pits glowing like coals in
the throat. Chains pierce the flesh and hang. Scale cue: a rusted Lanternwright cage fused into its back.`,
  },
  {
    key: 'parasite',
    brief: `DIRECTION B — "CATHEDRAL PARASITE": thin, emaciated and far too long; legs are elongated gothic tracery and
iron girders three times longer than the body is wide, jointed backwards, with membranes of grey translucent skin
stretched between the leg pairs like torn banners; the body is a procession of broken spires and lancet arches
wrapped in tendon; the head is a hollow bell-tower crown whose louvres open to reveal a ring of glistening pale
sensory fronds and a throat full of slowly pulsing pits. Long hair-like bristles (thin curves) along every edge.`,
  },
  {
    key: 'foundry',
    brief: `DIRECTION C — "FOUNDRY LEECH": industrial body horror; the segments are riveted boiler plates and furnace
bricks split open by swollen, veined flesh glowing ember-red from inside; rebar and broken pipes erupt from it like
spines; legs are crane-jib lattice arms ending in meat-hook claws with dripping strands; the head is a riveted
iron funnel/crown that irises open into a lamprey-like ring of iron teeth around a throat of pale fronds and blue-
white listening pits. Hanging chains, a dangling ladder, soot and rust streaks.`,
  },
]

const CONCEPT_SCHEMA = {
  type: 'object',
  properties: {
    concept: { type: 'string' },
    scriptPath: { type: 'string' },
    renders: { type: 'array', items: { type: 'string' } },
    heroTriangles: { type: 'number' },
    whatMakesItScary: { type: 'string' },
    selfCritique: { type: 'string' },
  },
  required: ['concept', 'scriptPath', 'renders', 'heroTriangles', 'whatMakesItScary', 'selfCritique'],
}

const conceptPrompt = (c) => `${CONTEXT}

YOUR TASK (concept artist + Blender technical artist): build concept "${c.key}".
${c.brief}

Write a complete procedural Blender script at ${OUT}/${c.key}/build.py (create the folder) that builds the creature
in a menacing crawl/lunge pose on a dark rock wall and renders, into ${OUT}/${c.key}/:
 - hero.png: low, looming close-up of the head/crown opening toward the camera (the player's view as it reaches them)
 - full.png: the whole creature (≈24–30 m long) descending a vertical shaft wall, lit by a warm lantern from below and
   a cold shaft light from above, dark fog
 - silhouette.png: flat black creature on mid-grey background (shape readability test)
Use high detail (it's a hero/cinematic model; triangle count may be 300k–1.5M for these renders). Make the materials
rich (stone with chipped edges + cracks, rust, wet flesh with subsurface + coat, emissive pits/wounds). Iterate on the
renders at least 3 times, LOOKING at them, until it is genuinely frightening and well-crafted. Keep the script
deterministic (seeded). Report the hero triangle count, what specifically makes it scary, and an honest self-critique.`

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          concept: { type: 'string' },
          score: { type: 'number' },
          strengths: { type: 'string' },
          weaknesses: { type: 'string' },
        },
        required: ['concept', 'score', 'strengths', 'weaknesses'],
      },
    },
    winner: { type: 'string' },
    graftIdeas: { type: 'array', items: { type: 'string' } },
  },
  required: ['scores', 'winner', 'graftIdeas'],
}

const LENSES = [
  { key: 'horror', text: 'HORROR IMPACT: Which design would most frighten a player who sees it crawling toward them in VR, in a dark shaft, lit only by their lantern? Judge silhouette menace, wrongness, the crown/maw moment, and whether it reads as a predator at distance.' },
  { key: 'craft', text: 'CRAFT & DETAIL: Which is the most convincingly made — material quality (stone, rust, wet flesh), surface detail, coherent design language, no obvious procedural artefacts (floating parts, interpenetration, stretched textures, noise that looks like plastic), believable joints and leg placement on the wall.' },
  { key: 'identity', text: 'ORIGINALITY & GAME FIT: Which best keeps the identity (architecture that learned to hunt; long and many-legged but NOT a realistic centipede/insect; crown of fronds and listening pits; no eyes/antennae/mandibles), stays distinct from any existing game creature, and will translate into a real-time Quest 3 model (can be decimated/baked; distinct readable parts for procedural animation).' },
]

phase('Concepts')
const concepts = await parallel(CONCEPTS.map(c => () =>
  agent(conceptPrompt(c), { label: `concept:${c.key}`, phase: 'Concepts', schema: CONCEPT_SCHEMA })
))
const valid = concepts.filter(Boolean)
if (valid.length === 0) return { error: 'all concept agents failed' }
log(`Concepts finished: ${valid.map(v => v.concept + ' (' + Math.round(v.heroTriangles / 1000) + 'k tris)').join(', ')}`)

const conceptList = valid.map(v => `- ${v.concept}: script ${v.scriptPath}; renders ${v.renders.join(', ')}; builder says scary because: ${v.whatMakesItScary}; self-critique: ${v.selfCritique}`).join('\n')

phase('Judge')
const verdicts = await parallel(LENSES.map(l => () =>
  agent(`${CONTEXT}

You are an independent judge on a creature-design panel. LENS: ${l.text}
Concepts (open EVERY render with the Read tool and look carefully before scoring; also skim the scripts):
${conceptList}
Score each concept 0–10 under your lens, name the winner under your lens, and list concrete ideas from the other
concepts that should be grafted onto the winner. Be blunt; do not reward effort, reward the image.`,
    { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })
))
const vs = verdicts.filter(Boolean)
const totals = {}
for (const v of vs) for (const s of v.scores) totals[s.concept] = (totals[s.concept] || 0) + s.score
const ranked = Object.keys(totals).sort((a, b) => totals[b] - totals[a])
const winnerKey = ranked[0]
const winner = valid.find(v => v.concept === winnerKey) || valid[0]
const grafts = vs.flatMap(v => v.graftIdeas)
const feedback = vs.flatMap(v => v.scores.filter(s => s.concept === winner.concept).map(s => `[${s.score}/10] strengths: ${s.strengths} | weaknesses: ${s.weaknesses}`))
log(`Panel totals: ${ranked.map(k => k + '=' + totals[k]).join(', ')} -> winner ${winner.concept}`)

phase('Refine')
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    mustFix: { type: 'array', items: { type: 'string' } },
    niceToHave: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'mustFix', 'niceToHave'],
}
const REFINE_SCHEMA = {
  type: 'object',
  properties: {
    scriptPath: { type: 'string' },
    renders: { type: 'array', items: { type: 'string' } },
    changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['scriptPath', 'renders', 'changes'],
}
let current = { scriptPath: winner.scriptPath, renders: winner.renders }
let notes = `Judge feedback on the winner:\n${feedback.join('\n')}\nIdeas to graft from the other concepts:\n- ${grafts.join('\n- ')}`
const history = []
for (let round = 1; round <= 3; round++) {
  const refined = await agent(`${CONTEXT}

YOUR TASK (lead creature artist, refinement round ${round}/3): improve the winning design "${winner.concept}".
Current script: ${current.scriptPath}  (copy it to ${OUT}/final/build_r${round}.py and work on the copy)${round === 2 ? `\nRESUMED STEP: a previous attempt of exactly this step was cut off by an account usage limit after doing real work. Its partial edits are still on disk: ${OUT}/final/build_r2.py (≈200 KB, already improved — DO NOT re-copy over it; continue from it), test renders in ${OUT}/final/t_r2a … t_r2f, t_hero, t_shot and probe scripts in ${OUT}/final/. Look at the newest renders first, finish the round-1 must-fix list, then render the final r2 set into ${OUT}/final/r2/.` : ''}
Current renders: ${current.renders.join(', ')}  — look at them first.
${notes}
Make the changes that most increase fear and craft quality; graft the best ideas listed above where they fit the
design. Re-render hero.png, full.png, silhouette.png PLUS a new "approach.png" (first-person VR-like view: wide lens
~18 mm from 3 m away, the creature's crown opening toward the viewer, lantern light) into ${OUT}/final/r${round}/.
Look at every render; iterate until clearly better than the previous round. Report the changes.`,
    { label: `refine:r${round}`, phase: 'Refine', schema: REFINE_SCHEMA })
  if (!refined) break
  current = refined
  const crit = await agent(`${CONTEXT}

You are the art director's harshest critic. Open and study these renders with the Read tool:
${current.renders.join(', ')}
Rate 0–10 how frightening AND well-crafted this creature is for a VR horror game (10 = would genuinely unsettle
players and looks professionally made). List MUST-FIX problems (specific, actionable: name the part, what is wrong,
what to do) and nice-to-haves. Be specific and unsentimental.`,
    { label: `critic:r${round}`, phase: 'Refine', schema: CRITIC_SCHEMA })
  if (!crit) break
  history.push({ round, score: crit.score, mustFix: crit.mustFix })
  log(`Round ${round}: critic score ${crit.score}/10, ${crit.mustFix.length} must-fix items`)
  if (crit.score >= 8.5 && crit.mustFix.length === 0) break
  notes = `Critic score ${crit.score}/10. MUST FIX:\n- ${crit.mustFix.join('\n- ')}\nNice to have:\n- ${crit.niceToHave.join('\n- ')}`
}

phase('Production')
const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    heroTriangles: { type: 'number' },
    kitTriangles: { type: 'number' },
    kitParts: { type: 'array', items: { type: 'string' } },
    textureBytes: { type: 'number' },
    previews: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['files', 'heroTriangles', 'kitTriangles', 'kitParts', 'textureBytes', 'previews', 'verification', 'notes'],
}
const production = await agent(`${CONTEXT}

YOUR TASK (technical artist, production): turn the final creature design into shipping assets.
RIG-READY: the owner now wants the creature properly RIGGED and animated. A plan exists: /tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad/plans/CREATURE_RIG_PLAN.md — read §1 (identity contract, decisions), §2 (rig spec: bones, rigid vs skinned parts, modules and assembly, LODs, materials, maps, attributes) and §3 (Blender recipe). Build the production meshes, part pivots, UVs, baked maps and LODs so they match that plan's module/part breakdown and can be skinned to its armature by the next (rigging) step without remodelling; where the plan and the list below disagree, follow the plan and say so. The kit GLB below stays as the in-engine fallback.
Final design script: ${current.scriptPath}; final renders: ${current.renders.join(', ')} (look at them).
1. Replace ${REPO}/tools/abyssal-tether-3d/build_mason.py with a clean, commented, deterministic production builder
   derived from the final script (keep the CLI: --out, --render, --samples, --res, --seed). It must produce:
   a) public/abyssal-tether-3d/assets/models/mason_kit.glb — the GAME KIT. Keep the existing part names and pivot
      conventions from ${REPO}/tools/abyssal-tether-3d/README.md (Mason_Segment_0..2, Mason_Tail, Mason_Head,
      Mason_Frond_0..2, Mason_Pit, Mason_LimbUpper, Mason_LimbLower, Mason_Hook) and ADD any new parts the design needs
      (e.g. Mason_Jaw_0..n for maw petals with hinge pivots, Mason_Membrane, Mason_Spine) plus *_LOD1 versions
      (~35% triangles) of the big parts. Budget for the assembled in-game creature (20 segments, 10 legs, crown):
      ≤ 60k triangles at LOD0, ≤ 25k at LOD1. Detail comes from baked maps: bake each part's high-poly detail
      (displacement, cracks, rivets, sinew) to a NORMAL map on its low-poly game mesh, and bake base colour,
      roughness (+ metalness) and emission; pack into a shared atlas or a few 1024²/2048² textures; JPEG/PNG embedded
      in the GLB; total GLB ≤ 6 MB. Materials must be glTF PBR (three.js MeshStandardMaterial-compatible); keep
      emissive for pits/wounds/fronds.
   b) public/abyssal-tether-3d/assets/models/mason_hero.glb — assembled posed creature for menus/cinematics
      (instanced kit parts, LOD0), ≤ 8 MB.
   c) previews in ${REPO}/tools/abyssal-tether-3d/previews/: mason_hero.png, mason_full.png, mason_approach.png,
      mason_kit.png (all parts laid out, labelled if practical) — rendered from the PRODUCTION assets.
2. Update ${REPO}/tools/abyssal-tether-3d/README.md (parts table incl. new parts, pivots, LODs, budgets, how to run).
3. Verify: parse both GLBs (node names, triangle counts, materials, texture sizes); load mason_kit.glb in three.js
   r170 headless (Playwright + Chromium with --use-angle=swiftshader --enable-unsafe-swiftshader; three is vendored at
   ${REPO}/public/abyssal-tether-3d/vendor/three with GLTFLoader under addons/loaders; serve the folder over http and
   use an importmap) and screenshot the assembled creature under a point light — LOOK at it: baked normals must show
   the detail and nothing may be inside-out, black, or missing. Report numbers honestly.
Do not git commit. Do not edit other repo files.`,
  { label: 'production', phase: 'Production', schema: FINAL_SCHEMA })

return { winner: winner.concept, totals, refineHistory: history, production }
