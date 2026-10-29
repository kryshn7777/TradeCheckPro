"""ABYSSAL TETHER 3D — THE HOLDFAST: procedural builder of the hand in the wall (Blender 5.x / the `bpy` module).

"The wall you climb holds your hand." A grey-pink stone-flesh hand and forearm in a torn socket of masonry, built from code
(deterministic, seed 4242, no hand-sculpting): anatomy from a joint table, a HIGH sculpt (dense tubes + a voxel union + smoothing,
then numpy 'sculpt' layers: knuckle wrinkles, joint creases, stone cracks, veins, extensor tendons of twisted rope, a split at
the wrist showing the rope fibres, fingertip grime) with slate fingernails and a wedding band of mortar, baked onto a ~2.4 k
triangle skinned LOW (normal, AO, albedo, roughness, vein mask), vertex-colour AO, a LOD1 (~600 triangles) and a static
'dormant' copy (the fist in its socket) for the instanced far look.

What is wrong with it (one thing, and a few small ones): every finger has ONE KNUCKLE TOO MANY (four phalanges: long, bony,
curling further than a hand can); the nails are slate, the ring is mortar, the tendons are rope, the skin is wet stone and the
veins pulse (render/holdfastView.js).

Frame (Blender, metres): the wall is the plane y = 0, out of the wall = -Y (glTF +Z), up = +Z (glTF +Y), x along the wall (glTF X).
The socket's mouth is the origin. Rest pose: the forearm straight out of the wall, palm down, fingers out (a RIGHT hand: the thumb
on +X). Bones (glTF node names): socket (static), forearm (its head = the elbow, inside the wall), hand (the wrist), index_1..4,
middle_1..4, ring_1..4, pinky_1..4, thumb_1..3. Finger bones roll so their local X is the flex axis (curl = -X rotation).

Clips (30 fps, authored in code, exported as glTF animations; the runtime drives forearm + hand by IK and plays the finger
tracks): idle (loop: the dormant fist breathing, a slow twitch), stir (loop: the fingers loosen, a wave), reach (param 0..1:
fist -> open claw), close (param 0..1: open -> wrapped round a gauntlet, index first, the thumb last), squeeze (additive pulse),
pull (loop: grinding), release (open, trembling), retract (back to the fist), dead (broken fingers), answer (loop: open, palm up).

Outputs: public/abyssal-tether-3d/assets/models/holdfast.glb (raw; then compress_glbs.mjs --only holdfast and
compress_glb_textures.mjs --only holdfast), previews/holdfast_sheet.png (+ the single tiles with --render), and a JSON report.

Run (always under the shared lock):
  flock /tmp/at3d-blender.lock $PY tools/abyssal-tether-3d/build_holdfast.py --out public/abyssal-tether-3d/assets/models \
        --renders <dir> [--render] [--bake 2048] [--samples 48] [--stage shape|bake|all] [--cache <dir>]
"""

import argparse
import json
import math
import os
import sys
import time

import bpy  # must come first: with the `bpy` module, bmesh/mathutils load after it
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.getcwd(), "holdfast_out"))
ap.add_argument("--renders", default="")
ap.add_argument("--render", action="store_true")
ap.add_argument("--samples", type=int, default=40)
ap.add_argument("--tile", type=int, default=560, help="preview tile size (px)")
ap.add_argument("--bake", type=int, default=2048)
ap.add_argument("--bake-samples", type=int, default=32)
ap.add_argument("--voxel", type=float, default=0.0009)
ap.add_argument("--stage", default="all", help="shape = clay renders of high + low; bake = bake + composite; all")
ap.add_argument("--cache", default="")
ap.add_argument("--only", default="", help="preview tiles to render (comma list)")
ap.add_argument("--blend", default="")
args = ap.parse_args(argv)
args.out = os.path.abspath(args.out)
os.makedirs(args.out, exist_ok=True)
RENDER_DIR = os.path.abspath(args.renders or args.out)
os.makedirs(RENDER_DIR, exist_ok=True)
CACHE_DIR = os.path.abspath(args.cache or os.path.join(RENDER_DIR, "_hf_cache"))
os.makedirs(CACHE_DIR, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TEX_DIR = os.path.join(REPO, "public", "abyssal-tether-3d", "assets", "textures")
T0 = time.time()
SEED = 4242


def log(*a):
    print(f"[holdfast {time.time() - T0:6.1f}s]", *a, flush=True)


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def sstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def hash01(i):
    i = (i ^ 61) ^ (i >> 16)
    i = (i + (i << 3)) & 0xFFFFFFFF
    i ^= i >> 4
    i = (i * 0x27D4EB2D) & 0xFFFFFFFF
    i ^= i >> 15
    return (i & 0xFFFFFFFF) / 4294967296.0


# =====================================================================================================================
# ANATOMY (rest pose). Hand-local (a, s, h): a = from the wrist toward the fingers, s = toward the thumb, h = the back.
# =====================================================================================================================
WRIST = Vector((0.0, -0.06, 0.0))
ELBOW = Vector((0.0, 0.30, 0.0))
HF = Vector((0, -1, 0))  # fingers
HS = Vector((1, 0, 0))  # thumb side
HB = Vector((0, 0, 1))  # back of the hand


def hpt(a, s, h):
    return WRIST + HF * a + HS * s + HB * h


FINGERS = ["index", "middle", "ring", "pinky"]
_LK, _RK = 0.93, 1.12  # (iteration 2: a little shorter and meatier: long and bony, not sticks)
# MCP (a, s, h), fan angle (deg, + toward the thumb), phalanx lengths (4: the extra knuckle is the second), radii at the joints
FDEF = {
    "index": dict(mcp=(0.094, 0.0285, 0.004), fan=7.0, L=[0.040, 0.029, 0.025, 0.021], R=[0.0100, 0.0089, 0.0082, 0.0075, 0.0066]),
    "middle": dict(mcp=(0.099, 0.0085, 0.006), fan=1.0, L=[0.045, 0.032, 0.028, 0.023], R=[0.0103, 0.0092, 0.0085, 0.0078, 0.0068]),
    "ring": dict(mcp=(0.095, -0.0115, 0.004), fan=-5.0, L=[0.042, 0.030, 0.026, 0.022], R=[0.0098, 0.0087, 0.0080, 0.0073, 0.0064]),
    "pinky": dict(mcp=(0.085, -0.0305, -0.001), fan=-12.0, L=[0.033, 0.024, 0.021, 0.019], R=[0.0088, 0.0078, 0.0071, 0.0065, 0.0057]),
}
REST_FLEX = [6.0, 7.0, 6.0, 4.0]  # relaxed curl per joint (deg)
TDEF = dict(cmc=(0.014, 0.017, -0.010), dir=(0.66, 0.64, -0.34), L=[0.046, 0.033, 0.027], R=[0.0128, 0.0112, 0.0099, 0.0090, 0.0074], flex=[0.0, 10.0, 8.0])


def rot_about(v, axis, ang_deg):
    return Quaternion(axis.normalized(), math.radians(ang_deg)) @ v


def finger_chain(name):
    """Joint points (5: MCP .. tip), per-segment frames (fwd, back, side) and radii, rest pose."""
    d = FDEF[name]
    p = hpt(*d["mcp"])
    fwd = rot_about(HF.copy(), HB, d["fan"])  # fan in the palm plane
    back = HB.copy()
    pts = [p.copy()]
    frames = []
    for k, L in enumerate(d["L"]):
        side = fwd.cross(back).normalized()  # flex axis (toward the thumb? sign checked below)
        fwd = rot_about(fwd, side, -REST_FLEX[k])  # curl toward the palm
        back = rot_about(back, side, -REST_FLEX[k])
        frames.append((fwd.copy(), back.copy(), side.copy()))
        p = p + fwd * L
        pts.append(p.copy())
    return pts, frames, d["R"]


def thumb_chain():
    d = TDEF
    p = hpt(*d["cmc"])
    fwd = (HF * d["dir"][0] + HS * d["dir"][1] + HB * d["dir"][2]).normalized()
    # the thumb's back (its nail) faces up and out
    b0 = (HB * 0.55 + HS * 0.45)
    back = (b0 - fwd * b0.dot(fwd)).normalized()
    pts = [p.copy()]
    frames = []
    for k, L in enumerate(d["L"]):
        side = fwd.cross(back).normalized()
        if k > 0:
            # the thumb's phalanges bend toward the fingers
            fwd = rot_about(fwd, side, -d["flex"][k])
            back = rot_about(back, side, -d["flex"][k])
            fwd = rot_about(fwd, back, -14.0 if k == 1 else -8.0)  # and turn toward the index
            side = fwd.cross(back).normalized()
        frames.append((fwd.copy(), back.copy(), side.copy()))
        p = p + fwd * L
        pts.append(p.copy())
    return pts, frames, d["R"]


for _f in FDEF.values():
    _f["L"] = [x * _LK for x in _f["L"]]
    _f["R"] = [x * _RK for x in _f["R"]]
TDEF["R"] = [x * 1.08 for x in TDEF["R"]]
CHAINS = {f: finger_chain(f) for f in FINGERS}
CHAINS["thumb"] = thumb_chain()


# ---- the palm and the forearm as lofted superellipses ------------------------------------------------------------------
def palm_section(a):
    """(centre (a, s, h), half width, half thickness, superellipse power) along the palm, a in [-0.01, 0.105]."""
    t = clamp((a + 0.01) / 0.115)
    hw = lerp(0.029, 0.0445, sstep(0.0, 0.62, t)) - 0.0060 * sstep(0.84, 1.0, t)
    ht = lerp(0.0150, 0.0165, sstep(0.0, 0.5, t)) - 0.0068 * sstep(0.70, 1.0, t)
    sc = lerp(0.0, -0.0010, t)
    hc = lerp(0.0, 0.0015, t)
    return (a, sc, hc), hw, ht, 2.6


def forearm_section(t):
    """t: 0 = the wrist, 1 = the elbow. (half width (x), half thickness (z), centre offset z)."""
    hw = lerp(0.0285, 0.044, sstep(0.0, 0.85, t)) + 0.0032 * math.exp(-((t - 0.62) / 0.18) ** 2)
    ht = lerp(0.0175, 0.036, sstep(0.0, 0.9, t)) + 0.003 * math.exp(-((t - 0.55) / 0.2) ** 2)
    return hw, ht, 0.0


def superellipse(ang, hw, ht, pw):
    c = math.cos(ang)
    s = math.sin(ang)
    x = hw * math.copysign(abs(c) ** (2.0 / pw), c)
    y = ht * math.copysign(abs(s) ** (2.0 / pw), s)
    return x, y


# =====================================================================================================================
# BONES
# =====================================================================================================================
def bone_table():
    """(name, parent, head, tail, z-axis hint (the back), connected)."""
    B = []
    B.append(("socket", None, Vector((0, 0, 0)), Vector((0, -0.04, 0)), Vector((0, 0, 1)), False))
    B.append(("forearm", "socket", ELBOW.copy(), WRIST.copy(), Vector((0, 0, 1)), False))
    mid = hpt(0.097, 0.004, 0.004)
    B.append(("hand", "forearm", WRIST.copy(), mid, Vector((0, 0, 1)), True))
    for f in FINGERS:
        pts, frames, _ = CHAINS[f]
        for k in range(4):
            B.append((f"{f}_{k + 1}", "hand" if k == 0 else f"{f}_{k}", pts[k].copy(), pts[k + 1].copy(), frames[k][1].copy(), k > 0))
    pts, frames, _ = CHAINS["thumb"]
    for k in range(3):
        B.append((f"thumb_{k + 1}", "hand" if k == 0 else f"thumb_{k}", pts[k].copy(), pts[k + 1].copy(), frames[k][1].copy(), k > 0))
    return B


BONES = bone_table()
BONE_NAMES = [b[0] for b in BONES]


# =====================================================================================================================
# LOW (game) mesh: tubes with rings at the joints, the palm, the forearm, the band, the nails, the socket
# =====================================================================================================================
class Part:
    def __init__(self, name, cls, uvw):
        self.name = name
        self.cls = cls  # 'flesh' | 'socket' | 'band' | 'nail'
        self.uvw = uvw  # texel weight (UV area multiplier)
        self.bm = bmesh.new()
        self.w = []  # per vertex {bone: weight}

    def v(self, co, w):
        vv = self.bm.verts.new(co)
        self.w.append(w)
        return vv


def ring_pts(c, side, back, rx, ry, n, phase=0.0, bump=None):
    out = []
    for i in range(n):
        ang = phase + 2 * math.pi * i / n
        x = math.cos(ang) * rx
        y = math.sin(ang) * ry
        if bump:
            x, y = bump(ang, x, y)
        out.append(c + side * x + back * y)
    return out


def bridge(part, rings, close=True):
    bm = part.bm
    for r0, r1 in zip(rings[:-1], rings[1:]):
        n = len(r0)
        for i in range(n if close else n - 1):
            j = (i + 1) % n
            try:
                bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
            except ValueError:
                pass


def cap(part, ring, tip_co, w, flip=False):
    c = part.v(tip_co, w)
    n = len(ring)
    for i in range(n):
        j = (i + 1) % n
        f = (ring[j], ring[i], c) if not flip else (ring[i], ring[j], c)
        try:
            part.bm.faces.new(f)
        except ValueError:
            pass
    return c


def chain_weights(names, s_cum, s, blend=0.0045):
    """Skin weights along a chain: bone k spans [s_cum[k], s_cum[k+1]]; blended over +-blend at each joint."""
    k = 0
    while k < len(names) - 1 and s > s_cum[k + 1]:
        k += 1
    w = {names[k]: 1.0}
    if k > 0 and s < s_cum[k] + blend:
        t = 0.5 + 0.5 * (s - s_cum[k]) / blend
        w = {names[k]: t, names[k - 1]: 1 - t}
    elif k < len(names) - 1 and s > s_cum[k + 1] - blend:
        t = 0.5 + 0.5 * (s_cum[k + 1] - s) / blend
        w = {names[k]: t, names[k + 1]: 1 - t}
    return w


def finger_low(name, sides=10):
    pts, frames, R = CHAINS[name]
    thumb = name == "thumb"
    names = [f"{name}_{k + 1}" for k in range(3 if thumb else 4)]
    part = Part(f"lo_{name}", "flesh", 2.4 if not thumb else 2.2)
    Ls = [(pts[k + 1] - pts[k]).length for k in range(len(pts) - 1)]
    s_cum = [0.0]
    for L in Ls:
        s_cum.append(s_cum[-1] + L)
    total = s_cum[-1]
    # ring stations (arc length): inside the palm, then 3 per segment (a pair round each joint + one mid)
    st = [-0.010 if not thumb else -0.012, 0.004]
    for k in range(len(Ls)):
        a0, a1 = s_cum[k], s_cum[k + 1]
        st.append((a0 + a1) / 2)
        if k < len(Ls) - 1:
            st += [a1 - 0.0034, a1 + 0.0034]
    st += [total - 0.0068, total - 0.0028]
    rings = []

    def frame_at(s):
        k = 0
        while k < len(Ls) - 1 and s > s_cum[k + 1]:
            k += 1
        f, b, sd = frames[k]
        # blend the frame across the joint
        if k > 0 and s < s_cum[k] + 0.004:
            t = 0.5 + 0.5 * (s - s_cum[k]) / 0.004
            f0, b0, s0 = frames[k - 1]
            f = (f0.lerp(f, t)).normalized()
            b = (b0.lerp(b, t)).normalized()
            sd = (s0.lerp(sd, t)).normalized()
        c = pts[k] + frames[k][0] * (s - s_cum[k]) if s >= 0 else pts[0] + frames[0][0] * s
        return c, f, b, sd

    for s in st:
        c, f, b, sd = frame_at(s)
        u = clamp(s / total, 0, 1)
        # radius along the chain (between the joint radii) and the knuckle swelling
        kk = min(len(R) - 2, int(u * (len(R) - 1)))
        r = lerp(R[kk], R[kk + 1], u * (len(R) - 1) - kk)
        knuck = 0.0
        for j in range(1, len(Ls)):
            knuck = max(knuck, math.exp(-((s - s_cum[j]) / 0.0040) ** 2))
        tipround = 1.0
        if s > total - 0.008:
            tipround = math.sqrt(max(0.05, 1 - ((s - (total - 0.008)) / 0.0085) ** 2))
        rx = r * 1.08 * (1 + 0.15 * knuck) * tipround
        ry = r * 0.98 * tipround

        def bump(ang, x, y, knuck=knuck, r=r):
            # dorsal knuckle ridge (y > 0 = the back), a flatter back, a fuller palmar pad
            if y > 0:
                y *= 0.92 + 0.22 * knuck * max(0.0, math.sin(ang)) ** 3
            else:
                y *= 1.04
            return x, y
        w = chain_weights(names, s_cum, s)
        if s < 0:
            w = {names[0]: 0.4, "hand": 0.6}
        elif s < 0.006:
            w = {names[0]: 0.85, "hand": 0.15}
        ring = [part.v(p, dict(w)) for p in ring_pts(c, sd, b, rx, ry, sides, bump=bump)]
        rings.append(ring)
    bridge(part, rings)
    tip_c, tf, tb, ts = frame_at(total - 0.0028)
    cap(part, rings[-1], tip_c + tf * 0.0026, {names[-1]: 1.0})
    # the base ring sits inside the palm: no cap
    return part, (pts, frames, R, s_cum)


def palm_low():
    part = Part("lo_palm", "flesh", 1.8)
    n_around = 16
    stations = [-0.010, 0.004, 0.022, 0.042, 0.062, 0.080, 0.094, 0.104]
    rings = []
    for a in stations:
        (aa, sc, hc), hw, ht, pw = palm_section(a)
        c = hpt(aa, sc, hc)
        ring = []
        for i in range(n_around):
            ang = 2 * math.pi * i / n_around
            x, y = superellipse(ang, hw, ht, pw)
            # the back of the hand a little domed, the palm hollow in the middle
            if y > 0:
                y *= 1.0 + 0.10 * math.cos(ang - math.pi / 2)
            else:
                y *= 0.92 - 0.10 * max(0.0, -math.sin(ang)) * max(0, 1 - abs(x) / hw * 1.6)
            p = c + HS * x + HB * y
            # weights: hand; near the wrist blend the forearm; near the knuckles a little of each finger
            w = {"hand": 1.0}
            if a < 0.006:
                t = clamp((a + 0.010) / 0.016)
                w = {"hand": 0.55 + 0.45 * t, "forearm": 0.45 * (1 - t)}
            ring.append(part.v(p, w))
        rings.append(ring)
    bridge(part, rings)
    # front cap (inside the finger bases) and back cap (inside the forearm)
    (aa, sc, hc), hw, ht, pw = palm_section(0.106)
    cap(part, rings[-1], hpt(0.108, sc, hc), {"hand": 1.0})
    cap(part, rings[0], hpt(-0.014, 0, 0), {"hand": 0.5, "forearm": 0.5}, flip=True)
    return part


def thenar_low():
    """The ball of the thumb: a squashed ellipsoid under the palm, skinned to the hand and the thumb's metacarpal."""
    part = Part("lo_thenar", "flesh", 1.6)
    c = hpt(0.034, 0.019, -0.007)
    tp, tfr, _ = CHAINS["thumb"]
    ax = (tp[1] - tp[0]).normalized()
    up = (HB - ax * HB.dot(ax)).normalized()
    sd = ax.cross(up).normalized()
    nu, nv = 8, 5
    rings = []
    for j in range(1, nv):
        th = math.pi * j / nv
        ring = []
        for i in range(nu):
            ph = 2 * math.pi * i / nu
            p = c + ax * (0.029 * math.cos(th)) + sd * (0.0165 * math.sin(th) * math.cos(ph)) + up * (0.0118 * math.sin(th) * math.sin(ph))
            ring.append(part.v(p, {"hand": 0.6, "thumb_1": 0.4}))
        rings.append(ring)
    bridge(part, rings)
    cap(part, rings[0], c + ax * 0.029, {"hand": 0.5, "thumb_1": 0.5}, flip=True)
    cap(part, rings[-1], c - ax * 0.029, {"hand": 0.8, "thumb_1": 0.2})
    return part


def forearm_low(sides=12):
    part = Part("lo_forearm", "flesh", 0.9)
    ts = [-0.06, 0.0, 0.07, 0.16, 0.27, 0.40, 0.55, 0.72, 0.88, 1.0]
    rings = []
    L = (ELBOW - WRIST).length
    for t in ts:
        tt = max(0.0, t)
        hw, ht, oz = forearm_section(tt)
        if t < 0:
            hw *= 0.97
            ht *= 0.97
        c = WRIST + Vector((0, 1, 0)) * (t * L)
        ring = []
        for i in range(sides):
            ang = 2 * math.pi * i / sides
            x, y = superellipse(ang, hw, ht, 2.2)
            p = c + Vector((x, 0, y + oz))
            w = {"forearm": 1.0}
            if t < 0.03:
                k = clamp((0.03 - t) / 0.09)
                w = {"forearm": 1 - 0.5 * k, "hand": 0.5 * k}
            ring.append(part.v(p, w))
        rings.append(ring)
    bridge(part, rings)
    return part


def band_low():
    """The wedding band of mortar on the ring finger's first phalanx."""
    part = Part("lo_band", "band", 1.4)
    pts, frames, R = CHAINS["ring"]
    f, b, sd = frames[0]
    c = pts[0] + f * 0.017
    r = R[0] * 1.10 + 0.0006
    rings = []
    for (dz, dr) in ((-0.0028, 0.0), (-0.0020, 0.0024), (0.0020, 0.0024), (0.0028, 0.0)):
        ring = [part.v(p, {"ring_1": 1.0}) for p in ring_pts(c + f * dz, sd, b, r * 1.02 + dr, r * 0.94 + dr, 10)]
        rings.append(ring)
    bridge(part, rings)
    return part


def nail_low(name):
    """A slate nail: a thin wedge plate on the last phalanx, overhanging the tip (part of the silhouette)."""
    pts, frames, R = CHAINS[name]
    thumb = name == "thumb"
    k = len(pts) - 2
    f, b, sd = frames[k]
    L = (pts[k + 1] - pts[k]).length
    r = R[-2]
    part = Part(f"lo_nail_{name}", "nail", 1.2)
    bone = f"{name}_{k + 1}"
    base = pts[k] + f * (L * 0.38) + b * (r * 0.92)
    tip = pts[k + 1] + f * (0.0055 if not thumb else 0.0045) + b * (r * 0.30)
    hw0 = r * 0.78
    hw1 = r * 0.55
    th = 0.0011
    quads = []
    for (p, hw) in ((base, hw0), (base.lerp(tip, 0.55), hw0 * 1.02), (tip, hw1)):
        quads.append([p - sd * hw - b * 0.0004, p + sd * hw - b * 0.0004, p + sd * hw + b * th, p - sd * hw + b * th])
    rings = [[part.v(q, {bone: 1.0}) for q in ring] for ring in quads]
    bridge(part, rings)
    cap(part, rings[0], base + b * 0.0003 - f * 0.001, {bone: 1.0}, flip=True)
    cap(part, rings[-1], tip + f * 0.0018 + b * 0.0003, {bone: 1.0})
    return part


# ---- the socket: a torn crater of masonry -----------------------------------------------------------------------------
SOCK_SEG = 20


def socket_height(r, ang, hi=False):
    """Height out of the wall (m, along -Y) of the crater at radius r and angle ang (deterministic, matches HIGH and LOW)."""
    # angular irregularity: broken chunks of the rim, a missing bite at about 4 o'clock
    n1 = 0.5 * math.sin(3 * ang + 1.3) + 0.3 * math.sin(5 * ang + 0.4) + 0.2 * math.sin(9 * ang + 2.1)
    bite = math.exp(-((math.atan2(math.sin(ang - 5.6), math.cos(ang - 5.6))) / 0.35) ** 2)
    rim_r = 0.104 + 0.010 * n1
    rim_h = 0.040 + 0.010 * n1 - 0.020 * bite
    hole = 0.081 + 0.004 * n1
    if r < hole:
        return 0.004  # the dark floor, just in front of the face
    if r < rim_r:
        t = (r - hole) / (rim_r - hole)
        return lerp(0.004, rim_h, sstep(0.0, 1.0, t) ** 0.8)
    out = 0.205 + 0.012 * n1
    t = clamp((r - rim_r) / (out - rim_r))
    h = rim_h * (1 - sstep(0.0, 1.0, t)) ** 1.6
    if hi:
        # peeled plaster plates in the flare: steps
        h += 0.004 * (1 - t) * (math.sin(14 * ang + 3 * n1) > 0.3)
    return max(h, -0.0015)


def socket_low():
    part = Part("lo_socket", "socket", 0.7)
    radii = [0.060, 0.0815, 0.090, 0.098, 0.112, 0.135, 0.165, 0.215]
    rings = []
    for ri, r0 in enumerate(radii):
        ring = []
        for i in range(SOCK_SEG):
            ang = 2 * math.pi * i / SOCK_SEG
            r = r0 * (1 + 0.04 * math.sin(7 * ang + ri))
            if ri == 0:
                y = 0.03  # the throat inside the wall (never seen)
            else:
                y = -socket_height(r, ang)
            if ri == len(radii) - 1:
                y = 0.0005  # flush with (a hair behind) the face
            ring.append(part.v(Vector((math.cos(ang) * r, y, math.sin(ang) * r)), {"socket": 1.0}))
        rings.append(ring)
    # faces: outward (toward -Y)
    bm = part.bm
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for i in range(SOCK_SEG):
            j = (i + 1) % SOCK_SEG
            bm.faces.new((r0[i], r1[i], r1[j], r0[j]))
    # the floor disc: dark, closes the hole just in front of the face
    fl = [part.v(Vector((math.cos(2 * math.pi * i / SOCK_SEG) * 0.0815, -0.004, math.sin(2 * math.pi * i / SOCK_SEG) * 0.0815)), {"socket": 1.0}) for i in range(SOCK_SEG)]
    c = part.v(Vector((0, -0.004, 0)), {"socket": 1.0})
    for i in range(SOCK_SEG):
        j = (i + 1) % SOCK_SEG
        bm.faces.new((fl[i], c, fl[j]))
    return part


def build_low():
    parts = [palm_low(), thenar_low(), forearm_low(), band_low(), socket_low()]
    for f in FINGERS + ["thumb"]:
        p, _ = finger_low(f)
        parts.append(p)
        parts.append(nail_low(f))
    return parts


# =====================================================================================================================
# HIGH: dense versions of the same tubes -> voxel union -> smoothing -> numpy sculpt layers (+ nails, band, socket)
# =====================================================================================================================
def tube_dense(bm, centres, frames, radii_x, radii_y, n=48, bumpfn=None, cap0=True, cap1=True):
    rings = []
    for c, (f, b, sd), rx, ry in zip(centres, frames, radii_x, radii_y):
        ring = []
        for i in range(n):
            ang = 2 * math.pi * i / n
            x = math.cos(ang) * rx
            y = math.sin(ang) * ry
            if bumpfn:
                x, y = bumpfn(ang, x, y, c)
            ring.append(bm.verts.new(c + sd * x + b * y))
        rings.append(ring)
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    if cap0:
        c0 = bm.verts.new(centres[0] - frames[0][0] * 0.0005)
        for i in range(n):
            bm.faces.new((rings[0][(i + 1) % n], rings[0][i], c0))
    if cap1:
        c1 = bm.verts.new(centres[-1] + frames[-1][0] * 0.0005)
        for i in range(n):
            bm.faces.new((rings[-1][i], rings[-1][(i + 1) % n], c1))


def finger_high(bm, name):
    pts, frames, R = CHAINS[name]
    Ls = [(pts[k + 1] - pts[k]).length for k in range(len(pts) - 1)]
    s_cum = [0.0]
    for L in Ls:
        s_cum.append(s_cum[-1] + L)
    total = s_cum[-1]
    thumb = name == "thumb"
    cs, fr, rx, ry = [], [], [], []
    s = -0.012 if not thumb else -0.016
    while s <= total - 0.0002:
        k = 0
        while k < len(Ls) - 1 and s > s_cum[k + 1]:
            k += 1
        f, b, sd = frames[k]
        if k > 0 and s < s_cum[k] + 0.005:
            t = 0.5 + 0.5 * (s - s_cum[k]) / 0.005
            f0, b0, s0 = frames[k - 1]
            f, b, sd = f0.lerp(f, t).normalized(), b0.lerp(b, t).normalized(), s0.lerp(sd, t).normalized()
        elif k < len(Ls) - 1 and s > s_cum[k + 1] - 0.005:
            t = 0.5 - 0.5 * (s_cum[k + 1] - s) / 0.005
            f1, b1, s1 = frames[k + 1]
            f, b, sd = f.lerp(f1, t).normalized(), b.lerp(b1, t).normalized(), sd.lerp(s1, t).normalized()
        c = pts[k] + frames[k][0] * (s - s_cum[k]) if s >= 0 else pts[0] + frames[0][0] * s
        u = clamp(s / total)
        kk = min(len(R) - 2, int(u * (len(R) - 1)))
        r = lerp(R[kk], R[kk + 1], u * (len(R) - 1) - kk)
        knuck = 0.0
        for j in range(1, len(Ls)):
            knuck = max(knuck, math.exp(-((s - s_cum[j]) / 0.0042) ** 2))
        pad = 0.0
        for j in range(len(Ls)):
            mid = (s_cum[j] + s_cum[j + 1]) / 2
            pad = max(pad, math.exp(-((s - mid) / (0.30 * Ls[j])) ** 2))
        tipround = 1.0
        if s > total - 0.0095:
            tipround = math.sqrt(max(0.0, 1 - ((s - (total - 0.0095)) / 0.0097) ** 2))
        cs.append(c)
        fr.append((f, b, sd))
        slim = 1.0 - 0.07 * pad * (1 - knuck)  # the phalanges thin between the joints: bony
        rx.append(r * 1.08 * (1 + 0.17 * knuck) * slim * max(0.05, tipround))
        ry.append(r * 0.98 * (1 + 0.06 * knuck) * slim * max(0.05, tipround))
        # stash per-ring knuckle / pad for the bump function
        fr[-1] = (f, b, sd, knuck, pad)
        s += 0.0006
    frames3 = [(a[0], a[1], a[2]) for a in fr]
    extra = [(a[3], a[4]) for a in fr]
    idx = {"i": 0}

    def bump(ang, x, y, c, extra=extra, idx=idx):
        kn, pd = extra[min(idx["i"] // 48, len(extra) - 1)]
        idx["i"] += 1
        sn = math.sin(ang)
        if y > 0:
            y *= 0.90 + 0.42 * kn * max(0.0, sn) ** 4  # the bony ridge of each knuckle (three a finger: one too many)
        else:
            y *= 1.02 + 0.10 * pd * (-sn) ** 2  # the pads between the creases
        return x, y
    tube_dense(bm, cs, frames3, rx, ry, n=48, bumpfn=bump, cap0=True, cap1=True)
    # a rounded tip cap (the last ring is tiny)
    return s_cum


def palm_high(bm):
    rings = []
    n = 96
    a = -0.012
    while a <= 0.1075:
        (aa, sc, hc), hw, ht, pw = palm_section(a)
        c = hpt(aa, sc, hc)
        ring = []
        for i in range(n):
            ang = 2 * math.pi * i / n
            x, y = superellipse(ang, hw, ht, pw)
            if y > 0:
                y *= 1.0 + 0.10 * math.cos(ang - math.pi / 2)
            else:
                y *= 0.92 - 0.10 * max(0.0, -math.sin(ang)) * max(0, 1 - abs(x) / hw * 1.6)
            # knuckle end: the metacarpal heads stand out on the back
            if y > 0 and a > 0.075:
                for f in FINGERS:
                    ms = FDEF[f]["mcp"][1]
                    y += 0.0032 * math.exp(-((x - ms) / 0.0058) ** 2) * sstep(0.075, 0.098, a) * (1 - sstep(0.100, 0.108, a))
            ring.append(bm.verts.new(c + HS * x + HB * y))
        rings.append(ring)
        a += 0.0008
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    for ring, sign in ((rings[0], -1), (rings[-1], 1)):
        c = sum((v.co for v in ring), Vector()) / len(ring)
        cv = bm.verts.new(c)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((ring[j], ring[i], cv) if sign > 0 else (ring[i], ring[j], cv))


def ellipsoid_high(bm, c, ax, sd, up, ra, rs, ru, nu=40, nv=24):
    rings = []
    for j in range(1, nv):
        th = math.pi * j / nv
        ring = [bm.verts.new(c + ax * (ra * math.cos(th)) + sd * (rs * math.sin(th) * math.cos(2 * math.pi * i / nu)) + up * (ru * math.sin(th) * math.sin(2 * math.pi * i / nu))) for i in range(nu)]
        rings.append(ring)
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for i in range(nu):
            k = (i + 1) % nu
            bm.faces.new((r0[i], r0[k], r1[k], r1[i]))
    p0 = bm.verts.new(c + ax * ra)
    p1 = bm.verts.new(c - ax * ra)
    for i in range(nu):
        k = (i + 1) % nu
        bm.faces.new((rings[0][k], rings[0][i], p0))
        bm.faces.new((rings[-1][i], rings[-1][k], p1))


def forearm_high(bm):
    n = 96
    rings = []
    L = (ELBOW - WRIST).length
    t = -0.07
    while t <= 0.72:  # deeper in the wall is never seen (the low's elbow end bakes from the dilation)
        tt = max(0.0, t)
        hw, ht, oz = forearm_section(tt)
        c = WRIST + Vector((0, 1, 0)) * (t * L)
        ring = []
        for i in range(n):
            ang = 2 * math.pi * i / n
            x, y = superellipse(ang, hw, ht, 2.2)
            # the muscle bellies: brachioradialis on the thumb side near the elbow, the flexors underneath
            x *= 1.0 + 0.07 * math.exp(-((tt - 0.7) / 0.18) ** 2) * max(0.0, math.cos(ang)) ** 2
            y *= 1.0 + 0.06 * math.exp(-((tt - 0.6) / 0.22) ** 2) * max(0.0, -math.sin(ang)) ** 2
            ring.append(bm.verts.new(c + Vector((x, 0, y + oz))))
        rings.append(ring)
        t += 0.0028
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    for ring, sign in ((rings[0], -1), (rings[-1], 1)):
        c = sum((v.co for v in ring), Vector()) / len(ring)
        cv = bm.verts.new(c)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((ring[j], ring[i], cv) if sign < 0 else (ring[i], ring[j], cv))


def to_object(bm, name, coll):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def mesh_np(ob):
    me = ob.data
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def vnormals_np(ob):
    me = ob.data
    n = np.empty(len(me.vertices) * 3, np.float64)
    try:
        me.vertex_normals.foreach_get("vector", n)
    except AttributeError:
        me.vertices.foreach_get("normal", n)
    return n.reshape(-1, 3)


# ---- numpy noise --------------------------------------------------------------------------------------------------------
def _h3(ix, iy, iz, s):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (s * 2654435761)
    h = h.astype(np.uint64) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(15)
    h = (h * np.uint64(0x2C1B3C6D)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(12)
    h = (h * np.uint64(0x297A2D39)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(15)
    return (h & np.uint64(0xFFFFFF)).astype(np.float64) / float(0xFFFFFF)


def vnoise(P, freq, seed):
    """Value noise in 3D, smooth, ~[-1, 1]."""
    Q = P * freq
    i = np.floor(Q).astype(np.int64)
    f = Q - i
    u = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * _h3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out * 2 - 1


def fbm(P, freq, seed, oct_=4, gain=0.5):
    a = 1.0
    s = 0.0
    n = 0.0
    for o in range(oct_):
        s = s + a * vnoise(P, freq * (2.03 ** o), seed + o * 31)
        n += a
        a *= gain
    return s / n


def voronoi_edge(P, cell, seed, jitter=0.85):
    """F2 - F1 (m) of a jittered grid (cell size `cell`): small = on a crack."""
    Q = P / cell
    i = np.floor(Q).astype(np.int64)
    f1 = np.full(len(P), 1e9)
    f2 = np.full(len(P), 1e9)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                cx = i[:, 0] + dx
                cy = i[:, 1] + dy
                cz = i[:, 2] + dz
                fx = cx + 0.5 + (_h3(cx, cy, cz, seed) - 0.5) * jitter
                fy = cy + 0.5 + (_h3(cx, cy, cz, seed + 1) - 0.5) * jitter
                fz = cz + 0.5 + (_h3(cx, cy, cz, seed + 2) - 0.5) * jitter
                d = np.sqrt((Q[:, 0] - fx) ** 2 + (Q[:, 1] - fy) ** 2 + (Q[:, 2] - fz) ** 2)
                m = d < f1
                f2 = np.where(m, f1, np.minimum(f2, d))
                f1 = np.where(m, d, f1)
    return (f2 - f1) * cell


def seg_dist(P, a, b):
    """Distance from points to the segment a-b, and the parameter (0..1)."""
    ab = b - a
    L2 = float(ab @ ab)
    t = np.clip(((P - a) @ ab) / max(L2, 1e-12), 0, 1)
    q = a + t[:, None] * ab
    return np.linalg.norm(P - q, axis=1), t


def polyline_dist(P, pts):
    best = np.full(len(P), 1e9)
    bu = np.zeros(len(P))
    acc = 0.0
    total = sum(float(np.linalg.norm(pts[k + 1] - pts[k])) for k in range(len(pts) - 1))
    for k in range(len(pts) - 1):
        d, t = seg_dist(P, pts[k], pts[k + 1])
        L = float(np.linalg.norm(pts[k + 1] - pts[k]))
        m = d < best
        best = np.where(m, d, best)
        bu = np.where(m, (acc + t * L) / total, bu)
        acc += L
    return best, bu


def vec(v):
    return np.array([v[0], v[1], v[2]], dtype=np.float64)


# ---- the sculpt layers ------------------------------------------------------------------------------------------------
def sculpt(P, N):
    """Displacement (m, along the normal) + albedo (linear RGB) + roughness + vein mask for every HIGH vertex (rest pose)."""
    n = len(P)
    disp = np.zeros(n)
    rng_seed = SEED
    # which part: nearest finger / thumb axis, the palm, the forearm
    best = np.full(n, 1e9)
    part = np.full(n, -1)  # 0..3 fingers, 4 thumb, 5 palm, 6 forearm
    along = np.zeros(n)  # arc length on that chain (m)
    joint_d = np.full(n, 1e9)  # distance along the chain to the nearest joint (m, signed abs)
    dors = np.zeros(n)  # dorsal-ness: +1 on the back, -1 on the palm side
    for pi, name in enumerate(FINGERS + ["thumb"]):
        pts, frames, R = CHAINS[name]
        acc = 0.0
        joints = [0.0]
        for k in range(len(pts) - 1):
            a = vec(pts[k])
            b = vec(pts[k + 1])
            L = float(np.linalg.norm(b - a))
            d, t = seg_dist(P, a, b)
            if k == 0:
                # the finger base: allow a little inside the palm
                d0, t0 = seg_dist(P, a - (b - a) / L * 0.010, a)
                d = np.minimum(d, d0 + 0.0005)
            m = d < best
            best = np.where(m, d, best)
            part = np.where(m, pi, part)
            along = np.where(m, acc + t * L, along)
            bk = vec(frames[k][1])
            q = a + t[:, None] * (b - a)
            dd = P - q
            dl = np.linalg.norm(dd, axis=1) + 1e-9
            dors = np.where(m, (dd @ bk) / dl, dors)
            acc += L
            joints.append(acc)
        # nearest joint (not the base, not the tip)
        jd = np.full(n, 1e9)
        for j in joints[1:-1]:
            jd = np.minimum(jd, np.abs(along - j))
        joint_d = np.where(part == pi, jd, joint_d)
    # palm and forearm: the distance to their surfaces is not to an axis; use the nearest point in hand coords
    W = vec(WRIST)
    rel = P - W
    a_h = rel @ vec(HF)
    s_h = rel @ vec(HS)
    h_h = rel @ vec(HB)
    palm = (a_h > -0.012) & (a_h < 0.108) & (np.abs(s_h) < 0.06) & (best > 0.0125)
    part = np.where(palm & (part < 0) | palm & (best > 0.013), 5, part)
    fore = a_h < -0.004
    part = np.where(fore & (best > 0.014), 6, part)
    dors = np.where(part >= 5, np.clip(h_h / 0.012, -1, 1), dors)
    is_f = part <= 3
    is_t = part == 4
    is_p = part == 5
    is_fa = part == 6
    # ---- 1. skin grain + stone grain everywhere
    g1 = fbm(P, 900.0, rng_seed + 1, 3)
    g2 = fbm(P, 2600.0, rng_seed + 2, 2)
    disp += 0.00006 * g1 + 0.000035 * g2
    # ---- 2. knuckle wrinkles on the back of every joint, deep creases on the palm side
    back = np.clip(dors, 0, 1) ** 1.5
    palmar = np.clip(-dors, 0, 1) ** 1.2
    kdist = np.full(n, 1e9)
    for name in FINGERS + ["thumb"]:
        pts, frames, R = CHAINS[name]
        for j in range(1, len(pts) - 1):
            kp0 = vec(pts[j]) + vec(frames[j][1]) * R[j] * 1.0
            kdist = np.minimum(kdist, np.linalg.norm(P - kp0, axis=1))
    jw = np.exp(-(kdist / 0.0062) ** 2)
    across = np.sin(2 * np.pi * kdist / 0.00125 + 2.6 * g1 + 1.5 * fbm(P, 500.0, rng_seed + 3, 2))
    across *= 0.55 + 0.45 * np.clip(fbm(P, 700.0, rng_seed + 4, 2) + 0.3, 0, 1)
    disp += (is_f | is_t) * (0.00024 * jw * across * back)
    crease = np.exp(-(joint_d / 0.0006) ** 2)
    disp -= (is_f | is_t) * (0.00042 * crease * palmar)
    # the knuckle stone plates: raised, rough
    kp = np.exp(-(kdist / 0.0055) ** 2) * back  # (the colour: bruised, dusty knuckles)
    # palm lines (heart / head / life lines): three grooves on the palm side
    if True:
        def groove(p0, p1, w, d):
            dd, _ = seg_dist(P, vec(hpt(*p0)), vec(hpt(*p1)))
            return d * np.exp(-(dd / w) ** 2)
        pl = groove((0.072, -0.040, -0.016), (0.062, 0.020, -0.017), 0.0006, 0.0005)
        pl += groove((0.060, 0.032, -0.016), (0.048, -0.020, -0.017), 0.0006, 0.00045)
        pl += groove((0.072, 0.030, -0.016), (0.012, 0.014, -0.018), 0.0007, 0.0005)
        disp -= is_p * palmar * pl
    # ---- 3. the stone cracks (Voronoi edges): many on the forearm and the back of the hand, few on the fingers' palm side
    cell = np.where(is_fa, 0.011, np.where(is_p, 0.0085, 0.0060))
    ve = np.zeros(n)
    for c in (0.011, 0.0085, 0.006):
        m = cell == c
        if m.any():
            ve[m] = voronoi_edge(P[m], c, rng_seed + 11)
    crack_w = 0.00022 + 0.00022 * np.clip(fbm(P, 260.0, rng_seed + 12, 2) + 0.2, 0, 1)
    crack = np.clip(1 - ve / crack_w, 0, 1) ** 2
    live = np.clip((fbm(P, 95.0, rng_seed + 14, 3) + 0.05) * 3.0, 0, 1)  # only some of the cell edges have cracked
    crack_mask = np.clip(0.25 + 0.75 * (dors > -0.3), 0, 1) * live * np.where(is_fa, 1.0, np.where(is_p, 0.8, 0.55))
    crack *= crack_mask
    ve2 = voronoi_edge(P, 0.0032, rng_seed + 15, 0.95)
    craze = np.clip(1 - ve2 / 0.00012, 0, 1) * np.clip(fbm(P, 180.0, rng_seed + 16, 2) * 2 + 0.2, 0, 1)
    disp -= 0.00042 * crack + 0.00007 * craze
    # ---- 4. the extensor tendons of ROPE on the back of the hand (wrist -> each knuckle): twisted ridges
    rope = np.zeros(n)
    for f in FINGERS:
        ms = FDEF[f]["mcp"]
        p0 = vec(hpt(0.004, ms[1] * 0.35, 0.0135))
        p1 = vec(hpt(ms[0] - 0.006, ms[1], 0.0125 + ms[2]))
        d, t = seg_dist(P, p0, p1)
        ridge = np.exp(-(d / 0.0021) ** 2) * (h_h > 0.004) * np.clip(t * 6, 0, 1)
        L = float(np.linalg.norm(p1 - p0))
        tw = np.sin(2 * np.pi * (t * L) / 0.0031 + (s_h - ms[1] * 0.35) / 0.0011 * 2.2)
        rope = np.maximum(rope, ridge * (0.70 + 0.30 * tw))
    disp += 0.00085 * rope * (part == 5)
    # the forearm's two big tendons near the wrist (dorsal), also rope
    for sx in (-0.008, 0.010):
        p0 = vec(WRIST + Vector((sx, 0.002, 0.0172)))
        p1 = vec(WRIST + Vector((sx * 1.6, 0.11, 0.024)))
        d, t = seg_dist(P, p0, p1)
        L = float(np.linalg.norm(p1 - p0))
        ridge = np.exp(-(d / 0.0026) ** 2) * (h_h > 0.006) * (1 - t) ** 0.7
        tw = np.sin(2 * np.pi * (t * L) / 0.0034 + (P[:, 0] - sx) / 0.0012 * 2.0)
        rope = np.maximum(rope, ridge * (0.7 + 0.3 * tw) * is_fa)
        disp += 0.0010 * ridge * (0.7 + 0.3 * tw) * is_fa
    # ---- 5. the split at the wrist: the stone-flesh torn open on the back of the wrist, rope fibres inside
    gash_c = vec(WRIST + Vector((0.004, 0.012, 0.018)))
    gd = P - gash_c
    ge = np.sqrt((gd[:, 0] / 0.0075) ** 2 + (gd[:, 1] / 0.026) ** 2) + 0.18 * fbm(P, 700.0, rng_seed + 21, 2)
    gash = np.clip((1.0 - ge) / 0.25, 0, 1) * (h_h > 0.008)
    fib = np.sin(2 * np.pi * P[:, 0] / 0.0009 + 3.0 * np.sin(2 * np.pi * P[:, 1] / 0.012))
    disp -= 0.0016 * gash
    disp += 0.0005 * gash * (0.5 + 0.5 * fib)
    # ---- 6. veins: back of the hand and the forearm (raised, pulsing in the view)
    veins = np.zeros(n)
    vpaths = [
        [hpt(0.085, 0.020, 0.016), hpt(0.06, 0.012, 0.0165), hpt(0.03, 0.016, 0.017), hpt(0.0, 0.010, 0.0175), WRIST + Vector((0.012, 0.06, 0.024)), WRIST + Vector((0.02, 0.15, 0.03))],
        [hpt(0.08, -0.024, 0.015), hpt(0.05, -0.016, 0.0165), hpt(0.02, -0.022, 0.0168), WRIST + Vector((-0.02, 0.05, 0.020)), WRIST + Vector((-0.024, 0.16, 0.028))],
        [hpt(0.05, -0.016, 0.0165), hpt(0.045, 0.002, 0.017), hpt(0.03, 0.016, 0.017)],
        [WRIST + Vector((0.02, 0.01, -0.012)), WRIST + Vector((0.026, 0.09, -0.02)), WRIST + Vector((0.018, 0.2, -0.03))],
    ]
    for path in vpaths:
        pts = np.array([vec(p) for p in path])
        # perturb the path a little (deterministic)
        d, u = polyline_dist(P, pts)
        wob = 0.0007 * fbm(P, 400.0, rng_seed + 31, 2)
        v = np.exp(-((d + wob) / 0.0011) ** 2)
        veins = np.maximum(veins, v)
    disp += 0.00055 * veins * (1 - gash)
    # ---- 7. fingertips: worn flat, grimed with mortar
    tipz = np.zeros(n)
    for pi, name in enumerate(FINGERS + ["thumb"]):
        pts, _, _ = CHAINS[name]
        tip = vec(pts[-1])
        tipz = np.maximum(tipz, (part == pi) * np.exp(-(np.linalg.norm(P - tip, axis=1) / 0.009) ** 2))
    disp -= 0.0002 * tipz * (fbm(P, 1500.0, rng_seed + 41, 2) > 0.1)
    # ===== colour (linear), roughness, vein mask
    stone = np.array([0.205, 0.192, 0.185])
    flesh = np.array([0.33, 0.165, 0.160])
    mixn = np.clip(0.5 + 0.55 * fbm(P, 60.0, rng_seed + 51, 3), 0, 1)
    flesh_amt = np.clip(0.35 + 0.45 * mixn - 0.25 * is_fa - 0.15 * np.clip(dors, 0, 1) + 0.35 * palmar, 0, 1)
    col = stone[None, :] * (1 - flesh_amt[:, None]) + flesh[None, :] * flesh_amt[:, None]
    col *= (0.86 + 0.20 * g1)[:, None]
    # bruised knuckles, raw creases
    bruise = np.array([0.30, 0.12, 0.13])
    col = col * (1 - 0.55 * kp[:, None] * (is_f | is_t)[:, None]) + bruise * (0.55 * kp * (is_f | is_t))[:, None]
    raw = np.array([0.20, 0.055, 0.06])
    cr = np.clip(crease * palmar * 2, 0, 1)
    col = col * (1 - cr[:, None]) + raw * cr[:, None]
    # cracks: dark, a little red deep inside
    deep = np.array([0.035, 0.018, 0.018])
    col = col * (1 - 0.85 * crack[:, None]) + deep * (0.85 * crack)[:, None]
    # veins: grey-violet
    vein_c = np.array([0.14, 0.11, 0.19])
    col = col * (1 - 0.55 * veins[:, None]) + vein_c * (0.55 * veins)[:, None]
    # rope: hemp, darker grooves (on the hand's tendons only where the ridge is high; the gash shows bare fibre)
    hemp = np.array([0.24, 0.17, 0.095])
    hr = np.clip(rope * 1.2 - 0.45, 0, 1) * 0.45
    col = col * (1 - hr[:, None]) + hemp * hr[:, None]
    gf = np.clip(gash * 1.4, 0, 1)
    fibre = hemp * (0.55 + 0.45 * (0.5 + 0.5 * fib))[:, None]
    col = col * (1 - gf[:, None]) + fibre * gf[:, None]
    # grime on the tips (mortar dust) and dried blood in the nail beds come with the nails
    grime = np.array([0.11, 0.10, 0.092])
    col = col * (1 - 0.6 * tipz[:, None]) + grime * (0.6 * tipz)[:, None]
    # the forearm darkens toward the elbow (the inside of the wall: soot and wet)
    soot = np.clip((-a_h - 0.05) / 0.18, 0, 1) * is_fa
    col *= (1 - 0.55 * soot)[:, None]
    # roughness: wet (low) flesh, rough cracks and plates
    rough = 0.30 + 0.10 * mixn - 0.06 * palmar + 0.40 * crack + 0.25 * kp * (is_f | is_t) + 0.30 * gf + 0.15 * tipz - 0.08 * veins
    rough = np.clip(rough, 0.16, 0.95)
    vein_mask = np.clip(veins * (1 - gash) + 0.35 * crack * (dors > 0), 0, 1)
    return disp, np.clip(col, 0, 1), rough, vein_mask


def nails_high(coll):
    """Slate nails: layered plates with chipped edges (separate HIGH objects, kept sharp)."""
    obs = []
    for name in FINGERS + ["thumb"]:
        pts, frames, R = CHAINS[name]
        k = len(pts) - 2
        f, b, sd = frames[k]
        L = (pts[k + 1] - pts[k]).length
        r = R[-2]
        bm = bmesh.new()
        nu, nv = 18, 26
        thumb = name == "thumb"
        grid = []
        for j in range(nv + 1):
            v = j / nv
            row = []
            for i in range(nu + 1):
                u = i / nu * 2 - 1
                hw = r * lerp(0.80, 0.52, v ** 1.5)
                along = lerp(L * 0.36, L + (0.0062 if not thumb else 0.005), v)
                p0 = pts[k] + f * along
                # curved round the finger (a cylinder arc) and lifting off at the free edge
                ang = u * 1.05
                lift = 0.0012 * sstep(0.62, 1.0, v)
                rr = r * (0.97 - 0.65 * sstep(0.7, 1.0, v)) + 0.0007 + lift
                p = p0 + sd * (math.sin(ang) * rr * hw / (r * 0.8)) + b * (math.cos(ang) * rr)
                # slate: stepped layers + chips at the free edge
                step = 0.00028 * (math.floor((v * 3.2 + 0.4 * math.sin(u * 4 + j)) % 3))
                chip = 0.0
                if v > 0.86:
                    chip = -0.0012 * (hash01(i * 131 + j * 7 + len(name)) > 0.62)
                p = p + b * step + f * chip
                row.append(bm.verts.new(p))
            grid.append(row)
        for j in range(nv):
            for i in range(nu):
                bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
        me = bpy.data.meshes.new(f"hi_nail_{name}")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(f"hi_nail_{name}", me)
        coll.objects.link(ob)
        mod = ob.modifiers.new("solid", "SOLIDIFY")
        mod.thickness = 0.0009
        mod.offset = -1.0
        activate(ob)
        bpy.ops.object.modifier_apply(modifier="solid")
        obs.append(ob)
    return obs


def band_high(coll):
    pts, frames, R = CHAINS["ring"]
    f, b, sd = frames[0]
    c = pts[0] + f * 0.017
    r = R[0] * 1.10 + 0.0006
    bm = bmesh.new()
    nu, nv = 64, 14
    rings = []
    for j in range(nv):
        a = 2 * math.pi * j / nv
        dz = math.cos(a) * 0.0029
        dr = 0.0013 + math.sin(a) * 0.0013
        ring = []
        for i in range(nu):
            ang = 2 * math.pi * i / nu
            # mortar: lumpy, chipped
            lump = 0.00035 * math.sin(7 * ang + 1.1) + 0.0002 * math.sin(17 * ang + j)
            chip = -0.0008 * (hash01(i * 17 + 3) > 0.84) * (math.sin(a) > 0)
            rr = r + dr + lump + chip
            ring.append(bm.verts.new(c + f * dz + sd * (math.cos(ang) * rr * 1.02) + b * (math.sin(ang) * rr * 0.94)))
        rings.append(ring)
    for j in range(nv):
        r0 = rings[j]
        r1 = rings[(j + 1) % nv]
        for i in range(nu):
            k = (i + 1) % nu
            bm.faces.new((r0[i], r0[k], r1[k], r1[i]))
    me = bpy.data.meshes.new("hi_band")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("hi_band", me)
    coll.objects.link(ob)
    return ob


def socket_high(coll):
    """The torn crater: a dense disc displaced by socket_height + broken block facets, cracks running into the wall."""
    bm = bmesh.new()
    nr, na = 150, 360
    grid = []
    for j in range(nr + 1):
        r = 0.050 + (0.232 - 0.050) * (j / nr) ** 1.15
        row = []
        for i in range(na):
            ang = 2 * math.pi * i / na
            y = -socket_height(r, ang, hi=True) if r > 0.06 else 0.02
            row.append(bm.verts.new(Vector((math.cos(ang) * r, y, math.sin(ang) * r))))
        grid.append(row)
    for j in range(nr):
        for i in range(na):
            k = (i + 1) % na
            bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][k], grid[j][k]))
    me = bpy.data.meshes.new("hi_socket")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("hi_socket", me)
    coll.objects.link(ob)
    P = mesh_np(ob)
    rr = np.sqrt(P[:, 0] ** 2 + P[:, 2] ** 2)
    ang = np.arctan2(P[:, 2], P[:, 0])
    # chisel facets: Voronoi cells flattened (stone breaks in planes), strongest on the rim
    rimw = np.exp(-((rr - 0.108) / 0.03) ** 2)
    ve = voronoi_edge(P * np.array([1, 0, 1]), 0.018, SEED + 61)
    facet = np.clip(ve / 0.006, 0, 1)
    dy = -0.006 * rimw * (facet ** 0.5 - 0.5)
    # cracks running out into the wall (radial)
    rad = np.abs(np.sin(ang * 6 + 1.7 * np.sin(rr * 60))) < 0.04 + 0.03 * (rr < 0.14)
    dy += 0.0012 * rad * (rr > 0.11)
    # surface grain
    dy += 0.0004 * fbm(P, 400.0, SEED + 62, 3)
    P[:, 1] += dy
    ob.data.vertices.foreach_set("co", P.ravel())
    ob.data.update()
    # colour: masonry (the game's ashlar, sRGB ~0.29 / 0.28 / 0.26), fresh broken stone lighter on the rim, the hole black,
    # wet streaks running down from the hole
    base = np.array([0.072, 0.066, 0.056])
    fresh = np.array([0.15, 0.14, 0.125])
    col = np.tile(base, (len(P), 1)) * (0.85 + 0.3 * fbm(P, 90.0, SEED + 63, 3))[:, None]
    h = -P[:, 1]
    fr = np.clip(rimw * (1 - facet) * 1.4, 0, 1) * (h > 0.01)
    col = col * (1 - fr[:, None]) + fresh * fr[:, None]
    hole = np.clip(1 - (rr - 0.07) / 0.03, 0, 1)
    col *= (1 - 0.92 * hole)[:, None]
    streak = (P[:, 2] < -0.06) * (np.abs(np.sin(P[:, 0] * 90 + 2)) < 0.25) * np.clip(1 - (rr - 0.1) / 0.12, 0, 1)
    col *= (1 - 0.45 * streak)[:, None]
    col *= (1 - 0.6 * rad * (rr > 0.11))[:, None]
    rough = np.clip(0.82 - 0.45 * hole - 0.4 * streak - 0.15 * fr, 0.2, 0.95)
    set_vcols(ob, col, rough, np.zeros(len(P)))
    return ob


def set_vcols(ob, col, rough, vein):
    me = ob.data
    n = len(me.vertices)
    for name in ("hb_col", "hb_orm"):
        if name in me.color_attributes:
            me.color_attributes.remove(me.color_attributes[name])
    ca = me.color_attributes.new("hb_col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", np.concatenate([col, np.ones((n, 1))], 1).astype(np.float32).ravel())
    co = me.color_attributes.new("hb_orm", "FLOAT_COLOR", "POINT")
    co.data.foreach_set("color", np.stack([np.ones(n), rough, vein, np.ones(n)], 1).astype(np.float32).ravel())


def build_high(coll):
    t0 = time.time()
    bm = bmesh.new()
    for f in FINGERS + ["thumb"]:
        finger_high(bm, f)
    palm_high(bm)
    # thenar and hypothenar
    tp, _, _ = CHAINS["thumb"]
    ax = (tp[1] - tp[0]).normalized()
    up = (HB - ax * HB.dot(ax)).normalized()
    sd = ax.cross(up).normalized()
    ellipsoid_high(bm, hpt(0.034, 0.019, -0.007), ax, sd, up, 0.030, 0.0175, 0.0125)
    ellipsoid_high(bm, hpt(0.046, -0.030, -0.007), HF, HS, HB, 0.034, 0.0115, 0.0098)
    forearm_high(bm)
    ob = to_object(bm, "hi_flesh", coll)
    log(f"high tubes: {len(ob.data.polygons) / 1000:.0f}k faces ({time.time() - t0:.1f}s)")
    # voxel union
    mod = ob.modifiers.new("vox", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = args.voxel
    mod.adaptivity = 0.0
    mod.use_smooth_shade = True
    activate(ob)
    bpy.ops.object.modifier_apply(modifier="vox")
    sm = ob.modifiers.new("smooth", "LAPLACIANSMOOTH")
    sm.iterations = 6
    sm.lambda_factor = 0.55
    sm.use_volume_preserve = True
    sm.use_normalized = True
    bpy.ops.object.modifier_apply(modifier="smooth")
    # the hand gets two subdivision levels (~0.23 mm: the sculpt layers), the forearm one (~0.45 mm); the two halves overlap 1 cm
    # at the cut (rays from the low hit one or the other: no seam). Keeps the bake under ~4 GB.
    fore = ob.copy()
    fore.data = ob.data.copy()
    fore.name = "hi_forearm"
    coll.objects.link(fore)
    ob.name = "hi_hand"
    cut = WRIST.y + 0.03
    for o, keep_hand in ((ob, True), (fore, False)):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        co = Vector((0, cut + (0.005 if keep_hand else -0.005), 0))
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=Vector((0, 1, 0)), clear_outer=keep_hand, clear_inner=not keep_hand)
        bm.to_mesh(o.data)
        bm.free()
        activate(o)
        sub = o.modifiers.new("sub", "SUBSURF")
        sub.levels = 2 if keep_hand else 1
        sub.render_levels = sub.levels
        bpy.ops.object.modifier_apply(modifier="sub")
    log(f"high union: hand {len(ob.data.polygons) / 1000:.0f}k + forearm {len(fore.data.polygons) / 1000:.0f}k faces ({time.time() - t0:.1f}s)")
    for o in (ob, fore):
        P = mesh_np(o)
        N = vnormals_np(o)
        disp, col, rough, vein = sculpt(P, N)
        P2 = P + N * disp[:, None]
        o.data.vertices.foreach_set("co", P2.ravel())
        o.data.update()
        set_vcols(o, col, rough, vein)
        for p in o.data.polygons:
            p.use_smooth = True
        del P, N, P2, disp, col, rough, vein
    log(f"high sculpt layers done ({time.time() - t0:.1f}s)")
    nails = nails_high(coll)
    for nb in nails:
        Pn = mesh_np(nb)
        nn = len(Pn)
        slate = np.array([0.030, 0.036, 0.043]) * (0.8 + 0.35 * fbm(Pn, 2500.0, SEED + 71, 2))[:, None]
        edge = np.clip(0.5 + 0.5 * fbm(Pn, 4000.0, SEED + 72, 2), 0, 1) > 0.72
        slate = slate * (1 - edge[:, None] * 0.0) + np.array([0.075, 0.078, 0.082]) * edge[:, None] * 0.6
        set_vcols(nb, np.clip(slate, 0, 1), np.full(nn, 0.38) + 0.2 * edge, np.zeros(nn))
    band = band_high(coll)
    Pb = mesh_np(band)
    mort = np.array([0.20, 0.19, 0.165]) * (0.75 + 0.4 * fbm(Pb, 3000.0, SEED + 81, 3))[:, None]
    lime = (fbm(Pb, 1200.0, SEED + 82, 2) > 0.35)[:, None] * 0.08
    set_vcols(band, np.clip(mort + lime, 0, 1), np.full(len(Pb), 0.9), np.zeros(len(Pb)))
    sock = socket_high(coll)
    return [ob, fore] + nails + [band], sock


# =====================================================================================================================
# LOW assembly, UVs, bake
# =====================================================================================================================
CLASSES = ["flesh", "socket"]


def join_low(parts, coll, name="Holdfast_LOD0"):
    bm = bmesh.new()
    cls_layer = bm.faces.layers.int.new("cls_id")
    uvw_layer = bm.faces.layers.float.new("uvw")
    weights = []
    for pt in parts:
        me = bpy.data.meshes.new("tmp")
        bmesh.ops.recalc_face_normals(pt.bm, faces=pt.bm.faces[:])
        weights += pt.w
        pt.bm.to_mesh(me)
        n0 = len(bm.faces)
        bm.from_mesh(me)
        for f in bm.faces[n0:]:
            f[cls_layer] = 1 if pt.cls == "socket" else 0
            f[uvw_layer] = pt.uvw
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    assert len(weights) == len(me.vertices)
    return ob, weights


def fix_socket_normals(ob):
    """The socket faces must look out of the wall (-Y): flip any that do not (recalc_face_normals guesses on an open sheet)."""
    me = ob.data
    cls = [0] * len(me.polygons)
    me.attributes["cls_id"].data.foreach_get("value", cls)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    layer = bm.faces.layers.int.get("cls_id")
    flip = [f for f in bm.faces if f[layer] == 1 and f.normal.y > 0.2]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(me)
    bm.free()


def uv_unwrap(ob):
    me = ob.data
    me.uv_layers.new(name="UVMap")
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    # texel weights per part: scale every island about its centre by sqrt(weight)
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    wl = bm.faces.layers.float.get("uvw")
    bm.faces.ensure_lookup_table()
    seen = set()
    for f in bm.faces:
        if f.index in seen:
            continue
        # flood the UV island
        isl = []
        stack = [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            isl.append(g)
            for e in g.edges:
                if e.seam:
                    continue
                for h in e.link_faces:
                    if h.index in seen:
                        continue
                    # connected in UV space?
                    shared = True
                    for v in e.verts:
                        u0 = [l[uvl].uv for l in g.loops if l.vert == v][0]
                        u1 = [l[uvl].uv for l in h.loops if l.vert == v][0]
                        if (u0 - u1).length > 1e-5:
                            shared = False
                    if shared:
                        seen.add(h.index)
                        stack.append(h)
        w = max(g[wl] for g in isl)
        k = math.sqrt(w)
        c = Vector((0, 0))
        nl = 0
        for g in isl:
            for l in g.loops:
                c += l[uvl].uv
                nl += 1
        c /= max(1, nl)
        for g in isl:
            for l in g.loops:
                l[uvl].uv = c + (l[uvl].uv - c) * k
    bm.to_mesh(me)
    bm.free()
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=0.004, shape_method="CONCAVE", scale=True)
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    area = 0.0
    uv = me.uv_layers.active.data
    for p in me.polygons:
        li = list(p.loop_indices)
        for kk in range(1, len(li) - 1):
            a, b2, c2 = uv[li[0]].uv, uv[li[kk]].uv, uv[li[kk + 1]].uv
            area += abs((b2 - a).cross(c2 - a)) / 2
    log(f"uv packed: {area * 100:.1f}% of the atlas used")


def _new_float_img(name, res):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    im = bpy.data.images.new(name, res, res, alpha=True, float_buffer=True)
    im.colorspace_settings.name = "Non-Color"
    im.generated_color = (0, 0, 0, 0)
    return im


def _img_np(im):
    a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)


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


HBM = {}


def high_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    emis = nt.nodes.new("ShaderNodeEmission")
    ac = nt.nodes.new("ShaderNodeVertexColor")
    ac.layer_name = "hb_col"
    ao = nt.nodes.new("ShaderNodeVertexColor")
    ao.layer_name = "hb_orm"
    nt.links.new(ac.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    HBM[name] = dict(mat=mat, out=out, bsdf=bsdf, emis=emis, col=ac.outputs["Color"], orm=ao.outputs["Color"])
    return mat


def set_pass(pname):
    for h in HBM.values():
        nt = h["mat"].node_tree
        for l in list(h["out"].inputs["Surface"].links):
            nt.links.remove(l)
        for l in list(h["emis"].inputs["Color"].links):
            nt.links.remove(l)
        if pname in ("NORMAL", "AO"):
            nt.links.new(h["bsdf"].outputs[0], h["out"].inputs["Surface"])
            continue
        nt.links.new(h["col"] if pname == "ALB" else h["orm"], h["emis"].inputs["Color"])
        h["emis"].inputs["Strength"].default_value = 1.0
        nt.links.new(h["emis"].outputs[0], h["out"].inputs["Surface"])


def bake_all(low, highs, sock, res):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = 0.012  # local contact occlusion
    scene.render.bake.use_selected_to_active = True
    low_mat = bpy.data.materials.new("LOWBAKE")
    low_mat.use_nodes = True
    ln = low_mat.node_tree.nodes
    imgnode = ln.new("ShaderNodeTexImage")
    ln.active = imgnode
    results = {}
    all_objs = list(scene.objects)
    groups = {0: highs, 1: [sock]}
    passes = [("NORMAL", "NORMAL", 4), ("AO", "AO", args.bake_samples), ("ALB", "EMIT", 8), ("ORM", "EMIT", 4)]
    cls_attr = low.data.attributes["cls_id"]
    for pname, btype, spp in passes:
        cpath = os.path.join(CACHE_DIR, f"bake_{pname}_{res}.npy")
        if os.path.exists(cpath):
            results[pname] = np.load(cpath)
            log("bake (cached)", pname)
            continue
        set_pass(pname)
        scene.cycles.samples = spp
        acc = np.zeros((res, res, 4), dtype=np.float32)
        cov = np.zeros((res, res), dtype=bool)
        for ci, hs in groups.items():
            img = _new_float_img(f"bk_{pname}_{ci}", res)
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
            keep = set(hs) | {tmp}
            if pname == "AO":
                keep |= set(highs) | {sock}
            for o in all_objs:
                o.hide_render = o not in keep
            for o in bpy.context.view_layer.objects:
                o.select_set(False)
            for h in hs:
                h.select_set(True)
            tmp.select_set(True)
            bpy.context.view_layer.objects.active = tmp
            cage = 0.006 if ci == 0 else 0.03
            kw = dict(type=btype, use_selected_to_active=True, cage_extrusion=cage, max_ray_distance=cage * 2.5, margin=0, use_clear=False, target="IMAGE_TEXTURES")
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
            log(f"bake {pname} [{ci}] {time.time() - t0:.1f}s px={int(m.sum())}")
        for o in all_objs:
            o.hide_render = False
        out = dilate(acc[..., :3], cov, 16)
        np.save(cpath, out)
        np.save(os.path.join(CACHE_DIR, f"bake_COV_{res}.npy"), cov)
        results[pname] = out
    results["COV"] = np.load(os.path.join(CACHE_DIR, f"bake_COV_{res}.npy"))
    set_pass("NORMAL")
    return results


def srgb_encode(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def composite(R, res):
    from PIL import Image
    ao = np.clip(R["AO"][..., 0], 0, 1)
    nrm = np.clip(R["NORMAL"], 0, 1)
    alb = np.clip(R["ALB"], 0, 1)
    orm = np.clip(R["ORM"], 0, 1)
    nx = nrm[..., 0] * 2 - 1
    ny = nrm[..., 1] * 2 - 1
    div = (np.roll(nx, -1, 1) - np.roll(nx, 1, 1)) + (np.roll(ny, -1, 0) - np.roll(ny, 1, 0))
    cav = np.clip(-div * 0.5 * (res / 2048.0), 0, 0.5)
    occ = np.clip(ao * (1 - 0.6 * cav), 0, 1)
    # the wet sheen sits in the cavities too (water pools): lower roughness where the cavity is, not on the crack floors
    rough = np.clip(orm[..., 1] * (1 - 0.15 * cav), 0.12, 1)
    alb_out = alb * (0.72 + 0.28 * occ[..., None])
    paths = {}
    outs = {
        "albedo": np.dstack([srgb_encode(alb_out)]),
        "normal": nrm,
        # R = AO, G = roughness, B = the vein mask (the view pulses it; metalness is forced to 0 at runtime)
        "orm": np.dstack([occ, rough, np.clip(orm[..., 2], 0, 1)]),
    }
    for k, arr in outs.items():
        im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
        im = im.transpose(Image.FLIP_TOP_BOTTOM)
        fp = os.path.join(CACHE_DIR, f"holdfast_{k}.png")
        im.save(fp)
        paths[k] = fp
    return paths


def gltf_settings_group():
    name = "glTF Material Output"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    g = bpy.data.node_groups.new(name, "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def game_material(paths, preview=False):
    mat = bpy.data.materials.new("HoldfastPreview" if preview else "HoldfastFlesh")
    mat.use_nodes = True
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
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "AO"
    if preview:
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(a.outputs["Color"], mul.inputs["A"])
        nt.links.new(vc.outputs["Color"], mul.inputs["B"])
        nt.links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
    else:
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
        try:
            bsdf.inputs["Coat Weight"].default_value = 0.25  # the wet film
            bsdf.inputs["Coat Roughness"].default_value = 0.12
        except KeyError:
            pass
        # subsurface: a little light under the stone-flesh
        try:
            bsdf.inputs["Subsurface Weight"].default_value = 0.08
            bsdf.inputs["Subsurface Radius"].default_value = (0.004, 0.0015, 0.001)
        except KeyError:
            pass
    else:
        nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])  # (the vein mask rides in B: the runtime zeroes metalness)
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = gltf_settings_group()
    nt.links.new(sep.outputs[0], grp.inputs["Occlusion"])
    return mat


# =====================================================================================================================
# ARMATURE, SKIN, VERTEX AO
# =====================================================================================================================
def build_armature(coll):
    arm = bpy.data.armatures.new("Holdfast_Armature")
    ob = bpy.data.objects.new("Holdfast_Armature", arm)
    coll.objects.link(ob)
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    for name, parent, head, tail, zax, conn in BONES:
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


def skin(low, weights, arm):
    for name in BONE_NAMES:
        low.vertex_groups.new(name=name)
    vgs = {vg.name: vg for vg in low.vertex_groups}
    for i, w in enumerate(weights):
        tot = sum(w.values())
        for bn, wt in w.items():
            vgs[bn].add([i], wt / tot, "REPLACE")
    low.parent = arm
    mod = low.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


def vertex_ao(low, extra_objs):
    """Per-vertex occlusion (COLOR_0 'AO'): hemisphere rays (3 cm) against the low itself and the socket, rest pose."""
    from mathutils.bvhtree import BVHTree
    deps = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(low, deps)
    me = low.data
    n = len(me.vertices)
    P = mesh_np(low)
    N = vnormals_np(low)
    dirs = []
    k = 0
    while len(dirs) < 24:
        u = hash01(k * 2 + 1)
        v = hash01(k * 2 + 2)
        k += 1
        z = u
        r = math.sqrt(max(0.0, 1 - z * z))
        ph = 2 * math.pi * v
        dirs.append((r * math.cos(ph), r * math.sin(ph), z))
    occ = np.zeros(n)
    for i in range(n):
        nn = Vector(N[i])
        t1 = nn.orthogonal().normalized()
        t2 = nn.cross(t1)
        o = Vector(P[i]) + nn * 0.0008
        hit = 0.0
        for (x, y, z) in dirs:
            d = (t1 * x + t2 * y + nn * z).normalized()
            loc, _, _, dist = tree.ray_cast(o, d, 0.03)
            if loc is not None:
                hit += 1.0 - dist / 0.03
        occ[i] = hit / len(dirs)
    ao = np.clip(1 - 0.85 * occ, 0.15, 1)
    # the socket's hole and floor: black; the forearm deep in the wall: dark
    cls = [0] * len(me.polygons)
    me.attributes["cls_id"].data.foreach_get("value", cls)
    rr = np.sqrt(P[:, 0] ** 2 + P[:, 2] ** 2)
    hole = np.clip(1 - (rr - 0.07) / 0.035, 0, 1) * (P[:, 1] > -0.012)
    sock_v = np.zeros(n, bool)
    for p in me.polygons:
        if cls[p.index] == 1:
            for vi in p.vertices:
                sock_v[vi] = True
    ao = np.where(sock_v, ao * (1 - 0.92 * hole), ao)
    deep = np.clip((P[:, 1] - 0.02) / 0.2, 0, 1) * (~sock_v)
    ao *= 1 - 0.6 * deep
    if "AO" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["AO"])
    ca = me.color_attributes.new("AO", "BYTE_COLOR", "POINT")
    ca.data.foreach_set("color", np.stack([ao, ao, ao, np.ones(n)], 1).astype(np.float32).ravel())
    me.color_attributes.active_color = ca
    return ao


# =====================================================================================================================
# CLIPS (authored in code): per finger curl per joint (deg, + = toward the palm), spread (deg, + = toward the thumb)
# =====================================================================================================================
FPS = 30
FIST = {"index": [72, 70, 64, 48], "middle": [74, 72, 66, 48], "ring": [72, 71, 65, 48], "pinky": [70, 70, 64, 48], "thumb": [12, 42, 46]}
OPEN = {"index": [-6, -16, 4, 8], "middle": [-6, -18, 4, 8], "ring": [-6, -16, 4, 8], "pinky": [-4, -14, 4, 8], "thumb": [-18, -8, 6]}
SPREAD_OPEN = {"index": 12, "middle": 3, "ring": -7, "pinky": -16, "thumb": 10}
WRAP = {"index": [38, 46, 50, 38], "middle": [36, 46, 52, 40], "ring": [36, 46, 52, 40], "pinky": [38, 48, 54, 42], "thumb": [24, 34, 38]}
DEAD = {"index": [-34, 82, -48, 22], "middle": [12, -66, 34, -24], "ring": [58, 8, -62, 88], "pinky": [22, 26, 18, 34], "thumb": [-46, -38, 28]}
DEAD_SPREAD = {"index": 6, "middle": -4, "ring": 10, "pinky": -38, "thumb": 24}
DEAD_TWIST = {"index": [0, 0, 28, 0], "middle": [0, -22, 0, 0], "ring": [0, 0, 0, -30], "pinky": [18, 0, 0, 0], "thumb": [0, 30, 0]}
RELAX = {"index": [16, 12, 10, 8], "middle": [14, 12, 10, 8], "ring": [16, 13, 11, 8], "pinky": [18, 14, 12, 9], "thumb": [6, 10, 10]}
DELAY = {"index": 0.0, "middle": 0.08, "ring": 0.16, "pinky": 0.24, "thumb": 0.34}
CHAIN_N = {"index": 4, "middle": 4, "ring": 4, "pinky": 4, "thumb": 3}


def mixp(a, b, t):
    return {f: [lerp(a[f][k], b[f][k], t) for k in range(CHAIN_N[f])] for f in a}


def addp(a, d):
    return {f: [a[f][k] + d.get(f, [0] * CHAIN_N[f])[k] for k in range(CHAIN_N[f])] for f in a}


def wave(t, amp, speed, phase_step):
    return {f: [amp * math.sin(2 * math.pi * (t * speed - i * phase_step - k * 0.08)) for k in range(CHAIN_N[f])] for i, f in enumerate(FINGERS + ["thumb"])}


def pose_dict(curl, spread=None, twist=None, extra=None):
    """Bone -> local quaternion (finger joints) from per-finger curl / spread / twist tables."""
    out = {}
    for f in FINGERS + ["thumb"]:
        for k in range(CHAIN_N[f]):
            q = Quaternion((1, 0, 0), -math.radians(curl[f][k]))  # local X = the flex axis; - = toward the palm
            if k == 0 and spread:
                q = Quaternion((0, 0, 1), math.radians(spread.get(f, 0.0))) @ q
            if twist:
                q = Quaternion((0, 1, 0), math.radians(twist[f][k])) @ q
            out[f"{f}_{k + 1}"] = (q, None)
    if extra:
        out.update(extra)
    return out


def ease(t):
    return t * t * (3 - 2 * t)


def clip_idle(t):  # loop 4.0 s
    tt = t * 4.0
    br = wave(t, 2.0, 1.0, 0.1)
    c = addp(FIST, br)
    # the twitch: the ring finger's extra knuckle jerks at 2.3 s, the index at 3.4 s
    tw = math.exp(-((tt - 2.3) / 0.05) ** 2) * 14 + math.exp(-((tt - 3.4) / 0.04) ** 2) * 9
    c["ring"][1] -= tw * 0.9
    c["index"][2] -= math.exp(-((tt - 3.4) / 0.04) ** 2) * 10
    fore = Vector((0, 0.0025 * math.sin(2 * math.pi * t), 0))  # breathing: in and out of the wall
    return pose_dict(c, extra={"forearm": (Quaternion(), Vector((0, -0.10, 0)) + fore)})


def clip_stir(t):  # loop 1.6 s
    loose = mixp(FIST, RELAX, 0.35)
    c = addp(loose, wave(t, 14.0, 1.0, 0.18))
    return pose_dict(c, spread={f: 4 * math.sin(2 * math.pi * (t - 0.2 * i)) for i, f in enumerate(FINGERS)}, extra={"forearm": (Quaternion(), Vector((0, -0.08, 0)))})


def clip_reach(t):  # param 0..1 over 1.0 s: the fist opens into a claw
    e = ease(t)
    c = mixp(FIST, OPEN, e)
    return pose_dict(c, spread={f: SPREAD_OPEN[f] * e for f in SPREAD_OPEN}, extra={"forearm": (Quaternion(), Vector((0, -0.08 + 0.10 * e, 0)))})


def clip_close(t):  # param 0..1: open -> wrapped, index first, the thumb last
    c = {}
    sp = {}
    for f in FINGERS + ["thumb"]:
        u = ease(clamp((t - DELAY[f]) / 0.62))
        c[f] = [lerp(OPEN[f][k], WRAP[f][k], u) for k in range(CHAIN_N[f])]
        sp[f] = SPREAD_OPEN[f] * (1 - u) + (-4 if f == "thumb" else 0) * u
    return pose_dict(c, spread=sp)


def clip_squeeze(t):  # additive pulse, 0.4 s
    k = math.sin(math.pi * clamp(t * 1.4)) ** 2
    c = {f: [k * (10 if f != "thumb" else 8) for _ in range(CHAIN_N[f])] for f in FINGERS + ["thumb"]}
    return pose_dict(c)


def clip_pull(t):  # loop 1.2 s: grinding round the held hand
    c = addp(WRAP, wave(t, 5.0, 1.0, 0.25))
    return pose_dict(c, spread={"thumb": -4})


def clip_release(t):  # 0.9 s: springs open, then trembles
    tt = t * 0.9
    e = ease(clamp(tt / 0.22))
    base = mixp(WRAP, OPEN, e)
    trem = {f: [(3.5 * (1 - t)) * math.sin(2 * math.pi * (14 * tt + 0.37 * i + 0.21 * k)) for k in range(CHAIN_N[f])] for i, f in enumerate(FINGERS + ["thumb"])}
    half = mixp(base, RELAX, sstep(0.4, 1.0, t) * 0.6)
    return pose_dict(addp(half, trem), spread={f: SPREAD_OPEN[f] * (1 - 0.5 * t) for f in SPREAD_OPEN})


def clip_retract(t):  # 1.2 s: back to the fist
    e = ease(t)
    c = mixp(RELAX, FIST, e)
    return pose_dict(c, extra={"forearm": (Quaternion(), Vector((0, -0.10 * e, 0)))})


def clip_dead(t):  # 0.8 s: the fingers break (held at the end)
    e = ease(clamp(t * 1.25))
    c = mixp(RELAX, DEAD, e)
    tw = {f: [DEAD_TWIST[f][k] * e for k in range(CHAIN_N[f])] for f in DEAD_TWIST}
    return pose_dict(c, spread={f: DEAD_SPREAD[f] * e for f in DEAD_SPREAD}, twist=tw)


def clip_answer(t):  # loop 2.4 s: open, palm up, the fingers curling a little and trembling
    tt = t * 2.4
    c = addp(RELAX, {f: [8 * (0.5 - 0.5 * math.cos(2 * math.pi * t)) + 1.5 * math.sin(2 * math.pi * (11 * tt + i * 0.3)) for k in range(CHAIN_N[f])] for i, f in enumerate(FINGERS + ["thumb"])})
    return pose_dict(c, spread={f: 0.6 * SPREAD_OPEN[f] for f in SPREAD_OPEN})


CLIPS = [
    # name, seconds, loop, fn, kind (for the runtime table)
    ("idle", 4.0, True, clip_idle, "loop"),
    ("stir", 1.6, True, clip_stir, "loop"),
    ("reach", 1.0, False, clip_reach, "param"),
    ("close", 1.0, False, clip_close, "param"),
    ("squeeze", 0.4, False, clip_squeeze, "additive"),
    ("pull", 1.2, True, clip_pull, "loop"),
    ("release", 0.9, False, clip_release, "once"),
    ("retract", 1.2, False, clip_retract, "once"),
    ("dead", 0.8, False, clip_dead, "once"),
    ("answer", 2.4, True, clip_answer, "loop"),
]


def apply_pose(arm_ob, d):
    for pb in arm_ob.pose.bones:
        pr = d.get(pb.name)
        if pr is None:
            pb.rotation_quaternion = Quaternion()
            pb.location = (0, 0, 0)
        else:
            pb.rotation_quaternion = pr[0]
            pb.location = pr[1] if pr[1] is not None else Vector((0, 0, 0))


def make_clip_actions(arm_ob):
    ad = arm_ob.animation_data_create()
    sc = bpy.context.scene
    sc.render.fps = FPS
    acts = []
    for name, secs, loop, fn, kind in CLIPS:
        n = max(2, int(round(secs * FPS)))
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad.action = act
        for f in range(n + 1):
            t = f / n
            apply_pose(arm_ob, fn(t))
            for pb in arm_ob.pose.bones:
                if pb.name == "socket":
                    continue
                pb.keyframe_insert("rotation_quaternion", frame=f)
                if pb.name == "forearm":
                    pb.keyframe_insert("location", frame=f)
        tr = ad.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, 0, act)
        st.name = act.name
        tr.mute = True
        acts.append(act)
        ad.action = None
    apply_pose(arm_ob, {})
    return acts


# =====================================================================================================================
# PREVIEW IK (the same idea as render/holdfastView.js): the palm on a target, the forearm through the socket's mouth
# =====================================================================================================================
def ik_pose(arm_ob, target, fingers_dir=Vector((0, 0, 1)), palm_normal=Vector((0, -1, 0)), hand_off=0.062):
    """Blender frame: target = where the palm's centre goes; the hand's fingers along fingers_dir, the palm facing palm_normal."""
    F1 = fingers_dir.normalized()
    N1 = (palm_normal - F1 * palm_normal.dot(F1)).normalized()
    S1 = F1.cross(N1)
    # rest hand frame: fingers HF, palm normal -HB (down), thumb HS
    F0, N0 = HF, -HB
    S0 = F0.cross(N0)
    M0 = Matrix((F0, N0, S0)).transposed()
    M1 = Matrix((F1, N1, S1)).transposed()
    R = M1 @ M0.inverted()
    wrist = target - R @ (HF * hand_off)
    A = wrist.normalized() if wrist.length > 1e-4 else Vector((0, -1, 0))
    L = (ELBOW - WRIST).length
    elbow = wrist - A * L
    # forearm: rest axis -Y (elbow -> wrist), rest side +X
    Sf = (S1 - A * S1.dot(A)).normalized()
    Bf = A.cross(Sf)
    Mf0 = Matrix((Vector((0, -1, 0)), Vector((1, 0, 0)), Vector((0, -1, 0)).cross(Vector((1, 0, 0))))).transposed()
    Mf1 = Matrix((A, Sf, A.cross(Sf))).transposed()
    Rf = Mf1 @ Mf0.inverted()
    pbF = arm_ob.pose.bones["forearm"]
    pbH = arm_ob.pose.bones["hand"]
    bF = pbF.bone
    bH = pbH.bone
    # pose = rest-relative: local rotation = Rb^-1 * Rworld * Rb (rest bone frame Rb)
    RbF = bF.matrix_local.to_3x3()
    pbF.rotation_quaternion = (RbF.inverted() @ Rf @ RbF).to_quaternion()
    pbF.location = RbF.inverted() @ (elbow - ELBOW)
    # the hand: world = Rf (inherited) then the extra Rf^-1 R
    RbH = bH.matrix_local.to_3x3()
    Rh = Rf.inverted() @ R
    pbH.rotation_quaternion = (RbH.inverted() @ Rh @ RbH).to_quaternion()
    bpy.context.view_layer.update()


# =====================================================================================================================
# LOD1, the dormant static copy, export
# =====================================================================================================================
def make_lod1(low, coll, target=620):
    me = low.data.copy()
    ob = bpy.data.objects.new("Holdfast_LOD1", me)
    coll.objects.link(ob)
    ob.parent = low.parent
    for vg in low.vertex_groups:
        ob.vertex_groups.new(name=vg.name)
    # copy the weights
    vgi = {vg.index: vg.name for vg in low.vertex_groups}
    for v in low.data.vertices:
        for g in v.groups:
            ob.vertex_groups[vgi[g.group]].add([v.index], g.weight, "REPLACE")
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    dec = ob.modifiers.new("dec", "DECIMATE")
    dec.ratio = target / tris
    dec.use_collapse_triangulate = True
    activate(ob)
    bpy.ops.object.modifier_apply(modifier="dec")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = low.parent
    for mat in low.data.materials:
        if mat.name not in [m.name for m in ob.data.materials]:
            ob.data.materials.append(mat)
    return ob


def make_dormant(low, arm, coll):
    """The fist in its socket as a static mesh (the far, instanced look): LOD0 posed by the idle clip at t = 0."""
    apply_pose(arm, clip_idle(0.0))
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = low.evaluated_get(deps)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=deps)
    ob = bpy.data.objects.new("Holdfast_Dormant", me)
    coll.objects.link(ob)
    ob.vertex_groups.clear()
    apply_pose(arm, {})
    bpy.context.view_layer.update()
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export_glb(arm, objs, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    arm.select_set(True)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    common = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_texcoords=True,
                  export_normals=True, export_tangents=False, export_materials="EXPORT", export_skins=True, export_animations=True,
                  export_animation_mode="ACTIONS", export_force_sampling=True, export_def_bones=False, export_rest_position_armature=True,
                  export_morph=False, export_extras=True, export_cameras=False, export_lights=False)
    try:
        common["export_vertex_color"] = "ACTIVE"
    except Exception:
        pass
    for fmt, extra in (("AUTO", {}),):
        try:
            bpy.ops.export_scene.gltf(export_image_format=fmt, **extra, **common)
            break
        except TypeError:
            common.pop("export_vertex_color", None)
            bpy.ops.export_scene.gltf(export_image_format=fmt, **extra, **common)
            break
        except Exception as e:  # noqa: BLE001
            log("export with", fmt, "failed:", e)
    log("exported", path, f"{os.path.getsize(path) / 1e6:.2f} MB")


# =====================================================================================================================
# PREVIEWS (Cycles, the game mesh + the baked atlas): a contact sheet
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


def look_cam(name, loc, target, lens=35):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.01
    ob = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = (Vector(target) - Vector(loc)).normalized()
    ob.rotation_euler = d.to_track_quat("-Z", "Z").to_euler()
    return ob


def wall_plane(scene):
    """A masonry wall (the game's ashlar set, if it is there) in the plane y = 0, facing -Y."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.9)
    me = bpy.data.meshes.new("Wall")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Wall", me)
    scene.collection.objects.link(ob)
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.location = (0, 0.0006, 0)
    me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        me.uv_layers.active.data[loop.index].uv = ((co.x + 0.9) / 1.8 * 0.45, (co.y + 0.9) / 1.8 * 0.45)
    mat = bpy.data.materials.new("WallMat")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    alb = os.path.join(TEX_DIR, "masonry_albedo.jpg")
    nrm = os.path.join(TEX_DIR, "masonry_normal.jpg")
    if os.path.exists(alb):
        ta = nt.nodes.new("ShaderNodeTexImage")
        ta.image = bpy.data.images.load(alb, check_existing=True)
        nt.links.new(ta.outputs["Color"], bsdf.inputs["Base Color"])
    if os.path.exists(nrm):
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = bpy.data.images.load(nrm, check_existing=True)
        tn.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.75
    me.materials.append(mat)
    # chalk studs around the patch (like render/climbView.js) so the knuckles read as the wrong ones
    studs = []
    for (sx, sz) in ((-0.42, 0.38), (0.4, 0.42), (-0.38, -0.44), (0.44, -0.4), (0.02, 0.62), (0.0, -0.66)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(sx, -0.035, sz))
        st = bpy.context.active_object
        st.scale = (0.2 * 0.5, 0.07 * 0.5, 0.12 * 0.5) if False else (0.10, 0.035, 0.06)
        st.rotation_euler = (0, (hash01(int(sx * 100 + sz * 1000) & 0xFFFF) - 0.5) * 0.4, 0)
        cm = bpy.data.materials.new("Chalk")
        cm.use_nodes = True
        cb = cm.node_tree.nodes.get("Principled BSDF")
        cb.inputs["Base Color"].default_value = (0.69, 0.66, 0.51, 1)
        cb.inputs["Roughness"].default_value = 0.92
        st.data.materials.append(cm)
        studs.append(st)
    return ob, studs


def gauntlet_proxy(scene, at, fwd, up):
    """A stand-in for the player's gloved fist (leather glove + brass cuff) at `at`, the knuckles along fwd."""
    objs = []
    side = fwd.cross(up).normalized()
    M = Matrix((side, fwd, up)).transposed().to_4x4()
    M.translation = at
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1)
    g = bpy.context.active_object
    g.matrix_world = M @ Matrix.Diagonal((0.046, 0.042, 0.030, 1))
    mat = bpy.data.materials.new("Glove")
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (0.055, 0.035, 0.022, 1)
    b.inputs["Roughness"].default_value = 0.55
    g.data.materials.append(mat)
    objs.append(g)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=1, depth=1)
    c = bpy.context.active_object
    M2 = M.copy()
    M2.translation = at - fwd * 0.075 + up * 0.002
    c.matrix_world = M2 @ Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Diagonal((0.036, 0.030, 0.07, 1))
    m2 = bpy.data.materials.new("Cuff")
    m2.use_nodes = True
    b2 = m2.node_tree.nodes.get("Principled BSDF")
    b2.inputs["Base Color"].default_value = (0.32, 0.20, 0.07, 1)
    b2.inputs["Metallic"].default_value = 0.85
    b2.inputs["Roughness"].default_value = 0.4
    c.data.materials.append(m2)
    objs.append(c)
    return objs


def render_sheet(scene, arm, low, paths, sock_low=None):
    from PIL import Image, ImageDraw
    T = args.tile
    setup_cycles(scene, args.samples, T, T)
    world = bpy.data.worlds.new("RenderWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.004, 0.005, 0.007, 1)
    bg.inputs[1].default_value = 1.0
    prev = game_material(paths, preview=True)
    low.data.materials.clear()
    low.data.materials.append(prev)
    wall, studs = wall_plane(scene)
    lantern = add_light("Lantern", "POINT", (-0.28, -0.55, 0.22), 9.0, (1.0, 0.70, 0.38), 0.03)
    fill = add_light("Fill", "AREA", (0.6, -0.4, -0.3), 1.2, (0.55, 0.65, 0.85), 0.8)
    rim = add_light("Rim", "POINT", (0.25, -0.08, 0.45), 1.6, (0.6, 0.75, 1.0), 0.05)
    tiles = []
    want = set(s for s in args.only.split(",") if s)

    def shot(name, cam, label, setup, wall_on=True, lights=(1.0, 1.0, 1.0)):
        if want and name not in want:
            return
        apply_pose(arm, {})
        extra = setup() or []
        wall.hide_render = not wall_on
        for s in studs:
            s.hide_render = not wall_on
        lantern.data.energy = 9.0 * lights[0]
        fill.data.energy = 1.2 * lights[1]
        rim.data.energy = 1.6 * lights[2]
        scene.camera = cam
        fp = os.path.join(RENDER_DIR, f"holdfast_{name}.png")
        scene.render.filepath = fp
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        log(f"render {name} {time.time() - t0:.1f}s")
        tiles.append((fp, label))
        for o in extra:
            bpy.data.objects.remove(o, do_unlink=True)

    front = look_cam("CamFront", (0.10, -0.62, 0.06), (0.0, -0.02, 0.0), 38)
    close = look_cam("CamClose", (0.16, -0.36, 0.13), (0.0, -0.05, 0.04), 40)
    side = look_cam("CamSide", (0.42, -0.30, 0.10), (0.0, -0.08, 0.05), 40)

    def dormant():
        apply_pose(arm, clip_idle(0.0))
    shot("dormant", front, "DORMANT: the studs are knuckles", dormant)

    def stir():
        d = clip_stir(0.3)
        d["forearm"] = (Quaternion(), Vector((0, -0.06, 0)))
        apply_pose(arm, d)
    shot("aware", close, "AWARE: a wet breath, the fingers stir", stir)

    def reach():
        apply_pose(arm, clip_reach(0.85))
        ik_pose(arm, Vector((0.02, -0.11, 0.10)), fingers_dir=Vector((0, -0.25, 1)), palm_normal=Vector((0, -1, 0.2)))
    shot("reach", side, "REACH: it opens toward your hand", reach)

    def closed():
        tgt = Vector((0.015, -0.085, 0.13))
        objs = gauntlet_proxy(scene, tgt + Vector((0, -0.028, 0)), Vector((0, 0, 1)), Vector((0, -1, 0)))
        apply_pose(arm, clip_close(1.0))
        ik_pose(arm, tgt + Vector((0, 0.012, -0.004)), fingers_dir=Vector((0, 0, 1)), palm_normal=Vector((0, -1, 0)))
        return objs
    shot("closed", close, "CLOSE: it holds your gauntlet", closed)

    def ruined():
        apply_pose(arm, clip_dead(1.0))
        ik_pose(arm, Vector((0.01, -0.16, -0.17)), fingers_dir=Vector((0.1, -0.35, -1)), palm_normal=Vector((0, 0.6, -0.4)))
    shot("ruined", front, "RUINED: torn out, the fingers broken", ruined)

    def answer():
        apply_pose(arm, clip_answer(0.25))
        ik_pose(arm, Vector((0.0, -0.20, 0.03)), fingers_dir=Vector((0, -1, 0.15)), palm_normal=Vector((0, 0, 1)))
    shot("answer", side, "ANSWER (S4): knock, and a hand answers", answer)
    # the hand alone (no wall): back, palm, the knuckles close
    cam_back = look_cam("CamBack", (0.05, -0.25, 0.30), (0.0, -0.17, 0.0), 40)
    cam_palm = look_cam("CamPalm", (-0.06, -0.26, -0.28), (0.0, -0.17, 0.0), 40)
    cam_macro = look_cam("CamMacro", (0.07, -0.30, 0.11), (0.005, -0.215, 0.012), 70)

    def bare():
        apply_pose(arm, clip_reach(0.6))
    shot("back", cam_back, "the back: rope tendons, the wrist split, mortar band", bare, wall_on=False, lights=(1.4, 1.2, 1.0))
    shot("palm", cam_palm, "the palm: four knuckles a finger", bare, wall_on=False, lights=(1.4, 1.6, 1.0))
    shot("macro", cam_macro, "slate nails, the extra knuckle", bare, wall_on=False, lights=(1.6, 1.0, 1.4))
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
    out = os.path.join(RENDER_DIR, "holdfast_sheet.png")
    sheet.save(out)
    log("sheet", out)


def clay_shape(scene, objs, name):
    """Stage 'shape': quick clay renders of a set of objects (geometry check)."""
    T = args.tile
    setup_cycles(scene, 24, T, T)
    world = bpy.data.worlds.new("ClayWorld")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.035, 1)
    mat = bpy.data.materials.new("Clay")
    mat.use_nodes = True
    mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.5, 0.42, 0.40, 1)
    mat.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = 0.45
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
    add_light("K", "AREA", (-0.3, -0.5, 0.5), 30, (1, 0.95, 0.9), 0.4)
    add_light("F", "AREA", (0.5, -0.3, -0.2), 8, (0.8, 0.85, 1.0), 0.6)
    outs = []
    for cn, loc, tgt, lens in (("top", (0.02, -0.20, 0.36), (0, -0.16, 0), 40), ("side", (0.36, -0.22, 0.06), (0, -0.15, 0), 40), ("palm", (-0.05, -0.22, -0.32), (0, -0.16, 0), 40), ("macro", (0.07, -0.30, 0.11), (0.005, -0.215, 0.012), 70)):
        cam = look_cam("C" + cn, loc, tgt, lens)
        scene.camera = cam
        fp = os.path.join(RENDER_DIR, f"holdfast_shape_{name}_{cn}.png")
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        outs.append(fp)
    log("clay", name, outs)


# =====================================================================================================================
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    work = bpy.data.collections.new("Work")
    sc.collection.children.link(work)
    lo_parts = build_low()
    low, weights = join_low(lo_parts, work)
    fix_socket_normals(low)
    log("LOW parts:", ", ".join(f"{p.name}={sum(len(f.verts) - 2 for f in p.bm.faces)}" for p in lo_parts))
    log("LOW tris", tri_count(low))
    if args.stage == "lowshape":
        clay_shape(sc, [low], "low")
        return
    highs, sock = build_high(work)
    hi_tris = sum(tri_count(o) for o in highs + [sock])
    log(f"HIGH {hi_tris / 1e6:.2f} M tris")
    if args.stage == "shape":
        low.hide_render = True
        sock.hide_render = True
        clay_shape(sc, highs, "high")
        low.hide_render = False
        for o in highs:
            o.hide_render = True
        clay_shape(sc, [low], "low")
        return
    for o in highs:
        o.data.materials.clear()
        o.data.materials.append(high_material(o.name))
    sock.data.materials.append(high_material("hi_socket"))
    for p in low.data.polygons:
        p.use_smooth = True
    uv_unwrap(low)
    R = bake_all(low, highs, sock, args.bake)
    paths = composite(R, args.bake)
    log("composited", paths)
    if args.stage == "bake":
        return
    mat = game_material(paths)
    low.data.materials.append(mat)
    arm = build_armature(work)
    skin(low, weights, arm)
    vertex_ao(low, [])
    make_clip_actions(arm)
    lod1 = make_lod1(low, work)
    dormant = make_dormant(low, arm, work)
    dormant.data.materials.clear()
    dormant.data.materials.append(mat)
    for o in highs + [sock]:
        o.hide_render = True
        o.hide_viewport = True
    report = {
        "lod0_tris": tri_count(low),
        "lod1_tris": tri_count(lod1),
        "dormant_tris": tri_count(dormant),
        "high_tris": hi_tris,
        "bones": len(BONE_NAMES),
        "clips": [[c[0], c[1], c[4]] for c in CLIPS],
        "atlas": args.bake,
    }
    # the clip table for the runtime (kinds, durations), in the GLB root extras via the armature's custom property
    arm["holdfast"] = json.dumps({"clips": {c[0]: {"dur": c[1], "kind": c[4]} for c in CLIPS}, "bones": BONE_NAMES, "version": 1})
    glb = os.path.join(args.out, "holdfast.glb")
    export_glb(arm, [low, lod1, dormant], glb)
    report["glb_raw_mb"] = round(os.path.getsize(glb) / 1e6, 3)
    with open(os.path.join(RENDER_DIR, "holdfast_report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    log("report", report)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    if args.render:
        lod1.hide_render = True
        dormant.hide_render = True
        render_sheet(sc, arm, low, paths)
    log("done")


main()
