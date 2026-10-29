// Runs the Abyssal Tether 3D Node test suites (input intent mapping, the uiio fixes,
// creature behaviour) and, with --browser, the Playwright input test.
//
//   npm run test:at3d -- [--root DIR] [--browser] [--reports]
//
// --reports also prints the creature invariants report (not pass/fail). Pacing,
// perf and allocation tools are run by hand (see README.md). Exit code 1 on a failure.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argValue, hasFlag } from '../verify/args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const root = argValue(argv, '--root', null);
const pass = root ? ['--root', root] : [];

const suites = [
  ['input: intent mapping', 'input/test-intent.mjs'],
  ['input: uiio fixes (eye height, controller loss, hold X, head-pivot turn, double Enter VR)', 'input/test-uiio-fixes.mjs'],
  ['input: WP-TOUCH (joystick vector / dead zone / curve, floating base, look + gyro scaling, hold / latch buttons, handedness mirror, 56 px layout floor, mode decision, settings sanitising, device profile, InputManager integration: stick/look/ropes/reel/jump/grip/bag/pause)', 'input/test-touch.mjs'],
  ['creature: behaviour units', 'creature/unit.mjs'],
  ['creature: head turning (the crown facing / dorsal up turn continuously on the real level: capped rates, no roll flips at corners; spine frames hold and rate-limit the roll)', 'creature/headturn.mjs'],
  ['creature: harder (loud rope, death memory, S4 modes, hunger, Abyss skitterlings, bites cost grip, reeling cost, fragile backups)', 'creature/challenge.mjs'],
  ['creature: dread (the stare on first sight and the lead: Mason only, cooldown, ends in a surge)', 'creature/dread.mjs'],
  ['creature: twist (the body axes are locked: facing, block tangents and ups while it chases a player who stays close and moves to and fro)', 'creature/twist.mjs'],
  ['creature: walls (the body lies on the walls: blocks inside masonry, height above the surface, deep penetrations)', 'creature/walls.mjs'],
  ['creature: the hunt gate (the Mason hunts only while the player is hurt: healthy = dormant on every difficulty, hurt = it arrives, the scent window, the withdraw, respawn forgets, an override and the skitterlings are never gated)', 'creature/gate.mjs'],
  ['creature: THE DRESSER (hunts only while you are whole: the gate on every difficulty + hysteresis, measure 3.0 s + saw 1.0 s never faster, never enters within 22 m, sight of the whole of you, the grapple-shot stagger + 12 s cooldown, one ring per 8 s, never your only anchor while you stand, the cut releases the rope and you fall, dressed only whole and within 1.6 m, respawn, determinism, THE CORRIDOR hp sweep with the Mason\'s gate + the regen clock, view LOD triangles / calls, ?dresser=off)', 'creature/dresser.mjs'],
  ['creature: THE HOLDFAST (the wall holds your hand: sites only on S2-S7 climb patches, never S1 / the first two, 1 hold in 4, clear of objectives; 0.5 s to let go, then locked 2.0 / 2.5 / 3.0 s and drawn to the wall; LOW = x1.3 and harder beats; tear free VR 1.2 m/s x 0.15 s / desktop Back + Jump or F let go 0.4 s = -10 % hp -0.3 grip; the rope out-pulls it after 1 s; a hook shot staggers it; crushed -15 %; never lethal alone; determinism; S4 answers; the GLB / view budget; ClimbView; ?holdfast=off)', 'creature/holdfast.mjs'],
  ['creature: annoyed by grapple shots (the aim ray through the body: x1.5 for 3 s, x6 for 0.3 s, once per 20 s; misses, variants, respawn)', 'creature/annoy.mjs'],
  ['creature: WP-SKITTER (variant config: exactly 4.5x speeds, 0.45 scale, wind-up/reach, spawn data S6-S8, safe entry distance, determinism, tagged events, damage path, Mason trigger link)', 'creature/skitter.mjs'],
  ['creature: LEVEL_FUN_PLAN P5 Masons\' rests (hidden in a rest: no attack starts, nothing hits, the stall clock frozen, the head out of the block, it listens; after the budget it catches you as today; skitterlings never bite there; the threat eases; determinism)', 'creature/nooks.mjs'],
  ['creature: LEVEL_FUN_PLAN P5 the Mason as the key (200 seeds x 3 difficulties: the S5 keystone broken from the lure niche within 40 s, never a hit; the annoyed path; a strike never hits through a solid; the keystone does not hide you; what counts as a blow; Sandbox)', 'creature/lure.mjs'],
  ['health: fall damage curve, cooldown, regen, events, difficulty scaling, determinism, Physics3D drops and hazards', 'health/unit.mjs'],
  ['objectives: LEVEL_FUN_PLAN P1 seals (plates kept out of the static level, closed at a new run, open on hooking the route ring (S6; P5: S5 keystone, S7 survive in mason.mjs), sticky across checkpoint / death / alternate respawn, Sandbox warp opens the seals above, floor + sight block + seal:land, snapshot / save round trips, determinism, skitter spawn above a closed seal, one-mesh bar view)', 'objectives/unit.mjs'],
  ['objectives: LEVEL_FUN_PLAN P3 first verbs (S1 bell, S2 counterweight haul, S4 lamps open their seals; thresholds per difficulty, bell bounce + cooldown, haul notches + slip + reel-free ring, lamp probe + lantern cost + never-block, ratchet through death / Continue / save, Sandbox warp, new run, determinism + replay with the probe, the Mason hears toll and notches, fallback probe, captions, lamp light multiplier, view parts)', 'objectives/verbs.mjs'],
  ['objectives: LEVEL_FUN_PLAN P4 machines (movers: dynamic rings, speed cap per difficulty, velocity vs motion, closed form vs clock, snapshot; a hook homing on a moving ring, the winch ring\'s housing; the rope pulling by the relative velocity; the S3 winch: notches, slip, ratchet through release / housing / save, opens the seal; no seal opens under the feet over a deep drop; the rockfall lane: telegraph, drop, damage per difficulty, death, god mode, hearing, clear time, snapshot, captions; Sandbox warp; lane probe; view parts)', 'objectives/machines.mjs'],
  ['objectives: LEVEL_FUN_PLAN P5 the Mason (the S5 keystone: a fixture solid out of the bake / hashes, its haul fallback at once, loud notches, ratchet through a release / death / Continue; the S7 survive floor: 45 / 60 / 60 s in 4 stages, paused on the landing, stages kept through a death, save, new run, Sandbox warp, never open under the feet; the escape override; rest budgets; snapshot; determinism of the S5 / S7 bot lines; captions; view parts)', 'objectives/mason.mjs'],
  ['objectives: LEVEL_FUN_PLAN P6 polish (the S6 wind squalls: knobs per difficulty, telegraph, sin² gust, push only in the air inside the box, a hanging body swung aside, comfort cap, the setting stills them, determinism, captions, the squall probe of every S6 line; the S2 collapsing span: groan + 2.25 s / 0.65 s, out of both bake hashes, the re-baked GI matches)', 'objectives/polish.mjs'],
  ['objectives: LEVEL_FUN_PLAN P2 reach and routes (per-section reach per difficulty, aimRangeAt in findTarget / shot range / miss, rope length unchanged; the fork probe: both lines of all 7 forks on every variant completable, the fast one faster, every shot within reach - 1.5 m; level data forks consistent with the bot lines; safe-line lore plaques)', 'objectives/routes.mjs'],
  ['bag: apply times, cancel on damage, caps, adrenaline timing + speed multiplier, heal API, deterministic fair spawns, pickups, lantern charge, VR gesture', 'bag/unit.mjs'],
  ['climb: WP-CLIMB (zones, VR hand-delta pull + throw, alternating hands, stretch, collision safety, grip stamina drain / slip / refill / difficulty, desktop cling + hop, rope + grip, determinism)', 'climb/unit.mjs'],
  ['audio: WP-AUDIO (impulse responses, rope/footstep/music/creature-clip modules, voice cap, reduced tier, 10 simulated minutes no growth, NaN-free)', 'audio/unit.mjs'],
  ['physics: swing bench checks (near grab, pendulum, catches, two ropes, bot routes, reel)', 'physics/swingbench.mjs', ['--check']],
  ['physics: decor collision (kit part boxes inside both kits, placement frames, safety rules, Level3D decor solids, line of sight / raycast, landing on one)', 'physics/decor.mjs'],
  ['release: save data (E05: schema 3, migration from 1 / 2, per-section splits + medals and the split clock, adapters, SaveService, Continue slot)', 'release/test-save.mjs'],
  ['release: entitlement (E06: nine store scenarios, chapter gate, release-channel mock lock)', 'release/test-entitlement.mjs'],
  ['release: XR governor (steps, hysteresis, reduced effects, no allocation)', 'release/test-governor.mjs'],
  ['render: baked GI (deterministic bake, level hash, asset size, format) + render governor hook', 'render/test-lighting.mjs'],
  ['render: surface detail (hq shader patch, KTX2 manifest, decal atlas)', 'render/test-surface.mjs'],
  ['render: scene detail (WP-SCENE-DETAIL: kit soundness, seeded placement determinism, section mixes, vignettes, anchor clearance, tier budgets <= 3 calls / 15 k stereo triangles, view re-pack + shader patches)', 'render/test-scene-detail.mjs'],
  ['render: kit levels of detail (ch1_env_kit.glb: rich / medium / far levels per part, bounds kept; LodSet: level per distance, hysteresis, missing levels, hidden beyond limits, index contents, append, throttle; cullBuried)', 'render/test-kit-lod.mjs'],
  ['render: geometry-compressed GLBs (EXT_meshopt_compression decode, custom attributes, GLTFLoader + vendored decoder, byte savings)', 'render/test-glb-meshopt.mjs'],
  ['render: forearm aim (the arm model\'s forearm swings about the wrist to the solved elbow, the hand keeps the controller orientation)', 'render/test-forearm-aim.mjs'],
  ['render: GFX-PARITY (edge bevel / puddle / probe-box shader chunks, contact shadows, dropped props physics, wear maps, gauge glass, finger curls)', 'render/test-gfx-parity.mjs'],
  ['render: WP-SHADOWS (tier table + governor / reducedEffects reduction, cone fit, cache-refresh thresholds, receiver shader chunks, static box proxy, caster layers)', 'render/test-lantern-shadow.mjs'],
  ['render: rigged Mason (mason_rig.glb structure: bones, skin, LODs, clips; clip graph phase lock; IK; head fit)', 'render/test-mason-rig.mjs'],
  ['render: creature locomotion (metachronal gait: planted feet, stride clock; body spring chain bounds)', 'render/test-creature-motion.mjs'],
  ['objectives: the 20 s trigger hint (the clock runs only while playing in a section with its seal shut, away from the trigger, without progress; progress / a death / a section change restart it; every sealed section of the real level gets its marks)', 'objectives/hint.mjs'],
  ['render: swing camera lag (opposite to the velocity, only on a tether and above 2.5 m/s, capped, ~10 cm in a headset, eases in and out, never below the floor, setting default)', 'render/test-swing-lag.mjs'],
  ['render: blood writing (opt-in setting: OFF by default + save round trip; 4-6 writings per section, lines / charset that fit the scrawl cell, each on a static wall or floor face clear of climb zones and plaques, never level decor; a merged mesh per section near the head, drips, dispose; LevelView builds it only while ON)', 'render/test-blood-writing.mjs'],
  ['render: the boards beyond the plaques (DARK_STORY_BIBLE: 40+ boards, 4-12 per section, ALL CAPS, short; each on a static wall / floor / ceiling face clear of climb zones, plaques, lamps, statues, anchors, blood and each other; never level decor, the decor count and canon plaque lines kept; markup, fit, lazy per-section atlases <= 10 MB, dispose)', 'render/test-board-writing.mjs'],
  ['comms: EXPEDITION comms core + restore (the script: 35-55 lines, 2 x 42 characters, the charset, every section + its stall hint, the killer beats; the signal arc: monotone, 5 bars -> NO SIGNAL, glitch kinds only where the arc allows, <= 3 Hz; the director: deterministic, never overlapping, never in a wind-up, priority, chatter gap, stale drops, the skip, the danger cut, the hot mic, the bare stone; the restore: deterministic, cause lines, worsening last line, sync bar; settings defaults + round trips + the VR Sound / Access pages + the menu brief; the view: one quad, <= +1 draw call, redraws per change, no per-frame allocation; the radio on mock Web Audio)', 'comms/comms.mjs'],
  ['release: platform (immersive launch, early XR request, SW policy, precache generator)', 'release/test-platform.mjs'],
  ['ux: LEVEL_FUN_PLAN P6 medals (thresholds per section and difficulty from par, next medal, rows / tally / split line from the schema-3 save; UI3D headless: split → next title card / toast / goal toast, VR Records tabs + 8 rows, menu Records button, victory splits, the six-row Comfort page; all inside the panel at >= 28 px)', 'ux/medals.mjs'],
  ['ux: WP-UX (settings persistence + sanitising, snap turn, comfort vignette rules, display helpers, caption mapping + tracker, first-run tutorial)', 'ux/unit.mjs'],
];
if (hasFlag(argv, '--reports')) suites.push(['creature: invariants report', 'creature/invariants.mjs']);
if (hasFlag(argv, '--browser')) suites.push(['input: Playwright desktop + mock WebXR', 'input/run-pw.cjs']);

let failed = 0;
for (const [name, file, extra] of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, file), ...(extra || []), ...pass], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  if (!ok) failed++;
  const tail = out.trim().split('\n').slice(-1)[0];
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${tail}`);
  if (!ok || hasFlag(argv, '-v') || file.includes('invariants')) console.log(out.replace(/^/gm, '      '));
}
console.log(failed ? `\n${failed} SUITE(S) FAILED` : '\nALL SUITES PASS');
process.exitCode = failed ? 1 : 0;
