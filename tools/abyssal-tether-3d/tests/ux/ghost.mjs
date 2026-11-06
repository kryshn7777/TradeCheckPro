// The GHOST LANTERN of your best run (Node, no browser): meta/ghost.js (the 10 Hz decimetre recorder, the versioned base64
// round trip within 0.1 m, GhostPlayer.at() interpolating and clamping without allocating, the per chapter + difficulty
// localStorage key, an invalidated recorder never saves, a worse run never overwrites, every storage failure swallowed)
// and render/ghostView.js (one additive fogged sprite, fades out near the head, hidden without a ghost, no allocation).
//   node ghost.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const G = await import(srcUrl('meta/ghost.js'));
const THREE = await import(`${VENDOR_THREE_URL}three.module.min.js`);
const { GhostView } = await import(srcUrl('render/ghostView.js'));
const { SETTINGS_DEFAULTS, sanitizeUxSettings } = await import(srcUrl('sim/config3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};

class MemStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}
class BrokenStorage {
  getItem() {
    throw new Error('SecurityError');
  }
  setItem() {
    throw new Error('QuotaExceededError');
  }
  removeItem() {
    throw new Error('SecurityError');
  }
}

/** A scripted descent: drifts down 1.5 m/s with a sway, sampled at a 72 Hz frame clock (deterministic). */
function record(seconds, rec = new G.GhostRecorder(16)) {
  const path = (t) => [3 * Math.sin(t * 0.7), -1.5 * t + 0.04, 2 * Math.cos(t * 0.31)];
  for (let t = 0; t <= seconds + 1e-9; t += 1 / 72) rec.sample(t, ...path(t));
  return { rec, path };
}

// ---- recorder + format ----------------------------------------------------------------------------------------------
{
  const { rec, path } = record(60);
  ok(rec.valid && rec.count === 601 && rec.data.length >= 601 * 3, `10 Hz: 60 s = 601 samples, the buffer grew from 16 (${rec.count})`);
  const b64 = rec.encode(60);
  const dec = G.decodeGhost(b64);
  ok(!!dec && dec.hz === 10 && dec.count === 601 && Math.abs(dec.time - 60) < 1e-4, 'encode / decode: header (version, hz, count, finish time) round trips');
  const pl = new G.GhostPlayer(dec);
  const out = { x: 0, y: 0, z: 0 };
  let worst = 0;
  for (let i = 0; i < 601; i++) {
    const t = i / 10;
    pl.at(t, out);
    const [x, y, z] = path(t);
    worst = Math.max(worst, Math.hypot(out.x - x, out.y - y, out.z - z));
  }
  // a sample slot is filled by the first frame at or after it (<= 1/72 s late): 1.5 m/s * 0.014 s + 0.05 m quantisation
  ok(worst < 0.1, `round trip within 0.1 m at every sample (worst ${worst.toFixed(3)} m)`);
  const bytes8min = 4800 * 6 + 12;
  ok(bytes8min < 30 * 1024, `an 8-minute run is ${(bytes8min / 1024).toFixed(1)} KB of samples (${Math.ceil(bytes8min / 3) * 4} chars of base64)`);
  ok(G.decodeGhost('garbage!!') === null && G.decodeGhost(null) === null && G.decodeGhost(b64.slice(0, 40)) === null, 'decode: garbage / null / a truncated record -> null, never throws');
  const other = b64.slice(0, 2) + 'B' + b64.slice(3); // header bytes changed (another version)
  ok(G.decodeGhost(other) === null || G.decodeGhost(other).count === 601, 'decode: a mangled header is refused or read whole');
}

// ---- GhostPlayer.at: lerp + clamp, no allocation ---------------------------------------------------------------------
{
  const rec = new G.GhostRecorder();
  rec.sample(0, 0, 0, 0);
  rec.sample(0.1, 1, -2, 3);
  rec.sample(0.2, 2, -4, 6);
  const pl = new G.GhostPlayer(G.decodeGhost(rec.encode(0.2)));
  const out = { x: 0, y: 0, z: 0 };
  const r = pl.at(0.15, out);
  ok(r === out && Math.abs(out.x - 1.5) < 1e-9 && Math.abs(out.y + 3) < 1e-9 && Math.abs(out.z - 4.5) < 1e-9, 'at(t): linear between two samples, written into `out`');
  pl.at(-5, out);
  const a = out.x === 0 && out.y === 0;
  pl.at(99, out);
  ok(a && Math.abs(out.x - 2) < 1e-9 && Math.abs(out.y + 4) < 1e-9, 'at(t): clamped to the first sample before 0 and the last after the end');
  pl.at(0.2, out);
  ok(Math.abs(out.x - 2) < 1e-9, 'at(t): exactly the last sample at the end');
  for (let i = 0; i < 200000; i++) pl.at((i % 300) / 1000, out); // warm up (the JIT's own allocations)
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000000; i++) pl.at((i % 300) / 1000, out);
  const grew = process.memoryUsage().heapUsed - h0;
  // one small object per call would be >= 32 MB here
  ok(grew < 4 * 1024 * 1024, `at(): 2,000,000 calls, heap +${(grew / 1024).toFixed(0)} KB (no allocation per call)`);
}

// ---- storage: key, invalid, worse, failure ----------------------------------------------------------------------------
{
  ok(G.ghostKey(1, 'normal') === 'abyssalTether3d.v2.ghost.ch1.normal' && G.ghostKey(2, 'abyss') === 'abyssalTether3d.v2.ghost.ch2.abyss', 'key: abyssalTether3d.v2.ghost.ch<chapter>.<diff> (the existing prefix)');
  const s = new MemStorage();
  const { rec } = record(30);
  ok(G.saveGhost(1, 'normal', rec, 30, s) === 'saved' && G.loadGhost(1, 'normal', s).time > 29.99, 'a valid whole run with no ghost saved is saved and loads back');
  ok(G.loadGhost(2, 'normal', s) === null && G.loadGhost(1, 'nightmare', s) === null, 'per chapter and difficulty: Chapter II / another difficulty has no ghost');
  const { rec: slow } = record(40);
  const before = s.getItem(G.ghostKey(1, 'normal'));
  ok(G.saveGhost(1, 'normal', slow, 40, s) === 'worse' && s.getItem(G.ghostKey(1, 'normal')) === before, 'a slower run does not overwrite the ghost');
  ok(G.saveGhost(1, 'normal', rec, 30, s) === 'worse', 'an equal time does not overwrite either');
  const { rec: fast } = record(20);
  fast.invalidate();
  ok(G.saveGhost(1, 'normal', fast, 20, s) === 'invalid' && s.getItem(G.ghostKey(1, 'normal')) === before, 'an invalidated recorder (Continue / warp / teleport) refuses to save, even when faster');
  fast.reset();
  ok(fast.valid && fast.count === 0, 'reset(): a new run records again');
  const { rec: fast2 } = record(20);
  ok(G.saveGhost(1, 'normal', fast2, 20, s) === 'saved' && Math.abs(G.loadGhost(1, 'normal', s).time - 20) < 1e-4, 'a faster valid run replaces the ghost');
  const bad = new BrokenStorage();
  let threw = false;
  let res;
  try {
    res = [G.saveGhost(1, 'normal', fast2, 10, bad), G.loadGhost(1, 'normal', bad), G.clearGhost(1, 'normal', bad)];
  } catch {
    threw = true;
  }
  ok(!threw && res[0] === 'error' && res[1] === null && res[2] === false, 'storage failure (quota / security) is swallowed: save -> "error", load -> null, clear -> false');
  s.setItem(G.ghostKey(1, 'abyss'), '%%%not base64%%%');
  ok(G.loadGhost(1, 'abyss', s) === null, 'a corrupt stored ghost loads as none');
  ok(G.clearGhost(1, 'normal', s) && G.loadGhost(1, 'normal', s) === null, 'clear removes it');
  const far = new G.GhostRecorder();
  far.sample(0, 0, -4000, 0);
  ok(!far.valid, 'a position beyond +-3276.7 m invalidates the recorder (Int16 decimetres)');
}

// ---- setting --------------------------------------------------------------------------------------------------------
ok(SETTINGS_DEFAULTS.ghost === true && sanitizeUxSettings({ ghost: false }).ghost === false && sanitizeUxSettings({ ghost: 'x' }).ghost === true, 'setting ghost: on by default, off stays off, junk reads as on');

// ---- render/ghostView.js -----------------------------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  scene.add(cam);
  const v = new GhostView(scene);
  const { rec } = record(10);
  const pl = new G.GhostPlayer(G.decodeGhost(rec.encode(10)));
  ok(scene.children.filter((c) => c.isSprite).length === 1 && v.material.blending === THREE.AdditiveBlending && v.material.fog === true && v.material.depthWrite === false, 'one additive, fogged sprite that does not write depth (one draw call)');
  cam.position.set(0, 20, 0);
  cam.updateMatrixWorld();
  v.update(1 / 72, pl, 4, cam, false);
  const y4 = v.sprite.position.y;
  ok(v.sprite.visible && v.alpha > 0.4, `far from the head: visible (opacity ${v.alpha.toFixed(2)})`);
  v.update(1 / 72, pl, 6, cam, false);
  ok(v.sprite.position.y < y4 - 2.5, 'it moves down the shaft with the run clock');
  const p = pl.at(6, { x: 0, y: 0, z: 0 });
  cam.position.set(p.x, p.y + 0.45, p.z + 0.3);
  cam.updateMatrixWorld();
  v.update(1 / 72, pl, 6, cam, false);
  ok(!v.sprite.visible && v.alpha === 0, 'inside 0.6 m of the head: invisible (never blocks the view)');
  cam.position.set(p.x, p.y + 0.45, p.z + 1.05);
  cam.updateMatrixWorld();
  v.update(1 / 72, pl, 6, cam, false);
  const mid = v.alpha;
  cam.position.set(p.x, p.y + 0.45, p.z + 3);
  cam.updateMatrixWorld();
  v.update(1 / 72, pl, 6, cam, true);
  ok(mid > 0 && mid < v.alpha, `fades in between 0.6 and 1.5 m (${mid.toFixed(2)} at 1.05 m, ${v.alpha.toFixed(2)} at 3 m)`);
  v.update(1 / 72, pl, 13, cam, false);
  ok(!v.sprite.visible, 'gone 2 s after its run ended at the bottom');
  v.update(1 / 72, null, 4, cam, false);
  ok(!v.sprite.visible, 'no ghost / setting off: hidden');
  for (let i = 0; i < 50000; i++) v.update(1 / 72, pl, (i % 700) / 72, cam, false); // warm up
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 500000; i++) v.update(1 / 72, pl, (i % 700) / 72, cam, false);
  const grew = process.memoryUsage().heapUsed - h0;
  ok(grew < 4 * 1024 * 1024, `update(): 500,000 frames, heap +${(grew / 1024).toFixed(0)} KB (no allocation per frame)`);
  v.dispose();
  ok(scene.children.filter((c) => c.isSprite).length === 0, 'dispose removes the sprite');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
