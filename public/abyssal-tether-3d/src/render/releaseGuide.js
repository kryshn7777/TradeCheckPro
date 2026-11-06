/* THE LANTERN (ABYSSAL TETHER 3D) — render/releaseGuide.js
 * The release guide, "if I let go now": while you hang on a line and move faster than RELEASE_GUIDE.minSpeed, a dotted, world-locked
 * arc shows the path your body takes if you let go of the trigger NOW (sim/releasePredict.js: the real free-body forces and the
 * release boost), ending in a ring on the face you will hit. The ring (and the dots) are amber, red when that impact would kill.
 *
 *   - ONE draw call: an InstancedMesh of one unit quad, RELEASE_GUIDE.dots camera-facing dots + one ring lying on the hit face
 *     (a per-instance `aKind`), unlit, additive, depth-tested, no depth write: the pattern and colours of render/fallCue.js;
 *   - the path is re-predicted every RELEASE_GUIDE.repick s (not every frame); the dots are spaced evenly along the arc;
 *   - the dots grow a little with distance (they stay readable far away) and fade with the scene fog's reach (fog-aware) and near the eye;
 *   - only a FULL release is shown: with the other hand on a line the body stays on that rope (a pendulum), so the guide hides;
 *   - hidden while a wind squall gathers or blows (sim/objectives3d.js squallNow: not modelled), while climbing, when
 *     settings.releaseGuide === false, and on the low render tier with the XR governor at level >= 2;
 *   - zero allocation per frame.
 * Tests: tools/abyssal-tether-3d/tests/physics/release-predict.mjs
 */
import * as THREE from 'three';
import { createReleaseOut, predictRelease } from '../sim/releasePredict.js';

export const RELEASE_GUIDE = {
  minSpeed: 4, // m/s on the line at which the guide shows
  dots: 24, // dot instances (the ring is one more)
  repick: 0.1, // s between predictions
  skip: 1.4, // m of the arc near the body left without dots (they would sit in your face)
  spacingMin: 0.55, // m between dots at least
  dotSize: 0.13, // m across a dot near the eye (it grows with distance in the shader)
  ringRadius: 0.7, // m, at least
  ringAngular: 0.03, // ... or this fraction of its distance (it stays visible far away)
  fadeIn: 10, // 1/s ease of the whole guide in
  fadeOut: 7, // ... and out
};

const AMBER = [1.0, 0.62, 0.28];
const RED = [1.0, 0.1, 0.06];
const HANDS = ['left', 'right'];

/** settings.releaseGuide === false turns it off. */
export function releaseGuideDisabled(settings) {
  return !!(settings && settings.releaseGuide === false);
}

const VERT = /* glsl */ `
attribute float aKind;
varying vec2 vUv;
varying vec3 vCol;
varying float vDist;
varying float vKind;
void main() {
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vDist = length(c - cameraPosition);
  vKind = aKind;
  vec3 wp;
  if (aKind < 0.5) {
    // a dot: a camera-facing disc, a little larger with distance so a far arc still reads
    float s = length(instanceMatrix[0].xyz) * (1.0 + 0.035 * vDist);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = c + (right * position.x + up * position.y) * s;
  } else {
    // the ring: the quad laid in the instance's x / z plane (its y axis is the face normal)
    wp = (modelMatrix * instanceMatrix * vec4(position.x, 0.0, position.y, 1.0)).xyz;
  }
  vUv = position.xy + 0.5;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform float uFogFar;
uniform float uLethal;
varying vec2 vUv;
varying vec3 vCol;
varying float vDist;
varying float vKind;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a;
  float hot;
  if (vKind < 0.5) {
    float core = 1.0 - smoothstep(0.35, 0.6, r);
    float glow = (1.0 - smoothstep(0.3, 1.0, r)) * 0.35;
    a = core + glow;
    hot = core;
  } else {
    float band = smoothstep(0.74, 0.82, r) * (1.0 - smoothstep(0.9, 0.98, r));
    float inner = smoothstep(0.34, 0.4, r) * (1.0 - smoothstep(0.46, 0.52, r)) * 0.45;
    float fill = (1.0 - smoothstep(0.0, 0.82, r)) * 0.12;
    float pulse = 0.8 + 0.2 * sin(uTime * mix(5.0, 14.0, uLethal));
    a = (band + inner) * pulse + fill;
    hot = band;
  }
  // the scene fog's reach: far parts dim (never vanish: the point is to see where you will land through the haze); near the eye fade out
  float fog = 1.0 - 0.6 * smoothstep(0.35 * uFogFar, uFogFar, vDist);
  float near = smoothstep(0.5, 1.6, vDist);
  a *= uAlpha * fog * near;
  gl_FragColor = vec4(vCol * (0.6 + 0.9 * hot) * a, a);
}`;

export class ReleaseGuide {
  /** @param {THREE.Object3D} parent the scene */
  constructor(parent) {
    const geo = new THREE.PlaneGeometry(1, 1); // x / y in -0.5..0.5
    const max = RELEASE_GUIDE.dots + 1;
    this._kind = new Float32Array(max);
    this._kind[RELEASE_GUIDE.dots] = 1; // the last instance is the ring
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(this._kind, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 }, uFogFar: { value: 60 }, uLethal: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = 'ReleaseGuide';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 56;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    parent.add(this.mesh);
    this.parent = parent;
    this.pred = createReleaseOut();
    this._since = 99;
    this._shown = 0;
    this._want = false;
    this._head = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._c = new THREE.Color();
    this._body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0 };
    this.stats = { picks: 0, dots: 0, ring: false, lethal: false, reason: '', why: '' };
  }

  /**
   * Whether the guide should show for this game state (and which hand holds the only line). Pure over the game object.
   * @returns {boolean}
   */
  wanted(game) {
    const why = this._why(game);
    this.stats.why = why;
    return why === '';
  }

  /** '' when the guide should show, else why not (a constant string: stats.why, for the tests and the debug API). */
  _why(game) {
    const p = game && game.player;
    const T = game && game.tethers;
    if (!p || !T || !T.hands || !game.level) return 'no run';
    if (game.state !== 'playing') return 'state';
    if (p.alive === false) return 'dead';
    if (p.climbing) return 'climbing';
    if (releaseGuideDisabled(game.settings)) return 'setting';
    const r = game.renderer;
    const gov = game.governor;
    if (r && r.qualityTier === 'low' && gov && gov.level >= 2) return 'tier';
    const sq = game.objectives && game.objectives.squallNow;
    if (sq && (sq.k > 0.01 || sq.rise > 0.01)) return 'squall';
    let lines = 0;
    for (let i = 0; i < HANDS.length; i++) {
      const st = T.hands[HANDS[i]];
      if (st && st.rope && st.rope.attached) lines++;
    }
    if (lines < 1) return 'no line';
    const sp = Math.sqrt((p.vx || 0) * (p.vx || 0) + (p.vy || 0) * (p.vy || 0) + (p.vz || 0) * (p.vz || 0));
    return sp > RELEASE_GUIDE.minSpeed ? '' : 'slow';
  }

  /** @param {number} dt @param {object} game the Game3D */
  update(dt, game) {
    const want = this.wanted(game);
    const k = want ? 1 : 0;
    this._shown += (k - this._shown) * Math.min(1, dt * (k > this._shown ? RELEASE_GUIDE.fadeIn : RELEASE_GUIDE.fadeOut));
    this.material.uniforms.uTime.value += dt;
    if (!want && this._shown < 0.01) {
      this.mesh.visible = false;
      this.mesh.count = 0;
      this._since = 99;
      this.stats.dots = 0;
      this.stats.ring = false;
      return;
    }
    this._since += dt;
    if (want && this._since >= RELEASE_GUIDE.repick) {
      this._since = 0;
      this._predict(game);
    }
    this.mesh.visible = this.mesh.count > 0 && this._shown > 0.01;
    this.material.uniforms.uAlpha.value = this._shown;
  }

  _predict(game) {
    const p = game.player;
    const T = game.tethers;
    // a hook in flight on the other hand will hold the body too: only a full let-go is predicted
    let lines = 0;
    let flying = false;
    for (let i = 0; i < HANDS.length; i++) {
      const st = T.hands[HANDS[i]];
      if (st.rope.attached) lines++;
      if (st.flying) flying = true;
    }
    const b = this._body;
    // the render position (interpolated) so the arc starts at the body you see; the velocity of the last step
    b.x = isFinite(p.rx) ? p.rx : p.x;
    b.y = isFinite(p.ry) ? p.ry : p.y;
    b.z = isFinite(p.rz) ? p.rz : p.z;
    b.vx = p.vx || 0;
    b.vy = p.vy || 0;
    b.vz = p.vz || 0;
    b.radius = p.radius || 0;
    predictRelease(b, lines > 1 || flying, game.level, game.diff, this.pred);
    this.stats.picks++;
    this.stats.reason = this.pred.reason;
    const cam = game.renderer && game.renderer.camera;
    if (cam && typeof cam.getWorldPosition === 'function') cam.getWorldPosition(this._head);
    else this._head.set(b.x, b.y + 0.5, b.z);
    const fog = game.renderer && game.renderer.scene && game.renderer.scene.fog;
    let far = 60;
    if (fog) {
      if (fog.isFogExp2 && fog.density > 0) far = 2.2 / fog.density;
      else if (fog.far > 0) far = fog.far;
    }
    this.material.uniforms.uFogFar.value = Math.max(12, Math.min(200, far));
    this._write();
  }

  _write() {
    const O = RELEASE_GUIDE;
    const pr = this.pred;
    const pts = pr.points;
    const mesh = this.mesh;
    const col = pr.lethal ? RED : AMBER;
    this.material.uniforms.uLethal.value = pr.lethal ? 1 : 0;
    if (pr.n < 2) {
      mesh.count = 0;
      this.stats.dots = 0;
      this.stats.ring = false;
      return;
    }
    // the arc's length, then the dots evenly spaced along it past `skip`
    let L = 0;
    for (let i = 1; i < pr.n; i++) {
      const dx = pts[i * 3] - pts[i * 3 - 3];
      const dy = pts[i * 3 + 1] - pts[i * 3 - 2];
      const dz = pts[i * 3 + 2] - pts[i * 3 - 1];
      L += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const usable = L - O.skip - (pr.hit ? 0.4 : 0); // no dot inside the ring's centre
    let n = 0;
    if (usable > 0) {
      const spacing = Math.max(O.spacingMin, usable / O.dots);
      let want = O.skip + spacing * 0.5;
      let acc = 0;
      for (let i = 1; i < pr.n && n < O.dots && want <= O.skip + usable; i++) {
        const ax = pts[i * 3 - 3];
        const ay = pts[i * 3 - 2];
        const az = pts[i * 3 - 1];
        const dx = pts[i * 3] - ax;
        const dy = pts[i * 3 + 1] - ay;
        const dz = pts[i * 3 + 2] - az;
        const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
        while (seg > 1e-6 && want <= acc + seg && n < O.dots && want <= O.skip + usable) {
          const u = (want - acc) / seg;
          this._p.set(ax + dx * u, ay + dy * u, az + dz * u);
          this._s.set(O.dotSize, O.dotSize, O.dotSize);
          this._m.compose(this._p, this._q.identity(), this._s);
          mesh.setMatrixAt(n, this._m);
          // without a hit the arc fades out over its last dots (the path goes on past the look-ahead)
          const tail = pr.hit ? 1 : Math.min(1, (O.skip + usable - want) / (4 * spacing) + 0.15);
          mesh.setColorAt(n, this._c.setRGB(col[0] * tail, col[1] * tail, col[2] * tail));
          n++;
          want += spacing;
        }
        acc += seg;
      }
    }
    // unused dot slots up to the ring: zero-size (the ring is the last instance; count covers it)
    const ring = !!pr.hit;
    if (ring) {
      for (let i = n; i < O.dots; i++) {
        this._s.set(0, 0, 0);
        this._m.compose(this._p.set(0, -1e5, 0), this._q.identity(), this._s);
        mesh.setMatrixAt(i, this._m);
      }
      const h = pr.hit;
      this._n.set(h.nx, h.ny, h.nz);
      this._q.setFromUnitVectors(this._up, this._n);
      this._p.set(h.x + h.nx * 0.04, h.y + h.ny * 0.04, h.z + h.nz * 0.04);
      const dist = this._p.distanceTo(this._head);
      const R = Math.max(O.ringRadius, O.ringAngular * dist) * 2;
      this._s.set(R, 1, R);
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(O.dots, this._m);
      mesh.setColorAt(O.dots, this._c.setRGB(col[0], col[1], col[2]));
      mesh.count = O.dots + 1;
    } else {
      mesh.count = n;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.stats.dots = n;
    this.stats.ring = ring;
    this.stats.lethal = !!pr.lethal;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
