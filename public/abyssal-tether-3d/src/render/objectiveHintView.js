/* ABYSSAL TETHER 3D — objectiveHintView.js
 * The glow that marks a seal's trigger once the player has not found it for 20 s (sim/objectiveHint.js): up to six camera-facing
 * quads in ONE draw call, drawn only while a hint is on (+1 call). Each quad keeps a roughly constant angular size (so it can be
 * seen from across the shaft: world size grows with the distance, clamped), is additive, unlit, ignores the fog, and is depth-tested
 * (a trigger behind a wall is not shown through it). A soft warm core, a breathing rim and a ring that expands from the trigger.
 * Stereo-correct (camera-facing from each eye's view matrix). Fades in over 1.5 s and out over 0.5 s. Reduced effects: no pulse.
 */
import * as THREE from 'three';

const MAXQ = 6;
const FADE_IN = 1.5;
const FADE_OUT = 0.5;

const VERT = /* glsl */ `
attribute vec2 aCorner;
attribute float aSeed;
uniform float uK;
varying vec2 vC;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  float d = max( -mv.z, 1.0 );
  // a constant angular size (0.11 rad), at least 0.7 m across, at most 7 m
  float s = clamp( d * 0.11, 0.7, 7.0 );
  mv.xy += aCorner * s;
  vC = aCorner;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uK;
uniform float uPulse;
varying vec2 vC;
varying float vSeed;
void main() {
  float r = length( vC );
  if ( r > 1.0 ) discard;
  float breathe = 0.85 + 0.15 * uPulse * sin( uTime * 3.0 + vSeed * 6.0 );
  float core = exp( - r * r * 16.0 ) * 0.95;
  float rim = smoothstep( 0.07, 0.0, abs( r - 0.62 ) ) * 0.55;
  float ph = fract( uTime * 0.55 * uPulse + vSeed );
  float ring = smoothstep( 0.07, 0.0, abs( r - ph * 0.95 ) ) * ( 1.0 - ph ) * uPulse;
  float a = ( core + rim + ring * 0.9 ) * breathe * uK;
  vec3 col = vec3( 1.0, 0.76, 0.36 );
  gl_FragColor = vec4( col * a, a );
}`;

export class ObjectiveHintView {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    const pos = new Float32Array(MAXQ * 4 * 3);
    const cor = new Float32Array(MAXQ * 4 * 2);
    const seed = new Float32Array(MAXQ * 4);
    const idx = [];
    const C = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let q = 0; q < MAXQ; q++) {
      for (let v = 0; v < 4; v++) {
        cor[(q * 4 + v) * 2] = C[v * 2];
        cor[(q * 4 + v) * 2 + 1] = C[v * 2 + 1];
        seed[q * 4 + v] = (q * 0.37) % 1;
      }
      const b = q * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    this.geometry = new THREE.BufferGeometry();
    this._pos = new THREE.BufferAttribute(pos, 3);
    this.geometry.setAttribute('position', this._pos);
    this.geometry.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.geometry.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uPulse: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'objectiveHint';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._k = 0;
    this._t = 0;
    this.info = { drawCalls: 0, shown: 0 };
  }

  /**
   * @param {number} dt seconds
   * @param {import('../sim/objectiveHint.js').ObjectiveHint|null} hint
   * @param {boolean} reduced settings.reducedEffects
   */
  update(dt, hint, reduced) {
    const want = hint && hint.on && hint.count > 0 ? 1 : 0;
    const d = Math.min(dt, 0.1);
    this._k = want ? Math.min(1, this._k + d / FADE_IN) : Math.max(0, this._k - d / FADE_OUT);
    if (this._k <= 0 && !want) {
      this._k = 0;
      this.mesh.visible = false;
      this.info.drawCalls = 0;
      this.info.shown = 0;
      return;
    }
    this._t += dt;
    const n = hint ? hint.count : 0;
    const p = this._pos.array;
    for (let q = 0; q < MAXQ; q++) {
      const on = q < n && hint.targets[q].on;
      const x = on ? hint.targets[q].x : 0;
      const y = on ? hint.targets[q].y : -1e5; // an unused quad is far away (and degenerate in size terms)
      const z = on ? hint.targets[q].z : 0;
      for (let v = 0; v < 4; v++) {
        const o = (q * 4 + v) * 3;
        p[o] = x;
        p[o + 1] = y;
        p[o + 2] = z;
      }
    }
    this._pos.needsUpdate = true;
    const U = this.material.uniforms;
    U.uTime.value = this._t;
    U.uK.value = this._k;
    U.uPulse.value = reduced ? 0 : 1;
    this.mesh.visible = true;
    this.info.drawCalls = 1;
    this.info.shown = n;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
