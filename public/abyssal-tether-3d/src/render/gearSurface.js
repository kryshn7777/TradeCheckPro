/* ABYSSAL TETHER 3D — gearSurface.js
 * Close-range surface response for the things the player holds and wears (WP-GFX-PARITY): the gloved arms + launchers
 * (handsView / handsGear) and the body avatar (bodyView). Both are skinned GLB meshes with ONE packed material (albedo, normal, ORM =
 * occlusion / roughness / metalness), seen from 10-60 cm.
 *
 *  - WEAR MAPS: one small tiling RGBA texture (256 px, generated here once, no download): R fingerprint whorls, G hairline scratches,
 *    B micro grain (leather pores / cloth weave), A low-frequency dust. It is sampled with the BIND-POSE object position (metres) projected
 *    on the dominant axis of the bind normal, so it needs no UV layout and is steady under skinning. What it does per surface class
 *    (class = the ORM texels: metal = metalness, cloth = rough and non-metal, leather = the rest):
 *      leather   oily fingerprint smudges (glossier, a touch darker), pale scuffs, pore grain in the normal, dust in the recesses
 *      metal     bare-metal scratches (lighter, rougher, grooved normal), smears, dust that dulls the recesses
 *      cloth     a fine weave in albedo + normal, and a SHEEN: a soft Fresnel lobe scaled by the light that reaches the cloth (velvet edge
 *                light, no MeshPhysicalMaterial, ~15 ALU)
 *      skin      where the albedo reads as skin (warm, bright): a gentler specular, and a red scattering fringe at grazing angles
 *    All of it fades out beyond ~0.9 m (it is for what the hands touch). Strengths: GEAR_SURFACE.uWearK / uFabricK (live-tunable).
 *  - createGaugeGlass(): the launcher gauge glass: one shallow dome (a spherical cap, ~100 triangles, one draw call per launcher) over
 *    the dial, a transparent ShaderMaterial with a Fresnel reflection of the haze, the carried lantern's reflection (two lobes: the
 *    front surface and a fainter inner one), hairline scratches that catch the light, a film of dust. Premultiplied blend: it only adds
 *    reflections and dims the dial by a few percent, so the needle stays readable.
 * No per-frame allocation: only uniforms change.
 */

import * as THREE from 'three';
import { LOOK, makeFbm, makeRng } from './materials.js';

// ---------------------------------------------------------------------------------------------
// Wear texture
// ---------------------------------------------------------------------------------------------

const WEAR_SIZE = 256;
let _wear = null;

/** The shared wear texture (R fingerprint, G scratches, B grain, A dust), tiling, mip-mapped; built on first use. */
export function getWearTexture() {
  if (_wear) return _wear;
  const N = WEAR_SIZE;
  const data = new Uint8Array(N * N * 4);
  const rnd = makeRng(0x6ea7);
  // --- fingerprints: whorls around a few centres on the torus, ridges = distorted concentric loops ---------------------------
  const centres = [];
  for (let i = 0; i < 4; i++) centres.push({ x: ((i & 1) * 0.5 + 0.25 + (rnd() - 0.5) * 0.08) * N, y: ((i >> 1) * 0.5 + 0.25 + (rnd() - 0.5) * 0.08) * N, a: rnd() * 6.28, s: 0.8 + rnd() * 0.5 });
  const warp = makeFbm(0x51de, 4, 3);
  const fp = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let best = 1e9;
      let bi = 0;
      let bdx = 0;
      let bdy = 0;
      for (let i = 0; i < 4; i++) {
        let dx = x - centres[i].x;
        let dy = y - centres[i].y;
        dx -= Math.round(dx / N) * N;
        dy -= Math.round(dy / N) * N;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          bi = i;
          bdx = dx;
          bdy = dy;
        }
      }
      const c = centres[bi];
      const r = Math.sqrt(best);
      const th = Math.atan2(bdy, bdx) - c.a;
      // loops stretched along one axis, a delta-ish twist from the angle, a warp from low-frequency noise
      const ph = (r * (1 + 0.22 * Math.cos(2 * th))) / (3.1 * c.s) + 1.6 * Math.sin(th * 1 + c.a) * (r / 60) + 5 * warp(x / N, y / N);
      const ridge = 0.5 + 0.5 * Math.sin(ph * 6.2832);
      const edge = 1 - Math.min(1, Math.max(0, (r - 34) / 22));
      fp[y * N + x] = ridge * edge * edge * (3 - 2 * edge);
    }
  }
  // --- scratches: thin AA lines with wrap-around ---------------------------------------------------------------------------
  const sc = new Float32Array(N * N);
  const drawLine = (x0, y0, ang, len, w, amp) => {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const steps = Math.ceil(len * 1.5);
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * len;
      const fall = Math.sin((s / steps) * Math.PI); // tapered ends
      const cx = x0 + ca * t;
      const cy = y0 + sa * t;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const px = Math.round(cx) + ox;
          const py = Math.round(cy) + oy;
          const d = Math.abs((px - cx) * sa - (py - cy) * ca);
          const a = amp * fall * Math.max(0, 1 - d / w);
          if (a <= 0) continue;
          const ix = ((px % N) + N) % N;
          const iy = ((py % N) + N) % N;
          const k = iy * N + ix;
          if (a > sc[k]) sc[k] = a;
        }
      }
    }
  };
  for (let i = 0; i < 70; i++) drawLine(rnd() * N, rnd() * N, rnd() * 3.1416, 25 + rnd() * 90, 0.9, 0.35 + rnd() * 0.65);
  for (let i = 0; i < 9; i++) drawLine(rnd() * N, rnd() * N, rnd() * 3.1416, 130 + rnd() * 110, 0.8, 0.5 + rnd() * 0.5); // a few long ones
  // --- grain + dust -------------------------------------------------------------------------------------------------------------
  const grainA = makeFbm(0x9a1, 32, 3, 0.6);
  const grainB = makeFbm(0x77c, 64, 2, 0.5);
  const dust = makeFbm(0x3d57, 4, 4, 0.55);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const i = (y * N + x) * 4;
      data[i] = Math.round(Math.min(1, fp[y * N + x]) * 255);
      data[i + 1] = Math.round(Math.min(1, sc[y * N + x]) * 255);
      data[i + 2] = Math.round(Math.min(1, 0.65 * grainA(u, v) + 0.35 * grainB(u, v)) * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, (dust(u, v) - 0.2) * 1.5)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.name = 'at3dGearWear';
  _wear = tex;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Shader patch for the gear / body materials
// ---------------------------------------------------------------------------------------------

/** Live-tunable strengths (shared by every patched material): wear (x fingerprint, y scratch, z dust, w grain), fabric (x sheen, y weave, z skin). */
export const GEAR_SURFACE = {
  uWearTex: { value: null },
  uWearK: { value: new THREE.Vector4(0.9, 0.8, 0.8, 0.8) },
  uFabricK: { value: new THREE.Vector3(0.9, 0.8, 0.8) },
  uSheenCol: { value: new THREE.Color(0.62, 0.64, 0.6) },
};

const VERT_DECL = 'varying vec3 vGwP;\nvarying vec3 vGwN;\n';
const FRAG_DECL = `uniform sampler2D uWearTex;
uniform vec4 uWearK;
uniform vec3 uFabricK;
uniform vec3 uSheenCol;
varying vec3 vGwP;
varying vec3 vGwN;
`;

/** After metalnessmap_fragment: classes, albedo / roughness work, and the height used by the normal bump. */
const FRAG_SURFACE = `
  float gwMetal = clamp( metalnessFactor, 0.0, 1.0 );
  float gwFabric = smoothstep( 0.78, 0.95, roughnessFactor ) * ( 1.0 - gwMetal );
  float gwLeather = ( 1.0 - gwMetal ) * ( 1.0 - gwFabric );
  float gwLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  float gwSkin = ( 1.0 - gwMetal ) * smoothstep( 0.2, 0.36, gwLum ) * smoothstep( 0.07, 0.17, diffuseColor.r - diffuseColor.g ) * uFabricK.z;
  float gwDist = length( vViewPosition );
  float gwFade = 1.0 - smoothstep( 0.35, 0.95, gwDist );
  float gwH = 0.0;
  if ( gwFade > 0.002 ) {
    vec3 gwA = abs( vGwN );
    vec2 gwUv = ( gwA.x > max( gwA.y, gwA.z ) ) ? vGwP.zy : ( ( gwA.y > gwA.z ) ? vGwP.xz : vGwP.xy );
    vec4 gwF = texture2D( uWearTex, gwUv * 20.0 );           // 5 cm tile: prints, scratches, grain
    vec4 gwC = texture2D( uWearTex, gwUv * 3.1 + 0.37 );     // 32 cm tile: where prints land, dust, long scratches
    #ifdef USE_AOMAP
      float gwAo = texture2D( aoMap, vAoMapUv ).r;
    #else
      float gwAo = 1.0;
    #endif
    float gwDust = smoothstep( 0.35, 0.85, gwC.a ) * ( 0.3 + 0.7 * ( 1.0 - gwAo ) ) * uWearK.z * gwFade;
    float gwPrint = gwF.r * smoothstep( 0.3, 0.7, gwC.b ) * uWearK.x * gwFade;
    float gwScr = max( gwF.g, 0.8 * gwC.g ) * uWearK.y * gwFade;
    float gwWeave = ( 0.5 + 0.5 * sin( gwUv.x * 2300.0 ) * sin( gwUv.y * 2300.0 ) ) * gwFabric;
    // leather: pores, oily prints, scuffs, dust
    diffuseColor.rgb *= 1.0 + gwLeather * ( gwF.b - 0.5 ) * 0.22 * uWearK.w * gwFade;
    diffuseColor.rgb *= 1.0 - 0.07 * gwPrint * gwLeather;
    diffuseColor.rgb += gwLeather * 0.045 * gwScr * vec3( 1.0, 0.92, 0.8 );
    roughnessFactor -= 0.2 * gwPrint * gwLeather;
    // metal: bare scratches, smears, dull dusty recesses
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.53, 0.5 ), clamp( gwScr * 0.45 * gwMetal, 0.0, 0.6 ) );
    roughnessFactor += gwMetal * ( 0.1 * gwScr + 0.1 * gwPrint + 0.35 * gwDust );
    diffuseColor.rgb *= 1.0 - 0.25 * gwDust * gwMetal;
    // dust on everything that is not metal: a pale film in the recesses
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.18, 0.15 ), 0.3 * gwDust * ( 1.0 - gwMetal ) );
    // cloth weave
    diffuseColor.rgb *= 1.0 + ( gwWeave - 0.5 ) * 0.2 * uFabricK.y * gwFade;
    // skin: a little less rough
    roughnessFactor = mix( roughnessFactor, 0.52, gwSkin * 0.8 );
    gwH = 0.0004 * ( gwLeather * gwF.b * 0.8 + gwMetal * ( gwF.g * 1.6 + gwC.g ) + gwFabric * gwWeave * 0.9 ) * gwFade;
  }
`;

/** After normal_fragment_maps: grain / scratches / weave as a bump (screen-space derivatives, no tangents). */
const FRAG_BUMP = `
  if ( gwH != 0.0 ) {
    vec3 gwSx = dFdx( - vViewPosition );
    vec3 gwSy = dFdy( - vViewPosition );
    vec3 gwR1 = cross( gwSy, normal );
    vec3 gwR2 = cross( normal, gwSx );
    float gwDet = dot( gwSx, gwR1 );
    vec3 gwGrad = sign( gwDet ) * ( dFdx( gwH ) * gwR1 + dFdy( gwH ) * gwR2 );
    normal = normalize( abs( gwDet ) * normal - gwGrad );
  }
`;

/** After lights_fragment_end: the cloth sheen and the skin scattering fringe, from the light that reached the surface. */
const FRAG_SHEEN = `
  {
    vec3 gwIrr = ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) / max( diffuseColor.rgb, vec3( 0.03 ) );
    float gwIl = min( dot( gwIrr, vec3( 0.3333 ) ), 2.5 );
    float gwNV = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
    float gwEdge = pow( 1.0 - gwNV, 3.0 );
    reflectedLight.directSpecular += uSheenCol * ( gwEdge * gwIl * uFabricK.x * gwFabric * 0.55 ) * gwFade;
    reflectedLight.directSpecular += diffuseColor.rgb * vec3( 0.9, 0.28, 0.14 ) * ( pow( 1.0 - gwNV, 2.0 ) * gwIl * gwSkin * 0.35 );
  }
`;

/**
 * Chains the gear wear / sheen patch onto a MeshStandardMaterial that already has its own onBeforeCompile (the gear / body light
 * scale): the earlier patch runs first, this one then adds its pieces. Needs the ORM texture on roughnessMap / metalnessMap (the
 * classes come from it) and works with or without aoMap.
 */
export function patchGearSurface(mat) {
  if (mat.userData.gearSurface) return mat;
  mat.userData.gearSurface = true;
  GEAR_SURFACE.uWearTex.value = getWearTexture();
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev(shader, renderer);
    shader.uniforms.uWearTex = GEAR_SURFACE.uWearTex;
    shader.uniforms.uWearK = GEAR_SURFACE.uWearK;
    shader.uniforms.uFabricK = GEAR_SURFACE.uFabricK;
    shader.uniforms.uSheenCol = GEAR_SURFACE.uSheenCol;
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + VERT_DECL).replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGwP = position;\n\tvGwN = normal;');
    fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_DECL);
    if (fs.includes('#include <metalnessmap_fragment>')) {
      fs = fs.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_SURFACE);
      fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_BUMP);
      fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_SHEEN);
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => prevKey + '|at3d-gear-wear';
  mat.needsUpdate = true;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Gauge glass
// ---------------------------------------------------------------------------------------------

/** Gauge centre / normal in the socket frame (glTF axes; the left launcher mirrors x), see tools/abyssal-tether-3d/build_hands.py GAUGE_C / GAUGE_N. */
export const GAUGE = {
  center: [-0.0165, 0.1045, 0.022],
  normal: [-0.34, 0.8, 0.5],
  lift: 0.003, // glass base above the dial centre along the normal (just inside the bezel's lip)
  radius: 0.0162, // inside the bezel
  curvature: 0.05, // radius of the dome's sphere (m): the cap is ~2.7 mm high
};

const GLASS_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vP = mv.xyz;
  vN = normalize( normalMatrix * normal );
  gl_Position = projectionMatrix * mv;
}`;

const GLASS_FRAG = /* glsl */ `
uniform vec3 uLanW;
uniform vec4 uLanC;
uniform vec2 uLanR;
uniform vec3 uSky;
uniform float uDust;
uniform sampler2D uWear;
varying vec3 vN;
varying vec3 vP;
varying vec2 vUv;
void main() {
  vec3 N = normalize( vN );
  if ( ! gl_FrontFacing ) N = - N;
  vec3 V = normalize( - vP );
  float NV = clamp( dot( N, V ), 0.0, 1.0 );
  float F = 0.04 + 0.96 * pow( 1.0 - NV, 5.0 );
  // the carried lantern, as a point light close to the glass
  vec3 Lp = ( viewMatrix * vec4( uLanW, 1.0 ) ).xyz - vP;
  float Ld = max( length( Lp ), 0.02 );
  vec3 L = Lp / Ld;
  float att = pow2( clamp( 1.0 - pow4( Ld / uLanR.x ), 0.0, 1.0 ) ) / pow( Ld, uLanR.y );
  vec3 H = normalize( L + V );
  float nh = max( dot( N, H ), 0.0 );
  float spec = pow( nh, 220.0 ) * 3.0 + pow( nh, 28.0 ) * 0.22;             // front surface: a hot spot and a soft sheen
  // inner reflection: the underside of the glass sees the lantern through the dial's glow, fainter and shifted along the dome
  vec3 N2 = normalize( N + vec3( 0.0, - 0.12, 0.0 ) );
  float spec2 = pow( max( dot( N2, H ), 0.0 ), 90.0 ) * 0.35;
  // scratches (hairlines) and a film of dust from the shared wear texture
  vec2 su = vUv * vec2( 2.2, 2.2 );
  float sc = max( texture2D( uWear, su ).g, 0.8 * texture2D( uWear, su.yx * 1.6 + 0.37 ).g );
  float dust = texture2D( uWear, vUv * 1.3 + 0.2 ).a * uDust;
  vec3 lan = uLanC.rgb * att;
  vec3 col = uSky * ( F * 1.1 ) + lan * ( spec + spec2 ) * ( 0.25 + 0.75 * F + 0.4 ) + lan * sc * ( 0.18 + 6.0 * spec ) + vec3( 0.25, 0.24, 0.22 ) * dust * ( 0.1 + 0.5 * dot( lan, vec3( 0.33 ) ) );
  float a = clamp( 0.04 + 0.5 * F + 0.18 * dust + 0.12 * sc, 0.0, 0.8 );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let _glassMat = null;

/** The shared glass material (one program; the two launchers share it). */
export function getGlassMaterial() {
  if (_glassMat) return _glassMat;
  _glassMat = new THREE.ShaderMaterial({
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    uniforms: {
      uLanW: LOOK.uLanternW,
      uLanC: LOOK.uLanternC,
      uLanR: LOOK.uLanternR,
      uSky: { value: new THREE.Color(0.08, 0.1, 0.11) },
      uDust: { value: 0.7 },
      uWear: GEAR_SURFACE.uWearTex,
    },
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: true,
  });
  _glassMat.name = 'gaugeGlass';
  _glassMat.userData.noLook = true;
  GEAR_SURFACE.uWearTex.value = GEAR_SURFACE.uWearTex.value || getWearTexture();
  return _glassMat;
}

/**
 * Builds one gauge glass dome for `hand` and returns the Mesh (add it to the arm's side root; socket frame, glTF axes). The
 * geometry is a spherical cap of GAUGE.curvature standing on the dial: 16 x 3 segments (~96 triangles).
 */
export function createGaugeGlass(hand) {
  const sg = hand === 'left' ? -1 : 1;
  const R = GAUGE.curvature;
  const th = Math.asin(Math.min(0.99, GAUGE.radius / R));
  const geo = new THREE.SphereGeometry(R, 16, 3, 0, Math.PI * 2, 0, th);
  geo.translate(0, -R * Math.cos(th), 0); // the cap's base circle at the origin, apex up (+Y)
  const n = new THREE.Vector3(GAUGE.normal[0] * sg, GAUGE.normal[1], GAUGE.normal[2]).normalize();
  const c = new THREE.Vector3(GAUGE.center[0] * sg, GAUGE.center[1], GAUGE.center[2]).addScaledVector(n, GAUGE.lift);
  const mesh = new THREE.Mesh(geo, getGlassMaterial());
  mesh.name = `AT3D-gauge-glass-${hand === 'left' ? 'L' : 'R'}`;
  mesh.position.copy(c);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = true;
  return mesh;
}
