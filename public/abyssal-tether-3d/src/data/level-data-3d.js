/* ABYSSAL TETHER 3D — level-data-3d.js
 * LEVEL_DATA_3D: the full-3D descent through the Underspire — the inverted
 * cathedral-machine the Lanternwrights built DOWNWARD toward the Still Lamp,
 * since grown through by something living. Pure data (plus local builder
 * helpers); Level3D turns it into a playable, variant-filtered level.
 *
 * Conventions (CONTRACT3D §3)
 *  - Metres, +Y up. Spawn stands at y ≈ 0; the Still Lamp waits at y ≈ −556.
 *  - Boxes are authored as {minX,minY,minZ,maxX,maxY,maxZ}.
 *  - Yaw: rotation about +Y; yaw 0 faces −Z (three.js camera default), the
 *    facing direction is (−sin yaw, 0, −cos yaw). π/2 faces −X (west).
 *  - Sections run top → bottom (yTop > yBottom), contiguous.
 *  - Hints / triggers fire once when the player's body first drops below
 *    `y` (same rule as the 2D game). Hints: `text` is the VR wording,
 *    `desktop` the mouse/keyboard wording, `duration` seconds.
 *  - creature.spawnOffsetY: metres ABOVE the player where the predator is
 *    placed when the section starts (it comes down after you).
 *  - Anchors sit 0.25 m off the surface they are bolted to; `normal` is that
 *    surface's outward normal ((0,−1,0) = hanging under a beam / ceiling).
 *    `mount: 'chain'` = hanging from a giant chain (a decor 'chain' is placed
 *    above it) rather than from a solid.
 *
 *  - section.shaft = inner faces {minX,maxX,minZ,maxZ} of that section's shaft
 *    (Level3D.shaftAt(y)); the Vault (S4) and the Outer Dark beyond the S1 /
 *    S2 windows lie outside it. lights[] may carry `far` (a big, distant cold
 *    source) or `still` (the Still Lamp).
 *
 * Scale (Normal): lethal free fall ≈ 10.7 m (Nightmare 8.9, Abyss 7.8),
 * grapple range 32 m (29 / 27), max rope 36 m (33 / 31). Every main-route
 * descent is a rope you lower yourself on (≤ 30 m, within Abyss reach), a
 * chain onto a lower anchor, a fall arrested by a ring (S6 east), or a
 * swing-release onto a ledge that lands below 0.85 × lethal. Ledges step DOWN
 * from the take-off so the natural arc (rope = the distance you fired from)
 * comes down onto them without reeling. All of it is verified for every
 * variant by the level agent's simulation harness (real Physics3D +
 * TetherSystem, a waypoint bot aiming body→anchor rays).
 *
 * Variants: `omitIn` / `onlyIn` lists ('normal' | 'nightmare' | 'abyss';
 * Sandbox uses 'normal'). Recovery anchors: Normal 6, Nightmare 3 (the S3
 * save ring becomes fragile), Abyss 1 (that fragile ring). Nightmare crumbles
 * the S2 safety span and the S5 west ledge and bolts rebar into the Gullet
 * walls and under the S6 ledge; Abyss also crumbles the first gallery span
 * and the Vault cradle, removes the S2 span, and adds spikes and blades.
 *
 * Decor types (renderer draws the ones it knows, skips the rest). Every item
 * is {type, x,y,z (centre), sx,sy,sz, yaw}: sx/sy/sz are the WORLD-axis
 * extents of its bounding box, yaw is the direction its front faces (yaw 0
 * faces −Z, a plaque's text side / a statue's face). So a plaque on a west
 * wall facing east is (sx 0.15, sy 0.9, sz 3.6, yaw −π/2). Decor never
 * collides with the player:
 *   'chain'          giant hanging chain (sy = length); props: link (m)
 *   'arch'           monumental arch / doorway frame
 *   'statue'         a Lanternwright statue (robed, lantern raised); faces yaw
 *   'machinery'      winch / gear / counterweight housing
 *   'cage'           hanging iron cage
 *   'plaque'         carved text plate on a wall; props: text; faces yaw
 *   'lamp'           a work lamp fixture; props: lit (bool), flicker 0..1
 *   'still-lamp'     the Still Lamp itself (final chamber)
 *   'pipe'           pipe bundle (long axis = the largest size)
 *   'ribs'           organic ribs grown through the masonry (the predator's work)
 *   'glyphs'         carved glyph band on a wall; faces yaw
 *   'far-structure'  colossal silhouette beyond the shaft (variant: 'tower' |
 *                    'spire' | 'statue' | 'bridge' | 'arch'); seen through fog
 *   'shaft-light'    cold light falling through the dark (volumetric fake); props: color
 *   'girder'         non-colliding iron girder
 *   'cables'         sagging cable bundle from (x,y,z) to (x2,y2,z2)
 *   'bones'          mineral bones half-sunk in stone
 *   'grate'          the gate grate (visual of the gate box)
 *
 * DOM-free, three.js-free: importable from Node.
 */

const solids = [];
const hazards = [];
const anchors = [];
const decor = [];
const lights = [];

const NM = ['nightmare', 'abyss']; // "Nightmare and harder"
const AB = ['abyss'];
const NMO = ['nightmare']; // Nightmare only

const DOWN = { x: 0, y: -1, z: 0 };
const PI = Math.PI;
const WALL_T = 3;

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------
function box(list, id, x0, y0, z0, x1, y1, z1, kind, extra) {
  const o = Object.assign(
    { minX: Math.min(x0, x1), minY: Math.min(y0, y1), minZ: Math.min(z0, z1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1), maxZ: Math.max(z0, z1), kind },
    extra,
  );
  if (id) o.id = id;
  list.push(o);
  return o;
}
/** Solid (x0,x1 · y0,y1 · z0,z1 — note the axis-pair order). */
function S(id, x0, x1, y0, y1, z0, z1, kind = 'stone', extra) {
  return box(solids, id, x0, y0, z0, x1, y1, z1, kind, extra);
}
function H(id, x0, x1, y0, y1, z0, z1, kind = 'rebar', extra) {
  return box(hazards, id, x0, y0, z0, x1, y1, z1, kind, extra);
}
/** Anchor; `normal` defaults to hanging (0,−1,0). */
function A(id, x, y, z, kind = 'ring', tag = 'route', extra) {
  const o = Object.assign({ id, x, y, z, kind, tag, normal: DOWN }, extra);
  anchors.push(o);
  return o;
}
/** Anchor hanging 0.25 m under a solid's bottom face at (x, z). */
function under(id, s, x, z, kind = 'ring', tag = 'route', extra) {
  return A(id, x, s.minY - 0.25, z, kind, tag, extra);
}
/** Height of the first solid face above (x, y, z) among the solids built so far (sections are built top-down). */
function ceilingAbove(x, y, z, maxRise) {
  let best = y + maxRise;
  for (const o of solids) {
    if (x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ) continue;
    if (o.minY > y && o.minY < best) best = o.minY;
  }
  return best;
}
/**
 * Ring hanging from a giant chain (decor) that rises to the first solid
 * above it, or `len` metres into the dark.
 */
function chainRing(id, x, y, z, len, kind = 'ring', tag = 'route', extra) {
  const top = ceilingAbove(x, y, z, len);
  const l = top - (y + 0.3);
  dec('chain', x, y + 0.3 + l / 2, z, 0.5, l, 0.5, 0, { link: 0.9 });
  return A(id, x, y, z, kind, tag, Object.assign({ mount: 'chain' }, extra));
}
function dec(type, x, y, z, sx, sy, sz, yaw = 0, props) {
  const o = Object.assign({ type, x, y, z, sx, sy, sz, yaw }, props);
  decor.push(o);
  return o;
}
function light(x, y, z, color, intensity, range, flicker = 0, extra) {
  lights.push(Object.assign({ x, y, z, color, intensity, range, flicker }, extra));
}

/**
 * Four walls around the inner rectangle [x0,x1]×[z0,z1] from y0 (bottom) to
 * y1 (top). `open` = { n|s|e|w: {a0, a1, y0, y1} } cuts one opening per side
 * (a0..a1 runs along the wall: x for n/s, z for e/w).
 */
function walls(prefix, x0, x1, z0, z1, y0, y1, open = {}, extra) {
  const T = WALL_T;
  const sides = {
    n: { ax: 'x', a0: x0 - T, a1: x1 + T, c0: z0 - T, c1: z0 },
    s: { ax: 'x', a0: x0 - T, a1: x1 + T, c0: z1, c1: z1 + T },
    w: { ax: 'z', a0: z0, a1: z1, c0: x0 - T, c1: x0 },
    e: { ax: 'z', a0: z0, a1: z1, c0: x1, c1: x1 + T },
  };
  for (const key of Object.keys(sides)) {
    const sd = sides[key];
    const mk = (suffix, a0, a1, b0, b1) => {
      if (a1 - a0 < 0.01 || b1 - b0 < 0.01) return;
      const id = `${prefix}-${key}${suffix}`;
      if (sd.ax === 'x') S(id, a0, a1, b0, b1, sd.c0, sd.c1, 'wall', extra);
      else S(id, sd.c0, sd.c1, b0, b1, a0, a1, 'wall', extra);
    };
    const op = open[key];
    if (!op) {
      mk('', sd.a0, sd.a1, y0, y1);
      continue;
    }
    mk('1', sd.a0, op.a0, y0, y1);
    mk('2', op.a1, sd.a1, y0, y1);
    mk('3', op.a0, op.a1, y0, op.y0);
    mk('4', op.a0, op.a1, op.y1, y1);
  }
}

/** Horizontal slab over [x0,x1]×[z0,z1] (y0..y1) with one rectangular hole. */
function slabHole(prefix, x0, x1, z0, z1, y0, y1, hole, kind = 'wall', extra) {
  if (!hole) {
    S(prefix, x0, x1, y0, y1, z0, z1, kind, extra);
    return;
  }
  const [hx0, hx1, hz0, hz1] = hole;
  const parts = [
    ['w', x0, hx0, z0, z1],
    ['e', hx1, x1, z0, z1],
    ['n', hx0, hx1, z0, hz0],
    ['s', hx0, hx1, hz1, z1],
  ];
  for (const [k, a, b, c, d] of parts) {
    if (b - a > 0.01 && d - c > 0.01) S(`${prefix}-${k}`, a, b, y0, y1, c, d, kind, extra);
  }
}

// =============================================================================
// S1 — THE THRESHOLD (y 40 → −8) · "Where the line is learned"
//  READ       You stand on the Threshold, a ledge inside a 22 m chimney under
//             a carved arch. One pale ring hangs under an iron girder ahead
//             and above; across an 8 m gap, 5 m lower, waits the sill. To the
//             right a well drops into the dark; through a window in the east
//             wall, the Outer Dark and something colossal standing in it.
//  CHOICE     Fire from where you stand, or walk to the lip first.
//  COMMIT     The first swing: hold the trigger, step off, push the stick —
//             the arc comes down onto the sill whether you let go or not.
//  RISK       None that kills: the pocket floor (8 m down, under the gap)
//             catches an early release; parapets keep tutorial feet out of
//             the well.
//  RECOVERY   From the pocket, fire at the same ring and reel in.
//  REWARD     The well: a second ring under the well beam lets you lower
//             yourself 24 m into the dark — the descent begins.
//  ESCALATION The well opens into the ceiling of S2's hall.
// =============================================================================
walls('s1-wall', -11, 11, -11, 11, -6, 60, { e: { a0: -6, a1: 6, y0: 8, y1: 30 } }); // east window onto the Outer Dark
S('s1-threshold', -11, 3, -3, 0, 4, 11);
S('s1-parapet-a', 3, 3.8, 0, 1.3, 4, 11, 'stone', { tag: 'parapet' });
S('s1-pocket', -11, 3, -11, -8, -4, 4);
S('s1-parapet-b', 3, 3.8, -8, -6.7, -4, 4, 'stone', { tag: 'parapet' });
S('s1-sill', -11, 3, -8, -5, -11, -4); // 5 m below the Threshold: the first arc comes down onto it
const s1Girder = S('s1-girder', -11, 11, 7, 7.8, -1.4, -0.6, 'metal');
const s1WellBeam = S('s1-wellbeam', 6.6, 7.4, 3, 3.8, -11, 11, 'metal');
under('t1', s1Girder, -4, -1, 'ring', 'tutorial');
under('t2', s1WellBeam, 7, -6, 'ring', 'tutorial');

dec('arch', -4, 5, 10.5, 12, 10, 1.2, 0); // the Threshold arch on the south wall, over the spawn
dec('statue', -9.5, 3.2, 9.5, 2.2, 6.4, 2.2, -PI / 4); // Lanternwrights flanking the Threshold, facing the chimney
dec('statue', 1.5, 3.2, 9.5, 2.2, 6.4, 2.2, PI / 4);
dec('plaque', -4, 2.2, 10.85, 3.6, 0.9, 0.15, 0, { text: 'HERE THE DESCENT BEGINS. TRUST THE RING, NOT THE FLOOR.' });
dec('lamp', -9.9, 1.8, 6, 0.4, 0.8, 0.4, -PI / 2, { lit: true, flicker: 0.35 });
dec('chain', 9, 14, 6, 0.6, 30, 0.6, 0, { link: 1 });
dec('chain', 4.5, 22, -9, 0.6, 26, 0.6, 0, { link: 1 });
dec('girder', 0, 26, 0, 22, 1, 1, PI / 4);
dec('glyphs', -10.9, -3.5, -7.5, 0.1, 1.2, 6, -PI / 2);
dec('far-structure', 75, 20, 0, 24, 90, 40, 0, { variant: 'arch' }); // seen through the east window
dec('far-structure', 60, -10, 45, 14, 120, 14, 0, { variant: 'tower' });
dec('shaft-light', 2, 25, 2, 6, 40, 6, 0, { color: '#6fa3b5' });
light(-9.6, 1.8, 6, '#e0a050', 0.9, 9, 0.35);
// The sill sits 5 m below the lip: a lit lamp and a tall Lanternwright on it
// show the landing from the spawn before you can see its floor.
dec('statue', -9, -1.8, -9.5, 2.2, 6.4, 2.2, PI);
dec('lamp', -2, -3.2, -10.8, 0.4, 0.8, 0.4, PI, { lit: true, flicker: 0.2 });
light(-2, -3.2, -10.4, '#e0a050', 0.7, 10, 0.2);

// =============================================================================
// S2 — THE LONG SWING (y −8 → −58) · "Momentum is a promise"
//  READ       Lowered out of the well onto a landing in the corner of a long
//             hall (45 × 22 m). A hook is bolted under the Threshold's floor;
//             the far pier waits 25 m away at the hall's end, a colossal
//             Lanternwright beside it and a window onto the Outer Dark.
//  CHOICE     Run-up or standing start; how long to pump; when to let go.
//  COMMIT     Run, fire at the hook, swing the long arc and release on the
//             upswing — the pier is only reachable with that momentum.
//  RISK       A short release drops ~13 m onto the hall floor.
//  RECOVERY   A ring on a chain mid-hall catches a short release (Normal /
//             Nightmare); lower to the floor and walk to the opening.
//  REWARD     From the pier, a ring on a wall arm lowers you through the floor
//             opening into the lower hall.
//  ESCALATION Lower hall: one more long pendulum under the floor to the east
//             pier, with the void of the Broken Gallery under you (Nightmare:
//             the safety span crumbles; Abyss: it is gone).
// =============================================================================
walls('s2-wall', -34, 11, -11, 11, -58, -6, { w: { a0: -7, a1: 7, y0: -23, y1: -12 } }); // west window behind the far pier
S('s2-ceiling', -34, -11, -11, -8, -11, 11, 'wall', { tag: 'ceiling' });
S('s2-landing', 3, 11, -25, -22, -11, -1);
A('s2-hook', -4, -11.25, 0, 'hook', 'route'); // under the S1 pocket floor
S('s2-far', -34, -22, -28, -25, -11, 1);
// Recovery: a ring on a chain mid-hall beside the swing line, 14 m above the
// floor — high enough that a short release caught here swings clear of it.
chainRing('s2-catch', -14, -21, -1, 20, 'ring', 'recovery', { omitIn: AB });
const s2FloorA = S('s2-floor-a', -22, 11, -38, -35, -11, 11, 'wall', { tag: 'floor' });
S('s2-floor-b', -34, -22, -38, -35, -11, 3, 'wall', { tag: 'floor' });
const s2Arm = S('s2-arm', -34, -27, -17.5, -16.5, 6.4, 7.6, 'metal');
under('s2-lower', s2Arm, -28, 7, 'ring', 'route');
S('s2-low', -34, -24, -47, -44, -11, 11);
H('s2-spikes-ab', -34, -31.5, -44, -43.5, -11, 11, 'spikes', { onlyIn: AB, normal: { x: 0, y: 1, z: 0 } }); // Abyss: the far end bristles
under('s2-b1', s2FloorA, -12, 0, 'ring', 'route');
under('s2-b2', s2FloorA, -2, -6, 'ring', 'shortcut');
S('s2-span', -18, -6, -57, -56, -3, 3, 'bridge', { omitIn: NM });
S('s2-span-nm', -18, -6, -57, -56, -3, 3, 'crumble', { onlyIn: NMO });
slabHole('s2-pier', 0, 11, -11, 11, -54, -51, [4, 9, -3, 3], 'stone');
under('s2-x', s2FloorA, 6.5, 0, 'ring', 'route'); // lowers you through the pier's well

dec('far-structure', -95, -40, 8, 26, 110, 26, 0, { variant: 'statue' }); // a colossal Lanternwright outside the west window
dec('far-structure', -70, -60, -40, 16, 90, 16, 0, { variant: 'tower' });
dec('statue', -28, -15.5, -9.5, 3.5, 19, 3.5, -PI / 2); // a colossal Lanternwright on the far pier
dec('cables', 10, -12, -10, 1, 1, 1, 0, { x2: -33, y2: -20, z2: -10 });
dec('plaque', -33.9, -24, -9, 0.15, 0.9, 3.6, -PI / 2, { text: 'THE LAMP DOES NOT RISE TO MEET US. WE GO DOWN TO IT.' });
dec('arch', -11.5, -20, -10.6, 16, 18, 1.2, PI);
dec('arch', -11.5, -20, 10.6, 16, 18, 1.2, 0);
dec('chain', -15, -22, 6, 0.6, 26, 0.6, 0, { link: 1 });
dec('lamp', -33.6, -23.5, -9, 0.4, 0.8, 0.4, -PI / 2, { lit: true, flicker: 0.6 });
dec('machinery', 9, -45, 9, 3, 5, 3, 0);
dec('pipe', -33.4, -26, 9, 0.8, 34, 0.8, 0);
dec('glyphs', 10.9, -42, 0, 0.1, 1.5, 12, PI / 2);
dec('girder', -19.25, -31, 0, 1.5, 1, 22, 0); // a snapped beam across the hall
light(-33, -23.5, -9, '#e0a050', 1.0, 12, 0.6);

// The Outer Dark beyond the S1 / S2 windows: nothing but fog, and far below,
// rubble floors that end any fall through a window.
S('outer-floor-e', 14, 64, -83, -80, -11, 50, 'wall', { tag: 'floor' });
S('outer-floor-w', -87, -37, -103, -100, -11, 50, 'wall', { tag: 'floor' });
light(7, -21, -6, '#6fa3b5', 0.5, 10, 0);

// =============================================================================
// S3 — BROKEN GALLERY (y −58 → −98) · "Every fall is a question"
//  READ       Under the east pier: the gallery — three broken spans stepping
//             down the hall, girders overhead with a ring over every gap. The
//             last span is narrow, against the far wall; below it, in the
//             dark, a lone ring on a long chain.
//  CHOICE     Take the spans one by one, or chain the rings and skip one.
//  COMMIT     Swing beneath the girders and release toward the narrow last
//             span (the SPEC §29 design test lives here).
//  RISK       The last span is easy to over/undershoot; missing it is a long,
//             lethal fall to the shelf far below.
//  RECOVERY   Fire at the lone ring as it passes above you (Normal: solid;
//             Nightmare / Abyss: fragile — it holds just long enough to kill
//             the fall, 6 m above the shelf) and drop or lower onto the shelf.
//  REWARD     A wall arm by the last span lowers you onto the shelf; one
//             pendulum carries you east over the dark to S4's landing.
//  ESCALATION Abyss: the first span crumbles under you.
// =============================================================================
walls('s3-wall', -34, 11, -11, 11, -98, -58);
S('s3-landing', 3, 11, -69, -66, -11, 11);
const g1 = S('s3-g1', -2, -0.5, -61, -60, -11, 11, 'metal');
const g2 = S('s3-g2', -15, -13.5, -61, -60, -11, 11, 'metal');
const g3 = S('s3-g3', -27, -25.5, -61, -60, -11, 11, 'metal');
under('s3-a1', g1, -1.25, 0, 'ring', 'route');
under('s3-a2', g2, -14.25, 0, 'ring', 'route');
under('s3-a3', g3, -26.25, 0, 'ring', 'route');
// The spans step down (−71.5, −74, −75.5) so each arc comes down onto the next.
S('s3-span1', -10, -4, -72.5, -71.5, -3, 3, 'bridge', { omitIn: AB });
S('s3-span1-ab', -10, -4, -72.5, -71.5, -3, 3, 'crumble', { onlyIn: AB });
S('s3-span2', -23, -17, -75, -74, -3, 3, 'bridge');
S('s3-span3', -34, -31, -76.5, -75.5, -2, 2, 'bridge'); // narrow — easy to miss
// The lone ring in the dark below the last span, on a chain from the girder above.
chainRing('s3-save', -27, -90, -3, 30, 'ring', 'recovery', { omitIn: NM });
chainRing('s3-save-nm', -27, -90, -3, 30, 'fragile', 'recovery', { onlyIn: NM });
const s3Arm = S('s3-arm', -34, -28.5, -73.6, -72.6, -8.6, -7.4, 'metal');
under('s3-lower', s3Arm, -29, -8, 'ring', 'route');
// Head clearance (1:1 height, head 1.24 m over the body): the b1 pendulum's west swing passes under the shelf's east lip,
// so the lip is cut back to x -26 (was -24; the ring above still drops you onto it). A body swinging under an overhang needs 1.6 m of headroom, so this only just clears the bot's pump arc (tools/abyssal-tether-3d/verify/headclear.mjs): re-run it after any physics change.
S('s3-shelf', -34, -26, -99, -96, -11, 1);
const g5 = S('s3-g5', -21, -19.5, -91, -90, -11, 11, 'metal');
under('s3-b1', g5, -20.25, -6, 'ring', 'route');

dec('ribs', -33.7, -86, 6, 0.6, 22, 10, -PI / 2);
dec('bones', 10, -62, 9, 3, 2, 3, 0.4);
dec('plaque', 10.85, -64.5, -6, 0.15, 0.9, 3.6, PI / 2, { text: 'NINTH GALLERY — CLOSED. THE STONE HAS BEEN LISTENING.' });
dec('cage', -8, -77, 7, 2, 3, 2, 0);
dec('chain', -8, -68, 7, 0.4, 15, 0.4, 0, { link: 0.7 });
dec('glyphs', -33.9, -88, -6, 0.1, 2, 10, -PI / 2);
dec('pipe', 10.6, -80, -10.4, 0.8, 40, 0.8, 0);
dec('arch', -12, -75, 10.6, 20, 14, 1.2, 0);
dec('shaft-light', -16, -78, 0, 5, 40, 5, 0, { color: '#7c9a9c' });
light(-16, -64, 0, '#7c9a9c', 0.6, 16, 0);

// =============================================================================
// S4 — THE LISTENING VAULT (y −98 → −150) · "Something answered"
//  READ       The hall's north wall falls away: beyond it the Vault, a void
//             190 m across, far lit by cold shafts. A metal catwalk runs out
//             over the drop.
//  CHOICE     Linger on the catwalk and look — or keep moving.
//  COMMIT     Swing out to the catwalk (the sighting fires there: something
//             vast crosses the Vault's far wall — no attack), then a zig-zag
//             of rings on chains: lower onto the hanging cradle → swing to the
//             east shelf → swing to the plinth.
//  RISK       Falls through the window end on the Vault floor, 175 m down.
//  RECOVERY   A ring under the shelf hop (Normal only).
//  REWARD     The plinth, and a ring that lowers you into the Gullet.
//  ESCALATION Abyss: the cradle's chains give way under your weight.
// =============================================================================
// The window's lintel starts at -100.5 (was -102): a body flying out of the window at the section start puts its head 1.24 m higher.
walls('s4-wall', -34, 11, -11, 11, -150, -98, { n: { a0: -30, a1: 7, y0: -146, y1: -100.5 } });
// The Vault: an immense room north of the hall (its south wall is the hall's).
walls('vault-wall', -110, 80, -160, -14, -280, -60, { s: { a0: -40, a1: 17, y0: -280, y1: -60 } });
S('vault-floor', -113, 83, -283, -280, -163, -11, 'wall', { tag: 'floor' });
S('vault-ceiling', -113, 83, -63, -60, -163, -14, 'wall', { tag: 'ceiling' });
S('s4-landing', -8, 11, -103, -100, 0, 11);
const s4G1 = S('s4-g1', -14, 11, -90, -89, -3.6, -2.4, 'metal'); // cantilever from the east wall
under('s4-a1', s4G1, -9, -3, 'ring', 'route');
S('s4-catwalk', -20, -12, -106, -105, -24, -6, 'metal');
S('s4-rail-w', -20, -19.7, -105, -104, -24, -6, 'metal', { tag: 'rail' });
S('s4-rail-e', -12.3, -12, -105, -104, -24, -6, 'metal', { tag: 'rail' });
chainRing('s4-a2', -28, -101, -5, 38); // right over the hanging cradle
S('s4-cradle', -32, -24, -113, -112, -9, -1, 'metal', { omitIn: AB });
S('s4-cradle-ab', -32, -24, -113, -112, -9, -1, 'crumble', { onlyIn: AB });
dec('chain', -31.5, -105.5, -5, 0.4, 13, 0.4, 0, { link: 0.8 }); // the cradle hangs from the shelf above
dec('chain', -24.5, -105.5, -5, 0.4, 13, 0.4, 0, { link: 0.8 });
chainRing('s4-a3', -13, -104, -3, 45);
S('s4-shelf', 0, 11, -122, -119, -11, -3);
chainRing('s4-a4', -6, -113, 4, 52);
chainRing('s4-catch', -4, -128, -4, 67, 'ring', 'recovery', { omitIn: NM });
S('s4-plinth', -20, -12, -129, -126, 2, 10);
chainRing('s4-a5', -8, -124, -1, 63);

// The Vault's far side: colossal structures in the fog.
dec('far-structure', -60, -170, -150, 30, 220, 18, 0, { variant: 'spire' });
dec('far-structure', 40, -190, -145, 40, 180, 20, 0, { variant: 'statue' });
dec('far-structure', -10, -230, -120, 120, 14, 10, 0, { variant: 'bridge' });
dec('shaft-light', -30, -180, -110, 10, 240, 10, 0, { color: '#b8f0e0' });
dec('shaft-light', 50, -170, -80, 8, 220, 8, 0, { color: '#b8f0e0' });
dec('plaque', -16, -103.6, -5.5, 3.6, 0.9, 0.15, PI, { text: 'DO NOT ANSWER WHAT KNOCKS FROM INSIDE THE WALL.' });
dec('ribs', -40, -150, -15, 30, 50, 2, 0);
dec('machinery', 9, -108, -9, 3, 6, 3, 0);
dec('glyphs', 10.9, -112, 4, 0.1, 1.5, 12, PI / 2);
dec('lamp', 10.6, -98.4, 6, 0.4, 0.8, 0.4, PI / 2, { lit: true, flicker: 0.7 });
light(10.4, -98.4, 6, '#e0a050', 0.8, 10, 0.7);
light(-30, -150, -120, '#b8f0e0', 2.5, 90, 0, { far: true });

// =============================================================================
// S5 — THE GULLET STAIR (y −150 → −204) · "It has your scent"
//  READ       The shaft pinches into an 18 m throat. Ledges spiral down its
//             four walls, 8 m apart; a hook hangs from an iron arm between
//             every two.
//  CHOICE     Lower carefully on each hook, or swing-release straight onto
//             the next ledge (faster, harder).
//  COMMIT     Every ledge is a drop you cannot simply take (8 m).
//  RISK       The predator now hunts from above. Nightmare: rebar lines the
//             walls where a wide swing would brush them, and the west ledge
//             crumbles.
//  RECOVERY   One ring bolted to the south wall near the bottom (Normal only).
//             Abyss: spikes on the end of the south ledge.
//  REWARD     The fork platform of S6 below the last hook.
//  ESCALATION Faster, tighter swings than anything above.
// =============================================================================
// The hall's floor (all but the Gullet's mouth).
slabHole('s5-mouth', -37, 14, -14, 14, -153, -150, [-21, -3, -9, 9]);
walls('s5-wall', -21, -3, -9, 9, -204, -153);
S('s5-landing', -9, -3, -155, -152, -9, 9);
const a51 = S('s5-arm1', -12.6, -11.4, -151, -150, -9, -3, 'metal');
under('s5-h1', a51, -12, -3.5, 'hook');
S('s5-step1', -21, -10, -163, -160, -9, -4);
const a52 = S('s5-arm2', -21, -15, -157, -156, -0.6, 0.6, 'metal');
under('s5-h2', a52, -15.5, 0, 'hook');
S('s5-step2', -21, -16, -171, -168, -3, 9, 'stone', { omitIn: NM });
S('s5-step2-nm', -21, -16, -171, -168, -3, 9, 'crumble', { onlyIn: NM });
const a53 = S('s5-arm3', -12.6, -11.4, -165, -164, 3, 9, 'metal');
under('s5-h3', a53, -12, 3.5, 'hook');
S('s5-step3', -14, -3, -179, -176, 4, 9);
H('s5-spikes-ab', -14, -11.5, -176, -175.5, 4, 9, 'spikes', { onlyIn: AB, normal: { x: 0, y: 1, z: 0 } });
const a54 = S('s5-arm4', -9, -3, -173, -172, -0.6, 0.6, 'metal');
under('s5-h4', a54, -8.5, 0, 'hook');
S('s5-step4', -8, -3, -187, -184, -9, 3);
const a55 = S('s5-arm5', -12.6, -11.4, -181, -180, -9, -3, 'metal');
under('s5-h5', a55, -12, -3.5, 'hook');
S('s5-step5', -21, -10, -195, -192, -9, -4);
const a56 = S('s5-arm6', -21, -15, -189, -188, -0.6, 0.6, 'metal');
under('s5-h6', a56, -15.5, 0, 'hook');
S('s5-step6', -21, -16, -203, -200, -3, 9);
const a57 = S('s5-arm7', -12.6, -11.4, -197, -196, 3, 9, 'metal');
under('s5-h7', a57, -12, 3.5, 'hook');
// Recovery: a ring bolted to the south wall near the bottom (Normal only).
A('s5-catch', -12, -194, 8.75, 'ring', 'recovery', { omitIn: NM, normal: { x: 0, y: 0, z: -1 } });
// Nightmare+: rebar where a wide swing brushes the walls.
H('s5-rebar-e', -3.3, -3, -170, -160, -9, 9, 'rebar', { onlyIn: NM, normal: { x: -1, y: 0, z: 0 } });
H('s5-rebar-w', -21, -20.7, -192, -180, -9, 9, 'rebar', { onlyIn: NM, normal: { x: 1, y: 0, z: 0 } });

dec('ribs', -3.25, -168, -2, 0.5, 14, 12, PI / 2);
dec('ribs', -20.75, -182, -1, 0.5, 12, 8, -PI / 2);
dec('pipe', -20.4, -178, -8.4, 0.8, 50, 0.8, 0);
dec('pipe', -3.6, -192, 8.4, 0.8, 22, 0.8, 0);
dec('plaque', -3.15, -150.4, 6, 0.15, 0.9, 3.6, PI / 2, { text: 'THE MASONS WENT DOWN TO MEND THE DEEP COURSE. THE WALL MENDED ITSELF.' });
dec('glyphs', -12, -165, -8.9, 10, 1.2, 0.1, 0);
dec('cage', -7, -190, 6, 2, 3, 2, 0);
dec('shaft-light', -12, -180, 0, 4, 50, 4, 0, { color: '#7a3b22' });
light(-12, -160, 0, '#8a5a3c', 0.6, 14, 0.2);

// =============================================================================
// S6 — THE TWO DESCENTS (y −204 → −284) · "Slow and certain, or quick and thin"
//  READ       The Gullet opens onto a fork platform astride a dividing wall.
//             West: a stair of shelves, each with a sound ring. East: an open
//             drop with frayed (fragile) rings, a crumbling ledge and rebar.
//  CHOICE     The whole section IS the choice; plaques name both ways.
//  COMMIT     West: six lowerings, shelf to shelf (slow, safe). East: step
//             off and fall; fire at each frayed ring as it passes above you —
//             the rope kills the fall, then snaps (1.5 / 1.05 / 0.8 s) — touch
//             the crumbling ledge, fall again, and lower from the last (sound)
//             hook onto the nave landing.
//  RISK       East: snapped rings, the ledge giving way, rebar on the wall.
//  RECOVERY   West: every shelf is a rest stop. East: none.
//  REWARD     The east column is verified ~50 % faster — with the predator
//             hunting, time is the reward.
//  ESCALATION Nightmare / Abyss add rebar under the east ledge.
// =============================================================================
slabHole('s6-roof', -37, 13, -14, 14, -205, -202, [-21, -3, -9, 9]);
walls('s6-wall', -34, 10, -11, 11, -284, -205);
S('s6-fork', -20, -4, -211, -208, -6, 6);
S('s6-divider', -13, -11, -282, -211, -11, 11, 'wall', { tag: 'column' });
// West: the long stair (shelves alternate north / south; each one lowered onto).
chainRing('s6-sa1', -24, -207, -6, 4, 'ring', 'route');
S('s6-safe1', -34, -13, -221, -218, -11, -2);
const s6ArmA = S('s6-arm-a', -34, -26, -213, -212, 4.4, 5.6, 'metal');
under('s6-sa2', s6ArmA, -27, 5, 'ring');
S('s6-safe2', -34, -13, -233, -230, 2, 11);
const s6ArmB = S('s6-arm-b', -34, -26, -225, -224, -5.6, -4.4, 'metal');
under('s6-sa3', s6ArmB, -27, -5, 'ring');
S('s6-safe3', -34, -13, -245, -242, -11, -2);
const s6ArmC = S('s6-arm-c', -34, -26, -237, -236, 4.4, 5.6, 'metal');
under('s6-sa4', s6ArmC, -27, 5, 'ring');
S('s6-safe4', -34, -13, -257, -254, 2, 11);
const s6ArmD = S('s6-arm-d', -34, -26, -249, -248, -5.6, -4.4, 'metal');
under('s6-sa5', s6ArmD, -27, -5, 'ring');
S('s6-safe5', -34, -13, -269, -266, -11, -2);
const s6ArmE = S('s6-arm-e', -34, -26, -261, -260, 4.4, 5.6, 'metal');
under('s6-sa6', s6ArmE, -27, 5, 'ring');
// East: the throat — free fall, arrested on frayed rings that snap under load
// (attach one as it passes ABOVE you: the rope kills the fall, then gives).
// One crumbling ledge to touch on the way; the last hook is sound.
chainRing('s6-ra1', 1, -206.2, -4, 2, 'fragile', 'risk');
chainRing('s6-ra2', 2, -218, -4, 14, 'fragile', 'risk');
S('s6-ledge', 0, 9, -225.5, -224.5, -9, 1, 'crumble');
chainRing('s6-ra3', -2.6, -234, -4, 30, 'fragile', 'risk');
chainRing('s6-ra4', 2, -247, 2, 43, 'fragile', 'risk');
chainRing('s6-ra5', -2, -261, -2, 57, 'hook', 'risk'); // sound: lowers you onto the nave landing
H('s6-rebar-e', 9.7, 10, -254, -236, -11, 11, 'rebar', { normal: { x: -1, y: 0, z: 0 } });
H('s6-rebar-nm', 5.5, 8.5, -227, -226.5, -8.5, 0.5, 'rebar', { onlyIn: NM }); // under the ledge's far end

dec('plaque', -16, -206.4, -5.85, 3.2, 0.9, 0.15, PI, { text: 'THE LONG STAIR — FOR THE PATIENT' });
dec('plaque', -8, -206.4, -5.85, 3.2, 0.9, 0.15, PI, { text: 'THE THROAT — FOR THE LATE' });
dec('lamp', -19.6, -207, -5.6, 0.4, 0.8, 0.4, 0, { lit: true, flicker: 0.25 });
dec('lamp', -4.4, -207, -5.6, 0.4, 0.8, 0.4, 0, { lit: true, flicker: 0.6 });
dec('glyphs', -13.05, -240, 0, 0.1, 26, 16, PI / 2); // carved down the dividing wall, both faces
dec('glyphs', -10.95, -240, 0, 0.1, 26, 16, -PI / 2);
dec('chain', 8.6, -240, -10.4, 0.5, 60, 0.5, 0, { link: 0.8 });
dec('cables', 9.5, -230, -10, 1, 1, 1, 0, { x2: -10.5, y2: -238, z2: 10 });
dec('machinery', -32, -215, 9, 3, 5, 3, 0);
dec('ribs', 9.25, -268, 0, 1.5, 26, 18, PI / 2);
light(-19.4, -207, -5.4, '#e0a050', 0.8, 10, 0.25);
light(-4.6, -207, -5.4, '#9a4a2a', 0.8, 10, 0.6);

// =============================================================================
// S7 — THE HOLLOW NAVE (y −284 → −420) · "Nothing to stand on"
//  READ       The walls fall back 80 m: a nave of ribs and dark. From the
//             landing an inverted spire hangs 120 m into the void. Rings hang
//             on chains from a ceiling you cannot see, in a long spiral round
//             it; one iron perch halfway.
//  CHOICE     Chain ring to ring round the spiral, cut through the middle on
//             the rings bolted to the spire, or bail to the perch.
//  COMMIT     Each release is a leap of faith toward the next ring.
//  RISK       The predator is in frenzy; the floor is 130 m of nothing below.
//  RECOVERY   Whiff a chain and you can still fire at the ring you swung for
//             as you fall past it; two recovery rings hang under the spiral
//             (Normal: both; Nightmare: one; Abyss: none).
//  REWARD     The throat's landing at the bottom of the spiral.
//  ESCALATION Vertical panic: no platforms, constant bursts.
// =============================================================================
// The roof's hole runs 5 m past the landing's east edge: under the Two Descents'
// east wall (which hangs free above it) a 4 m mouth opens from the landing
// level down into the nave. It is the predator's way down from the shaft (its
// girth cannot pass the 1 m slit around the rest of the landing) and lies
// 22 m from the checkpoint, away from both S6 descents.
// Head clearance: the hole is 2 m wider than the landing on its west, north and south sides, so a standing head at the
// landing's edge never enters the 3 m slab (the landing's top is 1 m under the roof; a body at the lip has its head above it).
slabHole('s7-roof', -55, 31, -43, 43, -287, -284, [-36, 15, -13, 13]);
walls('s7-wall', -52, 28, -40, 40, -424, -287);
S('s7-landing', -34, 10, -291, -288, -11, 11);
// The inverted spire: the Lanternwrights' cathedral hangs from the landing into the nave.
S('s7-spire', -15, -9, -400, -291, -3, 3, 'pillar');
S('s7-spire-tip', -14, -10, -412, -400, -2, 2, 'pillar');
// Rings on the spire's faces: a line through the middle of the nave for those who dare it.
A('s7-sp1', -14, -341, 3.25, 'ring', 'shortcut', { normal: { x: 0, y: 0, z: 1 } }); // south face
A('s7-sp2', -12, -371, -3.25, 'ring', 'shortcut', { normal: { x: 0, y: 0, z: -1 } }); // north face
chainRing('s7-n1', -6, -291, -22, 4);
chainRing('s7-n2', 10, -305, -30, 19);
chainRing('s7-n3', 18, -316, -14, 30);
chainRing('s7-n4', 14, -326, 6, 40);
chainRing('s7-n5', 0, -336, 22, 50);
S('s7-perch', -24, -16, -350, -349, 22, 30, 'metal');
// Recovery rings under the spiral (Normal: both; Nightmare: one; Abyss: none).
chainRing('s7-r1', -9, -353, 18, 70, 'ring', 'recovery', { omitIn: NM });
chainRing('s7-r2', -13, -386, -27, 100, 'ring', 'recovery', { omitIn: AB });
dec('chain', -23.5, -318, 26, 0.4, 62, 0.4, 0, { link: 0.8 });
dec('chain', -16.5, -318, 26, 0.4, 62, 0.4, 0, { link: 0.8 });
chainRing('s7-n6', -18, -346, 12, 60);
chainRing('s7-n7', -30, -357, -6, 71);
chainRing('s7-n8', -22, -368, -24, 82);
chainRing('s7-n9', -4, -379, -30, 93);
chainRing('s7-n10', 10, -390, -16, 104);
chainRing('s7-n11', 6, -404, -15, 118);

dec('ribs', -51, -350, 0, 2, 120, 70, -PI / 2);
dec('ribs', 27, -350, 0, 2, 120, 70, PI / 2);
dec('arch', -12, -330, -39.7, 60, 70, 0.6, PI);
dec('arch', -12, -330, 39.7, 60, 70, 0.6, 0);
dec('statue', -46, -380, -34, 6, 34, 6, -PI * 0.75); // corner colossi facing the spire
dec('statue', 22, -380, 34, 6, 34, 6, PI / 4);
dec('bones', 20, -421, -30, 8, 4, 8, 0.7);
dec('cage', 22, -340, -32, 3, 4, 3, 0);
dec('chain', 22, -312, -32, 0.5, 52, 0.5, 0, { link: 0.9 });
dec('plaque', -51.85, -352, 26, 0.15, 0.9, 3.6, -PI / 2, { text: 'IT WEARS OUR WORK.' });
dec('shaft-light', 20, -350, -26, 8, 120, 8, 0, { color: '#b8f0e0' });
light(-12, -414, 0, '#b8f0e0', 1.6, 60, 0, { far: true }); // cold glow under the spire's tip

// =============================================================================
// S8 — THE LAST THROAT (y −420 → −562) · "Down. Now."
//  READ       The nave's floor opens into a throat whose walls step inward;
//             warm light leaks from far below.
//  CHOICE     None worth taking: the chain is short and the creature close.
//  COMMIT     Escape rings down the converging throat (or the ring on the
//             west wall), lower to the floor and sprint through the grate into
//             the Still Lamp's chamber.
//  RISK       Escape mode: relentless pursuit with bursts.
//  RECOVERY   Wall steps at each narrowing give a place to stand. Abyss:
//             blades along the east wall of the last stage.
//  REWARD     The chamber (goal) — the grate slams behind you.
//  ESCALATION The end.
// =============================================================================
S('s8-landing', -2, 18, -431, -428, -20, -10);
// Stage 1 (40 × 40), stage 2 (30 × 30), stage 3 (20 × 20); the steps between
// them are the "wall steps at the narrowing".
walls('s8-wall1', -22, 18, -20, 20, -470, -427);
slabHole('s8-step1', -25, 21, -23, 23, -473, -470, [-17, 13, -15, 15]);
walls('s8-wall2', -17, 13, -15, 15, -512, -473);
slabHole('s8-step2', -20, 16, -18, 18, -515, -512, [-12, 8, -10, 10]);
walls('s8-wall3', -12, 8, -10, 10, -562, -515, { s: { a0: -6, a1: 2, y0: -556, y1: -548 } });
slabHole('s7-floor', -55, 31, -43, 43, -427, -424, [-22, 18, -20, 20], 'wall', { tag: 'floor' }); // the throat's mouth
S('s8-floor', -15, 11, -562, -556, -13, 13, 'wall', { tag: 'floor' });
chainRing('s8-e1', -8, -434, -6, 140, 'ring', 'escape');
chainRing('s8-e2', -10, -446, 10, 152, 'ring', 'escape');
chainRing('s8-e3', 4, -460, 4, 166, 'ring', 'escape');
chainRing('s8-e4', -4, -480, -6, 186, 'ring', 'escape');
chainRing('s8-e5', 0, -500, 2, 206, 'ring', 'escape');
chainRing('s8-e6', -4, -526, -2, 232, 'ring', 'escape');
A('s8-w1', -11.75, -532, 4, 'ring', 'escape', { normal: { x: 1, y: 0, z: 0 } }); // on the throat's west wall: a second way down
H('s8-blades-ab', 7.4, 8, -540, -530, -10, 10, 'blades', { onlyIn: AB, normal: { x: -1, y: 0, z: 0 } });
// The Still Lamp's chamber, south of the throat's foot, behind the grate.
S('s8-chamber-floor', -12, 6, -562, -556, 10, 30, 'wall', { tag: 'floor' });
S('s8-chamber-w', -12, -9, -556, -546, 10, 30, 'wall');
S('s8-chamber-e', 3, 6, -556, -546, 10, 30, 'wall');
S('s8-chamber-s', -12, 6, -556, -546, 27, 30, 'wall');
S('s8-chamber-roof', -12, 6, -548, -545, 10, 30, 'wall', { tag: 'ceiling' });

dec('ribs', 17.25, -445, 0, 1.5, 30, 30, PI / 2);
dec('ribs', -21.25, -450, 0, 1.5, 30, 30, -PI / 2);
dec('glyphs', -2, -540, -9.9, 14, 2, 0.1, PI);
dec('machinery', 6, -553, -7, 3, 5, 3, 0);
dec('plaque', -2, -546.8, 9.85, 3.8, 0.9, 0.15, 0, { text: 'BELOW THIS MARK NO LAMPS. ONLY THE STILL ONE.' });
dec('statue', -7, -552, 22, 2.2, 8, 2.2, PI);
dec('statue', 1, -552, 22, 2.2, 8, 2.2, PI);
dec('still-lamp', -3, -552.5, 26.5, 1.2, 2.4, 1.2, 0);
dec('grate', -2, -552, 10.25, 8, 8, 0.5, 0);
dec('shaft-light', -2, -500, 0, 8, 110, 8, 0, { color: '#e0a050' });
light(-3, -551.5, 26, '#ffd9a0', 3.2, 40, 0, { still: true });
light(-2, -520, 0, '#e0a050', 1.0, 40, 0.1);

// =============================================================================
// SUPPLIES — candidate spots for the bag's consumables (sim/pickups3d.js)
//  A seeded per-run picker fills about a third of these (2-4 per section) by rarity, so every descent lies
//  differently. 6-10 candidates per section: LEDGES (the open floor of a landing), ALCOVES (corners against
//  a wall, off the line) and a few RISKS (perches, girders, arm tops: awkward to land on, but they favour the
//  rare kinds). Each rests 0.45 m above the top face of the solid it names, never in a solid, never within
//  1.5 m of an anchor, and clear of the checkpoint -> anchor sight lines (tools/.../verify.mjs checks all of it).
//  w = relative weight per item kind [first aid, bandage, adrenaline, battery].
// =============================================================================
const SUP_W = { ledge: [0.8, 5, 2, 4.5], alcove: [0.6, 5, 1.5, 5], risk: [3.5, 2, 5, 2] };
const supplies = [];
/** Candidate on top of the solid `on` at (x, z). */
function sup(id, on, x, z, tier = 'ledge') {
  const s = solids.find((o) => o.id === on);
  if (!s) throw new Error(`supply ${id}: no solid ${on}`);
  supplies.push({ id, x, y: +(s.maxY + 0.45).toFixed(3), z, tier, on, w: SUP_W[tier].slice() });
}
// S1 · The Threshold
sup('sup-s1-01', 's1-threshold', -8, 5.2);
sup('sup-s1-02', 's1-threshold', 2, 6.5, 'alcove');
sup('sup-s1-03', 's1-sill', 0.4, -9.6, 'alcove');
sup('sup-s1-04', 's1-sill', -6, -5.4);
sup('sup-s1-05', 's1-sill', -9.8, -5.6, 'alcove');
sup('sup-s1-06', 's1-pocket', -9, 2, 'risk');
sup('sup-s1-07', 's1-girder', 6, -1, 'risk');
// S2 · The Long Swing
sup('sup-s2-01', 's2-landing', 9.8, -9.6, 'alcove');
sup('sup-s2-02', 's2-landing', 5, -3.5);
sup('sup-s2-03', 's2-far', -24.5, -9);
sup('sup-s2-04', 's2-floor-a', 9.6, 9.6, 'alcove');
sup('sup-s2-05', 's2-floor-a', -8, -9.6);
sup('sup-s2-06', 's2-floor-a', -20.4, 9.6, 'alcove');
sup('sup-s2-07', 's2-low', -29, 9);
sup('sup-s2-08', 's2-arm', -30.5, 7, 'risk');
sup('sup-s2-09', 's2-pier-w', 2, 9);
sup('sup-s2-10', 's2-pier-e', 10, -8, 'alcove');
// S3 · Broken Gallery
sup('sup-s3-01', 's3-landing', 9.7, 9.7, 'alcove');
sup('sup-s3-02', 's3-landing', 9.7, -9.7, 'alcove');
sup('sup-s3-03', 's3-landing', 6, 4);
sup('sup-s3-04', 's3-shelf', -33, -9.7, 'alcove');
sup('sup-s3-05', 's3-shelf', -29, -3.5);
sup('sup-s3-06', 's3-g2', -14.25, 8, 'risk');
sup('sup-s3-07', 's3-g3', -26.25, -8, 'risk');
sup('sup-s3-08', 's3-g5', -20.25, 8, 'risk');
sup('sup-s3-09', 's4-g1', 5, -3, 'risk');
// S4 · The Listening Vault
sup('sup-s4-01', 's4-landing', 9.7, 9.7, 'alcove');
sup('sup-s4-02', 's4-landing', -6.5, 9.7, 'alcove');
sup('sup-s4-03', 's4-landing', 9.5, 3);
sup('sup-s4-04', 's4-catwalk', -16, -10);
sup('sup-s4-05', 's4-catwalk', -16, -22.5, 'risk');
sup('sup-s4-06', 's4-shelf', 9.7, -9.7, 'alcove');
sup('sup-s4-07', 's4-shelf', 4, -6);
sup('sup-s4-08', 's4-plinth', -16, 6);
// S5 · The Gullet Stair
sup('sup-s5-01', 's5-landing', -4.2, 7.8, 'alcove');
sup('sup-s5-02', 's5-landing', -4.2, -7.8, 'alcove');
sup('sup-s5-03', 's5-step1', -19.5, -8, 'alcove');
sup('sup-s5-04', 's5-step1', -13, -6.5);
sup('sup-s5-05', 's5-step5', -14, -6.5);
sup('sup-s5-06', 's5-step6', -19, 7.8, 'alcove');
sup('sup-s5-07', 's5-step3', -5, 7.8, 'alcove');
sup('sup-s5-08', 's5-step4', -4.2, -7.8, 'alcove');
sup('sup-s5-09', 's5-arm2', -19, 0, 'risk');
sup('sup-s5-10', 's5-arm4', -6, 0, 'risk');
// S6 · The Two Descents
sup('sup-s6-01', 's6-fork', -18.5, 4.8, 'alcove');
sup('sup-s6-02', 's6-safe1', -32.5, -9.6, 'alcove');
sup('sup-s6-03', 's6-safe1', -22, -5);
sup('sup-s6-04', 's6-safe2', -32.5, 9.6, 'alcove');
sup('sup-s6-05', 's6-safe2', -21, 6.5);
sup('sup-s6-06', 's6-safe3', -24, -9.5);
sup('sup-s6-07', 's6-safe4', -28, 9.5);
sup('sup-s6-08', 's6-arm-b', -32, -5, 'risk');
sup('sup-s6-09', 's6-safe5', -32.5, -9.6, 'alcove');
// S7 · The Hollow Nave
sup('sup-s7-01', 's7-landing', 8.7, 9.7, 'alcove');
sup('sup-s7-02', 's7-landing', -32.5, -9.7, 'alcove');
sup('sup-s7-03', 's7-landing', -22, 7);
sup('sup-s7-04', 's7-landing', -4, -8.5);
sup('sup-s7-05', 's7-perch', -20, 26, 'risk');
sup('sup-s7-06', 's7-perch', -17.5, 23.5, 'risk');
// S8 · The Last Throat
sup('sup-s8-01', 's8-landing', 16.7, -18.7, 'alcove');
sup('sup-s8-02', 's8-landing', 12, -12);
sup('sup-s8-03', 's8-step1-w', -20.5, 17, 'alcove');
sup('sup-s8-04', 's8-step1-w', -20.5, -17, 'alcove');
sup('sup-s8-05', 's8-step1-e', 15.8, 17, 'alcove');
sup('sup-s8-06', 's8-step1-n', -5, -19);
sup('sup-s8-07', 's8-step2-w', -14.5, 12, 'alcove');
sup('sup-s8-08', 's8-step2-e', 10.5, -12, 'alcove');
sup('sup-s8-09', 's8-step2-s', -2, 14);

// =============================================================================
// CLIMB ZONES (WP-CLIMB, sim/climb3d.js) — the surfaces the player can grab and climb
//  Not every surface: short, authored courses of rough masonry, chains, sinew roots and ledge lips, placed where a climb is a
//  RECOVERY (back up out of a pocket, off a shelf, to rope height) or an optional alternative to a lowering the route already
//  gives, never a way round a swing or a drop (the route bot ignores them). Stamina keeps them honest: a dry course of 11-13 m
//  is ~60-70 % of a full grip, a wet one (dripping stone) is limited to ~7.5 m. Each zone is a thin box just off the surface
//  (`face` = the surface's coordinate along its normal `n`), marked in the world with chalky studs (render/climbView.js).
//  verify.mjs checks that every zone hugs a solid, stays clear of hazards and keeps its height within the stamina budget.
// =============================================================================
const climb = [];
const CT = 0.4; // thickness of a grip volume off its surface (m)
/**
 * Wall zone. side: 'w' = the wall is on the west, its inner face (x = c) looks +x; 'e' = face looks -x; 'n' = the wall is
 * on the north, its face (z = c) looks +z; 's' = face looks -z. a0..a1 run along the wall (z for w/e, x for n/s).
 */
function CL(id, side, c, a0, a1, y0, y1, kind = 'masonry', extra) {
  const o = { id, kind, minY: Math.min(y0, y1), maxY: Math.max(y0, y1), face: c };
  if (side === 'w' || side === 'e') {
    const sg = side === 'w' ? 1 : -1;
    o.minX = sg > 0 ? c - 0.05 : c - CT;
    o.maxX = sg > 0 ? c + CT : c + 0.05;
    o.minZ = Math.min(a0, a1);
    o.maxZ = Math.max(a0, a1);
    o.n = { x: sg, y: 0, z: 0 };
  } else {
    const sg = side === 'n' ? 1 : -1;
    o.minZ = sg > 0 ? c - 0.05 : c - CT;
    o.maxZ = sg > 0 ? c + CT : c + 0.05;
    o.minX = Math.min(a0, a1);
    o.maxX = Math.max(a0, a1);
    o.n = { x: 0, y: 0, z: sg };
  }
  climb.push(Object.assign(o, extra));
  return o;
}
/** Underside zone: hang under a slab whose bottom face is y = c. */
function CLU(id, c, x0, x1, z0, z1, kind = 'ledge', extra) {
  const o = { id, kind, minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), minY: c - CT, maxY: c + 0.05, face: c, n: { x: 0, y: -1, z: 0 } };
  climb.push(Object.assign(o, extra));
  return o;
}
/** A hanging chain at (x, z) from y0 to y1. */
function CLC(id, x, z, y0, y1, extra) {
  const o = { id, kind: 'chain', minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, minY: Math.min(y0, y1), maxY: Math.max(y0, y1) };
  climb.push(Object.assign(o, extra));
  return o;
}
// S1 · The Threshold: back up out of the pocket (the swing is retried from the lip), and a practice wall by the spawn.
CL('c-s1-pocket', 'w', -11, -3.6, 3.6, -7.7, -0.5);
CL('c-s1-practice', 'w', -11, 6.6, 8.2, 0.3, 5.2);
// S2 · The Long Swing: from the hall floor back up beside the landing (to try the swing again); out of the floor opening.
CL('c-s2-east', 'e', 11, -0.3, 8.5, -34.6, -21.8);
CL('c-s2-shaft', 'w', -34, 3.6, 7.8, -42.6, -34.6);
// S3 · Broken Gallery: up the west wall from the shelf toward rope height (the anchors above come within range).
CL('c-s3-shelf', 'w', -34, -9.5, -4.5, -95.4, -84);
// S4 · The Listening Vault: the shelf wall, and the cradle's chain up toward the ring above it.
CL('c-s4-shelf', 'e', 11, -9.5, -3.5, -118.6, -108);
CLC('c-s4-chain', -31.5, -5, -111.6, -100.2);
// S5 · The Gullet Stair: shaft wall courses from a ledge up to the one above (the predator hunts: a slow, exposed choice).
CL('c-s5-east', 'e', -3, 0, 3, -183.6, -176.4, 'sinew', { wet: true });
CL('c-s5-west', 'w', -21, -4, 2, -199.6, -193.4);
// S6 · The Two Descents: the dividing wall between the long stair's shelves.
CL('c-s6-div1', 'e', -13, -2.6, 3, -229.6, -218.6);
CL('c-s6-div2', 'e', -13, -2.6, 3, -253.6, -242.6);
// S7 · The Hollow Nave: hang under the landing, the spire's faces.
CLU('c-s7-under', -291, -33, -15.6, -6, 6);
CL('c-s7-spire-w', 'e', -15, -2.8, 2.8, -301.6, -294, 'sinew', { wet: true });
CL('c-s7-spire-s', 'n', 3, -13, -10, -352, -342.5);
// S8 · The Last Throat: the converging walls.
CL('c-s8-w1', 'w', -22, -8, 8, -469.6, -460);
CL('c-s8-w3', 'w', -12, -8, -1, -546.4, -535.2);

// =============================================================================
// Sections (themes, creature behaviour, hints, triggers)
// =============================================================================
const creature = (mode, lethal, spawnOffsetY, speedMul = 1, burstRate = 0) => ({ mode, lethal, speedMul, burstRate, spawnOffsetY });
const theme = (fog, light, accent, fogNear, fogFar, ambient) => ({ fog, light, accent, fogNear, fogFar, ambient });

const sections = [
  {
    id: 's1', name: 'The Threshold', subtitle: 'Where the line is learned',
    yTop: 40, yBottom: -8,
    shaft: { minX: -11, maxX: 11, minZ: -11, maxZ: 11 },
    checkpoint: { x: -4, y: 0.4, z: 8.5, yaw: 0 },
    theme: theme('#252b30', '#6fa3b5', '#e0a050', 8, 90, 0.34),
    creature: creature('dormant', false, 260),
    hints: [
      {
        y: 2, duration: 9,
        text: 'Point at the glowing ring and hold the TRIGGER to fire your tether. Let go of the trigger to release.',
        desktop: 'Aim at the glowing ring and hold the LEFT MOUSE BUTTON to fire your tether. Release to let go.',
      },
      {
        y: -0.2, duration: 7,
        text: 'Push the LEFT STICK the way you want to swing. Let go near the top of the arc to fly.',
        desktop: 'W A S D pumps the swing. Release near the top of the arc to fly.',
      },
      {
        y: -7.5, duration: 9,
        text: 'Studded stone can be climbed. Reach a hand to it, hold GRIP and pull: your hand stays, you move. Let go to launch.',
        desktop: 'Studded stone can be climbed: stand close, hold F, then W A S D to climb. SPACE hops off.',
      },
      {
        y: -6.5, duration: 8,
        text: 'Hanging? Pull the RIGHT STICK back to let out rope and lower yourself. Push it forward to reel in.',
        desktop: 'Hanging? SHIFT lets out rope to lower yourself. SPACE reels you in.',
      },
    ],
    triggers: [{ y: -6.5, name: 'rumble', data: { intensity: 0.15 } }],
  },
  {
    id: 's2', name: 'The Long Swing', subtitle: 'Momentum is a promise',
    yTop: -8, yBottom: -58,
    shaft: { minX: -34, maxX: 11, minZ: -11, maxZ: 11 },
    checkpoint: { x: 8, y: -21.6, z: -6, yaw: PI / 2 },
    theme: theme('#22282d', '#6fa3b5', '#e0a050', 7, 85, 0.3),
    creature: creature('dormant', false, 260),
    hints: [
      {
        y: -21, duration: 8,
        text: 'Two hands, two tethers. Run, fire at the hook under the floor above, and let go on the upswing.',
        desktop: 'LEFT and RIGHT MOUSE fire two tethers. Run, fire at the hook, and release on the upswing.',
      },
      {
        y: -28.5, duration: 6,
        text: 'Falling? Fire again — any anchor will catch you. The rope forgives; the floor does not.',
        desktop: 'Falling? Fire again — any anchor will catch you. The rope forgives; the floor does not.',
      },
      {
        y: -44.5, duration: 7,
        text: 'Squeeze the GRIP on a tethered hand for a hard yank toward its anchor.',
        desktop: 'F yanks your tethers: a hard pull toward the anchors.',
      },
    ],
    triggers: [{ y: -30, name: 'rumble', data: { intensity: 0.25 } }],
  },
  {
    id: 's3', name: 'Broken Gallery', subtitle: 'Every fall is a question',
    yTop: -58, yBottom: -98,
    shaft: { minX: -34, maxX: 11, minZ: -11, maxZ: 11 },
    checkpoint: { x: 7, y: -65.6, z: 0, yaw: PI / 2 },
    theme: theme('#23231f', '#7c9a9c', '#3f6b63', 6, 75, 0.27),
    creature: creature('dormant', false, 240),
    hints: [
      {
        y: -67, duration: 6,
        text: 'Missed a landing? Don\'t wait — fire at a lower ring.',
        desktop: 'Missed a landing? Don\'t wait — fire at a lower ring.',
      },
    ],
    triggers: [
      { y: -68, name: 'debris', data: { x: -14, y: -59, z: 0, intensity: 0.35 } },
      { y: -90, name: 'call', data: { x: -20, y: -10, z: -5, intensity: 0.3 } },
    ],
  },
  {
    id: 's4', name: 'The Listening Vault', subtitle: 'Something answered',
    yTop: -98, yBottom: -150,
    shaft: { minX: -34, maxX: 11, minZ: -11, maxZ: 11 },
    checkpoint: { x: 5, y: -99.6, z: 6, yaw: 0 },
    theme: theme('#1b2226', '#5b8c9b', '#b8f0e0', 8, 170, 0.25),
    creature: creature('sighting', false, 220),
    hints: [],
    triggers: [
      // Fires as the player stands on the catwalk over the Vault: the predator
      // crosses the Vault's far wall (inner face z = −160) and is gone. Path:
      // centre (x,y,z), unit direction (dx,dy,dz), length span, seconds. It runs
      // level, 8 m under the catwalk: on the horizon of a natural forward look
      // (lower and the catwalk deck itself hides it from anyone standing on it).
      { y: -104.5, name: 'sighting', data: { x: -14, y: -112, z: -158.5, dx: 1, dy: 0, dz: 0, span: 172, duration: 10 } },
      { y: -127, name: 'call', data: { x: -40, y: -150, z: -140, intensity: 0.5 } },
    ],
  },
  {
    id: 's5', name: 'The Gullet Stair', subtitle: 'It has your scent',
    yTop: -150, yBottom: -204,
    shaft: { minX: -21, maxX: -3, minZ: -9, maxZ: 9 },
    checkpoint: { x: -6, y: -151.6, z: 0, yaw: PI / 2 },
    theme: theme('#211b19', '#8a5a3c', '#7a3b22', 4, 55, 0.2),
    creature: creature('stalk', true, 130),
    hints: [
      {
        y: -151, duration: 5,
        text: 'Something is coming down after you. Keep moving.',
        desktop: 'Something is coming down after you. Keep moving.',
      },
      {
        // The S6 fork, briefed here on the first step while the creature is still
        // ~50 m overhead on its slow intro: at the fork itself it has followed you
        // down (a fear peak in nearly every timeline run), and the plaques there name
        // both ways. Named by the plaques, not left / right: in VR you arrive facing any way.
        y: -159, duration: 8,
        text: 'Below: two ways down, marked by plaques. THE LONG STAIR: slow and certain. THE THROAT: quick and thin — its frayed rings snap under load.',
        desktop: 'Below: two ways down, marked by plaques. THE LONG STAIR: slow and certain. THE THROAT: quick and thin — its frayed rings snap under load.',
      },
    ],
    triggers: [
      { y: -152.5, name: 'rumble', data: { intensity: 0.6 } },
      // Heard before it is seen: the creature (in play, on its slow intro) answers
      // with its own cry from where it really is, far overhead.
      { y: -153, name: 'call', data: { intensity: 0.7 } },
      { y: -170, name: 'debris', data: { x: -12, y: -151, z: 0, intensity: 0.6 } },
      { y: -190, name: 'call', data: { intensity: 0.8 } },
    ],
  },
  {
    id: 's6', name: 'The Two Descents', subtitle: 'Slow and certain, or quick and thin',
    yTop: -204, yBottom: -284,
    shaft: { minX: -34, maxX: 10, minZ: -11, maxZ: 11 },
    checkpoint: { x: -12, y: -207.6, z: 0, yaw: 0 },
    theme: theme('#1b1918', '#5a7d86', '#9a4a2a', 5, 65, 0.18),
    creature: creature('hunt', true, 120),
    hints: [], // the fork is briefed in S5 (see its second hint)
    triggers: [
      { y: -209, name: 'call', data: { intensity: 0.9 } },
      { y: -240, name: 'debris', data: { x: 0, y: -212, z: 0, intensity: 0.7 } },
    ],
  },
  {
    id: 's7', name: 'The Hollow Nave', subtitle: 'Nothing to stand on',
    yTop: -284, yBottom: -420,
    shaft: { minX: -52, maxX: 28, minZ: -40, maxZ: 40 },
    checkpoint: { x: -12, y: -287.6, z: 0, yaw: 0 },
    theme: theme('#141719', '#4f7f8c', '#b8f0e0', 8, 120, 0.16),
    creature: creature('frenzy', true, 110),
    hints: [
      {
        y: -287, duration: 7,
        text: 'Chain the rings: fire your other hand at the next ring before you let go of this one.',
        desktop: 'Chain the rings: fire the other mouse button at the next ring before you let go of this one.',
      },
    ],
    triggers: [
      { y: -290, name: 'rumble', data: { intensity: 0.8 } },
      { y: -340, name: 'debris', data: { x: -12, y: -300, z: 0, intensity: 0.8 } },
      { y: -380, name: 'call', data: { intensity: 1 } },
    ],
  },
  {
    id: 's8', name: 'The Last Throat', subtitle: 'Down. Now.',
    yTop: -420, yBottom: -562,
    shaft: { minX: -22, maxX: 18, minZ: -20, maxZ: 20 },
    checkpoint: { x: 8, y: -427.6, z: -15, yaw: PI * 0.75 },
    theme: theme('#120f0e', '#d9b878', '#e0a050', 5, 70, 0.2),
    creature: creature('escape', true, 100),
    hints: [
      {
        y: -548, duration: 5,
        text: 'The grate — run for the light.',
        desktop: 'The grate — run for the light.',
      },
    ],
    triggers: [
      { y: -430, name: 'rumble', data: { intensity: 1 } },
      { y: -480, name: 'debris', data: { x: -2, y: -440, z: 0, intensity: 0.9 } },
      { y: -545, name: 'gate', data: { x: -2, y: -552, z: 10.25 } },
    ],
  },
];

export const LEVEL_DATA_3D = {
  name: 'The Underspire',
  spawn: { x: -4, y: 0.4, z: 8.5, yaw: 0 },
  // Inside the Still Lamp's chamber, past the grate.
  goal: { minX: -9, maxX: 3, minY: -556, maxY: -550, minZ: 12, maxZ: 27 },
  // The grate across the chamber mouth (closed by the Game on victory).
  gate: { minX: -6, maxX: 2, minY: -556, maxY: -548, minZ: 10, maxZ: 10.5 },
  stillLamp: { x: -3, y: -551.5, z: 26.5 },
  sections,
  solids,
  hazards,
  anchors,
  decor,
  lights,
  supplies, // candidate spots for the bag's consumables (see SUPPLIES above)
  climb, // grip zones (see CLIMB ZONES above)
};
