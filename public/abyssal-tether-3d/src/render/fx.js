/* ABYSSAL TETHER 3D — fx.js
 * Effects, all pooled (no per-frame allocation, every program compiled at load
 * by Renderer3D.precompile — the objects exist from construction):
 *  - atmosphere (atmosphere.js): volumetric-looking fog — world-anchored soft
 *    cards (a far set and a small near-field set that fills the lantern's pool)
 *    + low mist sheets over ledges and across the shaft below, sampling one
 *    tileable 3D noise; lit by the lantern, the nearest lamps, the shaft key
 *    light and the creature's glow, tinted by the section fog (one draw call)
 *  - lantern halo (lanternHalo.js): the lantern's glow in the haze, one quad
 *    with a closed-form scattering integral per pixel (one draw call)
 *  - ambient dust / ash: a fixed cloud of points wrapped around the head in
 *    the vertex shader (zero CPU per particle); each mote tumbles and drifts on
 *    its own path and shines only where the lantern / lamps / creature light it
 *  - trickles (debris.js): grit streaming from cracks and down walls (grains +
 *    a faint veil), water drips in the wet deep sections; the fall runs in the
 *    vertex shader (one draw call)
 *  - bursts: sparks, dust puffs, grit, chips and splashes (one Points draw)
 *  - rubble (debris.js): pooled stones that bounce off the level and settle
 *    (one InstancedMesh draw), shed by: the creature as it passes (more the
 *    closer and faster) and where it strikes / windups / slams the gate, its
 *    footfalls, hard landings, wall hits, crumbling ledges, fragile anchors
 *    under load, rope jolts, level rumbles and debris triggers (a column of
 *    stones falls at data.x/y/z, where the audio puts it), and the gate slam
 *  - the death fade: a black sphere around the head (opacity from game.fade),
 *    with a dim warm flash on big impacts (game.flash)
 * Quality tiers: settings.reducedEffects → minimal; WebXR → Quest budget;
 * desktop → high. `?fx=low|quest|high` (or settings.fxQuality) forces a tier.
 * Draw calls added over the old FX: fog 1 + halo 1 + trickles 1 + rubble 1 (only
 * while any stone is alive) = 4 (≤ 8 000 triangles in the worst case).
 */

import * as THREE from 'three';
import { Atmosphere, FX_LIGHT_GLSL, FxLighting, makeNoise3D } from './atmosphere.js';
import { CreatureDust } from './creatureDust.js';
import { Rubble, Trickles } from './debris.js';
import { LanternHalo } from './lanternHalo.js';
import { GodRays } from './godRays.js';

const DUST_COUNT = 1100;
const DUST_HALF = 9; // metres: half-size of the wrapped cube around the head
const BURST_MAX = 360;
const DEBRIS_MAX = 80; // × 80 triangles (worst case 6.4k, typically < 2k)
const GRAVITY = 13.5;

const K_SPARK = 0;
const K_PUFF = 1;
const K_CHIP = 2; // small bright-ish stone flecks
const K_DROP = 3; // water droplets (splashes)

/** Wet share of the trickles per section (drips in the deep, wet stretches). */
const SECTION_WET = [0, 0.1, 0.25, 0.45, 0.85, 0.6, 0.75, 1];
const HANDS = ['left', 'right'];
const TIER_NAMES = { low: 0, reduced: 0, quest: 1, xr: 1, medium: 1, high: 2, desktop: 2 };

function num(v, fb) {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}

function softDot(size = 32) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function urlTier() {
  try {
    if (typeof location === 'undefined') return -1;
    const m = /[?&]fx=([a-z]+)/i.exec(location.search || '');
    return m && m[1].toLowerCase() in TIER_NAMES ? TIER_NAMES[m[1].toLowerCase()] : -1;
  } catch {
    return -1;
  }
}

export class FX {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera  the head camera (fade sphere is its child)
   */
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.time = 0;
    this.threat = 0;
    this.reduced = false;
    this.tier = 2;
    this._forcedTier = urlTier();
    this._rng = mulberry(0x5eed);
    this._unsub = [];
    this._bus = null;
    this._head = null;
    this._game = null;
    this._dot = softDot(32);
    this.lighting = new FxLighting(scene);
    this._noise = makeNoise3D(64);
    this.atmosphere = new Atmosphere(scene, this.lighting, this._noise, this._rng);
    this.halo = new LanternHalo(scene, this.lighting.uniforms, this._noise);
    this.godRays = new GodRays(scene, this.lighting.uniforms, this._noise, this.halo);
    this.trickles = new Trickles(scene, this.lighting.uniforms, this._rng);
    this.trickles.burst = (kind, x, y, z, opts) => this.burst(kind, x, y, z, opts);
    this._buildDust();
    this._buildBursts();
    this.creatureDust = new CreatureDust(scene, this.lighting.uniforms, this._rng); // ground dust under the moving creatures (one draw)
    this._buildDebris();
    this._buildFade();
    // Event rubble state
    this._shedAcc = 0;
    this._stressAcc = 0;
    this._joltT = 0;
    this._rains = [];
    for (let i = 0; i < 4; i++) this._rains.push({ left: 0, rate: 0, acc: 0, x: 0, y: 0, z: 0 });
    this._gateObj = null;
    this._gateFindT = 0;
    this._gateY = NaN;
    this._gateMoving = false;
    this._slamT = -1; // fallback timer after game:goal when the gate mesh is unknown
    this._slammed = false;
    this.stats = { cards: 0, streams: 0, rubble: 0, points: 0 };
  }

  // ---------------------------------------------------------------------------
  _buildDust() {
    const n = DUST_COUNT;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const r = this._rng;
    for (let i = 0; i < n; i++) {
      // Denser near the head (the lantern's pool is where motes read): radius ~ u^1.6 of the cube.
      const rad = Math.pow(r(), 1.6) * DUST_HALF;
      const th = r() * Math.PI * 2;
      const cp = r() * 2 - 1;
      const sp = Math.sqrt(1 - cp * cp);
      pos[i * 3] = Math.cos(th) * sp * rad;
      pos[i * 3 + 1] = cp * rad;
      pos[i * 3 + 2] = Math.sin(th) * sp * rad;
      // albedo of the mote (it shines only when something lights it): pale stone/ash, a few warm fibres
      const ash = r() < 0.8;
      const k = 0.55 + r() * 0.45;
      col[i * 3] = (ash ? 0.85 : 1.0) * k;
      col[i * 3 + 1] = (ash ? 0.84 : 0.8) * k;
      col[i * 3 + 2] = (ash ? 0.8 : 0.6) * k;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.dustU = Object.assign(
      {
        uCenter: { value: new THREE.Vector3() },
        uOffset: { value: new THREE.Vector3() },
        uHalf: { value: DUST_HALF },
        uTime: { value: 0 },
        uMoteGain: { value: 1 },
      },
      this.lighting.uniforms,
    );
    const mat = new THREE.PointsMaterial({
      size: 0.03,
      map: this._dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    const U = this.dustU;
    // Motes shine only where light reaches them: the lantern (warm and strong close by: dust in a
    // lamp beam), the nearest lamps and the creature's glow, plus a whisper of ambient so the
    // far air is not black. Each one tumbles (a slow sparkle), drifts on its own lissajous around
    // a shared wind, and fades out of the cube edge and right next to the eyes. Motion is entirely
    // in the vertex shader from uTime (no per-particle CPU work).
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform vec3 uCenter;\nuniform vec3 uOffset;\nuniform float uHalf;\nuniform float uTime;\nuniform float uMoteGain;\nvarying float vDustEdge;\n${FX_LIGHT_GLSL}`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 atHv = fract( sin( position * vec3( 12.9898, 78.233, 37.719 ) + position.yzx * vec3( 39.346, 11.135, 83.155 ) ) * 43758.5453 );
  float atH = atHv.x;
  vec3 atP = position + uOffset * ( 0.55 + 0.9 * atHv.y );
  atP += vec3( sin( uTime * ( 0.21 + atHv.x * 0.37 ) + atHv.y * 6.283 ), 0.5 * sin( uTime * ( 0.17 + atHv.y * 0.3 ) + atHv.z * 6.283 ), cos( uTime * ( 0.19 + atHv.z * 0.33 ) + atHv.x * 6.283 ) ) * ( 0.18 + 0.32 * atHv.z );
  vec3 transformed = mod( atP - uCenter + uHalf, 2.0 * uHalf ) - uHalf;
  float atR = length( transformed );
  vDustEdge = 1.0 - smoothstep( 0.6, 1.0, atR / uHalf );
  vDustEdge *= smoothstep( 0.3, 0.95, atR );
  transformed += uCenter;
  vec3 atV = normalize( transformed - cameraPosition );
  vec3 atLit = uAmbient * 0.25 + atLantern( transformed, atV, 0.0, 1.6 ) * 0.9 + atEnvLights( transformed, atV, 0.0 ) * 0.8 + atGlow( transformed ) * 0.6;
  atLit = mix( vec3( dot( atLit, vec3( 0.2126, 0.7152, 0.0722 ) ) ), atLit, 0.65 ); // lit dust is pale, not orange
  float atTw = 0.5 + 0.5 * sin( uTime * ( 0.9 + 2.4 * atHv.z ) + atHv.y * 40.0 );
  vColor.rgb *= atLit * ( 0.35 + 1.3 * atTw * atTw ) * uMoteGain;`,
        )
        .replace(
          'gl_PointSize = size;',
          'gl_PointSize = size * ( 0.55 + 0.9 * atH );',
        )
        // never a sub-pixel speck (they shimmer): at least 1.5 px, dimmed by the area it lost
        .replace(
          '#include <logdepthbuf_vertex>',
          'float atPx = gl_PointSize;\n  gl_PointSize = max( atPx, 1.5 );\n  vColor.rgb *= min( 1.0, atPx * atPx / 2.25 );\n#include <logdepthbuf_vertex>',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDustEdge;')
        .replace(
          '#include <fog_fragment>',
          '#ifdef USE_FOG\n  gl_FragColor.rgb *= 1.0 - atFogFactor( vFogDepth );\n#endif\n  gl_FragColor.rgb *= vDustEdge;',
        );
    };
    mat.customProgramCacheKey = () => 'at3d-dust-lit2';
    this.dust = new THREE.Points(g, mat);
    this.dust.name = 'fxDust';
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 30;
    g.setDrawRange(0, Math.floor(n * 0.45));
    this.scene.add(this.dust);
  }

  _buildBursts() {
    const n = BURST_MAX;
    this.b = {
      n: 0,
      kind: new Uint8Array(n),
      px: new Float32Array(n),
      py: new Float32Array(n),
      pz: new Float32Array(n),
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      vz: new Float32Array(n),
      life: new Float32Array(n),
      max: new Float32Array(n),
      cr: new Float32Array(n),
      cg: new Float32Array(n),
      cb: new Float32Array(n),
      size: new Float32Array(n),
    };
    const g = new THREE.BufferGeometry();
    this.bPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.bCol = new THREE.BufferAttribute(new Float32Array(n * 4), 4); // rgb + alpha
    this.bSize = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.bKind = new THREE.BufferAttribute(new Float32Array(n), 1); // 0 glowing (sparks), 1 lit dust/stone, 2 lit glint (water)
    for (const a of [this.bPos, this.bCol, this.bSize, this.bKind]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.bPos);
    g.setAttribute('color', this.bCol);
    g.setAttribute('aSize', this.bSize);
    g.setAttribute('aKind', this.bKind);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.setDrawRange(0, 0);
    // Premultiplied blending: sparks ADD (alpha 0), while dust, grit and stone flecks are
    // lit by the lantern / lamps / ambient and blend OVER what is behind them (dust is
    // not a light: a puff in the dark is a dark smudge, in the lantern light a warm cloud).
    const mat = new THREE.PointsMaterial({
      size: 1,
      map: this._dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      sizeAttenuation: true,
      toneMapped: false,
    });
    const LU = this.lighting.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, LU);
      // Cap each point at 1/8 of the viewport height (scale = half the target
      // height): a hard landing's puffs right at the feet would otherwise cover
      // most of both eyes several layers deep.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aSize;\nattribute float aKind;\nvarying float vKind;\n${FX_LIGHT_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  vKind = aKind;
  if ( aKind > 0.5 ) vColor.rgb *= min( uAmbient + atLightAt( transformed, normalize( transformed - cameraPosition ), 0.2 ) * 0.32, vec3( 1.5 ) );`,
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;')
        .replace('#include <logdepthbuf_vertex>', 'gl_PointSize = min( gl_PointSize, scale * 0.25 );\n#include <logdepthbuf_vertex>');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vKind;').replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
  float atF = atFogFactor( vFogDepth );
#else
  float atF = 0.0;
#endif
  if ( vKind > 0.5 && vKind < 1.5 ) {
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, atF );
    gl_FragColor.a *= 1.0 - 0.6 * atF;
    gl_FragColor.rgb *= gl_FragColor.a;
  } else {
    gl_FragColor.rgb *= gl_FragColor.a * ( 1.0 - atF );
    gl_FragColor.a = 0.0;
  }`,
      );
    };
    mat.customProgramCacheKey = () => 'at3d-burst-lit';
    this.bursts = new THREE.Points(g, mat);
    this.bursts.name = 'fxBursts';
    this.bursts.frustumCulled = false;
    this.bursts.renderOrder = 31;
    this.bursts.visible = false; // shown while any point is alive (empty draws still cost a program bind per eye)
    this.scene.add(this.bursts);
  }

  _buildDebris() {
    this.rubble = new Rubble(this.scene, DEBRIS_MAX, this._rng, this.lighting.uniforms);
    this.debris = this.rubble.mesh; // the pooled stones (name 'fxDebris')
    // First hard knocks of a falling stone: a little grit and dust where it hits.
    this.rubble.onImpact = (x, y, z, speed, size) => {
      const h = this._head;
      if (!h) return;
      const dx = x - h.x;
      const dy = y - h.y;
      const dz = z - h.z;
      if (dx * dx + dy * dy + dz * dz > 22 * 22) return;
      if (size > 0.07 || this._rng() < 0.35) this.burst('dust', x, y + 0.03, z, { count: size > 0.12 ? 2 : 1 });
      if (speed > 6 && this._rng() < 0.5) this.burst('chips', x, y + 0.02, z, { count: 2 });
    };
  }

  _buildFade() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.fade = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), mat);
    this.fade.name = 'fxFadeSphere';
    // Drawn after the world with no depth test. UI panels shown over the death fade use
    // > 900; in XR the hand launchers draw after it too (handsView, 960), so the
    // controllers you point at a pause/death panel never go dark. On desktop they fade.
    this.fade.renderOrder = 900;
    this.fade.frustumCulled = false;
    this.fade.visible = false;
    this.camera.add(this.fade);
    this._flashColor = new THREE.Color(0x3a1c10);
    this._black = new THREE.Color(0x000000);
  }

  // ---------------------------------------------------------------------------
  // Bus
  // ---------------------------------------------------------------------------
  bindBus(bus) {
    if (bus === this._bus) return;
    this.unbind();
    this._bus = bus;
    if (!bus || typeof bus.on !== 'function') return;
    const on = (type, fn) => this._unsub.push(bus.on(type, fn));
    // A hand takes a procedural edge hold: a pinch of chalky grit off the stone (the authored studs are already chalked).
    on('climb:grab', (e) => {
      if (e && e.edge === true && isFinite(e.x)) this.burst('dust', e.x, e.y - 0.03, e.z, { count: 1 });
    });
    on('grapple:attach', (e) => {
      const an = e.anchor || {};
      const x = num(e.x, an.x);
      const y = num(e.y, an.y);
      const z = num(e.z, an.z);
      if (!isFinite(x)) return;
      if (an.kind === 'fragile') {
        this.burst('chips', x, y, z, { count: 8 });
        this.burst('puff', x, y, z, { count: 4 });
        this._pebbles(x, y - 0.1, z, 2, 0.025, 0.05);
      } else {
        this.burst('sparks', x, y, z, { count: 10 + Math.min(10, num(e.speed, 0) * 0.6) });
        // The bite knocks loose a little grit.
        this.burst('dust', x, y - 0.05, z, { count: 1 });
      }
    });
    on('grapple:break', (e) => {
      const x = num(e.x, NaN);
      if (!isFinite(x)) return;
      this.burst('debris', x, num(e.y, 0), num(e.z, 0), { count: 7, size: 0.06 });
      this.burst('puff', x, num(e.y, 0), num(e.z, 0), { count: 8 });
      this.burst('sparks', x, num(e.y, 0), num(e.z, 0), { count: 8 });
    });
    on('platform:crumble', (e) => {
      const s = e.solid;
      if (s && isFinite(s.minX)) {
        const area = Math.max(1, (s.maxX - s.minX) * (s.maxZ - s.minZ));
        const n = Math.min(40, Math.round(10 + area * 2.5));
        for (let i = 0; i < n; i++) {
          const x = s.minX + this._rng() * (s.maxX - s.minX);
          const y = s.minY + this._rng() * (s.maxY - s.minY);
          const z = s.minZ + this._rng() * (s.maxZ - s.minZ);
          this._spawnDebris(x, y, z, (this._rng() - 0.5) * 1.2, -this._rng() * 1.5, (this._rng() - 0.5) * 1.2, 0.08 + this._rng() * 0.22);
        }
        const cx = (s.minX + s.maxX) / 2;
        const cz = (s.minZ + s.maxZ) / 2;
        this.burst('puff', cx, s.maxY, cz, { count: 18, spread: Math.max(0.5, Math.sqrt(area) * 0.5) });
        this.trickles.agitate(0.6);
      } else if (isFinite(num(e.x, NaN))) {
        this.burst('debris', e.x, num(e.y, 0), num(e.z, 0), { count: 14, size: 0.14 });
      }
    });
    on('player:land', (e) => {
      const x = num(e.x, NaN);
      if (!isFinite(x)) return;
      const impact = num(e.impact, 0);
      // Few, wide puffs: they spawn at the feet, so each one covers a lot of both eyes.
      this.burst('puff', x, num(e.y, 0), num(e.z, 0), { count: Math.min(8, 2 + Math.round(impact * 0.5)), spread: 0.4, ground: true });
      if (e.hard) {
        this.burst('chips', x, num(e.y, 0), num(e.z, 0), { count: 8 });
        // Stones kicked loose around the feet: they skitter outward and settle on the floor.
        this._kick(x, num(e.y, 0), num(e.z, 0), Math.min(12, 5 + Math.round(impact * 0.4)), impact);
        this.burst('dust', x, num(e.y, 0) + 0.05, num(e.z, 0), { count: 3, spread: 0.5 });
        this.trickles.agitate(0.25);
      }
    });
    on('player:wallhit', (e) => {
      const x = num(e.x, NaN);
      if (!isFinite(x)) return;
      this.burst('chips', x, num(e.y, 0), num(e.z, 0), { count: Math.min(10, 3 + Math.round(num(e.impact, 0) * 0.4)) });
      this.burst('puff', x, num(e.y, 0), num(e.z, 0), { count: 3 });
      if (num(e.impact, 0) > 6) this._pebbles(x, num(e.y, 0), num(e.z, 0), 2, 0.03, 0.06);
    });
    on('player:death', (e) => {
      const x = num(e.x, NaN);
      if (!isFinite(x)) return;
      this.burst('puff', x, num(e.y, 0), num(e.z, 0), { count: 14, spread: 0.6 });
    });
    // A rope snapping taut wrenches its anchor: grit and a pebble or two from the stone.
    on('rope:jolt', (e) => {
      const g = this._game;
      const speed = num(e && e.speed, 0);
      if (!g || !g.tethers || speed < 3 || this._joltT > 0) return;
      this._joltT = 0.12;
      for (const h of HANDS) {
        const st = g.tethers.hands && g.tethers.hands[h];
        const an = st && st.rope && st.rope.anchor;
        if (!an || !isFinite(an.x)) continue;
        this.burst('dust', an.x, an.y - 0.08, an.z, { count: 1 + (speed > 8 ? 1 : 0) });
        this.burst('chips', an.x, an.y - 0.05, an.z, { count: Math.min(5, 1 + Math.round(speed * 0.3)) });
        if (speed > 6) this._pebbles(an.x, an.y - 0.12, an.z, 1 + (speed > 10 ? 1 : 0), 0.02, 0.045);
      }
    });
    on('creature:burst', (e) => {
      const d = num(e.distance, 1e9);
      if (d < 45) {
        this._rain(Math.round(THREE.MathUtils.lerp(14, 4, d / 45)));
        this.trickles.agitate(0.8 * (1 - d / 45));
      }
    });
    // Footfalls of something vast: stone shaken loose where it plants a limb.
    on('creature:step', (e) => {
      const d = num(e && e.distance, 1e9);
      if (d > 30 || !isFinite(num(e.x, NaN))) return;
      const k = num(e.intensity, 0.5) * (1 - d / 30);
      const n = Math.round(k * 3 + this._rng() * 0.8);
      if (n > 0) this._pebbles(e.x, num(e.y, 0), num(e.z, 0), n, 0.03, 0.11);
      if (k > 0.15) this.burst('chips', e.x, num(e.y, 0), num(e.z, 0), { count: Math.round(2 + k * 4) });
      if (k > 0.3) this.burst('dust', e.x, num(e.y, 0), num(e.z, 0), { count: 1 });
    });
    // A lunge lands: stone breaks off where the limbs strike, more the closer it is to the player.
    on('creature:strike', (e) => {
      const d = num(e.distance, 1e9);
      const x = num(e.x, NaN);
      if (!isFinite(x) || d > 40) return;
      const k = 1 - d / 40;
      this._pebbles(x, num(e.y, 0), num(e.z, 0), Math.round(3 + k * 7), 0.04, 0.16);
      this.burst('chips', x, num(e.y, 0), num(e.z, 0), { count: Math.round(4 + k * 8) });
      this.burst('puff', x, num(e.y, 0), num(e.z, 0), { count: 3 });
      this.trickles.agitate(0.5 * k);
    });
    // The windup of an attack (or the blows on the sealed gate): the shaft shudders and sheds.
    on('creature:attack', (e) => {
      const d = num(e.distance, 1e9);
      if (e.gate) {
        this._rain(10);
        this.trickles.agitate(1);
        const x = num(e.x, NaN);
        if (isFinite(x)) this._pebbles(x, num(e.y, 0), num(e.z, 0), 8, 0.04, 0.18);
      } else if (d < 40) {
        this._rain(Math.round(2 + 5 * (1 - d / 40)));
        this.trickles.agitate(0.35 * (1 - d / 40));
      }
    });
    // Level trigger: debris raining past at data.x/y/z (the same spot the audio places it). A column of
    // stones falls there for ~2 s with dust where it breaks away; without a position it rains above the head.
    on('trigger:debris', (e) => {
      const d = (e && e.data) || {};
      const inten = THREE.MathUtils.clamp(num(d.intensity, 0.5), 0.1, 1.5);
      if (isFinite(num(d.x, NaN)) && isFinite(num(d.y, NaN)) && isFinite(num(d.z, NaN))) this._startRain(d.x, d.y, d.z, 12 + Math.round(inten * 26), 1.9);
      else this._rain(THREE.MathUtils.clamp(num(d.count, 16), 1, 50));
      this.trickles.agitate(0.6 + inten * 0.6);
    });
    on('trigger:rumble', (e) => {
      this._rain(THREE.MathUtils.clamp(num(e.data && e.data.count, 9), 1, 40));
      this.trickles.agitate(0.4 + num(e.data && e.data.intensity, 0.5));
    });
    on('game:goal', () => {
      this._slamT = 0.45; // fallback when the gate mesh is not found
      this._slammed = false;
    });
    on('game:restart', () => this.reset());
    on('game:respawn', () => this.reset());
    on('game:warp', () => this.reset());
  }

  unbind() {
    for (const off of this._unsub) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this._unsub.length = 0;
    this._bus = null;
  }

  reset() {
    this.b.n = 0;
    this.rubble.reset();
    this.trickles.reset();
    this.atmosphere.reset();
    this.bursts.geometry.setDrawRange(0, 0);
    this.creatureDust.reset();
    this.bursts.visible = false;
    this._slamT = -1;
    this._slammed = false;
    for (let i = 0; i < this._rains.length; i++) this._rains[i].left = 0;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  /**
   * kind: 'sparks' | 'puff' | 'chips' | 'debris' | 'dust' (small grit puff) | 'splash' (water)
   * opts: { count, spread, size, ground, up }
   */
  burst(kind, x, y, z, opts = {}) {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    const r = this._rng;
    const count = Math.max(1, Math.round(num(opts.count, 8) * (this.reduced ? 0.5 : 1)));
    if (kind === 'debris') {
      const sz = num(opts.size, 0.08);
      for (let i = 0; i < count; i++) {
        this._spawnDebris(x + (r() - 0.5) * 0.3, y + (r() - 0.5) * 0.3, z + (r() - 0.5) * 0.3, (r() - 0.5) * 4, (opts.up ? 2 : 0) + r() * 2.5, (r() - 0.5) * 4, sz * (0.5 + r()));
      }
      return;
    }
    const spread = num(opts.spread, 0.15);
    for (let i = 0; i < count; i++) {
      let k;
      let vx;
      let vy;
      let vz;
      let life;
      let size;
      let cr;
      let cg;
      let cb;
      if (kind === 'sparks') {
        k = K_SPARK;
        const sp = 3 + r() * 6;
        const th = r() * Math.PI * 2;
        const ph = Math.acos(r() * 2 - 1);
        vx = Math.sin(ph) * Math.cos(th) * sp;
        vy = Math.cos(ph) * sp + 1.5;
        vz = Math.sin(ph) * Math.sin(th) * sp;
        life = 0.25 + r() * 0.35;
        size = 0.04 + r() * 0.03;
        cr = 1.0;
        cg = 0.62 + r() * 0.2;
        cb = 0.28;
      } else if (kind === 'chips') {
        k = K_CHIP;
        const sp = 1.5 + r() * 3.5;
        vx = (r() - 0.5) * 2 * sp;
        vy = r() * sp;
        vz = (r() - 0.5) * 2 * sp;
        life = 0.5 + r() * 0.5;
        size = 0.03 + r() * 0.03;
        const sh = 0.32 + r() * 0.2; // stone flecks (albedo)
        cr = sh * 1.05;
        cg = sh;
        cb = sh * 0.9;
      } else if (kind === 'splash') {
        k = K_DROP;
        const sp = 0.8 + r() * 1.6;
        const th = r() * Math.PI * 2;
        vx = Math.cos(th) * sp * 0.6;
        vy = 0.8 + r() * 1.6;
        vz = Math.sin(th) * sp * 0.6;
        life = 0.22 + r() * 0.2;
        size = 0.016 + r() * 0.014;
        cr = 0.5;
        cg = 0.58;
        cb = 0.64;
      } else if (kind === 'dust') {
        // A small, dim grit puff (stone landing, grit hitting a ledge).
        k = K_PUFF;
        const sp = 0.2 + r() * 0.5;
        const th = r() * Math.PI * 2;
        vx = Math.cos(th) * sp;
        vy = 0.05 + r() * 0.25;
        vz = Math.sin(th) * sp;
        life = 0.7 + r() * 0.7;
        size = 0.12 + r() * 0.14;
        const gg = 0.3 + r() * 0.12; // grit dust (albedo)
        cr = gg * 1.05;
        cg = gg;
        cb = gg * 0.9;
      } else {
        k = K_PUFF;
        const sp = 0.3 + r() * 0.9;
        const th = r() * Math.PI * 2;
        vx = Math.cos(th) * sp * (opts.ground ? 2.2 : 1);
        vy = opts.ground ? 0.15 + r() * 0.4 : (r() - 0.3) * sp;
        vz = Math.sin(th) * sp * (opts.ground ? 2.2 : 1);
        life = 0.9 + r() * 1.1;
        size = 0.35 + r() * 0.45;
        const g = 0.32 + r() * 0.12; // stone dust (albedo)
        cr = g * 1.05;
        cg = g;
        cb = g * 0.92;
      }
      this._spawnPoint(k, x + (r() - 0.5) * spread * 2, y + (r() - 0.5) * spread, z + (r() - 0.5) * spread * 2, vx, vy, vz, life, size, cr, cg, cb);
    }
  }

  _spawnPoint(kind, x, y, z, vx, vy, vz, life, size, cr, cg, cb) {
    const b = this.b;
    let i = b.n;
    if (i >= BURST_MAX) {
      // evict the oldest-looking (smallest remaining life)
      i = 0;
      let best = Infinity;
      for (let j = 0; j < BURST_MAX; j += 7) {
        if (b.life[j] < best) {
          best = b.life[j];
          i = j;
        }
      }
    } else b.n++;
    b.kind[i] = kind;
    b.px[i] = x;
    b.py[i] = y;
    b.pz[i] = z;
    b.vx[i] = vx;
    b.vy[i] = vy;
    b.vz[i] = vz;
    b.life[i] = life;
    b.max[i] = life;
    b.size[i] = size;
    b.cr[i] = cr;
    b.cg[i] = cg;
    b.cb[i] = cb;
  }

  _spawnDebris(x, y, z, vx, vy, vz, size) {
    this.rubble.spawn(x, y, z, vx, vy, vz, size);
  }

  /**
   * n pebbles knocked loose in a ring around a landing at (x, y, z) (y = the floor): they skip
   * outward, low (≤ ~25 cm high: nothing flies up into the eyes), and settle.
   */
  _kick(x, y, z, n, impact) {
    const r = this._rng;
    const count = this.reduced ? Math.ceil(n * 0.5) : n;
    const sp0 = 0.7 + Math.min(1.6, num(impact, 0) * 0.08);
    for (let i = 0; i < count; i++) {
      const th = r() * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const rad = 0.28 + r() * 0.4;
      const sp = sp0 * (0.6 + r() * 0.8);
      this._spawnDebris(x + c * rad, y + 0.05, z + s * rad, c * sp, 0.6 + r() * 1.5, s * sp, 0.025 + r() * r() * 0.06);
    }
  }

  /** n small stones dropping from (x, y, z) with a little scatter. */
  _pebbles(x, y, z, n, s0, s1) {
    const r = this._rng;
    const count = this.reduced ? Math.ceil(n * 0.5) : n;
    for (let i = 0; i < count; i++) {
      this._spawnDebris(x + (r() - 0.5) * 0.25, y + (r() - 0.5) * 0.15, z + (r() - 0.5) * 0.25, (r() - 0.5) * 1.6, -r() * 1.2, (r() - 0.5) * 1.6, s0 + r() * (s1 - s0));
    }
  }

  /** A timed column of n falling stones at (x, y, z) over `dur` seconds (a free emitter slot, else the oldest). */
  _startRain(x, y, z, n, dur) {
    let q = null;
    const rains = this._rains;
    for (let i = 0; i < rains.length; i++) if (rains[i].left <= 0) q = rains[i];
    if (!q) {
      q = rains[0];
      for (let i = 1; i < rains.length; i++) if (rains[i].left < q.left) q = rains[i];
    }
    q.x = x;
    q.y = y;
    q.z = z;
    q.left = dur;
    q.rate = (n * (this.reduced ? 0.5 : 1)) / dur;
    q.acc = 0;
    this.burst('puff', x, y, z, { count: 5, spread: 1.2 });
  }

  _updateRains(dt) {
    const r = this._rng;
    const rains = this._rains;
    for (let ri = 0; ri < rains.length; ri++) {
      const q = rains[ri];
      if (q.left <= 0) continue;
      q.left -= dt;
      q.acc += q.rate * dt;
      while (q.acc >= 1) {
        q.acc -= 1;
        const sz = 0.07 + r() * r() * 0.3; // chunks of the structure, visible 15-20 m away
        this._spawnDebris(q.x + (r() - 0.5) * 2.2, q.y + r() * 1.6, q.z + (r() - 0.5) * 2.2, (r() - 0.5) * 0.8, -1 - r() * 3, (r() - 0.5) * 0.8, sz);
        if (r() < 0.45) this._spawnPoint(K_PUFF, q.x + (r() - 0.5) * 2, q.y + r(), q.z + (r() - 0.5) * 2, 0, -2.5, 0, 1.8, 0.55, 0.34, 0.33, 0.31);
      }
    }
  }

  /** Stones and grit breaking off the stone above the player (rumbles, bursts, the slam). */
  _rain(n) {
    const h = this._head;
    if (!h) return;
    const r = this._rng;
    const count = Math.round(n * (this.reduced ? 0.5 : 1));
    const level = this._game && this._game.level;
    for (let i = 0; i < count; i++) {
      let x = h.x + (r() - 0.5) * 12;
      let z = h.z + (r() - 0.5) * 12;
      // not straight down through the head
      const ox = x - h.x;
      const oz = z - h.z;
      const o2 = ox * ox + oz * oz;
      if (o2 < 0.9 * 0.9) {
        const k = 0.9 / Math.max(0.05, Math.sqrt(o2));
        x = h.x + (o2 > 1e-4 ? ox * k : 0.9);
        z = h.z + oz * k;
      }
      let y = h.y + 8 + r() * 14;
      // Break off the first stone overhead (a ceiling, a ledge's underside) when there is one.
      if (level && typeof level.raycast === 'function') {
        const hit = level.raycast(x, h.y, z, 0, 1, 0, 24, this._rayHit || (this._rayHit = { t: 0, solid: null, x: 0, y: 0, z: 0 }));
        if (hit && hit.t > 0.6) y = Math.min(y, h.y + hit.t - 0.12);
      }
      this._spawnDebris(x, y, z, (r() - 0.5) * 0.6, -0.5 - r() * 2.5, (r() - 0.5) * 0.6, 0.04 + r() * 0.15);
      if (i % 3 === 0) this._spawnPoint(K_PUFF, x, y, z, 0, -3, 0, 2.2, 0.5, 0.34, 0.33, 0.31);
    }
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {object} game     reads fade, flash, settings.reducedEffects, level, creature, tethers, xrActive
   * @param {THREE.Vector3} head  world head position
   * @param {number} threat   0..1
   */
  update(dt, game, head, threat) {
    this.time += dt;
    this._head = head;
    this._game = game || null;
    this.threat += (num(threat, 0) - this.threat) * (1 - Math.exp(-2 * dt));
    const settings = game && game.settings;
    this.reduced = !!(settings && settings.reducedEffects);
    let tier = this.reduced ? 0 : game && game.xrActive ? 1 : 2;
    const forced = this._forcedTier >= 0 ? this._forcedTier : settings && typeof settings.fxQuality === 'string' ? num(TIER_NAMES[settings.fxQuality], -1) : -1;
    if (forced >= 0) tier = this.reduced ? Math.min(forced, 0) : forced;
    this.tier = tier;
    if (game && game.bus) this.bindBus(game.bus);
    const level = (game && game.level) || null;
    this._joltT -= dt;

    this.lighting.update(dt, game);
    this.atmosphere.update(dt, game, head, tier, this.threat);
    this.halo.update(dt, this.time, this.atmosphere.density, this.threat, this.lighting.lanternLevel, this.scene.fog ? this.scene.fog.color : this._black, tier);
    this.godRays.update(dt, this.time, game, head, this.atmosphere.density, this.lighting.lanternLevel, this.scene.fog ? this.scene.fog.color : this._black, this.camera);
    const si = level && typeof level.sectionIndexAt === 'function' ? level.sectionIndexAt(head.y) : 0;
    const stir = Math.min(1, this.lighting.creatureNear * (0.6 + Math.min(1, this.lighting.creatureSpeed / 6)) + this.threat * 0.3);
    this.trickles.update(dt, level, head, tier, SECTION_WET[si] || 0, stir);
    this._updateCreatureShed(dt, game);
    this._updateAnchorStress(dt, game);
    this._updateGate(dt, game, level);
    this._updateRains(dt);

    this._updateDust(dt, head);
    this._updateBursts(dt);
    this.creatureDust.update(dt, head, tier, this.reduced);
    this.rubble.update(dt, level, head);
    this._updateFade(game);
    const st = this.stats;
    st.rubble = this.rubble.d.n;
    st.points = this.b.n;
    st.cards = this.atmosphere.activeCards();
    st.streams = this.trickles.activeStreams();
  }

  /** The shaft sheds stone where the creature passes: more the closer and faster it is. */
  _updateCreatureShed(dt, game) {
    const near = this.lighting.creatureNear;
    const c = game && game.creature;
    if (near <= 0 || !c) {
      this._shedAcc = 0;
      return;
    }
    const speed = this.lighting.creatureSpeed;
    const rate = 10 * near * near * (0.25 + Math.min(1, speed / 6)) * (this.reduced ? 0.5 : 1);
    this._shedAcc = Math.min(4, this._shedAcc + rate * dt);
    const r = this._rng;
    const sp = c.body && c.body.spine && c.body.spine.length >= 3 ? c.body.spine : null;
    while (this._shedAcc >= 1) {
      this._shedAcc -= 1;
      let x = c.x;
      let y = c.y;
      let z = c.z;
      if (sp) {
        const k = Math.floor(r() * (sp.length / 3)) * 3;
        x = sp[k];
        y = sp[k + 1];
        z = sp[k + 2];
      }
      x += (r() - 0.5) * 0.8;
      y += (r() - 0.5) * 0.5;
      z += (r() - 0.5) * 0.8;
      const s = r() < 0.1 ? 0.16 + r() * 0.16 : 0.03 + r() * r() * 0.14;
      this._spawnDebris(x, y, z, num(c.vx, 0) * 0.3 + (r() - 0.5) * 1.5, num(c.vy, 0) * 0.3 + r() * 0.8, num(c.vz, 0) * 0.3 + (r() - 0.5) * 1.5, s);
      if (r() < 0.35) this.burst('chips', x, y, z, { count: 2 });
      if (r() < 0.2) this.burst('dust', x, y, z, { count: 1 });
    }
  }

  /** A fragile anchor under load crumbles: grit and flakes from the stone it is bolted into. */
  _updateAnchorStress(dt, game) {
    const t = game && game.tethers;
    if (!t || typeof t.anchorStress !== 'function' || !t.hands) return;
    for (let hi = 0; hi < 2; hi++) {
      const h = HANDS[hi];
      const st = t.hands[h];
      const an = st && st.rope && st.rope.anchor;
      if (!an || an.kind !== 'fragile' || !isFinite(an.x)) continue;
      const stress = num(t.anchorStress(h), 0);
      if (stress <= 0) continue;
      this._stressAcc += dt * (1.5 + stress * 9);
      while (this._stressAcc >= 1) {
        this._stressAcc -= 1;
        const r = this._rng();
        if (r < 0.5) this.burst('chips', an.x, an.y - 0.05, an.z, { count: 1 });
        else if (r < 0.75) this.burst('dust', an.x, an.y - 0.08, an.z, { count: 1 });
        else this._pebbles(an.x, an.y - 0.1, an.z, 1, 0.015, 0.035 + stress * 0.03);
      }
    }
  }

  /** The chamber gate slams shut on victory: the wall above it sheds stone and the shaft shudders. */
  _updateGate(dt, game, level) {
    this._gateFindT -= dt;
    if ((!this._gateObj || !this._gateObj.parent) && this._gateFindT <= 0) {
      this._gateFindT = 2;
      this._gateObj = this.scene.getObjectByName('chamberGate') || null;
      this._gateY = NaN;
    }
    const closed = !!(game && game.gateClosed);
    if (!closed) {
      this._slammed = false;
      this._gateMoving = false;
    }
    const g = this._gateObj;
    if (g) {
      const y = g.position.y;
      if (closed && !this._slammed && this._gateMoving && Math.abs(y - this._gateY) < 1e-5) this._slam(level);
      this._gateMoving = isFinite(this._gateY) && y < this._gateY - 1e-5;
      this._gateY = y;
    } else if (this._slamT >= 0) {
      this._slamT -= dt;
      if (this._slamT < 0 && closed && !this._slammed) this._slam(level);
    }
  }

  /**
   * Public hook: the gate has just hit the floor (LevelView can call this at the moment it
   * spawns its sparks; until then FX watches the 'chamberGate' object itself).
   */
  onGateSlam() {
    if (!this._slammed) this._slam(this._game && this._game.level);
  }

  _slam(level) {
    this._slammed = true;
    this._slamT = -1;
    const gate = level && level.gate;
    if (gate && isFinite(gate.minX)) {
      const r = this._rng;
      const h = this._head;
      // Shed from the face of the wall above the opening, on the player's side.
      const alongX = gate.maxX - gate.minX >= gate.maxZ - gate.minZ;
      const side = alongX ? (h && h.z > (gate.minZ + gate.maxZ) / 2 ? 1 : -1) : h && h.x > (gate.minX + gate.maxX) / 2 ? 1 : -1;
      const n = this.reduced ? 10 : 22;
      for (let i = 0; i < n; i++) {
        const u = r();
        const y = gate.maxY + 0.3 + r() * 3.5;
        const x = alongX ? gate.minX + u * (gate.maxX - gate.minX) : side > 0 ? gate.maxX + 0.25 : gate.minX - 0.25;
        const z = alongX ? (side > 0 ? gate.maxZ + 0.25 : gate.minZ - 0.25) : gate.minZ + u * (gate.maxZ - gate.minZ);
        const out = 0.3 + r() * 1.4;
        this._spawnDebris(x, y, z, alongX ? (r() - 0.5) * 0.8 : side * out, -r() * 1.5, alongX ? side * out : (r() - 0.5) * 0.8, 0.04 + r() * r() * 0.2);
      }
      const cx = (gate.minX + gate.maxX) / 2;
      const cz = (gate.minZ + gate.maxZ) / 2;
      this.burst('puff', cx, gate.maxY + 0.5, cz, { count: 8, spread: 2 });
    }
    this._rain(14);
    this.trickles.agitate(1.4);
  }

  _updateDust(dt, head) {
    const U = this.dustU;
    U.uCenter.value.copy(head);
    U.uTime.value = this.time;
    const th = this.threat;
    // ash drifts down; with threat it is stirred upward as if the shaft breathes in
    const vy = THREE.MathUtils.lerp(-0.22, 0.35, th);
    U.uOffset.value.x += Math.sin(this.time * 0.13) * 0.05 * dt;
    U.uOffset.value.y += vy * dt;
    U.uOffset.value.z += Math.cos(this.time * 0.11) * 0.05 * dt;
    const base = this.tier === 0 ? 0.25 : this.tier === 1 ? 0.4 : 0.5;
    const frac = base + th * (this.tier === 0 ? 0.25 : 0.5) + this.lighting.creatureNear * 0.2;
    this.dust.geometry.setDrawRange(0, Math.floor(DUST_COUNT * Math.min(1, frac)));
  }

  _updateBursts(dt) {
    const b = this.b;
    let n = b.n;
    const pos = this.bPos.array;
    const col = this.bCol.array;
    const size = this.bSize.array;
    const kind = this.bKind.array;
    let i = 0;
    while (i < n) {
      b.life[i] -= dt;
      if (b.life[i] <= 0) {
        n--;
        this._moveBurst(n, i);
        continue;
      }
      const k = b.kind[i];
      if (k === K_PUFF) {
        const drag = Math.exp(-1.6 * dt);
        b.vx[i] *= drag;
        b.vy[i] = b.vy[i] * drag + 0.05 * dt;
        b.vz[i] *= drag;
      } else {
        b.vy[i] -= GRAVITY * (k === K_SPARK ? 0.6 : 1) * dt;
      }
      b.px[i] += b.vx[i] * dt;
      b.py[i] += b.vy[i] * dt;
      b.pz[i] += b.vz[i] * dt;
      const u = b.life[i] / b.max[i];
      // dust swells in then thins out; flecks stay solid until the end; sparks/glints fade
      const a = k === K_PUFF ? 0.42 * Math.sin(Math.PI * Math.min(1, (1 - u) * 1.4 + 0.05)) : k === K_CHIP ? Math.min(1, u * 4) : u;
      pos[i * 3] = b.px[i];
      pos[i * 3 + 1] = b.py[i];
      pos[i * 3 + 2] = b.pz[i];
      col[i * 4] = b.cr[i];
      col[i * 4 + 1] = b.cg[i];
      col[i * 4 + 2] = b.cb[i];
      col[i * 4 + 3] = a;
      kind[i] = k === K_SPARK ? 0 : k === K_DROP ? 2 : 1;
      size[i] = b.size[i] * (k === K_PUFF ? 0.6 + (1 - u) * 0.9 : 1);
      i++;
    }
    b.n = n;
    this.bursts.geometry.setDrawRange(0, n);
    this.bursts.visible = n > 0;
    if (n) {
      this.bPos.needsUpdate = true;
      this.bCol.needsUpdate = true;
      this.bSize.needsUpdate = true;
      this.bKind.needsUpdate = true;
    }
  }

  _moveBurst(from, to) {
    const b = this.b;
    if (from === to) return;
    b.kind[to] = b.kind[from];
    b.px[to] = b.px[from];
    b.py[to] = b.py[from];
    b.pz[to] = b.pz[from];
    b.vx[to] = b.vx[from];
    b.vy[to] = b.vy[from];
    b.vz[to] = b.vz[from];
    b.life[to] = b.life[from];
    b.max[to] = b.max[from];
    b.size[to] = b.size[from];
    b.cr[to] = b.cr[from];
    b.cg[to] = b.cg[from];
    b.cb[to] = b.cb[from];
  }

  _updateFade(game) {
    const fade = THREE.MathUtils.clamp(num(game && game.fade, 0), 0, 1);
    const flash = THREE.MathUtils.clamp(num(game && game.flash, 0), 0, 1);
    const mat = this.fade.material;
    if (fade <= 0.002 && flash <= 0.002) {
      this.fade.visible = false;
      return;
    }
    this.fade.visible = true;
    if (fade >= flash * 0.4) {
      mat.color.copy(this._black);
      mat.opacity = fade;
    } else {
      mat.color.copy(this._flashColor);
      mat.opacity = flash * 0.4;
    }
  }

  dispose() {
    this.unbind();
    for (const o of [this.dust, this.bursts]) {
      this.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
    this.creatureDust.dispose();
    this.rubble.dispose();
    this.trickles.dispose();
    this.atmosphere.dispose();
    this.halo.dispose();
    this.godRays.dispose();
    if (this._noise) this._noise.dispose();
    if (this.fade.parent) this.fade.parent.remove(this.fade);
    this.fade.geometry.dispose();
    this.fade.material.dispose();
    if (this._dot) this._dot.dispose();
  }
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
