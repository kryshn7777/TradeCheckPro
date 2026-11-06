// MASON_BODY_SIGHT_LEASH.md (Node): "Also see the body up close": within bodyRange (12 / 14 / 16 m) in a clear line the Mason sees the
// player's BODY whatever the lantern does (lit, hooded, empty); beyond it only the light shows. The REAL Creature3D + MasonSense on the
// stub shaft, seeded, 60 Hz.
//   pinned: the crown / front blocks put where the test wants them, the sense stepped frame by frame (Creature3D eligible: in play, no
//           grace, not resting): a hooded / empty-lantern player is noticed within bodyRange ('body'), commits 0.5 s later; not beyond
//           it (a lit one is, 'light'); the shaft wall blocks it; a Masons' rest stays safe; a live knocker decoy wins beyond
//           decoyOverride; covered mid-chase up close it keeps the chase (the body)
//   live:   a hooded player working along the s6 ledge, the whole creature running: it finds him by sound, then sees him only within
//           bodyRange (every notice 'body', in range)
//   the caption; determinism; no allocation in the sense's per-frame paths (static)
//   node body-sight.mjs [--root DIR]
import fs from 'node:fs';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D } = await import(srcUrl('sim/creature3d.js'));
const { SIGHT_TUNE } = await import(srcUrl('sim/masonSight.js'));
const { captionForEvent } = await import(srcUrl('ui/captions.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const KEYS = ['normal', 'nightmare', 'abyss'];
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const LEDGE = { x: -14.4, y: -343.1, z: -4 }; // s6 ledge against the -X wall (x -22..-16)
const KNOCK = { x: -7, y: -329.9, z: 14.4 };
const EVENTS = ['creature:notice', 'creature:sight', 'creature:distracted', 'creature:decoy:end'];

function mk(key, seed) {
  const L = new Level3D(makeShaftData(), key);
  const bus = new EventBus();
  const w = { L, bus, t: 0, ev: [] };
  for (const e of EVENTS) bus.on(e, (p) => w.ev.push({ t: w.t, type: e, p: Object.assign({}, p) }));
  w.c = new Creature3D(L, DIFFICULTY[key], bus, { seed });
  w.p = { x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true };
  w.c.reset(w.p);
  w.c.sense._first = false; // the section's first-sighting warning already spent
  w.c.sense._sec = w.c.sectionIndex;
  w.count = (type, pred) => w.ev.filter((e) => e.type === type && (!pred || pred(e.p))).length;
  w.first = (type, pred) => w.ev.find((e) => e.type === type && (!pred || pred(e.p)));
  return w;
}

/** Pinned: the crown + front blocks at (x, y, z) every frame, eligible (in play, no grace, not resting), the sense stepped alone. */
function pinned(key, seed, at, lit, frames, each) {
  const w = mk(key, seed);
  const c = w.c;
  c.inPlay = true;
  c.grace = 0;
  c._setState('APPROACHING');
  c.setSight(true, lit, false);
  const sp = c.body.spine;
  for (let i = 0; i < frames; i++) {
    w.t += DT;
    c.x = at.x;
    c.y = at.y;
    c.z = at.z;
    for (let j = 0; j < 3; j++) {
      sp[j * 3] = at.x;
      sp[j * 3 + 1] = at.y;
      sp[j * 3 + 2] = at.z;
    }
    c._px = w.p.x;
    c._py = w.p.y;
    c._pz = w.p.z;
    if (each && each(w, i) === false) break;
    c.grace = 0;
    c.sense.update(DT, w.p);
  }
  return w;
}
const along = (d) => ({ x: LEDGE.x + d, y: LEDGE.y, z: LEDGE.z }); // straight out across the open shaft (clear line)

// ---- 1. the numbers -----------------------------------------------------------------------------------------------------------
{
  const reach = (k) => DIFFICULTY[k].creature.killRadius * 1.6 + 3.5;
  const want = { normal: 12, nightmare: 14, abyss: 16 };
  ok(KEYS.every((k) => SIGHT_TUNE[k].bodyRange === want[k] && SIGHT_TUNE[k].bodyRange < SIGHT_TUNE[k].sightRange && SIGHT_TUNE[k].bodyRange > reach(k) && SIGHT_TUNE[k].bodyRange >= SIGHT_TUNE[k].lethalNear), `bodyRange 12 / 14 / 16 m: past every strike reach (${KEYS.map((k) => reach(k).toFixed(2)).join(' / ')} m) and lethalNear, well inside the lantern's range`);
}

// ---- 2. hooded / empty: seen within bodyRange, not beyond; lit beyond: the light -------------------------------------------------
{
  let good = true;
  const rows = [];
  for (const k of KEYS) {
    const B = SIGHT_TUNE[k].bodyRange;
    const near = pinned(k, 1, along(B - 2), false, 60 * 2);
    const n = near.first('creature:notice');
    const s = near.first('creature:sight', (p) => p.on);
    const dt = n && s ? s.t - n.t : -1;
    const far = pinned(k, 1, along(B + 3), false, 60 * 3);
    const lit = pinned(k, 1, along(B + 3), true, 60 * 2);
    const ln = lit.first('creature:notice');
    const g = n && n.p.by === 'body' && Math.abs(dt - SIGHT_TUNE[k].notice) < DT + 1e-6 && near.c.sight.by === 'body' && far.count('creature:notice') === 0 && !far.c.sight.sees && !far.c.sight.chasing && ln && ln.p.by === 'light' && lit.c.sight.chasing;
    if (!g) good = false;
    rows.push(`${k}: covered at ${B - 2} m noticed ('${n ? n.p.by : '-'}'), committed ${f2(dt)} s later; at ${B + 3} m unseen, lit there '${ln ? ln.p.by : '-'}'`);
  }
  ok(good, `a covered / empty lantern is seen within bodyRange in a clear line (the 0.5 s beat), never beyond it; a lit one beyond is seen by the light (${rows.join('; ')})`);
}

// ---- 3. a wall blocks the body sight; a Masons' rest is safe; the knocker wins beyond decoyOverride ----------------------------
{
  // the crown 10 m off behind the -X wall (x -22..-16): blocked
  const wall = pinned('normal', 1, { x: LEDGE.x - 10, y: LEDGE.y + 1, z: LEDGE.z }, false, 60 * 3);
  ok(wall.count('creature:notice') === 0 && !wall.c.sight.sees, 'the shaft wall between: the body is not seen at 10 m');
  const rest = pinned('normal', 1, along(6), false, 60 * 3, (w) => w.c.setRefuge(1, null));
  ok(rest.count('creature:notice') === 0 && !rest.c.sight.sees && !rest.c.sight.chasing, "hidden in a Masons' rest (refuge 1): never seen, even at 6 m");

  // a live knocker: a covered player 9 m off (beyond decoyOverride 5, inside bodyRange 12) is not seen; walking within 5 m ends it
  let acc = false;
  let seenWhile = false;
  const dk = pinned('normal', 1, along(9), false, 60 * 4, (w, i) => {
    if (i === 0) acc = w.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 9 });
    if (i > 0 && w.c.decoy.live && w.c.sight.sees) seenWhile = true;
  });
  const decoyHeld = acc && !seenWhile && dk.count('creature:notice') === 0 && dk.c.decoy.live;
  const dk2 = pinned('normal', 1, along(9), false, 60 * 2, (w, i) => {
    if (i === 0) w.c.distract(KNOCK.x, KNOCK.y, KNOCK.z, { duration: 9 });
    if (i === 30) w.p.x = LEDGE.x + 9 - (SIGHT_TUNE.normal.decoyOverride - 1); // walks up to it
  });
  const over = dk2.first('creature:decoy:end');
  ok(decoyHeld && over && over.p.reason === 'overridden' && dk2.first('creature:notice', (p) => p.by === 'body'), `a live knocker decoy wins beyond decoyOverride (a covered player at 9 m unseen for 4 s); walking within ${SIGHT_TUNE.normal.decoyOverride} m ends it and the body is seen`);
}

// ---- 4. covered mid-chase up close: it keeps the chase on the body ----------------------------------------------------------------
{
  let good = true;
  const rows = [];
  for (const k of KEYS) {
    let tCover = -1;
    const w = pinned(k, 2, along(8), true, 60 * 8, (x) => {
      if (tCover < 0 && x.c.sight.chasing) {
        tCover = x.t;
        x.c.setSight(true, false, false); // covered
      }
    });
    const held = w.c.sight.chasing && w.c.sight.by === 'body' && w.count('creature:sight', (p) => p.on === false) === 0;
    if (!(tCover > 0 && held)) good = false;
    rows.push(`${k} ${held ? 'kept' : 'lost'}`);
  }
  ok(good, `covered mid-chase at 8 m: it keeps chasing (it sees the body) past its memory (${rows.join(', ')})`);
}

// ---- 5. live: a hooded player on the ledge, the whole creature running ------------------------------------------------------------
const live = (k, seed) => {
  const w = mk(k, seed);
  w.c.setSight(true, false, false);
  let farSeen = 0;
  for (let i = 0; i < 60 * 60; i++) {
    w.t += DT;
    w.p.vx = Math.cos(w.t * 0.7) * 1.4; // works along the ledge (the sound hunt hears motion)
    w.p.x = LEDGE.x + Math.sin(w.t * 0.7) * 2;
    w.c.update(DT, w.p, w.t);
    if (w.c.sight.sees && (w.c.sight.by !== 'body' || w.c.distance > SIGHT_TUNE[k].bodyRange + 1)) farSeen++;
    if (w.c.caughtPlayer) {
      w.c.caughtPlayer = false;
      w.c.onRespawn(w.p);
    }
  }
  return { w, farSeen };
};
{
  let good = true;
  let found = 0;
  const rows = [];
  for (const k of KEYS) {
    for (let seed = 1; seed <= 3; seed++) {
      const { w, farSeen } = live(k, seed);
      const ns = w.ev.filter((e) => e.type === 'creature:notice');
      if (farSeen > 0 || ns.some((e) => e.p.by !== 'body' || e.p.distance > SIGHT_TUNE[k].bodyRange + 0.5)) good = false;
      if (ns.length) found++;
      if (seed === 1) rows.push(`${k}: ${ns.length} body notices (closest first at ${ns.length ? f2(ns[0].p.distance) : '-'} m), ${w.count('creature:sight', (p) => p.on)} chases`);
    }
  }
  ok(good, `live, covered on the ledge (60 s x 3 seeds x 3 difficulties): every sighting is the body, within bodyRange (${rows.join('; ')})`);
  ok(found >= 6, `... and the sound hunt brings it close enough to see him: ${found}/9 runs had a body notice (the hood no longer hides you up close)`);
}

// ---- 6. the caption, determinism, no allocation ---------------------------------------------------------------------------------
{
  const cb = captionForEvent('creature:notice', { by: 'body' });
  const cl = captionForEvent('creature:notice', { by: 'light' });
  ok(cb && cb.text === '[It sees you]' && cl && cl.text === '[It sees your light]', `captions: ${cb && cb.text} (the body) / ${cl && cl.text} (the light)`);
  const a = live('nightmare', 4).w.ev;
  const b = live('nightmare', 4).w.ev;
  ok(JSON.stringify(a) === JSON.stringify(b) && a.length > 0, `deterministic: the same seed gives the same event stream (${a.length} events)`);
  const src = fs.readFileSync(SRC_DIR + '/sim/masonSight.js', 'utf8');
  const body = (name) => {
    const s0 = src.indexOf('\n  ' + name + '(');
    const s1 = src.indexOf('\n  }\n', s0);
    return src.slice(s0, s1).replace(/c\._emit\([^;]*\);/g, '').replace(/\/\/[^\n]*/g, '').replace(/this\.endDecoy\([^)]*\)/g, '');
  };
  const hot = ['update', '_los'].map(body).join('\n');
  const bad = [/\bnew\s/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.(map|filter|slice|concat|join|bind)\(/].filter((r) => r.test(hot));
  ok(/bodyRange/.test(hot) && bad.length === 0 && !/Math\.random\(/.test(src), 'no allocation in the sense\'s per-frame paths with the body sense (static), no Math.random');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL BODY SIGHT CHECKS PASS');
process.exit(fails ? 1 : 0);
