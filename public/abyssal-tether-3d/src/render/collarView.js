/* THE LANTERN — render/collarView.js
 * THE COLLAR's picture for the opening cinematic (docs/abyssal-tether-3d/plans/OPENING_V2_THE_COLLAR.md; the film is
 * sim/openingCinematic.js, render/openingView.js owns this and calls update() with the same snapshot):
 *
 *   the station        render/facilityKit.js buildCollar() (another owner's models), moved so its irisCenter sits at COLLAR.iris; its
 *                      real lights are taken out (a light changes every material's program: the Quest budget) and drawn as glow points.
 *                      Until the kit loads, or when it is missing: a PLACEHOLDER (the deck round the opening, the gantry, the console and
 *                      its empty chair, the pads, the LED strips) so the film, the tests and the stills work today.
 *   the iris           eight leaves over the opening (one instanced mesh) unless the kit returns setIris(k)
 *   the cradle         buildCradle() (or a placeholder cage), its tag (CRADLE 01 · PAYLOAD 1 · RETURN 0) and the console's screen
 *   the drones         4 x buildDrone() (or placeholder bodies), rotors spun when the kit names them, tilted into their motion; their
 *                      LEDs and lenses (one points draw) and their down-light beams (one instanced mesh of additive cones)
 *   the scan           the measuring line (one additive plane) that sweeps the cradle, head to boots
 *   the line           his line, from the cradle's spool up to the winch on the gantry (one thin cylinder)
 *
 * Draw calls (placeholder): station 5, iris 1, cradle 3 + tag 1, screen 1, drones 4, glows 1, beams 1, scan 1, line 1. Each hides when
 * the film says so (the station from CUT2, the drones from ACT3, all of it at the waking). No per-frame allocation, no Math.random.
 */
import * as THREE from 'three';
import { COLLAR, CRADLE_X, CRADLE_Z, CRADLE_PLATE, SCREEN } from '../sim/openingCinematic.js';

const FONT_UI = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";
const MAX_GLOWS = 40; // 4 LEDs + 4 lenses + the kit's lights (capped)
const BEAM_LEN = 15;
const BEAM_R = 3.4;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

function canvas(w, h) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = w;
  c.height = h;
  return c;
}

/** One BufferGeometry from several (position, normal, uv; indexed): a whole placeholder piece in one draw. */
function merge(list) {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let ov = 0;
  let oi = 0;
  for (const g of list) {
    const p = g.attributes.position;
    pos.set(p.array, ov * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, ov * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, ov * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.array[i] + ov;
    else for (let i = 0; i < p.count; i++) idx[oi + i] = i + ov;
    ov += p.count;
    oi += g.index ? g.index.count : p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
/** A box from its min / max corners (world units). */
function box(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
function cyl(r, h, x, y, z, seg) {
  const g = new THREE.CylinderGeometry(r, r, h, seg || 12);
  g.translate(x, y, z);
  return g;
}
function mesh(geo, mat, name) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** The screen and the tag: one canvas (the screen above, the tag strip below), drawn once. */
function makeTextTexture() {
  const c = canvas(512, 384);
  if (!c) return null;
  const x = c.getContext('2d');
  x.fillStyle = '#05090c';
  x.fillRect(0, 0, 512, 288);
  x.strokeStyle = 'rgba(120,220,255,0.35)';
  x.lineWidth = 2;
  x.strokeRect(10, 10, 492, 268);
  x.textBaseline = 'middle';
  x.fillStyle = 'rgba(150,230,255,0.95)';
  x.font = `600 40px ${FONT_UI}`;
  x.fillText(SCREEN.head, 28, 52);
  x.font = `500 34px ${FONT_UI}`;
  for (let i = 0; i < SCREEN.rows.length; i++) {
    x.fillStyle = i === SCREEN.rows.length - 1 ? 'rgba(255,190,120,0.95)' : 'rgba(150,230,255,0.85)';
    x.fillText(SCREEN.rows[i], 28, 118 + i * 52);
  }
  // the tag strip (the cradle's rail plate)
  x.fillStyle = '#d9dde0';
  x.fillRect(0, 300, 512, 84);
  x.fillStyle = '#20262b';
  x.font = `700 30px ${FONT_UI}`;
  x.textAlign = 'center';
  x.fillText(SCREEN.tag, 256, 342);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function plane(w, h, v0, v1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0);
  return g;
}

/** The drones' down-lights: additive cones, apex at the lens, fading along their length and at their rim (per-instance intensity). */
function makeBeams() {
  const g = new THREE.ConeGeometry(BEAM_R, BEAM_LEN, 20, 1, true);
  g.translate(0, -BEAM_LEN / 2, 0); // ConeGeometry's apex is at +Y: the apex at the origin (the lens), widening down to -BEAM_LEN
  const aI = new THREE.InstancedBufferAttribute(new Float32Array(4), 1);
  g.setAttribute('aI', aI);
  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float aI; varying float vI; varying float vD; varying vec3 vN; varying vec3 vV;
      void main() {
        vI = aI;
        vD = clamp(-position.y / ${BEAM_LEN.toFixed(1)}, 0.0, 1.0);
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      varying float vI; varying float vD; varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = abs(dot(normalize(vN), normalize(vV)));
        float a = vI * (1.0 - vD) * (1.0 - vD) * smoothstep(0.0, 0.6, rim) * 0.16;
        if (a < 0.002) discard;
        gl_FragColor = vec4(vec3(0.72, 0.86, 1.0) * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const m = new THREE.InstancedMesh(g, mat, 4);
  m.name = 'AT3D-collar-beams';
  m.frustumCulled = false;
  m.renderOrder = 50;
  return m;
}

/** The glows: points with their own colour and size (the drones' LEDs and lenses, the kit's lights). */
function makeGlows() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_GLOWS * 3), 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(MAX_GLOWS * 4), 4)); // rgb, size (m)
  g.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 720 } },
    vertexShader: `
      attribute vec4 aCol; uniform float uPx; varying vec3 vC;
      void main() {
        vC = aCol.rgb;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float z = max(0.05, -mv.z);
        gl_PointSize = clamp(aCol.a * uPx * projectionMatrix[1][1] * 0.5 / z, 1.5, 64.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = dot(c, c);
        if (r > 1.0) discard;
        float a = exp(-r * 4.0) + 0.6 * exp(-r * 30.0);
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const p = new THREE.Points(g, mat);
  p.name = 'AT3D-collar-glows';
  p.frustumCulled = false;
  p.renderOrder = 52;
  return p;
}

/** The measuring line: a horizontal plane round the cradle, a bright rim and faint scan rules. */
function makeScan() {
  const g = new THREE.PlaneGeometry(2.9, 2.9);
  g.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uT: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uA; uniform float uT; varying vec2 vUv;
      void main() {
        vec2 d = abs(vUv - 0.5) * 2.0;
        float edge = smoothstep(0.9, 0.985, max(d.x, d.y)) * (1.0 - smoothstep(0.985, 1.0, max(d.x, d.y)));
        float rules = 0.5 + 0.5 * sin(vUv.x * 140.0 + uT * 9.0);
        float a = uA * (edge * 0.9 + 0.05 + 0.05 * rules);
        gl_FragColor = vec4(vec3(0.62, 0.92, 1.0) * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const m = new THREE.Mesh(g, mat);
  m.name = 'AT3D-collar-scan';
  m.frustumCulled = false;
  m.renderOrder = 51;
  return m;
}

export class CollarView {
  /** @param {THREE.Object3D} root  the opening's root (hidden with the film) */
  constructor(root) {
    this.root = new THREE.Group();
    this.root.name = 'AT3D-collar';
    root.add(this.root);
    this.mats = {
      white: new THREE.MeshStandardMaterial({ color: 0xd8dcdf, roughness: 0.42, metalness: 0.08, emissive: 0x1a1f24, emissiveIntensity: 0.6 }),
      graphite: new THREE.MeshStandardMaterial({ color: 0x2a2f34, roughness: 0.55, metalness: 0.35, emissive: 0x07090b, emissiveIntensity: 0.6 }),
      led: new THREE.MeshBasicMaterial({ color: 0xbfe8ff, fog: false, toneMapped: false }),
      rope: new THREE.MeshStandardMaterial({ color: 0xb8762e, roughness: 0.8, metalness: 0.0, emissive: 0x2a1406, emissiveIntensity: 0.5 }),
    };
    this.textTex = makeTextTexture();
    this.textMat = new THREE.MeshBasicMaterial({ map: this.textTex, toneMapped: false });

    // ---- the station (placeholder until the kit) ----
    this.station = new THREE.Group();
    this.station.name = 'AT3D-collar-station';
    this.root.add(this.station);
    this._kitStation = null;
    this._buildStationPlaceholder();

    // ---- the iris ----
    const sec = new THREE.CircleGeometry(COLLAR.irisR + 0.05, 6, -Math.PI / 8, Math.PI / 4);
    sec.rotateX(-Math.PI / 2);
    this.iris = new THREE.InstancedMesh(sec, this.mats.graphite, 8);
    this.iris.name = 'AT3D-collar-iris';
    this.iris.frustumCulled = false;
    this.root.add(this.iris);
    this._setIris = null; // the kit's own, if it has one
    this._irisK = -1;

    // ---- the console's screen (the empty chair is in the station) ----
    const cs = COLLAR.console;
    this.screen = mesh(plane(0.92, 0.52, 0.25, 1), this.textMat, 'AT3D-collar-screen');
    this.screen.position.set(cs.x, cs.y + 1.18, cs.z - 0.18);
    this.screen.rotation.set(-0.32, 0, 0); // facing +Z (the chair), tilted back
    this.root.add(this.screen);

    // ---- the cradle ----
    this.cradle = new THREE.Group();
    this.cradle.name = 'AT3D-collar-cradle';
    this.root.add(this.cradle);
    this._cradleModel = null;
    this._buildCradlePlaceholder();
    this.tag = mesh(plane(0.62, 0.1, 0, 0.22), this.textMat, 'AT3D-collar-tag');
    this.tag.position.set(0, 1.0, 0.965); // on the south hip rail, facing out (+Z)
    this.cradle.add(this.tag);

    // ---- the drones ----
    this.drones = [];
    this._prev = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.name = `AT3D-collar-drone-${i}`;
      g.add(this._droneModelPlaceholder());
      g.userData.rotors = [];
      this.root.add(g);
      this.drones.push(g);
      this._prev.push(new THREE.Vector3(NaN, 0, 0));
    }
    this.glows = makeGlows();
    this.root.add(this.glows);
    this._kitLights = []; // world positions + colours of the kit's lights (glows)
    this.beams = makeBeams();
    this.root.add(this.beams);

    // ---- the scan, the line ----
    this.scan = makeScan();
    this.root.add(this.scan);
    const lg = new THREE.CylinderGeometry(0.014, 0.014, 1, 6, 1, true);
    lg.translate(0, 0.5, 0);
    this.line = mesh(lg, this.mats.rope, 'AT3D-collar-line');
    this.line.frustumCulled = false;
    this.root.add(this.line);

    this._warned = false;
    this._kit = null;
    this._loadKit();
  }

  // ---- the placeholder (boxes: the kit replaces it) ---------------------------------------------------------------------------
  _buildStationPlaceholder() {
    const D = COLLAR.deckY;
    // the deck: a plate round the opening with a round hole for the iris (an extruded shape: one draw)
    const sh = new THREE.Shape();
    sh.moveTo(-20, -20);
    sh.lineTo(20, -20);
    sh.lineTo(20, 24);
    sh.lineTo(-20, 24);
    sh.lineTo(-20, -20);
    const hole = new THREE.Path();
    hole.absarc(COLLAR.iris.x, -COLLAR.iris.z, COLLAR.irisR, 0, Math.PI * 2, true);
    sh.holes.push(hole);
    const deck = new THREE.ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: false, curveSegments: 40 });
    deck.rotateX(-Math.PI / 2); // shape XY -> XZ (y up), depth -> +y
    deck.translate(0, D - 0.4, 0);
    const deckM = mesh(deck, this.mats.white, 'AT3D-collar-deck');
    this.station.add(deckM);
    // the gantry over the cradle line (the line's winch), the console and its empty chair, the pads' plinths
    const W = COLLAR.winchY;
    const cs = COLLAR.console;
    const parts = [
      box(-14.3, -13.7, D, W + 0.4, CRADLE_Z - 0.3, CRADLE_Z + 0.3),
      box(13.7, 14.3, D, W + 0.4, CRADLE_Z - 0.3, CRADLE_Z + 0.3),
      box(-14.3, 14.3, W + 0.1, W + 0.5, CRADLE_Z - 0.35, CRADLE_Z + 0.35),
      box(CRADLE_X - 0.45, CRADLE_X + 0.45, W - 0.35, W + 0.1, CRADLE_Z + 0.25, CRADLE_Z + 0.95), // the winch
      box(cs.x - 0.8, cs.x + 0.8, D, D + 0.74, cs.z - 0.4, cs.z + 0.4), // the desk
      box(cs.x - 0.06, cs.x + 0.06, D + 0.74, D + 1.0, cs.z - 0.25, cs.z - 0.13), // the screen's stand
      box(cs.x - 0.28, cs.x + 0.28, D + 0.42, D + 0.5, cs.z + 0.6, cs.z + 1.12), // the chair's seat
      box(cs.x - 0.28, cs.x + 0.28, D + 0.5, D + 1.15, cs.z + 1.08, cs.z + 1.16), // its back
      box(cs.x - 0.04, cs.x + 0.04, D, D + 0.42, cs.z + 0.82, cs.z + 0.9), // its post
    ];
    for (const p of COLLAR.pads) parts.push(cyl(0.95, 0.06, p[0], D + 0.03, p[2], 24));
    this.station.add(mesh(merge(parts), this.mats.graphite, 'AT3D-collar-frame'));
    // the LED strips: round the opening's rim (an octagon of thin bars), along the bay, round each pad
    const leds = [];
    const R = COLLAR.irisR + 0.35;
    for (let k = 0; k < 16; k++) {
      const a0 = (k / 16) * Math.PI * 2;
      const a1 = ((k + 1) / 16) * Math.PI * 2;
      const x0 = Math.cos(a0) * R;
      const z0 = Math.sin(a0) * R;
      const x1 = Math.cos(a1) * R;
      const z1 = Math.sin(a1) * R;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.BoxGeometry(len, 0.03, 0.06);
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      g.translate((x0 + x1) / 2 + COLLAR.iris.x, D + 0.015, (z0 + z1) / 2 + COLLAR.iris.z);
      leds.push(g);
    }
    leds.push(box(-19.5, 19.5, D, D + 0.03, 19.4, 19.5));
    leds.push(box(-19.5, 19.5, W + 0.08, W + 0.11, CRADLE_Z - 0.36, CRADLE_Z - 0.3));
    for (const p of COLLAR.pads) {
      const r = new THREE.TorusGeometry(0.9, 0.025, 4, 24);
      r.rotateX(Math.PI / 2);
      r.translate(p[0], D + 0.07, p[2]);
      leds.push(r);
    }
    this.station.add(mesh(merge(leds), this.mats.led, 'AT3D-collar-leds'));
  }

  _buildCradlePlaceholder() {
    // origin: the floor plate's top centre; the frame white, the plate and the spool graphite, the spool's light an LED
    const h = 1.9 / 2;
    const P = CRADLE_PLATE;
    const frame = [];
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) frame.push(box(sx * h - 0.04, sx * h + 0.04, 0, 2.45, sz * h - 0.04, sz * h + 0.04));
    frame.push(box(-h, h, 2.4, 2.48, -h - 0.04, -h + 0.04), box(-h, h, 2.4, 2.48, h - 0.04, h + 0.04));
    frame.push(box(-h - 0.04, -h + 0.04, 2.4, 2.48, -h, h), box(h - 0.04, h + 0.04, 2.4, 2.48, -h, h));
    frame.push(box(-h, h, 0.98, 1.04, -h - 0.03, -h + 0.03), box(-h, h, 0.98, 1.04, h - 0.03, h + 0.03)); // the hip rails
    frame.push(box(-h - 0.03, -h + 0.03, 0.98, 1.04, -h, h), box(h - 0.03, h + 0.03, 0.98, 1.04, -h, h));
    frame.push(box(-0.04, 0.04, 1.04, 1.95, -h - 0.03, -h + 0.03)); // the lantern's hook post (north rail)
    const fm = mesh(merge(frame), this.mats.white, 'AT3D-collar-cradle-frame');
    const plate = merge([
      box(-h, h, -P, 0, -h, h),
      cyl(0.17, 0.5, 0, 1.15, h + 0.12, 14), // the line's spool on the south rail
    ]);
    const pm = mesh(plate, this.mats.graphite, 'AT3D-collar-cradle-plate');
    const lamp = mesh(merge([box(-0.3, 0.3, 1.32, 1.35, h + 0.05, h + 0.2), box(-h, h, -P - 0.01, -P + 0.02, -h - 0.01, -h + 0.02)]), this.mats.led, 'AT3D-collar-cradle-led');
    const g = new THREE.Group();
    g.add(fm, pm, lamp);
    this._setCradleModel(g);
  }

  _setCradleModel(g) {
    if (this._cradleModel) {
      this.cradle.remove(this._cradleModel);
      this._disposeTree(this._cradleModel, true);
    }
    this._cradleModel = g;
    this.cradle.add(g);
  }

  _droneModelPlaceholder() {
    const parts = [box(-0.36, 0.36, -0.11, 0.11, -0.26, 0.26)];
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const ring = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 16, 1, true);
      ring.translate(sx * 0.52, 0.02, sz * 0.42);
      parts.push(ring, box(Math.min(0, sx * 0.52), Math.max(0, sx * 0.52), -0.02, 0.02, sz * 0.42 - 0.02, sz * 0.42 + 0.02));
    }
    parts.push(box(-0.06, 0.06, -0.3, -0.11, -0.06, 0.06)); // the clamp's arm
    const m = mesh(merge(parts), this.mats.white, 'AT3D-collar-drone-body');
    m.userData.placeholder = true;
    return m;
  }

  // ---- the kit ----------------------------------------------------------------------------------------------------------------
  _loadKit() {
    let p = null;
    try {
      p = import('./facilityKit.js');
    } catch {
      p = null;
    }
    if (!p || typeof p.then !== 'function') return;
    p.then((m) => this._useKit(m)).catch(() => {
      /* not merged yet / not shipped: the placeholder stays */
    });
  }

  /** Swap in render/facilityKit.js's models (each piece separately: a missing function keeps its placeholder). */
  _useKit(K) {
    if (!K || this._disposed) return;
    this._kit = K;
    try {
      if (typeof K.buildCollar === 'function') {
        const c = K.buildCollar();
        if (c && c.group) {
          const ic = c.irisCenter || COLLAR.iris;
          c.group.position.x += COLLAR.iris.x - ic.x;
          c.group.position.y += COLLAR.iris.y - ic.y;
          c.group.position.z += COLLAR.iris.z - ic.z;
          c.group.updateMatrixWorld(true);
          this._stripLights(c.group, true);
          for (const ch of this.station.children.slice()) {
            this.station.remove(ch);
            this._disposeTree(ch, false);
          }
          this.station.add(c.group);
          this._kitStation = c;
          if (typeof c.setIris === 'function') {
            this._setIris = c.setIris;
            this.iris.visible = false;
          }
          this._checkKit(c);
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[collar] buildCollar failed; the placeholder stays', err);
    }
    try {
      if (typeof K.buildCradle === 'function') {
        const g = K.buildCradle();
        if (g && g.isObject3D) {
          this._stripLights(g, false);
          this._setCradleModel(g);
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[collar] buildCradle failed; the placeholder stays', err);
    }
    try {
      if (typeof K.buildDrone === 'function') {
        for (let i = 0; i < 4; i++) {
          const g = K.buildDrone({ index: i });
          if (!g || !g.isObject3D) continue;
          this._stripLights(g, false);
          const d = this.drones[i];
          for (const ch of d.children.slice()) {
            d.remove(ch);
            this._disposeTree(ch, true);
          }
          d.add(g);
          const rotors = [];
          g.traverse((o) => {
            if (o !== g && /rotor|prop|fan/i.test(o.name || '')) rotors.push(o);
          });
          d.userData.rotors = rotors;
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[collar] buildDrone failed; the placeholder stays', err);
    }
  }

  /** Real lights out of the kit (the Quest light budget; a light added mid-game recompiles every program): a glow point at each. */
  _stripLights(g, glow) {
    const found = [];
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (o.isLight) found.push(o);
    });
    for (const l of found) {
      if (glow && this._kitLights.length < MAX_GLOWS - 8) {
        l.getWorldPosition(_v);
        const col = l.color ? l.color.clone() : new THREE.Color(0xbfe8ff);
        this._kitLights.push({ x: _v.x, y: _v.y, z: _v.z, r: col.r, g: col.g, b: col.b });
      }
      if (l.parent) l.parent.remove(l);
    }
  }

  _checkKit(c) {
    if (this._warned || typeof console === 'undefined') return;
    const bad = [];
    const pads = Array.isArray(c.dronePads) ? c.dronePads : [];
    const off = c.group.position;
    for (let i = 0; i < Math.min(4, pads.length); i++) {
      const p = pads[i];
      const q = COLLAR.pads[i];
      if (p && Math.hypot(p.x + off.x - q[0], p.z + off.z - q[2]) > 0.5) bad.push(`pad ${i}`);
    }
    const a = c.cageAnchor;
    if (a && Math.hypot(a.x + off.x - CRADLE_X, a.z + off.z - CRADLE_Z) > 0.5) bad.push('cageAnchor');
    if (bad.length) {
      this._warned = true;
      console.warn(`[collar] facilityKit differs from the film's COLLAR (sim/openingCinematic.js) by > 0.5 m: ${bad.join(', ')}`);
    }
  }

  // ---- per frame --------------------------------------------------------------------------------------------------------------
  /**
   * @param {object} s  sampleOpening() snapshot
   * @param {{xr:boolean, px:number}} o
   */
  update(s, o) {
    const t = s.t;
    // the station and the iris
    const st = !!s.collar.on;
    this.station.visible = st;
    this.screen.visible = st;
    const k = s.iris.open;
    if (this._setIris) {
      if (Math.abs(k - this._irisK) > 1e-4) {
        try {
          this._setIris(k);
        } catch {
          this._setIris = null;
        }
        this._irisK = k;
      }
    } else {
      this.iris.visible = st;
      if (st && Math.abs(k - this._irisK) > 1e-4) {
        this._irisK = k;
        const I = COLLAR.iris;
        const drop = 0.45 * Math.min(1, k * 5);
        const out = COLLAR.irisR * 0.98 * k;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          _q.setFromAxisAngle(AXIS_Y, a);
          _v.set(I.x + Math.cos(a) * out, I.y - 0.03 - drop, I.z - Math.sin(a) * out);
          _m.compose(_v, _q, _s);
          this.iris.setMatrixAt(i, _m);
        }
        this.iris.instanceMatrix.needsUpdate = true;
      }
    }
    // the cradle
    const c = s.cradle;
    this.cradle.visible = !!c.on;
    this.cradle.position.set(c.x, c.y, c.z);
    // the drones: placed, tilted into their motion (the view's own memory of the last frame), rotors spun
    let ng = 0;
    const gp = this.glows.geometry.attributes.position;
    const gc = this.glows.geometry.attributes.aCol;
    const dt = Math.max(1e-3, Math.min(0.1, t - (this._lastT == null ? t : this._lastT)));
    for (let i = 0; i < 4; i++) {
      const d = s.drones[i];
      const g = this.drones[i];
      g.visible = !!d.on;
      const pv = this._prev[i];
      let vx = 0;
      let vz = 0;
      if (Number.isFinite(pv.x) && t > this._lastT) {
        vx = (d.x - pv.x) / dt;
        vz = (d.z - pv.z) / dt;
      }
      pv.set(d.x, d.y, d.z);
      const lim = 0.32;
      g.position.set(d.x, d.y, d.z);
      g.rotation.set(Math.max(-lim, Math.min(lim, vz * 0.06)), 0, Math.max(-lim, Math.min(lim, -vx * 0.06)));
      const rot = g.userData.rotors;
      for (let r = 0; r < rot.length; r++) rot[r].rotation.y += d.rot * 1.9 * (r & 1 ? -1 : 1);
      if (!d.on) continue;
      // the status LED (cool white) and the lens under the body (its beam's source)
      if (d.led > 0.01) {
        gp.setXYZ(ng, d.x, d.y + 0.14, d.z);
        gc.setXYZW(ng, 0.75 * d.led, 0.95 * d.led, 1.0 * d.led, 0.07);
        ng++;
      }
      if (d.beam > 0.01) {
        gp.setXYZ(ng, d.x, d.y - 0.16, d.z);
        gc.setXYZW(ng, 0.85 * d.beam, 0.93 * d.beam, 1.0 * d.beam, 0.22);
        ng++;
      }
      _v.set(d.x, d.y - 0.16, d.z);
      _q.identity();
      _m.compose(_v, _q, _s);
      this.beams.setMatrixAt(i, _m);
      this.beams.geometry.attributes.aI.setX(i, d.beam);
    }
    this._lastT = t;
    if (st) {
      for (let j = 0; j < this._kitLights.length && ng < MAX_GLOWS; j++) {
        const L = this._kitLights[j];
        gp.setXYZ(ng, L.x, L.y, L.z);
        gc.setXYZW(ng, L.r, L.g, L.b, 0.18);
        ng++;
      }
    }
    this.glows.geometry.setDrawRange(0, ng);
    this.glows.visible = ng > 0;
    if (ng > 0) {
      gp.needsUpdate = true;
      gc.needsUpdate = true;
      this.glows.material.uniforms.uPx.value = o && o.xr ? 1600 : o && o.px > 0 ? o.px : 720;
    }
    let anyBeam = false;
    for (let i = 0; i < 4; i++) if (s.drones[i].on && s.drones[i].beam > 0.01) anyBeam = true;
    this.beams.visible = anyBeam;
    if (anyBeam) {
      this.beams.instanceMatrix.needsUpdate = true;
      this.beams.geometry.attributes.aI.needsUpdate = true;
    }
    // the scan
    this.scan.visible = s.scan.a > 0.003;
    if (this.scan.visible) {
      this.scan.position.set(c.x, s.scan.y, c.z);
      this.scan.material.uniforms.uA.value = s.scan.a;
      this.scan.material.uniforms.uT.value = t;
    }
    // the line: the spool up to the winch
    const li = s.line;
    this.line.visible = !!li.on && li.y1 > li.y0 + 0.05;
    if (this.line.visible) {
      this.line.position.set(li.x, li.y0, li.z);
      this.line.scale.set(1, li.y1 - li.y0, 1);
    }
  }

  _disposeTree(o, materials) {
    o.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (materials && n.material && !Object.values(this.mats).includes(n.material) && n.material !== this.textMat) {
        const ms = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of ms) m.dispose();
      }
    });
  }

  dispose() {
    this._disposed = true;
    if (this.root.parent) this.root.parent.remove(this.root);
    this._disposeTree(this.root, true);
    for (const m of Object.values(this.mats)) m.dispose();
    this.textMat.dispose();
    if (this.textTex) this.textTex.dispose();
    this.beams.material.dispose();
    this.glows.material.dispose();
    this.scan.material.dispose();
  }
}
