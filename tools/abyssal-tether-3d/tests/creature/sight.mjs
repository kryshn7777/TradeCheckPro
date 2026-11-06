// MASON_SIGHT.md (Node): "When the Mason sees the player it chases. No more health stuff if the player is kinda near to it", and the
// knocker decoy contract (Creature3D.distract). The real Creature3D on the stub shaft (an open shaft: clean lines of sight) and on the
// real level (lines of sight through real masonry), seeded, 60 Hz.
//   sight: range + line of sight + the lantern lit; the 0.5 s notice commit (continuous sight, one roar per glimpse window); lost sight
//          -> the chase holds for `memory` s, then the sound hunt; refuge / blocked / override / sandbox / off switches; the per-difficulty
//          numbers; the hunt gate's scent hold kept full while it chases; S4 sighting and S5 lure rules
//   near:  a connect is lethal at full hp and every connect happens inside lethalNear; healing suspended inside (regen, the regen clock,
//          the bag), restored outside; non-Mason damage unchanged
//   decoy: accept / reject, the listen turn, the crawl, the inspect, timeout, the override radius, diminishing returns, the known knocker
//   plus: a scripted chase from ~25 m converges on every difficulty, determinism, no allocation per frame in the sense module
//   node sight.mjs [--root DIR]
import fs from 'node:fs';
import inspector from 'node:inspector/promises';
import { srcUrl, SRC_DIR, TOOLS_DIR } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus, SETTINGS_DEFAULTS, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { Creature3D } = await import(srcUrl('sim/creature3d.js'));
const { SIGHT_TUNE, SIGHT_COMMON, DECOY_TUNE } = await import(srcUrl('sim/masonSight.js'));
const { Health3D } = await import(srcUrl('sim/health3d.js'));
const { Inventory3D, ITEM } = await import(srcUrl('sim/inventory3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const KEYS = ['normal', 'nightmare', 'abyss'];
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

// the player stands on a stub-shaft ledge in s6 (hunt, lethal): top y -344, x -16..-12.8, z -7.5..-0.5 (against the -X wall)
const LEDGE = { x: -14.4, y: -343.1, z: -4 };
// a knocker on the +Z wall's ledge across the shaft (top y -330, x -12.5..-1.5, z 12.8..16)
const KNOCK = { x: -7, y: -329.9, z: 14.4 };

const EVENTS = ['creature:notice', 'creature:sight', 'creature:attack', 'creature:strike', 'creature:near', 'creature:distracted', 'creature:decoy:end', 'creature:state', 'creature:sighting'];

function mk(key, seed, opts = {}) {
  const L = opts.real ? new Level3D(LEVEL_DATA_3D, DIFFICULTY[key].levelVariant) : new Level3D(makeShaftData(), key);
  const bus = new EventBus();
  const w = { L, bus, t: 0, ev: [] };
  for (const e of EVENTS) bus.on(e, (p) => w.ev.push({ t: w.t, type: e, p }));
  w.c = new Creature3D(L, opts.diff || DIFFICULTY[key], bus, { seed, sight: opts.sight });
  w.p = Object.assign({ x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true }, opts.p || {});
  w.c.reset(w.p);
  // most checks look at a player the Mason has already been warned about: the section's first notice (a 6 s warning, no chase) is
  // consumed up front; `first: true` keeps it (the first-sighting checks)
  if (!opts.first) warned(w.c);
  w.step = (n, each) => {
    for (let i = 0; i < n; i++) {
      w.t += DT;
      if (each && each(w) === false) return false;
      w.c.update(DT, w.p, w.t);
    }
    return true;
  };
  w.first = (type, pred) => w.ev.find((e) => e.type === type && (!pred || pred(e.p)));
  w.count = (type, pred) => w.ev.filter((e) => e.type === type && (!pred || pred(e.p))).length;
  return w;
}
/** The section's first notice already happened (no firstHold). */
function warned(c) {
  c.sense._first = false;
  c.sense._sec = c.sectionIndex;
}
/** Nearest of the crown / front blocks to the player (what lethalNear is measured to). */
function frontDist(c, p) {
  const sp = c.body.spine;
  let d = len3(p.x - c.x, p.y - c.y, p.z - c.z);
  for (let i = 1; i < SIGHT_COMMON.front; i++) d = Math.min(d, len3(p.x - sp[i * 3], p.y - sp[i * 3 + 1], p.z - sp[i * 3 + 2]));
  return d;
}

// ---- 1. the numbers ------------------------------------------------------------------------------------------------------------
{
  const want = { normal: [30, 0.5, 1.0, 3, 8, 5, 60, 8, 20], nightmare: [38, 0.5, 1.0, 3, 9.5, 6, 66, 8, 18], abyss: [46, 0.5, 1.05, 4, 11, 7, 72, 6, 14] };
  let good = true;
  for (const k of KEYS) {
    const T = SIGHT_TUNE[k];
    const got = [T.sightRange, T.notice, T.pursueMul, T.memory, T.lethalNear, T.decoyOverride, T.hearRange, T.firstHold, T.cooldown];
    if (got.join() !== want[k].join()) good = false;
    const w = mk(k, 1);
    if (w.c.sense.tune !== T) good = false;
  }
  ok(good, 'per-difficulty numbers: sightRange 30/38/46 m, notice 0.5 s, pursueMul 1.0/1.0/1.05, memory 3/3/4 s, lethalNear 8/9.5/11 m, decoyOverride 5/6/7 m, hearRange 60/66/72 m, firstHold 8/8/6 s, cooldown 20/18/14 s');
  // every regular strike reach (killRadius x strikeMul + nav.stretch) is inside lethalNear: a connect can only happen in the near radius
  const reach = (k) => DIFFICULTY[k].creature.killRadius * 1.6 + 3.5;
  ok(KEYS.every((k) => reach(k) <= SIGHT_TUNE[k].lethalNear), `strike reach ${KEYS.map((k) => reach(k).toFixed(2)).join(' / ')} m <= lethalNear on every difficulty`);
  ok(SIGHT_TUNE.normal.decoyOverride < SIGHT_TUNE.normal.lethalNear && SIGHT_TUNE.abyss.decoyOverride < SIGHT_TUNE.abyss.lethalNear, 'decoyOverride < lethalNear (a decoy never shields someone who walks up to it)');
  ok(SETTINGS_DEFAULTS.masonSight === 'on', "setting masonSight defaults to 'on'");
}

// ---- 2. notice + commit on the open shaft ----------------------------------------------------------------------------------------
{
  let good = true;
  let line = [];
  for (const k of KEYS) {
    for (let seed = 1; seed <= 4; seed++) {
      const w = mk(k, seed);
      w.step(60 * 25, (x) => !x.c.sight.chasing);
      const n = w.first('creature:notice');
      const s = w.first('creature:sight', (p) => p.on);
      const dt = n && s ? s.t - n.t : -1;
      const okk = n && s && n.p.distance <= SIGHT_TUNE[k].sightRange + 0.01 && Math.abs(dt - 0.5) < DT + 1e-6 && w.count('creature:notice') === 1;
      if (!okk) good = false;
      if (seed === 1) line.push(`${k} noticed at ${n ? n.p.distance.toFixed(1) : '-'} m, committed ${f2(dt)} s later`);
    }
  }
  ok(good, `open shaft: it notices inside sightRange and commits exactly 0.5 s later, one notice (${line.join('; ')})`);
}

// ---- 3. the lantern / the switches / blocked / sandbox ---------------------------------------------------------------------------
{
  const w = mk('normal', 2);
  w.c.setSight(true, false, false);
  w.step(60 * 30);
  ok(w.count('creature:notice') === 0 && !w.c.sight.chasing && w.c.inPlay, 'an empty lantern: never seen in 30 s (it still hunts by sound)');
  const w2 = mk('normal', 2);
  w2.c.setSight(false, true, false);
  w2.step(60 * 30);
  const w3 = mk('normal', 2, { sight: false });
  w3.step(60 * 30);
  ok(w2.count('creature:notice') === 0 && w3.count('creature:notice') === 0, '?sight=off / setting off (setSight(false)) and options.sight === false: never seen');
  const w4 = mk('normal', 2);
  w4.c.setSight(true, true, true);
  w4.step(60 * 30);
  ok(w4.count('creature:notice') === 0, 'view blocked (cutscene / not playing): never seen');
  const ws = mk('sandbox', 2, { diff: DIFFICULTY.sandbox });
  ws.step(60 * 20);
  ok(!ws.c.active && ws.count('creature:notice') === 0 && !ws.c.sight.near, 'Sandbox: no creature, no sight, never near');
  // switches off mid-chase: the chase drops at once
  const w5 = mk('normal', 3);
  w5.step(60 * 25, (x) => !x.c.sight.chasing);
  w5.c.setSight(false, true, false);
  w5.step(1);
  ok(!w5.c.sight.chasing && !w5.c.sight.near, 'switched off mid-chase: the chase and the near rule end at once');
}

// ---- 4. line of sight ----------------------------------------------------------------------------------------------------------
{
  const w = mk('normal', 1);
  const c = w.c;
  const sp = c.body.spine;
  const put = (x, y, z) => {
    c.x = x;
    c.y = y;
    c.z = z;
    for (let i = 0; i < 3; i++) {
      sp[i * 3] = x;
      sp[i * 3 + 1] = y + i;
      sp[i * 3 + 2] = z;
    }
  };
  put(0, -340, 0);
  const clear = c.sense._los({ x: -14, y: -343, z: 0 });
  const wall = c.sense._los({ x: -25, y: -343, z: 0 }); // behind the -X wall (x -22..-16)
  ok(clear && !wall, 'line of sight: clear across the shaft, blocked by the shaft wall');
  // the real level: every notice happened with a clear line (crown / front block -> head / torso), in range, lantern lit
  let notices = 0;
  let bad = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const r = mk('normal', seed, { real: true });
    const L = r.L;
    const sec = 5;
    const cp = L.sections[sec].checkpoint;
    r.p.x = cp.x;
    r.p.y = cp.y;
    r.p.z = cp.z;
    r.c.reset(r.p);
    r.c.setSection(sec, L.sections[sec], r.p);
    r.step(60 * 60, (x) => {
      const t = x.t;
      x.p.vx = Math.cos(t * 0.5) * 3;
      x.p.vz = -Math.sin(t * 0.5) * 3;
      x.p.x = cp.x + Math.sin(t * 0.5) * 6;
      x.p.z = cp.z + Math.cos(t * 0.5) * 6;
      x.p.y = cp.y - ((0.5 * t) % 30);
      if (x.c.caughtPlayer) {
        x.c.caughtPlayer = false;
        x.c.onRespawn(x.p);
      }
    });
    for (const e of r.ev) {
      if (e.type !== 'creature:notice') continue;
      notices++;
      if (e.p.distance > SIGHT_TUNE.normal.sightRange + 0.5) bad++;
    }
  }
  // the LOS at the notice frame (checked inside the sense: it emits only after _los passed); here: no notice ever beyond range
  ok(notices > 0 && bad === 0, `real level, 6 seeds x 60 s: ${notices} notices, all inside sightRange (the LOS / lantern rule lives in the sense)`);
  // and directly: a sense sample with the player behind real masonry is not a sighting
  const r = mk('normal', 1, { real: true });
  let blockedPairs = 0;
  let wrong = 0;
  const L = r.L;
  const sp2 = r.c.body.spine;
  for (let i = 0; i < 400; i++) {
    const s = L.sections[3 + (i % 4)];
    const cp = s.checkpoint;
    const a = (i * 2.399) % (Math.PI * 2);
    const hx = cp.x + Math.cos(a) * (6 + (i % 7) * 3);
    const hz = cp.z + Math.sin(a) * (6 + (i % 7) * 3);
    const hy = cp.y + 4 + (i % 9) * 2;
    r.c.x = hx;
    r.c.y = hy;
    r.c.z = hz;
    for (let j = 0; j < 3; j++) {
      sp2[j * 3] = hx;
      sp2[j * 3 + 1] = hy;
      sp2[j * 3 + 2] = hz;
    }
    const eye = CONFIG.player.eyeHeight;
    const truth = !L.segmentBlocked(hx, hy, hz, cp.x, cp.y + eye, cp.z, 0.3) || !L.segmentBlocked(hx, hy, hz, cp.x, cp.y, cp.z, 0.3);
    if (!truth) blockedPairs++;
    if (r.c.sense._los(cp) !== truth) wrong++;
  }
  ok(blockedPairs > 20 && wrong === 0, `real level: 400 crown -> player lines (${blockedPairs} through masonry): the sense agrees with level.segmentBlocked on every one`);
}

// ---- 5. the notice needs continuous sight; glimpses do not spam the roar -------------------------------------------------------
{
  const w = mk('normal', 1);
  let tN = -1;
  let tRelit = -1;
  w.step(60 * 25, (x) => {
    const n = x.first('creature:notice');
    if (n && tN < 0) tN = n.t;
    if (tN >= 0 && x.t >= tN + 0.25 && x.t < tN + 0.55) x.c.setSight(true, false, false);
    else if (tN >= 0 && x.t >= tN + 0.55 && tRelit < 0) {
      x.c.setSight(true, true, false);
      tRelit = x.t;
    }
    return !x.c.sight.chasing;
  });
  const s = w.first('creature:sight', (p) => p.on);
  ok(tN > 0 && s && s.t >= tRelit + 0.5 - 1e-6 && s.t <= tRelit + 0.5 + SIGHT_COMMON.losEvery + 2 * DT, `the line broken 0.25 s into the notice: no commit; after the re-sight it needs 0.5 s again (committed ${s ? f2(s.t - tRelit) : '-'} s after)`);
  ok(w.count('creature:notice') === 1, `a broken notice does not roar again within ${SIGHT_COMMON.noticeCd} s`);
}

// ---- 6. lost sight: the chase holds for `memory` s, then the sound hunt ---------------------------------------------------------
{
  let good = true;
  const got = [];
  for (const k of KEYS) {
    const w = mk(k, 2);
    w.step(60 * 25, (x) => !x.c.sight.chasing);
    // keep it from striking: a non-lethal hunt (it looms) while we watch the memory
    w.c.lethal = false;
    w.step(30);
    w.c.setSight(true, false, false); // the lantern dies: it can no longer see you
    const t0 = w.t;
    let tEnd = -1;
    w.step(60 * 12, (x) => {
      x.c.stamina = 1; // no rest in the middle of the measurement
      if (!x.c.sight.chasing && tEnd < 0) tEnd = x.t;
    });
    const lost = w.first('creature:sight', (p) => p.on === false);
    const held = tEnd - t0;
    if (!(lost && lost.p.reason === 'lost' && held >= SIGHT_TUNE[k].memory - 1e-6 && held <= SIGHT_TUNE[k].memory + SIGHT_COMMON.losEvery + 3 * DT) || !w.c.inPlay) good = false;
    got.push(`${k} ${f2(held)} s`);
  }
  ok(good, `sight lost: the chase holds for memory (3 / 3 / 4 s) then decays to the sound hunt (${got.join(', ')})`);
}

// ---- 7. refuges, the override, the S4 sighting, the S5 lure rules ----------------------------------------------------------------
{
  const w = mk('normal', 3);
  w.step(60 * 25, (x) => !x.c.sight.chasing);
  w.c.setRefuge(1, null);
  w.step(1);
  const dropped = !w.c.sight.chasing;
  const n0 = w.count('creature:notice');
  let caught = false;
  w.step(60 * 15, (x) => {
    if (x.c.caughtPlayer) caught = true;
  });
  ok(dropped && w.count('creature:notice') === n0 && !caught && !w.c.sight.near, "hidden in a Masons' rest (refuge 1): the chase drops, it cannot see you, nothing hits");
  const w2 = mk('normal', 3);
  w2.c.setRefuge(2, null);
  w2.step(60 * 20);
  ok(w2.count('creature:notice') === 0 && !w2.c.distract(KNOCK.x, KNOCK.y, KNOCK.z), 'the S5 lure niche (refuge 2): no sight (the lunge at the keystone stays as it was), the knocker refused');
  const w3 = mk('normal', 3);
  const si = w3.c.sectionIndex;
  w3.c.setOverride({ mode: 'escape' }, si);
  w3.step(60 * 20);
  ok(w3.count('creature:notice') === 0, 'an objective override (the S7 escape: already a chase): sight stays out of it');
  // the S4 staged sighting (stub s4, trigger at -172): it crosses far below, crown turned to you; never a notice or a chase
  const w4 = mk('normal', 1, { p: { x: 0, y: -180, z: 0 } });
  w4.step(60 * 14);
  ok(w4.count('creature:sighting') === 1 && w4.count('creature:notice') === 0 && !w4.c.sight.chasing, 'the S4 sighting beat plays as before: no notice, no chase');
}

// ---- 8. the hunt gate: while it chases you health does not send it away ------------------------------------------------------------
{
  const w = mk('normal', 2);
  w.c.setHuntGate(true);
  w.c.setHurt(true); // low health arms the hunt (the scent)
  w.c.reset(w.p);
  w.c.setHurt(true);
  w.step(60 * 30, (x) => {
    x.c.setHurt(true);
    return !x.c.sight.chasing;
  });
  const chasing = w.c.sight.chasing;
  w.c.lethal = false; // watch it, do not die
  let withdrew = false;
  w.step(60 * 30, (x) => {
    x.c.setHurt(false); // healed
    if (x.c._withdraw) withdrew = true;
    x.c.lethal = false;
  });
  ok(chasing && !withdrew && w.c.sight.chasing, 'hunt gate: healed while it keeps seeing you, it never withdraws (30 s): the scent hold is kept full by the chase');
  w.c.setSight(true, false, false); // the light is gone
  let tW = -1;
  const t0 = w.t;
  w.step(60 * 30, (x) => {
    x.c.setHurt(false);
    if (x.c._withdraw && tW < 0) tW = x.t - t0;
  });
  ok(tW > SIGHT_TUNE.normal.memory + 13 && tW < SIGHT_TUNE.normal.memory + 15, `... and once it loses you it withdraws after memory + the 14 s scent hold (${f2(tW)} s)`);
}

// ---- 9. a scripted chase from ~25 m converges; every connect is inside lethalNear; full hp still dies ----------------------------
{
  let good = true;
  let nearOk = true;
  let fullHp = true;
  const times = {};
  let hits = 0;
  for (const k of KEYS) {
    times[k] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const w = mk(k, seed);
      const h = new Health3D(DIFFICULTY[k], null);
      w.c._introT = 0;
      w.c._enterPlay(w.p, 18, 0); // on the wall ~25 m away
      const d0 = w.c.distance = len3(w.p.x - w.c.x, w.p.y - w.c.y, w.p.z - w.c.z);
      let tHit = -1;
      let sawNear = false;
      let fd = 0;
      w.step(60 * 30, (x) => {
        if (x.c.sight.near) sawNear = true;
        h.noRecovery = x.c.sight.near;
        h.step(DT);
        if (x.c.attack.phase === 'windup') fd = frontDist(x.c, x.p);
        if (x.c.caughtPlayer) {
          // game.js: c.caughtPlayer -> physics.kill(..., 'creature') whatever the hp
          if (h.hp < 1) fullHp = false;
          h.die();
          tHit = x.t;
          return false;
        }
      });
      if (tHit < 0) good = false;
      else {
        hits++;
        times[k].push(f2(tHit) + `s/${d0.toFixed(0)}m`);
        if (!sawNear || fd > SIGHT_TUNE[k].lethalNear) nearOk = false;
      }
    }
  }
  ok(good, `a player standing on a ledge in view from ~25 m is caught on every seed and difficulty (${KEYS.map((k) => k + ' ' + times[k].join(' ')).join(' | ')})`);
  ok(nearOk && hits > 0, 'every connect came out of the lethalNear radius (the near flag was on before it, the wind-up ended inside it)');
  ok(fullHp, 'the connect kills at FULL hp (deathCause creature: the devour scene)');
  const gsrc = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  ok(/if \(c\.caughtPlayer\) \{\s*c\.caughtPlayer = false;\s*if \(this\.player\.alive && this\.state === 'playing'\) this\.physics\.kill\(this\.player, this\.tethers, 'creature'\);/.test(gsrc), "game.js: a Mason connect is physics.kill(..., 'creature') with no hp test (unchanged)");
}

// ---- 10. the near radius: no recovery inside, restored outside ---------------------------------------------------------------------
{
  const h = new Health3D(DIFFICULTY.normal, null);
  h.setHp(0.5);
  h.noRecovery = true;
  for (let i = 0; i < 60 * 20; i++) h.step(DT);
  const held = h.hp === 0.5;
  const sinceFrozen = h.sinceHurt === 0;
  ok(held && sinceFrozen, 'inside: no regeneration in 20 s and the regen clock does not run');
  ok(h.heal(0.2) === 0 && h.hp === 0.5, 'inside: heal() restores nothing');
  ok(h.heal(0.2, true, true) > 0, 'a checkpoint patch-up (force) still heals');
  h.setHp(0.5);
  h.noRecovery = false;
  for (let i = 0; i < 60 * 20; i++) h.step(DT);
  ok(h.hp > 0.5, `outside: regeneration back (hp ${h.hp.toFixed(2)} after 20 s)`);
  // the bag
  const bag = new Inventory3D(null);
  bag.counts[ITEM.BANDAGE] = 2;
  bag.counts[ITEM.ADRENALINE] = 1;
  h.setHp(0.4);
  h.noRecovery = true;
  const refused = !bag.use(ITEM.BANDAGE, h) && bag.lastRefusal === 'norecovery';
  const adr = bag.use(ITEM.ADRENALINE, h);
  ok(refused && adr, "inside: a bandage / first aid is refused ('No recovery this close'), the adrenaline shot still works (its speed; the +10 hp does not land)");
  bag.cancel();
  h.noRecovery = false;
  bag.use(ITEM.BANDAGE, h);
  bag.update(0.5, h, true);
  h.noRecovery = true;
  bag.update(0.1, h, true);
  ok(!bag.applying.active && bag.counts[ITEM.BANDAGE] === 2, 'a bandage being applied when it comes near is cancelled and the bandage kept');
  // non-Mason damage unchanged inside
  const h2 = new Health3D(DIFFICULTY.normal, null);
  h2.noRecovery = true;
  const dead = h2.damage(0.26, 'skitter', 0);
  ok(!dead && Math.abs(h2.hp - 0.74) < 1e-9, 'inside: a skitterling bite / the Holdfast still costs only its damage (not lethal)');
  // the integrated flag: near only while it chases and you are inside the radius
  const w = mk('nightmare', 2);
  let nearFar = 0;
  let nearOn = 0;
  w.step(60 * 30, (x) => {
    const s = x.c.sight;
    if (s.near) {
      nearOn++;
      if (s.nearDist > SIGHT_TUNE.nightmare.lethalNear || !s.chasing) nearFar++;
    }
    if (x.c.caughtPlayer) return false;
  });
  ok(nearOn > 0 && nearFar === 0 && w.count('creature:near') >= 1, `the near flag: only while chasing and within lethalNear (${nearOn} frames), a creature:near event for the caption`);
}

// ---- 11. determinism -------------------------------------------------------------------------------------------------------------
{
  const run = () => {
    const w = mk('abyss', 7);
    w.step(60 * 20, (x) => {
      if (x.t > 6 && x.t < 6.02) x.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 9 });
      if (x.c.caughtPlayer) return false;
    });
    return w.ev.map((e) => e.type + f2(e.t)).join(',') + `|${w.c.x.toFixed(6)},${w.c.y.toFixed(6)},${w.c.z.toFixed(6)}`;
  };
  ok(run() === run(), 'deterministic with a seed (sight, chase, decoy)');
  const src = fs.readFileSync(SRC_DIR + '/sim/masonSight.js', 'utf8') + fs.readFileSync(SRC_DIR + '/audio/masonSightSfx.js', 'utf8');
  ok(!/Math\.random\s*\(/.test(src), 'no Math.random in the sense module or its sound');
}

// ---- 12. the knocker decoy ---------------------------------------------------------------------------------------------------------
{
  const D = DECOY_TUNE;
  // accept / reject
  const w0 = mk('normal', 4);
  const notInPlay = new Creature3D(new Level3D(makeShaftData(), 'normal'), DIFFICULTY.normal, new EventBus(), { seed: 1 });
  notInPlay.reset({ x: 0, y: -20, z: 0, vx: 0, vy: 0, vz: 0, alive: true }); // s1 dormant
  ok(!notInPlay.distract(0, -25, 0), 'refused while the Mason is dormant (out of play)');
  w0.step(60 * 4);
  const far = !w0.c.distract(w0.c.x, w0.c.y - 70, w0.c.z);
  const bad = !w0.c.distract(NaN, 0, 0);
  ok(far && bad, 'refused beyond its hearing reach (60 m on Normal) and for a bad point');
  ok(w0.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 9 }) && w0.first('creature:distracted'), 'accepted within reach: creature:distracted {x,y,z,duration}');
  ok(w0.c.distract(KNOCK.x + 0.5, KNOCK.y, KNOCK.z, { duration: 9 }) && w0.c.decoy.x === KNOCK.x + 0.5 && w0.count('creature:distracted') === 1, 'a call while live refreshes / moves the point (no second event)');
  const sk = new Creature3D(new Level3D(makeShaftData(), 'normal'), DIFFICULTY.normal, new EventBus(), { seed: 1, variant: 'skitterling' });
  sk.reset(Object.assign({}, LEDGE, { vx: 0, vy: 0, vz: 0, alive: true }));
  ok(!sk.distract(KNOCK.x, KNOCK.y, KNOCK.z), 'skitterlings ignore it');

  // the full cycle: listen turn, crawl, inspect, end; timings
  const cyc = (k, seed) => {
    const w = mk(k, seed);
    w.step(60 * 25, (x) => !x.c.sight.chasing); // it is chasing you
    const t0 = w.t;
    const acc = w.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 15 });
    let tTravel = -1;
    let tInspect = -1;
    let minD = 1e9;
    let nearSeen = false;
    let caught = false;
    let attacks = 0;
    w.step(60 * 20, (x) => {
      const d = x.c.decoy;
      if (d.phase === 'travel' && tTravel < 0) tTravel = x.t - t0;
      if (d.phase === 'inspect' && tInspect < 0) tInspect = x.t - t0;
      if (d.live) minD = Math.min(minD, len3(KNOCK.x - x.c.x, KNOCK.y - x.c.y, KNOCK.z - x.c.z));
      if (d.live && x.c.sight.chasing) nearSeen = true;
      if (x.c.caughtPlayer) caught = true;
      if (x.c.state === 'ATTACK' && d.live) attacks++;
      if (!d.live && tInspect > 0) return false;
    });
    const end = w.first('creature:decoy:end');
    return { w, acc, tTravel, tInspect, minD, nearSeen, caught, attacks, end, t0 };
  };
  let good = true;
  const rows = [];
  for (const k of KEYS) {
    for (let seed = 1; seed <= 3; seed++) {
      const r = cyc(k, seed);
      const insp = r.end ? r.end.t - r.t0 - r.tInspect : -1;
      const g = r.acc && Math.abs(r.tTravel - D.turn) <= DT + 1e-6 && r.tInspect > r.tTravel && r.end && r.end.p.reason === 'inspected' && Math.abs(insp - D.inspect) <= 2 * DT && !r.nearSeen && !r.caught && r.attacks === 0 && r.minD <= D.stuckNear;
      if (!g) good = false;
      if (seed === 1) rows.push(`${k}: turn ${f2(r.tTravel)} s, reached in ${f2(r.tInspect - r.tTravel)} s (closest ${r.minD.toFixed(1)} m), inspected ${f2(insp)} s`);
    }
  }
  ok(good, `a chasing Mason drops you for the knocker: ${D.turn} s listen turn, the crawl over the nav, ${D.inspect} s inspect, end 'inspected'; no sight / attack meanwhile (${rows.join('; ')})`);

  // diminishing returns: wise for 20 s, the next decoy halved with a shorter turn; the inspected knocker ignored
  const r = cyc('normal', 2);
  const c = r.w.c;
  const knownRefused = !c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 9 });
  const P2 = { x: -12, y: -357.9, z: 12 }; // another spot (the next ledge down)
  const acc2 = c.distract(P2.x, P2.y, P2.z, { duration: 9 });
  ok(knownRefused, 'wise: the knocker it just inspected is ignored');
  ok(acc2 && c.decoy.wise && Math.abs(c.decoy.left - 9 * D.wiseMul) < 1e-9 && c.decoy.turn === D.turnWise, `wise (${D.wise} s after a decoy): a new decoy lasts half as long (4.5 s of 9) and its listen turn is ${D.turnWise} s`);
  let tEnd = -1;
  const t0 = r.w.t;
  r.w.step(60 * 10, (x) => {
    if (!x.c.decoy.live && tEnd < 0) tEnd = x.t - t0;
    x.c.lethal = false;
  });
  const lastEnd = r.w.ev.filter((e) => e.type === 'creature:decoy:end').pop();
  ok(tEnd > 0 && tEnd <= 4.5 + 2 * DT && lastEnd && (lastEnd.p.reason === 'timeout' || lastEnd.p.reason === 'inspected'), `... and it ends within 4.5 s ('${lastEnd && lastEnd.p.reason}' at ${f2(tEnd)} s)`);
  // timeout and the wise window expiring
  const w5 = mk('normal', 5);
  w5.step(60 * 6);
  w5.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 2 });
  w5.step(60 * 3, (x) => {
    x.c.lethal = false;
  });
  const to = w5.first('creature:decoy:end');
  ok(to && to.p.reason === 'timeout' && Math.abs(to.t - 6 - 2) < 0.05, `a short knock times out ('timeout' after ${to ? f2(to.t - 6) : '-'} s)`);
  w5.step(60 * (D.wise + 1), (x) => {
    x.c.lethal = false;
  });
  ok(w5.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 9 }) && !w5.c.decoy.wise && w5.c.decoy.left === 9, `after ${D.wise} s it is no longer wise: full length again`);

  // the override radius: walk up to it and the decoy no longer holds it
  for (const k of KEYS) {
    const w = mk(k, 1);
    w.step(60 * 6);
    w.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 15 });
    w.step(30);
    const R = SIGHT_TUNE[k].decoyOverride;
    // put the player just outside, then just inside the radius from its crown
    const place = (r) => {
      const c = w.c;
      const dx = w.p.x - c.x;
      const dy = w.p.y - c.y;
      const dz = w.p.z - c.z;
      const d = len3(dx, dy, dz) || 1;
      w.p.x = c.x + (dx / d) * r;
      w.p.y = c.y + (dy / d) * r;
      w.p.z = c.z + (dz / d) * r;
    };
    place(R + 0.6);
    w.step(1);
    const holds = w.c.decoy.live && !w.c.sight.eligible;
    place(R - 0.6);
    w.step(1);
    const end = w.first('creature:decoy:end');
    ok(holds && !w.c.decoy.live && end && end.p.reason === 'overridden' && w.c.sight.eligible, `${k}: the decoy holds against a player ${f2(R + 0.6)} m away (sight suppressed); at ${f2(R - 0.6)} m it is dropped ('overridden') and sight applies`);
  }

  // ?sight=off: the decoy still works as a sound lure, sight and the near rule stay off
  const wo = mk('normal', 1, { sight: false });
  wo.step(60 * 8);
  const accOff = wo.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 9 });
  wo.step(60 * 10);
  ok(accOff && wo.count('creature:notice') === 0 && wo.first('creature:decoy:end') && !wo.c.sight.near, 'sight off: the knocker still lures it (a sound), no sight, no near rule');
}

// ---- 12b. the owner's decision: it chases a WELL player too (the hunt gate no longer keeps it away); the fairness levers -----------
{
  // the first notice of a section is a warning only: no chase for firstHold s, however long it sees you
  let good = true;
  const got = [];
  for (const k of KEYS) {
    const w = mk(k, 2, { first: true });
    w.step(60 * 30, (x) => !x.c.sight.chasing);
    const n = w.first('creature:notice');
    const s = w.first('creature:sight', (p) => p.on);
    const held = n && s ? s.t - n.t : -1;
    if (!(held >= SIGHT_TUNE[k].firstHold - 1e-6)) good = false;
    got.push(`${k} ${f2(held)} s`);
  }
  ok(good, `the first notice in a section (or after a respawn) is only a warning: no chase for ${SIGHT_TUNE.normal.firstHold} s (committed ${got.join(', ')} after it)`);
  // the cooldown after a chase ends: it cannot commit again for `cooldown` s, then it can
  const w = mk('normal', 2);
  w.step(60 * 25, (x) => !x.c.sight.chasing);
  w.c.lethal = false;
  w.c.setSight(true, false, false);
  w.step(60 * 6, (x) => {
    x.c.stamina = 1;
    x.c.lethal = false;
  });
  const lost = w.first('creature:sight', (p) => p.on === false);
  w.c.setSight(true, true, false);
  let tRe = -1;
  w.step(60 * 20, (x) => {
    x.c.stamina = 1;
    x.c.lethal = false;
    if (x.c.sight.chasing && tRe < 0) tRe = x.t;
  });
  ok(lost && tRe > 0 && tRe - lost.t >= SIGHT_TUNE.normal.cooldown - 1e-6, `after it loses you it cannot commit again for ${SIGHT_TUNE.normal.cooldown} s (re-committed ${tRe > 0 && lost ? f2(tRe - lost.t) : '-'} s after the loss)`);
  // a respawn gives the warning again
  w.c.onRespawn(w.p);
  ok(w.c.sense._first === true && !w.c.sight.chasing, 'a respawn: the chase forgotten, the next notice is a warning again');

  // the prowl: the hunt gate on, the player WELL (setHurt never true), standing in view on the ledge
  const prowl = (k, seed, opts = {}) => {
    const r = mk(k, seed, { first: true });
    r.c.setHuntGate(true);
    r.c.reset(r.p);
    if (opts.lit === false) r.c.setSight(true, false, false);
    if (opts.off) r.c.setSight(false, true, false);
    let tIn = -1;
    let tChase = -1;
    let tLethal = -1;
    let caught = -1;
    let left = -1;
    r.step(60 * (opts.secs || 90), (x) => {
      x.c.setHurt(false);
      if (opts.refuge) x.c.setRefuge(1, null);
      if (x.c.inPlay && tIn < 0) tIn = x.t;
      if (x.c.sight.chasing && tChase < 0) tChase = x.t;
      if (x.c.lethal && tLethal < 0) tLethal = x.t;
      if (tIn > 0 && !x.c.inPlay && left < 0) left = x.t;
      if (x.c.caughtPlayer) {
        caught = x.t;
        return false;
      }
    });
    return { r, tIn, tChase, tLethal, caught, left };
  };
  let rows = [];
  let g = true;
  for (const k of KEYS) {
    const P = SIGHT_TUNE[k].prowl;
    const a = prowl(k, 3);
    const ok1 = Math.abs(a.tIn - P.first) < 0.1 && a.tChase > a.tIn && a.tLethal >= a.tChase - 1e-6 && a.caught > a.tChase;
    if (!ok1) g = false;
    rows.push(`${k}: a pass at ${f2(a.tIn)} s, chase ${f2(a.tChase)} s, caught ${f2(a.caught)} s`);
  }
  ok(g, `a WELL player in view: the Mason prowls in (after ${SIGHT_TUNE.normal.prowl.first} / ${SIGHT_TUNE.nightmare.prowl.first} / ${SIGHT_TUNE.abyss.prowl.first} s), harmless until it sees you, then it chases and kills (${rows.join('; ')})`);
  const dark = prowl('normal', 3, { lit: false, secs: 160 });
  const P = SIGHT_TUNE.normal.prowl;
  ok(dark.tIn > 0 && dark.tChase < 0 && dark.tLethal < 0 && dark.caught < 0 && dark.left > dark.tIn + P.dur - 0.1 && dark.r.c.stats.prowls >= 2, `unseen (an empty lantern): a ${P.dur} s pass that never strikes, it withdraws and leaves play (at ${f2(dark.left)} s), then comes back ${P.gapMin}-${P.gapMax} s later (${dark.r.c.stats.prowls} passes in 160 s)`);
  const rest = prowl('normal', 3, { refuge: true, secs: 120 });
  ok(rest.tChase < 0 && rest.caught < 0, "hidden in a Masons' rest through the passes: never seen, never touched");
  const off = prowl('normal', 3, { off: true, secs: 120 });
  ok(off.tIn < 0 && off.caught < 0, 'sight off: the old gate (a well player is never hunted, no passes)');
}

// ---- 13. no allocation per frame in the sense --------------------------------------------------------------------------------------
// Static: the per-frame paths (update, _los, decoyStep) build no object / array / closure / string (event payloads aside: those are
// the rare events). Dynamic: the heap sampled per update with the sense on vs switched off, for the record (V8 boxes some doubles in
// any sim code; the whole creature shows the same kind).
{
  const src = fs.readFileSync(SRC_DIR + '/sim/masonSight.js', 'utf8');
  const body = (name) => {
    const a = src.indexOf('\n  ' + name + '(');
    const b = src.indexOf('\n  }\n', a);
    return src.slice(a, b).replace(/c\._emit\([^;]*\);/g, '').replace(/\/\/[^\n]*/g, '').replace(/this\.endDecoy\([^)]*\)/g, '');
  };
  const hot = ['update', '_los', 'decoyStep'].map(body).join('\n');
  const bad = [/\bnew\s/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.(map|filter|slice|concat|join|bind)\(/].filter((r) => r.test(hot));
  ok(hot.length > 2000 && bad.length === 0, `no allocation in the per-frame paths (update, _los, decoyStep): no new / literal / closure / string building${bad.length ? ' — found ' + bad.join(' ') : ''}`);
  const perUpdate = async (on) => {
    const w = mk('normal', 2);
    w.step(60 * 25, (x) => !x.c.sight.chasing);
    if (!on) w.c.setSight(false, true, false);
    w.c.lethal = false;
    w.step(600, (x) => {
      x.c.lethal = false;
    });
    const session = new inspector.Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 512 });
    for (let i = 0; i < 4000; i++) {
      w.t += DT;
      w.p.x = LEDGE.x + Math.sin(w.t) * 1.2;
      w.p.vx = Math.cos(w.t) * 1.2;
      w.c.update(DT, w.p, w.t);
      w.c.lethal = false;
    }
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();
    let all = 0;
    (function walk(n) {
      all += n.selfSize || 0;
      for (const ch of n.children || []) walk(ch);
    })(profile.head);
    return all / 4000;
  };
  const bOn = await perUpdate(true);
  const bOff = await perUpdate(false);
  console.log(`INFO heap sampled per Creature3D.update while it chases: ${bOn.toFixed(0)} B with sight on, ${bOff.toFixed(0)} B with it off (V8 double boxing; no objects)`);
}

// ---- 14. the wiring ----------------------------------------------------------------------------------------------------------------
{
  const g = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  const ui = fs.readFileSync(SRC_DIR + '/ui/ui3d.js', 'utf8');
  const e2e = fs.readFileSync(TOOLS_DIR + '/e2e/e2e.cjs', 'utf8') + fs.readFileSync(TOOLS_DIR + '/e2e/free-attach.cjs', 'utf8');
  ok(/function sightOff\(\)/.test(g) && /c\.setSight\(sightOn/.test(g) && /this\.health\.noRecovery = /.test(g), 'game.js: ?sight=off, setSight every frame, health.noRecovery from the near flag');
  ok(/key: 'masonSight', tab: 'rope'/.test(ui), "ui3d.js: the Mason sight row on the Rope tab");
  ok((e2e.match(/sight=off/g) || []).length === 3, 'the e2e and free-attach query strings carry &sight=off');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL MASON SIGHT CHECKS PASS');
process.exit(fails ? 1 : 0);
