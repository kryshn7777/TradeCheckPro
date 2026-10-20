/* ABYSSAL TETHER 3D — lanternHalo.js
 * The glow of the carried lantern in the haze around it: ONE camera-facing quad (2 triangles, one draw
 * call) centred on the lantern. Each fragment integrates the lantern's light scattered along its own
 * view ray in closed form (the 1/(r²+a²) integral along a ray is an atan, so no raymarching, no depth
 * texture, ~15 ALU), modulated by one fetch of the fog noise at the ray's closest approach so the glow
 * swirls with the air instead of being a flat gradient. It is what makes the air near the player read
 * as air: the near cards (atmosphere.js) fade out close to the eye, the halo fills that gap.
 *
 * Depth-tested (the hands, a wall right in front of the lantern, the ledge you hold hide it correctly),
 * no depth write, premultiplied blending, dithered against banding. Tinted by the lantern and the
 * section fog colour; the thicker the section's air (Atmosphere.density), the stronger.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
uniform vec3 uLanternPos;
uniform float uHalf;
varying vec3 vWorld;
void main() {
  // camera-facing in view space: the quad sits at the lantern, perpendicular to the view axis
  vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
  vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
  vec3 wp = uLanternPos + ( right * position.x + up * position.y ) * uHalf;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform vec3 uLanternPos;
uniform vec3 uLanternCol;
uniform vec3 uAmbient;
uniform vec3 uWind;
uniform float uTime;
uniform float uGain;
uniform float uCore;
uniform float uReach;
uniform float uTint;
uniform float uSharp;
uniform vec3 uFog;
varying vec3 vWorld;
void main() {
  vec3 C = cameraPosition;
  vec3 v = normalize( vWorld - C );
  vec3 w = uLanternPos - C;
  float t0 = dot( w, v );
  float b2 = max( dot( w, w ) - t0 * t0, 0.0 );
  float b = sqrt( b2 + uCore * uCore );
  // ∫ dt / ( r² + a² ) along the ray from the eye to uReach metres past the lantern's closest approach
  float I = ( atan( uReach / b ) + atan( t0 / b ) ) / b;
  // air swirling in the glow: the noise where the ray passes nearest the lantern
  vec3 q = ( C + v * max( t0, 0.0 ) ) * ( 1.0 / 7.0 ) + uWind * uTime;
  float n = texture( uNoise, q ).r;
  I *= 0.55 + 0.9 * n;
  // art-directed: the glow is centred on the lantern's direction and dies away round the sides
  I *= pow( 0.5 + 0.5 * dot( v, w / max( length( w ), 1e-3 ) ), uSharp );
  // soft shoulder: a glow, never a white-out
  float h = 1.0 - exp( - I * uGain );
  // warm at the core, the air's own colour at the rim
  vec3 hue = uFog / max( dot( uFog, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  vec3 tint = mix( vec3( 1.0 ), hue, uTint );
  vec3 col = uLanternCol * ( h * 0.9 ) * mix( vec3( 1.0 ), tint, 0.35 );
  // dither: sub-LSB noise so the long gradient does not band in 8 bit
  float d = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // premultiplied: the colour is the light the haze adds, the alpha the little it veils
  gl_FragColor.rgb += ( d - 0.5 ) * ( 1.0 / 255.0 ) * min( 1.0, h * 12.0 );
  gl_FragColor.a = h * 0.18;
}
`;

export class LanternHalo {
  /**
   * @param {THREE.Scene} scene
   * @param {object} lightUniforms FxLighting.uniforms
   * @param {THREE.Data3DTexture} noise
   */
  constructor(scene, lightUniforms, noise) {
    this.scene = scene;
    this.gain = 1;
    this.params = { gain: 0.022, core: 0.5, reach: 4, tint: 0.5, half: 7, sharp: 8 };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      uNoise: { value: noise },
      uLanternPos: lightUniforms.uLanternPos,
      uLanternCol: { value: new THREE.Color(0, 0, 0) },
      uAmbient: lightUniforms.uAmbient,
      uWind: { value: new THREE.Vector3(0.006, -0.004, 0.004) },
      uTime: { value: 0 },
      uGain: { value: 0.022 },
      uCore: { value: 0.5 },
      uReach: { value: 4 },
      uTint: { value: 0.5 },
      uSharp: { value: 8 },
      uHalf: { value: 7 },
      uFog: { value: new THREE.Color(0x202020) },
    };
    this._lightUniforms = lightUniforms;
    const mat = new THREE.ShaderMaterial({
      name: 'at3dLanternHalo',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'fxLanternHalo';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13; // right after the fog cards (12): the glow sits in front of them
    scene.add(this.mesh);
  }

  /**
   * @param {number} dt
   * @param {number} time        FX clock
   * @param {number} density     0..~1.3: how thick the section's air is (Atmosphere.density)
   * @param {number} threat      0..1
   * @param {number} lanternLevel FxLighting.lanternLevel (flicker, death dimming; 0 = lantern off)
   * @param {THREE.Color} fog     current scene fog colour
   * @param {number} tier        0 reduced, 1 XR, 2 desktop
   */
  update(dt, time, density, threat, lanternLevel, fog, tier) {
    const P = this.params;
    const U = this.uniforms;
    this.mesh.visible = lanternLevel > 0.001;
    if (!this.mesh.visible) return;
    U.uTime.value = time;
    // the lantern's colour × its level (the shared uniform holds colour × candela; 6.5 cd = level 1)
    const lc = this._lightUniforms.uLanternCol.value;
    U.uLanternCol.value.setRGB(lc.r / 6.5, lc.g / 6.5, lc.b / 6.5);
    U.uGain.value = P.gain * (0.55 + 0.6 * density) * (1 + threat * 0.25) * (tier === 0 ? 0.7 : 1);
    U.uCore.value = P.core;
    U.uReach.value = P.reach;
    U.uTint.value = P.tint;
    U.uSharp.value = P.sharp;
    U.uHalf.value = P.half;
    U.uFog.value.copy(fog);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
