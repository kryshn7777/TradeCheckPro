// Camera lag while swinging (render/swingLag.js, settings.swingLag): opposite to the velocity, only on a tether and only once the body is
// really moving, smooth, capped, much smaller in a headset, never dips the eyes into the floor, off at strength 0.
//   node test-swing-lag.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const L = await import(srcUrl('render/swingLag.js'));
const { SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const o = { x: 0, y: 0, z: 0 };
const len = (v) => Math.hypot(v.x, v.y, v.z);

L.swingLagTarget(9, 0, 0, true, 0.5, false, o);
ok(o.x < -0.05 && Math.abs(o.y) < 1e-9 && Math.abs(o.z) < 1e-9, `at 9 m/s forward the view trails behind it (${o.x.toFixed(3)} m)`);
L.swingLagTarget(1, 0, 0, true, 1, false, o);
ok(len(o) === 0, 'below 2.5 m/s there is no lag');
L.swingLagTarget(12, 0, 0, false, 1, false, o);
ok(len(o) === 0, 'not on a tether / not playing: no lag');
L.swingLagTarget(12, 3, -4, true, 0, false, o);
ok(len(o) === 0, 'strength 0: no lag');
L.swingLagTarget(40, 30, 20, true, 1, false, o);
ok(len(o) <= L.CAP + 1e-9, `capped: ${len(o).toFixed(3)} m <= ${L.CAP} m even at 60 m/s`);
const d = { ...o };
L.swingLagTarget(40, 30, 20, true, 1, true, o);
ok(len(o) <= L.CAP * L.XR_SCALE + 1e-9 && len(o) < len(d) * 0.3, `in a headset: ${(len(o) * 100).toFixed(1)} cm at most (desktop ${(len(d) * 100).toFixed(1)} cm)`);
L.swingLagTarget(0, 15, 0, true, 1, false, o);
ok(o.y <= 0 && o.y >= L.UP_MIN - 1e-9, `rising fast: the eyes lag below the body by at most ${-L.UP_MIN} m (${o.y.toFixed(3)}), never into the floor`);
L.swingLagTarget(0, -15, 0, true, 1, false, o);
ok(o.y > 0 && o.y <= L.CAP, `falling fast: the eyes lag above the body (${o.y.toFixed(3)} m), within the cap`);
// smooth: no frame pops
const off = { x: 0, y: 0, z: 0 };
const tgt = L.swingLagTarget(10, 0, 0, true, 1, false, { x: 0, y: 0, z: 0 });
let maxStep = 0;
let prev = 0;
for (let i = 0; i < 120; i++) {
  L.stepSwingLag(off, tgt, 1 / 72);
  maxStep = Math.max(maxStep, Math.abs(off.x - prev));
  prev = off.x;
}
ok(maxStep < Math.abs(tgt.x) * 0.2, `eases in: the biggest frame step is ${(maxStep * 100).toFixed(1)} cm of a ${(Math.abs(tgt.x) * 100).toFixed(0)} cm lag`);
ok(Math.abs(off.x - tgt.x) < Math.abs(tgt.x) * 0.01, 'reaches the target within two seconds');
const zero = { x: 0, y: 0, z: 0 };
for (let i = 0; i < 144; i++) L.stepSwingLag(off, zero, 1 / 72);
ok(len(off) < 1e-3, 'settles back to nothing when the swing ends');
ok(SETTINGS_DEFAULTS.swingLag === 0.5, 'default strength 0.5');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
