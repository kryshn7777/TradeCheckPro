/* ABYSSAL TETHER 3D — creatureSync3d.js
 * The Mason's sound locked to its animation. Subscribes (through AudioManager3D) to
 *   creature:clip {name, event, t}      one event per clip start ('start' or no event), named clip event, or 'end'
 *   mason:anim    {clip|name, event, t} the same, as dispatched by masonAnimator.js
 *   creature:freeze / unfreeze, creature:linger {phase}, creature:hide {phase}, mason:plant {x,y,z,intensity}
 * and plays, at the creature's crown / spine / foot (HRTF, distance low-pass, delayed by d/343 s beyond 28 m,
 * occlusion approximated by level.segmentBlocked at ~6 Hz):
 *   listen          the bed (scrape / drone) is cut on the freeze frame; each pit pulse is a faint resonant click
 *   notice_snap     a stone clack
 *   rear_windup     a grinding rise over the wind-up; a wet-stone pop at `open`, a hard clack at `full`
 *   strike          stone impact + sub boom at `contact`;  portal_snap `clap`: the portal slamming shut
 *   recoil          a rattle of loose stone
 *   roar_display    a deep formant roar with a low-pass sweep
 *   linger_breathe  slow wet inhales and exhales
 *   plate_shiver    grinding stone (a continuous layer: weight follows body.jitter too)
 *   leg_probe       leg taps; knock_x3 stone knocks; breathe_seams a faint seam puff
 * Every category is a FALLBACK pair: until the rig emits a clip event of that category the existing sim-event sounds
 * (creature:attack / strike / call / burst, ...) play as before. Once a category is seen, the sim sound is deferred
 * 0.15 s and played only if the clip event did not arrive (never both). All no-ops if the rig never emits anything.
 * Silence is a signal: while the creature listens / lingers / freezes `silence` → 1, which drops the music, thins the
 * ambience and cuts the creature bed (mgr._silence / mgr._thin).
 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const BASE_CLIPS = { crown_idle: 1, rear_windup: 1, strike: 1, roar_display: 1, linger_breathe: 1, crown_up: 1, coil_grip: 1, take_close: 1, knock_x3: 1, notice_snap: 1 };
const CATS = ['windup', 'strike', 'roar', 'snap'];
const PEND_WINDOW = 0.15;
const EMPTY = Object.freeze({});

function mkPend() {
  return { t: -1, x: NaN, y: NaN, z: NaN, d: NaN, w: 0, f: false };
}

export class CreatureSync {
  constructor(mgr) {
    this.m = mgr;
    this.seen = { windup: false, strike: false, roar: false, snap: false, plant: false, any: false };
    this.last = { windup: -9, strike: -9, roar: -9, snap: -9 };
    this.pend = { windup: mkPend(), strike: mkPend(), roar: mkPend(), snap: mkPend() };
    this.freeze = false;
    this.freezeUntil = 0;
    this.linger = false;
    this.lingerUntil = 0;
    this.hide = false;
    this.shiver = 0; // clip-driven plate shiver weight
    this.occ = 0; // smoothed occlusion of the crown 0..1
    this.occT = 0;
    this.levelMul = 1;
    this.clipEvents = 0;
    this.lastClip = '';
    this.silence = 0;
    this.head = { x: NaN, y: NaN, z: NaN };
    this.bedCut = false;
    this.snapDue = -1;
  }

  reset() {
    this.freeze = this.linger = this.hide = false;
    this.shiver = 0;
    this.silence = 0;
    for (const c of CATS) this.pend[c].t = -1;
  }

  // -------------------------------------------------------------------------
  // routing of the sim events (fallback / dedupe)
  // -------------------------------------------------------------------------

  /** True when the sim sound of `cat` is handled here (deferred, or already sounded by the rig's clip event). */
  route(cat, x, y, z, d, w, f) {
    if (!this.seen[cat]) return false;
    const now = this.m.ctx.currentTime;
    if (now - this.last[cat] < PEND_WINDOW) return true;
    const p = this.pend[cat];
    p.t = now;
    p.x = x;
    p.y = y;
    p.z = z;
    p.d = d;
    p.w = w;
    p.f = !!f;
    return true;
  }

  _satisfy(cat, now) {
    this.seen[cat] = true;
    this.last[cat] = now;
    this.pend[cat].t = -1;
  }

  // -------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------

  onClip(p) {
    const m = this.m;
    if (!m._live()) return;
    const name = typeof p.name === 'string' ? p.name : typeof p.clip === 'string' ? p.clip : '';
    if (!name) return;
    let ev = typeof p.event === 'string' ? p.event : 'start';
    if (ev === 'begin') ev = 'start';
    const now = m.ctx.currentTime;
    this.seen.any = true;
    this.clipEvents++;
    this.lastClip = name + ':' + ev;
    if (ev === 'start' && BASE_CLIPS[name] === 1 && name !== 'listen') this._setFreeze(false, now);
    const pos = this._pos(p);
    switch (name) {
      case 'listen':
      case 'listen_freeze':
        if (ev === 'start') this._setFreeze(true, now);
        else if (ev === 'end') this._setFreeze(false, now);
        else if (ev === 'pulse') {
          this._setFreeze(true, now);
          this._pitClick(pos);
        }
        break;
      case 'notice_snap':
        if (ev === 'start') {
          // the clip's own `snap` event (0.22 of the clip) carries the clack; if the rig sends none, play it 0.1 s later
          this._satisfy('snap', now);
          this.snapDue = now + 0.11;
        } else if (ev === 'snap') {
          this._satisfy('snap', now);
          this.snapDue = -1;
          this._clack(pos, true);
        }
        break;
      case 'rear_windup':
        if (ev === 'start') {
          this._satisfy('windup', now);
          this._windup(pos, clamp(Number(p.dur) || this._windupLen(), 0.3, 1.2));
        } else if (ev === 'open') this._pop(pos);
        else if (ev === 'full') this._clack(pos, false);
        break;
      case 'strike':
        if (ev === 'contact') {
          this._satisfy('strike', now);
          this._strike(pos, true);
        } else if (ev === 'start') this.seen.strike = true;
        break;
      case 'portal_snap':
        if (ev === 'clap') {
          this._satisfy('strike', now);
          this._strike(pos, false);
        }
        break;
      case 'recoil':
        if (ev === 'start' || ev === 'clack') this._rattle(pos, ev === 'clack');
        break;
      case 'roar_display':
        if (ev === 'start') {
          this._satisfy('roar', now);
          this._roar(pos, clamp(Number(p.dur) || 2.5, 1, 4));
        } else if (ev === 'close') this._clack(pos, false);
        break;
      case 'linger_breathe':
        if (ev === 'start') this._setLinger(true, now);
        else if (ev === 'end') this._setLinger(false, now);
        else if (ev === 'inhale') {
          this._setLinger(true, now);
          this._breath(pos);
        }
        break;
      case 'plate_shiver':
        if (ev === 'start') this.shiver = clamp(Number(p.weight) || 1, 0, 1);
        else if (ev === 'end') this.shiver = 0;
        break;
      case 'leg_probe':
        if (ev === 'tap') this._tap(pos);
        break;
      case 'knock_x3':
        if (ev === 'knock') this._knock(pos);
        break;
      case 'breathe_seams':
        if (ev === 'exhale') this._puff(pos);
        break;
      case 'take_close':
        if (ev === 'dark') m._music && m._music.duck(5);
        break;
      default:
        break;
    }
  }

  onFlag(type, p) {
    const now = this.m.ctx.currentTime;
    if (type === 'creature:freeze') this._setFreeze(true, now);
    else if (type === 'creature:unfreeze') this._setFreeze(false, now);
    else if (type === 'creature:linger') this._setLinger(!(p && (p.phase === 'end' || p.phase === 'stop')), now);
    else if (type === 'creature:hide') this.hide = !(p && (p.phase === 'end' || p.phase === 'stop'));
    else if (type === 'mason:plant') {
      this.seen.plant = true;
      this.m._sfxCreatureStep({ x: Number(p.x), y: Number(p.y), z: Number(p.z), intensity: Number.isFinite(p.intensity) ? p.intensity : 0.65, distance: NaN });
    }
  }

  _setFreeze(on, now) {
    this.freeze = on;
    this.freezeUntil = on ? now + 5 : 0;
    if (on) this._bedCut(now);
  }

  _setLinger(on, now) {
    this.linger = on;
    this.lingerUntil = on ? now + 4.5 : 0;
  }

  /** The bed is cut on the very frame the legs stop (A5): force the continuous creature layers to zero now. */
  _bedCut(now) {
    const m = this.m;
    if (!m._built) return;
    m.kScrG.force(0, now, 0.012);
    m.kCloseG.force(0, now, 0.012);
    m.kDroneG.force(m.kDroneG.last * 0.4, now, 0.02);
  }

  _windupLen() {
    const g = this.m._game;
    const a = g && g.creature && g.creature.attack;
    return a && Number.isFinite(a.windup) ? a.windup : 0.7;
  }

  /** World position of an event: its own x/y/z, else the crown (body.head), else the creature. */
  _pos(p) {
    const H = this.head;
    const x = Number(p.x);
    const y = Number(p.y);
    const z = Number(p.z);
    if (Number.isFinite(x + y + z)) {
      H.x = x;
      H.y = y;
      H.z = z;
      return H;
    }
    const g = this.m._game;
    const cr = g && g.creature;
    const h = cr && cr.body && cr.body.head;
    if (h && Number.isFinite(h.x + h.y + h.z)) {
      H.x = h.x;
      H.y = h.y;
      H.z = h.z;
      return H;
    }
    if (cr && Number.isFinite(cr.x + cr.y + cr.z)) {
      H.x = cr.x;
      H.y = cr.y;
      H.z = cr.z;
      return H;
    }
    H.x = H.y = H.z = NaN;
    return H;
  }

  // -------------------------------------------------------------------------
  // per-control-tick
  // -------------------------------------------------------------------------

  control(dtc, now, game, c) {
    const m = this.m;
    const CR = game && game.creature && game.creature.active !== false ? game.creature : null;
    // deferred sim sounds whose clip event never came
    for (let i = 0; i < CATS.length; i++) {
      const p = this.pend[CATS[i]];
      if (p.t > 0 && now - p.t > PEND_WINDOW) {
        p.t = -1;
        m._playSim(CATS[i], p);
      }
    }
    if (this.snapDue > 0 && now >= this.snapDue) {
      this.snapDue = -1;
      this._clack(this._pos(EMPTY), true);
    }
    if (this.freeze && now > this.freezeUntil) this.freeze = false;
    if (this.linger && now > this.lingerUntil && !(CR && CR.body && CR.body.perf && CR.body.perf.mode === 'LINGER')) this.linger = false;

    // silence: the creature listens, lingers or is frozen mid-clip
    const listening = !!(CR && c.playing && (CR.listening === true || (CR.state === 'OBSERVING' && CR.body && CR.body.listen > 0.9)));
    const near = !CR || !(CR.distance > 0) || CR.distance < 70;
    const want = c.playing && !c.dead && near && (listening || this.freeze || this.linger) ? 1 : 0;
    this.bedCut = !!(CR && (listening || this.freeze));
    const k = want > this.silence ? 1 - Math.exp(-dtc / 0.12) : 1 - Math.exp(-dtc / 3.2);
    this.silence += (want - this.silence) * k;
    if (this.bedCut) this._bedCut(now);
    m._silence = this.silence;
    m._thin = 1 - 0.65 * this.silence;

    // occlusion of the crown by masonry (6 Hz)
    this.occT -= dtc;
    if (this.occT <= 0) {
      this.occT = 0.16;
      let occ = 0;
      const lv = game && game.level;
      const ca = CR && CR.audio;
      if (lv && typeof lv.segmentBlocked === 'function' && ca && Number.isFinite(ca.x + ca.y + ca.z) && ca.distance < 90 && m._listenerSet) {
        try {
          occ = lv.segmentBlocked(m._lx, m._ly, m._lz, ca.x, ca.y, ca.z, 1.5) ? 1 : 0;
        } catch {
          occ = 0;
        }
      }
      this.occ += (occ - this.occ) * 0.45;
      this.levelMul = 1 - 0.3 * this.occ;
    }
  }

  // -------------------------------------------------------------------------
  // sounds (all placed at pos = {x,y,z})
  // -------------------------------------------------------------------------

  /** Common voice: spatial placement, distance low-pass, delay beyond 28 m, occlusion. Returns the voice or null. */
  _voice(name, prio, minGap, dur, level, floor, pos, send, cutMin) {
    const m = this.m;
    const sp = m._spatial(pos.x, pos.y, pos.z, NaN);
    const lvl = level * m._cMul(sp, floor);
    if (lvl * (sp.ok ? 1 : sp.gain) < 0.004) return null;
    const cut = Math.max(sp.cutoff * (1 - 0.55 * this.occ), cutMin || 0);
    const v = m._begin(name, prio, minGap, dur + sp.delay, m.busCreature, lvl, 0, Math.max(sp.send, send || 0), cut, m._cPos(sp), 'near');
    if (!v) return null;
    this._t = v.t0 + sp.delay;
    this._d = sp.d;
    return v;
  }

  _pitClick(pos) {
    const m = this.m;
    const v = this._voice('pit', 0, 0.04, 0.4, 0.5, 0.05, pos, 0.4, 2400);
    if (!v) return;
    const t = this._t;
    const n = m._vNoise(v, m._white, t, 1);
    const bp = m._vFilter(v, 'bandpass', rand(2300, 3600), 22);
    const g = m._vGain(v, 0);
    m._perc(g.gain, t, 0.55, 0.001, 0.03);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const o = m._vOsc(v, 'sine', rand(1500, 2300), t);
    const og = m._vGain(v, 0);
    m._perc(og.gain, t, 0.22, 0.001, 0.05);
    o.connect(og);
    og.connect(v.out);
    m._commit(v);
  }

  /** Stone clack: sharp crack + a stone-body ring + a dull knock. */
  _clack(pos, big) {
    const m = this.m;
    const v = this._voice('cclack', 1, 0.05, 0.7, big ? 1.1 : 0.8, 0.12, pos, 0.25, 3000);
    if (!v) return;
    const t = this._t;
    const n = m._vNoise(v, m._white, t, 1);
    const hp = m._vFilter(v, 'highpass', 1900, 0);
    const g = m._vGain(v, 0);
    m._perc(g.gain, t, 0.7, 0.001, 0.012);
    n.connect(hp);
    hp.connect(g);
    g.connect(v.out);
    const o = m._vOsc(v, 'sine', 210, t);
    o.frequency.setTargetAtTime(88, t, 0.03);
    const og = m._vGain(v, 0);
    m._perc(og.gain, t, 0.55, 0.002, 0.05);
    o.connect(og);
    og.connect(v.out);
    for (let k = 0; k < 3; k++) {
      const r = m._vOsc(v, 'sine', [940, 1480, 2230][k] * rand(0.97, 1.03), t);
      const rg = m._vGain(v, 0);
      m._perc(rg.gain, t, [0.2, 0.14, 0.08][k], 0.001, [0.09, 0.06, 0.04][k]);
      r.connect(rg);
      rg.connect(v.out);
    }
    m._commit(v);
  }

  _pop(pos) {
    const m = this.m;
    const v = this._voice('cpop', 0, 0.1, 0.4, 0.55, 0.08, pos, 0.3, 1800);
    if (!v) return;
    const t = this._t;
    const o = m._vOsc(v, 'sine', 150, t);
    o.frequency.setTargetAtTime(66, t, 0.04);
    const g = m._vGain(v, 0);
    m._perc(g.gain, t, 0.6, 0.003, 0.05);
    o.connect(g);
    g.connect(v.out);
    m._tickTrain(v, t, 2, 0.05, 0.3, 700, 1900, 3, 0.012, 0.3);
    m._commit(v);
  }

  /** Grinding rise locked to the wind-up (dur = clip length): stone on stone, accelerating, then it stops short. */
  _windup(pos, dur) {
    const m = this.m;
    const v = this._voice('cwind', 2, 0.2, dur + 0.5, 1.0, 0.18, pos, 0.3, 2600);
    if (!v) return;
    const t = this._t;
    const n = m._vNoise(v, m._brown, t, 1);
    const bp = m._vFilter(v, 'bandpass', 150, 2.5);
    bp.frequency.exponentialRampToValueAtTime(950, t + dur);
    const am = m._vGain(v, 0.55);
    const lfo = m._vOsc(v, 'sawtooth', 12, t);
    lfo.frequency.linearRampToValueAtTime(38, t + dur);
    const lg = m._vGain(v, 0.42);
    lfo.connect(lg);
    lg.connect(am.gain);
    const g = m._vGain(v, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.04);
    n.connect(bp);
    bp.connect(am);
    am.connect(g);
    g.connect(v.out);
    const o = m._vOsc(v, 'sawtooth', 52, t);
    o.frequency.exponentialRampToValueAtTime(150, t + dur);
    const lp = m._vFilter(v, 'lowpass', 420, 1);
    const og = m._vGain(v, 0);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.4, t + dur);
    og.gain.setTargetAtTime(0, t + dur, 0.05);
    o.connect(lp);
    lp.connect(og);
    og.connect(v.out);
    m._commit(v);
  }

  /** Strike contact (hit = true) or the portal slamming shut (a miss): impact + sub boom. */
  _strike(pos, hit) {
    const m = this.m;
    const v = this._voice(hit ? 'cstrike' : 'cclap', 3, 0.15, 2.4, hit ? 1.25 : 1.0, 0.3, pos, 0.4, 2800);
    if (!v) return;
    const t = this._t;
    m._impactLayers(v, t, hit ? 1.15 : 0.9);
    const sub = m._vOsc(v, 'sine', 52, t);
    sub.frequency.exponentialRampToValueAtTime(23, t + 1.3);
    const sg = m._vGain(v, 0);
    m._perc(sg.gain, t, hit ? 1.0 : 0.7, 0.004, 0.45);
    sub.connect(sg);
    sg.connect(v.out);
    if (!hit) {
      // plates ringing against each other
      for (let k = 0; k < 3; k++) {
        const r = m._vOsc(v, 'sine', [610, 1190, 1870][k] * rand(0.97, 1.03), t);
        const rg = m._vGain(v, 0);
        m._perc(rg.gain, t, [0.25, 0.18, 0.1][k], 0.001, [0.2, 0.12, 0.07][k]);
        r.connect(rg);
        rg.connect(v.out);
      }
    }
    m._commit(v);
  }

  /** Recoil: a rattle of loose stone, then quiet. */
  _rattle(pos, one) {
    const m = this.m;
    const v = this._voice('crattle', 1, 0.1, 1.1, 0.8, 0.1, pos, 0.35, 3200);
    if (!v) return;
    const t = this._t;
    m._tickTrain(v, t, one ? 2 : 10, one ? 0.1 : 0.75, 0.55, 900, 3200, 6, 0.012, 0.6);
    if (!one) {
      const o = m._vOsc(v, 'sine', 74, t);
      const am = m._vGain(v, 0);
      m._swell(am.gain, t, 0.25, 0.05, 0.25, 0.25);
      o.connect(am);
      am.connect(v.out);
    }
    m._commit(v);
  }

  /** Deep formant roar with a low-pass sweep (open at 22 %, peak 44 %, close at 84 % of the clip). */
  _roar(pos, dur) {
    const m = this.m;
    const v = this._voice('croar', 2, 0.8, dur + 1.2, 1.15, 0.12, pos, 0.55, 1500);
    if (!v) return;
    const t = this._t;
    const f0 = rand(46, 56);
    const exc = m._vGain(v, 1);
    const o1 = m._vOsc(v, 'sawtooth', f0, t);
    const o2 = m._vOsc(v, 'sawtooth', f0 * 1.011, t);
    for (const o of [o1, o2]) {
      o.frequency.linearRampToValueAtTime(o === o1 ? f0 * 1.38 : f0 * 1.011 * 1.38, t + dur * 0.36);
      o.frequency.exponentialRampToValueAtTime(o === o1 ? f0 * 0.72 : f0 * 1.011 * 0.72, t + dur * 0.96);
      o.connect(exc);
    }
    const br = m._vNoise(v, m._pink, t, 1);
    const bg = m._vGain(v, 0.35);
    br.connect(bg);
    bg.connect(exc);
    // the low-pass sweep: closed → open → half closed
    const sweep = m._vFilter(v, 'lowpass', 380, 0.8);
    sweep.frequency.setValueAtTime(380, t);
    sweep.frequency.linearRampToValueAtTime(2400, t + dur * 0.24);
    sweep.frequency.setTargetAtTime(700, t + dur * 0.5, dur * 0.18);
    const env = m._vGain(v, 0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + dur * 0.12);
    env.gain.setTargetAtTime(0.75, t + dur * 0.3, 0.3);
    env.gain.setTargetAtTime(0, t + dur * 0.84, 0.16);
    exc.connect(sweep);
    sweep.connect(env);
    env.connect(v.out);
    const F = [
      [260, 520, 330, 6, 1],
      [620, 940, 640, 8, 0.7],
      [1450, 1900, 1400, 9, 0.35],
    ];
    const fs = m._vGain(v, 1);
    for (let k = 0; k < F.length; k++) {
      const f = F[k];
      const bp = m._vFilter(v, 'bandpass', f[0], f[3]);
      bp.frequency.setValueAtTime(f[0], t);
      bp.frequency.linearRampToValueAtTime(f[1], t + dur * 0.4);
      bp.frequency.linearRampToValueAtTime(f[2], t + dur);
      const fg = m._vGain(v, f[4]);
      exc.connect(bp);
      bp.connect(fg);
      fg.connect(fs);
    }
    fs.connect(env);
    // a sub swell under it
    const so = m._vOsc(v, 'sine', 36, t);
    so.frequency.linearRampToValueAtTime(48, t + dur * 0.4);
    const sg = m._vGain(v, 0);
    m._swell(sg.gain, t, 0.45, dur * 0.3, dur * 0.35, 0.3);
    so.connect(sg);
    sg.connect(v.out);
    m._commit(v);
  }

  /** One wet breath cycle: a slow suction inhale, a pause, a lower exhale with seam rasp. */
  _breath(pos) {
    const m = this.m;
    const v = this._voice('cbreath', 1, 0.5, 3.3, 0.6, 0.06, pos, 0.5, 1400);
    if (!v) return;
    const t = this._t;
    const n = m._vNoise(v, m._pink, t, 0.9);
    const bp = m._vFilter(v, 'bandpass', 380, 2.2);
    bp.frequency.exponentialRampToValueAtTime(950, t + 1.1);
    bp.frequency.setValueAtTime(820, t + 1.35);
    bp.frequency.exponentialRampToValueAtTime(260, t + 2.8);
    const g = m._vGain(v, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 1.05);
    g.gain.setTargetAtTime(0, t + 1.1, 0.07);
    g.gain.setTargetAtTime(0.9, t + 1.4, 0.35);
    g.gain.setTargetAtTime(0, t + 2.2, 0.35);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    m._tickTrain(v, t + 0.2, 4, 0.9, 0.22, 600, 2000, 3, 0.012, 0.3);
    const r = m._vOsc(v, 'sawtooth', 58, t + 1.4);
    r.frequency.linearRampToValueAtTime(40, t + 2.7);
    const rl = m._vFilter(v, 'lowpass', 240, 0.8);
    const am = m._vGain(v, 0.5);
    const lfo = m._vOsc(v, 'sine', 6, t + 1.4);
    const lg = m._vGain(v, 0.5);
    lfo.connect(lg);
    lg.connect(am.gain);
    const rg = m._vGain(v, 0);
    m._swell(rg.gain, t + 1.4, 0.3, 0.5, 0.5, 0.4);
    r.connect(rl);
    rl.connect(am);
    am.connect(rg);
    rg.connect(v.out);
    m._commit(v);
  }

  _tap(pos) {
    const m = this.m;
    const v = this._voice('ctap', 0, 0.06, 0.3, 0.7, 0.06, pos, 0.2, 2800);
    if (!v) return;
    const t = this._t;
    m._tickTrain(v, t, 1, 0.01, 0.7, 1600, 3000, 8, 0.008, 0);
    const o = m._vOsc(v, 'sine', rand(120, 160), t);
    o.frequency.setTargetAtTime(78, t, 0.03);
    const g = m._vGain(v, 0);
    m._perc(g.gain, t, 0.4, 0.002, 0.04);
    o.connect(g);
    g.connect(v.out);
    m._commit(v);
  }

  _knock(pos) {
    const m = this.m;
    const v = this._voice('cknock', 1, 0.12, 0.9, 1.1, 0.15, pos, 0.4, 2400);
    if (!v) return;
    const t = this._t;
    const o = m._vOsc(v, 'sine', 125, t);
    o.frequency.setTargetAtTime(52, t, 0.06);
    const g = m._vGain(v, 0);
    m._perc(g.gain, t, 0.9, 0.003, 0.12);
    o.connect(g);
    g.connect(v.out);
    const b = m._vNoise(v, m._brown, t, 1);
    const lp = m._vFilter(v, 'lowpass', 700, 0);
    const bg = m._vGain(v, 0);
    m._perc(bg.gain, t, 0.6, 0.002, 0.08);
    b.connect(lp);
    lp.connect(bg);
    bg.connect(v.out);
    const n = m._vNoise(v, m._white, t, 1);
    const hp = m._vFilter(v, 'highpass', 2200, 0);
    const ng = m._vGain(v, 0);
    m._perc(ng.gain, t, 0.3, 0.001, 0.01);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(v.out);
    m._commit(v);
  }

  /** Faint seam puff, only audible up close. */
  _puff(pos) {
    const m = this.m;
    const sp = m._spatial(pos.x, pos.y, pos.z, NaN);
    if (sp.d > 20) return;
    const v = this._voice('cpuff', 0, 0.6, 0.9, 0.22, 0.02, pos, 0.2, 1600);
    if (!v) return;
    const t = this._t;
    const n = m._vNoise(v, m._pink, t, 1);
    const hp = m._vFilter(v, 'highpass', 1400, 0);
    const g = m._vGain(v, 0);
    m._swell(g.gain, t, 0.6, 0.18, 0.12, 0.18);
    n.connect(hp);
    hp.connect(g);
    g.connect(v.out);
    m._commit(v);
  }

  debug(out) {
    out.clipEvents = this.clipEvents;
    out.lastClip = this.lastClip;
    out.seen = [this.seen.windup && 'windup', this.seen.strike && 'strike', this.seen.roar && 'roar', this.seen.snap && 'snap', this.seen.plant && 'plant'].filter(Boolean);
    out.freeze = this.freeze;
    out.linger = this.linger;
    out.hide = this.hide;
    out.silence = +this.silence.toFixed(3);
    out.occlusion = +this.occ.toFixed(2);
    out.shiver = this.shiver;
    return out;
  }
}
