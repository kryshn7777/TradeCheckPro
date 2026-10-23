// Collision for the environment kit dressing (sim/decorColliders.js + Level3D decor solids), Node:
//   - the part boxes (data/decor-parts-3d.js) are sound and sit inside both kits' parts,
//   - placement matrices -> world boxes (axis-aligned frames only), the safety rules that keep an anchor, a grip, a checkpoint,
//     a hazard or a walkway clear,
//   - Level3D: decor solids are in querySolids (and the rope / line-of-sight / raycast through it) but not in solids or
//     querySolidsStatic (what the dressing plans against), clear / re-add,
//   - Physics3D: the player lands on a decor box and is held by it.
//   node decor.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import path from 'node:path';
import { srcUrl, GAME_ROOT } from '../../verify/root.mjs';
import { readGLB } from '../render/glbRead.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DECOR_PARTS } = await import(srcUrl('data/decor-parts-3d.js'));
const DC = await import(srcUrl('sim/decorColliders.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

/** Column-major 4x4: rotation about +Y by `a` radians, scale (sx, sy, sz), translation (x, y, z). */
function frame(x, y, z, a = 0, sx = 1, sy = 1, sz = 1) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1];
}

// 1. The part data.
{
  const names = Object.keys(DECOR_PARTS);
  let good = names.length >= 12;
  let boxes = 0;
  for (const n of names) {
    for (const b of DECOR_PARTS[n]) {
      boxes++;
      if (b.length !== 6 || b.some((v) => !Number.isFinite(v)) || !(b[0] < b[3] && b[1] < b[4] && b[2] < b[5])) good = false;
    }
  }
  ok(good, `decor-parts-3d: ${names.length} parts, ${boxes} boxes, all finite with min < max`);
  ok(!('wall_a' in DECOR_PARTS) && !('gear' in DECOR_PARTS) && !('root_a' in DECOR_PARTS), 'flush wall relief, cogs and roots do not collide');
}

// 2. The boxes lie inside the parts of every level of detail (the medium level is the source, the others are the same shapes).
{
  const g = await readGLB(path.join(GAME_ROOT, 'assets', 'models', 'env', 'ch1_env_kit.glb'));
  const nodes = new Map();
  g.js.nodes.forEach((node) => {
    if (node.mesh !== undefined) nodes.set((node.name || '').replace(/^ch1_env_/, ''), g.js.accessors[g.js.meshes[node.mesh].primitives[0].attributes.POSITION]);
  });
  for (const [suffix, tol] of [['', 0.01], ['_lod0', 0.06], ['_lod2', 0.4]]) {
    let good = true;
    let seen = 0;
    for (const part of Object.keys(DECOR_PARTS)) {
      const a = nodes.get(part + suffix);
      if (!a) continue;
      seen++;
      for (const b of DECOR_PARTS[part]) for (let k = 0; k < 3; k++) if (b[k] < a.min[k] - tol || b[k + 3] > a.max[k] + tol) good = false;
    }
    ok(good && seen >= (suffix === '_lod2' ? 12 : Object.keys(DECOR_PARTS).length), `ch1_env_kit.glb ${suffix || 'medium'}: every collision box is inside its part (${seen} parts, tolerance ${tol} m)`);
  }
  let all = 0;
  for (const name of nodes.keys()) if (name.endsWith('_lod0')) all++;
  ok(all >= 20, `${all} parts have a rich (lod0) level`);
}

// 3. Frames and world boxes.
{
  ok(DC.isAxisAligned(frame(1, 2, 3)) && DC.isAxisAligned(frame(0, 0, 0, Math.PI / 2)) && DC.isAxisAligned(frame(0, 0, 0, Math.PI, -1, 1, 1)), 'identity, a quarter turn and a mirror are axis aligned');
  ok(!DC.isAxisAligned(frame(0, 0, 0, 0.5)), 'a free angle is not (the part stays dressing)');
  const out = [];
  const n = DC.instanceBoxes('corbel', frame(10, 20, 30), out);
  const local = DECOR_PARTS.corbel;
  ok(n === local.length && out.length === n && near(out[0][0], local[0][0] + 10) && near(out[0][4], local[0][4] + 20) && near(out[0][5], local[0][5] + 30), 'a translated corbel: world boxes = local boxes + offset');
  out.length = 0;
  DC.instanceBoxes('corbel', frame(0, 0, 0, Math.PI / 2), out);
  // a quarter turn about +Y: local +z -> world +x
  ok(near(out[0][0], local[0][2]) && near(out[0][3], local[0][5]) && near(out[0][2], -local[0][3]) && near(out[0][5], -local[0][0]), 'a quarter turn about +Y: local z lands on world x, local x on world -z');
  out.length = 0;
  ok(DC.instanceBoxes('wall_a', frame(0, 0, 0), out) === 0 && DC.instanceBoxes('corbel', frame(0, 0, 0, 0.5), out) === 0 && out.length === 0, 'non-colliding parts and free angles produce nothing');
  out.length = 0;
  DC.instanceBoxes('stair_fragment', frame(0, 0, 0, 0, -1, 1, 1), out);
  ok(out.length === DECOR_PARTS.stair_fragment.length && out.every((b) => b[0] < b[3]), 'a mirrored stair flight keeps ordered boxes');
}

// 4. The safety rules, on a synthetic level.
{
  const level = (extra = {}) => Object.assign({ anchors: [], climb: [], edges: [], hazards: [], solids: [], sections: [], spawn: { x: 1e4, y: 0, z: 0 }, gate: null, goal: null }, extra);
  const place = (e) => ({ part: 'ch1_env_corbel', m: { elements: e } });
  const base = frame(0, 0, 0);
  let r = DC.decorColliders(level(), [place(base)]);
  ok(r.stats.accepted === 1 && r.boxes.length === DECOR_PARTS.corbel.length, 'a corbel in open space collides');
  r = DC.decorColliders(level({ anchors: [{ x: 0, y: -0.5, z: 1.0 }] }), [place(base)]);
  ok(r.stats.rejected === 1 && r.boxes.length === 0, 'an anchor within reach: stays dressing');
  r = DC.decorColliders(level({ anchors: [{ x: 0, y: -0.5, z: 5 }] }), [place(base)]);
  ok(r.stats.accepted === 1, 'an anchor 5 m away: collides');
  r = DC.decorColliders(level({ climb: [{ minX: -0.2, maxX: 0.2, minY: -1, maxY: 0, minZ: 0.7, maxZ: 0.9 }] }), [place(base)]);
  ok(r.stats.rejected === 1, 'a climb grip zone beside it: stays dressing');
  r = DC.decorColliders(level({ edges: [{ minX: 0.45, maxX: 0.5, minY: -0.5, maxY: -0.4, minZ: 0.3, maxZ: 0.4 }] }), [place(base)]);
  ok(r.stats.rejected === 1, 'a procedural edge hold beside it: stays dressing');
  r = DC.decorColliders(level({ hazards: [{ minX: -1, maxX: 1, minY: -0.6, maxY: -0.4, minZ: 0.7, maxZ: 0.9 }] }), [place(base)]);
  ok(r.stats.rejected === 1, 'a hazard beside it: stays dressing');
  r = DC.decorColliders(level({ spawn: { x: 0, y: -0.5, z: 1.5 } }), [place(base)]);
  ok(r.stats.rejected === 1, 'the spawn / a checkpoint within 2 m: stays dressing');
  // a walkway: a 6 x 6 slab whose top is 0.2 m under the corbel's underside: its 1.9 m headroom is blocked by the box
  const slab = { minX: -3, maxX: 3, minZ: -3, maxZ: 3, minY: -1.6, maxY: -1.3, active: true };
  r = DC.decorColliders(level({ solids: [slab] }), [place(base)]);
  ok(r.stats.rejected === 1, 'a box in the headroom over a ledge: stays dressing');
  const high = Object.assign({}, slab, { minY: -9, maxY: -8 });
  r = DC.decorColliders(level({ solids: [high] }), [place(base)]);
  ok(r.stats.accepted === 1, 'a ledge far below: collides');
  const wall = { minX: -3, maxX: 3, minZ: -3, maxZ: 0, minY: -50, maxY: 50, active: true };
  r = DC.decorColliders(level({ solids: [wall] }), [place(base)]);
  ok(r.stats.accepted === 1, 'a tall wall is not a ledge: the corbel on it collides');
  r = DC.decorColliders(level(), [place(frame(0, 0, 0, 0.5))]);
  ok(r.stats.skipped === 1 && r.boxes.length === 0, 'a free-angle placement is skipped');
}

// 5. Level3D.
const mkLevel = () => new Level3D(undefined, 'normal');
{
  const level = mkLevel();
  const nSolids = level.solids.length;
  const sp = level.spawn;
  const probe = (fn) => fn(sp.x - 5, sp.y + 4, sp.z - 5, sp.x + 5, sp.y + 8, sp.z + 5, []);
  const before = probe((...a) => level.querySolids(...a)).length;
  level.addDecorColliders([[sp.x - 0.5, sp.y + 5, sp.z - 0.5, sp.x + 0.5, sp.y + 6, sp.z + 0.5]]);
  const all = probe((...a) => level.querySolids(...a));
  const stat = probe((...a) => level.querySolidsStatic(...a));
  ok(all.length === before + 1 && all.some((s) => s.decor === true && s.id === 'dcr0') && stat.length === before && !stat.some((s) => s.decor), 'querySolids includes the decor box, querySolidsStatic does not');
  ok(level.solids.length === nSolids && !level.byId.dcr0, 'level.solids and byId are untouched');
  ok(level.segmentBlocked(sp.x, sp.y + 8, sp.z, sp.x, sp.y + 4, sp.z, 0), 'line of sight / the rope is blocked by the box');
  const hit = level.raycast(sp.x, sp.y + 8, sp.z, 0, -1, 0, 10);
  ok(hit && hit.solid.decor === true && near(hit.y, sp.y + 6, 1e-6), 'a ray down hits the top of the box');
  level.clearDecorColliders();
  ok(probe((...a) => level.querySolids(...a)).length === before && !level.segmentBlocked(sp.x, sp.y + 8, sp.z, sp.x, sp.y + 4, sp.z, 0), 'clear removes it again');
  level.addDecorColliders([[0, 0, 0, 1, 1, 1], [5, 0, 0, 6, 1, 1]]);
  ok(level.decorSolids.length === 2 && level.decorSolids[1].id === 'dcr1' && level.decorSolids.every((s) => s.kind === 'stone' && s.active === true), 'ids and fields of added boxes');
}

// 6. Physics3D: land on it.
{
  const diff = DIFFICULTY.normal;
  const run = (withBox) => {
    const level = mkLevel();
    const bus = new EventBus();
    const tethers = new TetherSystem(level, diff, bus, {});
    const physics = new Physics3D(level, diff, bus);
    const sp = level.spawn;
    const p = new Player3D(sp.x, sp.y, sp.z);
    for (let i = 0; i < 480; i++) physics.step(p, tethers, {}, CONFIG.PHYSICS_DT);
    const rest = p.y;
    if (withBox) level.addDecorColliders([[sp.x - 1, rest + 0.5, sp.z - 1, sp.x + 1, rest + 1.1, sp.z + 1]]);
    p.y = rest + 2.5;
    p.prevY = p.y;
    p.vy = 0;
    p.grounded = false;
    for (let i = 0; i < 480 && !(p.grounded && i > 20); i++) physics.step(p, tethers, {}, CONFIG.PHYSICS_DT);
    for (let i = 0; i < 240; i++) physics.step(p, tethers, {}, CONFIG.PHYSICS_DT);
    return { rest, y: p.y, grounded: p.grounded, alive: p.alive };
  };
  const a = run(false);
  const b = run(true);
  ok(a.grounded && near(a.y, a.rest, 0.05), `without the box the player falls back to the ledge (y ${a.y.toFixed(2)} = ${a.rest.toFixed(2)})`);
  // the player position is the sphere centre: standing on a surface it sits one radius above it
  ok(b.grounded && b.alive && near(b.y, b.rest + 1.1 + CONFIG.player.radius, 0.05), `with a decor box whose top is 1.1 m above the player's rest height it stands on it (y ${b.y.toFixed(2)}, rest ${b.rest.toFixed(2)}, radius ${CONFIG.player.radius})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL DECOR COLLISION CHECKS PASS');
process.exitCode = fails ? 1 : 0;
