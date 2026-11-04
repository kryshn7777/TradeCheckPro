"""ABYSSAL TETHER 3D — THE USHER: procedural builder of the headless man in the suit whose neck goes on (Blender 5.x / the `bpy` module).

Inspired by a Blender sculpt the owner sent (a video, "Nightmares can be beautiful too."): rows of grey, headless men in suits standing in a drained pool, a long
ribbed tube coiling out of a collar, thin veins and spines wrapped round it, a bright ring where a face should be. This is NOT a copy of that artwork: it is
an original character built from code for the game's second chapter (docs/abyssal-tether-3d/plans/CHAPTER_II_PLAN.md): THE USHER.

  A 1.95 m man in a long dark coat, white collar and a black tie, long pale hands, long black shoes, stooped. No head. From the collar a ribbed throat rises
  3.4 m (a tracheal tube, thicker at the root, coiling over his shoulders in an S and a hook) and ends in a flared ring held at the height of a face. Inside the ring a
  cold pale membrane glows: it is the only light he has. Veins and thorns wind round the throat. He walks without hurry, the throat swaying a beat behind him.

Deterministic (seed 1313), no sculpting, no textures: flat materials (suit, shirt, skin, vein, shoe, glow) and one set of vertex weights, so the game can paint it
with its own toon / grade shader. ~20-30 k triangles in ONE mesh, one armature.

Skeleton (names are the contract for a future render/usherView.js): Root > Pelvis > Spine1 > Spine2 > Spine3 > { Clavicle_X > UpperArm_X > Forearm_X > Hand_X,
Neck01 > Neck02 ... Neck14 > Maw }, Pelvis > { Thigh_X > Shin_X > Foot_X }.
Clips: Idle (loop), Walk (loop), Lunge (once: the throat draws back and whips forward, the ring opens), Listen (loop: the ring turns toward a sound).

Frame: Blender +Z up, the Usher faces -Y (glTF: +Y up, +Z facing). Output: <out>/usher.glb (raw: then compress_glbs.mjs --only usher), <renders>/usher_*.png (--render),
usher_report.json.

Run (always under the shared lock):
  flock /tmp/at3d-blender.lock $PY tools/abyssal-tether-3d/build_usher.py --out <dir> [--renders <dir>] [--render] [--blend <file>]
"""

import argparse
import json
import math
import os
import sys

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.getcwd(), "usher_out"))
ap.add_argument("--renders", default="")
ap.add_argument("--render", action="store_true")
ap.add_argument("--samples", type=int, default=24)
ap.add_argument("--blend", default="")
ap.add_argument("--skip-rest", action="store_true", help="with --render: only the posed previews")
args = ap.parse_args(argv)
args.out = os.path.abspath(args.out)
os.makedirs(args.out, exist_ok=True)
RENDER_DIR = os.path.abspath(args.renders or args.out)
os.makedirs(RENDER_DIR, exist_ok=True)

RNG = np.random.default_rng(1313)
FPS = 24
NECK_BONES = 14


def log(*a):
    print("[usher]", *a, flush=True)


# ---------------------------------------------------------------------------------------------------------------------------------
# Geometry helpers (numpy -> mesh)
# ---------------------------------------------------------------------------------------------------------------------------------
class Part:
    """Vertices / faces / per-vertex data of one material; parts are merged into one mesh."""

    def __init__(self, name, mat):
        self.name = name
        self.mat = mat
        self.v = np.zeros((0, 3))
        self.f = []
        self.t = np.zeros(0)  # per-vertex parameter (arc position along a tube: 0..1), else 0
        self.tag = name  # the skinning rule

    def add(self, v, f, t=None):
        off = len(self.v)
        self.v = np.vstack([self.v, np.asarray(v, float)])
        self.f += [[i + off for i in q] for q in f]
        self.t = np.concatenate([self.t, np.zeros(len(v)) if t is None else np.asarray(t, float)])


def catmull(pts, per=14):
    """Densified Catmull-Rom through the control points (centripetal-ish: uniform with end tangents)."""
    P = [np.asarray(p, float) for p in pts]
    P = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(per):
            u = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    out.append(P[-2])
    return np.array(out)


def arclen(path):
    d = np.linalg.norm(np.diff(path, axis=0), axis=1)
    return np.concatenate([[0], np.cumsum(d)])


def resample(path, n):
    s = arclen(path)
    u = np.linspace(0, s[-1], n)
    return np.stack([np.interp(u, s, path[:, k]) for k in range(3)], axis=1)


def frames(path):
    """Rotation-minimising frames along a polyline (double reflection): tangent T, normal N, binormal B per point."""
    n = len(path)
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    ref = np.array([0.0, 0.0, 1.0]) if abs(T[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    N = np.zeros_like(path)
    N[0] = np.cross(np.cross(T[0], ref), T[0])
    N[0] /= np.linalg.norm(N[0]) + 1e-12
    for i in range(n - 1):
        v1 = path[i + 1] - path[i]
        c1 = v1 @ v1 + 1e-12
        rL = N[i] - (2 / c1) * (v1 @ N[i]) * v1
        tL = T[i] - (2 / c1) * (v1 @ T[i]) * v1
        v2 = T[i + 1] - tL
        c2 = v2 @ v2 + 1e-12
        N[i + 1] = rL - (2 / c2) * (v2 @ rL) * v2
        N[i + 1] /= np.linalg.norm(N[i + 1]) + 1e-12
    B = np.cross(T, N)
    return T, N, B


def tube(path, radii, segs=16, cap0=False, cap1=False, squash=None, twist=0.0):
    """A tube along `path` with radius per point. squash = (a, b) scales the cross section along N and B. Returns v, f, t."""
    n = len(path)
    T, N, B = frames(path)
    a, b = squash if squash else (1.0, 1.0)
    ang = np.linspace(0, 2 * math.pi, segs, endpoint=False)
    v = []
    for i in range(n):
        ph = ang + twist * i / max(1, n - 1)
        ring = path[i] + radii[i] * (np.cos(ph)[:, None] * a * N[i] + np.sin(ph)[:, None] * b * B[i])
        v.append(ring)
    v = np.vstack(v)
    f = []
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            f.append([i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k])
    t = np.repeat(np.linspace(0, 1, n), segs)
    if cap0:
        c = len(v)
        v = np.vstack([v, path[0]])
        t = np.append(t, 0.0)
        f += [[c, (k + 1) % segs, k] for k in range(segs)]
    if cap1:
        c = len(v)
        v = np.vstack([v, path[-1]])
        t = np.append(t, 1.0)
        base = (n - 1) * segs
        f += [[c, base + k, base + (k + 1) % segs] for k in range(segs)]
    return v, f, t


def loft(sections, segs=20):
    """Elliptical sections [(z, cx, cy, rx, ry, pow)] stacked in z (superellipse-ish), capped at both ends. Returns v, f."""
    ang = np.linspace(0, 2 * math.pi, segs, endpoint=False)
    v = []
    for z, cx, cy, rx, ry, pw in sections:
        c, s = np.cos(ang), np.sin(ang)
        x = cx + rx * np.sign(c) * np.abs(c) ** (2 / pw)
        y = cy + ry * np.sign(s) * np.abs(s) ** (2 / pw)
        v.append(np.stack([x, y, np.full(segs, z)], axis=1))
    v = np.vstack(v)
    n = len(sections)
    f = []
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            f.append([i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k])
    return v, f


def ellipsoid(c, r, segs=14, rings=9):
    v = [c + np.array([0, 0, r[2]])]
    for j in range(1, rings):
        th = math.pi * j / rings
        for k in range(segs):
            ph = 2 * math.pi * k / segs
            v.append(c + np.array([r[0] * math.sin(th) * math.cos(ph), r[1] * math.sin(th) * math.sin(ph), r[2] * math.cos(th)]))
    v.append(c - np.array([0, 0, r[2]]))
    f = [[0, 1 + (k + 1) % segs, 1 + k] for k in range(segs)]
    for j in range(rings - 2):
        for k in range(segs):
            k2 = (k + 1) % segs
            f.append([1 + j * segs + k, 1 + j * segs + k2, 1 + (j + 1) * segs + k2, 1 + (j + 1) * segs + k])
    last = len(v) - 1
    f += [[last, 1 + (rings - 2) * segs + k, 1 + (rings - 2) * segs + (k + 1) % segs] for k in range(segs)]
    return np.array(v), f


def mirror_x(v):
    w = np.array(v, float).copy()
    w[:, 0] *= -1
    return w


def flip(f):
    return [list(reversed(q)) for q in f]


# ---------------------------------------------------------------------------------------------------------------------------------
# The Usher
# ---------------------------------------------------------------------------------------------------------------------------------
BONE_POS = {}  # name -> (head, tail)
NECK_PATH = None  # dense polyline of the throat
NECK_S = None


def build_parts():
    global NECK_PATH, NECK_S
    parts = {}

    def P(name, mat):
        if name not in parts:
            parts[name] = Part(name, mat)
        return parts[name]

    # ---- the coat: a loft from the hem to the collar, stooped forward (+y is the back: the Usher faces -Y) ----
    coat = P("coat", "suit")
    secs = [
        (0.50, 0.00, 0.020, 0.225, 0.158, 2.6),
        (0.70, 0.00, 0.020, 0.208, 0.142, 2.6),
        (0.92, 0.00, 0.005, 0.190, 0.124, 2.4),
        (1.12, 0.00, -0.015, 0.172, 0.114, 2.4),
        (1.30, 0.00, -0.040, 0.196, 0.124, 2.4),
        (1.45, 0.00, -0.070, 0.228, 0.134, 2.5),
        (1.55, 0.00, -0.085, 0.262, 0.122, 2.6),
        (1.605, 0.00, -0.085, 0.165, 0.088, 2.2),
        (1.63, 0.00, -0.080, 0.088, 0.064, 2.0),
    ]
    v, f = loft(secs, 22)
    coat.add(v, f)
    # shirt front V and the collar stub (the throat leaves through it)
    shirt = P("shirt", "shirt")
    v, f = loft([(1.28, 0.0, -0.148, 0.045, 0.008, 2.0), (1.46, 0.0, -0.188, 0.072, 0.010, 2.0), (1.58, 0.0, -0.200, 0.088, 0.010, 2.0)], 10)
    shirt.add(v, f)
    ring_path = np.array([[0.0, -0.080, 1.60], [0.0, -0.080, 1.665]])
    v, f, _ = tube(ring_path, [0.100, 0.090], 18, cap0=False, cap1=False)
    shirt.add(v, f)
    # the tie: a flat strip hanging from the collar
    tie = P("tie", "shoe")
    tp = np.array([[0.0, -0.205, 1.58], [0.0, -0.200, 1.40], [0.0, -0.175, 1.20], [0.0, -0.140, 1.00]])
    tp = catmull(tp, 6)
    v, f, _ = tube(tp, np.interp(np.linspace(0, 1, len(tp)), [0, 0.2, 0.55, 1.0], [0.012, 0.022, 0.034, 0.016]), 6, squash=(0.25, 1.0), cap1=True)
    tie.add(v, f)

    # ---- arms (sleeves) ----
    for side in (1, -1):
        sl = P("sleeve", "suit")
        sh = np.array([0.245 * side, -0.070, 1.50])
        el = np.array([0.310 * side, -0.040, 1.18])
        wr = np.array([0.330 * side, -0.100, 0.86])
        path = catmull([sh, (sh + el) / 2 + np.array([0.012 * side, 0, 0]), el, (el + wr) / 2, wr], 8)
        r = np.interp(np.linspace(0, 1, len(path)), [0, 0.5, 1], [0.064, 0.052, 0.042])
        v, f, t = tube(path, r, 12, cap0=True, cap1=False)
        sl.add(v, f, t)
        # the cuff: a shirt-white band
        cu = P("cuff", "shirt")
        cp = np.array([wr + np.array([0, 0.005, 0.045]), wr + np.array([0, 0, -0.012])])
        v, f, _ = tube(cp, [0.043, 0.041], 12)
        cu.add(v, f)
        # hand: palm + five long fingers, slightly curled
        hd = P("hand", "skin")
        pc = wr + np.array([0.0, -0.012, -0.085])
        v, f = ellipsoid(pc, (0.037, 0.016, 0.074), 10, 7)
        hd.add(v, f)
        fingers = [(-0.022, 0.150, 0.0125), (-0.008, 0.172, 0.0135), (0.007, 0.166, 0.0125), (0.021, 0.140, 0.0105)]
        for i, (fx, ln, rad) in enumerate(fingers):
            base = pc + np.array([fx * side, -0.002, -0.062])
            curl = 0.30 + 0.06 * i
            fp = []
            pos = base.copy()
            ang = 0.1
            for k in range(7):
                fp.append(pos.copy())
                ang += curl / 6
                pos = pos + np.array([0, -math.sin(ang) * ln / 6, -math.cos(ang) * ln / 6])
            fp = catmull(fp, 3)
            v, f, t = tube(fp, np.interp(np.linspace(0, 1, len(fp)), [0, 1], [rad, rad * 0.55]), 6, cap1=True)
            hd.add(v, f)
        base = pc + np.array([-0.036 * side, -0.004, -0.014])
        tp2 = catmull([base, base + np.array([-0.022 * side, -0.022, -0.034]), base + np.array([-0.024 * side, -0.054, -0.066]), base + np.array([-0.014 * side, -0.080, -0.088])], 4)
        v, f, t = tube(tp2, np.interp(np.linspace(0, 1, len(tp2)), [0, 1], [0.014, 0.008]), 6, cap1=True)
        hd.add(v, f)

    # ---- legs (trousers) and shoes ----
    for side in (1, -1):
        tr = P("trouser", "suit")
        hip = np.array([0.095 * side, 0.0, 0.92])
        kn = np.array([0.100 * side, -0.030, 0.50])
        an = np.array([0.100 * side, 0.005, 0.085])
        path = catmull([hip, (hip + kn) / 2, kn, (kn + an) / 2, an], 8)
        r = np.interp(np.linspace(0, 1, len(path)), [0, 0.5, 1], [0.098, 0.074, 0.058])
        v, f, t = tube(path, r, 14, cap0=True, cap1=False)
        tr.add(v, f, t)
        sh_ = P("shoe", "shoe")
        sp = np.array([[0.100 * side, 0.060, 0.050], [0.100 * side, 0.000, 0.052], [0.100 * side, -0.120, 0.040], [0.100 * side, -0.250, 0.030]])
        sp = catmull(sp, 6)
        rr = np.interp(np.linspace(0, 1, len(sp)), [0, 0.25, 0.7, 1], [0.052, 0.058, 0.050, 0.026])
        v, f, t = tube(sp, rr, 12, squash=(1.0, 0.8), cap0=True, cap1=True)
        sh_.add(v, f)

    # ---- THE THROAT: a ribbed tube from the collar, coiling in an S and a hook, ending in a ring held at face height ----
    ctrl = [
        (0.000, -0.080, 1.62), (0.000, -0.070, 1.96), (0.015, 0.000, 2.38), (0.20, 0.050, 2.80),
        (0.42, -0.090, 3.10), (0.20, -0.440, 3.24), (-0.20, -0.640, 3.02), (-0.30, -0.610, 2.64),
        (-0.07, -0.790, 2.32), (0.000, -1.020, 2.14),
    ]
    dense = catmull(ctrl, 18)
    NECK_PATH = resample(dense, 210)
    NECK_S = arclen(NECK_PATH)
    L = NECK_S[-1]
    log("throat length %.2f m" % L)
    u = NECK_S / L
    base_r = np.interp(u, [0, 0.12, 0.45, 0.8, 1.0], [0.078, 0.088, 0.064, 0.058, 0.066])
    rib = 1.0 + 0.10 * (np.abs(np.sin(math.pi * NECK_S / 0.058)) ** 0.55 - 0.62)
    radii = base_r * rib
    th = P("throat", "skin")
    v, f, t = tube(NECK_PATH, radii, 18, squash=(1.0, 0.94))
    th.add(v, f, t)
    # the ring: a flared bell, a rim and a membrane inside (the only light he has)
    T, N, B = frames(NECK_PATH)
    e = NECK_PATH[-1]
    d = T[-1]
    ring_len = 0.11
    ring_pts = np.array([e, e + d * 0.04, e + d * 0.08, e + d * ring_len])
    ring_r = [radii[-1] * 0.995, radii[-1] * 1.20, radii[-1] * 1.62, radii[-1] * 1.95]
    ringp = catmull(ring_pts, 6)
    rr = np.interp(np.linspace(0, 1, len(ringp)), np.linspace(0, 1, 4), ring_r)
    v, f, t = tube(ringp, rr, 18)
    rim = P("rim", "skin")
    rim.add(v, f, np.ones(len(v)))
    # rim bead
    rb = ringp[-1]
    bp = np.array([rb - d * 0.012, rb + d * 0.012])
    ang = np.linspace(0, 2 * math.pi, 22, endpoint=False)
    rv, rf = [], []
    for j, off in enumerate((-0.012, 0.0, 0.012)):
        pass
    # a thick torus-like lip: a tube bent around the rim circle
    ctr = ringp[-1]
    ang = np.linspace(0, 2 * math.pi, 18, endpoint=False)
    circle = np.array([ctr + rr[-1] * (math.cos(a) * N[-1] + math.sin(a) * B[-1]) for a in list(ang) + [ang[0]]])
    cr = np.full(len(circle), 0.020)
    v, f, t = tube(circle, cr, 8)
    rim.add(v, f, np.ones(len(v)))
    # the membrane: a shallow dish inside the ring, glowing
    mem = P("membrane", "glow")
    dish_c = ringp[-1] - d * 0.055
    sec = []
    segs = 18
    vv = [dish_c - d * 0.02]
    ff = []
    rings = 4
    for j in range(1, rings + 1):
        rad = rr[-1] * 0.92 * j / rings
        depth = -0.03 * (1 - (j / rings) ** 2) * 0
        for k in range(segs):
            a = 2 * math.pi * k / segs
            vv.append(dish_c + d * (0.02 * (j / rings) ** 2) + rad * (math.cos(a) * N[-1] + math.sin(a) * B[-1]))
    vv = np.array(vv)
    for k in range(segs):
        ff.append([0, 1 + k, 1 + (k + 1) % segs])
    for j in range(rings - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            ff.append([1 + j * segs + k, 1 + (j + 1) * segs + k, 1 + (j + 1) * segs + k2, 1 + j * segs + k2])
    mem.add(vv, ff, np.ones(len(vv)))
    # the dark inside of the bell (so the glow reads as a hole)
    # ---- veins and thorns wound round the throat ----
    vein = P("vein", "vein")
    thorn = P("thorn", "vein")
    n = len(NECK_PATH)
    for i in range(30):
        s0 = RNG.uniform(0.04, 0.78)
        ln = RNG.uniform(0.12, 0.34)
        turns = RNG.uniform(1.0, 3.2) * (1 if RNG.random() < 0.5 else -1)
        ph = RNG.uniform(0, 2 * math.pi)
        i0 = int(s0 * (n - 1))
        i1 = min(n - 1, int((s0 + ln) * (n - 1)))
        if i1 - i0 < 8:
            continue
        idx = np.arange(i0, i1 + 1)
        m = len(idx)
        a = ph + turns * 2 * math.pi * (np.arange(m) / (m - 1))
        off = (radii[idx] * 1.02 + 0.004 + 0.006 * np.sin(np.arange(m) * 0.5))[:, None] * (np.cos(a)[:, None] * N[idx] + np.sin(a)[:, None] * B[idx] * 0.94)
        vp = NECK_PATH[idx] + off
        # a free end: the last 20 % lifts away from the throat like a root
        lift = np.clip((np.arange(m) / (m - 1) - 0.8) / 0.2, 0, 1) ** 1.6
        outd = (np.cos(a)[:, None] * N[idx] + np.sin(a)[:, None] * B[idx])
        vp = vp + outd * (lift * RNG.uniform(0.02, 0.07))[:, None] + (T[idx] * (lift * 0.04)[:, None])
        rv = np.interp(np.linspace(0, 1, m), [0, 0.7, 1], [0.0070, 0.0045, 0.0012])
        v, f, t = tube(vp, rv, 4, cap1=True)
        vein.add(v, f, np.full(len(v), (s0 + ln / 2)))
        # thorns along the vein
        for k in range(int(RNG.integers(1, 4))):
            j = int(RNG.integers(m // 4, m - 2))
            base = vp[j]
            dirv = outd[j] * RNG.uniform(0.7, 1.0) + T[idx][j] * RNG.uniform(-0.4, 0.4)
            dirv /= np.linalg.norm(dirv)
            tp3 = np.array([base, base + dirv * 0.03, base + dirv * 0.062])
            v, f, t = tube(tp3, [0.0060, 0.0035, 0.0006], 5, cap1=True)
            thorn.add(v, f, np.full(len(v), (s0 + ln / 2)))
    # larger dorsal thorns down the root of the throat
    for i in range(9):
        s0 = 0.03 + i * 0.045
        j = int(s0 * (n - 1))
        a = math.pi * 0.5 + RNG.uniform(-0.5, 0.5)
        base = NECK_PATH[j] + radii[j] * (math.cos(a) * N[j] + math.sin(a) * B[j] * 0.94)
        dirv = math.cos(a) * N[j] + math.sin(a) * B[j]
        dirv = dirv + T[j] * 0.25
        dirv /= np.linalg.norm(dirv)
        tp3 = np.array([base - dirv * 0.01, base + dirv * 0.05, base + dirv * 0.11])
        v, f, t = tube(tp3, [0.012, 0.0065, 0.0010], 6, cap1=True)
        thorn.add(v, f, np.full(len(v), s0))
    return parts


def bone_table():
    """Head / tail of every bone (Blender coordinates)."""
    b = {}
    b["Root"] = ((0, 0, 0), (0, 0, 0.1))
    b["Pelvis"] = ((0, 0, 0.92), (0, 0, 1.05))
    b["Spine1"] = ((0, 0, 1.05), (0, -0.025, 1.22))
    b["Spine2"] = ((0, -0.025, 1.22), (0, -0.060, 1.40))
    b["Spine3"] = ((0, -0.060, 1.40), (0, -0.080, 1.62))
    for s, side in (("L", 1), ("R", -1)):
        b[f"Clavicle_{s}"] = ((0.04 * side, -0.070, 1.50), (0.245 * side, -0.070, 1.50))
        b[f"UpperArm_{s}"] = ((0.245 * side, -0.070, 1.50), (0.310 * side, -0.040, 1.18))
        b[f"Forearm_{s}"] = ((0.310 * side, -0.040, 1.18), (0.330 * side, -0.100, 0.86))
        b[f"Hand_{s}"] = ((0.330 * side, -0.100, 0.86), (0.330 * side, -0.120, 0.66))
        b[f"Thigh_{s}"] = ((0.095 * side, 0.0, 0.92), (0.100 * side, -0.030, 0.50))
        b[f"Shin_{s}"] = ((0.100 * side, -0.030, 0.50), (0.100 * side, 0.005, 0.085))
        b[f"Foot_{s}"] = ((0.100 * side, 0.005, 0.085), (0.100 * side, -0.25, 0.04))
    # the throat: NECK_BONES bones at equal arc length
    idx = np.linspace(0, len(NECK_PATH) - 1, NECK_BONES + 1).astype(int)
    for i in range(NECK_BONES):
        b[f"Neck{i + 1:02d}"] = (tuple(NECK_PATH[idx[i]]), tuple(NECK_PATH[idx[i + 1]]))
    end = NECK_PATH[-1]
    b["Maw"] = (tuple(NECK_PATH[idx[NECK_BONES]]), tuple(end + (end - NECK_PATH[-6]) * 3))
    return b


PARENT = {"Pelvis": "Root", "Spine1": "Pelvis", "Spine2": "Spine1", "Spine3": "Spine2", "Neck01": "Spine3", "Maw": f"Neck{NECK_BONES:02d}"}
for _s in ("L", "R"):
    PARENT.update({f"Clavicle_{_s}": "Spine3", f"UpperArm_{_s}": f"Clavicle_{_s}", f"Forearm_{_s}": f"UpperArm_{_s}", f"Hand_{_s}": f"Forearm_{_s}",
                   f"Thigh_{_s}": "Pelvis", f"Shin_{_s}": f"Thigh_{_s}", f"Foot_{_s}": f"Shin_{_s}"})
for _i in range(2, NECK_BONES + 1):
    PARENT[f"Neck{_i:02d}"] = f"Neck{_i - 1:02d}"

# which bones may move a part's vertices (the skinning rules)
BODY = ["Pelvis", "Spine1", "Spine2", "Spine3"]
ALLOWED = {
    "coat": BODY + ["Clavicle_L", "Clavicle_R", "Thigh_L", "Thigh_R", "Neck01"],
    "shirt": BODY + ["Neck01"],
    "tie": BODY,
    "cuff": ["Forearm_L", "Forearm_R", "Hand_L", "Hand_R"],
    "sleeve": ["Spine3", "Clavicle_L", "Clavicle_R", "UpperArm_L", "UpperArm_R", "Forearm_L", "Forearm_R"],
    "hand": ["Forearm_L", "Forearm_R", "Hand_L", "Hand_R"],
    "trouser": ["Pelvis", "Thigh_L", "Thigh_R", "Shin_L", "Shin_R", "Foot_L", "Foot_R"],
    "shoe": ["Shin_L", "Shin_R", "Foot_L", "Foot_R"],
}


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def weights_for(part, bones):
    """Per-vertex (bone name -> weight) by capsule distance among the allowed bones (top 3), or by arc position for the throat."""
    v = part.v
    out = []
    if part.name in ("throat", "rim", "membrane", "vein", "thorn"):
        names = [f"Neck{i + 1:02d}" for i in range(NECK_BONES)]
        # position along the throat by projecting onto the dense path
        for p, tt in zip(v, part.t):
            d = np.linalg.norm(NECK_PATH - p, axis=1)
            k = int(np.argmin(d))
            u = k / (len(NECK_PATH) - 1) * NECK_BONES  # 0..NECK_BONES
            i0 = min(NECK_BONES - 1, int(u))
            f = u - i0
            w = {}
            # the bone i owns [i, i+1): blend with the neighbours by a smooth step so the bends are round
            f2 = f * f * (3 - 2 * f)
            w[names[i0]] = 1 - f2 * 0.5
            if i0 + 1 < NECK_BONES:
                w[names[i0 + 1]] = f2 * 0.5 + (0 if i0 + 1 < NECK_BONES else 0)
            if i0 > 0:
                w[names[i0 - 1]] = (1 - f2) * 0.0
            if part.name in ("rim", "membrane"):
                w = {"Maw": 0.75, names[-1]: 0.25}
            if k < 8 and part.name != "rim":
                # the root blends into the chest
                ww = max(0.0, 1 - k / 8.0)
                w = {kk: vv * (1 - ww) for kk, vv in w.items()}
                w["Spine3"] = ww
            s = sum(w.values())
            out.append({kk: vv / s for kk, vv in w.items() if vv > 1e-4})
        return out
    allowed = ALLOWED[part.name]
    heads = np.array([bones[n][0] for n in allowed], float)
    tails = np.array([bones[n][1] for n in allowed], float)
    D = np.stack([seg_dist(v, heads[i], tails[i]) for i in range(len(allowed))], axis=1)
    for i in range(len(v)):
        d = D[i]
        order = np.argsort(d)[:3]
        w = 1.0 / (d[order] ** 2 + 1e-4)
        # a bone further than twice the nearest does not count
        w[d[order] > 2.2 * d[order[0]] + 0.02] = 0
        w /= w.sum()
        out.append({allowed[j]: float(w[k]) for k, j in enumerate(order) if w[k] > 1e-3})
    return out


# ---------------------------------------------------------------------------------------------------------------------------------
# Blender objects
# ---------------------------------------------------------------------------------------------------------------------------------
PALETTE = {
    "suit": ((0.045, 0.048, 0.062), 0.62, 0.0),
    "shirt": ((0.62, 0.60, 0.55), 0.7, 0.0),
    "skin": ((0.50, 0.46, 0.46), 0.55, 0.0),
    "vein": ((0.17, 0.07, 0.11), 0.5, 0.0),
    "shoe": ((0.02, 0.02, 0.022), 0.35, 0.0),
    "glow": ((0.95, 0.80, 0.72), 0.4, 1.0),
}


def make_materials():
    mats = {}
    for name, (col, rough, glow) in PALETTE.items():
        m = bpy.data.materials.new(f"Usher_{name}")
        m.use_nodes = True
        nt = m.node_tree
        bs = nt.nodes["Principled BSDF"]
        bs.inputs["Base Color"].default_value = (*col, 1.0)
        bs.inputs["Roughness"].default_value = rough
        bs.inputs["Metallic"].default_value = 0.0
        if glow > 0:
            bs.inputs["Emission Color"].default_value = (*col, 1.0)
            bs.inputs["Emission Strength"].default_value = 3.0
        m.diffuse_color = (*col, 1.0)
        mats[name] = m
    return mats


def vertex_normals(v, f):
    n = np.zeros_like(v)
    for q in f:
        a, b, c = v[q[0]], v[q[1]], v[q[2]]
        fn = np.cross(b - a, c - a)
        for i in q:
            n[i] += fn
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.where(ln < 1e-12, 1, ln)


def fold_cloth(part, amp, freq):
    """Cloth folds: a few incommensurate waves along the surface normals (long vertical creases, small crumples). Deterministic."""
    if len(part.v) == 0:
        return
    n = vertex_normals(part.v, part.f)
    p = part.v
    w = (np.sin(p[:, 2] * freq * 2.1 + np.sin(p[:, 0] * freq * 3.0) * 1.7) * 0.6 + np.sin((p[:, 0] + p[:, 1] * 0.7) * freq * 5.3 + p[:, 2] * freq * 0.9) * 0.4
         + np.sin(p[:, 2] * freq * 7.9 + p[:, 1] * freq * 4.1) * 0.25)
    part.v = p + n * (amp * w)[:, None]


def build_mesh(parts, bones, mats):
    for nm, amp, fr in (("coat", 0.0065, 9.0), ("sleeve", 0.0045, 12.0), ("trouser", 0.0050, 11.0)):
        if nm in parts:
            fold_cloth(parts[nm], amp, fr)
    mesh = bpy.data.meshes.new("Usher")
    verts = []
    faces = []
    mat_ids = []
    names = list(mats.keys())
    weights = []
    for p in parts.values():
        if len(p.v) == 0:
            continue
        off = len(verts)
        verts += [tuple(x) for x in p.v]
        for q in p.f:
            faces.append([i + off for i in q])
            mat_ids.append(names.index(p.mat))
        weights += weights_for(p, bones)
    mesh.from_pydata(verts, [], faces)
    for m in mats.values():
        mesh.materials.append(m)
    for poly, mi in zip(mesh.polygons, mat_ids):
        poly.material_index = mi
        poly.use_smooth = True
    mesh.update()
    # the mesh normals: recompute outward from the volume centre of each part is not possible per-face; rely on winding then fix with bmesh
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new("Usher", mesh)
    bpy.context.scene.collection.objects.link(ob)
    # vertex groups
    groups = {}
    for vi, w in enumerate(weights):
        for bn, val in w.items():
            if bn not in groups:
                groups[bn] = ob.vertex_groups.new(name=bn)
            groups[bn].add([vi], float(val), "REPLACE")
    return ob


def build_armature(bones):
    arm_data = bpy.data.armatures.new("UsherArmature")
    arm = bpy.data.objects.new("UsherArmature", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    order = ["Root", "Pelvis", "Spine1", "Spine2", "Spine3"] + [k for k in bones if k.startswith(("Clavicle", "UpperArm", "Forearm", "Hand", "Thigh", "Shin", "Foot"))] + \
            [f"Neck{i + 1:02d}" for i in range(NECK_BONES)] + ["Maw"]
    for name in order:
        h, t = bones[name]
        b = arm_data.edit_bones.new(name)
        b.head = Vector(h)
        b.tail = Vector(t)
        if (b.tail - b.head).length < 1e-4:
            b.tail = b.head + Vector((0, 0, 0.05))
        eb[name] = b
    for name in order:
        p = PARENT.get(name)
        if p:
            eb[name].parent = eb[p]
            if name not in ("Pelvis",) and (eb[p].tail - eb[name].head).length < 0.02:
                eb[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


# ---------------------------------------------------------------------------------------------------------------------------------
# Clips
# ---------------------------------------------------------------------------------------------------------------------------------
def key_rot(pb, frame, e):
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler(e, "XYZ")
    pb.keyframe_insert("rotation_euler", frame=frame)


REST_STRAIGHT = {}  # neck bone -> the pose rotation that makes it parallel to its parent (the inverse of its rest bend)


def key_quat(pb, frame, q):
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = q
    pb.keyframe_insert("rotation_quaternion", frame=frame)


def neck_q(i, sway=(0.0, 0.0, 0.0), straighten=0.0, lean=0.0):
    """Pose rotation of throat bone i (0-based): a sway (euler), blended toward straight, and a forward lean about its local X."""
    from mathutils import Quaternion
    q = Quaternion((1, 0, 0, 0))
    if straighten > 0:
        q = Quaternion((1, 0, 0, 0)).slerp(REST_STRAIGHT[f"Neck{i + 1:02d}"], min(1.0, straighten))
    if lean:
        q = q @ Euler((lean, 0, 0), "XYZ").to_quaternion()
    return q @ Euler(sway, "XYZ").to_quaternion()


def key_loc(pb, frame, v):
    pb.location = Vector(v)
    pb.keyframe_insert("location", frame=frame)


def key_scale(pb, frame, s):
    pb.scale = Vector((s, s, s))
    pb.keyframe_insert("scale", frame=frame)


def make_action(arm, name, frames_n, fn, loop=True):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    for f in range(0, frames_n + 1):
        t = f / frames_n  # 0..1 (the last frame equals the first for a loop)
        fn(arm.pose.bones, f + 1, t)
    for fc in act.fcurves if hasattr(act, "fcurves") else []:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
    act.use_fake_user = True
    return act


def neck_wave(pbs, frame, t, amp, speed, lag, gain=1.0, drift=0.0):
    """A wave travelling up the throat: each bone sways in x (nod) and z (side) with a phase lag; amplitude grows toward the tip."""
    for i in range(NECK_BONES):
        pb = pbs[f"Neck{i + 1:02d}"]
        k = (i + 1) / NECK_BONES
        a = amp * (0.35 + 0.9 * k) * gain
        ph = 2 * math.pi * (t * speed - lag * i)
        key_quat(pb, frame, neck_q(i, (a * math.sin(ph) + drift * k, 0, a * 0.8 * math.sin(ph + 1.3))))


def clip_idle(pbs, frame, t):
    w = 2 * math.pi * t
    key_rot(pbs["Spine1"], frame, (0.012 * math.sin(w), 0, 0))
    key_rot(pbs["Spine2"], frame, (0.018 * math.sin(w + 0.5), 0, 0))
    key_rot(pbs["Spine3"], frame, (0.014 * math.sin(w + 1.0), 0, 0.01 * math.sin(w)))
    for s in ("L", "R"):
        key_rot(pbs[f"UpperArm_{s}"], frame, (0.03 * math.sin(w + 0.4), 0, 0.02 * (1 if s == "L" else -1)))
        key_rot(pbs[f"Hand_{s}"], frame, (0.06 * math.sin(w + 1.2), 0, 0))
    neck_wave(pbs, frame, t, 0.075, 1.0, 0.07)
    key_scale(pbs["Maw"], frame, 1.0 + 0.04 * math.sin(w * 2))


def clip_walk(pbs, frame, t):
    w = 2 * math.pi * t
    s1, c1 = math.sin(w), math.cos(w)
    key_loc(pbs["Pelvis"], frame, (0.0, -0.085 + 0.022 * abs(c1), 0.0))  # local Y = world up for the vertical pelvis bone
    key_rot(pbs["Pelvis"], frame, (0, 0.05 * s1, 0.04 * s1))
    key_rot(pbs["Spine2"], frame, (0.05, -0.05 * s1, -0.05 * s1))
    for s, ph in (("L", 0.0), ("R", math.pi)):
        sw = math.sin(w + ph)
        key_rot(pbs[f"Thigh_{s}"], frame, (0.55 * sw, 0, 0))
        key_rot(pbs[f"Shin_{s}"], frame, (max(0.0, -0.9 * math.sin(w + ph - 0.7)) + 0.1, 0, 0))
        key_rot(pbs[f"Foot_{s}"], frame, (-0.25 * sw * 0.6, 0, 0))
        key_rot(pbs[f"UpperArm_{s}"], frame, (-0.30 * sw, 0, 0.03 * (1 if s == "L" else -1)))
        key_rot(pbs[f"Forearm_{s}"], frame, (-0.15 - 0.15 * max(0, -sw), 0, 0))
    neck_wave(pbs, frame, t, 0.10, 2.0, 0.09, 1.0, 0.0)
    key_scale(pbs["Maw"], frame, 1.0 + 0.05 * math.sin(w * 2))


def clip_lunge(pbs, frame, t):
    # 0..0.35 draw back (the throat coils tighter and leans away), 0.35..0.55 whip forward (the throat STRAIGHTENS and leans over the body, the ring
    # opens), then settle
    def sm(a, b, x):
        u = min(1, max(0, (x - a) / (b - a)))
        return u * u * (3 - 2 * u)
    back = sm(0.0, 0.35, t) * (1 - sm(0.35, 0.5, t))
    fwd = sm(0.35, 0.52, t) * (1 - sm(0.62, 1.0, t))
    for i in range(NECK_BONES):
        k = (i + 1) / NECK_BONES
        straight = 1.0 * fwd
        lean = 0.100 * fwd - 0.035 * back  # an even forward arc: 14 bones x 0.1 rad = 80 degrees at the ring
        sway = (-0.10 * k * back, 0, 0.03 * math.sin(2 * math.pi * t * 3 + i))
        key_quat(pbs[f"Neck{i + 1:02d}"], frame, neck_q(i, sway, straight, lean))
    key_rot(pbs["Spine2"], frame, (0.20 * fwd - 0.08 * back, 0, 0))
    key_rot(pbs["Spine3"], frame, (0.14 * fwd - 0.05 * back, 0, 0))
    key_rot(pbs["Pelvis"], frame, (0.12 * fwd, 0, 0))
    key_loc(pbs["Pelvis"], frame, (0.0, -0.03 * fwd, 0.0))
    for s in ("L", "R"):
        key_rot(pbs[f"UpperArm_{s}"], frame, (-0.5 * fwd, 0, 0.08 * (1 if s == "L" else -1) * (1 + fwd)))
    key_scale(pbs["Maw"], frame, 1.0 + 0.7 * fwd + 0.1 * back)


def clip_listen(pbs, frame, t):
    w = 2 * math.pi * t
    for i in range(NECK_BONES):
        k = (i + 1) / NECK_BONES
        key_quat(pbs[f"Neck{i + 1:02d}"], frame, neck_q(i, (0.03 * k * math.sin(w), 0, 0.12 * k * math.sin(w + 0.6 * k))))
    key_rot(pbs["Spine3"], frame, (0, 0, 0.05 * math.sin(w)))
    key_scale(pbs["Maw"], frame, 1.0 + 0.10 * (0.5 + 0.5 * math.sin(w * 2)))
    for s in ("L", "R"):
        key_rot(pbs[f"Hand_{s}"], frame, (0.1 * math.sin(w * 3 + (0 if s == "L" else 1.7)), 0, 0))


# ---------------------------------------------------------------------------------------------------------------------------------
# Export + previews
# ---------------------------------------------------------------------------------------------------------------------------------
def export_glb(arm, ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    arm.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = arm
    glb = os.path.join(args.out, "usher.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_texcoords=False,
                              export_normals=True, export_tangents=False, export_materials="EXPORT", export_skins=True, export_animations=True,
                              export_animation_mode="ACTIONS", export_force_sampling=True, export_def_bones=False, export_rest_position_armature=True,
                              export_morph=False, export_extras=False, export_cameras=False, export_lights=False)
    log("exported", glb, "%.2f MB" % (os.path.getsize(glb) / 1e6))
    return glb


def clay_render(path, cam_loc, target, res=(720, 960), lens=50, samples=None):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples or args.samples
    sc.cycles.use_denoising = True
    sc.render.threads_mode = "FIXED"
    sc.render.threads = 4
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    if sc.world is None:
        sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.012, 0.016, 0.026, 1)
    bg.inputs["Strength"].default_value = 1.0
    for o in list(bpy.data.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o)
    cam_d = bpy.data.cameras.new("Cam")
    cam_d.lens = lens
    cam = bpy.data.objects.new("Cam", cam_d)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = Vector(cam_loc)
    cam.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    def light(name, loc, energy, color, size=1.2):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.color = color
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        bpy.context.scene.collection.objects.link(lo)
        lo.location = Vector(loc)
        lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    tgt = Vector(target)
    light("key", tgt + Vector((-2.2, -2.8, 2.2)), 220, (0.75, 0.85, 1.0), 2.0)
    light("rim", tgt + Vector((2.4, 2.0, 1.6)), 160, (1.0, 0.7, 0.5), 1.5)
    light("fill", tgt + Vector((1.5, -3.0, 0.2)), 40, (0.7, 0.8, 1.0), 2.5)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("render", path)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = build_parts()
    bones = bone_table()
    mats = make_materials()
    ob = build_mesh(parts, bones, mats)
    arm = build_armature(bones)
    # parent with the existing vertex groups (no automatic weights)
    ob.parent = arm
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    # the rest bend of every throat bone (what 'straight' means for the lunge)
    for i in range(NECK_BONES):
        pb = arm.pose.bones[f"Neck{i + 1:02d}"]
        rrel = (pb.parent.bone.matrix_local.inverted() @ pb.bone.matrix_local).to_3x3()
        REST_STRAIGHT[pb.name] = rrel.inverted().to_quaternion()
    # clips
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    clips = [("Idle", 48, clip_idle), ("Walk", 32, clip_walk), ("Lunge", 36, clip_lunge), ("Listen", 60, clip_listen)]
    acts = {}
    for name, n, fn in clips:
        acts[name] = make_action(arm, name, n, fn)
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.animation_data.action = acts["Idle"]
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 49
    mesh = ob.data
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    height = max(c.z for c in bb)
    report = {"tris": tris, "verts": len(mesh.vertices), "bones": len(arm.data.bones), "clips": list(acts.keys()), "height": round(height, 3),
              "throat_length": round(float(NECK_S[-1]), 3), "materials": list(PALETTE.keys())}
    log(json.dumps(report))
    with open(os.path.join(args.out, "usher_report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    export_glb(arm, ob)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    if args.render:
        # previews in the rest pose
        arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.rotation_euler = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        if not args.skip_rest:
          clay_render(os.path.join(RENDER_DIR, "usher_front.png"), (0, -6.5, 2.0), (0, 0, 1.9), (720, 960), 50)
          clay_render(os.path.join(RENDER_DIR, "usher_side.png"), (6.5, 0, 2.0), (0, -0.2, 1.9), (720, 960), 50)
          clay_render(os.path.join(RENDER_DIR, "usher_34.png"), (-4.2, -4.4, 2.6), (0, -0.2, 1.8), (720, 960), 50)
          clay_render(os.path.join(RENDER_DIR, "usher_ring.png"), (0.5, -2.6, 2.4), (0, -0.9, 2.3), (720, 720), 70)
        # the clips: a frame of each, seen from the front three-quarter
        for name, fr in (("Walk", 9), ("Lunge", 22), ("Listen", 20)):
            arm.animation_data.action = acts[name]
            bpy.context.scene.frame_set(fr)
            bpy.context.view_layer.update()
            clay_render(os.path.join(RENDER_DIR, "usher_pose_%s.png" % name.lower()), (-4.6, -5.0, 2.6), (0, -0.2, 1.7), (720, 960), 50)
    log("done")


main()
