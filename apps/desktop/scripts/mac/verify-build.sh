#!/bin/bash
# File: apps/desktop/scripts/mac/verify-build.sh
# Purpose: Checks a Mac build before anyone installs it (ADR-0109 §2, stage 6), and prints PASS or FAIL
#          for each check:
#            - the app's signature is valid (codesign --verify --deep --strict), also after unzipping the zip;
#            - it is signed with the company certificate (the leaf certificate's SHA-256 equals
#              build/mac-signing/certificate.pem's) and its signing rule names our certificate;
#            - the bundle id, the version and the permission texts (microphone, system audio, Documents);
#            - every main binary holds both CPUs (arm64 and x86_64), and both speech engines are there;
#            - latest-mac.yml names the zip and its SHA-512 matches.
#          Usage: bash apps/desktop/scripts/mac/verify-build.sh [release folder, default apps/desktop/release]
# Used by: scripts/mac/build.sh (after each build); the teammate (docs/testing/mac-release-test.md)
# Depends on: macOS (codesign, lipo, ditto, PlistBuddy, shasum, openssl), Node (cert-tools.mjs)
# Architecture: docs/decisions/ADR-0109-macos-internal-release.md §2, §5
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DESKTOP="$(cd "$HERE/../.." && pwd)"
RELEASE="${1:-$DESKTOP/release}"
CERT="$DESKTOP/build/mac-signing/certificate.pem"
APP="$RELEASE/mac-universal/Paramount AI.app"
PLIST="$APP/Contents/Info.plist"
FAILED=0

pass() { echo "PASS $*"; }
fail() {
  echo "FAIL $*"
  FAILED=1
}
check() {
  # check "<what>" <command…>: PASS when the command succeeds.
  local what="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "$what"; else fail "$what"; fi
}

[ -d "$APP" ] || {
  echo "FAIL no app at $APP"
  exit 1
}
[ -f "$CERT" ] || {
  echo "FAIL no build/mac-signing/certificate.pem"
  exit 1
}

check "signature valid (codesign --verify --deep --strict)" codesign --verify --deep --strict "$APP"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
(cd "$WORK" && codesign -d --extract-certificates "$APP" >/dev/null 2>&1)
EXPECTED_SHA256="$(node "$HERE/cert-tools.mjs" fingerprint "$CERT" | sed -n 's/^sha256: //p')"
EXPECTED_SHA1="$(node "$HERE/cert-tools.mjs" fingerprint "$CERT" | sed -n 's/^sha1: //p')"
if [ -f "$WORK/codesign0" ]; then
  LEAF_SHA256="$(shasum -a 256 "$WORK/codesign0" | awk '{print $1}')"
  if [ "$LEAF_SHA256" = "$EXPECTED_SHA256" ]; then pass "signed with the company certificate"; else fail "signed with another certificate ($LEAF_SHA256)"; fi
else
  fail "no signing certificate found in the app"
fi

RULE="$(codesign -d -r- "$APP" 2>&1 | sed -n 's/^designated => //p')"
echo "     signing rule: $RULE"
if echo "$RULE" | grep -qi "$EXPECTED_SHA1"; then pass "signing rule names our certificate"; else fail "signing rule does not name our certificate"; fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null)"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null)"
echo "     version: $VERSION"
if [ "$BUNDLE_ID" = "co.paramountintelligence.kite" ]; then pass "bundle id"; else fail "bundle id is $BUNDLE_ID"; fi
for KEY in NSMicrophoneUsageDescription NSAudioCaptureUsageDescription NSDocumentsFolderUsageDescription; do
  check "permission text $KEY" /usr/libexec/PlistBuddy -c "Print :$KEY" "$PLIST"
done

for BINARY in "$APP/Contents/MacOS/Paramount AI" \
  "$APP/Contents/Frameworks/Electron Framework.framework/Electron Framework"; do
  ARCHS="$(lipo -archs "$BINARY" 2>/dev/null)"
  if echo "$ARCHS" | grep -q arm64 && echo "$ARCHS" | grep -q x86_64; then
    pass "both CPUs in $(basename "$BINARY")"
  else
    fail "$(basename "$BINARY") holds only: $ARCHS"
  fi
done

MODULES="$APP/Contents/Resources/sherpa-onnx/modules"
for PAIR in "darwin-arm64:arm64" "darwin-x64:x86_64"; do
  FOLDER="${PAIR%%:*}"
  ARCH="${PAIR##*:}"
  ADDON="$MODULES/sherpa-onnx-$FOLDER/sherpa-onnx.node"
  if [ -f "$ADDON" ] && lipo -archs "$ADDON" 2>/dev/null | grep -q "$ARCH"; then
    pass "speech engine for $FOLDER"
  else
    fail "speech engine for $FOLDER missing or wrong CPU"
  fi
done

YML="$RELEASE/latest-mac.yml"
if [ -f "$YML" ]; then
  ZIP_NAME="$(sed -n 's/^path: //p' "$YML" | tr -d "'\"")"
  WANT="$(sed -n 's/^sha512: //p' "$YML" | tr -d "'\"")"
  if [ -f "$RELEASE/$ZIP_NAME" ]; then
    GOT="$(openssl dgst -sha512 -binary "$RELEASE/$ZIP_NAME" | openssl base64 -A)"
    if [ "$GOT" = "$WANT" ]; then pass "latest-mac.yml SHA-512 matches $ZIP_NAME"; else fail "latest-mac.yml SHA-512 does not match $ZIP_NAME"; fi
    mkdir -p "$WORK/unzipped"
    ditto -x -k "$RELEASE/$ZIP_NAME" "$WORK/unzipped"
    check "signature valid after unzipping the zip" codesign --verify --deep --strict "$WORK/unzipped/Paramount AI.app"
  else
    fail "latest-mac.yml names $ZIP_NAME, which is not in $RELEASE"
  fi
else
  fail "no latest-mac.yml"
fi

# Information only: Gatekeeper rejects a self-signed app; the Terminal installer does not need it.
echo "     (Gatekeeper's verdict, expected 'rejected' for a self-signed app: $(spctl --assess --type execute "$APP" 2>&1 | head -1))"

if [ "$FAILED" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOME CHECKS FAILED"
fi
exit "$FAILED"
