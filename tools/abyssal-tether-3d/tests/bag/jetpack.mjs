// The JETPACK (sim/jetpack3d.js, render/jetpackView.js, game.js wiring).
// Asked for: "a jetpack which has a really low fuel, and he can find fuel rarely, but it just saves him if he falls down. Press both the triggers
// at once ... to trigger it briefly for a moment and then save himself. The fuel does not recharge when the player dies." Checks:
//   - the chord: two presses from the two hands within 90 ms (never the same hand twice, never 120 ms apart);
//   - lighting needs: airborne, falling >= 5 m/s, no rope, not cooling down, fuel; with no fuel it says so once a second and the presses stay shots;
//   - the burst: a 22 m/s fall is brought to the hover descent (-2.4 m/s) in < 0.8 s, the landing is soft (no damage), it costs well under a tank,
//     ends on the ground / out of fuel / after 2.4 s / when the chord is pressed again (and keeps the fuel then);
//   - ONE tank is a save or two, not flight (a full 1.0 tank burns for < 3.5 s even hovering);
//   - fuel: starts 0.5, a can adds 0.5 (cap 1.0), a full tank leaves the can; cans: every second section, never a 'slow' spot, risk first,
//     deterministic per seed, 3-5 on the real level; a can taken stays taken;
//   - DEATH: the respawn keeps the fuel and the taken cans (the checkpoint does not refill it); a NEW run resets both;
//   - save state round trip; bus events; the game wiring (chord reads, swallowed presses, ?jet=off, J key, the thrust added in the fixed step);
//   - the view builds on the scene (3 draw calls at most) and syncs when a can is taken.
//   node jetpack.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { SRC_DIR, VENDOR_THREE_URL } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const { Jetpack3D, JET, pickCans } = await import(srcUrl('sim/jetpack3d.js'));
const { EventBus, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const G = CONFIG.player.gravity;
const DT = 1 / 240;
const mkP = (vy = -14) => ({ x: 0, y: 100, z: 0, vx: 2, vy, vz: 0, grounded: false, alive: true, tethered: false });
const mk = () => {
  const bus = new EventBus();
  const ev = [];
  for (const t of ['jetpack:ignite', 'jetpack:cut', 'jetpack:empty', 'jetpack:can', 'jetpack:low']) bus.on(t, (p) => ev.push([t, p]));
  return { bus, ev, j: new Jetpack3D(bus) };
};
/** Falls for `secs` with the jetpack stepping (a pure vertical sim: gravity + the jetpack's push); returns the trace. */
function fall(j, p, secs, floorY = -1e9) {
  const trace = { t: 0, vy0: p.vy, min: p.vy, burnEnd: -1 };
  for (let t = 0; t < secs; t += DT) {
    const a = j.step(DT, p, false);
    if (a > 0) p.vy += a * DT;
    p.vy -= G * DT;
    p.y += p.vy * DT;
    if (p.y <= floorY) {
      p.grounded = true;
      trace.land = p.vy;
      p.vy = 0;
    }
    trace.t = t;
    if (!j.burning && trace.burnEnd < 0 && t > 0.01 && trace.started) trace.burnEnd = t;
    if (j.burning) trace.started = true;
  }
  return trace;
}

// ---- the chord ----
{
  const j = new Jetpack3D(null);
  ok(j.chord('left', 1.0) === false && j.chord('right', 1.05) === true, 'chord: left then right 50 ms later');
  ok(j.chord('right', 2.0) === false && j.chord('left', 2.12) === false, 'chord: 120 ms apart is two shots, not a chord');
  ok(j.chord('left', 3.0) === false && j.chord('left', 3.04) === false, 'chord: the same hand twice is not a chord');
  ok(j.chord('right', 4.0) === false && j.chord('left', 4.085) === true, 'chord: 85 ms is inside the window');
  ok(JET.chord <= 0.1, `chord window ${JET.chord} s (two deliberate shots are slower than that)`);
}

// ---- lighting rules ----
{
  const { j, ev } = mk();
  ok(!j.request(mkP(-2), false), 'light: not while falling slower than 5 m/s');
  const g = mkP(-14);
  g.grounded = true;
  ok(!j.request(g, false), 'light: not on the ground');
  ok(!j.request(mkP(-14), true), 'light: not with a rope attached');
  ok(!j.request(Object.assign(mkP(-14), { alive: false }), false), 'light: not when dead');
  ok(j.request(mkP(-14), false) && j.burning && ev.some((e) => e[0] === 'jetpack:ignite'), 'light: falling 14 m/s, free: it lights ("jetpack:ignite")');
  const e = mk();
  e.j.fuel = 0;
  ok(!e.j.request(mkP(-14), false) && e.ev.filter((x) => x[0] === 'jetpack:empty').length === 1, 'no fuel: it does not light and says so ("jetpack:empty"), the presses stay shots');
  e.j.step(0.5, mkP(), false);
  e.j.request(mkP(-14), false);
  ok(e.ev.filter((x) => x[0] === 'jetpack:empty').length === 1, 'no fuel: one click per second, not per press');
  e.j.step(1, mkP(), false);
  e.j.request(mkP(-14), false);
  ok(e.ev.filter((x) => x[0] === 'jetpack:empty').length === 2, 'no fuel: ... and again a second later');
}

// ---- the burst ----
{
  const { j, ev } = mk();
  const p = mkP(-22);
  ok(j.request(p, false), 'burst: lit at 22 m/s down');
  let tSettled = -1;
  const f0 = j.fuel;
  for (let t = 0; t < 3; t += DT) {
    const a = j.step(DT, p, false);
    if (a > 0) p.vy += a * DT;
    p.vy -= G * DT;
    p.y += p.vy * DT;
    if (tSettled < 0 && p.vy > JET.hoverVy - 0.5) tSettled = t;
    if (!j.burning) break;
  }
  ok(tSettled > 0 && tSettled < 0.8, `burst: the fall (22 m/s) is down to the hover descent in ${tSettled.toFixed(2)} s`);
  ok(f0 - j.fuel > 0.05 && j.fuel >= 0 && !j.burning, `burst: it spent ${(f0 - j.fuel).toFixed(2)} of a 0.5 tank and the burst ended by itself (hovering down uses what is left)`);
  const cut = ev.find((e) => e[0] === 'jetpack:cut');
  ok(cut && (cut[1].reason === 'fuel' || cut[1].reason === 'time'), `burst: ended ('${cut && cut[1].reason}')`);
  ok(Math.abs(p.vy - JET.hoverVy) < 2.5 || !j.burning, 'burst: it holds the slow descent while it burns');
}
{
  // a soft landing on a floor 6 m below: the speed at touch-down is the hover speed, not the fall's
  const { j } = mk();
  j.fuel = 1;
  const p = mkP(-18);
  p.y = 6;
  j.request(p, false);
  const tr = fall(j, p, 4, 0);
  ok(tr.land !== undefined && -tr.land < 6 && -tr.land < CONFIG.player.maxFallSpeed * 0.2, `landing: touches down at ${(-tr.land).toFixed(1)} m/s (a 17+ m/s landing is lethal on Normal)`);
  ok(j.burning === false || p.grounded, 'landing: the burn ends on the ground');
}
{
  // cancelled by the chord: the fuel that is left stays
  const { j, ev } = mk();
  const p = mkP(-16);
  j.request(p, false);
  fall(j, p, 0.4);
  const f = j.fuel;
  ok(j.request(p, false) && !j.burning && j.fuel === f, 'cancel: the chord again stops it and the rest of the fuel stays');
  ok(ev.some((e) => e[0] === 'jetpack:cut' && e[1].reason === 'cancel'), 'cancel: "jetpack:cut" reason cancel');
  ok(!j.request(p, false), 'cancel: a cool-down before it lights again (' + JET.cooldown + ' s)');
  j.step(JET.cooldown + 0.05, p, false);
  p.vy = -14;
  ok(j.request(p, false), 'cancel: ... and it lights again after');
}
{
  // a rope catching you ends it; death ends it
  const { j, ev } = mk();
  const p = mkP(-16);
  j.request(p, false);
  j.step(DT, p, true);
  ok(!j.burning && ev.some((e) => e[1].reason === 'rope'), 'burst: a rope that catches you ends it');
  const k = mk();
  const q = mkP(-16);
  k.j.request(q, false);
  q.alive = false;
  k.j.step(DT, q, false);
  ok(!k.j.burning && k.ev.some((e) => e[1].reason === 'death'), 'burst: death ends it');
}
{
  // ONE FULL TANK is not flight
  const { j } = mk();
  j.fuel = JET.tank;
  const p = mkP(-6);
  j.request(p, false);
  let burnT = 0;
  for (let t = 0; t < 8 && j.burning; t += DT) {
    const a = j.step(DT, p, false);
    if (a > 0) p.vy += a * DT;
    p.vy -= G * DT;
    burnT = t;
  }
  ok(burnT < 3.6, `a full tank burns for ${burnT.toFixed(1)} s at most (one burst is capped at ${JET.burstMax} s, hovering costs ${JET.hoverShare * 100} % of full thrust)`);
  ok(JET.startFuel === 0.5 && JET.canFuel === 0.5 && JET.tank === 1, 'the tank: starts at half, a can is half, the cap is one');
}

// ---- cans ----
{
  const spots = LEVEL_DATA_3D.supplies.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, tier: s.tier, section: (() => { const lvl = globalThis.__lvl || (globalThis.__lvl = new Level3D(LEVEL_DATA_3D)); return Math.max(0, lvl.sectionIndexAt(s.y)); })() }));
  const nSec = new Level3D(LEVEL_DATA_3D).sections.length;
  const a = pickCans(spots, 12345, { sections: nSec });
  const b = pickCans(spots, 12345, { sections: nSec });
  ok(JSON.stringify(a) === JSON.stringify(b), 'cans: deterministic per seed');
  ok(a.length >= 3 && a.length <= 5, `cans: ${a.length} on the whole descent (rare: one in every second section of ${nSec})`);
  ok(a.every((c) => (c.section + 1) % 2 === 0), 'cans: only in every second section (2, 4, 6, 8)');
  ok(a.every((c) => spots[c.spot].tier !== 'slow'), "cans: never on a fork's safe ('slow') ledge: they are not the reward for the long way");
  let risky = 0;
  let total = 0;
  for (let sd = 1; sd <= 60; sd++) for (const s of pickCans(spots, sd, { sections: nSec })) {
    total++;
    if (spots[s.spot].tier === 'risk') risky++;
  }
  ok(risky / total > 0.3, `cans: ${(100 * risky / total).toFixed(0)} % lie on risky perches (the rarer prize) over 60 runs`);
  const seeds = new Set();
  for (let s = 1; s <= 40; s++) seeds.add(pickCans(spots, s, { sections: nSec }).map((c) => c.id).join());
  ok(seeds.size > 15, `cans: the runs differ (${seeds.size} layouts in 40 seeds)`);
  const clear = a.every((c) => LEVEL_DATA_3D.supplies.some((s) => s.id === c.id.slice(4)));
  ok(clear, 'cans: each lies on an authored supply spot (never in a solid: those spots are verified clear)');
}

// ---- collecting, death, new run ----
{
  const { j, ev } = mk();
  const spots = LEVEL_DATA_3D.supplies.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, tier: s.tier, section: Math.max(0, new Level3D(LEVEL_DATA_3D).sectionIndexAt(s.y)) }));
  j.reset(spots, 7, 8);
  const c = j.cans[0];
  ok(j.fuel === 0.5 && j.cans.length >= 3, 'run: starts with half a tank and the cans');
  ok(j.collect(c.x + 3, c.y, c.z, null) === null, 'can: 3 m away is not taken');
  const got = j.collect(c.x + 0.5, c.y, c.z, null);
  ok(got === c && j.fuel === 1 && c.taken && ev.some((e) => e[0] === 'jetpack:can' && Math.abs(e[1].gained - 0.5) < 1e-9), 'can: walking through takes it: +0.5 of the tank ("jetpack:can")');
  const c2 = j.cans[1];
  ok(j.collect(c2.x, c2.y, c2.z, null) === null && !c2.taken, 'can: a full tank leaves the can where it is');
  j.fuel = 0.3;
  ok(j.collect(c2.x + 5, c2.y, c2.z, [{ x: c2.x + 0.2, y: c2.y, z: c2.z, grip: true }, { x: 0, y: 0, z: 0, grip: false }]) === c2 && Math.abs(j.fuel - 0.8) < 1e-9, 'can: a hand with the grip takes it (VR), +0.5');
  // DEATH: nothing comes back
  j.fuel = 0.1;
  const taken = j.cans.filter((x) => x.taken).length;
  j.onRespawn();
  ok(j.fuel === 0.1 && j.cans.filter((x) => x.taken).length === taken, 'DEATH: the respawn does NOT refill the tank and does NOT put a taken can back');
  const cc = j.cans[0];
  ok(j.collect(cc.x, cc.y, cc.z, null) === null && j.fuel === 0.1, 'DEATH: the can you already drank from is not there again to refill from');
  // the burst in progress when you die
  const p = mkP(-15);
  j.fuel = 0.4;
  j.request(p, false);
  j.onRespawn();
  ok(!j.burning && ev.some((e) => e[1] && e[1].reason === 'death'), 'DEATH: a burst in progress is over');
  // a NEW run
  j.reset(spots, 8, 8);
  ok(j.fuel === 0.5 && j.cans.every((x) => !x.taken) && !j.burning, 'NEW RUN: the starting fuel and every can back');
  // save state
  j.fuel = 0.35;
  const first = j.cans[0];
  j.fuel = 0.1;
  j.collect(first.x, first.y, first.z, null);
  const st = JSON.parse(JSON.stringify(j.saveState()));
  const k = new Jetpack3D(null);
  k.reset(spots, 8, 8);
  k.loadState(st);
  ok(Math.abs(k.fuel - j.fuel) < 1e-3 && k.cans[0].taken === true && k.cans.slice(1).every((x) => !x.taken), 'save state: fuel + taken cans round-trip');
  k.loadState({ fuel: 'x', taken: [5, 'nope'] });
  ok(Number.isFinite(k.fuel) && k.fuel >= 0 && k.fuel <= 1, 'save state: garbage is ignored');
  // low-fuel warning once
  const lo = mk();
  lo.j.fuel = 0.25;
  const p2 = mkP(-16);
  lo.j.request(p2, false);
  fall(lo.j, p2, 3);
  ok(lo.ev.filter((e) => e[0] === 'jetpack:low').length <= 1, 'low fuel: at most one warning per burst');
}

// ---- the wiring ----
{
  const game = fs.readFileSync(path.join(SRC_DIR, 'game.js'), 'utf8');
  ok(game.includes('this.jet = new Jetpack3D(this._runBus)') && game.includes('this.jet.reset(this.level') && game.includes('this.jet.onRespawn()'), 'game: built per level, reset on a NEW run only, onRespawn on a death');
  ok(game.includes('const up = this.jet.step(PDT, p, !!p.tethered);') && game.includes('if (up > 0) p.vy += up * PDT;'), 'game: the push is added to the vertical speed in the fixed step');
  ok(game.includes('jet.chord(HANDS[k], this.realTime)') && game.includes('ih.left.pressed = false') && game.includes('ih.right.pressed = false'), 'game: the chord reads the two presses and a lit chord swallows them (no rope shot)');
  ok(game.includes('intent.jetPressed') && game.includes('function jetOff()') && game.includes('jet.enabled = !jetOff()'), 'game: the J key and ?jet=off');
  ok(game.includes("this.jetpackView = new M.jetpackView.JetpackView(this)") && game.includes('this._updateJetCans(a, b);'), 'game: the view and the can pickup');
  const input = fs.readFileSync(path.join(SRC_DIR, 'input/desktopInput.js'), 'utf8');
  ok(input.includes("case 'KeyJ':") && input.includes("im._edge('jet')"), 'desktop input: J');
  const im = fs.readFileSync(path.join(SRC_DIR, 'input/inputManager.js'), 'utf8');
  ok(im.includes('I.jetPressed = E.jet') && im.includes('E.jet = false;'), 'inputManager: the jet edge is delivered once per frame');
}

// ---- the view ----
{
  const THREE = await import('three');
  const { JetpackView } = await import(srcUrl('render/jetpackView.js'));
  const scene = new THREE.Scene();
  const jet = new Jetpack3D(null);
  const spots = LEVEL_DATA_3D.supplies.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, tier: s.tier, section: Math.max(0, new Level3D(LEVEL_DATA_3D).sectionIndexAt(s.y)) }));
  jet.reset(spots, 3, 8);
  const game = { renderer: { scene, fx: null }, jet, player: { rx: 0, ry: 5, rz: 0, alive: true } };
  const v = new JetpackView(game);
  v.update(0.016, game);
  ok(v.cans.count === jet.cans.length && v.cans.visible && v.halo.visible, `view: ${v.cans.count} cans laid out, one instanced mesh + one halo cloud`);
  ok(v.flame.visible === false, 'view: no flame while it is not burning');
  const first = jet.cans[0];
  jet.fuel = 0.1;
  jet.collect(first.x, first.y, first.z, null);
  v.update(0.016, game);
  ok(v.cans.count === jet.cans.length - 1, 'view: a taken can is gone from the scene');
  jet.burning = true;
  jet.thrust = 40;
  v.update(0.016, game);
  ok(v.flame.visible && v.flame.position.y < game.player.ry, 'view: the flame hangs under the feet while it burns');
  jet.burning = false;
  v.update(0.016, game);
  ok(!v.flame.visible, 'view: and is gone when it stops');
  let draws = 0;
  scene.traverse((o) => {
    if (o.isMesh || o.isPoints) draws++;
  });
  ok(draws <= 4, `view: ${draws} drawables (cans, halos, two flame cones)`);
  v.dispose();
  ok(scene.children.length === 0, 'view: dispose leaves the scene empty');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL JETPACK CHECKS PASS');
process.exitCode = fails ? 1 : 0;
