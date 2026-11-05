/**
 * ABYSSAL TETHER 3D - REMAINS PLAN (pure: no three.js, no DOM, no Math.random).
 *
 * "This game is going to be definitely R-rated. I need bloodstains here and there. A lot of skeletons. I need a lot of skeletons ... here and there."
 *
 * The climbers who came before, and what the Mason fed on. planRemains(level, seed) lays out, from the level's own solids and deterministically:
 *
 *   SKELETONS   { kind, x,y,z (on the floor), yaw, section, id }   kinds are the names of the meshes in assets/models/bones.glb (build_bones.py):
 *               'slumped' against a wall face, 'hanging' from the underside of a ledge / girder, 'sprawled' / 'crumpled' / 'crawling' on a ledge
 *               top, 'ribcage' / 'loose' / 'skullpile' / 'hand' small heaps. More of them the deeper you go (S1 2 ... S8 7).
 *   STAINS      { x,y,z, nx,ny,nz, size (m), variant, rot, section }   blood decals: pools and drag marks on ledge tops around each skeleton and
 *               along the way, splatters and long runs on the wall faces at 0.6-2.4 m above a ledge. About 130 on the whole descent.
 *
 * Nothing lies within 4 m of the spawn / a checkpoint (the arrival is quiet) and nothing within 1.2 m of an anchor (a grapple target is not
 * hidden under a heap) nor on a ledge's last 0.8 m (nothing hangs off an edge). Decor only: no collision.
 */

export const REMAINS = Object.freeze({
  KINDS: ['slumped', 'hanging', 'sprawled', 'crumpled', 'crawling', 'ribcage', 'loose', 'skullpile', 'hand'],
  perSection: [2, 3, 4, 4, 5, 6, 7, 6], // skeletons per section (S1..S8)
  stainsPerSection: [8, 12, 14, 16, 18, 20, 22, 22],
  quiet: 4, // m around the spawn and the checkpoints
  anchorClear: 1.2,
  edgeClear: 0.8,
  wallReach: 8, // m: the wall a splatter looks for
  variants: 8, // the atlas has at least this many different blots (render/remainsView.js wraps any atlas size onto it)
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

/** The outward normal of the face of `s` that point (x,y,z) lies on (the nearest face). */
export function faceNormal(s, x, y, z) {
  const d = [Math.abs(x - s.minX), Math.abs(x - s.maxX), Math.abs(y - s.minY), Math.abs(y - s.maxY), Math.abs(z - s.minZ), Math.abs(z - s.maxZ)];
  let bi = 0;
  for (let i = 1; i < 6; i++) if (d[i] < d[bi]) bi = i;
  return [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][bi];
}

export function planRemains(level, seed = 0x6b0e5) {
  const rng = rngOf(seed);
  const secs = level.sections || [];
  const solids = level.solids || [];
  const hit = {};
  const out = { skeletons: [], stains: [] };
  const quiet = [];
  if (level.spawn) quiet.push(level.spawn);
  for (const s of secs) if (s.checkpoint) quiet.push(s.checkpoint);
  const anchors = level.anchors || [];
  const bad = (x, y, z) => {
    for (const q of quiet) if (Math.hypot(q.x - x, q.y - y, q.z - z) < REMAINS.quiet) return true;
    for (const a of anchors) if (Math.hypot(a.x - x, a.y - y, a.z - z) < REMAINS.anchorClear) return true;
    return false;
  };
  // floors: tops of solids that are wide enough to lie on
  const floors = solids.filter((s) => (s.kind === 'stone' || s.kind === 'metal' || s.kind === 'bridge' || s.kind === 'pillar') && s.maxX - s.minX >= 2.2 && s.maxZ - s.minZ >= 2.2 && s.maxY - s.minY >= 0.3 && s.active !== false);
  floors.sort((a, b) => a.minY - b.minY || a.minX - b.minX || a.minZ - b.minZ);
  const bySec = secs.map(() => []);
  for (const f of floors) {
    const si = level.sectionIndexAt ? level.sectionIndexAt(f.maxY) : 0;
    if (si >= 0 && si < secs.length) bySec[si].push(f);
  }
  const pickOn = (f, inset) => {
    const x0 = f.minX + inset;
    const x1 = f.maxX - inset;
    const z0 = f.minZ + inset;
    const z1 = f.maxZ - inset;
    if (x1 <= x0 || z1 <= z0) return null;
    return [x0 + rng() * (x1 - x0), f.maxY, z0 + rng() * (z1 - z0)];
  };
  const wallNear = (x, y, z, ang) => {
    const r = level.raycast(x, y, z, Math.cos(ang), 0, Math.sin(ang), REMAINS.wallReach, hit);
    if (!r || !r.solid) return null;
    const n = faceNormal(r.solid, r.x, r.y, r.z);
    if (n[1] !== 0) return null;
    return { x: r.x + n[0] * 0.012, y: r.y, z: r.z + n[2] * 0.012, nx: n[0], nz: n[2] };
  };
  const stain = (x, y, z, nx, ny, nz, size, si) => {
    out.stains.push({ x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), nx, ny, nz, size: +size.toFixed(2), variant: Math.floor(rng() * REMAINS.variants), rot: +(rng() * Math.PI * 2).toFixed(3), section: si });
  };
  for (let si = 0; si < secs.length; si++) {
    const list = bySec[si];
    if (!list.length) continue;
    const want = REMAINS.perSection[Math.min(si, REMAINS.perSection.length - 1)];
    let placed = 0;
    let tries = 0;
    while (placed < want && tries < want * 40) {
      tries++;
      const f = list[Math.floor(rng() * list.length)];
      // the kind: hanging needs a clear drop under a ledge; slumped needs a wall; the rest lie on the floor
      const r0 = rng();
      let kind = r0 < 0.16 ? 'hanging' : r0 < 0.34 ? 'slumped' : REMAINS.KINDS[2 + Math.floor(rng() * (REMAINS.KINDS.length - 2))];
      let x;
      let y;
      let z;
      let yaw = rng() * Math.PI * 2;
      if (kind === 'hanging') {
        // from the underside of a ledge: find a free column below it
        const p = pickOn(f, REMAINS.edgeClear);
        if (!p) continue;
        const under = level.raycast(p[0], f.minY - 0.05, p[2], 0, -1, 0, 3.2, hit);
        if (under) continue; // not clear for 3 m
        x = p[0];
        y = f.minY - 2.6;
        z = p[2];
        if (bad(x, y, z)) continue;
        out.skeletons.push({ kind, x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), yaw: +yaw.toFixed(3), section: si, id: 'rem-' + out.skeletons.length, hook: +f.minY.toFixed(3) });
        placed++;
        continue;
      }
      const p = pickOn(f, REMAINS.edgeClear + 0.2);
      if (!p) continue;
      [x, y, z] = p;
      if (kind === 'slumped') {
        // back to a wall: look for one within reach and sit 0.4 m off it facing out
        let ok = false;
        const a0 = rng() * Math.PI * 2;
        for (let k = 0; k < 4 && !ok; k++) {
          const w = wallNear(x, y + 0.9, z, a0 + (k * Math.PI) / 2);
          if (w && Math.hypot(w.x - x, w.z - z) <= 3.5) {
            x = w.x + w.nx * 0.42;
            z = w.z + w.nz * 0.42;
            yaw = Math.atan2(w.nx, w.nz);
            ok = true;
          }
        }
        if (!ok) kind = 'sprawled';
        // the new spot must still be on the floor
        if (x < f.minX + 0.4 || x > f.maxX - 0.4 || z < f.minZ + 0.4 || z > f.maxZ - 0.4) continue;
      }
      if (bad(x, y, z)) continue;
      out.skeletons.push({ kind, x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), yaw: +yaw.toFixed(3), section: si, id: 'rem-' + out.skeletons.length });
      placed++;
      // the blood around it: a pool, a drag mark, and a splatter on the nearest wall
      stain(x + (rng() - 0.5) * 0.5, y + 0.014, z + (rng() - 0.5) * 0.5, 0, 1, 0, 1.0 + rng() * 1.2, si);
      if (rng() < 0.7) stain(x + (rng() - 0.5) * 2.2, y + 0.013, z + (rng() - 0.5) * 2.2, 0, 1, 0, 0.5 + rng() * 0.9, si);
      const w = wallNear(x, y + 1.0, z, rng() * Math.PI * 2);
      if (w && Math.hypot(w.x - x, w.z - z) <= 7) stain(w.x, w.y + (rng() - 0.3) * 0.8, w.z, w.nx, 0, w.nz, 0.9 + rng() * 1.4, si);
    }
  }
  // the rest of the blood: here and there along the ledges and walls, more of it deeper
  for (let si = 0; si < secs.length; si++) {
    const list = bySec[si];
    if (!list.length) continue;
    const want = REMAINS.stainsPerSection[Math.min(si, REMAINS.stainsPerSection.length - 1)] - out.stains.filter((s) => s.section === si).length;
    let made = 0;
    let tries = 0;
    while (made < want && tries < want * 30) {
      tries++;
      const f = list[Math.floor(rng() * list.length)];
      const p = pickOn(f, 0.5);
      if (!p || bad(p[0], p[1], p[2])) continue;
      if (rng() < 0.5) {
        stain(p[0], p[1] + 0.013, p[2], 0, 1, 0, 0.5 + rng() * 1.6, si);
        made++;
      } else if (rng() < 0.55) {
        // down the side of the ledge it is on: the drips that ran over the edge
        const face = Math.floor(rng() * 4);
        const nx = face === 0 ? 1 : face === 1 ? -1 : 0;
        const nz = face === 2 ? 1 : face === 3 ? -1 : 0;
        const u = rng();
        const fx = nx ? (nx > 0 ? f.maxX : f.minX) + nx * 0.012 : f.minX + 0.5 + u * (f.maxX - f.minX - 1);
        const fz = nz ? (nz > 0 ? f.maxZ : f.minZ) + nz * 0.012 : f.minZ + 0.5 + u * (f.maxZ - f.minZ - 1);
        const fy = Math.max(f.minY + 0.2, f.maxY - 0.2 - rng() * Math.min(1.4, f.maxY - f.minY - 0.3));
        if (bad(fx, fy, fz)) continue;
        stain(fx, fy, fz, nx, 0, nz, 0.6 + rng() * 1.2, si);
        made++;
      } else {
        const w = wallNear(p[0], p[1] + 0.6 + rng() * 1.6, p[2], rng() * Math.PI * 2);
        if (!w || bad(w.x, w.y, w.z)) continue;
        stain(w.x, w.y, w.z, w.nx, 0, w.nz, 0.7 + rng() * 1.8, si);
        made++;
      }
    }
  }
  return out;
}
