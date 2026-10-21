#!/usr/bin/env python3
"""Packs the raw store screenshots (PNG, ~3 MB each because of the film grain) into high-quality JPEG (Meta accepts
PNG and JPEG) so the repo stays small.   python3 tools/abyssal-tether-3d/release/pack-screens.py [store-dir]
Converts screenshots/*.png -> screenshots/*.jpg (quality 92, 4:4:4) and removes the PNG. Covers / logo / icons in art/
stay 24/32-bit PNG as the spec asks."""
import glob
import os
import sys

from PIL import Image

store = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', '..', 'docs', 'abyssal-tether-3d', 'store')
n = saved = 0
for f in sorted(glob.glob(os.path.join(store, 'screenshots', '*.png'))):
    im = Image.open(f).convert('RGB')
    out = f[:-4] + '.jpg'
    im.save(out, 'JPEG', quality=92, subsampling=0, optimize=True)
    saved += os.path.getsize(f) - os.path.getsize(out)
    os.remove(f)
    n += 1
print(f'packed {n} screenshots, saved {saved / 1048576:.1f} MB')
