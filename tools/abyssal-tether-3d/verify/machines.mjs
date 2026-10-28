// LEVEL_FUN_PLAN P4 ("machines") checks: the movers (src/sim/movers3d.js: closed-form moving anchors) and the rockfall
// lanes (src/sim/objectives3d.js), against the live level of a variant.
//
//   machineIntegrity(L, v, P)  V1 / V12: at most MAX_MOVERS movers; every mover carries an anchor of this variant; no carried
//                              anchor ever moves faster than MOVER_MAX_SPEED (1.5 m/s) with the knobs of any difficulty that
//                              plays this variant; a carried ring out of its housing never comes within RING_CLEAR of a solid
//                              (64 poses a cycle); every lane: a sane schedule (on + lead < period), inside its section's
//                              shaft, and no checkpoint, supply spot, anchor or ledge top inside it (the stones never fall
//                              where you stand or hook: only through the air you swing across).
//   laneProbe(makeLevel, v, R, P)  V6: the section route that crosses a lane, played WITHOUT its `wait: { lane }` step from
//                              several start phases of the run clock, is struck at least once (the lane is real); played as
//                              written it never is (verify.mjs also fails any bot route that is struck).
import { Sim, DIFFICULTY } from './sim.mjs';
import { Bot } from './bot.mjs';
import { srcUrl } from './root.mjs';

const mv = await import(srcUrl('sim/movers3d.js')).catch(() => null);
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js')).catch(() => ({ Objectives3D: null }));

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
