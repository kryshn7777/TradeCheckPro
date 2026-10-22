/* ABYSSAL TETHER 3D — windGusts.js
 * Wind you can see: wisps of ash and dust that ride the shaft's draught in patches "here and there" — a gust gathers in one
 * pocket of the air, streams sideways across the view swaying left and right on its way, thins out and is gone while another
 * stirs elsewhere. Every so often a squall (wind.js) lifts the whole thing and the props (sceneDetail.js) sway harder with it.
 *
 *   - ONE draw call (THREE.Points, additive, like the ambient dust): WISPS wisps, each a head and TRAIL fading samples of the same
 *     path, so it reads as a short streak that follows the curve of the sway. All motion is in the vertex shader from uTime (zero CPU
 *     per particle, no allocation after construction); the cloud is wrapped around the head like the ambient dust;
 *   - lit like the dust (the shared FxLighting uniforms: lantern, env lights, creature glow, a whisper of ambient): a wisp in the
 *     dark is invisible, in the lantern's reach a pale streak;
 *   - tier-scaled draw range; reducedEffects draws nothing (the sway of the props stills with it).
 * Owned by FX (fx.windGusts); update(dt, head, tier, reduced) once per frame.
 */
import * as THREE from 'three';
import { FX_LIGHT_GLSL } from './atmosphere.js';
import { LOOK } from './materials.js';
import { windAngle, windGust, windSquall } from './wind.js';

const WISPS = 340;
const TRAIL = 5; // samples per wisp (head + 4 fading behind it)
const HALF = 10; // metres: half-size of the wrapped cube around the head
const FRACTION = [0, 0.45, 1]; // share of the wisps drawn per fx tier (low / reduced draws none, quest, desktop)

function rngOf(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WindGusts {
  /**
   * @param {THREE.Scene} scene
   * @param {object} lightUniforms  FxLighting.uniforms (shared)
   * @param {THREE.Texture|null} dot  soft round sprite shared with the dust
   * @param {() => number} [rng]
   */
  constructor(scene, lightUniforms, dot, rng) {
    this.scene = scene;
    const r = rng || rngOf(0x71d5);
    const n = WISPS * TRAIL;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const trail = new Float32Array(n);
    for (let i = 0; i < WISPS; i++) {
      const x = (r() * 2 - 1) * HALF;
      const y = (r() * 2 - 1) * HALF;
      const z = (r() * 2 - 1) * HALF;
      const ash = r() < 0.75;
      const k = 0.6 + r() * 0.4;
      for (let j = 0; j < TRAIL; j++) {
        const v = i * TRAIL + j;
        // every sample of a wisp shares the seed position (the shader walks them back along the path by aTrail)
        pos[v * 3] = x;
        pos[v * 3 + 1] = y;
        pos[v * 3 + 2] = z;
        col[v * 3] = (ash ? 0.84 : 1.0) * k;
        col[v * 3 + 1] = (ash ? 0.86 : 0.82) * k;
        col[v * 3 + 2] = (ash ? 0.88 : 0.62) * k;
        trail[v] = j / (TRAIL - 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTrail', new THREE.BufferAttribute(trail, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.setDrawRange(0, 0);
    this.uniforms = Object.assign(
      {
        uCenter: { value: new THREE.Vector3() },
        uHalf: { value: HALF },
        uWTime: { value: 0 },
        uWDir: { value: new THREE.Vector2(1, 0) }, // heading in XZ
        uWPush: { value: 0 }, // 0..1 strength of the draught right now (gust + squall)
        uWGain: { value: 3 }, // wisps are faint specks in a dark shaft: lifted so they read
      },
      lightUniforms,
    );
    const mat = new THREE.PointsMaterial({
      size: 0.07,
      map: dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    const U = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aTrail;
uniform vec3 uCenter;
uniform float uHalf;
uniform float uWTime;
uniform vec2 uWDir;
uniform float uWPush;
uniform float uWGain;
varying float vWEdge;
${FX_LIGHT_GLSL}
// where a wisp seeded at s0 is at path distance s: downwind, weaving across the wind and bobbing a little
vec3 atWispAt( vec3 s0, vec3 h, float s ) {
  vec3 across = vec3( -uWDir.y, 0.0, uWDir.x );
  float weave = sin( s * ( 0.55 + 0.5 * h.y ) + h.z * 6.283 + uWTime * 0.9 ) + 0.5 * sin( s * 1.3 + h.x * 6.283 - uWTime * 1.7 );
  float bob = sin( s * 0.7 + h.y * 6.283 + uWTime * 0.6 );
  return s0 + vec3( uWDir.x, 0.0, uWDir.y ) * s + across * weave * ( 0.45 + 0.55 * h.x ) + vec3( 0.0, bob * 0.3 - s * 0.01, 0.0 );
}`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 atHv = fract( sin( position * vec3( 12.9898, 78.233, 37.719 ) + position.yzx * vec3( 39.346, 11.135, 83.155 ) ) * 43758.5453 );
  float atLen = 0.7 + 1.1 * atHv.z; // streak length, metres
  float atS = uWTime * 0.55 * ( 0.5 + atHv.x ) * ( 0.4 + 1.3 * uWPush );
  vec3 atP = atWispAt( position, atHv, atS - aTrail * atLen );
  vec3 transformed = mod( atP - uCenter + uHalf, 2.0 * uHalf ) - uHalf;
  float atR = length( transformed );
  vWEdge = ( 1.0 - smoothstep( 0.55, 1.0, atR / uHalf ) ) * smoothstep( 0.8, 2.5, atR );
  transformed += uCenter;
  // patches of the air where the gust is gathered right now: they wander slowly, so it blows "here and there"
  float atZn = ( sin( transformed.x * 0.23 + uWTime * 0.083 + atHv.x * 0.4 ) + sin( transformed.y * 0.19 - uWTime * 0.061 + 1.7 ) + sin( transformed.z * 0.21 + uWTime * 0.047 + 3.1 ) ) * 0.3333;
  float atZone = smoothstep( 0.0, 0.5, atZn + uWPush * 0.3 );
  float atFade = pow( 1.0 - aTrail, 1.6 );
  vec3 atV = normalize( transformed - cameraPosition );
  vec3 atLit = uAmbient * 0.3 + atLantern( transformed, atV, 0.0, 1.6 ) * 1.0 + atEnvLights( transformed, atV, 0.0 ) * 0.9 + atGlow( transformed ) * 0.6;
  atLit = mix( vec3( dot( atLit, vec3( 0.2126, 0.7152, 0.0722 ) ) ), atLit, 0.6 );
  vColor.rgb *= atLit * atZone * atFade * ( 0.5 + 1.2 * uWPush ) * uWGain;`,
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = size * ( 1.15 - 0.55 * aTrail ) * ( 0.7 + 0.8 * atHv.y );')
        // never a sub-pixel speck (they shimmer): at least 1.5 px, dimmed by the area it lost
        .replace(
          '#include <logdepthbuf_vertex>',
          'float atPx = gl_PointSize;\n  gl_PointSize = max( atPx, 1.5 );\n  vColor.rgb *= min( 1.0, atPx * atPx / 2.25 );\n#include <logdepthbuf_vertex>',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWEdge;')
        .replace(
          '#include <fog_fragment>',
          '#ifdef USE_FOG\n  gl_FragColor.rgb *= 1.0 - atFogFactor( vFogDepth );\n#endif\n  gl_FragColor.rgb *= vWEdge;',
        );
    };
    mat.customProgramCacheKey = () => 'at3d-wind-wisps1';
    this.points = new THREE.Points(g, mat);
    this.points.name = 'fxWindGusts';
    this.points.frustumCulled = false;
    this.points.renderOrder = 29;
    scene.add(this.points);
    this.stats = { drawn: 0, push: 0 };
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} head  world head position
   * @param {number} tier         fx tier (0 low / reduced, 1 quest, 2 desktop)
   * @param {boolean} reduced     settings.reducedEffects
   */
  update(dt, head, tier, reduced) {
    const t = LOOK.uTime.value;
    const U = this.uniforms;
    if (head) U.uCenter.value.copy(head);
    U.uWTime.value = t;
    const a = windAngle(t);
    U.uWDir.value.set(Math.cos(a), Math.sin(a));
    // 0..1: the breathing gust plus the squall's push
    const push = Math.min(1, windGust(t) * 0.55 + windSquall(t) * 0.55);
    U.uWPush.value = push;
    const frac = reduced ? 0 : FRACTION[Math.max(0, Math.min(2, tier | 0))];
    const count = Math.floor(WISPS * frac) * TRAIL;
    this.points.geometry.setDrawRange(0, count);
    this.stats.drawn = count / TRAIL;
    this.stats.push = push;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
