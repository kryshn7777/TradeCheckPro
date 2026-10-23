/* ABYSSAL TETHER 3D — creatureDust.js
 * Ground dust / smoke under the moving creatures (the Mason and the skitterlings): puffs where a planted foot lands, a low drifting
 * trail under the body while it moves, a ring of dust on a strike / slam, and a thin lingering mist over the wet sections.
 *
 *   - ONE pooled draw call (THREE.Points, soft procedural puffs: rotated, lobed, no texture), at most 300 live particles, tier-scaled
 *     (low / reduced fewer), no allocation after construction (typed pools, swap-remove);
 *   - lit like the FX bursts (the shared FxLighting uniforms: lantern, env lights, ambient), fog-tinted with the level's fog curve
 *     and dithered like every other VR layer (vrShade.js); premultiplied OVER blending, never additive: a puff in the dark is a
 *     dark smudge, in the lantern's reach a pale warm cloud;
 *   - soft against the ground without a depth texture: every puff remembers the surface plane it was born on and fades out as its
 *     centre nears it (and the near-eye fade stops one from ever filling the headset);
 *   - emitters: MasonRigView / skitter views call foot() / trail() / slam() with numbers (no objects).
 * Owned by FX (fx.creatureDust); update(dt, head, tier, reduced) once per frame.
 */
import * as THREE from 'three';
import { FX_LIGHT_GLSL } from './atmosphere.js';
import { DITHER_GLSL } from './vrShade.js';

const MAX = 520;
const CAPS = [160, 330, 520]; // live particles per fx tier (0 low / reduced, 1 quest, 2 desktop)
const SECTION_WET = [0, 0.1, 0.25, 0.45, 0.85, 0.6, 0.75, 1]; // mirrors fx.js

/** Wetness 0..1 of a level section (the mist). */
export function sectionWet(i) {
  return i >= 0 && i < SECTION_WET.length ? SECTION_WET[i] : 0;
}

const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'nx', 'ny', 'nz', 'd0', 'life', 'max', 'size', 'grow', 'alpha', 'cr', 'cg', 'cb', 'drift'];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class CreatureDust {
  /**
   * @param {THREE.Scene} scene
   * @param {object} lightUniforms  FxLighting.uniforms (shared)
   * @param {() => number} rng
   */
  constructor(scene, lightUniforms, rng) {
    this.rng = rng || Math.random;
    this.n = 0;
    this.cap = CAPS[2];
    this.rate = 1; // spawn scale (tier / reduced)
    this._head = null;
    const P = (k = 1) => new Float32Array(MAX * k);
    this.px = P();
    this.py = P();
    this.pz = P();
    this.vx = P();
    this.vy = P();
    this.vz = P();
    this.nx = P(); // the surface normal it was born on
    this.ny = P();
    this.nz = P();
    this.d0 = P(); // the surface plane offset (dot(p, n))
    this.life = P();
    this.max = P();
    this.size = P();
    this.grow = P();
    this.alpha = P();
    this.cr = P();
    this.cg = P();
    this.cb = P();
    this.drift = P(); // how much it follows the wake (0 mist .. 1 dust)
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(MAX * 4), 4);
    this.aSize = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    for (const a of [this.aPos, this.aCol, this.aSize]) a.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX; i++) this.aSeed.array[i] = ((i * 0.6180339887) % 1) * 1.0;
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aSeed', this.aSeed);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 1,
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
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, lightUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aSize;\nattribute float aSeed;\nvarying float vSeed;\n${FX_LIGHT_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  vSeed = aSeed;
  vColor.rgb *= min( uAmbient + atLightAt( transformed, normalize( transformed - cameraPosition ), 0.2 ) * 0.22, vec3( 1.2 ) );`,
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;')
        .replace(
          '#include <logdepthbuf_vertex>',
          `gl_PointSize = min( gl_PointSize, scale * 0.3 );
  vColor.a *= smoothstep( 0.5, 2.6, length( mvPosition.xyz ) );
#include <logdepthbuf_vertex>`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vSeed;\n${DITHER_GLSL}`)
        .replace(
          '#include <map_particle_fragment>',
          `{
  vec2 pc = gl_PointCoord - 0.5;
  float cs = cos( vSeed * 6.2831 );
  float sn = sin( vSeed * 6.2831 );
  pc = vec2( cs * pc.x - sn * pc.y, sn * pc.x + cs * pc.y );
  pc.x *= 0.82 + 0.3 * vSeed;
  float r = length( pc ) * 2.0;
  float lobe = 0.8 + 0.2 * sin( atan( pc.y, pc.x ) * 3.0 + vSeed * 19.0 );
  float sh = 1.0 - smoothstep( 0.08, lobe, r );
  diffuseColor.a *= sh * sh;
}`,
        )
        .replace(
          '#include <fog_fragment>',
          `#ifdef USE_FOG
  float atF = atFogFactor( vFogDepth );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, atF );
  gl_FragColor.a *= 1.0 - 0.6 * atF;
#endif
  gl_FragColor.rgb *= gl_FragColor.a;
  gl_FragColor.rgb += atDither3( gl_FragCoord.xy ) * ( 0.9 / 255.0 ) * step( 0.004, gl_FragColor.a );`,
        );
    };
    mat.customProgramCacheKey = () => 'at3d-creature-dust-1';
    this.points = new THREE.Points(g, mat);
    this.points.name = 'creatureDust';
    this.points.frustumCulled = false;
    this.points.renderOrder = 29;
    this.points.visible = false;
    scene.add(this.points);
    this.stats = { live: 0, spawned: 0 };
  }

  setBudget(tier, reduced) {
    const t = clamp(tier | 0, 0, 2);
    this.cap = Math.round(CAPS[t] * (reduced ? 0.5 : 1));
    this.rate = [0.55, 0.8, 1][t] * (reduced ? 0.5 : 1);
  }

  reset() {
    this.n = 0;
    this.points.visible = false;
  }

  _count(n) {
    const f = n * this.rate;
    const c = Math.floor(f);
    return c + (this.rng() < f - c ? 1 : 0);
  }

  _near(x, y, z, lim) {
    const h = this._head;
    if (!h) return true;
    const dx = x - h.x;
    const dy = y - h.y;
    const dz = z - h.z;
    return dx * dx + dy * dy + dz * dz < lim * lim;
  }

  /**
   * Spawns one particle on the surface plane through (x, y, z) with normal n.
   * vel: the sideways (in-plane) speed; lift: along n; wet: 0..1 (pale cold mist, longer, slower).
   */
  _spawn(x, y, z, nx, ny, nz, vx, vy, vz, size, alpha, life, wet, drift, grow) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const r = this.rng;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.nx[i] = nx;
    this.ny[i] = ny;
    this.nz[i] = nz;
    this.d0[i] = x * nx + y * ny + z * nz;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.alpha[i] = alpha;
    // dirt: a warm brown (a lit puff reads as brown smoke, an unlit one as a dark brown smudge); wet sections pale it a little
    const g = 0.5 + r() * 0.14;
    this.cr[i] = g * (1.0 - 0.15 * wet);
    this.cg[i] = g * (0.68 + 0.1 * wet);
    this.cb[i] = g * (0.42 + 0.22 * wet);
    this.drift[i] = drift;
    this.stats.spawned++;
  }

  /** Surface-plane basis: two unit tangents of n. */
  _basis(nx, ny, nz, out) {
    const ax = Math.abs(ny) < 0.9 ? 0 : 1;
    const ay = Math.abs(ny) < 0.9 ? 1 : 0;
    const az = 0;
    let tx = ay * nz - az * ny;
    let ty = az * nx - ax * nz;
    let tz = ax * ny - ay * nx;
    const l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= l;
    ty /= l;
    tz /= l;
    out[0] = tx;
    out[1] = ty;
    out[2] = tz;
    out[3] = ny * tz - nz * ty;
    out[4] = nz * tx - nx * tz;
    out[5] = nx * ty - ny * tx;
  }

  /**
   * A foot lands: a small ring of puffs thrown outward along the surface. size = the creature's leg scale in metres (Mason ~ 1,
   * skitterling ~ 0.45), strength 0..1.
   */
  foot(x, y, z, nx, ny, nz, size, strength, wet, wvx, wvy, wvz) {
    if (!this._near(x, y, z, 55 * Math.max(0.5, size))) return;
    const n = this._count((0.4 + strength * 1.4) * (size < 0.6 ? 0.6 : 1));
    if (n <= 0) return;
    const B = this._b || (this._b = new Float32Array(6));
    this._basis(nx, ny, nz, B);
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const th = r() * 6.2832;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const sp = (0.5 + r() * 1.2) * (0.5 + strength) * size;
      const lift = (0.1 + r() * 0.4) * size;
      const sz = size * (0.35 + r() * 0.4) * (0.7 + 0.5 * strength);
      const cx = B[0] * c + B[3] * s;
      const cy = B[1] * c + B[4] * s;
      const cz = B[2] * c + B[5] * s;
      this._spawn(
        x + cx * 0.2 * size + nx * sz * 0.5,
        y + cy * 0.2 * size + ny * sz * 0.5,
        z + cz * 0.2 * size + nz * sz * 0.5,
        nx,
        ny,
        nz,
        cx * sp + wvx * 0.25,
        cy * sp + wvy * 0.25,
        cz * sp + wvz * 0.25,
        sz,
        (0.13 + 0.12 * strength) * (1 - 0.3 * wet),
        (0.8 + r() * 0.6) * (1 + 0.6 * wet),
        wet,
        0.6,
        1.1 + 0.8 * wet,
      );
      this.px[this.n - 1] += nx * lift * 0.2;
      this.py[this.n - 1] += ny * lift * 0.2;
      this.pz[this.n - 1] += nz * lift * 0.2;
    }
  }

  /** A low drifting wisp under the body while it moves (call a few times a second per creature). */
  trail(x, y, z, nx, ny, nz, size, strength, wet, wvx, wvy, wvz) {
    if (!this._near(x, y, z, 40 * Math.max(0.5, size))) return;
    if (this._count(1) <= 0) return;
    const r = this.rng;
    const sz = size * (0.8 + r() * 0.8) * (0.6 + 0.6 * strength);
    this._spawn(
      x + (r() - 0.5) * size * 1.2 + nx * sz * 0.5,
      y + (r() - 0.5) * size * 1.2 + ny * sz * 0.5,
      z + (r() - 0.5) * size * 1.2 + nz * sz * 0.5,
      nx,
      ny,
      nz,
      wvx * 0.3 + (r() - 0.5) * 0.4 * size,
      wvy * 0.3 + (r() - 0.5) * 0.4 * size,
      wvz * 0.3 + (r() - 0.5) * 0.4 * size,
      sz,
      (0.07 + 0.08 * strength) * (1 - 0.25 * wet),
      (1.2 + r() * 1.0) * (1 + 0.7 * wet),
      wet,
      0.9,
      0.9 + 0.7 * wet,
    );
  }

  /**
   * Brown dirt smoke kicked up by a leg while the creature moves: a fat puff at the foot that rises off the surface and trails back
   * with the wake (call a few times a second per creature, one leg at a time). size = the creature's leg scale (Mason ~ 1).
   */
  smoke(x, y, z, nx, ny, nz, size, strength, wet, wvx, wvy, wvz) {
    if (!this._near(x, y, z, 50 * Math.max(0.5, size))) return;
    const n = this._count(1.6);
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const sz = size * (0.9 + r() * 0.9) * (0.75 + 0.5 * strength);
      const up = (0.35 + r() * 0.55) * size;
      this._spawn(
        x + (r() - 0.5) * size * 0.5 + nx * sz * 0.5,
        y + (r() - 0.5) * size * 0.5 + ny * sz * 0.5,
        z + (r() - 0.5) * size * 0.5 + nz * sz * 0.5,
        nx,
        ny,
        nz,
        wvx * 0.3 + (r() - 0.5) * 0.7 * size + nx * up,
        wvy * 0.3 + (r() - 0.5) * 0.7 * size + ny * up,
        wvz * 0.3 + (r() - 0.5) * 0.7 * size + nz * up,
        sz,
        (0.16 + 0.12 * strength) * (1 - 0.25 * wet),
        1.5 + r() * 1.1,
        wet,
        0.85,
        1.5,
      );
    }
  }

  /** A strike / slam: a ring of dust driven out along the surface from the impact point. */
  slam(x, y, z, nx, ny, nz, size, strength, wet) {
    if (!this._near(x, y, z, 70 * Math.max(0.5, size))) return;
    const n = this._count(7 + strength * 9);
    const B = this._b || (this._b = new Float32Array(6));
    this._basis(nx, ny, nz, B);
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const th = ((k + r() * 0.8) / Math.max(1, n)) * 6.2832;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const sp = (1.6 + r() * 2.2) * size * (0.6 + strength);
      const sz = size * (1.0 + r() * 1.0);
      const cx = B[0] * c + B[3] * s;
      const cy = B[1] * c + B[4] * s;
      const cz = B[2] * c + B[5] * s;
      this._spawn(x + nx * sz * 0.45, y + ny * sz * 0.45, z + nz * sz * 0.45, nx, ny, nz, cx * sp, cy * sp, cz * sp, sz, (0.16 + 0.12 * strength) * (1 - 0.25 * wet), (1.1 + r() * 0.9) * (1 + 0.6 * wet), wet, 0.2, 1.4 + wet);
    }
  }

  update(dt, head, tier, reduced) {
    this._head = head || null;
    this.setBudget(tier, reduced);
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    let n = this.n;
    const pos = this.aPos.array;
    const col = this.aCol.array;
    const sz = this.aSize.array;
    let i = 0;
    const drag = Math.exp(-1.9 * dt);
    while (i < n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0 || i >= this.cap) {
        n--;
        this._move(n, i);
        continue;
      }
      this.vx[i] *= drag;
      this.vy[i] *= drag;
      this.vz[i] *= drag;
      // a faint rise along the surface normal (thermal / the creature's wake), never into the surface
      const rise = 0.06 * dt;
      this.vx[i] += this.nx[i] * rise;
      this.vy[i] += this.ny[i] * rise;
      this.vz[i] += this.nz[i] * rise;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const u = this.life[i] / this.max[i]; // 1 -> 0
      const age = 1 - u;
      const s = this.size[i] * (0.55 + this.grow[i] * age * 0.6 + 0.3 * Math.sqrt(age));
      // height of the centre above the birth surface: fades the lower edge of the sprite out before it can cut into the wall
      const h = this.px[i] * this.nx[i] + this.py[i] * this.ny[i] + this.pz[i] * this.nz[i] - this.d0[i];
      const ground = clamp(h / (0.5 * s), 0, 1);
      const a = this.alpha[i] * Math.min(1, age * 7) * (u < 0.5 ? u * 2 : 1) * ground;
      pos[i * 3] = this.px[i];
      pos[i * 3 + 1] = this.py[i];
      pos[i * 3 + 2] = this.pz[i];
      col[i * 4] = this.cr[i];
      col[i * 4 + 1] = this.cg[i];
      col[i * 4 + 2] = this.cb[i];
      col[i * 4 + 3] = a;
      sz[i] = s;
      i++;
    }
    this.n = n;
    this.stats.live = n;
    this.points.geometry.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aSize.needsUpdate = true;
    }
  }

  _move(from, to) {
    if (from === to) return;
    for (let k = 0; k < FIELDS.length; k++) {
      const a = this[FIELDS[k]];
      a[to] = a[from];
    }
  }

  dispose() {
    if (this.points.parent) this.points.parent.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
