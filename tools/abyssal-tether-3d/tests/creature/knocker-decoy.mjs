// THE KNOCKER x THE MASON (Node): the thrown clockwork decoy (sim/knocker3d.js) against the REAL Creature3D (its distract() rule from the
// sight work, plans/MASON_SIGHT.md), no stub: the two were built apart against one signature, this checks they meet.
//   the knocker throws, lands, winds up and clacks; its calls reach the creature (creature:distracted once, then refreshed once a second with
//   what is left of the 9 s); the decoy sits where the knocker lies; the Mason turns and crawls toward it; the decoy ends when the knocker is
//   done; a knocker thrown from nowhere near the Mason is out of its hearing and is refused without breaking the knocker.
//   node knocker-decoy.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D } = await import(srcUrl('sim/creature3d.js'));
const { Knocker3D, KNOCKER } = await import(srcUrl('sim/knocker3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// the player on a stub-shaft ledge in s6 (as tests/creature/sight.mjs): the Mason hunts from above
const LEDGE = { x: -14.4, y: -343.1, z: -4 };
// the far ledge across the shaft (top y -330, x -12.5..-1.5, z 12.8..16): the knocker is thrown from just above it
const KNOCK = { x: -7, y: -329.9, z: 14.4 };

function world(key, seed) {
  const L = new Level3D(makeShaftData(), key);
  const bus = new EventBus();
  const ev = [];
  for (const e of ['creature:distracted', 'creature:decoy:end', 'knocker:throw', 'knocker:land', 'knocker:clack', 'knocker:end', 'knocker:refuse']) bus.on(e, (p) => ev.push({ t: w.t, type: e, p }));
  const c = new Creature3D(L, DIFFICULTY[key], bus, { seed });
  const p = Object.assign({ x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true });
  c.reset(p);
  const k = new Knocker3D(bus);
  const w = { L, bus, c, p, k, ev, t: 0 };
  w.step = (n, each) => {
    for (let i = 0; i < n; i++) {
      w.t += DT;
      if (each && each(w) === false) return false;
      k.update(DT, L, c);
      c.update(DT, p, w.t);
    }
    return true;
  };
  w.first = (type) => ev.find((e) => e.type === type);
  w.all = (type) => ev.filter((e) => e.type === type);
  return w;
}

// ---- 1. the whole cycle against the real Mason -----------------------------------------------------------------------------------
{
  const w = world('normal', 4);
  w.step(60 * 4); // the Mason is out and hunting
  const startD = len3(KNOCK.x - w.c.x, KNOCK.y - w.c.y, KNOCK.z - w.c.z);
  const ctx = { dead: false, busy: false };
  const thrown = w.k.tryThrow(null, ctx, KNOCK.x, KNOCK.y + 0.8, KNOCK.z, 0, 1.5, 0.4);
  ok(thrown === true, 'the knocker throws (no bag: a test throw)');
  let tFirstDistract = -1;
  let minD = startD;
  let liveFrames = 0;
  w.step(60 * 16, (x) => {
    if (x.c.decoy && x.c.decoy.live) {
      liveFrames++;
      if (tFirstDistract < 0) tFirstDistract = x.t;
      minD = Math.min(minD, len3(KNOCK.x - x.c.x, KNOCK.y - x.c.y, KNOCK.z - x.c.z));
    }
    if (x.c.caughtPlayer) return false;
  });
  const land = w.first('knocker:land');
  const end = w.first('knocker:end');
  ok(!!land && !!end && end.p.reason === 'done', 'it lands, clacks and ends (done)');
  const lx = land ? land.p.x : 0;
  const ly = land ? land.p.y : 0;
  const lz = land ? land.p.z : 0;
  ok(len3(lx - KNOCK.x, ly - KNOCK.y, lz - KNOCK.z) < 3, `it lies on the far ledge (${lx.toFixed(1)}, ${ly.toFixed(1)}, ${lz.toFixed(1)})`);
  ok(w.all('creature:distracted').length === 1, 'the Mason accepted it: one creature:distracted (the repeat calls only refresh the point)');
  const d1 = w.first('creature:distracted');
  ok(!!d1 && d1.p.duration > 7 && d1.p.duration <= KNOCKER.duration + 1e-6, `the first call carries the whole clack (${d1 ? d1.p.duration.toFixed(1) : '-'} s)`);
  ok(w.k.stats.distracts >= 8 && w.k.stats.distracts <= 10, `the knocker called distract about once a second (${w.k.stats.distracts} calls)`);
  ok(tFirstDistract > 0 && tFirstDistract - land.t < 1.0, `the decoy is live right after the landing (${(tFirstDistract - land.t).toFixed(2)} s)`);
  ok(minD < startD - 2, `the Mason came toward it (${startD.toFixed(1)} m -> ${minD.toFixed(1)} m)`);
  const de = w.first('creature:decoy:end');
  ok(!!de && ['timeout', 'inspected', 'overridden'].includes(de.p.reason), `the decoy ends with a reason (${de ? de.p.reason : 'none'}) once the knocking is over`);
  ok(liveFrames > 60 * 3, `it held its attention for a few seconds (${(liveFrames * DT).toFixed(1)} s)`);
}

// ---- 2. out of the Mason's hearing: the knocker is not hurt by the refusal -------------------------------------------------------
{
  const w = world('normal', 4);
  w.step(60 * 4);
  const ctx = { dead: false, busy: false };
  const far = { x: w.c.x, y: w.c.y - 200, z: w.c.z }; // far below the Mason: out of its hearing reach and (no solid) falls away
  const thrown = w.k.tryThrow(null, ctx, far.x, far.y, far.z, 0, 0, 0);
  ok(thrown === true, 'a throw is allowed anywhere');
  w.step(60 * 14);
  ok(w.all('creature:distracted').length === 0 && !(w.c.decoy && w.c.decoy.live), 'out of its hearing: the Mason is not distracted');
  ok(!!w.first('knocker:end'), 'and the knocker still ends cleanly (lost or done), no throw');
}

// ---- 3. determinism ---------------------------------------------------------------------------------------------------------------
{
  const run = () => {
    const w = world('nightmare', 9);
    w.step(60 * 4);
    w.k.tryThrow(null, { dead: false, busy: false }, KNOCK.x, KNOCK.y + 0.8, KNOCK.z, 0, 1.5, 0.4);
    w.step(60 * 14);
    return w.ev.map((e) => e.type + e.t.toFixed(2)).join(',') + `|${w.c.x.toFixed(5)},${w.c.y.toFixed(5)},${w.c.z.toFixed(5)}`;
  };
  ok(run() === run(), 'deterministic with a seed (throw, clack, decoy, crawl)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL KNOCKER x MASON CHECKS PASS');
process.exit(fails ? 1 : 0);
