/* THE LANTERN — render/openingView.js
 * The picture of the opening cinematic (sim/openingCinematic.js is the film; this draws its snapshot on the live scene):
 *
 *   the hero lantern   the gauntlet lantern's own model (player_arms.glb `Lantern`, cloned from HandsView) at 2.6x on a pivot that
 *                      sways from its hook; a procedural FLAME (one additive lathe, bent by the lean, shrunk by the gutter); a HALO
 *                      (one sprite: the lantern reads as a star 30 m away). The game's own lantern LIGHT (Renderer3D.lanternGroup) is
 *                      borrowed into its glass for the film (attach / release are the game's job: OpeningView.socket is the target).
 *   the chain          one InstancedMesh of iron links from the hook up into the dark (<= 240 links, 48 tris each)
 *   the letterbox      2.39:1 bars on the desktop (one quad pair, on the camera)
 *   the title          THE LANTERN + I · THE UNDERSPIRE, ember gold, a canvas texture on a plate (desktop: on the camera; a headset:
 *                      world-locked 6 m ahead of the vantage), lit from inside by the hit
 *   the subtitles      the narration's words (one canvas, redrawn only when the line changes)
 *   the skip ring      fills while the skip input is held (desktop: lower right; a headset: below the line of sight)
 *
 * Draw calls while it plays: lantern 1, flame 1, halo 1, chain 1, bars 1, title 1, subtitles 1, ring 1 (each hidden when idle).
 * No per-frame allocation: scratch objects are module constants.
 */
import * as THREE from 'three';
import { TITLE } from '../sim/openingCinematic.js';

const ORDER = { bars: 926, title: 930, caption: 931, ring: 933 };
const MAX_LINKS = 240;
const LINK_PITCH = 0.118; // m between link centres
const SCALE = 2.6;
const SOCKET_Y = -0.068; // the glass centre below the hook (player_arms.glb Lantern_Socket), model units
const FONT_DISPLAY = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Noto Serif', 'DejaVu Serif', serif";
const FONT_UI = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _w2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const TWIST = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

function canvas(w, h) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = w;
  c.height = h;
  return c;
}

/** The flame: a teardrop lathe, additive, bent along `uLean` (x, z: the direction times the angle) from its base up. */
function makeFlame() {
  const pts = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const v = i / N;
    const r = Math.sin(Math.PI * Math.pow(v, 0.62)) * (1 - 0.55 * v) * 0.5; // fat low, a point at the top
    pts.push(new THREE.Vector2(Math.max(0.0001, r), v));
  }
  const g = new THREE.LatheGeometry(pts, 10);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLean: { value: new THREE.Vector2() }, uI: { value: 1 }, uH: { value: 1 } },
    vertexShader: `
      uniform float uTime; uniform vec2 uLean; uniform float uH;
      varying float vH; varying float vR;
      void main() {
        vec3 p = position;
        float h = p.y;
        vH = h; vR = length(p.xz) * 2.0;
        p.y *= uH;
        float w = sin(uTime * 13.0 + h * 7.0) * 0.06 * h * h + sin(uTime * 7.3 + 1.7) * 0.03 * h;
        p.x += (uLean.x * 2.6 + w) * h * h;
        p.z += (uLean.y * 2.6 + w * 0.6) * h * h;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uI;
      varying float vH; varying float vR;
      void main() {
        vec3 core = vec3(1.0, 0.93, 0.72);
        vec3 edge = vec3(1.0, 0.42, 0.08);
        vec3 blue = vec3(0.25, 0.35, 1.0);
        float k = smoothstep(0.0, 0.9, vR);
        vec3 c = mix(core, edge, k * 0.85 + vH * 0.25);
        c = mix(c, blue, (1.0 - smoothstep(0.0, 0.18, vH)) * 0.55);
        float a = (1.0 - k * 0.7) * (1.0 - smoothstep(0.55, 1.0, vH) * 0.6);
        gl_FragColor = vec4(c * uI * a * 1.6, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false, // seen through the lantern's (opaque, glowing) glass: it reads as lit from inside
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 60;
  mesh.name = 'AT3D-opening-flame';
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The dust in the lantern's light: one Points draw, every particle placed in the vertex shader from a fixed seed (no CPU per frame,
 * no Math.random: a seeded LCG at build time). Two kinds: MOTES hang and drift in a 3 m column round the chain; GRIT (mortar shaken
 * loose by the chain) falls through the world at 3-5 m/s. Both are WORLD-anchored (they wrap in a window that travels with the
 * lantern, where the inverse-square light has already let them go dark), lit only by the lantern (the same falloff as its light),
 * so they read as depth round the hero and as speed past it on the way down.
 */
const DUST_N = 560;
function makeDust() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(DUST_N * 3); // unused by the shader (bounds only)
  const seed = new Float32Array(DUST_N * 4);
  let s = 1791;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < DUST_N; i++) {
    seed[i * 4] = rnd(); // radius
    seed[i * 4 + 1] = rnd(); // angle
    seed[i * 4 + 2] = rnd(); // height phase
    seed[i * 4 + 3] = i < DUST_N * 0.42 ? rnd() * 0.5 : 0.5 + rnd() * 0.5; // < 0.5: grit, >= 0.5: a mote (size inside the band)
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLan: { value: new THREE.Vector3() },
      uI: { value: 1 },
      uMotes: { value: 0 },
      uGrit: { value: 0 },
      uPx: { value: 720 },
    },
    vertexShader: `
      attribute vec4 aSeed;
      uniform float uTime; uniform vec3 uLan; uniform float uI; uniform float uMotes; uniform float uGrit; uniform float uPx;
      varying float vA; varying float vGrit;
      void main() {
        float grit = step(aSeed.w, 0.4999);
        vGrit = grit;
        float r = mix(0.12 + 2.9 * sqrt(aSeed.x), 0.25 + 3.4 * sqrt(aSeed.x), grit);
        float ang = aSeed.y * 6.2831853 + uTime * mix(0.05, 0.0, grit) * (aSeed.x - 0.5);
        // the window: 7 m tall, from 5 m under the lantern to 2 m over it; a particle's world height wraps inside it
        float H = 7.0;
        float lo = uLan.y - 5.0;
        float v = mix(0.035 + 0.04 * aSeed.z, 6.0 + 3.0 * aSeed.z, grit); // grit falls faster than the lantern descends: it passes it
        float yw = aSeed.z * 53.0 - uTime * v;
        float y = lo + mod(yw - lo, H);
        float edge = smoothstep(0.0, 0.9, y - lo) * smoothstep(0.0, 0.9, lo + H - y);
        vec3 p = vec3(uLan.x + cos(ang) * r, y, uLan.z + sin(ang) * r);
        p.x += (1.0 - grit) * 0.06 * sin(uTime * 0.37 + aSeed.y * 17.0);
        p.z += (1.0 - grit) * 0.06 * sin(uTime * 0.29 + aSeed.x * 23.0);
        vec3 d = p - uLan;
        float lit = uI / (0.12 + dot(d, d) * 1.1); // the lantern's own inverse-square fall-off
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float z = max(0.05, -mv.z);
        float sizeM = mix(0.0045 + 0.004 * (aSeed.w - 0.5), 0.006 + 0.006 * aSeed.w, grit);
        float px = sizeM * uPx * projectionMatrix[1][1] * 0.5 / z;
        float near = smoothstep(0.25, 0.7, z); // nothing on the lens
        vA = clamp(lit, 0.0, 2.2) * edge * near * mix(uMotes * 0.55, uGrit, grit) * clamp(px / 1.5, 0.25, 1.0);
        gl_PointSize = clamp(px, 1.5, 9.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA; varying float vGrit;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = dot(c, c);
        if (r > 1.0 || vA < 0.002) discard;
        float a = (1.0 - r) * (1.0 - r) * vA;
        vec3 col = mix(vec3(1.0, 0.74, 0.46), vec3(0.95, 0.66, 0.4), vGrit);
        gl_FragColor = vec4(col * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'AT3D-opening-dust';
  pts.frustumCulled = false;
  pts.renderOrder = 55;
  return pts;
}

function makeHaloTexture() {
  const c = canvas(128, 128);
  if (!c) return null;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,214,150,1)');
  g.addColorStop(0.12, 'rgba(255,170,80,0.55)');
  g.addColorStop(0.4, 'rgba(255,120,40,0.12)');
  g.addColorStop(1, 'rgba(255,100,30,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The title plate: the words once, at 2048 x 640 (they are lit from inside by the shader, not redrawn). */
function makeTitleTexture() {
  const c = canvas(2048, 640);
  if (!c) return null;
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  // THE LANTERN: wide-tracked display capitals, an ember gradient, a soft glow
  const word = TITLE.text.split('').join(' ');
  let size = 200;
  x.font = `600 ${size}px ${FONT_DISPLAY}`;
  while (x.measureText(word).width > c.width - 220 && size > 80) {
    size -= 6;
    x.font = `600 ${size}px ${FONT_DISPLAY}`;
  }
  const g = x.createLinearGradient(0, 160, 0, 400);
  g.addColorStop(0, '#ffe7b0');
  g.addColorStop(0.45, '#f2b25a');
  g.addColorStop(1, '#a8501c');
  x.shadowColor = 'rgba(255,140,40,0.85)';
  x.shadowBlur = 48;
  x.fillStyle = g;
  x.fillText(word, 1024, 280);
  x.shadowBlur = 0;
  x.fillText(word, 1024, 280);
  // the rule and the chapter
  x.fillStyle = 'rgba(242,178,90,0.75)';
  x.fillRect(724, 432, 600, 3);
  x.font = `500 54px ${FONT_DISPLAY}`;
  x.fillStyle = 'rgba(232,206,160,1)';
  x.fillText(TITLE.sub.split('').join(' '), 1024, 520);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeTitleMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uA: { value: 0 }, uGlow: { value: 0 }, uSub: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D map; uniform float uA; uniform float uGlow; uniform float uSub; uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        float title = step(0.36, vUv.y);           // the words (upper) / the rule + the chapter (lower)
        float a = c.a * mix(uSub, 1.0, title);
        // lit from inside: a slow flame shimmer travels through the letters, the hit's glow on top
        float sh = 0.86 + 0.14 * sin(vUv.x * 21.0 - uTime * 1.7) * sin(vUv.y * 9.0 + uTime * 1.1);
        vec3 col = c.rgb * (sh + uGlow * 1.8 * title);
        gl_FragColor = vec4(col, a * uA);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
}

/** The skip ring: a thin ring that fills clockwise (uP 0..1), a dim track behind it. */
function makeRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uP: { value: 0 }, uA: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uP; uniform float uA; varying vec2 vUv;
      void main() {
        vec2 d = vUv * 2.0 - 1.0;
        float r = length(d);
        float band = smoothstep(0.70, 0.74, r) * (1.0 - smoothstep(0.92, 0.96, r));
        float ang = atan(d.x, d.y) / 6.2831853 + 0.5;  // 0 at the bottom, clockwise from the top
        ang = fract(ang + 0.5);
        float on = step(ang, uP);
        vec3 c = mix(vec3(0.35, 0.32, 0.28), vec3(1.0, 0.78, 0.45), on);
        float a = band * mix(0.35, 1.0, on) * uA;
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
}

export class OpeningView {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'AT3D-opening';
    this.root.visible = false;
    scene.add(this.root);

    // the hero lantern: a pivot at the hook (it sways from there), the model, the socket at the glass (the game's light goes here)
    this.pivot = new THREE.Group();
    this.pivot.name = 'AT3D-opening-lantern';
    this.root.add(this.pivot);
    this.model = null; // cloned from HandsView once its GLB is in (attachModel)
    this.socket = new THREE.Object3D();
    this.socket.name = 'AT3D-opening-socket';
    this.socket.position.set(0, SOCKET_Y * SCALE, 0);
    this.pivot.add(this.socket);
    this.flame = makeFlame();
    this.flame.position.set(0, SOCKET_Y * SCALE - 0.03, 0);
    this.flame.scale.set(0.036, 0.085, 0.036);
    this.pivot.add(this.flame);
    const ht = makeHaloTexture();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ht, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    this.halo.name = 'AT3D-opening-halo';
    this.halo.position.copy(this.socket.position);
    this.pivot.add(this.halo);

    // the chain
    const lg = new THREE.TorusGeometry(0.046, 0.012, 4, 8);
    lg.scale(0.62, 1, 1); // an oval link, long axis up (the torus lies in XY; Y is the chain)
    const lm = new THREE.MeshStandardMaterial({ color: 0x3a342e, roughness: 0.55, metalness: 0.85 });
    this.chain = new THREE.InstancedMesh(lg, lm, MAX_LINKS);
    this.chain.name = 'AT3D-opening-chain';
    this.chain.frustumCulled = false;
    this.chain.count = 0;
    this.root.add(this.chain);

    // the dust in its light
    this.dust = makeDust();
    this.dust.visible = false;
    this.root.add(this.dust);

    // the letterbox (on the camera): two quads in one mesh
    const bars = new THREE.BufferGeometry();
    bars.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3));
    bars.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    this.bars = new THREE.Mesh(bars, new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, depthWrite: false, fog: false, transparent: true, toneMapped: false }));
    this.bars.name = 'AT3D-opening-bars';
    this.bars.renderOrder = ORDER.bars;
    this.bars.frustumCulled = false;
    this.bars.visible = false;
    camera.add(this.bars);
    this._barsKey = '';

    // the title
    const tt = makeTitleTexture();
    this.titleMat = makeTitleMaterial(tt);
    this.title = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.3125), this.titleMat);
    this.title.name = 'AT3D-opening-title';
    this.title.renderOrder = ORDER.title;
    this.title.frustumCulled = false;
    this.title.visible = false;
    scene.add(this.title);

    // the subtitles
    this._capCanvas = canvas(1600, 160);
    this._capTex = this._capCanvas ? new THREE.CanvasTexture(this._capCanvas) : null;
    if (this._capTex) this._capTex.colorSpace = THREE.SRGBColorSpace;
    this.captionMat = new THREE.MeshBasicMaterial({ map: this._capTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0 });
    this.caption = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), this.captionMat);
    this.caption.name = 'AT3D-opening-caption';
    this.caption.renderOrder = ORDER.caption;
    this.caption.frustumCulled = false;
    this.caption.visible = false;
    camera.add(this.caption);
    this._capId = null;

    // the skip ring (+ its label, drawn once)
    this.ringMat = makeRingMaterial();
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ringMat);
    this.ring.name = 'AT3D-opening-skip';
    this.ring.renderOrder = ORDER.ring;
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    const lc = canvas(512, 96);
    if (lc) {
      const x = lc.getContext('2d');
      x.font = `600 44px ${FONT_UI}`;
      x.textBaseline = 'middle';
      x.fillStyle = 'rgba(236,222,196,0.92)';
      x.fillText('HOLD TO SKIP', 8, 48);
    }
    const lt = lc ? new THREE.CanvasTexture(lc) : null;
    if (lt) lt.colorSpace = THREE.SRGBColorSpace;
    this.ringLabelMat = new THREE.MeshBasicMaterial({ map: lt, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0 });
    this.ringLabel = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1875), this.ringLabelMat);
    this.ringLabel.renderOrder = ORDER.ring;
    this.ringLabel.frustumCulled = false;
    this.ring.add(this.ringLabel);
    this.ringLabel.position.set(1.95, 0, 0);
    this.ringLabel.scale.set(2.6, 2.6, 1);
    camera.add(this.ring);

    this.active = false;
    this._time = 0;
  }

  /** Clone the gauntlet lantern's model (HandsView.lantern: the GLB one once it has loaded, else the procedural stand-in). */
  attachModel(src) {
    if (!src || (this.model && this.model.userData.src === src)) return;
    if (this.model) this.pivot.remove(this.model);
    const m = src.clone(true);
    m.userData.src = src;
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.setScalar(SCALE);
    m.visible = true;
    m.traverse((o) => {
      o.frustumCulled = false;
      if (o.isMesh) {
        o.visible = true;
        o.castShadow = false;
        o.renderOrder = 0;
      }
    });
    this.model = m;
    this.pivot.add(m);
  }

  setActive(on) {
    this.active = !!on;
    this.root.visible = this.active;
    if (!this.active) {
      this.title.visible = false;
      this.caption.visible = false;
      this.bars.visible = false;
      this.ring.visible = false;
      this.chain.count = 0;
    }
  }

  /**
   * Draw the snapshot.
   * @param {number} dt
   * @param {object} s       sampleOpening() snapshot
   * @param {{xr:boolean, aspect:number, skip:number, skipHint:number, reduced:boolean, head:THREE.Vector3}} o
   */
  update(dt, s, o) {
    if (!this.active || !s) return;
    this._time += dt > 0 ? Math.min(dt, 0.1) : 0;
    const t = s.t;
    const L = s.lantern;
    const xr = !!o.xr;

    // ---- the hero lantern ----
    const show = L.on > 0;
    this.pivot.visible = show;
    const hookY = L.y - SOCKET_Y * SCALE; // the pivot is the hook: the glass (socket) sits below it
    this.pivot.position.set(L.x, hookY, L.z);
    this.pivot.rotation.set(-L.swayZ * 0.9, 0, L.swayX * 0.9);
    const fm = this.flame.material.uniforms;
    fm.uTime.value = t;
    fm.uLean.value.set(L.leanX * L.lean, L.leanZ * L.lean);
    fm.uI.value = L.flame;
    fm.uH.value = 0.55 + 0.45 * Math.min(1.3, L.flame);
    this.flame.visible = show && L.flame > 0.01;
    // the halo: a star from afar, almost nothing up close (the flame and the light do the work there)
    this.pivot.getWorldPosition(_v);
    const d = o.head ? o.head.distanceTo(_v) : 10;
    const near = Math.min(1, Math.max(0, (d - 0.8) / 4));
    this.halo.material.opacity = L.light * (0.12 + 0.75 * near);
    const hs = 0.35 + 0.9 * near;
    this.halo.scale.set(hs, hs, 1);
    this.halo.visible = show && L.light > 0.01;

    // ---- the chain: from the hook up to its top (the pendulum's pivot), links alternately turned. While it pays out a slow wave
    // runs up it from the weight (the winch's judder), and the links over the hook lag the swing a little (a chain, not a rod) ----
    if (show) {
      _v.set(L.x, hookY + 0.03, L.z);
      _w.set(L.x - L.swayX * 0.55, s.chainTop, L.z - L.swayZ * 0.55);
      const len = _w.distanceTo(_v);
      const n = Math.min(MAX_LINKS, Math.max(0, Math.floor(len / LINK_PITCH)));
      _w.sub(_v).normalize();
      const pay = Math.min(1, Math.max(0, L.pay || 0));
      const amp = 0.028 * pay;
      const lagX = -L.swayX * 0.35;
      const lagZ = -L.swayZ * 0.35;
      let px = _v.x;
      let py = _v.y;
      let pz = _v.z;
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) * LINK_PITCH;
        // the bend: a wave (amp, 2.3 m long, running up at 1.6 m/s) and the lag over the first 1.5 m, both gone by the top
        const env = Math.min(1, k / 0.6) * Math.max(0, 1 - k / Math.max(1, len));
        const wv = amp * env * Math.sin(k * 2.73 - t * 4.4);
        const lg = Math.max(0, 1 - k / 1.5) * Math.min(1, k / 0.3);
        const cx = _v.x + _w.x * k + wv * 0.8 + lagX * lg;
        const cy = _v.y + _w.y * k;
        const cz = _v.z + _w.z * k + wv * 0.6 + lagZ * lg;
        _w2.set(cx - px, cy - py, cz - pz);
        if (i === 0) _w2.copy(_w);
        else _w2.normalize();
        _q.setFromUnitVectors(UP, _w2);
        if (i & 1) _q.multiply(TWIST);
        _m.compose(_v, _q, _s);
        _m.elements[12] = cx;
        _m.elements[13] = cy;
        _m.elements[14] = cz;
        this.chain.setMatrixAt(i, _m);
        px = cx;
        py = cy;
        pz = cz;
      }
      this.chain.count = n;
      this.chain.instanceMatrix.needsUpdate = true;
    } else this.chain.count = 0;
    this.chain.visible = show;

    // ---- the dust in its light ----
    const du = s.dust;
    const dOn = show && du && (du.motes > 0.01 || du.grit > 0.01);
    this.dust.visible = !!dOn;
    if (dOn) {
      const dm = this.dust.material.uniforms;
      dm.uTime.value = t;
      dm.uLan.value.set(L.x, L.y, L.z);
      dm.uI.value = L.light;
      dm.uMotes.value = du.motes;
      dm.uGrit.value = du.grit;
      dm.uPx.value = xr ? 1600 : o.px > 0 ? o.px : 720;
    }

    // ---- the letterbox (desktop) ----
    const bars = xr ? 0 : s.bars;
    this.bars.visible = bars > 0.002;
    if (this.bars.visible) {
      const asp = o.aspect > 0 ? o.aspect : 16 / 9;
      const key = `${asp.toFixed(3)}|${this.camera.fov.toFixed(2)}|${bars.toFixed(3)}`;
      if (key !== this._barsKey) {
        this._barsKey = key;
        const z = 0.12;
        const hh = Math.tan((this.camera.fov * Math.PI) / 360) * z; // half height at z
        const hw = hh * asp;
        const frac = Math.max(0, (1 - asp / 2.39) / 2) * bars; // of the full height
        const b = hh * 2 * frac;
        const p = this.bars.geometry.attributes.position;
        const W = hw * 1.05;
        const set = (i, x, y) => p.setXYZ(i, x, y, -z);
        set(0, -W, hh * 1.05);
        set(1, -W, hh - b);
        set(2, W, hh - b);
        set(3, W, hh * 1.05);
        set(4, -W, -hh + b);
        set(5, -W, -hh * 1.05);
        set(6, W, -hh * 1.05);
        set(7, W, -hh + b);
        p.needsUpdate = true;
        this.bars.geometry.computeBoundingSphere();
      }
    }

    // ---- the title ----
    const ti = s.title;
    this.title.visible = ti.a > 0.002;
    if (this.title.visible) {
      const u = this.titleMat.uniforms;
      u.uA.value = ti.a;
      u.uGlow.value = ti.glow;
      u.uSub.value = ti.sub;
      u.uTime.value = t;
      if (xr) {
        // world-locked, 6 m ahead of the vantage (the rig faces -Z), a little above the eyes; it breathes toward you slowly
        if (this.title.parent !== this.scene) this.scene.add(this.title);
        const k = 1 + 0.02 * Math.min(1, (t - 67.3) / 8);
        this.title.position.set(s.vr.x, s.vr.y + 0.35, s.vr.z - 6.0 + 0.15 * Math.min(1, (t - 67.3) / 8));
        this.title.rotation.set(0, 0, 0);
        this.title.scale.set(4.2 * k, 4.2 * k, 1);
      } else {
        if (this.title.parent !== this.camera) this.camera.add(this.title);
        const z = 3;
        const hh = Math.tan((this.camera.fov * Math.PI) / 360) * z;
        const w = hh * 2 * (o.aspect > 0 ? o.aspect : 16 / 9) * 0.62;
        const k = 1 + 0.025 * Math.min(1, Math.max(0, (t - 67.3) / 8)); // a slow push toward you
        this.title.position.set(0, hh * 0.06, -z);
        this.title.rotation.set(0, 0, 0);
        this.title.scale.set(w * k, w * k, 1);
      }
    }

    // ---- the subtitles ----
    const cap = s.caption;
    const capOn = cap.a > 0.002 && !!this._capTex;
    this.caption.visible = capOn;
    if (capOn) {
      if (this._capId !== cap.id) {
        this._capId = cap.id;
        this._drawCaption(cap.speaker, cap.text);
      }
      this.captionMat.opacity = cap.a;
      if (xr) {
        this.caption.position.set(0, -0.36, -1.5);
        this.caption.scale.set(1.25, 1.25, 1);
      } else {
        const z = 0.5;
        const hh = Math.tan((this.camera.fov * Math.PI) / 360) * z;
        const asp = o.aspect > 0 ? o.aspect : 16 / 9;
        const barH = hh * 2 * Math.max(0.06, (1 - asp / 2.39) / 2);
        const w = hh * 2 * asp * 0.7;
        this.caption.position.set(0, -hh + barH * 0.5 * Math.max(0.6, s.bars), -z);
        this.caption.scale.set(w, w, 1);
      }
    }

    // ---- the skip ring ----
    const sp = Math.max(0, Math.min(1, o.skip || 0));
    const hint = Math.max(0, Math.min(1, o.skipHint || 0));
    this.ring.visible = sp > 0.001 || hint > 0.01;
    if (this.ring.visible) {
      this.ringMat.uniforms.uP.value = sp;
      this.ringMat.uniforms.uA.value = Math.max(hint, sp > 0 ? 1 : 0);
      this.ringLabelMat.opacity = Math.max(hint, sp > 0 ? 1 : 0) * 0.9;
      if (xr) {
        this.ring.position.set(-0.08, -0.3, -1.2);
        this.ring.scale.set(0.05, 0.05, 1);
      } else {
        const z = 0.5;
        const hh = Math.tan((this.camera.fov * Math.PI) / 360) * z;
        const asp = o.aspect > 0 ? o.aspect : 16 / 9;
        const r = hh * 0.045;
        this.ring.position.set(hh * asp - r * 9.5, -hh + r * 2.4, -z);
        this.ring.scale.set(r, r, 1);
      }
    }
  }

  _drawCaption(speaker, text) {
    const c = this._capCanvas;
    if (!c) return;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    let size = 54;
    x.font = `italic 500 ${size}px ${FONT_DISPLAY}`;
    while (x.measureText(text).width > c.width - 80 && size > 30) {
      size -= 2;
      x.font = `italic 500 ${size}px ${FONT_DISPLAY}`;
    }
    x.shadowColor = 'rgba(0,0,0,0.9)';
    x.shadowBlur = 12;
    x.fillStyle = speaker === 'ODESSA' ? 'rgba(236,226,210,0.97)' : 'rgba(240,222,188,0.97)';
    x.fillText(text, c.width / 2, c.height / 2);
    this._capTex.needsUpdate = true;
  }

  dispose() {
    this.setActive(false);
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const m of [this.bars, this.caption, this.ring, this.title]) if (m.parent) m.parent.remove(m);
    this.flame.geometry.dispose();
    this.flame.material.dispose();
    if (this.halo.material.map) this.halo.material.map.dispose();
    this.halo.material.dispose();
    this.chain.geometry.dispose();
    this.chain.material.dispose();
    this.dust.geometry.dispose();
    this.dust.material.dispose();
    this.bars.geometry.dispose();
    this.bars.material.dispose();
    if (this.titleMat.uniforms.map.value) this.titleMat.uniforms.map.value.dispose();
    this.titleMat.dispose();
    this.title.geometry.dispose();
    if (this._capTex) this._capTex.dispose();
    this.captionMat.dispose();
    this.caption.geometry.dispose();
    this.ringMat.dispose();
    this.ring.geometry.dispose();
    if (this.ringLabelMat.map) this.ringLabelMat.map.dispose();
    this.ringLabelMat.dispose();
    this.ringLabel.geometry.dispose();
  }
}
