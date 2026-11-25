#!/bin/bash
# File: apps/desktop/scripts/mac/build.sh
# Purpose: Builds the signed universal Mac app (ADR-0109 §2) on the build Mac:
#            1. checks the Mac, the tools, the repository and the signing keychain (its certificate must be
#               the one committed in build/mac-signing/certificate.pem);
#            2. installs the dependencies with BOTH Mac CPUs' native packages (pnpm install --cpu=arm64,x64);
#            3. unlocks the signing keychain for the build only (locked again however the script ends);
#            4. builds the zip, dmg, blockmap and latest-mac.yml (electron-builder), adding the bridge
#               signing rule when build/mac-signing/developer-id-team.txt exists (ADR-0109 §6);
#            5. runs verify-build.sh and lists the files to send to the developer with their SHA-256.
#          Usage (from the repository folder): bash apps/desktop/scripts/mac/build.sh [--version X.Y.Z]
#          --version builds the same code under another version number (the stage-6 test's 1.7.98 and
#          1.7.99); without it, the version in apps/desktop/package.json.
# Used by: the teammate who builds the Mac app (docs/testing/mac-release-test.md; each Mac release)
# Depends on: macOS, Xcode Command Line Tools (codesign, lipo, ditto), Node 24, pnpm (corepack), the
#             signing keychain from import-signing-cert.sh, scripts/mac/cert-tools.mjs, verify-build.sh
# Architecture: docs/decisions/ADR-0109-macos-internal-release.md §2
set -euo pipefail

KEYCHAIN="$HOME/Library/Keychains/paramount-signing.keychain-db"
NAME="Paramount Intelligence Internal Code Signing"
HERE="$(cd "$(dirname "$0")" && pwd)"
DESKTOP="$(cd "$HERE/../.." && pwd)"
REPO="$(cd "$DESKTOP/../.." && pwd)"
CERT="$DESKTOP/build/mac-signing/certificate.pem"
TEAM_FILE="$DESKTOP/build/mac-signing/developer-id-team.txt"
RULE_FILE="$DESKTOP/build/mac-signing/requirements.txt"

fail() {
  echo "STOPPED: $*" >&2
  exit 1
}

VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    *) fail "unknown option $1 (only --version X.Y.Z)" ;;
  esac
done
if [ -n "$VERSION" ] && ! echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  # Plain versions only: electron-builder would put a pre-release version (1.8.0-test.1) on another
  # update channel (test-mac.yml), which the app does not read.
  fail "--version must look like 1.7.98"
fi

echo "== Checking the Mac and the tools"
[ "$(uname)" = "Darwin" ] || fail "run this on the build Mac."
xcrun --find codesign >/dev/null 2>&1 || fail "install Apple's command-line tools: xcode-select --install"
command -v node >/dev/null || fail "install Node 24 from nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' ||
  fail "Node 24 or later is needed (node --version)"
command -v pnpm >/dev/null || fail "turn on pnpm: corepack enable"
[ -f "$CERT" ] || fail "build/mac-signing/certificate.pem is not in the repository yet (git pull)."
[ -e "$KEYCHAIN" ] || fail "the signing keychain is missing: run import-signing-cert.sh once (docs/deploy/mac-signing-certificate.md, part C)."

cd "$REPO"
if [ -n "$(git status --porcelain)" ] && [ "${KITE_ALLOW_DIRTY:-}" != "1" ]; then
  fail "the repository has uncommitted changes; build from a clean checkout of the release branch or tag."
fi

EXPECTED_SHA1="$(node "$HERE/cert-tools.mjs" fingerprint "$CERT" | sed -n 's/^sha1: //p')"
FOUND_SHA1="$(security find-certificate -c "$NAME" -Z "$KEYCHAIN" 2>/dev/null | sed -n 's/^SHA-1 hash: //p' | head -1)"
[ "$FOUND_SHA1" = "$EXPECTED_SHA1" ] ||
  fail "the signing keychain's certificate is not the repository's certificate.pem (never sign with another)."

echo "== Installing dependencies (both Mac CPUs' native packages)"
pnpm install --frozen-lockfile --cpu=arm64,x64

echo "== Unlocking the signing keychain (macOS asks for its password)"
security unlock-keychain "$KEYCHAIN"
trap 'security lock-keychain "$KEYCHAIN" >/dev/null 2>&1 || true' EXIT

EXTRA=()
if [ -f "$TEAM_FILE" ]; then
  # ADR-0109 §6: the one bridge release before the switch to Developer ID.
  node "$HERE/cert-tools.mjs" rule "$CERT" "$TEAM_FILE" "$RULE_FILE"
  EXTRA+=("-c.mac.requirements=build/mac-signing/requirements.txt")
fi
if [ -n "$VERSION" ]; then
  EXTRA+=("-c.extraMetadata.version=$VERSION")
fi

echo "== Building"
rm -rf "$DESKTOP/release"
(
  cd "$DESKTOP"
  pnpm run mac:prepare
  # CSC_KEYCHAIN: electron-builder looks for the certificate (by its name, electron-builder.yml
  # mac.identity) in this keychain only; CSC_IDENTITY_AUTO_DISCOVERY off so it never picks another one.
  CSC_KEYCHAIN="$KEYCHAIN" CSC_IDENTITY_AUTO_DISCOVERY=false \
    pnpm exec electron-builder --mac --publish never ${EXTRA[@]+"${EXTRA[@]}"}
)

echo "== Checking the build"
bash "$HERE/verify-build.sh" "$DESKTOP/release"

echo
echo "== Send these files to the developer (SHA-256 to compare after the transfer):"
(
  cd "$DESKTOP/release"
  shasum -a 256 latest-mac.yml ./*.zip ./*.zip.blockmap ./*.dmg | sed 's#  \./#  #'
)
echo "Folder: $DESKTOP/release"
