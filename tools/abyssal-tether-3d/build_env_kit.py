"""ABYSSAL TETHER 3D — procedural builder for the Underspire environment kit.

Builds the Lanternwright architectural dressing kit in Blender from code and
exports it as ONE glTF binary of modular parts (one mesh per part, each at the
origin with a documented pivot) that LevelView instances along the level's
collision boxes at load time:

  public/abyssal-tether-3d/assets/models/env/ch1_env_kit.glb
  (+ optional Cycles preview: --render → <out>/ch1_env_kit_preview.png)

Parts are dressing: the level's boxes stay the collision of the shaft itself, and the parts that project into the open get collision
boxes of their own from the built kit (bake/decor_part_boxes.mjs -> src/data/decor-parts-3d.js, placed by sim/decorColliders.js; re-run
it after a rebuild). No UVs and
no textures are exported: LevelView projects the shared baked sets
(assets/textures: masonry / metal / flesh) in world metres, and every part
carries a baked ambient-occlusion term in COLOR_0 (grey) so carved detail reads
under the carried lantern. Materials are named after the texture set the engine
draws them with: stone | metal | flesh.

Conventions (three.js space: +Y up; Blender Z-up is converted on export):
  wall-mounted parts:  back face on the wall plane z = 0, projecting toward +z,
                       centred on x = 0 (x runs along the wall)
  hanging parts:       top at y = 0 (the underside they hang from)
  standing parts:      bottom at y = 0
  far silhouettes:     unit height (they are scaled to 60–220 m in-engine)

  part                     material  pivot / size (metres)
  ch1_env_corbel           stone     top-back-centre; 0.7 w × 1.1 h × 0.8 d (hangs from y = 0)
  ch1_env_corbel_figure    stone     top-back-centre; hooded atlas figure 1.0 w × 2.1 h × 0.85 d
  ch1_env_capital          stone     top-back-centre; caps the 1.0 × 0.55 m pilaster (abacus 1.5 × 0.85)
  ch1_env_base             stone     bottom-back-centre; plinth 1.4 × 0.8, 0.75 h
  ch1_env_boss             stone     top-centre; pendant rib boss Ø 1.1, 1.1 h
  ch1_env_bracket          metal     wall plate at z = 0, y = −1.4; beam plate at y = 0, z = 1.4 (knee brace)
  ch1_env_root_a|b|c       flesh     top-back; sinew roots hanging 5 / 7.5 / 10 m down a wall, ±1.4 m wide
  ch1_env_growth           flesh     back-centre; a sinew burl Ø 1.4 clinging to a wall (z ≥ 0)
  ch1_env_saint            stone     bottom-back-centre; hooded saint on a bracket in a pointed niche, h = 1.28 (figure 0.8), w 0.4, d 0.23
  ch1_env_gear             metal     centre on the wall (z = 0); iron cog, r = 1 (teeth), rim face z 0.16, hub z 0.3
  ch1_env_geartrain        metal     centre of the big cog on the wall (z = 0); VR hero: three meshing cogs (22/12/7 teeth, r = 1 / 0.56 / 0.34), bearing
                                     blocks + straps, a rack bar and a chain over the big cog; bbox x -1.25..1.95, y -1.3..1.75, z to 0.46 (~2.1 k tris)
  ch1_env_corbel_hero      stone     top-back-centre; VR hero: carved corbel head 1.0 w x 1.9 h x 1.1 d, stepped tiers, dentils, volutes, leaves, dead lantern (~0.9 k)
  ch1_env_arch_fragment    stone     bottom-back-centre; VR hero: crumbling pointed-arch relief 1.22 w x 1.0 h x 0.42 d on a shelf with fallen stones (~0.3 k)
  ch1_env_far_colossus     stone     bottom-centre; hooded Lanternwright, lantern held forward (+z), h = 1
  ch1_env_far_column       stone     bottom-centre; fluted colossal column, broken top, h = 1 (r 0.07)
  ch1_env_far_spire        stone     top-centre; inverted spire with fins and pinnacles, y 0 → −1
  ch1_env_far_arcade       stone     deck-top-centre; three pointed arches on piers, w 1 (x ±0.5), y 0 → −1

Run (Blender 4.2+/5.x, or the `bpy` Python module):
  blender -b -P build_env_kit.py -- [--out <dir>] [--render] [--focus name,name]
  python build_env_kit.py [--out <dir>] [--render] [--lods 0|1] [--detail 0|1]
  (one GLB: every detailed part at three levels, ch1_env_<part>_lod0 / ch1_env_<part> / ch1_env_<part>_lod2; then
   node tools/abyssal-tether-3d/bake/decor_part_boxes.mjs)
"""

import argparse
import math
import os
import random
import sys

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "..", "public", "abyssal-tether-3d", "assets", "models", "env"))

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=DEFAULT_OUT)
ap.add_argument("--render", action="store_true", help="render a Cycles preview of every part")
ap.add_argument("--seed", type=int, default=11)
ap.add_argument("--lods", type=int, default=1, help="1: every detailed part is exported at three levels (ch1_env_<part>_lod0 rich, ch1_env_<part> medium, ch1_env_<part>_lod2 far); 0: the medium level only")
ap.add_argument("--detail", type=int, default=1, help="1: bevel + subdivide + weather every near part and decimate to DETAIL_TRIS; 0: the original lean kit")
ap.add_argument("--ao-rays", type=int, default=40)
ap.add_argument("--focus", default="", help="comma list of part names: --render shows only these (a closer look)")
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)
RNG = random.Random(args.seed)

TAU = math.pi * 2


# -----------------------------------------------------------------------------
# Geometry accumulator in three.js space (x, y up, z out of the wall)
# -----------------------------------------------------------------------------
def to_blender(p):
    x, y, z = p
    return (x, -z, y)


class Geo:
    """Collects polygons in three.js space; smooth flag per polygon."""

    def __init__(self):
        self.verts = []
        self.faces = []  # (indices, smooth)

    def v(self, x, y, z):
        self.verts.append((x, y, z))
        return len(self.verts) - 1

    def face(self, idx, smooth=False):
        self.faces.append((list(idx), smooth))

    def add(self, other, fn=None):
        base = len(self.verts)
        for p in other.verts:
            self.verts.append(fn(p) if fn else p)
        for idx, sm in other.faces:
            self.faces.append(([i + base for i in idx], sm))
        return self

    def transformed(self, fn):
        g = Geo()
        g.add(self, fn)
        return g


def xf(tx=0.0, ty=0.0, tz=0.0, rx=0.0, ry=0.0, rz=0.0, s=(1.0, 1.0, 1.0)):
    """Scale, then rotate X, Y, Z (radians), then translate — as a point function."""
    sx, sy, sz = s if isinstance(s, (tuple, list)) else (s, s, s)
    cx, sxn = math.cos(rx), math.sin(rx)
    cy, syn = math.cos(ry), math.sin(ry)
    cz, szn = math.cos(rz), math.sin(rz)

    def f(p):
        x, y, z = p[0] * sx, p[1] * sy, p[2] * sz
        y, z = y * cx - z * sxn, y * sxn + z * cx
        x, z = x * cy + z * syn, -x * syn + z * cy
        x, y = x * cz - y * szn, x * szn + y * cz
        return (x + tx, y + ty, z + tz)

    return f


def box(x0, y0, z0, x1, y1, z1):
    g = Geo()
    c = [g.v(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    # index = xi*4 + yi*2 + zi
    q = lambda a, b, cc, d: g.face([c[a], c[b], c[cc], c[d]])  # noqa: E731
    q(0, 1, 3, 2)  # -x
    q(4, 6, 7, 5)  # +x
    q(0, 4, 5, 1)  # -y
    q(2, 3, 7, 6)  # +y
    q(0, 2, 6, 4)  # -z
    q(1, 5, 7, 3)  # +z
    return g


def extrude_x(profile, x0, x1, smooth=False, caps=True):
    """profile: [(z, y)] counter-clockwise seen from +x; extruded from x0 to x1."""
    g = Geo()
    n = len(profile)
    a = [g.v(x0, y, z) for z, y in profile]
    b = [g.v(x1, y, z) for z, y in profile]
    for i in range(n):
        j = (i + 1) % n
        g.face([a[i], a[j], b[j], b[i]], smooth)
    if caps:
        g.face(list(reversed(a)))
        g.face(b)
    return g


def lathe(profile, seg=12, a0=0.0, a1=TAU, smooth=True, cap_top=True, cap_bottom=True):
    """profile: [(r, y)] bottom → top; revolved about +Y from angle a0 to a1 (0 = +z)."""
    g = Geo()
    full = abs((a1 - a0) - TAU) < 1e-6
    cols = seg if full else seg + 1
    rows = []
    for i in range(cols):
        a = a0 + (a1 - a0) * i / seg
        s, c = math.sin(a), math.cos(a)
        rows.append([g.v(r * s, y, r * c) for r, y in profile])
    for i in range(seg):
        A = rows[i]
        B = rows[(i + 1) % cols] if full else rows[i + 1]
        for k in range(len(profile) - 1):
            g.face([A[k], B[k], B[k + 1], A[k + 1]], smooth)
    if full:
        if cap_bottom and profile[0][0] > 1e-4:
            g.face([rows[i][0] for i in reversed(range(cols))])
        if cap_top and profile[-1][0] > 1e-4:
            g.face([rows[i][-1] for i in range(cols)])
    else:
        # flat back (the wall side) closes the half-lathe
        back = [rows[0][k] for k in range(len(profile))] + [rows[-1][k] for k in reversed(range(len(profile)))]
        g.face(back)
        if cap_bottom and profile[0][0] > 1e-4:
            g.face([rows[i][0] for i in reversed(range(cols))])
        if cap_top and profile[-1][0] > 1e-4:
            g.face([rows[i][-1] for i in range(cols)])
    return g


def loft_rect(levels, smooth=False):
    """levels: [(y, x0, x1, z0, z1)] bottom → top rectangles (z0 = back); open back face is closed."""
    g = Geo()
    rings = []
    for y, xa, xb, za, zb in levels:
        rings.append([g.v(xa, y, za), g.v(xb, y, za), g.v(xb, y, zb), g.v(xa, y, zb)])
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        for i in range(4):
            j = (i + 1) % 4
            g.face([A[i], A[j], B[j], B[i]], smooth)
    g.face(list(reversed(rings[0])))
    g.face(rings[-1])
    return g


def tube(points, radii, sides=6, smooth=True, cap=True):
    """Tube through 3D points with per-point radii (parallel-transport frames)."""
    g = Geo()
    P = [Vector(p) for p in points]
    n = len(P)
    T = []
    for i in range(n):
        d = (P[min(n - 1, i + 1)] - P[max(0, i - 1)])
        T.append(d.normalized() if d.length > 1e-9 else Vector((0, -1, 0)))
    ref = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = T[0].cross(ref).normalized()
    rings = []
    for i in range(n):
        if i > 0:
            axis = T[i - 1].cross(T[i])
            if axis.length > 1e-9:
                ang = T[i - 1].angle(T[i])
                from mathutils import Matrix

                N = (Matrix.Rotation(ang, 3, axis.normalized()) @ N).normalized()
        B = T[i].cross(N).normalized()
        ring = []
        for k in range(sides):
            a = TAU * k / sides
            off = N * math.cos(a) * radii[i] + B * math.sin(a) * radii[i]
            q = P[i] + off
            ring.append(g.v(q.x, q.y, q.z))
        rings.append(ring)
    for i in range(n - 1):
        A, Bb = rings[i], rings[i + 1]
        for k in range(sides):
            j = (k + 1) % sides
            g.face([A[k], A[j], Bb[j], Bb[k]], smooth)
    if cap:
        tip = g.v(*(P[-1] + T[-1] * radii[-1] * 0.8))
        for k in range(sides):
            g.face([rings[-1][k], rings[-1][(k + 1) % sides], tip], smooth)
        g.face(list(reversed(rings[0])), smooth)
    return g


def cone(r, h, seg=6, y0=0.0, tip_up=True):
    g = Geo()
    ring = [g.v(r * math.sin(TAU * i / seg), y0, r * math.cos(TAU * i / seg)) for i in range(seg)]
    tip = g.v(0, y0 + (h if tip_up else -h), 0)
    for i in range(seg):
        j = (i + 1) % seg
        g.face([ring[i], ring[j], tip] if tip_up else [ring[j], ring[i], tip])
    g.face(list(reversed(ring)) if tip_up else ring)
    return g


def pointed_arch_pts(w, rise, n=8):
    """Points of a two-centred pointed arch from (-w/2, 0) over the apex (0, rise) to (w/2, 0)."""
    half = w / 2
    c = (rise * rise - half * half) / (2 * half)  # centre of the left arc, right of the middle
    R = half + c
    a_apex = math.acos(max(-1.0, min(1.0, -c / R)))
    left = []
    for i in range(n + 1):
        a = math.pi - (math.pi - a_apex) * i / n
        left.append((c + R * math.cos(a), R * math.sin(a)))
    right = [(-x, y) for x, y in reversed(left[:-1])]
    return left + right


# -----------------------------------------------------------------------------
# Parts
# -----------------------------------------------------------------------------
def part_corbel():
    g = Geo()
    W = 0.35
    # side profile (z out, y) CCW seen from +x: back top → front → scroll → back bottom
    prof = [(0.0, 0.0), (0.0, -1.1), (0.08, -1.1), (0.12, -1.02)]
    # ogee rising from the foot to under the roll
    for i in range(1, 9):
        t = i / 8
        z = 0.12 + 0.42 * t
        y = -1.02 + 0.6 * t + 0.08 * math.sin(t * math.pi)
        prof.append((z, y))
    prof += [(0.58, -0.36), (0.66, -0.3), (0.7, -0.2), (0.7, -0.17), (0.8, -0.15), (0.8, 0.0)]
    g.add(extrude_x(prof, -W, W))
    # front roll (volute) under the abacus, and side spirals
    roll = lathe([(0.0, -W - 0.02), (0.13, -W - 0.02), (0.15, -W + 0.04), (0.15, W - 0.04), (0.13, W + 0.02), (0.0, W + 0.02)], seg=10)
    g.add(roll, xf(tz=0.6, ty=-0.33, rz=math.pi / 2))
    for sx in (-1, 1):
        disc = lathe([(0.0, 0.0), (0.2, 0.0), (0.22, 0.03), (0.12, 0.06), (0.0, 0.07)], seg=10)
        g.add(disc, xf(tx=sx * (W - 0.01), ty=-0.36, tz=0.5, rz=-sx * math.pi / 2))
    # carved leaf rib down the front of the ogee
    leaf = []
    for i in range(7):
        t = i / 6
        leaf.append((0.0, -0.45 - 0.5 * t, 0.56 - 0.38 * t + 0.03))
    g.add(tube(leaf, [0.05, 0.06, 0.06, 0.05, 0.045, 0.035, 0.02], sides=5))
    return g


def part_corbel_figure():
    """A hooded Lanternwright atlas: back to the wall, hands raised to the slab."""
    g = Geo()
    # abacus slab it holds up
    g.add(box(-0.5, -0.16, 0.0, 0.5, 0.0, 0.85))
    # robe: half-lathe tapering to a pointed foot (the figure has no legs — it grows out of the wall)
    robe = [(0.02, -2.1), (0.12, -1.95), (0.24, -1.7), (0.33, -1.35), (0.38, -1.0), (0.37, -0.8)]
    g.add(lathe(robe, seg=8, a0=-math.pi / 2, a1=math.pi / 2, smooth=True, cap_bottom=False), xf(tz=0.0))
    # bands carved round the robe
    for y, r in ((-1.62, 0.27), (-1.25, 0.36)):
        g.add(lathe([(r + 0.0, y - 0.03), (r + 0.04, y), (r, y + 0.03)], seg=8, a0=-math.pi / 2, a1=math.pi / 2, cap_top=False, cap_bottom=False))
    # shoulders / chest
    chest = [(0.37, -0.8), (0.4, -0.65), (0.36, -0.52), (0.18, -0.46)]
    g.add(lathe(chest, seg=8, a0=-math.pi / 2, a1=math.pi / 2, smooth=True, cap_bottom=False))
    # hood, bowed forward under the load (a pointed cowl with a deep opening)
    hood = Geo()
    hood.add(lathe([(0.0, 0.0), (0.2, 0.02), (0.22, 0.16), (0.17, 0.3), (0.06, 0.42), (0.0, 0.46)], seg=8, smooth=True))
    g.add(hood, xf(ty=-0.6, tz=0.3, rx=0.45))
    # dark face opening: a recessed plate (AO darkens it)
    g.add(box(-0.1, -0.52, 0.47, 0.1, -0.36, 0.5), xf())
    # arms raised to the slab corners
    for sx in (-1, 1):
        pts = [(sx * 0.33, -0.7, 0.28), (sx * 0.42, -0.5, 0.36), (sx * 0.42, -0.3, 0.42), (sx * 0.36, -0.17, 0.5)]
        g.add(tube(pts, [0.09, 0.085, 0.075, 0.07], sides=6))
        # hands flat under the slab
        g.add(box(sx * 0.36 - 0.08, -0.19, 0.42, sx * 0.36 + 0.08, -0.15, 0.62))
    # a lantern hangs from its belt (the order's sign)
    g.add(box(-0.07, -1.18, 0.36, 0.07, -1.0, 0.5))
    g.add(cone(0.08, 0.1, seg=4, y0=-1.0), xf(tz=0.43))
    return g


def part_capital():
    g = Geo()
    # astragal ring (half round) round the 1.0 × 0.55 shaft
    g.add(loft_rect([(-1.3, -0.52, 0.52, 0.0, 0.57), (-1.25, -0.55, 0.55, 0.0, 0.6), (-1.2, -0.52, 0.52, 0.0, 0.57)]))
    # bell flaring to the abacus
    g.add(loft_rect([(-1.2, -0.5, 0.5, 0.0, 0.55), (-0.75, -0.53, 0.53, 0.0, 0.6), (-0.35, -0.64, 0.64, 0.0, 0.72), (-0.22, -0.68, 0.68, 0.0, 0.76)]))
    # abacus (chamfered slab)
    g.add(loft_rect([(-0.22, -0.72, 0.72, 0.0, 0.8), (-0.18, -0.76, 0.76, 0.0, 0.85), (-0.03, -0.76, 0.76, 0.0, 0.85), (0.0, -0.72, 0.72, 0.0, 0.8)]))
    # crockets: curled leaves at the front corners and centre
    for x, z0 in ((-0.5, 0.55), (0.5, 0.55), (0.0, 0.57)):
        pts = []
        for i in range(7):
            t = i / 6
            a = t * 1.9
            pts.append((x * (1 + 0.25 * t), -1.15 + 0.85 * t, z0 + 0.12 * math.sin(a) + 0.1 * t))
        pts += [(x * 1.25, -0.22, z0 + 0.32), (x * 1.22, -0.33, z0 + 0.38)]
        g.add(tube(pts, [0.07, 0.08, 0.08, 0.075, 0.07, 0.07, 0.08, 0.09, 0.05], sides=5))
    return g


def part_base():
    g = Geo()
    g.add(loft_rect([(0.0, -0.72, 0.72, 0.0, 0.82), (0.32, -0.72, 0.72, 0.0, 0.82), (0.36, -0.68, 0.68, 0.0, 0.78)]))
    # lower torus
    g.add(loft_rect([(0.36, -0.64, 0.64, 0.0, 0.72), (0.42, -0.66, 0.66, 0.0, 0.76), (0.5, -0.6, 0.6, 0.0, 0.67)]))
    # scotia
    g.add(loft_rect([(0.5, -0.56, 0.56, 0.0, 0.62), (0.57, -0.52, 0.52, 0.0, 0.57), (0.62, -0.56, 0.56, 0.0, 0.62)]))
    # upper torus
    g.add(loft_rect([(0.62, -0.58, 0.58, 0.0, 0.64), (0.67, -0.6, 0.6, 0.0, 0.66), (0.75, -0.5, 0.5, 0.0, 0.55)]))
    # spurs on the plinth corners
    for sx in (-1, 1):
        g.add(cone(0.12, 0.22, seg=4, y0=0.32), xf(tx=sx * 0.6, tz=0.7))
    return g


def part_boss():
    g = Geo()
    prof = [(0.0, -1.1), (0.06, -1.0), (0.1, -0.86), (0.2, -0.7), (0.24, -0.58), (0.18, -0.5), (0.3, -0.42), (0.5, -0.28), (0.56, -0.16), (0.52, -0.06), (0.56, 0.0)]
    g.add(lathe(prof, seg=8, smooth=False, cap_bottom=False))
    # eight radiating leaf ribs on the cap
    for i in range(8):
        a = TAU * i / 8
        pts = [(math.sin(a) * r, -0.12 - 0.12 * (1 - r / 0.55), math.cos(a) * r) for r in (0.08, 0.22, 0.38, 0.54)]
        g.add(tube(pts, [0.04, 0.05, 0.05, 0.03], sides=4))
    return g


def part_bracket():
    g = Geo()
    # wall plate and beam plate
    g.add(box(-0.2, -1.65, 0.0, 0.2, -1.15, 0.05))
    g.add(box(-0.2, -0.05, 1.15, 0.2, 0.0, 1.65))
    # diagonal I-section strut from the wall plate to the beam plate
    L = math.hypot(1.4, 1.4)
    strut = Geo()
    strut.add(box(-0.025, -L / 2, -0.09, 0.025, L / 2, 0.09))  # web
    strut.add(box(-0.1, -L / 2, -0.11, 0.1, L / 2, -0.08))  # flange
    strut.add(box(-0.1, -L / 2, 0.08, 0.1, L / 2, 0.11))  # flange
    g.add(strut, xf(rx=math.pi / 4, ty=-0.7, tz=0.7))
    # rivet heads
    for (x, y) in ((-0.13, -1.25), (0.13, -1.25), (-0.13, -1.55), (0.13, -1.55)):
        g.add(cone(0.035, 0.03, seg=4), xf(tx=x, ty=y, tz=0.05, rx=math.pi / 2))
    for (x, z) in ((-0.13, 1.25), (0.13, 1.25), (-0.13, 1.55), (0.13, 1.55)):
        g.add(cone(0.035, 0.03, seg=4, tip_up=False), xf(tx=x, ty=-0.05, tz=z))
    # curled tail under the knee
    pts = [(0.0, -1.15, 0.05), (0.0, -0.95, 0.3), (0.0, -0.9, 0.55), (0.0, -1.02, 0.66), (0.0, -1.12, 0.6)]
    g.add(tube(pts, [0.035, 0.035, 0.03, 0.025, 0.02], sides=4))
    return g


def wander_path(rng, length, step=0.42, sway=0.5, x0=0.0):
    """A path hanging down a wall (y decreasing), meandering in x, hugging z ≈ 0.15."""
    pts = []
    x = x0
    vx = 0.0
    y = 0.0
    while -y < length:
        pts.append([x, y, 0.15])
        vx += (rng.random() - 0.5) * sway * step
        vx *= 0.85
        x += vx
        y -= step
    return pts


def root_cluster(length, width, seed, strands=3):
    """A braided sinew cord growing out from under the stone and hanging down the
    wall: 2-4 twisted strands around a meandering core, lumps along it, fraying
    into tendrils that spread and cling at the bottom. Matte, dark (no gore)."""
    rng = random.Random(seed)
    g = Geo()
    # emergence: a flattened lumpy mass where it pushes out from under the stone
    lump = lathe([(0.0, -0.55), (0.2, -0.5), (0.36, -0.32), (0.4, -0.14), (0.3, -0.02), (0.0, 0.0)], seg=8, a0=-math.pi / 2, a1=math.pi / 2)
    g.add(lump, xf(s=(width / 0.75, 1.0, 0.7)))
    core = wander_path(rng, length, x0=0.0)
    n = len(core)
    fray_at = int(n * 0.72)
    for s in range(strands):
        ph = TAU * s / strands
        twist = 2.4 + 0.6 * rng.random()
        spread = (s / max(1, strands - 1) - 0.5) * 2 if strands > 1 else 0.0
        pts = []
        radii = []
        for i in range(n):
            t = i / max(1, n - 1)
            cx, cy, cz = core[i]
            a = ph + t * twist * TAU * (length / 8)
            rr = 0.1 * (1 - 0.5 * t)
            x = cx + math.cos(a) * rr
            z = 0.14 + math.sin(a) * rr * 0.6
            if i > fray_at:
                k = (i - fray_at) / max(1, n - 1 - fray_at)
                x += spread * width * 0.6 * k * k + math.sin(k * 5 + s) * 0.08
            pts.append((x, cy, max(0.06, z)))
            bulge = 1 + 0.6 * max(0.0, math.sin(t * 19 + seed * 0.7 + s * 2.1)) ** 8
            radii.append(max(0.014, 0.085 * (1 - 0.85 * t) * bulge))
        g.add(tube(pts, radii, sides=5))
        # tendrils spreading sideways and clinging to the wall
        for _k in range(2):
            i0 = int(n * (0.2 + 0.6 * rng.random()))
            if i0 >= n - 4:
                continue
            bx, by, bz = pts[i0]
            side = -1 if rng.random() < 0.5 else 1
            tl = [(bx, by, bz)]
            ang = 0.9 + 0.5 * rng.random()
            px, py = bx, by
            for j in range(1, 8):
                ang += (rng.random() - 0.35) * 0.3
                px += side * math.sin(ang) * 0.24
                py -= math.cos(ang) * 0.2
                tl.append((px, py, 0.05 + 0.03 * math.sin(j * 1.7)))
            tr = [max(0.008, radii[i0] * 0.55 * (1 - j / 8)) for j in range(8)]
            g.add(tube(tl, tr, sides=4))
    return g


def part_growth():
    """A sinew burl clinging to the wall, cords radiating from it along the stone."""
    g = Geo()
    rng = random.Random(5)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.55)
    for v in bm.verts:
        x, y, z = v.co
        k = 1 + 0.22 * math.sin(x * 7 + 1) * math.sin(y * 6) + 0.14 * math.sin(z * 9 + 2) + 0.1 * math.sin(x * 13 + y * 11)
        v.co = Vector((x * k * 1.3, y * k * 1.1, max(-0.02, z * k * 0.55)))
    for f in bm.faces:
        ids = [g.v(v.co.x, v.co.y, v.co.z) for v in f.verts]
        g.face(ids, True)
    bm.free()
    for i in range(9):
        a = TAU * i / 9 + rng.random() * 0.4
        pts = []
        r = 0.5
        for j in range(9):
            r += 0.16 + 0.05 * rng.random()
            a += (rng.random() - 0.5) * 0.35
            sag = -0.03 * j * j * (0.5 + 0.5 * math.sin(a) ** 2)
            pts.append((math.cos(a) * r * 1.2, math.sin(a) * r * 0.9 + sag, 0.06 + 0.025 * math.sin(j * 2.3)))
        g.add(tube(pts, [0.075 * (1 - j / 9) + 0.008 for j in range(9)], sides=5))
    return g


def part_far_colossus():
    g = Geo()
    # plinth
    g.add(loft_rect([(0.0, -0.2, 0.2, -0.18, 0.18), (0.05, -0.2, 0.2, -0.18, 0.18), (0.06, -0.17, 0.17, -0.15, 0.15)]))
    # robe flaring down, shoulders, bowed hood with a peak
    robe = [(0.16, 0.06), (0.15, 0.2), (0.12, 0.42), (0.11, 0.58), (0.13, 0.66), (0.12, 0.72), (0.07, 0.76)]
    g.add(lathe(robe, seg=8, smooth=False, cap_bottom=False, cap_top=False))
    hood = [(0.07, 0.72), (0.085, 0.78), (0.07, 0.86), (0.035, 0.92), (0.0, 0.96)]
    g.add(lathe(hood, seg=8, smooth=False, cap_bottom=False), xf(rx=0.25, tz=0.02))
    # arm raised forward with a lantern on a short chain
    arm = [(0.1, 0.66, 0.02), (0.13, 0.62, 0.12), (0.12, 0.66, 0.22), (0.12, 0.7, 0.28)]
    g.add(tube(arm, [0.035, 0.032, 0.028, 0.025], sides=5, smooth=False))
    g.add(box(0.105, 0.6, 0.27, 0.135, 0.7, 0.29))
    g.add(loft_rect([(0.52, 0.09, 0.15, 0.25, 0.31), (0.6, 0.085, 0.155, 0.245, 0.315)]))
    g.add(cone(0.045, 0.05, seg=4, y0=0.6), xf(tx=0.12, tz=0.28))
    g.add(cone(0.035, 0.04, seg=4, y0=0.52, tip_up=False), xf(tx=0.12, tz=0.28))
    # the other hand on a staff taller than the figure
    g.add(lathe([(0.012, 0.03), (0.012, 1.08)], seg=5, smooth=False), xf(tx=-0.16, tz=0.06))
    g.add(cone(0.03, 0.08, seg=4, y0=1.08), xf(tx=-0.16, tz=0.06))
    arm2 = [(-0.1, 0.66, 0.0), (-0.15, 0.6, 0.04), (-0.16, 0.56, 0.06)]
    g.add(tube(arm2, [0.035, 0.03, 0.026], sides=5, smooth=False))
    return g


def part_far_column():
    g = Geo()
    n = 12
    shaft = []
    for i in range(7):
        t = i / 6
        r = 0.07 * (1 - 0.12 * t) * (1 + 0.04 * math.sin(t * math.pi))
        shaft.append((r, 0.06 + t * 0.78))
    col = lathe(shaft, seg=n, smooth=False, cap_bottom=False, cap_top=False)
    g.add(col)
    # base and capital
    g.add(lathe([(0.11, 0.0), (0.11, 0.035), (0.09, 0.045), (0.08, 0.06)], seg=n, smooth=False, cap_top=False))
    g.add(lathe([(0.062, 0.84), (0.09, 0.88), (0.11, 0.9), (0.11, 0.93)], seg=n, smooth=False, cap_bottom=False))
    # broken top: a jagged stump above the capital (wall fragment)
    g.add(box(-0.1, 0.93, -0.08, 0.06, 0.99, 0.08))
    g.add(box(-0.08, 0.99, -0.06, 0.0, 1.0, 0.05))
    return g


def part_far_spire():
    g = Geo()
    # crown ring
    g.add(lathe([(0.18, -0.06), (0.2, -0.02), (0.2, 0.0)], seg=8, smooth=False, cap_bottom=False))
    # tiers tapering downward
    body = [(0.004, -1.0), (0.03, -0.86), (0.06, -0.7), (0.07, -0.69), (0.08, -0.55), (0.1, -0.54), (0.12, -0.38), (0.14, -0.37), (0.16, -0.2), (0.18, -0.06)]
    g.add(lathe(body, seg=8, smooth=False, cap_bottom=False, cap_top=False))
    # buttress fins
    for i in range(6):
        a = TAU * i / 6
        prof = [(0.0, -0.06), (0.0, -0.8), (0.06, -0.62), (0.15, -0.32), (0.24, -0.12), (0.24, -0.06)]
        g.add(extrude_x(prof, -0.012, 0.012), xf(ry=a))
    # pinnacles on the crown
    for i in range(8):
        a = TAU * (i + 0.5) / 8
        g.add(cone(0.025, 0.12, seg=4, y0=0.0), xf(tx=math.sin(a) * 0.18, tz=math.cos(a) * 0.18))
    return g


def part_far_arcade():
    g = Geo()
    # deck
    g.add(box(-0.5, -0.08, -0.05, 0.5, 0.0, 0.05))
    # three bays of pointed arches cut from a spandrel wall: piers + arch rings
    bay = 1.0 / 3
    for i in range(4):
        x = -0.5 + bay * i
        g.add(box(x - 0.03, -1.0, -0.04, x + 0.03, -0.08, 0.04))
    for i in range(3):
        cx = -0.5 + bay * (i + 0.5)
        pts = pointed_arch_pts(bay - 0.06, 0.2, n=6)
        prev = None
        for (x, y) in pts:
            p = (cx + x, -0.5 + y, 0.0)
            if prev:
                dx, dy = p[0] - prev[0], p[1] - prev[1]
                L = math.hypot(dx, dy)
                a = math.atan2(dy, dx)
                seg = box(-L / 2 - 0.004, -0.018, -0.04, L / 2 + 0.004, 0.018, 0.04)
                g.add(seg, xf(rz=a, tx=(p[0] + prev[0]) / 2, ty=(p[1] + prev[1]) / 2))
            prev = p
        # spandrel infill above the arch
        g.add(box(cx - bay / 2 + 0.03, -0.3, -0.03, cx - 0.06, -0.08, 0.03))
        g.add(box(cx + 0.06, -0.3, -0.03, cx + bay / 2 - 0.03, -0.08, 0.03))
    return g


def part_saint():
    """A hooded Lanternwright saint for a wall niche (unit height, bottom-back-centre):
    a corbel bracket, a tall robed figure bowed under a long pointed cowl with
    no face (a dark void under the brow), a dead lantern hanging from both
    hands, and a pointed niche hood over it. Scaled 5-16 m in-engine."""
    g = Geo()
    # bracket (corbel) it stands on: a tapered block growing out of the wall
    g.add(loft_rect([(0.0, -0.04, 0.04, 0.0, 0.04), (0.05, -0.1, 0.1, 0.0, 0.15), (0.085, -0.14, 0.14, 0.0, 0.2), (0.1, -0.14, 0.14, 0.0, 0.2)]))
    # robe: front half-lathe, hem pooling on the bracket, tall and narrow to the shoulders
    robe = [(0.0, 0.1), (0.12, 0.1), (0.127, 0.14), (0.112, 0.3), (0.097, 0.47), (0.09, 0.58), (0.1, 0.64), (0.085, 0.69), (0.045, 0.72)]
    g.add(lathe(robe, seg=10, a0=-math.pi / 2, a1=math.pi / 2, smooth=True, cap_bottom=False), xf(tz=0.015))
    # deep vertical folds down the robe front
    for x, z, h0, h1, r in ((-0.06, 0.105, 0.11, 0.5, 0.016), (0.0, 0.125, 0.11, 0.4, 0.018), (0.06, 0.105, 0.11, 0.52, 0.016), (-0.1, 0.045, 0.11, 0.58, 0.014), (0.1, 0.045, 0.11, 0.58, 0.014)):
        pts = [(x * (1 + 0.18 * (1 - t / 4)), h0 + (h1 - h0) * t / 4, z + 0.008 * math.sin(t)) for t in range(5)]
        g.add(tube(pts, [r, r * 1.1, r, r * 0.8, r * 0.5], sides=4, smooth=True))
    # cowl: a long pointed hood bowed forward, seated on the shoulders
    hood = lathe([(0.0, -0.02), (0.085, 0.0), (0.095, 0.08), (0.085, 0.16), (0.055, 0.24), (0.02, 0.31), (0.0, 0.34)], seg=8, smooth=True)
    g.add(hood, xf(ty=0.63, tz=0.04, rx=0.5))
    # no face: a dark plate set back under a heavy brow
    g.add(box(-0.05, -0.05, -0.012, 0.05, 0.05, 0.012), xf(ty=0.7, tz=0.13, rx=0.5))
    g.add(box(-0.075, -0.018, -0.05, 0.075, 0.018, 0.05), xf(ty=0.775, tz=0.17, rx=0.9))
    # arms folded forward, both hands round the lantern's ring; long sleeves
    for sx in (-1, 1):
        pts = [(sx * 0.1, 0.62, 0.04), (sx * 0.11, 0.53, 0.1), (sx * 0.07, 0.47, 0.165), (sx * 0.03, 0.47, 0.19)]
        g.add(tube(pts, [0.03, 0.029, 0.027, 0.024], sides=5))
        g.add(tube([(sx * 0.07, 0.49, 0.15), (sx * 0.075, 0.42, 0.14), (sx * 0.07, 0.37, 0.13)], [0.03, 0.026, 0.012], sides=4))
    # the lantern: a caged lamp hanging below the hands (dead: the order's lamps are out)
    g.add(box(-0.03, 0.35, 0.165, 0.03, 0.42, 0.225))
    g.add(cone(0.042, 0.045, seg=4, y0=0.42), xf(tz=0.195, ry=math.pi / 4))
    g.add(cone(0.035, 0.03, seg=4, y0=0.35, tip_up=False), xf(tz=0.195, ry=math.pi / 4))
    # niche: two slender shafts, a pointed hood moulding, a little gabled roof and a pinnacle
    for sx in (-1, 1):
        g.add(box(sx * 0.17 - 0.014, 0.1, 0.0, sx * 0.17 + 0.014, 0.82, 0.035))
        g.add(box(sx * 0.17 - 0.024, 0.8, 0.0, sx * 0.17 + 0.024, 0.83, 0.05))
    pts = pointed_arch_pts(0.36, 0.2, n=4)
    prev = None
    for (x, y) in pts:
        p = (x, 0.82 + y, 0.0)
        if prev:
            dx, dy = p[0] - prev[0], p[1] - prev[1]
            L = math.hypot(dx, dy)
            a = math.atan2(dy, dx)
            g.add(box(-L / 2 - 0.006, -0.016, 0.0, L / 2 + 0.006, 0.016, 0.06), xf(rz=a, tx=(p[0] + prev[0]) / 2, ty=(p[1] + prev[1]) / 2))
        prev = p
    for sx in (-1, 1):
        L = math.hypot(0.2, 0.2)
        g.add(box(-L / 2, -0.01, 0.0, L / 2, 0.01, 0.12), xf(rz=-sx * math.pi / 4, tx=sx * 0.1, ty=1.08))
    g.add(cone(0.03, 0.12, seg=4, y0=1.16), xf(tz=0.04, ry=math.pi / 4))
    return g


def part_gear():
    """A colossal iron cog half-sunk in the masonry (wall-mounted, unit radius:
    teeth to r = 1, rim r 0.72-0.86, six tapering spokes, a riveted hub; back on
    the wall at z = 0, rim face at z = 0.16, hub to z = 0.3). Scaled 2.5-7 m."""
    g = Geo()
    teeth = 22
    outer = []
    for i in range(teeth):
        a0 = TAU * i / teeth
        da = TAU / teeth
        for f, r in ((0.0, 0.86), (0.18, 0.86), (0.3, 1.0), (0.62, 1.0), (0.74, 0.86)):
            a = a0 + da * f
            outer.append((math.sin(a) * r, math.cos(a) * r))
    n = len(outer)
    inner = []
    for i in range(n):
        a = math.atan2(outer[i][0], outer[i][1])
        inner.append((math.sin(a) * 0.72, math.cos(a) * 0.72))
    z0, z1 = 0.0, 0.16
    of = [g.v(x, y, z1) for x, y in outer]
    ob = [g.v(x, y, z0) for x, y in outer]
    inf = [g.v(x, y, z1) for x, y in inner]
    inb = [g.v(x, y, z0) for x, y in inner]
    for i in range(n):
        j = (i + 1) % n
        g.face([inf[i], inf[j], of[j], of[i]])  # front annulus (faces +z)
        g.face([of[i], of[j], ob[j], ob[i]])  # outer rim + tooth flanks
        g.face([inb[i], inb[j], inf[j], inf[i]])  # inner rim
    # spokes (tapering, a raised rib down each) and the hub
    for k in range(6):
        a = TAU * k / 6 + 0.26
        L = 0.6
        g.add(loft_rect([(0.14, -0.06, 0.06, 0.01, 0.12), (0.14 + L, -0.035, 0.035, 0.01, 0.12)]), xf(rz=-a))
        g.add(box(-0.016, 0.14, 0.12, 0.016, 0.14 + L, 0.15), xf(rz=-a))
    g.add(lathe([(0.2, 0.0), (0.2, 0.18), (0.16, 0.24), (0.1, 0.27), (0.1, 0.3), (0.0, 0.3)], seg=10, smooth=False, cap_bottom=False), xf(rx=math.pi / 2))
    for k in range(8):
        a = TAU * k / 8
        g.add(cone(0.025, 0.03, seg=4, y0=0.0), xf(rx=math.pi / 2, tx=math.sin(a) * 0.79, ty=math.cos(a) * 0.79, tz=0.16))
    return g


# -----------------------------------------------------------------------------
# VR hero pieces (WP-GFX-VR-POLISH): a few high-detail props the eye can linger on from a ledge at 1:1 scale.
# Geometry carries the detail (the shared baked masonry / metal sets are projected onto them in metres, vertex AO as for
# every kit part). Placed by LevelView._icon / the corbel table in the "bays" away from the route, a handful per section.
# -----------------------------------------------------------------------------
def prism(poly, z0, z1, smooth=False):
    """Extrudes a 2D polygon [(x, y)] (counter-clockwise seen from +z) from z0 to z1."""
    g = Geo()
    n = len(poly)
    a = [g.v(x, y, z0) for x, y in poly]
    b = [g.v(x, y, z1) for x, y in poly]
    for i in range(n):
        j = (i + 1) % n
        g.face([a[i], a[j], b[j], b[i]], smooth)
    g.face(list(reversed(a)))
    g.face(b)
    return g


def gear_disc(r_tip, teeth, z0, z1, root=0.86, rim=0.72, spokes=0, hub=0.0, phase=0.0):
    """A cog in the XY plane (tooth centre at angle `phase` from +y, clockwise), chamfered teeth, optional spokes and hub."""
    g = Geo()
    pitch = TAU / teeth
    outer = []
    for i in range(teeth):
        a0 = phase + pitch * i
        # (fraction of the pitch, radius): root, flank up, tip, tip, flank down  — tooth centred on a0
        for f, r in ((-0.5, root), (-0.33, root), (-0.18, 1.0), (0.18, 1.0), (0.33, root)):
            a = a0 + pitch * f
            outer.append((math.sin(a) * r * r_tip, math.cos(a) * r * r_tip))
    n = len(outer)
    inner = []
    for i in range(n):
        a = math.atan2(outer[i][0], outer[i][1])
        inner.append((math.sin(a) * rim * r_tip, math.cos(a) * rim * r_tip))
    of = [g.v(x, y, z1) for x, y in outer]
    ob = [g.v(x, y, z0) for x, y in outer]
    inf = [g.v(x, y, z1) for x, y in inner]
    inb = [g.v(x, y, z0) for x, y in inner]
    for i in range(n):
        j = (i + 1) % n
        g.face([inf[i], inf[j], of[j], of[i]])
        g.face([of[i], of[j], ob[j], ob[i]])
        g.face([inb[i], inb[j], inf[j], inf[i]])
    zm = (z0 + z1) / 2
    if spokes:
        for k in range(spokes):
            a = TAU * k / spokes + phase + pitch * 0.5
            L = rim * r_tip - hub * 0.6
            w0, w1 = 0.07 * r_tip, 0.04 * r_tip
            g.add(loft_rect([(hub * 0.5, -w0, w0, zm - 0.03, zm + 0.03), (hub * 0.5 + L, -w1, w1, zm - 0.03, zm + 0.03)]), xf(rz=-a))
            g.add(box(-0.012 * r_tip, hub * 0.5, zm + 0.03, 0.012 * r_tip, hub * 0.5 + L, zm + 0.05), xf(rz=-a))
    else:
        # a dished web closes the disc (small cogs)
        g.add(lathe([(0.0, zm - 0.02), (rim * r_tip, zm - 0.02), (rim * r_tip, zm + 0.02), (0.0, zm + 0.03)], seg=16, smooth=False, cap_bottom=False), xf(rx=math.pi / 2))
    if hub > 0:
        g.add(lathe([(hub, z0 - 0.02), (hub, z1 + 0.02), (hub * 0.8, z1 + 0.07), (hub * 0.4, z1 + 0.09), (0.0, z1 + 0.09)], seg=10, smooth=False, cap_bottom=False), xf(rx=math.pi / 2))
    return g


def chain_links(path, link_len=0.115, link_w=0.07, wire=0.015, sides=4):
    """Chain links along a polyline [(x, y, z)]: alternate links turned 90 degrees about the path."""
    g = Geo()
    pts = [Vector(p) for p in path]
    # resample at link_len * 0.78 (links overlap)
    step = link_len * 0.78
    samples = []
    acc = 0.0
    samples.append((pts[0], (pts[1] - pts[0]).normalized()))
    for i in range(1, len(pts)):
        seg = pts[i] - pts[i - 1]
        L = seg.length
        d = seg.normalized()
        while acc + step <= L:
            acc += step
            samples.append((pts[i - 1] + d * acc, d))
        acc -= L
    for k, (p, d) in enumerate(samples):
        side = Vector((0, 0, 1)) if k % 2 == 0 else d.cross(Vector((0, 0, 1))).normalized()
        if d.cross(side).length < 1e-6:
            side = Vector((1, 0, 0))
        w = link_w / 2
        h = link_len / 2 - wire
        # stadium loop in the (d, side) plane
        loop = []
        for t in range(6):
            a = math.pi * t / 5
            loop.append(p + d * (h + w * math.sin(a) * 0.9) + side * (w * math.cos(a)))
        for t in range(6):
            a = math.pi * t / 5
            loop.append(p - d * (h + w * math.sin(a) * 0.9) - side * (w * math.cos(a)))
        # tube() takes an open path: close the loop by repeating the first point
        loop.append(loop[0])
        g.add(tube([tuple(q) for q in loop], [wire] * len(loop), sides=sides, smooth=True, cap=False))
    return g


def part_geartrain():
    """A machine-room gear train sunk in the wall (unit = the big cog radius 1; back on the wall at z = 0): three meshing iron cogs
    (22 / 12 / 7 teeth, phased to mesh) on riveted bearing blocks with a strapped housing, axles through the hubs, and a chain
    hauled over the big cog and hanging free. Rim faces at z 0.08-0.24, housing to z 0.44. Scaled 2-6 m in-engine."""
    g = Geo()
    # cog centres (x, y) and radii; line of centres 1->2 at 24 deg above horizontal, 2->3 at 78 deg
    c1 = (0.0, 0.0)
    r1, n1 = 1.0, 22
    a12 = math.radians(24)
    r2, n2 = 0.56, 12
    d12 = (0.93 + 0.52)  # pitch radii sum (pitch ~ 0.93 of the tip radius)
    c2 = (c1[0] + math.cos(a12) * d12, c1[1] + math.sin(a12) * d12)
    a23 = math.radians(72)
    r3, n3 = 0.34, 7
    d23 = 0.52 + 0.31
    c3 = (c2[0] + math.cos(a23) * d23, c2[1] + math.sin(a23) * d23)
    z0, z1 = 0.08, 0.24
    # phases: tooth of cog 1 on the line of centres (angle measured from +y clockwise: line direction a12 from +x = pi/2 - a12)
    ang12 = math.pi / 2 - a12
    ph1 = ang12
    ph2 = ang12 + math.pi - math.pi / n2
    ang23 = math.pi / 2 - a23
    # cog 2 tooth positions: ph2 + k*2pi/n2. cog 3 gap on the line 2->3: choose a tooth of 2 at ang23 -> adjust by lattice
    k = round((ang23 - ph2) / (TAU / n2))
    ph2b = ph2 + (ang23 - (ph2 + k * TAU / n2))  # nudge so a tooth of cog 2 points at cog 3 ...
    ph2 = ph2b
    ph3 = ang23 + math.pi - math.pi / n3
    g.add(gear_disc(r1, n1, z0, z1, spokes=6, hub=0.22, phase=ph1), xf(tx=c1[0], ty=c1[1]))
    g.add(gear_disc(r2, n2, z0, z1, spokes=4, hub=0.13, phase=ph2), xf(tx=c2[0], ty=c2[1]))
    g.add(gear_disc(r3, n3, z0, z1, spokes=0, hub=0.09, phase=ph3), xf(tx=c3[0], ty=c3[1]))
    # backing plate: a rounded iron plate behind the three cogs with a rivet line
    def blob(cx, cy, rr, n=14):
        return [(cx + rr * math.cos(TAU * i / n), cy + rr * math.sin(TAU * i / n)) for i in range(n)]
    # strap housing: a pad round each bearing, joined by flat straps over the front of the hubs
    for (cx, cy), rr, hubr in ((c1, 0.34, 0.22), (c2, 0.24, 0.13), (c3, 0.17, 0.09)):
        g.add(prism(blob(cx, cy, rr, 12), 0.30, 0.40), xf())
        g.add(lathe([(0.0, 0.40), (hubr * 0.7, 0.40), (hubr * 0.7, 0.44), (0.0, 0.46)], seg=8, smooth=False, cap_bottom=False), xf(rx=math.pi / 2, tx=cx, ty=cy))
        # axle through the hub, to the wall, with a keeper nut
        g.add(lathe([(0.045, 0.0), (0.045, 0.32), (0.07, 0.32), (0.07, 0.36)], seg=8, smooth=False, cap_bottom=False), xf(rx=math.pi / 2, tx=cx, ty=cy))
        for k in range(4):
            a = TAU * k / 4 + 0.4
            g.add(cone(0.026, 0.03, seg=6, y0=0.0), xf(rx=math.pi / 2, tx=cx + math.cos(a) * rr * 0.72, ty=cy + math.sin(a) * rr * 0.72, tz=0.40))
    for (pa, pb, wdt) in ((c1, c2, 0.1), (c2, c3, 0.07)):
        dx, dy = pb[0] - pa[0], pb[1] - pa[1]
        L = math.hypot(dx, dy)
        ang = math.atan2(dy, dx)
        g.add(box(0.0, -wdt / 2, 0.34, L, wdt / 2, 0.38), xf(rz=ang, tx=pa[0], ty=pa[1]))
    # a rack bar bolted to the wall under the big cog (what the chain pawl engages)
    g.add(box(-1.25, -1.28, 0.0, 1.0, -1.18, 0.12))
    for i in range(7):
        g.add(cone(0.03, 0.035, seg=6, y0=0.0), xf(rx=math.pi / 2, tx=-1.1 + i * 0.33, ty=-1.23, tz=0.12))
    # the chain: over the top of the big cog, down its right side and free
    path = []
    for i in range(0, 16):
        a = math.radians(150) - math.radians(100) * i / 15
        rr = 1.03
        path.append((math.cos(a) * rr, math.sin(a) * rr, 0.16))
    for i in range(1, 11):
        path.append((path[-1][0] + 0.02 * math.sin(i), path[-1][1] - 0.115, 0.16))
    g.add(chain_links(path))
    return g


def part_corbel_hero():
    """A carved corbel / buttress head (wall-mounted, hangs from y = 0; 1.0 w x 1.9 h x 1.1 d): three stepped tiers with a dentil
    course, an ogee, a pair of side volutes, an acanthus-like leaf cluster down the front and a dead lantern hung from a short chain
    at the nose — the order's emblem. Hero version of ch1_env_corbel for the bays you can reach."""
    g = Geo()
    W = 0.5
    # side profile: back top -> down the wall -> stepped, ogee front -> nose
    prof = [(0.0, 0.0), (0.0, -1.9), (0.1, -1.9), (0.16, -1.8)]
    for i in range(1, 11):
        t = i / 10
        z = 0.16 + 0.5 * t
        y = -1.8 + 0.95 * t + 0.1 * math.sin(t * math.pi)
        prof.append((z, y))
    prof += [(0.7, -0.84), (0.82, -0.78), (0.84, -0.64), (0.78, -0.6), (0.9, -0.56), (0.9, -0.4), (1.02, -0.36), (1.02, -0.14), (1.1, -0.1), (1.1, 0.0)]
    g.add(extrude_x(prof, -W, W))
    # dentil course under the top slab
    for i in range(9):
        x = -0.42 + i * 0.105
        g.add(box(x - 0.03, -0.31, 0.92, x + 0.03, -0.22, 1.0))
    # side volutes: a scroll on each cheek
    for sx in (-1, 1):
        pts = []
        for i in range(15):
            t = i / 14
            a = 1.2 + t * 4.4
            rr = 0.27 * (1 - 0.62 * t)
            pts.append((sx * (W + 0.03), -0.72 + math.cos(a) * rr * 0.9, 0.58 + math.sin(a) * rr))
        g.add(tube(pts, [0.045 - 0.02 * i / 14 for i in range(15)], sides=5))
        g.add(lathe([(0.0, 0.0), (0.075, 0.0), (0.075, 0.035), (0.0, 0.05)], seg=8, smooth=False), xf(rz=-sx * math.pi / 2, tx=sx * (W + 0.03), ty=-0.72, tz=0.6))
    # acanthus: leaf pairs curling over the ogee
    for k in range(4):
        t = k / 3
        y = -1.55 + 0.7 * t
        z = 0.2 + 0.45 * t
        for sx in (-1, 1):
            pts = [(sx * 0.03, y, z + 0.02), (sx * 0.13, y + 0.02, z + 0.07), (sx * 0.22, y + 0.07, z + 0.1), (sx * 0.26, y + 0.15, z + 0.08), (sx * 0.22, y + 0.2, z + 0.03)]
            g.add(tube(pts, [0.05, 0.055, 0.05, 0.04, 0.025], sides=5))
    # median rib
    rib = [(0.0, -1.7 + 0.1 * i, 0.24 + 0.05 * i) for i in range(8)]
    g.add(tube(rib, [0.04] * 8, sides=5))
    # the dead lantern: chain, cage, cap (hangs from the nose)
    g.add(chain_links([(0.0, -0.1, 1.06), (0.0, -0.5, 1.06)], link_len=0.1, link_w=0.055, wire=0.012))
    g.add(cone(0.075, 0.1, seg=6, y0=-0.5, tip_up=True), xf(tz=1.06))
    g.add(lathe([(0.07, -0.7), (0.085, -0.62), (0.085, -0.55), (0.075, -0.5)], seg=6, smooth=False, cap_top=False, cap_bottom=True), xf(tz=1.06))
    for k in range(6):
        a = TAU * k / 6
        g.add(box(-0.007, -0.7, -0.007, 0.007, -0.5, 0.007), xf(tx=math.sin(a) * 0.08, tz=1.06 + math.cos(a) * 0.08))
    g.add(cone(0.085, 0.09, seg=6, y0=-0.7, tip_up=False), xf(tz=1.06))
    return g


def part_arch_fragment():
    """A crumbling pointed arch relief (wall-mounted, bottom y = 0, 1.0 w x 1.15 h x 0.38 d): a rib of wedge voussoirs with missing
    stones and a broken, stair-stepped end, a dropped keystone with a lamp relief, one intact springer pier with a capital,
    a stump on the other side, and fallen stones caught on a small shelf. Scale 3-10 m."""
    g = Geo()
    w, rise = 0.78, 0.7
    base_y = 0.3
    pts = pointed_arch_pts(w, rise, n=8)  # intrados from (-w/2, 0) over the apex
    thick = 0.15
    # outward normals (rotate the tangent)
    outer = []
    for i, (x, y) in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1.0
        nx, ny = ty / L, -tx / L  # to the left of the travel direction is inside; right is outside (travel is left -> right over the top)
        outer.append((x + nx * thick, y + ny * thick))
    rng = random.Random(77)
    n = len(pts) - 1
    missing = {1, 2, 3}  # left haunch collapsed
    for i in range(n):
        if i in missing:
            continue
        a0, a1 = pts[i], pts[i + 1]
        b1, b0 = outer[i + 1], outer[i]
        # small gaps between stones
        def sh(p, q, f):
            return (p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)
        poly = [sh(a0, a1, 0.025), sh(a1, a0, 0.025), sh(b1, b0, 0.025), sh(b0, b1, 0.025)]
        depth = 0.30 + rng.uniform(-0.03, 0.05)
        piece = prism([(x, y + base_y) for x, y in poly], 0.0, depth)
        g.add(piece)
    # keystone: a larger, dropped wedge with a lamp relief
    ak = pts[n // 2]
    ok = outer[n // 2]
    kx = [(ak[0] - 0.06, ak[1] + base_y - 0.02), (ak[0] + 0.06, ak[1] + base_y - 0.02), (ok[0] + 0.075, ok[1] + base_y + 0.03), (ok[0] - 0.075, ok[1] + base_y + 0.03)]
    g.add(prism(kx, 0.0, 0.36), xf(ty=-0.035))
    g.add(lathe([(0.0, 0.0), (0.04, 0.0), (0.05, 0.03), (0.0, 0.05)], seg=8, smooth=False), xf(rx=math.pi / 2, tx=(ak[0] + ok[0]) / 2, ty=(ak[1] + ok[1]) / 2 + base_y - 0.035, tz=0.36))
    # right springer pier (intact) with a capital; left stump, jagged
    px = w / 2 + 0.02
    g.add(box(px, 0.0, 0.0, px + thick + 0.04, base_y + 0.03, 0.32))
    g.add(loft_rect([(base_y + 0.03, px - 0.02, px + thick + 0.06, 0.0, 0.34), (base_y + 0.08, px - 0.045, px + thick + 0.085, 0.0, 0.37)]))
    lx = -w / 2 - thick - 0.04
    stump = [(lx, 0.0), (lx + thick + 0.06, 0.0), (lx + thick + 0.06, 0.2), (lx + thick * 0.55, 0.26), (lx + thick * 0.4, 0.2), (lx, 0.33)]
    g.add(prism(stump, 0.0, 0.32))
    # shelf under the arch with fallen stones
    g.add(box(-0.5, 0.0, 0.0, 0.5, 0.06, 0.42))
    for (x, z, rot, s) in ((-0.2, 0.2, 0.4, 1.0), (0.05, 0.27, -0.3, 0.85), (-0.35, 0.3, 0.9, 0.7), (0.28, 0.17, 0.2, 0.9)):
        blk = prism([(-0.07 * s, -0.04 * s), (0.065 * s, -0.045 * s), (0.075 * s, 0.05 * s), (-0.06 * s, 0.045 * s)], 0.0, 0.1 * s)
        g.add(blk, xf(rx=-math.pi / 2, rz=rot, tx=x, ty=0.06 + 0.1 * s, tz=z + 0.05))
    return g


# (name, material, builder, options) — options.tris: decimation target (Quest budget:
# these parts are instanced by the hundred along the descent, so every one is lean)
PARTS = [
    ("ch1_env_corbel", "stone", part_corbel, {"wall": True, "ceiling": True, "tris": 100}),
    ("ch1_env_corbel_figure", "stone", part_corbel_figure, {"wall": True, "ceiling": True, "tris": 220}),
    ("ch1_env_capital", "stone", part_capital, {"wall": True, "ceiling": True, "tris": 120}),
    ("ch1_env_base", "stone", part_base, {"wall": True, "floor": True}),
    ("ch1_env_boss", "stone", part_boss, {"ceiling": True, "tris": 120}),
    ("ch1_env_bracket", "metal", part_bracket, {"wall": True, "ceiling": True}),
    ("ch1_env_root_a", "flesh", lambda: root_cluster(5.0, 1.0, 3, 2), {"wall": True, "tris": 140}),
    ("ch1_env_root_b", "flesh", lambda: root_cluster(7.5, 1.4, 17, 3), {"wall": True, "tris": 210}),
    ("ch1_env_root_c", "flesh", lambda: root_cluster(10.0, 1.8, 29, 3), {"wall": True, "tris": 290}),
    ("ch1_env_growth", "flesh", part_growth, {"wall": True, "tris": 190}),
    ("ch1_env_saint", "stone", part_saint, {"wall": True, "floor": True, "tris": 400}),
    ("ch1_env_gear", "metal", part_gear, {"wall": True, "tris": 400}),
    ("ch1_env_geartrain", "metal", part_geartrain, {"wall": True, "tris": 2100}),
    ("ch1_env_corbel_hero", "stone", part_corbel_hero, {"wall": True, "ceiling": True, "tris": 900}),
    ("ch1_env_arch_fragment", "stone", part_arch_fragment, {"wall": True, "floor": True, "tris": 700}),
    ("ch1_env_far_colossus", "stone", part_far_colossus, {"floor": True, "noao": True, "tris": 200}),
    ("ch1_env_far_column", "stone", part_far_column, {"floor": True, "noao": True, "tris": 140}),
    ("ch1_env_far_spire", "stone", part_far_spire, {"noao": True, "tris": 200}),
    ("ch1_env_far_arcade", "stone", part_far_arcade, {"noao": True, "tris": 240}),
]
# WP-ART-PASS: authored wall panels, buttresses, column clusters, stair fragments, pipe runs, lanterns (env_kit2_parts.py)
import env_kit2_parts  # noqa: E402

PARTS += env_kit2_parts.parts(globals())

# the statues (saint, atlas figure, hero corbel) are rebuilt with real anatomy (env_statues.py)
import env_statues  # noqa: E402

PARTS = env_statues.replace(PARTS, globals())


# -----------------------------------------------------------------------------
# Blender objects, AO bake into COLOR_0, export
# -----------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def principled(name, base, metallic=0.0, roughness=0.85):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    # show the baked AO in Blender previews too
    nodes = mat.node_tree.nodes
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Color"
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[6].default_value = (*base, 1.0)
    mat.node_tree.links.new(attr.outputs["Color"], mix.inputs[7])
    mat.node_tree.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mat


def make_object(name, geo, mat):
    me = bpy.data.meshes.new(name)
    verts = [to_blender(p) for p in geo.verts]
    faces = [f for f, _ in geo.faces]
    me.from_pydata(verts, [], faces)
    me.validate(clean_customdata=False)
    for poly, (_, sm) in zip(me.polygons, geo.faces):
        poly.use_smooth = sm
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    if getattr(geo, "norecalc", False):  # authored winding, vertex order matters (per-vertex tone): no weld / no recalc
        return ob
    # merge coincident verts per part (keeps flat/smooth split via sharp edges from face flags)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return ob


def hemisphere_dirs(n, seed=3):
    rng = random.Random(seed)
    out = []
    for i in range(n):
        u = (i + rng.random()) / n
        v = rng.random()
        r = math.sqrt(u)
        a = TAU * v
        out.append((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u))))
    return out


def drop_object(ob):
    me = ob.data
    bpy.data.objects.remove(ob)
    if me.users == 0:
        bpy.data.meshes.remove(me)


def decimated_level(src, name, target, keep=0.9, cap=0):
    """A copy of `src` decimated to about `target` triangles whose bounds stay within `keep` of the source's on every axis longer than 0.5 m
    (the collapse can eat a tall thin part: a 4 m buttress came out 2.4 m tall at 78 triangles); the target grows until it keeps them.
    cap > 0: None when that takes more than `cap` triangles (the level would not be much cheaper than the next one up)."""
    t = target
    for _ in range(6):
        c = clone_object(src, name)
        decimate(c, t)
        tris = sum(len(p.vertices) - 2 for p in c.data.polygons)
        if cap and tris > cap:
            drop_object(c)
            return None
        if all(c.dimensions[a] >= keep * src.dimensions[a] for a in range(3) if src.dimensions[a] > 0.5):
            return c
        drop_object(c)
        t = int(t * 1.25) + 4
    c = clone_object(src, name)
    decimate(c, t)
    return c


def decimate(ob, target):
    """Collapse-decimates a part to about `target` triangles (keeps its silhouette). One collapse pass can stop well above the
    ratio on beveled / weathered parts (many tiny faces that pair up), so it repeats until within 8 % of the target."""
    for _ in range(4):
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if tris <= target * 1.08:
            return
        mod = ob.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.02, target / tris)
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        for o in bpy.context.view_layer.objects:
            o.select_set(o is ob)
        bpy.ops.object.modifier_apply(modifier=mod.name)


def bake_ao(ob, opts, rays):
    """Per-vertex AO from cosine-weighted hemisphere rays against the part itself
    plus the plane(s) it is mounted on (wall z = 0 in three space = Blender y = 0;
    a ceiling at three y = 0 = Blender z = 0; a floor likewise)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm)
    dirs = hemisphere_dirs(rays)
    span = max(ob.dimensions) if ob.dimensions else 1.0
    maxd = min(1.2, max(0.25, span * 0.6))
    ao = []
    for v in bm.verts:
        nrm = v.normal.normalized() if v.normal.length > 1e-6 else Vector((0, 0, 1))
        t1 = nrm.orthogonal().normalized()
        t2 = nrm.cross(t1)
        origin = v.co + nrm * 0.004
        hit = 0.0
        for dx, dy, dz in dirs:
            d = (t1 * dx + t2 * dy + nrm * dz).normalized()
            occ = False
            loc, _n, _i, dist = bvh.ray_cast(origin, d, maxd)
            if loc is not None:
                occ = True
            # mounting planes (three space): wall z=0 → Blender y=0 (part lives at y ≤ 0)
            if not occ and opts.get("wall") and d.y > 1e-6:
                t = -origin.y / d.y
                if 0 < t < maxd:
                    occ = True
            if not occ and opts.get("ceiling") and d.z > 1e-6:
                t = -origin.z / d.z
                if 0 < t < maxd:
                    occ = True
            if not occ and opts.get("floor") and d.z < -1e-6:
                t = -origin.z / d.z
                if 0 < t < maxd:
                    occ = True
            if occ:
                hit += 1
        a = 1.0 - 0.9 * (hit / len(dirs))
        ao.append(max(0.08, min(1.0, a)) ** 1.2)
    bm.free()
    attr = me.color_attributes.new(name="Color", type="BYTE_COLOR", domain="POINT")
    for i, a in enumerate(ao):
        attr.data[i].color = (a, a, a, 1.0)
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = 0
        me.color_attributes.active_color_index = 0
    except Exception:
        pass


def export_glb(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_image_format="NONE",
    )


def preview(objects, path):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    # lay the parts out in a row on a ground plane
    x = 0.0
    for ob in objects:
        w = max(ob.dimensions.x, 0.5)
        if "far_" in ob.name:
            ob.scale = (4, 4, 4)
            w = 4 * max(ob.dimensions.x / 4, 0.3) + 0.6
        ob.location = (x + w / 2, 0, 2.5 if ob.name.endswith(("corbel", "figure", "capital", "boss", "bracket")) or "root" in ob.name else 0.0)
        x += w + 0.6
    bpy.ops.mesh.primitive_plane_add(size=200, location=(x / 2, 0, -0.01))
    bpy.ops.mesh.primitive_plane_add(size=200, location=(x / 2, 0.02, 0), rotation=(math.pi / 2, 0, 0))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.location = (x / 2, -x * 0.75, 4.0)
    cam.rotation_euler = (math.radians(84), 0, 0)
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(20), math.radians(-30))
    scene.collection.objects.link(sun)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# -----------------------------------------------------------------------------
# Detail pass: the original kit was authored lean (80-500 tris a part, "instanced by the hundred"), which reads as
# flat low-poly up close. Every near part is now bevelled (edges catch the lantern), subdivided and weathered
# (chips, pitting, lumps: displacement along the normal) BEFORE the decimator runs, so the collapse keeps real carved
# detail in the silhouette instead of the few big planes the primitives start with. The far silhouettes (scaled to
# 60-220 m) are left alone. DETAIL_TRIS / DETAIL_TRIS_HI are the decimation targets per tier (see below).
# -----------------------------------------------------------------------------
# Quest / low tier (the default build, ch1_env_kit.glb): the parts that are instanced by the hundred near the player (corbels,
# capitals, buttresses) grow ~20 %, the hero pieces up to ~40 %: that is what the Quest budget (350k stereo triangles, S6 is the
# tightest) leaves, since nearly all of the triangles are within 10 m of the head. The weathering / bevel pass still improves
# the shapes at the same count.
DETAIL_TRIS = {
    "ch1_env_corbel": 140,
    "ch1_env_corbel_figure": 900,
    "ch1_env_capital": 170,
    "ch1_env_base": 140,
    "ch1_env_boss": 170,
    "ch1_env_bracket": 200,
    "ch1_env_root_a": 180,
    "ch1_env_root_b": 270,
    "ch1_env_root_c": 370,
    "ch1_env_growth": 250,
    "ch1_env_saint": 1500,
    "ch1_env_gear": 480,
    "ch1_env_geartrain": 2150,
    "ch1_env_corbel_hero": 1500,
    "ch1_env_arch_fragment": 420,
    "ch1_env_wall_a": 200,
    "ch1_env_wall_b": 400,
    "ch1_env_wall_c": 270,
    "ch1_env_buttress_lo": 120,
    "ch1_env_buttress_cap": 90,
    "ch1_env_column_cluster": 640,
    "ch1_env_stair_fragment": 260,
    "ch1_env_pipe_run": 490,
    "ch1_env_lantern": 240,
}
# LOD0 (ch1_env_<part>_lod0): the rich level, about 2x the original counts, drawn only close to the player (LevelView swaps the level per
# instance by distance, see render/levelView.js LodChunk). LOD2 (ch1_env_<part>_lod2) is the medium level decimated to LOD2_RATIO of its triangles.
DETAIL_TRIS_HI = {
    "ch1_env_corbel": 340,
    "ch1_env_corbel_figure": 2200,
    "ch1_env_capital": 420,
    "ch1_env_base": 340,
    "ch1_env_boss": 390,
    "ch1_env_bracket": 450,
    "ch1_env_root_a": 390,
    "ch1_env_root_b": 590,
    "ch1_env_root_c": 780,
    "ch1_env_growth": 530,
    "ch1_env_saint": 3600,
    "ch1_env_gear": 980,
    "ch1_env_geartrain": 4200,
    "ch1_env_corbel_hero": 3200,
    "ch1_env_arch_fragment": 980,
    "ch1_env_wall_a": 560,
    "ch1_env_wall_b": 840,
    "ch1_env_wall_c": 700,
    "ch1_env_buttress_lo": 310,
    "ch1_env_buttress_cap": 250,
    "ch1_env_column_cluster": 1260,
    "ch1_env_stair_fragment": 730,
    "ch1_env_pipe_run": 910,
    "ch1_env_lantern": 480,
}
# per material: (edge length to subdivide to, bevel width, [(feature size m, amplitude m)] of the weathering noise)
WEATHER = {
    "stone": (0.1, 0.028, [(0.5, 0.022), (0.16, 0.011), (0.06, 0.0045)]),
    "metal": (0.14, 0.012, [(0.3, 0.004), (0.07, 0.002)]),
    "flesh": (0.1, 0.0, [(0.4, 0.04), (0.12, 0.016), (0.05, 0.005)]),
}
MAX_FACES = 60000
LOD2_RATIO = 0.4
LOD2_MIN = 36


def lod2_target(lean):
    return max(LOD2_MIN, int(round(lean * LOD2_RATIO / 10.0)) * 10)


def clone_object(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    c.data.name = name
    bpy.context.scene.collection.objects.link(c)
    return c


def enrich(ob, mat, opts, seed):
    """Bevel + subdivide + weather `ob` in place (see DETAIL_TRIS). Mount planes stay flush."""
    from mathutils import noise

    edge, bevel, layers = WEATHER[mat]
    edge = opts.get("edge", edge)  # the statues subdivide finer (0.03 m): they are small and carved, not walls
    layers = [(sz, amp * opts.get("wscale", 1.0)) for sz, amp in layers]  # ... and their weathering is gentler
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    if bevel > 0:
        hard = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_length() > 0.1 and e.calc_face_angle(0.0) > 0.6]
        if hard:
            try:
                bmesh.ops.bevel(bm, geom=hard, offset=bevel, offset_type="OFFSET", segments=2, profile=0.55, affect="EDGES")
            except Exception as ex:  # non-manifold primitives: keep the part unbevelled
                print("  bevel skipped for", ob.name, ex)
    for _ in range(3):
        long = [e for e in bm.edges if e.calc_length() > edge]
        if not long or len(bm.faces) > MAX_FACES:
            break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=True)
    bm.normal_update()
    bm.verts.ensure_lookup_table()
    # mount planes (Blender space): wall y = 0, ceiling / floor z = 0 -> vertices lying on one do not move
    pin = 0.004
    for v in bm.verts:
        c = v.co
        if (opts.get("wall") and abs(c.y) < pin) or ((opts.get("ceiling") or opts.get("floor")) and abs(c.z) < pin):
            continue
        d = 0.0
        for size, amp in layers:
            d += amp * noise.fractal(c / size + Vector((seed * 7.1, seed * 3.3, seed * 1.9)), 0.55, 2.0, 2, noise_basis="PERLIN_ORIGINAL")
        v.co += v.normal * d
    bm.to_mesh(me)
    bm.free()
    me.update()



def main():
    reset_scene()
    mats = {
        "stone": principled("stone", (0.62, 0.58, 0.52)),
        "metal": principled("metal", (0.3, 0.29, 0.28), metallic=0.8, roughness=0.55),
        "flesh": principled("flesh", (0.24, 0.17, 0.16), roughness=0.75),
        "glow": principled("glow", (1.0, 0.7, 0.34), roughness=0.4),
    }
    objects = []
    stats = []
    for pi, (name, mat, fn, opts) in enumerate(PARTS):
        geo = fn()
        ob = make_object(name, geo, mats[mat])
        rich = args.detail and name in DETAIL_TRIS
        has_post = bool(getattr(geo, "post", None))
        if rich and not has_post:  # welded parts: weather first, then decimate each level, then the AO sees the new relief
            enrich(ob, mat, opts, pi)
        elif not rich and opts.get("tris"):
            decimate(ob, opts["tris"])
        if has_post or not rich:
            if not opts.get("noao"):
                bake_ao(ob, opts, args.ao_rays)
            else:
                me = ob.data
                attr = me.color_attributes.new(name="Color", type="BYTE_COLOR", domain="POINT")
                vc = opts.get("vcol", (1.0, 1.0, 1.0))
                for i in range(len(me.vertices)):
                    attr.data[i].color = (vc[0], vc[1], vc[2], 1.0)
                me.color_attributes.active_color = attr
        if has_post:
            geo.post(ob, geo)  # vertex order is the post's contract (per-stone tone): weather only after it, colours interpolate
            if rich:
                enrich(ob, mat, opts, pi)
        if rich:
            ob.name = name + "_src"
            ob.data.name = name + "_src"
            lean = DETAIL_TRIS[name]
            levels = [(name, lean)]
            if args.lods:
                levels = [(name + "_lod0", DETAIL_TRIS_HI[name]), (name, lean), (name + "_lod2", lod2_target(lean))]
            for lname, target in levels:
                lob = decimated_level(ob, lname, target, cap=int(lean * 0.8) if lname.endswith("_lod2") else 0)
                if lob is None:  # no real saving over the medium level: the engine uses that one for the far range too
                    print("  (no lod2 for", name + ")")
                    continue
                if not has_post:
                    bake_ao(lob, opts, args.ao_rays)
                tris = sum(len(p.vertices) - 2 for p in lob.data.polygons)
                stats.append((lob.name, mat, tris, tuple(round(d, 2) for d in lob.dimensions)))
                objects.append(lob)
            drop_object(ob)
        else:
            tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
            stats.append((name, mat, tris, tuple(round(d, 2) for d in ob.dimensions)))
            objects.append(ob)
    path = os.path.join(args.out, "ch1_env_kit.glb")
    export_glb(objects, path)
    for s in stats:
        print("  %-24s %-6s %5d tris  dims(blender xyz) %s" % s)
    print("total tris", sum(s[2] for s in stats))
    print("wrote", path, os.path.getsize(path), "bytes")
    if args.render:
        shown = [o for o in objects if o.name in args.focus.split(",")] if args.focus else objects
        preview(shown, os.path.join(args.out if args.out != DEFAULT_OUT else os.getcwd(), "ch1_env_kit_preview.png"))


main()
