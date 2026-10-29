/* ABYSSAL TETHER 3D — holdfast3d.js
 * THE HOLDFAST: the wall you climb holds your hand. A climb patch whose studs are knuckles: a grey-pink stone-flesh hand and
 * forearm in a torn socket of masonry. Grab it and, half a second later, it closes over your gauntlet, locks your hand and
 * drags it into the wall while the controller squeezes. The Lanternwrights' dead are the building; this is one of them asking
 * to be held (docs/abyssal-tether-3d/plans/FUTURE_STORY_PLAN.md section 4 item 1, CREATURE_PACING.md).
 *
 * Sites are DATA: section.creature.holdfast = { sites: [{ id, zone, at, y, mode? }] } (level-data-3d.js), an overlay on an
 * existing climb zone (`zone` = its id; `at` = the coordinate along the wall: z on a west / east wall, x on a north / south one;
 * `y` = the height of the patch's centre). Nothing in the level geometry, the decor, the lightmaps or the anchors moves: the
 * patch is HOLDFAST_TUNING.hu x hv on the zone's face. resolveHoldfastSites(level) checks the fairness rules and drops a site
 * that breaks one (`rejected`, with the reason):
 *   - at most 1 hold in 4: a zone's stud cells / 4 patches (the rest of the zone stays a plain climb), patches >= 2 m apart;
 *   - never the only route: only authored climb zones (never a way round a swing or a drop: the route bots ignore them);
 *   - never in Chapter I's tutorial: not in S1 and never on the first two climb patches the player meets (the descent order);
 *   - never on an objective's critical path: >= minObjective m from every objective fixture, haul / hook ring, keystone and rest.
 *
 * States (one machine per site; at most one hand held at a time):
 *   DORMANT   looks like studs, subtly wrong (no chalk, a wet sheen: the view);
 *   AWARE     a hand within awareRange (1.2 m): a wet inhale, the fingers stir; within breathRange (0.3 m) a wet breath;
 *   GRIP      a hand holds the patch: closeDelay (0.5 s) to let go before it closes;
 *   CLOSE     the hand is LOCKED (Climb3D.pin) for lock s (2.0 / 2.5 / 3.0 Normal / Nightmare / Abyss; x lowLock when hp is LOW,
 *             <= 35 %: it squeezes harder and longer, the Mason's gate), the hold is drawn toward the wall at pull m/s, the
 *             haptic squeeze beats (bus 'holdfast:squeeze'). Ends by:
 *               tear     a real arm pull (VR: the hand >= tearSpeed m/s away from the wall for tearTime s; desktop: Back + Jump,
 *                        or the grip let go of for deskLetGo s): -tearHp hp, -tearGrip grip stamina; the hand is torn out of the
 *                        wall and dies (RUINED, for the rest of the run);
 *               outpull  any loaded rope reeled in for ropeTime s: the line rips the hand free (no cost; it lives);
 *               shot     a grapple shot whose aim ray crosses the forearm: STAGGER, it lets go (no cost);
 *               crush    waited out: the lock ends at -crushHp (a crushed hand);
 *             never lethal ALONE: its damage never takes the hp below hpFloor (other damage on top of it can kill).
 *   RELEASE   opens, the fingers trembling; RETRACT slides back into the wall; cooldown s before it can close again;
 *   STAGGER   a shot: recoils and retracts; a shot at a DORMANT / AWARE patch makes it flinch (retracts: safe for flinchCd s);
 *   RUINED    torn out: a dead hand hanging from the socket, broken fingers; never closes again until a new run / respawn;
 *   ANSWER    mode 'answer' (S4, the Listening Vault: "knock and a hand answers"): a hand on the patch (or a knock on it) is
 *             answered by three knocks inside the wall and the hand comes out OPEN, palm up, then goes back. Never locks.
 *
 * Pure and deterministic: no three.js, no DOM, no Math.random, no clock but the dt it is stepped with, no allocation per frame
 * (the rare event payloads allocate). Runs in Node (tools/abyssal-tether-3d/tests/creature/holdfast.mjs).
 *
 * Per frame (game.js, after the physics steps): setHp(hp), setHands(vr, left, right) (the palms relative to the body, as the
 * climb intent has them), setInput(jump, back, grabL, grabR, reeling), update(dt, player); takeDamage() -> hp to take (cause
 * 'holdfast', already floored). Bus 'rope:shot' {ox,oy,oz, dx,dy,dz, range} is read for the shot.
 * Bus events (x, y, z = the site): 'holdfast:aware', 'holdfast:inhale', 'holdfast:breath' {hand}, 'holdfast:twitch',
 * 'holdfast:grip' {hand}, 'holdfast:close' {hand, low, lock}, 'holdfast:squeeze' {hand, strength, low, beat},
 * 'holdfast:release' {hand, reason: 'tear'|'crush'|'outpull'|'shot'|'lost'}, 'holdfast:tear', 'holdfast:crush', 'holdfast:outpull',
 * 'holdfast:stagger', 'holdfast:flinch', 'holdfast:retract', 'holdfast:knock' {n}, 'holdfast:answer'.
 * Output for the view (render/holdfastView.js): sites[i] (see makeSite: x,y,z, n, u, v, state, aware, close, squeeze, out,
 * tremble, pulse, tx,ty,tz = where its palm goes).
 */

import { CONFIG } from './config3d.js';

export const HOLDFAST_STATES = Object.freeze({
  DORMANT: 'DORMANT',
  AWARE: 'AWARE',
  GRIP: 'GRIP',
  CLOSE: 'CLOSE',
  RELEASE: 'RELEASE',
  RETRACT: 'RETRACT',
  STAGGER: 'STAGGER',
  RUINED: 'RUINED',
  ANSWER: 'ANSWER',
});
const S = HOLDFAST_STATES;

/** Tuning (metres, seconds, hp as a fraction of full). Per difficulty: HOLDFAST_DIFF. */
export const HOLDFAST_TUNING = {
  hu: 0.28, // the patch: half width along the wall (0.56 x 0.60 m: about one stud of render/climbView.js, and within the
  hv: 0.3, // reach of its forearm out of the socket at the centre, so that wherever you hold it, it closes on your hand)
  quarter: 0.25, // at most 1 hold in 4: a zone's stud cells (render/climbView.js, 0.8 x 0.9 m) / 4 patches, at least 1 cell each
  cellU: 0.8,
  cellV: 0.9,
  spacing: 2.0, // m between two patches on one zone
  minObjective: 3, // m from every objective fixture / ring / keystone / rest
  firstZones: 2, // the first N climb zones of the descent never hold one
  awareRange: 1.2, // a hand this close to the patch's centre: AWARE
  awareExit: 1.6, // ... until every hand is farther than this
  breathRange: 0.3, // the wet breath once a hand is this close
  breathGap: 4, // s between breaths
  inhaleGap: 6, // s between inhales (the AWARE entry)
  deskReach: 0.45, // desktop: the body stands about this far off the hold (added to the ranges)
  closeDelay: 0.5, // s on the hold before it closes (a hand let go of sooner is free)
  pull: 0.3, // m/s: the hold is drawn toward the wall ...
  pullTo: 0.04, // ... until it is this far off the face
  deskPull: 0.06, // m: desktop, the cling is drawn this much closer to the wall
  lowAt: CONFIG.health.lowEnter, // hp at or below this is LOW (the Mason's gate): it squeezes harder and longer
  lowLock: 1.3, // x the lock while LOW
  lowSqueeze: 1.5, // x the squeeze strength while LOW
  beat: 0.62, // s between squeeze beats (LOW: lowBeat)
  lowBeat: 0.46,
  tearSpeed: 1.2, // m/s: a real arm pull, the hand away from the wall (within 60 degrees of the wall's normal) ...
  tearCos: 0.5,
  tearTime: 0.15, // ... held this long (accumulated; decays at twice the rate below the speed)
  tearHp: 0.1, // a tear costs this much health ...
  tearGrip: 0.3, // ... and this much grip stamina
  deskLetGo: 0.4, // s: desktop, the grip (F) let go of this long tears free (the same cost)
  ropeTime: 1.0, // s of reeling a loaded rope: the line out-pulls it
  crushHp: 0.15, // waited out: the crushed hand
  hpFloor: 0.05, // never lethal alone: its damage stops here
  releaseTime: 0.9, // s opening (trembling)
  retractTime: 1.2, // s back into the wall
  staggerTime: 1.4,
  cooldown: 6, // s after it let go before it can close again
  flinchCd: 10, // s after a shot at a dormant patch
  answerTime: 3.4, // s of the answer (knocks, the open hand, back in)
  answerCd: 20,
  knockSpeed: 0.8, // m/s toward the wall: a knock on the patch (VR)
  shotRadius: 0.1, // the forearm for a grapple shot (+ shotPad)
  shotPad: 0.12,
  patchShot: 0.35, // the radius of a dormant patch for a shot (its knuckles)
  armIn: 0.03, // m: the socket's mouth in front of the face (where the forearm leaves the wall)
  twitchGap: [1.6, 3.4], // s between knuckle cracks while AWARE
};
const T = HOLDFAST_TUNING;

/** Per difficulty: `lock` = s the hand is held before the crush. */
export const HOLDFAST_DIFF = {
  normal: { lock: 2.0 },
  nightmare: { lock: 2.5 },
  abyss: { lock: 3.0 },
};

/** `?holdfast=off|on` (game.js); `?hunt=always` (the e2e and the capture tools) leaves it out unless holdfast=on asks for it. */
export function holdfastMode(search) {
  const q = typeof search === 'string' ? search : '';
  const m = /[?&]holdfast=(off|on)\b/.exec(q);
  if (m) return m[1];
  return /[?&]hunt=always\b/.test(q) ? 'off' : 'on';
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function hash01(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** The face frame of a climb zone: n (out of the wall), u (along it: z on x-walls, x otherwise), v (up; z under a slab). */
function zoneFrame(z) {
  if (!z || z.ax < 0) return null;
  if (z.ax === 1) return { nx: 0, ny: z.ny, nz: 0, ux: 1, uy: 0, uz: 0, vx: 0, vy: 0, vz: 1 };
  if (z.ax === 0) return { nx: z.nx, ny: 0, nz: 0, ux: 0, uy: 0, uz: 1, vx: 0, vy: 1, vz: 0 };
  return { nx: 0, ny: 0, nz: z.nz, ux: 1, uy: 0, uz: 0, vx: 0, vy: 1, vz: 0 };
}

/** The zone's face extent along u and v (metres): [uLo, uHi, vLo, vHi]. */
function faceExtent(z) {
  if (z.ax === 1) return [z.minX, z.maxX, z.minZ, z.maxZ];
  if (z.ax === 0) return [z.minZ, z.maxZ, z.minY, z.maxY];
  return [z.minX, z.maxX, z.minY, z.maxY];
}

function boxDist(b, x, y, z) {
  const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
  const dy = y < b.minY ? b.minY - y : y > b.maxY ? y - b.maxY : 0;
  const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Points / boxes of every objective a site must keep clear of (fixtures, their rings and solids, the rests). */
function objectivePoints(level) {
  const d = (level && level.data) || {};
  const byId = (level && level.byId) || {};
  const pts = [];
  const boxes = [];
  for (const f of Array.isArray(d.fixtures) ? d.fixtures : []) {
    if (isFinite(f.x) && isFinite(f.y) && isFinite(f.z)) pts.push({ id: f.id, x: f.x, y: f.y, z: f.z });
    const a = f.anchorId && byId[f.anchorId];
    if (a && isFinite(a.x)) pts.push({ id: f.anchorId, x: a.x, y: a.y, z: a.z });
    const s = f.solidId && byId[f.solidId];
    if (s && isFinite(s.minX)) boxes.push({ id: f.solidId, minX: s.minX, maxX: s.maxX, minY: s.minY, maxY: s.maxY, minZ: s.minZ, maxZ: s.maxZ });
    if (f.box && f.kind !== 'survive') boxes.push(Object.assign({ id: f.id }, f.box)); // (the S7 survive arena is the whole nave)
  }
  for (const n of Array.isArray(d.nooks) ? d.nooks : []) if (n.box) boxes.push(Object.assign({ id: n.id }, n.box));
  return { pts, boxes };
}

/**
 * The Holdfast sites of a level (all sections), resolved on their climb zones and checked against the fairness rules.
 * Returns { sites: [{ id, zone, zoneId, section, mode, x,y,z (the patch's centre on the face), nx..vz, hu, hv }], rejected:
 * [{ id, reason }] }. Deterministic; the order is the data's (section by section).
 */
export function resolveHoldfastSites(level) {
  const out = { sites: [], rejected: [] };
  if (!level || !Array.isArray(level.sections) || !Array.isArray(level.climb)) return out;
  // the descent order of the climb zones (top first): the first T.firstZones are the tutorial's
  const order = level.climb.slice().sort((a, b) => b.maxY - a.maxY || (a.id < b.id ? -1 : 1));
  const firstIds = new Set(order.slice(0, T.firstZones).map((z) => z.id));
  const obj = objectivePoints(level);
  const used = new Map(); // zone id -> patch area used
  for (const sec of level.sections) {
    const cfg = sec && sec.creature && sec.creature.holdfast;
    const list = cfg && Array.isArray(cfg.sites) ? cfg.sites : [];
    for (const raw of list) {
      const id = typeof raw.id === 'string' ? raw.id : `hf-${sec.id}-${out.sites.length}`;
      const z = level.climb.find((c) => c.id === raw.zone);
      const fr = z ? zoneFrame(z) : null;
      const reject = (reason) => out.rejected.push({ id, reason });
      if (!z) {
        reject('no such climb zone');
        continue;
      }
      if (!fr) {
        reject('not a wall (a chain)');
        continue;
      }
      if (sec.index === 0 || z.section === 0 || firstIds.has(z.id)) {
        reject('the tutorial: S1 / the first climb patches');
        continue;
      }
      const [uLo, uHi, vLo, vHi] = faceExtent(z);
      const a = num(raw.at, NaN);
      const b = num(raw.y, NaN);
      const bb = z.ax === 1 ? num(raw.at2, NaN) : b; // under a slab: `at` = x, `at2` = z
      if (!isFinite(a) || !isFinite(bb)) {
        reject('no position');
        continue;
      }
      if (a - T.hu < uLo - 1e-6 || a + T.hu > uHi + 1e-6 || bb - T.hv < vLo - 1e-6 || bb + T.hv > vHi + 1e-6) {
        reject('the patch is not inside its zone');
        continue;
      }
      // 1 hold in 4: the zone's stud cells (as render/climbView.js lays them) / 4 patches
      const cells = Math.max(1, Math.floor((uHi - uLo) / T.cellU)) * Math.max(1, Math.floor((vHi - vLo) / T.cellV));
      const patchCells = Math.max(1, Math.ceil((4 * T.hu * T.hv) / (T.cellU * T.cellV) - 1e-9));
      const patch = patchCells + (used.get(z.id) || 0);
      if (patch > Math.floor(cells * T.quarter + 1e-9)) {
        reject('more than 1 hold in 4 of its zone');
        continue;
      }
      // the centre of the patch on the face
      const x = z.ax === 0 ? z.face : a;
      const y = z.ax === 1 ? z.face : bb;
      const zz = z.ax === 0 ? a : z.ax === 2 ? z.face : bb;
      if (out.sites.some((o) => o.zone === z && Math.hypot(o.x - x, o.y - y, o.z - zz) < T.spacing)) {
        reject('too close to another patch on its zone');
        continue;
      }
      let near = null;
      for (const p of obj.pts) if (Math.hypot(p.x - x, p.y - y, p.z - zz) < T.minObjective) near = p.id;
      for (const q of obj.boxes) if (boxDist(q, x, y, zz) < T.minObjective) near = q.id;
      if (near) {
        reject(`too close to the objective ${near}`);
        continue;
      }
      used.set(z.id, patch);
      out.sites.push(
        Object.assign(
          {
            id,
            zone: z,
            zoneId: z.id,
            section: z.section,
            mode: raw.mode === 'answer' ? 'answer' : 'grip',
            x,
            y,
            z: zz,
            hu: T.hu,
            hv: T.hv,
            seed: strHash(id),
          },
          fr,
        ),
      );
    }
  }
  return out;
}

/** True when the point lies on the site's patch (its u / v extent; the depth is the zone's). */
export function onPatch(s, x, y, z) {
  const dx = x - s.x;
  const dy = y - s.y;
  const dz = z - s.z;
  return Math.abs(dx * s.ux + dy * s.uy + dz * s.uz) <= s.hu && Math.abs(dx * s.vx + dy * s.vy + dz * s.vz) <= s.hv;
}

function makeSite(r) {
  return Object.assign(r, {
    state: S.DORMANT,
    t: 0, // s in the state
    cd: 0, // cooldown (s) before it can close / answer again
    hand: null, // the hand on it / held
    onT: 0,
    lockT: 0,
    lockDur: 0,
    low: false,
    beatT: 0,
    beats: 0,
    tearT: 0,
    letGoT: 0,
    ropeT: 0,
    inhaleCd: 0,
    breathCd: 0,
    twitchT: 0,
    twitches: 0,
    knocks: 0,
    farT: 0,
    dist: 1e9, // nearest hand (m)
    // presentation (0..1 unless said)
    aware: 0,
    close: 0,
    squeeze: 0,
    out: 0, // m the forearm is out of the wall (negative: sunk, the knuckles gone)
    tremble: 0,
    pulse: 0, // the heartbeat in the veins
    pulled: 0, // m the hold has been drawn in
    tx: 0, // where its palm goes (the held hand's hold, the reaching hand clamped to the patch, or the centre)
    ty: 0,
    tz: 0,
  });
}

export class Holdfast3D {
  /**
   * @param {Level3D} level
   * @param {object} diff     DIFFICULTY preset (diff.levelVariant / diff.key pick HOLDFAST_DIFF)
   * @param {EventBus|null} bus
   * @param {object} [opts]   { climb: Climb3D (physics.climb), tethers: TetherSystem }
   */
  constructor(level, diff, bus, opts) {
    const o = opts || {};
    this.level = level || null;
    this.diff = diff || {};
    this.bus = bus || null;
    this.climb = o.climb || null;
    this.tethers = o.tethers || null;
    const key = (this.diff && (this.diff.key || this.diff.levelVariant)) || 'normal';
    this.tuneKey = HOLDFAST_DIFF[key] ? key : 'normal';
    this.lock = HOLDFAST_DIFF[this.tuneKey].lock;
    const res = resolveHoldfastSites(level);
    this.rejected = res.rejected;
    this.sites = res.sites.map(makeSite);
    this.enabled = this.sites.length > 0;
    this.hp = 1;
    this.vr = false;
    this._h = { left: { ok: false, rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, seen: false }, right: { ok: false, rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, seen: false } };
    this._in = { jump: false, back: false, grabL: false, grabR: false, reeling: false };
    this._dmg = 0;
    this.held = null; // the site holding a hand (or null)
    this.heldHand = null;
    this.stats = { closes: 0, tears: 0, crushes: 0, outpulls: 0, staggers: 0, flinches: 0, answers: 0, damage: 0, maxLock: 0 };
    this.t = 0;
    this._p = null;
    this._offs = [];
    if (this.bus && typeof this.bus.on === 'function') this._offs.push(this.bus.on('rope:shot', (p) => this._onShot(p)));
    this.reset(null);
  }

  destroy() {
    for (const off of this._offs) if (typeof off === 'function') off();
    this._offs.length = 0;
    this._letGoAll(null);
  }

  /** A new run: every site dormant, none ruined, nothing held. */
  reset(player) {
    this._letGoAll(player);
    for (const s of this.sites) {
      s.state = S.DORMANT;
      s.t = s.cd = s.onT = s.lockT = s.lockDur = s.beatT = s.tearT = s.letGoT = s.ropeT = 0;
      s.beats = s.twitches = s.knocks = 0;
      s.inhaleCd = s.breathCd = s.farT = 0;
      s.twitchT = T.twitchGap[0] + hash01(s.seed) * (T.twitchGap[1] - T.twitchGap[0]);
      s.hand = null;
      s.low = false;
      s.aware = s.close = s.squeeze = s.out = s.tremble = s.pulled = 0;
      s.tx = s.x;
      s.ty = s.y;
      s.tz = s.z;
      s.dist = 1e9;
    }
    this._dmg = 0;
    this.t = 0;
  }

  /** A respawn / checkpoint warp: the same as a new run (the level resets too). */
  onRespawn(player) {
    this.reset(player);
  }

  /** Sections need no setup (the sites are all known); kept for the creature API. */
  setSection() {}

  setHp(hp) {
    this.hp = num(hp, 1);
  }

  /** The palms relative to the body (the climb intent's rx / ry / rz), every frame; `vr` false = the desktop / touch cling. */
  setHands(vr, left, right) {
    this.vr = !!vr;
    for (let k = 0; k < 2; k++) {
      const a = k === 0 ? left : right;
      const h = this._h[k === 0 ? 'left' : 'right'];
      h.ok = !!(a && a.ok && isFinite(a.rx) && isFinite(a.ry) && isFinite(a.rz));
      if (h.ok) {
        h.rx = a.rx;
        h.ry = a.ry;
        h.rz = a.rz;
      } else {
        h.seen = false;
      }
    }
  }

  /** The frame's raw input: jump pressed, Back held (desktop), the grip of each hand, any loaded rope being reeled in. */
  setInput(jump, back, grabL, grabR, reeling) {
    const i = this._in;
    i.jump = !!jump;
    i.back = !!back;
    i.grabL = !!grabL;
    i.grabR = !!grabR;
    i.reeling = !!reeling;
  }

  /** The hp to take this frame (cause 'holdfast'); already floored so that it alone never kills. */
  takeDamage() {
    const d = this._dmg;
    this._dmg = 0;
    return d;
  }

  _emit(type, s, extra) {
    if (!this.bus) return;
    const p = { id: s ? s.id : null, x: s ? s.x : 0, y: s ? s.y : 0, z: s ? s.z : 0 };
    if (extra) Object.assign(p, extra);
    this.bus.emit(type, p);
  }

  _hurt(amount) {
    const room = this.hp - this._dmg - T.hpFloor;
    const a = Math.max(0, Math.min(amount, room));
    if (a > 0) {
      this._dmg += a;
      this.stats.damage += a;
    }
    return a;
  }

  _setState(s, st) {
    s.state = st;
    s.t = 0;
  }

  // ===========================================================================
  // Per frame
  // ===========================================================================

  update(dt, player) {
    if (!(dt > 0) || !this.enabled) return;
    if (dt > 0.1) dt = 0.1;
    this.t += dt;
    const p = player;
    this._p = p || null;
    const alive = !!(p && p.alive !== false);
    // the hands' velocity relative to the body (finite differences, low-passed ~25 ms)
    const a = Math.min(1, dt / 0.025);
    for (let k = 0; k < 2; k++) {
      const h = this._h[k === 0 ? 'left' : 'right'];
      if (!h.ok) continue;
      if (h.seen) {
        h.vx += ((h.rx - h.px) / dt - h.vx) * a;
        h.vy += ((h.ry - h.py) / dt - h.vy) * a;
        h.vz += ((h.rz - h.pz) / dt - h.vz) * a;
      } else {
        h.vx = h.vy = h.vz = 0;
      }
      h.px = h.rx;
      h.py = h.ry;
      h.pz = h.rz;
      h.seen = true;
    }
    if (!alive) {
      this._letGoAll(p);
      return;
    }
    for (let i = 0; i < this.sites.length; i++) this._site(this.sites[i], dt, p);
  }

  /** Distance from the site's centre to the nearest hand (VR: the palms; desktop: the hold, else the body, less deskReach). */
  _nearest(s, p) {
    let best = 1e9;
    const cl = this.climb;
    if (this.vr) {
      for (let k = 0; k < 2; k++) {
        const h = this._h[k === 0 ? 'left' : 'right'];
        if (!h.ok) continue;
        const d = Math.hypot(p.x + h.rx - s.x, p.y + h.ry - s.y, p.z + h.rz - s.z);
        if (d < best) best = d;
      }
    } else {
      const st = cl && cl.holding ? cl.hands.right : null;
      const d = st && st.gripping ? Math.hypot(st.ax - s.x, st.ay - s.y, st.az - s.z) : Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) - T.deskReach;
      best = Math.max(0, d);
    }
    return best;
  }

  /** The hand that grips this site's patch right now, or null. */
  _gripOn(s) {
    const cl = this.climb;
    if (!cl || !cl.holding) return null;
    for (let k = 0; k < 2; k++) {
      const h = k === 0 ? 'right' : 'left'; // the desktop cling reports on the right hand
      const st = cl.hands[h];
      if (st.gripping && st.zone === s.zone && onPatch(s, st.ax, st.ay, st.az)) return h;
    }
    return null;
  }

  _site(s, dt, p) {
    s.t += dt;
    if (s.cd > 0) s.cd -= dt;
    if (s.inhaleCd > 0) s.inhaleCd -= dt;
    if (s.breathCd > 0) s.breathCd -= dt;
    // the heartbeat in its veins (faster while it holds you)
    const bpm = s.state === S.CLOSE ? (s.low ? 1.9 : 1.5) : s.state === S.RUINED ? 0 : 0.85;
    s.pulse = bpm > 0 ? (s.pulse + dt * bpm) % 1 : 0;
    const d = this._nearest(s, p);
    s.dist = d;
    const grip = this.held === null || this.held === s ? this._gripOn(s) : null;
    switch (s.state) {
      case S.DORMANT:
      case S.AWARE: {
        if (s.cd <= 0 && grip) {
          s.hand = grip;
          if (s.mode === 'answer') this._answer(s, p);
          else {
            this._setState(s, S.GRIP);
            s.onT = 0;
            this._emit('holdfast:grip', s, { hand: grip });
          }
          break;
        }
        if (s.mode === 'answer' && s.cd <= 0 && this.vr && this._knock(s, p)) {
          this._answer(s, p);
          break;
        }
        if (s.state === S.DORMANT) {
          if (d < T.awareRange && s.cd <= 0) {
            this._setState(s, S.AWARE);
            s.farT = 0;
            if (s.inhaleCd <= 0) {
              s.inhaleCd = T.inhaleGap;
              this._emit('holdfast:inhale', s, { distance: d });
            }
            this._emit('holdfast:aware', s, { distance: d });
          }
        } else {
          if (d > T.awareExit) {
            s.farT += dt;
            if (s.farT > 1) this._setState(s, S.DORMANT);
          } else s.farT = 0;
          if (d < T.breathRange && s.breathCd <= 0) {
            s.breathCd = T.breathGap;
            this._emit('holdfast:breath', s, { distance: d });
          }
          s.twitchT -= dt;
          if (s.twitchT <= 0) {
            s.twitches++;
            s.twitchT = T.twitchGap[0] + hash01(s.seed + s.twitches * 7919) * (T.twitchGap[1] - T.twitchGap[0]);
            this._emit('holdfast:twitch', s, { n: s.twitches });
          }
        }
        break;
      }
      case S.GRIP:
        if (!grip || grip !== s.hand) {
          // let go in time: free
          this._setState(s, S.AWARE);
          s.hand = null;
          break;
        }
        s.onT += dt;
        if (s.onT >= T.closeDelay) this._close(s, p);
        break;
      case S.CLOSE:
        this._hold(s, dt, p);
        break;
      case S.RELEASE:
        if (s.t >= T.releaseTime) {
          this._setState(s, S.RETRACT);
          this._emit('holdfast:retract', s);
        }
        break;
      case S.STAGGER:
        if (s.t >= T.staggerTime) {
          this._setState(s, S.RETRACT);
          this._emit('holdfast:retract', s);
        }
        break;
      case S.RETRACT:
        if (s.t >= T.retractTime) this._setState(s, S.DORMANT);
        break;
      case S.ANSWER:
        if (s.knocks < 3 && s.t >= s.knocks * 0.28) {
          s.knocks++;
          this._emit('holdfast:knock', s, { n: s.knocks });
          if (s.knocks === 3) this._emit('holdfast:answer', s);
        }
        if (s.t >= T.answerTime) {
          this._setState(s, S.RETRACT);
          this._emit('holdfast:retract', s);
        }
        break;
      default:
        break; // RUINED: a corpse
    }
    this._present(s, dt, p);
  }

  /** A VR knock on an 'answer' patch: a palm on the patch moving into the wall at knockSpeed or faster. */
  _knock(s, p) {
    for (let k = 0; k < 2; k++) {
      const h = this._h[k === 0 ? 'left' : 'right'];
      if (!h.ok) continue;
      const x = p.x + h.rx;
      const y = p.y + h.ry;
      const z = p.z + h.rz;
      const off = (x - s.x) * s.nx + (y - s.y) * s.ny + (z - s.z) * s.nz;
      if (off > 0.15 || !onPatch(s, x, y, z)) continue;
      if (-(h.vx * s.nx + h.vy * s.ny + h.vz * s.nz) >= T.knockSpeed) return true;
    }
    return false;
  }

  _answer(s) {
    this._setState(s, S.ANSWER);
    s.knocks = 0;
    s.cd = T.answerCd;
    this.stats.answers++;
  }

  /** It closes: the hand is locked. */
  _close(s, p) {
    const cl = this.climb;
    const h = s.hand;
    if (cl && h) {
      cl.pin(h, true);
      if (!cl.hands[h].pinned) {
        this._setState(s, S.AWARE);
        s.hand = null;
        return;
      }
    }
    this._setState(s, S.CLOSE);
    this.held = s;
    this.heldHand = h;
    s.low = this.hp <= T.lowAt;
    s.lockDur = this.lock * (s.low ? T.lowLock : 1);
    s.lockT = 0;
    s.beatT = 0;
    s.beats = 0;
    s.tearT = 0;
    s.letGoT = 0;
    s.ropeT = 0;
    s.pulled = 0;
    this.stats.closes++;
    this._emit('holdfast:close', s, { hand: h, low: s.low, lock: s.lockDur, px: p.x, py: p.y, pz: p.z });
  }

  /** CLOSE, every frame: the lock, the pull, the beats and every way out. */
  _hold(s, dt, p) {
    const cl = this.climb;
    const h = s.hand;
    const st = cl && h ? cl.hands[h] : null;
    if (!st || !st.gripping || !st.pinned) {
      // lost from outside (a death, a respawn, a warp): it lets go, nothing paid
      this._free(s, p, 'lost', false);
      return;
    }
    s.lockT += dt;
    // LOW now (a bite while it holds you): harder and longer
    if (!s.low && this.hp <= T.lowAt) {
      s.low = true;
      s.lockDur = Math.max(s.lockDur, this.lock * T.lowLock);
    }
    if (s.lockT > this.stats.maxLock) this.stats.maxLock = s.lockT;
    // the pull: the hold is drawn toward the wall
    if (cl.mode === 1) {
      const off = (st.ax - s.x) * s.nx + (st.ay - s.y) * s.ny + (st.az - s.z) * s.nz;
      const want = off - T.pullTo;
      if (want > 0) {
        const m = Math.min(want, T.pull * dt);
        st.ax -= s.nx * m;
        st.ay -= s.ny * m;
        st.az -= s.nz * m;
        s.pulled += m;
      }
    } else {
      cl.pinPull = Math.min(T.deskPull, cl.pinPull + T.pull * dt);
      s.pulled = cl.pinPull;
    }
    s.tx = st.ax;
    s.ty = st.ay;
    s.tz = st.az;
    // the squeeze beats (lub-dub: the second a little weaker)
    s.beatT -= dt;
    if (s.beatT <= 0) {
      s.beats++;
      s.beatT = s.low ? T.lowBeat : T.beat;
      const k = Math.min(1, (0.55 + 0.25 * Math.min(1, s.lockT / s.lockDur)) * (s.low ? T.lowSqueeze : 1));
      this._emit('holdfast:squeeze', s, { hand: h, strength: k, low: s.low, beat: s.beats });
    }
    const inp = this._in;
    // 1. tear free
    let tear = false;
    if (cl.mode === 1) {
      const hv = this._h[h];
      const sp = Math.hypot(hv.vx, hv.vy, hv.vz);
      const away = hv.vx * s.nx + hv.vy * s.ny + hv.vz * s.nz;
      if (hv.ok && sp >= T.tearSpeed && away >= T.tearCos * sp) s.tearT += dt;
      else s.tearT = Math.max(0, s.tearT - 2 * dt);
      tear = s.tearT >= T.tearTime;
    } else {
      if (inp.jump && inp.back) tear = true;
      if (!inp.grabL && !inp.grabR) {
        s.letGoT += dt;
        if (s.letGoT >= T.deskLetGo) tear = true;
      } else s.letGoT = 0;
    }
    if (tear) {
      this._hurt(T.tearHp);
      if (typeof cl.bite === 'function') cl.bite(T.tearGrip);
      this.stats.tears++;
      this._emit('holdfast:tear', s, { hand: h });
      this._free(s, p, 'tear', true);
      return;
    }
    // 2. the rope out-pulls it
    if (inp.reeling) s.ropeT += dt;
    else s.ropeT = Math.max(0, s.ropeT - dt);
    if (s.ropeT >= T.ropeTime) {
      this.stats.outpulls++;
      this._emit('holdfast:outpull', s, { hand: h });
      this._free(s, p, 'outpull', false);
      return;
    }
    // 3. waited out: the crushed hand
    if (s.lockT >= s.lockDur) {
      this._hurt(T.crushHp);
      this.stats.crushes++;
      this._emit('holdfast:crush', s, { hand: h, low: s.low });
      this._free(s, p, 'crush', false);
    }
  }

  /** It lets go of the held hand (reason); `ruin`: torn out of the wall, dead. */
  _free(s, p, reason, ruin) {
    const cl = this.climb;
    const h = s.hand;
    if (cl && h) cl.unpin(p, h, reason === 'lost' ? null : 'holdfast');
    if (this.held === s) {
      this.held = null;
      this.heldHand = null;
    }
    this._emit('holdfast:release', s, { hand: h, reason });
    s.hand = null;
    s.cd = reason === 'shot' ? T.cooldown + T.staggerTime : T.cooldown;
    if (ruin) this._setState(s, S.RUINED);
    else this._setState(s, reason === 'shot' ? S.STAGGER : S.RELEASE);
  }

  _letGoAll(player) {
    const cl = this.climb;
    if (cl) for (const h of ['left', 'right']) if (cl.hands[h].pinned) cl.unpin(player, h, null);
    if (this.held) {
      const s = this.held;
      s.hand = null;
      this._setState(s, S.RETRACT);
    }
    this.held = null;
    this.heldHand = null;
  }

  // ===========================================================================
  // The grapple shot (bus 'rope:shot'): through the forearm it staggers it and it lets go; a dormant patch flinches
  // ===========================================================================

  _onShot(p) {
    if (!p || !this.enabled) return;
    const ox = num(p.ox, NaN);
    const oy = num(p.oy, NaN);
    const oz = num(p.oz, NaN);
    const dx = num(p.dx, 0);
    const dy = num(p.dy, 0);
    const dz = num(p.dz, 0);
    const range = Math.max(1, num(p.range, 30));
    const dl = Math.hypot(dx, dy, dz);
    if (!isFinite(ox + oy + oz) || !(dl > 0.5)) return;
    for (const s of this.sites) {
      if (s.state === S.RUINED || s.state === S.RETRACT || s.state === S.STAGGER || s.state === S.RELEASE || s.state === S.ANSWER) continue;
      let hit;
      if (s.state === S.CLOSE || s.state === S.GRIP) {
        // the forearm: from the socket's mouth to the palm
        const mx = s.x + s.nx * T.armIn;
        const my = s.y + s.ny * T.armIn;
        const mz = s.z + s.nz * T.armIn;
        hit = segRay(mx, my, mz, s.tx, s.ty, s.tz, ox, oy, oz, dx / dl, dy / dl, dz / dl, range) <= T.shotRadius + T.shotPad;
      } else {
        if (s.cd > 0) continue;
        hit = segRay(s.x, s.y, s.z, s.x + s.nx * 0.05, s.y + s.ny * 0.05, s.z + s.nz * 0.05, ox, oy, oz, dx / dl, dy / dl, dz / dl, range) <= T.patchShot;
      }
      if (!hit) continue;
      // nothing solid in front of it (the ray from the muzzle to the site)
      const lv = this.level;
      const along = (s.x - ox) * dx + (s.y - oy) * dy + (s.z - oz) * dz;
      if (lv && typeof lv.segmentBlocked === 'function' && along / dl > 1.2) {
        const t = along / dl - 0.6;
        if (lv.segmentBlocked(ox, oy, oz, ox + (dx / dl) * t, oy + (dy / dl) * t, oz + (dz / dl) * t, 0.05)) continue;
      }
      if (s.state === S.CLOSE || s.state === S.GRIP) {
        this.stats.staggers++;
        this._emit('holdfast:stagger', s, { hand: p.hand || null });
        if (s.state === S.CLOSE) this._free(s, this._p, 'shot', false);
        else {
          s.hand = null;
          s.cd = T.cooldown + T.staggerTime;
          this._setState(s, S.STAGGER);
        }
      } else {
        this.stats.flinches++;
        s.cd = T.flinchCd;
        this._emit('holdfast:flinch', s, { hand: p.hand || null });
        this._setState(s, S.RETRACT);
      }
    }
  }

  // ===========================================================================
  // Presentation (smoothed values for the view)
  // ===========================================================================

  _present(s, dt, p) {
    const st = s.state;
    const ease = (cur, want, rate) => cur + (want - cur) * Math.min(1, dt * rate);
    let aware = 0;
    let close = 0;
    let out = 0;
    let tremble = 0;
    switch (st) {
      case S.AWARE:
        aware = 1;
        close = 0.08 + 0.06 * Math.max(0, 1 - s.dist / T.awareRange);
        out = 0.015 + 0.02 * Math.max(0, 1 - s.dist / T.awareRange);
        break;
      case S.GRIP:
        aware = 1;
        close = 0.2 + 0.5 * Math.min(1, s.onT / T.closeDelay);
        out = 0.05 + 0.05 * Math.min(1, s.onT / T.closeDelay);
        break;
      case S.CLOSE:
        aware = 1;
        close = 1;
        out = 0.1 + 0.03 * Math.min(1, s.lockT / Math.max(0.1, s.lockDur));
        tremble = s.tearT > 0 ? 0.6 + s.tearT / T.tearTime : 0.15;
        break;
      case S.RELEASE:
        aware = 1;
        close = 0.15;
        out = 0.08;
        tremble = 1;
        break;
      case S.STAGGER:
        aware = 1;
        close = 0.3;
        out = -0.05;
        tremble = 0.8;
        break;
      case S.RETRACT:
        out = -0.16;
        break;
      case S.RUINED:
        out = 0.22;
        close = 0.35;
        break;
      case S.ANSWER:
        aware = 1;
        close = 0;
        out = s.knocks >= 3 && s.t < T.answerTime - 0.7 ? 0.24 : -0.02;
        tremble = 0.4;
        break;
      default:
        out = s.cd > 0 ? -0.16 : 0;
        break;
    }
    s.aware = ease(s.aware, aware, 3);
    s.close = ease(s.close, close, st === S.CLOSE ? 9 : st === S.GRIP ? 6 : 3);
    s.out = ease(s.out, out, st === S.RETRACT || st === S.STAGGER ? 5 : 3);
    s.tremble = ease(s.tremble, tremble, 6);
    // the squeeze pulse (decays between beats)
    s.squeeze = st === S.CLOSE ? Math.max(0, s.squeeze - dt * 3.2) : ease(s.squeeze, 0, 4);
    if (st === S.CLOSE && s.beatT > (s.low ? T.lowBeat : T.beat) - dt * 1.5) s.squeeze = s.low ? 1 : 0.8;
    // where the palm goes: the held hand; while AWARE / GRIP the nearest hand clamped to the patch (it reaches), else the centre
    if (st !== S.CLOSE) {
      let tx = s.x;
      let ty = s.y;
      let tz = s.z;
      if (st === S.GRIP || st === S.AWARE) {
        const cl = this.climb;
        const g = s.hand && cl ? cl.hands[s.hand] : null;
        if (g && g.gripping) {
          tx = g.ax;
          ty = g.ay;
          tz = g.az;
        } else if (this.vr && p) {
          let bd = 1e9;
          for (let k = 0; k < 2; k++) {
            const h = this._h[k === 0 ? 'left' : 'right'];
            if (!h.ok) continue;
            const hx = p.x + h.rx;
            const hy = p.y + h.ry;
            const hz = p.z + h.rz;
            const dd = Math.hypot(hx - s.x, hy - s.y, hz - s.z);
            if (dd < bd) {
              bd = dd;
              // clamped to the patch, on the face (it reaches toward you without leaving its patch)
              const du = Math.max(-s.hu, Math.min(s.hu, (hx - s.x) * s.ux + (hy - s.y) * s.uy + (hz - s.z) * s.uz));
              const dv = Math.max(-s.hv, Math.min(s.hv, (hx - s.x) * s.vx + (hy - s.y) * s.vy + (hz - s.z) * s.vz));
              tx = s.x + s.ux * du + s.vx * dv;
              ty = s.y + s.uy * du + s.vy * dv;
              tz = s.z + s.uz * du + s.vz * dv;
            }
          }
        }
      }
      s.tx = ease(s.tx, tx, 4);
      s.ty = ease(s.ty, ty, 4);
      s.tz = ease(s.tz, tz, 4);
    }
  }

  // ===========================================================================
  // Debug / tests / capture tools
  // ===========================================================================

  /** Forces a site into a state (debug, captures): { state, hand, tx, ty, tz }. Pins nothing. */
  debugForce(i, opts) {
    const s = this.sites[i];
    if (!s) return null;
    const o = opts || {};
    const st = S[o.state] || S.DORMANT;
    this._setState(s, st);
    s.cd = 0;
    s.hand = o.hand || null;
    if (isFinite(o.tx)) {
      s.tx = o.tx;
      s.ty = o.ty;
      s.tz = o.tz;
    }
    if (st === S.CLOSE) {
      s.lockDur = 1e9;
      s.lockT = 0;
      s.close = 1;
      s.out = 0.12;
      s.aware = 1;
    } else if (st === S.ANSWER) {
      s.knocks = 3;
      s.t = 0.9;
    }
    return s;
  }

  /** A summary for the debug panel / tests. */
  debugState() {
    return {
      enabled: this.enabled,
      lock: this.lock,
      held: this.held ? this.held.id : null,
      hand: this.heldHand,
      sites: this.sites.map((s) => ({ id: s.id, zone: s.zoneId, section: s.section, mode: s.mode, state: s.state, cd: +s.cd.toFixed(2), dist: +Math.min(99, s.dist).toFixed(2), close: +s.close.toFixed(2), out: +s.out.toFixed(3) })),
      rejected: this.rejected.slice(),
      stats: Object.assign({}, this.stats),
    };
  }
}

/** Closest distance between the segment a->b and the ray o + t d (t in [0, range]); allocation-free. */
function segRay(ax, ay, az, bx, by, bz, ox, oy, oz, dx, dy, dz, range) {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const wx = ax - ox;
  const wy = ay - oy;
  const wz = az - oz;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * dx + uy * dy + uz * dz;
  const c = 1; // d is a unit vector
  const d = ux * wx + uy * wy + uz * wz;
  const e = dx * wx + dy * wy + dz * wz;
  const den = a * c - b * b;
  let s = a > 1e-12 && den > 1e-12 ? (b * e - c * d) / den : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  let t = (b * s + e) / c;
  if (t < 0) t = 0;
  else if (t > range) t = range;
  // re-clamp s for the clamped t
  if (a > 1e-12) {
    s = (t * b - d) / a;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
  }
  const px = ax + ux * s - (ox + dx * t);
  const py = ay + uy * s - (oy + dy * t);
  const pz = az + uz * s - (oz + dz * t);
  return Math.sqrt(px * px + py * py + pz * pz);
}
