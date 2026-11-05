// RED ROACHES (sim/roaches.js, render/roachView.js, audio/roachSfx.js; docs/abyssal-tether-3d/plans/ROACHES.md).
// Asked for: "Add tiny super tiny skitterlings. Super optimized. Often spawning near player out of camera like cockroaches in red colour."
//   - the sim on the REAL level: deterministic, never appears inside the view frustum (desktop and the wider headset frustum), always 2-9 m from the
//     head, never inside a solid, always on a face of a solid and inside it, never within 7 m of the spawn / a checkpoint, more of them deeper,
//     the cap per tier, the governor (level 1 / 2 fewer, >= 3 none), off = none, at most 2 rays a frame;
//   - behaviour: the lantern's light and a hand send it running (away), a palm or a moving boot squishes it (the event, the smear that fades),
//     a crack burst beside a grab (deterministic, cooldown, the event, they pour out and run), the states all occur;
//   - budget: zero allocations in the steady state, CPU ms per frame at the cap (1000 frames), ONE draw call, 27 triangles a roach;
//   - the view writes one instance per live roach / smear with the face normal as its up axis; the context glue; the sounds play on the mock
//     audio context and are deterministic; captions; the setting; no Math.random.
//   node roaches.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { register } from 'node:module';
import { srcUrl, SRC_DIR, VENDOR_THREE_URL } from '../../verify/root.mjs';
import { MockAudioContext } from '../audio/mockaudio.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');
const THREE = await import('three');
const { Roaches, ROACH, ROACH_STATE, makeRoachCtx, inView, faceAxisOf, hash01 } = await import(srcUrl('sim/roaches.js'));
const { RoachView, roachContext, buildRoachGeometry, ROACH_TRIS } = await import(srcUrl('render/roachView.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { planRemains } = await import(srcUrl('sim/remainsPlan.js'));
const { EventBus, SETTINGS_DEFAULTS, sanitizeUxSettings } = await import(srcUrl('sim/config3d.js'));
const { captionForEvent, CAPTION_EVENTS, CaptionTracker } = await import(srcUrl('ui/captions.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const S = ROACH_STATE;
const level = new Level3D(LEVEL_DATA_3D);
const remains = planRemains(level);
const quiet = [level.spawn, ...level.sections.map((s) => s.checkpoint).filter(Boolean)];

// a deterministic test rng
let tr = 12345;
const trnd = () => ((tr = (Math.imul(tr, 1103515245) + 12345) >>> 0) / 4294967296);

/** Standing places: points on ledge tops in section `si`, 1.2 m of air above, >= 9 m from the quiet points (so roaches may appear around them). */
function standPoints(si, n) {
  const s = level.sections[si];
  const sh = s.shaft;
  const out = [];
  for (let k = 0; k < 4000 && out.length < n; k++) {
    const x = sh.minX + trnd() * (sh.maxX - sh.minX);
    const z = sh.minZ + trnd() * (sh.maxZ - sh.minZ);
    const y = s.yBottom + trnd() * (s.yTop - s.yBottom);
    if (level.pointInSolid(x, y, z)) continue;
    const h = level.raycast(x, y, z, 0, -1, 0, 30, {});
    if (!h || faceAxisOf(h.solid, h.x, h.y, h.z) !== 3) continue;
    const hy = h.y + 1.6;
    if (level.pointInSolid(h.x, hy, h.z) || level.raycast(h.x, h.y + 0.05, h.z, 0, 1, 0, 1.8, {})) continue;
    if (quiet.some((q) => Math.hypot(q.x - h.x, q.y - h.y, q.z - h.z) < 10)) continue;
    if (level.sectionIndexAt(h.y) !== si) continue;
    out.push({ x: h.x, y: hy, z: h.z, floorY: h.y });
  }
  return out;
}

function setHead(ctx, p, yaw, pitch, xr) {
  const H = ctx.head;
  H.x = p.x;
  H.y = p.y;
  H.z = p.z;
  const cp = Math.cos(pitch);
  H.fx = -Math.sin(yaw) * cp;
  H.fy = Math.sin(pitch);
  H.fz = -Math.cos(yaw) * cp;
  H.rx = Math.cos(yaw);
  H.ry = 0;
  H.rz = -Math.sin(yaw);
  // up = right x forward
  H.ux = H.ry * H.fz - H.rz * H.fy;
  H.uy = H.rz * H.fx - H.rx * H.fz;
  H.uz = H.rx * H.fy - H.ry * H.fx;
  H.tanH = xr ? 1.45 : Math.tan((70 * Math.PI) / 360) * (16 / 9);
  H.tanV = xr ? 1.3 : Math.tan((70 * Math.PI) / 360);
  const L = ctx.lantern;
  L.x = p.x + H.rx * 0.2;
  L.y = p.y - 0.25;
  L.z = p.z + H.rz * 0.2;
  L.ax = H.fx;
  L.ay = H.fy;
  L.az = H.fz;
  const B = ctx.body;
  B.x = p.x;
  B.y = p.y - 0.5;
  B.z = p.z;
  B.footY = p.floorY != null ? p.floorY : p.y - 1.6;
  B.grounded = true;
}

const onFace = (r, i) => {
  const s = r.solid[i];
  const a = r.axis[i];
  const k = a >> 1;
  const v = [r.pos[i * 3], r.pos[i * 3 + 1], r.pos[i * 3 + 2]];
  const lo = [s.minX, s.minY, s.minZ];
  const hi = [s.maxX, s.maxY, s.maxZ];
  const plane = a & 1 ? hi[k] + 0.003 : lo[k] - 0.003;
  if (Math.abs(v[k] - plane) > 1e-3) return false;
  for (let c = 0; c < 3; c++) if (c !== k && (v[c] < lo[c] - 1e-3 || v[c] > hi[c] + 1e-3)) return false;
  return true;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. spawning on the real level: out of view, 2-9 m, on a face, never in a solid, never in a quiet zone, more deeper
// ---------------------------------------------------------------------------------------------------------------------------------
const events = [];
const bus = { on: () => () => {}, emit: (t, p) => events.push([t, { ...p }]) };
{
  let spawns = 0;
  let inViewN = 0;
  let distBad = 0;
  let solidBad = 0;
  let quietBad = 0;
  let faceBad = 0;
  let liveFaceBad = 0;
  let maxRays = 0;
  const perSec = [];
  const states = new Set();
  for (const xr of [false, true]) {
    for (let si = 0; si < level.sections.length; si++) {
      const pts = standPoints(si, 3);
      const r = new Roaches(bus, { seed: 99 + si });
      r.reset(level);
      r.setHotspots(remains);
      r.audit = [];
      const ctx = makeRoachCtx();
      ctx.on = true;
      let alive = 0;
      let frames = 0;
      for (const p of pts) {
        r.clear();
        for (let f = 0; f < 900; f++) {
          // look around: a slow turn, now and then a quick glance back, pitch up and down
          const yaw = f * 0.012 + (f % 300 > 280 ? Math.PI : 0);
          const pitch = Math.sin(f * 0.02) * 0.6;
          setHead(ctx, p, yaw, pitch, xr);
          r.update(1 / 72, ctx);
          maxRays = Math.max(maxRays, r.raysThisFrame);
          for (let i = 0; i < ROACH.pool; i++) {
            if (r.st[i] === S.FREE) continue;
            states.add(r.st[i]);
            if (!onFace(r, i)) liveFaceBad++;
          }
          if (f > 300) {
            alive += r.alive;
            frames++;
          }
        }
      }
      for (const a of r.audit) {
        spawns++;
        if (a.inView || inView(a.head, a.x, a.y, a.z)) inViewN++;
        const d = Math.hypot(a.x - a.head.x, a.y - a.head.y, a.z - a.head.z);
        if (d < ROACH.rMin - 1e-6 || d > ROACH.rMax + 1e-6) distBad++;
        const n = [0, 0, 0];
        n[a.axis >> 1] = a.axis & 1 ? 1 : -1;
        if (level.pointInSolid(a.x + n[0] * 0.012, a.y + n[1] * 0.012, a.z + n[2] * 0.012) || level.pointInSolid(a.x, a.y, a.z)) solidBad++;
        if (quiet.some((q) => Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z) < ROACH.quiet)) quietBad++;
        if (faceAxisOf(a.solid, a.x - n[0] * 0.003, a.y - n[1] * 0.003, a.z - n[2] * 0.003) !== a.axis) faceBad++;
      }
      if (!xr) perSec.push(frames ? alive / frames : 0);
    }
  }
  ok(spawns > 600, `spawning: ${spawns} roaches appeared around 24 standing places x 2 frustums (often)`);
  ok(inViewN === 0, `spawning: none inside the view frustum when it appears (${inViewN}), desktop and the wider headset frustum`);
  ok(distBad === 0, `spawning: every one 2-9 m from the head (${distBad} outside)`);
  ok(solidBad === 0, `spawning: never inside a solid, nothing standing on its spot (${solidBad})`);
  ok(quietBad === 0, `spawning: never within ${ROACH.quiet} m of the spawn or a checkpoint (${quietBad})`);
  ok(faceBad === 0 && liveFaceBad === 0, `on the surfaces: every one appears on the face it stands on (${faceBad}) and stays on that face, inside it, every frame (${liveFaceBad})`);
  ok(maxRays <= ROACH.raysPerFrame, `ray budget: at most ${ROACH.raysPerFrame} rays in any frame (max ${maxRays})`);
  const sh = perSec.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  const dp = perSec.slice(5).reduce((a, b) => a + b, 0) / 3;
  ok(dp > sh * 1.4, `more of them the deeper you go: S1-S3 ${sh.toFixed(1)} alive on average, S6-S8 ${dp.toFixed(1)} (${perSec.map((x) => x.toFixed(1)).join(' ')})`);
  ok([S.IDLE, S.DART, S.FREEZE, S.HIDE].every((s) => states.has(s)), `cockroach gait: idle, dart, freeze and hide all occur (${[...states].sort().join(',')})`);
}

// standing AT a checkpoint: nothing within the quiet radius
{
  const r = new Roaches(bus, { seed: 5 });
  r.reset(level);
  r.audit = [];
  const ctx = makeRoachCtx();
  ctx.on = true;
  for (const q of quiet.slice(0, 5)) {
    for (let f = 0; f < 600; f++) setHead(ctx, { x: q.x, y: q.y + 1.2, z: q.z, floorY: q.y }, f * 0.02, 0, false), r.update(1 / 72, ctx);
  }
  ok(r.audit.every((a) => quiet.every((q) => Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z) >= ROACH.quiet)), `quiet zones: at the spawn and the checkpoints none appear within ${ROACH.quiet} m (${r.audit.length} further out)`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. determinism
// ---------------------------------------------------------------------------------------------------------------------------------
function runTrace(seed, frames = 1500) {
  tr = 777;
  const p = standPoints(6, 1)[0];
  const r = new Roaches(null, { seed });
  r.reset(level);
  r.setHotspots(remains);
  const ctx = makeRoachCtx();
  ctx.on = true;
  for (let f = 0; f < frames; f++) {
    setHead(ctx, p, f * 0.01, 0, false);
    if (f === 700) r.burstAt(p.x, p.y - 0.8, p.z, true);
    r.update(1 / 72, ctx);
  }
  return { pos: Array.from(r.pos), st: Array.from(r.st), stats: { ...r.stats } };
}
{
  const a = runTrace(42);
  const b = runTrace(42);
  const c = runTrace(43);
  ok(JSON.stringify(a) === JSON.stringify(b), `deterministic: the same seed and inputs give the same roaches, bit for bit (${a.stats.spawns} spawns)`);
  ok(JSON.stringify(a.pos) !== JSON.stringify(c.pos), 'deterministic: another seed scatters them differently');
  const src = ['sim/roaches.js', 'render/roachView.js', 'audio/roachSfx.js'].map((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
  ok(src.every((s) => !/Math\.random\s*\(/.test(s)), 'no Math.random() in the sim, the view or the sounds');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. cap per tier, governor, off
// ---------------------------------------------------------------------------------------------------------------------------------
{
  tr = 31337;
  const p = standPoints(7, 1)[0];
  const capRun = (tier, gov) => {
    const r = new Roaches(null, { seed: 7 });
    r.reset(level);
    r.popMul = 20;
    const ctx = makeRoachCtx();
    ctx.on = true;
    ctx.tier = tier;
    ctx.gov = gov;
    let max = 0;
    for (let f = 0; f < 2400; f++) {
      setHead(ctx, p, f * 0.004, 0, false);
      ctx.lantern.k = 0; // no light: they stay
      r.update(1 / 72, ctx);
      max = Math.max(max, r.alive);
    }
    return { max, cap: r.cap, r, ctx };
  };
  const q = capRun('quest', 0);
  const h = capRun('high', 0);
  const l = capRun('low', 0);
  ok(q.cap === 48 && q.max <= 48 && q.max >= 40, `cap: Quest 48 (at most ${q.max} alive with the population pinned high)`);
  ok(h.cap === 96 && h.max <= 96 && h.max >= 70, `cap: desktop 96 (at most ${h.max})`);
  ok(l.cap === 32 && l.max <= 32, `cap: low 32 (at most ${l.max})`);
  const g1 = capRun('quest', 1);
  const g2 = capRun('quest', 2);
  const g3 = capRun('quest', 3);
  ok(g1.cap === 28 && g1.max <= 28 && g2.cap === 16 && g2.max <= 16, `governor: level 1 -> ${g1.cap} (max ${g1.max}), level 2 -> ${g2.cap} (max ${g2.max})`);
  ok(g3.max === 0 && g3.r.alive === 0, 'governor: level >= 3 -> none');
  // stepping the governor up mid-run: the extras go and hide, nothing pops
  const r = q.r;
  const ctx = q.ctx;
  ctx.gov = 2;
  let overAfter = 0;
  for (let f = 0; f < 600; f++) {
    r.update(1 / 72, ctx);
    if (f > 420 && r.alive > r.cap) overAfter++;
  }
  ok(overAfter === 0 && r.alive <= 16, `governor up mid-run: the extras hide away within 6 s (${r.alive} left, cap ${r.cap})`);
  ctx.on = false; // the setting off / a cutscene / the menu
  r.update(1 / 72, ctx);
  ok(r.alive === 0 && r.smears === 0 && r.st.every((s) => s === S.FREE), 'off (the setting, a cutscene, the menu): every roach and smear gone at once');
  const s0 = sanitizeUxSettings(Object.assign({}, SETTINGS_DEFAULTS));
  const s1 = sanitizeUxSettings(Object.assign({}, SETTINGS_DEFAULTS, { roaches: false }));
  const s2 = sanitizeUxSettings(Object.assign({}, SETTINGS_DEFAULTS, { roaches: 'nope' }));
  ok(SETTINGS_DEFAULTS.roaches === true && s0.roaches === true && s1.roaches === false && s2.roaches === true, 'setting: roaches on by default, off stays off, junk reads as on');
  const ui = fs.readFileSync(path.join(SRC_DIR, 'ui/ui3d.js'), 'utf8');
  ok(/key: 'roaches', tab: 'display'[^\n]*desktop: true/.test(ui) && /key: 'roaches', tab: 'access'[^\n]*vr: true/.test(ui), 'setting: a Roaches switch on the Display tab (desktop) and on the Access page in a headset (the VR Display page is full)');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. fear and squish: the light, a hand, a boot
// ---------------------------------------------------------------------------------------------------------------------------------
// a big floor to play on: the widest ledge top of S3
const floor = level.solids.filter((s) => s.active !== false && s.maxX - s.minX > 4 && s.maxZ - s.minZ > 4 && level.sectionIndexAt(s.maxY) === 2).sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ))[0];
const fc = { x: (floor.minX + floor.maxX) / 2, z: (floor.minZ + floor.maxZ) / 2, y: floor.maxY };
function fixture(seed) {
  const r = new Roaches(bus, { seed });
  r.reset(level);
  r._quiet = new Float32Array(0); // (this fixture may lie near a checkpoint)
  const ctx = makeRoachCtx();
  ctx.on = true;
  ctx.tier = 'high';
  // the head 4 m away looking away (no spawns in view anyway), the lantern dark, still
  setHead(ctx, { x: fc.x + 4, y: fc.y + 1.6, z: fc.z, floorY: fc.y }, -Math.PI / 2, 0, false);
  ctx.lantern.k = 0;
  r.target = 0;
  r.update(1 / 72, ctx);
  r.clear();
  r.popMul = 0; // nobody else
  const i = r.placeAt(floor, 3, fc.x, fc.y, fc.z, S.IDLE, 0);
  r.tmr[i] = 50;
  return { r, ctx, i };
}
const dist3 = (r, i, p) => Math.hypot(r.pos[i * 3] - p.x, r.pos[i * 3 + 1] - p.y, r.pos[i * 3 + 2] - p.z);
{
  // the lantern: shone at it from 3.5 m in the cone -> it runs, away from the light, then hides
  const { r, ctx, i } = fixture(11);
  for (let f = 0; f < 72; f++) r.update(1 / 72, ctx);
  ok(r.st[i] === S.IDLE && Math.hypot(r.pos[i * 3] - fc.x, r.pos[i * 3 + 2] - fc.z) < 1e-6 && Math.abs(r.pos[i * 3 + 1] - fc.y - 0.003) < 1e-4, 'fear: in the dark, out of reach, it sits (idle), 3 mm off the floor');
  const L = ctx.lantern;
  L.x = fc.x + 2.5;
  L.y = fc.y + 1.4;
  L.z = fc.z + 1.0;
  const d = Math.hypot(fc.x - L.x, fc.y - L.y, fc.z - L.z);
  L.ax = (fc.x - L.x) / d;
  L.ay = (fc.y - L.y) / d;
  L.az = (fc.z - L.z) / d;
  L.k = 1;
  let t = 0;
  while (r.st[i] !== S.FLEE && t < 1) {
    r.update(1 / 72, ctx);
    t += 1 / 72;
  }
  ok(r.st[i] === S.FLEE && t <= 0.3, `light: the lantern's cone on it at ${d.toFixed(1)} m -> it runs within ${t.toFixed(2)} s`);
  const d0 = dist3(r, i, L);
  for (let f = 0; f < 36 && r.st[i] === S.FLEE; f++) r.update(1 / 72, ctx);
  ok(dist3(r, i, L) > d0 + 0.1, `light: it runs AWAY from the lantern (${d0.toFixed(2)} -> ${dist3(r, i, L).toFixed(2)} m)`);
  // the light off it: it calms, then hides (gone into a crack) or freezes
  L.ax = -L.ax;
  L.az = -L.az;
  L.ay = 0;
  L.x += 50;
  let gone = false;
  for (let f = 0; f < 72 * 8; f++) {
    r.update(1 / 72, ctx);
    if (r.st[i] === S.FREE) {
      gone = true;
      break;
    }
  }
  ok(gone || r.st[i] === S.HIDE || r.st[i] === S.FREEZE || r.st[i] === S.DART, `light: once out of it, it hides (gone into a crack: ${gone}) or freezes`);
  // the lantern held at 1.5 m, aimed elsewhere: near enough to scare
  const f2 = fixture(12);
  f2.ctx.lantern.x = fc.x + 1.2;
  f2.ctx.lantern.y = fc.y + 0.8;
  f2.ctx.lantern.z = fc.z;
  f2.ctx.lantern.ax = 1;
  f2.ctx.lantern.ay = 0;
  f2.ctx.lantern.az = 0;
  f2.ctx.lantern.k = 1;
  for (let f = 0; f < 30; f++) f2.r.update(1 / 72, f2.ctx);
  ok(f2.r.st[f2.i] === S.FLEE, 'light: the lantern close by (1.4 m) scares it even off its cone');
  const f3 = fixture(13);
  f3.ctx.lantern.x = fc.x + 4;
  f3.ctx.lantern.y = fc.y + 1;
  f3.ctx.lantern.z = fc.z;
  f3.ctx.lantern.ax = 1;
  f3.ctx.lantern.ay = 0;
  f3.ctx.lantern.az = 0;
  f3.ctx.lantern.k = 1;
  for (let f = 0; f < 72; f++) f3.r.update(1 / 72, f3.ctx);
  ok(f3.r.st[f3.i] === S.IDLE, 'light: 4 m away with the lantern turned the other way, it stays');
}
{
  // a hand 0.4 m off: it runs from it
  const { r, ctx, i } = fixture(21);
  const hd = ctx.hands[1];
  hd.ok = true;
  hd.x = fc.x - 0.3;
  hd.y = fc.y + 0.25;
  hd.z = fc.z;
  for (let f = 0; f < 30; f++) r.update(1 / 72, ctx);
  ok(r.st[i] === S.FLEE && r.pos[i * 3] > fc.x + 0.05, `hand: a hand 0.4 m off -> it runs away from it (+${(r.pos[i * 3] - fc.x).toFixed(2)} m)`);
  // a fast swipe 1.4 m off scares it, a still hand there does not
  const a = fixture(22);
  a.ctx.hands[0].ok = true;
  a.ctx.hands[0].x = fc.x;
  a.ctx.hands[0].y = fc.y + 1.3;
  a.ctx.hands[0].z = fc.z;
  for (let f = 0; f < 40; f++) a.r.update(1 / 72, a.ctx);
  const still = a.r.st[a.i];
  for (let f = 0; f < 20; f++) {
    a.ctx.hands[0].z += 0.04; // 2.9 m/s
    a.r.update(1 / 72, a.ctx);
  }
  ok(still === S.IDLE && a.r.st[a.i] === S.FLEE, 'hand: a still hand 1.3 m above does nothing, a fast swipe there sends it running');
  // the palm on it: squished, the event, a smear that fades and frees the slot
  const b = fixture(23);
  events.length = 0;
  b.ctx.hands[1].ok = true;
  b.ctx.hands[1].x = fc.x + 0.03;
  b.ctx.hands[1].y = fc.y + 0.04;
  b.ctx.hands[1].z = fc.z;
  b.r.update(1 / 72, b.ctx);
  const sq = events.filter((e) => e[0] === 'roach:squish');
  ok(b.r.st[b.i] === S.SMEAR && sq.length === 1 && Math.abs(sq[0][1].x - fc.x) < 0.01 && b.r.stats.squished === 1, 'squish: a palm on it -> a smear and one roach:squish {x,y,z} where it was');
  b.ctx.hands[1].ok = false;
  let life = 0;
  while (b.r.st[b.i] === S.SMEAR && life < 30) {
    b.r.update(1 / 10, b.ctx);
    life += 0.1;
  }
  ok(Math.abs(life - ROACH.smear) < 0.25 && b.r.st[b.i] === S.FREE, `squish: the smear lies there ${life.toFixed(1)} s, then the slot is free`);
  // a boot: walking over it squishes it, standing beside it does not
  const c = fixture(24);
  const B = c.ctx.body;
  B.x = fc.x - 0.12;
  B.z = fc.z;
  B.footY = fc.y;
  B.vx = B.vy = B.vz = 0;
  B.grounded = true;
  c.ctx.head.x = fc.x - 0.12; // (the head above it: the body fear needs speed)
  for (let f = 0; f < 5; f++) c.r.update(1 / 72, c.ctx);
  const standing = c.r.st[c.i];
  B.vx = 1.6;
  c.r.update(1 / 72, c.ctx);
  ok(standing !== S.SMEAR && c.r.st[c.i] === S.SMEAR, 'squish: a boot standing still beside it does not, walking over it does');
  // never hurts the player: the sim has no damage path at all
  const src = fs.readFileSync(path.join(SRC_DIR, 'sim/roaches.js'), 'utf8');
  ok(!/\bhealth\b|\.damage\(|'health:|'player:death'|physics\.kill/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')), 'harmless: no health / damage / death path in the sim');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5. the crack burst
// ---------------------------------------------------------------------------------------------------------------------------------
{
  // a wall: a vertical face somewhere in S6 with the player beside it
  tr = 4242;
  const p = standPoints(5, 6).find((q) => [0, 1, 2, 3].some((k) => level.raycast(q.x, q.y - 0.6, q.z, Math.cos(k * 1.57), 0, Math.sin(k * 1.57), 2.5, {})));
  const k = [0, 1, 2, 3].find((kk) => level.raycast(p.x, p.y - 0.6, p.z, Math.cos(kk * 1.57), 0, Math.sin(kk * 1.57), 2.5, {}));
  const h = level.raycast(p.x, p.y - 0.6, p.z, Math.cos(k * 1.57), 0, Math.sin(k * 1.57), 2.5, {});
  const hand = { x: h.x - Math.cos(k * 1.57) * 0.1, y: h.y, z: h.z - Math.sin(k * 1.57) * 0.1 };
  const r = new Roaches(bus, { seed: 77 });
  r.reset(level);
  const ctx = makeRoachCtx();
  ctx.on = true;
  ctx.tier = 'high';
  setHead(ctx, p, k * 1.57 - Math.PI / 2, 0, false);
  ctx.lantern.k = 0;
  r.popMul = 0;
  r.update(1 / 72, ctx);
  events.length = 0;
  ok(r.burstAt(hand.x, hand.y, hand.z, true), 'burst: queued beside a hand on a wall (debug burst)');
  let firstAt = -1;
  let maxAlive = 0;
  for (let f = 0; f < 72 * 3; f++) {
    r.update(1 / 72, ctx);
    if (r.alive > 0 && firstAt < 0) firstAt = f;
    maxAlive = Math.max(maxAlive, r.alive);
  }
  const be = events.filter((e) => e[0] === 'roach:burst');
  ok(be.length === 1 && be[0][1].n >= ROACH.burst.n[0] && be[0][1].n <= ROACH.burst.n[1], `burst: one roach:burst {x,y,z,n} (n ${be.length ? be[0][1].n : '-'})`);
  ok(be.length === 1 && Math.hypot(be[0][1].x - hand.x, be[0][1].y - hand.y, be[0][1].z - hand.z) < 1.4, 'burst: the crack is on the wall beside the hand (< 1.4 m)');
  ok(firstAt >= 0 && firstAt <= 6 && maxAlive >= ROACH.burst.n[0] - 1, `burst: they pour out within ${firstAt} frames, one after another (${maxAlive} out at once)`);
  ok(r.stats.bursts === 1 && r.stats.squished === 0, 'burst: they run off (a stream, no damage)');
  // the chance per grab: deterministic, nothing in S1, more deeper, the cooldown
  const grabRun = (seed, si) => {
    const g = new Roaches(null, { seed });
    g.reset(level);
    const y = (level.sections[si].yTop + level.sections[si].yBottom) / 2;
    let n = 0;
    for (let j = 0; j < 400; j++) {
      g.t += 50; // past the cooldown
      if (g.grab(1e4, y, 1e4)) n++; // (far from any quiet point; no wall there, so nothing pours: the decision is what counts)
      g._bq.stage = 0;
    }
    return n;
  };
  const s1 = grabRun(5, 0);
  const s8 = grabRun(5, 7);
  ok(s1 === 0 && s8 > 40 && s8 < 110 && grabRun(5, 7) === s8, `burst: per grab, none in S1, ${s8} / 400 in S8 (~${(ROACH.burst.chance[7] * 100).toFixed(0)} %), the same again with the same seed`);
  const g = new Roaches(null, { seed: 5 });
  g.reset(level);
  g.t = 100;
  g.burstAt(1e4, -300, 1e4, true);
  g._bq.stage = 0;
  let during = 0;
  for (let j = 0; j < 200; j++) if (g.grab(1e4, -300, 1e4)) during++;
  ok(during === 0, `burst: none within the ${ROACH.burst.cooldown} s cooldown`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 6. events: the ticking, a scatter
// ---------------------------------------------------------------------------------------------------------------------------------
{
  tr = 999;
  const p = standPoints(6, 1)[0];
  const evs = [];
  let frame = 0;
  const r = new Roaches({ on: () => () => {}, emit: (t, q) => evs.push([t, { ...q }, frame]) }, { seed: 3 });
  r.reset(level);
  r.popMul = 3;
  const ctx = makeRoachCtx();
  ctx.on = true;
  ctx.lantern.k = 0;
  for (let f = 0; f < 72 * 20; f++) {
    setHead(ctx, p, f * 0.006, 0, false);
    ctx.lantern.k = f > 72 * 15 ? 1 : 0; // the light comes on: they scatter
    frame = f;
    r.update(1 / 72, ctx);
  }
  const sk = evs.filter((e) => e[0] === 'roach:skitter');
  const sc = evs.filter((e) => e[0] === 'roach:scatter');
  const gaps = sk.slice(1).map((e, j) => (e[2] - sk[j][2]) / 72);
  ok(sk.length > 15 && sk.every((e) => e[1].n >= 1 && e[1].speed > 0 && Math.hypot(e[1].x - p.x, e[1].y - p.y, e[1].z - p.z) <= ROACH.skitter.range + 0.01), `events: ${sk.length} roach:skitter {x,y,z,n,speed} in 20 s from runners within ${ROACH.skitter.range} m`);
  ok(gaps.length > 0 && Math.min(...gaps) >= ROACH.skitter.gap[0] - 1 / 72, `events: the ticking is rate-limited (>= ${ROACH.skitter.gap[0]} s apart; min ${Math.min(...gaps).toFixed(2)} s)`);
  ok(sc.length >= 1 && sc.every((e) => e[1].n >= 2), `events: the light coming on -> roach:scatter {x,y,z,n} (${sc.length}, n ${sc.map((e) => e[1].n).join(',')})`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 7. budget: zero allocations, CPU per frame at the cap
// ---------------------------------------------------------------------------------------------------------------------------------
{
  tr = 2024;
  const p = standPoints(7, 1)[0];
  const quietBus = { on: () => () => {}, emit() {} };
  const r = new Roaches(quietBus, { seed: 1 });
  r.reset(level);
  r.setHotspots(remains);
  r.popMul = 20;
  const ctx = makeRoachCtx();
  ctx.on = true;
  ctx.tier = 'high';
  ctx.hands[0].ok = ctx.hands[1].ok = true;
  // (the harness passes only small integers into calls: a double argument to a call that is not inlined is boxed, and that would be
  // the harness allocating, not the sim)
  const head = (f) => {
    const H = ctx.head;
    const yaw = f * 0.003;
    const pitch = Math.sin(f * 0.01) * 0.3;
    const cp = Math.cos(pitch);
    H.x = p.x;
    H.y = p.y;
    H.z = p.z;
    H.fx = -Math.sin(yaw) * cp;
    H.fy = Math.sin(pitch);
    H.fz = -Math.cos(yaw) * cp;
    H.rx = Math.cos(yaw);
    H.ry = 0;
    H.rz = -Math.sin(yaw);
    H.ux = H.ry * H.fz - H.rz * H.fy;
    H.uy = H.rz * H.fx - H.rx * H.fz;
    H.uz = H.rx * H.fy - H.ry * H.fx;
    H.tanH = 1.4;
    H.tanV = 0.7;
    const L = ctx.lantern;
    L.x = p.x + H.rx * 0.2;
    L.y = p.y - 0.25;
    L.z = p.z + H.rz * 0.2;
    L.ax = H.fx;
    L.ay = H.fy;
    L.az = H.fz;
    const B = ctx.body;
    B.x = p.x;
    B.y = p.y - 0.5;
    B.z = p.z;
    B.footY = p.floorY;
    B.grounded = true;
  };
  const step = (f) => {
    head(f);
    ctx.lantern.k = 0.4 + 0.6 * ((f >> 8) & 1); // the light in pulses: flights, hides, refills
    ctx.hands[0].x = p.x - 0.3;
    ctx.hands[0].y = p.y - 0.5 + Math.sin(f * 0.1) * 0.2;
    ctx.hands[0].z = p.z - 0.4;
    ctx.hands[1].x = p.x + 0.3;
    ctx.hands[1].y = p.y - 0.5;
    ctx.hands[1].z = p.z - 0.4;
    r.update(1 / 72, ctx);
  };
  for (let f = 0; f < 60000; f++) step(f); // warm up: the pool full, every path compiled (the first ~40 k frames tier up and settle)
  const view = new RoachView({ renderer: { scene: new THREE.Scene() } });
  for (let f = 0; f < 200; f++) view.write(r);
  gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let f = 60000; f < 80000; f++) {
    step(f);
    view.write(r);
  }
  const grown = process.memoryUsage().heapUsed - h0;
  ok(grown < 32 * 1024, `zero allocation: 20 000 frames of sim + instance writes at ${r.alive} alive (spawning, fleeing, hiding, refilling; ${r.stats.spawns} spawns in all) grew the heap by ${(grown / 1024).toFixed(1)} KB (< 32 KB: < 2 B a frame, the measuring noise)`);
  // CPU per frame at the caps (1000 frames after a warm-up)
  const cpu = (tier) => {
    const q = new Roaches(quietBus, { seed: 2 });
    q.reset(level);
    q.setHotspots(remains);
    q.popMul = 20;
    ctx.tier = tier;
    for (let f = 0; f < 2000; f++) (step(f), q.update(1 / 72, ctx));
    let alive = 0;
    const t0 = process.hrtime.bigint();
    for (let f = 2000; f < 3000; f++) {
      setHead(ctx, p, f * 0.003, 0, false);
      ctx.lantern.k = 0.4 + 0.6 * ((f >> 8) & 1);
      q.update(1 / 72, ctx);
      view.write(q);
      alive += q.alive;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 1000;
    return { ms, alive: alive / 1000 };
  };
  const cq = cpu('quest');
  const ch = cpu('high');
  // the pure stress: the pool held FULL at the cap (dark, nothing to scare them, no lifetimes running out), 1000 frames
  const full = (tier) => {
    const q = new Roaches(quietBus, { seed: 4 });
    q.reset(level);
    q.popMul = 20;
    ctx.tier = tier;
    ctx.hands[0].ok = ctx.hands[1].ok = false;
    ctx.lantern.k = 0;
    for (let f = 0; f < 4000; f++) {
      head(f >> 4);
      ctx.lantern.k = 0;
      q.update(1 / 72, ctx);
      if (f === 1500) q.life.fill(1e9);
    }
    q.life.fill(1e9);
    let alive = 0;
    const t0 = process.hrtime.bigint();
    for (let f = 0; f < 1000; f++) {
      head(250);
      ctx.lantern.k = 0;
      q.update(1 / 72, ctx);
      view.write(q);
      alive += q.alive;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 1000;
    ctx.hands[0].ok = ctx.hands[1].ok = true;
    return { ms, alive: alive / 1000, cap: q.cap };
  };
  const fq = full('quest');
  const fh = full('high');
  ok(fq.alive >= 44 && fh.alive >= 80 && fq.ms < 0.15 && fh.ms < 0.25, `CPU stress at the cap: ${fq.ms.toFixed(4)} ms a frame with ${fq.alive.toFixed(0)} / ${fq.cap} alive (Quest), ${fh.ms.toFixed(4)} ms with ${fh.alive.toFixed(0)} / ${fh.cap} (desktop), sim + instance writes, 1000 frames`);
  console.log(`BUDGET roaches stress: quest ${fq.ms.toFixed(4)} ms/frame @${fq.alive.toFixed(1)}/${fq.cap}, desktop ${fh.ms.toFixed(4)} ms/frame @${fh.alive.toFixed(1)}/${fh.cap}`);
  ok(cq.ms < 0.15 && ch.ms < 0.25, `CPU: sim + instance writes ${cq.ms.toFixed(4)} ms a frame at ${cq.alive.toFixed(0)} alive (Quest cap 48), ${ch.ms.toFixed(4)} ms at ${ch.alive.toFixed(0)} (desktop cap 96), Node, 1000 frames`);
  console.log(`BUDGET roaches: cpu quest ${cq.ms.toFixed(4)} ms/frame @${cq.alive.toFixed(1)} alive, desktop ${ch.ms.toFixed(4)} ms/frame @${ch.alive.toFixed(1)} alive; heap growth ${(grown / 1024).toFixed(1)} KB / 20000 frames`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 8. the view: one InstancedMesh, 27 triangles a roach, the instances, the context glue
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const g = buildRoachGeometry();
  const tris = g.index.count / 3;
  ok(tris === ROACH_TRIS && tris >= 20 && tris <= 40, `model: ${tris} triangles (carapace 10, head 3, six legs 12, antennae 2)`);
  const rig = g.getAttribute('aRig');
  const parts = new Set();
  for (let i = 0; i < rig.count; i++) parts.add(rig.getX(i));
  ok(parts.size === 4 && g.getAttribute('normal') && g.getAttribute('position').count === rig.count, 'model: body, head, legs and antennae tagged for the vertex-shader gait');
  const scene = new THREE.Scene();
  const view = new RoachView({ renderer: { scene } });
  const meshes = [];
  scene.traverse((o) => o.isMesh && meshes.push(o));
  ok(meshes.length === 1 && meshes[0].isInstancedMesh && meshes[0].count === 0 && !meshes[0].visible, 'view: ONE InstancedMesh in the scene, hidden while empty (one draw call when shown)');
  ok(meshes[0].material.isShaderMaterial && meshes[0].material.fog === true && /fog_fragment/.test(meshes[0].material.fragmentShader) && /uLanternW/.test(meshes[0].material.fragmentShader), 'view: a shader material lit by the shared lantern uniforms, in the level\'s haze');
  const { r } = fixture(31);
  // add a wall roach and a smear
  const wall = level.solids.find((s) => s.active !== false && s.maxY - s.minY > 3 && s.maxZ - s.minZ > 3);
  const wi = r.placeAt(wall, 1, wall.maxX, (wall.minY + wall.maxY) / 2, (wall.minZ + wall.maxZ) / 2, S.DART, 0.7);
  const si2 = r.placeAt(floor, 3, fc.x + 0.5, fc.y, fc.z, S.IDLE, 0);
  r._squish(si2);
  r.alive = 2;
  ok(wi === 1 && si2 === 2, 'view fixture: slots 1 (wall) and 2 (smear)');
  const n = view.write(r);
  const m = view.mesh;
  ok(n === 3 && m.count === 3 && m.visible && view.stats.calls === 1 && view.stats.triangles === 3 * ROACH_TRIS, `view: 3 instances (2 roaches + a smear) = 1 call, ${view.stats.triangles} triangles`);
  const e = m.instanceMatrix.array;
  const col = (o, c) => [e[o + c * 4], e[o + c * 4 + 1], e[o + c * 4 + 2]];
  const len = (v) => Math.hypot(...v);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let basisOk = true;
  for (let j = 0; j < 3; j++) {
    const o = j * 16;
    const X = col(o, 0);
    const Y = col(o, 1);
    const Z = col(o, 2);
    const sc = len(Y);
    if (Math.abs(len(X) - sc) > 1e-6 || Math.abs(len(Z) - sc) > 1e-6 || Math.abs(dot(X, Y)) > 1e-6 || Math.abs(dot(Y, Z)) > 1e-6 || Math.abs(dot(X, Z)) > 1e-6) basisOk = false;
  }
  const up1 = col(16, 1);
  ok(basisOk && up1[0] > 0 && Math.abs(up1[1]) < 1e-6 && col(0, 1)[1] > 0, 'view: each instance an orthogonal frame with its up axis on the face normal (the floor one up, the wall one out of the +x face)');
  ok(Math.abs(e[12] - r.pos[0]) < 1e-6 && Math.abs(e[16 + 12] - r.pos[3]) < 1e-6 && Math.abs(len(col(0, 1)) - ROACH.len * r.sz[0]) < 1e-6, 'view: at the roach\'s position, about 3.4 cm long x its size');
  ok(view.anim[2 * 4 + 1] < 0 && view.anim[1] >= 0 && view.anim[4 + 1] >= 0, 'view: the smear is flagged (negative speed), the runners are not');
  r.clear();
  ok(view.write(r) === 0 && !m.visible && view.stats.calls === 0, 'view: nothing alive -> hidden, no call');
  // the glue
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
  cam.position.set(1, 2, 3);
  cam.rotation.set(0, 0.5, 0);
  cam.updateMatrixWorld(true);
  const game = {
    renderer: { camera: cam, qualityTier: 'quest', governor: { level: 1 }, lantern: { matrixWorld: new THREE.Matrix4().makeTranslation(1.2, 1.7, 3), intensity: 6.5, visible: true }, lanternBase: 6.5 },
    player: { rx: 1, ry: 1.4, rz: 3, vx: 0.5, vy: 0, vz: 0, grounded: true, alive: true, landedThisStep: false },
    settings: { roaches: true },
    state: 'playing',
    victoryT: -1,
    deathScene: { active: false },
    handOrigin: (h, o) => Object.assign(o, { x: h === 'left' ? 0.7 : 1.3, y: 1.6, z: 2.6 }),
    roaches: null,
  };
  const c2 = roachContext(game, makeRoachCtx());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  ok(c2.on && c2.tier === 'quest' && c2.gov === 1 && Math.abs(c2.head.fx - fwd.x) < 1e-6 && Math.abs(c2.head.fz - fwd.z) < 1e-6 && Math.abs(c2.head.tanV - Math.tan((35 * Math.PI) / 180)) < 1e-6, 'glue: the head pose and frustum from the camera, the tier, the governor level');
  ok(Math.abs(c2.lantern.x - 1.2) < 1e-6 && c2.lantern.k === 1 && c2.hands[0].ok && c2.hands[1].x === 1.3 && c2.body.grounded && Math.abs(c2.body.footY - (1.4 - 0.38)) < 1e-6, 'glue: the lantern, the hands, the body and its feet');
  for (const [k, v] of [['settings', { roaches: false }], ['state', 'dead'], ['victoryT', 2], ['deathScene', { active: true }], ['state', 'menu']]) {
    const g2 = { ...game, [k]: v };
    ok(!roachContext(g2, makeRoachCtx()).on, `glue: off when ${k} = ${JSON.stringify(v)}`);
  }
  const g3 = { ...game, xrActive: true };
  const c3 = roachContext(g3, makeRoachCtx());
  ok(c3.head.tanH >= 1.45 && c3.head.tanV >= 1.3, 'glue: in a headset the frustum is at least as wide as the headset\'s (both eyes)');
  // view.update drives the sim; paused keeps them as they are
  const sim = new Roaches(null, { seed: 9 });
  sim.reset(level);
  game.roaches = sim;
  cam.position.set(p0().x, p0().y, p0().z);
  cam.updateMatrixWorld(true);
  game.player.rx = p0().x;
  game.player.ry = p0().y - 0.5;
  game.player.rz = p0().z;
  game.renderer.lantern.intensity = 0;
  for (let f = 0; f < 600; f++) view.update(1 / 72, game);
  const before = sim.alive;
  const snap = Array.from(sim.pos);
  game.state = 'paused';
  for (let f = 0; f < 60; f++) view.update(1 / 72, game);
  ok(before > 0 && JSON.stringify(snap) === JSON.stringify(Array.from(sim.pos)) && view.mesh.count >= before, `view.update: steps the sim (${before} alive after 600 frames); paused, they hold still`);
  game.state = 'playing';
  game.settings.roaches = false;
  view.update(1 / 72, game);
  ok(sim.alive === 0 && view.mesh.count === 0 && !view.mesh.visible, 'view.update: the setting off -> none, nothing drawn');
  view.dispose();
  ok(!scene.children.includes(view.mesh), 'view: dispose takes it out of the scene');
}
function p0() {
  tr = 55;
  return p0.c || (p0.c = standPoints(4, 1)[0]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 9. the sounds (mock audio context) and the captions
// ---------------------------------------------------------------------------------------------------------------------------------
{
  globalThis.window = { AudioContext: MockAudioContext, addEventListener() {} };
  const { AudioManager3D } = await import(srcUrl('audio/audio3d.js'));
  const { roachGain } = await import(srcUrl('audio/roachSfx.js'));
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  const play = () => {
    const b = new EventBus();
    const audio = new AudioManager3D(b, Object.assign({}, SETTINGS_DEFAULTS));
    audio.unlock();
    audio.ctx.currentTime = 1;
    const out = [];
    const evs = [
      ['roach:skitter', { x: 2, y: 1, z: 1, n: 1, speed: 0.6 }],
      ['roach:skitter', { x: -3, y: 1, z: 2, n: 4, speed: 1.4 }],
      ['roach:scatter', { x: 1, y: 0, z: -3, n: 5 }],
      ['roach:squish', { x: 0.2, y: 0.5, z: -0.3 }],
      ['roach:burst', { x: 0.6, y: 1.2, z: -0.5, n: 7 }],
    ];
    const NAME = { 'roach:skitter': 'roachSkit', 'roach:scatter': 'roachScat', 'roach:squish': 'roachSquish', 'roach:burst': 'roachBurst' };
    for (const [t, p] of evs) {
      audio.ctx.currentTime += 2; // the last one has ended
      b.emit(t, p);
      const v = audio._voices.find((x) => x.alive && !x.dying && x.name === NAME[t] && x.t0 > audio.ctx.currentTime);
      out.push({ t, added: v ? 1 : 0, name: v ? v.name : null, nodes: v ? v.nodes.length : 0, events: v ? v.nodes.reduce((s, nd) => s + Object.values(nd).filter((x) => x && typeof x.events === 'number').reduce((a, x) => a + x.events, 0), 0) : 0 });
    }
    return out;
  };
  const a = play();
  const b = play();
  console.warn = realWarn;
  ok(a.every((x) => x.added === 1 && /^roach/.test(x.name)) && warnings.length === 0, `sounds: each event plays one voice on the mock context, no warnings (${a.map((x) => x.name).join(', ')})`);
  ok(JSON.stringify(a) === JSON.stringify(b), 'sounds: designed, not random: the same events schedule the same graph twice');
  ok(roachGain(0) === 1 && roachGain(3) > 0.4 && roachGain(3) < 0.5 && roachGain(9) < 0.13 && roachGain(12) === 0, `sounds: a small thing's loudness (3 m ${roachGain(3).toFixed(2)}, 9 m ${roachGain(9).toFixed(2)}, 12 m silent)`);
  // captions: low priority, tasteful
  ok(['roach:skitter', 'roach:scatter', 'roach:squish', 'roach:burst'].every((t) => CAPTION_EVENTS.includes(t)), 'captions: the four roach events are listened to');
  ok(captionForEvent('roach:skitter', { n: 1 }) === null && captionForEvent('roach:skitter', { n: 3 }) && captionForEvent('roach:scatter', { n: 2 }) === null && captionForEvent('roach:burst', {}).sev === 1 && captionForEvent('roach:squish', {}).sev === 0, 'captions: one ticking roach is not captioned, several are; a scatter of 3+, the squish and the burst are');
  const tk = new CaptionTracker();
  tk.push('creature:attack', {});
  tk.push('creature:call', { distance: 10 });
  tk.push('platform:crumble', {});
  const took = tk.push('roach:burst', { x: 0, y: 0, z: 0, n: 6 });
  ok(took === null && tk.lines.every((l) => l.on && !/Skittering/.test(l.text)), 'captions: a roach caption never pushes a more important line off');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 10. the wiring
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const gsrc = fs.readFileSync(path.join(SRC_DIR, 'game.js'), 'utf8');
  ok(/new Roaches\(this\._runBus/.test(gsrc) && /attract \? null : new Roaches/.test(gsrc), 'wiring: a sim per run on the run bus (none in the menu\'s attract flight)');
  ok((gsrc.match(/if \(this\.roaches\) this\.roaches\.clear\(\)/g) || []).length === 2, 'wiring: a respawn and a warp empty the floor');
  ok(/new RoachView\(this\)/.test(gsrc) && /this\.roachView\.update\(dt, this\)/.test(gsrc), 'wiring: the view is made and updated in _updateViews');
  ok(/roaches: \{\s*\n\s*state:/.test(gsrc) && /burst: \(\) =>/.test(gsrc) && /clear: \(\) =>/.test(gsrc), 'wiring: AT3D.debug.roaches.{state, burst, clear}');
  const asrc = fs.readFileSync(path.join(SRC_DIR, 'audio/audio3d.js'), 'utf8');
  ok(/ROACH_EVENTS/.test(asrc) && /Object\.assign\(AudioManager3D\.prototype, ROACH_SFX\)/.test(asrc), 'wiring: the sounds are mixed into the audio manager');
  const r = new Roaches(new EventBus(), { seed: 1 });
  r.reset(level);
  let got = 0;
  r.grab = () => got++;
  r.bus.emit('climb:grab', { hand: 'left', x: 1, y: -50, z: 2 });
  ok(got === 0 || got === 1, 'wiring: the sim hears climb:grab on its bus');
  const r2 = new Roaches(new EventBus(), { seed: 1 });
  r2.reset(level);
  const before = r2._grabs;
  r2.bus.emit('climb:grab', { hand: 'left', x: 1, y: -50, z: 2 });
  ok(r2._grabs === before + 1, 'wiring: a grab on the bus counts toward the burst dice');
  r2.destroy();
  r2.bus.emit('climb:grab', { hand: 'left', x: 1, y: -50, z: 2 });
  ok(r2._grabs === before + 1, 'wiring: destroy() unsubscribes');
  ok(hash01(1) !== hash01(2) && hash01(5) === hash01(5), 'hash01: deterministic');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
