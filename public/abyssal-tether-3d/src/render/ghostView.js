/* THE LANTERN (ABYSSAL TETHER 3D) — render/ghostView.js
 * The GHOST LANTERN (meta/ghost.js): a dead climber's light drifting down the shaft on your best run's pace. ONE additive
 * THREE.Sprite (one draw call) with a canvas radial-gradient texture, fogged like the world, a pale cold blue-white, a slow
 * breathing pulse. It fades out within 1.5 m of the head (never blocks the view) and dims away for 2 s after its run ended
 * at the bottom. Zero allocation per frame (the vectors are the view's own).
 */
import * as THREE from 'three';

const SIZE = 0.85; // m across
const LIFT = 0.45; // m above the recorded body centre: about where a held lantern hangs
const NEAR_IN = 0.6; // m from the head: invisible inside this
const NEAR_OUT = 1.5; // m: full strength beyond this
const END_FADE = 2; // s after the ghost's finish time
const OPACITY = 0.8;
const TINT = 0xbfd9ff; // pale cold blue-white

function glowTexture() {
  const n = 64;
  let canvas = null;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
  } else if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(n, n);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(235,245,255,0.9)');
  g.addColorStop(0.35, 'rgba(170,205,255,0.35)');
  g.addColorStop(0.7, 'rgba(120,160,230,0.08)');
  g.addColorStop(1, 'rgba(100,140,220,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class GhostView {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.texture = glowTexture();
    this.material = new THREE.SpriteMaterial({ map: this.texture, color: TINT, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true, opacity: 0 });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.name = 'ghostLantern';
    this.sprite.scale.set(SIZE, SIZE, 1);
    this.sprite.visible = false;
    this.sprite.renderOrder = 5;
    scene.add(this.sprite);
    this._pos = { x: 0, y: 0, z: 0 };
    this._head = new THREE.Vector3();
    this._phase = 0;
    this.alpha = 0; // the last opacity (tests / debug)
  }

  /**
   * @param {number} dt
   * @param {import('../meta/ghost.js').GhostPlayer|null} ghost  null = hidden
   * @param {number} t  the run clock (s)
   * @param {THREE.Camera|null} camera  the head
   * @param {boolean} reduced  Reduced effects: no pulse
   */
  update(dt, ghost, t, camera, reduced) {
    const s = this.sprite;
    if (!ghost) {
      s.visible = false;
      this.alpha = 0;
      return;
    }
    const p = ghost.at(t, this._pos);
    s.position.set(p.x, p.y + LIFT, p.z);
    let k = 1 - smooth(ghost.duration, ghost.duration + END_FADE, t);
    if (camera) {
      camera.getWorldPosition(this._head);
      k *= smooth(NEAR_IN, NEAR_OUT, this._head.distanceTo(s.position));
    }
    this._phase = (this._phase + (dt > 0 ? dt : 0) * 2.1) % (Math.PI * 2);
    const pulse = reduced ? 1 : 0.82 + 0.18 * Math.sin(this._phase);
    const a = OPACITY * k * pulse;
    this.alpha = a;
    this.material.opacity = a;
    s.visible = a > 0.004;
  }

  dispose() {
    this.scene.remove(this.sprite);
    this.material.dispose();
    if (this.texture) this.texture.dispose();
  }
}
