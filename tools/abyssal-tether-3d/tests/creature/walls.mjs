// How well the Mason's BODY lies on the walls (Node): the head crawls at the hug height, the 19 blocks behind it follow its trail. Per spine point and
// frame, on the real level (sections 4-7, 3 seeds, a still and a moving player, 40 s each):
//   inside  = fraction of block-frames within 0.25 m of (or inside) any solid, decor boxes included: the body clipping through masonry;
//   float   = mean |height above the nearest structural surface - the height it should keep| in metres (blocks hanging in the air at corners);
//   worst   = the deepest penetration seen (m).
//   node walls.mjs [--root DIR] [--print]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, SEG, CREATURE_TUNING, boxSurface, isStructural } = await import(srcUrl('sim/creature3d.js'));
if (process.env.TUNE) Object.assign(CREATURE_TUNING, JSON.parse(process.env.TUNE));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const PRINT = process.argv.includes('--print');
const T = CREATURE_TUNING;
const o = {};
const list = [];
let blocks = 0;
let inside = 0;
let floatSum = 0;
let floatN = 0;
let worst = 0;
let deep = 0;
let headDev = 0;
let headN = 0;
for (const sec of [4, 5, 6, 7]) {
  for (const seed of [1, 2, 3]) {
    for (const moving of [false, true]) {
      const L = new Level3D(LEVEL_DATA_3D, DIFFICULTY.normal.levelVariant);
      const c = new Creature3D(L, DIFFICULTY.normal, new EventBus(), { seed });
      const cp = L.sections[sec].checkpoint;
      const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
      c.reset(p);
      c.setSection(sec, L.sections[sec], p);
      for (let i = 0; i < 60 * 40; i++) {
        const t = i / 60;
        if (moving) {
          p.x = cp.x + Math.sin(t * 0.7) * 6;
          p.z = cp.z + Math.cos(t * 0.5) * 6;
          p.y = cp.y - ((0.5 * t) % 30);
        }
        c.update(1 / 60, p, t);
        if (c.caughtPlayer) {
          c.reset(p);
          c.setSection(sec, L.sections[sec], p);
          continue;
        }
        if (!c.inPlay || !c.body.visible || i % 3) continue;
        const sp = c.body.spine;
        for (let k = 1; k < SEG; k++) {
          const x = sp[k * 3];
          const y = sp[k * 3 + 1];
          const z = sp[k * 3 + 2];
          const r = 6;
          L.querySolids(x - r, y - r, z - r, x + r, y + r, z + r, list);
          let dAny = Infinity;
          let dStr = Infinity;
          for (let q = 0; q < list.length; q++) {
            const s = list[q];
            if (s.active === false || s.kind === 'crumble' || s.kind === 'grate') continue;
            const d = boxSurface(s, x, y, z, o);
            if (d < dAny) dAny = d;
            if (isStructural(s) && d < dStr) dStr = d;
          }
          blocks++;
          if (dAny < 0.25) inside++;
          if (dAny < worst) worst = dAny;
          if (dAny < -0.6) deep++;
          if (dStr < Infinity) {
            const want = c._hug * c.body.scale[k] + (c._arch * Math.sin((Math.PI * k) / (SEG - 1)) * (k < 4 ? k / 4 : 1));
            floatSum += Math.abs(dStr - want);
            floatN++;
          }
        }
        const dh = (() => {
          const r = 6;
          L.querySolids(c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r, list);
          let best = Infinity;
          for (let q = 0; q < list.length; q++) if (isStructural(list[q])) best = Math.min(best, boxSurface(list[q], c.x, c.y, c.z, o));
          return best;
        })();
        if (dh < Infinity) {
          headDev += Math.abs(dh - c._hug);
          headN++;
        }
      }
    }
  }
}
const insideFrac = inside / Math.max(1, blocks);
const floatMean = floatSum / Math.max(1, floatN);
console.log(`blocks ${blocks}  inside ${(insideFrac * 100).toFixed(2)} %  float ${floatMean.toFixed(2)} m  worst ${worst.toFixed(2)} m  deep ${((deep / Math.max(1, blocks)) * 100).toFixed(3)} %  head |d-hug| ${(headDev / Math.max(1, headN)).toFixed(2)} m`);
ok(blocks > 20000, 'enough body samples');
if (!PRINT) {
  ok(insideFrac < 0.01, `the body is inside masonry in under 1 % of block-frames (${(insideFrac * 100).toFixed(2)} %; 2.3 % before the wall fit, the locked axes lag it a little)`);
  ok(floatMean < 0.5, `blocks keep their height above the wall within 0.5 m on average (${floatMean.toFixed(2)} m)`);
  ok(deep / Math.max(1, blocks) < 0.0025, `blocks deeper than 0.6 m into a solid are rare (${((deep / blocks) * 100).toFixed(3)} % of block-frames, worst ${worst.toFixed(2)} m)`);
}
console.log(fails ? `FAILED: ${fails}` : 'ALL WALL CHECKS PASS');
process.exit(fails ? 1 : 0);
