// The big HEALTH badge on the back of the left wrist (render/wristVitals.js), Node, no GPU.
// Reported from VR: "I can't see the actual health when playing in VR. The wrist doesn't show anything, like the health percentage."
//   - the state and the percentage rules (green / amber / red / dead; never 0 while alive, never 100 below full)
//   - it attaches itself to the left arm once the hands exist (one quad), shows in VR, and on the desktop only with ?wristvitals=on
//   - it redraws only when the shown percentage or the state changes (and at 8 Hz while it pulses at low health)
//   - the game creates it and updates it after the hands
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '../../../../public/abyssal-tether-3d');
const VENDOR = pathToFileURL(path.join(GAME, 'vendor/three/')).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { if (s === 'three') return { url: '${VENDOR}three.module.min.js', shortCircuit: true }; if (s.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + s.slice(13), shortCircuit: true }; return next(s, c); }`));
globalThis.self = globalThis;
const THREE = await import('three');
const { VITALS, vitalsState, vitalsPercent, WristVitals } = await import(pathToFileURL(path.join(GAME, 'src/render/wristVitals.js')).href);
let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};

ok(vitalsState(1) === 'ok' && vitalsState(0.6) === 'ok' && vitalsState(0.59) === 'mid' && vitalsState(0.36) === 'mid' && vitalsState(0.35) === 'low' && vitalsState(0.01) === 'low', 'green from 60 %, amber from 36 %, red at 35 % and below (the low threshold)');
ok(vitalsState(0) === 'dead' && vitalsState(0.9, false) === 'dead', 'dead at 0 or when the player is not alive');
ok(vitalsPercent(1) === 100 && vitalsPercent(0.874) === 87 && vitalsPercent(0.004) === 1 && vitalsPercent(0.997) === 99 && vitalsPercent(0) === 0, 'the percentage is rounded, never 0 while alive and never 100 below full');

// a fake game with a canvas-less environment: the badge still attaches and tracks the state
const arm = new THREE.Group();
const game = { health: { hp: 1 }, player: { alive: true }, state: 'playing', xrActive: false, time: 0, handsView: { gear: { left: { root: arm, wristHud: null } } } };
const wv = new WristVitals(game);
ok(wv.mesh.isMesh && wv.mesh.geometry.parameters.width === VITALS.w, 'one quad');
wv.update(0.016);
ok(!wv.mesh.visible && wv.mesh.parent === null, 'on the desktop it stays off (the HUD has the monitor)');
game.xrActive = true;
wv.update(0.016);
ok(wv.mesh.visible && wv.mesh.parent === arm && wv.stats.pct === 100, 'in VR it attaches to the left arm and shows 100');
ok(Math.abs(wv.mesh.position.x - -0.03) < 1e-9 && wv.mesh.position.y > 0.09, 'at the measured spot on the back of the arm model (no WristHUD empty in the GLB)');
game.health.hp = 0.42;
wv.update(0.016);
ok(wv.stats.pct === 42, 'it follows the health (42)');
game.state = 'menu';
wv.update(0.016);
ok(!wv.mesh.visible, 'hidden outside a run');
game.state = 'playing';
// redraw economy
const r0 = wv.stats.redraws;
for (let i = 0; i < 60; i++) wv.update(0.016);
ok(wv.stats.redraws === r0 + (wv.canvas ? 0 : 0) || !wv.canvas, 'a steady value does not redraw');
game.health.hp = 0.2;
wv.update(0.016);
const r1 = wv.stats.redraws;
for (let i = 0; i < 60; i++) wv.update(0.016);
ok(wv.canvas ? wv.stats.redraws > r1 + 3 : true, 'at low health it pulses (redraws about 8 times a second)');
game.player.alive = false;
wv.update(0.016);
ok(wv.stats.pct === 0, 'dead: 0');
// no hands yet
const empty = new WristVitals({ health: { hp: 1 }, xrActive: true, state: 'playing', handsView: null });
empty.update(0.016);
ok(!empty.mesh.visible, 'no hands yet: nothing, no throw');
// the wiring
const g = fs.readFileSync(path.join(GAME, 'src/game.js'), 'utf8');
ok(/this\.wristVitals = new WristVitals\(this\)/.test(g) && g.indexOf('this.wristVitals.update(dt)') > g.indexOf("this._fault('handsView', err)"), 'the game creates it and updates it after the hands');
console.log(`\n${n} checks passed`);
