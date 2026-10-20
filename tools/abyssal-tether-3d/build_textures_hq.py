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
    from PIL import Image, ImageFile

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
    ap.add_argument("--sets", default=",".join(list(SETS) + ["detail"]))
    ap.add_argument("--tilecheck", default="")
    ap.add_argument("--no-bake", action="store_true")
    args = ap.parse_args()
    names = [s.strip() for s in args.sets.split(",") if s.strip()]
    for n in names:
        if n != "detail" and n not in SETS:
            sys.exit(f"unknown set {n}")
    if not args.no_bake:
        entries = {}
        for n in names:
            entries[n] = bake_detail(args.work, args.out) if n == "detail" else bake(n, args.work, args.out)
        print("[hq] manifest ->", write_manifest(args.out, entries))
    if args.tilecheck:
        tilecheck(args.work, args.tilecheck, [n for n in names if n != "detail"])


if __name__ == "__main__":
    main()
