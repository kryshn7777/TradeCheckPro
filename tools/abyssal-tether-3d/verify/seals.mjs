// LEVEL_FUN_PLAN P1 checks of the section seals (sim/objectives3d.js, level data `seals` / `fixtures` / `objectives`):
//
//   sealIntegrity  V1: every seal has one objective whose rings / fixtures (bell, lamps) hang above it, its plates stay
//                  inside the section's walls and touch no hazard, the next checkpoint and every deeper anchor lie below
//                  it. P3 verbs: a haul ring carries `haul`; a bell hangs clear of every solid (a strike bounces into the
//                  open) and out of reach from the ground (it is struck by swinging); a lamp is in the lantern's reach of
//                  a ledge and clear of the solids.
//   sealGaps       the seal-gap (airtight) check, seals closed: (a) a 1 m grid of vertical 6 m probes over the section's
//                  shaft just above the seal plane hits an active solid everywhere; (b) from every bot trace point and
//                  standing spot above a seal no anchor below it is targetable (exact TetherSystem.findTarget).
//   climbOut       from the standing spots on each closed seal: the share that sees an anchor above it (a way back up).
//   skipProbe      a greedy descender bot from every sealed section's checkpoint, its objective undone and its rings
//                  forbidden: it hooks the lowest ring it can target, lowers to the full rope, chains lower or lets go,
//                  fires at the lowest ring while falling (god mode: falls never end it). It must never get below the
//                  seal inside the shaft. It reports where it ended (on the grate / stuck / out of time) and whether a
//                  ring above is in sight from there.
//   verbProbe      LEVEL_FUN_PLAN P3, the fallback probe: every objective whose verb is not a plain hook (the S1 bell,
//                  the S2 haul, the S4 lamps; P5: the S5 keystone's haul fallback, the S7 survive clock), on its
//                  section's main line from the checkpoint: done by the bot without the creature (Sandbox, a Mason far
//                  away), done with the creature live (the verbs never wait for it; the haul and the bell are loud), and a
//                  lamp still lights with an empty lantern (twice as slow).
//   nookIntegrity  LEVEL_FUN_PLAN P5 V1: every Masons' rest lies in its section (and the level), its block holds its box, its budget
//                  is per difficulty, it stands on a ledge (a body fits), no fast-line-only ring is near it, a lure names
//                  a keystone right at its mouth.
import { Sim, Player3D, TetherSystem, EventBus, DIFFICULTY, HANDS, makeIntent, FRAME, Objectives3D, loadCreatureModules } from './sim.mjs';
import { Bot } from './bot.mjs';

const r1 = (v) => Math.round(v * 10) / 10;

/** Closed seals on a level (a fresh Objectives3D, every objective undone). */
export function closeSeals(L, v) {
  if (!Objectives3D) return null;
  const O = new Objectives3D(L, DIFFICULTY[v], null);
  O.reset();
  return O;
}

// -----------------------------------------------------------------------------
// V1
// -----------------------------------------------------------------------------
export function sealIntegrity(L, v, P) {
  const O = closeSeals(L, v);
  if (!O) return null;
  const out = { seals: O.seals.length, objectives: O.objectives.length, plates: L.sealSolids.length };
  const WALL = 3;
  if (O.seals.length !== O.objectives.length) P(`seals: ${O.seals.length} seals but ${O.objectives.length} objectives`);
  for (const s of O.seals) {
    const objs = O.objectives.filter((o) => o.seal === s.index);
    if (objs.length !== 1) P(`seal ${s.id}: ${objs.length} objectives (want exactly 1)`);
    const sec = L.sections[s.section];
    if (!sec || !sec.shaft) {
      P(`seal ${s.id}: no section / shaft`);
      continue;
    }
    if (s.section >= L.sections.length - 1) P(`seal ${s.id}: the last section is not sealed (it is the flight)`);
    const sh = sec.shaft;
    const nextSh = L.sections[s.section + 1] && L.sections[s.section + 1].shaft;
    for (const p of s.solids) {
      const inside = (q) => q && p.minX >= q.minX - WALL && p.maxX <= q.maxX + WALL && p.minZ >= q.minZ - WALL && p.maxZ <= q.maxZ + WALL;
      if (!inside(sh) && !inside(nextSh)) P(`seal plate ${p.id} reaches past the walls of ${sec.id} (and of the next section)`);
      for (const h of L.hazards) if (h.minX < p.maxX && h.maxX > p.minX && h.minY < p.maxY + 0.5 && h.maxY > p.minY && h.minZ < p.maxZ && h.maxZ > p.minZ) P(`seal plate ${p.id} touches hazard ${h.id}`);
    }
    const next = L.sections[s.section + 1];
    if (next && !(next.checkpoint.y < s.bottom)) P(`seal ${s.id}: checkpoint of ${next.id} (y ${next.checkpoint.y}) is not below it (${s.bottom})`);
    for (const a of L.anchors) {
      if (L.sectionIndexAt(a.y) > s.section && !(a.y < s.bottom)) P(`seal ${s.id}: anchor ${a.id} of a deeper section sits above it`);
    }
    for (const o of objs) {
      for (const fi of o.fx) {
        const f = O.fixtures[fi];
        const name = f.anchor ? `ring ${f.anchor.id}` : `${f.kind} ${f.id}`;
        if (!(f.y > s.top + 1)) P(`objective ${o.id}: ${name} does not hang above its seal ${s.id}`);
        if (L.sectionIndexAt(f.y) > s.section) P(`objective ${o.id}: ${name} lies below section ${sec.id}`);
        verbChecks(L, f, o, P);
      }
    }
  }
  return out;
}

/** LEVEL_FUN_PLAN P3: the fixture of a verb is usable as the verb says. */
function verbChecks(L, f, o, P) {
  const scratch = [];
  const clearOf = (x, y, z, r) => {
    for (const q of L.querySolids(x - r, y - r, z - r, x + r, y + r, z + r, scratch)) {
      if (q.active === false || q.seal) continue;
      const d = Math.hypot(Math.max(q.minX - x, 0, x - q.maxX), Math.max(q.minY - y, 0, y - q.maxY), Math.max(q.minZ - z, 0, z - q.maxZ));
      if (d < r) return q.id;
    }
    return null;
  };
  if (f.kind === 'haul' && f.anchor.haul !== true) P(`objective ${o.id}: haul ring ${f.anchor.id} does not carry the haul flag`);
  // LEVEL_FUN_PLAN P5: the keystone is a fixture solid (out of level.solids: no bake), its ring a haul ring on its face, its
  // lure rest right behind it; the survive box lies in its section and its pause solid is a ledge in it
  if (f.kind === 'breach') {
    if (!f.solid || L.solids.indexOf(f.solid) >= 0 || (L.fixtureSolids || []).indexOf(f.solid) < 0) P(`objective ${o.id}: keystone ${f.id} is not a fixture solid (kept out of level.solids)`);
    if (!f.anchor) P(`objective ${o.id}: keystone ${f.id} has no ring (no haul fallback)`);
    else {
      if (f.anchor.haul !== true) P(`objective ${o.id}: keystone ring ${f.anchor.id} does not carry the haul flag`);
      const s = f.solid;
      const d = Math.hypot(Math.max(s.minX - f.anchor.x, 0, f.anchor.x - s.maxX), Math.max(s.minY - f.anchor.y, 0, f.anchor.y - s.maxY), Math.max(s.minZ - f.anchor.z, 0, f.anchor.z - s.maxZ));
      if (d > 0.5) P(`objective ${o.id}: keystone ring ${f.anchor.id} is ${d.toFixed(2)} m off the stone`);
    }
  }
  if (f.kind === 'survive') {
    const b = f.box;
    const si = L.sectionIndexAt((b.minY + b.maxY) / 2);
    if (si !== o.section || L.sectionIndexAt(b.maxY) !== o.section) P(`objective ${o.id}: survive box ${f.id} reaches out of its section`);
    if (f.pause && !(f.pause.maxY > b.maxY)) P(`objective ${o.id}: pause ledge ${f.pause.id} lies inside the survive box (standing there would count)`);
  }
  if (f.kind === 'bell') {
    const hit = clearOf(f.x, f.y, f.z, f.r + 0.38 + 0.3);
    if (hit) P(`objective ${o.id}: bell ${f.id} is within a body's width of solid ${hit} (a strike must bounce into the open)`);
    // no ledge top within reach below it: a body standing there could lean on it instead of swinging into it
    for (const q of L.querySolids(f.x - 1.2, f.y - 2, f.z - 1.2, f.x + 1.2, f.y, f.z + 1.2, scratch)) {
      if (q.active === false || q.seal || q.maxY > f.y) continue;
      if (f.y - (q.maxY + 0.38) < f.r + 0.38 + 0.2) P(`objective ${o.id}: bell ${f.id} can be touched from ${q.id} without a swing`);
    }
  }
  if (f.kind === 'lamp') {
    let ledge = null;
    for (const q of L.querySolids(f.x - 2, f.y - 2.5, f.z - 2, f.x + 2, f.y + 0.5, f.z + 2, scratch)) {
      if (q.active === false || q.seal || q.kind === 'crumble') continue;
      const x = Math.max(q.minX + 0.38, Math.min(q.maxX - 0.38, f.x));
      const z = Math.max(q.minZ + 0.38, Math.min(q.maxZ - 0.38, f.z));
      if (q.maxX - q.minX >= 0.76 && q.maxZ - q.minZ >= 0.76 && Math.hypot(f.x - x, f.y - (q.maxY + 0.38), f.z - z) <= f.r + 0.5) ledge = q.id;
    }
    if (!ledge) P(`objective ${o.id}: lamp ${f.id} is out of the lantern's reach from every ledge`);
  }
}

// -----------------------------------------------------------------------------
// V1: the Masons' rests (LEVEL_FUN_PLAN P5)
// -----------------------------------------------------------------------------
export function nookIntegrity(L, v, P) {
  const O = closeSeals(L, v);
  if (!O) return null;
  const out = { nooks: O.nooks.length, perSection: {} };
  const routes = Array.isArray(L.data.routes) ? L.data.routes : [];
  const fastOnly = new Set();
  const byFork = new Map();
  for (const r of routes) (byFork.get(r.fork) || byFork.set(r.fork, {}).get(r.fork))[r.line] = r;
  for (const f of byFork.values()) if (f.fast && f.safe) for (const id of f.fast.ids) if (!f.safe.ids.includes(id)) fastOnly.add(id);
  const scratch = [];
  for (const n of O.nooks) {
    out.perSection[n.section] = (out.perSection[n.section] || 0) + 1;
    const sec = L.sections[n.section];
    if (!sec) P(`nook ${n.id}: no section`);
    if (L.sectionIndexAt(n.minY) !== n.section || L.sectionIndexAt(n.maxY) !== n.section) P(`nook ${n.id}: its box reaches out of ${sec ? sec.id : '?'}`);
    const b = n.block;
    if (!(b.minX <= n.minX && b.maxX >= n.maxX && b.minY <= n.minY && b.maxY >= n.maxY && b.minZ <= n.minZ && b.maxZ >= n.maxZ)) P(`nook ${n.id}: its block does not hold its box`);
    if (!(n.budget > 0) || n.budget > 60) P(`nook ${n.id}: budget ${n.budget} s (want 0 < budget <= 60)`);
    if (sec && sec.index === L.sections.length - 1) P(`nook ${n.id}: a rest in the last section (the flight has none)`);
    const B = L.bounds;
    if (B && (n.minX < B.minX || n.maxX > B.maxX || n.minZ < B.minZ || n.maxZ > B.maxZ)) P(`nook ${n.id}: outside the level`);
    // a ledge under it a body can stand on, and room for the body
    let floor = null;
    for (const q of L.querySolids(n.minX, n.minY - 0.6, n.minZ, n.maxX, n.minY + 0.05, n.maxZ, scratch)) if (q.active !== false && !q.seal && q.maxY <= n.minY + 0.05 && q.maxY >= n.minY - 0.6) floor = q.id;
    if (!floor) P(`nook ${n.id}: no ledge under its box`);
    if (n.maxX - n.minX < 0.8 || n.maxZ - n.minZ < 0.8 || n.maxY - n.minY < 1.8) P(`nook ${n.id}: box too small for a body (${(n.maxX - n.minX).toFixed(1)} x ${(n.maxZ - n.minZ).toFixed(1)} x ${(n.maxY - n.minY).toFixed(1)} m)`);
    for (const a of L.anchors) {
      if (!fastOnly.has(a.id)) continue;
      const d = Math.hypot(Math.max(n.minX - a.x, 0, a.x - n.maxX), Math.max(n.minY - a.y, 0, a.y - n.maxY), Math.max(n.minZ - a.z, 0, a.z - n.maxZ));
      if (d < 6) P(`nook ${n.id}: fast-line ring ${a.id} ${d.toFixed(1)} m away (rests are for the safe lines)`);
    }
    if (n.lure) {
      const f = n.fixture >= 0 ? O.fixtures[n.fixture] : null;
      if (!f || f.kind !== 'breach' || !f.solid) P(`nook ${n.id}: a lure without a keystone`);
      else {
        const s = f.solid;
        const gap = Math.hypot(Math.max(s.minX - n.maxX, 0, n.minX - s.maxX), Math.max(s.minY - n.maxY, 0, n.minY - s.maxY), Math.max(s.minZ - n.maxZ, 0, n.minZ - s.maxZ));
        if (gap > 0.5) P(`nook ${n.id}: its keystone ${s.id} stands ${gap.toFixed(2)} m from its mouth`);
      }
    }
  }
  for (const [si, k] of Object.entries(out.perSection)) if (k > 24) P(`section ${si}: ${k} rests (E18 budget 24)`);
  return out;
}

// -----------------------------------------------------------------------------
// The seal-gap (airtight) check
// -----------------------------------------------------------------------------
export function sealGaps(L, v, traces, P) {
  const O = closeSeals(L, v);
  if (!O) return null;
  const diff = DIFFICULTY[v];
  const T = new TetherSystem(L, diff, new EventBus(), {});
  const p = new Player3D(0, 0, 0);
  const res = {};
  const range = diff.aimRange; // the widest reach (the anchor query); each test uses the section's (LEVEL_FUN_PLAN item 5)
  const near = [];
  const at = { y: 0 };
  const targetable = (q, a) => {
    const dx = a.x - q[0];
    const dy = a.y - q[1];
    const dz = a.z - q[2];
    const l = Math.hypot(dx, dy, dz);
    at.y = q[1];
    if (l > T.aimRangeAt(at) || l < 0.5) return false;
    p.x = q[0];
    p.y = q[1];
    p.z = q[2];
    const f = T.findTarget(p, { ox: q[0], oy: q[1], oz: q[2], dx: dx / l, dy: dy / l, dz: dz / l }, 'right');
    return !!f && f.anchor === a;
  };
  // standing spots: the top of every solid (2 m grid), as coverage V3 does
  const standing = [];
  for (const s of L.solids) {
    if (s.kind === 'wall' && s.tag !== 'floor') continue;
    if (s.maxX - s.minX < 1.2 || s.maxZ - s.minZ < 1.2) continue;
    for (let x = s.minX + 0.5; x <= s.maxX - 0.5; x += 2) for (let z = s.minZ + 0.5; z <= s.maxZ - 0.5; z += 2) standing.push([x, s.maxY + 0.38, z]);
  }
  const pts = [];
  for (const tr of traces) for (let i = 0; i < tr.length; i += 3) pts.push([tr[i], tr[i + 1], tr[i + 2]]);
  for (const s of O.seals) {
    const sec = L.sections[s.section];
    const sh = sec.shaft;
    // (a) vertical probes over the section's shaft, from 6 m above the seal's top to just under its bottom
    let probes = 0;
    const holes = [];
    const depth = 6 + (s.top - s.bottom) + 0.05;
    for (let x = sh.minX + 0.5; x < sh.maxX; x += 1) {
      for (let z = sh.minZ + 0.5; z < sh.maxZ; z += 1) {
        probes++;
        if (!L.raycast(x, s.top + 6, z, 0, -1, 0, depth)) holes.push([x, z]);
      }
    }
    // (b) sight lines from above the seal to the anchors below it
    const leaks = [];
    let pairs = 0;
    const above = pts.concat(standing).filter((q) => q[1] > s.top + 0.3 && q[1] < sec.yTop + 40);
    for (const q of above) {
      L.anchorsNear(q[0], q[1], q[2], range, near);
      for (const a of near) {
        if (!(a.y < s.bottom)) continue;
        pairs++;
        if (targetable(q, a) && leaks.length < 12) leaks.push(`${a.id} from (${r1(q[0])}, ${r1(q[1])}, ${r1(q[2])})`);
      }
    }
    res[s.id] = { probes, holes: holes.length, firstHoles: holes.slice(0, 6), from: above.length, pairs, leaks };
    if (holes.length) P(`seal ${s.id}: ${holes.length} of ${probes} probes over ${sec.id}'s shaft fall through (first at x ${holes[0][0]}, z ${holes[0][1]})`);
    if (leaks.length) P(`seal ${s.id}: anchors below it are targetable from above: ${leaks.slice(0, 4).join('; ')}`);
  }
  return res;
}

// -----------------------------------------------------------------------------
// Climb-out from a closed seal
// -----------------------------------------------------------------------------
export function climbOut(L, v, P) {
  const O = closeSeals(L, v);
  if (!O) return null;
  const diff = DIFFICULTY[v];
  const T = new TetherSystem(L, diff, new EventBus(), {});
  const p = new Player3D(0, 0, 0);
  const near = [];
  const scratch = [];
  const climbs = [];
  const res = {};
  for (const s of O.seals) {
    let spots = 0;
    let out = 0;
    for (const plate of s.solids) {
      for (let x = plate.minX + 0.5; x <= plate.maxX - 0.5; x += 1) {
        for (let z = plate.minZ + 0.5; z <= plate.maxZ - 0.5; z += 1) {
          const y = plate.maxY + 0.38;
          let blocked = false;
          for (const o of L.querySolids(x - 0.38, plate.maxY + 0.02, z - 0.38, x + 0.38, plate.maxY + 1.7, z + 0.38, scratch)) if (o.active !== false && !o.seal) blocked = true;
          if (blocked) continue;
          spots++;
          let ok = L.climbNear(x, y, z, 1, climbs).length > 0;
          if (!ok) {
            L.anchorsNear(x, y, z, diff.aimRange, near);
            for (const a of near) {
              if (a.y <= s.top + 0.5) continue;
              const dx = a.x - x;
              const dy = a.y - y;
              const dz = a.z - z;
              const l = Math.hypot(dx, dy, dz);
              if (l > T.aimRangeAt(L.sectionIndexAt(y))) continue; // the section's reach where it stands
              p.x = x;
              p.y = y;
              p.z = z;
              const f = T.findTarget(p, { ox: x, oy: y, oz: z, dx: dx / l, dy: dy / l, dz: dz / l }, 'right');
              if (f && f.anchor === a) {
                ok = true;
                break;
              }
            }
          }
          if (ok) out++;
        }
      }
    }
    res[s.id] = { spots, wayUp: out, share: spots ? +(out / spots).toFixed(2) : 0 };
    if (spots && !out) P(`seal ${s.id}: no standing spot on it sees a ring above (no way back up)`);
  }
  return res;
}

// -----------------------------------------------------------------------------
// The skip probe: a greedy descender
// -----------------------------------------------------------------------------
const PROBE_SECONDS = 60;

/** Greedy descent from section `si`'s checkpoint with its objective undone. */
export function probeSection(L, v, si) {
  const sim = new Sim(L, v);
  if (!sim.objectives) return null;
  const sec = L.sections[si];
  const cp = sec.checkpoint;
  sim.spawn(cp.x, cp.y, cp.z, si);
  sim.physics.health.god = true; // falls never end the probe: it keeps trying
  const O = sim.objectives;
  const seal = O.seals.find((s) => s.section === si);
  if (!seal) return null;
  const forbidden = new Set();
  for (const f of O.fixtures) if (!O.done[f.obj]) forbidden.add(f.anchor);
  const T = sim.tethers;
  const p = sim.player;
  const range = sim.diff.aimRange; // the anchor query; targetable() applies the section's reach (LEVEL_FUN_PLAN item 5)
  const maxRope = T.maxRopeLength();
  const used = new Set();
  const near = [];
  const it = makeIntent();
  const holding = { left: false, right: false };
  let lastHand = 'left';
  let stuck = 0;
  let minY = p.y;
  let passed = null;
  let left = null;
  let end = 'time';
  const hooks = [];
  const shaftHas = (x, y, z) => {
    const sh = L.shaftAt(y);
    return !!sh && x >= sh.minX - 0.5 && x <= sh.maxX + 0.5 && z >= sh.minZ - 0.5 && z <= sh.maxZ + 0.5;
  };
  const targetable = (a, hand) => {
    const dx = a.x - p.x;
    const dy = a.y - p.y;
    const dz = a.z - p.z;
    const l = Math.hypot(dx, dy, dz);
    if (l > T.aimRangeAt(p) || l < 0.5 || a.broken) return false;
    const f = T.findTarget(p, { ox: p.x, oy: p.y, oz: p.z, dx: dx / l, dy: dy / l, dz: dz / l }, hand);
    return !!f && f.anchor === a;
  };
  /** The lowest ring in reach (below `maxY`), not forbidden / used / the current one. */
  const lowest = (hand, maxY, skip) => {
    L.anchorsNear(p.x, p.y, p.z, range, near);
    let best = null;
    for (const a of near) {
      if (forbidden.has(a) || used.has(a) || a === skip || a.y > maxY) continue;
      if (best && a.y >= best.y) continue;
      if (targetable(a, hand)) best = a;
    }
    return best;
  };
  const aim = (hand, a) => {
    const dx = a.x - p.x;
    const dy = a.y - p.y;
    const dz = a.z - p.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    it.hands[hand].aim = { ox: p.x, oy: p.y, oz: p.z, dx: dx / l, dy: dy / l, dz: dz / l };
  };
  const press = (hand, a) => {
    aim(hand, a);
    it.hands[hand].pressed = true;
    it.hands[hand].held = true;
    holding[hand] = true;
    lastHand = hand;
    hooks.push(a.id);
  };
  const letGo = (hand) => {
    if (!holding[hand]) return;
    holding[hand] = false;
    it.hands[hand].held = false;
    it.hands[hand].released = true;
  };
  /**
   * Nothing to hook from where it stands: walk off the nearest open side of the ledge (1 m past its edge there is no
   * solid at standing height) that it has not tried yet, and catch the lowest ring while falling.
   */
  const tried = new Set();
  const scratch = [];
  let walk = null;
  const stepOff = () => {
    const gs = p.groundSolid;
    if (!gs) return null;
    const cand = [
      ['w', gs.minX - 1, Math.max(gs.minZ, Math.min(gs.maxZ, p.z)), p.x - gs.minX],
      ['e', gs.maxX + 1, Math.max(gs.minZ, Math.min(gs.maxZ, p.z)), gs.maxX - p.x],
      ['n', Math.max(gs.minX, Math.min(gs.maxX, p.x)), gs.minZ - 1, p.z - gs.minZ],
      ['s', Math.max(gs.minX, Math.min(gs.maxX, p.x)), gs.maxZ + 1, gs.maxZ - p.z],
    ].sort((a, b) => a[3] - b[3]);
    for (const [side, x, z] of cand) {
      const key = `${gs.id}:${side}`;
      if (tried.has(key)) continue;
      tried.add(key);
      let open = true;
      for (const o of L.querySolids(x - 0.4, gs.maxY + 0.1, z - 0.4, x + 0.4, gs.maxY + 1.8, z + 0.4, scratch)) if (o.active !== false) open = false;
      if (open) return { x, z, t: 0 };
    }
    return null;
  };
  const frames = Math.round(PROBE_SECONDS / FRAME);
  let chainFrom = null;
  for (let f = 0; f < frames; f++) {
    it.move.x = 0;
    it.move.z = 0;
    it.reel = 0;
    it.brake = false;
    for (const h of HANDS) {
      const hi = it.hands[h];
      hi.pressed = false;
      hi.released = false;
      hi.held = holding[h];
    }
    // a rope that broke or a hook that fell off while held: let go
    for (const h of HANDS) if (holding[h] && !T.hands[h].rope.attached && !T.hands[h].flying) letGo(h);
    const att = HANDS.filter((h) => T.hands[h].rope.attached);
    const flying = HANDS.some((h) => T.hands[h].flying);
    if (chainFrom && att.some((h) => h !== chainFrom)) {
      letGo(chainFrom); // the new hook bit: let go of the old line
      chainFrom = null;
    }
    if (!flying) {
      if (!att.length) {
        const hand = lastHand === 'left' ? 'right' : 'left';
        const a = walk && p.grounded ? null : lowest(hand, p.grounded ? p.y + range : p.y - 0.5, null);
        if (a) {
          press(hand, a);
          stuck = 0;
          walk = null;
        } else if (p.grounded) {
          if (walk && (walk.t += FRAME) > 6) walk = null;
          if (!walk) walk = stepOff();
          if (walk) {
            const dx = walk.x - p.x;
            const dz = walk.z - p.z;
            const d = Math.hypot(dx, dz) || 1;
            it.move.x = dx / d;
            it.move.z = dz / d;
          } else if (++stuck > 30) {
            end = 'stuck';
            break;
          }
        } else walk = null;
      } else {
        const h = att[att.length - 1];
        const st = T.hands[h];
        const A = st.rope.anchor;
        if (p.grounded) {
          // standing while tethered: walk off toward the ring's plumb line (the rope takes the weight)
          const dx = A.x - p.x;
          const dz = A.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.3) {
            it.move.x = dx / d;
            it.move.z = dz / d;
          }
          it.reel = -1;
          if (st.rope.length >= maxRope - 0.05 || (d <= 0.3 && st.attachTime > 1.5)) {
            used.add(A);
            letGo(h);
          }
        } else {
          // hanging: damp the swing over the ring and let the rope out; at full rope chain lower or let go
          it.move.x = Math.max(-1, Math.min(1, (A.x - p.x) * 0.5 - p.vx * 0.6));
          it.move.z = Math.max(-1, Math.min(1, (A.z - p.z) * 0.5 - p.vz * 0.6));
          it.reel = -1;
          if (st.rope.length >= maxRope - 0.05 && Math.abs(p.vy) < 1.5) {
            const other = h === 'left' ? 'right' : 'left';
            const b = lowest(other, p.y - 0.5, A);
            used.add(A);
            if (b) {
              press(other, b);
              chainFrom = h;
            } else letGo(h);
          }
        }
      }
    }
    sim.frame(it);
    if (p.y < minY) minY = p.y;
    if (!passed && p.y < seal.bottom - 0.5 && !O.done[O.objectiveOfSeal(seal.index).index]) {
      if (shaftHas(p.x, p.y, p.z)) passed = { x: r1(p.x), y: r1(p.y), z: r1(p.z), t: r1(sim.t) };
      else if (!left) left = { x: r1(p.x), y: r1(p.y), z: r1(p.z), t: r1(sim.t) };
    }
    if (passed) break;
    if (!p.alive) {
      end = 'dead';
      break;
    }
  }
  const gs = p.grounded ? p.groundSolid : null;
  if (end === 'stuck' && gs && gs.seal) end = 'grate';
  // a way back up from where it ended: any ring above the seal in sight (the objective's own ring included)
  let wayUp = null;
  if (gs && gs.seal) {
    wayUp = false;
    forbidden.clear();
    used.clear();
    L.anchorsNear(p.x, p.y, p.z, range, near);
    for (const a of near) if (a.y > seal.top + 0.5 && targetable(a, 'right')) wayUp = true;
  }
  return {
    section: sec.id,
    seal: seal.id,
    passed,
    leftShaft: left,
    end,
    on: gs ? gs.id : null,
    onSeal: !!(gs && gs.seal),
    wayUp,
    at: [r1(p.x), r1(p.y), r1(p.z)],
    minY: r1(minY),
    t: r1(sim.t),
    hooks: hooks.slice(0, 16),
    objectiveDone: !!O.done[O.objectiveOfSeal(seal.index).index],
    verb: O.objectiveOfSeal(seal.index).verb,
  };
}

/** The skip probe from every sealed section. `P` reports failures. */
export function skipProbe(L, v, P) {
  if (!Objectives3D) return null;
  const O = closeSeals(L, v);
  const res = {};
  for (const s of O.seals) {
    const r = probeSection(L, v, s.section);
    if (!r) continue;
    res[r.section] = r;
    if (r.passed) P(`skip probe ${r.section}: got below ${r.seal} with its objective undone at (${r.passed.x}, ${r.passed.y}, ${r.passed.z}) t ${r.passed.t}s`);
    // (a survive objective is done by time alone: surviving is the objective, so the probe may complete it; it must still
    // never pass the seal before)
    if (r.objectiveDone && r.verb !== 'survive') P(`skip probe ${r.section}: completed the objective it must not touch`);
    if (r.onSeal && r.wayUp === false) P(`skip probe ${r.section}: ended on ${r.on} at ${r.at.join(', ')} with no ring above in sight (no way back up)`);
  }
  return res;
}

// -----------------------------------------------------------------------------
// The fallback probe (LEVEL_FUN_PLAN P3)
// -----------------------------------------------------------------------------
/** An empty lantern for the probe: relights take twice as long, nothing is left to spend. */
const EMPTY_LANTERN = Object.freeze({ lanternCharge: 0, spend: () => 0 });

/**
 * Every non-hook objective on its section's main line (R.ROUTES[section id]) from the section's checkpoint, in three ways:
 * plain (no creature), with the creature live (non-lethal, seeded) and, for lamps, with an empty lantern. Returns
 * { objId: { verb, section, plain: { ok, at, time }, creature: {...}, emptyLantern?: {...} } }; `at` = the run time the
 * objective was done. `P` reports failures.
 */
export async function verbProbe(makeLevel, v, R, P) {
  if (!Objectives3D) return null;
  await loadCreatureModules();
  const L = makeLevel(v);
  const O = closeSeals(L, v);
  const out = {};
  for (const o of O.objectives) {
    if (o.verb === 'hook') continue;
    const sec = L.sections[o.section];
    const route = R.ROUTES[sec.id];
    if (!route) continue;
    const row = { verb: o.verb, section: sec.id };
    const cases = [
      ['plain', {}, null],
      ['creature', { creature: { seed: 0x5eed + o.section } }, null],
    ];
    if (o.verb === 'lamp') cases.push(['emptyLantern', {}, EMPTY_LANTERN]);
    for (const [name, opts, lantern] of cases) {
      const lvl = makeLevel(v);
      const sim = new Sim(lvl, v, opts);
      const cp = lvl.sections[o.section].checkpoint;
      sim.spawn(cp.x, cp.y, cp.z);
      if (lantern) sim.objectives.lantern = lantern;
      const r = new Bot(sim, route, {}).runRoute();
      const ev = sim.objEvents.find((e) => e[1] === 'objective' && e[2] === o.id);
      row[name] = { ok: r.ok && !!ev, at: ev ? ev[0] : null, time: +r.time.toFixed(1) };
      if (!row[name].ok) P(`verb probe ${o.id} (${o.verb}, ${name}): ${ev ? '' : 'never done; '}${r.fail || ''}`);
    }
    out[o.id] = row;
  }
  return out;
}
