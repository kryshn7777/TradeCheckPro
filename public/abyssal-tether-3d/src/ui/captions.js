/* ABYSSAL TETHER 3D — captions.js
 * WP-UX: subtitle-style captions for the sounds that warn you (VRC Accessibility.1; the threat in this game is largely
 * heard before it is seen). Pure (no three.js, no DOM): the mapping from bus events to caption lines, and a small
 * allocation-free tracker that keeps at most three lines alive and tells the UI which way each sound came from.
 *
 * Sources (all already on the bus; payload fields used are listed in captionForEvent):
 *   creature:clip {name,event,x,y,z}       the rig's clip events: wind-up, strike, roar, knocks, breathing, snaps ...
 *   creature:call / attack / burst / strike / sighting / retreat / step   the sim events (fallback when no rig clip)
 *   platform:crumble / strain, squall:warn / on, rope:slip, rope:jolt, grapple:break, climb:strain / slip, health:low, lantern:low, trigger:rumble / debris
 *
 * A caption is a short bracketed description like a film's "[stone grinding, rising]", with a kind icon (shape, not colour),
 * a direction (8 sectors around the head plus above / below) and a severity 0..2 for emphasis. Lines of the same `group`
 * within `cd` seconds collapse into one (a rig clip and the sim event that sounds at the same moment are one caption).
 */

const TTL = 3.2;
const MAX_LINES = 3;
const DIR_REFRESH = 0.15;

/** Caption kinds → the shape drawn next to the line. */
export const KIND_SHAPE = { creature: 'diamond', world: 'square', player: 'circle', status: 'triangle' };

const R = (text, kind, sev, group, cd, ttl) => Object.freeze({ text, kind, sev, group, cd, ttl: ttl || TTL });

// ---- rules (frozen constants: the tracker never builds strings per event) --------------------------------------------
const ATTACK = 'attack';
export const RULES = Object.freeze({
  windup: R('[Stone grinding, rising]', 'creature', 2, ATTACK, 1.4),
  lunge: R('[It lunges]', 'creature', 2, ATTACK, 1.4),
  strikeHit: R('[Heavy impact]', 'creature', 2, 'strike', 1.2),
  strikeMiss: R('[It strikes, just missing]', 'creature', 2, 'strike', 1.2),
  surge: R('[It surges toward you]', 'creature', 2, 'surge', 2.5),
  roar: R('[Deep roar]', 'creature', 2, 'roar', 3),
  snap: R('[Sharp stone clack]', 'creature', 1, 'snap', 1.5),
  knock: R('[Three slow knocks]', 'creature', 2, 'knock', 4),
  breathe: R('[Slow breathing, close]', 'creature', 1, 'breathe', 4),
  shiver: R('[Plates grinding]', 'creature', 1, 'shiver', 4),
  probe: R('[Tapping, very close]', 'creature', 2, 'probe', 3),
  recoil: R('[Loose stone rattles]', 'creature', 0, 'recoil', 2),
  portal: R('[A portal slams shut]', 'creature', 2, 'strike', 1.2),
  callNear: R('[A call, close]', 'creature', 2, 'call', 3),
  callFar: R('[A distant call]', 'creature', 1, 'call', 3),
  vast: R('[Something vast passes]', 'creature', 1, 'sighting', 4, 4),
  retreat: R('[It withdraws]', 'creature', 0, 'retreat', 4),
  steps: R('[Scraping, closing in]', 'creature', 1, 'steps', 5),
  skitSteps: R('[Fast skittering, close]', 'creature', 1, 'skitter', 4),
  skitLunge: R('[Something small lunges]', 'creature', 2, 'skitlunge', 1.4),
  skitBite: R('[A sharp bite]', 'creature', 2, 'skitstrike', 1.2),
  skitMiss: R('[Small jaws snap, missing]', 'creature', 1, 'skitstrike', 1.2),
  crumble: R('[Stone crumbling]', 'world', 1, 'crumble', 1.2),
  rumble: R('[Deep rumble]', 'world', 1, 'rumble', 4),
  debris: R('[Rubble falling]', 'world', 1, 'debris', 3),
  sealOpen: R('[Iron grating grinds open]', 'world', 1, 'seal', 3),
  sealLocked: R('[Iron grating, locked]', 'world', 1, 'seal', 6),
  // LEVEL_FUN_PLAN P3: the verbs
  bell: R('[A bell tolls]', 'world', 1, 'bell', 2),
  ratchet: R('[A ratchet clacks]', 'world', 0, 'ratchet', 0.8),
  lampCatch: R('[A lamp catches]', 'world', 0, 'lamp', 1),
  // LEVEL_FUN_PLAN P4: the rockfall lane's telegraph (the stones themselves are the existing `debris` caption)
  laneWarn: R('[Rocks rattle above]', 'world', 1, 'rockfall', 3),
  // LEVEL_FUN_PLAN P6: the S6 wind squall's telegraph and its gust; a crumbling span's first groan underfoot
  squallWarn: R('[Wind rising from below]', 'world', 1, 'squall', 6),
  squall: R('[A gust pushes you]', 'world', 0, 'squall', 6),
  strain: R('[Stone groaning underfoot]', 'world', 2, 'crumble', 2),
  // LEVEL_FUN_PLAN P5: the Mason as the key (the S5 keystone), the Masons' rests, the S7 survive floor
  stoneCrack: R('[Stone cracks]', 'world', 2, 'breach', 1.2),
  keystone: R('[The keystone gives way]', 'world', 2, 'breach', 2),
  nookScrape: R('[Stone scraping at the opening]', 'creature', 2, 'nook', 4),
  nookSpent: R('[It forces the opening]', 'creature', 2, 'nook', 4),
  bolt: R('[An iron bolt slides back below]', 'world', 1, 'bolt', 2),
  boltsHold: R('[The bolts below go still]', 'world', 0, 'bolt', 4),
  slip: R('[Rope slipping]', 'player', 1, 'slip', 1.5),
  jolt: R('[Rope snaps taut]', 'player', 1, 'jolt', 1.2),
  anchorBreak: R('[Anchor breaks]', 'world', 2, 'break', 1),
  gripWeak: R('[Grip failing]', 'player', 1, 'grip', 3),
  gripLost: R('[Grip lost]', 'player', 2, 'grip', 1.5),
  heart: R('[Heartbeat pounding]', 'player', 1, 'heart', 8),
  lantern: R('[Lantern dimming]', 'player', 0, 'lantern', 12),
});

// ---- colour-safe status cues (settings.colorSafe): a shape and words for what colour alone says elsewhere --------------------
const S = (text, sev, group, cd) => Object.freeze({ text, kind: 'status', sev, group, cd, ttl: 3.6, status: true });
export const STATUS_RULES = Object.freeze({
  lowHealth: S('LOW HEALTH', 2, 's-health', 6),
  hazard: S('HAZARD HIT', 2, 's-hazard', 1.5),
  gripWeak: S('GRIP WEAK', 1, 's-grip', 4),
  gripLost: S('GRIP LOST', 2, 's-grip', 1.5),
  lantern: S('LANTERN LOW', 1, 's-lantern', 15),
  picked: Object.freeze([S('+ FIRST AID KIT', 0, 's-pick', 0.8), S('+ BANDAGE', 0, 's-pick', 0.8), S('+ ADRENALINE', 0, 's-pick', 0.8), S('+ BATTERY', 0, 's-pick', 0.8)]),
});

/** creature:clip rules by `${name}:${event}` ('start' is also used when the rig sends no event). */
const CLIP_RULES = Object.freeze({
  'rear_windup:start': RULES.windup,
  'strike:contact': RULES.strikeHit,
  'portal_snap:clap': RULES.portal,
  'roar_display:start': RULES.roar,
  'notice_snap:snap': RULES.snap,
  'notice_snap:start': RULES.snap,
  'knock_x3:knock': RULES.knock,
  'linger_breathe:inhale': RULES.breathe,
  'linger_breathe:start': RULES.breathe,
  'plate_shiver:start': RULES.shiver,
  'leg_probe:tap': RULES.probe,
  'recoil:clack': RULES.recoil,
});

const finite = (v) => typeof v === 'number' && isFinite(v);

/**
 * The caption rule for a bus event, or null (not captioned, or below the threshold that makes it audible). Pure.
 * @param {string} type bus event name
 * @param {object} [p]  payload
 */
export function captionForEvent(type, p) {
  const e = p || {};
  if (e.skit) {
    // WP-SKITTER: the small red hunters share the creature events, tagged skit:true
    switch (type) {
      case 'creature:attack':
        return RULES.skitLunge;
      case 'creature:burst':
        return RULES.skitSteps;
      case 'creature:strike':
        return e.hit ? RULES.skitBite : RULES.skitMiss;
      case 'creature:step':
        return finite(e.distance) && e.distance < 26 && finite(e.intensity) && e.intensity > 0.25 ? RULES.skitSteps : null;
      default:
        return null;
    }
  }
  switch (type) {
    case 'creature:clip': {
      let ev = e.event == null || e.event === 'begin' ? 'start' : String(e.event);
      if (ev === 'begin') ev = 'start';
      return CLIP_RULES[`${e.name}:${ev}`] || null;
    }
    case 'creature:attack':
      return e.gate ? null : RULES.lunge;
    case 'creature:burst':
      return RULES.surge;
    case 'creature:strike':
      return e.hit ? RULES.strikeHit : RULES.strikeMiss;
    case 'creature:call':
      return finite(e.distance) && e.distance < 28 ? RULES.callNear : RULES.callFar;
    case 'creature:sighting':
      return RULES.vast;
    case 'creature:retreat':
      return RULES.retreat;
    case 'creature:step':
      return finite(e.intensity) && e.intensity > 0.5 && (!finite(e.distance) || e.distance < 38) ? RULES.steps : null;
    case 'platform:crumble':
      return RULES.crumble;
    case 'rope:slip':
      return finite(e.intensity) && e.intensity > 0.4 ? RULES.slip : null;
    case 'rope:jolt':
      return finite(e.speed) && e.speed > 8 ? RULES.jolt : null;
    case 'grapple:break':
      return RULES.anchorBreak;
    case 'climb:strain':
      return finite(e.level) && e.level >= 1 ? RULES.gripWeak : null;
    case 'climb:slip':
      return RULES.gripLost;
    case 'health:low':
      return RULES.heart;
    case 'lantern:low':
      return RULES.lantern;
    case 'trigger:rumble':
      return RULES.rumble;
    case 'trigger:debris':
      return RULES.debris;
    case 'seal:open':
      return RULES.sealOpen;
    case 'seal:land':
      return RULES.sealLocked;
    case 'bell:ring':
      return RULES.bell;
    case 'objective:progress':
      if (e.verb === 'breach') return e.k < e.of ? RULES.ratchet : null; // the last one is the break (breach:break)
      return e.verb === 'haul' || e.verb === 'winch' ? RULES.ratchet : e.verb === 'lamp' ? RULES.lampCatch : e.verb === 'survive' ? RULES.bolt : null;
    case 'breach:hit':
      return RULES.stoneCrack;
    case 'breach:break':
      return RULES.keystone;
    case 'nook:warn':
      return RULES.nookScrape;
    case 'nook:spent':
      return RULES.nookSpent;
    case 'arena:pause':
      return RULES.boltsHold;
    case 'lane:warn':
      return RULES.laneWarn;
    case 'squall:warn':
      return RULES.squallWarn;
    case 'squall:on':
      return RULES.squall;
    case 'platform:strain':
      return RULES.strain;
    case 'lane:on':
      return RULES.debris;
    default:
      return null;
  }
}

/** The colour-safe status cue for a bus event, or null. Pure. */
export function statusForEvent(type, p) {
  const e = p || {};
  switch (type) {
    case 'health:low':
      return STATUS_RULES.lowHealth;
    case 'health:damage':
      return e.cause === 'hazard' || e.cause === 'rockfall' ? STATUS_RULES.hazard : null;
    case 'climb:strain':
      return finite(e.level) && e.level >= 1 ? STATUS_RULES.gripWeak : null;
    case 'climb:slip':
      return STATUS_RULES.gripLost;
    case 'lantern:low':
      return STATUS_RULES.lantern;
    case 'pickup:collect':
      return finite(e.kind) && e.kind >= 0 && e.kind < 4 ? STATUS_RULES.picked[e.kind | 0] : null;
    default:
      return null;
  }
}

/** Every bus event the tracker listens to. */
export const CAPTION_EVENTS = Object.freeze([
  'creature:clip',
  'creature:attack',
  'creature:burst',
  'creature:strike',
  'creature:call',
  'creature:sighting',
  'creature:retreat',
  'creature:step',
  'platform:crumble',
  'rope:slip',
  'rope:jolt',
  'grapple:break',
  'climb:strain',
  'climb:slip',
  'health:low',
  'lantern:low',
  'trigger:rumble',
  'trigger:debris',
  'seal:open',
  'seal:land',
  'bell:ring',
  'objective:progress',
  'lane:warn',
  'lane:on',
  'squall:warn',
  'squall:on',
  'platform:strain',
  'breach:hit',
  'breach:break',
  'nook:warn',
  'nook:spent',
  'arena:pause',
  'health:damage',
  'pickup:collect',
]);

/** Direction sector names (0 = straight ahead, clockwise). */
export const SECTOR_NAMES = Object.freeze(['ahead', 'ahead right', 'right', 'behind right', 'behind', 'behind left', 'left', 'ahead left']);

/**
 * Sector (0..7, 0 = ahead, clockwise from above) of a source at (sx, sz) seen from a head at (hx, hz) looking along `yaw`
 * (three.js yaw: forward = (−sin yaw, −cos yaw)). −1 when the source is (nearly) on top of the head.
 */
export function sectorOf(hx, hz, yaw, sx, sz) {
  const dx = sx - hx;
  const dz = sz - hz;
  if (dx * dx + dz * dz < 1) return -1;
  const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  const a = Math.atan2(right, fwd);
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

function makeLine() {
  return { on: false, rule: null, text: '', kind: 'world', sev: 0, group: '', age: 0, ttl: 0, hasSrc: false, sx: 0, sy: 0, sz: 0, sector: -1, vert: 0, near: false };
}

/**
 * Keeps the live caption lines. `lines` is a fixed array of three slots (allocation-free); `rev` changes whenever the
 * visible text or a direction changes, so the UI repaints only then.
 */
export class CaptionTracker {
  /** @param {{captions?: () => boolean, status?: () => boolean}} [opts] which kinds are wanted right now (settings.captions / settings.colorSafe) */
  constructor(opts) {
    this.wantCaptions = (opts && opts.captions) || (() => true);
    this.wantStatus = (opts && opts.status) || (() => true);
    this.lines = [];
    for (let i = 0; i < MAX_LINES; i++) this.lines.push(makeLine());
    this.rev = 0;
    this.clock = 0;
    this._groups = Object.create(null); // group -> clock of its last caption
    this._dirT = 0;
    this._offs = [];
  }

  /** Subscribes to the bus (returns an unsubscribe). Call once. */
  attach(bus) {
    if (!bus || typeof bus.on !== 'function') return () => {};
    for (const type of CAPTION_EVENTS) {
      const off = bus.on(type, (p) => this.push(type, p));
      if (typeof off === 'function') this._offs.push(off);
    }
    return () => this.detach();
  }

  detach() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }

  clear() {
    for (const l of this.lines) l.on = false;
    this._groups = Object.create(null);
    this.rev++;
  }

  /** Feeds one bus event. Returns the (last) line it produced / refreshed, or null. */
  push(type, p) {
    let out = null;
    if (this.wantCaptions()) {
      const rule = captionForEvent(type, p);
      if (rule) out = this._take(rule, type, p) || out;
    }
    if (this.wantStatus()) {
      const rule = statusForEvent(type, p);
      if (rule) out = this._take(rule, type, p) || out;
    }
    return out;
  }

  _take(rule, type, p) {
    const last = this._groups[rule.group];
    if (last !== undefined && this.clock - last < rule.cd) return null;
    this._groups[rule.group] = this.clock;
    // The same sentence already up: refresh it. Otherwise take a free slot, else the oldest least-severe one.
    let slot = null;
    for (const l of this.lines) if (l.on && l.rule === rule) slot = l;
    if (!slot) for (const l of this.lines) if (!l.on) { slot = l; break; }
    if (!slot) {
      let worst = -1;
      for (const l of this.lines) {
        const score = (2 - l.sev) * 100 + l.age;
        if (score > worst) {
          worst = score;
          slot = l;
        }
      }
    }
    slot.on = true;
    slot.rule = rule;
    slot.text = rule.text;
    slot.kind = rule.kind;
    slot.sev = rule.sev;
    slot.group = rule.group;
    slot.age = 0;
    slot.ttl = rule.ttl;
    let e = p || {};
    if (e.data && finite(e.data.x) && finite(e.data.y) && finite(e.data.z)) e = e.data; // level triggers carry the source in data
    else if (type.indexOf('trigger:') === 0) e = {}; // ... otherwise x/z are the player's own
    slot.hasSrc = finite(e.x) && finite(e.y) && finite(e.z);
    if (slot.hasSrc) {
      slot.sx = e.x;
      slot.sy = e.y;
      slot.sz = e.z;
    }
    slot.sector = -2; // direction not computed yet
    this._dirT = 0;
    this.rev++;
    return slot;
  }

  /** Ages the lines and refreshes their directions from the head pose {x,y,z,yaw,ok}. */
  update(dt, head) {
    this.clock += dt;
    let any = false;
    for (const l of this.lines) {
      if (!l.on) continue;
      l.age += dt;
      if (l.age >= l.ttl) {
        l.on = false;
        this.rev++;
        continue;
      }
      any = true;
    }
    if (!any) return;
    this._dirT -= dt;
    if (this._dirT > 0) return;
    this._dirT = DIR_REFRESH;
    for (const l of this.lines) {
      if (!l.on) continue;
      let sector = -1;
      let vert = 0;
      let near = false;
      if (l.hasSrc && head && head.ok) {
        sector = sectorOf(head.x, head.z, head.yaw, l.sx, l.sz);
        const dy = l.sy - head.y;
        vert = dy > 6 ? 1 : dy < -6 ? -1 : 0;
        const dx = l.sx - head.x;
        const dz = l.sz - head.z;
        near = dx * dx + dy * dy + dz * dz < 144;
      }
      if (sector !== l.sector || vert !== l.vert || near !== l.near) {
        l.sector = sector;
        l.vert = vert;
        l.near = near;
        this.rev++;
      }
    }
  }
}
