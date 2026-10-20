"""THE MASON RIG: pure numpy core (no bpy): kit reader, rest-pose assembly, bone table, skin weights.

Everything here works in glTF space (+Y up = dorsal, the head faces -Z, +X right). build_mason_rig.py converts to Blender
space (x, -z, y) when it builds the scene. Imported by build_mason_rig.py (Blender) and by tests (plain python + numpy).
"""
import json
import math
import struct

import numpy as np

NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5120: np.int8, 5122: np.int16}

# ---- rig constants (kept in sync with src/render/masonRigView.js through the glTF extras) ----------------------------
P0 = 1.24                     # rest pitch between vertebra bones (kit units); the sim's link is 1.5 m x taper
NVERT = 18                    # vertebra bones spine_00..spine_17 (sim points 1..18); spine_17 owns the tail module
SIM_POINTS = 20               # sim points: 0 crown, 1..18 vertebrae, 19 tail
# sim LIMBS table (creature3d.js): [spine point, side (+1 right / -1 left)]
LEAD_LEGS = [(2, 1), (3, -1), (4, 1), (6, -1), (7, 1), (9, -1), (10, 1), (12, -1), (14, 1), (15, -1)]
MAT_NAMES = ["MasonCrown", "MasonBody", "MasonEmissive"]


def hash1(n):
    x = (int(n) ^ 0x9E3779B9) & 0xFFFFFFFF
    x = (x * 0x85EBCA6B) & 0xFFFFFFFF
    x ^= x >> 13
    x = (x * 0xC2B2AE35) & 0xFFFFFFFF
    x ^= x >> 16
    return (x & 0xFFFFFFFF) / 4294967296.0


# ---- GLB reader --------------------------------------------------------------------------------------------------------
def read_glb(fn):
    b = open(fn, "rb").read()
    off, js, bn = 12, None, b""
    while off < len(b):
        ln, ty = struct.unpack_from("<II", b, off)
        d = b[off + 8: off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(d)
        elif ty == 0x004E4942:
            bn = d
        off += 8 + ln
    return js, bn


def read_acc(js, bn, i, raw=False):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    nc = NC[a["type"]]
    dt = np.dtype(CT[a["componentType"]])
    n = a["count"]
    stride = bv.get("byteStride") or nc * dt.itemsize
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    arr = np.ndarray((n, nc), dt, bn, base, (stride, dt.itemsize)).copy()
    if a.get("normalized") and not raw:
        arr = arr.astype(np.float32) / float(np.iinfo(dt).max)
    return arr


def load_kit(path):
    """Modules of the kit: {name: {'lod0': mod, 'lod1': mod}}; mod = {prims, owners, pivot}. glTF space."""
    js, bn = read_glb(path)
    mats = [m["name"] for m in js["materials"]]
    out = {}
    for n in js["nodes"]:
        nm = n.get("name", "")
        if "mesh" not in n or not nm.startswith("Mason_"):
            continue
        lod = 1 if nm.endswith("_LOD1") else 0
        key = nm[len("Mason_"):]
        if lod:
            key = key[: -len("_LOD1")]
        ex = n.get("extras", {})
        rm = json.loads(ex["rig_module"]) if isinstance(ex.get("rig_module"), str) else ex.get("rig_module", {})
        owners = {int(k): v for k, v in rm.get("owners", {}).items()}
        prims = []
        for p in js["meshes"][n["mesh"]]["primitives"]:
            at = p["attributes"]
            d = dict(
                P=read_acc(js, bn, at["POSITION"]).astype(np.float64),
                N=read_acc(js, bn, at["NORMAL"]).astype(np.float64),
                UV=read_acc(js, bn, at["TEXCOORD_0"]).astype(np.float64),
                I=read_acc(js, bn, p["indices"]).reshape(-1, 3).astype(np.int64),
                mat=mats[p["material"]],
                owner=read_acc(js, bn, at["_OWNER"], raw=True).astype(np.int64),
                mask=read_acc(js, bn, at["_MASK"]).astype(np.float64),
                sspine=read_acc(js, bn, at["_SPINE_S"])[:, 0].astype(np.float64),
            )
            prims.append(d)
        out.setdefault(key, {})["lod%d" % lod] = dict(prims=prims, owners=owners)
    return out, js, bn


def _smooth_inv(w):
    """Inverse of smoothstep(t) = 3t^2 - 2t^3 on [0,1]."""
    lo, hi = 0.0, 1.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if 3 * mid * mid - 2 * mid ** 3 < w:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def vertebra_pitch(mod):
    """Rest pitch L of a vertebra module: flesh weights are smoothstep(0, L, s) toward the next bone."""
    ests = []
    for pr in mod["prims"]:
        o = pr["owner"]
        bl = (o[:, 1] != 255) & (o[:, 2] > 20) & (o[:, 2] < 240)
        if bl.any():
            s = pr["sspine"][bl]
            w = o[bl, 2] / 255.0
            t = np.array([_smooth_inv(x) for x in w[:400]])
            ests.extend((s[:400] / np.maximum(t, 1e-3)).tolist())
    return float(np.median(ests)) if ests else P0


# ---- transforms ----------------------------------------------------------------------------------------------------------
def T(x=0.0, y=0.0, z=0.0):
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def S(sx, sy=None, sz=None):
    sy = sx if sy is None else sy
    sz = sx if sz is None else sz
    return np.diag([sx, sy, sz, 1.0])


MIRROR_X = np.diag([-1.0, 1.0, 1.0, 1.0])


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def node_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"]).reshape(4, 4).T
    M = np.eye(4)
    M[:3, :3] = quat_to_mat(n.get("rotation", [0, 0, 0, 1])) @ np.diag(n.get("scale", [1, 1, 1]))
    M[:3, 3] = n.get("translation", [0, 0, 0])
    return M


def hero_leg_template(hero_path):
    """Relative transforms (vertebra frame -> Upper/Lower/Hook modules) of the hero's leg 12 (a left leg on the template
    vertebra Mason_Segment_0_v06, scale 1). Returns dict(U, L, H) of 4x4 in the vertebra's glTF module frame."""
    js, _ = read_glb(hero_path)
    names = [n.get("name", "") for n in js["nodes"]]
    parent = {}
    for i, n in enumerate(js["nodes"]):
        for c in n.get("children", []):
            parent[c] = i

    def world(i):
        M = node_matrix(js["nodes"][i])
        while i in parent:
            i = parent[i]
            M = node_matrix(js["nodes"][i]) @ M
        return M

    def find(nm):
        return world(names.index(nm))

    V = find("Mason_Segment_0_v06")
    Vi = np.linalg.inv(V)
    return dict(U=Vi @ find("Mason_LimbUpper_leg12"), L=Vi @ find("Mason_LimbLower_leg12"), H=Vi @ find("Mason_Hook_leg12"))


# ---- bones -----------------------------------------------------------------------------------------------------------------
class Rig:
    """Bone table: name, parent, rest head (glTF space), length hint, extras."""

    def __init__(self):
        self.names = []
        self.parent = []
        self.head = []
        self.length = []
        self.extra = []
        self.index = {}

    def add(self, name, parent, head, length=0.4, **extra):
        assert name not in self.index, name
        self.index[name] = len(self.names)
        self.names.append(name)
        self.parent.append(parent)
        self.head.append(np.asarray(head, float))
        self.length.append(length)
        self.extra.append(extra)
        return name

    def __len__(self):
        return len(self.names)


def bone_name_leg(side, point, j):
    return "leg_%s%02d_%d" % ("R" if side > 0 else "L", point, j)


def head_geometry(kit):
    """Pivots and axes of the crown parts, from the head module's ownership (glTF space)."""
    mod = kit["Head"]["lod0"]
    inv = {v: k for k, v in mod["owners"].items()}
    P = np.concatenate([p["P"] for p in mod["prims"]])
    O = np.concatenate([p["owner"][:, 0] for p in mod["prims"]])
    N = np.concatenate([p["N"] for p in mod["prims"]])

    def pts(name):
        return P[O == inv[name]]

    info = {}
    for nm in inv:
        if nm == "crown":
            continue
        Q = pts(nm)
        info[nm] = dict(c=Q.mean(0), lo=Q.min(0), hi=Q.max(0), n=len(Q))
    # arms: root = the end farthest from the hand, wrist = the end next to the hand (principal axis of the sleeve)
    arms = {}
    for n in range(5):
        a, b = pts("arm_%d_0" % n), pts("arm_%d_1" % n)
        ca, cb = a.mean(0), b.mean(0)
        v = cb - ca
        v /= np.linalg.norm(v) + 1e-9
        t = (a - ca) @ v
        root, wrist = ca + v * t.min(), ca + v * t.max()
        arms[n] = dict(root=root, wrist=wrist, tip=b[np.argmax((b - ca) @ v)], axis=v)
    info["arms"] = arms
    # pits: centroid + facing (away from the crown axis, toward the front)
    pits = {}
    for j in range(7):
        c = pts("pit_%d" % j).mean(0)
        d = np.array([c[0], c[1] * 0.35, -1.0])  # toward the front (-Z) and a little outward
        pits[j] = dict(c=c, dir=d / np.linalg.norm(d))
    info["pits"] = pits
    return info


def build_rig(kit, tpl, followers="all"):
    """Returns (rig, layout). layout lists the instances of the rest pose (vertebrae, legs)."""
    rig = Rig()
    rig.add("root", None, (0, 0, 0), 0.5)
    rig.add("neck", "root", (0, 0, 0), 0.8)
    # spine: neck = sim point 0, spine_00..17 = points 1..18, tail_0 = 19, tail_1 = extension
    for k in range(NVERT):
        rig.add("spine_%02d" % k, "root", (0, 0, (k + 1) * P0), 0.9 * P0, point=k + 1)
    rig.add("tail_0", "root", (0, 0, (NVERT + 1) * P0), 0.9 * P0, point=NVERT + 1)
    rig.add("tail_1", "tail_0", (0, 0, (NVERT + 1.9) * P0), 0.9 * P0)
    # crown subtree
    H = head_geometry(kit)
    rig.add("crown", "neck", (0, 0, 0), 1.0)
    for j in range(3):
        a = H["portal_arch_%d" % j]
        rig.add("portal_arch_%d" % j, "crown", (0, a["c"][1], a["c"][2]), 0.6, order=j)
    for nm in ("portal_comb_L0", "portal_comb_L1", "portal_comb_R0", "portal_comb_R1"):
        rig.add(nm, "crown", H[nm]["c"], 0.5, axis="retract")
    for j in range(2):
        h = H["portal_hinge_%d" % j]
        # pivot on the top edge of the dropped slab (rotation about X), at the slab's x centre
        rig.add("portal_hinge_%d" % j, "crown", (h["c"][0] if j else 0.0, h["c"][1], h["hi"][2] * 0.0 + h["c"][2] + 0.0), 0.6)
    for j in range(3):
        g = H["gullet_%d" % j]
        rig.add("gullet_%d" % j, "crown", (0, g["c"][1], g["c"][2]), 0.5, depth=j)
    for j in range(7):
        rig.add("pit_%d" % j, "crown", H["pits"][j]["c"], 0.3, dir=[float(x) for x in H["pits"][j]["dir"]])
    for n in range(5):
        A = H["arms"][n]
        rig.add("arm_%d_0" % n, "crown", A["root"], 0.5, phase=n)
        rig.add("arm_%d_1" % n, "arm_%d_0" % n, A["wrist"], 0.3, phase=n)
    # legs
    layout = dict(vert=[], legs=[], tail=None)
    Ru, Rl, Rh = tpl["U"], tpl["L"], tpl["H"]
    hip = Ru[:3, 3]
    knee = Rl[:3, 3]
    ankle = (Rl @ np.array([0, 2.065, 0, 1.0]))[:3]
    toe = Rh[:3, 3]
    tip = (Rh @ np.array([0, 0.94, 0, 1.0]))[:3]
    chain = dict(hip=hip, knee=knee, ankle=ankle, toe=toe, tip=tip)
    lead = {(p, s): i for i, (p, s) in enumerate(LEAD_LEGS)}
    for point in range(1, NVERT + 1):
        zc = point * P0
        parent_bone = "spine_%02d" % (point - 1)
        for side in (-1, 1):
            is_lead = (point, side) in lead
            if is_lead:
                kind = "lead"
            else:
                kind = "follow"
            sx = -1.0 if side > 0 else 1.0  # template is a left leg (x < 0); right legs mirror x
            M = T(0, 0, zc) @ (MIRROR_X if side > 0 else np.eye(4))
            nm = [bone_name_leg(side, point, j) for j in range(4 if is_lead else 3)]
            pts_ = [M @ np.append(chain[k], 1.0) for k in ("hip", "knee", "toe") ] if not is_lead else [M @ np.append(chain[k], 1.0) for k in ("hip", "knee", "ankle", "toe")]
            pts_ = [p[:3] for p in pts_]
            par = parent_bone
            for j, b in enumerate(nm):
                ex = dict(kind=kind, side=side, point=point, j=j)
                if is_lead:
                    ex["simLimb"] = lead[(point, side)]
                rig.add(b, par, pts_[j], 0.5, **ex)
                par = b
            layout["legs"].append(dict(point=point, side=side, kind=kind, bones=nm, M=M, simLimb=lead.get((point, side), -1)))
    layout["chain"] = chain
    layout["head"] = H
    return rig, layout


# ---- assembly -----------------------------------------------------------------------------------------------------------------
def _instance(mod, M, ctx, rig, out):
    """Transforms one module by M (4x4, may mirror/scale) into the rest pose and appends its arrays to `out`."""
    M3 = M[:3, :3]
    det = np.linalg.det(M3)
    NM = np.linalg.inv(M3).T
    names = mod["owners"]
    table = np.full(max(names) + 2, -1, np.int64)
    for oid, nm in names.items():
        if nm in ctx:
            table[oid] = rig.index[ctx[nm]]
    for pr in mod["prims"]:
        P = pr["P"] @ M3.T + M[:3, 3]
        Nn = pr["N"] @ NM.T
        Nn /= np.linalg.norm(Nn, axis=1, keepdims=True) + 1e-12
        I = pr["I"][:, ::-1] if det < 0 else pr["I"]
        o = pr["owner"]
        ja = table[o[:, 0]]
        has2 = o[:, 1] != 255
        jb = np.where(has2, table[np.minimum(o[:, 1], len(table) - 1)], -1)
        wb = np.where(has2, o[:, 2] / 255.0, 0.0)
        if (ja < 0).any():
            bad = sorted({names[int(i)] for i in np.unique(o[ja < 0, 0])})
            raise RuntimeError("unmapped owner(s) %s in context %s" % (bad, sorted(ctx)))
        # a second bone the context does not know (or equal to the first) collapses into the first
        drop = has2 & ((jb < 0) | (jb == ja))
        jb = np.where(drop, -1, jb)
        wb = np.where(drop, 0.0, wb)
        out.append(dict(P=P, N=Nn, UV=pr["UV"], I=I, mat=MAT_NAMES.index(pr["mat"]), ja=ja, jb=jb, wb=wb, mask=pr["mask"]))


def assemble(kit, rig, layout, tpl, lod):
    """Rest pose of the whole creature for one LOD. Returns dict of concatenated arrays (glTF space)."""
    key = "lod%d" % lod
    out = []
    # crown
    _instance(kit["Head"][key], np.eye(4), {n: n for n in kit["Head"][key]["owners"].values()}, rig, out)
    # vertebrae (variants normalised to a common rest pitch P0)
    fq = {q: P0 / vertebra_pitch(kit["Segment_%d" % q]["lod0"]) for q in range(3)}
    for k in range(NVERT - 1):
        q = int(hash1((k + 1) * 7 + 3) * 3)
        ctx = {"spine_k": "spine_%02d" % k, "spine_k1": "spine_%02d" % (k + 1)}
        _instance(kit["Segment_%d" % q][key], T(0, 0, (k + 1) * P0) @ S(fq[q]), ctx, rig, out)
    f_tail = P0 / vertebra_pitch(kit["Tail"]["lod0"])
    _instance(kit["Tail"][key], T(0, 0, NVERT * P0) @ S(f_tail), {"spine_k": "spine_%02d" % (NVERT - 1), "spine_k1": "tail_0", "tail_0": "tail_0"}, rig, out)
    layout["fq"] = fq
    layout["f_tail"] = f_tail
    # legs
    Ru, Rl, Rh = tpl["U"], tpl["L"], tpl["H"]
    for lg in layout["legs"]:
        lead = lg["kind"] == "lead"
        # triangle budget: LOD0 <= 60k (full legs on the lead legs near the crown, the cheap leg module elsewhere),
        # LOD1 <= 25k (every second follower only)
        if lod == 1:
            if not lead and lg["point"] % 2:
                continue
            lk = "lod1"
        else:
            lk = "lod0" if (lg["point"] <= 10 and (lead or lg["point"] <= 1)) else "lod1"
        M = lg["M"]
        b = lg["bones"]
        sp = "spine_%02d" % (lg["point"] - 1)
        cu = {"leg_0": b[0], "spine_k": sp}
        cl = {"leg_0": b[0], "leg_1": b[1], "leg_2": b[2] if lead else b[1]}
        ch = {"leg_3": b[3] if lead else b[2]}
        _instance(kit["LimbUpper"][lk], M @ Ru, cu, rig, out)
        _instance(kit["LimbLower"][lk], M @ Rl, cl, rig, out)
        _instance(kit["Hook"][lk], M @ Rh, ch, rig, out)
    cat = lambda k: np.concatenate([o[k] for o in out])
    offs = np.cumsum([0] + [len(o["P"]) for o in out])
    faces = np.concatenate([o["I"] + offs[i] for i, o in enumerate(out)])
    fmat = np.concatenate([np.full(len(o["I"]), o["mat"], np.int64) for o in out])
    return dict(P=cat("P"), N=cat("N"), UV=cat("UV"), I=faces, fmat=fmat, ja=cat("ja"), jb=cat("jb"), wb=cat("wb"), mask=cat("mask"))


def skin_arrays(asm, nbones):
    """(joints (N,4) int, weights (N,4) float): the first bone gets 1 - wb, the second wb; zeros are bone 0 / weight 0."""
    n = len(asm["P"])
    J = np.zeros((n, 4), np.int64)
    W = np.zeros((n, 4), np.float64)
    J[:, 0] = asm["ja"]
    W[:, 0] = 1.0 - asm["wb"]
    sec = asm["jb"] >= 0
    J[sec, 1] = asm["jb"][sec]
    W[sec, 1] = asm["wb"][sec]
    return J, W
