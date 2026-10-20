/* ABYSSAL TETHER 3D — vrShade.js
 * Shader snippets shared by the VR-polish pass (WP-GFX-VR-POLISH):
 *  - interleaved gradient noise (Jimenez 2014) as a screen-space dither: stable in time (no flicker), per eye (gl_FragCoord is
 *    relative to the eye's own viewport, so the two eyes get different patterns that average out binocularly), a handful of
 *    ALU and no texture. Triangular distribution, +-1 LSB at the 8-bit output: it breaks up the banding of long dark fog / halo /
 *    light-shaft gradients that an LCD headset (Quest 3) shows far more than an OLED does.
 *  - installDither() replaces three's `dithering()` (white-noise hash, +-0.5 LSB) used by every material with
 *    `dithering = true`, so the lit surfaces, fog and sky use the same pattern. Idempotent.
 */

import * as THREE from 'three';

/** Peak amplitude of the triangular dither in 8-bit LSBs. */
export const DITHER_LSB = 0.9;

/** GLSL: atIGN(pixel) 0..1, atDither3(pixel) three decorrelated triangular values in -1..1. */
export const DITHER_GLSL = /* glsl */ `
float atIGN( vec2 p ) {
	return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}
vec3 atDither3( vec2 p ) {
	float n = atIGN( p );
	vec3 o = fract( n + vec3( 0.0, 0.381966, 0.763932 ) ) * 2.0 - 1.0;
	vec3 t = o * inversesqrt( max( abs( o ), vec3( 1e-4 ) ) );
	return max( t, vec3( -1.0 ) ) - sign( o );
}
`;

const PARS = `${DITHER_GLSL}
#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		// exact black stays black (additive layers: a zero must not become a faint veil)
		float lit = max( color.r, max( color.g, color.b ) );
		return color + atDither3( gl_FragCoord.xy ) * ( ${(DITHER_LSB / 255).toFixed(6)} * smoothstep( 0.0, 0.002, lit ) );
	}
#endif
`;

export function installDither() {
  if (THREE.ShaderChunk.dithering_pars_fragment !== PARS && /dithering/.test(THREE.ShaderChunk.dithering_pars_fragment)) {
    THREE.ShaderChunk.dithering_pars_fragment = PARS;
  }
}
