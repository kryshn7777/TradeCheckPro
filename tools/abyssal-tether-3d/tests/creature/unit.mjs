// Behaviour unit checks for Creature3D / ThreatSystem3D (Node), on the stub shaft.
//   node unit.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, SEG, CREATURE_STATES } = await import(srcUrl('sim/creature3d.js'));
const { ThreatSystem3D } = await import(srcUrl('sim/threat3d.js'));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const mk = (diff = 'normal', seed = 1) => {
  const lv = new Level3D(makeShaftData(), DIFFICULTY[diff].levelVariant);
  const bus = new EventBus();
  const ev = [];
  for (const t of ['creature:state', 'creature:burst', 'creature:attack', 'creature:retreat', 'creature:sighting', 'creature:step', 'creature:call', 'creature:strike']) bus.on(t, (p) => ev.push([t, p]));
  return { lv, bus, ev, c: new Creature3D(lv, DIFFICULTY[diff], bus, { seed }) };
};
const player = (x, y, z) => ({ x, y, z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true });
const run = (c, p, secs, f) => { for (let i = 0; i < secs * 60; i++) { if (f) f(i / 60, p); c.update(1 / 60, p, i / 60); if (c.caughtPlayer) return i / 60; } return null; };

// 1. Sandbox: inert, silent, invisible, never kills.
{
  const { c, ev } = mk('sandbox');
  const p = player(0, -300, 0);
  c.reset(p);
  const t = run(c, p, 60);
  ok(c.active === false && t === null && ev.length === 0 && c.body.visible === false && c.audio.intensity === 0, 'sandbox: inert (no events, invisible, silent, never catches)');
}
// 2. Dormant sections: far away, ambient steps/calls only, invisible.
{
  const { c, ev } = mk();
  const p = player(0, -20, 0);
  c.reset(p);
  run(c, p, 90);
  const kinds = new Set(ev.map((e) => e[0]));
  ok(!c.inPlay && c.state === 'DORMANT' && c.distance > 80 && !c.body.visible && !kinds.has('creature:attack') && (kinds.has('creature:step') || kinds.has('creature:call')), `dormant: far (${c.distance.toFixed(0)} m), only ambient sounds [${[...kinds].join(',')}]`);
}
// 3. Sighting: trigger → creature:sighting, visible crossing with an OBSERVING pause, then gone + answering call.
{
  const { c, ev, bus, lv } = mk();
  const p = player(0, -165, 0);
  c.reset(p);
  run(c, p, 1);
  const trig = lv.sections[3].triggers[0];
  bus.emit('trigger:sighting', { name: 'sighting', data: trig.data, x: p.x, y: trig.y, z: p.z });
  let sawVisible = false, sawObs = false;
  run(c, p, 8.4, () => { if (c.body.visible) sawVisible = true; if (c.state === 'OBSERVING') sawObs = true; });
  const before = ev.filter((e) => e[0] === 'creature:call').length;
  run(c, p, 4);
  const after = ev.filter((e) => e[0] === 'creature:call').length;
  ok(ev.some((e) => e[0] === 'creature:sighting') && sawVisible && sawObs && !c.sighting && !c.body.visible && after > before, 'sighting: event, visible crossing, mid-way OBSERVING pause, ends, then an answering call');
}
// 4. Lethal section entry: comes from above, grace period, then hunts.
{
  const { c } = mk();
  const p = player(0, -240, 0);
  c.reset(p);
  ok(c.inPlay && c.state === 'APPROACHING' && c.y > p.y + 25 && c.grace > 0 && c.body.visible, `stalk entry: in play ${(c.y - p.y).toFixed(0)} m above with ${c.grace.toFixed(1)} s grace`);
  const sp = c.body.spine;
  let finite = true;
  for (const v of sp) if (!isFinite(v)) finite = false;
  ok(finite && sp.length === SEG * 3 && c.body.up.length === SEG * 3 && c.body.limbs.length === 10, 'body: spine/up Float32Array(SEG*3), 10 limbs');
}
// 5. Respawn: grace ≥ 3 s, repositioned ~40-55 m above, cannot catch during grace.
{
  const { c } = mk();
  const p = player(0, -320, 0);
  c.reset(p);
  run(c, p, 20);
  c.onRespawn(p);
  const above = c.y - p.y;
  const g = c.grace;
  let caughtEarly = false;
  run(c, p, 3, () => { if (c.caughtPlayer) caughtEarly = true; });
  ok(above >= 38 && above <= 60 && g >= 3.4 && !caughtEarly, `respawn: ${above.toFixed(0)} m above, grace ${g.toFixed(1)} s, no catch during grace`);
}
// 6. Non-lethal hunting holds off (data-driven lethal:false).
{
  const { c, lv } = mk();
  lv.sections[5].creature.lethal = false;
  const p = player(0, -330, 0);
  c.reset(p);
  const t = run(c, p, 120);
  ok(t === null && c.lethal === false, 'non-lethal hunt section: never catches a still player in 120 s');
}
// 7. Victory: gate slam (attack with gate:true), cannot kill, then retreat.
{
  const { c, ev, lv } = mk();
  const p = player(0, -556, -12);
  c.reset(p);
  run(c, p, 6);
  c.onVictory(lv.gate);
  const t = run(c, p, 8);
  const slam = ev.find((e) => e[0] === 'creature:attack' && e[1].gate);
  const sl = slam ? Math.hypot(slam[1].x - (lv.gate.minX + lv.gate.maxX) / 2, slam[1].y - (lv.gate.minY + lv.gate.maxY) / 2, slam[1].z - lv.gate.maxZ) : 999;
  ok(!!slam && t === null && c.state === 'RECOVERING' && sl < 6, `victory: gate slam (${sl.toFixed(1)} m from the gate face), no kill, retreating`);
}
// 8. Stall still on Normal: caught, with a telegraph (attack event with windup) before the hit.
{
  const { c, ev } = mk('normal', 3);
  const p = player(5, -340, 4);
  c.reset(p);
  const t = run(c, p, 60);
  const att = ev.find((e) => e[0] === 'creature:attack');
  const strike = ev.find((e) => e[0] === 'creature:strike' && e[1].hit);
  ok(t !== null && att && att[1].windup >= 0.35 && strike, `stall: caught after ${t && t.toFixed(1)} s (incl. ~8 s arrival) with a ${att && att[1].windup} s telegraphed wind-up`);
}
// 9. A player moving steadily down at 4 m/s is never caught (it stalks at menace).
{
  const { c } = mk('normal', 4);
  const p = player(0, -232, 0);
  c.reset(p);
  const t = run(c, p, 70, (tt, pp) => { pp.vy = -4; pp.y = Math.max(-550, -232 - 4 * tt); pp.x = 6 * Math.sin(tt * 0.2); pp.vx = 1.2 * Math.cos(tt * 0.2); });
  ok(t === null, 'steady 4 m/s descent through the lethal sections: never caught');
}
// 10. Threat: rises near the creature, decays, heartbeat in range, 0 in sandbox.
{
  const { c } = mk();
  const th = new ThreatSystem3D();
  const p = player(5, -340, 4);
  c.reset(p);
  let maxV = 0, beats = 0;
  for (let i = 0; i < 60 * 25; i++) {
    c.update(1 / 60, p, i / 60);
    th.update(1 / 60, { player: p, creature: c, tethers: { attached: false }, diff: DIFFICULTY.normal });
    maxV = Math.max(maxV, th.value);
    if (th.beatThisFrame) beats++;
    if (c.caughtPlayer) break;
  }
  const s = mk('sandbox');
  const th2 = new ThreatSystem3D();
  s.c.reset(p);
  for (let i = 0; i < 600; i++) { s.c.update(1 / 60, p, 0); th2.update(1 / 60, { player: p, creature: s.c, tethers: null, diff: DIFFICULTY.sandbox }); }
  ok(maxV > 0.8 && th.heartRate > 120 && beats > 10 && th2.value === 0, `threat: peaks ${maxV.toFixed(2)}, heart ${th.heartRate.toFixed(0)} bpm, ${beats} beats; sandbox ${th2.value}`);
  const fall = new ThreatSystem3D();
  const pf = Object.assign(player(0, -100, 0), { grounded: false, vy: -15 });
  for (let i = 0; i < 120; i++) fall.update(1 / 60, { player: pf, creature: null, tethers: { attached: false }, diff: DIFFICULTY.normal });
  const held = new ThreatSystem3D();
  for (let i = 0; i < 120; i++) held.update(1 / 60, { player: pf, creature: null, tethers: { attached: true }, diff: DIFFICULTY.normal });
  ok(fall.components.falling > 0.5 && held.components.falling === 0, `threat: free fall at 15 m/s → ${fall.components.falling.toFixed(2)}, 0 while a tether holds`);
}
// 11. Determinism with a seed.
{
  const a = mk('nightmare', 9), b = mk('nightmare', 9);
  const pa = player(0, -320, 0), pb = player(0, -320, 0);
  a.c.reset(pa); b.c.reset(pb);
  run(a.c, pa, 20); run(b.c, pb, 20);
  ok(a.c.x === b.c.x && a.c.y === b.c.y && a.c.state === b.c.state, 'deterministic with a seed');
}
// 12. Bus wiring: a new creature on the same bus takes over trigger:sighting (no double fire).
{
  const { c, bus, lv } = mk();
  const c2 = new Creature3D(lv, DIFFICULTY.normal, bus, { seed: 2 });
  const p = player(0, -165, 0);
  c.reset(p); c2.reset(p);
  let n = 0;
  bus.on('creature:sighting', () => n++);
  bus.emit('trigger:sighting', { data: {}, y: -172 });
  ok(n === 1 && c2.sighting && !c.sighting, 'bus: one listener set per bus, latest creature handles triggers');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
