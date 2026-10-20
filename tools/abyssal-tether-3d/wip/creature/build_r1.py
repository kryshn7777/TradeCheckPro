"""OSSUARY COLUMN (refinement round 1) - concept build of the Mason (ABYSSAL TETHER 3D, Quest 3 / WebXR).

Round-1 changes: legs are flying buttresses (open pointed arch from the flank to a free-standing knee pier
with pinnacle, spur, sheave, iron hoops), fewer and irregular (25 vs ~48); tall skyline set-pieces (open
belfry turret, snapped toppling steeple, pinnacle cluster, buttress fin with a real flying arch, I-beam,
flanged pipe) replace 27 even pinnacles; pale limestone vs dark basalt; per-vertex `glow` + `spine_s`
attributes drive crease-only ember seams that pulse head-ward; iris-trap jaws hooking inward (one long, one
bent, one snapped) with mixed ivory/iron/snapped/missing teeth; stained-glass oculi; bell wedged at the
bottom of the gullet against the forge; previous climber's grapple + frayed tether on a talon; dead miner's
lantern on a reaching foreleg; planted grapnels with rubble collars and oil-blood trails; new approach.png.


Direction A. The predator is a spine of stacked masonry vertebrae fused with
real bone and wet sinew. Every block is split along a jagged fracture that is
held open by marrow-dark tissue and bridged by tendons. Carved stone ribs arc
out like flying buttresses (voussoir arches strung with tendon "bowstrings")
and end in far-too-long, wrong-jointed bone legs with iron grapnel feet driven
into the shaft wall. The crown is a cathedral rose window: a ring of voussoirs
studded with oculi whose lights are glowing listening pits; its window has
split into a four-way maw of tracery-backed stone jaws lined with stone-shard
teeth, pale fiddlehead fronds unfurling from the gaps, saliva strands across
the opening and a ribbed lamprey throat lit from inside like a forge. Chains
pierce the flesh and hang; a rusted Lanternwright cage is fused into its back
and an iron ladder skewers its neck (human-scale cues).

No insect head, no antennae, no mandibles, no eyes.

Fully procedural and deterministic (seeded). Renders four images:
  hero.png        low, looming close-up of the opening crown (worm's-eye)
  approach.png    first-person VR view, 18 mm, ~3 m from the talon tips, player's lantern
  full.png        the whole creature descending a shaft wall in fog
  silhouette.png  flat black creature on mid grey (readability test)

Run (bpy module or Blender):
  python build.py [--out DIR] [--shots hero,full,silhouette] [--samples 40]
                  [--res 1280x720] [--seed 1313] [--fog 0.014] [--hero-fog 0.004] [--blend]
                  [--fullcam x,y,z,tx,ty,tz,lens] [--herocam fwd,dz,side,tfwd,tdz,tside,lens]
                  [--border xmin,xmax,ymin,ymax]   (crop render for detail checks)
  blender -b -P build.py -- [same options]

Also writes stats.json (spine length, vertebra count, evaluated triangle counts per
material group). Triangle counts include the render-time Subdivision/Displace
modifiers on the stone. Note: the RNG is consumed sequentially, so changing any
part's parameters reshuffles everything built after it (still deterministic).
"""

import bpy  # must be imported before bmesh / mathutils with the bpy module
import bmesh
from mathutils import Matrix, Vector

import argparse
import json
import math
import os
import random
import sys
import time
from math import comb

import numpy as np

T_START = time.time()

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
ap.add_argument("--shots", default="hero,approach,full,silhouette")
ap.add_argument("--samples", type=int, default=40)
ap.add_argument("--res", default="1280x720")
ap.add_argument("--seed", type=int, default=1313)
ap.add_argument("--fog", type=float, default=0.009)
ap.add_argument("--hero-fog", type=float, default=0.004)
ap.add_argument("--blend", action="store_true", help="also save ossuary.blend")
ap.add_argument("--threads", type=int, default=0)
ap.add_argument("--border", default="", help="xmin,xmax,ymin,ymax crop (0-1) for quick detail checks")
ap.add_argument("--fullcam", default="9.0,-25.0,-5.0,-1.0,-1.0,12.3,30", help="x,y,z,tx,ty,tz,lens")
ap.add_argument("--herocam", default="4.6,-2.4,0.5,0.2,1.3,-0.4,21", help="fwd,dz,side,tfwd,tdz,tside,lens")
ap.add_argument("--approachcam", default="5.6,-0.6,0.0,0.0,0.0,0.0,0.0,18",
                help="fwd,dz,side,dors,tfwd,tdz,tside,lens (relative to the crown)")
ap.add_argument("--app-light", type=float, default=220.0)
args = ap.parse_args(argv)
OUT = args.out
os.makedirs(OUT, exist_ok=True)
RES = tuple(int(v) for v in args.res.lower().split("x"))
SHOTS = [s.strip() for s in args.shots.split(",") if s.strip()]

SEED = args.seed
rng = random.Random(SEED)
UP = np.array([0.0, 0.0, 1.0])
DOWN = -UP


def log(*a):
    print(f"[{time.time() - T_START:7.1f}s]", *a, flush=True)


# =============================================================================
# Math helpers
# =============================================================================
def nrm(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rot(axis, ang):
    axis = nrm(axis)
    x, y, z = axis
    c, s, C = math.cos(ang), math.sin(ang), 1 - math.cos(ang)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def perp(v):
    v = nrm(v)
    a = np.array([0, 0, 1.0]) if abs(v[2]) < 0.9 else np.array([1.0, 0, 0])
    return nrm(a - a.dot(v) * v)


def bezier(ctrl, n):
    ctrl = np.asarray(ctrl, float)
    k = len(ctrl) - 1
    t = np.linspace(0, 1, n)[:, None]
    out = np.zeros((n, 3))
    for i, c in enumerate(ctrl):
        out += comb(k, i) * (t ** i) * ((1 - t) ** (k - i)) * c
    return out


def catmull(ctrl, n_per=16):
    P = np.asarray(ctrl, float)
    E = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    t = np.linspace(0, 1, n_per, endpoint=False)[:, None]
    for i in range(1, len(E) - 2):
        p0, p1, p2, p3 = E[i - 1], E[i], E[i + 1], E[i + 2]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1:])
    return np.vstack(out)


def arclen(P):
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])


def resample(P, n=None, step=None):
    L = arclen(P)
    if n is None:
        n = max(2, int(math.ceil(L[-1] / step)) + 1)
    tt = np.linspace(0, L[-1], n)
    return np.stack([np.interp(tt, L, P[:, i]) for i in range(3)], -1)


def sag_path(a, b, sag, n=24, toward=None):
    a, b = np.asarray(a, float), np.asarray(b, float)
    t = np.linspace(0, 1, n)[:, None]
    P = a + (b - a) * t
    P[:, 2] -= sag * 4 * t[:, 0] * (1 - t[:, 0])
    if toward is not None:
        P += np.asarray(toward) * (4 * t * (1 - t))
    return P


# =============================================================================
# Deterministic gradient noise (numpy, vectorised)
# =============================================================================
class Perlin:
    def __init__(self, seed):
        r = np.random.default_rng(seed + 991)
        p = r.permutation(256).astype(np.int64)
        self.p = np.concatenate([p, p])
        g = r.normal(size=(256, 3))
        self.g = g / np.linalg.norm(g, axis=1, keepdims=True)

    def noise(self, P):
        P = np.asarray(P, float).reshape(-1, 3)
        Pf = np.floor(P)
        f = P - Pf
        Pi = Pf.astype(np.int64)
        u = f * f * f * (f * (f * 6 - 15) + 10)
        p, g = self.p, self.g
        out = np.zeros(len(P))
        for dx in (0, 1):
            X = p[(Pi[:, 0] + dx) & 255]
            wx = u[:, 0] if dx else 1 - u[:, 0]
            for dy in (0, 1):
                XY = p[X + ((Pi[:, 1] + dy) & 255)]
                wy = u[:, 1] if dy else 1 - u[:, 1]
                for dz in (0, 1):
                    h = p[XY + ((Pi[:, 2] + dz) & 255)]
                    wz = u[:, 2] if dz else 1 - u[:, 2]
                    gg = g[h]
                    d = gg[:, 0] * (f[:, 0] - dx) + gg[:, 1] * (f[:, 1] - dy) + gg[:, 2] * (f[:, 2] - dz)
                    out += wx * wy * wz * d
        return out * 1.6

    def fbm(self, P, octaves=4, lac=2.03, gain=0.5):
        P = np.asarray(P, float).reshape(-1, 3)
        tot = np.zeros(len(P))
        amp, norm, f = 1.0, 0.0, 1.0
        for o in range(octaves):
            tot += amp * self.noise(P * f + o * 17.31)
            norm += amp
            amp *= gain
            f *= lac
        return tot / norm

    def vec(self, P, octaves=3):
        P = np.asarray(P, float).reshape(-1, 3)
        return np.stack([self.fbm(P + o, octaves) for o in (0.0, 31.7, 77.1)], -1)


NZ = Perlin(SEED)


# =============================================================================
# Mesh accumulation (numpy -> one Blender mesh per material group)
# =============================================================================
class Acc:
    def __init__(self, name):
        self.name = name
        self.V, self.flat, self.sizes, self.uv, self.m, self.g = [], [], [], [], [], []
        self.n = 0

    def add(self, V, faces, uv=None, m=None, g=None):
        V = np.asarray(V, float).reshape(-1, 3)
        if len(V) == 0:
            return
        if isinstance(faces, np.ndarray):
            faces = [faces]
        elif len(faces) and not (isinstance(faces[0], np.ndarray) and faces[0].ndim == 2):
            faces = [faces]
        for F in faces:
            if isinstance(F, np.ndarray):
                if F.size == 0:
                    continue
                self.flat.append(F.ravel().astype(np.int64) + self.n)
                self.sizes.append(np.full(len(F), F.shape[1], np.int64))
            else:
                if not F:
                    continue
                self.flat.append(np.fromiter((i for f in F for i in f), np.int64) + self.n)
                self.sizes.append(np.array([len(f) for f in F], np.int64))
        self.V.append(V)
        self.uv.append(np.zeros((len(V), 2)) if uv is None else np.asarray(uv, float).reshape(-1, 2))
        if m is None:
            mm = np.zeros(len(V))
        else:
            mm = np.broadcast_to(np.asarray(m, float), (len(V),)).copy()
        self.m.append(mm)
        if g is None:
            gg = np.zeros(len(V))
        else:
            gg = np.broadcast_to(np.asarray(g, float), (len(V),)).copy()
        self.g.append(gg)
        self.n += len(V)

    def add_bm(self, bm, m=0.0, free=True, g=None):
        V, F = bm_arrays(bm)
        self.add(V, F, m=m, g=g)
        if free:
            bm.free()

    @staticmethod
    def _along(P, V, al, m):
        if isinstance(m, str):
            return al
        m = np.asarray(m, float)
        if m.ndim and len(m) == len(P) and len(P) != len(V):
            Ln = arclen(np.asarray(P, float))
            return np.interp(al, Ln / max(Ln[-1], 1e-9), m)
        return m

    def add_tube(self, P, r, m="along", g=None, **kw):
        V, F, uv, al = tube(P, r, **kw)
        mv = self._along(P, V, al, m)
        gv = None if g is None else self._along(P, V, al, g)
        self.add(V, F, uv, mv, gv)
        return V

    def build(self, mat, coll, smooth=True, sharp=None):
        if self.n == 0:
            return None
        V = np.vstack(self.V)
        flat = np.concatenate(self.flat)
        sizes = np.concatenate(self.sizes)
        starts = np.concatenate([[0], np.cumsum(sizes)[:-1]])
        me = bpy.data.meshes.new(self.name)
        me.vertices.add(len(V))
        me.vertices.foreach_set("co", V.astype(np.float32).ravel())
        me.loops.add(len(flat))
        me.loops.foreach_set("vertex_index", flat.astype(np.int32))
        me.polygons.add(len(sizes))
        me.polygons.foreach_set("loop_start", starts.astype(np.int32))
        me.polygons.foreach_set("loop_total", sizes.astype(np.int32))
        me.update(calc_edges=True)
        uv = np.vstack(self.uv)[flat]
        lay = me.uv_layers.new(name="UVMap")
        lay.data.foreach_set("uv", uv.astype(np.float32).ravel())
        at = me.attributes.new("m", "FLOAT", "POINT")
        at.data.foreach_set("value", np.concatenate(self.m).astype(np.float32))
        # per-vertex glow (bakes straight to an emissive map) + spine coordinate (drives the headward pulse)
        at = me.attributes.new("glow", "FLOAT", "POINT")
        at.data.foreach_set("value", np.concatenate(self.g).astype(np.float32))
        if self.name.startswith("Ossuary_"):
            at = me.attributes.new("spine_s", "FLOAT", "POINT")
            at.data.foreach_set("value", spine_param(V).astype(np.float32))
        me.polygons.foreach_set("use_smooth", np.full(len(sizes), bool(smooth)))
        if smooth and sharp:
            me.set_sharp_from_angle(angle=sharp)
        me.materials.append(mat)
        ob = bpy.data.objects.new(self.name, me)
        coll.objects.link(ob)
        return ob


def bm_arrays(bm):
    bm.verts.index_update()
    V = np.array([v.co[:] for v in bm.verts]) if len(bm.verts) else np.zeros((0, 3))
    F = [[v.index for v in f.verts] for f in bm.faces]
    return V, F


# =============================================================================
# Primitive generators
# =============================================================================
def frames(P, up=None):
    P = np.asarray(P, float)
    n = len(P)
    T = nrm(np.gradient(P, axis=0))
    if up is not None:
        U = np.broadcast_to(np.asarray(up, float), P.shape)
        N = U - (U * T).sum(1, keepdims=True) * T
        N = nrm(N)
    else:
        N = np.zeros_like(P)
        N[0] = perp(T[0])
        for i in range(1, n):
            v = N[i - 1] - N[i - 1].dot(T[i]) * T[i]
            ln = np.linalg.norm(v)
            N[i] = v / ln if ln > 1e-9 else N[i - 1]
    B = np.cross(T, N)
    return T, N, B


def circle_prof(sides, phase=0.0):
    th = np.linspace(0, 2 * math.pi, sides, endpoint=False) + phase
    return np.stack([np.cos(th), np.sin(th)], -1)


def loft(P, prof, up=None, cap0=True, cap1=True, nz_amp=0.0, nz_freq=3.0, nz_seed=0.0, fr=None,
         flip=False):
    """Sweep a closed CCW profile (n,K,2) in the (N,B) frame along path P (n,3)."""
    P = np.asarray(P, float)
    n = len(P)
    prof = np.asarray(prof, float)
    if prof.ndim == 2:
        prof = np.broadcast_to(prof, (n,) + prof.shape)
    K = prof.shape[1]
    T, N, B = fr if fr is not None else frames(P, up)
    ring = P[:, None, :] + prof[:, :, 0:1] * N[:, None, :] + prof[:, :, 1:2] * B[:, None, :]
    if nz_amp:
        f = 1 + nz_amp * NZ.fbm(ring.reshape(-1, 3) * nz_freq + nz_seed, 3)
        ring = P[:, None, :] + (ring - P[:, None, :]) * f.reshape(n, K, 1)
    ring = np.concatenate([ring, ring[:, :1]], 1)
    V = ring.reshape(-1, 3)
    idx = np.arange(n * (K + 1)).reshape(n, K + 1)
    quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    if flip:
        quads = quads[:, ::-1]
    L = arclen(P)
    uv = np.stack([np.tile(np.arange(K + 1) / K, n), np.repeat(L, K + 1)], -1)
    along = np.repeat(L / max(L[-1], 1e-9), K + 1)
    faces, Vs, uvs, als = [quads], [V], [uv], [along]
    base = len(V)
    if cap0:
        Vs.append(P[:1]); uvs.append([[0.5, 0.0]]); als.append([0.0])
        faces.append(np.stack([np.full(K, base), idx[0, 1:], idx[0, :-1]], -1))
        base += 1
    if cap1:
        Vs.append(P[-1:]); uvs.append([[0.5, L[-1]]]); als.append([1.0])
        faces.append(np.stack([np.full(K, base), idx[-1, :-1], idx[-1, 1:]], -1))
        base += 1
    return np.vstack(Vs), faces, np.vstack(uvs), np.concatenate(als)


def tube(P, r, sides=8, up=None, ry=None, cap0=True, cap1=True, nz_amp=0.0, nz_freq=3.0, seed=0.0,
         fr=None, flip=False, phase=0.0):
    P = np.asarray(P, float)
    n = len(P)
    rx = np.broadcast_to(np.asarray(r, float), (n,))
    ryy = rx if ry is None else np.broadcast_to(np.asarray(ry, float), (n,))
    c = circle_prof(sides, phase)
    prof = np.stack([c[None, :, 0] * rx[:, None], c[None, :, 1] * ryy[:, None]], -1)
    return loft(P, prof, up=up, cap0=cap0, cap1=cap1, nz_amp=nz_amp, nz_freq=nz_freq, nz_seed=seed,
                fr=fr, flip=flip)


_ICO = {}


def ico(sub):
    if sub not in _ICO:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        V, F = bm_arrays(bm)
        bm.free()
        _ICO[sub] = (V, np.array(F))
    return _ICO[sub]


def blob(center, axes, sub=3, amp=0.15, freq=1.5, seed=0.0):
    V, F = ico(sub)
    d = 1 + amp * NZ.fbm(V * freq + seed, 3)
    W = (V * d[:, None]) @ np.asarray(axes, float)
    return W + np.asarray(center, float), F


def basis_axes(x, y, z, sx, sy, sz):
    return np.stack([nrm(x) * sx, nrm(y) * sy, nrm(z) * sz])


def shard(root, direction, length, base_r, hook_dir=None, hook=0.25, sides=5, rings=7, flat=1.0,
          rr=None, sink=0.04, fang=False, trunc=1.0):
    """Tapered, faceted stone/bone spike with an irregular cross-section and a hook (trunc<1: snapped)."""
    rr = rr or rng
    d = nrm(direction)
    hd = nrm(hook_dir - np.dot(hook_dir, d) * d) if hook_dir is not None else perp(d)
    t = np.linspace(0, trunc, rings)
    root = np.asarray(root, float) - d * sink
    P = root[None] + d[None] * (length * t)[:, None] + hd[None] * (length * hook * t ** 2.2)[:, None]
    jit, lo, hi, ex = (0.1, 0.9, 1.1, 0.8) if fang else (0.35, 0.65, 1.3, 1.15)
    th = np.sort(np.array([2 * math.pi * i / sides + rr.uniform(-jit, jit) for i in range(sides)]))
    rad = np.array([rr.uniform(lo, hi) for _ in range(sides)])
    base = np.stack([np.cos(th) * rad, np.sin(th) * rad * flat], -1)
    taper = base_r * (1 - t) ** ex
    prof = base[None] * taper[:, None, None]
    V, F, uv, al = loft(P, prof, up=hd, cap0=True, cap1=trunc < 1.0)
    return V, F, uv, al * trunc


# -----------------------------------------------------------------------------
# Stone blocks (bmesh): chamfered, worn, chipped, split along jagged fractures
# -----------------------------------------------------------------------------
def bm_cut(bm, co, no, keep_neg=True):
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no),
                               clear_outer=keep_neg, clear_inner=not keep_neg, dist=1e-6)
    return [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]


def stone_bm(dims, chamfer=0.18, wear=0.025, chips=3, subdiv=1, rr=None):
    rr = rr or rng
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(dims), verts=bm.verts)
    if chamfer > 0:
        ed = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().y) > 0.9]
        bmesh.ops.bevel(bm, geom=ed, offset=chamfer * min(dims[0], dims[2]), offset_type="OFFSET",
                        segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
    if wear > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=wear, offset_type="OFFSET", segments=1,
                        profile=0.5, affect="EDGES", clamp_overlap=True)
    if subdiv:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=subdiv, use_grid_fill=True)
    for _ in range(chips):
        d = Vector((rr.choice((-1, 1)) * rr.uniform(0.3, 1.0), rr.uniform(-1, 1),
                    rr.choice((-1, 1)) * rr.uniform(0.3, 1.0))).normalized()
        sup = max(v.co.dot(d) for v in bm.verts)
        depth = rr.uniform(0.05, 0.17) * min(dims)
        edges = bm_cut(bm, d * (sup - depth), d, True)
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    return bm


def order_loops(edges):
    adj = {}
    for e in edges:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        prev, cur = None, start
        while True:
            nxt = None
            for v in adj[cur]:
                if v is not prev and v not in seen:
                    nxt = v
                    break
            if nxt is None:
                break
            loop.append(nxt)
            seen.add(nxt)
            prev, cur = cur, nxt
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def polar_cap(bm, loop, rings=4):
    co = [v.co.copy() for v in loop]
    c = sum(co, Vector()) / len(co)
    prev, allv = loop, list(loop)
    for k in range(1, rings):
        t = 1 - k / rings
        ring = [bm.verts.new(c + (p - c) * t) for p in co]
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            try:
                bm.faces.new((prev[i], prev[j], ring[j], ring[i]))
            except ValueError:
                pass
        prev = ring
        allv += ring
    cv = bm.verts.new(c)
    allv.append(cv)
    for i in range(len(prev)):
        j = (i + 1) % len(prev)
        try:
            bm.faces.new((prev[i], prev[j], cv))
        except ValueError:
            pass
    return allv


def split_stone(bm, p, n, g, amp, freq, nseed):
    """Split a stone along plane (p, n), removing a slab of width g. Both fracture faces get the
    same jagged relief, so the halves read as one stone broken and pulled apart."""
    n = Vector(n).normalized()
    p = Vector(p)
    nn, pp = np.array(n[:]), np.array(p[:])
    out = []
    for side in (-1, 1):
        b = bm.copy()
        edges = bm_cut(b, p + n * (side * g / 2), n, keep_neg=(side < 0))
        if len(b.verts) == 0:
            b.free()
            continue
        capv = []
        for lp in order_loops(edges):
            capv += polar_cap(b, lp)
        bmesh.ops.recalc_face_normals(b, faces=b.faces[:])
        if capv and amp > 0:
            X = np.array([v.co[:] for v in capv])
            proj = X - np.outer((X - pp) @ nn, nn)
            off = amp * NZ.fbm(proj * freq + nseed, 3)
            for v, o in zip(capv, off):
                v.co += n * float(o)
        out.append(b)
    return out


def box_support(dims, u):
    """Distance from the centre of a box (dims) to its surface along unit direction u."""
    u = np.abs(np.asarray(u, float))
    h = np.asarray(dims, float) / 2
    with np.errstate(divide="ignore"):
        t = np.where(u > 1e-6, h / np.maximum(u, 1e-6), 1e9)
    return float(t.min())


def mat4(S, T, D, O):
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = S, T, D, O
    return M


def xf(V, M):
    return np.asarray(V, float) @ M[:3, :3].T + M[:3, 3]


def xd(v, M):
    return M[:3, :3] @ np.asarray(v, float)


def bm_xf(bm, M):
    bmesh.ops.transform(bm, matrix=Matrix(M.tolist()), verts=bm.verts)


# =============================================================================
# Accumulators (material groups)
# =============================================================================
A = {k: Acc("Ossuary_" + k) for k in
     ("Stone", "Carved", "Flesh", "Tendon", "Marrow", "Bone", "Iron", "Teeth", "Ember", "Frond",
      "Mucus", "Vein", "Membrane", "Gum", "Pit", "Bronze", "Seam", "Glass", "Rope", "Oil", "IronTooth")}
ENV = {k: Acc("Shaft_" + k) for k in ("Rock", "Masonry", "Iron", "Glow", "Rubble", "Oil")}


# =============================================================================
# The shaft wall (interior of a 30 m radius cylinder) and the spine path
# =============================================================================
R_SHAFT = 30.0


def wall_disp(px, z):
    px = np.asarray(px, float).ravel()
    z = np.broadcast_to(np.asarray(z, float).ravel(), px.shape)
    q = np.stack([px, z, np.zeros_like(px)], -1)
    d = 0.42 * NZ.fbm(q * 0.06, 4) + 0.2 * NZ.fbm(q * 0.21 + 7.3, 3) + 0.06 * NZ.fbm(q * 0.9 + 3.1, 2)
    zz = z / 3.3 + 1.4 * NZ.fbm(q * 0.03 + 11.0, 3) + 0.25 * NZ.fbm(q * 0.15 + 2.0, 2)
    saw = zz - np.floor(zz)
    amp = np.clip(0.5 + 1.2 * NZ.fbm(q * 0.07 + 5.0, 2), 0, 1)
    # strata: stepped bedding ledges
    amp2 = np.clip(1.6 * NZ.fbm(q * 0.045 + 15.0, 2), 0, 1)
    d += 0.07 * np.clip((saw - 0.6) / 0.4, 0, 1) ** 0.8 * amp * amp2
    # a few deep fractures (ridged noise on a warped domain -> narrow V grooves), not a crackle
    w = q * 0.05 + 0.6 * NZ.vec(q * 0.03 + 4.0, 2)
    rid = np.abs(NZ.fbm(w + 21.0, 2))
    fmask = np.clip(0.4 + 1.6 * NZ.fbm(q * 0.035 + 9.0, 2), 0, 1)
    d -= 0.42 * np.clip(1.0 - rid / 0.07, 0, 1) ** 1.6 * fmask
    rid2 = np.abs(NZ.fbm(w * 2.3 + 40.0, 2))
    d -= 0.16 * np.clip(1.0 - rid2 / 0.05, 0, 1) ** 1.6 * fmask * amp
    return d


def wall_point(px, z, h=0.0, disp=True):
    px = np.atleast_1d(np.asarray(px, float))
    z = np.broadcast_to(np.asarray(z, float), px.shape)
    phi = px / R_SHAFT
    d = wall_disp(px, z).reshape(px.shape) if disp else 0.0
    r = R_SHAFT - d - h
    return np.stack([r * np.sin(phi), -R_SHAFT + r * np.cos(phi), z], -1)


def wall_coords(p):
    phi = math.atan2(p[0], p[1] + R_SHAFT)
    return R_SHAFT * phi, p[2], phi


def project_wall(p, embed=0.0):
    px, z, phi = wall_coords(p)
    w = wall_point(px, z, -embed, disp=True)[0]
    nout = np.array([math.sin(phi), math.cos(phi), 0.0])
    return w, nout


# Spine control points in wall coordinates (arc-x, z, height off the wall), head -> tail.
# The front rears off the wall toward the viewer like a cobra; the body is an S-curve.
SPINE_CTRL = np.array([
    (6.7, 4.0, 3.9),
    (5.55, 4.65, 3.45),
    (4.15, 5.9, 2.65),
    (2.8, 7.6, 1.8),
    (1.1, 9.6, 1.45),
    (-0.8, 11.8, 1.42),
    (-2.5, 14.0, 1.4),
    (-3.2, 16.4, 1.38),
    (-3.0, 18.8, 1.34),
    (-4.1, 21.0, 1.28),
    (-6.3, 22.8, 1.2),
    (-8.8, 24.0, 1.1),
    (-11.3, 24.8, 1.0),
])
_dense = catmull(SPINE_CTRL, 40)
SP = wall_point(_dense[:, 0], _dense[:, 1], _dense[:, 2], disp=False)
SP = resample(SP, step=0.02)
SL = arclen(SP)
L_TOTAL = float(SL[-1])


def spine_pos(s):
    s = np.atleast_1d(np.asarray(s, float))
    out = np.stack([np.interp(np.clip(s, 0, L_TOTAL), SL, SP[:, i]) for i in range(3)], -1)
    T0 = nrm(SP[0] - SP[5])
    T1 = nrm(SP[-1] - SP[-6])
    lo, hi = s < 0, s > L_TOTAL
    out[lo] = SP[0] + T0 * (-s[lo])[:, None]
    out[hi] = SP[-1] + T1 * (s[hi] - L_TOTAL)[:, None]
    return out


def spine_frame(s):
    s = float(s)
    P = spine_pos(s)[0]
    ss = min(max(s, 0.06), L_TOTAL - 0.06)
    a, b = spine_pos([ss - 0.06, ss + 0.06])
    T = nrm(a - b)
    phi = math.atan2(P[0], P[1] + R_SHAFT)
    nin = np.array([-math.sin(phi), -math.cos(phi), 0.0])
    D = nrm(nin - nin.dot(T) * T)
    S = np.cross(T, D)
    return P, T, D, S


def spine_frames(svals):
    out = [spine_frame(s) for s in svals]
    return [np.array([o[i] for o in out]) for i in range(4)]


_SPK = None


def spine_param(V):
    """Arc-length coordinate of the nearest spine sample for each point (head = 0)."""
    global _SPK
    if _SPK is None:
        idx = np.arange(0, len(SP), 5)
        _SPK = (SP[idx], SL[idx])
    Pk, Sk = _SPK
    V = np.asarray(V, float).reshape(-1, 3)
    out = np.empty(len(V))
    for a in range(0, len(V), 20000):
        blk = V[a:a + 20000]
        d2 = ((blk[:, None, :] - Pk[None, :, :]) ** 2).sum(-1)
        out[a:a + 20000] = Sk[np.argmin(d2, 1)]
    return out


def kprof(s):
    if s < 5.0:
        return 0.6 + 0.4 * float(smoothstep(0.9, 5.0, s))
    if s < 11.0:
        return 1.0
    return 1.0 - 0.56 * ((s - 11.0) / (L_TOTAL - 11.0)) ** 1.15


def vertebra_positions():
    out, s = [], 1.42
    while s < L_TOTAL - 0.7:
        out.append(s)
        s += 1.34 * kprof(s + 0.65)
    return out


VERT_S = vertebra_positions()
# tall, irregular skyline set-pieces along the dorsal line (cathedral vocabulary breaks the bug read)
SKYLINE_AT = {"belfry": 6.3, "spire": 12.4, "ibeam": 15.0, "cluster": 17.6, "fin": 21.4, "pipe": 25.6}
SKYLINE = {name: int(np.argmin([abs(v - t) for v in VERT_S])) for name, t in SKYLINE_AT.items()}
SKYLINE_IDX = set(SKYLINE.values())

RING_S = 0.42          # crown ring centre along the spine
RING_RI, RING_RO, RING_DEPTH = 1.05, 1.72, 0.8
_o, _t, _d, _s = spine_frame(RING_S)
CROWN_PRE = dict(C=_o, T=_t, D=_d, S=_s)


# =============================================================================
# Body: vertebrae
# =============================================================================
def crack_tendons(M, p, n, g, dims, count, k, acc=None):
    """Tendons bridging a fracture near its rim, plus the bulging marrow slab inside it."""
    acc = acc or A["Tendon"]
    n = nrm(n)
    u = perp(n)
    w = np.cross(n, u)
    for _ in range(count):
        th = rng.uniform(0, 2 * math.pi)
        dirr = math.cos(th) * u + math.sin(th) * w
        sup = box_support(dims, dirr) * rng.uniform(0.78, 0.93)
        q = p + dirr * sup
        a = q - n * (g / 2 + 0.05 * k)
        b = q + n * (g / 2 + 0.05 * k)
        P = sag_path(a, b, 0.0, 8, toward=dirr * rng.uniform(0.0, 0.05) * k)
        r = rng.uniform(0.012, 0.03) * k * (1 + 0.35 * np.sin(np.linspace(0, math.pi, 8)))
        acc.add_tube(xf(P, M), r, sides=6, cap0=False, cap1=False)


def marrow_slab(M, p, n, g, dims, k, bulge=1.06):
    n = nrm(n)
    u = perp(n)
    w = np.cross(n, u)
    su = box_support(dims, u) * bulge
    sw = box_support(dims, w) * bulge
    axes = basis_axes(u, w, n, su, sw, g / 2 + 0.05 * k)
    V, F = blob(p, axes, sub=3, amp=0.12, freq=2.2 / k, seed=rng.random() * 50)
    A["Marrow"].add(xf(V, M), F, g=0.55 if rng.random() < 0.6 else 0.0)
    # a second, smaller wet tissue layer bulging out of the crack mouth
    V, F = blob(p, basis_axes(u, w, n, su * 1.02, sw * 1.02, g * 0.32), sub=3, amp=0.18,
                freq=3.0 / k, seed=rng.random() * 50)
    A["Flesh"].add(xf(V, M), F, m=0.0)


def surface_veins(M, dims, k, count=3):
    """Random-walk veins crawling over the flat faces of a block (lateral and dorsal)."""
    W, Lb, H = dims
    for _ in range(count):
        face = rng.choice(("+x", "-x", "+z"))
        pts = []
        if face == "+z":
            p = np.array([rng.uniform(-0.3, 0.3) * W, rng.choice((-0.5, 0.5)) * Lb, H / 2 + 0.012])
            d = np.array([rng.uniform(-0.5, 0.5), -np.sign(p[1]), 0.0])
        else:
            sx = 1 if face == "+x" else -1
            p = np.array([sx * (W / 2 + 0.012), rng.choice((-0.5, 0.5)) * Lb, rng.uniform(-0.2, 0.2) * H])
            d = np.array([0.0, -np.sign(p[1]), rng.uniform(-0.5, 0.5)])
        d = nrm(d)
        steps = rng.randint(10, 22)
        for i in range(steps):
            pts.append(p.copy())
            ang = rng.uniform(-0.6, 0.6)
            if face == "+z":
                R2 = rot(UP, ang)
            else:
                R2 = rot(np.array([1.0, 0, 0]), ang)
            d = R2 @ d
            p = p + d * 0.05 * k
            if face == "+z":
                p[0] = np.clip(p[0], -0.33 * W, 0.33 * W)
                p[1] = np.clip(p[1], -0.5 * Lb, 0.5 * Lb)
            else:
                p[2] = np.clip(p[2], -0.28 * H, 0.28 * H)
                p[1] = np.clip(p[1], -0.5 * Lb, 0.5 * Lb)
        P = np.array(pts)
        if len(P) < 4:
            continue
        r = np.linspace(0.016, 0.004, len(P)) * k
        A["Vein"].add_tube(xf(P, M), r, sides=5, g=float(rng.random() < 0.45))


def rebar(start, direction, length, bend_dir, bend=0.3, r=0.016, acc=None):
    acc = acc or A["Iron"]
    d = nrm(direction)
    P = bezier([start, start + d * length * 0.5, start + d * length + nrm(bend_dir) * length * bend], 14)
    t = np.linspace(0, 1, len(P))
    rad = r * (1 + 0.12 * np.sin(t * arclen(P)[-1] * 70)) * np.where(t > 0.86, (1 - t) / 0.14 * 0.85 + 0.15, 1)
    acc.add_tube(P, rad, sides=6, cap0=False)


def iron_band(M, dims, chamfer, y0, k, broken=False):
    W, Lb, H = dims
    c = chamfer * min(W, H)
    hw, hh = W / 2 + 0.03 * k, H / 2 + 0.03 * k
    oct_ = np.array([(hw, -(hh - c)), (hw, hh - c), (hw - c, hh), (-(hw - c), hh), (-hw, hh - c),
                     (-hw, -(hh - c)), (-(hw - c), -hh), (hw - c, -hh)])
    loop = np.vstack([oct_, oct_[:1]])
    pts = np.stack([loop[:, 0], np.full(len(loop), y0), loop[:, 1]], -1)
    P = resample(pts, step=0.05 * k)
    if broken:
        a = rng.uniform(0.0, 0.5)
        n0 = int(len(P) * a)
        P = np.vstack([P[n0:], P[1:n0]])[: int(len(P) * 0.78)]
        # pry the free ends outward
        t = np.linspace(0, 1, len(P))
        out = nrm(P * np.array([1, 0, 1]))
        P = P + out * (0.18 * k * (np.clip(0.15 - t, 0, 1) / 0.15) ** 2 + 0.22 * k * (np.clip(t - 0.85, 0, 1) / 0.15) ** 2)[:, None]
    else:
        P = P[:-1]
        P = np.vstack([P, P[:1]])
    yax = np.array([0, 1.0, 0])
    T, N, B = frames(P, up=yax)
    prof = np.array([(-0.075, -0.02), (0.075, -0.02), (0.075, 0.02), (-0.075, 0.02)]) * np.array([k, k])
    V, F, uv, al = loft(P, prof, fr=(T, N, B), cap0=broken, cap1=broken)
    A["Iron"].add(xf(V, M), F, uv, m=0.0)
    # rivets
    for i in range(0, len(P) - 1, 3):
        outd = nrm(np.cross(T[i], N[i]))
        if outd.dot(nrm(P[i] * np.array([1, 0, 1]))) < 0:
            outd = -outd
        V, F = blob(P[i] + outd * 0.022 * k, basis_axes(N[i], T[i], outd, 0.03 * k, 0.03 * k, 0.022 * k),
                    sub=1, amp=0.0)
        A["Iron"].add(xf(V, M), F, m=0.0)


def pinnacle(M, base, direction, height, r0, k, broken=False, crockets=True, acc=None):
    """Raked stone pinnacle (neural spine) with hooked Gothic crockets."""
    acc = acc or A["Carved"]
    d = nrm(direction)
    hook = nrm(np.array([0.0, -1.0, 0.25]))
    frac = rng.uniform(0.5, 0.7) if broken else 1.0
    n = 12
    t = np.linspace(0, frac, n)
    P = base[None] + d[None] * (height * t)[:, None] + hook[None] * (height * 0.22 * t ** 2.4)[:, None]
    sides = 5
    th = np.sort(np.array([2 * math.pi * i / sides + rng.uniform(-0.3, 0.3) for i in range(sides)]))
    rad = np.array([rng.uniform(0.7, 1.25) for _ in range(sides)])
    prof0 = np.stack([np.cos(th) * rad, np.sin(th) * rad * 1.35], -1)
    taper = r0 * (1 - t) ** 1.1 + (0.0 if not broken else 0.015)
    prof = prof0[None] * taper[:, None, None]
    V, F, uv, al = loft(P, prof, up=np.array([1.0, 0, 0]), cap0=True, cap1=True)
    acc.add(xf(V, M), F, uv, m=0.0)
    if broken:
        for _ in range(rng.randint(1, 3)):
            rebar(xf(P[-1:], M)[0] - xd(d, M) * 0.2, xd(d + np.array([rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.3), 0]), M),
                  rng.uniform(0.35, 0.9) * k, xd(np.array([rng.uniform(-1, 1), -1, 0]), M), 0.25, 0.014 * k)
    if crockets:
        for j in range(rng.randint(3, 5)):
            tt = rng.uniform(0.15, 0.8) * frac
            i = int(tt / frac * (n - 1))
            side = np.array([rng.choice((-1, 1)), rng.uniform(-0.3, 0.3), 0.0])
            root = P[i] + nrm(side) * taper[i] * 0.8
            V, F, uv, al = shard(root, nrm(side * 0.9 + d * 0.8), rng.uniform(0.16, 0.32) * k,
                                 0.06 * k, hook_dir=-d + np.array([0, -0.4, 0]), hook=0.55, rings=6)
            acc.add(xf(V, M), F, uv, m=0.0)


def ray_box(p, d, half):
    """Distance from p (inside the box) along unit d to the box surface."""
    p, d = np.asarray(p, float), np.asarray(d, float)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(np.abs(d) > 1e-6, (np.sign(d) * half - p) / np.where(np.abs(d) > 1e-6, d, 1.0), 1e9)
    return float(np.min(t))


def crack_seam(M, p, n, dims, k, strength=1.0):
    """A dim ember line along the mouth of a fracture (the rim where plane (p, n) meets the block)."""
    n = nrm(n)
    u = perp(n)
    w = np.cross(n, u)
    half = np.asarray(dims, float) / 2
    th = np.linspace(0, 2 * math.pi, 64)
    pts = []
    for a in th:
        d = math.cos(a) * u + math.sin(a) * w
        pts.append(p + d * ray_box(p, d, half) * 0.965)
    P = np.array(pts)
    P = P + NZ.vec(P * 3.0 / k + 5.0) * 0.03 * k
    gl = strength * np.clip(0.25 + 1.2 * NZ.fbm(P * 1.3 + 2.0, 2), 0.0, 1.0)
    A["Seam"].add_tube(xf(P, M), 0.03 * k, sides=6, cap0=False, cap1=False, g=gl)


def lancet_niche(M, face_c, nrm_out, up, width, height, k, inner="Marrow"):
    """Carved lancet window on a block face: moulded frame + cusps, dark flesh showing through."""
    nrm_out, up = nrm(nrm_out), nrm(up)
    ax = np.cross(up, nrm_out)
    R = width * 1.45
    thp = math.acos((R - width / 2) / R)
    rise = R * math.sin(thp)
    hs = height - rise
    pts = [(-width / 2, 0.0), (-width / 2, hs)]
    pts += [(-width / 2 + R + R * math.cos(a), hs + R * math.sin(a)) for a in np.linspace(math.pi, math.pi - thp, 8)[1:]]
    pts += [(width / 2 - R + R * math.cos(a), hs + R * math.sin(a)) for a in np.linspace(thp, 0, 8)[1:]]
    pts += [(width / 2, 0.0), (-width / 2, 0.0)]
    Q = np.array([face_c + ax * x + up * (y - height / 2) + nrm_out * 0.035 * k for x, y in pts])
    Q = resample(Q, step=0.03)
    A["Carved"].add_tube(xf(Q, M), 0.042 * k, sides=4, cap0=False, cap1=False, phase=math.pi / 4)
    # recessed panel: dark wet tissue where the window was pierced through
    ny = 10
    ys = np.linspace(0.02, height - 0.05, ny)
    rows = []
    for y in ys:
        if y <= hs:
            hw = width / 2 - 0.03
        else:
            xx = R - width / 2
            hw = max(math.sqrt(max(R * R - (y - hs) ** 2, 0.0)) - xx - 0.03, 0.01)
        xs = np.linspace(-hw, hw, 6)
        rows.append([face_c + ax * x + up * (y - height / 2) + nrm_out * 0.012 * k for x in xs])
    G = np.array(rows)
    G += nrm_out[None, None] * (0.02 * k * NZ.fbm(G.reshape(-1, 3) * 6.0, 2).reshape(G.shape[:2]))[..., None]
    idx = np.arange(G.shape[0] * G.shape[1]).reshape(G.shape[:2])
    quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    if np.dot(np.cross(ax, up), nrm_out) < 0:
        quads = quads[:, ::-1]
    A[inner].add(xf(G.reshape(-1, 3), M), quads, g=0.0)
    # cusp thorns on the intrados
    for sx in (-1, 1):
        q = face_c + ax * sx * width * 0.36 + up * (hs + rise * 0.35 - height / 2) + nrm_out * 0.03 * k
        V, F, uv, al = shard(q, nrm(-ax * sx + up * 0.2), 0.11 * k, 0.03 * k, sides=4, rings=4, hook=0.0)
        A["Carved"].add(xf(V, M), F, uv)


VERTS = []


def build_vertebra(idx, s, k):
    O, T, D, S = spine_frame(s)
    M = mat4(S, T, D, O)
    W, H, Lb = 1.9 * k, 1.36 * k, 0.98 * k
    dims = (W, Lb, H)
    chamfer = 0.28
    bm = stone_bm(dims, chamfer=chamfer, wear=0.035 * k, chips=rng.randint(3, 6), subdiv=2)
    pieces = [bm]
    cracks = []
    ncr = 2 if rng.random() < 0.4 else 1
    for c in range(ncr):
        a = rng.uniform(0.15, math.pi - 0.15) if c == 0 else rng.uniform(-0.5, 0.5)
        if c == 0:
            n = np.array([math.cos(a), rng.uniform(-0.3, 0.3), math.sin(a)])
        else:
            n = np.array([rng.uniform(-0.3, 0.3), 1.0, rng.uniform(-0.4, 0.4)])
        n = nrm(n)
        p = np.array([rng.uniform(-0.18, 0.18) * W, rng.uniform(-0.12, 0.12) * Lb, rng.uniform(-0.15, 0.15) * H])
        g = rng.uniform(0.07, 0.15) * k
        new = []
        for pc in pieces:
            new += split_stone(pc, p, n, g, amp=0.075 * k, freq=2.6 / k, nseed=rng.random() * 100)
            pc.free()
        pieces = new
        cracks.append((p, n, g))
    pull = {}
    for pc in pieces:
        if len(pc.verts) == 0:
            continue
        cen = np.mean([v.co[:] for v in pc.verts], axis=0)
        off = np.zeros(3)
        for (p, n, g) in cracks:
            off += np.sign(np.dot(cen - p, n)) * n * rng.uniform(0.015, 0.05) * k
        Rm = rot(np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)]), math.radians(rng.uniform(0.5, 3.0)))
        Mp = np.eye(4)
        Mp[:3, :3] = Rm
        Mp[:3, 3] = cen - Rm @ cen + off
        bm_xf(pc, M @ Mp)
        A["Stone"].add_bm(pc)
    for (p, n, g) in cracks:
        marrow_slab(M, p, n, g + 0.06 * k, dims, k)
        crack_tendons(M, p, n, g + 0.06 * k, dims, rng.randint(4, 8), k)
        if rng.random() < 0.8:
            crack_seam(M, p, n, dims, k, rng.uniform(0.6, 1.0))
        # ember glints deep in some fractures
        if rng.random() < 0.55:
            q = p + perp(n) * box_support(dims, perp(n)) * 0.7
            V, F = blob(q, basis_axes(perp(n), np.cross(n, perp(n)), n, 0.09 * k, 0.05 * k, 0.03 * k), sub=2, amp=0.2)
            A["Ember"].add(xf(V, M), F)
    # neural spine: short raked stubs, often snapped; the tall skyline set-pieces are built separately
    hmul = 0.55 if s < 3.0 else (1.0 if s < L_TOTAL - 5 else 0.7)
    base = np.array([rng.uniform(-0.08, 0.08) * W, rng.uniform(-0.1, 0.1) * Lb, H / 2 - 0.12 * k])
    dirr = nrm(np.array([rng.uniform(-0.15, 0.15), -0.6 - rng.uniform(0, 0.35), 1.0]))
    if idx not in SKYLINE_IDX and rng.random() < 0.72:
        pinnacle(M, base, dirr, rng.uniform(0.6, 1.35) * k * hmul, 0.24 * k, k, broken=rng.random() < 0.45)
    # secondary lateral thorns on the dorsal shoulders (sparse)
    for sx in (-1, 1):
        if rng.random() < 0.3:
            root = np.array([sx * W * 0.36, rng.uniform(-0.2, 0.2) * Lb, H / 2 - 0.05])
            V, F, uv, al = shard(root, nrm(np.array([sx * 0.6, -0.5, 1.0])), rng.uniform(0.35, 0.75) * k * hmul,
                                 0.12 * k, hook_dir=np.array([0, -1.0, 0]), hook=0.3, rings=8)
            A["Carved"].add(xf(V, M), F, uv)
    # carved lancet windows on the flanks of the big blocks (cathedral read at mid range)
    if k > 0.72 and rng.random() < 0.6:
        for sx in (-1, 1):
            if rng.random() < 0.8:
                fc = np.array([sx * W / 2, rng.uniform(-0.06, 0.06) * Lb, -0.02 * H])
                lancet_niche(M, fc, np.array([sx, 0.0, 0.0]), np.array([0, 0, 1.0]), 0.27 * k, 0.56 * k, k)
    # rebar bursting through the fractures
    for _ in range(rng.randint(0, 3)):
        p, n, g = rng.choice(cracks)
        st = p + perp(n) * rng.uniform(-0.3, 0.3) * W
        dd = nrm(n * rng.choice((-1, 1)) * 0.3 + np.array([rng.uniform(-1, 1), rng.uniform(-0.8, 0.2), 1.0]))
        rebar(xf(st[None], M)[0], xd(dd, M), rng.uniform(0.5, 1.5) * k, xd(np.array([0, -1.0, 0.2]), M),
              rng.uniform(0.1, 0.5), 0.016 * k)
    if rng.random() < 0.45:
        iron_band(M, dims, chamfer, rng.uniform(-0.28, 0.28) * Lb, k, broken=rng.random() < 0.45)
    surface_veins(M, dims, k, rng.randint(2, 5))
    VERTS.append(dict(idx=idx, s=s, k=k, W=W, H=H, Lb=Lb, M=M))


def build_disc(va, vb):
    """Wet intervertebral sinew between two blocks: lumpy flesh collar + tendon cords + veins."""
    s0 = va["s"] + va["Lb"] / 2 - 0.16 * va["k"]
    s1 = vb["s"] - vb["Lb"] / 2 + 0.16 * vb["k"]
    if s1 <= s0:
        return
    ss = np.linspace(s0, s1, 14)
    O, T, D, S = spine_frames(ss)
    t = np.linspace(0, 1, len(ss))
    kk = va["k"] + (vb["k"] - va["k"]) * t
    bul = 1 + 0.16 * np.sin(math.pi * t)
    rx = 0.41 * 1.9 * kk * bul
    rz = 0.41 * 1.36 * kk * bul
    th = np.linspace(0, 2 * math.pi, 22, endpoint=False)
    # rounded-rect profile, in (S, D)
    cx = np.sign(np.cos(th)) * np.abs(np.cos(th)) ** 0.6
    cz = np.sign(np.sin(th)) * np.abs(np.sin(th)) ** 0.6
    prof = np.stack([cx[None] * rx[:, None], cz[None] * rz[:, None]], -1)
    Bv = np.cross(T, S)
    V, F, uv, al = loft(O, prof, fr=(T, S, Bv), cap0=False, cap1=False, nz_amp=0.1, nz_freq=2.4,
                        nz_seed=rng.random() * 40)
    A["Flesh"].add(V, F, uv, m=0.0)
    # tendon cords bridging block to block around the perimeter
    nt = rng.randint(9, 14)
    sa = va["s"] + va["Lb"] * 0.25
    sb = vb["s"] - vb["Lb"] * 0.25
    sss = np.linspace(sa, sb, 12)
    O2, T2, D2, S2 = spine_frames(sss)
    t2 = np.linspace(0, 1, 12)
    k2 = va["k"] + (vb["k"] - va["k"]) * t2
    for j in range(nt):
        a = 2 * math.pi * j / nt + rng.uniform(-0.15, 0.15)
        ex = np.sign(math.cos(a)) * abs(math.cos(a)) ** 0.6
        ez = np.sign(math.sin(a)) * abs(math.sin(a)) ** 0.6
        rr_ = rng.uniform(0.42, 0.5)
        b = 1 + rng.uniform(0.05, 0.2) * np.sin(math.pi * t2)
        P = O2 + S2 * (ex * rr_ * 1.9 * k2 * b)[:, None] + D2 * (ez * rr_ * 1.36 * k2 * b)[:, None]
        r = rng.uniform(0.025, 0.055) * k2 * (1 + 0.4 * np.sin(math.pi * t2))
        A["Tendon"].add_tube(P, r, sides=7, cap0=False, cap1=False)
    # veins over the collar
    for _ in range(rng.randint(2, 4)):
        a = rng.uniform(0, 2 * math.pi)
        drift = rng.uniform(-1.2, 1.2)
        aa = a + drift * t
        ex = np.cos(aa)
        ez = np.sin(aa)
        P = O + S * (np.sign(ex) * np.abs(ex) ** 0.6 * rx * 1.08)[:, None] + D * (np.sign(ez) * np.abs(ez) ** 0.6 * rz * 1.08)[:, None]
        A["Vein"].add_tube(P, 0.014 * kk, sides=5, g=float(rng.random() < 0.55))


# =============================================================================
# Dorsal skyline set-pieces (built in a vertebra's local frame: x = lateral, y = head-ward, z = dorsal)
# =============================================================================
def stone_at(dims, X, Y, Z, c, chamfer=0.18, wear=0.02, chips=2, subdiv=0, acc=None, M=None):
    acc = acc or A["Stone"]
    bm = stone_bm(dims, chamfer=chamfer, wear=wear, chips=chips, subdiv=subdiv)
    Mb = mat4(nrm(X), nrm(Y), nrm(Z), c)
    bm_xf(bm, Mb if M is None else M @ Mb)
    acc.add_bm(bm)


def octa_frame(up, lat=np.array([1.0, 0, 0])):
    a1 = nrm(lat - lat.dot(up) * up)
    a2 = np.cross(up, a1)
    return a1, a2


def spire_loft(M, base, up, r0, height, frac=1.0, sides=8, crockets=True, k=1.0, acc=None, rebars=3):
    """Octagonal crocketed spire; frac<1 snaps it (flat break + rebar)."""
    acc = acc or A["Carved"]
    a1, a2 = octa_frame(up)
    n = 18
    t = np.linspace(0, frac, n)
    P = base[None] + up[None] * (height * t)[:, None]
    th = np.linspace(0, 2 * math.pi, sides, endpoint=False) + math.pi / sides
    taper = r0 * (1 - t) ** 1.05 + 0.006
    prof = np.stack([np.cos(th), np.sin(th)], -1)[None] * taper[:, None, None]
    fr = (np.broadcast_to(up, P.shape), np.broadcast_to(a1, P.shape), np.broadcast_to(a2, P.shape))
    V, F, uv, al = loft(P, prof, fr=fr, cap0=True, cap1=True, nz_amp=0.04, nz_freq=3.0, nz_seed=rng.random() * 9)
    acc.add(xf(V, M), F, uv)
    if crockets:
        for e in range(sides):
            ang = th[e]
            for tt in np.arange(0.12, frac - 0.04, 0.085 + 0.02 * rng.random()):
                i = tt / max(frac, 1e-6) * (n - 1)
                rr_ = r0 * (1 - tt) ** 1.05
                root = base + up * height * tt + (math.cos(ang) * a1 + math.sin(ang) * a2) * rr_ * 0.92
                outd = math.cos(ang) * a1 + math.sin(ang) * a2
                V, F, uv, al = shard(root, nrm(outd * 0.9 + up * 0.7), (0.12 + 0.12 * (1 - tt)) * k, 0.045 * k,
                                     hook_dir=-up + outd * 0.2, hook=0.6, rings=5, sides=4)
                acc.add(xf(V, M), F, uv)
    if frac < 1.0:
        top = base + up * height * frac
        for _ in range(rebars):
            dd = nrm(up + np.array([rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.4), 0.0]))
            rebar(xf(top[None], M)[0] - xd(up, M) * 0.15, xd(dd, M), rng.uniform(0.4, 1.1) * k,
                  xd(np.array([rng.uniform(-1, 1), -1.0, -0.3]), M), rng.uniform(0.15, 0.5), 0.02 * k)
    return base + up * height * frac


def build_belfry(v):
    """Open octagonal lantern turret: lancet bays between piers, coal pits on the floor, snapped spire."""
    k, H, M = v["k"], v["H"], v["M"]
    up = nrm(np.array([0.3, -0.3, 1.0]))
    a1, a2 = octa_frame(up)
    base = np.array([0.0, 0.0, H / 2 - 0.2 * k])
    Rb = 0.95 * k

    def P(r, ang, h):
        return base + (math.cos(ang) * a1 + math.sin(ang) * a2) * r + up * h

    side_len = 2 * Rb * math.sin(math.pi / 8)
    for i in range(8):  # plinth ring
        ang = (i + 0.5) * math.pi / 4
        rad = math.cos(ang) * a1 + math.sin(ang) * a2
        tg = np.cross(up, rad)
        stone_at((side_len * 0.97, 0.36 * k, 0.6 * k), tg, rad, up, P(Rb * 0.9, ang, 0.3 * k), 0.15, 0.015 * k,
                 rng.randint(1, 3), acc=A["Stone"], M=M)
    V, F = blob(base + up * 0.42 * k, basis_axes(a1, a2, up, Rb * 0.82, Rb * 0.82, 0.12 * k), sub=3, amp=0.1)
    A["Marrow"].add(xf(V, M), F, g=0.0)
    hp0, hp1 = 0.6 * k, 2.55 * k
    for i in range(8):  # piers
        ang = i * math.pi / 4
        rad = math.cos(ang) * a1 + math.sin(ang) * a2
        tg = np.cross(up, rad)
        if i == 5:  # one pier snapped off
            stone_at((0.26 * k, 0.26 * k, 0.8 * k), tg, rad, up, P(Rb * 0.9, ang, hp0 + 0.4 * k), 0.2, 0.015 * k, 3, M=M)
            continue
        stone_at((0.27 * k, 0.27 * k, hp1 - hp0), tg, rad, up, P(Rb * 0.9, ang, (hp0 + hp1) / 2), 0.22, 0.015 * k,
                 rng.randint(1, 2), M=M)
    for i in range(8):  # pointed arch heads on every bay
        if i in (4, 5):
            continue
        a0, a1_ = i * math.pi / 4, (i + 1) * math.pi / 4
        pa, pb = P(Rb * 0.88, a0, 1.95 * k), P(Rb * 0.88, a1_, 1.95 * k)
        mid = (pa + pb) / 2
        wv = np.linalg.norm(pb - pa)
        ex = nrm(pb - pa)
        R = wv * 1.0
        th = math.acos((R - wv / 2) / R)
        pts = [mid - ex * wv / 2 + ex * (R + R * math.cos(a)) + up * R * math.sin(a)
               for a in np.linspace(math.pi, math.pi - th, 8)]
        pts += [mid + ex * wv / 2 - ex * (R - R * math.cos(a)) + up * R * math.sin(a)
                for a in np.linspace(th, 0, 8)[1:]]
        A["Carved"].add_tube(xf(np.array(pts), M), 0.075 * k, sides=4, phase=math.pi / 4, m=0.0)
        if rng.random() < 0.6:
            q = mid + up * (R * math.sin(th) * 0.55)
            V, F, uv, al = shard(q, -up, 0.16 * k, 0.04 * k, sides=4, rings=4, hook=0.0)
            A["Carved"].add(xf(V, M), F, uv)
    hc = 2.72 * k
    for i in range(8):  # cornice
        ang = (i + 0.5) * math.pi / 4
        if i == 4:
            continue
        rad = math.cos(ang) * a1 + math.sin(ang) * a2
        tg = np.cross(up, rad)
        stone_at((side_len * 1.04, 0.4 * k, 0.3 * k), tg, rad, up, P(Rb * 0.98, ang, hc), 0.25, 0.015 * k, 2, M=M)
    for i in range(0, 8, 2):  # corner pinnacles on the parapet
        if i == 4:
            continue
        ang = i * math.pi / 4
        pinnacle(M, P(Rb * 1.02, ang, hc + 0.1 * k), nrm(up + (math.cos(ang) * a1 + math.sin(ang) * a2) * 0.15),
                 rng.uniform(0.7, 1.1) * k, 0.12 * k, k, broken=rng.random() < 0.3)
    top = spire_loft(M, base + up * (hc + 0.12 * k), up, Rb * 0.72, 3.6 * k, frac=0.62, k=k)
    # coal pits glowing on the belfry floor + a hanging chain and hook in the open bay
    for j in range(3):
        q = base + up * 0.62 * k + (a1 * rng.uniform(-0.3, 0.3) + a2 * rng.uniform(-0.3, 0.3)) * k
        V, F = blob(q, basis_axes(a1, a2, up, 0.17 * k, 0.17 * k, 0.06 * k), sub=2, amp=0.25)
        A["Pit"].add(xf(V, M), F)
    cp = xf((base + up * (hc - 0.05 * k))[None], M)[0]
    chain(np.array([cp, cp + DOWN * 1.3 * k]), 0.8)
    meat_hook(cp + DOWN * 1.32 * k, 1.4)
    for _ in range(5):  # tendons hauling the turret down onto the vertebra
        ang = rng.uniform(0, 2 * math.pi)
        a = P(Rb * 0.95, ang, rng.uniform(0.2, 0.5) * k)
        b = np.array([math.cos(ang) * 0.9, rng.uniform(-0.4, 0.4), H / 2 - 0.1 * k]) * np.array([v["W"] / 2, v["Lb"], 1.0])
        A["Tendon"].add_tube(xf(sag_path(a, b, 0.05, 10), M), 0.035 * k, sides=6, cap0=False, cap1=False)


def build_great_spire(v):
    """A snapped spire three times taller than the dorsal stubs, raked back, with a chain swinging off it."""
    k, H, M = v["k"], v["H"], v["M"]
    up = nrm(np.array([-0.62, -0.28, 1.0]))  # a steeple toppling sideways out of the body line
    a1, a2 = octa_frame(up)
    base = np.array([0.0, 0.0, H / 2 - 0.15 * k])
    stone_at((1.25 * k, 1.25 * k, 1.0 * k), a1, a2, up, base + up * 0.45 * k, 0.12, 0.02 * k, 3, M=M)
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = base + (a1 * sx + a2 * sy) * 0.56 * k + up * 0.95 * k
            pinnacle(M, c, nrm(up + (a1 * sx + a2 * sy) * 0.12), rng.uniform(1.0, 1.6) * k, 0.14 * k, k,
                     broken=rng.random() < 0.35)
    top = spire_loft(M, base + up * 0.95 * k, up, 0.62 * k, 7.6 * k, frac=0.8, k=k, rebars=4)
    # a slab of the snapped tip still hangs off the break on rebar
    tw = xf(top[None], M)[0]
    stone_at((0.22 * k, 0.5 * k, 0.18 * k), xd(a1, M), xd(nrm(a2 - up * 0.6), M), xd(up, M),
             tw + xd(a2, M) * 0.35 * k + DOWN * 0.35 * k, 0.2, 0.01, 2)
    ch0 = xf((base + up * 4.8 * k + a2 * 0.3 * k)[None], M)[0]
    chain(hanging_chain_path(ch0, xd(a2, M) + DOWN, 3.2, 0.3), 1.05)
    V, F = blob(base + up * 0.1 * k, basis_axes(a1, a2, up, 0.8 * k, 0.8 * k, 0.3 * k), sub=3, amp=0.25, freq=2.5)
    A["Flesh"].add(xf(V, M), F, m=0.0)


def build_cluster(v):
    k, H, M = v["k"], v["H"], v["M"]
    base = np.array([0.0, 0.0, H / 2 - 0.15 * k])
    stone_at((0.85 * k, 0.75 * k, 0.5 * k), np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, 0, 1.0]),
             base + np.array([0, 0, 0.2 * k]), 0.15, 0.02 * k, 3, M=M)
    spec = [(0.0, 0.0, 3.9, 0.26, False), (0.32, 0.15, 2.7, 0.19, True), (-0.3, -0.12, 2.2, 0.17, False),
            (0.18, -0.3, 1.5, 0.14, False), (-0.22, 0.3, 3.1, 0.2, True)]
    for (x, y, h, r0, br) in spec:
        d = nrm(np.array([x * 0.6 + rng.uniform(-0.08, 0.08), -0.55 + y * 0.4, 1.0]))
        pinnacle(M, base + np.array([x * k, y * k, 0.35 * k]), d, h * k, r0 * k, k, broken=br)
    V, F = blob(base + np.array([0, 0, 0.05 * k]), basis_axes(np.array([1.0, 0, 0]), np.array([0, 1.0, 0]),
                np.array([0, 0, 1.0]), 0.7 * k, 0.65 * k, 0.25 * k), sub=3, amp=0.25)
    A["Flesh"].add(xf(V, M), F, m=0.0)


def build_fin(v, vnext):
    """Stepped buttress fin with lancet panels, and a true flying arch springing to the next vertebra."""
    k, H, M = v["k"], v["H"], v["M"]
    X, Y, Z = np.array([1.0, 0, 0]), nrm(np.array([0, 1.0, 0.18])), nrm(np.array([0, -0.18, 1.0]))
    z0 = H / 2 - 0.15 * k
    steps = [(1.5, 1.25, 0.48), (1.15, 1.15, 0.42), (0.78, 1.05, 0.36)]
    zc = z0
    for i, (ly, hz, wx) in enumerate(steps):
        c = np.array([0.0, -0.1 * k * i, 0.0]) + Z * (zc + hz * k / 2)
        stone_at((wx * k, ly * k, hz * k), X, Y, Z, c, 0.12, 0.02 * k, 2, M=M)
        if i < 2:
            for sx in (-1, 1):
                lancet_niche(M, c + X * sx * wx * k / 2, X * sx, Z, 0.32 * k, 0.86 * k, k)
        zc += hz * k
    topc = np.array([0.0, -0.25 * k, 0.0]) + Z * zc
    pinnacle(M, topc, nrm(Z - Y * 0.4), 1.9 * k, 0.2 * k, k)
    # flying arch: from the fin's back down onto the next vertebra (negative space underneath)
    F1 = xf((Z * (zc - 0.35 * k) - Y * 0.6 * k)[None], M)[0]
    O2, T2, D2, S2 = spine_frame(vnext["s"])
    P2 = O2 + D2 * (vnext["H"] / 2 - 0.05)
    Ctl = P2 + D2 * np.linalg.norm(F1 - P2) * 0.8
    arc = bezier([F1, Ctl, P2], 40)
    La = arclen(arc)
    nb = 7
    Sx = xd(X, M)
    for i in range(nb):
        a0, a1_ = La[-1] * i / nb, La[-1] * (i + 1) / nb - 0.05
        j = min(max(int(np.searchsorted(La, (a0 + a1_) / 2)), 1), len(arc) - 2)
        ty = nrm(arc[j + 1] - arc[j - 1])
        zz = nrm(np.cross(Sx, ty))
        if zz.dot(D2) < 0:
            zz = -zz
        xx = np.cross(ty, zz)
        stone_at((0.34 * k, a1_ - a0, 0.42 * k * (1 - 0.25 * i / nb)), xx, ty, zz, arc[j], 0.2, 0.015, 1)
    A["Flesh"].add_tube(arc, 0.12 * k, sides=8, nz_amp=0.15, seed=rng.random() * 10, m=0.0)
    for _ in range(2):
        off = Sx * rng.uniform(-0.1, 0.1)
        A["Tendon"].add_tube(sag_path(F1 + off, P2 + off, 0.35, 16), 0.03 * k, sides=6, cap0=False, cap1=False)


def ibeam_parts(path, wf, dp, tf, tw, up):
    """I-beam as three swept boxes (web + 2 flanges) along a path; returns list of (V, F, uv, al)."""
    T_, N_, B_ = frames(path, up=up)
    out = []
    rect = lambda a, b: np.array([(-a, -b), (a, -b), (a, b), (-a, b)])
    out.append(loft(path, rect(tw / 2, dp / 2), fr=(T_, N_, B_)))
    for sg in (-1, 1):
        out.append(loft(path + B_ * sg * (dp / 2 - tf / 2), rect(wf / 2, tf / 2), fr=(T_, N_, B_)))
    return out


def build_ibeam(v):
    k, H, M = v["k"], v["H"], v["M"]
    O, T, D, S = spine_frame(v["s"])
    st = O + D * (H / 2 - 0.4 * k) + S * 0.35 * k
    d1 = nrm(D * 1.0 - T * 0.65 + S * 0.35)
    d2 = nrm(d1 + S * 0.7 - T * 0.2)
    P = np.vstack([st + d1 * np.linspace(0, 2.0 * k, 12)[:, None], st + d1 * 2.0 * k + d2 * np.linspace(0.15, 1.3, 8)[:, None] * k])
    al = arclen(P) / arclen(P)[-1]
    for i, (V, F, uv, a) in enumerate(ibeam_parts(P, 0.3 * k, 0.36 * k, 0.04 * k, 0.035 * k, S)):
        A["Iron"].add(V, F, uv, m=0.0, g=np.clip((a - 0.82) / 0.18, 0, 1) * 0.95)
    V, F = blob(st + d1 * 0.15, basis_axes(S, T, D, 0.55 * k, 0.5 * k, 0.35 * k), sub=3, amp=0.3)
    A["Flesh"].add(V, F, m=0.0)
    for j in range(5):
        q = st + d1 * (0.4 + 0.12 * j) * k
        A["Iron"].add_tube(np.array([q - S * 0.2 * k, q + S * 0.2 * k]), 0.02 * k, sides=6, m=0.0)


def build_pipe(v):
    k, H, M = v["k"], v["H"], v["M"]
    O, T, D, S = spine_frame(v["s"])
    st = O + D * (H / 2 - 0.3 * k) - S * 0.3 * k
    P = bezier([st, st + D * 1.4 * k - T * 0.4 * k, st + D * 1.9 * k - T * 1.0 * k - S * 0.5 * k], 24)
    tt = np.linspace(0, 1, len(P))
    A["Iron"].add_tube(P, 0.17 * k, sides=16, cap0=False, cap1=False, m=0.0, g=np.clip((tt - 0.85) / 0.15, 0, 1) * 0.8)
    A["Iron"].add_tube(P[::-1] + 0.0, 0.15 * k, sides=16, cap0=False, cap1=False, m=0.0, flip=True)
    for f in (0.12, 0.62):
        i = int(f * (len(P) - 1))
        tg = nrm(P[i + 1] - P[i - 1])
        e1, e2 = perp(tg), np.cross(tg, perp(tg))
        ring = P[i] + 0.2 * k * (np.cos(np.linspace(0, 2 * math.pi, 28))[:, None] * e1 + np.sin(np.linspace(0, 2 * math.pi, 28))[:, None] * e2)
        A["Iron"].add_tube(ring, 0.045 * k, ry=0.02 * k, up=tg, sides=6, cap0=False, cap1=False, m=0.0)
        for b in range(8):
            a = 2 * math.pi * b / 8
            q = P[i] + 0.2 * k * (math.cos(a) * e1 + math.sin(a) * e2) + tg * 0.03 * k
            V, F = blob(q, basis_axes(e1, e2, tg, 0.03 * k, 0.03 * k, 0.03 * k), sub=1, amp=0.0)
            A["Iron"].add(V, F, m=0.0)
    V, F = blob(st, basis_axes(S, T, D, 0.5 * k, 0.5 * k, 0.3 * k), sub=3, amp=0.3)
    A["Flesh"].add(V, F, m=0.0)
    end = P[-1]
    hang_strand(end + DOWN * 0.1, 1.1, 0.02, A["Oil"])


# =============================================================================
# Legs: open lancet buttress frames -> knee piers -> bone shanks -> iron grapnel feet
# =============================================================================
def iron_hoop(c, axis, r, k, w=0.05, rivets=8, heat=0.0):
    """Riveted iron hoop clamped around a joint."""
    axis = nrm(axis)
    e1 = perp(axis)
    e2 = np.cross(axis, e1)
    th = np.linspace(0, 2 * math.pi, 30)
    ring = c + r * (np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2)
    A["Iron"].add_tube(ring, 0.022 * k, ry=w * k, up=axis, sides=6, cap0=False, cap1=False, m=0.0, g=heat)
    for i in range(rivets):
        a = 2 * math.pi * (i + 0.5) / rivets
        d = math.cos(a) * e1 + math.sin(a) * e2
        V, F = blob(c + d * (r + 0.02 * k), basis_axes(np.cross(axis, d), axis, d, 0.022 * k, 0.022 * k, 0.016 * k),
                    sub=1, amp=0.0)
        A["Iron"].add(V, F, m=0.0)


def sheave(c, axis, r, k):
    """Iron pulley wheel at a knee: the leg is a machine as much as a limb."""
    axis = nrm(axis)
    e1 = perp(axis)
    w = 0.09 * k
    prof = [(0.02, -w * 0.7), (r * 0.35, -w * 0.7), (r * 0.4, -w * 0.5), (r, -w * 0.5), (r, -w * 0.3),
            (r * 0.84, -w * 0.1), (r * 0.84, w * 0.1), (r, w * 0.3), (r, w * 0.5), (r * 0.4, w * 0.5),
            (r * 0.35, w * 0.7), (0.02, w * 0.7)]
    V, F = lathe(prof, c, axis, 28)
    A["Iron"].add(V, F, m=0.0)
    A["Iron"].add_tube(np.array([c - axis * w * 1.6, c + axis * w * 1.6]), 0.035 * k, sides=8, m=0.0)
    # a tendon running over the sheave groove
    th = np.linspace(-0.3, math.pi + 0.3, 20)
    e2 = np.cross(axis, e1)
    arc = c + r * 0.86 * (np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2)
    A["Tendon"].add_tube(arc, 0.03 * k, sides=6, cap0=False, cap1=False)


def rubble(p, nout, k=1.0, n=None):
    """Chipped rock collar where a hook bites the wall."""
    t1 = perp(nout)
    t2 = np.cross(nout, t1)
    for _ in range(n or rng.randint(5, 9)):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.12, 0.45) * k
        c = p + (math.cos(a) * t1 + math.sin(a) * t2) * r - nout * rng.uniform(0.0, 0.06)
        sz = rng.uniform(0.05, 0.16) * k
        bm = stone_bm((sz * rng.uniform(0.7, 1.5), sz * rng.uniform(0.7, 1.4), sz * rng.uniform(0.5, 1.0)),
                      chamfer=0.1, wear=0.004, chips=rng.randint(1, 3), subdiv=0)
        R_ = rot(np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)]), rng.uniform(0, 3))
        bm_xf(bm, mat4(R_ @ t1, R_ @ t2, R_ @ (-nout), c))
        ENV["Rubble"].add_bm(bm)


def oil_trail(p, nout, length, w0=0.06):
    """Oil-blood weeping from a hook bite and running down the rock under gravity (thin decal strip)."""
    n = 26
    px, z, phi = wall_coords(p)
    zz = z - np.linspace(0, length, n)
    pxs = px + np.cumsum(np.r_[0, [rng.uniform(-0.03, 0.03) for _ in range(n - 1)]])
    C = wall_point(pxs, zz, -0.0, disp=True) - np.array([[math.sin(phi), math.cos(phi), 0.0]]) * 0.012
    tg = np.array([math.cos(phi), -math.sin(phi), 0.0])
    t = np.linspace(0, 1, n)
    wv = w0 * (1 - 0.75 * t) * (0.7 + 0.3 * np.sin(t * 17.0) ** 2)
    L = C - tg[None] * wv[:, None]
    R = C + tg[None] * wv[:, None]
    V = np.vstack([L, R])
    F = np.array([[i, i + 1, n + i + 1, n + i] for i in range(n - 1)])
    ENV["Oil"].add(V, F)
    Vb, Fb = blob(C[-1], basis_axes(tg, UP, -np.array([math.sin(phi), math.cos(phi), 0.0]), wv[-1] * 1.4, wv[-1] * 2.4,
                                    0.012), sub=2, amp=0.1)
    ENV["Oil"].add(Vb, Fb)


def grapnel(Aj, F, nout, side_vec, Dv, k, planted=True):
    """Big iron meat-hook grapnel: a main scythe hook driven into the rock plus two splayed barbs."""
    nin = -nout
    if planted:
        tip = F + nout * 0.32 * k
        c1 = Aj + (F - Aj) * 0.3 + Dv * 0.75 * k + side_vec * 0.3 * k
        c2 = F + nin * 0.85 * k + side_vec * 0.18 * k
        P = bezier([Aj, c1, c2, tip], 30)
    else:
        dd = nrm(F - Aj)
        P = bezier([Aj, Aj + dd * 0.7 * k + Dv * 0.35 * k, Aj + dd * 1.25 * k - Dv * 0.1 * k,
                    Aj + dd * 1.1 * k - Dv * 0.65 * k - dd * 0.3 * k], 28)
    t = np.linspace(0, 1, len(P))
    r = 0.105 * k * (1 - t) ** 0.85 + 0.004
    A["Iron"].add_tube(P, r, sides=9, up=side_vec, ry=r * 0.6, cap1=False, m=t, g=0.0)
    axis = nrm(P[-1] - P[0])
    for sgn in (-1, 1):  # splayed barbs
        dd = rot(axis, sgn * math.radians(rng.uniform(60, 85))) @ nrm(P[6] - P[0])
        L = rng.uniform(0.6, 0.95) * k
        Q = bezier([Aj, Aj + dd * L * 0.6 + Dv * 0.15 * k, Aj + dd * L + Dv * -0.05,
                    Aj + dd * L * 0.85 - Dv * 0.4 * k], 16)
        tt = np.linspace(0, 1, len(Q))
        rq = 0.06 * k * (1 - tt) + 0.003
        A["Iron"].add_tube(Q, rq, sides=7, ry=rq * 0.6, up=np.cross(axis, dd), cap1=False, m=tt)
    ax = nrm(P[3] - P[0])
    iron_hoop(Aj + ax * 0.06, ax, 0.11 * k, k, w=0.045, rivets=6, heat=0.35)
    if planted:
        bite = F + nout * 0.02
        rubble(bite, nout, k)
        oil_trail(bite - UP * 0.05, nout, rng.uniform(0.6, 1.8) * k, 0.05 * k)
        for _ in range(rng.randint(1, 2)):
            i = rng.randint(len(P) // 2, len(P) - 6)
            hang_strand(P[i] + nin * 0.02, rng.uniform(0.15, 0.6), 0.012 * k, A["Oil"])
    return P


def lancet2d(w, H, sharp=1.55):
    R = w * sharp
    th = math.acos((R - w / 2) / R)
    rise = R * math.sin(th)
    hs = max(H - rise, 0.25 * H)
    nj = max(3, int(hs / 0.1) + 1)
    left = [(-w / 2, y) for y in np.linspace(0, hs, nj)]
    left += [(-w / 2 + R + R * math.cos(a), hs + R * math.sin(a)) for a in np.linspace(math.pi, math.pi - th, 14)[1:]]
    right = [(w / 2 - R + R * math.cos(a), hs + R * math.sin(a)) for a in np.linspace(th, 0, 14)]
    right += [(w / 2, y) for y in np.linspace(hs, 0, nj)[1:]]
    return np.array(left), np.array(right), hs, hs + rise


LEG_LOG = []


def build_leg(v, sigma, kind="normal", size=1.0, droot=0.0, lantern=False):
    """Femur = a flying buttress: an OPEN pointed arch springing from the body's flank over to a free-standing
    knee pier (pinnacle on top, spur, sheave, iron hoop). Seen along the body the legs form a gothic arcade.
    Then a long barbed bone shank bends the wrong way down to an iron grapnel driven into the rock."""
    s, k, W, H = v["s"], v["k"], v["W"], v["H"]
    O, T, D, S = spine_frame(s + droot)
    side = S * sigma
    fwd = ((0.7 - 1.8 * s / L_TOTAL) + rng.uniform(-0.5, 0.5)) * k * size
    if kind == "reach":
        lean = 0.75
    else:
        lean = rng.uniform(-0.35, 0.25) + (0.2 if s < 8 else 0.0)
    upa = nrm(D + T * lean)
    lat = nrm(side - side.dot(upa) * upa)
    kk = k ** 0.7 * size ** 0.8
    span = rng.uniform(1.45, 2.0) * k ** 0.6 * size ** 0.7
    Hl = rng.uniform(2.3, 3.1) * kk
    if kind == "reach":
        span, Hl = 1.5 * k ** 0.6 * size ** 0.7, 2.4 * kk
    R0 = O + side * (0.4 * W) - D * (0.06 * H)
    left2, right2, hs, apex = lancet2d(span, Hl, sharp=1.5)

    def pos(x, y, off=0.0):
        return R0 + lat * (x + span / 2) + upa * y + np.cross(lat, upa) * off

    pn = nrm(np.cross(lat, upa))
    stub = kind == "missing"
    K_ap = pos(0.0, apex)
    # ---- voussoirs: the body-side jamb + arch (left) and the arch down to the pier (right)
    for hi, half in enumerate((left2, right2)):
        pts = half if hi == 0 else half[::-1]
        if hi == 1:
            pts = pts[pts[:, 1] >= hs - 1e-6]  # the right jamb IS the pier
        P3 = resample(np.array([pos(x, y) for x, y in pts]), 120)
        Lm = arclen(P3)
        endL = Lm[-1] * (rng.uniform(0.3, 0.5) if stub else 1.0)
        seg = 0.42 * k ** 0.5 * size ** 0.3
        nseg = max(2, int(endL / seg))
        for i in range(nseg):
            a0, a1 = endL * i / nseg, endL * (i + 1) / nseg - 0.045 * k
            am = (a0 + a1) / 2
            j = int(np.clip(np.searchsorted(Lm, am), 1, len(P3) - 2))
            ty = nrm(P3[j + 1] - P3[j - 1])
            zz = nrm(pn - pn.dot(ty) * ty)
            xx = np.cross(ty, zz)
            fy = (P3[j] - R0).dot(upa) / apex
            a_w = (0.38 - 0.12 * fy) * k * (0.85 + 0.15 * size)
            b_t = (0.42 - 0.12 * fy) * k * (0.85 + 0.15 * size)
            stone_at((a_w, a1 - a0, b_t), xx, ty, zz, P3[j], 0.2, 0.018 * k, rng.randint(1, 3))
        jcut = int(np.searchsorted(Lm, endL)) + 1
        A["Flesh"].add_tube(P3[:jcut], np.linspace(0.15, 0.1, jcut) * k, sides=8, nz_amp=0.15, nz_freq=3.0,
                            seed=rng.random() * 30, m=0.0)
        if stub and hi == 0:
            tipp = P3[jcut - 1]
            V, F = blob(tipp, basis_axes(side, T, D, 0.2 * k, 0.18 * k, 0.2 * k), sub=3, amp=0.3, freq=3.5)
            A["Flesh"].add(V, F, m=0.6)
            for _ in range(3):
                hang_strand(tipp - D * 0.1, rng.uniform(0.7, 1.8), 0.022 * k, A["Tendon"])
            return
    # keystone at the apex
    stone_at((0.42 * k, 0.36 * k, 0.5 * k), pn, lat, upa, K_ap + upa * 0.1 * k, 0.2, 0.02 * k, 2)
    V, F, uv, al = shard(K_ap + upa * 0.3 * k, nrm(upa - lat * 0.25 - T * 0.2), rng.uniform(0.5, 0.9) * k, 0.12 * k,
                         hook_dir=-T, hook=0.3, sides=5, rings=7)
    A["Carved"].add(V, F, uv)
    # ---- tracery in the big arches, a torn back-lit membrane in some, tendon bowstrings under all
    if size > 0.9 and rng.random() < 0.65:
        A["Carved"].add_tube(resample(np.array([pos(0, -0.1), pos(0, hs * 0.92)]), step=0.1), 0.065 * k, sides=4,
                             phase=math.pi / 4, m=0.0)
        for sx in (-1, 1):
            q0, q1 = np.array([sx * span / 2, hs * 0.92]), np.array([0.0, hs * 0.92])
            mid = (q0 + q1) / 2
            arc2 = np.array([mid + np.array([(q1[0] - q0[0]) * 0.5 * math.cos(a), span * 0.3 * math.sin(a)])
                             for a in np.linspace(math.pi, 0, 12)])
            A["Carved"].add_tube(np.array([pos(x, y) for x, y in arc2]), 0.055 * k, sides=4, phase=math.pi / 4, m=0.0)
        oc_c = hs + (apex - hs) * 0.4
        rr_ = span * 0.19
        th = np.linspace(0, 2 * math.pi, 30)
        foil = rr_ * (0.78 + 0.22 * np.abs(np.cos(1.5 * th)))
        ring = np.array([pos(foil[i] * math.cos(th[i]), oc_c + foil[i] * math.sin(th[i])) for i in range(len(th))])
        A["Carved"].add_tube(ring, 0.05 * k, sides=4, phase=math.pi / 4, cap0=False, cap1=False, m=0.0)
    elif rng.random() < 0.5:
        nr, nc = 14, 11
        rows = []
        for i in range(nr):
            y = 0.05 + (hs + (apex - hs) * 0.55) * i / (nr - 1)
            hw = span / 2 - 0.1
            if y > hs:
                R = span * 1.5
                hw = max(math.sqrt(max(R * R - (y - hs) ** 2, 0.0)) - (R - span / 2) - 0.1, 0.05)
            xs = np.linspace(-hw, hw, nc)
            rows.append([pos(x, y, -0.15 * (1 - (x / max(hw, 1e-3)) ** 2)) for x in xs])
        G = np.array(rows)
        G += NZ.vec(G.reshape(-1, 3) * 2.5 + s).reshape(G.shape) * 0.04
        Vm = G.reshape(-1, 3)
        idx = np.arange(nr * nc).reshape(nr, nc)
        quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
        qc = Vm[quads].mean(1)
        rowf = np.repeat(np.arange(nr - 1) / (nr - 2), nc - 1)
        keep = (NZ.fbm(qc * 2.6 + s * 3.0, 3) < 0.34 - 0.2 * rowf) & (rowf < 0.8 + 0.4 * NZ.fbm(qc * 1.5, 2))
        A["Membrane"].add(Vm, quads[keep], m=0.0)
        for _ in range(2):
            q = G[rng.randint(nr // 3, nr - 2), rng.randint(2, nc - 3)]
            hang_strand(q, rng.uniform(0.3, 1.0), 0.01, A["Mucus"])
    for off in (-0.12, 0.12):
        a = pos(-span / 2 + 0.1, -0.25, off * k)
        b = pos(span / 2, -0.45, off * k)
        A["Tendon"].add_tube(sag_path(a, b, 0.25 * k, 18), 0.04 * k * (1 + 0.35 * np.sin(np.linspace(0, math.pi, 18))),
                             sides=7, cap0=False, cap1=False)
    # ---- knee pier: the arch's outer springer, standing free; pinnacle, spur, hoop, sheave
    pw = 0.52 * k * size ** 0.35
    ph = hs + 0.9 * k
    Kc = pos(span / 2, hs - ph / 2 + 0.15 * k)
    pX, pY = pn, lat
    stone_at((pw, pw, ph), pX, pY, upa, Kc, 0.16, 0.02 * k, rng.randint(2, 4), subdiv=1)
    iron_hoop(Kc - upa * ph * 0.25, upa, pw * 0.74, k, w=0.07, rivets=10, heat=0.2 if rng.random() < 0.5 else 0.0)
    ptop = Kc + upa * ph / 2
    stone_at((pw * 1.15, pw * 1.15, 0.16 * k), pX, pY, upa, ptop + upa * 0.06 * k, 0.3, 0.01, 1)
    Mk = mat4(pX, pY, upa, ptop)
    pinnacle(Mk, np.array([0, 0, 0.1 * k]), np.array([0, -0.15, 1.0]),
             rng.uniform(1.1, 2.1) * k * (0.7 + 0.3 * size), 0.18 * k, k, broken=rng.random() < 0.25)
    spd = nrm(-T * 0.7 + lat * 0.65 + upa * 0.1)
    V, F, uv, al = shard(Kc + lat * pw * 0.4 + upa * ph * 0.2, spd, rng.uniform(1.1, 1.8) * k * size ** 0.5, 0.15 * k,
                         hook_dir=-upa, hook=0.25, sides=5, rings=9)
    A["Carved"].add(V, F, uv)
    K = Kc
    # ---- lower leg
    Ks = Kc - upa * (ph * 0.5 - 0.05) + lat * pw * 0.2
    sheave(Ks + lat * pw * 0.3, pn, 0.22 * k, k)
    if kind == "reach":
        Cc = CROWN_PRE["C"]
        Tc = CROWN_PRE["T"]
        F_ = Cc + Tc * (2.0 + 0.3 * size) + side * 1.15 + CROWN_PRE["D"] * (-0.3 if sigma > 0 else 0.25)
        Aj = Ks + (F_ - Ks) * 0.6 + side * 0.45 * k + D * 0.6 * k
        nout = -D
        planted = False
    else:
        latd = float(np.dot(K - O, side))
        reachF = latd + rng.uniform(1.0, 2.2) * k ** 0.6 * size
        Ft = O + side * reachF + T * fwd
        F_, nout = project_wall(Ft)
        planted = kind != "lifted"
        if not planted:
            F_ = F_ - nout * rng.uniform(1.0, 1.8) + T * 0.5
        Aj = Ks + (F_ - Ks) * 0.66 + side * 0.5 * k * size + D * 0.55 * k * size
    shank = bezier([Ks, (Ks + Aj) / 2 + side * 0.18 * k + D * 0.12 * k, Aj], 40)
    t = np.linspace(0, 1, len(shank))
    if kind == "broken":
        cut = rng.uniform(0.35, 0.6)
        shank = shank[: max(4, int(len(shank) * cut))]
        t = t[: len(shank)]
    r = (0.07 + 0.075 * (1 - t) ** 7 + 0.05 * t ** 9 + 0.007 * np.sin(t * 23)) * k
    A["Bone"].add_tube(shank, r, sides=11, nz_amp=0.05, nz_freq=5.0, seed=rng.random() * 30, m=t)
    for tf in (0.06, 0.45):
        i = int(tf * (len(shank) - 1))
        if i < len(shank) - 2:
            iron_hoop(shank[i], nrm(shank[i + 1] - shank[max(i - 1, 0)]), r[i] + 0.02 * k, k, w=0.05, rivets=6)
    for sgn in (-1, 1):
        off = nrm(np.cross(nrm(shank[-1] - shank[0]), D)) * sgn * 0.085 * k
        P = shank + off[None] + (D * 0.03 * k)[None] * np.sin(math.pi * t)[:, None]
        A["Tendon"].add_tube(P, 0.02 * k * (1 + 0.5 * np.sin(math.pi * t)), sides=5, cap0=False, cap1=False)
    for _ in range(rng.randint(3, 6)):
        i = rng.randint(3, len(shank) - 3)
        tg = nrm(shank[i + 1] - shank[i - 1])
        pdir = rot(tg, rng.uniform(0, 2 * math.pi)) @ perp(tg)
        V, F, uv, al = shard(shank[i] + pdir * r[i] * 0.8, nrm(pdir - tg * 0.7), rng.uniform(0.14, 0.28) * k,
                             0.04 * k, hook_dir=-tg, hook=0.3, sides=4, rings=5)
        A["Teeth"].add(V, F, uv, al)
    if kind == "broken":
        end = shank[-1]
        tg = nrm(shank[-1] - shank[-3])
        for _ in range(rng.randint(4, 6)):
            pdir = rot(tg, rng.uniform(0, 2 * math.pi)) @ perp(tg)
            V, F, uv, al = shard(end + pdir * 0.04 * k, nrm(tg + pdir * 0.35), rng.uniform(0.14, 0.32) * k, 0.04 * k,
                                 hook=0.05, sides=4, rings=4)
            A["Bone"].add(V, F, uv, al)
        V, F = blob(end - tg * 0.03, basis_axes(perp(tg), np.cross(tg, perp(tg)), tg, 0.08 * k, 0.08 * k, 0.05 * k),
                    sub=2, amp=0.2)
        A["Marrow"].add(V, F, g=0.8)
        for _ in range(2):
            hang_strand(end, rng.uniform(0.6, 1.6), 0.016 * k, A["Tendon"])
        hang_strand(end, rng.uniform(0.3, 0.9), 0.012 * k, A["Oil"])
        return
    V, F = blob(Aj, basis_axes(side, T, D, 0.13 * k, 0.12 * k, 0.13 * k), sub=2, amp=0.12, freq=6.0)
    A["Bone"].add(V, F, m=1.0)
    hook = grapnel(Aj, F_, nout, side, D, k, planted)
    LEG_LOG.append(dict(kind=kind, F=F_, Aj=Aj, K=K, sigma=sigma, s=s, hook=hook))
    if lantern:
        i = int(np.argmin(hook[len(hook) // 3:, 2])) + len(hook) // 3
        build_miner_lantern(hook[i] + DOWN * 0.03, k)


def build_miner_lantern(top, k):
    """A dead climber's lantern still hanging from the talon that took him, a coal still alive in it."""
    top = np.asarray(top, float)
    lan = top + DOWN * 0.62
    chain(np.array([top, lan + UP * 0.2]), 0.55)
    e1 = np.array([1.0, 0, 0])
    e2 = np.array([0, 1.0, 0])
    for j in range(6):
        a = 2 * math.pi * j / 6
        dr = math.cos(a) * e1 + math.sin(a) * e2
        A["Iron"].add_tube(np.array([lan + dr * 0.085 + UP * 0.16, lan + dr * 0.105, lan + dr * 0.085 - UP * 0.15]),
                           0.008, sides=4, m=0.0)
    for h, rr_ in ((0.17, 0.09), (-0.16, 0.1)):
        ring = lan + UP * h + rr_ * (np.cos(np.linspace(0, 2 * math.pi, 18))[:, None] * e1 + np.sin(np.linspace(0, 2 * math.pi, 18))[:, None] * e2)
        A["Iron"].add_tube(ring, 0.014, sides=6, cap0=False, cap1=False, m=0.0)
    V, F = blob(lan + UP * 0.22, basis_axes(e1, e2, UP, 0.09, 0.09, 0.05), sub=2, amp=0.05)
    A["Iron"].add(V, F, m=0.0)
    V, F = blob(lan, basis_axes(e1, e2, UP, 0.045, 0.045, 0.075), sub=2, amp=0.1)
    A["Ember"].add(V, F)
    LANTERN["miner"] = lan
    # a scrap of the climber's coat snagged on it, soaked dark
    hang_strand(lan + e1 * 0.1 - UP * 0.15, 0.5, 0.012, A["Oil"])


def hang_strand(p0, length, r0, acc, drop=True):
    p0 = np.asarray(p0, float)
    n = 16
    t = np.linspace(0, 1, n)
    sway = NZ.vec(p0[None] * 3.0)[0] * 0.08 * length
    P = p0[None] + DOWN[None] * (length * t)[:, None] + sway[None] * (t ** 2)[:, None]
    r = r0 * (1 - 0.6 * t) + 0.002
    acc.add_tube(P, r, sides=6, cap0=False, cap1=not drop)
    if drop:
        V, F = blob(P[-1] + DOWN * r0 * 1.5, basis_axes(np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), UP,
                                                        r0 * 2.0, r0 * 2.0, r0 * 3.0), sub=2, amp=0.05)
        (A["Oil"] if acc is A["Oil"] else A["Mucus"]).add(V, F)


# =============================================================================
# Chains
# =============================================================================
def link_template(Lk=0.17, Wk=0.10, wire=0.017):
    a = Wk / 2 - wire
    b = max(Lk / 2 - wire - a, 0.005)
    # stadium: right straight -> top arc -> left straight -> bottom arc
    path = []
    for y in np.linspace(-b, b, 3)[:-1]:
        path.append((a, y))
    for th in np.linspace(0, math.pi, 8)[:-1]:
        path.append((a * math.cos(th), b + a * math.sin(th)))
    for y in np.linspace(b, -b, 3)[:-1]:
        path.append((-a, y))
    for th in np.linspace(math.pi, 2 * math.pi, 8)[:-1]:
        path.append((a * math.cos(th), -b + a * math.sin(th)))
    path.append(path[0])
    P = np.array([(x, y, 0.0) for x, y in path])
    V, F, uv, al = tube(P, wire, sides=6, cap0=False, cap1=False, up=np.array([0, 0, 1.0]))
    return V, F


_LINK = link_template()


def chain(path, scale=1.0, acc=None):
    acc = acc or A["Iron"]
    V0, F0 = _LINK
    V0 = V0 * scale
    pitch = 0.118 * scale
    P = resample(np.asarray(path, float), step=pitch)
    if len(P) < 3:
        return
    T, N, B = frames(P)
    for i in range(len(P) - 1):
        c = (P[i] + P[i + 1]) / 2
        y = nrm(P[i + 1] - P[i])
        x = N[i] if i % 2 == 0 else B[i]
        x = nrm(x - x.dot(y) * y)
        z = np.cross(x, y)
        acc.add(V0 @ np.stack([x, y, z]) + c, F0, m=0.0)


def hanging_chain_path(p0, out_dir, length, sway=0.2, n=50):
    pts = [np.asarray(p0, float)]
    p = pts[0].copy()
    d = nrm(out_dir)
    step = length / n
    for i in range(n):
        nv = NZ.vec((p * 0.7)[None])[0]
        d = nrm(d * 0.8 + DOWN * 0.2 + nv * sway * 0.12)
        p = p + d * step
        pts.append(p.copy())
    return np.array(pts)


def meat_hook(top, scale=1.0, acc=None):
    acc = acc or A["Iron"]
    top = np.asarray(top, float)
    side = nrm(np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), 0.0]))
    P = bezier([top, top + DOWN * 0.25 * scale, top + DOWN * 0.42 * scale + side * 0.02,
                top + DOWN * 0.45 * scale + side * 0.22 * scale, top + DOWN * 0.18 * scale + side * 0.26 * scale], 22)
    t = np.linspace(0, 1, len(P))
    r = 0.022 * scale * (1 - t ** 3) + 0.002
    acc.add_tube(P, r, sides=7, cap1=False, m=t)
    ring = top + 0.05 * scale * (np.cos(np.linspace(0, 2 * math.pi, 14))[:, None] * side + np.sin(np.linspace(0, 2 * math.pi, 14))[:, None] * UP) + UP * 0.05 * scale
    acc.add_tube(ring, 0.012 * scale, sides=6, cap0=False, cap1=False, m=0.0)


def pierce(p_in, out_dir, length, hook=True, scale=1.0):
    """A chain driven through flesh: starts inside the tissue (hidden) and hangs under gravity."""
    p_in = np.asarray(p_in, float)
    path = hanging_chain_path(p_in - nrm(out_dir) * 0.15, out_dir, length)
    chain(path, scale)
    # iron grommet where it pierces
    d = nrm(out_dir)
    e1 = perp(d)
    e2 = np.cross(d, e1)
    ring = p_in + d * 0.05 + 0.07 * scale * (np.cos(np.linspace(0, 2 * math.pi, 16))[:, None] * e1 + np.sin(np.linspace(0, 2 * math.pi, 16))[:, None] * e2)
    A["Iron"].add_tube(ring, 0.025 * scale, sides=6, cap0=False, cap1=False, m=0.0)
    V, F = blob(p_in, basis_axes(e1, e2, d, 0.13 * scale, 0.13 * scale, 0.09 * scale), sub=2, amp=0.3, freq=6)
    A["Flesh"].add(V, F, m=0.5)
    if hook:
        meat_hook(path[-1], scale * 1.9)


# =============================================================================
# Fronds (pale fiddleheads with cilia) and mucus
# =============================================================================
def frond(root, direction, length, curl_axis, r0=0.03, n=64, curl=1.0, cilia=True):
    p = np.asarray(root, float)
    d = nrm(direction)
    ax = nrm(curl_axis - curl_axis.dot(d) * d)
    pts = [p.copy()]
    step = length / n
    for i in range(1, n):
        t = i / n
        ang = curl * step * (0.25 + 9.0 * t ** 3.2)
        d = rot(ax, ang) @ d
        nv = NZ.vec((p * 1.7)[None])[0]
        d = nrm(d + nv * 0.07 + DOWN * 0.012)
        p = p + d * step * (1 - 0.55 * t ** 2)
        pts.append(p.copy())
    P = np.array(pts)
    t = np.linspace(0, 1, len(P))
    r = r0 * (1 - 0.9 * t ** 0.7) + 0.0015
    A["Frond"].add_tube(P, r, sides=7, cap0=False, m=t)
    if cilia:
        T, N, B = frames(P)
        for i in range(4, len(P) - 4, 5):
            for sgn in ((-1,) if i % 2 else (1,)):
                dd = nrm(N[i] * sgn + T[i] * 0.6 + B[i] * rng.uniform(-0.4, 0.4))
                L = (0.035 + 0.06 * (1 - t[i])) * rng.uniform(0.6, 1.2)
                Q = np.array([P[i], P[i] + dd * L * 0.5 + T[i] * L * 0.15, P[i] + dd * L + T[i] * L * 0.45])
                A["Frond"].add_tube(Q, np.array([0.006, 0.0035, 0.001]), sides=4, cap0=False, cap1=False,
                                    m=float(t[i]))
    return P


def strand(a, b, sag, r0, drops=True):
    P = sag_path(a, b, sag, 26)
    t = np.linspace(0, 1, len(P))
    r = r0 * (0.45 + 0.9 * np.sin(math.pi * t) ** 2) + 0.0015
    A["Mucus"].add_tube(P, r, sides=6, cap0=False, cap1=False)
    if drops:
        i = int(np.argmin(P[:, 2]))
        V, F = blob(P[i] + DOWN * r0 * 1.8, basis_axes(np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), UP,
                                                       r0 * 1.8, r0 * 1.8, r0 * 3.2), sub=2, amp=0.05)
        A["Mucus"].add(V, F)
        if rng.random() < 0.6:
            hang_strand(P[i], rng.uniform(0.08, 0.45), r0 * 0.6, A["Mucus"])


# =============================================================================
# The crown: rose-window ring split into a four-way maw, throat lit from inside
# =============================================================================
CROWN = {}


def build_crown():
    O, T, D, S = spine_frame(RING_S)
    C = O
    e1, e2 = S, D
    Ri, Ro, dep = RING_RI, RING_RO, RING_DEPTH
    rm = (Ri + Ro) / 2
    CROWN.update(C=C, T=T, D=D, S=S)

    def radial(a):
        return math.cos(a) * e1 + math.sin(a) * e2

    def tang(a):
        return -math.sin(a) * e1 + math.cos(a) * e2

    # ---- the ring of voussoirs (bent stone blocks), some torn askew
    nvs = 15
    for j in range(nvs):
        a_mid = 2 * math.pi * j / nvs + rng.uniform(-0.03, 0.03)
        span = 2 * math.pi / nvs - 0.05
        bm = stone_bm((span * rm, dep, Ro - Ri), chamfer=0.16, wear=0.03, chips=rng.randint(2, 4), subdiv=2)
        lift = rng.uniform(0, 0.09) if rng.random() < 0.4 else 0.0
        tw = rng.uniform(-0.06, 0.06)
        for vtx in bm.verts:
            x, y, z = vtx.co
            r = rm + z + lift
            ang = a_mid + x / rm
            pnt = C + radial(ang) * r + T * (y + tw * z)
            vtx.co = Vector(pnt)
        A["Stone"].add_bm(bm)
    # flesh packed behind / between the voussoirs
    circ = C[None] + rm * (np.cos(np.linspace(0, 2 * math.pi, 64))[:, None] * e1 + np.sin(np.linspace(0, 2 * math.pi, 64))[:, None] * e2)
    A["Flesh"].add_tube(circ, (Ro - Ri) * 0.42, sides=12, cap0=False, cap1=False, nz_amp=0.12, nz_freq=3.0, m=0.0)
    # rose-window oculi on the front face: carved quatrefoils glazed with cracked, leaded stained glass,
    # lit from behind by a recessed coal (the listening pit) and the forge in the throat
    nfo = 12
    for j in range(nfo):
        a = 2 * math.pi * (j + 0.5) / nfo
        cen = C + radial(a) * rm + T * (dep / 2 + 0.01)
        rad_ = 0.2
        er_, et_ = radial(a), tang(a)
        th = np.linspace(0, 2 * math.pi, 40)
        foil = rad_ * (0.8 + 0.2 * np.abs(np.cos(2 * th)))
        ring = cen + foil[:, None] * (np.cos(th)[:, None] * er_ + np.sin(th)[:, None] * et_)
        A["Carved"].add_tube(ring, 0.045, sides=6, cap0=False, cap1=False, m=0.0)
        # dark ember-lit tissue behind the glass (shows where panes are missing)
        tt = np.linspace(0, 2 * math.pi, 18)[:-1]
        Vb = np.array([cen + T * 0.012] + [cen + T * 0.012 + 0.185 * (math.cos(x) * er_ + math.sin(x) * et_) for x in tt])
        A["Marrow"].add(Vb, [[0, 1 + i, 1 + (i + 1) % 17] for i in range(17)], g=0.9)
        # glass: polar cells (3 rings x 9 sectors), some missing; lead cames between
        gz = cen + T * 0.026
        nsec, rings_r = 9, [0.0, 0.06, 0.12, 0.175]
        ph = rng.uniform(0, 1)
        for ri in range(3):
            for si in range(nsec if ri else 1):
                if ri and rng.random() < 0.12:
                    continue  # pane missing: the coal shows through
                if ri == 0:
                    tt = np.linspace(0, 2 * math.pi, 10)[:-1]
                    poly = [gz + rings_r[1] * 0.92 * (math.cos(x) * er_ + math.sin(x) * et_) for x in tt]
                    Vg = np.array([gz] + poly)
                    Fg = [[0, 1 + i, 1 + (i + 1) % 9] for i in range(9)]
                else:
                    a0 = 2 * math.pi * (si + ph) / nsec + 0.02
                    a1 = 2 * math.pi * (si + 1 + ph) / nsec - 0.02
                    r0, r1 = rings_r[ri] + 0.006, rings_r[ri + 1] - 0.006
                    cc = [(r0, a0), (r1, a0), (r1, a1), (r0, a1)]
                    Vg = np.array([gz + r_ * (math.cos(x) * er_ + math.sin(x) * et_) for r_, x in cc])
                    Vg += NZ.vec(Vg * 9.0 + j)[:, :] * 0.004
                    Fg = [[0, 1, 2, 3]]
                hue = rng.choice((0.05, 0.2, 0.35, 0.55, 0.7, 0.85, 0.95))
                br = rng.uniform(0.25, 0.9) * (0.35 if rng.random() < 0.3 else 1.0) * (0.3 if ri == 0 else 1.0)
                A["Glass"].add(Vg, Fg, m=hue, g=br)
        for ri in (1, 2, 3):
            cr = gz + rings_r[ri] * (np.cos(np.linspace(0, 2 * math.pi, 24))[:, None] * er_ + np.sin(np.linspace(0, 2 * math.pi, 24))[:, None] * et_) + T * 0.004
            A["Iron"].add_tube(cr, 0.007, sides=4, cap0=False, cap1=False, m=0.0)
        for si in range(nsec):
            x = 2 * math.pi * (si + ph) / nsec
            dvec = math.cos(x) * er_ + math.sin(x) * et_
            A["Iron"].add_tube(np.array([gz + dvec * 0.06, gz + dvec * 0.175]) + T * 0.004, 0.006, sides=4, m=0.0)
        # cusps: small inward thorns of the foil
        for c in range(4):
            ca = c * math.pi / 2 + a
            dd = math.cos(ca) * er_ + math.sin(ca) * et_
            V, F, uv, al = shard(cen + dd * rad_ * 0.98, -dd + T * 0.2, 0.08, 0.025, sides=4, rings=4, hook=0.0)
            A["Carved"].add(V, F, uv)
    # outer crown of raked thorns / pinnacles (a halo of spikes)
    nsp = 19
    for j in range(nsp):
        a = 2 * math.pi * j / nsp + rng.uniform(-0.08, 0.08)
        base = C + radial(a) * (Ro - 0.12) + T * rng.uniform(-0.25, 0.2)
        beta = math.radians(rng.uniform(25, 55))
        dd = nrm(radial(a) * math.cos(beta) - T * math.sin(beta))
        L = rng.uniform(1.1, 2.3) * (1.4 if j % 3 == 0 else 1.0)
        if rng.random() < 0.18:
            rebar(base, dd, L * 0.8, -T, 0.3, 0.02)
            continue
        V, F, uv, al = shard(base, dd, L, rng.uniform(0.11, 0.17), hook_dir=-T + radial(a) * 0.2, hook=0.35,
                             sides=5, rings=10, sink=0.1)
        A["Carved"].add(V, F, uv)

    # ---- throat: ribbed lamprey funnel, 8 rings of back-hooked fangs (ivory and iron), coal pits; a cracked
    #      Lanternwright bell hangs at the bottom, silhouetted against the forge behind it
    s_front = RING_S - dep / 2 + 0.06
    ss = np.linspace(s_front, s_front + 3.95, 120)
    Ot, Tt, Dt, St = spine_frames(ss)
    depth = ss - s_front
    r = (0.5 + 0.55 * np.exp(-depth / 0.8)) * (1 + 0.07 * np.sin(2 * math.pi * depth / 0.24))
    r = r + 0.2 * smoothstep(1.9, 2.45, depth) * (1 - smoothstep(3.25, 3.9, depth))
    r = r * (1 - 0.93 * smoothstep(3.35, 3.95, depth))
    Bt = np.cross(Tt, St)
    c = circle_prof(30)
    prof = np.stack([c[None, :, 0] * r[:, None], c[None, :, 1] * r[:, None]], -1)
    V, F, uv, al = loft(Ot, prof, fr=(Tt, St, Bt), cap0=False, cap1=True, nz_amp=0.06, nz_freq=4.0, flip=True)
    A["Gum"].add(V, F, uv, m=0.0, g=0.2 * smoothstep(0.1, 0.5, al) + 2.6 * smoothstep(0.69, 0.86, al))
    CROWN.update(throat_s=ss, throat_r=r)
    rings_ = [(0.12, 15, 0.46), (0.36, 18, 0.37), (0.64, 20, 0.31), (0.95, 18, 0.27), (1.27, 16, 0.24),
              (1.6, 14, 0.21), (1.93, 12, 0.19), (2.25, 10, 0.17)]
    for (dz, cnt, Lt) in rings_:
        s_ = s_front + dz
        Oq, Tq, Dq, Sq = spine_frame(s_)
        rq = float(np.interp(dz, depth, r))
        ph = rng.uniform(0, 1)
        for i in range(cnt):
            a = 2 * math.pi * (i + ph) / cnt
            rd = math.cos(a) * Sq + math.sin(a) * Dq
            root = Oq + rd * (rq * 0.97)
            dd = nrm(-rd * 1.0 - Tq * 0.75)
            roll = rng.random()
            if roll < 0.06:
                continue
            Lx = Lt * rng.uniform(0.7, 1.2) * (1.4 if roll > 0.95 else 1.0)
            if roll < 0.24:
                V, F, uv, al = shard(root, dd, Lx * 0.9, Lt * 0.07, hook_dir=-Tq, hook=0.6, rings=8, sides=5,
                                     sink=0.04)
                A["IronTooth"].add(V, F, uv, al)
                continue
            tr_ = rng.uniform(0.35, 0.6) if roll < 0.33 else 1.0
            V, F, uv, al = shard(root, dd, Lx, Lt * 0.12, hook_dir=-Tq, hook=0.3, rings=8, sides=6, sink=0.04,
                                 fang=True, trunc=tr_)
            A["Teeth"].add(V, F, uv, al)
    for dz in (0.5, 0.85, 1.25, 1.7):
        s_ = s_front + dz
        Oq, Tq, Dq, Sq = spine_frame(s_)
        rq = float(np.interp(dz, depth, r))
        cnt = 5
        ph = rng.uniform(0, 1)
        for i in range(cnt):
            a = 2 * math.pi * (i + ph) / cnt
            rd = math.cos(a) * Sq + math.sin(a) * Dq
            cen = Oq + rd * (rq * 1.0)
            pr = rng.uniform(0.045, 0.075)
            V, F = blob(cen, basis_axes(np.cross(rd, Tq), Tq, rd, pr, pr, pr * 0.8), sub=2, amp=0.1)
            A["Pit"].add(V, F)
            e1_ = np.cross(rd, Tq)
            ring = cen - rd * 0.02 + pr * 1.35 * (np.cos(np.linspace(0, 2 * math.pi, 14))[:, None] * e1_ + np.sin(np.linspace(0, 2 * math.pi, 14))[:, None] * Tq)
            A["Flesh"].add_tube(ring, pr * 0.45, sides=6, cap0=False, cap1=False, m=0.4)
    # the forge at the bottom of the gullet, behind the bell
    Oe, Te, De, Se = spine_frame(s_front + 3.55)
    V, F = blob(Oe, basis_axes(Se, Te, De, 0.46, 0.24, 0.46), sub=3, amp=0.25, freq=4.0)
    A["Ember"].add(V, F)
    for _ in range(7):
        a = rng.uniform(0, 2 * math.pi)
        dz = rng.uniform(2.9, 3.5)
        Oq, Tq, Dq, Sq = spine_frame(s_front + dz)
        rq = float(np.interp(dz, depth, r))
        rd = math.cos(a) * Sq + math.sin(a) * Dq
        V, F = blob(Oq + rd * rq * 0.95, basis_axes(np.cross(rd, Tq), Tq, rd, 0.12, 0.09, 0.05), sub=2, amp=0.3)
        A["Ember"].add(V, F)
    CROWN["forge"] = Oe
    CROWN["throat_light"] = spine_frame(s_front + 3.2)[0]
    CROWN["mouth_light"] = spine_frame(s_front + 1.3)[0]
    # the bell, hung under gravity from the roof of the gullet
    db = 2.62
    Ob, Tb, Db, Sb = spine_frame(s_front + db)
    rb = float(np.interp(db, depth, r))
    upp = nrm(UP - UP.dot(Tb) * Tb)
    hang = Ob + upp * rb * 0.95
    bell_top = Ob + upp * rb * 0.46
    chain(np.array([hang, bell_top + upp * 0.1]), 0.75)
    V, F = blob(hang, basis_axes(Sb, Tb, upp, 0.18, 0.18, 0.1), sub=2, amp=0.3)
    A["Flesh"].add(V, F, m=0.5)
    # wedged in the gullet along its local up, so from the mouth it shows in profile against the forge
    build_bell_at(bell_top, 0.74, 0.42, axis=upp)
    CROWN["bell"] = bell_top

    # ---- four jaws (the rose window's quadrants): iris-trap blades whose talons hook INWARD like a closing
    #      trap; asymmetric (one long, one bent, one snapped), stone courses over wet gum, mixed dentition
    jaws = []
    psis = [math.pi / 4 + j * math.pi / 2 + rng.uniform(-0.16, 0.16) for j in range(4)]
    kinds = ["long", "bent", "snapped", "normal"]
    for j, psi in enumerate(psis):
        kind = kinds[j]
        er, et = radial(psi), tang(psi)
        Lj = {"long": 3.25, "bent": 2.75, "snapped": 2.7, "normal": 2.6}[kind] * rng.uniform(0.97, 1.03)
        open_ = {"long": 0.95, "bent": 1.1, "snapped": 1.15, "normal": 1.0}[kind]
        H0 = C + T * (dep / 2 - 0.05) + er * (Ri - 0.04)
        ctrl_rf = np.array([(0.0, 0.0, 0.0), (0.34, 0.5, 0.0), (0.56, 1.1, 0.06), (0.52, 1.7, 0.14), (0.26, 2.2, 0.22),
                            (-0.16, 2.48, 0.3), (-0.58, 2.42, 0.37), (-0.86, 2.14, 0.42)])
        ctrl_rf[:, 0] = np.where(ctrl_rf[:, 0] > 0, ctrl_rf[:, 0] * open_, ctrl_rf[:, 0])
        if kind == "bent":
            ctrl_rf[4:, 2] += 0.32
            ctrl_rf[4:, 0] += 0.18
        ctrl_rf = ctrl_rf * (Lj / 2.5)
        ctrl = H0[None] + ctrl_rf[:, :1] * er[None] + ctrl_rf[:, 1:2] * T[None] + ctrl_rf[:, 2:] * et[None]
        P = resample(catmull(ctrl, 14), 50)
        nv = len(P)
        v = np.linspace(0, 1, nv)
        tg = nrm(np.gradient(P, axis=0))
        nin = nrm(np.cross(et, tg))
        if nin[0].dot(-er) < 0:
            nin = -nin
        Nf = nrm(np.cross(nin, tg))
        Bf = np.cross(tg, Nf)
        w = 0.8 * (1 - v) ** 0.8 * (0.8 + 0.4 * np.sin(math.pi * v * 0.9)) + 0.012
        th_ = 0.36 * (1 - v) ** 0.6 + 0.014
        cup = 0.3 * w
        M_ = 13
        u = np.linspace(-1, 1, M_)
        prof = np.zeros((nv, 2 * M_, 2))
        for i in range(nv):
            thu = th_[i] * (1 - 0.62 * u ** 2)
            ym = cup[i] * (u ** 2 - 1)
            # serrated inner edge on the outer third of the blade
            serr = 0.03 * w[i] * (np.abs(u) > 0.75) * (0.5 + 0.5 * math.sin(i * 2.7)) if v[i] > 0.3 else 0.0
            outer = np.stack([u * w[i] / 2, ym - thu / 2], -1)
            inner = np.stack([u[::-1] * w[i] / 2, (ym + thu / 2 + serr)[::-1] if np.ndim(serr) else (ym + thu / 2)[::-1]], -1)
            prof[i] = np.vstack([outer, inner])
        sgn = 1.0 if Bf[0].dot(nin[0]) > 0 else -1.0
        if sgn < 0:
            prof[:, :, 1] *= -1
            prof = prof[:, ::-1]
        snapped = kind == "snapped"
        nvc = int(0.56 * nv) if snapped else nv
        iT = int(0.78 * (nv - 1))
        if snapped:
            V, F, uv, al = loft(P[:nvc], prof[:nvc], fr=(tg[:nvc], Nf[:nvc], Bf[:nvc]), cap0=True, cap1=True,
                                nz_amp=0.05, nz_freq=4.0, nz_seed=j * 10.0)
            A["Gum"].add(V, F, uv, m=0.0)
        else:
            V, F, uv, al = loft(P[: iT + 2], prof[: iT + 2], fr=(tg[: iT + 2], Nf[: iT + 2], Bf[: iT + 2]), cap0=True,
                                cap1=True, nz_amp=0.05, nz_freq=4.0, nz_seed=j * 10.0)
            A["Gum"].add(V, F, uv, m=0.0)
            # the talon: last fifth is a solid, sharp, hooked stone point
            V, F, uv, al = loft(P[iT:], prof[iT:] * np.array([1.1, 1.15]), fr=(tg[iT:], Nf[iT:], Bf[iT:]), cap0=True,
                                cap1=True, nz_amp=0.03, nz_freq=5.0, nz_seed=j * 3.0)
            A["Carved"].add(V, F, uv, m=0.0)
        vidx = np.arange(nv, dtype=float)

        def rows(arr, vf):
            i0 = int(np.clip(math.floor(vf), 0, nv - 2))
            f = vf - i0
            return arr[i0] * (1 - f) + arr[i0 + 1] * f

        def jaw_pt(uu, vf, off):
            Pv, Nv, nv_ = rows(P, vf), nrm(rows(Nf, vf)), nrm(rows(nin, vf))
            wv, thv, cv = (np.interp(vf, vidx, a_) for a_ in (w, th_, cup))
            thu = thv * (1 - 0.62 * uu ** 2)
            ym = cv * (uu ** 2 - 1)
            return Pv + Nv * (uu * wv / 2) + nv_ * (ym - thu / 2 - off)

        # masonry courses in running bond bent over the back of the jaw, wet tissue in the joints
        step_m = arclen(P)[-1] / (nv - 1)
        nseg = rng.randint(10, 12)
        lim = (nvc - 2) if snapped else 0.8 * (nv - 1)
        cuts = np.linspace(0.0, lim, nseg + 1)
        for si in range(nseg):
            a0, a1 = cuts[si], cuts[si + 1]
            vm = (a0 + a1) / 2
            wv = float(np.interp(vm, vidx, w))
            n_ac = 3 if wv > 0.62 else (2 if wv > 0.32 else 1)
            shift = (1.0 / n_ac) * (0.5 if si % 2 else 0.0) * (1 if n_ac > 1 else 0)
            tb = 0.1 - 0.04 * (a0 / (nv - 1))
            seg_len = (a1 - a0) * step_m
            for bi in range(n_ac + (1 if shift else 0)):
                u0 = -1 + 2.0 / n_ac * bi - shift * 2
                u1 = u0 + 2.0 / n_ac
                u0, u1 = max(u0, -1.04), min(u1, 1.04)
                if u1 - u0 < 0.25:
                    continue
                uc = (u0 + u1) / 2
                pa, pb = jaw_pt(uc - 0.05, vm, 0.0), jaw_pt(uc + 0.05, vm, 0.0)
                ax_ = nrm(pb - pa)
                al_ = nrm(jaw_pt(uc, min(vm + 0.5, nv - 1), 0.0) - jaw_pt(uc, max(vm - 0.5, 0), 0.0))
                zz = nrm(np.cross(ax_, al_))
                if zz.dot(-nin[int(vm)]) < 0:
                    zz = -zz
                ax_ = nrm(np.cross(al_, zz))
                yy = np.cross(zz, ax_)
                dims = ((u1 - u0) / 2 * wv - rng.uniform(0.035, 0.06), seg_len - rng.uniform(0.045, 0.08), tb)
                bm = stone_bm(dims, chamfer=0.05, wear=0.01, chips=rng.randint(1, 3), subdiv=1)
                cen = jaw_pt(uc, vm, tb / 2 - 0.035 + rng.uniform(-0.01, 0.015))
                Mb = mat4(ax_, yy, zz, cen) @ np.block([[rot(np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)]), math.radians(rng.uniform(0, 4))), np.zeros((3, 1))], [np.zeros((1, 3)), np.ones((1, 1))]])
                bm_xf(bm, Mb)
                A["Stone"].add_bm(bm)

        def surf(uu, vi, layer="inner", lift=0.0):
            vi = int(np.clip(vi, 0, nv - 1))
            thu = th_[vi] * (1 - 0.62 * uu ** 2)
            ym = cup[vi] * (uu ** 2 - 1)
            yy = ym + (thu / 2 if layer == "inner" else -thu / 2)
            yy = yy + (lift if layer == "inner" else -lift)
            return P[vi] + Nf[vi] * (uu * w[vi] / 2) + nin[vi] * yy

        jaws.append(dict(P=P, nin=nin, tg=tg, Nf=Nf, w=w, surf=surf, er=er, et=et, nv=nvc, psi=psi, kind=kind,
                         nv_full=nv))
        # gum: wet flesh lining the inner face
        ng = min(nv - 6, nvc)
        uu = np.linspace(-0.86, 0.86, 11)
        gp = np.zeros((ng, 22, 2))
        for i in range(ng):
            thu = th_[i] * (1 - 0.62 * uu ** 2)
            ym = cup[i] * (uu ** 2 - 1)
            top = ym + thu / 2 + 0.05 * (1 - 0.5 * v[i])
            bot = ym + thu / 2 - 0.04
            gp[i] = np.vstack([np.stack([uu * w[i] / 2 * 0.98, bot], -1), np.stack([uu[::-1] * w[i] / 2 * 0.98, top[::-1]], -1)])
        if sgn < 0:
            gp[:, :, 1] *= -1
            gp = gp[:, ::-1]
        V, F, uv, al = loft(P[:ng], gp, fr=(tg[:ng], Nf[:ng], Bf[:ng]), cap0=True, cap1=True,
                            nz_amp=0.08, nz_freq=6.0, nz_seed=j * 7.0)
        A["Gum"].add(V, F, uv, m=0.0)
        # dentition: big/small alternating wet fangs on the rims, inner rows of hooked shards; ~20% blackened
        # iron hooks, ~10% snapped, some missing (dark sockets), a few oversized
        for (uu0, step, Lmin, Lmax, br, lean) in ((-0.9, 1, 0.3, 0.75, 0.16, -0.32), (0.9, 1, 0.3, 0.75, 0.16, 0.32),
                                                  (-0.58, 2, 0.16, 0.4, 0.2, -0.15), (0.58, 2, 0.16, 0.4, 0.2, 0.15),
                                                  (0.0, 3, 0.12, 0.3, 0.22, 0.0)):
            vi = 2 + rng.randint(0, 1)
            vmax = (nvc - 2) if snapped else nv - 4
            while vi < vmax:
                vv = v[vi]
                root = surf(uu0 + rng.uniform(-0.05, 0.05), vi, "inner", 0.02)
                dd = nrm(nin[vi] * 1.0 - tg[vi] * rng.uniform(0.2, 0.6) + Nf[vi] * (lean + rng.uniform(-0.15, 0.15)))
                L = rng.uniform(Lmin, Lmax) * (1 - 0.4 * vv) * rng.uniform(0.8, 1.2)
                if abs(uu0) > 0.8 and vi % 2:
                    L *= 0.45  # big / small alternation along the rim
                roll = rng.random()
                if roll < 0.07:
                    V, F = blob(root, basis_axes(Nf[vi], tg[vi], nin[vi], 0.05, 0.05, 0.025), sub=2, amp=0.2)
                    A["Marrow"].add(V, F, g=0.4)
                elif roll < 0.27:
                    V, F, uv, al = shard(root, nrm(dd - tg[vi] * 0.3), L * 1.05, L * 0.09, hook_dir=-tg[vi] - nin[vi] * 0.3,
                                         hook=0.65, rings=8, sides=5, sink=0.05)
                    A["IronTooth"].add(V, F, uv, al)
                else:
                    if roll > 0.95:
                        L *= 1.65
                    tr_ = rng.uniform(0.35, 0.6) if roll < 0.37 else 1.0
                    V, F, uv, al = shard(root, dd, L, L * br * 0.85, hook_dir=-tg[vi] - nin[vi] * 0.2, hook=0.28,
                                         rings=9, sides=8, sink=0.05, fang=True, trunc=tr_)
                    A["Teeth"].add(V, F, uv, al)
                vi += step + (1 if rng.random() < 0.35 else 0)
        # serration hooks: a row of small inner hooks along the blade's inner edge (the trap's ratchet)
        for vi in range(int(nv * 0.35), (nvc - 2) if snapped else int(nv * 0.9), 2):
            for sx in (-1, 1):
                root = surf(sx * 0.97, vi, "inner", 0.0)
                V, F, uv, al = shard(root, nrm(nin[vi] * 0.6 + Nf[vi] * sx * 0.5 - tg[vi] * 0.5), 0.09 * (1.2 - v[vi]),
                                     0.022, hook_dir=-tg[vi], hook=0.5, rings=4, sides=4, sink=0.02)
                A["Carved"].add(V, F, uv)
        if snapped:
            # broken end: jagged stone, exposed marrow, rebar, tendons hanging
            end_ = P[nvc - 1]
            for _ in range(6):
                pd_ = rot(tg[nvc - 1], rng.uniform(0, 2 * math.pi)) @ Nf[nvc - 1]
                V, F, uv, al = shard(end_ + pd_ * w[nvc - 1] * 0.3, nrm(tg[nvc - 1] + pd_ * 0.5), rng.uniform(0.15, 0.32),
                                     0.07, hook=0.05, sides=4, rings=4)
                A["Carved"].add(V, F, uv)
            V, F = blob(end_, basis_axes(Nf[nvc - 1], tg[nvc - 1], nin[nvc - 1], 0.22, 0.1, 0.12), sub=3, amp=0.3)
            A["Marrow"].add(V, F, g=0.0)
            for _ in range(3):
                rebar(end_ - tg[nvc - 1] * 0.2 + Nf[nvc - 1] * rng.uniform(-0.2, 0.2), nrm(tg[nvc - 1] + nin[nvc - 1] * rng.uniform(-0.3, 0.3)),
                      rng.uniform(0.4, 0.9), DOWN, 0.4, 0.018)
            for _ in range(3):
                hang_strand(end_ + Nf[nvc - 1] * rng.uniform(-0.2, 0.2), rng.uniform(0.5, 1.4), 0.016, A["Tendon"])
        if kind == "bent":
            # the kink: cracked through, splinted with an iron strap
            vk = int(nv * 0.5)
            iron_hoop(P[vk] - nin[vk] * 0.02, tg[vk], w[vk] * 0.55, 1.0, w=0.06, rivets=7, heat=0.5)
        # a foil carved near the jaw base, with an ember pit
        cen = surf(0.0, int(nv * 0.12), "outer", 0.17)
        nr = -nin[int(nv * 0.12)]
        e_a = Nf[int(nv * 0.12)]
        e_b = np.cross(nr, e_a)
        ring = cen + 0.17 * (np.cos(np.linspace(0, 2 * math.pi, 22))[:, None] * e_a + np.sin(np.linspace(0, 2 * math.pi, 22))[:, None] * e_b)
        A["Carved"].add_tube(ring, 0.04, sides=6, cap0=False, cap1=False, m=0.0)
        V, F = blob(cen - nr * 0.06, basis_axes(e_a, e_b, nr, 0.11, 0.11, 0.05), sub=2, amp=0.1)
        A["Pit"].add(V, F)
        # hinge muscles: exposed bellies hauling the jaw shut
        for q in range(4):
            off = (q - 1.5) * 0.24
            a_ = C + er * (Ro - 0.05) - T * (dep / 2 - 0.15) + et * off
            b_ = surf(off / (w[int(nv * 0.3)] / 2 + 1e-6) * 0.9, int(nv * 0.3), "outer", -0.02)
            Pm = sag_path(a_, b_, 0.0, 18, toward=er * 0.22)
            tt = np.linspace(0, 1, 18)
            rmus = (0.06 + 0.07 * np.sin(math.pi * tt) ** 1.5) * rng.uniform(0.85, 1.15)
            A["Flesh"].add_tube(Pm, rmus, sides=10, nz_amp=0.12, nz_freq=5.0, seed=rng.random() * 20, m=0.0)
            Pt = sag_path(a_ - T * 0.1, b_ + tg[int(nv * 0.3)] * 0.25, 0.0, 10)
            A["Tendon"].add_tube(Pt, 0.022, sides=6, cap0=False, cap1=False)
        # iron strap with rivets across the jaw back, heat-tinted where it tore
        vi = int(nv * 0.35)
        pts = np.array([surf(uu, vi, "outer", 0.16) for uu in np.linspace(-1.0, 1.0, 16)])
        A["Iron"].add_tube(pts, 0.03, sides=4, ry=0.07, up=tg[vi], m=0.0, g=np.linspace(0, 1, 16) ** 3 * 0.9)
        for pp in pts[1:-1:3]:
            V, F = blob(pp - nin[vi] * 0.025, basis_axes(Nf[vi], tg[vi], -nin[vi], 0.026, 0.026, 0.02), sub=1, amp=0.0)
            A["Iron"].add(V, F, m=0.0)
    CROWN["jaws"] = jaws

    # membranes (torn webbing) between neighbouring jaws, low near the hinges
    for j in range(4):
        ja, jb = jaws[j], jaws[(j + 1) % 4]
        # which edge of each jaw faces the neighbour
        ua = 0.95 if ja["Nf"][3].dot(nrm(jb["P"][3] - ja["P"][3])) > 0 else -0.95
        ub = 0.95 if jb["Nf"][3].dot(nrm(ja["P"][3] - jb["P"][3])) > 0 else -0.95
        top = int(min(ja["nv"], jb["nv"]) * rng.uniform(0.66, 0.82))
        rows = []
        ncol = 22
        for i in range(0, top + 1):
            pa = ja["surf"](ua, i, "inner", -0.03)
            pb = jb["surf"](ub, i, "inner", -0.03)
            t = np.linspace(0, 1, ncol)[:, None]
            mid = (pa + pb) / 2
            inward = nrm(C - mid)
            sagk = 0.22 + 0.25 * i / top
            row = pa + (pb - pa) * t + (inward * sagk - T * 0.18)[None] * (4 * t * (1 - t)) ** 0.8
            row[:, 2] -= 0.12 * (i / top) * (4 * t[:, 0] * (1 - t[:, 0]))
            rows.append(row)
        G = np.array(rows)  # (nr, ncol, 3)
        nr_, nc = G.shape[:2]
        G += NZ.vec(G.reshape(-1, 3) * 3.0 + j).reshape(G.shape) * 0.03
        Vm = G.reshape(-1, 3)
        idx = np.arange(nr_ * nc).reshape(nr_, nc)
        quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
        # tears: holes and a ragged free edge
        qc = Vm[quads].mean(1)
        rowf = np.repeat(np.arange(nr_ - 1) / max(nr_ - 2, 1), nc - 1)
        hole = NZ.fbm(qc * 3.2 + j * 7.0, 3)
        edge = NZ.fbm(qc * 1.7 + j * 3.0, 2)
        keep = (hole < 0.5 - 0.3 * rowf) & (rowf < 0.86 + 0.35 * edge)
        A["Membrane"].add(Vm, quads[keep], m=0.0)
        # sinew strings stretched across the gap and drool falling from the torn edge
        for _ in range(rng.randint(3, 5)):
            ia = int(ja["nv"] * rng.uniform(0.45, 0.85))
            ib = int(jb["nv"] * rng.uniform(0.45, 0.85))
            Ps = sag_path(ja["surf"](ua * 0.9, ia, "inner"), jb["surf"](ub * 0.9, ib, "inner"), rng.uniform(0.03, 0.12), 14)
            A["Tendon"].add_tube(Ps, rng.uniform(0.007, 0.016) * (1 + 0.6 * np.sin(np.linspace(0, math.pi, 14))), sides=6,
                                 cap0=False, cap1=False)
        for _ in range(3):
            q = G[rng.randint(int(nr_ * 0.5), nr_ - 1), rng.randint(3, nc - 4)]
            hang_strand(q, rng.uniform(0.25, 1.1), rng.uniform(0.008, 0.014), A["Mucus"])
        # fronds unfurling from the gap
        ga = (psis[j] + psis[(j + 1) % 4] + (2 * math.pi if j == 3 else 0)) / 2
        for f in range(rng.randint(1, 3)):
            root = C + T * (dep / 2 - 0.1) + radial(ga + rng.uniform(-0.18, 0.18)) * (Ri - rng.uniform(0.05, 0.3))
            dd = nrm(T * 1.0 + radial(ga) * rng.uniform(0.5, 1.3) + tang(ga) * rng.uniform(-0.4, 0.4))
            ax = np.cross(dd, radial(ga)) * rng.choice((-1, 1))
            frond(root, dd, rng.uniform(1.5, 2.6), ax, r0=rng.uniform(0.04, 0.055), curl=rng.uniform(0.75, 1.15))
        # saliva strands between neighbouring jaws
        for _ in range(2):
            ia = int(ja["nv"] * rng.uniform(0.35, 0.8))
            ib = int(jb["nv"] * rng.uniform(0.35, 0.8))
            strand(ja["surf"](ua * 0.95, ia, "inner"), jb["surf"](ub * 0.95, ib, "inner"), rng.uniform(0.15, 0.5),
                   rng.uniform(0.006, 0.012))
    # fronds coiling up out of the throat
    for f in range(3):
        s_ = RING_S + rng.uniform(0.3, 0.9)
        Oq, Tq, Dq, Sq = spine_frame(s_)
        a = rng.uniform(0, 2 * math.pi)
        rd = math.cos(a) * Sq + math.sin(a) * Dq
        root = Oq + rd * 0.6
        dd = nrm(Tq * 1.0 + rd * rng.uniform(0.1, 0.5))
        frond(root, dd, rng.uniform(1.6, 2.6), np.cross(dd, rd), r0=0.038, curl=rng.uniform(0.75, 1.1))
    # strands across the open maw (opposite jaws) - silhouetted against the forge glow
    for j in range(2):
        ja, jb = jaws[j], jaws[j + 2]
        for _ in range(2):
            ia = int(ja["nv"] * rng.uniform(0.25, 0.6))
            ib = int(jb["nv"] * rng.uniform(0.25, 0.6))
            strand(ja["surf"](rng.uniform(-0.5, 0.5), ia, "inner", 0.04), jb["surf"](rng.uniform(-0.5, 0.5), ib, "inner", 0.04),
                   rng.uniform(0.2, 0.6), rng.uniform(0.006, 0.011))
    # drool from the jaw tips / teeth (gravity)
    for ja in jaws:
        for _ in range(3):
            i = int(ja["nv"] * rng.uniform(0.4, 0.95))
            p0 = ja["surf"](rng.uniform(-0.8, 0.8), i, "inner", 0.03)
            hang_strand(p0, rng.uniform(0.2, 1.4), rng.uniform(0.006, 0.012), A["Mucus"])
    # the previous climber's tether: a three-prong grapple snagged over the long talon, frayed rope hanging
    build_tether(jaws[0])
    # neck: flesh collar from ring back to the first vertebra, thick muscle cords
    ss = np.linspace(RING_S + dep / 2 - 0.15, RING_S + dep / 2 + 0.75, 14)
    On, Tn, Dn, Sn = spine_frames(ss)
    t = np.linspace(0, 1, len(ss))
    rr = 1.12 - 0.42 * t
    Bn = np.cross(Tn, Sn)
    c = circle_prof(26)
    prof = np.stack([c[None, :, 0] * rr[:, None], c[None, :, 1] * rr[:, None] * 0.85], -1)
    V, F, uv, al = loft(On, prof, fr=(Tn, Sn, Bn), cap0=False, cap1=False, nz_amp=0.13, nz_freq=2.5)
    A["Flesh"].add(V, F, uv, m=0.0)
    for q in range(16):
        a = 2 * math.pi * q / 16 + rng.uniform(-0.1, 0.1)
        a_ = C + radial(a) * rng.uniform(1.0, 1.35) - T * (dep / 2 - 0.05)
        sb = RING_S + dep / 2 + 1.2
        Ob, Tb, Db, Sb = spine_frame(sb)
        b_ = Ob + (math.cos(a) * Sb * 0.8 + math.sin(a) * Db * 0.55) * 0.75
        Pm = sag_path(a_, b_, 0.0, 16, toward=radial(a) * 0.12)
        tt = np.linspace(0, 1, 16)
        A["Tendon"].add_tube(Pm, (0.04 + 0.04 * np.sin(math.pi * tt)) * rng.uniform(0.8, 1.3), sides=8, cap0=False, cap1=False)
    # chains through the crown
    lowj = min(jaws, key=lambda J: J["P"][int(J["nv"] * 0.5)][2])
    pierce(lowj["surf"](0.2, int(lowj["nv"] * 0.4), "inner", 0.0), lowj["nin"][int(lowj["nv"] * 0.4)] * 0.4 + DOWN, 2.4)
    pierce(C + radial(-math.pi / 2 + 0.3) * (Ro - 0.1) - T * 0.2, radial(-math.pi / 2 + 0.3) + DOWN * 0.5, 3.2)


def build_tether(J):
    """Three-prong grapple (the same tool the player throws) hooked over a talon; its rope hangs and frays."""
    nvf = J["nv_full"]
    vi = int(nvf * 0.8)
    P, tg = J["P"], J["tg"]
    c0 = P[vi]
    t0 = tg[vi]
    eu = nrm(UP - UP.dot(t0) * t0)
    es = np.cross(t0, eu)
    rad = J["w"][vi] * 0.5 + 0.12
    a = np.radians(np.linspace(-55, 215, 30))
    prong = c0[None] + rad * (np.cos(a)[:, None] * es[None] + np.sin(a)[:, None] * eu[None])
    prong[:, :] += (t0 * 0.03)[None] * np.linspace(0, 1, 30)[:, None]
    G0 = prong[0]
    tt = np.linspace(0, 1, len(prong))
    A["Iron"].add_tube(prong, 0.026 * (1 - tt) ** 0.6 + 0.004, sides=7, cap1=False, m=tt, g=0.0)
    shank_end = G0 + DOWN * 0.5
    A["Iron"].add_tube(np.array([G0, shank_end]), 0.03, sides=8, m=0.0)
    out0 = nrm(prong[3] - G0)
    for sg in (-1, 1):
        dd = rot(DOWN, sg * math.radians(120)) @ nrm(out0 - out0.dot(DOWN) * DOWN + 1e-6)
        Pp = bezier([G0, G0 + dd * 0.18 + UP * 0.02, G0 + dd * 0.28 + DOWN * 0.12, G0 + dd * 0.2 + DOWN * 0.26], 16)
        ts = np.linspace(0, 1, 16)
        A["Iron"].add_tube(Pp, 0.024 * (1 - ts) ** 0.6 + 0.004, sides=6, cap1=False, m=ts)
    e1 = perp(DOWN)
    eye = shank_end + DOWN * 0.05 + 0.06 * (np.cos(np.linspace(0, 2 * math.pi, 16))[:, None] * e1 + np.sin(np.linspace(0, 2 * math.pi, 16))[:, None] * UP)
    A["Iron"].add_tube(eye, 0.014, sides=6, cap0=False, cap1=False, m=0.0)
    # rope: knotted on the eye, hanging with a slight sway, frayed where it snapped
    top = shank_end + DOWN * 0.1
    n = 60
    L = 1.2
    sway = NZ.vec(top[None] * 2.0)[0] * 0.2
    tt = np.linspace(0, 1, n)
    R = top[None] + DOWN[None] * (L * tt)[:, None] + sway[None] * (tt ** 2)[:, None] + es[None] * 0.12 * np.sin(tt * 3.0)[:, None]
    A["Rope"].add_tube(R, 0.021, sides=8, cap0=True, cap1=False, m=np.clip(tt * 3 - 2.0, 0, 1) * 0 + tt)
    V, F = blob(top, basis_axes(e1, np.cross(DOWN, e1), UP, 0.045, 0.045, 0.06), sub=2, amp=0.25)
    A["Rope"].add(V, F, m=0.5)
    end = R[-1]
    for i in range(9):
        d = nrm(DOWN * 1.0 + rot(DOWN, 2 * math.pi * i / 9) @ e1 * rng.uniform(0.2, 0.6))
        Lf = rng.uniform(0.05, 0.14)
        Pf = bezier([end, end + d * Lf * 0.5, end + d * Lf + rot(DOWN, rng.uniform(0, 6.3)) @ e1 * Lf * 0.3], 6)
        A["Rope"].add_tube(Pf, np.linspace(0.006, 0.0015, 6), sides=3, cap0=False, cap1=False, m=1.0)
    CROWN["tether"] = (c0, end)


# =============================================================================
# Scale cues: Lanternwright cage fused into the back, ladder skewering the neck
# =============================================================================
def build_cage(v):
    O, T, D, S = spine_frame(v["s"] + v["Lb"] * 0.62)
    up = nrm(D + T * -0.55 + S * 0.25)
    side = perp(up)
    fwd = np.cross(up, side)
    base = O + D * (v["H"] * 0.42) - up * 0.15
    rad, hgt = 0.42, 1.55
    nb = 14
    for j in range(nb):
        a = 2 * math.pi * j / nb
        dr = math.cos(a) * side + math.sin(a) * fwd
        pts = []
        for h in np.linspace(0, hgt, 9):
            bow = 0.0
            if j in (0, 1):
                bow = 0.2 * math.sin(math.pi * h / hgt)
            pts.append(base + dr * (rad + bow) + up * h)
        for ang in np.linspace(0, math.pi / 2, 7)[1:]:
            pts.append(base + up * (hgt + math.sin(ang) * 0.36) + dr * rad * math.cos(ang) * 0.98 + dr * 0.006)
        if j == 5:
            pts = pts[:6]  # snapped bar
        A["Iron"].add_tube(np.array(pts), 0.013, sides=6, m=0.0)
    for h in (0.0, 0.52, 1.04, hgt):
        ring = base + up * h + rad * (np.cos(np.linspace(0, 2 * math.pi, 36))[:, None] * side + np.sin(np.linspace(0, 2 * math.pi, 36))[:, None] * fwd)
        A["Iron"].add_tube(ring, 0.014, ry=0.03, up=up, sides=6, cap0=False, cap1=False, m=0.0)
    top = base + up * (hgt + 0.36)
    loop = top + up * 0.1 + 0.09 * (np.cos(np.linspace(0, 2 * math.pi, 16))[:, None] * side + np.sin(np.linspace(0, 2 * math.pi, 16))[:, None] * up)
    A["Iron"].add_tube(loop, 0.02, sides=6, cap0=False, cap1=False, m=0.0)
    # the dead Lanternwright lantern still hanging inside, an ember left in it
    lan = top - up * 0.75
    chain(np.array([top, lan + up * 0.18]), 0.5)
    for j in range(6):
        a = 2 * math.pi * j / 6
        dr = math.cos(a) * side + math.sin(a) * fwd
        A["Iron"].add_tube(np.array([lan + dr * 0.09 + up * 0.17, lan + dr * 0.11, lan + dr * 0.09 - up * 0.17]), 0.008, sides=4, m=0.0)
    V, F = blob(lan, basis_axes(side, fwd, up, 0.055, 0.055, 0.09), sub=2, amp=0.1)
    A["Ember"].add(V, F)
    # flesh engulfing the cage: base mass, tendons wrapping bars, veins
    V, F = blob(base + up * 0.1, basis_axes(side, fwd, up, 0.8, 0.75, 0.42), sub=4, amp=0.22, freq=2.2)
    A["Flesh"].add(V, F, m=0.0)
    for j in range(7):
        a = 2 * math.pi * (j * 2) / nb
        dr = math.cos(a) * side + math.sin(a) * fwd
        tdr = np.cross(up, dr)
        h1 = rng.uniform(0.4, 1.3)
        t = np.linspace(0, 1, 40)
        hel = base[None] + dr[None] * rad + up[None] * (h1 * t)[:, None] + (dr[None] * np.cos(t * 14)[:, None] + tdr[None] * np.sin(t * 14)[:, None]) * 0.03
        A["Tendon"].add_tube(hel, 0.012 * (1.3 - t), sides=5, cap0=False)
    for j in range(4):
        a = rng.uniform(0, 2 * math.pi)
        dr = math.cos(a) * side + math.sin(a) * fwd
        P = np.array([base + dr * rad * 0.8 + up * h + np.cross(up, dr) * 0.04 * math.sin(h * 9) for h in np.linspace(0.1, rng.uniform(0.8, 1.6), 20)])
        A["Vein"].add_tube(P, 0.01, sides=5, g=1.0)
    pierce(base + side * 0.4 + up * 0.3, side + DOWN, 2.6, hook=True, scale=0.9)


def build_ladder(v):
    O, T, D, S = spine_frame(v["s"])
    along = nrm(S * 1.0 - T * 0.55 + D * 0.42)
    across = nrm(np.cross(along, D))
    p0 = O - along * 0.6
    length, wdt = 3.4, 0.46
    t = np.linspace(0, 1, 30)
    for sgn in (-1, 1):
        P = p0[None] + along[None] * (length * t)[:, None] + across[None] * sgn * wdt / 2
        P += (D * 0.25)[None] * (t ** 2)[:, None] + (T * -0.2)[None] * (t ** 3)[:, None]
        if sgn > 0:
            P = P[:26]
        A["Iron"].add_tube(P, 0.024, ry=0.008, up=across, sides=4, m=0.0)
    for i, tt in enumerate(np.arange(0.22, 0.95, 0.088)):
        if i == 4:
            continue
        a = p0 + along * length * tt + (D * 0.25) * tt ** 2 + (T * -0.2) * tt ** 3
        P = np.array([a - across * wdt / 2, a + across * wdt / 2])
        if i == 6:
            P = np.array([a - across * wdt / 2, a - across * 0.05 + D * 0.12, a + across * 0.1 + D * 0.3])
            P = bezier(P, 8)
        A["Iron"].add_tube(resample(P, 6), 0.016, sides=6, m=0.0)
    # tissue grown over the rails where it exits the flesh
    exitp = O + along * 1.0
    V, F = blob(exitp, basis_axes(along, across, D, 0.35, 0.4, 0.3), sub=3, amp=0.25, freq=3.0)
    A["Flesh"].add(V, F, m=0.0)
    for q in range(5):
        a = exitp + across * rng.uniform(-0.3, 0.3)
        b = exitp + along * rng.uniform(0.4, 0.9) + across * rng.uniform(-0.25, 0.25)
        A["Tendon"].add_tube(sag_path(a, b, 0.05, 10), 0.018, sides=6, cap0=False, cap1=False)


# =============================================================================
# Tail
# =============================================================================
def lathe(prof_rz, center, axis, nseg=36):
    """Revolve a closed (r, z) profile around axis."""
    axis = nrm(axis)
    e1 = perp(axis)
    e2 = np.cross(axis, e1)
    prof_rz = np.asarray(prof_rz, float)
    th = np.linspace(0, 2 * math.pi, nseg + 1)
    V = (center[None, None, :] + prof_rz[None, :, 0:1] * (np.cos(th)[:, None, None] * e1 + np.sin(th)[:, None, None] * e2)
         + prof_rz[None, :, 1:2] * axis[None, None, :])
    n_t, n_p = V.shape[:2]
    idx = np.arange(n_t * n_p).reshape(n_t, n_p)
    quads = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1).reshape(-1, 4)
    return V.reshape(-1, 3), quads


def build_bell_at(top, Hb=1.25, Rl=0.6, axis=None):
    """A cracked Lanternwright bronze bell (mouth along -axis) hanging from `top`."""
    axis = UP if axis is None else nrm(axis)
    zs = np.linspace(0, 1, 18)
    r_out = Rl * (0.62 + 0.38 * np.exp(-zs * 9.0)) * (1 - 0.35 * zs ** 3) + 0.067 * Rl * np.exp(-((zs - 0.06) / 0.05) ** 2)
    r_out[-1] = 0.0
    z_out = zs * Hb
    dome = np.linspace(0, math.pi / 2, 6)[1:]
    prof = [(r_out[i], z_out[i]) for i in range(len(zs) - 1)]
    prof += [(r_out[-2] * math.cos(a), Hb * 0.94 + 0.1 * Hb * math.sin(a)) for a in dome]
    inner = [(max(r - 0.09 * Rl, 0.0), z) for (r, z) in prof[::-1] if z < Hb * 0.9]
    prof = prof + [(0.0, Hb * 0.9)] + inner + [(Rl * 0.95, 0.0)]
    base = top - axis * (Hb + 0.1 * Hb)
    V, F = lathe(prof, base, axis, 40)
    A["Bronze"].add(V, F, m=0.0)
    e1 = perp(axis)
    e2 = np.cross(axis, e1)
    for i in range(7):  # the crack: a dark fissure up one side, ember light in it
        p = base + e1 * Rl * (0.96 - 0.05 * i) + axis * (0.03 + i * 0.1 * Hb) + e2 * 0.03 * Rl * math.sin(i * 2.1)
        V2, F2 = blob(p, basis_axes(e1, e2, axis, 0.06 * Rl, 0.03 * Rl, 0.13 * Rl), sub=1, amp=0.2)
        A["Marrow"].add(V2, F2, g=0.7)
    for ang in (0.0, math.pi / 2):
        d = math.cos(ang) * e1 + math.sin(ang) * e2
        ring = top + 0.2 * Rl * (np.cos(np.linspace(0, 2 * math.pi, 18))[:, None] * d + np.sin(np.linspace(0, 2 * math.pi, 18))[:, None] * axis)
        A["Bronze"].add_tube(ring, 0.05 * Rl, sides=6, cap0=False, cap1=False, m=0.0)
    A["Iron"].add_tube(np.array([top - axis * 0.1 * Hb, base + axis * 0.2 * Hb]), 0.04 * Rl, sides=6, m=0.0)
    V2, F2 = blob(base + axis * 0.12 * Hb, basis_axes(e1, e2, axis, 0.16 * Rl, 0.16 * Rl, 0.22 * Rl), sub=2, amp=0.05)
    A["Iron"].add(V2, F2, m=0.0)
    # a chunk broken out of the lip
    for i in range(3):
        V2, F2 = blob(base + e2 * Rl * 0.93 + e1 * (i - 1) * 0.08 * Rl + axis * 0.03, basis_axes(e1, e2, axis, 0.07 * Rl, 0.05 * Rl, 0.05 * Rl), sub=1, amp=0.3)
        A["Marrow"].add(V2, F2, g=0.3)


def build_tail(v):
    s0 = v["s"] + v["Lb"] / 2 - 0.1
    ss = np.linspace(s0, s0 + 2.8, 20)
    O, T, D, S = spine_frames(ss)
    t = np.linspace(0, 1, len(ss))
    r = 0.35 * v["k"] * (1 - t) ** 1.2 + 0.01
    V, F, uv, al = tube(O, r, sides=6, nz_amp=0.1, seed=3.0, fr=(T, S, np.cross(T, S)))
    A["Carved"].add(V, F, uv)
    for _ in range(4):
        st = O[rng.randint(0, 8)]
        rebar(st, nrm(-T[0] + D[0] * rng.uniform(0.2, 1.0) + S[0] * rng.uniform(-0.8, 0.8)), rng.uniform(0.6, 1.4),
              DOWN, 0.2, 0.016)
    for _ in range(2):
        pierce(O[rng.randint(2, 8)] + D[0] * 0.1, D[0] + DOWN, rng.uniform(2.0, 4.0), hook=rng.random() < 0.5)


# =============================================================================
# Assemble the creature
# =============================================================================
def build_creature():
    log("spine length %.1f m" % L_TOTAL)
    s = 1.42
    i = 0
    while s < L_TOTAL - 0.7:
        k = kprof(s) * (1 + rng.uniform(-0.04, 0.04))
        build_vertebra(i, s, k)
        s += 1.34 * kprof(s + 0.65)
        i += 1
    log("vertebrae:", len(VERTS))
    for a, b in zip(VERTS[:-1], VERTS[1:]):
        build_disc(a, b)
    # disc between the crown ring and the first vertebra is the neck collar (in build_crown)
    build_crown()
    log("crown done")
    n = len(VERTS)
    # fewer, heavier, irregularly spaced legs: each side walks the body on its own uneven rhythm
    slots = []
    for sigma in (-1, 1):
        i = 3 if sigma < 0 else 4
        while i < n - 1:
            slots.append((i, sigma))
            i += rng.choice((1, 2, 2, 2, 3))
    pool = [sl for sl in slots if 4 <= sl[0] < n - 2]
    rng.shuffle(pool)
    special = {}
    for sl in pool[:2]:
        special[sl] = "broken"
    special[pool[2]] = "missing"
    for sl in pool[3:6]:
        special[sl] = "lifted"
    for sigma in (-1, 1):  # the two forelegs reaching for the player; one still carries a dead climber's lantern
        build_leg(VERTS[1], sigma, "reach", 1.2, lantern=(sigma > 0))
    for (i, sigma) in sorted(slots):
        v = VERTS[i]
        kind = special.get((i, sigma), "normal")
        r = rng.random()
        size = rng.uniform(1.3, 1.6) if r < 0.25 else (rng.uniform(0.55, 0.7) if r < 0.42 else rng.uniform(0.85, 1.1))
        build_leg(v, sigma, kind, size, rng.uniform(-0.25, 0.25) * v["k"])
        if kind == "normal" and rng.random() < 0.12:
            build_leg(v, sigma, "normal", rng.uniform(0.5, 0.62), -0.5 * v["k"])  # doubled, stunted
    log("legs:", len(slots) + 2, "slots")
    # skyline set-pieces
    build_belfry(VERTS[SKYLINE["belfry"]])
    build_great_spire(VERTS[SKYLINE["spire"]])
    build_ibeam(VERTS[SKYLINE["ibeam"]])
    build_cluster(VERTS[SKYLINE["cluster"]])
    build_fin(VERTS[SKYLINE["fin"]], VERTS[min(SKYLINE["fin"] + 1, n - 1)])
    build_pipe(VERTS[SKYLINE["pipe"]])
    log("legs done")
    # chains piercing intervertebral flesh, a couple of sagging loops between segments
    for idx in (3, 6, 9, 12, 15, 18):
        if idx >= n - 1:
            continue
        va, vb = VERTS[idx], VERTS[idx + 1]
        sm = (va["s"] + va["Lb"] / 2 + vb["s"] - vb["Lb"] / 2) / 2
        O, T, D, S = spine_frame(sm)
        sg = rng.choice((-1, 1))
        p_in = O + S * sg * 0.62 * va["k"] + D * rng.uniform(-0.1, 0.3) * va["k"]
        pierce(p_in, S * sg + D * 0.3 + DOWN * 0.3, rng.uniform(1.8, 4.5), hook=rng.random() < 0.6, scale=va["k"] ** 0.5)
    for idx in (5, 11):
        if idx + 3 >= n:
            continue
        va, vb = VERTS[idx], VERTS[idx + 3]
        Oa, Ta, Da, Sa = spine_frame(va["s"] + va["Lb"] * 0.6)
        Ob, Tb, Db, Sb = spine_frame(vb["s"] + vb["Lb"] * 0.6)
        pa = Oa + Sa * 0.75 * va["k"] + Da * 0.2
        pb = Ob + Sb * 0.75 * vb["k"] + Db * 0.2
        chain(sag_path(pa, pb, 1.4, 40, toward=Sa * 0.6))
    cage_v = min(VERTS, key=lambda v: abs(v["s"] - 9.6))
    build_cage(cage_v)
    ladder_v = min(VERTS, key=lambda v: abs(v["s"] - 3.4))
    build_ladder(ladder_v)
    build_tail(VERTS[-1])
    log("creature assembled")


# =============================================================================
# Environment: shaft wall, a masonry ledge and a lantern
# =============================================================================
LANTERN = {}


def build_env():
    npx, nz = 460, 460
    px = np.linspace(-27, 27, npx)
    zz = np.linspace(-14, 44, nz)
    PX, ZZ = np.meshgrid(px, zz, indexing="ij")
    P = wall_point(PX.ravel(), ZZ.ravel(), 0.0, disp=True)
    idx = np.arange(npx * nz).reshape(npx, nz)
    quads = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1).reshape(-1, 4)
    ENV["Rock"].add(P, quads, uv=np.stack([PX.ravel(), ZZ.ravel()], -1) / 4.0)
    # ledge of Lanternwright masonry below the creature
    for j, pxx in enumerate(np.arange(1.5, 11.5, 1.12)):
        zb = -1.25 + rng.uniform(-0.05, 0.05)
        phi = pxx / R_SHAFT
        tng = np.array([math.cos(phi), -math.sin(phi), 0.0])
        nin = np.array([-math.sin(phi), -math.cos(phi), 0.0])
        c = wall_point(pxx, zb, 0.55)[0]
        bm = stone_bm((1.05, 1.6, 0.48), chamfer=0.1, wear=0.03, chips=rng.randint(2, 5), subdiv=1)
        bm_xf(bm, mat4(tng, nin, UP, c))
        ENV["Masonry"].add_bm(bm)
    # bracket + lantern
    pl = 6.3
    c = wall_point(pl, -0.98, 0.95)[0]
    phi = pl / R_SHAFT
    tng = np.array([math.cos(phi), -math.sin(phi), 0.0])
    nin = np.array([-math.sin(phi), -math.cos(phi), 0.0])
    for j in range(6):
        a = 2 * math.pi * j / 6
        dr = math.cos(a) * tng + math.sin(a) * nin
        ENV["Iron"].add_tube(np.array([c + dr * 0.13, c + dr * 0.15 + UP * 0.22, c + dr * 0.12 + UP * 0.44]), 0.012, sides=4)
    for h in (0.0, 0.44):
        ring = c + UP * h + 0.14 * (np.cos(np.linspace(0, 2 * math.pi, 18))[:, None] * tng + np.sin(np.linspace(0, 2 * math.pi, 18))[:, None] * nin)
        ENV["Iron"].add_tube(ring, 0.02, sides=6, cap0=False, cap1=False)
    loop = c + UP * 0.56 + 0.07 * (np.cos(np.linspace(0, 2 * math.pi, 14))[:, None] * tng + np.sin(np.linspace(0, 2 * math.pi, 14))[:, None] * UP)
    ENV["Iron"].add_tube(loop, 0.012, sides=6, cap0=False, cap1=False)
    V, F = blob(c + UP * 0.22, basis_axes(tng, nin, UP, 0.085, 0.085, 0.14), sub=3, amp=0.05)
    ENV["Glow"].add(V, F)
    LANTERN["pos"] = c + UP * 0.22


# =============================================================================
# Materials (render-time procedural; Cycles)
# =============================================================================
class NT:
    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        for n in list(self.nt.nodes):
            self.nt.nodes.remove(n)
        self.out = self.nt.nodes.new("ShaderNodeOutputMaterial")
        self.bsdf = self.nt.nodes.new("ShaderNodeBsdfPrincipled")
        self.nt.links.new(self.bsdf.outputs[0], self.out.inputs["Surface"])
        try:
            self.bsdf.subsurface_method = "BURLEY"
        except Exception:
            pass

    def set(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        else:
            if isinstance(v, (tuple, list)) and len(v) == 3 and sock.type == "RGBA":
                v = (*v, 1.0)
            sock.default_value = v

    def n(self, typ, inputs=None, **props):
        node = self.nt.nodes.new(typ)
        for k, v in props.items():
            setattr(node, k, v)
        for k, v in (inputs or {}).items():
            self.set(node.inputs[k], v)
        return node

    def coord(self, kind="Object"):
        return self.n("ShaderNodeTexCoord").outputs[kind]

    def noise(self, vec, scale, detail=4.0, rough=0.55, distortion=0.0):
        nd = self.n("ShaderNodeTexNoise", {"Scale": scale, "Detail": detail, "Roughness": rough, "Distortion": distortion})
        if vec is not None:
            self.set(nd.inputs["Vector"], vec)
        return nd.outputs[0], nd.outputs[1]

    def voronoi(self, vec, scale, feature="F1", rand=1.0):
        nd = self.n("ShaderNodeTexVoronoi", {"Scale": scale, "Randomness": rand}, feature=feature)
        if vec is not None:
            self.set(nd.inputs["Vector"], vec)
        return nd.outputs["Distance"], nd.outputs.get("Color")

    def wave(self, vec, scale, distortion=4.0, bands="BANDS", direction="X"):
        nd = self.n("ShaderNodeTexWave", {"Scale": scale, "Distortion": distortion, "Detail": 3.0},
                    wave_type=bands)
        try:
            nd.bands_direction = direction
        except Exception:
            pass
        if vec is not None:
            self.set(nd.inputs["Vector"], vec)
        return nd.outputs[1]

    def ramp(self, fac, stops):
        nd = self.n("ShaderNodeValToRGB")
        cr = nd.color_ramp
        cr.elements[0].position = stops[0][0]
        cr.elements[1].position = stops[-1][0]
        els = [cr.elements[0]]
        for pos, _ in stops[1:-1]:
            els.append(cr.elements.new(pos))
        els.append(cr.elements[len(cr.elements) - 1])
        for el, (pos, col) in zip(els, stops):
            el.color = col if len(col) == 4 else (*col, 1.0)
        self.set(nd.inputs[0], fac)
        return nd.outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        nd = self.n("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.set(nd.inputs[0], fac)
        self.set(nd.inputs[6], a)
        self.set(nd.inputs[7], b)
        return nd.outputs[2]

    def math(self, op, a, b=0.0, clamp=False):
        nd = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(nd.inputs[0], a)
        self.set(nd.inputs[1], b)
        return nd.outputs[0]

    def maprange(self, v, a, b, c=0.0, d=1.0, clamp=True):
        nd = self.n("ShaderNodeMapRange", clamp=clamp)
        self.set(nd.inputs["Value"], v)
        nd.inputs["From Min"].default_value = a
        nd.inputs["From Max"].default_value = b
        nd.inputs["To Min"].default_value = c
        nd.inputs["To Max"].default_value = d
        return nd.outputs["Result"]

    def vadd(self, a, b, scale=None):
        if scale is not None:
            nd = self.n("ShaderNodeVectorMath", operation="SCALE")
            self.set(nd.inputs[0], b)
            nd.inputs["Scale"].default_value = scale
            b = nd.outputs[0]
        nd = self.n("ShaderNodeVectorMath", operation="ADD")
        self.set(nd.inputs[0], a)
        self.set(nd.inputs[1], b)
        return nd.outputs[0]

    def vscale(self, a, sx, sy, sz):
        nd = self.n("ShaderNodeVectorMath", operation="MULTIPLY")
        self.set(nd.inputs[0], a)
        nd.inputs[1].default_value = (sx, sy, sz)
        return nd.outputs[0]

    def bump(self, h, strength, dist, normal=None):
        nd = self.n("ShaderNodeBump", {"Strength": strength, "Distance": dist})
        self.set(nd.inputs["Height"], h)
        if normal is not None:
            self.set(nd.inputs["Normal"], normal)
        return nd.outputs["Normal"]

    def attr(self, name="m"):
        return self.n("ShaderNodeAttribute", attribute_name=name).outputs["Fac"]

    def geo(self, out):
        return self.n("ShaderNodeNewGeometry").outputs[out]

    def pulse(self, period=3.1, phase=0.0, floor=0.22):
        """Ember pulse bands along the spine (in game: phase -= speed * time, so they crawl head-ward)."""
        sa = self.attr("spine_s")
        x = self.math("ADD", self.math("MULTIPLY", sa, 2 * math.pi / period), phase)
        c = self.math("ADD", self.math("MULTIPLY", self.math("COSINE", x), 0.5), 0.5)
        c = self.math("POWER", c, 3.0)
        band = self.math("ADD", self.math("MULTIPLY", c, 1.0 - floor), floor)
        head = self.maprange(sa, 0.0, 29.0, 1.35, 0.45)
        return self.math("MULTIPLY", band, head)

    def p(self, **kw):
        names = {"base": "Base Color", "metal": "Metallic", "rough": "Roughness", "ssw": "Subsurface Weight",
                 "ssr": "Subsurface Radius", "sss": "Subsurface Scale", "coat": "Coat Weight",
                 "coat_rough": "Coat Roughness", "emc": "Emission Color", "ems": "Emission Strength",
                 "normal": "Normal", "coat_normal": "Coat Normal", "trans": "Transmission Weight", "ior": "IOR",
                 "spec": "Specular IOR Level", "sheen": "Sheen Weight", "sheen_tint": "Sheen Tint"}
        for k, v in kw.items():
            self.set(self.bsdf.inputs[names[k]], v)


EMBER = (1.0, 0.3, 0.06)


def mat_stone(name="M_Stone", tint=(1.0, 1.0, 1.0), wet=0.5, glow=1.0):
    """Pale Lanternwright limestone: chisel/tool marks, point-chisel pitting, grime, old blood.
    Glow is NOT painted over the stone; it lives in the seams (Seam group) and veins only."""
    m = bpy.data.materials.new(name)
    g = NT(m)
    co = g.coord("Object")
    _, wn = g.noise(co, 0.5, 2.0)
    cw = g.vadd(co, wn, 0.35)
    n1, _ = g.noise(cw, 1.4, 8.0, 0.62)
    n2, _ = g.noise(cw, 6.5, 6.0, 0.6)
    n3, _ = g.noise(cw, 22.0, 3.0, 0.5)
    base = g.ramp(n1, [(0.24, (0.16, 0.152, 0.138)), (0.46, (0.36, 0.345, 0.312)), (0.66, (0.5, 0.48, 0.43)),
                       (0.84, (0.6, 0.578, 0.52))])
    isl = g.geo("Random Per Island")
    itint = g.ramp(isl, [(0.0, (0.62, 0.6, 0.58)), (0.3, (0.86, 0.84, 0.8)), (0.65, (1.0, 0.98, 0.93)),
                         (1.0, (1.1, 1.04, 0.94))])
    base = g.mix(1.0, base, itint, "MULTIPLY")
    base = g.mix(1.0, base, (tint[0], tint[1], tint[2], 1.0), "MULTIPLY")
    pt = g.geo("Pointiness")
    cav = g.ramp(pt, [(0.42, (0.22, 0.2, 0.19)), (0.5, (1, 1, 1)), (0.56, (1.25, 1.22, 1.15))])
    base = g.mix(1.0, base, cav, "MULTIPLY")
    # tool marks: parallel claw-chisel furrows, direction randomised per block (island)
    rot_ = g.n("ShaderNodeVectorRotate", rotation_type="Z_AXIS")
    g.set(rot_.inputs["Vector"], co)
    g.set(rot_.inputs["Angle"], g.math("MULTIPLY", isl, 6.2832))
    rv = g.vadd(rot_.outputs["Vector"], wn, 0.04)
    tool = g.wave(rv, 9.0, 1.2, "BANDS", "X")
    tmask, _ = g.noise(co, 1.1, 2.0)
    tmask = g.maprange(tmask, 0.42, 0.6, 0.0, 1.0)
    # point-chisel pitting
    pv, _ = g.voronoi(co, 34.0, "F1")
    pits = g.maprange(pv, 0.0, 0.22, 1.0, 0.0)
    # sparse deep hairline cracks (few, not a crackle)
    _, wn2 = g.noise(co, 3.0, 3.0)
    cw2 = g.vadd(co, wn2, 0.12)
    vd, _ = g.voronoi(cw2, 1.6, "DISTANCE_TO_EDGE")
    crack = g.maprange(vd, 0.0, 0.008, 1.0, 0.0)
    cm, _ = g.noise(co, 0.9, 2.0)
    cmask = g.maprange(cm, 0.56, 0.64, 0.0, 1.0)
    crack = g.math("MULTIPLY", crack, cmask)
    base = g.mix(crack, base, (0.01, 0.008, 0.007, 1.0))
    base = g.mix(g.math("MULTIPLY", pits, 0.35), base, (0.08, 0.075, 0.07, 1.0))
    # grime streaks running down (gravity) and dried blood near wounds
    st = g.vscale(co, 6.0, 6.0, 0.35)
    sn, _ = g.noise(st, 1.0, 4.0, 0.6)
    streak = g.maprange(sn, 0.5, 0.74, 0.0, 1.0)
    base = g.mix(g.math("MULTIPLY", streak, 0.75), base, (0.035, 0.03, 0.028, 1.0))
    bn, _ = g.noise(co, 1.7, 5.0, 0.7)
    blood = g.maprange(bn, 0.6, 0.74, 0.0, 0.85)
    base = g.mix(blood, base, (0.075, 0.012, 0.008, 1.0))
    rough = g.maprange(n2, 0.3, 0.7, 0.68, 0.95)
    rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", streak, 0.35 * wet))
    h = g.math("ADD", g.math("MULTIPLY", n2, 0.55), g.math("MULTIPLY", n3, 0.22))
    h = g.math("SUBTRACT", h, g.math("MULTIPLY", crack, 0.8))
    h = g.math("ADD", h, g.math("MULTIPLY", g.math("MULTIPLY", tool, tmask), 0.22))
    h = g.math("SUBTRACT", h, g.math("MULTIPLY", pits, 0.18))
    n4, _ = g.noise(cw, 60.0, 3.0, 0.6)
    h = g.math("ADD", h, g.math("MULTIPLY", n4, 0.1))
    nrmv = g.bump(h, 0.8, 0.035)
    g.p(base=base, rough=rough, normal=nrmv, coat=g.math("MULTIPLY", streak, 0.6 * wet),
        coat_rough=0.12, spec=0.4)
    return m


def mat_flesh(name="M_Flesh", dark=False, glowmul=1.0, gum=False):
    m = bpy.data.materials.new(name)
    g = NT(m)
    co = g.coord("Object")
    _, wn = g.noise(co, 2.0, 2.0)
    cw = g.vadd(co, wn, 0.15)
    n1, _ = g.noise(cw, 3.5, 6.0, 0.6)
    n2, _ = g.noise(cw, 14.0, 4.0, 0.6)
    vd, _ = g.voronoi(cw, 7.0, "DISTANCE_TO_EDGE")
    vein = g.maprange(vd, 0.0, 0.045, 1.0, 0.0)
    if gum:
        base = g.ramp(n1, [(0.3, (0.03, 0.003, 0.006)), (0.55, (0.11, 0.012, 0.016)), (0.75, (0.2, 0.03, 0.03)),
                           (0.9, (0.3, 0.12, 0.1))])
    elif dark:
        base = g.ramp(n1, [(0.3, (0.018, 0.002, 0.004)), (0.6, (0.06, 0.006, 0.008)), (0.8, (0.13, 0.02, 0.018))])
    else:
        base = g.ramp(n1, [(0.25, (0.035, 0.005, 0.006)), (0.5, (0.13, 0.02, 0.018)), (0.7, (0.24, 0.05, 0.035)),
                           (0.88, (0.34, 0.2, 0.14))])
    base = g.mix(g.math("MULTIPLY", vein, 0.75), base, (0.05, 0.01, 0.045, 1.0))
    glow = g.math("MAXIMUM", g.math("MULTIPLY", g.attr("m"), 0.5), g.attr("glow"))
    gn, _ = g.noise(co, 2.5, 3.0)
    gl = g.math("MULTIPLY", g.math("MULTIPLY", glow, g.maprange(gn, 0.35, 0.7, 0.2, 1.0)), g.pulse())
    h = g.math("ADD", n1, g.math("MULTIPLY", n2, 0.4))
    h = g.math("ADD", h, g.math("MULTIPLY", vein, 0.3))
    nrmv = g.bump(h, 0.45, 0.02)
    g.p(base=base, rough=0.38, ssw=1.0, ssr=(1.0, 0.25, 0.15), sss=0.02 if (dark or gum) else 0.05, coat=1.0,
        coat_rough=0.07, normal=nrmv, coat_normal=g.bump(n2, 0.15, 0.01), emc=EMBER,
        ems=g.math("MULTIPLY", gl, 2.6 * glowmul))
    return m


def mat_tendon():
    m = bpy.data.materials.new("M_Tendon")
    g = NT(m)
    uv = g.coord("UV")
    stri = g.wave(g.vscale(uv, 40.0, 0.4, 1.0), 1.0, 6.0, "BANDS", "X")
    co = g.coord("Object")
    n1, _ = g.noise(co, 4.0, 4.0)
    base = g.ramp(n1, [(0.3, (0.18, 0.035, 0.03)), (0.55, (0.36, 0.17, 0.12)), (0.75, (0.48, 0.36, 0.27))])
    base = g.mix(g.math("MULTIPLY", stri, 0.35), base, (0.22, 0.03, 0.03, 1.0))
    nrmv = g.bump(stri, 0.35, 0.006)
    g.p(base=base, rough=0.32, ssw=0.8, ssr=(1.0, 0.35, 0.25), sss=0.02, coat=0.9, coat_rough=0.08, normal=nrmv)
    return m


def mat_bone():
    m = bpy.data.materials.new("M_Bone")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 3.0, 6.0, 0.6)
    vd, _ = g.voronoi(co, 40.0, "F1")
    pores = g.maprange(vd, 0.0, 0.15, 1.0, 0.0)
    base = g.ramp(n1, [(0.3, (0.3, 0.24, 0.16)), (0.55, (0.55, 0.48, 0.36)), (0.75, (0.68, 0.62, 0.5))])
    pt = g.geo("Pointiness")
    cav = g.ramp(pt, [(0.44, (0.3, 0.2, 0.15)), (0.5, (1, 1, 1))])
    base = g.mix(1.0, base, cav, "MULTIPLY")
    al = g.attr("m")
    ends = g.math("MAXIMUM", g.maprange(al, 0.0, 0.12, 1.0, 0.0), g.maprange(al, 0.9, 1.0, 0.0, 1.0))
    base = g.mix(g.math("MULTIPLY", ends, 0.75), base, (0.16, 0.02, 0.015, 1.0))
    nrmv = g.bump(g.math("ADD", n1, g.math("MULTIPLY", pores, -0.3)), 0.4, 0.01)
    g.p(base=base, rough=0.42, ssw=0.25, ssr=(0.9, 0.5, 0.3), sss=0.02, coat=0.45, coat_rough=0.15, normal=nrmv)
    return m


def mat_iron():
    m = bpy.data.materials.new("M_Rust")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 5.0, 8.0, 0.65)
    n2, _ = g.noise(co, 25.0, 4.0, 0.6)
    vd, _ = g.voronoi(co, 18.0, "F1")
    rust = g.maprange(n1, 0.38, 0.55, 0.0, 1.0)
    al = g.attr("m")
    tip = g.maprange(al, 0.75, 0.97, 0.0, 1.0)
    rust = g.math("MULTIPLY", rust, g.math("SUBTRACT", 1.0, tip))
    rc = g.ramp(n2, [(0.3, (0.07, 0.022, 0.01)), (0.55, (0.22, 0.07, 0.025)), (0.8, (0.36, 0.14, 0.05))])
    base = g.mix(rust, (0.09, 0.088, 0.09, 1.0), rc)
    # heat tint where iron was torn / driven hot through flesh: straw -> purple -> blue -> dull red
    heat = g.attr("glow")
    hn = g.math("ADD", heat, g.math("MULTIPLY", g.math("SUBTRACT", n2, 0.5), 0.25))
    tintc = g.ramp(hn, [(0.05, (0.09, 0.088, 0.09)), (0.3, (0.5, 0.36, 0.13)), (0.5, (0.26, 0.09, 0.26)),
                        (0.68, (0.08, 0.13, 0.32)), (0.88, (0.3, 0.05, 0.025))])
    hm = g.maprange(heat, 0.05, 0.25, 0.0, 1.0)
    base = g.mix(g.math("MULTIPLY", hm, g.math("SUBTRACT", 1.0, g.math("MULTIPLY", rust, 0.7))), base, tintc)
    metal = g.math("SUBTRACT", 1.0, rust)
    rough = g.mix(rust, (0.35, 0.35, 0.35, 1.0), (0.92, 0.92, 0.92, 1.0))
    h = g.math("ADD", g.math("MULTIPLY", n2, 0.5), g.math("MULTIPLY", vd, 0.3))
    h = g.math("MULTIPLY", h, rust)
    g.p(base=base, metal=metal, rough=rough, normal=g.bump(h, 0.6, 0.008), emc=(1.0, 0.16, 0.03),
        ems=g.math("MULTIPLY", g.maprange(heat, 0.9, 1.0, 0.0, 1.0), 1.5))
    return m


def mat_teeth():
    """Rough, stained ivory: dark wet roots, yellow-brown staining, crazing; only the tips are wet."""
    m = bpy.data.materials.new("M_Teeth")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 9.0, 5.0)
    n2, _ = g.noise(co, 2.2, 4.0)
    al = g.attr("m")
    base = g.ramp(al, [(0.0, (0.035, 0.004, 0.004)), (0.16, (0.14, 0.045, 0.03)), (0.38, (0.36, 0.3, 0.2)),
                       (0.75, (0.56, 0.52, 0.42)), (1.0, (0.66, 0.63, 0.55))])
    stain = g.maprange(n2, 0.45, 0.7, 0.0, 0.7)
    base = g.mix(stain, base, (0.24, 0.16, 0.07, 1.0))
    base = g.mix(g.math("MULTIPLY", n1, 0.35), base, (0.1, 0.085, 0.07, 1.0))
    vd, _ = g.voronoi(co, 26.0, "DISTANCE_TO_EDGE")
    craze = g.maprange(vd, 0.0, 0.03, 1.0, 0.0)
    base = g.mix(g.math("MULTIPLY", craze, 0.5), base, (0.08, 0.05, 0.03, 1.0))
    wet = g.maprange(al, 0.55, 1.0, 0.0, 0.55)
    g.p(base=base, rough=g.maprange(al, 0.0, 1.0, 0.62, 0.34), coat=wet, coat_rough=0.1,
        ssw=g.maprange(al, 0.5, 1.0, 0.0, 0.35), ssr=(0.9, 0.75, 0.55), sss=0.01,
        normal=g.bump(g.math("ADD", n1, g.math("MULTIPLY", craze, -0.4)), 0.4, 0.004))
    return m


def mat_iron_tooth():
    """Blackened, hooked iron teeth driven in among the ivory ones."""
    m = bpy.data.materials.new("M_IronTooth")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 14.0, 6.0, 0.6)
    al = g.attr("m")
    rust = g.maprange(n1, 0.5, 0.66, 0.0, 1.0)
    rust = g.math("MULTIPLY", rust, g.maprange(al, 0.0, 0.6, 1.0, 0.0))
    base = g.mix(rust, (0.025, 0.023, 0.024, 1.0), (0.13, 0.04, 0.015, 1.0))
    base = g.mix(g.maprange(al, 0.0, 0.2, 0.8, 0.0), base, (0.05, 0.004, 0.004, 1.0))
    g.p(base=base, metal=g.math("SUBTRACT", 0.85, rust), rough=g.maprange(al, 0.0, 1.0, 0.75, 0.3), coat=0.5,
        coat_rough=0.15, normal=g.bump(n1, 0.5, 0.004))
    return m


def mat_ember(strength=22.0, name="M_Ember"):
    m = bpy.data.materials.new(name)
    g = NT(m)
    co = g.coord("Object")
    vd, _ = g.voronoi(co, 18.0, "F1")
    vd2, _ = g.voronoi(co, 18.0, "DISTANCE_TO_EDGE")
    n1, _ = g.noise(co, 6.0, 4.0)
    core = g.ramp(n1, [(0.3, (0.55, 0.05, 0.005)), (0.55, (1.0, 0.28, 0.04)), (0.75, (1.0, 0.62, 0.22))])
    crust = g.maprange(vd2, 0.0, 0.06, 0.0, 1.0)
    emc = g.mix(crust, (0.0, 0.0, 0.0, 1.0), core)
    g.p(base=(0.02, 0.008, 0.006), rough=0.6, emc=emc, ems=strength)
    return m


def mat_frond():
    m = bpy.data.materials.new("M_Frond")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 12.0, 4.0)
    al = g.attr("m")
    base = g.ramp(n1, [(0.3, (0.5, 0.42, 0.38)), (0.6, (0.68, 0.6, 0.54)), (0.85, (0.78, 0.71, 0.64))])
    base = g.mix(g.maprange(al, 0.0, 0.2, 1.0, 0.0), base, (0.32, 0.05, 0.05, 1.0))
    tipglow = g.math("POWER", al, 5.0)
    g.p(base=base, rough=0.4, ssw=1.0, ssr=(1.0, 0.45, 0.32), sss=0.06, coat=0.8, coat_rough=0.08,
        emc=(1.0, 0.45, 0.25), ems=g.math("MULTIPLY", tipglow, 0.25), normal=g.bump(n1, 0.25, 0.003))
    tr = g.n("ShaderNodeBsdfTranslucent")
    tr.inputs["Color"].default_value = (0.95, 0.5, 0.35, 1.0)
    ms = g.n("ShaderNodeMixShader")
    ms.inputs[0].default_value = 0.3
    g.nt.links.new(g.bsdf.outputs[0], ms.inputs[1])
    g.nt.links.new(tr.outputs[0], ms.inputs[2])
    g.nt.links.new(ms.outputs[0], g.out.inputs["Surface"])
    return m


def mat_bronze():
    """Corroded bell bronze: dark, rough, verdigris-crusted, so it reads as a silhouette against the forge."""
    m = bpy.data.materials.new("M_Bronze")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 3.0, 6.0, 0.6)
    n2, _ = g.noise(co, 18.0, 4.0)
    ver = g.maprange(n1, 0.4, 0.6, 0.0, 1.0)
    base = g.mix(ver, (0.05, 0.03, 0.016, 1.0), (0.025, 0.045, 0.035, 1.0))
    base = g.mix(g.maprange(n2, 0.55, 0.75, 0.0, 0.7), base, (0.01, 0.008, 0.007, 1.0))
    g.p(base=base, metal=g.maprange(ver, 0.0, 1.0, 0.25, 0.0), rough=g.maprange(ver, 0.0, 1.0, 0.65, 0.9),
        normal=g.bump(g.math("ADD", n2, n1), 0.5, 0.01))
    return m


def mat_mucus():
    m = bpy.data.materials.new("M_Mucus")
    g = NT(m)
    g.p(base=(0.8, 0.62, 0.48), rough=0.03, trans=1.0, ior=1.36)
    return m


def mat_vein():
    m = bpy.data.materials.new("M_Vein")
    g = NT(m)
    gl = g.math("MULTIPLY", g.attr("glow"), g.pulse())
    g.p(base=(0.07, 0.012, 0.035), rough=0.3, coat=0.9, coat_rough=0.08, ssw=0.5, ssr=(0.8, 0.2, 0.3), sss=0.01,
        emc=(1.0, 0.16, 0.04), ems=g.math("MULTIPLY", gl, 3.2))
    return m


def mat_seam():
    """Ember-crimson light leaking along fractures and seams: a dim line, never lava-bright."""
    m = bpy.data.materials.new("M_Seam")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 3.0, 3.0)
    flick = g.maprange(n1, 0.35, 0.7, 0.15, 1.0)
    gl = g.math("MULTIPLY", g.math("MULTIPLY", g.attr("glow"), g.pulse()), flick)
    emc = g.ramp(gl, [(0.0, (0.5, 0.03, 0.01)), (0.5, (1.0, 0.14, 0.03)), (1.0, (1.0, 0.36, 0.08))])
    g.p(base=(0.05, 0.008, 0.006), rough=0.4, coat=0.8, coat_rough=0.1, emc=emc, ems=g.math("MULTIPLY", gl, 7.0))
    return m


def mat_glass():
    """Cracked, grimy stained glass: dim blood-red and amber shards lit from behind by the forge."""
    m = bpy.data.materials.new("M_StainedGlass")
    g = NT(m)
    hue = g.attr("m")
    col = g.ramp(hue, [(0.0, (0.26, 0.02, 0.014)), (0.35, (0.36, 0.045, 0.025)), (0.6, (0.42, 0.14, 0.05)),
                       (0.85, (0.5, 0.27, 0.1)), (1.0, (0.2, 0.11, 0.06))])
    co = g.coord("Object")
    n1, _ = g.noise(co, 9.0, 4.0)
    grime = g.maprange(n1, 0.3, 0.75, 0.25, 1.0)
    br = g.math("MULTIPLY", g.attr("glow"), grime)
    g.p(base=g.mix(0.6, col, (0.02, 0.015, 0.012, 1.0)), rough=0.35, coat=0.6, coat_rough=0.2, emc=col,
        ems=g.math("MULTIPLY", br, 1.5))
    return m


def mat_rope():
    m = bpy.data.materials.new("M_Rope")
    g = NT(m)
    uv = g.coord("UV")
    tw = g.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    g.set(tw.inputs[0], uv)
    tw.inputs[1].default_value = (1.0, 9.0, 0.0)
    band = g.wave(g.vscale(tw.outputs["Value"], 1.0, 1.0, 1.0), 3.0, 1.5, "BANDS", "X")
    co = g.coord("Object")
    n1, _ = g.noise(co, 30.0, 6.0, 0.7)
    base = g.ramp(n1, [(0.3, (0.12, 0.085, 0.05)), (0.6, (0.3, 0.22, 0.13)), (0.8, (0.42, 0.33, 0.2))])
    base = g.mix(g.math("MULTIPLY", band, 0.5), base, (0.06, 0.04, 0.025, 1.0))
    bl = g.maprange(g.attr("m"), 0.0, 0.3, 0.8, 0.0)
    base = g.mix(bl, base, (0.09, 0.01, 0.008, 1.0))
    g.p(base=base, rough=0.92, sheen=0.4, normal=g.bump(g.math("ADD", band, g.math("MULTIPLY", n1, 0.4)), 0.6, 0.01))
    return m


def mat_oil():
    """Oil-blood: near-black red, glossy, where hooks bite rock and where joints weep."""
    m = bpy.data.materials.new("M_OilBlood")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 6.0, 4.0)
    base = g.ramp(n1, [(0.3, (0.012, 0.002, 0.002)), (0.7, (0.06, 0.008, 0.005))])
    g.p(base=base, rough=0.12, coat=1.0, coat_rough=0.03, spec=0.6)
    return m


def mat_membrane():
    m = bpy.data.materials.new("M_Membrane")
    g = NT(m)
    co = g.coord("Object")
    vd, _ = g.voronoi(co, 3.4, "DISTANCE_TO_EDGE")
    vd2, _ = g.voronoi(co, 11.0, "DISTANCE_TO_EDGE")
    vein = g.math("MAXIMUM", g.maprange(vd, 0.0, 0.05, 1.0, 0.0), g.maprange(vd2, 0.0, 0.03, 0.7, 0.0))
    bl, _ = g.noise(co, 2.0, 5.0, 0.6)
    base = g.mix(g.maprange(bl, 0.3, 0.7, 0.0, 1.0), (0.3, 0.07, 0.06, 1.0), (0.5, 0.2, 0.15, 1.0))
    base = g.mix(vein, base, (0.1, 0.008, 0.02, 1.0))
    g.p(base=base, rough=0.3, ssw=0.6, ssr=(1.0, 0.3, 0.2), sss=0.03, coat=1.0, coat_rough=0.06,
        normal=g.bump(g.math("ADD", bl, vein), 0.35, 0.015))
    tr = g.n("ShaderNodeBsdfTranslucent")
    g.set(tr.inputs["Color"], g.mix(vein, (0.9, 0.35, 0.22, 1.0), (0.1, 0.0, 0.01, 1.0)))
    ms = g.n("ShaderNodeMixShader")
    ms.inputs[0].default_value = 0.5
    g.nt.links.new(g.bsdf.outputs[0], ms.inputs[1])
    g.nt.links.new(tr.outputs[0], ms.inputs[2])
    g.nt.links.new(ms.outputs[0], g.out.inputs["Surface"])
    return m


def mat_rock():
    """Dark wet basalt: bedding strata, a few deep fractures (from geometry), wet streaks. No crackle."""
    m = bpy.data.materials.new("M_Rock")
    g = NT(m)
    co = g.coord("Object")
    _, wn = g.noise(co, 0.25, 2.0)
    cw = g.vadd(co, wn, 1.2)
    n1, _ = g.noise(cw, 0.6, 8.0, 0.62)
    n2, _ = g.noise(cw, 3.5, 6.0, 0.6)
    n3, _ = g.noise(cw, 14.0, 4.0, 0.55)
    st = g.vscale(co, 3.0, 3.0, 0.18)
    sn, _ = g.noise(st, 1.0, 5.0, 0.6)
    streak = g.maprange(sn, 0.5, 0.72, 0.0, 1.0)
    base = g.ramp(n1, [(0.3, (0.006, 0.006, 0.007)), (0.55, (0.018, 0.017, 0.018)), (0.78, (0.04, 0.037, 0.035))])
    # bedding strata: warped bands along z
    strat = g.wave(g.vscale(cw, 0.25, 0.25, 1.0), 0.22, 7.0, "BANDS", "Z")
    sband = g.maprange(strat, 0.35, 0.8, 0.0, 1.0)
    smask, _ = g.noise(co, 0.12, 2.0)
    sband = g.math("MULTIPLY", sband, g.maprange(smask, 0.4, 0.62, 0.0, 1.0))
    base = g.mix(g.math("MULTIPLY", sband, 0.35), base, (0.05, 0.046, 0.042, 1.0))
    base = g.mix(g.math("MULTIPLY", streak, 0.5), base, (0.03, 0.028, 0.027, 1.0))
    pt = g.geo("Pointiness")
    cav = g.ramp(pt, [(0.44, (0.15, 0.15, 0.15)), (0.5, (1, 1, 1)), (0.56, (1.35, 1.3, 1.25))])
    base = g.mix(1.0, base, cav, "MULTIPLY")
    h = g.math("ADD", g.math("MULTIPLY", n2, 0.7), g.math("MULTIPLY", n3, 0.3))
    h = g.math("ADD", h, g.math("MULTIPLY", sband, 0.25))
    rough = g.maprange(n2, 0.3, 0.7, 0.62, 0.92)
    rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", streak, 0.4))
    g.p(base=base, rough=rough, spec=0.45, normal=g.bump(h, 0.7, 0.08))
    return m


def mat_flat_black():
    m = bpy.data.materials.new("M_Silhouette")
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0, 0, 0, 1)
    em.inputs["Strength"].default_value = 0.0
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def setup_compositor(scene, glare=True, vignette=0.0):
    """Fog-glow on the embers and a soft vignette (render-time polish only)."""
    try:
        scene.render.compositor_device = "CPU"
    except Exception:
        pass
    ng = bpy.data.node_groups.new("OssuaryComp", "CompositorNodeTree")
    scene.compositing_node_group = ng
    rl = ng.nodes.new("CompositorNodeRLayers")
    out = ng.nodes.new("NodeGroupOutput")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    img = rl.outputs["Image"]
    if glare:
        gl = ng.nodes.new("CompositorNodeGlare")
        gl.inputs["Type"].default_value = "Fog Glow"
        gl.inputs["Threshold"].default_value = 1.0
        gl.inputs["Strength"].default_value = 0.35
        gl.inputs["Size"].default_value = 0.6
        ng.links.new(img, gl.inputs["Image"])
        img = gl.outputs["Image"]
    if vignette:
        em = ng.nodes.new("CompositorNodeEllipseMask")
        em.inputs["Size"].default_value = (0.95, 0.85)
        bl = ng.nodes.new("CompositorNodeBlur")
        bl.inputs["Size"].default_value = (300, 300)
        ng.links.new(em.outputs["Mask"], bl.inputs["Image"])
        mx = ng.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        ins = {sk.identifier: sk for sk in mx.inputs}
        ins["Factor_Float"].default_value = vignette
        ng.links.new(img, ins["A_Color"])
        inv = ng.nodes.new("ShaderNodeMix")
        inv.data_type = "RGBA"
        ii = {sk.identifier: sk for sk in inv.inputs}
        ng.links.new(bl.outputs["Image"], ii["Factor_Float"])
        ii["A_Color"].default_value = (0.0, 0.0, 0.0, 1)
        ii["B_Color"].default_value = (1.0, 1.0, 1.0, 1)
        ng.links.new(next(sk for sk in inv.outputs if sk.identifier == "Result_Color"), ins["B_Color"])
        img = next(sk for sk in mx.outputs if sk.identifier == "Result_Color")
    ng.links.new(img, out.inputs[0])
    return ng


# =============================================================================
# Scene build
# =============================================================================
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    creature = bpy.data.collections.new("Ossuary")
    env = bpy.data.collections.new("Shaft")
    sc.collection.children.link(creature)
    sc.collection.children.link(env)

    build_creature()
    build_env()

    mats = dict(Stone=mat_stone(), Carved=mat_stone("M_StoneCarved", (1.06, 1.02, 0.96), glow=0.6),
                Flesh=mat_flesh(), Marrow=mat_flesh("M_Marrow", dark=True, glowmul=1.0), Tendon=mat_tendon(),
                Bone=mat_bone(), Iron=mat_iron(), Teeth=mat_teeth(), Ember=mat_ember(), Frond=mat_frond(),
                Mucus=mat_mucus(), Vein=mat_vein(), Membrane=mat_membrane(),
                Gum=mat_flesh("M_Gum", gum=True, glowmul=1.0), Pit=mat_ember(9.0, "M_Pit"), Bronze=mat_bronze(),
                Seam=mat_seam(), Glass=mat_glass(), Rope=mat_rope(), Oil=mat_oil(), IronTooth=mat_iron_tooth())
    for k, mt in mats.items():
        try:
            mt.cycles.emission_sampling = "AUTO" if k in ("Ember",) else "NONE"
        except Exception as e:
            log("emission_sampling:", e)
    # marrow glows faintly in pockets
    flat = {"Stone"}
    objs = {}
    for k, acc in A.items():
        ob = acc.build(mats[k], creature, smooth=k not in flat,
                       sharp=math.radians(40) if k in ("Carved", "Iron", "Bronze", "IronTooth") else None)
        objs[k] = ob
    log("meshes built")
    # stone gets real geometric grain: simple subdivision + displacement
    tex = bpy.data.textures.new("StoneGrain", "CLOUDS")
    tex.noise_scale = 0.18
    tex.noise_depth = 3
    tex2 = bpy.data.textures.new("StoneChunks", "VORONOI")
    tex2.noise_scale = 0.32
    for k in ("Stone", "Carved"):
        ob = objs[k]
        if ob is None:
            continue
        md = ob.modifiers.new("Grain", "SUBSURF")
        md.subdivision_type = "SIMPLE"
        md.levels = md.render_levels = 1 if k == "Stone" else 1
        d1 = ob.modifiers.new("Chunks", "DISPLACE")
        d1.texture = tex2
        d1.texture_coords = "GLOBAL"
        d1.strength = 0.035
        d1.mid_level = 0.5
        d2 = ob.modifiers.new("Grain", "DISPLACE")
        d2.texture = tex
        d2.texture_coords = "GLOBAL"
        d2.strength = 0.014
        d2.mid_level = 0.5
    for k in ("Marrow", "Gum"):
        ob = objs[k]
        md = ob.modifiers.new("Smooth", "SUBSURF")
        md.levels = md.render_levels = 1

    rock = mat_rock()
    masonry = mat_stone("M_Masonry", (0.9, 0.9, 0.92), glow=0.0)
    envm = dict(Rock=rock, Masonry=masonry, Iron=mats["Iron"], Glow=mat_ember(40.0, "M_LanternGlow"),
                Rubble=mat_stone("M_Rubble", (0.16, 0.155, 0.15), wet=0.3), Oil=mats["Oil"])
    env_objs = {}
    for k, acc in ENV.items():
        env_objs[k] = acc.build(envm[k], env, smooth=k not in ("Masonry", "Rubble"))
    for k in ("Masonry",):
        ob = env_objs[k]
        md = ob.modifiers.new("Grain", "SUBSURF")
        md.subdivision_type = "SIMPLE"
        md.levels = md.render_levels = 1
        d2 = ob.modifiers.new("Grain", "DISPLACE")
        d2.texture = tex
        d2.texture_coords = "GLOBAL"
        d2.strength = 0.03

    # triangle count (evaluated, i.e. with render-time modifiers)
    dg = bpy.context.evaluated_depsgraph_get()
    tris = {}
    for k, ob in objs.items():
        if ob is None:
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris[k] = len(me.loop_triangles)
        ev.to_mesh_clear()
    total = sum(tris.values())
    log("creature triangles:", total, tris)

    # ------------------------------------------------------------------ lights
    def light(name, typ, loc, energy, color, size=0.1, target=None, spot=None, blend=0.4):
        ld = bpy.data.lights.new(name, typ)
        ld.energy = energy
        ld.color = color
        if typ in ("POINT", "SPOT"):
            ld.shadow_soft_size = size
        if typ == "SPOT":
            ld.spot_size = spot
            ld.spot_blend = blend
        ob = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(ob)
        try:
            ob.visible_camera = False
        except Exception:
            pass
        ob.location = Vector(loc)
        if target is not None:
            d = Vector(target) - Vector(loc)
            ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return ob

    C = CROWN["C"]
    Tc = CROWN["T"]
    Dc = CROWN["D"]
    Sc = CROWN["S"]
    L_throat = light("L_Throat", "POINT", CROWN["throat_light"], 160.0, (1.0, 0.2, 0.04), 0.2)
    L_forge = light("L_Forge", "POINT", CROWN["forge"] - Tc * 0.1, 90.0, (1.0, 0.14, 0.03), 0.2)
    L_mouth = light("L_Mouth", "POINT", CROWN["mouth_light"], 14.0, (1.0, 0.22, 0.05), 0.15)
    L_top = light("L_ShaftTop", "SPOT", (1.0, -11.0, 50.0), 300000.0, (0.55, 0.7, 1.0), 2.5,
                  target=(0.0, -1.5, 10.0), spot=math.radians(46), blend=0.7)
    hc = [float(x) for x in args.herocam.split(",")]
    hero_cam_loc = C + Tc * hc[0] + np.array([0, 0, hc[1]]) + Sc * hc[2]
    hero_target = C + Tc * hc[3] + np.array([0, 0, hc[4]]) + Sc * hc[5]
    L_lant_h = light("L_LanternHero", "POINT", hero_cam_loc + np.array([0.0, 0.0, -2.4]) - Sc * 0.2 - Tc * 1.2, 420.0,
                     (1.0, 0.76, 0.56), 0.05)
    L_lant_f = light("L_LanternFull", "POINT", LANTERN["pos"], 3800.0, (1.0, 0.52, 0.2), 0.15)
    L_fill = light("L_RimCold", "POINT", C - Tc * 1.4 + np.array([0, 1.0, 3.8]), 1700.0,
                   (0.55, 0.7, 1.0), 0.25)
    L_ffill = light("L_FullFill", "AREA", (14.0, -26.0, 26.0), 8000.0, (0.6, 0.72, 0.95), target=(-1.0, -1.0, 12.0))
    L_ffill.data.size = 10.0
    L_miner = light("L_Miner", "POINT", LANTERN.get("miner", C), 22.0, (1.0, 0.55, 0.22), 0.04)
    L_fkey = light("L_FullKey", "SPOT", (4.0, -21.0, 34.0), 90000.0, (0.62, 0.74, 1.0), 1.5,
                   target=(-1.0, -1.0, 12.0), spot=math.radians(30), blend=0.8)
    ac = [float(x) for x in args.approachcam.split(",")]
    app_loc = C + Tc * ac[0] + np.array([0, 0, ac[1]]) + Sc * ac[2] + Dc * ac[3]
    app_target = C + Tc * ac[4] + np.array([0, 0, ac[5]]) + Sc * ac[6]
    app_right = nrm(np.cross(app_target - app_loc, UP))
    L_player = light("L_PlayerLantern", "POINT", app_loc + np.array([0, 0, -0.5]) - app_right * 0.55, args.app_light,
                     (1.0, 0.68, 0.42), 0.04)

    # ------------------------------------------------------------------ cameras
    def camera(name, loc, target, lens):
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        cd.clip_start = 0.05
        cd.clip_end = 400
        ob = bpy.data.objects.new(name, cd)
        sc.collection.objects.link(ob)
        ob.location = Vector(loc)
        d = Vector(target) - Vector(loc)
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return ob

    cam_hero = camera("CAM_Hero", hero_cam_loc, hero_target, hc[6])
    cam_hero.data.dof.use_dof = True
    cam_hero.data.dof.focus_distance = float(np.linalg.norm(hero_cam_loc - (C + Tc * 1.4)))
    cam_hero.data.dof.aperture_fstop = 5.6
    fc = [float(x) for x in args.fullcam.split(",")]
    cam_full = camera("CAM_Full", fc[0:3], fc[3:6], fc[6])
    cam_app = camera("CAM_Approach", app_loc, app_target, ac[7])
    cam_app.data.dof.use_dof = True
    cam_app.data.dof.focus_distance = float(np.linalg.norm(app_loc - (C + Tc * 1.0)))
    cam_app.data.dof.aperture_fstop = 8.0
    log("approach cam", np.round(app_loc, 2), "dist to crown %.2f" % np.linalg.norm(app_loc - C))

    # ------------------------------------------------------------------ world
    world = bpy.data.worlds.new("Abyss")
    sc.world = world
    wnt = world.node_tree
    for n in list(wnt.nodes):
        wnt.nodes.remove(n)
    wout = wnt.nodes.new("ShaderNodeOutputWorld")
    bg = wnt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.0035, 0.0042, 0.0058, 1)
    bg.inputs["Strength"].default_value = 1.0
    wnt.links.new(bg.outputs[0], wout.inputs["Surface"])
    vol = wnt.nodes.new("ShaderNodeVolumeScatter")
    vol.inputs["Color"].default_value = (0.62, 0.66, 0.72, 1)
    vol.inputs["Anisotropy"].default_value = 0.35
    wnt.links.new(vol.outputs[0], wout.inputs["Volume"])

    # ------------------------------------------------------------------ render settings
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = args.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    cy.max_bounces = 6
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 3
    cy.transmission_bounces = 6
    cy.volume_bounces = 0
    cy.transparent_max_bounces = 8
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    if args.threads:
        sc.render.threads_mode = "FIXED"
        sc.render.threads = args.threads
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "8"
    sc.render.film_transparent = False

    def look(cinematic=True):
        vs = sc.view_settings
        if cinematic:
            vs.view_transform = "AgX"
            try:
                vs.look = "AgX - Medium High Contrast"
            except Exception:
                pass
            vs.exposure = 0.0
        else:
            vs.view_transform = "Standard"
            vs.look = "None"
            vs.exposure = 0.0

    silhouette_mat = mat_flat_black()
    comp_ok = False
    try:
        setup_compositor(sc, glare=True, vignette=0.55)
        comp_ok = True
    except Exception as e:
        log("compositor unavailable:", e)
    all_lights = [L_throat, L_forge, L_mouth, L_top, L_lant_h, L_lant_f, L_fill, L_ffill, L_miner, L_player, L_fkey]

    def show_lights(on):
        for ob in all_lights:
            ob.hide_render = ob.name not in on

    stats = dict(seed=SEED, spine_length_m=round(L_TOTAL, 2), vertebrae=len(VERTS),
                 creature_triangles=total, triangles_by_group=tris)
    with open(os.path.join(OUT, "stats.json"), "w") as fh:
        json.dump(stats, fh, indent=2)

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "ossuary.blend"))

    for shot in SHOTS:
        t0 = time.time()
        sc.view_layers[0].material_override = None
        for ob in env.objects:
            ob.hide_render = False
        if shot == "hero":
            sc.camera = cam_hero
            look(True)
            vol.inputs["Density"].default_value = args.hero_fog
            bg.inputs["Color"].default_value = (0.0035, 0.0042, 0.0058, 1)
            show_lights({"L_Forge", "L_Throat", "L_ShaftTop", "L_LanternHero", "L_RimCold", "L_Miner"})
            L_top.data.energy = 95000.0
            cy.samples = args.samples
            cy.use_denoising = True
        elif shot == "approach":
            sc.camera = cam_app
            look(True)
            vol.inputs["Density"].default_value = args.hero_fog
            bg.inputs["Color"].default_value = (0.0035, 0.0042, 0.0058, 1)
            show_lights({"L_Forge", "L_Throat", "L_ShaftTop", "L_PlayerLantern", "L_Miner", "L_RimCold"})
            L_top.data.energy = 70000.0
            cy.samples = args.samples
            cy.use_denoising = True
        elif shot == "full":
            sc.camera = cam_full
            look(True)
            vol.inputs["Density"].default_value = args.fog
            bg.inputs["Color"].default_value = (0.0035, 0.0042, 0.0058, 1)
            show_lights({"L_Forge", "L_Throat", "L_ShaftTop", "L_LanternFull", "L_FullFill", "L_Miner", "L_FullKey"})
            L_top.data.energy = 300000.0
            cy.samples = args.samples
            cy.use_denoising = True
        elif shot == "silhouette":
            sc.camera = cam_full
            look(False)
            vol.inputs["Density"].default_value = 0.0
            bg.inputs["Color"].default_value = (0.2140, 0.2140, 0.2140, 1)
            show_lights(set())
            for ob in env.objects:
                ob.hide_render = True
            sc.view_layers[0].material_override = silhouette_mat
            cy.samples = 12
            cy.use_denoising = False
        else:
            continue
        try:
            sc.render.use_compositing = comp_ok and shot != "silhouette"
        except Exception:
            pass
        if args.border:
            bx = [float(x) for x in args.border.split(",")]
            sc.render.use_border = True
            sc.render.use_crop_to_border = True
            sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = bx
        sc.render.filepath = os.path.join(OUT, shot + ".png")
        bpy.ops.render.render(write_still=True)
        log("rendered", shot, "in %.0fs" % (time.time() - t0))
    log("done")


if __name__ == "__main__":
    main()
