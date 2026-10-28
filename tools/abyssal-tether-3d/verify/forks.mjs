// LEVEL_FUN_PLAN P2 (item 8 forks, item 6 the long way pays) checks of the level data's `routes` against the live level and
// the bot lines (routes.mjs FORKS). Pure: no sim, no bots (verify.mjs plays the lines; tests/objectives/forks.mjs too).
//
//   forkIntegrity(L, R, P)  V1: every section but the first has a fork with one fast and one safe line; each line's ids are
//                           anchors and its stops solids of this variant; the lines differ; the anchors only the fast line
//                           uses are tagged risk / shortcut (never recovery); the section's objective has a ring on each
//                           line; the bot lines hook exactly the data's anchors (in order) and stand on its stops; no supply
//                           spot lies within FAST_CLEAR m of a risk / shortcut ring; every 'slow' supply spot stands on a
//                           stop of a safe line of its section.
export const FAST_CLEAR = 3; // m: no supply spot this close to a risk / shortcut ring (the plan's "no spots on fast lines")

/** The anchors a bot route hooks, in order (an array step names alternatives: the one present in L). */
export function routeAnchors(L, route) {
  const out = [];
  for (const st of route) {
    if (!st.a) continue;
    const ids = Array.isArray(st.a) ? st.a : [st.a];
    const id = ids.find((k) => L.byId[k] && L.byId[k].minX === undefined);
    if (id) out.push(id);
  }
  return out;
}

/** The ledges a bot route stands on (its `p` steps; alternatives resolved in L). */
export function routeStops(L, route) {
  const out = [];
  for (const st of route) {
    if (!st.p) continue;
    const ids = Array.isArray(st.p) ? st.p : [st.p];
    const id = ids.find((k) => L.byId[k] && L.byId[k].minX !== undefined);
    if (id) out.push(id);
  }
  return out;
}

export function forkIntegrity(L, R, P) {
  const data = Array.isArray(L.data.routes) ? L.data.routes : [];
  const out = { forks: 0, lines: data.length, fastOnly: {}, slowSpots: 0 };
  if (!data.length) return out;
  const isAnchor = (id) => L.byId[id] && L.byId[id].minX === undefined;
  const isSolid = (id) => L.byId[id] && L.byId[id].minX !== undefined;
  const byFork = new Map();
  for (const r of data) {
    if (r.line !== 'fast' && r.line !== 'safe') P(`route ${r.id}: line '${r.line}' (want fast | safe)`);
    if (!Array.isArray(r.ids) || !r.ids.length) P(`route ${r.id}: no anchors`);
    for (const id of r.ids || []) if (!isAnchor(id)) P(`route ${r.id}: '${id}' is not an anchor of this variant`);
    for (const id of r.stops || []) if (!isSolid(id)) P(`route ${r.id}: stop '${id}' is not a solid of this variant`);
    const f = byFork.get(r.fork) || {};
    if (f[r.line]) P(`fork ${r.fork}: two ${r.line} lines (${f[r.line].id}, ${r.id})`);
    f[r.line] = r;
    byFork.set(r.fork, f);
  }
  const forkedSections = new Set();
  const objOf = (sid) => (Array.isArray(L.data.objectives) ? L.data.objectives.find((o) => o.section === sid) : null);
  const fixtures = Array.isArray(L.data.fixtures) ? L.data.fixtures : [];
  for (const [fid, f] of byFork) {
    out.forks++;
    if (!f.fast || !f.safe) {
      P(`fork ${fid}: needs one fast and one safe line`);
      continue;
    }
    if (f.fast.section !== f.safe.section) P(`fork ${fid}: its lines name different sections`);
    forkedSections.add(f.fast.section);
    const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
    if (same(f.fast.ids, f.safe.ids) && same(f.fast.stops, f.safe.stops)) P(`fork ${fid}: the fast and safe lines are the same`);
    // the fast line's own rings: risk / shortcut, never recovery; nothing to pick up near them
    const safeIds = new Set(f.safe.ids);
    const only = f.fast.ids.filter((id) => !safeIds.has(id));
    out.fastOnly[fid] = only.length;
    for (const id of f.fast.ids) {
      const a = L.byId[id];
      if (a && a.tag === 'recovery') P(`fork ${fid}: the fast line uses recovery ring ${id}`);
    }
    for (const id of only) {
      const a = L.byId[id];
      if (a && a.tag !== 'risk' && a.tag !== 'shortcut') P(`fork ${fid}: fast-line ring ${id} is tagged '${a.tag}' (want risk | shortcut)`);
    }
    // the objective: a ring of it on each line (or one both lines hook)
    const obj = objOf(f.fast.section);
    if (obj) {
      const rings = (obj.ids || []).map((x) => fixtures.find((fx) => fx.id === x)).filter(Boolean).map((fx) => fx.anchorId);
      for (const line of [f.fast, f.safe]) if (!rings.some((id) => line.ids.includes(id))) P(`fork ${fid}: the ${line.line} line hooks no ring of objective ${obj.id} (${rings.join(', ')})`);
    }
  }
  for (let i = 1; i < L.sections.length; i++) if (!forkedSections.has(L.sections[i].id)) P(`section ${L.sections[i].id} has no fork (fast + safe line)`);
  // the bot lines play the data lines
  for (const F of (R && R.FORKS) || []) {
    const f = byFork.get(F.data);
    if (!f) {
      P(`routes.mjs fork ${F.key}: no level data fork '${F.data}'`);
      continue;
    }
    for (const line of ['fast', 'safe']) {
      const route = R.ROUTES[F[line]];
      if (!route || !f[line]) {
        P(`routes.mjs fork ${F.key}: no ${line} line ${F[line]}`);
        continue;
      }
      const got = routeAnchors(L, route);
      if (JSON.stringify(got) !== JSON.stringify(f[line].ids)) P(`fork ${F.key} ${line}: the bot line ${F[line]} hooks ${got.join(' ')}, the data says ${f[line].ids.join(' ')}`);
      const stops = new Set(routeStops(L, route));
      for (const id of f[line].stops || []) if (!stops.has(id)) P(`fork ${F.key} ${line}: the bot line ${F[line]} never stands on ${id}`);
    }
  }
  // no spots on fast lines: none within FAST_CLEAR of a risk / shortcut ring (plan item 6)
  for (const a of L.anchors) {
    if (a.tag !== 'risk' && a.tag !== 'shortcut') continue;
    for (const s of L.data.supplies || []) if (Math.hypot(s.x - a.x, s.y - a.y, s.z - a.z) < FAST_CLEAR) P(`supply ${s.id} is within ${FAST_CLEAR} m of ${a.tag} ring ${a.id}`);
  }
  // 'slow' supplies stand on a safe line's ledge of their own section
  const safeStops = new Map();
  for (const f of byFork.values()) if (f.safe) safeStops.set(f.safe.section, new Set(f.safe.stops || []));
  for (const s of L.data.supplies || []) {
    if (s.tier !== 'slow') continue;
    out.slowSpots++;
    const sec = L.sections[L.sectionIndexAt(s.y)];
    const ok = sec && safeStops.has(sec.id) && safeStops.get(sec.id).has(s.on);
    if (!ok) P(`supply ${s.id} (tier slow) is not on a safe-line ledge of ${sec ? sec.id : '?'} (on ${s.on})`);
  }
  return out;
}
