/* ABYSSAL TETHER 3D — fx.js
 * Lightweight effects, all pooled (no per-frame allocation):
 *  - ambient dust / ash: a fixed cloud of points wrapped around the head in
 *    the vertex shader (zero CPU per particle); density and drift rise with
 *    threat
 *  - bursts: sparks and dust puffs (one Points draw) and debris chunks (one
 *    InstancedMesh draw) on bus events: grapple attach/break, platform
 *    crumble, hard landings, wall hits, death, creature bursts, debris/rumble
 *    triggers (rain from above)
 *  - the death fade: a black sphere around the head (opacity from game.fade),
 *    with a dim warm flash on big impacts (game.flash)
 */

import * as THREE from 'three';

const DUST_COUNT = 900;
const DUST_HALF = 9; // metres: half-size of the wrapped cube around the head
const BURST_MAX = 320;
const DEBRIS_MAX = 140;
const GRAVITY = 13.5;

const K_SPARK = 0;
const K_PUFF = 1;
const K_CHIP = 2; // small bright-ish stone flecks

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();

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
    this._rng = mulberry(0x5eed);
    this._unsub = [];
    this._bus = null;
    this._dot = softDot(32);
    this._buildDust();
    this._buildBursts();
    this._buildDebris();
    this._buildFade();
  }

  // ---------------------------------------------------------------------------
  _buildDust() {
    const n = DUST_COUNT;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const r = this._rng;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (r() * 2 - 1) * DUST_HALF;
      pos[i * 3 + 1] = (r() * 2 - 1) * DUST_HALF;
      pos[i * 3 + 2] = (r() * 2 - 1) * DUST_HALF;
      const ash = r() < 0.75;
      const k = 0.1 + r() * 0.18;
      col[i * 3] = (ash ? 0.85 : 1.0) * k;
      col[i * 3 + 1] = (ash ? 0.84 : 0.82) * k;
      col[i * 3 + 2] = (ash ? 0.8 : 0.62) * k;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.dustU = {
      uCenter: { value: new THREE.Vector3() },
      uOffset: { value: new THREE.Vector3() },
      uHalf: { value: DUST_HALF },
      uTime: { value: 0 },
    };
    const mat = new THREE.PointsMaterial({
      size: 0.022,
      map: this._dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    const U = this.dustU;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uCenter;\nuniform vec3 uOffset;\nuniform float uHalf;\nuniform float uTime;\nvarying float vDustEdge;')
        .replace(
          '#include <begin_vertex>',
          `float atH = fract( sin( dot( position.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  vec3 atP = position + uOffset * ( 0.55 + 0.9 * atH );
  atP.x += sin( uTime * ( 0.3 + atH * 0.4 ) + atH * 6.28 ) * 0.25;
  atP.z += cos( uTime * ( 0.25 + atH * 0.3 ) + atH * 4.0 ) * 0.25;
  vec3 transformed = mod( atP - uCenter + uHalf, 2.0 * uHalf ) - uHalf;
  vDustEdge = 1.0 - smoothstep( 0.6, 1.0, length( transformed ) / uHalf );
  transformed += uCenter;`,
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = size * ( 0.6 + 0.8 * atH );');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDustEdge;')
        .replace(
          '#include <fog_fragment>',
          '#ifdef USE_FOG\n  gl_FragColor.rgb *= 1.0 - atFogFactor( vFogDepth );\n#endif\n  gl_FragColor.rgb *= vDustEdge;',
        );
    };
    mat.customProgramCacheKey = () => 'at3d-dust';
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
    this.bCol = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.bSize = new THREE.BufferAttribute(new Float32Array(n), 1);
    for (const a of [this.bPos, this.bCol, this.bSize]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.bPos);
    g.setAttribute('color', this.bCol);
    g.setAttribute('aSize', this.bSize);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 1,
      map: this._dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    mat.onBeforeCompile = (shader) => {
      // Cap each point at 1/8 of the viewport height (scale = half the target
      // height): a hard landing's puffs right at the feet would otherwise cover
      // most of both eyes several additive layers deep.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSize;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;')
        .replace('#include <logdepthbuf_vertex>', 'gl_PointSize = min( gl_PointSize, scale * 0.25 );\n#include <logdepthbuf_vertex>');
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        '#ifdef USE_FOG\n  gl_FragColor.rgb *= 1.0 - atFogFactor( vFogDepth );\n#endif',
      );
    };
    mat.customProgramCacheKey = () => 'at3d-burst';
    this.bursts = new THREE.Points(g, mat);
    this.bursts.name = 'fxBursts';
    this.bursts.frustumCulled = false;
    this.bursts.renderOrder = 31;
    this.bursts.visible = false; // shown while any point is alive (empty draws still cost a program bind per eye)
    this.scene.add(this.bursts);
  }

  _buildDebris() {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a5249, roughness: 0.95, metalness: 0, flatShading: true });
    this.debris = new THREE.InstancedMesh(geo, mat, DEBRIS_MAX);
    this.debris.name = 'fxDebris';
    this.debris.count = 0;
    this.debris.frustumCulled = false;
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.visible = false; // shown while any chunk is alive
    this.d = {
      n: 0,
      px: new Float32Array(DEBRIS_MAX),
      py: new Float32Array(DEBRIS_MAX),
      pz: new Float32Array(DEBRIS_MAX),
      vx: new Float32Array(DEBRIS_MAX),
      vy: new Float32Array(DEBRIS_MAX),
      vz: new Float32Array(DEBRIS_MAX),
      ax: new Float32Array(DEBRIS_MAX * 3),
      ang: new Float32Array(DEBRIS_MAX),
      spin: new Float32Array(DEBRIS_MAX),
      size: new Float32Array(DEBRIS_MAX),
      life: new Float32Array(DEBRIS_MAX),
    };
    this.scene.add(this.debris);
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
    on('grapple:attach', (e) => {
      const an = e.anchor || {};
      const x = num(e.x, an.x);
      const y = num(e.y, an.y);
      const z = num(e.z, an.z);
      if (!isFinite(x)) return;
      if (an.kind === 'fragile') {
        this.burst('chips', x, y, z, { count: 8 });
        this.burst('puff', x, y, z, { count: 4 });
      } else {
        this.burst('sparks', x, y, z, { count: 10 + Math.min(10, num(e.speed, 0) * 0.6) });
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
        const n = Math.min(36, Math.round(8 + area * 2.5));
        for (let i = 0; i < n; i++) {
          const x = s.minX + this._rng() * (s.maxX - s.minX);
          const y = s.minY + this._rng() * (s.maxY - s.minY);
          const z = s.minZ + this._rng() * (s.maxZ - s.minZ);
          this._spawnDebris(x, y, z, (this._rng() - 0.5) * 1.2, -this._rng() * 1.5, (this._rng() - 0.5) * 1.2, 0.08 + this._rng() * 0.22);
        }
        const cx = (s.minX + s.maxX) / 2;
        const cz = (s.minZ + s.maxZ) / 2;
        this.burst('puff', cx, s.maxY, cz, { count: 18, spread: Math.max(0.5, Math.sqrt(area) * 0.5) });
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
        this.burst('debris', x, num(e.y, 0), num(e.z, 0), { count: 5, size: 0.05, up: true });
      }
    });
    on('player:wallhit', (e) => {
      const x = num(e.x, NaN);
      if (!isFinite(x)) return;
      this.burst('chips', x, num(e.y, 0), num(e.z, 0), { count: Math.min(10, 3 + Math.round(num(e.impact, 0) * 0.4)) });
      this.burst('puff', x, num(e.y, 0), num(e.z, 0), { count: 3 });
    });
    on('player:death', (e) => {
      const x = num(e.x, NaN);
      if (!isFinite(x)) return;
      this.burst('puff', x, num(e.y, 0), num(e.z, 0), { count: 14, spread: 0.6 });
    });
    on('creature:burst', (e) => {
      const d = num(e.distance, 1e9);
      if (d < 45) this._rain(Math.round(THREE.MathUtils.lerp(14, 4, d / 45)));
    });
    on('trigger:debris', (e) => this._rain(THREE.MathUtils.clamp(num(e.data && e.data.count, 16), 1, 50)));
    on('trigger:rumble', (e) => this._rain(THREE.MathUtils.clamp(num(e.data && e.data.count, 9), 1, 40)));
    on('game:restart', () => this.reset());
    on('game:respawn', () => this.reset());
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
    this.d.n = 0;
    this.debris.count = 0;
    this.debris.visible = false;
    this.bursts.geometry.setDrawRange(0, 0);
    this.bursts.visible = false;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  /**
   * kind: 'sparks' | 'puff' | 'chips' | 'debris'
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
        size = 0.035 + r() * 0.03;
        cr = 0.45;
        cg = 0.42;
        cb = 0.38;
      } else {
        k = K_PUFF;
        const sp = 0.3 + r() * 0.9;
        const th = r() * Math.PI * 2;
        vx = Math.cos(th) * sp * (opts.ground ? 2.2 : 1);
        vy = opts.ground ? 0.15 + r() * 0.4 : (r() - 0.3) * sp;
        vz = Math.sin(th) * sp * (opts.ground ? 2.2 : 1);
        life = 0.9 + r() * 1.1;
        size = 0.35 + r() * 0.45;
        const g = 0.07 + r() * 0.05;
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
    const d = this.d;
    let i = d.n;
    if (i >= DEBRIS_MAX) i = Math.floor(this._rng() * DEBRIS_MAX);
    else d.n++;
    d.px[i] = x;
    d.py[i] = y;
    d.pz[i] = z;
    d.vx[i] = vx;
    d.vy[i] = vy;
    d.vz[i] = vz;
    _axis.set(this._rng() - 0.5, this._rng() - 0.5, this._rng() - 0.5).normalize();
    d.ax[i * 3] = _axis.x;
    d.ax[i * 3 + 1] = _axis.y;
    d.ax[i * 3 + 2] = _axis.z;
    d.ang[i] = this._rng() * 6.28;
    d.spin[i] = (this._rng() - 0.5) * 12;
    d.size[i] = size;
    d.life[i] = 2.6 + this._rng() * 1.2;
  }

  /** Stones and grit falling past the player from above. */
  _rain(n) {
    const h = this._head;
    if (!h) return;
    const r = this._rng;
    const count = Math.round(n * (this.reduced ? 0.5 : 1));
    for (let i = 0; i < count; i++) {
      const x = h.x + (r() - 0.5) * 12;
      const z = h.z + (r() - 0.5) * 12;
      const y = h.y + 8 + r() * 14;
      this._spawnDebris(x, y, z, (r() - 0.5) * 0.6, -2 - r() * 4, (r() - 0.5) * 0.6, 0.05 + r() * 0.16);
      if (i % 3 === 0) this._spawnPoint(K_PUFF, x, y, z, 0, -3, 0, 2.2, 0.5, 0.06, 0.058, 0.055);
    }
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {object} game     reads fade, flash, settings.reducedEffects
   * @param {THREE.Vector3} head  world head position
   * @param {number} threat   0..1
   */
  update(dt, game, head, threat) {
    this.time += dt;
    this._head = head;
    this.threat += (num(threat, 0) - this.threat) * (1 - Math.exp(-2 * dt));
    this.reduced = !!(game && game.settings && game.settings.reducedEffects);
    if (game && game.bus) this.bindBus(game.bus);
    this._updateDust(dt, head);
    this._updateBursts(dt);
    this._updateDebris(dt);
    this._updateFade(game);
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
    const frac = (this.reduced ? 0.25 : 0.4) + th * (this.reduced ? 0.25 : 0.6);
    this.dust.geometry.setDrawRange(0, Math.floor(DUST_COUNT * Math.min(1, frac)));
  }

  _updateBursts(dt) {
    const b = this.b;
    let n = b.n;
    const pos = this.bPos.array;
    const col = this.bCol.array;
    const size = this.bSize.array;
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
      const a = k === K_PUFF ? Math.sin(Math.PI * Math.min(1, (1 - u) * 1.4 + 0.05)) : u;
      pos[i * 3] = b.px[i];
      pos[i * 3 + 1] = b.py[i];
      pos[i * 3 + 2] = b.pz[i];
      col[i * 3] = b.cr[i] * a;
      col[i * 3 + 1] = b.cg[i] * a;
      col[i * 3 + 2] = b.cb[i] * a;
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

  _updateDebris(dt) {
    const d = this.d;
    let n = d.n;
    let i = 0;
    while (i < n) {
      d.life[i] -= dt;
      if (d.life[i] <= 0) {
        n--;
        if (i !== n) {
          d.px[i] = d.px[n];
          d.py[i] = d.py[n];
          d.pz[i] = d.pz[n];
          d.vx[i] = d.vx[n];
          d.vy[i] = d.vy[n];
          d.vz[i] = d.vz[n];
          d.ax[i * 3] = d.ax[n * 3];
          d.ax[i * 3 + 1] = d.ax[n * 3 + 1];
          d.ax[i * 3 + 2] = d.ax[n * 3 + 2];
          d.ang[i] = d.ang[n];
          d.spin[i] = d.spin[n];
          d.size[i] = d.size[n];
          d.life[i] = d.life[n];
        }
        continue;
      }
      d.vy[i] -= GRAVITY * dt;
      d.px[i] += d.vx[i] * dt;
      d.py[i] += d.vy[i] * dt;
      d.pz[i] += d.vz[i] * dt;
      d.ang[i] += d.spin[i] * dt;
      _axis.set(d.ax[i * 3], d.ax[i * 3 + 1], d.ax[i * 3 + 2]);
      _q.setFromAxisAngle(_axis, d.ang[i]);
      const k = Math.min(1, d.life[i] / 0.4);
      const s = d.size[i] * k;
      _s.set(s, s * 0.75, s * 0.9);
      _p.set(d.px[i], d.py[i], d.pz[i]);
      this.debris.setMatrixAt(i, _m.compose(_p, _q, _s));
      i++;
    }
    d.n = n;
    this.debris.count = n;
    this.debris.visible = n > 0;
    if (n) this.debris.instanceMatrix.needsUpdate = true;
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
    for (const o of [this.dust, this.bursts, this.debris]) {
      this.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
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
