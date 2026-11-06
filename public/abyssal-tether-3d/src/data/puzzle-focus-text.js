/* THE LANTERN (ABYSSAL TETHER 3D) — data/puzzle-focus-text.js
 * PUZZLE FOCUS: every line someone says when the player reaches a puzzle (docs/abyssal-tether-3d/plans/PUZZLE_FOCUS.md). The owner:
 * "during every puzzle I need the camera to be focused there with a dialogue from player or from mic, suggesting the player to check it out."
 *
 * Text only (like data/chapter2-text.js): which puzzle a fixture is, when a step fires and how the camera / gaze guide behaves live in
 * sim/puzzleFocus.js and sim/focusBeat.js. Every line goes through the shipped radio director (sim/comms3d.js, `CommsDirector.focus`)
 * with the same limits as COMMS_SCRIPT: <= 84 characters, <= 2 panel rows of 42, <= 11 words, COMMS_CHARSET, Vesper <= 5 words.
 *
 * Per puzzle TYPE, per STEP, one or more variants:
 *   first   first sight: the fixture comes into view (line of sight, within `see` m) or the player is within 6 m of it
 *   nudge   after a while: 40 s after the first beat, the puzzle still pending and the player still in its section
 *   hint    escalation: the existing 20 s highlight (sim/objectiveHint.js) has just come on for this objective; the line names the mark
 * Variety and the SIGNAL ARC: ELIAS (thinking aloud, dry in the suit) and VESPER (the suit AI) are local and always available; the uplink
 * voices (TICK reading the suit's scanner, ODESSA, MAREN for the lore and the carved words) need the radio's signal at or above
 * UPLINK_MIN (S1-S6 of Chapter I, Lamphold until the Snuffing), and the deeper you are the likelier the local voice (sim/puzzleFocus.js
 * weighs an uplink variant by the signal). Each step of an objective type keeps at least one local variant, so the deep end is never mute.
 * `dir`: the actor's direction (voice/lines.csv, VO_SCRIPT.md). `quiet`: sections (ids) where the beat is cues only (the rest beats of
 * Lamphold: "no chatter", data/chapter2-text.js decision 4).
 *
 * DOM-free, three.js-free, no imports: importable from Node.
 */

/** An uplink voice needs at least this much signal (sim/comms3d.js signalAt: S6 0.46 .. S7 0.33; Lamphold the same arc by beat). */
export const UPLINK_MIN = 0.4;

/** The steps of a focus beat, in the order they can fire. */
export const FOCUS_STEPS = Object.freeze(['first', 'nudge', 'hint']);

const V = (id, speaker, text, dir) => Object.freeze({ id, speaker, text, dir });

/**
 * The puzzle types. `chapter` 1 | 2; `where` the sections (for the doc); `source` where its position comes from; `see` the first-sight
 * range (m); `objective` true: a seal's fixture (the three steps), false: a place worth a look (first sight only).
 */
export const PUZZLE_TYPES = Object.freeze({
  // ---------------------------------------------------------------- CHAPTER I ----------------------------------------------------------------
  bell: Object.freeze({
    chapter: 1, where: 'S1 The Threshold', source: 'fixture bell-s1 (x, y, z)', see: 16, objective: true,
    first: [
      V('pf-bell-1a', 'ELIAS', 'A bell. Why is there a bell down here?', 'Half to himself, puzzled more than afraid. A small breath before "Why".'),
      V('pf-bell-1b', 'TICK', "Wren, your scanner's pinging brass under you. Big. Hollow.", 'Reading his screen, curious, quick. "Big. Hollow." as he reads it off.'),
    ],
    nudge: [
      V('pf-bell-2a', 'ODESSA', "That bell's hung to be struck, Elias. Swing into it.", 'Patient, warm, a teacher who has seen it done. No hurry.'),
      V('pf-bell-2b', 'ELIAS', 'Hung to be struck. So strike it. Swing hard.', 'Working it out loud; the last two words decided.'),
    ],
    hint: [
      V('pf-bell-3a', 'TICK', 'Marked the bell for you, Wren. Swing into it hard.', 'Helpful, a little pleased with his marker. Quick.'),
      V('pf-bell-3b', 'VESPER', 'Bell marked. Strike it.', 'Suit readout. Flat.'),
    ],
  }),
  haul: Object.freeze({
    chapter: 1, where: 'S2 The Long Swing', source: "fixture cw-s2: its ring s2-cw", see: 18, objective: true,
    first: [
      V('pf-haul-1a', 'MAREN', 'A counterweight. Lanternwright work. That chain lowers something.', 'Dry, exact, interested: she has read about these and never seen one.'),
      V('pf-haul-1b', 'ELIAS', "A counterweight on a chain. That's my way down.", 'Sizing it up. Practical, tired.'),
    ],
    nudge: [
      V('pf-haul-2a', 'TICK', 'Wren, the counterweight. Hook it and haul. It ratchets.', 'Explaining kit he likes. Brisk.'),
      V('pf-haul-2b', 'ELIAS', 'Hook the weight. Haul. One notch at a time.', 'Muttered plan, one step per breath.'),
    ],
    hint: [
      V('pf-haul-3a', 'ODESSA', "The counterweight's marked, Elias. Hook it and haul.", 'Calm instruction, warm.'),
      V('pf-haul-3b', 'VESPER', 'Counterweight marked. Haul it.', 'Suit readout. Flat.'),
    ],
  }),
  winch: Object.freeze({
    chapter: 1, where: 'S3 Broken Gallery', source: 'fixture winch-s3: its ring s3-winch on the turning gear (moves)', see: 22, objective: true,
    first: [
      V('pf-winch-1a', 'TICK', "Something's moving on your scanner, Wren. A gear. Still turning.", 'Surprised, a nervous little laugh under it.'),
      V('pf-winch-1b', 'ELIAS', "That gear's still turning. There's a ring on it.", 'Low, noticing. A beat between the sentences.'),
    ],
    nudge: [
      V('pf-winch-2a', 'MAREN', 'Their gears carried people, Elias. Let it carry you.', 'Dry, a historian giving a practical tip.'),
      V('pf-winch-2b', 'ELIAS', 'Catch the ring as it comes round. Let it carry me.', 'Timing it under his breath.'),
    ],
    hint: [
      V('pf-winch-3a', 'TICK', "Marked the gear ring. Hook it when it's out, Wren.", 'Quick, helpful.'),
      V('pf-winch-3b', 'VESPER', 'Gear ring marked. Time it.', 'Suit readout. Flat.'),
    ],
  }),
  lamp: Object.freeze({
    chapter: 1, where: 'S4 The Listening Vault', source: 'fixtures lamp-s4a/b/c (x, y, z): the nearest one not yet lit', see: 14, objective: true,
    first: [
      V('pf-lamp-1a', 'MAREN', 'Cold lamps. They lit them to pass. Hold your light close.', 'Hushed: the vault is listening. Exact.'),
      V('pf-lamp-1b', 'ELIAS', "A dead lamp. Wick's still there. My lantern, then.", 'Whispered to himself.'),
    ],
    nudge: [
      V('pf-lamp-2a', 'ODESSA', 'Three cold lamps, Elias. Your lantern to each wick.', 'Quiet, controlled.'),
      V('pf-lamp-2b', 'ELIAS', 'Still dark ones. Lantern to the wick. Hold it there.', 'Whispered, patient.'),
    ],
    hint: [
      V('pf-lamp-3a', 'TICK', 'Marked the dark wicks, Wren. Hold your lantern there.', 'Hushed for once.'),
      V('pf-lamp-3b', 'VESPER', 'Cold wicks marked.', 'Suit readout. Flat.'),
    ],
  }),
  rest: Object.freeze({
    chapter: 1, where: "S4, S6: the Masons' rests (nooks)", source: 'level nooks (box centre)', see: 10, objective: false,
    first: [
      V('pf-rest-1a', 'MAREN', "A Masons' rest. It cannot follow you in. Remember it.", 'Low, urgent under the dryness: this one matters.'),
      V('pf-rest-1b', 'ELIAS', 'Lamp-lit corner. Carved glyphs. Somewhere to hide.', 'Noting it, breath held.'),
    ],
  }),
  breach: Object.freeze({
    chapter: 1, where: 'S5 The Gullet Stair', source: 'fixture key-s5: the keystone solid (centre)', see: 14, objective: true,
    first: [
      V('pf-breach-1a', 'ELIAS', "That stone's holding the grating up. A keystone.", 'Working it out, quiet: something is above him.'),
      V('pf-breach-1b', 'TICK', "Scanner says one stone's carrying the whole grate. Huh.", 'Reading, then the "Huh." of someone who gets it.'),
    ],
    nudge: [
      V('pf-breach-2a', 'MAREN', 'Let it knock, they wrote. Its blows break stone.', 'Cold, exact: the rule as a tool.'),
      V('pf-breach-2b', 'ELIAS', 'Hide in the niche. Let it hit the stone. Or haul.', 'Fast, low, a plan made in fear.'),
    ],
    hint: [
      V('pf-breach-3a', 'TICK', 'Keystone marked. Hide and let it knock, or haul the ring.', 'Fast, nervous.'),
      V('pf-breach-3b', 'VESPER', 'Keystone marked. Loud option: haul.', 'Suit readout. Flat.'),
    ],
  }),
  lure: Object.freeze({
    chapter: 1, where: 'S5: the lure niche behind the keystone', source: 'level nook nook-s5 (box centre)', see: 8, objective: false,
    first: [
      V('pf-lure-1a', 'MAREN', "That niche. 'Let it knock. Do not knock back.' Get in.", 'Reading the plaque, then an order she has no right to give.'),
      V('pf-lure-1b', 'ELIAS', 'A niche behind the keystone. Small enough to hide in.', 'Whispered.'),
    ],
  }),
  fork: Object.freeze({
    chapter: 1, where: 'S6 The Two Descents', source: 'fixtures fx-s6-safe / fx-s6-risk: their rings (the nearer pending)', see: 22, objective: true,
    first: [
      V('pf-fork-1a', 'MAREN', 'Two ways down, Elias. The slow stair or the quick rings.', 'Through static. Even, a choice laid out.'),
      V('pf-fork-1b', 'ELIAS', 'Two ways down. Stairs, or those rings. Choose.', 'Tired, weighing it.'),
    ],
    nudge: [
      V('pf-fork-2a', 'ELIAS', 'Pick a way. Hook the last ring on either line.', 'Firm with himself.'),
      V('pf-fork-2b', 'VESPER', 'Two routes. Either suffices.', 'Suit readout. Flat.'),
    ],
    hint: [
      V('pf-fork-3a', 'VESPER', 'Route rings marked. Hook one.', 'Suit readout. Flat.'),
      V('pf-fork-3b', 'TICK', 'Marked both last rings, Wren. Either one opens it.', 'Through static, quick.'),
    ],
  }),
  survive: Object.freeze({
    chapter: 1, where: 'S7 The Hollow Nave', source: 'objective obj-s7: its seal, the iris (centre of its top)', see: 40, objective: true,
    first: [
      V('pf-survive-1a', 'ELIAS', "The iris. It won't open while I stand on the landing.", 'Reading the tablet aloud, then understanding it. Low.'),
      V('pf-survive-1b', 'VESPER', 'Iris sealed. Hang below.', 'Suit readout. Flat.'),
    ],
    nudge: [
      V('pf-survive-2a', 'ELIAS', 'Off the landing. Hang in the nave. Hold on.', 'Bracing himself.'),
      V('pf-survive-2b', 'VESPER', 'Landing pauses it. Descend.', 'Suit readout. Flat.'),
    ],
    hint: [
      V('pf-survive-3a', 'VESPER', 'Iris marked. Keep hanging.', 'Suit readout. Flat.'),
      V('pf-survive-3b', 'ELIAS', 'Hang on, Elias. It opens for the ones who hang.', 'Through the teeth.'),
    ],
  }),
  // ---------------------------------------------------------------- CHAPTER II · LAMPHOLD ----------------------------------------------------
  swing: Object.freeze({
    chapter: 2, where: 'II-1 The Lowering, II-3 The Chandeliers: the swinging rings', source: 'anchors c2-1-ring0, c2-3-ring0 (pendulum movers: moves)', see: 26, objective: false,
    first: [
      V('pf-swing-1a', 'TICK', "That ring's swinging, Wren. Catch it on the way in.", 'Delighted, five bars again.'),
      V('pf-swing-1b', 'ELIAS', 'A ring on a chain, swinging. Catch it as it comes.', 'Watching it, timing it.'),
    ],
  }),
  lift: Object.freeze({
    chapter: 2, where: 'II-2 The Street of Doors: the counterweight lift', source: 'anchor c2-2-lift-ring (a lift mover: moves)', see: 20, objective: false,
    first: [
      V('pf-lift-1a', 'TICK', 'Lift on the wall, Wren. Ring on top. Free ride.', 'Cheerful, the old Tick for a moment.'),
      V('pf-lift-1b', 'ELIAS', 'A lift on the wall. Counterweighted. Still running.', 'Impressed despite himself.'),
    ],
  }),
  knocker: Object.freeze({
    chapter: 2, where: 'II-2 The Street of Doors', source: 'fixtures door-c2-2-0 / -1: their knocker rings', see: 12, objective: true,
    first: [
      V('pf-knocker-1a', 'MAREN', "A knocker. 'Knock, and be known.' Hook it, Elias.", 'Reading the canon plaque with relish.'),
      V('pf-knocker-1b', 'ELIAS', "A door with a knocker. Somebody's name behind it.", 'Gentle: it is someone\'s house.'),
    ],
    nudge: [
      V('pf-knocker-2a', 'MAREN', 'Knock first, Elias. Their names are behind the doors.', 'Dry, a little insistent.'),
      V('pf-knocker-2b', 'ELIAS', 'Hook the knocker. Knock. Be known.', 'Quiet, almost a ritual.'),
    ],
    hint: [
      V('pf-knocker-3a', 'TICK', "Marked the knocker, Wren. Hook it, that's a knock.", 'Quick, a little proud of the joke.'),
      V('pf-knocker-3b', 'VESPER', 'Knocker marked. Hook it.', 'Suit readout. Flat.'),
    ],
  }),
  name: Object.freeze({
    chapter: 2, where: 'II-2, II-3, II-9: the Names (II-4 cues only)', source: "c2.names: the lit slab of each Name", see: 12, objective: false, quiet: Object.freeze(['c2-4', 'c2-13']),
    first: [
      V('pf-name-1a', 'MAREN', 'A name, carved and lit. Read it to me, Elias.', 'Soft: this is why she came.'),
      V('pf-name-1b', 'ELIAS', "Someone's name, lit like a grave. Go and read it.", 'Quiet respect.'),
    ],
  }),
  peal: Object.freeze({
    chapter: 2, where: 'II-9 The Tolling Gallery', source: 'fixtures bell-c2-9-0..7 (x, y, z): the nearest unrung', see: 26, objective: true,
    first: [
      V('pf-peal-1a', 'MAREN', 'Ring the morning, they wrote. Five bells, Elias. Then listen.', 'Reading, then a warning she cannot name.'),
      V('pf-peal-1b', 'ELIAS', 'Bells. A whole row of them. Swing into them?', 'Uneasy: the last bell answered.'),
    ],
    nudge: [
      V('pf-peal-2a', 'TICK', "That's five bells to open the floor, Wren. Swing through.", 'Trying to be light; not quite.'),
      V('pf-peal-2b', 'ELIAS', 'Five bells. Swing from the beam. One after another.', 'Planning, low.'),
    ],
    hint: [
      V('pf-peal-3a', 'TICK', "Marked the bells you haven't rung. Swing through them.", 'Quick, helpful.'),
      V('pf-peal-3b', 'VESPER', 'Unrung bells marked.', 'Suit readout. Flat.'),
    ],
  }),
  clapper: Object.freeze({
    chapter: 2, where: 'II-12 The Snuffing (the Well): the clapper rings', source: 'fixtures clap-c2-12-W / -N: their haul rings', see: 16, objective: true,
    first: [
      V('pf-clapper-1a', 'ELIAS', 'A clapper ring on the rim. Haul it, a bell speaks.', 'Whispered, thinking fast: the Doorman is near.'),
      V('pf-clapper-1b', 'MAREN', 'Clapper rings. Haul one and a bell speaks over there.', 'Through static, hushed.'),
    ],
    nudge: [
      V('pf-clapper-2a', 'ELIAS', "Put the bell where I'm not. Haul the clapper.", 'The plaque\'s rule, said as a plan.'),
      V('pf-clapper-2b', 'VESPER', 'Clapper ring. Haul to toll.', 'Suit readout. Flat.'),
    ],
    hint: [
      V('pf-clapper-3a', 'VESPER', 'Clapper marked. Haul it.', 'Suit readout. Flat.'),
      V('pf-clapper-3b', 'ELIAS', 'There. The clapper. Haul it and get clear.', 'Tight, fast.'),
    ],
  }),
  pawl: Object.freeze({
    chapter: 2, where: 'II-12 The Snuffing: the gate pawl', source: 'fixture bell-c2-12-pawl (x, y, z)', see: 18, objective: true,
    first: [
      V('pf-pawl-1a', 'ELIAS', "The gate's pawl. Hit it hard enough and it breaks.", 'Low, sizing up iron.'),
      V('pf-pawl-1b', 'MAREN', 'That pawl holds the gate. Iron breaks to a blow.', 'Through static, exact.'),
    ],
    nudge: [
      V('pf-pawl-2a', 'ELIAS', 'Swing into the pawl. Faster. It wants a real blow.', 'Breathing hard.'),
      V('pf-pawl-2b', 'VESPER', 'Pawl intact. Strike harder.', 'Suit readout. Flat.'),
    ],
    hint: [
      V('pf-pawl-3a', 'VESPER', 'Pawl marked. Strike it.', 'Suit readout. Flat.'),
      V('pf-pawl-3b', 'ELIAS', 'The pawl. Full swing, Elias. Break it.', 'Through the teeth.'),
    ],
  }),
  lever: Object.freeze({
    chapter: 2, where: 'II-12 The Snuffing (the Lift tower): the cage lever', source: 'fixture lever-c2-12: its ring', see: 12, objective: true,
    first: [
      V('pf-lever-1a', 'ELIAS', 'A lever on the landing. The cage goes down on it.', 'Fast, hopeful.'),
      V('pf-lever-1b', 'VESPER', 'Cage lever. Haul once.', 'Suit readout. Flat.'),
    ],
    nudge: [
      V('pf-lever-2a', 'ELIAS', 'Haul the lever. Ride the cage down. Go.', 'Urgent, low.'),
    ],
    hint: [
      V('pf-lever-3a', 'VESPER', 'Lever marked. Haul it.', 'Suit readout. Flat.'),
      V('pf-lever-3b', 'ELIAS', 'The lever. Now, Elias. Haul it.', 'Hard, to himself.'),
    ],
  }),
});

/** Every focus line in one flat, frozen list (the tests, the voice export), in table order. */
export const PUZZLE_FOCUS_LINES = Object.freeze(
  Object.keys(PUZZLE_TYPES).flatMap((type) =>
    ['first', 'nudge', 'hint'].flatMap((step) => (PUZZLE_TYPES[type][step] || []).map((v) => Object.freeze(Object.assign({ type, step }, v)))),
  ),
);
