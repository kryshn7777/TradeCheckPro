/* ABYSSAL TETHER 3D — mason/skitterMaterial.js (WP-SKITTER)
 * The skitterling's skin: the Mason's patched atlas material (fog curve, near dissolve, wet film, rim) regraded in the shader to ONE
 * coherent wet crimson chitin, keeping the kit's own detail (albedo luminance, tangent normal map, ORM) at the kit's texel density:
 *   - albedo: the atlas luminance drives a three-stop ramp (deep maroon in the recesses -> crimson plates -> red-orange on the lit
 *     plate edges; the edges come from the normal's screen-space derivative), a slow clotting blotch, wet flesh a touch darker;
 *   - dielectric wet gloss: no metal, roughness pulled to ~0.2 (lower on the wet flesh), so a lantern gives crisp specular
 *     highlights and the environment a wet sheen; a dull red grazing rim + a cold underlight keep the silhouette readable in the dark;
 *   - restrained life: a double heartbeat (~1 Hz) swells thin vein threads that live only on the flesh (the baked mask), a very low
 *     deep-red glow in the recesses (subsurface) so the maroon never goes flat black, and a slow travelling shimmer;
 *   - SKIN-CRAWL: small travelling ripples + swelling pustules displace the FLESH along its normal in the vertex shader (bind space,
 *     before skinning); the rigid plates barely move, so the lattice never shatters.
 * (The GLB is KHR_mesh_quantization: `position` is int16-normalized, 1 unit = ~15.4 kit metres, hence the 15.4 factors: patterns and
 * displacements are written in kit metres.)
 * All numbers live in two uniforms (uSkTime, uCrawl); no recompiles, no extra draw calls.
 */
import * as THREE from 'three';
import { makeMasonUniforms, patchMasonMaterial } from './masonMaterial.js';

export function makeSkitterUniforms() {
  const U = makeMasonUniforms();
  U.uSkTime = { value: 0 };
  U.uCrawl = { value: 1 };
  U.uNear.value.set(0.22, 0.6); // a small beast may come close
  U.uAmb.value.set(0.10, 0.02, 0.03);
  U.uRim.value.set(0.20, 0.03, 0.03);
  return U;
}

export function patchSkitterMaterial(mat, U) {
  patchMasonMaterial(mat, U);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    base(shader);
    shader.vertexShader = shader.vertexShader
      .replace('varying vec4 vMasonMask;', 'varying vec4 vMasonMask;\nvarying vec3 vSkP;\nuniform float uSkTime;\nuniform float uCrawl;')
      .replace(
        'vMasonMask = _mask;',
        `vMasonMask = _mask;
vec3 skKp = position * 15.4;
vSkP = skKp;
{
  float skFl = 0.06 + 0.94 * smoothstep( 0.3, 0.75, vMasonMask.g ); // flesh moves, plates stay rigid
  float skPh = dot( skKp, vec3( 1.7, 1.1, 1.3 ) );
  float skRip = 0.5 * sin( skPh * 19.0 - uSkTime * 9.0 ) + 0.5 * sin( skPh * 31.0 + uSkTime * 13.0 + skKp.x * 7.0 );
  float skPus = pow( max( 0.0, sin( skKp.x * 11.3 + skKp.z * 9.1 + uSkTime * 1.9 ) * sin( skKp.y * 9.7 - uSkTime * 2.3 + skKp.z * 7.3 ) ), 3.0 );
  transformed += normalize( normal ) * ( ( skRip * 0.014 + skPus * 0.05 ) / 15.4 ) * uCrawl * skFl;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('varying vec4 vMasonMask;', 'varying vec4 vMasonMask;\nvarying vec3 vSkP;\nuniform float uSkTime;\nuniform float uCrawl;')
      .replace(
        'diffuseColor.rgb *= uTint;',
        `diffuseColor.rgb *= uTint;
float skL = dot( diffuseColor.rgb, vec3( 0.30, 0.59, 0.11 ) ); // the kit's own albedo detail, regraded below`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `{
  // ---- albedo grade (the normal is known here; lighting reads diffuseColor right after) ----
  float skT = clamp( skL * 1.8, 0.0, 1.0 );
  float skCl = 0.5 + 0.5 * sin( vSkP.x * 5.0 + sin( vSkP.y * 3.7 ) ) * sin( vSkP.z * 4.3 + sin( vSkP.x * 2.9 ) );
  float skEdge = clamp( length( fwidth( normal ) ) * 2.4, 0.0, 1.0 );
  vec3 skCol = mix( vec3( 0.045, 0.004, 0.008 ), vec3( 0.30, 0.018, 0.026 ), smoothstep( 0.05, 0.5, skT ) );
  skCol = mix( skCol, vec3( 0.62, 0.13, 0.055 ), clamp( smoothstep( 0.55, 1.0, skT ) * 0.55 + skEdge * 0.5, 0.0, 0.85 ) );
  skCol *= ( 0.86 + 0.14 * skCl ) * ( 1.0 - 0.22 * vMasonMask.g );
  diffuseColor.rgb = skCol;
}
#include <emissivemap_fragment>
{
  vec3 skp = vSkP;
  float skBeat = pow( max( 0.0, sin( uSkTime * 6.5 - skp.z * 0.12 ) ), 6.0 ) + 0.55 * pow( max( 0.0, sin( uSkTime * 6.5 - 1.1 - skp.z * 0.12 ) ), 6.0 );
  float skSwell = 0.5 + 0.5 * min( skBeat, 1.0 );
  float skV1 = 1.0 - abs( sin( skp.x * 6.5 + sin( skp.y * 4.0 + skp.z * 3.0 ) * 1.7 ) );
  float skV2 = 1.0 - abs( sin( skp.z * 5.2 + sin( skp.x * 3.3 - skp.y * 5.0 ) * 1.9 ) );
  float skVein = smoothstep( 0.93, 0.995, max( skV1, skV2 ) ) * smoothstep( 0.25, 0.65, vMasonMask.g );
  totalEmissiveRadiance += vec3( 0.85, 0.05, 0.03 ) * skVein * skSwell * 0.42;
  // a very low deep-red glow in the recesses (subsurface): the maroon never goes flat black
  totalEmissiveRadiance += vec3( 0.07, 0.004, 0.004 ) * ( 1.0 - clamp( skL * 1.8, 0.0, 1.0 ) ) * ( 0.45 + 0.55 * skSwell ) * 0.7;
}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
roughnessFactor = mix( clamp( roughnessFactor * 0.55, 0.17, 0.42 ), 0.16, vMasonMask.g * 0.7 );
metalnessFactor = 0.0;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  vec3 skN = inverseTransformDirection( normal, viewMatrix );
  float skUnder = clamp( 0.5 - 0.5 * skN.y, 0.0, 1.0 );
  float skFr = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  reflectedLight.indirectDiffuse += vec3( 0.014, 0.026, 0.07 ) * skUnder * skUnder + diffuseColor.rgb * vec3( 0.16, 0.014, 0.018 );
  float skSh = 0.8 + 0.2 * sin( uSkTime * 1.7 + vSkP.x * 6.0 + vSkP.z * 4.0 );
  reflectedLight.directSpecular += vec3( 0.45, 0.06, 0.05 ) * pow( skFr, 3.0 ) * 0.4 * skSh * uCrawl;
  reflectedLight.directSpecular += vec3( 0.9, 0.38, 0.32 ) * pow( skFr, 6.0 ) * 0.22 * skSh;
}`,
      );
  };
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => 'skitter-v2-' + key();
}
