// Surface navigation of the Mason and the skitterlings (sim/creatureNav.js + Creature3D, Node): they move ON the masonry, never through open air.
//   - the mesh: built from the crawlable faces, linked, one big connected region covering the descent, no tiny islands, deterministic, cached;
//   - paths: A* is optimal (against a reference Dijkstra), every step is a link, goals stay in the head's own region, queries are cheap;
//   - teleports (entry, the rubber band, the stuck guard) land on the masonry; a head put in mid-air is hauled back by the leash;
//   - the headline: over seeded hunts of both creatures in six sections, the head is almost never more than 3 m above its hug height
//     (the telegraphed strike is the one thing that leaves the surface); switched off (CREATURE_TUNING.nav.enabled = false) the old free flight returns.
//   node nav.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, CREATURE_TUNING: T, isStructural, boxSurface } = await import(srcUrl('sim/creature3d.js'));
const { SurfaceNav, surfaceNavFor } = await import(srcUrl('sim/creatureNav.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};

const L = new Level3D(LEVEL_DATA_3D, 'normal');
const OPTS = { structural: isStructural, hug: T.hug, clear: T.minClear, cell: 3, corridor: T.nav.corridor };

// 1. The mesh.
const t0 = performance.now();
const nav = new SurfaceNav(L, OPTS);
const buildMs = performance.now() - t0;
ok(nav.ready && nav.count > 15000 && nav.links > nav.count, `the mesh is built from the crawlable faces: ${nav.count} nodes, ${nav.links} links (${buildMs.toFixed(0)} ms)`);
const sizes = new Map();
for (let i = 0; i < nav.count; i++) sizes.set(nav.region[i], (sizes.get(nav.region[i]) || 0) + 1);
const biggest = Math.max(...sizes.values());
ok([...sizes.values()].every((n) => n >= 150), `no island smaller than 150 nodes is left in the mesh (${sizes.size} regions, ${nav.pruned} nodes pruned)`);
ok(biggest > nav.count * 0.6, `one big region carries the descent (${biggest} of ${nav.count} nodes)`);
const nodeAt = (x, y, z) => nav.nearest(x, y, z, 60);
const spawn = L.spawn;
const nook = nodeAt(-20.3, -199.6, -1.4);
ok(nav.region[nodeAt(spawn.x, spawn.y, spawn.z)] === nav.region[nook] && nav.region[nook] === nav.region[nodeAt(-16, -104, -23)], 'the S1 spawn, the S4 catwalk and the S5 keystone niche are in the same region');
// every node is clear of every other solid and inside the level
let clear = true;
const tmp = [];
for (let i = 0; i < nav.count && clear; i += 37) {
  L.querySolidsStatic(nav.px[i] - 1, nav.py[i] - 1, nav.pz[i] - 1, nav.px[i] + 1, nav.py[i] + 1, nav.pz[i] + 1, tmp);
  const o = {};
  for (const s of tmp) if (s.active !== false && boxSurface(s, nav.px[i], nav.py[i], nav.pz[i], o) < T.minClear - 0.01) clear = false;
}
ok(clear, 'every sampled node keeps minClear from every solid');
const h = (n) => {
  let a = 0x811c9dc5;
  for (let i = 0; i < n.count; i++) a = Math.imul(a ^ Math.round(n.px[i] * 10) ^ (Math.round(n.py[i] * 10) << 3) ^ (Math.round(n.pz[i] * 10) << 7), 16777619) >>> 0;
  return a ^ n.links;
};
ok(h(new SurfaceNav(new Level3D(LEVEL_DATA_3D, 'normal'), OPTS)) === h(nav), 'the mesh is deterministic (a rebuild from a fresh level is identical)');
ok(surfaceNavFor(L, OPTS) === surfaceNavFor(new Level3D(LEVEL_DATA_3D, 'normal'), OPTS), 'the mesh is cached per level data (hundreds of Level3D objects share one)');

// 2. Paths: optimal, linked, in-region, cheap.
function dijkstra(from, to) {
  const d = new Float64Array(nav.count).fill(Infinity);
  const done = new Uint8Array(nav.count);
  d[from] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < nav.count; i++) if (!done[i] && d[i] < best) { best = d[i]; u = i; }
    if (u < 0 || u === to) return d[to];
    done[u] = 1;
    for (let e = nav.adjStart[u]; e < nav.adjStart[u + 1]; e++) {
      const v = nav.adjTo[e];
      if (d[u] + nav.adjCost[e] < d[v]) d[v] = d[u] + nav.adjCost[e];
    }
  }
}
{
  const big = [];
  const region = nav.region[nook];
  for (let i = 0; i < nav.count; i++) if (nav.region[i] === region) big.push(i);
  let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const out = new Int32Array(1024);
  let good = 0;
  let linked = true;
  let optimal = true;
  let worst = 0;
  let sum = 0;
  const N = 60;
  for (let q = 0; q < N; q++) {
    const a = big[(rnd() * big.length) | 0];
    let b;
    let tries = 0;
    do b = big[(rnd() * big.length) | 0];
    while (tries++ < 200 && !(Math.hypot(nav.px[a] - nav.px[b], nav.py[a] - nav.py[b], nav.pz[a] - nav.pz[b]) > 15 && Math.hypot(nav.px[a] - nav.px[b], nav.py[a] - nav.py[b], nav.pz[a] - nav.pz[b]) < 55));
    const t = performance.now();
    const n = nav.findPath(a, b, out);
    const ms = performance.now() - t;
    worst = Math.max(worst, ms);
    sum += ms;
    if (!n) continue;
    good++;
    if (out[0] !== a || out[n - 1] !== b) linked = false;
    let cost = 0;
    for (let k = 0; k + 1 < n; k++) {
      let found = -1;
      for (let e = nav.adjStart[out[k]]; e < nav.adjStart[out[k] + 1]; e++) if (nav.adjTo[e] === out[k + 1]) found = e;
      if (found < 0) linked = false;
      else cost += nav.adjCost[found];
    }
    if (q < 12 && Math.abs(cost - dijkstra(a, b)) > 0.01) optimal = false;
  }
  ok(good >= N * 0.95, `paths of 15-55 m are found (${good}/${N})`);
  ok(linked, 'every path starts and ends where asked and every step is a link of the mesh');
  ok(optimal, 'A* paths cost exactly what a reference Dijkstra finds (12 pairs)');
  ok(worst < 40 && sum / N < 5, `path queries are cheap (mean ${(sum / N).toFixed(2)} ms, worst ${worst.toFixed(1)} ms)`);
  // goals stay in the head's region
  let inRegion = true;
  for (let q = 0; q < 30; q++) {
    const a = big[(rnd() * big.length) | 0];
    const g = nav.goalNear(nav.px[a] + (rnd() - 0.5) * 30, nav.py[a] + (rnd() - 0.5) * 30, nav.pz[a] + (rnd() - 0.5) * 30, 60, region, L);
    if (g >= 0 && nav.region[g] !== region) inRegion = false;
  }
  ok(inRegion, 'goalNear only ever returns a node of the requested region');
  ok(nav.findPath(-1, 5, out) === 0 && nav.findPath(3, 3, out) === 1, 'degenerate queries: no node -> no path; from == to -> one node');
}

// 3. Teleports land on masonry; the leash hauls a stray head back.
function mk(variant, seed, sec) {
  const lv = new Level3D(LEVEL_DATA_3D, 'normal');
  const c = new Creature3D(lv, DIFFICULTY.nightmare, new EventBus(), { seed, variant });
  const cp = lv.sections[sec].checkpoint;
  const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
  c.reset(p);
  c.setSection(sec, lv.sections[sec], p);
  return { lv, c, p, cp };
}
{
  const { c, p } = mk('', 1, 5);
  c._navMesh();
  const o = {};
  // a point in open air in the shaft below the player (more than hug + slack from every surface), found by scanning down the shaft's axis
  let air = false;
  for (let dy = 12; dy < 160 && !air; dy += 5) {
    c._shift(p.x - c.x, p.y - dy - c.y, p.z - c.z);
    air = c._findSurface(c.x, c.y, c.z, T.hug + T.nav.slack, o) === Infinity && c._clearAt(c.x, c.y, c.z);
  }
  const moved = air && c._snapToNav(T.nav.snapRange);
  const after = c._findSurface(c.x, c.y, c.z, T.hug + T.nav.slack + 0.01, o);
  ok(air && moved && after < Infinity && c._clearAt(c.x, c.y, c.z), 'a teleport that would land in mid-air is moved onto the masonry (within hug + slack, clear of solids)');
  ok(!c._snapToNav(T.nav.snapRange), 'a head already on a surface is left where it is');
  // a teleport that lands INSIDE a block is moved out onto the masonry too
  const sol = c.level.solids.find((s) => s.kind === 'wall' && s.maxY - s.minY > 20);
  c._shift((sol.minX + sol.maxX) / 2 - c.x, (sol.minY + sol.maxY) / 2 - c.y, (sol.minZ + sol.maxZ) / 2 - c.z);
  const inside = !c._clearAt(c.x, c.y, c.z);
  ok(inside && c._snapToNav(T.nav.snapRange) && c._clearAt(c.x, c.y, c.z), 'a teleport that lands inside a wall is moved out onto the masonry');
  // the leash: pulled 5 m off the wall (along the surface normal) the head is back within hug + slack in a second
  const sf = {};
  c._findSurface(c.x, c.y, c.z, 10, sf);
  c.x += sf.nx * 5;
  c.y += sf.ny * 5;
  c.z += sf.nz * 5;
  const n0 = c._findSurface(c.x, c.y, c.z, 12, o);
  for (let i = 0; i < 60; i++) c._surfaceStep(1 / 60, 1);
  const n1 = c._findSurface(c.x, c.y, c.z, 12, o);
  ok(n0 > T.hug + T.nav.slack + 0.5 && n1 <= T.hug + T.nav.slack + 0.4, `the leash hauls a head put 5 m off the wall back within hug + slack in a second (${n0.toFixed(1)} -> ${n1.toFixed(2)} m)`);
}

// 4. The headline: how far from the masonry is the head, in hunts of both creatures.
function airShare(variant, navOn) {
  const saved = T.nav.enabled;
  T.nav.enabled = navOn;
  let frames = 0;
  let over3 = 0;
  let over1 = 0;
  let worst = 0;
  const list = [];
  const o = {};
  for (const sec of [2, 3, 4, 5, 6]) {
    for (const seed of [1, 2]) {
      const { lv, c, p, cp } = mk(variant, seed, sec);
      for (let i = 0; i < 60 * 25; i++) {
        const t = i / 60;
        p.x = cp.x + Math.sin(t * 0.7) * 6;
        p.z = cp.z + Math.cos(t * 0.5) * 6;
        p.y = cp.y - ((0.5 * t) % 30);
        c.update(1 / 60, p, t);
        if (c.caughtPlayer) {
          c.reset(p);
          c.setSection(sec, lv.sections[sec], p);
          continue;
        }
        if (!c.inPlay || !c.body.visible || c.state === 'ATTACK') continue; // the strike is the one thing that leaves the surface
        lv.querySolids(c.x - 30, c.y - 30, c.z - 30, c.x + 30, c.y + 30, c.z + 30, list);
        let d = Infinity;
        for (const s of list) if (s.active !== false && s.kind !== 'crumble' && s.kind !== 'grate') d = Math.min(d, boxSurface(s, c.x, c.y, c.z, o));
        const over = d - c._hug;
        frames++;
        if (over > 3) over3++;
        if (over > 1) over1++;
        if (over > worst) worst = over;
      }
    }
  }
  T.nav.enabled = saved;
  return { frames, over3: over3 / Math.max(1, frames), over1: over1 / Math.max(1, frames), worst };
}
for (const variant of ['', 'skitterling']) {
  const name = variant || 'mason';
  const on = airShare(variant, true);
  const off = airShare(variant, false);
  ok(on.frames > 3000, `${name}: enough hunting frames measured (${on.frames})`);
  ok(on.over3 < 0.005 && on.worst < 7, `${name}: with navigation the head is more than 3 m above its hug height in ${(on.over3 * 100).toFixed(2)} % of frames (worst ${on.worst.toFixed(1)} m); free-flying it was ${(off.over3 * 100).toFixed(1)} % (worst ${off.worst.toFixed(1)} m)`);
  ok(off.over3 > on.over3 * 4, `${name}: switching navigation off (CREATURE_TUNING.nav.enabled = false) brings the free flight back (${(off.over3 * 100).toFixed(1)} % of frames)`);
}
{
  const saved = T.nav.enabled;
  T.nav.enabled = false;
  const { c, p, cp } = mk('', 1, 5);
  for (let i = 0; i < 600; i++) c.update(1 / 60, { ...p, x: cp.x, y: cp.y, z: cp.z }, i / 60);
  T.nav.enabled = saved;
  ok(c.navStats.replans === 0 && c.navStats.leashes === 0 && c._navMesh() === null, 'with navigation off the creature never plans or leashes');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL NAVIGATION CHECKS PASS');
process.exit(fails ? 1 : 0);
