// CHAPTER II · the hook (sim/hook3d.js + render/mereView.js), Node: the sequence's timeline against the real chain lift of the level data, the events in order, the
// splash path, determinism, snapshot / restore; the Mere view builds its four draw calls and follows the state (no renderer needed).
//   node test-mere.mjs [--root DIR]
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true }; if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true }; return next(s, c); }`));
globalThis.self = globalThis;
const THREE = await import('three');
const { HookSequence, HOOK } = await import(srcUrl('sim/hook3d.js'));
const { MereView, stemGeometry } = await import(srcUrl('render/mereView.js'));
const Mv = await import(srcUrl('sim/movers3d.js'));
const { LEVEL_DATA_CH2: D } = await import(srcUrl('data/chapter2-data.js'));
const { EventBus } = await import(srcUrl('sim/config3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const H = D.c2.hook;
const raw = D.movers.find((m) => m.id === H.chain.moverId);
const mv = () => Mv.normalizeMover(raw, 'normal');

function run(opts = {}) {
  const bus = new EventBus();
  const ev = [];
  for (const t of ['hook:start', 'hook:click', 'hook:open', 'hook:arrive', 'hook:rear', 'hook:bow', 'hook:seat', 'hook:card', 'hook:end']) bus.on(t, (e) => ev.push([t, e]));
  const seq = new HookSequence({ bus, chain: { y: H.chain.y, drop: H.chain.drop, clickEvery: H.chain.clickEvery }, water: H.water, wallsEndY: H.wallsEndY });
  const m = mv();
  const q = {};
  const dt = 1 / 60;
  let clock = 0;
  let t = 0;
  let started = false;
  let startAt = 1e9;
  const log = [];
  for (; t < 140; t += dt) {
    clock += dt;
    m.startAt = startAt;
    Mv.moverRef(m, clock, q);
    const splash = opts.splashAt != null && t >= opts.splashAt;
    seq.update(dt, { onPad: t > 2, platformY: q.y, splash });
    if (!started && seq.wantsStart) {
      started = true;
      startAt = clock;
      seq.begin();
      log.push(['start', t]);
    }
    if (seq.state.phase === 'end') break;
  }
  return { seq, ev, t, q, log };
}

{
  const r = run();
  const names = r.ev.map((e) => e[0]);
  const first = (n) => names.indexOf(n);
  ok(names.filter((n) => n === 'hook:click').length === 12, `${names.filter((n) => n === 'hook:click').length} pawl clicks (a click every ${H.chain.clickEvery} m of the ${H.chain.drop} m)`);
  const order = ['hook:start', 'hook:open', 'hook:arrive', 'hook:rear', 'hook:bow', 'hook:seat', 'hook:card', 'hook:end'];
  ok(order.every((n, i) => first(n) >= 0 && (i === 0 || first(n) > first(order[i - 1]))), `the events come in order: ${order.map((n) => n.slice(5)).join(' > ')}`);
  ok(r.seq.state.phase === 'end' && r.t > 60 && r.t < 100, `the whole hook takes ${r.t.toFixed(0)} s after the step on`);
  ok(Math.abs(r.q.y - (H.chain.y - H.chain.drop)) < 0.01, `the platform stops ${H.chain.drop} m down, ${H.chain.y - H.chain.drop - H.water.y} m over the water`);
  const lastClick = r.ev.filter((e) => e[0] === 'hook:click').slice(-1)[0][1];
  ok(Math.abs(lastClick.y - (H.chain.y - 36)) < 0.01, 'the last click is the stop: then the silence');
  ok(r.seq.state.bow === 1 && r.seq.state.rear === 1 && r.seq.state.seat === 1, 'the near throat rose, all bowed, the light is lit');
  const r2 = run();
  ok(JSON.stringify(r.ev.map((e) => e[0])) === JSON.stringify(r2.ev.map((e) => e[0])) && r.t === r2.t, 'deterministic');
}
{
  const r = run({ splashAt: 20 });
  ok(r.seq.state.phase === 'end' && r.t < 45, `a jump into the water plays the card at once (end at ${r.t.toFixed(0)} s)`);
  ok(!r.ev.some((e) => e[0] === 'hook:rear'), '... before the throat has risen');
}
{
  const seq = new HookSequence({ chain: { y: 0, drop: 36, clickEvery: 3 }, water: { y: -42 }, wallsEndY: -14 });
  ok(!seq.wantsStart, 'resting: the chain does not start by itself');
  for (let i = 0; i < 70; i++) seq.update(1 / 60, { onPad: true, platformY: 0 });
  ok(seq.wantsStart && seq.state.phase === 'rest', `standing on the platform for ${HOOK.stepOn} s asks for the chain`);
  seq.begin();
  const sn = seq.snapshot();
  for (let i = 0; i < 600; i++) seq.update(1 / 60, { onPad: true, platformY: -i * 0.06 });
  const mid = JSON.stringify(seq.state);
  seq.restore(sn);
  ok(JSON.stringify(seq.state) === JSON.stringify(sn.state) && JSON.stringify(seq.state) !== mid, 'snapshot / restore');
  seq.reset();
  ok(seq.state.phase === 'rest' && seq.state.clicks === 0 && !seq.wantsStart, 'reset');
}
// the view
{
  const g = stemGeometry();
  ok(g.getAttribute('position').count === (18 + 1) * 6 + 24 && g.getIndex().count > 0, 'a stem is a tube with a ring on its tip');
  const scene = new THREE.Scene();
  const v = new MereView(scene);
  v.build(H);
  ok(v.stats.drawCalls === 4 && v.stats.stems > 90 && v.stats.lanterns >= 1000, `the Mere: ${v.stats.drawCalls} draw calls, ${v.stats.stems} throats, ${v.stats.lanterns} lanterns`);
  v.update(0.1, { open: 0, wave: 0, rear: 0, bow: 0, seat: 0 }, 0);
  ok(!v.root.visible, 'hidden while the walls still hide it');
  v.update(0.1, { open: 0.5, wave: 30, rear: 0, bow: 0, seat: 0 }, -40);
  ok(v.root.visible && v.u.uWave.value === 30 && v.ul.uWave.value === 30, 'shown once the cavern opens; the wave drives the rings and the lanterns');
  v.update(0.1, { open: 1, wave: 200, rear: 1, bow: 0.6, seat: 1 }, -44);
  ok(v.u.uBow.value === 0.6 && v.u.uRear.value === 1 && v.parts.seat.material.opacity > 0.7 && Math.abs(v.u.uEye.value - (-44 + 1.6 - H.water.y)) < 1e-6, 'the bow, the near throat and the seat follow the state');
  v.dispose();
  ok(!scene.children.includes(v.root), 'dispose');
}
console.log(fails ? `FAILED: ${fails}` : 'ALL MERE CHECKS PASS');
process.exit(fails ? 1 : 0);
