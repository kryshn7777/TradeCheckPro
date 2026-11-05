/**
 * ABYSSAL TETHER 3D - WATER PLAN (pure: no three.js, no DOM, no Math.random).
 *
 * "In the first level I need water to be flowing here and there, like water sweeping through places, waterfalls, so random, just something like
 * that to add more screen presence."
 *
 * The old Underspire weeps: pipes and sluices let go of water that falls down the faces of the shaft, and where a ledge is wide a stream
 * runs across it and spills over its lip as a thinner fall. planWater(level, seed) lays them out from the level's own solids, deterministically:
 *
 *   FALL     a sheet of water down a wall face: { kind:'fall', x,y,z (the spout), nx,nz (the face normal, into the open), w (m), len (m down to what
 *            it lands on), baseY, flow (0.6..1.4) }
 *   STREAM   a thin sheet over a ledge top: { kind:'stream', x,y,z, dx,dz (the flow direction, unit), len, w, flow }; it ends at the ledge lip, where
 *            a FALL (kind 'lip') continues it down
 *   Falls never cross anchors or climb patches' faces... (decor only: they do not touch collision; they are kept 0.12 m off the wall).
 *
 * At most MAX features; per section MAX_PER_SECTION; none within 3 m of the spawn / a checkpoint (the arrival is quiet); none in the first 6 m
 * under the top of a section (a spout needs height). Used by render/waterView.js (the sheets, the mist, the splash) and audio3d (the sound of the
 * nearest one).
 */

export const WATER = Object.freeze({
  MAX: 14,
  MAX_PER_SECTION: 2,
  minFall: 5, // m: a fall shorter than this is not worth a sheet
  maxFall: 48,
  off: 0.12, // m off the wall face
  streamLen: [4, 9],
});

function rngOf(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FACES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * @param {object} level  Level3D (solids, sections, raycast, pointInSolid, spawn)
 * @param {number} seed
 * @returns {Array<object>} features, top of the descent first
 */
export function planWater(level, seed = 0x57a7e5) {
  const rng = rngOf(seed);
  const out = [];
  const secs = level.sections || [];
  const solids = level.solids || [];
  const hit = {};
  const perSec = new Array(secs.length).fill(0);
  const quiet = [];
  if (level.spawn) quiet.push(level.spawn);
  for (const s of secs) if (s.checkpoint) quiet.push(s.checkpoint);
  const tooClose = (x, y, z) => quiet.some((q) => Math.hypot(q.x - x, q.y - y, q.z - z) < 3);
  const cands = [];
  for (const s of solids) {
    if (s.kind !== 'wall' && s.kind !== 'pillar' && s.kind !== 'stone') continue;
    const h = s.maxY - s.minY;
    if (h < 9) continue;
    for (const [fx, fz] of FACES) {
      const width = fx ? s.maxZ - s.minZ : s.maxX - s.minX;
      if (width < 3) continue;
      cands.push({ s, fx, fz, h, width });
    }
  }
  // a fixed order, then a seeded shuffle
  cands.sort((a, b) => a.s.minY - b.s.minY || a.s.minX - b.s.minX || a.s.minZ - b.s.minZ || a.fx - b.fx || a.fz - b.fz);
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = cands[i];
    cands[i] = cands[j];
    cands[j] = t;
  }
  for (const c of cands) {
    if (out.length >= WATER.MAX) break;
    const { s, fx, fz } = c;
    // the face's plane and a random place along it, kept 1 m from the corners
    const along = fx ? [s.minZ + 1, s.maxZ - 1] : [s.minX + 1, s.maxX - 1];
    if (along[1] <= along[0]) continue;
    const u = along[0] + rng() * (along[1] - along[0]);
    const px = fx ? (fx > 0 ? s.maxX : s.minX) + fx * WATER.off : u;
    const pz = fz ? (fz > 0 ? s.maxZ : s.minZ) + fz * WATER.off : u;
    const topY = s.maxY - 1.5 - rng() * Math.min(3, c.h * 0.2);
    const si = level.sectionIndexAt ? level.sectionIndexAt(topY) : 0;
    if (si < 0 || perSec[si] >= WATER.MAX_PER_SECTION) continue;
    if (secs[si] && topY > secs[si].yTop - 6) continue;
    if (tooClose(px, topY, pz)) continue;
    // open air in front of the face, and a length down to what it lands on
    if (level.pointInSolid(px + fx * 0.3, topY, pz + fz * 0.3)) continue;
    const r = level.raycast(px, topY, pz, 0, -1, 0, WATER.maxFall, hit);
    const len = r ? r.t : WATER.maxFall;
    if (len < WATER.minFall) continue;
    // the sheet must hug the face the whole way: a step out of the wall below it (a ledge, a girder) ends the fall there (the ray found it) or
    // means the face is not continuous: probe the wall behind the sheet at its foot
    const footY = topY - len;
    if (!level.pointInSolid(px - fx * 0.3, footY + Math.min(1, len * 0.5), pz - fz * 0.3)) continue;
    const w = 0.9 + rng() * 1.8;
    // the sheet's two ends stay on the wall: shift it in if it would overhang
    out.push({ kind: 'fall', x: +px.toFixed(3), y: +topY.toFixed(3), z: +pz.toFixed(3), nx: fx, nz: fz, w: +w.toFixed(2), len: +len.toFixed(2), baseY: +footY.toFixed(3), flow: +(0.6 + rng() * 0.8).toFixed(2), section: si, id: 'water-' + out.length });
    perSec[si]++;
  }
  // streams over wide ledge tops, spilling over a lip
  const tops = solids.filter((s) => (s.kind === 'stone' || s.kind === 'metal' || s.kind === 'bridge') && s.maxX - s.minX >= 7 && s.maxZ - s.minZ >= 3 && s.maxY - s.minY >= 0.4);
  tops.sort((a, b) => a.minY - b.minY || a.minX - b.minX || a.minZ - b.minZ);
  for (let i = tops.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = tops[i];
    tops[i] = tops[j];
    tops[j] = t;
  }
  for (const s of tops) {
    if (out.length >= WATER.MAX + 6) break;
    const si = level.sectionIndexAt ? level.sectionIndexAt(s.maxY) : 0;
    if (si < 0 || perSec[si] >= WATER.MAX_PER_SECTION + 1) continue;
    const alongX = s.maxX - s.minX >= s.maxZ - s.minZ;
    const dir = rng() < 0.5 ? 1 : -1;
    const len = Math.min(WATER.streamLen[0] + rng() * (WATER.streamLen[1] - WATER.streamLen[0]), (alongX ? s.maxX - s.minX : s.maxZ - s.minZ) - 1);
    if (len < 3) continue;
    const dx = alongX ? dir : 0;
    const dz = alongX ? 0 : dir;
    // the stream ends at the lip on the `dir` side; it starts `len` back
    const lipX = alongX ? (dir > 0 ? s.maxX : s.minX) : (s.minX + s.maxX) / 2 + (rng() - 0.5) * (s.maxX - s.minX - 2);
    const lipZ = alongX ? (s.minZ + s.maxZ) / 2 + (rng() - 0.5) * Math.max(0, s.maxZ - s.minZ - 2) : dir > 0 ? s.maxZ : s.minZ;
    const y = s.maxY + 0.025;
    if (tooClose(lipX, y, lipZ) || tooClose(lipX - dx * len, y, lipZ - dz * len)) continue;
    const r = level.raycast(lipX + dx * 0.15, y - 0.05, lipZ + dz * 0.15, 0, -1, 0, WATER.maxFall, hit);
    const drop = r ? r.t : WATER.maxFall;
    const w = 1.2 + rng() * 1.6;
    out.push({ kind: 'stream', x: +(lipX - dx * len * 0.5).toFixed(3), y: +y.toFixed(3), z: +(lipZ - dz * len * 0.5).toFixed(3), dx, dz, len: +len.toFixed(2), w: +w.toFixed(2), flow: +(0.7 + rng() * 0.6).toFixed(2), section: si, id: 'water-' + out.length });
    if (drop >= 2.5) {
      out.push({ kind: 'lip', x: +(lipX + dx * 0.1).toFixed(3), y: +y.toFixed(3), z: +(lipZ + dz * 0.1).toFixed(3), nx: dx, nz: dz, w: +(w * 0.8).toFixed(2), len: +Math.min(drop, 30).toFixed(2), baseY: +(y - Math.min(drop, 30)).toFixed(3), flow: 0.7, section: si, id: 'water-' + out.length });
    }
    perSec[si]++;
  }
  out.sort((a, b) => b.y - a.y);
  return out;
}

/** The nearest feature to a point and its distance (the sound's source): the middle of a fall, the middle of a stream. null when none. */
export function nearestWater(list, x, y, z, maxD = 60) {
  let best = null;
  let bd = maxD;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const my = f.kind === 'stream' ? f.y : f.y - f.len * 0.5;
    // distance to the vertical segment of a fall (clamped), else the point
    let cy = y;
    if (f.kind !== 'stream') {
      const hi = f.y;
      const lo = f.y - f.len;
      cy = y > hi ? hi : y < lo ? lo : y;
    } else cy = my;
    const d = Math.hypot(f.x - x, cy - y, f.z - z);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best ? { f: best, d: bd } : null;
}
