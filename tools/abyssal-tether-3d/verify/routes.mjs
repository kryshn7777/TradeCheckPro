// Chapter I ("ch1" = today's LEVEL_DATA_3D descent) bot routes, alternate lines and
// recovery scenarios for the verification harness.
//
// Pure data, no imports: the browser e2e loads this file as-is (/__e2e/routes.mjs).
// Each route starts standing on the section's checkpoint and ends standing on the
// next section's checkpoint platform (S8: inside the goal). Step grammar: bot.mjs.
// Seals (LEVEL_FUN_PLAN P1): a route starts with the seals of the sections above it open and its own closed; it opens it by
// hooking the ring the level data names for it (s1 t1, s2 s2-hook, s3 s3-a2, s4 s4-a2, s5 s5-h4, s6 s6-sa3 / s6-ra3,
// s7 s7-n6 / s7-sp1), which every route below already does: no extra steps.
export const ROUTES = {
  s1: [
    { a: 't1' },
    { p: 's1-sill' },
    { a: 't2' },
    { p: 's2-landing', mode: 'lower', at: [7, -6] },
  ],
  s2: [
    { a: 's2-hook', walk: [3.6, -4] },
    { p: 's2-far', at: [-28, -5] },
    { a: 's2-lower', walk: [-28, 0] },
    { p: 's2-low', mode: 'lower', at: [-28, 7] },
    { a: 's2-b1' },
    { p: 's2-pier-w', ok: ['s2-pier-n', 's2-pier-s', 's2-pier-e'], at: [2, 0] },
    { a: 's2-x' },
    { p: 's3-landing', mode: 'lower', at: [6.5, 0] },
  ],
  s3: [
    { a: 's3-a1' },
    { p: ['s3-span1', 's3-span1-ab'], at: [-7, 0] },
    { a: 's3-a2' },
    { p: 's3-span2', at: [-20, 0] },
    { a: 's3-a3' },
    { p: 's3-span3', at: [-32.5, 0] },
    { a: 's3-lower' },
    { p: 's3-shelf', mode: 'lower', at: [-29, -8] },
    { a: 's3-b1' },
    { p: 's4-landing', at: [-2, 5] },
  ],
  s4: [
    { a: 's4-a1' },
    { p: 's4-catwalk', at: [-16, -14] },
    { a: 's4-a2' },
    { p: ['s4-cradle', 's4-cradle-ab'], mode: 'lower', at: [-28, -5] },
    { a: 's4-a3' },
    { p: 's4-shelf', at: [5, -7] },
    { a: 's4-a4' },
    { p: 's4-plinth', at: [-16, 6] },
    { a: 's4-a5' },
    { p: 's5-landing', mode: 'lower', at: [-6, -1] },
  ],
  // The Gullet Stair is rappelled: each step is 8 m below the last, and a free fall onto it lands at ~14 m/s (fall damage
  // ~60 hp a step, health3d.js), so the bot lowers itself on the hook above each step ('lower', ~2 s slower, no damage).
  s5: [
    { a: 's5-h1' },
    { p: 's5-step1', mode: 'lower', at: [-15, -6.5] },
    { a: 's5-h2' },
    { p: ['s5-step2', 's5-step2-nm'], mode: 'lower', at: [-18.5, 3] },
    { a: 's5-h3' },
    { p: 's5-step3', mode: 'lower', at: [-8.5, 6.5] },
    { a: 's5-h4' },
    { p: 's5-step4', mode: 'lower', at: [-5.5, -3] },
    { a: 's5-h5' },
    { p: 's5-step5', mode: 'lower', at: [-15, -6.5] },
    { a: 's5-h6' },
    { p: 's5-step6', mode: 'lower', at: [-18.5, 3] },
    { a: 's5-h7' },
    { p: 's6-fork', at: [-12, 0] },
  ],
  s6: [
    { a: 's6-ra1', from: [-4.6, -4] },
    { a: 's6-ra2', mode: 'below', below: 0.6 },
    { p: 's6-ledge', at: [1.6, -4] },
    { a: 's6-ra3', mode: 'below', walk: [-1.5, -4], below: 0.5 },
    { a: 's6-ra4', mode: 'below' },
    { a: 's6-ra5', mode: 'below' },
    { p: 's7-landing', mode: 'lower', at: [-2, -2] },
  ],
  s6safe: [
    { a: 's6-sa1' },
    { p: 's6-safe1', mode: 'lower', at: [-24, -6] },
    { a: 's6-sa2' },
    { p: 's6-safe2', mode: 'lower', at: [-27, 5] },
    { a: 's6-sa3' },
    { p: 's6-safe3', mode: 'lower', at: [-27, -5] },
    { a: 's6-sa4' },
    { p: 's6-safe4', mode: 'lower', at: [-27, 5] },
    { a: 's6-sa5' },
    { p: 's6-safe5', mode: 'lower', at: [-27, -5] },
    { a: 's6-sa6' },
    { p: 's7-landing', mode: 'lower', at: [-27, 5] },
  ],
  s7: [
    { a: 's7-n1', walk: [-6, -10] },
    { a: 's7-n2' },
    { a: 's7-n3' },
    { a: 's7-n4' },
    { a: 's7-n5' },
    { a: 's7-n6' },
    { a: 's7-n7' },
    { a: 's7-n8' },
    { a: 's7-n9' },
    { a: 's7-n10' },
    { a: 's7-n11' },
    { p: 's8-landing', mode: 'lower', at: [6, -15] },
  ],
  s8: [
    { a: 's8-e1' },
    { a: 's8-e2' },
    { a: 's8-e3' },
    { a: 's8-e4' },
    { a: 's8-e5' },
    { a: 's8-e6' },
    { p: 's8-floor', mode: 'lower', at: [-2, 0] },
    { goal: true, at: [-3, 20] },
  ],
};

export const SECTION_ROUTE = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

// Alternate lines (not part of the intended route) that must also work.
export const ALT_ROUTES = {
  // S7: through the middle of the nave via the spire's face rings.
  s7spire: [
    { a: 's7-n1', walk: [-6, -10] },
    { a: 's7-n2' },
    { a: 's7-n3' },
    { a: 's7-n4' },
    { a: 's7-n5' },
    { a: 's7-sp1' },
    { a: 's7-n7' },
    { a: 's7-n8' },
    { a: 's7-sp2' },
    { a: 's7-n10' },
    { a: 's7-n11' },
    { p: 's8-landing', mode: 'lower', at: [6, -15] },
  ],
  // S8: the wall ring instead of the last chain ring.
  s8wall: [
    { a: 's8-e1' },
    { a: 's8-e2' },
    { a: 's8-e3' },
    { a: 's8-e4' },
    { a: 's8-e5' },
    { a: 's8-w1' },
    { p: 's8-floor', mode: 'lower', at: [-8, 2] },
    { goal: true, at: [-3, 20] },
  ],
};

/** Section index each route starts from (its checkpoint). */
export const ROUTE_START = { s1: 0, s2: 1, s3: 2, s4: 3, s5: 4, s6: 5, s6safe: 5, s7: 6, s8: 7 };
export const ALT_START = { s7spire: 6, s8wall: 7 };

const ALL_VARIANTS = ['normal', 'nightmare', 'abyss'];

/**
 * Recovery scenarios: a deliberate mistake the level must forgive. `start(level)`
 * gives the spawn point, `variants` where the recovery anchors exist. `doneThrough` (optional): the seals of the sections
 * above this index are open at the start (default: the start's own section, LEVEL_FUN_PLAN P1).
 */
export const SCENARIOS = {
  // S2: a short release from the long swing, caught by the recovery ring, then
  // the hall floor and the opening (Normal / Nightmare: Abyss has no catch ring).
  s2catch: {
    variants: ['normal', 'nightmare'],
    start: (L) => L.sections[1].checkpoint,
    route: [
      { a: 's2-hook', walk: [3.6, -4] },
      { wait: 1.05, toward: [-28, -5], release: true },
      { a: 's2-catch', mode: 'asap' },
      { p: 's2-floor-a', mode: 'lower', at: [-19.25, -3] },
      { w: [-23.5, 1.5] },
      { a: 's2-lower' },
      { p: 's2-low', mode: 'lower', at: [-28, 7] },
    ],
  },
  // S3: the SPEC §29 design test — swing, release too early, miss the narrow
  // last span, fire at the lone ring below, survive, continue.
  s3designTest: {
    variants: ALL_VARIANTS,
    start: () => ({ x: -18.5, y: -73.62, z: 0 }),
    doneThrough: 3, // it starts on span 2, past the S3 seal's ring (s3-a2): the S3 seal is open

    route: [
      { a: 's3-a3' },
      { wait: 0.75, toward: [-32.5, 0], release: true },
      { a: ['s3-save', 's3-save-nm'], mode: 'below', below: 0.8 },
      { p: 's3-shelf', mode: 'lower', at: [-27, -4] },
      { a: 's3-b1' },
      { p: 's4-landing', at: [-2, 5] },
    ],
  },
  // S7: let go without chaining (a missed ring); the spiral below catches you.
  s7miss: {
    variants: ['normal', 'nightmare'],
    start: (L) => L.sections[6].checkpoint,
    route: [
      { a: 's7-n1', walk: [-6, -10] },
      { a: 's7-n2' },
      { a: 's7-n3' },
      { a: 's7-n4' },
      // swing toward n5 but let go of n4 without firing at it (a whiffed chain)
      { wait: 6, toward: [0, 22], release: true, untilNear: ['s7-n5', 11] },
      { a: 's7-n5', mode: 'asap' },
      { a: 's7-n6' },
      { a: 's7-n7' },
      { a: 's7-n8' },
      { a: 's7-n9' },
      { a: 's7-n10' },
      { a: 's7-n11' },
      { p: 's8-landing', mode: 'lower', at: [6, -15] },
    ],
  },
};

/**
 * The route fork: the full run is played once per line, and the risky line (from the
 * fork's checkpoint) must beat the safe one by `fasterBy` (CHAPTERS S6: ~50 % faster).
 */
export const FORK = { key: 's6', risky: 's6', safe: 's6safe', fasterBy: 0.25 };
