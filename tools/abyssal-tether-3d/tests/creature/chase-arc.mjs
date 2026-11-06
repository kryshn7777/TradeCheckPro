// THE CHASE ARC (plans/CHASE_ARC.md, Node): a Mason chase gets its release.
//   arc:    a scripted bus stream (notice, commit, knockers, strike misses, a skitterling strike, sight lost) gives chase:start once and,
//           3 s after sight is lost, chase:lost {duration, closest, knockers, nearMisses} with the right numbers; never a lost after a
//           death (nor after a hit), a re-notice within 3 s merges into one chase (3.5 s: two), a glimpse that does not commit is no
//           chase, the run / menu / respawn events forget it, determinism
//   real:   the real Creature3D + MasonSense on the stub shaft: it commits, the lantern goes dark, its memory runs out, the arc releases
//           once with closest = the smallest sight.nearDist seen
//   glue:   the heartbeat interval (near faster, capped), chase:pulse payloads, the toast text (pluralised, no locale commas), the music
//           duck 4 s, the watchdog, the debug start / lost; the sounds: valid recipes, the routes, registerChaseSfx
//   plus:   no allocation per frame (static + heap sampled), the game.js wiring
//   node chase-arc.mjs [--root DIR]
import fs from 'node:fs';
import inspector from 'node:inspector/promises';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { EventBus, DIFFICULTY } = await import(srcUrl('sim/config3d.js'));
const { ChaseArc, CHASE, CHASE_STATE } = await import(srcUrl('sim/chaseArc.js'));
const { ChaseGlue, chaseToast, pulseInterval, PULSE, DUCK } = await import(srcUrl('chaseGlue.js'));
const SFX = await import(srcUrl('audio/chaseSfx.js'));
const D = await import(srcUrl('audio/sfxDesign.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Creature3D } = await import(srcUrl('sim/creature3d.js'));
const { SIGHT_TUNE } = await import(srcUrl('sim/masonSight.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

/** A bus + an arc + the event log; run(s, dist) steps the arc s seconds at 60 Hz. */
function rig() {
  const bus = new EventBus();
  const arc = new ChaseArc(bus);
  const w = { bus, arc, ev: [], t: 0 };
  bus.on('chase:start', (p) => w.ev.push({ t: w.t, type: 'start', p: Object.assign({}, p) }));
  bus.on('chase:lost', (p) => w.ev.push({ t: w.t, type: 'lost', p: Object.assign({}, p) }));
  w.run = (s, dist) => {
    const n = Math.round(s * 60);
    for (let i = 0; i < n; i++) {
      w.t += DT;
      arc.update(DT, typeof dist === 'function' ? dist(w.t) : dist === undefined ? 1e9 : dist);
    }
  };
  w.n = (type) => w.ev.filter((e) => e.type === type).length;
  w.lost = () => w.ev.find((e) => e.type === 'lost');
  return w;
}

// ---- 1. the scripted chase ------------------------------------------------------------------------------------------------------
{
  const w = rig();
  w.bus.emit('creature:notice', { x: 0, y: 0, z: 0, distance: 18, commit: 0.5 });
  ok(w.arc.stateName === 'pending' && w.n('start') === 0, 'a notice is pending, not yet a chase');
  w.run(0.5, 17);
  w.bus.emit('creature:sight', { on: true, distance: 16.5 });
  ok(w.n('start') === 1 && w.arc.chasing, 'the commit (creature:sight on) starts the chase: chase:start once');
  w.run(4, (t) => 16 - t * 2); // closing in: 16 m -> ~7 m
  w.bus.emit('knocker:throw', { x: 0, y: 0, z: 0, speed: 12 });
  w.run(2, (t) => Math.abs(t - 5.5) * 4 + 3.1); // the nearest pass: 3.1 m at t = 5.5
  w.bus.emit('creature:strike', { hit: false, distance: 4.2 });
  w.bus.emit('creature:strike', { hit: false, distance: 5 });
  w.bus.emit('creature:strike', { hit: false, distance: 0.5, skit: true }); // a skitterling: not the Mason
  w.bus.emit('creature:sight', { on: true, distance: 9 }); // a repeat commit inside the chase: no second start
  w.run(14.2 - w.t, 12);
  w.bus.emit('creature:sight', { on: false, reason: 'lost', distance: 20 });
  ok(w.arc.stateName === 'settle' && w.n('lost') === 0, 'sight lost: the settle window, no release yet');
  w.run(CHASE.merge - 0.1, 25);
  ok(w.n('lost') === 0, `no chase:lost before the ${CHASE.merge} s merge window closes`);
  w.run(0.2, 25);
  const L = w.lost();
  ok(w.n('start') === 1 && w.n('lost') === 1, 'one chase:start, one chase:lost');
  ok(L && near(L.p.duration, 14.2, 0.02), `duration = notice -> sight lost: ${L && L.p.duration.toFixed(3)} s (want 14.2)`);
  ok(L && near(L.p.closest, 3.1, 0.05), `closest = the smallest nearDist: ${L && L.p.closest.toFixed(3)} m (want 3.1)`);
  ok(L && L.p.knockers === 1 && L.p.nearMisses === 2, `knockers ${L && L.p.knockers} (want 1), near misses ${L && L.p.nearMisses} (want 2; the skitterling ignored)`);
  ok(L && Object.keys(L.p).sort().join() === 'closest,duration,knockers,nearMisses' && Object.keys(w.ev[0].p).length === 0, 'the contract: chase:start {} / chase:lost {duration, closest, knockers, nearMisses}');
  ok(w.arc.stateName === 'idle' && w.arc.stats.lost === 1, 'idle after the release');
  w.run(10, 2);
  ok(w.n('lost') === 1, 'nothing more without a new notice');
  // determinism: the same stream gives the same numbers
  const again = () => {
    const v = rig();
    v.bus.emit('creature:notice', { distance: 20 });
    v.run(0.5, 19);
    v.bus.emit('creature:sight', { on: true, distance: 19 });
    v.run(7.3, (t) => 19 - t);
    v.bus.emit('creature:sight', { on: false, reason: 'blocked' });
    v.run(4, 30);
    return JSON.stringify(v.ev);
  };
  ok(again() === again(), 'deterministic (the same stream, the same events and numbers)');
}

// ---- 2. never a lost after a death / a hit --------------------------------------------------------------------------------------
{
  const w = rig();
  w.bus.emit('creature:notice', { distance: 10 });
  w.bus.emit('creature:sight', { on: true, distance: 10 });
  w.run(3, 4);
  w.bus.emit('player:death', { cause: 'creature' });
  w.bus.emit('creature:sight', { on: false, reason: 'blocked' }); // the Mason drops its chase when you are dead
  w.run(10, 5);
  w.bus.emit('creature:notice', { distance: 8 }); // while dead: ignored
  w.bus.emit('creature:sight', { on: true, distance: 8 });
  w.bus.emit('creature:sight', { on: false, reason: 'lost' });
  w.run(10, 5);
  ok(w.n('start') === 1 && w.n('lost') === 0 && w.arc.stats.deaths === 1, 'a death ends the chase with NO chase:lost, and nothing starts until a respawn');
  w.bus.emit('game:respawn', {});
  w.bus.emit('creature:sight', { on: true, distance: 15 });
  w.run(2, 15);
  w.bus.emit('creature:sight', { on: false, reason: 'lost' });
  w.run(4, 30);
  ok(w.n('start') === 2 && w.n('lost') === 1, 'after the respawn a new chase runs and releases');
  // death inside the settle window
  const v = rig();
  v.bus.emit('creature:sight', { on: true, distance: 10 });
  v.run(2, 6);
  v.bus.emit('creature:sight', { on: false, reason: 'lost' });
  v.run(1.5, 6);
  v.bus.emit('player:death', { cause: 'fall' });
  v.run(5, 30);
  ok(v.n('lost') === 0, 'a death in the settle window (it lost you, then you fell): no chase:lost');
  // a strike that connects
  const h = rig();
  h.bus.emit('creature:sight', { on: true, distance: 10 });
  h.run(2, 3);
  h.bus.emit('creature:strike', { hit: true, distance: 0.4 });
  // MASON_STRIKES.md: a connect costs 30 % and the chase goes on (it is not an escape: no near miss); a lethal one ends it as a death
  ok(h.arc.chasing && h.arc.stats.caught === 1 && h.arc.nearMisses === 0, 'a strike that connects: caught (no near miss), the chase goes on');
  h.bus.emit('player:death', { cause: 'creature' });
  h.bus.emit('creature:sight', { on: false, reason: 'blocked' });
  h.run(5, 30);
  ok(h.n('lost') === 0, 'a connect that kills: no release');
  // the run / menu forget it silently
  for (const ev of ['game:start', 'game:restart', 'game:menu', 'game:victory']) {
    const m = rig();
    m.bus.emit('creature:sight', { on: true, distance: 10 });
    m.run(2, 6);
    m.bus.emit('creature:sight', { on: false, reason: 'lost' });
    m.bus.emit(ev, {});
    m.run(5, 30);
    if (m.n('lost') !== 0 || m.arc.stateName !== 'idle') ok(false, `${ev} forgets the chase`);
  }
  ok(true, 'game:start / restart / menu / victory forget a chase silently');
}

// ---- 3. merge / glimpse ------------------------------------------------------------------------------------------------------------
{
  const w = rig();
  w.bus.emit('creature:notice', { distance: 20 });
  w.run(0.5, 20);
  w.bus.emit('creature:sight', { on: true, distance: 20 });
  w.run(4.5, 9);
  w.bus.emit('creature:sight', { on: false, reason: 'lost' }); // lost at t = 5
  w.run(2.4, 15);
  w.bus.emit('creature:notice', { distance: 14 }); // 2.4 s later: the same chase
  w.run(0.5, 7);
  w.bus.emit('creature:sight', { on: true, distance: 7 });
  w.bus.emit('knocker:throw', {});
  w.run(4.6, 5);
  w.bus.emit('creature:sight', { on: false, reason: 'blocked' }); // lost again at t = 12.5
  w.run(3.2, 30);
  const L = w.lost();
  ok(w.n('start') === 1 && w.n('lost') === 1 && w.arc.stats.merged === 1, 'a re-notice 2.4 s after losing it merges into ONE chase (one start, one lost)');
  ok(L && near(L.p.duration, 12.5, 0.02) && near(L.p.closest, 5, 1e-9) && L.p.knockers === 1, `... its duration runs over both (${L && L.p.duration.toFixed(2)} s, want 12.5), closest ${L && L.p.closest} m`);
  // the edge: a re-commit at 2.95 s merges, 3.5 s is a new chase
  const at = (gap) => {
    const v = rig();
    v.bus.emit('creature:sight', { on: true, distance: 10 });
    v.run(3, 10);
    v.bus.emit('creature:sight', { on: false, reason: 'lost' });
    v.run(gap, 20);
    v.bus.emit('creature:notice', { distance: 12 });
    v.run(0.5, 12);
    v.bus.emit('creature:sight', { on: true, distance: 12 });
    v.run(2, 12);
    v.bus.emit('creature:sight', { on: false, reason: 'lost' });
    v.run(4, 30);
    return [v.n('start'), v.n('lost')].join('/');
  };
  const a = at(2.95);
  const b = at(3.5);
  ok(a === '1/1' && b === '2/2', `a re-notice 2.95 s after: one chase (${a}); 3.5 s after: two chases (${b})`);
  // a glimpse
  const g = rig();
  g.bus.emit('creature:notice', { distance: 25 });
  g.run(CHASE.pending + 0.1, 25);
  g.bus.emit('creature:sight', { on: false, reason: 'lost' }); // stray: no chase to lose
  g.run(5, 25);
  ok(g.n('start') === 0 && g.n('lost') === 0 && g.arc.stats.glimpses === 1 && g.arc.stateName === 'idle', 'a notice that never commits is a glimpse: no start, no lost');
}

// ---- 4. the real MasonSense ------------------------------------------------------------------------------------------------------
{
  const LEDGE = { x: -14.4, y: -343.1, z: -4 }; // sight.mjs: a stub-shaft ledge in s6 (an open shaft, clean lines)
  const L = new Level3D(makeShaftData(), 'normal');
  const bus = new EventBus();
  const arc = new ChaseArc(bus);
  const ev = [];
  let t = 0;
  bus.on('chase:start', () => ev.push({ t, type: 'start' }));
  bus.on('chase:lost', (p) => ev.push({ t, type: 'lost', p: Object.assign({}, p) }));
  const offAt = [];
  bus.on('creature:sight', (p) => {
    if (!p.on) offAt.push(t);
  });
  const c = new Creature3D(L, DIFFICULTY.normal, bus, { seed: 3 });
  const p = { x: LEDGE.x, y: LEDGE.y, z: LEDGE.z, vx: 0, vy: 0, vz: 0, alive: true };
  c.reset(p);
  let minNear = 1e9;
  const step = (n, each) => {
    for (let i = 0; i < n; i++) {
      t += DT;
      if (each && each() === false) return;
      c.lethal = false; // the test is about the arc, not the kill
      c.update(DT, p, t);
      const nd = c.sight.nearDist;
      if (arc.state !== CHASE_STATE.IDLE && nd < minNear) minNear = nd;
      arc.update(DT, nd);
    }
  };
  step(60 * 25, () => !c.sight.chasing);
  const committed = c.sight.chasing;
  const s0 = ev.filter((e) => e.type === 'start').length;
  step(60 * 2);
  c.setSight(true, false, false); // the lantern goes dark: it cannot see you any more
  step(60 * (SIGHT_TUNE.normal.memory + CHASE.merge + 2));
  const starts = ev.filter((e) => e.type === 'start').length;
  const lost = ev.filter((e) => e.type === 'lost');
  const off = offAt.length ? offAt[0] : -1;
  ok(committed && s0 === 1, `the real Mason commits on the open shaft: chase:start once (t ${ev.length ? ev[0].t.toFixed(2) : '-'} s)`);
  ok(
    starts === 1 && lost.length === 1 && off > 0 && near(lost[0].t - off, CHASE.merge, DT * 1.5),
    `lantern dark -> its ${SIGHT_TUNE.normal.memory} s memory -> creature:sight off -> chase:lost ${CHASE.merge} s later (off ${off.toFixed(2)}, lost ${lost.length ? lost[0].t.toFixed(2) : '-'})`,
  );
  ok(lost.length === 1 && near(lost[0].p.closest, minNear, 1e-9) && lost[0].p.closest < 1e8 && lost[0].p.duration > 2, `closest = the smallest sight.nearDist (${lost.length ? lost[0].p.closest.toFixed(2) : '-'} m), duration ${lost.length ? lost[0].p.duration.toFixed(2) : '-'} s`);
}

// ---- 5. the glue ---------------------------------------------------------------------------------------------------------------
{
  ok(chaseToast({ duration: 14.23, closest: 3.08, knockers: 1, nearMisses: 0 }) === 'LOST IT · 14.2 s · closest 3.1 m · 1 knocker', `toast: '${chaseToast({ duration: 14.23, closest: 3.08, knockers: 1, nearMisses: 0 })}'`);
  ok(chaseToast({ duration: 1234.56, closest: 12, knockers: 2, nearMisses: 1 }) === 'LOST IT · 1234.6 s · closest 12.0 m · 2 knockers · 1 near miss', 'toast: plurals, no locale commas (1234.6 s), 1 near miss');
  ok(chaseToast({ duration: 6, closest: 1e9, knockers: 0, nearMisses: 3 }) === 'LOST IT · 6.0 s · 3 near misses', 'toast: an unmeasured closest and zero counts are left out');
  ok(pulseInterval(1) === PULSE.fast && pulseInterval(PULSE.nearD) === PULSE.fast && pulseInterval(40) === PULSE.slow && pulseInterval(1e9) === PULSE.slow && pulseInterval(14) > PULSE.fast && pulseInterval(14) < PULSE.slow && PULSE.slow === 0.9, `the beat: ${PULSE.slow} s far, ${PULSE.fast} s near (capped), linear between (14 m: ${pulseInterval(14).toFixed(2)} s)`);
  const bus = new EventBus();
  const sight = { nearDist: 1e9, chasing: false, noticing: false };
  const toasts = [];
  const ducks = [];
  const reg = { sfx: [], routes: [] };
  const game = {
    bus,
    state: 'playing',
    victoryT: -1,
    player: { alive: true },
    creature: { sight },
    audio: { registerSfx: (id, r) => (reg.sfx.push(id), D.compileRecipe(id, r)), registerSfxRoute: (type) => reg.routes.push(type), _music: { duck: (s) => ducks.push(s) } },
    _toast: (text, s) => toasts.push([text, s]),
  };
  const g = new ChaseGlue(game);
  const pulses = [];
  let t = 0;
  bus.on('chase:pulse', (p) => pulses.push({ t, k: p.k, d: p.d }));
  const run = (s) => {
    for (let i = 0, n = Math.round(s * 60); i < n; i++) {
      t += DT;
      g.update(DT);
    }
  };
  run(0.1);
  ok(reg.sfx.join() === 'chase.pulse,chase.exhale' && reg.routes.join() === 'chase:start,chase:pulse,chase:lost', 'the sounds register once the audio exists: 2 recipes, routes on chase:start / chase:pulse / chase:lost');
  sight.chasing = true;
  sight.nearDist = 30;
  bus.emit('creature:notice', { distance: 30 });
  bus.emit('creature:sight', { on: true, distance: 30 });
  const t0 = t;
  run(5);
  const far = pulses.filter((e) => e.t > t0);
  sight.nearDist = 3;
  pulses.length = 0;
  const t1 = t;
  run(5);
  const nearP = pulses.filter((e) => e.t > t1 + 1);
  const gap = (a) => (a.length > 1 ? (a[a.length - 1].t - a[0].t) / (a.length - 1) : 0);
  ok(near(gap(far), PULSE.slow, 0.02) && near(gap(nearP), PULSE.fast, 0.02), `chase:pulse every ${gap(far).toFixed(2)} s at 30 m, ${gap(nearP).toFixed(2)} s at 3 m`);
  ok(far.every((e) => e.k === 0) && nearP.every((e) => e.k === 1 && e.d === 3), 'pulse k: 0 far, 1 near; d = the distance');
  ok(toasts.length === 0 && ducks.length === 0, 'no toast / duck while it chases');
  // paused: the clock stops
  game.state = 'paused';
  const np = pulses.length;
  run(3);
  ok(pulses.length === np, 'paused: no beats, the arc does not run');
  game.state = 'playing';
  sight.chasing = false;
  bus.emit('knocker:throw', {});
  bus.emit('creature:strike', { hit: false, distance: 2.5 });
  bus.emit('creature:sight', { on: false, reason: 'lost' });
  sight.nearDist = 20;
  run(CHASE.merge + 0.1);
  ok(toasts.length === 1 && /^LOST IT · 10\.\d s · closest 2\.5 m · 1 knocker · 1 near miss$/.test(toasts[0][0]) && toasts[0][1] === 3, `chase:lost -> the toast '${toasts.length ? toasts[0][0] : ''}' for 3 s`);
  ok(ducks.length === 1 && ducks[0] === DUCK && DUCK === 4, 'chase:lost -> the score ducked 4 s (audio._music.duck)');
  const np2 = pulses.length;
  run(3);
  ok(pulses.length === np2, 'no beats after the release');
  // the watchdog: the Mason reset without a sight-off
  sight.chasing = true;
  bus.emit('creature:sight', { on: true, distance: 9 });
  sight.chasing = false;
  run(CHASE.merge + 0.2);
  ok(toasts.length === 2, 'the watchdog: a chase whose Mason stops chasing without a sight-off still releases');
  // the debug helpers
  ok(g.debugStart(6) && g.arc.chasing, 'debug start(): a chase now');
  run(1);
  ok(g.arc.chasing, '... the watchdog leaves a debug chase alone');
  ok(g.debugLost() && toasts.length === 3 && g.arc.stateName === 'idle', 'debug lost(): the release now');
  const ds = g.debugState();
  ok(ds && ds.toasts === 3 && ds.state === 'idle' && ds.last && typeof ds.last.duration === 'number', 'debugState() reads the arc');
  // a death mid-chase: no toast
  g.debugStart(6);
  bus.emit('player:death', {});
  game.player.alive = false;
  run(5);
  game.player.alive = true;
  run(5);
  ok(toasts.length === 3, 'a death mid-chase: no toast, no duck');
}

// ---- 6. the sounds -------------------------------------------------------------------------------------------------------------
{
  const pulse = D.compileRecipe(SFX.CHASE_PULSE_ID, SFX.CHASE_PULSE_RECIPE);
  const ex = D.compileRecipe(SFX.CHASE_EXHALE_ID, SFX.CHASE_EXHALE_RECIPE);
  const bad = D.validateRecipe(pulse).concat(D.validateRecipe(ex));
  ok(bad.length === 0, `the recipes are sound (${bad.join('; ') || 'ok'})`);
  const plan = new D.Plan();
  D.resolveRecipe(pulse, 1, 0, plan, 21600);
  const pd = plan.dur;
  const pl = plan.level;
  D.resolveRecipe(pulse, 0, 0, plan, 21600);
  const pl0 = plan.level;
  D.resolveRecipe(ex, 1, 0, plan, 21600);
  ok(pulse.nVar === 1 && ex.nVar === 1, "designed, not random-flavoured: one 'fixed' variant each");
  ok(pd < 1.2 && pl > pl0 && plan.dur > 3 && plan.dur < 8, `the pulse is short (${pd.toFixed(2)} s) and louder near (k 1 ${pl.toFixed(2)} > k 0 ${pl0.toFixed(2)}); the exhale is long (${plan.dur.toFixed(2)} s)`);
  const hasLfo = SFX.CHASE_EXHALE_RECIPE.layers.some((L) => L.lfo && L.f2 < L.f && L.t === 'noise');
  const falls = SFX.CHASE_EXHALE_RECIPE.layers.some((L) => L.t === 'tone' && L.f2 < L.f);
  const lowThud = SFX.CHASE_PULSE_RECIPE.layers.filter((L) => L.t === 'tone' && L.f < 80).length === 2;
  ok(hasLfo && falls && lowThud, 'the exhale: a falling shaking noise band + a falling tone; the pulse: two low thuds (lub-dub)');
  const played = [];
  const E = {
    _o: {},
    opts() {
      return this._o;
    },
    play(id, k) {
      played.push([id, k]);
    },
  };
  SFX.chasePulseRoute({ k: 1 }, E);
  SFX.chasePulseRoute({}, E);
  SFX.chaseExhaleRoute({ duration: 30 }, E);
  SFX.chaseExhaleRoute({ duration: 0 }, E);
  ok(played.join('|') === 'chase.pulse,1|chase.pulse,0.6|chase.exhale,1|chase.exhale,0.3', `the routes: ${played.join(' | ')}`);
  ok(SFX.registerChaseSfx(null) === false && SFX.registerChaseSfx({}) === false, 'no engine: registerChaseSfx does nothing');
  const src = fs.readFileSync(SRC_DIR + '/audio/chaseSfx.js', 'utf8') + fs.readFileSync(SRC_DIR + '/sim/chaseArc.js', 'utf8') + fs.readFileSync(SRC_DIR + '/chaseGlue.js', 'utf8');
  ok(!/Math\.random\(/.test(src), 'no Math.random in the chase modules');
}

// ---- 7. no allocation per frame -------------------------------------------------------------------------------------------------
{
  const strip = (file, names) => {
    const src = fs.readFileSync(SRC_DIR + '/' + file, 'utf8');
    return names
      .map((name) => {
        const a = src.indexOf('\n  ' + name + '(');
        const b = src.indexOf('\n  }\n', a);
        return src.slice(a, b);
      })
      .join('\n')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/this\._lost\(\)/g, '');
  };
  const hot = strip('sim/chaseArc.js', ['update', '_near', 'onSightOff']) + strip('chaseGlue.js', ['update', '_sight', '_dist']).replace(/registerChaseSfx\([^)]*\)/, '');
  const bad = [/\bnew\s/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.(map|filter|slice|concat|join|bind)\(/].filter((r) => r.test(hot));
  ok(hot.length > 1200 && bad.length === 0, `static: the per-frame paths (ChaseArc.update / _near / onSightOff, ChaseGlue.update) build nothing${bad.length ? ' — found ' + bad.join(' ') : ''}`);
  const bus = new EventBus();
  const sight = { nearDist: 7, chasing: true, noticing: false };
  const game = { bus, state: 'playing', victoryT: -1, player: { alive: true }, creature: { sight }, audio: null, _toast() {} };
  const g = new ChaseGlue(game);
  bus.emit('creature:sight', { on: true, distance: 7 });
  for (let i = 0; i < 20000; i++) {
    sight.nearDist = 4 + (i % 600) / 30;
    g.update(DT); // warm up (the JIT: interpreted code boxes doubles)
  }
  // sampled in 5 chunks; the median chunk is the steady state (a one-off JIT re-optimisation can land a single sample in one chunk)
  const N = 20000;
  const chunks = [];
  for (let c = 0; c < 5; c++) {
    const session = new inspector.Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 64 });
    for (let i = 0; i < N; i++) {
      sight.nearDist = 4 + (i % 600) / 30;
      g.update(DT);
    }
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();
    let bytes = 0;
    (function walk(n) {
      const f = n.callFrame || {};
      if (/chase(Arc|Glue)\.js/.test(f.url || '')) bytes += n.selfSize || 0;
      if (process.env.CHASE_ALLOC && n.selfSize && /chase/.test(f.url || '')) console.log('ALLOC', f.functionName, f.lineNumber, n.selfSize);
      for (const ch of n.children || []) walk(ch);
    })(profile.head);
    chunks.push(bytes / N);
  }
  const med = chunks.slice().sort((x, y) => x - y)[2];
  ok(g.arc.chasing && g.pulses > 100 && med < 0.5, `heap sampled over 5 x ${N} chasing frames with ${g.pulses} beats: median ${med.toFixed(2)} B / frame attributed to the chase modules (chunks ${chunks.map((v) => v.toFixed(2)).join(' ')})`);
}

// ---- 8. the wiring --------------------------------------------------------------------------------------------------------------
{
  const g = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  ok(/import \{ ChaseGlue \} from '\.\/chaseGlue\.js'/.test(g) && /this\._setupPuzzleFocus\(\);\n\s*this\._setupChase\(\);/.test(g), 'game.js: ChaseGlue built with the bus (_setupChase next to _setupPuzzleFocus)');
  ok(/if \(this\.chase\) this\.chase\.update\(dt\);[^\n]*\n\s*\} catch \(err\) \{\n\s*this\._fault\('chase', err\);/.test(g), "game.js: chase.update(dt) once a frame in _updateViews, guarded by _fault('chase')");
  ok(/chase: \{\n\s*state: \(\) =>/.test(g) && /debugStart\(dist\)/.test(g) && /debugLost\(\)/.test(g), 'game.js: AT3D.debug.chase { state, start, lost }');
  const m = fs.readFileSync(SRC_DIR + '/audio/music3d.js', 'utf8');
  ok(/\n {2}duck\(s\) \{/.test(m), 'audio/music3d.js still has duck(s) (the release ducks the score through audio._music)');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL CHASE ARC CHECKS PASS');
process.exit(fails ? 1 : 0);
