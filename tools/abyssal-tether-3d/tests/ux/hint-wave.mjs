// THE GOLDEN MARK's blip wave (sim/hintWave.js, render/hintWaveView.js, the lit shader's PING chunk in render/materials.js,
// audio/hintWaveSfx.js, the caption in ui/captions.js): the ladder (20 s mark, 45 s first wave, 67 s, 90 s then every 8 s, cap 10 per
// section), what resets it (progress, found, a section, a checkpoint, a death -> stage 1), what holds it (attack / fall / cutscene /
// pause), difficulty gating (Abyss never, Nightmare later), one wave in flight, determinism, the pure wave maths, the shader chunk
// (once, cheap-skipped, no sampler), the setting + URL switch, the blip recipe + route, the caption direction words.
//   node hint-wave.mjs [--root DIR]
import fs from 'node:fs';
import { register as reg } from 'node:module';
import { srcUrl, VENDOR_THREE_URL, SRC_DIR } from '../../verify/root.mjs';

reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;

const W = await import(srcUrl('sim/hintWave.js'));
const { ObjectiveHint, HINT_AFTER, FOUND_R } = await import(srcUrl('sim/objectiveHint.js'));
const C = await import(srcUrl('sim/config3d.js'));
const CAP = await import(srcUrl('ui/captions.js'));
const SFX = await import(srcUrl('audio/hintWaveSfx.js'));
const D = await import(srcUrl('audio/sfxDesign.js'));
const THREE = await import('three');
const M = await import(srcUrl('render/materials.js'));
const V = await import(srcUrl('render/hintWaveView.js'));

let fails = 0;
let n = 0;
const ok = (c, msg) => {
  n++;
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// a stub objective: one bell at (10, -2, 4) in section 0
const stub = () => ({
  objectives: [{ index: 0, section: 0, seal: 0, fx: [0] }],
  fixtures: [{ x: 10, y: -2, z: 4, k: 1 }],
  done: [0],
  sealOpen: [0],
  count: [0],
  fxN: [0],
  fxDone: [0],
  fixtureDone(i) {
    return this.fxDone[i] === 1;
  },
});
const ctx = (o) => Object.assign({ section: 0, px: -30, py: 0, pz: 0, playing: true, dead: false, blocked: false, enabled: true, scale: 1, reduced: false }, o || {});
/** Runs both systems `secs` seconds; returns the stuck times (s since the clock started) of every launch and every pass. */
function sim(secs, o = {}) {
  const h = o.h || new ObjectiveHint();
  const w = o.w || new W.HintWave();
  const O = o.O || stub();
  const c = ctx(o.c);
  const dt = o.dt || 1 / 72;
  const out = { h, w, O, launches: [], passes: [], t0: o.t0 || 0, maxStrength: 0, maxRise: 0 };
  let t = out.t0;
  let prev = 0;
  const steps = Math.round(secs / dt);
  for (let i = 0; i < steps; i++) {
    t += dt;
    if (o.each) o.each(t, c, out);
    h.update(dt, O, { x: c.px, y: c.py, z: c.pz }, c.section, c.playing && !c.dead);
    w.update(dt, h, c);
    if (w.launched) out.launches.push(+t.toFixed(3));
    if (w.passedNow) out.passes.push(+t.toFixed(3));
    const s = w.wave.active ? w.wave.strength : 0;
    out.maxStrength = Math.max(out.maxStrength, s);
    out.maxRise = Math.max(out.maxRise, s - prev);
    prev = s;
  }
  out.t = t;
  return out;
}

// ---- the ladder ------------------------------------------------------------------------------------------------------
{
  const r = sim(200);
  const L = r.launches;
  ok(L.length === W.LADDER.cap, `cap: ${L.length} waves in 200 s stuck in one section (cap ${W.LADDER.cap})`);
  ok(near(L[0], 45, 0.05), `stage 2: the first wave at 45 s (${L[0]})`);
  ok(near(L[1], 67, 0.05), `stage 2: one more 22 s later (${L[1]})`);
  ok(near(L[2], 90, 0.05), `stage 3 at 90 s (${L[2]})`);
  let every8 = true;
  for (let i = 3; i < L.length; i++) if (!near(L[i] - L[i - 1], 8, 0.05)) every8 = false;
  ok(every8, `stage 3: then every 8 s (${L.slice(2).join(', ')})`);
  ok(L.every((x) => x >= HINT_AFTER), 'never before the 20 s mark');
  ok(r.passes.length === L.length, `every wave reaches the player 30+ m away (${r.passes.length} passes)`);
  const d = Math.hypot(10 + 30, -2, 4);
  ok(near(r.passes[0] - L[0], d / W.WAVE.speed, 0.05), `the blip arrives with the wave's travel time (${(r.passes[0] - L[0]).toFixed(2)} s for ${d.toFixed(1)} m)`);
  ok(W.stageAt(19) === 0 && W.stageAt(20) === 1 && W.stageAt(44.9) === 1 && W.stageAt(45) === 2 && W.stageAt(90) === 3, 'stageAt: 0 / 1 at 20 s / 2 at 45 s / 3 at 90 s');
  ok(W.LADDER.stage2At === 45 && W.LADDER.stage3At === 90 && W.LADDER.stage3Every === 8 && W.LADDER.cap === 10 && HINT_AFTER === 20, 'ladder numbers: 20 / 45 / 90 / every 8 / cap 10');
}

// ---- one wave in flight ----------------------------------------------------------------------------------------------
{
  const w = new W.HintWave();
  ok(w.fire(0, 0, 0, 2, false) === true && w.fire(5, 0, 0, 2, false) === false && w.wave.x === 0, 'one wave in flight: a second fire is refused');
  ok(w.fire(5, 0, 0, 3, false, 0, true) === true && w.wave.x === 5, '... unless forced (debug)');
  // the ladder never launches while one is in flight: a wave lasts range / speed = 3.5 s < every gap
  ok(W.WAVE.range / W.WAVE.speed < W.LADDER.stage3Every && W.WAVE.range / W.WAVE.speedReduced < W.LADDER.stage3Every, 'a wave (normal and reduced) ends before the next is due');
  const w2 = new W.HintWave();
  let overlap = false;
  const fire = w2.fire.bind(w2);
  w2.fire = (...a) => {
    if (w2.wave.active) overlap = true;
    return fire(...a);
  };
  sim(200, { w: w2 });
  ok(!overlap, 'never a launch on top of a live wave');
}

// ---- resets ----------------------------------------------------------------------------------------------------------
{
  // progress: a notch at 60 s hides the mark, the wave fades, the ladder starts again from 0
  const r = sim(140, {
    each: (t, c, out) => {
      if (near(t, 60, 0.008)) out.O.fxN[0] = 1;
    },
  });
  ok(near(r.launches[0], 45, 0.05) && near(r.launches[1], 60 + 45, 0.05), `progress at 60 s: the next wave 45 s later (${r.launches.join(', ')})`);
  // found: standing within FOUND_R of the bell
  const f = sim(100, {
    each: (t, c) => {
      if (t > 40 && t < 41) {
        c.px = 10;
        c.py = -2;
        c.pz = 4 + FOUND_R * 0.5;
      } else {
        c.px = -30;
        c.py = 0;
        c.pz = 0;
      }
    },
  });
  ok(near(f.launches[0], 41 + 45, 0.1), `found the trigger at 40 s: no wave until 45 s after leaving it (${f.launches.join(', ')})`);
  // a new section: the cap is per section, the clock restarts
  const w = new W.HintWave();
  const h = new ObjectiveHint();
  const O = stub();
  sim(200, { w, h, O });
  ok(w.fired === W.LADDER.cap, 'section 0 capped');
  O.objectives[0].section = 1; // the same bell, now the objective of section 1 (the player moved on)
  const s1 = sim(50, { w, h, O, c: { section: 1 } });
  ok(w.fired === 1 && near(s1.launches[0], 45, 0.05), `a new section: count and clock reset (first wave at ${s1.launches[0]})`);
  // a checkpoint: progress()
  const w2 = new W.HintWave();
  const h2 = new ObjectiveHint();
  const c2 = sim(130, {
    w: w2,
    h: h2,
    each: (t, c, out) => {
      if (near(t, 100, 0.008)) out.w.progress();
    },
  });
  const c2a = c2.launches.filter((x) => x > 100);
  ok(c2a.length === 1 && near(c2a[0], 125, 0.05), `a checkpoint at 100 s: the ladder restarts at stage 1 (the mark stays): next wave 25 s later (${c2.launches.join(', ')})`);
  // a death at stage 3: back to stage 1 (the mark stays on), the next wave 45 s after the respawn
  const dd = sim(170, {
    each: (t, c) => {
      c.dead = t > 100 && t < 104;
    },
  });
  const after = dd.launches.filter((x) => x > 100);
  ok(dd.h.on && after.length > 0 && near(after[0], 104 + 25, 0.1), `a death at 100 s: stage 1 again, next wave 25 s after the respawn (stuck 45 s; ${after[0]})`);
}

// ---- holds -----------------------------------------------------------------------------------------------------------
{
  for (const [what, from, to] of [
    ['an attack wind-up / burst', 40, 60],
    ['a fall', 44, 47],
    ['a cutscene', 40, 80],
  ]) {
    let during = 0;
    const r = sim(120, {
      each: (t, c, out) => {
        c.blocked = t > from && t < to;
        if (c.blocked && out.w.launched) during++;
      },
    });
    ok(during === 0 && near(r.launches[0], 45 + (to - Math.max(from, 20)) * (from < 45 ? 1 : 0), 0.1), `${what} (${from}-${to} s): no wave during it, the clock held (first at ${r.launches[0]})`);
  }
  // an in-flight wave fades out within 0.5 s of a block, and never 'passes'
  const w = new W.HintWave();
  const c = ctx({ px: 60 });
  const h = { on: true, count: 1, targets: [{ x: 0, y: 0, z: 0, on: true }] };
  w.update(0, h, c);
  w.fire(0, 0, 0, 2, false);
  for (let i = 0; i < 10; i++) w.update(1 / 72, h, c);
  ok(w.wave.active && !w.wave.fading && w.wave.strength > 0, 'a live wave (setup)');
  c.blocked = true;
  let passed = false;
  for (let i = 0; i < 40 && w.wave.active; i++) {
    w.update(1 / 72, h, c);
    passed = passed || w.passedNow;
  }
  ok(!w.wave.active && !passed, 'a block fades the live wave out within 0.55 s, no blip');
  // pause: nothing moves
  const w3 = new W.HintWave();
  w3.fire(0, 0, 0, 2, false);
  const r0 = w3.wave.radius;
  for (let i = 0; i < 50; i++) w3.update(1 / 72, h, ctx({ playing: false }));
  ok(w3.wave.active && w3.wave.radius === r0, 'paused: the wave holds');
}

// ---- difficulty + the switch ----------------------------------------------------------------------------------------------
{
  ok(W.ladderScale('abyss') === 0 && sim(200, { c: { scale: W.ladderScale('abyss') } }).launches.length === 0, 'Abyss: never a wave');
  const nm = sim(200, { c: { scale: W.ladderScale('nightmare') } });
  ok(nm.launches.length > 0 && near(nm.launches[0], 45 * 1.33, 0.05), `Nightmare: later (first at ${nm.launches[0]})`);
  ok(W.ladderScale('normal') === 1 && W.ladderScale('sandbox') === 1 && W.ladderScale('nope') === 1, 'Normal / Sandbox: the ladder as written');
  ok(sim(200, { c: { enabled: false } }).launches.length === 0, 'setting off: never a wave');
  ok(W.hintWaveEnabled({ hintWave: true }, '') && !W.hintWaveEnabled({ hintWave: false }, '') && !W.hintWaveEnabled({ hintWave: 'off' }, '') && W.hintWaveEnabled({}, ''), 'hintWaveEnabled: default on; false / "off" = off');
  ok(!W.hintWaveEnabled({ hintWave: true }, '?sw=0&hintwave=off') && W.hintWaveEnabled({ hintWave: true }, '?hintwaves=offx'), '?hintwave=off switches it off');
  ok(C.SETTINGS_DEFAULTS.hintWave === true, 'settings default: on');
  ok(C.sanitizeUxSettings({ hintWave: 'off' }).hintWave === false && C.sanitizeUxSettings({ hintWave: false }).hintWave === false && C.sanitizeUxSettings({ hintWave: 'yes' }).hintWave === true && C.sanitizeUxSettings({}).hintWave === true, 'sanitiser: only false / "off" turn it off');
  const ui = fs.readFileSync(`${SRC_DIR}/ui/ui3d.js`, 'utf8');
  ok(/key: 'hintWave', tab: 'access', type: 'toggle'/.test(ui), 'Settings › Access › Hint wave row');
  const e2e = fs.readFileSync(new URL('../../e2e/e2e.cjs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../../e2e/free-attach.cjs', import.meta.url), 'utf8');
  ok((e2e.match(/hintwave=off/g) || []).length >= 3, 'the e2e / free-attach bots pass &hintwave=off');
}

// ---- determinism -----------------------------------------------------------------------------------------------------------
{
  const go = () => {
    const r = sim(180, {
      each: (t, c) => {
        c.px = -30 + 10 * Math.sin(t * 0.3);
        c.blocked = t > 70 && t < 73;
      },
    });
    return JSON.stringify([r.launches, r.passes, r.w.state()]);
  };
  ok(go() === go(), 'deterministic: same inputs, same launches, passes and state');
  for (const f of ['sim/hintWave.js', 'audio/hintWaveSfx.js', 'render/hintWaveView.js']) ok(!/Math\.random\(/.test(fs.readFileSync(`${SRC_DIR}/${f}`, 'utf8')), `${f}: no Math.random`);
}

// ---- the wave maths ------------------------------------------------------------------------------------------------------
{
  ok(near(W.waveRadius(1, false), 20) && near(W.waveRadius(2, true), 26) && W.waveRadius(-1, false) === 0, 'front: 20 m/s (13 reduced), never negative');
  ok(W.WAVE.speed >= 18 && W.WAVE.speed <= 24 && W.WAVE.range === 70, 'speed 18-24 m/s, range 70 m');
  let capOk = true;
  let mono = true;
  let prevT = 0;
  for (let st = 2; st <= 3; st++)
    for (const red of [false, true])
      for (let a = 0; a < 6; a += 0.01) {
        const r = W.waveRadius(a, red);
        const s = W.waveStrength(a, r, st, red);
        if (!(s >= 0 && s <= W.STRENGTH_CAP)) capOk = false;
        const th = W.waveThickness(r, st);
        if (a > 0 && th < prevT - 1e-9 && r < W.WAVE.range) mono = false;
        prevT = r >= W.WAVE.range ? 0 : th;
      }
  ok(capOk, 'strength in [0, cap] everywhere');
  ok(mono, 'the band widens as it travels');
  ok(W.waveStrength(4, 70, 3, false) === 0 && W.waveStrength(4, 80, 3, false) === 0, 'gone at the range');
  ok(W.waveStrength(0.02, 0.4, 3, false) < 0.02 && W.waveStrength(0.6, 12, 3, false) > 0.5, 'rises over ~0.45 s (never a flash), then strong');
  ok(W.waveStrength(1, 20, 3, false) > W.waveStrength(2.5, 50, 3, false), 'fainter with the distance travelled');
  ok(W.waveStrength(1, 20, 3, false) > W.waveStrength(1, 20, 2, false) && W.waveThickness(20, 3) > W.waveThickness(20, 2), 'stage 3 slightly stronger and thicker');
  ok(W.waveStrength(1, 13, 3, true) < W.waveStrength(1, 13, 3, false) * 0.6, 'Reduced effects: dimmer (and slower)');
  ok(W.waveThickness(0, 2) >= 1 && W.waveThickness(70, 2) <= 3.5, 'thickness ~1.1 m at the mark .. ~3.2 m at the range');
  const r = sim(200);
  ok(r.maxStrength <= W.STRENGTH_CAP && r.maxRise < 0.06, `in play: never above the cap, never jumps (max per-frame rise ${r.maxRise.toFixed(3)} at 72 Hz)`);
  ok(near(W.arrivalTime(40, false), 2) && near(W.arrivalTime(200, false), 3.5), 'arrival time: dist / speed, capped at the range');
}

// ---- the shader chunk -------------------------------------------------------------------------------------------------------
{
  const compile = (opts) => {
    const mat = M.patchMaterial(new THREE.MeshStandardMaterial(), opts);
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    mat.onBeforeCompile(sh, null);
    return sh;
  };
  const lit = compile({ lit: true, grade: true, uv: 'box', macro: null });
  const fsx = lit.fragmentShader;
  const count = (s, sub) => s.split(sub).length - 1;
  ok(count(fsx, 'if ( uPingK.y > 0.0 )') === 1, 'the PING chunk is in the lit program exactly once');
  ok(count(fsx, 'uniform vec4 uPing;') === 1 && count(fsx, 'uniform vec4 uPingK;') === 1, '... its two uniforms declared once');
  const at = fsx.indexOf('if ( uPingK.y > 0.0 )');
  const chunk = fsx.slice(at, fsx.indexOf('\n  }', at));
  ok(!/texture|sampler/.test(chunk) && !/sampler/.test(M.PING ? JSON.stringify(Object.keys(M.PING)) : ''), 'no texture fetch / sampler in the chunk');
  ok(fsx.indexOf('#include <fog_fragment>') > at || !fsx.includes('#include <fog_fragment>') || fsx.lastIndexOf('fog') > at, 'added to the emissive before the fog (the haze attenuates it)');
  ok(at > fsx.indexOf('vec3 totalEmissiveRadiance'), 'composed into totalEmissiveRadiance');
  ok(lit.uniforms.uPing === M.PING.uPing && lit.uniforms.uPingK === M.PING.uPingK, 'the shared holder (one write drives every program)');
  const plain = compile({ uv: 'box' });
  ok(!plain.fragmentShader.includes('uPingK'), 'unlit programs untouched');
  // the view: idle = strength 0 (the branch skips), live = position / radius / band / capped strength
  V.applyPing(null);
  ok(M.PING.uPingK.value.y === 0, 'idle: uPingK.y = 0');
  const w = new W.HintWave();
  const c = ctx({ px: 100 });
  const h = { on: true, count: 1, targets: [{ x: 1, y: 2, z: 3, on: true }] };
  w.update(0, h, c);
  w.fire(1, 2, 3, 3, false);
  for (let i = 0; i < 72; i++) w.update(1 / 72, h, c);
  const s = V.applyPing(w.wave);
  const P = M.PING.uPing.value;
  ok(near(P.x, 1) && near(P.y, 2) && near(P.z, 3) && near(P.w, w.wave.radius) && near(M.PING.uPingK.value.x, w.wave.thickness) && s > 0 && s <= V.PING_GAIN * W.STRENGTH_CAP, 'live: origin, radius, band, strength <= gain x cap');
  ok(V.originGlow(w.wave) > 0 && V.originGlow(w.wave) <= 1 && V.originGlow(null) === 0, 'the mark flares (0..1) while its wave leaves');
  w.clear();
  V.applyPing(w.wave);
  ok(M.PING.uPingK.value.y === 0, 'cleared: idle again');
  const src = fs.readFileSync(`${SRC_DIR}/render/materials.js`, 'utf8');
  const decl = src.slice(src.indexOf('const PING_DECL'), src.indexOf('/** Default texture tile'));
  ok(!/sampler/.test(decl), 'no sampler declared by the PING hunk');
}

// ---- the sound -------------------------------------------------------------------------------------------------------------
{
  const rec = D.compileRecipe(SFX.HINT_BLIP_ID, SFX.HINT_BLIP_RECIPE);
  ok(D.validateRecipe(rec).length === 0, `the blip recipe is sound (${D.validateRecipe(rec).join('; ') || 'ok'})`);
  ok(rec.space === 2 && rec.layers.length >= 2 && rec.floor > 0 && rec.prio <= 1, 'world-space, layered, a floor so a far mark reads, low priority');
  const played = [];
  const E = {
    _o: { x: 0, y: 0, z: 0, dist: NaN },
    opts() {
      this._o.x = NaN;
      this._o.y = NaN;
      this._o.z = NaN;
      this._o.dist = NaN;
      return this._o;
    },
    play(id, k, o) {
      played.push([id, k, o.x, o.y, o.z, o.dist]);
    },
  };
  SFX.hintBlipRoute({ x: 4, y: -5, z: 6, stage: 3 }, E);
  SFX.hintBlipRoute({ stage: 2 }, E);
  ok(played[0][0] === 'hint.blip' && played[0][1] === 1 && played[0][2] === 4 && played[0][3] === -5 && played[0][4] === 6, 'the route plays it AT the mark (stage 3 = k 1)');
  ok(played[1][1] === 0 && played[1][5] === 20, '... and without a position at a default distance');
  const game = fs.readFileSync(`${SRC_DIR}/game.js`, 'utf8');
  ok(/registerSfx\(HINT_BLIP_ID/.test(game) && /registerSfxRoute\(HINT_BLIP_EVENT/.test(game) && SFX.HINT_BLIP_EVENT === 'hint:wave:pass', 'registered through the SFX extension points on hint:wave:pass');
  ok(/emit\('hint:wave', \{ x: w\.x, y: w\.y, z: w\.z, stage: w\.stage/.test(game), "the sim emits hint:wave {x, y, z, stage} on a launch");
}

// ---- the caption --------------------------------------------------------------------------------------------------------------
{
  // three.js yaw 0 looks down -z; a mark at -x is on the left
  const sec = CAP.sectorOf(0, 0, 0, -10, 0);
  ok(sec === 6 && CAP.hintBlipDirection(sec, 0) === 'to your left', `yaw 0, mark at -x: sector ${sec} = to your left`);
  ok(CAP.sectorOf(0, 0, Math.PI / 2, -10, 0) === 0 && CAP.sectorOf(0, 0, Math.PI, -10, 0) === 2, 'turning toward it: ahead; turned away: to your right');
  const r = CAP.captionForEvent('hint:wave:pass', { x: -10, y: 0, z: 0, sector: 6, vert: 0 });
  ok(r && r.text === '[A soft golden blip, to your left]' && r.sev === 0, `caption: ${r && r.text}, low priority`);
  ok(CAP.captionForEvent('hint:wave:pass', { sector: 2, vert: -1 }).text === '[A soft golden blip, below you, right]', 'below / above words');
  ok(CAP.captionForEvent('hint:wave:pass', { sector: 2, vert: 0 }) === CAP.captionForEvent('hint:wave:pass', { sector: 2, vert: 0 }), 'frozen rules: no string per event');
  ok(CAP.CAPTION_EVENTS.includes('hint:wave:pass'), 'the tracker listens to hint:wave:pass');
  const T = new CAP.CaptionTracker();
  T.push('hint:wave:pass', { x: -10, y: 0, z: 0, sector: 6, vert: 0 });
  T.update(2, { x: 0, y: 0, z: 0, yaw: 0, ok: true });
  T.push('hint:wave:pass', { x: 10, y: 0, z: 0, sector: 2, vert: 0 });
  ok(T.lines.filter((l) => l.on).length === 1, 'never stacking: a second blip within 6 s adds no line');
}

console.log(fails ? `${fails} of ${n} FAILED` : `all ${n} hint-wave checks pass`);
process.exitCode = fails ? 1 : 0;
