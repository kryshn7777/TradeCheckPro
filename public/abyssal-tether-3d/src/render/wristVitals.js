/* ABYSSAL TETHER 3D — render/wristVitals.js
 * A big, plain HEALTH badge on the back of the LEFT wrist.
 *
 * Reported from VR: "I can't see the actual health when playing in VR. The wrist doesn't show anything, like the health percentage or something."
 * The health was only on the launcher's small ECG screen (a 7 x 3 cm quad on the launcher body, the number 100 in a corner of a 256 x 128 canvas),
 * which is easy to miss and hard to read. This is the readout meant for a glance at the wrist: "HP", the percentage in large numerals, a bar, coloured
 * by state (steady green, amber below 60 %, red and pulsing at or below the low threshold), a flat cross when dead.
 *
 *   new WristVitals(game)         game: { health, handsView (gear.left.wristHud / .root), xrActive, state, settings }
 *   .update(dt)                   once per frame after the hands exist (Game._updateViews); attaches itself to the left arm on first chance
 *   .mesh                         THREE.Mesh (one quad, one draw call, unlit, not fogged), child of the arm's WristHUD mount
 *   .stats                        { shown, pct, redraws }
 *
 * Shown in VR; on the desktop only with `?wristvitals=on` (the desktop HUD already has the heart monitor). The canvas is redrawn only when the shown
 * percentage or the state changes (and at 8 Hz while it pulses), so it costs nothing in a calm moment. Not part of any level or save data.
 */
import * as THREE from 'three';

export const VITALS = {
  w: 0.09, // m
  h: 0.045,
  cw: 256,
  ch: 128,
  mount: { x: 0, y: 0.012, z: 0 }, // above the WristHUD empty of the arm model
  tilt: 0.45, // rad toward the eye
  midAt: 0.6, // hp at which it turns amber
  lowAt: 0.35, // ... and red (CONFIG.health.lowEnter)
  pulseHz: 2.2,
};

export function vitalsState(hp, alive = true) {
  if (!alive || hp <= 0) return 'dead';
  if (hp <= VITALS.lowAt) return 'low';
  if (hp < VITALS.midAt) return 'mid';
  return 'ok';
}

const COLORS = { ok: '#6dffb0', mid: '#ffc24d', low: '#ff4d3d', dead: '#7a7f86' };

/** The percentage shown for an hp 0..1: rounded, but never 0 while alive and never 100 below the full bar. */
export function vitalsPercent(hp) {
  const v = Math.round(Math.min(1, Math.max(0, hp)) * 100);
  if (hp > 0 && v === 0) return 1;
  if (hp < 1 && v === 100) return 99;
  return v;
}

export class WristVitals {
  constructor(game) {
    this.game = game;
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = VITALS.cw;
      this.canvas.height = VITALS.ch;
      this._g = this.canvas.getContext('2d');
    }
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
    if (this.texture) {
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.generateMipmaps = false;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
    }
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, fog: false, transparent: true, side: THREE.DoubleSide });
    this.material.name = 'WristVitals';
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(VITALS.w, VITALS.h), this.material);
    this.mesh.name = 'AT3D-wrist-vitals';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.position.set(VITALS.mount.x, VITALS.mount.y, VITALS.mount.z);
    this.mesh.rotation.set(-Math.PI / 2 + VITALS.tilt, 0, 0); // lies on the back of the wrist, text up toward the fingers, tilted toward the eye
    this._parent = null;
    this._pct = -1;
    this._state = '';
    this._pulseAt = 0;
    this.stats = { shown: false, pct: -1, redraws: 0 };
  }

  /** `?wristvitals=on` shows it on the desktop too (for looking at it; the HUD has the monitor). */
  _wanted() {
    const g = this.game;
    if (g && g.xrActive) return true;
    try {
      return typeof location !== 'undefined' && /[?&]wristvitals=on\b/.test(location.search || '');
    } catch {
      return false;
    }
  }

  _attach() {
    const hv = this.game && this.game.handsView;
    const gear = hv && hv.gear ? hv.gear.left : null;
    if (!gear) return false;
    const parent = gear.wristHud || gear.root;
    if (!parent) return false;
    if (this.mesh.parent !== parent) {
      parent.add(this.mesh);
      if (!gear.wristHud) this.mesh.position.set(-0.03, 0.1, 0.14); // the arm node's frame (measured on player_arms.glb: the left arm's centre line is x = -0.03, its top is y = 0.086, the forearm runs to +z)
      this._parent = parent;
    }
    return true;
  }

  update(dt) {
    const g = this.game;
    const want = this._wanted();
    if (!want || !this._attach()) {
      this.mesh.visible = false;
      this.stats.shown = false;
      return;
    }
    const hp = g.health ? g.health.hp : 1;
    const alive = !(g.player && g.player.alive === false);
    const st = vitalsState(hp, alive);
    const pct = vitalsPercent(alive ? hp : 0);
    this._pulseAt += dt;
    const pulse = st === 'low' && this._pulseAt > 0.125;
    if (pct !== this._pct || st !== this._state || pulse) {
      if (pulse) this._pulseAt = 0;
      this._pct = pct;
      this._state = st;
      this._draw(pct, st);
    }
    this.mesh.visible = g.state === 'playing' || g.state === 'dead';
    this.stats.shown = this.mesh.visible;
    this.stats.pct = pct;
  }

  _draw(pct, st) {
    const ctx = this._g;
    if (!ctx) return;
    const W = VITALS.cw;
    const H = VITALS.ch;
    const col = COLORS[st];
    const beat = st === 'low' ? 0.55 + 0.45 * Math.abs(Math.sin(this._pulseT())) : 1;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(2,10,6,0.88)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 4;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.globalAlpha = beat;
    ctx.fillStyle = col;
    ctx.textBaseline = 'alphabetic';
    // "HP" small at the left, the percentage large
    ctx.font = '700 34px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('HP', 14, 46);
    ctx.font = '800 84px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    if (st === 'dead') ctx.fillText('--', W - 58, 92);
    else ctx.fillText(String(pct), W - 58, 92);
    ctx.font = '700 40px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(st === 'dead' ? '' : '%', W - 54, 92);
    // the bar
    ctx.globalAlpha = 0.45;
    ctx.fillRect(14, H - 24, W - 28, 10);
    ctx.globalAlpha = beat;
    ctx.fillRect(14, H - 24, Math.max(0, (W - 28) * (pct / 100)), 10);
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
    this.stats.redraws++;
  }

  _pulseT() {
    return (this.game && this.game.time ? this.game.time : this.stats.redraws * 0.125) * Math.PI * 2 * VITALS.pulseHz * 0.5;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    if (this.texture) this.texture.dispose();
  }
}
