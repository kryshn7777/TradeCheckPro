// FREE ATTACH (Level3D opts.freeAttach, CONFIG.targeting.freeAttach), Node:
//   - the real level: the plain traversal rings / hooks are retired, every anchor that does something stays (named by the data,
//     frayed, objective, moving); the ring-only level (no opts) is untouched,
//   - Level3D.surfaceTarget on a small hand-built level: floors, walls, ceilings, ledge undersides, the offset off the surface,
//     edge / corner preference (snap radius, line of sight, switched off), nothing in range, a ray starting in a solid,
//   - TetherSystem: the hook bites the surface under the aim (a baked copy, the highlight keeps following), a ring still wins,
//     the range and the minimum distance, a ring-only level whiffs as before, a crumbling ledge is a frayed hold and the line
//     comes off when it falls, a swing on a ceiling hold stays on its rope, the Dresser never saws a surface hold, determinism.
//   node freeattach.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { cuttable } = await import(srcUrl('sim/dresser3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const unit = (x, y, z) => {
  const l = Math.hypot(x, y, z);
  return { dx: x / l, dy: y / l, dz: z / l };
};
const DT = CONFIG.PHYSICS_DT;
const SNAP = CONFIG.targeting.surfaceSnap;
const OFF = CONFIG.targeting.surfaceOffset;

// ---------------------------------------------------------------------------------------------------------------------------
// 1. The real level.
// ---------------------------------------------------------------------------------------------------------------------------
{
  const legacy = new Level3D();
  const free = new Level3D(undefined, 'normal', { freeAttach: true });
  ok(legacy.freeAttach === false && legacy.retiredAnchors.length === 0, 'a level built without opts is the ring-only level: freeAttach false, nothing retired');
  ok(free.freeAttach === true, 'opts.freeAttach switches free attach on');
  ok(free.anchors.length + free.retiredAnchors.length === legacy.anchors.length, `every anchor is kept or retired (${free.anchors.length} + ${free.retiredAnchors.length} = ${legacy.anchors.length})`);
  ok(free.anchors.length > 0 && free.anchors.length < legacy.anchors.length / 2, `most anchors are retired (${free.retiredAnchors.length} of ${legacy.anchors.length})`);

  const keptIds = new Set(free.anchors.map((a) => a.id));
  const named = ['s2-cw', 's3-winch', 'key-s5-ring', 's3-cage', 's6-sa3', 's6-ra3'];
  ok(named.every((id) => keptIds.has(id)), `the anchors the data names stay: ${named.join(', ')}`);
  ok(legacy.anchors.filter((a) => a.kind === 'fragile').every((a) => keptIds.has(a.id)), 'every frayed ring stays (it breaks under load)');
  ok(free.dynAnchors.length === legacy.dynAnchors.length && free.dynAnchors.length >= 2, `the moving rings stay (${free.dynAnchors.length}): the S3 cage and winch`);
  const plain = free.retiredAnchors.every((a) => a.kind === 'ring' || a.kind === 'hook');
  ok(plain, 'only plain rings and hooks are retired');
  ok(['t1', 't2', 's4-a1', 's8-e1', 's2-hook', 's5-h1'].every((id) => !keptIds.has(id) && !free.byId[id]), 'route, tutorial, escape and hook rings are gone from anchors and byId');
  ok(free.byId['s2-cw'] === free.anchors.find((a) => a.id === 's2-cw'), 'byId resolves the kept anchors');
  ok(free.movers.length === legacy.movers.length, 'the movers still build with their carried rings');

  // objectives that name an anchor still find it (an unresolved id would be a silent dead objective)
  const refs = [];
  const walk = (v, key) => {
    if (Array.isArray(v)) v.forEach((e) => walk(e, key));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) (k === 'anchorId' && typeof v[k] === 'string' ? refs.push(v[k]) : walk(v[k], k));
  };
  for (const k of Object.keys(free.data)) if (!['anchors', 'routes', 'solids', 'hazards', 'decor', 'lights', 'climb', 'supplies'].includes(k)) walk(free.data[k], k);
  const missing = refs.filter((id) => !free.byId[id]);
  ok(refs.length >= 5 && missing.length === 0, `all ${refs.length} anchorId references in the data resolve on the free level${missing.length ? ' (missing ' + missing.join(',') + ')' : ''}`);

  // the retirement is per variant: the abyss variant still builds
  const ab = new Level3D(undefined, 'abyss', { freeAttach: true });
  ok(ab.anchors.length > 0 && ab.anchors.length <= free.anchors.length + 2, `the abyss variant builds with free attach (${ab.anchors.length} anchors)`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2. surfaceTarget on a hand-built level.
// ---------------------------------------------------------------------------------------------------------------------------
const box = (id, x0, x1, y0, y1, z0, z1, kind = 'stone') => ({ id, minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, kind });
const DATA = {
  name: 'free-attach-test',
  solids: [
    box('floor', -20, 20, -1, 0, -20, 20),
    box('wall', -20, 20, -1, 30, -21, -20, 'wall'),
    box('ceil', -4, 4, 10, 11, -4, 4),
    box('ledge', 6, 10, 2, 3, -2, 2),
    box('crumb', -10, -6, 4, 5, -2, 2, 'crumble'),
  ],
  anchors: [{ id: 'ringA', x: 0, y: 6, z: -12, kind: 'ring', tag: 'objective', normal: { x: 0, y: -1, z: 0 } }],
};
const free = new Level3D(DATA, 'normal', { freeAttach: true });
const out = {};
const cast = (o, d, max = 40, snap = SNAP) => free.surfaceTarget(o.x, o.y, o.z, d.dx, d.dy, d.dz, max, snap, OFF, out);

{
  ok(free.anchors.length === 1 && free.anchors[0].id === 'ringA', 'the objective-tagged ring of the test level stays');
  let s = cast({ x: 0, y: 5, z: 0 }, unit(0, -1, 0));
  ok(s && !s.edge && near(s.y, OFF, 1e-9) && near(s.x, 0) && s.ny === 1 && s.solid.id === 'floor', `a floor takes the hook: ${OFF} m above it, normal up`);
  s = cast({ x: 0, y: 2, z: 0 }, unit(0, 0, -1));
  ok(s && !s.edge && near(s.z, -20 + OFF, 1e-9) && s.nz === 1 && s.solid.id === 'wall', 'a wall takes the hook: off its face, normal toward the player');
  s = cast({ x: 0, y: 5, z: 0 }, unit(0, 1, 0));
  ok(s && !s.edge && near(s.y, 10 - OFF, 1e-9) && s.ny === -1 && s.solid.id === 'ceil', 'the underside of a ceiling takes the hook (normal down)');
  s = cast({ x: 8, y: 0.5, z: 0 }, unit(0, 1, 0));
  ok(s && s.solid.id === 'ledge' && s.ny === -1 && near(s.y, 2 - OFF, 1e-9), 'the underside of a ledge takes the hook');
  ok(cast({ x: 0, y: 5, z: 0 }, unit(1, 0, 0)) === null, 'a ray that lands on nothing within range has no target');
  ok(cast({ x: 0, y: 2, z: 0 }, unit(0, 0, -1), 10) === null, 'a surface beyond maxDist has no target');
  ok(cast({ x: 0, y: -0.5, z: 0 }, unit(0, 0, 1)) === null, 'a ray that starts inside a solid has no target (a clipped hand)');

  // edges preferred
  const from = { x: 4, y: 8, z: 0 };
  s = cast(from, unit(6.2 - 4, 3 - 8, 0)); // lands on the ledge top 0.2 m behind its front edge
  const edgePt = { x: 6, y: 3, z: 0 };
  ok(s && s.edge && s.solid.id === 'ledge' && near(dist(s, edgePt), OFF, 0.006), `0.2 m from a ledge lip the hook catches the lip (${s ? dist(s, edgePt).toFixed(3) : '-'} m from the edge)`);
  ok(s && near(s.nx, -Math.SQRT1_2, 1e-6) && near(s.ny, Math.SQRT1_2, 1e-6), 'a caught edge reports its outward bisector as the normal');
  s = cast(from, unit(7.5 - 4, 3 - 8, 0));
  ok(s && !s.edge && near(s.y, 3 + OFF, 1e-9) && s.ny === 1, '1.5 m in from the lip it is the plain top face');
  s = cast(from, unit(6.2 - 4, 3 - 8, 0), 40, 0);
  ok(s && !s.edge, 'snap 0 turns edge preference off');
  s = cast(from, unit(6.2 - 4, 3 - 8, 0), 40, 0.1);
  ok(s && !s.edge, 'an edge outside the snap radius does not catch');
  // the middle of the ledge's 1 m side face is 0.5 m from both lips: the snap radius decides
  s = cast({ x: 4, y: 2.5, z: 0 }, unit(6 - 4, 0, 0), 40, 0.4);
  ok(s && s.solid.id === 'ledge' && s.nx === -1 && !s.edge && near(s.x, 6 - OFF, 1e-9), 'a face 0.5 m from the nearest lip is a plain face hit with a 0.4 m snap radius');
  s = cast({ x: 4, y: 2.5, z: 0 }, unit(6 - 4, 0, 0), 40, 0.6);
  ok(s && s.edge, 'and the lip catches it with a 0.6 m snap radius');
  s = cast({ x: 4, y: 2.6, z: 1.95 }, unit(6.05 - 4, 2.6 - 2.6, 0)); // the vertical corner at (6, y, 2), 0.05 m away
  ok(s && s.edge && dist(s, { x: 6, y: 2.6, z: 2 }) < 0.25, 'a block corner catches the hook');
  // an edge the hand cannot see is not caught: the far lip of the ledge seen from below
  s = cast({ x: 8, y: 0.5, z: 0 }, unit(0, 1, 0));
  ok(s && s.solid.id === 'ledge' && !s.edge, 'aiming at the underside well inside the ledge is a face hit, not the far lip');

  // reuse and determinism
  const a = JSON.stringify({ ...cast(from, unit(2.2, -5, 0)), solid: null });
  const b = JSON.stringify({ ...cast(from, unit(2.2, -5, 0)), solid: null });
  ok(a === b, 'surfaceTarget is deterministic and reuses its result object');
}

// ---------------------------------------------------------------------------------------------------------------------------
// 3. TetherSystem on the hand-built level.
// ---------------------------------------------------------------------------------------------------------------------------
function rig(levelData, opts, diffOver) {
  const level = new Level3D(levelData, 'normal', opts);
  const diff = Object.assign({}, DIFFICULTY.normal, diffOver || {});
  const bus = new EventBus();
  const ev = [];
  for (const n of ['grapple:attach', 'grapple:break', 'grapple:miss', 'grapple:release', 'rope:fire']) bus.on(n, (e) => ev.push([n, e]));
  const tethers = new TetherSystem(level, diff, bus, {});
  const physics = new Physics3D(level, diff, bus);
  const p = new Player3D(0, 0.45, 0);
  return { level, diff, bus, ev, tethers, physics, p };
}
function aimAt(o, tx, ty, tz) {
  const d = unit(tx - o.x, ty - o.y, tz - o.z);
  return { ox: o.x, oy: o.y, oz: o.z, dx: d.dx, dy: d.dy, dz: d.dz };
}
const intentOf = (hand, aim, extra) => ({ hands: { [hand]: Object.assign({ aim }, extra) } });
function frame(r, intent) {
  r.tethers.updateTargets(r.p, intent);
  r.tethers.handleInput(r.p, intent, 1 / 60);
  for (let i = 0; i < 4; i++) r.physics.step(r.p, r.tethers, intent, DT);
}
const HAND = { x: 0, y: 1.6, z: 0 };

{
  // the highlight follows the aim; the shot bites a copy
  const r = rig(DATA, { freeAttach: true });
  const aim = aimAt(HAND, 0, 3, -20);
  r.tethers.updateTargets(r.p, intentOf('left', aim));
  const t0 = r.tethers.hands.left.target;
  ok(t0 && t0.free === true && t0.kind === 'surface' && t0.solid.id === 'wall' && near(t0.z, -20 + OFF, 1e-6), 'updateTargets highlights the wall under the aim as a free surface anchor');
  ok(t0.normal.z === 1 && t0.mount === 'solid' && t0.broken === false && t0.hidden === false && t0.dynamic === false, 'the surface anchor has the shape every consumer reads (normal, mount, broken, hidden, dynamic)');

  const press = intentOf('left', aim, { pressed: true, held: true });
  frame(r, press);
  const st = r.tethers.hands.left;
  ok(st.state === 'flying' || st.state === 'attached', `pressing fire launches the hook (${st.state})`);
  const fire = r.ev.find((e) => e[0] === 'rope:fire');
  ok(fire && fire[1].target && fire[1].target.free === true && fire[1].target !== t0, 'the shot carries its own copy of the point, not the highlight object');
  const held = intentOf('left', aim, { held: true });
  for (let i = 0; i < 40 && st.state !== 'attached'; i++) frame(r, held);
  ok(st.state === 'attached' && st.rope.anchor.free === true, 'the hook arrives and the line attaches to the surface point');
  const an = st.rope.anchor;
  const keep = { x: an.x, y: an.y, z: an.z };
  ok(an !== t0 && /^surf\d+$/.test(an.id) && near(an.z, -20 + OFF, 1e-6), `the attached anchor is a baked point on the wall (${an.id})`);
  // the aim sweeps away: the highlight moves, the line does not
  frame(r, intentOf('left', aimAt(HAND, 6, 1, -20), { held: true }));
  ok(dist(an, keep) === 0 && st.rope.anchor === an, 'moving the aim does not move an attached anchor');
  ok(r.ev.some((e) => e[0] === 'grapple:attach' && e[1].anchor === an), 'grapple:attach carries the surface anchor');
  frame(r, intentOf('left', aim, { released: true }));
  ok(st.state === 'idle', 'releasing lets go of a surface hold');
}

{
  // a ring still wins over the surface behind it
  const r = rig(DATA, { freeAttach: true });
  r.tethers.updateTargets(r.p, intentOf('right', aimAt(HAND, 0, 6, -12)));
  const t = r.tethers.hands.right.target;
  ok(t && t.id === 'ringA' && !t.free, 'aimed at a puzzle ring (with the wall behind it) the ring is the target');
  r.tethers.updateTargets(r.p, intentOf('right', aimAt(HAND, 12, 6, -12)));
  const t2 = r.tethers.hands.right.target;
  ok(t2 && t2.free === true, 'aimed well away from the ring the surface is the target again');
}

{
  // ring-only level: nothing changes
  const r = rig(DATA, undefined);
  r.tethers.updateTargets(r.p, intentOf('left', aimAt(HAND, 0, 3, -20)));
  ok(r.tethers.hands.left.target === null, 'a ring-only level has no target on a bare wall');
  frame(r, intentOf('left', aimAt(HAND, 0, 3, -20), { pressed: true, held: true }));
  ok(r.tethers.hands.left.state === 'idle' && r.ev.some((e) => e[0] === 'grapple:miss'), 'and a shot at it whiffs');
  const sw = rig(DATA, { freeAttach: true });
  const saved = CONFIG.targeting.freeAttach;
  CONFIG.targeting.freeAttach = false;
  sw.tethers.updateTargets(sw.p, intentOf('left', aimAt(HAND, 0, 3, -20)));
  CONFIG.targeting.freeAttach = saved;
  ok(sw.tethers.hands.left.target === null, 'CONFIG.targeting.freeAttach = false turns it off on a free level');
}

{
  // range and minimum distance
  const r = rig(DATA, { freeAttach: true }, { aimRange: 12 });
  r.tethers.updateTargets(r.p, intentOf('left', aimAt(HAND, 0, 3, -20)));
  ok(r.tethers.hands.left.target === null, 'a surface beyond the section reach (12 m) is not a target');
  r.tethers.updateTargets(r.p, intentOf('left', aimAt(HAND, 0, 3, -9)));
  ok(r.tethers.hands.left.target === null, 'nothing is in the way that close: open space has no target');
  const r2 = rig(DATA, { freeAttach: true });
  r2.p.y = 0.2; // body almost on the floor
  r2.tethers.updateTargets(r2.p, intentOf('left', { ox: 0, oy: 0.3, oz: 0, dx: 0, dy: -1, dz: 0 }));
  ok(r2.tethers.hands.left.target === null, `a surface nearer than ${CONFIG.targeting.surfaceMinDist} m to the body is not a target`);
  const r3 = rig(DATA, { freeAttach: true });
  r3.tethers.updateTargets(r3.p, intentOf('left', aimAt(HAND, 0, 0, -3)));
  const fl = r3.tethers.hands.left.target;
  ok(fl && fl.free && near(fl.y, OFF, 1e-9), 'the floor ahead of the player is a target (floors are attachable)');
}

{
  // a crumbling ledge is a frayed hold, and the line comes off when it falls
  const r = rig(DATA, { freeAttach: true });
  const aim = aimAt({ x: -5, y: 1.6, z: 0 }, -8, 5, 0); // up at the crumbling slab's side
  r.p.x = -5;
  r.tethers.updateTargets(r.p, intentOf('left', { ox: -5, oy: 1.6, oz: 0, dx: aim.dx, dy: aim.dy, dz: aim.dz }));
  const t = r.tethers.hands.left.target;
  ok(t && t.kind === 'fragile' && t.solid.id === 'crumb', 'a crumbling ledge is a frayed (fragile) hold');
  r.tethers.fire(r.p, 'left', { ox: -5, oy: 1.6, oz: 0, dx: aim.dx, dy: aim.dy, dz: aim.dz });
  for (let i = 0; i < 60 && r.tethers.hands.left.state !== 'attached'; i++) frame(r, {});
  const st = r.tethers.hands.left;
  ok(st.state === 'attached' && st.rope.anchor.free, 'the hook bites the crumbling ledge');
  const slab = r.level.solids.find((s) => s.id === 'crumb');
  slab.active = false;
  slab.fallen = true;
  frame(r, {});
  ok(st.state === 'idle' && r.ev.some((e) => e[0] === 'grapple:break' && e[1].anchor.free), 'when the ledge falls the line comes off it (grapple:break)');
  const r2 = rig(DATA, { freeAttach: true });
  r2.p.x = -5;
  const sl = r2.level.solids.find((s) => s.id === 'crumb');
  r2.tethers.fire(r2.p, 'left', { ox: -5, oy: 1.6, oz: 0, dx: aim.dx, dy: aim.dy, dz: aim.dz });
  sl.active = false; // gone while the hook is in the air
  for (let i = 0; i < 60; i++) frame(r2, {});
  ok(r2.tethers.hands.left.state === 'idle' && r2.ev.some((e) => e[0] === 'grapple:miss' && e[1].fell), 'a ledge that falls while the hook is in flight is a miss');
}

{
  // a swing on a ceiling hold
  const r = rig(DATA, { freeAttach: true });
  r.p.x = 3;
  r.p.y = 3;
  r.p.z = 0;
  const o = { x: 3, y: 4.6, z: 0 };
  const aim = aimAt(o, 1, 10, 0);
  r.tethers.fire(r.p, 'left', aim);
  for (let i = 0; i < 40 && r.tethers.hands.left.state !== 'attached'; i++) frame(r, {});
  const st = r.tethers.hands.left;
  ok(st.state === 'attached', 'a hook shot at a ceiling attaches');
  let worst = 0;
  let finite = true;
  for (let i = 0; i < 240 * 3; i++) {
    r.physics.step(r.p, r.tethers, {}, DT);
    finite = finite && Number.isFinite(r.p.x + r.p.y + r.p.z + r.p.vx + r.p.vy + r.p.vz);
    worst = Math.max(worst, dist(r.p, st.rope.anchor) - st.rope.length);
  }
  ok(finite && worst < 0.6, `a 3 s swing from a surface hold stays finite and on its rope (worst stretch ${worst.toFixed(2)} m)`);
}

{
  // the Dresser saws rings only
  const r = rig(DATA, { freeAttach: true });
  r.tethers.updateTargets(r.p, intentOf('left', aimAt(HAND, 0, 3, -20)));
  const s = r.tethers.hands.left.target;
  const ring = r.level.anchors[0];
  ok(cuttable(ring) === true && cuttable(s) === false, 'the Dresser may cut a ring but never a free-attach surface hold');
}

{
  // determinism: the same aims give the same bites
  const run = () => {
    const r = rig(DATA, { freeAttach: true });
    const trace = [];
    for (let i = 0; i < 30; i++) {
      const aim = aimAt(HAND, -10 + i * 0.7, 1 + (i % 7), -20);
      r.tethers.updateTargets(r.p, intentOf('left', aim));
      const t = r.tethers.hands.left.target;
      trace.push(t ? [t.x, t.y, t.z, t.kind] : null);
    }
    return JSON.stringify(trace);
  };
  ok(run() === run(), 'targeting is deterministic');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL FREE ATTACH CHECKS PASS');
process.exit(fails ? 1 : 0);
