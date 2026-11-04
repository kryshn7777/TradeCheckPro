/* ABYSSAL TETHER 3D — data/chapter2-sets.js
 * CHAPTER II · LAMPHOLD: the three authored SET-PIECES that the generic stair of data/chapter2-data.js cannot be: II-9 THE TOLLING GALLERY (the Usher's first
 * sighting), II-12 THE SNUFFING (the Doorman exam: docs/abyssal-tether-3d/plans/CHAPTER_II_DIRECTION.md section 3) and II-13 THE SOOT THROAT (the hook, section 4).
 * Each function ADDS to the chapter's lists through `ctx` (solids, anchors, movers, decor, lights, fixtures, objectives, seals, c2: the metadata the director
 * reads) and returns nothing. Pure and deterministic; DOM-free, three.js-free.
 *
 * Units: chapter-local metres (the chapter starts at y = 0 and descends to -1250; the pit is 52 m wide, x and z in [-26, 26]). Solids are axis-aligned boxes.
 */

const r2 = (v) => Math.round(v * 100) / 100;

/** A box solid from its extents. */
function box(ctx, id, x0, x1, y0, y1, z0, z1, kind = 'stone', extra) {
  const s = { id, minX: r2(Math.min(x0, x1)), maxX: r2(Math.max(x0, x1)), minY: r2(Math.min(y0, y1)), maxY: r2(Math.max(y0, y1)), minZ: r2(Math.min(z0, z1)), maxZ: r2(Math.max(z0, z1)), kind };
  ctx.solids.push(extra ? Object.assign(s, extra) : s);
  return s;
}

/**
 * II-9 THE TOLLING GALLERY (c2-9, local y -760 .. -860). A covered nave across the pit with eight bells in a line (any five of them open the way down:
 * a seal across the whole pit), a beam of rope rings over it, the Tenor on a cantilever landing 12 m below the nave's end (not part of the peal), and the
 * Usher's approach nodes (a hundred metres below, climbing one tier per toll: the director's scripted answer). Never lethal: the director aims the Usher's
 * only blow at the Tenor and holds it while anyone stands within 6 m of the sphere.
 */
export function addTollingGallery(ctx) {
  const b = ctx.sec('c2-9');
  // the deck, 3 m under a ledge top and 3 m over the next (the stair passes above and below it)
  const tops = ctx.ledges.filter((l) => l.section === 'c2-9').map((l) => l.y);
  const lt = tops[Math.min(tops.length - 1, 2)];
  const deckY = r2(lt - 3);
  box(ctx, 'c2-9-nave', -24, 24, deckY - 1, deckY, -2.5, 2.5, 'stone');
  // the iron beam over it (a rope surface: the swing into the bells), and the rails along its edge
  box(ctx, 'c2-9-beam', -24, 24, deckY + 9, deckY + 10, -1, 1, 'stone');
  const bellX = [-21, -15, -9, -3, 3, 9, 15, 21];
  const ids = [];
  bellX.forEach((x, k) => {
    const id = `bell-c2-9-${k}`;
    const r = k < 3 ? 0.9 : k < 6 ? 0.75 : 0.6;
    ctx.fixtures.push({ id, kind: 'bell', x, y: r2(deckY + 4.2), z: 0, r, minSpeed: 2.5, by: { nightmare: { minSpeed: 3 }, abyss: { minSpeed: 3.5 } } });
    ids.push(id);
    ctx.anchors.push({ id: `c2-9-ring${k}`, x, y: r2(deckY + 8.9), z: k % 2 ? 0.9 : -0.9, kind: 'ring', tag: 'route', normal: { x: 0, y: -1, z: 0 }, mount: 'wall' });
  });
  // the way down: a plate across the whole pit under the last ledge, opened by five bells
  const bottom = b.yBottom;
  ctx.solids.push({ id: 'seal-c2-9-floor', minX: -29, maxX: 29, minY: r2(bottom - 2), maxY: r2(bottom - 1), minZ: -29, maxZ: 29, kind: 'stone', seal: 'seal-c2-9' });
  ctx.seals.push({ id: 'seal-c2-9', section: 'c2-9', ids: ['seal-c2-9-floor'], open: 'slide' });
  ctx.objectives.push({ id: 'obj-c2-9', section: 'c2-9', verb: 'bell', sealId: 'seal-c2-9', ids, need: 5 });
  // the Tenor: a landing 12 m under the nave's end on a cantilever, a bell on a stand, and the Usher's approach (the director places it)
  const tx = 21;
  const ty = r2(deckY - 12);
  box(ctx, 'c2-9-tenor-landing', tx - 4, tx + 4, ty - 1, ty, -4, 4, 'stone');
  box(ctx, 'c2-9-tenor-stand', tx + 3, tx + 3.8, ty, ty + 4.4, -0.4, 0.4, 'stone', { life: 1, tag: 'blow' });
  ctx.decor.push({ type: 'cage', x: tx + 3.4, y: r2(ty + 3.2), z: 0, sx: 1.6, sy: 2.2, sz: 1.6, yaw: 0, id: 'c2-9-tenor-bell' });
  ctx.c2.tolling = {
    section: 'c2-9',
    deckY,
    bells: bellX.map((x, k) => ({ id: `bell-c2-9-${k}`, x, y: r2(deckY + 4.2), z: 0 })),
    need: 5,
    tenor: { x: r2(tx + 3.4), y: r2(ty + 3.2), z: 0, landing: { x: tx, y: ty, z: 0 }, standId: 'c2-9-tenor-stand' },
    // the Usher's nodes: far below, then climbing: stage k is where it stands after the k-th toll
    usher: [
      { x: 0, y: r2(deckY - 100), z: -6 },
      { x: 4, y: r2(deckY - 74), z: 4 },
      { x: -3, y: r2(deckY - 44), z: -3 },
      { x: r2(tx - 6), y: ty, z: -2 },
    ],
  };
  ctx.lights.push({ x: 0, y: r2(deckY + 3), z: 0, color: '#ffcf80', intensity: 1.4, range: 22, flicker: 0.12 });
}

/**
 * II-12 THE SNUFFING (c2-12, local y -1040 .. -1190): the exam. The generic stair is cut at the Well rim (its last ledge, d 64.6); the arena is built in a
 * CANONICAL frame (rim on the west wall, the Well to the east) and turned by a quarter turn about the pit's centre so that it joins the stair's last ledge.
 *
 *   d   0..65  the Round: the stair itself (a ledge every 6 m) with the front behind you; chandeliers (iron: silent) and a lift (a moving light) as the fast lines
 *   d  65      the Well rim R (14 x 14) and the pulpit across the Well (the Head Usher), the Great Bell (a pendulum, a toll every 6 s)
 *   d  70      gate G on the far side: a platform (the sill) and an iron door (the pawl holds it shut)
 *   d  92..120 the Span: 25 deck plates of 6 m round the pit wall, falling 28 m; trolleys under it (path movers); hanger rings
 *   d 120..150 the Lift tower: the cage's shaft, the top landing (L2-19), the shutter at the bottom (d 150, the Soot Throat's mouth)
 * Everything the director needs is in `ctx.c2.snuffing`.
 */
export function addSnuffing(ctx) {
  const b = ctx.sec('c2-12');
  const yT = b.yTop;
  const last = ctx.ledges.filter((l) => l.section === 'c2-12' && l.y > yT - 66).slice(-1)[0];
  // which wall is the last ledge nearest to? that wall is the canonical west wall; q = quarter turns from canonical to the world
  const walls = [
    { q: 0, d: last.x + 26 }, // west
    { q: 1, d: last.z + 26 }, // north (-z)
    { q: 2, d: 26 - last.x }, // east
    { q: 3, d: 26 - last.z }, // south
  ].sort((a, c) => a.d - c.d);
  const q = walls[0].q;
  // canonical (u east, w south) -> world (x, z): q quarter turns about the vertical
  const P = (u, w) => {
    let x = u;
    let z = w;
    for (let i = 0; i < q; i++) {
      const nx = z; // rotate (x, z) by 90 deg: (x, z) -> (z, -x)
      const nz = -x;
      x = nx;
      z = nz;
    }
    return { x: r2(x), z: r2(z) };
  };
  const Bx = (id, u0, u1, d0, d1, w0, w1, kind = 'stone', extra) => {
    const a = P(u0, w0);
    const c = P(u1, w1);
    return box(ctx, id, a.x, c.x, yT - d1, yT - d0, a.z, c.z, kind, extra);
  };
  const Y = (d) => r2(yT - d);
  const yRim = last.y;
  const dRim = r2(yT - yRim); // 64.6 (the last ledge of the stair)
  const rimTop = yRim;

  // ---- the Well rim R (canonical west wall) and the connector from the last ledge
  Bx('c2-12-rim', -26, -12, dRim, dRim + 1, -7, 7, 'stone');
  connect(ctx, 'c2-12-conn', { x: last.x, z: last.z }, P(-12, 0), rimTop);
  // the lamp of the rim (L2-17)
  const rimLamp = P(-20, 0);
  ctx.lights.push({ x: rimLamp.x, y: r2(rimTop + 1.8), z: rimLamp.z, color: '#ffcf80', intensity: 1.4, range: 18, flicker: 0.15 });

  // ---- gate G: the sill platform (canonical east wall, 5.4 m under the rim), and the iron door behind it that the pawl holds
  const dSill = r2(dRim + 8);
  Bx('c2-12-sill', 14, 26, dSill, dSill + 1, -7, 7, 'stone');
  Bx('c2-12-gate', 19, 21, dSill - 11, dSill, -8, 8, 'crumble', { tag: 'gate', life: 1e9 }); // the door: a leaf across the sill (solid until the pawl breaks; drawn as a crumble)
  // behind the door the Span head (a 6 m plate), then the Span
  const spanD0 = dSill; // the first plate is level with the sill, then it steps down
  const plates = [];
  {
    // the Span: 25 plates of 6 m along the pit wall, starting beside the sill (canonical east wall, going south), then west along the south wall, north along
    // the west wall, east along the north wall. Each plate is 4 m wide inside the wall, 1 m thick; it steps down (28 m over 25 plates)
    const path = [];
    const half = 24; // plate centre line 2 m inside the wall's face (26)
    // legs in canonical (u, w): east wall south: w 0 -> 24 at u = 24; south wall west: u 24 -> -24 at w = 24; west wall north: w 24 -> -24 at u = -24; north wall east: u -24 -> ? at w = -24
    let u = half;
    let w = 0;
    const step = 3;
    const legs = [
      { du: 0, dw: 1, n: 8 }, // down the east wall (24 m)
      { du: -1, dw: 0, n: 16 }, // along the south wall (48 m)
      { du: 0, dw: -1, n: 16 }, // up the west wall (48 m)
      { du: 1, dw: 0, n: 10 }, // along the north wall (30 m) = 150 m
    ];
    for (const leg of legs) {
      for (let i = 0; i < leg.n; i++) {
        u += leg.du * step;
        w += leg.dw * step;
        path.push({ u, w, du: leg.du, dw: leg.dw });
      }
    }
    const count = path.length; // 50
    path.forEach((p, i) => {
      const d = r2(dSill + 1 + (i * 48) / (count - 1)); // 1 m under the sill at the first plate, 49 m under at the last (< 1 m a step)
      // along the leg: 3 m + a hair of overlap; across: 4 m (x and z swapped by the leg's direction)
      const along = 1.6;
      const across = 2;
      const u0 = p.u - (p.du ? along : across);
      const u1 = p.u + (p.du ? along : across);
      const w0 = p.w - (p.dw ? along : across);
      const w1 = p.w + (p.dw ? along : across);
      const id = `c2-12-span-${i}`;
      Bx(id, u0, u1, d, d + 1, w0, w1, 'crumble', { tag: i % 3 === 0 ? 'brass' : 'iron', life: 1e9 });
      const c = P(p.u, p.w);
      plates.push({ id, i, x: c.x, y: Y(d), z: c.z, d, leg: path[i] });
    });
  }
  const lastPlate = plates[plates.length - 1];

  // ---- the Lift tower: the top landing at the end of the Span (8 x 8), the cage lowering to the Throat's lip, the shutter just above the lip
  const landingD = lastPlate.d;
  const clampIn = (v) => Math.max(-22, Math.min(22, v));
  const lc = { x: clampIn(lastPlate.x), z: clampIn(lastPlate.z) }; // the landing is 8 x 8: kept inside the pit's wall
  ctx.solids.push({ id: 'c2-12-landing', minX: r2(lc.x - 4), maxX: r2(lc.x + 4), minY: Y(landingD + 1), maxY: Y(landingD), minZ: r2(lc.z - 4), maxZ: r2(lc.z + 4), kind: 'stone' });
  const c13 = ctx.ledges.filter((l) => l.section === 'c2-13')[0];
  const lipTop = c13 ? c13.y : r2(yT - 154.6); // the Soot Throat's lip is level with the first stair ledge of c2-13
  const drop = r2(Y(landingD) - lipTop);
  // the lip: a platform at the foot of the shaft, joined to the first ledge by a connector
  ctx.solids.push({ id: 'c2-12-lip', minX: r2(lc.x - 4), maxX: r2(lc.x + 4), minY: r2(lipTop - 1), maxY: lipTop, minZ: r2(lc.z - 4), maxZ: r2(lc.z + 4), kind: 'stone' });
  if (c13) connect(ctx, 'c2-12-lipconn', { x: lc.x, z: lc.z }, { x: c13.x, z: c13.z }, lipTop);
  // the cage: a lift mover carrying rings on OUTRIGGERS 3.4 m either side (you hang from a ring and swing out; the cage's own floor is not a floor)
  const shaftX = r2(lc.x);
  const shaftZ = r2(lc.z);
  const cageTop = Y(landingD + 0.2);
  const ringIds = ['c2-12-cage-ringA', 'c2-12-cage-ringB'];
  const ringOff = lc.x * lc.x > lc.z * lc.z ? { x: 0, z: 3.4 } : { x: 3.4, z: 0 };
  ringIds.forEach((id, k) => ctx.anchors.push({ id, x: r2(shaftX + (k ? -1 : 1) * ringOff.x), y: r2(cageTop + 2.2), z: r2(shaftZ + (k ? -1 : 1) * ringOff.z), kind: 'ring', tag: 'route', normal: { x: 0, y: -1, z: 0 }, mount: 'mover' }));
  ctx.movers.push({ id: 'mov-c2-12-cage', kind: 'lift', section: 'c2-12', x: shaftX, y: cageTop, z: shaftZ, to: { x: shaftX, y: r2(cageTop - drop), z: shaftZ }, travel: 16, dwell: 1e5, ramp: 0.5, parts: 'lift', carry: { anchors: ringIds, decor: [] }, scripted: true });
  // the shutter across the foot of the shaft: 2.5 m over the lip, open at first (inactive), closes when the last lamp dies
  ctx.solids.push({ id: 'c2-12-shutter', minX: r2(lc.x - 5), maxX: r2(lc.x + 5), minY: r2(lipTop + 2), maxY: r2(lipTop + 3), minZ: r2(lc.z - 5), maxZ: r2(lc.z + 5), kind: 'crumble', life: 1e9, tag: 'shutter' });

  // ---- the Great Bell: a pendulum over the Well (canonical: strokes alternate the west and east apexes, 12 m out, every 6 s), a ring on its crown
  {
    const L = 30;
    const amp = Math.asin(12 / L);
    const gb = P(0, 0);
    const pivotY = r2(rimTop + 3 + L);
    const dir = q % 2 === 0 ? { x: 1, z: 0 } : { x: 0, z: 1 }; // swing along the canonical u axis
    ctx.anchors.push({ id: 'c2-12-great-ring', x: gb.x, y: r2(pivotY - L), z: gb.z, kind: 'ring', tag: 'route', normal: { x: 0, y: -1, z: 0 }, mount: 'mover', toll: 'great' });
    ctx.movers.push({ id: 'mov-c2-12-great', kind: 'pendulum', section: 'c2-12', x: gb.x, y: pivotY, z: gb.z, dir, length: L, amp: r2(amp), period: 12, phase: 0.25, parts: 'cage', carry: { anchors: ['c2-12-great-ring'], decor: [] }, scripted: true });
    // the north-rim chandeliers (iron, silent): three rings across the Well's north side, the safe crossing
    [-8, 0, 8].forEach((uu, k) => {
      const c = P(uu, -14);
      const id = `c2-12-iron${k}`;
      const len = 22 + k * 2;
      ctx.anchors.push({ id, x: c.x, y: r2(rimTop + 4), z: c.z, kind: 'ring', tag: 'route', normal: { x: 0, y: -1, z: 0 }, mount: 'mover' });
      ctx.movers.push({ id: `mov-${id}`, kind: 'pendulum', section: 'c2-12', x: c.x, y: r2(rimTop + 4 + len), z: c.z, dir, length: len, amp: 0.3, period: 9 + k, phase: k * 0.31, carry: { anchors: [id], decor: [] } });
    });
  }
  // the clappers: pull-anchors on the rims (haul rings): W (west rim) tolls G's pawl bell, N (north rim) tolls the north bell
  const clapW = P(-24, -4);
  const clapN = P(0, -25.4);
  ctx.anchors.push({ id: 'c2-12-clapW', x: clapW.x, y: r2(rimTop + 2.2), z: clapW.z, kind: 'ring', tag: 'objective', normal: P(1, 0).x === clapW.x ? { x: 1, y: 0, z: 0 } : { x: 1, y: 0, z: 0 }, mount: 'wall' });
  ctx.anchors.push({ id: 'c2-12-clapN', x: clapN.x, y: r2(rimTop + 2.2), z: clapN.z, kind: 'ring', tag: 'objective', normal: { x: 0, y: 0, z: 1 }, mount: 'wall' });
  // the clappers are haul fixtures of two dummy objectives (the objective machinery wants a seal): a 1 m plate buried in the wall that nobody can reach
  for (const [key, anchorId] of [['W', 'c2-12-clapW'], ['N', 'c2-12-clapN']]) {
    ctx.solids.push({ id: `seal-c2-12-clap${key}-plate`, minX: key === 'W' ? 30 : 33, maxX: key === 'W' ? 31 : 34, minY: Y(10), maxY: Y(9), minZ: 30, maxZ: 31, kind: 'stone', seal: `seal-c2-12-clap${key}` });
    ctx.seals.push({ id: `seal-c2-12-clap${key}`, section: 'c2-12', ids: [`seal-c2-12-clap${key}-plate`], open: 'slide' });
    ctx.fixtures.push({ id: `clap-c2-12-${key}`, kind: 'haul', anchorId, time: 1.2, notches: 1, by: { nightmare: { time: 1.2 }, abyss: { time: 1.2 } } });
    ctx.objectives.push({ id: `obj-c2-12-clap${key}`, section: 'c2-12', verb: 'haul', sealId: `seal-c2-12-clap${key}`, ids: [`clap-c2-12-${key}`], need: 1 });
  }

  // ---- the pulpit (the Head Usher's pier across the Well) and the stalls under it
  const pulp = P(16, 8);
  box(ctx, 'c2-12-pulpit', pulp.x - 2, pulp.x + 2, Y(120), Y(92), pulp.z - 2, pulp.z + 2, 'stone');
  const stallLamps = [];
  for (let k = 0; k < 40; k++) {
    const row = Math.floor(k / 8);
    const col = k % 8;
    const c = P(-8 + col * 2.3, 8 + row * 2.4);
    stallLamps.push({ x: c.x, y: Y(122 + row * 0), z: c.z });
    ctx.decor.push({ type: 'lamp', x: c.x, y: Y(122), z: c.z, sx: 0.4, sy: 0.8, sz: 0.4, yaw: 0, lit: true, flicker: 0.3, id: `c2-12-stall${k}` });
  }
  // a floor of the Well (the stalls' floor): death below the rim, so a fall is the Well
  box(ctx, 'c2-12-well-floor', -26, 26, Y(125), Y(124), -26, 26, 'stone');

  // ---- the Round: lamp clusters on the stair (the front snuffs them in order) = the c2-12 ledges above the rim
  const clusters = ctx.ledges.filter((l) => l.section === 'c2-12' && l.y > yT - 66).map((l) => ({ id: l.id, x: l.x, y: l.y, z: l.z }));

  ctx.c2.snuffing = {
    section: 'c2-12',
    q,
    yT,
    rim: { x: P(-20, 0).x, y: rimTop, z: P(-20, 0).z, d: dRim },
    gallery: { x: ctx.ledges.find((l) => l.section === 'c2-12').x, y: ctx.ledges.find((l) => l.section === 'c2-12').y, z: ctx.ledges.find((l) => l.section === 'c2-12').z },
    clusters,
    pulpit: { x: pulp.x, y: Y(92), z: pulp.z },
    greatBell: { moverId: 'mov-c2-12-great', ringId: 'c2-12-great-ring', apexE: P(12, 0), apexW: P(-12, 0), period: 12 },
    gate: { solidId: 'c2-12-gate', pawl: { x: P(18.4, 0).x, y: Y(dSill - 3), z: P(18.4, 0).z }, bellN: { x: clapN.x, y: r2(rimTop + 4), z: clapN.z } },
    clappers: { W: { fixtureId: 'clap-c2-12-W', anchorId: 'c2-12-clapW' }, N: { fixtureId: 'clap-c2-12-N', anchorId: 'c2-12-clapN' } },
    span: { plates, front: { base: 7, gap: 22 } },
    tower: { landing: { x: lc.x, y: Y(landingD), z: lc.z }, cage: { moverId: 'mov-c2-12-cage', ringIds, x: shaftX, y: cageTop, z: shaftZ, drop, travel: 16 }, shutterId: 'c2-12-shutter', throat: { x: lc.x, y: lipTop, z: lc.z } },
    stalls: stallLamps,
    doorman: { pulpit: { x: pulp.x, y: Y(92), z: pulp.z }, tower: { x: r2(lc.x + (lc.x > 0 ? -5 : 5)), y: Y(landingD), z: lc.z } },
  };
}

/** A 5 m wide L-shaped walkway at height `top` from (a.x, a.z) to (b.x, b.z): along x, then along z. */
function connect(ctx, id, a, b, top) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z);
  const z1 = Math.max(a.z, b.z);
  ctx.solids.push({ id: `${id}-x`, minX: r2(x0 - 2.5), maxX: r2(x1 + 2.5), minY: r2(top - 1), maxY: top, minZ: r2(a.z - 2.5), maxZ: r2(a.z + 2.5), kind: 'stone' });
  ctx.solids.push({ id: `${id}-z`, minX: r2(b.x - 2.5), maxX: r2(b.x + 2.5), minY: r2(top - 1), maxY: top, minZ: r2(z0 - 2.5), maxZ: r2(z1 + 2.5), kind: 'stone' });
  void x1;
  void z1;
}

/**
 * II-13 THE SOOT THROAT (c2-13, local y -1190 .. -1250): the true rest, then the hook. A landing at the foot of the shaft with the last waking lamp; a platform
 * at the Throat's lip (the plaque), and the chain. The black water of the Mere is the director's sequence (its own view): data here is only the geometry the
 * player stands on and the point the chain lowers them from.
 */
export function addSootThroat(ctx) {
  const b = ctx.sec('c2-13');
  const gl = ctx.ledges.filter((l) => l.section === 'c2-13');
  const first = gl[0];
  const lip = { x: 0, y: r2(b.yBottom + 14), z: 0 };
  // the platform at the Throat's lip: wide, near the goal's floor
  box(ctx, 'c2-13-lip', -8, 8, lip.y - 1, lip.y, -8, 8, 'stone');
  ctx.lights.push({ x: 0, y: r2(lip.y + 2), z: 0, color: '#c08040', intensity: 1.0, range: 14, flicker: 0.2 });
  ctx.c2.hook = { section: 'c2-13', lip, first: first ? { x: first.x, y: first.y, z: first.z } : null, bottom: b.yBottom };
}
