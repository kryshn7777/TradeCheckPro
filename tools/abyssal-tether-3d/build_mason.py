"""ABYSSAL TETHER 3D — procedural builder for the Mason (the predator).

Builds the creature in Blender from code so it stays reproducible and easy to
tweak, then exports glTF binaries for the WebXR / Quest 3 version:

  mason_kit.glb   modular parts at the origin, one object each, pivots at their
                  joints, for procedural assembly + animation in-engine
  mason_hero.glb  the assembled creature in a crawling pose (preview/cinematics)
  mason_*.png     Cycles preview renders (optional, --render)

Design (original, see the game's README): not an animal with a face. A long
column of masonry blocks bound with corroded iron bands, hauled along walls by
lattice-girder limbs that end in iron hooks; its front is a blunt crenellated
crown that opens into pale sensory fronds around glowing listening pits.

Run (Blender 4.2+/5.x, or the `bpy` Python module):
  blender -b -P build_mason.py -- --out <dir> [--render] [--seed 7]
  python build_mason.py --out <dir> [--render]          # with `pip install bpy`
"""

import argparse
import math
import os
import random
import sys

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh
from mathutils import Matrix, Vector

# -----------------------------------------------------------------------------
# Arguments
# -----------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.getcwd(), "mason_out"))
ap.add_argument("--render", action="store_true", help="render Cycles previews")
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--res", default="1280x720")
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--rock", default="", help="optional rock albedo texture for the preview wall")
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)
rng = random.Random(args.seed)

# Dimensions in metres. The creature is ~24 m long.
SEGMENTS = 18
SEG_LEN = 1.25
SEG_W = 1.7
SEG_H = 1.25
LIMB_UPPER = 3.3
LIMB_LOWER = 3.8
# Irregular, front-weighted limb placement (segment index, side) — independent
# limbs, not one pair per segment.
LIMB_SLOTS = [(1, 1), (2, -1), (3, 1), (5, -1), (6, 1), (8, -1), (9, 1), (11, -1), (13, 1), (14, -1)]
FRONDS = 10
PITS = 5


# -----------------------------------------------------------------------------
# Scene + materials (glTF-friendly Principled BSDF values)
# -----------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def principled(name, base, metallic=0.0, roughness=0.8, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True  # no-op / deprecated on Blender 5.x
    except Exception:
        pass
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    mat.diffuse_color = (*base, 1.0)
    return mat


def make_materials():
    return {
        "stone_dark": principled("Mason_StoneDark", (0.045, 0.044, 0.043), roughness=0.94),
        "stone_mid": principled("Mason_StoneMid", (0.085, 0.082, 0.077), roughness=0.92),
        "stone_pale": principled("Mason_StonePale", (0.15, 0.145, 0.13), roughness=0.9),
        "rust": principled("Mason_Rust", (0.15, 0.07, 0.035), metallic=0.45, roughness=0.8),
        "iron": principled("Mason_Iron", (0.05, 0.05, 0.055), metallic=0.85, roughness=0.5),
        "verdigris": principled("Mason_Verdigris", (0.16, 0.30, 0.27), metallic=0.3, roughness=0.65),
        "frond": principled("Mason_Frond", (0.62, 0.66, 0.6), roughness=0.55,
                            emission=(0.45, 0.62, 0.57), strength=0.25),
        "glow": principled("Mason_SensoryGlow", (0.05, 0.08, 0.07), roughness=0.4,
                           emission=(0.72, 0.94, 0.88), strength=5.0),
    }


# -----------------------------------------------------------------------------
# Geometry helpers. Each part accumulates pieces into one bmesh with material
# indices, so every exported part is a single object with several materials.
# -----------------------------------------------------------------------------
class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def add(self, piece, mat, matrix=None, smooth=False):
        if matrix is not None:
            bmesh.ops.transform(piece, matrix=matrix, verts=piece.verts)
        if mat not in self.mats:
            self.mats.append(mat)
        idx = self.mats.index(mat)
        for f in piece.faces:
            f.material_index = idx
            f.smooth = smooth
        tmp = bpy.data.meshes.new("_tmp")
        piece.to_mesh(tmp)
        piece.free()
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    def build(self, collection, location=(0, 0, 0)):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        ob.location = location
        collection.objects.link(ob)
        return ob


def box(sx, sy, sz, bevel=0.0, segments=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES", profile=0.5)
    return bm


def cylinder(radius, depth, sides=8, radius2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides,
                          radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
    return bm


def torus_link(major, minor, sides=8, rings=6):
    bm = bmesh.new()
    verts = []
    for i in range(sides):
        a = i / sides * math.tau
        ring = []
        for j in range(rings):
            b = j / rings * math.tau
            r = major + minor * math.cos(b)
            # slightly oval link
            ring.append(bm.verts.new((r * math.cos(a) * 1.35, minor * math.sin(b), r * math.sin(a))))
        verts.append(ring)
    for i in range(sides):
        for j in range(rings):
            a = verts[i][j]
            b = verts[(i + 1) % sides][j]
            c = verts[(i + 1) % sides][(j + 1) % rings]
            d = verts[i][(j + 1) % rings]
            bm.faces.new((a, b, c, d))
    return bm


def tube_along(points, radii, sides=8):
    """Tapered tube through 3D points (list of Vector) with per-point radius."""
    bm = bmesh.new()
    rings = []
    n = len(points)
    for i, p in enumerate(points):
        t = (points[min(i + 1, n - 1)] - points[max(i - 1, 0)]).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(ref).normalized()
        w = t.cross(u).normalized()
        ring = []
        for k in range(sides):
            a = k / sides * math.tau
            ring.append(bm.verts.new(p + (u * math.cos(a) + w * math.sin(a)) * radii[i]))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    tip = bm.verts.new(points[-1] + (points[-1] - points[-2]).normalized() * radii[-1] * 1.5)
    for k in range(sides):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % sides], tip))
    return bm


def curl(length, turns, start_dir, bend_axis, steps=14, r0=0.08, r1=0.012, wobble=0.0):
    """Points + radii for a curling, tapering filament (frond or hook)."""
    pts = []
    radii = []
    d = start_dir.normalized()
    p = Vector((0, 0, 0))
    seg = length / steps
    total = turns * math.tau
    for i in range(steps + 1):
        f = i / steps
        pts.append(p.copy())
        radii.append(r0 + (r1 - r0) * (f ** 0.8))
        rot = Matrix.Rotation(total / steps * (0.25 + 1.5 * f), 3, bend_axis)
        d = (rot @ d).normalized()
        if wobble:
            d = (d + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * wobble).normalized()
        p = p + d * seg
    return pts, radii


def frame(forward, up):
    """Rotation matrix whose +Y = forward, +Z = up (orthonormalised)."""
    f = forward.normalized()
    r = f.cross(up).normalized()
    u = r.cross(f).normalized()
    return Matrix((r, f, u)).transposed().to_4x4()


# -----------------------------------------------------------------------------
# Parts (local space: spine runs along +Y = towards the head, +Z = dorsal)
# -----------------------------------------------------------------------------
def build_segment(M, name, scale=1.0, variant=0):
    p = Part(name)
    w, l, h = SEG_W * scale, SEG_LEN * scale, SEG_H * scale
    stone = [M["stone_mid"], M["stone_dark"], M["stone_pale"]][variant % 3]
    # Core masonry block, slightly wedge-shaped so the column reads as built, not grown.
    core = box(w, l * 0.92, h, bevel=0.07 * scale, segments=2)
    for v in core.verts:
        if v.co.z < 0:
            v.co.x *= 0.82
    p.add(core, stone)
    # Ventral keel stones.
    for sx in (-1, 1):
        keel = box(w * 0.34, l * 0.8, h * 0.32, bevel=0.04 * scale)
        p.add(keel, M["stone_dark"], Matrix.Translation((sx * w * 0.26, 0, -h * 0.55)) @ Matrix.Rotation(sx * 0.35, 4, "Y"))
    # Iron band with rivets.
    band = box(w * 1.07, l * 0.24, h * 1.07, bevel=0.02 * scale)
    p.add(band, M["rust"], Matrix.Translation((0, l * 0.18, 0)))
    for k in range(5):
        a = (k / 4 - 0.5) * 2.4
        pos = Vector((math.sin(a) * w * 0.54, l * 0.18 + l * 0.125, math.cos(a) * h * 0.5))
        p.add(cylinder(0.045 * scale, 0.05 * scale, 6), M["iron"], Matrix.Translation(pos) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    # Dorsal roof slab overlapping the next block toward the tail, like laid roof stones.
    roof = box(w * 0.94, l * 0.62, h * 0.14, bevel=0.03 * scale)
    p.add(roof, stone, Matrix.Translation((0, -l * 0.42, h * 0.5)) @ Matrix.Rotation(-0.12, 4, "X"))
    # Crenellated dorsal parapet (architectural silhouette, not chitin).
    merlons = 2 + (variant % 2)
    for k in range(merlons):
        x = (k - (merlons - 1) / 2) * w * 0.32
        m = box(w * 0.2, l * 0.42, h * 0.28, bevel=0.025 * scale)
        p.add(m, M["stone_pale"], Matrix.Translation((x, -l * 0.15, h * 0.62)))
    # Verdigris trim along the flanks.
    for sx in (-1, 1):
        trim = box(0.06 * scale, l * 0.86, 0.08 * scale)
        p.add(trim, M["verdigris"], Matrix.Translation((sx * w * 0.5, 0, h * 0.18)))
    # Occasional rebar jutting from broken masonry.
    if variant == 1:
        for k in range(3):
            rb = cylinder(0.03 * scale, 0.9 * scale, 5)
            tilt = Matrix.Rotation(rng.uniform(-0.6, 0.6), 4, "X") @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, "Y")
            p.add(rb, M["iron"], Matrix.Translation((rng.uniform(-0.4, 0.4) * w, rng.uniform(-0.3, 0.3) * l, h * 0.7)) @ tilt)
    return p


def build_tail(M, name):
    p = build_segment(M, name, scale=0.62, variant=2)
    # Dragging chain links.
    for k in range(5):
        link = torus_link(0.09, 0.025)
        rot = Matrix.Rotation(math.pi / 2 * (k % 2), 4, "Y")
        p.add(link, M["iron"], Matrix.Translation((0.25, -0.5 - k * 0.2, -0.45 - k * 0.05)) @ rot)
    return p


def build_head(M, name):
    """Blunt crenellated crown; fronds and pits are separate parts so they can animate."""
    p = Part(name)
    w, l, h = SEG_W * 1.25, SEG_LEN * 1.3, SEG_H * 1.2
    core = box(w, l, h, bevel=0.1, segments=2)
    for v in core.verts:
        if v.co.y > 0:  # taper toward the front face
            v.co.x *= 0.86
            v.co.z *= 0.86
    p.add(core, M["stone_mid"])
    # Crown rim of merlons around the front face.
    for k in range(10):
        a = k / 10 * math.tau
        pos = (math.cos(a) * w * 0.47, l * 0.55, math.sin(a) * h * 0.45)
        m = box(0.26, 0.34, 0.26, bevel=0.03)
        p.add(m, M["stone_pale"], Matrix.Translation(pos) @ Matrix.Rotation(a, 4, "Y"))
    # Iron collar.
    collar = box(w * 1.06, 0.3, h * 1.06, bevel=0.02)
    p.add(collar, M["rust"], Matrix.Translation((0, -l * 0.3, 0)))
    # Dark recessed face plate (the "mouth" is a void, not a jaw).
    face = box(w * 0.66, 0.12, h * 0.62, bevel=0.03)
    p.add(face, M["iron"], Matrix.Translation((0, l * 0.5, 0)))
    return p


def build_frond(M, name, seed_offset=0):
    p = Part(name)
    local = random.Random(args.seed * 31 + seed_offset)
    length = 2.2 + local.uniform(-0.3, 0.5)
    pts, radii = curl(length, 0.32 + local.uniform(0, 0.12), Vector((0, 1, 0.15)), Vector((1, 0, 0)), steps=16, r0=0.085, r1=0.014)
    p.add(tube_along(pts, radii, sides=7), M["frond"], smooth=True)
    # Barbs along the frond.
    for i in range(3, len(pts) - 3, 3):
        t = (pts[i + 1] - pts[i]).normalized()
        side = t.cross(Vector((1, 0, 0))).normalized()
        bp = [pts[i], pts[i] + side * 0.16 + t * 0.06, pts[i] + side * 0.26 + t * 0.16]
        p.add(tube_along(bp, [0.02, 0.012, 0.004], sides=5), M["frond"], smooth=True)
    # Glowing tip.
    tip = bmesh.new()
    bmesh.ops.create_icosphere(tip, subdivisions=1, radius=0.05)
    p.add(tip, M["glow"], Matrix.Translation(pts[-1]), smooth=True)
    return p


def build_pit(M, name):
    p = Part(name)
    rim = cylinder(0.13, 0.2, 8, radius2=0.09)
    p.add(rim, M["iron"], Matrix.Rotation(math.pi / 2, 4, "X"))
    orb = bmesh.new()
    bmesh.ops.create_icosphere(orb, subdivisions=1, radius=0.055)
    p.add(orb, M["glow"], Matrix.Translation((0, -0.03, 0)), smooth=True)
    return p


def build_girder(M, name, length, thick=0.11, depth=0.34):
    """Lattice girder bone along +Z from 0 to length, with joint pins at both ends."""
    p = Part(name)
    for sx in (-1, 1):
        chord = box(thick, thick, length, bevel=0.012)
        p.add(chord, M["rust"], Matrix.Translation((sx * depth / 2, 0, length / 2)))
    n = 5
    for k in range(n):
        z0 = length * k / n
        z1 = length * (k + 1) / n
        a = Vector((-depth / 2 if k % 2 == 0 else depth / 2, 0, z0))
        b = Vector((depth / 2 if k % 2 == 0 else -depth / 2, 0, z1))
        mid = (a + b) / 2
        d = b - a
        brace = box(thick * 0.55, thick * 0.55, d.length)
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        p.add(brace, M["iron"], Matrix.Translation(mid) @ rot)
    for z in (0, length):
        pin = cylinder(thick * 0.9, depth + 0.16, 8)
        p.add(pin, M["iron"], Matrix.Translation((0, 0, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    return p


def build_hook(M, name):
    p = Part(name)
    pts, radii = curl(1.1, 0.42, Vector((0, 0, 1)), Vector((1, 0, 0)), steps=14, r0=0.11, r1=0.01)
    p.add(tube_along(pts, radii, sides=8), M["iron"], smooth=True)
    return p


# -----------------------------------------------------------------------------
# Assembly (hero pose): crawling head-first down a wall, crown turned outward.
# -----------------------------------------------------------------------------
def spine_point(s):
    """s = 0 at the head, 1 at the tail. The wall is the plane y = WALL_Y; the body arches off it."""
    x = 2.4 * math.sin(s * math.pi * 1.55 + 0.35)
    y = -0.6 + 1.6 * math.sin(s * math.pi) * (1.0 - 0.35 * s)
    z = s * 19.0
    return Vector((x, y, z))


_ARC = []


def arc_point(length):
    """Point / parameter at an arc length from the head (table built on first use)."""
    if not _ARC:
        prev = spine_point(0.0)
        total = 0.0
        _ARC.append((0.0, 0.0))
        for k in range(1, 2001):
            s = k / 2000
            pt = spine_point(s)
            total += (pt - prev).length
            _ARC.append((total, s))
            prev = pt
    for k in range(1, len(_ARC)):
        if _ARC[k][0] >= length:
            l0, s0 = _ARC[k - 1]
            l1, s1 = _ARC[k]
            f = (length - l0) / max(l1 - l0, 1e-9)
            s = s0 + (s1 - s0) * f
            return spine_point(s), s
    return spine_point(1.0), 1.0


WALL_Y = -3.2


def solve_two_bone(hip, foot, l1, l2, pole):
    d = foot - hip
    dist = min(d.length, (l1 + l2) * 0.999)
    dn = d.normalized()
    a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    a = max(-1.0, min(1.0, a))
    along = l1 * a
    perp = math.sqrt(max(0.0, l1 * l1 - along * along))
    pv = (pole - dn * pole.dot(dn)).normalized()
    return hip + dn * along + pv * perp


def place(obj, origin, rot):
    obj.matrix_world = Matrix.Translation(origin) @ rot


def assemble_hero(M, coll, kit):
    objs = []
    n = SEGMENTS
    seg_s = []
    arc = SEG_LEN * 0.55
    for i in range(n):
        scale = 1.0 - 0.38 * (i / n) ** 1.6
        arc += SEG_LEN * scale * 0.86 * 0.5
        pos, s = arc_point(arc)
        arc += SEG_LEN * scale * 0.86 * 0.5
        seg_s.append(s)
        fwd = spine_point(s - 0.01) - spine_point(s + 0.01)
        up = Vector((0, 1, 0))  # dorsal side faces away from the wall
        rot = frame(fwd, up)
        src = kit["Mason_Tail"] if i == n - 1 else kit[f"Mason_Segment_{i % 3}"]
        ob = src.copy()
        ob.data = src.data
        ob.name = f"Hero_Seg_{i:02d}"
        coll.objects.link(ob)
        place(ob, pos, rot @ Matrix.Scale(scale if i < n - 1 else 1.0, 4))
        objs.append(ob)
    # Head + crown.
    hfwd = (spine_point(0.0) - spine_point(0.04)).normalized()
    hpos = spine_point(0.0) - hfwd * 0.25  # seated against the first block
    hfwd = (hfwd + Vector((0.12, 0.42, 0))).normalized()  # crown lifts off the wall, toward the light
    hrot = frame(hfwd, Vector((0, 0, 1)))
    head = kit["Mason_Head"].copy()
    head.data = kit["Mason_Head"].data
    head.name = "Hero_Head"
    coll.objects.link(head)
    place(head, hpos, hrot)
    objs.append(head)
    front = hpos + hfwd * (SEG_LEN * 0.68)
    hr = hrot.to_3x3()
    right, up = hr.col[0], hr.col[2]
    for k in range(FRONDS):
        a = k / FRONDS * math.tau + 0.2
        radial = right * math.cos(a) + up * math.sin(a)
        fr = kit["Mason_Frond_" + str(k % 3)].copy()
        fr.data = kit["Mason_Frond_" + str(k % 3)].data
        fr.name = f"Hero_Frond_{k}"
        coll.objects.link(fr)
        # Frond grows along local +Y and curls about local +X: point it outward and forward.
        out = (hfwd * 0.55 + radial).normalized()
        place(fr, front + radial * 0.62, frame(out, hfwd.cross(radial).normalized().cross(out)))
        objs.append(fr)
    for k in range(PITS):
        a = (k + 0.37) / PITS * math.tau + 0.2
        radial = right * math.cos(a) + up * math.sin(a)
        pit = kit["Mason_Pit"].copy()
        pit.data = kit["Mason_Pit"].data
        pit.name = f"Hero_Pit_{k}"
        coll.objects.link(pit)
        place(pit, front + radial * 0.78 - hfwd * 0.05, frame(hfwd, up))
        objs.append(pit)
    # Limbs: hips on the flanks, feet planted on the wall behind.
    for idx, (seg, side) in enumerate(LIMB_SLOTS):
        s = seg_s[seg]
        pos = spine_point(s)
        fwd = (spine_point(s - 0.02) - spine_point(s + 0.02)).normalized()
        rot = frame(fwd, Vector((0, 1, 0))).to_3x3()
        right = rot.col[0]
        scale = 1.0 - 0.38 * (seg / n) ** 1.6
        hip = pos + right * side * SEG_W * 0.5 * scale
        reach = 3.4 + 0.5 * math.sin(idx * 1.7)
        foot = Vector((hip.x + side * right.x * reach + fwd.x * 1.2 * math.sin(idx), WALL_Y, hip.z + fwd.z * 1.6 + 0.8 * math.cos(idx * 2.1)))
        pole = right * side * 0.6 + Vector((0, 2.4, 0))  # knees arch away from the wall
        knee = solve_two_bone(hip, foot, LIMB_UPPER, LIMB_LOWER, pole)
        for bone_name, a, b in (("Mason_LimbUpper", hip, knee), ("Mason_LimbLower", knee, foot)):
            src = kit[bone_name]
            ob = src.copy()
            ob.data = src.data
            ob.name = f"Hero_{bone_name[6:]}_{idx}"
            coll.objects.link(ob)
            d = (b - a).normalized()
            r = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
            place(ob, a, r)
            objs.append(ob)
        hook = kit["Mason_Hook"].copy()
        hook.data = kit["Mason_Hook"].data
        hook.name = f"Hero_Hook_{idx}"
        coll.objects.link(hook)
        d = (foot - knee).normalized()
        place(hook, foot, Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4())
        objs.append(hook)
    return objs


# -----------------------------------------------------------------------------
# Export + preview
# -----------------------------------------------------------------------------
def export_glb(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)


def preview_scene(scene, hero_objs):
    world = bpy.data.worlds.new("Abyss")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.012, 0.016, 0.018, 1)
        bg.inputs[1].default_value = 1.0
    # Wall behind the creature.
    bm = box(90, 0.6, 70)
    wall_mat = principled("Preview_Wall", (0.07, 0.07, 0.068), roughness=0.95)
    if args.rock and os.path.exists(args.rock):
        tex = wall_mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(args.rock)
        mapping = wall_mat.node_tree.nodes.new("ShaderNodeMapping")
        coord = wall_mat.node_tree.nodes.new("ShaderNodeTexCoord")
        mapping.inputs["Scale"].default_value = (6, 6, 6)
        wall_mat.node_tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
        wall_mat.node_tree.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        bsdf = next(n for n in wall_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        wall_mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    p = Part("Preview_Wall")
    p.add(bm, wall_mat)
    p.build(scene.collection, location=(0, WALL_Y - 0.3, 10))
    # Lights: warm lantern near the viewer, cold shaft light from above, faint fill.
    def light(name, kind, loc, energy, color, size=0.5):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = color
        if hasattr(ld, "shadow_soft_size"):
            ld.shadow_soft_size = size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        scene.collection.objects.link(ob)
        return ob
    light("Lantern", "POINT", (6.0, 8.0, -1.5), 2400, (1.0, 0.68, 0.36), 0.3)
    light("ShaftLight", "AREA", (0.0, 2.0, 28.0), 9000, (0.5, 0.72, 0.85), 6.0)
    light("Fill", "POINT", (-8.0, 6.0, 8.0), 600, (0.4, 0.5, 0.6), 2.0)
    # Cameras: a close hero angle on the crown and a full-body overview.
    def camera(name, loc, target, lens):
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        ob = bpy.data.objects.new(name, cd)
        ob.location = loc
        ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
        return ob
    cam = camera("CamHero", (11.0, 10.5, -3.0), (0.5, -0.6, 3.2), 28)
    camera("CamFull", (17.0, 17.5, 4.0), (0.0, -1.0, 8.5), 28)
    scene.camera = cam
    # Render settings.
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass
    w, h = (int(v) for v in args.res.split("x"))
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.film_transparent = False
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    return cam


def main():
    scene = reset_scene()
    M = make_materials()
    kit_coll = bpy.data.collections.new("MasonKit")
    scene.collection.children.link(kit_coll)
    hero_coll = bpy.data.collections.new("MasonHero")
    scene.collection.children.link(hero_coll)

    kit = {}
    for v in range(3):
        kit[f"Mason_Segment_{v}"] = build_segment(M, f"Mason_Segment_{v}", variant=v).build(kit_coll)
    kit["Mason_Tail"] = build_tail(M, "Mason_Tail").build(kit_coll)
    kit["Mason_Head"] = build_head(M, "Mason_Head").build(kit_coll)
    for v in range(3):
        kit[f"Mason_Frond_{v}"] = build_frond(M, f"Mason_Frond_{v}", seed_offset=v).build(kit_coll)
    kit["Mason_Pit"] = build_pit(M, "Mason_Pit").build(kit_coll)
    kit["Mason_LimbUpper"] = build_girder(M, "Mason_LimbUpper", LIMB_UPPER).build(kit_coll)
    kit["Mason_LimbLower"] = build_girder(M, "Mason_LimbLower", LIMB_LOWER, thick=0.095, depth=0.28).build(kit_coll)
    kit["Mason_Hook"] = build_hook(M, "Mason_Hook").build(kit_coll)

    # Lay the kit out in a row for inspection (each part keeps its pivot at its own origin).
    for i, ob in enumerate(kit.values()):
        ob.location = (i * 3.0 - 20, 30, 0)

    hero = assemble_hero(M, hero_coll, kit)

    tri_count = 0
    for ob in hero:
        me = ob.data
        me.calc_loop_triangles()
        tri_count += len(me.loop_triangles)
    print(f"[mason] hero objects={len(hero)} triangles={tri_count}")

    kit_objs = list(kit.values())
    saved = [ob.location.copy() for ob in kit_objs]
    for ob in kit_objs:
        ob.location = (0, 0, 0)
    export_glb(kit_objs, os.path.join(args.out, "mason_kit.glb"))
    for ob, loc in zip(kit_objs, saved):
        ob.location = loc
    export_glb(hero, os.path.join(args.out, "mason_hero.glb"))
    print(f"[mason] exported {args.out}/mason_kit.glb and mason_hero.glb")

    if args.render:
        for ob in kit_objs:
            ob.hide_render = True
        preview_scene(scene, hero)
        for cam_name, fname in (("CamHero", "mason_hero.png"), ("CamFull", "mason_full.png")):
            scene.camera = bpy.data.objects[cam_name]
            scene.render.filepath = os.path.join(args.out, fname)
            bpy.ops.render.render(write_still=True)
            print(f"[mason] rendered {scene.render.filepath}")


main()
