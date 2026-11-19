#!/bin/bash
# File: apps/desktop/scripts/mac/import-signing-cert.sh
# Purpose: Prepares the build Mac ONCE (ADR-0109 §1): puts the company's signing certificate (.p12, from
#          the password manager) into its own keychain, paramount-signing.keychain-db, lets only Apple's
#          codesign use the key, and trusts the certificate for code signing only. It refuses a .p12 whose
#          certificate is not the one committed in the repository (build/mac-signing/certificate.pem).
#          Usage (from the repository folder): bash apps/desktop/scripts/mac/import-signing-cert.sh <file.p12>
# Used by: the teammate who builds the Mac app (docs/deploy/mac-signing-certificate.md, part C)
# Depends on: macOS's security tool, Node (scripts/mac/cert-tools.mjs), the committed certificate.pem
# Architecture: docs/decisions/ADR-0109-macos-internal-release.md §1, §2
#
# macOS itself asks for each password (the new keychain's, the .p12's, and your Mac login password to
# trust the certificate); the script never sees or prints them.
set -euo pipefail

NAME="Paramount Intelligence Internal Code Signing"
KEYCHAIN="$HOME/Library/Keychains/paramount-signing.keychain-db"
HERE="$(cd "$(dirname "$0")" && pwd)"
DESKTOP="$(cd "$HERE/../.." && pwd)"
CERT="$DESKTOP/build/mac-signing/certificate.pem"
P12="${1:-}"

fail() {
  echo "STOPPED: $*" >&2
  exit 1
}

[ "$(uname)" = "Darwin" ] || fail "run this on the build Mac."
[ -n "$P12" ] && [ -f "$P12" ] || fail "give the path of the .p12 file, for example ~/Downloads/paramount-signing.p12"
[ -f "$CERT" ] || fail "build/mac-signing/certificate.pem is not in the repository yet (git pull first)."
[ ! -e "$KEYCHAIN" ] || fail "the keychain already exists. To start again: security delete-keychain \"$KEYCHAIN\""

EXPECTED_SHA1="$(node "$HERE/cert-tools.mjs" fingerprint "$CERT" | sed -n 's/^sha1: //p')"

echo "1/5 Making the signing keychain. macOS asks you to choose its password:"
echo "    save it in your password manager as \"Build Mac signing keychain\"."
security create-keychain "$KEYCHAIN"
# Locks itself after an hour without use and when the Mac sleeps.
security set-keychain-settings -lut 3600 "$KEYCHAIN"
security unlock-keychain "$KEYCHAIN"

echo "2/5 Importing the certificate and key. macOS asks for the .p12 file's password."
security import "$P12" -k "$KEYCHAIN" -f pkcs12 -T /usr/bin/codesign

echo "3/5 Letting only Apple's signing tools use the key (macOS asks for the keychain password)."
security set-key-partition-list -S apple-tool:,apple: -s "$KEYCHAIN" >/dev/null

echo "4/5 Adding the keychain to your keychain list, so codesign finds it."
EXISTING="$(security list-keychains -d user | sed -e 's/^ *"//' -e 's/" *$//')"
# shellcheck disable=SC2086 # each existing keychain path is one line without spaces in the usual case
security list-keychains -d user -s "$KEYCHAIN" $EXISTING

echo "5/5 Trusting the certificate for code signing only (macOS asks for your Mac login password)."
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$CERT"

FOUND_SHA1="$(security find-certificate -c "$NAME" -Z "$KEYCHAIN" | sed -n 's/^SHA-1 hash: //p' | head -1)"
if [ "$FOUND_SHA1" != "$EXPECTED_SHA1" ]; then
  security lock-keychain "$KEYCHAIN"
  fail "the .p12 holds a different certificate from the repository's certificate.pem. Use the company's .p12."
fi
if ! security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "\"$NAME\""; then
  security lock-keychain "$KEYCHAIN"
  fail "macOS does not list the certificate as valid for code signing. See the guide's troubleshooting."
fi
security lock-keychain "$KEYCHAIN"

echo
echo "PASS: the build Mac can sign Paramount AI (certificate SHA-1 $FOUND_SHA1)."
echo "Now delete the .p12 file you downloaded: rm \"$P12\" (the master copy stays in the password manager)."
