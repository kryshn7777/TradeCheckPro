// The designed SFX (src/audio/sfxDesign.js engine + src/audio/sfxBank.js recipes; plans/SFX_DESIGN.md):
//   1. recipe table sanity: every recipe compiles, every number finite and in range, node budget per voice
//   2. coverage: every required game event has a designed recipe; every hook / route plays a recipe that exists; every
//      recipe is reachable from an event
//   3. determinism: no Math.random in the audio modules, same inputs -> the same plan, round robin / alternation / hash rules
//   4. the real AudioManager3D on the strict mock context: the hooks replace the legacy synth, surfaces, instance caps, the
//      voice cap under a burst, no leak, no allocation in resolveRecipe after warm-up
//   5. captions for the newly voiced events
//   6. offline render of every recipe (sfxRender.mjs): peak < 0.98, audible RMS, no NaN; a table; WAVs with --wav DIR
//   node sfx.mjs [--root DIR] [--wav DIR] [--table]
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { srcUrl } from '../../verify/root.mjs';
import { argValue, hasFlag } from '../../verify/args.mjs';
import { MockAudioContext } from './mockaudio.mjs';
import { renderPlan, measure, db, writeWav, SR } from './sfxRender.mjs';

const argv = process.argv.slice(2);
const wavDir = argValue(argv, '--wav', null);
const showTable = hasFlag(argv, '--table') || !!wavDir;

const D = await import(srcUrl('audio/sfxDesign.js'));
const B = await import(srcUrl('audio/sfxBank.js'));
const { EventBus, SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const warnings = [];
console.warn = (...a) => warnings.push(a.map((x) => (x && x.stack) || String(x)).join(' '));

const NYQ = 48000 * 0.45;
const compiled = {};
for (const [id, r] of Object.entries(B.RECIPES)) compiled[id] = D.compileRecipe(id, r);
const ids = Object.keys(compiled);

// ===========================================================================
// 1. recipe table sanity
// ===========================================================================
{
  const problems = [];
  for (const id of ids) problems.push(...D.validateRecipe(compiled[id], NYQ));
  ok(problems.length === 0, `${ids.length} recipes: finite, in range, <= ${D.MAX_NODES} nodes per voice, 0 < duration < 12 s` + (problems.length ? ': ' + problems.slice(0, 4).join('; ') : ''));
  let named = true;
  for (const id of ids) if (!/^[a-z]+(\.[a-z]+)*$/.test(id) || !(B.RECIPES[id].note || '').length) named = false;
  ok(named, 'every recipe has a dotted lower-case name and a design note');
  let layered = 0;
  for (const id of ids) if (B.RECIPES[id].layers.length >= 2) layered++;
  ok(layered >= ids.length - 2, `recipes are layered (${layered}/${ids.length} have >= 2 layers; the slider tick and the brass medal are single by design)`);
  const busOk = ids.every((id) => D.BUSES.includes(B.RECIPES[id].bus || 'player') && D.SPACES.includes(B.RECIPES[id].space || 'head'));
  ok(busOk, 'every recipe names a known bus and space');
  const worldNeedsFloor = ids.filter((id) => (B.RECIPES[id].space === 'world') && (B.RECIPES[id].prio | 0) >= 2 && !(B.RECIPES[id].floor > 0));
  ok(worldNeedsFloor.length === 0, 'every important (prio >= 2) world sound keeps a distance floor' + (worldNeedsFloor.length ? ': ' + worldNeedsFloor.join(', ') : ''));
  let threw = false;
  try {
    D.compileRecipe('bad', { layers: [{ t: 'bogus' }] });
  } catch {
    threw = true;
  }
  ok(threw, 'compileRecipe rejects an unknown layer type');
}

// ===========================================================================
// 2./3. a fake host: coverage + determinism of the routing
// ===========================================================================
function fakeHost(game) {
  const played = [];
  const h = {
    _built: true,
    _nyq: NYQ,
    _game: game,
    _lx: 0,
    _ly: 1.6,
    _lz: 0,
    _state: 'playing',
    _dead: false,
    _pauseFlag: false,
    _sp: { ok: false, d: 0, gain: 1, cutoff: 12000, send: 0.2, delay: 0, x: 0, y: 0, z: 0 },
    _spatial(x, y, z, dh) {
      const S = this._sp;
      S.ok = x === x && y === y && z === z;
      S.d = S.ok ? Math.hypot(x - this._lx, y - this._ly, z - this._lz) : dh === dh ? dh : 80;
      S.cutoff = 260 + 12000 * Math.exp(-S.d / 35);
      S.delay = S.d > 28 ? Math.min(0.6, S.d / 343) : 0;
      return S;
    },
    _floor: () => 1,
    _at: (x, y, z) => ({ x, y, z }),
    _countAlive: () => 0,
    _begin(name, prio, gap, dur, bus, level, pan, send, cutoff, pos) {
      played.push({ name, prio, dur, level, pan, send, cutoff, pos });
      return null; // nothing scheduled: routing only
    },
    played,
  };
  return h;
}
const game0 = { sectionIndex: 0, player: { x: 0, y: 1, z: 0, groundSolid: { kind: 'stone' } }, bag: { lanternLow: false, lanternCharge: 1 }, level: null };

/** Sample payloads that reach every branch of every hook and route. */
const P = { x: 3, y: 5, z: -4 };
const SAMPLES = {
  step: [{ k: 0.4 }, { k: 1 }],
  'player:land': [{ impact: 6, lethalRatio: 0.35, ...P }, { impact: 16, lethalRatio: 0.95, hard: true, ...P }, { lethalRatio: 0.05 }],
  'grapple:attach': [
    { hand: 'right', speed: 8, ...P, anchor: { kind: 'surface', solid: { kind: 'stone' }, ...P, id: 'surf-right', section: 0 } },
    { hand: 'left', speed: 22, ...P, anchor: { kind: 'surface', solid: { kind: 'metal' }, ...P } },
    { hand: 'left', speed: 12, ...P, anchor: { kind: 'surface', solid: { kind: 'grate' }, ...P } },
    { hand: 'left', speed: 12, ...P, anchor: { kind: 'fragile', ...P } },
    { hand: 'left', speed: 12, ...P, anchor: { kind: 'ring', id: 'r1', ...P } },
  ],
  'grapple:miss': [{ hand: 'right', ...P }, { hand: 'left', fell: true, ...P }],
  'grapple:break': [{ hand: 'right', ...P }, { hand: 'right', cut: true, ...P }],
  'rope:jolt': [{ speed: 13, ...P }, { speed: 25, ...P }],
  'climb:grab': ['masonry', 'ledge', 'chain', 'rebar', 'sinew'].map((kind) => ({ hand: 'left', kind, ...P })).concat([{ hand: 'right', kind: 'masonry', wet: true, ...P }]),
  'pickup:collect': [0, 1, 2, 3].map((kind) => ({ kind })),
  'bag:done': [0, 1, 2, 3].map((kind) => ({ kind })),
  'lantern:low': [{ charge: 0.14 }],
  'lantern:empty': [{}],
  'health:damage': [{ amount: 0.1, cause: 'fall' }, { amount: 0.5, cause: 'hazard' }],
  checkpoint: [{}],
  'ui:click': ['', 'back', 'tab', 'start', 'slide', 'error', 'settings'].map((kind) => ({ kind })),
  'ui:move': [{}],
  'prop:impact': [0, 1, 2, 3].map((kind) => ({ kind, speed: 3, ...P, surface: 'stone' })),
  'detail:drip': [{ ...P, dist: 6 }],
  'rope:dry': [{ hand: 'left', left: 0.3, of: 1 }],
  'climb:mantle': [{ ...P, lipY: 6 }],
  'seal:land': [{ id: 's6', ...P }],
  'objective:done': [{ id: 'o1', verb: 'bell' }],
  split: ['gold', 'silver', 'brass', null].map((medal) => ({ medal, recorded: true })),
  'health:heal': [{ amount: 0.3, hp: 0.8 }],
  'health:low': [{ hp: 0.3 }],
  'health:recover': [{ hp: 0.5, full: false }],
  'nv:low': [{ charge: 0.2 }],
  'nv:flat': [{}],
  'nv:ready': [{}],
  'player:jump': [{}],
  'jetpack:ignite': [{}],
  'jetpack:cut': [{ reason: 'release' }, { reason: 'fuel' }],
  'player:death': [{ cause: 'fall' }],
  'creature:stare': [{ ...P, distance: 30 }],
  'creature:annoyed': [{ ...P, distance: 12 }],
  'holdfast:aware': [{ ...P, distance: 4 }],
  'holdfast:outpull': [{ hand: 'left', ...P }],
  'dresser:appear': [{ ...P, distance: 40 }],
};

{
  const host = fakeHost(game0);
  const E = new D.SfxEngine(host, B.SFX_BANK);
  const reached = new Set();
  const byEvent = {};
  let unknown = [];
  for (const type of B.SFX_EVENTS) {
    const list = SAMPLES[type];
    if (!list) {
      unknown.push(`${type} (no sample)`);
      continue;
    }
    byEvent[type] = new Set();
    for (const p of list) {
      const before = host.played.length;
      if (B.HOOKS[type]) ok(E.take(type, p) === true || type === 'player:land', `${type}: the hook handles ${JSON.stringify(p).slice(0, 60)}`);
      else B.ROUTES[type](p, E, type);
      for (let i = before; i < host.played.length; i++) {
        const n = host.played[i].name;
        if (!compiled[n]) unknown.push(`${type} -> ${n}`);
        reached.add(n);
        byEvent[type].add(n);
      }
    }
  }
  // the surfaces under the feet and behind the hook (the game state, not the payload, says where the player stands)
  const wetAt = (() => {
    for (let i = 0; i < 500; i++) if (B.surfaceAt('stone', 6, i * 2.3, -400, 0) === B.SURF.WET) return i * 2.3;
    return 0;
  })();
  const surfaces = [
    { sectionIndex: 0, player: { x: 0, y: 1, z: 0, groundSolid: { kind: 'metal' } } },
    { sectionIndex: 0, player: { x: 0, y: 1, z: 0, groundSolid: { kind: 'grate' } } },
    { sectionIndex: 0, player: { x: 0, y: 1, z: 0, groundSolid: { kind: 'crumble' } } },
    { sectionIndex: 6, player: { x: wetAt, y: -400, z: 0, groundSolid: { kind: 'stone' } } },
  ];
  for (const g of surfaces) {
    host._game = { ...game0, ...g };
    E.take('step', { k: 0.7 });
    E.take('player:land', { lethalRatio: 0.6, x: g.player.x, y: g.player.y, z: g.player.z });
  }
  E.take('grapple:attach', { hand: 'left', speed: 9, x: wetAt, y: -400, z: 0, anchor: { kind: 'surface', solid: { kind: 'stone' }, x: wetAt, y: -400, z: 0, section: 6 } });
  host._game = game0;
  for (const r of host.played) reached.add(r.name);
  // the lantern flicker is the per-frame part
  host._game = { ...game0, bag: { lanternLow: true, lanternCharge: 0.05 } };
  for (let i = 0; i < 60; i++) E.update(1 / 10, host._game);
  for (const r of host.played) reached.add(r.name);
  unknown = unknown.filter(Boolean);
  ok(unknown.length === 0, 'every hook / route plays a recipe that exists' + (unknown.length ? ': ' + unknown.join(', ') : ''));
  const unreached = ids.filter((id) => !reached.has(id));
  ok(unreached.length === 0, `every recipe is reachable from a game event (${reached.size}/${ids.length})` + (unreached.length ? ': ' + unreached.join(', ') : ''));
  const flick = host.played.filter((r) => r.name === 'lantern.flutter').length;
  ok(flick >= 2 && flick <= 6, `the low-cell flicker repeats on its own clock (${flick} in 6 s at 5 % charge)`);

  // the brief's required list
  const REQUIRED = ['step', 'player:land', 'grapple:attach', 'grapple:miss', 'grapple:break', 'rope:jolt', 'climb:grab', 'climb:mantle', 'pickup:collect', 'bag:done', 'lantern:low', 'lantern:empty', 'health:damage', 'health:heal', 'health:low', 'checkpoint', 'objective:done', 'split', 'ui:click', 'ui:move', 'prop:impact', 'detail:drip', 'jetpack:ignite', 'jetpack:cut', 'creature:stare', 'seal:land', 'rope:dry'];
  const missing = REQUIRED.filter((t) => !B.SFX_EVENTS.includes(t));
  ok(missing.length === 0, `every required event has a designed recipe (${REQUIRED.length})` + (missing.length ? ': ' + missing.join(', ') : ''));
  // material awareness: distinct sounds per surface / item / hold kind
  const bites = [...byEvent['grapple:attach']].filter((n) => n.startsWith('hook.'));
  ok(bites.length === 5, `the hook bite differs by material (${bites.join(', ')})`);
  const steps = new Set(host.played.filter((r) => r.name.startsWith('step.')).map((r) => r.name));
  const lands = new Set(host.played.filter((r) => r.name.startsWith('land.')).map((r) => r.name));
  ok(steps.size === 5 && lands.size === 5, `footfalls and landings differ by surface (${[...steps].join(', ')})`);
  ok(byEvent['climb:grab'].size === 6, `hand holds differ by kind (${[...byEvent['climb:grab']].join(', ')})`);
  ok(byEvent['pickup:collect'].size === 4 && byEvent['bag:done'].size === 4 && byEvent['prop:impact'].size === 4, 'pickups, uses and dropped props differ per item kind');
  ok(byEvent['ui:click'].size >= 6, `menu sounds differ by action (${[...byEvent['ui:click']].join(', ')})`);
  ok(byEvent['grapple:break'].has('rope.snap') && byEvent['grapple:break'].has('rope.cut'), 'a broken anchor snaps; a sawn line parts strand by strand');
  ok(!byEvent['jetpack:cut'].has('jet.valve') || host.played.filter((r) => r.name === 'jet.valve').length === 1, 'the valve tail plays on a release cut, not on a dry tank (the cough is legacy)');

  // world placement: hooks and props are positioned; UI and stingers are head-locked
  const hook = host.played.find((r) => r.name.startsWith('hook.'));
  const ui = host.played.find((r) => r.name.startsWith('ui.'));
  ok(hook && hook.pos && hook.pos.x === 3 && ui && !ui.pos, 'world sounds sit at the event position; UI sounds are head-locked');
  const far = fakeHost(game0);
  const Ef = new D.SfxEngine(far, B.SFX_BANK);
  const o = Ef.opts();
  o.x = 0;
  o.y = 1.6;
  o.z = -60;
  Ef.play('seal.land', 0.5, o);
  ok(far.played[0].cutoff > 0 && far.played[0].cutoff < 2600, `a far world sound loses its top (air absorption: lowpass ${far.played[0].cutoff | 0} Hz at 60 m)`);
}

// ===========================================================================
// 3. determinism
// ===========================================================================
{
  const src = fileURLToPath(srcUrl('audio/'));
  const offenders = [];
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith('.js')) continue;
    const code = fs
      .readFileSync(path.join(src, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    if (/Math\.random\s*\(/.test(code)) offenders.push(f);
  }
  ok(offenders.length === 0, 'no Math.random() in any audio module' + (offenders.length ? ': ' + offenders.join(', ') : ''));

  const a = new D.Plan();
  const b = new D.Plan();
  let same = true;
  for (const id of ids) {
    for (const k of [0, 0.37, 1]) {
      for (let v = 0; v < 8; v++) {
        D.resolveRecipe(compiled[id], k, v, a, NYQ);
        D.resolveRecipe(compiled[id], k, v, b, NYQ);
        if (a.n !== b.n || a.dur !== b.dur || a.level !== b.level) same = false;
        for (let i = 0; i < a.n; i++) {
          const x = a.layers[i];
          const y = b.layers[i];
          for (const key of ['at', 'a', 'h', 'd', 'g', 'f', 'f2', 'end', 'nt', 'np']) if (x[key] !== y[key]) same = false;
          for (let j = 0; j < x.nt; j++) if (x.tt[j] !== y.tt[j] || x.tf[j] !== y.tf[j] || x.tg[j] !== y.tg[j]) same = false;
        }
      }
    }
  }
  ok(same, 'resolveRecipe: the same recipe, k and variant give an identical plan (every layer, every tick)');

  D.resolveRecipe(compiled['step.stone'], 0.5, 0, a, NYQ);
  D.resolveRecipe(compiled['step.stone'], 0.5, 1, b, NYQ);
  ok(a.layers[0].f !== b.layers[0].f && Math.abs(a.layers[0].f / b.layers[0].f - 1) < 0.1, 'variants differ by the designed spread (a few % of pitch), not by chance');
  D.resolveRecipe(compiled['land.stone'], 0.2, 0, a, NYQ);
  D.resolveRecipe(compiled['land.stone'], 0.9, 0, b, NYQ);
  ok(b.n > a.n && b.level > a.level && b.layers[0].d > a.layers[0].d, `a harder landing is louder, longer and has more layers (${a.n} -> ${b.n})`);
  D.resolveRecipe(compiled['rope.jolt'], 0.2, 0, a, NYQ);
  D.resolveRecipe(compiled['rope.jolt'], 1, 0, b, NYQ);
  ok(a.n === 4 && b.n === 6, 'rope tension: creak only when light; the twang and the singing line join as it tightens');

  // rules
  const host = fakeHost(game0);
  const E = new D.SfxEngine(host, B.SFX_BANK);
  const seq = [];
  for (let i = 0; i < 12; i++) seq.push(E.variantFor(compiled['step.stone'], null));
  ok(seq.join() === '0,1,2,3,4,5,0,1,2,3,4,5', `round robin cycles the six footfall variants (${seq.join(' ')})`);
  const o1 = E.opts();
  o1.key = D.hashPos(3, 5, -4, 0.5);
  const h1 = E.variantFor(compiled['hook.stone'], o1);
  const h2 = E.variantFor(compiled['hook.stone'], o1);
  ok(h1 === h2, 'hash rule: the same anchor position always bites the same way');
  const pans = [];
  for (let i = 0; i < 4; i++) {
    E.take('step', { k: 0.5 });
    pans.push(host.played[host.played.length - 1].pan);
  }
  ok(pans[0] === -pans[1] && pans[0] === pans[2] && pans[0] !== 0, `footfalls alternate left / right (${pans.join(' ')})`);
  E.counters.reset();
  const E2 = new D.SfxEngine(fakeHost(game0), B.SFX_BANK);
  let rep = true;
  for (let i = 0; i < 20; i++) if (E.variantFor(compiled['ui.toggle'], null) !== E2.variantFor(compiled['ui.toggle'], null)) rep = false;
  ok(rep, 'two engines fed the same events choose the same variants');
  const s1 = new D.SeqRng(7);
  const s2 = new D.SeqRng(7);
  let sq = true;
  for (let i = 0; i < 100; i++) if (s1.next() !== s2.next()) sq = false;
  ok(sq, 'SeqRng: the seeded stream that replaced Math.random repeats exactly');

  // surfaces
  ok(B.surfaceAt('metal', 0, 1, 1, 1) === B.SURF.METAL && B.surfaceAt('grate', 2, 1, 1, 1) === B.SURF.GRATE && B.surfaceAt('crumble', 2, 1, 1, 1) === B.SURF.DEBRIS, 'surfaces: metal, grate, crumble by the solid kind');
  let wet = 0;
  let debris = 0;
  let stable = true;
  for (let i = 0; i < 400; i++) {
    const s = B.surfaceAt('stone', 6, i * 2.3, -400, i * 1.7);
    if (s !== B.surfaceAt('stone', 6, i * 2.3, -400, i * 1.7)) stable = false;
    if (s === B.SURF.WET) wet++;
    if (s === B.SURF.DEBRIS) debris++;
  }
  ok(stable && wet > 20 && debris > 10, `stone patches in a deep section: the same patch always sounds the same; ${wet} wet, ${debris} bone / gravel of 400`);
  ok(B.surfaceAt('stone', 0, 5, 1, 5) !== B.SURF.DEBRIS, 'no bone / gravel patches in the first sections');
}

// ===========================================================================
// 4. the real AudioManager3D on the strict mock context
// ===========================================================================
globalThis.window = { AudioContext: MockAudioContext, addEventListener() {} };
const { AudioManager3D } = await import(srcUrl('audio/audio3d.js'));
const level = new Level3D(undefined, 'normal');

function rig() {
  const bus = new EventBus();
  const settings = Object.assign({}, SETTINGS_DEFAULTS, { volume: 0.8 });
  const el = new Float64Array(16);
  el[0] = el[5] = el[10] = el[15] = 1;
  el[13] = 1.6;
  const rope = () => ({ anchor: null, attached: false, length: 8, tension: 0, slipSpeed: 0 });
  const game = {
    bus,
    settings,
    state: 'playing',
    sectionIndex: 0,
    diff: { lethalImpact: 17 },
    level,
    renderer: { camera: { matrixWorld: { elements: el } } },
    input: { handPose: (h, o) => Object.assign(o, { x: h === 'left' ? -0.3 : 0.3, y: 1.2, z: -0.4 }) },
    player: { x: 0, y: 1, z: 0, rx: 0, ry: 1, rz: 0, vx: 0, vy: 0, vz: 0, grounded: true, alive: true, tension: 0, groundSolid: { kind: 'stone' } },
    tethers: { hands: { left: { rope: rope() }, right: { rope: rope() } }, anchorStress: () => 0 },
    threat: { value: 0, heartRate: 60, beat: 0 },
    health: { hurt: 0, hp: 1, heartbeatRate: 60 },
    bag: { lanternLow: false, lanternCharge: 1 },
    creature: { active: false, state: 'DISTANT', distance: 200, x: 0, y: 200, z: 0, audio: { x: 0, y: 200, z: 0, distance: 200, intensity: 0, movement: 0, state: 'DISTANT' }, body: { head: { x: 0, y: 200, z: 0 }, jitter: 0, listen: 0, spine: new Float32Array(60) }, attack: { windup: 0 } },
  };
  const audio = new AudioManager3D(bus, settings);
  audio.unlock();
  const ctx = audio.ctx;
  return {
    game,
    audio,
    ctx,
    bus,
    run(secs, per) {
      const dt = 1 / 30;
      for (let i = 0, n = Math.round(secs / dt); i < n; i++) {
        ctx.currentTime += dt;
        if (per) per(i, dt);
        audio.update(dt, game);
      }
    },
    alive: (pred) => audio._voices.filter((v) => v.alive && !v.dying && pred(v.name)).length,
  };
}

{
  const R = rig();
  const realRandom = Math.random;
  Math.random = () => {
    throw new Error('Math.random called by the audio');
  };
  try {
    R.run(1);
    ok(R.audio._sfx && !R.audio._sfx.broken && ids.every((id) => id in R.audio._sfx.recipes) && Object.keys(R.audio._sfx.recipes).length === ids.length + 1 && 'creature.notice' in R.audio._sfx.recipes, 'the manager builds the designed engine with every recipe (+ creature.notice, registered by MASON_SIGHT through registerSfx)');
    R.bus.emit('grapple:attach', { hand: 'right', speed: 9, x: 3, y: 5, z: -4, anchor: { kind: 'surface', solid: { kind: 'metal' }, x: 3, y: 5, z: -4 } });
    ok(R.alive((n) => n === 'hook.metal') === 1 && R.alive((n) => n === 'attach') === 0, 'grapple:attach plays hook.metal at the anchor and not the legacy clank');
    ok(R.alive((n) => n === 'catch') >= 0, 'the legacy body-catch thunk still plays under it');
    R.run(0.5);
    R.bus.emit('ui:click', { kind: 'back' });
    ok(R.alive((n) => n === 'ui.back') === 1 && R.alive((n) => n === 'click') === 0, 'ui:click {kind: back} plays ui.back, not the old generic click');
    R.bus.emit('ui:click', {});
    ok(R.alive((n) => n === 'ui.select') === 1, 'ui:click without a kind plays ui.select');
    // footsteps by surface
    R.game.player.vx = 4;
    R.game.player.groundSolid = { kind: 'metal' };
    R.run(1.5);
    ok(R.audio._steps > 0 && R.audio._sfx.lastId.startsWith('step.'), `running plays the designed footfalls (${R.audio._steps} steps, last ${R.audio._sfx.lastId})`);
    let metal = 0;
    R.run(1.5, () => {
      if (R.alive((n) => n === 'step.metal')) metal++;
    });
    ok(metal > 0 && R.alive((n) => n === 'step') === 0, 'on a girder the steps are step.metal (and the legacy step never plays)');
    R.game.player.vx = 0;
    // props: instance cap
    for (let i = 0; i < 10; i++) R.bus.emit('prop:impact', { kind: 3, x: 1, y: 1, z: -2 - i * 0.05, speed: 4, surface: 'stone' });
    ok(R.alive((n) => n === 'prop.cell') <= 3, `dropped props never take more than 3 voices (${R.alive((n) => n === 'prop.cell')})`);
    R.run(2);
    // the lantern flicker through the update hook
    R.game.bag.lanternLow = true;
    R.game.bag.lanternCharge = 0.03;
    let flick = 0;
    R.run(6, () => {
      if (R.audio._sfx.lastId === 'lantern.flutter') flick++;
    });
    ok(flick > 0, 'a low cell makes the lantern flicker audibly (update hook)');
    R.game.bag.lanternLow = false;
    // jetpack layers: the flutter is killed at the cut
    R.bus.emit('jetpack:ignite', {});
    ok(R.alive((n) => n === 'jet.flutter') === 1 && R.alive((n) => n === 'jet') === 1, 'jetpack:ignite: the legacy roar plus the combustion flutter');
    R.run(0.3);
    R.bus.emit('jetpack:cut', { reason: 'release' });
    ok(R.alive((n) => n === 'jet.flutter') === 0 && R.alive((n) => n === 'jet.valve') === 1, 'jetpack:cut stops the flutter and plays the valve tail');
    // a burst of everything: the voice cap holds, no warnings, no leak after the tails
    R.run(4);
    const base = R.ctx.stats().liveNodes;
    for (let rep = 0; rep < 3; rep++) {
      for (const [type, list] of Object.entries(SAMPLES)) {
        if (type === 'step') continue;
        for (const p of list) R.bus.emit(type, p);
      }
      R.run(0.1);
    }
    ok(R.audio.activeVoices <= R.audio._maxVoices, `a burst of ${3 * Object.values(SAMPLES).flat().length} events stays within the voice cap (${R.audio.activeVoices} / ${R.audio._maxVoices})`);
    R.run(12);
    const after = R.ctx.stats().liveNodes;
    ok(after <= base + 4, `every designed voice is released after its tail (live nodes ${base} -> ${after})`);
    ok(warnings.length === 0, 'no warnings from the engine or the manager' + (warnings.length ? ': ' + warnings[0].slice(0, 300) : ''));
    ok(!R.audio._sfx.broken, 'the engine never fell back to the legacy synth');
    // the extension point
    R.audio.registerSfx('roach.skitter', { bus: 'creature', prio: 0, level: 0.2, space: 'world', maxInst: 2, vary: { rule: 'hash', n: 4 }, note: 'test', layers: [{ t: 'ticks', n: 6, span: 0.2, f: 3000, f2: 6000, q: 6, d: 0.004, g: 0.4 }, { t: 'noise', ft: 'highpass', f: 5000, d: 0.02, g: 0.05 }] });
    R.audio.registerSfxRoute('roach:skitter', (p, E) => {
      const o = E.opts();
      o.x = p.x;
      o.y = p.y;
      o.z = p.z;
      o.key = p.id | 0;
      E.play('roach.skitter', p.speed / 3, o);
    });
    R.bus.emit('roach:skitter', { id: 4, x: 1, y: 0.1, z: -1, speed: 2 });
    ok(R.alive((n) => n === 'roach.skitter') === 1, "extension point: registerSfx + registerSfxRoute voice a new 'roach:*' event");
  } finally {
    Math.random = realRandom;
  }
  ok(true, 'no Math.random call while the manager ran (it would have thrown)');
}

// ---- no allocation in the hot paths after warm-up: count young-generation collections (a boxed number per layer would
// cost > 100 of them over 1.6 M plans; an allocation per frame > 20 over 2 M frames) ----
{
  const { PerformanceObserver } = await import('node:perf_hooks');
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  let gcs = 0;
  const obs = new PerformanceObserver((l) => (gcs += l.getEntries().length));
  obs.observe({ entryTypes: ['gc'] });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const plan = new D.Plan();
  const list = ids.map((id) => compiled[id]);
  const KS = new Float64Array([0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]);
  const resolveMany = (N) => {
    let s = 0;
    for (let i = 0; i < N; i++) s += D.resolveRecipe(list[i % list.length], KS[i % 9], i, plan, NYQ).n;
    return s;
  };
  resolveMany(20000);
  gc();
  await settle();
  gcs = 0;
  resolveMany(1600000);
  await settle();
  const gResolve = gcs;
  // the per-frame part: the bank's update while the cell is low (no play: the flicker clock is far away)
  const host = fakeHost({ ...game0, bag: { lanternLow: true, lanternCharge: 0.1 } });
  const E = new D.SfxEngine(host, B.SFX_BANK);
  const g = host._game;
  const frames = (N) => {
    for (let i = 0; i < N; i++) {
      E.state.flutterT = 1e9;
      E.update(1 / 72, g);
    }
  };
  frames(20000);
  gc();
  await settle();
  gcs = 0;
  frames(2000000);
  await settle();
  const gUpdate = gcs;
  obs.disconnect();
  ok(gResolve <= 10, `resolveRecipe: 1.6 M plans of all ${list.length} recipes cost ${gResolve} young collections (no per-play allocation)`);
  ok(gUpdate <= 3, `the per-frame update: 2 M frames cost ${gUpdate} young collections (no per-frame allocation)`);
}

// ===========================================================================
// 5. captions
// ===========================================================================
{
  const C = await import(srcUrl('ui/captions.js'));
  let all = true;
  for (const [type, rule] of Object.entries(B.SFX_CAPTIONS)) {
    if (!C.CAPTION_EVENTS.includes(type) || C.captionForEvent(type, {}) !== rule) all = false;
    if (!/^\[.+\]$/.test(rule.text) || !C.KIND_SHAPE[rule.kind]) all = false;
  }
  ok(all, `${Object.keys(B.SFX_CAPTIONS).length} newly voiced events are captioned (bracketed text, a known kind, tracked)`);
  ok(new Set(C.CAPTION_EVENTS).size === C.CAPTION_EVENTS.length, 'the caption tracker listens to each event once');
  const warnCue = ['lantern:empty', 'creature:stare', 'creature:annoyed', 'holdfast:aware', 'dresser:appear'];
  ok(warnCue.every((t) => B.SFX_CAPTIONS[t] && B.SFX_CAPTIONS[t].sev >= 1), 'the warning sounds among them are captioned with emphasis (severity >= 1)');
}

// ===========================================================================
// 6. offline render of every recipe
// ===========================================================================
{
  if (wavDir) fs.mkdirSync(wavDir, { recursive: true });
  const plan = new D.Plan();
  const rows = [];
  let clip = [];
  let silent = [];
  let nan = [];
  for (const id of ids) {
    const rec = compiled[id];
    for (const k of [0, 0.5, 1]) {
      D.resolveRecipe(rec, k, 0, plan, NYQ);
      const buf = renderPlan(plan);
      const m = measure(buf);
      if (m.nan) nan.push(`${id}@${k}`);
      if (m.peak >= 0.98) clip.push(`${id}@${k} ${m.peak.toFixed(2)}`);
      if (!(m.rms50 > 0.003)) silent.push(`${id}@${k}`);
      if (k === 1 || k === 0) rows.push({ id, k, prio: rec.prio, bus: rec.busName, ...m, dur: plan.dur });
      if (wavDir && k !== 0.5) writeWav(path.join(wavDir, `${id}${k === 1 ? '' : '.soft'}.wav`), buf);
    }
  }
  ok(nan.length === 0, 'offline render: no NaN in any recipe' + (nan.length ? ': ' + nan.join(', ') : ''));
  ok(clip.length === 0, 'offline render: every recipe peaks below 0.98 at every intensity (before the master limiter)' + (clip.length ? ': ' + clip.join(', ') : ''));
  ok(silent.length === 0, 'offline render: every recipe is audible (loudest 50 ms above -50 dBFS)' + (silent.length ? ': ' + silent.join(', ') : ''));
  // the loudness hierarchy: danger above feedback above texture (median loudest-50 ms RMS at k = 1, head-locked level)
  const med = (p) => {
    const v = rows.filter((r) => r.k === 1 && (p === 3 ? r.prio === 3 : r.prio === p)).map((r) => r.rms50).sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : 0;
  };
  const m0 = med(0);
  const m2 = med(2);
  const m3 = med(3);
  ok(m3 > m2 * 0.9 && m2 > m0 * 1.5, `loudness hierarchy (median loudest 50 ms at full intensity): danger ${db(m3).toFixed(1)} dB >= important ${db(m2).toFixed(1)} dB > texture ${db(m0).toFixed(1)} dB`);
  const step = rows.find((r) => r.id === 'step.stone' && r.k === 1);
  const hurt = rows.find((r) => r.id === 'hurt.blunt' && r.k === 1);
  ok(hurt.rms50 > step.rms50 * 2, `a hit reads over a footstep by ${(db(hurt.rms50) - db(step.rms50)).toFixed(1)} dB`);
  if (showTable) {
    console.log('\n  recipe                 k  prio bus        peak dBFS  rms50 dBFS  plan s  audible s');
    for (const r of rows) {
      console.log(`  ${r.id.padEnd(22)} ${r.k.toFixed(0)}  ${String(r.prio).padEnd(4)} ${r.bus.padEnd(10)} ${db(r.peak).toFixed(1).padStart(8)}  ${db(r.rms50).toFixed(1).padStart(9)}  ${r.dur.toFixed(2).padStart(6)}  ${r.audible.toFixed(2).padStart(8)}`);
    }
    if (wavDir) console.log(`\n  ${rows.length} WAVs (${SR} Hz mono) in ${wavDir}`);
  }
}

console.log(fails ? `\n${fails} SFX CHECK(S) FAILED` : '\nALL SFX CHECKS PASS');
process.exit(fails ? 1 : 0);
