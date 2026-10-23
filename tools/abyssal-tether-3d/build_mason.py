"""THE MASON (ABYSSAL TETHER 3D): production builder. Procedural, deterministic (seed 1313), Blender 5.2 / bpy.

Design: "architecture that learned to hunt" (Ossuary Column, round 3): a 29.5 m predator of 27 split masonry vertebrae
with wet sinew; flying-buttress rib legs with wrong-way bone shanks and grapnel feet; a crown that is a broken
rose-window WHEEL standing behind a lancet PORTAL (three stepped archivolt orders of small wedge voussoirs sunk in
flesh) whose cracked ventral third has dropped open onto a deep, receding, many-ringed throat with one far glow;
seven deep listening pits (a few sealed by eardrums); teeth only on the portal's inner arris and in the throat.
No eyes, no antennae, no mandibles.

Modes
  render (design previews, Cycles; render mesh ~2M triangles):
      python build_mason.py --out DIR --shots hero,approach,full,silhouette --samples 48 --res 1280x720
      --lab head|crown builds only the head end (fast look-dev, far less RAM); --grain 0 drops the stone grain
      subdivision (use it for the far shots to stay under ~4 GB).
  production (rig-ready kit + assembled hero, baked atlases):
      python build_mason.py --out DIR --shots "" --export DIR
      -> DIR/mason_kit.glb, DIR/mason_hero.glb, DIR/textures/*.jpg, DIR/mason_kit.png, DIR/export_report.json
Always run under `flock /tmp/at3d-blender.lock`.
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
ap.add_argument("--shots", default="hero,approach,full,silhouette,below")
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--res", default="1280x720")
ap.add_argument("--seed", type=int, default=1313)
ap.add_argument("--fog", type=float, default=0.008, help="world volume density (full shot only)")
ap.add_argument("--hero-haze", type=float, default=0.55, help="mist-pass depth haze strength (hero/approach)")
ap.add_argument("--blend", action="store_true", help="also save ossuary.blend")
ap.add_argument("--export", default="", help="directory: also write the Quest LOD0/1/2 game meshes (glb)")
ap.add_argument("--threads", type=int, default=0)
ap.add_argument("--omit", default="", help="look-dev: comma list of crown features to skip (ropes,strands,arms,tongue,lips,wheel,membr)")
ap.add_argument("--nobake", action="store_true", help="export dry run: skip the bakes")
ap.add_argument("--grain", type=int, default=1, help="stone grain subdivision levels (0 saves a lot of RAM)")
ap.add_argument("--lab", default="", help="crown: build only the crown + 3 vertebrae (fast look-dev)")
ap.add_argument("--exposure", type=float, default=0.0)
ap.add_argument("--border", default="", help="xmin,xmax,ymin,ymax crop (0-1) for quick detail checks")
ap.add_argument("--fullcam", default="-1,-28,-2,-2,-4,14,20", help="x,y,z,tx,ty,tz,lens")
ap.add_argument("--herocam", default="6.0,-2.5,0.4,0.0,0.3,0.0,22", help="fwd,dz,side,tfwd,tdz,tside,lens")
ap.add_argument("--approachcam", default="3.5,-0.35,0.0,0.0,-1.0,0.0,0.0,18",
                help="fwd,dz,side,dors,tfwd,tdz,tside,lens (relative to the crown)")
ap.add_argument("--belowcam", default="2.0,-44.0,9.0,0.0,14.0,2.0,40",
                help="arc-x,z,height-off-wall of camera, then of target, lens (player's view from 50 m below)")
ap.add_argument("--hero-light", type=float, default=3500.0)
ap.add_argument("--gamecam", default="8.5,-1.6,0.0,24", help="game/profile shots: fwd,dorsal,side,lens (crown frame, kit metres)")
ap.add_argument("--lantern", type=float, default=900.0, help="the player's warm lantern (game / profile shots), watts")
ap.add_argument("--climber-at", type=float, default=0.8, help="climber position along full cam -> crown")
ap.add_argument("--climber-side", type=float, default=3.4)
ap.add_argument("--app-light", type=float, default=550.0)
ap.add_argument("--app-fstop", type=float, default=2.8)
ap.add_argument("--wall-res", type=float, default=1.0, help="shaft wall grid density (lower = less RAM)")
ap.add_argument("--detail-cam", type=lambda t: [float(x) for x in t.split(",")], default=[2.0, 3.4, -1.6, 220.0],
                help="side,dorsal,along offsets from the segment centre and lamp watts for detail.png")
args = ap.parse_args(argv)
OUT = args.out
os.makedirs(OUT, exist_ok=True)
RES = tuple(int(v) for v in args.res.lower().split("x"))
SHOTS = [s.strip() for s in args.shots.split(",") if s.strip()]

SEED = args.seed
OMIT = set(x.strip() for x in args.omit.split(',') if x.strip())
rng = random.Random(SEED)
UP = np.array([0.0, 0.0, 1.0])
DOWN = -UP
# LOW = True rebuilds the identical creature (same RNG stream) with game tessellation: capped tube sides, thinned
# loft rings, low-subdivision blobs, unsubdivided blocks, chains as plain strips. Used for the Quest LOD0 mesh.
LOW = False


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
        self.V, self.flat, self.sizes, self.uv, self.m, self.g, self.d, self.p = [], [], [], [], [], [], [], []
        self.e = []
        self.n = 0

    def add(self, V, faces, uv=None, m=None, g=None, d=None, e=None):
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
        self.d.append(np.zeros(len(V)) if d is None else np.broadcast_to(np.asarray(d, float), (len(V),)).copy())
        self.e.append(np.zeros(len(V)) if e is None else np.broadcast_to(np.asarray(e, float), (len(V),)).copy())
        self.p.append(np.full(len(V), float(PART_STACK[-1])))
        self.n += len(V)

    def add_bm(self, bm, m=0.0, free=True, g=None, d=None):
        V, F = bm_arrays(bm)
        self.add(V, F, m=m, g=g, d=d)
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

    def add_tube(self, P, r, m="along", g=None, d=None, **kw):
        V, F, uv, al = tube(P, r, **kw)
        mv = self._along(P, V, al, m)
        gv = None if g is None else self._along(P, V, al, g)
        dv = None if d is None else self._along(P, V, al, d)
        self.add(V, F, uv, mv, gv, dv)
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
        at = me.attributes.new("aux", "FLOAT", "POINT")
        at.data.foreach_set("value", np.concatenate(self.d).astype(np.float32))
        at = me.attributes.new("part", "FLOAT", "POINT")
        at.data.foreach_set("value", np.concatenate(self.p).astype(np.float32))
        at = me.attributes.new("grime", "FLOAT", "POINT")
        at.data.foreach_set("value", np.concatenate(self.e).astype(np.float32))
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
    if LOW:
        sides = min(sides, 10)
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
    T, N, B = fr if fr is not None else frames(P, up)
    if LOW and n > 6:
        L0 = arclen(P)
        step = max(L0[-1] / 5.0, min(0.12, L0[-1] / 3.0))
        keep = [0]
        for i in range(1, n - 1):
            if L0[i] - L0[keep[-1]] >= step:
                keep.append(i)
        keep.append(n - 1)
        keep = np.array(keep)
        P, prof, T, N, B = P[keep], prof[keep], T[keep], N[keep], B[keep]
        n = len(P)
    K = prof.shape[1]
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
    if LOW:
        sides = min(sides, 5 if np.max(r) < 0.04 else 7)
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
    if LOW:
        sub = min(sub, 1 if np.max(np.abs(axes)) < 0.25 else 2)
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
    if LOW:
        subdiv, wear = 0, 0
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
# -----------------------------------------------------------------------------
# Part tags: every vertex remembers which kit part built it (vertebra segment, head, pit, frond, upper / lower
# limb, hook) and each part keeps its pivot frame, so the game export can cut README-contract kit parts out of
# the baked LOD0 mesh. Tagging changes no geometry and consumes no RNG.
# -----------------------------------------------------------------------------
PARTS = [dict(name="", M=np.eye(4), parent=0)]
PART_STACK = [0]


class tag:
    def __init__(self, name, M=None):
        self.name, self.M = name, (np.eye(4) if M is None else np.asarray(M, float))

    def __enter__(self):
        PARTS.append(dict(name=self.name, M=self.M, parent=PART_STACK[-1]))
        PART_STACK.append(len(PARTS) - 1)
        return self

    def __exit__(self, *exc):
        PART_STACK.pop()
        return False


def retag(name, M):
    """Switch the innermost open tag to a new sibling part."""
    PARTS.append(dict(name=name, M=np.asarray(M, float), parent=PARTS[PART_STACK[-1]].get("parent", 0)))
    PART_STACK[-1] = len(PARTS) - 1


def frame_zx(origin, z, x_hint):
    """Right-handed pivot frame with +Z along z and +X as close to x_hint as possible."""
    z = nrm(z)
    x = nrm(x_hint - np.dot(x_hint, z) * z) if np.linalg.norm(x_hint - np.dot(x_hint, z) * z) > 1e-6 else perp(z)
    return mat4(x, np.cross(z, x), z, origin)


A = {k: Acc("Ossuary_" + k) for k in
     ("Stone", "Carved", "Flesh", "Tendon", "Marrow", "Bone", "Iron", "Teeth", "Ember", "Frond",
      "Mucus", "Vein", "Membrane", "Gum", "Pit", "Bronze", "Seam", "Glass", "Rope", "Oil", "IronTooth", "Soot",
      "Mask", "Eye", "Skin")}
ENV = {k: Acc("Shaft_" + k) for k in ("Rock", "Masonry", "Iron", "Glow", "Rubble", "Oil", "Crack", "Puddle", "Climber",
                                     "Rope")}


# =============================================================================
# The shaft wall (interior of a 30 m radius cylinder) and the spine path
# =============================================================================
R_SHAFT = 30.0


def ihash(*keys):
    """Deterministic integer hash of int arrays -> float in [0, 1)."""
    h = np.full(np.broadcast(*[np.asarray(k) for k in keys]).shape, (SEED * 2654435761) & 0x7FFFFFFF, np.int64)
    for i, k in enumerate(keys):
        k = np.asarray(k, np.int64)
        h = (h ^ ((k + 0x9E37 * (i + 1)) * 0x45D9F3B)) & 0xFFFFFFFF
        h = ((h ^ (h >> 16)) * 0x45D9F3B) & 0xFFFFFFFF
        h = h ^ (h >> 16)
    return (h & 0xFFFFFF) / float(0x1000000)


_COURSES = {}


def courses():
    """Lanternwright ashlar courses lining the shaft (the Underspire is a BUILT shaft): course boundaries in z
    and, per course, block boundaries along the arc. Computed once so wall_info stays vectorised."""
    if not _COURSES:
        _COURSES["z"] = np.cumsum(np.r_[-40.0, 0.82 + 0.62 * ihash(np.arange(140), 7)])
        _COURSES["b"] = [np.cumsum(np.r_[-62.0 - 2.5 * float(ihash(c, 3)), 1.25 + 2.1 * ihash(c, np.arange(90), 11)])
                         for c in range(len(_COURSES["z"]) - 1)]
    return _COURSES["z"], _COURSES["b"]


def wall_info(px, z):
    """Masonry wall: returns (displacement toward the shaft centre, per-block random, joint factor 0..1, broken)."""
    px = np.asarray(px, float).ravel()
    z = np.broadcast_to(np.asarray(z, float).ravel(), px.shape)
    q = np.stack([px, z, np.zeros_like(px)], -1)
    # slight warping of the courses (old masonry settles), so joints are not ruler-straight
    zw = z + 0.07 * NZ.fbm(q * 0.11 + 3.0, 2)
    pw = px + 0.1 * NZ.fbm(q * 0.09 + 8.0, 2)
    _CZ, _CB = courses()
    ci = np.clip(np.searchsorted(_CZ, zw) - 1, 0, len(_CZ) - 2)
    z0, z1 = _CZ[ci], _CZ[ci + 1]
    b0 = np.empty_like(px)
    b1 = np.empty_like(px)
    bi = np.empty(px.shape, np.int64)
    for c in np.unique(ci):
        sel = ci == c
        B = _CB[c]
        j = np.clip(np.searchsorted(B, pw[sel]) - 1, 0, len(B) - 2)
        b0[sel], b1[sel], bi[sel] = B[j], B[j + 1], j
    rnd = ihash(ci, bi, 1)
    rnd2 = ihash(ci, bi, 2)
    rnd3 = ihash(ci, bi, 3)
    e = np.minimum.reduce([pw - b0, b1 - pw, zw - z0, z1 - zw])
    u = (pw - b0) / (b1 - b0)
    v = (zw - z0) / (z1 - z0)
    # block face: own setback + tilt + low relief; eroded blocks get rougher faces
    ero = (rnd3 < 0.22).astype(float)
    face = (0.07 * (rnd - 0.5) + 0.035 * (rnd2 - 0.5) * (u - 0.5) * 2 + 0.03 * (rnd3 - 0.5) * (v - 0.5) * 2
            + (0.022 + 0.035 * ero) * NZ.fbm(q * 1.7 + rnd[:, None] * 40.0, 3)
            + 0.009 * NZ.fbm(q * 6.0, 2))
    # chipped, irregular arrises: a hard, narrow chamfer (not a pillow) whose width jumps along the edge
    bev = (0.03 + 0.055 * np.clip(0.5 + NZ.fbm(q * 2.3 + 5.0, 2), 0, 1)
           + 0.05 * np.clip(NZ.fbm(q * 7.0 + 2.0, 2) * 3.0, 0, 1) + 0.04 * ero)
    arris = np.clip(1.0 - e / bev, 0.0, 1.0)
    d = face - 0.075 * arris
    # eroded mortar joints
    joint = 1.0 - smoothstep(0.012, 0.05, e)
    d = d - 0.05 * joint
    # broken-out blocks: deep ragged sockets showing the rubble core behind the ashlar
    broken = ((rnd2 < 0.075) & (z > -6)).astype(float)
    core = -0.3 + 0.12 * NZ.fbm(q * 1.3 + 2.0, 3) + 0.05 * NZ.fbm(q * 4.0, 2)
    rim = smoothstep(0.0, 0.22, e)
    d = d * (1 - broken * rim) + core * broken * rim
    # large-scale settling of the shaft lining
    d = d + 0.22 * NZ.fbm(q * 0.035 + 1.0, 2) + 0.05 * NZ.fbm(q * 0.12 + 4.0, 2)
    g = np.maximum(joint, 0.6 * arris * (1 - broken))
    return d, rnd, g, broken


def wall_disp(px, z):
    return wall_info(px, z)[0]


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
# Round 2: the front third REARS off the wall (head ~7 m out) and curls toward the shaft so the crown faces a
# climber hanging below; the rest of the body is a heavy S-curve pressed to the masonry.
SPINE_CTRL = np.array([
    (4.7, 5.9, 7.3),
    (4.3, 6.75, 6.35),
    (3.75, 7.8, 5.25),
    (3.05, 9.15, 4.1),
    (2.15, 10.75, 3.05),
    (1.05, 12.55, 2.3),
    (-0.25, 14.55, 1.95),
    (-1.45, 16.75, 1.85),
    (-2.1, 19.15, 1.8),
    (-3.1, 21.45, 1.75),
    (-5.05, 23.45, 1.65),
    (-7.45, 24.9, 1.55),
    (-10.05, 25.85, 1.45),
    (-12.6, 26.5, 1.4),
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
    """Segment scale along the body: a heavy neck right behind the crown (the head is the biggest end),
    full girth through the thorax, tapering to the tail."""
    if s < 4.0:
        return 0.86 + 0.14 * float(smoothstep(0.8, 4.0, s))
    if s < 12.0:
        return 1.0
    return 1.0 - 0.55 * ((s - 12.0) / (L_TOTAL - 12.0)) ** 1.15


SEG_W, SEG_H, SEG_L, SEG_STEP = 2.6, 1.9, 1.08, 1.24


def vertebra_positions():
    out, s = [], 1.95
    while s < L_TOTAL - 0.8:
        out.append(s)
        s += SEG_STEP * kprof(s + 0.6)
    return out


VERT_S = vertebra_positions()
# tall, irregular skyline set-pieces along the dorsal line (cathedral vocabulary breaks the bug read)
SKYLINE_AT = {"belfry": 7.6, "spire": 15.3, "ibeam": 17.8, "cluster": 20.2, "fin": 23.0, "pipe": 26.8}
SKYLINE = {name: int(np.argmin([abs(v - t) for v in VERT_S])) for name, t in SKYLINE_AT.items()}
SKYLINE_IDX = set(SKYLINE.values())

RING_S = 0.55          # crown ring centre along the spine
RING_RI, RING_RO, RING_DEPTH = 1.3, 2.15, 1.05
_o, _t, _d, _s = spine_frame(RING_S)
CROWN_PRE = dict(C=_o, T=_t, D=_d, S=_s)
CROWN_SPL = 0.9         # the window's three archivolt orders step back this far in all (a stepped funnel)
GULLET_L = 5.6
THROAT_RINGS = [0.3, 0.7, 1.1, 1.55, 2.0, 2.5, 3.0, 3.55, 4.1, 4.7]   # depths of the eight rings of throat fangs
GULLET_S0 = RING_S + 0.45


def gullet_frame(dz):
    """Frame along the gullet: it runs nearly straight back from the mouth so the glow at its bottom stays in
    view; the first vertebrae are bored through to let it pass."""
    O_, T_, D_, S_ = spine_frame(GULLET_S0 + dz)
    Os_ = CROWN_PRE["C"] - CROWN_PRE["T"] * (GULLET_S0 - RING_S + dz)
    return O_ * 0.45 + Os_ * 0.55, T_, D_, S_


_GCUT = []


def gullet_cutter():
    if not _GCUT:
        P = np.array([gullet_frame(dz)[0] for dz in np.linspace(-1.0, GULLET_L + 0.4, 30)])
        V, F, uv, al = tube(P, 0.9, sides=20)
        _GCUT.append((V, F))
    return _GCUT[0]


def add_cut(acc, V, F, **kw):
    """Add closed geometry, bored through by the gullet when it lies on the gullet's path."""
    V = np.asarray(V, float)
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in V]
    for f in faces_list(F):
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    bm = bool_cut(bm, [gullet_cutter()], "gul")
    acc.add_bm(bm, **kw)


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


def marrow_slab(M, p, n, g, dims, k, bulge=1.06, bore=False):
    n = nrm(n)
    u = perp(n)
    w = np.cross(n, u)
    su = box_support(dims, u) * bulge
    sw = box_support(dims, w) * bulge
    axes = basis_axes(u, w, n, su, sw, g / 2 + 0.05 * k)
    V, F = blob(p, axes, sub=3, amp=0.12, freq=2.2 / k, seed=rng.random() * 50)
    gl_ = 0.0 if rng.random() < 0.6 or True else 0.0
    if bore:
        add_cut(A["Marrow"], xf(V, M), F, g=gl_)
    else:
        A["Marrow"].add(xf(V, M), F, g=gl_)
    # a second, smaller wet tissue layer bulging out of the crack mouth
    V, F = blob(p, basis_axes(u, w, n, su * 1.02, sw * 1.02, g * 0.32), sub=3, amp=0.18,
                freq=3.0 / k, seed=rng.random() * 50)
    if bore:
        add_cut(A["Flesh"], xf(V, M), F, m=0.0)
    else:
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
        A["Vein"].add_tube(xf(P, M), r, sides=5, g=0.0 * float(rng.random() < 0.45))


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


def glyphs(M, c, k, n=None):
    """Soot-filled Lanternwright glyphs cut shallowly into a block face (lateral face at local x = c[0])."""
    for gi in range(n or rng.randint(2, 4)):
        o = c + np.array([0.0, (gi - 1) * 0.2 * k, rng.uniform(-0.03, 0.03) * k])
        h = rng.uniform(0.13, 0.21) * k
        strokes = [[o + np.array([0, 0, -h / 2]), o + np.array([0, 0, h / 2])]]
        for _ in range(rng.randint(1, 3)):
            z = rng.uniform(-0.4, 0.4) * h
            sg = rng.choice((-1, 1))
            strokes.append([o + np.array([0, 0, z]), o + np.array([0, sg * 0.07 * k, z + rng.uniform(-0.06, 0.06) * k])])
        if rng.random() < 0.5:
            th = np.linspace(0, 2 * math.pi, 12)
            strokes.append(list(o + np.stack([np.zeros(12), np.cos(th) * 0.035 * k, h / 2 + 0.045 * k + np.sin(th) * 0.035 * k], -1)))
        for st_ in strokes:
            A["Soot"].add_tube(xf(resample(np.array(st_), 5), M), 0.008 * k, sides=4)


def build_flank_bell(v, sgn=1.0):
    """A cracked Lanternwright church bell half swallowed into the flank, chains pierced through the flesh."""
    O, T, D, S = spine_frame(v["s"])
    side = S * sgn
    axis = nrm(-side * 0.85 + D * 0.15 + UP * 0.35)
    c = O + side * (v["W"] * 0.5) - D * 0.15
    top = c + axis * 0.55
    build_bell_at(top, 1.35, 0.72, axis=axis)
    e1 = perp(axis)
    e2 = np.cross(axis, e1)
    mouth_c = top - axis * 1.35 * 1.1
    waist = top - axis * 0.75
    th = np.linspace(0, 2 * math.pi, 40)
    lip = waist + 0.62 * (np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2)
    A["Flesh"].add_tube(lip, 0.16 * (1 + 0.4 * np.sin(th * 3)), sides=10, cap0=False, cap1=False, nz_amp=0.2,
                        nz_freq=4.0, m=0.4)
    for j in range(3):
        a = 2 * math.pi * j / 3 + 0.4
        p_in = waist + 0.6 * (math.cos(a) * e1 + math.sin(a) * e2)
        pierce(p_in, nrm(math.cos(a) * e1 + math.sin(a) * e2) + DOWN * 0.8, rng.uniform(1.2, 2.6), hook=j == 1)
    CROWN["bell"] = mouth_c


def _build_vertebra(idx, s, k):
    O, T, D, S = spine_frame(s)
    M = mat4(S, T, D, O)
    W, H, Lb = SEG_W * k, SEG_H * k, SEG_L * k
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
        if s < GULLET_S0 + GULLET_L + 0.8:
            pc = bool_cut(pc, [gullet_cutter()], "gul")
        A["Stone"].add_bm(pc)
    for (p, n, g) in cracks:
        marrow_slab(M, p, n, g + 0.06 * k, dims, k, bore=s < GULLET_S0 + GULLET_L + 0.8)
        crack_tendons(M, p, n, g + 0.06 * k, dims, rng.randint(4, 8), k)
        if rng.random() < 0.8:
            rng.uniform(0.6, 1.0)      # (round 3: no glowing seams; ember only in the throat and a few pits)
        # ember glints deep in some fractures
        if rng.random() < 0.55:
            q = p + perp(n) * box_support(dims, perp(n)) * 0.7
            V, F = blob(q, basis_axes(perp(n), np.cross(n, perp(n)), n, 0.09 * k, 0.05 * k, 0.03 * k), sub=2, amp=0.2)
            A["Marrow"].add(xf(V, M), F, g=0.0)
    # neural spine: short raked stubs, often snapped; the tall skyline set-pieces are built separately
    # rhythmic dorsal row of raked pinnacles, growing taller and sharper toward the crown (the head is the
    # biggest, sharpest end, so the silhouette has a direction)
    hmul = 0.5 + 0.5 * max(0.0, 1.0 - s / (0.75 * L_TOTAL)) ** 1.25
    base = np.array([rng.uniform(-0.06, 0.06) * W, rng.uniform(-0.08, 0.08) * Lb, H / 2 - 0.12 * k])
    dirr = nrm(np.array([rng.uniform(-0.12, 0.12), -0.7 - rng.uniform(0, 0.3), 1.0]))
    if idx not in SKYLINE_IDX and rng.random() < 0.72:
        pinnacle(M, base, dirr, rng.uniform(1.0, 1.5) * k * hmul, 0.27 * k * (0.8 + 0.3 * hmul), k,
                 broken=rng.random() < 0.4)
    # secondary lateral thorns on the dorsal shoulders (sparse)
    for sx in (-1, 1):
        if rng.random() < 0.3:
            root = np.array([sx * W * 0.36, rng.uniform(-0.2, 0.2) * Lb, H / 2 - 0.05])
            V, F, uv, al = shard(root, nrm(np.array([sx * 0.6, -0.5, 1.0])), rng.uniform(0.35, 0.75) * k * hmul,
                                 0.12 * k, hook_dir=np.array([0, -1.0, 0]), hook=0.3, rings=8)
            A["Carved"].add(xf(V, M), F, uv)
    # carved lancet windows on the flanks of the big blocks (cathedral read at mid range)
    if k > 0.72 and rng.random() < 0.45:
        for sx in (-1, 1):
            if rng.random() < 0.7:
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
    if rng.random() < 0.35:
        glyphs(M, np.array([rng.choice((-1, 1)) * (W / 2 + 0.004), 0.0, rng.uniform(-0.1, 0.15) * H]), k)
    vertebra_horror(idx, M, dims, cracks, k)
    VERTS.append(dict(idx=idx, s=s, k=k, W=W, H=H, Lb=Lb, M=M))


def vertebra_horror(idx, M, dims, cracks, k):
    """v2: what the body has taken in. Pale ribs (its own, or what it kept) curve down round both flanks under the leg roots; crude iron
    staples are driven across the fractures; on every third block a skeleton hand claws out of the crack, as if someone were still
    trying to climb out. Vertebra-local frame: x lateral, y head-ward, z dorsal."""
    W, Lb, H = dims
    hr = random.Random(SEED * 31 + idx * 7)           # own stream: the rest of the body keeps its dice
    for sx in (-1, 1):
        for q in range(2):
            y0 = (q - 0.5) * 0.42 * Lb + hr.uniform(-0.06, 0.06)
            P = np.array([[sx * 0.44 * W, y0, 0.05 * H], [sx * 0.66 * W, y0 - 0.04, -0.22 * H], [sx * 0.66 * W, y0 - 0.08, -0.52 * H],
                          [sx * 0.46 * W, y0 - 0.1, -0.74 * H]])
            P = P * np.array([1.0 + hr.uniform(-0.05, 0.08), 1.0, 1.0])
            P = catmull(P, 4 if LOW else 10)
            t = np.linspace(0, 1, len(P))
            snap = hr.random() < 0.25
            if snap:                                    # a snapped rib, the end splintered
                n_ = max(3, int(len(P) * hr.uniform(0.5, 0.75)))
                P, t = P[:n_], t[:n_]
            r = (0.055 - 0.02 * t + 0.03 * np.exp(-(t / 0.1) ** 2)) * k
            V, F, uv, al = tube(xf(P, M), r, sides=6 if LOW else 10, nz_amp=0.08, nz_freq=6.0, seed=hr.random() * 9)
            A["Bone"].add(V, F, uv, m=0.45)
    for (p, n, g) in cracks[:1]:
        n = nrm(n)
        u_ = perp(n)
        for q in range(2 if LOW else 3):
            d_ = rot(n, hr.uniform(0, 2 * math.pi)) @ u_
            c_ = p + d_ * box_support(dims, d_) * hr.uniform(0.75, 0.9)
            a_ = c_ - n * (g / 2 + 0.12 * k)
            b_ = c_ + n * (g / 2 + 0.12 * k)
            out_ = nrm(d_)
            st_ = np.array([a_ - out_ * 0.1 * k, a_ + out_ * 0.05 * k, b_ + out_ * 0.05 * k, b_ - out_ * 0.1 * k])
            A["Iron"].add_tube(xf(resample(st_, 4 if LOW else 10), M), 0.028 * k, sides=4 if LOW else 7, m=0.0)
    if idx % 3 == 1 and cracks:
        p, n, g = cracks[0]
        n = nrm(n)
        up_ = np.array([0.0, 0.0, 1.0])
        d_ = nrm(up_ - up_.dot(n) * n) if abs(n[2]) < 0.9 else perp(n)
        wrist = p + d_ * box_support(dims, d_) * 0.55
        reach = nrm(d_ * 1.0 + n * 0.15 + np.array([0.3, 0.0, 0.0]))
        back = nrm(np.cross(reach, n))
        tips = statue_hand(xf(wrist[None], M)[0], xd(reach, M), xd(back, M), 0.42 * k, [0.85, 0.9, 0.95, 1.0], 0.5, hr, A["Bone"],
                           tip="m", m0=0.5, rf=0.9, skeletal=True)


def _build_disc(va, vb):
    """Wet intervertebral sinew between two blocks: lumpy flesh collar + tendon cords + veins."""
    s0 = va["s"] + va["Lb"] / 2 - 0.16 * va["k"]
    s1 = vb["s"] - vb["Lb"] / 2 + 0.16 * vb["k"]
    if s1 <= s0:
        return
    ss = np.linspace(s0, s1, 14)
    O, T, D, S = spine_frames(ss)
    t = np.linspace(0, 1, len(ss))
    kk = va["k"] + (vb["k"] - va["k"]) * t
    bul = 1 + 0.12 * np.sin(math.pi * t)
    rx = 0.47 * SEG_W * kk * bul
    rz = 0.47 * SEG_H * kk * bul
    th = np.linspace(0, 2 * math.pi, 22, endpoint=False)
    # rounded-rect profile, in (S, D)
    cx = np.sign(np.cos(th)) * np.abs(np.cos(th)) ** 0.6
    cz = np.sign(np.sin(th)) * np.abs(np.sin(th)) ** 0.6
    prof = np.stack([cx[None] * rx[:, None], cz[None] * rz[:, None]], -1)
    Bv = np.cross(T, S)
    V, F, uv, al = loft(O, prof, fr=(T, S, Bv), cap0=False, cap1=False, nz_amp=0.1, nz_freq=2.4,
                        nz_seed=rng.random() * 40)
    A["Flesh"].add(V, F, uv, m=0.05, g=0.12)
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
        P = O2 + S2 * (ex * rr_ * SEG_W * k2 * b)[:, None] + D2 * (ez * rr_ * SEG_H * k2 * b)[:, None]
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
        A["Vein"].add_tube(P, 0.014 * kk, sides=5, g=0.0 * float(rng.random() < 0.55))


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
        A["Soot"].add(xf(V, M), F)
    cp = xf((base + up * (hc - 0.05 * k))[None], M)[0]
    chain(np.array([cp, cp + DOWN * 1.3 * k]), 0.8)
    meat_hook(cp + DOWN * 1.32 * k, 1.4)
    for _ in range(5):  # tendons hauling the turret down onto the vertebra
        ang = rng.uniform(0, 2 * math.pi)
        a = P(Rb * 0.95, ang, rng.uniform(0.2, 0.5) * k)
        b = np.array([math.cos(ang) * 0.9, rng.uniform(-0.4, 0.4), H / 2 - 0.1 * k]) * np.array([v["W"] / 2, v["Lb"], 1.0])
        A["Tendon"].add_tube(xf(sag_path(a, b, 0.05, 10), M), 0.035 * k, sides=6, cap0=False, cap1=False)


def build_great_spire(v):
    """A steeple snapped off two-thirds up, toppling sideways out of the body line; soot-black, flesh and
    tendons crawling up its base, a chain swinging from the break."""
    k, H, M = v["k"], v["H"], v["M"]
    up = nrm(np.array([-0.85, -0.35, 1.0]))
    a1, a2 = octa_frame(up)
    base = np.array([0.0, 0.0, H / 2 - 0.15 * k])
    stone_at((1.0 * k, 1.0 * k, 0.8 * k), a1, a2, up, base + up * 0.35 * k, 0.12, 0.02 * k, 3, M=M)
    for sx in (-1, 1):
        for sy in (-1, 1):
            if rng.random() < 0.7:
                c = base + (a1 * sx + a2 * sy) * 0.45 * k + up * 0.75 * k
                pinnacle(M, c, nrm(up + (a1 * sx + a2 * sy) * 0.15), rng.uniform(0.7, 1.2) * k, 0.12 * k, k,
                         broken=rng.random() < 0.5)
    top = spire_loft(M, base + up * 0.75 * k, up, 0.48 * k, 4.4 * k, frac=0.6, k=k, rebars=4)
    tw = xf(top[None], M)[0]
    stone_at((0.2 * k, 0.42 * k, 0.16 * k), xd(a1, M), xd(nrm(a2 - up * 0.6), M), xd(up, M),
             tw + xd(a2, M) * 0.3 * k + DOWN * 0.3 * k, 0.2, 0.01, 2)
    ch0 = xf((base + up * 2.4 * k + a2 * 0.25 * k)[None], M)[0]
    chain(hanging_chain_path(ch0, xd(a2, M) + DOWN, 2.6, 0.3), 1.0)
    V, F = blob(base + up * 0.1 * k, basis_axes(a1, a2, up, 0.85 * k, 0.85 * k, 0.4 * k), sub=3, amp=0.25, freq=2.5)
    A["Flesh"].add(xf(V, M), F, m=0.1)
    # flesh sheath and tendons climbing the shaft of the spire
    P = base[None] + up[None] * np.linspace(0.3, 1.9, 12)[:, None] * k
    A["Flesh"].add_tube(xf(P, M), np.linspace(0.62, 0.36, 12) * k, sides=12, nz_amp=0.2, nz_freq=2.0,
                        seed=rng.random() * 9, m=0.1)
    for j in range(5):
        a = 2 * math.pi * j / 5 + rng.uniform(-0.3, 0.3)
        hh = np.linspace(0.2, rng.uniform(1.8, 2.8), 26) * k
        rr_ = 0.47 * k * (1 - hh / (4.4 * k)) + 0.03
        P = base[None] + up[None] * hh[:, None] + (np.cos(a + hh * 1.3)[:, None] * a1 + np.sin(a + hh * 1.3)[:, None] * a2) * rr_[:, None]
        A["Tendon"].add_tube(xf(P, M), np.linspace(0.04, 0.012, 26) * k, sides=6, cap0=False)


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
    """A rusted, heat-blued I-beam driven through the back, its far end torn and bent."""
    k, H, M = v["k"], v["H"], v["M"]
    O, T, D, S = spine_frame(v["s"])
    st = O + D * (H / 2 - 0.45 * k) + S * 0.35 * k
    d1 = nrm(D * 1.0 - T * 0.65 + S * 0.35)
    d2 = nrm(d1 + S * 0.9 - T * 0.3 + DOWN * 0.4)
    P = np.vstack([st + d1 * np.linspace(0, 1.7, 12)[:, None] * k,
                   st + d1 * 1.7 * k + bezier([np.zeros(3), d1 * 0.4 * k, d1 * 0.5 * k + d2 * 0.7 * k], 10)[1:]])
    al = arclen(P) / arclen(P)[-1]
    for i, (V, F, uv, a) in enumerate(ibeam_parts(P, 0.28 * k, 0.34 * k, 0.035 * k, 0.03 * k, S)):
        if i > 0:
            # flanges: dented, peeled outward near the torn end
            fl = np.clip((a - 0.6) / 0.4, 0, 1)
            V = V + (NZ.vec(V * 4.0) * 0.03 * k) * (0.3 + fl[:, None]) + d2[None] * (fl ** 2 * 0.12 * k)[:, None] * (1 if i == 1 else -1)
        A["Iron"].add(V, F, uv, m=0.0, g=np.clip((a - 0.78) / 0.22, 0, 1) * 0.8)
    V, F = blob(st + d1 * 0.15, basis_axes(S, T, D, 0.6 * k, 0.55 * k, 0.4 * k), sub=3, amp=0.3)
    A["Flesh"].add(V, F, m=0.5, g=0.0)
    for j in range(7):
        q = st + d1 * (0.35 + 0.15 * j) * k
        A["Iron"].add_tube(np.array([q - S * 0.18 * k, q + S * 0.18 * k]), 0.02 * k, sides=6, m=0.0)
    for _ in range(3):
        a = st + S * rng.uniform(-0.4, 0.4) * k
        b = st + d1 * rng.uniform(0.6, 1.2) * k + S * rng.uniform(-0.12, 0.12) * k
        A["Tendon"].add_tube(sag_path(a, b, 0.05, 10), 0.03 * k, sides=6, cap0=False, cap1=False)


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


def _grapnel(Aj, F, nout, side_vec, Dv, k, planted=True):
    """v2: the foot is a long skeleton HAND: an iron manacle at the wrist (the end of the metatarsus), the metacarpals and the too-long
    fingers hooked into the masonry (planted), or curled into a claw (lifted). Rubble, grit and oil-blood where it bites."""
    ax = np.asarray(F, float) - Aj
    Lh = float(np.linalg.norm(ax))
    ax = ax / max(Lh, 1e-6)
    b0 = nout - nout.dot(ax) * ax
    back = nrm(b0) if np.linalg.norm(b0) > 0.2 else nrm(np.cross(ax, side_vec))
    size = Lh / 0.95
    curl = [0.55, 0.62, 0.66, 0.7] if planted else [1.0, 1.05, 1.1, 1.1]
    tips = statue_hand(np.asarray(Aj, float), ax, back, size, curl, 0.55, rng, A["Bone"], tip="m", m0=0.5, rf=0.82, skeletal=True)
    iron_hoop(Aj - ax * 0.04 * size, ax, 0.1 * size, k, w=0.06, rivets=6, heat=0.0)
    if planted:
        bite = F + nout * 0.02
        rubble(bite, nout, k)
        oil_trail(bite - UP * 0.05, nout, rng.uniform(0.6, 1.8) * k, 0.05 * k)
    return np.array(tips)


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


def wall_cracks(p, nout, k=1.0, n=None):
    """Fresh fractures radiating from where a grapnel bit into the ashlar (thin wet-black lines on the wall)."""
    px0, z0, phi = wall_coords(p)
    for _ in range(n or rng.randint(4, 7)):
        a = rng.uniform(0, 2 * math.pi)
        x, z = px0, z0
        pts = []
        L = rng.uniform(0.35, 1.3) * k
        stp = 0.05
        for i in range(int(L / stp)):
            a += rng.uniform(-0.45, 0.45)
            x += math.cos(a) * stp
            z += math.sin(a) * stp
            pts.append((x, z))
        if len(pts) < 4:
            continue
        P = np.array(pts)
        W3 = wall_point(P[:, 0], P[:, 1], 0.004, disp=True)
        r = np.linspace(0.014, 0.003, len(W3)) * k
        ENV["Crack"].add_tube(W3, r, sides=4, cap0=False)


def grit(p, nout, k=1.0, n=24, fall=1.6, spread=0.35):
    """Dust and grit knocked off the wall: a puff of chips hanging off the surface and a thin stream falling."""
    t1 = perp(nout)
    t2 = np.cross(nout, t1)
    for i in range(n):
        if i < n // 2:
            c = p + nout * rng.uniform(0.02, 0.35) + (t1 * rng.uniform(-1, 1) + t2 * rng.uniform(-1, 1)) * spread * k
        else:
            c = p + nout * rng.uniform(0.05, 0.4) + DOWN * rng.uniform(0.1, fall) + t1 * rng.uniform(-0.15, 0.15)
        sz = rng.uniform(0.008, 0.03) * k
        V, F = blob(c, basis_axes(t1, t2, nout, sz, sz * rng.uniform(0.6, 1.2), sz * rng.uniform(0.5, 1.0)), sub=0,
                    amp=0.3, freq=40.0, seed=rng.random() * 9)
        ENV["Rubble"].add(V, F)


def leg_shank(P0, P1, side_vec, r0, r1, acc, barbs=0, k=1.0, bow=0.12, m0=0.0, m1=1.0, sides=9):
    shank = bezier([P0, (P0 + P1) / 2 + side_vec * bow * k, P1], 30)
    t = np.linspace(0, 1, len(shank))
    knuck = sum(0.018 * k * np.exp(-((t - c_) / 0.035) ** 2) for c_ in (0.04, 0.37, 0.71))
    r = r0 + (r1 - r0) * t + knuck + 0.004 * np.sin(t * 23)
    acc.add_tube(shank, r, sides=sides, nz_amp=0.04, nz_freq=5.0, seed=rng.random() * 30, m=m0 + (m1 - m0) * t)
    for _ in range(barbs):
        i = rng.randint(3, len(shank) - 4)
        tg = nrm(shank[i + 1] - shank[i - 1])
        pdir = rot(tg, rng.uniform(0, 2 * math.pi)) @ perp(tg)
        V, F, uv, al = shard(shank[i] + pdir * r[i] * 0.8, nrm(pdir - tg * 0.8), rng.uniform(0.12, 0.26) * k,
                             0.035 * k, hook_dir=-tg, hook=0.35, sides=4, rings=5)
        A["Carved"].add(V, F, uv, 0.0)
    return shank, r


def _build_leg(v, sigma, kind="normal", size=1.0, droot=0.0, lantern=False):
    """Harvestman-tall cathedral leg, 2-3x the body width: a flying-buttress strut of voussoirs springs from the
    flank to a free-standing knee pier (pinnacle on top) standing 2.5-4 m ABOVE the dorsal line; from its foot a
    long, far-too-thin barbed bone shank and an iron metatarsus, bent the wrong way at the ankle, run down to a
    grapnel driven into the masonry (cracks, rubble, grit). Lifted legs hang mid-step."""
    s, k, W, H = v["s"], v["k"], v["W"], v["H"]
    O, T, D, S = spine_frame(s + droot)
    side = S * sigma
    kk = k ** 0.6 * size ** 0.85
    reach = kind == "reach"
    stub = kind == "missing"
    R0 = O + side * (0.4 * W) + D * (0.08 * H)
    lat_k = 0.5 * W + rng.uniform(0.9, 1.5) * kk
    up_k = 0.5 * H + rng.uniform(2.2, 3.4) * kk
    fwd = ((0.9 - 1.8 * s / L_TOTAL) + rng.uniform(-0.45, 0.45)) * k * size
    if reach:
        lat_k, up_k, fwd = 0.5 * W + 1.6, 0.5 * H + 3.0, -0.3
    upa = nrm(D + side * 0.22)
    K = O + side * lat_k + D * up_k + T * fwd
    ph = (1.15 + 0.25 * size) * k ** 0.7
    pw = 0.5 * k ** 0.7 * size ** 0.3
    Kt = K + upa * ph * 0.35          # where the strut lands on the pier
    Kb = K - upa * ph * 0.65          # pier foot (knee joint)
    # ---- femur: flying buttress, a single quarter-arch of voussoirs (no closed loops)
    c1 = R0 + D * (up_k * 0.82) + side * (lat_k * 0.12) + T * fwd * 0.3
    c2 = Kt + upa * 0.45 * kk - side * (lat_k * 0.3)
    arc = bezier([R0, c1, c2, Kt], 60)
    La = arclen(arc)
    endL = La[-1] * (rng.uniform(0.3, 0.5) if stub else 1.0)
    seg = 0.4 * k ** 0.5
    nseg = max(3, int(endL / seg))
    pn = nrm(np.cross(nrm(Kt - R0), side))
    if pn.dot(T) < 0:
        pn = -pn
    for i in range(nseg):
        a0, a1 = endL * i / nseg, endL * (i + 1) / nseg - 0.03 * k
        am = (a0 + a1) / 2
        j = int(np.clip(np.searchsorted(La, am), 1, len(arc) - 2))
        ty = nrm(arc[j + 1] - arc[j - 1])
        zz = nrm(np.cross(pn, ty))
        if zz.dot(D + side * 0.3) < 0:
            zz = -zz
        xx = np.cross(ty, zz)
        f = am / La[-1]
        a_w = (0.36 - 0.12 * f) * k ** 0.8 * (0.85 + 0.15 * size)
        b_t = (0.46 - 0.14 * f) * k ** 0.8 * (0.85 + 0.15 * size)
        stone_at((a_w, a1 - a0, b_t), xx, ty, zz, arc[j], 0.16, 0.015 * k, rng.randint(1, 3))
    jcut = int(np.searchsorted(La, endL)) + 1
    A["Flesh"].add_tube(arc[:jcut] - D * 0.0, np.linspace(0.16, 0.09, jcut) * k ** 0.8, sides=8, nz_amp=0.18,
                        nz_freq=3.0, seed=rng.random() * 30, m=0.2)
    for off in (-0.1, 0.1):  # tendons along the back of the strut
        A["Tendon"].add_tube(arc[:jcut] + pn * off * k - nrm(np.gradient(arc[:jcut], axis=0)) * 0.0 + D * 0.0
                             - np.cross(pn, nrm(np.gradient(arc[:jcut], axis=0))) * 0.17 * k,
                             0.028 * k, sides=6, cap0=False, cap1=False)
    if stub:
        tipp = arc[jcut - 1]
        V, F = blob(tipp, basis_axes(side, T, D, 0.25 * k, 0.22 * k, 0.25 * k), sub=3, amp=0.3, freq=3.5)
        A["Flesh"].add(V, F, m=0.9, g=0.0)
        for _ in range(4):
            hang_strand(tipp - D * 0.1, rng.uniform(0.8, 2.4), 0.024 * k, A["Tendon"])
        hang_strand(tipp, rng.uniform(0.5, 1.4), 0.016 * k, A["Oil"])
        return
    # bowstring tendons under the arch (flank -> pier foot), taut, thin: an open triangle, not a loop
    for off in (-0.12, 0.12):
        a = R0 - D * 0.35 * H + pn * off * k
        b = Kb + upa * 0.2 + pn * off * k
        A["Tendon"].add_tube(sag_path(a, b, 0.08 * k, 18), 0.035 * k * (1 + 0.3 * np.sin(np.linspace(0, math.pi, 18))),
                             sides=7, cap0=False, cap1=False)
    # ---- knee pier: free-standing, capped by a pinnacle; iron hoop, spur
    pX = nrm(np.cross(upa, side))
    pY = np.cross(upa, pX)
    stone_at((pw, pw, ph), pX, pY, upa, K, 0.16, 0.02 * k, rng.randint(2, 4), subdiv=1)
    iron_hoop(K - upa * ph * 0.28, upa, pw * 0.76, k, w=0.07, rivets=10, heat=0.0)
    ptop = K + upa * ph / 2
    stone_at((pw * 1.18, pw * 1.18, 0.15 * k), pX, pY, upa, ptop + upa * 0.06 * k, 0.3, 0.01, 1)
    Mk = mat4(pX, pY, upa, ptop)
    pinnacle(Mk, np.array([0, 0, 0.1 * k]), np.array([0, -0.12, 1.0]), rng.uniform(1.0, 1.9) * k * (0.75 + 0.25 * size),
             0.17 * k, k, broken=rng.random() < 0.3)
    spd = nrm(-T * 0.6 + side * 0.7 + upa * 0.15)
    V, F, uv, al = shard(K + side * pw * 0.4, spd, rng.uniform(0.8, 1.4) * k * size ** 0.5, 0.13 * k,
                         hook_dir=-upa, hook=0.25, sides=5, rings=9)
    A["Carved"].add(V, F, uv)
    # ---- lower leg: wrong-way ankle; barbed bone tibia, thin iron metatarsus, grapnel
    retag("LegL", np.eye(4))
    if reach:
        Cc, Tc, Dc = CROWN_PRE["C"], CROWN_PRE["T"], CROWN_PRE["D"]
        # round 3: the grapnels hang right beside the window, reaching at the viewer - they frame the maw
        F_ = Cc + Tc * (1.0 + 0.2 * size) + side * 3.4 + Dc * (0.9 if sigma > 0 else -0.3)
        nout = -Tc
        planted = False
    else:
        Ft = O + side * (lat_k + rng.uniform(0.8, 1.8) * kk) + T * (fwd + rng.uniform(-0.4, 0.4) * k)
        F_, nout = project_wall(Ft)
        planted = kind != "lifted"
        if not planted:
            F_ = F_ + nout * rng.uniform(1.0, 1.9) + T * rng.uniform(0.3, 0.8)
    J = Kb + (F_ - Kb) * 0.42 + side * 1.25 * kk + upa * 0.95 * kk
    if reach:
        J = Kb + (F_ - Kb) * 0.5 + side * 0.9 + CROWN_PRE["T"] * -0.4 + upa * 0.4
    Aj = F_ + (J - F_) * (0.2 if not reach else 0.26)
    sheave(Kb + side * pw * 0.2, pn, 0.2 * k, k)
    if kind == "broken":
        cut = rng.uniform(0.5, 0.8)
        J2 = Kb + (J - Kb) * cut
        shank, r = leg_shank(Kb, J2, side, 0.09 * k, 0.065 * k, A["Bone"], barbs=rng.randint(2, 4), k=k)
        end = shank[-1]
        tg = nrm(shank[-1] - shank[-3])
        for _ in range(rng.randint(4, 6)):
            pdir = rot(tg, rng.uniform(0, 2 * math.pi)) @ perp(tg)
            V, F, uv, al = shard(end + pdir * 0.04 * k, nrm(tg + pdir * 0.35), rng.uniform(0.12, 0.3) * k, 0.035 * k,
                                 hook=0.05, sides=4, rings=4)
            A["Bone"].add(V, F, uv, al)
        V, F = blob(end - tg * 0.03, basis_axes(perp(tg), np.cross(tg, perp(tg)), tg, 0.075 * k, 0.075 * k, 0.05 * k),
                    sub=2, amp=0.2)
        A["Marrow"].add(V, F, g=0.0)
        for _ in range(3):
            hang_strand(end, rng.uniform(0.7, 2.0), 0.016 * k, A["Tendon"])
        hang_strand(end, rng.uniform(0.4, 1.1), 0.012 * k, A["Oil"])
        LEG_LOG.append(dict(kind=kind, F=end, Aj=end, K=K, sigma=sigma, s=s, hook=None))
        return
    shank, r = leg_shank(Kb, J, side + upa * 0.3, 0.08 * k ** 0.8, 0.048 * k ** 0.8, A["Bone"],
                         barbs=rng.randint(1, 3), k=k, bow=0.35)
    for tf in (0.07,):
        i = int(tf * (len(shank) - 1))
        iron_hoop(shank[i], nrm(shank[i + 1] - shank[max(i - 1, 0)]), r[i] + 0.02 * k, k, w=0.05, rivets=6)
    # ankle: bolted iron knuckle, a tendon over it
    V, F = blob(J, basis_axes(side, T, D, 0.1 * k, 0.1 * k, 0.1 * k), sub=2, amp=0.1, freq=6.0)
    A["Iron"].add(V, F, m=0.0)
    A["Iron"].add_tube(np.array([J - pn * 0.14 * k, J + pn * 0.14 * k]), 0.03 * k, sides=8, m=0.0)
    met = bezier([J, (J + Aj) / 2 - side * 0.08 * k, Aj], 22)
    tm = np.linspace(0, 1, len(met))
    A["Iron"].add_tube(met, (0.055 - 0.015 * tm) * k ** 0.8, ry=(0.04 - 0.01 * tm) * k ** 0.8, up=pn, sides=6, m=0.0,
                       g=0.0)
    for i in range(2, len(met) - 2, 4):
        V, F = blob(met[i] + pn * 0.045 * k, basis_axes(side, T, pn, 0.018 * k, 0.018 * k, 0.012 * k), sub=1, amp=0.0)
        A["Iron"].add(V, F, m=0.0)
    a_ = shank[int(len(shank) * 0.7)]
    b_ = met[int(len(met) * 0.3)]
    A["Tendon"].add_tube(sag_path(a_, b_, -0.05, 12, toward=(side + upa) * 0.12 * k), 0.025 * k, sides=6,
                         cap0=False, cap1=False)
    hook = grapnel(Aj, F_, nout, side, D, k, planted)
    LEG_LOG.append(dict(kind=kind, F=F_, Aj=Aj, K=K, sigma=sigma, s=s, hook=hook, J=J))
    if planted:
        wall_cracks(F_, nout, k)
        if rng.random() < 0.6:
            grit(F_ + nout * 0.05, nout, k, n=rng.randint(10, 22), fall=rng.uniform(0.6, 1.8))
    else:
        grit(F_ - nout * 0.2, nout, k, n=10, fall=1.2, spread=0.15)
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
    A["Ember"].add(V, F, g=0.4)
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
    if LOW:
        acc.add_tube(resample(np.asarray(path, float), step=0.25), 0.03 * scale, sides=4, m=0.0)
        return
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
    A["Flesh"].add(V, F, m=0.95)
    # swollen dark rim of the puncture and a dried rust-blood trail run down from it
    th = np.linspace(0, 2 * math.pi, 18)
    rim = p_in + d * 0.04 + 0.12 * scale * (np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2)
    A["Marrow"].add_tube(rim, 0.03 * scale, sides=6, cap0=False, cap1=False, g=0.0)
    tr = p_in + d * 0.06 + np.array([DOWN * h + NZ.vec((p_in + h)[None])[0] * 0.04 for h in np.linspace(0.05, 0.7 * scale, 10)])
    A["Oil"].add_tube(tr, np.linspace(0.022, 0.006, 10) * scale, sides=5, cap0=False)
    if hook:
        meat_hook(path[-1], scale * 1.9)


# =============================================================================
# Fronds (pale fiddleheads with cilia) and mucus
# =============================================================================
def _frond(root, direction, length, curl_axis, r0=0.018, n=56, curl=1.0, cilia=True):
    """Pale, finger-thin sensory frond: a gentle arc that rolls up into a tight fiddlehead spiral at the tip,
    fringed with fine cilia (in game: animate the curl toward sound)."""
    p = np.asarray(root, float)
    d = nrm(direction)
    ax = nrm(curl_axis - curl_axis.dot(d) * d)
    tt = np.arange(1, n) / n
    w = 0.1 + smoothstep(0.45, 1.0, tt) ** 2
    dth = curl * 2 * math.pi * 1.35 * w / w.sum()
    stp = (1 - 0.72 * tt ** 1.4)
    stp = stp / stp.sum() * length
    pts = [p.copy()]
    for i in range(n - 1):
        d = rot(ax, dth[i]) @ d
        if tt[i] < 0.5:
            nv = NZ.vec((p * 2.3)[None])[0]
            d = nrm(d + nv * 0.06 + DOWN * 0.01)
            ax = nrm(ax - ax.dot(d) * d)
        p = p + d * stp[i]
        pts.append(p.copy())
    P = np.array(pts)
    t = np.linspace(0, 1, len(P))
    r = r0 * (1 - 0.88 * t ** 0.8) + 0.0012
    A["Frond"].add_tube(P, r, sides=6, cap0=False, m=t)
    if cilia:
        T, N, B = frames(P)
        for i in range(3, len(P) - 3, 3):
            for sgn in (-1, 1):
                dd = nrm(N[i] * sgn + T[i] * 0.7 + B[i] * rng.uniform(-0.5, 0.5))
                L = (0.02 + 0.05 * (1 - t[i])) * rng.uniform(0.6, 1.3) * (0.5 + 20 * r0)
                Q = np.array([P[i], P[i] + dd * L * 0.5 + T[i] * L * 0.15, P[i] + dd * L + T[i] * L * 0.5])
                if not LOW:
                    A["Frond"].add_tube(Q, np.array([0.0035, 0.002, 0.0007]), sides=3, cap0=False, cap1=False,
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


def faces_list(F):
    """Flatten loft/blob face output (array or list of arrays/lists) into a python list of index lists."""
    if isinstance(F, np.ndarray):
        F = [F]
    out = []
    for blk in F:
        if isinstance(blk, np.ndarray) and blk.ndim == 2:
            out += blk.tolist()
        else:
            out += [list(f) for f in blk]
    return out


def bool_cut(bm, cutters, name="cut"):
    """Boolean-subtract cutter meshes [(V, F), ...] from a bmesh (EXACT solver via a temporary object).
    Frees `bm` and returns a new bmesh."""
    sc = bpy.context.scene
    me = bpy.data.meshes.new("tmp_" + name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("tmp_" + name, me)
    sc.collection.objects.link(ob)
    tmp = []
    for i, (V, F) in enumerate(cutters):
        cm = bpy.data.meshes.new("tmpc_%s_%d" % (name, i))
        cm.from_pydata(np.asarray(V, float).tolist(), [], faces_list(F))
        cm.validate()
        co = bpy.data.objects.new(cm.name, cm)
        sc.collection.objects.link(co)
        md = ob.modifiers.new("cut%d" % i, "BOOLEAN")
        md.operation = "DIFFERENCE"
        try:
            md.solver = "EXACT"
        except Exception:
            pass
        md.object = co
        tmp.append(co)
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bmesh.new()
    out.from_mesh(me2)
    for co in tmp:
        cmesh = co.data
        bpy.data.objects.remove(co)
        bpy.data.meshes.remove(cmesh)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(me2)
    return out


def pit_cutter(c, axis, r, depth):
    axis = nrm(axis)
    P = np.array([c - axis * 0.35, c + axis * depth * 1.1])
    V, F, uv, al = tube(resample(P, 6), r, sides=20)
    return V, F


def _eardrum(c, axis, r, depth, t, rr, e1, e2):
    """Taut eardrum sealing a listening pit (its own kit mesh, Mason_PitMembrane, so it can blink/flex)."""
    # taut eardrum: a slightly domed disc a little way in, with radial vessels
    zc = depth * 0.22
    nr_, na_ = 7, 28
    rows = []
    for i in range(nr_ + 1):
        rf = i / nr_
        rd_ = float(np.interp(zc / depth, t, rr)) * 1.01 * rf
        dome = -0.12 * r * (1 - rf ** 2)
        rows.append([c + axis * (zc + dome) + rd_ * (math.cos(a) * e1 + math.sin(a) * e2)
                     for a in np.linspace(0, 2 * math.pi, na_, endpoint=False)])
    G = np.array(rows)
    G += NZ.vec(G.reshape(-1, 3) * (6.0 / r)).reshape(G.shape) * 0.012 * r
    idx = np.arange((nr_ + 1) * na_).reshape(nr_ + 1, na_)
    quads = np.stack([idx[:-1], np.roll(idx[:-1], -1, 1), np.roll(idx[1:], -1, 1), idx[1:]], -1).reshape(-1, 4)
    A["Membrane"].add(G.reshape(-1, 3), quads, m=1.0)
    for k in range(rng.randint(4, 7)):
        a = rng.uniform(0, 2 * math.pi)
        pts = []
        for i in range(nr_ + 1):
            a += rng.uniform(-0.12, 0.12)
            rf = 1 - i / nr_ * 0.92
            rd_ = float(np.interp(zc / depth, t, rr)) * rf
            dome = -0.12 * r * (1 - rf ** 2)
            pts.append(c + axis * (zc + dome - 0.004) + rd_ * (math.cos(a) * e1 + math.sin(a) * e2))
        A["Vein"].add_tube(np.array(pts), np.linspace(0.009, 0.002, len(pts)) * (0.5 + 2 * r), sides=4, g=0.08)


def _listening_pit(c, axis, r, depth, hue, power, membrane=False, cames=0, face_n=None, drape=None):
    """A deep wet ear-canal sunk into stone: flesh lip wrapping the cut edge, ribbed tunnel narrowing into the
    dark, and a coal glowing far down at the bottom (each pit its own hue/intensity). Some are sealed by a
    taut translucent eardrum; the big one keeps a few soot-black lead cames of the glazing it used to be."""
    axis = nrm(axis)
    fn = nrm(face_n) if face_n is not None else -axis
    e1 = perp(axis)
    e2 = np.cross(axis, e1)
    n = 26
    t = np.linspace(0, 1, n)
    bend = perp(axis) * 0.08 * r * np.sin(t * 2.4)[:, None] + e2 * 0.06 * r * np.sin(t * 3.1 + 1)[:, None]
    P = c[None] + axis[None] * (depth * t - 0.04 * r)[:, None] + bend
    rr = r * (1.0 - 0.38 * t ** 1.3) * (1 + 0.075 * np.sin(2 * math.pi * t * 4.5) * (t > 0.1))
    rr = rr * (1 - 0.6 * smoothstep(0.88, 1.0, t))
    V, F, uv, al = tube(P, rr, sides=18, cap0=False, cap1=True, flip=True, nz_amp=0.07, nz_freq=4.5 / r,
                        seed=rng.random() * 30)
    A["Gum"].add(V, F, uv, m=0.0, g=0.0, d=al)
    # coal at the bottom
    Vb, Fb = blob(P[-3], basis_axes(e1, e2, axis, rr[-3] * 0.85, rr[-3] * 0.85, rr[-3] * 0.5), sub=2, amp=0.3,
                  freq=6.0 / r)
    A["Pit"].add(Vb, Fb, m=hue, g=power)
    # flesh lip bulging out of the cut and wrapping over the stone edge
    th = np.linspace(0, 2 * math.pi, 40)
    lipr = r * (1.0 + 0.08 * NZ.fbm(np.stack([np.cos(th), np.sin(th), np.zeros_like(th)], -1) * 2.0 + c, 2))
    rd_ = np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2
    tt_ = -(rd_ @ fn) * lipr / min(-0.25, float(axis @ fn))
    ring = c[None] - fn[None] * 0.012 + lipr[:, None] * rd_ + tt_[:, None] * axis[None]
    if drape is not None:
        ring = resample(np.array([drape(q) for q in resample(np.vstack([ring, ring[:1]]), 72)]), 72)
    thr = np.linspace(0, 2 * math.pi, len(ring))
    A["Flesh"].add_tube(ring, max(0.035, 0.13 * r) * (1 + 0.35 * np.sin(thr * 3 + rng.random() * 6)), sides=8,
                        cap0=False, cap1=False, m=0.15, nz_amp=0.15, nz_freq=9.0)
    # dark vessels radiating from the lip over the stone
    for _ in range(rng.randint(2, 4) if r > 0.12 else rng.randint(0, 2)):
        a = rng.uniform(0, 2 * math.pi)
        d0 = math.cos(a) * e1 + math.sin(a) * e2
        pts = [c + d0 * r * 1.05 - fn * 0.012]
        dd = d0
        for _ in range(rng.randint(5, 9)):
            dd = nrm(dd + perp(fn) * 0 + (rot(fn, rng.uniform(-0.6, 0.6)) @ dd) * 0.8)
            pts.append(pts[-1] + dd * r * 0.25)
        Pv = np.array(pts)
        A["Vein"].add_tube(Pv, np.linspace(0.016, 0.004, len(Pv)) * (0.6 + r), sides=5, g=0.03)
    if membrane:
        with tag("PitMembrane", PARTS[PART_STACK[-1]]["M"]):
            _eardrum(c, axis, r, depth, t, rr, e1, e2)
    for k in range(cames):
        # soot-black lead cames: the last of the glazing, bent and snapped, almost every pane gone
        a = rng.uniform(0, math.pi) + k * 1.1
        d0 = math.cos(a) * e1 + math.sin(a) * e2
        dz = axis * (0.03 + 0.04 * k)
        p0 = c - d0 * r * 0.97 + dz
        p1 = c + d0 * r * (0.97 if k == 0 else rng.uniform(0.1, 0.45)) + dz + axis * (0.0 if k == 0 else 0.12 * r)
        Q = sag_path(p0, p1, 0.0, 12, toward=axis * 0.1 * r)
        A["Iron"].add_tube(Q, 0.011, ry=0.006, up=axis, sides=4, m=0.0, cap0=False)
        if k == 0:
            # one cracked, filthy shard of glass still in the leading
            q0 = (p0 * 0.62 + p1 * 0.38)
            sd = np.cross(axis, d0)
            Vg = np.array([q0, q0 + d0 * 0.13 * r * 2, q0 + d0 * 0.09 * r * 2 + sd * 0.18 * r, q0 + sd * 0.12 * r])
            A["Glass"].add(Vg + axis * 0.003, [[0, 1, 2, 3]], m=0.2, g=0.25)


# =============================================================================
# THE CROWN, v2 (2026-10): "the saint that learned to hunt"
#
# A cathedral saint's colossal pale stone FACE, split down the midline and pried apart like a pair of church doors
# (portal_comb_L0 / R0, hinged at their outer back edges). Human teeth line both edges of the split and run on into the
# upper dental arch (portal_comb_L1 / R1, children of the halves). The lower jaw is broken in two and hangs at two
# different wrong angles from the jaw joints (portal_hinge_0 / 1). Behind the split three telescoping rings of hooked
# fangs (portal_arch_0..2: they shoot forward through the face at the strike) guard a lamprey throat (gullet_0..2) with
# one ember far down. The statue's blank eyes are bored through: small, blind, wet eyes cluster in the sockets over a dim
# coal (pit_0..6: eye rolls / bulges), weeping black down the cheeks. Five long statue arms (arm_n_0 shoulder + forearm,
# arm_n_1 hand) reach round the face with too-long fingers; behind the head a broken rose-window halo of soot-black
# voussoirs and gilded thorns. A climber half absorbed into the left temple; a rope caught in the teeth.
#
# Face-local frame (metres, kit scale): x right, y up (dorsal), z out of the face. The face is tilted FACE_TILT down toward
# the climber below and sits on the crown frame (S, D, T) at CROWN["C"] (crown-local = (x, y, z) along S, D, T).
# =============================================================================
FACE_TILT = math.radians(13.0)
FACE_PIV = np.array([0.0, 0.7, 0.0])
FACE_Z0 = 1.05          # front of the face at the cheek reference
X_EYE, Y_EYE = 0.97, 1.43
Y_LIPE = -0.12          # lower edge of the upper lip: the upper halves end here at the split
Y_FTOP = 3.3            # top of the forehead at the split
FACE_TH = 0.36          # stone thickness of the mask
TMJ = np.array([1.42, 0.52, -0.42])       # jaw joint (x mirrored per side)
JAW_DROP = (math.radians(32.0), math.radians(45.0))     # rest drop of the left / right jaw half (asymmetric: broken)
JAW_SPLAY = (math.radians(15.0), math.radians(22.0))     # ... and how far each half has splayed out from the break
# eye sockets: side, centre (X, Y), radii, bore depth, eyes [(dx, dy) in radii, eye radius]
SOCKETS = [   # eyes: (dx, dy) in socket radii, radius, pit bone
    dict(side=-1, c=(X_EYE, Y_EYE - 0.04), rx=0.42, ry=0.36, depth=0.85,
         eyes=[(-0.42, 0.28, 0.072, 0), (-0.05, 0.4, 0.06, 0), (0.36, 0.22, 0.085, 0), (-0.3, -0.25, 0.075, 1),
               (0.05, -0.05, 0.052, 1), (0.3, -0.42, 0.09, 2)]),
    dict(side=1, c=(X_EYE + 0.05, Y_EYE - 0.12), rx=0.47, ry=0.47, depth=0.95,
         eyes=[(-0.25, 0.25, 0.11, 3), (0.22, 0.38, 0.062, 3), (0.35, 0.02, 0.07, 3), (-0.12, -0.3, 0.05, 4),
               (0.18, -0.45, 0.058, 4), (0.42, -0.62, 0.045, 4), (-0.38, -0.6, 0.048, 4)]),
    dict(side=-1, c=(1.18, 0.55), rx=0.22, ry=0.18, depth=0.42, eyes=[(-0.15, 0.1, 0.08, 5), (0.35, -0.2, 0.05, 5)]),
    dict(side=1, c=(0.46, 2.5), rx=0.09, ry=0.24, depth=0.36, eyes=[(0.0, 0.05, 0.066, 6)]),
]


def place(bm, Vw):
    """Move a block's vertices to their final world positions and fix its normals."""
    for v, p_ in zip(bm.verts, Vw):
        v.co = Vector(p_)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def face_gap(Y):
    """Half width of the split at height Y: a crack in the forehead, wide at the mouth, ragged."""
    Y = np.asarray(Y, float)
    t = np.clip((Y_FTOP - Y) / (Y_FTOP - Y_LIPE), 0, 1)
    q = np.stack([Y.ravel() * 3.1, np.full(Y.size, 1.7), np.zeros(Y.size)], -1)
    return 0.03 + 0.05 * t ** 1.5 + 0.012 * NZ.fbm(q, 3).reshape(Y.shape)


def face_outline(Y, sgn):
    """Outer half width of the mask at height Y (an egg with a broken edge)."""
    Y = np.asarray(Y, float)
    a = np.clip(np.abs((Y - 0.85) / 2.6), 0, 1)
    w = 1.68 * (1 - a ** 2.8) ** (1 / 2.8)
    q = np.stack([Y.ravel() * 2.3, np.full(Y.size, 4.0 + sgn), np.zeros(Y.size)], -1)
    w = w * (1 + 0.05 * NZ.fbm(q, 3).reshape(Y.shape) + 0.025 * NZ.fbm(q * 4.0, 2).reshape(Y.shape))
    if sgn > 0:      # a great chunk broken out of the right side of the forehead
        w = w - 0.55 * np.exp(-((Y - 2.45) / 0.32) ** 2)
    else:            # and a bite out of the left temple
        w = w - 0.3 * np.exp(-((Y - 1.75) / 0.22) ** 2)
    return w


def face_uv(U, V, sgn):
    ybot = np.interp(U, [0.0, 0.45, 0.7, 0.86, 1.0], [Y_LIPE, Y_LIPE - 0.02, 0.0, -0.3, -0.8])
    ytop = np.interp(U, [0.0, 0.45, 1.0], [Y_FTOP, 3.12, 2.4])
    Y = ybot + V * (ytop - ybot)
    g = face_gap(Y)
    w = face_outline(Y, sgn)
    return g + U * (w - g), Y


def _g2(X, Y, cx, cy, sx, sy, p=1.0):
    q = ((X - cx) / sx) ** 2 + ((Y - cy) / sy) ** 2
    return np.exp(-q ** p)


def _seg_dist(X, Y, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    t = np.clip(((X - a[0]) * d[0] + (Y - a[1]) * d[1]) / float(d @ d), 0, 1)
    return np.hypot(X - (a[0] + t * d[0]), Y - (a[1] + t * d[1]))


def nasal_cavity(X, Y):
    """The hole the broken nose left (an inverted heart at the midline, 0..1)."""
    w = np.interp(Y, [0.18, 0.3, 0.55, 0.75, 0.92], [0.0, 0.2, 0.27, 0.2, 0.0])
    q = np.stack([X.ravel() * 11.0, Y.ravel() * 11.0, np.full(X.size, 6.6)], -1)
    w = w * (1 + 0.15 * NZ.fbm(q, 2).reshape(X.shape))
    return 1 - smoothstep(0.75, 1.05, X / np.maximum(w, 1e-3))


def face_relief(X, Y):
    """Depth of the carved saint's face (z out of the face, before FACE_Z0) at X = |x|, Y. Symmetric; damage separately."""
    X, Y = np.asarray(X, float), np.asarray(Y, float)
    z = -0.5 * X ** 2 - 0.05 * (Y - 0.9) ** 2
    z = z - 0.2 * np.clip(Y - 2.2, 0, None) ** 1.5 - 0.6 * np.clip(X - 1.05, 0, None) ** 2
    bm = smoothstep(0.04, 0.32, X) * (1 - smoothstep(1.3, 1.68, X))
    z = z + 0.27 * np.exp(-((Y - 1.92 + 0.12 * (X - 0.75) ** 2) / 0.18) ** 2) * bm          # brow ridge
    z = z + 0.06 * _g2(X, Y, 0.0, 1.78, 0.3, 0.3)                                          # glabella
    z = z - 0.62 * _g2(X, Y, X_EYE, Y_EYE - 0.02, 0.58, 0.4, 1.4)                          # the orbit
    z = z + 0.1 * _g2(X, Y, X_EYE + 0.02, Y_EYE - 0.04, 0.3, 0.2)                          # what is left of the stone eye
    z = z + 0.09 * _g2(X, Y, X_EYE, Y_EYE + 0.24, 0.36, 0.07)                              # carved upper lid
    hN = np.interp(Y, [0.18, 0.3, 0.48, 0.75, 1.15, 1.55, 1.85], [0.0, 0.26, 0.66, 0.56, 0.36, 0.2, 0.08])
    wN = np.interp(Y, [0.18, 0.5, 1.0, 1.7], [0.31, 0.27, 0.19, 0.16])
    z = z + hN * np.exp(-(X / wN) ** 2)                                                    # nose
    # the nose has broken off below the bridge: a jagged stump, then the nasal cavity (an inverted heart, black)
    q = np.stack([X.ravel() * 9.0, Y.ravel() * 9.0, np.full(X.size, 3.3)], -1)
    brk = 0.86 + 0.06 * NZ.fbm(q, 2).reshape(X.shape)
    z = z - hN * np.exp(-(X / wN) ** 2) * smoothstep(brk + 0.05, brk - 0.08, Y)
    z = z + 0.12 * _g2(X, Y, 0.3, 0.42, 0.13, 0.12)                                        # what is left of the alar wing
    z = z - 0.55 * nasal_cavity(X, Y)
    z = z + 0.2 * _g2(X, Y, 1.2, 0.98, 0.32, 0.2)                                          # cheekbone
    z = z - 0.3 * _g2(X, Y, 1.0, 0.12, 0.34, 0.42)                                         # gaunt hollow
    z = z - 0.12 * _g2(X, Y, 1.45, 1.95, 0.22, 0.45)                                       # temple
    z = z - 0.07 * np.exp(-(_seg_dist(X, Y, (0.42, 0.4), (0.84, -0.18)) / 0.07) ** 2)      # nasolabial fold
    lipm = 1 - smoothstep(0.6, 1.0, X)
    z = z + 0.13 * np.exp(-((Y - 0.06 + 0.1 * X ** 2) / 0.1) ** 2) * lipm                   # upper lip
    z = z - 0.12 * _g2(X, Y, 1.05, -0.05, 0.3, 0.2)                                        # the torn corner sinks in
    return z


def socket_field(X, Y, sgn):
    """Bores of the eye sockets on this half: (dz, inside 0..1)."""
    dz = np.zeros_like(X)
    ins = np.zeros_like(X)
    for so in SOCKETS:
        if so["side"] != sgn:
            continue
        cx, cy = so["c"]
        q = np.stack([X.ravel() * 4.0 + cx * 7, Y.ravel() * 4.0, np.full(X.size, 2.0 + sgn)], -1)
        jag = 1 + 0.12 * NZ.fbm(q, 3).reshape(X.shape) * (so["rx"] > 0.2)
        r = np.hypot((X - cx) / so["rx"], (Y - cy) / so["ry"]) * jag
        h = 1 - smoothstep(0.82, 1.08, r)
        dz = dz - so["depth"] * h
        ins = np.maximum(ins, 1 - smoothstep(0.75, 1.55, r))
    return dz, ins


def socket_rim(so):
    """Face-local centre of a socket's mouth (on the relief) and its axis (into the head)."""
    cx, cy = so["c"]
    X = np.array([cx])
    Y = np.array([cy])
    z = FACE_Z0 + face_relief(X, Y)[0] + 0.08
    return np.array([so["side"] * cx, cy, z])


def face_tears(X, Y, sgn):
    """Black weeping streaks under the sockets, the nostril and the brow slit (0..1)."""
    out = np.zeros_like(X)
    srcs = []
    for so in SOCKETS:
        if so["side"] == sgn and so["rx"] > 0.15:
            cx, cy = so["c"]
            out = np.maximum(out, 0.45 * _g2(X, Y, cx, cy - so["ry"] * 0.9, so["rx"] * 0.9, so["ry"] * 0.55))
            srcs.append((cx - 0.3 * so["rx"], cy - so["ry"] * 0.85, 0.022, 1.25 + 0.35 * sgn, 1.0))
            srcs.append((cx + 0.35 * so["rx"], cy - so["ry"] * 0.8, 0.016, 0.7, 0.85))
    if sgn > 0:
        srcs.append((0.2, 0.26, 0.018, 0.7, 0.8))       # the nostril runs
    for (xs, ys, w, L, st) in srcs:
        q = np.stack([Y.ravel() * 2.0, np.full(X.size, xs * 13.0 + sgn), np.zeros(X.size)], -1)
        mx = 0.06 * NZ.fbm(q, 3).reshape(X.shape) + 0.02 * NZ.fbm(q * 4.0, 2).reshape(X.shape)
        f = np.clip((ys - Y) / L, 0, 1)
        on = (Y < ys).astype(float) * (1 - f) ** 0.5 * (1 - smoothstep(0.92, 1.0, f))
        ww = w * (1 + 0.4 * f + 1.6 * np.exp(-((f - 0.9) / 0.05) ** 2))      # it beads into a drip at the end
        out = np.maximum(out, st * on * np.exp(-((X - xs - mx * (0.2 + f)) / ww) ** 2))
    return np.clip(out, 0, 1)


# cracks across the mask, face-local polylines (X, Y) per side
FACE_CRACKS = {
    -1: [[(0.12, 3.05), (0.35, 2.7), (0.42, 2.35), (0.66, 2.1), (0.7, 1.75)],
         [(1.55, 1.2), (1.4, 0.95), (1.45, 0.6), (1.3, 0.25), (1.38, -0.2)],
         [(0.55, 0.9), (0.72, 0.6), (0.68, 0.3)]],
    1: [[(0.2, 3.2), (0.48, 2.95), (0.62, 2.62), (0.95, 2.4), (1.1, 1.95), (1.0, 1.7)],
        [(1.3, 1.05), (1.15, 0.75), (0.96, 0.62), (0.95, 0.3), (1.05, 0.0), (1.1, -0.35)],
        [(1.62, 2.1), (1.45, 2.0), (1.33, 2.2)]],
}


def face_cracks(X, Y, sgn):
    out = np.zeros_like(X)
    for pl in FACE_CRACKS[sgn]:
        for a, b in zip(pl[:-1], pl[1:]):
            out = np.maximum(out, np.exp(-(_seg_dist(X, Y, a, b) / 0.016) ** 2))
    return out


FLAKES = {-1: [(1.62, 2.2, 0.55, 0.62), (0.3, 2.95, 0.22, 0.16), (1.7, 0.1, 0.36, 0.55), (0.62, 0.62, 0.12, 0.1),
               (0.75, 3.15, 0.42, 0.22)],
          1: [(1.15, 2.85, 0.75, 0.5), (1.68, 1.05, 0.34, 0.5), (0.35, 0.05, 0.14, 0.09), (1.4, -0.4, 0.36, 0.34),
              (1.45, 0.45, 0.1, 0.12)]}


def face_flakes(X, Y, sgn):
    """Where the stone skin has flaked off and the creature's own flesh shows (0..1): the ragged edges of the damage."""
    out = np.zeros_like(X)
    q = np.stack([X.ravel() * 6.0, Y.ravel() * 6.0, np.full(X.size, 5.0 + sgn)], -1)
    jag = 1 + 0.35 * NZ.fbm(q, 3).reshape(X.shape)
    for (cx, cy, rx, ry) in FLAKES[sgn]:
        out = np.maximum(out, 1 - smoothstep(0.75, 1.0, np.hypot((X - cx) / rx, (Y - cy) / ry) * jag))
    return out


def _grid_quads(nu, nv, flip=False):
    idx = np.arange((nu + 1) * (nv + 1)).reshape(nu + 1, nv + 1)
    q = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1).reshape(-1, 4)
    return q[:, ::-1] if flip else q


def _boundary(nu, nv):
    """Grid indices of the boundary loop: bottom (v=0) left->right, right column up, top right->left, left column down."""
    idx = np.arange((nu + 1) * (nv + 1)).reshape(nu + 1, nv + 1)
    return np.concatenate([idx[:, 0], idx[-1, 1:], idx[-2::-1, -1], idx[0, -2:0:-1]])


def _shell_walls(front, back, loop, centre):
    """Quads joining the boundary loop of a front grid to the same loop of its back grid, wound outward."""
    n = len(loop)
    F = []
    nf = len(front)
    for i in range(n):
        a, b = loop[i], loop[(i + 1) % n]
        quad = [a, b, nf + b, nf + a]
        p = np.array([front[a], front[b], back[b], back[a]])
        nrm_ = np.cross(p[1] - p[0], p[3] - p[0])
        if np.dot(nrm_, p.mean(0) - centre) < 0:
            quad = quad[::-1]
        F.append(quad)
    return F


def human_tooth(root, axis, face, kind, w, th, L, sides, rings, trunc=1.0, lean=0.06):
    """A human tooth (incisor / canine / premolar / molar): rounded-rectangle sections along the axis, root narrow (it hides in
    the gum), crown widening then closing to an edge, a point or a cusped table. Returns (V, F, al)."""
    axis = nrm(axis)
    face = nrm(face - face.dot(axis) * axis)
    side = np.cross(face, axis)
    tt, ww, hh = TOOTH_PROF[kind]
    t = np.linspace(0.0, 1.0, rings) * trunc
    a = np.interp(t, tt, ww) * w / 2
    b = np.interp(t, tt, hh) * th / 2
    P = np.asarray(root, float)[None] + axis[None] * (L * t)[:, None] - face[None] * (lean * L * t ** 2)[:, None]
    ang = np.linspace(0, 2 * math.pi, sides, endpoint=False) + math.pi / sides
    ca, sa = np.cos(ang), np.sin(ang)
    ex = 2.0 / 2.8
    cx = np.sign(ca) * np.abs(ca) ** ex
    cy = np.sign(sa) * np.abs(sa) ** ex
    prof = np.stack([cx[None] * a[:, None], cy[None] * b[:, None]], -1)
    Tn = np.broadcast_to(axis, P.shape)
    V, F, uv, al = loft(P, prof, fr=(Tn, np.broadcast_to(side, P.shape), np.broadcast_to(face, P.shape)), cap0=True, cap1=True)
    if kind in ("molar", "premolar") and trunc >= 1.0:
        V = V.copy()
        V[-1] = V[-1] - axis * (0.14 * L)            # the cusped table: its centre sinks into a fissure
    return V, F, al * trunc


TOOTH_PROF = {
    "incisor": ([0.0, 0.3, 0.45, 0.75, 0.93, 1.0], [0.35, 0.62, 0.72, 1.0, 0.97, 0.9], [0.45, 0.8, 0.85, 0.7, 0.32, 0.12]),
    "canine": ([0.0, 0.3, 0.45, 0.65, 0.88, 1.0], [0.35, 0.65, 0.78, 1.0, 0.55, 0.08], [0.5, 0.85, 0.92, 0.85, 0.45, 0.08]),
    "premolar": ([0.0, 0.3, 0.45, 0.72, 0.92, 1.0], [0.4, 0.65, 0.78, 1.0, 0.9, 0.62], [0.5, 0.85, 0.95, 1.0, 0.85, 0.55]),
    "molar": ([0.0, 0.3, 0.45, 0.72, 0.92, 1.0], [0.55, 0.75, 0.85, 1.05, 1.0, 0.8], [0.55, 0.85, 0.95, 1.05, 0.95, 0.75]),
}
TOOTH_SIZE = {"incisor": (0.12, 0.08, 0.38), "canine": (0.11, 0.1, 0.46), "premolar": (0.11, 0.12, 0.32),
              "molar": (0.15, 0.14, 0.3)}       # width, thickness, total length (root + crown)


def gum_band(P, outd, upd, thick, height, centres, spacing):
    """A scalloped band of gum along a tooth row: a lens-shaped section (thick toward `outd`, rising toward `upd`, the tooth
    tips), the crest dipping round every tooth and rising between them. P, outd, upd: (n, 3). Returns (V, F)."""
    P = np.asarray(P, float)
    n = len(P)
    L = arclen(P)
    d = np.min(np.abs(L[:, None] - np.asarray(centres)[None, :]), axis=1) if len(centres) else np.full(n, spacing)
    sc = 0.62 + 0.5 * smoothstep(0.12, 0.5, d / spacing)
    K = 10
    th_ = np.linspace(0, 2 * math.pi, K, endpoint=False)
    rings = []
    for i in range(n):
        o, u = nrm(outd[i]), nrm(upd[i])
        hh = height * sc[i]
        x = np.cos(th_) * thick * (1.0 + 0.25 * (np.cos(th_) > 0))
        y = np.where(np.sin(th_) > 0, np.sin(th_) * hh, np.sin(th_) * height * 0.6)
        rings.append(P[i][None] + x[:, None] * o[None] + y[:, None] * u[None])
    R = np.array(rings)
    R = np.concatenate([R, R[:, :1]], 1)
    idx = np.arange(n * (K + 1)).reshape(n, K + 1)
    quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    Vr = R.reshape(-1, 3)
    qm = quads[(n // 2) * K + 2]
    nn_ = np.cross(Vr[qm[1]] - Vr[qm[0]], Vr[qm[3]] - Vr[qm[0]])
    if np.dot(nn_, Vr[qm].mean(0) - P[n // 2]) < 0:
        quads = quads[:, ::-1]
    return Vr, quads


def uv_sphere(c, fwd, r, nlat, nlon, sx=1.0):
    """Sphere with its poles on +-fwd (radial topology round the front pole: the iris). Returns (V, F, cosine to fwd)."""
    fwd = nrm(fwd)
    e1 = perp(fwd)
    e2 = np.cross(fwd, e1)
    th = np.linspace(0, math.pi, nlat + 1)[1:-1]
    ph = np.linspace(0, 2 * math.pi, nlon, endpoint=False)
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    d = (np.cos(TH)[..., None] * fwd + np.sin(TH)[..., None] * (np.cos(PH)[..., None] * e1 * sx + np.sin(PH)[..., None] * e2))
    V = np.vstack([c + fwd * r, (c + d.reshape(-1, 3) * r), c - fwd * r])
    cs = np.concatenate([[1.0], np.cos(TH).ravel(), [-1.0]])
    F = []
    rowi = lambda i, j: 1 + i * nlon + (j % nlon)
    for j in range(nlon):
        F.append([0, rowi(0, j), rowi(0, j + 1)])
    for i in range(nlat - 2):
        for j in range(nlon):
            F.append([rowi(i, j), rowi(i + 1, j), rowi(i + 1, j + 1), rowi(i, j + 1)])
    last = len(V) - 1
    for j in range(nlon):
        F.append([rowi(nlat - 2, j + 1), rowi(nlat - 2, j), last])
    return V, F, cs


def eye_with_lids(c, fwd, up, r, owner_pit, rc, lid_top=0.35, lid_bot=-0.55):
    """A blind, wet, milky eye in fleshy lids. The lids are thick partial shells over the ball (not rings)."""
    nl, no = (6, 10) if LOW else (16, 28)
    V, F, cs = uv_sphere(c, fwd, r, nl, no)
    A["Eye"].add(V, F, d=cs, m=rc.uniform(0.0, 1.0))
    up = nrm(up - up.dot(fwd) * fwd)
    for (lim, sgn_) in ((lid_top, 1.0), (lid_bot, -1.0)):
        # the part of the ball beyond the lid line, offset out: a thick lid with a rounded edge
        nl2, no2 = (3, 7) if LOW else (8, 18)
        a0 = math.acos(np.clip(lim * sgn_, -0.95, 0.95))
        th = np.linspace(0.0, a0, nl2 + 1)          # polar angle from the lid's own pole (= +-up)
        ph = np.linspace(-1.9, 1.9, no2 + 1)        # round the front only (the back is inside the socket)
        TH, PH = np.meshgrid(th, ph, indexing="ij")
        pole = up * sgn_
        e1 = fwd
        e2 = np.cross(pole, e1)
        d = (np.cos(TH)[..., None] * pole + np.sin(TH)[..., None] * (np.cos(PH)[..., None] * e1 + np.sin(PH)[..., None] * e2))
        rr = r * (1.07 + 0.05 * np.sin(np.linspace(0, math.pi, nl2 + 1))[:, None])
        Vo = c + d * rr[..., None]
        Vi = c + d * (r * 1.005)
        nu_, nv_ = nl2, no2
        Vg = np.vstack([Vo.reshape(-1, 3), Vi.reshape(-1, 3)])
        q = _grid_quads(nu_, nv_)
        cen = c + pole * r * 0.5
        Fq = list(q)
        nfo = Vo.reshape(-1, 3).shape[0]
        Fq += list(q[:, ::-1] + nfo)
        # the free edge (th = a0): close the lid's lip
        ia = np.arange(nv_ + 1) + nu_ * (nv_ + 1)
        for j in range(nv_):
            Fq.append([ia[j + 1], ia[j], nfo + ia[j], nfo + ia[j + 1]])
        Fq = [list(f) for f in Fq]
        # orient the outer shell outward
        f0 = Fq[0]
        nn_ = np.cross(Vg[f0[1]] - Vg[f0[0]], Vg[f0[3]] - Vg[f0[0]])
        if np.dot(nn_, Vg[f0].mean(0) - c) < 0:
            Fq = [f[::-1] for f in Fq]
        A["Gum"].add(Vg, Fq, m=0.25, d=0.0)


def finger(base, dirs, lens, r0, r1, side, palm_n, acc, tip="d", m0=0.0):
    """A long finger along the joint chain (base + lens[i] * dirs[i]); an elliptic, tapering section with knuckle bulges at the
    joints, a padded tip. Returns the tip point."""
    pts = [np.asarray(base, float)]
    for d, L in zip(dirs, lens):
        pts.append(pts[-1] + nrm(d) * L)
    pts = np.array(pts)
    P = catmull(pts, 6 if LOW else 14)
    P = resample(P, 3 + 3 * len(lens) if LOW else 10 * len(lens))
    t = np.linspace(0, 1, len(P))
    Lc = np.concatenate([[0.0], np.cumsum(lens)]) / sum(lens)
    knk = sum(0.16 * np.exp(-((t - x) / 0.05) ** 2) for x in Lc[:-1])
    r = (r0 + (r1 - r0) * t) * (1 + knk) * np.where(t > 0.9, np.sqrt(np.clip((1 - t) / 0.1, 0.05, 1.0)) * 0.5 + 0.5, 1.0)
    T_, N_, B_ = frames(P, up=palm_n)
    sides = 6 if LOW else 12
    c = circle_prof(sides)
    prof = np.stack([c[None, :, 0] * r[:, None] * 1.12, c[None, :, 1] * r[:, None] * 0.92], -1)
    V, F, uv, al = loft(P, prof, fr=(T_, N_, B_), cap0=False, cap1=True)
    tm = np.clip((al - 0.8) / 0.2, 0, 1)
    if tip == "d":          # dark wet fingertips (the mask material's tear channel)
        acc.add(V, F, uv, m=m0, d=tm)
    else:                   # bone: the m channel's bloody ends
        acc.add(V, F, uv, m=m0 + (1 - m0) * tm)
    return P[-1]


def statue_hand(wrist, axis, palm_n, size, curl, spread, rc, acc, tip="d", m0=0.0, rf=1.0, skeletal=False):
    """A long-fingered stone hand: a cupped palm slab, four too-long fingers (three phalanges each), an opposed thumb.
    curl: per-finger joint angles (rad) toward the palm; spread: fan angle (rad)."""
    a = nrm(axis)
    n = nrm(palm_n - palm_n.dot(a) * a)          # n is the BACK of the hand (the palm faces -n)
    s = np.cross(n, a)
    S_ = size
    Lp = 0.5 * S_
    tt = np.linspace(0, 1, 4 if LOW else 9)
    P = wrist[None] + a[None] * (Lp * tt)[:, None] + n[None] * (0.04 * S_ * np.sin(math.pi * tt))[:, None]
    wid = (0.25 + 0.2 * smoothstep(0.0, 0.8, tt)) * S_
    thk = (0.12 - 0.02 * tt) * S_
    sides = 8 if LOW else 16
    c = circle_prof(sides)
    ex_ = 2.0 / 3.2
    cx = np.sign(c[:, 0]) * np.abs(c[:, 0]) ** ex_
    cy = np.sign(c[:, 1]) * np.abs(c[:, 1]) ** ex_
    prof = np.stack([cx[None] * wid[:, None] / 2, cy[None] * thk[:, None] / 2 - 0.02 * S_ * cx[None] ** 2], -1)
    knuck = P[-1]
    if not skeletal:
        V, F, uv, al = loft(P, prof, fr=(np.broadcast_to(a, P.shape), np.broadcast_to(s, P.shape), np.broadcast_to(n, P.shape)))
        acc.add(V, F, uv, m=m0)
    else:
        # carpal knot + four metacarpals fanning to the knuckles (a skeleton's hand, the palm is gone)
        Vb, Fb = blob(wrist + a * 0.05 * S_, basis_axes(s, n, a, 0.13 * S_, 0.07 * S_, 0.09 * S_), sub=1 if LOW else 3, amp=0.2,
                      freq=12.0 / S_, seed=rc.random() * 30)
        acc.add(Vb, Fb, m=m0)
        for k in range(4):
            off = (k - 1.5) * 0.105 * S_
            p0_ = wrist + a * 0.08 * S_ + s * off * 0.35
            p1_ = knuck + s * off - a * 0.03 * S_
            Pm = resample(np.array([p0_, p1_]), 4 if LOW else 10)
            tt_ = np.linspace(0, 1, len(Pm))
            rm = (0.034 + 0.022 * (np.exp(-(tt_ / 0.15) ** 2) + np.exp(-((1 - tt_) / 0.15) ** 2))) * S_ * rf
            V, F, uv, al = tube(Pm, rm, sides=5 if LOW else 10, cap0=True, cap1=True)
            acc.add(V, F, uv, m=m0)
    tips = []
    lens = [0.6, 0.7, 0.66, 0.52]
    for k in range(4):
        off = (k - 1.5) * 0.105 * S_
        base = knuck + s * off + n * (0.01 * S_ * (1 - abs(k - 1.5) / 1.5)) - a * 0.03 * S_
        fan = rot(n, -spread * (k - 1.5) / 1.5)
        d0 = fan @ a
        L = lens[k] * S_ * rc.uniform(0.95, 1.06)
        cs = curl[k] if isinstance(curl, (list, tuple)) else curl
        dirs = []
        ang = 0.0
        for j, fr_ in enumerate((0.46, 0.31, 0.23)):
            ang += cs * (0.6 + 0.25 * j) * rc.uniform(0.85, 1.15)
            dirs.append(rot(s, -ang) @ d0)
        tips.append(finger(base, dirs, [L * f for f in (0.46, 0.31, 0.23)], 0.05 * S_ * rf, 0.032 * S_ * rf, s, n, acc, tip, m0))
    # thumb: from the wrist side of the palm, opposing
    tb = wrist + a * 0.12 * S_ + s * (-0.15 * S_) - n * 0.03 * S_
    td = nrm(a * 0.55 - s * 0.6 - n * 0.45)
    dirs = [td, rot(n, 0.4) @ td, rot(n, 0.7) @ td]
    tips.append(finger(tb, dirs, [0.2 * S_, 0.17 * S_, 0.13 * S_], 0.06 * S_ * rf, 0.038 * S_ * rf, s, n, acc, tip, m0))
    return tips


def bone_arm(shoulder, elbow, wrist, back_n, size, owner, Mh, rc, curl, spread):
    """A long flayed arm out of the head: a knobbed humerus, radius and ulna side by side bound with taut sinew, rags of flesh at the
    joints (owner[0]), and the long-fingered skeleton hand (owner[1])."""
    S_ = size
    ax = nrm(wrist - elbow)
    bn = nrm(back_n - back_n.dot(ax) * ax)
    sd = nrm(np.cross(ax, bn))

    def long_bone(a_, b_, r_shaft, r_end, nring, sides):
        P = resample(np.array([a_, b_]), nring)
        t = np.linspace(0, 1, nring)
        P = P + perp(nrm(b_ - a_))[None] * (0.03 * S_ * np.sin(math.pi * t))[:, None]
        r = r_shaft + (r_end - r_shaft) * (np.exp(-(t / 0.13) ** 2) + np.exp(-((1 - t) / 0.13) ** 2))
        V, F, uv, al = tube(P, r, sides=sides, nz_amp=0.07, nz_freq=6.0, seed=rc.random() * 9)
        A["Bone"].add(V, F, uv, m=al)

    nring, sides = (6, 7) if LOW else (20, 12)
    with tag("Own:" + owner[0], Mh):
        long_bone(shoulder, elbow, 0.08 * S_, 0.15 * S_, nring, sides)
        for o in (-1, 1):
            long_bone(elbow + sd * o * 0.05 * S_ - ax * 0.04 * S_, wrist + sd * o * 0.055 * S_ + bn * 0.015 * o * S_, 0.045 * S_,
                      0.078 * S_, nring, sides)
        for o in (-1.5, 0.1, 1.4):
            a_ = elbow + sd * o * 0.065 * S_ - bn * 0.07 * S_ + ax * 0.1 * S_
            b_ = wrist + sd * o * 0.045 * S_ - bn * 0.045 * S_
            P = resample(np.array([a_, b_]), 4 if LOW else 10)
            t = np.linspace(0, 1, len(P))
            A["Tendon"].add_tube(P, (0.024 - 0.01 * np.sin(math.pi * t)) * S_, sides=4 if LOW else 6, cap0=False, cap1=False)
        for c_, rr_ in ((elbow, 0.16), (shoulder + (elbow - shoulder) * 0.1, 0.24)):
            Vb, Fb = blob(c_, basis_axes(sd, bn, ax, rr_ * S_, rr_ * 0.8 * S_, rr_ * 0.9 * S_), sub=2, amp=0.4, freq=4.0 / S_,
                          seed=rc.random() * 30)
            A["Flesh"].add(Vb, Fb, m=0.45)
    with tag("Own:" + owner[1], Mh):
        tips = statue_hand(wrist + ax * 0.04 * S_, ax, bn, 1.08 * S_, curl, spread, rc, A["Bone"], tip="m", m0=0.5, rf=0.72,
                           skeletal=True)
    return tips


def human_figure(pelvis, up, fwd, scale, rc, reach_dir, acc_skin, sink=0.55):
    """A climber half swallowed: torso, neck and head (mouth open), one arm reaching out of the flesh, the other gone in. Pale
    corpse skin; the helmet still on, its lamp dead. Returns the head centre."""
    up, fwd = nrm(up), nrm(fwd - fwd.dot(up) * up)
    sd = np.cross(fwd, up)
    k = scale
    # torso: elliptic sections from the waist (buried) to the shoulders
    zz = np.linspace(0, 1, 5 if LOW else 12)
    P = pelvis[None] + up[None] * (0.55 * k * zz)[:, None]
    wx = (0.15 + 0.06 * zz + 0.03 * np.sin(math.pi * zz)) * k
    wy = (0.1 + 0.02 * zz) * k
    c = circle_prof(8 if LOW else 16)
    prof = np.stack([c[None, :, 0] * wx[:, None], c[None, :, 1] * wy[:, None]], -1)
    V, F, uv, al = loft(P, prof, fr=(np.broadcast_to(up, P.shape), np.broadcast_to(sd, P.shape), np.broadcast_to(fwd, P.shape)))
    acc_skin.add(V, F, uv, m=0.2)
    sh = pelvis + up * 0.55 * k
    # neck + head, thrown back, the jaw hanging
    hc = sh + up * 0.2 * k + fwd * 0.03 * k
    acc_skin.add_tube(np.array([sh, hc - up * 0.06 * k]), np.array([0.055, 0.05]) * k, sides=6 if LOW else 10, m=0.2)
    V, F = blob(hc, basis_axes(sd, fwd, up, 0.085 * k, 0.1 * k, 0.115 * k), sub=2 if LOW else 4, amp=0.05, freq=6.0)
    # the face: sockets and the open mouth pressed in
    rel = V - hc
    fz = rel @ fwd
    for (ox, oy, dep, rx) in ((-0.032, 0.025, 0.03, 0.025), (0.032, 0.025, 0.03, 0.025), (0.0, -0.05, 0.05, 0.03)):
        dd = np.hypot((rel @ sd - ox * k) / (rx * k), (rel @ up - oy * k) / (rx * k * (1.6 if oy < 0 else 1.0)))
        V = V - fwd[None] * (dep * k * np.exp(-dd ** 2) * (fz > 0))[:, None]
    acc_skin.add(V, F, m=0.3)
    # the helmet (its lamp dead)
    hax = nrm(up + fwd * 0.2)
    prof_h = [(0.0, 0.135), (0.07, 0.125), (0.11, 0.095), (0.13, 0.05), (0.135, 0.0), (0.12, -0.01), (0.105, 0.02),
              (0.09, 0.06), (0.06, 0.1), (0.0, 0.112)]
    Vh, Fh = lathe([(a_ * k, b_ * k) for a_, b_ in prof_h], hc + hax * 0.01 * k, hax, 12 if LOW else 24)
    A["Iron"].add(Vh, Fh, m=0.3)
    lamp = hc + hax * 0.07 * k + fwd * 0.12 * k
    A["Iron"].add_tube(np.array([lamp - fwd * 0.02 * k, lamp + fwd * 0.04 * k]), 0.03 * k, sides=6 if LOW else 12, m=0.0)
    # the reaching arm: shoulder -> elbow -> wrist -> a hand with spread fingers
    s0 = sh + sd * 0.17 * k - up * 0.03 * k
    rd = nrm(reach_dir)
    el = s0 + nrm(rd + up * 0.3) * 0.3 * k
    wr = el + rd * 0.27 * k
    acc_skin.add_tube(np.array([s0, el, wr]), np.array([0.05, 0.04, 0.032]) * k, sides=6 if LOW else 10, m=0.2)
    hn = nrm(np.cross(rd, sd) + up * 0.2)
    for q in range(4):
        b0 = wr + rd * 0.08 * k + nrm(np.cross(rd, hn)) * (q - 1.5) * 0.02 * k
        d0 = rot(hn, (q - 1.5) * 0.2) @ rd
        tip = b0 + d0 * 0.08 * k + rot(np.cross(rd, hn), -0.7) @ d0 * 0.05 * k
        acc_skin.add_tube(np.array([wr, b0, b0 + d0 * 0.05 * k, tip]), np.array([0.022, 0.012, 0.01, 0.007]) * k,
                          sides=4 if LOW else 6, m=0.6)
    return hc


def _build_crown():
    O, T, D, S = spine_frame(RING_S)
    C = O
    CROWN.update(C=C, T=T, D=D, S=S)
    Mh = mat4(S, T, D, O)
    rc = random.Random(SEED * 7 + 11)            # the crown draws from its own stream (the body keeps its dice)
    pivots = {}
    CROWN["uvw"] = {}
    CROWN["mask_parts"] = {}

    def uvw(w, new_part=False):
        """Texel weight of the geometry that follows (the export scales its UV islands): new_part opens a sibling part first."""
        if new_part:
            retag(PARTS[PART_STACK[-1]]["name"], PARTS[PART_STACK[-1]]["M"])
        CROWN["uvw"][PART_STACK[-1]] = w

    def W3(loc):
        loc = np.asarray(loc, float).reshape(-1, 3)
        return C + loc[:, 0:1] * S + loc[:, 1:2] * D + loc[:, 2:3] * T

    def P3(x, y, z):
        return W3([[x, y, z]])[0]

    def D3(x, y, z):
        return x * S + y * D + z * T

    Rt = rot(np.array([1.0, 0.0, 0.0]), FACE_TILT)
    # the right half of the face has slipped: it sags and twists a little against the left (everything it carries follows: the
    # eyes in its sockets, its row of teeth, the staples, the sinews). HALF[0] names the half being built (0: none)
    HALF = [0]
    SAG_R = rot(np.array([0.0, 0.0, 1.0]), math.radians(-2.6)) @ rot(np.array([0.0, 1.0, 0.0]), math.radians(3.0))
    SAG_P = np.array([0.2, 1.4, 0.4])
    SAG_D = np.array([0.0, -0.11, -0.02])

    def HT(p):
        p = np.asarray(p, float).reshape(-1, 3)
        return p if HALF[0] <= 0 else (p - SAG_P) @ SAG_R.T + SAG_P + SAG_D

    def FL(p):
        """face-local -> crown-local"""
        return (HT(p) - FACE_PIV) @ Rt.T + FACE_PIV

    def FW(p):
        return W3(FL(p))

    def FD(v):
        v = np.asarray(v, float)
        v = Rt @ (SAG_R @ v if HALF[0] > 0 else v)
        return D3(*v)

    def piv(name, p_face):
        q = FL(p_face)[0]
        pivots[name] = [round(float(q[0]), 4), round(float(q[1]), 4), round(float(-q[2]), 4)]

    def jawT(sgn):
        """face-local rigid transform of the dropped jaw half on side sgn (rotation about its joint's x axis + a twist)."""
        j = 0 if sgn < 0 else 1
        piv_ = TMJ * np.array([sgn, 1.0, 1.0])
        R_ = rot(np.array([0.0, 1.0, 0]), sgn * JAW_SPLAY[j]) @ rot(np.array([1.0, 0, 0]), JAW_DROP[j])
        if sgn > 0:
            R_ = R_ @ rot(np.array([0.0, 0.25, 1.0]), math.radians(-7.0))
        return lambda p: (np.asarray(p, float).reshape(-1, 3) - piv_) @ R_.T + piv_, R_

    tips = []

    # ------------------------------------------------------------------ the mask halves (the doors), cracked, weeping
    nu, nv = (20, 34) if LOW else (120, 200)
    halves = {}
    for sgn, side_name in ((-1, "L"), (1, "R")):
        HALF[0] = sgn
        u = np.linspace(0, 1, nu + 1) ** 1.2
        v = np.linspace(0, 1, nv + 1)
        U, Vv = np.meshgrid(u, v, indexing="ij")
        X, Y = face_uv(U, Vv, sgn)
        Z = FACE_Z0 + face_relief(X, Y)
        dz, ins = socket_field(X, Y, sgn)
        Z = Z + dz
        ins = np.maximum(ins, smoothstep(0.2, 0.9, nasal_cavity(X, Y)))
        if sgn < 0:
            # the broken-out cheek where an eye has pushed through
            q = np.stack([X.ravel() * 5, Y.ravel() * 5, np.full(X.size, 9.0)], -1)
            rg = np.hypot((X - 1.2) / 0.3, (Y - 0.6) / 0.26) * (1 + 0.2 * NZ.fbm(q, 3).reshape(X.shape))
            Z = Z - 0.12 * (1 - smoothstep(0.85, 1.15, rg))
        cr = face_cracks(X, Y, sgn)
        tear = face_tears(X, Y, sgn)
        fl = face_flakes(X, Y, sgn)
        Z = Z - 0.24 * fl
        grime = np.clip(smoothstep(0.55, 1.0, U) * 0.8 + smoothstep(2.4, 3.3, Y) * 0.5 + 0.6 * smoothstep(0.0, 0.6, fl), 0, 1)
        if not LOW:
            q = np.stack([sgn * X.ravel(), Y.ravel(), np.zeros(X.size)], -1)
            Z = Z + 0.0045 * NZ.fbm(q * 9.0, 3).reshape(X.shape) - 0.007 * np.clip(NZ.fbm(q * 4.0 + 3.0, 2).reshape(X.shape) - 0.25, 0, 1)
            Z = Z - 0.03 * cr
        # the split edge and the outline are broken stone: pull the rim back a little
        Z = Z - 0.06 * (1 - smoothstep(0.0, 0.05, U)) - 0.08 * smoothstep(0.93, 1.0, U)
        front = np.stack([sgn * X, Y, Z], -1).reshape(-1, 3)
        Zb = FACE_Z0 - FACE_TH - 0.3 * X ** 2 - 0.045 * (Y - 0.9) ** 2 - 0.12 * np.clip(Y - 2.25, 0, None) ** 1.5
        Zb = np.minimum(Zb, Z - 0.1)
        back = np.stack([sgn * X * 0.985, Y, Zb], -1).reshape(-1, 3)
        Ff = _grid_quads(nu, nv, flip=sgn > 0)
        Fb = _grid_quads(nu, nv, flip=sgn < 0) + len(front)
        loop = _boundary(nu, nv)
        cen = np.array([sgn * 0.8, 1.2, FACE_Z0 - 0.5])
        Fw = [f[::-1] for f in _shell_walls(front, back, loop, cen)]
        Vall = FW(np.vstack([front, back]))
        paint = fl.ravel()
        e_in = ins.ravel()
        with tag("Own:portal_comb_%s0" % side_name, Mh):
            CROWN["mask_parts"][sgn] = PART_STACK[-1]       # the export gives these a planar UV island each
            A["Mask"].add(Vall, [Ff, Fb, np.array(Fw)], m=np.concatenate([paint, np.zeros(len(back))]),
                          g=np.concatenate([cr.ravel(), np.zeros(len(back))]),
                          d=np.concatenate([np.maximum(tear.ravel(), e_in), np.zeros(len(back))]),
                          e=np.concatenate([grime.ravel(), np.ones(len(back))]))
        halves[sgn] = dict(X=X, Y=Y, Z=Z, U=U)
        # the door hinge: the outer back edge at mid height
        piv("portal_comb_%s0" % side_name, np.array([sgn * 1.45, 1.0, FACE_Z0 - 0.75]))
    HALF[0] = 0

    # ------------------------------------------------------------------ eyes in the bored sockets (pit_0..6), coal behind
    pit_geo = {}
    for so in SOCKETS:
        rim = socket_rim(so)
        sgn = so["side"]
        cx, cy = so["c"]
        for (ex_, ey_, r_, pk) in so["eyes"]:
            ec = np.array([sgn * (cx + ex_ * so["rx"]), cy + ey_ * so["ry"], rim[2] - 0.16 - r_ * 0.5 - 0.1 * (so["rx"] > 0.3) * (1 - abs(ey_))])
            pit_geo.setdefault(pk, dict(so=so, eyes=[]))["eyes"].append((ec, r_))
    for pk in sorted(pit_geo):
        pg = pit_geo[pk]
        so = pg["so"]
        sgn = so["side"]
        HALF[0] = sgn
        cx, cy = so["c"]
        rim = socket_rim(so)
        cen = np.mean([e[0] for e in pg["eyes"]], axis=0)
        cen_w = FW(cen)[0]
        f0 = FD(np.array([0.0, -0.1, 1.0]))
        with tag("Pit", mat4(perp(f0), -f0, np.cross(perp(f0), -f0), cen_w)):
            for (ec, r_) in pg["eyes"]:
                fwd_l = nrm(np.array([sgn * 0.15 + rc.uniform(-0.45, 0.45), -0.2 + rc.uniform(-0.35, 0.3), 1.0]))
                if r_ >= 0.065:
                    eye_with_lids(FW(ec)[0], FD(fwd_l), FD(nrm(np.array([rc.uniform(-0.5, 0.5), 1.0, 0.0]))), r_, pk, rc,
                                  lid_top=rc.uniform(0.15, 0.45), lid_bot=-rc.uniform(0.35, 0.6))
                else:
                    nl, no = (4, 7) if LOW else (12, 20)
                    V, F, cs = uv_sphere(FW(ec)[0], FD(fwd_l), r_, nl, no)
                    A["Eye"].add(V, F, d=cs, m=rc.random())
            if pk == min(k for k in pit_geo if pit_geo[k]["so"] is so):
                # the socket's coal, far behind the cluster
                cc = np.array([sgn * cx, cy, rim[2] - so["depth"] * 0.85])
                Vb, Fb_ = blob(FW(cc)[0], basis_axes(FD(np.array([1.0, 0, 0])), FD(np.array([0, 1.0, 0])), FD(np.array([0, 0, 1.0])),
                                                     so["rx"] * 0.42, so["ry"] * 0.42, 0.05), sub=1 if LOW else 3, amp=0.3)
                A["Pit"].add(Vb, Fb_, m=0.5 + 0.3 * rc.random(), g=0.1 + 0.06 * rc.random())
        pivots["pit_%d" % pk] = [round(float(x), 4) for x in (FL(cen)[0] * np.array([1, 1, -1]))]
    HALF[0] = 0
    CROWN["pits"] = pit_geo

    # ------------------------------------------------------------------ teeth along the split + the upper arch (L1 / R1)
    def tooth_at(root, axis, facing, kind, scale, owner_tr=None, rot_=0.0, trunc=None, rotten=0.0):
        w, th, L = TOOTH_SIZE[kind]
        w, th, L = w * scale, th * scale, L * scale
        if trunc is None:
            trunc = 1.0 if rc.random() > 0.12 else rc.uniform(0.55, 0.8)
        facing = rot(axis, rot_) @ facing
        V, F, al = human_tooth(root - axis * L * 0.42, axis, facing, kind, w, th, L, 6 if LOW else 12, 5 if LOW else 12, trunc)
        if owner_tr is not None:
            V = owner_tr(V)
        A["Teeth"].add(V, F, m=al, d=rotten)
        tips.append(V[-1])
        return V

    # above the nose the row sinks deep into the split, so the closed face shows a dark hairline (not a zipper of teeth);
    # it is bared only when the halves swing open
    ROW_SINK = lambda y: 0.3 * smoothstep(0.75, 1.45, y)
    for sgn, side_name in ((-1, "L"), (1, "R")):
        HALF[0] = sgn
        H = halves[sgn]
        with tag("Own:portal_comb_%s1" % side_name, Mh):
            # (a) the vertical row: teeth rooted in the gum on the split edge, pointing across the gap (they interlock)
            ys = []
            y_ = Y_LIPE + 0.1 + (0.0 if sgn < 0 else 0.06)
            while y_ < 2.15:
                ys.append(y_)
                y_ += rc.uniform(0.12, 0.22)
            rowP, rowO, rowU, cents = [], [], [], []
            yy = np.linspace(Y_LIPE + 0.02, 2.3, 16 if LOW else 60)
            for y_ in yy:
                g_ = float(face_gap(np.array([y_]))[0])
                z_ = FACE_Z0 + float(face_relief(np.array([g_]), np.array([y_]))[0]) - 0.32 - ROW_SINK(y_)
                rowP.append(FW(np.array([sgn * (g_ + 0.05), y_, z_]))[0])
                rowO.append(FD(np.array([0.0, 0.0, 1.0])))
                rowU.append(FD(np.array([-sgn * 1.0, 0.0, 0.0])))
            rowP = np.array(rowP)
            Lrow = arclen(rowP)
            for y_ in ys:
                if rc.random() < 0.08:
                    continue
                g_ = float(face_gap(np.array([y_]))[0])
                z_ = FACE_Z0 + float(face_relief(np.array([g_]), np.array([y_]))[0]) - 0.3 - 0.06 * rc.random() - ROW_SINK(y_)
                sc_ = 1.0 * (1.0 - 0.4 * smoothstep(0.8, 2.2, y_)) * rc.uniform(0.75, 1.15)
                kr = rc.random()
                kind = "incisor" if kr < 0.45 else ("canine" if kr < 0.75 else ("premolar" if kr < 0.9 else "molar"))
                root = FW(np.array([sgn * (g_ + 0.02), y_, z_]))[0]
                ax = FD(nrm(np.array([-sgn * 1.0, rc.uniform(-0.45, 0.2), rc.uniform(-0.35, -0.05)])))
                tooth_at(root, ax, FD(np.array([0.0, 0.0, 1.0])), kind, sc_, rot_=rc.uniform(-0.6, 0.6),
                         rotten=1.0 if rc.random() < 0.15 else 0.0)
                if rc.random() < 0.3:      # crowding: a second tooth erupting behind the first
                    tooth_at(root - FD(np.array([0, 0, 0.1])), FD(nrm(np.array([-sgn * 1.0, rc.uniform(-0.3, 0.3), -0.3]))),
                             FD(np.array([0.0, 0.0, 1.0])), "canine" if rc.random() < 0.5 else "incisor", sc_ * 0.75,
                             rot_=rc.uniform(-0.8, 0.8))
                cents.append(float(np.interp(y_, yy, Lrow)))
            V, F = gum_band(rowP, np.array(rowO), np.array(rowU), 0.085, 0.07, cents, 0.155)
            A["Gum"].add(V, F, m=0.1)
            # (b) the upper dental arch behind the carved lip: incisors at the split, molars far back
            kinds = ["incisor", "incisor", "canine", "premolar", "premolar", "molar", "molar"]
            g0 = float(face_gap(np.array([Y_LIPE]))[0])
            xa = g0 + 0.07
            arch = []
            for i, kind in enumerate(kinds):
                w_ = TOOTH_SIZE[kind][0] * 1.05
                xa_c = xa + w_ / 2
                t_ = np.clip((xa_c - g0) / 0.95, 0, 1)
                zback = 0.55 * smoothstep(0.35, 1.0, t_)
                xq = min(xa_c, 0.82 + 0.15 * t_)
                z_ = FACE_Z0 + float(face_relief(np.array([min(xq, 0.75)]), np.array([0.02]))[0]) - 0.2 - zback
                root = np.array([sgn * xq, Y_LIPE + 0.1, z_])
                arch.append(root)
                if rc.random() < 0.07:
                    xa += w_
                    continue
                facing = nrm(np.array([sgn * smoothstep(0.3, 0.9, t_) * 0.9, 0.0, 1.0 - 0.6 * smoothstep(0.4, 1.0, t_)]))
                tooth_at(FW(root)[0], FD(nrm(np.array([sgn * 0.08, -1.0, 0.1]))), FD(facing), kind, rc.uniform(0.95, 1.12),
                         rot_=rc.uniform(-0.2, 0.2), rotten=1.0 if rc.random() < 0.12 else 0.0)
                xa += w_
            arch = np.array(arch)
            Pa = resample(catmull(arch, 4), 10 if LOW else 40)
            outd = np.array([FD(nrm(np.array([sgn * smoothstep(0.3, 0.9, i / (len(Pa) - 1)) * 0.9, 0.0, 1.0]))) for i in range(len(Pa))])
            upd = np.broadcast_to(FD(np.array([0.0, -1.0, 0.0])), Pa.shape)
            V, F = gum_band(FW(Pa + np.array([0, 0.03, 0])), outd, upd, 0.1, 0.075, [], 0.15)
            A["Gum"].add(V, F, m=0.1)
            piv("portal_comb_%s1" % side_name, np.array([sgn * 0.35, 1.2, FACE_Z0 - 0.1]))
    HALF[0] = 0

    # ------------------------------------------------------------------ the broken lower jaw (portal_hinge_0 / 1)
    for sgn, j in ((-1, 0), (1, 1)):
        jt, Rj = jawT(sgn)
        with tag("Own:portal_hinge_%d" % j, Mh):
            # the jaw under the saint's face is bone, the creature's own: a mandible broken at the chin, each half a curved bar
            # (body along the dental arch, then the ramus up to the joint), the lower teeth on its crest
            yc_ = -0.62
            body = np.array([(sgn * 0.035, yc_, FACE_Z0 - 0.1), (sgn * 0.45, yc_ - 0.01, FACE_Z0 - 0.2), (sgn * 0.82, yc_ - 0.02, FACE_Z0 - 0.5),
                             (sgn * 1.08, yc_ - 0.06, FACE_Z0 - 0.95), (sgn * 1.2, yc_ - 0.16, FACE_Z0 - 1.28)])
            ramus = np.array([(sgn * 1.2, yc_ - 0.16, FACE_Z0 - 1.28), (sgn * 1.3, -0.2, FACE_Z0 - 1.42), TMJ * np.array([sgn, 1, 1])])
            Pb = resample(catmull(body, 8), 7 if LOW else 40)
            Pr = resample(catmull(ramus, 8), 4 if LOW else 16)
            mc = np.array([0.0, 0.0, FACE_Z0 - 0.95])                       # the middle of the mouth (plan view)
            for (Pq, hh, tk, piece) in ((Pb, (0.5, 0.42, 0.36), (0.27, 0.22, 0.2), "body"), (Pr, (0.38, 0.34, 0.3), (0.15, 0.13, 0.13), "ramus")):
                t_ = np.linspace(0, 1, len(Pq))
                Tq = np.gradient(Pq, axis=0)
                Tq = Tq / np.linalg.norm(Tq, axis=1, keepdims=True)
                upv = np.array([0.0, 1.0, 0.0]) if piece == "body" else nrm(np.array([sgn * 0.0, 0.0, 1.0]))
                Nq = upv[None] - (Tq @ upv)[:, None] * Tq
                Nq = Nq / np.linalg.norm(Nq, axis=1, keepdims=True)
                Bq = np.cross(Nq, Tq)                     # N x T: right-handed once mapped through the crown frame
                h_ = np.interp(t_, [0, 0.5, 1], hh)
                w_ = np.interp(t_, [0, 0.5, 1], tk)
                if piece == "body":
                    w_ = w_ * (1 + 0.35 * np.exp(-(t_ / 0.12) ** 2))     # the chin's protuberance
                sides = 8 if LOW else 18
                ang = np.linspace(0, 2 * math.pi, sides, endpoint=False) + math.pi / sides
                ex_ = 2.0 / 3.0
                cx = np.sign(np.cos(ang)) * np.abs(np.cos(ang)) ** ex_
                cy = np.sign(np.sin(ang)) * np.abs(np.sin(ang)) ** ex_
                prof = np.stack([cx[None] * h_[:, None] / 2, cy[None] * w_[:, None] / 2], -1)
                V, F, uv, al = loft(FW(jt(Pq)), prof, fr=(np.array([FD(Rj @ v) for v in Tq]), np.array([FD(Rj @ v) for v in Nq]),
                                                         np.array([FD(Rj @ v) for v in Bq])), cap0=True, cap1=True, nz_amp=0.05,
                                    nz_freq=5.0, nz_seed=rc.random() * 9)
                A["Bone"].add(V, F, uv, m=np.clip(0.04 + al * 0.92, 0, 1) if piece == "body" else 0.5)
            # the lower teeth on the crest: incisors at the break, molars far back
            kinds = ["incisor", "incisor", "canine", "premolar", "premolar", "molar", "molar"]
            Lb_ = arclen(Pb)
            s_ = 0.07
            crest = []
            for kind in kinds:
                w0 = TOOTH_SIZE[kind][0]
                s_c = s_ + w0 / 2
                if s_c > Lb_[-1] * 0.8:
                    break
                i_ = int(np.searchsorted(Lb_, s_c))
                p_ = Pb[i_] + np.array([0.0, np.interp(s_c / Lb_[-1], [0, 0.5, 1], (0.5, 0.42, 0.36)) / 2, 0.0])
                crest.append(p_)
                s_ += w0 * 1.04
                if rc.random() < 0.1:
                    continue
                fac = nrm(np.array([p_[0] - mc[0], 0.0, p_[2] - mc[2]]))
                tooth_at(FW(jt(p_))[0], FD(Rj @ nrm(np.array([0.0, 1.0, 0.0]) + fac * 0.08)), FD(Rj @ fac), kind, rc.uniform(0.92, 1.12),
                         rot_=rc.uniform(-0.3, 0.3), rotten=1.0 if rc.random() < 0.14 else 0.0)
            crest = np.array(crest)
            Pa = resample(catmull(crest, 4), 8 if LOW else 30)
            outd = np.array([FD(Rj @ nrm(np.array([p[0] - mc[0], 0.0, p[2] - mc[2]]))) for p in Pa])
            upd = np.broadcast_to(FD(Rj @ np.array([0.0, 1.0, 0.0])), Pa.shape)
            V, F = gum_band(FW(jt(Pa - np.array([0, 0.035, 0]))), outd, upd, 0.12, 0.08, [], 0.15)
            A["Gum"].add(V, F, m=0.1)
            # the joint: a knot of sinew and stone at the jaw hinge, the tendon sheet torn to the cheek
            tm = TMJ * np.array([sgn, 1, 1])
            Vb, Fb_ = blob(FW(tm)[0], basis_axes(S, D, T, 0.24, 0.3, 0.26), sub=2, amp=0.25, freq=3.5, seed=rc.random() * 20)
            A["Flesh"].add(Vb, Fb_, m=0.3)
        piv("portal_hinge_%d" % j, TMJ * np.array([sgn, 1, 1]))
        # torn sheets of cheek skin from the jaw to the cheek, stretched by the drop (with holes); owned by the crown
        with tag("Own:crown", Mh):
            uvw(0.6)
            for q in range(2):
                xq0 = 0.95 + 0.25 * q
                topc = np.array([[sgn * (xq0 + dx), -0.2 - 0.25 * q + 0.15 * dx, FACE_Z0 - 0.62 - 0.1 * q - 0.2 * dx] for dx in np.linspace(0, 0.35, 6)])
                botc = jt(np.array([[sgn * (xq0 - 0.05 + dx), -0.65 - 0.2 * q + 0.1 * dx, FACE_Z0 - 0.5 - 0.1 * q - 0.2 * dx] for dx in np.linspace(0, 0.35, 6)]))
                nr_ = 3 if LOW else 10
                G = np.array([topc + (botc - topc) * t_ + FD(np.array([0, 0, -0.06 * math.sin(math.pi * t_)])) * 0 for t_ in np.linspace(0, 1, nr_ + 1)])
                G = G + np.array([0, 0, 1.0]) * 0.0
                Vs = FW(G.reshape(-1, 3))
                Q = _grid_quads(nr_, 5)
                keep = np.ones(len(Q), bool)
                if not LOW:
                    cen_ = Vs[Q].mean(1)
                    keep = NZ.fbm(cen_ * 6.0 + q * 3.0, 2) < 0.22
                A["Membrane"].add(Vs, Q[keep], m=0.6)
                A["Membrane"].add(Vs, Q[keep][:, ::-1], m=0.6)
                for t_ in (0.2, 0.55, 0.85):
                    a_ = Vs[int(t_ * 5)]
                    b_ = Vs[nr_ * 6 + int(t_ * 5)]
                    A["Tendon"].add_tube(np.array([a_, b_]), np.array([0.022, 0.016]), sides=5, cap0=False, cap1=False)

    # ------------------------------------------------------------------ the maw behind the split: a wet funnel to the throat
    with tag("Own:crown", Mh):
        uvw(0.55)
        K = 28 if LOW else 64
        az = np.arange(K) * 2 * math.pi / K
        rings = []
        zs = [FACE_Z0 - 0.42, FACE_Z0 - 0.75, FACE_Z0 - 1.1, FACE_Z0 - 1.5]
        for i, zf in enumerate(zs):
            t_ = i / (len(zs) - 1)
            ax_ = 0.9 - 0.08 * t_
            ay_up, ay_dn = 2.25 - 1.45 * t_, 1.75 - 0.95 * t_
            yc = 1.1 - 0.95 * t_
            yv = np.where(np.sin(az) > 0, np.sin(az) * ay_up, np.sin(az) * ay_dn)
            rings.append(np.stack([np.cos(az) * ax_, yc + yv, np.full(K, zf)], -1))
        G = np.array(rings)
        G = np.concatenate([G, G[:, :1]], 1)
        nR = len(zs)
        Vf = FW(G.reshape(-1, 3))
        idx = np.arange(nR * (K + 1)).reshape(nR, K + 1)
        Fq = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1).reshape(-1, 4)
        A["Gum"].add(Vf, Fq, m=0.0, d=np.repeat(np.linspace(0.0, 0.6, nR), K + 1))

    # ------------------------------------------------------------------ three telescoping oral discs of hooked fangs (portal_arch_0..2)
    # each a flat annulus of wet gum (a lamprey's mouth) facing out of the face, its inner edge ragged, fangs raked inward and back
    RINGS = [(0.0, FACE_Z0 - 1.45, 0.72, 0.78, 0.74), (0.5, FACE_Z0 - 1.0, 0.7, 1.2, 1.1), (0.9, FACE_Z0 - 0.62, 0.62, 1.7, 1.45)]
    for j, (yc, zc, ax_, ayu, ayd) in enumerate(RINGS):
        with tag("Own:portal_arch_%d" % j, Mh):
            K = 24 if LOW else 80
            az = np.linspace(0, 2 * math.pi, K, endpoint=False)
            oval = lambda sc_: np.stack([np.cos(az) * ax_ * sc_, yc + np.where(np.sin(az) > 0, np.sin(az) * ayu, np.sin(az) * ayd) * sc_], -1)
            q = np.stack([np.cos(az) * 3.0, np.sin(az) * 3.0, np.full(K, 7.0 + j)], -1)
            rag = 1.0 + 0.07 * NZ.fbm(q, 2)
            radii = [0.74, 0.86, 1.0, 1.16]
            front, back = [], []
            for ri, sc_ in enumerate(radii):
                o2 = oval(sc_ * (rag if ri == 0 else 1.0))
                zf = zc + 0.06 * math.sin(math.pi * ri / (len(radii) - 1)) + (0.03 if ri == 0 else 0.0)
                front.append(np.column_stack([o2, np.full(K, zf)]))
                back.append(np.column_stack([o2, np.full(K, zc - 0.12)]))
            Fr = np.array(front)
            Bk = np.array(back)
            nr = len(radii)
            V = np.vstack([Fr.reshape(-1, 3), Bk.reshape(-1, 3)])
            idx = np.arange(nr * K).reshape(nr, K)
            idn = np.roll(idx, -1, axis=1)
            qf = np.stack([idx[:-1], idn[:-1], idn[1:], idx[1:]], -1).reshape(-1, 4)
            qb = qf[:, ::-1] + nr * K
            inner = np.stack([idx[0], idn[0], idn[0] + nr * K, idx[0] + nr * K], -1)
            outer = np.stack([idx[-1], idx[-1] + nr * K, idn[-1] + nr * K, idn[-1]], -1)
            F = np.vstack([qf[:, ::-1], qb[:, ::-1], inner, outer])        # the crown frame is left-handed: flip the face-local winding
            A["Gum"].add(FW(V), F, m=0.1, d=0.15 + 0.2 * (2 - j))
            nt = max(9, int(round(2 * math.pi * math.sqrt((ax_ ** 2 + ayu * ayd) / 2) / 0.24)))
            ta = (np.arange(nt) + rc.uniform(0, 1)) / nt * 2 * math.pi
            for a_ in ta:
                if rc.random() < 0.1:
                    continue
                i_ = int(a_ / (2 * math.pi) * K) % K
                p_ = Fr[1, i_]
                ind = nrm(np.array([-p_[0], yc - p_[1], 0.0]) + 1e-6)
                dd = nrm(ind * 0.8 - np.array([0, 0, 1.0]) * 0.35 + np.array([0, 0, 1.0]) * 0.25 + np.array([rc.uniform(-0.15, 0.15), rc.uniform(-0.15, 0.15), 0]))
                Lt = rc.uniform(0.2, 0.4) * (1.15 - 0.15 * j)
                V2, F2, uv2, al2 = shard(FW(p_)[0], FD(dd), Lt, Lt * 0.18, hook_dir=FD(np.array([0, 0, -1.0])), hook=0.4,
                                         rings=5 if LOW else 9, sides=5 if LOW else 7, sink=0.04, fang=True, rr=rc)
                A["Teeth"].add(V2, F2, uv2, al2, d=0.15 * j)
                tips.append(V2[-1])
        piv("portal_arch_%d" % j, np.array([0.0, yc, zc]))

    # ------------------------------------------------------------------ the throat (a deep funnel through the neck), ember far down
    s_front = GULLET_S0
    GL = GULLET_L
    ss = np.linspace(s_front, s_front + GL, 50 if LOW else 150)
    Ot, Tt, Dt, St = [np.array(x) for x in zip(*[gullet_frame(x - s_front) for x in ss])]
    depth = ss - s_front
    rib = sum(np.exp(-((depth - z_) / 0.09) ** 2) for z_ in THROAT_RINGS)
    rbase = 0.82 * (1 - 0.12 * rib + 0.05 * np.sin(2 * math.pi * depth / 0.23 + 0.6) * (1 - rib))
    rbase = rbase * (1 - 0.8 * smoothstep(GL - 0.7, GL, depth))
    az = np.arange(18 if LOW else 40) * 2 * math.pi / (18 if LOW else 40)
    prof = np.array([np.stack([np.cos(az) * r_, np.sin(az) * r_], -1) for r_ in rbase])
    for gi, (j0, j1) in enumerate(((0, len(ss) // 5 + 1), (len(ss) // 5, len(ss) // 2 + 1), (len(ss) // 2, len(ss)))):
        sl = slice(j0, j1)
        V, F, uv, al = loft(Ot[sl], prof[sl], fr=(Tt[sl], St[sl], Dt[sl]), cap0=False, cap1=(gi == 2), nz_amp=0.08,
                            nz_freq=4.0, nz_seed=1.7 * gi, flip=False)
        dd_ = np.clip(((V - C) @ -T - 0.5) / GL, 0, 1)
        with tag("Own:gullet_%d" % gi, Mh):
            uvw(0.4)
            A["Gum"].add(V, F, uv, m=0.0, g=0.12 * smoothstep(0.55, 1.0, dd_), d=np.clip(dd_ ** 0.85 * 1.7, 0, 1))
    CROWN.update(throat_s=ss, throat_r=rbase)
    for gi in range(3):
        dzm = (0.1, 0.25, 0.65)[gi] * GL
        Og = gullet_frame(dzm)[0]
        rel = Og - C
        pivots["gullet_%d" % gi] = [round(float(rel @ S), 4), round(float(rel @ D), 4), round(float(-(rel @ T)), 4)]
    for ri_, dz0 in enumerate(THROAT_RINGS[2:]):
        nr = max(5, 9 - ri_ // 2)
        a0 = rc.uniform(0, 2 * math.pi)
        for q in range(nr):
            if rc.random() < 0.15:
                continue
            dz = dz0 + rc.uniform(-0.05, 0.05)
            a = a0 + 2 * math.pi * q / nr + rc.uniform(-0.12, 0.12)
            Oq, Tq, Dq, Sq = gullet_frame(dz)
            rq = float(np.interp(dz, depth, rbase))
            rd = math.cos(a) * Sq + math.sin(a) * Dq
            root = Oq + rd * (rq * 0.96)
            dd = nrm(-rd * 0.9 - Tq * 0.9 + np.cross(Tq, rd) * rc.uniform(-0.2, 0.2))
            Lt = (0.45 - 0.28 * dz / GL) * rc.uniform(0.6, 1.2)
            gi = 0 if dz < 0.9 else (1 if dz < 2.3 else 2)
            with tag("Own:gullet_%d" % gi, Mh):
                uvw(0.6)
                V, F, uv, al = shard(root, dd, Lt, Lt * 0.15, hook_dir=-Tq, hook=0.35, rings=4 if LOW else 8, sides=4 if LOW else 6,
                                     sink=0.06, fang=True, rr=rc)
                A["Teeth"].add(V, F, uv, al, d=dz / GL)
    Oe, Te, De, Se = gullet_frame(GL - 0.6)
    Oe = Oe + Se * 0.45 - De * 0.04
    with tag("Own:gullet_2", Mh):
        V, F = blob(Oe, basis_axes(Se, Te, De, 0.08, 0.13, 0.4), sub=1 if LOW else 3, amp=0.25, freq=5.0)
        A["Ember"].add(V, F, g=0.9)
    CROWN["forge"] = Oe
    CROWN["throat_light"] = gullet_frame(GL - 0.6)[0]
    CROWN["mouth_light"] = gullet_frame(1.0)[0]
    CROWN["mouth_light2"] = gullet_frame(2.8)[0]
    CROWN["mouth_front"] = FW(np.array([0.0, 0.4, FACE_Z0]))[0]

    # ------------------------------------------------------------------ the cranium: a cowl of flesh behind the mask, an ashlar vault
    with tag("Own:crown", Mh):
        uvw(0.42)
        K = 30 if LOW else 72
        az = np.arange(K) * 2 * math.pi / K
        st = [(0.0, 1.38, 1.0, 1.05), (-0.45, 1.6, 1.08, 1.0), (-1.05, 1.74, 1.12, 0.85), (-1.7, 1.66, 1.06, 0.55), (-2.35, 1.5, 0.94, 0.25)]
        rings = []
        for (zc_, rx_, ry_, yc_) in st:
            ryu = 2.15 * ry_
            ryd = 1.55 * ry_
            yv = np.where(np.sin(az) > 0, np.sin(az) * ryu, np.sin(az) * ryd)
            rings.append(np.stack([np.cos(az) * rx_, yc_ + yv, np.full(K, zc_ + FACE_Z0 - 0.75)], -1))
        G = np.array(rings)
        if not LOW:
            sub = []
            for a_, b_ in zip(G[:-1], G[1:]):
                for t_ in np.linspace(0, 1, 5, endpoint=False):
                    sub.append(a_ + (b_ - a_) * t_)
            sub.append(G[-1])
            G = np.array(sub)
        G = G + NZ.vec(G.reshape(-1, 3) * 1.6).reshape(G.shape) * 0.06
        zz_ = G[..., 2]
        fold = 1.0 + 0.055 * np.sin(np.arctan2(G[..., 1] - 1.0, G[..., 0]) * 11.0 + zz_ * 2.2) * smoothstep(0.2, -0.6, zz_)
        G = np.concatenate([G[..., :2] * fold[..., None] + (1 - fold[..., None]) * np.array([0.0, 1.0]), G[..., 2:]], -1)
        Gw = np.concatenate([G, G[:, :1]], 1)
        nR = len(Gw)
        Vc = FW(Gw.reshape(-1, 3))
        idx = np.arange(nR * (K + 1)).reshape(nR, K + 1)
        Fq = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
        A["Flesh"].add(Vc, Fq, m=0.08)
        uvw(0.9, True)
        # the head's flesh has grown over the mask's edge in places: lumpy wet masses bulging forward round the outline
        for (yq, sgn, rq) in ((2.75, 1, 0.45), (1.7, -1, 0.38), (-0.35, -1, 0.42), (0.2, 1, 0.34)):
            HALF[0] = sgn
            xq = float(face_outline(np.array([yq]), sgn)[0])
            zq = FACE_Z0 + float(face_relief(np.array([xq * 0.92]), np.array([yq]))[0]) - 0.05
            cq = np.array([sgn * xq * 0.97, yq, zq])
            nq = FD(nrm(np.array([sgn * 0.6, 0.0, 0.8])))
            Vb, Fb_ = blob(FW(cq)[0], basis_axes(FD(np.array([0, 1.0, 0])), np.cross(FD(np.array([0, 1.0, 0])), nq), nq,
                                                 rq * rc.uniform(1.0, 1.4), rq * 0.75, rq * 0.3), sub=2 if LOW else 4, amp=0.5,
                           freq=3.4 / rq, seed=rc.random() * 40)
            A["Flesh"].add(Vb, Fb_, m=0.3)
            HALF[0] = 0
        uvw(0.6, True)
        # the VEIL: the saint is hooded. Soot-black carved drapery frames the face, its folds raking back and down; the hem hangs past the
        # jaw on both sides and is open below (the throat and the flesh of the head show under it). Outer and inner shell, a rim round the
        # face, a ragged hem. Read at 30 m it is a hooded figure with a crown of thorns.
        HR = [(0.32, 1.84, 2.2, 1.22, -1.5), (-0.15, 2.04, 2.5, 1.12, -1.95), (-0.85, 2.14, 2.62, 1.0, -2.2), (-1.6, 2.03, 2.45, 0.86, -2.05),
              (-2.35, 1.74, 2.06, 0.64, -1.6)]          # (z, half width, arch height above yc, yc, hem y)
        nk = 26 if LOW else 110
        sub_ = 1 if LOW else 6
        prof_ = []
        for (zh, rxh, ryh, ych, yhem) in HR:
            ctrl = np.array([(-0.9 * rxh, yhem), (-rxh, 0.5 * (ych + yhem)), (-rxh, ych), (-0.84 * rxh, ych + 0.6 * ryh), (-0.45 * rxh, ych + 0.93 * ryh),
                             (0.0, ych + ryh), (0.45 * rxh, ych + 0.93 * ryh), (0.84 * rxh, ych + 0.6 * ryh), (rxh, ych), (rxh, 0.5 * (ych + yhem)),
                             (0.9 * rxh, yhem)])
            cc = catmull(np.column_stack([ctrl, np.zeros(len(ctrl))]), 8)
            prof_.append(np.column_stack([resample(cc, nk)[:, :2], np.full(nk, zh)]))
        prof_ = np.array(prof_)
        stations = []
        for a_, b_ in zip(prof_[:-1], prof_[1:]):
            for t_ in np.linspace(0, 1, sub_, endpoint=False):
                stations.append(a_ + (b_ - a_) * smoothstep(0, 1, t_))
        stations.append(prof_[-1])
        O_ = np.array(stations)                       # (ns, nk, 3) face-local
        ns = len(O_)
        sk = np.linspace(0, 1, nk)
        tg = np.gradient(O_[..., :2], axis=1)
        nrm2 = np.stack([tg[..., 1], -tg[..., 0]], -1)
        nrm2 = nrm2 / (np.linalg.norm(nrm2, axis=-1, keepdims=True) + 1e-9)
        cen2 = np.stack([np.zeros_like(O_[..., 0]), O_[..., 1] * 0 + 1.0], -1)
        sgn2 = np.sign(np.sum(nrm2 * (O_[..., :2] - cen2), -1, keepdims=True))
        nrm2 = nrm2 * np.where(sgn2 == 0, 1.0, sgn2)
        zz = O_[..., 2]
        rake = (FACE_Z0 - 0.75 + 0.4 - zz)
        # deep pleats radiating back from the face opening (sharp crests, broad troughs), uneven in depth, plus a heavy slump
        ph_ = math.pi * 9.0 * sk[None, :] + 1.1 * rake + 0.45 * np.sin(sk[None, :] * 17.0)
        fold = np.abs(np.sin(ph_)) ** 0.35 - 0.55
        fold = fold * (0.75 + 0.5 * np.abs(np.sin(sk[None, :] * 7.3 + 1.0)))
        famp = 0.1 + 0.24 * smoothstep(0.32, -0.7, zz)
        q = O_.reshape(-1, 3)
        rag = NZ.fbm(q * 1.1 + 4.0, 3).reshape(zz.shape)
        off = famp * fold + 0.09 * rag
        O_ = O_ + np.concatenate([nrm2 * off[..., None], np.zeros_like(zz)[..., None]], -1)
        # the hem: ragged, hanging lower at the back, a torn lappet on the left
        hemw = smoothstep(0.12, 0.0, sk) + smoothstep(0.88, 1.0, sk)
        drop = hemw[None, :] * (0.25 * np.abs(NZ.fbm(np.column_stack([sk * 9.0, np.full(nk, 2.0), np.zeros(nk)]), 2))[None, :] + 0.12 * smoothstep(0.3, -1.4, zz))
        O_[..., 1] = O_[..., 1] - drop
        I_ = O_.copy()
        I_[..., :2] = I_[..., :2] - nrm2 * (0.08 + 0.05 * smoothstep(0.32, -0.3, zz))[..., None]
        V = np.vstack([O_.reshape(-1, 3), I_.reshape(-1, 3)])
        idx = np.arange(ns * nk).reshape(ns, nk)
        NI = ns * nk
        # winding: reversed from the face-local outward order (the crown frame is left-handed)
        Fo = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1).reshape(-1, 4)
        Fi = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4) + NI
        rim = np.stack([idx[0, :-1], idx[0, 1:], idx[0, 1:] + NI, idx[0, :-1] + NI], -1)
        back_ = np.stack([idx[-1, :-1] + NI, idx[-1, 1:] + NI, idx[-1, 1:], idx[-1, :-1]], -1)
        hemL = np.stack([idx[:-1, 0] + NI, idx[1:, 0] + NI, idx[1:, 0], idx[:-1, 0]], -1)
        hemR = np.stack([idx[:-1, -1], idx[1:, -1], idx[1:, -1] + NI, idx[:-1, -1] + NI], -1)
        A["Carved"].add(FW(V), [Fo, Fi, rim, back_, hemL, hemR], m=0.0)
        # where the arms and the climber break through the veil, and under the hem: the flesh of the head
        for (cq, rq) in (((-2.08, -0.55, -0.62), 0.32), ((-2.12, 1.15, -0.78), 0.3), ((-1.0, 3.5, -0.9), 0.3), ((2.05, 2.0, -0.78), 0.3),
                         ((2.08, -0.35, -0.62), 0.32), ((-2.0, 2.15, -0.8), 0.36), ((-1.75, -1.9, -0.6), 0.4), ((1.8, -2.0, -0.8), 0.42)):
            nq = FD(nrm(np.array([cq[0], cq[1] - 1.0, 0.3])))
            Vb, Fb_ = blob(FW(np.array(cq))[0], basis_axes(perp(nq), np.cross(nq, perp(nq)), nq, rq, rq * 0.85, rq * 0.5), sub=2 if LOW else 4,
                           amp=0.45, freq=3.0 / rq, seed=rc.random() * 40)
            A["Flesh"].add(Vb, Fb_, m=0.45)
        uvw(0.8, True)
        # the mask is nailed to the head: a few big iron staples across the seam (crude, bent, irregular)
        for sgn in (-1, 1):
            HALF[0] = sgn
            Hh = halves[sgn]
            Xo, Yo, Zo = Hh["X"][-1], Hh["Y"][-1], Hh["Z"][-1]
            for i in sorted(rc.sample(range(3, len(Yo) - 3), 4)):
                p_ = np.array([sgn * Xo[i], Yo[i], Zo[i] - 0.03])
                tg = nrm(np.array([sgn * (Xo[i + 1] - Xo[i - 1]), Yo[i + 1] - Yo[i - 1], 0.0]))
                outw = nrm(np.array([sgn * 1.0, 0.0, -0.7]))
                a_ = p_ - outw * 0.16
                b_ = p_ + outw * 0.24
                bend = rc.uniform(-0.04, 0.04)
                st_ = np.array([a_ - np.array([0, 0, 0.12]), a_ + np.array([0, 0, 0.05]), (a_ + b_) / 2 + np.array([0, 0, 0.09]) + tg * bend,
                                b_ + np.array([0, 0, 0.05]), b_ - np.array([0, 0, 0.12])])
                A["Iron"].add_tube(FW(resample(catmull(st_, 4), 8 if LOW else 20)), 0.03, sides=4 if LOW else 8, m=0.0)
        HALF[0] = 0
    # sinews stretched across the crack in the forehead (the halves pull them taut; two have torn); each half of a sinew rides
    # its own door, so they part when the face opens
    for q in range(7):
        if True:                                  # (one sinew)
            y_ = 2.3 + q * 0.13 + rc.uniform(-0.04, 0.04)
            g_ = float(face_gap(np.array([y_]))[0])
            zl = FACE_Z0 + float(face_relief(np.array([g_ + 0.05]), np.array([y_]))[0]) - 0.07
            a_ = np.array([-(g_ + 0.06), y_ + rc.uniform(-0.05, 0.05), zl])
            b_ = np.array([g_ + 0.06, y_ + rc.uniform(-0.05, 0.05), zl])
            n_ = 4 if LOW else 12
            P_ = np.array([a_ + (b_ - a_) * t_ + np.array([0, -0.015 * math.sin(math.pi * t_), 0]) for t_ in np.linspace(0, 1, n_)])
            h_ = n_ // 2
            torn = q in (2, 5)
            for side_name, P2 in (("L", P_[:h_ + 1]), ("R", P_[-h_ - 1:][::-1])):
                t2 = np.linspace(0, 1, len(P2))
                if torn:              # two ragged ends curling back toward the stone
                    P2 = P2[: max(2, len(P2) - 1)] + np.array([0, -0.05, 0.03])[None] * np.linspace(0, 1, max(2, len(P2) - 1))[:, None] ** 2
                    t2 = np.linspace(0, 1, len(P2))
                    r2 = 0.018 * (1 - 0.7 * t2)
                else:
                    r2 = 0.02 * (1.0 - 0.45 * np.sin(0.5 * math.pi * t2))
                HALF[0] = -1 if side_name == "L" else 1
                with tag("Own:portal_comb_%s0" % side_name, Mh):
                    A["Tendon"].add_tube(FW(P2), r2, sides=4 if LOW else 6, cap0=False, cap1=torn)
                HALF[0] = 0
    with tag("Own:crown", Mh):
        uvw(0.32)
        # neck: flesh collar to the first vertebra
        ss_n = np.linspace(RING_S + 0.7, RING_S + 2.4, 6 if LOW else 14)
        On, Tn, Dn, Sn = spine_frames(ss_n)
        t = np.linspace(0, 1, len(ss_n))
        rr = 1.65 - 0.2 * t
        Bn = np.cross(Tn, Sn)
        c_ = circle_prof(30)
        prof = np.stack([c_[None, :, 0] * rr[:, None], c_[None, :, 1] * rr[:, None] * 0.85], -1)
        V, F, uv, al = loft(On, prof, fr=(Tn, Sn, Bn), cap0=False, cap1=False, nz_amp=0.13, nz_freq=2.5)
        A["Flesh"].add(V, F, uv, m=0.1)
        uvw(0.8, True)
        # under the jaw: pale ribs of the throat showing through the stretched skin of the neck (seen from below)
        for q in range(5):
            zq = FACE_Z0 - 1.25 - 0.4 * q
            arc_ = np.array([[math.cos(a_) * (1.25 - 0.05 * q), -0.95 + 0.15 * q + math.sin(a_) * 1.1, zq + 0.12 * math.sin(a_ * 2)]
                             for a_ in np.linspace(math.radians(200), math.radians(340), 6 if LOW else 16)])
            V, F, uv, al = tube(FW(arc_), 0.07 - 0.006 * q, sides=5 if LOW else 9, ry=0.045, cap0=True, cap1=True,
                                nz_amp=0.1, nz_freq=6.0, seed=rc.random() * 9)
            A["Bone"].add(V, F, uv, m=al)

    # ------------------------------------------------------------------ the halo: a broken rose window behind the head, thorns
    with tag("Own:crown", Mh):
        uvw(0.55)
        Hc = np.array([0.0, 1.85, FACE_Z0 - 2.7])
        hn = nrm(np.array([0.0, 0.38, 1.0]))
        hu = np.array([1.0, 0.0, 0.0])
        hv = np.cross(hn, hu)
        RH, WH, DH = 3.55, 0.52, 0.44

        def hl(a, r, z=0.0):
            a = np.atleast_1d(np.asarray(a, float))
            r = np.broadcast_to(np.asarray(r, float), a.shape)
            z = np.broadcast_to(np.asarray(z, float), a.shape)
            return Hc[None] + np.outer(r * np.cos(a), hu) + np.outer(r * np.sin(a), hv) + np.outer(z, hn)

        # the arch itself: a moulded stone rib (a pointed, filleted section, not a pipe) broken into three pieces, an inner order of
        # cusped tracery inside it; rebar where it snapped
        prof_h = np.array([(0.0, 0.2), (0.07, 0.13), (0.15, 0.12), (0.16, 0.0), (0.15, -0.12), (0.07, -0.13), (0.0, -0.2),
                           (-0.07, -0.13), (-0.15, -0.12), (-0.16, 0.0), (-0.15, 0.12), (-0.07, 0.13)]) * np.array([1.0, 1.25])
        for (a0d, a1d, rr_, sc_) in ((-10.0, 48.0, RH, 0.72), (84.0, 138.0, RH, 0.72), (168.0, 214.0, RH, 0.72),
                                     (12.0, 64.0, RH - 0.55, 0.45), (108.0, 160.0, RH - 0.55, 0.45)):
            aa = np.radians(np.linspace(a0d + rc.uniform(-3, 3), a1d + rc.uniform(-3, 3), 9 if LOW else 40))
            Pa = hl(aa, rr_ + 0.04 * np.sin(aa * 5.0), 0.0)
            Tn_ = np.gradient(Pa, axis=0)
            Tn_ = Tn_ / np.linalg.norm(Tn_, axis=1, keepdims=True)
            Nn_ = np.broadcast_to(hn, Pa.shape)
            Bn_ = np.cross(Nn_, Tn_)          # N x T: right-handed once mapped through the (left-handed) crown frame
            V, F, uv, al = loft(FW(Pa), prof_h * sc_ * 1.15, fr=(np.array([FD(t_) for t_ in Tn_]), np.array([FD(n_) for n_ in Nn_]),
                                                                 np.array([FD(b_) for b_ in Bn_])),
                                cap0=True, cap1=True, nz_amp=0.06, nz_freq=4.0, nz_seed=rc.random() * 9)
            A["Carved"].add(V, F, uv, m=0.0)
            for end in (Pa[0], Pa[-1]):
                if rc.random() < 0.6:
                    rebar(FW(end)[0], FD(nrm(end - Hc) + hn * rc.uniform(-0.4, 0.4)), rc.uniform(0.3, 0.6), FD(-hn), 0.3, 0.018)
        # trefoil cusps on the inner order (pointing in)
        for k in range(9):
            a_ = math.radians(10 + 165 * k / 8 + rc.uniform(-4, 4))
            root = FW(hl(a_, RH - 0.65, 0.0))[0]
            ind = FW(hl(a_, 1.0, 0.0))[0] - root
            V, F, uv, al = shard(root, nrm(ind), rc.uniform(0.25, 0.4), 0.08, hook_dir=FD(hn), hook=0.2, rings=4 if LOW else 7,
                                 sides=4, sink=0.04, rr=rc)
            A["Carved"].add(V, F, uv, m=0.0)
        # thorns: long, raked back, gilded at the tips; longest at the top, two snapped
        for k in range(12):
            a_ = math.radians(-12 + 205 * k / 11 + rc.uniform(-4, 4))
            if 4 <= k <= 5:
                continue
            top_ = math.sin(a_)
            L_ = (1.0 + 1.9 * max(top_, 0.0) ** 1.5) * rc.uniform(0.7, 1.15)
            root = FW(hl(a_, RH - 0.06, 0.0))[0]
            outd = FD(nrm(np.array([math.cos(a_), math.sin(a_) * 0.95, 0.0]) @ np.array([hu, hv, hn]) - hn * 0.35))
            br = k in (2, 9)
            V, F, uv, al = shard(root, outd, L_, 0.16, hook_dir=-FD(hn), hook=0.28, rings=5 if LOW else 9, sides=5,
                                 sink=0.08, trunc=rc.uniform(0.45, 0.65) if br else 1.0, rr=rc)
            A["Carved"].add(V, F, uv, m=np.clip((al - 0.55) / 0.45, 0, 1))
        # mullions: broken radial spokes from the ring to the skull
        for k in range(7):
            a_ = math.radians(15 + 150 * k / 6 + rc.uniform(-5, 5))
            if k == 4:
                continue
            p0_ = FW(hl(a_, 1.6, -0.1))[0]
            p1_ = FW(hl(a_, RH - 0.6, 0.0))[0]
            if k in (1, 5):
                p1_ = p0_ + (p1_ - p0_) * rc.uniform(0.45, 0.65)
            ln_ = np.linalg.norm(p1_ - p0_)
            bm = stone_bm((0.15, 0.19, ln_), chamfer=0.25, wear=0.01, chips=rc.randint(1, 2), subdiv=1, rr=rc)
            zz_ = nrm(p1_ - p0_)
            xx_ = nrm(np.cross(zz_, FD(hn)))
            yy_ = np.cross(zz_, xx_)
            co = np.array([v.co[:] for v in bm.verts])
            place(bm, (p0_ + p1_) / 2 + np.outer(co[:, 0], xx_) + np.outer(co[:, 1], yy_) + np.outer(co[:, 2], zz_))
            A["Stone"].add_bm(bm)
        CROWN["thorns"] = []

    # ------------------------------------------------------------------ five statue arms round the face, too-long hands
    ARMS = [  # shoulder, elbow, wrist (face-local), back of the hand, size, curl, spread
        ((-1.55, -0.2, -0.95), (-2.7, -0.95, -0.2), (-1.85, -1.55, 1.25), (-0.4, -0.2, -1.0), 1.0, [0.42, 0.5, 0.55, 0.62], 0.3),
        ((-1.7, 1.3, -1.1), (-3.0, 1.1, -0.35), (-2.25, 0.85, 1.25), (-0.5, 0.4, -0.8), 1.05, [0.3, 0.38, 0.45, 0.55], 0.35),
        ((-0.9, 3.0, -1.2), (-1.85, 3.9, -0.55), (-1.25, 3.55, 0.95), (-0.3, 0.8, -0.5), 0.95, [0.55, 0.6, 0.62, 0.66], 0.25),
        ((1.5, 2.2, -1.1), (2.75, 2.75, -0.35), (2.1, 2.2, 1.15), (0.5, 0.6, -0.7), 1.05, [0.35, 0.42, 0.5, 0.6], 0.32),
        ((1.55, -0.1, -0.95), (2.75, -0.7, -0.15), (2.0, -1.25, 1.25), (0.4, -0.3, -1.0), 1.0, [0.5, 0.56, 0.6, 0.66], 0.28),
    ]
    for ai, (sh_, el_, wr_, bk_, sz_, curl_, spr_) in enumerate([] if 'arms' in OMIT else ARMS):
        sh_w, el_w, wr_w = FW(np.array([sh_, el_, wr_]))
        tps = bone_arm(sh_w, el_w, wr_w, FD(nrm(np.array(bk_))), sz_, ("arm_%d_0" % ai, "arm_%d_1" % ai), Mh, rc, curl_, spr_)
        tips.extend(tps)
        piv("arm_%d_0" % ai, np.array(sh_))
        piv("arm_%d_1" % ai, np.array(wr_))

    # ------------------------------------------------------------------ the climber the face is eating; his rope in the teeth
    with tag("Own:crown", Mh):
        uvw(1.3)
        pel = FW(np.array([-1.95, 2.15, -0.85]))[0]
        upw = FD(nrm(np.array([-0.75, 0.55, 0.45])))
        fw_ = FD(nrm(np.array([-0.2, 0.2, 1.0])))
        human_figure(pel, upw, fw_, 1.0, rc, FD(nrm(np.array([-0.3, 0.1, 1.0]))), A["Skin"])
    with tag("Own:portal_hinge_0", Mh):
        jt0, _ = jawT(-1)
        top = FW(jt0(np.array([-0.5, Y_LIPE - 0.12, FACE_Z0 - 0.35])))[0]
        n_, Lr_ = (8, 2.6) if LOW else (40, 2.6)
        tt = np.linspace(0, 1, n_)
        sway = NZ.vec(top[None] * 2.0)[0] * 0.15
        R_ = top[None] + DOWN[None] * (Lr_ * tt)[:, None] + sway[None] * (tt ** 2)[:, None] + FD(np.array([0, 0, 0.25])) * (np.sin(math.pi * tt * 0.5))[:, None]
        A["Rope"].add_tube(R_, 0.022, sides=5 if LOW else 8, cap0=True, cap1=True, m=tt * 0.5)

    # ------------------------------------------------------------------ drool (render only)
    tp = list(tips)
    for k in range(10):
        a_, b_ = rc.sample(tp, 2)
        if np.linalg.norm(a_ - b_) > 1.4 or np.linalg.norm(a_ - b_) < 0.15:
            continue
        strand(a_, b_, rc.uniform(0.2, 0.6), rc.uniform(0.012, 0.03))
    for p_ in tp[::3]:
        if rc.random() < 0.3:
            hang_strand(p_, rc.uniform(0.15, 0.9), rc.uniform(0.012, 0.03), A["Mucus"])

    CROWN["tips"] = np.array(tips) if tips else np.array([C + T * 0.3])
    CROWN["pivots"] = pivots
    CROWN["face"] = dict(FL=FL, FW=FW, o=FW(np.zeros(3))[0], x=FD(np.array([1.0, 0, 0])), y=FD(np.array([0, 1.0, 0])),
                         z=FD(np.array([0, 0, 1.0])))


def build_tether(thorn):
    """The previous climber: his three-prong grapple (the tool the player throws) snagged over a thorn of the
    crown, the rope still knotted to what is left of him - harness around a pelvis, one leg in its boot, the
    helmet swinging from its chin strap with a dead lamp."""
    a, base, dd, L = thorn
    c0 = base + dd * L * 0.62
    t0 = dd
    eu = nrm(UP - UP.dot(t0) * t0)
    es = np.cross(t0, eu)
    rad = 0.13
    ang = np.radians(np.linspace(-55, 215, 30))
    prong = c0[None] + rad * (np.cos(ang)[:, None] * es[None] + np.sin(ang)[:, None] * eu[None])
    G0 = prong[0]
    tt = np.linspace(0, 1, len(prong))
    A["Iron"].add_tube(prong, 0.024 * (1 - tt) ** 0.6 + 0.004, sides=7, cap1=False, m=tt, g=0.0)
    shank_end = G0 + DOWN * 0.42
    A["Iron"].add_tube(np.array([G0, shank_end]), 0.026, sides=8, m=0.0)
    out0 = nrm(prong[3] - G0)
    for sg in (-1, 1):
        d2 = rot(DOWN, sg * math.radians(120)) @ nrm(out0 - out0.dot(DOWN) * DOWN + 1e-6)
        Pp = bezier([G0, G0 + d2 * 0.16 + UP * 0.02, G0 + d2 * 0.25 + DOWN * 0.1, G0 + d2 * 0.18 + DOWN * 0.23], 16)
        ts = np.linspace(0, 1, 16)
        A["Iron"].add_tube(Pp, 0.022 * (1 - ts) ** 0.6 + 0.004, sides=6, cap1=False, m=ts)
    e1 = perp(DOWN)
    eye = shank_end + DOWN * 0.05 + 0.05 * (np.cos(np.linspace(0, 2 * math.pi, 16))[:, None] * e1
                                           + np.sin(np.linspace(0, 2 * math.pi, 16))[:, None] * UP)
    A["Iron"].add_tube(eye, 0.012, sides=6, cap0=False, cap1=False, m=0.0)
    # rope down to the body, gently swaying
    top = shank_end + DOWN * 0.09
    n, Lr = 50, 1.35
    sway = NZ.vec(top[None] * 2.0)[0] * 0.12
    tt = np.linspace(0, 1, n)
    R = top[None] + DOWN[None] * (Lr * tt)[:, None] + sway[None] * (tt ** 2)[:, None]
    A["Rope"].add_tube(R, 0.017, sides=8, cap0=True, cap1=False, m=tt * 0.5)
    V, F = blob(top, basis_axes(e1, np.cross(DOWN, e1), UP, 0.04, 0.04, 0.055), sub=2, amp=0.25)
    A["Rope"].add(V, F, m=0.5)
    hip = R[-1] + DOWN * 0.12
    fwd = nrm(np.cross(UP, e1))
    tilt = rot(e1, 0.35)
    bx, by, bz = tilt @ e1, tilt @ fwd, tilt @ UP
    # harness: waist belt (flat webbing) + leg loops + belay loop up to the rope
    th = np.linspace(0, 2 * math.pi, 30)
    belt = hip + 0.16 * (np.cos(th)[:, None] * bx + 0.8 * np.sin(th)[:, None] * by)
    A["Rope"].add_tube(belt, 0.03, ry=0.008, up=bz, sides=6, cap0=False, cap1=False, m=0.9)
    A["Rope"].add_tube(np.array([R[-1], hip + by * 0.13]), 0.012, sides=6, m=0.9)
    for sx in (-1, 1):
        lc = hip + bx * sx * 0.08 - bz * 0.13
        loop = lc + 0.085 * (np.cos(th)[:, None] * bx + np.sin(th)[:, None] * by)
        A["Rope"].add_tube(loop, 0.02, ry=0.006, up=bz, sides=6, cap0=False, cap1=False, m=0.9)
    # pelvis: iliac wings, sacrum, a socket with the femur still in it
    for sx in (-1, 1):
        V, F = blob(hip + bx * sx * 0.085 + bz * 0.03, basis_axes(nrm(bx * sx + by * 0.3), by, bz, 0.075, 0.03, 0.09),
                    sub=2, amp=0.2, freq=9.0)
        A["Bone"].add(V, F, m=0.2)
    V, F = blob(hip - by * 0.06, basis_axes(bx, by, bz, 0.05, 0.035, 0.08), sub=2, amp=0.15, freq=9.0)
    A["Bone"].add(V, F, m=0.2)
    knee = hip + bx * 0.09 - bz * 0.42 + by * 0.05
    ankle = knee + DOWN * 0.38 + by * 0.04
    A["Bone"].add_tube(np.array([hip + bx * 0.09 - bz * 0.04, knee]), np.array([0.026, 0.02]), sides=8, m=np.array([0.0, 1.0]))
    V, F = blob(knee, basis_axes(bx, by, bz, 0.035, 0.032, 0.03), sub=2, amp=0.1)
    A["Bone"].add(V, F, m=1.0)
    A["Bone"].add_tube(np.array([knee, ankle]), np.array([0.02, 0.017]), sides=8, m=np.array([0.0, 1.0]))
    # the boot: rough leather loft, toe pointing down
    tdir = nrm(by * 0.9 + DOWN * 0.6)
    bp = np.array([ankle + UP * 0.12, ankle, ankle + tdir * 0.1 + DOWN * 0.05, ankle + tdir * 0.26 + DOWN * 0.05])
    A["Rope"].add_tube(resample(bp, 10), np.array([0.05, 0.058, 0.062, 0.056, 0.052, 0.05, 0.048, 0.044, 0.038, 0.02]),
                       ry=np.array([0.05, 0.055, 0.05, 0.045, 0.04, 0.038, 0.036, 0.034, 0.03, 0.02]), sides=10, m=0.95)
    # helmet on its chin strap, dead lamp on the front
    hc = hip - bx * 0.2 + DOWN * 0.55 + by * 0.08
    A["Rope"].add_tube(sag_path(hip - bx * 0.15, hc + UP * 0.1, 0.0, 8), 0.006, sides=4, m=0.9)
    prof = [(0.0, 0.13), (0.06, 0.125), (0.1, 0.1), (0.125, 0.06), (0.135, 0.02), (0.15, 0.0), (0.15, -0.01),
            (0.125, -0.008), (0.115, 0.02), (0.105, 0.055), (0.085, 0.085), (0.05, 0.11), (0.0, 0.115)]
    hax = nrm(UP + by * 0.6 + bx * 0.4)
    V, F = lathe(prof, hc, hax, 24)
    A["Iron"].add(V, F, m=0.3, g=0.0)
    hf = nrm(perp(hax))
    lamp = hc + hax * 0.07 + hf * 0.12
    V, F, uv, al = tube(np.array([lamp - hf * 0.02, lamp + hf * 0.05]), 0.032, sides=12)
    A["Iron"].add(V, F, uv, m=0.0)
    V, F = blob(lamp + hf * 0.05, basis_axes(perp(hf), np.cross(hf, perp(hf)), hf, 0.026, 0.026, 0.008), sub=2, amp=0.0)
    A["Glass"].add(V, F, m=0.0, g=0.0)
    # the creature's slime run down the rope and the bones
    for _ in range(3):
        hang_strand(hip + bx * rng.uniform(-0.12, 0.12) - bz * 0.05, rng.uniform(0.2, 0.7), 0.008, A["Mucus"])
    hang_strand(R[n // 2], 0.4, 0.006, A["Oil"])
    CROWN["tether"] = (c0, hip)


# =============================================================================
# Scale cues: Lanternwright cage fused into the back, ladder skewering the neck
# =============================================================================
def build_cage(v, sgn=1.0):
    """Rusted Lanternwright cage fused into the flank on the side the player sees, a dead man folded inside
    (skull, ribs, an arm through the bars), a lantern still smouldering, tendons wrapped round the bars."""
    O, T, D, S = spine_frame(v["s"] + v["Lb"] * 0.4)
    side = S * sgn
    up = nrm(D * 0.75 + side * 0.65 - T * 0.25)
    sd = perp(up)
    fwd = np.cross(up, sd)
    base = O + D * (v["H"] * 0.18) + side * (v["W"] * 0.42) - up * 0.1
    rad, hgt = 0.48, 1.7
    nb = 14
    for j in range(nb):
        a = 2 * math.pi * j / nb
        dr = math.cos(a) * sd + math.sin(a) * fwd
        pts = []
        for h in np.linspace(0, hgt, 9):
            bow = 0.22 * math.sin(math.pi * h / hgt) if j in (0, 1) else 0.0
            pts.append(base + dr * (rad + bow) + up * h)
        for ang in np.linspace(0, math.pi / 2, 7)[1:]:
            pts.append(base + up * (hgt + math.sin(ang) * 0.4) + dr * rad * math.cos(ang) * 0.98 + dr * 0.006)
        if j == 5:
            pts = pts[:6]
        A["Iron"].add_tube(np.array(pts), 0.016, sides=6, m=0.0)
    for h in (0.0, 0.57, 1.14, hgt):
        ring = base + up * h + rad * (np.cos(np.linspace(0, 2 * math.pi, 36))[:, None] * sd + np.sin(np.linspace(0, 2 * math.pi, 36))[:, None] * fwd)
        A["Iron"].add_tube(ring, 0.016, ry=0.034, up=up, sides=6, cap0=False, cap1=False, m=0.0)
    top = base + up * (hgt + 0.4)
    loop = top + up * 0.1 + 0.1 * (np.cos(np.linspace(0, 2 * math.pi, 16))[:, None] * sd + np.sin(np.linspace(0, 2 * math.pi, 16))[:, None] * up)
    A["Iron"].add_tube(loop, 0.022, sides=6, cap0=False, cap1=False, m=0.0)
    lan = top - up * 0.6
    chain(np.array([top, lan + up * 0.18]), 0.5)
    for j in range(6):
        a = 2 * math.pi * j / 6
        dr = math.cos(a) * sd + math.sin(a) * fwd
        A["Iron"].add_tube(np.array([lan + dr * 0.08 + up * 0.15, lan + dr * 0.1, lan + dr * 0.08 - up * 0.15]), 0.008, sides=4, m=0.0)
    V, F = blob(lan, basis_axes(sd, fwd, up, 0.045, 0.045, 0.075), sub=2, amp=0.1)
    A["Ember"].add(V, F, g=0.35)
    LANTERN["cage"] = lan
    # the occupant: slumped skeleton
    pel = base + up * 0.32 + fwd * 0.12
    spine_top = base + up * 1.05 - fwd * 0.08 + sd * 0.06
    A["Bone"].add_tube(bezier([pel, (pel + spine_top) / 2 - fwd * 0.08, spine_top], 12), 0.022, sides=6, m=0.3)
    for i in range(6):
        f = 0.3 + 0.12 * i
        c = pel + (spine_top - pel) * f
        for sx in (-1, 1):
            arc = np.array([c + sd * sx * 0.13 * math.sin(t_) + fwd * (0.11 - 0.22 * (t_ / math.pi)) * 0.9 + up * (-0.05 * math.sin(t_))
                            for t_ in np.linspace(0.15, math.pi * 0.85, 9)])
            A["Bone"].add_tube(arc, 0.011, sides=5, m=0.5)
    sk = spine_top + up * 0.13 + fwd * 0.06 - sd * 0.05
    V, F = blob(sk, basis_axes(sd, fwd, up, 0.085, 0.105, 0.1), sub=3, amp=0.06, freq=6.0)
    A["Bone"].add(V, F, m=0.6)
    for sx in (-1, 1):
        V, F = blob(sk + fwd * 0.085 + sd * sx * 0.033 + up * 0.01, basis_axes(sd, fwd, up, 0.022, 0.02, 0.02), sub=2, amp=0.0)
        A["Soot"].add(V, F)
    V, F = blob(sk + fwd * 0.05 - up * 0.08, basis_axes(sd, fwd, up, 0.06, 0.06, 0.03), sub=2, amp=0.1)
    A["Bone"].add(V, F, m=0.6)
    sh = spine_top + sd * 0.15
    hand = base + sd * (rad + 0.35) + up * 0.55 + fwd * 0.1
    elbow = (sh + hand) / 2 + up * 0.08
    A["Bone"].add_tube(np.array([sh, elbow]), 0.016, sides=6, m=0.4)
    A["Bone"].add_tube(np.array([elbow, hand]), 0.012, sides=6, m=0.4)
    for f_ in range(4):
        d_ = nrm(DOWN + sd * 0.3 + fwd * (f_ - 1.5) * 0.25)
        A["Bone"].add_tube(np.array([hand, hand + d_ * 0.06, hand + d_ * 0.1 + DOWN * 0.03]), 0.005, sides=4, m=0.6)
    # flesh engulfing the cage foot; tendons wrapping bars; veins
    V, F = blob(base + up * 0.1, basis_axes(sd, fwd, up, 0.85, 0.8, 0.42), sub=4, amp=0.22, freq=2.2)
    A["Flesh"].add(V, F, m=0.2)
    for j in range(7):
        a = 2 * math.pi * (j * 2) / nb
        dr = math.cos(a) * sd + math.sin(a) * fwd
        tdr = np.cross(up, dr)
        h1 = rng.uniform(0.4, 1.3)
        t = np.linspace(0, 1, 40)
        hel = base[None] + dr[None] * rad + up[None] * (h1 * t)[:, None] + (dr[None] * np.cos(t * 14)[:, None] + tdr[None] * np.sin(t * 14)[:, None]) * 0.03
        A["Tendon"].add_tube(hel, 0.014 * (1.3 - t), sides=5, cap0=False)
    for j in range(4):
        a = rng.uniform(0, 2 * math.pi)
        dr = math.cos(a) * sd + math.sin(a) * fwd
        P = np.array([base + dr * rad * 0.8 + up * h + np.cross(up, dr) * 0.04 * math.sin(h * 9) for h in np.linspace(0.1, rng.uniform(0.8, 1.6), 20)])
        A["Vein"].add_tube(P, 0.01, sides=5, g=0.0)
    pierce(base + sd * 0.4 + up * 0.3, sd + DOWN, 2.6, hook=True, scale=0.9)
    CROWN["cage"] = base


def build_ladder(v, sgn=1.0):
    """An iron service ladder run clean through the neck, both ends sticking out past the crown."""
    O, T, D, S = spine_frame(v["s"])
    along = nrm(S * sgn * 1.0 - T * 0.3 + D * 0.35)
    across = nrm(np.cross(along, D))
    p0 = O - along * 2.9 + D * 0.62
    length, wdt = 5.8, 0.48
    t = np.linspace(0, 1, 44)
    for sgn2 in (-1, 1):
        P = p0[None] + along[None] * (length * t)[:, None] + across[None] * sgn2 * wdt / 2
        P += (D * 0.35)[None] * (t ** 2)[:, None] + (T * -0.25)[None] * (t ** 3)[:, None]
        if sgn2 > 0:
            P = P[:39]
        A["Iron"].add_tube(P, 0.026, ry=0.009, up=across, sides=4, m=0.0)
    for i, tt in enumerate(np.arange(0.03, 0.97, 0.058)):
        if i in (5, 6, 7, 8, 9):
            continue  # rungs inside the neck
        if i == 12:
            continue
        a = p0 + along * length * tt + (D * 0.35) * tt ** 2 + (T * -0.25) * tt ** 3
        P = np.array([a - across * wdt / 2, a + across * wdt / 2])
        if i == 14:
            P = bezier(np.array([a - across * wdt / 2, a - across * 0.05 + D * 0.12, a + across * 0.1 + D * 0.3]), 8)
        A["Iron"].add_tube(resample(P, 6), 0.017, sides=6, m=0.0)
    for sgn2 in (-1, 1):
        exitp = O + along * sgn2 * 1.55
        V, F = blob(exitp, basis_axes(along, across, D, 0.4, 0.45, 0.35), sub=3, amp=0.25, freq=3.0)
        A["Flesh"].add(V, F, m=0.6, g=0.0)
        for q in range(4):
            a = exitp + across * rng.uniform(-0.3, 0.3)
            b = exitp + along * sgn2 * rng.uniform(0.4, 0.9) + across * rng.uniform(-0.25, 0.25)
            A["Tendon"].add_tube(sag_path(a, b, 0.05, 10), 0.02, sides=6, cap0=False, cap1=False)
        hang_strand(exitp + along * sgn2 * 0.3 + DOWN * 0.1, rng.uniform(0.4, 1.2), 0.014, A["Oil"])


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
        A["Marrow"].add(V2, F2, g=0.05)
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
        A["Marrow"].add(V2, F2, g=0.0)


def _build_tail(v):
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
def build_vertebra(idx, s, k):
    O, T, D, S = spine_frame(s)
    with tag("Seg%d" % idx, mat4(S, T, D, O)):
        _build_vertebra(idx, s, k)


def build_disc(va, vb):
    with tag("Seg%d" % va["idx"], va["M"]):
        _build_disc(va, vb)


def grapnel(Aj, F, nout, side_vec, Dv, k, planted=True):
    with tag("Hook", frame_zx(Aj, F - Aj, np.cross(F - Aj, Dv))):
        return _grapnel(Aj, F, nout, side_vec, Dv, k, planted)


LEG_FRAME = {}


def build_leg(v, sigma, kind="normal", size=1.0, droot=0.0, lantern=False):
    """Tagged wrapper: the strut + knee pier are Mason_LimbUpper (pivot at the flank joint, bone along +Z, pin +X);
    from the knee down is Mason_LimbLower (pivot at the knee); the grapnel is Mason_Hook."""
    O, T, D, S = spine_frame(v["s"] + droot)
    LEG_FRAME.clear()
    with tag("LegU", np.eye(4)):
        i0 = len(PARTS) - 1
        _build_leg(v, sigma, kind, size, droot, lantern)
    L = LEG_LOG[-1] if LEG_LOG and LEG_LOG[-1].get("_tagged") is None else None
    if L is not None:
        L["_tagged"] = True
        K, J = L["K"], L.get("J", L["F"])
        side = S * sigma
        upa = nrm(D + side * 0.22)
        R0 = O + side * (0.4 * v["W"]) + D * (0.08 * v["H"])
        pn = nrm(np.cross(nrm(K - R0), side))
        PARTS[i0]["M"] = frame_zx(R0, K - R0, pn)
        Kb = K - upa * (1.15 + 0.25 * size) * v["k"] ** 0.7 * 0.65
        iL = iH = None
        for j in range(i0 + 1, len(PARTS)):
            if PARTS[j]["name"] == "LegL" and iL is None:
                iL = j
                PARTS[j]["M"] = frame_zx(Kb, J - Kb, pn)
            elif PARTS[j]["name"] == "Hook" and iH is None:
                iH = j
        if iL is not None:
            LEGP.append(dict(i0=i0, iL=iL, iH=iH, kind=kind, size=size, k=v["k"], vi=v["idx"], sigma=sigma,
                             R0=R0.copy(), K=np.asarray(K).copy(), Kb=Kb.copy(), J=np.asarray(J).copy(),
                             F=np.asarray(L["F"]).copy(), Aj=np.asarray(L["Aj"]).copy()))


def frond(root, direction, length, curl_axis, r0=0.018, n=56, curl=1.0, cilia=True):
    d0 = nrm(direction)
    ax = nrm(curl_axis - np.dot(curl_axis, d0) * d0)
    with tag("Frond", mat4(ax, d0, np.cross(ax, d0), np.asarray(root, float))):
        return _frond(root, direction, length, curl_axis, r0, n, curl, cilia)


def listening_pit(c, axis, r, depth, hue, power, membrane=False, cames=0, face_n=None, drape=None):
    y = -nrm(axis)
    x = perp(y)
    with tag("Pit", mat4(x, y, np.cross(x, y), np.asarray(c, float))):
        _listening_pit(c, axis, r, depth, hue, power, membrane, cames, face_n, drape)


def build_crown():
    O, T, D, S = spine_frame(RING_S)
    with tag("Head", mat4(S, T, D, O)):
        _build_crown()


def build_tail(v):
    with tag("Tail", v["M"]):
        _build_tail(v)


def build_creature():
    log("spine length %.1f m" % L_TOTAL)
    for i, s in enumerate(VERT_S[:12] if args.lab == 'head' else VERT_S[:3] if args.lab else VERT_S):
        k = kprof(s) * (1 + rng.uniform(-0.04, 0.04))
        build_vertebra(i, s, k)
    log("vertebrae:", len(VERTS))
    for a, b in zip(VERTS[:-1], VERTS[1:]):
        build_disc(a, b)
    build_crown()
    log("crown done")
    n = len(VERTS)
    if args.lab == 'crown':
        build_cage(VERTS[1], 1.0)
        return
    # legs: pairs on most segments, irregular side gaps, giants and stunted ones, doubled legs; 2 broken,
    # 1 torn off, ~1/3 lifted mid-step; the two forelegs rear up beside the crown
    slots = []
    gap = {(rng.randint(5, 9), -1), (rng.randint(5, 9), -1), (rng.randint(13, 17), 1), (rng.randint(19, 23), -1)}
    for i in range(1, n - 1):
        for sigma in (-1, 1):
            if (i, sigma) in gap or (i > 3 and rng.random() < 0.12):
                continue
            slots.append((i, sigma))
    pool = [sl for sl in slots if 3 <= sl[0] < n - 2]
    rng.shuffle(pool)
    special = {pool[0]: "broken", pool[1]: "broken", pool[2]: "missing"}
    for sl in pool[3:3 + len(slots) // 3]:
        special[sl] = "lifted"
    for (i, sigma) in sorted(slots):
        v = VERTS[i]
        kind = special.get((i, sigma), "normal")
        r = rng.random()
        size = rng.uniform(1.25, 1.5) if r < 0.2 else (rng.uniform(0.55, 0.72) if r < 0.36 else rng.uniform(0.85, 1.1))
        build_leg(v, sigma, kind, size, rng.uniform(-0.2, 0.2) * v["k"])
        if kind == "normal" and rng.random() < 0.1:
            build_leg(v, sigma, "lifted" if rng.random() < 0.5 else "normal", rng.uniform(0.5, 0.62),
                      -0.45 * v["k"])
    log("legs:", len(slots) + 2, "slots,", sum(1 for x in special.values() if x == "lifted"), "lifted")
    for nm_, fn_ in (("belfry", build_belfry), ("spire", build_great_spire), ("ibeam", build_ibeam),
                     ("cluster", build_cluster), ("pipe", build_pipe)):
        if SKYLINE[nm_] < n:
            fn_(VERTS[SKYLINE[nm_]])
    if SKYLINE["fin"] < n:
        build_fin(VERTS[SKYLINE["fin"]], VERTS[min(SKYLINE["fin"] + 1, n - 1)])
    log("legs done")
    for idx in (6, 15):
        if idx >= n - 1:
            continue
        va, vb = VERTS[idx], VERTS[idx + 1]
        sm = (va["s"] + va["Lb"] / 2 + vb["s"] - vb["Lb"] / 2) / 2
        O, T, D, S = spine_frame(sm)
        sg = rng.choice((-1, 1))
        p_in = O + S * sg * 0.62 * va["k"] * SEG_W / 1.9 + D * rng.uniform(-0.1, 0.3) * va["k"]
        pierce(p_in, S * sg + D * 0.3 + DOWN * 0.3, rng.uniform(1.8, 4.5), hook=rng.random() < 0.6, scale=va["k"] ** 0.5)
    for idx in (8,):
        if idx + 3 >= n:
            continue
        va, vb = VERTS[idx], VERTS[idx + 3]
        Oa, Ta, Da, Sa = spine_frame(va["s"] + va["Lb"] * 0.6)
        Ob, Tb, Db, Sb = spine_frame(vb["s"] + vb["Lb"] * 0.6)
        pa = Oa + Sa * 0.75 * va["k"] * SEG_W / 1.9 + Da * 0.2
        pb = Ob + Sb * 0.75 * vb["k"] * SEG_W / 1.9 + Db * 0.2
        chain(sag_path(pa, pb, 1.4, 40, toward=Sa * 0.6))
    # scale cues placed on the flank the player (and the full shot) sees
    fc = np.array([float(x) for x in args.fullcam.split(",")][:3])

    def facing(v):
        O, T, D, S = spine_frame(v["s"])
        return 1.0 if np.dot(S, fc - O) >= 0 else -1.0

    cage_v = min(VERTS, key=lambda v: abs(v["s"] - 6.9))
    build_cage(cage_v, facing(cage_v))
    ladder_v = min(VERTS, key=lambda v: abs(v["s"] - 2.6))
    build_ladder(ladder_v, facing(ladder_v))
    bell_v = min(VERTS, key=lambda v: abs(v["s"] - 12.6))
    build_flank_bell(bell_v, facing(bell_v))
    if args.lab != 'head':
        build_tail(VERTS[-1])
    log("creature assembled")


# =============================================================================
# Environment: shaft wall, a masonry ledge and a lantern
# =============================================================================
LANTERN = {}


def build_env():
    npx, nz = int(640 * args.wall_res), int(690 * args.wall_res)
    px = np.linspace(-27, 27, npx)
    zz = np.linspace(-14, 44, nz)
    PX, ZZ = np.meshgrid(px, zz, indexing="ij")
    d, mrand, joint, broken = wall_info(PX.ravel(), ZZ.ravel())
    phi = PX.ravel() / R_SHAFT
    r = R_SHAFT - d
    P = np.stack([r * np.sin(phi), -R_SHAFT + r * np.cos(phi), ZZ.ravel()], -1)
    idx = np.arange(npx * nz).reshape(npx, nz)
    quads = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1).reshape(-1, 4)
    ENV["Rock"].add(P, quads, uv=np.stack([PX.ravel(), ZZ.ravel()], -1) / 4.0, m=mrand, g=joint, d=broken)
    # ledge of Lanternwright masonry below the creature
    for j, pxx in enumerate(np.arange(1.5, 13.5, 1.12)):
        zb = -1.25 + rng.uniform(-0.05, 0.05)
        ph_ = pxx / R_SHAFT
        tng = np.array([math.cos(ph_), -math.sin(ph_), 0.0])
        nin = np.array([-math.sin(ph_), -math.cos(ph_), 0.0])
        c = wall_point(pxx, zb, 0.55)[0]
        bm = stone_bm((1.05, 1.6, 0.48), chamfer=0.1, wear=0.03, chips=rng.randint(2, 5), subdiv=1)
        bm_xf(bm, mat4(tng, nin, UP, c))
        ENV["Masonry"].add_bm(bm)
    # bracket + lantern
    pl = 6.3
    c = wall_point(pl, -0.98, 0.95)[0]
    ph_ = pl / R_SHAFT
    tng = np.array([math.cos(ph_), -math.sin(ph_), 0.0])
    nin = np.array([-math.sin(ph_), -math.cos(ph_), 0.0])
    for j in range(6):
        a = 2 * math.pi * j / 6
        dr = math.cos(a) * tng + math.sin(a) * nin
        ENV["Iron"].add_tube(np.array([c + dr * 0.13, c + dr * 0.15 + UP * 0.22, c + dr * 0.12 + UP * 0.44]), 0.012, sides=4)
    for h in (0.0, 0.44):
        ring = c + UP * h + 0.14 * (np.cos(np.linspace(0, 2 * math.pi, 18))[:, None] * tng + np.sin(np.linspace(0, 2 * math.pi, 18))[:, None] * nin)
        ENV["Iron"].add_tube(ring, 0.02, sides=6, cap0=False, cap1=False)
    V, F = blob(c + UP * 0.22, basis_axes(tng, nin, UP, 0.085, 0.085, 0.14), sub=3, amp=0.05)
    ENV["Glow"].add(V, F)
    LANTERN["pos"] = c + UP * 0.22
    # wet run-off: slime and oil-blood sheeting down the ashlar under the body, pooling on the ledge
    for j in range(16):
        s_ = rng.uniform(1.5, 13.0)
        O, T, D, S = spine_frame(s_)
        pxx, zt, _ = wall_coords(O)
        pxx += rng.uniform(-1.6, 1.6)
        zt += rng.uniform(-1.0, 0.5)
        L = rng.uniform(1.5, 6.0)
        n_ = 40
        zs = zt - np.linspace(0, L, n_)
        xs = pxx + np.cumsum(np.r_[0, [rng.uniform(-0.02, 0.02) for _ in range(n_ - 1)]])
        Cw = wall_point(xs, zs, 0.0, disp=True)
        ph2 = xs / R_SHAFT
        tg = np.stack([np.cos(ph2), -np.sin(ph2), np.zeros_like(ph2)], -1)
        nn = np.stack([-np.sin(ph2), -np.cos(ph2), np.zeros_like(ph2)], -1)
        t = np.linspace(0, 1, n_)
        wv = rng.uniform(0.04, 0.14) * (1 - 0.6 * t) * (0.7 + 0.3 * np.sin(t * 13.0 + j) ** 2)
        Cw = Cw + nn * 0.006
        V = np.vstack([Cw - tg * wv[:, None], Cw + tg * wv[:, None]])
        F = np.array([[i, i + 1, n_ + i + 1, n_ + i] for i in range(n_ - 1)])
        ENV["Puddle"].add(V, F, m=float(j % 3 == 0))
    for (pxx, rr) in ((4.2, 0.9), (7.6, 0.55), (9.3, 0.35)):
        cpt = wall_point(pxx, -1.25 + 0.245, 0.62)[0]
        ph_ = pxx / R_SHAFT
        tng = np.array([math.cos(ph_), -math.sin(ph_), 0.0])
        nin = np.array([-math.sin(ph_), -math.cos(ph_), 0.0])
        th = np.linspace(0, 2 * math.pi, 40, endpoint=False)
        rad_ = rr * (1 + 0.25 * NZ.fbm(np.stack([np.cos(th), np.sin(th), np.zeros_like(th)], -1) * 1.5 + pxx, 2))
        ring = cpt + (np.cos(th)[:, None] * tng * 1.3 + np.sin(th)[:, None] * nin * 0.5) * rad_[:, None]
        V = np.vstack([cpt[None], ring])
        F = [[0, 1 + i, 1 + (i + 1) % 40] for i in range(40)]
        ENV["Puddle"].add(V, F, m=1.0)
    # a living climber out in the shaft, for scale (full shot)
    fcv = [float(x) for x in args.fullcam.split(",")]
    fcam, ftgt = np.array(fcv[0:3]), np.array(fcv[3:6])
    fdir = nrm(ftgt - fcam)
    fright = nrm(np.cross(fdir, UP))
    cl = fcam + (CROWN["C"] - fcam) * args.climber_at + fright * args.climber_side + DOWN * 2.0
    lamp, fwd = build_climber(cl, CROWN["C"])
    LANTERN["climber"] = (lamp, fwd)


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


def mat_stone(name="M_Stone", tint=(1.0, 1.0, 1.0), wet=0.6, value=1.0, carved=False):
    """Soot-blackened Lanternwright ashlar: large per-block value swings, worn pale arrises, black grime in the
    crevices, gravity-aligned soot and water streaks (glossy where wet), sparse hairline cracks, fine grit.
    No dot speckle. `carved`: the attribute m marks wet tooth-tips on the tracery mullions."""
    m = bpy.data.materials.new(name)
    g = NT(m)
    co = g.coord("Object")
    _, wn = g.noise(co, 0.45, 2.0)
    cw = g.vadd(co, wn, 0.3)
    n1, _ = g.noise(cw, 0.8, 6.0, 0.6)
    n2, _ = g.noise(cw, 4.2, 6.0, 0.6)
    n3, _ = g.noise(cw, 15.0, 4.0, 0.55)
    n4, _ = g.noise(co, 85.0, 2.0, 0.5)
    v = value * 0.72
    base = g.ramp(n1, [(0.28, (0.016 * v, 0.0155 * v, 0.015 * v)), (0.48, (0.034 * v, 0.032 * v, 0.03 * v)),
                       (0.66, (0.058 * v, 0.054 * v, 0.049 * v)), (0.84, (0.085 * v, 0.078 * v, 0.07 * v))])
    base = g.mix(g.maprange(n2, 0.35, 0.7, 0.0, 0.35), base, (0.09 * v, 0.085 * v, 0.078 * v, 1.0))
    isl = g.geo("Random Per Island")
    itint = g.ramp(isl, [(0.0, (0.4, 0.4, 0.42)), (0.3, (0.62, 0.61, 0.6)), (0.65, (0.85, 0.82, 0.78)),
                         (0.9, (1.15, 1.1, 1.02)), (1.0, (1.35, 1.27, 1.15))])
    base = g.mix(1.0, base, itint, "MULTIPLY")
    base = g.mix(1.0, base, (tint[0], tint[1], tint[2], 1.0), "MULTIPLY")
    # curvature: worn pale arrises, grime-black crevices
    pt = g.geo("Pointiness")
    edge = g.maprange(pt, 0.515, 0.6, 0.0, 1.0)
    cav = g.maprange(pt, 0.42, 0.495, 1.0, 0.0)
    wearn = g.maprange(n3, 0.4, 0.62, 0.3, 1.0)
    base = g.mix(g.math("MULTIPLY", edge, wearn), base, (0.15 * v, 0.14 * v, 0.125 * v, 1.0))
    base = g.mix(g.math("MULTIPLY", cav, 0.85), base, (0.004, 0.0035, 0.003, 1.0))
    # gravity streaks (world Z): soot/water runs (dark, wet) and rare pale mineral efflorescence
    st = g.vscale(co, 5.0, 5.0, 0.22)
    sn, _ = g.noise(st, 1.0, 4.0, 0.6)
    streak = g.maprange(sn, 0.52, 0.74, 0.0, 1.0)
    base = g.mix(g.math("MULTIPLY", streak, 0.7), base, (0.006, 0.0055, 0.005, 1.0))
    st2 = g.vscale(co, 3.0, 3.0, 0.15)
    en, _ = g.noise(st2, 1.3, 3.0, 0.5)
    eff = g.math("MULTIPLY", g.maprange(en, 0.68, 0.8, 0.0, 0.55), g.maprange(n2, 0.4, 0.6, 0.2, 1.0))
    base = g.mix(eff, base, (0.16, 0.155, 0.145, 1.0))
    # sparse hairline cracks
    _, wn2 = g.noise(co, 3.0, 3.0)
    cw2 = g.vadd(co, wn2, 0.1)
    vd, _ = g.voronoi(cw2, 2.2, "DISTANCE_TO_EDGE")
    crack = g.maprange(vd, 0.0, 0.006, 1.0, 0.0)
    cm, _ = g.noise(co, 0.8, 2.0)
    crack = g.math("MULTIPLY", crack, g.maprange(cm, 0.5, 0.6, 0.0, 1.0))
    base = g.mix(crack, base, (0.002, 0.002, 0.002, 1.0))
    # old blood soaked into the porous stone where it meets flesh
    bn, _ = g.noise(co, 1.6, 5.0, 0.7)
    blood = g.maprange(bn, 0.63, 0.76, 0.0, 0.7)
    base = g.mix(blood, base, (0.03, 0.004, 0.003, 1.0))
    wetf = g.math("MULTIPLY", streak, wet)
    if carved:
        tipw = g.attr("m")          # v2: old gilding on the thorns of the halo (worn through to the stone)
        gn_, _ = g.noise(co, 9.0, 4.0, 0.6)
        gilt = g.math("MULTIPLY", tipw, g.maprange(gn_, 0.32, 0.55, 0.15, 0.95))
        base = g.mix(gilt, base, (0.36, 0.24, 0.07, 1.0))
        wetf = g.math("MAXIMUM", wetf, g.math("MULTIPLY", gilt, 0.6))
    rough = g.maprange(n2, 0.3, 0.7, 0.72, 0.95)
    rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", wetf, 0.45))
    pk, _ = g.voronoi(cw, 7.0, "F1")
    pock = g.math("MULTIPLY", g.maprange(pk, 0.0, 0.32, 1.0, 0.0), g.maprange(n2, 0.42, 0.62, 0.0, 1.0))
    base = g.mix(g.math("MULTIPLY", pock, 0.6), base, (0.008, 0.0075, 0.007, 1.0))
    h = g.math("ADD", g.math("MULTIPLY", n2, 0.55), g.math("MULTIPLY", n3, 0.3))
    h = g.math("ADD", h, g.math("MULTIPLY", n4, 0.12))
    h = g.math("SUBTRACT", h, g.math("MULTIPLY", crack, 0.9))
    h = g.math("SUBTRACT", h, g.math("MULTIPLY", pock, 0.45))
    h = g.math("ADD", h, g.math("MULTIPLY", n1, 1.2))
    nrmv = g.bump(h, 1.0, 0.04)
    _, cnz = g.noise(co, 30.0, 2.0)
    g.p(base=base, rough=rough, normal=nrmv, coat=g.math("MULTIPLY", wetf, 0.9), coat_rough=0.06,
        coat_normal=g.bump(n4, 0.2, 0.004), spec=0.45)
    return m


def mat_flesh(name="M_Flesh", dark=False, glowmul=1.0, gum=False):
    """Wet bruised tissue: maroon / grey-pink / liver purple; saturated red only in fresh wounds (attr m);
    heavy clear coat with a broken-up coat normal so it glistens; red-dominant SSS so thin edges glow."""
    m = bpy.data.materials.new(name)
    g = NT(m)
    co = g.coord("Object")
    _, wn = g.noise(co, 2.0, 2.0)
    cw = g.vadd(co, wn, 0.15)
    n1, _ = g.noise(cw, 3.2, 6.0, 0.6)
    n2, _ = g.noise(cw, 13.0, 4.0, 0.6)
    n5, _ = g.noise(co, 1.1, 3.0, 0.5)
    vd, _ = g.voronoi(cw, 5.0, "DISTANCE_TO_EDGE")
    vmask, _ = g.noise(co, 1.8, 3.0)
    vein = g.math("MULTIPLY", g.maprange(vd, 0.0, 0.022, 1.0, 0.0), g.maprange(vmask, 0.48, 0.62, 0.0, 1.0))
    depthd = g.attr("aux")
    if gum:
        base = g.ramp(n1, [(0.3, (0.02, 0.007, 0.01)), (0.55, (0.05, 0.02, 0.026)), (0.75, (0.095, 0.045, 0.05)),
                           (0.92, (0.15, 0.085, 0.085))])
    elif dark:
        base = g.ramp(n1, [(0.3, (0.012, 0.002, 0.005)), (0.6, (0.04, 0.008, 0.014)), (0.82, (0.085, 0.025, 0.03))])
    else:
        base = g.ramp(n1, [(0.25, (0.018, 0.007, 0.011)), (0.45, (0.042, 0.017, 0.022)), (0.62, (0.068, 0.04, 0.043)),
                           (0.8, (0.098, 0.07, 0.068)), (0.95, (0.125, 0.1, 0.092))])
        bruise = g.maprange(n5, 0.5, 0.68, 0.0, 0.75)
        base = g.mix(bruise, base, (0.022, 0.009, 0.024, 1.0))
    wound = g.math("MULTIPLY", g.maprange(g.attr("m"), 0.45, 1.0, 0.0, 1.0), g.maprange(n2, 0.3, 0.6, 0.4, 1.0))
    base = g.mix(g.math("MULTIPLY", wound, 0.85), base, (0.2, 0.012, 0.01, 1.0))
    base = g.mix(g.math("MULTIPLY", vein, 0.6), base, (0.025, 0.004, 0.02, 1.0))
    base = g.mix(g.math("MULTIPLY", g.math("POWER", depthd, 1.6), 0.75), base, (0.002, 0.0006, 0.0008, 1.0))
    glow = g.attr("glow")
    gn, _ = g.noise(co, 2.5, 3.0)
    gl = g.math("MULTIPLY", g.math("MULTIPLY", g.math("MULTIPLY", glow, g.maprange(gn, 0.45, 0.7, 0.0, 1.0)), vein),
                g.pulse())
    h = g.math("ADD", n1, g.math("MULTIPLY", n2, 0.4))
    h = g.math("ADD", h, g.math("MULTIPLY", vein, 0.35))
    nrmv = g.bump(h, 0.5, 0.02)
    cn, _ = g.noise(co, 38.0, 3.0, 0.6)
    g.p(base=base, rough=g.maprange(n2, 0.3, 0.7, 0.36, 0.62), ssw=0.35 if not gum else 0.25, ssr=(0.8, 0.32, 0.26),
        sss=0.01 if (dark or gum) else 0.025, coat=g.maprange(n1, 0.35, 0.65, 0.2, 0.7), coat_rough=0.1, normal=nrmv,
        coat_normal=g.bump(g.math("ADD", n2, g.math("MULTIPLY", cn, 0.5)), 0.25, 0.006), emc=(1.0, 0.09, 0.03),
        ems=g.math("MULTIPLY", gl, 0.7 * glowmul), spec=0.55)
    return m


def mat_tendon():
    m = bpy.data.materials.new("M_Tendon")
    g = NT(m)
    uv = g.coord("UV")
    stri = g.wave(g.vscale(uv, 40.0, 0.4, 1.0), 1.0, 6.0, "BANDS", "X")
    co = g.coord("Object")
    n1, _ = g.noise(co, 4.0, 4.0)
    base = g.ramp(n1, [(0.3, (0.07, 0.03, 0.03)), (0.55, (0.17, 0.11, 0.09)), (0.78, (0.26, 0.2, 0.15))])
    base = g.mix(g.math("MULTIPLY", stri, 0.35), base, (0.08, 0.018, 0.02, 1.0))
    nrmv = g.bump(stri, 0.35, 0.006)
    g.p(base=base, rough=0.35, ssw=0.7, ssr=(1.0, 0.3, 0.18), sss=0.015, coat=0.85, coat_rough=0.05, normal=nrmv,
        coat_normal=g.bump(n1, 0.1, 0.004))
    return m


def mat_bone():
    m = bpy.data.materials.new("M_Bone")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 3.0, 6.0, 0.6)
    vd, _ = g.voronoi(co, 40.0, "F1")
    pores = g.maprange(vd, 0.0, 0.15, 1.0, 0.0)
    base = g.ramp(n1, [(0.3, (0.035, 0.028, 0.021)), (0.55, (0.085, 0.07, 0.052)), (0.78, (0.15, 0.125, 0.092))])
    pt = g.geo("Pointiness")
    cav = g.ramp(pt, [(0.44, (0.25, 0.18, 0.14)), (0.5, (1, 1, 1))])
    base = g.mix(1.0, base, cav, "MULTIPLY")
    sn, _ = g.noise(g.vscale(co, 6.0, 6.0, 0.3), 1.0, 3.0)
    base = g.mix(g.maprange(sn, 0.5, 0.7, 0.0, 0.7), base, (0.02, 0.012, 0.008, 1.0))
    al = g.attr("m")
    ends = g.math("MAXIMUM", g.maprange(al, 0.0, 0.1, 1.0, 0.0), g.maprange(al, 0.92, 1.0, 0.0, 1.0))
    base = g.mix(g.math("MULTIPLY", ends, 0.75), base, (0.07, 0.01, 0.008, 1.0))
    nrmv = g.bump(g.math("ADD", n1, g.math("MULTIPLY", pores, -0.3)), 0.4, 0.01)
    g.p(base=base, rough=0.5, ssw=0.2, ssr=(0.9, 0.45, 0.3), sss=0.01, coat=0.35, coat_rough=0.12, normal=nrmv)
    return m


def mat_iron():
    """Near-black corroded iron: flaking dark rust scale, heat tint where torn (attr glow)."""
    m = bpy.data.materials.new("M_Rust")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 5.0, 8.0, 0.65)
    n2, _ = g.noise(co, 25.0, 4.0, 0.6)
    vd, _ = g.voronoi(co, 22.0, "DISTANCE_TO_EDGE")
    rust = g.maprange(n1, 0.36, 0.52, 0.0, 1.0)
    al = g.attr("m")
    tip = g.maprange(al, 0.8, 0.98, 0.0, 1.0)
    rust = g.math("MULTIPLY", rust, g.math("SUBTRACT", 1.0, tip))
    rc = g.ramp(n2, [(0.3, (0.018, 0.008, 0.005)), (0.55, (0.055, 0.02, 0.009)), (0.8, (0.1, 0.04, 0.016))])
    flake = g.maprange(vd, 0.0, 0.05, 1.0, 0.0)
    rc = g.mix(g.math("MULTIPLY", flake, 0.6), rc, (0.006, 0.004, 0.003, 1.0))
    base = g.mix(rust, (0.028, 0.027, 0.028, 1.0), rc)
    heat = g.attr("glow")
    hn = g.math("ADD", heat, g.math("MULTIPLY", g.math("SUBTRACT", n2, 0.5), 0.25))
    tintc = g.ramp(hn, [(0.05, (0.03, 0.028, 0.03)), (0.3, (0.16, 0.11, 0.045)), (0.5, (0.09, 0.03, 0.09)),
                        (0.68, (0.025, 0.045, 0.11)), (0.88, (0.1, 0.02, 0.01))])
    hm = g.maprange(heat, 0.05, 0.25, 0.0, 1.0)
    base = g.mix(g.math("MULTIPLY", hm, g.math("SUBTRACT", 1.0, g.math("MULTIPLY", rust, 0.7))), base, tintc)
    metal = g.math("MULTIPLY", g.math("SUBTRACT", 1.0, rust), 0.85)
    rough = g.mix(rust, (0.42, 0.42, 0.42, 1.0), (0.9, 0.9, 0.9, 1.0))
    h = g.math("ADD", g.math("MULTIPLY", n2, 0.5), g.math("MULTIPLY", flake, 0.4))
    h = g.math("MULTIPLY", h, rust)
    g.p(base=base, metal=metal, rough=rough, normal=g.bump(h, 0.7, 0.008), emc=(1.0, 0.12, 0.02),
        ems=g.math("MULTIPLY", g.maprange(heat, 0.92, 1.0, 0.0, 1.0), 0.6))
    return m


def mat_teeth():
    """Stained, wet teeth: yellow-brown roots, dirty ivory tips, crazing; darker the deeper in the throat (aux)."""
    m = bpy.data.materials.new("M_Teeth")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 9.0, 5.0)
    n2, _ = g.noise(co, 2.2, 4.0)
    al = g.attr("m")
    base = g.ramp(al, [(0.0, (0.015, 0.005, 0.004)), (0.14, (0.05, 0.026, 0.012)), (0.4, (0.12, 0.085, 0.045)),
                       (0.75, (0.2, 0.17, 0.115)), (1.0, (0.25, 0.22, 0.17))])
    stain = g.maprange(n2, 0.45, 0.7, 0.0, 0.7)
    base = g.mix(stain, base, (0.1, 0.065, 0.025, 1.0))
    base = g.mix(g.math("MULTIPLY", n1, 0.3), base, (0.05, 0.04, 0.03, 1.0))
    vd, _ = g.voronoi(co, 26.0, "DISTANCE_TO_EDGE")
    craze = g.maprange(vd, 0.0, 0.03, 1.0, 0.0)
    base = g.mix(g.math("MULTIPLY", craze, 0.5), base, (0.03, 0.02, 0.012, 1.0))
    base = g.mix(g.math("MULTIPLY", g.attr("aux"), 0.45), base, (0.008, 0.004, 0.003, 1.0))
    g.p(base=base, rough=g.maprange(al, 0.0, 1.0, 0.55, 0.3), coat=g.maprange(al, 0.0, 0.5, 0.5, 0.95), coat_rough=0.05,
        ssw=g.maprange(al, 0.5, 1.0, 0.0, 0.3), ssr=(0.9, 0.7, 0.5), sss=0.008,
        normal=g.bump(g.math("ADD", n1, g.math("MULTIPLY", craze, -0.4)), 0.4, 0.004))
    return m


def mat_iron_tooth():
    m = bpy.data.materials.new("M_IronTooth")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 14.0, 6.0, 0.6)
    al = g.attr("m")
    rust = g.maprange(n1, 0.5, 0.66, 0.0, 1.0)
    rust = g.math("MULTIPLY", rust, g.maprange(al, 0.0, 0.6, 1.0, 0.0))
    base = g.mix(rust, (0.012, 0.011, 0.012, 1.0), (0.06, 0.022, 0.009, 1.0))
    base = g.mix(g.maprange(al, 0.0, 0.2, 0.8, 0.0), base, (0.03, 0.003, 0.003, 1.0))
    g.p(base=base, metal=g.math("SUBTRACT", 0.85, rust), rough=g.maprange(al, 0.0, 1.0, 0.7, 0.3), coat=0.7,
        coat_rough=0.06, normal=g.bump(n1, 0.5, 0.004))
    return m


def mat_ember(strength=22.0, name="M_Ember"):
    m = bpy.data.materials.new(name)
    g = NT(m)
    co = g.coord("Object")
    vd2, _ = g.voronoi(co, 18.0, "DISTANCE_TO_EDGE")
    n1, _ = g.noise(co, 6.0, 4.0)
    core = g.ramp(n1, [(0.3, (0.55, 0.05, 0.005)), (0.55, (1.0, 0.26, 0.04)), (0.75, (1.0, 0.55, 0.18))])
    crust = g.maprange(vd2, 0.0, 0.06, 0.0, 1.0)
    emc = g.mix(crust, (0.0, 0.0, 0.0, 1.0), core)
    gl = g.attr("glow")
    g.p(base=(0.02, 0.008, 0.006), rough=0.6, emc=emc, ems=g.math("MULTIPLY", g.math("MAXIMUM", gl, 0.0), strength))
    return m


def mat_frond():
    """Pale bone-white / grey translucent fronds; faintly flushed tips."""
    m = bpy.data.materials.new("M_Frond")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 12.0, 4.0)
    al = g.attr("m")
    base = g.ramp(n1, [(0.3, (0.36, 0.34, 0.31)), (0.6, (0.5, 0.48, 0.44)), (0.85, (0.6, 0.58, 0.53))])
    base = g.mix(g.maprange(al, 0.0, 0.15, 1.0, 0.0), base, (0.1, 0.03, 0.035, 1.0))
    base = g.mix(g.maprange(al, 0.75, 1.0, 0.0, 0.4), base, (0.5, 0.3, 0.28, 1.0))
    g.p(base=base, rough=0.38, ssw=1.0, ssr=(1.0, 0.7, 0.55), sss=0.03, coat=0.85, coat_rough=0.05,
        normal=g.bump(n1, 0.25, 0.003))
    tr = g.n("ShaderNodeBsdfTranslucent")
    tr.inputs["Color"].default_value = (0.75, 0.6, 0.5, 1.0)
    ms = g.n("ShaderNodeMixShader")
    ms.inputs[0].default_value = 0.3
    g.nt.links.new(g.bsdf.outputs[0], ms.inputs[1])
    g.nt.links.new(tr.outputs[0], ms.inputs[2])
    g.nt.links.new(ms.outputs[0], g.out.inputs["Surface"])
    return m


def mat_bronze():
    m = bpy.data.materials.new("M_Bronze")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 3.0, 6.0, 0.6)
    n2, _ = g.noise(co, 18.0, 4.0)
    ver = g.maprange(n1, 0.4, 0.6, 0.0, 1.0)
    base = g.mix(ver, (0.06, 0.035, 0.017, 1.0), (0.025, 0.045, 0.035, 1.0))
    base = g.mix(g.maprange(n2, 0.55, 0.75, 0.0, 0.7), base, (0.01, 0.008, 0.007, 1.0))
    g.p(base=base, metal=g.maprange(ver, 0.0, 1.0, 0.6, 0.0), rough=g.maprange(ver, 0.0, 1.0, 0.45, 0.9),
        normal=g.bump(g.math("ADD", n2, n1), 0.5, 0.01))
    return m


def mat_mucus():
    m = bpy.data.materials.new("M_Mucus")
    g = NT(m)
    g.p(base=(0.92, 0.96, 0.92), rough=0.0, trans=1.0, ior=1.33, coat=0.0, spec=1.0)
    return m


def mat_vein():
    m = bpy.data.materials.new("M_Vein")
    g = NT(m)
    gl = g.math("MULTIPLY", g.attr("glow"), g.pulse())
    g.p(base=(0.03, 0.006, 0.02), rough=0.3, coat=0.9, coat_rough=0.05, ssw=0.5, ssr=(0.8, 0.2, 0.3), sss=0.01,
        emc=(1.0, 0.08, 0.03), ems=g.math("MULTIPLY", gl, 1.2))
    return m


def mat_seam():
    """Bioluminescent seepage along fractures: dim, deep red, pulsing head-ward; never brighter than the throat."""
    m = bpy.data.materials.new("M_Seam")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 3.0, 3.0)
    flick = g.maprange(n1, 0.4, 0.72, 0.0, 1.0)
    gl = g.math("MULTIPLY", g.math("MULTIPLY", g.attr("glow"), g.pulse()), flick)
    emc = g.ramp(gl, [(0.0, (0.35, 0.01, 0.01)), (0.6, (0.75, 0.05, 0.02)), (1.0, (1.0, 0.16, 0.04))])
    g.p(base=(0.02, 0.004, 0.004), rough=0.4, coat=0.8, coat_rough=0.08, emc=emc, ems=g.math("MULTIPLY", gl, 1.8))
    return m


def mat_glass():
    m = bpy.data.materials.new("M_StainedGlass")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 9.0, 4.0)
    g.p(base=g.mix(g.maprange(n1, 0.3, 0.7, 0.0, 1.0), (0.015, 0.012, 0.01, 1.0), (0.05, 0.02, 0.012, 1.0)),
        rough=0.25, coat=0.6, coat_rough=0.2, emc=(0.6, 0.12, 0.04), ems=g.math("MULTIPLY", g.attr("glow"), 0.6))
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
    m = bpy.data.materials.new("M_OilBlood")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 6.0, 4.0)
    base = g.ramp(n1, [(0.3, (0.008, 0.0015, 0.0015)), (0.7, (0.035, 0.005, 0.004))])
    g.p(base=base, rough=0.1, coat=1.0, coat_rough=0.02, spec=0.6)
    return m


def mat_membrane():
    """Thin, pale grey-yellow translucent membrane with meandering dark vessels; glows dully when backlit."""
    m = bpy.data.materials.new("M_Membrane")
    g = NT(m)
    co = g.coord("Object")
    _, wn = g.noise(co, 2.0, 3.0)
    cw = g.vadd(co, wn, 0.25)
    w1 = g.wave(cw, 5.0, 6.0, "BANDS", "X")
    w2 = g.wave(g.vscale(cw, 1.0, 1.0, 1.0), 14.0, 9.0, "BANDS", "Y")
    vein = g.math("MAXIMUM", g.maprange(g.math("ABSOLUTE", g.math("SUBTRACT", w1, 0.5)), 0.0, 0.05, 1.0, 0.0),
                  g.math("MULTIPLY", g.maprange(g.math("ABSOLUTE", g.math("SUBTRACT", w2, 0.5)), 0.0, 0.03, 1.0, 0.0), 0.6))
    bl, _ = g.noise(co, 2.0, 5.0, 0.6)
    base = g.mix(g.maprange(bl, 0.3, 0.7, 0.0, 1.0), (0.04, 0.034, 0.026, 1.0), (0.085, 0.075, 0.055, 1.0))
    base = g.mix(g.math("MULTIPLY", vein, 0.8), base, (0.05, 0.01, 0.012, 1.0))
    g.p(base=base, rough=0.18, ssw=0.6, ssr=(1.0, 0.5, 0.3), sss=0.02, coat=1.0, coat_rough=0.03,
        normal=g.bump(g.math("ADD", bl, vein), 0.3, 0.012))
    tr = g.n("ShaderNodeBsdfTranslucent")
    g.set(tr.inputs["Color"], g.mix(vein, (0.16, 0.11, 0.06, 1.0), (0.05, 0.006, 0.006, 1.0)))
    ms = g.n("ShaderNodeMixShader")
    ms.inputs[0].default_value = 0.6
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


def mat_pit():
    """Listening-pit coal: each pit its own hue (attr m: dull blood red -> deep ember) and intensity (glow)."""
    m = bpy.data.materials.new("M_Pit")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 14.0, 4.0)
    col = g.ramp(g.attr("m"), [(0.0, (0.3, 0.012, 0.008)), (0.5, (0.65, 0.06, 0.018)), (1.0, (1.0, 0.2, 0.035))])
    fl = g.maprange(n1, 0.3, 0.7, 0.45, 1.0)
    g.p(base=(0.01, 0.003, 0.003), rough=0.4, coat=1.0, coat_rough=0.05, emc=col,
        ems=g.math("MULTIPLY", g.math("MULTIPLY", g.attr("glow"), fl), 2.4))
    return m


def mat_soot():
    m = bpy.data.materials.new("M_Soot")
    g = NT(m)
    g.p(base=(0.004, 0.0035, 0.003), rough=0.95, spec=0.2)
    return m


def mat_mask():
    """v2: the saint's stone. Limestone gone a dirty grey-ivory, soot in every hollow, hairline crazing, pocks, gravity grime; black
    tears (attr aux, glossy); cracks (attr glow); where the stone skin has flaked away (attr m) the creature's own wet flesh shows."""
    m = bpy.data.materials.new("M_Mask")
    g = NT(m)
    co = g.coord("Object")
    _, wn = g.noise(co, 0.6, 2.0)
    cw = g.vadd(co, wn, 0.2)
    n1, _ = g.noise(cw, 1.4, 6.0, 0.6)
    n2, _ = g.noise(cw, 6.0, 5.0, 0.6)
    n3, _ = g.noise(cw, 22.0, 4.0, 0.55)
    base = g.ramp(n1, [(0.25, (0.12, 0.112, 0.1)), (0.5, (0.19, 0.18, 0.162)), (0.75, (0.27, 0.256, 0.23)),
                       (0.95, (0.33, 0.315, 0.28))])
    base = g.mix(g.maprange(n2, 0.35, 0.7, 0.0, 0.45), base, (0.07, 0.065, 0.058, 1.0))
    pt = g.geo("Pointiness")
    cav = g.maprange(pt, 0.44, 0.5, 1.0, 0.0)
    base = g.mix(g.math("MULTIPLY", cav, 0.9), base, (0.012, 0.011, 0.01, 1.0))
    edge = g.maprange(pt, 0.52, 0.6, 0.0, 1.0)
    base = g.mix(g.math("MULTIPLY", edge, 0.5), base, (0.3, 0.29, 0.26, 1.0))
    st = g.vscale(co, 7.0, 7.0, 0.3)
    sn, _ = g.noise(st, 1.0, 4.0, 0.6)
    streak = g.maprange(sn, 0.48, 0.72, 0.0, 0.75)
    base = g.mix(streak, base, (0.03, 0.027, 0.024, 1.0))
    crk = g.attr("glow")
    vd, _ = g.voronoi(cw, 4.0, "DISTANCE_TO_EDGE")
    craze = g.math("MULTIPLY", g.maprange(vd, 0.0, 0.006, 1.0, 0.0), g.maprange(n2, 0.5, 0.65, 0.0, 1.0))
    crack = g.math("MAXIMUM", crk, g.math("MULTIPLY", craze, 0.8))
    base = g.mix(crack, base, (0.004, 0.0035, 0.0035, 1.0))
    pk, _ = g.voronoi(cw, 26.0, "F1")
    pock = g.math("MULTIPLY", g.maprange(pk, 0.0, 0.25, 1.0, 0.0), g.maprange(n1, 0.45, 0.7, 0.0, 1.0))
    base = g.mix(g.math("MULTIPLY", pock, 0.6), base, (0.03, 0.027, 0.024, 1.0))
    # flaked away: the wet flesh under the stone skin, a dark rim of rot round it
    fl = g.attr("m")
    flk = g.maprange(fl, 0.25, 0.55, 0.0, 1.0)
    rim = g.math("MULTIPLY", g.maprange(fl, 0.05, 0.25, 0.0, 1.0), g.maprange(fl, 0.55, 0.3, 0.0, 1.0))
    base = g.mix(g.math("MULTIPLY", rim, 0.8), base, (0.02, 0.012, 0.01, 1.0))
    fcol = g.ramp(n3, [(0.3, (0.018, 0.004, 0.005)), (0.6, (0.045, 0.012, 0.013)), (0.85, (0.075, 0.028, 0.026))])
    base = g.mix(flk, base, fcol)
    grm = g.math("MULTIPLY", g.attr("grime"), g.maprange(n2, 0.25, 0.75, 0.55, 1.0))
    base = g.mix(g.math("MULTIPLY", grm, 0.85), base, (0.025, 0.02, 0.018, 1.0))
    tear = g.attr("aux")
    tf = g.maprange(tear, 0.08, 0.5, 0.0, 1.0)
    base = g.mix(tf, base, (0.004, 0.0025, 0.0025, 1.0))
    wet = g.math("MAXIMUM", tf, flk)
    rough = g.maprange(n2, 0.3, 0.7, 0.58, 0.82)
    rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", wet, 0.5))
    h = g.math("ADD", g.math("MULTIPLY", n2, 0.25), g.math("MULTIPLY", n3, 0.2))
    h = g.math("SUBTRACT", h, g.math("MULTIPLY", crack, 0.6))
    h = g.math("SUBTRACT", h, g.math("MULTIPLY", pock, 0.3))
    h = g.math("ADD", h, g.math("MULTIPLY", tf, 0.12))
    h = g.math("ADD", h, g.math("MULTIPLY", flk, g.math("MULTIPLY", n3, 0.5)))
    g.p(base=base, rough=rough, normal=g.bump(h, 0.6, 0.02), coat=g.math("MULTIPLY", wet, 0.9), coat_rough=0.05, spec=0.5)
    return m


def mat_eye():
    """v2: a blind eye. Yellowed, veined sclera, bloodshot toward the back, a clouded grey iris (attr aux = cosine to the eye's
    own axis) and a milky cataract where the pupil should be. Very wet."""
    m = bpy.data.materials.new("M_Eye")
    g = NT(m)
    co = g.coord("Object")
    cs = g.attr("aux")
    n1, _ = g.noise(co, 30.0, 4.0)
    vd, _ = g.voronoi(co, 22.0, "DISTANCE_TO_EDGE")
    vein = g.math("MULTIPLY", g.maprange(vd, 0.0, 0.025, 1.0, 0.0), g.maprange(cs, 0.85, 0.2, 0.0, 1.0))
    base = g.ramp(n1, [(0.3, (0.16, 0.13, 0.08)), (0.7, (0.24, 0.2, 0.13))])
    base = g.mix(g.maprange(cs, 0.75, 0.0, 0.0, 0.85), base, (0.16, 0.035, 0.025, 1.0))
    base = g.mix(g.math("MULTIPLY", vein, 0.8), base, (0.24, 0.015, 0.012, 1.0))
    iris = g.maprange(cs, 0.8, 0.84, 0.0, 1.0)
    irc = g.ramp(n1, [(0.3, (0.07, 0.08, 0.085)), (0.7, (0.15, 0.165, 0.17))])
    base = g.mix(iris, base, irc)
    limb = g.maprange(g.math("ABSOLUTE", g.math("SUBTRACT", cs, 0.82)), 0.0, 0.02, 1.0, 0.0)
    base = g.mix(g.math("MULTIPLY", limb, 0.8), base, (0.02, 0.02, 0.024, 1.0))
    pup = g.maprange(cs, 0.95, 0.975, 0.0, 1.0)
    base = g.mix(pup, base, (0.26, 0.27, 0.27, 1.0))
    g.p(base=base, rough=0.12, coat=1.0, coat_rough=0.02, ssw=0.3, ssr=(0.9, 0.6, 0.5), sss=0.01, spec=0.6,
        normal=g.bump(g.math("ADD", n1, g.math("MULTIPLY", iris, 0.2)), 0.15, 0.004))
    return m


def mat_skin():
    """v2: a swallowed climber's skin: waxy grey, livid patches, dark veins, darkened finger ends (attr m)."""
    m = bpy.data.materials.new("M_Skin")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 8.0, 5.0, 0.6)
    n2, _ = g.noise(co, 2.0, 3.0)
    base = g.ramp(n1, [(0.3, (0.15, 0.14, 0.14)), (0.7, (0.23, 0.21, 0.2))])
    base = g.mix(g.maprange(n2, 0.5, 0.7, 0.0, 0.8), base, (0.09, 0.05, 0.08, 1.0))
    vd, _ = g.voronoi(co, 12.0, "DISTANCE_TO_EDGE")
    vein = g.math("MULTIPLY", g.maprange(vd, 0.0, 0.02, 1.0, 0.0), g.maprange(n2, 0.4, 0.6, 0.0, 1.0))
    base = g.mix(g.math("MULTIPLY", vein, 0.5), base, (0.05, 0.05, 0.08, 1.0))
    base = g.mix(g.math("MULTIPLY", g.maprange(g.attr("m"), 0.5, 0.7, 0.0, 1.0), 0.6), base, (0.04, 0.02, 0.02, 1.0))
    g.p(base=base, rough=0.45, ssw=0.4, ssr=(0.9, 0.5, 0.4), sss=0.008, coat=0.6, coat_rough=0.1, normal=g.bump(n1, 0.2, 0.004))
    return m


def mat_wall():
    """Shaft lining: soot-dark ashlar (per-block value from attr m), black eroded joints (glow), broken-out
    sockets (aux), wet run-off and rare pale mineral streaks, fine grit bump."""
    m = bpy.data.materials.new("M_ShaftAshlar")
    g = NT(m)
    co = g.coord("Object")
    _, wn = g.noise(co, 0.3, 2.0)
    cw = g.vadd(co, wn, 0.8)
    n1, _ = g.noise(cw, 0.7, 6.0, 0.6)
    n2, _ = g.noise(cw, 3.5, 6.0, 0.6)
    n3, _ = g.noise(cw, 14.0, 4.0, 0.55)
    n4, _ = g.noise(co, 60.0, 2.0, 0.5)
    blk = g.attr("m")
    jt = g.attr("glow")
    brk = g.attr("aux")
    bv = g.ramp(blk, [(0.0, (0.012, 0.012, 0.013)), (0.4, (0.022, 0.021, 0.021)), (0.8, (0.035, 0.033, 0.031)),
                      (1.0, (0.05, 0.047, 0.043))])
    base = g.mix(1.0, bv, g.ramp(n1, [(0.2, (0.6, 0.6, 0.6)), (0.5, (1.0, 1.0, 1.0)), (0.8, (1.35, 1.3, 1.25))]),
                 "MULTIPLY")
    base = g.mix(g.maprange(n2, 0.35, 0.7, 0.0, 0.3), base, (0.05, 0.048, 0.045, 1.0))
    base = g.mix(g.math("MULTIPLY", jt, 0.9), base, (0.003, 0.003, 0.003, 1.0))
    base = g.mix(g.math("MULTIPLY", brk, 0.6), base, (0.008, 0.007, 0.006, 1.0))
    st = g.vscale(co, 2.2, 2.2, 0.06)
    sn, _ = g.noise(st, 1.0, 4.0, 0.6)
    streak = g.maprange(sn, 0.5, 0.7, 0.0, 1.0)
    base = g.mix(g.math("MULTIPLY", streak, 0.6), base, (0.005, 0.005, 0.0055, 1.0))
    st2 = g.vscale(co, 1.6, 1.6, 0.05)
    en, _ = g.noise(st2, 1.3, 3.0, 0.5)
    eff = g.math("MULTIPLY", g.maprange(en, 0.7, 0.82, 0.0, 0.45), g.maprange(n2, 0.4, 0.6, 0.2, 1.0))
    base = g.mix(eff, base, (0.1, 0.1, 0.095, 1.0))
    rough = g.maprange(n2, 0.3, 0.7, 0.7, 0.92)
    rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", streak, 0.5))
    h = g.math("ADD", g.math("MULTIPLY", n3, 0.5), g.math("MULTIPLY", n4, 0.2))
    h = g.math("ADD", h, g.math("MULTIPLY", n2, 0.4))
    g.p(base=base, rough=rough, spec=0.45, normal=g.bump(h, 0.6, 0.02),
        coat=g.math("MULTIPLY", streak, 0.6), coat_rough=0.08)
    return m


def mat_puddle():
    m = bpy.data.materials.new("M_Puddle")
    g = NT(m)
    co = g.coord("Object")
    n1, _ = g.noise(co, 8.0, 3.0)
    base = g.mix(g.attr("m"), (0.006, 0.005, 0.005, 1.0), (0.02, 0.003, 0.002, 1.0))
    g.p(base=base, rough=0.04, coat=1.0, coat_rough=0.01, spec=0.7, normal=g.bump(n1, 0.08, 0.004))
    return m


def mat_matte(name, col, rough=0.8):
    m = bpy.data.materials.new(name)
    g = NT(m)
    g.p(base=col, rough=rough)
    return m


def setup_compositor(scene, glare=True, vignette=0.0, mist_col=(0.02, 0.024, 0.03)):
    """Depth haze from the mist pass (cheap atmospheric perspective), fog-glow on the hot points, vignette.
    Returns the mist-strength socket so each shot can set its own haze."""
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
    mist_sock = None
    if "Mist" in rl.outputs:
        mm = ng.nodes.new("ShaderNodeMath")
        mm.operation = "MULTIPLY"
        mm.use_clamp = True
        ng.links.new(rl.outputs["Mist"], mm.inputs[0])
        mm.inputs[1].default_value = 0.0
        mist_sock = mm.inputs[1]
        mx = ng.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        ins = {sk.identifier: sk for sk in mx.inputs}
        ng.links.new(mm.outputs[0], ins["Factor_Float"])
        ng.links.new(img, ins["A_Color"])
        ins["B_Color"].default_value = (*mist_col, 1.0)
        img = next(sk for sk in mx.outputs if sk.identifier == "Result_Color")
    if glare:
        gl = ng.nodes.new("CompositorNodeGlare")
        gl.inputs["Type"].default_value = "Fog Glow"
        gl.inputs["Threshold"].default_value = 0.9
        gl.inputs["Strength"].default_value = 0.4
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
    return mist_sock


# =============================================================================
# Scene build
# =============================================================================
def build_climber(pos, look_at):
    """A tiny human climber on a rope out in the shaft (scale reference for the full shot), helmet lamp lit."""
    fwd = nrm(np.asarray(look_at, float) - pos)
    fwd = nrm(fwd - fwd.dot(UP) * UP * 0.3)
    side = nrm(np.cross(fwd, UP))
    up = np.cross(side, fwd)
    acc = ENV["Climber"]
    hip = pos
    chest = hip + up * 0.5 + fwd * 0.05
    head = chest + up * 0.3 + fwd * 0.05
    acc.add_tube(np.array([hip, chest]), np.array([0.16, 0.19]), ry=np.array([0.11, 0.13]), up=fwd, sides=10)
    V, F = blob(head, basis_axes(side, fwd, up, 0.11, 0.12, 0.13), sub=2, amp=0.02)
    acc.add(V, F)
    V, F = blob(head + up * 0.04, basis_axes(side, fwd, up, 0.14, 0.15, 0.1), sub=2, amp=0.0)
    acc.add(V, F)
    for sx in (-1, 1):
        sh = chest + side * sx * 0.2 - up * 0.04
        if sx > 0:
            el = sh + up * 0.28 + fwd * 0.08
            hd = el + up * 0.3 - side * 0.12
        else:
            el = sh - up * 0.22 + fwd * 0.2 - side * 0.05
            hd = el + fwd * 0.25 + up * 0.05
        acc.add_tube(np.array([sh, el, hd]), np.array([0.055, 0.05, 0.045]), sides=8)
        kn = hip + side * sx * 0.1 + fwd * 0.3 - up * 0.2 + (up * 0.15 if sx > 0 else 0)
        ft = kn - up * 0.42 + fwd * (0.05 if sx > 0 else -0.08)
        acc.add_tube(np.array([hip + side * sx * 0.09, kn, ft]), np.array([0.08, 0.065, 0.055]), sides=8)
        acc.add_tube(np.array([ft, ft + fwd * 0.2]), 0.05, sides=8)
    lamp = head + fwd * 0.13 + up * 0.06
    V, F = blob(lamp, basis_axes(side, up, fwd, 0.03, 0.03, 0.015), sub=2, amp=0.0)
    ENV["Glow"].add(V, F)
    hand = chest + side * 0.2 + up * 0.55 - side * 0.12 + fwd * 0.08
    rope_top = hand + UP * 14.0 + side * 0.4
    ENV["Rope"].add_tube(np.array([hip + fwd * 0.1, hand, rope_top]), 0.012, sides=6)
    ENV["Rope"].add_tube(np.array([hip + fwd * 0.1, hip - up * 1.2 + fwd * 0.15 + side * 0.1, hip - up * 2.0 + side * 0.3]),
                         0.012, sides=6)
    return lamp, fwd


def mat_lamp(name, col, strength):
    m = bpy.data.materials.new(name)
    g = NT(m)
    g.p(base=(0.05, 0.04, 0.03), rough=0.4, emc=col, ems=strength)
    return m


def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def apply_decimate(ob, ratio):
    md = ob.modifiers.new("dec", "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.ratio = float(min(max(ratio, 0.002), 1.0))
    try:
        md.use_collapse_triangulate = True
    except Exception:
        pass
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me2
    bpy.data.meshes.remove(old)


def hiA_objs(objs):
    return [o for o in objs.values() if o is not None]


# =============================================================================
# PRODUCTION EXPORT (round 3): the modular, rig-ready kit + the assembled hero, LOD0 / LOD1, two baked atlases.
#
#   * the creature is rebuilt at game tessellation (LOW) with the same RNG stream, so every part tag matches the
#     render mesh; each kit module (crown, vertebra variants, tail, leg templates, frond, pit) is cut out of that
#     rebuild by part id, decimated to its triangle budget, UV-unwrapped and packed into one of two 2048 atlases
#     (MasonCrown, MasonBody), and baked (base colour / tangent normal / roughness / AO / metal class) from the
#     render-resolution (hi) faces of exactly the same parts;
#   * every module vertex is stamped with the rig contract attributes: _SPINE_S, _MASK, _PART, _OWNER (+ _OWNER2 /
#     _OWNW2 for the flesh that blends between two bones); the owner table travels in the node's extras;
#   * mason_kit.glb keeps the README part names and pivots (Mason_Segment_0..2, Mason_Tail, Mason_Head,
#     Mason_Frond_0..2, Mason_Pit, Mason_LimbUpper / Lower, Mason_Hook) plus <Part>_LOD1 twins (the in-game view
#     shows them when the camera is far);
#   * mason_hero.glb assembles the same modules (shared meshes, instanced nodes) along the posed spine.
# =============================================================================
LEGP = []          # one record per boned leg: part ids + the leg's own frame data (filled by build_leg)

KIT_FAMILY = {
    "Crown": ("Head", "Pit", "PitMembrane", "Frond_0", "Frond_1", "Frond_2"),
    "Body": ("Segment_0", "Segment_1", "Segment_2", "Tail", "LimbUpper", "LimbLower", "Hook"),
}
KIT_TRIS = {"Head": 21000, "Pit": 110, "PitMembrane": 70, "Frond_0": 64, "Frond_1": 64, "Frond_2": 64,
            "Segment_0": 1150, "Segment_1": 1050, "Segment_2": 950, "Tail": 560,
            "LimbUpper": 640, "LimbLower": 420, "Hook": 320}
LOD1_RATIO = 0.35
ATLAS_PX = {"Crown": 2048, "Body": 2048}
EMISSIVE_G = ("Ember", "Pit")
KIT_SKIP = ("Mucus", "Oil", "Seam", "Glass")       # drool and glass are render-only (no transparency in the kit)
BLEND_G = ("Flesh", "Marrow", "Gum", "Tendon", "Vein", "Membrane", "Mucus", "Oil", "Seam", "Frond", "Skin")
# (flesh, wet, thickness, class / 3)   class: stone 0, iron 1, flesh 2, bone 3
GROUP_MASK = {
    "Stone": (0, 0.3, 0.0, 0.0), "Carved": (0, 0.3, 0.0, 0.0), "Soot": (0, 0.0, 0.0, 0.0),
    "Iron": (0, 0.2, 0.0, 1 / 3), "IronTooth": (0, 0.3, 0.0, 1 / 3), "Bronze": (0, 0.1, 0.0, 1 / 3),
    "Rope": (0, 0.1, 0.0, 1 / 3), "Glass": (0, 0.6, 0.0, 1 / 3), "Ember": (0, 0, 0, 1 / 3), "Pit": (0, 0.5, 0, 1 / 3),
    "Flesh": (1, 1, 0.6, 2 / 3), "Marrow": (1, 1, 0.7, 2 / 3), "Gum": (1, 1, 0.5, 2 / 3), "Tendon": (1, 1, 0.5, 2 / 3),
    "Vein": (1, 1, 0.4, 2 / 3), "Membrane": (0.6, 1, 1.0, 2 / 3), "Mucus": (0, 1, 0.5, 2 / 3), "Oil": (0, 1, 0, 2 / 3),
    "Seam": (0, 0.6, 0, 2 / 3), "Frond": (0.7, 0.8, 0.9, 2 / 3),
    "Teeth": (0, 0.7, 0.3, 1.0), "Bone": (0, 0.3, 0.2, 1.0),
    "Mask": (0, 0.12, 0.0, 0.0), "Eye": (0.2, 1.0, 0.3, 1.0), "Skin": (1, 0.6, 0.5, 2 / 3),
}
GROUP_IDS = {g: i for i, g in enumerate(GROUP_MASK)}
GROUP_NAMES = {i: g for g, i in GROUP_IDS.items()}


def part_tree():
    names = [P["name"] for P in PARTS]
    par = [P.get("parent", 0) for P in PARTS]
    return names, par


def under(i, root, par):
    while i:
        if i == root:
            return True
        i = par[i]
    return False


def acc_arrays(acc):
    if acc.n == 0:
        return None
    sizes = np.concatenate(acc.sizes)
    return dict(V=np.vstack(acc.V), flat=np.concatenate(acc.flat), sizes=sizes,
                starts=np.concatenate([[0], np.cumsum(sizes)[:-1]]), uv=np.vstack(acc.uv),
                m=np.concatenate(acc.m), g=np.concatenate(acc.g), d=np.concatenate(acc.d),
                p=np.rint(np.concatenate(acc.p)).astype(np.int64))


def extract_faces(arr, ids):
    """Faces whose vertices all carry a part id in `ids`, compacted into a standalone mesh dict."""
    if arr is None or not len(ids):
        return None
    vin = np.isin(arr["p"], np.fromiter(ids, np.int64))
    nf = len(arr["sizes"])
    loop_face = np.repeat(np.arange(nf), arr["sizes"])
    loop_ok = vin[arr["flat"]]
    ok = np.bincount(loop_face, weights=loop_ok.astype(float), minlength=nf) == arr["sizes"]
    if not ok.any():
        return None
    keep = ok[loop_face]
    kept = arr["flat"][keep]
    used = np.unique(kept)
    remap = np.full(len(arr["V"]), -1, np.int64)
    remap[used] = np.arange(len(used))
    return dict(V=arr["V"][used], flat=remap[kept], sizes=arr["sizes"][ok], uv=arr["uv"][used], m=arr["m"][used],
                g=arr["g"][used], d=arr["d"][used], p=arr["p"][used])


def mesh_from_arrays(name, V, flat, sizes, uv=None):
    me = bpy.data.meshes.new(name)
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]])
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", np.asarray(V, np.float32).ravel())
    me.loops.add(len(flat))
    me.loops.foreach_set("vertex_index", np.asarray(flat, np.int32))
    me.polygons.add(len(sizes))
    me.polygons.foreach_set("loop_start", starts.astype(np.int32))
    me.polygons.foreach_set("loop_total", np.asarray(sizes, np.int32))
    me.update(calc_edges=True)
    if uv is not None:
        lay = me.uv_layers.new(name="UVMap")
        lay.data.foreach_set("uv", np.asarray(uv, np.float32)[flat].ravel())
    return me


def set_point_attr(me, name, vals, typ="FLOAT"):
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    at = me.attributes.new(name, typ, "POINT")
    vals = np.asarray(vals, np.float32)
    if typ == "FLOAT_COLOR":
        at.data.foreach_set("color", vals.ravel())
    else:
        at.data.foreach_set("value", vals.ravel())
    return at


def get_point_attr(me, name, default=0.0):
    n = len(me.vertices)
    if name not in me.attributes:
        return np.full(n, default, np.float32)
    out = np.zeros(n, np.float32)
    me.attributes[name].data.foreach_get("value", out)
    return out


def tri_total(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def kit_specs(Alow):
    """Which part ids make which kit module, and each module's pivot frame (world pose of the posed creature)."""
    names, par = part_tree()
    nP = len(PARTS)
    ids_named = lambda nm: [i for i in range(nP) if names[i] == nm]
    head = ids_named("Head")[0]
    spec = {}
    head_all = [i for i in range(nP) if under(i, head, par)]
    fronds = [i for i in head_all if names[i] == "Frond"]
    pits = [i for i in head_all if names[i] == "Pit"]
    head_ids = [i for i in head_all if names[i] != "Frond"]
    spec["Head"] = dict(ids=set(head_ids), M=PARTS[head]["M"], fam="Crown")
    nfr = len(fronds)
    for q, fi in enumerate((fronds[nfr // 8], fronds[nfr // 2], fronds[(7 * nfr) // 8]) if nfr else ()):
        spec["Frond_%d" % q] = dict(ids={fi}, M=PARTS[fi]["M"], fam="Crown")
    p0 = pits[0]
    memb = [i for i in head_all if names[i] == "PitMembrane"]
    pit_ids = {p0} | {i for i in memb if par[i] == p0}
    # the pit with the eardrum is the most characteristic: prefer the first membrane-bearing pit
    for pm in pits:
        mm = {i for i in memb if par[i] == pm}
        if mm:
            p0, pit_ids = pm, {pm} | mm
            break
    spec["Pit"] = dict(ids={i for i in pit_ids if names[i] == "Pit"}, M=PARTS[p0]["M"], fam="Crown")
    spec["PitMembrane"] = dict(ids={i for i in pit_ids if names[i] == "PitMembrane"}, M=PARTS[p0]["M"], fam="Crown")
    nvert = len(VERTS)
    for q, vi in enumerate((6, 12, 18)):
        vi = min(vi, nvert - 2)
        ids = set(ids_named("Seg%d" % vi))
        spec["Segment_%d" % q] = dict(ids=ids, M=PARTS[min(ids)]["M"], fam="Body", vert=vi)
    lastv = nvert - 1
    ids = set(ids_named("Seg%d" % lastv)) | set(ids_named("Tail"))
    spec["Tail"] = dict(ids=ids, M=PARTS[min(ids_named("Seg%d" % lastv))]["M"], fam="Body", vert=lastv)
    cand = [lp for lp in LEGP if lp["kind"] == "normal" and lp["iH"] is not None and 0.9 <= lp["size"] <= 1.12
            and 8 <= lp["vi"] <= 14]
    leg = cand[len(cand) // 2] if cand else [lp for lp in LEGP if lp["iH"] is not None][0]
    spec["LimbUpper"] = dict(ids={leg["i0"]}, M=PARTS[leg["i0"]]["M"], fam="Body", leg=leg)
    spec["LimbLower"] = dict(ids={leg["iL"]}, M=PARTS[leg["iL"]]["M"], fam="Body", leg=leg)
    spec["Hook"] = dict(ids={leg["iH"]}, M=PARTS[leg["iH"]]["M"], fam="Body", leg=leg)
    return spec, dict(head=head, pits=pits, fronds=fronds, par=par, names=names)


def crown_owner_table(info):
    """Owner (bone) per Head part id: from the Own:* tags, the pit order, else the crown."""
    names, par = info["names"], info["par"]
    own = {}
    pit_k = {pid: k for k, pid in enumerate(info["pits"])}
    for i in range(len(PARTS)):
        if not under(i, info["head"], par):
            continue
        j, nm = i, None
        while j and j != info["head"]:
            if names[j].startswith("Own:"):
                nm = names[j][4:]
                break
            if names[j] == "Pit":
                nm = "pit_%d" % pit_k.get(j, 0)
                break
            if names[j] == "PitMembrane":
                nm = "pit_%d" % pit_k.get(par[j], 0)
                break
            j = par[j]
        own[i] = nm or "crown"
    return own


def build_low_module_objects(Alow, spec, coll):
    """One Blender object per module in WORLD pose (the posed creature), decimated to its budget. Per-vertex
    attributes grp (material group id) and part (part id) are re-attached by nearest original vertex."""
    from mathutils.kdtree import KDTree
    arrs = {g: acc_arrays(a) for g, a in Alow.items()}
    out = {}
    for name, sp in spec.items():
        parts = {g: extract_faces(a, sp["ids"]) for g, a in arrs.items() if g not in KIT_SKIP and (name != "Pit" or g == "Pit")}
        parts = {g: m for g, m in parts.items() if m is not None}
        if not parts:
            log("export: module %s empty" % name)
            continue
        Vs, flats, sizes, mats, grp, partid, ms, gs, ds, uvs = [], [], [], [], [], [], [], [], [], []
        off = 0
        for g, m in parts.items():
            Vs.append(m["V"])
            flats.append(m["flat"] + off)
            sizes.append(m["sizes"])
            mats.append(np.full(len(m["sizes"]), 1 if g in EMISSIVE_G else 0, np.int32))
            grp.append(np.full(len(m["V"]), GROUP_IDS[g], np.float32))
            partid.append(m["p"].astype(np.float32))
            ms.append(m["m"])
            gs.append(m["g"])
            ds.append(m["d"])
            uvs.append(m["uv"])
            off += len(m["V"])
        V = np.vstack(Vs)
        flat = np.concatenate(flats)
        sz = np.concatenate(sizes)
        me = mesh_from_arrays("LO_" + name, V, flat, sz, np.vstack(uvs))
        me.materials.append(bpy.data.materials.new("T_%s_A" % name))
        me.materials.append(bpy.data.materials.new("T_%s_E" % name))
        me.polygons.foreach_set("material_index", np.concatenate(mats))
        me.polygons.foreach_set("use_smooth", np.ones(len(sz), bool))
        ob = bpy.data.objects.new("LO_" + name, me)
        coll.objects.link(ob)
        n0 = tri_total(me)
        tgt = KIT_TRIS[name]
        orig = dict(V=V, grp=np.concatenate(grp), part=np.concatenate(partid), m=np.concatenate(ms),
                    g=np.concatenate(gs), d=np.concatenate(ds))
        if n0 > tgt:
            apply_decimate(ob, tgt / n0)
            ob.data.update()
        me = ob.data
        kd = KDTree(len(V))
        for i, v in enumerate(V):
            kd.insert(Vector(v), i)
        kd.balance()
        nn = np.array([kd.find(v.co)[1] for v in me.vertices], np.int64)
        for key in ("grp", "part", "m", "g", "d"):
            set_point_attr(me, key, orig[key][nn])
        # all-smooth with auto-sharp edges: stones read as flat blocks, flesh stays round
        me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
        me.set_sharp_from_angle(angle=math.radians(48))
        sp["n0"] = n0
        sp["obj"] = ob
        sp["orig_V"] = V
        log("export: module %-12s %6d -> %6d tris" % (name, n0, tri_total(me)))
        out[name] = ob
    return out


def bake_atlas(sc, fam, joined, hi_objs, size, outdir, samples_ao=40):
    """Bake base colour, tangent normal, roughness, AO and the metal class from the hi faces onto the joined low
    mesh of one family. Returns dict of image paths (jpg)."""
    imgs, nodes = {}, {}
    mats = [m for m in joined.data.materials]
    for mp in ("albedo", "normal", "rough", "ao", "metal"):
        im = bpy.data.images.new("Mason_%s_%s" % (fam, mp), size, size, alpha=False, float_buffer=False)
        if mp != "albedo":
            im.colorspace_settings.name = "Non-Color"
        imgs[mp] = im
    for mt in mats:
        mt.use_nodes = True
        nt = mt.node_tree
        for n in list(nt.nodes):
            if n.type == "TEX_IMAGE":
                nt.nodes.remove(n)
        nodes.setdefault(mt.name, nt.nodes.new("ShaderNodeTexImage"))

    def target(mp):
        for mt in mats:
            nd = nodes[mt.name]
            nd.image = imgs[mp]
            mt.node_tree.nodes.active = nd

    def bake(mp, typ, samples=1, **kw):
        target(mp)
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        if kw.get("use_selected_to_active", True):
            for h in hi_objs:
                h.select_set(True)
        joined.select_set(True)
        bpy.context.view_layer.objects.active = joined
        sc.cycles.samples = samples
        args_ = dict(type=typ, use_clear=True, margin=10, use_selected_to_active=True, cage_extrusion=0.05,
                     max_ray_distance=0.25)
        args_.update(kw)
        if typ == "NORMAL":
            args_["normal_space"] = "TANGENT"
        t0 = time.time()
        bpy.ops.object.bake(**args_)
        log("export: baked %s/%s in %.0fs" % (fam, mp, time.time() - t0))

    bake("albedo", "DIFFUSE", pass_filter={"COLOR"})
    bake("normal", "NORMAL")
    bake("rough", "ROUGHNESS")
    for h in hi_objs:
        h.hide_render = True
    try:
        bake("ao", "AO", samples=samples_ao, use_selected_to_active=False)
    finally:
        for h in hi_objs:
            h.hide_render = False
    # metal class: flat emission masks on the hi groups (iron-class groups = 0.9, everything else 0)
    saved = []
    mm = {}
    for h in hi_objs:
        gname = h.name.split("__")[0]
        val = 0.9 if GROUP_MASK.get(gname, (0, 0, 0, 0))[3] == 1 / 3 else 0.0
        if val not in mm:
            m_ = bpy.data.materials.new("MASK_%g" % val)
            m_.use_nodes = True
            nt = m_.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Color"].default_value = (val, val, val, 1)
            nt.links.new(em.outputs[0], out.inputs["Surface"])
            mm[val] = m_
        saved.append((h, list(h.data.materials)))
        h.data.materials.clear()
        h.data.materials.append(mm[val])
    bake("metal", "EMIT")
    for h, ml in saved:
        h.data.materials.clear()
        for m_ in ml:
            h.data.materials.append(m_)
    # pack ORM and save
    def px(im):
        a = np.zeros(len(im.pixels), np.float32)
        im.pixels.foreach_get(a)
        return a.reshape(size, size, 4)

    ao, ro, me_ = px(imgs["ao"]), px(imgs["rough"]), px(imgs["metal"])
    orm = np.ones((size, size, 4), np.float32)
    orm[..., 0], orm[..., 1], orm[..., 2] = 0.4 + 0.6 * ao[..., 0], ro[..., 0], me_[..., 0]   # AO lifted: it only dims ambient
    paths = {}
    for mp, q, res in (("albedo", 76, size), ("normal", 78, size), ("orm", 80, size // 4)):
        if mp == "orm":
            im = bpy.data.images.new("Mason_%s_orm" % fam, size, size, alpha=False, float_buffer=False)
            im.colorspace_settings.name = "Non-Color"
            im.pixels.foreach_set(orm.ravel())
            im.update()
            if res != size:
                im.scale(res, res)
        else:
            im = imgs[mp]
        fp = os.path.join(outdir, "Mason_%s_%s.jpg" % (fam, mp))
        im.filepath_raw = fp
        im.file_format = "JPEG"
        im.save(quality=q)
        paths[mp] = fp
        imgs[mp + "_final"] = im
    return paths, imgs


def make_atlas_material(fam, paths):
    m = bpy.data.materials.new("Mason" + fam)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])

    def tex(fp, nc):
        nd = nt.nodes.new("ShaderNodeTexImage")
        im = bpy.data.images.load(fp, check_existing=False)
        im.name = os.path.basename(fp)
        if nc:
            im.colorspace_settings.name = "Non-Color"
        nd.image = im
        return nd

    nt.links.new(tex(paths["albedo"], False).outputs["Color"], bsdf.inputs["Base Color"])
    nrm_ = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(paths["normal"], True).outputs["Color"], nrm_.inputs["Color"])
    nt.links.new(nrm_.outputs["Normal"], bsdf.inputs["Normal"])
    orm = tex(paths["orm"], True)
    sp_ = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sp_.inputs["Color"])
    nt.links.new(sp_.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sp_.outputs["Blue"], bsdf.inputs["Metallic"])
    go = nt.nodes.new("ShaderNodeGroup")
    gout = bpy.data.node_groups.get("glTF Material Output")
    if gout is None:
        gout = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        gout.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    go.node_tree = gout
    nt.links.new(sp_.outputs["Red"], go.inputs["Occlusion"])
    return m


def make_emissive_material():
    m = bpy.data.materials.new("MasonEmissive")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.02, 0.008, 0.005, 1)
    bsdf.inputs["Roughness"].default_value = 0.5
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.26, 0.05, 1)
    bsdf.inputs["Emission Strength"].default_value = 1.6
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return m


def stamp_attributes(name, sp, ob, owner_tbl, info):
    """Rig contract attributes on a module object (module-local frame): _SPINE_S, _MASK, _PART, _OWNER, _OWNER2,
    _OWNW2. Returns the owner-name table written to the node extras."""
    me = ob.data
    n = len(me.vertices)
    co = np.zeros(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(float)
    grp = np.rint(get_point_attr(me, "grp")).astype(int)
    part = np.rint(get_point_attr(me, "part")).astype(int)
    gn = [GROUP_NAMES.get(g, "Stone") for g in grp]
    mask = np.array([GROUP_MASK[g] for g in gn], np.float32)
    blend = np.array([g in BLEND_G for g in gn])
    s_loc = -co[:, 1]                                   # rest arc length from the module origin (head = 0 side)
    owners = {}
    own1 = np.zeros(n)
    own2 = np.full(n, -1.0)
    w2 = np.zeros(n)

    def oid(nm):
        if nm not in owners:
            owners[nm] = len(owners)
        return owners[nm]

    if name == "Head":
        for i in range(n):
            own1[i] = oid(owner_tbl.get(int(part[i]), "crown"))
    elif name in ("Segment_0", "Segment_1", "Segment_2", "Tail"):
        L = sp.get("pitch", 1.24)
        a = oid("spine_k")
        b = oid("spine_k1")
        own1[:] = a
        t = smoothstep(0.0, L, np.clip(s_loc, 0, L))
        own2[blend] = b
        w2[blend] = t[blend]
        if name == "Tail":
            own2[blend] = oid("tail_0")
    elif name == "LimbUpper":
        a, b = oid("leg_0"), oid("spine_k")
        own1[:] = a
        L = float(np.linalg.norm(co[:, 2].max()))
        z = co[:, 2]
        t = 1.0 - smoothstep(0.0, 0.2 * max(z.max(), 1e-3), np.clip(z, 0, None))
        own2[blend] = b
        w2[blend] = t[blend]
    elif name == "LimbLower":
        a, b, c = oid("leg_1"), oid("leg_2"), oid("leg_0")
        jl = sp["leg"].get("jlen", 0.0)
        z = co[:, 2]
        own1[:] = np.where(z > jl * 0.995, b, a)
        near = blend & (z < 0.1)
        own2[near] = c
        w2[near] = 1.0 - smoothstep(0.0, 0.1, z[near])
    elif name == "Hook":
        own1[:] = oid("leg_3")
    elif name.startswith("Frond"):
        own1[:] = oid("frond")
    elif name.startswith("Pit"):
        own1[:] = oid("pit")
    else:
        own1[:] = oid("crown")
    # plate id: connected stone islands (rigid pieces) numbered per module
    import bmesh as _bm
    bm = _bm.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen = np.full(len(bm.verts), -1, np.int64)
    cur = 0
    for v in bm.verts:
        if seen[v.index] >= 0:
            continue
        stack = [v]
        seen[v.index] = cur
        while stack:
            x = stack.pop()
            for e in x.link_edges:
                y = e.other_vert(x)
                if seen[y.index] < 0:
                    seen[y.index] = cur
                    stack.append(y)
        cur += 1
    bm.free()
    set_point_attr(me, "_SPINE_S", s_loc)
    set_point_attr(me, "_MASK", np.column_stack([mask[:, 0], mask[:, 1], mask[:, 2], mask[:, 3]]), "FLOAT_COLOR")
    set_point_attr(me, "_PART", seen.astype(np.float32))
    set_point_attr(me, "_OWNER", own1)
    set_point_attr(me, "_OWNER2", own2)
    set_point_attr(me, "_OWNW2", w2)
    for k in ("grp", "part", "m", "g", "d"):
        if k in me.attributes:
            me.attributes.remove(me.attributes[k])
    return owners


def hi_family_objects(objs, ids, fam, coll):
    """Render-resolution faces (modifiers applied) of the parts in `ids`, one object per material group."""
    import bmesh as _bm
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    idarr = np.fromiter(ids, np.int64)
    for g, ob in objs.items():
        if ob is None or g in ("Ember_unused",):
            continue
        me0 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        if "part" not in me0.attributes:
            bpy.data.meshes.remove(me0)
            continue
        part = np.rint(get_point_attr(me0, "part")).astype(np.int64)
        nf = len(me0.polygons)
        ls = np.zeros(nf, np.int32)
        lt = np.zeros(nf, np.int32)
        me0.polygons.foreach_get("loop_start", ls)
        me0.polygons.foreach_get("loop_total", lt)
        lv = np.zeros(len(me0.loops), np.int32)
        me0.loops.foreach_get("vertex_index", lv)
        vin = np.isin(part, idarr)
        ok = np.add.reduceat(vin[lv].astype(np.int64), ls) == lt if nf else np.zeros(0, bool)
        if not ok.any():
            bpy.data.meshes.remove(me0)
            continue
        bm = _bm.new()
        bm.from_mesh(me0)
        bm.faces.ensure_lookup_table()
        kill = [bm.faces[i] for i in np.nonzero(~ok)[0]]
        if kill:
            _bm.ops.delete(bm, geom=kill, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            _bm.ops.delete(bm, geom=loose, context="VERTS")
        me = bpy.data.meshes.new("HI_%s_%s" % (g, fam))
        bm.to_mesh(me)
        bm.free()
        bpy.data.meshes.remove(me0)
        me.materials.append(ob.active_material)
        o = bpy.data.objects.new("%s__%s" % (g, fam), me)
        coll.objects.link(o)
        out.append(o)
    return out


# v2: texel density by importance (linear UV scale before packing): what the climber looks at gets the atlas
UV_WEIGHT = {"Mask": 1.7, "Teeth": 1.5, "Eye": 1.7, "Skin": 1.2, "Bone": 1.15, "Gum": 0.95, "Flesh": 0.8, "Tendon": 0.75,
             "Stone": 0.7, "Carved": 0.8, "Iron": 0.8, "Membrane": 0.7, "Rope": 0.8, "Marrow": 0.75, "Vein": 0.7}


def uv_pack_family(joined, size, fam=""):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = joined
    joined.select_set(True)
    me = joined.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.uv.smart_project(angle_limit=math.radians(80), island_margin=3.0 / size)
    bpy.ops.object.mode_set(mode="OBJECT")
    _PLANAR.clear()
    if fam == "Crown" and CROWN.get("mask_parts"):
        try:
            _uv_face_planar(joined)
        except Exception as e:  # noqa: BLE001
            log("uv face planar:", e)
    try:
        _uv_weight_islands(joined)
    except Exception as e:  # noqa: BLE001
        log("uv weights:", e)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=3.0 / size)
    except Exception as e:
        log("pack_islands:", e)
    bpy.ops.object.mode_set(mode="OBJECT")


def _uv_face_planar(ob):
    """v2: the front of each half of the face gets ONE planar island (projected on the face plane): smart projection shatters the
    decimated relief into hundreds of slivers, and the face is what the climber stares at."""
    import bmesh as _bm
    me = ob.data
    part = np.rint(get_point_attr(me, "part")).astype(int)
    grp = np.rint(get_point_attr(me, "grp")).astype(int)
    fx, fy, fz, fo = (np.asarray(CROWN["face"][k], float) for k in ("x", "y", "z", "o"))
    bm = _bm.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    # texel scale of the smart projection (UV units per metre), so the planar islands start at the same density
    ratios = []
    for f in list(bm.faces)[::7]:
        a3 = f.calc_area()
        if a3 < 1e-6 or len(f.loops) != 3 and len(f.loops) != 4:
            continue
        uv = [l[uvl].uv for l in f.loops]
        a2 = 0.0
        for i in range(1, len(uv) - 1):
            a2 += abs((uv[i][0] - uv[0][0]) * (uv[i + 1][1] - uv[0][1]) - (uv[i + 1][0] - uv[0][0]) * (uv[i][1] - uv[0][1])) / 2
        if a2 > 0:
            ratios.append(a2 / a3)
    k = math.sqrt(float(np.median(ratios))) if ratios else 0.05
    mid = GROUP_IDS["Mask"]
    n = 0
    _PLANAR.clear()
    for sgn, pid in CROWN["mask_parts"].items():
        off = 0.0 if sgn < 0 else 4.0 / max(k, 1e-6)          # keep the two halves apart before packing
        for f in bm.faces:
            vs = [v.index for v in f.verts]
            if any(part[i] != pid or grp[i] != mid for i in vs):
                continue
            if np.dot(np.array(f.normal[:]), fz) < 0.15:
                continue
            for l in f.loops:
                p = np.array(l.vert.co[:]) - fo
                l[uvl].uv = ((float(p @ fx) + off) * k, float(p @ fy) * k)
            _PLANAR.add(f.index)
            n += 1
    bm.to_mesh(me)
    bm.free()
    log("uv face planar: %d faces on 2 islands (k %.4f)" % (n, k))


_PLANAR = set()          # faces of the planar face islands (this family's pack)
UV_FACE_FRONT = 2.2      # the front of the face
UV_MASK_HIDDEN = 0.45    # the back and the broken walls of the mask halves


def _uv_weight_islands(ob):
    """Scale every UV island about its centre by its importance (the packer then fits them all): the front of the face first, then the
    part's own weight (CROWN["uvw"]: the cowl, neck and throat get little), else its material group's (UV_WEIGHT)."""
    import bmesh as _bm
    from bpy_extras.bmesh_utils import bmesh_linked_uv_islands
    me = ob.data
    grp = np.rint(get_point_attr(me, "grp")).astype(int)
    part = np.rint(get_point_attr(me, "part")).astype(int)
    pw = CROWN.get("uvw") or {}
    mparts = set((CROWN.get("mask_parts") or {}).values())
    bm = _bm.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    n = 0
    for isl in bmesh_linked_uv_islands(bm, uvl):
        gs = [grp[v.index] for f in isl for v in f.verts]
        ps = [part[v.index] for f in isl for v in f.verts]
        gname = GROUP_NAMES.get(max(set(gs), key=gs.count), "Stone")
        pid = max(set(ps), key=ps.count)
        if _PLANAR and isl[0].index in _PLANAR:
            w = UV_FACE_FRONT
        elif pid in mparts:
            w = UV_MASK_HIDDEN
        elif pid in pw:
            w = pw[pid]
        else:
            w = UV_WEIGHT.get(gname, 1.0)
        if abs(w - 1.0) < 1e-3:
            continue
        uvs = np.array([l[uvl].uv[:] for f in isl for l in f.loops])
        c = 0.5 * (uvs.min(0) + uvs.max(0))
        for f in isl:
            for l in f.loops:
                l[uvl].uv = (c[0] + (l[uvl].uv[0] - c[0]) * w, c[1] + (l[uvl].uv[1] - c[1]) * w)
        n += 1
    bm.to_mesh(me)
    bm.free()
    log("uv weights: %d islands rescaled" % n)


def split_module(joined, slot_names, name, coll):
    """New mesh with only the faces of the module's material slots (UVs / attributes kept)."""
    import bmesh as _bm
    bm = _bm.new()
    bm.from_mesh(joined.data)
    slot_of = {}
    for i, m in enumerate(joined.data.materials):
        slot_of[i] = m.name
    kill = [f for f in bm.faces if slot_of.get(f.material_index, "") not in slot_names]
    if kill:
        _bm.ops.delete(bm, geom=kill, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        _bm.ops.delete(bm, geom=loose, context="VERTS")
    # remember which faces were emissive (slot name ends with _E)
    for f in bm.faces:
        f.material_index = 1 if slot_of[f.material_index].endswith("_E") else 0
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def export_production():
    global LOW, rng, A, ENV
    outd = args.export
    texd = os.path.join(outd, "textures")
    os.makedirs(texd, exist_ok=True)
    sc = bpy.context.scene
    t0 = time.time()
    hiA = A
    hi_objs_all = {k: bpy.data.objects.get("Ossuary_" + k) for k in hiA}
    # ---- the game-tessellation rebuild (same RNG stream, same part tags)
    LOW = True
    rng = random.Random(SEED)
    A = {k: Acc("Ossuary_G_" + k) for k in hiA}
    ENV = {k: Acc("Shaft_G_" + k) for k in ENV}
    VERTS.clear()
    LEG_LOG.clear()
    LEGP.clear()
    del PARTS[1:]
    PART_STACK[:] = [0]
    build_creature()
    LOW = False
    Alow = A
    A = hiA
    log("export: low rebuild %.0fs" % (time.time() - t0))
    spec, info = kit_specs(Alow)
    owner_tbl = crown_owner_table(info)
    game = bpy.data.collections.new("Game")
    sc.collection.children.link(game)
    # per-module temporary materials (A atlas / E emissive): the join keeps module identity through the slots
    modobs = build_low_module_objects(Alow, spec, game)
    # ---- per-atlas bake
    gmats = {}
    emissive = make_emissive_material()
    final = {}
    for fam, members in KIT_FAMILY.items():
        mods = [m for m in members if m in modobs]
        copies = []
        for m in mods:
            o = modobs[m].copy()
            o.data = modobs[m].data.copy()
            o.name = "J_%s" % m
            game.objects.link(o)
            copies.append(o)
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        for o in copies:
            o.select_set(True)
        bpy.context.view_layer.objects.active = copies[0]
        bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = "JOINED_" + fam
        size = ATLAS_PX[fam]
        uv_pack_family(joined, size, fam)
        log("export: %s joined %d tris, uv packed" % (fam, tri_total(joined.data)))
        # hi faces of exactly these parts
        ids = set()
        for m in mods:
            ids |= spec[m]["ids"]
        hi = hi_family_objects(hi_objs_all, ids, fam, game)
        log("export: %s hi parts: %s" % (fam, ", ".join("%s %d" % (h.name.split('__')[0], len(h.data.polygons)) for h in hi)))
        for o in bpy.context.view_layer.objects:
            o.hide_render = True
        for h in hi:
            h.hide_render = False
        joined.hide_render = False
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.use_denoising = False
        vols = [n for n in (sc.world.node_tree.nodes if sc.world else []) if n.type == "VOLUME_SCATTER"]
        vol_d = [n.inputs["Density"].default_value for n in vols]
        for n in vols:
            n.inputs["Density"].default_value = 0.0
        ao_dist = sc.world.light_settings.distance if sc.world else None
        if sc.world:
            sc.world.light_settings.distance = 0.6
        if args.nobake:
            paths = {k: None for k in ("albedo", "normal", "orm")}
        else:
            paths, imgs = bake_atlas(sc, fam, joined, hi, size, texd)
        for n, d_ in zip(vols, vol_d):
            n.inputs["Density"].default_value = d_
        if sc.world and ao_dist is not None:
            sc.world.light_settings.distance = ao_dist
        gmats[fam] = make_atlas_material(fam, paths) if not args.nobake else bpy.data.materials.new("Mason" + fam)
        # separate back into modules
        for m in mods:
            me = split_module(joined, ("T_%s_A" % m, "T_%s_E" % m), "Mason_" + m, game)
            me.materials.append(gmats[fam])
            me.materials.append(emissive)
            Minv = np.linalg.inv(spec[m]["M"])
            me.transform(Matrix(Minv.tolist()))
            ob = bpy.data.objects.new("Mason_" + m, me)
            game.objects.link(ob)
            final[m] = ob
        for h in hi:
            bpy.data.objects.remove(h)
        bpy.data.objects.remove(joined)
    for o in list(modobs.values()):
        bpy.data.objects.remove(o)
    # ---- LOD1 twins + stamped rig attributes
    lod1 = {}
    for m, ob in list(final.items()):
        from mathutils.kdtree import KDTree
        o1 = ob.copy()
        o1.data = ob.data.copy()
        o1.name = o1.data.name = ob.name + "_LOD1"
        game.objects.link(o1)
        n0 = tri_total(o1.data)
        apply_decimate(o1, LOD1_RATIO)
        me0, me1 = ob.data, o1.data
        c0 = np.zeros(len(me0.vertices) * 3, np.float32)
        me0.vertices.foreach_get("co", c0)
        c0 = c0.reshape(-1, 3)
        kd = KDTree(len(c0))
        for i, v in enumerate(c0):
            kd.insert(Vector(v), i)
        kd.balance()
        nn = np.array([kd.find(v.co)[1] for v in me1.vertices], np.int64)
        for key in ("grp", "part"):
            set_point_attr(me1, key, get_point_attr(me0, key)[nn])
        me1.polygons.foreach_set("use_smooth", np.ones(len(me1.polygons), bool))
        me1.set_sharp_from_angle(angle=math.radians(48))
        lod1[m] = o1
        log("export: LOD1 %-12s %6d -> %6d tris" % (m, n0, tri_total(me1)))
    leg = spec["LimbLower"]["leg"]
    own_tabs = {}
    for m, ob in final.items():
        sp = spec[m]
        if m == "LimbLower":
            sp["leg"]["jlen"] = float(np.linalg.norm(np.asarray(leg["J"]) - np.asarray(leg["Kb"])))
        if m.startswith("Segment") or m == "Tail":
            sp["pitch"] = SEG_STEP * VERTS[sp["vert"]]["k"]
        own_tabs[m] = stamp_attributes(m, sp, ob, owner_tbl, info)
        stamp_attributes(m, sp, lod1[m], owner_tbl, info)
        rm_ = dict(module=m, owners={str(v): k for k, v in own_tabs[m].items()})
        if m == "Head" and CROWN.get("pivots"):
            rm_["pivots"] = CROWN["pivots"]          # v2: the joints the builder knows (glTF axes, Head module frame)
        ob["rig_module"] = json.dumps(rm_)
        lod1[m]["rig_module"] = ob["rig_module"]
        M = spec[m]["M"]
        ob["pivot_world"] = json.dumps([[round(float(x), 5) for x in r] for r in np.asarray(M)])
    return dict(final=final, lod1=lod1, spec=spec, info=info, owners=own_tabs, game=game, gmats=gmats,
                emissive=emissive)


def export_glb(objs, fn, quality=88):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=fn, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
              export_texcoords=True, export_normals=True, export_tangents=False, export_attributes=True,
              export_extras=True, export_materials="EXPORT", export_cameras=False, export_lights=False,
              export_animations=False, export_skins=False, export_vertex_color="NONE",
              export_all_vertex_colors=False, export_active_vertex_color_when_no_material=False)
    try:
        bpy.ops.export_scene.gltf(export_image_format="JPEG", export_jpeg_quality=quality, **kw)
    except TypeError as e:
        log("gltf export fallback:", e)
        bpy.ops.export_scene.gltf(**kw)
    return os.path.getsize(fn)


def leg_scale(lp, tmpl):
    """Non-uniform scale taking the template leg's modules to leg `lp` (bone lengths, thickness)."""
    kk = lambda L: (L["k"] ** 0.6) * (L["size"] ** 0.85)
    sxy = kk(lp) / kk(tmpl)
    sz_u = np.linalg.norm(np.asarray(lp["K"]) - np.asarray(lp["R0"])) / np.linalg.norm(np.asarray(tmpl["K"]) - np.asarray(tmpl["R0"]))
    sz_l = np.linalg.norm(np.asarray(lp["J"]) - np.asarray(lp["Kb"])) / np.linalg.norm(np.asarray(tmpl["J"]) - np.asarray(tmpl["Kb"]))
    return sxy, sz_u, sz_l


def assemble_hero(prod, coll, budget0=60000, budget1=25000):
    """Instance the kit modules along the posed spine: one hierarchy per LOD (shared meshes, instanced nodes)."""
    final, lod1, spec = prod["final"], prod["lod1"], prod["spec"]
    tri = {m: (tri_total(final[m].data), tri_total(lod1[m].data)) for m in final}
    roots = []
    made = {0: [], 1: []}
    for li in (0, 1):
        r = bpy.data.objects.new("Mason_Hero_LOD%d" % li, None)
        coll.objects.link(r)
        roots.append(r)
    total = {0: 0, 1: 0}

    def inst(li, m, mat, name):
        src = (final if li == 0 else lod1)[m]
        o = bpy.data.objects.new(name, src.data)
        for k in src.keys():
            o[k] = src[k]
        coll.objects.link(o)
        o.parent = roots[li]
        o.matrix_world = Matrix(np.asarray(mat).tolist())
        total[li] += tri[m][li]
        made[li].append(o)

    def both(m, mat, name):
        for li in (0, 1):
            inst(li, m, mat, name)

    # crown
    both("Head", spec["Head"]["M"], "Mason_Head")
    # vertebrae: three variants by hash; the last one is the tail module
    nvert = len(VERTS)
    ktmpl = {q: VERTS[spec["Segment_%d" % q]["vert"]]["k"] for q in range(3)}
    for idx, v in enumerate(VERTS):
        if idx == nvert - 1:
            kt = VERTS[spec["Tail"]["vert"]]["k"]
            S_ = np.diag([v["k"] / kt] * 3 + [1.0])
            both("Tail", np.asarray(v["M"]) @ S_, "Mason_Tail")
            continue
        q = int(hash1_py(idx * 7 + 3) * 3)
        S_ = np.diag([v["k"] / ktmpl[q]] * 3 + [1.0])
        both("Segment_%d" % q, np.asarray(v["M"]) @ S_, "Mason_Segment_%d_v%02d" % (q, idx))
    # legs: nearest the crown first (they read best); LOD0 stops at the triangle budget, LOD1 takes them all
    tmpl = spec["LimbUpper"]["leg"]
    legs = [lp for lp in LEGP if lp["iH"] is not None and lp["kind"] in ("normal", "lifted", "reach")]
    legs.sort(key=lambda lp: lp["vi"] + (0 if lp["kind"] == "reach" else 1))
    for li, budget in ((0, budget0), (1, budget1)):
        for n_, lp in enumerate(legs):
            cost = sum(tri[m][li] for m in ("LimbUpper", "LimbLower", "Hook"))
            if total[li] + cost > budget:
                continue
            sxy, szu, szl = leg_scale(lp, tmpl)
            for m, key, sz in (("LimbUpper", "i0", szu), ("LimbLower", "iL", szl), ("Hook", "iH", sxy)):
                S_ = np.diag([sxy, sxy, sz, 1.0])
                inst(li, m, np.asarray(PARTS[lp[key]]["M"]) @ S_, "Mason_%s_leg%02d" % (m, n_))
    return roots, made, total


def hash1_py(n):
    x = (int(n) ^ 0x9E3779B9) & 0xFFFFFFFF
    x = (x * 0x85EBCA6B) & 0xFFFFFFFF
    x ^= x >> 13
    x = (x * 0xC2B2AE35) & 0xFFFFFFFF
    x ^= x >> 16
    return (x & 0xFFFFFFFF) / 4294967296.0


def render_kit_sheet(prod, fn, res=(1280, 720), samples=32):
    """A module sheet: crown, three vertebra variants, tail, leg modules, frond and pit, lit like the game."""
    sc = bpy.context.scene
    final = prod["final"]
    sheet = bpy.data.collections.new("KitSheet")
    sc.collection.children.link(sheet)
    objs = []

    def put(m, x, y, s=1.0, rot_z=0.0, rot_x=0.0):
        o = bpy.data.objects.new("S_" + m, final[m].data)
        sheet.objects.link(o)
        o.location = (x, y, 0)
        o.scale = (s, s, s)
        o.rotation_euler = (rot_x, 0, rot_z)
        objs.append(o)
        return o

    put("Head", -9.5, 0, 0.75, rot_z=0.0, rot_x=math.radians(90))
    put("Segment_0", -3.0, 2.6, 1.0, rot_x=math.radians(90))
    put("Segment_1", 0.2, 2.6, 1.0, rot_x=math.radians(90))
    put("Segment_2", 3.4, 2.6, 1.0, rot_x=math.radians(90))
    put("Tail", 7.0, 2.6, 1.0, rot_x=math.radians(90))
    put("LimbUpper", -3.0, -2.2, 0.6)
    put("LimbLower", -0.8, -2.2, 0.6)
    put("Hook", 1.2, -2.2, 1.0)
    for q in range(3):
        put("Frond_%d" % q, 3.4 + 1.1 * q, -2.0, 1.5, rot_x=math.radians(90))
    put("Pit", 7.5, -2.0, 1.6, rot_x=math.radians(90))
    for ob in objs:
        ob.hide_render = False
    for o in bpy.context.view_layer.objects:
        if o not in objs:
            o.hide_render = True
    cam = bpy.data.objects.new("CAM_Kit", bpy.data.cameras.new("CAM_Kit"))
    sc.collection.objects.link(cam)
    cam.data.lens = 38
    cam.location = (-0.5, -26.0, 1.0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    lights = []
    for nm, loc, en, col in (("K1", (-6, -12, 9), 3000, (0.9, 0.92, 1.0)), ("K2", (8, -10, 3), 1500, (1.0, 0.8, 0.6))):
        ld = bpy.data.lights.new(nm, "POINT")
        ld.energy = en
        ld.color = col
        ld.shadow_soft_size = 1.5
        lo = bpy.data.objects.new(nm, ld)
        sc.collection.objects.link(lo)
        lo.location = loc
        lights.append(lo)
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.014, 0.018, 1)
    sc.view_settings.view_transform = "AgX"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.render.use_compositing = False
    except Exception:
        pass
    sc.render.filepath = fn
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return fn


def _pack_glb(fn):
    """Pack the rig-contract vertex attributes (wip/creature/pack_glb.py) to keep the kit within its size budget."""
    import subprocess
    pk = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wip", "creature", "pack_glb.py")
    subprocess.run([sys.executable, pk, fn], check=True)


def run_production(creature, env):
    """Bake + export the kit and the hero, report budgets."""
    outd = args.export
    sc = bpy.context.scene
    creature.hide_render = True
    for ob in env.objects:
        ob.hide_render = True
    t0 = time.time()
    prod = export_production()
    final, lod1, spec = prod["final"], prod["lod1"], prod["spec"]
    game = prod["game"]
    report = dict(modules={}, files={})
    for m in final:
        report["modules"][m] = dict(lod0=tri_total(final[m].data), lod1=tri_total(lod1[m].data),
                                    owners=prod["owners"][m])
    kit_objs = list(final.values()) + list(lod1.values())
    fk = os.path.join(outd, "mason_kit.glb")
    report["files"]["mason_kit.glb"] = export_glb(kit_objs, fk)
    _pack_glb(fk)
    report["files"]["mason_kit.glb"] = os.path.getsize(fk)
    log("export: kit %.2f MB" % (report["files"]["mason_kit.glb"] / 1e6))
    roots, made, total = assemble_hero(prod, game)
    report["hero"] = dict(lod0_tris=total[0], lod1_tris=total[1], nodes_lod0=len(made[0]), nodes_lod1=len(made[1]))
    fh = os.path.join(outd, "mason_hero.glb")
    report["files"]["mason_hero.glb"] = export_glb(roots + made[0] + made[1], fh)
    _pack_glb(fh)
    report["files"]["mason_hero.glb"] = os.path.getsize(fh)
    log("export: hero %.2f MB, LOD0 %d tris, LOD1 %d tris" % (report["files"]["mason_hero.glb"] / 1e6, total[0], total[1]))
    with open(os.path.join(outd, "export_report.json"), "w") as fh_:
        json.dump(report, fh_, indent=2)
    log("export done in %.0fs" % (time.time() - t0))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    creature = bpy.data.collections.new("Ossuary")
    env = bpy.data.collections.new("Shaft")
    sc.collection.children.link(creature)
    sc.collection.children.link(env)

    build_creature()
    build_env()

    mats = dict(Stone=mat_stone(), Carved=mat_stone("M_StoneCarved", (1.04, 1.0, 0.96), carved=True),
                Flesh=mat_flesh(), Marrow=mat_flesh("M_Marrow", dark=True, glowmul=1.0), Tendon=mat_tendon(),
                Bone=mat_bone(), Iron=mat_iron(), Teeth=mat_teeth(), Ember=mat_ember(9.0), Frond=mat_frond(),
                Mucus=mat_mucus(), Vein=mat_vein(), Membrane=mat_membrane(),
                Gum=mat_flesh("M_Gum", gum=True, glowmul=1.0), Pit=mat_pit(), Bronze=mat_bronze(),
                Seam=mat_seam(), Glass=mat_glass(), Rope=mat_rope(), Oil=mat_oil(), IronTooth=mat_iron_tooth(),
                Soot=mat_soot(), Mask=mat_mask(), Eye=mat_eye(), Skin=mat_skin())
    for k, mt in mats.items():
        try:
            mt.cycles.emission_sampling = "AUTO" if k in ("Ember", "Pit") else "NONE"
        except Exception as e:
            log("emission_sampling:", e)
    flat = {"Stone"}
    objs = {}
    for k, acc in A.items():
        ob = acc.build(mats[k], creature, smooth=k not in flat,
                       sharp=math.radians(40) if k in ("Carved", "Iron", "Bronze", "IronTooth", "Mask") else None)
        objs[k] = ob
    log("meshes built")
    tex = bpy.data.textures.new("StoneGrain", "CLOUDS")
    tex.noise_scale = 0.16
    tex.noise_depth = 3
    tex2 = bpy.data.textures.new("StoneChunks", "VORONOI")
    tex2.noise_scale = 0.28
    for k in ("Stone", "Carved"):
        ob = objs[k]
        if ob is None:
            continue
        md = ob.modifiers.new("Grain", "SUBSURF")
        md.subdivision_type = "SIMPLE"
        md.levels = md.render_levels = args.grain
        d1 = ob.modifiers.new("Chunks", "DISPLACE")
        d1.texture = tex2
        d1.texture_coords = "GLOBAL"
        d1.strength = 0.04
        d1.mid_level = 0.5
        d2 = ob.modifiers.new("Grain", "DISPLACE")
        d2.texture = tex
        d2.texture_coords = "GLOBAL"
        d2.strength = 0.016
        d2.mid_level = 0.5
    for k in ("Marrow", "Gum"):
        ob = objs[k]
        md = ob.modifiers.new("Smooth", "SUBSURF")
        md.levels = md.render_levels = 1

    envm = dict(Rock=mat_wall(), Masonry=mat_stone("M_Masonry", (0.95, 0.95, 0.97), value=0.9),
                Iron=mats["Iron"], Glow=mat_lamp("M_LanternGlow", (1.0, 0.5, 0.18), 40.0),
                Rubble=mat_stone("M_Rubble", (0.8, 0.78, 0.76), wet=0.3), Oil=mats["Oil"],
                Crack=mat_matte("M_Crack", (0.002, 0.002, 0.002), 0.6), Puddle=mat_puddle(),
                Climber=mat_matte("M_Climber", (0.025, 0.022, 0.02), 0.85), Rope=mats["Rope"])
    env_objs = {}
    for k, acc in ENV.items():
        env_objs[k] = acc.build(envm[k], env, smooth=k not in ("Masonry", "Rubble"))
    ob = env_objs["Masonry"]
    md = ob.modifiers.new("Grain", "SUBSURF")
    md.subdivision_type = "SIMPLE"
    md.levels = md.render_levels = 1
    d2 = ob.modifiers.new("Grain", "DISPLACE")
    d2.texture = tex
    d2.texture_coords = "GLOBAL"
    d2.strength = 0.03

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
    mouth = CROWN["mouth_front"]
    L_throat = light("L_Throat", "POINT", CROWN["throat_light"], 2.0, (1.0, 0.2, 0.04), 0.12)
    L_mouth = light("L_Mouth", "POINT", CROWN["mouth_light"], 1.2, (1.0, 0.24, 0.06), 0.3)
    L_mouth2 = light("L_Mouth2", "POINT", CROWN["mouth_light2"], 1.0, (1.0, 0.2, 0.05), 0.3)
    L_forge = light("L_Forge", "POINT", CROWN["forge"] - Tc * 0.15, 6.0, (1.0, 0.16, 0.03), 0.15)
    L_top = light("L_ShaftTop", "SPOT", (1.0, -11.0, 50.0), 300000.0, (0.55, 0.7, 1.0), 2.5,
                  target=(0.0, -1.5, 10.0), spot=math.radians(46), blend=0.7)
    hc = [float(x) for x in args.herocam.split(",")]
    hero_cam_loc = C + Tc * hc[0] + np.array([0, 0, hc[1]]) + Sc * hc[2]
    hero_target = C + Tc * hc[3] + np.array([0, 0, hc[4]]) + Sc * hc[5]
    h_right = nrm(np.cross(hero_target - hero_cam_loc, UP))
    # the player's helmet lamp: a single cold, low key from just below the lens (under-lights the crown)
    L_helm_h = light("L_HelmetHero", "SPOT", hero_cam_loc + np.array([0, 0, -1.1]) + h_right * 1.4,
                     args.hero_light, (0.8, 0.88, 1.0), 0.03, target=C + Tc * 0.2, spot=math.radians(52), blend=0.8)
    L_rimc = light("L_RimCold", "SPOT", C - Tc * 2.5 + Dc * 3.5 + UP * 4.0, 2600.0, (0.55, 0.68, 1.0), 0.3,
                   target=C + Tc * 0.6, spot=math.radians(60), blend=0.8)
    L_lant_f = light("L_LanternFull", "POINT", LANTERN["pos"], 2600.0, (1.0, 0.5, 0.18), 0.15)
    L_ffill = light("L_FullFill", "AREA", (14.0, -26.0, 26.0), 3500.0, (0.6, 0.72, 0.95), target=(-1.0, -1.0, 12.0))
    L_ffill.data.size = 10.0
    L_miner = light("L_Miner", "POINT", LANTERN.get("miner", C), 6.0 if "miner" in LANTERN else 0.0, (1.0, 0.5, 0.2), 0.04)
    L_cage = light("L_CageLantern", "POINT", LANTERN.get("cage", C), 8.0, (1.0, 0.45, 0.16), 0.04)
    clamp_, cfwd = LANTERN["climber"]
    L_climb = light("L_ClimberLamp", "SPOT", clamp_ + cfwd * 0.05, 2500.0, (0.8, 0.88, 1.0), 0.02,
                    target=C + Tc * 0.5 - Dc * 1.2, spot=math.radians(24), blend=0.6)
    ac = [float(x) for x in args.approachcam.split(",")]
    app_loc = C + Tc * ac[0] + np.array([0, 0, ac[1]]) + Sc * ac[2] + Dc * ac[3]
    app_target = C + Tc * ac[4] + np.array([0, 0, ac[5]]) + Sc * ac[6]
    app_right = nrm(np.cross(app_target - app_loc, UP))
    L_player = light("L_PlayerHelmet", "SPOT", app_loc + np.array([0, 0, -0.3]) - app_right * 0.2, args.app_light,
                     (0.8, 0.88, 1.0), 0.02, target=C + Tc * 0.1, spot=math.radians(62), blend=0.7)

    # ------------------------------------------------------------------ cameras
    def camera(name, loc, target, lens, up=None):
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        cd.clip_start = 0.05
        cd.clip_end = 400
        ob = bpy.data.objects.new(name, cd)
        sc.collection.objects.link(ob)
        ob.location = Vector(loc)
        d = Vector(target) - Vector(loc)
        if up is None:
            ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        else:          # roll the camera so `up` is up in the frame (design shots: the face upright)
            zc = -nrm(np.array(d[:]))
            yc = nrm(np.asarray(up, float) - np.dot(up, zc) * zc)
            xc = np.cross(yc, zc)
            ob.rotation_euler = Matrix(np.stack([xc, yc, zc], 1).tolist()).to_euler()
        return ob

    tips = CROWN["tips"]
    cam_hero = camera("CAM_Hero", hero_cam_loc, hero_target, hc[6])
    cam_hero.data.dof.use_dof = True
    cam_hero.data.dof.focus_distance = float(np.linalg.norm(hero_cam_loc - mouth))
    cam_hero.data.dof.aperture_fstop = 4.0
    fc = [float(x) for x in args.fullcam.split(",")]
    cam_full = camera("CAM_Full", fc[0:3], fc[3:6], fc[6])
    cam_app = camera("CAM_Approach", app_loc, app_target, ac[7])
    cam_app.data.dof.use_dof = True
    near_tip = tips[np.argsort(np.linalg.norm(tips - app_loc, axis=1))[:4]].mean(0)
    cam_app.data.dof.focus_distance = float(np.linalg.norm(app_loc - near_tip))
    cam_app.data.dof.aperture_fstop = args.app_fstop
    # VR-distance close-up of one vertebra and its leg root (texture/detail validation at 1-3 m)
    dv_ = min(VERTS, key=lambda v: abs(v["s"] - 10.5))
    Od, Td, Dd, Sd = spine_frame(dv_["s"])
    sgd = 1.0 if np.dot(Sd, np.array(fc[0:3]) - Od) >= 0 else -1.0
    det_loc = Od + Sd * sgd * args.detail_cam[0] + Dd * args.detail_cam[1] + Td * args.detail_cam[2]
    det_tgt = Od + Sd * sgd * 0.85 + Dd * 0.75
    cam_det = camera("CAM_Detail", det_loc, det_tgt, 24)
    cam_det.data.dof.use_dof = True
    cam_det.data.dof.focus_distance = float(np.linalg.norm(det_loc - det_tgt))
    cam_det.data.dof.aperture_fstop = 5.6
    L_det = light("L_DetailHelmet", "SPOT", det_loc + UP * 0.3 - Td * 0.4, args.detail_cam[3], (0.8, 0.88, 1.0), 0.03,
                  target=det_tgt, spot=math.radians(60), blend=0.7)
    # v2 design shots: what the climber sees by his own warm lantern (game), and the head in profile
    gcv = [float(x) for x in args.gamecam.split(",")]
    face_c = CROWN["face"]["FW"](np.array([0.0, 1.0, FACE_Z0]))[0]
    g_loc = C + Tc * gcv[0] + Dc * gcv[1] + Sc * gcv[2]
    cam_game = camera("CAM_Game", g_loc, face_c, gcv[3], up=Dc)
    g_right = nrm(np.cross(face_c - g_loc, Dc))
    L_lant = light("L_PlayerLantern", "POINT", g_loc - Dc * 0.45 + g_right * 0.3 + Tc * 0.2, args.lantern, (1.0, 0.6, 0.3), 0.06)
    p_loc = C + Sc * 10.5 + Tc * 2.0 + Dc * 0.3
    cam_prof = camera("CAM_Profile", p_loc, C + Tc * 0.3 + Dc * 0.8, 24, up=Dc)
    L_plant = light("L_ProfileLantern", "POINT", p_loc - Dc * 0.4 + Tc * 1.5, args.lantern * 1.3, (1.0, 0.6, 0.3), 0.06)
    L_amb = light("L_ColdAmbient", "SUN", C + Dc * 10.0, 0.012, (0.55, 0.68, 0.85), 3.0, target=C)
    bc = [float(x) for x in args.belowcam.split(",")]
    below_loc = wall_point(bc[0], bc[1], bc[2], disp=False)[0]
    below_tgt = wall_point(bc[3], bc[4], bc[5], disp=False)[0]
    cam_below = camera("CAM_Below", below_loc, below_tgt, bc[6])
    log("approach cam", np.round(app_loc, 2), "dist to crown %.2f, focus %.2f" % (
        np.linalg.norm(app_loc - C), cam_app.data.dof.focus_distance))

    # ------------------------------------------------------------------ world
    world = bpy.data.worlds.new("Abyss")
    sc.world = world
    wnt = world.node_tree
    for n in list(wnt.nodes):
        wnt.nodes.remove(n)
    wout = wnt.nodes.new("ShaderNodeOutputWorld")
    bg = wnt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.0025, 0.003, 0.0042, 1)
    bg.inputs["Strength"].default_value = 1.0
    wnt.links.new(bg.outputs[0], wout.inputs["Surface"])
    vol = wnt.nodes.new("ShaderNodeVolumeScatter")
    vol.inputs["Color"].default_value = (0.62, 0.66, 0.72, 1)
    vol.inputs["Anisotropy"].default_value = 0.35
    wnt.links.new(vol.outputs[0], wout.inputs["Volume"])
    try:
        world.mist_settings.start = 3.0
        world.mist_settings.depth = 26.0
        world.mist_settings.falloff = "QUADRATIC"
    except Exception as e:
        log("mist settings:", e)
    sc.view_layers[0].use_pass_mist = True

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
    cy.glossy_bounces = 2
    cy.transmission_bounces = 4
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
            vs.exposure = args.exposure
        else:
            vs.view_transform = "Standard"
            vs.look = "None"
            vs.exposure = 0.0

    silhouette_mat = mat_flat_black()
    mist_sock = None
    comp_ok = False
    try:
        mist_sock = setup_compositor(sc, glare=True, vignette=0.55)
        comp_ok = True
    except Exception as e:
        log("compositor unavailable:", e)
    all_lights = [L_mouth, L_mouth2, L_throat, L_forge, L_top, L_helm_h, L_rimc, L_lant_f, L_ffill, L_miner, L_cage, L_climb, L_player,
                  L_det, L_lant, L_plant, L_amb]

    def show_lights(on):
        for ob in all_lights:
            ob.hide_render = ob.name not in on

    stats = dict(seed=SEED, spine_length_m=round(L_TOTAL, 2), vertebrae=len(VERTS), legs=len(LEG_LOG) + 1,
                 creature_triangles=total, triangles_by_group=tris)
    with open(os.path.join(OUT, "stats.json"), "w") as fh:
        json.dump(stats, fh, indent=2)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "ossuary.blend"))
    game_lods = None

    for shot in SHOTS:
        t0 = time.time()
        sc.view_layers[0].material_override = None
        for ob in env.objects:
            ob.hide_render = False
        env_objs["Climber"].hide_render = shot not in ("full", "lod0")
        if mist_sock is not None:
            mist_sock.default_value = 0.0
        if shot == "hero":
            sc.camera = cam_hero
            look(True)
            vol.inputs["Density"].default_value = 0.0
            if mist_sock is not None:
                mist_sock.default_value = args.hero_haze
            show_lights({"L_Forge", "L_Throat", "L_Mouth", "L_Mouth2", "L_ShaftTop", "L_HelmetHero", "L_RimCold", "L_Miner"})
            L_top.data.energy = 60000.0
        elif shot == "approach":
            sc.camera = cam_app
            look(True)
            vol.inputs["Density"].default_value = 0.0
            if mist_sock is not None:
                mist_sock.default_value = args.hero_haze
            show_lights({"L_Forge", "L_Throat", "L_Mouth", "L_Mouth2", "L_ShaftTop", "L_PlayerHelmet", "L_Miner", "L_RimCold"})
            L_top.data.energy = 45000.0
        elif shot in ("game", "profile"):
            sc.camera = cam_game if shot == "game" else cam_prof
            look(True)
            vol.inputs["Density"].default_value = 0.0
            if mist_sock is not None:
                mist_sock.default_value = args.hero_haze
            show_lights({"L_Forge", "L_Throat", "L_Mouth", "L_Mouth2", "L_ColdAmbient",
                         "L_PlayerLantern" if shot == "game" else "L_ProfileLantern"})
        elif shot == "full":
            sc.camera = cam_full
            look(True)
            vol.inputs["Density"].default_value = args.fog
            show_lights({"L_Forge", "L_Throat", "L_Mouth", "L_Mouth2", "L_ShaftTop", "L_LanternFull", "L_FullFill", "L_Miner",
                         "L_CageLantern", "L_ClimberLamp", "L_RimCold"})
            L_top.data.energy = 260000.0
        elif shot in ("lod0", "lod0_approach") and game_lods:
            # the shipped Quest LOD0 (baked atlases, no render mesh) under the same cameras, for comparison
            sc.camera = cam_full if shot == "lod0" else cam_app
            look(True)
            vol.inputs["Density"].default_value = args.fog if shot == "lod0" else 0.0
            if mist_sock is not None and shot != "lod0":
                mist_sock.default_value = args.hero_haze
            if shot == "lod0":
                show_lights({"L_Forge", "L_Throat", "L_Mouth", "L_Mouth2", "L_ShaftTop", "L_LanternFull", "L_FullFill", "L_Miner",
                             "L_CageLantern", "L_ClimberLamp", "L_RimCold"})
                L_top.data.energy = 260000.0
            else:
                show_lights({"L_Forge", "L_Throat", "L_Mouth", "L_Mouth2", "L_ShaftTop", "L_PlayerHelmet", "L_Miner", "L_RimCold"})
                L_top.data.energy = 45000.0
            creature.hide_render = True
            for ob in game_lods[0].values():
                ob.hide_render = False
        elif shot == "detail":
            sc.camera = cam_det
            look(True)
            vol.inputs["Density"].default_value = 0.0
            if mist_sock is not None:
                mist_sock.default_value = 0.3
            show_lights({"L_DetailHelmet", "L_ShaftTop", "L_CageLantern"})
            L_top.data.energy = 60000.0
        elif shot in ("silhouette", "below"):
            sc.camera = cam_full if shot == "silhouette" else cam_below
            look(False)
            vol.inputs["Density"].default_value = 0.0
            bg.inputs["Color"].default_value = (0.2140, 0.2140, 0.2140, 1)
            show_lights(set())
            for ob in env.objects:
                ob.hide_render = True
            sc.view_layers[0].material_override = silhouette_mat
        else:
            continue
        sil = shot in ("silhouette", "below")
        if not sil:
            bg.inputs["Color"].default_value = (0.0025, 0.003, 0.0042, 1)
        cy.samples = 12 if sil else args.samples
        cy.use_denoising = not sil
        try:
            sc.render.use_compositing = comp_ok and not sil
        except Exception:
            pass
        if args.border:
            bx = [float(x) for x in args.border.split(",")]
            sc.render.use_border = True
            sc.render.use_crop_to_border = True
            sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = bx
        name = "silhouette_below" if shot == "below" else shot
        sc.render.filepath = os.path.join(OUT, name + ".png")
        bpy.ops.render.render(write_still=True)
        creature.hide_render = False
        if game_lods:
            for ob in game_lods[0].values():
                ob.hide_render = True
        log("rendered", shot, "in %.0fs" % (time.time() - t0))
    if args.export:
        run_production(creature, env)
    log("done")


if __name__ == "__main__":
    main()
