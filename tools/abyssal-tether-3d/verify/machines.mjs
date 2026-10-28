// LEVEL_FUN_PLAN P4 ("machines") checks: the movers (src/sim/movers3d.js: closed-form moving anchors) and the rockfall
// lanes (src/sim/objectives3d.js), against the live level of a variant.
//
//   machineIntegrity(L, v, P)  V1 / V12: at most MAX_MOVERS movers; every mover carries an anchor of this variant; no carried
//                              anchor ever moves faster than MOVER_MAX_SPEED (1.5 m/s) with the knobs of any difficulty that
//                              plays this variant; a carried ring out of its housing never comes within RING_CLEAR of a solid
//                              (64 poses a cycle); every lane: a sane schedule (on + lead < period), inside its section's
//                              shaft, and no checkpoint, supply spot, anchor or ledge top inside it (the stones never fall
//                              where you stand or hook: only through the air you swing across).
//                              P6 squalls: a sane schedule (on + lead < period), at most SQUALL_MAX_ACCEL m/s² with any
//                              difficulty's knobs, a horizontal unit way, inside its section's shaft, no checkpoint in it.
//   squallProbe(makeLevel, v, R, P)  P6 (fairness): every bot line of the squall's section (main + fork lines), played from
//                              6 start phases of the run clock with the squalls ON, passes (no death, every landing under
//                              0.85 lethal); the probe reports how long the squall pushed each line (it must push one).
//   laneProbe(makeLevel, v, R, P)  V6: the section route that crosses a lane, played WITHOUT its `wait: { lane }` step from
//                              several start phases of the run clock, is struck at least once (the lane is real); played as
//                              written it never is (verify.mjs also fails any bot route that is struck).
import { Sim, DIFFICULTY } from './sim.mjs';
import { Bot } from './bot.mjs';
import { srcUrl } from './root.mjs';

const mv = await import(srcUrl('sim/movers3d.js')).catch(() => null);
const { Objectives3D, SQUALL_MAX_ACCEL } = await import(srcUrl('sim/objectives3d.js')).catch(() => ({ Objectives3D: null, SQUALL_MAX_ACCEL: 2 }));

export const MAX_MOVERS = 8; // LEVEL_FUN_PLAN item 7 / V12
const RING_CLEAR = 0.1; // m
/** The difficulties that play each level variant (Sandbox plays Normal's). */
const KEYS_OF = { normal: ['normal', 'sandbox'], nightmare: ['nightmare'], abyss: ['abyss'] };

export function machineIntegrity(L, v, P) {
  if (!mv || !Objectives3D) return null;
  const out = { movers: (L.movers || []).length, carried: (L.dynAnchors || []).length, maxSpeed: 0, lanes: 0 };
  if (out.movers > MAX_MOVERS) P(`movers: ${out.movers} (at most ${MAX_MOVERS})`);
  const scratch = [];
  const q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hidden: false };
  for (const e of L.movers || []) {
    if (!e.anchors.length) P(`mover ${e.id}: carries no anchor of this variant`);
    for (const key of KEYS_OF[v] || [v]) {
      const m = mv.normalizeMover(e.raw, key);
      for (const o of e.offs) {
        const sp = mv.pointMaxSpeed(m, o[0], o[1]);
        if (sp > out.maxSpeed) out.maxSpeed = +sp.toFixed(3);
        if (sp > mv.MOVER_MAX_SPEED + 1e-9) P(`mover ${e.id} (${key}): a carried anchor reaches ${sp.toFixed(2)} m/s (at most ${mv.MOVER_MAX_SPEED})`);
      }
      // a ring out of its housing stays clear of the masonry over a whole cycle
      for (let j = 0; j < e.anchors.length; j++) {
        const o = e.offs[j];
        for (let k = 0; k < 64; k++) {
          mv.posePoint(m, o[0], o[1], o[2], (m.period * k) / 64, q);
          if (q.hidden) continue;
          for (const s of L.querySolids(q.x - 0.5, q.y - 0.5, q.z - 0.5, q.x + 0.5, q.y + 0.5, q.z + 0.5, scratch)) {
            if (s.active === false && !s.seal) continue;
            const d = Math.hypot(Math.max(s.minX - q.x, 0, q.x - s.maxX), Math.max(s.minY - q.y, 0, q.y - s.maxY), Math.max(s.minZ - q.z, 0, q.z - s.maxZ));
            if (d < RING_CLEAR) {
              P(`mover ${e.id} (${key}): ${e.anchors[j].id} touches solid ${s.id} at t ${((m.period * k) / 64).toFixed(2)} s`);
              k = 64;
              break;
            }
          }
        }
      }
    }
  }
  const O = new Objectives3D(L, DIFFICULTY[v], null);
  out.lanes = O.lanes.length;
  for (const lane of O.lanes) {
    const name = `lane ${lane.id}`;
    if (!(lane.on + lane.lead < lane.period)) P(`${name}: on ${lane.on} + lead ${lane.lead} >= period ${lane.period} (no gap)`);
    const sec = L.sections[lane.section];
    const sh = sec && sec.shaft;
    if (!sh || lane.minX < sh.minX || lane.maxX > sh.maxX || lane.minZ < sh.minZ || lane.maxZ > sh.maxZ || L.sectionIndexAt(lane.maxY) !== lane.section) P(`${name}: not inside the shaft of its section`);
    const inside = (x, y, z, pad) => x > lane.minX - pad && x < lane.maxX + pad && y > lane.minY - pad && y < lane.maxY + pad && z > lane.minZ - pad && z < lane.maxZ + pad;
    for (const s of L.sections) if (inside(s.checkpoint.x, s.checkpoint.y, s.checkpoint.z, 2)) P(`${name}: next to checkpoint ${s.id}`);
    for (const a of L.anchors) if (!a.dynamic && inside(a.x, a.y, a.z, 1)) P(`${name}: anchor ${a.id} is inside it`);
    for (const s of L.data.supplies || []) if (inside(s.x, s.y, s.z, 1)) P(`${name}: supply ${s.id} is inside it`);
    // no ledge top a body could stand on inside the box (or 2 m above one: the head)
    for (const s of L.querySolids(lane.minX, lane.minY - 2, lane.minZ, lane.maxX, lane.maxY, lane.maxZ, scratch)) {
      if (s.seal) continue;
      if (s.maxY >= lane.minY - 2 && s.maxY <= lane.maxY && s.minX < lane.maxX && s.maxX > lane.minX && s.minZ < lane.maxZ && s.maxZ > lane.minZ) P(`${name}: ledge ${s.id} stands in it`);
    }
  }
  // P6: the wind squalls (with the knobs of every difficulty that plays this variant)
  out.squalls = O.squalls.length;
  for (const key of KEYS_OF[v] || [v]) {
    if (!DIFFICULTY[key]) continue;
    for (const q of new Objectives3D(L, DIFFICULTY[key], null).squalls) {
      const name = `squall ${q.id} (${key})`;
      const raw = (L.data.squalls || []).find((o) => o.id === q.id) || {};
      const want = Object.assign({}, raw, raw.by && raw.by[key]);
      if (!(want.accel <= SQUALL_MAX_ACCEL)) P(`${name}: accel ${want.accel} m/s² (at most ${SQUALL_MAX_ACCEL})`);
      if (!(q.on + q.lead < q.period)) P(`${name}: on ${q.on} + lead ${q.lead} >= period ${q.period} (no calm)`);
      if (!(q.lead >= 1)) P(`${name}: telegraph lead ${q.lead} s (at least 1 s)`);
      if (Math.abs(Math.hypot(q.dx, q.dz) - 1) > 1e-6) P(`${name}: its way is not a horizontal unit vector`);
      const sec = L.sections[q.section];
      const sh = sec && sec.shaft;
      if (!sh || q.minX < sh.minX || q.maxX > sh.maxX || q.minZ < sh.minZ || q.maxZ > sh.maxZ || q.maxY > sec.yTop || q.minY < sec.yBottom) P(`${name}: not inside the shaft of its section`);
      for (const s of L.sections) {
        const c = s.checkpoint;
        if (c.x > q.minX && c.x < q.maxX && c.y > q.minY && c.y < q.maxY && c.z > q.minZ && c.z < q.maxZ) P(`${name}: checkpoint ${s.id} is inside it`);
      }
    }
  }
  return out;
}

/** P6: the bot lines that start in section `si` (the main line and its fork lines). */
function linesOf(R, si) {
  return Object.keys(R.ROUTES).filter((k) => R.ROUTE_START[k] === si);
}

export async function squallProbe(makeLevel, v, R, P) {
  if (!Objectives3D) return null;
  const L0 = makeLevel(v);
  const O0 = new Objectives3D(L0, DIFFICULTY[v], null);
  const out = {};
  const PHASES = 6;
  for (const q of O0.squalls) {
    const sec = L0.sections[q.section];
    const keys = linesOf(R, q.section);
    if (!keys.length) {
      P(`squall ${q.id}: no bot line starts in its section`);
      continue;
    }
    const row = { accel: q.accel, period: q.period, lines: {} };
    let anyPush = false;
    for (const key of keys) {
      const l = { runs: 0, ok: 0, pushed: 0, maxPush: 0, min: Infinity, max: 0 };
      for (let k = 0; k < PHASES; k++) {
        const L = makeLevel(v);
        const sim = new Sim(L, v, { squalls: true });
        const cp = sec.checkpoint;
        sim.spawn(cp.x, cp.y, cp.z);
        sim.objectives.clock = (q.period * k) / PHASES; // the gust meets the line at another moment
        sim.objectives.reapply();
        const O = sim.objectives;
        const qi = O.squallIndex(q.id);
        let pushed = 0;
        const frame = sim.frame.bind(sim);
        sim.frame = (it) => {
          if (!sim.ghost) {
            const p = sim.player;
            const sq = O.squalls[qi];
            if (O.squallAt(qi) > 0 && !p.grounded && p.x >= sq.minX && p.x <= sq.maxX && p.y >= sq.minY && p.y <= sq.maxY && p.z >= sq.minZ && p.z <= sq.maxZ) pushed += 1 / 60;
          }
          return frame(it);
        };
        const r = new Bot(sim, R.ROUTES[key], {}).runRoute();
        l.runs++;
        const good = r.ok && r.deaths === 0 && r.maxLand < 0.85;
        if (good) l.ok++;
        else P(`squall ${q.id}: line ${key} fails from phase ${k}/${PHASES} with the squalls on (${r.fail || 'landing ' + r.maxLand.toFixed(2)})`);
        if (pushed > 0) l.pushed++;
        l.maxPush = Math.max(l.maxPush, +pushed.toFixed(1));
        l.min = Math.min(l.min, +r.time.toFixed(1));
        l.max = Math.max(l.max, +r.time.toFixed(1));
      }
      if (l.pushed) anyPush = true;
      row.lines[key] = l;
    }
    if (!anyPush) P(`squall ${q.id}: never pushed any bot line of ${sec.id} in ${PHASES} phases (it blows where nobody goes)`);
    out[q.id] = row;
  }
  return out;
}

/** Index of the route step that waits for `lane` (or -1). */
function laneWaitStep(route, lane) {
  return route.findIndex((st) => st.wait && typeof st.wait === 'object' && st.wait.lane === lane);
}

export async function laneProbe(makeLevel, v, R, P) {
  if (!Objectives3D) return null;
  const L0 = makeLevel(v);
  const O0 = new Objectives3D(L0, DIFFICULTY[v], null);
  const out = {};
  for (const lane of O0.lanes) {
    const sec = L0.sections[lane.section];
    const key = Object.keys(R.ROUTES).find((k) => laneWaitStep(R.ROUTES[k], lane.id) >= 0 && R.ROUTE_START[k] === lane.section);
    if (!key) {
      P(`lane ${lane.id}: no section route waits for it (nothing proves it is crossed fairly)`);
      continue;
    }
    const route = R.ROUTES[key];
    const blind = route.filter((_, i) => i !== laneWaitStep(route, lane.id));
    const row = { route: key, phases: 6, blindHits: 0, blindRuns: 0, waitHits: 0 };
    for (let k = 0; k < row.phases; k++) {
      for (const [r, label] of [
        [blind, 'blind'],
        [route, 'wait'],
      ]) {
        const L = makeLevel(v);
        const sim = new Sim(L, v);
        const cp = sec.checkpoint;
        sim.spawn(cp.x, cp.y, cp.z);
        // start the run clock at another phase of the lane (the lanes and movers are functions of it)
        sim.objectives.clock = (lane.period * k) / row.phases;
        sim.objectives.reapply();
        new Bot(sim, r, {}).runRoute();
        const hits = sim.laneHits.filter((h) => h[1] === lane.id).length;
        if (label === 'blind') {
          row.blindRuns++;
          row.blindHits += hits ? 1 : 0;
        } else row.waitHits += hits;
      }
    }
    out[lane.id] = row;
    if (!row.blindHits) P(`lane ${lane.id}: the ${key} line without its wait was never struck in ${row.phases} start phases (the lane does not cross it)`);
    if (row.waitHits) P(`lane ${lane.id}: the ${key} line WITH its wait was struck ${row.waitHits} time(s)`);
  }
  return out;
}
