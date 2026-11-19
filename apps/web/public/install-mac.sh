#!/bin/bash
# File: apps/web/public/install-mac.sh
# Purpose: Installs or updates Paramount AI on a Mac (ADR-0109 §4). Run it from Terminal:
#            curl -fsSL https://call.paramountintelligence.co/install-mac.sh | bash
#          What it does, in order:
#            1. checks this is macOS 12 or later;
#            2. reads the current Mac version's details (latest-mac.yml) from the mac-latest release;
#            3. downloads the app (a zip) and checks its SHA-512 against those details;
#            4. unpacks it and checks its signature, and that it is signed with Paramount Intelligence's
#               certificate (its SHA-256 fingerprint is written below);
#            5. quits a running Paramount AI, puts the new app in /Applications (or in ~/Applications if
#               you cannot write to /Applications; it never asks for an administrator password), removes
#               the "downloaded from the internet" mark, and opens it.
#          If any check fails, nothing is installed.
# Used by: Mac users (the "Get Paramount AI for Mac" box in the web app); the stage-6 test
#          (docs/testing/mac-release-test.md), with PARAMOUNT_AI_FEED pointing at a feed on the Mac itself
# Depends on: macOS's own tools only (curl, openssl, ditto, codesign, shasum, PlistBuddy, xattr, open)
# Architecture: docs/decisions/ADR-0109-macos-internal-release.md §4
#
# Everything is inside main(), called on the last line, so a download cut short runs nothing.

# The Mac app's update channel (electron-builder.yml mac.publish).
FEED_DEFAULT="https://github.com/Zainpak123/kite-releases/releases/download/mac-latest"
BUNDLE_ID="co.paramountintelligence.kite"
APP_NAME="Paramount AI"
# SHA-256 of the company's Mac signing certificate (public; ADR-0109 §1). Written by
# `node apps/desktop/scripts/mac/cert-tools.mjs pin <certificate.pem> apps/web/public/install-mac.sh`.
PINNED_CERT_SHA256="not-set"

main() {
  set -euo pipefail

  say() { printf '%s\n' "$*"; }
  stop() {
    printf '\nParamount AI was not installed: %s\n' "$*" >&2
    exit 1
  }

  [ "$(uname -s)" = "Darwin" ] || stop "this installer is for macOS."
  if [ "${#PINNED_CERT_SHA256}" -ne 64 ] || printf '%s' "$PINNED_CERT_SHA256" | grep -q '[^0-9a-f]'; then
    stop "this installer is not ready yet (no certificate fingerprint). Ask the Paramount AI team."
  fi

  local macos major
  macos="$(sw_vers -productVersion)"
  major="${macos%%.*}"
  [ "$major" -ge 12 ] || stop "macOS 12 or later is needed (this Mac has macOS $macos)."

  # The feed: GitHub, or (the stage-6 test only) a feed on this Mac. Nothing else is accepted.
  local feed="${PARAMOUNT_AI_FEED:-$FEED_DEFAULT}"
  local protocols="=https"
  case "$feed" in
    https://*) ;;
    http://127.0.0.1:* | http://localhost:*) protocols="=http" ;;
    *) stop "PARAMOUNT_AI_FEED must be https:// or a feed on this Mac." ;;
  esac
  feed="${feed%/}"

  local work
  work="$(mktemp -d "${TMPDIR:-/tmp}/paramount-ai-install.XXXXXX")"
  # shellcheck disable=SC2064 # the folder's name is fixed now, on purpose
  trap "rm -rf '$work'" EXIT

  say "Checking the current Paramount AI for Mac…"
  curl -fsSL --retry 3 --proto "$protocols" --proto-redir "$protocols" \
    "$feed/latest-mac.yml" -o "$work/latest-mac.yml" ||
    stop "could not reach the download. Check the internet connection and try again."

  # Top-level fields of latest-mac.yml (electron-builder writes "key: value" lines).
  field() { sed -n "s/^$1: *//p" "$work/latest-mac.yml" | head -1 | tr -d "'\"\r"; }
  local version zip_name want
  version="$(field version)"
  zip_name="$(field path)"
  want="$(field sha512)"
  [ -n "$version" ] && [ -n "$zip_name" ] && [ -n "$want" ] ||
    stop "the download details are incomplete. Try again later."
  # A plain file name only (letters, digits, dot, dash, underscore), never a path.
  if printf '%s' "$zip_name" | grep -q '[^A-Za-z0-9._-]'; then
    stop "the download details name an unexpected file."
  fi

  say "Downloading Paramount AI $version (a few hundred MB)…"
  curl -fL --retry 3 --proto "$protocols" --proto-redir "$protocols" --progress-bar \
    "$feed/$zip_name" -o "$work/app.zip" ||
    stop "the download did not finish. Check the internet connection and try again."

  local got
  got="$(openssl dgst -sha512 -binary "$work/app.zip" | openssl base64 -A)"
  [ "$got" = "$want" ] || stop "the download is damaged or was changed (its checksum does not match)."
  say "  Checksum OK."

  mkdir "$work/unzipped"
  ditto -x -k "$work/app.zip" "$work/unzipped" || stop "the download could not be unpacked."
  local app="$work/unzipped/$APP_NAME.app"
  [ -d "$app" ] || stop "the download does not contain $APP_NAME."

  codesign --verify --deep --strict "$app" >/dev/null 2>&1 || stop "the app's signature is not valid."
  (cd "$work" && codesign -d --extract-certificates "$app" >/dev/null 2>&1) ||
    stop "the app's signing certificate could not be read."
  local signer
  signer="$(shasum -a 256 "$work/codesign0" | awk '{print $1}')"
  [ "$signer" = "$PINNED_CERT_SHA256" ] || stop "the app is not signed by Paramount Intelligence."
  local bundle_id
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")"
  [ "$bundle_id" = "$BUNDLE_ID" ] || stop "the download is not the Paramount AI app."
  say "  Signature OK (Paramount Intelligence)."

  # Where to install: an existing copy's folder first (no duplicates), else /Applications if writable,
  # else the user's own Applications folder (no administrator password needed).
  local dest_dir
  if [ -d "/Applications/$APP_NAME.app" ] && [ -w "/Applications" ]; then
    dest_dir="/Applications"
  elif [ -d "$HOME/Applications/$APP_NAME.app" ]; then
    dest_dir="$HOME/Applications"
  elif [ -w "/Applications" ]; then
    dest_dir="/Applications"
  else
    dest_dir="$HOME/Applications"
    mkdir -p "$dest_dir"
  fi
  local dest="$dest_dir/$APP_NAME.app"

  if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
    say "Quitting Paramount AI…"
    osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    local waited=0
    while pgrep -x "$APP_NAME" >/dev/null 2>&1 && [ "$waited" -lt 30 ]; do
      sleep 1
      waited=$((waited + 1))
    done
    # It may be finishing a Google Drive upload after the user quit (ADR-0106): never cut that short.
    if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
      stop "Paramount AI is still open (it may be finishing an upload). Quit it from its menu-bar icon, then run this again."
    fi
  fi

  # The new copy is put next to the old one first, then swapped in, so a failure leaves the old app.
  local staged="$dest_dir/.$APP_NAME.installing.$$"
  rm -rf "$staged"
  ditto "$app" "$staged" || stop "could not copy the app to $dest_dir."
  if [ -e "$dest" ]; then
    mv "$dest" "$work/previous.app" || {
      rm -rf "$staged"
      stop "could not replace the installed app in $dest_dir."
    }
  fi
  if ! mv "$staged" "$dest"; then
    [ -e "$work/previous.app" ] && mv "$work/previous.app" "$dest"
    rm -rf "$staged"
    stop "could not put the app in $dest_dir."
  fi
  # Downloaded with curl, it carries no quarantine mark; removed anyway in case a copy did.
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true

  say ""
  say "Installed Paramount AI $version in $dest_dir."
  say "Opening it now. The first time, macOS asks for the Microphone and for Screen & System Audio Recording."
  open "$dest"
}

main "$@"
