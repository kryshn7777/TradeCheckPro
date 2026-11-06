// MASON_BODY_SIGHT_LEASH.md (Node): "If the player moves too far, it might escape, but it takes damage and comes back."
// The REAL Creature3D + MasonSense on the stub shaft, seeded, 60 Hz. The player stands on the s6 ledge (a lethal hunt); the gap that a
// fleeing player opens is made by PINNING the Mason's crown / front blocks where the test wants it before each update (the sense reads
// them first thing in Creature3D.update; everything after that is the real creature).
//   the numbers: leashFar 1.3 x sightRange, leashLost = sightRange, heal 12 / 10 / 8 s
//   far: a chase beyond leashFar -> creature:leash, creature:hurt {source:'leash'}, stats.leashWounds, the chase off ('leash'), it
//        withdraws harmless and leaves play, heals in `heal` s, comes back (gate off: from above, hunting) and needs a fresh notice
//   lost far: the memory runs out beyond leashLost -> the wound; lost near (the hood at 20 m, a wall at 15 m) -> no wound ('lost')
//   no wound for a rest, a knocker decoy; never frightened, the weapons' diminishing window untouched, never kills, never weakens
//   the gate on (a well player): the return is a prowl pass at once after the heal
//   scripted (setScripted): no wound, stats.leashSkips; a respawn forgets the wound; determinism
//   node leash.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, FRIGHT } = await import(srcUrl('sim/creature3d.js'));
const { SIGHT_TUNE, LEASH } = await import(srcUrl('sim/masonSight.js'));
const { captionForEvent } = await import(srcUrl('ui/captions.js'));
const { WEAPON_ROUTES } = await import(srcUrl('audio/weaponSfx.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const KEYS = ['normal', 'nightmare', 'abyss'];
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const LEDGE = { x: -14.4, y: -343.1, z: -4 };
const KNOCK = { x: -7, y: -329.9, z: 14.4 };
const EVENTS = ['creature:notice', 'creature:sight', 'creature:leash', 'creature:leash:end', 'creature:hurt', 'creature:frighten', 'creature:distracted', 'creature:decoy:end'];

function mk(key, seed, opts = {}) {
  const L = new Level3D(makeShaftData(), key);
  const bus = new EventBus();
  const w = { L, bus, t: 0, ev: [], pin: null };
  for (const e of EVENTS) bus.on(e, (p) => w.ev.push({ t: w.t, type: e, p: Object.assign({}, p) }));
  w.c = new Creature3D(L, DIFFICULTY[key], bus, { seed });
  w.p = { x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true };
  if (opts.gate) {
    w.c.setHuntGate(true);
    w.c.setHurt(false);
  }
  w.c.reset(w.p);
  if (!opts.first) {
    w.c.sense._first = false; // the section's first-sighting warning already spent
    w.c.sense._sec = w.c.sectionIndex;
  }
  w.step = (n, each) => {
    for (let i = 0; i < n; i++) {
      w.t += DT;
      if (each && each(w) === false) return false;
      if (opts.gate) w.c.setHurt(false);
      w.c.immune = true; // watch it, never get hit (the strikes are not the subject here)
      if (w.pin) w.put(w.pin.x, w.pin.y, w.pin.z);
      w.c.update(DT, w.p, w.t);
    }
    return true;
  };
  w.put = (x, y, z) => {
    const c = w.c;
    const sp = c.body.spine;
    c.x = x;
    c.y = y;
    c.z = z;
    for (let i = 0; i < 3; i++) {
      sp[i * 3] = x;
      sp[i * 3 + 1] = y;
      sp[i * 3 + 2] = z;
    }
  };
  w.chase = () => w.step(60 * 40, (x) => !x.c.sight.chasing) === false || w.c.sight.chasing;
  w.count = (type, pred) => w.ev.filter((e) => e.type === type && (!pred || pred(e.p))).length;
  w.first = (type, pred) => w.ev.find((e) => e.type === type && (!pred || pred(e.p)));
  w.after = (t, type, pred) => w.ev.find((e) => e.t >= t && e.type === type && (!pred || pred(e.p)));
  return w;
}

// ---- 1. the numbers ------------------------------------------------------------------------------------------------------------
{
  const heal = { normal: 12, nightmare: 10, abyss: 8 };
  ok(KEYS.every((k) => Math.abs(SIGHT_TUNE[k].leashFar - 1.3 * SIGHT_TUNE[k].sightRange) < 0.6 && SIGHT_TUNE[k].leashLost === SIGHT_TUNE[k].sightRange && SIGHT_TUNE[k].heal === heal[k]), `leashFar ${KEYS.map((k) => SIGHT_TUNE[k].leashFar).join(' / ')} m (1.3 x sightRange), leashLost = sightRange, heal 12 / 10 / 8 s`);
  ok(LEASH.amount === 1 && KEYS.every((k) => SIGHT_TUNE[k].heal < FRIGHT.window && SIGHT_TUNE[k].leashFar > SIGHT_TUNE[k].sightRange), "one wound per escape; leashFar past the lantern's range; the heal far shorter than the weapons' 90 s window");
}

// ---- 2. far: beyond leashFar -> the wound, the withdraw, the heal, the return ----------------------------------------------------
const farRun = (k, seed) => {
  const w = mk(k, seed);
  const T = SIGHT_TUNE[k];
  const r = { k, chased: w.chase() };
  r.tChase = w.t;
  // the player is away: the gap opens past the leash (the crown pinned leashFar + 4 m above him, in the open shaft) for one update
  w.pin = { x: 0, y: LEDGE.y + T.leashFar + 4, z: 0 };
  w.step(1);
  w.pin = null;
  r.leash = w.first('creature:leash');
  r.hurt = w.first('creature:hurt');
  r.off = w.first('creature:sight', (p) => p.on === false);
  r.wounds = w.c.stats.leashWounds;
  r.heal0 = w.c.woundHeal;
  r.lethal0 = w.c.lethal;
  r.state0 = w.c.state;
  r.frightened = w.c.frightened;
  r.frightN = w.c._frightN;
  r.frightLast = w.c._frightLast;
  r.full = w.c.frightFor(40);
  const tW = w.t;
  let tOut = -1;
  let tBack = -1;
  let lethalWhile = false;
  let seenWhile = false;
  w.step(60 * (T.heal + 12), (x) => {
    if (x.c.woundHeal > 0 && x.c.lethal) lethalWhile = true;
    if (x.c.woundHeal > 0 && x.c.sight.sees) seenWhile = true;
    if (tOut < 0 && !x.c.inPlay) tOut = x.t - tW;
    if (tOut > 0 && tBack < 0 && x.c.inPlay) tBack = x.t - tW;
  });
  r.tOut = tOut;
  r.tBack = tBack;
  r.lethalWhile = lethalWhile;
  r.seenWhile = seenWhile;
  r.end = w.first('creature:leash:end');
  r.endT = r.end ? r.end.t - tW : -1;
  // after the return it must notice again before it chases (a fresh 0.5 s beat)
  w.step(60 * 30, (x) => !(x.c.sight.chasing && x.t > tW + T.heal));
  const re = w.after(tW + 0.1, 'creature:sight', (p) => p.on);
  const reN = w.after(tW + T.heal - 0.01, 'creature:notice');
  r.reChase = re ? re.t - tW : -1;
  r.renotice = !!(re && reN && reN.t <= re.t - T.notice + 1e-6);
  r.w = w;
  return r;
};
{
  let good = true;
  let back = true;
  const rows = [];
  for (const k of KEYS) {
    for (let seed = 1; seed <= 3; seed++) {
      const r = farRun(k, seed);
      const T = SIGHT_TUNE[k];
      const g =
        r.chased &&
        r.leash &&
        r.leash.p.distance > T.leashFar &&
        r.leash.p.heal === T.heal &&
        r.hurt &&
        r.hurt.p.source === 'leash' &&
        r.hurt.p.amount === LEASH.amount &&
        r.off &&
        r.off.p.reason === 'leash' &&
        r.wounds === 1 &&
        Math.abs(r.heal0 - T.heal) < 2 * DT &&
        !r.lethal0 &&
        (r.state0 === 'RECOVERING' || r.state0 === 'DORMANT') && // (the withdraw climb; already past withdrawFar 60 m: out of play at once)
        r.frightened === 0 &&
        !r.lethalWhile &&
        !r.seenWhile;
      if (!g) {
        good = false;
        console.log('  ', k, seed, JSON.stringify({ chased: r.chased, leash: !!r.leash, d: r.leash && r.leash.p.distance, hurt: r.hurt && r.hurt.p, off: r.off && r.off.p.reason, wounds: r.wounds, heal0: r.heal0, lethal0: r.lethal0, state0: r.state0, fr: r.frightened, lw: r.lethalWhile, sw: r.seenWhile }));
      }
      // out of play while it heals, back in play at the heal (gate off: from above, hunting), and a fresh notice before any chase
      const b = r.tOut > 0 && r.tOut < T.heal && Math.abs(r.endT - T.heal) < 2 * DT && r.tBack > 0 && r.tBack <= T.heal + 1 && (r.reChase < 0 || r.renotice);
      if (!b) back = false;
      if (seed === 1) rows.push(`${k}: wound at ${f2(r.leash ? r.leash.p.distance : -1)} m, out of play after ${f2(r.tOut)} s, healed ${f2(r.endT)} s, in play again ${f2(r.tBack)} s, chased again ${f2(r.reChase)} s`);
    }
  }
  ok(good, `beyond leashFar: creature:leash + creature:hurt {source:'leash', amount 1} + stats.leashWounds 1, the chase off ('leash'), RECOVERING (the withdraw) and harmless, never seen while it heals (3 seeds x 3 difficulties)`);
  ok(back, `it withdraws out of play, heals in 12 / 10 / 8 s and comes back hunting; it chases again only after a fresh notice (${rows.join('; ')})`);
  const r = farRun('normal', 2);
  ok(r.frightN === 0 && r.frightLast === -1e9 && r.full === 40 && r.frightened === 0, `never a fright: the weapons' diminishing window untouched (a grenade right after it gets the full ${f2(r.full)} s)`);
  // the caption + the sound route
  ok(captionForEvent('creature:leash', r.leash.p) && /strains/.test(captionForEvent('creature:leash', r.leash.p).text), `the caption: ${captionForEvent('creature:leash', r.leash.p).text}`);
  ok(typeof WEAPON_ROUTES['creature:leash'] === 'function', "the pained screech + the withdrawing rumble: a 'creature:leash' route in audio/weaponSfx.js");
}

// ---- 3. lost far vs lost near -------------------------------------------------------------------------------------------------
{
  let good = true;
  const rows = [];
  for (const k of KEYS) {
    const T = SIGHT_TUNE[k];
    const w = mk(k, 3);
    w.chase();
    // lantern lit, the crown between leashLost and leashFar: out of the light's range, not past the leash: the memory runs out
    w.pin = { x: 0, y: LEDGE.y + (T.leashLost + T.leashFar) / 2, z: 0 };
    const t0 = w.t;
    w.step(60 * (T.memory + 1), (x) => x.c.sight.chasing || x.c.woundHeal <= 0);
    w.pin = null;
    const l = w.first('creature:leash');
    const held = l ? l.t - t0 : -1;
    if (!(l && w.first('creature:sight', (p) => p.on === false).p.reason === 'leash' && held >= T.memory - 1e-6 && held <= T.memory + 0.15)) good = false;
    rows.push(`${k} ${f2(held)} s`);
  }
  ok(good, `the memory runs out beyond leashLost (lit, out of the light's range): a leash escape after memory 3 / 3 / 4 s (${rows.join(', ')})`);

  // near: the hood at 20 m (beyond bodyRange, inside leashLost) and a wall at 15 m: the plain 'lost', no wound, the cooldown
  let near = true;
  const nr = [];
  for (const k of KEYS) {
    for (const how of ['hood', 'wall']) {
      const w = mk(k, 3);
      w.chase();
      if (how === 'hood') {
        w.c.setSight(true, false, false);
        w.pin = { x: LEDGE.x + 20, y: LEDGE.y + 1, z: LEDGE.z };
      } else w.pin = { x: LEDGE.x - 15, y: LEDGE.y + 1, z: LEDGE.z }; // behind the -X wall
      w.step(60 * (SIGHT_TUNE[k].memory + 1));
      w.pin = null;
      const off = w.first('creature:sight', (p) => p.on === false);
      const g = off && off.p.reason === 'lost' && w.count('creature:leash') === 0 && w.c.stats.leashWounds === 0 && w.c.sense._coolT > 0;
      if (!g) near = false;
      nr.push(`${k}/${how} ${off ? off.p.reason : '-'}`);
    }
  }
  ok(near, `a chase lost to the hood (20 m) or to a wall (15 m) is NOT a leash escape: 'lost', no wound, the cooldown (${nr.join(', ')})`);
}

// ---- 4. a rest, a knocker, scripted, a respawn, never kills ---------------------------------------------------------------------
{
  const w = mk('normal', 3);
  w.chase();
  w.c.setRefuge(1, null);
  w.step(30);
  w.pin = { x: 0, y: LEDGE.y + 45, z: 0 }; // and then far away
  w.step(60 * 4, (x) => x.c.setRefuge(1, null));
  w.pin = null;
  ok(w.count('creature:leash') === 0 && w.c.stats.leashWounds === 0 && w.first('creature:sight', (p) => p.on === false).p.reason === 'blocked', "a Masons' rest ends the chase ('blocked'): no wound, even far away after");

  const k2 = mk('normal', 3);
  k2.chase();
  let acc = false;
  k2.step(60 * 6, (x) => {
    if (!acc && x.c.distance > SIGHT_TUNE.normal.decoyOverride + 1) acc = x.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 9 });
  });
  ok(acc && !k2.c.sight.chasing && k2.count('creature:leash') === 0 && k2.c.stats.leashWounds === 0, 'a knocker decoy ends the chase: no wound');

  const s = mk('normal', 3);
  s.chase();
  s.c.setScripted(true); // the S5 keystone / S7 arena objective open
  s.pin = { x: 0, y: LEDGE.y + 45, z: 0 };
  s.step(1);
  s.pin = null;
  s.step(60 * 2);
  ok(s.count('creature:leash') === 0 && s.c.stats.leashWounds === 0 && s.c.stats.leashSkips === 1 && s.c.woundHeal === 0 && s.first('creature:sight', (p) => p.on === false).p.reason === 'lost' && s.c.inPlay, 'a scripted beat (setScripted): the leash only drops the chase (\'lost\'): no wound, stats.leashSkips 1, it stays in play');

  const r = mk('normal', 3);
  r.chase();
  r.pin = { x: 0, y: LEDGE.y + 45, z: 0 };
  r.step(1);
  r.pin = null;
  const healing = r.c.woundHeal > 0;
  r.c.onRespawn(r.p);
  ok(healing && r.c.woundHeal === 0 && r.c.stats.leashWounds === 1, 'a respawn forgets a healing wound (the stats stay)');

  // five escapes in a row: it never dies, never weakens (the same chase speed), only counts
  const m = mk('normal', 4);
  const pursue = m.c.k.pursue;
  let n = 0;
  for (let i = 0; i < 5; i++) {
    if (!m.chase()) break;
    m.pin = { x: 0, y: LEDGE.y + 45, z: 0 };
    m.step(1);
    m.pin = null;
    m.step(60 * (SIGHT_TUNE.normal.heal + 2));
    n++;
  }
  ok(n === 5 && m.c.stats.leashWounds === 5 && m.c.wounds === 5 && m.c.active && m.c.k.pursue === pursue && m.c.sense.tune.pursueMul === SIGHT_TUNE.normal.pursueMul, `five escapes: five wounds (wounds ${m.c.wounds}), still active, the same pursue speed ${pursue} m/s: never killed, never weakened`);
}

// ---- 5. the gate on (a well player): the return is a prowl pass at once ---------------------------------------------------------
{
  let good = true;
  const rows = [];
  for (const k of KEYS) {
    const T = SIGHT_TUNE[k];
    const w = mk(k, 3, { gate: true });
    // the first pass comes, sees him, chases (the gate arms through the chase)
    w.step(60 * 80, (x) => !x.c.sight.chasing);
    const chased = w.c.sight.chasing;
    w.pin = { x: 0, y: LEDGE.y + T.leashFar + 4, z: 0 };
    w.step(1);
    w.pin = null;
    const tW = w.t;
    const p0 = w.c.stats.prowls;
    let tPass = -1;
    w.step(60 * (T.heal + 5), (x) => {
      if (tPass < 0 && x.c.stats.prowls > p0) tPass = x.t - tW;
    });
    const g = chased && w.c.stats.leashWounds === 1 && tPass >= T.heal - 2 * DT && tPass <= T.heal + 2 * DT;
    if (!g) good = false;
    rows.push(`${k}: a new pass ${f2(tPass)} s after the wound`);
  }
  ok(good, `the hunt gate on, a well player: after the heal the next prowl pass starts at once (not after the 50-80 s gap) (${rows.join('; ')})`);
}

// ---- 6. determinism --------------------------------------------------------------------------------------------------------------
{
  const a = farRun('nightmare', 5);
  const b = farRun('nightmare', 5);
  const sa = JSON.stringify(a.w.ev);
  ok(sa === JSON.stringify(b.w.ev) && a.w.ev.length > 4, `deterministic: the same seed gives the same event stream (${a.w.ev.length} events)`);
}

console.log(fails ? `FAILED: ${fails}` : 'ALL LEASH CHECKS PASS');
process.exit(fails ? 1 : 0);
