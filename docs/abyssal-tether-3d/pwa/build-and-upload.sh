#!/usr/bin/env bash
# ABYSSAL TETHER: package the live PWA as a Meta Quest APK and (optionally) upload it.
# TEMPLATE for the owner's release machine. Nothing here runs in CI or in this repo by itself.
# Read RELEASE.md "Packaging" first. Requires: Node >= 18, @meta-quest/bubblewrap-cli 1.24.1
# (`npm i -g @meta-quest/bubblewrap-cli@1.24.1`, then `bubblewrap doctor` once; Bubblewrap installs its
# own JDK 17 + Android SDK under ~/.bubblewrap), curl, and Meta's ovr-platform-util for uploads.
#
# Usage:
#   export AT_TWA_DIR=~/release/abyssal-tether-twa        # contains twa-manifest.json (from the template)
#   export AT_DOMAIN=play.example.com                     # the game origin (no scheme)
#   export AT_GAME_PATH=/                                 # path of the game on that origin, with slashes
#   export AT_PACKAGE_ID=com.example.abyssaltether
#   export AT_KEYSTORE=~/secure/abyssal-tether.keystore AT_KEY_ALIAS=abyssaltether
#   export AT_VERSION_NAME=1.0.0                          # semver shown to players; versionCode auto-increments
#   export BUBBLEWRAP_KEYSTORE_PASSWORD=... BUBBLEWRAP_KEY_PASSWORD=...   # never commit these
#   ./build-and-upload.sh build                 # verify hosting, regenerate, build, verify the APK
#   ./build-and-upload.sh upload ALPHA "notes"  # + needs AT_APP_ID and AT_APP_SECRET (or AT_TOKEN), AT_OVR_UTIL
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
need() { [[ -n "${!1:-}" ]] || die "set $1 (see the header of this script)"; }
step() { echo; echo "== $*"; }

cmd="${1:-}"
[[ "$cmd" == "build" || "$cmd" == "upload" ]] || die "usage: $0 build | upload <ALPHA|BETA|RC|LIVE> [notes]"

for v in AT_TWA_DIR AT_DOMAIN AT_GAME_PATH AT_PACKAGE_ID AT_KEYSTORE AT_KEY_ALIAS AT_VERSION_NAME BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD; do need "$v"; done
[[ -f "$AT_TWA_DIR/twa-manifest.json" ]] || die "$AT_TWA_DIR/twa-manifest.json not found (copy and fill twa-manifest.template.json)"
[[ -f "$AT_KEYSTORE" ]] || die "keystore $AT_KEYSTORE not found. It is permanent: every update must reuse it."
command -v bubblewrap >/dev/null || die "bubblewrap not on PATH (npm i -g @meta-quest/bubblewrap-cli@1.24.1)"
if grep -q '__[A-Z0-9_]*__' "$AT_TWA_DIR/twa-manifest.json"; then die "twa-manifest.json still has __PLACEHOLDER__ tokens"; fi

ORIGIN="https://$AT_DOMAIN"
GAME_URL="$ORIGIN$AT_GAME_PATH"
BT="$(ls -d "$HOME"/.bubblewrap/android_sdk/build-tools/* 2>/dev/null | sort -V | tail -1 || true)"
KT="$(find "$HOME/.bubblewrap/jdk" -path '*/bin/keytool' 2>/dev/null | head -1 || true)"
[[ -n "$KT" ]] || KT="$(command -v keytool || true)"
[[ -n "$KT" ]] || die "keytool not found (run bubblewrap doctor)"

step "1/6 Hosting preflight: everything bubblewrap and the headset fetch must be live"
for path in "${AT_GAME_PATH}manifest.webmanifest" "${AT_GAME_PATH}index.html" "${AT_GAME_PATH}icons/icon-512.png" "${AT_GAME_PATH}icons/icon-maskable-512.png" "/.well-known/assetlinks.json"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN$path")"
  echo "  $code $ORIGIN$path"
  [[ "$code" == "200" ]] || die "$ORIGIN$path must return 200 (no redirects)"
done
ctype="$(curl -s -o /dev/null -w '%{content_type}' "${GAME_URL}manifest.webmanifest")"
[[ "$ctype" == application/manifest+json* || "$ctype" == application/json* ]] || echo "  warning: manifest served as '$ctype' (expected application/manifest+json)"
for secret in android.keystore "$(basename "$AT_KEYSTORE")"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$GAME_URL$secret")"
  [[ "$code" == "404" ]] || die "$GAME_URL$secret answers $code: a keystore is being served publicly. Remove it and rotate."
done

step "2/6 Digital Asset Links must name this package and this certificate"
KEY_SHA="$("$KT" -list -v -keystore "$AT_KEYSTORE" -alias "$AT_KEY_ALIAS" -storepass:env BUBBLEWRAP_KEYSTORE_PASSWORD 2>/dev/null | awk '/SHA256:/{print $2; exit}')"
[[ -n "$KEY_SHA" ]] || die "could not read the SHA-256 fingerprint of $AT_KEY_ALIAS"
links="$(curl -s "$ORIGIN/.well-known/assetlinks.json")"
grep -q "\"$AT_PACKAGE_ID\"" <<<"$links" || die "assetlinks.json does not list package $AT_PACKAGE_ID"
grep -qi "$KEY_SHA" <<<"$links" || die "assetlinks.json does not list the keystore fingerprint $KEY_SHA"
echo "  ok: $AT_PACKAGE_ID / $KEY_SHA"

step "3/6 Regenerate the Android project (bumps appVersionCode; it must always increase)"
cd "$AT_TWA_DIR"
bubblewrap update --appVersionName="$AT_VERSION_NAME"   # without it, update stops to prompt

step "4/6 Build and sign"
bubblewrap build --signingKeyPath="$AT_KEYSTORE" --signingKeyAlias="$AT_KEY_ALIAS"
APK="$AT_TWA_DIR/app-release-signed.apk"
[[ -f "$APK" ]] || die "no $APK produced"

step "5/6 Verify the APK"
if [[ -n "$BT" ]]; then
  "$BT/apksigner" verify --verbose --print-certs "$APK" | grep -E 'Verified using v2|SHA-256 digest' || true
  APK_SHA="$("$BT/apksigner" verify --print-certs "$APK" | awk -F': ' '/certificate SHA-256 digest/{print toupper($2); exit}')"
  [[ "$(tr -d ':' <<<"$KEY_SHA" | tr '[:lower:]' '[:upper:]')" == "$APK_SHA" ]] || die "APK certificate $APK_SHA != keystore $KEY_SHA"
  badging="$("$BT/aapt" dump badging "$APK")"
  grep -E "^package:" <<<"$badging"
  "$BT/aapt" dump xmltree "$APK" AndroidManifest.xml | grep -E 'APP_MODE|OCULUS_APP_ID|com.oculus.intent.category.VR|quest.meta.com/billing' -A1 | grep -E 'A: android:(name|value)' | sed 's/^/  /' || true
  "$BT/aapt" dump permissions "$APK" | sed 's/^/  perm: /'
else
  echo "  warning: Android build-tools not found; skipping apksigner/aapt checks"
fi
ls -l "$APK"

if [[ "$cmd" == "build" ]]; then
  echo; echo "Built $APK. Sideload with: bubblewrap install --apkFile=\"$APK\"  (or adb install -r \"$APK\")"
  exit 0
fi

step "6/6 Upload to the Meta Horizon Store release channel"
channel="${2:-ALPHA}"; notes="${3:-}"
need AT_APP_ID; need AT_OVR_UTIL
[[ -x "$AT_OVR_UTIL" ]] || die "AT_OVR_UTIL=$AT_OVR_UTIL is not executable"
auth=()
if [[ -n "${AT_APP_SECRET:-}" ]]; then auth=(--app-secret "$AT_APP_SECRET"); elif [[ -n "${AT_TOKEN:-}" ]]; then auth=(--token "$AT_TOKEN"); else die "set AT_APP_SECRET (Dashboard > API) or AT_TOKEN"; fi
# Age group self-certification is mandatory; a horror game is TEENS_AND_ADULTS.
"$AT_OVR_UTIL" upload-quest-build \
  --app-id "$AT_APP_ID" "${auth[@]}" \
  --apk "$APK" \
  --channel "$channel" \
  --age-group TEENS_AND_ADULTS \
  --notes "$notes" \
  --disable-progress-bar
echo "Uploaded to $channel. If this fails with 'must first agree to our Developer Distribution Agreement', an org admin must sign it in the Dashboard (RELEASE.md, Owner actions)."
