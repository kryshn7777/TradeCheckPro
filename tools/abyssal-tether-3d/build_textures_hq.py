"""ABYSSAL TETHER 3D — Quest-tier HQ PBR texture sets (2048 hero sets, 1024 the rest), baked from code.

Builds on build_textures.py (periodic FFT / wrapped-Worley height-field sculpts: every map is seamless BY CONSTRUCTION)
and adds what a headset needs when a surface is half a metre from your face:

  * 2048 px hero sets (rock strata, ashlar masonry, rusted iron plate) -> 512 px/m on a 4 m tile, with an extra
    micro-relief octave (grain, tool marks, pitting, 0.2-0.6 mm amplitude) the 1024 sets could not hold;
  * curvature-driven wear (pale worn arrises, soot/grime in cavities, bare-metal edges), wet streaks that darken
    and gloss the stone below leaks, and low-frequency colour / roughness variation inside the tile so the repeat
    never reads;
  * new 1024 sets: `rubble` (broken stone and dust), `roots` (bark-like root cords), and a shared 512 `detail`
    micro-normal that the shader layers over every macro normal;
  * the height field is baked into the BLUE channel of the *_normal.ktx2 maps (normal xy in RG, z is rebuilt in the
    shader), which gives parallax offset mapping a height tap for free; `heightM` in the manifest is the height
    range in metres that the 0..1 channel spans.

Outputs
  --work DIR   lossless masters (PNG): <set>_albedo.png, <set>_normal_h.png (B = height), <set>_orm.png, <set>_height16.png
  --out DIR    runtime assets (default public/abyssal-tether-3d/assets/textures): 1024 px JPEG fallbacks
               (<set>_albedo/normal/orm.jpg; normal.B = true z, no height) and manifest.json (merged; each set
               carries "ktx2": {albedo, normal, orm} once encode_ktx2.mjs has produced them)
  --tilecheck DIR  2x2 tiling sheets of every master
  KTX2 (GPU-compressed, UASTC / ETC1S) is produced by tools/abyssal-tether-3d/encode_ktx2.mjs from the masters.

Run (the Blender venv python has numpy + Pillow; a set needs ~2.8 GB at 2048, keep one process):
  python build_textures_hq.py --work <dir> --sets rock,masonry,metal,rockFar,flesh,rubble,roots,detail
  python build_textures_hq.py --work <dir> --tilecheck <dir>/tilecheck --no-bake
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
import build_textures as bt  # noqa: E402
from build_textures import Field, col, lerp_rgb, sstep  # noqa: E402

try:
    from PIL import Image, ImageDraw, ImageFile

    ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 1 << 24)
except ImportError:  # pragma: no cover
    Image = None

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(ROOT, "public", "abyssal-tether-3d", "assets", "textures")


def u8(x):
    return (np.clip(x, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


# =============================================================================
# New base materials (the three originals are reused from build_textures)
# =============================================================================
def mat_rubble(F):
    """Broken stone and dust: chunky angular stones in a grey grit, a few flat slabs, wet dark gaps."""
    n = F.n
    shp = (n, n)
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    w_lo = F.spectral(beta=3.2, fmax=6)
    w_mid = F.spectral(beta=2.4, fmin=4, fmax=80)
    warp = 0.018
    cells = 9
    f1, f2, cid, dx, dy = F.worley(cells, cells, F.u + warp * w_lo + 0.3 * warp * w_mid, F.v + warp * w_mid, jitter=0.92)
    rc = rs.random((cells * cells, 6))
    rad = 0.40 + 0.14 * rc[cid, 0]  # cell units
    dome = np.sqrt(np.clip(1.0 - (f1 / rad) ** 2, 0, 1))
    # angular facets: tilt each stone's top plane, then a hard rim where f1 meets the radius
    tilt = (rc[cid, 1] - 0.5) * 0.7 * dx + (rc[cid, 2] - 0.5) * 0.7 * dy
    stone_h = (0.012 + 0.045 * rc[cid, 3]) * (0.55 + 0.45 * dome) + 0.035 * tilt
    edge = sstep(0.0, 0.12, (rad - f1) / rad + 0.012 * F.spectral(beta=1.8, fmin=10, fmax=120))
    # smaller chips between the stones
    g1, _, gid, _, _ = F.worley(34, 34, jitter=0.95)
    chip_r = 0.3 + 0.25 * rs.random(34 * 34)[gid]
    chips = np.sqrt(np.clip(1.0 - (g1 / chip_r) ** 2, 0, 1)) * (rs.random(34 * 34)[gid] > 0.35)
    grit = F.spectral(beta=1.5, fmin=120, fmax=700)
    h = stone_h * edge + 0.004 * chips * (1 - edge) + 0.0004 * grit + 0.0006 * F.spectral(beta=2.2, fmin=20, fmax=160) \
        - 0.012 * (1 - edge)
    h = F.blur(h, 0.7)
    tone = rc[cid, 4]
    a = lerp_rgb(np.broadcast_to(col((58, 55, 50)), shp + (3,)), np.broadcast_to(col((86, 80, 70)), shp + (3,)), sstep(0.3, 1.0, tone) * 0.9)
    a = lerp_rgb(a, np.broadcast_to(col((40, 41, 42)), a.shape), sstep(0.35, 0.0, tone) * 0.8)
    warm = (rc[cid, 5] - 0.5) * 0.12
    a[..., 0] *= 1 + warm
    a[..., 2] *= 1 - warm
    dust = col((74, 69, 62)) * (0.85 + 0.2 * sstep(-1, 1.5, grit))[..., None]
    a = lerp_rgb(dust, a * (1.0 + 0.1 * w_lo)[..., None], edge)
    a *= (1.0 + 0.08 * F.spectral(beta=2.0, fmin=30, fmax=400))[..., None]
    wet = sstep(0.3, 1.4, F.spectral(beta=3.0, fmax=8)) * (1 - edge)
    a *= (1.0 - 0.35 * wet)[..., None]
    rough = 0.9 - 0.3 * wet + 0.05 * grit - 0.08 * edge * sstep(0.5, 1.0, tone)
    return dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp),
                ao_k=2.8, ao_scales=(0.006, 0.02, 0.06), nstrength=1.0, albedo_ao=0.6)


def mat_roots(F):
    """Root cords and bark fibre: twisted ridged strands down v, deep fissures, pale split fibre, damp moss in gaps."""
    n = F.n
    shp = (n, n)
    w_lo = F.spectral(beta=3.3, fmax=6)
    w_mid = F.spectral(beta=2.4, fmin=3, fmax=60)
    du = 0.02 * w_lo + 0.004 * w_mid
    strand = F.warp(F.spectral(beta=2.3, fmin=5, fmax=60, sx=1.0, sy=6.0), du, 0.0)
    cord = np.sqrt(np.clip(0.5 + 0.5 * np.tanh(strand * 1.1), 0, 1))
    fis = sstep(-0.2, -1.2, strand)
    fib = F.warp(F.spectral(beta=1.7, fmin=40, fmax=400, sx=1.0, sy=22.0), du, 0.0)
    fibres = 1.0 - np.abs(np.tanh(fib * 0.8))
    cross = F.spectral(beta=2.0, fmin=10, fmax=120, sx=6.0, sy=1.0)
    ring = 0.5 + 0.5 * np.sin((F.v * 38 + 1.2 * w_lo + 0.5 * cross) * 2 * np.pi)
    ridge = bt.ridged(F, 2.2, 20, 300, sx=1.0, sy=5.0)
    h = (0.016 * cord - 0.014 * fis + 0.0018 * fibres + 0.002 * ring * cord + 0.0014 * ridge
         + 0.0003 * F.spectral(beta=1.5, fmin=150, fmax=700) + 0.006 * w_lo)
    h = F.blur(h, 0.6)
    a = lerp_rgb(np.broadcast_to(col((34, 28, 24)), shp + (3,)), np.broadcast_to(col((66, 55, 46)), shp + (3,)),
                 np.clip(cord * (0.5 + 0.5 * fibres), 0, 1))
    a = lerp_rgb(a, np.broadcast_to(col((18, 14, 12)), a.shape), np.clip(fis * 1.1, 0, 1))
    a = lerp_rgb(a, np.broadcast_to(col((104, 92, 76)), a.shape), 0.35 * sstep(0.6, 1.5, ridge * 2 + fib * 0.3) * cord)
    moss = sstep(0.4, 1.3, F.spectral(beta=3.0, fmax=8)) * fis
    a = lerp_rgb(a, np.broadcast_to(col((34, 52, 36)), a.shape), 0.6 * moss)
    a *= (1.0 + 0.14 * w_lo)[..., None]
    rough = 0.82 - 0.2 * sstep(0.4, 1.4, F.spectral(beta=2.6, fmin=2, fmax=40)) + 0.08 * fis - 0.1 * moss
    return dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp),
                ao_k=2.6, ao_scales=(0.004, 0.012, 0.035), nstrength=1.0, albedo_ao=0.55)


# name: (builder, tile metres, size, seed, hero, hq micro amp m, kind, description)
SETS = {
    "rock": (bt.mat_rock, 4.0, 2048, 1101, True, 0.00035, "stone", "shaft rock: bedded strata, jointed blocks, faults, veins, seeps, micro grain"),
    "masonry": (bt.mat_masonry, 4.0, 2048, 2202, True, 0.00030, "stone", "Lanternwright ashlar: dressed courses, chipped arrises, eroded mortar, grime runs, micro peck"),
    "metal": (bt.mat_metal, 2.0, 2048, 3303, True, 0.00010, "metal", "corroded iron plate: scale, flaking rust, pitting, runs, edge wear"),
    "rockFar": (bt.mat_rock_far, 16.0, 1024, 4404, False, 0.0010, "stone", "distant rock: dark massive beds, big joints"),
    "flesh": (bt.mat_flesh, 1.5, 1024, 5505, False, 0.00006, "flesh", "dark wet sinew: fibre bundles, raised veins, capillaries"),
    "rubble": (mat_rubble, 2.0, 1024, 6606, False, 0.0004, "stone", "broken stone and dust: gravel, chips, damp gaps"),
    "roots": (mat_roots, 2.0, 1024, 7707, False, 0.0003, "organic", "root cords and bark fibre: twisted strands, fissures, damp moss"),
}


# =============================================================================
# HQ finishing pass
# =============================================================================
def finish(name, F, m, micro_amp, kind):
    n = F.n
    h = m["height"].copy()
    # Micro relief: an octave the 1024 sets could not hold (cycles per tile scale with n so detail stays ~constant in mm).
    k = n / 2048.0
    micro = F.spectral(beta=1.55, fmin=190 * k, fmax=760 * k)
    micro2 = F.spectral(beta=2.0, fmin=60 * k, fmax=320 * k)
    h = h + micro_amp * micro + 0.5 * micro_amp * micro2
    # Curvature (positive = convex arris). The radius is in metres, so the result is resolution independent.
    r = 0.012 if kind != "metal" else 0.006
    curv = (h - F.blur_m(h, r)) / r
    cs = np.percentile(np.abs(curv), 98)
    cv = np.clip(curv / max(cs, 1e-9), -1, 1)
    convex = np.clip(cv, 0, 1)
    concave = np.clip(-cv, 0, 1)
    # Low-frequency colour / roughness variation inside the tile (the tile never reads as a repeat).
    m1 = F.spectral(beta=3.2, fmin=1, fmax=3.5)
    m2 = F.spectral(beta=2.8, fmin=2, fmax=9)
    m3 = F.spectral(beta=3.0, fmin=1, fmax=4)
    a = m["albedo"].copy()
    a *= (1.0 + 0.13 * m1 + 0.06 * m2)[..., None]
    hue = 0.035 * m3
    a[..., 0] *= 1.0 + hue
    a[..., 2] *= 1.0 - hue
    # Wet streaks: leaks darken and gloss the stone below them (long, thin, vertical).
    streak = F.spectral(beta=2.0, fmin=4 * k, fmax=300 * k, sx=1.0, sy=14.0)
    zone = F.spectral(beta=3.0, fmin=1, fmax=6)
    wet = sstep(0.9, 2.2, streak) * sstep(-0.3, 1.0, zone)
    wet = np.clip(wet, 0, 1)
    rough = m["rough"].copy()
    metal = m["metal"].copy()
    if kind == "stone":
        a = a * (1.0 - 0.30 * concave)[..., None]
        a = lerp_rgb(a, np.broadcast_to(col((112, 104, 92)), a.shape) * (0.8 + 0.4 * m2)[..., None], 0.20 * convex)
        a *= (1.0 - 0.28 * wet)[..., None]
        rough = rough + 0.05 * m2 - 0.30 * wet - 0.08 * convex + 0.04 * concave
    elif kind == "metal":
        # bare metal shows on worn edges; grime pools in cavities; wet runs gloss
        edge_m = convex * sstep(0.25, 0.9, convex)
        a = lerp_rgb(a, np.broadcast_to(col((120, 116, 110)), a.shape), 0.55 * edge_m)
        a *= (1.0 - 0.45 * concave)[..., None]
        metal = np.clip(metal + 0.55 * edge_m - 0.2 * concave, 0, 1)
        rough = rough + 0.04 * m2 - 0.18 * edge_m + 0.05 * concave - 0.2 * wet
        a *= (1.0 - 0.18 * wet)[..., None]
    elif kind == "organic":
        a *= (1.0 - 0.3 * concave)[..., None]
        a = lerp_rgb(a, np.broadcast_to(col((96, 82, 66)), a.shape), 0.18 * convex)
        rough = rough + 0.04 * m2 - 0.08 * wet
    else:  # flesh: keep the baked look, only breathe a little colour into it
        a *= (1.0 - 0.15 * concave)[..., None]
        rough = rough - 0.05 * wet
    ao = bt.ambient_occlusion(F, h, m["ao_scales"], m["ao_k"])
    a = a * (1.0 - m["albedo_ao"] * (1.0 - ao))[..., None]
    ao = F.blur(ao, 0.6 * k + 0.2)
    rough = np.clip(F.blur(rough, 0.7 * k + 0.1), 0.05, 1.0)
    metal = np.clip(F.blur(metal, 0.5 * k + 0.1), 0.0, 1.0)
    nrm = bt.normals_from_height(F, h, m["nstrength"])
    return dict(albedo=np.clip(a, 0, 1), height=h, normal=nrm, orm=np.stack([ao, rough, metal], axis=-1))


def make_detail(size=512, tile=0.5, seed=8808):
    """Shared micro-detail: R/G normal xy, B = grain brightness (0.5 neutral). Tiles at `tile` metres."""
    F = Field(size, seed, tile)
    grain = F.spectral(beta=1.5, fmin=size * 0.06, fmax=size * 0.45)
    mid = F.spectral(beta=2.0, fmin=size * 0.012, fmax=size * 0.2)
    f1, f2, cid, _, _ = F.worley(36, 36, jitter=0.95)
    pits = (np.random.default_rng(seed).random(36 * 36)[cid] > 0.5) * (1 - sstep(0.0, 0.33, f1))
    sc = F.spectral(beta=2.2, fmin=size * 0.03, fmax=size * 0.4, sx=1.0, sy=1.0, angle=0.7)
    h = 0.00035 * grain + 0.0006 * mid - 0.0005 * pits + 0.0002 * sc
    nrm = bt.normals_from_height(F, h, 1.0)
    g = 0.5 + 0.22 * np.tanh(0.5 * grain + 0.4 * mid) - 0.18 * pits
    return dict(normal=nrm, grain=np.clip(g, 0, 1), tile=tile)


# =============================================================================
# IO
# =============================================================================
def save_png(path, arr):
    Image.fromarray(arr).save(path, optimize=False, compress_level=3)


def bake(name, work, out):
    builder, tile, size, seed, hero, amp, kind, desc = SETS[name]
    t0 = time.time()
    F = Field(size, seed, tile)
    m = builder(F)
    r = finish(name, F, m, amp, kind)
    h = r["height"]
    lo, hi = np.percentile(h, 0.3), np.percentile(h, 99.7)
    hn = np.clip((h - lo) / max(hi - lo, 1e-9), 0, 1)
    nrm = r["normal"]
    n01 = nrm * 0.5 + 0.5
    nh = n01.copy()
    nh[..., 2] = hn
    os.makedirs(work, exist_ok=True)
    save_png(os.path.join(work, f"{name}_albedo.png"), u8(r["albedo"]))
    save_png(os.path.join(work, f"{name}_normal_h.png"), u8(nh))
    save_png(os.path.join(work, f"{name}_normal.png"), u8(n01))
    save_png(os.path.join(work, f"{name}_orm.png"), u8(r["orm"]))
    Image.fromarray((hn * 65535).astype(np.uint16)).save(os.path.join(work, f"{name}_height16.png"))
    # 1024 JPEG fallbacks (used when KTX2 / the Basis transcoder is unavailable)
    os.makedirs(out, exist_ok=True)

    def down(a, mode="RGB"):
        im = Image.fromarray(u8(a), mode)
        return im if size == 1024 else im.resize((1024, 1024), Image.LANCZOS)

    down(r["albedo"]).save(os.path.join(out, f"{name}_albedo.jpg"), quality=86, optimize=True, progressive=True)
    # downsample the normal in vector space (renormalise), not in 8-bit pixels
    if size != 1024:
        f = size // 1024
        nb = nrm.reshape(1024, f, 1024, f, 3).mean(axis=(1, 3))
        nb /= np.maximum(np.linalg.norm(nb, axis=-1, keepdims=True), 1e-6)
    else:
        nb = nrm
    Image.fromarray(u8(nb * 0.5 + 0.5)).save(os.path.join(out, f"{name}_normal.jpg"), quality=92, subsampling=0, optimize=True, progressive=True)
    down(r["orm"]).save(os.path.join(out, f"{name}_orm.jpg"), quality=90, subsampling=0, optimize=True, progressive=True)
    a8 = u8(r["albedo"]).astype(np.float64)
    s_h, s_v = bt.seam_report(a8.mean(axis=2))
    print(f"[hq] {name:8s} {size}px {tile:4.1f} m  {time.time() - t0:5.1f}s  heightM={hi - lo:.4f}  seam z=({s_h:+.1f},{s_v:+.1f})  "
          f"albedo={a8[..., 0].mean():.0f},{a8[..., 1].mean():.0f},{a8[..., 2].mean():.0f}  "
          f"orm={r['orm'][..., 0].mean():.2f},{r['orm'][..., 1].mean():.2f},{r['orm'][..., 2].mean():.2f}", flush=True)
    return {
        "albedo": f"{name}_albedo.jpg",
        "normal": f"{name}_normal.jpg",
        "orm": f"{name}_orm.jpg",
        "tileMeters": tile,
        "size": size,
        "hero": hero,
        "heightM": round(float(hi - lo), 5),
        "source": "baked:build_textures_hq.py",
        "description": desc,
    }


def bake_detail(work, out):
    d = make_detail()
    n01 = d["normal"] * 0.5 + 0.5
    arr = n01.copy()
    arr[..., 2] = d["grain"]
    os.makedirs(work, exist_ok=True)
    save_png(os.path.join(work, "detail_normal.png"), u8(arr))
    # 8-bit fallback (B = grain, not z: same convention as the KTX2 version; the shader rebuilds z)
    Image.fromarray(u8(arr)).save(os.path.join(out, "detail_normal.png"), optimize=True)
    print("[hq] detail   512px 0.5 m", flush=True)
    return {"normal": "detail_normal.png", "tileMeters": d["tile"], "size": 512, "source": "baked:build_textures_hq.py",
            "description": "shared micro normal (RG) + grain (B), layered over every macro normal"}


# =============================================================================
# Decal atlas (cracks, grime, moss, blood smear, burn, claw scratches, impact): 2048 x 1024 RGBA + normal, 4 x 2 cells of 512.
# RGB is the decal colour everywhere (no dark halo in the mips), A the coverage; the normal comes from a height field
# (cracks and scratches are cut INTO the surface, moss and scabs stand proud). Cell edges fade to alpha 0.
# =============================================================================
DECAL_NAMES = ["crackA", "crackB", "grime", "moss", "blood", "burn", "scratch", "impact"]
CELL = 512


def _blur(a, sigma):
    from PIL import ImageFilter

    im = Image.fromarray(np.clip(a, 0, 1).astype(np.float32), "F")
    return np.asarray(im.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float64)


def _line_mask(draw_fn, S=1024):
    im = Image.new("L", (S, S), 0)
    draw_fn(ImageDraw.Draw(im), S)
    im = im.resize((CELL, CELL), Image.LANCZOS)
    return np.asarray(im, dtype=np.float64) / 255.0


def _vignette(n=CELL, a=0.62, b=0.97):
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    r = np.maximum(np.abs(x - n / 2), np.abs(y - n / 2)) / (n / 2)
    return 1.0 - sstep(a, b, r)


def _crack(rng, branchy=1.0, width=8):
    import math

    def draw(d, S):
        def walk(x, y, ang, length, w, level):
            steps = max(2, int(length / 9))
            px, py = x, y
            for i in range(steps):
                ang += rng.normal(0, 0.2)
                x += math.cos(ang) * 9
                y += math.sin(ang) * 9
                ww = max(1, int(w * (1 - i / steps) ** 0.7 + 1))
                d.line([(px, py), (x, y)], fill=255, width=ww)
                px, py = x, y
                if level < 3 and rng.random() < 0.075 * branchy:
                    walk(x, y, ang + rng.choice([-1, 1]) * rng.uniform(0.5, 1.3), length * 0.55 * (1 - i / steps) + 30, w * 0.55, level + 1)

        a0 = rng.uniform(0, 6.283)
        walk(S / 2, S / 2, a0, S * 0.5, width, 0)
        walk(S / 2, S / 2, a0 + math.pi, S * 0.5, width, 0)

    return _line_mask(draw)


def make_decals(seed=9909):
    rng = np.random.default_rng(seed)
    F = Field(CELL, seed, 1.0)
    cells = {}
    vig = _vignette()

    def tone(rgb, var=0.12):
        base = np.array(rgb, dtype=np.float64) / 255.0
        n = 1.0 + var * F.spectral(beta=2.2, fmin=4, fmax=60)
        return base[None, None, :] * n[..., None]

    # crack A: one long branching fracture; crack B: a hairline web of many short ones
    m = _crack(rng, 1.0, 9) * vig
    cells["crackA"] = (tone((14, 12, 11)), np.clip(_blur(m, 1.2) * 1.5, 0, 1), -_blur(m, 3.0) * 0.03 - 0.5 * _blur(m, 1.0) * 0.01)
    m = np.maximum(_crack(rng, 2.2, 4), np.maximum(_crack(rng, 2.0, 3), _crack(rng, 1.6, 3))) * vig
    cells["crackB"] = (tone((16, 14, 12)), np.clip(_blur(m, 0.9) * 1.4, 0, 1), -_blur(m, 2.0) * 0.02)
    # grime streak: a dark run that starts wide at the top and drips down in filaments
    y, x = np.mgrid[0:CELL, 0:CELL].astype(np.float64)
    u = (x / CELL - 0.5) * 2
    v = y / CELL
    fil = F.spectral(beta=1.8, fmin=6, fmax=140, sx=1.0, sy=9.0)
    wob = 0.08 * F.spectral(beta=3.0, fmin=1, fmax=8)
    wid = 0.62 * (1 - v) ** 0.6 + 0.08
    prof = 1 - sstep(0.0, 1.0, np.abs(u + wob) / np.maximum(wid, 1e-3))
    a = np.clip(prof * (0.45 + 0.35 * np.tanh(fil)) * (1 - 0.35 * v), 0, 1) * vig
    cells["grime"] = (tone((22, 19, 15)), a, 0.002 * _blur(a, 2))
    # moss: blobby patches with a fuzzy fringe, greens
    blob = F.spectral(beta=2.6, fmin=2, fmax=26)
    edge = F.spectral(beta=1.5, fmin=60, fmax=240)
    mo = sstep(0.1, 0.7, blob + 0.25 * edge - 0.2 + (1 - np.hypot(u, v * 2 - 1) * 1.1))
    mo = np.clip(mo, 0, 1) * vig
    green = tone((38, 58, 30), 0.35)
    cells["moss"] = (green, np.clip(mo * (0.75 + 0.25 * np.tanh(edge)), 0, 1), 0.012 * mo * (0.6 + 0.4 * np.tanh(edge)))
    # blood: a dried drag smear (dark red, streaked along the drag), tails and a few drops. Stylised, never gory.
    ang = 0.35
    du = (x - CELL / 2) / CELL
    dv = (y - CELL / 2) / CELL
    along = du * np.cos(ang) + dv * np.sin(ang)
    across = -du * np.sin(ang) + dv * np.cos(ang)
    st = F.spectral(beta=1.6, fmin=6, fmax=160, sx=7.0, sy=1.0, angle=ang)
    body = (1 - sstep(0.0, 0.2 + 0.1 * np.tanh(st), np.abs(across) + 0.18 * (along + 0.45))) * sstep(-0.45, -0.35, along) * (1 - sstep(0.1, 0.45, along))
    drops = np.zeros((CELL, CELL))
    for _ in range(9):
        cx, cy, r = rng.uniform(0.1, 0.9) * CELL, rng.uniform(0.1, 0.9) * CELL, rng.uniform(3, 10)
        drops = np.maximum(drops, 1 - sstep(r * 0.7, r, np.hypot(x - cx, y - cy)))
    ba = np.clip(body * (0.55 + 0.35 * np.tanh(st)) + 0.8 * drops, 0, 1) * vig
    cells["blood"] = (tone((58, 9, 9), 0.2), ba, 0.0015 * _blur(ba, 1.5))
    # burn: soot cloud + radial lick upward
    rr = np.hypot(u * 1.0, (v - 0.62) * 1.1)
    soot = F.spectral(beta=2.2, fmin=3, fmax=70)
    bu = (1 - sstep(0.1, 0.78 + 0.18 * np.tanh(soot), rr + 0.25 * np.clip(v - 0.62, 0, 1) * 0)) * (0.55 + 0.35 * np.tanh(soot + 0.3))
    lick = (1 - sstep(0.0, 0.42, np.abs(u + 0.15 * soot))) * (1 - sstep(0.1, 0.95, v)) * sstep(0.0, 0.5, 1 - v) * 0.5
    bm = np.clip(np.maximum(bu, lick * (0.6 + 0.4 * np.tanh(F.spectral(beta=1.8, fmin=8, fmax=120, sx=1.0, sy=5.0)))), 0, 1) * vig
    cells["burn"] = (tone((9, 8, 7), 0.15), bm, 0.004 * _blur(bm, 3))
    # claw scratches: a hand of 4-6 gouges, slightly curved, each a bright cut
    def scr(d, S):
        import math

        n = int(rng.integers(4, 7))
        a0 = rng.uniform(-0.5, 0.5) + 1.2
        for k in range(n):
            off = (k - (n - 1) / 2) * 62 + rng.normal(0, 6)
            x0 = S / 2 + off * math.cos(a0 + 1.57) - S * 0.38 * math.cos(a0)
            y0 = S / 2 + off * math.sin(a0 + 1.57) - S * 0.38 * math.sin(a0)
            pts = []
            L = S * (0.55 + 0.25 * rng.random())
            bend = rng.normal(0, 0.18)
            for i in range(40):
                t = i / 39
                pts.append((x0 + math.cos(a0 + bend * t) * L * t, y0 + math.sin(a0 + bend * t) * L * t))
            for i in range(39):
                w = int(max(1, 9 * math.sin(math.pi * (i / 39)) ** 0.6))
                d.line([pts[i], pts[i + 1]], fill=255, width=w)

    sm = _line_mask(scr) * vig
    pale = tone((118, 108, 94), 0.2)
    cells["scratch"] = (pale, np.clip(_blur(sm, 0.8) * 1.5, 0, 1), -_blur(sm, 1.6) * 0.02)
    # impact: crater with radial cracks and a pale dust ring
    rr = np.hypot(u, (v - 0.5) * 2)
    ang_n = np.arctan2((v - 0.5) * 2, u)
    spokes = np.abs(np.sin(ang_n * 5.5 + 3 * F.spectral(beta=3, fmax=6))) ** 14
    crater = 1 - sstep(0.12, 0.3 + 0.05 * np.tanh(F.spectral(beta=2, fmin=4, fmax=40)), rr)
    ring = np.exp(-(((rr - 0.34) / 0.08) ** 2)) * 0.6
    rad = spokes * (1 - sstep(0.15, 0.85, rr)) * sstep(0.1, 0.2, rr)
    am = np.clip(np.maximum(crater * 0.9, np.maximum(ring * 0.5, rad * 0.85)), 0, 1) * vig
    cells["impact"] = (np.where((crater[..., None] > 0.4), tone((24, 22, 20)), tone((98, 90, 80), 0.2)), am, -0.02 * crater - 0.006 * rad + 0.004 * ring)
    return cells


def bake_decals(work, out):
    cells = make_decals()
    W, H = CELL * 4, CELL * 2
    alb = np.zeros((H, W, 4))
    hgt = np.zeros((H, W))
    layout = {}
    for i, nm in enumerate(DECAL_NAMES):
        cx, cy = (i % 4) * CELL, (i // 4) * CELL
        rgb, a, h = cells[nm]
        alb[cy : cy + CELL, cx : cx + CELL, :3] = rgb
        alb[cy : cy + CELL, cx : cx + CELL, 3] = a
        hgt[cy : cy + CELL, cx : cx + CELL] = h
        layout[nm] = [cx / W, 1 - (cy + CELL) / H, CELL / W, CELL / H]  # u0, v0 (bottom), du, dv in GL texture space
    # normal from the height field (metres; the cell spans ~1 m); alpha-weighted so empty areas stay flat
    px = 1.0 / CELL
    dhdu = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) / (2 * px)
    dhdv = (np.roll(hgt, 1, axis=0) - np.roll(hgt, -1, axis=0)) / (2 * px)
    nx, ny, nz = -dhdu * 3.0, -dhdv * 3.0, np.ones_like(hgt)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx * inv, ny * inv, nz * inv], axis=-1) * 0.5 + 0.5
    os.makedirs(work, exist_ok=True)
    Image.fromarray(u8(alb), "RGBA").save(os.path.join(work, "decals_albedo.png"), compress_level=4)
    Image.fromarray(u8(nrm), "RGB").save(os.path.join(work, "decals_normal.png"), compress_level=4)
    # 1024 x 512 fallback PNG (alpha kept) for browsers without KTX2
    small = Image.fromarray(u8(alb), "RGBA").resize((W // 2, H // 2), Image.LANCZOS)
    small.save(os.path.join(out, "decals_albedo.png"), optimize=True)
    nsm = Image.fromarray(u8(nrm), "RGB").resize((W // 2, H // 2), Image.LANCZOS)
    nsm.save(os.path.join(out, "decals_normal.png"), optimize=True)
    print(f"[hq] decals   {W}x{H}  cells={DECAL_NAMES}", flush=True)
    return {"albedo": "decals_albedo.png", "normal": "decals_normal.png", "tileMeters": 1.0, "size": W, "layout": layout,
            "names": DECAL_NAMES, "source": "baked:build_textures_hq.py",
            "description": "decal atlas 4x2: cracks, grime, moss, blood smear, burn, claw scratches, impact (RGBA + normal)"}


def write_manifest(out, entries):
    path = os.path.join(out, "manifest.json")
    data = {}
    if os.path.exists(path):
        with open(path) as fh:
            data = json.load(fh)
    for k, v in entries.items():
        old = data.get(k, {})
        if "ktx2" in old:
            v["ktx2"] = old["ktx2"]
        data[k] = v
    with open(path + ".tmp", "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(path + ".tmp", path)
    return path


def tilecheck(work, outdir, names):
    os.makedirs(outdir, exist_ok=True)
    for nme in names:
        row = []
        for kind in ("albedo", "normal", "orm"):
            p = os.path.join(work, f"{nme}_{kind}.png")
            if not os.path.exists(p):
                continue
            im = Image.open(p).convert("RGB").resize((768, 768), Image.LANCZOS)
            arr = np.asarray(im).astype(np.float64) / 255.0
            if kind == "albedo":
                arr = np.clip(arr / max(arr.mean(), 1e-3) * 0.42, 0, 1)
            t = np.tile(u8(arr), (2, 2, 1))
            row.append(Image.fromarray(t).resize((768, 768), Image.LANCZOS))
        if not row:
            continue
        sheet = Image.new("RGB", (768 * len(row) + 10 * (len(row) - 1), 768), (40, 40, 40))
        for i, t in enumerate(row):
            sheet.paste(t, (i * 778, 0))
        sheet.save(os.path.join(outdir, f"tile2x2_{nme}.png"))
        print(f"[hq] tile check -> {outdir}/tile2x2_{nme}.png")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", required=True, help="directory for the lossless masters (PNG)")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--sets", default=",".join(list(SETS) + ["detail", "decals"]))
    ap.add_argument("--tilecheck", default="")
    ap.add_argument("--no-bake", action="store_true")
    args = ap.parse_args()
    names = [s.strip() for s in args.sets.split(",") if s.strip()]
    for n in names:
        if n not in ("detail", "decals") and n not in SETS:
            sys.exit(f"unknown set {n}")
    if not args.no_bake:
        entries = {}
        for n in names:
            entries[n] = bake_detail(args.work, args.out) if n == "detail" else bake_decals(args.work, args.out) if n == "decals" else bake(n, args.work, args.out)
        print("[hq] manifest ->", write_manifest(args.out, entries))
    if args.tilecheck:
        tilecheck(args.work, args.tilecheck, [n for n in names if n not in ("detail", "decals")])


if __name__ == "__main__":
    main()
