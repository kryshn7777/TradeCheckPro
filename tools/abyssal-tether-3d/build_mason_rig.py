"""THE MASON RIG (ABYSSAL TETHER 3D): armature, skin weights, clips, export and previews. Deterministic.

Builds on the rig-ready kit (assets/models/mason_kit.glb + mason_hero.glb from tools/abyssal-tether-3d/build_mason.py); it
does not remodel anything. It assembles the kit modules into one rest-pose creature (17 vertebrae + the tail module on
18 vertebra bones, the crown, 10 lead legs + 26 follower legs), binds every part to its owner bone from the kit's per-vertex
_OWNER attribute (rigid stone / iron / bone / teeth at 100 %, flesh blended across two bones: at most 2 influences here),
authors the clips (mason_rig_clips.py: 30 fps, in place, the root is never keyed) and writes
public/abyssal-tether-3d/assets/models/mason_rig.glb (LOD0 + LOD1 skinned meshes sharing one skeleton, the kit's atlases).

  python3 build_mason_rig.py [--out DIR]                       # numpy only: the GLB + rig_report.json (a few seconds)
  flock /tmp/at3d-blender.lock BLENDER_VENV/bin/python build_mason_rig.py --render PREVIEW_DIR [--clips a,b]
        # additionally imports the exported GLB into Blender (so the real artefact is what gets checked) and renders
        # contact sheets of key poses of each clip (Cycles, 1280x720) into PREVIEW_DIR/mason_rig_<clip>.png

Rest-pose conventions: glTF space. Bones are identity-oriented (their local axes are the world axes at rest): the head
faces -Z, +Y is dorsal, +X is the creature's right; every bone's rest translation is head - parent head.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mason_rig_clips as K  # noqa: E402
import mason_rig_core as C  # noqa: E402
import mason_rig_gltf as G  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(ROOT, "public", "abyssal-tether-3d", "assets", "models")
T0 = time.time()


def log(*a):
    print("[%6.1fs]" % (time.time() - T0), *a, flush=True)


def build(args):
    kit, kit_js, kit_bn = C.load_kit(args.kit)
    tpl = C.hero_leg_template(args.hero)
    rig, layout = C.build_rig(kit, tpl)
    log("bones", len(rig))
    lods, skins = [], []
    for lod in (0, 1):
        asm = C.assemble(kit, rig, layout, tpl, lod)
        J, W = C.skin_arrays(asm, len(rig))
        lods.append(("Mason_LOD%d" % lod, asm))
        skins.append((J, W))
        log("LOD%d: %d tris, %d verts" % (lod, len(asm["I"]), len(asm["P"])))
    chain = {k: [float(x) for x in v] for k, v in layout["chain"].items()}
    clips = K.build_all(layout["chain"])
    gates = [K.metrics(c) for c in clips]
    for g in gates:
        if g["root"]:
            raise RuntimeError("clip %s keys the root" % g["name"])
    if args.clips:
        keep = set(args.clips.split(","))
        clips = [c for c in clips if c.name in keep]
    head = layout["head"]
    meta = dict(
        version=1,
        P0=C.P0, nvert=C.NVERT, simPoints=C.SIM_POINTS, fps=K.FPS,
        spine=["neck"] + ["spine_%02d" % k for k in range(C.NVERT)] + ["tail_0"],
        tailExtra="tail_1",
        crown="crown",
        chain=chain,                                    # template left leg, relative to its vertebra bone (glTF space)
        legs=[dict(name="%s%02d" % ("R" if lg["side"] > 0 else "L", lg["point"]), side=lg["side"], point=lg["point"], kind=lg["kind"],
                   simLimb=lg["simLimb"], bones=lg["bones"]) for lg in layout["legs"]],
        pits=[dict(bone="pit_%d" % j, dir=[float(x) for x in head["pits"][j]["dir"]], c=[float(x) for x in head["pits"][j]["c"]]) for j in range(7)],
        arms=[dict(n=n, bones=["arm_%d_0" % n, "arm_%d_1" % n], side=-1 if n in K.ARMS_LEFT else 1) for n in range(5)],
        headBounds=dict(lo=[-2.6, -5.2, -2.3], hi=[3.2, 6.1, 6.1]),
        lodTris=[len(lods[0][1]["I"]), len(lods[1][1]["I"])],
        legTemplate=K.LEG_TEMPLATE,
        clips={c.name: dict(kind=c.kind, loop=c.loop, duration=c.duration, events=[dict(name=n, u=u) for n, u in c.events],
                            phase=c.phase, snap=c.snap, mask=c.mask, frames=c.F, note=c.note) for c in clips},
    )
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, "mason_rig.glb")
    size, js = G.write_glb(path, rig, lods, skins, kit_js, kit_bn, clips, meta)
    report = dict(
        file=path, bytes=size, bones=len(rig), lod0_tris=meta["lodTris"][0], lod1_tris=meta["lodTris"][1],
        lod0_verts=len(lods[0][1]["P"]), lod1_verts=len(lods[1][1]["P"]),
        primitives_per_lod=[len(m["primitives"]) for m in js["meshes"]],
        clips=[dict(name=c.name, kind=c.kind, duration=c.duration, frames=c.F, loop=c.loop) for c in clips],
        gates=gates,
    )
    rep_dir = args.report or os.path.join(HERE, "wip", "creature")
    os.makedirs(rep_dir, exist_ok=True)
    with open(os.path.join(rep_dir, "mason_rig_report.json"), "w") as f:
        json.dump(report, f, indent=1)
    log("wrote %s: %.2f MB, %d bones, LOD0 %d tris, LOD1 %d tris, %d clips" % (path, size / 1e6, len(rig), meta["lodTris"][0], meta["lodTris"][1], len(clips)))
    return dict(path=path, rig=rig, layout=layout, clips=clips, meta=meta, report=report)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=MODELS)
    ap.add_argument("--kit", default=os.path.join(MODELS, "mason_kit.glb"))
    ap.add_argument("--hero", default=os.path.join(MODELS, "mason_hero.glb"))
    ap.add_argument("--render", default="", help="directory for the Blender preview contact sheets (needs bpy)")
    ap.add_argument("--report", default="", help="directory for mason_rig_report.json (default tools/abyssal-tether-3d/wip/creature)")
    ap.add_argument("--clips", default="", help="comma list: only these clips")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = ap.parse_args(argv)
    res = build(args)
    if args.render:
        import mason_rig_preview as PV
        PV.render_sheets(res["path"], res, args.render)


if __name__ == "__main__":
    main()
