/* THE LANTERN (ABYSSAL TETHER 3D) — hitFeedbackGlue.js
 * HIT FEEDBACK (docs/abyssal-tether-3d/plans/HIT_FEEDBACK.md): everything the player sees, hears and feels when the Mason (30 %) or a
 * skitterling (10 %) lands a hit, in one module. The owner: "every hit the player camera goes like red and a high pitched sound and
 * then he falls down for a moment and slowly gets up."
 *
 *   const hf = new HitFeedbackGlue(game)   once (game.js _setupHitFeedback, with the bus): `game.hitFeedback`
 *   hf.update(dt)                          once a frame (game.js _updateViews, before healthFx reads it), any state
 *   hf.applyCam()                          once a frame at the end of game.js _updateRig (after the rig is placed, the death cam ran)
 *   hf.debugHit(source, down)              AT3D.debug.hit: a synthetic `player:hit` (+ the stand-in knock while game.knock is missing)
 *
 * In: the bus `player:hit` { source, amount, hp, x, y, z, dx, dz, down } and the SIM's `game.knock` { phase, t, dur, k } (absent or
 * 'none' = standing). The clocks run on the RUN clock (game.time: stops when paused / frozen, steps with AT3D.debug.step) so a frozen
 * capture is deterministic; the haptic double pulse on the frame clock.
 * Out: the red punch + the held red-black vignette + the slow dizzy sway (render/healthFx.js inputs hitFlash / hitVig / hitDizzy: the
 * existing vignette mesh, no new draw call) and the '-30%' tick on the ECG screen; the camera (desktop: the eye drops to 0.3 m and rolls
 * <= 10 degrees away from the attacker, the virtual hands sink; VR: never rotated, <= 0.12 m down, none in comfort; the body crouches
 * through `pose`, read by render/bodyView.js); the ring / thump / gasp (audio/hitFeedbackSfx.js, bus 'hit:ring') and the world muffle;
 * a hard double pulse in both hands (a bite: one buzz); captions ride on the bus events (ui/captions.js).
 * Settings: hitFeedback 'full' | 'gentle' (half the punch, no drop / roll, a shorter ring); Reduced effects halves the punch, stops the
 * sway and the VR offset. Everything returns exactly to neutral on player:up / death / respawn / restart / menu.
 * No allocation per frame (the payloads and scratch objects are reused); no Math.random.
 */
import { HIT, Punch, punchPeak, knockK, rollSide, hitCam, stumble, heldVig, knockMuffle, timerMuffle, LocalKnock } from './render/hitFeedback.js';
import { registerHitFeedbackSfx, holdHitMuffle } from './audio/hitFeedbackSfx.js';

/** The ring's intensity (audio/hitFeedbackSfx.js RING_RECIPE k): a Mason hit, 'gentle', a skitterling bite. */
export const RING_K = Object.freeze({ mason: 1, gentle: 0.55, skitter: 0.3 });
/** The haptics: the Mason's hard double pulse (strength, ms, gap ms, ms) and a bite's one buzz. */
export const HAPTIC = Object.freeze({ mason: Object.freeze([1, 60, 50, 90]), skitter: Object.freeze([0.55, 45]) });
/** Desktop virtual hands, flat on the ground: down and in toward the body (m, camera space). */
const HAND_SINK = Object.freeze({ y: 0.07, z: 0.04 });
const HANDS = ['left', 'right'];

export class HitFeedbackGlue {
  constructor(game) {
    this.game = game;
    const bus = game && game.bus;
    this.bus = bus || null;
    this.punch = new Punch();
    this.local = new LocalKnock(bus); // STAND-IN for sim/knockdown.js: used only while game.knock is missing or idle
    this.cam = { drop: 0, roll: 0 };
    this._cam = { xr: false, gentle: false, calm: false, comfort: false };
    this.pose = 0; // 0..1 the body's knock pose (render/bodyView.js lowers the neck target in a headset)
    this.flash = 0; // the punch as drawn (healthFx.hitFlash)
    this.vig = 0; // the held vignette (healthFx.hitVig)
    this.dizzy = 0; // the rim's slow sway (healthFx.hitDizzy, NDC)
    this.muffle = 0; // 0..1 world muffle held this frame
    this.side = 1; // the roll side of the current knock (-1..1)
    this.source = '';
    this.mode = 'full';
    this._time = 0; // the run clock this module has seen (s)
    this._lastT = 0;
    this._muffT = -1; // s since a Mason hit (the muffle without a knock); -1 = none
    this._stumT = -1; // s into a stumble; -1 = none
    this._stumSide = 1;
    this._tickT = -1; // s the '-30%' tick has shown; -1 = none
    this._tickPct = 0;
    this._hapStage = 0; // 0 none, 1 the Mason's first pulse due, 2 its second, 3 a bite's buzz due
    this._hapT = 0;
    this._rolled = false;
    this._sunk = false;
    this._sfx = false;
    this._ring = { source: '', k: 1 };
    this._hit = { source: 'mason', amount: 0.3, hp: 1, x: 0, y: 0, z: 0, dx: 0, dz: 1, down: true, debug: true };
    this.stats = { hits: 0, mason: 0, skitter: 0, punches: 0, rings: 0, haptics: 0, resets: 0, maxDrop: 0, maxRoll: 0, local: 0 };
    if (bus && typeof bus.on === 'function') {
      bus.on('player:hit', (e) => this.onHit(e));
      const reset = () => this.reset();
      bus.on('player:death', reset);
      bus.on('game:respawn', reset);
      bus.on('game:restart', reset);
      bus.on('game:start', reset);
      bus.on('game:menu', reset);
    }
  }

  /** The knock to follow: the SIM's while it runs, else the stand-in while it runs, else none (standing). */
  knock() {
    const gk = this.game && this.game.knock;
    if (gk && gk.phase && gk.phase !== 'none') return gk;
    if (this.local.phase !== 'none') return this.local;
    return null;
  }

  _settings() {
    const g = this.game;
    return (g && g.settings) || {};
  }

  /** A hit landed (the SIM's `player:hit`, or the debug one). */
  onHit(e) {
    if (!e) return;
    const g = this.game;
    const st = this._settings();
    const src = e.source === 'skitter' ? 'skitter' : 'mason';
    const gentle = st.hitFeedback === 'gentle';
    const calm = !!st.reducedEffects;
    this.mode = gentle ? 'gentle' : 'full';
    this.source = src;
    this.stats.hits++;
    if (src === 'mason') this.stats.mason++;
    else this.stats.skitter++;
    if (this.punch.hit(punchPeak(src, gentle, calm))) this.stats.punches++;
    // the roll side: away from the attacker, in the view as it is now (straight on: alternate deterministically)
    const r = g && g.renderer;
    const yaw = r && r.rig ? r.rig.rotation.y : 0;
    const side = rollSide(+e.dx, +e.dz, yaw, this.stats.hits & 1 ? 1 : -1);
    const down = e.down === true;
    if (down) this.side = side;
    else {
      this._stumT = 0; // a bite (or any hit without a knock): a short stumble
      this._stumSide = side;
    }
    if (src === 'mason') this._muffT = 0;
    // the stand-in knock: only while the SIM's Knockdown is not in the build
    if (down && !(g && g.knock)) this._startLocal();
    // the ECG tick
    const amt = typeof e.amount === 'number' && e.amount === e.amount ? e.amount : src === 'mason' ? 0.3 : 0.1;
    this._tickPct = Math.max(0, Math.min(100, Math.round(amt * 100)));
    this._tickT = 0;
    // haptics from the next frame (it replaces the generic health:damage buzz with the designed pattern)
    this._hapStage = src === 'mason' ? 1 : 3;
    this._hapT = 0;
    // the ring + the thump (audio route 'hit:ring') and the caption '[High-pitched ringing]'
    const ring = this._ring;
    ring.source = src;
    ring.k = src === 'skitter' ? RING_K.skitter : gentle ? RING_K.gentle : RING_K.mason;
    this.stats.rings++;
    if (this.bus) this.bus.emit('hit:ring', ring);
  }

  _startLocal() {
    this.local.start(HIT.down, HIT.rise);
    this.stats.local++;
  }

  /** Everything back to neutral (death, respawn, restart, start, menu). */
  reset() {
    this.stats.resets++;
    this.punch.reset();
    this.local.reset(false);
    this.flash = 0;
    this.vig = 0;
    this.dizzy = 0;
    this.muffle = 0;
    this.pose = 0;
    this.cam.drop = 0;
    this.cam.roll = 0;
    this._muffT = -1;
    this._stumT = -1;
    this._tickT = -1;
    this._hapStage = 0;
    this._writeFx();
    this._unrollCamera();
    this._restoreHands();
  }

  /** Once a frame from game.js _updateViews (any state). `dt` = the frame's dt (haptics); the curves run on the run clock. */
  update(dt) {
    const g = this.game;
    if (!g) return;
    if (!this._sfx && g.audio) this._sfx = registerHitFeedbackSfx(g.audio) || g.audio.registerSfx === undefined;
    const now = typeof g.time === 'number' && g.time === g.time ? g.time : 0;
    let sdt = now - this._lastT;
    this._lastT = now;
    if (!(sdt > 0)) sdt = 0;
    else if (sdt > 0.25) sdt = 0.25;
    this._time += sdt;
    const st = this._settings();
    const calm = !!st.reducedEffects;
    const gentle = st.hitFeedback === 'gentle';
    this.mode = gentle ? 'gentle' : 'full';
    this.flash = this.punch.step(sdt);
    this.local.step(sdt);
    const K = this.knock();
    const k = knockK(K);
    this.pose = k;
    this.vig = heldVig(k);
    this.dizzy = calm || gentle || k <= 0 ? 0 : Math.sin(this._time * HIT.dizzyHz * 2 * Math.PI) * HIT.dizzyAmp * this.vig;
    // the world muffle: a Mason's knock (closed down, opening over the rise), or the timer after a Mason hit without one
    let m = knockMuffle(K); // (only the Mason knocks you down)
    if (this._muffT >= 0) {
      this._muffT += sdt;
      const tm = timerMuffle(this._muffT);
      if (tm > m) m = tm;
      if (this._muffT > HIT.muffleTail) this._muffT = -1;
    }
    this.muffle = m;
    if (m > 0 && g.audio) holdHitMuffle(g.audio, m);
    if (this._stumT >= 0) {
      this._stumT += sdt;
      if (this._stumT >= HIT.stumbleDur) this._stumT = -1;
    }
    if (this._tickT >= 0) {
      this._tickT += sdt;
      if (this._tickT >= HIT.tick) this._tickT = -1;
    }
    this._haptics(dt);
    this._writeFx();
    this._sinkHands(k, gentle);
  }

  _haptics(dt) {
    if (this._hapStage === 0) return;
    const g = this.game;
    const hb = g && typeof g._hapticBoth === 'function';
    if (this._hapStage === 1) {
      if (hb) g._hapticBoth(HAPTIC.mason[0], HAPTIC.mason[1]);
      this.stats.haptics++;
      this._hapStage = 2;
      this._hapT = 0;
      return;
    }
    if (this._hapStage === 2) {
      this._hapT += dt > 0 ? dt : 0;
      if (this._hapT * 1000 >= HAPTIC.mason[1] + HAPTIC.mason[2]) {
        if (hb) g._hapticBoth(HAPTIC.mason[0], HAPTIC.mason[3]);
        this.stats.haptics++;
        this._hapStage = 0;
      }
      return;
    }
    if (hb) g._hapticBoth(HAPTIC.skitter[0], HAPTIC.skitter[1]);
    this.stats.haptics++;
    this._hapStage = 0;
  }

  /** The vignette's inputs (render/healthFx.js) and the ECG tick. */
  _writeFx() {
    const fx = this.game && this.game.healthFx;
    if (!fx) return;
    fx.hitFlash = this.flash;
    fx.hitVig = this.vig;
    fx.hitDizzy = this.dizzy;
    fx.hitTick = this._tickT >= 0 ? this._tickPct : 0;
    fx.hitTickT = this._tickT >= 0 ? this._tickT / HIT.tick : 1;
  }

  /** May the view be moved now? (a run on screen; never while a death scene owns the camera) */
  _camLive() {
    const g = this.game;
    const s = g.state;
    if (s !== 'playing' && s !== 'paused') return false;
    if (g.deathScene && g.deathScene.active) return false;
    return !!(g.player && g.player.alive !== false);
  }

  /** Once a frame at the end of game.js _updateRig: the eye drop and (desktop) the roll, from the knock as it is this frame. */
  applyCam() {
    const g = this.game;
    const r = g && g.renderer;
    if (!r || !r.rig || !r.camera || !g.player) return;
    const xr = !!g.xrActive;
    if (!this._camLive()) {
      this.cam.drop = 0;
      this.cam.roll = 0;
      if (!xr) this._unrollCamera();
      else this._rolled = false;
      return;
    }
    const st = this._settings();
    const o = this._cam;
    o.xr = xr;
    o.gentle = st.hitFeedback === 'gentle';
    o.calm = !!st.reducedEffects;
    o.comfort = typeof st.vignette === 'number' && st.vignette > 0;
    const k = knockK(this.knock());
    hitCam(k, this.side, o, this.cam);
    if (this._stumT >= 0 && !xr && !o.gentle) {
      const s = stumble(this._stumT);
      const d = HIT.stumbleDrop * s;
      if (d > this.cam.drop) this.cam.drop = d;
      if (k <= 0) this.cam.roll = HIT.stumbleRoll * s * this._stumSide * (o.calm ? 0.5 : 1);
    }
    const drop = this.cam.drop;
    if (drop > 0) r.rig.position.y -= drop;
    if (drop > this.stats.maxDrop) this.stats.maxDrop = drop;
    if (xr) {
      this._rolled = false; // the headset owns the camera's rotation: never written
      return;
    }
    const roll = this.cam.roll;
    const ar = roll < 0 ? -roll : roll;
    if (ar > this.stats.maxRoll) this.stats.maxRoll = ar;
    if (ar > 1e-6) {
      r.camera.rotation.z = roll;
      this._rolled = true;
    } else this._unrollCamera();
  }

  _unrollCamera() {
    if (!this._rolled) return;
    const g = this.game;
    const r = g && g.renderer;
    if (r && r.camera && !g.xrActive) r.camera.rotation.z = 0;
    this._rolled = false;
  }

  /** Desktop: the virtual hands sink toward the body while down (put back exactly; never while the free-fall flail owns them). */
  _sinkHands(k, gentle) {
    const g = this.game;
    const inp = g.input;
    const fp = g.fallPose;
    const on = k > 0 && !gentle && !g.xrActive && this._camLive() && !(fp && fp._applied);
    if (!on) {
      this._restoreHands();
      return;
    }
    if (!inp || !inp.sockets || !inp.tuning || !inp.tuning.desktopHand || inp.mode === 'xr') return;
    const base = inp.tuning.desktopHand;
    for (let i = 0; i < 2; i++) {
      const s = inp.sockets[HANDS[i]];
      if (!s || !s.position) continue;
      s.position.y = base.y - HAND_SINK.y * k;
      s.position.z = base.z + HAND_SINK.z * k;
    }
    this._sunk = true;
  }

  _restoreHands() {
    if (!this._sunk) return;
    this._sunk = false;
    const g = this.game;
    const inp = g && g.input;
    if (!inp || !inp.sockets || !inp.tuning || !inp.tuning.desktopHand) return;
    const fp = g.fallPose;
    if (fp && fp._applied) return; // the flail owns them now (it sets every coordinate itself)
    const base = inp.tuning.desktopHand;
    for (let i = 0; i < 2; i++) {
      const s = inp.sockets[HANDS[i]];
      if (!s || !s.position) continue;
      s.position.y = base.y;
      s.position.z = base.z;
    }
  }

  /**
   * AT3D.debug.hit(source = 'mason', down = true): a synthetic `player:hit` from the Mason (or the nearest stand-in point 1.5 m ahead of
   * the view) onto the player, as the SIM would emit it; with `down` the stand-in knock runs while the SIM's game.knock is missing or
   * idle. No damage is dealt (the SIM owns the health). Returns the state.
   */
  debugHit(source, down) {
    const g = this.game;
    const p = g && g.player;
    const src = source === 'skitter' ? 'skitter' : 'mason';
    const dn = down === undefined ? src === 'mason' : !!down;
    const e = this._hit;
    e.source = src;
    e.amount = src === 'mason' ? 0.3 : 0.1;
    e.hp = g && g.health && typeof g.health.hp === 'number' ? g.health.hp : 1;
    e.down = dn;
    const r = g && g.renderer;
    const yaw = r && r.rig ? r.rig.rotation.y : 0;
    const px = p ? p.x : 0;
    const py = p ? p.y : 0;
    const pz = p ? p.z : 0;
    const c = g && g.creature;
    let ax = px - Math.sin(yaw) * 1.5;
    let az = pz - Math.cos(yaw) * 1.5;
    let ay = py + 1.2;
    if (src === 'mason' && c && typeof c.x === 'number' && c.x === c.x && Math.hypot(c.x - px, c.z - pz) < 6) {
      ax = c.x;
      ay = c.y + 1.8;
      az = c.z;
    }
    e.x = ax;
    e.y = ay;
    e.z = az;
    const dx = px - ax;
    const dz = pz - az;
    const l = Math.hypot(dx, dz) || 1;
    e.dx = dx / l;
    e.dz = dz / l;
    if (this.bus) this.bus.emit('player:hit', e);
    else this.onHit(e);
    const gk = g && g.knock;
    if (dn && gk && (!gk.phase || gk.phase === 'none')) this._startLocal(); // the SIM did not knock on a synthetic hit: the stand-in does
    return this.debugState();
  }

  debugState() {
    const K = this.knock();
    return {
      mode: this.mode,
      source: this.source,
      flash: this.flash,
      vig: this.vig,
      dizzy: this.dizzy,
      muffle: this.muffle,
      pose: this.pose,
      drop: this.cam.drop,
      roll: this.cam.roll,
      knock: K ? { phase: K.phase, t: K.t, dur: K.dur, k: K.k, local: K === this.local } : null,
      stats: { ...this.stats },
    };
  }
}
