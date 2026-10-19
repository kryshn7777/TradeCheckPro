/* ABYSSAL TETHER — level-data.js
 * AT.LEVEL_DATA: the complete descent through the Underspire — an inverted
 * cathedral-machine the Lanternwrights built DOWNWARD toward the Still Lamp,
 * since grown through by something living. Pure data (plus a few local
 * builder helpers); AT.Level turns it into a playable, variant-filtered level.
 *
 * Conventions (CONTRACT §2/§4.1): world units, x right, y DOWN, 10u = 1 m.
 * The shaft is 1800u wide and 14 700u (1.47 km) deep.
 *
 * Layout philosophy
 *  - The shaft is a stack of storeys. Floor slabs (kind 'wall', tag 'floor')
 *    and alternating ledges force every storey to be CROSSED, not just fallen
 *    through, so each one reads as: see the far side → choose a line → commit
 *    to the swing → recover or land.
 *  - Lethal free fall ≈ 430u (Normal), ≈ 360u (Nightmare), ≈ 315u (Abyss).
 *    Every main-route drop is ≤ 300u after a sensible release, or is
 *    controlled by an anchor you lower yourself from.
 *  - Anchors placed below a ledge sit within ~45° of horizontal from its edge
 *    so they highlight before you step off (line of sight is not cut by the
 *    ledge's own corner).
 *  - Wall steps are flush with adjacent landing tops (no convex corner just
 *    above a floor — such a corner can shave a lethal impact).
 *  - Anchor tags state each anchor's purpose: tutorial | route | recovery |
 *    shortcut | risk | panic | escape.
 *
 * Variants: objects carry `omitIn` / `onlyIn` lists ('normal' | 'nightmare' |
 * 'abyss'; Sandbox uses 'normal'). Nightmare drops two of the four recovery
 * anchors, turns some ledges into crumbling stone and bolts rebar into the
 * walls of the narrow passages; Abyss keeps one fragile recovery anchor,
 * crumbles more and adds spikes. Every variant is verified completable by the
 * simulation harness (see the level agent's report).
 *
 * DOM-free: loadable from Node (`global.window = global`).
 */
(function (AT) {
  'use strict';

  const solids = [];
  const hazards = [];
  const anchors = [];
  const decor = [];

  const NM = ['nightmare', 'abyss']; // "Nightmare and harder"
  const AB = ['abyss'];

  // ---------------------------------------------------------------------------
  // Builders (corner coordinates in, CONTRACT rects out)
  // ---------------------------------------------------------------------------
  function rect(list, x0, y0, x1, y1, kind, extra) {
    const o = Object.assign({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind }, extra);
    list.push(o);
    return o;
  }
  /** Left shaft wall whose inner face is at x = edge. */
  const wallL = (y0, y1, edge, e) => rect(solids, -240, y0, edge, y1, 'wall', e);
  /** Right shaft wall whose inner face is at x = edge. */
  const wallR = (y0, y1, edge, e) => rect(solids, edge, y0, 2040, y1, 'wall', e);
  /** Structural floor slab of a storey (masonry; drawn like the walls). */
  const slab = (id, x0, x1, top, h) => rect(solids, x0, top, x1, top + (h || 80), 'wall', { id, tag: 'floor' });
  /** Structural column. */
  const column = (id, x0, x1, top, bottom) => rect(solids, x0, top, x1, bottom, 'wall', { id, tag: 'column' });
  /** Standable ledge / bridge / cradle (top surface at y = top). */
  const plat = (id, x0, x1, top, h, kind, e) => rect(solids, x0, top, x1, top + (h || 60), kind || 'stone', Object.assign({ id }, e));
  const haz = (x0, y0, x1, y1, kind, e) => rect(hazards, x0, y0, x1, y1, kind || 'rebar', e);
  const anc = (id, x, y, kind, tag, e) => {
    const o = Object.assign({ id, x, y, kind: kind || 'ring', tag: tag || 'route' }, e);
    anchors.push(o);
    return o;
  };
  /** Decor item (authored in WORLD space; AT.Level converts to layer space). */
  const dec = (type, layer, x, y, w, h, props) => {
    const o = Object.assign({ type, layer, x, y, w, h }, props);
    decor.push(o);
    return o;
  };

  // ===========================================================================
  // S1 — THE THRESHOLD (y 0–780) · "Where the line is learned"
  //  READ       Spawn on the threshold ledge; one pale ring hangs above the gap,
  //             the sill waits beyond it. Nothing moves.
  //  CHOICE     Fire now, or walk to the lip first for a longer, faster arc.
  //  COMMIT     The first swing: hold, pump with A/D, let go over the sill.
  //  RISK       None that kills: the pocket floor catches an early release
  //             (≤300u), and the well below the sill is a 300u drop at most.
  //  RECOVERY   From the pocket floor, hop back up to the sill (60u step).
  //  REWARD     The well: a second ring lets you lower yourself (S) into the
  //             dark — the first time the descent feels like a descent.
  //  ESCALATION The well opens under the Threshold's own floor: S2's hall.
  // ===========================================================================
  wallL(-1400, 780, 240);
  wallR(-1400, 960, 1560);
  plat('s1-ledge', 240, 600, 360, 360); // spawn ledge (solid down to the floor line)
  slab('s1-pocket', 600, 960, 660, 60); // safety floor under the first gap
  plat('s1-sill', 960, 1260, 600, 120);
  anc('t1', 760, 170, 'ring', 'tutorial'); // first anchor: ~180u above and right of the spawn
  anc('t2', 1420, 540, 'ring', 'tutorial'); // the well: lower yourself with S

  // ===========================================================================
  // S2 — THE LONG SWING (y 780–2950) · "Momentum is a promise"
  //  READ       From the landing under the Threshold you see a hook bolted to
  //             its underside and, far across the hall, the far pier.
  //  CHOICE     Run-up or standing start; how long to pump; when to let go.
  //  COMMIT     Run, fire at the hook, swing the long arc and release on the
  //             upswing — the pier is only reachable with that momentum.
  //  RISK       A short release drops ~700u onto the hall floor (lethal).
  //  RECOVERY   A recovery ring hangs below the gap (Normal/Nightmare); then
  //             walk the hall floor to the opening.
  //  REWARD     From the pier, a ring beside it lowers you through the floor
  //             opening into the lower hall.
  //  ESCALATION Lower hall: one more long pendulum (under the floor slab) to
  //             the pier on the far side, then lower yourself to S3. The
  //             floor is gone below you (Nightmare: the safety bridge
  //             crumbles; Abyss: it is gone and spikes wait).
  // ===========================================================================
  wallL(780, 2950, 120);
  wallR(960, 1850, 1180);
  wallR(1850, 2950, 1680);
  plat('s2-landing', 1180, 1560, 900, 60); // S2 checkpoint (bottom of the S1 well)
  anc('s2-hook', 900, 744, 'hook', 'route'); // under the Threshold floor: the long swing
  plat('s2-far', 120, 420, 1150, 80); // the far pier
  anc('s2-lower', 560, 1230, 'ring', 'route'); // lowers you through the opening
  anc('s2-catch', 820, 1460, 'ring', 'recovery', { omitIn: AB }); // saves a short release
  slab('s2-floor-a', 640, 1680, 1850, 80);
  plat('s2-low', 120, 600, 2100, 80);
  anc('s2-b1', 880, 1960, 'ring', 'route'); // pendulum under the slab
  plat('s2-span', 760, 1040, 2420, 30, 'bridge', { omitIn: NM }); // safety island
  plat('s2-span-nm', 760, 1040, 2420, 30, 'crumble', { onlyIn: ['nightmare'] });
  haz(760, 2680, 1040, 2700, 'spikes', { onlyIn: AB });
  anc('s2-b2', 1180, 2080, 'ring', 'shortcut'); // second pendulum for a faster chain
  plat('s2-pier', 1350, 1680, 2250, 60);
  anc('s2-x', 1200, 2330, 'ring', 'route'); // lowers you to S3
  slab('s2-floor-b', 120, 1150, 2700, 80);

  // ===========================================================================
  // S3 — BROKEN GALLERY (y 2950–4250) · "Every fall is a question"
  //  READ       A gallery of broken spans crosses the hall; rings hang from
  //             the slab above each gap. The last span is narrow, against the
  //             far wall — and below it, a lone ring in the dark.
  //  CHOICE     Take the spans one by one, or chain the rings and skip one.
  //  COMMIT     Swing beneath the slab and release toward the narrow last span
  //             (the SPEC §29 design test lives here).
  //  RISK       The last span is easy to overshoot or undershoot; missing it is
  //             a long, lethal fall onto the gallery floor.
  //  RECOVERY   Fire at the lower ring as you fall (Normal: solid ring;
  //             Nightmare/Abyss: a fragile ring — swing off it quickly).
  //  REWARD     Lower yourself onto the shelf beneath the gallery; a single
  //             pendulum carries you out over the void to S4's landing.
  //  ESCALATION Abyss: the first span crumbles under you.
  // ===========================================================================
  wallL(2950, 4700, 120);
  wallR(2950, 4700, 1680);
  plat('s3-landing', 1150, 1680, 3040, 100); // S3 checkpoint
  anc('s3-a1', 1020, 2810, 'ring', 'route');
  plat('s3-span1', 560, 850, 3150, 40, 'bridge', { omitIn: AB });
  plat('s3-span1-ab', 560, 850, 3150, 40, 'crumble', { onlyIn: AB });
  anc('s3-a2', 420, 2900, 'ring', 'route'); // the launch: swing beneath the slab
  plat('s3-span2', 120, 280, 3230, 40, 'bridge'); // narrow — easy to miss
  anc('s3-save', 640, 3520, 'ring', 'recovery', { omitIn: NM });
  anc('s3-save-nm', 640, 3520, 'fragile', 'recovery', { onlyIn: NM });
  anc('s3-lower', 400, 3290, 'ring', 'route');
  slab('s3-floor', 480, 1680, 3750, 80);
  plat('s3-shelf', 120, 480, 4000, 80);
  anc('s3-b1', 760, 3880, 'ring', 'route');
  anc('s3-b2', 1150, 3880, 'ring', 'shortcut');

  // ===========================================================================
  // S4 — THE LISTENING VAULT (y 4250–6050) · "Something answered"
  //  READ       The left wall falls away into the Vault: an immense void, far
  //             lit by cold shafts. A metal balcony juts out over it.
  //  CHOICE     Linger on the balcony and look — or keep moving.
  //  COMMIT     Swing out to the balcony (the sighting fires there: something
  //             vast crosses the far dark — no attack), then a zig-zag of
  //             hops: hanging cradle → right shelf → plinth.
  //  RISK       Falls here end on the Vault floor, far below.
  //  RECOVERY   A ring under the shelf hop (Normal only).
  //  REWARD     The plinth, and a ring that lowers you into the Gullet.
  //  ESCALATION Abyss: the cradle's chains give way under your weight.
  // ===========================================================================
  wallL(4700, 6100, 0); // the Vault window (the left wall recedes to the level edge)
  wallR(4700, 6100, 1680);
  plat('s4-landing', 1250, 1680, 4300, 120); // S4 checkpoint
  anc('s4-a1', 1000, 4190, 'ring', 'route');
  plat('s4-balcony', 300, 640, 4550, 40, 'metal'); // the listening balcony
  anc('s4-a2', 880, 4470, 'ring', 'route');
  plat('s4-cradle', 900, 1100, 4870, 40, 'metal', { omitIn: AB }); // hanging lift cradle
  plat('s4-cradle-ab', 900, 1100, 4870, 40, 'crumble', { onlyIn: AB });
  anc('s4-a3', 1280, 4790, 'ring', 'route');
  plat('s4-shelf', 1350, 1680, 5170, 100);
  anc('s4-a4', 1040, 5250, 'ring', 'route');
  anc('s4-catch', 1300, 5550, 'ring', 'recovery', { omitIn: NM });
  plat('s4-plinth', 420, 700, 5470, 60);
  anc('s4-a5', 770, 5430, 'ring', 'route');

  // ===========================================================================
  // S5 — THE GULLET STAIR (y 6050–8050) · "It has your scent"
  //  READ       The shaft pinches into a 940u throat. Short steps alternate
  //             left/right, 450u apart; hooks hang between them.
  //  CHOICE     Lower carefully on each hook, or swing-release straight onto
  //             the next step (faster, harder).
  //  COMMIT     Every step is a drop you cannot simply take.
  //  RISK       The predator now hunts from above. Nightmare: rebar lines the
  //             walls where a wide swing would touch them, and the middle step
  //             crumbles.
  //  RECOVERY   One recovery ring near the bottom (Normal only).
  //  REWARD     The fork platform of S6 below the last hook.
  //  ESCALATION Faster, tighter swings than anything above.
  // ===========================================================================
  wallL(6100, 8050, 430);
  wallR(6100, 8050, 1370);
  plat('s5-landing', 430, 800, 6100, 100); // S5 checkpoint (flush with the Vault floor)
  anc('s5-h1', 1020, 6230, 'hook', 'route');
  plat('s5-step1', 1110, 1370, 6550, 70);
  anc('s5-h2', 800, 6700, 'hook', 'route');
  plat('s5-step2', 430, 690, 7000, 70, 'stone', { omitIn: NM });
  plat('s5-step2-nm', 430, 690, 7000, 70, 'crumble', { onlyIn: NM });
  haz(1356, 6700, 1370, 7300, 'rebar', { onlyIn: NM });
  anc('s5-h3', 1020, 7130, 'hook', 'route');
  plat('s5-step3', 1110, 1370, 7450, 70);
  anc('s5-catch', 700, 7600, 'ring', 'recovery', { omitIn: NM });
  haz(430, 7500, 444, 8000, 'rebar', { onlyIn: NM });
  anc('s5-h4', 800, 7600, 'hook', 'route');

  // ===========================================================================
  // S6 — THE TWO DESCENTS (y 8050–10250) · "Slow and certain, or quick and thin"
  //  READ       A fork platform tops a dividing column. Left: a stair of solid
  //             shelves with sound rings. Right: an open drop with frayed
  //             (fragile) rings, a crumbling ledge and rebar on the wall.
  //  CHOICE     The whole section IS the choice; plaques name both ways.
  //  COMMIT     Left: four switchbacks, each lowered on a ring (slow, safe).
  //             Right: commit to fragile rings that snap after a moment's load
  //             (1.5 / 1.05 / 0.8 s), touch the crumbling ledge and go.
  //  RISK       Right: snapped rings, the ledge giving way, rebar.
  //  RECOVERY   Left: every shelf is a rest stop. Right: none.
  //  REWARD     The right column is verified ≥25% faster — with the predator
  //             hunting, time is the reward.
  //  ESCALATION Nightmare/Abyss add rebar under the right column's ledge.
  // ===========================================================================
  wallL(8050, 10300, 150);
  wallR(8050, 10300, 1650);
  plat('s6-fork', 700, 1100, 8100, 100); // S6 checkpoint
  column('s6-divider', 830, 970, 8200, 9900);
  // Safe column (left): forced switchbacks — each shelf covers the gap of the one above.
  anc('s6-sa1', 520, 8220, 'ring', 'route');
  plat('s6-safe1', 360, 830, 8500, 60);
  anc('s6-sa2', 250, 8450, 'ring', 'route');
  plat('s6-safe2', 150, 620, 8950, 60);
  anc('s6-sa3', 730, 8900, 'ring', 'route');
  plat('s6-safe3', 360, 830, 9400, 60);
  anc('s6-sa4', 250, 9350, 'ring', 'route');
  plat('s6-safe4', 150, 520, 9850, 60);
  anc('s6-sa5', 640, 9800, 'ring', 'route');
  // Risky column (right): fragile anchors, a crumbling ledge, rebar on the wall.
  anc('s6-ra1', 1300, 8230, 'fragile', 'risk');
  anc('s6-ra2', 1450, 8800, 'fragile', 'risk');
  plat('s6-ledge', 1150, 1450, 9220, 40, 'crumble');
  haz(1636, 9000, 1650, 9400, 'rebar');
  haz(1000, 9300, 1080, 9316, 'rebar', { onlyIn: NM });
  anc('s6-ra3', 1350, 9460, 'fragile', 'risk');
  anc('s6-ra4', 1200, 9900, 'hook', 'risk');

  // ===========================================================================
  // S7 — THE HOLLOW NAVE (y 10250–12550) · "Nothing to stand on"
  //  READ       The walls fall back 1680u apart: a nave of ribs and dark.
  //             Rings hang in a long zig-zag; one metal perch halfway.
  //  CHOICE     Chain ring to ring without touching down, or bail to the perch.
  //  COMMIT     Each release is a leap of faith toward the next ring.
  //  RISK       The predator is in frenzy; the floor is 2 km of nothing.
  //  RECOVERY   Missed rings are usually caught by the next ones down the
  //             zig-zag (the rope forgives; the creature does not).
  //  REWARD     The throat's landing on the far side.
  //  ESCALATION Vertical panic: no platforms, constant bursts.
  // ===========================================================================
  wallL(10300, 12600, 60);
  wallR(10300, 12600, 1740);
  plat('s7-landing', 600, 1200, 10300, 100); // S7 checkpoint (both S6 columns end here)
  anc('s7-n1', 380, 10440, 'ring', 'panic');
  anc('s7-n2', 820, 10780, 'ring', 'panic');
  anc('s7-n3', 1230, 10960, 'ring', 'panic');
  anc('s7-n4', 1560, 11230, 'ring', 'panic');
  anc('s7-n5', 1180, 11480, 'ring', 'panic');
  anc('s7-n6', 760, 11660, 'ring', 'panic');
  plat('s7-perch', 300, 520, 11880, 40, 'metal');
  anc('s7-n7', 750, 12060, 'ring', 'panic');
  anc('s7-n8', 1000, 12250, 'ring', 'panic');

  // ===========================================================================
  // S8 — THE LAST THROAT (y 12550–14700) · "Down. Now."
  //  READ       The walls converge in steps; warm light leaks from below.
  //  CHOICE     None worth taking: the chain is short and the creature close.
  //  COMMIT     Five escape rings down the throat, then the floor and a sprint
  //             left through the grate into the Still Lamp's chamber.
  //  RISK       Escape mode: relentless pursuit with bursts.
  //  RECOVERY   Wall steps at the narrowing give a place to stand.
  //  REWARD     The chamber (goal) — the grate slams behind you.
  //  ESCALATION The end.
  // ===========================================================================
  wallL(12600, 13300, 200);
  wallR(12600, 13300, 1600);
  wallL(13300, 14000, 400);
  wallR(13300, 14000, 1400);
  wallL(14000, 14400, 560);
  wallR(14000, 14700, 1240);
  wallL(14400, 14700, 100); // back wall of the Still Lamp chamber
  plat('s8-landing', 1100, 1600, 12600, 100); // S8 checkpoint (flush with the wall step)
  anc('s8-e1', 850, 12750, 'ring', 'escape');
  anc('s8-e2', 450, 13150, 'ring', 'escape');
  anc('s8-e3', 1050, 13400, 'ring', 'escape');
  anc('s8-e4', 650, 13750, 'ring', 'escape');
  anc('s8-e5', 1000, 14100, 'ring', 'escape');
  rect(solids, -240, 14700, 2040, 15100, 'stone', { id: 'chamber-floor' });

  // ===========================================================================
  // Decor — far (parallax ~0.25), mid (~0.6), near (~1.2). Authored in world
  // space (where it appears when the camera is centred on it).
  // ===========================================================================
  const SIGN = {
    s1: 'HERE THE DESCENT BEGINS. TRUST THE RING, NOT THE FLOOR.',
    s2: 'THE LAMP DOES NOT RISE TO MEET US. WE GO DOWN TO IT.',
    s3: 'NINTH GALLERY — CLOSED. THE STONE HAS BEEN LISTENING.',
    s4: 'DO NOT ANSWER WHAT KNOCKS FROM INSIDE THE WALL.',
    s5: 'THE MASONS WENT DOWN TO MEND THE DEEP COURSE. THE WALL MENDED ITSELF.',
    s6l: 'THE LONG STAIR — FOR THE PATIENT',
    s6r: 'THE THROAT — FOR THE LATE',
    s7: 'IT WEARS OUR WORK.',
    s8: 'BELOW THIS MARK NO LAMPS. ONLY THE STILL ONE.',
  };

  // S1 — the Threshold: an arch over the start, dead work lights, first plaque.
  dec('cliff', 'far', -500, -900, 900, 2600);
  dec('tower', 'far', 1150, -1300, 520, 2800);
  dec('shaft-light', 'far', 650, -1400, 260, 2600, { color: '#6fa3b5' });
  dec('arch', 'mid', 260, -320, 1280, 420);
  dec('sign', 'mid', 330, 215, 300, 56, { text: SIGN.s1 });
  dec('lamp', 'mid', 560, 280, 28, 56, { flicker: 0.35 });
  dec('chain', 'mid', 1080, -260, 18, 560, { len: 560 });
  dec('chain', 'mid', 1470, -120, 18, 420, { len: 420 });
  dec('glyphs', 'mid', 990, 470, 230, 90);
  dec('girder', 'near', -140, 120, 420, 56);
  dec('chain', 'near', 1650, -200, 24, 760, { len: 760 });

  // S2 — the Long Swing: a colossal statue fragment in the far dark, cables
  // across the hall, the broken bridge the hook once held.
  dec('tower', 'far', 220, 1100, 640, 2800);
  dec('statue', 'far', 1050, 1900, 760, 1700);
  dec('shaft-light', 'far', 1250, 700, 300, 3000, { color: '#6fa3b5' });
  dec('broken-bridge', 'mid', 620, 1060, 520, 110);
  dec('cables', 'mid', 120, 980, 1560, 220);
  dec('sign', 'mid', 140, 1040, 270, 56, { text: SIGN.s2 });
  dec('arch', 'mid', 180, 1620, 940, 400);
  dec('pillar', 'mid', 700, 1930, 120, 820);
  dec('chain', 'mid', 1220, 1950, 18, 420, { len: 420 });
  dec('glyphs', 'mid', 1400, 2120, 220, 80);
  dec('lamp', 'mid', 1620, 2170, 28, 56, { flicker: 0.6 });
  dec('girder', 'mid', 860, 2560, 640, 50);
  dec('pipe', 'near', -80, 1350, 130, 950);
  dec('girder', 'near', 1580, 2300, 320, 56);

  // S3 — the Broken Gallery: a far colonnade, snapped column stubs under the
  // spans, organic ribs pushing through, a hanging cage.
  dec('arch', 'far', -100, 2950, 2000, 640);
  dec('cliff', 'far', 1450, 3500, 760, 2100);
  dec('pillar', 'mid', 610, 3190, 80, 540);
  dec('pillar', 'mid', 780, 3190, 60, 300);
  dec('broken-bridge', 'mid', 1180, 3260, 460, 100);
  dec('ribs', 'mid', 1080, 3330, 520, 420);
  dec('sign', 'mid', 1190, 2930, 400, 56, { text: SIGN.s3 });
  dec('glyphs', 'mid', 260, 3580, 320, 100);
  dec('chain', 'mid', 940, 3200, 18, 260, { len: 260 });
  dec('cage', 'mid', 880, 3460, 120, 180);
  dec('chain', 'near', 70, 3050, 24, 900, { len: 900 });
  dec('broken-bridge', 'near', 1560, 3920, 420, 80);

  // S4 — the Listening Vault: the window onto the Vault, cold light, a colossal
  // figure fragment and a hanging spire inside it; chains carry the cradle.
  dec('shaft-light', 'far', -260, 4500, 520, 2200, { color: '#b8f0e0' });
  dec('tower', 'far', -380, 4900, 760, 3000);
  dec('statue', 'far', 60, 5450, 900, 1500);
  dec('cliff', 'far', 1300, 4800, 900, 2400);
  dec('arch', 'mid', -120, 4640, 720, 1500);
  dec('ribs', 'mid', -40, 5200, 420, 720);
  dec('sign', 'mid', 320, 4470, 300, 56, { text: SIGN.s4 });
  dec('glyphs', 'mid', 1390, 4190, 220, 80);
  dec('chain', 'mid', 930, 4360, 18, 510, { len: 510 });
  dec('chain', 'mid', 1060, 4360, 18, 510, { len: 510 });
  dec('lamp', 'mid', 1520, 5100, 28, 56, { flicker: 0.7 });
  dec('machinery', 'mid', 1380, 5600, 300, 380);
  dec('cables', 'near', -120, 5000, 420, 320);

  // S5 — the Gullet Stair: rust-lit throat, pipes and organic ribs.
  dec('shaft-light', 'far', 760, 6000, 220, 2200, { color: '#7a3b22' });
  dec('machinery', 'far', 600, 6900, 620, 900);
  dec('ribs', 'mid', 430, 6380, 940, 300);
  dec('ribs', 'mid', 430, 7280, 940, 300);
  dec('pipe', 'mid', 450, 6200, 60, 1800);
  dec('pipe', 'mid', 1290, 6200, 50, 1800);
  dec('sign', 'mid', 460, 5990, 360, 56, { text: SIGN.s5 });
  dec('glyphs', 'mid', 1140, 6440, 200, 80);
  dec('cage', 'mid', 880, 7720, 100, 160);
  dec('pipe', 'near', 360, 6500, 90, 1400);
  dec('girder', 'near', 1300, 7200, 320, 56);

  // S6 — the Two Descents: plaques at the fork, glyph column, frayed chains.
  dec('tower', 'far', -40, 8300, 520, 2700);
  dec('tower', 'far', 1380, 8600, 520, 2700);
  dec('shaft-light', 'far', 820, 8100, 200, 2300, { color: '#5a7d86' });
  dec('sign', 'mid', 600, 8020, 200, 50, { text: SIGN.s6l });
  dec('sign', 'mid', 1000, 8020, 200, 50, { text: SIGN.s6r });
  dec('glyphs', 'mid', 845, 8600, 110, 320);
  dec('glyphs', 'mid', 845, 9300, 110, 320);
  dec('lamp', 'mid', 300, 8880, 28, 56, { flicker: 0.25 });
  dec('chain', 'mid', 1500, 8250, 18, 640, { len: 640 });
  dec('cables', 'mid', 970, 8780, 680, 160);
  dec('machinery', 'mid', 1220, 9580, 300, 300);
  dec('chain', 'near', 1700, 8400, 24, 900, { len: 900 });
  dec('girder', 'near', -20, 9520, 240, 56);

  // S7 — the Hollow Nave: colossal ribs, mineral bones, a figure in the dark.
  dec('ribs', 'far', -240, 10500, 2280, 1500);
  dec('statue', 'far', 460, 11300, 840, 2000);
  dec('bones', 'far', 1150, 11950, 760, 640);
  dec('shaft-light', 'far', 840, 10150, 300, 2600, { color: '#b8f0e0' });
  dec('pillar', 'mid', 90, 10480, 120, 2000);
  dec('pillar', 'mid', 1590, 10480, 120, 2000);
  dec('arch', 'mid', 90, 10420, 1620, 500);
  dec('chain', 'mid', 470, 10000, 18, 420, { len: 420 });
  dec('chain', 'mid', 1300, 10600, 18, 340, { len: 340 });
  dec('cage', 'mid', 1300, 10950, 120, 180);
  dec('sign', 'mid', 300, 11800, 230, 50, { text: SIGN.s7 });
  dec('cables', 'near', -120, 11500, 320, 220);
  dec('chain', 'near', 1690, 10600, 24, 1200, { len: 1200 });

  // S8 — the Last Throat: converging cliffs, the Still Lamp's warm glow below.
  dec('cliff', 'far', -520, 12700, 820, 2300);
  dec('cliff', 'far', 1500, 12700, 820, 2300);
  dec('shaft-light', 'far', 480, 13700, 640, 1300, { color: '#e0a050' });
  dec('ribs', 'mid', 200, 12880, 1400, 400);
  dec('glyphs', 'mid', 420, 13480, 200, 300);
  dec('machinery', 'mid', 1240, 14250, 320, 420);
  dec('sign', 'mid', 590, 14240, 320, 56, { text: SIGN.s8 });
  dec('lamp', 'mid', 300, 14560, 40, 80, { flicker: 0, still: true }); // the Still Lamp
  dec('statue', 'mid', 140, 14420, 160, 280);
  dec('chain', 'near', 110, 12700, 24, 900, { len: 900 });
  dec('pipe', 'near', 1500, 13400, 100, 800);

  // ===========================================================================
  // Sections (themes, creature behaviour, hints, triggers)
  // creature: speedMul 1 / burstRate 0 = the creature module's mode defaults.
  // Hints use [Key] tokens (rendered as keycaps by the UI).
  // ===========================================================================
  const creature = (mode, lethal, spawnOffsetY) => ({ mode, lethal, speedMul: 1, burstRate: 0, spawnOffsetY });
  const theme = (fog, light, accent, fogDensity, darkness) => ({ fog, light, accent, fogDensity, darkness });

  const sections = [
    {
      id: 's1', name: 'The Threshold', subtitle: 'Where the line is learned',
      y0: 0, y1: 780, checkpoint: { x: 470, y: 346 },
      theme: theme('#252b30', '#6fa3b5', '#e0a050', 0.32, 0.34),
      creature: creature('dormant', false, -2600),
      hints: [
        {
          y: 300, duration: 9,
          text: 'Hold [Left Click] on a marked anchor to fire the tether. Release to let go.',
          keyboard: 'Aim with the [Arrow] keys, hold [Space] to fire the tether. Release to let go.',
          touch: 'Touch and hold a marked anchor to fire the tether. Lift your finger to let go.',
        },
        {
          y: 430, duration: 7,
          text: 'Pump the swing with [A] / [D]. Let go near the top of the arc to fly.',
          touch: 'Push the left stick sideways to pump the swing. Lift your finger near the top of the arc to fly.',
        },
        {
          y: 580, duration: 8,
          text: 'Hanging? [S] lets out rope to lower yourself. [W] reels you in.',
          touch: 'Hanging? Pull the left stick down to let out rope and lower yourself; push up to reel in.',
        },
      ],
      triggers: [],
    },
    {
      id: 's2', name: 'The Long Swing', subtitle: 'Momentum is a promise',
      y0: 780, y1: 2950, checkpoint: { x: 1400, y: 886 },
      theme: theme('#22282d', '#6fa3b5', '#e0a050', 0.38, 0.42),
      creature: creature('dormant', false, -2600),
      hints: [
        {
          y: 870, duration: 7,
          text: 'Run, fire at the hook, and let go on the upswing. Momentum carries you across.',
          touch: 'Run, touch the hook, and lift on the upswing. Momentum carries you across.',
        },
        {
          y: 1500, duration: 6,
          text: 'Falling? Fire again — any anchor will catch you. The rope forgives; the floor does not.',
          touch: 'Falling? Touch another anchor — any anchor will catch you. The rope forgives; the floor does not.',
        },
      ],
      triggers: [{ y: 1600, name: 'rumble', data: { intensity: 0.25 } }],
    },
    {
      id: 's3', name: 'Broken Gallery', subtitle: 'Every fall is a question',
      y0: 2950, y1: 4250, checkpoint: { x: 1450, y: 3026 },
      theme: theme('#23231f', '#7c9a9c', '#3f6b63', 0.44, 0.5),
      creature: creature('dormant', false, -2400),
      hints: [
        {
          y: 3300, duration: 6,
          text: 'Missed a landing? Don\'t wait — fire at a lower ring.',
          touch: 'Missed a landing? Don\'t wait — touch a lower ring.',
        },
      ],
      triggers: [
        { y: 3120, name: 'debris', data: { x: 700, y: 2950, intensity: 0.35 } },
        { y: 3950, name: 'call', data: { x: 300, y: 2200, intensity: 0.3 } },
      ],
    },
    {
      id: 's4', name: 'The Listening Vault', subtitle: 'Something answered',
      y0: 4250, y1: 6050, checkpoint: { x: 1460, y: 4286 },
      theme: theme('#1b2226', '#5b8c9b', '#b8f0e0', 0.55, 0.56),
      creature: creature('sighting', false, -2200),
      hints: [],
      triggers: [
        // Fires as the player swings out to the balcony overlooking the Vault.
        { y: 4500, name: 'sighting', data: { x: 180, y: 5300 } },
        { y: 5300, name: 'call', data: { x: 200, y: 5600, intensity: 0.5 } },
      ],
    },
    {
      id: 's5', name: 'The Gullet Stair', subtitle: 'It has your scent',
      y0: 6050, y1: 8050, checkpoint: { x: 620, y: 6086 },
      theme: theme('#211b19', '#8a5a3c', '#7a3b22', 0.52, 0.64),
      creature: creature('stalk', true, -1300),
      hints: [
        {
          y: 6120, duration: 5,
          text: 'Something is coming down after you. Keep moving.',
          touch: 'Something is coming down after you. Keep moving.',
        },
      ],
      triggers: [
        { y: 6150, name: 'rumble', data: { intensity: 0.6 } },
        { y: 6800, name: 'debris', data: { x: 900, y: 6400, intensity: 0.6 } },
        { y: 7500, name: 'call', data: { intensity: 0.8 } },
      ],
    },
    {
      id: 's6', name: 'The Two Descents', subtitle: 'Slow and certain, or quick and thin',
      y0: 8050, y1: 10250, checkpoint: { x: 900, y: 8086 },
      theme: theme('#1b1918', '#5a7d86', '#9a4a2a', 0.58, 0.7),
      creature: creature('hunt', true, -1200),
      hints: [
        {
          y: 8080, duration: 8,
          text: 'Left: the long stair, slow and certain. Right: frayed rings that snap under load — quick and thin.',
          touch: 'Left: the long stair, slow and certain. Right: frayed rings that snap under load — quick and thin.',
        },
      ],
      triggers: [
        { y: 8150, name: 'call', data: { intensity: 0.9 } },
        { y: 9200, name: 'debris', data: { x: 1300, y: 8900, intensity: 0.7 } },
      ],
    },
    {
      id: 's7', name: 'The Hollow Nave', subtitle: 'Nothing to stand on',
      y0: 10250, y1: 12550, checkpoint: { x: 900, y: 10286 },
      theme: theme('#141719', '#4f7f8c', '#b8f0e0', 0.66, 0.76),
      creature: creature('frenzy', true, -1100),
      hints: [
        {
          y: 10280, duration: 6,
          text: 'Chain the rings. Fire at the next one before you let go of this one.',
          touch: 'Chain the rings: touch the next one with another finger before you let go.',
        },
      ],
      triggers: [
        { y: 10350, name: 'rumble', data: { intensity: 0.8 } },
        { y: 11300, name: 'debris', data: { x: 900, y: 10900, intensity: 0.8 } },
        { y: 12000, name: 'call', data: { intensity: 1 } },
      ],
    },
    {
      id: 's8', name: 'The Last Throat', subtitle: 'Down. Now.',
      y0: 12550, y1: 14700, checkpoint: { x: 1350, y: 12586 },
      theme: theme('#120f0e', '#d9b878', '#e0a050', 0.6, 0.8),
      creature: creature('escape', true, -1000),
      hints: [
        {
          y: 14450, duration: 5,
          text: 'The grate — run for the light.',
          touch: 'The grate — run for the light.',
        },
      ],
      triggers: [
        { y: 12650, name: 'rumble', data: { intensity: 1 } },
        { y: 13600, name: 'debris', data: { x: 900, y: 13200, intensity: 0.9 } },
        { y: 14300, name: 'gate', data: { x: 580, y: 14560 } },
      ],
    },
  ];

  AT.LEVEL_DATA = {
    name: 'The Underspire',
    width: 1800,
    spawn: { x: 470, y: 346 },
    bottom: 14700, // floor of the Still Lamp chamber (bounds.y1)
    goal: { x: 140, y: 14460, w: 400, h: 240 }, // inside the chamber, left of the grate
    gate: { x: 560, y: 14420, w: 40, h: 280 }, // vertical grate at the chamber mouth
    sections,
    solids,
    hazards,
    anchors,
    decor,
  };
})((window.AT = window.AT || {}));
