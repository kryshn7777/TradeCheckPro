// THE KNOCKER (sim/knocker3d.js, render/knockerView.js, audio/knockerSfx.js, the bag / pickups / captions / input / game wiring).
// Asked for: "there must be a gadget to distract the mason temporarily". Checks:
//   - flight: the sim's free flight IS the closed-form linear-drag ballistic arc (to 1e-6 m at any frame rate); with no drag the
//     closed form is the textbook parabola; a tap lobs ~6 m on the flat, a full charge ~19 m, monotone in the charge; VR release velocity
//     scaled / capped / too gentle;
//   - bounce: restitution 0.35 off a floor, a wall reflects; it SETTLES within 2 s of its first bounce, at the floor + its radius; a throw
//     into the void is LOST 60 m down (a far clack), out of the level's bounds too; on the real level it comes to rest on a ledge;
//   - the clack: 0.4 s wind-up, then the 7-beat pattern x3 = 21 knocks over 9 s and a final 'done'; the events in order with positions;
//     creature.distract(x, y, z, {duration: 9, strength: 1}) at the first knock and about once a second (9 calls, duration counting down);
//     a creature without distract (or one that throws) changes nothing; a crumbling ledge drops it and the knocking goes on;
//   - refusals: off / dead / busy / empty / active / cooldown (a refusal never takes one from the bag, a throw takes exactly one);
//   - the bag: KNOCKER kind 4 (not a numbered slot), cap 3, seed / take, a respawn KEEPS the knockers, starts 1 / 2 / 1 / 0;
//   - the supplies: pickKnockers deterministic per seed, every second section, never a 'slow' spot / a supply's spot / a quiet zone,
//     Pickups3D puts them out, a taken knocker stays taken through a respawn, the cap of 3 leaves one lying ('pickup:full');
//   - no allocation in the update loop (young-generation collections over 300 k frames on the real level);
//   - the view: one InstancedMesh, <= 3 instances, <= 800 triangles, + the arc line only while aiming; the key turns, the glint pulses;
//   - the sounds: valid recipes, deterministic plans, the routes play the right recipe; the captions word the side from the head's yaw;
//   - the wiring (game.js / input / e2e flags) by source.
//   node knocker.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { register } from 'node:module';
import { SRC_DIR, VENDOR_THREE_URL, TOOLS_DIR, srcUrl } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const KN = await import(srcUrl('sim/knocker3d.js'));
const { Knocker3D, KNOCKER, KSTATE, KNOCK_PATTERN, KNOCK_BEATS, beatTime, ballistic, throwVelocity, vrThrowVelocity, predictArc, startCount } = KN;
const { EventBus, CONFIG, DIFFICULTY } = await import(srcUrl('sim/config3d.js'));
const { Inventory3D, ITEM, ITEM_COUNT, BAG_KINDS } = await import(srcUrl('sim/inventory3d.js'));
const { Pickups3D, pickKnockers, pickSupplies } = await import(srcUrl('sim/pickups3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const G = CONFIG.player.gravity;

// ---- stub levels ------------------------------------------------------------------------------------------------------------
/** A level of axis-aligned boxes with a raycast like Level3D's (nearest box along the ray). */
function boxLevel(boxes, bounds) {
  const segBox = (ox, oy, oz, dx, dy, dz, b) => {
    let t0 = 0;
    let t1 = 1;
    const o = [ox, oy, oz];
    const d = [dx, dy, dz];
    const mn = [b.minX, b.minY, b.minZ];
    const mx = [b.maxX, b.maxY, b.maxZ];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) {
        if (o[a] < mn[a] || o[a] > mx[a]) return -1;
      } else {
        let ta = (mn[a] - o[a]) / d[a];
        let tb = (mx[a] - o[a]) / d[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) return -1;
      }
    }
    return t0;
  };
  return {
    bounds: bounds || { minX: -1e4, maxX: 1e4, minY: -1e4, maxY: 1e4, minZ: -1e4, maxZ: 1e4 },
    raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
      const l = Math.hypot(dx, dy, dz);
      const ex = (dx / l) * maxDist;
      const ey = (dy / l) * maxDist;
      const ez = (dz / l) * maxDist;
      let best = Infinity;
      let bb = null;
      for (const b of boxes) {
        if (b.active === false) continue;
        const t = segBox(ox, oy, oz, ex, ey, ez, b);
        if (t >= 0 && t < best) (best = t), (bb = b);
      }
      if (!bb) return null;
      const r = out || {};
      r.t = best * maxDist;
      r.solid = bb;
      r.x = ox + ex * best;
      r.y = oy + ey * best;
      r.z = oz + ez * best;
      return r;
    },
  };
}
const floorBox = (y = 0, kind = 'stone') => ({ minX: -500, maxX: 500, minY: y - 2, maxY: y, minZ: -500, maxZ: 500, kind, active: true });
const mk = () => {
  const bus = new EventBus();
  const ev = [];
  for (const t of ['knocker:throw', 'knocker:bounce', 'knocker:land', 'knocker:clack', 'knocker:end', 'knocker:refuse']) bus.on(t, (p) => ev.push([t, { ...p }]));
  return { bus, ev, k: new Knocker3D(bus) };
};
const run = (k, secs, level, creature, dt = 1 / 72, each) => {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) {
    k.update(dt, level, creature);
    if (each) each(i * dt + dt);
  }
};

// ---- flight vs the analytic arc ----------------------------------------------------------------------------------------------
{
  const o = {};
  // no drag: the textbook parabola
  ballistic(0, 2, 0, 3, 8, -4, 0.9, o, 0, G);
  ok(Math.abs(o.x - 2.7) < 1e-12 && Math.abs(o.y - (2 + 8 * 0.9 - 0.5 * G * 0.81)) < 1e-12 && Math.abs(o.vy - (8 - G * 0.9)) < 1e-12, 'ballistic(k = 0) is the parabola x0 + v t, y0 + vy t - g t^2 / 2');
  // with drag: the closed form against a fine numeric integration of dv/dt = g - k v
  let x = 0;
  let y = 2;
  let vx = 9;
  let vy = 6;
  const k = KNOCKER.drag;
  const h = 1e-5;
  for (let t = 0; t < 1.2 - h / 2; t += h) {
    const ax = -k * vx;
    const ay = -G - k * vy;
    x += vx * h + 0.5 * ax * h * h;
    y += vy * h + 0.5 * ay * h * h;
    vx += ax * h;
    vy += ay * h;
  }
  ballistic(0, 2, 0, 9, 6, 0, 1.2, o);
  ok(Math.abs(o.x - x) < 1e-3 && Math.abs(o.y - y) < 1e-3, `ballistic(linear drag ${k}/s) matches a fine numeric integration (dx ${(o.x - x).toExponential(1)}, dy ${(o.y - y).toExponential(1)} m)`);
  // the sim's free flight (no level) IS the closed form, at any frame rate
  for (const dt of [1 / 30, 1 / 72, 1 / 90, 0.1]) {
    const kk = new Knocker3D(null);
    kk.tryThrow(null, null, 0, 50, 0, 7, 5, -3);
    let t = 0;
    let worst = 0;
    while (t < 2 - 1e-9) {
      kk.update(dt, null, null);
      t += dt;
      const s = kk.slots[kk.active];
      ballistic(0, 50, 0, 7, 5, -3, t, o);
      worst = Math.max(worst, Math.hypot(s.x - o.x, s.y - o.y, s.z - o.z));
    }
    ok(worst < 1e-6, `the free flight follows the analytic arc exactly at dt ${dt.toFixed(4)} s (worst ${worst.toExponential(1)} m over 2 s)`);
  }
}

// ---- the throw ---------------------------------------------------------------------------------------------------------------
{
  const o = {};
  const flat = boxLevel([floorBox(0)]);
  const firstContact = (held) => {
    throwVelocity(held, 0, 0, -1, o);
    const k = new Knocker3D(null);
    k.tryThrow(null, null, 0, 1.4, 0, o.vx, o.vy, o.vz);
    for (let i = 0; i < 600 && k.slots[0].bounces === 0 && k.active >= 0; i++) k.update(1 / 120, flat, null);
    return -k.slots[0].z;
  };
  const tap = firstContact(0.05);
  const full = firstContact(1.5);
  const mid = firstContact(0.55);
  ok(tap > 5 && tap < 7.5, `a tap (a short press) lobs it ${tap.toFixed(1)} m along a level view (about 6 m)`);
  ok(full > 17 && full < 22, `a full 1 s charge throws it ${full.toFixed(1)} m (about 20 m)`);
  ok(mid > tap && mid < full, `half a charge lands between (${mid.toFixed(1)} m): the range grows with the hold`);
  throwVelocity(0.05, 0, 0, -1, o);
  ok(Math.abs(Math.atan2(o.vy, -o.vz) - KNOCKER.loft) < 1e-9 && o.speed === KNOCKER.vMin && o.charge === 0, `a level view is lofted by ${KNOCKER.loft} rad (a lob, not a shot)`);
  throwVelocity(0.6, 0, 0.99, -0.14, o);
  ok(Math.atan2(o.vy, Math.hypot(o.vx, o.vz)) <= KNOCKER.loftMaxPitch + 1e-9, 'looking straight up never throws it past the loft cap (no knocker on your own head)');
  vrThrowVelocity(6, 2, -3, o);
  ok(Math.abs(o.speed - Math.hypot(6, 2, -3) * KNOCKER.vrGain) < 1e-9 && o.vx > 0 && o.vz < 0, `VR: the hand's release velocity x${KNOCKER.vrGain} sets the throw (direction kept)`);
  vrThrowVelocity(30, 0, 0, o);
  ok(o.speed === KNOCKER.vMax, `VR: capped at ${KNOCKER.vMax} m/s`);
  vrThrowVelocity(0.4, 0.2, 0, o);
  ok(o.speed === 0, `VR: a release under ${KNOCKER.vrMin} m/s is no throw (the game puts it back in the bag)`);
  // the aim preview ends where it first touches
  const pts = new Float32Array(48 * 3);
  throwVelocity(0.05, 0, 0, -1, o);
  const n = predictArc(flat, 0, 1.4, 0, o.vx, o.vy, o.vz, pts, 40, 0.05);
  ok(n > 5 && n < 40 && Math.abs(pts[(n - 1) * 3 + 1]) < 1e-6 && Math.abs(-pts[(n - 1) * 3 + 2] - tap) < 0.05, `the aim arc: ${n} samples, ending on the floor where the throw first lands`);
}

// ---- bounce, settle, lost ----------------------------------------------------------------------------------------------------
{
  const { k, ev } = mk();
  const flat = boxLevel([floorBox(0)]);
  k.tryThrow(null, null, 0, 1, 0, 0, -6, 0); // straight down at 6 m/s (+ gravity)
  let vAfter = NaN;
  let vBefore = NaN;
  for (let i = 0; i < 400 && Number.isNaN(vAfter); i++) {
    const before = k.slots[0].vy;
    k.update(1 / 240, flat, null);
    if (k.slots[0].bounces === 1) {
      vAfter = k.slots[0].vy;
      vBefore = before - G / 240;
    }
  }
  ok(Math.abs(vAfter / -vBefore - KNOCKER.restitution) < 0.03, `a floor bounce keeps ${(vAfter / -vBefore).toFixed(3)} of the normal speed (restitution ${KNOCKER.restitution})`);
  ok(ev.some((e) => e[0] === 'knocker:bounce' && e[1].kind === 'stone' && e[1].speed > 5), "'knocker:bounce' carries the impact speed and the surface's kind (the sound picks a recipe by it)");
  // a far throw: first bounce -> rest in < 2 s, resting at the floor + its radius
  const t = mk();
  const o = throwVelocity(1, 0, 0, -1, {});
  t.k.tryThrow(null, null, 0, 1.4, 0, o.vx, o.vy, o.vz);
  let restAt = -1;
  run(t.k, 6, flat, null, 1 / 72, (time) => {
    if (restAt < 0 && t.k.slots[0].state === KSTATE.WINDUP) restAt = time;
  });
  const s = t.k.slots[0];
  ok(restAt > 0 && restAt - s.firstHit < 2.0, `a full throw settles ${(restAt - s.firstHit).toFixed(2)} s after its first bounce (< 2 s), ${s.bounces} bounces`);
  ok(Math.abs(s.y - KNOCKER.radius) < 1e-9 && s.vx === 0 && s.vz === 0, 'it lies still on the floor (centre = floor + its 6 cm radius)');
  ok(t.ev.filter((e) => e[0] === 'knocker:land').length === 1, "one 'knocker:land' when it comes to rest");
  // a wall: thrown at it, it comes back
  const w = mk();
  const wall = boxLevel([floorBox(0), { minX: -50, maxX: 50, minY: -2, maxY: 30, minZ: -6, maxZ: -5, kind: 'metal', active: true }]);
  w.k.tryThrow(null, null, 0, 1.5, 0, 0, 1, -12);
  run(w.k, 4, wall, null);
  ok(w.k.slots[0].z > -5 && w.ev.some((e) => e[0] === 'knocker:bounce' && e[1].kind === 'metal'), 'thrown at a wall it bounces back off it and lands this side');
  // lost down the shaft: no floor at all
  const l = mk();
  l.k.tryThrow(null, null, 0, 100, 0, 3, 2, 0);
  run(l.k, 6, boxLevel([]), null);
  const lost = l.ev.find((e) => e[0] === 'knocker:end');
  ok(lost && lost[1].reason === 'lost' && lost[1].y < 100 - KNOCKER.lostDrop + 1 && l.k.slots[0].state === KSTATE.FREE && l.k.active < 0, `thrown into the void it is LOST ${KNOCKER.lostDrop} m down ('knocker:end' reason lost at y ${lost && lost[1].y.toFixed(1)}): no distraction, nothing left`);
  ok(!l.ev.some((e) => e[0] === 'knocker:clack'), 'a lost knocker never knocks');
  const b = mk();
  b.k.tryThrow(null, null, 0, 1, 0, 20, 2, 0);
  run(b.k, 3, boxLevel([], { minX: -5, maxX: 5, minY: -50, maxY: 50, minZ: -5, maxZ: 5 }), null);
  ok(b.ev.some((e) => e[0] === 'knocker:end' && e[1].reason === 'lost'), 'out of the level bounds: lost');
  // the real level: thrown from the spawn it comes to rest somewhere solid
  const lvl = new Level3D(LEVEL_DATA_3D);
  const sp = lvl.spawn;
  let rested = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = new Knocker3D(null);
    const v = throwVelocity(0.3 + (i % 3) * 0.3, -Math.sin(a), -0.1, -Math.cos(a), {});
    r.tryThrow(null, null, sp.x, sp.y + 1.5, sp.z, v.vx, v.vy, v.vz);
    run(r, 5, lvl, null);
    const st = r.slots[0].state;
    if (st === KSTATE.WINDUP || st === KSTATE.CLACK) {
      if (!lvl.pointInSolid(r.slots[0].x, r.slots[0].y, r.slots[0].z)) rested++;
    }
  }
  ok(rested >= 6, `the real level: ${rested} / 8 throws from the spawn come to rest on a surface (never inside a solid); the rest went over an edge`);
}

// ---- the clack timeline + the Mason --------------------------------------------------------------------------------------------
{
  const { k, ev } = mk();
  const flat = boxLevel([floorBox(0)]);
  const calls = [];
  let clock = 0;
  const mason = {
    distract(x, y, z, o) {
      calls.push({ t: clock, x, y, z, duration: o.duration, strength: o.strength });
      return true;
    },
  };
  k.tryThrow(null, null, 0, 0.3, 0, 0, -0.5, 0);
  const DT = 1 / 240;
  let landT = -1;
  const clackT = [];
  const n0 = ev.length;
  for (let i = 0; i < 240 * 12; i++) {
    clock += DT;
    const before = ev.length;
    k.update(DT, flat, mason);
    for (let j = before; j < ev.length; j++) {
      if (ev[j][0] === 'knocker:land' && landT < 0) landT = clock;
      if (ev[j][0] === 'knocker:clack') clackT.push(clock);
    }
  }
  void n0;
  const s = k.slots[0];
  ok(landT > 0 && Math.abs(clackT[0] - landT - KNOCKER.windup) <= DT + 1e-9, `it winds up for ${KNOCKER.windup} s: the first knock ${(clackT[0] - landT).toFixed(3)} s after it lands`);
  ok(clackT.length === KNOCK_BEATS && KNOCK_BEATS === 21 && KNOCK_PATTERN.length === 7, `${clackT.length} knocks: the 7-beat bar three times`);
  let worst = 0;
  for (let b = 0; b < clackT.length; b++) worst = Math.max(worst, Math.abs(clackT[b] - clackT[0] - beatTime(b)));
  ok(worst <= DT + 1e-9, `each knock on its beat of the fixed pattern (worst ${(worst * 1000).toFixed(1)} ms off)`);
  const end = ev.find((e) => e[0] === 'knocker:end');
  ok(end && end[1].reason === 'done' && s.state === KSTATE.SPENT && k.active === -1, "after 9 s: 'knocker:end' reason done, and it lies there SPENT (a prop)");
  const endT = landT + KNOCKER.windup + KNOCKER.duration;
  ok(Math.abs(clackT[clackT.length - 1] - (landT + KNOCKER.windup + beatTime(20))) <= DT + 1e-9 && beatTime(20) < KNOCKER.duration, `the last knock at ${beatTime(20).toFixed(2)} s, the end at ${KNOCKER.duration} s (land + ${(endT - landT).toFixed(1)} s)`);
  const order = ev.map((e) => e[0]).filter((t) => t !== 'knocker:bounce').filter((t, i, a) => i === 0 || a[i - 1] !== t);
  ok(order.join(',') === 'knocker:throw,knocker:land,knocker:clack,knocker:end', `events in order: ${order.join(' > ')}`);
  ok(ev.filter((e) => e[0] === 'knocker:clack').every((e, i) => e[1].beat === i && e[1].idx === i % 7 && e[1].bar === Math.floor(i / 7) && e[1].x === s.x && e[1].z === s.z), "'knocker:clack' {x,y,z,beat,idx,bar} for every knock, at the knocker");
  ok(calls.length === 9 && Math.abs(calls[0].t - clackT[0]) <= DT + 1e-9 && calls[0].duration === 9 && calls[0].strength === 1, `distract(x, y, z, {duration: 9, strength: 1}) at the first knock, then ${calls.length - 1} more`);
  let gapOk = true;
  for (let i = 1; i < calls.length; i++) if (Math.abs(calls[i].t - calls[i - 1].t - 1) > DT + 1e-9 || calls[i].duration !== 9 - i) gapOk = false;
  ok(gapOk && calls.every((c) => c.x === s.x && c.y === s.y && c.z === s.z), 'then once a second, the duration counting down (9, 8 ... 1), always at the knocker');
  ok(calls[calls.length - 1].t < endT, 'never once it has stopped');
  // a creature without distract (today's Mason, before the sight branch) / one that throws
  const b = mk();
  b.k.tryThrow(null, null, 0, 0.3, 0, 0, -0.5, 0);
  let threw = false;
  try {
    run(b.k, 11, flat, { id: 'old mason' });
    run(b.k, 1, flat, null);
  } catch {
    threw = true;
  }
  ok(!threw && b.ev.filter((e) => e[0] === 'knocker:clack').length === 21, 'a creature without distract(): it still knocks its 21 beats (the call is guarded)');
  const c = mk();
  c.k.tryThrow(null, null, 0, 0.3, 0, 0, -0.5, 0);
  run(c.k, 11, flat, {
    distract() {
      throw new Error('boom');
    },
  });
  ok(c.ev.filter((e) => e[0] === 'knocker:clack').length === 21, 'a distract() that throws does not stop the knocking');
  // the glint: up on each knock, gone between
  const g = mk();
  g.k.tryThrow(null, null, 0, 0.3, 0, 0, -0.5, 0);
  let peak = 0;
  let low = 1;
  run(g.k, 3, flat, null, 1 / 240, () => {
    const sl = g.k.slots[0];
    if (sl.state === KSTATE.CLACK) {
      peak = Math.max(peak, sl.glow);
      if (sl.t > 0.42 && sl.t < 0.5) low = Math.min(low, sl.glow);
    }
  });
  ok(peak > 0.9 && low < 0.15, `the amber glint pulses on each knock (peak ${peak.toFixed(2)}, ${low.toFixed(2)} between) and the key turns (${g.k.slots[0].key.toFixed(1)} rad)`);
  // a crumbling ledge under it
  const ledge = { minX: -2, maxX: 2, minY: 8, maxY: 10, minZ: -2, maxZ: 2, kind: 'crumble', active: true };
  const cr = mk();
  const lv = boxLevel([ledge, floorBox(0)]);
  cr.k.tryThrow(null, null, 0, 10.4, 0, 0, -0.5, 0);
  run(cr.k, 3, lv, null);
  const beatsBefore = cr.k.slots[0].beat;
  ledge.active = false;
  run(cr.k, 12, lv, null);
  ok(beatsBefore > 3 && Math.abs(cr.k.slots[0].y - KNOCKER.radius) < 1e-6 && cr.ev.filter((e) => e[0] === 'knocker:clack').length === 21 && cr.ev.filter((e) => e[0] === 'knocker:land').length === 1, 'the ledge crumbles under it mid-knock: it drops to the floor below and finishes its 21 knocks there (no second wind-up)');
}

// ---- refusals -----------------------------------------------------------------------------------------------------------------
{
  const { k, ev } = mk();
  const inv = new Inventory3D(null);
  inv.seed(ITEM.KNOCKER, 2);
  const flat = boxLevel([floorBox(0)]);
  ok(k.refusal(2, { dead: false, busy: false }) === '', 'carrying one, alive and in play: it can be thrown');
  ok(k.tryThrow(inv, { dead: true }, 0, 1, 0, 0, 1, -5) === false && k.lastRefusal === 'dead' && inv.counts[ITEM.KNOCKER] === 2, "dead: refused ('dead'), the bag untouched");
  ok(k.tryThrow(inv, { busy: true }, 0, 1, 0, 0, 1, -5) === false && k.lastRefusal === 'busy', "paused / a cutscene / the intro: refused ('busy')");
  k.enabled = false;
  ok(k.tryThrow(inv, null, 0, 1, 0, 0, 1, -5) === false && k.lastRefusal === 'off', "the setting off (or ?knocker=off): refused ('off')");
  k.enabled = true;
  ok(k.tryThrow(inv, null, 0, 1, 0, 0, 1, -5) === true && inv.counts[ITEM.KNOCKER] === 1, 'a throw takes exactly one from the bag');
  ok(k.tryThrow(inv, null, 0, 1, 0, 0, 1, -5) === false && k.lastRefusal === 'active' && inv.counts[ITEM.KNOCKER] === 1, "a second throw while the first flies / knocks: refused ('active'), a soft 'no'");
  ok(ev.some((e) => e[0] === 'knocker:refuse' && e[1].reason === 'active'), "'knocker:refuse' {reason} for the sound and the tests");
  // cooldown: the first one lost at once (out of a tiny level): 3 s before the next
  const c = mk();
  const tiny = boxLevel([], { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 });
  c.k.tryThrow(null, null, 0, 0, -40, 0, 0, -30); // thrown from outside the level's bounds: lost at once
  c.k.update(1 / 60, tiny, null);
  ok(c.k.active === -1 && c.k.tryThrow(null, null, 0, 0, -40, 0, 0, -30) === false && c.k.lastRefusal === 'cooldown', `the next throw waits out the ${KNOCKER.cooldown} s cooldown ('cooldown')`);
  run(c.k, KNOCKER.cooldown, null, null);
  ok(c.k.refusal(1, null) === '', 'and is allowed after it');
  inv.seed(ITEM.KNOCKER, 0);
  ok(k.refusal(inv.counts[ITEM.KNOCKER], null) !== '' && new Knocker3D(null).refusal(0, null) === 'empty', "none left: refused ('empty')");
  run(k, 12, flat, null);
  // VR: hold, put back, throw from the hand
  const v = mk();
  const inv2 = new Inventory3D(null);
  inv2.seed(ITEM.KNOCKER, 1);
  ok(v.k.hold('right', 0, 1.2, 0, 1, null) && v.k.held >= 0 && inv2.counts[ITEM.KNOCKER] === 1, 'VR: a knocker drawn into the hand is not spent yet');
  v.k.moveHeld(0.3, 1.4, -0.2, 0.5);
  ok(v.k.slots[v.k.held].x === 0.3 && v.k.slots[v.k.held].state === KSTATE.HELD, 'it follows the hand');
  ok(v.k.putBack() && v.k.held === -1 && v.k.inWorld === 0 && inv2.counts[ITEM.KNOCKER] === 1, 'let go too gently: back in the bag, nothing spent');
  v.k.hold('right', 0, 1.2, 0, 1, null);
  const hs = v.k.slots[v.k.held];
  ok(v.k.tryThrow(inv2, null, hs.x, hs.y, hs.z, 2, 4, -8) && v.k.held === -1 && v.k.live === hs && inv2.counts[ITEM.KNOCKER] === 0, 'thrown from the hand: that knocker flies, one taken from the bag');
}

// ---- the bag ------------------------------------------------------------------------------------------------------------------
{
  const inv = new Inventory3D(null);
  ok(ITEM.KNOCKER === 4 && ITEM_COUNT === 4 && BAG_KINDS === 5 && inv.counts.length === 5, 'the bag counts a fifth kind, KNOCKER (4), outside the four numbered slots (keys 1-4, the radial, the icon cells)');
  ok(CONFIG.bag.caps[ITEM.KNOCKER] === 3 && KNOCKER.cap === 3, 'carried at most 3');
  ok(inv.add(ITEM.KNOCKER, 5) === 3 && !inv.canAdd(ITEM.KNOCKER), 'the cap holds (5 offered, 3 taken)');
  ok(inv.use(ITEM.KNOCKER, { hp: 0.5, dead: false, hits: 0 }) === false && inv.lastRefusal === 'thrown', 'it is never applied as a consumable (it is thrown)');
  for (let i = 0; i < 6; i++) inv.cycle(1);
  ok(inv.selected < 4, 'cycling the bag never selects it');
  inv.snapshot();
  inv.take(ITEM.KNOCKER);
  inv.restore();
  ok(inv.counts[ITEM.KNOCKER] === 2, 'a respawn KEEPS the knockers as the death left them (a thrown one is gone, like the jetpack fuel)');
  inv.reset();
  ok(inv.counts[ITEM.KNOCKER] === 0 && inv.total === 0, 'a new run empties it (the game then seeds the start count)');
  ok(startCount('normal') === 1 && startCount('sandbox') === 2 && startCount('nightmare') === 1 && startCount('abyss') === 0, 'a run starts with 1 (Normal), 2 (Sandbox), 1 (Nightmare), 0 (Abyss)');
  ok(Object.keys(DIFFICULTY).every((d) => typeof KNOCKER.start[d] === 'number'), 'every difficulty has a start count');
}

// ---- the supplies ---------------------------------------------------------------------------------------------------------------
{
  const lvl = new Level3D(LEVEL_DATA_3D);
  const nSec = lvl.sections.length;
  const pk = new Pickups3D(lvl, null);
  const spots = pk.spots;
  const quiet = [lvl.spawn, ...lvl.sections.map((s) => s.checkpoint)];
  let fair = true;
  let total = 0;
  let minN = 99;
  let maxN = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const sup = pickSupplies(spots, seed, { sections: nSec });
    const taken = new Uint8Array(spots.length);
    for (const c of sup) taken[c.spot] = 1;
    const ks = pickKnockers(spots, seed, { sections: nSec, taken, quiet });
    total += ks.length;
    minN = Math.min(minN, ks.length);
    maxN = Math.max(maxN, ks.length);
    for (const i of ks) {
      const sp = spots[i];
      if (sp.tier === 'slow' || taken[i] || sp.section % 2 !== 0) fair = false;
      for (const q of quiet) if (Math.hypot(q.x - sp.x, q.y - sp.y, q.z - sp.z) < 4) fair = false;
    }
    const again = pickKnockers(spots, seed, { sections: nSec, taken, quiet });
    if (again.join() !== ks.join()) fair = false;
  }
  ok(fair, '200 seeds: every knocker on a section 1, 3, 5, 7 spot (counted from 1), never a slow spot, never a supply\'s spot, never within 4 m of the spawn / a checkpoint; the same seed gives the same spots');
  ok(minN >= 3 && maxN <= Math.ceil(nSec / 2), `about one per two sections: ${minN}-${maxN} a run (${(total / 200).toFixed(1)} on average over ${nSec} sections)`);
  const a = pickKnockers(spots, 1, { sections: nSec }).join();
  let differ = 0;
  for (let s = 2; s < 30; s++) if (pickKnockers(spots, s, { sections: nSec }).join() !== a) differ++;
  ok(differ > 10, `different runs lay them differently (${differ} / 28 seeds differ from seed 1)`);
  // Pickups3D lays them out with the supplies, away from the Masons' rests
  pk.reset(77);
  const kn = pk.items.filter((i) => i.kind === ITEM.KNOCKER);
  const rests = (LEVEL_DATA_3D.nooks || []).map((n) => n.block || n.box);
  const inRest = kn.some((i) => rests.some((b) => i.x > b.minX - 1 && i.x < b.maxX + 1 && i.y > b.minY - 1 && i.y < b.maxY + 1 && i.z > b.minZ - 1 && i.z < b.maxZ + 1));
  ok(kn.length >= 3 && !inRest && new Set(pk.items.map((i) => i.spot)).size === pk.items.length, `Pickups3D puts out ${kn.length} knockers with the supplies (no two on one spot, none in a Masons' rest)`);
  const pk2 = new Pickups3D(lvl, null);
  pk2.knockers = false;
  pk2.reset(77);
  ok(!pk2.items.some((i) => i.kind === ITEM.KNOCKER) && pk2.items.length === pk.items.length - kn.length, 'knockers = false (?knocker=off / the setting): none, and the supplies are exactly as without them');
  // collect: a taken knocker stays taken through a respawn; the cap leaves one lying
  const bus = new EventBus();
  const full = [];
  bus.on('pickup:full', (e) => full.push(e.kind));
  const pk3 = new Pickups3D(lvl, bus);
  pk3.reset(77);
  pk3.snapshot();
  const inv = new Inventory3D(null);
  const it = pk3.items.find((i) => i.kind === ITEM.KNOCKER);
  pk3.update(0.016, { x: it.x, y: it.y, z: it.z }, inv);
  ok(it.taken && inv.counts[ITEM.KNOCKER] === 1, 'walking through one puts it in the bag');
  pk3.restore();
  ok(it.taken, 'a respawn does NOT put a taken knocker back (the bag keeps it: no duplicates)');
  const it2 = pk3.items.filter((i) => i.kind === ITEM.KNOCKER)[1];
  inv.seed(ITEM.KNOCKER, 3);
  pk3.update(0.016, { x: it2.x, y: it2.y, z: it2.z }, inv);
  ok(!it2.taken && full.includes(ITEM.KNOCKER) && inv.counts[ITEM.KNOCKER] === 3, "carrying 3: the next one stays where it lies ('pickup:full')");
}

// ---- no allocation in the update loop ----------------------------------------------------------------------------------------------
{
  const { PerformanceObserver } = await import('node:perf_hooks');
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  let gcs = 0;
  const obs = new PerformanceObserver((l) => (gcs += l.getEntries().length));
  obs.observe({ entryTypes: ['gc'] });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  // a room (floor y 0, walls at x / z = +-12) whose raycast allocates nothing, so what is counted is the knocker's own work
  // (Level3D.raycast is the engine's shared query and allocates a little of its own: it is measured apart below)
  const hitR = { t: 0, solid: null, x: 0, y: 0, z: 0 };
  const FLOOR = { minX: -12, maxX: 12, minY: -2, maxY: 0, minZ: -12, maxZ: 12, kind: 'stone', active: true };
  const WX0 = { minX: -14, maxX: -12, minY: -2, maxY: 30, minZ: -14, maxZ: 14, kind: 'stone', active: true };
  const WX1 = { minX: 12, maxX: 14, minY: -2, maxY: 30, minZ: -14, maxZ: 14, kind: 'metal', active: true };
  const WZ0 = { minX: -14, maxX: 14, minY: -2, maxY: 30, minZ: -14, maxZ: -12, kind: 'stone', active: true };
  const WZ1 = { minX: -14, maxX: 14, minY: -2, maxY: 30, minZ: 12, maxZ: 14, kind: 'grate', active: true };
  const room = {
    bounds: { minX: -20, maxX: 20, minY: -20, maxY: 40, minZ: -20, maxZ: 20 },
    raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ux = dx / l;
      const uy = dy / l;
      const uz = dz / l;
      let t = maxDist + 1;
      let s = null;
      if (uy < 0 && oy >= 0) (t = -oy / uy), (s = FLOOR);
      if (ux < 0 && (-12 - ox) / ux < t) (t = (-12 - ox) / ux), (s = WX0);
      if (ux > 0 && (12 - ox) / ux < t) (t = (12 - ox) / ux), (s = WX1);
      if (uz < 0 && (-12 - oz) / uz < t) (t = (-12 - oz) / uz), (s = WZ0);
      if (uz > 0 && (12 - oz) / uz < t) (t = (12 - oz) / uz), (s = WZ1);
      if (!s || t > maxDist || t < 0) return null;
      const r = out || hitR;
      r.t = t;
      r.solid = s;
      r.x = ox + ux * t;
      r.y = oy + uy * t;
      r.z = oz + uz * t;
      return r;
    },
  };
  const sp = { x: 0, y: 0, z: 0 };
  const k = new Knocker3D(null);
  const mason = { n: 0, distract() { this.n++; return true; } };
  const o = { vx: 0, vy: 0, vz: 0, speed: 0, charge: 0 };
  const cycle = (frames) => {
    let i = 0;
    let throws = 0;
    while (i < frames) {
      if (k.active < 0) {
        k.cooldown = 0;
        const a = throws * 0.7;
        throwVelocity(0.2 + (throws % 4) * 0.25, -Math.sin(a), 0, -Math.cos(a), o);
        k.tryThrow(null, null, sp.x, sp.y + 1.5, sp.z, o.vx, o.vy, o.vz);
        throws++;
      }
      k.update(1 / 72, room, mason);
      i++;
    }
    return throws;
  };
  cycle(20000);
  gc();
  await settle();
  gcs = 0;
  const throws = cycle(300000);
  await settle();
  obs.disconnect();
  ok(gcs <= 2 && throws > 200 && mason.n > 1000, `300 k frames (${throws} throws against walls and a floor, flights, bounces, ${mason.n} distract calls) cost ${gcs} young collections: no allocation per frame`);
}

// ---- the view --------------------------------------------------------------------------------------------------------------------
{
  const THREE = await import('three');
  const { KnockerView, knockerTemplate, KNOCKER_VIEW } = await import(srcUrl('render/knockerView.js'));
  const scene = new THREE.Scene();
  const k = new Knocker3D(null);
  const game = { renderer: { scene }, knocker: k, hidePlayer: false };
  const v = new KnockerView(game);
  const tpl = knockerTemplate();
  ok(tpl.tris >= 150 && tpl.tris <= 250, `one knocker is ${tpl.tris} triangles (150-250)`);
  ok(tpl.tris * KNOCKER_VIEW.maxInstances <= 800 && KNOCKER_VIEW.maxInstances === 3, `at most ${KNOCKER_VIEW.maxInstances} instances: ${tpl.tris * KNOCKER_VIEW.maxInstances} triangles in all (<= 800)`);
  let draws = 0;
  let inst = 0;
  scene.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints) draws++;
    if (o.isInstancedMesh) inst++;
  });
  ok(inst === 1 && draws === 2 && v.mesh.isInstancedMesh, 'the scene gets ONE InstancedMesh (one draw call) + the aim arc line (hidden unless G is held)');
  const mat = v.mesh.material;
  ok(!mat.map && !mat.emissiveMap && !mat.normalMap && !mat.roughnessMap, 'no texture of its own (no new sampler: the glint is a per-instance emissive)');
  let lights = 0;
  scene.traverse((o) => (lights += o.isLight ? 1 : 0));
  ok(lights === 0, 'no light added');
  v.update(0.016, game);
  ok(v.mesh.count === 0, 'nothing thrown: 0 instances (nothing drawn)');
  const flat = boxLevel([floorBox(0)]);
  for (let i = 0; i < 5; i++) {
    k.cooldown = 0;
    k.tryThrow(null, null, i, 0.4, 0, 0, -0.5, 0);
    run(k, 10, flat, null);
  }
  v.update(0.016, game);
  ok(v.mesh.count === 3 && k.inWorld === 3, 'five thrown and spent: the 3 newest lie there as props (the oldest recycled), 3 instances');
  const xs = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < 3; i++) {
    v.mesh.getMatrixAt(i, m);
    xs.push(Math.round(m.elements[12]));
  }
  ok(xs.sort().join() === '2,3,4', `the props stay where they stopped (x ${xs.join(', ')})`);
  k.reset();
  k.tryThrow(null, null, 0, 0.3, 0, 0, -0.5, 0);
  run(k, 0.9, flat, null);
  v.update(0.016, game);
  const st = v._aState.array;
  ok(st[0] > 0 && v.mesh.count === 1, `clacking: the key turned to ${st[0].toFixed(2)} rad, the glint ${st[1].toFixed(2)}`);
  const ka = st[0];
  run(k, 0.5, flat, null);
  v.update(0.016, game);
  ok(st[0] > ka, 'the key keeps turning while it knocks');
  const pts = new Float32Array(48 * 3).map((_, i) => i * 0.1);
  v.setArc(pts, 30);
  ok(v.arc.visible && v.stats.arc === 30, 'the aim arc shows while aiming');
  v.setArc(null, 0);
  ok(!v.arc.visible, 'and is gone after the throw');
  // no allocation per frame in the view's update (young collections over 200 k frames with one knocking + two props)
  {
    const { PerformanceObserver } = await import('node:perf_hooks');
    const gc = vm.runInNewContext('gc');
    let gcs = 0;
    const obs = new PerformanceObserver((l) => (gcs += l.getEntries().length));
    obs.observe({ entryTypes: ['gc'] });
    for (let f = 0; f < 20000; f++) v.update(1 / 72, game);
    gc();
    await new Promise((r) => setTimeout(r, 30));
    gcs = 0;
    for (let f = 0; f < 200000; f++) v.update(1 / 72, game);
    await new Promise((r) => setTimeout(r, 30));
    obs.disconnect();
    ok(gcs <= 2, `200 k view updates cost ${gcs} young collections (instance data rewritten in place)`);
  }
  // the pickups view draws the same shape for a knocker lying in the supplies
  const { buildTemplates } = await import(srcUrl('render/pickupsView.js'));
  const t = buildTemplates();
  ok(t[ITEM.KNOCKER] && t[ITEM.KNOCKER].verts === tpl.verts && t[ITEM.KNOCKER].idx.length === tpl.idx.length, 'the supplies show a knocker with the same mesh (pickupsView template 4)');
  v.dispose();
  ok(scene.children.length === 0, 'dispose leaves the scene empty');
}

// ---- the sounds + the captions ----------------------------------------------------------------------------------------------------
{
  const D = await import(srcUrl('audio/sfxDesign.js'));
  const B = await import(srcUrl('audio/sfxBank.js'));
  const S = await import(srcUrl('audio/knockerSfx.js'));
  const ids = Object.keys(S.KNOCKER_RECIPES);
  let bad = [];
  let same = true;
  for (const id of ids) {
    const rec = D.compileRecipe(id, B.RECIPES[id]);
    bad = bad.concat(D.validateRecipe(rec));
    for (let v = 0; v < rec.nVar; v++) {
      const a = new D.Plan();
      const b = new D.Plan();
      D.resolveRecipe(rec, 0.7, v, a, 21600);
      D.resolveRecipe(rec, 0.7, v, b, 21600);
      if (a.n !== b.n || a.dur !== b.dur || a.level !== b.level) same = false;
      for (let i = 0; i < a.n; i++) for (const key of ['at', 'a', 'd', 'g', 'f', 'f2']) if (a.layers[i][key] !== b.layers[i][key]) same = false;
    }
  }
  ok(ids.length === 7 && ids.every((id) => B.RECIPES[id]) && bad.length === 0, `${ids.length} knocker recipes in the bank (${ids.join(', ')}), all valid${bad.length ? ': ' + bad.join('; ') : ''}`);
  ok(same, 'every plan is deterministic (the same inputs give the same sound)');
  ok(Object.keys(S.KNOCKER_ROUTES).every((t) => B.ROUTES[t]) && B.SFX_EVENTS.includes('knocker:clack'), 'the routes are in the bank (the engine subscribes them)');
  const src = fs.readFileSync(path.join(SRC_DIR, 'audio/knockerSfx.js'), 'utf8');
  ok(!/Math\.random/.test(src.replace(/no Math\.random/g, '')), 'no Math.random in the knocker sounds');
  // routes -> recipes, with a fake engine
  const played = [];
  const E = { _o: {}, opts() { this._o = { x: NaN, y: NaN, z: NaN, key: 0 }; return this._o; }, play(id, k, o) { played.push({ id, k, key: o ? o.key : null, x: o ? o.x : null }); } };
  const R = B.ROUTES;
  R['knocker:throw']({ speed: 18.5 }, E);
  R['knocker:bounce']({ x: 1, y: 0, z: 0, speed: 5, kind: 'stone' }, E);
  R['knocker:bounce']({ x: 1, y: 0, z: 0, speed: 5, kind: 'metal' }, E);
  R['knocker:land']({ x: 1, y: 0, z: 0 }, E);
  R['knocker:clack']({ x: 1, y: 0, z: 0, idx: 3, accent: 0.9 }, E);
  R['knocker:end']({ x: 1, y: 0, z: 0, reason: 'done' }, E);
  R['knocker:end']({ x: 1, y: -80, z: 0, reason: 'lost' }, E);
  R['knocker:refuse']({ reason: 'cooldown' }, E);
  R['knocker:refuse']({ reason: 'busy' }, E);
  ok(played.map((p) => p.id).join() === 'knocker.throw,prop.cell,knocker.clink,knocker.wind,knocker.knock,knocker.clunk,knocker.lost,knocker.no', `events play: ${played.map((p) => p.id).join(' / ')} (the bounce reuses the dropped-prop clink on stone)`);
  ok(played[0].k === 1 && played[4].key === 3 && played[4].k === 0.9 && played[4].x === 1, "the whoosh scales with the throw's speed; a knock's pitch is the hash of its place in the bar, its level the accent, at the knocker");
  // captions: the side from the head's yaw
  const C = await import(srcUrl('ui/captions.js'));
  const head = { x: 0, y: 0, z: 0, yaw: 0, ok: true }; // looking along -z
  const cap = (x, z, hd = head) => C.captionForEvent('knocker:clack', { x, y: 0, z, idx: 0 }, hd);
  ok(cap(-6, 0).text === '[A brass knocking, to your left]' && cap(6, 0).text === '[A brass knocking, to your right]' && cap(0, -6).text === '[A brass knocking, ahead]' && cap(0, 6).text === '[A brass knocking, behind you]', 'the caption words the side: left / right / ahead / behind from the head (yaw 0)');
  const turned = { x: 0, y: 0, z: 0, yaw: Math.PI / 2, ok: true }; // looking along -x
  ok(cap(-6, 0, turned).text.endsWith('ahead]') && cap(0, -6, turned).text.endsWith('to your right]'), 'turned 90 degrees left, the same knocker is ahead / a knocker ahead of the spawn is to the right');
  ok(cap(0.3, 0.2).text === '[A brass knocking, close by]' && C.captionForEvent('knocker:clack', { x: 1, y: 0, z: 1, idx: 0 }, null).text === '[A brass knocking]', 'on top of you: close by; no head: no side');
  ok(C.captionForEvent('knocker:clack', { x: 1, y: 0, z: 1, idx: 3 }, head) === null && cap(-6, 0).sev === 0, 'only at the start of a bar, low severity');
  ok(C.captionForEvent('knocker:end', { reason: 'lost' }).text === '[A faint clack, far below]' && C.captionForEvent('knocker:end', { reason: 'done' }) === null, 'lost: a faint clack far below');
  const tr = new C.CaptionTracker();
  const bus = new EventBus();
  tr.attach(bus);
  tr.update(0.1, head);
  for (let b = 0; b < 21; b++) {
    bus.emit('knocker:clack', { x: -6, y: 0, z: 0, beat: b, idx: b % 7 });
    tr.update(beatTime(b + 1) - beatTime(b) || 0.1, head);
  }
  const lines = tr.lines.filter((l) => l.on && /brass/.test(l.text));
  ok(lines.length <= 1 && C.CAPTION_EVENTS.includes('knocker:clack'), `the tracker: one line at a time for 21 knocks (never stacking): "${lines[0] ? lines[0].text : ''}"`);
}

// ---- the wiring --------------------------------------------------------------------------------------------------------------------
{
  const read = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  const game = read('game.js');
  ok(game.includes('this.knocker = new Knocker3D(this._runBus)') && game.includes('this.knocker.update(dt, this.level,') && game.includes('this.knocker.reset()'), 'game: built with the run, stepped in the frame (playing only), reset on a new run / respawn / warp');
  ok(game.includes('this.bag.seed(ITEM.KNOCKER, kOn ? knockerStart(this.difficultyKey) : 0)') && /if \(this\.knocker\) this\.knocker\.reset\(\); \/\/ the knockers lying about are gone; the bag KEEPS/.test(game), 'game: the start count per difficulty on a new run; a respawn keeps the count');
  ok(game.includes('function knockerOff()') && game.includes("settings.knocker === false") && game.includes('this.pickups.knockers = this._knockerOn()'), 'game: ?knocker=off and settings.knocker (none carried, none in the supplies)');
  ok(game.includes('knocker: {') && game.includes('give: (n) =>') && game.includes('clear: () =>') && game.includes("knocker: this.knocker ? Object.assign(this.knocker.debugState()"), 'game: AT3D.debug.knocker.{state, throw, give, clear} and debugState().knocker');
  ok(game.includes("knockerView: './render/knockerView.js'") && game.includes('this.knockerView.update(dt, this)'), 'game: the view');
  ok(game.includes("'A knocker. Throw it far: it answers for you.'"), 'game: the first pickup says what it is for');
  const cfg = read('sim/config3d.js');
  ok(/knocker: true,/.test(cfg) && cfg.includes('s.knocker = s.knocker !== false;'), 'settings.knocker defaults on');
  const di = read('input/desktopInput.js');
  const im = read('input/inputManager.js');
  ok(di.includes("im._knockEdge(true)") && di.includes('this.im._knockEdge(false)') && di.includes("if (code === 'KeyB') im._bagEdge('use')"), 'desktop: G holds / releases the knocker (the selected-item key moved to B)');
  ok(im.includes('IK.pressed = KN.down') && im.includes('this._knock.down = false;') && im.includes('handVelocity(hand, out)'), 'inputManager: the knocker edges once per frame + the hand release velocity');
  const bg = await import(srcUrl('input/bagGesture.js'));
  const g = bg.makeBagGesture();
  const hands = [{ ok: true, x: 0, y: 0, z: 0, grip: 0 }, { ok: true, x: 0.22, y: 1.15, z: 0, grip: 0 }];
  const S = { live: true, applying: false, hx: 0, hy: 1.6, hz: 0, yaw: 0, hands, counts: new Int8Array([0, 1, 0, 0, 1]), knocker: true };
  bg.updateBagGesture(g, S);
  hands[1].grip = 1;
  bg.updateBagGesture(g, S);
  ok(g.open, 'VR: grip at the hip opens the bag');
  hands[1].y += 0.1;
  bg.updateBagGesture(g, S);
  ok(g.open && g.knocker === -1 && g.hover === 1, 'a small move up still points at the bandage');
  hands[1].y += 0.14;
  bg.updateBagGesture(g, S);
  ok(g.knocker === 1 && !g.open, 'pulled up and out of the bag (grip held): a knocker comes out in that hand (drawn edge)');
  hands[1].z -= 0.5;
  bg.updateBagGesture(g, S);
  ok(g.knocker === 1 && g.thrown === -1, 'swinging the arm, the grip still holds it');
  hands[1].grip = 0;
  bg.updateBagGesture(g, S);
  ok(g.thrown === 1 && g.knocker === -1 && g.chosen === -1, 'releasing the grip throws it (thrown edge), nothing applied');
  const g2 = bg.makeBagGesture();
  const S2 = { ...S, knocker: false };
  hands[1].x = 0.22;
  hands[1].y = 1.15;
  hands[1].z = 0;
  bg.updateBagGesture(g2, S2);
  hands[1].grip = 1;
  bg.updateBagGesture(g2, S2);
  hands[1].y += 0.25;
  bg.updateBagGesture(g2, S2);
  ok(g2.knocker === -1 && g2.drawRefused, 'when none may be drawn (cooldown / one knocking): no knocker, a refusal edge (the soft no)');
  const xr = await import(srcUrl('input/xrInput.js'));
  const hv = xr.makeHandVel();
  for (let i = 0; i < 10; i++) xr.trackHandVel(hv, i * 0.1, 1, -i * 0.05, 1 / 72);
  const vel = xr.handVelOf(hv, { x: 0, y: 0, z: 0 });
  ok(Math.abs(vel.x - 7.2) < 1e-9 && Math.abs(vel.z + 3.6) < 1e-9 && vel.y === 0, `the hand's release velocity over the last frames (${vel.x.toFixed(1)}, ${vel.y.toFixed(1)}, ${vel.z.toFixed(1)} m/s)`);
  const tut = read('ui/tutorial.js');
  ok(tut.includes("id: 'knocker'") && tut.includes("on('knocker:throw', () => this.learn('knocker'))"), 'tutorial: the one-line knocker hint, learned on the first throw');
  const e2e = fs.readFileSync(path.join(TOOLS_DIR, 'e2e/e2e.cjs'), 'utf8');
  const fa = fs.readFileSync(path.join(TOOLS_DIR, 'e2e/free-attach.cjs'), 'utf8');
  ok(e2e.includes('knocker=off') && (fa.match(/knocker=off/g) || []).length >= 2, 'the e2e and the free-attach bot pass &knocker=off');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL KNOCKER CHECKS PASS');
process.exitCode = fails ? 1 : 0;
