/* THE LANTERN (ABYSSAL TETHER 3D) — weaponGlue.js
 * THE SOLDIERS' WEAPONS (plans/SOLDIER_WEAPONS.md): everything game.js needs for the grenade and the service revolver, in one module
 * (the puzzleFocusGlue / chaseGlue pattern: game.js holds a handful of one-line calls).
 *
 *   const wg = new WeaponGlue(game)  once (game.js _setupWeapons, with the bus): `game.weapons`; `.sim` is this world's Weapons3D
 *   wg.input(dt, intent)             once per live run frame, BEFORE the knocker's input: the gadget selection, the grenade's aim and
 *                                    throw, the revolver's shot; when the gadget is not the knocker it takes G / the VR draw for itself
 *                                    (the knocker's own code then sees no press)
 *   wg.step(dt)                      once per run frame, after the knocker's update: the grenades fly and go off (the Mason, the
 *                                    skitterlings, the swarm, you: the blast's damage goes through Health3D as cause 'blast', a death is a
 *                                    'hazard' death); the scripted-beat flag for the Mason (the S5 keystone, the S7 arena)
 *   wg.update(dt)                    once per frame in the views: the thrown grenades / the VR revolver (render/weaponView.js, loaded with
 *                                    the renderer), the grenade's aim arc (the knocker view's line), the delayed lore toast
 *   wg.pickupDiff()                  the difficulty key for Pickups3D.weaponDiff ('' when the weapons are off)
 *
 * The GADGET is the one item G uses (and the VR pull-up draws): ITEM.KNOCKER (the default), ITEM.GRENADE or ITEM.SIDEARM. Desktop 5 / 6 / 7
 * pick one, T cycles; touch: the bag's KNOCK / GREN / GUN buttons (pick + use); VR: tap X while the bag ring is open to cycle (the ring's
 * hint names it). Picking up a weapon while the gadget's own count is 0 selects it. A new run selects the knocker.
 * Input: the knocker's own paths, unchanged: desktop G held = charge (the knocker's arc and velocities: knocker3d.js throwVelocity), the
 * release throws; touch = a tap lob; VR = pulled up out of the bag and thrown by the hand (vrThrowVelocity). The revolver fires on the G
 * press along the view centre (the crosshair) / touch along the view / VR on the grip's release along that hand's aim ray (the
 * rope's own aim; the rope triggers are never touched). The muzzle flash is the lantern's flare (game.flow.flare: x1.5, ~0.4 s).
 * No allocation per frame (scratch reused; toasts / events only on the rare moments).
 */
import { Weapons3D, WEAPONS, GSTATE } from './sim/weapons3d.js';
import { ITEM } from './sim/inventory3d.js';
import { throwVelocity, vrThrowVelocity, predictArc } from './sim/knocker3d.js';
import { registerWeaponSfx } from './audio/weaponSfx.js';

export const GADGETS = Object.freeze([ITEM.KNOCKER, ITEM.GRENADE, ITEM.SIDEARM]);
const HAND_NAMES = Object.freeze(['left', 'right']);
const GADGET_NAME = Object.freeze({ 4: 'KNOCKER', 5: 'GRENADE', 6: 'REVOLVER' });

/** The first-pickup lines (STORY.md voice: plain, dark, never a lie about the mechanics). */
export const WEAPON_LORE = Object.freeze({
  [ITEM.GRENADE]: 'A grenade off a dead soldier of an earlier expedition. He never threw it. Iron will not kill it, but it hurts.',
  [ITEM.SIDEARM]: 'His service revolver, still loaded. The walls took him before he fired. Loud: it hears every shot.',
});
export const WEAPON_HINT = Object.freeze({
  desktop: 'Grenade / revolver: press [6] or [7] (or [T]) to choose, then [G]: hold and release to throw, tap to fire. It hurts the Mason and sends it away for a while.',
  touch: 'Open [BAG]: GREN throws a grenade, GUN fires the revolver. It hurts the Mason and sends it away for a while.',
  vr: 'Open the bag at your hip, tap [X] to choose the grenade or revolver, pull it up, then throw it or let go to fire.',
});

/** `?weapons=off` leaves the soldiers' weapons out (none found, G is the knocker's): the route bots / e2e. */
export function weaponsOff() {
  try {
    return typeof location !== 'undefined' && /[?&]weapons=off/.test(location.search || '');
  } catch {
    return false;
  }
}

/** AT3D.debug.weapons: the glue's debugApi() resolved on each call (the debug object is built before the glue exists). */
export function weaponDebug(getGlue) {
  const api = (name) => (...a) => {
    const g = getGlue();
    if (!g) return null;
    const d = g._dbg || (g._dbg = g.debugApi());
    return d[name](...a);
  };
  return { state: api('state'), give: api('give'), select: api('select'), throw: api('throw'), fire: api('fire'), blast: api('blast'), numbers: api('numbers') };
}

const _o = { x: 0, y: 0, z: 0 };
const _v = { vx: 0, vy: 0, vz: 0, speed: 0, charge: 0 };
const _hv = { x: 0, y: 0, z: 0 };
const _ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 };

export class WeaponGlue {
  constructor(game) {
    this.game = game;
    this.sim = null;
    this.view = null;
    this.gadget = ITEM.KNOCKER;
    this.drawable = false; // the VR pull-up may draw the selected gadget now (inputManager reads it)
    this.aiming = false;
    this.held = 0;
    this.arc = new Float32Array(48 * 3);
    this.arcN = 0;
    this.revolverPose = { on: false, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    this._dir = { x: 0, y: 0, z: -1, ex: 0, ey: 0, ez: 0 }; // the view direction and the eye (_origin)
    this.firstPick = { 5: true, 6: true };
    this.hinted = false;
    this.stats = { selects: 0, throws: 0, shots: 0, toasts: 0 };
    this._bag = null;
    this._sfx = false;
    this._toastText = '';
    this._toastS = 0;
    this._toastT = -1;
    this._emptyT = -1e9;
    this._viewTried = false;
    const bus = game && game.bus;
    if (bus && typeof bus.on === 'function') {
      bus.on('game:start', () => this._newRun());
      bus.on('game:respawn', () => this._clearWorld());
      bus.on('game:warp', () => this._clearWorld());
      bus.on('pickup:collect', (e) => this._onPick(e));
      bus.on('revolver:fire', (e) => this._onFire(e));
      bus.on('revolver:dry', () => this._onDry());
      bus.on('grenade:blast', (e) => this._onBlast(e));
      bus.on('weapon:hit', (e) => {
        if (e && e.target === 'mason' && this.view) this.view.burst('mason', e.x, e.y, e.z, 1);
      });
      bus.on('skitter:killed', (e) => {
        if (e && this.view) this.view.burst('splat', e.x, e.y, e.z, 1);
      });
      bus.on('weapon:refuse', (e) => this._onRefuse(e));
    }
  }

  /** The setting (default on) and not ?weapons=off. */
  on() {
    const s = this.game && this.game.settings;
    return !weaponsOff() && !(s && s.weapons === false);
  }

  /** Pickups3D.weaponDiff for a new run: the difficulty key, '' when the weapons are off. */
  pickupDiff() {
    if (!this.on()) return '';
    const k = this.game && this.game.difficultyKey;
    return typeof k === 'string' && k ? k : 'normal';
  }

  /** This world's Weapons3D (a new world = a new bag = a new sim on the run's scoped bus). */
  _ensure() {
    const g = this.game;
    if (!g || !g.bag) return null;
    if (this._bag !== g.bag) {
      this._bag = g.bag;
      this.sim = new Weapons3D(g._runBus || g.bus);
      this.aiming = false;
    }
    const w = this.sim;
    w.enabled = this.on();
    w.diffKey = typeof g.difficultyKey === 'string' ? g.difficultyKey : 'normal';
    return w;
  }

  _newRun() {
    this.gadget = ITEM.KNOCKER;
    this.firstPick[5] = true;
    this.firstPick[6] = true;
    this._clearWorld();
  }

  _clearWorld() {
    const w = this._ensure();
    if (w) w.reset();
    this.aiming = false;
    this.arcN = 0;
    this.revolverPose.on = false;
  }

  _kindOn(k) {
    const g = this.game;
    if (k === ITEM.KNOCKER) return !(g && g.knocker && g.knocker.enabled === false);
    return this.on();
  }

  /** Selects gadget `k` (when it is on). */
  select(k) {
    if (GADGETS.indexOf(k) < 0 || !this._kindOn(k) || this.gadget === k) return this.gadget;
    this.gadget = k;
    this.stats.selects++;
    const w = this.sim;
    if (w) w.putBack();
    this.revolverPose.on = false;
    if (w) w.revolverHand = '';
    this.aiming = false;
    return k;
  }

  /** The next gadget that is on (those with a count first). */
  cycle(dir = 1) {
    const bag = this.game && this.game.bag;
    const n = GADGETS.length;
    let i = GADGETS.indexOf(this.gadget);
    if (i < 0) i = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let s = 1; s <= n; s++) {
        const k = GADGETS[(((i + s * (dir < 0 ? -1 : 1)) % n) + n) % n];
        if (!this._kindOn(k)) continue;
        if (pass === 0 && !(bag && bag.counts[k] > 0)) continue;
        return this.select(k);
      }
    }
    return this.gadget;
  }

  _ctx() {
    const g = this.game;
    if (g && typeof g._knockerCtx === 'function') return g._knockerCtx();
    return { dead: false, busy: false };
  }

  _haptic(hand, k, ms) {
    const g = this.game;
    if (g && typeof g._haptic === 'function') g._haptic(hand, k, ms);
  }

  _hapticBoth(k, ms) {
    const g = this.game;
    if (g && typeof g._hapticBoth === 'function') g._hapticBoth(k, ms);
  }

  _toast(text, s, delay = 0) {
    this._toastText = text;
    this._toastS = s;
    this._toastT = delay;
    this.stats.toasts++;
  }

  // ---- input -----------------------------------------------------------------------------------------------------------------

  input(dt, intent) {
    const g = this.game;
    const w = this._ensure();
    if (!w || !intent) return;
    const bag = g.bag;
    const ib = intent.bag;
    const vr = ib ? ib.vr : null;
    // the selection
    if (ib) {
      if (ib.gadget >= ITEM.KNOCKER) this.select(ib.gadget);
      if (ib.gadgetCycle) this.cycle(ib.gadgetCycle);
      // VR: X tapped with the bag ring open (not applying) cycles
      if (vr && vr.open && ib.cancel && !(bag.applying && bag.applying.active)) this.cycle(1);
    }
    if (!this._kindOn(this.gadget)) this.gadget = ITEM.KNOCKER;
    const k = this.gadget;
    const ctx = this._ctx();
    const count = bag.counts[k] | 0;
    this.drawable = k !== ITEM.KNOCKER && w.refusal(k, count, ctx) === '';
    if (k === ITEM.KNOCKER) return; // the knocker's own code has the input
    if (g.xrActive && vr) {
      this._inputVR(w, vr, k, count, ctx);
      return;
    }
    // desktop / touch: G (the knocker key) is this gadget's now
    const ki = intent.knocker;
    if (!ki) return;
    const pressed = ki.pressed;
    const heldKey = ki.held;
    const released = ki.released;
    ki.pressed = false;
    ki.held = false;
    ki.released = false;
    const r = g.renderer;
    if (!r || !r.camera) return;
    if (k === ITEM.SIDEARM) {
      if (pressed) this._fireView(w, bag, ctx);
      return;
    }
    if (pressed) {
      const why = w.refusal(ITEM.GRENADE, count, ctx);
      if (why) {
        w._refuse(ITEM.GRENADE, why);
      } else {
        this.aiming = true;
        this.held = 0;
      }
    }
    if (!this.aiming) return;
    if (!heldKey && !released) {
      this.aiming = false;
      this.arcN = 0;
      return;
    }
    this.held += dt;
    this._origin(r.camera, _o);
    const d = this._dir;
    throwVelocity(this.held, d.x, d.y, d.z, _v);
    const p = g.player;
    const bvx = p && isFinite(p.vx) ? p.vx : 0;
    const bvy = p && isFinite(p.vy) ? p.vy : 0;
    const bvz = p && isFinite(p.vz) ? p.vz : 0;
    if (released) {
      this.aiming = false;
      this.arcN = 0;
      if (w.tryThrow(bag, ctx, _o.x, _o.y, _o.z, _v.vx + bvx, _v.vy + bvy, _v.vz + bvz)) this.stats.throws++;
      return;
    }
    this.arcN = predictArc(g.level, _o.x, _o.y, _o.z, _v.vx + bvx, _v.vy + bvy, _v.vz + bvz, this.arc, 40, 0.05);
  }

  /** The throw / shot origin ahead of the eye (the right hand), and the view direction in this._dir. Allocation-free. */
  _origin(cam, o) {
    cam.updateWorldMatrix(true, false);
    const e = cam.matrixWorld.elements;
    const ex = e[12];
    const ey = e[13];
    const ez = e[14];
    let dx = -e[8];
    let dy = -e[9];
    let dz = -e[10];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    const d = this._dir;
    d.x = dx;
    d.y = dy;
    d.z = dz;
    d.ex = ex;
    d.ey = ey;
    d.ez = ez;
    o.x = ex + dx * 0.35 + e[0] * 0.14 - e[4] * 0.12;
    o.y = ey + dy * 0.35 + e[1] * 0.14 - e[5] * 0.12;
    o.z = ez + dz * 0.35 + e[2] * 0.14 - e[6] * 0.12;
    const lv = this.game.level;
    if (lv && typeof lv.pointInSolid === 'function' && (lv.pointInSolid(o.x, o.y, o.z) || lv.segmentBlocked(ex, ey, ez, o.x, o.y, o.z, 0))) {
      o.x = ex;
      o.y = ey;
      o.z = ez;
    }
    return o;
  }

  /** Desktop / touch: one round along the view centre (the crosshair), from the eye. */
  _fireView(w, bag, ctx) {
    const g = this.game;
    this._origin(g.renderer.camera, _o);
    const d = this._dir;
    const hit = w.fire(bag, ctx, d.ex, d.ey, d.ez, d.x, d.y, d.z, g.level, this._creature(), g.skitters || null);
    if (hit !== null) this.stats.shots++;
  }

  _creature() {
    const c = this.game && this.game.creature;
    return c && !c.isNull ? c : null;
  }

  _inputVR(w, vr, k, count, ctx) {
    const g = this.game;
    const input = g.input;
    const poseOk = !!input && typeof input.handPose === 'function';
    const HANDS = HAND_NAMES;
    if (g.knocker && g.knocker.held >= 0) return; // a knocker still in a hand (drawn before the switch): its own code lets it go
    // the bag gesture's draw / throw edges are this gadget's: the knocker's code must not see them
    const drawn = vr.drawn;
    const thrown = vr.thrown;
    const refused = vr.drawRefused;
    vr.drawn = -1;
    vr.thrown = -1;
    vr.drawRefused = false;
    if (refused) w._refuse(k, w.refusal(k, count, ctx) || 'busy');
    if (k === ITEM.GRENADE) {
      if (drawn >= 0 && poseOk) {
        const hp = input.handPose(HANDS[drawn]);
        if (w.hold(HANDS[drawn], hp.x, hp.y, hp.z, count, ctx)) this._haptic(HANDS[drawn], 0.35, 40);
      }
      if (w.held >= 0 && poseOk) {
        const hs = w.slots[w.held];
        const hp = input.handPose(hs.hand);
        w.moveHeld(hp.x, hp.y, hp.z, g.renderer && g.renderer.rig ? g.renderer.rig.rotation.y : NaN);
      }
      if (thrown >= 0 && w.held >= 0) {
        const hand = HANDS[thrown];
        const hv = input && typeof input.handVelocity === 'function' ? input.handVelocity(hand, _hv) : _hv;
        const v = vrThrowVelocity(hv.x, hv.y, hv.z, _v);
        const hs = w.slots[w.held];
        if (v.speed > 0 && w.tryThrow(g.bag, ctx, hs.x, hs.y, hs.z, v.vx, v.vy, v.vz)) {
          this.stats.throws++;
          this._haptic(hand, 0.55, 70);
        } else if (w.putBack()) {
          w._refuse(ITEM.GRENADE, 'gentle');
          this._haptic(hand, 0.15, 25);
        }
      }
      return;
    }
    // the revolver: drawn into the hand, aimed with it, the grip's release fires (one round per draw)
    const rp = this.revolverPose;
    if (drawn >= 0) {
      w.revolverHand = HANDS[drawn];
      this._haptic(HANDS[drawn], 0.3, 30);
    }
    if (w.revolverHand && poseOk) {
      const hp = input.handPose(w.revolverHand);
      rp.on = true;
      rp.x = hp.x;
      rp.y = hp.y;
      rp.z = hp.z;
      rp.qx = hp.qx;
      rp.qy = hp.qy;
      rp.qz = hp.qz;
      rp.qw = hp.qw;
    } else rp.on = false;
    if (thrown >= 0 && w.revolverHand) {
      const hand = w.revolverHand;
      w.revolverHand = '';
      rp.on = false;
      const ray = typeof input.aimRay === 'function' ? input.aimRay(hand, _ray) : null;
      if (ray) {
        const hit = w.fire(g.bag, ctx, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, g.level, this._creature(), g.skitters || null);
        if (hit !== null) {
          this.stats.shots++;
          this._haptic(hand, 1, 90);
        }
      }
    }
  }

  // ---- the run frame ----------------------------------------------------------------------------------------------------------

  /** The S5 keystone / the S7 arena (an objective of the player's section, not done, that the Mason plays a part in): a hit only staggers. */
  _scripted() {
    const g = this.game;
    const ob = g.objectives;
    if (!ob || !ob.objectives || !ob.done) return false;
    const si = g.sectionIndex | 0;
    const list = ob.objectives;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.section === si && ob.done[o.index] !== 1 && (o.verb === 'breach' || o.verb === 'survive')) return true;
    }
    return false;
  }

  step(dt) {
    const g = this.game;
    const w = this._ensure();
    if (!w) return;
    const p = g.player;
    const c = this._creature();
    if (c && typeof c.setScripted === 'function') c.setScripted(this._scripted());
    const live = g.state === 'playing' && !!p;
    if (live) w.update(dt, g.level, c, g.skitters || null, g.roaches || null, p);
    if (!live || !p.alive) {
      this.aiming = false;
      this.arcN = 0;
      w.putBack();
      w.revolverHand = '';
      this.revolverPose.on = false;
    }
    const dmg = w.takeDamage();
    const ph = g.physics;
    if (dmg > 0 && live && p.alive && ph && ph.health) {
      // the self rule: the blast's damage through the run's health; lethal is a hazard death (no Mason devour scene)
      if (ph.health.damage(dmg, 'blast', 0)) ph.kill(p, g.tethers, 'hazard');
    }
  }

  // ---- the frame's views ------------------------------------------------------------------------------------------------------

  update(dt) {
    const g = this.game;
    if (!g) return;
    if (!this._sfx && g.audio) this._sfx = registerWeaponSfx(g.audio) || g.audio.registerSfx === undefined;
    if (!this.view && !this._viewTried && g.renderer && g.renderer.scene && g.modules && g.modules.weaponView) {
      this._viewTried = true;
      try {
        this.view = new g.modules.weaponView.WeaponView(g);
      } catch (err) {
        if (typeof g._fault === 'function') g._fault('weaponView', err);
        this.view = null;
      }
    }
    if (this.view) this.view.update(dt, g);
    // the grenade's aim arc: the knocker view's line (the knocker is not aiming while the gadget is a grenade)
    const kv = g.knockerView;
    if (kv && this.aiming && this.arcN > 1 && !g.xrActive && g.state === 'playing') kv.setArc(this.arc, this.arcN);
    if (this._toastT >= 0) {
      this._toastT -= dt;
      if (this._toastT < 0 && typeof g._toast === 'function') g._toast(this._toastText, this._toastS);
    }
  }

  // ---- the bus ----------------------------------------------------------------------------------------------------------------

  _onPick(e) {
    if (!e || (e.kind !== ITEM.GRENADE && e.kind !== ITEM.SIDEARM)) return;
    const g = this.game;
    const bag = g && g.bag;
    // a weapon picked up while the gadget has nothing left: it becomes the gadget
    if (bag && !(bag.counts[this.gadget] > 0)) this.select(e.kind);
    if (this.firstPick[e.kind]) {
      this.firstPick[e.kind] = false;
      this._toast(WEAPON_LORE[e.kind], 4.2, 0.05); // (after the game's own '... taken')
    } else if (e.kind === ITEM.SIDEARM) this._toast(`Rounds taken: ${bag ? bag.counts[ITEM.SIDEARM] : 0} in the cylinder`, 1.8, 0.05);
  }

  _onFire(e) {
    const g = this.game;
    if (g && g.flow) g.flow.flare = Math.max(g.flow.flare || 0, 1); // the muzzle flash: the lantern flares (x1.5) and fades in ~0.4 s
    if (!this.view || !e) return;
    this.view.burst('muzzle', e.x + e.dx * 0.45, e.y + e.dy * 0.45, e.z + e.dz * 0.45, 1);
    if (e.hit === 'wall') this.view.burst('wall', e.hx - e.dx * 0.05, e.hy - e.dy * 0.05, e.hz - e.dz * 0.05, 1);
    if (!g.xrActive) this._hapticBoth(0.6, 60);
  }

  _onDry() {
    const g = this.game;
    if (g && g.realTime - this._emptyT > 3) {
      this._emptyT = g.realTime;
      this._toast('Out of rounds', 1.4);
    }
  }

  _onBlast(e) {
    const g = this.game;
    if (!e || !g) return;
    if (this.view) this.view.burst('blast', e.x, e.y, e.z, 1);
    const p = g.player;
    if (!p) return;
    const d = Math.sqrt((p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y) + (p.z - e.z) * (p.z - e.z));
    if (d < 18) {
      if (g.flow) g.flow.flare = Math.max(g.flow.flare || 0, 1 - d / 18); // the flash lights your lantern's pool
      this._hapticBoth(0.9 * (1 - d / 18) + 0.1, 120);
    }
  }

  _onRefuse(e) {
    if (!e) return;
    const g = this.game;
    if (e.reason === 'empty' && e.kind === ITEM.GRENADE && g && g.realTime - this._emptyT > 3) {
      this._emptyT = g.realTime;
      this._toast('No grenade left', 1.4);
    }
  }

  /** The VR ring's hint: the gadget the pull-up draws ('KNOCKER' | 'GRENADE' | 'REVOLVER'). */
  get gadgetName() {
    return GADGET_NAME[this.gadget] || 'KNOCKER';
  }

  /** Read-out for AT3D.debug (allocates). */
  debugState() {
    const w = this.sim;
    const bag = this.game && this.game.bag;
    return Object.assign(w ? w.debugState() : {}, {
      on: this.on(),
      gadget: this.gadgetName,
      drawable: this.drawable,
      aiming: this.aiming,
      grenades: bag ? bag.counts[ITEM.GRENADE] : 0,
      rounds: bag ? bag.counts[ITEM.SIDEARM] : 0,
      glue: Object.assign({}, this.stats),
      live: w ? w.slots.filter((s) => s.state === GSTATE.FLIGHT || s.state === GSTATE.REST).length : 0,
      view: this.view ? Object.assign({}, this.view.stats) : null,
      creature: this._creature() ? { frightened: this._creature().frightened, wounds: this._creature().wounds, scripted: this._creature().scriptedNow, stats: { hurts: this._creature().stats.hurts, frights: this._creature().stats.frights, staggers: this._creature().stats.staggers } } : null,
    });
  }

  /**
   * AT3D.debug.weapons helpers (tests, QA, captures): give(grenades, rounds), select(kind), throw({charge, dx, dy, dz, x, y, z, vx, vy,
   * vz, free}), fire({dx, dy, dz, free}), blast(x, y, z) (a grenade going off there now), state().
   */
  debugApi() {
    const g = this.game;
    return {
      state: () => this.debugState(),
      give: (grenades = 3, rounds = 12) => {
        if (!g.bag) return null;
        g.bag.seed(ITEM.GRENADE, grenades);
        g.bag.seed(ITEM.SIDEARM, rounds);
        return [g.bag.counts[ITEM.GRENADE], g.bag.counts[ITEM.SIDEARM]];
      },
      select: (k) => this.select(typeof k === 'string' ? { knocker: 4, grenade: 5, revolver: 6 }[k] : k),
      throw: (a = {}) => {
        const w = this._ensure();
        if (!w || !g.renderer || !g.renderer.camera) return false;
        this._origin(g.renderer.camera, _o);
        const d = this._dir;
        throwVelocity(0.12 + (isFinite(a.charge) ? a.charge : 0.5) * 0.88, isFinite(a.dx) ? a.dx : d.x, isFinite(a.dy) ? a.dy : d.y, isFinite(a.dz) ? a.dz : d.z, _v);
        w.cooldown = 0;
        return w.tryThrow(a.free ? null : g.bag, this._ctx(), isFinite(a.x) ? a.x : _o.x, isFinite(a.y) ? a.y : _o.y, isFinite(a.z) ? a.z : _o.z, isFinite(a.vx) ? a.vx : _v.vx, isFinite(a.vy) ? a.vy : _v.vy, isFinite(a.vz) ? a.vz : _v.vz);
      },
      fire: (a = {}) => {
        const w = this._ensure();
        if (!w || !g.renderer || !g.renderer.camera) return null;
        this._origin(g.renderer.camera, _o);
        const d = this._dir;
        w.fireCooldown = 0;
        return w.fire(a.free ? null : g.bag, this._ctx(), d.ex, d.ey, d.ez, isFinite(a.dx) ? a.dx : d.x, isFinite(a.dy) ? a.dy : d.y, isFinite(a.dz) ? a.dz : d.z, g.level, this._creature(), g.skitters || null);
      },
      blast: (x, y, z) => {
        const w = this._ensure();
        if (!w) return false;
        w.cooldown = 0;
        if (!w.tryThrow(null, this._ctx(), x, y, z, 0, 0, 0)) return false;
        for (const s of w.slots) {
          if (s.state === GSTATE.FLIGHT) {
            s.state = GSTATE.REST;
            s.fuse = 1e-6;
          }
        }
        return true;
      },
      numbers: () => WEAPONS,
    };
  }
}
