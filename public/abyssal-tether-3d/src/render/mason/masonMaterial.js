/* ABYSSAL TETHER 3D — mason/masonMaterial.js
 * Shader patch for the rigged Mason's three atlas materials (MeshStandardMaterial from the GLB: baked albedo / tangent normal /
 * ORM). Adds, on top of the standard lighting (the lantern lights it like everything else):
 *   - the radial fog curve of the level (atFogFactor when materials.js installed it), a fog CAP for the far sighting (a dark
 *     silhouette against the haze, not a fogged-out blur) and a little emissive glint that pierces the fog;
 *   - MATTE STONE (THE LANTERN art pass): the blocks are the dressed dead under centuries of soot, not lacquer. Stone (_MASK.r = 0)
 *     gets a roughness floor (0.86), a damped direct specular, no cool rim, a lifted albedo with the baked AO crushing the cavities, and
 *     no metal (env reflection ~0.14 instead of the glTF default 0.55); only the flesh / sinew discs between the blocks (_MASK.r = 1)
 *     keep a wet film (roughness down to 0.32) and the grazing rim;
 *   - the near-eye dissolve: fragments closer than ~1.3 m to the eye dither away (interleaved gradient noise), so the crown can
 *     never fill the headset or clip the near plane;
 *   - a faint cold ambient (x albedo) + a grazing fresnel rim so the mostly unlit mass keeps its form and its outline against the haze;
 *   - the sensory glow level and the stone ramp live in uniforms (no recompiles).
 * `reduced` (settings.reducedEffects) drops the wet film.
 * SEAM EMBER (matte only): the flesh / sinew between the blocks (_MASK.r) smoulders where it is deepest (baked AO), pulsed by the
 * view's heartbeat and listening (uEmber.rgb = colour x level, kept well under the red eyes; 0 with reducedEffects).
 * The anime look's shadow tint (atToon) is the Mason's own warm-neutral uToonShade (bone-ash), not the shared violet.
 */
import * as THREE from 'three';
import { injectToon } from '../materials.js';

export function makeMasonUniforms() {
  return {
    uFogCap: { value: 1 },
    uGlowPierce: { value: 0.3 },
    uWet: { value: 1 },
    uNear: { value: new THREE.Vector2(0.55, 1.3) }, // dissolve starts at x metres, fully solid beyond y
    uTint: { value: new THREE.Color(1, 1, 1) },
    uAmb: { value: new THREE.Color(0.12, 0.15, 0.17) }, // a faint cold ambient so the unlit mass keeps its form (x albedo)
    uRim: { value: new THREE.Color(0.12, 0.16, 0.18) }, // grazing rim that separates the outline from the haze (flesh seams only, halved)
    uStone: { value: new THREE.Vector4(1.8, 0.35, 0.86, 0.3) }, // stone: albedo lift, cavity floor (x AO), roughness floor, direct specular kept
    uEmber: { value: new THREE.Color(0, 0, 0) }, // seam ember radiance (masonRigView sets it per frame)
    uAoLo: { value: 0.4 }, // the ORM's AO floor (packed lo + (1 - lo) x ao): the shader reads the raw occlusion back
    uToonShade: { value: new THREE.Vector4(0.7, 0.64, 0.56, 0.12) }, // atToon's shadow lift for the Mason: warm bone-ash, not violet
  };
}

/**
 * @param {object} [opts] opts.matte = false keeps the old all-over wet look (the skitterlings' crimson chitin, skitterMaterial.js).
 */
export function patchMasonMaterial(mat, U, opts = {}) {
  const matte = opts.matte !== false;
  mat.userData.masonUniforms = U;
  // dielectric stone: the shared reflection probe sizes envMapIntensity from these factors (lighting.js applyLookTo): 0.14, not 0.55
  if (matte && !/Emissive/i.test(mat.name || '')) {
    mat.metalness = 0;
    mat.roughness = 1;
  }
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
uniform vec3 uRim;
uniform vec4 uStone;
uniform vec3 uEmber;
uniform float uAoLo;`,
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
${
  matte
    ? `  reflectedLight.directSpecular *= mix( uStone.w, 1.0, vMasonMask.r ); // dry stone: the lantern's highlight is a dull sheen
  reflectedLight.directSpecular += uRim * ( mFr * mFr * mFr ) * 0.5 * vMasonMask.r;`
    : '  reflectedLight.directSpecular += uRim * ( mFr * mFr * mFr ) * ( 0.45 + 0.55 * vMasonMask.g );'
}
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= uTint;
${matte ? '' : '#if 0'}
{
  // stone: lift the near-black albedo toward weathered stone, crush the baked cavities (AO packed 0.4 + 0.6 ao)
  float mAo = 1.0;
#ifdef USE_AOMAP
  mAo = smoothstep( uAoLo, 1.0, texture2D( aoMap, vAoMapUv ).r );
#endif
  diffuseColor.rgb *= mix( uStone.x * mix( uStone.y, 1.0, mAo ), 1.0, vMasonMask.r );
}
${matte ? '' : '#endif'}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        matte
          ? `#include <roughnessmap_fragment>
roughnessFactor = mix( max( roughnessFactor, uStone.z ), roughnessFactor, vMasonMask.r );
roughnessFactor = mix( roughnessFactor, min( roughnessFactor, 0.32 ), clamp( vMasonMask.r * uWet, 0.0, 1.0 ) );`
          : '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, min( roughnessFactor, 0.22 ), clamp( vMasonMask.g * uWet, 0.0, 1.0 ) );',
      )
      .replace(
        '#include <emissivemap_fragment>',
        matte
          ? `#include <emissivemap_fragment>
{
  // seam ember: only the flesh, only where it is deep in the joint
  float mOcc = 1.0;
#ifdef USE_AOMAP
  mOcc = clamp( ( texture2D( aoMap, vAoMapUv ).r - uAoLo ) / ( 1.0 - uAoLo ), 0.0, 1.0 );
#endif
  totalEmissiveRadiance += uEmber * vMasonMask.r * ( 1.0 - smoothstep( 0.2, 0.65, mOcc ) );
}`
          : '#include <emissivemap_fragment>',
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
    injectToon(shader); // the cel bands (materials.js atToon): the lit colour is final here, before tone mapping and the fog tail above
    if (matte) shader.uniforms.uToonShade = U.uToonShade; // the Mason's own shadow tint (warm bone-ash instead of the shared violet)
  };
  mat.customProgramCacheKey = () => (matte ? 'mason-rig-v5' : 'mason-rig-v3') + (/atFogFactor/.test(THREE.ShaderChunk.fog_pars_fragment) ? '-rf' : '');
}
