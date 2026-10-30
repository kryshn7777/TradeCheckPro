"""ABYSSAL TETHER 3D — THE DRESSER v2: procedural builder of the mason in the hooded apron (Blender 5.x / the `bpy` module).

"DRESS THE OLD STONE WITH CARE. IT WAS SOMEONE." A 3.2 m Lanternwright mason that stands sideways on the shaft walls and measures
the whole: a deep peaked hood with a rolled lip over a SPLIT SAINT MASK (two halves of pale porcelain-stone on a vertical seam, one
serene, one subtly wrong: a heavier lid, a hairline crack from the eye to the cheek, a mouth corner pulled down, a nail missing), the
mouth sewn shut with cord, closed lids with slit eyes that glow cold, grime tears; a wet wool robe, a stitched leather apron with a
pocket and a mason's belt (two chisels in loops, a mallet, a plumb bob on its cord), two long segmented chisel arms of forged iron
(stepped bars, rivetted rings, ball joints) out of ragged sleeves, two small grey hands wrapped in cloth strips holding the measuring
line's spool, long bare feet.

Built from code (deterministic, seed 7171, no hand-sculpting). Every part is a parametric (u, v) patch with its own rectangle in ONE
texture atlas, so the three levels of detail are the same surfaces sampled at three densities and share the atlas:
  LOW   LOD0 (~20-24 k triangles), LOD1 (~7-8 k), LOD2 (~2-3 k, still a face: the mask's brow, nose, seam and slits), skinned.
  HIGH  the same patches sampled at about one vertex per texel of the 2048 bake (~7 M triangles) + 'sculpt' layers in numpy (the
        mask's slits, lid creases, stitches, crack, chisel dents, chips and nails; cloth wrinkles, seams and fraying; leather grain,
        stitch rows and scuffs; forging steps, hammer marks and rivets; finger wraps).
  BAKE  Cycles: tangent normal + fine AO per part (HIGH -> LOD0) and a global AO of LOD0 (hood interior, under the arms); albedo,
        roughness and the glow mask are painted analytically in UV space from the same feature functions (no bake noise).
  MAPS  albedo (sRGB), normal (OpenGL), ORM (R = AO, G = roughness, B = the eye-slit glow mask; the runtime forces metalness 0).
  FX    COLOR_0 (FLOAT): R = pale self-light (the mask), G = 0 (spare), B = the hood-lip rim light mask.

THE SKELETON IS THE CONTRACT: the bone table is parsed from public/abyssal-tether-3d/src/render/dresserView.js (BONES: names,
parents, bind positions). Bones are exported vertical with roll 0, so every glTF rest rotation is the identity and every rest
translation is the bind offset from its parent: render/dresserView.js binds the GLB geometry to its own procedural skeleton and its
`_pose` drives it unchanged (breathing, the wall walk, measure / cut / spoiled / stagger, the head on you, the skirt springs).
Weights: rigid iron with ball joints centred on the pivots (no candy-wrapper at the shoulders, elbows or wrists: the joint balls
rotate into themselves), the robe on hips / spine / chest and the eight skirt bones, the hood blended head -> neck -> chest over
30 cm, the sleeves chest -> upper arm, the small arms blended at their elbows.

Frame: the creature frame of dresserView.js (+Y up, +Z its facing, +X its left), Blender (x, -z, y). Outputs: <out>/dresser.glb
(raw; then compress_glbs.mjs --only dresser and compress_glb_textures.mjs --only dresser), previews/dresser_sheet.png (--render),
a JSON report next to the renders.

Run (always under the shared lock):
  flock /tmp/at3d-blender.lock $PY tools/abyssal-tether-3d/build_dresser.py --out <dir> --renders <dir> [--render] [--bake 2048]
        [--stage shape|paint|bake|all] [--hi 1.0] [--cache <dir>] [--blend <file>]
"""

import argparse
import json
import math
import os
import re
import sys
import time

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.getcwd(), "dresser_out"))
ap.add_argument("--renders", default="")
ap.add_argument("--render", action="store_true")
ap.add_argument("--samples", type=int, default=40)
ap.add_argument("--tile", type=int, default=520)
ap.add_argument("--bake", type=int, default=2048)
ap.add_argument("--bake-samples", type=int, default=24)
ap.add_argument("--hi", type=float, default=1.0, help="HIGH density (vertices per texel of the bake)")
ap.add_argument("--stage", default="all", help="shape = clay renders; paint = the analytic maps only; bake = + bake; all")
ap.add_argument("--cache", default="")
ap.add_argument("--only", default="", help="preview tiles to render (comma list)")
ap.add_argument("--blend", default="")
args = ap.parse_args(argv)
args.out = os.path.abspath(args.out)
os.makedirs(args.out, exist_ok=True)
RENDER_DIR = os.path.abspath(args.renders or args.out)
os.makedirs(RENDER_DIR, exist_ok=True)
CACHE_DIR = os.path.abspath(args.cache or os.path.join(RENDER_DIR, "_dr_cache"))
os.makedirs(CACHE_DIR, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
VIEW_JS = os.path.join(REPO, "public", "abyssal-tether-3d", "src", "render", "dresserView.js")
TEX_DIR = os.path.join(REPO, "public", "abyssal-tether-3d", "assets", "textures")
T0 = time.time()
SEED = 7171
TAU = 2 * math.pi


def log(*a):
    print(f"[dresser {time.time() - T0:7.1f}s]", *a, flush=True)


# =====================================================================================================================
# THE SKELETON (parsed from render/dresserView.js: the contract)
# =====================================================================================================================
def parse_bones():
    src = open(VIEW_JS, encoding="utf8").read()
    blk = src[src.index("export const BONES = ["):]
    blk = blk[:blk.index("];")]
    out = []
    for m in re.finditer(r"\['(\w+)',\s*(-?\d+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\]", blk):
        out.append((m.group(1), int(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5))))
    assert len(out) >= 30 and out[0][0] == "root", "dresserView.js BONES not found"
    return out


BONES = parse_bones()
NB = len(BONES)
B = {b[0]: i for i, b in enumerate(BONES)}
BPOS = {b[0]: np.array(b[2:5]) for b in BONES}


# =====================================================================================================================
# numpy helpers: smoothstep, gaussians, value noise (periodic variants), segment distances
# =====================================================================================================================
def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def g1(x, c, s):
    return np.exp(-(((x - c) / s) ** 2))


def g2(x, y, cx, cy, sx, sy):
    return np.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2))


def lerp(a, b, t):
    return a + (b - a) * t


M32 = 0xFFFFFFFF


def ihash(a):
    a = a & M32
    a = (a ^ 61) ^ (a >> 16)
    a = (a + (a << 3)) & M32
    a = a ^ (a >> 4)
    a = (a * 0x27D4EB2D) & M32
    a = a ^ (a >> 15)
    return a


def h3(ix, iy, iz, seed):
    return ihash((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)) / 4294967296.0


def vnoise3(x, y, z, freq, seed):
    """Value noise in [-1, 1] at (x, y, z) * freq."""
    X = np.asarray(x) * freq
    Y = np.asarray(y) * freq
    Z = np.asarray(z) * freq
    ix = np.floor(X).astype(np.int64)
    iy = np.floor(Y).astype(np.int64)
    iz = np.floor(Z).astype(np.int64)
    fx, fy, fz = X - ix, Y - iy, Z - iz
    ux, uy, uz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)

    def c(dx, dy, dz):
        return h3(ix + dx, iy + dy, iz + dz, seed)
    a = lerp(c(0, 0, 0), c(1, 0, 0), ux)
    b = lerp(c(0, 1, 0), c(1, 1, 0), ux)
    cc = lerp(c(0, 0, 1), c(1, 0, 1), ux)
    d = lerp(c(0, 1, 1), c(1, 1, 1), ux)
    return lerp(lerp(a, b, uy), lerp(cc, d, uy), uz) * 2 - 1


def fbm3(x, y, z, freq, seed, octaves=4, gain=0.5):
    s = 0.0
    a = 1.0
    tot = 0.0
    for o in range(octaves):
        s = s + a * vnoise3(x, y, z, freq * (2 ** o), seed + o * 17)
        tot += a
        a *= gain
    return s / tot


def pnoise(th, y, freq, seed, R=1.0):
    """Noise periodic in the angle th (sampled on a circle of radius R)."""
    return vnoise3(np.cos(th) * R, np.sin(th) * R, y, freq, seed)


def pfbm(th, y, freq, seed, octaves=3, R=1.0):
    return fbm3(np.cos(th) * R, np.sin(th) * R, y, freq, seed, octaves)


def voronoi_edge2(X, Y, cell, seed):
    """Approximate distance (m) to the nearest Voronoi cell edge of a jittered grid of `cell` size."""
    gx = np.asarray(X) / cell
    gy = np.asarray(Y) / cell
    ix = np.floor(gx).astype(np.int64)
    iy = np.floor(gy).astype(np.int64)
    d1 = np.full(gx.shape, 9.0)
    d2 = np.full(gx.shape, 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cx, cy = ix + dx, iy + dy
            px = cx + 0.1 + 0.8 * h3(cx, cy, 0, seed)
            py = cy + 0.1 + 0.8 * h3(cx, cy, 1, seed)
            d = np.sqrt((gx - px) ** 2 + (gy - py) ** 2)
            d2 = np.where(d < d1, d1, np.minimum(d2, d))
            d1 = np.minimum(d1, d)
    return (d2 - d1) * 0.5 * cell


def seg_dist2(X, Y, a, b):
    """Distance from (X, Y) to the 2D segment a-b, and the parameter t along it."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy + 1e-12
    t = np.clip(((X - ax) * dx + (Y - ay) * dy) / L2, 0, 1)
    px, py = ax + dx * t, ay + dy * t
    return np.sqrt((X - px) ** 2 + (Y - py) ** 2), t


def poly_dist2(X, Y, pts):
    d = np.full(np.shape(X), 1e9)
    side = np.zeros(np.shape(X))
    for i in range(len(pts) - 1):
        di, _ = seg_dist2(X, Y, pts[i], pts[i + 1])
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        cr = (bx - ax) * (Y - ay) - (by - ay) * (X - ax)
        m = di < d
        d = np.where(m, di, d)
        side = np.where(m, np.sign(cr), side)
    return d, side


def stack3(x, y, z):
    return np.stack(np.broadcast_arrays(x, y, z), -1)


def rnd(i):
    """Deterministic 0..1 from an int."""
    return float(ihash(np.int64(i * 7919 + SEED)) / 4294967296.0)


def interp(y, table):
    """Piecewise-linear profile; table = [(x, value), ...] in any order."""
    t = sorted(table)
    return np.interp(y, [a for a, _ in t], [b for _, b in t])


# =====================================================================================================================
# CURVES and generic surfaces (vectorised fn(U, V) -> P[..., 3] in the creature frame)
# =====================================================================================================================
class Curve:
    """A Catmull-Rom curve through `pts`, resampled by arc length, with parallel-transport frames (N, Bn)."""

    def __init__(self, pts, n=600, up=(0.0, 0.0, 1.0)):
        P = np.array(pts, float)
        Q = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
        out = []
        for i in range(1, len(Q) - 2):
            p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
            for t in np.linspace(0, 1, 40, endpoint=False):
                t2, t3 = t * t, t * t * t
                out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
        out.append(P[-1])
        C = np.array(out)
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
        self.length = s[-1]
        u = np.linspace(0, s[-1], n)
        C = np.stack([np.interp(u, s, C[:, k]) for k in range(3)], -1)
        T = np.gradient(C, axis=0)
        T /= np.linalg.norm(T, axis=1, keepdims=True)
        up = np.array(up, float)
        N = np.zeros_like(C)
        n0 = up - T[0] * np.dot(up, T[0])
        if np.linalg.norm(n0) < 1e-6:
            n0 = np.array([1.0, 0, 0]) - T[0] * T[0][0]
        N[0] = n0 / np.linalg.norm(n0)
        for i in range(1, n):
            v = N[i - 1] - T[i] * np.dot(N[i - 1], T[i])
            N[i] = v / np.linalg.norm(v)
        self.C, self.T, self.N = C, T, N
        self.Bn = np.cross(T, N)
        self.n = n

    def at(self, V):
        x = np.clip(V, 0, 1) * (self.n - 1)
        i0 = np.clip(np.floor(x).astype(int), 0, self.n - 2)
        f = (x - i0)[..., None]
        C = self.C[i0] * (1 - f) + self.C[i0 + 1] * f
        N = self.N[i0] * (1 - f) + self.N[i0 + 1] * f
        Bn = self.Bn[i0] * (1 - f) + self.Bn[i0 + 1] * f
        return C, N, Bn


def sweep_fn(curve, ra, rb=None, shape=None):
    """A tube along `curve`: ra(V, th) along the curve normal, rb along the binormal; shape(th) an optional section factor."""
    def fn(U, V):
        C, N, Bn = curve.at(V)
        th = U * TAU
        a = ra(V, th)
        b = rb(V, th) if rb is not None else a
        if shape is not None:
            k = shape(th)
            a = a * k
            b = b * k
        return C + N * (np.cos(th) * a)[..., None] + Bn * (np.sin(th) * b)[..., None]
    return fn


def ellipsoid_fn(c, rx, ry, rz, bump=None):
    c = np.array(c, float)

    def fn(U, V):
        th = U * TAU
        ph = V * np.pi
        s = np.sin(ph)
        k = 1.0 if bump is None else bump(th, ph)
        return c + stack3(s * np.sin(th) * rx * k, -np.cos(ph) * ry * k, s * np.cos(th) * rz * k)
    return fn


def cap_r(V, r, e0=0.06, e1=0.06):
    """Round both tube ends to a point (closed tubes)."""
    a = np.sqrt(np.clip(1 - ((e0 - np.clip(V, 0, e0)) / e0) ** 2, 0, 1)) if e0 > 0 else 1.0
    b = np.sqrt(np.clip(1 - ((np.clip(V, 1 - e1, 1) - (1 - e1)) / e1) ** 2, 0, 1)) if e1 > 0 else 1.0
    return r * a * b


def octagon(th, round_=0.35):
    """Forged bar section: an octagon with softened corners (radius factor)."""
    k = np.cos(np.pi / 8) / np.cos(np.mod(th + np.pi / 8, np.pi / 4) - np.pi / 8)
    return k * (1 - round_) + round_ * 0.96


# =====================================================================================================================
# THE PARTS
# =====================================================================================================================
class Part:
    def __init__(self, name, fn, res, cls, skin, uvw=1.0, relief=None, paint=None, fx=None, cage=0.012, mirror_of=None, orient=None):
        self.name = name
        self.fn = fn
        self.res = res  # {lod: (nu, nv) or None}
        self.cls = cls
        self.skin = skin  # P -> W (n, NB) unnormalised; or a bone name (rigid)
        self.uvw = uvw
        self.relief = relief  # (U, V, P, N) -> (disp m, masks dict)
        self.paint = paint  # (U, V, P, N, masks) -> dict(alb (..,3) linear, rough, glow)
        self.fx = fx  # (U, V, P) -> (pale, glowV, rim)
        self.cage = cage
        self.mirror_of = mirror_of
        self.orient = orient  # None = auto (centroid), +1 / -1 forced
        self.rect = None
        self.sign = 1.0


def mirror(part, name, swap):
    """The other side: x -> -x, same atlas rect, the skin bones swapped L <-> R."""
    fn0 = part.fn

    def fn(U, V):
        P = fn0(U, V)
        return P * np.array([-1.0, 1.0, 1.0])
    if isinstance(part.skin, str):
        skin = swap(part.skin)
    else:
        sk0 = part.skin

        def skin(P, U, V):
            W = sk0(P * np.array([-1.0, 1.0, 1.0]), U, V)
            W2 = np.zeros_like(W)
            for i, b in enumerate(BONES):
                W2[:, B[swap(b[0])]] += W[:, i]
            return W2
    m = Part(name, fn, part.res, part.cls, skin, part.uvw, part.relief, part.paint, part.fx, part.cage, mirror_of=part.name, orient=part.orient)
    return m


def swapLR(n):
    if n.endswith("L"):
        return n[:-1] + "R"
    if n.endswith("R"):
        return n[:-1] + "L"
    for a, b in (("skirtL", "skirtR"), ("skirtR", "skirtL")):
        if n.startswith(a):
            return b + n[len(a):]
    return n


# ---- skin helpers ---------------------------------------------------------------------------------------------------
def Wz(n):
    return np.zeros((n, NB))


def skirt_weights(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    W = Wz(len(P))
    t = np.mod(np.arctan2(x, z), TAU)
    seg = np.floor(t / (np.pi / 2)).astype(int) % 4
    f = (t - seg * (np.pi / 2)) / (np.pi / 2)
    cols = [("skirtF1", "skirtF2"), ("skirtL1", "skirtL2"), ("skirtB1", "skirtB2"), ("skirtR1", "skirtR2")]
    v2 = sstep(1.05, 0.65, y)
    hw = sstep(1.3, 1.56, y)
    W[:, B["hips"]] += hw
    for c, (b1, b2) in enumerate(cols):
        wc = np.where(seg == c, 1 - f, 0) + np.where((seg + 1) % 4 == c, f, 0)
        W[:, B[b1]] += wc * (1 - hw) * (1 - v2)
        W[:, B[b2]] += wc * (1 - hw) * v2
    return W


def torso_weights(P, U=None, V=None):
    x, y = P[:, 0], P[:, 1]
    W = Wz(len(P))
    low = y < 1.56
    Ws = skirt_weights(P)
    t1 = sstep(1.56, 1.9, y)
    t2 = sstep(1.9, 2.3, y)
    W[:, B["hips"]] += np.where(low, 0, np.where(y < 1.9, 1 - t1, 0))
    W[:, B["spine"]] += np.where(low, 0, np.where(y < 1.9, t1, np.where(y < 2.3, 1 - t2, 0)))
    W[:, B["chest"]] += np.where(low, 0, np.where(y < 1.9, 0, np.where(y < 2.3, t2, 1)))
    W[low] = Ws[low]
    k = 0.35 * sstep(0.16, 0.3, np.abs(x)) * sstep(2.38, 2.52, y)
    W[:, B["upperArmL"]] += np.where(x > 0, k, 0)
    W[:, B["upperArmR"]] += np.where(x < 0, k, 0)
    W[:, B["neck"]] += sstep(2.6, 2.66, y) * 0.6
    return W


def hood_weights(P, U=None, V=None):
    x, y = P[:, 0], P[:, 1]
    W = Wz(len(P))
    h = sstep(2.52, 2.82, y)
    W[:, B["head"]] += h
    W[:, B["neck"]] += (1 - h) * 0.55 * sstep(2.36, 2.62, y)
    W[:, B["chest"]] += (1 - h) * (1 - 0.55 * sstep(2.36, 2.62, y))
    sh = sstep(0.16, 0.27, np.abs(x)) * sstep(2.62, 2.46, y) * 0.3
    W[:, B["upperArmL"]] += np.where(x > 0, sh, 0)
    W[:, B["upperArmR"]] += np.where(x < 0, sh, 0)
    return W


def rigid(bone):
    return bone


def blend_y(b_hi, b_lo, y0, y1):
    """Bone b_hi above y1, b_lo below y0, smooth in between."""
    def sk(P, U=None, V=None):
        W = Wz(len(P))
        t = sstep(y0, y1, P[:, 1])
        W[:, B[b_hi]] += t
        W[:, B[b_lo]] += 1 - t
        return W
    return sk


def mixw(*pairs):
    def sk(P, U=None, V=None):
        W = Wz(len(P))
        for b, w in pairs:
            W[:, B[b]] += w
        return W
    return sk


# ---- colours (linear) -----------------------------------------------------------------------------------------------
WOOL = np.array([0.050, 0.046, 0.043])
WOOL_IN = np.array([0.012, 0.011, 0.011])
CHALK = np.array([0.43, 0.42, 0.39])
LEATHER = np.array([0.072, 0.040, 0.024])
IRON = np.array([0.052, 0.052, 0.058])
IRON_EDGE = np.array([0.20, 0.20, 0.21])
RUST = np.array([0.11, 0.050, 0.026])
SKIN = np.array([0.15, 0.145, 0.14])
LINEN = np.array([0.22, 0.20, 0.17])
WOOD = np.array([0.085, 0.055, 0.035])
IVORY = np.array([0.56, 0.52, 0.445])
GRIME = np.array([0.075, 0.064, 0.055])
BRASS = np.array([0.16, 0.11, 0.045])


def cl(a):
    return np.clip(a, 0, 1)


def mix3(a, b, t):
    t = np.asarray(t)[..., None]
    return a * (1 - t) + b * t


# =====================================================================================================================
# THE MASK (the face): two halves on a vertical seam. Local metric coordinates: X >= 0 from the centre line, Y up from the
# mask centre MC. side +1 = its LEFT half (+X): the WRONG one (dropped, turned, heavy lid, crack, the corner pulled down, a nail
# missing); side -1 = the serene one.
# =====================================================================================================================
MC = np.array([0.0, 2.93, 0.085])
HH = 0.205
HW = 0.112
SEAM = 0.0028
PLACE = {1: (-0.05, -0.018, 0.008), -1: (0.015, 0.004, 0.0)}  # (roll, dy, dz) of each half


def mask_hw(vv):
    a = np.power(np.clip(1 - ((vv - 0.15) / 0.85) ** 2, 0, 1), 0.42)
    b = 1 - 0.58 * np.power(np.clip((0.15 - vv) / 1.15, 0, None), 1.6)
    return HW * np.where(vv > 0.15, a, b)


def eye_of(side):
    w = side > 0
    return dict(x=0.049 if w else 0.047, y=0.027 if w else 0.032, x0=0.025, x1=0.072 if w else 0.071, drop=0.0095 if w else 0.0062,
                lid=1.3 if w else 1.0, ws=0.0022 if w else 0.0011)


def slit_y(X, e):
    t = np.clip((X - e["x0"]) / (e["x1"] - e["x0"]), 0, 1)
    return e["y"] + 0.001 - e["drop"] * t ** 1.7 + 0.0022 * np.sin(np.pi * t), t


def mouth_y(X, side):
    k = np.clip(X / 0.046, 0, 1.3)
    return np.where(side > 0, -0.118 - 0.0065 * k ** 2.2, -0.118 + 0.0042 * k ** 2)


def face_macro(X, Y, side):
    """The carved forms (part of the LOW geometry): dome + brow, sockets, lids, nose, cheeks, lips, chin."""
    w = side > 0
    e = eye_of(side)
    h = 0.074 * np.power(np.clip(1 - (X / 0.118) ** 2, 0, 1), 0.6) * (1 - 0.3 * (Y / HH) ** 2)
    h = h + 0.006 * g2(X, Y, 0.0, 0.13, 0.08, 0.06)  # forehead
    browY = 0.066 - 0.012 * ((X - 0.045) / 0.05) ** 2 - (0.004 if w else 0.0)
    brow = (0.018 if w else 0.0155) * np.where(Y < browY, g1(Y - browY, 0, 0.009), g1(Y - browY, 0, 0.016)) * sstep(0.112, 0.07, X)
    h = h + brow  # the brow ridge: a hard underside over the socket, soft into the forehead
    h = h + 0.007 * g2(X, Y, 0.0, 0.058, 0.014, 0.016)  # glabella
    h = h - 0.028 * g2(X, Y, e["x"], e["y"] + 0.004, 0.035, 0.029)  # socket
    h = h + 0.0145 * e["lid"] * g2(X, Y, e["x"], e["y"] + 0.002 - (0.003 if w else 0), 0.026, 0.0165 * (1.15 if w else 1))  # the lids
    if w:
        h = h + 0.004 * g2(X, Y, 0.05, 0.003, 0.02, 0.008)  # a swollen under-eye
    # nose (the seam runs down its ridge: each half carries half of it)
    t = np.clip((0.064 - Y) / 0.128, 0, 1)
    proj = (0.009 + 0.024 * t ** 0.9 + 0.012 * g1(t, 1.0, 0.13)) * sstep(-0.086, -0.064, Y) * sstep(0.08, 0.058, Y)
    width = 0.0095 + 0.006 * t + 0.007 * g1(t, 1.0, 0.16)
    h = h + proj * np.power(np.clip(1 - (X / width) ** 2, 0, 1), 1.5)
    h = h + 0.0095 * g2(X, Y, 0.021, -0.066, 0.009, 0.008)  # the ala
    h = h - 0.005 * g2(X, Y, 0.009, -0.075, 0.004, 0.003)  # nostril
    h = h - 0.004 * g2(X, Y, 0.03, -0.062, 0.006, 0.012)  # the alar crease
    h = h + 0.013 * g2(X, Y, 0.075, -0.014, 0.028, 0.02)  # cheekbone
    h = h - 0.019 * g2(X, Y, 0.072, -0.09, 0.027, 0.042)  # hollow cheek
    h = h + 0.006 * g2(X, Y, 0.095, -0.16, 0.02, 0.03)  # the jaw corner
    d, _ = seg_dist2(X, Y, (0.027, -0.069), (0.05, -0.122))
    h = h - 0.003 * g1(d, 0, 0.004)  # nasolabial
    Ym = mouth_y(X, side)
    lipx = sstep(0.054, 0.036, X)
    h = h + 0.006 * g1(Y, Ym + 0.0085, 0.0065) * lipx + 0.0075 * g1(Y, Ym - 0.0102, 0.008) * lipx
    h = h - 0.0025 * g1(Y, Ym, 0.002) * lipx
    h = h + 0.012 * g2(X, Y, 0.0, -0.175, 0.04, 0.026)  # chin
    h = h - 0.003 * g1(Y, -0.148, 0.007) * sstep(0.04, 0.02, X)
    h = h - 0.004 * g2(X, Y, 0.1, 0.07, 0.02, 0.03)  # temple
    return h


def stitch_list(side):
    out = []
    for k in range(6):
        xk = 0.005 + 0.0078 * k + (0.0014 * (rnd(k + 40 * side) - 0.5) if side > 0 else 0)
        sl = (0.0016 if side > 0 else -0.0012) + 0.0012 * (rnd(k * 3 + side) - 0.5)
        out.append((xk, sl))
    return out


CRACK = [(0.072, 0.019), (0.077, 0.005), (0.081, -0.012), (0.0835, -0.04), (0.079, -0.07), (0.086, -0.1), (0.094, -0.128)]
CRACK_B = [(0.0835, -0.04), (0.094, -0.049), (0.103, -0.061)]


def face_micro(X, Y, side, uf):
    """The cut details (HIGH only, baked): slits, lid creases, lip line, stitches, crack, chisel dents, seam chips, nails.
    Returns (disp, masks)."""
    w = side > 0
    e = eye_of(side)
    disp = np.zeros(np.shape(X))
    m = {}
    # the slit eye: a deep narrow cut between the lids; its floor glows
    sy, t = slit_y(X, e)
    inside = (X > e["x0"]) & (X < e["x1"])
    ws = e["ws"] * np.power(np.sin(np.pi * t), 0.5) + (0.0016 * g1(t, 0.1, 0.07) if w else 0)
    dy = Y - sy
    cut = np.where(inside, sstep(ws + 0.0004, ws * 0.35, np.abs(dy)), 0)
    disp = disp - 0.007 * cut
    disp = disp + np.where(inside, 0.0009 * g1(dy, ws + 0.0011, 0.0008) + 0.0006 * g1(dy, -(ws + 0.001), 0.0008), 0)
    m["slit"] = cut
    # upper lid crease (the wrong one doubled, heavier)
    tc = np.clip((X - e["x0"] + 0.004) / (e["x1"] - e["x0"] + 0.008), 0, 1)
    cy = sy + (0.0115 if w else 0.0135) + 0.003 * np.sin(np.pi * tc)
    cin = sstep(e["x0"] - 0.006, e["x0"], X) * sstep(e["x1"] + 0.008, e["x1"], X)
    disp = disp - 0.0013 * g1(Y - cy, 0, 0.0011) * cin
    if w:
        disp = disp - 0.0009 * g1(Y - cy - 0.0055, 0, 0.0009) * cin
    # the lip line, then the cord stitches across it with drilled holes
    Ym = mouth_y(X, side)
    lipx = sstep(0.05, 0.036, X)
    disp = disp - 0.0024 * g1(Y - Ym, 0, 0.0009) * lipx
    cord = np.zeros(np.shape(X))
    hole = np.zeros(np.shape(X))
    blood = np.zeros(np.shape(X))
    for xk, sl in stitch_list(side):
        ym = float(mouth_y(np.array(xk), side))
        a = (xk - sl, ym + 0.0155)
        b = (xk + sl, ym - 0.0145)
        d, _ = seg_dist2(X, Y, a, b)
        rc = 0.002
        cord = np.maximum(cord, np.sqrt(np.clip(1 - (d / rc) ** 2, 0, 1)))
        for p in (a, b):
            dh = np.sqrt((X - p[0]) ** 2 + (Y - p[1]) ** 2)
            hole = np.maximum(hole, sstep(0.003, 0.0014, dh))
            blood = np.maximum(blood, g1(dh, 0, 0.0042) * (0.6 + 0.4 * sstep(p[1] + 0.001, p[1] - 0.008, Y)))
        if w:
            disp = disp + 0.001 * g1(X, xk + 0.0037, 0.0022) * g1(Y - ym, 0, 0.007)  # puckered between the stitches
    disp = disp - 0.0028 * hole * (1 - cord) + 0.0019 * cord
    m["cord"] = cord
    m["hole"] = hole * (1 - cord)
    m["blood"] = blood * (1 - cord)
    # the crack (wrong half only): a hairline from the slit's outer corner down to the cheek, one branch
    if w:
        jx = X + 0.0007 * vnoise3(X, Y, 0, 900, 11)
        d1, s1 = poly_dist2(jx, Y, CRACK)
        d2, _ = poly_dist2(jx, Y, CRACK_B)
        dc = np.minimum(d1, d2)
        crack = g1(dc, 0, 0.0007)
        disp = disp - 0.0017 * crack + 0.00045 * np.where(s1 > 0, 1, 0) * g1(dc, 0, 0.003) * sstep(0.0, 0.0012, dc)
        m["crack"] = crack
        m["crackhalo"] = g1(dc, 0, 0.0045)
    else:
        m["crack"] = np.zeros(np.shape(X))
        m["crackhalo"] = np.zeros(np.shape(X))
    # chisel dents: elongated shallow strikes, mostly toward the cut edges and the forehead
    dent = np.zeros(np.shape(X))
    for k in range(46):
        r1, r2, r3 = rnd(k * 5 + 1 + 100 * side), rnd(k * 5 + 2 + 100 * side), rnd(k * 5 + 3 + 100 * side)
        if k < 30:
            cx = 0.068 + 0.04 * r1
            cyy = -0.16 + 0.3 * r2
        else:
            cx = 0.01 + 0.08 * r1
            cyy = 0.09 + 0.09 * r2
        ang = r3 * np.pi
        ca, sa = math.cos(ang), math.sin(ang)
        lx = (X - cx) * ca + (Y - cyy) * sa
        ly = -(X - cx) * sa + (Y - cyy) * ca
        dent = np.maximum(dent, np.exp(-((lx / 0.0045) ** 2 + (ly / 0.0016) ** 2)))
    disp = disp - 0.0005 * dent
    m["dent"] = dent
    # the seam's chipped edge
    chip = sstep(0.006, 0.0, X - SEAM) * np.clip(vnoise3(X * 0, Y, 0, 55, 23 + side) * 2.4 - 1.1, 0, 1)
    disp = disp - 0.0018 * chip
    m["chip"] = chip
    # nails at the temple and the jaw (the wrong half's jaw nail is gone: a rusted hole)
    nail = np.zeros(np.shape(X))
    nhole = np.zeros(np.shape(X))
    rust = np.zeros(np.shape(X))
    for (nx, ny), gone in (((0.101, 0.064), False), ((0.073, -0.17), w)):
        lx = np.abs(X - nx)
        ly = np.abs(Y - ny)
        sq = np.maximum(lx, ly)
        if gone:
            nhole = np.maximum(nhole, sstep(0.0032, 0.0022, np.sqrt(lx ** 2 + ly ** 2)))
        else:
            head = sstep(0.0027, 0.002, sq)
            nail = np.maximum(nail, head)
            disp = disp + head * (0.002 + 0.001 * np.clip(1 - (sq / 0.0025) ** 2, 0, 1))
        streak = sstep(0.004, 0.0015, lx + 0.002 * vnoise3(X, Y, 1, 500, 5)) * sstep(ny + 0.002, ny - 0.002, Y) * sstep(ny - 0.06, ny - 0.01, Y)
        rust = np.maximum(rust, np.maximum(streak * 0.55, 0.25 * g1(np.sqrt(lx ** 2 + ly ** 2), 0, 0.004)))
    disp = disp - 0.004 * nhole
    m["nail"] = nail
    m["nhole"] = nhole
    m["rust"] = rust
    # craquelure: the old glaze crazed in a fine net, open in patches
    cq = voronoi_edge2(X + 0.002 * vnoise3(X, Y, 0, 160, 76), Y, 0.0065, 77 + side)
    craq = g1(cq, 0, 0.00022) * cl(fbm3(X, Y, side, 22.0, 78 + side, 3) * 2.5 - 0.35)
    disp = disp - 0.00018 * craq
    m["craq"] = craq
    # carved marks, chalk rubbed into the grooves: a mason's banker mark on the serene forehead, a tally on the wrong temple
    if w:
        segs = [((0.074 + 0.0042 * i, 0.112), (0.0755 + 0.0042 * i, 0.094)) for i in range(4)] + [((0.072, 0.098), (0.091, 0.108))]
    else:
        ox, oy = 0.04, 0.132
        segs = [((ox, oy + 0.017), (ox, oy - 0.015)), ((ox, oy + 0.017), (ox - 0.009, oy + 0.006)), ((ox, oy + 0.017), (ox + 0.009, oy + 0.006)),
                ((ox - 0.0075, oy - 0.006), (ox + 0.0075, oy - 0.006))]
    dm = np.full(np.shape(X), 1e9)
    for a_, b_ in segs:
        dm = np.minimum(dm, seg_dist2(X, Y, a_, b_)[0])
    mark = sstep(0.0011, 0.0004, dm)
    disp = disp - 0.0011 * mark
    m["mark"] = mark
    # tear tracks: grime washed down from the slits (eroded a little)
    tear = np.zeros(np.shape(X))
    runs = ((0.2, 0.15, 1.0), (0.55, 0.07, 0.55)) if w else ((0.35, 0.085, 0.6),)
    for i, (ts, L, k) in enumerate(runs):
        x0 = e["x0"] + ts * (e["x1"] - e["x0"])
        y0 = float(slit_y(np.array(x0), e)[0])
        along = np.clip((y0 - Y) / L, 0, 1)
        wob = x0 + 0.0035 * vnoise3(np.full(np.shape(X), 3.0 * i + 0.5 * side), Y, 0, 45, 30 + i) + 0.004 * along ** 1.5
        wid = 0.002 + 0.005 * along ** 0.8
        edge = g1(np.abs(X - wob), wid * 0.8, wid * 0.35)
        core = g1(X - wob, 0, wid)
        fade = sstep(y0 + 0.002, y0 - 0.003, Y) * np.power(1 - along, 0.6) * (0.75 + 0.25 * vnoise3(X, Y, 0, 240, 33 + i))
        tear = np.maximum(tear, (0.7 * core + 0.5 * edge) * fade * k)
    disp = disp - 0.00025 * tear
    m["tear"] = tear
    m["lip"] = lipx * g1(Y - Ym, 0, 0.0012)
    return disp, m


def mask_part(side):
    rot, dyo, dzo = PLACE[side]
    cr, sr = math.cos(rot), math.sin(rot)

    def local(U, V):
        vv = np.clip((V - VCHIN) / (1 - VCHIN), 0, 1) * 2 - 1
        Ym = vv * HH
        W = np.maximum(mask_hw(vv), SEAM + 0.0012)
        uf = np.clip((U - 0.05) / 0.87, 0, 1)
        Xm = SEAM + uf * (W - SEAM)
        z = face_macro(Xm, Ym, side)
        ts = np.clip((0.05 - U) / 0.05, 0, 1)
        to = np.clip((U - 0.92) / 0.08, 0, 1)
        tc = np.clip((VCHIN - V) / VCHIN, 0, 1)
        z = z - 0.03 * np.sin(ts * np.pi / 2) - 0.022 * np.sin(to * np.pi / 2) - 0.02 * np.sin(tc * np.pi / 2)
        Xm = Xm - 0.0008 * ts + 0.0035 * np.sin(to * np.pi)
        Ym = Ym + 0.003 * np.sin(tc * np.pi)
        ts = np.maximum(ts, tc)
        return Xm, Ym, z, uf, ts, to

    def place(Xm, Ym, z):
        x = side * Xm
        return stack3(x * cr - Ym * sr, MC[1] + x * sr + Ym * cr + dyo, MC[2] + z + dzo)

    def fn(U, V):
        Xm, Ym, z, _, _, _ = local(U, V)
        return place(Xm, Ym, z)

    def relief(U, V, P, N):
        Xm, Ym, z, uf, ts, to = local(U, V)
        d, m = face_micro(Xm, Ym, side, uf)
        front = (1 - ts) * (1 - to)
        m["front"] = front
        m["X"], m["Y"], m["uf"] = Xm, Ym, uf
        return d * front, m

    def paint(U, V, P, N, m):
        X, Y, front = m["X"], m["Y"], m["front"]
        n1 = fbm3(X, Y, side, 14.0, 70 + side, 3)
        n2 = fbm3(X, Y, side, 45.0, 72 + side, 3)
        alb = IVORY * (0.88 + 0.12 * n1 + 0.04 * n2)[..., None]
        alb = mix3(alb, IVORY * np.array([0.86, 0.8, 0.68]), cl(0.55 * sstep(0.0, -0.2, Y) + 0.25 * cl(n1)))  # yellowed below the nose
        alb = mix3(alb, IVORY * np.array([0.92, 0.88, 0.8]), 0.5 * sstep(0.7, 1.0, m["uf"]))  # older, warmer at the edges
        # grime pooled in the forms: under the brow, the socket, the nasolabial, the lip line, the chin crease
        e = eye_of(side)
        sy_, _ = slit_y(X, e)
        lids = g2(X, Y, e["x"], e["y"], 0.03, 0.02) * (0.55 + 0.45 * g1(Y - sy_, 0, 0.0045))
        pool = 0.8 * g2(X, Y, e["x"], e["y"] + 0.015, 0.034, 0.01) + 0.9 * lids + 0.6 * g2(X, Y, e["x"] + 0.002, e["y"] - 0.015, 0.03, 0.008)
        pool = pool + 0.45 * g2(X, Y, 0.045, -0.12, 0.022, 0.005) + 0.35 * g2(X, Y, 0.028, -0.072, 0.008, 0.007) + 0.3 * g2(X, Y, 0.009, -0.078, 0.006, 0.004)
        pool = pool + 0.35 * sstep(0.008, SEAM, X)  # the seam's lip
        alb = mix3(alb, GRIME * 0.9, cl(pool * 0.85))  # soot in the sockets: the slits glow out of dark hollows
        alb = mix3(alb, GRIME * 0.4, cl(m["tear"] * 1.5))
        alb = mix3(alb, np.array([0.74, 0.73, 0.69]), cl(m["mark"] * 0.85))
        alb = mix3(alb, GRIME * 0.7, cl(m["crackhalo"] * (0.45 if side > 0 else 0)))
        alb = mix3(alb, np.array([0.02, 0.018, 0.016]), cl(m["crack"]))
        alb = mix3(alb, GRIME * 1.2, cl(m["dent"] * 0.15 + m["chip"] * 0.8))
        alb = mix3(alb, GRIME * 1.6, cl(m["craq"] * 0.3))
        alb = mix3(alb, np.array([0.03, 0.022, 0.018]), cl(m["cord"]))
        alb = mix3(alb, np.array([0.07, 0.022, 0.016]), cl(m["blood"] * 0.8))
        alb = mix3(alb, np.array([0.012, 0.01, 0.01]), cl(m["hole"] + m["nhole"]))
        alb = alb * (1 - 0.2 * sstep(0.62, 1.0, m["uf"]))[..., None]  # the edges sink into the hood
        alb = mix3(alb, RUST * 1.3, cl(m["rust"] * 0.75))
        alb = mix3(alb, IRON * 3.0 + RUST * 0.4, cl(m["nail"]))
        alb = mix3(alb, GRIME * 0.6, cl(m["lip"] * 0.8))
        alb = mix3(alb, np.array([0.004, 0.005, 0.007]), cl(m["slit"]))
        alb = mix3(np.array([0.045, 0.04, 0.036]) * (0.85 + 0.15 * n1)[..., None], alb, front)  # the returns: the grimy unglazed underside
        rough = 0.3 + 0.12 * cl(n1 * 0.5 + 0.5) + 0.3 * cl(pool) + 0.4 * m["crack"] + 0.45 * m["cord"] + 0.3 * m["rust"]
        rough = lerp(rough, 0.14, cl(m["tear"]))  # wet
        rough = lerp(rough, 0.9, cl(m["mark"]))
        rough = lerp(0.8, rough, front)
        return dict(alb=alb, rough=cl(rough), glow=cl(m["slit"] * front))

    def fx(U, V, P):
        ts = np.clip((0.05 - U) / 0.05, 0, 1)
        to = np.clip((U - 0.92) / 0.08, 0, 1)
        tc = np.clip((VCHIN - V) / VCHIN, 0, 1)
        return (1 - ts) * (1 - to) * (1 - tc), 0.0, 0.0
    # rows: dense through the eyes, the nose tip and the mouth; columns: dense at the seam and over the eye; the returns exact
    vw = warp_fn([(0.15, 0.12, 2.2), (0.3, 0.06, 1.0), (-0.575, 0.07, 1.6), (-0.36, 0.07, 0.9), (-0.85, 0.1, 0.4)], to_v=lambda v: v * 2 - 1)
    uw = warp_fn([(0.0, 0.1, 1.4), (0.45, 0.2, 0.9)])

    def ucols(n):
        return np.concatenate([[0.0], 0.05 + 0.87 * uw(np.linspace(0, 1, n - 2)), [0.96, 1.0]])

    def vrows(n):
        return np.concatenate([[0.0], VCHIN + (1 - VCHIN) * vw(np.linspace(0, 1, n))])
    p = Part("mask" + ("L" if side > 0 else "R"), fn, {0: (20, 60), 1: (12, 34), 2: (8, 20)}, "mask", "head", uvw=30.0, relief=relief,
             paint=paint, fx=fx, cage=0.012, orient=None)
    p.ucols, p.vrows = ucols, vrows
    return p


VCHIN = 0.035


def warp_fn(bumps, to_v=None):
    """A monotone warp t -> param putting more samples around the given feature centres [(centre, width, gain)]
    (centres in the 'to_v' space)."""
    xs = np.linspace(0, 1, 2001)
    vals = to_v(xs) if to_v else xs
    dens = np.ones_like(xs)
    for c, s, gn in bumps:
        dens = dens + gn * g1(vals, c, s)
    cum = np.concatenate([[0], np.cumsum((dens[1:] + dens[:-1]) * 0.5)])
    cum /= cum[-1]

    def w(t):
        return np.interp(t, cum, xs)
    return w


# ---- the hood -------------------------------------------------------------------------------------------------------
HC = np.array([0.0, 2.95, -0.03])
A0 = 0.86
PK = np.array([0.0, 0.83, -0.56]) / np.linalg.norm([0.0, 0.83, -0.56])


def hood_outer(alpha, beta, folds=True):
    dx = np.sin(alpha) * np.sin(beta)
    dy = np.sin(alpha) * np.cos(beta)
    dz = np.cos(alpha)
    neg = dy < 0
    rx = 0.19 * np.where(neg, 1 + 0.45 * dy * dy, 1)
    ry = 0.29 * np.where(neg, 1 + 0.85 * -dy, 1)
    rz = 0.235
    x = dx * rx
    y = HC[1] + dy * ry
    z = HC[2] + dz * rz
    pk = np.power(np.maximum(0, dx * PK[0] + dy * PK[1] + dz * PK[2]), 6)
    y = y + pk * 0.13
    z = z - pk * 0.26
    rim = sstep(A0 + 0.4, A0, alpha)
    z = z + rim * 0.085
    x = x * (1 - rim * 0.1)
    y = y + rim * np.where(dy > 0, 0.02, -0.01)
    if folds:
        drape = sstep(0.0, -0.6, dy)
        f = 0.011 * drape * np.sin(beta * 11 + 2 * np.sin(beta * 3)) * sstep(A0 + 0.3, A0 + 0.9, alpha)
        f = f + 0.007 * rim * np.sin(beta * 7 + 1.0) + 0.009 * np.power(pk, 0.3) * np.sin(beta * 5 + alpha * 7)
        f = f + 0.006 * pfbm(beta, alpha * 0.6, 2.0, 41, 2)
        x, y, z = x + dx * f, y + dy * f, z + dz * f
    return stack3(x, y, z)


def hood_fn(U, V):
    beta = U * TAU
    # v: [0, 0.09] inner surface (into the hood), [0.09, 0.17] the rolled lip, [0.17, 1] outer, rim -> back
    vin = V < 0.09
    vroll = (V >= 0.09) & (V < 0.17)
    t_in = (0.09 - np.clip(V, 0, 0.09)) / 0.09
    t_roll = np.clip((V - 0.09) / 0.08, 0, 1)
    t_out = np.clip((V - 0.17) / 0.83, 0, 1)
    a_out = lerp(A0, np.pi * 0.999, np.power(t_out, 0.9))
    Po = hood_outer(a_out, beta)
    Prim = hood_outer(np.full_like(beta, A0), beta)
    Pin = HC + (hood_outer(A0 + 0.55 * t_in, beta) - HC) * 0.86
    Pri = HC + (Prim - HC) * 0.86
    mid = (Prim + Pri) * 0.5
    half = (Prim - Pri) * 0.5
    ph = np.pi * t_roll
    Proll = mid + half * np.cos(ph)[..., None] + np.array([0.0, 0.0, 0.017]) * np.sin(ph)[..., None]
    return np.where(vin[..., None], Pin, np.where(vroll[..., None], Proll, Po))


def hood_relief(U, V, P, N):
    beta = U * TAU
    out = sstep(0.15, 0.2, V)
    d = 0.0016 * np.sin(beta * 23 + V * 19 + 2 * pnoise(beta, V * 3, 2.0, 51)) * out
    d = d + 0.0009 * pfbm(beta, V * 4, 6.0, 52, 3)
    # the stitched seam along the top (beta = 0) from the lip over the peak
    db = np.abs(np.angle(np.exp(1j * beta))) * 0.25
    seam = g1(db, 0, 0.003) * out
    st = seam * (np.sin(V * 420) > 0.2)
    d = d - 0.0012 * seam + 0.0009 * st
    # fraying at the lip
    lip = g1(V, 0.13, 0.03)
    d = d + 0.0012 * lip * vnoise3(np.cos(beta) * 30, np.sin(beta) * 30, V * 40, 1.0, 53)
    return d, dict(seam=seam, stitch=st, out=out)


def hood_paint(U, V, P, N, m):
    beta = U * TAU
    n1 = pfbm(beta, V * 2, 2.0, 61, 3)
    alb = WOOL * (0.85 + 0.25 * n1)[..., None]
    inner = 1 - sstep(0.11, 0.17, V)
    alb = mix3(alb, WOOL_IN, inner)
    # chalk dust settled on the drape over the shoulders (faces up, outside, not at the face)
    up = cl(N[..., 1] * 1.4 - 0.35) * sstep(2.7, 2.5, P[..., 1]) * sstep(0.06, 0.16, np.abs(P[..., 0]))
    dust = cl(up * (0.55 + 0.6 * pfbm(beta, V * 6, 3.0, 62, 3))) * m["out"]
    alb = mix3(alb, CHALK, dust * 0.7)
    # grime where the lip touches the mask, a wet line along the bottom of the drape
    alb = mix3(alb, GRIME * 0.5, g1(V, 0.12, 0.03) * 0.5)
    alb = mix3(alb, np.array([0.13, 0.12, 0.1]), m["stitch"] * 0.6)
    rough = 0.82 - 0.15 * cl(n1) + 0.1 * dust
    wet = sstep(2.55, 2.42, P[..., 1]) * 0.5
    rough = rough - 0.3 * wet
    alb = alb * (1 - 0.25 * wet)[..., None]
    return dict(alb=alb, rough=cl(rough), glow=0 * rough)


def hood_fx(U, V, P):
    return 0.0, 0.0, sstep(0.3, 0.14, V) * sstep(0.04, 0.1, V)


# ---- the mantle: a short wool cape over the shoulders (it covers the shoulder joints; the chalk settles on it) ----------
MANTLE = [(0.0, 0.13, 2.715), (0.12, 0.2, 2.70), (0.32, 0.33, 2.655), (0.55, 0.405, 2.575), (0.78, 0.44, 2.44), (1.0, 0.46, 2.3)]


def mantle_fn(U, V):
    th = np.pi + U * TAU
    r = interp(V, [(a, b) for a, b, _ in MANTLE])
    y = interp(V, [(a, c) for a, _, c in MANTLE])
    y = y - V ** 3 * (0.06 * (0.5 + 0.5 * np.cos(2 * th)) + 0.045 * pnoise(th, 0, 2.5, 301) + 0.03 * np.maximum(0, pnoise(th, 1, 5.0, 308)))
    ph = 9 * th + 1.2 * np.sin(2 * th) + 0.9 * pnoise(th, V, 1.0, 302)
    fold = (0.004 + 0.055 * V ** 1.4) * (np.sin(ph) + 0.35 * np.sin(2 * ph + 0.8)) * (0.7 + 0.5 * pnoise(th, 2, 2.0, 309))
    r = r * (1 + fold)
    return stack3(np.sin(th) * r, y, np.cos(th) * r * 0.74 - 0.01)


def mantle_relief(U, V, P, N):
    th = np.pi + U * TAU
    d = 0.0014 * np.sin(th * 21 + V * 14 + 2 * pnoise(th, V * 3, 2.0, 303)) * sstep(0.2, 0.6, V)
    d = d + 0.001 * pfbm(th, V * 4, 5.0, 304, 3)
    d = d + 0.0018 * sstep(0.93, 1.0, V) * vnoise3(np.cos(th) * 40, np.sin(th) * 40, V * 30, 1.0, 305)
    seam = g1(V, 0.05, 0.008)
    st = seam * (np.sin(th * 160) > 0.2)
    return d - 0.001 * seam + 0.0008 * st, dict(stitch=st * 1.0)


def mantle_paint(U, V, P, N, m):
    th = np.pi + U * TAU
    n1 = pfbm(th, V * 2, 2.0, 306, 3)
    alb = WOOL * (0.85 + 0.25 * n1)[..., None]
    up = cl(N[..., 1] * 1.8 - 0.55) * sstep(0.12, 0.26, np.abs(P[..., 0]))
    dust = cl(up * (0.3 + 0.9 * pfbm(th, V * 5, 3.0, 307, 4)) - 0.08)
    alb = mix3(alb, CHALK, dust * 0.7)
    wet = sstep(0.8, 1.0, V) * 0.5
    alb = alb * (1 - 0.3 * wet)[..., None]
    alb = mix3(alb, np.array([0.13, 0.12, 0.1]), m["stitch"] * 0.6)
    return dict(alb=alb, rough=cl(0.82 - 0.1 * n1 + 0.08 * dust - 0.35 * wet), glow=0 * n1)


def mantle_skin(P, U=None, V=None):
    x, y = P[:, 0], P[:, 1]
    W = Wz(len(P))
    sh = 0.45 * sstep(0.18, 0.36, np.abs(x))
    nk = 0.4 * sstep(2.64, 2.71, y)
    W[:, B["chest"]] += 1 - sh - nk
    W[:, B["neck"]] += nk
    W[:, B["upperArmL"]] += np.where(x > 0, sh, 0)
    W[:, B["upperArmR"]] += np.where(x < 0, sh, 0)
    return W


# ---- the robe -------------------------------------------------------------------------------------------------------
ROBE_P =[(2.66, 0.11), (2.6, 0.2), (2.5, 0.235), (2.3, 0.21), (2.0, 0.172), (1.74, 0.158), (1.5, 0.198), (1.0, 0.255), (0.5, 0.315), (0.0, 0.37)]


def robeR(y):
    return interp(y, ROBE_P)


def robe_xyz(th, y, r):
    shoulder = sstep(2.3, 2.52, y) * (1 - sstep(2.58, 2.66, y))
    xs = 1 + 0.14 * shoulder
    hunch = 0.03 * sstep(1.9, 2.3, y) * sstep(2.6, 2.35, y) * np.maximum(0, -np.cos(th))
    return stack3(np.sin(th) * r * xs, y, np.cos(th) * r * 0.82 - hunch)


def robe_hem(th):
    return 0.13 + 0.05 * pnoise(th, 0, 1.6, 1) + 0.08 * np.maximum(0, pnoise(th, 3, 3.2, 2)) * np.where(np.cos(th) < 0.6, 1, 0.4)


def robe_fn(U, V):
    th = np.pi + U * TAU
    y = lerp(2.58, robe_hem(th), np.power(V, 0.92))
    r = robeR(y)
    below = sstep(1.68, 0.3, y)
    fl = np.sin(11 * th + 1.4 * np.sin(2 * th + 0.7) + 0.9 * pnoise(th, y * 1.5, 1.0, 11))
    fl = fl + 0.3 * np.sin(22 * th + 1.0 + 0.5 * pnoise(th, y, 1.0, 12))
    fold_lo = (0.02 + 0.07 * below) * fl * sstep(1.72, 1.6, y)
    fold_hi = 0.012 * sstep(1.78, 1.9, y) * sstep(2.4, 2.1, y) * np.sin(15 * th + 2 * np.sin(th))
    r = r * (1 + fold_lo + fold_hi)
    return robe_xyz(th, y, r)


def robe_relief(U, V, P, N):
    th = np.pi + U * TAU
    y = P[..., 1]
    d = 0.0024 * np.sin(y * 95 + 3 * pnoise(th, y, 2.0, 13)) * sstep(1.95, 1.82, y) * sstep(1.66, 1.76, y)  # cinch wrinkles
    d = d + 0.0012 * pfbm(th, y * 2, 4.0, 14, 3)
    d = d + 0.0016 * sstep(0.96, 1.0, V) * vnoise3(np.cos(th) * 40, np.sin(th) * 40, y * 50, 1.0, 15)  # fraying hem
    # a patch on the back, stitched round
    pu = (np.mod(th, TAU) - 2.55) / 0.42
    pv = (y - 0.78) / 0.3
    inside = (np.abs(pu - 0.5) < 0.5) & (np.abs(pv - 0.5) < 0.5)
    edge = np.minimum(np.minimum(np.abs(pu), np.abs(pu - 1)) * 0.42 * 0.37, np.minimum(np.abs(pv), np.abs(pv - 1)) * 0.3)
    patch = inside * sstep(0.0, 0.004, edge)
    stitch = inside * g1(edge, 0.006, 0.0015) * (np.sin((np.mod(th, TAU) * 0.33 + y) * 520) > 0.3)
    d = d + 0.0016 * patch + 0.0008 * stitch
    # the side seams
    seam = g1(np.sin(th), 1, 0.0015) + g1(np.sin(th), -1, 0.0015)
    d = d - 0.001 * seam
    return d, dict(patch=patch * 1.0, stitch=stitch * 1.0)


def robe_paint(U, V, P, N, m):
    th = np.pi + U * TAU
    y = P[..., 1]
    n1 = pfbm(th, y * 1.2, 2.0, 21, 3)
    alb = WOOL * (0.85 + 0.28 * n1)[..., None]
    wet = sstep(0.55, 0.15, y + 0.06 * pnoise(th, y, 3.0, 22))
    alb = alb * (1 - 0.3 * wet)[..., None]
    tide = g1(y - (0.52 + 0.03 * pnoise(th, 0, 2.0, 23)), 0, 0.016) * 0.3
    alb = mix3(alb, np.array([0.12, 0.115, 0.105]), tide)
    smear = cl(pfbm(th * 1.0, y * 0.35, 5.0, 24, 3) * 2.4 - 0.85) * sstep(0.6, 1.1, y) * sstep(2.2, 1.9, y)
    alb = mix3(alb, CHALK * 0.8, smear * 0.22)
    streak = cl(pnoise(th * 4, y * 0.2, 6.0, 25) * 1.5 - 0.4) * sstep(2.3, 1.2, y)
    alb = alb * (1 - 0.25 * streak)[..., None]
    alb = mix3(alb, np.array([0.068, 0.052, 0.036]), m["patch"])
    alb = mix3(alb, np.array([0.17, 0.15, 0.12]), m["stitch"] * 0.7)
    rough = 0.84 - 0.42 * wet + 0.06 * smear
    return dict(alb=alb, rough=cl(rough), glow=0 * rough)


# ---- the apron, its straps, the pocket; the belt, the buckle, the loops, the tools ------------------------------------
def robeR_s(y):
    return robeR(y) * (1 + 0.1 * sstep(1.68, 0.3, y) + 0.03) + 0.014


def apron_point(s, y, off=0.0):
    halfw = lerp(0.15, 0.255, np.power(np.clip((2.3 - y) / 1.68, 0, 1), 0.8))
    rr = robeR_s(y) + off - 0.012 * g1(y, 1.74, 0.07)
    th = np.clip(s * halfw / np.maximum(0.15, rr), -1.25, 1.25)
    return robe_xyz(th, y, rr), th


def apron_fn(U, V):
    s = U * 2 - 1
    y = lerp(2.3, 0.62 - 0.012 * pnoise(U * 3, 0, 1.0, 31), V)
    P, _ = apron_point(s, y)
    return P


def apron_relief(U, V, P, N):
    s = U * 2 - 1
    y = P[..., 1]
    halfw = lerp(0.15, 0.255, np.power(np.clip((2.3 - y) / 1.68, 0, 1), 0.8))
    ex = (1 - np.abs(s)) * halfw  # m to the side edges
    ey = np.minimum(np.abs(2.3 - y), np.abs(y - 0.62))
    edge = np.minimum(ex, ey)
    row1 = g1(edge, 0.009, 0.0012)
    row2 = g1(edge, 0.015, 0.0012)
    dots = (np.sin((ex * (ex < ey) + y * (ex >= ey) + s * 0.0) * 700) > 0.1) * 1.0
    st = (row1 + row2) * dots
    d = 0.0008 * st - 0.0005 * (row1 + row2)
    d = d - 0.0016 * sstep(0.004, 0.0, edge)  # the cut edge rounds over
    grain = fbm3(P[..., 0], P[..., 1], P[..., 2], 220.0, 33, 2)
    d = d + 0.00025 * grain
    crease = 0.0018 * np.sin(y * 70 + 3 * vnoise3(s, y, 0, 3.0, 34)) * g1(y, 1.74, 0.09)
    scuff = cl(fbm3(P[..., 0], P[..., 1], P[..., 2], 18.0, 35, 3) * 2 - 0.8)
    d = d + crease - 0.0006 * scuff
    return d, dict(stitch=cl(st), scuff=scuff, edge=sstep(0.006, 0.0, edge))


def apron_paint(U, V, P, N, m):
    y = P[..., 1]
    n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 6.0, 36, 3)
    alb = LEATHER * (0.85 + 0.3 * n1)[..., None]
    alb = mix3(alb, LEATHER * 1.9, cl(m["scuff"] * 0.7 + m["edge"] * 0.5))
    stain = cl(fbm3(P[..., 0], P[..., 1], P[..., 2], 4.0, 37, 3) * 2.4 - 0.7)
    alb = mix3(alb, LEATHER * 0.45, stain * 0.8)
    dust = cl(fbm3(P[..., 0] * 1.6, P[..., 1] * 0.7, P[..., 2], 6.0, 38, 4) * 2.4 - 0.55) * sstep(0.7, 1.3, y) * sstep(2.3, 1.9, y)
    alb = mix3(alb, CHALK, dust * 0.4)
    hand = g2(P[..., 0], y, 0.03, 1.6, 0.1, 0.06) * 0.35  # wiped hands
    alb = mix3(alb, CHALK * 0.9, hand)
    alb = mix3(alb, np.array([0.27, 0.25, 0.21]), m["stitch"] * 0.8)
    rough = 0.62 + 0.15 * dust - 0.25 * stain + 0.1 * m["scuff"]
    return dict(alb=alb, rough=cl(rough), glow=0 * rough)


def pocket_fn(U, V):
    s = lerp(-0.62, 0.05, U)
    y = lerp(1.34, 1.06, V)
    bul = 0.012 * np.sin(np.pi * U) * np.sin(np.pi * np.clip(V * 1.2, 0, 1)) + 0.004
    P, _ = apron_point(s, y, off=bul)
    return P


def pocket_relief(U, V, P, N):
    ex = np.minimum(U, 1 - U) * 0.16
    ey = np.minimum(V, 1 - V) * 0.28
    edge = np.minimum(ex, ey)
    st = g1(edge, 0.006, 0.0012) * (np.sin((U * 0.16 + V * 0.28) * 800) > 0.1)
    return 0.0007 * st - 0.002 * sstep(0.004, 0.0, edge), dict(stitch=st * 1.0, edge=sstep(0.006, 0.0, edge))


def pocket_paint(U, V, P, N, m):
    n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 9.0, 39, 3)
    alb = LEATHER * (0.75 + 0.3 * n1)[..., None]
    alb = mix3(alb, LEATHER * 1.8, m["edge"] * 0.6)
    alb = mix3(alb, np.array([0.27, 0.25, 0.21]), m["stitch"] * 0.8)
    alb = mix3(alb, CHALK, cl(n1 * 1.5 - 0.2) * 0.3)
    return dict(alb=alb, rough=cl(0.6 + 0.1 * n1), glow=0 * n1)


def belt_fn(U, V):
    th = np.pi + U * TAU
    y0 = 1.74
    a = V * TAU
    rr = robeR_s(y0) - 0.012 * 0.6 + 0.004
    q = robe_xyz(th, np.full_like(th, y0), rr)
    k = 1 + (0.007 * np.cos(a)) / rr
    return stack3(q[..., 0] * k * 1.02, y0 + 0.03 * np.sin(a), q[..., 2] * k * 1.03)


def belt_relief(U, V, P, N):
    a = V * TAU
    edge = g1(np.sin(a), 1, 0.25) + g1(np.sin(a), -1, 0.25)
    st = g1(np.abs(np.sin(a)), 0.78, 0.06) * (np.sin(U * 2400) > 0.0)
    holes = g2(np.mod(U * 40, 1.0), np.sin(a), 0.5, 0.0, 0.08, 0.2) * sstep(0.08, 0.02, np.abs(U - 0.06))
    return 0.0006 * st - 0.0009 * edge - 0.0015 * holes, dict(stitch=st * 1.0, hole=holes)


def belt_paint(U, V, P, N, m):
    n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 10.0, 41, 3)
    alb = LEATHER * (0.7 + 0.35 * n1)[..., None]
    alb = mix3(alb, np.array([0.25, 0.23, 0.2]), m["stitch"] * 0.7)
    alb = mix3(alb, LEATHER * 0.3, m["hole"])
    return dict(alb=alb, rough=cl(0.55 + 0.15 * n1), glow=0 * n1)


def tube_part(name, pts, r0, r1, res, cls, skin, uvw=1.0, cap=(0.08, 0.08), up=(0, 0, 1), relief=None, paint=None, shape=None, cage=0.01):
    c = Curve(pts, up=up)

    def ra(V, th):
        return cap_r(V, lerp(r0, r1, V), cap[0], cap[1])
    return Part(name, sweep_fn(c, ra, shape=shape), res, cls, skin, uvw=uvw, relief=relief, paint=paint, cage=cage)


def iron_paint_fn(seed, bright=0.0):
    def paint(U, V, P, N, m):
        n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 12.0, seed, 3)
        alb = IRON * (0.85 + 0.3 * n1)[..., None]
        edge = cl(m.get("edge", 0 * n1))
        alb = mix3(alb, IRON_EDGE, edge * 0.8 + bright)
        rust = cl(m.get("rust", 0 * n1) + cl(fbm3(P[..., 0], P[..., 1], P[..., 2], 7.0, seed + 1, 3) * 2 - 0.9) * 0.6)
        alb = mix3(alb, RUST, rust * 0.8)
        alb = mix3(alb, CHALK * 0.6, cl(m.get("dust", 0 * n1)) * 0.5)
        rough = 0.42 + 0.25 * rust - 0.15 * edge + 0.08 * n1
        return dict(alb=alb, rough=cl(rough), glow=0 * n1)
    return paint


def wood_paint(U, V, P, N, m):
    n1 = fbm3(P[..., 0] * 1, P[..., 1] * 8, P[..., 2] * 1, 30.0, 45, 3)
    alb = WOOD * (0.75 + 0.45 * n1)[..., None]
    alb = mix3(alb, WOOD * 2.2, cl(m.get("worn", 0 * n1)) * 0.6)
    return dict(alb=alb, rough=cl(0.62 + 0.1 * n1), glow=0 * n1)


def lathe_part(name, c, axis, prof, res, cls, skin, uvw=1.0, relief=None, paint=None, cage=0.008):
    """Surface of revolution about `axis` through c; prof(V) -> (r, h) with V running from one pole to the other."""
    c = np.array(c, float)
    ax = np.array(axis, float) / np.linalg.norm(axis)
    e1 = np.cross(ax, [0.0, 1.0, 0.0] if abs(ax[1]) < 0.9 else [1.0, 0, 0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(ax, e1)

    def fn(U, V):
        r, h = prof(V)
        th = U * TAU
        return c + ax * h[..., None] + e1 * (np.cos(th) * r)[..., None] + e2 * (np.sin(th) * r)[..., None]
    return Part(name, fn, res, cls, skin, uvw=uvw, relief=relief, paint=paint, cage=cage)


# ---- the chisel arms (left; the right is the mirror) -------------------------------------------------------------------
AX = 0.31


def arm_steps(V, steps, h=0.004):
    s = 0.0
    for v0, dr in steps:
        s = s + dr * sstep(v0 - h, v0 + h, V)
    return s


def forged_relief(seed, rings=(), steps=()):
    def relief(U, V, P, N):
        th = U * TAU
        y = P[..., 1]
        ham = fbm3(P[..., 0], P[..., 1] * 0.6, P[..., 2], 90.0, seed, 2)
        d = 0.0005 * ham
        # hammer facets: flats along the bar
        d = d - 0.0007 * np.abs(np.sin(th * 4 + 0.3 * vnoise3(y, 0, 0, 20, seed + 1)))
        edge = np.zeros(np.shape(V))
        rust = np.zeros(np.shape(V))
        for yr in rings:
            ri = g1(y, yr, 0.004)
            # rivets round the ring
            riv = ri * cl(np.cos(th * 6) * 4 - 3)
            d = d + 0.0018 * riv
            edge = np.maximum(edge, g1(y, yr + 0.009, 0.002) + g1(y, yr - 0.009, 0.002))
            rust = np.maximum(rust, g1(y, yr - 0.012, 0.006) * 0.6)
        for ys in steps:
            edge = np.maximum(edge, g1(y, ys, 0.0025))
            rust = np.maximum(rust, g1(y, ys - 0.006, 0.004) * 0.5)
        edge = np.maximum(edge, cl(np.abs(np.cos(th * 4)) * 6 - 5.2) * 0.6)  # worn octagon arrises
        return d, dict(edge=edge, rust=rust)
    return relief


def arm_parts():
    parts = []
    # upper arm: 2.53 -> 1.88, an octagonal forged bar with two hand-cut steps (hidden in the sleeve until it spreads)
    st_u = [(0.3, -0.004), (0.72, -0.004)]

    def ra_u(V, th):
        return cap_r(V, lerp(0.042, 0.034, V) + arm_steps(V, st_u), 0.0, 0.0)
    cu = Curve([(AX, 2.535, 0), (AX, 1.875, 0)], up=(0, 0, 1))
    parts.append(Part("armU", sweep_fn(cu, ra_u, shape=octagon), {0: (8, 12), 1: (6, 5), 2: (4, 2)}, "iron", "upperArmL", uvw=1.3,
                      relief=forged_relief(101, rings=(2.36,), steps=(2.535 - 0.66 * 0.3, 2.535 - 0.66 * 0.72)), paint=iron_paint_fn(111)))
    # forearm: a cup round the elbow ball, then three segments with rivetted rings and stepped ends
    st_f = [(0.06, -0.012), (0.33, 0.003), (0.36, -0.003), (0.64, 0.003), (0.67, -0.003), (0.94, 0.004)]

    def ra_f(V, th):
        base = lerp(0.035, 0.027, V) + arm_steps(V, st_f, 0.006)
        cup = 0.059 * np.sqrt(np.clip(1 - ((V - 0.0) / 0.075) ** 2, 0, 1))
        return np.maximum(base, cup) * np.where(V < 0.004, 0.75, 1.0)
    cf = Curve([(AX, 1.875, 0), (AX, 1.175, 0)], up=(0, 0, 1))
    yr = [1.875 - 0.7 * 0.345, 1.875 - 0.7 * 0.655]
    parts.append(Part("armF", sweep_fn(cf, ra_f, shape=octagon), {0: (8, 24), 1: (6, 11), 2: (4, 5)}, "iron", "foreArmL", uvw=1.3,
                      relief=forged_relief(102, rings=yr, steps=(1.875 - 0.7 * 0.06, 1.875 - 0.7 * 0.94)), paint=iron_paint_fn(112)))
    # the ball joints, centred on the pivots (they turn into themselves: no pinch); the wrist's is inside the chisel's dome
    for nm, c, r, bone, res in (("ballS", BPOS["upperArmL"], 0.054, "upperArmL", {0: (8, 6), 1: (6, 4), 2: None}),
                                ("ballE", BPOS["foreArmL"], 0.05, "upperArmL", {0: (10, 7), 1: (6, 4), 2: (4, 3)})):
        parts.append(Part(nm, ellipsoid_fn(c, r, r, r), res, "iron", bone, uvw=1.2, relief=forged_relief(103), paint=iron_paint_fn(113)))
    # the chisel: a dome round the wrist pivot (it turns into itself), a stepped shoulder, then the long flat blade (fuller, bevel,
    # honed edge, the cutting edge slanted)
    yT, yB = 1.197, 0.22

    def blade_fn(U, V):
        th = U * TAU
        y = lerp(yT, yB, V)
        t = np.clip((1.12 - y) / (1.12 - yB), 0, 1)
        k = np.clip((y - 1.12) / 0.03, 0, 1)
        w_b = lerp(0.05, 0.03, t) * (1 + 0.12 * g1(t, 0.45, 0.025)) + 0.012 * sstep(0.03, 0.0, t)
        t_b = lerp(0.019, 0.009, t) * (1 - 0.82 * sstep(0.8, 1.0, t)) + 0.01 * sstep(0.03, 0.0, t)
        dome = np.sqrt(np.clip(0.047 ** 2 - np.clip(y - 1.15, 0, None) ** 2, 0, None))
        w = np.maximum(lerp(w_b, dome, k), 1e-5)
        thk = np.maximum(lerp(t_b, dome, k), 1e-5)
        n = lerp(6.0, 2.0, k)
        ct, stt = np.cos(th), np.sin(th)
        rr = np.power(np.power(np.abs(ct) / w, n) + np.power(np.abs(stt) / thk, n), -1 / n)
        slant = 0.05 * sstep(0.82, 1.0, t)
        x = ct * rr
        return stack3(AX + x, y - slant * 0.5 * x / w, stt * rr)

    def blade_relief(U, V, P, N):
        th = U * TAU
        y = P[..., 1]
        t = np.clip((1.12 - y) / (1.12 - yB), 0, 1)
        flat = np.abs(np.sin(th)) > 0.7
        fuller = flat * g1(np.cos(th), 0, 0.12) * sstep(0.05, 0.12, t) * sstep(0.7, 0.55, t)
        ham = fbm3(P[..., 0] * 3, P[..., 1], P[..., 2] * 3, 60.0, 121, 2)
        d = -0.0016 * fuller + 0.0005 * ham * (t > 0)
        edge = cl(sstep(0.78, 0.95, t) + g1(y, 1.12, 0.004) + 0.7 * cl(np.abs(np.cos(th)) * 8 - 7.2))
        rust = cl(fbm3(P[..., 0], P[..., 1], P[..., 2], 9.0, 122, 3) * 2 - 0.7) * (1 - edge) * 0.7
        return d, dict(edge=edge, rust=rust)
    bl = Part("blade", blade_fn, {0: (8, 18), 1: (6, 9), 2: (4, 5)}, "iron", "chiselL", uvw=1.1, relief=blade_relief,
              paint=iron_paint_fn(123), cage=0.008)
    bl.vwarp = warp_fn([(0.03, 0.04, 5.0), (0.97, 0.04, 2.0)])
    parts.append(bl)
    return parts


# ---- the sleeves (left) -------------------------------------------------------------------------------------------------
def sleeve_fn(U, V):
    th = U * TAU
    rag = 0.05 * pnoise(th, 7, 0.9, 7) + 0.12 * np.power(np.maximum(0, pnoise(th, 8, 1.4, 8)), 1.5)
    y = lerp(2.58, 2.06 - rag, V)
    r = lerp(0.068, 0.108, np.power(V, 0.8)) * (1 + 0.12 * np.sin(th * 5 + V * 3) + 0.05 * np.sin(th * 11 + 1))
    return stack3(AX + np.sin(th) * r - 0.012 * V, y, np.cos(th) * r * 0.85 - 0.015 * V)


def sleeve_relief(U, V, P, N):
    th = U * TAU
    d = 0.0015 * np.sin(th * 17 + V * 9 + 2 * pnoise(th, V * 3, 1.5, 71)) + 0.001 * pfbm(th, V * 3, 5.0, 72, 3)
    d = d + 0.0018 * sstep(0.9, 1.0, V) * pnoise(th, V * 20, 6.0, 73)
    return d, {}


def sleeve_paint(U, V, P, N, m):
    th = U * TAU
    n1 = pfbm(th, V * 2, 2.0, 74, 3)
    alb = WOOL * (0.85 + 0.25 * n1)[..., None]
    up = cl(N[..., 1] * 1.5 - 0.3) * sstep(2.3, 2.5, P[..., 1])
    dust = cl(up * (0.4 + 0.7 * pfbm(th, V * 5, 3.0, 75, 3)))
    alb = mix3(alb, CHALK, dust * 0.6)
    return dict(alb=alb, rough=cl(0.8 - 0.1 * n1 + 0.1 * dust), glow=0 * n1)


def sleeve_skin(P, U=None, V=None):
    W = Wz(len(P))
    t = sstep(2.6, 2.36, P[:, 1])
    W[:, B["upperArmL"]] += 0.35 + 0.65 * t
    W[:, B["chest"]] += 0.65 * (1 - t)
    return W


# ---- the small arms and hands (left; the right mirrors) -----------------------------------------------------------------
SX = 0.12


def wrap_relief(seed, pitch=0.011):
    def relief(U, V, P, N):
        th = U * TAU
        y = P[..., 1]
        ph = np.mod(y / pitch + th / TAU * 0.35 + 0.03 * vnoise3(y, 0, 0, 30, seed), 1.0)
        band = sstep(0.0, 0.08, ph) * sstep(1.0, 0.85, ph)
        d = 0.0011 * band - 0.0006 + 0.0004 * fbm3(P[..., 0], P[..., 1], P[..., 2], 300.0, seed + 1, 2)
        return d, dict(band=band, gap=1 - band)
    return relief


def wrap_paint(U, V, P, N, m):
    n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 25.0, 81, 3)
    alb = LINEN * (0.75 + 0.35 * n1)[..., None]
    stain = cl(fbm3(P[..., 0], P[..., 1], P[..., 2], 14.0, 82, 3) * 2.5 - 0.6)
    alb = mix3(alb, np.array([0.06, 0.035, 0.03]), stain * 0.7)
    alb = alb * (1 - 0.45 * m.get("gap", 0 * n1))[..., None]
    return dict(alb=alb, rough=cl(0.85 - 0.3 * stain), glow=0 * n1)


def hand_parts():
    parts = []
    # the small arm: upper (2.08 -> 1.81) and fore (1.81 -> 1.585), wrapped; blended at its elbow
    c = Curve([(SX, 2.08, 0.17), (SX, 1.945, 0.17), (SX, 1.81, 0.17), (SX, 1.70, 0.172), (SX, 1.585, 0.175)])

    def ra(V, th):
        return cap_r(V, lerp(0.021, 0.0165, V) * (1 + 0.12 * g1(V, 0.5, 0.06)), 0.05, 0.0)
    parts.append(Part("smallArm", sweep_fn(c, ra), {0: (8, 14), 1: (6, 7), 2: (4, 4)}, "wrap", blend_y("smallUpperL", "smallForeL", 1.785, 1.835),
                      uvw=2.0, relief=wrap_relief(91), paint=wrap_paint))
    # the hand: palm hanging from the wrist, fingers curled toward the other hand (the line runs between them at y 1.53, z 0.2)
    W0 = np.array([SX, 1.588, 0.176])
    ax = np.array([0.0, -1.0, 0.18])
    ax /= np.linalg.norm(ax)
    pn = np.array([-1.0, 0.0, 0.0])  # the palm faces the other hand
    wd = np.cross(ax, pn)
    wd /= np.linalg.norm(wd)
    K = W0 + ax * 0.042
    cpalm = Curve([W0 - ax * 0.004, W0 + ax * 0.02, K + ax * 0.004])

    def ra_p(V, th):
        return cap_r(V, lerp(0.011, 0.0135, V), 0.12, 0.18)

    def rb_p(V, th):
        return cap_r(V, lerp(0.0062, 0.0058, V), 0.12, 0.18)
    cpalm2 = Curve([W0 - ax * 0.004, W0 + ax * 0.02, K + ax * 0.004], up=tuple(wd))
    parts.append(Part("palm", sweep_fn(cpalm2, ra_p, rb_p), {0: (8, 6), 1: (6, 4), 2: (4, 3)}, "skin", "smallForeL", uvw=2.4,
                      relief=wrap_relief(92, 0.008), paint=hand_paint))
    digits = [  # (offset across the palm, length, curl)
        (-0.0085, 0.050, 1.0),
        (0.0, 0.056, 1.1),
        (0.0085, 0.048, 0.95),
    ]
    for k, (o, L, cu) in enumerate(digits):
        b0 = K + wd * o
        p1 = b0 + ax * L * 0.42 + pn * 0.002
        p2 = p1 + ax * L * 0.28 * (1 - 0.3 * cu) + pn * L * 0.22 * cu
        p3 = p2 + ax * L * 0.08 + pn * L * 0.26 * cu
        cdg = Curve([b0, p1, p2, p3])

        def ra_d(V, th):
            return cap_r(V, lerp(0.0047, 0.0031, V) * (1 + 0.14 * g1(V, 0.42, 0.04) + 0.12 * g1(V, 0.7, 0.04)), 0.0, 0.1)
        parts.append(Part(f"finger{k}", sweep_fn(cdg, ra_d), {0: (6, 8), 1: (4, 4), 2: None}, "skin", "smallForeL", uvw=2.6,
                          relief=finger_relief, paint=hand_paint))
    # the thumb, from the palm's root, curling across
    t0 = W0 + ax * 0.016 + pn * 0.006 + wd * -0.011
    t1 = t0 + ax * 0.02 + pn * 0.012 + wd * -0.002
    t2 = t1 + ax * 0.018 + pn * 0.01 + wd * 0.008
    ct = Curve([t0, t1, t2])

    def ra_t(V, th):
        return cap_r(V, lerp(0.0055, 0.0034, V), 0.0, 0.12)
    parts.append(Part("thumb", sweep_fn(ct, ra_t), {0: (6, 7), 1: (4, 4), 2: None}, "skin", "smallForeL", uvw=2.6, relief=finger_relief, paint=hand_paint))
    return parts


def finger_relief(U, V, P, N):
    th = U * TAU
    knk = g1(V, 0.42, 0.03) + g1(V, 0.7, 0.03)
    wrap = sstep(0.55, 0.45, V)
    ph = np.mod(V * 7 + th / TAU * 0.4, 1.0)
    band = wrap * sstep(0.0, 0.1, ph) * sstep(1.0, 0.82, ph)
    nail = sstep(0.8, 0.86, V) * cl(np.cos(th - np.pi) * 3 - 1.2)
    wr = 0.0004 * np.sin(V * 300) * knk
    return 0.0008 * band + wr + 0.0004 * nail, dict(band=band, gap=wrap * (1 - band), nail=nail, wrap=wrap, tip=sstep(0.75, 1.0, V))


def hand_paint(U, V, P, N, m):
    n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 60.0, 83, 3)
    alb = SKIN * (0.85 + 0.25 * n1)[..., None]
    alb = mix3(alb, np.array([0.11, 0.09, 0.1]), cl(m.get("tip", 0 * n1)) * 0.6)  # livid tips
    wrapk = cl(m.get("wrap", m.get("band", 0 * n1) * 0 + 1))
    lin = mix3(LINEN * (0.75 + 0.35 * n1)[..., None], np.array([0.06, 0.035, 0.03]), cl(fbm3(P[..., 0], P[..., 1], P[..., 2], 30.0, 84, 2) * 2 - 0.5) * 0.6)
    lin = lin * (1 - 0.45 * cl(m.get("gap", 0 * n1)))[..., None]
    alb = mix3(alb, lin, wrapk)
    alb = mix3(alb, np.array([0.03, 0.025, 0.025]), cl(m.get("nail", 0 * n1)))
    rough = lerp(0.5, 0.85, wrapk) - 0.15 * cl(m.get("nail", 0 * n1))
    return dict(alb=alb, rough=cl(rough), glow=0 * n1)


def spool_part():
    c = np.array([0.114, 1.531, 0.19])

    def prof(V):
        h = lerp(-0.019, 0.019, V)
        fl = np.maximum(g1(V, 0.08, 0.06), g1(V, 0.92, 0.06))
        r = 0.0115 + 0.0075 * fl
        r = r * np.sqrt(np.clip(1 - ((np.abs(V - 0.5) - 0.47) / 0.03).clip(0, None) ** 2, 0, 1))
        return r, h

    def relief(U, V, P, N):
        mid = (V > 0.15) & (V < 0.85)
        th = U * TAU
        wnd = mid * (0.0004 * np.sin(V * 520 + th * 0.5))
        return wnd, dict(line=mid * 1.0)

    def paint(U, V, P, N, m):
        n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 80.0, 85, 2)
        alb = mix3(WOOD * (0.8 + 0.4 * n1)[..., None], np.array([0.5, 0.48, 0.42]), m["line"] * 0.9)
        return dict(alb=alb, rough=cl(0.7 - 0.1 * m["line"]), glow=0 * n1)
    return lathe_part("spool", c, (0, 0, 1), prof, {0: (12, 8), 1: (8, 5), 2: (5, 3)}, "wood", "smallForeL", uvw=2.5, relief=relief, paint=paint)


# ---- the feet (left; the right mirrors) ---------------------------------------------------------------------------------
FX0 = 0.12


def skin_paint_fn(seed):
    def paint(U, V, P, N, m):
        n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 40.0, seed, 3)
        alb = SKIN * (0.85 + 0.25 * n1)[..., None]
        dirt = sstep(0.06, 0.0, P[..., 1]) * 0.7 + cl(m.get("dirt", 0 * n1))
        alb = mix3(alb, GRIME * 0.8, cl(dirt))
        alb = mix3(alb, np.array([0.11, 0.09, 0.1]), cl(m.get("livid", 0 * n1)) * 0.5)
        alb = mix3(alb, np.array([0.025, 0.022, 0.02]), cl(m.get("nail", 0 * n1)))
        return dict(alb=alb, rough=cl(0.5 + 0.15 * n1 + 0.2 * cl(dirt)), glow=0 * n1)
    return paint


def foot_parts():
    parts = []
    cs = Curve([(FX0, 0.8, 0.0), (FX0, 0.45, 0.012), (FX0, 0.1, 0.0)])

    def ra_s(V, th):
        r = lerp(0.05, 0.034, V) * (1 + 0.1 * np.cos(th) * sstep(0.1, 0.4, V))
        return cap_r(V, r, 0.04, 0.0)

    def shin_relief(U, V, P, N):
        th = U * TAU
        tib = g1(np.cos(th), 1, 0.15)
        return 0.002 * tib + 0.0006 * fbm3(P[..., 0], P[..., 1], P[..., 2], 80.0, 131, 2), dict(dirt=sstep(0.6, 1.0, V) * 0.4)
    parts.append(Part("shin", sweep_fn(cs, ra_s), {0: (8, 8), 1: (6, 4), 2: (4, 2)}, "skin", blend_y("shinL", "footL", 0.07, 0.14), uvw=1.2,
                      relief=shin_relief, paint=skin_paint_fn(132)))
    # the foot: heel -> instep -> the ball, a loft of flattened sections
    cf = Curve([(FX0, 0.045, -0.06), (FX0, 0.05, 0.03), (FX0, 0.035, 0.15), (FX0, 0.025, 0.205)], up=(0, 1, 0))

    def ra_f(V, th):  # height (along the curve normal = up), the sole flatter
        r = interp(V, [(0, 0.032), (0.3, 0.036), (0.7, 0.022), (1.0, 0.014)])
        return cap_r(V, r * np.where(np.cos(th) < 0, 0.55, 1.0), 0.16, 0.12)

    def rb_f(V, th):  # half width
        return cap_r(V, interp(V, [(0, 0.03), (0.35, 0.034), (0.8, 0.046), (1.0, 0.045)]), 0.16, 0.12)

    def foot_relief(U, V, P, N):
        th = U * TAU
        tend = sum(g1(np.sin(th) - k, 0, 0.06) for k in (-0.5, -0.2, 0.1, 0.4)) * sstep(0.2, 0.5, V) * (np.cos(th) > 0)
        return 0.0016 * tend + 0.0006 * fbm3(P[..., 0], P[..., 1], P[..., 2], 90.0, 133, 2), dict(dirt=(np.cos(th) < -0.3) * 0.6)
    parts.append(Part("foot", sweep_fn(cf, ra_f, rb_f), {0: (10, 12), 1: (8, 6), 2: (6, 4)}, "skin", "footL", uvw=1.4,
                      relief=foot_relief, paint=skin_paint_fn(134)))
    for k, (o, L) in enumerate(((-0.03, 0.105), (-0.01, 0.12), (0.01, 0.112), (0.029, 0.09))):
        b0 = np.array([FX0 + o, 0.028, 0.19])
        p1 = b0 + np.array([o * 0.25, 0.012, L * 0.4])
        p2 = p1 + np.array([o * 0.15, -0.008, L * 0.35])
        p3 = p2 + np.array([o * 0.1, -0.022, L * 0.25])
        ct = Curve([b0, p1, p2, p3], up=(0, 1, 0))

        def ra_t(V, th, L=L):
            return cap_r(V, lerp(0.0105, 0.0065, V) * (1 + 0.15 * g1(V, 0.45, 0.05) + 0.12 * g1(V, 0.75, 0.05)), 0.0, 0.1)

        def toe_relief(U, V, P, N):
            th = U * TAU
            nail = sstep(0.8, 0.86, V) * cl(np.cos(th) * 3 - 1.0)
            return 0.0005 * nail + 0.0004 * np.sin(V * 260) * (g1(V, 0.45, 0.04) + g1(V, 0.75, 0.04)), dict(nail=nail, livid=sstep(0.7, 1.0, V), dirt=(np.cos(th) < -0.4) * 0.5)
        parts.append(Part(f"toe{k}", sweep_fn(ct, ra_t), {0: (6, 6), 1: (4, 3), 2: None}, "skin", "footL", uvw=1.8, relief=toe_relief,
                          paint=skin_paint_fn(135 + k)))
    return parts


# ---- tools on the belt ----------------------------------------------------------------------------------------------
def tool_parts():
    parts = []
    hipR = mixw(("skirtR1", 0.7), ("hips", 0.3))
    hipL = mixw(("skirtL1", 0.75), ("hips", 0.25))
    frontL = mixw(("skirtF1", 0.5), ("hips", 0.5))
    # the mallet at the right hip: a worn handle, a heavy wooden head bound with an iron hoop
    parts.append(tube_part("malletH", [(-0.205, 1.73, 0.12), (-0.218, 1.55, 0.135), (-0.228, 1.37, 0.15)], 0.013, 0.015, {0: (6, 8), 1: (5, 4), 2: (4, 2)},
                           "wood", hipR, uvw=1.5, cap=(0.05, 0.0), paint=wood_paint, relief=lambda U, V, P, N: (0.0004 * np.sin(V * 90), dict(worn=g1(V, 0.6, 0.2)))))

    def mprof(V):
        h = lerp(-0.058, 0.058, V)
        r = 0.038 * np.sqrt(np.clip(1 - (np.clip(np.abs(V - 0.5) - 0.44, 0, None) / 0.06) ** 2, 0, 1)) * (1 + 0.04 * g1(np.abs(V - 0.5), 0.3, 0.04))
        return r, h

    def mrel(U, V, P, N):
        hoop = g1(np.abs(V - 0.5), 0.3, 0.035)
        return 0.0015 * hoop + 0.0008 * fbm3(P[..., 0], P[..., 1] * 3, P[..., 2], 50.0, 141, 2), dict(hoop=hoop, worn=sstep(0.42, 0.5, np.abs(V - 0.5)))

    def mpaint(U, V, P, N, m):
        d = wood_paint(U, V, P, N, m)
        d["alb"] = mix3(d["alb"], IRON * 1.1, m["hoop"])
        return d
    parts.append(lathe_part("malletB", (-0.232, 1.335, 0.155), (0.15, 0, 1), mprof, {0: (12, 8), 1: (8, 5), 2: (6, 3)}, "wood", hipR, uvw=1.5,
                            relief=mrel, paint=mpaint))
    # two mason's chisels in leather loops, front left, blades down
    for k, (x, z) in enumerate(((0.075, 0.205), (0.118, 0.19))):
        parts.append(tube_part(f"chis{k}H", [(x, 1.83, z + 0.01), (x + 0.004, 1.76, z + 0.012), (x + 0.006, 1.70, z + 0.012)], 0.011, 0.012, {0: (6, 6), 1: (5, 3), 2: None},
                               "wood", frontL, uvw=1.4, cap=(0.15, 0.0), paint=wood_paint))

        def cbl(U, V, x=x, z=z):
            th = U * TAU
            y = lerp(1.705, 1.57, V)
            w = lerp(0.008, 0.013, V)
            t = lerp(0.006, 0.0015, V ** 2)
            n = 4.0
            ct, st = np.cos(th), np.sin(th)
            rr = np.power(np.power(np.abs(ct) / w, n) + np.power(np.abs(st) / t, n), -1 / n)
            return stack3(x + 0.006 + ct * rr, y, z + 0.012 + st * rr)
        parts.append(Part(f"chis{k}B", cbl, {0: (6, 5), 1: (4, 3), 2: None}, "iron", frontL, uvw=1.4,
                          relief=lambda U, V, P, N: (0.0003 * np.sin(V * 50), dict(edge=sstep(0.7, 1.0, V))), paint=iron_paint_fn(151)))
    # a leather loop holding them on the belt
    parts.append(tube_part("loop", [(0.05, 1.70, 0.22), (0.1, 1.69, 0.225), (0.15, 1.70, 0.205)], 0.008, 0.008, {0: (6, 6), 1: (4, 3), 2: None},
                           "leather", frontL, uvw=1.3, cap=(0.0, 0.0), paint=belt_paint, relief=lambda U, V, P, N: (0 * V, dict(stitch=0 * V, hole=0 * V)),
                           shape=lambda th: 1.0 + 0.0 * th))
    # the plumb bob on its cord at the left hip
    parts.append(tube_part("cord", [(0.2, 1.72, 0.125), (0.214, 1.5, 0.135), (0.22, 1.29, 0.14)], 0.0028, 0.0028, {0: (4, 12), 1: (3, 6), 2: (3, 3)},
                           "cord", hipL, uvw=1.2, cap=(0.0, 0.0), paint=lambda U, V, P, N, m: dict(alb=np.array([0.3, 0.27, 0.21]) * (0.8 + 0.3 * np.sin(V * 400 + U * TAU)[..., None]), rough=0.8 + 0 * V, glow=0 * V),
                           relief=lambda U, V, P, N: (0.0004 * np.sin(V * 900 + U * TAU), {})))

    def bprof(V):
        h = lerp(0.03, -0.085, V)
        r = interp(V, [(0, 0.0), (0.04, 0.007), (0.12, 0.008), (0.16, 0.022), (0.45, 0.028), (0.75, 0.018), (0.97, 0.004), (1.0, 0.0)])
        return r, h

    def bpaint(U, V, P, N, m):
        n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 40.0, 161, 3)
        alb = BRASS * (0.8 + 0.35 * n1)[..., None]
        alb = mix3(alb, np.array([0.05, 0.07, 0.055]), cl(n1 * 2 - 0.3) * 0.6)  # verdigris
        alb = mix3(alb, BRASS * 2.2, cl(m.get("edge", 0 * n1)) * 0.6)
        return dict(alb=alb, rough=cl(0.38 + 0.25 * n1), glow=0 * n1)
    parts.append(lathe_part("plumb", (0.22, 1.29, 0.14), (0, 1, 0), bprof, {0: (10, 10), 1: (8, 6), 2: (6, 4)}, "brass", hipL, uvw=1.5,
                            relief=lambda U, V, P, N: (0.0004 * np.sin(V * 120), dict(edge=g1(V, 0.45, 0.05))), paint=bpaint))
    # the buckle (an iron frame) on the belt, front left
    bq = np.asarray(apron_point(np.array(0.42), np.array(1.74), off=0.016)[0]).reshape(3)

    def bfn(U, V):
        th = U * TAU
        a = V * TAU
        ct, st = np.cos(a), np.sin(a)
        n = 5.0
        rr = np.power(np.power(np.abs(ct) / 0.026, n) + np.power(np.abs(st) / 0.024, n), -1 / n)
        return stack3(bq[0] + ct * rr + 0.0035 * np.cos(th) * ct, bq[1] + st * rr + 0.0035 * np.cos(th) * st, bq[2] + 0.0035 * np.sin(th))
    parts.append(Part("buckle", bfn, {0: (6, 16), 1: (4, 8), 2: None}, "iron", mixw(("hips", 0.6), ("spine", 0.4)), uvw=1.4,
                      relief=forged_relief(171), paint=iron_paint_fn(172)))
    # the apron straps up to the shoulders (under the hood's drape)
    for k, sgn in enumerate((1, -1)):
        q, _ = apron_point(np.array(sgn * 0.82), np.array(2.29))
        q = np.asarray(q).reshape(3)
        pts = [tuple(q), (sgn * 0.115, 2.42, q[2] - 0.02), (sgn * 0.12, 2.56, 0.07)]

        def flat(th):
            return 1.0 + 0.0 * th
        c = Curve(pts, up=(0, 0, 1))

        def ra_s(V, th):
            return 0.017 + 0 * V

        def rb_s(V, th):
            return 0.0035 + 0 * V
        parts.append(Part(f"strap{k}", sweep_fn(c, ra_s, rb_s), {0: (4, 8), 1: (4, 4), 2: None}, "leather", torso_weights, uvw=1.3,
                          relief=lambda U, V, P, N: (0 * V, dict(stitch=0 * V, hole=0 * V)), paint=belt_paint, cage=0.008))
    return parts


# ---- the hood void and the tatters --------------------------------------------------------------------------------
def void_part():
    def paint(U, V, P, N, m):
        return dict(alb=np.zeros(np.shape(U) + (3,)) + 0.004, rough=0.9 + 0 * U, glow=0 * U)
    return Part("void", ellipsoid_fn((0, 2.94, -0.045), 0.155, 0.245, 0.125), {0: (12, 8), 1: (10, 6), 2: (8, 5)}, "void", "head", uvw=0.15,
                paint=paint)


TATTERS = [(0.35, 0.42, 0.36, 0), (1.4, 0.38, 0.33, 1), (2.3, 0.5, 0.45, 2), (3.3, 0.36, 0.3, 3), (4.4, 0.46, 0.4, 4), (5.5, 0.4, 0.34, 5)]


def tatter_parts():
    parts = []
    for i, (th0, y0, ln, k) in enumerate(TATTERS):
        tx, tz = math.cos(th0), -math.sin(th0)

        def fn(U, V, th0=th0, tx=tx, tz=tz, ln=ln, k=k, y0=y0):
            # strips torn from the robe, hanging along it (outside its folds) and stopping short of the wall it stands on
            w = 0.024 * (1 - 0.55 * V) * (1 + 0.2 * np.sin(V * 9 + k))
            s = U * 2 - 1
            y = y0 + 0.02 - (ln + 0.02) * V
            q = robe_xyz(th0, y, robeR(y) * 1.1 + 0.012 + 0.012 * V)
            return stack3(q[..., 0] + tx * s * w, y, q[..., 2] + tz * s * w + 0.006 * np.sin(V * 4 + k))

        def skin(P, U=None, V=None):
            Q = P.copy()
            Q[:, 1] = np.minimum(Q[:, 1], 0.5)
            return skirt_weights(Q)
        parts.append(Part(f"tatter{i}", fn, {0: (2, 6), 1: (1, 4), 2: None}, "cloth", skin, uvw=0.8, orient=1,
                          relief=lambda U, V, P, N: (0.0012 * np.sin(V * 60 + U * 4), {}), paint=robe_strip_paint))
    return parts


def robe_strip_paint(U, V, P, N, m):
    n1 = fbm3(P[..., 0], P[..., 1], P[..., 2], 20.0, 191, 3)
    alb = WOOL * (0.6 + 0.25 * n1)[..., None]
    return dict(alb=alb, rough=cl(0.45 + 0.2 * n1), glow=0 * n1)


# ---- all parts ------------------------------------------------------------------------------------------------------
def make_parts():
    parts = []
    parts.append(Part("robe", robe_fn, {0: (64, 38), 1: (36, 22), 2: (18, 11)}, "cloth", torso_weights, uvw=0.75, relief=robe_relief,
                      paint=robe_paint, cage=0.015))
    hood = Part("hood", hood_fn, {0: (48, 34), 1: (28, 19), 2: (14, 10)}, "cloth", hood_weights, uvw=1.15, relief=hood_relief, paint=hood_paint,
                fx=hood_fx, cage=0.015)
    hood.vwarp = warp_fn([(0.05, 0.05, 1.5), (0.13, 0.04, 3.0)])
    parts.append(hood)
    parts.append(Part("mantle", mantle_fn, {0: (44, 14), 1: (24, 8), 2: (12, 4)}, "cloth", mantle_skin, uvw=1.1, relief=mantle_relief,
                      paint=mantle_paint, cage=0.015))
    parts.append(void_part())
    parts.append(mask_part(1))
    parts.append(mask_part(-1))
    parts.append(Part("apron", apron_fn, {0: (14, 30), 1: (8, 15), 2: (5, 8)}, "leather",
                      lambda P, U=None, V=None: apron_skin(P), uvw=1.4, relief=apron_relief, paint=apron_paint, cage=0.01))
    parts.append(Part("pocket", pocket_fn, {0: (8, 6), 1: (4, 3), 2: None}, "leather", lambda P, U=None, V=None: apron_skin(P), uvw=1.5,
                      relief=pocket_relief, paint=pocket_paint, cage=0.008))
    parts.append(Part("belt", belt_fn, {0: (48, 6), 1: (28, 4), 2: (16, 2)}, "leather", mixw(("hips", 0.6), ("spine", 0.4)), uvw=1.4,
                      relief=belt_relief, paint=belt_paint, cage=0.008))
    left = []
    left += arm_parts()
    sl = Part("sleeve", sleeve_fn, {0: (16, 9), 1: (10, 5), 2: (8, 3)}, "cloth", sleeve_skin, uvw=1.0, relief=sleeve_relief, paint=sleeve_paint, cage=0.012)
    left.append(sl)
    left += hand_parts()
    left += foot_parts()
    for p in left:
        parts.append(p)
        parts.append(mirror(p, p.name + "_R", swapLR))
    parts.append(spool_part())
    parts += tool_parts()
    parts += tatter_parts()
    # tatters share one rectangle
    for p in parts:
        if p.name.startswith("tatter") and p.name != "tatter0":
            p.mirror_of = "tatter0"
    return parts


def apron_skin(P):
    y = P[:, 1]
    W = torso_weights(P)
    mid = (y <= 1.56) & (y > 1.3)
    t = sstep(1.3, 1.56, y)
    W2 = Wz(len(P))
    W2[:, B["hips"]] = t
    W2[:, B["skirtF1"]] = 1 - t
    W[mid] = W2[mid]
    lo = y <= 1.3
    Q = P.copy()
    Q[:, 0] = 0
    Q[:, 2] = 1
    W[lo] = skirt_weights(Q)[lo]
    return W


# =====================================================================================================================
# GRIDS -> MESHES
# =====================================================================================================================
def grid_eval(part, nu, nv):
    tu = np.linspace(0, 1, nu + 1)
    tv = np.linspace(0, 1, nv + 1)
    if getattr(part, "ucols", None):
        U1 = part.ucols(nu)
    else:
        U1 = part.uwarp(tu) if getattr(part, "uwarp", None) else tu
    if getattr(part, "vrows", None):
        V1 = part.vrows(nv)
    else:
        V1 = part.vwarp(tv) if getattr(part, "vwarp", None) else tv
    UU, VV = np.meshgrid(U1, V1)
    P = part.fn(UU, VV)
    return UU, VV, P


def grid_quads(nu, nv, flip):
    idx = np.arange((nv + 1) * (nu + 1)).reshape(nv + 1, nu + 1)
    a, b, c, d = idx[:-1, :-1], idx[:-1, 1:], idx[1:, :-1], idx[1:, 1:]
    q = np.stack([a, b, d, c], -1).reshape(-1, 4)
    return q[:, ::-1].copy() if flip else q


def grid_normals(P, sign):
    du = np.gradient(P, axis=1)
    dv = np.gradient(P, axis=0)
    N = np.cross(du, dv) * sign
    L = np.linalg.norm(N, axis=-1, keepdims=True)
    c = P.reshape(-1, 3).mean(axis=0)
    fb = P - c
    fb = fb / (np.linalg.norm(fb, axis=-1, keepdims=True) + 1e-9)
    return np.where(L > 1e-12, N / np.maximum(L, 1e-12), fb)


def orient(part):
    """+1 when dP/du x dP/dv points outward (from the part's centroid)."""
    if part.orient is not None:
        return float(part.orient)
    nu, nv = part.res[0]
    _, _, P = grid_eval(part, max(nu, 8) * 2, max(nv, 8) * 2)
    N = np.cross(np.gradient(P, axis=1), np.gradient(P, axis=0))
    c = P.reshape(-1, 3).mean(axis=0)
    s = np.sum(N * (P - c))
    return 1.0 if s >= 0 else -1.0


def to_b(P):
    P = np.asarray(P).reshape(-1, 3)
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], -1)


def from_b(Q):
    Q = np.asarray(Q).reshape(-1, 3)
    return np.stack([Q[:, 0], Q[:, 2], -Q[:, 1]], -1)


def fast_mesh(name, P, quads):
    me = bpy.data.meshes.new(name)
    n = len(P)
    nq = len(quads)
    me.vertices.add(n)
    me.vertices.foreach_set("co", to_b(P).ravel().astype(np.float32))
    me.loops.add(nq * 4)
    me.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
    me.polygons.add(nq)
    me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.polygons.foreach_set("loop_total", np.full(nq, 4, dtype=np.int32))
    me.update(calc_edges=True)
    return me


def skin_matrix(part, P, U, V):
    if isinstance(part.skin, str):
        W = Wz(len(P))
        W[:, B[part.skin]] = 1
        return W
    return part.skin(P, U, V)


def top4(W):
    idx = np.argsort(-W, axis=1)[:, :4]
    w = np.take_along_axis(W, idx, 1)
    w = np.where(w > 0.01, w, 0)
    w = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-9)
    return idx, w


def low_object(part, lod, coll):
    """The game mesh of a part at a level of detail: UVs in its atlas rectangle, the skin as vertex groups, FX colours; welded."""
    nu, nv = part.res[lod]
    U, V, P = grid_eval(part, nu, nv)
    Pf = P.reshape(-1, 3)
    Uf, Vf = U.ravel(), V.ravel()
    quads = grid_quads(nu, nv, part.sign < 0)
    x0, y0, w, h = part.rect
    uv = np.stack([x0 + Uf * w, y0 + Vf * h], -1)
    W = skin_matrix(part, Pf, Uf, Vf)
    bi, bw = top4(W)
    if part.fx is not None:
        pale, gl, rim = part.fx(Uf, Vf, Pf)
        fx = np.stack(np.broadcast_arrays(pale, gl, rim, np.ones_like(Uf)), -1)
    else:
        fx = np.zeros((len(Pf), 4))
        fx[:, 3] = 1
    bm = bmesh.new()
    dl = bm.verts.layers.deform.verify()
    fl = bm.verts.layers.float_color.new("FX")
    uvl = bm.loops.layers.uv.new("UVMap")
    Q = to_b(Pf)
    vs = [bm.verts.new(tuple(q)) for q in Q]
    for i, v in enumerate(vs):
        for j in range(4):
            if bw[i, j] > 0:
                v[dl][int(bi[i, j])] = float(bw[i, j])
        v[fl] = tuple(float(c) for c in fx[i])
    for q in quads:
        try:
            f = bm.faces.new([vs[k] for k in q])
        except ValueError:
            continue
        for lp, k in zip(f.loops, q):
            lp[uvl].uv = (float(uv[k, 0]), float(uv[k, 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-7)
    nm = f"{part.name}_L{lod}"
    me = bpy.data.meshes.new(nm)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    ob = bpy.data.objects.new(nm, me)
    coll.objects.link(ob)
    for b in BONES:
        ob.vertex_groups.new(name=b[0])
    me.color_attributes.active_color = me.color_attributes["FX"]
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def high_object(part, coll):
    nu, nv = part.hi
    U, V, P = grid_eval(part, nu, nv)
    N = grid_normals(P, part.sign)
    if part.relief is not None:
        d, _ = part.relief(U, V, P, N)
        P = P + N * np.asarray(d)[..., None]
    quads = grid_quads(nu, nv, part.sign < 0)
    me = fast_mesh("hi_" + part.name, P.reshape(-1, 3), quads)
    me.shade_smooth()
    ob = bpy.data.objects.new("hi_" + part.name, me)
    coll.objects.link(ob)
    return ob


# =====================================================================================================================
# THE ATLAS (rectangles by area x texel weight, shelf-packed; the white block for the line and the chalk outline)
# =====================================================================================================================
WHITE = (0.988, 0.988, 0.012, 0.012)  # (x0, y0, w, h) Blender UV space (pack_atlas places it)


def white_px(res):
    """The white block's pixel slices (rows = v, columns = u), one pixel of margin round it."""
    x0, y0, w, h = WHITE
    return (slice(max(0, int(y0 * res) - 1), int(math.ceil((y0 + h) * res)) + 1), slice(max(0, int(x0 * res) - 1), int(math.ceil((x0 + w) * res)) + 1))


def part_area(part):
    nu, nv = part.res[0]
    U, V, P = grid_eval(part, max(nu, 6) * 2, max(nv, 6) * 2)
    du = np.linalg.norm(np.diff(P, axis=1), axis=-1)
    dv = np.linalg.norm(np.diff(P, axis=0), axis=-1)
    lu = du.sum(axis=1).mean()
    lv = dv.sum(axis=0).mean()
    return lu * lv, lu, lv


def skyline_pack(sizes):
    """Bottom-left skyline packing of [(key, w, h)] (sorted by height) into the unit square; None if it does not fit."""
    sky = [(0.0, 0.0, 1.0)]  # (x, y, w) segments
    out = {}
    for key, w, h in sizes:
        best = None
        for i in range(len(sky)):
            x = sky[i][0]
            if x + w > 1.0 + 1e-9:
                break
            y = 0.0
            wl = w
            j = i
            while wl > 1e-12 and j < len(sky):
                y = max(y, sky[j][1])
                wl -= sky[j][2]
                j += 1
            if y + h > 1.0 + 1e-9:
                continue
            if best is None or (y + h, x) < (best[0], best[1]):
                best = (y + h, x, y)
        if best is None:
            return None
        top, x, y = best
        out[key] = (x, y, w, h)
        # raise the skyline over [x, x + w] to top
        new = []
        for sx, sy, sw in sky:
            a0, a1 = sx, sx + sw
            if a1 <= x + 1e-12 or a0 >= x + w - 1e-12:
                new.append((sx, sy, sw))
                continue
            if a0 < x:
                new.append((a0, sy, x - a0))
            if a1 > x + w:
                new.append((x + w, sy, a1 - (x + w)))
        new.append((x, top, w))
        new.sort()
        merged = []
        for s in new:
            if merged and abs(merged[-1][1] - s[1]) < 1e-12 and abs(merged[-1][0] + merged[-1][2] - s[0]) < 1e-9:
                merged[-1] = (merged[-1][0], merged[-1][1], merged[-1][2] + s[2])
            else:
                merged.append(s)
        sky = merged
    return out


def pack_atlas(parts, res):
    global WHITE
    owners = [p for p in parts if p.mirror_of is None]
    pad = 8.0 / res
    items = []
    for p in owners:
        A, lu, lv = part_area(p)
        asp = max(0.06, min(14.0, lu / max(lv, 1e-6)))
        items.append((p.name, A * p.uvw, asp))
    wb = 16.0 / res

    def try_pack(k):
        sz = [("__white", wb + pad, wb + pad)]
        for name, a, asp in items:
            sz.append((name, math.sqrt(a * asp) * k + pad, math.sqrt(a / asp) * k + pad))
        sz.sort(key=lambda t: (-t[2], -t[1]))
        return skyline_pack(sz)
    lo, hi = 0.01, 20.0
    best = None
    for _ in range(36):
        mid = (lo + hi) * 0.5
        r = try_pack(mid)
        if r is None:
            hi = mid
        else:
            lo = mid
            best = r
    rects = {k: (x + pad * 0.5, y + pad * 0.5, w - pad, h - pad) for k, (x, y, w, h) in best.items()}
    WHITE = rects.pop("__white")
    for p in parts:
        p.rect = rects[p.mirror_of] if p.mirror_of else rects[p.name]
    used = sum(w * h for (_, _, w, h) in rects.values())
    log(f"atlas: {len(owners)} rectangles, {used * 100:.1f}% used, scale {lo:.3f}, white block {tuple(round(v, 4) for v in WHITE)}")
    return rects


# =====================================================================================================================
# ANALYTIC PAINT (albedo, roughness, glow) in UV space, per rectangle
# =====================================================================================================================
def eval_PN(part, U, V):
    P = part.fn(U, V)
    e = 1e-4
    Pu = part.fn(np.clip(U + e, 0, 1), V) - part.fn(np.clip(U - e, 0, 1), V)
    Pv = part.fn(U, np.clip(V + e, 0, 1)) - part.fn(U, np.clip(V - e, 0, 1))
    N = np.cross(Pu, Pv) * part.sign
    L = np.linalg.norm(N, axis=-1, keepdims=True)
    N = np.where(L > 1e-14, N / np.maximum(L, 1e-14), np.array([0.0, 1.0, 0.0]))
    return P, N


def paint_atlas(parts, res):
    alb = np.zeros((res, res, 3), np.float32) + np.array([0.05, 0.045, 0.04], np.float32)
    rough = np.full((res, res), 0.8, np.float32)
    glow = np.zeros((res, res), np.float32)
    owner = np.zeros((res, res), np.int16) - 1
    owners = [p for p in parts if p.mirror_of is None]
    for core in (False, True):
        for k, p in enumerate(owners):
            x0, y0, w, h = p.rect
            padpx = 0 if core else 5
            px0 = max(0, int(math.floor(x0 * res)) - padpx)
            px1 = min(res, int(math.ceil((x0 + w) * res)) + padpx)
            py0 = max(0, int(math.floor(y0 * res)) - padpx)
            py1 = min(res, int(math.ceil((y0 + h) * res)) + padpx)
            xs = (np.arange(px0, px1) + 0.5) / res
            ys = (np.arange(py0, py1) + 0.5) / res
            Uu = np.clip((xs - x0) / w, 0, 1)
            Vv = np.clip((ys - y0) / h, 0, 1)
            UU, VV = np.meshgrid(Uu, Vv)
            # big rectangles in strips (memory)
            for r0 in range(0, UU.shape[0], 256):
                Us, Vs = UU[r0:r0 + 256], VV[r0:r0 + 256]
                P, N = eval_PN(p, Us, Vs)
                if p.relief is not None:
                    _, m = p.relief(Us, Vs, P, N)
                else:
                    m = {}
                out = p.paint(Us, Vs, P, N, m) if p.paint is not None else dict(alb=np.zeros(Us.shape + (3,)) + 0.05, rough=0.8 + 0 * Us, glow=0 * Us)
                a = np.broadcast_to(np.asarray(out["alb"], np.float32), Us.shape + (3,))
                r = np.broadcast_to(np.asarray(out["rough"], np.float32), Us.shape)
                gw = np.broadcast_to(np.asarray(out["glow"], np.float32), Us.shape)
                sl = (slice(py0 + r0, py0 + r0 + Us.shape[0]), slice(px0, px1))
                if core:
                    alb[sl] = a
                    rough[sl] = r
                    glow[sl] = gw
                    owner[sl] = k
                else:
                    free = owner[sl] < 0
                    alb[sl][free] = a[free]
                    rough[sl][free] = r[free]
                    glow[sl][free] = gw[free]
                    owner[sl] = np.where(free, 9999, owner[sl])
        if not core:
            owner[owner == 9999] = -1
    # the white block (the measuring line and the chalk outline sample it; their colours ride in the vertex colour)
    ws = white_px(res)
    alb[ws] = 1.0
    rough[ws] = 1.0
    glow[ws] = 0.0
    return alb, rough, glow, owner >= 0


# =====================================================================================================================
# CLAY RENDERS (stage shape)
# =====================================================================================================================
def setup_cycles(scene, samples, w, h):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.render.film_transparent = False


def add_light(name, kind, loc, energy, color, size=0.1):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "POINT":
        ld.shadow_soft_size = size
    if kind == "AREA":
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    return ob


def cam_at(name, loc_c, tgt_c, lens=35):
    """A camera from creature-frame points."""
    loc = Vector(tuple(to_b(np.array(loc_c))[0]))
    tgt = Vector(tuple(to_b(np.array(tgt_c))[0]))
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.01
    ob = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (tgt - loc).normalized().to_track_quat("-Z", "Y").to_euler()
    return ob


def clay(scene, objs, tag, shots):
    setup_cycles(scene, 20, args.tile, args.tile)
    world = bpy.data.worlds.new("ClayWorld")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.035, 1)
    mat = bpy.data.materials.new("Clay")
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (0.5, 0.46, 0.42, 1)
    bs.inputs["Roughness"].default_value = 0.5
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
    lights = [add_light("K", "AREA", tuple(to_b(np.array([-1.2, 3.6, 2.2]))[0]), 140, (1, 0.95, 0.9), 1.0),
              add_light("F", "AREA", tuple(to_b(np.array([1.5, 2.0, 1.5]))[0]), 40, (0.8, 0.85, 1.0), 1.2),
              add_light("R", "AREA", tuple(to_b(np.array([0.5, 3.4, -1.5]))[0]), 60, (0.7, 0.8, 1.0), 0.8)]
    outs = []
    for nm, loc, tgt, lens in shots:
        cam = cam_at("C" + nm, loc, tgt, lens)
        scene.camera = cam
        fp = os.path.join(RENDER_DIR, f"dresser_clay_{tag}_{nm}.png")
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        outs.append(fp)
    for l in lights:
        bpy.data.objects.remove(l, do_unlink=True)
    log("clay", tag, outs)
    return outs


# =====================================================================================================================
# BAKE (Cycles): tangent normal + fine AO per part (HIGH -> LOD0), global AO of LOD0
# =====================================================================================================================
def _img_np(im):
    a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)


def new_bake_image(name, res):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    im = bpy.data.images.new(name, res, res, alpha=True, float_buffer=True)
    im.colorspace_settings.name = "Non-Color"
    im.generated_color = (0, 0, 0, 0)
    return im


def dilate(img, cov, iters):
    out = img.copy()
    m = cov.copy()
    for _ in range(iters):
        acc = np.zeros_like(out)
        cnt = np.zeros(m.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sm = np.roll(m, (dy, dx), axis=(0, 1))
            so = np.roll(out, (dy, dx), axis=(0, 1))
            acc += so * sm[..., None]
            cnt += sm
        grow = (~m) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
    out[~m] = out[m].mean(axis=0) if m.any() else 0
    return out


def bake_material(img):
    mat = bpy.data.materials.new("LOWBAKE")
    mat.use_nodes = True
    nt = mat.node_tree
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    nt.nodes.active = n
    return mat


def ray_vis(ob, on):
    for a in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
        try:
            setattr(ob, a, on)
        except Exception:
            pass


def bake_parts(parts, low_by, hi_by, res, kind):
    """kind NORMAL | AO (fine, local contact): every owner part from its HIGH onto its LOD0 rectangle, into one image."""
    cpath = os.path.join(CACHE_DIR, f"bake_{kind}_{res}.npy")
    if os.path.exists(cpath):
        log("bake (cached)", kind)
        return np.load(cpath)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.samples = 4 if kind == "NORMAL" else args.bake_samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = 0.02
    img = new_bake_image("bk_" + kind, res)
    mat = bake_material(img)
    all_objs = list(scene.objects)
    t0 = time.time()
    for p in parts:
        if p.mirror_of is not None or p.name not in hi_by:
            continue
        low = low_by[p.name]
        hi = hi_by[p.name]
        low.data.materials.clear()
        low.data.materials.append(mat)
        for o in all_objs:
            o.hide_render = o not in (low, hi)
            o.select_set(False)
        ray_vis(low, kind == "NORMAL")
        hi.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        kw = dict(type=kind, use_selected_to_active=True, cage_extrusion=p.cage, max_ray_distance=p.cage * 3.0, margin=0, use_clear=False,
                  target="IMAGE_TEXTURES")
        if kind == "NORMAL":
            kw.update(normal_space="TANGENT", normal_r="POS_X", normal_g="POS_Y", normal_b="POS_Z")
        bpy.ops.object.bake(**kw)
        ray_vis(low, True)
        low.data.materials.clear()
    for o in all_objs:
        o.hide_render = False
    a = _img_np(img)
    log(f"bake {kind}: {time.time() - t0:.0f}s, {int((a[..., 3] > 0.5).sum())} px")
    np.save(cpath, a)
    bpy.data.images.remove(img)
    bpy.data.materials.remove(mat)
    return a


def bake_global_ao(lod0, res):
    cpath = os.path.join(CACHE_DIR, f"bake_GAO_{res}.npy")
    if os.path.exists(cpath):
        log("bake (cached) GAO")
        return np.load(cpath)
    scene = bpy.context.scene
    scene.cycles.samples = max(32, args.bake_samples * 2)
    scene.world.light_settings.distance = 0.3
    img = new_bake_image("bk_GAO", res)
    mat = bake_material(img)
    lod0.data.materials.clear()
    lod0.data.materials.append(mat)
    for o in scene.objects:
        o.hide_render = o is not lod0
        o.select_set(False)
    lod0.select_set(True)
    bpy.context.view_layer.objects.active = lod0
    t0 = time.time()
    bpy.ops.object.bake(type="AO", use_selected_to_active=False, margin=0, use_clear=True, target="IMAGE_TEXTURES")
    for o in scene.objects:
        o.hide_render = False
    a = _img_np(img)
    log(f"bake GAO: {time.time() - t0:.0f}s")
    np.save(cpath, a)
    lod0.data.materials.clear()
    bpy.data.images.remove(img)
    bpy.data.materials.remove(mat)
    return a


def srgb_encode(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def save_png(arr, path):
    from PIL import Image
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    im.transpose(Image.FLIP_TOP_BOTTOM).save(path)
    return path


def composite(alb, rough, glow, cov, R, res, mask_cov):
    """Albedo darkened by AO and cavities (less on the mask: it must stay pale), ORM = (AO, roughness, glow)."""
    nrm = R["NORMAL"]
    ncov = nrm[..., 3] > 0.5
    n3 = dilate(np.where(ncov[..., None], nrm[..., :3], 0.5), ncov, 24)
    fine = R["AO"]
    fcov = fine[..., 3] > 0.5
    ao_f = dilate(np.where(fcov[..., None], fine[..., :3], 1.0), fcov, 24)[..., 0]
    gao = R["GAO"]
    gcov = gao[..., 3] > 0.5
    ao_g = dilate(np.where(gcov[..., None], gao[..., :3], 1.0), gcov, 24)[..., 0]
    nx = n3[..., 0] * 2 - 1
    ny = n3[..., 1] * 2 - 1
    div = (np.roll(nx, -1, 1) - np.roll(nx, 1, 1)) + (np.roll(ny, -1, 0) - np.roll(ny, 1, 0))
    cav = np.clip(-div * 0.5 * (res / 2048.0), 0, 0.6)
    ao = np.clip(ao_f, 0, 1) * np.clip(0.25 + 0.75 * ao_g, 0, 1)
    k_ao = np.where(mask_cov, 0.45, 0.8)
    occ = 1 - k_ao * (1 - ao)
    a_out = alb * occ[..., None] * (1 - np.where(mask_cov, 0.5, 0.7) * cav)[..., None]
    r_out = np.clip(rough * (1 - 0.15 * cav), 0.08, 1)
    ws = white_px(res)
    a_out[ws] = 1.0
    n3[ws] = (0.5, 0.5, 1.0)
    ao[ws] = 1.0
    r_out[ws] = 1.0
    paths = {
        "albedo": save_png(srgb_encode(a_out), os.path.join(CACHE_DIR, "dresser_albedo.png")),
        "normal": save_png(n3, os.path.join(CACHE_DIR, "dresser_normal.png")),
        "orm": save_png(np.dstack([np.clip(ao, 0, 1), r_out, np.clip(glow, 0, 1)]), os.path.join(CACHE_DIR, "dresser_orm.png")),
    }
    return paths


# =====================================================================================================================
# MATERIALS, ARMATURE, SKIN, EXPORT
# =====================================================================================================================
def gltf_settings_group():
    name = "glTF Material Output"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    g = bpy.data.node_groups.new(name, "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


GLOW_RGB = (0.55, 0.78, 1.0)


def game_material(paths, preview=False):
    mat = bpy.data.materials.new("DresserPreview" if preview else "DresserBody")
    mat.use_nodes = True
    mat.use_backface_culling = False  # glTF doubleSided: the robe, hood, sleeves and tatters are single shells
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])

    def tex(key, cs):
        im = bpy.data.images.load(paths[key], check_existing=True)
        im.colorspace_settings.name = cs
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = im
        return n
    a = tex("albedo", "sRGB")
    nt.links.new(a.outputs["Color"], bsdf.inputs["Base Color"])
    n = tex("normal", "Non-Color")
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    o = tex("orm", "Non-Color")
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(o.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
    if preview:
        bsdf.inputs["Metallic"].default_value = 0.0
        # the runtime's self-light: the pale mask (FX.R x albedo x uPale) + the cold glow of the slits (ORM.B x uGlow)
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "FX"
        sv = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(vc.outputs["Color"], sv.inputs[0])
        m1 = nt.nodes.new("ShaderNodeMix")
        m1.data_type = "RGBA"
        m1.blend_type = "MULTIPLY"
        m1.inputs["Factor"].default_value = 1.0
        nt.links.new(a.outputs["Color"], m1.inputs["A"])
        mm = nt.nodes.new("ShaderNodeMath")
        mm.operation = "MULTIPLY"
        nt.links.new(sv.outputs[0], mm.inputs[0])
        mm.inputs[1].default_value = PREVIEW_PALE
        cm = nt.nodes.new("ShaderNodeCombineColor")
        for i in range(3):
            nt.links.new(mm.outputs[0], cm.inputs[i])
        nt.links.new(cm.outputs[0], m1.inputs["B"])
        gm = nt.nodes.new("ShaderNodeMix")
        gm.data_type = "RGBA"
        gm.blend_type = "ADD"
        nt.links.new(sep.outputs[2], gm.inputs["Factor"])
        nt.links.new(m1.outputs["Result"], gm.inputs["A"])
        gm.inputs["B"].default_value = (GLOW_RGB[0] * 3, GLOW_RGB[1] * 3, GLOW_RGB[2] * 3, 1)
        nt.links.new(gm.outputs["Result"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    else:
        nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])  # (the glow mask rides in B: the runtime zeroes metalness)
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = gltf_settings_group()
    nt.links.new(sep.outputs[0], grp.inputs["Occlusion"])
    return mat


PREVIEW_PALE = 0.3


def build_armature(coll):
    arm = bpy.data.armatures.new("Dresser_Armature")
    ob = bpy.data.objects.new("Dresser_Armature", arm)
    coll.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = []
    for name, parent, x, y, z in BONES:
        eb = arm.edit_bones.new(name)
        h = Vector(tuple(to_b(np.array([x, y, z]))[0]))
        eb.head = h
        eb.tail = h + Vector((0, 0, 0.08))
        eb.roll = 0.0
        if parent >= 0:
            eb.parent = ebs[parent]
            eb.use_connect = False
        ebs.append(eb)
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


def join(objs, name):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def attach(ob, arm, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    ob.parent = arm
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    me = ob.data
    if "FX" in me.color_attributes:
        me.color_attributes.active_color = me.color_attributes["FX"]
        try:
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except Exception:
            pass


def export_glb(arm, objs, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    arm.select_set(True)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    common = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_texcoords=True,
                  export_normals=True, export_tangents=False, export_materials="EXPORT", export_skins=True, export_animations=False,
                  export_def_bones=False, export_rest_position_armature=True, export_morph=False, export_extras=True, export_cameras=False,
                  export_lights=False, export_vertex_color="ACTIVE", export_image_format="AUTO")
    bpy.ops.export_scene.gltf(**common)
    log("exported", path, f"{os.path.getsize(path) / 1e6:.2f} MB")


# =====================================================================================================================
# POSES (the runtime's _pose in key frames: three.js Euler 'XYZ' = Blender 'ZYX'; the bone frames are the creature frame)
# =====================================================================================================================
def pose_idle(pitch=0.16, yaw=0.0, tilt=0.12, me=0.0, cut=0.0, sp=0.0):
    p = {}

    def rot(b, x, y, z):
        p.setdefault(b, []).append((x, y, z))
    rot("spine", 0.1 + 0.12 * me + 0.1 * sp, 0, 0)
    rot("chest", 0.12 + 0.08 * me + 0.12 * sp, 0, 0)
    rot("neck", 0.15 + 0.05 * sp, 0, 0)
    rot("neck", pitch * 0.35, yaw * 0.4, 0)
    rot("head", pitch * 0.65, yaw * 0.6, tilt + 0.32 * me)
    for up, fo, ch, sgn in (("upperArmL", "foreArmL", "chiselL", 1), ("upperArmR", "foreArmR", "chiselR", -1)):
        ux, uz, fx, cx, fy = -0.32, 0.2 * sgn, -1.3, 0.55, -0.12 * sgn
        ux, uz, fx, cx, fy = lerp(ux, -0.85, me), lerp(uz, 0.95 * sgn, me), lerp(fx, -0.5, me), lerp(cx, -0.3, me), lerp(fy, 0, me)
        ux, uz, fx = lerp(ux, -1.05, cut), lerp(uz, 0.45 * sgn, cut), lerp(fx, -0.7, cut)
        ux, uz, fx, fy, cx = lerp(ux, -0.35, sp), lerp(uz, -0.32 * sgn, sp), lerp(fx, -2.55, sp), lerp(fy, 0.5 * sgn, sp), lerp(cx, -0.25, sp)
        rot(up, ux, 0, uz)
        rot(fo, fx, fy, 0)
        rot(ch, cx, 0, 0)
    rot("smallUpperL", -0.95 - 0.35 * me + 0.1 * sp, 0, 0.18 + 0.2 * me)
    rot("smallForeL", -0.75 - 0.4 * me, 0, 0)
    rot("smallUpperR", -0.95 + 0.1 * sp, 0, -0.18)
    rot("smallForeR", -0.75, 0, 0)
    return p


def apply_pose(arm, pose):
    for pb in arm.pose.bones:
        q = Euler((0, 0, 0)).to_quaternion()
        for e in pose.get(pb.name, []):
            q = q @ Euler(e, "ZYX").to_quaternion()
        pb.rotation_quaternion = q
    bpy.context.view_layer.update()


# =====================================================================================================================
# PREVIEW SHEET (Cycles, the game mesh + the baked atlas, the runtime's self-light)
# =====================================================================================================================
def render_sheet(scene, arm, lods, paths):
    from PIL import Image, ImageDraw
    T = args.tile
    setup_cycles(scene, args.samples, T, T)
    world = bpy.data.worlds.new("RenderWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.012, 0.016, 0.02, 1)
    bg.inputs[1].default_value = 1.0
    prev = game_material(paths, preview=True)
    for o in lods:
        o.data.materials.clear()
        o.data.materials.append(prev)
    lights = {}

    def L(name, kind, loc, energy, col, size):
        lights[name] = add_light(name, kind, tuple(to_b(np.array(loc))[0]), energy, col, size)
    L("lantern", "POINT", (0.6, 1.9, 2.6), 160.0, (1.0, 0.68, 0.36), 0.05)
    L("rim", "AREA", (-0.8, 3.6, -1.6), 220.0, (0.55, 0.72, 1.0), 1.2)
    L("fill", "AREA", (2.0, 1.0, 1.5), 25.0, (0.5, 0.6, 0.75), 2.0)
    floor_me = bpy.data.meshes.new("Floor")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=4.0)
    bm.to_mesh(floor_me)
    bm.free()
    floor = bpy.data.objects.new("Floor", floor_me)
    scene.collection.objects.link(floor)
    fm = bpy.data.materials.new("FloorMat")
    fm.use_nodes = True
    fb = fm.node_tree.nodes.get("Principled BSDF")
    fb.inputs["Base Color"].default_value = (0.03, 0.03, 0.032, 1)
    fb.inputs["Roughness"].default_value = 0.5
    floor_me.materials.append(fm)
    tiles = []
    want = set(s for s in args.only.split(",") if s)

    def shot(name, label, cam, pose, lod=0, energy=(1, 1, 1), floor_on=True):
        if want and name not in want:
            return
        apply_pose(arm, pose)
        for i, o in enumerate(lods):
            o.hide_render = i != lod
        floor.hide_render = not floor_on
        lights["lantern"].data.energy = 160.0 * energy[0]
        lights["rim"].data.energy = 220.0 * energy[1]
        lights["fill"].data.energy = 25.0 * energy[2]
        scene.camera = cam
        fp = os.path.join(RENDER_DIR, f"dresser_{name}.png")
        scene.render.filepath = fp
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        log(f"render {name} {time.time() - t0:.0f}s")
        tiles.append((fp, label))
    idle = pose_idle()
    shot("front", "IDLE: the split saint in its hood", cam_at("c1", (0.25, 1.8, 3.7), (0.0, 1.75, 0.0), 35), idle)
    shot("q34", "3/4: mantle, apron, the belt of tools", cam_at("c2", (2.4, 2.1, 2.7), (0.0, 1.7, 0.0), 35), idle)
    shot("measure", "MEASURING: dividers, head tilted", cam_at("c3", (-1.6, 2.0, 3.4), (0.0, 1.8, 0.0), 35), pose_idle(me=1.0, tilt=0.0))
    shot("back", "BACK: peak, mantle, patched robe", cam_at("c4", (-1.8, 2.4, -3.2), (0.0, 1.75, 0.0), 35), idle)
    shot("face", "THE FACE at 1.5 m", cam_at("c5", (0.05, 2.75, 1.5), (0.0, 2.9, 0.1), 50), pose_idle(pitch=0.05, tilt=0.06), energy=(0.7, 1, 1))
    shot("face34", "serene / wrong: the lid, the crack, the corner", cam_at("c6", (0.75, 2.85, 1.05), (0.0, 2.9, 0.1), 50), pose_idle(pitch=0.05, yaw=0.25, tilt=0.06),
         energy=(0.7, 1, 1))
    shot("macro", "the wrong eye, the sewn mouth", cam_at("c7", (0.42, 2.9, 0.95), (0.035, 2.87, 0.14), 60), pose_idle(pitch=0.0, tilt=0.0), energy=(0.6, 1, 1))
    shot("hands", "small hands, cloth-wrapped, the spool", cam_at("c8", (0.6, 2.05, 1.45), (0.0, 1.82, 0.5), 45), idle, energy=(0.7, 1, 1))
    shot("arm", "a chisel arm: forged steps, rivets", cam_at("c9", (1.4, 1.7, 1.3), (0.31, 1.6, 0.25), 40), idle, energy=(0.8, 1, 1))
    lodtiles = []
    for k in range(3):
        fp0 = len(tiles)
        shot(f"lod{k}", f"LOD{k}", cam_at(f"cl{k}", (0.3, 2.3, 4.6), (0.0, 2.1, 0.0), 50), idle, lod=k)
        if len(tiles) > fp0:
            lodtiles.append(tiles.pop())
    if lodtiles:
        strip = Image.new("RGB", (T, T), (8, 8, 10))
        w3 = T // 3
        for i, (fp, _) in enumerate(lodtiles):
            im = Image.open(fp).convert("RGB")
            strip.paste(im.crop((T // 2 - w3 // 2, 0, T // 2 - w3 // 2 + w3, T)), (i * w3, 0))
        sp = os.path.join(RENDER_DIR, "dresser_lods.png")
        strip.save(sp)
        tiles.append((sp, "LOD0 / LOD1 / LOD2 (" + "/".join(str(REPORT.get(f"lod{k}_tris", "?")) for k in range(3)) + " tris)"))
    for o in lods:
        o.hide_render = False
    apply_pose(arm, {})
    if not tiles:
        return
    cols = 3
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * T, rows * (T + 26)), (8, 8, 10))
    dr = ImageDraw.Draw(sheet)
    for i, (fp, label) in enumerate(tiles):
        im = Image.open(fp).convert("RGB")
        x = (i % cols) * T
        y = (i // cols) * (T + 26)
        sheet.paste(im, (x, y))
        dr.text((x + 8, y + T + 6), label, fill=(210, 200, 185))
    out = os.path.join(RENDER_DIR, "dresser_sheet.png")
    sheet.save(out)
    log("sheet", out)


REPORT = {}


# =====================================================================================================================
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    work = bpy.data.collections.new("Work")
    sc.collection.children.link(work)
    parts = make_parts()
    for p in parts:
        p.sign = orient(p)
    pack_atlas(parts, args.bake)
    lows = {}
    for lod in (0, 1, 2):
        lows[lod] = [low_object(p, lod, work) for p in parts if p.res.get(lod)]
        n = sum(tri_count(o) for o in lows[lod])
        REPORT[f"lod{lod}_tris"] = n
        log(f"LOD{lod}: {len(lows[lod])} parts, {n} triangles")
    log("LOD0 parts:", ", ".join(f"{o.name[:-3]}={tri_count(o)}" for o in lows[0]))
    if args.stage == "paint":
        alb, rough, glow, cov = paint_atlas(parts, args.bake)
        save_png(srgb_encode(alb), os.path.join(RENDER_DIR, "paint_albedo.png"))
        save_png(np.dstack([rough, rough, glow]), os.path.join(RENDER_DIR, "paint_rough_glow.png"))
        log("paint maps written")
        return
    if args.stage == "shape":
        for lod in (1, 2):
            for o in lows[lod]:
                o.hide_render = True
        face = [((0.0, 2.92, 1.15), (0.0, 2.92, 0.0), 50), ((0.7, 2.95, 0.85), (0.0, 2.92, 0.05), 50)]
        body = [("front", (0.0, 1.75, 3.9), (0.0, 1.62, 0.0), 35), ("q34", (2.3, 2.2, 3.0), (0.0, 1.62, 0.0), 35), ("side", (3.8, 1.75, 0.0), (0.0, 1.62, 0.0), 35),
                ("back", (-1.2, 2.3, -3.4), (0.0, 1.7, 0.0), 35)]
        clay(sc, lows[0], "low", body + [("face", face[0][0], face[0][1], face[0][2]), ("face34", face[1][0], face[1][1], face[1][2])])
        for p in parts:
            if p.name.startswith("mask"):
                p.hi = (380, 760)
        his = [high_object(p, work) for p in parts if p.name.startswith("mask")]
        for o in lows[0]:
            if o.name.startswith("mask"):
                o.hide_render = True
        clay(sc, his + [o for o in lows[0] if not o.name.startswith("mask")], "high", [("face", face[0][0], face[0][1], face[0][2]), ("face34", face[1][0], face[1][1], face[1][2])])
        return
    # ---- the maps -----------------------------------------------------------------------------------------------------
    res = args.bake
    alb, rough, glow, cov = paint_atlas(parts, res)
    log("analytic paint done")
    mask_cov = np.zeros((res, res), bool)
    for p in parts:
        if p.name.startswith("mask"):
            x0, y0, w, h = p.rect
            mask_cov[int(y0 * res):int((y0 + h) * res) + 1, int(x0 * res):int((x0 + w) * res) + 1] = True
    low_by = {o.name[:-3]: o for o in lows[0]}
    need = any(not os.path.exists(os.path.join(CACHE_DIR, f"bake_{k}_{res}.npy")) for k in ("NORMAL", "AO"))
    hi_by = {}
    hi_tris = 0
    if need:
        for p in parts:
            if p.mirror_of is not None:
                continue
            x0, y0, w, h = p.rect
            p.hi = (max(8, int(w * res * args.hi)), max(8, int(h * res * args.hi)))
            hi_by[p.name] = high_object(p, work)
            hi_tris += 2 * p.hi[0] * p.hi[1]
        log(f"HIGH: {len(hi_by)} parts, {hi_tris / 1e6:.2f} M triangles")
        for o in lows[1] + lows[2]:
            o.hide_render = True
    REPORT["high_tris"] = hi_tris or REPORT.get("high_tris")
    R = {"NORMAL": bake_parts(parts, low_by, hi_by, res, "NORMAL"), "AO": bake_parts(parts, low_by, hi_by, res, "AO")}
    for o in list(hi_by.values()):
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(me)
    lod_obs = [join(lows[k], f"Dresser_LOD{k}") for k in (0, 1, 2)]
    R["GAO"] = bake_global_ao(lod_obs[0], res)
    paths = composite(alb, rough, glow, cov, R, res, mask_cov)
    log("composited", paths)
    if args.stage == "bake":
        return
    mat = game_material(paths)
    arm = build_armature(work)
    for o in lod_obs:
        attach(o, arm, mat)
        o.hide_render = False
    wu = (WHITE[0] + WHITE[2] * 0.5, 1 - (WHITE[1] + WHITE[3] * 0.5))  # glTF uv (v down)
    arm["dresser"] = json.dumps({"version": 2, "whiteUV": [round(wu[0], 5), round(wu[1], 5)], "lods": [REPORT[f"lod{k}_tris"] for k in range(3)],
                                 "bones": [b[0] for b in BONES], "fx": "COLOR_0: R pale, G -, B hood rim; ORM: R AO, G rough, B glow"})
    glb = os.path.join(args.out, "dresser.glb")
    export_glb(arm, lod_obs, glb)
    REPORT["glb_raw_mb"] = round(os.path.getsize(glb) / 1e6, 3)
    REPORT["atlas"] = res
    with open(os.path.join(RENDER_DIR, "dresser_report.json"), "w") as fh:
        json.dump(REPORT, fh, indent=1)
    log("report", REPORT)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    if args.render:
        render_sheet(sc, arm, lod_obs, paths)
    log("done")


main()
