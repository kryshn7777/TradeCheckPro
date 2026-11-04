// The Mason's blocks keep their size (render/mason/masonPose.js blockScales, sim/creature3d.js body.rest), Node, no GPU.
// Reported from VR: "the creature's body compresses and expands". Each block's size used to follow the LIVE chord of the two links it sits on;
// the chords change by about 0.5 m/s per link while it crawls (path corners, the wall fit), so every block swelled and shrank by 10-20 %.
// Now the size follows the links' REST length (body.rest, from the sim's taper). Checked on seeded hunts of the real level:
//   - body.rest is the rest length of every link (the arc spacing, tapering, scaled by the creature's size; skitterlings are smaller);
//   - the block sizes from rest do not move at all over a hunt; the old rule moved them by tens of percent;
//   - the sizes are what they were on average (no jump in how big the Mason is), the clamp still holds, a body without `rest` falls back to the chord;
//   - the view uses the shared function.
//   node test-block-scale.mjs
import fs from 'node:fs';
import { srcUrl, resolveGameRoot } from '../../verify/root.mjs';
import path from 'node:path';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, SEG, CREATURE_TUNING: T } = await import(srcUrl('sim/creature3d.js'));
const { blockScales, BODY_SCALE } = await import(srcUrl('render/mason/masonPose.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const L = new Level3D(LEVEL_DATA_3D, 'normal');
const P0 = 1.24; // the rig's rest pitch (tools/abyssal-tether-3d/mason_rig_core.py)
const bs = 0.93 / P0; // bodyScale / P0 (masonRigView DEFAULTS.bodyScale)

// 1. body.rest.
{
  const c = new Creature3D(L, DIFFICULTY.nightmare, new EventBus(), { seed: 1 });
  const r = c.body.rest;
  ok(r.length === SEG && r[0] === r[1], 'body.rest has one value per spine point ([0] = [1])');
  let sum = 0;
  let mono = true;
  for (let i = 1; i < SEG; i++) {
    sum += r[i];
    if (!(r[i] > 0) || r[i] > r[i - 1] + 1e-6) mono = false;
  }
  ok(mono && Math.abs(r[1] - T.spacing * 0.5 * (1 + c.body.scale[1])) < 1e-4, `the rest links start at ${r[1].toFixed(2)} m and taper toward the tail (never longer than the one before)`);
  ok(Math.abs(sum - c.bodyLength) < 1e-3, `they add up to the body length (${sum.toFixed(2)} m)`);
  const v = new Creature3D(L, DIFFICULTY.nightmare, new EventBus(), { seed: 1, variant: 'skitterling' });
  ok(v.body.rest[1] > 0 && Math.abs(v.body.rest[1] / c.body.rest[1] - 0.45) < 1e-4, `a skitterling's rest links are 0.45 of the Mason's (${v.body.rest[1].toFixed(3)} m)`);
}

// 2. In hunts.
{
  const tail = [];
  const restS = [];
  const liveS = [];
  const sizeAt = (S) => S.slice(1).reduce((a, b) => a + b, 0) / (S.length - 1);
  for (const sec of [3, 5, 6]) {
    for (const seed of [1, 2]) {
      const c = new Creature3D(L, DIFFICULTY.nightmare, new EventBus(), { seed });
      const cp = L.sections[sec].checkpoint;
      const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
      c.reset(p);
      c.setSection(sec, L.sections[sec], p);
      const S = new Float32Array(SEG);
      const S2 = new Float32Array(SEG);
      const series = Array.from({ length: SEG }, () => []);
      const series2 = Array.from({ length: SEG }, () => []);
      for (let i = 0; i < 60 * 20; i++) {
        const t = i / 60;
        p.x = cp.x + Math.sin(t * 0.7) * 6;
        p.z = cp.z + Math.cos(t * 0.5) * 6;
        p.y = cp.y - ((0.5 * t) % 30);
        c.update(1 / 60, p, t);
        if (c.caughtPlayer) {
          c.reset(p);
          c.setSection(sec, L.sections[sec], p);
          continue;
        }
        if (!c.inPlay || !c.body.visible) continue;
        blockScales(c.body, c.body.spine, bs, 0.4, S); // what the view does
        const live = { spine: c.body.spine };
        blockScales(live, c.body.spine, bs, 0.4, S2); // the old rule: no `rest` -> the live chord
        for (let k = 1; k < SEG; k++) {
          series[k].push(S[k]);
          series2[k].push(S2[k]);
        }
      }
      const sdRel = (a) => {
        const m = a.reduce((x, y) => x + y, 0) / a.length;
        return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) / m;
      };
      for (let k = 1; k < SEG - 1; k++) {
        if (series[k].length < 600) continue;
        restS.push(sdRel(series[k]));
        liveS.push(sdRel(series2[k]));
      }
      tail.push(sizeAt(S), sizeAt(S2));
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const worst = (a) => a.reduce((m, v) => (v > m ? v : m), 0);
  ok(restS.length > 40, `enough block series measured (${restS.length})`);
  ok(worst(restS) < 1e-6, `a block's size does not move over a hunt (worst relative spread ${(worst(restS) * 100).toFixed(4)} %)`);
  ok(mean(liveS) > 0.03 && worst(liveS) > 0.06, `the old rule (live chord) moved them: mean spread ${(mean(liveS) * 100).toFixed(1)} %, worst ${(worst(liveS) * 100).toFixed(1)} %`);
  ok(Math.abs(tail[0] / tail[1] - 1) < 0.12, 'the blocks are the same size on average as before (no jump in how big the Mason looks)');
}

// 3. The function.
{
  const S = new Float32Array(SEG);
  const sp = new Float32Array(SEG * 3);
  for (let i = 0; i < SEG; i++) sp[i * 3] = i * 1.5;
  const B = { rest: new Float32Array(SEG).fill(1.5) };
  blockScales(B, sp, bs, 0.4, S);
  ok(Math.abs(S[5] - 1.5 * bs) < 1e-6 && Math.abs(S[SEG - 1] - 1.5 * bs) < 1e-6, `1.5 m links: scale ${S[5].toFixed(3)} (= 1.5 x ${bs.toFixed(3)}), the tail block too`);
  B.rest.fill(0.1);
  blockScales(B, sp, bs, 0.4, S);
  ok(Math.abs(S[3] - 0.4) < 1e-6, 'the lower clamp holds');
  B.rest.fill(9);
  blockScales(B, sp, bs, 0.4, S);
  ok(Math.abs(S[3] - 1.6) < 1e-6, 'the upper clamp holds');
  blockScales({}, sp, bs, 0.4, S);
  ok(Math.abs(S[4] - 1.5 * bs) < 1e-6, 'without rest it falls back to the live chord (1.5 m)');
  ok(BODY_SCALE > 1 && BODY_SCALE < 1.3, 'the default world scale is about 1.15');
}

// 4. The view.
{
  const src = fs.readFileSync(path.join(resolveGameRoot(), 'src/render/masonRigView.js'), 'utf8');
  ok(/blockScales\(B, sp, bs, size < 1 \? 0\.08 : 0\.4, S\)/.test(src) && /import \{ blockScales,/.test(src), 'the rig view sizes its blocks with blockScales (from the rest lengths)');
  ok(!/S\[i\] = clamp\(\(a \+ b\) \* 0\.5 \* bs/.test(src), 'the live-chord rule is gone from the view');
}
console.log(fails ? `FAILED: ${fails}` : 'ALL BLOCK SCALE CHECKS PASS');
process.exit(fails ? 1 : 0);
