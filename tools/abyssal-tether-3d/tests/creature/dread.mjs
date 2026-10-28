// The Mason's dread behaviours (Node): the stare (it stops dead on first sight, a low call, then surges at you) and the lead (it aims where
// you will be). Mason only; the small variants never stare.
//   node dread.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, CREATURE_TUNING } = await import(srcUrl('sim/creature3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const S = CREATURE_TUNING.stare;

function run(seed, variant, secs, sec = 5) {
  const L = new Level3D(LEVEL_DATA_3D, DIFFICULTY.normal.levelVariant);
  const bus = new EventBus();
  const ev = { stares: [], bursts: [], calls: [] };
  let t = 0;
  bus.on('creature:stare', (e) => ev.stares.push({ t, d: e.distance }));
  bus.on('creature:burst', (e) => ev.bursts.push({ t, reason: e.reason }));
  bus.on('creature:call', (e) => e.stare && ev.calls.push(t));
  const c = new Creature3D(L, DIFFICULTY.normal, bus, { seed, variant });
  const cp = L.sections[sec].checkpoint;
  const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
  c.reset(p);
  c.setSection(sec, L.sections[sec], p);
  let nan = false;
  for (let i = 0; i < secs * 60; i++) {
    t = i / 60;
    // the player climbs slowly down the shaft, a little to and fro: noisy enough to be heard, slow enough to be hunted
    p.vx = Math.cos(t * 0.5) * 3;
    p.vz = -Math.sin(t * 0.5) * 3;
    p.vy = -0.5;
    p.x = cp.x + Math.sin(t * 0.5) * 6;
    p.z = cp.z + Math.cos(t * 0.5) * 6;
    p.y = cp.y - ((0.5 * t) % 30);
    c.update(1 / 60, p, t);
    if (!isFinite(c.x + c.y + c.z)) nan = true;
    if (c.caughtPlayer) {
      c.reset(p);
      c.setSection(sec, L.sections[sec], p);
    }
  }
  return { ev, c, nan };
}

let stares = 0;
let followed = 0;
let spaced = true;
let nan = false;
for (let seed = 1; seed <= 12; seed++) {
  const r = run(seed, undefined, 120);
  nan = nan || r.nan;
  stares += r.ev.stares.length;
  for (let i = 0; i < r.ev.stares.length; i++) {
    const s = r.ev.stares[i];
    ok(s.d >= S.min - 1 && s.d <= S.max + 1, `seed ${seed}: it stares from ${s.d.toFixed(1)} m (inside ${S.min}-${S.max} m)`);
    if (r.ev.bursts.some((b) => b.reason === 'stare' && b.t >= s.t + S.durMin - 0.1 && b.t <= s.t + S.durMax + 0.5)) followed++;
    if (i > 0 && s.t - r.ev.stares[i - 1].t < S.cooldown - 0.5) spaced = false;
  }
  ok(r.ev.calls.length === r.ev.stares.length, `seed ${seed}: every stare comes with a call`);
}
ok(stares >= 3, `it stares now and then (${stares} stares over 12 runs of 120 s)`);
ok(followed >= stares * 0.6, `a stare ends in a surge (${followed} of ${stares})`);
ok(spaced, `stares keep the ${S.cooldown} s cooldown`);
ok(!nan, 'no NaN');
{
  let v = 0;
  for (let seed = 1; seed <= 6; seed++) v += run(seed, 'skitterling', 60, 6).ev.stares.length;
  ok(v === 0, 'a skitterling never stares');
}
console.log(fails ? `FAILED: ${fails}` : 'ALL DREAD CHECKS PASS');
process.exit(fails ? 1 : 0);
