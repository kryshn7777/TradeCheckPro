/* ABYSSAL TETHER 3D — auxShadow.js
 * The SECOND real-time shadow, `renderer.lanternShadow.aux` (see auxShadowLogic.js for the idea): one cone-shaped depth map from one pooled light
 * besides the carried lantern, sampled by atAuxShadow() in the lit-surface shaders (materials.js).
 *
 *   creature mode  the Mason's glow (one of the two pooled-lamp slots, taken over by renderer3d while it hunts, decay 1.9) casts: the map holds the
 *                  level's boxes near the lantern (the lantern shadow's static proxy pack, back faces) and the moving things (the dynamic layer; the
 *                  creature's own stand-in is left out, the light hangs on it). The receivers multiply that pooled light only.
 *   lamp mode      the nearest pooled lamp (decay 2): the level's shadows from it are baked, so the map holds only the moving things (body, hands, rope,
 *                  dropped props, the creature). Lightmapped fragments multiply the baked lamp term by it, other fragments the matching pooled light.
 * One map (512^2 quest / 1024^2 high), re-rendered every 2nd frame on Quest, aimed from the light at the player; off on the low tier and from governor
 * level 2. It owns no scene objects: the casters are the ones renderer.lanternShadow already flagged (layers 5 / 6).
 *
 *   .plan  .light {kind,slot,x,y,z,range}  .k (eased 0..1)  .ready  .stats {kind, calls, tris, renders, size}
 *   .setEnabled(bool)   .update(dt, game, govLevel, settings)   .render(frame)   .free()   .dispose()
 */
import * as THREE from 'three';
import { LSHADOW } from './materials.js';
import { SHADOW_LAYER_DYNAMIC, SHADOW_LAYER_STATIC } from './lanternShadowLogic.js';
import { aimShadowCamera, makeTarget, shadowCamera } from './shadowTargets.js';
import { auxAim, auxDue, auxFit, auxPlan, pickAuxLight } from './auxShadowLogic.js';

const LAMP_STRENGTH = 0.75; // a lamp's shadow never goes fully black: the baked lamp term of a lightmapped fragment may hold other lamps too
const AXIS_RATE = 6; // 1/s

export class AuxShadow {
  /** @param {object} ls the LanternShadow (its passes, materials and caster lists are shared) */
  constructor(ls) {
    this.ls = ls;
    this.r3d = ls.r3d;
    this.plan = auxPlan('low');
    this.light = null;
    this.k = 0;
    this.ready = false;
    this._apiOn = true;
    this._rt = null;
    this._size = 0;
    this._cam = shadowCamera('AuxShadowCamera');
    this._mat = new THREE.Matrix4();
    this._axis = { x: 0, y: -1, z: 0 };
    this._axisInit = false;
    this._aim = {};
    this._fit = {};
    this._target = { x: 0, y: 0, z: 0 };
    this._cands = [];
    this._pool = [{}, {}, {}, {}];
    this._prev = null;
    this._frame = 0;
    this._offT = 0;
    this._dt = 1 / 72;
    this._texel = 0.006;
    this.stats = { kind: 'none', enabled: false, calls: 0, tris: 0, renders: 0, size: 0, strength: 0 };
  }

  setEnabled(on) {
    this._apiOn = on !== false;
    return this._apiOn;
  }

  /** True when a creature light may be used (the map exists to shadow it): the renderer asks before it lights the stone with the glow. */
  canLight() {
    return this.plan.enabled && !!this.ls._level;
  }

  lost() {
    this.ready = false;
    this._rt = null;
    this._size = 0;
  }

  /** Chooses the light and eases the strength (cheap; the pass is in render()). */
  update(dt, game, govLevel, settings) {
    const ls = this.ls;
    const r3d = this.r3d;
    this._dt = dt > 0 ? dt : this._dt;
    const tier = ls.tier;
    this.plan = auxPlan(tier, { govLevel, reduced: !!(settings && settings.reducedEffects), enabled: this._apiOn && ls.plan.enabled });
    const plan = this.plan;
    // the candidates: the pooled-lamp slots that carry a lit source (a lamp, or the creature's glow)
    const cands = this._cands;
    cands.length = 0;
    const slots = r3d.envLights || [];
    for (let i = 0; i < slots.length && i < this._pool.length; i++) {
      const e = slots[i];
      if (!e.src || !(e.level > 0.05) || !(e.light.intensity > 0.001)) continue;
      const c = this._pool[i];
      c.kind = e.src.creature ? 'creature' : 'lamp';
      c.slot = i;
      c.x = e.light.position.x;
      c.y = e.light.position.y;
      c.z = e.light.position.z;
      c.range = e.src.range;
      c.level = e.level;
      cands.push(c);
    }
    const head = r3d._head;
    const idx = plan.enabled && ls._level && head ? pickAuxLight(cands, head, this._prev, plan.maxLampRange) : -1;
    const want = idx >= 0 ? cands[idx] : null;
    let target = 0;
    if (want) {
      const L = this.light;
      if (L && L.kind === want.kind && L.slot === want.slot) {
        L.x = want.x;
        L.y = want.y;
        L.z = want.z;
        L.range = want.range;
        target = Math.min(1, want.level);
        this._prev = L;
      } else if (this.k < 0.04) {
        // the old light has faded out: take the new one (a fresh map is rendered before it shows)
        this.light = { kind: want.kind, slot: want.slot, x: want.x, y: want.y, z: want.z, range: want.range };
        this._prev = this.light;
        this.ready = false;
        this._axisInit = false;
        this._useDummy();
      }
    } else this._prev = null;
    this.k += (target - this.k) * Math.min(1, this._dt * (target > this.k ? 5 : 7));
    if (target === 0 && this.k < 0.004) {
      this.k = 0;
      this._offT += this._dt;
      if (this._offT > 6) this.free();
    } else this._offT = 0;
    this.stats.enabled = plan.enabled;
    this.stats.kind = this.light && this.k > 0.004 ? this.light.kind : 'none';
    this.stats.strength = this.k;
  }

  _useDummy() {
    const d = this.ls._dummy;
    if (d && !this.ready) LSHADOW.uLPMap.value = d.depthTexture;
  }

  /** The passes for this frame (called by LanternShadow.render(); `frame` = null switches the receivers off). */
  render(frame) {
    const st = this.stats;
    st.calls = st.tris = 0;
    const u = LSHADOW.uLPK.value;
    const L = this.light;
    const ls = this.ls;
    const plan = this.plan;
    if (frame === null || !plan.enabled || !L || this.k < 0.004 || !ls._level) {
      u.x = 0;
      return;
    }
    const r3d = this.r3d;
    if (!this._rt || this._size !== plan.size) {
      if (this._rt) this._rt.dispose();
      this._rt = makeTarget(plan.size, 'auxShadow');
      this._size = plan.size;
      this.ready = false;
      this._useDummy();
    }
    const creature = L.kind === 'creature';
    if (auxDue(this._frame, plan) || !this.ready) {
      // aimed from the light at the player's torso
      const head = r3d._head;
      const tgt = this._target;
      tgt.x = head.x;
      tgt.y = head.y - 0.55;
      tgt.z = head.z;
      auxAim(L, tgt, this._axis, this._axisInit ? 1 - Math.exp(-AXIS_RATE * this._dt) : 1, this._aim);
      this._axisInit = true;
      auxFit(plan, creature ? L.range + 1 : L.range, this._fit);
      const A = this._aim;
      const cam = this._cam;
      aimShadowCamera(cam, L.x, L.y, L.z, A.ax, A.ay, A.az, this._fit, this._mat);
      let calls = 0;
      let tris = 0;
      if (creature && ls._proxy && ls._proxy.count > 0) {
        // the level's boxes near the lantern (the lantern shadow's pack) + the flagged stone decor: back faces, like the lantern's static map
        cam.layers.set(SHADOW_LAYER_STATIC);
        ls._pass(this._rt, cam, ls._matStatic, true);
        calls += ls._lastCalls;
        tris += ls._lastTris;
        cam.layers.set(SHADOW_LAYER_DYNAMIC);
        ls._dynPass(this._rt, cam, 'creature', false);
      } else {
        cam.layers.set(SHADOW_LAYER_DYNAMIC);
        ls._dynPass(this._rt, cam, creature ? 'creature' : null, true);
      }
      calls += ls._lastCalls;
      tris += ls._lastTris;
      st.calls = calls;
      st.tris = tris;
      st.renders++;
      st.size = plan.size;
      this._texel = this._fit.texel;
      LSHADOW.uLPMap.value = this._rt.depthTexture;
      LSHADOW.uLPM.value.copy(this._mat);
      this.ready = true;
    }
    u.x = this.ready ? this.k * (creature ? 1 : LAMP_STRENGTH) : 0;
    u.y = this._texel || 0.006;
    u.z = Math.max(4, creature ? L.range : Math.min(L.range, plan.maxLampRange));
    u.w = creature ? 1 : 0;
    LSHADOW.uLPPos.value.set(L.x, L.y, L.z);
    this._frame++;
  }

  free() {
    if (this._rt) this._rt.dispose();
    this._rt = null;
    this._size = 0;
    this.ready = false;
    this.light = null;
    this._prev = null;
    this.k = 0;
    LSHADOW.uLPK.value.x = 0;
    this._useDummy();
  }

  dispose() {
    this.free();
    LSHADOW.uLPMap.value = null;
  }
}
