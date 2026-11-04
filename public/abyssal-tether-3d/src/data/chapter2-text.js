/* ABYSSAL TETHER 3D — data/chapter2-text.js
 * CHAPTER II · LAMPHOLD: every in-world word of the chapter (hints, plaques, Names, lamp labels, the Usher's captions, the boss, the hook, the radio).
 * Text only: placement (x, y, z, yaw) is the level data's job; here a plaque says which beat, which pit wall and how far down the beat (0 = its top).
 *
 * Sources (canon first): docs/abyssal-tether-3d/CHAPTERS.md §2, §6.3 (the four canon plaques and the five Names, word for word),
 * plans/CHAPTER_II_DIRECTION.md (the story, the 13 beats, the boss, the hook, the radio), plans/DARK_STORY_BIBLE.md §1 (the voice), plans/USHER.md, plans/COMMS.md.
 *
 * DECISIONS (story writer, 2026-11-04):
 * 1. THE BOSS is the direction doc's: the HEAD USHER, called THE DOORMAN in the town (§3). Phases A the Round, B the Well, C1 the Span, C2 the Lift.
 *    He is never fought: he is made to open the door, then he snuffs the last lamp and sits. No health bar, so no "defeated" wording anywhere.
 * 2. BUDGET. The owner caps Chapter II at 260 words of plaques + hints (CHAPTERS §11: VR and desktop wording count once). This file: 16 plaques (150 words)
 *    + 11 hints (102 words) = 252. The direction's 23 lines (§1.6) did not fit: kept T2 T4 T5 T6 T7 T8 T10 T11 T12 T15 T16 T17 T18 T21 T22 T23 (its
 *    boards become plaques); cut T1 (the late lamp: T22 and T18 carry "late"), T3, T9, T13, T14, T19, T20. Each plaque <= 3 lines of <= 24 characters.
 * 3. II-1 HAS NO PLAQUE. The first plaque of the chapter is KNOCK, AND BE KNOWN. (canon, II-2). II-1's only words are the carved title and the live-anchor
 *    hints: the first 2.5 minutes teach with the hands, not the eyes.
 * 4. No hint in the rest beats (II-4, II-13: "no chatter") or the TEST beat (II-3 teaches nothing new). One new idea per hint.
 * 5. The Usher never speaks: it has captions, never lines. Plaques are the Lampholders' (domestic, kind, WE), never the Keepers' (the Keepers wrote Chapter I).
 *
 * DOM-free, three.js-free, no imports: importable from Node.
 */

export const CHAPTER2_TEXT = {
  /** The carved title that drifts up out of the dark on the Lamplighters' roof (II-1, the chapter swap). */
  title: { numeral: 'II', title: 'LAMPHOLD' },

  /**
   * Hints, keyed by beat id. { at: fraction of the beat from its top, duration (s), text (VR), desktop }.
   * Shown once each. The instruction comes first and is true to the rule; a dark tail may follow (DARK_STORY_BIBLE §1.1 rule 7).
   */
  hints: {
    // TEACH LIVE ANCHORS: catch it as it comes, let go as it rises, keep its speed (CHAPTERS §6)
    'c2-1': [
      { at: 0.02, duration: 7, text: 'Some rings swing. Fire as one comes toward you.', desktop: 'Some rings swing. Aim and click as one comes toward you.' },
      { at: 0.35, duration: 7, text: 'Let go as it rises. You keep its speed.', desktop: 'Release the button as it rises. You keep its speed.' },
    ],
    // TEACH 2: the pull-anchor (canon hint, CHAPTERS §6.1 II-2)
    'c2-2': [{ at: 0.6, duration: 7, text: 'Some rings move machinery. Yank them.', desktop: 'Some rings move machinery. Hook one and press F to yank.' }],
    // TEST: nothing new
    'c2-3': [],
    // REST / TRUTH: no chatter
    'c2-4': [],
    // the crush telegraph (E16): hazard stripes + a 1.5 s ratchet
    'c2-5': [{ at: 0.1, duration: 7, text: 'Stripes and a ratchet: a load is coming. Stand clear.', desktop: 'Stripes and a ratchet: a load is coming. Stand clear.' }],
    // safeLight (E18): the Mason cannot enter a lit cluster (the Dresser can; it does not knock)
    'c2-6': [{ at: 0.08, duration: 7, text: 'Stay in the lit circles. What knocks cannot cross the light.', desktop: 'Stay in the lit circles. What knocks cannot cross the light.' }],
    // the elastic catch on the express (E15)
    'c2-7': [{ at: 0.06, duration: 7, text: 'Fire at a fixed ring before the bottom.', desktop: 'Aim at a fixed ring and fire before the bottom.' }],
    // the driven pendulum (pump a hung house)
    'c2-8': [{ at: 0.08, duration: 7, text: 'Stand on a house and yank its chain in rhythm.', desktop: 'Stand on a house and press F on its chain in rhythm.' }],
    // the bell verb, and the Usher's one rule (direction §5.3 risk 5: "Bells call it.")
    'c2-9': [{ at: 0.1, duration: 8, text: 'Swing into the bells. Bells call it.', desktop: 'Swing into the bells. Bells call it.' }],
    // noise masking in the din (E11): each hammer strike masks you 1.5 s
    'c2-10': [{ at: 0.1, duration: 7, text: 'Move when the hammers strike. The din hides you.', desktop: 'Move when the hammers strike. The din hides you.' }],
    // RECOVERY with dread: the burnt stair is Chapter I's crumble and lanes
    'c2-11': [],
    // THE EXAM: the torch, the toll, then the pawl puzzle at the Well rim (Phase B starts at d 66 of 150)
    'c2-12': [
      { at: 0.03, duration: 8, text: 'Where its cold light falls, it strikes. Brass rings chime.', desktop: 'Where its cold light falls, it strikes. Brass rings chime.' },
      { at: 0.44, duration: 8, text: 'The door breaks to a blow. Put the bell where you are not.', desktop: 'The door breaks to a blow. Put the bell where you are not.' },
    ],
    // the true rest, then the hook: no words but the plaques and the card
    'c2-13': [],
  },

  /**
   * Plaques, in the order the player meets them. { id, beat, text (ALL CAPS, '\n' breaks, <= 3 lines of <= 24 chars), side: the pit wall
   * it is carved on ('w' | 'e' | 'n' | 's'), at: fraction of the beat from its top }. canon: word for word from CHAPTERS §6.3.
   * role: 'knock' (the first), 'usher' (its rule, as a custom), 'boss' (the Doorman), 'hook' (the last).
   */
  plaques: [
    // II-2, the head of the Street of Doors (T2). The first plaque of the chapter.
    { id: 'c2-p-knock', beat: 'c2-2', text: 'KNOCK,\nAND BE KNOWN.', side: 'n', at: 0.05, canon: true, role: 'knock' },
    // II-3, the first rest balcony (T4): the engine is a clock
    { id: 'c2-p-hours', beat: 'c2-3', text: 'THE CHANDELIERS\nKEEP THE HOURS.\nTHE HOURS KEEP THE TOWN.', side: 'e', at: 0.2 },
    // II-4, on the lowering path (T5, truth 2)
    { id: 'c2-p-bed', beat: 'c2-4', text: 'EVERY LAMP A BED.\nEVERY BED A MORNING.', side: 'w', at: 0.3, canon: true },
    // II-4, at a ward door by the row of tall empty chairs (T6): the first printed word of the villain
    { id: 'c2-p-beds-made', beat: 'c2-4', text: 'THE BEDS ARE MADE\nAT EVENING.\nTHE USHER SEES TO IT.', side: 's', at: 0.7 },
    // II-5, Yard A, beside the crane rail where the three raps come (T7)
    { id: 'c2-p-gently', beat: 'c2-5', text: 'WHAT WAS CARRIED HERE\nWAS CARRIED GENTLY.', side: 'n', at: 0.15 },
    // II-6, the first lit cluster (T8)
    { id: 'c2-p-dress', beat: 'c2-6', text: 'DRESS THE OLD STONE\nWITH CARE.\nIT WAS SOMEONE.', side: 'w', at: 0.1, canon: true },
    // II-7, Shaft Gamma's head, under the gong (T10)
    { id: 'c2-p-weight', beat: 'c2-7', text: 'THE WEIGHT HAS NOT\nFALLEN SINCE THE LAST\nEVENING. IT IS EAGER.', side: 's', at: 0.05 },
    // II-8, the Hung Quarter landing (T11)
    { id: 'c2-p-rocked', beat: 'c2-8', text: 'THE HOUSES SWAY SO THE\nSLEEPERS ARE ROCKED.\nTHEY ASKED FOR IT.', side: 'e', at: 0.1 },
    // II-9, the nave's start, beside the first bell rope (T12): the Usher's rule, as a custom
    { id: 'c2-p-usher', beat: 'c2-9', text: 'RING THE MORNING.\nTHE USHER ANSWERS.\nIT HAS ALWAYS ANSWERED.', side: 'n', at: 0.06, role: 'usher' },
    // II-10, scratched on a beam by the escapement's last ring: read in the Stopping's silence (T15)
    { id: 'c2-p-silent', beat: 'c2-10', text: 'A SILENT MORNING\nIS NOT A QUIET ONE.', side: 'w', at: 0.5, style: 'scratch' },
    // II-11, the head of the burnt stair (T16): Evening has come before
    { id: 'c2-p-burned', beat: 'c2-11', text: 'THE STAIR WAS BURNED\nTO KEEP THE EVENING\nUP HERE. IT DID NOT.', side: 's', at: 0.05 },
    // II-12, the Lamplighters' Gallery (T17): the Keepers' law broken, the Mark Lamp in your hand
    { id: 'c2-p-permitted', beat: 'c2-12', text: 'WE ARE PERMITTED\nOUR LIGHTS. THE MARK\nIS FOR THE FEARFUL.', side: 'n', at: 0.02, canon: true },
    // II-12, the Gallery's rail, looking down at the dark Well (T18): you
    { id: 'c2-p-late', beat: 'c2-12', text: 'THE LAMPLIGHTER IS LATE.\nTHE EVENING IS NOT.', side: 'e', at: 0.05 },
    // II-12, the Lift tower's top landing, beside the gate where he stands (T21): the boss's plaque
    { id: 'c2-p-doorman', beat: 'c2-12', text: 'THE DOORMAN HAS NEVER\nLEFT HIS DOOR.', side: 's', at: 0.8, role: 'boss' },
    // II-13, the niche of the last waking lamp (T22): the true rest
    { id: 'c2-p-last-lamp', beat: 'c2-13', text: 'ONE LAMP IS LEFT.\nTHE LATE MAY HAVE IT.', side: 'w', at: 0.05 },
    // II-13, on the platform's rail at the Throat's lip (T23): the hook's plaque, the last words before the card
    { id: 'c2-p-mere', beat: 'c2-13', text: 'NO USHER GOES BELOW\nTHE THROAT.\nTHE MERE HAS ITS OWN.', side: 'e', at: 0.35, role: 'hook' },
  ],

  /** The five Names (CHAPTERS §6.3, unchanged; N2-5 moved to the Stone Yards with the cranes, direction §1.6). codex: the line the codex shows. */
  names: [
    { id: 'N2-1', beat: 'c2-2', text: 'OSWIN LAMPHOLDER', codex: 'Lit the first lamp below the Mark. Was proud of it.' },
    { id: 'N2-2', beat: 'c2-2', text: 'GODRIC THE LIFTWRIGHT', codex: 'Built the lifts so the old could go down too.' },
    { id: 'N2-3', beat: 'c2-3', text: 'HEDDA', codex: 'Wound the chandeliers every morning. Never once fell.' },
    { id: 'N2-4', beat: 'c2-4', text: 'MARGERY', codex: 'Slept here four thousand mornings. Counted every one.' },
    { id: 'N2-5', beat: 'c2-5', text: 'BRASK', codex: 'Dressed four hundred stones. Knew the last one.' },
  ],

  /**
   * Waking lamps. lamps[beat] = the beat's checkpoint (its first lamp in the direction's 20-lamp table, §2.2).
   * lampsMore = the other seven of the 20 (mid-beat and phase lamps), for when the beats get them; which difficulty keeps which is §2.2's table.
   */
  lamps: {
    'c2-1': { id: 'L2-1', label: "Lamplighters' Roof" },
    'c2-2': { id: 'L2-2', label: 'Lower Street' },
    'c2-3': { id: 'L2-3', label: 'Second Balcony' },
    'c2-4': { id: 'L2-4', label: 'Waking Hall' },
    'c2-5': { id: 'L2-5', label: 'Yard A' },
    'c2-6': { id: 'L2-7', label: 'Upper Stacks' },
    'c2-7': { id: 'L2-9', label: 'Gamma Head' },
    'c2-8': { id: 'L2-11', label: 'Hung Landing' },
    'c2-9': { id: 'L2-12', label: 'Tolling Gallery' },
    'c2-10': { id: 'L2-13', label: 'Winding Floor' },
    'c2-11': { id: 'L2-15', label: 'Cinder Stairs' },
    'c2-12': { id: 'L2-16', label: "Lamplighters' Gallery" },
    'c2-13': { id: 'L2-20', label: 'Soot Throat' },
  },
  lampsMore: [
    { id: 'L2-6', beat: 'c2-5', label: 'Yard C' },
    { id: 'L2-8', beat: 'c2-6', label: 'Lit Gallery' },
    { id: 'L2-10', beat: 'c2-7', label: 'Between Shafts' },
    { id: 'L2-14', beat: 'c2-10', label: 'The Runaway' },
    { id: 'L2-17', beat: 'c2-12', label: 'Well Rim' },
    { id: 'L2-18', beat: 'c2-12', label: 'Span Head' },
    { id: 'L2-19', beat: 'c2-12', label: 'Lift Tower' },
  ],

  /**
   * The Usher (an office, not a species; it never speaks). Captions in the game's style (ui/captions.js): bracketed, sentence case, what you HEAR.
   * Its raps must never read like the Mason's ('[Three slow knocks]'): the Usher's are light and even.
   */
  usher: {
    // II-9, the first sighting: shown as a caption when the pale ring first turns 100 m below (toll 2)
    sightingLine: '[Far below, something answers the bell]',
    captions: {
      knock: '[Three light, even raps]', // the rap: II-5's first sound of it, and its answer to a toll (LISTEN)
      throat: '[Breath through a pipe]', // LISTEN and RECOIL: the breath through the throat
      ring: '[Hum rising]', // COIL: the torch tightens on the toll
      lunge: '[Throat whips]', // WHIP
      // the rest of the language (direction §3.9, §3.10)
      commit: '[Hum jumps]', // the last 0.4 s, gold
      recoil: '[A long breath out]',
      snuff: '[A lamp goes out]',
      chime: '[Ring chimes]', // a brass ring you bit: the toll you made
      bell: '[Bell tolls]',
      blow: '[Iron breaks]', // a blow fixture: the Tenor's stand, the pawl
      sagShort: '[The throat falls short]', // a toll beyond reach
    },
  },

  /** The boss: the Head Usher, THE DOORMAN (direction §3). Phase captions in order A, B, C1, C2. */
  boss: {
    name: 'THE DOORMAN',
    subtitle: 'He answers the door.',
    introCaption: '[Keys jingling, far below]', // the Quiet: heard 6-10 s before he is seen on the pulpit
    phaseCaptions: [
      '[Lamps going out above you]', // A, the Round: the front leaves the Gallery
      '[A brass collar falls]', // B, the Well: the betrayal, the throat pays out
      '[The Span groans]', // C1, the Span: the Evening draws up the deck
      '[The cage gong sounds]', // C2, the Lift: departure, t = 0
    ],
    // the Evening ends: the last lamp is out, he withdraws and sits (SEATED); the player does not win a fight, the town goes dark
    defeatCaption: '[A chair is drawn out. Someone sits down]',
    lastLampCaption: '[Every lamp goes out]',
    bedsCaption: '[Beds creak, everywhere above]',
    // death cause 'usher' (E08 seated remnant): the death panel's kicker and message (ui3d.js DEATH_COPY style)
    deathKicker: 'In the cold light',
    deathLine: 'ANSWERED. YOU WERE SHOWN TO YOUR SEAT.',
  },

  /** The hook (II-13) and the end card with the call to action (direction §4.2, §4.3). */
  hook: {
    // carved letters rise out of the dark, world-locked at 3 m, as the Ushers of the Mere bow
    chapterCard: {
      numeral: 'III',
      title: 'THE MERE',
      line: 'THEY HAVE WAITED SINCE THE FIRST LAMP.\nTHE SEAT IS KEPT.',
      lineFallback: 'THEY HAVE WAITED SINCE THE FIRST LAMP.', // CHAPTER_II_PLAN §3's single line, if the owner declines the seat (direction §5.6 item 4)
    },
    endCard: {
      heading: 'II · LAMPHOLD · 1,250 m',
      // placeholders: {time} the chapter time, {deaths} wakes, {names} Names found
      lines: ['{time}', 'Woken {deaths} times.', 'Names {names} / 5', 'The lamps are out. Everyone is awake.', 'Something is showing you the way down.'],
      deathsOne: 'Woken once.',
      deathsZero: 'Woken 0 times. Nobody had to show you in.',
      next: 'III The Mere · IV The Keeping · V The Still Flame',
      nextLine: 'Three chapters. 1,520 metres further down, and 240 back up.',
      cta: {
        label: 'Continue the descent · {price}', // {price}: the localised store string (E06), never hard-coded
        note: 'One purchase unlocks Chapters III to V. Everything you have earned stays.',
        offStore: 'The full descent is on the Meta Horizon Store.', // outside a store install: no button action
        replay: 'Replay Chapter II',
        menu: 'Menu',
      },
    },
    lastPlaque: 'NO USHER GOES BELOW\nTHE THROAT.\nTHE MERE HAS ITS OWN.', // = plaques 'c2-p-mere'
  },

  /**
   * The Expedition radio (COMMS.md limits: <= 11 words, <= 84 chars, Vesper <= 5 words). In Lamphold the bars are the lit lamps within 30 m
   * (direction §1.8): five bars at the start, none after the last lamp. No line in II-4, II-13 (rest) or during danger.
   */
  radio: [
    { id: 'c2-open', beat: 'c2-1', speaker: 'ODESSA', text: 'Five bars, Elias. Down here. The lamps are carrying us.' },
    { id: 'c2-breach', beat: 'c2-6', speaker: 'VESPER', text: 'Contact. Wall. Unlit side.' },
    { id: 'c2-bell', beat: 'c2-9', speaker: 'TICK', text: 'Something answered the bell. Wren, it answered the bell.' },
    { id: 'c2-rule', beat: 'c2-9', speaker: 'MAREN', text: 'Not your footsteps. Not you. The bell.' },
    { id: 'c2-bars', beat: 'c2-11', speaker: 'ODESSA', text: 'Bars are dropping, Elias. Lamps are going out.' },
    { id: 'c2-orderly', beat: 'c2-12', speaker: 'MAREN', text: "That isn't the Mason. That's orderly." },
  ],
};
