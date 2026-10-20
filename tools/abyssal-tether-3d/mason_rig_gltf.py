"""THE MASON RIG: glTF 2.0 writer (numpy only). Skinned LOD0 / LOD1 meshes sharing one skeleton + the clips as animations.

Writes exactly what src/render/masonRigView.js reads: bone nodes named as in the rig (identity rotation at rest, translation
= head - parent head), one skin (inverse bind = translate(-head)), two meshes (one primitive per material / body group, so
index buffers stay 16 bit), attributes quantised for the 8 MB budget (NORMAL i8, TEXCOORD_0 u16, JOINTS_0 u8, WEIGHTS_0 u8,
_MASK u8), the kit's materials / textures / images copied verbatim, one animation per clip (LINEAR, node-local absolute
values) and the rig metadata in the root `extras.mason`.
"""
import json
import struct

import numpy as np

ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
F32, U8, I8, U16, U32 = 5126, 5121, 5120, 5123, 5125


class Bin:
    def __init__(self):
        self.data = bytearray()
        self.views = []
        self.accessors = []

    def view(self, raw, target=None, stride=None):
        while len(self.data) % 4:
            self.data.append(0)
        v = {"buffer": 0, "byteOffset": len(self.data), "byteLength": len(raw)}
        if target:
            v["target"] = target
        if stride:
            v["byteStride"] = stride
        self.data += raw
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, ctype, typ, target=None, normalized=False, stride=None, minmax=False, count=None):
        raw = np.ascontiguousarray(arr).tobytes()
        bv = self.view(raw, target, stride)
        n = count if count is not None else len(arr)
        a = {"bufferView": bv, "componentType": ctype, "count": int(n), "type": typ}
        if normalized:
            a["normalized"] = True
        if minmax:
            a["min"] = [float(x) for x in arr.reshape(len(arr), -1).min(0)]
            a["max"] = [float(x) for x in arr.reshape(len(arr), -1).max(0)]
        self.accessors.append(a)
        return len(self.accessors) - 1


def quantise_weights(W):
    q = np.clip(np.rint(W * 255.0), 0, 255).astype(np.int64)
    d = 255 - q.sum(1)
    q[np.arange(len(q)), np.argmax(q, 1)] += d
    return q.astype(np.uint8)


def prim_arrays(asm, mask):
    """Vertices referenced by the faces in `mask`, remapped. Returns dict of arrays and the new index list."""
    faces = asm["I"][mask]
    used, inv = np.unique(faces.ravel(), return_inverse=True)
    return used, inv.reshape(-1, 3)


def build_mesh(bn, asm, skin_J, skin_W, mat_ids, mesh_name):
    prims = []
    groups = sorted({(int(m), int(g)) for m, g in zip(asm["fmat"], asm["fgrp"])})
    for m, g in groups:
        mask = (asm["fmat"] == m) & (asm["fgrp"] == g)
        used, idx = prim_arrays(asm, mask)
        if len(used) > 65535:
            raise RuntimeError("primitive %s mat %d grp %d has %d vertices (> 65535)" % (mesh_name, m, g, len(used)))
        P = asm["P"][used].astype(np.float32)
        Nn = np.clip(np.rint(asm["N"][used] * 127.0), -127, 127).astype(np.int8)
        Npad = np.zeros((len(used), 4), np.int8)
        Npad[:, :3] = Nn
        uv = asm["UV"][used]
        if uv.min() < 0 or uv.max() > 1:
            raise RuntimeError("UV outside [0,1] in %s" % mesh_name)
        UV = np.clip(np.rint(uv * 65535.0), 0, 65535).astype(np.uint16)
        J = skin_J[used].astype(np.uint8)
        Wq = quantise_weights(skin_W[used])
        MK = np.clip(np.rint(asm["mask"][used] * 255.0), 0, 255).astype(np.uint8)
        at = {
            "POSITION": bn.accessor(P, F32, "VEC3", ARRAY_BUFFER, minmax=True),
            "NORMAL": bn.accessor(Npad, I8, "VEC3", ARRAY_BUFFER, normalized=True, stride=4, count=len(used)),
            "TEXCOORD_0": bn.accessor(UV, U16, "VEC2", ARRAY_BUFFER, normalized=True),
            "JOINTS_0": bn.accessor(J, U8, "VEC4", ARRAY_BUFFER),
            "WEIGHTS_0": bn.accessor(Wq, U8, "VEC4", ARRAY_BUFFER, normalized=True),
            "_MASK": bn.accessor(MK, U8, "VEC4", ARRAY_BUFFER, normalized=True),
        }
        ia = bn.accessor(idx.astype(np.uint16).ravel(), U16, "SCALAR", ELEMENT_ARRAY_BUFFER, count=idx.size)
        prims.append({"attributes": at, "indices": ia, "material": mat_ids[m], "mode": 4, "extras": {"group": g}})
    return {"name": mesh_name, "primitives": prims}


def animation(bn, clip, rest_local, node_of):
    """glTF animation for one clip: absolute node-local TRS values (rest + delta) at every 30 fps frame."""
    samplers, channels = [], []
    t_acc = bn.accessor(clip.t.astype(np.float32), F32, "SCALAR", minmax=True)

    def add(node, path, arr, typ):
        a = bn.accessor(arr.astype(np.float32), F32, typ)
        samplers.append({"input": t_acc, "output": a, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})

    for b in clip.bones():
        node = node_of[b]
        if b in clip.q and not np.allclose(clip.q[b], [0, 0, 0, 1], atol=1e-6):
            add(node, "rotation", clip.q[b], "VEC4")
        if b in clip.p and np.abs(clip.p[b]).max() > 1e-6:
            add(node, "translation", clip.p[b] + rest_local[b], "VEC3")
        if b in clip.s and np.abs(clip.s[b] - 1).max() > 1e-6:
            add(node, "scale", clip.s[b], "VEC3")
    return {"name": clip.name, "samplers": samplers, "channels": channels}


def recompress(raw, name, quality):
    """Progressive, optimised JPEG at a slightly lower quality (normal maps keep 4 points more): the 8 MB budget."""
    if not quality:
        return raw
    try:
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality + (4 if "normal" in name else 0), optimize=True, progressive=True)
        return buf.getvalue() if len(buf.getvalue()) < len(raw) else raw
    except Exception:  # noqa: BLE001 (PIL missing: ship the kit's own bytes)
        return raw


def write_glb(path, rig, lods, skins, kit_js, kit_bn, clips, meta, tex_quality=68):
    """lods: [(name, asm)], skins: [(J, W)] per LOD."""
    bn = Bin()
    nb = len(rig)
    # images / textures / samplers / materials of the kit, byte-for-byte
    images = []
    for im in kit_js.get("images", []):
        v = kit_js["bufferViews"][im["bufferView"]]
        raw = bytes(kit_bn[v.get("byteOffset", 0): v.get("byteOffset", 0) + v["byteLength"]])
        raw = recompress(raw, im.get("name") or "", tex_quality)
        images.append({"name": im.get("name"), "mimeType": im["mimeType"], "bufferView": bn.view(raw)})
    mat_names = [m["name"] for m in kit_js["materials"]]
    mats = json.loads(json.dumps(kit_js["materials"]))
    from_name = {n: i for i, n in enumerate(mat_names)}
    # nodes: 0 armature, 1..nb bones, then the mesh nodes
    node_of = {n: 1 + i for i, n in enumerate(rig.names)}
    nodes = [{"name": "MasonRig", "children": [node_of["root"]]}]
    rest_local = {}
    for i, n in enumerate(rig.names):
        par = rig.parent[i]
        loc = rig.head[i] - (rig.head[rig.index[par]] if par else 0.0)
        rest_local[n] = loc
        nodes.append({"name": n, "translation": [float(x) for x in loc]})
    for i, n in enumerate(rig.names):
        par = rig.parent[i]
        if par:
            nodes[node_of[par]].setdefault("children", []).append(node_of[n])
    ibm = np.zeros((nb, 16), np.float32)
    for i in range(nb):
        m = np.eye(4)
        m[:3, 3] = -rig.head[i]
        ibm[i] = m.T.ravel()
    ibm_acc = bn.accessor(ibm.reshape(nb, 16), F32, "MAT4")
    skin = {"name": "MasonSkin", "joints": [node_of[n] for n in rig.names], "inverseBindMatrices": ibm_acc, "skeleton": node_of["root"]}
    meshes = []
    scene_nodes = [0]
    mesh_nodes = []
    for (name, asm), (J, W) in zip(lods, skins):
        meshes.append(build_mesh(bn, asm, J, W, [from_name[m] for m in ("MasonCrown", "MasonBody", "MasonEmissive")], name))
        nodes.append({"name": name, "mesh": len(meshes) - 1, "skin": 0})
        scene_nodes.append(len(nodes) - 1)
        mesh_nodes.append(len(nodes) - 1)
    anims = [animation(bn, c, rest_local, node_of) for c in clips]
    meta = dict(meta)
    meta["bones"] = nb
    js = {
        "asset": {"version": "2.0", "generator": "ABYSSAL TETHER 3D build_mason_rig.py"},
        "extensionsUsed": kit_js.get("extensionsUsed", []),
        "scene": 0,
        "scenes": [{"name": "MasonRig", "nodes": scene_nodes}],
        "nodes": nodes,
        "skins": [skin],
        "meshes": meshes,
        "materials": mats,
        "textures": kit_js.get("textures", []),
        "samplers": kit_js.get("samplers", []),
        "images": images,
        "animations": anims,
        "accessors": bn.accessors,
        "bufferViews": bn.views,
        "buffers": [{"byteLength": len(bn.data)}],
        "extras": {"mason": meta},
    }
    for k in ("samplers", "textures"):
        if not js[k]:
            del js[k]
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * (-len(jb) % 4)
    bd = bytes(bn.data) + b"\0" * (-len(bn.data) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bd))
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb + struct.pack("<II", len(bd), 0x004E4942) + bd
    with open(path, "wb") as f:
        f.write(out)
    return len(out), js
