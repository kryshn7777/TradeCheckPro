// Node tests for the SECOND real-time shadow (render/auxShadowLogic.js, auxShadow.js, the receiver chunks in materials.js, the creature-glow slot in
// renderer3d.js), no GPU: the tier table and the governor reduction, the cadence, the creature's light plan, which light the map follows (creature first,
// then the nearest lamp, with hysteresis), the aim and the fit, the shader chunks (installed once, the decay codes), the AuxShadow state machine on fake
// pooled-lamp slots (creature wins, a fade between lights, freed after a while), and the renderer's lamp-slot handover to the creature's glow.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
const SRC = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/')).href;
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const A = await import(`${SRC}/render/auxShadowLogic.js`);
const M = await import(`${SRC}/render/materials.js`);
const { AuxShadow } = await import(`${SRC}/render/auxShadow.js`);
const { Renderer3D } = await import(`${SRC}/render/renderer3d.js`);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

ok('tier table: low off, quest 512 every 2nd frame, high 1024 every frame', () => {
  assert.equal(A.AUX_TIERS.low.enabled, false);
  assert.equal(A.AUX_TIERS.quest.size, 512);
  assert.equal(A.AUX_TIERS.quest.every, 2);
  assert.equal(A.AUX_TIERS.high.size, 1024);
  assert.equal(A.AUX_TIERS.high.every, 1);
  assert.ok(A.AUX_TIERS.quest.creatureReach < A.AUX_TIERS.high.creatureReach);
});

ok('plan: low and the API switch are off; governor 1 / reducedEffects shrink the map and slow the rate; governor 2 switches it off', () => {
  assert.equal(A.auxPlan('low').enabled, false);
  assert.equal(A.auxPlan('quest', { enabled: false }).enabled, false);
  const q = A.auxPlan('quest');
  assert.equal(q.enabled, true);
  assert.equal(q.size, 512);
  const g1 = A.auxPlan('quest', { govLevel: 1 });
  assert.equal(g1.size, 256);
  assert.ok(g1.every > q.every);
  assert.equal(A.auxPlan('quest', { reduced: true }).size, 256);
  assert.equal(A.auxPlan('high', { govLevel: 1 }).size, 512);
  assert.equal(A.auxPlan('quest', { govLevel: 2 }).enabled, false);
  assert.equal(A.auxPlan('high', { govLevel: 3 }).enabled, false);
  assert.equal(A.auxPlan('xr').tier, 'quest');
});

ok('cadence: every frame when every = 1, every 2nd otherwise, never when off', () => {
  const h = A.auxPlan('high');
  const q = A.auxPlan('quest');
  for (let f = 0; f < 6; f++) assert.equal(A.auxDue(f, h), true);
  assert.deepEqual([0, 1, 2, 3, 4].map((f) => A.auxDue(f, q)), [true, false, true, false, true]);
  assert.equal(A.auxDue(0, A.auxPlan('low')), false);
});

ok('creature light: only while it is out and aware, inside the reach, fading in over the last 30 %, brighter when it lunges', () => {
  const plan = A.auxPlan('quest');
  const reach = plan.creatureReach;
  const mk = (o) => A.creatureLightPlan(Object.assign({ visible: true, state: 'PURSUING', dist: 6, listen: 0 }, o), plan);
  assert.equal(mk({ state: 'DORMANT' }).on, false);
  assert.equal(mk({ state: 'DISTANT' }).on, false);
  assert.equal(mk({ visible: false }).on, false);
  assert.equal(mk({ dist: reach + 0.1 }).on, false);
  assert.equal(A.creatureLightPlan({ visible: true, state: 'PURSUING', dist: 3 }, A.auxPlan('low')).on, false, 'off on the low tier');
  const near = mk({ dist: 5 });
  assert.equal(near.on, true);
  assert.equal(near.k, 1);
  assert.ok(mk({ dist: reach - 1 }).k < 1 && mk({ dist: reach - 1 }).k > 0, 'fading at the edge');
  assert.ok(mk({ state: 'ATTACK' }).candela > mk({ state: 'PURSUING' }).candela);
  assert.ok(mk({ state: 'PURSUING' }).candela > mk({ state: 'OBSERVING' }).candela);
  assert.ok(mk({ listen: 1 }).candela > mk({ listen: 0 }).candela, 'throbs with its listening');
  assert.ok(near.color[0] > near.color[1] && near.color[0] > near.color[2], 'red');
  assert.ok(near.range > 0 && near.range < 20);
});

ok('which light: the creature first; otherwise the best lamp the head is inside the range of; put-out / dim / far lamps are skipped', () => {
  const head = { x: 0, y: 0, z: 0 };
  const lamp = (slot, x, level = 1, range = 14) => ({ kind: 'lamp', slot, x, y: 0, z: 0, range, level });
  assert.equal(A.pickAuxLight([], head, null), -1);
  assert.equal(A.pickAuxLight([lamp(0, 6), lamp(1, 3)], head, null), 1, 'the nearer one scores better');
  assert.equal(A.pickAuxLight([lamp(0, 3, 0.02), lamp(1, 9)], head, null), 1, 'a dim slot is skipped');
  assert.equal(A.pickAuxLight([lamp(0, 40)], head, null), -1, 'out of its range');
  assert.equal(A.pickAuxLight([lamp(0, 3), { kind: 'creature', slot: 1, x: 8, y: 0, z: 0, range: 11, level: 1 }], head, null), 1, 'the creature wins');
  assert.equal(A.pickAuxLight([lamp(0, 3), { kind: 'creature', slot: 1, x: 8, y: 0, z: 0, range: 11, level: 0.01 }], head, null), 0, 'a fading-out creature no longer does');
  // a large lamp range counts up to the tier cap only
  assert.equal(A.pickAuxLight([lamp(0, 26, 1, 80)], head, null, 22), -1);
  assert.equal(A.pickAuxLight([lamp(0, 20, 1, 80)], head, null, 22), 0);
  // hysteresis: the previous lamp stays unless the other one is clearly better
  const prev = { kind: 'lamp', slot: 0 };
  assert.equal(A.pickAuxLight([lamp(0, 5.6), lamp(1, 5)], head, prev), 0, 'a close call keeps the old one');
  assert.equal(A.pickAuxLight([lamp(0, 9), lamp(1, 3)], head, prev), 1, 'a clear win switches');
});

ok('aim: unit axis from the light toward the player, straight down when they coincide; fit has the light range', () => {
  const axis = { x: 0, y: -1, z: 0 };
  const out = A.auxAim({ x: 0, y: 5, z: 0 }, { x: 3, y: 1, z: 0 }, axis, 1, {});
  assert.ok(Math.abs(Math.hypot(out.ax, out.ay, out.az) - 1) < 1e-9);
  assert.ok(Math.abs(out.ax - 0.6) < 1e-9 && Math.abs(out.ay + 0.8) < 1e-9);
  assert.ok(Math.abs(out.dist - 5) < 1e-9);
  const same = A.auxAim({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1.1 }, { x: 1, y: 0, z: 0 }, 1, {});
  assert.equal(same.ay, -1);
  const fit = A.auxFit(A.auxPlan('quest'), 11, {});
  assert.ok(Math.abs(fit.far - 12) < 1e-9);
  assert.ok(fit.near >= 0.3 && fit.near < 1);
  assert.ok(fit.texel > 0);
  assert.ok(A.auxFit(A.auxPlan('quest'), 80, {}).far <= A.AUX_TIERS.quest.maxLampRange + 1.001, 'a big lamp range is capped');
});

ok('receiver chunks: atAuxShadow installed once, the pooled-light hook matches by position, the creature (decay 1.9) is not baked away, the lamp term is shadowed', () => {
  const sc = THREE.ShaderChunk;
  assert.equal(sc.lights_pars_begin.split('float atAuxShadow(').length, 2, 'declared once');
  assert.ok(sc.lights_pars_begin.includes('sampler2DShadow uLPMap') && sc.lights_pars_begin.includes('uniform vec4 uLPK;') && sc.lights_pars_begin.includes('uniform vec3 uLPPos;'));
  assert.ok(sc.lights_fragment_begin.includes('vec3 atLpV = ( viewMatrix * vec4( uLPPos, 1.0 ) ).xyz;'));
  assert.ok(/else if \( uLPK\.x > 0\.002[^\n]*distance\( pointLight\.position, atLpV \) < 0\.06[^\n]*atAuxShadow\(/.test(sc.lights_fragment_begin), 'matched by position, so only the aux light is shadowed');
  // the lit program: the lightmapped (baked) skip now spares decay 1.9, and the baked lamp term takes the aux visibility in lamp mode
  const lit = M.patchMaterial(new THREE.MeshStandardMaterial(), { lit: true, grade: true });
  const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  lit.onBeforeCompile(sh, null);
  assert.ok(sh.fragmentShader.includes('atLmOn > 0.5 && pointLight.decay > 1.95'), 'the creature glow is evaluated on baked fragments; the lamps (decay 2) are not');
  assert.ok(!sh.fragmentShader.includes('atLmOn > 0.5 && pointLight.decay > 1.8 )'), 'the old test is gone');
  assert.ok(/uLPK\.x > 0\.002 && uLPK\.w < 0\.5\s*\)\s*atLl \*= atAuxShadow\(/.test(sh.fragmentShader), 'lamp mode darkens the baked lamp term');
  assert.equal(sh.uniforms.uLPMap, M.LSHADOW.uLPMap);
  assert.equal(sh.uniforms.uLPM, M.LSHADOW.uLPM);
  assert.equal(sh.uniforms.uLPK, M.LSHADOW.uLPK);
  assert.equal(sh.uniforms.uLPPos, M.LSHADOW.uLPPos);
  assert.equal(M.LSHADOW.uLPK.value.x, 0, 'off by default');
});

// ---- AuxShadow on fake pooled-lamp slots ---------------------------------------------------------------------------------------------------------
function fakeAux(slots) {
  const head = new THREE.Vector3(0, 0, 0);
  const ls = { r3d: { envLights: slots, _head: head, renderer: null }, plan: { enabled: true }, tier: 'quest', _level: {}, _dummy: null };
  const aux = new AuxShadow(ls);
  return { aux, ls, head };
}
const slot = (src, level, intensity, x = 0, y = 0, z = 0) => {
  const light = new THREE.PointLight(0xffffff, intensity, 10, src && src.creature ? 1.9 : 2);
  light.position.set(x, y, z);
  return { light, src, level, want: src };
};

ok('AuxShadow: nothing without a lit pooled light; the nearest lamp otherwise (lamp mode); eased strength', () => {
  const slots = [slot(null, 0, 0), slot(null, 0, 0)];
  const { aux } = fakeAux(slots);
  aux.update(0.016, {}, 0, {});
  assert.equal(aux.light, null);
  assert.equal(aux.stats.kind, 'none');
  slots[0] = slot({ range: 14 }, 1, 20, 4, 2, 0);
  aux.update(0.016, {}, 0, {});
  assert.ok(aux.light && aux.light.kind === 'lamp' && aux.light.slot === 0);
  aux.update(0.016, {}, 0, {});
  assert.ok(aux.k > 0 && aux.k < 1, 'eases in');
  for (let i = 0; i < 80; i++) aux.update(0.016, {}, 0, {});
  assert.ok(aux.k > 0.97);
  assert.equal(aux.stats.kind, 'lamp');
});

ok('AuxShadow: the creature takes over from the lamp through a fade, then back again; governor 2 and the API switch turn it off', () => {
  const slots = [slot({ range: 14 }, 1, 20, 4, 2, 0), slot(null, 0, 0)];
  const { aux } = fakeAux(slots);
  for (let i = 0; i < 80; i++) aux.update(0.016, {}, 0, {});
  assert.equal(aux.light.kind, 'lamp');
  slots[1] = slot({ creature: true, range: 11 }, 1, 6, 8, 0, 0);
  aux.update(0.016, {}, 0, {});
  assert.equal(aux.light.kind, 'lamp', 'the old light stays while it fades out');
  let steps = 0;
  while (aux.light.kind !== 'creature' && steps++ < 200) aux.update(0.016, {}, 0, {});
  assert.equal(aux.light.kind, 'creature');
  assert.equal(aux.ready, false, 'a fresh map is rendered before it shows');
  for (let i = 0; i < 80; i++) aux.update(0.016, {}, 0, {});
  assert.ok(aux.k > 0.95);
  // the creature moves: the light follows it every frame
  slots[1].light.position.set(9, 1, 0);
  aux.update(0.016, {}, 0, {});
  assert.ok(Math.abs(aux.light.x - 9) < 1e-9);
  // the governor gives it back
  aux.update(0.016, {}, 2, {});
  assert.equal(aux.plan.enabled, false);
  for (let i = 0; i < 120; i++) aux.update(0.016, {}, 2, {});
  assert.equal(aux.k, 0);
  aux.setEnabled(false);
  aux.update(0.016, {}, 0, {});
  assert.equal(aux.plan.enabled, false);
  assert.equal(aux.canLight(), false);
  aux.setEnabled(true);
  aux.update(0.016, {}, 0, {});
  assert.equal(aux.canLight(), true);
});

ok('AuxShadow: freed after being off for a while (the target is given back); render(null) switches the receivers off', () => {
  const slots = [slot({ range: 14 }, 1, 20, 4, 2, 0), slot(null, 0, 0)];
  const { aux } = fakeAux(slots);
  for (let i = 0; i < 80; i++) aux.update(0.016, {}, 0, {});
  assert.ok(aux.light);
  M.LSHADOW.uLPK.value.x = 0.9;
  aux.render(null);
  assert.equal(M.LSHADOW.uLPK.value.x, 0);
  slots[0].src = null;
  slots[0].want = null;
  slots[0].level = 0;
  slots[0].light.intensity = 0;
  for (let i = 0; i < 600; i++) aux.update(0.016, {}, 0, {});
  assert.equal(aux.light, null, 'freed');
  assert.equal(aux.ready, false);
});

// ---- the renderer's lamp slots: the creature's glow takes the last one ----------------------------------------------------------------------------
function fakeRenderer(canLight) {
  const slots = [0, 1].map(() => ({ light: new THREE.PointLight(0xffffff, 0, 10, 2), src: null, level: 0, want: null }));
  const srcs = [0, 1, 2].map((i) => ({ x: 10 * i, y: 0, z: 0, color: new THREE.Color(1, 0.7, 0.3), candela: 20, range: 14, flicker: 0, seed: i, ref: null }));
  const self = {
    envLights: slots,
    _envSources: srcs,
    _envTimer: 0,
    _envScratch: [],
    _creatureSrc: { creature: true, x: 0, y: 0, z: 0, color: new THREE.Color(1, 0.24, 0.1), candela: 0, range: 11, flicker: 0.35, seed: 7.31, ref: null },
    _creatureOn: false,
    _crPlan: { visible: true, state: '', dist: 1e9, listen: 0 },
    time: 0,
    _dark: 0,
    _lampFlick: 1,
    lanternShadow: { aux: { canLight: () => canLight, plan: A.auxPlan('quest') } },
  };
  self._syncCreatureLight = Renderer3D.prototype._syncCreatureLight;
  const step = (dt, head, game) => {
    self.time += dt;
    Renderer3D.prototype._updateEnvLights.call(self, dt, head, game);
  };
  return { self, slots, srcs, step };
}
const creatureGame = (state, x) => ({ creature: { state, body: { visible: true, listen: 0, head: { x, y: 0, z: 0, fx: -1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0 } } } });

ok('creature glow: takes the last pooled slot (decay 1.9, hung off the head along its up and facing), the lamps keep the first, and it hands the slot back', () => {
  const { slots, srcs, step } = fakeRenderer(true);
  const head = { x: 5, y: 0, z: 0 };
  for (let i = 0; i < 60; i++) step(0.016, head, { creature: { state: 'DORMANT', body: { visible: false, head: { x: 30, y: 0, z: 0 } } } });
  assert.ok(slots[0].src && slots[1].src, 'both slots carry lamps');
  assert.equal(slots[1].light.decay, 2);
  let game = creatureGame('PURSUING', 12);
  for (let i = 0; i < 80; i++) step(0.016, head, game);
  assert.ok(slots[1].src && slots[1].src.creature, 'the glow holds the last slot');
  assert.equal(slots[1].light.decay, 1.9);
  assert.ok(slots[1].light.intensity > 0.5, 'lit');
  assert.ok(Math.abs(slots[1].light.position.y - 1.2) < 1e-6 && Math.abs(slots[1].light.position.x - (12 - 0.7)) < 1e-6, 'off the stone: up 1.2 and forward 0.7');
  assert.ok(slots[0].src && !slots[0].src.creature, 'a lamp keeps the first slot');
  assert.equal(slots[0].light.decay, 2);
  // it moves: the light follows every frame
  game = creatureGame('PURSUING', 14);
  step(0.016, head, game);
  assert.ok(Math.abs(slots[1].light.position.x - 13.3) < 1e-6);
  // it loses interest: the glow fades out and the slot returns to the lamps
  game = creatureGame('DISTANT', 14);
  for (let i = 0; i < 80; i++) step(0.016, head, game);
  assert.ok(slots[1].src && !slots[1].src.creature, 'a lamp is back');
  assert.equal(slots[1].light.decay, 2);
  assert.ok(srcs.includes(slots[1].src));
});

ok('creature glow: never lit without the aux shadow map (low tier, governor 2, no level)', () => {
  const { slots, step } = fakeRenderer(false);
  const head = { x: 5, y: 0, z: 0 };
  for (let i = 0; i < 80; i++) step(0.016, head, creatureGame('PURSUING', 12));
  assert.ok(slots.every((s) => !s.src || !s.src.creature), 'a glow with no shadow would light through walls');
  assert.ok(slots.every((s) => s.light.decay === 2));
});

ok('creature glow: works on a level with no lamps at all', () => {
  const { self, slots, step } = fakeRenderer(true);
  self._envSources = [];
  for (let i = 0; i < 80; i++) step(0.016, { x: 5, y: 0, z: 0 }, creatureGame('ATTACK', 8));
  assert.ok(slots[1].src && slots[1].src.creature && slots[1].light.intensity > 0.5);
});

console.log(`${n} checks passed`);
