#!/usr/bin/env python3
"""ABYSSAL TETHER 3D: store art builder (title typography + cover set from real game renders).

Input : docs/abyssal-tether-3d/store/keyart/*.png      raw renders of the real game (tools/.../capture-screens.mjs)
Output: docs/abyssal-tether-3d/store/art/
          hero-3000x900.png               Hero (24-bit PNG)
          cover-landscape-2560x1440.png   Cover, landscape
          cover-square-1440x1440.png      Cover, square
          cover-portrait-1008x1440.png    Cover, portrait
          mini-1080x360.png               Mini landscape
          logo-transparent.png            Logo, 32-bit PNG with alpha (2880x1440)
          icon-1024.png / icon-512.png    from make-icons.py (opaque)

The TITLE LETTERING IS DESIGNED HERE, not a font: nine angular, chamfered capitals (A B Y S L T E H R) built from
centre-line strokes, rendered as carved metal: a bevel lit from the upper left, an inset channel, an amber rim glow
from the lantern below, fine grain. Rules followed (RELEASE.md section 13, VRC.Quest.Asset.1-3): the cover carries
the title only (no taglines, no banners), spelled exactly "ABYSSAL TETHER"; the lockup keeps >= 20 % top / bottom and
>= 10 % side margins so no text sits in the bleed areas; no blood, no organs (the images are of stone, light and
rope; a creature, if the render has one, stays small).

Usage: python3 tools/abyssal-tether-3d/release/make-art.py [--keyart DIR] [--out DIR] [--variant a|b|c]
Needs Pillow + numpy.
"""
import argparse
import math
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

PHOSPHOR = (232, 220, 192)
AMBER = (224, 160, 80)
BG = (8, 9, 10)

# ----------------------------------------------------------------------------------------------------------------
# Lettering: centre-line strokes on a grid of cap height 100 (x right, y down). Corners are chamfered, never round.
# ----------------------------------------------------------------------------------------------------------------
GLYPHS = {
    'A': (76, [[(0, 100), (22, 0), (54, 0), (76, 100)], [(14, 64), (62, 64)]]),
    'B': (62, [[(0, 0), (0, 100)], [(0, 0), (40, 0), (56, 14), (56, 36), (40, 50), (0, 50)], [(0, 50), (44, 50), (62, 66), (62, 86), (44, 100), (0, 100)]]),
    'Y': (70, [[(0, 0), (35, 52), (70, 0)], [(35, 52), (35, 100)]]),
    'S': (56, [[(56, 14), (42, 0), (14, 0), (0, 14), (0, 36), (14, 50), (42, 50), (56, 64), (56, 86), (42, 100), (14, 100), (0, 86)]]),
    'L': (50, [[(0, 0), (0, 100), (50, 100)]]),
    'T': (64, [[(0, 0), (64, 0)], [(32, 0), (32, 100)]]),
    'E': (52, [[(52, 0), (0, 0), (0, 100), (52, 100)], [(0, 50), (40, 50)]]),
    'H': (64, [[(0, 0), (0, 100)], [(64, 0), (64, 100)], [(0, 50), (64, 50)]]),
    'R': (62, [[(0, 100), (0, 0), (40, 0), (58, 14), (58, 36), (40, 50), (0, 50)], [(34, 50), (62, 100)]]),
}
STROKE = 15.0  # stroke width in glyph units
TRACK = 24.0  # space between letters
WORD_GAP = 80.0


def word_width(word):
    return sum(GLYPHS[c][0] for c in word) + TRACK * (len(word) - 1) + STROKE


def stroke_mask(word, cap_px, pad):
    """Mask (L) of a word at the given cap height in pixels, with `pad` pixels around."""
    k = cap_px / 100.0
    w = int(word_width(word) * k + 2 * pad)
    h = int((100 + STROKE) * k + 2 * pad)
    ss = 2
    m = Image.new('L', (w * ss, h * ss), 0)
    d = ImageDraw.Draw(m)
    x = pad + STROKE * k / 2
    lw = max(2, int(STROKE * k * ss))
    for ch in word:
        gw, strokes = GLYPHS[ch]
        for pl in strokes:
            pts = [((x + px * k) * ss, (pad + STROKE * k / 2 + py * k) * ss) for px, py in pl]
            for a, b in zip(pts[:-1], pts[1:]):
                d.line([a, b], fill=255, width=lw)
            # square-ish joints: an octagon at every vertex fills the outer notch without rounding the corner
            for (px, py) in pts:
                r = lw / 2
                d.regular_polygon((px, py, r * 1.04), 8, rotation=22.5, fill=255)
        x += (gw + TRACK) * k
    return m.resize((w, h), Image.LANCZOS)


def metal(mask, light=(-0.55, -0.65), glow=1.0, seed=7):
    """Carved metal lettering from a mask: bevel lighting, inset channel, amber rim glow. Returns RGBA."""
    m = np.asarray(mask).astype(np.float32) / 255.0
    h, w = m.shape
    # height field: soft dome inside the stroke
    d1 = np.asarray(mask.filter(ImageFilter.GaussianBlur(max(1.5, h * 0.012)))).astype(np.float32) / 255.0
    d2 = np.asarray(mask.filter(ImageFilter.GaussianBlur(max(3, h * 0.03)))).astype(np.float32) / 255.0
    height = (d1 * 0.65 + d2 * 0.35) * m
    gy, gx = np.gradient(height * (h * 0.09))
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1.0)
    nx, ny = -gx * nz, -gy * nz
    lx, ly = light
    lz = 0.62
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    diff = np.clip((nx * lx + ny * ly + nz * lz) / ln, 0, 1)
    spec = np.clip((nx * lx + ny * ly + nz * lz) / ln, 0, 1) ** 24
    # base tone: cool steel with vertical falloff, warm toward the bottom (the lantern is below)
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    base = np.zeros((h, w, 3), np.float32)
    top = np.array([150, 152, 148], np.float32)
    bot = np.array([128, 104, 74], np.float32)
    base[:] = top * (1 - yy)[..., None] + bot * yy[..., None]
    rng = np.random.default_rng(seed)
    grain = rng.normal(1.0, 0.07, (h, w)).astype(np.float32)
    grain = np.asarray(Image.fromarray(np.clip(grain * 127, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 127.0
    shade = (0.25 + 0.95 * diff)[..., None] * grain[..., None]
    col = base * shade + spec[..., None] * np.array([255, 240, 215], np.float32) * 0.55
    # inset channel: a dark groove along the middle of every stroke
    core = np.asarray(mask.filter(ImageFilter.MinFilter(max(3, int(h * 0.075) | 1)))).astype(np.float32) / 255.0
    core = np.asarray(Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(1.0, h * 0.006)))).astype(np.float32) / 255.0
    col = col * (1 - 0.55 * core[..., None]) + core[..., None] * np.array([14, 12, 10], np.float32) * 0.55
    # warm rim light along the lower edges (from the lantern below)
    rim = np.clip(ny, 0, 1) ** 1.5 * m
    col += rim[..., None] * np.array(AMBER, np.float32) * 0.9
    rgb = np.clip(col, 0, 255).astype(np.uint8)
    out = np.dstack([rgb, (m * 255).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')


def glow_layer(mask, radius, color, gain):
    """Soft outer glow of a mask as an RGB layer (for additive compositing)."""
    b = np.asarray(mask.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0
    return np.clip(b[..., None] * np.array(color, np.float32) * gain, 0, 255)


def lockup(cap_px, stacked, with_tether=True):
    """The title lockup as (RGBA image, glow mask). Stacked: ABYSSAL over TETHER; else one line."""
    pad = int(cap_px * 0.35)
    if stacked:
        a = stroke_mask('ABYSSAL', cap_px, pad)
        t = stroke_mask('TETHER', cap_px, pad)
        gap = int(cap_px * 0.16)
        W = max(a.width, t.width)
        H = a.height + t.height - 2 * pad + gap
        m = Image.new('L', (W, H), 0)
        m.paste(a, ((W - a.width) // 2, 0))
        m.paste(t, ((W - t.width) // 2, a.height - 2 * pad + gap + pad - pad), t)
        # paste TETHER by max so overlapping pads do not erase ABYSSAL
        full = Image.new('L', (W, H), 0)
        full.paste(a, ((W - a.width) // 2, 0))
        tt = Image.new('L', (W, H), 0)
        tt.paste(t, ((W - t.width) // 2, a.height - 2 * pad + gap))
        m = ImageChops.lighter(full, tt)
    else:
        a = stroke_mask('ABYSSAL', cap_px, pad)
        t = stroke_mask('TETHER', cap_px, pad)
        gapw = int(WORD_GAP * cap_px / 100.0)
        W = a.width + t.width - 2 * pad + gapw
        H = a.height
        m = Image.new('L', (W, H), 0)
        m.paste(a, (0, 0))
        tt = Image.new('L', (W, H), 0)
        tt.paste(t, (a.width - 2 * pad + gapw, 0))
        m = ImageChops.lighter(m, tt)
    return m


def cover_fit(img, W, H, focus=(0.5, 0.5)):
    """Scale to cover W x H, cropping around the focus point (0..1)."""
    iw, ih = img.size
    s = max(W / iw, H / ih)
    nw, nh = int(math.ceil(iw * s)), int(math.ceil(ih * s))
    r = img.resize((nw, nh), Image.LANCZOS)
    x = int(min(max(focus[0] * nw - W / 2, 0), nw - W))
    y = int(min(max(focus[1] * nh - H / 2, 0), nh - H))
    return r.crop((x, y, x + W, y + H))


def grade(img, strength=1.0):
    """Cinematic grade: cool shadows, protected warm lights, vignette, bloom on the brightest parts."""
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255.0
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    a = a ** 1.08
    shadows = np.clip(1.0 - lum * 2.2, 0, 1)[..., None]
    a = a + shadows * np.array([-0.004, 0.006, 0.012], np.float32) * strength
    h, w = lum.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    v = np.sqrt(((xx / w - 0.5) / 0.75) ** 2 + ((yy / h - 0.5) / 0.75) ** 2)
    a *= (1.0 - np.clip(v - 0.35, 0, 1) ** 1.6 * 0.85)[..., None]
    bright = np.clip((lum - 0.45) * 2.2, 0, 1)[..., None] * a
    bloom = Image.fromarray((np.clip(bright, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(6, w * 0.006)))
    a += np.asarray(bloom).astype(np.float32) / 255.0 * 0.7 * strength
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'RGB')


def darken_band(img, y0, y1, amount=0.55):
    """Gradient darkening behind the title (kept soft: no hard banner, VRC.Quest.Asset.2)."""
    a = np.asarray(img).astype(np.float32)
    h = a.shape[0]
    ys = np.arange(h, dtype=np.float32)
    mid = (y0 + y1) / 2
    half = (y1 - y0) / 2
    f = np.clip(1 - np.abs(ys - mid) / (half * 1.6), 0, 1) ** 1.5
    a *= (1 - f * amount)[:, None, None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB')


def compose(bg, cap_px, center, stacked, tether=True, tether_x=None):
    """Draws the title (and the tether line) onto an RGB background. center = (cx, cy) in pixels."""
    W, H = bg.size
    m = lockup(cap_px, stacked)
    lw, lh = m.size
    x0 = int(center[0] - lw / 2)
    y0 = int(center[1] - lh / 2)
    canvas = darken_band(bg, y0 + lh * 0.1, y0 + lh * 0.9, 0.5).convert('RGB')
    arr = np.asarray(canvas).astype(np.float32)

    def add_at(layer, x, y):
        h, w = layer.shape[:2]
        xa, ya = max(0, x), max(0, y)
        xb, yb = min(W, x + w), min(H, y + h)
        if xb <= xa or yb <= ya:
            return
        arr[ya:yb, xa:xb] += layer[ya - y : yb - y, xa - x : xb - x]

    # warm glow behind and around the letters (the lantern's light caught in the carving)
    gp = int(cap_px * 2.0)  # pad so the glow is not clipped to the lettering's bounding box
    mp = Image.new('L', (lw + 2 * gp, lh + 2 * gp), 0)
    mp.paste(m, (gp, gp))
    add_at(glow_layer(mp, cap_px * 0.35, AMBER, 0.5), x0 - gp, y0 - gp)
    add_at(glow_layer(mp, cap_px * 0.9, AMBER, 0.18), x0 - gp, y0 - gp)
    canvas = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')

    # the tether: a thin taut line from the top edge down to the title, ending in an anchor ring above it
    if tether:
        d = ImageDraw.Draw(canvas)
        tx = int(tether_x if tether_x is not None else center[0])
        ring_r = cap_px * 0.13
        ring_cy = y0 + lh * 0.02 - ring_r * 1.1
        d.line([(tx, 0), (tx, ring_cy - ring_r)], fill=PHOSPHOR, width=max(2, int(cap_px * 0.025)))
        d.ellipse([tx - ring_r, ring_cy - ring_r, tx + ring_r, ring_cy + ring_r], outline=PHOSPHOR, width=max(3, int(cap_px * 0.045)))
        g = Image.new('L', canvas.size, 0)
        gd = ImageDraw.Draw(g)
        gd.line([(tx, 0), (tx, ring_cy - ring_r)], fill=255, width=max(2, int(cap_px * 0.03)))
        gd.ellipse([tx - ring_r, ring_cy - ring_r, tx + ring_r, ring_cy + ring_r], outline=255, width=max(3, int(cap_px * 0.05)))
        glow = np.asarray(g.filter(ImageFilter.GaussianBlur(cap_px * 0.05))).astype(np.float32)[..., None] / 255.0
        canvas = Image.fromarray(np.clip(np.asarray(canvas).astype(np.float32) + glow * np.array(PHOSPHOR, np.float32) * 0.5, 0, 255).astype(np.uint8), 'RGB')

    rgba = canvas.convert('RGBA')
    mt = metal(m)
    # soft contact shadow under the letters
    sh = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
    shm = m.filter(ImageFilter.GaussianBlur(cap_px * 0.06))
    sh.putalpha(shm.point(lambda v: int(v * 0.8)))
    rgba.alpha_composite(sh, (x0 + int(cap_px * 0.02), y0 + int(cap_px * 0.05)))
    rgba.alpha_composite(mt, (x0, y0))
    return rgba.convert('RGB'), (x0, y0, lw, lh)


def load_render(keyart, name):
    p = os.path.join(keyart, name)
    if not os.path.exists(p):
        raise SystemExit(f'missing key-art render {p}: run `npm run capture:at3d-store -- --only keyart` first')
    return Image.open(p).convert('RGB')


def make_logo(out):
    """Transparent logo: the lettering only, with the carved-metal finish and a faint amber halo. 2880 x 1440."""
    W, H = 2880, 1440
    cap = 372
    m = lockup(cap, True)
    lw, lh = m.size
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x0, y0 = (W - lw) // 2, (H - lh) // 2
    gp = int(cap * 0.9)
    mp = Image.new('L', (lw + 2 * gp, lh + 2 * gp), 0)
    mp.paste(m, (gp, gp))
    ha = np.asarray(mp.filter(ImageFilter.GaussianBlur(cap * 0.3))).astype(np.float32) * 0.55
    amber = np.zeros(ha.shape + (3,), np.float32) + np.array(AMBER, np.float32)
    h = np.dstack([amber, ha]).astype(np.uint8)
    canvas.alpha_composite(Image.fromarray(h, 'RGBA'), (x0 - gp, y0 - gp))
    canvas.alpha_composite(metal(m), (x0, y0))
    canvas.save(os.path.join(out, 'logo-transparent.png'), optimize=True)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, '..', '..', '..'))
    store = os.path.join(repo, 'docs', 'abyssal-tether-3d', 'store')
    ap = argparse.ArgumentParser()
    ap.add_argument('--keyart', default=os.path.join(store, 'keyart'))
    ap.add_argument('--out', default=os.path.join(store, 'art'))
    ap.add_argument('--variant', default='a', help='which vista render to use: a | b | c')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    v = args.variant

    # hero 3000 x 900: one line, title centred in the safe area (20 % top/bottom, 10 % sides)
    bg = grade(load_render(args.keyart, f'vista-{v}-hero.png').resize((3000, 900), Image.LANCZOS))
    out, box = compose(bg, cap_px=190, center=(1500, 470), stacked=False, tether_x=1500)
    out.save(os.path.join(args.out, 'hero-3000x900.png'), optimize=True)
    print('hero', box)

    # landscape 2560 x 1440: stacked
    bg = grade(cover_fit(load_render(args.keyart, f'vista-{v}-16x9.png'), 2560, 1440))
    out, box = compose(bg, cap_px=250, center=(1280, 800), stacked=True, tether_x=1280)
    out.save(os.path.join(args.out, 'cover-landscape-2560x1440.png'), optimize=True)
    print('landscape', box)

    # square 1440 x 1440
    bg = grade(cover_fit(load_render(args.keyart, f'vista-{v}-square.png'), 1440, 1440))
    out, box = compose(bg, cap_px=170, center=(720, 860), stacked=True, tether_x=720)
    out.save(os.path.join(args.out, 'cover-square-1440x1440.png'), optimize=True)
    print('square', box)

    # portrait 1008 x 1440
    bg = grade(cover_fit(load_render(args.keyart, f'vista-{v}-portrait.png'), 1008, 1440))
    out, box = compose(bg, cap_px=118, center=(504, 960), stacked=True, tether_x=504)
    out.save(os.path.join(args.out, 'cover-portrait-1008x1440.png'), optimize=True)
    print('portrait', box)

    # mini 1080 x 360: one line, small
    bg = grade(load_render(args.keyart, f'vista-{v}-hero.png').resize((1080, 324), Image.LANCZOS).resize((1080, 360), Image.LANCZOS))
    out, box = compose(bg, cap_px=66, center=(540, 190), stacked=False, tether=False)
    out.save(os.path.join(args.out, 'mini-1080x360.png'), optimize=True)
    print('mini', box)

    make_logo(args.out)
    print('logo written; icons come from make-icons.py')


if __name__ == '__main__':
    main()
