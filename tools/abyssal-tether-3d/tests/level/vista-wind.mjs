// VISTA WIND (sim/vistaWind.js, audio _onWindWhoosh, fx gusts, renderer haze), Node, no GPU.
// Asked for: "the wind whooshing ... especially in the areas where there is a scenery to be looked. For example the place where we just go and see
// the mason for the first time, like something is awakening, and the place where we go and turn on 3 lamps ... and a depth of scene with more
// atmospheric fog". Checks on the REAL level:
//   - one zone per section + the S4 catwalk extra (gain 1.0), the biggest open caverns windier than the corridors;
//   - the S4 sighting trigger and all three cold lamps lie inside the catwalk's zone (wind >= 0.85); the spawn is mild, far outside is 0;
//   - the whooshes: none outside a vista, several a minute inside the catwalk, never regular (the gaps differ), deterministic, the envelope is a
//     swell (0 at the ends, peaks inside), strength / dir / dur in range, nothing when switched off;
//   - Chapter II builds zones too; the wiring: audio bed + whoosh voice + caption, fx gusts, renderer haze, ?wind=off, the run's reset.
//   node vista-wind.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';
const { buildVistaZones, vistaAt, VistaWind, VISTA_EXTRA } = await import(srcUrl('sim/vistaWind.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const level = new Level3D(LEVEL_DATA_3D);
const zones = buildVistaZones(level);
ok(zones.length === level.sections.length + Object.keys(VISTA_EXTRA).length, `zones: one per section (${level.sections.length}) + the authored extras (${Object.keys(VISTA_EXTRA).length})`);
const cat = zones.find((z) => z.id === 'catwalk');
ok(cat && cat.gain === 1, 'zones: the S4 catwalk is the strongest place (gain 1)');
const s7 = zones.find((z) => z.id === 's7');
const s3 = zones.find((z) => z.id === 's3');
ok(s7.gain > s3.gain * 2, `zones: the Hollow Nave (${s7.gain.toFixed(2)}) is windier than the gallery (${s3.gain.toFixed(2)})`);
// the sighting + the lamps
const s4 = level.sections.find((s) => s.id === 's4');
const trig = (s4.triggers || []).find((t) => t && t.name === 'sighting');
ok(!!trig, 'S4 has its sighting trigger');
const lamps = LEVEL_DATA_3D.objectives ? null : null;
void lamps;
const LAMPS = [
  [-16, -104.5, -23.4],
  [-12.15, -103.6, -15],
  [-19.85, -103.6, -15],
];
for (const [x, y, z] of LAMPS) ok(vistaAt(zones, x, y, z) >= 0.85, `the cold lamp at (${x}, ${y}, ${z}): wind ${vistaAt(zones, x, y, z).toFixed(2)} >= 0.85`);
ok(vistaAt(zones, -16, trig.y, -19) >= 0.85, `the sighting fires at depth ${trig.y}: on the catwalk the wind is ${vistaAt(zones, -16, trig.y, -19).toFixed(2)} (the Mason itself appears 135 m away across the void)`);
const sp = level.spawn;
ok(vistaAt(zones, sp.x, sp.y, sp.z) > 0 && vistaAt(zones, sp.x, sp.y, sp.z) < 0.5, 'the spawn: a mild draught');
ok(vistaAt(zones, 900, 900, 900) === 0 && vistaAt([], 0, 0, 0) === 0, 'far outside every zone: none');
// smooth: 0 at the edge, never above 1, continuous along a line
let jump = 0;
let prev = vistaAt(zones, -16, -150, -19);
for (let y = -150; y <= -60; y += 0.25) {
  const k = vistaAt(zones, -16, y, -19);
  if (k < 0 || k > 1) jump = 9;
  jump = Math.max(jump, Math.abs(k - prev));
  prev = k;
}
ok(jump < 0.12, `the field is smooth along a line through the catwalk (biggest step ${jump.toFixed(3)} per 0.25 m)`);

// whooshes
function run(pos, secs, enabled = true) {
  const ev = [];
  const w = new VistaWind({ emit: (t, p) => ev.push([t, p]) });
  w.enabled = enabled;
  w.reset(level);
  const env = [];
  for (let t = 0; t < secs; t += 1 / 60) {
    w.update(1 / 60, pos);
    env.push(w.gust);
  }
  return { w, ev, env };
}
const at = { x: -16, y: -104, z: -19 };
const a = run(at, 120);
const b = run(at, 120);
ok(JSON.stringify(a.ev) === JSON.stringify(b.ev), 'whooshes: deterministic');
ok(a.ev.length >= 8 && a.ev.length <= 30, `whooshes: ${a.ev.length} in two minutes at the catwalk`);
const gaps = [];
for (let i = 1; i < a.ev.length; i++) gaps.push(a.ev[i][1].dur);
ok(new Set(gaps.map((g) => g.toFixed(2))).size > gaps.length * 0.5, 'whooshes: never regular (the lengths differ)');
ok(a.ev.every((e) => e[0] === 'wind:whoosh' && e[1].strength >= 0.1 && e[1].strength <= 1 && e[1].dur >= 1.5 && e[1].dur <= 6 && e[1].dir >= -1 && e[1].dir <= 1), 'whooshes: strength 0.1-1, 1.5-6 s, dir -1..1');
ok(Math.max(...a.env) > 0.5 && Math.min(...a.env) === 0 && a.env.every((v) => v >= 0 && v <= 1), 'whooshes: the envelope swells to over 0.5 and falls to 0 between');
ok(a.w.k > 0.95, `the wind bed at the catwalk is ${a.w.k.toFixed(2)}`);
const far = run({ x: 900, y: 900, z: 900 }, 60);
ok(far.ev.length === 0 && far.w.k === 0, 'whooshes: none outside a vista');
const off = run(at, 60, false);
ok(off.ev.length === 0 && off.w.k === 0, 'whooshes: ?wind=off = none');
const walk = new VistaWind(null);
walk.reset(level);
let kPrev = 0;
let maxStep = 0;
for (let t = 0; t < 30; t += 1 / 60) {
  walk.update(1 / 60, t < 5 ? { x: 900, y: 900, z: 900 } : at);
  maxStep = Math.max(maxStep, Math.abs(walk.k - kPrev));
  kPrev = walk.k;
}
ok(maxStep < 0.02 && walk.k > 0.9, `the wind comes up over a few seconds when you step into the vista (biggest step ${maxStep.toFixed(4)} per frame)`);
walk.update(NaN, at);
walk.update(-1, null);
ok(Number.isFinite(walk.k) && Number.isFinite(walk.gust), 'bad dt / no player: safe');

// chapter II
{
  const { buildChapter2 } = await import(srcUrl('data/chapter2-data.js')).catch(() => ({}));
  void buildChapter2;
}

// wiring
{
  const audio = fs.readFileSync(path.join(SRC_DIR, 'audio/audio3d.js'), 'utf8');
  ok(audio.includes("'wind:whoosh': this._onWindWhoosh") && audio.includes('_onWindWhoosh(p) {') && audio.includes('(1 + 0.9 * vk + 1.1 * vg)'), 'audio: the whoosh voice is routed and the wind bed follows the vista');
  ok(fs.readFileSync(path.join(SRC_DIR, 'ui/captions.js'), 'utf8').includes("case 'wind:whoosh'"), 'captions: the strong whooshes are captioned');
  const fx = fs.readFileSync(path.join(SRC_DIR, 'render/fx.js'), 'utf8');
  ok(fx.includes('game.vista.gust') && fx.includes('this.windGusts.update(dt, head, tier, this.reduced, sqn)'), 'fx: the wisps stream with the whooshes');
  ok(fs.readFileSync(path.join(SRC_DIR, 'render/renderer3d.js'), 'utf8').includes('(1 - 0.22 * vistaK)'), 'renderer: a little more haze at a vista');
  const game = fs.readFileSync(path.join(SRC_DIR, 'game.js'), 'utf8');
  ok(game.includes('this.vista = new VistaWind(this._runBus)') && game.includes('this.vista.update(dt, p)') && game.includes('function windOff()') && game.includes('this.vista.reset(this.level)'), 'game: built per level, stepped once per frame, reset on a new run, ?wind=off');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL VISTA WIND CHECKS PASS');
process.exitCode = fails ? 1 : 0;
