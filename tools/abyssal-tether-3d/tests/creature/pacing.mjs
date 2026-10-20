// Human-pacing pursuit sim for Creature3D on the stub 3D shaft.
// Scripted, kinematic "human-pattern" players descend the 560 m shaft in moves
// (tether swings / drops / ledge walks) separated by pauses (reading the route,
// looking around in VR), sometimes swaying on a rope instead of standing still,
// react (or not) to lunges, die and respawn at checkpoints like the game does.
//   node pacing.mjs [runs=150] [--root DIR]
// Env: LEVEL=real (the game's level instead of the stub shaft), ONLY=normal,abyss,
// PROF=expert,careful, TUNE='{"normal":{…}}' (DIFF_TUNE overrides), NOSTALL=1, CAUSES=1.
import { srcUrl, positional } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus, U } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, DIFF_TUNE } = await import(srcUrl('sim/creature3d.js'));
const { ThreatSystem3D } = await import(srcUrl('sim/threat3d.js'));
if (process.env.TUNE) { const o = JSON.parse(process.env.TUNE); for (const k in o) Object.assign(DIFF_TUNE[k], o[k]); }
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const RUNS = +(positional(process.argv.slice(2))[0] || 150);
const DT = 1 / 60;
const REAL = process.env.LEVEL === 'real';
const makeLevel = (variant) => (REAL ? new Level3D(undefined, variant) : new Level3D(makeShaftData(), variant));
let LETHAL_TOP = -230;
let FINISH_Y = -556;

export const PROFILES = {
  // pause range (s), long-look chance + range, sway chance, drop range (m), move speed (m/s), react prob, react delay, backtrack chance
  expert: { pause: [0.3, 1.8], longP: 0.02, long: [3, 5], sway: 0.1, drop: [10, 22], speed: [9, 13], react: 0.92, delay: [0.3, 0.45], back: 0 },
  careful: { pause: [1.5, 6], longP: 0.12, long: [7, 10], sway: 0.25, drop: [7, 16], speed: [6, 10], react: 0.75, delay: [0.4, 0.65], back: 0.03 },
  hesitant: { pause: [3, 8], longP: 0.2, long: [8, 12], sway: 0.35, drop: [5, 12], speed: [4.5, 8], react: 0.55, delay: [0.5, 0.9], back: 0.08 },
};

class Player {
  constructor(profile, rand, level) {
    this.P = profile;
    this.r = rand;
    this.level = level;
    this.alive = true;
    this.grounded = true;
    this.vx = this.vy = this.vz = 0;
    this.stallMode = null; // 'still' | 'sway' — never moves again once set
    this.stallAt = -Infinity;
  }
  rr(a, b) {
    return a + (b - a) * this.r();
  }
  place(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.alive = true;
    this._pause();
  }
  _pause(forceDur) {
    const P = this.P;
    let d = forceDur || (this.r() < P.longP ? this.rr(P.long[0], P.long[1]) : this.rr(P.pause[0], P.pause[1]));
    this.phase = this.r() < P.sway ? 'sway' : 'pause';
    this.t = 0;
    this.dur = d;
    this.cx = this.x;
    this.cy = this.y;
    this.cz = this.z;
    const a = this.r() * Math.PI * 2;
    this.sdx = Math.cos(a);
    this.sdz = Math.sin(a);
    this.samp = this.rr(0.8, 2.2);
    this.sw = this.rr(1.6, 2.4);
    this.grounded = this.phase === 'pause';
  }
  _move(dropMul = 1, away = null, fast = false) {
    const P = this.P;
    const back = !away && this.r() < P.back;
    const drop = this.rr(P.drop[0], P.drop[1]) * dropMul * (back ? -0.4 : 1);
    const ty = Math.max(FINISH_Y - 1, this.y - drop);
    const sh = (this.level.shaftAt && this.level.shaftAt(ty)) || { minX: -16, maxX: 16, minZ: -16, maxZ: 16 };
    const cx = (v) => U.clamp(v, sh.minX + 3.5, sh.maxX - 3.5);
    const cz = (v) => U.clamp(v, sh.minZ + 3.5, sh.maxZ - 3.5);
    let tx = cx(this.x + this.rr(-9, 9));
    let tz = cz(this.z + this.rr(-9, 9));
    if (away) {
      tx = cx(this.x + away.x * 8);
      tz = cz(this.z + away.z * 8);
    }
    this.phase = 'move';
    this.t = 0;
    this.p0 = [this.x, this.y, this.z];
    this.p1 = [tx, ty, tz];
    const len = Math.hypot(tx - this.x, ty - this.y, tz - this.z);
    const sp = fast ? P.speed[1] * 1.15 : this.rr(P.speed[0], P.speed[1]);
    this.dur = Math.max(0.6, len / sp);
    // swing arc: control point sags below the chord (pendulum)
    this.pc = [(this.x + tx) / 2, Math.min(this.y, ty) - len * 0.25, (this.z + tz) / 2];
    this.grounded = false;
  }
  /** Not inside any solid (the kinematic path ignores geometry; never stall inside masonry). */
  _clear() {
    const out = [];
    this.level.querySolids(this.x - 0.5, this.y - 0.5, this.z - 0.5, this.x + 0.5, this.y + 0.5, this.z + 0.5, out);
    for (const b of out) {
      if (this.x > b.minX - 0.4 && this.x < b.maxX + 0.4 && this.y > b.minY - 0.4 && this.y < b.maxY + 0.4 && this.z > b.minZ - 0.4 && this.z < b.maxZ + 0.4) return false;
    }
    return true;
  }
  _flee(creature) {
    this.reacting = false;
    this.fleeAfter = false;
    const dx = this.x - creature.x;
    const dz = this.z - creature.z;
    const l = Math.hypot(dx, dz) || 1;
    this._move(0.9, { x: dx / l, z: dz / l }, true);
  }
  update(dt, creature, time) {
    if (!this.alive) return;
    const ox = this.x;
    const oy = this.y;
    const oz = this.z;
    // Reaction to a telegraphed lunge / a surge at you: flee (after a human delay),
    // or freeze (some players do).
    const threatened =
      creature.distance < 24 &&
      ((creature.state === 'ATTACK' && creature.attack.phase === 'windup') || (creature.state === 'BURST' && creature.burstCommit));
    if (!threatened) this.decided = false;
    else if (!this.stallMode && !this.decided) {
      this.decided = true;
      this.froze = this.r() >= this.P.react;
      this.reacting = !this.froze;
      this.reactT = this.rr(this.P.delay[0], this.P.delay[1]);
    }
    if (this.reacting) {
      this.reactT -= dt;
      if (this.reactT <= 0 && this.phase !== 'move') this._flee(creature);
      else if (this.reactT <= 0) this.fleeAfter = true;
    }
    this.t += dt;
    if (this.phase === 'pause') {
      // still
    } else if (this.phase === 'sway') {
      const s = Math.sin(this.t * this.sw) * this.samp;
      this.x = this.cx + this.sdx * s;
      this.z = this.cz + this.sdz * s;
      this.y = this.cy - Math.abs(Math.cos(this.t * this.sw)) * 0.15 * this.samp;
    } else if (this.phase === 'move') {
      const k = Math.min(1, this.t / this.dur);
      const e = k * k * (3 - 2 * k);
      const a = (1 - e) * (1 - e);
      const b = 2 * (1 - e) * e;
      const c = e * e;
      this.x = a * this.p0[0] + b * this.pc[0] + c * this.p1[0];
      this.y = a * this.p0[1] + b * this.pc[1] + c * this.p1[1];
      this.z = a * this.p0[2] + b * this.pc[2] + c * this.p1[2];
      if (k >= 1) {
        this.x = this.p1[0];
        this.y = this.p1[1];
        this.z = this.p1[2];
        this.phase = 'done';
      }
    }
    if (this.phase === 'done' && this.fleeAfter && creature.distance < 24 && creature.state !== 'RECOVERING') {
      this._flee(creature);
    } else if (this.phase === 'done' || ((this.phase === 'pause' || this.phase === 'sway') && this.t >= this.dur && !this.stallMode)) {
      this.fleeAfter = false;
      if (this.stallMode) this._pause(1e9);
      else if (this.y <= this.stallAt && this._clear()) {
        this.stallMode = this.r() < 0.5 ? 'still' : 'sway';
        this.stallStart = time;
        this._pause(1e9);
        if (this.stallMode === 'still') this.phase = 'pause';
        else this.phase = 'sway';
      } else if (this.phase === 'done') this._pause();
      else this._move();
    }
    this.vx = (this.x - ox) / dt;
    this.vy = (this.y - oy) / dt;
    this.vz = (this.z - oz) / dt;
  }
}

/**
 * One run. Returns stats. mode: 'descent' (complete the run) or 'stall' (stall
 * at a random depth inside the lethal sections and measure time-to-catch).
 */
export function runOne(diffKey, profileKey, seed, mode = 'descent') {
  const diff = DIFFICULTY[diffKey];
  const level = makeLevel(diff.levelVariant);
  const firstLethal = level.sections.find((sct) => sct.creature && sct.creature.lethal);
  LETHAL_TOP = firstLethal ? firstLethal.yTop : -230;
  FINISH_Y = REAL ? level.goal.minY + 2 : -556;
  const bus = new EventBus();
  const ev = { burst: 0, commit: 0, attack: 0, retreat: 0, nearMiss: 0, step: 0 };
  bus.on('creature:burst', (p) => {
    ev.burst++;
    if (p.commit) ev.commit++;
  });
  bus.on('creature:attack', () => ev.attack++);
  bus.on('creature:retreat', () => ev.retreat++);
  bus.on('creature:step', () => ev.step++);
  const hitBy = {};
  const missBy = {};
  bus.on('creature:strike', (p) => {
    const key = p.reason + '/' + (player.froze && player.decided ? 'froze' : player.reacting ? 'reacting' : player.phase);
    if (p.hit) hitBy[key] = (hitBy[key] || 0) + 1;
    else missBy[p.reason] = (missBy[p.reason] || 0) + 1;
  });
  const rand = U.rng(seed * 7919 + 13);
  const creature = new Creature3D(level, diff, bus, { seed: seed * 31 + 7 });
  const threat = new ThreatSystem3D();
  const player = new Player(PROFILES[profileKey], rand, level);
  const start = mode === 'stall' ? (level.sections.find((sct) => sct.creature && sct.creature.lethal) || level.sections[4]).checkpoint : level.spawn;
  player.place(start.x, start.y, start.z);
  if (mode === 'stall') player.stallAt = U.lerp(LETHAL_TOP - 6, FINISH_Y + 16, rand());
  creature.reset(player);
  let time = 0;
  let deaths = 0;
  const deathsBySec = new Array(level.sections.length).fill(0);
  let lethalTime = 0;
  let distSum = 0;
  let distN = 0;
  let nearT = 0; // time within menace+2
  let threatSum = 0;
  let threatHi = 0; // time with threat > 0.7
  let respawnT = -1;
  let stallCatch = null;
  const stateT = {};
  let lastSection = 0;
  const maxTime = mode === 'stall' ? 400 : 1800;
  while (time < maxTime) {
    time += DT;
    if (!player.alive) {
      respawnT -= DT;
      if (respawnT <= 0) {
        const i = level.sectionIndexAt(player.deathY);
        const cp = level.checkpointFor(i, diff.checkpoints);
        player.place(cp.x, cp.y, cp.z);
        creature.onRespawn(player);
        threat.reset();
      }
    } else {
      player.update(DT, creature, time);
    }
    const si = level.sectionIndexAt(player.y);
    if (si !== lastSection) {
      lastSection = si;
      // fire triggers crossed (sighting) — like Game3D
      for (const t of level.sections[si].triggers) {
        if (player.y <= t.y && !t._fired) {
          t._fired = true;
          bus.emit('trigger:' + t.name, { name: t.name, data: t.data, section: si, x: player.x, y: t.y, z: player.z });
        }
      }
    } else {
      for (const t of level.sections[si].triggers) {
        if (player.y <= t.y && !t._fired) {
          t._fired = true;
          bus.emit('trigger:' + t.name, { name: t.name, data: t.data, section: si, x: player.x, y: t.y, z: player.z });
        }
      }
    }
    creature.update(DT, player, time);
    threat.update(DT, { player, creature, tethers: null, diff });
    if (creature.caughtPlayer) {
      creature.caughtPlayer = false;
      if (player.alive) {
        player.alive = false;
        player.deathY = player.y;
        deaths++;
        deathsBySec[si]++;
        respawnT = 1.5;
        if (mode === 'stall' && player.stallMode && stallCatch === null) {
          stallCatch = time - player.stallStart;
          break;
        }
      }
    }
    if (player.alive && player.y < LETHAL_TOP) {
      lethalTime += DT;
      distSum += creature.distance;
      distN++;
      if (creature.distance < creature.k.menace + 2) nearT += DT;
      threatSum += threat.value;
      if (threat.value > 0.7) threatHi += DT;
      stateT[creature.state] = (stateT[creature.state] || 0) + DT;
    }
    if (mode === 'descent' && player.alive && player.y <= FINISH_Y) break;
  }
  return {
    time,
    deaths,
    deathsBySec,
    finished: player.y <= FINISH_Y,
    lethalTime,
    meanDist: distN ? distSum / distN : 0,
    nearFrac: lethalTime ? nearT / lethalTime : 0,
    meanThreat: distN ? threatSum / distN : 0,
    hitBy,
    missBy,
    hiThreatFrac: lethalTime ? threatHi / lethalTime : 0,
    stats: Object.assign({}, creature.stats),
    ev,
    stallCatch,
    stallMode: player.stallMode,
    stateT,
  };
}

function LETHAL_TOP_REAL() { const lv = makeLevel('normal'); const f = lv.sections.find((sct) => sct.creature && sct.creature.lethal); return Math.round((f ? f.yTop : 0) - (lv.goal.minY + 2)); }
function pct(a, p) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (v) => (isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (isFinite(v) ? v.toFixed(2) : '-');

if (process.argv[1] && process.argv[1].endsWith('pacing.mjs')) {
  console.log(REAL ? `Creature3D human-pacing sim — ${RUNS} runs per cell, REAL level (level agent's LEVEL_DATA_3D, lethal sections 5–8 = ${-LETHAL_TOP_REAL()} m)\n` : `Creature3D human-pacing sim — ${RUNS} runs per cell, stub shaft (560 m, lethal sections 5–8 = 330 m)\n`);
  console.log('## Descent: deaths per full run (lethal sections 5–8)');
  console.log('| diff | player | deaths/run | runs w/o death | p90 deaths | lethal time (s) | mean dist (m) | ≤menace | mean threat | threat>0.7 | relocations/run | bursts/run | lunges/run | near misses/run | retreats/run | listens/run | stall lunges/run |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const dk of ['normal', 'nightmare', 'abyss']) {
    if (ONLY && !ONLY.includes(dk)) continue;
    for (const pk of (process.env.PROF ? process.env.PROF.split(',') : ['expert', 'careful', 'hesitant'])) {
      const rs = [];
      for (let s = 1; s <= RUNS; s++) rs.push(runOne(dk, pk, s, 'descent'));
      const d = rs.map((r) => r.deaths);
      console.log(
        `| ${dk} | ${pk} | ${f2(mean(d))} | ${((100 * rs.filter((r) => r.deaths === 0).length) / rs.length).toFixed(0)}% | ${pct(d, 0.9)} | ${f1(mean(rs.map((r) => r.lethalTime)))} | ${f1(mean(rs.map((r) => r.meanDist)))} | ${(100 * mean(rs.map((r) => r.nearFrac))).toFixed(0)}% | ${f2(mean(rs.map((r) => r.meanThreat)))} | ${(100 * mean(rs.map((r) => r.hiThreatFrac))).toFixed(0)}% | ${f2(mean(rs.map((r) => r.stats.relocations || 0)))} | ${f1(mean(rs.map((r) => r.stats.bursts)))} | ${f1(mean(rs.map((r) => r.stats.attacks)))} | ${f1(mean(rs.map((r) => r.stats.nearMisses)))} | ${f1(mean(rs.map((r) => r.stats.retreats)))} | ${f1(mean(rs.map((r) => r.stats.listens)))} | ${f1(mean(rs.map((r) => r.stats.stallLunges)))} |`,
      );
      if (process.env.CAUSES) {
        const agg = {};
        const magg = {};
        for (const r of rs) {
          for (const k in r.hitBy) agg[k] = (agg[k] || 0) + r.hitBy[k];
          for (const k in r.missBy) magg[k] = (magg[k] || 0) + r.missBy[k];
        }
        console.log('|   | hits: ' + JSON.stringify(agg) + ' misses: ' + JSON.stringify(magg));
      }
    }
  }
  if (process.env.NOSTALL) process.exit(0);
  console.log('\n## Stalling: seconds from the stall until caught (careful player stops at a random depth in sections 5–8, never reacts)');
  console.log('| diff | stall kind | n | median | mean | p10 | p90 | never caught (400 s) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const dk of ['normal', 'nightmare', 'abyss']) {
    if (ONLY && !ONLY.includes(dk)) continue;
    const rs = [];
    for (let s = 1; s <= RUNS; s++) rs.push(runOne(dk, 'careful', 1000 + s, 'stall'));
    for (const kind of ['still', 'sway']) {
      const sub = rs.filter((r) => r.stallMode === kind);
      const c = sub.filter((r) => r.stallCatch !== null).map((r) => r.stallCatch);
      console.log(`| ${dk} | ${kind} | ${sub.length} | ${f1(pct(c, 0.5))} | ${f1(mean(c))} | ${f1(pct(c, 0.1))} | ${f1(pct(c, 0.9))} | ${sub.length - c.length} |`);
    }
  }
}
