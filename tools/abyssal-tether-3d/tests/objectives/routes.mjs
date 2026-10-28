// LEVEL_FUN_PLAN P2 "reach and routes" on the real level (Node):
//   reach   sections[i].reach -> Level3D.reachOf / TetherSystem.aimRangeAt (per difficulty, Sandbox = Normal, a bare number
//           scales with the difficulty, never above aimRange), read by findTarget / the rope:shot range / the miss length,
//           while maxRopeLength stays diff-wide; a mini level checks the targeting edge on both sides of a section border.
//   forks   the fork probe: the level data's `routes` pass forkIntegrity on every variant, and the bots play BOTH lines of every
//           fork on every variant: both completable (no death, landings < 0.85 lethal), the fast one faster by its
//           `fasterBy`, every shot within the section's reach minus 1.5 m.
//   lore    the safe-line plaques: <= 12 words each, <= 7 and <= 70 words in all, each by a 'slow' supply spot.
//   node routes.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';

const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Sim } = await import('../../verify/sim.mjs');
const { Bot } = await import('../../verify/bot.mjs');
const { forkIntegrity } = await import('../../verify/forks.mjs');
const R = await import('../../verify/routes.mjs');

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const VARIANTS = ['normal', 'nightmare', 'abyss'];
const LAND_OK = 0.85;

// ---- reach on the real level --------------------------------------------------------------------------------------------
{
  const want = { s4: [30, 28, 26], s5: [29, 27, 25], s6: [28, 27, 25], s7: [26, 25, 24], s8: [26, 25, 24] };
  let good = true;
  const rows = [];
  for (const [k, v] of VARIANTS.entries()) {
    const L = new Level3D(undefined, v);
    const T = new TetherSystem(L, DIFFICULTY[v], new EventBus(), {});
    const got = L.sections.map((s) => T.aimRangeAt(s.index));
    rows.push(`${v} ${got.join('/')}`);
    for (const s of L.sections) {
      const exp = want[s.id] ? want[s.id][k] : DIFFICULTY[v].aimRange;
      if (got[s.index] !== exp) good = false;
      // the section of a body at its checkpoint
      if (T.aimRangeAt({ y: s.checkpoint.y }) !== exp) good = false;
    }
    if (T.maxRopeLength() !== DIFFICULTY[v].aimRange + CONFIG.rope.maxLengthBonus) good = false;
  }
  ok(good, `per-section reach S1..S8 (${rows.join(' | ')}); the rope's maximum length stays aimRange + ${CONFIG.rope.maxLengthBonus}`);
  const L = new Level3D(undefined, 'normal');
  const sand = new TetherSystem(L, DIFFICULTY.sandbox, new EventBus(), {});
  ok(L.sections.every((s) => sand.aimRangeAt(s.index) === new TetherSystem(L, DIFFICULTY.normal, new EventBus(), {}).aimRangeAt(s.index)), 'Sandbox uses the Normal reach');
  // the cache follows the body across section borders (and a NaN height falls back to the top section)
  const T = new TetherSystem(L, DIFFICULTY.normal, new EventBus(), {});
  const seq = [-100, -160, -100, -300, -500, 5, NaN].map((y) => T.aimRangeAt({ y }));
  ok(seq.join() === '30,29,30,26,26,32,32', `aimRangeAt follows the body between sections (${seq.join(', ')})`);
}

// ---- reach on a mini level: findTarget, rope:shot, the miss ---------------------------------------------------------------
{
  const data = {
    sections: [
      { id: 'a', yTop: 50, yBottom: 0, checkpoint: { x: 0, y: 10, z: 0 } },
      { id: 'b', yTop: 0, yBottom: -100, checkpoint: { x: 0, y: -10, z: 0 }, reach: 20 },
    ],
    solids: [],
    anchors: [
      { id: 'hi', x: 0, y: 10, z: -19 },
      { id: 'lo', x: 0, y: -50, z: -19 },
      { id: 'lo2', x: 0, y: -50, z: -16 },
    ],
  };
  const out = [];
  for (const v of VARIANTS) {
    const L = new Level3D(data, v);
    const bus = new EventBus();
    const T = new TetherSystem(L, DIFFICULTY[v], bus, {});
    const r = L.reachOf(1, DIFFICULTY[v]);
    const want = Math.round(((20 * DIFFICULTY[v].aimRange) / 32) * 2) / 2;
    const p = new Player3D(0, 10, 0);
    const aim = (a) => ({ ox: p.x, oy: p.y, oz: p.z, dx: a.x - p.x, dy: a.y - p.y, dz: a.z - p.z });
    const hit = (a) => {
      const f = T.findTarget(p, aim(a), 'right');
      return !!f && f.anchor === a;
    };
    const hiOk = hit(L.byId.hi); // 19 m in section a (full reach)
    p.y = -50;
    p.x = 3; // off the line through both low rings: each is aimed at alone
    const loFar = hit(L.byId.lo); // ~19.2 m in section b (reach 20 / 18 / 17)
    p.x = -3;
    const loNear = hit(L.byId.lo2); // ~16.3 m
    const shots = [];
    bus.on('rope:shot', (e) => shots.push(e.range));
    T.fire(p, 'left', { ox: p.x, oy: p.y, oz: p.z, dx: 1, dy: 0, dz: 0 }); // nothing there: a miss
    const miss = T.hands.left.miss;
    out.push(`${v} ${r}`);
    ok(r === want && hiOk && loFar === r >= 19.3 && loNear && shots[0] === r && miss && Math.abs(miss.len - r * 0.85) < 1e-9, `${v}: a bare reach scales with the difficulty (${r} m); findTarget, the shot range and the miss length use the section's reach`);
  }
}

// ---- the fork probe: both lines of every fork on every variant -------------------------------------------------------------
{
  const table = [];
  for (const v of VARIANTS) {
    const L = new Level3D(undefined, v);
    const problems = [];
    const fi = forkIntegrity(L, R, (m) => problems.push(m));
    ok(problems.length === 0 && fi.forks === 7, `${v}: level data forks (${fi.forks} forks, ${fi.slowSpots} safe-line supply spots): ${problems.slice(0, 3).join('; ') || 'consistent with the bot lines'}`);
    for (const F of R.FORKS) {
      const res = {};
      for (const line of ['fast', 'safe']) {
        const key = F[line];
        const lvl = new Level3D(undefined, v);
        const cp = lvl.sections[R.ROUTE_START[key]].checkpoint;
        const sim = new Sim(lvl, v);
        sim.spawn(cp.x, cp.y, cp.z);
        const r = new Bot(sim, R.ROUTES[key], {}).runRoute();
        const T = sim.tethers;
        const over = sim.shots.filter(([si, , d]) => d > T.aimRangeAt(si) - 1.5);
        // the time spent moving (LEVEL_FUN_PLAN P5: S7's survive floor ends both lines on the same clock: its wait is left out)
        res[line] = { ok: r.ok && r.deaths === 0 && r.maxLand < LAND_OK && over.length === 0, t: r.time - (r.waited || 0), fail: r.fail || (over.length ? `shot ${over[0][1]} at ${over[0][2].toFixed(1)} m` : '') };
      }
      const faster = 1 - res.fast.t / res.safe.t;
      table.push(`${v}/${F.key} ${res.fast.t.toFixed(1)}/${res.safe.t.toFixed(1)}s ${(faster * 100).toFixed(0)}%`);
      ok(res.fast.ok && res.safe.ok && faster >= F.fasterBy, `${v} fork ${F.key}: fast ${F.fast} ${res.fast.t.toFixed(1)} s vs safe ${F.safe} ${res.safe.t.toFixed(1)} s (${(faster * 100).toFixed(0)} % faster, want >= ${F.fasterBy * 100} %) ${res.fast.fail || ''} ${res.safe.fail || ''}`);
    }
  }
  console.log(`      ${table.join(' | ')}`);
}

// ---- lore on the safe lines ---------------------------------------------------------------------------------------------------
{
  const L = new Level3D(undefined, 'normal');
  const lore = L.decor.filter((d) => d.type === 'plaque' && d.lore);
  const words = lore.map((d) => d.text.split(/\s+/).filter((w) => /[A-Z0-9]/i.test(w)).length);
  const slow = (L.data.supplies || []).filter((s) => s.tier === 'slow');
  const byCache = lore.every((d) => slow.some((s) => Math.hypot(s.x - d.x, s.y - d.y, s.z - d.z) < 8));
  ok(lore.length >= 1 && lore.length <= 7 && words.every((n) => n <= 12) && words.reduce((a, b) => a + b, 0) <= 70 && byCache, `lore plaques: ${lore.length} (<= 7), ${words.join('/')} words (<= 12 each, ${words.reduce((a, b) => a + b, 0)} <= 70), each within 8 m of a safe-line supply spot`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
