/* ABYSSAL TETHER 3D — nightVisionView.js
 * What the night vision goggles look like: two head-locked full-view triangles (children of the camera, no post-processing pass,
 * no render target), drawn only while the goggles are on or spooling (+2 draw calls then, 0 otherwise).
 *
 *   NightVisionView(camera)
 *   .update(dt, nv, opts)   once per frame. nv = the sim's NightVision3D (k, level, charge, low); opts = { reduced, xr, aspect }
 *   .dispose()
 *
 *   1. TINT (multiply blend): the framed picture is multiplied by a phosphor green that keeps almost only the green channel
 *      (so the world turns into one grey-green image, like an intensifier tube), through a rounded-tube mask whose rim goes
 *      dark. The renderer has already lifted the light of the scene (render/renderer3d.js: the darkness comes off, the ambient
 *      and the baked light rise) - the multiply is what makes it read as the goggles' picture and not as a bright cave.
 *   2. GLOW (additive blend): a faint green floor so a black corner is never dead, a fine animated grain, the lens flare while
 *      the tubes warm up, a slow "scan" band, and a five-segment cell gauge at the bottom of the view (it blinks slowly when low).
 *
 * Both write gl_Position straight from the vertex (a clip-space triangle: it covers every eye's viewport exactly with zero parallax,
 * in stereo too), no depth test, renderOrder 860 / 861 (above the world, below the health vignette 880 so a hit still shows red over green).
 * The meshes exist (visible) at construction so the scene precompile compiles both programs: switching the goggles on never hitches.
 * Comfort: in a headset the tube rim is softer and never closes past ~35 % light; reduced effects: no grain animation, no flare, no band.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const FRAG_TINT = /* glsl */ `
uniform float uK;       // 0..1 power-up ramp
uniform float uAspect;  // width / height of one eye's view
uniform vec2 uRim;      // tube rim start / end radius (height units)
uniform float uFloor;   // lightest the rim darkens to (comfort)
varying vec2 vNdc;
void main() {
  vec2 p = vec2( vNdc.x * uAspect, vNdc.y );
  float r = length( p );
  float m = 1.0 - smoothstep( uRim.x, uRim.y, r );
  m = mix( uFloor, 1.0, m * m * ( 3.0 - 2.0 * m ) );
  // the tubes' picture: nearly only the green channel survives; the centre is a touch hotter than the rim
  vec3 tint = vec3( 0.07, 1.0, 0.20 ) * m * ( 1.0 + 0.25 * ( 1.0 - r * 0.7 ) );
  gl_FragColor = vec4( mix( vec3( 1.0 ), tint, uK ), 1.0 );
}`;

const FRAG_GLOW = /* glsl */ `
uniform float uK;       // 0..1 power-up ramp
uniform float uLevel;   // k with the low-cell stutter
uniform float uTime;
uniform float uAspect;
uniform float uCharge;  // 0..1
uniform float uBlink;   // 0..1 low-cell gauge blink
uniform float uFx;      // 1 = grain / flare / band, 0 = reduced effects
varying vec2 vNdc;
float hash( vec2 q ) {
  return fract( sin( dot( q, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
void main() {
  vec2 p = vec2( vNdc.x * uAspect, vNdc.y );
  float r = length( p );
  vec3 g = vec3( 0.30, 1.0, 0.45 );
  // a floor of phosphor light: a black corner is never dead
  float a = 0.020 + 0.012 * ( 1.0 - r * 0.6 );
  // grain: a fine animated sparkle, ~24 Hz
  float f = floor( uTime * 24.0 );
  float n = hash( floor( gl_FragCoord.xy * 0.5 ) + f * 17.0 );
  a += uFx * 0.040 * ( n * n );
  // the warming tubes: a bloom that rises and falls with the ramp
  a += uFx * 0.26 * sin( 3.14159 * uK ) * ( 1.0 - smoothstep( 0.0, 1.6, r ) );
  // a slow brighter band drifting down the picture
  float band = smoothstep( 0.10, 0.0, abs( fract( uTime * 0.11 ) * 2.6 - 1.3 - vNdc.y ) );
  a += uFx * 0.020 * band;
  // the cell gauge: five segments under the picture's centre
  float gx = ( vNdc.x * uAspect ) / 0.36;
  float seg = floor( ( gx * 0.5 + 0.5 ) * 5.0 );
  float inBar = step( abs( gx ), 1.0 ) * step( abs( vNdc.y + 0.80 ), 0.012 );
  float cell = fract( ( gx * 0.5 + 0.5 ) * 5.0 );
  inBar *= step( 0.12, cell ) * step( cell, 0.88 );
  float lit = step( seg + 0.5, uCharge * 5.0 + 0.0001 );
  vec3 bar = mix( vec3( 0.04, 0.16, 0.07 ), vec3( 0.45, 1.0, 0.6 ), lit );
  bar = mix( bar, vec3( 1.0, 0.45, 0.25 ) * lit + vec3( 0.12, 0.03, 0.02 ) * ( 1.0 - lit ), step( uCharge, 0.2 ) );
  float barA = inBar * ( 0.55 + 0.45 * lit ) * mix( 1.0, uBlink, step( uCharge, 0.2 ) );
  vec3 c = g * a * uLevel + bar * barA * 0.7 * uK;
  gl_FragColor = vec4( c, 1.0 );
  #include <colorspace_fragment>
}`;

export class NightVisionView {
  /** @param {THREE.Camera} camera the rig's head camera: the quads are its children */
  constructor(camera) {
    this.camera = camera;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.geometry = geo;
    this.tintMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG_TINT,
      uniforms: {
        uK: { value: 0 },
        uAspect: { value: 1 },
        uRim: { value: new THREE.Vector2(0.78, 1.55) },
        uFloor: { value: 0.18 },
      },
      transparent: true,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true, // MultiplyBlending requires it on a transparent material: dst * src
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG_GLOW,
      uniforms: {
        uK: { value: 0 },
        uLevel: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uCharge: { value: 1 },
        uBlink: { value: 1 },
        uFx: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.tint = new THREE.Mesh(geo, this.tintMat);
    this.glow = new THREE.Mesh(geo, this.glowMat);
    this.tint.name = 'nightVisionTint';
    this.glow.name = 'nightVisionGlow';
    this.tint.renderOrder = 860;
    this.glow.renderOrder = 861;
    for (const m of [this.tint, this.glow]) {
      m.frustumCulled = false;
      m.visible = true; // visible until the first update: the scene precompile compiles both programs
      camera.add(m);
    }
    this._t = 0;
    this.info = { drawCalls: 0 };
  }

  /**
   * @param {number} dt
   * @param {{k:number, level:number, charge:number, low:boolean}|null} nv
   * @param {{reduced?:boolean, xr?:boolean, aspect?:number}} [opts]
   */
  update(dt, nv, opts) {
    const k = nv ? nv.k : 0;
    const on = k > 0.002;
    this.tint.visible = on;
    this.glow.visible = on;
    this.info.drawCalls = on ? 2 : 0;
    if (!on) return;
    const o = opts || {};
    this._t += dt > 0 ? Math.min(dt, 0.1) : 0;
    const xr = !!o.xr;
    const T = this.tintMat.uniforms;
    const G = this.glowMat.uniforms;
    const aspect = xr ? 1 : o.aspect > 0.2 ? Math.min(o.aspect, 3) : 1;
    T.uK.value = k;
    T.uAspect.value = aspect;
    // the headset gets a softer, wider tube that never closes past ~35 % light (comfort); the monitor a deeper one
    T.uRim.value.set(xr ? 0.95 : 0.78, xr ? 1.75 : 1.55);
    T.uFloor.value = xr ? 0.35 : 0.18;
    G.uK.value = k;
    G.uLevel.value = nv.level;
    G.uTime.value = this._t;
    G.uAspect.value = aspect;
    G.uCharge.value = nv.charge;
    G.uBlink.value = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this._t * 3.2));
    G.uFx.value = o.reduced ? 0 : 1;
  }

  dispose() {
    for (const m of [this.tint, this.glow]) if (m.parent) m.parent.remove(m);
    this.geometry.dispose();
    this.tintMat.dispose();
    this.glowMat.dispose();
  }
}
