// THE HOOD (plans/LANTERN_HOOD.md, Node): cover your lantern. Light keeps you alive, but light draws the Mason.
//   the pure sim/lanternHood.js: the slew (in 0.25 s, out 0.2 s), on = k > 0.6, the 0.6 s re-hood lock-out, hold / toggle modes,
//          not live = off at once, 'lantern:hood' {on} once per change, the debug force, the light / range / drain factors
//   the bag: Inventory3D.update's drain multiplier (x0.3 covered)
//   the REAL Creature3D + MasonSense (lit = false while covered): a covered player is never `sees` beyond bodyRange (MASON_BODY_SIGHT_LEASH.md:
//          up close it sees the body) while it still hunts him by sound; covering during the notice beat breaks the count (no commit); an uncovered player at ~20 m in a clear
//          line is noticed within 0.6 s of the uncover; a chase loses a covered player after its memory
//   the hood camper (tests/creature/pacing.mjs runOne with opts.hood, the REAL level): covered stallers are still found (sound + stall clock)
//   the input: desktop V held, touch HOOD, VR right grip at the lantern (not elsewhere, not while the right hand climbs), a quick left
//          stick click toggles (a held click stays the brake); the grip that covers is not a climb grab nor a yank
//   the views: roachView's lantern k x (1 - hood.k), lanternMood's still + pinched flame; the sounds' recipes compile and validate
//   no allocation per frame (static check of the hot paths + a heap delta), determinism, the wiring
//   node hood.mjs [--root DIR]
import '../input/register.mjs';
import fs from 'node:fs';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const THREE = await import('three');
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus, SETTINGS_DEFAULTS, UX_LIMITS, sanitizeUxSettings, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { Creature3D } = await import(srcUrl('sim/creature3d.js'));
const { SIGHT_TUNE } = await import(srcUrl('sim/masonSight.js'));
const { LanternHood, HOOD, hoodMode } = await import(srcUrl('sim/lanternHood.js'));
const { Inventory3D } = await import(srcUrl('sim/inventory3d.js'));
const { InputManager } = await import(srcUrl('input/inputManager.js'));
const { LAYOUT } = await import(srcUrl('input/touchLogic.js'));
const { roachContext } = await import(srcUrl('render/roachView.js'));
const { makeRoachCtx } = await import(srcUrl('sim/roaches.js'));
const { createLanternMood, lanternMood, lanternMoodInputs } = await import(srcUrl('render/lanternMood.js'));
const { compileRecipe, validateRecipe } = await import(srcUrl('audio/sfxDesign.js'));
const { HOOD_RECIPE, UNHOOD_RECIPE, HOOD_SFX_ID, UNHOOD_SFX_ID, lanternHoodRoute, registerLanternHoodSfx } = await import(srcUrl('audio/lanternHoodSfx.js'));
const { runOne } = await import('./pacing.mjs');

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

// ---- 1. the pure hood ------------------------------------------------------------------------------------------------------------
{
  const bus = new EventBus();
  const ev = [];
  bus.on('lantern:hood', (p) => ev.push(p.on));
  const h = new LanternHood(bus);
  ok(h.k === 0 && !h.on && h.mode === 'hold' && h.lightMul === 1 && h.rangeMul === 1 && h.drainMul === 1, 'starts uncovered, hold mode, all factors 1');
  let onAt = -1;
  let fullAt = -1;
  for (let i = 1; i <= 30; i++) {
    h.update(DT, true, true);
    if (h.on && onAt < 0) onAt = i * DT;
    if (h.k >= 1 && fullAt < 0) fullAt = i * DT;
  }
  ok(Math.abs(fullAt - HOOD.coverTime) <= DT + 1e-9 && Math.abs(onAt - HOOD.onK * HOOD.coverTime) <= DT + 1e-9, `covers in 0.25 s (full at ${f2(fullAt)} s), on once k > 0.6 (at ${f2(onAt)} s)`);
  ok(Math.abs(h.lightMul - 0.07) < 1e-9 && Math.abs(h.rangeMul - 0.25) < 1e-9 && Math.abs(h.drainMul - 0.3) < 1e-9, 'fully covered: light x0.07, range x0.25, drain x0.3');
  ok(ev.length === 1 && ev[0] === true, "'lantern:hood' {on:true} once");
  let offAt = -1;
  let zeroAt = -1;
  for (let i = 1; i <= 30; i++) {
    h.update(DT, false, true);
    if (!h.on && offAt < 0) offAt = i * DT;
    if (h.k <= 0 && zeroAt < 0) zeroAt = i * DT;
  }
  ok(Math.abs(zeroAt - HOOD.uncoverTime) <= DT + 1e-9 && offAt <= (1 - HOOD.onK) * HOOD.uncoverTime + DT + 1e-9, `uncovers in 0.2 s (clear at ${f2(zeroAt)} s, off at ${f2(offAt)} s)`);
  ok(ev.length === 2 && ev[1] === false, "'lantern:hood' {on:false} once");
  // the lock-out: 0.6 s after the release, holding again does nothing; then it covers
  const h2 = new LanternHood(null);
  for (let i = 0; i < 30; i++) h2.update(DT, true, true);
  h2.update(DT, false, true); // the release starts the lock-out
  let firstK = -1;
  let zero = false;
  for (let i = 1; i <= 90; i++) {
    h2.update(DT, true, true);
    if (h2.k === 0) zero = true;
    if (zero && h2.k > 0.5 && firstK < 0) firstK = i * DT;
  }
  // k falls to 0 over 0.2 s, stays down until the lock ends at 0.6 s, then rises
  ok(zero && firstK > HOOD.lockout && firstK < HOOD.lockout + HOOD.coverTime, `re-hood lock-out: held again at once, covered again only after 0.6 s (k > 0.5 at ${f2(firstK)} s)`);
  // a quick tap that never reached `on` starts no lock-out
  const h3 = new LanternHood(null);
  for (let i = 0; i < 5; i++) h3.update(DT, true, true); // k 0.33
  h3.update(DT, false, true);
  h3.update(DT, true, true);
  ok(h3.lock === 0 && h3.k > 0.3, 'a brush of the hood that never covered starts no lock-out');
  // toggle mode: each press flips it; a held input does nothing more
  const h4 = new LanternHood(null);
  h4.mode = 'toggle';
  h4.update(DT, true, true);
  for (let i = 0; i < 40; i++) h4.update(DT, i < 10, true);
  ok(h4.on && h4.k === 1, 'toggle: a press covers and it stays covered after the release');
  h4.update(DT, true, true);
  for (let i = 0; i < 20; i++) h4.update(DT, false, true);
  ok(!h4.on && h4.k === 0, 'toggle: the next press uncovers');
  h4.update(DT, true, true); // inside the lock-out: refused
  h4.update(DT, false, true);
  for (let i = 0; i < 20; i++) h4.update(DT, false, true);
  ok(!h4.on && h4.stats.refused >= 1, 'toggle: a press inside the lock-out is refused (no strobing)');
  for (let i = 0; i < 40; i++) h4.update(DT, false, true);
  h4.update(DT, false, true, true); // a toggle edge (VR stick tap)
  for (let i = 0; i < 20; i++) h4.update(DT, false, true);
  ok(h4.on, 'toggle: the toggle edge flips it too');
  // hold mode: a toggle edge latches; pressing the hold input takes the latch back
  const h5 = new LanternHood(null);
  h5.update(DT, false, true, true);
  for (let i = 0; i < 20; i++) h5.update(DT, false, true);
  ok(h5.on && h5.latched, 'hold mode: the stick tap latches the hood');
  h5.update(DT, true, true);
  for (let i = 0; i < 20; i++) h5.update(DT, true, true);
  ok(h5.on && !h5.latched, 'hold mode: grabbing the hold input takes over the latch (still covered while held)');
  for (let i = 0; i < 20; i++) h5.update(DT, false, true);
  ok(!h5.on, '... and the release uncovers');
  // not live: off at once, with the event
  const ev6 = [];
  const b6 = new EventBus();
  b6.on('lantern:hood', (p) => ev6.push(p.on));
  const h6 = new LanternHood(b6);
  for (let i = 0; i < 20; i++) h6.update(DT, true, true);
  h6.update(DT, true, false);
  ok(h6.k === 0 && !h6.on && ev6.join() === 'true,false', 'not live (dead, paused out, menu): uncovered at once, the event sent');
  for (let i = 0; i < 20; i++) h6.update(DT, true, false);
  ok(h6.k === 0, '... and it stays off while not live');
  // the debug force
  const h7 = new LanternHood(null);
  h7.force(true);
  for (let i = 0; i < 20; i++) h7.update(DT, false, true);
  ok(h7.on, 'debug force(true) covers without input');
  h7.force(null);
  for (let i = 0; i < 20; i++) h7.update(DT, false, true);
  ok(!h7.on, 'debug force(null) gives it back to the input');
  // the setting
  ok(SETTINGS_DEFAULTS.lanternHood === 'hold' && UX_LIMITS.lanternHoods.join() === 'hold,toggle', "setting lanternHood: 'hold' default, 'hold' | 'toggle'");
  const s = Object.assign({}, SETTINGS_DEFAULTS, { lanternHood: 'bogus' });
  sanitizeUxSettings(s);
  const s2 = Object.assign({}, SETTINGS_DEFAULTS, { lanternHood: 'toggle' });
  sanitizeUxSettings(s2);
  ok(s.lanternHood === 'hold' && s2.lanternHood === 'toggle' && hoodMode(s2) === 'toggle' && hoodMode(null) === 'hold', 'sanitize: a bad value falls back to hold; toggle kept; hoodMode()');
}

// ---- 2. the bag drain --------------------------------------------------------------------------------------------------------------
{
  const a = new Inventory3D(null);
  const b = new Inventory3D(null);
  const h = new LanternHood(null);
  for (let i = 0; i < 30; i++) h.update(DT, true, true);
  for (let i = 0; i < 6000; i++) {
    a.update(DT, null, true);
    b.update(DT, null, true, h.drainMul);
  }
  const da = 1 - a.lanternCharge;
  const db = 1 - b.lanternCharge;
  ok(Math.abs(db / da - HOOD.drainHooded) < 1e-6, `drain x${f2(db / da)} while covered (100 s: ${da.toFixed(4)} -> ${db.toFixed(4)} of the charge)`);
  const c = new Inventory3D(null);
  c.update(1, null, true, NaN);
  c.update(1, null, true, 7);
  ok(Math.abs(1 - c.lanternCharge - 2 * CONFIG.bag.lanternDrain) < 1e-12, 'a bad drain multiplier is ignored (x1)');
}

// ---- 3. the REAL Mason: hooded = never seen; it still hunts by sound --------------------------------------------------------------
const LEDGE = { x: -14.4, y: -343.1, z: -4 }; // a stub-shaft ledge in s6 (hunt, lethal): see sight.mjs
const EVENTS = ['creature:notice', 'creature:sight', 'creature:attack', 'creature:strike'];
function mk(key, seed, opts = {}) {
  const L = opts.real ? new Level3D(undefined, DIFFICULTY[key].levelVariant) : new Level3D(makeShaftData(), key);
  const bus = new EventBus();
  const w = { L, bus, t: 0, ev: [], seen: 0, seenFar: 0, chased: 0 };
  for (const e of EVENTS) bus.on(e, (p) => w.ev.push({ t: w.t, type: e, p }));
  w.c = new Creature3D(L, DIFFICULTY[key], bus, { seed });
  w.hood = new LanternHood(bus);
  w.p = { x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true };
  w.c.reset(w.p);
  w.held = false;
  // one game frame: the hood, then setSight(lit = charge > 0 && !hood.on) as game.js does, then the creature
  w.step = (n, each) => {
    for (let i = 0; i < n; i++) {
      w.t += DT;
      if (each && each(w) === false) return false;
      w.hood.update(DT, w.held, true);
      w.c.setSight(true, !w.hood.on, false);
      w.c.update(DT, w.p, w.t);
      if (w.c.sight.sees) w.seen++;
      if (w.c.sight.sees && (w.c.sight.by !== 'body' || w.c.distance > w.c.sense.tune.bodyRange + 1)) w.seenFar++; // (sampled every 0.1 s: +1 m slack)
      if (w.c.sight.chasing) w.chased++;
    }
    return true;
  };
  w.count = (type, pred) => w.ev.filter((e) => e.type === type && (!pred || pred(e.p))).length;
  w.first = (type, pred) => w.ev.find((e) => e.type === type && (!pred || pred(e.p)));
  return w;
}
{
  let good = true;
  let found = 0;
  const line = [];
  for (const k of ['normal', 'nightmare', 'abyss']) {
    for (let seed = 1; seed <= 3; seed++) {
      const w = mk(k, seed);
      w.held = true;
      let caught = -1;
      w.step(60 * 60, (x) => {
        // a player who keeps working along the ledge (sound: the Mason hears motion)
        x.p.vx = Math.cos(x.t * 0.7) * 1.4;
        x.p.x = LEDGE.x + Math.sin(x.t * 0.7) * 2;
        if (x.c.caughtPlayer) {
          if (caught < 0) caught = x.t;
          x.c.caughtPlayer = false;
          x.c.onRespawn(x.p);
        }
      });
      // MASON_BODY_SIGHT_LEASH.md: covered, it never sees you BEYOND bodyRange (up close it sees your body: every sighting is 'body')
      if (w.seenFar > 0 || w.count('creature:notice', (p) => p.by !== 'body' || p.distance > SIGHT_TUNE[k].bodyRange + 0.5) > 0) good = false;
      const hunted = w.count('creature:attack') > 0 || caught > 0;
      if (hunted) found++;
      if (seed === 1) line.push(`${k}: ${w.count('creature:attack')} attacks, first catch ${caught > 0 ? caught.toFixed(1) + ' s' : 'none'}`);
    }
  }
  ok(good, 'the REAL MasonSense with the lantern covered (lit = false): never `sees` by the light, never beyond bodyRange (12 / 14 / 16 m), in 60 s x 3 seeds x 3 difficulties');
  ok(found >= 7, `... but it still hunts the covered player by sound: ${found}/9 runs it attacked or caught him (${line.join('; ')})`);
}

// ---- 4. covering during the notice beat breaks the count; an uncovered player at ~20 m is noticed within 0.6 s --------------------
{
  let good = true;
  const line = [];
  for (const k of ['normal', 'nightmare', 'abyss']) {
    for (let seed = 1; seed <= 3; seed++) {
      const w = mk(k, seed);
      // lit until the first notice, then cover at once
      w.step(60 * 30, (x) => {
        if (!x.held && x.count('creature:notice') > 0) x.held = true;
        return !(x.held && x.hood.on && x.t > 0);
      });
      const n = w.first('creature:notice');
      w.step(60 * 6);
      // MASON_BODY_SIGHT_LEASH.md: the light notice never commits; a later commit can only come from the body sight, within bodyRange
      const committed = w.count('creature:sight', (p) => p.on && p.distance > SIGHT_TUNE[k].bodyRange + 1);
      const bodyFirst = w.ev.filter((e) => e.type === 'creature:sight' && e.p.on).every((e) => w.ev.some((q) => q.type === 'creature:notice' && q.p.by === 'body' && q.t <= e.t && q.t > n.t));
      if (!n || n.p.by !== 'light' || committed > 0 || !bodyFirst) good = false;
      if (seed === 1) line.push(`${k} noticed at ${n ? n.p.distance.toFixed(1) : '-'} m, covered ${w.hood.on ? 'in time' : 'late'}`);
    }
  }
  ok(good, `covering inside the 0.5 s notice beat breaks the count: no commit from the light (only a later body sighting within bodyRange can) (${line.join('; ')})`);

  let good2 = true;
  let counted = 0;
  const delays = [];
  for (const k of ['normal', 'nightmare', 'abyss']) {
    for (let seed = 1; seed <= 4; seed++) {
      const w = mk(k, seed);
      w.held = true;
      // covered until it is ~20 m off, eligible, with a clear line (it comes on the sound hunt / the stall clock)
      const reached = !w.step(60 * 120, (x) => {
        const s = x.c.sense;
        const d = x.c.distance;
        if (d <= 20.5 && d >= 15 && s.sight.eligible && s._los(x.p) && x.c.state !== 'ATTACK') return false;
        x.p.vx = Math.cos(x.t) * 0.8;
        x.p.x = LEDGE.x + Math.sin(x.t) * 0.8;
      });
      if (!reached) {
        good2 = false;
        continue;
      }
      const d0 = w.c.distance;
      const t0 = w.t;
      w.held = false;
      w.p.vx = 0;
      let stayed = true; // it may go to rest (RECOVERING: out of stamina) in that second: a resting Mason sees nothing by design
      w.step(60, (x) => {
        if (x.t - t0 <= 0.6 && x.c.sense.sight.eligible === false && x.t - t0 > DT) stayed = false;
      });
      const n = w.first('creature:notice');
      const dt = n ? n.t - t0 : 99;
      if (!n && !stayed) {
        delays.push(`${k}#${seed} rested`);
        continue;
      }
      counted++;
      delays.push(`${k}#${seed} ${d0.toFixed(1)} m: ${f2(dt)} s`);
      if (!(dt <= 0.6)) good2 = false;
    }
  }
  ok(good2 && counted >= 9, `an uncovered player at ~20 m in a clear line is noticed within 0.6 s of the uncover (${delays.join(', ')})`);

  // a chase in progress loses a covered player after its memory
  let good3 = true;
  const mem = [];
  for (const k of ['normal', 'nightmare', 'abyss']) {
    const w = mk(k, 2);
    w.step(60 * 25, (x) => !x.c.sight.chasing);
    if (!w.c.sight.chasing) {
      good3 = false;
      continue;
    }
    w.c.lethal = false; // keep the player alive through the chase
    w.held = true;
    // MASON_BODY_SIGHT_LEASH.md: the light's rule alone (up close it would keep seeing the body: body-sight.mjs checks that side)
    w.c.sense.tune = Object.assign({}, SIGHT_TUNE[k], { bodyRange: -1 });
    const t0 = w.t;
    w.step(60 * 12, (x) => {
      x.c.lethal = false;
      return x.c.sight.chasing;
    });
    const lost = w.t - t0;
    mem.push(`${k} ${f2(lost)} s`);
    if (w.c.sight.chasing || lost > SIGHT_TUNE[k].memory + 0.5) good3 = false;
  }
  ok(good3, `covered mid-chase: it loses you after its memory (+ the cover slew + one 0.1 s sample): ${mem.join(', ')}`);
}

// ---- 5. the hood camper on the REAL level: covered stallers are still found ----------------------------------------------------------
{
  const N = 16;
  const rows = [];
  let freeWin = false;
  for (const dk of ['normal', 'nightmare']) {
    const lit = [];
    const cov = [];
    for (let s = 1; s <= N; s++) {
      lit.push(runOne(dk, 'careful', 1000 + s, 'stall'));
      cov.push(runOne(dk, 'careful', 1000 + s, 'stall', { hood: 'stall' }));
    }
    const caught = (rs) => rs.filter((r) => r.stallCatch !== null).length;
    const med = (rs) => {
      const a = rs.filter((r) => r.stallCatch !== null).map((r) => r.stallCatch).sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : NaN;
    };
    rows.push(`${dk}: lit ${caught(lit)}/${N} caught (median ${f2(med(lit))} s), covered ${caught(cov)}/${N} (median ${f2(med(cov))} s)`);
    // a free win would be: covering turns caught campers into never-caught ones wholesale
    if (caught(cov) < caught(lit) - 3 || !(med(cov) < 60)) freeWin = true;
  }
  ok(!freeWin, `hood camping is not a free win (stub shaft${process.env.LEVEL === 'real' ? ' / real level' : ''}, careful stallers, 400 s cap): ${rows.join('; ')}`);
}

// ---- 6. the input ------------------------------------------------------------------------------------------------------------------
class MockXR extends THREE.EventDispatcher {
  constructor() {
    super();
    this.isPresenting = false;
    this.c = [];
    this.g = [];
    this.session = null;
    this.cameraXR = new THREE.ArrayCamera();
    this.cameraXR.cameras = [];
    this.ref = null;
  }
  getController(i) {
    if (!this.c[i]) {
      const o = new THREE.Group();
      o.matrixAutoUpdate = false;
      this.c[i] = o;
    }
    return this.c[i];
  }
  getControllerGrip(i) {
    if (!this.g[i]) {
      const o = new THREE.Group();
      o.matrixAutoUpdate = false;
      this.g[i] = o;
    }
    return this.g[i];
  }
  getCamera() {
    return this.cameraXR;
  }
  getSession() {
    return this.session;
  }
  getReferenceSpace() {
    return this.ref;
  }
  setReferenceSpaceType() {}
  async setSession(s) {
    this.session = s;
    this.ref = new EventTarget();
    this.isPresenting = true;
    this.cameraXR.cameras = [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()];
    this.dispatchEvent({ type: 'sessionstart' });
  }
  connect(i, src) {
    this.getController(i)._src = src;
    this.getController(i).dispatchEvent({ type: 'connected', data: src });
  }
  pose(i, pos) {
    for (const o of [this.getController(i), this.getControllerGrip(i)]) {
      o.matrix.compose(pos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      o.visible = true;
      o.matrixWorldNeedsUpdate = true;
    }
  }
  head(pos) {
    this.cameraXR.matrix.compose(pos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  }
}
const btn = (v) => ({ value: v, pressed: v > 0.5, touched: v > 0 });
function makeSource(handedness) {
  return {
    handedness,
    targetRayMode: 'tracked-pointer',
    hand: null,
    profiles: ['meta-quest-touch-plus'],
    gamepad: { mapping: 'xr-standard', buttons: [btn(0), btn(0), btn(0), btn(0), btn(0), btn(0)], axes: [0, 0, 0, 0], hapticActuators: [{ pulse: () => Promise.resolve(true) }] },
  };
}
class FakeTarget extends EventTarget {
  constructor() {
    super();
    this.pointerLockElement = null;
    this.visibilityState = 'visible';
  }
  hasFocus() {
    return true;
  }
  exitPointerLock() {
    this.pointerLockElement = null;
  }
}
function setupInput() {
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  rig.add(camera);
  const xr = new MockXR();
  const canvas = new FakeTarget();
  canvas.tagName = 'CANVAS';
  canvas.requestPointerLock = () => {};
  const lanternGroup = new THREE.Group();
  scene.add(lanternGroup); // the lantern light's group (in the game it hangs from the left bracer's lantern socket)
  const climb = { hands: { left: { gripping: false }, right: { gripping: false } } };
  const game = { state: 'playing', renderer: { lanternGroup }, physics: { climb }, bag: null, knocker: null };
  const settings = Object.assign({}, SETTINGS_DEFAULTS);
  const im = new InputManager({ renderer: { xr, domElement: null }, camera, rig, canvas, settings, bus: new EventBus(), game, env: { window: new FakeTarget(), document: new FakeTarget() } });
  return { im, xr, rig, lanternGroup, climb, game };
}
const frame = (im, dt = 1 / 72) => {
  const I = im.update(dt);
  const o = { hood: I.hood, hoodToggle: I.hoodToggle, grabR: I.climb.grab.right, yankR: I.hands.right.yank, brake: I.brake, any: I.anyPressed };
  im.endFrame();
  return o;
};
{
  // desktop: V held = hood; it is not a "press any key"; touch HOOD held
  const { im } = setupInput();
  im.desktop.onKeyDown({ code: 'KeyV', target: null, preventDefault() {} });
  let I = frame(im);
  ok(I.hood && !I.any && im.hood, 'desktop: V held = intent.hood (and im.hood), not an any-key press');
  I = frame(im);
  ok(I.hood, 'desktop: still covered while V is held');
  im.desktop.onKeyUp({ code: 'KeyV' });
  I = frame(im);
  ok(!I.hood, 'desktop: V released = uncovered');
  im.desktop.onKeyDown({ code: 'KeyV', target: null, preventDefault() {} });
  im.setUIMode(true);
  I = frame(im);
  ok(!I.hood, 'desktop: no hood while a panel is up');
  im.setUIMode(false);
  im.desktop.onKeyUp({ code: 'KeyV' });
  ok(LAYOUT.some((d) => d.id === 'hood'), 'touch: a HOOD button in the layout');
  const src = fs.readFileSync(SRC_DIR + '/input/touchInput.js', 'utf8');
  ok(/hood: new ButtonMachine\('hold'\)/.test(src) && /get hoodHeld\(\)/.test(src) && /mk\('hood'/.test(src), 'touch: the HOOD button is built, held like GRIP, read as hoodHeld');
  im.dispose();
}
{
  const { im, xr, rig, lanternGroup, climb } = setupInput();
  const sess = new EventTarget();
  sess.visibilityState = 'visible';
  sess.end = () => Promise.resolve();
  await xr.setSession(sess);
  const L = makeSource('left');
  const R = makeSource('right');
  xr.connect(0, R);
  xr.connect(1, L);
  rig.position.set(0, 0, 0);
  xr.head(new THREE.Vector3(0, 1.6, 0));
  // the lantern at the left wrist; the right hand far away
  const LANT = new THREE.Vector3(-0.2, 1.1, -0.3);
  lanternGroup.position.copy(LANT);
  xr.pose(0, new THREE.Vector3(0.3, 1.2, -0.3));
  xr.pose(1, new THREE.Vector3(-0.2, 1.18, -0.3));
  frame(im);
  R.gamepad.buttons[1] = btn(1);
  let I = frame(im);
  ok(!I.hood && I.grabR && I.yankR === 1, 'VR: a right grip away from the lantern is a grab / yank, not the hood');
  R.gamepad.buttons[1] = btn(0);
  frame(im);
  // the right hand over the lantern (5 cm)
  xr.pose(0, new THREE.Vector3(-0.17, 1.13, -0.27));
  I = frame(im);
  ok(!I.hood, 'VR: the hand at the lantern without the grip: no hood');
  R.gamepad.buttons[1] = btn(1);
  I = frame(im);
  ok(I.hood && !I.grabR && I.yankR === 0, 'VR: right grip with the hand within 12 cm of the lantern = hood; that grip is no climb grab and no yank');
  xr.pose(0, new THREE.Vector3(-0.2 + 0.15, 1.1, -0.3)); // drifts 15 cm off: kept (hysteresis 18 cm)
  I = frame(im);
  ok(I.hood, 'VR: kept while the hand drifts within 18 cm');
  xr.pose(0, new THREE.Vector3(-0.2 + 0.3, 1.1, -0.3));
  I = frame(im);
  ok(!I.hood, 'VR: the hand leaves the lantern: uncovered');
  R.gamepad.buttons[1] = btn(0);
  frame(im);
  // the right hand already holding on (climb gripping): a squeeze there is not a hood
  xr.pose(0, new THREE.Vector3(-0.18, 1.12, -0.3));
  climb.hands.right.gripping = true;
  R.gamepad.buttons[1] = btn(1);
  I = frame(im);
  ok(!I.hood && I.grabR, 'VR: not while climb3d holds on with the right hand');
  climb.hands.right.gripping = false;
  R.gamepad.buttons[1] = btn(0);
  frame(im);
  // left stick click: a quick tap toggles, a held click is the brake only
  L.gamepad.buttons[3] = btn(1);
  I = frame(im);
  ok(I.brake && !I.hoodToggle, 'VR: the left stick click brakes while held');
  L.gamepad.buttons[3] = btn(0);
  I = frame(im);
  ok(I.hoodToggle, 'VR: a quick left stick click (released within 0.3 s) = the hood toggle edge');
  I = frame(im);
  ok(!I.hoodToggle, 'VR: the toggle is an edge');
  L.gamepad.buttons[3] = btn(1);
  for (let i = 0; i < 40; i++) frame(im);
  L.gamepad.buttons[3] = btn(0);
  I = frame(im);
  ok(!I.hoodToggle, 'VR: a long click (the brake) does not toggle');
  im.dispose();
}

// ---- 7. the views + the sounds -----------------------------------------------------------------------------------------------------
{
  // roachView: the lantern's k is the light ratio x (1 - hood.k) (the base is scaled by the hood, so the ratio alone would cancel it)
  const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  cam.updateMatrixWorld();
  const lantern = new THREE.PointLight(0xffffff, 6.5 * 0.07);
  lantern.updateMatrixWorld();
  const game = {
    renderer: { camera: cam, lantern, lanternBase: 6.5 * 0.07, qualityTier: 'quest' },
    player: { rx: 0, ry: 0, rz: 0, vx: 0, vy: 0, vz: 0, alive: true },
    state: 'playing',
    settings: {},
    hood: { on: true, k: 1 },
  };
  const ctx = roachContext(game, makeRoachCtx());
  game.hood = { on: false, k: 0 };
  const ctx2 = roachContext(game, makeRoachCtx());
  ok(ctx.lantern.k === 0 && ctx2.lantern.k === 1, `roachView: a covered lantern scares no swarm (k ${ctx.lantern.k}), uncovered it does (k ${ctx2.lantern.k})`);
  // lanternMood: hooded = still and the flame pinched, with the living flame on and off
  const g2 = { player: { vy: 0, alive: true }, state: 'playing', threat: { value: 0 }, settings: {}, hood: { k: 1 } };
  const m = createLanternMood();
  for (let i = 0; i < 60; i++) lanternMood(DT, lanternMoodInputs(g2, null), m);
  g2.settings = { livingFlame: false };
  const m2 = lanternMood(DT, lanternMoodInputs(g2, null), createLanternMood());
  g2.hood = { k: 0 };
  g2.settings = {};
  const m3 = createLanternMood();
  for (let i = 0; i < 60; i++) lanternMood(DT, lanternMoodInputs(g2, null), m3);
  ok(m.still === 1 && Math.abs(m.scale - 0.2) < 0.02 && m2.still === 1 && Math.abs(m2.scale - 0.2) < 1e-9 && m3.still === 0 && Math.abs(m3.scale - 1) < 1e-9, `lanternMood: covered = still 1, flame x${f2(m.scale)} (living flame off too); uncovered unchanged`);
  // the sounds: compile, validate, the route plays cover / uncover at the left hand
  let errs = [];
  for (const [id, r] of [
    [HOOD_SFX_ID, HOOD_RECIPE],
    [UNHOOD_SFX_ID, UNHOOD_RECIPE],
  ]) {
    try {
      errs = errs.concat(validateRecipe(compileRecipe(id, r)));
    } catch (e) {
      errs.push(String(e.message || e));
    }
  }
  ok(errs.length === 0, `the cover / uncover recipes compile and validate${errs.length ? ': ' + errs.join('; ') : ''}`);
  const plays = [];
  const E = { _o: { hand: '' }, opts() { this._o.hand = ''; return this._o; }, play: (id, k, o) => plays.push(id + '@' + o.hand) };
  lanternHoodRoute({ on: true }, E);
  lanternHoodRoute({ on: false }, E);
  const reg = [];
  const audio = { registerSfx: (id) => (reg.push(id), {}), registerSfxRoute: (t) => reg.push('route:' + t) };
  ok(plays.join() === 'lantern.hood@left,lantern.unhood@left' && registerLanternHoodSfx(audio) && reg.join() === 'lantern.hood,lantern.unhood,route:lantern:hood' && registerLanternHoodSfx(null) === false, "the route: 'lantern:hood' on -> the muffle, off -> the flare-back, at the left hand; registered through registerSfx / registerSfxRoute");
  const sfxSrc = fs.readFileSync(SRC_DIR + '/audio/lanternHoodSfx.js', 'utf8');
  ok(!/Math\.random/.test(sfxSrc), 'the sounds: no Math.random');
}

// ---- 8. no allocation per frame; determinism -------------------------------------------------------------------------------------
{
  const src = fs.readFileSync(SRC_DIR + '/sim/lanternHood.js', 'utf8');
  const body = (name) => {
    const i = src.indexOf('\n  ' + name + '(');
    const j = src.indexOf('\n  }\n', i);
    return i > 0 && j > i ? src.slice(i, j) : '';
  };
  const hot = ['update', '_flip', '_emit', 'reset'].map(body).join('\n');
  const bad = [/\bnew\s/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.(map|filter|slice|concat|join|bind)\(/].filter((r) => r.test(hot));
  ok(hot.length > 800 && bad.length === 0 && !/Math\.random/.test(src), `sim/lanternHood.js: no allocation in update / _flip / _emit / reset, no Math.random${bad.length ? ' — found ' + bad.join(' ') : ''}`);
  const glue = fs.readFileSync(SRC_DIR + '/lanternHoodGlue.js', 'utf8');
  const gu = glue.slice(glue.indexOf('\n  update('), glue.indexOf('\n  }\n', glue.indexOf('\n  update(')));
  ok(gu.length > 100 && ![/\bnew\s/, /=>/, /`/, /[=(,]\s*\{/, /[=(,]\s*\[/].some((r) => r.test(gu)), 'lanternHoodGlue.js update: no allocation');
  const bus = new EventBus();
  let n = 0;
  bus.on('lantern:hood', () => n++);
  const h = new LanternHood(bus);
  for (let i = 0; i < 2000; i++) h.update(DT, (i >> 6) & 1, true, (i & 255) === 3);
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 400000; i++) h.update(DT, (i >> 6) & 1, true, (i & 255) === 3);
  const grew = process.memoryUsage().heapUsed - before;
  ok(grew < 512 * 1024 && n > 1000, `400 k hood steps (${n} events) grow the heap by ${(grew / 1024).toFixed(0)} KB (< 512 KB: no per-frame objects)`);
  const run = () => {
    const x = new LanternHood(null);
    let acc = 0;
    for (let i = 0; i < 5000; i++) acc += x.update(DT, ((i * 7) >> 5) & 1, i % 900 < 850, (i % 333) === 5).k;
    return acc;
  };
  ok(run() === run(), 'deterministic: the same inputs give the same k');
}

// ---- 9. the wiring --------------------------------------------------------------------------------------------------------------
{
  const g = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  ok(/_setupHood\(\);/.test(g) && /this\._updateHood\(dt, intent\)/.test(g), 'game.js: _setupHood at boot, _updateHood every run frame before the bag');
  ok(/lanternCharge > 0\) && !\(this\.hood && this\.hood\.on\)/.test(g) && /c\.setSight\(sightOn, lit,/.test(g), 'game.js: the Mason sees a lit AND uncovered lantern');
  ok(/hood\.lightMul/.test(g) && /hood\.rangeMul/.test(g) && /this\.hood \? this\.hood\.drainMul : 1/.test(g), 'game.js: the light, its range and the drain follow the hood');
  ok(/hood: \(on\) =>/.test(g), 'game.js: AT3D.debug.hood(on)');
  const ui = fs.readFileSync(SRC_DIR + '/ui/ui3d.js', 'utf8');
  ok(/key: 'lanternHood', tab: 'comfort'/.test(ui), 'ui3d.js: the Lantern hood row (Comfort)');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL HOOD CHECKS PASS');
process.exit(fails ? 1 : 0);
