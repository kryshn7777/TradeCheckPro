export const meta = {
  name: 'abyssal-tether-build',
  description: 'Build all ABYSSAL TETHER modules in parallel against the contract, then integrate and smoke-test the full game',
  phases: [
    { title: 'Build', detail: '7 module builders in parallel (level, creature, audio, input, render, ui, game)' },
    { title: 'Integrate', detail: 'wire modules together, fix mismatches, end-to-end smoke test desktop + mobile' },
  ],
}

const SP = '/tmp/claude-0/-home-user-TradeCheckPro/bd43b95c-a204-5549-b531-f9f4921c321d/scratchpad'
const GAME = '/home/user/TradeCheckPro/public/abyssal-tether'

const COMMON = `
You are a senior engineer on a small team building "ABYSSAL TETHER", an original browser traversal-horror game
(vertical descent with a grappling tether, hunted by a giant original predator). The user's headline request is
"Make me with mobile game controls": the game must be first-class on phones/tablets (touch) as well as desktop.

MANDATORY READING before writing code:
- ${SP}/SPEC.md       — the product spec (condensed, authoritative)
- ${SP}/CONTRACT.md   — the architecture contract: exact class names, method signatures, field names, event names,
                         data formats, load order, lint and Node-compat rules. Implement it EXACTLY.
- ${GAME}/js/config.js and ${GAME}/js/physics.js — finished foundation files owned by the lead (do NOT edit them).

Shared creative direction (original IP — never imitate any existing game):
- Setting: "the Underspire", a colossal inverted cathedral-machine that an ancient people (the Lanternwrights) built
  DOWNWARD into the earth chasing a light at the bottom ("the Still Lamp"). Their masonry and ironwork has since been
  grown through by something living. The player is a lone descender carrying a small amber lantern and a tether.
- Predator: "the Mason" (rarely named; mostly implied) — a gigantic organism fused with the architecture: a long
  segmented column of masonry-like plates and corroded iron, hauled along walls by many hooked, girder-like limbs that
  move independently; its front end is not a face but a blunt crown of pale sensory stalks/fronds that unfurl and
  sweep, with pits that glow faintly when it listens. Feels like "the structure itself has learned to hunt."
- Palette: desaturated charcoal/slate/umber stone, oxidised metal (verdigris accent ~#3f6b63, rust ~#7a3b22),
  faint atmospheric light (cold cyan shafts ~#6fa3b5 far away), warm amber lantern (~#e0a050) on the player,
  anchors marked with readable pale phosphor (~#e8dcc0) glyphs, creature sensory glow a sickly pale bone-white/
  verdigris (~#b8f0e0). Small doses of colour, strategic contrast, fog swallowing distance.
- Section names: 1 The Threshold ("Where the line is learned"), 2 The Long Swing ("Momentum is a promise"),
  3 Broken Gallery ("Every fall is a question"), 4 The Listening Vault ("Something answered"), 5 The Gullet Stair
  ("It has your scent"), 6 The Two Descents ("Slow and certain, or quick and thin"), 7 The Hollow Nave ("Nothing to
  stand on"), 8 The Last Throat ("Down. Now."). Final sanctuary: "The Still Lamp".

Rules:
- You own ONLY the files listed for you below. Do not create/edit any other file under /home/user/TradeCheckPro.
  Put scratch/test files under ${SP}/<your-role>/ (create it).
- Other modules are being written IN PARALLEL by teammates against the same contract. Code only against the
  contract; for testing, write small stubs/mocks in your scratch dir.
- Lint must pass: cd /home/user/TradeCheckPro && npx eslint <your files>
- Browser testing: Playwright is installed globally with Chromium. Run scripts with
  NODE_PATH=$(npm root -g) node yourscript.js  and use require('playwright').chromium.launch() (browsers are
  preinstalled; never run "playwright install"). You can screenshot to PNG and view it with the Read tool.
  For a page, either load file:// URLs directly or run a static server (e.g. npx http-server <dir> -p <port> -s).
- Node testing of simulation code: global.window = global; then vm.runInThisContext(fs.readFileSync(f,'utf8')) for
  config.js, level-data.js, level.js, physics.js … in load order.
- Do not git commit. Do not touch anything outside public/abyssal-tether/ except your scratch dir.
- Quality bar: production-quality, readable, commented where non-obvious, defensive, no runaway loops, no
  per-frame garbage in hot paths. The game must feel great — movement first.
- Final answer: return the structured report (files written, summary, any contract deviations, requests for other
  modules, tests you ran and their results, known issues). Be precise and honest about what you verified.
`

const ROLES = [
  {
    key: 'level',
    label: 'build:level',
    prompt: `${COMMON}
YOUR ROLE: Level designer + level-systems engineer.
YOU OWN: ${GAME}/js/level-data.js (AT.LEVEL_DATA) and ${GAME}/js/level.js (AT.Level).

1) Implement AT.Level exactly per CONTRACT §4.2 (variant filtering via omitIn/onlyIn, ids, y-bucketed spatial
   queries with caller-owned scratch arrays, segmentBlocked with endClearance + 1u inset using AT.util.segmentRect,
   sectionIndexAt, checkpointFor for 'all'|'alternate'|'none', inGoal, reset). Fast and allocation-free in queries.

2) Design the full descent in AT.LEVEL_DATA (CONTRACT §4.1), width ≈1800u, ≈14–16k u deep, 8 sections exactly as
   SPEC §7 with the section names above, then a final safe chamber ("The Still Lamp") with a goal rect and a gate.
   Targets (normal variant): 30–50 anchors total, ~18–30 platforms/ledges (walls not counted), several large
   vertical gaps (lethal if you just fall — lethal free fall ≈430u normal), multiple optional routes, several
   recovery opportunities. Every anchor must have a purpose (tag it). Every segment has READ / CHOICE / COMMIT /
   RISK / RECOVERY / REWARD / ESCALATION (document this per section in comments at the top of each section's data).
   - S1 Tutorial: safe, teaches grapple (hint texts for mouse/keyboard AND touch variants), rope, swing, release.
     Low falls only. No hazards. Creature mode 'dormant'.
   - S2 Momentum: a distant platform reachable only by swing + well-timed release.
   - S3 Recovery: a jump that is easy to miss, with a lower anchor that saves you if you grapple fast (the SPEC §29
     design test must be naturally playable across S2–S6: swing beneath a structure, release, miss a platform,
     grapple a lower anchor, survive).
   - S4 First threat: mode 'sighting' with a trigger {name:'sighting', data:{x,y}} placed where the player looks
     out over a vast open void (the far layer); no attack.
   - S5 Pursuit: mode 'stalk'; traversal more demanding; 'rumble'/'debris'/'call' triggers for dread.
   - S6 Risk route: a clearly readable fork — a slower safe route (more anchors/platforms, longer path) and a faster
     dangerous route (fragile anchors, a crumble ledge, hazards close by, long releases) that genuinely saves time
     (prove it with simulation timings). Mode 'hunt'.
   - S7 Vertical panic: huge open nave, many anchors, minimal platforms, mode 'frenzy'.
   - S8 Escape: rapid traversal chain down to the chamber, mode 'escape'; chamber floor + goal + gate at the bottom.
   - Difficulty variants: Nightmare omits some 'recovery' anchors and adds more dangerous geometry (onlyIn hazards,
     some platforms become 'crumble'); Abyss omits most recovery anchors and is the hardest — but EVERY variant must
     remain completable.
   - Shaft walls: tall 'wall' solids on both sides whose spacing varies per section (narrow chimneys vs vast
     caverns); openings that hint at the immense structure beyond. Checkpoints stand on solid ground near each
     section top. Spawn on a ledge at the top.
   - Rich, purposeful decor (CONTRACT decor vocabulary) on far/mid/near layers: pillars, arches, chains, broken
     bridges, girders, ribs, cages, glyphs and a few rusted 'sign' plaques with short original Lanternwright text
     fragments for environmental storytelling (e.g. "WE BUILT DOWNWARD SO THE DARK WOULD HAVE A SHAPE" — write your
     own; keep them sparse and unsettling). Theme colours per section (darker and stranger as you descend).
   - Hints: short, diegetic-feeling; give 'text' (mouse/keyboard) and 'touch' variants, e.g. text "Hold LEFT CLICK on
     a marked anchor to fire the tether. Release to let go." / touch "Touch and hold a marked anchor to fire the
     tether. Lift your finger to let go." Also teach A/D swing pumping, W/S reel (touch: left thumb stick).

3) VERIFY WITH SIMULATION — this is mandatory. Write a Node harness in ${SP}/level/ that loads config.js,
   level-data.js, level.js, physics.js and uses the REAL AT.Physics/AT.GrappleSystem (with soft targeting via
   handleInput + aim at the chosen anchor) to:
   a) validate data integrity: sections contiguous and covering spawn→bottom; checkpoints rest on top of a solid
      (simulate 1 s idle at each checkpoint: player stays grounded and alive); no anchor inside a solid; anchors
      reachable (LOS from somewhere sensible); goal inside the chamber; counts per variant.
   b) prove traversability: for EACH variant (normal, nightmare, abyss), find an action sequence from each section's
      checkpoint to the next section's checkpoint area (and from S8 to the goal) that never dies. Use a search over
      macro-actions (attach anchor k [must be the soft-target result when aiming at it], pump left/right for t,
      reel in/out for t, release at t, run/jump on platforms) with simulation; record the found plan and time.
   c) prove the S3 recovery: a missed jump from the S3 launch is saved by grappling the lower recovery anchor.
   d) prove S6: safe route time vs risky route time (risky must be clearly faster, e.g. ≥25% faster).
   e) estimate a first-timer playtime (bot time × a human factor ~3–5×) ≈ 5–10 minutes total for Normal.
   Iterate on the layout until all checks pass. Keep the harness files in ${SP}/level/ and describe how to run them.
   Report the per-section, per-variant verified route timings in your final report.`,
  },
  {
    key: 'creature',
    label: 'build:creature+threat',
    prompt: `${COMMON}
YOUR ROLE: AI/behaviour + creature art engineer.
YOU OWN: ${GAME}/js/creature.js (AT.Creature) and ${GAME}/js/threat.js (AT.ThreatSystem).

Creature (CONTRACT §10, SPEC §8–11):
- Lightweight, readable state machine with ALL states: DORMANT, DISTANT, OBSERVING, APPROACHING, PURSUING, BURST,
  ATTACK, RECOVERING. Per-state timers, irregular movement (noise-modulated speed, hesitations, route changes),
  never constant speed. Stamina 0..1 drained by PURSUING/BURST (×diff.creature.staminaDrain), regenerated in
  RECOVERING/OBSERVING (×staminaRegen); stamina exhaustion forces RECOVERING (slows and withdraws upward/into the
  dark, emits creature:retreat) giving real relief; then it comes again (pressure waves: "I am safe" → "it is
  coming again").
- Section modes from section.creature (dormant / sighting / stalk / hunt / frenzy / escape) with lethal flag,
  speedMul, burstRate, spawnOffsetY. In 'dormant' it is far away and unseen (only occasional distant creature:call /
  creature:step for ambience, rare). In 'sighting' it performs a far-layer crossing when bus 'trigger:sighting'
  fires (or when entering the section if no trigger) — set this.sighting, emit creature:sighting, render via
  renderFar as a huge dim silhouette with a few sensory glints moving across a faintly backlit distance, then gone.
  Never lethal there. From 'stalk' onward it enters play from above (spawnOffsetY) and pursues.
- Movement in the world: the shaft is lined with 'wall' solids (level.querySolids). The creature crawls down the
  shaft after the player, hugging walls/structure with limbs planting on nearby solids (fused with architecture —
  it may pass through platforms, appearing to merge with masonry), and swings out toward the player when close.
  Rubber-band fairly: when far and off-screen it closes faster (so pressure persists); when near and visible its
  speed is fair and beatable. Scale by diff.creature.speed/aggression/killRadius, section speedMul/burstRate.
- ATTACK must be telegraphed: a short wind-up (≈0.35–0.6 s, shorter on harder difficulties) with creature:attack
  emitted at wind-up start (audio cue) so near misses are possible; if the player gets beyond ~1.6× killRadius by
  the end of the wind-up, the lunge misses → RECOVERING (near miss = relief). A connected lunge sets
  caughtPlayer=true (only when lethal). Grace period after respawn (≥3 s, no attack) and repositioning per
  onRespawn. onVictory(gate): charge the gate, slam it (camera-worthy event: emit creature:attack + creature:state),
  then retreat (creature:retreat). Inactive (sandbox) → never appears in play, never emits gameplay events.
- Emit creature:step for limb impacts (with intensity/distance; rate-limited), creature:call occasionally,
  creature:state on every transition, creature:burst on BURST entry. Maintain this.audio every frame.
- Simulation-test it in Node with a scripted fake player (and a stub level with two side walls): for each difficulty
  and mode, run scripted descents (e.g. steady 300 u/s, 200 u/s, stop-and-go, stalling) and print distance/state
  traces. Tune so: steady competent progress (~250+ u/s average descent in Normal hunt sections) is not caught;
  stalling for ~6–9 s in Normal (less on harder) gets you caught; distance oscillates (waves) rather than steady;
  Abyss is genuinely aggressive but survivable at ~350+ u/s. Report the numbers.
- Rendering (render(ctx,camera,opts) in world space; renderFar in screen space): procedural, original silhouette:
  a chain of ~16–24 plated segments following the head with smooth follow-the-leader, 6–10 independent jointed
  limbs (2–3 segments each) with procedural stepping (plant on nearby wall/structure points, step when overstretched,
  emit steps), a crown of 5–8 sensory stalks/fronds that sweep toward sound/the player and glow pits that brighten
  in OBSERVING/ATTACK, subtle plate highlights (oxidised metal + stone), drawn mostly as dark silhouette with rim
  light so it reads against fog. No shadowBlur per frame. Quality 'low' = fewer segments/limbs detail.
  Visibility: it should often be partly hidden in darkness — the renderer draws a darkness overlay afterwards except
  for glow elements; expose renderGlow(ctx, camera, opts) (world space) that draws only the sensory glow points so
  the renderer can draw them ABOVE darkness. (Document it — this is an addition to the contract.)
ThreatSystem (CONTRACT §9): value smoothed (fast attack ~3/s, slow release ~0.6/s), raw, components, heartRate,
beat/beatPulse. Inputs: creature distance (exp falloff, ~1400u → ~0, 150u → ~1), state modifiers (BURST/ATTACK up,
RECOVERING/DORMANT down), player falling speed vs diff.lethalImpact, a near-miss spike, small stillness term in
lethal sections. Zero creature contribution when creature inactive. Node-test it too.`,
  },
  {
    key: 'audio',
    label: 'build:audio',
    prompt: `${COMMON}
YOUR ROLE: Audio engineer (procedural Web Audio).
YOU OWN: ${GAME}/js/audio.js (AT.AudioManager) — CONTRACT §11, SPEC §12.

Build a fully procedural, original soundscape (no samples, no copied sounds):
- Graph: master gain → DynamicsCompressor (limiter-ish) → destination; buses: ambient, player, creature, psych, ui,
  each with its own gain. Volume from settings.volume (and setVolume). setPaused(true) ducks gameplay buses smoothly
  (keeps a quiet ambient bed in menus/pause).
- Ambient: looping wind (filtered noise, slow LFO on filter + gain, intensifies with player speed/falling), distant
  low rumble (sub sine + lowpassed noise), occasional structural creaks/groans (resonant band-passed noise sweeps,
  random stereo, randomised intervals), drips/settling debris ticks. Per-section variation via game.level sections
  (e.g. deeper = lower, more reverberant — implement a cheap feedback-delay "space" send instead of ConvolverNode
  impulse generation each frame; generating one small impulse once at unlock is fine).
- Player: breathing (filtered noise bursts, rate/intensity rising with threat & exertion), grapple fire (whip/zip),
  attach (metallic clank, inharmonic partials; heavier when speed high), miss (whiff + rattle), release (soft snap),
  rope tension creak (continuous, gain from player.tension while attached; jolt = loud strain on rope:jolt),
  fragile anchor stress (grinding that rises with grapple.anchorStress()), break (crack + debris), landing thump
  (∝ impact; hard landing heavier + grunt-like noise burst), wall hit, jump, falling wind roar (∝ fall speed when not
  attached), death (muffled, deep, stops gameplay layers), respawn (soft swell), victory (resolving low drone/chime
  bed — original, simple).
- Creature (spatialised by game.creature.audio: position relative to the camera/listener → StereoPanner pan, distance
  → gain + lowpass cutoff; occlusion-ish muffling when far): distant movement (grinding scrape bed whose gain
  follows audio.movement), clicks/impacts on creature:step (sharp clicks + stone knocks, spatialised), low-frequency
  resonance drone that swells with proximity, closer movement layer, creature:call (eerie original resonant cry:
  formant-filtered noise/saw glide — not any recognisable creature sound), creature:burst (surge), creature:attack
  (wind-up screech-rattle → impact), creature:retreat (receding scrape, low groan moving away), sighting (distant
  resonant tone).
- Psychological: heartbeat (two-thump, rate threat.heartRate, phase from threat.beat or your own clock; inaudible at
  low threat), breathing intensification, low rumble swelling with threat.
- Trigger hooks: trigger:rumble (big rumble), trigger:debris, trigger:call, section:enter (subtle tonal shift),
  ui:click (tiny click), game:start / game:pause / game:resume / game:menu / game:restart.
- Robustness: enabled=false (and all no-ops) if AudioContext missing; unlock() creates/resumes the context only from a
  gesture and is idempotent (iOS: also play a 1-sample silent buffer on unlock); handle 'interrupted'/'suspended'
  states; never throw; ramp all parameter changes (setTargetAtTime) to avoid clicks; limit simultaneous one-shot
  voices (voice cap + per-sound rate limiting); disconnect finished nodes; no growth over time; cheap enough for
  phones. Mute everything cleanly on stopAll().
- Test: build a test page in ${SP}/audio/ that loads config.js + audio.js, constructs AudioManager with an EventBus and
  a fake game object, then in Playwright (launch chromium with args ['--autoplay-policy=no-user-gesture-required'])
  unlock, fire every event type repeatedly, run update() for ~20 s of simulated frames across threat levels, and
  check: no exceptions, AudioContext 'running', active voice count bounded, no NaN params. Optionally render key
  sounds via OfflineAudioContext and check peak < 1.0 and no NaN. Report results.`,
  },
  {
    key: 'input',
    label: 'build:input (mobile)',
    prompt: `${COMMON}
YOUR ROLE: Input & controls engineer — owner of the user's headline feature, MOBILE GAME CONTROLS.
YOU OWN: ${GAME}/js/input.js (AT.InputManager) — CONTRACT §6 and §15.

Implement unified input producing the contract's per-frame intent from mouse, keyboard, gamepad and touch:
- Pointer Events throughout (pointerdown/move/up/cancel on the canvas, pointer capture, multi-pointer by pointerId),
  pointerType distinguishes mouse vs touch vs pen (pen behaves like touch-direct but is fine as mouse-like aim).
  Prevent default for touch to stop scrolling/zoom/callouts; suppress contextmenu; 'blur'/'visibilitychange' →
  release all held inputs (emit grappleReleased if a grapple was held) so nothing sticks.
- Keyboard: e.code based (layout-independent). A/D (and nothing else) for horizontal; W/S rope (W keydown also emits
  jumpPressed); Space = grapple (hold) with keyboard aim; Arrow keys = 8-way keyboard aim direction (persisting last
  direction; sensitivity setting scales smoothing if you rotate rather than snap — snapping 8-way is fine);
  Esc/P pause; R restart; Enter confirm/respawn; Space also confirm/respawn edge. Don't preventDefault keys while a
  form control/button is focused in menus except where needed; never block browser shortcuts (Ctrl/Cmd combos).
- Gamepad (polled in update): left stick move/reel w/ deadzone, right stick aim dir, RT/RB/X grapple hold, A jump,
  Start pause, Back restart. Handle connect/disconnect gracefully.
- Mouse: aim = screen point (mouse.x/y), LMB hold semantics. lastSource tracking ('mouse'|'touch'|'keyboard'|
  'gamepad'). The mouse aim must not flip back to mouse mode from synthetic mouse events after touches (ignore
  compat mouse events / pointerType check).
- TOUCH (make it excellent, this is what the user asked for):
  * Floating left joystick (zone, radius, deadzone, flick-to-jump) per contract, with a ghost position when idle
    (bottom-left, safe-area aware — read CSS env() insets via a computed-style probe element or accept insets from
    a setter setSafeArea({top,right,bottom,left})). Sensitivity setting shapes the response curve.
  * Direct mode: touch anywhere else = aim at that screen point + grapple hold semantics; drag updates aim; multi-
    finger chain re-target (second finger → new grapplePressed with its point; lifting the older finger must not
    release while a newer grapple finger is still down; the latest active grapple finger drives aim).
  * Stick mode: floating right aim stick with preview (≥25% → aim dir, no fire), fire at ≥80% (armed), lift releases.
  * Toggle mode: grappleTap on each new grapple touch / stick fire; lifts do nothing.
  * The joystick zone must not steal touches that begin outside it; a second finger starting inside the left zone
    while the stick is already active becomes a grapple touch.
  * getTouchOverlay() returns everything the renderer needs (CSS px), including ghost positions and armed/fireRatio.
  * touchUI flag per settings.touchControls ('auto' → (pointer: coarse) media query OR last input was touch).
  * haptic(pattern) wrapper (navigator.vibrate guarded, honours settings.haptics, rate-limited).
  * setGameplayActive(false) while menus are open: canvas input ignored for gameplay (but still tracked so a finger
    that started in a menu does not become a grapple when the menu closes).
- Settings are a live object reference (game may mutate it); read at use time.
- Edge flags are set by events and cleared in endFrame(); update(dt) builds the intent from current state (must be
  safe to call update() multiple times per frame without losing edges).
- Testing (mandatory): Playwright page in ${SP}/input/ loading config.js + input.js with a full-screen canvas. Use a
  mobile context (viewport 844x390 and 390x844, hasTouch:true, isMobile:true) and CDP Input.dispatchTouchEvent for
  real multi-touch sequences. Verify: left stick output values and flick-jump; direct grapple press/hold/drag/release;
  two-finger chain semantics (older-finger lift does not release); stick mode preview/fire/release; toggle mode taps;
  pointercancel and blur release; touch starting in the left zone while stick active → grapple; mouse aim + LMB;
  keyboard WASD/Space/arrows/Esc/R/Enter edges; endFrame edge clearing. Print a pass/fail table.`,
  },
  {
    key: 'render',
    label: 'build:render+camera+particles',
    prompt: `${COMMON}
YOUR ROLE: Rendering / technical art engineer.
YOU OWN: ${GAME}/js/camera.js (AT.Camera), ${GAME}/js/particles.js (AT.ParticleSystem), ${GAME}/js/render.js
(AT.Renderer) — CONTRACT §7, §8, §12, SPEC §6, §14–16, §21, §23.

Camera: exactly per contract (scale from min visible W/H, smaller visible height on touch, look-ahead showing more
space below, exponential follow, x clamping, smooth decaying shake × shakeScale, screen<->world, parallax transforms,
visibleRect). Keep it stable at any aspect (phone portrait 390x844 through ultrawide).

Particles: pooled, capped, cheap; ambient dust/ash/motes around the view (count rises subtly with threat; reduced
with settings.reducedEffects); bursts per contract kinds; bus listeners per contract; render 'back' (slight parallax)
and 'front' layers. No per-frame allocation.

Renderer — make the place feel colossal and readable ("understand the geometry, not the place"):
- Background: vertical gradient by section theme (lerp themes across section boundaries), deeper = darker/stranger.
- Far layer (parallax ~0.15–0.35): procedurally generated, deterministic (seeded by world chunk index) colossal
  structures — inverted towers, buttresses, arches, cables, distant faint lights/shaft-light, heavy fog; plus
  level.decor 'far' items; then call game.creature.renderFar(ctx, camera, opts) in SCREEN space (identity·dpr).
- Mid layer (~0.5–0.7): level.decor 'mid' (pillars, arches, broken bridges, chains, girders, ribs, cages, glyphs,
  signs with text, machinery, lamps…) — draw every decor type in the contract vocabulary; skip unknown types.
- Fog sheets between layers (gradients, cached where possible).
- World layer: walls (massive masonry with block seams/oxidised trims, procedurally detailed but cached per chunk if
  needed), platforms by kind (stone, metal, bridge, crumble — visibly cracked and shaking as solid.load rises,
  grate), hazards (rebar/blades/spikes — readable danger shapes, not colour-only), anchors (ring/hook/fragile with
  distinct SHAPES; fragile shakes with grapple.anchorStress(); broken anchors shown as stubs), targeting cue (when
  a grapple.target exists and not attached: subtle highlight brackets on the target + a faint dashed/arc line from the
  player to it; when attached the cue hides), rope (slack: sagging quadratic curve; taut: straight, brighter/thicker
  with player.tension; firing: extends with grapple.extend; miss: whip out and back from grapple.miss), player (small
  cloaked descender silhouette with amber lantern, leaning with velocity, legs tucked when swinging; stagger pose;
  hidden when dead), creature via game.creature.render(ctx, camera, opts), front particles.
- Near layer (~1.2): level.decor 'near' as dark foreground silhouettes (occlusion that sells scale; keep them away
  from the center of the screen / low alpha so they never hide gameplay).
- Lighting: a darkness overlay (cached radial-gradient texture, NOT per-frame gradient creation if avoidable) with
  the player's lantern as the light hole (radius ~260–340u, flickers subtly), plus faint light from section theme;
  then draw ABOVE the darkness: anchor glyph markers (always readable), the target highlight, and
  game.creature.renderGlow(ctx, camera, opts) if that method exists (sensory glow).
- Screen space: cached vignette canvas modulated by game.threat.value (and beatPulse), subtle threat distortion
  (e.g. slight chromatic offset of a cheap overlay or edge darkening pulse — skip when reducedEffects), death fade
  (game.deathFade), flash (game.flash), mouse reticle at game.input.mouse when lastSource is mouse/keyboard and
  playing (small, high-contrast ring/cross; changes shape when a target is locked), and the touch controls overlay
  from game.input.getTouchOverlay() when visible: translucent joystick ring/knob, ghost sticks when idle, aim-stick
  with fire threshold ring + armed state, small markers under grapple fingers. Touch overlay must be crisp,
  minimal, not colour-only.
- High contrast (settings.highContrast): thick white/black outlines on anchors, target brackets, rope, reticle.
- Reduced effects: fewer layers/particles, no distortion, lower DPR (game passes dpr).
- Menus: when game.state === 'menu' render the scene (attract mode) without reticle/touch overlay; player may be
  hidden if game.hidePlayer is true.
- Performance: cull by visibleRect per layer; avoid per-frame object/gradient allocation where possible (cache
  gradients/patterns per resize/section); no shadowBlur; target <8 ms/frame on desktop at 1080p in headless Chromium
  for a dense scene.
- Testing: build a harness page in ${SP}/render/ with a mock game object (a mock level implementing the Level API
  subset with walls, platforms of each kind, hazards, anchors of each kind, decor of every type, 3 sections with
  themes; a mock creature with render/renderFar/renderGlow stubs drawing a placeholder; a mock input overlay).
  Screenshot desktop 1920x1080, 1280x720, phone landscape 844x390 and portrait 390x844, high-contrast on/off, and
  view them with Read; iterate on the visuals until they look atmospheric, readable and original. Measure frame time.`,
  },
  {
    key: 'ui',
    label: 'build:ui+html+css',
    prompt: `${COMMON}
YOUR ROLE: UI/UX designer-engineer.
YOU OWN: ${GAME}/index.html, ${GAME}/style.css, ${GAME}/js/ui.js (AT.UI) — CONTRACT §1, §13, §15, SPEC §17–19, §23–25.

- index.html: proper doctype, lang, charset, mobile viewport meta exactly per contract §15, theme-color,
  apple-mobile-web-app-capable + status-bar-style, title "Abyssal Tether", meta description, an inline SVG data-URI
  favicon (original glyph), a single <canvas id="game-canvas">, the DOM overlays (HUD, hint, section title card,
  toast, pause button, screens: menu, difficulty, controls, settings, pause, death, victory, plus a portrait
  "rotate for best experience" dismissible hint and a first-time touch-controls primer), <noscript> message, and the
  classic <script> tags in the exact contract load order (relative paths: js/config.js … game.js). No external fonts
  or resources — use a system font stack with a carved/serif display feel for titles (e.g. Georgia/'Times New Roman'
  small-caps letter-spaced) and a clean UI face.
- style.css: full-viewport app (100vw, 100dvh with 100vh fallback), canvas fills it, overscroll-behavior:none,
  touch-action:none on canvas/app, user-select:none, -webkit-touch-callout:none, -webkit-tap-highlight-color:
  transparent; safe-area insets on HUD/buttons/screens; responsive from 320px-wide phones to 4K; screens are centred
  panels with dark translucent backgrounds, generous ≥44px touch targets, visible focus rings (:focus-visible), reduced
  motion support (prefers-reduced-motion), high-contrast class (body.high-contrast) boosting UI contrast; the in-game
  canvas cursor is hidden while playing with a mouse (body.playing:not(.touch-mode) #game-canvas {cursor:none}).
  Art direction: ancient/industrial/organic, desaturated with a thin amber/verdigris accent; the title treatment
  should feel carved and heavy. Subtle CSS-only animations (fade/slide), never distracting.
- ui.js (AT.UI per contract): screens & navigation (menu → Start (last difficulty), Difficulty (Normal/Nightmare/
  Abyss with blurbs from AT.DIFFICULTY and best times), Sandbox, Controls (desktop + touch + gamepad sections; show the
  relevant one first based on touch mode), Settings (volume, sensitivity, aim assist, reduced effects, reduced shake,
  high contrast, haptics, touch aim mode direct/stick, touch grapple mode hold/toggle, touch controls auto/always/never,
  fullscreen button when supported) — changes call game.applySettings(partial) immediately; pause (resume, respawn at
  checkpoint (hidden if unavailable), restart run, settings, controls, quit to menu; in sandbox also a "Warp to
  section" list calling game.warpToSection(i)); death (minimal message by cause, "Tap / press Space to continue",
  restart run, deaths count; auto-focus the primary button); victory (completion time, best time with "NEW BEST"
  marker, previous best, deaths, deepest point, difficulty, Restart, Menu). HUD: elapsed time (toggle-able), depth in
  metres, section name (fades), unobtrusive state indicator (e.g. small tether glyph lit when attached — shape-coded,
  not colour-only), checkpoint toast. Throttle HUD DOM writes (≤10 Hz for text, only when changed).
- Keyboard navigation for all menus (Tab/Shift-Tab, Enter/Space activate, Esc = back/resume, Arrow keys move focus
  in lists). Every button emits game.bus.emit('ui:click'). When a screen opens, call game.input &&
  game.input.setGameplayActive(name === null). Best times via AT.Storage.getBest(key) and AT.util.formatTime.
- Touch: setTouchMode(true) adds body.touch-mode, shows the pause button prominently and touch-specific hint text;
  first time touch mode is detected show the touch-controls primer card once (store a flag via AT.Storage).
- Testing: harness in ${SP}/ui/ with a stub game object (bus, settings, input stub, methods that log). Playwright
  screenshots of every screen at 1920x1080, 1280x720, 844x390 (touch, isMobile) and 390x844; keyboard navigation test;
  settings persistence test (reload → values kept); view screenshots with Read and iterate until it looks polished.`,
  },
  {
    key: 'game',
    label: 'build:game loop',
    prompt: `${COMMON}
YOUR ROLE: Gameplay/engine integrator — the main loop and game state machine.
YOU OWN: ${GAME}/game.js (AT.Game + bootstrap + debug API) — CONTRACT §14 (and every other section you wire).

Implement AT.Game per contract:
- boot(): load settings (AT.Storage.loadSettings()), create bus, Camera, InputManager (attach), AudioManager,
  ParticleSystem, ThreatSystem, Renderer, UI (init) — guard each optional subsystem with try/catch so a failure in
  audio/particles never prevents play; build a menu "attract mode" (level for the last difficulty variant, camera
  drifting slowly down through the shaft, player hidden via game.hidePlayer = true, creature inactive); resize
  handling (ResizeObserver or resize + orientationchange; canvas backing size = CSS size × dpr where
  dpr = min(devicePixelRatio, 2) or 1.25 with reducedEffects; plus dynamic resolution: if avg frame time > ~24 ms for
  2 s, reduce a renderScale multiplier down to 0.6, recover slowly when fast); pause on visibilitychange hidden and
  window blur while playing; requestAnimationFrame loop.
- start(diffKey): audio.unlock() (we are inside the click handler), build Level for diff.levelVariant, Player at
  spawn, GrappleSystem(level, diff, bus, settings), Physics, Creature(level, diff, bus), reset threat/particles,
  camera.snapTo, time=0, deaths=0, sectionIndex from spawn, checkpoint = spawn, hints/triggers fired-sets cleared,
  settings.lastDifficulty persisted, AT.Storage.recordRunStart, state 'playing', ui.show(null), bus game:start.
  restart() = start(same key) (instant). quitToMenu(), pause(), resume() (+ audio.setPaused, bus events, ui screens).
- loop(ts): dt = min(real dt, CONFIG.MAX_FRAME_DT); input.update(dt); global edges (pause on pausePressed, restart on
  restartPressed while playing/dead/victory/paused, respawn/confirm on death screen); while 'playing': convert
  intent.aim (screen→world via camera.screenToWorld → {mode:'point',x,y,touch}) → game.aimWorld;
  grapple.updateTarget(player, aim); grapple.handleInput(player, intent, aim, dt) once per frame; then fixed-step
  accumulator at CONFIG.PHYSICS_DT (cap CONFIG.MAX_STEPS_PER_FRAME) calling physics.step(player, grapple, intent,
  PHYSICS_DT) — jumpPressed must be delivered to exactly one step (clear after first). Interpolate player.rx/ry with
  alpha. Then creature.update(dt, player, time) (if creature.caughtPlayer && player.alive → physics.kill(player,
  grapple, 'creature'), clear flag), threat.update, particles.update, camera.follow + camera.update, section change
  detection (section:enter, creature.setSection, ui.showSectionTitle once per section per run, checkpoint per
  diff.checkpoints via level.checkpointFor + ui.showToast('Checkpoint') + bus checkpoint), hints (pick touch vs
  text by input.lastSource==='touch' / keyboard variant if present) and triggers (fire once per run when player.y
  first passes y: bus.emit('trigger', …) and bus.emit('trigger:'+name, …)), deepest tracking, goal check
  (level.inGoal → victory sequence: stop the timer, creature.onVictory(level.gate), after ~2.6 s state 'victory'
  and ui.showVictory with AT.Storage.submitTime (only if diff.recordTimes) and recordDeaths/recordDepth). Timer counts
  in 'playing' and 'dead'. Always: audio.update(dt, game), renderer.render(game, alpha), ui.updateHUD(game, dt),
  input.endFrame(). In menu: attract camera drift; in pause/victory: render frozen scene (still animate ambient).
- Death: on bus player:death → state 'dead', deaths++, flash/deathFade, camera.shake for impacts/creature,
  haptics, after ~0.45 s ui.showDeath({cause, deaths, canRespawn: diff.checkpoints !== 'none', depthMeters, time,
  message}). Respawn (confirm/respawnPressed or UI) → if checkpoints 'none' → restart(); else respawn at checkpoint:
  level.reset(), player.reset(cp), grapple.reset(), creature.onRespawn(player), threat.reset(), camera.snapTo,
  state 'playing', bus game:respawn. Death messages: short, original, by cause (impact / hazard / fall / creature).
- Feedback wiring on the bus: camera.shake on rope:jolt (small), hard player:land (medium), player:death, creature
  gate slam, trigger:rumble; game.flash on death; input.haptic on grapple:attach (8–12 ms), hard land (25 ms),
  rope:jolt (15 ms), death (pattern), creature:attack nearby (short). Respect settings (camera.shakeScale = 0.25 when
  reducedShake).
- applySettings(partial): merge into the live settings object, persist (AT.Storage.saveSettings), propagate (audio
  volume, camera.shakeScale, renderer dpr/resize on reducedEffects change, body classes high-contrast/touch-mode via
  ui), emit settings:changed. warpToSection(i) (sandbox only: teleport to checkpoint of section i). toggleFullscreen()
  (Fullscreen API with webkit fallback; try screen.orientation.lock('landscape') in a try/catch after entering).
- Touch mode: when input.lastSource changes to/from 'touch', call ui.setTouchMode and camera.resize(…, isTouch).
- Debug API per contract on window.AT.debug: { game, state() → JSON summary (state, difficulty, time, deaths,
  section, player {x,y,vx,vy,alive,grounded,grappleState,ropeLength}, creature {state,stamina,distance,x,y},
  threat, fps), teleport(x,y), setInput(partialIntent|null) (overrides the intent from InputManager while non-null,
  for automated tests), step(seconds) (advance the simulation deterministically at fixed dt even if RAF is
  throttled), attach(anchorId) (force attach), godMode(bool) (ignore deaths), warp(i) }.
- Bootstrap at the end of game.js: on DOMContentLoaded (or immediately if already loaded) create AT.game =
  new AT.Game(document.getElementById('game-canvas')) and boot(); show a readable fatal-error overlay if boot throws.
- Testing: you cannot rely on teammates' files yet (being written in parallel). Write stubs of every other module in
  ${SP}/game/stubs/ implementing the contract minimally, plus a test index page that loads the real config.js +
  physics.js + your stubs + game.js; drive it with Playwright (desktop and mobile emulation): menu → start → physics
  steps → death → respawn → restart → victory → pause/resume → resize, all without exceptions. If the real teammate
  files already exist when you finish, also try loading them and report any contract mismatches you see (but do not
  edit files you do not own).`,
  },
]

const REPORT = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    contractDeviations: { type: 'array', items: { type: 'string' } },
    requestsForOthers: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'array', items: { type: 'string' } },
    knownIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'summary', 'contractDeviations', 'requestsForOthers', 'testsRun', 'knownIssues'],
}

phase('Build')
const reports = await parallel(ROLES.map(r => () =>
  agent(r.prompt, { label: r.label, phase: 'Build', schema: REPORT })
    .then(rep => ({ role: r.key, ...(rep || { summary: 'NO REPORT (agent failed)', files: [], contractDeviations: [], requestsForOthers: [], testsRun: [], knownIssues: ['agent returned null'] }) }))
))

const digest = reports.filter(Boolean).map(r => `### ${r.role}\nFILES: ${r.files.join(', ')}\nSUMMARY: ${r.summary}\nDEVIATIONS: ${r.contractDeviations.join(' | ') || 'none'}\nREQUESTS: ${r.requestsForOthers.join(' | ') || 'none'}\nTESTS: ${r.testsRun.join(' | ')}\nKNOWN ISSUES: ${r.knownIssues.join(' | ') || 'none'}`).join('\n\n')
log('All module builders finished; starting integration.')

phase('Integrate')
const integration = await agent(`${COMMON}
YOUR ROLE: Integration lead. The seven module builders have finished. Their reports:

${digest}

All files now exist under ${GAME}/ (index.html, style.css, game.js, js/*.js). YOU MAY NOW EDIT ANY FILE under
${GAME}/ EXCEPT js/config.js and js/physics.js (if those truly need a change, describe the exact change in your report
instead). Your job: make the REAL game run end-to-end with zero console errors, honouring the contract.

1. Read every file. Cross-check every inter-module call against the contract and against the actual implementations
   (method names, argument orders, field names, event names/payloads, coordinate spaces — e.g. renderFar screen-space,
   renderGlow, aim screen→world conversion, getTouchOverlay shape, UI→game methods, level query signatures, settings
   keys). Fix mismatches at the call sites or implementations with minimal, clean edits. Address teammates'
   "requests for others" where reasonable.
2. Lint: cd /home/user/TradeCheckPro && npx eslint public/abyssal-tether/  → must be clean.
3. Node: load config, level-data, level, physics, threat, creature in Node (global.window=global) and confirm no load
   errors; run the level builder's harness in ${SP}/level/ if present and confirm it still passes.
4. Browser end-to-end with Playwright (Chromium; serve ${GAME} with npx http-server -p 8765 -s, AND also test
   file:// loading of index.html). Capture console errors/pageerrors throughout. Desktop 1280x720 and 1920x1080:
   menu renders → Start Normal → real mouse: move to an anchor near the player and hold LMB → confirm attached
   (AT.debug.state()) → swing with keyboard A/D → release → confirm momentum kept → use AT.debug.teleport/step/warp
   to visit every section, confirm section titles, checkpoints, the S4 sighting trigger, creature activation from S5
   (state changes, distance shrinking, stamina waves), death by fall impact → death screen → respawn → restart (R)
   → reach the goal (teleport near it) → victory screen with time/best/deaths → best time persisted in localStorage
   across a reload → menu best time shown. Sandbox: creature never active, impacts not lethal. Nightmare/Abyss:
   difficulty values actually applied (aim cone/range, creature speed, checkpoints none in Abyss). Pause via Esc and
   via the pause button; resize the window mid-game.
   Mobile: context with viewport 844x390 and 390x844, hasTouch, isMobile, deviceScaleFactor 3: start via tap, use
   CDP Input.dispatchTouchEvent to (a) hold the left joystick and verify moveX/reel, (b) touch-and-hold an anchor's
   screen position (compute via AT.game.camera.worldToScreen) and verify the grapple attaches, lift → release,
   (c) two-finger chain, (d) stick mode + toggle mode via game.applySettings, (e) pause button tap. Screenshot key
   moments (desktop + phone, menu/gameplay/death/victory) into ${SP}/integration/ and LOOK at them with Read; fix
   anything broken or ugly that is quick to fix (overlapping UI, invisible anchors, unreadable HUD on phone, etc.).
5. Measure FPS / frame time in a dense part of the level on desktop and with mobile emulation; fix obvious hot spots.
Report precisely: what you fixed (file + what), what you verified (with results), what remains broken or untested,
and the list of screenshots you saved.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

return { reports, integration }
