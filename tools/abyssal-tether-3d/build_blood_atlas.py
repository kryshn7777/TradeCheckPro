"""ABYSSAL TETHER 3D - the blood decal atlas (numpy + PIL only; deterministic, seed 4471).

public/abyssal-tether-3d/assets/textures/blood_atlas.png: RGBA 1024 x 1024, a 4 x 4 grid of 256 px cells of OLD, DRIED blood on stone:
arterial sprays and impact splatters (radial, with satellite droplets and exclamation tails), pooled puddles with a darker core and
a coffee-ring rim, long drag smears (a body dragged), a left and a right handprint with smeared fingers, finger-drawn streaks running
down the wall, drip clusters with runs. Dark red-brown (#8a1515 at the thin edges -> #4a0909 in the thick core), irregular organic
edges, a soft alpha falloff at the edge (reads as a dried, slightly glossy film).

Alpha is STRAIGHT (not premultiplied) and the colour of every transparent texel is the dilated blood colour, so linear filtering,
mipmaps and a later premultiply never pull a dark or white fringe in. Each cell keeps an 8 px transparent margin (mip-safe to ~level 3).
blood_atlas.json next to it: the cells (name, pixel rect x, y, w, h, uv rect, the recommended world size in metres, a note).

Run: python3 tools/abyssal-tether-3d/build_blood_atlas.py [--out <dir>] [--preview <png>]
"""

import argparse
import json
import math
import os

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ap.add_argument("--out", default=os.path.join(REPO, "public", "abyssal-tether-3d", "assets", "textures"))
ap.add_argument("--preview", default=os.path.join(HERE, "previews", "blood_atlas_preview.png"))
args = ap.parse_args()

SEED = 4471
CELL = 256
SS = 2                      # supersampling
N = CELL * SS
MARGIN = 8 * SS


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def vnoise2(X, Y, freq, seed):
    x, y = X * freq + seed * 0.731, Y * freq + seed * 0.317
    ix, iy = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

    def h(i, j):
        v = (i * 374761393 + j * 668265263 + seed * 974634511) & 0xFFFFFFFF
        v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((v ^ (v >> 16)) & 0xFFFFFF) / float(0xFFFFFF)
    a, b, c, d = h(ix, iy), h(ix + 1, iy), h(ix, iy + 1), h(ix + 1, iy + 1)
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy


def fbm2(X, Y, freq, seed, oct=4):
    s, a, t = 0.0, 1.0, 0.0
    for o in range(oct):
        s = s + a * vnoise2(X, Y, freq * 2.07 ** o, seed + 13 * o)
        t += a
        a *= 0.5
    return s / t


# cell coordinates: u, v in [-1, 1], v DOWN (image rows), so "down the wall" is +v
_c = (np.arange(N) + 0.5) / N * 2 - 1
U, Vv = np.meshgrid(_c, _c)


def blob(cx, cy, r, sx=1.0, sy=1.0, ang=0.0):
    ca, sa = math.cos(ang), math.sin(ang)
    x, y = U - cx, Vv - cy
    xr, yr = (ca * x + sa * y) / sx, (-sa * x + ca * y) / sy
    return np.exp(-(xr * xr + yr * yr) / (r * r))


def capsule(ax, ay, bx, by, ra, rb=None):
    rb = ra if rb is None else rb
    px, py = U - ax, Vv - ay
    bx2, by2 = bx - ax, by - ay
    t = np.clip((px * bx2 + py * by2) / (bx2 * bx2 + by2 * by2 + 1e-12), 0, 1)
    dx, dy = px - t * bx2, py - t * by2
    r = ra + (rb - ra) * t
    return np.exp(-(dx * dx + dy * dy) / (r * r)), t


def drop(cx, cy, r, dirx, diry, tail):
    """an exclamation droplet: a bead + a tail pointing BACK to the source."""
    f = blob(cx, cy, r)
    if tail > 0:
        c, _ = capsule(cx, cy, cx - dirx * tail, cy - diry * tail, r * 0.75, r * 0.15)
        f = np.maximum(f, c)
    return f


def warp(f_fn, amp, freq, seed):
    """domain-warp a field function of (U, V)."""
    global U, Vv
    u0, v0 = U, Vv
    U = u0 + amp * (fbm2(u0, v0, freq, seed) - 0.5)
    Vv = v0 + amp * (fbm2(u0, v0, freq, seed + 5) - 0.5)
    f = f_fn()
    U, Vv = u0, v0
    return f


# ---------------------------------------------------------------------------------------------------------------------
def spray(seed, ang, spread, n, power):
    rng = np.random.default_rng(SEED + seed)
    ox, oy = -math.cos(ang) * 0.55, -math.sin(ang) * 0.55
    f = warp(lambda: blob(ox, oy, 0.2, 1.25, 0.9, ang) * 1.6, 0.25, 3.0, seed)
    for i in range(n):
        a = ang + rng.normal() * spread
        dist = 0.18 + rng.random() ** 0.7 * 1.05 * power
        cx, cy = ox + math.cos(a) * dist, oy + math.sin(a) * dist
        r = 0.012 + 0.05 * (1 - dist / 1.3) * rng.random() ** 1.5
        tail = r * (1.5 + 4 * rng.random()) * (dist > 0.35)
        f = np.maximum(f, drop(cx, cy, r, math.cos(a), math.sin(a), tail) * (1.1 + 0.6 * rng.random()))
    # an arterial arc: a line of beads
    for k in range(18):
        t = k / 17
        a = ang + (t - 0.5) * 0.9
        dd = 0.35 + 0.45 * t + 0.05 * math.sin(t * 17)
        f = np.maximum(f, blob(ox + math.cos(a) * dd, oy + math.sin(a) * dd, 0.025 + 0.02 * rng.random()) * 1.3)
    return f


def splatter(seed):
    rng = np.random.default_rng(SEED + seed)
    f = warp(lambda: blob(0, 0, 0.3) * 1.7, 0.35, 2.5, seed)
    for i in range(70):
        a = rng.random() * 2 * math.pi
        d = 0.25 + rng.random() ** 0.6 * 0.68
        r = 0.01 + 0.035 * rng.random() ** 2 * (1.2 - d)
        f = np.maximum(f, drop(math.cos(a) * d, math.sin(a) * d, r, math.cos(a), math.sin(a), r * 3 * rng.random()) * 1.3)
    for i in range(12):                       # spikes
        a = rng.random() * 2 * math.pi
        c, _ = capsule(math.cos(a) * 0.2, math.sin(a) * 0.2, math.cos(a) * (0.4 + 0.2 * rng.random()), math.sin(a) * (0.4 + 0.2 * rng.random()), 0.05, 0.01)
        f = np.maximum(f, c * 1.2)
    return f


def fine_spatter(seed):
    rng = np.random.default_rng(SEED + seed)
    f = np.zeros_like(U)
    for i in range(160):
        x, y = rng.normal() * 0.38, rng.normal() * 0.38
        if abs(x) > 0.88 or abs(y) > 0.88:
            continue
        r = 0.006 + 0.022 * rng.random() ** 3
        f = np.maximum(f, blob(x, y, r) * (1.0 + rng.random()))
    return f


def pool(seed, k, size):
    rng = np.random.default_rng(SEED + seed)
    f = np.zeros_like(U)

    def body():
        g = np.zeros_like(U)
        for i in range(k):
            g = g + blob(rng.normal() * 0.18 * size, rng.normal() * 0.14 * size, (0.3 + 0.15 * rng.random()) * size, 1.0 + 0.4 * rng.random(), 1.0, rng.random() * 3)
        return g
    f = warp(body, 0.3 * size, 3.0, seed) * 1.6
    # a few satellite drips round the rim
    for i in range(10):
        a = rng.random() * 2 * math.pi
        d = (0.55 + 0.3 * rng.random()) * size + 0.05
        f = np.maximum(f, blob(math.cos(a) * d, math.sin(a) * d, 0.02 + 0.025 * rng.random()) * 1.2)
    return f


def drag(seed, curve):
    """a wide smear dragged left -> right (the long axis is u)."""
    rng = np.random.default_rng(SEED + seed)
    yc = curve * (U ** 2 - 0.3) + 0.04 * np.sin(U * 4 + seed)
    width = 0.22 * (1.05 - 0.45 * sstep(-0.9, 0.95, U)) * (0.85 + 0.3 * fbm2(U, U, 2.0, seed))
    dy = np.abs(Vv - yc) / width
    streak = fbm2(U * 0.15, Vv * 7.0, 6.0, seed + 3)                   # streaky along the drag
    f = np.exp(-dy ** 4 * 1.2) * (0.5 + 1.2 * streak) * (1.35 - 0.75 * sstep(-0.95, 0.92, U))
    f = f * sstep(-0.98, -0.8, U) * (1 - sstep(0.82, 0.96, U + 0.05 * fbm2(U, Vv, 8.0, seed)))
    # the heavy start (where it began) and dribbles along the edges
    f = np.maximum(f, blob(-0.72, curve * 0.2 - 0.3 * curve, 0.2, 1.0, 1.3) * 1.5)
    for i in range(14):
        x = -0.7 + 1.5 * rng.random()
        y = curve * (x * x - 0.3) + (0.22 + 0.06 * rng.random()) * (1 if rng.random() < 0.5 else -1) * (1.05 - 0.45 * (x + 0.9) / 1.85)
        f = np.maximum(f, blob(x, y, 0.012 + 0.02 * rng.random()) * 1.2)
    return f


def handprint(seed, mirror):
    """a palm + four fingers + thumb, fingers smeared downwards, patchy skin contact. Fingers up (-v)."""
    rng = np.random.default_rng(SEED + seed)
    s = -1 if mirror else 1
    f = blob(0.0, 0.24, 0.3, 0.92, 1.0) * 1.6                              # palm
    f = np.maximum(f, blob(-0.04 * s, 0.02, 0.24, 1.1, 0.6) * 1.5)          # the pads under the fingers
    f = f * (0.6 + 0.8 * fbm2(U, Vv, 7.0, seed))                           # creases / patchy contact
    crease, _ = capsule(-0.24 * s, 0.14, 0.2 * s, 0.24, 0.018)
    f = f * (1 - 0.45 * crease)
    fingers = [(-0.2, 0.5), (-0.07, 0.6), (0.06, 0.56), (0.18, 0.43)]
    for i, (x, l) in enumerate(fingers):
        bx, by = x * s, -0.02
        tx, ty = x * s * 1.3, by - l
        c, t = capsule(bx, by, tx, ty, 0.062, 0.052)
        seg = 0.85 + 0.3 * np.abs(np.sin(t * 3.0 * math.pi + 0.4))         # faint knuckle gaps
        f = np.maximum(f, c * seg * 1.35)
        # the smear: each finger dragged down a little
        sm, ts = capsule(tx, ty + 0.05, tx + 0.02 * s, ty + 0.25 + 0.15 * rng.random(), 0.045, 0.03)
        f = np.maximum(f, sm * (0.95 - 0.5 * ts) * (0.6 + 0.6 * fbm2(U * 4, Vv * 0.5, 9.0, seed + i)))
    c, t = capsule(0.2 * s, 0.34, 0.5 * s, 0.02, 0.085, 0.06)             # thumb
    f = np.maximum(f, c * 1.3)
    # a heel-of-the-hand smear running down
    sm, ts = capsule(0.0, 0.5, 0.05 * s, 0.9, 0.18, 0.05)
    f = np.maximum(f, sm * (0.9 - 0.6 * ts) * (0.5 + 0.8 * fbm2(U * 5, Vv * 0.6, 7.0, seed + 9)))
    return f


def finger_streaks(seed):
    rng = np.random.default_rng(SEED + seed)
    f = np.zeros_like(U)
    for i in range(4):
        x0 = -0.42 + 0.27 * i + 0.04 * rng.normal()
        y0 = -0.85 + 0.1 * rng.random()
        l = 1.1 + 0.5 * rng.random()
        ys = np.clip((Vv - y0) / l, 0, 1)
        xc = x0 + 0.05 * np.sin(ys * 3 + i) + 0.04 * ys
        w = 0.055 * (1 - 0.65 * ys)
        stroke = np.exp(-((U - xc) / w) ** 4) * (Vv > y0 - 0.03) * (1 - sstep(0.75, 1.0, ys)) * (1.45 - 0.9 * ys)
        stroke = stroke * (0.55 + 0.8 * fbm2(U * 3, Vv * 0.4, 9.0, seed + i))
        f = np.maximum(f, stroke)
        f = np.maximum(f, blob(x0, y0 + 0.02, 0.06) * 1.4)               # the dab where the finger started
        # runs off the ends
        for k in range(2):
            rx = x0 + 0.04 * ys.max() + 0.03 * rng.normal()
            ry0 = y0 + l * (0.55 + 0.3 * rng.random())
            c, t = capsule(rx, ry0, rx + 0.01, min(0.9, ry0 + 0.25 + 0.2 * rng.random()), 0.016, 0.01)
            f = np.maximum(f, c * 1.1)
            f = np.maximum(f, blob(rx + 0.01, min(0.9, ry0 + 0.27), 0.022) * 1.3)
    return f


def drips(seed, n, top):
    rng = np.random.default_rng(SEED + seed)
    f = np.zeros_like(U)
    for i in range(n):
        x = (rng.random() - 0.5) * 1.5
        y = top + rng.random() * 0.5
        r = 0.03 + 0.045 * rng.random()
        f = np.maximum(f, warp(lambda: blob(x, y, r) * 1.5, 0.05, 8.0, seed + i))
        if rng.random() < 0.75:
            l = 0.2 + 0.7 * rng.random()
            yb = min(0.9, y + l)
            c, t = capsule(x, y, x + 0.02 * rng.normal(), yb, r * 0.4, r * 0.25)
            f = np.maximum(f, c * 1.2)
            f = np.maximum(f, blob(x, yb, r * 0.42) * 1.4)
        for k in range(int(rng.random() * 5)):
            a = rng.random() * 2 * math.pi
            d = r + 0.03 + 0.08 * rng.random()
            f = np.maximum(f, blob(x + math.cos(a) * d, y + math.sin(a) * d, 0.01 + 0.012 * rng.random()) * 1.2)
    return f


def wipe(seed):
    """a palm wiped sideways down the stone: a curved arc of four finger tracks."""
    rng = np.random.default_rng(SEED + seed)
    f = np.zeros_like(U)
    for i in range(4):
        off = (i - 1.5) * 0.11
        ts = np.linspace(0, 1, 40)
        for t in ts:
            x = -0.65 + 1.25 * t
            y = -0.35 + 0.55 * t * t + off
            w = 0.045 * (1 - 0.6 * t)
            f = np.maximum(f, blob(x, y, w) * (1.4 - 0.9 * t))
    f = f * (0.5 + 0.9 * fbm2(U * 0.6, Vv * 3, 8.0, seed))
    f = np.maximum(f, blob(-0.66, -0.36, 0.17, 1.0, 1.4) * 1.3)
    return f


CELLS = [
    ("spray_arterial", lambda: spray(1, 0.15, 0.22, 90, 1.0), "1.4 m", (1.4, 1.4), "arterial spray: source lower left, beads and exclamation tails toward the upper right"),
    ("spray_wide", lambda: spray(2, -0.6, 0.45, 110, 0.9), "1.2 m", (1.2, 1.2), "wide cast-off spray, radial with satellite droplets"),
    ("splatter_impact", lambda: splatter(3), "0.9 m", (0.9, 0.9), "impact splatter: a central stain with spikes and satellites"),
    ("spatter_fine", lambda: fine_spatter(4), "0.6 m", (0.6, 0.6), "fine mist spatter (layer over others)"),
    ("pool_large", lambda: pool(5, 5, 1.15), "1.6 m", (1.6, 1.6), "a dried pool, darker thick core, coffee-ring rim (floor)"),
    ("pool_medium", lambda: pool(6, 4, 0.95), "1.0 m", (1.0, 1.0), "a smaller pool (floor, under remains)"),
    ("pool_seep", lambda: pool(7, 3, 0.7), "0.7 m", (0.7, 0.7), "a seep / soak stain (floor, wall foot)"),
    ("drips_cluster", lambda: drips(8, 9, -0.85), "0.5 m", (0.5, 0.5), "drip cluster with short runs (wall: v points down)"),
    ("drag_long", lambda: drag(9, 0.18), "2.2 x 0.5 m", (2.2, 0.55), "a body dragged left -> right: heavy start, streaky, thinning out (floor; stretch the quad 4:1)"),
    ("drag_curved", lambda: drag(10, -0.3), "2.0 x 0.6 m", (2.0, 0.6), "a curved drag (floor; stretch 3.3:1)"),
    ("handprint_left", lambda: handprint(11, False), "0.18 m", (0.18, 0.18), "left hand, fingers up, smeared down (wall)"),
    ("handprint_right", lambda: handprint(12, True), "0.18 m", (0.18, 0.18), "right hand, fingers up, smeared down (wall)"),
    ("finger_streaks", lambda: finger_streaks(13), "0.6 m", (0.45, 0.6), "four fingers drawn down the wall with runs (wall: v points down)"),
    ("drips_runs", lambda: drips(14, 6, -0.9), "0.8 m", (0.5, 0.8), "a few heavy drops running far down (wall)"),
    ("drips_small", lambda: drips(15, 14, -0.6), "0.3 m", (0.3, 0.3), "small drip spatter (anywhere)"),
    ("wipe_palm", lambda: wipe(16), "0.7 m", (0.7, 0.5), "a palm wiped sideways and down (wall)"),
]

EDGE = np.array([0x8a, 0x15, 0x15]) / 255.0
MID = np.array([0x6e, 0x10, 0x10]) / 255.0
CORE = np.array([0x4a, 0x0a, 0x09]) / 255.0


def shade(f, seed):
    """density -> straight RGBA (float). Thin film = red, low alpha; thick = dark; a darker ring at the dried edge."""
    n = fbm2(U, Vv, 14.0, seed + 99)
    e = f + 0.18 * (n - 0.5)
    a = sstep(0.42, 0.62, e)
    film = sstep(0.42, 0.95, e)
    alpha = a * (0.55 + 0.4 * film + 0.05 * sstep(1.0, 1.6, e))
    thick = sstep(0.75, 1.7, e)
    rgb = EDGE[None, None] * (1 - film[..., None]) + MID[None, None] * film[..., None]
    rgb = rgb * (1 - thick[..., None]) + CORE[None, None] * thick[..., None]
    ring = np.exp(-((e - 0.58) / 0.07) ** 2) * 0.35
    rgb = rgb * (1 - ring[..., None])
    rgb = rgb * (0.88 + 0.24 * fbm2(U, Vv, 30.0, seed + 7)[..., None])           # mottling of the dried film
    # margin
    m = np.ones_like(f)
    edge = MARGIN / N * 2
    m *= sstep(-1 + edge * 0.5, -1 + edge * 1.6, U) * sstep(-1 + edge * 0.5, -1 + edge * 1.6, -U)
    m *= sstep(-1 + edge * 0.5, -1 + edge * 1.6, Vv) * sstep(-1 + edge * 0.5, -1 + edge * 1.6, -Vv)
    alpha = alpha * m
    return np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)


def downsample(rgb, a):
    pm = rgb * a[..., None]
    pm = pm.reshape(CELL, SS, CELL, SS, 3).mean((1, 3))
    a2 = a.reshape(CELL, SS, CELL, SS).mean((1, 3))
    rgb2 = np.where(a2[..., None] > 1e-4, pm / np.maximum(a2[..., None], 1e-4), EDGE * 0.8)
    return rgb2, a2


def main():
    atlas = np.zeros((1024, 1024, 4), dtype=np.float64)
    meta = {"image": "blood_atlas.png", "size": [1024, 1024], "grid": [4, 4], "cell": CELL, "alpha": "straight (RGB dilated under alpha 0)",
            "colour": "sRGB, #8a1515 thin edges -> #4a0a09 thick core", "v_down": "image rows run DOWN: for wall decals, v+ is down the wall",
            "cells": []}
    for i, (name, fn, size_txt, size_m, note) in enumerate(CELLS):
        f = fn()
        rgb, a = shade(f, 100 + i)
        rgb, a = downsample(rgb, a)
        cx, cy = (i % 4) * CELL, (i // 4) * CELL
        atlas[cy:cy + CELL, cx:cx + CELL, :3] = rgb
        atlas[cy:cy + CELL, cx:cx + CELL, 3] = a
        meta["cells"].append({"index": i, "name": name, "rect": [cx, cy, CELL, CELL],
                              "uv": [cx / 1024, 1 - (cy + CELL) / 1024, (cx + CELL) / 1024, 1 - cy / 1024],
                              "world_size": size_txt, "world_size_m": list(size_m), "note": note})
        print(f"  {i:2d} {name:16s} coverage {float((a > 0.05).mean()):.2f}")
    # dilate colour under transparent texels: the blood edge colour everywhere alpha is 0
    rgb = atlas[..., :3]
    a = atlas[..., 3]
    rgb[a < 0.02] = EDGE * 0.8
    img = Image.fromarray((np.concatenate([rgb, a[..., None]], -1) * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGBA")
    os.makedirs(args.out, exist_ok=True)
    p = os.path.join(args.out, "blood_atlas.png")
    img.save(p, optimize=True)
    with open(os.path.join(args.out, "blood_atlas.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print("wrote", p, os.path.getsize(p), "bytes")
    # preview: over a dark stone colour with a little texture, labelled
    from PIL import ImageDraw
    yy, xx = np.mgrid[0:1024, 0:1024] / 1024.0
    stone = 0.11 + 0.05 * fbm2(xx * 2 - 1, yy * 2 - 1, 9.0, 5) + 0.02 * fbm2(xx, yy, 60.0, 6)
    bg = np.stack([stone * 1.0, stone * 0.96, stone * 0.92], -1)
    comp = bg * (1 - a[..., None]) + rgb * a[..., None]
    pv = Image.fromarray((comp * 255).clip(0, 255).astype(np.uint8), "RGB")
    dr = ImageDraw.Draw(pv)
    for c in meta["cells"]:
        x, y = c["rect"][:2]
        dr.rectangle([x, y, x + CELL - 1, y + CELL - 1], outline=(40, 40, 44))
        dr.text((x + 6, y + 4), f"{c['index']} {c['name']} ({c['world_size']})", fill=(190, 185, 175))
    os.makedirs(os.path.dirname(args.preview), exist_ok=True)
    pv.save(args.preview)
    print("preview", args.preview)


main()
