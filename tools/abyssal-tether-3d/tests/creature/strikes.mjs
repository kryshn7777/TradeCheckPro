// MASON_STRIKES.md (Node): the Mason's survivable, dodgeable strikes with the REAL Creature3D on the stub shaft, seeded, 60 Hz.
//   the snake: stalk -> dash -> rise -> lock -> strike -> recoil -> stare, creature:phase events, attackPhase / attackT01 / aim
//   cadence: rise to rise always in [3, 5] s (and in the difficulty's band) over many seeds; never two rises < 3 s apart
//   lock: the strike point is where the player stood at the lock; moving after the lock does not move it
//   stand still = hit; moving off at walk speed (4.4 m/s) at the lock = miss; a swing / drop off the ledge = miss
//   a hit: creature:strike hit:true once, caughtPlayer once, never a kill at full hp (PlayerHits + Health3D): 4 hits from full kill
//   (the devour cause), hits >= 5 s apart (no chained hit), 12-20 s from the first hit to the death for a frozen player
//   rests (refuge 1) fully safe; the lure niche (refuge 2) takes every blow on its block; grace / immunity: no hit; determinism
//   node strikes.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus, STRIKE_DAMAGE } = await import(srcUrl('sim/config3d.js'));
const { Creature3D } = await import(srcUrl('sim/creature3d.js'));
const { STRIKE_TUNE, STRIKE_COMMON, cadenceInterval, segDist } = await import(srcUrl('sim/strikeZone.js'));
const { PlayerHits } = await import(srcUrl('sim/playerHits.js'));
const { Health3D } = await import(srcUrl('sim/health3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const KEYS = ['normal', 'nightmare', 'abyss'];
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
// the player stands on a stub-shaft ledge in s6 (hunt, lethal): top y -344, x -16..-12.8, z -7.5..-0.5 (against the -X wall)
const LEDGE = { x: -14.4, y: -343.62, z: -4 };
const EVENTS = ['creature:attack', 'creature:strike', 'creature:phase', 'creature:sight', 'player:hit', 'player:death', 'health:damage'];

function mk(key, seed, opts = {}) {
  const L = new Level3D(makeShaftData(), key);
  const bus = new EventBus();
  const w = { L, bus, t: 0, ev: [], hits: 0 };
  for (const e of EVENTS) bus.on(e, (p) => w.ev.push({ t: w.t, type: e, p }));
  w.c = new Creature3D(L, DIFFICULTY[key], bus, { seed });
  w.p = { x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true, climbing: false, radius: 0.38 };
  w.c.reset(w.p);
  w.c.sense._first = false; // the section's first notice (a warning) already happened
  w.c.sense._sec = w.c.sectionIndex;
  if (opts.health) {
    w.H = new PlayerHits(bus);
    w.health = new Health3D(DIFFICULTY[key], bus);
    w.ctx = { health: w.health, level: L, gripping: false, god: false, kill: (cause) => {
      w.p.alive = false;
      w.health.die();
      w.dead = { t: w.t, cause };
      bus.emit('player:death', { cause });
    } };
  }
  w.step = (n, each) => {
    for (let i = 0; i < n; i++) {
      w.t += DT;
      if (each && each(w) === false) return false;
      if (w.H) {
        w.H.update(DT, w.p, L);
        w.c.immune = w.H.immune;
        w.health.noRecovery = !!(w.c.sight && w.c.sight.near); // as game.js: no healing while it chases you near
        w.health.step(DT);
      }
      w.c.update(DT, w.p, w.t);
      if (w.c.caughtPlayer) {
        w.c.caughtPlayer = false;
        w.hits++;
        if (w.H && w.p.alive) w.H.mason(w.c.strikeSrc, w.p, w.ctx);
      }
    }
    return true;
  };
  w.all = (type, pred) => w.ev.filter((e) => e.type === type && (!pred || pred(e.p)));
  return w;
}

// ---- 1. the numbers ------------------------------------------------------------------------------------------------------------
{
  ok(STRIKE_DAMAGE.mason === 0.3 && STRIKE_DAMAGE.skitter === 0.1, 'damage: a Mason strike 0.30, a skitterling bite 0.10 (config3d STRIKE_DAMAGE)');
  let inBand = true;
  for (const k of KEYS) {
    const r = STRIKE_TUNE[k];
    if (!(r.cadence[0] >= 3 && r.cadence[1] <= 5 && r.cadence[0] <= r.cadence[1])) inBand = false;
    for (let i = 0; i < 1000; i++) {
      const v = cadenceInterval(r, i / 1000);
      if (v < 3 || v > 5) inBand = false;
    }
  }
  ok(inBand, `cadence bands inside [3, 5]: ${KEYS.map((k) => STRIKE_TUNE[k].cadence.join('-')).join(' / ')} s`);
  // the dodge math: moving at the lock at walk speed with a gun out leaves the radius by the impact
  const dodge = KEYS.map((k) => (STRIKE_TUNE[k].lock + STRIKE_TUNE[k].strike) * 4.4 - STRIKE_TUNE[k].radius);
  ok(dodge.every((m) => m > 0.1), `a dodge on foot is always possible: (lock + strike) x 4.4 m/s - radius = ${dodge.map(f2).join(' / ')} m of margin`);
  ok(segDist(0, 1, 0, -1, 0, 0, 1, 0, 0) === 1 && segDist(3, 0, 0, -1, 0, 0, 1, 0, 0) === 2, 'segDist: to the segment and past its end');
}

// ---- 2. the snake: phases and a frozen player ------------------------------------------------------------------------------------
{
  let good = true;
  let line = [];
  for (const k of KEYS) {
    const w = mk(k, 3, { health: true });
    w.step(60 * 40, (x) => !x.dead);
    const ph = w.all('creature:phase').map((e) => e.p.phase);
    const seq = ph.join(' ');
    const order = /rise lock strike recoil stare/.test(seq);
    const dash = ph.includes('dash');
    const hits = w.all('creature:strike', (p) => p.hit);
    const deadT = w.dead ? w.dead.t : NaN;
    const firstHit = hits.length ? hits[0].t : NaN;
    const gaps = hits.slice(1).map((e, i) => e.t - hits[i].t);
    const hpAfter = w.all('player:hit').map((e) => e.p.hp);
    const k4 = hits.length === 4 && w.dead && w.dead.cause === 'creature' && Math.abs(hpAfter[0] - 0.7) < 1e-9 && Math.abs(hpAfter[2] - 0.1) < 1e-6 && hpAfter[3] === 0;
    const span = deadT - firstHit;
    if (process.env.DEBUG) console.log(k, order, dash, k4, hpAfter, w.dead, gaps, span, w.all('player:hit', (p) => p.down).length, seq.slice(0, 200));
    const okk = order && dash && k4 && gaps.every((g) => g >= STRIKE_COMMON.afterHit) && span >= 12 && span <= 20 && w.all('player:hit', (p) => p.down).length === 3;
    if (!okk) good = false;
    line.push(`${k}: ${hits.length} hits at ${hits.map((e) => f2(e.t)).join(', ')} s, dead ${f2(span)} s after the first`);
  }
  ok(good, `a frozen player in reach: dash -> rise -> lock -> strike -> recoil -> stare; 0.70 / 0.40 / 0.10 / dead (devour cause), 3 knockdowns, hits >= 5 s apart, 12-20 s from the first hit to the death (${line.join('; ')})`);
}

// ---- 3. cadence: rise to rise in [lo, hi] over many seeds (an immune player: every strike misses, the cadence alone paces it) ------
{
  let good = true;
  let n = 0;
  let mn = 9;
  let mx = 0;
  for (const k of KEYS) {
    const [lo, hi] = STRIKE_TUNE[k].cadence;
    for (let seed = 1; seed <= 12; seed++) {
      const w = mk(k, seed);
      w.step(60 * 60, (x) => {
        x.c.immune = true;
      });
      const rises = w.all('creature:attack').map((e) => e.t);
      if (rises.length < 8) good = false;
      for (let i = 1; i < rises.length; i++) {
        const g = rises[i] - rises[i - 1];
        n++;
        mn = Math.min(mn, g);
        mx = Math.max(mx, g);
        if (g < lo - DT - 1e-6 || g > hi + DT + 1e-6) good = false;
      }
      if (w.hits) good = false;
    }
  }
  ok(good && mn >= 3 - DT && mx <= 5 + DT, `cadence: ${n} rise-to-rise intervals, ${f2(mn)} .. ${f2(mx)} s, each inside its difficulty's band and [3, 5]; an immune player is never hit`);
  // the draws differ (a uniform spread, not a constant)
  const w = mk('normal', 7);
  w.step(60 * 60, (x) => {
    x.c.immune = true;
  });
  const iv = w.all('creature:attack').map((e) => e.p.interval);
  ok(new Set(iv.map((v) => v.toFixed(3))).size >= iv.length - 1 && iv.every((v) => v >= 3.6 && v <= 5), `the intervals are drawn (seeded): ${iv.slice(0, 6).map(f2).join(', ')} ...`);
}

// ---- 4. the lock, a dodge, a swing --------------------------------------------------------------------------------------------
{
  let lockOk = true;
  let dodgeOk = true;
  let swingOk = true;
  let lines = [];
  for (const k of KEYS) {
    // stand still until the lock, then walk off along +Z at 4.4 m/s (a gun out) then back next time (the ledge runs along Z)
    const w = mk(k, 5);
    let dir = 1;
    let moving = false;
    let lockP = null;
    w.step(60 * 50, (x) => {
      const c = x.c;
      if (c.attackPhase === 'lock' && !moving) {
        moving = true;
        dir = x.p.z < -4 ? 1 : -1;
        lockP = { x: x.p.x, y: x.p.y, z: x.p.z, px: c.attack.px, py: c.attack.py, pz: c.attack.pz };
        if (Math.abs(lockP.px - lockP.x) > 1e-9 || Math.abs(lockP.pz - lockP.z) > 1e-9) lockOk = false; // locked where he stood (no lead)
      }
      if (moving) {
        x.p.vz = 4.4 * dir;
        x.p.z += x.p.vz * DT;
        if (c.attackPhase === 'strike' && (Math.abs(c.attack.pz - lockP.pz) > 1e-9 || Math.abs(c.attack.px - lockP.px) > 1e-9)) lockOk = false;
        if (c.attackPhase === 'recoil' || c.attackPhase === 'stare') {
          moving = false;
          x.p.vz = 0;
        }
      }
    });
    const st = w.all('creature:strike');
    if (!st.length || st.some((e) => e.p.hit) || w.hits) dodgeOk = false;
    lines.push(`${k}: ${st.length} strikes all missed by ${st.map((e) => f2(e.p.zone)).join('/')} m`);
    // a swing / drop: at the lock the player leaves the ledge outward and down (a rope swing out over the shaft)
    const s = mk(k, 9);
    let sw = false;
    let t0 = 0;
    let base = null;
    s.step(60 * 30, (x) => {
      if (x.c.attackPhase === 'lock' && !sw && !base) {
        sw = true;
        t0 = x.t;
        base = { x: x.p.x, y: x.p.y };
      }
      if (sw) {
        const u = x.t - t0;
        x.p.x = base.x + 6 * Math.sin(Math.min(u, 0.6) * 2.4);
        x.p.y = base.y - 1.5 * Math.min(u, 0.6);
        if (u > 1.2) return false;
      }
    });
    const ss = s.all('creature:strike');
    if (!ss.length || ss[0].p.hit) swingOk = false;
  }
  ok(lockOk, 'the lock: the strike point is where the player stood at the lock and does not follow him afterwards');
  ok(dodgeOk, `walking off at 4.4 m/s from the lock: every strike misses (${lines.join('; ')})`);
  ok(swingOk, 'a swing out over the shaft at the lock: a miss');
}

// ---- 5. one hit = one strike event, never a kill at full hp -------------------------------------------------------------------
{
  const w = mk('normal', 4, { health: true });
  w.step(60 * 15, (x) => x.hits < 1 || x.t < 0);
  const hitEv = w.all('creature:strike', (p) => p.hit);
  ok(hitEv.length === 1 && w.hits === 1 && w.p.alive && Math.abs(w.health.hp - 0.7) < 1e-9 && w.H.knock.active, `the first hit: one creature:strike hit:true, caughtPlayer once, hp 0.70, alive, knocked down (${f2(hitEv[0] ? hitEv[0].t : -1)} s)`);
  const pre = w.all('player:hit')[0];
  if (process.env.DEBUG) console.log(pre && pre.p);
  ok(pre && pre.p.source === 'mason' && pre.p.down === true && Math.abs(Math.hypot(pre.p.dx, pre.p.dz) - 1) < 1e-6, 'player:hit {source mason, down, a unit direction}');
  const dmg = w.all('health:damage');
  ok(dmg.length === 1 && dmg[0].p.cause === 'creature' && Math.abs(dmg[0].p.amount - 0.3) < 1e-9, "health:damage {cause 'creature', amount 0.30} before it");
  // while down + the margin it holds the coil: no rise for afterHit s
  const tHit = hitEv[0].t;
  w.step(60 * 8);
  const nextRise = w.all('creature:attack').find((e) => e.t > tHit);
  ok(nextRise && nextRise.t - tHit >= STRIKE_COMMON.afterHit - DT, `after a hit it stares and holds: the next rise ${f2(nextRise ? nextRise.t - tHit : -1)} s after the impact (>= 5.0 = the knockdown 3.5 + 1.5)`);
  ok(w.all('creature:phase', (p) => p.phase === 'stare').some((e) => e.t > tHit && e.t < tHit + 1), 'it holds the coil and stares while the player is down');
}

// ---- 6. safety levers: rests, the lure niche, grace, immunity -------------------------------------------------------------------
{
  // a Masons' rest: no hit, no strike lands, for 60 s
  const w = mk('normal', 2);
  w.c.setRefuge(1, { minX: -16, maxX: -12.8, minY: -344, maxY: -340, minZ: -7.5, maxZ: -0.5 });
  w.step(60 * 60, (x) => x.c.setRefuge(1, { minX: -16, maxX: -12.8, minY: -344, maxY: -340, minZ: -7.5, maxZ: -0.5 }));
  ok(w.hits === 0 && w.all('creature:strike', (p) => p.hit).length === 0 && w.all('creature:attack').length === 0, 'hidden in a rest (refuge 1): 60 s, no attack starts, no hit');
  // the lure niche: it strikes, the block takes it
  const v = mk('normal', 2);
  const B = { minX: -12.6, maxX: -11.6, minY: -345, maxY: -339, minZ: -7.5, maxZ: -0.5 };
  v.step(60 * 40, (x) => x.c.setRefuge(2, B));
  const vs = v.all('creature:strike');
  ok(v.hits === 0 && vs.length >= 3 && vs.every((e) => !e.p.hit), `the lure niche (refuge 2): ${vs.length} strikes, none hits (stops: ${[...new Set(vs.map((e) => e.p.stop || "''"))].join(', ')})`);
  // grace
  const g = mk('nightmare', 6);
  g.step(60 * 30, (x) => {
    x.c.grace = 1;
  });
  ok(g.hits === 0 && g.all('creature:strike', (p) => p.hit).length === 0, `in grace: no hit (${g.all('creature:attack').length} attacks started)`);
  // immunity (set by the game from PlayerHits)
  const im = mk('abyss', 6);
  im.step(60 * 30, (x) => {
    x.c.immune = true;
  });
  ok(im.hits === 0 && im.all('creature:strike').length > 3, 'immune: strikes come, none hits');
}

// ---- 7. determinism -------------------------------------------------------------------------------------------------------------
{
  const run = () => {
    const w = mk('nightmare', 11, { health: true });
    w.step(60 * 45, (x) => !x.dead);
    return w.ev.filter((e) => e.type !== 'health:damage').map((e) => `${e.type}@${e.t.toFixed(4)}`).join(',') + `|${w.c.x.toFixed(6)},${w.c.y.toFixed(6)}`;
  };
  ok(run() === run(), 'deterministic with a seed (event stream + final position)');
}

// ---- 8. the dash: seen from afar it surges in, capped, harmless -----------------------------------------------------------------
{
  let good = true;
  let lines = [];
  for (const k of KEYS) {
    const w = mk(k, 1);
    let maxSp = 0;
    let dashT = 0;
    let dashStart = -1;
    w.step(60 * 20, (x) => {
      if (x.c.attackPhase === 'dash') {
        if (dashStart < 0) dashStart = x.t;
        dashT += DT;
        maxSp = Math.max(maxSp, x.c.speed);
      }
      return x.c.attackPhase !== 'rise';
    });
    const ds = w.all('creature:phase', (p) => p.phase === 'dash');
    const pursue = w.c.k.pursue;
    const okk = ds.length >= 1 && dashT <= STRIKE_COMMON.dashMax + 0.05 && maxSp > pursue * 1.6 && w.hits === 0;
    if (!okk) good = false;
    lines.push(`${k}: dash ${f2(dashT)} s, top ${f2(maxSp)} m/s vs pursue ${f2(pursue)}`);
  }
  ok(good, `the dash: a surge well above the pursuit speed, at most 2.5 s, no damage of its own (${lines.join('; ')})`);
}

console.log(fails ? `${fails} FAILED` : 'ALL STRIKE CHECKS PASS');
process.exitCode = fails ? 1 : 0;
