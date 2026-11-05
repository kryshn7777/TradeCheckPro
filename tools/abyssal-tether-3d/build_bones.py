"""ABYSSAL TETHER 3D - THE BONES KIT: procedural human skeletons for the dressing of the shafts (Blender 5.x / the `bpy` module).

The remains of the climbers who came before and of what the Mason fed on: skulls, sprawled and crumpled skeletons, one slumped
against the wall, one hanging from a hook, one that died crawling, a hand reaching out of a heap, a ribcage, loose bones, a skull pile.

Built from code (deterministic, seed 6613, no hand-sculpting):
  PARTS   every bone is a signed distance field in its own frame (numpy; smooth unions of spheres, ellipsoids, round cones, rounded
          cylinders, triangles; smooth subtractions for the orbits, the nasal aperture, the sockets; noisy cut planes for the
          breaks), evaluated block-wise (each primitive only in its own box) on a fine grid and meshed with naive surface nets
          (1.2-2.2 mm voxels). Parts: skull (hollow when broken open), mandible, vertebrae (cervical / thoracic / lumbar), the thorax
          (12 thoracic vertebrae, 24 ribs (some broken), sternum, clavicles, scapulae), pelvis + sacrum, humerus, radius + ulna, femur,
          tibia + fibula, hands (curl, spread), feet. Extras: cloth rags and a strap (thick SDF shells with tattered noise edges), a
          leather belt with a buckle, a rusted piton, rope (swept tubes), an iron hook and chain links, rubble.
  POSES   a direction-driven skeleton: the pelvis, chest and head frames + one direction per limb segment, bone lengths fixed
          (1.72 m adult); limbs flagged `floor` settle onto y = 0 joint by joint.
  LOW     each mesh's parts are posed, concatenated per class (bone / cloth / leather / iron / rope / stone) and QEM-decimated
          (Blender's collapse decimate) to the triangle budget; smooth shaded.
  COLOUR  COLOR_0 (linear RGBA, A = 1): aged ivory bone, brown grime pooled by ambient occlusion and concavity, a darker soil tide
          line where bones touch the floor, low-frequency stains, painted detail (teeth gaps, sutures, cracks, the inside of the
          orbits and the nose), rust-brown dried blood on some bones (runs downwards), the cloth / leather / iron / rope colours.
          AO is ray-cast per vertex (BVH, 40 rays, 0.3 m, + the floor / wall planes) and multiplied in. ONE material
          (`BonesMat`, base colour factor 1, roughness 0.8, no textures): one draw call per batch.

Outputs: <out>/bones.glb (raw; then compress_glbs.mjs --only bones), <renders>/bones_sheet.png (--render), a JSON report.

Run (always under the shared lock):
  flock /tmp/at3d-blender.lock $PY tools/abyssal-tether-3d/build_bones.py --out <dir> --renders <dir> [--render] [--only Bones_Skull,..]
"""

import argparse
import json
import math
import os
import sys
import time

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh  # noqa: F401
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.getcwd(), "bones_out"))
ap.add_argument("--renders", default="")
ap.add_argument("--render", action="store_true")
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--tile", type=int, default=440)
ap.add_argument("--only", default="", help="meshes to build (comma list of names)")
ap.add_argument("--hq", type=float, default=1.0, help="voxel size multiplier (2 = coarse, for quick looks)")
args = ap.parse_args(argv)
args.out = os.path.abspath(args.out)
os.makedirs(args.out, exist_ok=True)
RENDER_DIR = os.path.abspath(args.renders or args.out)
os.makedirs(RENDER_DIR, exist_ok=True)
T0 = time.time()
SEED = 6613
F32 = np.float32


def log(*a):
    print(f"[bones {time.time() - T0:7.1f}s]", *a, flush=True)


# =====================================================================================================================
# small vector helpers
# =====================================================================================================================
def V3(*a):
    return np.array(a[0] if len(a) == 1 else a, dtype=np.float64)


def nrm(v):
    v = np.asarray(v, dtype=np.float64)
    return v / max(1e-12, np.linalg.norm(v))


def frame(up, fwd):
    """orthonormal columns (x = left, y = up, z = fwd), y exact."""
    y = nrm(up)
    z = np.asarray(fwd, dtype=np.float64)
    z = nrm(z - np.dot(z, y) * y)
    x = np.cross(y, z)
    return np.stack([x, y, z], 1)


def rot(axis, ang):
    a = nrm(axis)
    c, s = math.cos(ang), math.sin(ang)
    x, y, z = a
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# value noise (deterministic hash) ----------------------------------------------------------------------------------
def _hash(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 974634511) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF) / float(0xFFFFFF)


def vnoise(P, freq, seed):
    Q = np.asarray(P, dtype=np.float64) * freq + 0.37 * seed
    i = np.floor(Q).astype(np.int64)
    f = Q - i
    u = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(P, freq, seed, octaves=3):
    s, a, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        s = s + a * vnoise(P, freq * (2.03 ** o), seed + 17 * o)
        tot += a
        a *= 0.5
    return s / tot


# =====================================================================================================================
# SDF primitives: each returns (fn(P (n,3)) -> d, lo, hi)
# =====================================================================================================================
def p_sphere(c, r):
    c = V3(c)
    return (lambda P: np.linalg.norm(P - c, axis=1) - r), c - r, c + r


def p_ellip(c, r, R=None):
    c, r = V3(c), V3(r)
    R = np.eye(3) if R is None else R

    def fn(P):
        q = (P - c) @ R
        k0 = np.linalg.norm(q / r, axis=1)
        k1 = np.linalg.norm(q / (r * r), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    m = r.max()
    return fn, c - m, c + m


def p_cone(a, b, ra, rb=None):
    a, b = V3(a), V3(b)
    rb = ra if rb is None else rb
    ba = b - a
    bb = max(1e-12, float(ba @ ba))

    def fn(P):
        pa = P - a
        t = np.clip(pa @ ba / bb, 0, 1)
        return np.linalg.norm(pa - t[:, None] * ba, axis=1) - (ra + (rb - ra) * t)
    m = max(ra, rb)
    return fn, np.minimum(a, b) - m, np.maximum(a, b) + m


def p_cyl(c, R, r, hh, rr=0.002):
    """rounded cylinder along local Y (columns of R are local axes)."""
    c = V3(c)

    def fn(P):
        q = (P - c) @ R
        dx = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - r + rr
        dy = np.abs(q[:, 1]) - hh + rr
        return np.minimum(np.maximum(dx, dy), 0) + np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2) - rr
    m = math.hypot(r, hh)
    return fn, c - m, c + m


def p_box(c, half, R=None, rr=0.002):
    c, half = V3(c), V3(half)
    R = np.eye(3) if R is None else R

    def fn(P):
        q = np.abs((P - c) @ R) - half + rr
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - rr
    m = np.linalg.norm(half)
    return fn, c - m, c + m


def p_torus(c, R, rmaj, rmin):
    c = V3(c)

    def fn(P):
        q = (P - c) @ R
        a = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - rmaj
        return np.sqrt(a * a + q[:, 1] ** 2) - rmin
    m = rmaj + rmin
    return fn, c - m, c + m


def p_tri(A, B, C, t):
    """a thin plate: distance to triangle ABC minus t."""
    A, B, C = V3(A), V3(B), V3(C)
    nN = nrm(np.cross(B - A, C - A))

    def fn(P):
        best = None
        for a, b in ((A, B), (B, C), (C, A)):
            ba = b - a
            pa = P - a
            h = np.clip(pa @ ba / (ba @ ba), 0, 1)
            d = np.linalg.norm(pa - h[:, None] * ba, axis=1)
            best = d if best is None else np.minimum(best, d)
        s1 = np.cross(B - A, nN)
        s2 = np.cross(C - B, nN)
        s3 = np.cross(A - C, nN)
        inside = ((P - A) @ s1 <= 0) & ((P - B) @ s2 <= 0) & ((P - C) @ s3 <= 0)
        dp = np.abs((P - A) @ nN)
        return np.where(inside, dp, best) - t
    lo = np.minimum(np.minimum(A, B), C) - t
    hi = np.maximum(np.maximum(A, B), C) + t
    return fn, lo, hi


def chain(pts, radii):
    out = []
    for i in range(len(pts) - 1):
        out.append(p_cone(pts[i], pts[i + 1], radii[i], radii[i + 1]))
    return out


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


# =====================================================================================================================
# a part: primitives evaluated block-wise on a grid, meshed with naive surface nets
# =====================================================================================================================
class Part:
    def __init__(self, h=0.002):
        self.h = h * args.hq
        self.ops = []          # (kind, prim, k)
        self.post = []         # global fns: F -> F (cuts)
        self.detail = None     # fn(P) -> [0, 1] painted darkening (in the part frame)
        self.blood = None      # fn(P) -> [0, 1] blood-prone mask (in the part frame)

    def add(self, prim, k=0.0):
        self.ops.append(("u", prim, k))
        return self

    def addm(self, prims, k=0.0):
        for p in prims:
            self.add(p, k)
        return self

    def sub(self, prim, k=0.0):
        self.ops.append(("s", prim, k))
        return self

    def cut(self, fn, k=0.0):
        """keep where fn(P) <= 0 (global intersection)."""
        self.post.append((fn, k))
        return self

    def mesh(self):
        h = self.h
        los = [o[1][1] for o in self.ops if o[0] == "u"]
        his = [o[1][2] for o in self.ops if o[0] == "u"]
        lo = np.min(los, 0) - 4 * h - 0.004
        hi = np.max(his, 0) + 4 * h + 0.004
        n = np.ceil((hi - lo) / h).astype(int) + 1
        F = np.full(tuple(n), 1.0, dtype=F32)
        for kind, (fn, plo, phi), k in self.ops:
            pad = k + 3 * h
            i0 = np.clip(np.floor((plo - pad - lo) / h).astype(int), 0, n - 1)
            i1 = np.clip(np.ceil((phi + pad - lo) / h).astype(int) + 1, 0, n)
            if np.any(i1 - i0 < 1):
                continue
            ax = [lo[j] + h * np.arange(i0[j], i1[j]) for j in range(3)]
            G = np.stack(np.meshgrid(*ax, indexing="ij"), -1).reshape(-1, 3)
            d = fn(G).reshape(tuple(i1 - i0)).astype(F32)
            sl = tuple(slice(i0[j], i1[j]) for j in range(3))
            if kind == "u":
                F[sl] = smin(F[sl], d, k)
            else:
                F[sl] = smax(F[sl], -d, k)
        if self.post:
            ax = [lo[j] + h * np.arange(n[j]) for j in range(3)]
            G = np.stack(np.meshgrid(*ax, indexing="ij"), -1).reshape(-1, 3)
            for fn, k in self.post:
                F = smax(F, fn(G).reshape(F.shape).astype(F32), k)
        V, Fc = surface_nets(F, lo, h)
        return V, Fc


def surface_nets(F, lo, h):
    nx, ny, nz = F.shape
    ins = F < 0
    corners = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]
    edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]
    C = [F[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz] for dx, dy, dz in corners]
    shp = (nx - 1, ny - 1, nz - 1)
    acc = np.zeros(shp + (3,), dtype=F32)
    cnt = np.zeros(shp, dtype=F32)
    for a, b in edges:
        fa, fb = C[a], C[b]
        m = (fa < 0) != (fb < 0)
        if not m.any():
            continue
        t = np.where(m, fa / np.where(m, fa - fb, 1.0), 0).astype(F32)
        ca, cb = np.array(corners[a], F32), np.array(corners[b], F32)
        pos = ca + t[..., None] * (cb - ca)
        acc += np.where(m[..., None], pos, 0)
        cnt += m
    act = cnt > 0
    vid = np.full(shp, -1, dtype=np.int64)
    vid[act] = np.arange(int(act.sum()))
    idx = np.argwhere(act).astype(F32)
    V = (idx + acc[act] / cnt[act][:, None]) * h + lo.astype(F32)
    quads = []
    # x edges: cells (i, j-1..j, k-1..k)
    s0, s1 = ins[:-1, 1:-1, 1:-1], ins[1:, 1:-1, 1:-1]
    m = s0 != s1
    I = np.argwhere(m)
    if len(I):
        i, j, k = I[:, 0], I[:, 1] + 1, I[:, 2] + 1
        q = np.stack([vid[i, j - 1, k - 1], vid[i, j, k - 1], vid[i, j, k], vid[i, j - 1, k]], 1)
        flip = ~s0[m]
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    s0, s1 = ins[1:-1, :-1, 1:-1], ins[1:-1, 1:, 1:-1]
    m = s0 != s1
    I = np.argwhere(m)
    if len(I):
        i, j, k = I[:, 0] + 1, I[:, 1], I[:, 2] + 1
        q = np.stack([vid[i - 1, j, k - 1], vid[i - 1, j, k], vid[i, j, k], vid[i, j, k - 1]], 1)
        flip = ~s0[m]
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    s0, s1 = ins[1:-1, 1:-1, :-1], ins[1:-1, 1:-1, 1:]
    m = s0 != s1
    I = np.argwhere(m)
    if len(I):
        i, j, k = I[:, 0] + 1, I[:, 1] + 1, I[:, 2]
        q = np.stack([vid[i - 1, j - 1, k], vid[i, j - 1, k], vid[i, j, k], vid[i - 1, j, k]], 1)
        flip = ~s0[m]
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    Q = np.concatenate(quads, 0)
    Q = Q[(Q >= 0).all(1)]
    T = np.concatenate([Q[:, [0, 1, 2]], Q[:, [0, 2, 3]]], 0)
    return V.astype(np.float64), T


# a cached mesh with per-vertex detail / blood masks -----------------------------------------------------------------
class Mesh:
    def __init__(self, V, F, cls=0, det=None, bld=None):
        self.V, self.F, self.cls = V, F, cls
        self.det = np.zeros(len(V)) if det is None else det
        self.bld = np.zeros(len(V)) if bld is None else bld
        self.grp = 0

    def xf(self, M, t):
        V = self.V @ np.asarray(M).T + t
        F = self.F if np.linalg.det(M) > 0 else self.F[:, ::-1]
        m = Mesh(V, F, self.cls, self.det, self.bld)
        m.grp = self.grp
        return m


def components(F, nv):
    lab = np.arange(nv)
    while True:
        a = lab[F]
        mn = a.min(1)
        old = lab.copy()
        for k in range(3):
            np.minimum.at(lab, F[:, k], mn)
        lab = lab[lab]
        lab = lab[lab]
        if np.array_equal(lab, old):
            return lab


def cull_small(m, min_tris):
    lab = components(m.F, len(m.V))
    fl = lab[m.F[:, 0]]
    u, cnt = np.unique(fl, return_counts=True)
    keepl = set(u[cnt >= min_tris].tolist())
    kf = np.array([l in keepl for l in fl]) if len(u) < 2000 else np.isin(fl, list(keepl))
    if kf.all():
        return m
    F = m.F[kf]
    used = np.unique(F)
    remap = -np.ones(len(m.V), dtype=np.int64)
    remap[used] = np.arange(len(used))
    out = Mesh(m.V[used], remap[F], m.cls, m.det[used], m.bld[used])
    out.grp = m.grp
    return out


_CACHE = {}


def build(key, maker, cls=0):
    if key in _CACHE:
        return _CACHE[key]
    p = maker()
    V, F = p.mesh()
    det = p.detail(V) if p.detail else None
    bld = p.blood(V) if p.blood else None
    m = Mesh(V, F, cls, det, bld)
    _CACHE[key] = m
    log(f"part {key}: {len(F)} hi tris")
    return m


def tube_mesh(pts, radius, sides=6, cls=4, cap=True, twist=0.0):
    """a swept tube (rope, cord) straight from a polyline."""
    pts = np.asarray(pts, dtype=np.float64)
    n = len(pts)
    T = np.gradient(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.array([0.0, 1.0, 0.0]) if abs(T[0, 1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    Nn = nrm(np.cross(T[0], ref))
    rings = []
    for i in range(n):
        Nn = nrm(Nn - np.dot(Nn, T[i]) * T[i])
        Bn = np.cross(T[i], Nn)
        r = radius[i] if hasattr(radius, "__len__") else radius
        a = np.arange(sides) * 2 * math.pi / sides + twist * i
        rings.append(pts[i] + r * (np.cos(a)[:, None] * Nn + np.sin(a)[:, None] * Bn))
    V = np.concatenate(rings, 0)
    F = []
    for i in range(n - 1):
        for s in range(sides):
            a, b = i * sides + s, i * sides + (s + 1) % sides
            c, d = a + sides, b + sides
            F += [(a, b, d), (a, d, c)]
    if cap:
        c0 = len(V)
        V = np.concatenate([V, pts[:1], pts[-1:]], 0)
        for s in range(sides):
            F.append((c0, (s + 1) % sides, s))
            F.append((c0 + 1, (n - 1) * sides + s, (n - 1) * sides + (s + 1) % sides))
    det = np.zeros(len(V))
    # rope twist: a helical stripe in the detail mask
    for i in range(n):
        a = np.arange(sides) * 2 * math.pi / sides
        det[i * sides:(i + 1) * sides] = 0.5 + 0.5 * np.sin(3 * a + i * 1.7)
    return Mesh(V, np.array(F, dtype=np.int64), cls, det)


def torus_mesh(c, R, rmaj, rmin, nu=10, nv=6, cls=3, squash=1.0):
    u = np.arange(nu) * 2 * math.pi / nu
    v = np.arange(nv) * 2 * math.pi / nv
    U, W = np.meshgrid(u, v, indexing="ij")
    x = (rmaj + rmin * np.cos(W)) * np.cos(U)
    z = (rmaj + rmin * np.cos(W)) * np.sin(U) * squash
    y = rmin * np.sin(W)
    P = np.stack([x, y, z], -1).reshape(-1, 3)
    F = []
    for i in range(nu):
        for j in range(nv):
            a = i * nv + j
            b = ((i + 1) % nu) * nv + j
            c2 = ((i + 1) % nu) * nv + (j + 1) % nv
            d = i * nv + (j + 1) % nv
            F += [(a, b, c2), (a, c2, d)]
    return Mesh(P @ np.asarray(R).T + V3(c), np.array(F, dtype=np.int64), cls)


# =====================================================================================================================
# THE BONES (each in its own frame; left side; +X lateral, +Y proximal / up, +Z anterior)
# =====================================================================================================================
L_HUM, L_FORE, L_FEM, L_TIB = 0.31, 0.245, 0.445, 0.375


def noisy_cut(origin, normal, seed, amp=0.006, freq=90.0):
    """a jagged break: keep the side opposite to `normal`."""
    o, nn = V3(origin), nrm(normal)
    return lambda P: (P - o) @ nn + amp * (fbm(P, freq, seed, 2) - 0.5) * 2.0


def skull_part(seed=0, hollow=False, hole=False, missing=(), lowres=False):
    """skull without the mandible. Origin ~ the centre of the cranium; the occipital condyles at (0, -0.058, -0.02)."""
    rng = np.random.default_rng(SEED + 101 * seed)
    p = Part(h=0.0026 if lowres else 0.0018)
    s = 1.0 + 0.03 * (rng.random() - 0.5)
    E = lambda c, r, R=None: p_ellip(V3(c) * s, V3(r) * s, R)
    p.add(E((0, 0.025, -0.012), (0.071, 0.071, 0.093)))
    p.add(E((0, 0.028, 0.03), (0.062, 0.064, 0.062)), 0.02)
    p.add(E((0, 0.0, -0.06), (0.056, 0.052, 0.05)), 0.02)
    p.add(E((0, -0.03, -0.01), (0.058, 0.03, 0.06)), 0.02)           # cranial base
    for sx in (-1, 1):
        p.add(p_cone(V3(sx * 0.048, 0.0, 0.074) * s, V3(sx * 0.004, 0.006, 0.088) * s, 0.0085 * s, 0.009 * s), 0.01)   # brow
        p.add(E((sx * 0.05, -0.034, 0.058), (0.016, 0.018, 0.02)), 0.01)        # zygomatic body
        p.addm(chain([V3(sx * 0.058, -0.038, 0.045) * s, V3(sx * 0.068, -0.037, 0.008) * s, V3(sx * 0.066, -0.031, -0.016) * s],
                     [0.0068 * s, 0.006 * s, 0.0065 * s]), 0.006)              # zygomatic arch
        p.add(p_cone(V3(sx * 0.052, -0.046, -0.022) * s, V3(sx * 0.05, -0.068, -0.016) * s, 0.0105 * s, 0.006 * s), 0.008)  # mastoid
    p.add(E((0, -0.048, 0.062), (0.04, 0.03, 0.034)), 0.016)                     # maxilla
    p.add(p_sphere(V3(0, -0.008, 0.087) * s, 0.0095 * s), 0.008)                 # glabella / nasal root
    p.add(p_cone(V3(0, -0.012, 0.09) * s, V3(0, -0.032, 0.097) * s, 0.0055 * s, 0.004 * s), 0.004)   # nasal bones
    arch = []
    for i in range(9):
        x = -0.028 + 0.056 * i / 8
        arch.append(V3(x, -0.074, 0.083 - 24 * x * x) * s)
    p.addm(chain(arch, [0.0105 * s] * 9), 0.006)                                  # alveolar arch
    # teeth (upper): 14, the gaps are painted
    teeth = []
    for i in range(14):
        tt = -1 + 2 * (i + 0.5) / 14
        x = 0.029 * tt
        z = 0.081 - 24 * x * x
        if i in missing:
            continue
        w = 0.0032 if abs(tt) < 0.3 else 0.0042
        ang = math.atan2(-48 * x, 1.0)
        R = rot((0, 1, 0), ang)
        teeth.append(E((x, -0.087, z), (w, 0.0062, 0.0042), R))
    p.addm(teeth, 0.0015)
    # cavities
    for sx in (-1, 1):
        R = rot((0, 1, 0), sx * 0.3) @ rot((1, 0, 0), 0.08)
        p.sub(E((sx * 0.033, -0.016, 0.086), (0.0195, 0.0175, 0.04), R), 0.004)    # orbit
        p.sub(E((sx * 0.084, 0.0, 0.018), (0.017, 0.03, 0.036)), 0.012)             # temporal fossa
        p.sub(p_cone(V3(sx * 0.075, -0.033, -0.012) * s, V3(sx * 0.055, -0.033, -0.012) * s, 0.0055 * s), 0.002)  # ear
        p.sub(E((sx * 0.027, -0.058, 0.095), (0.011, 0.012, 0.012)), 0.006)         # canine fossa
    p.sub(E((0, -0.044, 0.092), (0.0115, 0.019, 0.034)), 0.003)                     # nasal aperture
    p.sub(E((0, -0.054, 0.092), (0.0135, 0.009, 0.03)), 0.004)
    p.sub(E((0, -0.063, -0.03), (0.016, 0.014, 0.02)), 0.004)                       # foramen magnum
    if hollow:
        p.sub(E((0, 0.022, -0.012), (0.064, 0.064, 0.085)), 0.01)
        p.sub(E((0, 0.026, 0.026), (0.055, 0.057, 0.055)), 0.01)
    hole_c = V3(0.05, 0.06, -0.01) * s
    if hole:
        hn = nrm(hole_c - V3(0, 0.02, -0.01))
        p.cut(lambda P: 0.024 - np.linalg.norm(P - hole_c, axis=1) + 0.009 * (fbm(P, 110.0, seed + 5, 2) - 0.5) * 2, 0.0)
    p.blood = None

    def detail(P):
        d = np.zeros(len(P))
        # orbits / nose / ear interiors
        for sx in (-1, 1):
            q = (P - V3(sx * 0.033, -0.015, 0.075) * s) / V3(0.019, 0.017, 0.02)
            d = np.maximum(d, 1 - sstep(0.6, 1.25, np.linalg.norm(q, axis=1)))
        q = (P - V3(0, -0.048, 0.085) * s) / V3(0.012, 0.022, 0.02)
        d = np.maximum(d, 1 - sstep(0.6, 1.3, np.linalg.norm(q, axis=1)))
        # teeth gaps: angular stripes along the arch, only on the tooth row
        row = sstep(-0.095, -0.089, P[:, 1]) * (1 - sstep(-0.08, -0.076, P[:, 1])) * sstep(0.03, 0.05, P[:, 2])
        tt = P[:, 0] / (0.029 * s)
        gaps = np.abs(np.sin((tt + 1) * 7 * math.pi / 2)) ** 6 * 0.0 + (1 - np.abs(np.sin((tt + 1) * 7 * math.pi / 2))) ** 3
        d = np.maximum(d, 0.85 * row * gaps)
        for i in missing:
            ti = -1 + 2 * (i + 0.5) / 14
            d = np.maximum(d, row * (1 - sstep(0.04, 0.09, np.abs(tt - ti))))
        # sutures: coronal + sagittal + lambdoid, thin wiggly lines
        th = 0.8 * (fbm(P, 160.0, seed + 9, 2) - 0.5) * 0.006
        top = sstep(0.0, 0.04, P[:, 1])
        cor = np.abs(P[:, 2] - (0.035 * s - 0.25 * np.maximum(0, -P[:, 1] + 0.09)) + th)
        sag = np.abs(P[:, 0] + th) + 10 * np.maximum(0, P[:, 2] - 0.035 * s)
        lam = np.abs(P[:, 2] + 0.07 * s + 0.6 * (0.06 - P[:, 1]) * 0.3 + th)
        sut = np.minimum(np.minimum(cor, sag + 10 * np.maximum(0, -0.07 * s - P[:, 2])), lam + 10 * np.maximum(0, P[:, 1] - 0.055))
        d = np.maximum(d, 0.55 * top * (1 - sstep(0.0008, 0.0035, sut)))
        if hole:
            r = np.linalg.norm(P - hole_c, axis=1)
            d = np.maximum(d, 0.8 * (1 - sstep(0.02, 0.04, r)))
            # radiating cracks
            for a in range(4):
                ang = a * 1.7 + seed
                dirv = nrm(V3(-math.sin(ang) * 0.3, math.cos(ang), math.sin(ang)))
                q = P - hole_c
                along = q @ dirv
                perp = np.linalg.norm(q - along[:, None] * dirv, axis=1)
                wig = 0.004 * (fbm(P, 90.0, seed + a, 2) - 0.5)
                d = np.maximum(d, 0.95 * sstep(0.0, 0.03, along) * (1 - sstep(0.07, 0.1, along)) * (1 - sstep(0.0015, 0.005, perp + wig)))
        return d
    p.detail = detail
    return p


JAW_PIVOT = V3(0, -0.062, -0.012)


def mandible_part(seed=0, lowres=False, missing=()):
    p = Part(h=0.0026 if lowres else 0.0016)
    pts_hi, pts_lo = [], []
    for i in range(11):
        x = -0.046 + 0.092 * i / 10
        z = 0.08 - 0.08 * (abs(x) / 0.047) ** 1.7
        pts_hi.append(V3(x, -0.101, z))
        pts_lo.append(V3(x * 1.02, -0.113, z - 0.002))
    p.addm(chain(pts_hi, [0.0075] * 11), 0.006)
    p.addm(chain(pts_lo, [0.0068] * 11), 0.006)
    p.add(p_ellip((0, -0.115, 0.079), (0.012, 0.01, 0.008)), 0.006)        # chin
    for sx in (-1, 1):
        ang = V3(sx * 0.049, -0.113, -0.002)
        p.add(p_cone(ang, V3(sx * 0.051, -0.066, -0.013), 0.0075, 0.0065), 0.006)  # ramus back
        p.add(p_cone(ang + V3(0, 0.004, 0.012), V3(sx * 0.046, -0.072, 0.017), 0.006, 0.0035), 0.006)  # coronoid
        p.add(p_tri(ang + V3(0, 0.0, 0.004), V3(sx * 0.051, -0.07, -0.01), V3(sx * 0.046, -0.074, 0.015), 0.0028), 0.004)
        p.add(p_ellip((sx * 0.051, -0.062, -0.013), (0.009, 0.005, 0.005)), 0.003)  # condyle
    teeth = []
    for i in range(14):
        if i in missing:
            continue
        tt = -1 + 2 * (i + 0.5) / 14
        x = 0.027 * tt
        z = 0.078 - 26 * x * x
        w = 0.003 if abs(tt) < 0.3 else 0.004
        teeth.append(p_ellip((x, -0.092, z), (w, 0.006, 0.004), rot((0, 1, 0), math.atan2(-52 * x, 1))))
    p.addm(teeth, 0.0015)

    def detail(P):
        row = sstep(-0.1, -0.096, P[:, 1]) * (1 - sstep(-0.089, -0.085, P[:, 1])) * sstep(0.03, 0.05, P[:, 2])
        tt = P[:, 0] / 0.027
        d = 0.85 * row * (1 - np.abs(np.sin((tt + 1) * 7 * math.pi / 2))) ** 3
        for i in missing:
            ti = -1 + 2 * (i + 0.5) / 14
            d = np.maximum(d, row * (1 - sstep(0.04, 0.09, np.abs(tt - ti))))
        return d
    p.detail = detail
    return p


def vertebra_part(kind):
    s = {"c": 0.72, "t": 0.92, "l": 1.18}[kind]
    p = Part(h=0.0015 if kind == "c" else 0.0018)
    R = np.eye(3)
    p.add(p_cyl((0, 0, 0), R, 0.017 * s, 0.0105 * s, 0.004 * s))
    for sx in (-1, 1):
        p.add(p_cone(V3(sx * 0.009, 0, -0.012) * s, V3(sx * 0.011, 0.001, -0.027) * s, 0.0045 * s, 0.004 * s), 0.003)   # pedicle
        p.add(p_cone(V3(sx * 0.011, 0.001, -0.027) * s, V3(0, -0.002, -0.034) * s, 0.0042 * s, 0.0045 * s), 0.003)      # lamina
        tx = 0.034 if kind != "l" else 0.03
        p.add(p_cone(V3(sx * 0.011, 0.002, -0.026) * s, V3(sx * tx, 0.003 if kind != "t" else 0.006, -0.03) * s, 0.0045 * s, 0.0035 * s), 0.003)
        p.add(p_sphere(V3(sx * 0.011, 0.009, -0.026) * s, 0.0042 * s), 0.002)   # articular
    sp = {"c": V3(0, -0.006, -0.046), "t": V3(0, -0.026, -0.052), "l": V3(0, -0.004, -0.054)}[kind] * s
    p.add(p_cone(V3(0, 0, -0.033) * s, sp, 0.005 * s, 0.0038 * s), 0.003)
    return p


def thorax_part(seed=0, broken=(), collapse=0.0, sternum=True, shoulders=True, lowres=False):
    """12 thoracic vertebrae, the ribs, sternum, clavicles, scapulae. Chest frame: origin at T12's body."""
    rng = np.random.default_rng(SEED + 31 * seed)
    p = Part(h=0.0024 if lowres else 0.0017)
    zsp = lambda y: -0.022 * math.sin(math.pi * min(max(y, 0), 0.27) / 0.27)
    # thoracic spine as simplified vertebrae
    for i in range(12):
        y = 0.27 - (i + 0.5) * 0.0225
        z = zsp(y)
        s = 0.82 + 0.012 * i
        p.add(p_cyl((0, y, z), np.eye(3), 0.016 * s, 0.0095, 0.003), 0.002)
        p.add(p_cone(V3(0, y, z - 0.014), V3(0, y - 0.024, z - 0.05), 0.0052, 0.0038), 0.004)
        for sx in (-1, 1):
            p.add(p_cone(V3(sx * 0.008, y + 0.002, z - 0.014), V3(sx * 0.032, y + 0.006, z - 0.03), 0.0048, 0.0038), 0.004)
    W = [0.056, 0.078, 0.093, 0.104, 0.113, 0.12, 0.124, 0.125, 0.122, 0.116, 0.104, 0.09]
    D = [0.042, 0.056, 0.067, 0.076, 0.085, 0.092, 0.097, 0.098, 0.096, 0.09, 0.08, 0.068]
    PH1 = [2.75, 2.78, 2.78, 2.76, 2.74, 2.7, 2.62, 2.5, 2.38, 2.25, 1.75, 1.45]
    tips = []
    for i in range(12):
        y0 = 0.27 - (i + 0.5) * 0.0225
        zs = zsp(y0)
        w, d = W[i] * (1 - 0.08 * collapse), D[i] * (1 - 0.25 * collapse)
        zc = zs - 0.026 + d
        drop = 0.07 + 0.035 * i / 11
        for sx in (-1, 1):
            ph1 = PH1[i]
            if (i, sx) in broken:
                ph1 = 1.0 + 0.9 * rng.random()
            n = 14
            pts = [V3(sx * 0.012, y0 + 0.002, zs - 0.012)]
            for j in range(n + 1):
                ph = 0.42 + (ph1 - 0.42) * j / n
                y = y0 + 0.01 * math.sin(min(ph, 1.2) * 2.4) - drop * float(sstep(0.5, 2.8, ph))
                pts.append(V3(sx * w * math.sin(ph), y, zc - d * math.cos(ph)))
            rad = [0.0042] + [0.0046 - 0.0006 * j / n for j in range(n + 1)]
            p.addm(chain(pts, rad), 0.003)
            tips.append(pts[-1])
            if (i, sx) in broken:
                p.add(p_sphere(pts[-1] + V3(0, 0.0, 0), 0.0055), 0.001)
    if sternum:
        p.add(p_ellip((0, 0.235, 0.083 - 0.1 * collapse), (0.024, 0.02, 0.008), rot((1, 0, 0), 0.25)), 0.004)   # manubrium
        p.add(p_cone(V3(0, 0.215, 0.09 - 0.1 * collapse), V3(0, 0.1, 0.145 - 0.12 * collapse), 0.012, 0.009), 0.004)
        p.add(p_cone(V3(0, 0.1, 0.145 - 0.12 * collapse), V3(0, 0.075, 0.15 - 0.12 * collapse), 0.006, 0.003), 0.003)  # xiphoid
    if shoulders:
        for sx in (-1, 1):
            p.addm(chain([V3(sx * 0.022, 0.245, 0.085), V3(sx * 0.075, 0.262, 0.07), V3(sx * 0.13, 0.27, 0.01), V3(sx * 0.158, 0.262, -0.025)],
                         [0.0072, 0.0068, 0.0065, 0.0075]), 0.004)                          # clavicle
            Sa, Ia, G = V3(sx * 0.055, 0.25, -0.085), V3(sx * 0.08, 0.085, -0.095), V3(sx * 0.148, 0.212, -0.04)
            p.add(p_tri(Sa, Ia, G, 0.0024), 0.0)
            p.addm(chain([Sa, Ia, G * V3(1, 1, 1) + V3(-sx * 0.01, -0.01, -0.005)], [0.0042, 0.0055, 0.006]), 0.004)  # borders
            p.add(p_cone(Sa, G, 0.004, 0.005), 0.004)
            p.addm(chain([V3(sx * 0.058, 0.205, -0.095), V3(sx * 0.12, 0.235, -0.085), V3(sx * 0.165, 0.258, -0.045)],
                         [0.0035, 0.007, 0.0075]), 0.005)                                  # spine + acromion
            p.add(p_ellip(G + V3(sx * 0.008, 0, 0.004), (0.006, 0.017, 0.012)), 0.004)       # glenoid
            p.add(p_cone(G + V3(-sx * 0.01, 0.02, 0.0), G + V3(-sx * 0.005, 0.03, 0.03), 0.005, 0.004), 0.004)  # coracoid
    return p


SHOULDER = V3(0.17, 0.21, -0.03)   # chest frame (left)
NECK_BASE = V3(0, 0.285, -0.005)


def pelvis_part(seed=0):
    p = Part(h=0.0019)
    for sx in (-1, 1):
        A = V3(sx * 0.085, 0, 0)
        R = rot((0, 0, 1), -sx * 0.42) @ rot((0, 1, 0), sx * 0.55)
        p.add(p_ellip((sx * 0.098, 0.088, -0.022), (0.0075, 0.062, 0.078), R), 0.0)              # iliac wing
        crest = []
        for j in range(9):
            a = -1.25 + 2.5 * j / 8
            q = R @ V3(0, 0.062 * math.cos(a) * 0.98, 0.078 * math.sin(a) * 0.98)
            crest.append(V3(sx * 0.098, 0.088, -0.022) + q)
        p.addm(chain(crest, [0.006] * 9), 0.005)                                                   # crest
        p.add(p_cone(A + V3(sx * 0.005, 0.01, -0.01), V3(sx * 0.085, 0.06, -0.03), 0.019, 0.012), 0.01)  # body of ilium
        p.add(p_sphere(A, 0.03), 0.006)                                                          # acetabulum
        p.sub(p_sphere(A + V3(sx * 0.016, 0, 0.003), 0.024), 0.003)
        tub = V3(sx * 0.06, -0.075, -0.03)
        sym = V3(sx * 0.012, -0.038, 0.048)
        p.add(p_cone(A + V3(-sx * 0.01, -0.015, -0.01), tub, 0.014, 0.012), 0.006)              # ischium
        p.add(p_cone(A + V3(-sx * 0.012, 0.0, 0.016), sym + V3(0, 0.01, 0), 0.0105, 0.009), 0.006)  # superior pubic ramus
        p.add(p_cone(tub, sym + V3(0, -0.012, -0.004), 0.008, 0.0075), 0.005)                    # ischiopubic ramus
        p.add(p_ellip(sym + V3(0, -0.006, 0), (0.008, 0.018, 0.008)), 0.004)
    # sacrum
    R = rot((1, 0, 0), -0.55)
    p.add(p_ellip((0, 0.06, -0.075), (0.048, 0.06, 0.017), R), 0.008)
    p.add(p_cone(V3(0, 0.005, -0.11), V3(0, -0.025, -0.1), 0.01, 0.005), 0.006)                  # coccyx
    for sx in (-1, 1):
        p.add(p_cone(V3(sx * 0.035, 0.085, -0.07), V3(sx * 0.07, 0.085, -0.055), 0.016, 0.014), 0.012)  # sacroiliac
        for k in range(4):
            p.sub(p_sphere(V3(sx * 0.016, 0.085 - 0.022 * k, -0.06 + 0.012 * k), 0.0042), 0.002)   # sacral foramina
    return p


def humerus_part(seed=0, broken=None):
    L = L_HUM
    p = Part(h=0.002)
    p.add(p_sphere((-0.004, 0.0, -0.006), 0.023))
    p.add(p_sphere((0.016, 0.004, 0.01), 0.014), 0.01)
    p.addm(chain([V3(0.008, -0.025, 0.002), V3(0.003, -0.15, 0.004), V3(0.0, -L + 0.045, 0.0)], [0.0125, 0.0105, 0.011]), 0.01)
    p.add(p_cone(V3(-0.031, -L + 0.012, -0.004), V3(0.029, -L + 0.014, -0.003), 0.0085, 0.0095), 0.012)   # epicondyles
    p.add(p_ellip((0.0, -L + 0.004, 0.006), (0.022, 0.011, 0.012)), 0.006)                                 # trochlea
    p.sub(p_sphere((0.0, -L + 0.02, -0.016), 0.009), 0.004)                                                # olecranon fossa
    if broken is not None:
        p.cut(noisy_cut((0, -broken * L, 0), (0, 1, 0.2), seed + 3, 0.007))
    return p


def forearm_part(seed=0):
    L = L_FORE
    p = Part(h=0.0017)
    p.add(p_ellip((-0.01, 0.012, -0.016), (0.011, 0.016, 0.01)))                                    # olecranon
    p.addm(chain([V3(-0.01, -0.005, -0.008), V3(-0.014, -0.12, -0.004), V3(-0.019, -L + 0.01, 0.0)], [0.0105, 0.0068, 0.0055]), 0.008)
    p.add(p_sphere((-0.02, -L + 0.004, -0.002), 0.0075), 0.004)
    p.add(p_cyl((0.013, -0.01, 0.002), np.eye(3), 0.0105, 0.005, 0.003), 0.004)                     # radial head
    p.addm(chain([V3(0.013, -0.018, 0.003), V3(0.016, -0.11, 0.006), V3(0.018, -L + 0.025, 0.004)], [0.0062, 0.0072, 0.0098]), 0.006)
    p.add(p_ellip((0.012, -L + 0.009, 0.004), (0.02, 0.0095, 0.013)), 0.008)
    return p


def femur_part(seed=0, broken=None, keep="top"):
    L = L_FEM
    p = Part(h=0.0022)
    p.add(p_sphere((0, 0, 0), 0.0235))
    p.add(p_cone(V3(0.0, 0.0, 0.0), V3(0.045, -0.04, -0.004), 0.0145, 0.016), 0.008)                  # neck
    p.add(p_ellip((0.058, -0.03, -0.008), (0.016, 0.024, 0.017)), 0.012)                               # greater trochanter
    p.add(p_sphere((0.025, -0.07, -0.012), 0.011), 0.012)                                               # lesser trochanter
    p.addm(chain([V3(0.048, -0.055, -0.002), V3(0.03, -0.2, 0.009), V3(0.004, -L + 0.06, 0.0)], [0.016, 0.0135, 0.0155]), 0.012)
    for sx in (-1, 1):
        p.add(p_ellip((sx * 0.022, -L + 0.018, -0.008), (0.018, 0.024, 0.027)), 0.012)                  # condyles
    p.sub(p_ellip((0, -L + 0.004, -0.02), (0.008, 0.02, 0.02)), 0.004)                                  # intercondylar notch
    p.add(p_ellip((0, -L + 0.035, 0.016), (0.022, 0.02, 0.008)), 0.008)                                 # patellar surface
    if broken is not None:
        y0 = -broken * L
        sgn = -1 if keep == "top" else 1
        p.cut(noisy_cut((0, y0, 0), (0, sgn, 0.35 * sgn), seed + 7, 0.012, 60.0))
    return p


def tibia_part(seed=0):
    L = L_TIB
    p = Part(h=0.002)
    p.add(p_ellip((0, -0.016, -0.004), (0.037, 0.014, 0.027)))                                          # plateau
    p.add(p_sphere((0, -0.05, 0.016), 0.01), 0.012)                                                     # tuberosity
    p.addm(chain([V3(0, -0.03, 0.0), V3(-0.002, -0.2, 0.002), V3(-0.004, -L + 0.03, 0.0)], [0.017, 0.0105, 0.0125]), 0.012)
    p.add(p_cone(V3(0, -0.06, 0.01), V3(-0.002, -0.3, 0.008), 0.007, 0.006), 0.008)                   # crest
    p.add(p_ellip((-0.002, -L + 0.012, 0.0), (0.02, 0.014, 0.018)), 0.008)
    p.add(p_ellip((-0.02, -L - 0.002, 0.004), (0.006, 0.012, 0.008)), 0.005)                            # medial malleolus
    p.addm(chain([V3(0.03, -0.03, -0.014), V3(0.028, -0.2, -0.012), V3(0.03, -L + 0.0, -0.012)], [0.0075, 0.0055, 0.006]), 0.004)  # fibula
    p.add(p_ellip((0.032, -L - 0.008, -0.01), (0.007, 0.016, 0.008)), 0.004)
    return p


def hand_part(curl=0.4, spread=0.0, seed=0, grip=None):
    """wrist at the origin, fingers along -Y, palm +Z, thumb +X (left hand)."""
    rng = np.random.default_rng(SEED + 7 * seed)
    p = Part(h=0.0012)
    for c, r in ((V3(0.012, -0.012, 0.0), 0.0085), (V3(-0.002, -0.011, -0.002), 0.008), (V3(-0.015, -0.012, 0.0), 0.0075),
                 (V3(0.014, -0.026, 0.002), 0.008), (V3(0.001, -0.027, 0.0), 0.0085), (V3(-0.014, -0.025, 0.0), 0.0075)):
        p.add(p_sphere(c, r), 0.004)
    fing = [(0.017, 0.064, (0.039, 0.024, 0.017)), (0.004, 0.063, (0.044, 0.028, 0.018)),
            (-0.009, 0.058, (0.041, 0.026, 0.018)), (-0.02, 0.052, (0.033, 0.019, 0.016))]
    for fi, (x0, lm, ph) in enumerate(fing):
        sp = (fi - 1.5) * 0.12 * (1 + spread)
        base = V3(x0, -0.032, 0.0)
        d = nrm(V3(math.sin(sp) * 0.6, -1, 0.06))
        head = base + lm * d
        p.add(p_cone(base, head, 0.0048, 0.0042), 0.002)
        p.add(p_sphere(head, 0.0052), 0.0015)
        phi = 0.0
        cur = head
        jc = curl + 0.15 * (rng.random() - 0.5)
        for k, l in enumerate(ph):
            phi += jc * (0.85, 1.2, 0.75)[k]
            dd = nrm(V3(d[0] * 0.8, -math.cos(phi), math.sin(phi)))
            nxt = cur + l * dd
            r0, r1 = (0.0042, 0.0034, 0.003)[k], (0.0034, 0.003, 0.0022)[k]
            p.add(p_cone(cur + 0.002 * dd, nxt, r0, r1), 0.001)
            p.add(p_sphere(nxt, r1 + 0.0007), 0.001)
            cur = nxt + 0.0018 * dd
    # thumb
    base = V3(0.02, -0.024, 0.006)
    d = nrm(V3(0.55, -0.8, 0.35))
    head = base + 0.044 * d
    p.add(p_cone(base, head, 0.0055, 0.0046), 0.002)
    phi = 0.0
    cur = head
    for k, l in enumerate((0.031, 0.024)):
        phi += curl * 0.8
        dd = nrm(d + V3(-0.5 * math.sin(phi), 0, 0.8 * math.sin(phi)))
        nxt = cur + l * dd
        p.add(p_cone(cur + 0.002 * dd, nxt, 0.0044 - 0.001 * k, 0.0034 - 0.001 * k), 0.001)
        p.add(p_sphere(nxt, 0.0036 - 0.001 * k), 0.001)
        cur = nxt + 0.0018 * dd
    return p


def foot_part(seed=0):
    """ankle at the origin, toes +Z, sole down (left foot: big toe at -X)."""
    p = Part(h=0.0017)
    p.add(p_ellip((0, -0.012, 0.004), (0.019, 0.013, 0.025)))                                          # talus
    p.add(p_ellip((0.004, -0.04, -0.03), (0.018, 0.02, 0.034), rot((1, 0, 0), -0.3)), 0.008)           # calcaneus
    p.add(p_ellip((0.0, -0.035, 0.042), (0.03, 0.015, 0.022)), 0.008)                                   # tarsus
    for t, x in enumerate((-0.022, -0.009, 0.002, 0.013, 0.024)):
        a = V3(x, -0.04, 0.058)
        b = V3(x * 1.25, -0.058, 0.125 - 0.008 * t)
        r = 0.0065 if t == 0 else 0.0045
        p.add(p_cone(a, b, r, r * 0.85), 0.003)
        p.add(p_sphere(b, r * 1.05), 0.002)
        cur = b
        for k, l in enumerate((0.028, 0.012, 0.01)[: (2 if t == 0 else 3)]):
            nxt = cur + V3(0, -0.004 + 0.002 * k, l if t else l * 1.2)
            p.add(p_cone(cur, nxt, r * (0.8 - 0.1 * k), r * (0.7 - 0.1 * k)), 0.001)
            cur = nxt
    return p


# =====================================================================================================================
# extras: cloth, belt, piton, hook, rubble
# =====================================================================================================================
def rag_part(cores, offset, keep, seed, thick=0.0035, holes=0.62):
    """a tattered shell `offset` out from the union of cores; keep(P) <= 0 is the region it covers."""
    p = Part(h=0.0028)
    p.ops = [("u", (lambda P, fs=[c[0] for c in cores]: np.abs(np.min(np.stack([f(P) for f in fs], 0), 0) - offset) - thick,
                    np.min([c[1] for c in cores], 0) - offset, np.max([c[2] for c in cores], 0) + offset), 0.0)]
    p.cut(lambda P: keep(P) + 0.03 * (fbm(P, 22.0, seed, 3) - 0.5), 0.0)
    p.cut(lambda P: (fbm(P * V3(1, 0.35, 1), 34.0, seed + 3, 2) - holes) * 0.02, 0.0)
    return p


def belt_part(Rp, P0, seed):
    """a sagging leather belt round the pelvis + a buckle (world)."""
    pts = []
    for j in range(25):
        a = 2 * math.pi * j / 24
        x, z = 0.155 * math.sin(a), 0.115 * math.cos(a) - 0.01
        y = 0.075 - 0.05 * max(0, math.cos(a)) ** 2 + 0.01 * math.sin(3 * a + seed)
        pts.append(P0 + Rp @ V3(x, y, z))
    p = Part(h=0.0024)
    for j in range(24):
        a, b = pts[j], pts[j + 1]
        mid = 0.5 * (a + b)
        t = nrm(b - a)
        out = nrm(mid - (P0 + Rp @ V3(0, 0.06, -0.01)))
        out = nrm(out - np.dot(out, t) * t)
        up = np.cross(t, out)
        M = np.stack([t, up, out], 1)
        p.add(p_box(mid, (np.linalg.norm(b - a) * 0.5 + 0.002, 0.019, 0.0028), M, 0.0015))
    front = pts[0]
    return p, front


def buckle_part(c, Rp):
    p = Part(h=0.0014)
    out = Rp @ V3(0, 0, 1)
    M = np.stack([Rp @ V3(1, 0, 0), Rp @ V3(0, 1, 0), out], 1)
    p.add(p_box(c + out * 0.003, (0.026, 0.024, 0.004), M, 0.002))
    p.sub(p_box(c + out * 0.003, (0.018, 0.016, 0.01), M, 0.001))
    p.add(p_cone(c + out * 0.006 + Rp @ V3(-0.016, 0, 0), c + out * 0.008 + Rp @ V3(0.02, 0, 0), 0.0025), 0.0)   # tongue
    return p


def piton_part(c, M):
    p = Part(h=0.0011)
    c = V3(c)
    a = c
    b = c + M @ V3(0, -0.11, 0)
    p.add(p_cone(a, b, 0.0055, 0.0018))
    p.add(p_box(c + M @ V3(0, -0.02, 0), (0.006, 0.02, 0.004), M, 0.001), 0.002)
    p.add(p_torus(c + M @ V3(0, 0.016, 0), M @ rot((1, 0, 0), math.pi / 2), 0.014, 0.0035), 0.002)   # eye
    return p


def rubble_part(seed, n=9, rad=0.32, hmax=0.12):
    rng = np.random.default_rng(SEED + 333 * seed)
    p = Part(h=0.004)
    for i in range(n):
        a = rng.random() * 2 * math.pi
        r = rad * math.sqrt(rng.random())
        s = 0.022 + 0.03 * rng.random()
        c = V3(r * math.cos(a), s * 0.4 + hmax * (1 - r / rad) * 0.6, r * math.sin(a))
        R = rot(nrm(rng.normal(size=3)), rng.random() * 3)
        p.add(p_box(c, (s, s * 0.6, s * 0.8), R, 0.006), 0.006)
    p.cut(lambda P: -P[:, 1] - 0.01)
    return p


# =====================================================================================================================
# THE POSED SKELETON
# =====================================================================================================================
def place_long(mesh, A, B, ant, side):
    d = nrm(B - A)
    ey = -d
    ez = ant - np.dot(ant, ey) * ey
    if np.linalg.norm(ez) < 1e-4:
        ez = np.array([0.0, 0.0, 1.0]) - ey[2] * ey
    ez = nrm(ez)
    ex = np.cross(ey, ez)
    M = np.stack([ex * side, ey, ez], 1)
    return mesh.xf(M, A)


def settle(J, d, L, rest, floor):
    d = nrm(d)
    if not floor:
        return J + L * d, d
    want = (rest - J[1]) / L
    want = max(-0.98, min(0.98, want))
    hz = np.array([d[0], 0, d[2]])
    hz = nrm(hz) if np.linalg.norm(hz) > 1e-6 else np.array([1.0, 0, 0])
    d2 = hz * math.sqrt(1 - want * want) + np.array([0, want, 0])
    return J + L * d2, d2


def hermite(p0, p1, t0, t1, n):
    out = []
    for i in range(n):
        s = (i + 0.5) / n
        h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
        p = h00 * p0 + h10 * t0 + h01 * p1 + h11 * t1
        dp = (6 * s * s - 6 * s) * p0 + (3 * s * s - 4 * s + 1) * t0 + (-6 * s * s + 6 * s) * p1 + (3 * s * s - 2 * s) * t1
        out.append((p, nrm(dp), s))
    return out


def skeleton(pose, seed, opts=None):
    """returns (meshes, info) for a posed skeleton. pose: frames + limb directions (world, Y up)."""
    o = opts or {}
    if pose.get("ground") and not o.get("_grounded"):
        probe = dict(pose)
        probe = {k: v for k, v in pose.items() if not k.startswith(("arm", "leg"))}
        ms0, _ = skeleton(probe, seed, dict(o, _grounded=True))
        lo = min(m.V[:, 1].min() for m in ms0)
        pose = dict(pose, P=tuple(V3(pose["P"]) + V3(0, -lo - 0.004, 0)))
        o = dict(o, _grounded=True)
    out = []
    info = {}
    P = V3(pose["P"])
    Rp = frame(pose["pel_up"], pose["pel_fwd"])
    Rc = frame(pose["ch_up"], pose["ch_fwd"])
    Rh = frame(pose["head_up"], pose["head_fwd"])
    info.update(P=P, Rp=Rp, Rc=Rc, Rh=Rh)
    out.append(build(("pelvis", 0), lambda: pelvis_part(0)).xf(Rp, P))
    S = P + Rp @ V3(0, 0.098, -0.068)
    lum_dir = nrm(Rp[:, 1] * 0.6 + Rc[:, 1] * 0.4) if "lumbar" not in pose else nrm(pose["lumbar"])
    C = S + 0.175 * lum_dir
    info["C"] = C
    vl = build(("vert", "l"), lambda: vertebra_part("l"))
    for (pt, tan, s) in hermite(S, C, Rp[:, 1] * 0.2, Rc[:, 1] * 0.2, 5):
        fw = Rp[:, 2] * (1 - s) + Rc[:, 2] * s
        out.append(vl.xf(frame(tan, fw), pt + frame(tan, fw)[:, 2] * 0.004))
    thk = ("thorax", seed, tuple(sorted(o.get("broken_ribs", ()))), o.get("collapse", 0.0))
    out.append(build(thk, lambda: thorax_part(seed, o.get("broken_ribs", ()), o.get("collapse", 0.0))).xf(Rc, C + Rc @ V3(0, 0.0, 0.0)))
    N = C + Rc @ NECK_BASE
    neck_dir = nrm(Rc[:, 1] + Rh[:, 1] * 1.3 + pose.get("neck_bias", np.zeros(3)))
    K = N + 0.105 * neck_dir
    vc = build(("vert", "c"), lambda: vertebra_part("c"))
    for (pt, tan, s) in hermite(N, K, Rc[:, 1] * 0.08, Rh[:, 1] * 0.08, 7):
        fw = Rc[:, 2] * (1 - s) + Rh[:, 2] * s
        out.append(vc.xf(frame(tan, fw), pt))
    # skull: the condyles on K
    sk = build(("skull", seed, o.get("hollow", False)), lambda: skull_part(seed, hollow=o.get("hollow", False), missing=o.get("missing_teeth", (3, 11))))
    Ks = V3(0, -0.058, -0.02)
    hm_ = sk.xf(Rh, K - Rh @ Ks + Rh @ V3(0, 0.004, 0))
    hm_.grp = 1
    out.append(hm_)
    info["skull_c"] = K - Rh @ Ks
    if not o.get("no_jaw", False):
        jw = build(("jaw", seed), lambda: mandible_part(seed, missing=o.get("missing_low", (2,))))
        Rj = Rh @ rot((1, 0, 0), math.radians(pose.get("jaw", 8)))
        piv = K - Rh @ Ks + Rh @ JAW_PIVOT
        out.append(jw.xf(Rj, piv - Rj @ JAW_PIVOT))
    # arms
    hum = build(("hum", 0), lambda: humerus_part(0))
    fore = build(("fore", 0), lambda: forearm_part(0))
    for side, key in ((1, "armL"), (-1, "armR")):
        arm = pose.get(key)
        if arm is None:
            continue
        sh = C + Rc @ (SHOULDER * V3(side, 1, 1))
        fl = arm.get("floor", False)
        flu, flf = (fl, fl) if isinstance(fl, bool) else fl
        rest = arm.get("rest", 0.03)
        E, du = settle(sh, arm["up"], L_HUM, rest, flu)
        Wr, df = settle(E, arm["fo"], L_FORE, rest - 0.008, flf)
        ant = df - np.dot(df, du) * du
        if np.linalg.norm(ant) < 0.15:
            ant = Rc[:, 2]
        out.append(place_long(hum, sh, E, ant, side))
        out.append(place_long(fore, E, Wr, nrm(arm.get("palm", Rc[:, 2])), side))
        curl = arm.get("curl", 0.35)
        hk = ("hand", round(curl, 2), round(arm.get("spread", 0.0), 2), seed + side)
        hm = build(hk, lambda: hand_part(curl, arm.get("spread", 0.0), seed + side))
        hd = nrm(arm.get("hand", df))
        palm = nrm(arm.get("palm", Rc[:, 2]))
        Mh = frame(-hd, palm)
        Mh = np.stack([Mh[:, 0] * side, Mh[:, 1], Mh[:, 2]], 1)
        out.append(hm.xf(Mh, Wr + 0.004 * hd))
        info[key] = dict(sh=sh, E=E, W=Wr, hd=hd, palm=palm, Mh=Mh)
    # legs
    fem_full = build(("fem", 0), lambda: femur_part(0))
    tib = build(("tib", 0), lambda: tibia_part(0))
    ft = build(("foot", 0), lambda: foot_part(0))
    for side, key in ((1, "legL"), (-1, "legR")):
        leg = pose.get(key)
        if leg is None:
            continue
        H = P + Rp @ V3(side * 0.085, 0, 0)
        fl = leg.get("floor", False)
        rest = leg.get("rest", 0.035)
        Kn, dth = settle(H, leg["th"], L_FEM, rest, fl)
        ant = -(nrm(leg.get("sh", -Rp[:, 1])) - np.dot(nrm(leg.get("sh", -Rp[:, 1])), dth) * dth)
        if np.linalg.norm(ant) < 0.15:
            ant = Rp[:, 2]
        if leg.get("stump") is not None:
            fb = build(("femb", leg["stump"], seed), lambda: femur_part(seed, broken=leg["stump"], keep="top"))
            out.append(place_long(fb, H, Kn, ant, side))
            info[key] = dict(H=H, K=Kn)
            continue
        out.append(place_long(fem_full, H, Kn, ant, side))
        A, dsh = settle(Kn, leg["sh"], L_TIB, rest - 0.005, fl)
        fwd = nrm(leg.get("foot", Rp[:, 2]))
        out.append(place_long(tib, Kn, A, fwd, side))
        if leg.get("no_foot"):
            continue
        sole = nrm(leg.get("sole", -dsh))
        Mf = frame(-sole, fwd)
        Mf = np.stack([Mf[:, 0] * side, Mf[:, 1], Mf[:, 2]], 1)
        out.append(ft.xf(Mf, A))
        info[key] = dict(H=H, K=Kn, A=A)
    return out, info


# =====================================================================================================================
# assembling a kit mesh: classes, decimation, AO, colour
# =====================================================================================================================
CLS = {"bone": 0, "cloth": 1, "leather": 2, "iron": 3, "rope": 4, "stone": 5}


def concat(ms):
    V, F, det, bld, cls = [], [], [], [], []
    off = 0
    for m in ms:
        V.append(m.V)
        F.append(m.F + off)
        det.append(m.det)
        bld.append(m.bld)
        cls.append(np.full(len(m.V), m.cls))
        off += len(m.V)
    return np.concatenate(V), np.concatenate(F), np.concatenate(det), np.concatenate(bld), np.concatenate(cls)


def np_to_mesh(name, V, F, attrs=None):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", V.astype(np.float32).ravel())
    me.loops.add(F.size)
    me.loops.foreach_set("vertex_index", F.astype(np.int32).ravel())
    me.polygons.add(len(F))
    me.polygons.foreach_set("loop_start", np.arange(0, F.size, 3, dtype=np.int32))
    me.update()
    for k, arr in (attrs or {}).items():
        at = me.attributes.new(k, "FLOAT", "POINT")
        at.data.foreach_set("value", arr.astype(np.float32))
    return me


def decimate(V, F, attrs, target, smooth=1, remesh=0.0):
    """QEM collapse to `target` triangles. Blender to Z-up does not matter here: geometry only."""
    me = np_to_mesh("tmp", V, F, attrs)
    ob = bpy.data.objects.new("tmp", me)
    bpy.context.scene.collection.objects.link(ob)
    if remesh > 0:
        m = ob.modifiers.new("rm", "REMESH")
        m.mode = "VOXEL"
        m.voxel_size = remesh
        m.use_smooth_shade = True
    if smooth:
        m = ob.modifiers.new("sm", "SMOOTH")
        m.factor = 0.5
        m.iterations = smooth
    if target < len(F):
        m = ob.modifiers.new("dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = target / len(F)
        m.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    me2.calc_loop_triangles()
    n = len(me2.vertices)
    V2 = np.zeros(n * 3, dtype=np.float32)
    me2.vertices.foreach_get("co", V2)
    T = np.zeros(len(me2.loop_triangles) * 3, dtype=np.int32)
    me2.loop_triangles.foreach_get("vertices", T)
    out = {}
    for k in (attrs or {}):
        a = np.zeros(n, dtype=np.float32)
        if k in me2.attributes:
            me2.attributes[k].data.foreach_get("value", a)
        out[k] = a.astype(np.float64)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(me2)
    return V2.reshape(-1, 3).astype(np.float64), T.reshape(-1, 3).astype(np.int64), out


def vertex_normals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def convexity(V, F, N):
    s = np.zeros(len(V))
    c = np.zeros(len(V))
    for a, b in ((0, 1), (1, 2), (2, 0), (1, 0), (2, 1), (0, 2)):
        e = V[F[:, b]] - V[F[:, a]]
        l = np.linalg.norm(e, axis=1) + 1e-9
        np.add.at(s, F[:, a], -(np.sum(e * N[F[:, a]], 1)) / l)
        np.add.at(c, F[:, a], 1)
    return s / np.maximum(c, 1)


def ambient_occlusion(V, F, N, floor=None, wall=None, rays=40, dist=0.3, seed=0):
    bvh = BVHTree.FromPolygons([tuple(v) for v in V], [tuple(int(i) for i in f) for f in F], all_triangles=True)
    rng = np.random.default_rng(SEED + seed)
    u = rng.random((rays, 2))
    # cosine hemisphere samples (fixed set, rotated per vertex by a random twist)
    r = np.sqrt(u[:, 0])
    th = 2 * math.pi * u[:, 1]
    loc = np.stack([r * np.cos(th), r * np.sin(th), np.sqrt(1 - u[:, 0])], 1)
    ao = np.zeros(len(V))
    tw = rng.random(len(V)) * 2 * math.pi
    for i in range(len(V)):
        n = N[i]
        t = nrm(np.cross(n, [0.0, 1.0, 0.0] if abs(n[1]) < 0.9 else [1.0, 0.0, 0.0]))
        b = np.cross(n, t)
        c, s = math.cos(tw[i]), math.sin(tw[i])
        t, b = c * t + s * b, -s * t + c * b
        D = loc[:, 0:1] * t + loc[:, 1:2] * b + loc[:, 2:3] * n
        o = V[i] + n * 0.0015
        ov = Vector(o)
        hit = 0
        for d in D:
            if floor is not None and d[1] < -1e-4 and (o[1] - floor) / -d[1] < 0.07:
                hit += 1
                continue
            if wall is not None and d[2] < -1e-4 and (o[2] - wall) / -d[2] < 0.07:
                hit += 1
                continue
            if bvh.ray_cast(ov, Vector(d), dist)[0] is not None:
                hit += 1
        ao[i] = 1 - hit / rays
    return ao


def srgb_to_lin(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


PAL = dict(
    bone=np.array([0.80, 0.73, 0.57]), bone2=np.array([0.68, 0.60, 0.44]), bonepale=np.array([0.86, 0.81, 0.68]),
    grime=np.array([0.29, 0.21, 0.12]), deep=np.array([0.075, 0.05, 0.035]), soil=np.array([0.17, 0.13, 0.085]),
    stain=np.array([0.42, 0.33, 0.21]), blood=np.array([0.30, 0.055, 0.035]), blood2=np.array([0.17, 0.035, 0.025]),
    cloth=np.array([0.13, 0.115, 0.095]), cloth2=np.array([0.2, 0.17, 0.13]), leather=np.array([0.19, 0.115, 0.065]),
    iron=np.array([0.1, 0.085, 0.075]), rust=np.array([0.33, 0.15, 0.07]), rope=np.array([0.36, 0.29, 0.19]),
    stone=np.array([0.27, 0.22, 0.16]),
)


def colourise(V, F, cls, det, bld, ao, conv, seed, blood_spots, floor):
    rng = np.random.default_rng(SEED + 77 * seed)
    off = rng.random(3) * 50
    P = V + off
    n1 = fbm(P, 9.0, seed + 1, 3)
    n2 = fbm(P, 26.0, seed + 2, 3)
    n3 = fbm(P, 3.0, seed + 3, 2)
    col = np.zeros((len(V), 3))
    # ---- bone
    t = np.clip(n1 * 1.2 - 0.1, 0, 1)[:, None]
    bone = PAL["bone"] * (1 - t) + PAL["bone2"] * t
    bone = bone * (1 - 0.25 * sstep(0.55, 0.8, conv * 3 + 0.5)[:, None] * 0) + 0.0
    hi = sstep(0.02, 0.12, conv)[:, None]                               # convex ridges: paler, worn
    bone = bone * (1 - 0.35 * hi) + PAL["bonepale"] * 0.35 * hi
    st = sstep(0.5, 0.78, n3)[:, None] * 0.7 + sstep(0.55, 0.85, n2)[:, None] * 0.45
    bone = bone * (1 - st) + PAL["stain"] * st
    cav = np.clip(sstep(-0.02, -0.15, conv) * 0.7 + (1 - ao) * 0.9, 0, 1)[:, None]
    bone = bone * (1 - cav * 0.85) + PAL["grime"] * cav * 0.85
    d = np.clip(det, 0, 1)[:, None]
    bone = bone * (1 - d * 0.85) + PAL["deep"] * d * 0.85
    if floor is not None:
        tide = (1 - sstep(0.004, 0.035 + 0.02 * n2, V[:, 1] - floor))[:, None]
        bone = bone * (1 - 0.7 * tide) + PAL["soil"] * 0.7 * tide
    # blood: spots with downward runs
    bw = np.zeros(len(V))
    for (c, r, run) in blood_spots:
        q = V - V3(c)
        below = np.maximum(0, -q[:, 1])
        dd = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2 + np.where(q[:, 1] < 0, (q[:, 1] / (1 + run)) ** 2, q[:, 1] ** 2))
        bw = np.maximum(bw, 1 - sstep(r * 0.55, r * (1.0 + 0.35 * (n2 - 0.5)), dd + 0.0 * below))
    bw = np.clip(bw * (0.75 + 0.5 * n2), 0, 1) * sstep(0.2, 0.45, bw)
    bl = (PAL["blood"] * (1 - n1[:, None]) + PAL["blood2"] * n1[:, None])
    bone = bone * (1 - 0.88 * bw[:, None]) + bl * 0.88 * bw[:, None]
    col[cls == 0] = bone[cls == 0]
    # ---- cloth
    m = cls == 1
    cl = PAL["cloth"] * (1 - n2[:, None]) + PAL["cloth2"] * n2[:, None]
    cl = cl * (0.8 + 0.4 * n1[:, None]) * (1 - 0.4 * bw[:, None]) + PAL["blood2"] * 0.4 * bw[:, None]
    col[m] = cl[m]
    m = cls == 2
    le = PAL["leather"] * (0.75 + 0.5 * n2[:, None])
    le = le * (1 - 0.3 * hi) + np.array([0.3, 0.22, 0.15]) * 0.3 * hi
    col[m] = le[m]
    m = cls == 3
    rr = sstep(0.35, 0.65, n2)[:, None]
    ir = PAL["iron"] * (1 - rr) + PAL["rust"] * rr
    ir = ir * (1 - 0.3 * hi) + np.array([0.45, 0.24, 0.12]) * 0.3 * hi
    col[m] = ir[m]
    m = cls == 4
    ro = PAL["rope"] * (0.7 + 0.45 * det[:, None]) * (0.8 + 0.3 * n1[:, None])
    col[m] = ro[m]
    m = cls == 5
    sto = PAL["stone"] * (0.75 + 0.5 * n1[:, None])
    col[m] = sto[m]
    # AO everywhere (multiplied), grime tint in occlusion for non-bone too
    a = ao[:, None]
    col = col * (0.28 + 0.72 * a)
    return np.clip(col, 0, 1)


KIT = {}           # name -> dict(V, F, C, tris)
REPORT = {}


def finish(name, ms, budget, floor=0.0, wall=None, blood=(), seed=0, origin=None, clamp=True):
    """ms: list of Mesh (any classes) or ready meshes flagged keep (no decimation)."""
    groups = {}
    keep = []
    for m in ms:
        if getattr(m, "keep", False):
            keep.append(m)
        else:
            groups.setdefault((m.cls, m.grp), []).append(m)
    keep_tris = sum(len(m.F) for m in keep)
    hi_tris = {c: sum(len(m.F) for m in g) for c, g in groups.items()}
    tot_hi = sum(hi_tris.values())
    avail = budget - keep_tris
    weight = {0: 1.0, 1: 1.6, 2: 0.9, 3: 0.8, 4: 0.6, 5: 0.35}
    W = lambda c: weight[c[0]] * (1.8 if c[1] == 1 else 1.0)
    wsum = sum(hi_tris[c] * W(c) for c in groups)
    parts = []
    for c, g in sorted(groups.items()):
        g = [cull_small(m, 400 if c[0] in (1, 5) else 120) for m in g]
        V, F, det, bld, cl = concat(g)
        if clamp and floor is not None:
            V[:, 1] = np.maximum(V[:, 1], floor - 0.012)
        tgt = int(avail * hi_tris[c] * W(c) / wsum)
        V2, F2, at = decimate(V, F, {"det": det, "bld": bld}, tgt, smooth=0 if c[0] == 3 else 1, remesh=0.006 if c[0] in (1, 2) else 0.0)
        if len(F2) > tgt * 1.05:
            log(f"  group {c}: {len(F2)} > {tgt}, re-decimating")
            V2, F2, at = decimate(V2, F2, at, tgt, smooth=0)
        parts.append(Mesh(V2, F2, c[0], at["det"], at["bld"]))
    parts += keep
    V, F, det, bld, cls = concat(parts)
    N = vertex_normals(V, F)
    conv = convexity(V, F, N)
    ao = ambient_occlusion(V, F, N, floor=floor, wall=wall, seed=seed)
    C = colourise(V, F, cls, det, bld, ao, conv, seed, blood, floor)
    lum = C @ np.array([0.3, 0.55, 0.15])
    log(f"  colour lum p5/p50/p95 {np.percentile(lum, 5):.2f}/{np.percentile(lum, 50):.2f}/{np.percentile(lum, 95):.2f}, ao p50 {np.median(ao):.2f}")
    if origin is not None:
        V = V - V3(origin)
    KIT[name] = dict(V=V, F=F, C=C)
    REPORT[name] = dict(tris=int(len(F)), verts=int(len(V)), hi_tris=int(tot_hi + keep_tris),
                        bbox=[np.round(V.min(0), 3).tolist(), np.round(V.max(0), 3).tolist()])
    log(f"{name}: {len(F)} tris (budget {budget}), {len(V)} verts, bbox {REPORT[name]['bbox']}")


def keepm(m):
    m.keep = True
    return m


def base_origin(ms, y0=None):
    V = np.concatenate([m.V for m in ms])
    return V3((V[:, 0].min() + V[:, 0].max()) / 2, V[:, 1].min() if y0 is None else y0, (V[:, 2].min() + V[:, 2].max()) / 2)


def recentre(ms, floor=True):
    o = base_origin(ms)
    return [m.xf(np.eye(3), -o) for m in ms]


# =====================================================================================================================
# THE KIT
# =====================================================================================================================
def mk_skull(name, seed, jaw=True, hole=False):
    sk = build(("skullS", seed, hole), lambda: skull_part(seed, hollow=False, hole=hole, missing=(2, 9) if jaw else (4, 5, 12)))
    ms = [sk]
    if jaw:
        jw = build(("jawS", seed), lambda: mandible_part(seed, missing=(10,)))
        Rj = rot((1, 0, 0), math.radians(14))
        jm = jw.xf(Rj, JAW_PIVOT - Rj @ JAW_PIVOT + V3(0.004, -0.003, 0.0))
        jm.grp = 2
        ms.append(jm)
    # rest it on the floor: tipped a little, the jawless one on its side
    R = rot((0, 1, 0), 0.4) @ rot((1, 0, 0), -0.08 if jaw else 0.0) @ (rot((0, 0, 1), 0.35) if not jaw else np.eye(3))
    ms = [m.xf(R, np.zeros(3)) for m in ms]
    ms = recentre(ms)
    ms = [m.xf(np.eye(3), V3(0, -0.004, 0)) for m in ms]
    spots = [((0.03, 0.12, 0.03), 0.03, 2.0)] if hole else []
    finish(name, ms, 880, floor=0.0, blood=spots, seed=seed)


def lying_a():
    # on its back, head +Z, the right arm stretched overhead along the floor reaching, a piton in the fist
    pose = dict(P=(0, 0.1, 0), ground=True, pel_up=(0.05, 0.1, 1), pel_fwd=(0, 1, -0.1), ch_up=(-0.04, 0.06, 1), ch_fwd=(0.06, 1, -0.06),
                head_up=(0.25, -0.1, 1), head_fwd=(0.75, 0.65, 0.05), jaw=22,
                armR=dict(up=(0.45, 0, 1), fo=(0.2, 0, 1), hand=(0.12, 0, 1), palm=(0, -1, 0.2), curl=0.75, floor=True, rest=0.03),
                armL=dict(up=(-0.15, 0, -1), fo=(0.85, 0.45, -0.15), hand=(0.9, -0.15, 0.2), palm=(0.0, -1, 0.1), curl=0.45, floor=(True, False), rest=0.035),
                legL=dict(th=(-0.25, 0, -1), sh=(-0.12, 0, -1), foot=(-0.6, 0.8, 0.0), sole=(0, 0, -1), floor=True, rest=0.035),
                legR=dict(th=(0.12, 0, -1), sh=(0.1, 0, -1), foot=(0.45, 0.85, 0), sole=(0, 0, -1), floor=True, rest=0.035))
    ms, info = skeleton(pose, 11, dict(broken_ribs=((4, 1), (6, 1), (5, -1)), collapse=0.25, missing_teeth=(1, 6, 7)))
    # the piton in the reaching fist, a rope end tangled on the wrist and trailing
    a = info["armR"]
    Mh = a["Mh"]
    pc = a["W"] + a["hd"] * 0.075 + V3(0, 0.012, 0)
    Mp = frame(nrm(-a["hd"] + V3(0, 0.0, 0) + V3(0.0, 0.3, 0)), V3(1, 0, 0))
    ms.append(build(("piton", 1), lambda: piton_part(pc, Mp), cls=3))
    rope = []
    w = a["W"]
    for j in range(40):
        t = j / 39
        if t < 0.45:
            ang = t / 0.45 * 4 * math.pi
            rope.append(w + a["hd"] * (0.01 + 0.04 * t) + 0.024 * (math.cos(ang) * V3(1, 0, 0) + math.sin(ang) * V3(0, 1, 0)) + V3(0, 0.012, 0))
        else:
            s = (t - 0.45) / 0.55
            rope.append(w + V3(0.08 + 0.35 * s, 0.009, -0.02 - 0.25 * s * s + 0.06 * math.sin(s * 5)))
    rope = np.array(rope)
    rope[:, 1] = np.maximum(rope[:, 1], 0.008)
    ms.append(keepm(tube_mesh(rope, 0.0075, 6)))
    blood = [(info["C"] + info["Rc"] @ V3(0.05, 0.2, 0.12), 0.07, 2.0), (info["skull_c"] + V3(0.05, 0.06, 0.02), 0.04, 2.0)]
    o = base_origin(ms, 0.0)
    finish("Bones_LyingA", ms, 2780, floor=0.0, blood=blood, seed=11, origin=o)


def lying_b():
    # curled on its left side, knees drawn up, hands near the face, a snapped femur
    down = V3(0, -1, 0)
    pose = dict(P=(0, 0.12, 0), pel_up=(-0.35, 0, 1), pel_fwd=(-1, 0.05, -0.35), ch_up=(-0.55, 0.0, 1), ch_fwd=(-1, 0.1, -0.5),
                head_up=(-0.9, 0.1, 0.6), head_fwd=(-0.6, -0.15, -0.8), jaw=30,
                armL=dict(up=(-0.9, -0.3, 0.3), fo=(0.0, 0.0, 1), hand=(0.3, -0.2, 1), palm=(-0.2, -1, 0), curl=0.85, floor=True, rest=0.025),
                armR=dict(up=(-0.7, -0.2, -0.3), fo=(-0.2, 0, 1), hand=(0.1, 0, 1), palm=(-0.4, -1, 0), curl=1.1, floor=True, rest=0.07),
                legL=dict(th=(-1, 0, 0.35), sh=(0.25, 0, -1), foot=(-0.8, 0, -0.3), sole=(0.2, 1, 0), floor=True, rest=0.03),
                legR=dict(th=(-1, 0.1, 0.1), sh=(0.5, 0, -1), foot=(-1, 0.2, 0), sole=(0.4, 0.6, -0.6), floor=True, rest=0.09, stump=0.55))
    ms, info = skeleton(pose, 23, dict(broken_ribs=((8, -1), (9, -1)), missing_teeth=(0, 5, 12, 13), collapse=0.1))
    # the snapped femur's lower half + tibia + foot lying apart
    lo = build(("femb_lo", 23), lambda: femur_part(24, broken=0.55, keep="bottom"))
    H = info["legR"]["H"]
    Kn = info["legR"]["K"]
    off = V3(0.12, 0, 0.1)
    d = nrm(V3(0.3, 0, 1))
    A1 = V3(Kn[0] + 0.25, 0.04, Kn[2] - 0.05)
    A0 = A1 - d * L_FEM
    ms.append(place_long(lo, A0, A1, V3(0, 1, 0), -1))
    ti = build(("tib", 0), lambda: tibia_part(0))
    A2 = A1 + nrm(V3(0.95, 0, -0.3)) * L_TIB
    A1b = A1 + V3(0, 0.0, 0)
    A2[1] = 0.03
    ms.append(place_long(ti, A1b, A2, V3(0, 1, 0), -1))
    ft = build(("foot", 0), lambda: foot_part(0))
    ms.append(ft.xf(np.stack([V3(0, 0, 1), V3(0, 1, 0), V3(-1, 0, 0)], 1) @ rot((0, 0, 1), 1.3), A2 + V3(0.0, 0.0, 0)))
    blood = [(info["C"] + info["Rc"] @ V3(0.1, 0.12, 0.0), 0.06, 1.5), (H + V3(0.0, 0.05, 0.0), 0.05, 1.0)]
    finish("Bones_LyingB", ms, 2780, floor=0.0, blood=blood, seed=23, origin=base_origin(ms, 0.0))


def sitting_wall():
    # slumped against the wall (-Z); head fallen forward; the right hand in the lap; rags over the lap, a belt, a strap
    pose = dict(P=(0, 0.09, 0.26), pel_up=(0, 1, -0.55), pel_fwd=(0, 0.55, 1), ch_up=(0.08, 1, -0.1), ch_fwd=(0, 0.1, 1),
                lumbar=(0, 1, -0.2), head_up=(0.35, 0.45, 0.8), head_fwd=(0.15, -0.85, 0.45), jaw=26, neck_bias=V3(0, 0, 0.6),
                armR=dict(up=(-0.12, -1, 0.3), fo=(0.55, -0.25, 0.8), hand=(0.85, -0.3, 0.3), palm=(0, -1, -0.2), curl=0.55, floor=False),
                armL=dict(up=(0.35, -1, 0.05), fo=(0.35, -0.05, 1), hand=(0.3, 0, 1), palm=(0.1, -1, 0), curl=0.4, floor=True, rest=0.025),
                legL=dict(th=(0.5, 0.0, 1), sh=(0.25, 0, 1), foot=(0.2, 0.9, 0.3), sole=(0.3, -0.2, 1), floor=True, rest=0.03),
                legR=dict(th=(-0.25, 0.75, 0.7), sh=(-0.25, -0.8, 0.5), foot=(-0.3, 0, 1), sole=(0, -1, 0), floor=False))
    ms, info = skeleton(pose, 31, dict(missing_teeth=(2, 3, 10), collapse=0.05))
    P, Rp, Rc, C = info["P"], info["Rp"], info["Rc"], info["C"]
    # the belt + buckle
    bp, front = belt_part(Rp, P, 31)
    ms.append(build(("belt", 31), lambda: bp, cls=2))
    Rb = frame(Rp[:, 1], Rp[:, 2])
    ms.append(build(("buckle", 31), lambda: buckle_part(front + Rp @ V3(0, 0.0, 0.004), Rb), cls=3))
    # rags over the pelvis and the thighs
    kL, kR = info["legL"]["K"], info["legR"]["K"]
    hL, hR = info["legL"]["H"], info["legR"]["H"]
    cores = [p_sphere(P + Rp @ V3(0, 0.04, -0.01), 0.1), p_cone(hL, kL, 0.05, 0.04), p_cone(hR, kR, 0.05, 0.04)]
    keep = lambda X: np.maximum(-(X[:, 1] - 0.045), (X - P) @ nrm(Rp[:, 2] * 0.0 + V3(0, 1, 0)) - 0.2) * 0 + \
        np.maximum(0.03 - X[:, 1], np.linalg.norm((X - P) * V3(1, 0.5, 1), axis=1) - 0.27)
    ms.append(build(("ragA", 31), lambda: rag_part(cores, 0.012, keep, 31, holes=0.6), cls=1))
    # a shirt remnant on the left shoulder + chest, and a pack strap across the ribs
    shc = [p_sphere(C + Rc @ V3(0.0, 0.16, 0.0), 0.15)]
    keep2 = lambda X: np.maximum(np.linalg.norm((X - (C + Rc @ V3(0.1, 0.25, 0.0))) * V3(1, 1.1, 1), axis=1) - 0.15, -((X - C) @ Rc[:, 0]) + 0.01)
    rb = rag_part(shc, 0.005, keep2, 32, holes=0.58)
    rb.cut(lambda X: 0.006 - X[:, 2])
    ms.append(build(("ragB", 31), lambda: rb, cls=1))
    st = []
    for j in range(18):
        t = j / 17
        a = -0.9 + 2.6 * t
        st.append(C + Rc @ V3(0.13 * math.cos(a) * (1 if t < 0.5 else 1), 0.27 - 0.2 * t, 0.06 + 0.075 * math.sin(a)))
    st = np.array(st)
    ms.append(keepm(tube_mesh(st, 0.0075, 5, cls=2)))
    ms = [m for m in ms]
    blood = [(C + Rc @ V3(-0.05, 0.12, 0.13), 0.06, 2.5), (info["skull_c"] + V3(0, 0.07, 0), 0.04, 1.5)]
    o = base_origin(ms, 0.0)
    o[2] = 0.0                                          # the wall plane is z = 0
    zmin = min(m.V[:, 2].min() for m in ms)
    log("sitting zmin (should be >= -0.01):", round(zmin, 3))
    finish("Bones_SittingWall", ms, 2780, floor=0.0, wall=min(0.0, zmin), blood=blood, seed=31, origin=o)


def hanging():
    pose = dict(P=(0, 0.0, 0), pel_up=(0.1, 1, 0.08), pel_fwd=(0.15, -0.08, 1), ch_up=(0.05, 1, -0.04), ch_fwd=(0.08, 0.04, 1),
                head_up=(0.6, 0.55, 0.45), head_fwd=(0.3, -0.8, 0.5), jaw=34, neck_bias=V3(0.9, -0.1, 0.4),
                armL=dict(up=(0.12, -1, 0.05), fo=(0.05, -1, 0.15), hand=(0.0, -1, 0.1), palm=(-0.9, 0, 0.2), curl=0.35),
                armR=dict(up=(-0.14, -1, 0.0), fo=(-0.04, -1, 0.12), hand=(0.0, -1, 0.15), palm=(0.9, 0, 0.3), curl=0.5),
                legL=dict(th=(0.04, -1, 0.06), sh=(0.0, -1, -0.04), foot=(0.15, -0.75, 0.6), sole=(0, -0.6, -0.8)),
                legR=dict(th=(-0.05, -1, 0.12), sh=(-0.02, -1, 0.0), foot=(-0.1, -0.8, 0.55), sole=(0, -0.55, -0.8)))
    ms, info = skeleton(pose, 41, dict(missing_teeth=(4, 6, 8), broken_ribs=((11, 1), (10, -1))))
    # shift so the skull top is 1.8 m below the hook (origin)
    V = np.concatenate([m.V for m in ms])
    top = V[:, 1].max()
    cx, cz = V[:, 0].mean(), V[:, 2].mean()
    sh = V3(-cx, -1.8 - top, -cz)
    ms = [m.xf(np.eye(3), sh) for m in ms]
    info = {k: (v + sh if isinstance(v, np.ndarray) and v.shape == (3,) and k in ("C", "skull_c", "P") else v) for k, v in info.items()}
    # the noose round the cervical spine, knot behind the head, the rope up to the chain + hook
    Rc = info["Rc"]
    neck = info["C"] + Rc @ V3(0, 0.33, -0.01)
    nr = []
    for j in range(17):
        a = 2 * math.pi * j / 16
        nr.append(neck + Rc @ V3(0.034 * math.cos(a), 0.008 * math.sin(a), 0.03 * math.sin(a)))
    ms.append(keepm(tube_mesh(np.array(nr), 0.009, 6, cap=False)))
    knot = neck + Rc @ V3(-0.02, 0.025, -0.05)
    ms.append(keepm(tube_mesh(np.array([knot - V3(0, 0.03, 0), knot + V3(0, 0.03, 0)]), 0.017, 7)))
    top_rope = V3(0, -0.16, 0)
    rp = [knot + (top_rope - knot) * (j / 20) + V3(0.01 * math.sin(j), 0, 0.01 * math.cos(j * 0.7)) * (1 - abs(j / 10 - 1)) for j in range(21)]
    ms.append(keepm(tube_mesh(np.array(rp), 0.0085, 6)))
    # chain (3 links) and the hook with its wall plate (origin = the hook's top)
    for k in range(3):
        R = np.eye(3) if k % 2 == 0 else rot((0, 1, 0), math.pi / 2)
        R = R @ rot((1, 0, 0), math.pi / 2)
        ms.append(keepm(torus_mesh(V3(0, -0.07 - 0.03 * k - 0.0, 0), R, 0.022, 0.0055, 10, 5, squash=1.6)))
    hk = Part(h=0.0018)
    hk.addm(chain([V3(0, 0, 0), V3(0, -0.03, 0), V3(0, -0.045, 0.02), V3(0, -0.035, 0.04), V3(0, -0.02, 0.042)], [0.008, 0.0075, 0.007, 0.0065, 0.005]), 0.004)
    hk.add(p_box(V3(0, 0.0, -0.012), (0.03, 0.04, 0.006), None, 0.003), 0.004)
    ms.append(build(("hook", 0), lambda: hk, cls=3))
    blood = [(info["C"] + Rc @ V3(0.02, 0.33, 0.06), 0.05, 4.0), (info["skull_c"] + V3(0, 0.05, 0.05), 0.04, 3.0)]
    finish("Bones_Hanging", ms, 2980, floor=None, blood=blood, seed=41, origin=V3(0, 0, 0), clamp=False)


def crawler():
    pose = dict(P=(0, 0.11, 0), pel_up=(0, 0.08, 1), pel_fwd=(0.05, -1, 0.08), ch_up=(0.05, 0.32, 1), ch_fwd=(0.0, -1, 0.32),
                head_up=(0.05, 0.85, 0.55), head_fwd=(0.12, -0.45, 0.88), jaw=18,
                armL=dict(up=(0.45, -0.45, 0.75), fo=(-0.05, -0.15, 1), hand=(-0.05, -0.2, 1), palm=(0, -1, 0.1), curl=0.85, floor=True, rest=0.028),
                armR=dict(up=(-0.25, -0.2, 1), fo=(-0.05, 0, 1), hand=(0.1, 0, 1), palm=(0, -1, 0), curl=0.95, spread=0.4, floor=True, rest=0.028),
                legL=dict(th=(0.1, -0.2, -1), sh=(0, 0, -1), foot=(0, -1, -0.3), sole=(0, 0, -1), floor=True, rest=0.03, stump=0.42),
                legR=dict(th=(-0.15, -0.1, -1), sh=(-0.05, 0, -1), foot=(-0.1, -0.8, -0.55), sole=(0, 0.5, -0.9), floor=True, rest=0.035))
    ms, info = skeleton(pose, 53, dict(missing_teeth=(5, 6), broken_ribs=((3, -1),)))
    P, Rp = info["P"], info["Rp"]
    bp, front = belt_part(Rp, P, 53)
    ms.append(build(("belt", 53), lambda: bp, cls=2))
    ms.append(build(("buckle", 53), lambda: buckle_part(front, frame(Rp[:, 1], Rp[:, 2])), cls=3))
    C, Rc = info["C"], info["Rc"]
    shc = [p_sphere(C + Rc @ V3(0.0, 0.12, -0.02), 0.155)]
    keep2 = lambda X: np.maximum(-(X - C) @ (-Rc[:, 2]) + 0.0, np.linalg.norm((X - (C + Rc @ V3(-0.03, 0.12, -0.1))) * V3(1, 1, 1), axis=1) - 0.17)
    ms.append(build(("ragC", 53), lambda: rag_part(shc, 0.006, keep2, 53, holes=0.57), cls=1))
    # the drag: dark smeared trail is the decal's job; blood on the stump end
    blood = [(info["legL"]["H"] + Rp @ V3(0, 0, 0) + nrm(V3(0.1, -0.2, -1)) * 0.19, 0.06, 1.0), (info["skull_c"] + V3(0, -0.05, 0.08), 0.05, 1.0)]
    finish("Bones_Crawler", ms, 2780, floor=0.0, blood=blood, seed=53, origin=base_origin(ms, 0.0))


def reach():
    ms = []
    fore = build(("fore", 0), lambda: forearm_part(0))
    A = V3(0.02, -0.02, 0.0)
    E = V3(0.0, -0.06, -0.05)            # the elbow buried in the pile
    W = E + nrm(V3(0.05, 1, 0.22)) * L_FORE
    ms.append(place_long(fore, E, W, V3(0, 0, 1), 1))
    hm = build(("hand", 0.6, 0.5, 61), lambda: hand_part(0.6, 0.5, 61))
    hd = nrm(V3(0.1, 1, 0.45))
    Mh = frame(-hd, V3(0, -0.35, 1))
    ms.append(hm.xf(Mh, W + 0.004 * hd))
    # rope tangled round the wrist, hanging off
    rp = []
    for j in range(30):
        t = j / 29
        if t < 0.5:
            ang = t / 0.5 * 4.4 * math.pi
            rp.append(W - hd * (0.05 - 0.05 * t) + 0.019 * (math.cos(ang) * V3(1, 0, 0) + math.sin(ang) * V3(0, 0, 1)))
        else:
            s = (t - 0.5) / 0.5
            rp.append(W + V3(0.03 + 0.14 * s, -0.04 - 0.22 * s * s, 0.05 * math.sin(s * 3)))
    ms.append(keepm(tube_mesh(np.array(rp), 0.0065, 5)))
    rb = build(("rubble", 61), lambda: rubble_part(61, 16, 0.2, 0.03), cls=5)
    ms.append(rb.xf(np.eye(3), V3(0, -0.02, 0)))
    # bone fragments in the pile: a rib arc + a broken humerus
    hb = build(("humb", 61), lambda: humerus_part(61, broken=0.5))
    ms.append(place_long(hb, V3(-0.18, 0.05, 0.1), V3(0.0, 0.03, 0.05), V3(0, 1, 0), 1))
    finish("Bones_Reach", [m for m in ms], 690, floor=0.0, blood=[(W + hd * 0.05, 0.03, 2.0)], seed=61, origin=V3(0, 0, 0))


def ribcage():
    tm = build(("thoraxR", 71), lambda: thorax_part(71, broken=((3, 1), (5, 1), (7, -1), (2, -1)), collapse=0.15, shoulders=False), cls=0)
    vl = build(("vert", "l"), lambda: vertebra_part("l"))
    ms = [tm]
    for k in range(3):
        ms.append(vl.xf(np.eye(3), V3(0, -0.02 - 0.034 * k, 0.0)))
    # lying on its side, tipped
    R = rot((0, 1, 0), 0.5) @ rot((0, 0, 1), 1.35) @ rot((1, 0, 0), 0.2)
    ms = [m.xf(R, np.zeros(3)) for m in ms]
    ms = recentre(ms)
    ms = [m.xf(np.eye(3), V3(0, -0.012, 0)) for m in ms]
    finish("Bones_Ribcage", ms, 890, floor=0.0, blood=[(V3(0.0, 0.2, 0.05), 0.07, 1.5)], seed=71)


def scatter():
    rng = np.random.default_rng(SEED + 81)
    ms = []
    pel = build(("pelvis", 0), lambda: pelvis_part(0))
    ms.append(pel.xf(rot((0, 1, 0), 0.7) @ rot((1, 0, 0), -1.25), V3(0.15, 0.06, -0.12)))
    fa = build(("femb", 0.48, 81), lambda: femur_part(81, broken=0.48, keep="top"))
    fb = build(("femb_lo", 81), lambda: femur_part(82, broken=0.48, keep="bottom"))
    ms.append(place_long(fa, V3(-0.4, 0.03, -0.25), V3(0.0, 0.03, 0.05), V3(0, 1, 0), 1))
    ms.append(place_long(fb, V3(0.07, 0.03, 0.06), V3(0.07, 0.03, 0.06) + nrm(V3(0.35, 0, 1)) * L_FEM, V3(0.3, 1, 0), 1))
    hum = build(("hum", 0), lambda: humerus_part(0))
    ms.append(place_long(hum, V3(-0.35, 0.025, 0.25), V3(-0.05, 0.025, 0.4), V3(0, 1, 0.2), -1))
    vt = build(("vert", "t"), lambda: vertebra_part("t"))
    vl = build(("vert", "l"), lambda: vertebra_part("l"))
    for k in range(4):
        R = rot((0, 1, 0), rng.random() * 6) @ rot((1, 0, 0), (rng.random() - 0.5) * 0.6)
        ms.append((vt if k % 2 else vl).xf(R, V3(-0.15 + 0.1 * k + 0.05 * rng.random(), 0.016, -0.05 + 0.15 * rng.random() - 0.1 * k)))
    jw = build(("jaw", 81), lambda: mandible_part(81, missing=(1, 2, 9)))
    ms.append(jw.xf(rot((0, 1, 0), 2.2), V3(-0.3, 0.115, -0.05) * V3(1, 0, 1) + V3(0, 0.108, 0)))
    finish("Bones_Scatter", ms, 890, floor=0.0, blood=[(V3(0.07, 0.04, 0.06), 0.05, 1.0)], seed=81, origin=base_origin(ms, 0.0))


def skull_pile():
    rng = np.random.default_rng(SEED + 91)
    ms = []
    sks = []
    for k in range(3):
        m = build(("skullP", k), lambda k=k: skull_part(200 + k, lowres=True, missing=(k, k + 5)), 0)
        V2, F2, at = decimate(m.V, m.F, {"det": m.det}, 172)
        sks.append(Mesh(V2, F2, 0, at["det"]))
    jm = build(("jawP", 0), lambda: mandible_part(300, lowres=True))
    V2, F2, at = decimate(jm.V, jm.F, {"det": jm.det}, 44)
    jws = Mesh(V2, F2, 0, at["det"])
    core = Part(h=0.008)
    core.add(p_ellip((0, 0.0, 0), (0.48, 0.36, 0.42)))
    core.cut(lambda P: -P[:, 1] - 0.0)
    ms.append(build(("pilecore", 1), lambda: core, cls=5))
    rings = [(7, 0.44, 0.075, 0.0), (4, 0.25, 0.28, 0.4), (2, 0.11, 0.45, 1.1), (1, 0.0, 0.6, 0.0)]
    k = 0
    for cnt, r, y, a0 in rings:
        for j in range(cnt):
            a = a0 + 2 * math.pi * j / cnt + 0.25 * rng.normal()
            x, z = r * math.cos(a), r * math.sin(a)
            out = nrm(V3(x, 0.0, z) + rng.normal(size=3) * 0.35) if r > 0 else nrm(V3(0.3, -0.3, 1))
            up = nrm(V3(0, 1, 0) + rng.normal(size=3) * 0.35)
            R = frame(up, out)
            c = V3(x, y, z)
            ms.append(keepm(sks[k % 3].xf(R, c)))
            if k % 4 == 1:
                ms.append(keepm(jws.xf(R @ rot((1, 0, 0), 0.3), c + R @ V3(0, 0.01, 0.0))))
            k += 1
    hm = lambda x, z: 0.36 * max(0.0, 1 - (x * x / 0.48 ** 2 + z * z / 0.42 ** 2)) ** 0.5 + 0.03
    fem = build(("fem", 0), lambda: femur_part(0))
    hum = build(("hum", 0), lambda: humerus_part(0))
    for k in range(7):
        a = rng.random() * 2 * math.pi
        r = 0.15 + 0.35 * rng.random()
        x, z = r * math.cos(a), r * math.sin(a)
        A = V3(x, hm(x, z) + 0.01, z)
        d = nrm(V3(-math.sin(a) + rng.normal() * 0.4, 0, math.cos(a) + rng.normal() * 0.4))
        B = A + d * 0.42
        B[1] = max(0.03, hm(B[0], B[2]) + 0.01)
        ms.append(place_long(fem if k % 2 else hum, A, B, V3(0, 1, 0), 1 if k % 3 else -1))
    finish("Bones_SkullPile", ms, 2980, floor=0.0, blood=[(V3(0.1, 0.7, 0.05), 0.08, 2.0)], seed=91, origin=V3(0, 0, 0))


# =====================================================================================================================
# Blender objects, export, preview
# =====================================================================================================================
def make_material():
    mat = bpy.data.materials.new("BonesMat")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def make_objects(mat):
    objs = []
    for name, d in KIT.items():
        V, F, C = d["V"], d["F"], d["C"]
        Vb = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)        # Y-up kit -> Blender Z-up (the exporter's +Y up undoes it)
        me = np_to_mesh(name, Vb, F)
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        lin = srgb_to_lin(C)
        rgba = np.concatenate([lin, np.ones((len(C), 1))], 1).astype(np.float32)
        ca.data.foreach_set("color", rgba.ravel())
        me.color_attributes.active_color = ca
        try:
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except Exception:
            pass
        me.validate(clean_customdata=False)
        me.shade_smooth()
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        objs.append(ob)
    return objs


def export_glb(objs, path):
    for o in bpy.data.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
                              export_texcoords=False, export_normals=True, export_tangents=False, export_materials="EXPORT",
                              export_skins=False, export_animations=False, export_morph=False, export_extras=False,
                              export_cameras=False, export_lights=False, export_vertex_color="ACTIVE")
    log("exported", path, f"{os.path.getsize(path) / 1e6:.2f} MB")


def render_sheet(objs):
    from PIL import Image, ImageDraw
    scene = bpy.context.scene
    T = args.tile
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = T
    scene.render.resolution_percentage = 100
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    world = bpy.data.worlds.new("W")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.006, 0.007, 0.009, 1)
    floor_me = bpy.data.meshes.new("Floor")
    floor_me.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new("Floor", floor_me)
    scene.collection.objects.link(floor)
    fm = bpy.data.materials.new("FloorMat")
    fm.use_nodes = True
    fb = fm.node_tree.nodes.get("Principled BSDF")
    nt = fm.node_tree
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.016, 0.015, 0.014, 1)
    ramp.color_ramp.elements[1].color = (0.05, 0.045, 0.04, 1)
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], fb.inputs["Base Color"])
    fb.inputs["Roughness"].default_value = 0.85
    floor_me.materials.append(fm)
    wall_me = bpy.data.meshes.new("Wall")
    wall_me.from_pydata([(-3, 0, 0), (3, 0, 0), (3, 0, 4), (-3, 0, 4)], [], [(0, 1, 2, 3)])
    wall = bpy.data.objects.new("Wall", wall_me)
    scene.collection.objects.link(wall)
    wall_me.materials.append(fm)
    lamp = bpy.data.lights.new("lantern", "POINT")
    lamp.color = (1.0, 0.8, 0.6)
    lamp.shadow_soft_size = 0.05
    lo = bpy.data.objects.new("lantern", lamp)
    scene.collection.objects.link(lo)
    rim = bpy.data.lights.new("rim", "AREA")
    rim.color = (0.55, 0.65, 0.85)
    rim.size = 1.5
    ro = bpy.data.objects.new("rim", rim)
    scene.collection.objects.link(ro)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 40
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    tiles = []
    views = {"Bones_Skull": (0.6, 0.35, 1.0), "Bones_SkullJawless": (-0.7, 0.4, 1.0), "Bones_Hanging": (0.75, -0.05, 1.0),
             "Bones_SittingWall": (0.45, 0.3, 1.0), "Bones_Reach": (0.6, 0.25, 1.0), "Bones_Crawler": (0.85, 0.55, 0.9),
             "Bones_LyingA": (1.0, 0.85, 0.35), "Bones_LyingB": (0.9, 0.8, -0.6)}
    shots = [(o.name, o.name) for o in objs]
    shots.append(("Bones_Skull", "Bones_Skull (close)"))
    for name, label in shots:
        ob = bpy.data.objects[name]
        for o in objs:
            o.hide_render = o.name != name
        d = KIT[name]
        V = d["V"]
        lo_, hi_ = V.min(0), V.max(0)
        c = (lo_ + hi_) / 2
        rad = np.linalg.norm(hi_ - lo_) / 2
        hang = name == "Bones_Hanging"
        if hang:
            ob.location = (0, 0, 3.8)
            c = c + V3(0, 3.8, 0)
            lo_ = lo_ + V3(0, 3.8, 0)
        else:
            ob.location = (0, 0, 0)
        wall.hide_render = name != "Bones_SittingWall"
        floor.hide_render = False
        vd = nrm(V3(views.get(name, (0.7, 0.55, 1.0))))
        close = "close" in label
        dist = rad / 0.42 * (0.85 if close else 1.0) + 0.15
        if close:
            vd = nrm(V3(0.25, 0.1, 1.0))
        camp = c + vd * dist
        camp[1] = max(camp[1], 0.08)
        cb = Vector((camp[0], -camp[2], camp[1]))
        cc = Vector((c[0], -c[2], c[1]))
        cam.location = cb
        cam.rotation_euler = (cc - cb).to_track_quat("-Z", "Y").to_euler()
        side = nrm(np.cross(vd, V3(0, 1, 0)))
        lp = c + vd * dist * 0.55 + side * dist * 0.45 + V3(0, 0.35 * dist + 0.3, 0)
        lo.location = (lp[0], -lp[2], lp[1])
        lamp.energy = 30.0 * (dist ** 2)
        rp = c + V3(-vd[0] * dist, rad + 1.0, -vd[2] * dist)
        ro.location = (rp[0], -rp[2], rp[1])
        ro.rotation_euler = (Vector((c[0], -c[2], c[1])) - Vector((rp[0], -rp[2], rp[1]))).to_track_quat("-Z", "Y").to_euler()
        rim.energy = 10.0 * dist ** 2
        fp = os.path.join(RENDER_DIR, f"bones_{label.replace(' ', '_').replace('(', '').replace(')', '')}.png")
        scene.render.filepath = fp
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        log(f"render {label} {time.time() - t0:.0f}s")
        tiles.append((fp, f"{label}  {REPORT[name]['tris']} tris"))
        ob.location = (0, 0, 0)
    for o in objs:
        o.hide_render = False
    cols = 4
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * T, rows * (T + 24)), (8, 8, 10))
    dr = ImageDraw.Draw(sheet)
    for i, (fp, label) in enumerate(tiles):
        im = Image.open(fp).convert("RGB")
        x, y = (i % cols) * T, (i // cols) * (T + 24)
        sheet.paste(im, (x, y))
        dr.text((x + 8, y + T + 5), label, fill=(210, 200, 185))
    out = os.path.join(RENDER_DIR, "bones_sheet.png")
    sheet.save(out)
    log("sheet", out)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    builders = [("Bones_Skull", lambda: mk_skull("Bones_Skull", 1, jaw=True, hole=True)),
                ("Bones_SkullJawless", lambda: mk_skull("Bones_SkullJawless", 2, jaw=False)),
                ("Bones_LyingA", lying_a), ("Bones_LyingB", lying_b), ("Bones_SittingWall", sitting_wall),
                ("Bones_Hanging", hanging), ("Bones_Reach", reach), ("Bones_Ribcage", ribcage), ("Bones_Scatter", scatter),
                ("Bones_SkullPile", skull_pile), ("Bones_Crawler", crawler)]
    want = set(s for s in args.only.split(",") if s)
    for name, fn in builders:
        if want and name not in want:
            continue
        fn()
    mat = make_material()
    objs = make_objects(mat)
    export_glb(objs, os.path.join(args.out, "bones.glb"))
    with open(os.path.join(RENDER_DIR, "bones_report.json"), "w") as f:
        json.dump(REPORT, f, indent=1)
    if args.render:
        render_sheet(objs)
    log("done")


main()
