"""ABYSSAL TETHER 3D - the statues of the environment kit, rebuilt with real anatomy (kit part set 3).

Imported by build_env_kit.py (`PARTS = env_statues.replace(PARTS, globals())`): the hooded saint in its niche, the corbel atlas figure and the
hero corbel keep their names, pivots and envelopes (the level plan, the colliders and the LODs do not change) but the old primitives
(a lathe robe, a dark plate for a face, boxes for hands) are gone. A figure now has:
  - a robe with real pleats (a lathe whose radius is modulated by folds that twist and fade toward the shoulders), a rolled hem, a rope
    belt with a knot and two hanging tails;
  - a head with a face: skull, brow ridge, closed eyelids, nose with wings, cheekbones, upper and lower lip, chin, jaw, under a hood with a
    rolled front edge, a drape of folds and a pointed peak;
  - sleeves with cuffs and hands with a palm, four jointed fingers and a thumb, closed round a lantern ring;
  - a caged lantern: ring, chain, base plate, six ribs, a cap and a finial.
Everything is authored at a coarse source resolution; build_env_kit.py subdivides (edge 0.03 for these parts), weathers and decimates it
to the per-level triangle targets (DETAIL_TRIS / DETAIL_TRIS_HI), so the detail survives in the silhouette and in the AO.
"""

import math


def parts(ns):
    Geo = ns["Geo"]
    box = ns["box"]
    lathe = ns["lathe"]
    tube = ns["tube"]
    cone = ns["cone"]
    xf = ns["xf"]
    loft_rect = ns["loft_rect"]
    pointed_arch_pts = ns["pointed_arch_pts"]
    TAU = ns["TAU"]
    old_hero = ns["part_corbel_hero"]

    # ---- primitives -------------------------------------------------------------------------------------------------
    def ell(rx, ry, rz, seg=10, rings=6, lon0=0.0, lon1=TAU, smooth=True):
        """Ellipsoid (lon 0 = +z, the front); a partial lon range gives an open shell (a hood)."""
        g = Geo()
        full = abs((lon1 - lon0) - TAU) < 1e-6
        cols = seg if full else seg + 1
        rows = []
        for j in range(1, rings):
            lat = -math.pi / 2 + math.pi * j / rings
            ring = []
            for i in range(cols):
                lon = lon0 + (lon1 - lon0) * i / seg
                ring.append(g.v(rx * math.cos(lat) * math.sin(lon), ry * math.sin(lat), rz * math.cos(lat) * math.cos(lon)))
            rows.append(ring)
        bot = g.v(0, -ry, 0)
        top = g.v(0, ry, 0)
        for i in range(seg):
            a, b = i, (i + 1) % cols
            g.face([rows[0][a], rows[0][b], bot], smooth)
            g.face([rows[-1][b], rows[-1][a], top], smooth)
            for j in range(len(rows) - 1):
                g.face([rows[j][a], rows[j + 1][a], rows[j + 1][b], rows[j][b]], smooth)
        return g

    def pleat_lathe(profile, seg=32, pleats=9, amp=0.14, twist=1.6, phase=0.0, a0=-math.pi / 2, a1=math.pi / 2):
        """A robe: lathe whose radius carries `pleats` folds around the figure. The folds are deepest at the hem (profile start) and fade toward
        the end, and they twist with height so they hang like cloth, not like a fluted column."""
        g = Geo()
        full = abs((a1 - a0) - TAU) < 1e-6
        cols = seg if full else seg + 1
        rows = []
        n = len(profile)
        for i in range(cols):
            a = a0 + (a1 - a0) * i / seg
            ring = []
            for k, (r, y) in enumerate(profile):
                t = k / max(1, n - 1)
                fold = amp * (1.0 - 0.75 * t) * (0.55 + 0.45 * math.cos(pleats * a + phase + twist * t))
                rr = r * (1.0 + fold - amp * 0.4)
                ring.append(g.v(rr * math.sin(a), y, rr * math.cos(a)))
            rows.append(ring)
        for i in range(seg):
            A = rows[i]
            B = rows[(i + 1) % cols] if full else rows[i + 1]
            for k in range(n - 1):
                g.face([A[k], B[k], B[k + 1], A[k + 1]], True)
        if not full:  # the flat back (the wall side)
            back = [rows[0][k] for k in range(n)] + [rows[-1][k] for k in reversed(range(n))]
            g.face(back)
        return g

    def ring_tube(cx, cy, cz, r, a0, a1, rad, sides=5, n=12, plane="xz", wob=0.0):
        pts = []
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            w = 1.0 + wob * math.sin(a * 5)
            if plane == "xz":
                pts.append((cx + r * w * math.sin(a), cy, cz + r * w * math.cos(a)))
            else:
                pts.append((cx + r * w * math.cos(a), cy + r * w * math.sin(a), cz))
        return tube(pts, [rad] * len(pts), sides=sides, smooth=True, cap=False)

    # ---- the head ---------------------------------------------------------------------------------------------------
    def head(s, hood=True, grim=1.0):
        """A hooded head, unit radius scaled by s, face toward +z, origin at the skull's centre."""
        g = Geo()
        g.add(ell(0.82, 1.0, 0.9, seg=12, rings=8))
        # brow ridge: a heavy bar over two deep-set eyes, closed eyelids under it
        brow = [(sx * 0.62 * math.sin(t), 0.3 + 0.05 * math.cos(t * 2.0), 0.55 + 0.34 * math.cos(t)) for t in (-1.2, -0.8, -0.4, 0.0, 0.4, 0.8, 1.2) for sx in (1,)]
        g.add(tube(brow, [0.1, 0.12, 0.13, 0.14, 0.13, 0.12, 0.1], sides=5, cap=False))
        for sx in (-1, 1):
            g.add(ell(0.2, 0.09, 0.12, seg=8, rings=4), xf(tx=sx * 0.34, ty=0.12, tz=0.78, rz=-sx * 0.12))
            g.add(ell(0.18, 0.08, 0.1, seg=8, rings=4), xf(tx=sx * 0.34, ty=0.0, tz=0.76))  # the bag under the eye
            g.add(ell(0.21, 0.19, 0.17, seg=8, rings=5), xf(tx=sx * 0.5, ty=-0.12, tz=0.62))  # cheekbone
            g.add(ell(0.11, 0.09, 0.1, seg=6, rings=4), xf(tx=sx * 0.12, ty=-0.27, tz=0.92))  # nostril wing
        # nose: a ridge down from the brow to a blunt tip
        g.add(tube([(0, 0.26, 0.82), (0, 0.06, 0.9), (0, -0.12, 1.02), (0, -0.24, 1.04)], [0.09, 0.1, 0.11, 0.09], sides=5, cap=True))
        # mouth: two lips, drawn down at the corners
        g.add(tube([(-0.3, -0.42, 0.74), (-0.14, -0.5, 0.86), (0.0, -0.5, 0.9), (0.14, -0.5, 0.86), (0.3, -0.42, 0.74)],
                   [0.04, 0.07, 0.075, 0.07, 0.04], sides=5, cap=False))
        g.add(tube([(-0.25, -0.57, 0.76), (-0.1, -0.62, 0.86), (0.0, -0.63, 0.88), (0.1, -0.62, 0.86), (0.25, -0.57, 0.76)],
                   [0.04, 0.08, 0.085, 0.08, 0.04], sides=5, cap=False))
        g.add(ell(0.24, 0.2, 0.2, seg=8, rings=5), xf(ty=-0.8, tz=0.78))  # chin
        g.add(ell(0.64, 0.4, 0.62, seg=10, rings=5), xf(ty=-0.5, tz=0.4))  # jaw
        if hood:
            # the cowl: an open shell round the back and sides, a rolled front edge, folds, a pointed peak
            g.add(ell(1.18 * grim, 1.34, 1.2, seg=14, rings=8, lon0=math.radians(52), lon1=math.radians(308)), xf(ty=0.1, tz=-0.2))
            edge = [(1.14 * math.sin(a), 0.1 + 1.28 * math.cos(a * 0.9) * 0.62 + 0.3, 0.76 * math.cos(a) - 0.24) for a in [math.radians(v) for v in range(50, 311, 20)]]
            edge = [(x, y, z) for (x, y, z) in edge]
            g.add(tube(edge, [0.14] * len(edge), sides=5, cap=False))
            for k in range(7):
                a = math.radians(70 + k * 36)
                pts = [(1.2 * math.sin(a), 1.25 - 0.1 * k, 1.1 * math.cos(a) - 0.2), (1.28 * math.sin(a), 0.4, 1.18 * math.cos(a) - 0.2), (1.18 * math.sin(a), -0.5, 1.0 * math.cos(a) - 0.2)]
                g.add(tube(pts, [0.05, 0.07, 0.05], sides=4, cap=True))
            g.add(cone(0.34, 0.9, seg=8, y0=1.25), xf(ty=0.0, tz=-0.55, rx=-0.55))  # the peak falls back
        return g.transformed(xf(s=(s, s, s)))

    # ---- the hand ---------------------------------------------------------------------------------------------------
    def hand(w, curl=0.9):
        """A hand of palm width w, fingers pointing +z, thumb toward +x; origin at the wrist, palm facing -y."""
        g = Geo()
        g.add(ell(w * 0.5, w * 0.16, w * 0.55, seg=8, rings=4), xf(tz=w * 0.5))
        lens = (0.95, 1.1, 1.0, 0.75)
        for k in range(4):
            x = (k - 1.5) * w * 0.24
            L = w * 0.62 * lens[k]
            p0 = (x, 0.0, w * 0.95)
            p1 = (x, -L * 0.34 * math.sin(curl * 0.5), w * 0.95 + L * 0.5)
            p2 = (x, -L * 0.8 * math.sin(curl), w * 0.95 + L * 0.5 + L * 0.35 * math.cos(curl))
            p3 = (x, -L * 1.1 * math.sin(curl), w * 0.95 + L * 0.5 + L * 0.5 * math.cos(curl) - L * 0.1)
            g.add(tube([p0, p1, p2, p3], [w * 0.1, w * 0.088, w * 0.075, w * 0.06], sides=4, cap=True))
        g.add(tube([(w * 0.45, 0.0, w * 0.3), (w * 0.62, -w * 0.12, w * 0.6), (w * 0.52, -w * 0.28, w * 0.8)], [w * 0.14, w * 0.1, w * 0.08], sides=4, cap=True))
        g.add(tube([(0, 0, -w * 0.05), (0, 0, w * 0.2)], [w * 0.2, w * 0.26], sides=6, cap=False))  # the wrist
        return g

    def lantern(r, h, ring_up=True):
        """A caged lamp (dead): ring, three chain links, base plate, six ribs, a cap and a finial; origin at the top of the cage."""
        g = Geo()
        g.add(ring_tube(0, r * 1.3, 0, r * 0.55, 0.0, TAU, r * 0.1, sides=4, n=10, plane="xy"))
        g.add(cone(r * 1.15, r * 0.9, seg=6, y0=0.0), xf())
        g.add(tube([(0, r * 0.9, 0), (0, r * 1.2, 0)], [r * 0.12, r * 0.08], sides=4, cap=True))
        for k in range(6):
            a = TAU * k / 6
            g.add(tube([(math.sin(a) * r * 1.0, 0.0, math.cos(a) * r * 1.0), (math.sin(a) * r * 1.1, -h * 0.5, math.cos(a) * r * 1.1), (math.sin(a) * r * 0.9, -h, math.cos(a) * r * 0.9)],
                       [r * 0.07, r * 0.06, r * 0.07], sides=4, cap=False))
        g.add(lathe([(0.0, -h), (r * 0.95, -h), (r * 1.0, -h - r * 0.18), (r * 0.5, -h - r * 0.3), (0.0, -h - r * 0.34)], seg=6, smooth=False))
        g.add(ell(r * 0.34, r * 0.5, r * 0.34, seg=6, rings=4), xf(ty=-h * 0.55))  # the dead wick
        return g

    # ---- the saint --------------------------------------------------------------------------------------------------
    def part_saint():
        g = Geo()
        # bracket it stands on, with a stepped moulding and a drip
        g.add(loft_rect([(0.0, -0.04, 0.04, 0.0, 0.04), (0.05, -0.1, 0.1, 0.0, 0.15), (0.085, -0.14, 0.14, 0.0, 0.2), (0.1, -0.14, 0.14, 0.0, 0.2)]))
        for y, w, d in ((0.035, 0.11, 0.17), (0.07, 0.125, 0.19)):
            g.add(box(-w, y, 0.0, w, y + 0.012, d))
        # robe: pleated, hem rolled over the bracket
        robe = [(0.0, 0.1), (0.128, 0.1), (0.136, 0.125), (0.12, 0.3), (0.104, 0.47), (0.094, 0.58), (0.102, 0.64), (0.09, 0.69), (0.05, 0.72)]
        g.add(pleat_lathe(robe, seg=40, pleats=9, amp=0.26, twist=1.5), xf(tz=0.015))
        g.add(ring_tube(0.0, 0.108, 0.015, 0.132, -math.pi / 2, math.pi / 2, 0.016, sides=5, n=16, wob=0.03))
        # a second fold layer: a mantle over the shoulders with a hanging edge
        g.add(pleat_lathe([(0.1, 0.6), (0.122, 0.6), (0.128, 0.66), (0.1, 0.7), (0.05, 0.725)], seg=24, pleats=5, amp=0.12, phase=1.0, a0=-math.pi * 0.62, a1=math.pi * 0.62), xf(tz=0.02))
        # rope belt, knot and two hanging tails
        g.add(ring_tube(0.0, 0.46, 0.015, 0.1, -math.pi / 2, math.pi / 2, 0.012, sides=5, n=14, wob=0.02))
        g.add(ell(0.02, 0.02, 0.02, seg=6, rings=4), xf(tx=0.03, ty=0.455, tz=0.118))
        for sx, L in ((0.025, 0.2), (0.045, 0.15)):
            g.add(tube([(sx, 0.45, 0.12), (sx + 0.006, 0.4, 0.128), (sx - 0.004, 0.34, 0.124), (sx + 0.004, 0.45 - L, 0.12)], [0.009, 0.009, 0.008, 0.012], sides=4, cap=True))
        # head and hood, bowed forward
        g.add(head(0.062), xf(tx=0.0, ty=0.745, tz=0.075, rx=0.32))
        # shoulders and sleeves; both hands hold the lantern ring
        for sx in (-1, 1):
            g.add(ell(0.05, 0.034, 0.05, seg=8, rings=5), xf(tx=sx * 0.092, ty=0.655, tz=0.03))
            pts = [(sx * 0.1, 0.63, 0.035), (sx * 0.118, 0.54, 0.09), (sx * 0.085, 0.475, 0.16), (sx * 0.045, 0.462, 0.19)]
            g.add(tube(pts, [0.034, 0.034, 0.032, 0.03], sides=6, cap=False))
            g.add(tube([(sx * 0.1, 0.62, 0.04), (sx * 0.116, 0.54, 0.095), (sx * 0.1, 0.5, 0.15)], [0.04, 0.045, 0.05], sides=6, cap=False))  # the hanging sleeve
            g.add(tube([(sx * 0.046, 0.462, 0.19), (sx * 0.04, 0.46, 0.2)], [0.032, 0.026], sides=6, cap=False))  # cuff
            g.add(hand(0.034, curl=1.0), xf(tx=sx * 0.034, ty=0.456, tz=0.205, ry=-sx * 0.35, rx=0.2, rz=sx * 0.2))
        # the lantern
        g.add(lantern(0.034, 0.075), xf(tx=0.0, ty=0.4, tz=0.205))
        # niche: two slender shafts with bases and capitals, a pointed hood moulding with crockets, a gabled roof and a pinnacle
        for sx in (-1, 1):
            g.add(box(sx * 0.17 - 0.014, 0.1, 0.0, sx * 0.17 + 0.014, 0.82, 0.035))
            g.add(box(sx * 0.17 - 0.024, 0.8, 0.0, sx * 0.17 + 0.024, 0.83, 0.05))
            g.add(box(sx * 0.17 - 0.022, 0.1, 0.0, sx * 0.17 + 0.022, 0.125, 0.045))
            g.add(box(sx * 0.17 - 0.019, 0.45, 0.0, sx * 0.17 + 0.019, 0.465, 0.042))
        pts = pointed_arch_pts(0.36, 0.2, n=6)
        prev = None
        for (x, y) in pts:
            p = (x, 0.82 + y, 0.0)
            if prev:
                dx, dy = p[0] - prev[0], p[1] - prev[1]
                L = math.hypot(dx, dy)
                a = math.atan2(dy, dx)
                g.add(box(-L / 2 - 0.006, -0.016, 0.0, L / 2 + 0.006, 0.016, 0.06), xf(rz=a, tx=(p[0] + prev[0]) / 2, ty=(p[1] + prev[1]) / 2))
                g.add(cone(0.011, 0.034, seg=4, y0=0.0), xf(rz=a - math.pi / 2, tx=(p[0] + prev[0]) / 2, ty=(p[1] + prev[1]) / 2 + 0.012, tz=0.055))  # a crocket
            prev = p
        for sx in (-1, 1):
            L = math.hypot(0.2, 0.2)
            g.add(box(-L / 2, -0.01, 0.0, L / 2, 0.01, 0.12), xf(rz=-sx * math.pi / 4, tx=sx * 0.1, ty=1.08))
            for k in range(3):
                g.add(cone(0.012, 0.04, seg=4, y0=0.0), xf(tx=sx * (0.03 + 0.05 * k), ty=1.0 + 0.045 * (2 - k), tz=0.125, rz=-sx * math.pi / 4))
        g.add(cone(0.03, 0.12, seg=4, y0=1.16), xf(tz=0.04, ry=math.pi / 4))
        g.add(ell(0.018, 0.018, 0.018, seg=6, rings=4), xf(ty=1.29, tz=0.04))
        return g

    # ---- the atlas figure under the slab ------------------------------------------------------------------------------
    def part_corbel_figure():
        g = Geo()
        g.add(box(-0.5, -0.16, 0.0, 0.5, 0.0, 0.85))
        g.add(box(-0.52, -0.2, 0.0, 0.52, -0.16, 0.88))  # the slab's lip
        robe = [(0.02, -2.1), (0.12, -1.95), (0.24, -1.7), (0.33, -1.35), (0.38, -1.0), (0.38, -0.8)]
        g.add(pleat_lathe(robe, seg=40, pleats=8, amp=0.2, twist=1.8, phase=0.4), xf())
        g.add(ring_tube(0.0, -1.97, 0.0, 0.13, -math.pi / 2, math.pi / 2, 0.035, sides=5, n=12, wob=0.05))
        chest = [(0.38, -0.8), (0.4, -0.65), (0.36, -0.52), (0.18, -0.46)]
        g.add(pleat_lathe(chest, seg=24, pleats=5, amp=0.1, phase=1.2))
        # rope belt, a hanging lantern on it
        g.add(ring_tube(0.0, -1.18, 0.0, 0.365, -math.pi / 2, math.pi / 2, 0.03, sides=5, n=16, wob=0.02))
        g.add(ell(0.06, 0.06, 0.06, seg=6, rings=4), xf(tx=0.1, ty=-1.16, tz=0.37))
        g.add(tube([(0.1, -1.18, 0.37), (0.12, -1.3, 0.4), (0.1, -1.5, 0.38)], [0.03, 0.028, 0.03], sides=4, cap=True))
        g.add(lantern(0.1, 0.22), xf(tx=0.0, ty=-1.04, tz=0.45))
        # head, bowed forward under the load
        g.add(head(0.21), xf(tx=0.0, ty=-0.53, tz=0.33, rx=0.5))
        # arms raised to the slab corners, sleeves with cuffs, hands flat under it
        for sx in (-1, 1):
            pts = [(sx * 0.34, -0.72, 0.26), (sx * 0.44, -0.52, 0.34), (sx * 0.45, -0.3, 0.4), (sx * 0.38, -0.17, 0.5)]
            g.add(tube(pts, [0.12, 0.11, 0.1, 0.09], sides=7, cap=False))
            g.add(tube([(sx * 0.4, -0.5, 0.36), (sx * 0.5, -0.3, 0.42), (sx * 0.46, -0.2, 0.5)], [0.1, 0.12, 0.12], sides=6, cap=False))
            g.add(ell(0.1, 0.08, 0.1, seg=8, rings=4), xf(tx=sx * 0.36, ty=-0.62, tz=0.24))  # shoulder
            g.add(hand(0.15, curl=0.5), xf(tx=sx * 0.36, ty=-0.175, tz=0.45, rx=-math.pi / 2, ry=0.0, rz=0.0))
        return g

    # ---- the hero corbel: the old carving plus a grotesque and fuller foliage ------------------------------------------
    def part_corbel_hero():
        g = Geo()
        g.add(old_hero())
        # a grotesque on the front tier: a face grinning out of the stone, tongue out
        g.add(head(0.19, hood=False), xf(tx=0.0, ty=-1.02, tz=0.6, rx=-0.35))
        # acanthus lobes: a toothed edge on every leaf
        for k in range(4):
            t = k / 3
            y = -1.55 + 0.7 * t
            z = 0.2 + 0.45 * t
            for sx in (-1, 1):
                for lob in range(4):
                    u = lob / 3
                    p = (sx * (0.08 + 0.2 * u), y + 0.02 + 0.17 * u, z + 0.09)
                    g.add(cone(0.035, 0.1, seg=4, y0=0.0), xf(tx=p[0], ty=p[1], tz=p[2] + 0.02, rz=-sx * (0.8 + 0.4 * u), rx=-0.3))
        # egg-and-dart under the top slab
        for i in range(11):
            x = -0.5 + (i + 0.5) * 0.09
            g.add(ell(0.025, 0.034, 0.03, seg=6, rings=4), xf(tx=x, ty=-0.145, tz=1.04))
        return g

    return {"ch1_env_saint": part_saint, "ch1_env_corbel_figure": part_corbel_figure, "ch1_env_corbel_hero": part_corbel_hero}


def replace(parts_list, ns):
    """PARTS with the statue builders swapped in (name, material, builder, options)."""
    new = parts(ns)
    out = []
    for name, mat, fn, opts in parts_list:
        if name in new:
            opts = dict(opts)
            opts["edge"] = 0.03
            opts["wscale"] = 0.4
        out.append((name, mat, new.get(name, fn), opts))
    return out
