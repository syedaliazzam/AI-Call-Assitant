#!/bin/bash
# File: apps/desktop/scripts/mac/make-signing-cert.sh
# Purpose: Creates the company's Mac code-signing certificate ONCE (ADR-0109 §1): a self-signed certificate
#          named "Paramount Intelligence Internal Code Signing" (RSA 3072, 100 years, code signing only).
#          It writes two files into a new folder on the Desktop:
#            certificate.pem         the PUBLIC certificate (not secret; goes into the repository)
#            paramount-signing.p12   the certificate WITH its private key, protected by a password you type
#          The private key never exists anywhere else: it is made in a temporary folder only you can read,
#          and that folder is deleted when the script ends.
#          Usage: bash make-signing-cert.sh
# Used by: the lead or the developer, once, on a Mac (docs/deploy/mac-signing-certificate.md, stage 5)
# Depends on: macOS's own /usr/bin/openssl (LibreSSL: its .p12 files import into the macOS keychain)
# Architecture: docs/decisions/ADR-0109-macos-internal-release.md §1
#
# Never prints the password or the private key.
set -euo pipefail
umask 077

NAME="Paramount Intelligence Internal Code Signing"
OPENSSL=/usr/bin/openssl

if [ "$(uname)" != "Darwin" ]; then
  echo "Run this on a Mac." >&2
  exit 1
fi

OUT="$HOME/Desktop/paramount-signing-$(date +%Y-%m-%d)"
if [ -e "$OUT" ]; then
  echo "$OUT already exists. Move it away first (a certificate is made only once)." >&2
  exit 1
fi

echo "This makes the company's Mac signing certificate. Do it only once:"
echo "every Mac build must be signed with the same certificate."
echo
echo "First, in the company password manager, create an entry"
echo "  \"Paramount AI Mac signing certificate (.p12)\""
echo "and let it generate a password of at least 24 characters. You will type that password below."
echo
printf "Password for the .p12 file: "
read -r -s P12_ONE
echo
printf "The same password again: "
read -r -s P12_TWO
echo
if [ "$P12_ONE" != "$P12_TWO" ]; then
  echo "The two passwords are different. Nothing was made." >&2
  exit 1
fi
if [ "${#P12_ONE}" -lt 20 ]; then
  echo "Use a longer password (at least 20 characters). Nothing was made." >&2
  exit 1
fi

WORK="$(mktemp -d)"
# The private key file lives only in this temporary folder, removed however the script ends.
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/certificate.cnf" <<CONFIG
[ req ]
distinguished_name = subject
x509_extensions = extensions
prompt = no

[ subject ]
CN = $NAME
O = Paramount Intelligence

[ extensions ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CONFIG

# 36,500 days: about 100 years. Builds are signed without a timestamp server, so the certificate must
# outlive every build that might still be installed.
"$OPENSSL" req -x509 -newkey rsa:3072 -sha256 -days 36500 -nodes \
  -config "$WORK/certificate.cnf" -keyout "$WORK/key.pem" -out "$WORK/certificate.pem" 2>/dev/null

mkdir -p "$OUT"
cp "$WORK/certificate.pem" "$OUT/certificate.pem"
# The password goes through the environment, never the command line (other programs can read that).
P12_PASSWORD="$P12_ONE" "$OPENSSL" pkcs12 -export \
  -inkey "$WORK/key.pem" -in "$WORK/certificate.pem" -name "$NAME" \
  -out "$OUT/paramount-signing.p12" -passout env:P12_PASSWORD
unset P12_ONE P12_TWO

SHA1="$("$OPENSSL" x509 -in "$OUT/certificate.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)"
SHA256="$("$OPENSSL" x509 -in "$OUT/certificate.pem" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d : | tr 'A-F' 'a-f')"

echo
echo "Done. In $OUT:"
echo "  certificate.pem         public: send it to the developer (it goes into the repository)"
echo "  paramount-signing.p12   SECRET: attach it to the password-manager entry, then delete it here"
echo
echo "Fingerprints (public; write them in the password-manager entry's notes):"
echo "  SHA-1:   $SHA1"
echo "  SHA-256: $SHA256"
