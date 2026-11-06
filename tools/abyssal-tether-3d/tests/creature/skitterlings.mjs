// THE SKITTERLINGS, ONE SPECIES (docs/abyssal-tether-3d/plans/SKITTERLINGS.md): the hunter skitterlings (sim/skitter3d.js, the ones that
// bite) are drawn as the same red cockroach as the swarm skitterlings (sim/roaches.js, the tiny harmless ones), bigger and meaner.
//   - the shared model + shader (render/skitterlingModel.js): the hunter view's far LOD IS the swarm's model, one shader source for both tiers,
//     the hunter's LOD0 in budget (150-250 triangles), six legs whose tripods alternate (L1 R2 L3 against R1 L2 R3), the antennae, the cerci;
//   - the hunter view (render/skitterlingView.js) on the REAL sim on the REAL level: one instance per hunter in play, <= 2 draw calls, the
//     frame on the sim's head (orthonormal, up = the dorsal normal), on the wall under the head, the gait clock runs with the speed; the
//     attack reads: the wind-up rears it up, the strike throws it off the wall; deterministic; zero allocation per frame; CPU per frame;
//   - names: no user-visible "roach" left in src (settings, captions, any prose string), the setting key 'roaches' still works (an old saved
//     roaches:false still hides the swarm), AT3D.debug.skitterlings with AT3D.debug.roaches as the same object, the hunter wiring in game.js
//     (no Mason-rig clones, no skitter_rig.glb), no toon / outline, no Math.random.
//   node skitterlings.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { register } from 'node:module';
import { srcUrl, SRC_DIR, VENDOR_THREE_URL } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');
const THREE = await import('three');
const MODEL = await import(srcUrl('render/skitterlingModel.js'));
const { SkitterlingView, HUNTER, HUNTER_TRIS, poseTargets } = await import(srcUrl('render/skitterlingView.js'));
const { RoachView, roachContext } = await import(srcUrl('render/roachView.js'));
const { Roaches, makeRoachCtx } = await import(srcUrl('sim/roaches.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus, Storage, SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
const { CREATURE_TUNING, CREATURE_VARIANTS } = await import(srcUrl('sim/creature3d.js'));
const { SkitterGroup } = await import(srcUrl('sim/skitter3d.js'));
const { RULES, CAPTION_EVENTS, captionForEvent } = await import(srcUrl('ui/captions.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');

// ---------------------------------------------------------------------------------------------------------------------------------------
// 1. one species: the shared model and shader
// ---------------------------------------------------------------------------------------------------------------------------------------
const swarm = MODEL.buildSwarmGeometry();
const hunter = MODEL.buildHunterGeometry();
const tris = (g) => g.index.count / 3;
{
  ok(tris(swarm) === MODEL.SWARM_TRIS && MODEL.SWARM_TRIS === 27, `swarm skitterling: ${tris(swarm)} triangles (unchanged)`);
  ok(HUNTER_TRIS === tris(hunter) && HUNTER_TRIS >= 150 && HUNTER_TRIS <= 250, `hunter skitterling LOD0: ${HUNTER_TRIS} triangles (150-250)`);
  const scene = new THREE.Scene();
  const v = new SkitterlingView(scene);
  const rv = new RoachView({ renderer: { scene: new THREE.Scene() } });
  const same = (a, b, name) => {
    const x = a.getAttribute(name).array;
    const y = b.getAttribute(name).array;
    return x.length === y.length && x.every((q, i) => q === y[i]);
  };
  const far = v.lods[1].geometry;
  ok(['position', 'normal', 'aRig'].every((n) => same(far, swarm, n)) && same(far, rv.mesh.geometry, 'position'), 'the hunter view\'s far LOD is the swarm\'s model, vertex for vertex (and the swarm view draws that same model)');
  ok(['position', 'normal', 'aRig'].every((n) => same(v.lods[0].geometry, hunter, n)), 'the hunter view\'s near LOD is buildHunterGeometry()');
  ok(v.lods[0].material === v.lods[1].material && v.material.vertexShader === rv.material.vertexShader && v.material.fragmentShader === rv.material.fragmentShader, 'one shader source for both tiers (the hunter view: one material for both LODs)');
  ok(v.material.defines && 'HUNTER' in v.material.defines && !(rv.material.defines && 'HUNTER' in rv.material.defines), 'the HUNTER define (rear-up, lunge, glint) only on the hunters');
  ok(v.material.uniforms.uLanternW === rv.material.uniforms.uLanternW && v.material.fog && rv.material.fog, 'the same lantern uniforms (by reference) and the level\'s haze');
  // the tripod: per leg (part 2 + 0.1 x pair, side), one phase; L1 R2 L3 share one, R1 L2 R3 the other, PI apart
  const legPhases = (g) => {
    const r = g.getAttribute('aRig');
    const m = new Map();
    let bad = false;
    for (let i = 0; i < r.count; i++) {
      const part = r.getX(i);
      if (part < 1.5 || part > 2.5) continue;
      const key = Math.round((part - 2) * 10) + ':' + r.getW(i);
      if (m.has(key) && Math.abs(m.get(key) - r.getZ(i)) > 1e-6) bad = true;
      m.set(key, r.getZ(i));
    }
    return { m, bad };
  };
  for (const [name, g] of [['hunter', hunter], ['swarm', swarm]]) {
    const { m, bad } = legPhases(g);
    const A = ['0:-1', '1:1', '2:-1'].map((k) => m.get(k));
    const B = ['0:1', '1:-1', '2:1'].map((k) => m.get(k));
    const alt = A.every((x) => x === A[0]) && B.every((x) => x === B[0]) && Math.abs(Math.abs(A[0] - B[0]) - Math.PI) < 1e-6;
    ok(m.size === 6 && !bad && alt, `${name}: six legs in two alternating tripods (L1 R2 L3 at ${A[0]}, R1 L2 R3 at ${B[0].toFixed(3)})`);
  }
  ok(MODEL.tripodPhase(0, -1) === MODEL.tripodPhase(1, 1) && MODEL.tripodPhase(1, 1) === MODEL.tripodPhase(2, -1) && MODEL.tripodPhase(0, 1) !== MODEL.tripodPhase(0, -1), 'tripodPhase(): the alternation');
  // the parts: carapace, head (+ cerci), legs, antennae; the antennae reach well ahead, the cerci behind the shield
  const r = hunter.getAttribute('aRig');
  const p = hunter.getAttribute('position');
  let antZ = -9;
  let backZ = 9;
  let legsW = 0;
  const parts = new Set();
  for (let i = 0; i < r.count; i++) {
    const part = r.getX(i);
    parts.add(Math.floor(part));
    if (part > 2.5) antZ = Math.max(antZ, p.getZ(i));
    if (part > 0.5 && part < 1.5) backZ = Math.min(backZ, p.getZ(i));
    if (part > 1.5 && part < 2.5) legsW = Math.max(legsW, Math.abs(p.getX(i)));
  }
  ok(parts.size === 4 && antZ > 1.3 && backZ < -0.6 && legsW > 0.5, `hunter anatomy: antennae to z ${antZ.toFixed(2)} (long, fine), cerci to z ${backZ.toFixed(2)}, legs splayed ${legsW.toFixed(2)} wide`);
  // no eyes: the glint is a faint sheen term, not an emissive pair
  const fs0 = MODEL.SKITTERLING_FRAG;
  const m = /col \+= vec3\(([0-9.]+), ([0-9.]+), ([0-9.]+)\) \* vGlint/.exec(fs0);
  ok(m && +m[1] <= 0.15 && +m[2] < 0.02 && !/eye/i.test(fs0.replace(/\/\/[^\n]*/g, '')), 'a faint red glint on the head (<= 0.15), no eyes: the Mason\'s two red eyes stay its own');
  const srcs = ['render/skitterlingModel.js', 'render/skitterlingView.js', 'render/roachView.js'].map(read);
  ok(srcs.every((s) => !/injectToon|atToon|outline\.js|makeOutline|toonChunk/.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''))), 'no toon bands, no ink outlines in the skitterling views (the realistic shading pass)');
  ok(srcs.every((s) => !/Math\.random\s*\(/.test(s)), 'no Math.random in the skitterling views');
  v.dispose();
  ok(scene.children.length === 0, 'the hunter view disposes out of the scene');
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// 2. the hunter view on the real sim (Nightmare S7: three hunters, a stationary player)
// ---------------------------------------------------------------------------------------------------------------------------------------
const K = 'nightmare';
const level = new Level3D(LEVEL_DATA_3D, DIFFICULTY[K].levelVariant);
const cp = level.sections[6].checkpoint;
const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
cam.position.set(cp.x, cp.y + 0.6, cp.z);
cam.updateMatrixWorld(true);

function run(seed, secs, onFrame) {
  const g = new SkitterGroup(level, DIFFICULTY[K], new EventBus(), { seed });
  const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
  g.setSection(6, p);
  const v = new SkitterlingView(new THREE.Scene());
  for (let i = 0; i < secs * 60; i++) {
    g.update(1 / 60, p, i / 60);
    g.takeDamage();
    g.takeGripDamage();
    v.update(g, 1 / 60, cam, 'quest');
    if (onFrame) onFrame(g, v, i);
  }
  return { g, v };
}
{
  let maxShown = 0;
  let maxCalls = 0;
  let maxTris = 0;
  let frameOk = true;
  let placeOk = true;
  let countOk = true;
  let rearSeen = 0;
  let leapSeen = 0;
  let windups = 0;
  let strikes = 0;
  let gaitMoving = 0;
  let gaitMovingN = 0;
  let worstPlace = 0;
  const lastPh = new Float64Array(4);
  const col = (e, o, c) => [e[o + c * 4], e[o + c * 4 + 1], e[o + c * 4 + 2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const { g } = run(5, 90, (g, v) => {
    const vis = g.slots.filter((c) => c.on && c.body.visible).length;
    if (v.stats.shown !== vis) countOk = false;
    maxShown = Math.max(maxShown, v.stats.shown);
    maxCalls = Math.max(maxCalls, v.stats.calls);
    maxTris = Math.max(maxTris, v.stats.triangles);
    // the frames of LOD0 / LOD1 instances: orthonormal, scaled by HUNTER.len
    let k0 = 0;
    let k1 = 0;
    for (let i = 0; i < g.slots.length; i++) {
      const c = g.slots[i];
      if (!c.on || !c.body.visible) continue;
      const lod = v.lod[i];
      const m = v.lods[lod];
      const k = lod === 0 ? k0++ : k1++;
      const e = m.instanceMatrix.array;
      const o = k * 16;
      const X = col(e, o, 0);
      const Y = col(e, o, 1);
      const Z = col(e, o, 2);
      const s = HUNTER.len;
      if (Math.abs(len(X) - s) > 1e-5 || Math.abs(len(Y) - s) > 1e-5 || Math.abs(len(Z) - s) > 1e-5 || Math.abs(dot(X, Y)) > 1e-5 || Math.abs(dot(Y, Z)) > 1e-5 || Math.abs(dot(X, Z)) > 1e-5) frameOk = false;
      const h = c.body.head;
      // off the attack: the up axis is the dorsal normal, the body lies `hug` under the head point
      if (v.rear[i] < 1e-3 && v.leap[i] < 1e-3) {
        const u = [h.ux, h.uy, h.uz];
        if (dot(Y, u) / s < 0.999) frameOk = false;
        const hug = CREATURE_TUNING.hug * c.body.size;
        // the model's head point (z = headZ) under the sim's head
        const hx = e[o + 12] + (Z[0] * HUNTER.headZ) + u[0] * hug;
        const hy = e[o + 13] + (Z[1] * HUNTER.headZ) + u[1] * hug;
        const hz = e[o + 14] + (Z[2] * HUNTER.headZ) + u[2] * hug;
        const d = Math.hypot(hx - h.x, hy - h.y, hz - h.z);
        worstPlace = Math.max(worstPlace, d);
        if (d > 2e-3) placeOk = false; // float32 instance matrices at world coordinates of a few hundred metres, and an easing tail of the rear
      }
      const a = c.attack;
      if (c.state === 'ATTACK' && a.phase === 'windup' && a.t > a.windup * 0.6) {
        windups++;
        if (v.rear[i] > 0.6) rearSeen++;
      }
      if (c.state === 'ATTACK' && a.phase === 'strike') {
        strikes++;
        if (v.leap[i] > 0.99) leapSeen++;
      }
      if (c.speed > 2) {
        gaitMovingN++;
        if (v.ph[i] !== lastPh[i]) gaitMoving++;
      }
      lastPh[i] = v.ph[i];
    }
  });
  ok(countOk && maxShown === 3, `one instance per hunter in play, every frame (up to ${maxShown} at once on Nightmare S7)`);
  ok(maxCalls <= 2 && maxTris <= 3 * HUNTER_TRIS, `budget: at most ${maxCalls} draw calls and ${maxTris} triangles (mono) for every hunter: ${2 * maxTris} stereo (was ~7 calls and ~40 k stereo triangles EACH as Mason-rig clones)`);
  ok(frameOk, 'each instance an orthonormal frame scaled to the hunter, its up axis on the sim\'s dorsal normal');
  ok(placeOk, `on the wall under the sim's head point (hug ${(CREATURE_TUNING.hug * 0.45).toFixed(2)} m), its head where the sim's head is (worst ${worstPlace.toExponential(1)} m)`);
  ok(windups > 0 && rearSeen === windups, `the wind-up reads as a rear-up: ${rearSeen} / ${windups} late wind-up frames reared > 0.6`);
  ok(strikes > 0 && leapSeen === strikes, `the strike throws it off the wall at you: ${leapSeen} / ${strikes} strike frames at full leap`);
  ok(gaitMovingN > 0 && gaitMoving === gaitMovingN, `the tripod's clock runs whenever it runs (${gaitMoving} / ${gaitMovingN} moving frames)`);
  ok(g.hits >= 1, `the sim is untouched by the view (${g.hits} bite(s) on the stationary player in 90 s, as skitter.mjs)`);
  ok(Math.abs(CREATURE_VARIANTS.skitterling.scale - 0.45) < 1e-12 && CREATURE_VARIANTS.skitterling.speedMul === 4.5, 'the hunter sim\'s variant numbers stay (0.45, 4.5x)');
}
// poseTargets: the pure attack -> pose mapping
{
  const P = { rear: 0, leap: 0 };
  const c = { state: 'ATTACK', attack: { phase: 'windup', t: 0.5, windup: 0.5 } };
  poseTargets(c, P);
  const r1 = P.rear;
  c.attack.t = 0.1;
  poseTargets(c, P);
  const r0 = P.rear;
  c.attack.phase = 'strike';
  poseTargets(c, P);
  const l1 = P.leap;
  c.attack.phase = 'recoil';
  c.attack.t = CREATURE_TUNING.postStrike;
  poseTargets(c, P);
  const l0 = P.leap;
  c.state = 'PURSUING';
  poseTargets(c, P);
  ok(Math.abs(r1 - 1) < 1e-9 && r0 > 0 && r0 < r1 && l1 === 1 && l0 === 0 && P.rear === 0 && P.leap === 0, 'pose: the rear-up grows through the wind-up, the leap is full in the strike and gone by the end of the recoil, nothing otherwise');
}
// determinism
{
  const sig = (seed) => {
    const { v } = run(seed, 40);
    return Array.from(v.lods[0].instanceMatrix.array).concat(Array.from(v.lods[1].instanceMatrix.array), Array.from(v.ph), Array.from(v.lods[0].userData.anim)).map((x) => x.toFixed(6)).join(',');
  };
  ok(sig(9) === sig(9), 'deterministic: the same seed -> the same instances, gait phases and anim data');
}
// zero allocation per frame + CPU
{
  const g = new SkitterGroup(level, DIFFICULTY[K], new EventBus(), { seed: 3 });
  const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
  g.setSection(6, p);
  for (let i = 0; i < 60 * 30; i++) g.update(1 / 60, p, i / 60);
  const v = new SkitterlingView(new THREE.Scene());
  for (let i = 0; i < 600; i++) v.update(g, 1 / 60, cam, 'quest');
  const measure = () => {
    gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) v.update(g, 1 / 60, cam, i & 1 ? 'quest' : 'high');
    gc();
    return process.memoryUsage().heapUsed - h0;
  };
  const grown = Math.min(measure(), measure(), measure());
  ok(v.stats.shown >= 1 && grown < 64 * 1024, `no allocation per frame: heap +${(grown / 1024).toFixed(1)} KB over 20 000 view frames with ${v.stats.shown} hunters (the least of three windows)`);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 10000; i++) v.update(g, 1 / 60, cam, 'quest');
  const us = Number(process.hrtime.bigint() - t0) / 1e3 / 10000;
  ok(us < 50, `CPU: ${us.toFixed(2)} us a frame for the hunter view (${v.stats.shown} hunters), Node`);
  console.log(`BUDGET hunter skitterlings: view ${us.toFixed(2)} us/frame @${v.stats.shown}; LOD0 ${HUNTER_TRIS} tris, LOD1 ${MODEL.SWARM_TRIS} tris; <= 2 calls; heap ${(grown / 1024).toFixed(1)} KB / 20000 frames`);
}
// the LOD: near = LOD0, far = LOD1, per tier
{
  const v = new SkitterlingView(new THREE.Scene());
  const c0 = new THREE.PerspectiveCamera();
  c0.position.set(0, 0, 0);
  c0.updateMatrixWorld(true);
  v.debug.place([
    { x: 0, y: 0, z: 2, speed: 1 },
    { x: 0, y: 0, z: 30, speed: 1 },
  ]);
  v.update(null, 1 / 60, c0, 'quest');
  ok(v.stats.lod0 === 1 && v.stats.lod1 === 1 && v.stats.calls === 2 && v.stats.triangles === HUNTER_TRIS + MODEL.SWARM_TRIS, `LOD: a hunter 2 m away draws LOD0 (${HUNTER_TRIS}), one 30 m away LOD1 (${MODEL.SWARM_TRIS}); 2 calls`);
  v.debug.place([{ x: 0, y: 0, z: 2, rear: 1 }]);
  v.update(null, 1 / 60, c0, 'quest');
  const e = v.lods[0].instanceMatrix.array;
  ok(v.stats.shown === 1 && e[9] > 0.3 * HUNTER.len && v.lods[0].userData.pose[0] === 1, 'debug.place: a reared hunter tips its body up (forward axis rises) and its pose flags the front legs');
  v.debug.clear();
  v.update(null, 1 / 60, c0, 'quest');
  ok(v.stats.shown === 0 && !v.lods[0].visible && !v.lods[1].visible && v.stats.calls === 0, 'nothing in play -> both LODs hidden, no call');
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// 3. names: what the player reads says "skitterlings"; the old setting key still works
// ---------------------------------------------------------------------------------------------------------------------------------------
{
  // a saved settings blob from before the rename (key 'roaches' off) still hides the swarm
  const store = new Map([['abyssalTether3d.v1.settings', JSON.stringify(Object.assign({}, SETTINGS_DEFAULTS, { roaches: false }))]]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const s = Storage.loadSettings();
  delete globalThis.localStorage;
  const scene = new THREE.Scene();
  const c = new THREE.PerspectiveCamera();
  const game = { renderer: { scene, camera: c, qualityTier: 'quest' }, player: { alive: true, rx: 0, ry: 0, rz: 0 }, state: 'playing', settings: s };
  const ctx = roachContext(game, makeRoachCtx());
  const r = new Roaches(new EventBus(), { seed: 1 });
  r.reset(level);
  for (let i = 0; i < 300; i++) r.update(1 / 72, ctx);
  ok(s.roaches === false && ctx.on === false && r.alive === 0, 'compat: an old saved {roaches: false} loads as off and the swarm never appears');
  game.settings = Object.assign({}, s, { roaches: true });
  ok(roachContext(game, makeRoachCtx()).on === true, 'compat: the same key on -> the swarm runs');
  ok(SETTINGS_DEFAULTS.roaches === true && !('skitterlings' in SETTINGS_DEFAULTS), 'the storage key stays roaches (no new key)');
}
{
  // no user-visible "roach" anywhere in src: settings labels / descriptions, captions, comms lines, any prose string literal
  const files = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(d, f.name));
      else if (/\.(js|mjs|html|json)$/.test(f.name)) files.push(path.join(d, f.name));
    }
  };
  walk(SRC_DIR);
  const hits = [];
  for (const f of files) {
    let s = fs.readFileSync(f, 'utf8');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;,{}()])\/\/[^\n]*/g, '$1');
    const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    let m;
    while ((m = re.exec(s))) {
      const t = m[1] ?? m[2] ?? m[3];
      // prose = a space or a capitalised word: identifiers, event names ('roach:squish'), sfx ids, paths ('./roachSfx.js') and the storage key are not read
      if (/roach/i.test(t) && (/\s/.test(t) || /(^|[^A-Za-z_$])Roach/.test(t))) hits.push(path.relative(SRC_DIR, f) + ': ' + t.slice(0, 80));
    }
  }
  ok(hits.length === 0, `no user-visible "roach" string left in src (identifiers, event names and file names may keep it)${hits.length ? ': ' + hits.join(' | ') : ''}`);
  const caps = ['roach:skitter', 'roach:scatter', 'roach:squish', 'roach:burst'].map((t) => captionForEvent(t, { n: 9 }));
  ok(caps.every((c) => c && !/roach/i.test(c.text)) && ['roach:skitter', 'roach:scatter', 'roach:squish', 'roach:burst'].every((t) => CAPTION_EVENTS.includes(t)), `captions: ${caps.map((c) => c.text).join(' ')}`);
  ok(Object.values(RULES).every((r) => !/roach/i.test(r.text || '')), 'captions: no rule text says roach');
  const ui = read('ui/ui3d.js');
  ok(!/label: '[^']*[Rr]oach|desc: '[^']*[Rr]oach/.test(ui), 'settings: no label or description says roach');
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// 4. the wiring
// ---------------------------------------------------------------------------------------------------------------------------------------
{
  const gsrc = read('game.js');
  ok(/new SkitterlingView\(this\.renderer\.scene\)/.test(gsrc) && /this\.skitterView\.update\(this\.skitters, dt, this\.renderer\.camera, this\.renderer\.qualityTier\)/.test(gsrc), 'game: the hunter view is made and updated from the sim in _updateViews');
  ok(!/skitter_rig\.glb|makeSkitterViews|cloneSkitterScenes|skitterViews/.test(gsrc) && !fs.existsSync(path.join(SRC_DIR, '../assets/models/skitter_rig.glb')), 'game: no Mason-rig clones, no skitter_rig.glb (5.4 MB less to download)');
  ok(/skitterlings: \{/.test(gsrc) && /api\.roaches = api\.skitterlings;/.test(gsrc) && /hunters: \(\) =>/.test(gsrc), 'debug: AT3D.debug.skitterlings (swarm state / burst / clear + hunters()), AT3D.debug.roaches the same object');
  ok(/placeSkitter: \(o\) => \(this\.skitterView/.test(gsrc), 'debug: creature.placeSkitter stages synthetic hunters on the new view');
  const mrv = read('render/masonRigView.js');
  ok(!/SKITTER_VIEW/.test(mrv) && !fs.existsSync(path.join(SRC_DIR, 'render/mason/skitterClone.js')), 'the Mason rig view keeps no skitterling clone code (SKITTER_VIEW, skitterClone.js gone)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
