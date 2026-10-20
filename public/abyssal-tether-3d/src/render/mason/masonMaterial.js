/* ABYSSAL TETHER 3D — mason/masonMaterial.js
 * Shader patch for the rigged Mason's three atlas materials (MeshStandardMaterial from the GLB: baked albedo / tangent normal /
 * ORM). Adds, on top of the standard lighting (the lantern lights it like everything else):
 *   - the radial fog curve of the level (atFogFactor when materials.js installed it), a fog CAP for the far sighting (a dark
 *     silhouette against the haze, not a fogged-out blur) and a little emissive glint that pierces the fog;
 *   - a wet film from the baked per-vertex mask (_MASK.g: flesh and mortar glisten, stone barely): roughness drops where wet;
 *   - the near-eye dissolve: fragments closer than ~1.3 m to the eye dither away (interleaved gradient noise), so the crown can
 *     never fill the headset or clip the near plane;
 *   - a faint cold ambient (x albedo) + a grazing fresnel rim so the mostly unlit mass keeps its form and its outline against the haze;
 *   - the sensory glow level and the stone ramp live in uniforms (no recompiles).
 * `reduced` (settings.reducedEffects) drops the wet film.
 */
import * as THREE from 'three';

export function makeMasonUniforms() {
  return {
    uFogCap: { value: 1 },
    uGlowPierce: { value: 0.3 },
    uWet: { value: 1 },
    uNear: { value: new THREE.Vector2(0.55, 1.3) }, // dissolve starts at x metres, fully solid beyond y
    uTint: { value: new THREE.Color(1, 1, 1) },
    uAmb: { value: new THREE.Color(0.15, 0.18, 0.2) }, // a faint cold ambient so the unlit mass keeps its form (x albedo)
    uRim: { value: new THREE.Color(0.2, 0.26, 0.29) }, // grazing rim that separates the outline from the haze
  };
}

export function patchMasonMaterial(mat, U) {
  mat.userData.masonUniforms = U;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    const fogExpr = /atFogFactor/.test(THREE.ShaderChunk.fog_pars_fragment)
      ? 'float mFog = atFogFactor( vFogDepth );'
      : `#ifdef FOG_EXP2
  float mFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
  float mFog = smoothstep( fogNear, fogFar, vFogDepth );
  #endif`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 _mask;\nvarying vec4 vMasonMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMasonMask = _mask;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 vMasonMask;
uniform float uFogCap;
uniform float uGlowPierce;
uniform float uWet;
uniform vec2 uNear;
uniform vec3 uTint;
uniform vec3 uAmb;
uniform vec3 uRim;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{
  float mD = length( vViewPosition );
  float mNf = smoothstep( uNear.x, uNear.y, mD );
  if ( mNf < 0.999 ) {
    float mIgn = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
    if ( mNf < mIgn ) discard;
  }
}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  float mFr = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmb;
  reflectedLight.directSpecular += uRim * ( mFr * mFr * mFr ) * ( 0.45 + 0.55 * vMasonMask.g );
}`,
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb *= uTint;',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, min( roughnessFactor, 0.22 ), clamp( vMasonMask.g * uWet, 0.0, 1.0 ) );',
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
vec3 mPreFog = gl_FragColor.rgb;
#endif
#include <fog_fragment>
#ifdef USE_FOG
{
  ${fogExpr}
  gl_FragColor.rgb = mix( mPreFog, fogColor, min( mFog, uFogCap ) ) + totalEmissiveRadiance * uGlowPierce * mFog;
}
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'mason-rig-v2' + (/atFogFactor/.test(THREE.ShaderChunk.fog_pars_fragment) ? '-rf' : '');
}
