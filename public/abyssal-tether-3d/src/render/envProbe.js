/* ABYSSAL TETHER 3D — envProbe.js
 * The reflection environment: a small procedural "cathedral shaft" scene (cold light falling from a far window, lancet
 * windows, warm lamps, a dark pit) rendered once per section into a cube and PMREM-filtered into one tiny cube-UV
 * target per section. Reflections on wet stone, metal and glass sample ONE shared texture (`probe.texture`); between
 * two sections the texture is rewritten by a single GPU blit that mixes the two section targets (only while the head
 * is inside a ±9 m theme blend band, never per frame otherwise), so there is no pop at a section change, no PMREM
 * generation during play and no shader recompile (the texture object and its size never change at runtime).
 *
 * Cost: 8 variants × (6 tiny cube faces + PMREM blur) at load, spread over frames (one per `pump()`); resident
 * memory ≈ 9 × 0.7 MB (size 64) / 9 × 2.8 MB (size 128). In the shader: two bilinear fetches per fragment (stock
 * cube-UV lookup), skipped by a uniform branch when the tier turns reflections off.
 */

import * as THREE from 'three';

const _c = new THREE.Color();
const _warm = new THREE.Color(1.0, 0.56, 0.2);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A neutral spec (before the level is known). */
export const DEFAULT_ENV_SPEC = Object.freeze({
  light: new THREE.Color('#6fa3b5'),
  accent: new THREE.Color('#e0a050'),
  fog: new THREE.Color('#1c2125'),
  ambient: 0.3,
  lamps: 3,
});

export class EnvProbe {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [o]
   * @param {number} [o.size=64]  cube face size (32 | 64 | 128): the PMREM target is 3·max(size,112) × 4·size
   */
  constructor(renderer, { size = 64 } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.specs = [];
    this.variants = []; // PMREM render targets by section
    this._pmrem = new THREE.PMREMGenerator(renderer);
    this._cubeRT = null;
    this._cubeCam = null;
    this._scene = null;
    this.live = null;
    this._blitScene = null;
    this._blitCam = null;
    this._blitMat = null;
    this._shown = { a: -1, b: -1, w: -1 };
    this.builds = 0;
    this.blits = 0;
    this.disposed = false;
    this._init();
  }

  /** The shared environment texture (stable object: assign it once to materials). */
  get texture() {
    return this.live ? this.live.texture : null;
  }

  _init() {
    const size = this.size;
    this._cubeRT = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this._cubeCam = new THREE.CubeCamera(0.1, 200, this._cubeRT);
    this._buildScene();
    // blit: live = mix(a, b, w) over the whole PMREM atlas (texel-exact: same size, linear sampling at texel centres)
    this._blitMat = new THREE.ShaderMaterial({
      uniforms: { tA: { value: null }, tB: { value: null }, uW: { value: 0 } },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader:
        'uniform sampler2D tA;\nuniform sampler2D tB;\nuniform float uW;\nvarying vec2 vUv;\nvoid main() { gl_FragColor = vec4( mix( texture2D( tA, vUv ).rgb, texture2D( tB, vUv ).rgb, uW ), 1.0 ); }',
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._blitMat);
    quad.frustumCulled = false;
    this._blitScene = new THREE.Scene();
    this._blitScene.add(quad);
    this._blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // the live target: first allocation from the default spec
    this._renderCube(DEFAULT_ENV_SPEC, 0);
    this.live = this._pmrem.fromCubemap(this._cubeRT.texture);
    this.live.texture.name = 'at3dEnvLive';
    this.defaultTarget = this.live; // replaced content later by blits
    this.builds++;
    this._shown = { a: -2, b: -2, w: 0 };
  }

  // ---------------------------------------------------------------------------
  // The environment scene
  // ---------------------------------------------------------------------------
  _buildScene() {
    const sc = new THREE.Scene();
    const mk = (geo, name) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.frustumCulled = false;
      sc.add(m);
      return m;
    };
    // dome with a vertical gradient (vertex colours rewritten per variant)
    const dome = new THREE.SphereGeometry(80, 32, 16);
    dome.setAttribute('color', new THREE.BufferAttribute(new Float32Array(dome.attributes.position.count * 3), 3));
    const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false, fog: false });
    const domeMesh = new THREE.Mesh(dome, domeMat);
    domeMesh.frustumCulled = false;
    sc.add(domeMesh);
    this._dome = dome;
    // the far window the light falls from (disc straight above, facing down)
    this._shaft = mk(new THREE.CircleGeometry(11, 24), 'ShaftWindow');
    this._shaft.position.set(0, 60, 0);
    this._shaft.rotation.x = Math.PI / 2;
    // lancet windows ringing the horizon
    this._lancets = [];
    const r = rng(0xe17);
    const N = 9;
    for (let i = 0; i < N; i++) {
      const w = 1.4 + r() * 1.6;
      const h = 7 + r() * 8;
      const m = mk(new THREE.PlaneGeometry(w, h), 'Lancet' + i);
      const az = ((i + (r() - 0.5) * 0.6) / N) * Math.PI * 2;
      const rad = 45;
      const el = 4 + r() * 14; // metres of centre height: a little above the horizon, tall windows
      m.position.set(Math.sin(az) * rad, el, Math.cos(az) * rad);
      m.lookAt(0, el, 0);
      this._lancets.push({ m, k: 0.45 + r() * 0.9 });
    }
    // warm lamps: small hot discs at varied bearings / heights (some below the horizon: lamps on lower galleries)
    this._lamps = [];
    for (let i = 0; i < 7; i++) {
      const rad = 18 + r() * 24;
      const az = r() * Math.PI * 2;
      const el = -14 + r() * 30;
      const m = mk(new THREE.CircleGeometry(0.7 + r() * 0.8, 10), 'Lamp' + i);
      m.position.set(Math.sin(az) * rad, el, Math.cos(az) * rad);
      m.lookAt(0, el * 0.2, 0);
      this._lamps.push({ m, k: 0.6 + r() * 0.8 });
    }
    // a pale gallery rail / floor glint low in the view (bounce off the lit floors far below)
    this._floorGlow = mk(new THREE.RingGeometry(10, 26, 24), 'FloorGlow');
    this._floorGlow.position.set(0, -34, 0);
    this._floorGlow.rotation.x = -Math.PI / 2;
    this._scene = sc;
  }

  _paint(spec, index) {
    const L = spec.light;
    const amb = Math.max(0.05, spec.ambient);
    // dome
    const pos = this._dome.attributes.position;
    const col = this._dome.attributes.color;
    const fog = spec.fog;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 80;
      const az = Math.atan2(pos.getX(i), pos.getZ(i));
      const bands = 0.75 + 0.25 * Math.sin(az * 3 + index) * Math.sin(az * 5 - index * 0.7 + y * 4);
      if (y >= 0) {
        const t = Math.pow(y, 0.65);
        // horizon: the haze colour; up: the cold light, strongest overhead
        _c.setRGB(
          (fog.r * 0.9 * (1 - t) + L.r * (0.22 + 1.0 * amb) * t) * bands,
          (fog.g * 0.9 * (1 - t) + L.g * (0.22 + 1.0 * amb) * t) * bands,
          (fog.b * 0.9 * (1 - t) + L.b * (0.22 + 1.0 * amb) * t) * bands,
        );
      } else {
        const t = Math.pow(-y, 0.55);
        _c.setRGB(fog.r * 0.9 * (1 - t) * 0.8 + 0.001, fog.g * 0.9 * (1 - t) * 0.8 + 0.001, fog.b * 0.9 * (1 - t) * 0.8 + 0.001);
      }
      col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    col.needsUpdate = true;
    // shaft window: the daylight that still reaches this depth
    const shaftI = 2.2 + 16 * amb;
    this._shaft.material.color.setRGB(L.r * shaftI, L.g * shaftI, L.b * shaftI);
    const lanI = 1.4 + 9 * amb;
    for (const w of this._lancets) w.m.material.color.setRGB(L.r * lanI * w.k, L.g * lanI * w.k, L.b * lanI * w.k);
    // lamps: the section accent pulled toward flame colour; count from the level's lights in the section
    _c.copy(spec.accent).lerp(_warm, 0.6);
    const n = Math.max(1, Math.min(this._lamps.length, Math.round(spec.lamps)));
    for (let i = 0; i < this._lamps.length; i++) {
      const lp = this._lamps[i];
      lp.m.visible = i < n;
      const k = 22 * lp.k;
      lp.m.material.color.setRGB(_c.r * k, _c.g * k, _c.b * k);
    }
    this._floorGlow.material.color.setRGB(_c.r * 0.18, _c.g * 0.18, _c.b * 0.18);
  }

  _renderCube(spec, index) {
    this._paint(spec, index);
    const r = this.renderer;
    // CubeCamera.update handles XR (it disables it) and restores the target
    this._cubeCam.update(r, this._scene);
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------
  /**
   * @param {Array<{light:THREE.Color, accent:THREE.Color, fog:THREE.Color, ambient:number, lamps:number}>} specs one per section
   */
  setSections(specs) {
    for (const t of this.variants) if (t) t.dispose();
    this.variants = new Array(specs.length).fill(null);
    this.specs = specs;
    this._shown = { a: -2, b: -2, w: 0 };
    this._nextBuild = 0;
  }

  /** Builds variant i now (if missing). */
  ensure(i) {
    if (this.disposed || i < 0 || i >= this.specs.length || this.variants[i]) return;
    this._renderCube(this.specs[i], i);
    this.variants[i] = this._pmrem.fromCubemap(this._cubeRT.texture);
    this.variants[i].texture.name = 'at3dEnv' + i;
    this.builds++;
  }

  /** Builds one missing variant (call once per frame while `pending`). Returns true while more are missing. */
  pump() {
    if (this.disposed) return false;
    while (this._nextBuild < this.variants.length && this.variants[this._nextBuild]) this._nextBuild++;
    if (this._nextBuild < this.variants.length) {
      this.ensure(this._nextBuild);
      this._nextBuild++;
    }
    return this._nextBuild < this.variants.length;
  }

  get pending() {
    return !this.disposed && this.variants.length > 0 && this.variants.some((v) => !v);
  }

  /**
   * Shows the blend of sections a and b (weight w of b) in the shared texture. Cheap when nothing changed (a few
   * compares); a missing variant is built on the spot (only when the head reaches a section not yet pumped).
   */
  select(a, b, w) {
    if (this.disposed || !this.specs.length) return false;
    a = Math.max(0, Math.min(this.specs.length - 1, a | 0));
    b = Math.max(0, Math.min(this.specs.length - 1, b | 0));
    if (a === b) w = 0;
    w = Math.round(w * 24) / 24; // 24 steps across the band
    const s = this._shown;
    if (s.a === a && s.b === b && s.w === w) return false;
    this.ensure(a);
    if (w > 0) this.ensure(b);
    const A = this.variants[a];
    const B = w > 0 ? this.variants[b] : A;
    if (!A || !B) return false;
    this._blit(A, B, w);
    s.a = a;
    s.b = b;
    s.w = w;
    return true;
  }

  _blit(A, B, w) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const xr = r.xr.enabled;
    const ac = r.autoClear;
    r.xr.enabled = false;
    r.autoClear = false;
    this._blitMat.uniforms.tA.value = A.texture;
    this._blitMat.uniforms.tB.value = B.texture;
    this._blitMat.uniforms.uW.value = w;
    r.setRenderTarget(this.live);
    r.render(this._blitScene, this._blitCam);
    r.setRenderTarget(prev);
    r.autoClear = ac;
    r.xr.enabled = xr;
    this.blits++;
  }

  dispose() {
    this.disposed = true;
    for (const t of this.variants) if (t) t.dispose();
    this.variants = [];
    if (this.live) this.live.dispose();
    if (this._cubeRT) this._cubeRT.dispose();
    if (this._blitMat) this._blitMat.dispose();
    this._pmrem.dispose();
    this._scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
