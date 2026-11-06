#!/usr/bin/env python3
"""THE LANTERN (ABYSSAL TETHER 3D): app icon generator (original art, no external assets).

Draws the game's glyph, a lit lantern (carrying loop, cap, a barred glass cage with the flame inside) hanging on a short
chain between two stone piers, with a soft amber glow, and writes:

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


def lantern_shapes(N, cx, cy, h, scale):
    """The lantern glyph at centre (cx, cy), total height h: hanging loop, cap, a glass cage with bars, flame, base."""
    w = h * 0.52
    g = {}
    g['loop'] = (cx - w * 0.30, cy - h * 0.62, cx + w * 0.30, cy - h * 0.30)  # the carrying loop (ellipse box)
    g['cap'] = [(cx - w * 0.18, cy - h * 0.40), (cx + w * 0.18, cy - h * 0.40), (cx + w * 0.50, cy - h * 0.28), (cx - w * 0.50, cy - h * 0.28)]
    g['rim'] = (cx - w * 0.52, cy - h * 0.29, cx + w * 0.52, cy - h * 0.24)
    g['glass'] = (cx - w * 0.40, cy - h * 0.24, cx + w * 0.40, cy + h * 0.26)
    g['base'] = [(cx - w * 0.52, cy + h * 0.26), (cx + w * 0.52, cy + h * 0.26), (cx + w * 0.40, cy + h * 0.36), (cx - w * 0.40, cy + h * 0.36)]
    g['foot'] = (cx - w * 0.30, cy + h * 0.36, cx + w * 0.30, cy + h * 0.40)
    fh = h * 0.30
    fy = cy + h * 0.14
    g['flame'] = [(cx, fy - fh)] + [(cx + math.sin(t) * w * 0.13 * (1 - math.cos(t)) * 0.9, fy - fh + fh * (1 - math.cos(t)) / 2) for t in np.linspace(0.15, math.pi, 12)] + \
        [(cx - math.sin(t) * w * 0.13 * (1 - math.cos(t)) * 0.9, fy - fh + fh * (1 - math.cos(t)) / 2) for t in np.linspace(math.pi, 0.15, 12)]
    g['bars'] = [cx - w * 0.40, cx - w * 0.14, cx + w * 0.14, cx + w * 0.40]
    g['w'] = w
    return g


def glyph_image(S, scale=1.0):
    """The whole icon art at S x S (opaque RGB): a lit lantern hanging on a short chain between two stone piers."""
    ss = 2  # supersample
    N = S * ss
    img = vignette_bg(N).convert('RGBA')
    img.alpha_composite(piers(N, scale, 0))

    cx = N / 2
    cy = N * (0.5 + 0.10 * scale)
    h = N * 0.56 * scale
    g = lantern_shapes(N, cx, cy, h, scale)
    w = g['w']
    iron = (46, 40, 34)
    brass = (150, 112, 62)
    lw = max(2, int(N * 0.012 * scale))

    # emissive layer (glow source): the glass and the flame
    em = Image.new('RGB', (N, N), (0, 0, 0))
    ed = ImageDraw.Draw(em)
    ed.rounded_rectangle(g['glass'], radius=w * 0.10, fill=AMBER)
    ed.polygon(g['flame'], fill=(255, 236, 190))
    base = img.convert('RGB')
    base = add(base, glow(em, N * 0.12, 1.6).point(lambda v: int(v * 0.75)))
    base = add(base, glow(em, N * 0.04, 1.2).point(lambda v: int(v * 0.5)))

    d = ImageDraw.Draw(base)
    # the chain from the top edge to the loop: alternating links
    top = g['loop'][1]
    link_h = N * 0.05 * scale
    y = -link_h * 0.3
    k = 0
    while y < top - link_h * 0.2:
        lwid = N * (0.026 if k % 2 == 0 else 0.008) * scale
        d.rounded_rectangle([cx - lwid, y, cx + lwid, y + link_h], radius=max(1, lwid * 0.9), outline=(96, 86, 72), width=max(2, int(N * 0.009 * scale)))
        y += link_h * 0.78
        k += 1
    d.ellipse(g['loop'], outline=brass, width=max(3, int(N * 0.014 * scale)))
    # glass: warm gradient (bright core, deeper amber at the edges)
    x0, y0, x1, y1 = [int(v) for v in g['glass']]
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    r = np.sqrt(((gx - cx) / (w * 0.42)) ** 2 + ((gy - (cy + h * 0.06)) / (h * 0.30)) ** 2)
    t = np.clip(1 - r, 0, 1)[..., None]
    col = np.array([196, 112, 40], np.float32) * (1 - t) + np.array([255, 214, 140], np.float32) * t
    gm = Image.new('L', (N, N), 0)
    ImageDraw.Draw(gm).rounded_rectangle(g['glass'], radius=w * 0.10, fill=255)
    gl = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), 'RGB')
    base.paste(gl, (x0, y0), gm.crop((x0, y0, x1, y1)))
    d = ImageDraw.Draw(base)
    d.polygon(g['flame'], fill=(255, 246, 220))
    # the cage: iron bars and frame over the glass
    for bx in g['bars']:
        d.line([(bx, g['glass'][1]), (bx, g['glass'][3])], fill=iron, width=lw)
    d.rounded_rectangle(g['glass'], radius=w * 0.10, outline=iron, width=lw)
    d.polygon(g['cap'], fill=(64, 54, 44))
    d.line([g['cap'][3], g['cap'][0], g['cap'][1], g['cap'][2]], fill=brass, width=max(2, int(N * 0.006 * scale)))
    d.rectangle(g['rim'], fill=brass)
    d.polygon(g['base'], fill=(64, 54, 44))
    d.line([g['base'][0], g['base'][1]], fill=brass, width=max(2, int(N * 0.008 * scale)))
    d.rectangle(g['foot'], fill=(52, 44, 36))
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
