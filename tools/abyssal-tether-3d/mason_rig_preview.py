"""THE MASON RIG: preview contact sheets (Blender / Cycles). Imports the EXPORTED mason_rig.glb (so skin, weights and clips are
checked as shipped), poses it with each clip's actions and renders 8 key poses per clip into one <= 1280x720 sheet.

Run through build_mason_rig.py --render DIR (under `flock /tmp/at3d-blender.lock`, one Blender at a time, <= ~2 GB here).
"""
import math
import os

import numpy as np


def _find_action(bpy, name):
    for a in bpy.data.actions:
        if a.name == name or a.name.endswith("|" + name) or a.name.startswith(name + "."):
            return a
    return None


def _setup_scene(bpy):
    from mathutils import Vector
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 20
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 3
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.012, 0.016, 0.022, 1)
    bg.inputs["Strength"].default_value = 1.0
    lights = []
    for nm, loc, en, col in (("key", (-6.0, 15.0, 5.0), 9000, (1.0, 0.86, 0.66)), ("rim", (9.0, -2.0, 9.0), 6500, (0.62, 0.78, 1.0)), ("fill", (4.0, 14.0, -3.0), 1800, (0.8, 0.9, 1.0))):
        ld = bpy.data.lights.new(nm, "POINT")
        ld.energy = en
        ld.color = col
        ld.shadow_soft_size = 1.2
        lo = bpy.data.objects.new(nm, ld)
        sc.collection.objects.link(lo)
        lo.location = loc
        lights.append(lo)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 40
    cam.data.clip_end = 400
    return sc, cam, lights


def _aim(cam, loc, target):
    from mathutils import Vector
    cam.location = Vector(loc)
    d = (Vector(target) - cam.location).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_sheets(glb, res, outdir, tile=(320, 360), cols=4, rows=2):
    import bpy
    os.makedirs(outdir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    lod1 = [o for o in bpy.data.objects if o.type == "MESH" and "LOD1" in o.name]
    for o in lod1:
        o.hide_render = True
        o.hide_viewport = True
    sc, cam, lights = _setup_scene(bpy)
    sc.render.resolution_x, sc.render.resolution_y = tile
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    if arm.animation_data:
        for t in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(t)
    meta = res["meta"]
    tmp = os.path.join(outdir, "_tiles")
    os.makedirs(tmp, exist_ok=True)

    def pose_clip(clip, frame_idx):
        act = _find_action(bpy, clip.name)
        if act is None:
            raise RuntimeError("action %s not imported" % clip.name)
        arm.animation_data_create()
        arm.animation_data.action = act
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:  # noqa: BLE001
            pass
        sc.frame_set(1 + frame_idx)

    def frames_for(clip):
        n = 8
        if clip.loop:
            return [int(round(i * (clip.F - 1) / n)) for i in range(n)]
        if clip.name == "strike":
            return [0, 2, 3, 4, 5, 6, 8, 12]
        if clip.name == "rear_windup":
            return [int(round(i * (clip.F - 1) / (n - 1))) for i in range(n)]
        return [int(round(i * (clip.F - 1) / (n - 1))) for i in range(n)]

    sheets = []
    for clip in res["clips"]:
        if clip.name == "leg_probe":
            continue
        tiles = []
        for k, fi in enumerate(frames_for(clip)):
            pose_clip(clip, fi)
            # the crown 3/4 view; the camera pulls back for the clips that move the whole crown
            far = 1.0
            _aim(cam, (-10.5 * far, 15.0 * far, 4.0), (0.0, -0.5, 0.8))
            p = os.path.join(tmp, "%s_%02d.png" % (clip.name, k))
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            tiles.append(p)
        sheets.append((clip.name, tiles))
        _stitch(bpy, tiles, os.path.join(outdir, "mason_rig_%s.png" % clip.name), tile, cols, rows, clip)
    # the leg template
    arm.animation_data.action = None
    return sheets


def _stitch(bpy, tiles, out, tile, cols, rows, clip):
    w, h = tile
    sheet = np.zeros((h * rows, w * cols, 4), np.float32)
    sheet[..., 3] = 1
    for k, p in enumerate(tiles[: cols * rows]):
        im = bpy.data.images.load(p)
        a = np.zeros(len(im.pixels), np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)                      # bottom-up rows
        r, c = divmod(k, cols)
        y0 = (rows - 1 - r) * h
        sheet[y0: y0 + h, c * w: (c + 1) * w] = a
        bpy.data.images.remove(im)
    img = bpy.data.images.new("sheet_" + clip.name, w * cols, h * rows)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
