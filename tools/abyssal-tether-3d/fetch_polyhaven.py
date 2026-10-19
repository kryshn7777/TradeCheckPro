"""ABYSSAL TETHER 3D — fetch CC0 texture sets from Poly Haven (for when the network allows it).

Downloads 1k JPG maps for chosen Poly Haven texture assets — diffuse (albedo, sRGB), nor_gl
(OpenGL-convention normal, matching three.js) and arm (R = AO, G = roughness, B = metalness,
the same packing as our baked ORM maps) — into public/abyssal-tether-3d/assets/textures/ and
points manifest.json at them, in the same format build_textures.py writes:

    {"<set>": {"albedo", "normal", "orm", "tileMeters", ...}}

The baked originals stay on disk; re-run build_textures.py to point the manifest back at them.

Needs api.polyhaven.com and dl.polyhaven.org reachable (they are blocked in the cloud container
this was written in, so the script is built to fail soft: a set that cannot be fetched keeps its
current manifest entry, and nothing is half-written).

Usage
  python tools/abyssal-tether-3d/fetch_polyhaven.py                       # default picks below
  python tools/abyssal-tether-3d/fetch_polyhaven.py --set rock=rock_wall_08 --set metal=rusty_metal_02
  python tools/abyssal-tether-3d/fetch_polyhaven.py --only rock,masonry
  python tools/abyssal-tether-3d/fetch_polyhaven.py --list rock          # browse a category
  python tools/abyssal-tether-3d/fetch_polyhaven.py --dry-run            # resolve URLs only
  python tools/abyssal-tether-3d/fetch_polyhaven.py --grade 0.6          # desaturate/darken albedo
                                                                           (Pillow) toward the palette
Options: --res 1k|2k (default 1k), --timeout, --retries, --cafile, --out,
         --api URL (a mirror / local mock of api.polyhaven.com, for testing).

Stdlib only (urllib); Pillow is optional (needed only for --grade, resizing and for building an
ORM from separate AO / roughness maps when an asset has no "arm" map).
"""

import argparse
import hashlib
import io
import json
import os
import shutil
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(ROOT, "public", "abyssal-tether-3d", "assets", "textures")
API = "https://api.polyhaven.com"
USER_AGENT = "AbyssalTether3D-asset-fetch/1.0 (+https://github.com; build tooling)"

# Candidate Poly Haven asset ids per set, best first. The first one that resolves is used.
# (Ids are checked against the API at run time; unknown ids are skipped with a warning.)
CANDIDATES = {
    "rock": ["rock_wall_08", "rock_wall_10", "rock_wall_02", "rock_face_03", "cliff_side"],
    "masonry": ["castle_brick_07", "medieval_blocks_02", "stone_brick_wall_001", "castle_wall_slates"],
    "metal": ["rusty_metal_02", "rust_coarse_01", "rusty_metal_04", "rusty_metal_03"],
    "rockFar": ["cliff_side", "rock_face", "rocky_terrain_02", "rock_wall_10"],
    # "flesh": Poly Haven has no suitable organic tissue set — keep the baked one.
}

# Map keys in /files/<id>, tried in order (Poly Haven names, plus a few historical spellings).
MAP_KEYS = {
    "albedo": ["Diffuse", "diffuse", "diff", "Color", "col"],
    "normal": ["nor_gl", "Normal_GL", "normal_gl", "nor"],
    "orm": ["arm", "ARM"],
    "ao": ["AO", "ao"],
    "rough": ["Rough", "rough", "roughness", "Roughness"],
    "metal": ["Metal", "metal", "metallic", "Metallic"],
}

# Rough palette target for --grade (sRGB mean of the game's dark neutrals).
PALETTE_MEAN = 58.0


def set_api(url):
    global API
    API = url.rstrip("/")


def log(msg):
    print(f"[polyhaven] {msg}", flush=True)


def ssl_context(cafile):
    cafile = cafile or os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    if cafile and os.path.exists(cafile):
        return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


class Fetcher:
    def __init__(self, timeout, retries, ctx):
        self.timeout = timeout
        self.retries = retries
        self.ctx = ctx

    def _open(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
        return urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx)

    def get(self, url):
        """GET with retries + exponential backoff. Returns bytes; raises the last error."""
        last = None
        for attempt in range(self.retries + 1):
            try:
                with self._open(url) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (400, 401, 403, 404, 410):  # not worth retrying
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError, ssl.SSLError, OSError) as e:
                last = e
            if attempt < self.retries:
                delay = min(30.0, 1.5 * (2 ** attempt))
                log(f"  retry {attempt + 1}/{self.retries} in {delay:.0f}s ({last})")
                time.sleep(delay)
        raise last if last else RuntimeError(f"failed: {url}")

    def json(self, url):
        return json.loads(self.get(url).decode("utf-8"))


def pick_file(files, kinds, res, fmt="jpg"):
    """Find {url, md5, size} for the first matching map key at the wanted resolution."""
    lower = {k.lower(): k for k in files}
    for key in kinds:
        real = files.get(key) or files.get(lower.get(key.lower(), ""))
        if not isinstance(real, dict):
            continue
        for r in [res] + [x for x in ("1k", "2k", "4k") if x != res]:
            entry = real.get(r)
            if isinstance(entry, dict):
                for f in (fmt, "jpg", "png"):
                    if isinstance(entry.get(f), dict) and entry[f].get("url"):
                        return entry[f], key, r
    return None, None, None


def resolve_asset(fx, asset_id):
    """Return (info, files) or (None, None) if the asset is unknown / unreachable."""
    try:
        info = fx.json(f"{API}/info/{urllib.parse.quote(asset_id)}")
        files = fx.json(f"{API}/files/{urllib.parse.quote(asset_id)}")
    except urllib.error.HTTPError as e:
        log(f"  {asset_id}: HTTP {e.code}")
        return None, None
    except Exception as e:  # network blocked, DNS, TLS ...
        log(f"  {asset_id}: unreachable ({e})")
        return None, None
    if not isinstance(files, dict) or not files:
        log(f"  {asset_id}: no files listed")
        return None, None
    if isinstance(info, dict) and info.get("type") not in (None, 1):  # 1 = texture in the API
        log(f"  {asset_id}: not a texture asset (type {info.get('type')})")
        return None, None
    return info, files


def download_verified(fx, entry, dest):
    data = fx.get(entry["url"])
    md5 = entry.get("md5")
    if md5 and hashlib.md5(data).hexdigest() != md5:
        raise IOError(f"md5 mismatch for {entry['url']}")
    size = entry.get("size")
    if size and len(data) != int(size):
        raise IOError(f"size mismatch for {entry['url']} ({len(data)} != {size})")
    # write atomically next to the destination
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dest), prefix=".ph_", suffix=".part.jpg")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return tmp


def grade_albedo(path, strength):
    """Desaturate + pull the mean toward the game's dark palette (Pillow, optional)."""
    try:
        from PIL import Image, ImageEnhance, ImageStat
    except ImportError:
        log("  --grade needs Pillow; skipping grade")
        return
    im = Image.open(path).convert("RGB")
    im = ImageEnhance.Color(im).enhance(max(0.0, 1.0 - 0.7 * strength))
    mean = sum(ImageStat.Stat(im).mean) / 3.0
    if mean > 1:
        target = mean + (PALETTE_MEAN - mean) * strength
        im = ImageEnhance.Brightness(im).enhance(target / mean)
    im.save(path, format="JPEG", quality=85, progressive=True)


def build_orm(fx, files, res, dest):
    """No 'arm' map: pack AO (R), roughness (G), metalness (B, 0 if absent) with Pillow."""
    try:
        from PIL import Image
    except ImportError:
        raise IOError("asset has no 'arm' map and Pillow is not installed to pack one")
    chans = []
    size = None
    for kind, default in (("ao", 255), ("rough", 200), ("metal", 0)):
        entry, _, _ = pick_file(files, MAP_KEYS[kind], res)
        if entry:
            im = Image.open(io.BytesIO(fx.get(entry["url"]))).convert("L")
            size = size or im.size
            chans.append(im)
        else:
            chans.append(default)
    if size is None:
        raise IOError("asset has neither 'arm' nor AO/roughness maps")
    chans = [c.resize(size) if not isinstance(c, int) else Image.new("L", size, c) for c in chans]
    Image.merge("RGB", chans).save(dest, format="JPEG", quality=90, subsampling=0)


def fetch_set(fx, set_name, asset_id, out_dir, res, grade, dry_run):
    info, files = resolve_asset(fx, asset_id)
    if not files:
        return None
    picks = {}
    for kind in ("albedo", "normal", "orm"):
        entry, key, r = pick_file(files, MAP_KEYS[kind], res)
        if entry is None and kind != "orm":
            log(f"  {asset_id}: missing {kind} map (keys: {', '.join(sorted(files))})")
            return None
        picks[kind] = (entry, key, r)
    for kind, (entry, key, r) in picks.items():
        log(f"  {asset_id} {kind:6s} <- {key}/{r}: {entry['url'] if entry else '(packed from AO/rough)'}")
    if dry_run:
        return {}

    names = {k: f"ph_{asset_id}_{k}.jpg" for k in ("albedo", "normal", "orm")}
    staged = {}
    try:
        for kind in ("albedo", "normal", "orm"):
            entry = picks[kind][0]
            if entry is None:
                fd, tmp = tempfile.mkstemp(dir=out_dir, prefix=".ph_", suffix=".part.jpg")
                os.close(fd)
                staged[kind] = tmp  # registered first so a failure below still cleans it up
                build_orm(fx, files, res, tmp)
            else:
                staged[kind] = download_verified(fx, entry, os.path.join(out_dir, names[kind]))
        if grade > 0:
            grade_albedo(staged["albedo"], grade)
        for kind, tmp in staged.items():
            os.replace(tmp, os.path.join(out_dir, names[kind]))
        staged = {}
    finally:
        for tmp in staged.values():
            try:
                os.remove(tmp)
            except OSError:
                pass

    # Real-world size: Poly Haven lists dimensions in millimetres ([width, height]).
    tile = None
    dims = (info or {}).get("dimensions")
    if isinstance(dims, (list, tuple)) and dims and isinstance(dims[0], (int, float)) and dims[0] > 0:
        tile = round(float(dims[0]) / 1000.0, 3)
    authors = sorted((info or {}).get("authors", {}).keys()) if isinstance((info or {}).get("authors"), dict) else []
    return {
        "albedo": names["albedo"],
        "normal": names["normal"],
        "orm": names["orm"],
        "tileMeters": tile or 2.0,
        "source": f"polyhaven:{asset_id}",
        "license": "CC0",
        "authors": authors,
        "url": f"https://polyhaven.com/a/{asset_id}",
    }


def load_manifest(path):
    if os.path.exists(path):
        try:
            with open(path) as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return data
        except (OSError, ValueError) as e:
            log(f"manifest unreadable ({e}); starting a new one")
    return {}


def save_manifest(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)


def list_category(fx, category):
    url = f"{API}/assets?type=textures&categories={urllib.parse.quote(category)}"
    data = fx.json(url)
    rows = []
    for aid, meta in data.items():
        dims = meta.get("dimensions") or [0, 0]
        rows.append((aid, meta.get("name", ""), dims[0] / 1000.0 if dims else 0, meta.get("download_count", 0)))
    rows.sort(key=lambda r: -r[3])
    for aid, name, w, dl in rows:
        print(f"{aid:32s} {name:36s} {w:6.2f} m  downloads={dl}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--set", action="append", default=[], metavar="NAME=ASSET_ID",
                    help="use this Poly Haven asset for a set (repeatable); overrides the candidates")
    ap.add_argument("--only", default="", help="comma-separated set names to fetch")
    ap.add_argument("--res", default="1k", choices=["1k", "2k"])
    ap.add_argument("--grade", type=float, default=0.0, help="0..1: desaturate/darken albedo toward the palette")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--cafile", default="", help="CA bundle (defaults to $SSL_CERT_FILE / $REQUESTS_CA_BUNDLE)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list", default="", metavar="CATEGORY", help="list texture assets in a category and exit")
    ap.add_argument("--api", default=API, help="API base URL (default %(default)s)")
    args = ap.parse_args()
    set_api(args.api)

    fx = Fetcher(args.timeout, args.retries, ssl_context(args.cafile))
    if args.list:
        try:
            list_category(fx, args.list)
        except Exception as e:
            log(f"cannot reach {API} ({e})")
            return 2
        return 0

    plan = {k: list(v) for k, v in CANDIDATES.items()}
    for item in args.set:
        if "=" not in item:
            ap.error(f"--set expects NAME=ASSET_ID, got '{item}'")
        name, aid = item.split("=", 1)
        plan[name.strip()] = [aid.strip()]
    if args.only:
        wanted = [s.strip() for s in args.only.split(",") if s.strip()]
        plan = {k: v for k, v in plan.items() if k in wanted}
    if not plan:
        log("nothing to fetch")
        return 1

    os.makedirs(args.out, exist_ok=True)
    manifest_path = os.path.join(args.out, "manifest.json")
    manifest = load_manifest(manifest_path)
    if shutil.disk_usage(args.out).free < 50 * 1024 * 1024:
        log("less than 50 MB free disk; aborting")
        return 1

    fetched, failed = [], []
    for set_name, ids in plan.items():
        log(f"set '{set_name}': trying {', '.join(ids)}")
        entry = None
        for aid in ids:
            try:
                entry = fetch_set(fx, set_name, aid, args.out, args.res, args.grade, args.dry_run)
            except Exception as e:
                log(f"  {aid}: failed ({e})")
                entry = None
            if entry is not None:
                break
        if entry is None:
            failed.append(set_name)
            log(f"set '{set_name}': no candidate could be fetched; manifest entry left unchanged")
            continue
        if not args.dry_run:
            manifest[set_name] = entry
            save_manifest(manifest_path, manifest)  # after every set: partial runs stay consistent
        fetched.append(set_name)

    log(f"done: fetched {fetched or 'none'}; failed {failed or 'none'}"
        + (" (dry run, nothing written)" if args.dry_run else f"; manifest {manifest_path}"))
    return 0 if fetched and not failed else (3 if fetched else 2)


if __name__ == "__main__":
    sys.exit(main())
