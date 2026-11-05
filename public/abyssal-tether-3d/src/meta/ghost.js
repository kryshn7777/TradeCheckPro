/* THE LANTERN (ABYSSAL TETHER 3D) — meta/ghost.js
 * The GHOST LANTERN: the path of your best whole run, replayed as a pale light drifting down the shaft on the run clock
 * (deaths included). render/ghostView.js draws it; game.js records, saves and plays it.
 *
 * Pure ES module: no three.js, no DOM at import time (storage is looked up lazily), no Math.random, so Node tests load it.
 *
 * ---- Recording ------------------------------------------------------------------------------------------------
 *   GhostRecorder.sample(t, x, y, z) on the run clock: one sample per 1/10 s slot (a slot skipped by a long frame repeats the
 *   current position), x / y / z in DECIMETRES as Int16 (+-3276.7 m; outside that the recorder turns invalid) in a growable
 *   Int16Array (8 minutes = 4,800 samples = 28.8 KB). `valid` is true only for a whole run from its start: game.js
 *   invalidates it on a Continue, a warp, a teleport; it is never valid in Sandbox. An invalid recorder never saves.
 *
 * ---- Format (encode / decode) ------------------------------------------------------------------------------------
 *   base64 of: 'G' 'L' | version (1) | hz | count (uint32 LE) | finish time s (float32 LE) | count x (x, y, z) int16 LE decimetres
 *
 * ---- Storage ----------------------------------------------------------------------------------------------------
 *   localStorage 'abyssalTether3d.v2.ghost.ch<chapter>.<diff>' (one ghost per chapter and difficulty: <= 6 x ~40 KB). Sync, so
 *   start() has the ghost at once (the IndexedDB 'ghosts' store of meta/save.js would make it race the run's first frames).
 *   Every storage error is swallowed (quota, private mode, no storage): the ghost is a nicety, never a failure.
 */

export const GHOST_HZ = 10;
export const GHOST_VERSION = 1;
export const GHOST_PREFIX = 'abyssalTether3d.v2.ghost.';
const HEADER = 12;
const INITIAL = 4800; // 8 minutes at 10 Hz
const MAX_SAMPLES = 60 * 60 * GHOST_HZ; // one hour: a longer run is not recorded (invalid)
const LIM = 32767;

export function ghostKey(chapter, diffKey) {
  return `${GHOST_PREFIX}ch${Number(chapter) === 2 ? 2 : 1}.${String(diffKey)}`;
}

export class GhostRecorder {
  constructor(capacity = INITIAL) {
    this.data = new Int16Array(Math.max(16, capacity | 0) * 3);
    this.count = 0;
    this.valid = true;
    this.hz = GHOST_HZ;
  }

  reset() {
    this.count = 0;
    this.valid = true;
  }

  invalidate() {
    this.valid = false;
  }

  /** Seconds covered by the samples. */
  get duration() {
    return this.count > 0 ? (this.count - 1) / this.hz : 0;
  }

  /** Records the position for every 1/hz slot up to the run clock `t` (s). No allocation unless the buffer grows. */
  sample(t, x, y, z) {
    if (!this.valid) return;
    if (!(t >= 0) || !isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    const qx = Math.round(x * 10);
    const qy = Math.round(y * 10);
    const qz = Math.round(z * 10);
    if (qx > LIM || qx < -LIM || qy > LIM || qy < -LIM || qz > LIM || qz < -LIM) {
      this.valid = false;
      return;
    }
    const slot = Math.floor(t * this.hz + 1e-6);
    while (this.count <= slot) {
      if (this.count >= MAX_SAMPLES) {
        this.valid = false;
        return;
      }
      if ((this.count + 1) * 3 > this.data.length) this._grow();
      const o = this.count * 3;
      this.data[o] = qx;
      this.data[o + 1] = qy;
      this.data[o + 2] = qz;
      this.count++;
    }
  }

  _grow() {
    const next = new Int16Array(Math.min(MAX_SAMPLES * 3, this.data.length * 2));
    next.set(this.data);
    this.data = next;
  }

  /** base64 of the versioned record; `time` = the run's finish time (s). */
  encode(time = this.duration) {
    return encodeGhost(this.data, this.count, this.hz, time);
  }
}

export function encodeGhost(data, count, hz, time) {
  const bytes = new Uint8Array(HEADER + count * 6);
  const dv = new DataView(bytes.buffer);
  bytes[0] = 71; // 'G'
  bytes[1] = 76; // 'L'
  bytes[2] = GHOST_VERSION;
  bytes[3] = hz;
  dv.setUint32(4, count, true);
  dv.setFloat32(8, isFinite(time) ? time : 0, true);
  for (let i = 0; i < count * 3; i++) dv.setInt16(HEADER + i * 2, data[i], true);
  return toBase64(bytes);
}

/** -> { hz, count, time, data: Int16Array } or null (garbage, another version, a truncated record). Never throws. */
export function decodeGhost(str) {
  try {
    if (typeof str !== 'string' || str.length < 16) return null;
    const bytes = fromBase64(str);
    if (!bytes || bytes.length < HEADER || bytes[0] !== 71 || bytes[1] !== 76 || bytes[2] !== GHOST_VERSION) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const hz = bytes[3];
    const count = dv.getUint32(4, true);
    const time = dv.getFloat32(8, true);
    if (!(hz > 0) || count < 2 || count > MAX_SAMPLES || bytes.length < HEADER + count * 6 || !(time > 0)) return null;
    const data = new Int16Array(count * 3);
    for (let i = 0; i < count * 3; i++) data[i] = dv.getInt16(HEADER + i * 2, true);
    return { hz, count, time, data };
  } catch {
    return null;
  }
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x4000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x4000));
  return btoa(s);
}

function fromBase64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Plays a decoded ghost: at(t, out) -> out {x, y, z} in metres, interpolated, clamped to the first / last sample. */
export class GhostPlayer {
  constructor(rec) {
    this.hz = rec.hz;
    this.count = rec.count;
    this.time = rec.time; // the finish time of the run it was recorded in (s)
    this.data = rec.data;
  }

  get duration() {
    return (this.count - 1) / this.hz;
  }

  at(t, out) {
    const last = this.count - 1;
    let f = (t > 0 ? t : 0) * this.hz;
    if (!(f < last)) f = last;
    const i = Math.min(last - 1, Math.floor(f));
    const u = f - i;
    const d = this.data;
    const a = i * 3;
    const b = a + 3;
    out.x = (d[a] + (d[b] - d[a]) * u) * 0.1;
    out.y = (d[a + 1] + (d[b + 1] - d[a + 1]) * u) * 0.1;
    out.z = (d[a + 2] + (d[b + 2] - d[a + 2]) * u) * 0.1;
    return out;
  }
}

function lsOf(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The saved ghost of a chapter and difficulty as a GhostPlayer, or null. Never throws. */
export function loadGhost(chapter, diffKey, storage = null) {
  try {
    const s = lsOf(storage);
    if (!s) return null;
    const rec = decodeGhost(s.getItem(ghostKey(chapter, diffKey)));
    return rec ? new GhostPlayer(rec) : null;
  } catch {
    return null;
  }
}

/**
 * Saves the recorder as the ghost of a chapter and difficulty when it is valid and faster than the one saved.
 * @returns {'saved'|'invalid'|'worse'|'error'}
 */
export function saveGhost(chapter, diffKey, recorder, time, storage = null) {
  if (!recorder || !recorder.valid || recorder.count < 2 || !(time > 0)) return 'invalid';
  try {
    const s = lsOf(storage);
    if (!s) return 'error';
    const prev = decodeGhost(s.getItem(ghostKey(chapter, diffKey)));
    if (prev && prev.time <= time) return 'worse';
    s.setItem(ghostKey(chapter, diffKey), recorder.encode(time));
    return 'saved';
  } catch {
    return 'error';
  }
}

export function clearGhost(chapter, diffKey, storage = null) {
  try {
    const s = lsOf(storage);
    if (!s) return false;
    s.removeItem(ghostKey(chapter, diffKey));
    return true;
  } catch {
    return false;
  }
}
