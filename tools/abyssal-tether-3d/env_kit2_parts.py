"""ABYSSAL TETHER 3D - WP-ART-PASS authored environment modules (kit part set 2).

Imported by build_env_kit.py (`PARTS += env_kit2_parts.parts(globals())`), so they land in the same
ch1_env_kit.glb as the original parts and LevelView draws them through the same stone / metal / glow decor lists
(no new draw calls). All parts follow the kit conventions (three.js space, +Y up; wall-mounted parts have their back on
z = 0 and project toward +z, centred on x = 0; standing parts start at y = 0), carry vertex AO x per-stone tone in COLOR_0
and no UVs (LevelView projects the shared PBR sets in metres).

  part                       list   pivot / size (m)                                                              tris
  ch1_env_wall_a             stone  wall panel 4 x 4, bottom-centre; big ashlar (courses 0.7-1.1, blocks 1.1-2)   ~200
  ch1_env_wall_b             stone  wall panel 4 x 4; medium ashlar (0.45-0.7 / 0.7-1.3), deeper joints          ~420
  ch1_env_wall_c             stone  wall panel 4 x 4; broken ashlar: missing / sunken / proud stones, chipped      ~300
  ch1_env_buttress_lo        stone  wall buttress 4 m module, bottom-centre, 1.7 w x 1.0 d, battered, two set-offs ~120
  ch1_env_buttress_cap       stone  buttress head 1.6 h: drip moulding, weathered slope, finial                   ~90
  ch1_env_column_cluster     stone  engaged column cluster 5 m, bottom-centre: moulded base, entasis shafts, capital ~560
  ch1_env_stair_fragment     stone  broken stair flight 3.6 w x 2 h x 1.1 d, bottom-centre, steps rise to +x         ~230
  ch1_env_pipe_run           metal  4 m pipe along x on clamps, flanges, bolts, valve wheel, centre y = 0.35       ~330
  ch1_env_lantern            metal  wall lantern: plate at z = -0.42, curled arm, cage, hoops, cap; origin = flame  ~260
  ch1_env_lantern_glass      glow   its glass and flame (vertex colour = emission)                                  ~60
"""

import math
import random


def parts(ns):
    Geo = ns["Geo"]
    box = ns["box"]
    loft_rect = ns["loft_rect"]
    lathe = ns["lathe"]
    tube = ns["tube"]
    cone = ns["cone"]
    xf = ns["xf"]
    TAU = ns["TAU"]

    # ------------------------------------------------------------------ wall panels
    def make_panel(seed, W=4.0, H=4.0, ch=(0.7, 1.1), cw=(1.1, 2.0), dep=(0.06, 0.16), miss=0.0, joint=0.08, chip=0.16):
        rng = random.Random(seed)
        g = Geo()
        g.vmul = []  # per-vertex multiplier (stone tone x depth shade), applied after the AO bake
        g.norecalc = True
        ys = [0.0]
        while ys[-1] < H - 0.3:
            ys.append(ys[-1] + rng.uniform(*ch))
        k = H / ys[-1]
        ys = [y * k for y in ys]
        for ci in range(len(ys) - 1):
            y0, y1 = ys[ci], ys[ci + 1]
            xs = [-W / 2, -W / 2 + rng.uniform(0.35, 1.0) * rng.uniform(*cw)]
            while xs[-1] < W / 2 - 0.4:
                xs.append(xs[-1] + rng.uniform(*cw))
            xs[-1] = W / 2
            for bi in range(len(xs) - 1):
                x0, x1 = xs[bi], xs[bi + 1]
                bx0, bx1, by0, by1 = x0 + joint / 2, x1 - joint / 2, y0 + joint / 2, y1 - joint / 2
                w, h = bx1 - bx0, by1 - by0
                r = rng.random()
                d = rng.uniform(*dep)
                if r < miss:
                    continue
                if r < miss + 0.08:
                    d *= 0.25
                elif r < miss + 0.14:
                    d *= 1.55
                c = min(0.05, 0.25 * min(w, h))
                tone = rng.uniform(0.74, 1.08)
                jz = lambda: rng.uniform(-0.012, 0.012)  # noqa: E731
                B = [(bx0, by0, 0.0), (bx1, by0, 0.0), (bx1, by1, 0.0), (bx0, by1, 0.0)]
                T = [[bx0 + c, by0 + c, d + jz()], [bx1 - c, by0 + c, d + jz()], [bx1 - c, by1 - c, d + jz()], [bx0 + c, by1 - c, d + jz()]]
                if w > 0.6 and rng.random() < chip:
                    kk = rng.randrange(4)
                    s = rng.uniform(0.12, 0.3)
                    sx = 1 if kk in (0, 3) else -1
                    sy = 1 if kk in (0, 1) else -1
                    T[kk][0] += sx * s
                    T[kk][1] += sy * s * 0.8
                    T[kk][2] = d * rng.uniform(0.1, 0.4)
                    tone *= 0.92
                bi0 = [g.v(*p) for p in B]
                ti0 = [g.v(*p) for p in T]
                for _ in range(4):
                    g.vmul.append(tone * 0.55)
                for p in T:
                    g.vmul.append(tone * (0.8 + 0.2 * min(1.0, p[2] / 0.12)))
                g.face(ti0)  # top, CCW from +z
                for i in range(4):
                    j = (i + 1) % 4
                    g.face([bi0[i], bi0[j], ti0[j], ti0[i]])
        return g

    def post_vmul(ob, geo):
        """Multiplies COLOR_0 by geo.vmul (vertex order is preserved: no weld for these parts)."""
        me = ob.data
        attr = me.color_attributes.active_color
        for i, m in enumerate(geo.vmul[: len(me.vertices)]):
            r, gg, b, a = attr.data[i].color
            attr.data[i].color = (min(1.0, r * m), min(1.0, gg * m), min(1.0, b * m), 1.0)

    def panel_part(seed, **kw):
        def build():
            g = make_panel(seed, **kw)
            g.post = post_vmul
            return g

        return build

    # ------------------------------------------------------------------ buttress
    def part_buttress_lo():
        g = Geo()
        lv = [
            (0.0, -0.9, 0.9, 0.0, 1.05), (0.5, -0.9, 0.9, 0.0, 1.05), (0.62, -0.82, 0.82, 0.0, 0.96),
            (2.0, -0.72, 0.72, 0.0, 0.82), (2.0, -0.78, 0.78, 0.0, 0.88),  # set-off shelf (weathering ledge)
            (2.1, -0.66, 0.66, 0.0, 0.76), (3.4, -0.58, 0.58, 0.0, 0.62), (3.4, -0.64, 0.64, 0.0, 0.68), (3.5, -0.52, 0.52, 0.0, 0.56),
            (4.0, -0.5, 0.5, 0.0, 0.52),
        ]
        g.add(loft_rect(lv))
        return g

    def part_buttress_cap():
        g = Geo()
        lv = [
            (0.0, -0.5, 0.5, 0.0, 0.52), (0.18, -0.58, 0.58, 0.0, 0.62), (0.3, -0.58, 0.58, 0.0, 0.62), (0.34, -0.5, 0.5, 0.0, 0.54),
            (1.0, -0.4, 0.4, 0.0, 0.2), (1.08, -0.4, 0.4, 0.0, 0.2),
        ]
        g.add(loft_rect(lv))
        g.add(cone(0.16, 0.5, seg=4, y0=1.08), xf(tz=0.08))
        return g

    # ------------------------------------------------------------------ column cluster
    def shaft(r, h, z, x, seg=10, entasis=0.03):
        prof = [(r * 1.0, 0.0), (r * (1 + entasis), h * 0.35), (r * (1 + entasis * 0.6), h * 0.7), (r * 0.94, h)]
        s = lathe(prof, seg=seg, a0=-math.pi * 0.75, a1=math.pi * 0.75, smooth=True, cap_top=False, cap_bottom=False)
        return s.transformed(xf(tx=x, tz=z))

    def part_column_cluster():
        g = Geo()
        # moulded base: plinth, torus, scotia, torus
        g.add(loft_rect([(0.0, -0.78, 0.78, 0.0, 0.9), (0.3, -0.78, 0.78, 0.0, 0.9), (0.36, -0.7, 0.7, 0.0, 0.8)]))
        g.add(loft_rect([(0.36, -0.68, 0.68, 0.0, 0.76), (0.42, -0.7, 0.7, 0.0, 0.8), (0.52, -0.62, 0.62, 0.0, 0.68)]))
        g.add(loft_rect([(0.52, -0.56, 0.56, 0.0, 0.6), (0.6, -0.52, 0.52, 0.0, 0.55)]))
        # three shafts: a heavy central one and two slender flankers
        H = 3.8
        g.add(shaft(0.34, H, 0.34, 0.0).transformed(xf(ty=0.62)))
        g.add(shaft(0.17, H, 0.17, -0.52).transformed(xf(ty=0.62)))
        g.add(shaft(0.17, H, 0.17, 0.52).transformed(xf(ty=0.62)))
        # shaft rings (annulets) at one third and two thirds
        for yy in (2.0, 3.2):
            g.add(loft_rect([(yy, -0.74, 0.74, 0.0, 0.5), (yy + 0.05, -0.78, 0.78, 0.0, 0.54), (yy + 0.1, -0.74, 0.74, 0.0, 0.5)]))
        # capital: astragal, flared bell, abacus; leaf crockets
        y0 = 4.42
        g.add(loft_rect([(y0, -0.72, 0.72, 0.0, 0.52), (y0 + 0.4, -0.84, 0.84, 0.0, 0.72), (y0 + 0.56, -0.9, 0.9, 0.0, 0.8)]))
        g.add(loft_rect([(y0 + 0.56, -0.96, 0.96, 0.0, 0.88), (y0 + 0.62, -1.0, 1.0, 0.0, 0.92), (y0 + 0.78, -1.0, 1.0, 0.0, 0.92), (y0 + 0.8, -0.95, 0.95, 0.0, 0.87)]))
        for x in (-0.55, 0.0, 0.55):
            pts = [(x * 1.05, y0 + 0.05 + 0.38 * i / 5, 0.5 + 0.08 * math.sin(i / 5 * 2.2) + 0.12 * i / 5) for i in range(6)]
            pts += [(x * 1.12, y0 + 0.5, 0.82), (x * 1.1, y0 + 0.42, 0.88)]
            g.add(tube(pts, [0.06, 0.07, 0.07, 0.065, 0.06, 0.06, 0.07, 0.04], sides=4))
        return g

    # ------------------------------------------------------------------ broken stair flight
    def part_stair_fragment():
        g = Geo()
        n = 6
        run, rise, w = 0.6, 0.32, 1.1
        x_start = -1.8
        for i in range(n):
            x0 = x_start + i * run
            x1 = x0 + run
            y1 = (i + 1) * rise
            depth = [1.1, 1.1, 1.05, 1.0, 0.82, 0.55][i]  # the flight ends in a broken edge
            tread = loft_rect([(y1 - 0.3, x0 + 0.01, x1 - 0.01, 0.0, depth * 0.78), (y1 - 0.06, x0 + 0.01, x1 - 0.01, 0.0, depth), (y1, x0 + 0.01, x1 - 0.01, 0.0, depth - 0.04)])
            g.add(tread)
            # corbel brace under each step
            if i < 4:
                g.add(loft_rect([(y1 - 0.62, x0 + 0.18, x1 - 0.18, 0.0, 0.02), (y1 - 0.3, x0 + 0.18, x1 - 0.18, 0.0, depth * 0.78)]))
        # snapped iron handrail stub on the lowest steps
        pts = [(x_start + 0.3, 0.32 + 0.95, 0.12), (x_start + 1.0, 0.64 + 0.95, 0.12), (x_start + 1.8, 0.96 + 0.95, 0.12), (x_start + 2.3, 1.12 + 0.98, 0.14), (x_start + 2.4, 1.1 + 0.9, 0.16)]
        g.add(tube(pts, [0.03, 0.03, 0.03, 0.028, 0.02], sides=4))
        for i in (0, 2):
            g.add(box(x_start + 0.3 + i * 0.75 - 0.025, 0.32 * (i + 1) , 0.1, x_start + 0.3 + i * 0.75 + 0.025, 0.32 * (i + 1) + 0.95, 0.14))
        return g

    # ------------------------------------------------------------------ iron pipe run
    def part_pipe_run():
        g = Geo()
        L = 4.0
        r = 0.2
        cz = 0.34
        pipe = lathe([(r, -L / 2), (r, L / 2)], seg=10, smooth=True, cap_top=False, cap_bottom=False)
        g.add(pipe, xf(tz=cz, ty=0.35, rz=-math.pi / 2))
        for x in (-1.3, 0.0, 1.3):
            ring = lathe([(r, -0.045), (r + 0.1, -0.045), (r + 0.1, 0.045), (r, 0.045)], seg=10, smooth=False, cap_top=False, cap_bottom=False)
            g.add(ring, xf(tx=x, ty=0.35, tz=cz, rz=-math.pi / 2))
            for k in range(8):
                a = TAU * k / 8
                g.add(cone(0.03, 0.04, seg=4), xf(tx=x + 0.05, ty=0.35 + math.sin(a) * (r + 0.065), tz=cz + math.cos(a) * (r + 0.065), rz=-math.pi / 2))
        # wall clamps: straps over the pipe on stand-off plates
        for x in (-0.65, 0.65, 1.95, -1.95):
            g.add(box(x - 0.05, 0.35 - r - 0.05, cz - r - 0.03, x + 0.05, 0.35 + r + 0.05, cz + r + 0.03).transformed(lambda p: p))
            g.add(box(x - 0.06, 0.35 - 0.14, 0.0, x + 0.06, 0.35 + 0.14, cz - r * 0.6))
        # valve wheel on a stem
        g.add(box(-0.7 - 0.02, 0.35 + r, cz - 0.02, -0.7 + 0.02, 0.35 + r + 0.28, cz + 0.02))
        wheel = lathe([(0.0, 0.0), (0.2, 0.0), (0.2, 0.03), (0.17, 0.03), (0.17, 0.0)], seg=10, smooth=False, cap_top=False, cap_bottom=False)
        g.add(wheel, xf(tx=-0.7, ty=0.35 + r + 0.3, tz=cz))
        for k in range(4):
            g.add(box(-0.01, 0.0, -0.18, 0.01, 0.02, 0.18), xf(tx=-0.7, ty=0.35 + r + 0.31, tz=cz, ry=k * math.pi / 4))
        return g

    # ------------------------------------------------------------------ lantern (+ glass)
    def part_lantern():
        g = Geo()
        pz = -0.42
        # wall plate + curled arm
        g.add(box(-0.1, 0.0, pz, 0.1, 0.5, pz + 0.04))
        arm = [(0.0, 0.34, pz + 0.04), (0.0, 0.42, pz + 0.18), (0.0, 0.42, pz + 0.34), (0.0, 0.38, pz + 0.42), (0.0, 0.3, pz + 0.42)]
        g.add(tube(arm, [0.022, 0.022, 0.02, 0.018, 0.015], sides=4))
        g.add(box(-0.02, 0.0, pz + 0.04, 0.02, 0.34, pz + 0.08))  # stand-off
        # hang chain to the cap
        g.add(box(-0.008, 0.2, pz + 0.41, 0.008, 0.3, pz + 0.43))
        # cage: base, four posts, two hoops, pyramidal cap
        zc = pz + 0.42
        g.add(loft_rect([(-0.24, -0.1, 0.1, zc - 0.1, zc + 0.1), (-0.2, -0.13, 0.13, zc - 0.13, zc + 0.13), (-0.17, -0.12, 0.12, zc - 0.12, zc + 0.12)]))
        for sx in (-1, 1):
            for sz in (-1, 1):
                g.add(box(sx * 0.115 - 0.012, -0.17, zc + sz * 0.115 - 0.012, sx * 0.115 + 0.012, 0.15, zc + sz * 0.115 + 0.012))
        for yy in (-0.08, 0.1):
            g.add(loft_rect([(yy, -0.125, 0.125, zc - 0.125, zc + 0.125), (yy + 0.02, -0.125, 0.125, zc - 0.125, zc + 0.125)]))
        g.add(loft_rect([(0.15, -0.14, 0.14, zc - 0.14, zc + 0.14), (0.17, -0.15, 0.15, zc - 0.15, zc + 0.15), (0.3, -0.04, 0.04, zc - 0.04, zc + 0.04)]))
        g.add(cone(0.035, 0.05, seg=4, y0=0.3), xf(tz=zc))
        # spike under the base
        g.add(cone(0.03, 0.08, seg=4, y0=-0.24, tip_up=False), xf(tz=zc))
        return g

    def part_lantern_glass():
        g = Geo()
        zc = -0.42 + 0.42
        glass = lathe([(0.0, -0.17), (0.095, -0.17), (0.105, -0.02), (0.1, 0.12), (0.0, 0.14)], seg=8, smooth=True)
        g.add(glass, xf(tz=zc))
        return g

    # name, material, builder, options
    out = [
        ("ch1_env_wall_a", "stone", panel_part(101, ch=(0.7, 1.1), cw=(1.1, 2.0), dep=(0.07, 0.17), joint=0.09, chip=0.18), {"wall": True, "notris": True}),
        ("ch1_env_wall_b", "stone", panel_part(202, ch=(0.45, 0.7), cw=(0.7, 1.3), dep=(0.05, 0.14), joint=0.08, chip=0.16), {"wall": True, "notris": True}),
        ("ch1_env_wall_c", "stone", panel_part(303, ch=(0.65, 1.0), cw=(0.9, 1.7), dep=(0.06, 0.2), joint=0.09, miss=0.07, chip=0.3), {"wall": True, "notris": True}),
        ("ch1_env_buttress_lo", "stone", part_buttress_lo, {"wall": True, "floor": True}),
        ("ch1_env_buttress_cap", "stone", part_buttress_cap, {"wall": True, "floor": True}),
        ("ch1_env_column_cluster", "stone", part_column_cluster, {"wall": True, "floor": True, "ceiling": True}),
        ("ch1_env_stair_fragment", "stone", part_stair_fragment, {"wall": True}),
        ("ch1_env_pipe_run", "metal", part_pipe_run, {"wall": True}),
        ("ch1_env_lantern", "metal", part_lantern, {"wall": True}),
        ("ch1_env_lantern_glass", "glow", part_lantern_glass, {"noao": True, "vcol": (1.0, 0.7, 0.34)}),
    ]
    return out
