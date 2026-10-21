/* ABYSSAL TETHER 3D — mason/skitterMaterial.js (WP-SKITTER)
 * The skitterling's skin: the Mason's patched atlas material (fog curve, near dissolve, wet film, rim) recoloured in the shader to
 * wet arterial chitin and made to crawl:
 *   - albedo luminance -> crimson ramp, darker clotted recesses (blotch noise + low-albedo cavities);
 *   - pulsing vein-like emissive threads (two warped sine lattices, thresholded thin, a travelling pulse) + a dull red glow
 *     that pierces the fog, so it reads as red in the dark;
 *   - cold blue-violet underlight from below (the lantern never reaches the belly) and a glistening specular (low roughness, a
 *     slow sparkle);
 *   - SKIN-CRAWL: high-frequency travelling ripples + swelling pustule-like bumps displace the surface along its normal in the
 *     vertex shader (bind space, before skinning), a fine hair / cilia flicker on the grazing rim, and a writhing shimmer.
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
  float skPh = dot( skKp, vec3( 1.7, 1.1, 1.3 ) );
  float skRip = 0.5 * sin( skPh * 41.0 - uSkTime * 17.0 ) + 0.5 * sin( skPh * 73.0 + uSkTime * 29.0 + skKp.x * 17.0 );
  float skPus = pow( max( 0.0, sin( skKp.x * 17.3 + skKp.z * 13.1 + uSkTime * 2.3 ) * sin( skKp.y * 14.7 - uSkTime * 3.1 + skKp.z * 11.3 ) ), 3.0 );
  transformed += normalize( normal ) * ( ( skRip * 0.04 + skPus * 0.14 ) / 15.4 ) * uCrawl * ( 0.4 + 0.6 * vMasonMask.g );
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('varying vec4 vMasonMask;', 'varying vec4 vMasonMask;\nvarying vec3 vSkP;\nuniform float uSkTime;\nuniform float uCrawl;')
      .replace(
        'diffuseColor.rgb *= uTint;',
        `diffuseColor.rgb *= uTint;
{
  float skL = dot( diffuseColor.rgb, vec3( 0.30, 0.59, 0.11 ) );
  float skT = clamp( skL * 1.9, 0.0, 1.0 );
  vec3 skCol = mix( vec3( 0.030, 0.003, 0.006 ), vec3( 0.30, 0.012, 0.022 ), smoothstep( 0.05, 0.55, skT ) );
  skCol = mix( skCol, vec3( 0.60, 0.05, 0.05 ), smoothstep( 0.55, 1.0, skT ) * 0.7 );
  float skBl = sin( vSkP.x * 9.0 + sin( vSkP.y * 6.0 ) ) * sin( vSkP.z * 8.0 + sin( vSkP.x * 5.0 ) );
  skCol *= 0.78 + 0.22 * skBl;
  skCol = mix( skCol, vec3( 0.03, 0.002, 0.006 ), smoothstep( 0.0, 0.2, 0.2 - skL ) * 0.75 );
  diffuseColor.rgb = skCol;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 skp = vSkP;
  float skV1 = 1.0 - abs( sin( skp.x * 6.5 + sin( skp.y * 4.0 + skp.z * 3.0 ) * 1.7 ) );
  float skV2 = 1.0 - abs( sin( skp.z * 5.2 + sin( skp.x * 3.3 - skp.y * 5.0 ) * 1.9 ) );
  float skVein = smoothstep( 0.90, 0.995, max( skV1, skV2 ) );
  float skPulse = 0.35 + 0.65 * pow( 0.5 + 0.5 * sin( uSkTime * 5.2 - ( skp.x + skp.y * 0.7 ) * 2.4 ), 2.0 );
  totalEmissiveRadiance += vec3( 1.0, 0.07, 0.05 ) * skVein * skPulse * 0.9;
  totalEmissiveRadiance += vec3( 0.15, 0.011, 0.011 ) * ( 0.5 + 0.5 * skPulse );
}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
roughnessFactor = min( roughnessFactor, 0.24 );
metalnessFactor *= 0.25;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  vec3 skN = inverseTransformDirection( normal, viewMatrix );
  float skUnder = clamp( 0.5 - 0.5 * skN.y, 0.0, 1.0 );
  float skFr = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  reflectedLight.indirectDiffuse += vec3( 0.020, 0.040, 0.095 ) * skUnder * skUnder + diffuseColor.rgb * vec3( 0.22, 0.02, 0.025 );
  float skCil = 0.5 + 0.5 * sin( dot( vSkP, vec3( 53.0, 47.0, 61.0 ) ) + uSkTime * 31.0 );
  float skTw = step( 0.55, fract( sin( dot( floor( vSkP * 28.0 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 + uSkTime * 3.0 ) );
  reflectedLight.directSpecular += vec3( 0.80, 0.08, 0.07 ) * pow( skFr, 2.5 ) * ( 0.25 + 0.75 * skCil ) * ( 0.5 + 0.5 * skTw ) * 0.8 * uCrawl;
  reflectedLight.directSpecular += vec3( 1.0, 0.45, 0.40 ) * pow( skFr, 5.0 ) * 0.4 * ( 0.65 + 0.35 * sin( uSkTime * 2.0 + vSkP.x * 9.0 ) );
  reflectedLight.indirectDiffuse *= 1.0 + 0.10 * uCrawl * sin( uSkTime * 13.0 + dot( vSkP, vec3( 9.0, 7.0, 8.0 ) ) );
}`,
      );
  };
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => 'skitter-v1-' + key();
}
