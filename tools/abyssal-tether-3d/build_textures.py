"""ABYSSAL TETHER 3D — original tileable PBR texture sets, baked from code.

Every map is built with periodic operations only (FFT spectral noise, FFT blurs,
wrapped Worley cells, wrapped bilinear domain warps, np.roll derivatives), so
each texture tiles seamlessly BY CONSTRUCTION — there is no seam to hide.

Sets (1024 x 1024 each, written to public/abyssal-tether-3d/assets/textures/):

  rock      shaft rock: dark layered stone, faulted strata, jointing cracks,
            pale calcite veins, verdigris / rust mineral streaks        (4 m tile)
  masonry   Lanternwright ashlar: dressed blocks in courses, drafted margins,
            worn + chipped arrises, eroded mortar, grime runs, mason marks (4 m)
  metal     corroded iron: blackened scale, flaking rust, pitting, runs (2 m)
  rockFar   distant rock: darker, bigger jointed masses, low detail     (16 m)
  flesh     dark wet sinew: fibre bundles, raised veins, capillaries    (1.5 m)

Per set:  <set>_albedo.jpg  sRGB, JPEG q85
          <set>_normal.jpg  tangent space, OpenGL convention (+Y = green = up
                            the image, i.e. toward +v), JPEG q92, 4:4:4
          <set>_orm.jpg     R = ambient occlusion, G = roughness, B = metalness
                            (linear; same packing as glTF / three.js), JPEG q90, 4:4:4
plus manifest.json: {"<set>": {"albedo", "normal", "orm", "tileMeters", ...}}
(file names are relative to manifest.json).

Run (numpy + Pillow; the Blender venv has both — bpy is only needed for --preview):

  python tools/abyssal-tether-3d/build_textures.py                 # bake all sets
  python tools/abyssal-tether-3d/build_textures.py --sets rock,metal
  python tools/abyssal-tether-3d/build_textures.py --tilecheck <dir>   # 2x2 tiling sheets
  python tools/abyssal-tether-3d/build_textures.py --preview       # + Cycles preview sheet
         (previews/textures.png; needs `bpy`, e.g. the headless Blender venv)
"""

import argparse
import json
import math
import os
import sys
import zlib

import numpy as np

try:
    from PIL import Image, ImageDraw, ImageFile

    # optimize/progressive JPEG encoding needs the whole scan in one buffer (Pillow's
    # default is too small for 1024^2 4:4:4 maps -> "Suspension not allowed here").
    ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 1 << 24)
except ImportError:  # pragma: no cover - Pillow is required for writing images
    Image = None
    ImageDraw = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(ROOT, "public", "abyssal-tether-3d", "assets", "textures")
DEFAULT_PREVIEW = os.path.join(HERE, "previews", "textures.png")

# The 2D game's base palette (sRGB 0..255, public/abyssal-tether/js/render.js MAT).
PAL = {
    "stone": (60, 56, 51),
    "stoneDark": (30, 28, 26),
    "iron": (52, 52, 53),
    "rust": (122, 59, 34),
    "verd": (63, 107, 99),
    "bone": (150, 142, 124),
    "growth": (64, 52, 46),
}


# =============================================================================
# Periodic field toolkit. Arrays are [row, col] = [v, u]; row 0 is the TOP of
# the image. All operations wrap around both axes.
# =============================================================================
class Field:
    def __init__(self, n, seed, tile_m):
        self.n = n
        self.tile = tile_m  # metres covered by one tile
        self.px = tile_m / n  # metres per pixel
        self.rng = np.random.default_rng(seed)
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
        self.u = (xx + 0.5) / n  # 0..1 left -> right
        self.v = (yy + 0.5) / n  # 0..1 top -> bottom (row direction)
        f = np.fft.fftfreq(n) * n  # integer cycles per tile
        self.FX, self.FY = np.meshgrid(f, f)

    # ---- noise -------------------------------------------------------------
    def spectral(self, beta=2.0, fmin=1.0, fmax=None, sx=1.0, sy=1.0, angle=0.0):
        """Zero-mean, unit-std periodic noise with power spectrum ~ f^-beta.

        sx / sy stretch the features along u / v (sy > 1 -> streaks running down):
        frequencies along a stretched axis are compressed, so variation along it is slow.
        `angle` (radians) rotates that stretch frame. Band-limited to [fmin, fmax] (in the
        stretched metric) with soft edges. Any filter on the integer DFT frequencies keeps
        the result exactly periodic, rotated or not.
        """
        fa = self.FX * math.cos(angle) + self.FY * math.sin(angle)
        fb = -self.FX * math.sin(angle) + self.FY * math.cos(angle)
        fr = np.sqrt((fa * sx) ** 2 + (fb * sy) ** 2)
        amp = np.zeros_like(fr)
        nz = fr > 0
        amp[nz] = fr[nz] ** (-beta / 2.0)
        amp *= 1.0 / (1.0 + np.exp(np.clip(-(fr - fmin) * 3.0, -60, 60)))
        if fmax is not None:
            amp *= 1.0 / (1.0 + np.exp(np.clip((fr - fmax) * 3.0 / max(1.0, fmax * 0.15), -60, 60)))
        w = self.rng.standard_normal((self.n, self.n))
        out = np.fft.ifft2(np.fft.fft2(w) * amp).real
        out -= out.mean()
        sd = out.std()
        return out / sd if sd > 0 else out

    def blur(self, img, sigma_px):
        if sigma_px <= 0:
            return img
        k = np.exp(-2.0 * (math.pi * sigma_px / self.n) ** 2 * (self.FX ** 2 + self.FY ** 2))
        return np.fft.ifft2(np.fft.fft2(img) * k).real

    def blur_m(self, img, sigma_m):
        return self.blur(img, sigma_m / self.px)

    def sample(self, img, x, y):
        """Bilinear wrapped lookup; x, y in tile units (any real value)."""
        n = self.n
        fx = x * n - 0.5
        fy = y * n - 0.5
        x0 = np.floor(fx)
        y0 = np.floor(fy)
        tx = fx - x0
        ty = fy - y0
        x0 = x0.astype(np.int64) % n
        y0 = y0.astype(np.int64) % n
        x1 = (x0 + 1) % n
        y1 = (y0 + 1) % n
        a = img[y0, x0] * (1 - tx) + img[y0, x1] * tx
        b = img[y1, x0] * (1 - tx) + img[y1, x1] * tx
        return a * (1 - ty) + b * ty

    def warp(self, img, du, dv):
        return self.sample(img, self.u + du, self.v + dv)

    def worley(self, gx, gy, x=None, y=None, jitter=0.9):
        """Periodic Worley cells (gx x gy feature points per tile).

        Returns F1, F2 (in cell units), the nearest cell id, and the nearest feature
        point's offset from the pixel (dx, dy, cell units).
        """
        x = self.u if x is None else x
        y = self.v if y is None else y
        pts = (self.rng.random((gy, gx, 2)) - 0.5) * jitter + 0.5
        px = x * gx
        py = y * gy
        cx = np.floor(px).astype(np.int64)
        cy = np.floor(py).astype(np.int64)
        f1 = np.full(px.shape, 1e9)
        f2 = np.full(px.shape, 1e9)
        cid = np.zeros(px.shape, np.int64)
        ddx = np.zeros(px.shape)
        ddy = np.zeros(px.shape)
        for oy in (-1, 0, 1):
            for ox in (-1, 0, 1):
                nx = cx + ox
                ny = cy + oy
                wx = nx % gx
                wy = ny % gy
                fx = nx + pts[wy, wx, 0]
                fy = ny + pts[wy, wx, 1]
                dx = fx - px
                dy = fy - py
                d = np.sqrt(dx * dx + dy * dy)
                closer = d < f1
                f2 = np.where(closer, f1, np.minimum(f2, d))
                f1 = np.where(closer, d, f1)
                cid = np.where(closer, wy * gx + wx, cid)
                ddx = np.where(closer, dx, ddx)
                ddy = np.where(closer, dy, ddy)
        return f1, f2, cid, ddx, ddy

    def per_cell(self, count, lo=0.0, hi=1.0):
        return self.rng.uniform(lo, hi, count)


# ---- small helpers ----------------------------------------------------------
def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def frac(x):
    return x - np.floor(x)


def col(rgb):
    return np.array(rgb, dtype=np.float64) / 255.0


def lerp_rgb(a, b, t):
    """a, b: (H,W,3) or (3,); t: (H,W)."""
    t = t[..., None]
    return a * (1.0 - t) + b * t


def tint(rgb, shape):
    return np.broadcast_to(col(rgb), shape + (3,)).copy()


def remap01(x, lo=None, hi=None):
    lo = x.min() if lo is None else lo
    hi = x.max() if hi is None else hi
    return np.clip((x - lo) / max(hi - lo, 1e-12), 0.0, 1.0)


def normals_from_height(F, h, strength=1.0):
    """Tangent-space normal (OpenGL / +Y up the image) from a height field in metres."""
    dhdu = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2.0 * F.px)
    # v grows UP the image (toward row 0), rows grow down: dh/dv = (h[r-1] - h[r+1]) / 2px
    dhdv = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) / (2.0 * F.px)
    nx = -dhdu * strength
    ny = -dhdv * strength
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx * inv, ny * inv, nz * inv], axis=-1)


def ambient_occlusion(F, h, scales_m, k=1.0):
    """Cheap multi-scale cavity AO: how far each pixel sits below its blurred surroundings."""
    occ = np.zeros_like(h)
    for s in scales_m:
        occ += np.clip((F.blur_m(h, s) - h) / s, 0.0, None)
    occ /= len(scales_m)
    return np.clip(1.0 - k * occ, 0.0, 1.0)


# =============================================================================
# Materials. Each returns dict(albedo (H,W,3) sRGB 0..1, height m, rough, metal,
# ao_k, ao_scales, nstrength, albedo_ao).
# =============================================================================
def grad_mag(F, f):
    """|grad f| per metre (central differences, wrapped)."""
    gx = (np.roll(f, -1, axis=1) - np.roll(f, 1, axis=1)) / (2.0 * F.px)
    gy = (np.roll(f, -1, axis=0) - np.roll(f, 1, axis=0)) / (2.0 * F.px)
    return np.sqrt(gx * gx + gy * gy) + 1e-9


def contour_dist(F, f):
    """Approximate distance (m) to the zero contour of a smooth field: |f| / |grad f|."""
    return np.abs(f) / grad_mag(F, f)


def ridged(F, beta, fmin, fmax, sx=1.0, sy=1.0):
    """Ridged noise in 0..1: sharp crests along the zero set, broad troughs."""
    r = 1.0 - np.abs(np.tanh(F.spectral(beta=beta, fmin=fmin, fmax=fmax, sx=sx, sy=sy) * 0.9))
    return r * r


def drag_down(src, steps, step_px):
    """Smear a source mask downward (row direction) with linear falloff — water runs."""
    out = np.zeros_like(src)
    for k in range(1, steps + 1):
        out = np.maximum(out, np.roll(src, k * step_px, axis=0) * (1.0 - k / (steps + 1.0)))
    return out


def layered_rock(F, P):
    """Bedded, jointed rock face. P: parameter dict (lengths in metres)."""
    n = F.n
    shp = (n, n)
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    T = F.tile
    w_lo = F.spectral(beta=3.4, fmax=8)
    w_lo2 = F.spectral(beta=3.4, fmax=8)
    w_mid = F.spectral(beta=2.6, fmin=3, fmax=60)

    # --- bed coordinate (tile units, grows down the image) with gentle undulation + faults
    yy = F.v + P["bed_warp"] * w_lo + 0.15 * P["bed_warp"] * w_mid
    fault = np.zeros(shp)
    for c, wdt, disp in P["faults"]:
        fu = F.u + 0.02 * w_lo2 + 0.035 * np.sin(2 * math.pi * (F.v + c))  # gentle bow, periodic in v
        q = frac(fu - c)
        slab = sstep(0.0, 0.004, q) * (1.0 - sstep(wdt - 0.004, wdt, q))
        yy = yy + disp * slab
        d = np.minimum(np.minimum(q, np.abs(q - wdt)), 1.0 - q) * T
        fault = np.maximum(fault, np.exp(-(d / P["fault_w"]) ** 2))

    # --- beds
    nb = P["beds"]
    th = rs.uniform(0.4, 1.6, nb)
    bed_edges = np.concatenate([[0.0], np.cumsum(th / th.sum())])
    hard = rs.uniform(0.0, 1.0, nb)
    tone = rs.uniform(0.0, 1.0, nb)
    hue = rs.uniform(-1.0, 1.0, nb)
    t = frac(yy)
    bed = np.clip(np.searchsorted(bed_edges, t, side="right") - 1, 0, nb - 1)
    btop = bed_edges[bed]
    bbot = bed_edges[bed + 1]
    pos = (t - btop) / (bbot - btop)

    # --- joints inside each bed: near-vertical fractures, offset bed to bed
    blk = np.zeros(shp, np.int64)
    jl = np.zeros(shp)  # distance to the left / right joint (m)
    jr = np.zeros(shp)
    jhalf = np.zeros(shp)  # half opening of the nearer joint (m)
    nblk = 0
    jw = 0.25 * w_mid  # joint wobble (scaled below)
    for b in range(nb):
        m = bed == b
        if not np.any(m):
            continue
        c0 = rs.uniform(0, 1)
        cuts = [c0]
        acc = c0
        sp_mul = 1.0 if hard[b] > 0.45 else 3.0  # soft, fissile beds are rarely jointed
        while len(cuts) < 60:
            acc += rs.uniform(*P["joint_spacing"]) * sp_mul / T
            if acc > c0 + 1.0 - 0.6 * P["joint_spacing"][0] * sp_mul / T:
                break
            cuts.append(acc)
        cuts = np.sort(frac(np.array(cuts)))
        tilt = rs.uniform(-P["joint_tilt"], P["joint_tilt"])
        uu = frac(F.u[m] + tilt * (t[m] - btop[m]) + P["joint_wobble"] * jw[m])
        k = np.searchsorted(cuts, uu, side="right") - 1  # -1 = wrapped segment
        lo = np.where(k >= 0, cuts[np.clip(k, 0, None)], cuts[-1] - 1.0)
        hi = np.where(k + 1 < len(cuts), cuts[np.clip(k + 1, 0, len(cuts) - 1)], cuts[0] + 1.0)
        seg = np.where(k >= 0, k, len(cuts) - 1)
        jl[m] = (uu - lo) * T
        jr[m] = (hi - uu) * T
        open_l = rs.uniform(*P["joint_open"], len(cuts))
        jhalf[m] = np.where(jl[m] < jr[m], open_l[np.clip(seg, 0, len(cuts) - 1)],
                            open_l[(np.clip(seg, 0, len(cuts) - 1) + 1) % len(cuts)])
        blk[m] = nblk + seg
        nblk += len(cuts)

    rb = rs.random((max(nblk, 1), 5))
    bed_thick = (bbot - btop) * T
    by = pos * bed_thick  # metres from the bed top
    dist_bed = np.minimum(by, bed_thick - by)
    hb = hard[bed]
    is_hard = sstep(0.35, 0.65, hb)  # hard beds stand proud as ledges; soft (fissile) beds recede
    # partings and joints are open only in places; elsewhere the faces just meet
    open_var = sstep(-0.3, 1.2, F.spectral(beta=2.8, fmin=2, fmax=40)) * 1.6
    dist_joint = np.minimum(jl, jr) - jhalf * open_var * (0.25 + 0.75 * is_hard)
    bed_gap = P["bed_gap"] * open_var
    e = np.minimum(dist_joint, dist_bed - bed_gap)  # distance into the block face (m)

    # arrises: crisp, chipped lips on hard beds; broad rounded crumbly edges on soft beds
    chipn = F.spectral(beta=2.0, fmin=6, fmax=200)
    rw_hard = P["round"][0] + (P["round"][1] - P["round"][0]) * rb[blk, 0] * 0.5
    rw_soft = P["round"][1] * (1.0 + rb[blk, 0])
    round_w = rw_soft + (rw_hard - rw_soft) * is_hard
    # where a parting / joint is closed the faces meet nearly flush (barely any groove)
    round_w = round_w * (0.12 + 0.88 * sstep(0.0, 0.6, open_var))
    e_chip = e - P["chip"] * sstep(0.3, 1.6, chipn) * (0.4 + 0.6 * is_hard) * sstep(0.0, 0.6, open_var)
    face = sstep(-0.002, round_w, e_chip)
    lip = sstep(-0.002, 0.004, e_chip)  # 1 on stone, 0 inside an open parting / joint

    # block bodies
    lx = 0.5 * (jl - jr)  # metres from the block centre, across
    ly = by - bed_thick * 0.5
    facet = (P["facet"] * ((rb[blk, 1] - 0.5) * lx + (rb[blk, 2] - 0.5) * ly * 1.5)
             + P["lift"] * (rb[blk, 3] - 0.5)) * (0.3 + 0.7 * is_hard)
    undercut = sstep(0.55, 1.0, pos) * is_hard  # ledges are undercut where the soft bed below erodes
    hard_body = P["bed_relief"] * (0.6 + 0.4 * hb) - 0.3 * P["bed_relief"] * undercut
    soft_body = -0.35 * P["bed_relief"]
    body = soft_body + (hard_body - soft_body) * is_hard + facet

    # broken faces: a few broad fracture terraces on hard beds (stretched along the bedding)
    tn = F.warp(F.spectral(beta=3.0, fmin=P["terr_fmin"], fmax=P["terr_fmax"], sx=2.5, sy=1.0),
                0.006 * w_mid, 0.0)
    tq = tn * P["terr_k"]
    terr = (np.floor(tq) + sstep(0.65, 1.0, frac(tq))) / P["terr_k"]
    terr = (terr - terr.mean()) * is_hard
    rid = ridged(F, 2.4, P["terr_fmax"], P["terr_fmax"] * 8) * sstep(0.0, 1.2, w_mid)
    # fissile laminations on soft beds: many small steps along the bedding
    lam = yy * P["lam_k"] + 0.35 * F.spectral(beta=2.8, fmin=2, fmax=40)
    saw = sstep(0.0, 0.12, frac(lam)) - frac(lam)
    lam_w = 0.35 + 0.65 * (1.0 - is_hard)
    grain = F.spectral(beta=2.0, fmin=30, fmax=260)
    crumble = np.clip(F.spectral(beta=1.8, fmin=12, fmax=200) - 0.5, 0, None) * (1.0 - is_hard)
    surf = (P["terr_amp"] * terr + P["rid_amp"] * rid + P["lam_amp"] * lam_w * saw
            + P["grain"] * grain - P["lam_amp"] * 0.8 * crumble)

    recess = -P["gap_depth"] * (0.6 + 0.4 * sstep(-1, 1, w_mid))
    h = recess * (1.0 - face) + (body + surf) * face
    h -= P["fault_depth"] * fault
    h += P["macro"] * w_lo

    # --- albedo
    dark = col(P["dark"])
    mid = col(P["mid"])
    pale = col(P["pale"])
    green = col(P["greenish"])
    tb = tone[bed]
    a = lerp_rgb(np.broadcast_to(dark, shp + (3,)), np.broadcast_to(mid, shp + (3,)),
                 sstep(0.0, 0.55, tb) * (0.55 + 0.45 * is_hard))
    a = lerp_rgb(a, np.broadcast_to(pale, a.shape), sstep(0.7, 1.0, tb) * 0.35 * is_hard)
    a = lerp_rgb(a, np.broadcast_to(green, a.shape), np.clip(hue[bed], 0, 1) * 0.3)
    warmish = np.clip(-hue[bed], 0, 1) * 0.05 + 0.03 * (1.0 - is_hard)  # shales a touch browner
    a[..., 0] *= 1 + warmish
    a[..., 2] *= 1 - warmish
    a *= (1.0 + 0.08 * (rb[blk, 4] - 0.5) + 0.10 * w_lo + 0.05 * w_mid + 0.04 * grain)[..., None]
    a *= (1.0 + 0.12 * saw * lam_w)[..., None]
    # curvature: weathered convex lips a little paler, grime in the concave
    curv = h - F.blur_m(h, P["curv_r"])
    cv = np.tanh(curv / P["curv_s"])
    a *= (1.0 + 0.16 * np.clip(cv, 0, 1) - 0.2 * np.clip(-cv, 0, 1))[..., None]
    a *= (1.0 - 0.35 * (1.0 - lip) - 0.25 * fault - 0.15 * crumble)[..., None]

    # calcite veins (thin, partial, mostly in the hard beds)
    # calcite veins: long, steep, slightly jagged tension gashes cutting across the beds
    vn = F.spectral(beta=3.0, fmin=1, fmax=20, sx=1.0, sy=12.0, angle=0.45)
    vn = F.warp(vn, 0.0015 * F.spectral(beta=1.8, fmin=20, fmax=200), 0.0)
    vein = (np.exp(-(contour_dist(F, vn) / P["vein_w"]) ** 2)
            * sstep(0.6, 1.4, F.spectral(beta=3.2, fmax=10)) * is_hard * lip)
    a = lerp_rgb(a, np.broadcast_to(col(PAL["bone"]) * 0.8, a.shape), 0.5 * vein)

    # seeps: water leaks from the open partings / joints and stains its way down
    src = np.clip(F.blur_m(1.0 - lip, P["seep_blur"]) * 2.5, 0, 1)
    run = drag_down(src, 24, max(1, int(P["seep_len"] / 24 / F.px)))
    streak = F.spectral(beta=2.0, fmin=3, fmax=220, sx=1.0, sy=10.0)
    zone = F.spectral(beta=3.2, fmax=8)
    wet = run * sstep(-0.4, 0.8, streak) * sstep(-0.6, 0.4, zone)
    verd = run * sstep(0.6, 1.4, streak) * sstep(0.5, 1.2, zone) * P["verd"]
    rust = run * sstep(0.6, 1.4, -streak) * sstep(0.3, 1.2, -zone) * P["rust"]
    calc = run * sstep(1.0, 1.8, streak) * sstep(0.8, 1.6, -zone) * P["calc"]
    a *= (1.0 - 0.3 * wet)[..., None]
    a = lerp_rgb(a, np.broadcast_to(col(PAL["verd"]) * 0.8, a.shape), 0.5 * np.clip(verd, 0, 1))
    a = lerp_rgb(a, np.broadcast_to(col(PAL["rust"]) * 0.65, a.shape), 0.45 * np.clip(rust, 0, 1))
    a = lerp_rgb(a, np.broadcast_to(col(PAL["bone"]) * 0.85, a.shape), 0.4 * np.clip(calc, 0, 1))

    rough = (0.9 + 0.03 * grain + 0.03 * (1.0 - is_hard) - 0.36 * wet - 0.18 * verd
             - 0.1 * rust - 0.1 * vein + 0.05 * (1.0 - lip))
    return dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp),
                ao_k=P["ao_k"], ao_scales=P["ao_scales"], nstrength=P["nstrength"], albedo_ao=0.45)


ROCK = dict(
    bed_warp=0.018, faults=[(0.21, 0.31, 0.047), (0.66, 0.17, -0.033)], fault_w=0.006, fault_depth=0.01,
    beds=10, joint_spacing=(0.6, 2.4), joint_tilt=0.08, joint_wobble=0.004, joint_open=(0.0002, 0.003),
    bed_gap=0.0015, round=(0.01, 0.05), chip=0.015, facet=0.035, lift=0.015, bed_relief=0.045,
    terr_fmin=1.5, terr_fmax=8, terr_k=0.9, terr_amp=0.02, rid_amp=0.002,
    lam_k=110, lam_amp=0.004, grain=0.0005, gap_depth=0.05, macro=0.01,
    dark=(36, 35, 34), mid=(60, 57, 52), pale=(72, 68, 62), greenish=(52, 57, 54),
    curv_r=0.03, curv_s=0.01, vein_w=0.003, seep_blur=0.01, seep_len=0.9,
    verd=1.0, rust=1.0, calc=1.0, ao_k=2.2, ao_scales=(0.01, 0.03, 0.09), nstrength=1.0,
)

ROCK_FAR = dict(
    bed_warp=0.03, faults=[(0.37, 0.24, 0.06)], fault_w=0.05, fault_depth=0.06,
    beds=7, joint_spacing=(1.8, 6.0), joint_tilt=0.05, joint_wobble=0.004, joint_open=(0.002, 0.02),
    bed_gap=0.01, round=(0.05, 0.25), chip=0.06, facet=0.08, lift=0.2, bed_relief=0.3,
    terr_fmin=1.0, terr_fmax=6, terr_k=1.2, terr_amp=0.18, rid_amp=0.015,
    lam_k=30, lam_amp=0.03, grain=0.0015, gap_depth=0.3, macro=0.05,
    dark=(26, 26, 25), mid=(44, 42, 39), pale=(56, 53, 48), greenish=(38, 43, 41),
    curv_r=0.12, curv_s=0.04, vein_w=0.012, seep_blur=0.05, seep_len=3.5,
    verd=0.7, rust=0.4, calc=0.5, ao_k=2.0, ao_scales=(0.05, 0.15, 0.45), nstrength=0.8,
)


def mat_rock(F):
    """Shaft rock: dark bedded stone, jointed blocks, faulted strata, veins, seeps."""
    return layered_rock(F, ROCK)


def mat_rock_far(F):
    """Distant rock: darker massive beds, big joints, little fine detail (seen through fog)."""
    return layered_rock(F, ROCK_FAR)


def mat_masonry(F):
    """Lanternwright ashlar: big dressed blocks, fine eroded joints, worn arrises, a band course."""
    n = F.n
    shp = (n, n)
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    T = F.tile
    w_lo = F.spectral(beta=3.4, fmax=8)
    w_mid = F.spectral(beta=2.6, fmin=4, fmax=80)
    w_hi = F.spectral(beta=2.0, fmin=40, fmax=400)

    # Courses: five ashlar courses + one thin, darker band course (chamfered).
    ch = list(rs.uniform(0.62, 0.78, 5))
    band_at = 3
    ch.insert(band_at, 0.26)
    ch = np.array(ch)
    edges_v = np.concatenate([[0.0], np.cumsum(ch / ch.sum())])
    nc = len(ch)
    v = F.v
    row = np.clip(np.searchsorted(edges_v, v, side="right") - 1, 0, nc - 1)
    top = edges_v[row]
    bot = edges_v[row + 1]
    blk_id = np.zeros(shp, np.int64)
    left = np.zeros(shp)
    right = np.zeros(shp)
    lu = np.zeros(shp)
    nb_total = 0
    for r in range(nc):
        lo_w, hi_w = (0.55, 0.9) if r == band_at else (0.85, 1.75)
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
        blk_id[m] = nb_total + b
        nb_total += len(widths)
    is_band = (row == band_at).astype(np.float64)

    # Rounded-rectangle interior distance (m), joints slightly irregular.
    jit = 0.003 * w_mid
    qx = np.minimum(lu - left, right - lu) * T + jit
    qy = np.minimum(v - top, bot - v) * T + jit
    mortar_half = 0.005 + 0.004 * sstep(0.0, 1.5, w_mid + 0.5 * w_lo)
    r_corner = 0.025
    qx -= mortar_half
    qy -= mortar_half
    mn = np.minimum(qx, qy)
    corner = r_corner - np.hypot(np.clip(r_corner - qx, 0, None), np.clip(r_corner - qy, 0, None))
    e = np.where(mn >= r_corner, mn, corner)

    rb = rs.random((nb_total, 8))
    # Worn arrises: wear varies along each edge and per block; corners lose chunks.
    wear = 0.012 + 0.05 * sstep(-0.3, 1.6, w_mid + 0.8 * w_lo) * (0.4 + rb[blk_id, 0])
    chip_n = F.spectral(beta=1.9, fmin=8, fmax=260)
    corner_dist = np.hypot(np.clip(0.18 - qx, 0, None), np.clip(0.18 - qy, 0, None))
    chunk = sstep(0.5, 1.4, chip_n + 1.2 * sstep(0.06, 0.18, corner_dist) * (rb[blk_id, 1] > 0.5))
    e_w = e - 0.06 * chunk * (1 - sstep(0.0, 0.08, e))
    prof = np.where(is_band > 0, sstep(-0.002, 0.035, e_w), sstep(-0.002, wear, e_w))
    face = sstep(-0.002, 0.004, e_w)  # 1 on the stone, 0 in the joint

    bcx = (left + right) * 0.5
    bcy = (top + bot) * 0.5
    lx = (lu - bcx) * T
    ly = (v - bcy) * T
    # Faces: dressed flat, slightly proud / tilted per block, gently weathered (alveolar pits).
    tilt = (rb[blk_id, 2] - 0.5) * 0.01 * lx + (rb[blk_id, 3] - 0.5) * 0.01 * ly
    proud = (rb[blk_id, 4] - 0.5) * 0.008 + 0.01 * is_band
    pit_n = F.spectral(beta=1.6, fmin=25, fmax=320)
    pits = np.clip(pit_n - 1.2, 0, None) * (0.4 + sstep(0.0, 1.5, w_lo + 0.6 * rb[blk_id, 5]))
    peck = F.spectral(beta=1.3, fmin=60, fmax=260)  # point-tooled pecking
    erosion = F.spectral(beta=2.8, fmin=2, fmax=40)
    face_h = tilt + proud + 0.004 * erosion - 0.004 * pits + 0.0004 * peck
    # Occasional cracked block.
    crack_line = np.zeros(shp)
    for _ in range(2):
        bid = rs.integers(nb_total)
        cn = F.spectral(beta=3.0, fmin=1, fmax=20, sx=1.0, sy=10.0, angle=rs.uniform(-0.5, 0.5))
        cn = F.warp(cn, 0.002 * F.spectral(beta=1.8, fmin=20, fmax=200), 0.0)
        cdist = contour_dist(F, cn)
        crack_line = np.maximum(crack_line, (blk_id == bid) * np.exp(-(cdist / 0.002) ** 2))
    face_h -= 0.006 * crack_line

    mortar_depth = 0.012 + 0.02 * sstep(-0.2, 1.6, w_mid + 0.6 * w_lo)
    mortar_h = -mortar_depth + 0.002 * w_hi
    h = mortar_h * (1.0 - prof) + face_h * prof

    # Lanternwright mason's mark: an inverted triangle (the downward spire) with a dot.
    marks = np.zeros(shp)
    for _ in range(2):
        bid = rs.integers(nb_total)
        m = blk_id == bid
        if not np.any(m) or bid >= nb_total:
            continue
        cxm = rs.uniform(-0.15, 0.15)
        cym = rs.uniform(-0.06, 0.06)
        px = lx - cxm
        py = ly - cym
        s = 0.05
        # three edges of a downward-pointing triangle (apex at +y = lower in the image)
        e1 = np.abs(py + s * 0.5)  # top edge
        in_top = np.abs(px) < s * 0.866
        d1 = np.where(in_top & (py > -s), e1, 9.0)
        for sgn in (-1, 1):
            # edge from (sgn*0.866s, -0.5s) to (0, s)
            ax, ay = sgn * 0.866 * s, -0.5 * s
            bx, by = 0.0, s
            dx_, dy_ = bx - ax, by - ay
            tt = np.clip(((px - ax) * dx_ + (py - ay) * dy_) / (dx_ * dx_ + dy_ * dy_), 0, 1)
            d1 = np.minimum(d1, np.hypot(px - (ax + tt * dx_), py - (ay + tt * dy_)))
        dot = np.hypot(px, py - 0.1 * s)
        mk = np.maximum(np.exp(-(d1 / 0.0045) ** 2), np.exp(-(dot / 0.007) ** 2))
        marks = np.maximum(marks, m * mk)
    h -= 0.0025 * marks

    # --- albedo
    tone = rb[blk_id, 6]
    base = tint((64, 60, 54), shp)
    a = lerp_rgb(base, np.broadcast_to(col((80, 75, 66)), base.shape), sstep(0.6, 1.0, tone) * 0.8)
    a = lerp_rgb(a, np.broadcast_to(col((50, 48, 45)), base.shape), sstep(0.35, 0.0, tone) * 0.8)
    a = lerp_rgb(a, np.broadcast_to(col((40, 40, 40)), base.shape), is_band * 0.85)
    warmth = (rb[blk_id, 7] - 0.5) * 0.06
    a[..., 0] *= 1 + warmth
    a[..., 2] *= 1 - warmth
    a *= (1.0 + 0.05 * erosion + 0.04 * F.spectral(beta=2.2, fmin=6, fmax=200) - 0.25 * pits)[..., None]
    # worn arrises read paler (fresh stone), chunks paler still
    edge_zone = (1.0 - sstep(0.0, 0.05, e_w)) * face
    a = lerp_rgb(a, np.broadcast_to(col((96, 90, 80)), a.shape), 0.35 * edge_zone + 0.25 * chunk * face)
    # grime runs below the bed joints + soot-darkened zones
    streak = F.spectral(beta=2.0, fmin=3, fmax=220, sx=1.0, sy=12.0)
    from_top = (v - top) * T
    run = np.exp(-from_top / (0.1 + 0.3 * sstep(-1, 1.5, w_lo))) * sstep(-0.3, 1.0, streak)
    a *= (1.0 - 0.4 * run * face)[..., None]
    vmask = sstep(0.9, 1.8, F.spectral(beta=3.2, fmax=8)) * sstep(0.3, 1.4, streak) * np.exp(-from_top / 0.35)
    a = lerp_rgb(a, np.broadcast_to(col(PAL["verd"]) * 0.9, a.shape), 0.5 * vmask * face)
    a *= (1.0 + 0.10 * w_lo - 0.15 * sstep(0.8, 2.0, F.spectral(beta=3.4, fmax=6)))[..., None]
    mortar_c = col((38, 36, 33)) * (0.8 + 0.3 * sstep(-1.5, 1.5, w_hi))[..., None]
    a = lerp_rgb(mortar_c, a, prof)
    a *= (1.0 - 0.5 * marks - 0.5 * crack_line)[..., None]

    rough = 0.86 - 0.04 * is_band + 0.04 * peck * face - 0.22 * run * face - 0.2 * vmask + 0.08 * (1.0 - prof)
    return dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp),
                ao_k=2.6, ao_scales=(0.008, 0.025, 0.07), nstrength=1.0, albedo_ao=0.55)


def mat_metal(F):
    """Corroded iron: blackened scale, rust blooms + runs with flaking edges, pitting."""
    rs = np.random.default_rng(F.rng.integers(1 << 30))
    w_lo = F.spectral(beta=3.2, fmax=10)
    w_mid = F.spectral(beta=2.4, fmin=4, fmax=120)
    streak = F.spectral(beta=2.0, fmin=2, fmax=220, sx=1.0, sy=9.0)

    # Rust field: warped fbm + blooms (radial spots) + downward runs.
    f1, _, bid, _, _ = F.worley(6, 6, F.u + 0.04 * w_lo, F.v + 0.04 * w_mid, jitter=0.9)
    bloom_r = rs.uniform(0.15, 0.45, 36)[bid]
    bloom = np.clip(1.0 - f1 / bloom_r, 0, 1)
    r_field = F.warp(F.spectral(beta=2.4, fmin=1.5, fmax=200), 0.025 * w_lo, 0.025 * w_mid)
    r_field = 0.75 * r_field + 0.6 * streak + 1.2 * bloom + 0.3 * w_lo - 0.5
    stain = sstep(-0.9, -0.1, r_field)        # thin brown bloom / stain on the scale
    scale_edge = 0.2 + 0.08 * F.spectral(beta=1.8, fmin=20, fmax=300)
    heavy = sstep(scale_edge - 0.012, scale_edge + 0.012, r_field)  # crisp: rust scale lifts off
    deep = sstep(0.8, 1.3, r_field)            # thick crusted corrosion

    # Flaking: the rust scale breaks into plates with raised, curled edges.
    g1, g2, cid, dx, dy = F.worley(28, 28, F.u + 0.012 * w_mid, F.v + 0.012 * w_lo, jitter=0.9)
    rc = rs.random((28 * 28, 4))
    plate = (rc[cid, 0] - 0.4) * 0.0012 + ((rc[cid, 1] - 0.5) * dx + (rc[cid, 2] - 0.5) * dy) * 0.0024
    crack = np.exp(-((g2 - g1) / 0.07) ** 2)
    curl = sstep(0.12, 0.0, g2 - g1) * 0.0007  # curled-up plate edge next to the crack
    missing = (rc[cid, 3] < 0.18).astype(np.float64) * heavy  # plates that have fallen off
    # Pitting under the scale and in the stain.
    p1, _, pid, _, _ = F.worley(90, 90, jitter=0.9)
    pr = rs.random(90 * 90)
    pit = (pr[pid] < 0.4) * (1.0 - sstep(0.0, 0.38, p1)) * np.clip(stain + missing, 0, 1)

    mill = F.spectral(beta=1.8, fmin=20, fmax=360)
    dent = F.spectral(beta=3.2, fmin=1, fmax=16)
    scale_h = 0.003 + 0.0015 * deep * F.spectral(beta=2.0, fmin=10, fmax=250)
    h = (0.002 * dent + 0.00006 * mill
         + heavy * (1 - missing) * (scale_h + plate + curl - 0.0008 * crack)
         + missing * -0.0002
         - 0.0009 * pit)
    h = F.blur(h, 0.6)  # anti-alias the crisp scale edges a touch

    # --- albedo / metalness / roughness
    blackened = col((52, 51, 52)) * (0.85 + 0.2 * sstep(-1.5, 1.5, mill))[..., None]
    mottle = F.spectral(beta=2.6, fmin=3, fmax=80)
    blackened = lerp_rgb(blackened, np.broadcast_to(col((40, 42, 47)), blackened.shape), sstep(0.2, 1.4, mottle))
    a = blackened * (1.0 + 0.08 * w_lo)[..., None]
    a = lerp_rgb(a, np.broadcast_to(col((78, 50, 38)), a.shape), 0.6 * stain)
    rust_var = sstep(-1.2, 1.2, F.spectral(beta=2.2, fmin=6, fmax=260))
    rust_c = lerp_rgb(np.broadcast_to(col((70, 38, 26)), a.shape), np.broadcast_to(col((112, 56, 33)), a.shape), rust_var)
    rust_c = lerp_rgb(rust_c, np.broadcast_to(col((52, 30, 22)), a.shape), deep * 0.7)
    a = lerp_rgb(a, rust_c, heavy * (1 - missing))
    # exposed (under-plate) metal where flakes fell off: darker, slightly brighter metal
    a = lerp_rgb(a, np.broadcast_to(col((66, 58, 54)), a.shape), missing * 0.8)
    a *= (1.0 - 0.45 * crack * heavy - 0.55 * pit)[..., None]
    runs = sstep(1.3, 2.3, streak) * sstep(-0.5, 1.0, w_lo)
    a = lerp_rgb(a, np.broadcast_to(col((84, 80, 72)), a.shape), 0.3 * runs)

    metal = np.clip((0.38 + 0.12 * mottle) * (1 - 0.7 * stain) * (1 - heavy) + 0.6 * missing - 0.3 * runs, 0, 1)
    rough = (0.5 + 0.07 * mill + 0.3 * stain) * (1 - heavy) + (0.86 + 0.06 * rust_var) * heavy
    rough = rough - 0.15 * missing + 0.04 * deep - 0.18 * runs
    return dict(albedo=a, height=h, rough=rough, metal=metal,
                ao_k=2.4, ao_scales=(0.004, 0.012, 0.035), nstrength=1.0, albedo_ao=0.5)


def mat_flesh(F):
    """Dark, wet sinew: muscle-fibre bundles, raised branching veins, capillaries, wet sheen."""
    n = F.n
    shp = (n, n)
    F.rng.integers(1 << 30)  # consumed only to keep this set's seeded random stream unchanged
    T = F.tile
    w_lo = F.spectral(beta=3.4, fmax=6)
    w_lo2 = F.spectral(beta=3.4, fmax=6)
    w_mid = F.spectral(beta=2.6, fmin=3, fmax=60)

    # Fibre bundles run down the tile (v) and wave gently.
    du = 0.012 * w_lo + 0.002 * w_mid
    bund = F.warp(F.spectral(beta=2.4, fmin=8, fmax=120, sx=1.0, sy=8.0), du, 0.0)
    bundle_h = np.sqrt(np.clip(0.5 + 0.5 * np.tanh(bund * 0.9), 0, 1))  # rounded bundle backs
    cleft = sstep(-0.3, -1.1, bund)  # dark clefts between bundles
    stri = F.warp(F.spectral(beta=1.6, fmin=30, fmax=200, sx=1.0, sy=18.0), du, 0.0)
    fibres = 1.0 - np.abs(np.tanh(stri * 0.8))  # fine striations along the fibres
    # Fascia: glossy membrane sheets smoothing over the fibres in patches.
    fascia = sstep(0.6, 1.5, F.spectral(beta=3.0, fmin=1, fmax=10))

    # Vascular network: warped Worley borders give connected, Y-branching vessels; only part
    # of each network carries blood, and vessel radius varies along its length.
    def vessels(cells, warp, r_lo, r_hi, keep):
        vu = F.u + warp * w_lo2 + 0.25 * warp * w_mid
        vv = F.v + warp * w_lo + 0.25 * warp * w_mid
        f1, f2, _, _, _ = F.worley(cells, cells, vu, vv, jitter=0.95)
        d = (f2 - f1) * 0.5 * T / cells  # ~metres from the vessel centre line
        r = r_lo + (r_hi - r_lo) * sstep(-1.0, 1.5, F.spectral(beta=2.8, fmin=2, fmax=30))
        on = sstep(keep - 0.4, keep + 0.4, F.spectral(beta=3.0, fmin=1, fmax=12))
        prof = np.sqrt(np.clip(1.0 - (d / r) ** 2, 0, 1))
        return prof * on, d

    main, dmain = vessels(3, 0.035, 0.007, 0.013, -0.6)
    near = np.exp(-dmain / 0.08)
    branch, _ = vessels(8, 0.025, 0.0018, 0.0045, -0.2)
    branch *= sstep(0.1, 0.5, near + 0.2 * w_mid)
    cap, _ = vessels(22, 0.012, 0.0005, 0.001, 0.3)

    h = (0.004 * bundle_h - 0.003 * cleft + 0.0004 * fibres * (1 - 0.8 * fascia)
         + 0.0015 * fascia * F.blur_m(bundle_h, 0.015)
         + 0.005 * main + 0.002 * branch + 0.0004 * cap + 0.004 * w_lo)
    h = F.blur(h, 0.5)

    # --- albedo: deep maroon to near-black; purple-black venous blood; dull red capillaries
    crest = col((62, 14, 18))
    body = col((40, 8, 12))
    deep = col((10, 2, 3))
    a = lerp_rgb(np.broadcast_to(body, shp + (3,)), np.broadcast_to(crest, shp + (3,)),
                 np.clip(bundle_h * (0.55 + 0.45 * fibres), 0, 1))
    a = lerp_rgb(a, np.broadcast_to(deep, a.shape), np.clip(cleft * 1.1, 0, 1))
    a *= (1.0 + 0.2 * w_lo + 0.06 * w_mid)[..., None]
    necrotic = sstep(0.5, 1.7, F.spectral(beta=3.2, fmax=8))
    a = lerp_rgb(a, np.broadcast_to(col((16, 5, 7)), a.shape), 0.75 * necrotic)
    a = lerp_rgb(a, np.broadcast_to(col((70, 40, 44)), a.shape), 0.3 * fascia * (1 - necrotic))
    a = lerp_rgb(a, np.broadcast_to(col((28, 7, 22)), a.shape), 0.9 * np.clip(main * 1.6, 0, 1))
    a = lerp_rgb(a, np.broadcast_to(col((38, 8, 22)), a.shape), 0.8 * np.clip(branch * 1.6, 0, 1))
    a = lerp_rgb(a, np.broadcast_to(col((92, 18, 22)), a.shape), 0.45 * np.clip(cap * 1.5, 0, 1))

    wet = sstep(-0.5, 1.0, F.spectral(beta=2.6, fmin=2, fmax=60))
    rough = (0.42 - 0.16 * wet - 0.12 * fascia - 0.1 * main - 0.05 * branch
             + 0.12 * necrotic + 0.08 * cleft)
    return dict(albedo=a, height=h, rough=rough, metal=np.zeros(shp),
                ao_k=2.6, ao_scales=(0.003, 0.01, 0.03), nstrength=1.0, albedo_ao=0.6)


SETS = {
    # name: (builder, tileMeters, seed, description)
    "rock": (mat_rock, 4.0, 1101, "shaft rock: dark bedded stone, jointed blocks, faults, calcite veins, seeps"),
    "masonry": (mat_masonry, 4.0, 2202, "Lanternwright ashlar: dressed courses + band course, worn chipped arrises, eroded joints"),
    "metal": (mat_metal, 2.0, 3303, "corroded iron: blackened scale, flaking rust blooms and runs, pitting"),
    "rockFar": (mat_rock_far, 16.0, 4404, "distant rock: darker massive beds, large joints, low fine detail"),
    "flesh": (mat_flesh, 1.5, 5505, "dark wet sinew: fibre bundles, branching raised veins, capillaries, wet sheen"),
}


# =============================================================================
# Bake + write
# =============================================================================
def to_u8(x):
    return (np.clip(x, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def bake_set(name, size):
    builder, tile_m, seed, desc = SETS[name]
    F = Field(size, seed, tile_m)
    m = builder(F)
    h = m["height"]
    ao = ambient_occlusion(F, h, m["ao_scales"], m["ao_k"])
    nrm = normals_from_height(F, h, m["nstrength"])
    albedo = m["albedo"] * (1.0 - m["albedo_ao"] * (1.0 - ao))[..., None]
    # Sub-pixel blur on the ORM channels: per-pixel roughness grain is invisible once lit but
    # costs JPEG bytes and shimmers in VR.
    ao = F.blur(ao, 0.6)
    rough = np.clip(F.blur(m["rough"], 0.7), 0.04, 1.0)
    metal = np.clip(F.blur(m["metal"], 0.5), 0.0, 1.0)
    orm = np.stack([ao, rough, metal], axis=-1)
    return dict(albedo=albedo, normal=nrm * 0.5 + 0.5, orm=orm, height=h, tile=tile_m, desc=desc)


def write_images(name, maps, out_dir):
    if Image is None:
        sys.exit("Pillow (PIL) is required to write textures: pip install pillow")
    files = {
        "albedo": f"{name}_albedo.jpg",
        "normal": f"{name}_normal.jpg",
        "orm": f"{name}_orm.jpg",
    }
    Image.fromarray(to_u8(maps["albedo"]), "RGB").save(
        os.path.join(out_dir, files["albedo"]), quality=85, optimize=True, progressive=True)
    Image.fromarray(to_u8(maps["normal"]), "RGB").save(
        os.path.join(out_dir, files["normal"]), quality=92, subsampling=0, optimize=True, progressive=True)
    Image.fromarray(to_u8(maps["orm"]), "RGB").save(
        os.path.join(out_dir, files["orm"]), quality=90, subsampling=0, optimize=True, progressive=True)
    return files


def seam_report(img):
    """z-score of the wrap-around step among all neighbouring column / row steps.

    For a seamless tile the wrap step is just another step (|z| small, typically < 3);
    a seam shows up as a large outlier.
    """
    x = img.astype(np.float64)
    out = []
    for axis in (1, 0):
        steps = np.abs(x - np.roll(x, -1, axis=axis)).mean(axis=1 - axis)
        wrap = steps[-1]
        inner = steps[:-1]
        out.append((wrap - inner.mean()) / max(inner.std(), 1e-9))
    return out[0], out[1]


def stats_line(name, maps):
    a = to_u8(maps["albedo"]).astype(np.float64)
    orm = maps["orm"]
    s_h, s_v = seam_report(a.mean(axis=2))
    return (f"[tex] {name:8s} albedo mean sRGB=({a[..., 0].mean():.0f},{a[..., 1].mean():.0f},{a[..., 2].mean():.0f})"
            f" ao={orm[..., 0].mean():.2f} rough={orm[..., 1].mean():.2f} metal={orm[..., 2].mean():.2f}"
            f" seam z(h,v)=({s_h:+.1f},{s_v:+.1f})")


def write_manifest(out_dir, entries):
    path = os.path.join(out_dir, "manifest.json")
    data = {}
    if os.path.exists(path):
        try:
            with open(path) as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = {}
    data.update(entries)
    with open(path + ".tmp", "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(path + ".tmp", path)
    return path


def tilecheck(out_dir, names, tex_dir):
    """2x2 tiled sheets of every map: any seam would show as a cross in the middle."""
    os.makedirs(out_dir, exist_ok=True)
    for name in names:
        tiles = []
        for kind in ("albedo", "normal", "orm"):
            im = Image.open(os.path.join(tex_dir, f"{name}_{kind}.jpg")).convert("RGB")
            w, h = im.size
            if kind == "albedo":  # brighten so dark detail is visible on screen
                arr = np.asarray(im).astype(np.float64) / 255.0
                arr = np.clip(arr / max(arr.mean(), 1e-3) * 0.42, 0, 1)
                im = Image.fromarray(to_u8(arr))
            sheet = Image.new("RGB", (w * 2, h * 2))
            for oy in (0, 1):
                for ox in (0, 1):
                    sheet.paste(im, (ox * w, oy * h))
            tiles.append(sheet.resize((w, h), Image.LANCZOS))
        row = Image.new("RGB", (tiles[0].width * 3 + 20, tiles[0].height), (40, 40, 40))
        for i, t in enumerate(tiles):
            row.paste(t, (i * (t.width + 10), 0))
        p = os.path.join(out_dir, f"tile2x2_{name}.png")
        row.save(p)
        print(f"[tex] tile check -> {p}")


# =============================================================================
# Cycles preview sheet (bpy): a sphere + a bevelled cube per set, under a warm
# lantern and a cold shaft light.
# =============================================================================
def render_preview(tex_dir, manifest, names, out_png, samples=64, res="1920x900"):
    import bpy  # noqa: F401  (imported first, before bmesh / mathutils)
    import bmesh
    from mathutils import Vector

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    def make_mat(name):
        e = manifest[name]
        mat = bpy.data.materials.new("Tex_" + name)
        try:
            mat.use_nodes = True
        except Exception:
            pass
        nt = mat.node_tree
        bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"

        def img(file, noncolor):
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = bpy.data.images.load(os.path.join(tex_dir, file))
            if noncolor:
                node.image.colorspace_settings.name = "Non-Color"
            nt.links.new(uv.outputs["UV"], node.inputs["Vector"])
            return node

        alb = img(e["albedo"], False)
        nrm = img(e["normal"], True)
        orm = img(e["orm"], True)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
        # Cycles computes its own occlusion; multiply the baked AO into the base colour lightly
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 0.5
        nt.links.new(alb.outputs["Color"], mix.inputs["A"])
        nt.links.new(sep.outputs["Red"], mix.inputs["B"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.uv_map = "UVMap"
        nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        return mat

    def link_obj(name, bm, mat, loc):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        if me.uv_layers:
            me.uv_layers[0].name = "UVMap"  # bmesh names its layer "Float2"; the shader looks up UVMap
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        ob.location = loc
        scene.collection.objects.link(ob)
        return ob

    def sphere(radius, tile_m):
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.verify()  # must exist BEFORE calc_uvs, which fills the active layer
        bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=radius, calc_uvs=True)
        # world-scale UVs: an integer number of repeats around the equator keeps the wrap seamless
        rep_u = max(1, round(2 * math.pi * radius / tile_m))
        rep_v = math.pi * radius / tile_m
        for f in bm.faces:
            f.smooth = True
            for lp in f.loops:
                lp[uvl].uv = (lp[uvl].uv.x * rep_u, lp[uvl].uv.y * rep_v)
        return bm

    def cube(size, tile_m):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=size)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=size * 0.06, segments=3, affect="EDGES", profile=0.5)
        uvl = bm.loops.layers.uv.verify()
        for f in bm.faces:
            nrm = f.normal
            ax = max(range(3), key=lambda i: abs(nrm[i]))
            for lp in f.loops:
                c = lp.vert.co
                if ax == 0:
                    uvc = (c.y * (1 if nrm.x > 0 else -1), c.z)
                elif ax == 1:
                    uvc = (c.x * (-1 if nrm.y > 0 else 1), c.z)
                else:
                    uvc = (c.x, c.y * (1 if nrm.z > 0 else -1))
                lp[uvl].uv = (uvc[0] / tile_m + 0.37, uvc[1] / tile_m + 0.21)
        return bm

    count = len(names)
    spacing = 2.7
    x0 = -(count - 1) * spacing / 2
    for i, name in enumerate(names):
        mat = make_mat(name)
        tile = manifest[name]["tileMeters"]
        # Show each set at a scale where its features read: shrink the very large tiles.
        show_tile = min(tile, 4.0)
        link_obj("Sphere_" + name, sphere(1.05, show_tile), mat, (x0 + i * spacing, 0.0, 1.05))
        link_obj("Cube_" + name, cube(1.6, show_tile), mat, (x0 + i * spacing, 0.0, 3.4))
        bpy.data.objects["Cube_" + name].rotation_euler = (0.0, 0.0, math.radians(32))

    # floor + back wall in the darker rock so the sheet sits in a shaft
    floor_name = "rockFar" if "rockFar" in manifest else names[0]
    fm = make_mat(floor_name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=20)
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x / 8.0, lp.vert.co.y / 8.0)
    link_obj("Floor", bm, fm, (0, 0, 0))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=20)
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x / 8.0, lp.vert.co.y / 8.0)
    wall = link_obj("Wall", bm, fm, (0, 3.0, 8))
    wall.rotation_euler = (math.radians(90), 0, 0)

    world = bpy.data.worlds.new("Abyss")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.006, 0.008, 0.01, 1)
        bg.inputs[1].default_value = 1.0

    def light(name, kind, loc, energy, color, size=0.3, rot=None):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = color
        if hasattr(ld, "shadow_soft_size"):
            ld.shadow_soft_size = size
        if kind == "AREA":
            ld.size = size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        if rot is not None:
            ob.rotation_euler = rot
        scene.collection.objects.link(ob)
        return ob

    # warm lantern low and to the left of the camera; cold shaft light from above-right
    light("Lantern", "POINT", (-4.5, -4.5, 2.6), 1500, (1.0, 0.62, 0.3), 0.15)
    sun = light("ShaftLight", "AREA", (6.0, -1.0, 9.0), 2600, (0.45, 0.68, 0.85), 3.0)
    sun.rotation_euler = (Vector((0, 0, 2)) - sun.location).to_track_quat("-Z", "Y").to_euler()
    light("Fill", "POINT", (0.0, -9.0, 4.0), 120, (0.5, 0.55, 0.6), 2.0)

    cd = bpy.data.cameras.new("Cam")
    cd.lens = 32
    cam = bpy.data.objects.new("Cam", cd)
    cam.location = (0.0, -13.8, 4.4)
    cam.rotation_euler = (Vector((0.0, 0.0, 2.2)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass
    w, h = (int(v) for v in res.split("x"))
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)

    # Labels (Pillow), one per column.
    if Image is not None:
        im = Image.open(out_png).convert("RGB")
        dr = ImageDraw.Draw(im)
        for i, name in enumerate(names):
            # project the sphere centre's x to the image: the camera is centred, so a linear map is close
            fx = (x0 + i * spacing) / (count * spacing) + 0.5
            x = int(w * (0.5 + (fx - 0.5) * 0.98))
            label = f"{name}  ({manifest[name]['tileMeters']:g} m tile)"
            dr.text((x - 4 * len(label), h - 34), label, fill=(225, 215, 190))
        im.save(out_png)
    print(f"[tex] preview -> {out_png}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=DEFAULT_OUT, help="texture output directory")
    ap.add_argument("--sets", default=",".join(SETS), help="comma-separated set names")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--no-bake", action="store_true", help="skip baking (preview / tile check only)")
    ap.add_argument("--tilecheck", default="", help="write 2x2 tiling sheets into this directory")
    ap.add_argument("--preview", action="store_true", help="render the Cycles preview sheet (needs bpy)")
    ap.add_argument("--preview-out", default=DEFAULT_PREVIEW)
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--res", default="1920x900")
    args = ap.parse_args(argv)

    names = [s.strip() for s in args.sets.split(",") if s.strip()]
    for nme in names:
        if nme not in SETS:
            sys.exit(f"unknown set '{nme}' (known: {', '.join(SETS)})")
    os.makedirs(args.out, exist_ok=True)

    if not args.no_bake:
        entries = {}
        for nme in names:
            maps = bake_set(nme, args.size)
            files = write_images(nme, maps, args.out)
            print(stats_line(nme, maps))
            entries[nme] = {
                "albedo": files["albedo"],
                "normal": files["normal"],
                "orm": files["orm"],
                "tileMeters": maps["tile"],
                "size": args.size,
                "source": "baked:build_textures.py",
                "description": maps["desc"],
            }
        p = write_manifest(args.out, entries)
        total = sum(os.path.getsize(os.path.join(args.out, f)) for f in os.listdir(args.out))
        print(f"[tex] manifest -> {p}; texture dir total {total / 1e6:.2f} MB")
        # Keep the crc of the manifest handy for change detection in logs.
        with open(p, "rb") as fh:
            print(f"[tex] manifest crc32 {zlib.crc32(fh.read()):08x}")

    if args.tilecheck:
        tilecheck(args.tilecheck, names, args.out)

    if args.preview:
        with open(os.path.join(args.out, "manifest.json")) as fh:
            manifest = json.load(fh)
        render_preview(args.out, manifest, [nme for nme in names if nme in manifest],
                       args.preview_out, samples=args.samples, res=args.res)


if __name__ == "__main__":
    main()
