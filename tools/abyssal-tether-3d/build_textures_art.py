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
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_textures as bt  # noqa: E402
import build_textures_hq as hq  # noqa: E402
from build_textures import col, contour_dist, drag_down, frac, lerp_rgb, ridged, sstep, tint  # noqa: E402


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


# =============================================================================
# WP-TEX-PBR enrichment: real sculpted detail on top of the calm layouts (the calm pass removed the noise but also the stone).
# Everything is periodic (FFT fields / periodic Worley), metres-scaled (fmin / fmax in cycles per tile so 2048 px keeps ~2 mm
# per pixel on a 4 m tile), and amplitude is balanced against the shared 0.5 m detail normal the shader layers on top: the
# baked relief carries the 1-3 cm meso layer (tooling, peck, erosion, cracks, pits), the detail normal only the grain.
# =============================================================================
def _gather(tab, blk):
    return tab[blk]


def _pits(F, cells, r_cell, density, depth_lo, depth_hi, gate):
    """Periodic Worley pits: spherical bowls of radius r_cell (cell units) in a random `density` fraction of cells.
    Returns (depth in m >= 0, bowl profile 0..1)."""
    f1, f2, cid, _, _ = F.worley(cells, cells, jitter=0.9)
    rr = np.random.default_rng(F.rng.integers(1 << 30))
    keep = rr.random(cells * cells)
    dep = rr.uniform(depth_lo, depth_hi, cells * cells)
    on = (keep[cid] < density) & gate
    bowl = np.sqrt(np.clip(1.0 - (f1 / r_cell) ** 2, 0.0, 1.0)) * on
    return dep[cid] * bowl, bowl


def enrich_stone(F, m, c):
    n = F.n
    k = n / 2048.0
    blk, nb, face, prof = c["blk"], c["nb"], c["face"], c["prof"]
    wall = c["wall"]
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    pb = rs.random((nb, 8))  # 0 finish class, 1 tooth direction, 2 pit density, 3 lichen affinity, 4 crack flag, 5 erosion, 6 damp, 7 grain
    fin = pb[blk, 0]
    h = m["height"]
    a = m["albedo"]
    rough = m["rough"]
    joint = 1.0 - prof
    # ---- finish classes per block: smooth dressed / tooled (chisel) / pecked / rock-faced (wall only)
    smooth_hi = 0.30 if wall else 0.50
    tool = ((fin >= smooth_hi) & (fin < 0.68)).astype(np.float64)
    peck = ((fin >= 0.68) & (fin < (0.86 if wall else 1.01))).astype(np.float64)
    cleft = (fin >= 0.86).astype(np.float64) if wall else np.zeros_like(fin)
    # chisel tooth: three directions, strokes ~1 cm apart and ~8 cm long
    sel = np.clip((pb[blk, 1] * 3).astype(np.int64), 0, 2)
    chs = [F.spectral(beta=1.7, fmin=60 * k, fmax=380 * k, sx=1.0, sy=7.0, angle=ang) for ang in (0.0, math.pi / 2, math.pi / 4)]
    chis = np.where(sel == 0, chs[0], np.where(sel == 1, chs[1], chs[2]))
    del chs
    chis = np.tanh(0.8 * chis)
    drift = F.spectral(beta=2.6, fmin=6, fmax=40)  # the chisel pressure drifts across the face
    amp_t = (0.0010 if wall else 0.0006) * (0.6 + 0.4 * np.tanh(drift))
    h = h + face * tool * amp_t * chis
    # pecked faces: bowls 1-4 mm deep over a ground of fine bruising
    pk_d, pk_bowl = _pits(F, 150, 0.34, 0.55, 0.0012, 0.0040, (peck > 0.5) & (face > 0.5))
    h = h - pk_d
    bruise = F.spectral(beta=1.6, fmin=120 * k, fmax=520 * k)
    h = h + face * peck * 0.0005 * bruise
    # rock-faced (split) blocks: shallow ridged cleavage 5-9 mm
    cl = F.spectral(beta=2.5, fmin=7, fmax=55)
    cr = ridged(F, 2.2, 8, 90)
    h = h + face * cleft * (0.0045 * cl + 0.0040 * (cr - 0.3))
    # erosion + bedding of the soft layers (all faces, weighted per block); horizontal strata on walls
    er = ridged(F, 2.3, 5, 150)
    bed = F.spectral(beta=2.0, fmin=14, fmax=160, sx=1.0, sy=0.1 if wall else 0.5)
    er_w = 0.25 + 0.75 * pb[blk, 5]
    h = h + face * er_w * (0.0013 * (er - 0.25) + 0.0007 * bed)
    # spalls: shallow layers that flaked off (sharp edge, 0.6-1.6 mm deep) and, on floors, foot-worn dishing in the slab centres
    sp_f = F.spectral(beta=2.4, fmin=5, fmax=40) + 0.25 * F.spectral(beta=1.8, fmin=40, fmax=260)
    spall = sstep(0.95, 1.05, sp_f + 1.2 * (pb[blk, 5] - 0.6)) * face
    h = h - spall * (0.0006 + 0.0010 * sstep(-1, 1, F.spectral(beta=2.5, fmin=8, fmax=60)))
    if not wall:
        h = h - 0.0018 * c["wear"] * face
    # fine sugaring grain + sparse pinholes on every face
    gr = F.spectral(beta=1.3, fmin=260 * k, fmax=900 * k)
    h = h + face * 0.00018 * gr
    ph_d, ph_b = _pits(F, 330, 0.36, 0.22, 0.0004, 0.0016, face > 0.5)
    h = h - ph_d
    # hairline + open cracks (some blocks only): thin, wobbling, 2-6 mm wide, 3-6 mm deep
    cf = F.spectral(beta=3.2, fmin=2, fmax=22) + 0.07 * F.spectral(beta=1.8, fmin=30, fmax=300)
    d = contour_dist(F, cf)
    gate = sstep(0.3, 1.2, F.spectral(beta=3.0, fmin=1.5, fmax=7)) * (pb[blk, 4] > (0.45 if wall else 0.62))
    wid = 0.0016 + 0.0016 * sstep(-1, 1, F.spectral(beta=2.0, fmin=10, fmax=80))
    crack = np.exp(-((d / wid) ** 2)) * gate * face
    h = h - 0.0050 * crack
    del cf, d
    # mortar / joint fill: sandy grain and loose grit
    jg = F.spectral(beta=1.4, fmin=140 * k, fmax=700 * k)
    h = h + joint * 0.0006 * jg
    grit_h, _ = _pits(F, 200, 0.42, 0.8, 0.004, 0.008, joint > 0.55)  # dome-ish: reuse bowl as bumps (sign flipped)
    h = h + grit_h * 0.5
    # ---- albedo
    tooth_lum = 0.5 * np.tanh(2.0 * chis) * tool * face
    mott = F.spectral(beta=1.9, fmin=30, fmax=220)
    spk = F.spectral(beta=1.2, fmin=240 * k, fmax=900 * k)
    a = a * (1.0 + 0.05 * tooth_lum + 0.045 * mott * face + 0.035 * spk * face - 0.0 * joint)[..., None]
    # damp: dark, cool, glossy patches (more toward the foot of each course on walls, in worn low spots on floors)
    d0 = F.spectral(beta=3.0, fmin=2, fmax=11) + 0.35 * F.spectral(beta=2.0, fmin=16, fmax=140)
    if wall and c["run"] is not None:
        d0 = d0 + 0.9 * sstep(0.0, 1.0, c["run"])
    damp = sstep(0.55, 1.5, d0 + 0.6 * (pb[blk, 6] - 0.5))
    a = a * (1.0 - 0.20 * damp)[..., None]
    a = a * (1.0 + 0.04 * damp[..., None] * np.array([-1.0, 0.0, 1.0]))  # damp stone reads a touch cooler
    # lichen / crust: muted olive-grey crusts on a few blocks, raised a fraction of a mm and a touch rougher
    lf = F.spectral(beta=2.6, fmin=4, fmax=45) + 0.5 * F.spectral(beta=1.5, fmin=60, fmax=520)
    lich = sstep(1.15, 1.7, lf + 1.1 * (pb[blk, 3] - 0.55)) * face
    lcol = np.broadcast_to(col((96, 100, 78)), a.shape) * (0.75 + 0.25 * sstep(-1, 1, spk))[..., None]
    a = lerp_rgb(a, lcol, 0.32 * lich)
    h = h + 0.0007 * lich * (0.5 + 0.5 * np.tanh(spk))
    # cracks darken, pits darken, joints keep their dark sandy mortar with pale grit
    a = a * (1.0 - 0.10 * spall - 0.40 * crack - 0.18 * np.clip(pk_bowl, 0, 1) * face - 0.10 * np.clip(ph_b, 0, 1) * face)[..., None]
    a = lerp_rgb(a, np.broadcast_to(col((78, 70, 60)), a.shape), 0.35 * np.clip(grit_h / 0.004, 0, 1) * joint)
    if not wall:
        # scuffs from boots and dragged loads: a few thin pale scratches
        sc = [F.spectral(beta=1.5, fmin=40 * k, fmax=500 * k, sx=1.0, sy=30.0, angle=ang) for ang in (0.3, 1.2, 2.5)]
        scr = sstep(2.1, 3.2, np.maximum(np.maximum(sc[0], sc[1]), sc[2])) * sstep(0.2, 1.1, F.spectral(beta=3.0, fmin=2, fmax=9)) * face
        del sc
        h = h - 0.00025 * scr
        a = lerp_rgb(a, np.broadcast_to(col((124, 116, 104)), a.shape), 0.30 * scr)
        rough = rough - 0.12 * scr
    # ---- roughness: damp patches gloss, pits and crust are rougher, polished arrises (finish() adds more), tooling anisotropy
    rough = rough - 0.20 * damp * face + 0.10 * lich + 0.10 * np.clip(pk_bowl, 0, 1) + 0.08 * crack + 0.05 * spk * face + 0.05 * tool * np.abs(chis)
    rough = rough + 0.08 * joint
    m.update(albedo=np.clip(a, 0, 1), height=h, rough=np.clip(rough, 0.18, 1.0))
    return m


def enrich_iron(F, m, c):
    n = F.n
    k = n / 2048.0
    pid, groove, rivet, rust_zone = c["pid"], c["groove"], c["rivet"], c["rust_zone"]
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    h, a, rough, metal = m["height"], m["albedo"], m["rough"], m["metal"]
    face = 1.0 - np.clip(groove * 1.4, 0, 1)
    # plates sit at slightly different heights; hammered dimples; forge scale
    h = h + rs.uniform(-0.0006, 0.0006, 11)[pid]
    dent = F.spectral(beta=2.4, fmin=14, fmax=70)
    h = h + face * 0.0007 * dent
    # blistered rust scale: domed cells 3 cm across, each with its own height / colour, cracked between
    f1, f2, cid, _, _ = F.worley(70, 70, jitter=0.95)
    cell_r = rs.random(70 * 70)
    rim = sstep(0.0, 0.22, f2 - f1)
    dome = rim * (0.45 + 0.55 * cell_r[cid]) * (1.0 - 0.5 * sstep(0.0, 0.7, f1))
    scale_mask = sstep(0.55, 1.35, rust_zone * 2.0 + 0.5 * F.spectral(beta=2.2, fmin=6, fmax=60) - 0.25)
    h = h + scale_mask * (0.0022 * dome - 0.0006)
    # pitting beneath the rust (and a few clean pits elsewhere)
    pit_d, pit_b = _pits(F, 300, 0.38, 0.22, 0.0004, 0.0016, face > 0.2)
    pit_d = pit_d * (0.15 + 0.85 * scale_mask)
    h = h - pit_d
    # brushed / drawn grain along the plate, scratches at three angles
    br = F.spectral(beta=1.4, fmin=160 * k, fmax=720 * k, sx=1.0, sy=14.0)
    h = h + face * (1.0 - scale_mask) * 0.00015 * br
    sc = [F.spectral(beta=1.5, fmin=40 * k, fmax=520 * k, sx=1.0, sy=34.0, angle=ang) for ang in (0.2, 1.0, 2.2)]
    scr = sstep(2.0, 3.1, np.maximum(np.maximum(sc[0], sc[1]), sc[2])) * sstep(-0.3, 0.8, F.spectral(beta=3.0, fmin=2, fmax=8)) * face
    del sc
    h = h - 0.0003 * scr
    # rivet weeps: rust runs down from every rivet head and seam
    wk = drag_down(np.clip(rivet + 0.35 * groove, 0, 1), 110, 4)
    wk = wk * sstep(-0.4, 0.8, F.spectral(beta=2.0, fmin=30, fmax=300, sx=1.0, sy=10.0))
    # ---- albedo
    cr2 = rs.random(70 * 70)
    rust_a = lerp_rgb(col((78, 42, 28)), col((112, 64, 36)), cr2[cid])
    rust_a = rust_a * (0.72 + 0.28 * sstep(0.0, 0.5, f2 - f1))[..., None]  # dark cracks between the scales
    a = lerp_rgb(a, rust_a, 0.5 * scale_mask)
    a = lerp_rgb(a, np.broadcast_to(col((70, 38, 24)), a.shape), 0.45 * wk)
    a = a * (1.0 - 0.16 * np.clip(pit_b, 0, 1))[..., None]
    mott = F.spectral(beta=1.9, fmin=30, fmax=200)
    a = a * (1.0 + 0.05 * mott)[..., None]
    a = lerp_rgb(a, np.broadcast_to(col((126, 122, 116)), a.shape), 0.40 * scr * (1.0 - scale_mask))
    # ---- metal / roughness: scale is dielectric and matte, scratches and rubbed arrises are bright and glossy, weeps are oily
    metal = np.clip(metal * (1.0 - 0.9 * scale_mask) + 0.5 * scr * (1.0 - scale_mask), 0, 1)
    rough = rough + 0.22 * scale_mask + 0.08 * np.clip(pit_b, 0, 1) - 0.14 * scr - 0.10 * wk * (1.0 - scale_mask) + 0.03 * br * face
    m.update(albedo=np.clip(a, 0, 1), height=h, rough=np.clip(rough, 0.2, 1.0), metal=metal)
    return m


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
    m = dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp), ao_k=2.4, ao_scales=(0.004, 0.012, 0.03, 0.08), nstrength=1.15, albedo_ao=0.5)
    return enrich_stone(F, m, dict(blk=blk, nb=nb, face=face, prof=prof, run=run, wall=True))


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
    m = dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp), ao_k=2.0, ao_scales=(0.004, 0.012, 0.03, 0.08), nstrength=1.0, albedo_ao=0.45)
    return enrich_stone(F, m, dict(blk=blk, nb=nb, face=face, prof=prof, run=None, wall=False, wear=wear))


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
    m = dict(albedo=a, height=h, rough=rough, metal=metal, ao_k=2.0, ao_scales=(0.002, 0.006, 0.015, 0.04), nstrength=1.1, albedo_ao=0.5)
    return enrich_iron(F, m, dict(pid=pid, groove=groove, rivet=rivet, rust_zone=rust_zone, w_lo=w_lo))


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
