// PUZZLE FOCUS in the real game (docs/abyssal-tether-3d/plans/PUZZLE_FOCUS.md), one headless Chromium (software GL: slow, the first render
// compiles for 25-40 s). Run it alone: flock /tmp/at3d-browser.lock node tools/abyssal-tether-3d/release/test-puzzle-focus.mjs [--out DIR]
//   1. Chapter I, S1: the player stands 5 m from the bell with the bell BEHIND them (yaw turned away); a few sim seconds later the view has
//      turned toward it (the yaw within 15 degrees of the bell's bearing), a focus line went to the radio (comms log), focus:look and
//      focus:ping were emitted, the glow is on; before / after stills.
//   2. any look input cancels it: the same in S2 (the counterweight) with a mouse-like yaw change mid-turn: the view stays where the player
//      put it.
//   3. ?focus=cues: the line and the cues, the view never turns.
// Exit code 1 on a failure. Stills: <out>/focus-before.png, focus-after.png, focus-s2-cancel.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { argValue, REPO_ROOT } from '../verify/root.mjs';
import { createStaticServer } from './lib/server.mjs';
import { launch, newPage, until, makeChecker } from './lib/browser.mjs';

const OUT = path.resolve(argValue(process.argv.slice(2), '--out', path.join(os.tmpdir(), 'at3d-puzzle-focus')));
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(REPO_ROOT, 'public/abyssal-tether-3d');
const { check, finish } = makeChecker('PUZZLE FOCUS (browser)');
const Q = '?sw=0&gov=off&perfdiag=off&watchdog=off&intro=off';

const srv = await createStaticServer({ root: ROOT, prefix: '/', prodHeaders: false }).start();
const browser = await launch();
try {
  // ---------------------------------------------------------------- 1 + 2: auto (desktop) ----------------------------------------------
  const page = await newPage(browser);
  await page.goto(srv.base + Q, { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted)), { timeout: 240000, label: 'boot' });
  const setup = await page.evaluate(() => {
    const G = window.AT3D.game;
    const D = window.AT3D.debug;
    window.__focus = { look: [], ping: [] };
    G.bus.on('focus:look', (e) => window.__focus.look.push({ x: e.x, y: e.y, z: e.z, t: e.t, id: e.id, step: e.step }));
    G.bus.on('focus:ping', (e) => window.__focus.ping.push({ x: e.x, y: e.y, z: e.z }));
    G.start('normal');
    D.step(0.5, { render: false, state: false });
    // the opening radio chain would keep a beat waiting (a story line on air): skip it, as the continue input does
    if (G.comms) G.comms.skipOpening();
    const pf = G.puzzleFocus;
    const bell = pf.trigger.puzzles.find((p) => p.type === 'bell');
    pf.trigger.aim(bell, 0, 0, 0);
    // stand on the grating 5 m from the bell's bearing, the bell BEHIND (yaw pointing away from it)
    const p = G.player;
    const bx = bell.x;
    const bz = bell.z;
    p.x = p.prevX = p.rx = bx;
    p.z = p.prevZ = p.rz = bz + 4.2;
    p.vx = p.vy = p.vz = 0;
    D.step(1.2, { render: false, state: false }); // settle on the floor
    const awayYaw = Math.atan2(-(p.x - bx), -(p.z - bz)); // looking from the bell through the player: the bell is behind
    G._setLook(awayYaw, 0);
    pf.debugReady();
    D.step(1 / 60, { render: true, state: false });
    return { bell: { x: bell.x, y: bell.y, z: bell.z }, player: { x: p.x, y: p.y, z: p.z }, yaw0: G.renderer.rig.rotation.y, mode: pf.mode, puzzles: pf.trigger.puzzles.length };
  });
  console.log('setup', JSON.stringify(setup));
  await page.screenshot({ path: path.join(OUT, 'focus-before.png') });
  const after = await page.evaluate(() => {
    const G = window.AT3D.game;
    const D = window.AT3D.debug;
    const st0 = D.focus.state();
    const trace = [];
    for (let i = 0; i < 40; i++) {
      D.step(1 / 30, { render: false, state: false });
      trace.push({ yaw: +G.renderer.rig.rotation.y.toFixed(3), pitch: +G.renderer.camera.rotation.x.toFixed(3), st: D.focus.state().state });
    }
    D.step(1 / 60, { render: true, state: false });
    const st = D.focus.state();
    const cm = D.comms.state();
    return { st0, st, trace, yaw: G.renderer.rig.rotation.y, pitch: G.renderer.camera.rotation.x, eye: G.renderer.camera.matrixWorld.elements.slice(12, 15), comms: cm, ev: window.__focus, glow: G.puzzleFocus._view ? G.puzzleFocus._view.mesh.visible : false };
  });
  await page.screenshot({ path: path.join(OUT, 'focus-after.png') });
  console.log('trace', JSON.stringify(after.trace.filter((_, i) => i % 4 === 0)));
  console.log('focus', JSON.stringify(after.st));
  const b = setup.bell;
  const bearing = Math.atan2(-(b.x - after.eye[0]), -(b.z - after.eye[2]));
  const off = Math.abs(Math.atan2(Math.sin(after.yaw - bearing), Math.cos(after.yaw - bearing)));
  const startOff = Math.abs(Math.atan2(Math.sin(setup.yaw0 - bearing), Math.cos(setup.yaw0 - bearing)));
  check('a focus beat fired for the bell (first sight within 6 m, behind the player)', after.st.log.some((l) => l.type === 'bell'), JSON.stringify(after.st.log));
  check(`the view turned toward the bell: ${((startOff * 180) / Math.PI).toFixed(0)} deg off -> ${((off * 180) / Math.PI).toFixed(1)} deg off`, startOff > 2 && off < (15 * Math.PI) / 180);
  check('it panned (not cancelled), only yaw / pitch moved', after.st.stats.panned >= 1 && !after.st.cancelled);
  const lineId = (after.st.log.find((l) => l.type === 'bell') || {}).line;
  const said = after.comms.on && (after.comms.log.some((l) => l.id === lineId) || (after.comms.current && after.comms.current.id === lineId) || after.comms.queue.indexOf(lineId) >= 0);
  check(`a comms line suggests it (${lineId}: ${after.comms.current ? after.comms.current.speaker + ' "' + after.comms.current.text + '"' : 'logged'})`, !!lineId && said);
  check('focus:look + focus:ping emitted at the bell', after.ev.look.length >= 1 && after.ev.ping.length >= 1 && Math.abs(after.ev.ping[0].x - b.x) < 1e-6);
  check('the gaze guide glow is drawn', after.glow === true);

  // ---- 2. cancel by look input (S2, the counterweight) ----
  const cancel = await page.evaluate(() => {
    const G = window.AT3D.game;
    const D = window.AT3D.debug;
    D.warp(1);
    D.step(0.5, { render: false, state: false });
    const pf = G.puzzleFocus;
    const cw = pf.trigger.puzzles.find((p) => p.type === 'haul');
    pf.trigger.aim(cw, 0, 0, 0);
    const p = G.player;
    const e = G.renderer.camera.matrixWorld.elements;
    const d = Math.hypot(cw.x - e[12], cw.y - e[13], cw.z - e[14]);
    // look the other way, then let the beat start and move the "mouse" 4 frames in
    const away = Math.atan2(-(p.x - cw.x), -(p.z - cw.z));
    G._setLook(away, 0);
    pf.debugReady();
    pf.trigger.lastBeat = -1e9;
    let started = false;
    let yawAtInput = 0;
    for (let i = 0; i < 240 && !started; i++) {
      D.step(1 / 60, { render: false, state: false });
      started = D.focus.state().state === 'TURN';
    }
    if (started) {
      for (let i = 0; i < 4; i++) D.step(1 / 60, { render: false, state: false });
      yawAtInput = G.renderer.rig.rotation.y + 0.05; // the player's own look input
      G._setLook(yawAtInput, G.renderer.camera.rotation.x);
      for (let i = 0; i < 60; i++) D.step(1 / 60, { render: false, state: false });
    }
    D.step(1 / 60, { render: true, state: false });
    return { dist: d, started, yawAtInput, yaw: G.renderer.rig.rotation.y, st: D.focus.state() };
  });
  await page.screenshot({ path: path.join(OUT, 'focus-s2-cancel.png') });
  console.log('cancel', JSON.stringify({ dist: cancel.dist, started: cancel.started, yawAtInput: cancel.yawAtInput, yaw: cancel.yaw, cancelled: cancel.st.cancelled, log: cancel.st.log.slice(-2) }));
  check(`S2 counterweight (${cancel.dist.toFixed(1)} m): a beat started`, cancel.started);
  check('look input mid-turn cancels it: the view stays where the player put it', cancel.started && cancel.st.cancelled === 'input' && Math.abs(cancel.yaw - cancel.yawAtInput) < 1e-6);
  check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.close();

  // ---------------------------------------------------------------- 3: ?focus=cues ----------------------------------------------------
  const p2 = await newPage(browser);
  await p2.goto(srv.base + Q + '&focus=cues', { waitUntil: 'domcontentloaded' });
  await until(() => p2.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted)), { timeout: 240000, label: 'boot (cues)' });
  const cues = await p2.evaluate(() => {
    const G = window.AT3D.game;
    const D = window.AT3D.debug;
    G.start('normal');
    D.step(0.5, { render: false, state: false });
    if (G.comms) G.comms.skipOpening();
    const pf = G.puzzleFocus;
    const bell = pf.trigger.puzzles.find((p) => p.type === 'bell');
    pf.trigger.aim(bell, 0, 0, 0);
    const p = G.player;
    p.x = p.prevX = p.rx = bell.x;
    p.z = p.prevZ = p.rz = bell.z + 4.2;
    p.vx = p.vy = p.vz = 0;
    D.step(1.2, { render: false, state: false });
    G._setLook(Math.atan2(-(p.x - bell.x), -(p.z - bell.z)), 0);
    const y0 = G.renderer.rig.rotation.y;
    pf.debugReady();
    for (let i = 0; i < 90; i++) D.step(1 / 60, { render: false, state: false });
    return { mode: pf.mode, y0, y1: G.renderer.rig.rotation.y, st: D.focus.state() };
  });
  check(`?focus=cues: a beat (${cues.st.log.map((l) => l.line).join(', ')}), the view never turns`, cues.mode === 'cues' && cues.st.stats.beats >= 1 && cues.y0 === cues.y1 && cues.st.stats.panned === 0);
  check('no page errors (cues)', p2.errors.length === 0, p2.errors.slice(0, 3).join(' | '));
  await p2.close();
} finally {
  await browser.close();
  await srv.stop();
}
console.log('stills in', OUT);
process.exitCode = finish();
