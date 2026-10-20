import * as THREE from 'three';
import { InputManager } from '/game/src/input/inputManager.js';
import { HandsView } from '/game/src/render/handsView.js';
import { Player3D, TetherSystem } from '/game/src/sim/physics3d.js';
import { DIFFICULTY, EventBus, SETTINGS_DEFAULTS, U, eyeAboveBody } from '/game/src/sim/config3d.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.xr.enabled = true;
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080a);
scene.fog = new THREE.Fog(0x07080a, 6, 60);
const rig = new THREE.Group();
rig.name = 'rig';
scene.add(rig);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400);
rig.add(camera);
scene.add(new THREE.HemisphereLight(0x8899aa, 0x221a12, 0.6));
const lantern = new THREE.PointLight(0xffb060, 4, 14, 1.4);
const r3 = {
  scene, camera, rig, renderer, lanternParent: '',
  setLanternParent(o) { o.add(lantern); lantern.position.set(0, 0, 0); this.lanternParent = o.name || o.type; },
};
r3.setLanternParent(camera);

// A 16 m square shaft with a ledge.
const solids = [];
const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.9 });
function box(minX, minY, minZ, maxX, maxY, maxZ) {
  const b = { minX, minY, minZ, maxX, maxY, maxZ, active: true };
  solids.push(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ), wallMat);
  m.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  scene.add(m);
}
box(-9, -60, -9, -8, 30, 9); box(8, -60, -9, 9, 30, 9); box(-9, -60, -9, 9, 30, -8); box(-9, -60, 8, 9, 30, 9);
box(-3, -2, -3, 3, -0.4, 3); // ledge under the player
const anchors = [
  { id: 'a-front', kind: 'ring', x: 1.2, y: 4.5, z: -7.6 },
  { id: 'a-left', kind: 'hook', x: -7.6, y: 3.5, z: -2 },
  { id: 'a-right', kind: 'fragile', x: 7.6, y: 3, z: -3 },
  { id: 'a-back', kind: 'ring', x: 0, y: 5, z: 7.6 },
];
const anchorMat = new THREE.MeshBasicMaterial({ color: 0x4a6a60 });
for (const a of anchors) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 16), anchorMat);
  m.position.set(a.x, a.y, a.z);
  m.lookAt(0, a.y, 0);
  scene.add(m);
}
const level = {
  bounds: { minX: -9, maxX: 9, minY: -60, maxY: 30, minZ: -9, maxZ: 9 },
  anchorsNear(x, y, z, r, out) { out.length = 0; for (const a of anchors) if (Math.hypot(a.x - x, a.y - y, a.z - z) <= r) out.push(a); return out; },
  segmentBlocked() { return false; },
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    const ex = ox + dx * maxDist, ey = oy + dy * maxDist, ez = oz + dz * maxDist;
    let bt = Infinity, bs = null;
    for (const s of solids) { const t = U.segmentBox(ox, oy, oz, ex, ey, ez, s, 0); if (t >= 0 && t < bt) { bt = t; bs = s; } }
    if (!bs) return null;
    const r = out || {}; r.t = bt * maxDist; r.solid = bs; r.x = ox + dx * r.t; r.y = oy + dy * r.t; r.z = oz + dz * r.t; return r;
  },
};
const settings = Object.assign({}, SETTINGS_DEFAULTS);
const bus = new EventBus();
const log = [];
for (const t of ['grapple:attach', 'grapple:release', 'grapple:miss', 'xr:start', 'xr:end', 'xr:visibility', 'input:release', 'input:mode', 'input:recenter', 'xr:error']) {
  bus.on(t, (p) => log.push(`${t}:${p.hand || p.reason || p.state || p.mode || p.message || ''}${p.anchor ? '@' + p.anchor.id : ''}`));
}
const diff = DIFFICULTY.normal;
const player = new Player3D(0, 0, 0);
const tethers = new TetherSystem(level, diff, bus, settings);
const input = new InputManager({ renderer, camera, rig, canvas: renderer.domElement, settings, bus });
const hands = new HandsView(r3, input);
const game = { state: 'playing', tethers, level, diff, player, input, settings };
const EYE = eyeAboveBody(); // desktop eye over the body centre (CONTRACT3D "Rig and eye height")
camera.position.set(0, EYE, 0);
let last = performance.now();
let frames = 0;
const T = (window.T = { EYE, THREE, renderer, scene, camera, rig, input, hands, tethers, player, game, level, bus, log, lantern, r3, anchors, errors: [], frames: 0, holdFrames: false });
window.addEventListener('error', (e) => T.errors.push(String(e.message)));
renderer.setAnimationLoop(() => {
  try {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const intent = input.update(dt);
    tethers.updateTargets(player, intent);
    tethers.handleInput(player, intent, dt);
    if (input.xrActive) {
      rig.rotation.y += intent.turnRate * dt;
      const p = input.xrRigPosition(player.x, player.y, player.z);
      rig.position.set(p.x, p.y, p.z);
    } else {
      rig.position.set(player.x, player.y, player.z);
    }
    hands.update(dt, game);
    renderer.render(scene, camera);
    T.lastIntent = JSON.parse(JSON.stringify(intent));
    T.info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    T.attached = { left: tethers.hands.left.rope.anchor ? tethers.hands.left.rope.anchor.id : null, right: tethers.hands.right.rope.anchor ? tethers.hands.right.rope.anchor.id : null };
    T.targets = { left: tethers.hands.left.target ? tethers.hands.left.target.id : null, right: tethers.hands.right.target ? tethers.hands.right.target.id : null };
    input.endFrame();
    T.frames = ++frames;
  } catch (err) {
    T.errors.push(String(err && err.stack || err));
  }
});
document.getElementById('vr').addEventListener('click', () => {
  input.enterVR().then((ok) => { T.vrResult = ok; });
});
T.ready = true;
