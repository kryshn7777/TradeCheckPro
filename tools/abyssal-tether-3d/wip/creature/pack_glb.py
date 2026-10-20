#!/usr/bin/env python3
"""Slims the rig-contract vertex attributes of a Blender-exported GLB (stdlib + numpy, no Blender needed).

Blender writes _OWNER, _OWNER2, _OWNW2 as three float scalars and _MASK as float VEC4. This packs them:
  _MASK   float VEC4  -> UNSIGNED_BYTE VEC4, normalized   (flesh, wet, thickness, class/3)
  _OWNER  (+ _OWNER2, _OWNW2) -> ONE UNSIGNED_BYTE VEC4, not normalized:
             x = owner bone id, y = second bone id (255 = none), z = weight of the second bone * 255, w = 0
  _SPINE_S, _PART stay float (module-local rest arc length in m, island id).
Then drops every bufferView nothing references any more. Usage: pack_glb.py in.glb [out.glb]
"""
import json
import struct
import sys

import numpy as np


def read_glb(fn):
    b = open(fn, "rb").read()
    assert b[:4] == b"glTF"
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


def write_glb(fn, js, bn):
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * (-len(jb) % 4)
    bn += b"\0" * (-len(bn) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bn))
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb + struct.pack("<II", len(bn), 0x004E4942) + bn
    open(fn, "wb").write(out)


NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def acc_array(js, bn, ai):
    a = js["accessors"][ai]
    bv = js["bufferViews"][a["bufferView"]]
    n, nc = a["count"], NCOMP[a["type"]]
    assert a["componentType"] == 5126
    stride = bv.get("byteStride") or nc * 4
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    if stride == nc * 4:
        return np.frombuffer(bn, np.float32, n * nc, base).reshape(n, nc).copy()
    rows = np.frombuffer(bn, np.uint8, n * stride, base).reshape(n, stride)
    return rows[:, : nc * 4].copy().view(np.float32).reshape(n, nc)


def pack(js, bn):
    new_chunks = []  # (bytes) appended as new bufferViews
    nbv0 = len(js["bufferViews"])

    def add_view(data):
        js["bufferViews"].append({"buffer": 0, "byteOffset": 0, "byteLength": len(data), "target": 34962})
        new_chunks.append(bytes(data))
        return len(js["bufferViews"]) - 1

    def add_acc(view, ctype, count, typ, normalized=False):
        a = {"bufferView": view, "componentType": ctype, "count": count, "type": typ}
        if normalized:
            a["normalized"] = True
        js["accessors"].append(a)
        return len(js["accessors"]) - 1

    for m in js["meshes"]:
        for p in m["primitives"]:
            at = p["attributes"]
            if "_MASK" in at:
                v = acc_array(js, bn, at["_MASK"])
                q = np.clip(np.rint(v * 255), 0, 255).astype(np.uint8)
                at["_MASK"] = add_acc(add_view(q.tobytes()), 5121, len(q), "VEC4", True)
            if "_OWNER" in at:
                o1 = acc_array(js, bn, at["_OWNER"])[:, 0]
                o2 = acc_array(js, bn, at["_OWNER2"])[:, 0] if "_OWNER2" in at else np.full(len(o1), -1.0, np.float32)
                w2 = acc_array(js, bn, at["_OWNW2"])[:, 0] if "_OWNW2" in at else np.zeros(len(o1), np.float32)
                q = np.zeros((len(o1), 4), np.uint8)
                q[:, 0] = np.clip(np.rint(o1), 0, 254)
                q[:, 1] = np.where(o2 < 0, 255, np.clip(np.rint(o2), 0, 254))
                q[:, 2] = np.clip(np.rint(w2 * 255), 0, 255)
                at["_OWNER"] = add_acc(add_view(q.tobytes()), 5121, len(q), "VEC4", False)
                at.pop("_OWNER2", None)
                at.pop("_OWNW2", None)
    # drop accessors nothing references, then rebuild the binary: only referenced views, 4-byte aligned
    ref = set()
    for m in js["meshes"]:
        for p in m["primitives"]:
            ref.update(p["attributes"].values())
            if "indices" in p:
                ref.add(p["indices"])
    keep = sorted(ref)
    amap = {o: n for n, o in enumerate(keep)}
    js["accessors"] = [js["accessors"][i] for i in keep]
    for m in js["meshes"]:
        for p in m["primitives"]:
            p["attributes"] = {k: amap[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = amap[p["indices"]]
    used = set()
    for a in js["accessors"]:
        if "bufferView" in a:
            used.add(a["bufferView"])
    for im in js.get("images", []):
        if "bufferView" in im:
            used.add(im["bufferView"])
    out = bytearray()
    remap = {}
    new_views = []
    for i, bv in enumerate(js["bufferViews"]):
        if i not in used:
            continue
        data = new_chunks[i - nbv0] if i >= nbv0 else bn[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        out += b"\0" * (-len(out) % 4)
        nb = dict(bv)
        nb["byteOffset"] = len(out)
        nb["byteLength"] = len(data)
        remap[i] = len(new_views)
        new_views.append(nb)
        out += data
    js["bufferViews"] = new_views
    for a in js["accessors"]:
        if "bufferView" in a:
            a["bufferView"] = remap[a["bufferView"]]
    for im in js.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = remap[im["bufferView"]]
    js["buffers"] = [{"byteLength": len(out)}]
    return bytes(out)


if __name__ == "__main__":
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    js, bn = read_glb(src)
    nb = pack(js, bn)
    write_glb(dst, js, nb)
    print("packed %s: %.2f MB -> %.2f MB" % (src, len(bn) / 1e6, len(nb) / 1e6))
