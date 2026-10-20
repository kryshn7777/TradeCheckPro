"""ABYSSAL TETHER 3D — procedural builder for the player's arms + grapple launchers.

Builds, in Blender, from code (deterministic, no hand-sculpting):

  * ARMS — a heavy leather work glove + waxed-canvas sleeve to just past the
    elbow, one skinned mesh per side on a 17-bone armature (Forearm, Hand,
    3 bones per finger + thumb), weights solved geometrically per joint so the
    knuckles bend cleanly, and four pose clips per side (Open, Grip, Trigger,
    Point) fitted to the launcher's handle and trigger lever.
  * LAUNCHERS — a Lanternwright tether launcher strapped over each forearm:
    machined brass + blued iron, cable drum with wound cable, fairlead rollers,
    a slotted spring/pneumatic firing chamber, pressure reservoir, a gauge with
    a separate needle, a barbed grapple head seated in the muzzle, a trigger
    lever in front of a leather-wrapped handle, leather straps + buckles, rivets,
    screws, knurling. Moving parts are bones of a small rig per side (Drum,
    Needle, Trigger, Slide, Head) so each launcher is ONE draw call.
  * A carried LANTERN (hangs from the launcher's hook) and a loose GRAPPLE HEAD
    prop (for the projectile / the anchored head).

  Pipeline: model HIGH (bevels, subdivision, voxel-remeshed glove with
  wrinkles, stitched seams, palm patch, procedural leather/metal shading) and
  LOW game meshes, then bake high → low into one shared 2048² atlas used by
  both sides (mirrored UVs): albedo (sRGB), normal (OpenGL, MikkTSpace),
  ORM (R = AO, G = roughness, B = metalness) and an emissive mask (pilot lamp,
  gauge phosphor, lantern glass), all tinted/driven at runtime. LOD1 ≈ 40 %.

Output (see tools/abyssal-tether-3d/README.md for node names, pivots, axes):
  <out>/player_arms.glb
  <renders>/*.png           Cycles renders of the GAME meshes with baked maps

Coordinates: everything is authored in the game's HAND-SOCKET frame (see
src/input/inputManager.js): Blender +Y = barrel / aim (glTF −Z), +Z = up
(glTF +Y), origin = the fist centroid on the launcher handle. Parent each
side's root node ("Arm_R" / "Arm_L") to input.handSocket(hand) with an
identity transform.

Run (Blender 5.x or the `bpy` module, 4 CPUs: a full build ≈ 15–30 min):
  python build_hands.py --out public/abyssal-tether-3d/assets/models \
      --renders <dir> [--render] [--samples 48] [--res 1280x720] [--bake 2048]
  blender -b -P build_hands.py -- <same args>
"""

import argparse
import math
import os
import random
import sys
import time

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# -----------------------------------------------------------------------------
# Arguments
# -----------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.getcwd(), "arms_out"), help="directory for player_arms.glb")
ap.add_argument("--renders", default="", help="directory for the Cycles renders (default: <out>)")
ap.add_argument("--render", action="store_true", help="render the Cycles previews")
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--res", default="1280x720")
ap.add_argument("--bake", type=int, default=2048, help="atlas size (px)")
ap.add_argument("--bake-samples", type=int, default=24, help="AO bake samples")
ap.add_argument("--seed", type=int, default=11)
ap.add_argument("--stage", default="all", help="dev: 'shape' renders clay previews only (no bake/export)")
ap.add_argument("--only", default="", help="dev: comma list of renders to make (fp,mech,turn,poses)")
ap.add_argument("--blend", default="", help="dev: save the built .blend here")
ap.add_argument("--cache", default="", help="bake cache dir (default: <renders>/_cache); delete it after geometry changes")
args = ap.parse_args(argv)
args.out = os.path.abspath(args.out)  # Blender rewrites relative image paths after a save
os.makedirs(args.out, exist_ok=True)
RENDER_DIR = os.path.abspath(args.renders or args.out)
os.makedirs(RENDER_DIR, exist_ok=True)
CACHE_DIR = os.path.abspath(args.cache or os.path.join(RENDER_DIR, "_cache"))
if args.blend:
    args.blend = os.path.abspath(args.blend)
T0 = time.time()


def log(*a):
    print(f"[hands {time.time() - T0:6.1f}s]", *a, flush=True)


# -----------------------------------------------------------------------------
# Frames
# -----------------------------------------------------------------------------
# HAND space (right hand; modelling only): origin = wrist joint centre,
#   +Y toward the fingers, +Z thumb side (radial), +X back of the hand (dorsal);
#   the palm faces −X. The forearm runs along −Y.
# SOCKET space (export): +Y aim, +Z up, origin = centre of the fist on the
#   handle. socket = ROT · (hand − HANDLE_C): the forearm drops THETA below the
#   aim, which is how a controller is naturally held (hand above the elbow).
THETA = math.radians(10.0)
HANDLE_C = Vector((-0.0335, 0.0705, 0.0))  # handle axis × middle-finger plane (hand space)
HANDLE_RAKE = math.radians(16.0)  # handle top leans toward the fingers (hand space)
HANDLE_R = 0.0170  # leather-wrapped handle radius
ROT = Matrix.Rotation(THETA, 4, "X")
S_MAT = ROT @ Matrix.Translation(-HANDLE_C)  # hand → socket
S_INV = S_MAT.inverted()


def S(v):
    """hand-space point → socket space."""
    return S_MAT @ Vector(v)


def SD(v):
    """hand-space direction → socket space."""
    return (ROT.to_3x3() @ Vector(v)).normalized()


HANDLE_DIR_H = Vector((0.0, math.sin(HANDLE_RAKE), math.cos(HANDLE_RAKE)))  # toward the thumb
HANDLE_DIR = SD(HANDLE_DIR_H)  # socket space (≈ 6° forward of vertical)

# Barrel / muzzle (socket space). Input's muzzle (rope origin) should match
# MUZZLE (x, z, −y in glTF): see the report / README.
BARREL_Z = 0.074
MUZZLE_Y = 0.172
MUZZLE = Vector((0.0, MUZZLE_Y, BARREL_Z))

# -----------------------------------------------------------------------------
# Hand skeleton (hand space, right hand), sized for a large gloved hand
# -----------------------------------------------------------------------------
# mcp: knuckle joint centre; L: phalanx lengths (last = to the tip);
# r: tube radius at MCP, PIP, DIP, tip (leather included); spread: degrees
# about the palm normal (+ toward the thumb).
FINGERS = {
    "Index": dict(mcp=(0.0040, 0.0935, 0.0300), L=(0.0460, 0.0270, 0.0235), r=(0.0101, 0.0094, 0.0086, 0.0079), spread=8.0),
    "Middle": dict(mcp=(0.0050, 0.0965, 0.0095), L=(0.0500, 0.0310, 0.0245), r=(0.0105, 0.0097, 0.0089, 0.0081), spread=1.5),
    "Ring": dict(mcp=(0.0040, 0.0910, -0.0105), L=(0.0470, 0.0300, 0.0235), r=(0.0099, 0.0092, 0.0085, 0.0077), spread=-6.0),
    "Pinky": dict(mcp=(0.0020, 0.0810, -0.0285), L=(0.0370, 0.0225, 0.0215), r=(0.0089, 0.0083, 0.0077, 0.0070), spread=-14.0),
}
FINGER_ORDER = ["Thumb", "Index", "Middle", "Ring", "Pinky"]
# Thumb: CMC joint, rest direction of the metacarpal, its pad direction.
THUMB = dict(
    cmc=(-0.0060, 0.0170, 0.0215),
    dir=(-0.30, 0.78, 0.55),
    pad=(-0.75, -0.05, -0.66),
    L=(0.0440, 0.0330, 0.0280),
    r=(0.0140, 0.0122, 0.0112, 0.0099),
)
WRIST = Vector((0.0, 0.0, 0.0))
ELBOW = Vector((0.0015, -0.272, -0.004))
# Rest (bind) pose curls per joint (deg): a relaxed, slightly open hand.
REST_CURL = {"Index": (6, 9, 5), "Middle": (7, 11, 6), "Ring": (8, 12, 6), "Pinky": (9, 13, 7), "Thumb": (0, 6, 6)}


def finger_frames(name, curls, spread_extra=0.0):
    """Joint positions + per-bone frames (Y along the bone, Z palmar, X = flexion axis)
    for curl angles (deg) about each joint. Returns (joints[4], frames[3])."""
    if name == "Thumb":
        d0 = Vector(THUMB["dir"]).normalized()
        pad = Vector(THUMB["pad"])
        pad = (pad - d0 * pad.dot(d0)).normalized()
        p0 = Vector(THUMB["cmc"])
        L = THUMB["L"]
    else:
        F = FINGERS[name]
        spread = math.radians(F["spread"] + spread_extra)
        d0 = Matrix.Rotation(spread, 3, "X") @ Vector((0.0, 1.0, 0.0))
        pad = Vector((-1.0, 0.0, 0.0))
        p0 = Vector(F["mcp"])
        L = F["L"]
    flex_axis = d0.cross(pad).normalized()  # local X
    joints = [p0.copy()]
    frames = []
    d = d0.copy()
    z = pad.copy()
    for i in range(3):
        R = Matrix.Rotation(math.radians(curls[i]), 3, flex_axis)
        d = (R @ d).normalized()
        z = (R @ z).normalized()
        frames.append((flex_axis.copy(), d.copy(), z.copy()))
        joints.append(joints[-1] + d * L[i])
    return joints, frames


# -----------------------------------------------------------------------------
# Grip fit: curl each finger around the handle (or the trigger lever)
# -----------------------------------------------------------------------------
def _plane_point(name, line_p, line_d):
    """Intersection of a line with the finger's flexion plane, in plane coords (u, v)."""
    joints, frames = finger_frames(name, (0, 0, 0))
    X, Y, Z = frames[0]
    p0 = joints[0]
    t = (p0 - line_p).dot(X) / line_d.dot(X)
    c = line_p + line_d * t
    rel = c - p0
    return (rel.dot(Y), -rel.dot(Z))


def fit_curl(name, centre_uv, R, weights=(0.25, 1.0, 1.0), ranges=((0, 100), (0, 110), (0, 85)), step=1.5):
    """Grid-search curl angles (deg) so the finger wraps a cylinder of radius R at
    centre_uv (plane coords: u along the finger, v dorsal). Penetration costs 40×."""
    if name == "Thumb":
        L, rf = THUMB["L"], THUMB["r"]
    else:
        L, rf = FINGERS[name]["L"], FINGERS[name]["r"]
    import numpy as np
    cu, cv = centre_uv
    A1 = np.arange(ranges[0][0], ranges[0][1] + 1e-9, step)
    A2 = np.arange(ranges[1][0], ranges[1][1] + 1e-9, step)
    A3 = np.arange(ranges[2][0], ranges[2][1] + 1e-9, step)
    g1, g2, g3 = np.meshgrid(np.radians(A1), np.radians(A2), np.radians(A3), indexing="ij")
    r1, r2, r3 = g1, g1 + g2, g1 + g2 + g3
    x1, y1 = L[0] * np.cos(r1), -L[0] * np.sin(r1)
    x2, y2 = x1 + L[1] * np.cos(r2), y1 - L[1] * np.sin(r2)
    x3, y3 = x2 + L[2] * np.cos(r3), y2 - L[2] * np.sin(r3)
    pts = ((np.zeros_like(r1), np.zeros_like(r1)), (x1, y1), (x2, y2), (x3, y3))
    cost = np.zeros_like(r1)
    for i in range(3):
        for t in ((0.25, 0.5, 0.75, 1.0) if i == 0 else (0.0, 0.33, 0.66, 1.0)):
            qx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t
            qy = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
            e = np.hypot(qx - cu, qy - cv) - (R + rf[i] + (rf[i + 1] - rf[i]) * t)
            cost += weights[i] * np.where(e > 0, e * e, 40.0 * e * e)
    k = np.unravel_index(np.argmin(cost), cost.shape)
    return (float(A1[k[0]]), float(A2[k[1]]), float(A3[k[2]])), float(cost[k])


# Trigger lever (socket space): a rod parallel to the handle, LEVER_AHEAD in
# front of the handle axis, pivot at the frame above the index finger.
LEVER_AHEAD = 0.0335
LEVER_PULL = 0.0085  # how far the lever's grip line moves back when squeezed
LEVER_R = 0.0052


def solve_poses():
    """Returns {pose: {finger: (a1, a2, a3)}} total curls (deg) + spread extras."""
    hc = HANDLE_C
    hd = HANDLE_DIR_H
    poses = {"Open": {}, "Grip": {}, "Trigger": {}, "Point": {}}
    # hand-space lever line (rest and pulled): offset along the socket +Y, i.e. ROT⁻¹·Y in hand space
    fwd_h = (ROT.to_3x3().inverted() @ Vector((0.0, 1.0, 0.0))).normalized()
    for name in ("Middle", "Ring", "Pinky"):
        uv = _plane_point(name, hc, hd)
        (a1, a2, a3), c = fit_curl(name, uv, HANDLE_R)
        poses["Grip"][name] = (a1, a2, a3)
        poses["Trigger"][name] = (a1, a2, a3)
        poses["Point"][name] = (a1, a2, a3)
        log(f"fit {name}: {a1:.1f} {a2:.1f} {a3:.1f} cost={c:.2e}")
    lever_rest = hc + fwd_h * LEVER_AHEAD
    lever_pull = hc + fwd_h * (LEVER_AHEAD - LEVER_PULL)
    w = (0.05, 1.0, 1.0)
    rng_i = ((15, 75), (20, 100), (0, 70))
    uv = _plane_point("Index", lever_rest, hd)
    (a1, a2, a3), c = fit_curl("Index", uv, LEVER_R, weights=w, ranges=rng_i)
    poses["Grip"]["Index"] = (a1, a2, a3)
    log(f"fit Index(rest lever): {a1:.1f} {a2:.1f} {a3:.1f} cost={c:.2e}")
    uv = _plane_point("Index", lever_pull, hd)
    (a1, a2, a3), c = fit_curl("Index", uv, LEVER_R, weights=w, ranges=rng_i)
    poses["Trigger"]["Index"] = (a1, a2, a3)
    log(f"fit Index(pulled lever): {a1:.1f} {a2:.1f} {a3:.1f} cost={c:.2e}")
    poses["Point"]["Index"] = (4, 3, 2)
    # Thumb wraps the far (palm) side of the handle over the fingers: posed by
    # joint targets (MCP, IP, tip) in hand space + a pronation twist.
    grip_thumb = dict(targets=((-0.0350, 0.0470, 0.0405), (-0.0590, 0.0690, 0.0345), (-0.0690, 0.0905, 0.0225)), twist=35.0)
    for p in ("Grip", "Trigger"):
        poses[p]["Thumb"] = grip_thumb
    poses["Point"]["Thumb"] = dict(targets=((-0.0300, 0.0480, 0.0460), (-0.0470, 0.0730, 0.0525), (-0.0545, 0.0975, 0.0505)), twist=25.0)
    poses["Open"] = {"Index": (2, 4, 2), "Middle": (3, 5, 3), "Ring": (4, 6, 3), "Pinky": (5, 7, 4), "Thumb": (-6, 2, 4)}
    return poses


# -----------------------------------------------------------------------------
# Geometry helpers (bmesh)
# -----------------------------------------------------------------------------
def new_obj(name, bm, coll=None, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def superellipse(a, rx, ry, p):
    c, s = math.cos(a), math.sin(a)
    x = math.copysign(abs(c) ** (2.0 / p), c) * rx
    y = math.copysign(abs(s) ** (2.0 / p), s) * ry
    return x, y


def catmull(points, n_per):
    """Centripetal-ish Catmull-Rom through points, n_per samples per span."""
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


def loft(bm, pts, rads, up, nseg=24, power=2.0, cap0=0.0, cap1=0.0, cap_rings=5, twist=0.0, offs=None):
    """Closed tube along pts. rads[i] = (rn, rb) radii along the frame's N and B.
    capX > 0 closes that end with a rounded dome of that length (× min radius).
    offs[i] = optional (dn, db) centre offset. Returns list of rings (vert lists)."""
    frames = transport_frames(pts, up)
    rings = []

    def ring_at(c, T, N, B, rn, rb, scale=1.0):
        vs = []
        for k in range(nseg):
            a = 2 * math.pi * k / nseg + twist
            x, y = superellipse(a, rn * scale, rb * scale, power)
            vs.append(bm.verts.new(c + N * x + B * y))
        return vs

    def centre(i):
        c = pts[i].copy()
        if offs:
            T, N, B = frames[i]
            c += N * offs[i][0] + B * offs[i][1]
        return c

    if cap0 > 0:
        T, N, B = frames[0]
        rn, rb = rads[0]
        L = cap0 * min(rn, rb)
        for j in range(cap_rings, 0, -1):
            t = j / (cap_rings + 0.0)
            s = math.sqrt(max(0.0, 1 - t * t))
            if s < 0.12:
                continue
            rings.append(ring_at(centre(0) - T * (L * t), T, N, B, rn, rb, s))
        tip0 = bm.verts.new(centre(0) - T * L)
    for i in range(len(pts)):
        T, N, B = frames[i]
        rings.append(ring_at(centre(i), T, N, B, rads[i][0], rads[i][1]))
    if cap1 > 0:
        T, N, B = frames[-1]
        rn, rb = rads[-1]
        L = cap1 * min(rn, rb)
        for j in range(1, cap_rings + 1):
            t = j / (cap_rings + 0.0)
            s = math.sqrt(max(0.0, 1 - t * t))
            if s < 0.12:
                continue
            rings.append(ring_at(centre(len(pts) - 1) + T * (L * t), T, N, B, rn, rb, s))
        tip1 = bm.verts.new(centre(len(pts) - 1) + T * L)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(nseg):
            bm.faces.new((a[k], a[(k + 1) % nseg], b[(k + 1) % nseg], b[k]))
    if cap0 > 0:
        r = rings[0]
        for k in range(nseg):
            bm.faces.new((tip0, r[(k + 1) % nseg], r[k]))
    elif cap0 == 0 and cap1 >= 0:
        pass
    if cap1 > 0:
        r = rings[-1]
        for k in range(nseg):
            bm.faces.new((r[k], r[(k + 1) % nseg], tip1))
    return rings


def ellipsoid(bm, c, radii, rot=None, seg=24, rings=14):
    rot = rot or Matrix.Identity(3)
    verts = []
    top = bm.verts.new(c + rot @ Vector((0, 0, radii[2])))
    for i in range(1, rings):
        th = math.pi * i / rings
        row = []
        for k in range(seg):
            ph = 2 * math.pi * k / seg
            p = Vector((math.sin(th) * math.cos(ph) * radii[0], math.sin(th) * math.sin(ph) * radii[1], math.cos(th) * radii[2]))
            row.append(bm.verts.new(c + rot @ p))
        verts.append(row)
    bot = bm.verts.new(c + rot @ Vector((0, 0, -radii[2])))
    for k in range(seg):
        bm.faces.new((top, verts[0][k], verts[0][(k + 1) % seg]))
        bm.faces.new((bot, verts[-1][(k + 1) % seg], verts[-1][k]))
    for a, b in zip(verts[:-1], verts[1:]):
        for k in range(seg):
            bm.faces.new((a[k], b[k], b[(k + 1) % seg], a[(k + 1) % seg]))


def frame_matrix(X, Y, Z):
    m = Matrix.Identity(3)
    m.col[0], m.col[1], m.col[2] = X, Y, Z
    return m


def apply_mods(ob):
    """Apply all modifiers (no operator context needed)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


# -----------------------------------------------------------------------------
# Glove (hand space → transformed to socket space at the end)
# -----------------------------------------------------------------------------
PALM_SECTIONS = [
    # y, half-width (Z), half-thickness (X), centre x, centre z
    (-0.050, 0.0300, 0.0215, 0.0000, 0.0000),
    (-0.020, 0.0305, 0.0210, 0.0000, 0.0010),
    (0.005, 0.0325, 0.0205, -0.0005, 0.0020),
    (0.030, 0.0380, 0.0190, -0.0010, 0.0020),
    (0.055, 0.0425, 0.0172, 0.0000, 0.0010),
    (0.075, 0.0440, 0.0160, 0.0015, 0.0005),
    (0.086, 0.0435, 0.0152, 0.0025, 0.0000),
]


def finger_tube_points(name, curls):
    joints, frames = finger_frames(name, curls)
    d0 = frames[0][1]
    start = joints[0] - d0 * (0.022 if name != "Thumb" else 0.010)
    ctrl = [start, joints[0], joints[1], joints[2], joints[3]]
    pts = catmull(ctrl, 5)
    rf = (FINGERS[name]["r"] if name != "Thumb" else THUMB["r"])
    radii_ctrl = [rf[0] * (1.08 if name != "Thumb" else 1.0)] + list(rf)
    rads = []
    for i in range(len(pts)):
        f = i / 5.0
        k = min(int(f), len(radii_ctrl) - 2)
        t = f - k
        r = radii_ctrl[k] * (1 - t) + radii_ctrl[k + 1] * t
        rads.append(r)
    return pts, rads, joints, frames


def build_glove_volume(curls):
    """Union-able closed shells for the gloved hand (hand space)."""
    bm = bmesh.new()
    # palm
    pts = [Vector((s[3], s[0], s[4])) for s in PALM_SECTIONS]
    rads = [(s[2], s[1]) for s in PALM_SECTIONS]  # N ≈ X (thickness), B ≈ Z (width)
    loft(bm, pts, rads, Vector((1, 0, 0)), nseg=40, power=2.7, cap0=0.3, cap1=0.55, cap_rings=6)
    # close the wrist end flat (hidden under the sleeve)
    # thenar / hypothenar pads + dorsal knuckles
    tdir = Vector(THUMB["dir"]).normalized()
    rot = frame_matrix(*_basis_from_y(tdir, Vector((-1, 0, 0))))
    ellipsoid(bm, Vector((-0.0090, 0.0300, 0.0175)), (0.0165, 0.0300, 0.0150), rot)
    ellipsoid(bm, Vector((-0.0085, 0.0400, -0.0240)), (0.0125, 0.0330, 0.0135))
    for name, F in FINGERS.items():
        m = Vector(F["mcp"])
        ellipsoid(bm, m + Vector((0.0075, -0.002, 0)), (0.0085, 0.0105, 0.0095), seg=16, rings=10)
    # fingers + thumb
    for name in FINGER_ORDER:
        c = curls[name]
        p, r, joints, frames = finger_tube_points(name, c)
        X, Y, Z = frames[0]
        up = -Z  # frame N = dorsal
        flat = 0.93 if name != "Thumb" else 0.95
        loft(bm, p, [(rr * flat, rr) for rr in r], up, nseg=20, power=2.25, cap0=0.4, cap1=0.92, cap_rings=5)
    # wrist / cuff (under the sleeve cuff)
    cuff = [Vector((0.0, y, 0.0)) for y in (0.012, -0.010, -0.035, -0.060)]
    loft(bm, cuff, [(0.0215, 0.0300), (0.0225, 0.0315), (0.0245, 0.0330), (0.0265, 0.0345)], Vector((1, 0, 0)), nseg=32, power=2.2, cap0=0.3, cap1=0.3)
    return bm


def _basis_from_y(y, zhint):
    y = y.normalized()
    z = (zhint - y * zhint.dot(y)).normalized()
    x = y.cross(z).normalized()
    return x, y, z


def remesh(ob, voxel, smooth_iter=0, smooth_fac=0.5):
    m = ob.modifiers.new("remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    m.adaptivity = 0.0
    if smooth_iter:
        s = ob.modifiers.new("smooth", "SMOOTH")
        s.factor = smooth_fac
        s.iterations = smooth_iter
    apply_mods(ob)


# -----------------------------------------------------------------------------
# Sleeve (hand space)
# -----------------------------------------------------------------------------
SLEEVE_END = -0.032  # cuff edge (hand space y)
SLEEVE_TOP = -0.300  # past the elbow


def forearm_radii(y):
    """(rx dorsal-volar, rz radial-ulnar) of the forearm under the sleeve."""
    t = min(1.0, max(0.0, (-y) / 0.27))
    rx = 0.0225 + (0.0395 - 0.0225) * (1 - (1 - t) ** 1.6)
    rz = 0.0315 + (0.0420 - 0.0315) * (1 - (1 - t) ** 1.4)
    return rx, rz


def forearm_axis(y):
    t = (-y) / 0.272
    return WRIST.lerp(ELBOW, t)


def build_sleeve(high):
    """Waxed canvas sleeve with a turned-back cuff band. Returns bmesh (hand space)."""
    bm = bmesh.new()
    n_ring = 64 if high else 26
    ys = []
    y = SLEEVE_END
    step = 0.0025 if high else 0.022
    while y > SLEEVE_TOP:
        ys.append(y)
        y -= step
    ys.append(SLEEVE_TOP)
    if not high:
        ys = [SLEEVE_END, SLEEVE_END - 0.006, SLEEVE_END - 0.040, SLEEVE_END - 0.050] + [v for v in ys if v < SLEEVE_END - 0.06]
    rng = random.Random(args.seed + 3)
    fold_ph = [rng.uniform(0, 6.28) for _ in range(8)]
    rows = []
    for y in ys:
        rx, rz = forearm_radii(y)
        c = forearm_axis(y)
        u = (y - SLEEVE_END) / (SLEEVE_TOP - SLEEVE_END)  # 0 at cuff → 1 at elbow
        cuff = 1.0 if (SLEEVE_END - y) < 0.046 else 0.0
        thick = 0.0085 + 0.0035 * cuff
        ring = []
        for k in range(n_ring):
            a = 2 * math.pi * k / n_ring
            x, z = superellipse(a, rx + thick, rz + thick, 2.1)
            d = 0.0
            if high:
                # long draped folds + compression rings above the cuff + sag below
                d += 0.0018 * math.sin(3 * a + fold_ph[0] + 4 * u) * (0.4 + u)
                d += 0.0011 * math.sin(5 * a + fold_ph[1] - 7 * u)
                comp = math.exp(-((SLEEVE_END - 0.075 - y) / 0.03) ** 2) if not cuff else 0.0
                d += 0.0022 * comp * math.sin(2 * math.pi * (y / 0.011) + 1.7 * math.sin(2 * a + fold_ph[2]))
                d += 0.0016 * max(0.0, -math.sin(a)) * u  # gravity sag (−X side hangs)
                if cuff:
                    e = (SLEEVE_END - y) / 0.046
                    d += 0.0010 * math.sin(4 * a + fold_ph[3]) + 0.0012 * math.exp(-((e - 0.98) / 0.05) ** 2)
            nx, nz = superellipse(a, 1.0, 1.0, 2.0)
            ring.append(bm.verts.new(c + Vector((x + nx * d, 0.0, z + nz * d))))
        rows.append(ring)
    for a, b in zip(rows[:-1], rows[1:]):
        for k in range(n_ring):
            bm.faces.new((a[k], a[(k + 1) % n_ring], b[(k + 1) % n_ring], b[k]))
    # rolled lip at both ends: an inward return so the shell has thickness
    for end, sign in ((rows[0], 1), (rows[-1], -1)):
        y0 = end[0].co.y
        inner = []
        for k, v in enumerate(end):
            c = forearm_axis(y0)
            rel = v.co - c
            rel.y = 0
            p = c + rel * 0.86
            p.y = y0 - sign * 0.004
            inner.append(bm.verts.new(p))
        for k in range(n_ring):
            if sign > 0:
                bm.faces.new((inner[k], inner[(k + 1) % n_ring], end[(k + 1) % n_ring], end[k]))
            else:
                bm.faces.new((end[k], end[(k + 1) % n_ring], inner[(k + 1) % n_ring], inner[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# -----------------------------------------------------------------------------
# Armature + skin weights + pose clips
# -----------------------------------------------------------------------------
def bone_defs(side):
    """[(name, parent, head, tail, zaxis)] in socket space for the right side."""
    out = []
    mid = Vector(FINGERS["Middle"]["mcp"])
    out.append(("Forearm", None, S(ELBOW), S(WRIST), SD((1, 0, 0))))
    out.append(("Hand", "Forearm", S(WRIST), S(mid + Vector((-0.004, 0, 0))), SD((-1, 0, 0))))
    for name in FINGER_ORDER:
        joints, frames = finger_frames(name, REST_CURL[name])
        parent = "Hand"
        for i in range(3):
            bn = f"{name}{i + 1}"
            X, Y, Z = frames[i]
            out.append((bn, parent, S(joints[i]), S(joints[i + 1]), SD(Z)))
            parent = bn
    return out


def sfx(name, side):
    return f"{name}_{side}"


def build_armature(side, coll):
    arm = bpy.data.armatures.new(f"Arm_{side}_Armature")
    ob = bpy.data.objects.new(f"Arm_{side}_Armature", arm)
    coll.objects.link(ob)
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    mir = side == "L"
    for name, parent, head, tail, zax in bone_defs(side):
        eb = arm.edit_bones.new(sfx(name, side))
        h, t, z = head.copy(), tail.copy(), zax.copy()
        if mir:
            h.x, t.x, z.x = -h.x, -t.x, -z.x
        eb.head, eb.tail = h, t
        eb.align_roll(z)
        if parent:
            eb.parent = ebs[parent]
            eb.use_connect = False
        ebs[name] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


def chain_segments():
    """Skinning regions in HAND space: list of (bone, a, b, radius)."""
    segs = []
    segs.append(("Forearm", ELBOW + Vector((0, -0.08, 0)), WRIST + Vector((0, -0.012, 0)), 0.035))
    for name in FINGER_ORDER:
        joints, _ = finger_frames(name, REST_CURL[name])
        if name == "Thumb":
            segs.append(("Hand", WRIST, joints[0], 0.025))
        else:
            segs.append(("Hand", WRIST, joints[0] - (joints[1] - joints[0]).normalized() * 0.004, 0.022))
    return segs


def skin_weights(vco_hand, normals_hand, adjacency):
    """Per-vertex {bone: w} in hand space. Region = nearest (normalised) skeleton
    segment; within a finger the weight slides across each joint with a smooth
    step a little wider than the joint, then a few Laplacian passes soften the
    seams (webbing, wrist)."""
    chains = {}
    for name in FINGER_ORDER:
        joints, _ = finger_frames(name, REST_CURL[name])
        chains[name] = joints
    rad = {n: (THUMB["r"] if n == "Thumb" else FINGERS[n]["r"]) for n in FINGER_ORDER}
    weights = []
    for idx, p in enumerate(vco_hand):
        best = (1e9, None)
        # forearm/palm candidates
        for bone, a, b, r in chain_segments():
            d = _seg_dist(p, a, b)[0] / r
            if d < best[0]:
                best = (d, ("seg", bone))
        for name, J in chains.items():
            for i in range(3):
                d, t = _seg_dist(p, J[i], J[i + 1])
                rr = rad[name][i] + (rad[name][i + 1] - rad[name][i]) * t
                dn = d / (rr * 1.15)
                if i == 0 and t <= 0.0:
                    dn += 0.25  # behind the knuckle belongs to the palm unless very close
                if dn < best[0]:
                    best = (dn, ("finger", name))
        kind, who = best[1]
        w = {}
        if kind == "seg":
            if who == "Forearm":
                w["Forearm"] = 1.0
            else:
                # wrist blend: Hand ↔ Forearm across y ∈ [−0.030, +0.005]
                s = _smooth((p.y + 0.030) / 0.035)
                w["Hand"] = s
                w["Forearm"] = 1 - s
        else:
            J = chains[who]
            # arc-length parameter along the chain
            best_s, best_d = 0.0, 1e9
            acc = 0.0
            for i in range(3):
                d, t = _seg_dist(p, J[i], J[i + 1])
                L = (J[i + 1] - J[i]).length
                if d < best_d:
                    best_d, best_s = d, acc + t * L
                acc += L
            L1 = (J[1] - J[0]).length
            L2 = (J[2] - J[1]).length
            # joint transition half-widths (m)
            h0 = 0.012 if who != "Thumb" else 0.016
            h1, h2 = 0.0065, 0.0055
            b = [f"{who}1", f"{who}2", f"{who}3"]
            s0 = _smooth((best_s - 0.0 + h0 * 0.3) / (2 * h0))  # palm → P1 (shifted forward)
            s1 = _smooth((best_s - L1 + h1) / (2 * h1))
            s2 = _smooth((best_s - L1 - L2 + h2) / (2 * h2))
            w["Hand"] = 1 - s0
            w[b[0]] = s0 * (1 - s1)
            w[b[1]] = s0 * s1 * (1 - s2)
            w[b[2]] = s0 * s1 * s2
        weights.append(w)
    # Laplacian smoothing on the weight vectors
    for _ in range(3):
        nxt = []
        for i, w in enumerate(weights):
            nb = adjacency[i]
            if not nb:
                nxt.append(w)
                continue
            acc = {}
            for j in nb:
                for k, v in weights[j].items():
                    acc[k] = acc.get(k, 0.0) + v / len(nb)
            m = {}
            for k in set(w) | set(acc):
                m[k] = 0.5 * w.get(k, 0.0) + 0.5 * acc.get(k, 0.0)
            nxt.append(m)
        weights = nxt
    out = []
    for w in weights:
        items = sorted(((v, k) for k, v in w.items() if v > 0.01), reverse=True)[:4]
        tot = sum(v for v, _ in items) or 1.0
        out.append({k: v / tot for v, k in items})
    return out


def _smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def _seg_dist(p, a, b):
    ab = b - a
    L2 = ab.length_squared
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
    return (p - (a + ab * t)).length, t


def pose_quats(pose_curls, side):
    """Bone-local quaternions (relative to the rest pose) for a pose. Fingers:
    flexion about the bone's local X (the same on both sides, frames are
    mirrored). Thumb: solved from joint targets. Left side = mirror rule
    (w, x, y, z) → (w, x, −y, −z)."""
    q = {}
    for name in FINGER_ORDER:
        spec = pose_curls[name]
        if isinstance(spec, dict):
            q.update(_target_quats(name, spec))
            continue
        rest = REST_CURL[name]
        for i in range(3):
            q[f"{name}{i + 1}"] = Quaternion((1, 0, 0), math.radians(spec[i] - rest[i]))
    if side == "L":
        q = {k: Quaternion((v.w, v.x, -v.y, -v.z)) for k, v in q.items()}
    return q


def _target_quats(name, spec):
    joints, frames = finger_frames(name, REST_CURL[name])
    L = THUMB["L"] if name == "Thumb" else FINGERS[name]["L"]
    Dp = Matrix.Identity(3)
    head = joints[0].copy()
    out = {}
    for i in range(3):
        X, Y, Z = frames[i]
        Fr = frame_matrix(X, Y, Z)
        cur = (Dp @ Y).normalized()
        tgt = (Vector(spec["targets"][i]) - head).normalized()
        Di = cur.rotation_difference(tgt).to_matrix() @ Dp
        if i == 0 and spec.get("twist"):
            Di = Matrix.Rotation(math.radians(spec["twist"]), 3, tgt) @ Di
        B = Fr.transposed() @ Dp.transposed() @ Di @ Fr
        out[f"{name}{i + 1}"] = B.to_quaternion()
        head = head + (Di @ Y) * L[i]
        Dp = Di
    return out


def make_pose_actions(arm_ob, side, poses):
    ad = arm_ob.animation_data_create()
    acts = []
    for pname in ("Open", "Grip", "Trigger", "Point"):
        act = bpy.data.actions.new(f"{pname}_{side}")
        act.use_fake_user = True
        ad.action = act
        qs = pose_quats(poses[pname], side)
        for pb in arm_ob.pose.bones:
            base = pb.name[:-2]
            pb.rotation_quaternion = qs.get(base, Quaternion())
            pb.location = (0, 0, 0)
            for f in (0, 1):
                pb.keyframe_insert("rotation_quaternion", frame=f)
        tr = ad.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, 0, act)
        st.name = act.name
        tr.mute = True
        acts.append(act)
        ad.action = None
    for pb in arm_ob.pose.bones:
        pb.rotation_quaternion = Quaternion()
    return acts


def apply_pose(arm_ob, poses, pname, side):
    qs = pose_quats(poses[pname], side) if pname else {}
    for pb in arm_ob.pose.bones:
        pb.rotation_quaternion = qs.get(pb.name[:-2], Quaternion())
    bpy.context.view_layer.update()


# -----------------------------------------------------------------------------
# Hard-surface toolkit (socket space). Every builder takes `hi` (bool): the
# high-poly gets dense revolutions + explicit chamfers, the game mesh a lean
# version of the same silhouette (the bake carries the rest).
# -----------------------------------------------------------------------------
def _perp(axis, ref=None):
    axis = axis.normalized()
    ref = ref if ref is not None else (Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0)))
    u = (ref - axis * ref.dot(axis)).normalized()
    return u, axis.cross(u)


def lathe(bm, origin, axis, profile, seg, ref=None, closed=False, arc=None, phase=0.0, disp=None):
    """Revolve profile [(t, r), …] around origin + axis·t. r ≈ 0 makes a pole.
    closed: the profile is a loop (torus-like). arc: partial revolution (rad) with
    flat caps. disp(t, ang) → radial offset (knurls). Returns all verts."""
    axis = Vector(axis).normalized()
    u, v = _perp(axis, ref)
    n_ang = seg if arc is None else seg + 1
    angs = [phase + (2 * math.pi if arc is None else arc) * k / seg for k in range(n_ang)]
    rings = []
    for t, r in profile:
        c = origin + axis * t
        if r <= 1e-7:
            rings.append([bm.verts.new(c)])
        else:
            ring = []
            for a in angs:
                rr = r + (disp(t, a) if disp else 0.0)
                ring.append(bm.verts.new(c + (u * math.cos(a) + v * math.sin(a)) * rr))
            rings.append(ring)
    pairs = list(zip(rings[:-1], rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        nseg = seg if arc is None else seg  # quads between consecutive angles
        if len(a) == 1 and len(b) == 1:
            continue
        for k in range(nseg):
            k1 = (k + 1) % n_ang if arc is None else k + 1
            if len(a) == 1:
                bm.faces.new((a[0], b[k1], b[k]))
            elif len(b) == 1:
                bm.faces.new((a[k], a[k1], b[0]))
            else:
                bm.faces.new((a[k], a[k1], b[k1], b[k]))
    if arc is not None:
        # flat caps at both cut planes: fan from the axis
        for k in (0, n_ang - 1):
            col = [r[0] if len(r) == 1 else r[k] for r in rings]
            prof = [bm.verts.new(origin + axis * t) for t, _ in profile]
            for i in range(len(rings) - 1):
                quad = [prof[i], col[i], col[i + 1], prof[i + 1]] if k == 0 else [prof[i], prof[i + 1], col[i + 1], col[i]]
                uniq = []
                for q in quad:
                    if q not in uniq:
                        uniq.append(q)
                if len(uniq) >= 3:
                    try:
                        bm.faces.new(uniq)
                    except ValueError:
                        pass
    return [v for r in rings for v in r]


def cylinder(bm, p0, p1, r, seg, ref=None, r1=None, chamfer=0.0):
    axis = Vector(p1) - Vector(p0)
    L = axis.length
    r1 = r if r1 is None else r1
    if chamfer > 0:
        prof = [(0, 0), (0, r - chamfer), (chamfer, r), (L - chamfer, r1), (L, r1 - chamfer), (L, 0)]
    else:
        prof = [(0, 0), (0, r), (L, r1), (L, 0)]
    return lathe(bm, Vector(p0), axis, prof, seg, ref)


def tube(bm, p0, p1, r_out, r_in, seg, chamfer=0.0, ref=None):
    axis = Vector(p1) - Vector(p0)
    L = axis.length
    c = chamfer
    prof = [(c, r_in), (0, r_in + c), (0, r_out - c), (c, r_out), (L - c, r_out), (L, r_out - c), (L, r_in + c), (L - c, r_in)] if c > 0 else \
        [(0, r_in), (0, r_out), (L, r_out), (L, r_in)]
    return lathe(bm, Vector(p0), axis, prof, seg, ref, closed=True)


def torus(bm, c, axis, R, r, seg, seg2):
    prof = [(r * math.sin(2 * math.pi * k / seg2), R + r * math.cos(2 * math.pi * k / seg2)) for k in range(seg2)]
    return lathe(bm, Vector(c), axis, prof[::-1], seg, closed=True)


def box(bm, c, half, rot=None, bevel=0.0, bseg=2):
    rot = rot or Matrix.Identity(3)
    hx, hy, hz = half
    vs = []
    for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
        vs.append(bm.verts.new(Vector(c) + rot @ Vector((sx * hx, sy * hy, sz * hz))))
    fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    faces = [bm.faces.new([vs[i] for i in f]) for f in fs]
    if bevel > 0:
        edges = list({e for f in faces for e in f.edges})
        bmesh.ops.bevel(bm, geom=edges + vs, offset=bevel, segments=bseg, profile=0.5, affect="EDGES", clamp_overlap=True)
    return vs


def prism(bm, outline, x0, x1, bevel=0.0, bseg=2):
    """Extrude a (y, z) outline (CCW seen from +X) between x0 and x1."""
    a = [bm.verts.new((x0, y, z)) for y, z in outline]
    b = [bm.verts.new((x1, y, z)) for y, z in outline]
    n = len(outline)
    faces = [bm.faces.new(b), bm.faces.new(a[::-1])]
    for k in range(n):
        faces.append(bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])))
    if bevel > 0:
        edges = list({e for f in faces for e in f.edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=bseg, profile=0.5, affect="EDGES", clamp_overlap=True)
    return faces


def helix_pts(c, axis, R, pitch, turns, n_per_turn, ref=None, phase=0.0):
    axis = Vector(axis).normalized()
    u, v = _perp(axis, ref)
    pts = []
    N = int(turns * n_per_turn)
    for i in range(N + 1):
        a = phase + 2 * math.pi * i / n_per_turn
        pts.append(Vector(c) + axis * (pitch * i / n_per_turn) + (u * math.cos(a) + v * math.sin(a)) * R)
    return pts


def sweep(bm, pts, r, seg, up=None, closed=False, power=2.0, rb=None, cap=True):
    """Round (or boxy with power > 2) section swept along pts."""
    up = up or _perp((pts[1] - pts[0]))[0]
    rads = [(r, rb if rb is not None else r)] * len(pts)
    if closed:
        pts = list(pts) + [pts[0]]
        rads = rads + [rads[0]]
    return loft(bm, pts, rads, up, nseg=seg, power=power, cap0=0.5 if (cap and not closed) else 0.0,
                cap1=0.5 if (cap and not closed) else 0.0, cap_rings=3)


def dome_rivet(bm, p, n, r, h, seg=10):
    return lathe(bm, Vector(p) - Vector(n) * 0.0006, n, [(0, 0), (0, r), (h * 0.35, r * 0.92), (h * 0.75, r * 0.62), (h, 0)], seg)


def slotted_screw(bm, p, n, r, h, seg=12, slot_dir=None):
    """Domed screw head split by a slot (two half lathes)."""
    n = Vector(n).normalized()
    sd = slot_dir or _perp(n)[0]
    gap = r * 0.16
    prof = [(0, 0), (0, r), (h * 0.4, r * 0.9), (h * 0.8, r * 0.55), (h, 0.0001)]
    side = n.cross(sd).normalized()
    for s in (1, -1):
        lathe(bm, Vector(p) - n * 0.0006 + side * gap * s, n, prof, seg, ref=side * s, arc=math.pi, phase=-math.pi / 2)


# -----------------------------------------------------------------------------
# Launcher (socket space, right side; the left side is the mirror)
# -----------------------------------------------------------------------------
DRUM_C = Vector((0.0055, -0.122, 0.0995))  # drum axle centre
DRUM_W = 0.0300  # between flanges
DRUM_R_CORE = 0.0110
DRUM_R_WOUND = 0.0255
DRUM_R_FLANGE = 0.0335
CHEEK_X = (DRUM_C.x - 0.0205, DRUM_C.x + 0.0205)  # inner faces of the two cheek plates
BREECH = (-0.058, 0.034)  # firing chamber y-range (on the barrel axis)
BREECH_R = 0.0205
GAUGE_C = Vector((-0.0165, -0.022, 0.1045))
GAUGE_N = Vector((-0.34, -0.50, 0.80)).normalized()
GAUGE_R = 0.0185
LEVER_PIVOT = Vector((0.0, 0.0405, 0.0545))
TANK = dict(x=0.0345, z=0.0655, y0=-0.050, y1=0.062, r=0.0108)


class Part:
    """One launcher component: a game mesh (low), its bake sources (high) and the
    rig bone it rides on."""

    def __init__(self, name, bone, mat, low_fn, high_fn=None, hi_mat=None):
        self.name, self.bone, self.mat = name, bone, mat
        self.low_fn, self.high_fn = low_fn, high_fn or low_fn
        self.hi_mat = hi_mat or {}


def sleeve_surface(y_h, a, extra=0.0):
    """Socket-space point on the (un-folded) sleeve surface at hand-space y and
    angle a (0 = back of the hand / +X, π/2 = thumb side / top)."""
    rx, rz = forearm_radii(y_h)
    cuff = 1.0 if (SLEEVE_END - y_h) < 0.046 else 0.0
    th = 0.0085 + 0.0035 * cuff + extra
    x, z = superellipse(a, rx + th, rz + th, 2.1)
    c = forearm_axis(y_h)
    return S(c + Vector((x, 0.0, z)))


def build_brace(bm, hi, extra=0.0035, thick=0.0026, y0=-0.040, y1=-0.205, a_half=0.98):
    """Iron saddle over the top of the sleeve (rolled edges, thick ends)."""
    ny = 34 if hi else 9
    na = 40 if hi else 10
    rows_o, rows_i = [], []
    for i in range(ny + 1):
        yh = y0 + (y1 - y0) * i / ny
        ro, ri = [], []
        for k in range(na + 1):
            a = math.pi / 2 - a_half + 2 * a_half * k / na
            ro.append(bm.verts.new(sleeve_surface(yh, a, extra + thick)))
            ri.append(bm.verts.new(sleeve_surface(yh, a, extra)))
        rows_o.append(ro)
        rows_i.append(ri)
    for i in range(ny):
        for k in range(na):
            bm.faces.new((rows_o[i][k], rows_o[i][k + 1], rows_o[i + 1][k + 1], rows_o[i + 1][k]))
            bm.faces.new((rows_i[i][k], rows_i[i + 1][k], rows_i[i + 1][k + 1], rows_i[i][k + 1]))
    for i in range(ny):  # long edges
        for k in (0, na):
            o0, o1, i0, i1 = rows_o[i][k], rows_o[i + 1][k], rows_i[i][k], rows_i[i + 1][k]
            bm.faces.new((o0, o1, i1, i0) if k == 0 else (o1, o0, i0, i1))
    for i in (0, ny):  # end edges
        for k in range(na):
            o0, o1, i0, i1 = rows_o[i][k], rows_o[i][k + 1], rows_i[i][k], rows_i[i][k + 1]
            bm.faces.new((o1, o0, i0, i1) if i == 0 else (o0, o1, i1, i0))
    if hi:
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.is_manifold and _edge_angle(e) > 0.7],
                        offset=0.0007, segments=3, profile=0.5, affect="EDGES", clamp_overlap=True)
    return rows_o


def _edge_angle(e):
    try:
        return e.calc_face_angle(0.0)
    except Exception:
        return 0.0


def build_strap(bm, hi, y_h, width=0.024, thick=0.0032, buckle_a=math.pi - 0.45):
    """Leather strap around the sleeve (riding over the brace on top)."""
    na = 96 if hi else 28
    nw = 4 if hi else 1
    pts_o, pts_i = [], []
    rows = []
    for j in range(nw + 1):
        yy = y_h - width / 2 + width * j / nw
        ring_o, ring_i = [], []
        for k in range(na):
            a = 2 * math.pi * k / na
            on_brace = _smooth((0.98 - abs(_angdiff(a, math.pi / 2))) / 0.12 + 0.5)
            lift = 0.0012 + on_brace * (0.0035 + 0.0026 + 0.0004)
            ring_o.append(bm.verts.new(sleeve_surface(yy, a, lift + thick)))
            ring_i.append(bm.verts.new(sleeve_surface(yy, a, lift)))
        rows.append((ring_o, ring_i))
    for j in range(nw):
        o0, i0 = rows[j]
        o1, i1 = rows[j + 1]
        for k in range(na):
            k1 = (k + 1) % na
            bm.faces.new((o0[k], o0[k1], o1[k1], o1[k]))
            bm.faces.new((i0[k], i1[k], i1[k1], i0[k1]))
    for j, sgn in ((0, 1), (nw, -1)):
        o, i = rows[j]
        for k in range(na):
            k1 = (k + 1) % na
            f = (o[k], i[k], i[k1], o[k1])
            bm.faces.new(f if sgn > 0 else f[::-1])
    if hi:
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.is_manifold and _edge_angle(e) > 0.9],
                        offset=0.0006, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    return buckle_a


def _angdiff(a, b):
    return (a - b + math.pi) % (2 * math.pi) - math.pi


def buckle_frame(bm, hi, y_h, a, width=0.024):
    """Brass buckle: a rounded rectangular frame + centre bar, iron tongue."""
    p = sleeve_surface(y_h, a, 0.0012 + 0.0032 + 0.0018)
    p_up = sleeve_surface(y_h, a, 0.02)
    n = (p_up - p).normalized()
    along = (sleeve_surface(y_h, a + 0.05, 0.0) - sleeve_surface(y_h, a - 0.05, 0.0)).normalized()  # strap direction
    across = n.cross(along).normalized()
    hw, hl = width / 2 + 0.0035, 0.0105
    seg = 12 if hi else 5
    loop = []
    corners = [(hl, hw), (-hl, hw), (-hl, -hw), (hl, -hw)]
    rc = 0.0035
    for ci, (cx, cy) in enumerate(corners):
        a0 = math.pi / 2 * ci
        sx = math.copysign(1, cx)
        sy = math.copysign(1, cy)
        for s in range(seg // 2 + 1):
            ang = a0 + (math.pi / 2) * s / (seg // 2)
            loop.append(p + along * (cx - sx * rc + rc * math.cos(ang)) + across * (cy - sy * rc + rc * math.sin(ang)))
    rr = 0.0013 if hi else 0.0014
    sweep(bm, loop, rr, 8 if hi else 4, up=n, closed=True)
    # centre bar + tongue
    sweep(bm, [p + across * (hw - 0.001), p - across * (hw - 0.001)], rr * 0.9, 8 if hi else 4, up=n)
    t0 = p + n * 0.0012
    sweep(bm, [t0, t0 + along * (hl - 0.001) + n * 0.0008], 0.0009 if hi else 0.0011, 6 if hi else 4, up=n)
    return p, n, along, across


def strap_tail(bm, hi, y_h, a, width=0.024, length=0.036):
    """The strap end coming out of the buckle, lying on the strap around the arm."""
    nl = 12 if hi else 3
    r_est = 0.046
    a0, a1 = a + 0.17, a + 0.17 + length / r_est
    pts, ups = [], []
    for i in range(nl + 1):
        aa = a0 + (a1 - a0) * i / nl
        lift = 0.0012 + 0.0032 + 0.0019 - 0.0006 * (i / nl)
        p = sleeve_surface(y_h, aa, lift)
        pts.append(p)
        ups.append((sleeve_surface(y_h, aa, lift + 0.01) - p).normalized())
    loft(bm, pts, [(0.0015, width / 2 - 0.0012)] * (nl + 1), ups[0], nseg=16 if hi else 8, power=6.0, cap0=0.0, cap1=0.9, cap_rings=3 if hi else 1)


def build_launcher(hi):
    """Returns {part_name: (bm, bone, material_key)} for one detail level."""
    P = {}

    def add(name, bone, mat):
        bm = bmesh.new()
        P[name] = (bm, bone, mat)
        return bm

    seg = (lambda h, l: h if hi else l)
    BZ = BARREL_Z
    # ---- barrel (slide) -----------------------------------------------------
    bm = add("Barrel", "Slide", "iron")
    tube(bm, (0, 0.034, BZ), (0, 0.152, BZ), 0.0128, 0.0086, seg(64, 18), chamfer=seg(0.0008, 0.0))
    for yb, w in ((0.072, 0.009), (0.124, 0.007)):
        bmb = add(f"Band{yb:.3f}", "Slide", "brass")
        tube(bmb, (0, yb - w / 2, BZ), (0, yb + w / 2, BZ), 0.0146, 0.0124, seg(64, 18), chamfer=seg(0.0007, 0.0))
        if hi:
            for k in range(6):
                a = 2 * math.pi * k / 6 + 0.3
                nrm = Vector((math.cos(a), 0, math.sin(a)))
                dome_rivet(bm, Vector((0, yb, BZ)) + nrm * 0.0146, nrm, 0.0016, 0.0011, 10)
    # rails under the barrel
    for sx in (-1, 1):
        box(bm, (sx * 0.0075, 0.093, BZ - 0.0118), (0.0022, 0.057, 0.0022), bevel=seg(0.0006, 0.0))
    # muzzle crown (brass) with a knurled grip band
    bm = add("Crown", "Slide", "brass")
    prof = [(0.0, 0.0090), (0.0, 0.0150), (0.004, 0.0154), (0.006, 0.0164), (0.016, 0.0168), (0.018, 0.0182), (0.0215, 0.0182), (0.0235, 0.0165), (0.0235, 0.0105), (0.020, 0.0092)]
    knurl = None
    if hi:
        def knurl(t, a):
            if 0.0065 <= t <= 0.0155:
                ph1 = (a * 30 / (2 * math.pi) + t / 0.0016) % 1.0
                ph2 = (a * 30 / (2 * math.pi) - t / 0.0016) % 1.0
                return -0.00045 * (min(abs(ph1 - 0.5), abs(ph2 - 0.5)) < 0.12)
            return 0.0
        prof = [(0.0, 0.0090), (0.0, 0.0150), (0.004, 0.0154), (0.006, 0.0164)] + \
            [(0.0065 + 0.0003 * i, 0.0168) for i in range(31)] + [(0.016, 0.0168), (0.0165, 0.0176), (0.018, 0.0182), (0.0215, 0.0182), (0.0228, 0.0176), (0.0235, 0.0165), (0.0235, 0.0105), (0.020, 0.0092)]
    lathe(bm, Vector((0, 0.1485, BZ)), Vector((0, 1, 0)), prof, seg(120, 20), closed=True, disp=knurl)
    # pilot lamp on the barrel top (brass cup + phosphor dome)
    bm = add("LampCup", "Slide", "brass")
    lp = Vector((0, 0.050, BZ + 0.0128))
    lathe(bm, lp - Vector((0, 0, 0.002)), Vector((0, 0, 1)), [(0, 0), (0, 0.0062), (0.004, 0.0062), (0.0052, 0.0055), (0.0052, 0.0046), (0.0042, 0.0044), (0.0042, 0)], seg(40, 12))
    bm = add("LampGlass", "Slide", "lamp")
    lathe(bm, lp + Vector((0, 0, 0.0040)), Vector((0, 0, 1)), [(0, 0.0044), (0.0018, 0.0040), (0.0032, 0.0026), (0.0040, 0.0)], seg(32, 10))

    # ---- grapple head (seated in the muzzle) ----------------------------------
    bm = add("HeadShaft", "Head", "forged")
    cylinder(bm, (0, 0.110, BZ), (0, 0.178, BZ), 0.0072, seg(32, 10), chamfer=seg(0.0005, 0.0))
    bm = add("HeadPoint", "Head", "forged")
    hp = [(0.0, 0.0), (0.0, 0.0100), (0.004, 0.0118), (0.012, 0.0108), (0.024, 0.0062), (0.032, 0.0022), (0.0345, 0.0)]
    lathe(bm, Vector((0, 0.177, BZ)), Vector((0, 1, 0)), hp, seg(48, 12))
    for k in range(3):
        a = math.pi / 2 + 2 * math.pi * k / 3
        rdir = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((0, 1, 0)).cross(rdir).normalized()
        # fluke: root on the head, sweeping back along the barrel axis, barbed tip
        pts = []
        nf = 12 if hi else 5
        for i in range(nf + 1):
            t = i / nf
            yy = 0.196 - 0.044 * t
            rr = 0.0085 + 0.0108 * math.sin(t * math.pi * 0.55) + 0.001 * t
            pts.append(Vector((0, yy, BZ)) + rdir * rr)
        widths = [(0.0021 * (1 - 0.35 * i / nf), 0.0052 * (1 - 0.55 * (i / nf) ** 1.5)) for i in range(nf + 1)]
        loft(bm, pts, widths, rdir, nseg=seg(16, 6), power=3.0, cap0=0.3, cap1=0.6, cap_rings=seg(3, 1))
        # barb: a short back-hook at the fluke tip
        tip = pts[-1]
        loft(bm, [tip - rdir * 0.0004, tip + rdir * 0.0042 + Vector((0, 0.0058, 0))], [(0.0016, 0.0032), (0.0007, 0.0012)], side,
             nseg=seg(12, 4), power=3.0, cap0=0.2, cap1=0.6, cap_rings=seg(2, 1))

    # ---- frame under the barrel + breech ------------------------------------
    bm = add("Frame", "Body", "iron")
    outline = [(-0.066, 0.0480), (0.140, 0.0505), (0.146, 0.0545), (0.146, 0.0585), (0.036, 0.0598), (0.030, 0.0640),
               (-0.060, 0.0640), (-0.068, 0.0560)]
    prism(bm, outline, -0.0125, 0.0125, bevel=seg(0.0009, 0.0), bseg=3)
    # cheek plates (drum fork + chassis), bottom edge resting on the brace
    for side, xx in (("In", CHEEK_X[0] - 0.0032), ("Out", CHEEK_X[1])):
        bmc = add(f"Cheek{side}", "Body", "iron")
        d = DRUM_C
        top = [(d.y + 0.0175 * math.cos(math.radians(a)), d.z + 0.0175 * math.sin(math.radians(a))) for a in range(200, -21, -20 if hi else -55)]
        outline = [(-0.170, 0.0255), (-0.153, 0.0265)] + [(top[0][0] - 0.004, top[0][1] - 0.012)] + top + \
                  [(-0.070, 0.0835), (-0.044, 0.0710), (-0.028, 0.0640), (-0.060, 0.0500), (-0.085, 0.0360), (-0.100, 0.0320), (-0.135, 0.0270)]
        prism(bmc, outline, xx, xx + 0.0032, bevel=seg(0.0007, 0.0), bseg=2)
    # axle boss caps + ratchet on the inner (player) side, tension knob
    bm = add("Axle", "Body", "steel")
    cylinder(bm, (CHEEK_X[0] - 0.0062, DRUM_C.y, DRUM_C.z), (CHEEK_X[1] + 0.0060, DRUM_C.y, DRUM_C.z), 0.0042, seg(32, 10), chamfer=seg(0.0006, 0.0))
    bm = add("AxleNutOut", "Body", "brass")
    xo = CHEEK_X[1] + 0.0032
    nut = [(0, 0), (0, 0.0072), (0.0006, 0.0078), (0.0038, 0.0078), (0.0046, 0.0066), (0.0050, 0.0040), (0.0058, 0.0), ]
    lathe(bm, Vector((xo, DRUM_C.y, DRUM_C.z)), Vector((1, 0, 0)), nut, seg(6, 6), phase=math.pi / 6)
    bm = add("Knob", "Drum", "brass")  # winding knob on the inner (player) side, spins with the drum
    xi = CHEEK_X[0] - 0.0032
    kprof = [(0, 0), (0, 0.0060), (0.0030, 0.0060), (0.0036, 0.0105), (0.0040, 0.0112)] + \
        ([(0.0040 + 0.0004 * i, 0.0118) for i in range(1, 21)] if hi else [(0.0120, 0.0118)]) + [(0.0128, 0.0112), (0.0134, 0.0090), (0.0136, 0.0)]

    def kknurl(t, a):
        if 0.0046 <= t <= 0.0118:
            return -0.00055 * (abs(((a * 24 / (2 * math.pi)) % 1.0) - 0.5) < 0.18)
        return 0.0
    lathe(bm, Vector((xi, DRUM_C.y, DRUM_C.z)), Vector((-1, 0, 0)), kprof, seg(96, 16), disp=kknurl if hi else None)
    # ratchet wheel (spins with the drum) just inside the inner cheek, pawl on the cheek
    bm = add("Ratchet", "Drum", "steel")
    teeth = 18
    out = []
    for k in range(teeth):
        a0 = 2 * math.pi * k / teeth
        out.append((DRUM_C.y + 0.0285 * math.cos(a0), DRUM_C.z + 0.0285 * math.sin(a0)))
        a1 = a0 + 2 * math.pi / teeth * 0.82
        out.append((DRUM_C.y + 0.0245 * math.cos(a1), DRUM_C.z + 0.0245 * math.sin(a1)))
    prism(bm, out, CHEEK_X[0] + 0.0004, CHEEK_X[0] + 0.0032, bevel=seg(0.0003, 0.0), bseg=1)
    bm = add("Pawl", "Body", "iron")
    pv = Vector((CHEEK_X[0] - 0.0050, DRUM_C.y + 0.034, DRUM_C.z + 0.010))
    pawl = [(pv.y + 0.004, pv.z + 0.003), (pv.y - 0.004, pv.z + 0.004), (pv.y - 0.010, pv.z + 0.016), (pv.y - 0.011, pv.z + 0.0125), (pv.y - 0.003, pv.z - 0.003)]
    prism(bm, pawl, pv.x, pv.x + 0.0024, bevel=seg(0.0004, 0.0), bseg=1)
    cylinder(bm, (pv.x - 0.0012, pv.y, pv.z), (pv.x + 0.0036, pv.y, pv.z), 0.0028, seg(20, 8), chamfer=seg(0.0004, 0.0))

    # ---- drum + wound cable --------------------------------------------------
    bm = add("Drum", "Drum", "brass")
    x0, x1 = CHEEK_X[0] + 0.0040, CHEEK_X[1] - 0.0012
    dprof = [(0.0, 0.0044), (0.0, DRUM_R_FLANGE - 0.0010), (0.0010, DRUM_R_FLANGE), (0.0022, DRUM_R_FLANGE), (0.0026, DRUM_R_FLANGE - 0.0014),
             (0.0028, DRUM_R_CORE + 0.004), (0.0034, DRUM_R_CORE), (x1 - x0 - 0.0034, DRUM_R_CORE), (x1 - x0 - 0.0028, DRUM_R_CORE + 0.004),
             (x1 - x0 - 0.0026, DRUM_R_FLANGE - 0.0014), (x1 - x0 - 0.0022, DRUM_R_FLANGE), (x1 - x0 - 0.0010, DRUM_R_FLANGE),
             (x1 - x0, DRUM_R_FLANGE - 0.0010), (x1 - x0, 0.0044)]
    lathe(bm, Vector((x0, DRUM_C.y, DRUM_C.z)), Vector((1, 0, 0)), dprof, seg(96, 22), closed=True)
    if hi:
        # lightening holes in the flanges read as dark pockets (shallow discs)
        for xf in (x0 - 0.0002, x1 - x0 + x0 + 0.0002):
            for k in range(6):
                a = 2 * math.pi * k / 6 + 0.26
                c = Vector((xf, DRUM_C.y + 0.0225 * math.cos(a), DRUM_C.z + 0.0225 * math.sin(a)))
                nn = Vector((-1 if xf < DRUM_C.x else 1, 0, 0))
                dome_rivet(bm, c, nn, 0.0018, 0.0012, 10)
    bm = add("Cable", "Drum", "cable")
    cr = 0.0021
    if hi:
        layers = int((DRUM_R_WOUND - DRUM_R_CORE) / (2 * cr * 0.92))
        span = (x1 - x0) - 0.0062
        turns = span / (2 * cr)
        for L in range(layers):
            R = DRUM_R_CORE + cr + L * 2 * cr * 0.9
            start = x0 + 0.0031 + cr
            pts = helix_pts(Vector((start, DRUM_C.y, DRUM_C.z)), Vector((1, 0, 0)) * (1 if L % 2 == 0 else 1), R, 2 * cr * 1.02, turns - 1, 28, phase=L * 0.7)
            if L % 2:
                pts = [Vector((x0 + x1 - p.x, p.y, p.z)) for p in pts]
            sweep(bm, pts, cr * 0.97, 8, cap=True)
    else:
        lathe(bm, Vector((x0 + 0.0030, DRUM_C.y, DRUM_C.z)), Vector((1, 0, 0)),
              [(0, DRUM_R_CORE), (0.0, DRUM_R_WOUND - 0.0006), (0.0012, DRUM_R_WOUND), (x1 - x0 - 0.0072, DRUM_R_WOUND), (x1 - x0 - 0.0060, DRUM_R_WOUND - 0.0006), (x1 - x0 - 0.0060, DRUM_R_CORE)],
              20, closed=True)
    # running cable: from the drum bottom forward through the fairlead into the breech
    bm = add("CableRun", "Body", "cable")
    cz = DRUM_C.z - DRUM_R_WOUND + cr
    pts = [Vector((DRUM_C.x, DRUM_C.y, cz)), Vector((DRUM_C.x * 0.5, -0.090, cz - 0.004)), Vector((0.0, -0.072, BZ + 0.0004)), Vector((0.0, -0.052, BZ))]
    pts = catmull(pts, 6 if hi else 2)
    if hi:
        # 3-strand lay: three twisted strands around the path
        frames = transport_frames(pts, Vector((0, 0, 1)))
        dense = catmull(pts, 4)
        fr = transport_frames(dense, Vector((0, 0, 1)))
        acc = 0.0
        for s in range(3):
            sp = []
            acc = 0.0
            for i, (p, (T, N, B)) in enumerate(zip(dense, fr)):
                if i:
                    acc += (dense[i] - dense[i - 1]).length
                a = 2 * math.pi * s / 3 + acc / 0.012 * 2 * math.pi
                sp.append(p + (N * math.cos(a) + B * math.sin(a)) * cr * 0.45)
            sweep(bm, sp, cr * 0.58, 8, cap=True)
    else:
        sweep(bm, pts, cr, 6, cap=True)
    # fairlead rollers between the cheeks
    bm = add("Fairlead", "Body", "brass")
    for dz in (-0.0058, 0.0058):
        cylinder(bm, (CHEEK_X[0], -0.074, BZ + dz + 0.0004), (CHEEK_X[1], -0.074, BZ + dz + 0.0004), 0.0036, seg(32, 10), chamfer=seg(0.0005, 0.0))

    # ---- firing chamber (breech): end caps, open cage, spring, piston ---------
    by0, by1 = BREECH
    bm = add("BreechCaps", "Body", "brass")
    rear = [(0, 0.0032), (0, BREECH_R - 0.0012), (0.0012, BREECH_R), (0.0095, BREECH_R), (0.0108, BREECH_R - 0.0010), (0.0108, 0.0120), (0.0100, 0.0032)]
    lathe(bm, Vector((0, by0, BZ)), Vector((0, 1, 0)), rear, seg(72, 18), closed=True)
    front = [(0, 0.0128), (0, BREECH_R - 0.0010), (0.0010, BREECH_R + 0.0004), (0.0110, BREECH_R + 0.0004), (0.0122, BREECH_R - 0.0012), (0.0122, 0.0128)]
    lathe(bm, Vector((0, by1 - 0.0122, BZ)), Vector((0, 1, 0)), front, seg(72, 18), closed=True)
    if hi:
        for yy in (by0 + 0.0055, by1 - 0.006):
            for k in range(8):
                a = 2 * math.pi * k / 8 + math.pi / 8
                nn = Vector((math.cos(a), 0, math.sin(a)))
                slotted_screw(bm, Vector((0, yy, BZ)) + nn * (BREECH_R + (0.0004 if yy > 0 else 0.0)), nn, 0.0017, 0.0010, 10)
    bm = add("Cage", "Body", "iron")
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 2
        c = Vector((0, 0, BZ)) + Vector((math.cos(a), 0, math.sin(a))) * (BREECH_R - 0.0025)
        cylinder(bm, (c.x, by0 + 0.010, c.z), (c.x, by1 - 0.012, c.z), 0.0026, seg(16, 6), chamfer=seg(0.0004, 0.0))
    tube(bm, (0, (by0 + by1) / 2 - 0.004, BZ), (0, (by0 + by1) / 2 + 0.004, BZ), BREECH_R, BREECH_R - 0.0026, seg(72, 18), chamfer=seg(0.0005, 0.0))
    bm = add("Spring", "Body", "spring")
    sr = 0.0016 if hi else 0.0018
    sp = helix_pts(Vector((0, by0 + 0.011, BZ)), Vector((0, 1, 0)), 0.0130, (by1 - by0 - 0.024) / 11.0, 11.0, 32 if hi else 9)
    sweep(bm, sp, sr, 10 if hi else 4, cap=True)
    bm = add("Piston", "Body", "steel")
    cylinder(bm, (0, by0 + 0.008, BZ), (0, by1 - 0.010, BZ), 0.0062, seg(32, 10), chamfer=seg(0.0005, 0.0))

    # ---- pressure tank on the outer side + feed pipe to the gauge ---------------
    T = TANK
    bm = add("Tank", "Body", "brass")
    L = T["y1"] - T["y0"]
    tp = [(0, 0), (0.0006, 0.0040), (0.0020, 0.0078), (0.0045, 0.0100), (0.0075, T["r"]), (L - 0.0075, T["r"]), (L - 0.0045, 0.0100), (L - 0.0020, 0.0078), (L - 0.0006, 0.0040), (L, 0)]
    lathe(bm, Vector((T["x"], T["y0"], T["z"])), Vector((0, 1, 0)), tp, seg(64, 16))
    bm = add("TankBands", "Body", "iron")
    for yy in (T["y0"] + 0.020, T["y1"] - 0.020):
        tube(bm, (T["x"], yy - 0.0035, T["z"]), (T["x"], yy + 0.0035, T["z"]), T["r"] + 0.0013, T["r"] - 0.0004, seg(48, 14), chamfer=seg(0.0004, 0.0))
        # strap foot to the outer cheek
        box(bm, (T["x"] - 0.0105, yy, T["z"]), (0.0045, 0.0035, 0.0018), bevel=seg(0.0004, 0.0))
    bm = add("Pipe", "Body", "copper")
    p0 = Vector((T["x"], T["y0"] + 0.002, T["z"] + 0.004))
    gb = GAUGE_C - GAUGE_N * 0.012
    pts = [p0, p0 + Vector((0, -0.010, 0.010)), Vector((0.022, -0.050, 0.110)), Vector((0.004, -0.044, 0.112)), gb + Vector((0.004, -0.010, -0.002)), gb]
    pts = catmull(pts, 8 if hi else 3)
    sweep(bm, pts, 0.0021, 12 if hi else 5, cap=True)
    bm = add("PipeFittings", "Body", "brass")
    for p in (pts[2], pts[-2]):
        pass
    cylinder(bm, p0 + Vector((0, 0.003, -0.004)), p0 + Vector((0, -0.006, 0.006)), 0.0034, seg(6, 6), chamfer=seg(0.0004, 0.0))

    # ---- gauge (case, bezel, dial; the needle is its own bone) ------------------
    bm = add("GaugeCase", "Body", "brass")
    gn = GAUGE_N
    g0 = GAUGE_C - gn * 0.0115
    gprof = [(0, 0), (0, 0.0100), (0.0030, 0.0160), (0.0055, GAUGE_R - 0.0004), (0.0085, GAUGE_R), (0.0110, GAUGE_R + 0.0006)] + \
        ([(0.0110 + 0.0003 * i, GAUGE_R + 0.0012) for i in range(1, 12)] if hi else [(0.0140, GAUGE_R + 0.0012)]) + \
        [(0.0150, GAUGE_R + 0.0004), (0.0152, GAUGE_R - 0.0018), (0.0128, GAUGE_R - 0.0026), (0.0118, GAUGE_R - 0.0026)]

    def gknurl(t, a):
        if 0.0112 <= t <= 0.0142:
            return -0.00035 * (abs(((a * 48 / (2 * math.pi)) % 1.0) - 0.5) < 0.2)
        return 0.0
    gref = Vector((1, 0, 0))
    lathe(bm, g0, gn, gprof, seg(96, 20), ref=gref, disp=gknurl if hi else None)
    # gauge stem down into the breech top
    cylinder(bm, g0 + gn * 0.004, Vector((GAUGE_C.x * 0.6, GAUGE_C.y + 0.004, BZ + BREECH_R - 0.002)), 0.0045, seg(24, 8))
    bm = add("Dial", "Body", "dial")
    lathe(bm, g0 + gn * 0.0112, gn, [(0, 0), (0.0, GAUGE_R - 0.0026), (0.0006, GAUGE_R - 0.0026), (0.0006, 0)], seg(64, 16), ref=gref)
    bm = add("Needle", "Needle", "needle")
    gu, gv = _perp(gn, gref)
    nc = g0 + gn * 0.0124  # needle pivot: rest = pointing at 12 o'clock (gv axis)
    up12 = (gv if gv.dot(Vector((0, 1, 0.3))) > 0 else -gv)
    tipp = nc + up12 * (GAUGE_R - 0.0055)
    tail = nc - up12 * 0.004
    side = gn.cross(up12).normalized()
    if hi:
        loft(bm, [tail, nc, tipp], [(0.0004, 0.0011), (0.0004, 0.0008), (0.0003, 0.0002)], gn, nseg=8, power=4.0, cap0=0.2, cap1=0.2, cap_rings=2)
        cylinder(bm, nc - gn * 0.0002, nc + gn * 0.0012, 0.0014, 24, chamfer=0.0003)
    else:
        loft(bm, [tail, nc, tipp], [(0.0005, 0.0011), (0.0005, 0.0008), (0.0004, 0.0003)], gn, nseg=4, power=2.0, cap0=0.1, cap1=0.1, cap_rings=1)
        cylinder(bm, nc - gn * 0.0002, nc + gn * 0.0012, 0.0014, 8)

    # ---- trigger lever ------------------------------------------------------
    bm = add("Lever", "Trigger", "iron")
    hd = HANDLE_DIR
    lp = []
    nlev = 10 if hi else 5
    for i in range(nlev + 1):
        t = i / nlev
        # down from the pivot along the handle direction, bowing forward, hook at the bottom
        p = LEVER_PIVOT - hd * (0.046 * t) + Vector((0, 0.0045 * math.sin(math.pi * t) + 0.007 * max(0.0, t - 0.78) / 0.22, 0))
        lp.append(p)
    lw = [(0.0030 * (1 - 0.2 * (i / nlev)), 0.0042) for i in range(nlev + 1)]
    loft(bm, lp, lw, Vector((0, 1, 0)), nseg=seg(16, 6), power=3.5, cap0=0.0, cap1=0.7, cap_rings=seg(3, 1))
    cylinder(bm, LEVER_PIVOT + Vector((-0.0058, 0, 0)), LEVER_PIVOT + Vector((0.0058, 0, 0)), 0.0042, seg(24, 8), chamfer=seg(0.0005, 0.0))
    bm = add("LeverPin", "Body", "steel")
    cylinder(bm, LEVER_PIVOT + Vector((-0.0082, 0, 0)), LEVER_PIVOT + Vector((0.0082, 0, 0)), 0.0018, seg(16, 6), chamfer=seg(0.0003, 0.0))
    # lever housing lugs under the frame
    bm2 = P["Frame"][0]
    for sx in (-1, 1):
        box(bm2, (sx * 0.0072, LEVER_PIVOT.y, LEVER_PIVOT.z + 0.002), (0.0014, 0.0065, 0.0062), bevel=seg(0.0004, 0.0))

    # ---- handle: ferrule, leather-cord wrap, pommel ---------------------------
    h0 = Vector((0, 0, 0)) + hd * (0.0505 / hd.z)  # top (frame underside)
    hb = Vector((0, 0, 0)) - hd * (0.050 / hd.z)  # bottom of the wrap
    bm = add("HandleCore", "Body", "wood")
    cylinder(bm, hb - hd * 0.004, h0 + hd * 0.002, HANDLE_R - 0.0016, seg(32, 12))
    bm = add("HandleWrap", "Body", "cord")
    if hi:
        L = (h0 - hb).length - 0.010
        turns = L / 0.0034
        pts = helix_pts(hb + hd * 0.0048, hd, HANDLE_R - 0.0016, 0.0034, turns, 40)
        sweep(bm, pts, 0.00172, 10, cap=True)
    else:
        cylinder(bm, hb + hd * 0.0030, h0 - hd * 0.0068, HANDLE_R, 16)
    bm = add("Ferrules", "Body", "brass")
    lathe(bm, h0 - hd * 0.0105, hd, [(0, 0.0164), (0.0005, 0.0178), (0.0060, 0.0180), (0.0085, 0.0195), (0.0108, 0.0205), (0.0108, 0.0100)], seg(64, 16), closed=True)
    pom = [(0, 0.0176), (0.0005, 0.0186), (0.0060, 0.0190), (0.0075, 0.0200), (0.0110, 0.0198), (0.0150, 0.0170), (0.0175, 0.0110), (0.0185, 0.0)]
    lathe(bm, hb + hd * 0.0040, -hd, [(0, 0.0)] + pom, seg(64, 16))

    # ---- forearm brace, straps, buckles --------------------------------------
    bm = add("Brace", "Body", "iron")
    build_brace(bm, hi)
    if hi:
        for yh in (-0.046, -0.199):
            for k in range(5):
                a = math.pi / 2 - 0.82 + 1.64 * k / 4
                p = sleeve_surface(yh, a, 0.0035 + 0.0026)
                nn = (sleeve_surface(yh, a, 0.02) - p).normalized()
                dome_rivet(bm, p, nn, 0.0021, 0.0014, 12)
        for k in range(-3, 4):
            for yh in [-0.060 - 0.0185 * i for i in range(8)]:
                if k not in (-3, 3):
                    continue
                a = math.pi / 2 + k * 0.30
                p = sleeve_surface(yh, a, 0.0035 + 0.0026)
                nn = (sleeve_surface(yh, a, 0.02) - p).normalized()
                dome_rivet(bm, p, nn, 0.0017, 0.0011, 10)
    for i, yh in enumerate((-0.0975, -0.1735)):
        bms = add(f"Strap{i}", "Body", "strap")
        ba = build_strap(bms, hi, yh)
        bmb = add(f"Buckle{i}", "Body", "brass")
        buckle_frame(bmb, hi, yh, ba)
        strap_tail(P[f"Strap{i}"][0], hi, yh, ba)
    # feet: cheek plates bolted to the brace
    bm = add("Bolts", "Body", "steel")
    for xx, sgn in ((CHEEK_X[0] - 0.0032, -1), (CHEEK_X[1] + 0.0032, 1)):
        for yy in (-0.150, -0.104):
            c = Vector((xx + sgn * 0.0004, yy, 0.0310 if yy < -0.12 else 0.0345))
            nn = Vector((sgn, 0, 0))
            if hi:
                lathe(bm, c, nn, [(0, 0), (0, 0.0034), (0.0018, 0.0034), (0.0022, 0.0028), (0.0022, 0)], 6, phase=math.pi / 6)
            else:
                lathe(bm, c, nn, [(0, 0), (0, 0.0034), (0.0022, 0.0028), (0.0022, 0)], 6, phase=math.pi / 6)

    # ---- lantern hook on the outer side of the brace ---------------------------
    bm = add("Hook", "Body", "iron")
    hp0 = sleeve_surface(-0.070, 0.42, 0.0062)
    out_d = (sleeve_surface(-0.070, 0.42, 0.03) - hp0).normalized()
    hk = [hp0, hp0 + out_d * 0.008, hp0 + out_d * 0.016 + Vector((0, 0, -0.006)), hp0 + out_d * 0.019 + Vector((0, 0, -0.018)),
          hp0 + out_d * 0.013 + Vector((0, 0, -0.027)), hp0 + out_d * 0.007 + Vector((0, 0, -0.024))]
    sweep(bm, catmull(hk, 6 if hi else 2), 0.0021, seg(12, 5), cap=True)
    box(bm, hp0 + out_d * 0.0005, (0.006, 0.010, 0.0016), rot=frame_matrix(*_basis_from_y(Vector((0, 1, 0)), out_d)), bevel=seg(0.0005, 0.0))
    LAUNCHER_SOCKETS["LanternHook"] = hp0 + out_d * 0.0105 + Vector((0, 0, -0.0275))

    # ---- maker's plate on the inner face of the inner cheek plate --------------
    bm = add("Plate", "Body", "plate")
    pc = Vector((CHEEK_X[0] - 0.0032 - 0.0006, -0.104, 0.0700))
    box(bm, pc, (0.0005, 0.0170, 0.0060), bevel=seg(0.0002, 0.0), bseg=1)
    if hi:
        for dy in (-0.0145, 0.0145):
            slotted_screw(bm, pc + Vector((-0.0005, dy, 0)), Vector((-1, 0, 0)), 0.0013, 0.0008, 10)
    return P


LAUNCHER_SOCKETS = {}


def launcher_bones():
    """Rig bones (socket space, right side): name → (head, tail, z, parent)."""
    gn = GAUGE_N
    g0 = GAUGE_C - gn * 0.0115
    return {
        "Body": (Vector((0, -0.200, 0.040)), Vector((0, -0.140, 0.040)), Vector((0, 0, 1)), None),
        "Drum": (Vector((DRUM_C.x, DRUM_C.y, DRUM_C.z)), Vector((DRUM_C.x + 0.03, DRUM_C.y, DRUM_C.z)), Vector((0, 0, 1)), "Body"),
        "Needle": (g0 + gn * 0.0124, g0 + gn * 0.0324, Vector((0, 1, 0.3)), "Body"),
        "Trigger": (LEVER_PIVOT.copy(), LEVER_PIVOT + Vector((0.02, 0, 0)), Vector((0, 0, 1)), "Body"),
        "Slide": (Vector((0, 0.040, BARREL_Z)), Vector((0, 0.090, BARREL_Z)), Vector((0, 0, 1)), "Body"),
        "Head": (Vector((0, MUZZLE_Y, BARREL_Z)), Vector((0, MUZZLE_Y + 0.03, BARREL_Z)), Vector((0, 0, 1)), "Slide"),
    }


# -----------------------------------------------------------------------------
# Glove surface detail (HIGH, hand space): wrinkles, seams, palm patch, stitches
# -----------------------------------------------------------------------------
PALM_PATCH = [(0.004, 0.031), (0.004, -0.033), (0.050, -0.043), (0.083, -0.036), (0.091, -0.020), (0.092, 0.028), (0.074, 0.044), (0.040, 0.046)]


def _poly_inside_dist(pt, poly):
    """Signed distance (m) from a 2D point to a closed polygon (+ inside)."""
    x, y = pt
    inside = False
    dmin = 1e9
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2)) if L2 > 0 else 0.0
        d = math.hypot(x - (x1 + dx * t), y - (y1 + dy * t))
        dmin = min(dmin, d)
    return dmin if inside else -dmin


def glove_seam_paths():
    """Seam polylines (hand space, rough: projected onto the surface later).
    Returns [(points, stitch_offset_side)]."""
    paths = []
    for name in ("Index", "Middle", "Ring", "Pinky"):
        J, Fr = finger_frames(name, REST_CURL[name])
        rf = FINGERS[name]["r"]
        for sgn in (1, -1):
            pts = []
            for i in range(3):
                X, Y, Z = Fr[i]
                for k in range(8):
                    t = k / 8.0
                    c = J[i].lerp(J[i + 1], t)
                    r = rf[i] + (rf[i + 1] - rf[i]) * t
                    if i == 2 and t > 0.55:
                        break
                    pts.append(c + X * (sgn * r * 1.05) - Z * 0.0015)
            # around the dorsal side of the fingertip
            X, Y, Z = Fr[2]
            tipc = J[2].lerp(J[3], 0.55)
            r = rf[2] * 0.95
            for k in range(1, 7):
                a = (math.pi / 2) * k / 6
                pts.append(tipc + X * (sgn * r * math.cos(a)) - Z * (r * math.sin(a)) + Y * (0.004 * math.sin(a)))
            paths.append(pts)
    # thumb keystone: loop around the thumb base + a dorsal line along the thumb
    J, Fr = finger_frames("Thumb", REST_CURL["Thumb"])
    X, Y, Z = Fr[0]
    c = J[0].lerp(J[1], 0.42)
    loop = []
    for k in range(33):
        a = 2 * math.pi * k / 32
        loop.append(c + (X * math.cos(a) + Z * math.sin(a)) * 0.0185 + Y * (0.004 * math.cos(a)))
    paths.append(loop)
    side = []
    for i in range(3):
        X, Y, Z = Fr[i]
        for k in range(8):
            t = k / 8
            side.append(J[i].lerp(J[i + 1], t) - Z * THUMB["r"][i] * 1.05)
    paths.append(side)
    # three decorative "points" on the back of the hand
    for zz in (0.0195, 0.0, -0.0195):
        paths.append([Vector((0.03, y, zz * (0.75 + 0.25 * (y - 0.032) / 0.045))) for y in [0.032 + 0.045 * k / 12 for k in range(13)]])
    # wrist seam (glove body / gathered cuff)
    paths.append([Vector((0.03 * math.cos(2 * math.pi * k / 48), 0.006, 0.04 * math.sin(2 * math.pi * k / 48))) for k in range(49)])
    # palm patch border, 1.8 mm inside the edge
    pp = []
    n = len(PALM_PATCH)
    for i in range(n):
        y1, z1 = PALM_PATCH[i]
        y2, z2 = PALM_PATCH[(i + 1) % n]
        for k in range(10):
            t = k / 10
            pp.append(Vector((-0.03, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t)))
    pp.append(pp[0].copy())
    # inset toward the centroid
    cy = sum(p[0] for p in PALM_PATCH) / n
    cz = sum(p[1] for p in PALM_PATCH) / n
    pp = [Vector((p.x, p.y + (cy - p.y) * 0.06, p.z + (cz - p.z) * 0.06)) for p in pp]
    paths.append(pp)
    return paths


def detail_glove(ob):
    """Displace the remeshed glove (hand space) and add stitch geometry."""
    me = ob.data
    me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
    rng = random.Random(args.seed + 21)
    chains = {n: finger_frames(n, REST_CURL[n]) for n in FINGER_ORDER}
    # 1) project seam paths onto the surface
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    seams = []
    for path in glove_seam_paths():
        dense = []
        for a, b in zip(path[:-1], path[1:]):
            L = (b - a).length
            n = max(1, int(L / 0.0005))
            for k in range(n):
                dense.append(a.lerp(b, k / n))
        dense.append(path[-1])
        proj = []
        for p in dense:
            hit = bvh.find_nearest(p)
            if hit[0] is not None:
                proj.append((hit[0], hit[1]))
        seams.append(proj)
    kd = KDTree(sum(len(s) for s in seams))
    i = 0
    for s in seams:
        for p, _ in s:
            kd.insert(p, i)
            i += 1
    kd.balance()
    # 2) per-vertex displacement (vectorised)
    import numpy as np
    verts = me.vertices
    N = len(verts)
    P = np.empty(N * 3, np.float64)
    verts.foreach_get("co", P)
    P = P.reshape(N, 3)
    Nn = np.empty(N * 3, np.float64)
    verts.foreach_get("normal", Nn)
    Nn = Nn.reshape(N, 3)
    d = np.zeros(N)
    # palm reinforcement patch (raised)
    py, pz = P[:, 1], P[:, 2]
    inside = np.zeros(N, bool)
    dmin = np.full(N, 1e9)
    poly = PALM_PATCH
    for i in range(len(poly)):
        y1, z1 = poly[i]
        y2, z2 = poly[(i + 1) % len(poly)]
        cross = ((z1 > pz) != (z2 > pz)) & (py < (y2 - y1) * (pz - z1) / ((z2 - z1) if z2 != z1 else 1e-9) + y1)
        inside ^= cross
        dy, dz = y2 - y1, z2 - z1
        t = np.clip(((py - y1) * dy + (pz - z1) * dz) / (dy * dy + dz * dz), 0, 1)
        dmin = np.minimum(dmin, np.hypot(py - (y1 + dy * t), pz - (z1 + dz * t)))
    sd = np.where(inside, dmin, -dmin)
    sel = (Nn[:, 0] < -0.25) & (P[:, 0] < 0.0)
    tt = np.clip((sd + 0.0003) / 0.0009, 0, 1)
    d += np.where(sel, 0.00085 * tt * tt * (3 - 2 * tt), 0.0)
    # seam grooves
    sdist = np.array([kd.find(Vector(p))[2] for p in P])
    d -= np.where(sdist < 0.0013, 0.00042 * (1 - (sdist / 0.0013) ** 2), 0.0)
    # nearest finger segment per vertex
    best_d = np.full(N, 1e9)
    best_k = np.full(N, -1)
    segs = []
    for name in FINGER_ORDER:
        J, Fr = chains[name]
        for j in range(3):
            A = np.array(J[j])
            B = np.array(J[j + 1])
            AB = B - A
            t = np.clip(((P - A) @ AB) / AB.dot(AB), 0, 1)
            dd = np.linalg.norm(P - (A + t[:, None] * AB), axis=1)
            k = len(segs)
            segs.append((name, j))
            upd = dd < best_d
            best_d[upd] = dd[upd]
            best_k[upd] = k
    for k, (name, j) in enumerate(segs):
        rr = (THUMB["r"] if name == "Thumb" else FINGERS[name]["r"])[j]
        m = (best_k == k) & (best_d < rr * 1.6)
        if not m.any():
            continue
        J, Fr = chains[name]
        Pm, Nm = P[m], Nn[m]
        add = np.zeros(m.sum())
        for jj in (1, 2):
            Yd = np.array(Fr[min(jj, 2)][1])
            Zd = np.array(Fr[min(jj, 2)][2])
            dlt = (Pm - np.array(J[jj])) @ Yd
            dors = np.clip(Nm @ -Zd, 0, None)
            palm = np.clip(Nm @ Zd, 0, None)
            add += 0.00038 * np.exp(-(dlt / 0.0058) ** 2) * np.sin(2 * np.pi * dlt / 0.0029 + 1.3 * jj) * dors ** 0.7
            add -= 0.00055 * np.exp(-(dlt / 0.0011) ** 2) * palm
        if j == 0 and name != "Thumb":
            Yd = np.array(Fr[0][1])
            Zd = np.array(Fr[0][2])
            dlt = (Pm - np.array(J[0])) @ Yd
            dors = np.clip(Nm @ -Zd, 0, None)
            add += 0.00030 * np.exp(-(dlt / 0.0075) ** 2) * np.sin(2 * np.pi * dlt / 0.0034) * dors
        d[m] += add
    # gathered (shirred) elastic wrist: longitudinal ridges
    m = (P[:, 1] > -0.030) & (P[:, 1] < 0.002)
    ang = np.arctan2(P[:, 2], P[:, 0])
    w = np.sin(np.pi * (P[:, 1] + 0.030) / 0.032)
    d += np.where(m, 0.00045 * w * np.sin(ang * 44 + 2.0 * np.sin(P[:, 1] * 260)) ** 3, 0.0)
    # loose leather on the back of the hand
    m = (Nn[:, 0] > 0.3) & (P[:, 1] > 0.01) & (P[:, 1] < 0.085)
    d += np.where(m, 0.00028 * np.sin(P[:, 1] * 410 + 3 * np.sin(P[:, 2] * 220)) * np.sin(P[:, 2] * 330 + 1.0), 0.0)
    P += Nn * d[:, None]
    verts.foreach_set("co", P.reshape(-1))
    me.update()
    # 3) stitches along the seams
    bm = bmesh.new()
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    count = 0
    for s in seams:
        acc = 0.0
        for k in range(1, len(s)):
            acc += (s[k][0] - s[k - 1][0]).length
            if acc < 0.0034:
                continue
            acc = 0.0
            p, n = s[k]
            hit = bvh.find_nearest(p)
            if hit[0] is None:
                continue
            p, n = hit[0], hit[1]
            tdir = (s[min(k + 1, len(s) - 1)][0] - s[k - 1][0])
            tdir = (tdir - n * tdir.dot(n)).normalized()
            if tdir.length < 0.5:
                continue
            side = tdir.cross(n)
            rot = frame_matrix(side, tdir, n)  # right-handed, so the ellipsoid keeps outward normals
            ellipsoid(bm, p + n * 0.00005, (0.00052, 0.00125, 0.00036), rot, seg=8, rings=5)
            count += 1
    st = new_obj("Glove_Stitches_R", bm, ob.users_collection[0])
    log("glove details: stitches", count)
    return st


# -----------------------------------------------------------------------------
# Lantern (lantern-local frame: origin = the bail's hook point, hangs along −Z)
# -----------------------------------------------------------------------------
LANTERN_SOCKET = Vector((0.0, 0.0, -0.068))


def build_lantern(hi):
    P = {}

    def add(name, mat):
        bm = bmesh.new()
        P[name] = (bm, "Lantern", mat)
        return bm

    def seg(h, lo):
        return h if hi else lo
    bm = add("LanBail", "iron")
    torus(bm, (0, 0, -0.0072), Vector((1, 0, 0)), 0.0060, 0.0012, seg(32, 8), seg(10, 4))
    arc = [Vector((0.0185 * math.cos(t), 0.0, -0.0345 + 0.0215 * math.sin(t))) for t in [math.pi * k / 16 for k in range(17)]]
    sweep(bm, arc, 0.00105, seg(10, 4))
    for sx in (-1, 1):
        cylinder(bm, (sx * 0.0175, -0.0028, -0.0345), (sx * 0.0175, 0.0028, -0.0345), 0.0022, seg(16, 6))
    bm = add("LanCap", "brass")
    cap = [(0, 0), (0, 0.0052), (0.0012, 0.0062), (0.0062, 0.0062), (0.0070, 0.0082), (0.0172, 0.0198), (0.0182, 0.0214), (0.0204, 0.0214), (0.0210, 0.0196), (0.0210, 0.0)]
    lathe(bm, Vector((0, 0, -0.0290)), Vector((0, 0, -1)), cap, seg(64, 14))
    if hi:
        for k in range(8):  # vent slots read as dark recesses
            a = 2 * math.pi * k / 8
            nn = Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, 0.6)).normalized()
            dome_rivet(bm, Vector((math.cos(a) * 0.0128, math.sin(a) * 0.0128, -0.0410)), nn, 0.0016, 0.0009, 10)
    bm = add("LanGlass", "glass")
    gl = [(0, 0), (0, 0.0158), (0.004, 0.0172), (0.019, 0.0186), (0.034, 0.0172), (0.0385, 0.0158), (0.0385, 0)]
    lathe(bm, Vector((0, 0, -0.0500)), Vector((0, 0, -1)), gl, seg(64, 14))
    bm = add("LanGuard", "iron")
    for k in range(4):
        a = 2 * math.pi * k / 4 + math.pi / 4
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [d * (0.0196 + 0.0034 * math.sin(math.pi * t)) + Vector((0, 0, -0.0495 - 0.039 * t)) for t in [i / 10 for i in range(11)]]
        sweep(bm, pts, 0.0011, seg(8, 4))
    torus(bm, (0, 0, -0.0690), Vector((0, 0, 1)), 0.0228, 0.0010, seg(48, 12), seg(8, 4))
    bm = add("LanBase", "brass")
    base = [(0, 0), (0, 0.0200), (0.0016, 0.0218), (0.0110, 0.0226), (0.0150, 0.0214), (0.0182, 0.0186), (0.0196, 0.0120), (0.0200, 0.0)]
    lathe(bm, Vector((0, 0, -0.0880)), Vector((0, 0, -1)), base, seg(64, 14))
    cylinder(bm, (0.0215, 0, -0.0955), (0.0275, 0, -0.0955), 0.0042, seg(24, 8), chamfer=seg(0.0006, 0.0))
    return P


# -----------------------------------------------------------------------------
# Bake-pass materials (HIGH meshes). Each material exposes sockets for the passes:
#   NORMAL  — Principled BSDF with the material's bump detail
#   MATID   — flat id colour   BASE — clean base colour (images: dial, plate)
#   DETAIL  — RGB procedural fields (R blotch, G mottling, B material pattern)
#   EDGE    — bevel-normal edge mask   EMIT — emission mask
# The look is then composited per material in numpy (see composite()).
# -----------------------------------------------------------------------------
MAT_CLASSES = ["leather", "thread", "canvas", "strap", "cord", "iron", "forged", "steel", "brass", "copper", "cable", "spring",
               "dial", "needle", "lamp", "glass", "plate", "wood"]
_LV = (0.12, 0.5, 0.88)
MAT_ID_COL = {c: (_LV[i % 3], _LV[(i // 3) % 3], _LV[(i // 9) % 3]) for i, c in enumerate(MAT_CLASSES)}
BASE_COL = {
    "leather": (0.090, 0.056, 0.034), "thread": (0.50, 0.42, 0.29), "canvas": (0.080, 0.075, 0.055), "strap": (0.17, 0.072, 0.030),
    "cord": (0.065, 0.042, 0.028), "iron": (0.032, 0.037, 0.048), "forged": (0.045, 0.043, 0.041), "steel": (0.42, 0.42, 0.43),
    "brass": (0.72, 0.52, 0.24), "copper": (0.78, 0.40, 0.26), "cable": (0.27, 0.26, 0.24), "spring": (0.22, 0.22, 0.23),
    "dial": (0.78, 0.72, 0.58), "needle": (0.42, 0.05, 0.02), "lamp": (1.0, 0.86, 0.62), "glass": (1.0, 0.80, 0.50),
    "plate": (0.72, 0.52, 0.24), "wood": (0.20, 0.12, 0.06),
}
HB = {}  # class → {"mat", "out", "emis", "bsdf", "pass": {name: socket}}


class NB:
    def __init__(self, mat):
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

    def math(self, op, a, b=0.0, clamp=False):
        nd = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
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


def hb_material(cls, kind=None):
    """Bake material for one class (see the table above)."""
    mat = bpy.data.materials.new("HB_" + cls)
    b = NB(mat)
    out = b.n("ShaderNodeOutputMaterial")
    emis = b.n("ShaderNodeEmission")
    bsdf = b.n("ShaderNodeBsdfPrincipled")
    tc = b.n("ShaderNodeTexCoord")
    co = tc.outputs["Object"]
    height = None
    strength, dist = 0.5, 0.0003
    pattern = 0.0
    base = b.rgb(BASE_COL[cls])
    emit = 0.0
    # forearm cylindrical coordinates (sleeve weave, strap stitching)
    W = S(WRIST)
    ax = SD((0, -1, 0))
    e1, e2 = SD((1, 0, 0)), SD((0, 0, 1))
    rel = b.vmath("SUBTRACT", co, tuple(W))
    along = b.vmath("DOT_PRODUCT", rel, tuple(ax), out=1)
    ang = b.math("ARCTAN2", b.vmath("DOT_PRODUCT", rel, tuple(e2), out=1), b.vmath("DOT_PRODUCT", rel, tuple(e1), out=1))
    around = b.math("MULTIPLY", ang, 0.047)
    if cls == "leather":
        grain = b.smooth(b.voronoi(co, 900.0), 0.0, 0.75)
        pores = b.noise(co, 2600.0, 2.0)
        cellsd = b.voronoi(b.vmath("ADD", co, b.vmath("SCALE", b.combine(b.noise(co, 90.0), b.noise(co, 91.0), 0.5), None) if False else co), 230.0, "DISTANCE_TO_EDGE", "Distance")
        crack = b.math("MULTIPLY", b.math("SUBTRACT", 1.0, b.smooth(cellsd, 0.0, 0.05)), b.smooth(b.noise(co, 22.0, 3.0), 0.52, 0.66))
        height = b.math("SUBTRACT", b.math("ADD", b.math("MULTIPLY", grain, 0.55), b.math("MULTIPLY", pores, 0.2)), b.math("MULTIPLY", crack, 1.3))
        strength, dist = 0.7, 0.00035
        pattern = crack
    elif cls == "canvas":
        u = b.math("MULTIPLY", around, 1 / 0.0019)
        v = b.math("MULTIPLY", along, 1 / 0.0019)
        warp = b.math("SINE", b.math("MULTIPLY", b.math("ADD", u, b.math("MULTIPLY", v, 0.5)), 2 * math.pi))
        weft = b.math("SINE", b.math("MULTIPLY", b.math("SUBTRACT", v, b.math("MULTIPLY", u, 0.5)), 2 * math.pi))
        weave = b.math("MULTIPLY", b.math("ADD", warp, weft), 0.25)
        height = b.math("ADD", weave, b.math("MULTIPLY", b.noise(co, 700.0, 2.0), 0.4))
        strength, dist = 0.35, 0.0003
        pattern = b.math("ADD", b.math("MULTIPLY", weave, 0.5), 0.5)
    elif cls == "strap":
        # stitch rows 2.6 mm in from both strap edges; strap centres at hand y −0.0975 / −0.1735
        yc = b.math("SUBTRACT", b.math("ABSOLUTE", b.math("SUBTRACT", b.math("FLOORED_MODULO", b.math("ADD", along, 0.0975 + 0.038), 0.076), 0.038)), 0.0)
        edge_off = b.math("ABSOLUTE", b.math("SUBTRACT", yc, 0.012 - 0.0026))
        row = b.math("SUBTRACT", 1.0, b.smooth(edge_off, 0.00025, 0.0007))
        dash = b.smooth(b.math("SINE", b.math("MULTIPLY", around, 2 * math.pi / 0.0042)), 0.1, 0.5)
        stitch = b.math("MULTIPLY", row, dash)
        grain = b.smooth(b.voronoi(co, 520.0), 0.0, 0.8)
        height = b.math("ADD", b.math("MULTIPLY", grain, 0.35), b.math("SUBTRACT", b.math("MULTIPLY", stitch, 1.2), b.math("MULTIPLY", row, 0.6)))
        strength, dist = 0.6, 0.0004
        pattern = stitch
    elif cls in ("iron", "forged", "steel", "spring"):
        pits = b.smooth(b.voronoi(co, 1400.0 if cls != "forged" else 700.0), 0.0, 0.35)
        ham = b.noise(co, 140.0 if cls == "forged" else 380.0, 3.0)
        height = b.math("ADD", b.math("MULTIPLY", ham, 0.6 if cls == "forged" else 0.25), b.math("MULTIPLY", pits, 0.25))
        strength, dist = (0.5 if cls == "forged" else 0.25), 0.0003
        sc = b.n("ShaderNodeTexWave", wave_type="BANDS")
        b.inp(sc, "Vector", co)
        sc.inputs["Scale"].default_value = 55.0
        sc.inputs["Distortion"].default_value = 14.0
        sc.inputs["Detail"].default_value = 4.0
        pattern = b.math("SUBTRACT", 1.0, b.smooth(b.math("ABSOLUTE", b.math("SUBTRACT", sc.outputs["Fac"], 0.5)), 0.0, 0.035))
    elif cls in ("brass", "copper", "plate"):
        height = b.math("MULTIPLY", b.noise(co, 500.0, 2.0), 0.15)
        strength, dist = 0.2, 0.0003
        sc = b.n("ShaderNodeTexWave", wave_type="BANDS")
        b.inp(sc, "Vector", co)
        sc.inputs["Scale"].default_value = 65.0
        sc.inputs["Distortion"].default_value = 16.0
        sc.inputs["Detail"].default_value = 4.0
        pattern = b.math("SUBTRACT", 1.0, b.smooth(b.math("ABSOLUTE", b.math("SUBTRACT", sc.outputs["Fac"], 0.5)), 0.0, 0.03))
        if cls == "plate":
            img = PLATE_IMG
            pc, pu, pv, pw, ph = PLATE_FRAME
            rr = b.vmath("SUBTRACT", co, tuple(pc))
            uu = b.math("ADD", b.math("DIVIDE", b.vmath("DOT_PRODUCT", rr, tuple(pu), out=1), pw), 0.5)
            vv = b.math("ADD", b.math("DIVIDE", b.vmath("DOT_PRODUCT", rr, tuple(pv), out=1), ph), 0.5)
            it = b.n("ShaderNodeTexImage", image=img, extension="CLIP")
            b.link(b.combine(uu, vv, 0.0), it.inputs["Vector"])
            eng = it.outputs["Color"]
            eng_f = b.n("ShaderNodeSeparateColor")
            b.link(eng, eng_f.inputs[0])
            height = b.math("SUBTRACT", height, b.math("MULTIPLY", eng_f.outputs[0], 1.0))
            strength, dist = 1.0, 0.00035
            pattern = eng_f.outputs[0]
    elif cls == "cord":
        height = b.math("MULTIPLY", b.noise(co, 1500.0, 2.0), 0.5)
        strength = 0.3
    elif cls == "cable":
        height = b.math("MULTIPLY", b.noise(co, 1800.0, 2.0), 0.5)
        strength = 0.3
    elif cls == "dial":
        img = DIAL_IMG
        gc, gu, gv, gr = DIAL_FRAME
        rr = b.vmath("SUBTRACT", co, tuple(gc))
        uu = b.math("ADD", b.math("DIVIDE", b.vmath("DOT_PRODUCT", rr, tuple(gu), out=1), 2 * gr), 0.5)
        vv = b.math("ADD", b.math("DIVIDE", b.vmath("DOT_PRODUCT", rr, tuple(gv), out=1), 2 * gr), 0.5)
        it = b.n("ShaderNodeTexImage", image=img, extension="CLIP")
        b.link(b.combine(uu, vv, 0.0), it.inputs["Vector"])
        base = it.outputs["Color"]
        it2 = b.n("ShaderNodeTexImage", image=DIAL_EMIT_IMG, extension="CLIP")
        b.link(b.combine(uu, vv, 0.0), it2.inputs["Vector"])
        sep = b.n("ShaderNodeSeparateColor")
        b.link(it2.outputs["Color"], sep.inputs[0])
        emit = b.math("MULTIPLY", sep.outputs[0], 0.45)
    elif cls in ("lamp", "glass"):
        emit = 1.0
    if not isinstance(pattern, float):
        pass
    # bump → BSDF
    if height is not None:
        bump = b.n("ShaderNodeBump")
        bump.inputs["Strength"].default_value = strength
        bump.inputs["Distance"].default_value = dist
        b.link(height, bump.inputs["Height"])
        b.link(bump.outputs["Normal"], bsdf.inputs["Normal"])
    b.link(base if not isinstance(base, tuple) else b.rgb(base), bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.5
    bsdf.inputs["Metallic"].default_value = 1.0 if cls in ("iron", "forged", "steel", "brass", "copper", "plate", "spring") else 0.0
    # edge mask (bevel normal vs true normal)
    bev = b.n("ShaderNodeBevel", samples=8)
    bev.inputs["Radius"].default_value = 0.0018 if cls in ("leather", "canvas", "strap", "cord") else 0.0011
    geo = b.n("ShaderNodeNewGeometry")
    dotn = b.vmath("DOT_PRODUCT", bev.outputs[0], geo.outputs["Normal"], out=1)
    edge = b.math("MULTIPLY", b.math("SUBTRACT", 1.0, dotn), 9.0, clamp=True)
    # detail fields + object random (per-part variation)
    oi = b.n("ShaderNodeObjectInfo")
    co2 = b.vmath("ADD", co, b.vmath("SCALE", b.combine(oi.outputs["Random"], oi.outputs["Random"], oi.outputs["Random"]), None) if False else co)
    d1 = b.noise(co2, 26.0, 5.0, 0.6)
    d2 = b.noise(co2, 160.0, 4.0, 0.6)
    pat = pattern if not isinstance(pattern, float) else b.value(pattern)
    det = b.combine(d1, d2, pat)
    HB[cls] = {"mat": mat, "out": out, "emis": emis, "bsdf": bsdf,
               "pass": {"MATID": b.rgb(MAT_ID_COL[cls]), "BASE": base if not isinstance(base, tuple) else b.rgb(base),
                        "DETAIL": det, "EDGE": edge, "EMIT": emit if not isinstance(emit, float) else b.value(emit)}}
    set_hb_pass(cls, "NORMAL")
    return mat


def set_hb_pass(cls, pname):
    h = HB[cls]
    nt = h["mat"].node_tree
    for l in list(h["out"].inputs["Surface"].links):
        nt.links.remove(l)
    if pname in ("NORMAL", "AO"):
        nt.links.new(h["bsdf"].outputs[0], h["out"].inputs["Surface"])
    else:
        for l in list(h["emis"].inputs["Color"].links):
            nt.links.remove(l)
        src = h["pass"][pname]
        if src.type in ("VALUE",):
            cmb = nt.nodes.new("ShaderNodeCombineXYZ")
            for i in range(3):
                nt.links.new(src, cmb.inputs[i])
            src = cmb.outputs[0]
        nt.links.new(src, h["emis"].inputs["Color"])
        h["emis"].inputs["Strength"].default_value = 1.0
        nt.links.new(h["emis"].outputs[0], h["out"].inputs["Surface"])


# --- printed / engraved graphics (Pillow) -------------------------------------
DIAL_IMG = DIAL_EMIT_IMG = PLATE_IMG = None
DIAL_FRAME = PLATE_FRAME = None


def _font(sz, bold=True):
    from PIL import ImageFont
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def make_graphics(tmpdir):
    """Gauge dial (enamel face, ticks, numerals, red zone) + the maker's plate."""
    global DIAL_IMG, DIAL_EMIT_IMG, PLATE_IMG
    from PIL import Image, ImageDraw, ImageFilter
    N = 1024
    face = Image.new("RGB", (N, N), (226, 214, 182))
    emit = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(face)
    de = ImageDraw.Draw(emit)
    c = N / 2
    R = N * 0.47
    d.ellipse((c - R, c - R, c + R, c + R), outline=(60, 45, 30), width=10)
    # red zone 80–100 %
    for k in range(60):
        a = math.radians(-135 + 270 * (0.8 + 0.2 * k / 59))
        x0, y0 = c + math.sin(a) * R * 0.80, c - math.cos(a) * R * 0.80
        x1, y1 = c + math.sin(a) * R * 0.93, c - math.cos(a) * R * 0.93
        d.line((x0, y0, x1, y1), fill=(150, 30, 18), width=12)
    for i in range(51):
        a = math.radians(-135 + 270 * i / 50)
        big = i % 5 == 0
        r0 = R * (0.74 if big else 0.82)
        x0, y0 = c + math.sin(a) * r0, c - math.cos(a) * r0
        x1, y1 = c + math.sin(a) * R * 0.93, c - math.cos(a) * R * 0.93
        d.line((x0, y0, x1, y1), fill=(25, 20, 15), width=9 if big else 4)
        if big:
            de.line((x0, y0, x1, y1), fill=255, width=11)
        if i % 10 == 0:
            f = _font(70)
            t = str(i // 5)
            x, y = c + math.sin(a) * R * 0.58, c - math.cos(a) * R * 0.58
            bb = d.textbbox((0, 0), t, font=f)
            d.text((x - (bb[2] - bb[0]) / 2, y - (bb[3] - bb[1]) / 2 - bb[1]), t, fill=(25, 20, 15), font=f)
    f2 = _font(44)
    for t, yy in (("TETHER", 0.62), ("ATM x10", 0.70)):
        bb = d.textbbox((0, 0), t, font=f2)
        d.text((c - (bb[2] - bb[0]) / 2, N * yy), t, fill=(70, 50, 35), font=f2)
    d.ellipse((c - 34, c - 34, c + 34, c + 34), fill=(35, 30, 25))
    face = face.filter(ImageFilter.GaussianBlur(1.2))
    emit = emit.filter(ImageFilter.GaussianBlur(3))
    fp = os.path.join(tmpdir, "dial.png")
    face.save(fp)
    ep = os.path.join(tmpdir, "dial_emit.png")
    emit.save(ep)
    # maker's plate: engraved lettering + border (white = engraved)
    W_, H_ = 1400, 500
    pl = Image.new("L", (W_, H_), 0)
    dp = ImageDraw.Draw(pl)
    dp.rectangle((22, 22, W_ - 23, H_ - 23), outline=255, width=10)
    for t, yy, sz in (("LANTERNWRIGHTS", 0.13, 150), ("TETHER  ·  Nº 7", 0.55, 120)):
        f = _font(sz)
        bb = dp.textbbox((0, 0), t, font=f)
        dp.text(((W_ - (bb[2] - bb[0])) / 2, H_ * yy - bb[1]), t, fill=255, font=f)
    pl = pl.filter(ImageFilter.GaussianBlur(2.0))
    pp = os.path.join(tmpdir, "plate.png")
    pl.save(pp)
    DIAL_IMG = bpy.data.images.load(fp)
    DIAL_EMIT_IMG = bpy.data.images.load(ep)
    PLATE_IMG = bpy.data.images.load(pp)
    for im in (DIAL_EMIT_IMG, PLATE_IMG):
        im.colorspace_settings.name = "Non-Color"


def dial_frames():
    global DIAL_FRAME, PLATE_FRAME
    gn = GAUGE_N
    g0 = GAUGE_C - gn * 0.0115
    gu, gv = _perp(gn, Vector((1, 0, 0)))
    up12 = gv if gv.dot(Vector((0, 1, 0.3))) > 0 else -gv
    right = up12.cross(gn).normalized()
    DIAL_FRAME = (g0 + gn * 0.0118, right, up12, GAUGE_R - 0.0026)
    pc = Vector((CHEEK_X[0] - 0.0032 - 0.0011, -0.104, 0.0700))
    # read from the inner (−X) side: right = −Y, up = +Z
    PLATE_FRAME = (pc, Vector((0, -1, 0)), Vector((0, 0, 1)), 0.034, 0.012)


# -----------------------------------------------------------------------------
# Baking
# -----------------------------------------------------------------------------
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


def bake_groups(groups, res, cache):
    """groups: [(name, [low objs], [high objs])]. Bakes every pass into numpy arrays
    (cached as .npy), merging groups by coverage (alpha) and dilating the gutters."""
    import numpy as np
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = 0.035  # AO = local contact occlusion (3.5 cm)
    scene.render.bake.margin = 0
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.use_cage = False
    all_objs = list(scene.objects)
    low_mat = bpy.data.materials.new("LOWBAKE")
    ln = low_mat.node_tree.nodes
    imgnode = ln.new("ShaderNodeTexImage")
    ln.active = imgnode
    results = {}
    passes = [("NORMAL", "NORMAL", 4), ("AO", "AO", args.bake_samples), ("MATID", "EMIT", 1), ("BASE", "EMIT", 2),
              ("DETAIL", "EMIT", 2), ("EDGE", "EMIT", 6), ("EMIT", "EMIT", 1)]
    for pname, btype, spp in passes:
        cpath = os.path.join(cache, f"bake_{pname}_{res}.npy")
        if os.path.exists(cpath):
            results[pname] = np.load(cpath)
            log("bake (cached)", pname)
            continue
        for cls in HB:
            set_hb_pass(cls, pname)
        scene.cycles.samples = spp
        acc = np.zeros((res, res, 4), dtype=np.float32)
        cov = np.zeros((res, res), dtype=bool)
        for gname, lows, highs in groups:
            img = _new_float_img(f"bk_{pname}_{gname}", res)
            imgnode.image = img
            # temp target = joined copies of the group's lows (atlas UVs kept)
            me = bpy.data.meshes.new("bk_tmp")
            bm = bmesh.new()
            for lo in lows:
                tmpme = lo.data.copy()
                tmpme.transform(lo.matrix_world)
                bm.from_mesh(tmpme)
                bpy.data.meshes.remove(tmpme)
            bm.to_mesh(me)
            bm.free()
            me.materials.clear()
            me.materials.append(low_mat)
            tmp = bpy.data.objects.new("bk_tmp", me)
            scene.collection.objects.link(tmp)
            for o in tmp.data.polygons:
                o.use_smooth = True
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
            cage = 0.0045 if gname == "arm" else 0.0030
            kw = dict(type=btype, use_selected_to_active=True, cage_extrusion=cage, max_ray_distance=cage * 2.2,
                      margin=0, use_clear=False, target="IMAGE_TEXTURES")  # untouched pixels keep alpha 0 → coverage
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
            log(f"bake {pname} [{gname}] {time.time() - t0:.1f}s px={int(m.sum())}")
        for o in all_objs:
            o.hide_render = False
        out = dilate(acc[..., :3], cov, 24)
        np.save(cpath, out)
        np.save(os.path.join(cache, f"bake_COV_{res}.npy"), cov)
        results[pname] = out
    results["COV"] = np.load(os.path.join(cache, f"bake_COV_{res}.npy"))
    for cls in HB:
        set_hb_pass(cls, "NORMAL")
    return results


def dilate(img, cov, iters):
    """Grow covered pixels into the gutters (4-neighbour average), so mip-maps and
    bilinear filtering never pull in black."""
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


def bake_groups_for(launcher_parts_low, launcher_parts_high, extra):
    """Split launcher parts into bake groups whose highs never come within 6 mm
    of each other (so a cage ray can only find its own part)."""
    def bbox(objs):
        mn = Vector((1e9, 1e9, 1e9))
        mx = Vector((-1e9, -1e9, -1e9))
        for o in objs:
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                mn = Vector((min(mn[i], w[i]) for i in range(3)))
                mx = Vector((max(mx[i], w[i]) for i in range(3)))
        return mn, mx
    names = sorted(launcher_parts_low, key=lambda n: -tri_count(launcher_parts_low[n]))
    boxes = {n: bbox(launcher_parts_high[n]) for n in names}
    pad = 0.006
    groups = []
    for n in names:
        mn, mx = boxes[n]
        placed = False
        for g in groups:
            clash = False
            for m in g:
                a0, a1 = boxes[m]
                if all(mn[i] - pad < a1[i] and a0[i] < mx[i] + pad for i in range(3)):
                    clash = True
                    break
            if not clash:
                g.append(n)
                placed = True
                break
        if not placed:
            groups.append([n])
    out = []
    for i, g in enumerate(groups):
        out.append((f"L{i}", [launcher_parts_low[n] for n in g], [h for n in g for h in launcher_parts_high[n]]))
    return out + extra


# -----------------------------------------------------------------------------
# Material compositing (numpy): the look of each material from the bake passes
# -----------------------------------------------------------------------------
def composite(R, res, outdir, tag=""):
    import numpy as np
    from PIL import Image
    nrm = R["NORMAL"]
    ao = np.clip(R["AO"][..., 0], 0, 1)
    edge = np.clip(R["EDGE"][..., 0], 0, 1)
    det = R["DETAIL"]
    d1, d2, d3 = det[..., 0], det[..., 1], np.clip(det[..., 2], 0, 1)
    base = R["BASE"]
    em = np.clip(R["EMIT"][..., 0], 0, 1)
    ids = R["MATID"]
    cols = np.array([MAT_ID_COL[c] for c in MAT_CLASSES], dtype=np.float32)
    dist = ((ids[..., None, :] - cols[None, None, :, :]) ** 2).sum(-1)
    cls = dist.argmin(-1)
    # small-scale convexity from the normal map (divergence of the tangent normal)
    nx = nrm[..., 0] * 2 - 1
    ny = nrm[..., 1] * 2 - 1
    div = (np.roll(nx, -1, 1) - np.roll(nx, 1, 1)) + (np.roll(ny, -1, 0) - np.roll(ny, 1, 0))
    k = res / 2048.0
    cvx = np.clip(div * 2.2 / k, -1, 1)
    convex = np.clip(cvx, 0, 1)
    cav = np.clip((1 - ao) * 1.7, 0, 1)

    def sm(x, a, b):
        t = np.clip((x - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)

    def mix(a, b, t):
        t = np.asarray(t)
        if t.ndim == 1:
            t = t[:, None]
        return a * (1 - t) + b * t

    def C(c):
        return np.array(c, dtype=np.float32)[None, None, :]

    alb = np.zeros((res, res, 3), np.float32)
    rough = np.full((res, res), 0.5, np.float32)
    metal = np.zeros((res, res), np.float32)
    for i, c in enumerate(MAT_CLASSES):
        m = cls == i
        if not m.any():
            continue
        e, cv, cx, n1, n2, n3 = edge[m], cav[m], convex[m], d1[m], d2[m], d3[m]
        b0 = base[m]
        if c in ("iron", "forged", "steel", "spring"):
            if c == "iron":
                col = C((0.030, 0.035, 0.047)) * (0.75 + 0.5 * n1)[:, None]
                col = col.reshape(-1, 3)
                col = mix(col, C((0.055, 0.045, 0.040)).reshape(1, 3), sm(n2, 0.55, 0.8) * 0.6)
            elif c == "forged":
                col = (C((0.040, 0.038, 0.036)) * (0.7 + 0.6 * n1)[:, None]).reshape(-1, 3)
            elif c == "steel":
                col = (C((0.40, 0.40, 0.41)) * (0.8 + 0.35 * n1)[:, None]).reshape(-1, 3)
            else:
                col = (C((0.20, 0.20, 0.21)) * (0.8 + 0.4 * n1)[:, None]).reshape(-1, 3)
            wear = np.clip(e * 1.5 + cx * 0.9, 0, 1) * (0.3 + 0.7 * sm(n2, 0.35, 0.72))
            if c == "steel":
                wear *= 0.5
            col = mix(col, C((0.50, 0.50, 0.51)).reshape(1, 3), wear)
            col = mix(col, C((0.62, 0.62, 0.63)).reshape(1, 3), n3 * 0.35 * (1 - cv))  # fine scratches
            soot = cv * (0.55 + 0.45 * n1)
            col = col * (1 - 0.7 * soot)[:, None]
            rust = sm(n1 * 0.55 + cv * 0.75 + n2 * 0.25, 0.80, 1.0) * (0.0 if c == "steel" else 1.0)
            col = mix(col, C((0.17, 0.065, 0.028)).reshape(1, 3), rust * 0.85)
            r = 0.36 + 0.14 * n2 - 0.14 * wear + 0.32 * soot + 0.40 * rust
            mt = 1.0 - 0.85 * rust - 0.35 * soot
        elif c in ("brass", "copper", "plate"):
            if c == "copper":
                clean, tarn, polish = (0.80, 0.42, 0.28), (0.30, 0.13, 0.08), (0.95, 0.60, 0.42)
            else:
                clean, tarn, polish = (0.74, 0.54, 0.25), (0.30, 0.20, 0.09), (0.96, 0.80, 0.48)
            t = np.clip(sm(n1, 0.30, 0.80) * 0.65 + cv * 0.7, 0, 1)
            col = mix(np.broadcast_to(C(clean).reshape(1, 3), (m.sum(), 3)).copy(), C(tarn).reshape(1, 3), t)
            pol = np.clip(e * 1.6 + cx * 1.0, 0, 1) * (0.4 + 0.6 * sm(n2, 0.3, 0.7))
            col = mix(col, C(polish).reshape(1, 3), pol)
            col = mix(col, C((0.86, 0.70, 0.40)).reshape(1, 3), n3 * 0.25 * (1 - cv))
            verd = sm(cv, 0.55, 0.9) * sm(n2, 0.45, 0.7) * 0.8
            col = mix(col, C((0.16, 0.25, 0.19)).reshape(1, 3), verd)
            r = 0.30 + 0.25 * t - 0.16 * pol + 0.45 * verd
            mt = 1.0 - verd
            if c == "plate":
                engr = n3
                col = mix(col, C((0.025, 0.020, 0.016)).reshape(1, 3), engr)
                r = r * (1 - engr) + 0.65 * engr
                mt = mt * (1 - engr)
        elif c == "leather":
            col = (C((0.085, 0.052, 0.031)) * (0.75 + 0.55 * n1)[:, None]).reshape(-1, 3)
            wear = np.clip(cx * 1.2 + e * 0.8, 0, 1) * (0.35 + 0.65 * sm(n2, 0.35, 0.7))
            col = mix(col, C((0.19, 0.135, 0.092)).reshape(1, 3), wear * 0.85)
            col = mix(col, C((0.23, 0.18, 0.13)).reshape(1, 3), n3 * 0.7)  # dry cracks
            dirt = cv * (0.5 + 0.5 * n1)
            col = col * (1 - 0.55 * dirt)[:, None]
            r = 0.60 + 0.10 * n2 - 0.20 * wear + 0.18 * n3 + 0.08 * dirt
            mt = np.zeros_like(r)
        elif c == "thread":
            col = (C((0.47, 0.40, 0.28)) * (0.8 + 0.3 * n1)[:, None]).reshape(-1, 3)
            col = col * (1 - 0.6 * cv)[:, None]
            col = mix(col, C((0.13, 0.10, 0.07)).reshape(1, 3), sm(n2, 0.55, 0.85) * 0.6)
            r = 0.72 + 0 * n2
            mt = np.zeros_like(r)
        elif c == "canvas":
            col = (C((0.078, 0.073, 0.052)) * (0.8 + 0.4 * n1)[:, None] * (0.88 + 0.24 * n3)[:, None]).reshape(-1, 3)
            col = mix(col, C((0.15, 0.135, 0.10)).reshape(1, 3), np.clip(cx * 1.2, 0, 1) * 0.6)
            col = col * (1 - 0.5 * cv)[:, None]
            r = 0.66 - 0.18 * sm(n2, 0.4, 0.8) + 0.1 * cv
            mt = np.zeros_like(r)
        elif c == "strap":
            col = (C((0.165, 0.068, 0.028)) * (0.8 + 0.4 * n1)[:, None]).reshape(-1, 3)
            col = mix(col, C((0.050, 0.024, 0.012)).reshape(1, 3), np.clip(e * 1.4, 0, 1))  # burnished cut edges
            col = mix(col, C((0.30, 0.18, 0.10)).reshape(1, 3), np.clip(cx, 0, 1) * 0.5 * sm(n2, 0.4, 0.7))
            col = mix(col, C((0.44, 0.37, 0.25)).reshape(1, 3), n3)  # stitching
            col = col * (1 - 0.5 * cv)[:, None]
            r = 0.56 + 0.1 * n2 + 0.12 * n3
            mt = np.zeros_like(r)
        elif c == "cord":
            col = (C((0.060, 0.040, 0.027)) * (0.8 + 0.4 * n1)[:, None]).reshape(-1, 3)
            col = mix(col, C((0.15, 0.10, 0.07)).reshape(1, 3), np.clip(cx * 1.3, 0, 1) * 0.6)
            col = col * (1 - 0.6 * cv)[:, None]
            r = 0.55 - 0.15 * np.clip(cx, 0, 1)
            mt = np.zeros_like(r)
        elif c == "cable":
            col = (C((0.26, 0.25, 0.23)) * (0.75 + 0.5 * n1)[:, None]).reshape(-1, 3)
            tar = np.clip(cv * 1.2, 0, 1)
            col = mix(col, C((0.03, 0.025, 0.02)).reshape(1, 3), tar)
            r = 0.42 + 0.3 * tar
            mt = 0.85 - 0.6 * tar
        elif c == "dial":
            col = b0 * (1 - 0.22 * cv)[:, None]
            col = mix(col, C((0.55, 0.42, 0.22)).reshape(1, 3), sm(n1, 0.55, 0.85) * 0.35)
            r = 0.30 + 0.1 * n2
            mt = np.zeros_like(r)
        elif c == "needle":
            col = b0
            r = 0.38 + 0 * n2
            mt = 0.3 + 0 * n2
        elif c in ("lamp", "glass"):
            col = b0
            r = 0.12 + 0 * n2
            mt = np.zeros_like(r)
        else:
            col = b0
            r = 0.6 + 0 * n2
            mt = np.zeros_like(r)
        alb[m] = col
        rough[m] = np.clip(r, 0.05, 1.0)
        metal[m] = np.clip(mt, 0, 1)
    ao_out = np.clip(0.35 + 0.65 * ao, 0, 1)

    def srgb(x):
        x = np.clip(x, 0, 1)
        return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)

    def save(arr, path, q=92):
        im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1])
        im.save(path, quality=q, subsampling=0 if q >= 90 else 2, optimize=True)
        return path
    paths = {
        "albedo": save(srgb(alb), os.path.join(outdir, f"arms_albedo{tag}.jpg"), 90),
        "normal": save(np.clip(nrm, 0, 1), os.path.join(outdir, f"arms_normal{tag}.jpg"), 95),
        "orm": save(np.stack([ao_out, rough, metal], -1), os.path.join(outdir, f"arms_orm{tag}.jpg"), 90),
        "emissive": save(srgb(np.stack([em, em, em], -1)), os.path.join(outdir, f"arms_emissive{tag}.jpg"), 85),
    }
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


def game_material(paths, emit_strength=1.0, emit_tint=(1.0, 0.70, 0.35)):
    mat = bpy.data.materials.new("AT3D_Gear")
    b = NB(mat)
    out = b.n("ShaderNodeOutputMaterial")
    bsdf = b.n("ShaderNodeBsdfPrincipled")
    b.link(bsdf.outputs[0], out.inputs["Surface"])

    def tex(key, cs):
        im = bpy.data.images.load(paths[key], check_existing=True)
        im.colorspace_settings.name = cs
        nd = b.n("ShaderNodeTexImage", image=im)
        return nd
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
    e = tex("emissive", "sRGB")
    key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
    b.link(e.outputs["Color"], bsdf.inputs[key])
    bsdf.inputs["Emission Strength"].default_value = emit_strength
    mat["emit_node"] = bsdf.name
    return mat


# -----------------------------------------------------------------------------
# Assembly helpers
# -----------------------------------------------------------------------------
def mesh_from_parts(name, parts, coll, bone_of=None):
    """Join low part objects into one mesh; vertex groups per bone; face attr 'flipu'."""
    bm = bmesh.new()
    vg = {}
    flip_layer = None
    verts_bone = []
    flips = []
    for nm, ob in parts:
        me = ob.data.copy()
        me.transform(ob.matrix_world)
        n0 = len(bm.verts)
        f0 = len(bm.faces)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        bm.verts.ensure_lookup_table()
        bone = bone_of(nm) if bone_of else None
        verts_bone += [bone] * (len(bm.verts) - n0)
        flips += [1 if nm in ("Dial", "Plate") else 0] * (len(bm.faces) - f0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    attr = me.attributes.new("flipu", "INT", "FACE")
    attr.data.foreach_set("value", flips)
    if bone_of:
        for i, bn in enumerate(verts_bone):
            if bn not in vg:
                vg[bn] = ob.vertex_groups.new(name=bn)
            vg[bn].add([i], 1.0, "REPLACE")
    return ob


def build_launcher_rig(side, coll):
    arm = bpy.data.armatures.new(f"Launcher_{side}_Rig")
    ob = bpy.data.objects.new(f"Launcher_{side}_Rig", arm)
    coll.objects.link(ob)
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    for name, (h, t, z, parent) in launcher_bones().items():
        eb = arm.edit_bones.new(f"{name}_{side}")
        h, t, z = h.copy(), t.copy(), z.copy()
        d = t - h
        if side == "L":
            # mirrored pivot; Drum/Trigger keep their axis along +X so the same
            # local rotation means the same world motion on both sides
            h.x = -h.x
            if name not in ("Drum", "Trigger"):
                d.x, z.x = -d.x, -z.x
        t = h + d
        eb.head, eb.tail = h, t
        eb.align_roll(z)
        if parent:
            eb.parent = ebs[parent]
        ebs[name] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


def mirror_mesh_obj(src, name, coll, rename=None):
    me = src.data.copy()
    me.name = name
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    me.flip_normals()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    for g in src.vertex_groups:
        ob.vertex_groups.new(name=rename(g.name) if rename else g.name)
    # vertex group weights are stored in the mesh (copied); flip 'flipu' islands' U
    if "flipu" in me.attributes:
        fl = [0] * len(me.polygons)
        me.attributes["flipu"].data.foreach_get("value", fl)
        uv = me.uv_layers.active.data
        # group flagged faces into islands by connectivity on UV-shared verts: flip each
        # flagged part around the centre of its own UV bounds
        flagged = [p for p in me.polygons if fl[p.index]]
        if flagged:
            us = [uv[li].uv.x for p in flagged for li in p.loop_indices]
            # dial and plate are each one island: split by mean v
            parts = {}
            for p in flagged:
                key = round(sum(uv[li].uv.y for li in p.loop_indices) / p.loop_total, 1)
                parts.setdefault(key, []).append(p)
            islands = _uv_islands(me, flagged)
            for isl in islands:
                us = [uv[li].uv.x for p in isl for li in p.loop_indices]
                c = (min(us) + max(us))
                for p in isl:
                    for li in p.loop_indices:
                        uv[li].uv.x = c - uv[li].uv.x
    return ob


def _uv_islands(me, polys):
    """Connected components of polys sharing UV-coincident edges."""
    uv = me.uv_layers.active.data
    key_to_polys = {}
    for p in polys:
        for li in p.loop_indices:
            k = (me.loops[li].vertex_index, round(uv[li].uv.x, 5), round(uv[li].uv.y, 5))
            key_to_polys.setdefault(k, []).append(p.index)
    adj = {p.index: set() for p in polys}
    for lst in key_to_polys.values():
        for a in lst:
            for b2 in lst:
                if a != b2:
                    adj[a].add(b2)
    seen = set()
    out = []
    pmap = {p.index: p for p in polys}
    for p in polys:
        if p.index in seen:
            continue
        stack = [p.index]
        comp = []
        seen.add(p.index)
        while stack:
            q = stack.pop()
            comp.append(pmap[q])
            for r in adj[q]:
                if r not in seen:
                    seen.add(r)
                    stack.append(r)
        out.append(comp)
    return out


def decimate_copy(src, name, ratio, coll):
    ob = src.copy()
    ob.data = src.data.copy()
    ob.name = name
    ob.data.name = name
    coll.objects.link(ob)
    mods = [(m.name, m.object) for m in ob.modifiers if m.type == "ARMATURE"]
    ob.modifiers.clear()
    d = ob.modifiers.new("dec", "DECIMATE")
    d.ratio = ratio
    d.use_collapse_triangulate = True
    apply_mods(ob)
    for nm, arm in mods:
        mm = ob.modifiers.new(nm, "ARMATURE")
        mm.object = arm
    return ob


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


# -----------------------------------------------------------------------------
# Scene helpers
# -----------------------------------------------------------------------------
def clay(name, col, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def look_cam(name, loc, target, lens=35.0, coll=None):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.01
    ob = bpy.data.objects.new(name, cd)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


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


# -----------------------------------------------------------------------------
# Renders (Cycles, game meshes with the baked atlas)
# -----------------------------------------------------------------------------
TEX_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "abyssal-tether-3d", "assets", "textures"))


def stone_material(name, tile=1.6, tint=(1, 1, 1)):
    mat = bpy.data.materials.new(name)
    b = NB(mat)
    out = b.n("ShaderNodeOutputMaterial")
    bsdf = b.n("ShaderNodeBsdfPrincipled")
    b.link(bsdf.outputs[0], out.inputs["Surface"])
    tc = b.n("ShaderNodeTexCoord")
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / tile, 1 / tile, 1 / tile)
    b.link(tc.outputs["Object"], mp.inputs["Vector"])

    def img(fn, cs):
        p = os.path.join(TEX_DIR, fn)
        if not os.path.exists(p):
            return None
        im = bpy.data.images.load(p, check_existing=True)
        im.colorspace_settings.name = cs
        nd = b.n("ShaderNodeTexImage", image=im, projection="BOX", projection_blend=0.25)
        b.link(mp.outputs[0], nd.inputs["Vector"])
        return nd
    a = img("masonry_albedo.jpg", "sRGB")
    if a:
        mul = b.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        mul.inputs[0].default_value = 1.0
        b.link(a.outputs["Color"], mul.inputs[6])
        mul.inputs[7].default_value = (*tint, 1)
        b.link(mul.outputs[2], bsdf.inputs["Base Color"])
    n = img("masonry_normal.jpg", "Non-Color")
    if n:
        nm = b.n("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 1.2
        b.link(n.outputs["Color"], nm.inputs["Color"])
        b.link(nm.outputs[0], bsdf.inputs["Normal"])
    o = img("masonry_orm.jpg", "Non-Color")
    if o:
        sep = b.n("ShaderNodeSeparateColor")
        b.link(o.outputs["Color"], sep.inputs[0])
        b.link(sep.outputs[1], bsdf.inputs["Roughness"])
    return mat


def add_light(name, kind, loc, energy, color, size=0.05, target=None, spot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size
    if kind == "AREA":
        ld.size = size
    if kind == "SPOT" and spot:
        ld.spot_size = spot
        ld.spot_blend = 0.6
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    if target is not None:
        ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(ob)
    return ob


def socket_matrix(pos, yaw=0.0, pitch=0.0, roll=0.0):
    """World matrix for a hand socket: yaw about Z, pitch (+ = aim up) about X, roll about the aim (Y)."""
    R = Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(pitch), 4, "X") @ Matrix.Rotation(math.radians(roll), 4, "Y")
    return Matrix.Translation(Vector(pos)) @ R


def render_shot(scene, cam, path, res, samples):
    scene.camera = cam
    w, h = (int(v) for v in res.split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.cycles.samples = samples
    scene.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log(f"rendered {os.path.basename(path)} {time.time() - t0:.0f}s")


def sheet(paths, out, cols, labels=None):
    from PIL import Image, ImageDraw
    ims = [Image.open(p).convert("RGB") for p in paths]
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    S_ = Image.new("RGB", (w * cols, h * rows), (8, 8, 9))
    for i, im in enumerate(ims):
        S_.paste(im, ((i % cols) * w, (i // cols) * h))
    if labels:
        d = ImageDraw.Draw(S_)
        f = _font(26)
        for i, t in enumerate(labels):
            d.text(((i % cols) * w + 18, (i // cols) * h + 14), t, fill=(225, 215, 195), font=f)
    S_.save(out)


def render_all(scene, R, poses, gear_mat):
    """First-person, mechanism close-up, three-quarter turntable, finger poses."""
    only = set(args.only.split(",")) if args.only else None
    setup_cycles(scene, args.samples, args.res)
    scene.cycles.use_adaptive_sampling = True
    scene.render.film_transparent = False
    scene.view_settings.exposure = 0.0
    world = bpy.data.worlds.new("RenderWorld")
    scene.world = world
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.004, 0.0045, 0.006, 1)
    bg.inputs[1].default_value = 1.0
    # brighter emissive for renders (lantern glass + pilot lamps)
    bsdf = gear_mat.node_tree.nodes[gear_mat["emit_node"]]
    lantern_mat = gear_mat.copy()
    lantern_mat.name = "AT3D_Gear_LanternRender"
    lantern_mat.node_tree.nodes[gear_mat["emit_node"]].inputs["Emission Strength"].default_value = 14.0
    bsdf.inputs["Emission Strength"].default_value = 5.0
    lan = R["lantern_mesh"]
    lan.data.materials.clear()
    lan.data.materials.append(lantern_mat)
    roots = R["roots"]
    arms = R["arms"]
    hide = []

    def place_lantern(swing=6.0):
        hook = R["hook_L"].matrix_world.translation
        roots["Lantern"].matrix_world = Matrix.Translation(hook) @ Matrix.Rotation(math.radians(swing), 4, "X") @ Matrix.Rotation(math.radians(-14), 4, "Z")
        bpy.context.view_layer.update()
        return R["lantern_socket"].matrix_world.translation.copy()

    def lantern_light(pos, energy=3.2):
        lt = add_light("LanternLight", "POINT", pos, energy, (1.0, 0.60, 0.28), size=0.014)
        hide.append(lt)
        return lt

    def clear_temp():
        for o in hide:
            bpy.data.objects.remove(o)
        hide.clear()

    # ---- 1. first-person ------------------------------------------------------
    if not only or "fp" in only:
        env = bpy.data.collections.new("Env")
        scene.collection.children.link(env)
        stone = stone_material("Stone", 1.4, (0.75, 0.72, 0.68))
        bm = bmesh.new()
        # shaft wall: a 12-sided ring of ashlar 3.2 m out, bridge underfoot, far ledge
        lathe(bm, Vector((0, 0, -6)), Vector((0, 0, 1)), [(0, 3.4), (14, 3.4), (14, 3.15), (0, 3.15)], 14, closed=True)
        box(bm, (0, 1.0, 0.0 - 0.18), (0.55, 2.8, 0.18), bevel=0.02)
        box(bm, (-1.6, 2.4, -0.6), (0.6, 0.5, 0.6), bevel=0.03)
        wall = new_obj("Shaft", bm, env)
        wall.data.materials.append(stone)
        for p in wall.data.polygons:
            p.use_smooth = False
        # anchor ring on the far wall + taut tether from the right muzzle
        iron = bpy.data.materials.new("AnchorIron")
        iron.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.05, 0.05, 0.055, 1)
        iron.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 1.0
        iron.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.45
        glow = bpy.data.materials.new("AnchorGlow")
        gb = glow.node_tree.nodes["Principled BSDF"]
        gb.inputs["Emission Color"].default_value = (1.0, 0.62, 0.25, 1)
        gb.inputs["Emission Strength"].default_value = 3.0
        anchor = Vector((0.55, 3.12, 2.35))
        bm = bmesh.new()
        torus(bm, anchor, Vector((0, 1, 0)), 0.09, 0.016, 32, 10)
        ring = new_obj("AnchorRing", bm, env)
        ring.data.materials.append(iron)
        bm = bmesh.new()
        torus(bm, anchor + Vector((0, -0.01, 0)), Vector((0, 1, 0)), 0.13, 0.006, 32, 6)
        mk = new_obj("AnchorMarker", bm, env)
        mk.data.materials.append(glow)
        # hands
        roots["Arm_R"].matrix_world = socket_matrix((0.205, 0.42, 1.17), yaw=-7, pitch=14, roll=12)
        roots["Arm_L"].matrix_world = socket_matrix((-0.215, 0.37, 1.13), yaw=8, pitch=-4, roll=-14)
        apply_pose(arms["R"], poses, "Trigger", "R")
        apply_pose(arms["L"], poses, "Grip", "L")
        bpy.context.view_layer.update()
        muzzle = R["muzzle_R"].matrix_world.translation.copy()
        bm = bmesh.new()
        sweep(bm, [muzzle.lerp(anchor, t) for t in (0, 0.5, 1.0)], 0.0055, 10)
        rope = new_obj("Tether", bm, env)
        cab = bpy.data.materials.new("Rope")
        rb = cab.node_tree.nodes["Principled BSDF"]
        rb.inputs["Base Color"].default_value = (0.12, 0.11, 0.10, 1)
        rb.inputs["Roughness"].default_value = 0.6
        rb.inputs["Emission Color"].default_value = (1.0, 0.55, 0.2, 1)
        rb.inputs["Emission Strength"].default_value = 0.35
        rope.data.materials.append(cab)
        lp = place_lantern(5.0)
        lantern_light(lp, 3.0)
        hide.append(add_light("ShaftCool", "SPOT", (1.4, 1.2, 6.5), 260, (0.45, 0.62, 0.85), size=0.6, target=(0.2, 1.2, 0.8), spot=math.radians(40)))
        hide.append(add_light("Bounce", "AREA", (0.0, 1.2, 0.4), 0.6, (0.9, 0.55, 0.3), size=1.0, target=(0, 0.4, 1.2)))
        cam = look_cam("CamFP", (0.0, 0.0, 1.60), (0.02, 1.0, 1.60 - 0.44), 17.0)
        cam.data.sensor_width = 36
        render_shot(scene, cam, os.path.join(RENDER_DIR, "arms_fp.png"), args.res, args.samples)
        clear_temp()
        bpy.data.collections.remove(env)
        for o in list(bpy.data.objects):
            if o.users == 0:
                bpy.data.objects.remove(o)

    # studio backdrop for the close-ups
    def studio():
        bm = bmesh.new()
        lathe(bm, Vector((0, 0.9, -0.6)), Vector((0, 0, 1)), [(0, 0), (0, 2.5), (3, 2.5)], 48)
        bd = new_obj("Backdrop", bm)
        m = bpy.data.materials.new("Backdrop")
        pb = m.node_tree.nodes["Principled BSDF"]
        pb.inputs["Base Color"].default_value = (0.018, 0.017, 0.016, 1)
        pb.inputs["Roughness"].default_value = 0.85
        bd.data.materials.append(m)
        for p in bd.data.polygons:
            p.use_smooth = True
        bd.data.flip_normals()
        hide.append(bd)

    # ---- 2. mechanism close-up -------------------------------------------------
    roots["Arm_L"].matrix_world = Matrix.Translation((5, 0, 0))
    roots["Lantern"].matrix_world = Matrix.Translation((5, 0, 0))
    roots["Arm_R"].matrix_world = Matrix.Identity(4)
    apply_pose(arms["R"], poses, "Grip", "R")
    if not only or "mech" in only:
        studio()
        hide.append(add_light("Key", "AREA", (-0.35, 0.10, 0.45), 9.0, (1.0, 0.80, 0.62), size=0.25, target=(0, -0.04, 0.08)))
        hide.append(add_light("Rim", "AREA", (0.35, -0.45, 0.30), 7.0, (0.55, 0.70, 1.0), size=0.3, target=(0, -0.05, 0.08)))
        hide.append(add_light("Fill", "POINT", (-0.15, 0.25, 0.02), 0.6, (1.0, 0.6, 0.3), size=0.02))
        cam = look_cam("CamMech", (-0.205, 0.125, 0.235), (0.0, -0.045, 0.080), 50.0)
        cam.data.dof.use_dof = True
        cam.data.dof.focus_distance = 0.30
        cam.data.dof.aperture_fstop = 5.6
        render_shot(scene, cam, os.path.join(RENDER_DIR, "launcher_mechanism.png"), args.res, args.samples)
        clear_temp()

    # ---- 3. three-quarter turntable of the right arm ---------------------------
    if not only or "turn" in only:
        studio()
        hide.append(add_light("Key", "AREA", (-0.5, 0.4, 0.6), 18.0, (1.0, 0.84, 0.68), size=0.4, target=(0, -0.08, 0.04)))
        hide.append(add_light("Rim", "AREA", (0.5, -0.6, 0.4), 12.0, (0.55, 0.70, 1.0), size=0.4, target=(0, -0.08, 0.04)))
        hide.append(add_light("Under", "AREA", (0.0, 0.2, -0.4), 3.0, (0.9, 0.6, 0.4), size=0.4, target=(0, -0.08, 0.04)))
        tiles = []
        w, h = (int(v) for v in args.res.split("x"))
        tres = f"{w // 2}x{h // 2}"
        for i, ang in enumerate((-45, 45, 135, 225)):
            a = math.radians(ang)
            c = Vector((0.0, -0.075, 0.035))
            loc = c + Vector((math.sin(a) * 0.72, -math.cos(a) * 0.72, 0.30))
            # orbit = rotate the arm, keep lights fixed relative to the camera
            cam = look_cam(f"CamTurn{i}", (-0.62, 0.36, 0.33), (0.0, -0.075, 0.035), 50.0)
            roots["Arm_R"].matrix_world = Matrix.Translation(c) @ Matrix.Rotation(-a - math.radians(45), 4, "Z") @ Matrix.Translation(-c)
            p = os.path.join(RENDER_DIR, f"_turn_{i}.png")
            render_shot(scene, cam, p, tres, args.samples)
            tiles.append(p)
        sheet(tiles, os.path.join(RENDER_DIR, "arm_turntable.png"), 2, ["front 3/4 (player side)", "front 3/4 (outer side)", "back 3/4 (outer side)", "back 3/4 (player side)"])
        roots["Arm_R"].matrix_world = Matrix.Identity(4)
        clear_temp()

    # ---- 4. finger poses side by side -------------------------------------------
    if not only or "poses" in only:
        studio()
        hide.append(add_light("Key", "AREA", (-0.45, 0.30, 0.45), 12.0, (1.0, 0.84, 0.68), size=0.35, target=(0, 0.02, 0.0)))
        hide.append(add_light("Rim", "AREA", (0.45, -0.3, 0.35), 8.0, (0.55, 0.70, 1.0), size=0.35, target=(0, 0.02, 0.0)))
        tiles = []
        w, h = (int(v) for v in args.res.split("x"))
        tres = f"{w // 2}x{h // 2}"
        for pname in ("Open", "Grip", "Trigger", "Point"):
            apply_pose(arms["R"], poses, pname, "R")
            cam = look_cam("CamPose", (-0.36, 0.20, 0.17), (0.0, 0.015, 0.012), 50.0)
            p = os.path.join(RENDER_DIR, f"_pose_{pname}.png")
            render_shot(scene, cam, p, tres, args.samples)
            tiles.append(p)
        sheet(tiles, os.path.join(RENDER_DIR, "finger_poses.png"), 2, ["OPEN", "GRIP", "TRIGGER (squeezed)", "POINT"])
        clear_temp()
    for f in os.listdir(RENDER_DIR):
        if f.startswith("_turn_") or f.startswith("_pose_"):
            os.remove(os.path.join(RENDER_DIR, f))


def render_hi(scene, objs, coll):
    """Dev preview of the HIGH meshes (bake sources) in the studio: the glove in
    its bind pose, the launcher, the sleeve. Views: player side 3/4, eye view,
    back of the hand close-up, palm close-up."""
    only = set(args.only.split(",")) if args.only else None
    setup_cycles(scene, args.samples, args.res)
    world = bpy.data.worlds.new("HiWorld")
    scene.world = world
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.01, 0.011, 0.013, 1)
    for o in bpy.data.objects:
        o.hide_render = o.type == "MESH" and o not in objs
    bm = bmesh.new()
    lathe(bm, Vector((0, 0.9, -0.6)), Vector((0, 0, 1)), [(0, 0), (0, 2.5), (3, 2.5)], 48)
    bd = new_obj("Backdrop", bm)
    m = bpy.data.materials.new("Backdrop")
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.03, 0.03, 0.03, 1)
    bd.data.materials.append(m)
    bd.data.flip_normals()
    add_light("Key", "AREA", (-0.45, 0.30, 0.45), 14.0, (1.0, 0.86, 0.72), size=0.35, target=(0, 0.0, 0.03))
    add_light("Rim", "AREA", (0.45, -0.3, 0.35), 9.0, (0.6, 0.72, 1.0), size=0.35, target=(0, 0.0, 0.03))
    add_light("Under", "AREA", (0.0, 0.3, -0.4), 3.0, (0.9, 0.7, 0.5), size=0.4, target=(0, 0.0, 0.0))
    views = {
        "side": ((-0.42, 0.10, 0.16), (0.0, -0.03, 0.03), 45.0),
        "eye": ((-0.10, -0.42, 0.42), (0.0, 0.03, 0.04), 40.0),
        "back": ((0.17, 0.16, 0.10), (0.0, 0.04, 0.02), 50.0),
        "palm": ((-0.20, 0.13, -0.08), (-0.03, 0.03, -0.01), 50.0),
        "sleeve": ((0.30, -0.30, 0.02), (0.0, -0.17, 0.03), 40.0),
    }
    for k, (loc, tgt, lens) in views.items():
        if only and k not in only:
            continue
        cam = look_cam("Cam_" + k, loc, tgt, lens)
        render_shot(scene, cam, os.path.join(RENDER_DIR, f"hi_{k}.png"), args.res, args.samples)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
LOW_SKIP = {"HandleCore"}
BONE_SIDE = lambda nm, side: f"{nm}_{side}"  # noqa: E731


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    cache = CACHE_DIR
    os.makedirs(cache, exist_ok=True)
    if args.stage == "composite":  # dev: re-composite cached bakes only
        import numpy as np
        R = {k: np.load(os.path.join(cache, f"bake_{k}_{args.bake}.npy")) for k in ("NORMAL", "AO", "MATID", "BASE", "DETAIL", "EDGE", "EMIT", "COV")}
        log(composite(R, args.bake, cache))
        return
    poses = solve_poses()
    build = bpy.data.collections.new("Build")
    scene.collection.children.link(build)
    export = bpy.data.collections.new("Export")
    scene.collection.children.link(export)
    make_graphics(cache)
    dial_frames()
    for cls in MAT_CLASSES:
        hb_material(cls)

    # --- glove + sleeve ---------------------------------------------------------
    bm = build_glove_volume(REST_CURL)
    gh = new_obj("Glove_High_R", bm, build)
    remesh(gh, 0.0009, smooth_iter=6, smooth_fac=0.6)
    gl = gh.copy()
    gl.data = gh.data.copy()
    gl.name = "Glove_Low_R"
    build.objects.link(gl)
    dec = gl.modifiers.new("dec", "DECIMATE")
    dec.ratio = 0.08
    apply_mods(gl)
    activate(gl)
    bpy.ops.object.quadriflow_remesh(target_faces=2700, use_mesh_symmetry=False, use_preserve_sharp=False,
                                     use_preserve_boundary=False, smooth_normals=False, mode="FACES", seed=args.seed)
    stitches = detail_glove(gh)
    sh = new_obj("Sleeve_High_R", build_sleeve(True), build)
    sl = new_obj("Sleeve_Low_R", build_sleeve(False), build)
    for ob in (gh, gl, stitches, sh, sl):
        ob.data.transform(S_MAT)
        ob.data.update()
        for p in ob.data.polygons:
            p.use_smooth = True
    gh.data.materials.append(HB["leather"]["mat"])
    stitches.data.materials.append(HB["thread"]["mat"])
    sh.data.materials.append(HB["canvas"]["mat"])
    log("glove high", len(gh.data.polygons), "low", len(gl.data.polygons))
    activate(gl)
    sl.select_set(True)
    bpy.ops.object.join()
    arm_low = gl
    arm_low.name = "Arm_R_Mesh"

    # --- launcher + lantern (high + low per part) -------------------------------
    def realize(P, tag, coll, offset=None):
        out = {}
        for nm, (bmp, bone, mk) in P.items():
            o = new_obj(f"{nm}_{tag}", bmp, coll)
            if offset is not None:
                o.data.transform(Matrix.Translation(offset))
            if tag == "H":
                o.data.materials.append(HB[mk]["mat"])
                o["bake_high"] = 1
                for p in o.data.polygons:
                    p.use_smooth = True
            o["part"] = nm
            o["bone"] = bone
            out[nm] = o
        return out
    LH = realize(build_launcher(True), "H", build)
    LL = realize(build_launcher(False), "L", build)
    for nm in LOW_SKIP:
        bpy.data.objects.remove(LL.pop(nm))
    LAN_OFF = Vector((0.6, 0.0, 0.0))  # keep the lantern away from the launcher while baking
    NH = realize(build_lantern(True), "H", build, LAN_OFF)
    NL = realize(build_lantern(False), "L", build, LAN_OFF)
    for o in (gh, stitches, sh):
        o["bake_high"] = 1
    if args.stage == "hi":  # dev: render the bake sources directly (no bake / export)
        render_hi(scene, [gh, stitches, sh] + list(LH.values()), build)
        return
    for o in list(LL.values()) + list(NL.values()):
        sharpen_by_angle(o, 48)
    log("launcher low tris", sum(tri_count(o) for o in LL.values()), "lantern low", sum(tri_count(o) for o in NL.values()))

    # --- UV atlas ---------------------------------------------------------------
    lows = [arm_low] + list(LL.values()) + list(NL.values())
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in lows:
        o.data.uv_layers.new(name="UVMap")
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm_low
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    # the glove/sleeve is what the player looks at most: 1.45× the texel density
    uvd = arm_low.data.uv_layers.active.data
    for l in uvd:
        l.uv = l.uv * 1.45
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=0.002, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.0025)
    bpy.ops.object.mode_set(mode="OBJECT")
    area = 0.0
    for o in lows:
        me = o.data
        uv = me.uv_layers.active.data
        for p in me.polygons:
            li = list(p.loop_indices)
            for k in range(1, len(li) - 1):
                a, b2, c = uv[li[0]].uv, uv[li[k]].uv, uv[li[k + 1]].uv
                area += abs((b2 - a).cross(c - a)) / 2
    log(f"uv packed: {area * 100:.1f}% of the atlas used")
    if args.stage == "uv":
        return

    # --- bake + composite -------------------------------------------------------
    hand_ao_skip = {"HandleWrap", "HandleCore", "Ferrules", "Lever", "LeverPin"}
    groups = [("arm", [arm_low], [gh, stitches, sh])]
    lgroups = bake_groups_for(LL, {n: [LH[n]] for n in LL}, [])
    groups += lgroups
    groups.append(("lantern", list(NL.values()), list(NH.values())))
    R = bake_groups(groups, args.bake, cache)
    paths = composite(R, args.bake, cache)
    gear = game_material(paths)
    log("composited", paths)

    # --- assemble the right side ------------------------------------------------
    for o in NL.values():
        o.data.transform(Matrix.Translation(-LAN_OFF))
    lan_mesh = mesh_from_parts("Lantern_Mesh", list(NL.items()), export)
    head_parts = [(n, LL[n]) for n in ("HeadShaft", "HeadPoint")]
    head_prop = mesh_from_parts("GrappleHead", head_parts, export)
    head_prop.data.transform(Matrix.Translation(-Vector((0, MUZZLE_Y, BARREL_Z))))
    lmesh_R = mesh_from_parts("Launcher_R_Mesh", list(LL.items()), export, bone_of=lambda nm: f"{LL[nm]['bone']}_R")
    sharpen_by_angle(lmesh_R, 48)
    for o in (lan_mesh, head_prop):
        sharpen_by_angle(o, 48)
    arm_low.users_collection[0].objects.unlink(arm_low)
    export.objects.link(arm_low)
    for o in (arm_low, lmesh_R, lan_mesh, head_prop):
        o.data.materials.clear()
        o.data.materials.append(gear)
    arms, rigs, meshes = {}, {}, {}
    arms["R"] = build_armature("R", export)
    me = arm_low.data
    adj = [[] for _ in me.vertices]
    for e in me.edges:
        a, b2 = e.vertices
        adj[a].append(b2)
        adj[b2].append(a)
    W = skin_weights([S_INV @ v.co for v in me.vertices], None, adj)
    groups_vg = {bn.name[:-2]: arm_low.vertex_groups.new(name=bn.name) for bn in arms["R"].data.bones}
    for i, w in enumerate(W):
        for k, v in w.items():
            groups_vg[k].add([i], v, "REPLACE")
    meshes["R"] = arm_low
    rigs["R"] = build_launcher_rig("R", export)
    lmeshes = {"R": lmesh_R}

    # --- left side (mirror) -----------------------------------------------------
    meshes["L"] = mirror_mesh_obj(arm_low, "Arm_L_Mesh", export, rename=lambda n: n[:-2] + "_L")
    lmeshes["L"] = mirror_mesh_obj(lmesh_R, "Launcher_L_Mesh", export, rename=lambda n: n[:-2] + "_L")
    arms["L"] = build_armature("L", export)
    rigs["L"] = build_launcher_rig("L", export)
    roots = {}
    sockets = {}
    for side in ("R", "L"):
        sg = 1 if side == "R" else -1
        root = bpy.data.objects.new(f"Arm_{side}", None)
        root.empty_display_size = 0.05
        export.objects.link(root)
        roots[f"Arm_{side}"] = root
        for ob, arm in ((meshes[side], arms[side]), (lmeshes[side], rigs[side])):
            ob.parent = arm
            mod = ob.modifiers.new("Armature", "ARMATURE")
            mod.object = arm
        arms[side].parent = root
        rigs[side].parent = root
        make_pose_actions(arms[side], side, poses)
        for nm, pos in (("Muzzle", MUZZLE), ("LanternHook", LAUNCHER_SOCKETS["LanternHook"]), ("WristHUD", Vector((-0.050, -0.165, 0.050)))):
            e = bpy.data.objects.new(f"{nm}_{side}", None)
            e.empty_display_size = 0.01
            e.location = (pos.x * sg, pos.y, pos.z)
            e.parent = root
            export.objects.link(e)
            sockets[f"{nm}_{side}"] = e
        # LOD1 ≈ 40 %
        for ob in (meshes[side], lmeshes[side]):
            lod = decimate_copy(ob, ob.name + "_LOD1", 0.40, export)
            lod.parent = ob.parent
    lroot = bpy.data.objects.new("Lantern", None)
    export.objects.link(lroot)
    lan_mesh.parent = lroot
    lsock = bpy.data.objects.new("Lantern_Socket", None)
    lsock.location = LANTERN_SOCKET
    lsock.parent = lroot
    export.objects.link(lsock)
    roots["Lantern"] = lroot
    hroot = head_prop
    roots["GrappleHead"] = hroot
    bpy.context.view_layer.update()

    # --- stats + export ---------------------------------------------------------
    stats = {}
    for side in ("R", "L"):
        stats[side] = (tri_count(meshes[side]), tri_count(lmeshes[side]), tri_count(bpy.data.objects[meshes[side].name + "_LOD1"]),
                       tri_count(bpy.data.objects[lmeshes[side].name + "_LOD1"]))
    log("tris (arm, launcher, arm LOD1, launcher LOD1):", stats, "lantern", tri_count(lan_mesh), "head", tri_count(head_prop))
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in export.objects:
        o.select_set(True)
    glb = os.path.join(args.out, "player_arms.glb")
    if args.stage != "renders":
        bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
                                  export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
                                  export_image_format="AUTO", export_skins=True, export_animations=True,
                                  export_animation_mode="ACTIONS", export_force_sampling=True, export_def_bones=False,
                                  export_rest_position_armature=True, export_morph=False, export_extras=False,
                                  export_cameras=False, export_lights=False)
        log("exported", glb, f"{os.path.getsize(glb) / 1e6:.2f} MB")
    for o in build.objects:
        o.hide_render = True
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
    if args.render:
        RR = {"roots": roots, "arms": arms, "lantern_mesh": lan_mesh, "hook_L": sockets["LanternHook_L"],
              "lantern_socket": lsock, "muzzle_R": sockets["Muzzle_R"]}
        head_prop.hide_render = True
        for side in ("R", "L"):
            bpy.data.objects[meshes[side].name + "_LOD1"].hide_render = True
            bpy.data.objects[lmeshes[side].name + "_LOD1"].hide_render = True
        render_all(scene, RR, poses, gear)
    log("done")


main()
