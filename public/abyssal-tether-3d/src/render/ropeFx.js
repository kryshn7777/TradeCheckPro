/* ABYSSAL TETHER 3D — ropeFx.js
 * The launcher's particles: ONE pooled Points draw (no allocation per frame, no new dynamic light).
 *  - muzzleBurst: a short flash, a jet of billowing smoke from the nozzle (hot at birth, cooling to grey,
 *    drifting up), a few lazy wisps, and hot sparks that arc and fall
 *  - trail: small smoke puffs shed by the grapple head in flight
 *  - impactBurst: stone dust puff, chips, a spark flash where the hook bites
 * One shared material (premultiplied blending: sparks / flash ADD, smoke and chips blend OVER), built at
 * construction so Renderer3D.precompile() compiles its program with the others (the Points sits in the
 * scene, hidden while empty). Smoke is lit by the lantern around the head (a cheap falloff in the vertex
 * shader) and fades out right in front of the eyes (camera-safe). `reduced` (settings.reducedEffects)
 * halves the bursts and drops the wisps and the trail.
 */

import * as THREE from 'three';

const MAX = 224;
const K_SPARK = 0;
const K_SMOKE = 1;
const K_FLASH = 2;
const K_CHIP = 3;
const TAU = Math.PI * 2;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cloud sprite: radial falloff broken up by value noise (alpha only; rotated per particle in the shader). */
function makeCloudTexture(size = 64) {
  const r = mulberry(0xc10d);
  const G = 8;
  const grid = new Float32Array((G + 1) * (G + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const noise = (x, y, f) => {
    const gx = x * f;
    const gy = y * f;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (a, b) => grid[(((iy + b) % G) * (G + 1) + ((ix + a) % G)) % grid.length];
    return (g(0, 0) * (1 - sx) + g(1, 0) * sx) * (1 - sy) + (g(0, 1) * (1 - sx) + g(1, 1) * sx) * sy;
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const dx = u * 2 - 1;
      const dy = v * 2 - 1;
      const rr = Math.sqrt(dx * dx + dy * dy);
      const base = Math.pow(Math.max(0, 1 - rr), 1.25);
      const n = 0.5 * noise(u, v, 2) + 0.3 * noise(u, v, 4) + 0.2 * noise(u + 0.37, v + 0.11, 8);
      const a = Math.min(1, Math.max(0, base * (0.35 + 1.15 * n)));
      const k = (y * size + x) * 4;
      data[k] = 255;
      data[k + 1] = 255;
      data[k + 2] = 255;
      data[k + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class RopeFx {
  constructor(scene) {
    this.scene = scene;
    this.reduced = false;
    this._rng = mulberry(0x40be);
    this._trailAcc = { left: 0, right: 0 };
    const n = MAX;
    this.n = 0;
    this.kind = new Uint8Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); // size at birth (metres)
    this.s1 = new Float32Array(n); // size at death
    this.cr = new Float32Array(n); // base colour
    this.cg = new Float32Array(n);
    this.cb = new Float32Array(n);
    this.heat = new Float32Array(n); // 0..1 hot glow at birth (decays over ~0.12 s)
    this.alpha = new Float32Array(n); // peak alpha
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n); // m/s^2 down (negative = rises)
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
    this.aSize = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.aKind = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.aRot = new THREE.BufferAttribute(new Float32Array(n), 1);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aKind, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aKind', this.aKind);
    g.setAttribute('aRot', this.aRot);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.setDrawRange(0, 0);

    this.uHead = { value: new THREE.Vector3() };
    this.cloud = makeCloudTexture(64);
    const mat = new THREE.PointsMaterial({
      size: 1,
      map: this.cloud,
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
    const uHead = this.uHead;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uHead = uHead;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSize;\nattribute float aKind;\nattribute float aRot;\nvarying float vKind;\nvarying float vRot;\nuniform vec3 uHead;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  vKind = aKind;
  vRot = aRot;
  if ( aKind > 0.5 && aKind < 1.5 ) {
    // smoke is not a light: the lantern around the head shows it, the dark leaves it a smudge
    vec3 dv = transformed - uHead;
    vColor.rgb *= 0.13 + 1.6 / ( 1.0 + 0.9 * dot( dv, dv ) );
  }`,
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;')
        .replace(
          '#include <logdepthbuf_vertex>',
          `gl_PointSize = min( gl_PointSize, scale * 0.3 );
  vColor.a *= smoothstep( 0.12, 0.55, - mvPosition.z );
  #include <logdepthbuf_vertex>`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vKind;\nvarying float vRot;')
        .replace(
          '#include <map_particle_fragment>',
          `vec2 pc = gl_PointCoord - 0.5;
  float rr = length( pc ) * 2.0;
  float cs = cos( vRot );
  float sn = sin( vRot );
  vec2 rp = vec2( cs * pc.x - sn * pc.y, sn * pc.x + cs * pc.y );
  float shape;
  if ( vKind < 0.5 ) {
    shape = 1.0 - smoothstep( 0.0, 1.0, rr );
    shape *= shape;
  } else if ( vKind < 1.5 ) {
    shape = texture2D( map, rp + 0.5 ).a;
  } else if ( vKind < 2.5 ) {
    float ang = atan( rp.y, rp.x );
    float lobes = 0.4 + 0.6 * pow( abs( cos( ang * 2.0 ) ), 6.0 );
    shape = pow( max( 0.0, 1.0 - rr ), 2.0 ) * lobes + 0.6 * pow( max( 0.0, 1.0 - rr * 1.7 ), 2.0 );
  } else {
    shape = 1.0 - smoothstep( 0.55, 1.0, rr );
  }
  diffuseColor.a *= shape;`,
        )
        .replace(
          '#include <fog_fragment>',
          `float atF = 0.0;
  #ifdef USE_FOG
    atF = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, atF * ( ( vKind > 0.5 && vKind < 1.5 ) || vKind > 2.5 ? 0.8 : 0.0 ) );
  #endif
  if ( ( vKind > 0.5 && vKind < 1.5 ) || vKind > 2.5 ) {
    gl_FragColor.a *= 1.0 - 0.6 * atF;
    gl_FragColor.rgb *= gl_FragColor.a;
  } else {
    gl_FragColor.rgb *= gl_FragColor.a * ( 1.0 - atF );
    gl_FragColor.a = 0.0;
  }`,
        );
    };
    mat.customProgramCacheKey = () => 'at3d-ropefx';
    this.mat = mat;
    this.points = new THREE.Points(g, mat);
    this.points.name = 'ropeFx';
    this.points.frustumCulled = false;
    this.points.renderOrder = 33;
    this.points.visible = false;
    scene.add(this.points);
    // scratch
    this._u = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  dispose() {
    this.points.parent && this.points.parent.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
    this.cloud.dispose();
  }

  // ---------------------------------------------------------------------------
  _spawn(kind, x, y, z, vx, vy, vz, life, s0, s1, cr, cg, cb, alpha, heat, drag, grav, spin) {
    let i = this.n;
    if (i >= MAX) {
      // full: recycle the particle closest to its end
      i = 0;
      let best = Infinity;
      for (let j = 0; j < MAX; j++) {
        const rem = this.life[j] / this.max[j];
        if (rem < best) {
          best = rem;
          i = j;
        }
      }
    } else this.n++;
    this.kind[i] = kind;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.cr[i] = cr;
    this.cg[i] = cg;
    this.cb[i] = cb;
    this.alpha[i] = alpha;
    this.heat[i] = heat;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.rot[i] = this._rng() * TAU;
    this.spin[i] = spin;
  }

  _basis(dx, dy, dz) {
    const u = this._u;
    const v = this._v;
    if (Math.abs(dy) < 0.9) u.set(0, 1, 0);
    else u.set(1, 0, 0);
    // u = normalize(d x up), v = d x u
    const ux = dy * u.z - dz * u.y;
    const uy = dz * u.x - dx * u.z;
    const uz = dx * u.y - dy * u.x;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    u.set(ux / ul, uy / ul, uz / ul);
    v.set(dy * u.z - dz * u.y, dz * u.x - dx * u.z, dx * u.y - dy * u.x);
  }

  /**
   * A shot leaves the nozzle at (px,py,pz) along the unit vector (dx,dy,dz).
   * power 1 = a hooked shot, ~0.6 = a whiff.
   */
  muzzleBurst(px, py, pz, dx, dy, dz, power) {
    if (!isFinite(px + py + pz + dx + dy + dz)) return;
    const r = this._rng;
    const red = this.reduced ? 0.5 : 1;
    const pw = power === undefined ? 1 : power;
    this._basis(dx, dy, dz);
    const u = this._u;
    const v = this._v;
    // lateral random direction in the plane across the barrel
    const lat = (k) => {
      const a = r() * TAU;
      const c = Math.cos(a) * k;
      const s = Math.sin(a) * k;
      return [u.x * c + v.x * s, u.y * c + v.y * s, u.z * c + v.z * s];
    };
    // 1. flash: two crossed lobes + the glow, a few frames
    const fx = px + dx * 0.03;
    const fy = py + dy * 0.03;
    const fz = pz + dz * 0.03;
    this._spawn(K_FLASH, fx, fy, fz, 0, 0, 0, 0.075, 0.28, 0.5, 2.4, 1.6, 0.8, 1, 0, 0, 0, 0);
    this._spawn(K_FLASH, fx, fy, fz, 0, 0, 0, 0.05, 0.16, 0.32, 3, 2.3, 1.4, 1, 0, 0, 0, 0);
    // 2. smoke jet: hot at birth, cools to grey, stalls (drag) and billows upward
    const jet = Math.max(2, Math.round(7 * pw * red));
    for (let i = 0; i < jet; i++) {
      const sp = 3.4 + r() * 5.2;
      const [lx, ly, lz] = lat(0.5 + r() * 1.1);
      const g = 0.5 + r() * 0.14;
      this._spawn(K_SMOKE, px + dx * (0.02 + r() * 0.1), py + dy * (0.02 + r() * 0.1), pz + dz * (0.02 + r() * 0.1), dx * sp + lx, dy * sp + ly + 0.2, dz * sp + lz, 0.9 + r() * 0.7, 0.1, 0.5 + r() * 0.4, g * 1.04, g, g * 0.95, 0.5 * pw, 0.9, 2.6, -0.45, (r() - 0.5) * 1.6);
    }
    // blow-back out of the vents beside the nozzle (across the barrel, never at the eyes)
    const vents = Math.max(1, Math.round(3 * pw * red));
    for (let i = 0; i < vents; i++) {
      const [lx, ly, lz] = lat(1.1 + r() * 0.9);
      const g = 0.52 + r() * 0.1;
      this._spawn(K_SMOKE, px - dx * 0.04, py - dy * 0.04, pz - dz * 0.04, lx - dx * 0.2, ly + 0.25, lz - dz * 0.2, 0.7 + r() * 0.5, 0.07, 0.3 + r() * 0.2, g, g, g * 0.95, 0.38, 0.6, 2.8, -0.5, (r() - 0.5) * 2);
    }
    // 3. lazy wisps hanging at the nozzle
    if (!this.reduced) {
      for (let i = 0; i < 5; i++) {
        const [lx, ly, lz] = lat(0.2 + r() * 0.3);
        const g = 0.55 + r() * 0.1;
        this._spawn(K_SMOKE, px + dx * 0.05 * i, py + dy * 0.05 * i, pz + dz * 0.05 * i, dx * (0.6 + r() * 1.2) + lx, dy * 0.6 + ly + 0.25, dz * (0.6 + r() * 1.2) + lz, 1.5 + r() * 0.9, 0.05, 0.22 + r() * 0.16, g, g, g, 0.24, 0.3, 1.2, -0.3, (r() - 0.5));
      }
    }
    // 4. sparks: hot, fast along the barrel in a narrow cone, arcing under gravity
    const sparks = Math.max(4, Math.round(14 * pw * red));
    for (let i = 0; i < sparks; i++) {
      const sp = 5 + r() * 10;
      const [lx, ly, lz] = lat(sp * (0.05 + r() * 0.2));
      const w = r();
      this._spawn(K_SPARK, px + dx * 0.04, py + dy * 0.04, pz + dz * 0.04, dx * sp + lx, dy * sp + ly + 0.8, dz * sp + lz, 0.3 + r() * 0.45, 0.014 + r() * 0.014, 0.008, 1.7, 0.9 + w * 0.7, 0.35 + w * 0.2, 1, 0, 0.5, 8, 0);
    }
  }

  /** Small smoke puffs shed by the hook in flight (rate-limited per hand). */
  trail(hand, x, y, z, dt) {
    if (this.reduced) return;
    const acc = (this._trailAcc[hand] += dt * 34);
    if (acc < 1) return;
    this._trailAcc[hand] = acc - 1;
    const r = this._rng;
    const g = 0.52 + r() * 0.1;
    this._spawn(K_SMOKE, x + (r() - 0.5) * 0.06, y + (r() - 0.5) * 0.06, z + (r() - 0.5) * 0.06, (r() - 0.5) * 0.5, 0.15 + r() * 0.3, (r() - 0.5) * 0.5, 0.55 + r() * 0.35, 0.05, 0.2 + r() * 0.12, g, g, g * 0.96, 0.26, 0.5, 1.6, -0.2, (r() - 0.5));
    if (r() < 0.5) this._spawn(K_SPARK, x, y, z, (r() - 0.5) * 1.5, r() * 1.2, (r() - 0.5) * 1.5, 0.18 + r() * 0.2, 0.012, 0.006, 1.6, 0.8, 0.3, 1, 0, 0.5, 6, 0);
  }

  /** The hook bites stone at (x,y,z); (nx,ny,nz) is the unit direction away from the surface. */
  impactBurst(x, y, z, nx, ny, nz) {
    if (!isFinite(x + y + z)) return;
    const r = this._rng;
    const red = this.reduced ? 0.5 : 1;
    let ml = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(ml > 1e-4)) {
      nx = 0;
      ny = 1;
      nz = 0;
      ml = 1;
    }
    nx /= ml;
    ny /= ml;
    nz /= ml;
    this._basis(nx, ny, nz);
    const u = this._u;
    const v = this._v;
    // strike flash (readable at distance)
    this._spawn(K_FLASH, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, 0, 0, 0, 0.09, 0.35, 0.6, 2.6, 1.8, 0.9, 1, 0, 0, 0, 0);
    // stone dust: a puff that blooms off the surface
    const dust = Math.max(2, Math.round(6 * red));
    for (let i = 0; i < dust; i++) {
      const a = r() * TAU;
      const k = 0.4 + r() * 1.2;
      const c = Math.cos(a) * k;
      const s = Math.sin(a) * k;
      const sp = 0.5 + r() * 1.3;
      const g = 0.4 + r() * 0.1;
      this._spawn(K_SMOKE, x + nx * 0.06, y + ny * 0.06, z + nz * 0.06, nx * sp + u.x * c + v.x * s, ny * sp + u.y * c + v.y * s + 0.1, nz * sp + u.z * c + v.z * s, 0.9 + r() * 0.7, 0.16, 0.6 + r() * 0.5, g * 1.05, g, g * 0.9, 0.48, 0.3, 2.2, 0.15, (r() - 0.5));
    }
    // sparks off the metal head
    const sparks = Math.max(3, Math.round(9 * red));
    for (let i = 0; i < sparks; i++) {
      const a = r() * TAU;
      const k = 1.5 + r() * 3.5;
      const c = Math.cos(a) * k;
      const s = Math.sin(a) * k;
      const sp = 1.5 + r() * 3.5;
      const w = r();
      this._spawn(K_SPARK, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * sp + u.x * c + v.x * s, ny * sp + u.y * c + v.y * s + 0.5, nz * sp + u.z * c + v.z * s, 0.25 + r() * 0.35, 0.014 + r() * 0.012, 0.008, 1.6, 0.85 + w * 0.6, 0.35, 1, 0, 0.5, 9, 0);
    }
    // chips knocked loose: fall dark and solid
    const chips = Math.max(2, Math.round(5 * red));
    for (let i = 0; i < chips; i++) {
      const a = r() * TAU;
      const k = 0.6 + r() * 1.8;
      const c = Math.cos(a) * k;
      const s = Math.sin(a) * k;
      const sp = 1 + r() * 2.2;
      const sh = 0.2 + r() * 0.12;
      this._spawn(K_CHIP, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * sp + u.x * c + v.x * s, ny * sp + u.y * c + v.y * s + 0.6, nz * sp + u.z * c + v.z * s, 0.55 + r() * 0.5, 0.03 + r() * 0.025, 0.03, sh * 1.05, sh, sh * 0.9, 1, 0, 0.3, 11, 0);
    }
  }

  // ---------------------------------------------------------------------------
  update(dt, head, reduced) {
    this.reduced = !!reduced;
    if (head) this.uHead.value.copy(head);
    let n = this.n;
    if (n === 0) {
      if (this.points.visible) this.points.visible = false;
      return;
    }
    if (dt > 0.1) dt = 0.1;
    const pos = this.aPos.array;
    const col = this.aCol.array;
    const size = this.aSize.array;
    const kind = this.aKind.array;
    const rot = this.aRot.array;
    let i = 0;
    while (i < n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) this._move(n, i);
        continue;
      }
      const k = this.kind[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * dt;
      this.vz[i] *= d;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      const age = 1 - this.life[i] / this.max[i]; // 0 at birth .. 1 at death
      let a;
      let sz;
      let m = 1; // colour gain (heat)
      let cr = this.cr[i];
      let cg = this.cg[i];
      let cb = this.cb[i];
      if (k === K_SMOKE) {
        // fades in over the first ~8 % then thins out; swells fast at first (billow), slower later
        a = this.alpha[i] * Math.min(1, age * 12) * Math.pow(1 - age, 1.4);
        sz = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - Math.pow(1 - age, 2.2));
        const h = this.heat[i] * Math.exp(-age * this.max[i] * 9);
        if (h > 0.01) {
          cr += (1.9 - cr) * h;
          cg += (1.15 - cg) * h;
          cb += (0.55 - cb) * h;
        }
      } else if (k === K_SPARK) {
        a = Math.pow(1 - age, 0.7);
        sz = this.s0[i] * (1 - 0.5 * age);
        m = 1;
      } else if (k === K_FLASH) {
        a = (1 - age) * (1 - age);
        sz = this.s0[i] + (this.s1[i] - this.s0[i]) * age;
      } else {
        a = age > 0.8 ? (1 - age) * 5 : 1;
        sz = this.s0[i];
      }
      const o3 = i * 3;
      const o4 = i * 4;
      pos[o3] = this.px[i];
      pos[o3 + 1] = this.py[i];
      pos[o3 + 2] = this.pz[i];
      col[o4] = cr * m;
      col[o4 + 1] = cg * m;
      col[o4 + 2] = cb * m;
      col[o4 + 3] = a;
      size[i] = sz;
      kind[i] = k;
      rot[i] = this.rot[i];
      i++;
    }
    this.n = n;
    this.points.geometry.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n > 0) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aKind.needsUpdate = true;
      this.aRot.needsUpdate = true;
    }
  }

  _move(from, to) {
    this.kind[to] = this.kind[from];
    this.px[to] = this.px[from];
    this.py[to] = this.py[from];
    this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.vz[to] = this.vz[from];
    this.life[to] = this.life[from];
    this.max[to] = this.max[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.cr[to] = this.cr[from];
    this.cg[to] = this.cg[from];
    this.cb[to] = this.cb[from];
    this.heat[to] = this.heat[from];
    this.alpha[to] = this.alpha[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
    this.rot[to] = this.rot[from];
    this.spin[to] = this.spin[from];
  }
}
