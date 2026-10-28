// Node tests for WP-UX: settings persistence + sanitising (config3d / uxLogic / meta/save), the caption mapping and tracker
// (ui/captions.js), snap turn + vignette rules, the display helpers and the first-run tutorial logic on fakes.
// Run: node tools/abyssal-tether-3d/tests/ux/unit.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';

// A localStorage for Storage (config3d reads it lazily on each call).
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const C = await import(srcUrl('sim/config3d.js'));
const X = await import(srcUrl('ui/uxLogic.js'));
const CAP = await import(srcUrl('ui/captions.js'));
const TUT = await import(srcUrl('ui/tutorial.js'));
const SAVE = await import(srcUrl('meta/save.js'));

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL:', m);
  }
};
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- settings: defaults, round trip, sanitising, migration -------------------------------------------------------
{
  const D = C.SETTINGS_DEFAULTS;
  for (const k of ['musicVolume', 'sfxVolume', 'hapticStrength', 'captions', 'colorSafe', 'textScale', 'vignette', 'turnMode', 'snapAngle', 'qualityTier', 'renderScale', 'brightness', 'blackLevel', 'brightnessChecked', 'reducedEffects', 'tutorialHints']) {
    ok(k in D, `default for ${k}`);
  }
  ok(D.vignette === 0 && D.turnMode === 'smooth' && D.qualityTier === 'auto' && D.captions === false, 'comfort options default off / smooth / auto (owner design)');

  mem.clear();
  let s = C.Storage.loadSettings();
  ok(s.musicVolume === D.musicVolume && s.snapAngle === 45, 'empty storage loads the defaults');
  s.vignette = 0.6;
  s.turnMode = 'snap';
  s.snapAngle = 30;
  s.captions = true;
  s.colorSafe = true;
  s.qualityTier = 'high';
  s.renderScale = 1.2;
  s.textScale = 1.3;
  s.brightness = 1.25;
  s.blackLevel = 0.4;
  s.sfxVolume = 0.35;
  s.hapticStrength = 1.4;
  s.reducedEffects = true;
  C.Storage.saveSettings(s);
  const back = C.Storage.loadSettings();
  ok(back.vignette === 0.6 && back.turnMode === 'snap' && back.snapAngle === 30 && back.captions === true && back.colorSafe === true, 'comfort + access settings round trip through Storage');
  ok(back.qualityTier === 'high' && back.renderScale === 1.2 && back.textScale === 1.3 && back.brightness === 1.25 && back.blackLevel === 0.4, 'display settings round trip');
  ok(back.sfxVolume === 0.35 && back.hapticStrength === 1.4 && back.reducedEffects === true, 'audio / haptics / reduced effects round trip');

  // hostile stored values are clamped / dropped
  mem.set('abyssalTether3d.v1.settings', JSON.stringify({ vignette: 7, turnMode: 'warp', snapAngle: 52, textScale: 99, qualityTier: 'ultra', renderScale: 0, brightness: -3, blackLevel: 5, hapticStrength: 'x', volume: 2, musicVolume: -1 }));
  const bad = C.Storage.loadSettings();
  ok(bad.vignette === 1 && bad.turnMode === 'smooth' && bad.snapAngle === 45 && bad.textScale === 1.5 && bad.qualityTier === 'auto', 'out-of-range comfort values are sanitised');
  ok(bad.renderScale === 0.7 && bad.brightness === 0.6 && bad.blackLevel === 1 && bad.hapticStrength === 1 && bad.volume === 1 && bad.musicVolume === 0, 'ranges clamp, wrong types fall back to the default');
  const t = C.sanitizeUxSettings({ snapAngle: 75, captions: 'yes', tutorialHints: 0 });
  ok(t.snapAngle === 60 || t.snapAngle === 90, 'snap angle snaps to an allowed value');
  ok(t.captions === false && t.tutorialHints === true, 'booleans are strict (captions) / default-on (tutorial hints)');

  // an old save without any WP-UX key migrates to the defaults and keeps what it had
  mem.set('abyssalTether3d.v1.settings', JSON.stringify({ volume: 0.3, dominantHand: 'left', haptics: false }));
  const old = C.Storage.loadSettings();
  ok(old.volume === 0.3 && old.dominantHand === 'left' && old.haptics === false, 'old keys survive');
  ok(old.musicVolume === D.musicVolume && old.turnMode === 'smooth' && old.vignette === 0, 'missing WP-UX keys take the defaults');
}

// ---- settings reach the save profile (restore after a storage wipe) ------------------------------------------------
{
  const store = new SAVE.SaveStore({ primary: new SAVE.MemoryAdapter(), secondary: null, legacyGetItem: null, debounceMs: 5 });
  await store.load();
  const s = Object.assign({}, C.SETTINGS_DEFAULTS, { vignette: 0.5, turnMode: 'snap', snapAngle: 90, captions: true, colorSafe: true, qualityTier: 'low', brightness: 1.2, blackLevel: 0.25, sfxVolume: 0.5 });
  store.recordSettings(s);
  const saved = store.profile.settings;
  ok(saved && saved.vignette === 0.5 && saved.turnMode === 'snap' && saved.snapAngle === 90 && saved.captions === true && saved.colorSafe === true, 'WP-UX settings are written into the profile');
  await store.flush();
  const again = new SAVE.SaveStore({ primary: store.primary, secondary: null, legacyGetItem: null, debounceMs: 5 });
  await again.load();
  ok(again.profile.settings && again.profile.settings.qualityTier === 'low' && again.profile.settings.brightness === 1.2 && again.profile.settings.blackLevel === 0.25, 'and survive a reload of the profile');
  // the restore loop game.js runs when localStorage was wiped: only known keys of the right type come back
  const restored = Object.assign({}, C.SETTINGS_DEFAULTS);
  for (const k of Object.keys(C.SETTINGS_DEFAULTS)) {
    const v = again.profile.settings[k];
    if (k in again.profile.settings && typeof v === typeof C.SETTINGS_DEFAULTS[k]) restored[k] = v;
  }
  C.sanitizeUxSettings(restored);
  ok(restored.turnMode === 'snap' && restored.snapAngle === 90 && restored.sfxVolume === 0.5 && restored.colorSafe === true, 'restoring from the profile gives the saved comfort settings');
  store.close();
  again.close();
}

// ---- snap turn ---------------------------------------------------------------------------------------------------------
{
  const st = X.makeSnapState();
  const full = X.SNAP_FULL_RATE;
  let total = 0;
  const steps = [];
  const feed = (n) => {
    const r = X.snapTurnStep(st, n * full, full, 45);
    if (r !== 0) steps.push(r);
    total += r;
  };
  for (let i = 0; i < 30; i++) feed(0.9); // one long push right: ONE step
  ok(steps.length === 1 && near(steps[0], Math.PI / 4), 'a held stick snaps once by the angle');
  for (let i = 0; i < 5; i++) feed(0.45); // between on and off: still not re-armed
  ok(steps.length === 1, 'hysteresis: a half push does not re-arm');
  feed(0);
  feed(-0.8);
  ok(steps.length === 2 && near(steps[1], -Math.PI / 4), 'after centring the other way snaps back');
  ok(near(total, 0), 'net turn is zero');
  ok(X.snapTurnStep(X.makeSnapState(), 0.3 * full, full, 45) === 0, 'a light push below the threshold does nothing');
}

// ---- comfort vignette ----------------------------------------------------------------------------------------------------
{
  ok(X.vignetteLevel(0, 0, false) === 0 && X.vignetteLevel(5, 0, true) === 0, 'standing / walking pace: no vignette');
  const a = X.vignetteLevel(12, 0, false);
  const b = X.vignetteLevel(18, 0, false);
  const c = X.vignetteLevel(30, 0, false);
  ok(a > 0 && b > a && c === 1, 'level rises with speed and saturates');
  ok(X.vignetteLevel(14, 0, true) > X.vignetteLevel(14, 0, false), 'being on the rope reads stronger');
  ok(X.vignetteLevel(0, 1, false) > 0.5 && X.vignetteLevel(0, 1, false) < 1, 'turning alone gives a partial vignette');
  const out = {};
  X.vignetteShape(0, out);
  ok(out.opacity === 0 && out.hole === X.VIG.holeOpen, 'zero intensity: invisible, hole wide open');
  X.vignetteShape(1, out);
  ok(near(out.hole, X.VIG.holeMin, 1e-6) && near(out.opacity, X.VIG.maxOpacity, 1e-6), 'full intensity: narrow hole, strong dark edge');
  // closes fast, opens slow
  let lv = 0;
  for (let i = 0; i < 20; i++) lv = X.followLevel(lv, 1, 1 / 72);
  const closed = lv;
  for (let i = 0; i < 20; i++) lv = X.followLevel(lv, 0, 1 / 72);
  ok(closed > 0.8 && lv > 0.35 && lv < closed - 0.2, 'rises quickly, releases slowly (no pop)');
}

// ---- display helpers ------------------------------------------------------------------------------------------------------
{
  ok(near(X.xrScaleFor('auto', 1, 'quest'), 1.0) && near(X.xrScaleFor('high', 1, 'quest'), 1.2) && near(X.xrScaleFor('low', 0.8, 'quest'), 0.8), 'tier x render scale -> XR framebuffer scale');
  ok(X.xrScaleFor('auto', 5, 'high') <= 1.5, 'XR scale is capped');
  ok(X.blackLift(0) === 0 && near(X.blackLift(1), 6 / 255), 'black level lifts up to 6/255');
  ok(X.exposureMul(9) === C.UX_LIMITS.brightness[1] && X.exposureMul('x') === 1, 'brightness clamps');
  ok(X.textScaleOf({ textScale: 1.25 }) === 1.25 && X.textScaleOf({}) === 1 && X.textScaleOf({ textScale: 7 }) === 1.5, 'text scale accessor');
  ok(near(X.hapticIntensity(0.5, { hapticStrength: 1.5 }), 0.75) && X.hapticIntensity(0.9, { hapticStrength: 1.5 }) === 1 && X.hapticIntensity(0.5, {}) === 0.5, 'haptic strength scales and clamps');
}

// ---- captions mapping -------------------------------------------------------------------------------------------------------
{
  const R = CAP.RULES;
  const m = CAP.captionForEvent;
  ok(m('creature:clip', { name: 'rear_windup', event: 'start' }) === R.windup, 'rear_windup start -> wind-up caption');
  ok(m('creature:clip', { name: 'rear_windup', event: 'begin' }) === R.windup, "'begin' is 'start'");
  ok(m('creature:clip', { name: 'rear_windup' }) === R.windup, 'a clip event without an event name counts as start');
  ok(m('creature:clip', { name: 'rear_windup', event: 'full' }) === null, 'sub-events that only add detail are not captioned');
  ok(m('creature:clip', { name: 'strike', event: 'contact' }) === R.strikeHit && m('creature:clip', { name: 'knock_x3', event: 'knock' }) === R.knock, 'strike contact / knocks');
  ok(m('creature:clip', { name: 'portal_snap', event: 'clap' }) === R.portal && m('creature:clip', { name: 'roar_display', event: 'start' }) === R.roar, 'portal clap / roar');
  ok(m('creature:clip', { name: 'crown_idle', event: 'start' }) === null, 'idle loops are silent');
  ok(m('creature:attack', { gate: true }) === null && m('creature:attack', {}) === R.lunge, 'gate slam is not a lunge');
  ok(m('creature:strike', { hit: true }) === R.strikeHit && m('creature:strike', { hit: false }) === R.strikeMiss, 'strike hit / miss');
  ok(m('creature:call', { distance: 12 }) === R.callNear && m('creature:call', { distance: 60 }) === R.callFar && m('creature:call', {}) === R.callFar, 'call near / far');
  ok(m('creature:step', { intensity: 0.2, distance: 10 }) === null && m('creature:step', { intensity: 0.8, distance: 10 }) === R.steps && m('creature:step', { intensity: 0.8, distance: 90 }) === null, 'steps only when loud and near');
  ok(m('rope:slip', { intensity: 0.1 }) === null && m('rope:slip', { intensity: 0.8 }) === R.slip, 'rope slip threshold');
  ok(m('rope:jolt', { speed: 3 }) === null && m('rope:jolt', { speed: 12 }) === R.jolt, 'rope jolt threshold');
  ok(m('climb:strain', { level: 0 }) === null && m('climb:strain', { level: 2 }) === R.gripWeak && m('grapple:break', {}) === R.anchorBreak && m('platform:crumble', {}) === R.crumble, 'grip / anchor / crumble');
  ok(m('trigger:rumble', {}) === R.rumble && m('trigger:debris', {}) === R.debris && m('nothing', {}) === null, 'level triggers; unknown events are ignored');
  for (const k of Object.keys(R)) ok(/^\[.+\]$/.test(R[k].text) && R[k].text.length < 40, `caption ${k} is a short bracketed description`);
  ok(CAP.statusForEvent('health:low', {}) === CAP.STATUS_RULES.lowHealth && CAP.statusForEvent('health:damage', { cause: 'hazard' }) === CAP.STATUS_RULES.hazard && CAP.statusForEvent('health:damage', { cause: 'fall' }) === null, 'status cues: low health, hazard hit');
  ok(CAP.statusForEvent('pickup:collect', { kind: 1 }).text === '+ BANDAGE' && CAP.statusForEvent('pickup:collect', { kind: 9 }) === null, 'status cue for a pickup names the item');
}

// ---- caption directions + tracker --------------------------------------------------------------------------------------------
{
  const yaw0 = 0; // facing -Z
  ok(CAP.sectorOf(0, 0, yaw0, 0, -10) === 0, 'straight ahead (-Z) is sector 0');
  ok(CAP.sectorOf(0, 0, yaw0, 10, 0) === 2 && CAP.sectorOf(0, 0, yaw0, -10, 0) === 6, 'right is 2, left is 6');
  ok(CAP.sectorOf(0, 0, yaw0, 0, 10) === 4, 'behind is 4');
  ok(CAP.sectorOf(0, 0, yaw0, 10, -10) === 1 && CAP.sectorOf(0, 0, yaw0, -10, 10) === 5, 'diagonals');
  ok(CAP.sectorOf(0, 0, Math.PI / 2, -10, 0) === 0, 'turning the head left by 90 degrees: -X is ahead'); // forward = (-sin, -cos) = (-1, 0)
  ok(CAP.sectorOf(0, 0, 0, 0.2, 0.2) === -1, 'on top of the head: no direction');

  let on = true;
  const t = new CAP.CaptionTracker({ captions: () => on, status: () => false });
  const slots = t.lines.slice();
  const head = { x: 0, y: 0, z: 0, yaw: 0, ok: true };
  t.push('creature:clip', { name: 'rear_windup', event: 'start', x: 10, y: 0, z: 0 });
  t.update(0.2, head);
  const l0 = t.lines.find((l) => l.on);
  ok(l0 && l0.text === CAP.RULES.windup.text && l0.sector === 2 && l0.vert === 0 && l0.kind === 'creature', 'a clip becomes a line pointing right');
  // the sim event for the same moment collapses into the same group (no double caption)
  t.push('creature:attack', { x: 10, y: 0, z: 0 });
  ok(t.lines.filter((l) => l.on).length === 1, 'clip + sim attack within the group window show once');
  // above / below
  t.push('creature:call', { x: 0, y: 30, z: -40, distance: 50 });
  t.update(0.2, head);
  const call = t.lines.find((l) => l.on && l.group === 'call');
  ok(call && call.vert === 1 && call.sector === 0, 'a sound far above is marked as above');
  // capacity: three lines, the newest replace the oldest least-severe
  t.clock += 10;
  t.push('creature:sighting', {});
  t.push('platform:crumble', { x: 0, y: 0, z: 5 });
  t.push('creature:retreat', {});
  ok(t.lines.filter((l) => l.on).length <= 3, 'never more than three lines');
  ok(t.lines.every((l, i) => l === slots[i]), 'slots are reused (no allocation)');
  // expiry
  const rev = t.rev;
  t.update(10, head);
  ok(t.lines.every((l) => !l.on) && t.rev > rev, 'lines expire and the revision changes');
  // disabled: nothing recorded
  on = false;
  t.push('creature:attack', {});
  ok(t.lines.every((l) => !l.on), 'captions off: nothing is captured');
  on = true;
  t.clear();
  // status cues need colorSafe
  let safe = false;
  const t2 = new CAP.CaptionTracker({ captions: () => false, status: () => safe });
  t2.push('health:low', {});
  ok(t2.lines.every((l) => !l.on), 'status cues are off without colour-safe');
  safe = true;
  t2.push('health:low', {});
  const sl = t2.lines.find((l) => l.on);
  ok(sl && sl.kind === 'status' && sl.text === 'LOW HEALTH' && CAP.KIND_SHAPE[sl.kind] === 'triangle', 'colour-safe: a triangle + words for low health');
  // bus wiring
  const bus = new C.EventBus();
  const t3 = new CAP.CaptionTracker();
  t3.attach(bus);
  bus.emit('creature:clip', { name: 'knock_x3', event: 'knock', x: 0, y: 0, z: -8 });
  ok(t3.lines.some((l) => l.on && l.text === CAP.RULES.knock.text), 'bus events reach the tracker');
  t3.detach();
  bus.emit('creature:attack', {});
  ok(t3.lines.filter((l) => l.on).length === 1, 'detached tracker stops listening');
}

// ---- tutorial ----------------------------------------------------------------------------------------------------------------------
{
  mem.delete('abyssalTether3d.v1.tutorial');
  const bus = new C.EventBus();
  const shown = [];
  const ui = { current: null, _hint: { on: false, tutorial: false }, showHint: (h, sec) => { shown.push(h.text); ui._hint.on = true; ui._hint.tutorial = true; void sec; }, hideHint: () => { ui._hint.on = false; } };
  const game = {
    bus,
    settings: { tutorialHints: true },
    state: 'playing',
    player: { alive: true, vx: 0, vy: 0, vz: 0 },
    victoryT: -1,
    time: 0,
    sectionIndex: 0,
    tethers: { attached: false },
    physics: { climb: { holding: false, hands: { left: { hover: false, hoverIn: false }, right: { hover: false, hoverIn: false } } } },
    intent: { reel: 0 },
    health: { hp: 1 },
    bag: { counts: [0, 0, 0, 0] },
  };
  const tut = new TUT.Tutorial(game, ui);
  tut.attach();
  const run = (sec, dt = 0.1) => {
    for (let i = 0; i < Math.round(sec / dt); i++) {
      game.time += dt;
      tut.update(dt);
    }
  };
  bus.emit('game:start', {});
  run(10);
  ok(shown.length === 0, 'nothing in the first seconds (the level teaches the trigger)');
  run(12);
  ok(shown.length === 1 && /Trigger/.test(shown[0]), 'no tether fired after ~14 s: the fire hint appears');
  ui._hint.on = false;
  run(10);
  ok(shown.length === 1, 'hints are at least 25 s apart');
  // learning persists
  bus.emit('grapple:attach', {});
  ok(tut.data.done.fire === true, 'attaching teaches the trigger');
  const saved = JSON.parse(mem.get('abyssalTether3d.v1.tutorial'));
  ok(saved.done.fire === true, 'learning is persisted');
  const tut2 = new TUT.Tutorial(game, ui);
  ok(tut2.data.done.fire === true, 'and survives a restart');
  // grip hint when hovering a hold, once; learned on grab
  run(30);
  game.physics.climb.hands.left.hoverIn = true;
  run(1.5);
  ok(shown.some((t) => /Grip/.test(t)), 'hovering a hold shows the grip hint');
  ui._hint.on = false;
  game.physics.climb.hands.left.hoverIn = false;
  bus.emit('climb:grab', { hand: 'left' });
  ok(tut.data.done.grip === true, 'grabbing teaches the grip');
  // reel hint after hanging 2.5 s, and silent when the player reels
  run(30);
  game.tethers.attached = true;
  run(3);
  ok(shown.some((t) => /Right stick/.test(t)), 'hanging without reeling shows the reel hint');
  ui._hint.on = false;
  game.intent.reel = 0.8;
  run(0.5);
  ok(tut.data.done.reel === true, 'reeling teaches it');
  game.intent.reel = 0;
  game.tethers.attached = false;
  // bag after a pickup
  run(30);
  bus.emit('pickup:collect', { kind: 1 });
  run(2.5);
  ok(shown.some((t) => /hip/.test(t)), 'a pickup brings the bag hint');
  ok(tut.data.shown.bag === 1, 'the show count is tracked');
  // never over a menu / a level hint / when disabled / fast
  const before = shown.length;
  tut.data.done = {};
  tut.data.shown = {};
  ui.current = 'pause';
  game.tethers.attached = true;
  run(40);
  ok(shown.length === before, 'no hint over a menu');
  ui.current = null;
  ui._hint.on = true;
  run(40);
  ok(shown.length === before, 'no hint over a level hint');
  ui._hint.on = false;
  game.settings.tutorialHints = false;
  run(40);
  ok(shown.length === before, 'settings.tutorialHints = false silences everything');
  game.settings.tutorialHints = true;
  game.player.vx = 20;
  run(40);
  ok(shown.length === before, 'no hint mid-swing');
  game.player.vx = 0;
  tut.data.shown = { reel: 2, fire: 2, grip: 2, bag: 2 };
  game.time = 100;
  run(60);
  ok(shown.length === before, 'a step shown twice is not shown again');
  tut.reset();
  ok(Object.keys(tut.data.done).length === 0, 'reset forgets everything');
  tut.detach();
}

await sleep(20);
console.log(`ux unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
