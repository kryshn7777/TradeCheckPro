/* ABYSSAL TETHER 3D — contactShadows.js
 * Dynamic contact shadows without a shadow-map pass (WP-GFX-PARITY): soft dark blobs ("decals") laid on the surface under the
 * things that move, in ONE instanced quad batch (one draw call, <= 24 quads, no per-frame allocation):
 *   - the player's body (a ray from the collision sphere straight down: wide and faint from far above, tight and dark when close)
 *   - each hand: a ray down and a ray along the barrel (a hand on a wall or a ledge darkens the stone under / in front of it)
 *   - the creature's planted feet (the nearest few)
 *   - the supplies lying around (pickups), dropped / thrown bag items (droppedProps.js), the free end of a missed rope
 * The surface under each caster comes from the level's own ray cast (the solids are axis-aligned boxes, so the surface normal is
 * the face that was hit): the blob lies flat on it, 1.2 cm off, sized by the height of the caster above it (the penumbra grows,
 * the darkness falls off as (1 - h / reach)^1.6), nudged away from the carried lantern (the key light of the descent) and faded
 * with the distance from the eye and with the fog, so nothing floats in the haze. Blobs are alpha-blended black over the already
 * lit (and lightmapped) surface, depth-tested, not written to depth: they never touch the opaque passes.
 *
 * Quality: tier `low` (renderer.lighting.tier) keeps only the body + hands (<= 5 quads); reducedEffects / governor level >= 3 the same.
 * The batch is hidden (0 draw calls) outside a run and when nothing is within reach of a surface.
 */

import * as THREE from 'three';

export const CONTACT_MAX = 24;
const OFFSET = 0.012; // m off the surface along its normal (plus a polygon offset)
const HANDS = ['left', 'right'];

const VERT = /* glsl */ `
attribute vec4 aPos;
attribute vec4 aNrm;
uniform float uFar;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv;
  vec3 n = normalize( aNrm.xyz );
  vec3 t = normalize( cross( n, abs( n.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
  vec3 b = cross( n, t );
  vec3 wp = aPos.xyz + n * ${OFFSET.toFixed(3)} + ( t * position.x + b * position.y ) * ( aPos.w * 2.0 );
  float d = length( cameraPosition - aPos.xyz );
  // fades with the haze (a blob in the fog would read as a black coin) and right at the eye (never wraps the lens)
  vA = aNrm.w * ( 1.0 - smoothstep( uFar * 0.3, uFar * 0.8, d ) ) * smoothstep( 0.1, 0.5, d );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vA;
void main() {
  vec2 p = vUv - 0.5;
  float r = length( p ) * 2.0;
  float a = 1.0 - smoothstep( 0.0, 1.0, r );
  a *= a;
  a *= vA;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( 0.0, 0.0, 0.0, a );
}`;

/** Surface normal of the face of axis-aligned box `s` that the point (x, y, z) lies on, facing the ray origin side (dx, dy, dz). */
export function boxFaceNormal(s, x, y, z, dx, dy, dz, out) {
  const e = [Math.abs(x - s.minX), Math.abs(x - s.maxX), Math.abs(y - s.minY), Math.abs(y - s.maxY), Math.abs(z - s.minZ), Math.abs(z - s.maxZ)];
  let best = 0;
  for (let i = 1; i < 6; i++) if (e[i] < e[best]) best = i;
  // the ray travels along (dx, dy, dz): it entered through the face whose outward normal points against it
  out.x = 0;
  out.y = 0;
  out.z = 0;
  const ax = best >> 1;
  const sg = best & 1 ? 1 : -1;
  if (ax === 0) out.x = sg;
  else if (ax === 1) out.y = sg;
  else out.z = sg;
  if (out.x * dx + out.y * dy + out.z * dz > 0) {
    out.x = -out.x;
    out.y = -out.y;
    out.z = -out.z;
  }
  return out;
}

export class ContactShadows {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.n = 0;
    this.stats = { quads: 0, rays: 0 };
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this._pos = new THREE.InstancedBufferAttribute(new Float32Array(CONTACT_MAX * 4), 4);
    this._nrm = new THREE.InstancedBufferAttribute(new Float32Array(CONTACT_MAX * 4), 4);
    this._pos.setUsage(THREE.DynamicDrawUsage);
    this._nrm.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this._pos);
    g.setAttribute('aNrm', this._nrm);
    g.instanceCount = 0;
    this._uniforms = { uFar: { value: 60 } };
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this._uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    m.name = 'contactShadows';
    m.userData.noLook = true;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'ContactShadows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    // scratch
    this._hit = { t: 0, solid: null, x: 0, y: 0, z: 0 };
    this._n = { x: 0, y: 1, z: 0 };
    this._lan = new THREE.Vector3();
    this._lanOk = false;
    this._v = new THREE.Vector3();
    this._pickGround = new Float32Array(48); // ground y under each pickup (NaN = unknown), by item index
    this._pickGround.fill(NaN);
    this._pickVersion = -1;
    this._pickKey = null;
    this._pickScore = new Float32Array(48);
    this._pickIdx = new Int16Array(8);
  }

  /**
   * Casts from (x, y, z) along (dx, dy, dz) up to `reach` metres and, on a hit, writes one blob.
   * radius = r0 + h * grow (h = distance to the surface); darkness = k * (1 - h / reach)^1.6.
   */
  _cast(lv, x, y, z, dx, dy, dz, reach, r0, grow, k, shiftAway) {
    if (this.n >= CONTACT_MAX) return false;
    this.stats.rays++;
    const hit = lv.raycast(x, y, z, dx, dy, dz, reach, this._hit);
    if (!hit) return false;
    const h = hit.t;
    const nrm = boxFaceNormal(hit.solid, hit.x, hit.y, hit.z, dx, dy, dz, this._n);
    const f = 1 - h / reach;
    const a = k * Math.pow(f > 0 ? f : 0, 1.6);
    if (a < 0.01) return false;
    let cx = hit.x;
    let cz = hit.z;
    if (shiftAway && this._lanOk && nrm.y > 0.7) {
      // the lantern is the key light: the blob slides a little away from it (horizontally), more the higher the caster
      const sx = hit.x - this._lan.x;
      const sz = hit.z - this._lan.z;
      const sl = Math.sqrt(sx * sx + sz * sz);
      if (sl > 0.05) {
        const sh = Math.min(0.32, h * 0.14);
        cx += (sx / sl) * sh;
        cz += (sz / sl) * sh;
      }
    }
    this._put(cx, hit.y, cz, r0 + h * grow, nrm.x, nrm.y, nrm.z, a);
    return true;
  }

  _put(x, y, z, r, nx, ny, nz, a) {
    if (this.n >= CONTACT_MAX) return;
    const i = this.n++ * 4;
    const P = this._pos.array;
    const N = this._nrm.array;
    P[i] = x;
    P[i + 1] = y;
    P[i + 2] = z;
    P[i + 3] = r;
    N[i] = nx;
    N[i + 1] = ny;
    N[i + 2] = nz;
    N[i + 3] = a;
  }

  /**
   * @param {number} dt
   * @param {object} game Game3D (level, player, input, creature, pickups, tethers, state, hidePlayer, settings, xrActive)
   * @param {THREE.Vector3} head world position of the eye
   * @param {object} r3d Renderer3D (camera, lantern, ropeView, droppedProps, scene.fog, lighting.tier, governor)
   */
  update(dt, game, head, r3d) {
    this.n = 0;
    this.stats.rays = 0;
    const lv = game && game.level;
    const st = game && game.state;
    const inRun = st === 'playing' || st === 'paused' || st === 'dead';
    if (!lv || typeof lv.raycast !== 'function' || !inRun || game.hidePlayer) {
      this._finish(r3d);
      return;
    }
    const tier = r3d && r3d.lighting ? r3d.lighting.tier : 'quest';
    const lowTier = tier === 'low' || (r3d && r3d.governor && r3d.governor.level >= 3) || !!(game.settings && game.settings.reducedEffects);
    const fog = r3d && r3d.scene ? r3d.scene.fog : null;
    this._uniforms.uFar.value = fog && fog.far ? fog.far : 60;
    const lan = r3d && r3d.lantern;
    this._lanOk = false;
    if (lan) {
      lan.getWorldPosition(this._lan);
      this._lanOk = true;
    }
    const p = game.player;
    // ---- the body: straight down from the collision sphere (centre ~ chest) -------------------------------------------------
    if (p && p.alive !== false) {
      const px = typeof p.rx === 'number' ? p.rx : p.x;
      const py = typeof p.ry === 'number' ? p.ry : p.y;
      const pz = typeof p.rz === 'number' ? p.rz : p.z;
      this._cast(lv, px, py, pz, 0, -1, 0, 7, 0.4, 0.09, 0.75, true);
    }
    // ---- the hands: down, and along the barrel ----------------------------------------------------------------------------
    const inp = game.input;
    if (inp && typeof inp.handSocket === 'function') {
      for (let h = 0; h < 2; h++) {
        const sock = inp.handSocket(HANDS[h]);
        if (!sock || !sock.visible) continue;
        const e = sock.matrixWorld.elements;
        const hx = e[12];
        const hy = e[13];
        const hz = e[14];
        if (!isFinite(hx + hy + hz)) continue;
        this._cast(lv, hx, hy, hz, 0, -1, 0, 0.9, 0.07, 0.1, 0.5, true);
        // a hand pressed to a wall (climbing, bracing): the barrel / palm axis (-Z in the socket) shows the wall it is near
        this._cast(lv, hx, hy, hz, -e[8], -e[9], -e[10], 0.4, 0.06, 0.12, 0.4, false);
      }
    }
    if (!lowTier) {
      // ---- the creature's planted feet -----------------------------------------------------------------------------------
      const cr = game.creature;
      const body = cr && cr.body;
      if (body && body.visible !== false && body.limbs) {
        const limbs = body.limbs;
        let used = 0;
        for (let i = 0; i < limbs.length && used < 6; i++) {
          const f = limbs[i].foot;
          if (!f) continue;
          const dx = f.x - head.x;
          const dy = f.y - head.y;
          const dz = f.z - head.z;
          if (dx * dx + dy * dy + dz * dz > 45 * 45) continue;
          // the foot sits on a surface: look 0.4 m above it for the face below (works on walls too: -y first, else the body's up)
          if (this._cast(lv, f.x, f.y + 0.5, f.z, 0, -1, 0, 1.2, 0.45, 0.12, 0.55, false)) used++;
        }
      }
      // ---- supplies on the floor (ground height cached per item; static) --------------------------------------------------
      this._pickups(game, lv, head);
      // ---- the free end of a missed line ----------------------------------------------------------------------------------
      const rv = r3d && r3d.ropeView;
      const hands = game.tethers && game.tethers.hands;
      if (rv && rv.strands && hands) {
        for (let h = 0; h < 2; h++) {
          const stn = hands[HANDS[h]];
          const strand = rv.strands[HANDS[h]];
          if (!stn || !strand || !strand.mesh.visible || (stn.rope && stn.rope.anchor) || !stn.miss) continue;
          const c = strand.centre;
          const n = c.length - 3;
          this._cast(lv, c[n], c[n + 1], c[n + 2], 0, -1, 0, 2.2, 0.1, 0.07, 0.4, true);
        }
      }
    }
    // ---- dropped / thrown bag items -----------------------------------------------------------------------------------------
    const dp = r3d && r3d.droppedProps;
    if (dp && dp.activeCount > 0) {
      for (let i = 0; i < dp.items.length && this.n < CONTACT_MAX; i++) {
        const it = dp.items[i];
        if (!it.active) continue;
        this._cast(lv, it.x, it.y, it.z, 0, -1, 0, 3, 0.1, 0.06, 0.55 * it.fade, false);
      }
    }
    this._finish(r3d);
  }

  /** The nearest few pickups: the floor under each is found once (and again when the item list changes). */
  _pickups(game, lv, head) {
    const pk = game.pickups;
    if (!pk || !pk.items) return;
    const items = pk.items;
    const count = Math.min(items.length, 48);
    if (pk !== this._pickKey || pk.version !== this._pickVersion) {
      this._pickKey = pk;
      this._pickVersion = pk.version;
      this._pickGround.fill(NaN);
    }
    // nearest 5 within 26 m, not taken
    const idx = this._pickIdx;
    let m = 0;
    for (let i = 0; i < count; i++) {
      const it = items[i];
      if (it.taken) continue;
      const dx = it.x - head.x;
      const dy = it.y - head.y;
      const dz = it.z - head.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 26 * 26) continue;
      this._pickScore[i] = d2;
      if (m < 5) idx[m++] = i;
      else {
        let w = 0;
        for (let k = 1; k < m; k++) if (this._pickScore[idx[k]] > this._pickScore[idx[w]]) w = k;
        if (d2 < this._pickScore[idx[w]]) idx[w] = i;
      }
    }
    for (let k = 0; k < m; k++) {
      const i = idx[k];
      const it = items[i];
      if (Number.isNaN(this._pickGround[i])) {
        const hit = lv.raycast(it.x, it.y, it.z, 0, -1, 0, 1.6, this._hit);
        this.stats.rays++;
        this._pickGround[i] = hit ? hit.y : -1e9;
        if (hit) boxFaceNormal(hit.solid, hit.x, hit.y, hit.z, 0, -1, 0, this._n);
      }
      const gy = this._pickGround[i];
      if (gy < -1e8) continue;
      const h = Math.max(0, it.y - gy);
      const f = 1 - h / 1.6;
      this._put(it.x, gy, it.z, 0.14 + h * 0.08, 0, 1, 0, 0.5 * (f > 0 ? f : 0));
    }
  }

  _finish(r3d) {
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    this.stats.quads = this.n;
    if (this.n > 0) {
      this._pos.needsUpdate = true;
      this._nrm.needsUpdate = true;
    }
    void r3d;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
