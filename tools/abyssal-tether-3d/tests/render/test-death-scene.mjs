// The DEATH SCENES (sim/deathScene.js, render/deathOverlay.js, MasonRigView.cine, game.js _beginDeathScene / _applyDeathCam), Node, no GPU.
// Asked for: "If the user dies from a fall, the camera must go down like he is dead, and then slowly fade like his eyes are closing. And if he
// gets eaten by the mason, then the mason must come and show its face in the dark ... eats you in the most horrific way possible, with its
// eyes glowing red ... definitely R-rated: blood". Checks:
//   - sceneKind: impact / fall / hazard / dressed = collapse, a skitterling swarm = bitten, the Mason (or the Holdfast) = devour;
//   - COLLAPSE: the camera drops to a body's height (never below the floor: clamp to the eye - 0.28 m, a headset smaller, no roll / pitch in XR),
//     the lids stay open until ~1 s, close slowly with a FLUTTER (they try to open) and are shut (1.0, black 1.0) by the panel; monotone drop;
//   - DEVOUR: the world goes out (dark -> 1), the eyes ignite after 1.4 s, the face comes closer (dist falls), the jaw opens to 1, the lunge covers
//     the last 2.3 m, the bite slams it shut with blood on the lens (>= 0.9) and the view black, and it is all black by the panel (6.6 s);
//   - beats: in time order, each fired once, by the clock (60 / 144 fps give the same list); the scene may be skipped only after `skipAt`;
//     end() resets every field; determinism; non-finite dt / negative t are safe;
//   - the blood map: deterministic, 256 x 256, 3-35 % covered, with run-off streaks, a thicker core than rim;
//   - DeathOverlay: hidden with nothing to show, shows with lids or blood, uniforms follow the snapshot, dispose removes it;
//   - every beat has a sound (audio3d `case`), a caption (captions.js DEATH_BEAT_RULES, except 'down'), and the game wires it all.
//   node test-death-scene.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '../../../../public/abyssal-tether-3d');
const VENDOR = pathToFileURL(path.join(GAME, 'vendor/three/')).href;
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const src = (p) => pathToFileURL(path.join(GAME, 'src', p)).href;
const { DeathScene, sampleDeath, sceneKind, newSnapshot, lidCurve, KINDS, BEATS } = await import(src('sim/deathScene.js'));
const { DeathOverlay, makeBloodMap } = await import(src('render/deathOverlay.js'));
const { DEATH_BEAT_RULES, RULES } = await import(src('ui/captions.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const read = (p) => fs.readFileSync(path.join(GAME, 'src', p), 'utf8');

// ---- kinds ----
ok(sceneKind('impact') === 'collapse' && sceneKind('fall') === 'collapse' && sceneKind('hazard') === 'collapse' && sceneKind('dressed') === 'collapse', 'kinds: impact / fall / hazard / dressed play the collapse');
ok(sceneKind('creature', 'mason') === 'devour' && sceneKind('creature') === 'devour' && sceneKind('creature', 'skitter') === 'bitten', 'kinds: the Mason eats you, a swarm bites you');
ok(sceneKind('whatever') === 'collapse', 'kinds: an unknown cause plays the collapse');
for (const k of Object.keys(KINDS)) ok(KINDS[k].panelAt > KINDS[k].skipAt && KINDS[k].skipAt >= 1.2, `kinds: ${k} cannot be skipped in its first 1.2 s (skipAt ${KINDS[k].skipAt}) and ends at ${KINDS[k].panelAt} s`);

// ---- collapse ----
{
  const O = { xr: false, eye: 1.62 };
  const at = (t) => sampleDeath('collapse', t, O);
  let prev = -1;
  let mono = true;
  for (let t = 0; t <= 2; t += 0.02) {
    const d = at(t).camDrop;
    if (t < 0.9 && d < prev - 1e-6) mono = false;
    prev = d;
  }
  ok(mono, 'collapse: the camera drop never goes back up while it falls');
  const rest = at(1.2);
  ok(rest.camDrop > 1.1 && rest.camDrop <= 1.62 - 0.28 + 1e-9, `collapse: it comes to rest ${rest.camDrop.toFixed(2)} m down (never below ~0.28 m above the floor)`);
  ok(rest.camRoll > 0.6 && rest.camPitch < -0.2, `collapse: desktop rolls onto its side (${rest.camRoll.toFixed(2)} rad) and looks at the ground (${rest.camPitch.toFixed(2)})`);
  const xr = sampleDeath('collapse', 1.2, { xr: true, eye: 1.62 });
  ok(xr.camRoll === 0 && xr.camPitch === 0 && xr.camDrop > 0.5 && xr.camDrop < rest.camDrop, `collapse: a headset only drops (${xr.camDrop.toFixed(2)} m), no roll / pitch on a tracked head`);
  const low = sampleDeath('collapse', 1.2, { xr: false, eye: 0.7 });
  ok(low.camDrop <= 0.7 - 0.28 + 1e-9, `collapse: a short eye (0.7 m) drops only ${low.camDrop.toFixed(2)} m`);
  ok(at(0.5).lids === 0 && at(0.9).lids === 0, 'collapse: the lids are open while the camera falls');
  // slow close with a flutter
  let maxLids = 0;
  let flutter = false;
  let last = 0;
  for (let t = 1.0; t <= 4.0; t += 0.02) {
    const l = at(t).lids;
    if (l < last - 0.01 && l < 0.9) flutter = true;
    last = l;
    if (l > maxLids) maxLids = l;
  }
  ok(flutter, 'collapse: the lids flutter back open once on the way down (they try to stay awake)');
  ok(at(2.0).lids > 0.3 && at(2.0).lids < 0.8, `collapse: halfway through it the lids are half shut (${at(2.0).lids.toFixed(2)})`);
  ok(at(3.8).lids === 1 && at(KINDS.collapse.panelAt).black === 1, 'collapse: shut and black when the panel comes');
  ok(at(0.0).black === 0 && at(3.0).black === 0, 'collapse: the view is not black before the lids are nearly shut (the lids do the work)');
  ok(lidCurve(0) === 0 && lidCurve(1) === 1 && lidCurve(-3) === 0 && lidCurve(9) === 1, 'lidCurve: 0 .. 1 and clamped');
}

// ---- bitten ----
{
  const a = sampleDeath('bitten', 0.5, { eye: 1.62 });
  const c = sampleDeath('collapse', 0.5, { eye: 1.62 });
  ok(a.blood > 0.5 && c.blood === 0, `bitten: blood on the lens (${a.blood.toFixed(2)}), the collapse has none`);
  ok(sampleDeath('bitten', 2.4, { eye: 1.6 }).lids > 0.5 && sampleDeath('bitten', KINDS.bitten.panelAt, { eye: 1.6 }).black === 1, 'bitten: quicker lids, black at the panel');
  ok(sampleDeath('bitten', 3.0, { eye: 1.6 }).drip > sampleDeath('bitten', 1.0, { eye: 1.6 }).drip, 'bitten: the blood runs');
}

// ---- devour ----
{
  const O = { xr: false, eye: 1.62 };
  const at = (t) => sampleDeath('devour', t, O);
  ok(at(0.0).face.on === false && at(1.0).face.on === false && at(1.5).face.on === true, 'devour: nothing in the dark until 1.4 s, then the face');
  ok(at(1.0).dark > 0.85 && at(2.0).dark === 1, `devour: the world is out by ~1.2 s (dark ${at(1.0).dark.toFixed(2)} at 1 s)`);
  ok(at(1.3).face.eyes === 0 && at(2.6).face.eyes > 0.9, 'devour: the eyes ignite after the dark (flickering), then burn');
  let prev = 99;
  let closer = true;
  for (let t = 1.5; t <= 4.6; t += 0.02) {
    const d = at(t).face.dist;
    if (d > prev + 1e-9) closer = false;
    prev = d;
  }
  ok(closer, 'devour: the face only ever comes closer');
  ok(at(1.5).face.dist > 6 && at(3.95).face.dist < 2.7, `devour: it starts ~7 m away (${at(1.5).face.dist.toFixed(1)}) and is ~2.5 m off when the jaw is wide (${at(3.95).face.dist.toFixed(2)})`);
  ok(at(3.0).face.gape < 0.05 && at(4.2).face.gape === 1, 'devour: the jaw stays shut until 3 s, then opens to the full');
  ok(at(4.3).face.dist < 2 && at(4.45).face.dist < 0.9 && at(4.5).face.dist < 0.2, 'devour: the lunge: slow, then all at once');
  const bite = at(4.6);
  ok(bite.face.gape < 0.1 && bite.blood >= 0.9 && bite.black > 0.1, `devour: the bite: the jaw shut (${bite.face.gape.toFixed(2)}), blood on the lens (${bite.blood.toFixed(2)})`);
  ok(at(4.2).blood === 0 && at(4.2).camPitch > 0.2, 'devour: no blood until it bites; thrown on your back looking UP at it');
  ok(at(5.2).black > 0.85 && at(KINDS.devour.panelAt).black === 1, 'devour: black (under the blood) after the bite, all black at the panel');
  ok(at(5.2).drip > at(4.7).drip, 'devour: the blood runs down the lens');
  ok(at(2).shake < 0.2 && at(0.1).shake > 0.5 && at(4.5).shake > 0.4, 'devour: shaken by the blow and by the bite, still while it watches you');
  const xr = sampleDeath('devour', 3, { xr: true, eye: 1.6 });
  ok(xr.camRoll === 0 && xr.camPitch === 0 && xr.camDrop > 0.5, 'devour: a headset is dropped but not rolled');
}

// ---- beats, the clock, skip, end ----
{
  const run = (cause, killer, dt, o) => {
    const s = new DeathScene();
    s.begin(cause, Object.assign({ killer, eye: 1.62 }, o));
    const fired = [];
    for (let i = 0; i < 12 / dt; i++) {
      const b = s.update(dt);
      for (const n of b) fired.push(`${n}@${s.t.toFixed(1)}`);
    }
    return { s, fired };
  };
  for (const [cause, killer, kind] of [['impact', '', 'collapse'], ['creature', 'mason', 'devour'], ['creature', 'skitter', 'bitten']]) {
    const a = run(cause, killer, 1 / 60);
    const b = run(cause, killer, 1 / 144);
    const names = BEATS[kind].map((x) => x[0]);
    ok(names.every((t, i) => i === 0 || t >= names[i - 1]), `${kind}: the beat table is in time order`);
    ok(a.fired.length === BEATS[kind].length, `${kind}: every beat fires exactly once (${a.fired.length} of ${BEATS[kind].length})`);
    ok(a.fired.map((x) => x.split('@')[0]).join() === b.fired.map((x) => x.split('@')[0]).join(), `${kind}: the same beats at 60 and 144 fps`);
    ok(a.s.done && a.s.kind === kind, `${kind}: done after its time`);
    ok(BEATS[kind][BEATS[kind].length - 1][0] < KINDS[kind].panelAt, `${kind}: the last beat comes before the panel`);
  }
  const s = new DeathScene();
  s.begin('creature', { killer: 'mason', eye: 1.62 });
  s.update(1.0);
  ok(!s.skippable && !s.skip() && s.t < 1.1, 'skip: not in the first beats (a pressed button there is not a skip)');
  s.update(2.0);
  ok(s.skippable && !s.done, 'skip: possible from skipAt on');
  ok(s.skip() && s.done && s.s.black === 1, 'skip: jumps to the end (the panel shows)');
  s.end();
  const z = s.s;
  ok(!s.active && z.camDrop === 0 && z.lids === 0 && z.black === 0 && z.blood === 0 && z.dark === 0 && z.face.on === false && z.face.gape === 0, 'end(): every field back to nothing');
  ok(s.update(1).length === 0 && s.t === 0, 'end(): the clock does not run');
  s.begin('impact', { eye: 1.62 });
  s.update(Number.NaN);
  s.update(-5);
  s.update(Infinity);
  ok(Object.values(s.s).every((v) => typeof v !== 'number' || Number.isFinite(v)) || s.t === Infinity, 'bad dt: no NaN in the snapshot (negative / NaN ignored)');
  const snap = sampleDeath('devour', -1, { eye: 1.6 });
  ok(snap.camDrop === 0 && snap.lids === 0 && !snap.face.on, 'negative time: nothing');
  const r1 = JSON.stringify(sampleDeath('devour', 3.37, { eye: 1.62 }));
  const r2 = JSON.stringify(sampleDeath('devour', 3.37, { eye: 1.62 }));
  ok(r1 === r2, 'deterministic');
  ok(JSON.stringify(newSnapshot()) === JSON.stringify(newSnapshot()), 'newSnapshot is a plain value');
}

// ---- the blood map ----
{
  const m = makeBloodMap(7);
  const n = 256 * 256;
  ok(m.length === n * 4, 'blood map: 256 x 256 RGBA');
  let cov = 0;
  for (let i = 0; i < n; i++) if (m[i * 4] > 128) cov++;
  const frac = cov / n;
  ok(frac > 0.03 && frac < 0.35, `blood map: ${(frac * 100).toFixed(1)} % of the lens is covered`);
  ok(Buffer.compare(Buffer.from(m), Buffer.from(makeBloodMap(7))) === 0 && Buffer.compare(Buffer.from(m), Buffer.from(makeBloodMap(8))) !== 0, 'blood map: deterministic per seed, a different seed differs');
  // run-off: some column has a long vertical run of cover (a drip streak), longer than any blob's diameter would give
  let longest = 0;
  for (let x = 0; x < 256; x++) {
    let run = 0;
    for (let y = 0; y < 256; y++) {
      if (m[(y * 256 + x) * 4] > 128) {
        run++;
        if (run > longest) longest = run;
      } else run = 0;
    }
  }
  ok(longest >= 40, `blood map: it has run-off streaks (longest vertical run ${longest} px)`);
  let thick = 0;
  let thin = 0;
  for (let i = 0; i < n; i++) {
    if (m[i * 4] > 128) {
      if (m[i * 4 + 1] > 200) thick++;
      else thin++;
    }
  }
  ok(thick > 0 && thin > 0, 'blood map: thick cores and thin rims (two shades of red)');
}

// ---- the overlay ----
{
  const parent = new THREE.Object3D();
  const ov = new DeathOverlay(parent);
  ok(parent.children.includes(ov.mesh) && ov.mesh.visible === false && ov.mesh.renderOrder > 900 && ov.mesh.renderOrder < 950, 'overlay: child of the camera, hidden, drawn after the fade (900) and before the UI (950)');
  ov.update(null);
  ok(!ov.mesh.visible, 'overlay: null = hidden');
  ov.update({ lids: 0, blood: 0, drip: 0 });
  ok(!ov.mesh.visible, 'overlay: nothing to show = hidden (no draw call)');
  ov.update({ lids: 0.5, blood: 0, drip: 0 });
  ok(ov.mesh.visible && ov.material.uniforms.uLids.value === 0.5, 'overlay: lids show and the uniform follows');
  ov.update({ lids: 0, blood: 0.9, drip: 0.3 });
  ok(ov.mesh.visible && ov.material.uniforms.uBlood.value === 0.9 && ov.material.uniforms.uDrip.value === 0.3, 'overlay: blood shows alone');
  ov.update({ lids: 7, blood: -2, drip: 9 });
  ok(ov.material.uniforms.uLids.value === 1 && ov.material.uniforms.uBlood.value === 0 && ov.material.uniforms.uDrip.value === 1, 'overlay: values are clamped');
  ok(ov.material.depthTest === false && ov.material.transparent && ov.material.side === THREE.BackSide, 'overlay: no depth test, transparent, a sphere seen from inside (stereo-correct)');
  ov.dispose();
  ok(!parent.children.includes(ov.mesh), 'overlay: dispose removes it');
}

// ---- sound, captions, wiring ----
{
  const audio = read('audio/audio3d.js');
  const beats = new Set(Object.values(BEATS).flat().map((b) => b[1]));
  const body = audio.slice(audio.indexOf('_onDeathBeat(p) {'), audio.indexOf('// ---- triggers / creature'));
  for (const b of beats) {
    if (b === 'down') continue; // the impact's own sounds already play
    ok(body.includes(`case '${b}':`), `audio: beat '${b}' has its sound`);
    ok(DEATH_BEAT_RULES[b] && DEATH_BEAT_RULES[b].text.startsWith('['), `captions: beat '${b}' has a caption`);
  }
  ok(audio.includes("'death:beat': this._onDeathBeat"), 'audio: death:beat is routed');
  ok(read('ui/captions.js').includes("case 'death:beat'") && Object.keys(RULES).includes('dthBite'), 'captions: death:beat is mapped');
  const game = read('game.js');
  ok(game.includes("import { DeathScene } from './sim/deathScene.js'") && game.includes('_beginDeathScene(cause)') && game.includes('this._applyDeathCam()') && game.includes('this._endDeathScene()'), 'game: the scene begins on death, is applied after the rig and ends when the dead state is left');
  ok(game.includes('this.deathT - this.deathLead') && game.includes('get restoreClock()'), 'game: the restore / panel clock waits for the scene (deathLead)');
  ok(read('render/commsView.js').includes('g.restoreClock'), 'commsView: the CONTINUITY overlay runs on the restore clock');
  ok(read('render/fx.js').includes('new DeathOverlay(this.camera)') && read('render/fx.js').includes('game.deathSnap'), 'fx: the overlay is built with the fade and fed from game.deathSnap');
  ok(read('render/masonRigView.js').includes('  cine(o) {'), 'masonRigView: the cinematic hook exists');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
