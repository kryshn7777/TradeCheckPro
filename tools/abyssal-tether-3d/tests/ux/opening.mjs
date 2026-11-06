// THE LANTERN: the opening cinematic (Node, no browser; docs/abyssal-tether-3d/plans/OPENING_V2_THE_COLLAR.md, OPENING_CINEMATIC.md).
//   sim/openingCinematic.js  the shots (contiguous, 75-95 s), continuity inside a shot and cuts only on a cue or through black, eased
//                            starts and stops, the hand-off (the last frame IS the spawn view), the skip (fade, land, end at the
//                            hand-off), a headset (no rotation ever, the vantage changes once and only behind black, no letterbox),
//                            determinism (no Math.random), the narration (clips exist, fit their slots, never overlap, no secrets)
//   audio/openingSfx.js      every cue has a designed sound; the whole score scheduled on a mock Web Audio context twice is identical,
//                            bounded and valid (finite, positive exponential targets, nothing scheduled outside the film)
//   settings                 openingCinematic on by default; the old storyIntro = false is kept off; the Display row
//   game wiring (source)     the headset branch of _applyOpeningCam never rotates; the old prologue is gone
//   node opening.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL, GAME_ROOT } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const O = await import(srcUrl('sim/openingCinematic.js'));
const A = await import(srcUrl('audio/openingSfx.js'));
const { SETTINGS_DEFAULTS, Storage, sanitizeUxSettings } = await import(srcUrl('sim/config3d.js'));

const ROOT = GAME_ROOT;
let fails = 0;
const ok = (c, msg, detail) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg + (detail !== undefined ? `  - ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''));
  if (!c) fails++;
};
const { SHOTS, CUES, VO, DURATION, SKIP_TO } = O;
const DT = 1 / 60;
const angd = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// ---- the shots -----------------------------------------------------------------------------------------------------------------
ok(DURATION >= 90 && DURATION <= 105, `the film runs ${DURATION} s (90-105)`);
{
  let good = SHOTS[0].t0 === 0 && SHOTS[SHOTS.length - 1].t1 === DURATION;
  for (let i = 0; i < SHOTS.length; i++) {
    if (!(SHOTS[i].t1 > SHOTS[i].t0)) good = false;
    if (i > 0 && SHOTS[i].t0 !== SHOTS[i - 1].t1) good = false;
    for (let k = 1; k < SHOTS[i].keys.length; k++) if (!(SHOTS[i].keys[k][0] > SHOTS[i].keys[k - 1][0])) good = false;
  }
  ok(good, `${SHOTS.length} shots, contiguous from 0 to the end, keys in order`);
  let cuesOk = true;
  for (let i = 1; i < CUES.length; i++) if (CUES[i][0] < CUES[i - 1][0]) cuesOk = false;
  ok(cuesOk && CUES[CUES.length - 1][1] === 'end' && CUES[CUES.length - 1][0] === DURATION, `${CUES.length} cues in time order, the last one is the end`);
}

// continuity: inside a shot nothing pops; a shot that starts on a cut does so on a cue or through black
{
  const s = O.newOpeningSnapshot();
  const prev = O.newOpeningSnapshot();
  O.sampleOpening(0, null, prev);
  let worst = { d: 0, a: 0, f: 0, at: 0 };
  let pops = 0;
  for (let i = 1; i <= DURATION * 60; i++) {
    const t = i * DT;
    O.sampleOpening(t, null, s);
    if (s.shot === prev.shot) {
      const d = Math.hypot(s.cam.x - prev.cam.x, s.cam.y - prev.cam.y, s.cam.z - prev.cam.z);
      const a = Math.max(angd(s.cam.yaw, prev.cam.yaw) * Math.cos(s.cam.pitch), angd(s.cam.pitch, prev.cam.pitch));
      const f = Math.abs(s.cam.fov - prev.cam.fov);
      if (d > worst.d) worst = Object.assign(worst, { d, at: t });
      if (a > worst.a) worst.a = a;
      if (f > worst.f) worst.f = f;
      if (d > 0.12 || a > 0.035 || f > 0.4) pops++;
    }
    O.sampleOpening(t, null, prev);
  }
  ok(pops === 0, 'inside every shot the camera moves smoothly (<= 0.12 m, 2 deg, 0.4 deg of lens a frame at 60 Hz)', { worstMove: +worst.d.toFixed(3), worstTurn: +worst.a.toFixed(4), worstLens: +worst.f.toFixed(3), at: +worst.at.toFixed(2) });
  const bad = [];
  for (let i = 1; i < SHOTS.length; i++) {
    const sh = SHOTS[i];
    O.sampleOpening(sh.t0, null, s);
    const onCue = CUES.some(([ct]) => Math.abs(ct - sh.t0) <= 0.1);
    if (!sh.cut || !(onCue || s.fade >= 0.9)) bad.push(sh.id);
  }
  ok(bad.length === 0, 'every shot change is a declared cut, on a cue of the sound sheet or through black', bad);
  // eased: a shot with fixed (world) keys starts and ends slower than it moves in the middle
  const slow = [];
  for (const sh of SHOTS) {
    if (sh.track || !sh.keys.every((k) => k[1].abs)) continue; // a tracking shot follows the moving cradle
    const sp = (t) => {
      const a = O.sampleOpening(t, null, O.newOpeningSnapshot()).cam;
      const b = O.sampleOpening(t + 0.05, null, O.newOpeningSnapshot()).cam;
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 0.05 + angd(a.yaw, b.yaw) / 0.05 + angd(a.pitch, b.pitch) / 0.05;
    };
    const mid = sp((sh.t0 + sh.t1) / 2);
    if (mid < 1e-4) continue;
    if (sp(sh.t0 + 0.02) > mid * 0.2 || sp(sh.t1 - 0.08) > mid * 0.2) slow.push(sh.id);
  }
  ok(slow.length === 0, 'moves are eased (a fixed-key shot starts and stops at under 20 % of its mid-shot speed: no linear robot moves)', slow);
}

// ---- THE COLLAR: the cradle, the drones, the iris, the light (v2) -------------------------------------------------------------------
{
  const at = (t) => O.sampleOpening(t, null, O.newOpeningSnapshot());
  // the cradle: on the iris, lifted, down the shaft at <= 1 m/s (the two cuts the only jumps, both downward), at rest on the ledge
  let fast = [];
  let up = false;
  for (let t = O.DESCENT_AT; t < DURATION; t += 0.02) {
    const a = O.cradleY(t);
    const b = O.cradleY(t + 0.02);
    const cutHere = (O.CUT1 > t && O.CUT1 <= t + 0.02) || (O.CUT2 > t && O.CUT2 <= t + 0.02);
    if (b > a + 1e-9) up = true;
    if (!cutHere && (a - b) / 0.02 > 1.0 + 1e-6) fast.push(+t.toFixed(2));
  }
  ok(!up && fast.length === 0, `the cradle descends at <= 1 m/s (${O.DESCENT_SPEED} m/s), never rises, jumps only at the cuts (${O.CUT1}, ${O.CUT2} s)`, fast.slice(0, 5));
  ok(Math.abs(O.cradleY(0) - (O.COLLAR.deckY + O.CRADLE_PLATE)) < 1e-9 && Math.abs(O.cradleY(O.LAND_AT) - O.CRADLE_LAND_Y) < 1e-9 && O.cradleY(O.LAND_AT - 0.05) - O.CRADLE_LAND_Y < 0.01, 'it stands on the deck, and settles on the Threshold at the landing (eased to rest)');
  const cx = O.CRADLE_X;
  const cz = O.CRADLE_Z;
  ok(cx > -11 + 1.7 && cx < 3 - 1.7 && cz > 4 + 1.7 && cz < 11 - 1.7 && Math.abs(cx + cz) / Math.SQRT2 > 2.5 && Math.hypot(cx - O.DEFAULT_HANDOFF.x, cz - O.DEFAULT_HANDOFF.z) < 1, 'the cradle line: on the Threshold ledge with the drones clear of its edges, 2.5 m clear of the diagonal girder at y 26, by the spawn');
  // the drones: on their pads, clamped to the cradle's corners from the clamp to the release, then only climbing
  let clampOk = true;
  let climbOk = true;
  for (let i = 0; i < 4; i++) {
    for (let t = O.CLAMPS[i]; t < O.RELEASES[i]; t += 0.5) {
      const s = at(t);
      const d = s.drones[i];
      if (!d.clamped || Math.abs(d.y - s.cradle.y - O.DRONE_UP) > 1e-6 || Math.abs(Math.abs(d.x - s.cradle.x) - O.DRONE_OUT) > 1e-6) clampOk = false;
    }
    let last = -1e9;
    for (let t = O.RELEASES[i] + 0.1; t < O.ACT3; t += 0.1) {
      const d = at(t).drones[i];
      if (d.y < last - 1e-9 || d.clamped) climbOk = false;
      last = d.y;
    }
  }
  ok(clampOk && climbOk, 'the four drones hold the cradle by its corners from the clamps to the release, then only climb');
  const dies = O.LIGHTS_DIE.map((t) => at(t + 0.6).drones.findIndex((d) => d.beam < 0.01 && d.led < 0.01));
  ok(at(O.BEAMS_AT + 1).drones.every((d) => d.beam > 0.9) && O.LIGHTS_DIE.every((t, i) => at(t + 0.6).drones[i].beam < 0.01 && at(t - 0.5).drones[i].beam > 0.5) && at(O.ACT3 + 0.1).drones.every((d) => !d.on), 'their lights come on over the shaft and die one by one on the climb home; then they are gone', dies);
  ok(at(O.IRIS_AT - 0.1).iris.open === 0 && at(O.IRIS_AT + 4.1).iris.open === 1 && at(O.SCAN_AT + 1).scan.a > 0.9 && at(O.SCAN_AT + 5).scan.a === 0, 'the iris opens under the lifted cradle; the measuring line sweeps it once');
  ok(at(5).collar.on && !at(O.CUT2 + 0.1).collar.on && at(70).line.on && !at(DURATION).line.on && !at(DURATION).cradle.on, 'the station is drawn only while it can be seen; the cradle and the line are gone at the waking (the memory does not come with you)');
  ok(/RETURN 0/.test(O.SCREEN.tag) && /PAYLOAD 1/.test(O.SCREEN.tag) && O.SCREEN.rows.includes('RETURN 0'), 'the replay\'s quiet fact on the console and the cradle tag: PAYLOAD 1 · RETURN 0');
  ok(at(5).rays === 0 && at(28).rays === 0 && at(O.CUT1 + 4.5).rays > 0.25 && at(O.DURATION).rays === 1, 'the level\'s light shafts are held off at the station and down the shaft, come in at THE WINDOW, and are whole at the hand-off');
  ok(at(36).dust.grit > 0.8 && at(5).dust.grit === 0 && at(5).dust.motes > 0.9 && at(O.LANTERN_OUT_AT + 1).dust.motes === 0, 'grit falls past the cradle on the way down; motes hang in the lantern\'s light; nothing once it is out');
  ok(at(10).dark < at(30).dark && at(30).dark > 0.9, 'the station is lit; once the iris opens the world is held dark and the lantern is the key');
}

// ---- the hand-off ---------------------------------------------------------------------------------------------------------------
for (const ho of [O.DEFAULT_HANDOFF, { x: -3.71, y: 1.83, z: 8.62, yaw: 0.3 }]) {
  const s = O.sampleOpening(DURATION, { handoff: ho }, O.newOpeningSnapshot());
  const c = s.cam;
  const same = Math.abs(c.x - ho.x) < 1e-6 && Math.abs(c.y - ho.y) < 1e-6 && Math.abs(c.z - ho.z) < 1e-6 && angd(c.yaw, ho.yaw) < 1e-9 && Math.abs(c.pitch) < 1e-9 && c.roll === 0 && c.fov === 70;
  ok(same, `the last frame is the spawn view (position, yaw ${ho.yaw}, pitch 0, no roll, the game's 70 deg lens)`, c);
  ok(s.fade === 0 && s.bars === 0 && s.dark === 0 && s.player.lantern === 1 && s.player.hands === 1 && !s.lantern.on && !s.mason.on && !s.cradle.on && !s.collar.on && s.drones.every((d) => !d.on) && s.title.a === 0 && s.caption.a === 0, 'and the frame is clean: no black, no bars, the world lit, your lantern burning, no prop, no cradle, no drone, no creature, no title');
  // the last second does not move (the hand-off cannot pop even a frame early)
  const a = O.sampleOpening(DURATION - 1, { handoff: ho }, O.newOpeningSnapshot()).cam;
  ok(Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z) < 1e-6 && Math.abs(a.pitch - c.pitch) < 0.002, 'the camera is already at rest a second before the hand-off');
}

// ---- the skip --------------------------------------------------------------------------------------------------------------------
for (const at of [0.6, 10, 40, 66.5]) {
  const ho = { x: -4, y: 2.1, z: 8.5, yaw: 0 };
  const op = new O.OpeningCinematic({ handoff: ho });
  while (op.t < at) op.update(DT);
  const took = op.skip();
  let wall = 0;
  let landed = false;
  let vo = 0;
  let maxFadeBefore = 0;
  while (!op.done && wall < 10) {
    const cues = op.update(DT);
    wall += DT;
    if (cues.includes('skipLand')) landed = true;
    vo += op.voStarted.length;
    if (!landed) maxFadeBefore = Math.max(maxFadeBefore, op.s.fade);
  }
  const c = op.s.cam;
  ok(took && landed && op.done && wall <= O.SKIP_FADE + (DURATION - SKIP_TO) + 0.1 && vo === 0, `a skip at ${at} s: a fade to black, then it lands on the waking and ends at the hand-off in ${wall.toFixed(2)} s, no narration after it`);
  ok(Math.hypot(c.x - ho.x, c.y - ho.y, c.z - ho.z) < 1e-6 && op.s.fade === 0 && maxFadeBefore > 0.99, 'the skipped film ends on the spawn view too (the jump itself hidden in black)');
}
{
  const op = new O.OpeningCinematic();
  op.seek(SKIP_TO + 0.5);
  ok(!op.skip(), 'too late to skip (already at the waking): refused');
}

// ---- a headset ---------------------------------------------------------------------------------------------------------------------
{
  const ho = { x: -4, y: 1.71, z: 8.5, yaw: 0, floor: 0.02 };
  const s = O.newOpeningSnapshot();
  const p = O.newOpeningSnapshot();
  O.sampleOpening(0, { xr: true, handoff: ho }, p);
  let jumps = 0;
  let unsafe = 0;
  let sideways = 0;
  let bars = 0;
  for (let i = 1; i <= DURATION * 60; i++) {
    O.sampleOpening(i * DT, { xr: true, handoff: ho }, s);
    const mv = Math.hypot(s.vr.x - p.vr.x, s.vr.y - p.vr.y, s.vr.z - p.vr.z);
    if (mv > 1.0 * DT + 1e-9) {
      jumps++;
      if (s.fade < 0.98 || p.fade < 0.98) unsafe++;
    } else if (Math.hypot(s.vr.x - p.vr.x, s.vr.z - p.vr.z) > 1e-9) sideways++;
    if (s.bars > 0) bars++;
    O.sampleOpening(i * DT, { xr: true, handoff: ho }, p);
  }
  ok(jumps === 3 && unsafe === 0 && sideways === 0, 'a headset rides the cradle: vertical only, <= 1 m/s; its three jumps (two cuts down the shaft, home to the spawn) happen in black', { jumps, unsafe, sideways });
  ok(bars === 0 && !('yaw' in s.vr) && !('pitch' in s.vr), 'a headset: no letterbox; the vantage carries no rotation');
  const top = O.sampleOpening(5, { xr: true, handoff: ho }, O.newOpeningSnapshot());
  const dz = top.lantern.z - top.vr.z;
  ok(dz < -0.4 && dz > -1.0 && Math.abs(top.vr.y - (top.cradle.y + ho.y - ho.floor)) < 1e-9, 'in the cradle at the station: your own eye height over its floor, the lantern 0.4-1.0 m straight ahead (-Z)', { dz: +dz.toFixed(2) });
  const end = O.sampleOpening(DURATION, { xr: true, handoff: ho }, O.newOpeningSnapshot());
  ok(end.vr.x === ho.x && end.vr.y === ho.y && end.vr.z === ho.z && end.fade === 0, 'a headset ends on the spawn too');
  const lunge = O.sampleOpening(O.LANTERN_OUT_AT, { xr: true, handoff: ho }, O.newOpeningSnapshot());
  ok(Math.hypot(lunge.mason.x - O.CRADLE_X, lunge.mason.z - O.CRADLE_Z) > 2.5, 'the lunge stops well short of a headset standing in the cradle');
}
{
  const src = fs.readFileSync(path.join(ROOT, 'src/game.js'), 'utf8');
  const i0 = src.indexOf('  _applyOpeningCam() {');
  const body = src.slice(i0, src.indexOf('\n  }\n', i0));
  const xrBranch = body.slice(body.indexOf('if (this.xrActive) {'), body.indexOf('} else {', body.indexOf('if (this.xrActive) {')));
  ok(i0 > 0 && xrBranch.length > 20 && !/rotation|quaternion|lookAt|fov/.test(xrBranch), 'game.js: the headset branch of _applyOpeningCam only translates the rig (no rotation, no lens)');
  const endBody = src.slice(src.indexOf('  _endOpening(skipped) {'), src.indexOf('\n  }\n', src.indexOf('  _endOpening(skipped) {')));
  ok(/!this\.xrActive\) this\._setLook/.test(endBody), 'game.js: the end of the film never turns a headset (the look is reset on the desktop only)');
  const sf = src.slice(src.indexOf('  _applySpeedFov() {'), src.indexOf('\n  }\n', src.indexOf('  _applySpeedFov() {')));
  ok(/\|\| this\.opening\) return/.test(sf), 'game.js: the speed-FOV kick leaves the lens alone while the film plays (each shot keeps its own FOV)');
  ok(/gr\.params\.gain = R\.rays;/.test(endBody), 'game.js: the end of the film gives the light shafts back their own gain');
  ok(!/prologue|Prologue|storyIntro/.test(src.replace(/storyIntro === false/g, '')), 'game.js: the old opening story (prologue) is gone');
  for (const f of ['src/sim/prologue3d.js', 'src/render/prologueView.js']) ok(!fs.existsSync(path.join(ROOT, f)), `${f} is deleted`);
}

// ---- determinism ---------------------------------------------------------------------------------------------------------------------
{
  const a = JSON.stringify(Array.from({ length: 200 }, (_, i) => O.sampleOpening(i * 0.421, { xr: i % 2 === 1 }, O.newOpeningSnapshot())));
  const b = JSON.stringify(Array.from({ length: 200 }, (_, i) => O.sampleOpening(i * 0.421, { xr: i % 2 === 1 }, O.newOpeningSnapshot())));
  ok(a === b, 'sampling is a pure function of t');
  for (const f of ['src/sim/openingCinematic.js', 'src/audio/openingSfx.js', 'src/render/openingView.js', 'src/render/collarView.js']) {
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // the code, not its comments
    ok(!/Math\.random|Date\.now|performance\.now/.test(txt), `${f}: no Math.random, no wall clock (designed, not random)`);
  }
  let finite = true;
  for (let i = 0; i <= DURATION * 30; i++) {
    const s = O.sampleOpening(i / 30, null, O.newOpeningSnapshot());
    for (const v of [s.cam.x, s.cam.y, s.cam.z, s.cam.yaw, s.cam.pitch, s.cam.fov, s.fade, s.dark, s.lantern.y, s.lantern.light, s.lantern.flame, s.mason.x, s.mason.fx]) if (!Number.isFinite(v)) finite = false;
    if (s.fade < 0 || s.fade > 1 || s.dark < 0 || s.dark > 1) finite = false;
  }
  ok(finite, 'every value is finite and every 0..1 stays in 0..1');
  ok(Math.abs(O.sampleOpening(60, null, O.newOpeningSnapshot()).lantern.y - O.LANTERN_REST_Y) < 0.01 && O.sampleOpening(20, null, O.newOpeningSnapshot()).lantern.y > 60, 'the lantern rides the cradle down the chimney and rests on the Threshold');
  let mono = true;
  for (let t = O.DESCENT_AT; t < O.LANTERN_STOP_AT; t += 0.05) if (O.sampleOpening(t + 0.05, null, O.newOpeningSnapshot()).lantern.y > O.sampleOpening(t, null, O.newOpeningSnapshot()).lantern.y + 1e-9) mono = false;
  ok(mono, 'it never rises on the way down (monotone)');
}

// ---- the narration --------------------------------------------------------------------------------------------------------------------
{
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/audio/opening/manifest.json'), 'utf8'));
  const missing = [];
  const long = [];
  for (const l of VO) {
    const e = man.lines[l.id];
    if (!e || !fs.existsSync(path.join(ROOT, 'assets/audio/opening', e.f)) || e.text !== l.text) missing.push(l.id);
    else if (!l.cut && e.d > l.slot + 0.05) long.push(`${l.id} ${e.d}>${l.slot}`);
    else if (l.cut && l.at + e.d < O.TEAR_AT - 0.6) long.push(`${l.id} ends before the tear`);
  }
  ok(missing.length === 0, `every line has its clip (assets/audio/opening/, the same text): ${VO.length} lines`, missing);
  ok(long.length === 0, 'every clip fits its slot (the torn line runs into the tear)', long);
  let overlap = false;
  for (let i = 1; i < VO.length; i++) if (VO[i].at < VO[i - 1].at + VO[i - 1].slot) overlap = true;
  ok(!overlap, 'no two lines overlap');
  ok(VO.every((l) => l.fx === 'radio' || l.fx === 'close') && VO.filter((l) => l.fx === 'radio').length >= 6, 'every line has its colour: the team on the uplink (radio) or the record (close)');
  const bytes = Object.values(man.lines).reduce((a, e) => a + e.bytes, 0);
  ok(bytes < 400000 && /AI placeholder/.test(man.disclosure || ''), `the clips are small (${(bytes / 1024).toFixed(0)} KB, precache core) and disclosed as AI placeholders`);
  const banned = /\b(restore|restored|copy|continuity|mason|dresser|fitting|still one|still flame|keeper|keepers|perennial|horror|evil|demon|scream|abyss|doom|nightmare)\b/i; // (v2: the crew may say his name)
  const leaks = VO.filter((l) => banned.test(l.text)).map((l) => l.id);
  ok(leaks.length === 0, 'the film gives nothing away (no creatures, no mechanism, no cheap shock words)', leaks);
  const cs = O.sampleOpening(O.TEAR_AT + 0.1, null, O.newOpeningSnapshot());
  ok(cs.caption.a === 0, 'the torn line\'s caption is torn off with it');
}

// ---- the sound -----------------------------------------------------------------------------------------------------------------------
function mockCtx() {
  const log = [];
  let bad = 0;
  const param = (name, v) => ({
    value: v,
    setValueAtTime(x, t) {
      if (!Number.isFinite(x) || !Number.isFinite(t)) bad++;
      log.push([name, 'set', +x.toFixed(6), +t.toFixed(6)]);
      return this;
    },
    linearRampToValueAtTime(x, t) {
      if (!Number.isFinite(x) || !Number.isFinite(t)) bad++;
      log.push([name, 'lin', +x.toFixed(6), +t.toFixed(6)]);
      return this;
    },
    exponentialRampToValueAtTime(x, t) {
      if (!(x > 0) || !Number.isFinite(t)) bad++;
      log.push([name, 'exp', +x.toFixed(6), +t.toFixed(6)]);
      return this;
    },
    setTargetAtTime(x, t, c) {
      if (!Number.isFinite(x) || !Number.isFinite(t) || !(c > 0)) bad++;
      log.push([name, 'tgt', +x.toFixed(6), +t.toFixed(6)]);
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
  });
  const node = (kind, extra) => Object.assign({ kind, connect() {}, disconnect() {} }, extra || {});
  const starts = [];
  const src = (kind, extra) =>
    node(kind, Object.assign(extra, {
      start(t) {
        if (!Number.isFinite(t)) bad++;
        starts.push([kind, +t.toFixed(5)]);
      },
      stop(t) {
        if (!Number.isFinite(t)) bad++;
      },
    }));
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    createBuffer: (ch, len, sr) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    },
    createGain: () => node('gain', { gain: param('gain', 1) }),
    createOscillator: () => src('osc', { type: 'sine', frequency: param('freq', 440) }),
    createBufferSource: () => src('buf', { buffer: null, loop: false, playbackRate: param('rate', 1) }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param('ffreq', 350), Q: param('q', 1) }),
    createStereoPanner: () => node('pan', { pan: param('pan', 0) }),
    createConvolver: () => node('conv', { buffer: null }),
    createWaveShaper: () => node('shaper', { curve: null }),
    decodeAudioData: async () => ctx.createBuffer(1, 4800, 48000),
  };
  return { ctx, log, starts, bad: () => bad };
}
{
  const proto = A.OpeningScore.prototype;
  const missing = [...new Set(CUES.map((c) => c[1]))].filter((n) => n !== 'end' && typeof proto['_cue_' + n] !== 'function');
  ok(missing.length === 0 && typeof proto._cue_skipLand === 'function', `every cue on the sheet has a designed sound (${new Set(CUES.map((c) => c[1])).size - 1} kinds)`, missing);
  const run = async () => {
    const m = mockCtx();
    const out = m.ctx.createGain();
    const sc = new A.OpeningScore(m.ctx, { score: out, sfx: out, voice: out });
    await sc.loadVoice('mock://', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    sc.scheduleAll(0);
    return m;
  };
  const a = await run();
  const b = await run();
  ok(a.bad() === 0, 'the whole score schedules valid automation (finite, exponential ramps to > 0, positive time constants)', a.bad());
  ok(JSON.stringify(a.log) === JSON.stringify(b.log) && JSON.stringify(a.starts) === JSON.stringify(b.starts), `the score is identical every time (${a.starts.length} sources, ${a.log.length} automation events)`);
  const late = a.starts.filter(([, t]) => t < 0 || t > DURATION + 1).length;
  ok(late === 0, 'nothing is scheduled outside the film');
  ok(a.starts.length < 2600, `bounded: ${a.starts.length} sources over ${DURATION} s`);
  const vo = a.starts.filter(([k]) => k === 'buf').length;
  ok(vo >= VO.length, 'the narration is scheduled with the score (offline render: the trailer)');
  const T = A.OPENING_TABLES;
  ok(T.ratchet.length > 10 && T.ratchet[T.ratchet.length - 1][0] < O.LAND_AT - O.DESCENT_AT && T.dust.length > 10 && T.grind.length > 10, `the fixed tables: ${T.ratchet.length} line ratchet ticks (all before the landing), ${T.dust.length} grit grains, ${T.grind.length} grinding grains`);
}

// ---- the setting -----------------------------------------------------------------------------------------------------------------------
{
  ok(SETTINGS_DEFAULTS.openingCinematic === true && !('storyIntro' in SETTINGS_DEFAULTS), 'Settings: Opening cinematic is on by default (it replaces Story intro)');
  const san = (o) => sanitizeUxSettings(Object.assign({}, o)).openingCinematic;
  ok(san({ openingCinematic: false }) === false && san({}) === true && san({ openingCinematic: 'x' }) === true, 'only an explicit false turns it off');
  mem.clear();
  Storage.set('settings', { storyIntro: false, lastDifficulty: 'normal' });
  ok(Storage.loadSettings().openingCinematic === false, 'a player who had switched Story intro off keeps the film off (the same localStorage key)');
  Storage.set('settings', { storyIntro: true });
  ok(Storage.loadSettings().openingCinematic === true, 'Story intro on: the film is on');
  Storage.set('settings', { storyIntro: false, openingCinematic: true });
  ok(Storage.loadSettings().openingCinematic === true, 'once the new setting is saved it wins');
  const ui = fs.readFileSync(path.join(ROOT, 'src/ui/ui3d.js'), 'utf8');
  ok(/key: 'openingCinematic', tab: 'display'/.test(ui) && !/storyIntro/.test(ui), 'the Display page has the Opening cinematic row (Story intro is gone)');
}

console.log(fails ? `\n${fails} check(s) failed` : '\nopening: all checks pass');
process.exitCode = fails ? 1 : 0;
