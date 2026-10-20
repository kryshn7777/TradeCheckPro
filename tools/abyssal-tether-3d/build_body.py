"""ABYSSAL TETHER 3D — procedural builder for the player's body (first-person safe avatar).

Builds, in Blender, from code (deterministic, no hand-sculpting) an original adventurer-climber of the Lanternwright
setting: waxed-canvas jacket with sleeves that end in a cuff overlapping the arms' elbow cut (matching the arms'
sleeve colour), a climbing harness (leg loops, braces, chest strap, belay ring, gear loops), a heavy leather belt with
pouches and a chalk bag, a distinctive leather-and-canvas BACKPACK (top flap, buckle straps, side pockets, bedroll,
rope coil, padded shoulder straps), trousers with knee pads and thigh pockets, sturdy laced boots with ankle straps
and rope-wear. There is NO head: the neck is closed by a scarf roll, hidden by the first-person camera.

Pipeline: model HIGH (dense tubes with cloth folds, rounded strap sections with stitch rows, rivets, laces) and LOW
game meshes (the same silhouette, ~10 k triangles) -> bake high -> low into one 2048^2 atlas: albedo (sRGB),
normal (OpenGL, tangent space) and ORM (R = AO, G = roughness, B = metalness) -> skin the low mesh to a 22 bone armature
-> author clips (Idle_Stand, Run, Hang_Swing, Fall, Land, Crouch_Idle) -> export one GLB.

Frame: Blender +Y = the character's forward (glTF -Z, the three.js camera forward), +X = the character's right, +Z up,
origin on the floor between the feet. Metres. Eye height 1.62 m (CONFIG VIEW.standEye): the neck base is at 1.45 m.

Run (Blender 5.x or the `bpy` module; a full build is ~10-15 min on 4 cores):
  python build_body.py --out public/abyssal-tether-3d/assets/models --renders <dir> [--render] [--samples 40] [--res 1280x720]
  blender -b -P build_body.py -- <same args>
"""

import argparse
import math
import os
import random
import sys
import time

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector, noise

# -----------------------------------------------------------------------------
# Arguments
# -----------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.getcwd(), "body_out"), help="directory for player_body.glb")
ap.add_argument("--renders", default="", help="directory for the Cycles renders (default: <out>)")
ap.add_argument("--render", action="store_true", help="render the Cycles previews")
ap.add_argument("--samples", type=int, default=40)
ap.add_argument("--res", default="1280x720")
ap.add_argument("--bake", type=int, default=2048, help="atlas size (px)")
ap.add_argument("--bake-samples", type=int, default=24, help="AO bake samples")
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--stage", default="all", help="dev: 'shape' = clay previews only; 'bake' = bake + composite only (no export)")
ap.add_argument("--only", default="", help="dev: comma list of renders to make (front,side,back,fp,run,hang)")
ap.add_argument("--blend", default="", help="dev: save the built .blend here")
ap.add_argument("--cache", default="", help="bake cache dir (default: <renders>/_cache); delete it after geometry changes")
ap.add_argument("--high-edge", type=float, default=0.0055, help="dev: high-poly edge length (m)")
args = ap.parse_args(argv)
args.out = os.path.abspath(args.out)
os.makedirs(args.out, exist_ok=True)
RENDER_DIR = os.path.abspath(args.renders or args.out)
os.makedirs(RENDER_DIR, exist_ok=True)
CACHE_DIR = os.path.abspath(args.cache or os.path.join(RENDER_DIR, "_cache"))
os.makedirs(CACHE_DIR, exist_ok=True)
if args.blend:
    args.blend = os.path.abspath(args.blend)
T0 = time.time()


def log(*a):
    print(f"[body {time.time() - T0:6.1f}s]", *a, flush=True)


noise.seed_set(args.seed)

# -----------------------------------------------------------------------------
# Small maths
# -----------------------------------------------------------------------------
V = lambda x, y, z: Vector((x, y, z))  # noqa: E731


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def sstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def superellipse(a, rx, ry, p):
    c, s = math.cos(a), math.sin(a)
    return math.copysign(abs(c) ** (2.0 / p), c) * rx, math.copysign(abs(s) ** (2.0 / p), s) * ry


def catmull(points, n_per):
    pts = [points[0] * 2 - points[1]] + list(points) + [points[-1] * 2 - points[-2]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(n_per):
            t = k / n_per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(points[-1].copy())
    return out


def transport_frames(pts, up):
    """Rotation-minimising frames along a polyline: list of (T, N, B)."""
    frames = []
    T = (pts[1] - pts[0]).normalized()
    N = (up - T * up.dot(T)).normalized()
    for i in range(len(pts)):
        if i == 0:
            Tn = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            Tn = (pts[-1] - pts[-2]).normalized()
        else:
            Tn = (pts[i + 1] - pts[i - 1]).normalized()
        if i > 0:
            axis = T.cross(Tn)
            if axis.length > 1e-9:
                ang = math.asin(min(1.0, axis.length))
                N = Matrix.Rotation(ang, 3, axis.normalized()) @ N
        T = Tn
        N = (N - T * N.dot(T)).normalized()
        frames.append((T.copy(), N.copy(), T.cross(N).normalized()))
    return frames


def fnoise(p, f, oct_=3, seedv=0.0):
    """Fractal noise in [-1, 1] at frequency f (1/m), anisotropic f may be a Vector."""
    if isinstance(f, Vector):
        q = Vector((p.x * f.x, p.y * f.y, p.z * f.z))
    else:
        q = p * f
    q = q + Vector((seedv * 3.17, seedv * 1.31, seedv * 2.53))
    return noise.fractal(q, 0.55, 2.0, oct_)


class LV:
    """Level of detail: HIGH (bake source) or LOW (the game mesh)."""

    def __init__(self, hi):
        self.hi = hi
        self.edge = args.high_edge if hi else 0.046

    def nseg(self, length, lo=2):
        return max(lo, int(math.ceil(length / self.edge)))

    def ring(self, lo, hi_=None):
        return (hi_ if hi_ is not None else lo * 4) if self.hi else lo


# -----------------------------------------------------------------------------
# Skeleton (right side; the left mirrors x). Blender frame: +Y forward, +X right.
# -----------------------------------------------------------------------------
ARM_DIR = V(math.sin(math.radians(24)), 0.0, -math.cos(math.radians(24)))  # A-pose upper arm direction (right)
SHOULDER = V(0.185, 0.0, 1.415)
UPPER_LEN = 0.30
STUB_LEN = 0.10
ELBOW = SHOULDER + ARM_DIR * UPPER_LEN
STUB_TIP = ELBOW + ARM_DIR * STUB_LEN
HIP = V(0.092, 0.0, 0.92)
KNEE = V(0.092, 0.0, 0.50)
ANKLE = V(0.092, -0.004, 0.095)
BALL = V(0.092, 0.140, 0.040)
TOE_TIP = V(0.092, 0.215, 0.030)
NECK_BASE = V(0.0, 0.0, 1.45)
PELVIS_Y = 0.0

# name: (parent, head, tail, z-axis hint (roll: the bone's local Z points along this))
BONE_DEFS = [
    ("Root", None, V(0, 0, 0), V(0, 0, 0.12), V(0, 1, 0)),
    ("Pelvis", "Root", V(0, 0, 0.93), V(0, 0, 1.00), V(0, -1, 0)),
    ("Spine1", "Pelvis", V(0, 0, 1.00), V(0, 0, 1.22), V(0, -1, 0)),
    ("Spine2", "Spine1", V(0, 0, 1.22), V(0, 0, 1.45), V(0, -1, 0)),
    ("Neck", "Spine2", V(0, 0, 1.45), V(0, 0.01, 1.53), V(0, -1, 0)),
    ("Pack", "Spine2", V(0, -0.14, 1.04), V(0, -0.14, 1.42), V(0, -1, 0)),
]


def side_bones(sg):
    s = "R" if sg > 0 else "L"
    m = lambda v: V(v.x * sg, v.y, v.z)  # noqa: E731
    d = [
        (f"Clavicle_{s}", "Spine2", m(V(0.03, 0.01, 1.405)), m(SHOULDER), V(0, 0, 1)),
        (f"UpperArm_{s}", f"Clavicle_{s}", m(SHOULDER), m(ELBOW), V(0, 1, 0)),
        (f"Forearm_{s}", f"UpperArm_{s}", m(ELBOW), m(STUB_TIP), V(0, 1, 0)),
        (f"Thigh_{s}", "Pelvis", m(HIP), m(KNEE), V(0, 1, 0)),
        (f"Shin_{s}", f"Thigh_{s}", m(KNEE), m(ANKLE), V(0, 1, 0)),
        (f"Foot_{s}", f"Shin_{s}", m(ANKLE), m(BALL), V(0, 0, 1)),
        (f"Toe_{s}", f"Foot_{s}", m(BALL), m(TOE_TIP), V(0, 0, 1)),
        (f"Pouch_{s}", "Pelvis", m(V(0.205, 0.0, 1.02)), m(V(0.205, 0.0, 0.90)), V(0, 1, 0)),
    ]
    return d


ALL_BONES = BONE_DEFS + side_bones(1) + side_bones(-1)
BONE_INDEX = {b[0]: i for i, b in enumerate(ALL_BONES)}
BONE_POS = {b[0]: (b[2], b[3]) for b in ALL_BONES}
log("bones:", len(ALL_BONES))


# -----------------------------------------------------------------------------
# Tubes (limbs) and torso
# -----------------------------------------------------------------------------
class Tube:
    """Closed tube along a Catmull-Rom path; prof(t) = (rn, rb) half-extents along the frame's N and B,
    optional (cn, cb) centre offsets. pt(t, a, off) gives a point on the (superelliptic) surface; the same
    object places straps / pads so every LOD agrees."""

    def __init__(self, ctrl, prof, up, power=2.0, n_dense=120):
        per = max(2, n_dense // (len(ctrl) - 1))
        self.pts = catmull([Vector(c) for c in ctrl], per)
        self.frames = transport_frames(self.pts, Vector(up))
        self.s = [0.0]
        for i in range(1, len(self.pts)):
            self.s.append(self.s[-1] + (self.pts[i] - self.pts[i - 1]).length)
        self.L = self.s[-1]
        self.prof = prof
        self.power = power

    def at(self, t):
        target = clamp(t) * self.L
        s = self.s
        lo, hi_ = 0, len(s) - 1
        while hi_ - lo > 1:
            mid = (lo + hi_) // 2
            if s[mid] <= target:
                lo = mid
            else:
                hi_ = mid
        i = lo
        seg = s[i + 1] - s[i]
        u = (target - s[i]) / seg if seg > 1e-12 else 0.0
        c = self.pts[i].lerp(self.pts[i + 1], u)
        T = self.frames[i][0].lerp(self.frames[i + 1][0], u).normalized()
        N = self.frames[i][1].lerp(self.frames[i + 1][1], u)
        N = (N - T * N.dot(T)).normalized()
        return c, T, N, T.cross(N).normalized()

    def pt(self, t, a, off=0.0):
        c, T, N, B = self.at(t)
        pr = self.prof(t)
        rn, rb = pr[0], pr[1]
        cn, cb = (pr[2], pr[3]) if len(pr) > 2 else (0.0, 0.0)
        x, y = superellipse(a, rn, rb, self.power)
        p = c + N * (x + cn) + B * (y + cb)
        if off:
            nrm = self.nrm(t, a)
            p = p + nrm * off
        return p

    def nrm(self, t, a):
        c, T, N, B = self.at(t)
        pr = self.prof(t)
        rn, rb = pr[0], pr[1]
        x, y = superellipse(a, rn, rb, self.power)
        v = N * (x / (rn * rn)) + B * (y / (rb * rb))
        return v.normalized() if v.length > 1e-9 else N.copy()


def connect_rings(bm, rings, cap0=False, cap1=False, close=True):
    n = len(rings[0])
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(n):
            if not close and k == n - 1:
                break
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    if cap0:
        c = sum((v.co for v in rings[0]), Vector()) / n
        cv = bm.verts.new(c)
        for k in range(n):
            bm.faces.new((cv, rings[0][(k + 1) % n], rings[0][k]))
    if cap1:
        c = sum((v.co for v in rings[-1]), Vector()) / n
        cv = bm.verts.new(c)
        for k in range(n):
            bm.faces.new((rings[-1][k], rings[-1][(k + 1) % n], cv))


def tube_mesh(bm, tube, lv, nring, edge_mul=1.0, disp=None, cap0=False, cap1=False, t0=0.0, t1=1.0, tlist=None):
    """Tessellate a Tube. disp(t, a, p, n) -> radial offset (m) applied along the surface normal (HIGH only)."""
    if tlist is None:
        nseg = lv.nseg(tube.L * (t1 - t0) * edge_mul, 3 if not lv.hi else 8)
        tlist = [t0 + (t1 - t0) * i / nseg for i in range(nseg + 1)]
    rings = []
    for t in tlist:
        ring = []
        for k in range(nring):
            a = 2 * math.pi * k / nring
            p = tube.pt(t, a)
            if disp is not None and lv.hi:
                n = tube.nrm(t, a)
                p = p + n * disp(t, a, p, n)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    connect_rings(bm, rings, cap0, cap1)
    return rings


# Torso table: z, half-width, front depth, back depth, y centre. Right = +X, front = +Y.
TORSO_T = [
    (0.84, 0.172, 0.112, 0.108, 0.000),
    (0.92, 0.170, 0.108, 0.104, 0.000),
    (1.00, 0.158, 0.101, 0.097, 0.000),
    (1.10, 0.160, 0.104, 0.099, 0.002),
    (1.20, 0.172, 0.118, 0.103, 0.004),
    (1.30, 0.184, 0.124, 0.102, 0.006),
    (1.37, 0.192, 0.112, 0.094, 0.004),
    (1.41, 0.190, 0.098, 0.086, 0.000),
    (1.43, 0.168, 0.088, 0.078, -0.002),
    (1.45, 0.126, 0.078, 0.070, -0.004),
    (1.47, 0.090, 0.072, 0.066, -0.004),
    (1.50, 0.078, 0.068, 0.064, -0.004),
]
TORSO_P = 2.35


def tdims(z):
    z = clamp(z, TORSO_T[0][0], TORSO_T[-1][0])
    for i in range(len(TORSO_T) - 1):
        a, b = TORSO_T[i], TORSO_T[i + 1]
        if z <= b[0]:
            u = (z - a[0]) / (b[0] - a[0])
            u = u * u * (3 - 2 * u) * 0.5 + u * 0.5  # a little smoothing between the stations
            return tuple(lerp(a[k], b[k], u) for k in range(1, 5))
    return TORSO_T[-1][1:]


def torso_pt(z, ang, off=0.0, power=TORSO_P):
    """Point on the jacket surface at height z, angle ang (0 = +X right, 90 deg = front +Y)."""
    hw, df, db, cy = tdims(z)
    c, s = math.cos(ang), math.sin(ang)
    x = math.copysign(abs(c) ** (2.0 / power), c) * hw
    d = df if s >= 0 else db
    y = math.copysign(abs(s) ** (2.0 / power), s) * d
    p = V(x, cy + y, z)
    if off:
        n = V(x / (hw * hw), y / (d * d), 0.0)
        if n.length > 1e-9:
            p = p + n.normalized() * off
    return p


def torso_nrm(z, ang):
    """Outward surface normal (includes the slope of the shoulder dome)."""
    d = 0.01
    pa = torso_pt(z, ang + d) - torso_pt(z, ang - d)
    zz0, zz1 = max(TORSO_T[0][0], z - 0.006), min(TORSO_T[-1][0], z + 0.006)
    pz = torso_pt(zz1, ang) - torso_pt(zz0, ang)
    n = pa.cross(pz)
    if n.length < 1e-12:
        return V(math.cos(ang), math.sin(ang), 0)
    n.normalize()
    hw, df, db, cy = tdims(z)
    c = torso_pt(z, ang)
    if n.dot(V(c.x, c.y - cy, 0.0)) < 0:
        n = -n
    return n


def za_path(pts_za, sg=1):
    """Control list [(z, angle_deg)] -> smooth function t -> (point on the jacket, outward normal)."""
    ctrl = [Vector((z, math.radians(a if sg > 0 else 180 - a), 0.0)) for z, a in pts_za]
    dense = catmull(ctrl, 14)
    length = 0.0
    prev = None
    for v in dense:
        p = torso_pt(v.x, v.y)
        if prev is not None:
            length += (p - prev).length
        prev = p

    def fn(t):
        f = clamp(t) * (len(dense) - 1)
        i = min(int(f), len(dense) - 2)
        v = dense[i].lerp(dense[i + 1], f - i)
        return torso_pt(v.x, v.y), torso_nrm(v.x, v.y)
    return fn, length


# -----------------------------------------------------------------------------
# Strips / ribbons (straps, belts), stitched on HIGH
# -----------------------------------------------------------------------------
def rrect(hw, th, r, seg, stitch=None):
    """Rounded-rect section (u across, v out) from the underside, CCW. Returns [(u, v, tag)]."""
    pts = []
    corners = [(hw, 0.0, 0.0), (hw, th, math.pi / 2), (-hw, th, math.pi), (-hw, 0.0, 3 * math.pi / 2)]
    # build in the order: bottom-right -> top-right -> top-left -> bottom-left
    for ci, (cx, cy, a0) in enumerate(corners):
        sx = 1 if cx > 0 else -1
        sy = 1 if cy > 0 else -1
        ccx, ccy = cx - sx * r, cy - sy * r
        start = {0: -math.pi / 2, 1: 0.0, 2: math.pi / 2, 3: math.pi}[ci]
        if seg == 0:
            pts.append((cx, cy, "c"))
        else:
            for k in range(seg + 1):
                a = start + (math.pi / 2) * k / seg
                pts.append((ccx + r * math.cos(a), ccy + r * math.sin(a), "c"))
        # extra stations on the top face between corner 1 and 2 (stitch rows)
        if ci == 1 and stitch is not None:
            pts.append((hw - stitch, th, "st+"))
            pts.append((-hw + stitch, th, "st-"))
    return pts


def ribbon(bm, centres, outs, lv, width, thick, loop=False, r=0.0015, stitch=0.0035, edge=None, tw=None, caps=True, stitch_h=0.0004):
    """Flat strap following `centres` (points ON the surface), lying along `outs` (unit surface normals).
    Section: width x thick rounded rectangle (stitch rows on HIGH). tw(i) optional width scale."""
    n = len(centres)
    sec_hi = rrect(width / 2, thick, r, 2 if lv.hi else 0, stitch if lv.hi else None)
    rings = []
    s = 0.0
    for i in range(n):
        c = centres[i]
        if i > 0:
            s += (centres[i] - centres[i - 1]).length
        if loop:
            Tn = (centres[(i + 1) % n] - centres[(i - 1) % n]).normalized()
        elif i == 0:
            Tn = (centres[1] - centres[0]).normalized()
        elif i == n - 1:
            Tn = (centres[-1] - centres[-2]).normalized()
        else:
            Tn = (centres[i + 1] - centres[i - 1]).normalized()
        o = outs[i]
        w = Tn.cross(o)
        if w.length < 1e-6:
            w = V(1, 0, 0)
        w.normalize()
        o2 = w.cross(Tn).normalized()
        k_w = tw(i) if tw else 1.0
        ring = []
        for (u, v, tag) in sec_hi:
            vv = v
            if lv.hi and tag.startswith("st"):
                vv += stitch_h if (i % 4) < 2 else 0.0
            ring.append(bm.verts.new(c + w * (u * k_w) + o2 * vv))
        rings.append(ring)
    m = len(rings[0])
    nr = n if loop else n - 1
    for i in range(nr):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(m):
            bm.faces.new((a[k], b[k], b[(k + 1) % m], a[(k + 1) % m]))
    if caps and not loop:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            if rev:
                bm.faces.new(ring[::-1])
            else:
                bm.faces.new(ring)
    return rings


def resample(path_fn, length, lv, step_hi=0.0016, step_lo=0.045):
    n = max(3, int(math.ceil(length / (step_hi if lv.hi else step_lo))))
    return [path_fn(i / n) for i in range(n + 1)]


def surf_strap(bm, lv, fn, length, width, thick, off=0.0015, loop=False, **kw):
    """Strap hugging a surface: fn(t) -> (point_on_surface, outward_normal)."""
    step = 0.0016 if lv.hi else 0.05
    n = max(4, int(math.ceil(length / step)))
    cs, ns = [], []
    rng = n if loop else n + 1
    for i in range(rng):
        t = i / n
        p, nn = fn(t)
        cs.append(p + nn * off)
        ns.append(nn)
    return ribbon(bm, cs, ns, lv, width, thick, loop=loop, **kw)


# -----------------------------------------------------------------------------
# Primitive solids (HIGH rounded, LOW lean)
# -----------------------------------------------------------------------------
def spow(x, e):
    return math.copysign(abs(x) ** e, x)


def superquad(bm, centre, axes, half, e1, e2, nu, nv):
    """Barr superellipsoid (boxy for e<1): axes = (X, Y, Z) unit vectors, half = (a, b, c)."""
    X, Y, Z = axes
    a, b, c = half
    top = bm.verts.new(centre + Z * c)
    bot = bm.verts.new(centre - Z * c)
    rows = []
    for j in range(1, nv):
        v = -math.pi / 2 + math.pi * j / nv
        cv, sv = spow(math.cos(v), e1), spow(math.sin(v), e1)
        row = []
        for i in range(nu):
            u = -math.pi + 2 * math.pi * i / nu
            cu, su = spow(math.cos(u), e2), spow(math.sin(u), e2)
            row.append(bm.verts.new(centre + X * (a * cv * cu) + Y * (b * cv * su) + Z * (c * sv)))
        rows.append(row)
    # rows run from the bottom (v = -pi/2 + ..) to the top
    for i in range(nu):
        bm.faces.new((bot, rows[0][(i + 1) % nu], rows[0][i]))
        bm.faces.new((top, rows[-1][i], rows[-1][(i + 1) % nu]))
    for ra, rb in zip(rows[:-1], rows[1:]):
        for i in range(nu):
            bm.faces.new((ra[i], ra[(i + 1) % nu], rb[(i + 1) % nu], rb[i]))
    return rows


def frame3(fwd, up_hint):
    """Orthonormal (X, Y, Z) with Y = fwd (unit), Z closest to up_hint."""
    Y = Vector(fwd).normalized()
    Z = (Vector(up_hint) - Y * Vector(up_hint).dot(Y)).normalized()
    X = Y.cross(Z).normalized()
    return X, Y, Z


def box_solid(bm, centre, axes, half, r=0.0):
    """Closed box (8 verts), optionally with a chamfer r (HIGH)."""
    X, Y, Z = axes
    hx, hy, hz = half
    vs = [bm.verts.new(centre + X * (sx * hx) + Y * (sy * hy) + Z * (sz * hz))
          for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    faces = [bm.faces.new([vs[i] for i in f]) for f in fs]
    if r > 0:
        edges = list({e for f in faces for e in f.edges})
        bmesh.ops.bevel(bm, geom=edges + vs, offset=r, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    return vs


def frame_ring(bm, centre, axes, w, h, bar, thick, lv):
    """Rectangular buckle / D-frame (flat metal frame): outer w x h, bar width `bar`, plate thickness `thick`."""
    X, Y, Z = axes  # X across, Y up the strap, Z out of the surface
    ow, oh, iw, ih = w / 2, h / 2, w / 2 - bar, h / 2 - bar
    def v4(a, b, z):
        return [bm.verts.new(centre + X * sx * a + Y * sy * b + Z * z) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    ob, ot = v4(ow, oh, 0), v4(ow, oh, thick)
    ib, it = v4(iw, ih, 0), v4(iw, ih, thick)
    for k in range(4):
        k2 = (k + 1) % 4
        bm.faces.new((ob[k], ob[k2], ot[k2], ot[k]))        # outer wall
        bm.faces.new((ib[k2], ib[k], it[k], it[k2]))        # inner wall
        bm.faces.new((ot[k], ot[k2], it[k2], it[k]))        # top
        bm.faces.new((ob[k2], ob[k], ib[k], ib[k2]))        # underside
    return ob


def cyl_solid(bm, a, b, ra, rb, seg, cap=True):
    """Cylinder / cone from a to b."""
    ax = (b - a)
    L = ax.length
    T = ax / L
    ref = V(0, 0, 1) if abs(T.z) < 0.9 else V(1, 0, 0)
    N = (ref - T * ref.dot(T)).normalized()
    B = T.cross(N)
    r0, r1 = [], []
    for k in range(seg):
        ang = 2 * math.pi * k / seg
        d = N * math.cos(ang) + B * math.sin(ang)
        r0.append(bm.verts.new(a + d * ra))
        r1.append(bm.verts.new(b + d * rb))
    for k in range(seg):
        bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    if cap:
        bm.faces.new(r0[::-1])
        bm.faces.new(r1)
    return r0, r1


def sweep_circle(bm, pts, radius, seg, closed=False):
    """Round wire along pts (rope, carabiner)."""
    frames = transport_frames(pts, V(0, 0, 1) if abs((pts[1] - pts[0]).normalized().z) < 0.9 else V(1, 0, 0))
    rings = []
    for p, (T, N, B) in zip(pts, frames):
        rr = radius(p) if callable(radius) else radius
        rings.append([bm.verts.new(p + N * (rr * math.cos(2 * math.pi * k / seg)) + B * (rr * math.sin(2 * math.pi * k / seg))) for k in range(seg)])
    n = len(rings)
    for i in range(n if closed else n - 1):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if not closed:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    return rings


# -----------------------------------------------------------------------------
# Parts
# -----------------------------------------------------------------------------
HW = [None]  # the brass hardware bmesh of the level being built (buckles, studs, eyelets, rivets)


def hwbm():
    return HW[0]


class Part:
    def __init__(self, name, cls, group, bm):
        self.name, self.cls, self.group, self.bm = name, cls, group, bm


def mirror_bm(bm):
    for v in bm.verts:
        v.co.x = -v.co.x
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])


def sided(build_fn, parts, name, cls, group_fmt, lv, left=True):
    """Build the right side, then the left (mirrored with a different noise seed)."""
    for sg in ((1, -1) if left else (1,)):
        bm = bmesh.new()
        outer_hw = HW[0]
        HW[0] = bmesh.new()
        build_fn(bm, lv, sg)
        if sg < 0:
            mirror_bm(bm)
            mirror_bm(HW[0])
        me = bpy.data.meshes.new("hw_tmp")
        HW[0].to_mesh(me)
        HW[0].free()
        HW[0] = outer_hw
        HW[0].from_mesh(me)
        bpy.data.meshes.remove(me)
        s = "R" if sg > 0 else "L"
        parts.append(Part(f"{name}_{s}", cls, group_fmt.format(s=s), bm))


def drape(p, amp, f, seed, oct_=3):
    return amp * fnoise(p, f, oct_, seed)


# ---- jacket (torso) ------------------------------------------------------------
def build_jacket(lv):
    bm = bmesh.new()
    nring = lv.ring(28, 112)
    zs_lo = [0.84, 0.88, 0.92, 0.96, 1.00, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.345, 1.38, 1.405, 1.425, 1.445, 1.465, 1.485, 1.50]
    if lv.hi:
        zs = []
        n = int((1.50 - 0.84) / 0.0055)
        zs = [0.84 + (1.50 - 0.84) * i / n for i in range(n + 1)]
    else:
        zs = zs_lo
    rings = []
    for z in zs:
        ring = []
        for k in range(nring):
            a = 2 * math.pi * k / nring
            p = torso_pt(z, a)
            if lv.hi:
                n3 = torso_nrm(z, a)
                d = 0.0
                # hem flare + belt compression creases + long vertical drape folds
                d += 0.0034 * fnoise(V(p.x * 2.2, p.y * 2.2, p.z * 7.0), 1.0, 3, 1.1) * (0.5 + 0.5 * sstep(1.12, 0.86, z))
                d += 0.0022 * math.sin(7.0 * a + 2.0 * z * 6.0) * sstep(1.12, 0.98, z) * sstep(0.80, 0.98, z)
                d += 0.0030 * math.exp(-((z - 1.045) / 0.022) ** 2) * (0.5 + 0.5 * math.sin(11 * a + 1.3))  # tucked-in pinch above the belt
                d += 0.0016 * fnoise(V(p.x * 20, p.y * 20, p.z * 20), 1.0, 2, 4.4)
                # front placket groove + buttons seam
                if a > math.radians(84) and a < math.radians(96) and 0.98 < z < 1.45:
                    d -= 0.0024 * math.exp(-((a - math.pi / 2) / 0.018) ** 2)
                d -= 0.0016 * math.exp(-((z - 1.38) / 0.004) ** 2)  # yoke seam
                p = p + n3 * d
            ring.append(bm.verts.new(p))
        rings.append(ring)
    connect_rings(bm, rings, cap0=False, cap1=True)
    return Part("Jacket", "canvas", "torso", bm)


def build_sleeve(bm, lv, sg):
    """Upper-arm sleeve (right-side coordinates): shoulder -> elbow, closed by a flat cuff end that the stub pokes through."""
    start = SHOULDER + V(-0.045, 0.0, 0.020)
    end = ELBOW + ARM_DIR * 0.004
    mid = SHOULDER.lerp(ELBOW, 0.5) + V(0.003, 0.004, 0)
    ctrl = [start, SHOULDER, mid, end]
    L0 = (SHOULDER - start).length

    def prof(t):
        u = clamp((t * tube_L[0] - L0) / UPPER_LEN)  # 0 at the shoulder joint -> 1 at the elbow
        r = lerp(0.062, 0.047, sstep(0.0, 0.7, u))
        r *= 1.0 + 0.035 * math.sin(math.pi * u)
        r -= 0.0035 * sstep(0.75, 1.0, u)
        return (r * 1.0, r * 0.96)

    tube_L = [0.46]
    tube = Tube(ctrl, prof, V(0, 1, 0), 2.1, 90)
    tube_L[0] = tube.L

    def disp(t, a, p, n):
        u = clamp((t * tube.L - L0) / UPPER_LEN)
        d = 0.0035 * fnoise(p, V(9, 9, 9), 3, 2.0 + sg)
        d += 0.0016 * math.sin(2 * a + 7.0 * t) * (0.5 + 0.5 * t)
        if u > 0.55:
            k = (u - 0.55) / 0.45
            d += 0.0017 * math.sin(2 * math.pi * (u * 15.0) + 2.5 * fnoise(p, 12.0, 2, 5.0)) * (0.5 + 0.5 * math.cos(a)) * math.sin(math.pi * k * 0.9)  # elbow compression folds
        for sa in (math.pi / 2, 3 * math.pi / 2):
            d -= 0.0014 * math.exp(-((a - sa) / 0.03) ** 2)  # seams
        return d

    tube_mesh(bm, tube, lv, lv.ring(12, 56), disp=disp, cap0=False, cap1=True)


def build_stub(bm, lv, sg):
    """Forearm stub: the same canvas, slides into the arms' sleeve (its open end sits ~6 cm past the elbow joint)."""
    a0 = ELBOW - ARM_DIR * 0.030
    a1 = STUB_TIP + ARM_DIR * 0.014
    tube = Tube([a0, a1], lambda t: (0.0355 - 0.0035 * t, 0.0355 - 0.0035 * t), V(0, 1, 0), 2.0, 6)

    def disp(t, a, p, n):
        return 0.0016 * fnoise(p, V(14, 14, 14), 2, 3.0 + sg) + 0.0014 * math.sin(2 * math.pi * t * 6.5 + a)

    tube_mesh(bm, tube, lv, lv.ring(10, 40), disp=disp, cap0=False, cap1=True, edge_mul=1.0)


def build_sleeve_part(lv):
    parts = []
    sided(build_sleeve, parts, "Sleeve", "canvas", "arm_{s}", lv)
    sided(build_stub, parts, "Stub", "canvas", "stub_{s}", lv)
    return parts


def build_elbow_strap(bm, lv, sg):
    """Leather cuff strap around the elbow joint end of the upper-arm sleeve + a brass roller buckle."""
    pos = SHOULDER + ARM_DIR * (UPPER_LEN - 0.012)
    T = ARM_DIR.normalized()
    N = V(0, 1, 0)
    B = T.cross(N)
    r0 = 0.0505
    n = 40 if lv.hi else 12
    cs, ns = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        o = N * math.cos(a) + B * math.sin(a)
        cs.append(pos + o * (r0 * (1.0 if abs(math.cos(a)) > 0.5 else 0.97)))
        ns.append(o)
    ribbon(bm, cs, ns, lv, 0.026, 0.0045, loop=True)
    # buckle on the outside
    outer = pos + B * (r0 + 0.003)
    box_solid(hwbm(), outer, (N, T, B), (0.008, 0.011, 0.0022), 0.0006 if lv.hi else 0)


# ---- trousers --------------------------------------------------------------------
def leg_prof(t):
    # z from the hip to the boot top: sample against z
    z = 0.93 - t * (0.93 - 0.245)
    knots = [(0.93, 0.094, 0.098), (0.82, 0.088, 0.094), (0.70, 0.079, 0.082), (0.58, 0.069, 0.071), (0.50, 0.064, 0.066),
             (0.44, 0.063, 0.066), (0.38, 0.065, 0.068), (0.32, 0.054, 0.056), (0.285, 0.049, 0.051), (0.245, 0.047, 0.048)]
    for i in range(len(knots) - 1):
        a, b = knots[i], knots[i + 1]
        if z >= b[0]:
            u = (z - b[0]) / (a[0] - b[0])
            u = u * u * (3 - 2 * u)
            return (lerp(b[1], a[1], u), lerp(b[2], a[2], u))
    return knots[-1][1:]


LEG_PATH = [V(0.092, 0.0, 0.93), V(0.093, 0.002, 0.72), V(0.092, 0.004, 0.50), V(0.092, 0.0, 0.38), V(0.092, -0.004, 0.245)]


def make_leg_tube():
    return Tube(LEG_PATH, lambda t: (leg_prof(t)[1], leg_prof(t)[0], 0.0, 0.0), V(0, 1, 0), 2.15, 100)


LEG = make_leg_tube()


def leg_t_of_z(z):
    return clamp((0.93 - z) / (0.93 - 0.245))


def build_leg(bm, lv, sg):
    nring = lv.ring(14, 64)

    def disp(t, a, p, n):
        z = p.z
        d = 0.0042 * fnoise(p, V(11, 11, 7), 3, 5.0 + sg)
        d += 0.0030 * fnoise(p, V(34, 34, 34), 2, 8.0)
        # knee creases (front fold + back-of-knee gather)
        kz = 0.50
        d += 0.0034 * math.sin(2 * math.pi * (z - kz) / 0.034) * math.exp(-((z - kz) / 0.07) ** 2) * (0.3 + 0.7 * max(0.0, -math.sin(a)))
        # thigh crotch/hip drape
        d += 0.0030 * math.sin(3 * a + 5 * z) * sstep(0.62, 0.9, z)
        # cuff gathering
        d += 0.0030 * math.sin(2 * math.pi * z / 0.019) * sstep(0.34, 0.27, z) * (0.6 + 0.4 * math.sin(3 * a))
        # outer seam
        d -= 0.0018 * math.exp(-((a - math.pi / 2) / 0.03) ** 2)
        d -= 0.0016 * math.exp(-((a - 3 * math.pi / 2) / 0.03) ** 2)
        return d

    tube_mesh(bm, LEG, lv, nring, disp=disp, cap0=False, cap1=True)


def build_hips(lv):
    bm = bmesh.new()
    nring = lv.ring(24, 96)
    zs = [1.05, 1.02, 0.98, 0.94, 0.90, 0.86, 0.82, 0.78]
    if lv.hi:
        n = int(0.27 / 0.0055)
        zs = [1.05 - 0.27 * i / n for i in range(n + 1)]
    pts = {1.05: (0.150, 0.092, 0.090), 1.0: (0.154, 0.095, 0.092), 0.94: (0.166, 0.102, 0.104), 0.88: (0.172, 0.106, 0.110), 0.82: (0.178, 0.104, 0.108), 0.78: (0.172, 0.096, 0.100)}
    keys = sorted(pts.keys())

    def dims(z):
        z = clamp(z, keys[0], keys[-1])
        for i in range(len(keys) - 1):
            if z <= keys[i + 1]:
                u = (z - keys[i]) / (keys[i + 1] - keys[i])
                return tuple(lerp(pts[keys[i]][k], pts[keys[i + 1]][k], u) for k in range(3))
        return pts[keys[-1]]

    rings = []
    for z in zs:
        hw, df, db = dims(z)
        ring = []
        for k in range(nring):
            a = 2 * math.pi * k / nring
            c, s = math.cos(a), math.sin(a)
            x = math.copysign(abs(c) ** (2 / 2.3), c) * hw
            y = math.copysign(abs(s) ** (2 / 2.3), s) * (df if s >= 0 else db)
            p = V(x, y, z - 0.0)
            if lv.hi:
                p += V(x / hw, y / (df if s >= 0 else db), 0).normalized() * 0.0035 * fnoise(p, V(9, 9, 9), 3, 6.5)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    connect_rings(bm, rings, cap0=True, cap1=True)
    return Part("Hips", "twill", "hips", bm)


def build_knee_pad(bm, lv, sg):
    """Leather knee cap: a shell patch hugging the front of the knee, with a strap pair and rivets."""
    t0, t1 = leg_t_of_z(0.575), leg_t_of_z(0.425)
    a0, a1 = math.radians(-48), math.radians(48)
    nu = lv.nseg(0.15, 6) if lv.hi else 4
    nv = lv.nseg(0.12, 5) if lv.hi else 4
    thick = 0.011
    grid_o, grid_i = [], []
    for i in range(nu + 1):
        tt = lerp(t0, t1, i / nu)
        ro, ri = [], []
        for j in range(nv + 1):
            aa = lerp(a0, a1, j / nv)
            edge = min(i, nu - i, j, nv - j)
            # dome: thicker in the middle, tapering (rounded edge)
            e = clamp(edge / (2.0 if lv.hi else 1.0))
            thk = 0.001 + (thick - 0.001) * math.sin(e * math.pi / 2) ** 0.7
            base = LEG.pt(tt, aa, 0.0015)
            ro.append(bm.verts.new(base + LEG.nrm(tt, aa) * thk))
            ri.append(bm.verts.new(base))
        grid_o.append(ro)
        grid_i.append(ri)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((grid_o[i][j], grid_o[i + 1][j], grid_o[i + 1][j + 1], grid_o[i][j + 1]))
    # skirt closing the patch edge
    for i in range(nu):
        bm.faces.new((grid_i[i][0], grid_i[i + 1][0], grid_o[i + 1][0], grid_o[i][0]))
        bm.faces.new((grid_i[i + 1][nv], grid_i[i][nv], grid_o[i][nv], grid_o[i + 1][nv]))
    for j in range(nv):
        bm.faces.new((grid_i[0][j + 1], grid_i[0][j], grid_o[0][j], grid_o[0][j + 1]))
        bm.faces.new((grid_i[nu][j], grid_i[nu][j + 1], grid_o[nu][j + 1], grid_o[nu][j]))
    if lv.hi:  # rivets in the corners and a strap around the leg above the pad
        for tt in (leg_t_of_z(0.565), leg_t_of_z(0.435)):
            for aa in (math.radians(-32), math.radians(32)):
                p = LEG.pt(tt, aa, 0.0125)
                n = LEG.nrm(tt, aa)
                cyl_solid(hwbm(), p - n * 0.001, p + n * 0.0028, 0.0042, 0.0034, 8)


def build_thigh_pocket(bm, lv, sg):
    """Cargo patch pocket on the outer-front thigh with a buttoned flap."""
    t0, t1 = leg_t_of_z(0.80), leg_t_of_z(0.62)
    a0, a1 = math.radians(14), math.radians(86)
    nu = lv.nseg(0.18, 3)
    nv = lv.nseg(0.10, 3)
    go, gi = [], []
    for i in range(nu + 1):
        tt = lerp(t0, t1, i / nu)
        ro, ri = [], []
        for j in range(nv + 1):
            aa = lerp(a0, a1, j / nv)
            edge = min(i, nu - i, j, nv - j)
            e = clamp(edge / (2.0 if lv.hi else 1.0))
            thk = 0.0010 + 0.0075 * math.sin(e * math.pi / 2) ** 0.6
            base = LEG.pt(tt, aa, 0.0010)
            ro.append(bm.verts.new(base + LEG.nrm(tt, aa) * thk))
            ri.append(bm.verts.new(base))
        go.append(ro)
        gi.append(ri)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((go[i][j], go[i + 1][j], go[i + 1][j + 1], go[i][j + 1]))
    for i in range(nu):
        bm.faces.new((gi[i][0], gi[i + 1][0], go[i + 1][0], go[i][0]))
        bm.faces.new((gi[i + 1][nv], gi[i][nv], go[i][nv], go[i + 1][nv]))
    for j in range(nv):
        bm.faces.new((gi[0][j + 1], gi[0][j], go[0][j], go[0][j + 1]))
        bm.faces.new((gi[nu][j], gi[nu][j + 1], go[nu][j + 1], go[nu][j]))
    # flap (a second, slightly larger shell patch over the upper third)
    tf0, tf1 = leg_t_of_z(0.805), leg_t_of_z(0.725)
    nuf = lv.nseg(0.08, 2)
    fo, fi = [], []
    for i in range(nuf + 1):
        tt = lerp(tf0, tf1, i / nuf)
        taper = 1.0 - 0.28 * (i / nuf) ** 2
        ro, ri = [], []
        for j in range(nv + 1):
            aa = lerp(a0 - 0.02, a1 + 0.02, j / nv)
            aa = (a0 + a1) / 2 + (aa - (a0 + a1) / 2) * taper
            edge = min(i, nuf - i, j, nv - j)
            e = clamp(edge / (2.0 if lv.hi else 1.0))
            thk = 0.0090 + 0.0030 * math.sin(e * math.pi / 2) ** 0.6
            base = LEG.pt(tt, aa, 0.0010)
            ro.append(bm.verts.new(base + LEG.nrm(tt, aa) * thk))
            ri.append(bm.verts.new(base + LEG.nrm(tt, aa) * 0.0070))
        fo.append(ro)
        fi.append(ri)
    for i in range(nuf):
        for j in range(nv):
            bm.faces.new((fo[i][j], fo[i + 1][j], fo[i + 1][j + 1], fo[i][j + 1]))
    for i in range(nuf):
        bm.faces.new((fi[i][0], fi[i + 1][0], fo[i + 1][0], fo[i][0]))
        bm.faces.new((fi[i + 1][nv], fi[i][nv], fo[i][nv], fo[i + 1][nv]))
    for j in range(nv):
        bm.faces.new((fi[0][j + 1], fi[0][j], fo[0][j], fo[0][j + 1]))
        bm.faces.new((fi[nuf][j], fi[nuf][j + 1], fo[nuf][j + 1], fo[nuf][j]))
    # button
    p = LEG.pt(tf1, (a0 + a1) / 2, 0.0135)
    n = LEG.nrm(tf1, (a0 + a1) / 2)
    cyl_solid(hwbm(), p - n * 0.001, p + n * 0.003, 0.0058, 0.0050, 10 if lv.hi else 6)


# ---- boots -------------------------------------------------------------------------
BOOT_STN = [
    # y, z_bottom, z_top, half width, (x centre offset)
    (0.216, 0.022, 0.046, 0.026),
    (0.205, 0.017, 0.062, 0.037),
    (0.180, 0.014, 0.074, 0.047),
    (0.140, 0.014, 0.080, 0.052),
    (0.090, 0.015, 0.088, 0.049),
    (0.040, 0.016, 0.108, 0.046),
    (-0.005, 0.016, 0.135, 0.046),
    (-0.050, 0.016, 0.125, 0.046),
    (-0.085, 0.024, 0.090, 0.038),
    (-0.098, 0.034, 0.066, 0.026),
]


def boot_dims(y):
    y = clamp(y, BOOT_STN[-1][0], BOOT_STN[0][0])
    for i in range(len(BOOT_STN) - 1):
        a, b = BOOT_STN[i], BOOT_STN[i + 1]
        if y >= b[0]:
            u = (y - b[0]) / (a[0] - b[0])
            u = u * u * (3 - 2 * u)
            return tuple(lerp(b[k], a[k], u) for k in range(1, 4))
    return BOOT_STN[-1][1:]


def build_boot_foot(bm, lv, sg):
    """Foot + toe cap loft along Y (ring in the XZ plane at each station)."""
    nring = lv.ring(14, 56)
    ys = [0.216, 0.205, 0.180, 0.140, 0.090, 0.040, -0.005, -0.050, -0.085, -0.098]
    if lv.hi:
        n = int(0.314 / 0.0055)
        ys = [0.216 - 0.314 * i / n for i in range(n + 1)]
    rings = []
    for y in ys:
        zb, zt, hw = boot_dims(y)
        zc, hz = (zb + zt) / 2, (zt - zb) / 2
        ring = []
        for k in range(nring):
            a = 2 * math.pi * k / nring
            c, s = math.cos(a), math.sin(a)
            x = math.copysign(abs(c) ** (2 / 2.4), c) * hw
            z = zc + math.copysign(abs(s) ** (2 / 2.2), s) * hz
            p = V(0.092 + x, y, z)
            if lv.hi:
                # instep creases across the flex line + toe cap seam + welt line
                nrm = V(x / hw, 0, (z - zc) / hz).normalized()
                d = 0.0016 * fnoise(p, V(25, 25, 25), 2, 9.0)
                if s > 0.2:
                    d += 0.0010 * math.sin(2 * math.pi * (y - 0.09) / 0.02 + 3 * fnoise(p, 14.0, 2, 3.0)) * math.exp(-((y - 0.095) / 0.04) ** 2)
                    d -= 0.0016 * math.exp(-((y - 0.165) / 0.0035) ** 2)  # toe cap seam
                d += 0.0016 * math.exp(-((z - (zb + 0.014)) / 0.0035) ** 2)  # welt bulge
                p = p + nrm * d
            ring.append(bm.verts.new(p))
        rings.append(ring)
    connect_rings(bm, rings, cap0=True, cap1=True)


def build_boot_shaft(bm, lv, sg):
    nring = lv.ring(14, 56)
    c0 = V(0.092, -0.008, 0.075)
    c1 = V(0.092, -0.006, 0.272)
    ctrl = [c0, V(0.092, -0.007, 0.15), c1]

    def prof(t):
        z = 0.075 + t * 0.197
        r = lerp(0.050, 0.052, sstep(0.0, 0.5, t))
        r += 0.006 * math.exp(-((z - 0.268) / 0.012) ** 2)  # padded rim
        r -= 0.002 * math.exp(-((z - 0.255) / 0.006) ** 2)
        return (r, r * 1.04)

    tube = Tube(ctrl, prof, V(0, 1, 0), 2.1, 20)

    def disp(t, a, p, n):
        z = p.z
        d = 0.0016 * fnoise(p, V(25, 25, 25), 2, 10.0)
        d += 0.0009 * math.sin(2 * math.pi * z / 0.026 + 2 * a + 4 * fnoise(p, 14.0, 2, 3.0)) * math.exp(-((z - 0.12) / 0.05) ** 2)  # ankle wrinkles
        return d

    tube_mesh(bm, tube, lv, nring, disp=disp, cap0=False, cap1=True)


def build_boot_sole(bm, lv, sg):
    """Rubber sole + welt + heel block: loft with the outline slightly larger than the upper."""
    nring = lv.ring(10, 40)
    ys = [0.226, 0.212, 0.185, 0.140, 0.090, 0.040, 0.0, -0.040, -0.082, -0.103]
    if lv.hi:
        n = int(0.329 / 0.0055)
        ys = [0.226 - 0.329 * i / n for i in range(n + 1)]
    rings = []
    for y in ys:
        zb, zt, hw = boot_dims(clamp(y, -0.098, 0.216))
        tip = 1.0 - sstep(0.205, 0.226, y) * 0.8 - sstep(-0.085, -0.103, y) * 0.8
        hh = 0.0225 * (1.0 + (0.45 if y < -0.01 and y > -0.07 else 0.0))  # heel block is thicker
        ring = []
        for k in range(nring):
            a = 2 * math.pi * k / nring
            c, s = math.cos(a), math.sin(a)
            x = math.copysign(abs(c) ** (2 / 3.0), c) * (hw + 0.0095) * tip
            z = hh * 0.5 + math.copysign(abs(s) ** (2 / 3.0), s) * hh * 0.5 * (0.9 + 0.1 * tip)
            p = V(0.092 + x, y, z + 0.0)
            if lv.hi and s < -0.3:  # lug tread on the underside
                p.z += 0.0020 * (1 if (math.sin(y * 330) * math.sin(x * 280) > 0.0) else -0.2)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    connect_rings(bm, rings, cap0=True, cap1=True)


def build_boot_laces(bm, lv, sg):
    """Rope laces (criss-cross), eyelets, and the ankle strap with a brass frame buckle."""
    # stations (y, z) along the front line of the instep, then up the shaft front; x offset of the eyelets +-0.019
    st = [(0.140, 0.086), (0.112, 0.090), (0.084, 0.097), (0.056, 0.112)]
    rs = 0.052
    for z in (0.135, 0.162, 0.189, 0.216, 0.243):
        st.append((-0.008 + math.sqrt(rs * rs - 0.019 ** 2) * 1.04 + 0.001, z))
    hw = 0.019
    prev = None
    lift = 0.0032
    for i, (y, z) in enumerate(st):
        # outward direction of the surface here (instep slopes up, shaft is vertical)
        if i < 4:
            nrm = V(0, 0.35, 0.94).normalized()
        else:
            nrm = V(0, 1.0, 0.0)
        a = V(0.092 - hw, y, z) + nrm * lift
        b = V(0.092 + hw, y, z) + nrm * lift
        if lv.hi:
            for e in (a, b):  # eyelets: little brass rings
                cyl_solid(hwbm(), e - nrm * 0.002, e + nrm * 0.0012, 0.0046, 0.0046, 8, True)
        if prev is not None:
            pa, pb = prev
            for (u, v) in ((pa, b), (pb, a)):
                mid = (u + v) * 0.5 + nrm * 0.0042
                sweep_circle(bm, [u, mid, v], 0.0021 if lv.hi else 0.0024, 5 if lv.hi else 3)
        prev = (a, b)
    # bow on top
    top_c = (prev[0] + prev[1]) * 0.5 + V(0, 0.002, 0.003)
    if lv.hi:
        for sx in (-1, 1):
            sweep_circle(bm, [top_c, top_c + V(sx * 0.016, 0.012, 0.012), top_c + V(sx * 0.030, 0.006, -0.010)], 0.0020, 5)

    # ankle strap
    def sfn(t):
        a = 2 * math.pi * t
        r = 0.0525
        c = V(0.092, -0.0065, 0.232)
        p = c + V(math.cos(a) * r, math.sin(a) * r * 1.04, 0)
        return p, V(math.cos(a), math.sin(a) * 0.96, 0).normalized()
    surf_strap(bm, lv, sfn, 0.34, 0.022, 0.0045, off=0.0014, loop=True)
    outer = V(0.092 + 0.0535, -0.0065, 0.232)
    frame_ring(hwbm(), outer + V(0.0036, 0, 0), (V(0, 1, 0), V(0, 0, 1), V(1, 0, 0)), 0.026, 0.018, 0.004, 0.0035, lv)


def build_boot_part(lv):
    parts = []

    def one(bm, lv_, sg):
        build_boot_foot(bm, lv_, sg)
        build_boot_shaft(bm, lv_, sg)

    sided(one, parts, "Boot", "leather_boot", "boot_{s}", lv)
    sided(build_boot_sole, parts, "Sole", "rubber", "boot_{s}", lv)
    sided(build_boot_laces, parts, "Laces", "cord_hw", "boot_{s}", lv)
    return parts


# ---- belt, harness, pouches --------------------------------------------------------
BELT_Z = 1.015


def belt_fn(t):
    a = 2 * math.pi * t + math.pi / 2  # start at the front
    z = BELT_Z + 0.004 * math.sin(a * 2)
    return torso_pt(z, a, 0.0), torso_nrm(z, a)


def build_belt(lv):
    bm = bmesh.new()
    circ = 0.95
    surf_strap(bm, lv, belt_fn, circ, 0.050, 0.0075, off=0.0055, loop=True, r=0.0022)
    # belt buckle (front): brass frame + prong bar, belt loops
    p0, n0 = belt_fn(0.0)
    X, Y, Z = V(1, 0, 0), V(0, 0, 1), V(0, 1, 0)
    frame_ring(hwbm(), p0 + n0 * 0.0085, (X, Y, Z), 0.058, 0.044, 0.008, 0.0045, lv)
    box_solid(hwbm(), p0 + n0 * 0.0105, (X, Y, Z), (0.0045, 0.019, 0.0030), 0.0008 if lv.hi else 0)
    # gear loops (leather tabs) around the belt: left/right and back
    for tt in (0.14, 0.2, 0.30, 0.38, 0.62, 0.70, 0.80, 0.86):
        pc, nc = belt_fn(tt)
        box_solid(bm, pc + nc * 0.0145, (nc.cross(V(0, 0, 1)).normalized(), V(0, 0, 1), nc), (0.0110, 0.0270, 0.0036), 0.0010 if lv.hi else 0)
    return Part("Belt", "leather", "torso", bm)


def build_leg_loops(bm, lv, sg):
    """Climbing-harness leg loop: a wide webbing band around the thigh, buckle on the outer side."""
    tt = leg_t_of_z(0.785)

    def lfn(t):
        a = 2 * math.pi * t
        return LEG.pt(tt, a, 0.0), LEG.nrm(tt, a)
    surf_strap(bm, lv, lfn, 0.55, 0.058, 0.0045, off=0.0030, loop=True)
    pc = LEG.pt(tt, math.pi / 2, 0.0095)
    frame_ring(hwbm(), pc, (V(0, 1, 0), V(0, 0, 1), V(1, 0, 0)), 0.034, 0.046, 0.007, 0.0045, lv)


def build_harness(lv):
    bm = bmesh.new()
    # braces (suspender style): belt front -> over the shoulder near the neck -> belt back
    brace = [(1.03, 86), (1.13, 78), (1.24, 70), (1.34, 62), (1.405, 50), (1.445, 30), (1.455, 12), (1.445, -8), (1.41, -30), (1.34, -52), (1.22, -66), (1.04, -78)]
    for sg in (1, -1):
        fn, length = za_path(brace, sg)
        surf_strap(bm, lv, fn, length, 0.034, 0.004, off=0.0070)
    # chest strap (horizontal, z = 1.265) joining the braces, with a sternum buckle
    def cs_fn(t):
        a = math.radians(lerp(52, 128, t))
        return torso_pt(1.268, a, 0.0), torso_nrm(1.268, a)
    surf_strap(bm, lv, cs_fn, 0.20, 0.026, 0.0035, off=0.0100)
    pc = torso_pt(1.268, math.pi / 2, 0.0150)
    frame_ring(hwbm(), pc, (V(1, 0, 0), V(0, 0, 1), V(0, 1, 0)), 0.040, 0.030, 0.006, 0.004, lv)
    return Part("Harness", "webbing", "torso", bm)


def mirror_pt(p, sg):
    return V(p.x * sg, p.y, p.z)


def mirror_vec(v, sg):
    return V(v.x * sg, v.y, v.z)


def build_metal(lv):
    """Belay ring, carabiners, D-rings, buckle hardware not part of a strap."""
    bm = bmesh.new()
    p0, n0 = belt_fn(0.0)
    # belay ring hanging at the belt front
    c = p0 + n0 * 0.019 + V(0, 0, -0.030)
    pts = [c + V(math.cos(a) * 0.020, 0.0, math.sin(a) * 0.026) for a in [2 * math.pi * k / (24 if lv.hi else 10) for k in range(24 if lv.hi else 10)]]
    sweep_circle(bm, pts, 0.0035, 8 if lv.hi else 4, closed=True)
    # two carabiners on gear loops (left front, right back)
    for tt, sgn in ((0.20, 1), (0.74, -1)):
        pc, nc = belt_fn(tt)
        cc = pc + nc * 0.034 + V(0, 0, -0.045)
        T = nc.cross(V(0, 0, 1)).normalized()
        n = 20 if lv.hi else 9
        path = []
        for k in range(n):
            a = 2 * math.pi * k / n
            x = 0.019 * math.cos(a)
            z = 0.040 * math.sin(a)
            if z < 0:
                x *= 1.0 - 0.28 * (-z / 0.04)  # D shape
            path.append(cc + T * x + V(0, 0, z) + nc * 0.0)
        sweep_circle(bm, path, 0.0033, 7 if lv.hi else 4, closed=True)
        sweep_circle(bm, [cc + V(0, 0, -0.04) + T * -0.016, cc + V(0, 0, -0.04) + T * 0.016], 0.0035, 5 if lv.hi else 3)
    return Part("Hardware", "steel", "torso", bm)


def build_pouch(bm, lv, sg):
    """Belt pouch (right side): bellows body, leather flap with a brass stud, belt tab. Hangs from the belt at x = +0.215."""
    c = V(0.226, 0.012, 0.915)
    X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)
    superquad(bm, c, (X, Y, Z), (0.032, 0.062, 0.058), 0.35, 0.45, 26 if lv.hi else 10, 14 if lv.hi else 6)
    top = c.z + 0.058
    pts = [V(0.226, c.y - 0.060, top + 0.006), V(0.226, c.y - 0.020, top + 0.009), V(0.226, c.y + 0.030, top + 0.008),
           V(0.226, c.y + 0.066, top - 0.004), V(0.226, c.y + 0.074, top - 0.030), V(0.226, c.y + 0.073, top - 0.062)]
    dense = catmull(pts, 4 if lv.hi else 2)
    cs, ns = [], []
    for i, pnt in enumerate(dense):
        Tn = (dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)]).normalized()
        cs.append(pnt)
        ns.append(Tn.cross(X).normalized())
    ribbon(bm, cs, ns, lv, 0.074, 0.006, r=0.002)
    cyl_solid(hwbm(), V(0.226, c.y + 0.0735, top - 0.056), V(0.226, c.y + 0.0785, top - 0.056), 0.0072, 0.0064, 10 if lv.hi else 6)
    box_solid(bm, V(0.226, 0.0, 0.980), (X, Y, Z), (0.020, 0.0065, 0.040), 0.001 if lv.hi else 0)


# ---- backpack ----------------------------------------------------------------------
PACK_C = V(0.0, -0.205, 1.215)
PACK_HALF = (0.150, 0.085, 0.205)


def pack_strip(bm, lv, pts, width, thick, off_n=0.0, **kw):
    """Strip along `pts` lying on the pack (width across X); normals = T x X."""
    dense = catmull(pts, 5 if lv.hi else 2) if len(pts) > 2 else pts
    if lv.hi:
        # resample finely for the stitch rows
        fine = []
        for i in range(len(dense) - 1):
            seg = dense[i + 1] - dense[i]
            n = max(1, int(seg.length / 0.0016))
            for k in range(n):
                fine.append(dense[i].lerp(dense[i + 1], k / n))
        fine.append(dense[-1])
        dense = fine
    cs, ns = [], []
    X = V(1, 0, 0)
    for i, pnt in enumerate(dense):
        Tn = (dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)]).normalized()
        o = Tn.cross(X).normalized()
        cs.append(pnt + o * off_n)
        ns.append(o)
    return ribbon(bm, cs, ns, lv, width, thick, **kw)


def build_pack(lv):
    parts = []
    X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)
    # main body
    bm = bmesh.new()
    superquad(bm, PACK_C, (X, Y, Z), PACK_HALF, 0.30, 0.30, 44 if lv.hi else 18, 30 if lv.hi else 10)
    if lv.hi:  # canvas folds
        for v in bm.verts:
            d = 0.0034 * fnoise(v.co, V(9, 9, 9), 3, 12.5)
            c0 = v.co - PACK_C
            nrm = V(c0.x / PACK_HALF[0] ** 2, c0.y / PACK_HALF[1] ** 2, c0.z / PACK_HALF[2] ** 2)
            if nrm.length > 1e-9:
                v.co += nrm.normalized() * d
    parts.append(Part("PackBody", "canvas_pack", "pack", bm))
    top_z = PACK_C.z + PACK_HALF[2]
    y_back = PACK_C.y - PACK_HALF[1]
    y_front = PACK_C.y + PACK_HALF[1]
    # top flap (leather): front edge -> over the top -> down the rear face
    bm = bmesh.new()
    pts = [V(0, y_front - 0.006, top_z + 0.010), V(0, PACK_C.y, top_z + 0.0135), V(0, y_back + 0.030, top_z + 0.0120), V(0, y_back - 0.006, top_z - 0.004),
           V(0, y_back - 0.0125, top_z - 0.040), V(0, y_back - 0.0135, top_z - 0.100), V(0, y_back - 0.0135, top_z - 0.165)]
    pack_strip(bm, lv, pts, 0.286, 0.010, r=0.0035, stitch=0.006)
    # two buckle straps from the flap down the rear face
    for sx in (-0.075, 0.075):
        pts2 = [V(sx, y_back - 0.0200, top_z - 0.060), V(sx, y_back - 0.0200, top_z - 0.15), V(sx, y_back - 0.0165, top_z - 0.24), V(sx, y_back - 0.0150, top_z - 0.305)]
        pack_strip(bm, lv, pts2, 0.030, 0.005, r=0.0016, stitch=0.0035)
        frame_ring(hwbm(), V(sx, y_back - 0.0245, top_z - 0.200), (V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)), 0.040, 0.032, 0.006, 0.0042, lv)
    parts.append(Part("PackFlap", "leather", "pack", bm))
    # side pockets (bellows)
    bm = bmesh.new()
    for sg in (1, -1):
        c = V(sg * (PACK_HALF[0] + 0.030), PACK_C.y + 0.002, PACK_C.z - 0.100)
        superquad(bm, c, (X, Y, Z), (0.036, 0.070, 0.085), 0.30, 0.38, 20 if lv.hi else 8, 14 if lv.hi else 5)
        cyl_solid(hwbm(), c + V(sg * 0.035, 0.0, 0.052), c + V(sg * 0.039, 0.0, 0.052), 0.007, 0.006, 10 if lv.hi else 5)
    parts.append(Part("PackPockets", "canvas_pack", "pack", bm))
    # bedroll under the pack (wool, strapped)
    bm = bmesh.new()
    bc = V(0.0, PACK_C.y - 0.005, PACK_C.z - PACK_HALF[2] - 0.050)
    superquad(bm, bc, (V(0, 1, 0), V(1, 0, 0), V(0, 0, 1)), (0.062, 0.168, 0.062), 1.0, 0.45, 26 if lv.hi else 10, 14 if lv.hi else 6)
    if lv.hi:
        for v in bm.verts:
            c0 = v.co - bc
            rv = V(0, c0.y, c0.z)
            if rv.length > 1e-6:
                v.co += rv.normalized() * 0.0030 * fnoise(v.co, V(14, 8, 14), 2, 21.0)
    parts.append(Part("PackBedroll", "wool", "pack", bm))
    bm = bmesh.new()
    for sx in (-0.085, 0.085):
        def sfn(t, sx=sx):
            a = 2 * math.pi * t
            return V(sx, bc.y, bc.z) + V(0, math.cos(a), math.sin(a)) * 0.0675, V(0, math.cos(a), math.sin(a))
        surf_strap(bm, lv, sfn, 0.42, 0.028, 0.0045, off=0.0, loop=True)
    parts.append(Part("PackBedStraps", "leather", "pack", bm))
    # coiled rope lashed on the right flank, above the pocket
    bm = bmesh.new()
    nloops = 4
    rc = V(PACK_HALF[0] + 0.006, PACK_C.y, PACK_C.z + 0.095)
    n = (30 if lv.hi else 10) * nloops
    path = []
    for i in range(n + 1):
        a = 2 * math.pi * nloops * i / n
        path.append(rc + V(0.0145 * nloops * i / n, math.cos(a) * 0.052, math.sin(a) * 0.052))
    sweep_circle(bm, path, 0.0072, 7 if lv.hi else 4)
    parts.append(Part("PackRope", "rope", "pack", bm))
    return parts


def build_pack_straps(lv):
    bm = bmesh.new()
    strap = [(1.385, -62), (1.41, -42), (1.435, -16), (1.44, 8), (1.425, 34), (1.375, 52), (1.31, 48), (1.22, 30), (1.13, 12), (1.07, -28), (1.045, -62)]
    for sg in (1, -1):
        fn, length = za_path(strap, sg)
        surf_strap(bm, lv, fn, length, 0.050, 0.014, off=0.0105, r=0.0045, stitch=0.0085, stitch_h=0.0005)
    return Part("PackStraps", "pack_strap", "torso", bm)


def build_scarf(lv):
    """Wool scarf roll closing the neck (no head in first person): a fat torus-like wrap + hanging tail."""
    bm = bmesh.new()
    nring = lv.ring(10, 28)
    n = lv.ring(26, 90)
    path = []
    for k in range(n):
        a = 2 * math.pi * k / n
        path.append(V(0.084 * math.cos(a), -0.004 + 0.080 * math.sin(a), 1.478 + 0.004 * math.sin(2 * a + 0.8)))
    rings = []
    frames = transport_frames(path + [path[0]], V(0, 0, 1))
    for i, p in enumerate(path):
        T, N, B = frames[i]
        rr = 0.0165 + 0.0025 * math.sin(i * 0.7)
        ring = []
        for k in range(nring):
            a = 2 * math.pi * k / nring
            q = p + N * (rr * math.cos(a)) + B * (rr * math.sin(a))
            if lv.hi:
                q += (q - p).normalized() * 0.0022 * fnoise(q, V(22, 22, 22), 2, 13.0)
            ring.append(bm.verts.new(q))
        rings.append(ring)
    n_ = len(rings)
    for i in range(n_):
        a, b = rings[i], rings[(i + 1) % n_]
        for k in range(nring):
            bm.faces.new((a[k], a[(k + 1) % nring], b[(k + 1) % nring], b[k]))
    # lid closing the neck hole
    cap_z = 1.490
    cv = bm.verts.new(V(0, -0.004, cap_z))
    inner = [bm.verts.new(V(0.066 * math.cos(2 * math.pi * k / (n if not lv.hi else 36)), -0.004 + 0.062 * math.sin(2 * math.pi * k / (n if not lv.hi else 36)), cap_z)) for k in range(n if not lv.hi else 36)]
    m = len(inner)
    for k in range(m):
        bm.faces.new((cv, inner[(k + 1) % m], inner[k]))
    # a tail of the scarf hanging at the front-left of the chest
    t0 = V(-0.055, 0.080, 1.470)
    tail = [t0, t0 + V(-0.012, 0.030, -0.070), t0 + V(-0.004, 0.044, -0.150), t0 + V(0.010, 0.050, -0.215)]
    tube = Tube(tail, lambda t: (0.036 * (1 - 0.18 * t), 0.010 + 0.002 * t), V(1, 0, 0), 2.6, 30)
    tube_mesh(bm, tube, lv, lv.ring(6, 18), cap0=True, cap1=True)
    return Part("Scarf", "wool", "torso", bm)


def build_chest_pockets(lv):
    bm = bmesh.new()
    for sg in (1, -1):
        for zc, hz in ((1.225, 0.038),):
            a = math.radians(90 - sg * 38) if sg > 0 else math.radians(90 + 38)
            c = torso_pt(zc, a, 0.0)
            n = torso_nrm(zc, a)
            T = n.cross(V(0, 0, 1)).normalized()
            box_solid(bm, c + n * 0.0075, (T, V(0, 0, 1), n), (0.040, hz, 0.0065), 0.002 if lv.hi else 0)
            cyl_solid(hwbm(), c + n * 0.014 + V(0, 0, hz - 0.02), c + n * 0.0165 + V(0, 0, hz - 0.02), 0.0052, 0.0048, 8 if lv.hi else 5)
    return Part("ChestPockets", "canvas", "torso", bm)


# -----------------------------------------------------------------------------
# Assemble a whole body at a level of detail
# -----------------------------------------------------------------------------
def build_all(lv):
    parts = []
    HW[0] = bmesh.new()
    parts.append(build_jacket(lv))
    parts += build_sleeve_part(lv)
    sided(build_elbow_strap, parts, "ElbowStrap", "leather", "arm_{s}", lv)
    parts.append(build_hips(lv))
    sided(build_leg, parts, "Leg", "twill", "leg_{s}", lv)
    sided(build_knee_pad, parts, "KneePad", "leather", "leg_{s}", lv)
    sided(build_thigh_pocket, parts, "ThighPocket", "twill_pocket", "leg_{s}", lv)
    parts += build_boot_part(lv)
    parts.append(build_belt(lv))
    sided(build_leg_loops, parts, "LegLoop", "webbing", "leg_{s}", lv)
    parts.append(build_harness(lv))
    parts.append(build_metal(lv))
    sided(build_pouch, parts, "Pouch", "leather", "pouch_{s}", lv)
    parts += build_pack(lv)
    parts.append(build_pack_straps(lv))
    parts.append(build_scarf(lv))
    parts.append(build_chest_pockets(lv))
    parts.append(Part("Brass", "brass", "region", HW[0]))
    return parts


def tri_count_bm(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


def parts_to_object(parts, name, collection):
    """Join the parts' bmeshes into one object, with a per-part material slot index stored as a face attribute."""
    obs = []
    for pt in parts:
        me = bpy.data.meshes.new(f"{name}_{pt.name}")
        bm = pt.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(me)
        ob = bpy.data.objects.new(f"{name}_{pt.name}", me)
        ob["cls"] = pt.cls
        ob["group"] = pt.group
        collection.objects.link(ob)
        obs.append(ob)
    return obs


# -----------------------------------------------------------------------------
# Dev: clay previews of the geometry (Workbench)
# -----------------------------------------------------------------------------
def add_camera(name, loc, target, lens=35.0, clip=(0.02, 50.0)):
    cam = bpy.data.cameras.new(name)
    if lens < 0:  # negative = vertical field of view in degrees
        cam.sensor_fit = "VERTICAL"
        cam.angle_y = math.radians(-lens)
    else:
        cam.lens = lens
    cam.clip_start, cam.clip_end = clip
    ob = bpy.data.objects.new(name, cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def clay_material():
    m = bpy.data.materials.new("Clay")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    oi = nt.nodes.new("ShaderNodeObjectInfo")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(oi.outputs["Color"], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.7
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    return m


def clay_render(path, cam, res=(960, 720), samples=12):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.threads_mode = "FIXED"
    sc.render.threads = 4
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    if sc.world is None:
        sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.25, 0.27, 0.3, 1)
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    if "KeyLight" not in bpy.data.objects:
        ld = bpy.data.lights.new("KeyLight", "SUN")
        ld.energy = 3.0
        lo = bpy.data.objects.new("KeyLight", ld)
        lo.rotation_euler = (math.radians(50), math.radians(10), math.radians(150))
        sc.collection.objects.link(lo)
    sc.camera = cam
    sc.render.filepath = path
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)


# -----------------------------------------------------------------------------
# Skin weights (geometric, per region)
# -----------------------------------------------------------------------------
def _norm_w(w):
    w = {k: v for k, v in w.items() if v > 1e-4}
    tot = sum(w.values())
    if tot <= 0:
        return {"Pelvis": 1.0}
    top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    tot = sum(v for _, v in top)
    return {k: v / tot for k, v in top}


def W_torso(p):
    s1 = sstep(-1, 1, (p.z - 1.00) / 0.07)
    s2 = sstep(-1, 1, (p.z - 1.22) / 0.08)
    s3 = sstep(-1, 1, (p.z - 1.468) / 0.022)
    w = {"Pelvis": max(0.0, 1 - s1), "Spine1": max(0.0, s1 - s2), "Spine2": max(0.0, s2 - s3), "Neck": s3}
    c = sstep(0.10, 0.19, abs(p.x)) * sstep(1.30, 1.39, p.z)
    take = w["Spine2"] * c
    w["Spine2"] -= take
    w["Clavicle_R" if p.x > 0 else "Clavicle_L"] = take
    return w


def W_hips(p):
    tz = sstep(0.89, 0.78, p.z)
    sr = sstep(-0.04, 0.04, p.x)
    return {"Pelvis": 1 - tz, "Thigh_R": tz * sr, "Thigh_L": tz * (1 - sr)}


def W_leg(p, s):
    hip = sstep(-1, 1, (0.92 - p.z) / 0.05)
    knee = sstep(-1, 1, (0.50 - p.z) / 0.07)
    ank = sstep(-1, 1, (0.10 - p.z) / 0.04)
    return {"Pelvis": 1 - hip, f"Thigh_{s}": max(0.0, hip - knee), f"Shin_{s}": max(0.0, knee - ank), f"Foot_{s}": ank}


def W_boot(p, s):
    shin = sstep(0.07, 0.14, p.z)
    foot = 1 - shin
    toe = sstep(0.10, 0.165, p.y) * foot
    return {f"Shin_{s}": shin, f"Foot_{s}": foot - toe, f"Toe_{s}": toe}


def W_arm(p, s):
    sg = 1 if s == "R" else -1
    sh = V(SHOULDER.x * sg, SHOULDER.y, SHOULDER.z)
    d = V(ARM_DIR.x * sg, ARM_DIR.y, ARM_DIR.z)
    s1 = sstep(-1, 1, (p - sh).dot(d) / 0.05)
    return {f"Clavicle_{s}": 1 - s1, f"UpperArm_{s}": s1}


def W_stub(p, s):
    sg = 1 if s == "R" else -1
    el = V(ELBOW.x * sg, ELBOW.y, ELBOW.z)
    d = V(ARM_DIR.x * sg, ARM_DIR.y, ARM_DIR.z)
    k = sstep(-0.02, 0.02, (p - el).dot(d))
    return {f"UpperArm_{s}": 1 - k, f"Forearm_{s}": k}


def region_group(p):
    s = "R" if p.x >= 0 else "L"
    if p.y < -0.12 and p.z > 0.95:
        return "pack"
    if abs(p.x) > 0.185 and 0.84 < p.z < 1.07 and abs(p.y) < 0.09:
        return f"pouch_{s}"
    if p.z < 0.31:
        return f"boot_{s}"
    if p.z < 0.93:
        return f"leg_{s}"
    if abs(p.x) > 0.20 and 1.05 < p.z < 1.45:
        return f"arm_{s}"
    return "torso"


def vertex_weights(p, group):
    if group == "region":
        group = region_group(p)
    if group == "torso":
        w = W_torso(p)
    elif group == "hips":
        w = W_hips(p)
    elif group.startswith("leg_"):
        w = W_leg(p, group[-1])
    elif group.startswith("boot_"):
        w = W_boot(p, group[-1])
    elif group.startswith("arm_"):
        w = W_arm(p, group[-1])
    elif group.startswith("stub_"):
        w = W_stub(p, group[-1])
    elif group.startswith("pouch_"):
        w = {group.replace("pouch_", "Pouch_"): 1.0}
    elif group == "pack":
        w = {"Pack": 1.0}
    else:
        w = {"Pelvis": 1.0}
    return _norm_w(w)


# -----------------------------------------------------------------------------
# HIGH materials (procedural, bake sources) — every class builds colour / roughness / metal + a bump
# -----------------------------------------------------------------------------
class NB:
    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()

    def n(self, typ, **kw):
        nd = self.nt.nodes.new(typ)
        for k, v in kw.items():
            setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.nt.links.new(a, b)

    def inp(self, nd, key, v):
        if isinstance(v, (int, float)):
            nd.inputs[key].default_value = v
        elif isinstance(v, tuple):
            try:
                nd.inputs[key].default_value = v
            except (ValueError, TypeError):
                nd.inputs[key].default_value = (*v, 1.0)
        else:
            self.link(v, nd.inputs[key])

    def math(self, op, a, b=0.0, clamp_=False):
        nd = self.n("ShaderNodeMath", operation=op, use_clamp=clamp_)
        self.inp(nd, 0, a)
        self.inp(nd, 1, b)
        return nd.outputs[0]

    def vmath(self, op, a, b=None, out=0):
        nd = self.n("ShaderNodeVectorMath", operation=op)
        self.inp(nd, 0, a)
        if b is not None:
            self.inp(nd, 1, b)
        return nd.outputs[out]

    def value(self, v):
        nd = self.n("ShaderNodeValue")
        nd.outputs[0].default_value = v
        return nd.outputs[0]

    def rgb(self, c):
        nd = self.n("ShaderNodeRGB")
        nd.outputs[0].default_value = (*c, 1.0)
        return nd.outputs[0]

    def combine(self, r, g, b):
        nd = self.n("ShaderNodeCombineXYZ")
        self.inp(nd, 0, r)
        self.inp(nd, 1, g)
        self.inp(nd, 2, b)
        return nd.outputs[0]

    def noise(self, vec, scale, detail=4.0, rough=0.55, distortion=0.0):
        nd = self.n("ShaderNodeTexNoise")
        self.inp(nd, "Vector", vec)
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Detail"].default_value = detail
        nd.inputs["Roughness"].default_value = rough
        nd.inputs["Distortion"].default_value = distortion
        return nd.outputs["Fac"]

    def voronoi(self, vec, scale, feature="F1", out="Distance", rand=1.0):
        nd = self.n("ShaderNodeTexVoronoi", feature=feature)
        self.inp(nd, "Vector", vec)
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Randomness"].default_value = rand
        return nd.outputs[out]

    def smooth(self, a, e0, e1):
        nd = self.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self.inp(nd, 0, a)
        nd.inputs[1].default_value = e0
        nd.inputs[2].default_value = e1
        return nd.outputs[0]

    def mix(self, fac, a, b):
        nd = self.n("ShaderNodeMix", data_type="RGBA")
        self.inp(nd, 0, fac)
        self.inp(nd, 6, a)
        self.inp(nd, 7, b)
        return nd.outputs[2]

    def wave(self, vec, scale, distortion=2.0, detail=2.0, kind="BANDS", direction="X"):
        nd = self.n("ShaderNodeTexWave", wave_type=kind, bands_direction=direction)
        self.inp(nd, "Vector", vec)
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Distortion"].default_value = distortion
        nd.inputs["Detail"].default_value = detail
        return nd.outputs["Fac"]


# class: (base, wear/edge colour, roughness, metallic, mud amount)
HCLS = {
    "canvas": ((0.082, 0.077, 0.057), (0.150, 0.138, 0.100), 0.62, 0.0, 0.55),
    "canvas_pack": ((0.100, 0.092, 0.060), (0.180, 0.160, 0.105), 0.66, 0.0, 0.25),
    "twill": ((0.040, 0.046, 0.054), (0.085, 0.092, 0.098), 0.72, 0.0, 0.85),
    "twill_pocket": ((0.046, 0.052, 0.060), (0.090, 0.095, 0.100), 0.70, 0.0, 0.6),
    "leather": ((0.092, 0.056, 0.034), (0.230, 0.140, 0.075), 0.55, 0.0, 0.2),
    "leather_boot": ((0.062, 0.037, 0.022), (0.190, 0.115, 0.060), 0.52, 0.0, 1.0),
    "rubber": ((0.014, 0.014, 0.015), (0.06, 0.055, 0.05), 0.85, 0.0, 1.0),
    "cord_hw": ((0.30, 0.235, 0.14), (0.42, 0.34, 0.21), 0.85, 0.0, 0.8),
    "webbing": ((0.235, 0.100, 0.032), (0.34, 0.20, 0.09), 0.82, 0.0, 0.3),
    "pack_strap": ((0.052, 0.037, 0.026), (0.12, 0.085, 0.055), 0.70, 0.0, 0.2),
    "steel": ((0.40, 0.40, 0.42), (0.62, 0.62, 0.64), 0.40, 1.0, 0.2),
    "brass": ((0.72, 0.52, 0.24), (0.90, 0.72, 0.40), 0.38, 1.0, 0.1),
    "wool": ((0.125, 0.026, 0.020), (0.19, 0.06, 0.04), 0.92, 0.0, 0.3),
    "rope": ((0.34, 0.26, 0.15), (0.46, 0.37, 0.22), 0.90, 0.0, 0.3),
}
HB = {}


def hb_material(cls):
    base, wear, rough0, metal0, mud0 = HCLS[cls]
    mat = bpy.data.materials.new("HB_" + cls)
    b = NB(mat)
    out = b.n("ShaderNodeOutputMaterial")
    emis = b.n("ShaderNodeEmission")
    bsdf = b.n("ShaderNodeBsdfPrincipled")
    tc = b.n("ShaderNodeTexCoord")
    co = tc.outputs["Object"]
    # --- bump height per class (object-space metres: scale = 1 / feature size) ---
    height, strength, dist = None, 0.5, 0.0004
    if cls in ("leather", "leather_boot", "pack_strap"):
        grain = b.smooth(b.voronoi(co, 520.0), 0.0, 0.8)
        crack = b.smooth(b.noise(co, 55.0, 3.0), 0.55, 0.7)
        height = b.math("ADD", b.math("MULTIPLY", grain, 0.5), b.math("MULTIPLY", b.noise(co, 1500.0, 2.0), 0.15))
        height = b.math("SUBTRACT", height, b.math("MULTIPLY", crack, 0.6))
        strength = 0.5
    elif cls in ("canvas", "canvas_pack"):
        height = b.math("ADD", b.math("MULTIPLY", b.noise(co, 420.0, 3.0), 0.5), b.math("MULTIPLY", b.noise(co, 1300.0, 2.0), 0.3))
        strength = 0.35
    elif cls in ("twill", "twill_pocket"):
        diag = b.wave(co, 700.0, 3.0, 2.0, "BANDS", "DIAGONAL")
        height = b.math("ADD", b.math("MULTIPLY", diag, 0.35), b.math("MULTIPLY", b.noise(co, 380.0, 3.0), 0.4))
        strength = 0.35
    elif cls == "webbing":
        ribs = b.wave(co, 460.0, 1.0, 1.0, "BANDS", "Y")
        height = b.math("ADD", b.math("MULTIPLY", ribs, 0.4), b.math("MULTIPLY", b.noise(co, 900.0, 2.0), 0.3))
        strength = 0.4
    elif cls in ("cord_hw", "rope"):
        height = b.math("ADD", b.noise(co, 700.0, 2.0), b.math("MULTIPLY", b.wave(co, 520.0, 4.0, 1.0, "BANDS", "Z"), 0.5))
        strength = 0.5
    elif cls in ("steel", "brass"):
        height = b.math("MULTIPLY", b.noise(co, 900.0, 3.0), 0.3)
        strength = 0.2
    elif cls == "rubber":
        height = b.math("ADD", b.noise(co, 250.0, 3.0), b.math("MULTIPLY", b.noise(co, 900.0, 2.0), 0.4))
        strength = 0.4
    else:  # wool
        height = b.math("ADD", b.math("MULTIPLY", b.noise(co, 480.0, 3.0), 0.6), b.math("MULTIPLY", b.noise(co, 1600.0, 2.0), 0.4))
        strength = 0.5
    bump = b.n("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = dist
    b.link(height, bump.inputs["Height"])
    b.link(bump.outputs["Normal"], bsdf.inputs["Normal"])
    # --- wear masks ---
    bev = b.n("ShaderNodeBevel", samples=8)
    bev.inputs["Radius"].default_value = 0.0020
    geo = b.n("ShaderNodeNewGeometry")
    dotn = b.vmath("DOT_PRODUCT", bev.outputs[0], geo.outputs["Normal"], out=1)
    edge = b.math("MULTIPLY", b.math("SUBTRACT", 1.0, dotn), 8.0, clamp_=True)
    ao = b.n("ShaderNodeAmbientOcclusion", samples=8)
    ao.inputs["Distance"].default_value = 0.03
    cav = b.math("SUBTRACT", 1.0, ao.outputs["AO"], clamp_=True)
    n_big = b.noise(co, 5.0, 4.0)
    n_mid = b.noise(co, 38.0, 4.0)
    n_fine = b.noise(co, 240.0, 3.0)
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(co, sep.inputs[0])
    zco = sep.outputs[2]
    # mud / dust climbing up from the floor, broken up by noise
    mud_m = b.math("MULTIPLY", b.smooth(b.math("ADD", b.math("SUBTRACT", 0.55, zco), b.math("MULTIPLY", n_mid, 0.35)), 0.15, 0.55), mud0, clamp_=True)
    # dust on shoulders / flat tops of the pack
    col = b.rgb(base)
    var = b.math("ADD", 0.72, b.math("MULTIPLY", b.math("ADD", n_big, b.math("MULTIPLY", n_mid, 0.6)), 0.34))
    col = b.vmath("MULTIPLY", col, b.combine(var, var, var))
    col = b.mix(b.math("MULTIPLY", cav, 0.85), col, b.rgb((base[0] * 0.28, base[1] * 0.26, base[2] * 0.25)))
    wear_f = b.math("MULTIPLY", b.math("MULTIPLY", edge, 0.9), b.smooth(n_fine, 0.35, 0.65))
    col = b.mix(wear_f, col, b.rgb(wear))
    col = b.mix(b.math("MULTIPLY", mud_m, 0.75), col, b.rgb((0.040, 0.030, 0.022)))
    if cls in ("leather_boot", "rubber", "cord_hw"):  # rope-burn scuffs: dull streaks
        streak = b.smooth(b.noise(b.combine(b.math("MULTIPLY", sep.outputs[0], 2.0), b.math("MULTIPLY", sep.outputs[1], 2.0), b.math("MULTIPLY", zco, 40.0)), 6.0, 2.0), 0.52, 0.7)
        col = b.mix(b.math("MULTIPLY", streak, 0.5), col, b.rgb((wear[0] * 0.7, wear[1] * 0.7, wear[2] * 0.7)))
    rough = b.math("ADD", rough0, b.math("MULTIPLY", b.math("SUBTRACT", n_mid, 0.5), 0.25))
    rough = b.math("SUBTRACT", rough, b.math("MULTIPLY", wear_f, 0.18))
    rough = b.math("ADD", rough, b.math("MULTIPLY", mud_m, 0.2), clamp_=True)
    if metal0 > 0.5:
        metal = b.math("SUBTRACT", 1.0, b.math("MULTIPLY", b.math("MULTIPLY", cav, 0.55), b.smooth(n_mid, 0.4, 0.8)), clamp_=True)
    else:
        metal = b.value(0.0)
    b.link(col, bsdf.inputs["Base Color"])
    b.link(rough, bsdf.inputs["Roughness"])
    b.link(metal, bsdf.inputs["Metallic"])
    HB[cls] = {"mat": mat, "out": out, "emis": emis, "bsdf": bsdf, "col": col, "rough": rough, "metal": metal, "b": b}
    set_hb_pass(cls, "NORMAL")
    return mat


def set_hb_pass(cls, pname):
    h = HB[cls]
    nt = h["mat"].node_tree
    for l in list(h["out"].inputs["Surface"].links):
        nt.links.remove(l)
    if pname in ("NORMAL", "AO"):
        nt.links.new(h["bsdf"].outputs[0], h["out"].inputs["Surface"])
        return
    for l in list(h["emis"].inputs["Color"].links):
        nt.links.remove(l)
    if pname == "ALB":
        nt.links.new(h["col"], h["emis"].inputs["Color"])
    else:  # ORM: R = 1 (AO is baked separately), G = roughness, B = metalness
        cmb = h.get("orm_combine")
        if cmb is None:
            cmb = nt.nodes.new("ShaderNodeCombineXYZ")
            cmb.inputs[0].default_value = 1.0
            nt.links.new(h["rough"], cmb.inputs[1])
            nt.links.new(h["metal"], cmb.inputs[2])
            h["orm_combine"] = cmb
        nt.links.new(cmb.outputs[0], h["emis"].inputs["Color"])
    h["emis"].inputs["Strength"].default_value = 1.0
    nt.links.new(h["emis"].outputs[0], h["out"].inputs["Surface"])


# -----------------------------------------------------------------------------
# Scene build: LOW + HIGH objects, UV atlas, bake, composite
# -----------------------------------------------------------------------------
CLASSES = list(HCLS.keys())


def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def join_low(parts, coll):
    """One low-poly object: parts joined in order, with per-vertex weights and a per-face class id."""
    bm = bmesh.new()
    cls_layer = bm.faces.layers.int.new("cls_id")
    weights = []
    for pt in parts:
        me = bpy.data.meshes.new("tmp")
        bmesh.ops.recalc_face_normals(pt.bm, faces=pt.bm.faces[:])
        for v in pt.bm.verts:
            weights.append(vertex_weights(v.co, pt.group))
        pt.bm.to_mesh(me)
        n0 = len(bm.faces)
        bm.from_mesh(me)
        for f in bm.faces[n0:]:
            f[cls_layer] = CLASSES.index(pt.cls)
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new("Body_Low")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Body_Low", me)
    coll.objects.link(ob)
    assert len(weights) == len(me.vertices), (len(weights), len(me.vertices))
    return ob, weights


def uv_unwrap(ob):
    me = ob.data
    me.uv_layers.new(name="UVMap")
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=0.0016, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.002)
    bpy.ops.object.mode_set(mode="OBJECT")
    area = 0.0
    uv = me.uv_layers.active.data
    for p in me.polygons:
        li = list(p.loop_indices)
        for k in range(1, len(li) - 1):
            a, b2, c = uv[li[0]].uv, uv[li[k]].uv, uv[li[k + 1]].uv
            area += abs((b2 - a).cross(c - a)) / 2
    log(f"uv packed: {area * 100:.1f}% of the atlas used")


def sharpen_by_angle(ob, deg):
    me = ob.data
    try:
        me.set_sharp_from_angle(angle=math.radians(deg))
    except Exception:
        bm = bmesh.new()
        bm.from_mesh(me)
        for e in bm.edges:
            if e.is_manifold and e.calc_face_angle(0) > math.radians(deg):
                e.smooth = False
        bm.to_mesh(me)
        bm.free()
    for p in me.polygons:
        p.use_smooth = True


def _new_float_img(name, res):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    im = bpy.data.images.new(name, res, res, alpha=True, float_buffer=True)
    im.colorspace_settings.name = "Non-Color"
    im.generated_color = (0, 0, 0, 0)
    return im


def _img_np(im):
    import numpy as np
    a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)


def dilate(img, cov, iters):
    import numpy as np
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


def bake_all(low, highs_by_cls, res):
    """Bake NORMAL / AO / ALB / ORM for every class group into numpy arrays (cached as .npy)."""
    import numpy as np
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = 0.04  # AO = local contact occlusion (4 cm)
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.use_cage = False
    all_objs = list(scene.objects)
    low_mat = bpy.data.materials.new("LOWBAKE")
    low_mat.use_nodes = True
    ln = low_mat.node_tree.nodes
    imgnode = ln.new("ShaderNodeTexImage")
    ln.active = imgnode
    results = {}
    passes = [("NORMAL", "NORMAL", 4), ("AO", "AO", args.bake_samples), ("ALB", "EMIT", 14), ("ORM", "EMIT", 6)]
    # per-class low meshes (atlas UVs kept)
    cls_attr = low.data.attributes["cls_id"]
    ids = [0] * len(low.data.polygons)
    cls_attr.data.foreach_get("value", ids)
    for pname, btype, spp in passes:
        cpath = os.path.join(CACHE_DIR, f"bake_{pname}_{res}.npy")
        if os.path.exists(cpath):
            results[pname] = np.load(cpath)
            log("bake (cached)", pname)
            continue
        for cls in HB:
            set_hb_pass(cls, pname)
        scene.cycles.samples = spp
        acc = np.zeros((res, res, 4), dtype=np.float32)
        cov = np.zeros((res, res), dtype=bool)
        for ci, cls in enumerate(CLASSES):
            highs = highs_by_cls.get(cls)
            if not highs:
                continue
            img = _new_float_img(f"bk_{pname}_{cls}", res)
            imgnode.image = img
            bm = bmesh.new()
            bm.from_mesh(low.data)
            layer = bm.faces.layers.int.get("cls_id")
            kill = [f for f in bm.faces if f[layer] != ci]
            bmesh.ops.delete(bm, geom=kill, context="FACES")
            me = bpy.data.meshes.new("bk_tmp")
            bm.to_mesh(me)
            bm.free()
            me.materials.append(low_mat)
            for poly in me.polygons:
                poly.use_smooth = True
            tmp = bpy.data.objects.new("bk_tmp", me)
            scene.collection.objects.link(tmp)
            for nm in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
                setattr(tmp, nm, False)
            keep = set(highs) | {tmp}
            if pname == "AO":
                keep |= {o for o in all_objs if o.get("bake_high")}
            for o in all_objs:
                o.hide_render = o not in keep
            for o in bpy.context.view_layer.objects:
                o.select_set(False)
            for h in highs:
                h.select_set(True)
            tmp.select_set(True)
            bpy.context.view_layer.objects.active = tmp
            cage = 0.010
            kw = dict(type=btype, use_selected_to_active=True, cage_extrusion=cage, max_ray_distance=cage * 2.4,
                      margin=0, use_clear=False, target="IMAGE_TEXTURES")
            if btype == "NORMAL":
                kw.update(normal_space="TANGENT", normal_r="POS_X", normal_g="POS_Y", normal_b="POS_Z")
            t0 = time.time()
            bpy.ops.object.bake(**kw)
            a = _img_np(img)
            m = a[..., 3] > 0.5
            acc[m] = a[m]
            cov |= m
            bpy.data.objects.remove(tmp)
            bpy.data.meshes.remove(me)
            bpy.data.images.remove(img)
            log(f"bake {pname} [{cls}] {time.time() - t0:.1f}s px={int(m.sum())}")
        for o in all_objs:
            o.hide_render = False
        out = dilate(acc[..., :3], cov, 20)
        np.save(cpath, out)
        np.save(os.path.join(CACHE_DIR, f"bake_COV_{res}.npy"), cov)
        results[pname] = out
    results["COV"] = np.load(os.path.join(CACHE_DIR, f"bake_COV_{res}.npy"))
    for cls in HB:
        set_hb_pass(cls, "NORMAL")
    return results


def srgb_encode(c):
    import numpy as np
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def composite(R, res):
    """Write the three maps (PNG, 8 bit) into the cache dir: albedo (sRGB), normal (OpenGL), ORM."""
    import numpy as np
    from PIL import Image
    ao = np.clip(R["AO"][..., 0], 0, 1)
    nrm = np.clip(R["NORMAL"], 0, 1)
    alb = np.clip(R["ALB"], 0, 1)
    orm = np.clip(R["ORM"], 0, 1)
    # cavity from the normal map's divergence adds a little micro-occlusion on top of the baked AO
    nx = nrm[..., 0] * 2 - 1
    ny = nrm[..., 1] * 2 - 1
    div = (np.roll(nx, -1, 1) - np.roll(nx, 1, 1)) + (np.roll(ny, -1, 0) - np.roll(ny, 1, 0))
    cav = np.clip(-div * 0.6 * (res / 2048.0), 0, 0.5)
    occ = np.clip(ao * (1 - 0.5 * cav), 0, 1)
    # bake the occlusion a little into the albedo so the game's flat ambient still reads folds
    alb_out = alb * (0.78 + 0.22 * occ[..., None])
    paths = {}
    outs = {
        "albedo": (np.dstack([srgb_encode(alb_out)]), "RGB"),
        "normal": (nrm, "RGB"),
        "orm": (np.dstack([occ, orm[..., 1], orm[..., 2]]), "RGB"),
    }
    for k, (arr, mode) in outs.items():
        im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
        im = im.transpose(Image.FLIP_TOP_BOTTOM)  # Blender rows start at the bottom
        fp = os.path.join(CACHE_DIR, f"body_{k}.png")
        im.save(fp)
        paths[k] = fp
    return paths


# -----------------------------------------------------------------------------
# Game material (baked atlas) — glTF-friendly node layout
# -----------------------------------------------------------------------------
def gltf_settings_group():
    name = "glTF Material Output"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    g = bpy.data.node_groups.new(name, "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def game_material(paths):
    mat = bpy.data.materials.new("AT3D_Body")
    b = NB(mat)
    out = b.n("ShaderNodeOutputMaterial")
    bsdf = b.n("ShaderNodeBsdfPrincipled")
    b.link(bsdf.outputs[0], out.inputs["Surface"])

    def tex(key, cs):
        im = bpy.data.images.load(paths[key], check_existing=True)
        im.colorspace_settings.name = cs
        return b.n("ShaderNodeTexImage", image=im)
    a = tex("albedo", "sRGB")
    b.link(a.outputs["Color"], bsdf.inputs["Base Color"])
    n = tex("normal", "Non-Color")
    nm = b.n("ShaderNodeNormalMap")
    b.link(n.outputs["Color"], nm.inputs["Color"])
    b.link(nm.outputs["Normal"], bsdf.inputs["Normal"])
    o = tex("orm", "Non-Color")
    sep = b.n("ShaderNodeSeparateColor")
    b.link(o.outputs["Color"], sep.inputs[0])
    b.link(sep.outputs[1], bsdf.inputs["Roughness"])
    b.link(sep.outputs[2], bsdf.inputs["Metallic"])
    grp = b.n("ShaderNodeGroup")
    grp.node_tree = gltf_settings_group()
    b.link(sep.outputs[0], grp.inputs["Occlusion"])
    return mat


# -----------------------------------------------------------------------------
# Armature
# -----------------------------------------------------------------------------
def build_armature(coll):
    arm = bpy.data.armatures.new("Body_Armature")
    ob = bpy.data.objects.new("Body_Armature", arm)
    coll.objects.link(ob)
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    for name, parent, head, tail, zax in ALL_BONES:
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = head.copy(), tail.copy()
        eb.align_roll(zax)
        if parent:
            eb.parent = ebs[parent]
            eb.use_connect = False
        ebs[name] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


# -----------------------------------------------------------------------------
# Clips (rotations are authored about the REST-WORLD axes: +X right, +Y forward, +Z up)
# -----------------------------------------------------------------------------
FPS = 30


def deg(*a):
    return tuple(math.radians(v) for v in a)


def set_bone_pose(pb, rot_deg=None, loc=None):
    Rb = pb.bone.matrix_local.to_3x3()
    q = Euler(deg(*(rot_deg or (0, 0, 0))), "XYZ").to_quaternion()
    ql = (Rb.inverted() @ q.to_matrix() @ Rb).to_quaternion()
    pb.rotation_quaternion = ql
    d = Vector(loc) if loc else Vector((0, 0, 0))
    pb.location = Rb.inverted() @ d


def leg_bones(out, s, h, k, ankle, toe=0.0):
    out[f"Thigh_{s}"] = ((h, 0.0, 0.0), None)
    out[f"Shin_{s}"] = ((-k, 0.0, 0.0), None)
    out[f"Foot_{s}"] = ((ankle, 0.0, 0.0), None)
    out[f"Toe_{s}"] = ((toe, 0.0, 0.0), None)


def clip_idle(t):
    br = 0.5 - 0.5 * math.cos(2 * math.pi * t)
    sw = math.sin(2 * math.pi * t)
    d = {"Pelvis": ((0.0, 0.0, 0.8 * sw), (0.007 * sw, 0.0, 0.003 * br - 0.006)),
         "Spine1": ((-0.6 * br, 0.0, -0.5 * sw), None), "Spine2": ((-1.3 * br, 0.0, -0.4 * sw), None),
         "Neck": ((0.0, 0.0, 0.0), None),
         "Pack": ((1.0 * math.sin(2 * math.pi * t - 0.7), 0.0, 0.0), None),
         "Pouch_R": ((2.0 * math.sin(2 * math.pi * t - 0.4), 0.0, 0.0), None),
         "Pouch_L": ((2.0 * math.sin(2 * math.pi * t - 0.9), 0.0, 0.0), None)}
    leg_bones(d, "R", 2.5 + 1.2 * sw, 6.0 + 1.5 * sw, -(2.5 - 6.0) + 0.0)
    leg_bones(d, "L", 2.5 - 1.2 * sw, 6.0 - 1.5 * sw, -(2.5 - 6.0) + 0.0)
    return d


def run_leg(phi):
    """Thigh flexion, knee flexion, ankle (degrees) of one leg at cycle phase phi in [0,1)."""
    phi = phi % 1.0
    h = 5.0 + 33.0 * math.cos(2 * math.pi * (phi - 0.02))
    if phi < 0.45:
        k = 15.0 + 24.0 * math.sin(math.pi * phi / 0.45)
        stance = 1.0
    else:
        u = (phi - 0.45) / 0.55
        k = 15.0 + 92.0 * (math.sin(math.pi * u) ** 1.25)
        stance = max(0.0, 1.0 - sstep(0.0, 0.35, u)) * 0.0 + (sstep(0.9, 1.0, u))
    ank = -(h - k) * (stance) + (-18.0) * (1.0 - stance)
    return h, k, ank


def clip_run(t):
    d = {}
    for s, ph in (("L", t), ("R", t + 0.5)):
        h, k, a = run_leg(ph)
        leg_bones(d, s, h, k, a, toe=-6.0 if run_leg(ph)[1] > 60 else 0.0)
    z = -0.035 - 0.025 * math.cos(4 * math.pi * (t - 0.2))
    d["Pelvis"] = ((-7.0, 0.0, 6.0 * math.sin(2 * math.pi * t)), (0.012 * math.sin(2 * math.pi * (t - 0.2)), 0.0, z))
    d["Spine1"] = ((-3.0, 0.0, -4.0 * math.sin(2 * math.pi * t)), None)
    d["Spine2"] = ((-3.0, 0.0, -5.0 * math.sin(2 * math.pi * t)), None)
    d["Neck"] = ((4.0, 0.0, 0.0), None)
    d["Pack"] = ((3.0 * math.sin(4 * math.pi * (t - 0.30)), 0.0, 1.5 * math.sin(2 * math.pi * t)), None)
    d["Pouch_R"] = ((7.0 * math.sin(4 * math.pi * (t - 0.1)), 0.0, 2.0), None)
    d["Pouch_L"] = ((7.0 * math.sin(4 * math.pi * (t - 0.6)), 0.0, -2.0), None)
    return d


def clip_hang(t):
    w = 2 * math.pi * t
    d = {}
    leg_bones(d, "L", 9.0 + 5.0 * math.sin(w), 24.0 + 9.0 * math.sin(w + 1.0), -38.0 + 6.0 * math.sin(w + 0.5), toe=-10.0)
    leg_bones(d, "R", 12.0 + 5.0 * math.sin(w + math.pi), 28.0 + 9.0 * math.sin(w + 1.0 + math.pi), -40.0 + 6.0 * math.sin(w + 0.5 + math.pi), toe=-10.0)
    d["Pelvis"] = ((-3.0 + 2.0 * math.sin(w), 0.0, 3.0 * math.sin(w)), (0.0, 0.0, 0.0))
    d["Spine1"] = ((1.0 * math.sin(w + 0.6), 0.0, 0.0), None)
    d["Spine2"] = ((1.5 * math.sin(w + 0.9), 0.0, 0.0), None)
    d["Pack"] = ((5.0 * math.sin(w - 0.8), 0.0, 2.0 * math.sin(w)), None)
    d["Pouch_R"] = ((10.0 * math.sin(w - 0.2), 0.0, 4.0 * math.sin(w)), None)
    d["Pouch_L"] = ((10.0 * math.sin(w - 0.7), 0.0, -4.0 * math.sin(w)), None)
    return d


def clip_fall(t):
    w = 2 * math.pi * t
    d = {}
    leg_bones(d, "L", 22.0 + 20.0 * math.sin(w), 48.0 + 26.0 * math.sin(w + 1.1), -22.0 + 10.0 * math.sin(w + 0.4), toe=-8.0)
    leg_bones(d, "R", 22.0 + 20.0 * math.sin(w + 2.4), 48.0 + 26.0 * math.sin(w + 3.5), -22.0 + 10.0 * math.sin(w + 2.8), toe=-8.0)
    d["Pelvis"] = ((-4.0 + 3.0 * math.sin(2 * w), 0.0, 5.0 * math.sin(w)), (0.0, 0.0, -0.012 + 0.012 * math.sin(2 * w)))
    d["Spine1"] = ((-2.0 * math.sin(2 * w + 0.5), 0.0, 3.0 * math.sin(w)), None)
    d["Spine2"] = ((-3.0 * math.sin(2 * w + 0.9), 0.0, 3.0 * math.sin(w + 0.4)), None)
    d["Pack"] = ((-12.0 + 4.0 * math.sin(2 * w), 0.0, 3.0 * math.sin(w)), None)
    d["Pouch_R"] = ((-16.0 + 6.0 * math.sin(2 * w), 0.0, 5.0), None)
    d["Pouch_L"] = ((-16.0 + 6.0 * math.sin(2 * w + 0.7), 0.0, -5.0), None)
    return d


def clip_land(t):
    a = sstep(0.0, 0.26, t) * (1.0 - 0.9 * sstep(0.34, 1.0, t))
    d = {}
    for s in ("R", "L"):
        leg_bones(d, s, 6.0 + 50.0 * a, 8.0 + 72.0 * a, -(6.0 + 50.0 * a - 8.0 - 72.0 * a) * 1.0)
    d["Pelvis"] = ((-4.0 - 14.0 * a, 0.0, 0.0), (0.0, -0.02 * a, -0.215 * a))
    d["Spine1"] = ((-8.0 * a, 0.0, 0.0), None)
    d["Spine2"] = ((-8.0 * a, 0.0, 0.0), None)
    d["Pack"] = ((10.0 * math.sin(math.pi * clamp(t * 1.4)) * (1 - t), 0.0, 0.0), None)
    d["Pouch_R"] = ((-18.0 * math.sin(math.pi * clamp(t * 1.5)), 0.0, 0.0), None)
    d["Pouch_L"] = ((-18.0 * math.sin(math.pi * clamp(t * 1.5)), 0.0, 0.0), None)
    return d


CLIPS = [
    # name, frames, loop, fn
    ("Idle_Stand", 90, True, clip_idle),
    ("Run", 30, True, clip_run),
    ("Hang_Swing", 60, True, clip_hang),
    ("Fall", 45, True, clip_fall),
    ("Land", 18, False, clip_land),
]


def make_clip_actions(arm_ob):
    ad = arm_ob.animation_data_create()
    sc = bpy.context.scene
    sc.render.fps = FPS
    acts = []
    for name, n, loop, fn in CLIPS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad.action = act
        for f in range(n + 1):
            t = f / n if loop else min(1.0, f / n)
            d = fn(t if loop else t)
            for pb in arm_ob.pose.bones:
                pr = d.get(pb.name)
                if pr is None:
                    set_bone_pose(pb)
                else:
                    set_bone_pose(pb, pr[0], pr[1])
                pb.keyframe_insert("rotation_quaternion", frame=f)
                if pb.name == "Pelvis":
                    pb.keyframe_insert("location", frame=f)
        tr = ad.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, 0, act)
        st.name = act.name
        tr.mute = True
        acts.append(act)
        ad.action = None
    for pb in arm_ob.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
    return acts


def apply_clip(arm_ob, name, frame):
    for n, nf, loop, fn in CLIPS:
        if n == name:
            t = (frame / nf) if loop else min(1.0, frame / nf)
            d = fn(t)
            for pb in arm_ob.pose.bones:
                pr = d.get(pb.name)
                set_bone_pose(pb, *(pr if pr else (None, None)))
            bpy.context.view_layer.update()
            return


# -----------------------------------------------------------------------------
# Renders
# -----------------------------------------------------------------------------
def setup_cycles(scene, samples, res):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    w, h = (int(v) for v in res.split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4


def add_light(name, kind, loc, energy, color, size=0.1, rot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "POINT":
        ld.shadow_soft_size = size
    if kind == "AREA":
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    bpy.context.scene.collection.objects.link(ob)
    return ob


def render_views(scene, arm_ob, body, which):
    """Turnaround, poses and the first-person look-down (game mesh + baked atlas)."""
    setup_cycles(scene, args.samples, args.res)
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("RenderWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.010, 0.012, 0.016, 1)
    bg.inputs[1].default_value = 1.0
    scene.view_settings.exposure = 0.3
    # floor
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=6.0)
    me = bpy.data.meshes.new("Floor")
    bm.to_mesh(me)
    bm.free()
    fl = bpy.data.objects.new("Floor", me)
    scene.collection.objects.link(fl)
    fm = bpy.data.materials.new("FloorMat")
    fm.use_nodes = True
    fb = fm.node_tree.nodes["Principled BSDF"]
    fb.inputs["Base Color"].default_value = (0.05, 0.048, 0.045, 1)
    fb.inputs["Roughness"].default_value = 0.85
    fl.data.materials.append(fm)
    lights = []

    def studio(strong=1.0):
        for lt in lights:
            bpy.data.objects.remove(lt)
        lights.clear()
        lights.append(add_light("Key", "AREA", (2.2, 2.6, 2.6), 260 * strong, (1.0, 0.86, 0.68), size=2.0, rot=(math.radians(58), 0, math.radians(140))))
        lights.append(add_light("Rim", "AREA", (-2.4, -2.0, 2.2), 180 * strong, (0.62, 0.74, 1.0), size=2.0, rot=(math.radians(60), 0, math.radians(-40))))
        lights.append(add_light("Fill", "AREA", (-2.2, 2.2, 1.0), 70 * strong, (1.0, 0.95, 0.9), size=2.5, rot=(math.radians(80), 0, math.radians(-140))))

    def shot(name, loc, tgt, lens, clip=0.03):
        cam = add_camera(name, loc, tgt, lens, (clip, 60))
        scene.camera = cam
        scene.render.filepath = os.path.join(RENDER_DIR, f"body_{name}.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam)
        log("rendered", name)

    sel = set(which.split(",")) if which else None

    def want(n):
        return (not sel) or n in sel

    studio()
    apply_clip(arm_ob, "Idle_Stand", 0)
    if want("front"):
        shot("front", (0.0, 4.3, 1.0), (0, 0, 0.9), 50)
    if want("side"):
        shot("side", (4.3, 0.0, 1.0), (0, 0, 0.9), 50)
    if want("back"):
        shot("back", (0.0, -4.3, 1.0), (0, 0, 0.9), 50)
    if want("q34"):
        shot("q34", (2.4, 2.4, 1.35), (0, 0, 0.9), 50)
    if want("upper"):
        shot("upper", (1.0, 1.35, 1.45), (0, 0, 1.18), 50)
    if want("boots"):
        shot("boots", (0.9, 1.0, 0.45), (0, 0.03, 0.22), 50)
    if want("pack"):
        shot("pack", (1.3, -1.55, 1.5), (0, -0.18, 1.2), 50)
    if want("run"):
        apply_clip(arm_ob, "Run", 4)
        shot("run", (3.3, 2.4, 1.2), (0, 0.1, 0.9), 50)
    if want("hang"):
        apply_clip(arm_ob, "Hang_Swing", 12)
        shot("hang", (3.3, 2.4, 1.2), (0, 0.1, 0.9), 50)
    if want("fall"):
        apply_clip(arm_ob, "Fall", 10)
        shot("fall", (3.3, 2.4, 1.2), (0, 0.1, 0.9), 50)
    if want("fp") or want("fp2"):
        apply_clip(arm_ob, "Idle_Stand", 0)
        # lantern-lit: a warm point light near the left hand, no studio lights
        for lt in lights:
            bpy.data.objects.remove(lt)
        lights.clear()
        lights.append(add_light("Lantern", "POINT", (-0.28, 0.40, 1.15), 55, (1.0, 0.62, 0.30), size=0.03))
        lights.append(add_light("Fill", "POINT", (0.3, 0.2, 2.0), 16, (0.7, 0.8, 1.0), size=0.3))
        if want("fp"):
            shot("fp_down", (0.0, 0.09, 1.62), (0.0, 0.08, 0.5), -70, 0.05)
        if want("fp2"):
            shot("fp_look", (0.0, 0.09, 1.62), (0.0, 0.5, 0.95), -70, 0.05)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    work = bpy.data.collections.new("Work")
    sc.collection.children.link(work)
    # HIGH (bake source)
    t = time.time()
    hi_parts = build_all(LV(True))
    log(f"high built: {sum(tri_count_bm(p.bm) for p in hi_parts) / 1000:.0f}k tris in {time.time() - t:.1f}s")
    for cls in CLASSES:
        hb_material(cls)
    highs_by_cls = {}
    for ob, pt in zip(parts_to_object(hi_parts, "hi", work), hi_parts):
        ob.data.materials.append(HB[pt.cls]["mat"])
        for poly in ob.data.polygons:
            poly.use_smooth = True
        ob["bake_high"] = 1
        highs_by_cls.setdefault(pt.cls, []).append(ob)
    # LOW (the game mesh)
    lo_parts = build_all(LV(False))
    tot = 0
    for p in lo_parts:
        n = tri_count_bm(p.bm)
        tot += n
    log("LOW parts:", ", ".join(f"{p.name}={tri_count_bm(p.bm)}" for p in lo_parts))
    log("LOW total tris", tot)
    low, weights = join_low(lo_parts, work)
    return sc, work, low, weights, highs_by_cls, tot


def main():
    sc, work, low, weights, highs_by_cls, lowtris = build_scene()
    if args.stage == "shape":
        return shape_stage(sc, low, highs_by_cls)
    sharpen_by_angle(low, 46)
    uv_unwrap(low)
    # bake
    R = bake_all(low, highs_by_cls, args.bake)
    paths = composite(R, args.bake)
    log("composited", paths)
    if args.stage == "bake":
        return
    mat = game_material(paths)
    low.data.materials.append(mat)
    # armature + skin
    arm = build_armature(work)
    for name in [b[0] for b in ALL_BONES]:
        low.vertex_groups.new(name=name)
    vgs = {vg.name: vg for vg in low.vertex_groups}
    for i, w in enumerate(weights):
        for bn, wt in w.items():
            vgs[bn].add([i], wt, "REPLACE")
    low.parent = arm
    mod = low.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    low.name = "Body_Mesh"
    make_clip_actions(arm)
    bpy.context.view_layer.update()
    # hide the high-poly sources
    for objs in highs_by_cls.values():
        for o in objs:
            o.hide_render = True
            o.hide_viewport = True
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
    export_glb(arm, low)
    log("tris", lowtris, "bones", len(ALL_BONES))
    if args.render:
        render_views(sc, arm, low, args.only)
    log("done")


def export_glb(arm, low):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    arm.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = arm
    glb = os.path.join(args.out, "player_body.glb")
    common = dict(filepath=glb, export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_texcoords=True,
                  export_normals=True, export_tangents=False, export_materials="EXPORT", export_skins=True, export_animations=True,
                  export_animation_mode="ACTIONS", export_force_sampling=True, export_def_bones=False, export_rest_position_armature=True,
                  export_morph=False, export_extras=False, export_cameras=False, export_lights=False)
    for fmt, extra in (("WEBP", dict(export_image_quality=88)), ("JPEG", dict(export_image_quality=90)), ("AUTO", {})):
        try:
            bpy.ops.export_scene.gltf(export_image_format=fmt, **extra, **common)
            break
        except Exception as e:  # noqa: BLE001
            log("export with", fmt, "failed:", e)
    log("exported", glb, f"{os.path.getsize(glb) / 1e6:.2f} MB")


def shape_stage(sc, low, highs_by_cls):
    cm = clay_material()
    palette = {"canvas": (0.30, 0.29, 0.24), "canvas_pack": (0.33, 0.30, 0.22), "twill": (0.22, 0.24, 0.26), "twill_pocket": (0.25, 0.27, 0.29),
               "leather": (0.42, 0.25, 0.12), "leather_boot": (0.33, 0.20, 0.10), "rubber": (0.1, 0.1, 0.1), "cord_hw": (0.6, 0.55, 0.4),
               "webbing": (0.62, 0.38, 0.16), "pack_strap": (0.25, 0.2, 0.14), "steel": (0.6, 0.6, 0.62), "wool": (0.5, 0.18, 0.12), "rope": (0.7, 0.6, 0.4), "brass": (0.8, 0.6, 0.2)}
    objs = [o for lst in highs_by_cls.values() for o in lst] if "hi" in args.only else [low]
    for ob in objs:
        ob.data.materials.clear()
        ob.data.materials.append(cm)
        ob.color = (*palette.get(ob.get("cls", "canvas"), (0.5, 0.5, 0.5)), 1.0)
    for o in (list(sum(highs_by_cls.values(), [])) if "hi" not in args.only else [low]):
        o.hide_render = True
    cams = {
        "front": ((0, 3.4, 1.0), (0, 0, 0.95), 40),
        "side": ((3.4, 0, 1.0), (0, 0, 0.95), 40),
        "back": ((0.4, -3.2, 1.1), (0, 0, 0.95), 40),
        "fp": ((0.0, 0.09, 1.62), (0.0, 0.5, 0.9), -70),
        "fp2": ((0.0, 0.09, 1.62), (0.0, 0.12, 0.6), -70),
    }
    sel = [k for k in cams if (not args.only) or k in args.only.split(",")]
    for k in sel:
        loc, tgt, lens = cams[k]
        cam = add_camera(k, loc, tgt, lens)
        clay_render(os.path.join(RENDER_DIR, f"clay_{k}.png"), cam)
    log("clay done")


main()
