// THE SOLDIERS' WEAPONS x THE MASON (Node, plans/SOLDIER_WEAPONS.md): the grenade and the service revolver (sim/weapons3d.js) against the
// REAL Creature3D (hurt / frighten / hearShot / rayHit) and the REAL SkitterGroup on the stub shaft, seeded, 60 Hz. No stub creature.
//   the grenade frightens + hurts the Mason: it withdraws and stays out of play for the stated time (40 / 32 / 24 s), then hunts again;
//   a revolver round: the same at x0.7; repeated hits within 90 s diminish (never 0, never a free removal); a scripted beat (an override,
//   setScripted, the S5 lure niche) only staggers it; a Masons' rest stays safe through it all; hunters die (blast and round) and stay
//   dead in the section; a miss is LOUD (hearShot); the self rule (lethal within 2 m with a clear line, damped through masonry); the fire
//   cooldown, the rounds and the dry click; the hit volumes (generous, never through a wall); determinism; no allocation per frame.
//   node weapons.mjs [--root DIR]
import v8 from 'node:v8';
import vm from 'node:vm';
import fs from 'node:fs';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, FRIGHT } = await import(srcUrl('sim/creature3d.js'));
const { SkitterGroup } = await import(srcUrl('sim/skitter3d.js'));
const { Weapons3D, WEAPONS, GSTATE, withdrawFor, blastEffect, selfDamage } = await import(srcUrl('sim/weapons3d.js'));
const { Inventory3D, ITEM } = await import(srcUrl('sim/inventory3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const LEDGE = { x: -14.4, y: -343.1, z: -4 }; // stub s6 (hunt, lethal), as tests/creature/sight.mjs
const CTX = { dead: false, busy: false };
const EYE = CONFIG.player.eyeHeight;

function world(key, seed, opts = {}) {
  const L = new Level3D(makeShaftData(), key);
  const bus = new EventBus();
  const w = { L, bus, t: 0, ev: [] };
  for (const e of ['creature:frighten', 'creature:frighten:end', 'creature:hurt', 'creature:attack', 'creature:strike', 'creature:annoyed', 'grenade:blast', 'revolver:fire', 'revolver:dry', 'weapon:hit', 'weapon:refuse', 'skitter:killed', 'grenade:fizz']) bus.on(e, (p) => w.ev.push({ t: w.t, type: e, p: Object.assign({}, p) }));
  w.c = new Creature3D(L, DIFFICULTY[key], bus, { seed, sight: opts.sight });
  if (opts.gate) w.c.setHuntGate(true); // (before the reset: as the game does)
  w.p = { x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true };
  w.c.reset(w.p);
  w.c.sense._first = false; // the section's first-notice warning consumed (as sight.mjs)
  w.c.sense._sec = w.c.sectionIndex;
  w.sk = opts.skitters ? new SkitterGroup(L, DIFFICULTY[key], bus, { seed: seed + 1 }) : null;
  w.wp = new Weapons3D(bus);
  w.wp.diffKey = key;
  w.step = (n, each) => {
    for (let i = 0; i < n; i++) {
      w.t += DT;
      if (each && each(w) === false) return false;
      w.wp.update(DT, L, w.c, w.sk, null, w.p);
      w.c.update(DT, w.p, w.t);
      if (w.sk) w.sk.update(DT, w.p, w.t);
    }
    return true;
  };
  w.count = (type, pred) => w.ev.filter((e) => e.type === type && (!pred || pred(e.p))).length;
  w.last = (type) => {
    for (let i = w.ev.length - 1; i >= 0; i--) if (w.ev[i].type === type) return w.ev[i];
    return null;
  };
  return w;
}

/** A grenade lying at (x, y, z) that goes off on the next update. */
function blastAt(w, x, y, z) {
  w.wp.cooldown = 0;
  w.wp.tryThrow(null, CTX, x, y, z, 0, 0, 0);
  const s = w.wp.slots.find((q) => q.state === GSTATE.FLIGHT);
  s.state = GSTATE.REST;
  s.x = x;
  s.y = y;
  s.z = z;
  s.fuse = 1e-6;
  w.wp.update(DT, w.L, w.c, w.sk, null, w.p);
}

/** A round from the player's eye at the Mason's crown. */
function shootMason(w, inv = null) {
  w.wp.fireCooldown = 0;
  const ox = w.p.x;
  const oy = w.p.y + EYE;
  const oz = w.p.z;
  const dx = w.c.x - ox;
  const dy = w.c.y - oy;
  const dz = w.c.z - oz;
  const l = len3(dx, dy, dz);
  return w.wp.fire(inv, CTX, ox, oy, oz, dx / l, dy / l, dz / l, w.L, w.c, w.sk);
}

/** Steps until the Mason is in play, hunting and in a clear line from the player's eye (the shot can reach it). */
function huntUntilVisible(w, max = 60 * 30) {
  return !w.step(max, (x) => !(x.c.inPlay && x.c.lethal && x.c.distance < 40 && !x.L.segmentBlocked(x.p.x, x.p.y + EYE, x.p.z, x.c.x, x.c.y, x.c.z, 0.3)));
}

// ---- 1. the grenade frightens the Mason: it withdraws and stays away for the stated time -------------------------------------------
for (const key of ['normal', 'nightmare', 'abyss']) {
  const w = world(key, 3);
  w.step(60 * 5);
  ok(w.c.inPlay && w.c.lethal, `${key}: the Mason is out and hunting before the throw`);
  w.c.nearestPoint(w.c.x, w.c.y, w.c.z, (w.np = { x: 0, y: 0, z: 0, d: 0 }));
  blastAt(w, w.c.x, w.c.y, w.c.z);
  const fr = w.last('creature:frighten');
  const want = withdrawFor(key, 'grenade');
  ok(!!fr && !fr.p.stagger && Math.abs(fr.p.withdraw - want) < 1e-6, `${key}: a blast on its body frightens it for the full ${want} s (${fr ? f1(fr.p.withdraw) : '-'} s)`);
  ok(w.count('creature:hurt') === 1 && w.c.stats.hurts === 1 && w.c.wounds > 0, `${key}: and hurts it (creature:hurt, stats.hurts 1, wounds ${f1(w.c.wounds)})`);
  ok(!w.c.lethal && w.c.state === 'RECOVERING' && w.c.inPlay, `${key}: at once harmless, recoiling (RECOVERING), climbing away in view (no pop)`);
  let outAt = -1;
  let attacks = 0;
  let caught = false;
  let backAt = -1;
  const t0 = w.t;
  const a0 = w.count('creature:attack');
  w.step(60 * (want + 25), (x) => {
    if (outAt < 0 && !x.c.inPlay) outAt = x.t - t0;
    if (outAt >= 0 && backAt < 0 && x.c.inPlay) backAt = x.t - t0;
    if (backAt < 0 && x.c.caughtPlayer) caught = true;
    if (backAt < 0) attacks = x.count('creature:attack') - a0;
  });
  ok(outAt >= 0 && outAt < 10, `${key}: it leaves play within the withdraw climb (${f1(outAt)} s)`);
  ok(attacks === 0 && !caught, `${key}: no attack and no kill while frightened (${attacks} attacks${caught ? ', caught' : ''})`);
  if (attacks) console.log(w.ev.filter((e) => e.type === 'creature:attack').map((e) => f1(e.t - t0)).join(' '));
  ok(backAt >= want - 0.05 && backAt < want + 1, `${key}: it does not come back for the stated time, then hunts again from above (${f1(backAt)} s, want ${want})`);
  ok(w.count('creature:frighten:end') === 1 && w.c.frightened === 0, `${key}: creature:frighten:end once`);
}

// ---- 2. a revolver round: the same at x0.7, from the shooter's position -------------------------------------------------------------
{
  const w = world('normal', 5);
  ok(huntUntilVisible(w), 'the Mason in a clear line from the eye');
  const inv = new Inventory3D(null);
  inv.add(ITEM.SIDEARM, 6);
  const hit = shootMason(w, inv);
  const fr = w.last('creature:frighten');
  ok(hit === 'mason' && inv.counts[ITEM.SIDEARM] === 5, `a round at the crown hits the Mason (${hit}), one round spent`);
  ok(!!fr && Math.abs(fr.p.withdraw - 40 * WEAPONS.revolver.shotMul) < 1e-6 && fr.p.source === 'shot', `the withdraw is 0.7 x the grenade's (${fr ? f1(fr.p.withdraw) : '-'} s)`);
  const h = w.last('weapon:hit');
  ok(!!h && h.p.target === 'mason' && w.count('creature:hurt') === 1, 'weapon:hit {target mason} + creature:hurt');
  ok(w.c.stats.heardShots === 0, 'a hit is not also a "heard" shot (it is fleeing)');
}

// ---- 3. diminishing returns (never 0, never a free removal) --------------------------------------------------------------------------
{
  const w = world('normal', 6);
  w.step(60 * 5);
  const got = [];
  for (let i = 0; i < 4; i++) {
    got.push(w.c.frighten(40, 'grenade', w.c.x, w.c.z));
    w.step(60 * 5);
  }
  const want = [40, 40 * FRIGHT.decay, 40 * FRIGHT.decay * FRIGHT.decay, 40 * FRIGHT.dimFloor];
  const each = [40, 24, 14.4, 12];
  ok(got[0] === 40, `the first fright: 40 s`);
  // later frights extend the one running only when longer: the read-out is the longest; frightFor shows the diminished lengths
  const w2 = world('normal', 6);
  w2.step(60 * 5);
  const lens = [];
  for (let i = 0; i < 5; i++) {
    lens.push(w2.c.frightFor(40));
    w2.c.frighten(40, 'grenade', w2.c.x, w2.c.z);
    w2.step(60 * 10);
  }
  ok(lens.slice(0, 4).every((v, i) => Math.abs(v - each[i]) < 1e-9) && lens[4] === 12, `repeated hits within 90 s give 40, 24, 14.4, 12, 12 s (${lens.map(f1).join(', ')})`);
  ok(want[3] > 0 && lens.every((v) => v >= FRIGHT.minFright), 'never below the floor (0.3 x) nor the 5 s minimum: never 0');
  w2.c._frightT = 0.01;
  w2.step(60 * 95); // 90 s apart: it forgets
  ok(Math.abs(w2.c.frightFor(40) - 40) < 1e-9, `after 90 s quiet the full 40 s again (${f1(w2.c.frightFor(40))})`);
  ok(w2.c.stats.frights === 5, `stats.frights counts them (${w2.c.stats.frights})`);
}

// ---- 4. a scripted beat only staggers it -----------------------------------------------------------------------------------------
{
  const cases = [
    ['an objective override (S7 escape)', (w) => w.c.setOverride({ mode: 'escape' }, w.c.sectionIndex)],
    ['setScripted (the S5 keystone / the S7 arena)', (w) => w.c.setScripted(true)],
    ['the S5 lure niche (refuge 2)', (w) => w.c.setRefuge(2, null)],
  ];
  for (const [name, set] of cases) {
    const w = world('normal', 7);
    w.step(60 * 5);
    set(w);
    w.step(30);
    ok(w.c.inPlay, `${name}: in play`);
    const r = w.c.frighten(40, 'grenade', w.c.x, w.c.z);
    const fr = w.last('creature:frighten');
    ok(r === 0 && fr && fr.p.stagger === true && w.c.frightened === 0 && w.c.stats.staggers === 1, `${name}: frighten only staggers (no withdraw)`);
    ok(w.c.state === 'RECOVERING' && w.c.attack.phase === null, `${name}: the recoil (RECOVERING, a strike broken off)`);
    let left = false;
    w.step(60 * 6, (x) => {
      if (!x.c.inPlay) left = true;
    });
    ok(!left && w.c.state !== 'RECOVERING', `${name}: it never leaves play and is back at it in a moment (${w.c.state})`);
  }
}

// ---- 5. a Masons' rest stays safe -----------------------------------------------------------------------------------------------
{
  const w = world('normal', 8);
  w.step(60 * 5);
  w.c.setRefuge(1, null);
  const r = w.c.frighten(withdrawFor('normal', 'grenade'), 'grenade', w.c.x, w.c.z);
  ok(r === 40, 'in a rest the fright works as anywhere (not a scripted beat)');
  const a0 = w.count('creature:attack');
  w.step(60 * 55);
  ok(w.count('creature:attack') === a0 && !w.c.caughtPlayer, 'through the fright and after it, no attack starts on a player in the rest');
  ok(w.c.inPlay && w.c.refuge === 1, 'it came back and the rest rules hold');
}

// ---- 6. the hunt gate: no prowl pass, no arming while frightened ----------------------------------------------------------------
{
  const w = world('normal', 9, { gate: true });
  w.c.setHurt(true);
  w.step(60 * 6);
  ok(w.c.inPlay && w.c.lethal, 'gated + hurt: it hunts');
  w.c.frighten(40, 'grenade', w.c.x, w.c.z);
  const prowls = w.c.stats.prowls;
  let inPlayLate = false;
  w.step(60 * 38, (x) => {
    if (x.t > 0 && x.c.frightened > 0 && x.c.frightened < 30 && x.c.inPlay) inPlayLate = true;
  });
  ok(!inPlayLate && w.c.stats.prowls === prowls, 'gated, hurt: frightened it stays out (the gate armed by the wound does not bring it back), no prowl pass starts');
  w.step(60 * 6);
  ok(w.c.inPlay && w.c.frightened === 0, 'after the fright the wound brings it back');
  // well: the prowl waits its `first` s after the fright
  const w2 = world('normal', 9, { gate: true });
  w2.step(60 * 25, (x) => !(x.c.stats.prowls > 0 && x.c.inPlay));
  ok(w2.c.stats.prowls === 1 && w2.c.inPlay, 'well: a prowl pass comes');
  w2.c.frighten(40, 'grenade', w2.c.x, w2.c.z);
  ok(!w2.c._prowling && w2.c._withdraw && !w2.c.lethal, 'a fright ends the pass (it climbs away, harmless)');
  let back = -1;
  const t0 = w2.t;
  w2.step(60 * 80, (x) => {
    if (back < 0 && x.c.frightened === 0 && x.c.inPlay && !x.c._withdraw) back = x.t - t0;
  });
  ok(back >= 40, `the next pass only after the fright and the prowl wait (${f1(back)} s)`);
}

// ---- 7. a shot is LOUD (sound, not sight) -----------------------------------------------------------------------------------------
{
  const w = world('normal', 11, { sight: false });
  w.step(60 * 5);
  w.c._setState('OBSERVING');
  w.c.listening = true;
  w.wp.fireCooldown = 0;
  // fire away from it (into the wall behind the player)
  const hit = w.wp.fire(null, CTX, w.p.x, w.p.y + EYE, w.p.z, -1, 0, 0, w.L, w.c, null);
  ok(hit === 'wall', `a round into the wall is a miss (${hit})`);
  ok(w.c.stats.heardShots === 1 && w.c.state === 'PURSUING' && !w.c.listening && w.wp.stats.heard === 1, 'the Mason heard it: it stops listening and comes for the shooter');
  ok(w.count('creature:annoyed', (p) => p.shot === true) === 1, 'annoyed (faster for a moment)');
  // out of play, gated: the next prowl pass comes soon
  const w2 = world('normal', 12, { gate: true });
  w2.step(60 * 2);
  ok(!w2.c.inPlay && w2.c._prowlT > FRIGHT.rouse, 'gated and well: no pass yet');
  w2.wp.fire(null, CTX, w2.p.x, w2.p.y + EYE, w2.p.z, -1, 0, 0, w2.L, w2.c, null);
  ok(Math.abs(w2.c._prowlT - FRIGHT.rouse) < 1e-9, `a shot rouses it: the pass comes within ${FRIGHT.rouse} s`);
  // frightened: nothing
  const w3 = world('normal', 13);
  w3.step(60 * 5);
  w3.c.frighten(40, 'grenade', w3.c.x, w3.c.z);
  ok(w3.c.hearShot(w3.p.x, w3.p.y, w3.p.z) === '', 'frightened: a shot is not heard');
}

// ---- 8. hunters die -------------------------------------------------------------------------------------------------------------
{
  const w = world('normal', 14, { skitters: true });
  w.step(60 * 2);
  ok(w.sk.force(2, w.p) === 2, 'two skitterlings forced in');
  w.step(60 * 3);
  const a = w.sk.slots[0];
  const b = w.sk.slots[1];
  blastAt(w, a.x, a.y, a.z);
  ok(!a.on && w.sk.kills >= 1 && w.count('skitter:killed', (p) => p.source === 'grenade') >= 1, 'a blast on a skitterling kills it (skitter:killed, the splat)');
  ok(w.last('grenade:blast').p.skitters >= 1, 'grenade:blast counts it');
  if (b.on) {
    w.wp.fireCooldown = 0;
    const ox = w.p.x;
    const oy = w.p.y + EYE;
    const oz = w.p.z;
    const l = len3(b.x - ox, b.y - oy, b.z - oz);
    // only through a clear line
    if (!w.L.segmentBlocked(ox, oy, oz, b.x, b.y, b.z, 0.2)) {
      const hit = w.wp.fire(null, CTX, ox, oy, oz, (b.x - ox) / l, (b.y - oy) / l, (b.z - oz) / l, w.L, null, w.sk); // (the Mason left out: it may stand in the line)
      ok(hit === 'skitter' && !b.on, `a round kills a skitterling (${hit})`);
    } else ok(true, '(the second skitterling is behind masonry: the round check is skipped)');
  }
  const alive = w.sk.aliveCount;
  w.step(60 * 10);
  ok(w.sk.aliveCount <= alive, 'the dead stay out of the group in the section');
  w.sk.onRespawn(w.p);
  ok(w.sk._dead.every((v) => v === 0), 'a respawn forgets the dead');
}

// ---- 9. the self rule -----------------------------------------------------------------------------------------------------------
{
  ok(selfDamage(1.5, true) === 1 && selfDamage(1.9, true) === 1, 'within 2 m with a clear line: lethal (1.0)');
  ok(selfDamage(1.5, false) < 0.2, `within 2 m behind masonry: damped (${selfDamage(1.5, false).toFixed(2)})`);
  const d4 = selfDamage(4, true);
  ok(d4 > 0.15 && d4 < 0.45 && selfDamage(6.4, true) < 0.02 && selfDamage(7, true) === 0, `out to the radius it falls off (4 m ${d4.toFixed(2)}, 6.4 m ${selfDamage(6.4, true).toFixed(3)}, 7 m 0)`);
  ok(blastEffect(2) === 1 && Math.abs(blastEffect(6.5) - 0.55) < 1e-9 && blastEffect(7) === 0, 'the blast effect: 1 within 2.5 m, 0.55 at 6.5 m, 0 beyond');
  const w = world('normal', 15);
  blastAt(w, w.p.x + 1, w.p.y, w.p.z);
  ok(Math.abs(w.wp.takeDamage() - 1) < 1e-9 && w.wp.stats.selfLethal === 1 && w.last('grenade:blast').p.lethal, 'a grenade at your own feet: pendingDamage 1 (lethal)');
  ok(w.wp.takeDamage() === 0, 'takeDamage drains it');
}

// ---- 10. the fire cooldown, the rounds and the dry click ------------------------------------------------------------------------
{
  const w = world('normal', 16);
  const inv = new Inventory3D(null);
  ok(inv.add(ITEM.SIDEARM, 20) === 12, 'the revolver holds 12 rounds at most');
  inv.seed(ITEM.SIDEARM, 2);
  const fire = () => w.wp.fire(inv, CTX, w.p.x, w.p.y + EYE, w.p.z, -1, 0, 0, w.L, w.c, null);
  ok(fire() !== null && inv.counts[ITEM.SIDEARM] === 1, 'a shot spends a round');
  ok(fire() === null && w.wp.lastRefusal === 'cooldown', 'again at once: refused (cooldown 0.45 s)');
  w.step(Math.ceil(60 * WEAPONS.revolver.cooldown) + 1);
  ok(fire() !== null && inv.counts[ITEM.SIDEARM] === 0, 'after 0.45 s it fires');
  w.step(30);
  ok(fire() === null && w.wp.lastRefusal === 'empty' && w.count('revolver:dry') === 1, 'empty: refused with a dry click (revolver:dry)');
  ok(w.wp.fire(inv, { dead: true }, 0, 0, 0, 0, 0, -1, w.L, null, null) === null && w.wp.lastRefusal === 'dead', 'dead: refused');
  w.wp.enabled = false;
  inv.seed(ITEM.SIDEARM, 3);
  ok(fire() === null && w.wp.lastRefusal === 'off', 'off (the setting): refused');
  // the grenade's own refusals
  w.wp.enabled = true;
  ok(!w.wp.tryThrow(inv, CTX, 0, 0, 0, 0, 0, 0) && w.wp.lastRefusal === 'empty', 'no grenade in the bag: refused');
  inv.add(ITEM.GRENADE, 2);
  ok(w.wp.tryThrow(inv, CTX, w.p.x, w.p.y + 1, w.p.z, 0, 2, 0) && inv.counts[ITEM.GRENADE] === 1, 'a grenade thrown: one fewer');
  ok(!w.wp.tryThrow(inv, CTX, w.p.x, w.p.y + 1, w.p.z, 0, 2, 0) && w.wp.lastRefusal === 'cooldown', 'a second at once: cooldown');
}

// ---- 11. the fuse, the bounce and the contact --------------------------------------------------------------------------------------
{
  const w = world('normal', 17, { sight: false });
  w.wp.tryThrow(null, CTX, LEDGE.x, LEDGE.y + 1.5, LEDGE.z, 2.2, 3, 0.5); // a lob onto the ledge
  let blastT = -1;
  const t0 = w.t;
  w.step(60 * 3, (x) => {
    if (blastT < 0 && x.count('grenade:blast') > 0) blastT = x.t - t0;
  });
  ok(Math.abs(blastT - WEAPONS.grenade.fuse) < 0.05, `the fuse: it goes off ${f1(blastT)} s after the throw`);
  ok(w.count('grenade:fizz') >= 6, `it sizzles as it goes (${w.count('grenade:fizz')} fizz events)`);
  // a hard hit on the Mason goes off at once
  const w2 = world('normal', 18);
  w2.step(60 * 5);
  const c = w2.c;
  w2.wp.tryThrow(null, CTX, c.x + 3, c.y, c.z, -12, 0, 0);
  let t = -1;
  const t2 = w2.t;
  w2.step(60, (x) => {
    if (t < 0 && x.count('grenade:blast') > 0) t = x.t - t2;
  });
  ok(t >= 0 && t < 0.5, `thrown hard at the Mason it goes off on contact (${f1(t)} s)`);
}

// ---- 12. the hit volumes --------------------------------------------------------------------------------------------------------
{
  const w = world('normal', 19);
  ok(huntUntilVisible(w), 'the Mason in view');
  const c = w.c;
  const sp = c.body.spine;
  const ox = c.x - 10;
  const oy = c.y + 1.0;
  const oz = c.z;
  ok(c.rayHit(ox, oy, oz, 1, 0, 0, 30) > 0, 'a round passing 1 m over the crown still hits (generous volumes)');
  // a line along +X passing at least 4.5 m from every block misses (the volumes are generous, not huge)
  const clearOf = (y, z) => {
    let m = 1e9;
    for (let i = 0; i < 20; i++) m = Math.min(m, Math.hypot(sp[i * 3 + 1] - y, sp[i * 3 + 2] - z));
    return m;
  };
  let wide = null;
  for (let k = 0; k < 16 && !wide; k++) {
    const a = (k / 16) * Math.PI * 2;
    const y = c.y + Math.sin(a) * 5;
    const z = c.z + Math.cos(a) * 5;
    if (clearOf(y, z) >= 4.5) wide = [y, z];
  }
  ok(!!wide && c.rayHit(c.x - 15, wide[0], wide[1], 1, 0, 0, 30) < 0, 'a round passing 4.5 m clear of the body misses');
  ok(c.rayHit(ox, oy, oz, 1, 0, 0, 5) < 0, 'out of range: no hit');
  // a wall between: the level ray stops it (fire), the Mason is not hit
  const wx = -16 - 3; // inside the -X wall of the stub shaft
  const hit = w.wp.fire(null, CTX, wx - 2.5, c.y, c.z, 1, 0, 0, w.L, c, null);
  ok(hit !== 'mason', `never through masonry (${hit})`);
  c.body.visible = false;
  ok(c.rayHit(ox, oy, oz, 1, 0, 0, 30) < 0, 'not shown: nothing to hit');
}

// ---- 13. determinism --------------------------------------------------------------------------------------------------------------
{
  const run = () => {
    const w = world('nightmare', 21, { skitters: true });
    w.step(60 * 5);
    w.sk.force(1, w.p);
    w.step(60 * 2);
    w.wp.tryThrow(null, CTX, w.c.x + 2, w.c.y + 1, w.c.z, -3, 1, 0);
    w.step(60 * 4);
    shootMason(w);
    w.step(60 * 30);
    return w.ev.map((e) => e.type + e.t.toFixed(3)).join(',') + `|${w.c.x.toFixed(6)},${w.c.y.toFixed(6)},${w.c.z.toFixed(6)}|${w.c.stats.frights},${w.c.wounds.toFixed(6)}`;
  };
  const a = run();
  ok(a === run() && a.length > 40, 'deterministic with a seed (throw, fuse, blast, a round, the fright, the hunters)');
}

// ---- 14. untouched when never called -----------------------------------------------------------------------------------------------
{
  const run = (withWeapons) => {
    const L = new Level3D(makeShaftData(), 'normal');
    const c = new Creature3D(L, DIFFICULTY.normal, new EventBus(), { seed: 23 });
    const p = { x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true };
    c.reset(p);
    const wp = withWeapons ? new Weapons3D(null) : null;
    for (let i = 0; i < 60 * 40; i++) {
      p.x = LEDGE.x + Math.sin(i * 0.01) * 1.2;
      if (wp) wp.update(DT, L, c, null, null, p); // weapons idle: nothing thrown, nothing fired
      c.update(DT, p, i * DT);
    }
    return `${c.x},${c.y},${c.z},${c.state},${c.stats.attacks},${c.stats.bursts}`;
  };
  ok(run(false) === run(true), 'an idle weapons system changes nothing in the hunt (bit for bit)');
}

// ---- 15. no allocation per frame ---------------------------------------------------------------------------------------------------
{
  const src = fs.readFileSync(SRC_DIR + '/sim/weapons3d.js', 'utf8');
  const body = (name) => {
    const a = src.indexOf('\n  ' + name + '(');
    const b = src.indexOf('\n  }\n', a);
    return src.slice(a, b).replace(/this\._emit\([^;]*\);/g, '').replace(/\/\/[^\n]*/g, '');
  };
  const hot = ['update', '_fly', '_contact', '_blast', '_los', 'fire'].map(body).join('\n');
  const bad = [/\bnew\s/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.(map|filter|slice|concat|join|bind)\(/].filter((r) => r.test(hot));
  ok(hot.length > 3000 && bad.length === 0, `static: no allocation in update / _fly / _contact / _blast / _los / fire${bad.length ? ' — found ' + bad.join(' ') : ''}`);
  const csrc = fs.readFileSync(SRC_DIR + '/sim/creature3d.js', 'utf8');
  const cb = (name) => {
    const a = csrc.indexOf('\n  ' + name + '(');
    const b = csrc.indexOf('\n  }\n', a);
    return csrc.slice(a, b).replace(/this\._emit\([^;]*\);/g, '').replace(/\/\/[^\n]*/g, '');
  };
  const chot = ['rayHit', 'nearestPoint', 'frightFor', '_stagger'].map(cb).join('\n');
  const cbad = [/\bnew\s/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/].filter((r) => r.test(chot));
  ok(chot.length > 800 && cbad.length === 0, `static: the creature's hit tests allocate nothing${cbad.length ? ' — found ' + cbad.join(' ') : ''}`);
  // dynamic: 200 k frames of fizzing grenades in an allocation-free room (throw, bounce, fuse, blast) cost no young collections
  const { PerformanceObserver } = await import('node:perf_hooks');
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  let gcs = 0;
  const obs = new PerformanceObserver((l) => (gcs += l.getEntries().length));
  obs.observe({ entryTypes: ['gc'] });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const FLOOR = { minX: -12, maxX: 12, minY: -2, maxY: 0, minZ: -12, maxZ: 12, kind: 'stone', active: true };
  const hitR = { t: 0, solid: null, x: 0, y: 0, z: 0 };
  const room = {
    raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const uy = dy / l;
      if (!(uy < 0) || oy < 0) return null;
      const t = -oy / uy;
      if (t > maxDist) return null;
      const r = out || hitR;
      r.t = t;
      r.solid = FLOOR;
      r.x = ox + (dx / l) * t;
      r.y = 0;
      r.z = oz + (dz / l) * t;
      return r;
    },
    segmentBlocked() {
      return false;
    },
  };
  const wp = new Weapons3D(null);
  const pl = { x: 30, y: 0, z: 0, alive: true };
  const cycle = (frames) => {
    let n = 0;
    for (let i = 0; i < frames; i++) {
      if (wp.live === 0 && wp.cooldown <= 0) {
        wp.tryThrow(null, null, 0, 1.5, 0, 3 + (n % 4), 4, 1);
        n++;
      }
      wp.update(1 / 72, room, null, null, null, pl);
      if (i % 50 === 0) {
        wp.fireCooldown = 0;
        wp.fire(null, null, 0, 1.5, 0, 0.3, -1, 0.1, room, null, null);
      }
    }
    return n;
  };
  cycle(20000);
  gc();
  await settle();
  gcs = 0;
  const n = cycle(200000);
  await settle();
  obs.disconnect();
  ok(gcs <= 2 && n > 500 && wp.stats.blasts > 500 && wp.stats.shots > 3000, `200 k frames (${n} throws, ${wp.stats.blasts} blasts, ${wp.stats.shots} shots) cost ${gcs} young collections`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL WEAPONS x MASON CHECKS PASS');
process.exit(fails ? 1 : 0);
