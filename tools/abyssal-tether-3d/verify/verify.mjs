// Abyssal Tether 3D verification harness (ENGINE_EXTENSIONS E28 / §8 gates).
//
//   npm run verify:at3d -- [--chapter ch1|all] [--variant normal|nightmare|abyss|all]
//                          [--root DIR] [--out DIR] [--skip-budget] [--skip-determinism]
//                          [--write-baseline]
//
// Per chapter and variant: integrity (V1), full spawn → goal runs on every line of the
// fork (V2), every section route from its checkpoint, the alternate lines, the fork
// timing (CHAPTERS S6), the recovery scenarios, anchor knowability / line-of-sight
// coverage (V3), determinism of bot run, re-run and input-log replay (V13), object
// counts (V12) and the sim budget per system (E29). Chapter I is today's level; every
// value is compared with baselines/verify-<chapter>.json (V14 read-out: differences are
// listed, not failed; --write-baseline records the current numbers as the new baseline).
// Writes out/verify-<chapter>.json and out/traces-<chapter>.json; exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, Player3D, TetherSystem, Physics3D, EventBus, DIFFICULTY, CONFIG, GAME_ROOT } from './sim.mjs';
import { Bot } from './bot.mjs';
import { CHAPTERS, chapterIds, variantKeys } from './chapters.mjs';
import { measureBudget, formatBudget } from './budget.mjs';
import { compareReports } from './compare.mjs';
import { argValue, hasFlag, srcUrl } from './root.mjs';
import { sealIntegrity, sealGaps, climbOut, skipProbe } from './seals.mjs';
// WP-BAG: the seeded supply picker (absent in older checkouts given with --root: the supply checks are then skipped)
const { pickSupplies, checkFairness } = await import(srcUrl('sim/pickups3d.js')).catch(() => ({}));

const argv = process.argv.slice(2);
if (hasFlag(argv, '-h', '--help')) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(src.slice(0, src.findIndex((l) => l.startsWith('import '))).join('\n'));
  process.exit(0);
}
const CHAPTER_IDS = chapterIds(argValue(argv, '--chapter', 'all'));
const VARIANTS = variantKeys(argValue(argv, '--variant', 'all'));
const OUT_DIR = path.resolve(argValue(argv, '--out', fileURLToPath(new URL('./out/', import.meta.url))));
const DO_BUDGET = !hasFlag(argv, '--skip-budget');
const DO_DETERMINISM = !hasFlag(argv, '--skip-determinism');
const WRITE_BASELINE = hasFlag(argv, '--write-baseline');
const BASELINE_DIR = fileURLToPath(new URL('./baselines/', import.meta.url));
fs.mkdirSync(OUT_DIR, { recursive: true });

const LAND_OK = 0.85; // a landing at ≥ 85 % of the lethal impact fails a route
/** Reach floors (LEVEL_FUN_PLAN item 5): every hook shot of every bot line is fired from at most the section's reach − this. */
const REACH_MARGIN = 1.5;
/** Per variant, per section index: the longest shot of any bot line { d, id, line } (filled by runRoute). */
let reachLog = {};
let failures = 0;
let chapterFailures = [];
const fail = (msg) => {
  failures++;
  chapterFailures.push(msg);
  console.log('  FAIL', msg);
};

// -----------------------------------------------------------------------------
// V1 Integrity
// -----------------------------------------------------------------------------
function integrity(ch, v) {
  const L = ch.makeLevel(v);
  const R = ch.routes;
  const diff = DIFFICULTY[v];
  const out = { problems: [] };
  const P = (m) => {
    out.problems.push(m);
    fail(`[${ch.id}/${v}] ${m}`);
  };
  // Sections contiguous, checkpoints inside their sections.
  for (let i = 0; i < L.sections.length; i++) {
    const s = L.sections[i];
    if (!(s.yTop > s.yBottom)) P(`section ${s.id} yTop <= yBottom`);
    if (i > 0 && L.sections[i - 1].yBottom !== s.yTop) P(`section ${s.id} not contiguous with ${L.sections[i - 1].id}`);
    const cp = s.checkpoint;
    if (L.sectionIndexAt(cp.y) !== i) P(`checkpoint of ${s.id} (y ${cp.y}) is not inside its section`);
    if (!s.shaft) P(`section ${s.id} has no shaft footprint`);
  }
  if (L.spawn.x !== L.sections[0].checkpoint.x || L.spawn.y !== L.sections[0].checkpoint.y) P('spawn differs from S1 checkpoint');
  // Checkpoints rest on a floor.
  const bus = new EventBus();
  for (const s of L.sections) {
    const cp = s.checkpoint;
    const p = new Player3D(cp.x, cp.y, cp.z);
    const T = new TetherSystem(L, diff, bus, {});
    const ph = new Physics3D(L, diff, bus);
    let groundedAt = -1;
    for (let k = 0; k < 240; k++) {
      ph.step(p, T, {}, CONFIG.PHYSICS_DT);
      if (p.grounded && groundedAt < 0) groundedAt = k;
    }
    const drift = Math.hypot(p.x - cp.x, p.y - cp.y, p.z - cp.z);
    if (!p.alive || groundedAt < 0 || groundedAt > 24 || drift > 0.1) P(`checkpoint ${s.id} not resting on a floor (grounded@${groundedAt}, drift ${drift.toFixed(2)}, alive ${p.alive})`);
    const under = p.groundSolid;
    if (under && under.kind === 'crumble') P(`checkpoint ${s.id} stands on a crumbling ledge`);
    out[`cp_${s.id}`] = { groundedAfterSteps: groundedAt, drift: +drift.toFixed(3), on: under ? under.id : null };
  }
  // Anchors: not inside solids, mounted on something.
  const scratch = [];
  for (const a of L.anchors) {
    const list = L.querySolids(a.x - 0.3, a.y - 0.3, a.z - 0.3, a.x + 0.3, a.y + 0.3, a.z + 0.3, scratch);
    for (const s of list) {
      const dx = Math.max(s.minX - a.x, 0, a.x - s.maxX);
      const dy = Math.max(s.minY - a.y, 0, a.y - s.maxY);
      const dz = Math.max(s.minZ - a.z, 0, a.z - s.maxZ);
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.1) P(`anchor ${a.id} is inside / touching solid ${s.id} (d ${d.toFixed(2)})`);
    }
    let mounted = false;
    if (L.data.anchors.find((o) => o.id === a.id).mount === 'chain') {
      mounted = L.decor.some((d) => d.type === 'chain' && Math.abs(d.x - a.x) < 0.01 && Math.abs(d.z - a.z) < 0.01 && d.y - d.sy / 2 >= a.y && d.y - d.sy / 2 < a.y + 0.6);
    } else {
      const bx = a.x - a.normal.x * 0.45;
      const by = a.y - a.normal.y * 0.45;
      const bz = a.z - a.normal.z * 0.45;
      for (const s of L.querySolids(bx - 0.05, by - 0.05, bz - 0.05, bx + 0.05, by + 0.05, bz + 0.05, scratch)) {
        if (bx >= s.minX && bx <= s.maxX && by >= s.minY && by <= s.maxY && bz >= s.minZ && bz <= s.maxZ) mounted = true;
      }
    }
    if (!mounted) P(`anchor ${a.id} is not mounted (no solid 0.45 m behind its normal / no chain)`);
  }
  // Supplies (WP-BAG): the candidate spots of the bag's consumables sit on ledges, never in solids, clear of anchors and of
  // the checkpoint -> route-anchor sight lines; 6-10 per section; the seeded picker is fair and deterministic.
  out.supplies = supplyChecks(L, P);
  // Climb zones (WP-CLIMB): authored grip surfaces hug a solid (or a chain), keep clear of hazards, leave room for the climber,
  // fit the stamina budget and stay in numbers that cannot be chained into a way round the routes.
  out.climb = climbChecks(L, P);
  // Hazards / spikes never overlap a checkpoint or the goal.
  for (const h of L.hazards) {
    for (const s of L.sections) {
      const c = s.checkpoint;
      if (c.x > h.minX - 1 && c.x < h.maxX + 1 && c.y > h.minY - 1 && c.y < h.maxY + 1 && c.z > h.minZ - 1 && c.z < h.maxZ + 1) P(`hazard ${h.id} next to checkpoint ${s.id}`);
    }
  }
  // Goal is standable: a body dropped in the goal centre lands inside it.
  const g = L.goal;
  const p = new Player3D((g.minX + g.maxX) / 2, g.minY + 1.5, (g.minZ + g.maxZ) / 2);
  const ph = new Physics3D(L, diff, bus);
  const T = new TetherSystem(L, diff, bus, {});
  for (let k = 0; k < 240; k++) ph.step(p, T, {}, CONFIG.PHYSICS_DT);
  if (!p.grounded || !L.inGoal(p.x, p.y, p.z)) P('goal box is not standable');
  // Gate sits across the chamber mouth, between the throat floor and the goal.
  if (L.gate && !(L.gate.maxZ <= g.minZ)) P('gate is not in front of the goal');
  // Rope reach: every lowering anchor reaches its platform within the variant's max rope.
  const maxRope = diff.aimRange + CONFIG.rope.maxLengthBonus;
  for (const key of Object.keys(R.ROUTES)) {
    const r = R.ROUTES[key];
    for (let i = 1; i < r.length; i++) {
      if (r[i].mode !== 'lower' || !r[i - 1].a) continue;
      const aid = r[i - 1].a;
      const an = L.byId[Array.isArray(aid) ? aid.find((k) => L.byId[k]) : aid];
      const pid = Array.isArray(r[i].p) ? r[i].p.find((k) => L.byId[k]) : r[i].p;
      const pl = L.byId[pid];
      const need = an.y - (pl.maxY + 0.38);
      if (need > maxRope - 0.5) P(`${key}: lowering from ${an.id} onto ${pl.id} needs ${need.toFixed(1)} m of rope (max ${maxRope})`);
    }
  }
  // Variant sanity: recovery anchors thin out.
  out.recovery = L.anchors.filter((a) => a.tag === 'recovery').map((a) => `${a.id}:${a.kind}`);
  out.ids = idChecks(L, P);
  // Seals (LEVEL_FUN_PLAN P1): one objective each, rings above, plates inside the walls, the next checkpoint below.
  out.seals = sealIntegrity(L, v, P);
  out.ok = out.problems.length === 0;
  return out;
}

/** Distance from point (px,py,pz) to the segment a-b. */
function distPointSegment(px, py, pz, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy + (pz - a.z) * dz) / l2)) : 0;
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t), pz - (a.z + dz * t));
}

/** WP-BAG: validates level.data.supplies against the live level of this variant (see level-data-3d.js SUPPLIES). */
function supplyChecks(L, P) {
  if (!pickSupplies) return null;
  const sup = Array.isArray(L.data.supplies) ? L.data.supplies : [];
  const out = { spots: sup.length, perSection: [], picks: 0 };
  if (!sup.length) {
    P('no supplies authored (level.data.supplies)');
    return out;
  }
  const scratch = [];
  const ids = new Set();
  const perSec = L.sections.map(() => 0);
  const routeAnchors = L.anchors.filter((a) => a.tag !== 'risk');
  for (const s of sup) {
    if (ids.has(s.id)) P(`supply ${s.id}: duplicate id`);
    ids.add(s.id);
    if (![s.x, s.y, s.z].every(Number.isFinite)) {
      P(`supply ${s.id}: non-finite position`);
      continue;
    }
    const si = L.sectionIndexAt(s.y);
    if (si < 0) {
      P(`supply ${s.id}: outside every section (y ${s.y})`);
      continue;
    }
    perSec[si]++;
    if (!Array.isArray(s.w) || s.w.length !== 4 || s.w.some((v) => !(v >= 0)) || !(s.w[0] + s.w[1] + s.w[2] + s.w[3] > 0)) P(`supply ${s.id}: bad kind weights`);
    // Not inside (or touching) a solid, and resting on a floor 0.25-0.8 m below.
    let resting = false;
    for (const o of L.querySolids(s.x - 0.3, s.y - 1, s.z - 0.3, s.x + 0.3, s.y + 0.3, s.z + 0.3, scratch)) {
      const dx = Math.max(o.minX - s.x, 0, s.x - o.maxX);
      const dy = Math.max(o.minY - s.y, 0, s.y - o.maxY);
      const dz = Math.max(o.minZ - s.z, 0, s.z - o.maxZ);
      if (Math.hypot(dx, dy, dz) < 0.2) P(`supply ${s.id} is inside / touching solid ${o.id}`);
      const inX = s.x >= o.minX + 0.1 && s.x <= o.maxX - 0.1 && s.z >= o.minZ + 0.1 && s.z <= o.maxZ - 0.1;
      if (inX && o.kind !== 'crumble' && s.y - o.maxY >= 0.25 && s.y - o.maxY <= 0.8) resting = true;
    }
    if (!resting) P(`supply ${s.id} does not rest on a solid floor 0.25-0.8 m below`);
    for (const a of L.anchors) {
      const d = Math.hypot(a.x - s.x, a.y - s.y, a.z - s.z);
      if (d < 1.5) P(`supply ${s.id} is ${d.toFixed(2)} m from anchor ${a.id} (min 1.5)`);
    }
    for (const h of L.hazards) {
      const dx = Math.max(h.minX - s.x, 0, s.x - h.maxX);
      const dy = Math.max(h.minY - s.y, 0, s.y - h.maxY);
      const dz = Math.max(h.minZ - s.z, 0, s.z - h.maxZ);
      if (Math.hypot(dx, dy, dz) < 2) P(`supply ${s.id} is within 2 m of hazard ${h.id}`);
    }
    const cp = L.sections[si].checkpoint;
    if (Math.hypot(cp.x - s.x, cp.y - s.y, cp.z - s.z) < 1.2) P(`supply ${s.id} is on top of the checkpoint of ${L.sections[si].id}`);
    // Anchor sight lines: the segment from the checkpoint eye to each route anchor of the section, and between consecutive route anchors.
    const eye = { x: cp.x, y: cp.y + 1.24, z: cp.z };
    const inSec = routeAnchors.filter((a) => a.section === si).sort((a, b) => b.y - a.y);
    for (let i = 0; i < inSec.length; i++) {
      const d1 = distPointSegment(s.x, s.y, s.z, eye, inSec[i]);
      if (d1 < 0.75) P(`supply ${s.id} sits on the sight line checkpoint -> ${inSec[i].id} (${d1.toFixed(2)} m)`);
      if (i > 0) {
        const d2 = distPointSegment(s.x, s.y, s.z, inSec[i - 1], inSec[i]);
        if (d2 < 0.75) P(`supply ${s.id} sits on the sight line ${inSec[i - 1].id} -> ${inSec[i].id} (${d2.toFixed(2)} m)`);
      }
    }
  }
  out.perSection = perSec;
  perSec.forEach((n, i) => {
    if (n < 6 || n > 10) P(`section ${L.sections[i].id} has ${n} supply spots (want 6-10)`);
  });
  // The picker: deterministic per seed, ~1/3 of the spots, fair, and different seeds differ.
  const spots = sup.map((s) => ({ x: s.x, y: s.y, z: s.z, section: Math.max(0, L.sectionIndexAt(s.y)), tier: s.tier, w: s.w }));
  let counts = 0;
  let distinct = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const a = pickSupplies(spots, seed, { sections: L.sections.length });
    const b = pickSupplies(spots, seed, { sections: L.sections.length });
    if (JSON.stringify(a) !== JSON.stringify(b)) P(`supply picker is not deterministic for seed ${seed}`);
    const probs = checkFairness(spots, a, L.sections.length);
    if (probs.length) P(`supply picker seed ${seed} is unfair: ${probs.join('; ')}`);
    counts += a.length;
    distinct.add(a.map((c) => `${c.spot}:${c.kind}`).join(','));
  }
  out.picks = +(counts / 60).toFixed(1);
  out.distinctRuns = distinct.size;
  if (out.picks < sup.length * 0.25 || out.picks > sup.length * 0.5) P(`supply picker picks ${out.picks} of ${sup.length} spots on average (want about a third)`);
  if (distinct.size < 40) P(`supply picker gives only ${distinct.size} different layouts in 60 seeds`);
  return out;
}

/** WP-CLIMB: validates level.climb (see level-data-3d.js CLIMB ZONES). Older checkouts without climb zones skip it. */
function climbChecks(L, P) {
  if (!Array.isArray(L.climb)) return null;
  const K = CONFIG.climb;
  const zones = L.climb;
  const out = { zones: zones.length, perSection: L.sections.map(() => 0), maxHeight: 0, maxCost: 0 };
  if (!zones.length) {
    P('no climb zones authored (level.data.climb)');
    return out;
  }
  const scratch = [];
  const ids = new Set();
  const inside = (x, y, z, pad = 0) => {
    for (const o of L.querySolids(x - 0.02, y - 0.02, z - 0.02, x + 0.02, y + 0.02, z + 0.02, scratch)) {
      if (x >= o.minX - pad && x <= o.maxX + pad && y >= o.minY - pad && y <= o.maxY + pad && z >= o.minZ - pad && z <= o.maxZ + pad) return true;
    }
    return false;
  };
  for (const z of zones) {
    if (ids.has(z.id)) P(`climb zone ${z.id}: duplicate id`);
    ids.add(z.id);
    if (![z.minX, z.minY, z.minZ, z.maxX, z.maxY, z.maxZ].every(Number.isFinite)) {
      P(`climb zone ${z.id}: non-finite box`);
      continue;
    }
    if (z.section >= 0) out.perSection[z.section]++;
    else P(`climb zone ${z.id}: outside every section`);
    const h = z.maxY - z.minY;
    if (h > out.maxHeight) out.maxHeight = h;
    // stamina budget of climbing the whole zone at the nominal pace (one hand at a time, no rests) must leave a margin
    const cost = (h / K.moveRef) * (K.hangDrain + K.moveDrain) * (z.wet ? K.wetMul : 1) * (DIFFICULTY.abyss.climb ? DIFFICULTY.abyss.climb.drainMul : 1);
    if (cost > out.maxCost) out.maxCost = cost;
    if (cost > 0.98) P(`climb zone ${z.id}: ${h.toFixed(1)} m ${z.wet ? 'wet ' : ''}costs ${(cost * 100).toFixed(0)} % of a full grip on Abyss (max 98 %)`);
    if (h > 14) P(`climb zone ${z.id}: ${h.toFixed(1)} m tall (max 14: the climbs must not replace a drop)`);
    // hugging a surface
    if (z.kind === 'chain') {
      const cx = (z.minX + z.maxX) / 2;
      const cz = (z.minZ + z.maxZ) / 2;
      const chain = L.decor.some((d) => d.type === 'chain' && Math.abs(d.x - cx) < 0.3 && Math.abs(d.z - cz) < 0.3 && d.y - d.sy / 2 <= z.maxY && d.y + d.sy / 2 >= z.minY);
      if (!chain) P(`climb zone ${z.id}: no chain (decor) at its position`);
    } else {
      // sample the surface plane 5 x 5 (1 cm behind the face): at least 60 % must be solid; the climber's side must be free
      let solid = 0;
      let n = 0;
      let blocked = 0;
      const ax = z.ax;
      const u0 = ax === 0 ? z.minZ : z.minX;
      const u1 = ax === 0 ? z.maxZ : z.maxX;
      const v0 = ax === 1 ? z.minZ : z.minY;
      const v1 = ax === 1 ? z.maxZ : z.maxY;
      const nrm = ax === 0 ? z.nx : ax === 1 ? z.ny : z.nz;
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const a = u0 + ((u1 - u0) * (i + 0.5)) / 5;
          const b = v0 + ((v1 - v0) * (j + 0.5)) / 5;
          const px = ax === 0 ? z.face - nrm * 0.03 : a;
          const py = ax === 1 ? z.face - nrm * 0.03 : b;
          const pz = ax === 0 ? a : ax === 1 ? b : z.face - nrm * 0.03;
          n++;
          if (inside(px, py, pz)) solid++;
          const qx = ax === 0 ? z.face + nrm * 0.5 : a;
          const qy = ax === 1 ? z.face + nrm * 0.5 : b;
          const qz = ax === 0 ? a : ax === 1 ? b : z.face + nrm * 0.5;
          if (inside(qx, qy, qz)) blocked++;
        }
      }
      if (solid < n * 0.6) P(`climb zone ${z.id}: only ${solid}/${n} of its face is backed by a solid (not mounted)`);
      if (blocked > n * 0.25) P(`climb zone ${z.id}: ${blocked}/${n} samples 0.5 m in front of it are inside a solid (no room to climb)`);
    }
    for (const hz of L.hazards) {
      const dx = Math.max(hz.minX - z.maxX, 0, z.minX - hz.maxX);
      const dy = Math.max(hz.minY - z.maxY, 0, z.minY - hz.maxY);
      const dz = Math.max(hz.minZ - z.maxZ, 0, z.minZ - hz.maxZ);
      if (Math.hypot(dx, dy, dz) < 0.6) P(`climb zone ${z.id} is within 0.6 m of hazard ${hz.id}`);
    }
  }
  out.perSection.forEach((n, i) => {
    if (n < 1 || n > 4) P(`section ${L.sections[i].id} has ${n} climb zones (want 1-4)`);
  });
  out.edges = edgeChecks(L, P);
  return out;
}

/** Edge extent along y, in m (a degenerate box). */
const EDGE_WARN_RUN = 14; // m: a continuous run of edge holds taller than this is reported as a warning

/**
 * WP-CLIMB, procedural edge holds (sim/climbEdges.js): sanity of the derived set. Counts, hazard clearance (0.6 m, the rule the
 * authored zones obey), no hold buried in another solid, no hold on a crumbling solid, and the SPARSENESS report: the tallest
 * continuous run of edge holds. A run is a set of non-lip edges chained hand to hand (gaps <= K.edgeLink); standable lips are
 * rests (stamina refills) and break a run. Stamina caps a free climb on edges at 1 / cost-per-metre regardless; runs >= 14 m
 * are listed as a warning, not a failure.
 */
function edgeChecks(L, P) {
  if (!Array.isArray(L.edges) || typeof L.edgeNear !== 'function') return null;
  const K = CONFIG.climb;
  const E = L.edges;
  const out = { count: E.length, lips: 0, vertical: 0, maxRun: 0, maxRunAt: null, staminaRun: 0, warn: [] };
  const scratch = [];
  const box = (x, y, z) => L.querySolids(x - 0.001, y - 0.001, z - 0.001, x + 0.001, y + 0.001, z + 0.001, scratch);
  for (const e of E) {
    if (e.lip) out.lips++;
    if (e.ea === 1) out.vertical++;
    if (e.src.kind === 'crumble') P(`edge hold ${e.id} sits on crumbling solid ${e.src.id}`);
    for (const hz of L.hazards) {
      const d = Math.hypot(Math.max(hz.minX - e.maxX, 0, e.minX - hz.maxX), Math.max(hz.minY - e.maxY, 0, e.minY - hz.maxY), Math.max(hz.minZ - e.maxZ, 0, e.minZ - hz.maxZ));
      if (d < 0.6 - 1e-6) P(`edge hold ${e.id} is within 0.6 m of hazard ${hz.id}`);
    }
    // the mid point nudged out along the bisector must be open (a hold beside solid rock is a wall, not an edge; the seal
    // plates of LEVEL_FUN_PLAN P1 are not part of the static level the holds are derived from)
    const mx = (e.minX + e.maxX) / 2 + e.ux * 0.03;
    const my = (e.minY + e.maxY) / 2 + e.uy * 0.03;
    const mz = (e.minZ + e.maxZ) / 2 + e.uz * 0.03;
    for (const o of box(mx, my, mz)) if (!o.seal && mx > o.minX && mx < o.maxX && my > o.minY && my < o.maxY && mz > o.minZ && mz < o.maxZ) P(`edge hold ${e.id} is buried in solid ${o.id}`);
  }
  // runs: union-find over the non-lip edges within K.edgeLink of each other
  const idx = new Map();
  const nodes = [];
  for (const e of E) if (!e.lip) idx.set(e, nodes.push(e) - 1);
  const parent = nodes.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const near = [];
  for (let i = 0; i < nodes.length; i++) {
    const e = nodes[i];
    const cx = (e.minX + e.maxX) / 2;
    const cy = (e.minY + e.maxY) / 2;
    const cz = (e.minZ + e.maxZ) / 2;
    const r = Math.hypot(e.maxX - e.minX, e.maxY - e.minY, e.maxZ - e.minZ) / 2 + K.edgeLink;
    L.edgeNear(cx, cy, cz, r, near);
    for (const o of near) {
      if (o === e || !idx.has(o)) continue;
      const d = Math.hypot(Math.max(o.minX - e.maxX, 0, e.minX - o.maxX), Math.max(o.minY - e.maxY, 0, e.minY - o.maxY), Math.max(o.minZ - e.maxZ, 0, e.minZ - o.maxZ));
      if (d <= K.edgeLink) parent[find(i)] = find(idx.get(o));
    }
  }
  const comp = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const r = find(i);
    const c = comp.get(r) || { lo: Infinity, hi: -Infinity, n: 0 };
    c.lo = Math.min(c.lo, nodes[i].minY);
    c.hi = Math.max(c.hi, nodes[i].maxY);
    c.n++;
    comp.set(r, c);
  }
  const runs = [];
  for (const c of comp.values()) runs.push({ h: c.hi - c.lo, lo: c.lo, hi: c.hi, n: c.n });
  runs.sort((a, b) => b.h - a.h);
  if (runs.length) {
    out.maxRun = Math.round(runs[0].h * 10) / 10;
    out.maxRunAt = `y ${runs[0].lo.toFixed(1)}..${runs[0].hi.toFixed(1)} (${runs[0].n} edges)`;
  }
  const dm = DIFFICULTY.abyss.climb ? DIFFICULTY.abyss.climb.drainMul : 1;
  out.staminaRun = Math.round((1 / (((K.hangDrain + K.moveDrain) / K.moveRef) * K.edgeMul * dm)) * 10) / 10; // m of edge-only climbing a full grip pays for (Abyss)
  out.runsOver = runs.filter((r) => r.h >= EDGE_WARN_RUN).length;
  for (const r of runs.slice(0, 3)) if (r.h >= EDGE_WARN_RUN) out.warn.push(`WARN edge-hold run of ${r.h.toFixed(1)} m at y ${r.lo.toFixed(1)}..${r.hi.toFixed(1)} (${r.n} edges, >= ${EDGE_WARN_RUN} m; stamina ends a free edge-only climb after ~${out.staminaRun} m)`);
  return out;
}

/** Lists of the chapter data whose objects are referenced by id (ENGINE_EXTENSIONS §5). */
const ID_LISTS = ['solids', 'hazards', 'anchors', 'seals', 'fixtures', 'objectives', 'lamps', 'movers', 'volumes', 'fronts', 'beats', 'interactables', 'names', 'knockWalls', 'horns', 'creaturePaths', 'kept', 'stillSources'];
/** Lists whose references must resolve (V1: no dangling ids). */
const REF_LISTS = ['anchors', 'seals', 'fixtures', 'objectives', 'lamps', 'movers', 'volumes', 'fronts', 'beats', 'interactables', 'names', 'knockWalls', 'horns', 'creaturePaths', 'kept', 'stillSources'];

/**
 * V1: ids unique among the variant's live objects; every `…Id` / `ids` reference in
 * the extension lists resolves. (ch1 only has solids / hazards / anchors today.)
 */
function idChecks(L, P) {
  const seen = new Map();
  const live = { solids: L.solids.concat(L.sealSolids || []), hazards: L.hazards, anchors: L.anchors };
  let n = 0;
  for (const k of ID_LISTS) {
    const list = live[k] || (Array.isArray(L.data[k]) ? L.data[k] : []);
    for (const o of list) {
      if (!o || o.id === undefined) continue;
      n++;
      if (seen.has(o.id)) P(`duplicate id '${o.id}' (${seen.get(o.id)} and ${k})`);
      else seen.set(o.id, k);
    }
  }
  let refs = 0;
  const known = (id) => seen.has(id) || (L.byId && L.byId[id] !== undefined);
  for (const k of REF_LISTS) {
    const list = live[k] || (Array.isArray(L.data[k]) ? L.data[k] : []);
    for (const o of list) {
      if (!o) continue;
      for (const [f, val] of Object.entries(o)) {
        const vals = f === 'ids' && Array.isArray(val) ? val : /Id$/.test(f) && typeof val === 'string' ? [val] : null;
        if (!vals) continue;
        for (const id of vals) {
          refs++;
          if (!known(id)) P(`${k} ${o.id || '?'}: ${f} → '${id}' does not exist`);
        }
      }
    }
  }
  return { ids: n, refs };
}

// -----------------------------------------------------------------------------
// Runs
// -----------------------------------------------------------------------------
/** Fall damage of a run (health3d.js), hp points: hits, total taken, lowest hp, hp at the end. */
const dmgOf = (d) => ({ hits: d.hits, total: d.total, minHp: d.minHp, endHp: d.endHp });

function runRoute(ch, v, start, route, opts = {}) {
  const L = opts.level || ch.makeLevel(v);
  const sim = new Sim(L, v, opts.sim || {});
  sim.spawn(start.x, start.y, start.z, opts.doneThrough); // seals: those above the start's section open (or `doneThrough`)
  const bot = new Bot(sim, route, opts);
  const r = bot.runRoute();
  r.sim = sim;
  r.bot = bot;
  // reach floors: the longest shot per section of this line
  const log = reachLog[v] || (reachLog[v] = {});
  for (const [si, id, d] of sim.shots) {
    const cur = log[si];
    if (!cur || d > cur.d) log[si] = { d, id, line: opts.label || '?' };
  }
  r.inGoal = L.inGoal(sim.player.x, sim.player.y, sim.player.z);
  return r;
}

/** V2: spawn → goal in one continuous run along `line` at the fork. */
function fullRun(ch, v, line, simOpts) {
  const L = ch.makeLevel(v);
  const R = ch.routes;
  const route = [];
  const marks = [];
  for (const k of R.SECTION_ROUTE) {
    const key = R.FORK && k === R.FORK.key ? line : k;
    for (const st of R.ROUTES[key]) route.push(st);
    marks.push([k, route.length - 1]);
  }
  const r = runRoute(ch, v, L.spawn, route, { level: L, sim: simOpts, label: `full/${line || 'main'}` });
  const splits = {};
  let prev = 0;
  for (const [k, idx] of marks) {
    const e = r.bot.log.find((x) => x[0] === idx);
    if (e) {
      splits[k] = +(e[1] - prev).toFixed(1);
      prev = e[1];
    }
  }
  return {
    ok: r.ok && r.deaths === 0 && r.maxLand < LAND_OK && r.inGoal,
    time: +r.time.toFixed(1),
    deaths: r.deaths,
    maxLand: +r.maxLand.toFixed(2),
    maxLandAtY: r.maxLandAt ? +r.maxLandAt.y.toFixed(0) : null,
    inGoal: r.inGoal,
    fail: r.fail,
    splits,
    attaches: r.attaches.length,
    damage: dmgOf(r.damage),
    objectives: r.sim.objEvents.filter((e) => e[1] === 'objective').map((e) => `${e[2]}@${e[0]}`),
    trace: r.sim.trace,
    events: r.sim.events,
    sim: r.sim,
  };
}

// -----------------------------------------------------------------------------
// V3 Anchor coverage: targetable (exact ray) from some bot trace point or from a
// standing position on some platform.
// -----------------------------------------------------------------------------
function coverage(ch, v, traces) {
  const L = ch.makeLevel(v);
  const T = new TetherSystem(L, DIFFICULTY[v], new EventBus(), {});
  const p = new Player3D(0, 0, 0);
  const pts = [];
  for (const tr of traces) for (let i = 0; i < tr.length; i += 3) pts.push([tr[i], tr[i + 1], tr[i + 2]]);
  const standing = [];
  for (const s of L.solids) {
    if (s.kind === 'wall' && s.tag !== 'floor') continue;
    if (s.maxX - s.minX < 1.2 || s.maxZ - s.minZ < 1.2) continue;
    for (let x = s.minX + 0.5; x <= s.maxX - 0.5; x += 2) for (let z = s.minZ + 0.5; z <= s.maxZ - 0.5; z += 2) standing.push([x, s.maxY + 0.38, z]);
  }
  const res = {};
  for (const a of L.anchors) {
    let fromTrace = 0;
    let fromStand = 0;
    const test = (q) => {
      const dx = a.x - q[0];
      const dy = a.y - q[1];
      const dz = a.z - q[2];
      const l = Math.hypot(dx, dy, dz);
      if (l > T.aimRangeAt(L.sectionIndexAt(q[1])) || l < 0.5) return false; // the section's reach (LEVEL_FUN_PLAN item 5)
      p.x = q[0];
      p.y = q[1];
      p.z = q[2];
      const r = T.findTarget(p, { ox: q[0], oy: q[1], oz: q[2], dx: dx / l, dy: dy / l, dz: dz / l }, 'right');
      return !!r && r.anchor === a;
    };
    for (const q of pts) if (test(q)) fromTrace++;
    for (const q of standing) if (test(q)) fromStand++;
    res[a.id] = { fromTrace, fromStand };
    if (fromTrace + fromStand === 0) fail(`[${ch.id}/${v}] anchor ${a.id} is never targetable from any route point or standing spot`);
  }
  return res;
}

function counts(ch, v) {
  const L = ch.makeLevel(v);
  const by = (list, f) => list.reduce((m, o) => ((m[f(o)] = (m[f(o)] || 0) + 1), m), {});
  return {
    solids: L.solids.length,
    seals: (L.sealSolids || []).length,
    solidKinds: by(L.solids, (s) => s.kind),
    hazards: L.hazards.length,
    hazardKinds: by(L.hazards, (s) => s.kind),
    anchors: L.anchors.length,
    anchorKinds: by(L.anchors, (a) => a.kind),
    anchorTags: by(L.anchors, (a) => a.tag),
    decor: L.decor.length,
    decorTypes: by(L.decor, (d) => d.type),
    lights: L.lights.length,
    standable: L.solids.filter((s) => s.kind !== 'wall' || s.tag === 'floor').length,
    depth: -L.goal.minY,
    perSection: L.sections.map((s) => ({ id: s.id, y: [s.yTop, s.yBottom], anchors: L.anchors.filter((a) => a.section === s.index).length, solids: L.solids.filter((o) => o.section === s.index).length })),
  };
}

// -----------------------------------------------------------------------------
// V13 Determinism: the bot run, a second bot run and a replay of the first run's
// intent log (no bot, no look-ahead) must give the same trajectory hash.
// -----------------------------------------------------------------------------
function determinism(ch, v, first) {
  const R = ch.routes;
  const line = R.FORK ? R.FORK.risky : null;
  const a = first.sim;
  const again = fullRun(ch, v, line, {});
  const L = ch.makeLevel(v);
  const rp = new Sim(L, v);
  rp.spawn(L.spawn.x, L.spawn.y, L.spawn.z);
  rp.replay(a.log, a.logFrames);
  const res = {
    frames: a.hash.frames,
    run: a.hash.hex,
    rerun: again.sim.hash.hex,
    replay: rp.hash.hex,
    replayFrames: rp.hash.frames,
    replayInGoal: L.inGoal(rp.player.x, rp.player.y, rp.player.z),
    // the objective events (objective:done, seal:land) of the three runs: same ids on the same frames
    objectives: [a.objHash, again.sim.objHash, rp.objHash].map((h) => h.toString(16).padStart(8, '0')),
  };
  res.ok = res.run === res.rerun && res.run === res.replay && res.frames === res.replayFrames && again.sim.hash.frames === res.frames && res.objectives.every((h) => h === res.objectives[0]);
  if (!res.ok) fail(`[${ch.id}/${v}] determinism: run ${res.run} rerun ${res.rerun} replay ${res.replay} (frames ${res.frames}/${again.sim.hash.frames}/${res.replayFrames})`);
  return res;
}

/** A report restricted to `variants` (drops keys naming another variant: `abyss`, `abyss/risky`, `sections_abyss`, `alt_abyss_s8wall`, `s3designTest/abyss`). */
function onlyVariants(obj, variants) {
  const others = ['normal', 'nightmare', 'abyss'].filter((v) => !variants.includes(v));
  if (!others.length) return obj;
  const re = new RegExp(`(^|[/_])(${others.join('|')})($|[/_])`);
  const walk = (o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) if (!re.test(k)) out[k] = walk(v);
    return out;
  };
  return walk(obj);
}

// -----------------------------------------------------------------------------
async function verifyChapter(ch) {
  const R = ch.routes;
  const t0 = Date.now();
  chapterFailures = [];
  reachLog = {};
  const report = {
    meta: { chapter: ch.id, name: ch.name, variants: VARIANTS, gameRoot: GAME_ROOT, node: process.version, date: new Date().toISOString() },
    integrity: {},
    full: {},
    scenarios: {},
    [R.FORK ? R.FORK.key : 'fork']: {},
    coverage: {},
    counts: {},
    determinism: {},
    budget: {},
  };
  console.log(`\n######## ${ch.id}: ${ch.name}  (variants: ${VARIANTS.join(', ')})`);

  console.log('== Integrity');
  for (const v of VARIANTS) {
    report.integrity[v] = integrity(ch, v);
    console.log(`  ${v}: ${report.integrity[v].ok ? 'OK' : 'PROBLEMS'}  recovery anchors: ${report.integrity[v].recovery.join(', ')}`);
    const eg = report.integrity[v].climb ? report.integrity[v].climb.edges : null;
    if (eg) {
      console.log(`     edge holds: ${eg.count} (${eg.lips} lips, ${eg.vertical} vertical); max continuous edge-climb run ${eg.maxRun} m ${eg.maxRunAt || ''}; ${eg.runsOver} run(s) >= ${EDGE_WARN_RUN} m; a full grip pays for ~${eg.staminaRun} m of edge-only climbing (Abyss)`);
      for (const w of eg.warn) console.log(`     ${w}`);
    }
  }

  console.log('== Full runs (spawn → goal, one continuous run)');
  const traces = {};
  for (const v of VARIANTS) traces[v] = [];
  const lines = R.FORK ? [[R.FORK.risky, 'risky'], [R.FORK.safe, 'safe']] : [[null, 'main']];
  const firstRun = {};
  for (const v of VARIANTS) {
    for (const [line, label] of lines) {
      const record = DO_DETERMINISM && !firstRun[v];
      const r = fullRun(ch, v, line, record ? { record: true } : {});
      if (record) firstRun[v] = r;
      traces[v].push(r.trace);
      const tag = `${v}/${label}`;
      report.full[tag] = Object.assign({}, r, { trace: undefined, events: undefined, sim: undefined });
      if (!r.ok) fail(`[${ch.id}] full run ${tag}: ${r.fail || ''} deaths ${r.deaths} maxLand ${r.maxLand} inGoal ${r.inGoal}`);
      console.log(`  ${tag.padEnd(16)} ${r.ok ? 'PASS' : 'FAIL'} ${r.time}s deaths=${r.deaths} maxLand=${r.maxLand}@${r.maxLandAtY} dmg=${r.damage.total}hp/${r.damage.hits} minHp=${r.damage.minHp} attaches=${r.attaches} splits ${JSON.stringify(r.splits)}`);
    }
  }

  console.log('== Per-section runs from checkpoints');
  for (const v of VARIANTS) {
    const L = ch.makeLevel(v);
    report[`sections_${v}`] = {};
    for (const key of Object.keys(R.ROUTES)) {
      const r = runRoute(ch, v, L.sections[R.ROUTE_START[key]].checkpoint, R.ROUTES[key], { level: L, label: key });
      traces[v].push(r.sim.trace);
      const ok = r.ok && r.deaths === 0 && r.maxLand < LAND_OK;
      if (!ok) fail(`[${ch.id}/${v}] section ${key}: ${r.fail}`);
      report[`sections_${v}`][key] = { ok, time: +r.time.toFixed(1), maxLand: +r.maxLand.toFixed(2), deaths: r.deaths, damage: dmgOf(r.damage) };
    }
    console.log(`  ${v}: ${Object.entries(report[`sections_${v}`]).map(([k, o]) => `${k} ${o.ok ? 'ok' : 'FAIL'} ${o.time}s/${o.maxLand}`).join(' | ')}`);
    console.log(`  ${v} damage (hp taken / lowest hp): ${Object.entries(report[`sections_${v}`]).map(([k, o]) => `${k} ${o.damage.total}/${o.damage.minHp}`).join(' | ')}`);
  }

  if (R.ALT_ROUTES && Object.keys(R.ALT_ROUTES).length) {
    console.log('== Alternate lines');
    for (const v of VARIANTS) {
      const L = ch.makeLevel(v);
      const res = [];
      for (const [k, route] of Object.entries(R.ALT_ROUTES)) {
        const r = runRoute(ch, v, L.sections[R.ALT_START[k]].checkpoint, route, { level: L, label: `alt/${k}` });
        traces[v].push(r.sim.trace);
        const ok = r.ok && r.deaths === 0 && r.maxLand < LAND_OK;
        if (!ok) fail(`[${ch.id}/${v}] alt ${k}: ${r.fail}`);
        res.push(`${k} ${ok ? 'ok' : 'FAIL'} ${r.time.toFixed(1)}s/${r.maxLand.toFixed(2)} dmg ${r.damage.total}/${r.damage.minHp}`);
        report[`alt_${v}_${k}`] = { ok, time: +r.time.toFixed(1), maxLand: +r.maxLand.toFixed(2), damage: dmgOf(r.damage) };
      }
      console.log(`  ${v}: ${res.join(' | ')}`);
    }
  }

  if (R.FORK) {
    const F = R.FORK;
    console.log(`== ${F.key.toUpperCase()}: risky vs safe (from the fork)`);
    for (const v of VARIANTS) {
      const a = report[`sections_${v}`][F.risky];
      const b = report[`sections_${v}`][F.safe];
      const faster = 1 - a.time / b.time;
      report[F.key][v] = { risky: a.time, safe: b.time, fasterBy: +(faster * 100).toFixed(0) + '%' };
      if (!(a.ok && b.ok && faster >= F.fasterBy)) fail(`[${ch.id}/${v}] ${F.key.toUpperCase()} risky not >=${F.fasterBy * 100}% faster (${a.time} vs ${b.time})`);
      console.log(`  ${v}: risky ${a.time}s vs safe ${b.time}s → ${(faster * 100).toFixed(0)}% faster`);
    }
  }

  console.log('== Recovery scenarios');
  for (const [name, sc] of Object.entries(R.SCENARIOS || {})) {
    for (const v of sc.variants) {
      if (!VARIANTS.includes(v)) continue;
      const L = ch.makeLevel(v);
      const route = typeof sc.route === 'function' ? sc.route(v) : sc.route;
      const r = runRoute(ch, v, sc.start(L), route, { level: L, doneThrough: sc.doneThrough, label: `scenario/${name}` });
      traces[v].push(r.sim.trace);
      const ok = r.ok && r.deaths === 0 && r.maxLand < LAND_OK;
      report.scenarios[`${name}/${v}`] = { ok, time: +r.time.toFixed(1), maxLand: +r.maxLand.toFixed(2), damage: dmgOf(r.damage), fail: r.fail, events: r.sim.events.filter((e) => e[0] !== 'miss').slice(0, 12) };
      if (!ok) fail(`[${ch.id}] scenario ${name}/${v}: ${r.fail}`);
      console.log(`  ${(name + '/' + v).padEnd(24)} ${ok ? 'PASS' : 'FAIL'} ${r.time.toFixed(1)}s maxLand=${r.maxLand.toFixed(2)} dmg=${r.damage.total}hp minHp=${r.damage.minHp} ${r.fail || ''}`);
      console.log(`     ${JSON.stringify(r.sim.events.filter((e) => e[0] !== 'miss').slice(0, 9))}`);
    }
  }

  console.log(`== Reach (LEVEL_FUN_PLAN item 5: per-section targeting range; every shot of every line <= reach - ${REACH_MARGIN} m)`);
  report.reach = {};
  for (const v of VARIANTS) {
    const L = ch.makeLevel(v);
    const T = new TetherSystem(L, DIFFICULTY[v], new EventBus(), {});
    const log = reachLog[v] || {};
    const rows = {};
    for (const sec of L.sections) {
      const reach = T.aimRangeAt(sec.index);
      const m = log[sec.index];
      rows[sec.id] = { reach, longest: m ? +m.d.toFixed(1) : null, at: m ? m.id : null, line: m ? m.line : null };
      if (m && m.d > reach - REACH_MARGIN) fail(`[${ch.id}/${v}] reach ${sec.id}: line ${m.line} fires at ${m.id} from ${m.d.toFixed(1)} m (reach ${reach}, margin ${REACH_MARGIN})`);
    }
    report.reach[v] = rows;
    console.log(`  ${v}: ${Object.entries(rows).map(([id, o]) => `${id} ${o.reach} m (longest ${o.longest} ${o.at})`).join(' | ')}`);
  }

  console.log('== Anchor coverage (targetable from route points / standing spots)');
  for (const v of VARIANTS) {
    report.coverage[v] = coverage(ch, v, traces[v]);
    const weak = Object.entries(report.coverage[v]).filter(([, c]) => c.fromTrace + c.fromStand < 3).map(([id, c]) => `${id}(${c.fromTrace}/${c.fromStand})`);
    console.log(`  ${v}: ${Object.keys(report.coverage[v]).length} anchors; weakly visible: ${weak.join(' ') || 'none'}`);
  }

  console.log('== Seals (LEVEL_FUN_PLAN P1: seal-gap check, skip probe, climb-out)');
  report.seals = {};
  for (const v of VARIANTS) {
    const P = (m) => fail(`[${ch.id}/${v}] ${m}`);
    const gaps = sealGaps(ch.makeLevel(v), v, traces[v], P);
    const up = climbOut(ch.makeLevel(v), v, P);
    const probe = skipProbe(ch.makeLevel(v), v, P);
    if (!gaps) {
      console.log(`  ${v}: no Objectives3D in this checkout (skipped)`);
      continue;
    }
    report.seals[v] = { gaps, climbOut: up, probe };
    const g = Object.entries(gaps).map(([id, o]) => `${id.replace('seal-', '')} ${o.holes ? o.holes + ' HOLES' : o.probes + ' probes shut'}, ${o.leaks.length ? o.leaks.length + ' LEAKS' : o.pairs + ' lines blocked'}`);
    console.log(`  ${v} gaps: ${g.join(' | ')}`);
    console.log(`  ${v} skip probe: ${Object.values(probe).map((o) => `${o.section} ${o.passed ? 'PASSED THE SEAL' : 'held'} (${o.end} on ${o.on}${o.wayUp === false ? ', NO WAY UP' : ''}, ${o.hooks.length} hooks, low ${o.minY})`).join(' | ')}`);
    console.log(`  ${v} climb-out (standing spots on the closed seal that see a ring above): ${Object.entries(up).map(([id, o]) => `${id.replace('seal-', '')} ${Math.round(o.share * 100)}%`).join(' ')}`);
  }

  console.log('== Counts');
  for (const v of VARIANTS) {
    report.counts[v] = counts(ch, v);
    const c = report.counts[v];
    console.log(`  ${v}: solids ${c.solids} ${JSON.stringify(c.solidKinds)} | hazards ${c.hazards} ${JSON.stringify(c.hazardKinds)} | anchors ${c.anchors} ${JSON.stringify(c.anchorKinds)} ${JSON.stringify(c.anchorTags)} | decor ${c.decor} | lights ${c.lights} | standable ${c.standable} | depth ${c.depth} m`);
  }

  if (DO_DETERMINISM) {
    console.log('== Determinism (V13: bot run = re-run = replay of its input log)');
    for (const v of VARIANTS) {
      const d = (report.determinism[v] = determinism(ch, v, firstRun[v]));
      console.log(`  ${v}: ${d.ok ? 'OK' : 'MISMATCH'} ${d.frames} frames, hash run ${d.run} rerun ${d.rerun} replay ${d.replay}${d.replayInGoal ? ' (replay reaches the goal)' : ''}`);
    }
  }

  if (DO_BUDGET) {
    console.log('== Sim budget (E29 per-system timers, full stack: main route with the creature + threat live) and counts (V12)');
    for (const v of VARIANTS) {
      const b = await measureBudget(ch.id, v);
      report.budget[v] = b;
      console.log(formatBudget(b));
      if (!b.routeOk) fail(`[${ch.id}/${v}] budget run (creature live, non-lethal) lost the main route: ${b.routeFail}`);
      if (!b.ok) fail(`[${ch.id}/${v}] sim cost p99 ${b.timers.perFrameMs.cost.p99} ms/frame over the ${b.budgetMs} ms budget`);
      if (!b.counts.ok) fail(`[${ch.id}/${v}] object counts over budget: ${b.counts.over.join(', ')}`);
    }
  }

  // V14: every number against the chapter's baseline (informational; physics changes move them).
  const baseFile = path.join(BASELINE_DIR, `verify-${ch.id}.json`);
  if (fs.existsSync(baseFile) && !WRITE_BASELINE) {
    const base = onlyVariants(JSON.parse(fs.readFileSync(baseFile, 'utf8')), VARIANTS);
    const cmp = compareReports(base, report, { ignore: ['meta', 'budget', 'checks', 'regression'].concat(DO_DETERMINISM ? [] : ['determinism']) });
    report.regression = { baseline: path.relative(path.dirname(BASELINE_DIR), baseFile), compared: cmp.leaves, differences: cmp.diffs.length, first: cmp.diffs.slice(0, 40) };
    console.log(`== Baseline (V14 read-out): ${cmp.diffs.length ? cmp.diffs.length + ' of ' + cmp.leaves + ' values differ' : 'all ' + cmp.leaves + ' values identical'} vs ${report.regression.baseline}`);
    for (const [p, a, b] of cmp.diffs.slice(0, 12)) console.log(`  ${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    if (cmp.diffs.length > 12) console.log(`  … ${cmp.diffs.length - 12} more in ${path.basename(OUT_DIR)}/verify-${ch.id}.json (regression.first) — re-baseline with --write-baseline once reviewed`);
  }

  report.checks = { failures: chapterFailures.slice(), ok: chapterFailures.length === 0, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
  const file = path.join(OUT_DIR, `verify-${ch.id}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, `traces-${ch.id}.json`), JSON.stringify(traces));
  if (WRITE_BASELINE) {
    if (chapterFailures.length) console.log(`  not writing the ${ch.id} baseline: the chapter has failures`);
    else if (VARIANTS.length < 3 || !DO_DETERMINISM) console.log(`  not writing the ${ch.id} baseline: it needs every variant and the determinism phase`);
    else {
      const base = Object.assign({}, report, { budget: undefined, checks: undefined, regression: undefined });
      base.meta = { chapter: ch.id, variants: VARIANTS, note: 'V14 baseline: npm run verify:at3d -- --chapter ' + ch.id + ' --write-baseline', date: report.meta.date };
      fs.mkdirSync(BASELINE_DIR, { recursive: true });
      fs.writeFileSync(baseFile, JSON.stringify(base, null, 1) + '\n');
      console.log(`  baseline written: ${baseFile}`);
    }
  }
  console.log(`\n  ${ch.id}: ${chapterFailures.length ? chapterFailures.length + ' failure(s)' : 'all checks pass'} in ${report.checks.seconds}s → ${path.relative(process.cwd(), file) || file}`);
}

// -----------------------------------------------------------------------------
console.log(`Abyssal Tether 3D harness — game ${GAME_ROOT}`);
for (const id of CHAPTER_IDS) await verifyChapter(CHAPTERS[id]);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASS');
process.exitCode = failures ? 1 : 0;
