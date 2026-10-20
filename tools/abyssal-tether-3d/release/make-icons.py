#!/usr/bin/env python3
"""ABYSSAL TETHER 3D: app icon generator (original art, no external assets).

Draws the game's own glyph (the phosphor anchor ring, the taut tether and the amber lantern, as in the favicon in
index.html) between two stone piers, with a soft lantern glow, and writes:

  icons/icon-1024.png            1024 master, purpose "any" (rounded corners, transparent outside)
  icons/icon-512.png             512, "any"
  icons/icon-192.png             192, "any"
  icons/icon-maskable-512.png    512, full-bleed opaque, glyph inside the 80% safe zone ("maskable")
  icons/icon-maskable-1024.png   1024 master of the maskable
  icons/favicon-48.png           48
  store icon (opaque 1024) -> docs/abyssal-tether-3d/store/art/icon-1024.png  (--store)

Usage: python3 tools/abyssal-tether-3d/release/make-icons.py [--out public/abyssal-tether-3d/icons] [--store DIR]
Needs Pillow + numpy.
"""
import argparse
import math
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

BG = (8, 9, 10)
PHOSPHOR = (232, 220, 192)
AMBER = (224, 160, 80)
STONE = (42, 47, 49)
CYAN = (111, 163, 181)


def vignette_bg(S):
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    # cold light falling down the shaft from the top centre
    shaft = np.exp(-(((x - 0.5) / 0.22) ** 2)) * np.clip(1.0 - y * 1.25, 0, 1) * 0.55
    # warm pool around the lantern
    cy = 0.66
    d2 = ((x - 0.5) / 0.55) ** 2 + ((y - cy) / 0.5) ** 2
    pool = np.exp(-d2 * 2.2) * 0.9
    base = np.zeros((S, S, 3), np.float32)
    for c in range(3):
        base[..., c] = BG[c] + shaft * CYAN[c] * 0.12 + pool * AMBER[c] * 0.16
    edge = np.clip(1.0 - (((x - 0.5) ** 2 + (y - 0.5) ** 2) ** 0.5) * 1.15, 0.35, 1.0)
    base *= edge[..., None]
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), 'RGB')


def piers(S, scale, off):
    """Two stone piers with course lines, left and right."""
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w = 0.115 * S * scale
    for cx in (0.5 - 0.405 * scale, 0.5 + 0.405 * scale):
        x0, x1 = cx * S - w / 2 + off, cx * S + w / 2 + off
        for i in range(int(S * 1.0)):
            pass
        d.rectangle([x0, -S, x1, 2 * S], fill=STONE + (255,))
        # lit edge facing the middle
        lit = x1 if cx < 0.5 else x0
        d.line([(lit, -S), (lit, 2 * S)], fill=(92, 100, 102, 255), width=max(1, int(S * 0.006)))
        # course lines
        step = S * 0.085 * scale
        yy = (S * 0.03) % step
        while yy < S:
            d.line([(x0, yy), (x1, yy)], fill=(20, 22, 23, 255), width=max(1, int(S * 0.004)))
            yy += step
    return layer


def glow(layer_rgb, radius, gain):
    blurred = layer_rgb.filter(ImageFilter.GaussianBlur(radius))
    arr = np.asarray(blurred).astype(np.float32) * gain
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')


def add(a, b):
    return ImageChops.add(a, b)


def glyph_image(S, scale=1.0):
    """The whole icon art at S x S (opaque RGB)."""
    ss = 2  # supersample
    N = S * ss
    img = vignette_bg(N).convert('RGBA')
    img.alpha_composite(piers(N, scale, 0))

    cx = N / 2
    ring_cy = N * (0.5 - 0.30 * scale)
    ring_r = N * 0.105 * scale
    ring_w = max(2, int(N * 0.028 * scale))
    lamp_cy = N * (0.5 + 0.20 * scale)
    lamp_h = N * 0.155 * scale
    lamp_w = N * 0.105 * scale

    # emissive layer (glow source)
    em = Image.new('RGB', (N, N), (0, 0, 0))
    ed = ImageDraw.Draw(em)
    ed.ellipse([cx - ring_r, ring_cy - ring_r, cx + ring_r, ring_cy + ring_r], outline=PHOSPHOR, width=ring_w)
    ed.line([(cx, ring_cy + ring_r), (cx, lamp_cy - lamp_h)], fill=PHOSPHOR, width=max(2, int(N * 0.011 * scale)))
    diamond = [(cx, lamp_cy - lamp_h), (cx + lamp_w, lamp_cy), (cx, lamp_cy + lamp_h), (cx - lamp_w, lamp_cy)]
    ed.polygon(diamond, fill=AMBER)
    glow_a = glow(em, N * 0.035, 1.2)
    glow_b = glow(em, N * 0.11, 1.4)
    base = img.convert('RGB')
    base = add(base, glow_b.point(lambda v: int(v * 0.55)))
    base = add(base, glow_a.point(lambda v: int(v * 0.5)))

    d = ImageDraw.Draw(base)
    # anchor plate above the ring
    plate_w = N * 0.085 * scale
    d.rectangle([cx - plate_w / 2, ring_cy - ring_r - N * 0.045 * scale, cx + plate_w / 2, ring_cy - ring_r - N * 0.012 * scale], fill=(70, 76, 78))
    # ring + tether crisp on top
    d.ellipse([cx - ring_r, ring_cy - ring_r, cx + ring_r, ring_cy + ring_r], outline=PHOSPHOR, width=ring_w)
    d.line([(cx, ring_cy + ring_r), (cx, lamp_cy - lamp_h)], fill=PHOSPHOR, width=max(2, int(N * 0.011 * scale)))
    # lantern: dark cage lines over a bright core
    d.polygon(diamond, fill=(238, 170, 84))
    inner = [(cx, lamp_cy - lamp_h * 0.62), (cx + lamp_w * 0.55, lamp_cy), (cx, lamp_cy + lamp_h * 0.62), (cx - lamp_w * 0.55, lamp_cy)]
    d.polygon(inner, fill=(255, 226, 160))
    cage = (96, 62, 28)
    cw = max(2, int(N * 0.006 * scale))
    d.line([(cx, lamp_cy - lamp_h), (cx, lamp_cy + lamp_h)], fill=cage, width=cw)
    d.line([(cx - lamp_w, lamp_cy), (cx + lamp_w, lamp_cy)], fill=cage, width=cw)
    d.polygon(diamond, outline=(120, 78, 36), width=max(2, int(N * 0.008 * scale)))
    # cap and ring loop above the lantern
    d.rectangle([cx - N * 0.014 * scale, lamp_cy - lamp_h - N * 0.022 * scale, cx + N * 0.014 * scale, lamp_cy - lamp_h], fill=(150, 130, 100))
    return base.resize((S, S), Image.LANCZOS)


def rounded(img, radius_frac=0.22):
    S = img.size[0]
    mask = Image.new('L', (S * 2, S * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S * 2 - 1, S * 2 - 1], radius=int(S * 2 * radius_frac), fill=255)
    mask = mask.resize((S, S), Image.LANCZOS)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, '..', '..', '..'))
    ap.add_argument('--out', default=os.path.join(repo, 'public', 'abyssal-tether-3d', 'icons'))
    ap.add_argument('--store', default=os.path.join(repo, 'docs', 'abyssal-tether-3d', 'store', 'art'))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.store, exist_ok=True)

    any1024 = glyph_image(1024, 1.0)
    any_rounded = rounded(any1024)
    any_rounded.save(os.path.join(args.out, 'icon-1024.png'), optimize=True)
    for s in (512, 192):
        any_rounded.resize((s, s), Image.LANCZOS).save(os.path.join(args.out, f'icon-{s}.png'), optimize=True)
    any_rounded.resize((48, 48), Image.LANCZOS).save(os.path.join(args.out, 'favicon-48.png'), optimize=True)

    # maskable: glyph inside the central 80% (Android crops to a circle / squircle), background to every edge
    mask1024 = glyph_image(1024, 0.8)
    mask1024.save(os.path.join(args.out, 'icon-maskable-1024.png'), optimize=True)
    mask1024.resize((512, 512), Image.LANCZOS).save(os.path.join(args.out, 'icon-maskable-512.png'), optimize=True)

    # store icon: opaque square (Meta asks for 24-bit PNG)
    any1024.convert('RGB').save(os.path.join(args.store, 'icon-1024.png'), optimize=True)
    any1024.convert('RGB').resize((512, 512), Image.LANCZOS).save(os.path.join(args.store, 'icon-512.png'), optimize=True)
    print('icons written to', args.out, 'and', args.store)


if __name__ == '__main__':
    main()
