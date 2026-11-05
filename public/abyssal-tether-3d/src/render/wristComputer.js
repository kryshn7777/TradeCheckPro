/* ABYSSAL TETHER 3D — render/wristComputer.js
 * The WATCH on the right wrist: a small face (depth, the section, the jetpack's fuel) always on in a headset, and — when the wrist is raised
 * to look at it (sim/wristMap.js) or M is pressed — a 3D HOLOGRAM of the whole descent that blooms above it:
 *
 *   the shaft's solids as glowing cyan edges (one LineSegments call; the structure near YOU brightens, a scanline runs down it, the bridges
 *   and the crumbling ledges are lime and amber), a green diamond where the run STARTED, a red-amber diamond at the GATE you are going to,
 *   a white pulsing diamond with a ring where YOU are, small ticks for the section boundaries, and a faint trail of where you have been.
 *
 * "A 3D map of the full map, and a dot where the user is currently at, and the place where it started and the place where he's going to go."
 *
 * mapGeometry(level) is pure (no GL): it bakes the level into display space (a 0.34 m tall tower, centred on the origin). WristComputer
 * mounts it (VR: on the right wrist's WristHUD mount, the hologram floats above the wrist, upright in the world; desktop: on the camera, low
 * and to the right) and costs at most 5 draw calls while open (edges, markers, trail, face, ring) and 1 (the face) when closed.
 *
 *   new WristComputer(game)   game: { renderer.{scene,camera}, handsView, level, player, jet, wristMap, xrActive, state, sectionIndex }
 *   .update(dt, game)         once per frame (Game._updateViews)
 *   .reset()                  a new run: the trail is cleared
 *   .stats                    { open, redraws, segments }
 */
import * as THREE from 'three';
import { U } from '../sim/config3d.js';

export const HOLO = Object.freeze({
  height: 0.34, // m: the tower on the display
  mount: { x: 0, y: 0.012, z: 0 }, // the face above the WristHUD empty
  face: { w: 0.075, h: 0.0375, cw: 256, ch: 128 },
  tilt: 0.45,
  floatY: 0.2, // m above the wrist (VR)
  desk: { x: 0.2, y: -0.13, z: -0.55 }, // in the camera's frame (desktop)
  maxTrail: 480,
  trailStep: 4, // model metres between trail points
});

const KIND = { wall: 0, stone: 1, metal: 1, pillar: 2, bridge: 3, crumble: 4 };

/**
 * Bakes the level for the display. Returns:
 *   seg: Float32Array xyz pairs (12 edges per solid), kind: Float32Array one per vertex,
 *   scale: display metres per model metre, center: {x,y,z} of the model, size: {x,y,z} of the display,
 *   toDisplay(x,y,z,out) -> out, start, goal, ticks: [y...] section boundaries in display y
 */
export function mapGeometry(level, height = HOLO.height) {
  const solids = level.solids || [];
  // the box of the display: the level bounds UNION every solid (the bounds stop short of the top ironwork: S1's girders reach 20 m above them)
  const b = { minX: level.bounds.minX, maxX: level.bounds.maxX, minY: level.bounds.minY, maxY: level.bounds.maxY, minZ: level.bounds.minZ, maxZ: level.bounds.maxZ };
  for (const s of solids) {
    if (s.minX < b.minX) b.minX = s.minX;
    if (s.maxX > b.maxX) b.maxX = s.maxX;
    if (s.minY < b.minY) b.minY = s.minY;
    if (s.maxY > b.maxY) b.maxY = s.maxY;
    if (s.minZ < b.minZ) b.minZ = s.minZ;
    if (s.maxZ > b.maxZ) b.maxZ = s.maxZ;
  }
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const scale = height / Math.max(1e-6, b.maxY - b.minY);
  const seg = new Float32Array(solids.length * 24 * 3);
  const kind = new Float32Array(solids.length * 24);
  let n = 0;
  const put = (x, y, z, k) => {
    seg[n * 3] = (x - cx) * scale;
    seg[n * 3 + 1] = (y - cy) * scale;
    seg[n * 3 + 2] = (z - cz) * scale;
    kind[n] = k;
    n++;
  };
  const E = [
    [0, 1],
    [1, 3],
    [3, 2],
    [2, 0],
    [4, 5],
    [5, 7],
    [7, 6],
    [6, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  for (const s of solids) {
    const k = KIND[s.kind] != null ? KIND[s.kind] : 1;
    const c = [];
    for (let i = 0; i < 8; i++) c.push([i & 1 ? s.maxX : s.minX, i & 2 ? s.maxY : s.minY, i & 4 ? s.maxZ : s.minZ]);
    for (const [a, d] of E) {
      put(c[a][0], c[a][1], c[a][2], k);
      put(c[d][0], c[d][1], c[d][2], k);
    }
  }
  const toDisplay = (x, y, z, out) => {
    out.x = (x - cx) * scale;
    out.y = (y - cy) * scale;
    out.z = (z - cz) * scale;
    return out;
  };
  const sp = level.spawn || { x: 0, y: 0, z: 0 };
  const start = toDisplay(sp.x, sp.y, sp.z, { x: 0, y: 0, z: 0 });
  const g = level.gate || level.goal;
  const goal = g ? toDisplay((g.minX + g.maxX) / 2 || g.x || 0, (g.minY + g.maxY) / 2 || g.y || 0, (g.minZ + g.maxZ) / 2 || g.z || 0, { x: 0, y: 0, z: 0 }) : { x: 0, y: -height / 2, z: 0 };
  const ticks = [];
  for (const sec of level.sections || []) ticks.push((sec.yBottom - cy) * scale);
  return {
    seg: seg.subarray(0, n * 3),
    kind: kind.subarray(0, n),
    count: n / 2,
    scale,
    center: { x: cx, y: cy, z: cz },
    size: { x: (b.maxX - b.minX) * scale, y: (b.maxY - b.minY) * scale, z: (b.maxZ - b.minZ) * scale },
    toDisplay,
    start,
    goal,
    ticks,
  };
}

const VERT = /* glsl */ `
attribute float aKind;
varying float vKind;
varying float vY;
void main() {
  vKind = aKind;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uYou;
uniform float uK;
varying float vKind;
varying float vY;
void main() {
  vec3 c = vec3(0.25, 0.85, 1.0);
  float a = 0.3;
  if (vKind > 2.5 && vKind < 3.5) { c = vec3(0.55, 1.0, 0.45); a = 0.75; }
  else if (vKind > 3.5) { c = vec3(1.0, 0.7, 0.25); a = 0.8; }
  else if (vKind > 1.5) { c = vec3(0.35, 0.8, 0.95); a = 0.45; }
  else if (vKind > 0.5) { c = vec3(0.3, 0.9, 1.0); a = 0.55; }
  float near = exp(-abs(vY - uYou) / 0.035); // the structure around you glows
  float scan = 0.5 + 0.5 * sin(vY * 420.0 - uTime * 3.2);
  a *= (0.35 + 0.9 * near) * (0.75 + 0.25 * scan);
  gl_FragColor = vec4(c * a * uK, a * uK);
}
`;

function canvasOrNull(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class WristComputer {
  constructor(game) {
    this.game = game;
    this.stats = { open: false, redraws: 0, segments: 0 };
    this.root = new THREE.Group(); // the hologram: lives in the scene (VR) or on the camera (desktop)
    this.root.name = 'AT3D-holo';
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.geo = null;
    this._levelKey = null;
    this.lines = null;
    this.markers = null;
    this.trail = null;
    this._trailN = 0;
    this._lastT = new THREE.Vector3(1e9, 1e9, 1e9);
    this._t = 0;
    this._mtx = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._tmp = { x: 0, y: 0, z: 0 };
    this._wp = new THREE.Vector3();
    this._lastFace = '';
    // the face
    this.canvas = canvasOrNull(HOLO.face.cw, HOLO.face.ch);
    this._g = this.canvas ? this.canvas.getContext('2d') : null;
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
    if (this.texture) {
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.generateMipmaps = false;
      this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    }
    this.faceMat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, fog: false, transparent: true, side: THREE.DoubleSide });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(HOLO.face.w, HOLO.face.h), this.faceMat);
    this.face.name = 'AT3D-wrist-face';
    this.face.frustumCulled = false;
    this.face.visible = false;
    this.face.rotation.set(-Math.PI / 2 + HOLO.tilt, 0, 0);
    this.face.position.set(HOLO.mount.x, HOLO.mount.y, HOLO.mount.z);
    this._faceParent = null;
    // the root exists from the start so the programs compile with everything else (hidden until the map blooms)
    const sc = game.renderer && game.renderer.scene;
    if (sc) sc.add(this.root);
    this.root.visible = false;
  }

  /** (Re)builds the lines + markers for `level`. */
  _build(level) {
    if (this.lines) {
      this.pivot.remove(this.lines, this.markers, this.trail, this.ring);
      for (const o of [this.lines, this.markers, this.trail, this.ring]) {
        o.geometry.dispose();
        o.material.dispose();
      }
    }
    const g = mapGeometry(level);
    this.geo = g;
    this.stats.segments = g.count;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(g.seg, 3));
    geom.setAttribute('aKind', new THREE.BufferAttribute(g.kind, 1));
    this.lineMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uYou: { value: 0 }, uK: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(geom, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.name = 'holoEdges';
    // markers: 0 start (green), 1 goal (amber), 2 you (white), then the section boundary ticks (dim cyan)
    const nm = 3 + g.ticks.length;
    this.markers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }), nm);
    this.markers.frustumCulled = false;
    this.markers.name = 'holoMarkers';
    const col = new THREE.Color();
    const setC = (i, hex) => this.markers.setColorAt(i, col.set(hex));
    setC(0, 0x55ff77);
    setC(1, 0xff7a2a);
    setC(2, 0xffffff);
    for (let i = 0; i < g.ticks.length; i++) setC(3 + i, 0x3fc8e8);
    this.markers.instanceColor.needsUpdate = true;
    // a ring about the 'you' marker (a flat torus that pulses outward)
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.frustumCulled = false;
    this.ring.name = 'holoRing';
    // the trail
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HOLO.maxTrail * 3), 3));
    tg.setDrawRange(0, 0);
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    this.trail.frustumCulled = false;
    this.trail.name = 'holoTrail';
    this._trailN = 0;
    this._lastT.set(1e9, 1e9, 1e9);
    this.pivot.add(this.lines, this.trail, this.markers, this.ring);
    this._levelKey = level;
  }

  reset() {
    this._trailN = 0;
    this._lastT.set(1e9, 1e9, 1e9);
    if (this.trail) this.trail.geometry.setDrawRange(0, 0);
  }

  _mountFace(game) {
    const xr = !!game.xrActive;
    const hv = game.handsView;
    const gear = hv && hv.gear ? hv.gear.right : null;
    let parent = null;
    if (xr && gear) {
      parent = gear.wristHud || gear.root;
      if (parent && this.face.parent !== parent) {
        parent.add(this.face);
        this.face.position.set(HOLO.mount.x, HOLO.mount.y, HOLO.mount.z);
        if (!gear.wristHud) this.face.position.set(0.03, 0.1, 0.14);
        this.face.scale.setScalar(1);
      }
    } else if (!xr && game.renderer && game.renderer.camera) {
      parent = game.renderer.camera;
      if (this.face.parent !== parent) {
        parent.add(this.face);
        this.face.position.set(0.215, -0.2, -0.5); // the lower right corner of the view, small (the hands and the radio line are in the middle / left)
        this.face.rotation.set(0, 0, 0);
        this.face.scale.setScalar(1.15);
      }
    }
    return !!parent;
  }

  _drawFace(depth, sec, fuel, burning) {
    const g = this._g;
    if (!g) return;
    const { cw, ch } = HOLO.face;
    const key = `${depth}|${sec}|${Math.round(fuel * 50)}|${burning ? 1 : 0}`;
    if (key === this._lastFace) return;
    this._lastFace = key;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = 'rgba(4,18,26,0.82)';
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = 'rgba(80,220,255,0.9)';
    g.lineWidth = 3;
    g.strokeRect(2, 2, cw - 4, ch - 4);
    g.fillStyle = '#7fe8ff';
    g.font = 'bold 22px monospace';
    g.fillText('DEPTH', 12, 30);
    g.font = 'bold 40px monospace';
    g.fillStyle = '#e8fbff';
    g.fillText(`${depth} m`, 12, 72);
    g.font = '18px monospace';
    g.fillStyle = '#7fe8ff';
    g.fillText(sec, 12, 96);
    // fuel gauge
    const bx = 140;
    const by = 16;
    g.fillStyle = '#7fe8ff';
    g.font = 'bold 16px monospace';
    g.fillText('FUEL', bx, by + 12);
    g.strokeStyle = 'rgba(127,232,255,0.9)';
    g.lineWidth = 2;
    g.strokeRect(bx, by + 20, 100, 18);
    const low = fuel < 0.2;
    g.fillStyle = burning ? '#ffcc66' : low ? '#ff5a4a' : '#6dffb0';
    g.fillRect(bx + 2, by + 22, Math.round(96 * Math.max(0, Math.min(1, fuel))), 14);
    g.fillStyle = '#7fe8ff';
    g.font = '14px monospace';
    g.fillText(fuel <= 0.004 ? 'EMPTY' : `${Math.round(fuel * 100)} %`, bx, by + 58);
    g.fillText(burning ? 'BURNING' : 'J / 2 TRIGGERS', bx, by + 76);
    this.texture.needsUpdate = true;
    this.stats.redraws++;
  }

  update(dt, game) {
    const level = game.level;
    if (!level || !level.bounds) return;
    this._t += dt > 0 ? dt : 0;
    if (this._levelKey !== level) this._build(level);
    const p = game.player;
    const live = game.state === 'playing' || game.state === 'dead';
    const mounted = this._mountFace(game);
    const wm = game.wristMap;
    const k = wm ? wm.k : 0;
    // ---- the face ----
    const showFace = mounted && live && (game.xrActive || k > 0.02 || !!game.jet);
    this.face.visible = showFace;
    if (showFace && p) {
      const depth = Math.max(0, Math.round(U.depthMeters(p.y)));
      const si = game.sectionIndex | 0;
      const sec = level.sections && level.sections[si] ? level.sections[si].name : '';
      this._drawFace(depth, String(sec).slice(0, 18).toUpperCase(), game.jet ? game.jet.fuel : 0, !!(game.jet && game.jet.burning));
    }
    // ---- the hologram ----
    const open = k > 0.01 && live && !!this.lines;
    this.root.visible = open;
    this.stats.open = open;
    if (!open) return;
    const g = this.geo;
    // you
    g.toDisplay(p.rx, p.ry, p.rz, this._tmp);
    this._lastT; // (kept: the trail)
    const youY = this._tmp.y;
    this.lineMat.uniforms.uTime.value = this._t;
    this.lineMat.uniforms.uYou.value = youY;
    this.lineMat.uniforms.uK.value = k;
    const pulse = 0.85 + 0.15 * Math.sin(this._t * 6);
    const m = this._mtx;
    const put = (i, x, y, z, s) => {
      this._p.set(x, y, z);
      this._s.set(s, s, s);
      m.compose(this._p, this._q.identity(), this._s);
      this.markers.setMatrixAt(i, m);
    };
    put(0, g.start.x, g.start.y, g.start.z, 0.0075 * k);
    put(1, g.goal.x, g.goal.y, g.goal.z, 0.009 * k * (0.9 + 0.2 * Math.sin(this._t * 3)));
    put(2, this._tmp.x, this._tmp.y, this._tmp.z, 0.0065 * pulse * k);
    for (let i = 0; i < g.ticks.length; i++) put(3 + i, g.size.x * 0.5 + 0.004, g.ticks[i], 0, 0.0022 * k); // boundary ticks down the right edge
    this.markers.instanceMatrix.needsUpdate = true;
    this.ring.position.set(this._tmp.x, this._tmp.y, this._tmp.z);
    const rs = (0.008 + 0.012 * ((this._t * 0.8) % 1)) * k;
    this.ring.scale.set(rs, rs, rs);
    this.ring.material.opacity = 0.8 * (1 - ((this._t * 0.8) % 1)) * k;
    // the trail (a new point every trailStep model metres)
    const dx = p.rx - this._lastT.x;
    const dy = p.ry - this._lastT.y;
    const dz = p.rz - this._lastT.z;
    if (dx * dx + dy * dy + dz * dz >= HOLO.trailStep * HOLO.trailStep && this._trailN < HOLO.maxTrail) {
      const pos = this.trail.geometry.getAttribute('position');
      pos.setXYZ(this._trailN++, this._tmp.x, this._tmp.y, this._tmp.z);
      pos.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this._trailN);
      this._lastT.set(p.rx, p.ry, p.rz);
    }
    this.trail.material.opacity = 0.55 * k;
    // the placement
    this.pivot.rotation.y = this._t * 0.35;
    const cam = game.renderer && game.renderer.camera;
    if (game.xrActive) {
      if (this.root.parent !== game.renderer.scene) game.renderer.scene.add(this.root);
      const wp = this._wp;
      if (this.face.parent) this.face.getWorldPosition(wp);
      else wp.set(p.rx, p.ry + 1, p.rz);
      this.root.position.set(wp.x, wp.y + HOLO.floatY * (0.6 + 0.4 * k), wp.z);
      this.root.scale.setScalar(0.6 + 0.4 * k);
    } else if (cam) {
      if (this.root.parent !== cam) cam.add(this.root);
      this.root.position.set(HOLO.desk.x, HOLO.desk.y + 0.18, HOLO.desk.z);
      this.root.scale.setScalar(0.5 + 0.5 * k);
    }
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    if (this.face.parent) this.face.parent.remove(this.face);
    for (const o of [this.lines, this.markers, this.trail, this.ring]) {
      if (!o) continue;
      o.geometry.dispose();
      o.material.dispose();
    }
    this.face.geometry.dispose();
    this.faceMat.dispose();
    if (this.texture) this.texture.dispose();
  }
}
