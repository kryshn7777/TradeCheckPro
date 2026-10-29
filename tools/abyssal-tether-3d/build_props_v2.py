"""ABYSSAL TETHER 3D - props v2: the near-field static props rebuilt with real forms (MESH_DETAIL_AND_OPTIMIZATION.md, phase 2).

Writes ONE glTF binary, public/abyssal-tether-3d/assets/models/env/ch1_props_v2.glb, with two families of meshes:

  1. Kit-like parts for LevelView (no UVs: the engine projects the shared PBR sets in metres; COLOR_0 = baked AO, grey; one material each,
     named stone | metal | glow; three levels like the environment kit: <part>_lod0 rich / <part> medium / <part>_lod2 far):
       ch1_env_chainlink          metal  one forged link of the giant chains, UNIT PITCH (the engine scales it by the chain's link pitch):
                                         long axis +Y, centred on the origin, 1.52 long x 0.92 wide x 0.25 thick (the procedural torus' envelope)
       ch1_env_lanternwright      stone  the standing Lanternwright statue (decor 'statue'), normalised to its decor box: x, z in -0.5..0.5,
                                         y -0.5..0.5 (base at -0.5), front +z: hooded, robed (pleats, rope belt), the right arm raises a lantern
       ch1_env_lanternwright_iron metal  its lantern cage and staff
       ch1_env_lanternwright_glow glow   the flame (one level)
  2. Scene-detail hero templates for render/sceneDetail.js (named ch1_sd_<template>, the template's own space and pivot: Y up, metres, lying
     things on y = 0, hanging things from y = 0 down; COLOR_0 = final LINEAR albedo with the AO, cavity grime and edge wear baked in;
     TEXCOORD_0 already inside the props-atlas cell of each surface (sceneDetailKit.propCell)). The view draws them instead of the lean
     procedural template within a few metres of the head (render/sceneDetail.js HI_NEAR).

Every hero part is authored at a fine resolution, bevelled / chipped / pitted, then decimated to the per-part triangle budgets below
(PROP_TRIS), so the detail survives in the silhouette, the normals and the baked AO. Deterministic (seed 29).

Run (Blender 5.x or the bpy module; one Blender at a time):
  flock /tmp/at3d-blender.lock BLENDER_VENV/bin/python tools/abyssal-tether-3d/build_props_v2.py [--out DIR] [--only a,b]
then compress (meshopt, lossless, no quantisation: LevelView and the scene detail read the attributes as metres / floats):
  GLTF_TOOLS=$TOOLS node tools/abyssal-tether-3d/compress_glbs.mjs --dir public/abyssal-tether-3d/assets/models/env --only ch1_props_v2 --lossless
"""

import argparse
import math
import os
import random
import sys

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "..", "public", "abyssal-tether-3d", "assets", "models", "env"))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=DEFAULT_OUT)
ap.add_argument("--seed", type=int, default=29)
ap.add_argument("--only", default="", help="comma list of part names (debug: a partial file)")
ap.add_argument("--ao-rays", type=int, default=48)
ap.add_argument("--stats", default="", help="write a JSON of part -> triangles here")
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)
TAU = math.pi * 2

# -----------------------------------------------------------------------------------------------------------------------------------
# Triangle budgets (the doc's prop classes). Kit-like parts: (lod0, medium, lod2). Scene-detail hero templates: one level.
# -----------------------------------------------------------------------------------------------------------------------------------
KIT_TRIS = {
    "ch1_env_chainlink": (288, 96, 36),
    "ch1_env_lanternwright": (9000, 2600, 800),
    "ch1_env_lanternwright_iron": (1400, 420, 120),
}
PROP_TRIS = {
    "skull": 900, "femur": 420, "femurBroken": 360, "rib": 180, "barrel": 1500, "crateBroken": 900, "crateSmash": 800,
    "lantern": 760, "bucket": 640, "chain4": 520, "chain7": 820, "pickaxe": 420, "hammer": 300, "shovel": 320, "crowbar": 200,
    "ropeCoil": 1000, "block": 420,
}

# linear albedo (sceneDetailKit.js palette) and the props-atlas cells (sceneDetailKit P)
STONE = (0.22, 0.205, 0.185)
BONE = (0.4, 0.35, 0.27)
BONE_D = (0.27, 0.22, 0.16)
WOOD = (0.2, 0.135, 0.085)
WOOD_D = (0.1, 0.07, 0.05)
IRON = (0.1, 0.098, 0.1)
RUSTC = (0.26, 0.115, 0.055)
ROPEC = (0.3, 0.23, 0.14)
GLASS = (0.02, 0.025, 0.025)
CELL = {"stone": 0, "wood": 1, "bone": 2, "iron": 3, "rust": 3, "rope": 4, "glass": 0, "wood2": 14}
SURF = {  # base albedo, variation, edge wear (lighter), cavity grime, rust mix
    "stone": (STONE, 0.18, 0.35, 0.55, 0.0),
    "bone": (BONE, 0.12, 0.22, 0.75, 0.0),
    "wood": (WOOD, 0.22, 0.25, 0.6, 0.0),
    "wood2": (WOOD_D, 0.2, 0.3, 0.6, 0.0),
    "iron": (IRON, 0.15, 0.9, 0.5, 0.45),
    "rust": (RUSTC, 0.2, 0.25, 0.55, 0.0),
    "rope": (ROPEC, 0.12, 0.15, 0.7, 0.0),
    "glass": (GLASS, 0.05, 0.0, 0.2, 0.0),
}
MATS = ["stone", "bone", "wood", "wood2", "iron", "rust", "rope", "glass"]
MI = {m: i for i, m in enumerate(MATS)}


def prop_cell(i):
    """sceneDetailKit.propCell: [u0, v0, u1, v1] of a 4 x 4 atlas cell (row 0 at the top)."""
    pad = 0.006
    c = i & 3
    r = i >> 2
    return (c / 4 + pad, 1 - (r + 1) / 4 + pad, (c + 1) / 4 - pad, 1 - r / 4 - pad)


# -----------------------------------------------------------------------------------------------------------------------------------
# Geometry accumulator in THREE space (x, y up, z front). Faces carry a material name and a smooth flag.
# -----------------------------------------------------------------------------------------------------------------------------------
class Geo:
    def __init__(self):
        self.v = []
        self.f = []

    def vert(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def face(self, idx, mat, smooth=True):
        self.f.append((list(idx), mat, smooth))

    def add(self, o, M=None):
        b = len(self.v)
        for p in o.v:
            self.v.append(tuple(M @ Vector(p)) if M is not None else p)
        for idx, m, s in o.f:
            self.f.append(([i + b for i in idx], m, s))
        return self

    def xf(self, M):
        g = Geo()
        g.add(self, M)
        return g


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def R(axis, a):
    return Matrix.Rotation(a, 4, axis)


def S(x, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))


def frames(path, closed=False):
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    n = len(path)
    tans = []
    for i in range(n):
        if closed:
            a, b = path[(i - 1) % n], path[(i + 1) % n]
        else:
            a, b = path[max(0, i - 1)], path[min(n - 1, i + 1)]
        t = (Vector(b) - Vector(a))
        tans.append(t.normalized() if t.length > 1e-9 else Vector((0, 1, 0)))
    N = Vector((0, 1, 0)) if abs(tans[0].y) < 0.9 else Vector((1, 0, 0))
    out = []
    for t in tans:
        N = (N - t * N.dot(t))
        N = N.normalized() if N.length > 1e-9 else t.orthogonal().normalized()
        out.append((t, N, t.cross(N)))
    return out


def tube(path, radius, sides, mat, closed=False, caps=(False, False), section=None, twist=0.0):
    """Tube along a polyline (three space). radius: number or list; section(i, j, a) -> (sx, sy) scales the cross-section."""
    g = Geo()
    n = len(path)
    fr = frames(path, closed)
    rings = []
    for i, p in enumerate(path):
        t, N, B = fr[i]
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        ring = []
        for j in range(sides):
            a = TAU * j / sides + twist * i
            sx, sy = section(i, j, a) if section else (1.0, 1.0)
            d = N * (math.cos(a) * r * sx) + B * (math.sin(a) * r * sy)
            ring.append(g.vert(Vector(p) + d))
        rings.append(ring)
    segs = n if closed else n - 1
    for i in range(segs):
        A = rings[i]
        Bn = rings[(i + 1) % n]
        for j in range(sides):
            j1 = (j + 1) % sides
            g.face([A[j], A[j1], Bn[j1], Bn[j]], mat)
    if not closed:
        if caps[0]:
            g.face(list(reversed(rings[0])), mat, False)
        if caps[1]:
            g.face(rings[-1], mat, False)
    return g


def lathe(profile, seg, mat, fold=None, cap_top=True, cap_bottom=True):
    """Lathe about +Y of [(r, y)] (bottom to top). fold(a, y) -> radius scale (pleats)."""
    g = Geo()
    rings = []
    for r, y in profile:
        ring = []
        for j in range(seg):
            a = TAU * j / seg
            k = fold(a, y) if fold else 1.0
            ring.append(g.vert((math.sin(a) * r * k, y, math.cos(a) * r * k)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for j in range(seg):
            j1 = (j + 1) % seg
            g.face([A[j], A[j1], B[j1], B[j]], mat)
    if cap_bottom and profile[0][0] > 1e-6:
        g.face(list(reversed(rings[0])), mat, False)
    if cap_top and profile[-1][0] > 1e-6:
        g.face(rings[-1], mat, False)
    return g


def box(c, s, mat, smooth=False):
    """Box centred at c with full size s (8 shared corners: bevel friendly)."""
    g = Geo()
    cx, cy, cz = c
    sx, sy, sz = s[0] / 2, s[1] / 2, s[2] / 2
    v = [g.vert((cx + (sx if i & 1 else -sx), cy + (sy if i & 2 else -sy), cz + (sz if i & 4 else -sz))) for i in range(8)]
    for f in ((1, 3, 7, 5), (0, 4, 6, 2), (2, 6, 7, 3), (0, 1, 5, 4), (4, 5, 7, 6), (0, 2, 3, 1)):
        g.face([v[k] for k in f], mat, smooth)
    return g


def ellipsoid(c, r, useg, vseg, mat, disp=None):
    """Ellipsoid with poles on Y; disp(dir) -> radius scale (carving: sockets, bumps)."""
    g = Geo()
    rows = []
    top = None
    bot = None
    for i in range(1, vseg):
        lat = -math.pi / 2 + math.pi * i / vseg
        row = []
        for j in range(useg):
            lon = TAU * j / useg
            d = Vector((math.cos(lat) * math.sin(lon), math.sin(lat), math.cos(lat) * math.cos(lon)))
            k = disp(d) if disp else 1.0
            row.append(g.vert((c[0] + d.x * r[0] * k, c[1] + d.y * r[1] * k, c[2] + d.z * r[2] * k)))
        rows.append(row)
    kb = disp(Vector((0, -1, 0))) if disp else 1.0
    kt = disp(Vector((0, 1, 0))) if disp else 1.0
    bot = g.vert((c[0], c[1] - r[1] * kb, c[2]))
    top = g.vert((c[0], c[1] + r[1] * kt, c[2]))
    for i in range(len(rows) - 1):
        A, B = rows[i], rows[i + 1]
        for j in range(useg):
            j1 = (j + 1) % useg
            g.face([A[j], A[j1], B[j1], B[j]], mat)
    for j in range(useg):
        j1 = (j + 1) % useg
        g.face([rows[0][j1], rows[0][j], bot], mat)
        g.face([rows[-1][j], rows[-1][j1], top], mat)
    return g


def stadium(L, Rc, n_arc, n_side):
    """Closed stadium path in the XY plane: straight sides of length L along Y, half circles of radius Rc."""
    pts = []
    for k in range(n_arc + 1):  # top arc, right to left
        a = math.pi * k / n_arc
        pts.append((Rc * math.cos(a), L / 2 + Rc * math.sin(a), 0.0))
    for k in range(1, n_side):
        pts.append((-Rc, L / 2 - L * k / n_side, 0.0))
    for k in range(n_arc + 1):
        a = math.pi + math.pi * k / n_arc
        pts.append((Rc * math.cos(a), -L / 2 + Rc * math.sin(a), 0.0))
    for k in range(1, n_side):
        pts.append((Rc, -L / 2 + L * k / n_side, 0.0))
    return pts


def plank(x0, x1, w, t, mat, jag=0.0, rng=None, nseg=6):
    """A board along X (x0..x1), width w along Z, thickness t along Y (centred), with splintered ends when jag > 0."""
    g = Geo()
    rows = []
    for k in range(nseg + 1):
        x = x0 + (x1 - x0) * k / nseg
        row = []
        for (zz, yy) in ((-w / 2, -t / 2), (w / 2, -t / 2), (w / 2, t / 2), (-w / 2, t / 2)):
            row.append(g.vert((x, yy, zz)))
        rows.append(row)
    for k in range(nseg):
        A, B = rows[k], rows[k + 1]
        for j in range(4):
            j1 = (j + 1) % 4
            g.face([A[j], B[j], B[j1], A[j1]], mat, False)
    for end, sgn in ((0, -1), (nseg, 1)):
        row = rows[end]
        if jag > 0 and rng is not None:
            # splintered end: a fan of jagged points instead of a flat cut
            tips = []
            for q in range(4):
                zz = -w / 2 + w * (q + 0.5) / 4
                tips.append(g.vert(((x0 if sgn < 0 else x1) + sgn * jag * (0.3 + rng.random()), (rng.random() - 0.5) * t * 0.6, zz)))
            c = g.vert((x0 if sgn < 0 else x1, 0.0, 0.0))
            ring = list(reversed(row)) if sgn > 0 else row
            for j in range(4):
                g.face([ring[j], ring[(j + 1) % 4], c], mat, False)
            for q in range(4):  # the splinters: thin blades, both sides
                a, b2 = ring[q], ring[(q + 1) % 4]
                g.face([a, b2, tips[q]], mat, False)
                g.face([b2, a, tips[q]], mat, False)
        else:
            g.face(list(reversed(row)) if sgn > 0 else row, mat, False)
    return g


# -----------------------------------------------------------------------------------------------------------------------------------
# Blender side: object from Geo, bevel / subdivide / displace, decimate, AO + albedo bake, export
# -----------------------------------------------------------------------------------------------------------------------------------
def to_blender(p):
    return (p[0], -p[2], p[1])


def from_blender(p):
    return Vector((p[0], p[2], -p[1]))


MAT_OBJ = {}


def material(name):
    if name not in MAT_OBJ:
        m = bpy.data.materials.new(name)
        MAT_OBJ[name] = m
    return MAT_OBJ[name]


def make_object(name, geo, mats):
    me = bpy.data.meshes.new(name)
    verts = [to_blender(p) for p in geo.v]
    faces = [tuple(idx) for idx, _m, _s in geo.f]
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(material(m))
    lookup = {m: i for i, m in enumerate(mats)}
    for poly, (_idx, m, sm) in zip(me.polygons, geo.f):  # before validate(): it may drop degenerate faces
        poly.material_index = lookup.get(m, 0)
        poly.use_smooth = sm
    me.validate(clean_customdata=False)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def bm_of(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    return bm


def bm_back(ob, bm):
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def bevel(ob, width, segs=2, angle=0.6, min_len=0.0):
    bm = bm_of(ob)
    hard = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_length() > min_len and e.calc_face_angle(0.0) > angle]
    if hard:
        try:
            bmesh.ops.bevel(bm, geom=hard, offset=width, offset_type="OFFSET", segments=segs, profile=0.6, affect="EDGES", clamp_overlap=True)
        except Exception as ex:  # non-manifold input: keep it unbevelled
            print("  bevel skipped for", ob.name, ex)
    bm_back(ob, bm)


def subdivide(ob, edge, max_faces=40000):
    bm = bm_of(ob)
    for _ in range(4):
        long = [e for e in bm.edges if e.calc_length() > edge]
        if not long or len(bm.faces) > max_faces:
            break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm_back(ob, bm)


def displace(ob, fn):
    """fn(co_three, normal_three, mat) -> offset along the normal (m). Vertices keep their place on a mount plane (fn decides)."""
    bm = bm_of(ob)
    bm.normal_update()
    mats = [MATS_OF(ob, f.material_index) for f in bm.faces]
    vm = {}
    for f in bm.faces:
        for v in f.verts:
            vm.setdefault(v.index, mats[f.index])
    moves = []
    for v in bm.verts:
        n = from_blender(v.normal)
        c = from_blender(v.co)
        d = fn(c, n, vm.get(v.index, "stone"))
        moves.append((v, v.normal * d))
    for v, dv in moves:
        v.co += dv
    bm_back(ob, bm)


def MATS_OF(ob, i):
    ms = ob.data.materials
    return ms[i].name if i < len(ms) and ms[i] else "stone"


def tris_of(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate(ob, target):
    for _ in range(5):
        t = tris_of(ob)
        if t <= target * 1.06:
            return
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.01, target / t)
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        for o in bpy.context.view_layer.objects:
            o.select_set(o is ob)
        bpy.ops.object.modifier_apply(modifier=mod.name)


def clone(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    c.data.name = name
    bpy.context.scene.collection.objects.link(c)
    return c


def drop(ob):
    me = ob.data
    bpy.data.objects.remove(ob)
    if me.users == 0:
        bpy.data.meshes.remove(me)


def hemisphere(n, seed=3):
    rng = random.Random(seed)
    out = []
    for i in range(n):
        u = (i + rng.random()) / n
        a = TAU * rng.random()
        r = math.sqrt(u)
        out.append((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u))))
    return out


def vertex_ao(ob, rays, plane=None, maxd=0.25):
    """Per-vertex AO (cosine rays against the object itself and an optional mount plane, three space: ('floor', y0) / ('wall', z0))."""
    bm = bm_of(ob)
    bm.verts.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm)
    dirs = hemisphere(rays)
    ao = []
    for v in bm.verts:
        nrm = v.normal.normalized() if v.normal.length > 1e-6 else Vector((0, 0, 1))
        t1 = nrm.orthogonal().normalized()
        t2 = nrm.cross(t1)
        o = v.co + nrm * 0.0015
        hit = 0
        for dx, dy, dz in dirs:
            d = (t1 * dx + t2 * dy + nrm * dz).normalized()
            loc, _n, _i, _dd = bvh.ray_cast(o, d, maxd)
            occ = loc is not None
            if not occ and plane:
                kind, p0 = plane
                if kind == "floor" and d.z < -1e-6:  # three y = blender z
                    tt = (p0 - o.z) / d.z
                    occ = 0 < tt < maxd
                elif kind == "wall" and d.y > 1e-6:  # three z = -blender y; wall at three z = p0 -> blender y = -p0
                    tt = (-p0 - o.y) / d.y
                    occ = 0 < tt < maxd
            hit += 1 if occ else 0
        ao.append(1.0 - 0.92 * hit / len(dirs))
    bm.free()
    return ao


def convexity(ob):
    """Per-vertex convexity (-1 cavity .. +1 sharp edge) from the angle between the vertex normal and its neighbours."""
    bm = bm_of(ob)
    bm.verts.ensure_lookup_table()
    out = []
    for v in bm.verts:
        acc = 0.0
        n = 0
        for e in v.link_edges:
            o = e.other_vert(v)
            d = o.co - v.co
            if d.length < 1e-9:
                continue
            acc += -v.normal.dot(d.normalized())
            n += 1
        out.append(acc / n if n else 0.0)
    bm.free()
    return out


def bake_kit_ao(ob, rays, plane=None, maxd=0.6):
    """Kit-like parts: grey AO into a BYTE colour attribute (as build_env_kit.py does)."""
    ao = vertex_ao(ob, rays, plane, maxd)
    me = ob.data
    attr = me.color_attributes.new(name="Color", type="BYTE_COLOR", domain="POINT")
    for i, a in enumerate(ao):
        a = max(0.08, min(1.0, a)) ** 1.2
        attr.data[i].color = (a, a, a, 1.0)
    me.color_attributes.active_color = attr


def skull_paint(c):
    """The orbits and the nasal cavity are near black (the lean template painted them; the carving alone reads too shallow)."""
    d = (c - Vector((0.0, 0.095, -0.006)))
    if d.length < 1e-6:
        return 1.0
    d = Vector((d.x / 0.084, d.y / 0.079, d.z / 0.1)).normalized()
    k = 1.0
    for s in (Vector((0.36, 0.08, 0.93)).normalized(), Vector((-0.36, 0.08, 0.93)).normalized()):
        ang = math.acos(max(-1.0, min(1.0, d.dot(s))))
        k = min(k, 0.12 + 0.88 * min(1.0, max(0.0, (ang - 0.14) / 0.12)))
    ang = math.acos(max(-1.0, min(1.0, d.dot(Vector((0.0, -0.32, 0.95)).normalized()))))
    k = min(k, 0.15 + 0.85 * min(1.0, max(0.0, (ang - 0.07) / 0.08)))
    return k


PAINT = {"skull": skull_paint}


def bake_prop_colour(ob, rays, plane, seed, tint=None, paint=None):
    """Scene-detail templates: final LINEAR albedo per vertex (base x variation x AO x cavity grime, lighter worn edges, rust on iron)."""
    ao = vertex_ao(ob, rays, plane, 0.12)
    cv = convexity(ob)
    me = ob.data
    vmat = {}
    for p in me.polygons:
        for vi in p.vertices:
            vmat.setdefault(vi, MATS_OF(ob, p.material_index))
    attr = me.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for i, v in enumerate(me.vertices):
        m = vmat.get(i, "stone")
        base, var, wear, grime, rust = SURF[m]
        if tint and m in tint:
            base = tint[m]
        c = from_blender(v.co)
        nz = noise.fractal(c * 9.0 + off, 0.6, 2.0, 3, noise_basis="PERLIN_ORIGINAL")
        k = 1.0 + var * nz
        a = max(0.35, min(1.0, ao[i]))  # soft: the game's GI / lantern add their own occlusion
        k *= a ** (0.6 + grime)
        e = max(0.0, cv[i] - 0.05) * 2.2
        k *= 1.0 + wear * min(1.0, e)
        col = [base[0] * k, base[1] * k, base[2] * k]
        if rust > 0:
            rn = noise.fractal(c * 14.0 + off * 1.3, 0.5, 2.0, 3, noise_basis="PERLIN_ORIGINAL")
            r = max(0.0, min(1.0, (rn + 0.1) * 2.0)) * rust * (1.0 - min(1.0, e))
            col = [col[q] * (1 - r) + RUSTC[q] * r * a for q in range(3)]
        if paint:
            pk = paint(c)
            col = [col[0] * pk, col[1] * pk, col[2] * pk]
        attr.data[i].color = (col[0], col[1], col[2], 1.0)
    me.color_attributes.active_color = attr


def atlas_uv(ob):
    """TEXCOORD_0 inside each surface's props-atlas cell: box projection in template metres (the grain repeats every ~0.25 m)."""
    me = ob.data
    uvl = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        cell = prop_cell(CELL.get(MATS_OF(ob, p.material_index), 0))
        n = from_blender(p.normal)
        ax = max(range(3), key=lambda q: abs(n[q]))
        for li in p.loop_indices:
            c = from_blender(me.vertices[me.loops[li].vertex_index].co)
            u, v = (c.z, c.y) if ax == 0 else (c.x, c.z) if ax == 1 else (c.x, c.y)
            fu = (u * 4.0) % 1.0
            fv = (v * 4.0) % 1.0
            uvl.data[li].uv = (cell[0] + (cell[2] - cell[0]) * fu, cell[1] + (cell[3] - cell[1]) * fv)


def wear_fn(seed, amp_by_mat, size=0.03, chip=0.0, pin=None):
    off = Vector((seed * 7.1, seed * 3.3, seed * 1.9))

    def fn(c, n, m):
        if pin and pin(c):
            return 0.0
        a = amp_by_mat.get(m, 0.0)
        if a <= 0:
            return 0.0
        d = a * noise.fractal(c / size + off, 0.55, 2.0, 3, noise_basis="PERLIN_ORIGINAL")
        if chip > 0:
            cn = noise.cell(c / (size * 2.5) + off)
            if cn > 0.72:
                d -= chip * (cn - 0.72) / 0.28
        return d

    return fn


# -----------------------------------------------------------------------------------------------------------------------------------
# Kit-like parts
# -----------------------------------------------------------------------------------------------------------------------------------
def chainlink_src():
    """A forged link at unit pitch: stadium wire, slightly flattened section, a weld bulge on one side, hammer facets."""
    L, Rc, rw = 0.55, 0.335, 0.115
    path = stadium(L, Rc, 16, 8)
    n = len(path)
    weld = n * 3 // 4  # the middle of the right-hand side

    def sec(i, j, a):
        k = 1.0 + 0.22 * math.exp(-((min(abs(i - weld), n - abs(i - weld))) / 2.2) ** 2)  # the weld bulge
        return (k * 1.04, k * 0.92)

    radii = [rw] * n
    g = tube(path, radii, 16, "metal", closed=True, section=sec)
    return g


def chainlink_med():
    """The medium level by hand (a decimated ring falls apart): 6 sides x 8 segments = 96 triangles, the same flattened section."""
    L, Rc, rw = 0.55, 0.335, 0.118
    return tube(stadium(L, Rc, 3, 1), rw, 6, "metal", closed=True, section=lambda i, j, a: (1.04, 0.92), twist=0.0)


def chainlink_far():
    """The far level by hand: 3 sides x 6 segments = 36 triangles (the old torus' count), a proper stadium outline."""
    L, Rc, rw = 0.55, 0.335, 0.12
    return tube(stadium(L, Rc, 2, 1), rw, 3, "metal", closed=True)


def lanternwright_src():
    """The standing Lanternwright, authored in metres for the 2.2 x 6.4 x 2.2 m statues of S1 (normalised afterwards)."""
    W, H = 2.2, 6.4
    st = Geo()
    iron = Geo()
    glow = Geo()
    base = -H / 2
    # plinth: a stepped, moulded base
    ph = H * 0.1
    st.add(box((0, base + ph * 0.2, 0), (W * 0.96, ph * 0.4, W * 0.96), "stone"))
    st.add(box((0, base + ph * 0.62, 0), (W * 0.86, ph * 0.44, W * 0.86), "stone"))
    st.add(box((0, base + ph * 0.92, 0), (W * 0.9, ph * 0.16, W * 0.9), "stone"))
    y0 = base + ph
    # robe: a pleated lathe from the hem (flared, a rolled hem) to the shoulders
    robe_h = H * 0.54
    prof = []
    for k in range(13):
        t = k / 12
        r = W * (0.4 - 0.17 * t ** 0.85 + 0.03 * math.sin(t * math.pi))
        if k == 0:
            r = W * 0.36
        prof.append((r, y0 + robe_h * t + (0.0 if k else 0.02)))

    def pleats(a, y):
        t = (y - y0) / robe_h
        return 1.0 + (0.07 * (1 - t) + 0.015) * math.cos(9 * a + 1.3 * t) + 0.03 * math.cos(4 * a + 0.7)

    st.add(lathe(prof, 40, "stone", fold=pleats, cap_bottom=False))
    # rope belt with a knot and two tails
    by = y0 + robe_h * 0.62
    br = W * 0.255
    belt = [(math.sin(TAU * k / 28) * br * 1.02, by + 0.02 * math.sin(TAU * k / 14), math.cos(TAU * k / 28) * br) for k in range(28)]
    st.add(tube(belt, W * 0.022, 6, "stone", closed=True))
    st.add(ellipsoid((W * 0.05, by - 0.02, br * 0.98), (W * 0.045, W * 0.04, W * 0.035), 8, 6, "stone"))
    for s in (-1, 1):
        tail = [(W * 0.05 + s * W * 0.02, by - 0.05 - k * 0.12, br * (1.0 + 0.02 * k)) for k in range(7)]
        st.add(tube(tail, [W * 0.018 * (1 - k / 9) for k in range(7)], 5, "stone", caps=(False, True)))
    # torso / shoulders
    sy = y0 + robe_h
    st.add(ellipsoid((0, sy + H * 0.035, 0), (W * 0.25, H * 0.075, W * 0.19), 20, 10, "stone"))
    # hood: an outer shell with a pointed peak and a deep face opening (pushed inward in front)
    hy = sy + H * 0.13
    hr = W * 0.17

    def hood(d):
        k = 1.0 + 0.35 * max(0.0, d.y) ** 3  # the peak
        k *= 1.0 - 0.55 * math.exp(-((math.acos(max(-1, min(1, d.z))) / 0.5) ** 2)) * (1.0 if d.y > -0.6 else 0.0)  # the face hollow
        k *= 1.0 + 0.06 * math.cos(6 * math.atan2(d.x, -d.z))  # drape folds
        return k

    st.add(ellipsoid((0, hy, -W * 0.01), (hr, H * 0.075, hr * 1.12), 28, 16, "stone", disp=hood))
    # the rolled front edge of the hood
    rim = [(math.sin(a) * hr * 0.62, hy + math.cos(a) * H * 0.052 - H * 0.004, hr * 0.92 - 0.04 * abs(math.cos(a))) for a in [(-0.9 + 1.8 * k / 14) * math.pi for k in range(15)]]
    st.add(tube(rim, W * 0.022, 6, "stone"))
    # the face in shadow: a brow and a nose catching the lantern
    st.add(ellipsoid((0, hy - H * 0.004, hr * 0.62), (W * 0.06, H * 0.012, W * 0.04), 10, 6, "stone"))
    st.add(ellipsoid((0, hy - H * 0.02, hr * 0.7), (W * 0.018, H * 0.014, W * 0.03), 8, 6, "stone"))
    # right arm raised forward with the lantern: sleeve (flared cuff), hand
    sh = Vector((W * 0.21, sy + H * 0.04, W * 0.02))
    el = Vector((W * 0.3, sy - H * 0.01, W * 0.3))
    wr = Vector((W * 0.27, sy + H * 0.03, W * 0.58))
    arm = [sh, sh.lerp(el, 0.5), el, el.lerp(wr, 0.5), wr]
    st.add(tube([tuple(p) for p in arm], [W * 0.085, W * 0.08, W * 0.075, W * 0.075, W * 0.095], 14, "stone", caps=(True, False)))
    cuff = [tuple(wr + (wr - el).normalized() * (k * 0.02)) for k in range(3)]
    st.add(tube(cuff, [W * 0.1, W * 0.105, W * 0.07], 14, "stone", caps=(False, True)))
    hand = wr + (wr - el).normalized() * 0.1
    st.add(ellipsoid(tuple(hand), (W * 0.05, W * 0.045, W * 0.06), 10, 8, "stone"))
    # left arm down along the body to the staff
    sl = Vector((-W * 0.22, sy + H * 0.03, 0.0))
    hl = Vector((-W * 0.3, sy - H * 0.17, W * 0.12))
    st.add(tube([tuple(sl), tuple(sl.lerp(hl, 0.5) + Vector((-W * 0.04, 0, 0))), tuple(hl)], [W * 0.085, W * 0.08, W * 0.095], 14, "stone", caps=(True, True)))
    st.add(ellipsoid(tuple(hl + Vector((0, -0.05, 0.02))), (W * 0.05, W * 0.06, W * 0.05), 10, 8, "stone"))
    # the staff (iron): from the plinth to above the hood, a crook and a ferrule
    sx, sz = -W * 0.3, W * 0.14
    staff = [(sx, y0 - 0.02, sz), (sx, sy + H * 0.2, sz)]
    iron.add(tube(staff, W * 0.022, 8, "metal", caps=(True, False)))
    crook = [(sx + 0.1 * (1 - math.cos(a)) * 0.6, sy + H * 0.2 + 0.18 * math.sin(a), sz) for a in [math.pi * k / 10 for k in range(11)]]
    iron.add(tube(crook, W * 0.02, 8, "metal", caps=(False, True)))
    for yy in (sy - H * 0.17 + 0.18, sy - H * 0.17 - 0.18):
        iron.add(tube([(sx, yy - 0.04, sz), (sx, yy + 0.04, sz)], W * 0.03, 8, "metal", caps=(True, True)))
    # the lantern hanging from the raised hand: ring, cap, six ribs, base, finial; the flame inside
    lr = W * 0.1
    lh = 0.72
    lx, ly, lz = hand.x, hand.y - 0.2 - lh / 2 - 0.2, hand.z + 0.04
    ring = [(lx + math.sin(TAU * k / 12) * 0.1, hand.y - 0.06 + math.cos(TAU * k / 12) * 0.1, lz) for k in range(12)]
    iron.add(tube(ring, 0.022, 6, "metal", closed=True))
    iron.add(tube([(lx, hand.y - 0.16, lz), (lx, ly + lh / 2 + 0.3, lz)], 0.02, 6, "metal"))
    iron.add(lathe([(lr * 1.2, ly + lh / 2), (lr * 1.25, ly + lh / 2 + 0.04), (lr * 0.9, ly + lh / 2 + 0.12), (lr * 0.3, ly + lh / 2 + 0.22), (0.035, ly + lh / 2 + 0.32)], 12, "metal", cap_bottom=True))
    iron.add(lathe([(lr * 0.4, ly - lh / 2 - 0.12), (lr * 1.1, ly - lh / 2 - 0.05), (lr * 1.2, ly - lh / 2)], 12, "metal", cap_bottom=True, cap_top=True))
    for k in range(6):
        a = TAU * k / 6
        iron.add(tube([(lx + math.sin(a) * lr * 1.1, ly - lh / 2, lz + math.cos(a) * lr * 1.1), (lx + math.sin(a) * lr * 1.25, ly, lz + math.cos(a) * lr * 1.25),
                       (lx + math.sin(a) * lr * 1.1, ly + lh / 2, lz + math.cos(a) * lr * 1.1)], 0.026, 6, "metal"))
    glow.add(ellipsoid((lx, ly - 0.02, lz), (lr * 0.55, lh * 0.32, lr * 0.55), 8, 6, "glow"))
    return st, iron, glow


# -----------------------------------------------------------------------------------------------------------------------------------
# Scene-detail hero templates (three space = template space)
# -----------------------------------------------------------------------------------------------------------------------------------
def sd_skull(rng):
    g = Geo()
    so = [Vector((0.36, 0.08, 0.93)).normalized(), Vector((-0.36, 0.08, 0.93)).normalized()]
    nasal = Vector((0.0, -0.32, 0.95)).normalized()
    cheek = [Vector((0.62, -0.3, 0.72)).normalized(), Vector((-0.62, -0.3, 0.72)).normalized()]
    temple = [Vector((0.95, 0.05, 0.2)).normalized(), Vector((-0.95, 0.05, 0.2)).normalized()]

    def cr(d):
        k = 1.0
        for s in so:
            ang = math.acos(max(-1.0, min(1.0, d.dot(s))))
            k -= 0.38 * math.exp(-((ang / 0.27) ** 2.4))  # deep orbits
            k += 0.05 * math.exp(-(((ang - 0.36) / 0.09) ** 2)) * (1.0 if d.y > s.y else 0.4)  # the orbital rim / brow
        ang = math.acos(max(-1.0, min(1.0, d.dot(nasal))))
        k -= 0.3 * math.exp(-((ang / 0.15) ** 2))
        for c in cheek:
            ang = math.acos(max(-1.0, min(1.0, d.dot(c))))
            k += 0.07 * math.exp(-((ang / 0.25) ** 2))
        for tp in temple:
            ang = math.acos(max(-1.0, min(1.0, d.dot(tp))))
            k -= 0.06 * math.exp(-((ang / 0.35) ** 2))
        if d.y < -0.45:  # the cranial base is flat-ish
            k *= 1.0 - 0.35 * (-d.y - 0.45)
        if d.z > 0.35 and d.y < -0.25:  # the face drops forward to the maxilla
            k *= 1.0 + 0.12 * (d.z - 0.35)
        return k

    g.add(ellipsoid((0, 0.095, -0.006), (0.084, 0.079, 0.1), 40, 30, "bone", disp=cr))
    # maxilla with the upper teeth
    g.add(ellipsoid((0, 0.042, 0.072), (0.04, 0.02, 0.03), 14, 8, "bone"))
    for k in range(10):
        a = (k - 4.5) / 4.5 * 1.1
        x = math.sin(a) * 0.036
        z = 0.068 + math.cos(a) * 0.024
        g.add(box((x, 0.026, z), (0.0085, 0.013, 0.008), "bone").xf(T(x, 0.026, z) @ R("Y", a) @ T(-x, -0.026, -z)))
    # the mandible, dropped a little open: a U of tube with the chin and the rami going up
    jaw = []
    for k in range(13):
        a = (k / 12 - 0.5) * 2.5
        jaw.append((math.sin(a) * 0.046, 0.008 + 0.004 * abs(math.sin(a)), 0.052 + math.cos(a) * 0.036 - 0.03))
    g.add(tube(jaw, [0.0085 if 2 < k < 10 else 0.0075 for k in range(13)], 8, "bone", caps=(True, True), section=lambda i, j, a: (1.7, 1.0)))
    for s in (-1, 1):
        g.add(tube([(s * 0.047, 0.01, 0.01), (s * 0.05, 0.03, -0.008), (s * 0.05, 0.05, -0.016)], [0.008, 0.007, 0.006], 6, "bone", caps=(False, True), section=lambda i, j, a: (0.6, 1.6)))
    for k in range(8):
        a = (k - 3.5) / 3.5 * 1.0
        g.add(box((math.sin(a) * 0.034, 0.018, 0.062 + math.cos(a) * 0.02 - 0.03 + 0.012), (0.007, 0.01, 0.007), "bone"))
    return g, {"bone": 0.0012}, ("floor", 0.0)


def sd_femur(rng, broken=False):
    g = Geo()
    L = 0.16 if broken else 0.22
    shaft = []
    rad = []
    n = 12
    for k in range(n + 1):
        t = k / n
        x = -L + 2 * L * t
        shaft.append((x, 0.027 + 0.006 * math.sin(t * math.pi), 0.004 * math.sin(t * TAU)))
        rad.append(0.0125 + 0.004 * ((2 * t - 1) ** 4))
    g.add(tube(shaft, rad, 12, "bone", section=lambda i, j, a: (1.0, 1.15)))
    # proximal end: the neck angled up to the round head, the greater trochanter
    g.add(tube([(-L, 0.027, 0), (-L - 0.022, 0.034, 0.012)], [0.012, 0.011], 10, "bone"))
    g.add(ellipsoid((-L - 0.03, 0.036, 0.016), (0.022, 0.021, 0.022), 16, 12, "bone"))
    g.add(ellipsoid((-L + 0.004, 0.031, -0.012), (0.017, 0.015, 0.014), 12, 8, "bone"))
    if not broken:
        # distal end: two condyles
        for s in (-1, 1):
            g.add(ellipsoid((L + 0.008, 0.026, s * 0.011), (0.017, 0.019, 0.013), 14, 10, "bone"))
    else:
        # a splintered break: jagged cone of shards
        for k in range(6):
            a = TAU * k / 6 + rng.random() * 0.4
            tip = (L + 0.012 + rng.random() * 0.025, 0.033 + math.sin(a) * 0.008, math.cos(a) * 0.008)
            base = [(L - 0.004, 0.033 + math.sin(a + d) * 0.014, math.cos(a + d) * 0.013) for d in (-0.5, 0.5)]
            tg = Geo()
            i0 = tg.vert(base[0])
            i1 = tg.vert(base[1])
            i2 = tg.vert(tip)
            tg.face([i0, i1, i2], "bone", False)
            tg.face([i2, i1, i0], "bone", False)
            g.add(tg)
    return g, {"bone": 0.0009}, ("floor", 0.0)


def sd_rib(rng):
    pts = []
    for i in range(14):
        a = (i / 13) * 2.2 - 0.2
        pts.append((math.cos(a) * 0.16, 0.016 + math.sin(a) * 0.1 * (1 if i > 0 else 0.3), math.sin(a * 1.3) * 0.02))
    g = tube(pts, [0.0125 - i * 0.0006 for i in range(14)], 7, "bone", caps=(True, True), section=lambda i, j, a: (0.55, 1.25))
    return g, {"bone": 0.0006}, ("floor", 0.0)


def stave_ring(r0, bulge, h, nst, missing, mat, rng, bent=None, short=None, gap=0.012, thick=0.018, rows=8):
    g = Geo()
    for i in range(nst):
        if i in missing:
            continue
        a0 = TAU * i / nst + gap / (2 * r0)
        a1 = TAU * (i + 1) / nst - gap / (2 * r0)
        top = h - (0.07 + 0.05 * rng.random() if short == i else 0.0)
        out = 0.11 if bent == i else 0.0
        rings = []
        for k in range(rows + 1):
            t = k / rows
            y = top * t
            rr = r0 + bulge * math.sin(t * math.pi) + out * t * t
            ring = []
            for a in (a0, (a0 + a1) / 2, a1):
                for dr in (0.0, -thick):
                    ring.append((math.sin(a) * (rr + dr), y, math.cos(a) * (rr + dr)))
            rings.append(ring)
        sg = Geo()
        idx = [[sg.vert(p) for p in ring] for ring in rings]
        # outside (0,2,4), inside (1,3,5)
        for k in range(rows):
            A, B = idx[k], idx[k + 1]
            for (p, q) in ((0, 2), (2, 4)):
                sg.face([A[p], A[q], B[q], B[p]], mat, True)
            for (p, q) in ((3, 1), (5, 3)):
                sg.face([A[p], A[q], B[q], B[p]], mat, True)
            sg.face([A[1], A[0], B[0], B[1]], mat, False)
            sg.face([A[4], A[5], B[5], B[4]], mat, False)
        for ring, flip in ((idx[0], True), (idx[-1], False)):
            q = [ring[0], ring[2], ring[4], ring[5], ring[3], ring[1]]
            sg.face(list(reversed(q)) if flip else q, mat, False)
        g.add(sg)
    return g


def sd_barrel(rng):
    g = Geo()
    h = 0.36
    g.add(stave_ring(0.205, 0.032, h, 14, {4, 5, 11}, "wood", rng, bent=6, short=8))
    # the base: three boards inside the bottom
    for k in range(3):
        g.add(box((0, 0.012, -0.12 + k * 0.12), (0.36 - 0.12 * abs(k - 1), 0.016, 0.115), "wood2"))
    # iron hoops: flat bands with rivets; the upper one has slipped and hangs crooked
    for (y, tilt, rad) in ((0.06, 0.0, 0.213), (0.29, 0.07, 0.226)):
        band = []
        for k in range(33):
            a = TAU * k / 32
            band.append((math.sin(a) * (rad + 0.004), y + math.sin(a) * tilt * 0.12, math.cos(a) * (rad + 0.004)))
        g.add(tube(band, 0.006, 4, "iron", closed=True, section=lambda i, j, a: (2.4, 0.45)))
        for k in range(6):
            a = TAU * (k + 0.3) / 6
            g.add(ellipsoid((math.sin(a) * (rad + 0.008), y + math.sin(a) * tilt * 0.12, math.cos(a) * (rad + 0.008)), (0.004, 0.004, 0.004), 6, 4, "iron"))
    return g, {"wood": 0.0015, "wood2": 0.001, "iron": 0.0006}, ("floor", 0.0)


def nails(g, pts, rng):
    for (x, y, z, axis) in pts:
        if axis == "y":
            g.add(lathe([(0.0035, y), (0.0042, y + 0.002), (0.0, y + 0.003)], 6, "iron", cap_bottom=False, cap_top=False).xf(T(x, 0, z)))
        else:
            g.add(lathe([(0.0035, 0.0), (0.0042, 0.002), (0.0, 0.003)], 6, "iron", cap_bottom=False, cap_top=False).xf(T(x, y, z) @ R("X", math.pi / 2 if axis == "z" else 0) @ R("Z", -math.pi / 2 if axis == "x" else 0)))


def sd_crate_broken(rng):
    g = Geo()
    # floor boards
    for k in range(3):
        g.add(plank(-0.22, 0.22, 0.142, 0.02, "wood2", 0.0).xf(T(0, 0.01, -0.146 + k * 0.146)))
    # corner posts with a chamfer (bevel later)
    for (x, z) in ((-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)):
        g.add(box((x, 0.22, z), (0.042, 0.42, 0.042), "wood2"))
    # front slats (one cracked and sagging), side slats; a missing one shows the inside
    for k in range(3):
        y = 0.08 + k * 0.14
        sag = -0.03 if k == 1 else 0.0
        jag = 0.02 if k == 1 else 0.0
        g.add(plank(-0.2, 0.2 if k != 1 else 0.12, 0.046, 0.016, "wood", jag, rng).xf(T(0, y, 0.218) @ R("X", math.pi / 2) @ R("Z", sag)))
    for k in range(2):
        g.add(plank(-0.19, 0.19, 0.05, 0.016, "wood", 0.0).xf(T(-0.218, 0.08 + k * 0.17, 0) @ R("Y", math.pi / 2) @ R("X", math.pi / 2)))
    nails(g, [(-0.19, 0.08, 0.227, "z"), (0.19, 0.08, 0.227, "z"), (-0.19, 0.36, 0.227, "z"), (0.19, 0.36, 0.227, "z"), (-0.227, 0.08, 0.17, "x"), (-0.227, 0.25, -0.17, "x")], rng)
    return g, {"wood": 0.0018, "wood2": 0.0015}, ("floor", 0.0)


def sd_crate_smash(rng):
    g = Geo()
    for k in range(3):
        g.add(plank(-0.25, 0.25 - 0.05 * k, 0.16, 0.02, "wood2", 0.02 if k == 2 else 0.0, rng).xf(T(0, 0.01, -0.165 + k * 0.165)))
    for k in range(3):
        g.add(plank(-0.06, 0.06, 0.125, 0.018, "wood", 0.015 if k == 0 else 0.0, rng).xf(T(-0.24, 0.15, -0.16 + k * 0.16) @ R("Z", math.pi / 2) @ R("Y", 0.05 * (k - 1))))
    g.add(plank(-0.25, 0.25, 0.13, 0.02, "wood", 0.02, rng).xf(T(0.0, 0.14, 0.25) @ R("X", math.pi / 2) @ R("Z", 0.03)))
    g.add(box((0.22, 0.04, 0.0), (0.044, 0.044, 0.5), "wood2"))
    g.add(plank(-0.21, 0.21, 0.1, 0.02, "wood", 0.02, rng).xf(T(0.36, 0.015, -0.3) @ R("Y", 0.8) @ R("Z", 0.1)))
    nails(g, [(-0.23, 0.14, 0.262, "z"), (0.23, 0.14, 0.262, "z"), (-0.252, 0.15, 0.1, "x"), (-0.252, 0.15, -0.1, "x")], rng)
    return g, {"wood": 0.0018, "wood2": 0.0015}, ("floor", 0.0)


def sd_lantern(rng):
    g = Geo()
    # base pan with a rim, four bevelled posts, a pyramid cap with a vent and a bail
    g.add(lathe([(0.0, 0.0), (0.062, 0.0), (0.066, 0.006), (0.064, 0.028), (0.056, 0.03), (0.0, 0.03)], 4, "iron", cap_bottom=False, cap_top=False).xf(R("Y", math.pi / 4) @ S(1.0, 1.0, 1.0)))
    for (x, z) in ((-0.05, -0.05), (0.05, -0.05), (-0.05, 0.05), (0.05, 0.05)):
        g.add(box((x, 0.105, z), (0.012, 0.16, 0.012), "iron"))
    for y in (0.035, 0.175):
        for (c, s) in (((0, y, 0.05), (0.1, 0.008, 0.006)), ((0, y, -0.05), (0.1, 0.008, 0.006)), ((0.05, y, 0), (0.006, 0.008, 0.1)), ((-0.05, y, 0), (0.006, 0.008, 0.1))):
            g.add(box(c, s, "iron"))
    # glass panes, one broken out, one cracked in two
    for k, (c, s) in enumerate((((0, 0.105, 0.047), (0.088, 0.13, 0.003)), ((0.047, 0.105, 0), (0.003, 0.13, 0.088)), ((-0.047, 0.105, 0), (0.003, 0.13, 0.088)))):
        if k == 2:
            g.add(box((-0.047, 0.07, 0.0), (0.003, 0.06, 0.088), "glass"))
            g.add(box((-0.047, 0.135, 0.02), (0.003, 0.05, 0.05), "glass").xf(T(-0.047, 0.135, 0.02) @ R("X", 0.15) @ T(0.047, -0.135, -0.02)))
        else:
            g.add(box(c, s, "glass"))
    g.add(lathe([(0.068, 0.18), (0.068, 0.188), (0.03, 0.225), (0.016, 0.23)], 4, "iron", cap_bottom=True, cap_top=False).xf(R("Y", math.pi / 4)))
    g.add(lathe([(0.016, 0.228), (0.016, 0.25), (0.022, 0.252), (0.0, 0.262)], 8, "iron", cap_bottom=False))
    arc = [(math.cos(math.pi * k / 10) * 0.055, 0.24 + math.sin(math.pi * k / 10) * 0.065, 0.0) for k in range(11)]
    g.add(tube(arc, 0.0035, 5, "iron"))
    # the dead wick in a burner cup
    g.add(lathe([(0.0, 0.03), (0.018, 0.03), (0.02, 0.05), (0.012, 0.055), (0.0, 0.055)], 8, "iron", cap_bottom=False, cap_top=False))
    return g, {"iron": 0.0005}, ("floor", 0.0)


def sd_bucket(rng):
    g = Geo()

    def dent(a, y):
        return 1.0 - 0.08 * math.exp(-(((a - 2.2) / 0.35) ** 2)) * math.exp(-(((y - 0.13) / 0.05) ** 2))

    g.add(lathe([(0.0, 0.004), (0.118, 0.004), (0.12, 0.012), (0.158, 0.192), (0.16, 0.2)], 28, "rust", fold=dent, cap_bottom=True, cap_top=False))
    g.add(lathe([(0.153, 0.198), (0.115, 0.012), (0.0, 0.012)], 28, "rust", fold=dent, cap_bottom=False, cap_top=False))
    rim = [(math.sin(TAU * k / 28) * 0.161, 0.2, math.cos(TAU * k / 28) * 0.161) for k in range(28)]
    g.add(tube(rim, 0.006, 6, "iron", closed=True))
    for y, r in ((0.05, 0.13), (0.15, 0.149)):
        band = [(math.sin(TAU * k / 28) * (r + 0.003), y, math.cos(TAU * k / 28) * (r + 0.003)) for k in range(28)]
        g.add(tube(band, 0.004, 4, "iron", closed=True, section=lambda i, j, a: (2.2, 0.6)))
    for s in (-1, 1):
        g.add(box((0.0, 0.18, s * 0.158), (0.03, 0.04, 0.008), "iron"))
    arc = [(0.0, 0.18 + math.sin(math.pi * k / 14) * 0.13, (k / 14 - 0.5) * 0.32) for k in range(15)]
    g.add(tube(arc, 0.004, 6, "iron", caps=(True, True)))
    return g, {"rust": 0.0012, "iron": 0.0006}, ("floor", 0.0)


def link_small(y, ry, rng, wire=0.0068, mat="iron"):
    path = stadium(0.046, 0.0175, 6, 2)
    lg = tube(path, wire, 6, mat, closed=True)
    return lg.xf(T(0, y, 0) @ R("Y", ry))


def sd_chain(rng, n):
    g = Geo()
    g.add(box((0, 0.01, 0), (0.05, 0.02, 0.03), "iron"))
    g.add(tube([(-0.02, 0.0, 0.0), (-0.02, -0.025, 0.0), (0.0, -0.035, 0.0), (0.02, -0.025, 0.0), (0.02, 0.0, 0.0)], 0.005, 6, "iron"))
    for i in range(n):
        g.add(link_small(-0.03 - i * 0.07, (i & 1) * (math.pi / 2) + (rng.random() - 0.5) * 0.25, rng, mat="rust" if i > n - 3 else "iron"))
    return g, {"iron": 0.0005, "rust": 0.0007}, None


def sd_pickaxe(rng):
    g = Geo()
    hnd = [(-0.38 + 0.76 * k / 8, 0.016 + 0.003 * math.sin(k / 8 * math.pi), 0.0) for k in range(9)]
    g.add(tube(hnd, [0.0125 + 0.002 * (k / 8) for k in range(9)], 8, "wood", caps=(True, True), section=lambda i, j, a: (1.0, 1.25)))
    head = []
    for k in range(13):
        t = k / 12
        head.append((0.355 + 0.012 * math.sin(t * math.pi), 0.034 + 0.01 * math.sin(t * math.pi), -0.11 + 0.22 * t))
    rad = [0.002 + 0.013 * math.sin(min(1.0, t * 1.15) * math.pi) ** 0.5 for t in [k / 12 for k in range(13)]]
    g.add(tube(head, rad, 8, "iron", caps=(True, True), section=lambda i, j, a: (1.0, 0.75 if i > 6 else 1.0)))
    g.add(box((0.355, 0.034, 0.0), (0.036, 0.044, 0.05), "iron"))
    g.add(box((0.375, 0.034, 0.0), (0.006, 0.03, 0.02), "wood2"))
    return g, {"wood": 0.001, "iron": 0.0007}, ("floor", 0.0)


def sd_hammer(rng):
    g = Geo()
    g.add(tube([(-0.18 + 0.32 * k / 6, 0.014, 0.0) for k in range(7)], [0.011 + 0.002 * (k / 6) for k in range(7)], 8, "wood", caps=(True, True), section=lambda i, j, a: (1.0, 1.3)))
    g.add(box((0.14, 0.02, 0.0), (0.04, 0.05, 0.1), "iron"))
    g.add(lathe([(0.024, 0.0), (0.026, 0.01), (0.022, 0.016)], 10, "iron").xf(T(0.14, 0.02, 0.05) @ R("X", math.pi / 2)))
    return g, {"wood": 0.001, "iron": 0.0006}, ("floor", 0.0)


def sd_shovel(rng):
    g = Geo()
    g.add(tube([(-0.42 + 0.57 * k / 8, 0.014, 0.0) for k in range(9)], 0.012, 8, "wood", caps=(True, True)))
    blade = Geo()
    outline = [(-0.16, -0.075), (0.02, -0.088), (0.12, -0.07), (0.2, 0.0), (0.12, 0.07), (0.02, 0.088), (-0.16, 0.075)]
    top = [blade.vert((x + 0.3, 0.006 + 0.012 * (1 - (abs(z) / 0.09) ** 2) * 0.5, z)) for x, z in outline]
    bot = [blade.vert((x + 0.3, 0.0 + 0.012 * (1 - (abs(z) / 0.09) ** 2) * 0.5, z)) for x, z in outline]
    blade.face(list(reversed(top)), "rust", True)
    blade.face(bot, "rust", True)
    for i in range(len(outline)):
        j = (i + 1) % len(outline)
        blade.face([bot[i], bot[j], top[j], top[i]], "rust", False)
    g.add(blade)
    g.add(tube([(0.12, 0.014, 0.0), (0.16, 0.012, 0.0)], [0.016, 0.02], 8, "iron", caps=(True, True)))
    return g, {"wood": 0.001, "rust": 0.0008}, ("floor", 0.0)


def sd_crowbar(rng):
    pts = [(-0.3, 0.012, 0.0), (-0.1, 0.012, 0.004), (0.18, 0.012, 0.0), (0.24, 0.016, -0.004), (0.27, 0.03, -0.01), (0.29, 0.05, -0.016), (0.3, 0.07, -0.02)]
    g = tube(pts, [0.009, 0.0095, 0.0095, 0.0095, 0.009, 0.008, 0.006], 6, "iron", caps=(True, True))
    return g, {"iron": 0.0005}, ("floor", 0.0)


def sd_rope_coil(rng):
    g = Geo()
    pts = []
    turns = 2.6
    n = 64
    for k in range(n + 1):
        t = k / n
        a = TAU * turns * t
        r = 0.128 - 0.012 * t
        pts.append((math.cos(a) * r, 0.013 + 0.022 * t + 0.004 * math.sin(a * 0.5), math.sin(a) * r * 0.94))
    tail = [(0.12, 0.014, 0.03), (0.2, 0.012, 0.08), (0.27, 0.01, 0.07), (0.31, 0.008, 0.04)]
    pts = pts + [tuple(Vector(pts[-1]).lerp(Vector(tail[1]), 0.5))] + tail[1:]
    # three twisted strands read as a helical groove: the section radius dips three times per turn of the twist
    g.add(tube(pts, 0.0125, 9, "rope", caps=(True, True), section=lambda i, j, a: (1.0 - 0.12 * max(0.0, math.cos(3 * a - i * 1.4)) ** 2, 1.0 - 0.12 * max(0.0, math.cos(3 * a - i * 1.4)) ** 2)))
    return g, {"rope": 0.0006}, ("floor", 0.0)


def sd_block(rng):
    g = box((0, 0.1, 0), (0.36, 0.22, 0.3), "stone")
    return g, {"stone": 0.007}, ("floor", 0.0)


SD = {
    "skull": sd_skull, "femur": lambda r: sd_femur(r, False), "femurBroken": lambda r: sd_femur(r, True), "rib": sd_rib, "barrel": sd_barrel,
    "crateBroken": sd_crate_broken, "crateSmash": sd_crate_smash, "lantern": sd_lantern, "bucket": sd_bucket,
    "chain4": lambda r: sd_chain(r, 5), "chain7": lambda r: sd_chain(r, 8), "pickaxe": sd_pickaxe, "hammer": sd_hammer, "shovel": sd_shovel,
    "crowbar": sd_crowbar, "ropeCoil": sd_rope_coil, "block": sd_block,
}
# bevel width (m) per template: hard-surface edges catch the lantern
BEVEL = {"barrel": 0.003, "crateBroken": 0.004, "crateSmash": 0.004, "lantern": 0.0015, "bucket": 0.0, "block": 0.014, "pickaxe": 0.002, "hammer": 0.003}


def export_glb(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_vertex_color="ACTIVE", export_all_vertex_colors=False,
        export_image_format="NONE", export_texcoords=True,
    )


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(args.seed)
    only = set(s for s in args.only.split(",") if s)
    objects = []
    stats = {}

    # ---- kit-like parts -------------------------------------------------------------------------------------------------------
    def kit_levels(name, src_geo, mat, weather, far_geo=None, plane=None, bev=0.0, edge=0.0, maxd=0.6, med_geo=None):
        src = make_object(name + "_src", src_geo, [mat])
        if bev > 0:
            bevel(src, bev, 2, 0.5)
        if edge > 0:
            subdivide(src, edge, 120000)
        if weather:
            displace(src, weather)
        hi, med, far = KIT_TRIS[name]
        for lname, target, g in ((name + "_lod0", hi, None), (name, med, med_geo), (name + "_lod2", far, far_geo)):
            if g is not None:
                ob = make_object(lname, g, [mat])
            else:
                ob = clone(src, lname)
                decimate(ob, target)
            bpy.ops.object.select_all(action="DESELECT")
            for p in ob.data.polygons:
                p.use_smooth = True
            bake_kit_ao(ob, args.ao_rays // 2, plane, maxd)
            stats[lname] = tris_of(ob)
            objects.append(ob)
        drop(src)

    if not only or "chainlink" in only:
        rust = wear_fn(5, {"metal": 0.006}, size=0.05, chip=0.012)
        kit_levels("ch1_env_chainlink", chainlink_src(), "metal", rust, far_geo=chainlink_far(), med_geo=chainlink_med(), maxd=0.5)
    if not only or "lanternwright" in only:
        st, ir, gl = lanternwright_src()
        # normalise to the decor box: x, z / 2.2, y / 6.4 (base at -0.5)
        N = S(1 / 2.2, 1 / 6.4, 1 / 2.2)
        stone_w = wear_fn(9, {"stone": 0.025}, size=0.25, chip=0.03)
        kit_levels("ch1_env_lanternwright", st, "stone", stone_w, plane=("floor", -3.2), bev=0.02, edge=0.12, maxd=1.2)
        kit_levels("ch1_env_lanternwright_iron", ir, "metal", wear_fn(4, {"metal": 0.004}, size=0.08), maxd=0.5)
        g = make_object("ch1_env_lanternwright_glow", gl, ["glow"])
        attr = g.data.color_attributes.new(name="Color", type="BYTE_COLOR", domain="POINT")
        for i in range(len(g.data.vertices)):
            attr.data[i].color = (1.0, 1.0, 1.0, 1.0)
        g.data.color_attributes.active_color = attr
        stats[g.name] = tris_of(g)
        objects.append(g)
        for ob in objects:
            if ob.name.startswith("ch1_env_lanternwright"):
                ob.data.transform(Matrix.Diagonal((N[0][0], N[2][2], N[1][1], 1.0)))  # blender axes: x, y (= -three z), z (= three y)
                ob.data.update()

    # ---- scene-detail hero templates -------------------------------------------------------------------------------------------
    for name, fn in SD.items():
        if only and name not in only:
            continue
        r = random.Random(sum(ord(ch) * (k + 1) for k, ch in enumerate(name)) ^ args.seed)  # stable (str hash() is salted per process)
        geo, amps, plane = fn(r)
        mats = sorted(set(m for _i, m, _s in geo.f), key=lambda m: MATS.index(m))
        ob = make_object("ch1_sd_" + name, geo, mats)
        bw = BEVEL.get(name, 0.0)
        if bw > 0:
            bevel(ob, bw, 2, 0.6)
        subdivide(ob, {"block": 0.025, "barrel": 0.07, "crateBroken": 0.03, "crateSmash": 0.03}.get(name, 0.012), 60000)
        pin = (lambda c: c.y < 0.0012) if plane and plane[0] == "floor" else None
        displace(ob, wear_fn(len(name), amps, size=0.012 if name != "block" else 0.04, chip=0.004 if name == "block" else 0.0, pin=pin))
        decimate(ob, PROP_TRIS[name])
        for p in ob.data.polygons:
            p.use_smooth = True
        # auto smooth: split hard creases so planks / boxes keep crisp edges after the decimation
        try:
            bpy.context.view_layer.objects.active = ob
            for o in bpy.context.view_layer.objects:
                o.select_set(o is ob)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        except Exception as ex:
            print("  smooth-by-angle unavailable:", ex)
        bake_prop_colour(ob, args.ao_rays, plane, len(name), paint=PAINT.get(name))
        atlas_uv(ob)
        stats[ob.name] = tris_of(ob)
        objects.append(ob)

    path = os.path.join(args.out, "ch1_props_v2.glb")
    export_glb(objects, path)
    for k in sorted(stats):
        print("  %-34s %6d tris" % (k, stats[k]))
    print("total tris", sum(stats.values()))
    print("wrote", path, os.path.getsize(path), "bytes")
    if args.stats:
        import json

        with open(args.stats, "w") as f:
            json.dump(stats, f, indent=1)


main()
