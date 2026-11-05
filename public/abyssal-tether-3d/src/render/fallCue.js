/* ABYSSAL TETHER 3D — render/fallCue.js
 * "Ground ahead": the blocks that will stop a fall are visible from far away while you are falling.
 *
 * Reported from play: "distant hard stopping blocks [must] be visible, some spawn below the player suddenly during free fall and he dies".
 * The level is only drawn out to the fog cull distance (levelView.update: 25-55 m, less in the deep, fog-thick sections) and you fall at up to
 * 38 m/s, so a ledge came out of the haze about a second before it hit you. A long fall is lethal from ~15-17 m/s.
 *
 * While the player falls fast, the solids below them (in the column they are falling through, with a little room for drift) get a marker on
 * their top face, drawn through the haze: a bright border and a faint plate, tinted amber, red when the impact there would be lethal.
 *   - ONE draw call: an InstancedMesh of one unit quad (up to MAX instances), unlit, additive, no fog, depth-tested, so a nearer wall still hides it;
 *   - nothing is drawn unless you are falling (>= minSpeed m/s down), and it fades out as the real block comes close;
 *   - the pick (pickFallBlocks) is a pure function over level.querySolids, re-run every ~0.2 s or 2 m, not every frame;
 *   - `?fallcue=off` / settings.fallCue === false turns it off.
 * Tests: tools/abyssal-tether-3d/tests/render/test-fall-cue.mjs
 */
import * as THREE from 'three';

export const FALL_CUE = {
  minSpeed: 4, // m/s downward at which the cue begins to show
  fullSpeed: 12, // ... and is fully shown
  lookAhead: 4.5, // s of the current fall speed that are looked ahead
  minReach: 40, // m looked ahead at least (a slow fall still sees this far)
  maxReach: 170, // ... and at most
  halfWidth: 7, // m each side of the player that the column covers, plus the drift below
  driftSeconds: 1.6, // s of horizontal speed added to the half width (up to maxDrift)
  maxDrift: 16,
  maxBlocks: 14, // instances (the nearest below, hidden ones dropped)
  minArea: 0.6, // m2 of top face worth a marker (no bars and rungs)
  dangerRatio: 0.85, // impact speed / lethal speed at which the marker turns red
  fadeNear: 4, // m: gone when the block is this close ...
  fadeNearFull: 14, // ... full from here (the drawn block takes over)
  repickDist: 2, // m of head travel and
  repickTime: 0.2, // s between picks
};

const AMBER = [1.0, 0.62, 0.28];
const RED = [1.0, 0.1, 0.06];

const URL_OFF = (() => {
  try {
    const m = /[?&]fallcue=([a-z0-9]+)/i.exec((typeof location !== 'undefined' && location.search) || '');
    return !!(m && /^(off|0|false|no)$/i.test(m[1]));
  } catch {
    return false; // no location
  }
})();

/** `?fallcue=off` (or settings.fallCue === false) turns the cue off. */
export function fallCueDisabled(settings) {
  return URL_OFF || !!(settings && settings.fallCue === false);
}

/** 0..1: how strongly the cue shows at a downward speed (m/s, positive = falling). */
export function fallCueStrength(downSpeed, o = FALL_CUE) {
  if (!(downSpeed > o.minSpeed)) return 0;
  return Math.min(1, (downSpeed - o.minSpeed) / (o.fullSpeed - o.minSpeed));
}

/** 0..1: how much of the marker shows at `dist` metres: it fades out as the real block (drawn and fogged) gets close. */
export function fallCueNear(dist, o = FALL_CUE) {
  if (!(dist > o.fadeNear)) return 0;
  return Math.min(1, (dist - o.fadeNear) / (o.fadeNearFull - o.fadeNear));
}

const _scratch = [];

/**
 * The solids that would stop a fall from (x, y, z) at velocity (vx, vy, vz): the nearest top faces below, the covered ones dropped.
 * @param {object} level   Level3D (querySolids)
 * @param {object} phys    { gravity, maxFall, lethal } for the impact estimate (drag ignored: a slight over-estimate)
 * @param {Array} out      receives { s, top, cx, cz, sx, sz, dist, impact, danger }, nearest first
 * @returns {Array} out
 */
export function pickFallBlocks(level, x, y, z, vx, vy, vz, phys, out, o = FALL_CUE) {
  out.length = 0;
  const down = -vy;
  if (!level || typeof level.querySolids !== 'function' || !(down >= o.minSpeed)) return out;
  const reach = Math.max(o.minReach, Math.min(o.maxReach, down * o.lookAhead + 24));
  const hs = Math.hypot(vx, vz);
  const hw = o.halfWidth + Math.min(o.maxDrift, hs * o.driftSeconds);
  const list = level.querySolids(x - hw, y - reach, z - hw, x + hw, y - 1.5, z + hw, _scratch);
  const g = phys && phys.gravity > 0 ? phys.gravity : 13.5;
  const vmax = phys && phys.maxFall > 0 ? phys.maxFall : 38;
  const lethal = phys && phys.lethal > 0 ? phys.lethal : 17;
  const cand = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || s.active === false || s.decor) continue;
    const top = s.maxY;
    if (!(top < y - 1.5) || top < y - reach) continue;
    const sx = s.maxX - s.minX;
    const sz = s.maxZ - s.minZ;
    if (sx * sz < o.minArea || sx < 0.25 || sz < 0.25) continue;
    cand.push(s);
  }
  cand.sort((a, b) => b.maxY - a.maxY);
  for (let i = 0; i < cand.length && out.length < o.maxBlocks; i++) {
    const s = cand[i];
    // a block whose whole top lies under the top of a higher one picked already is never reached first: no marker
    let hidden = false;
    for (let k = 0; k < out.length; k++) {
      const t = out[k].s;
      if (s.minX >= t.minX - 0.05 && s.maxX <= t.maxX + 0.05 && s.minZ >= t.minZ - 0.05 && s.maxZ <= t.maxZ + 0.05) {
        hidden = true;
        break;
      }
    }
    if (hidden) continue;
    const d = y - s.maxY;
    const impact = Math.min(vmax, Math.sqrt(vy * vy + 2 * g * d));
    out.push({
      s,
      top: s.maxY,
      cx: (s.minX + s.maxX) / 2,
      cz: (s.minZ + s.maxZ) / 2,
      sx: s.maxX - s.minX,
      sz: s.maxZ - s.minZ,
      dist: d,
      impact,
      danger: impact >= lethal * o.dangerRatio,
    });
  }
  return out;
}

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vSize;
varying vec3 vCol;
varying float vDist;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vDist = length(wp.xyz - cameraPosition);
  // lifted a little with distance so the marker never z-fights the (fogged) top face it sits on
  wp.y += 0.04 + 0.002 * vDist;
  vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  vUv = position.xz + 0.5;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
varying vec2 vSize;
varying vec3 vCol;
varying float vDist;
void main() {
  vec2 p = vUv * vSize;
  vec2 q = min(p, vSize - p);
  float e = min(q.x, q.y);
  // a border that keeps the same angular width from any distance (about 0.7 degrees), at most a third of the block
  float w = min(0.16 + 0.012 * vDist, 0.34 * min(vSize.x, vSize.y));
  float line = 1.0 - smoothstep(w * 0.55, w, e);
  float fill = 0.16 + 0.1 * (1.0 - smoothstep(0.0, 1.0, e / max(0.01, 0.5 * min(vSize.x, vSize.y))));
  float far = 1.0 - 0.4 * smoothstep(50.0, 170.0, vDist);
  float pulse = 0.88 + 0.12 * sin(uTime * 7.0 + vUv.x * 3.0);
  float a = (line * 0.95 + fill) * uAlpha * far * pulse;
  gl_FragColor = vec4(vCol * (line * 1.3 + 0.55) * a, a);
}`;

export class FallCue {
  /** @param {THREE.Object3D} parent  the scene (the marker is not part of the level's cached root) */
  constructor(parent) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2); // facing up, in x / z
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, FALL_CUE.maxBlocks);
    this.mesh.name = 'FallCue';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 55;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    parent.add(this.mesh);
    this.parent = parent;
    this.picked = [];
    this._at = new THREE.Vector3(1e9, 1e9, 1e9);
    this._since = 99;
    this._shown = 0;
    this._phys = { gravity: 13.5, maxFall: 38, lethal: 17 };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.stats = { picks: 0, shown: 0 };
  }

  /**
   * @param {number} dt
   * @param {object|null} level  Level3D
   * @param {object|null} player { x, y, z, vx, vy, vz, alive }
   * @param {THREE.Vector3} head  world head position
   * @param {object} [diff]  difficulty preset (lethalImpact)
   * @param {boolean} [on]   false: the setting is off
   */
  update(dt, level, player, head, diff, on = true) {
    const down = player && player.alive !== false && on ? -(player.vy || 0) : 0;
    const want = level ? fallCueStrength(down) : 0;
    // ease in fast, out a bit slower (a rope catch should not blink it)
    this._shown += (want - this._shown) * Math.min(1, dt * (want > this._shown ? 14 : 6));
    this.material.uniforms.uTime.value += dt;
    if (this._shown < 0.01 && want === 0) {
      this.mesh.visible = false;
      this.mesh.count = 0;
      this.picked.length = 0;
      this._at.set(1e9, 1e9, 1e9);
      return;
    }
    this._since += dt;
    if (want > 0 && (this._since > FALL_CUE.repickTime || this._at.distanceToSquared(head) > FALL_CUE.repickDist * FALL_CUE.repickDist)) {
      this._since = 0;
      this._at.copy(head);
      const ph = this._phys;
      ph.gravity = (player && player.gravity) || 13.5;
      ph.lethal = diff && diff.lethalImpact > 0 ? diff.lethalImpact : 17;
      pickFallBlocks(level, head.x, head.y, head.z, player.vx || 0, player.vy || 0, player.vz || 0, ph, this.picked);
      this.stats.picks++;
      this._write();
    }
    this.mesh.visible = this.mesh.count > 0 && this._shown > 0.01;
    this.material.uniforms.uAlpha.value = this._shown;
    this.stats.shown = this.mesh.visible ? this.mesh.count : 0;
    // the near fade follows the head every frame (the head moves 0.6 m per frame at fall speed)
    if (this.mesh.visible) this._fadeNear(head);
  }

  _write() {
    const list = this.picked;
    const mesh = this.mesh;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      this._p.set(b.cx, b.top, b.cz);
      this._s.set(b.sx, 1, b.sz);
      this._m.compose(this._p, this._q.identity(), this._s);
      mesh.setMatrixAt(n, this._m);
      const col = b.danger ? RED : AMBER;
      mesh.setColorAt(n, this._c.setRGB(col[0], col[1], col[2]));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** The colour of a marker is dimmed as its block gets within fadeNearFull: the drawn block is there. */
  _fadeNear(head) {
    const list = this.picked;
    const mesh = this.mesh;
    if (!mesh.instanceColor) return;
    for (let i = 0; i < list.length && i < mesh.count; i++) {
      const b = list[i];
      const k = fallCueNear(head.y - b.top);
      const col = b.danger ? RED : AMBER;
      mesh.setColorAt(i, this._c.setRGB(col[0] * k, col[1] * k, col[2] * k));
    }
    mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
