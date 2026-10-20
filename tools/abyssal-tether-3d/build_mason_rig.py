"""THE MASON RIG (ABYSSAL TETHER 3D): armature, skin weights, clips and export. Blender 5.2 / bpy, deterministic.

Builds on the rig-ready kit (assets/models/mason_kit.glb + mason_hero.glb, tools/abyssal-tether-3d/build_mason.py): it does
not remodel anything. It assembles the kit modules into one rest-pose creature, binds every part to its owner bone from the
kit's per-vertex _OWNER attribute (rigid stone / iron / bone / teeth at 100 %, flesh blended across two bones, at most 4
influences), authors the clips (mason_rig_clips.py, 30 fps, in place, never keys the root) and exports
public/abyssal-tether-3d/assets/models/mason_rig.glb (LOD0 + LOD1 skinned meshes sharing one skeleton, shared atlases).

  python build_mason_rig.py --out DIR [--render PREVIEW_DIR] [--clips a,b,c] [--rest-only]

Always run under `flock /tmp/at3d-blender.lock`. Rest-pose conventions (Blender): head at the origin facing +Y, body along
-Y, dorsal +Z, right +X. glTF export (+Y up) turns that into head facing -Z. All bones are identity-oriented (their local
axes are the world axes at rest), which keeps authored rotations intuitive and lets the runtime write world frames directly.
"""
import argparse
import json
import math
import os
import struct
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mason_rig_core as C  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(ROOT, "public", "abyssal-tether-3d", "assets", "models")
T0 = time.time()


def log(*a):
    print("[%6.1fs]" % (time.time() - T0), *a, flush=True)


def gl2bl(p):
    """glTF (x, y, z) -> Blender (x, -z, y), for arrays (N,3) or a single point."""
    p = np.asarray(p, float)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


# ---- Blender scene ---------------------------------------------------------------------------------------------------------
def import_materials(kit_path):
    import bpy
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=kit_path)
    for o in list(bpy.data.objects):
        if o not in before:
            bpy.data.objects.remove(o, do_unlink=True)
    mats = [bpy.data.materials[n] for n in C.MAT_NAMES]
    return mats


def build_armature(rig):
    import bpy
    from mathutils import Vector
    arm = bpy.data.armatures.new("MasonRig")
    ob = bpy.data.objects.new("MasonRig", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for i, name in enumerate(rig.names):
        b = arm.edit_bones.new(name)
        h = Vector(gl2bl(rig.head[i]).tolist())
        b.head = h
        b.tail = h + Vector((0.0, max(0.12, rig.length[i]), 0.0))   # +Y: identity orientation
        b.roll = 0.0
        b.use_deform = True
        eb[name] = b
    for i, name in enumerate(rig.names):
        par = rig.parent[i]
        if par:
            eb[name].parent = eb[par]
            eb[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.show_in_front = True
    arm.display_type = "OCTAHEDRAL"
    return ob


def build_mesh(name, asm, rig, mats, arm_ob, lod):
    """One Blender object for an assembled LOD: three material slots, per-vertex _MASK, vertex groups from the weights."""
    import bpy
    P = gl2bl(asm["P"]).astype(np.float32)
    Nn = gl2bl(asm["N"]).astype(np.float32)
    nv, nf = len(P), len(asm["I"])
    me = bpy.data.meshes.new(name)
    me.vertices.add(nv)
    me.vertices.foreach_set("co", P.ravel())
    me.loops.add(nf * 3)
    me.loops.foreach_set("vertex_index", asm["I"].astype(np.int32).ravel())
    me.polygons.add(nf)
    me.polygons.foreach_set("loop_start", (np.arange(nf) * 3).astype(np.int32))
    me.polygons.foreach_set("loop_total", np.full(nf, 3, np.int32))
    me.update(calc_edges=True)
    uv = asm["UV"].astype(np.float32).copy()
    uv[:, 1] = 1.0 - uv[:, 1]                       # glTF v runs down, Blender v up
    lay = me.uv_layers.new(name="UVMap")
    lay.data.foreach_set("uv", uv[asm["I"].ravel()].ravel())
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", asm["fmat"].astype(np.int32))
    me.polygons.foreach_set("use_smooth", np.ones(nf, bool))
    try:
        me.normals_split_custom_set_from_vertices(Nn.tolist())
    except Exception as e:  # noqa: BLE001
        log("custom normals failed:", e)
    at = me.color_attributes.new("_MASK", "FLOAT_COLOR", "POINT")
    at.data.foreach_set("color", asm["mask"].astype(np.float32).ravel())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = arm_ob
    # skin: vertex groups, grouped by (bone, weight) so each call sets many vertices
    J, W = C.skin_arrays(asm, len(rig))
    groups = {n: ob.vertex_groups.new(name=n) for n in rig.names}
    for slot in range(2):
        j, w = J[:, slot], np.round(W[:, slot] * 255).astype(np.int64)
        keep = w > 0
        key = j[keep] * 256 + w[keep]
        order = np.argsort(key, kind="stable")
        ks, vs = key[order], np.nonzero(keep)[0][order]
        if len(ks) == 0:
            continue
        cuts = np.nonzero(np.diff(ks))[0] + 1
        for seg_k, seg_v in zip(np.split(ks, cuts), np.split(vs, cuts)):
            groups[rig.names[int(seg_k[0]) // 256]].add(seg_v.tolist(), float(int(seg_k[0]) % 256) / 255.0, "ADD")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_ob
    mod.use_deform_preserve_volume = False
    return ob


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=MODELS)
    ap.add_argument("--kit", default=os.path.join(MODELS, "mason_kit.glb"))
    ap.add_argument("--hero", default=os.path.join(MODELS, "mason_hero.glb"))
    ap.add_argument("--render", default="")
    ap.add_argument("--clips", default="")
    ap.add_argument("--rest-only", action="store_true")
    ap.add_argument("--blend", default="")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = ap.parse_args(argv)
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit, _, _ = C.load_kit(args.kit)
    tpl = C.hero_leg_template(args.hero)
    rig, layout = C.build_rig(kit, tpl)
    log("bones", len(rig))
    mats = import_materials(args.kit)
    arm_ob = build_armature(rig)
    asm0 = C.assemble(kit, rig, layout, tpl, 0)
    asm1 = C.assemble(kit, rig, layout, tpl, 1)
    log("LOD0 %d tris %d verts, LOD1 %d tris" % (len(asm0["I"]), len(asm0["P"]), len(asm1["I"])))
    ob0 = build_mesh("Mason_LOD0", asm0, rig, mats, arm_ob, 0)
    ob1 = build_mesh("Mason_LOD1", asm1, rig, mats, arm_ob, 1)
    log("scene built")
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
    return dict(rig=rig, layout=layout, arm=arm_ob, ob0=ob0, ob1=ob1, asm0=asm0, asm1=asm1, kit=kit, tpl=tpl, args=args)


if __name__ == "__main__":
    main()
