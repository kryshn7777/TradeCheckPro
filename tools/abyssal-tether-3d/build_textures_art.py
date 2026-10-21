"""ABYSSAL TETHER 3D - WP-ART-PASS calm stone sets (wall `rock` slot, floor / decor `masonry` slot).

The first HQ sets read as noise from a ledge: the shaft-rock wall was a wavy strata field with ripple normals ("foil"), the
masonry floor a busy tile with pits, peck and blotches. This pass keeps the same pipeline (periodic FFT / Worley field
toolkit, hq `finish()` for curvature wear, 2048 px, normal.B = height, ORM) but authors what a viewer should see at a glance:

  rock     (4 m tile) LARGE dressed ashlar: six staggered courses 0.5-0.85 m tall, blocks 0.9-1.9 m long, DEEP joints
           (3-4.5 cm) with chamfered arrises, a few chipped corners, strong per-block value / hue variation (so a big wall is a
           pattern of stones, not one grey), nearly flat faces with only a gentle undulation, faint grime drips from the beds.
           Brighter than before (mean albedo ~ sRGB 80) so the baked light has something to read on.
  masonry  (4 m tile) calm flagstones / dressed slabs: 1.2-2.0 m slabs, shallow joints, soft tone variation, no pits.

Run (blender venv python, ~2.5 GB, one process):
  python build_textures_art.py --work <masters dir> [--sets rock,masonry] [--tilecheck <dir>]
then encode_ktx2.mjs --work <masters dir> --sets rock,masonry (as in README).
"""

import argparse
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_textures as bt  # noqa: E402
import build_textures_hq as hq  # noqa: E402
from build_textures import col, frac, lerp_rgb, sstep, tint  # noqa: E402


def _layout(F, rs, n_courses, lo_w, hi_w, h_lo, h_hi):
    """Staggered courses. Returns row, blk_id, nb, left, right, lu (block-local u in uu space), top, bot (v)."""
    n = F.n
    T = F.tile
    shp = (n, n)
    ch = rs.uniform(h_lo, h_hi, n_courses)
    ch = ch / ch.sum()
    edges_v = np.concatenate([[0.0], np.cumsum(ch)])
    row = np.clip(np.searchsorted(edges_v, F.v, side="right") - 1, 0, n_courses - 1)
    top = edges_v[row]
    bot = edges_v[row + 1]
    blk = np.zeros(shp, np.int64)
    left = np.zeros(shp)
    right = np.zeros(shp)
    lu = np.zeros(shp)
    nb = 0
    for r in range(n_courses):
        widths = []
        total = 0.0
        while True:
            w = rs.uniform(lo_w, hi_w) / T
            if total + w > 1.0 - lo_w / T:
                widths.append(1.0 - total)
                break
            widths.append(w)
            total += w
        joints = np.concatenate([[0.0], np.cumsum(widths)])
        off = rs.uniform(0, 1)
        m = row == r
        uu = frac(F.u[m] - off)
        b = np.clip(np.searchsorted(joints, uu, side="right") - 1, 0, len(widths) - 1)
        left[m] = joints[b]
        right[m] = joints[b + 1]
        lu[m] = uu
        blk[m] = nb + b
        nb += len(widths)
    return row, blk, nb, left, right, lu, top, bot


def mat_wall_calm(F):
    n = F.n
    shp = (n, n)
    T = F.tile
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    w_lo = F.spectral(beta=3.4, fmax=7)
    w_mid = F.spectral(beta=2.6, fmin=4, fmax=70)
    row, blk, nb, left, right, lu, top, bot = _layout(F, rs, 6, 0.9, 1.9, 0.52, 0.86)
    v = F.v
    jit = 0.0025 * w_mid
    qx = np.minimum(lu - left, right - lu) * T + jit
    qy = np.minimum(v - top, bot - v) * T + jit
    mortar_half = 0.011 + 0.005 * sstep(0.0, 1.5, w_mid + 0.5 * w_lo)
    qx = qx - mortar_half
    qy = qy - mortar_half
    mn = np.minimum(qx, qy)
    rc = 0.02
    corner = rc - np.hypot(np.clip(rc - qx, 0, None), np.clip(rc - qy, 0, None))
    e = np.where(mn >= rc, mn, corner)
    rb = rs.random((nb, 10))
    # chipped corners: a ragged bite out of one corner of ~15 % of the blocks
    bcx = (left + right) * 0.5
    bcy = (top + bot) * 0.5
    lx = (lu - bcx) * T
    ly = (v - bcy) * T
    hw = (right - left) * T * 0.5
    hh = (bot - top) * T * 0.5
    csx = np.where(rb[blk, 1] > 0.5, 1.0, -1.0)
    csy = np.where(rb[blk, 2] > 0.5, 1.0, -1.0)
    cd = np.hypot(lx - csx * hw, ly - csy * hh)
    chip_r = 0.10 + 0.20 * rb[blk, 3]
    rag = F.spectral(beta=1.8, fmin=10, fmax=200)
    chip = sstep(chip_r, chip_r * 0.55, cd + 0.035 * rag) * (rb[blk, 4] > 0.84)
    e_w = e - 0.075 * chip
    bevel = 0.022 + 0.02 * rb[blk, 5]
    prof = sstep(-0.002, bevel, e_w)
    face = sstep(-0.002, 0.004, e_w)
    # faces: dressed, slightly proud / tilted per block, gently undulating (no pits, no peck)
    tilt = (rb[blk, 6] - 0.5) * 0.012 * lx + (rb[blk, 7] - 0.5) * 0.012 * ly
    proud = (rb[blk, 8] - 0.5) * 0.010
    undul = F.spectral(beta=3.0, fmin=3, fmax=36)
    face_h = tilt + proud + 0.0022 * undul + 0.00025 * F.spectral(beta=1.6, fmin=120, fmax=420)
    face_h -= 0.012 * chip  # the bite also sits lower
    depth = 0.036 + 0.012 * sstep(-0.3, 1.4, w_mid)
    h = (-depth + 0.0015 * F.spectral(beta=2.0, fmin=40, fmax=300)) * (1.0 - prof) + face_h * prof
    # albedo: strong per-block value (3 stone classes) + hue drift
    tone = rb[blk, 9]
    base = tint((62, 58, 53), shp)
    a = lerp_rgb(base, np.broadcast_to(col((98, 90, 79)), shp + (3,)), sstep(0.25, 0.7, tone))
    a = lerp_rgb(a, np.broadcast_to(col((108, 100, 88)), shp + (3,)), sstep(0.72, 1.0, tone) * 0.7)
    warm = (rb[blk, 0] - 0.5) * 0.16
    a[..., 0] *= 1 + warm
    a[..., 2] *= 1 - warm
    cool = sstep(0.8, 1.0, rb[blk, 0]) * 0.5  # a few blocks of cold blue-grey limestone
    a = lerp_rgb(a, np.broadcast_to(col((84, 92, 98)), shp + (3,)), cool * face * 0.55)
    a *= (1.0 + 0.04 * undul + 0.05 * w_lo)[..., None]
    # worn arrises read paler, chips paler still
    edge_zone = (1.0 - sstep(0.0, 0.035, e_w)) * face
    a = lerp_rgb(a, np.broadcast_to(col((128, 118, 104)), shp + (3,)), 0.30 * edge_zone + 0.25 * chip * face)
    # soft grime drips below each bed joint
    streak = F.spectral(beta=2.0, fmin=3, fmax=160, sx=1.0, sy=12.0)
    from_top = (v - top) * T
    run = np.exp(-from_top / (0.16 + 0.3 * sstep(-1, 1.5, w_lo))) * sstep(-0.2, 1.0, streak)
    a *= (1.0 - 0.32 * run * face)[..., None]
    mortar_c = col((30, 28, 26)) * (0.85 + 0.2 * sstep(-1.5, 1.5, w_mid))[..., None]
    a = lerp_rgb(mortar_c, a, prof)
    rough = 0.84 - 0.14 * run * face + 0.06 * (1.0 - prof) - 0.04 * edge_zone
    return dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp), ao_k=2.4, ao_scales=(0.01, 0.03, 0.08), nstrength=0.85, albedo_ao=0.5)


def mat_floor_calm(F):
    n = F.n
    shp = (n, n)
    T = F.tile
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    w_lo = F.spectral(beta=3.4, fmax=6)
    w_mid = F.spectral(beta=2.6, fmin=4, fmax=60)
    row, blk, nb, left, right, lu, top, bot = _layout(F, rs, 3, 1.2, 2.0, 0.9, 1.5)
    v = F.v
    jit = 0.002 * w_mid
    qx = np.minimum(lu - left, right - lu) * T + jit - 0.008
    qy = np.minimum(v - top, bot - v) * T + jit - 0.008
    mn = np.minimum(qx, qy)
    rc = 0.015
    corner = rc - np.hypot(np.clip(rc - qx, 0, None), np.clip(rc - qy, 0, None))
    e = np.where(mn >= rc, mn, corner)
    rb = rs.random((nb, 8))
    prof = sstep(-0.002, 0.016, e)
    face = sstep(-0.002, 0.004, e)
    bcx = (left + right) * 0.5
    bcy = (top + bot) * 0.5
    lx = (lu - bcx) * T
    ly = (v - bcy) * T
    tilt = (rb[blk, 2] - 0.5) * 0.006 * lx + (rb[blk, 3] - 0.5) * 0.006 * ly
    undul = F.spectral(beta=3.0, fmin=2, fmax=28)
    face_h = tilt + (rb[blk, 4] - 0.5) * 0.006 + 0.0014 * undul + 0.0002 * F.spectral(beta=1.6, fmin=100, fmax=360)
    h = -0.016 * (1.0 - prof) + face_h * prof
    tone = rb[blk, 5]
    base = tint((66, 62, 57), shp)
    a = lerp_rgb(base, np.broadcast_to(col((98, 90, 80)), shp + (3,)), sstep(0.2, 0.85, tone))
    warm = (rb[blk, 0] - 0.5) * 0.12
    a[..., 0] *= 1 + warm
    a[..., 2] *= 1 - warm
    a *= (1.0 + 0.035 * undul + 0.06 * w_lo)[..., None]
    # foot-worn centres: slightly paler, smoother
    wear = sstep(0.55, 0.0, np.hypot(lx / np.maximum((right - left) * T * 0.5, 0.1), ly / np.maximum((bot - top) * T * 0.5, 0.1)))
    a = lerp_rgb(a, np.broadcast_to(col((108, 100, 88)), shp + (3,)), 0.12 * wear * face)
    mortar_c = col((30, 28, 26)) * (0.85 + 0.2 * sstep(-1.5, 1.5, w_mid))[..., None]
    a = lerp_rgb(mortar_c, a, prof)
    rough = 0.80 - 0.10 * wear * face + 0.07 * (1.0 - prof) + 0.04 * w_lo
    return dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp), ao_k=2.0, ao_scales=(0.01, 0.03, 0.08), nstrength=0.7, albedo_ao=0.45)


def mat_iron_calm(F):
    """Riveted iron plate (2 m tile): 1 x 0.5 m plates with grooved seams and rivet rows, per-plate value variation, soft rust
    blooms; the old set's spotted rust / patina read as camouflage noise on every girder."""
    n = F.n
    shp = (n, n)
    T = F.tile
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    w_lo = F.spectral(beta=3.4, fmax=6)
    w_mid = F.spectral(beta=2.6, fmin=4, fmax=60)
    x = F.u * T
    y = F.v * T
    pw, ph = 1.0, 0.5
    col_i = np.floor(x / pw).astype(np.int64)
    row_i = np.floor(y / ph).astype(np.int64)
    pid = (row_i * 7 + col_i * 3 + ((row_i * 5) % 3)) % 11
    tone_tab = rs.uniform(0.78, 1.18, 11)
    rust_tab = rs.uniform(0.0, 1.0, 11)
    fx = (x / pw - col_i) * pw  # position inside the plate (m)
    fy = (y / ph - row_i) * ph
    dx = np.minimum(fx, pw - fx)
    dy = np.minimum(fy, ph - fy)
    seam = np.minimum(dx, dy)
    groove = np.exp(-(seam / 0.006) ** 2)
    # rivets: 0.125 m spacing along the seams, 3 cm inside them
    sp = 0.125
    rivet = np.zeros(shp)
    for axis in (0, 1):
        if axis == 0:  # along the horizontal seam
            d_seam = np.abs(dy - 0.03)
            along = (fx / sp - np.floor(fx / sp) - 0.5) * sp
        else:
            d_seam = np.abs(dx - 0.03)
            along = (fy / sp - np.floor(fy / sp) - 0.5) * sp
        r = np.hypot(d_seam, along)
        rivet = np.maximum(rivet, np.sqrt(np.clip(1 - (r / 0.011) ** 2, 0, 1)))
    undul = F.spectral(beta=3.0, fmin=2, fmax=30)
    h = -0.004 * groove + 0.0035 * rivet + 0.0008 * undul + 0.00015 * F.spectral(beta=1.6, fmin=80, fmax=300)
    base = tint((54, 54, 58), shp) * tone_tab[pid][..., None]
    rust_zone = sstep(1.1, 2.1, w_lo + 0.5 * w_mid + 0.9 * (rust_tab[pid] - 0.4))
    a = lerp_rgb(base, np.broadcast_to(col((86, 52, 36)), shp + (3,)), 0.4 * rust_zone)
    a = lerp_rgb(a, np.broadcast_to(col((22, 22, 24)), shp + (3,)), 0.6 * groove)
    a = lerp_rgb(a, np.broadcast_to(col((92, 90, 88)), shp + (3,)), 0.35 * rivet)
    streak = F.spectral(beta=2.0, fmin=3, fmax=160, sx=1.0, sy=14.0)
    a *= (1.0 - 0.22 * sstep(0.2, 1.4, streak) * sstep(-0.5, 1.0, w_lo))[..., None]
    rough = 0.52 + 0.28 * rust_zone + 0.05 * groove - 0.06 * rivet + 0.04 * w_mid
    metal = np.clip(0.85 - 0.8 * rust_zone, 0, 1)
    return dict(albedo=a, height=h, rough=rough, metal=metal, ao_k=2.0, ao_scales=(0.004, 0.012, 0.03), nstrength=0.9, albedo_ao=0.5)


hq.SETS["rock"] = (mat_wall_calm, 4.0, 2048, 1101, True, 0.00012, "stone", "calm Lanternwright wall ashlar: big staggered blocks, deep joints, chipped corners, per-block value variation")
hq.SETS["metal"] = (mat_iron_calm, 2.0, 2048, 3303, True, 0.00005, "metal", "calm riveted iron plate: grooved seams, rivet rows, per-plate value, soft rust blooms")
hq.SETS["masonry"] = (mat_floor_calm, 4.0, 2048, 2202, True, 0.0001, "stone", "calm flagstones / dressed slabs: soft tone variation, shallow joints, no pits")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", default=hq.DEFAULT_OUT)
    ap.add_argument("--sets", default="rock,masonry,metal")
    ap.add_argument("--tilecheck", default="")
    a = ap.parse_args()
    names = [s for s in a.sets.split(",") if s]
    entries = {n: hq.bake(n, a.work, a.out) for n in names}
    print("[art] manifest ->", hq.write_manifest(a.out, entries))
    if a.tilecheck:
        hq.tilecheck(a.work, a.tilecheck, names)
