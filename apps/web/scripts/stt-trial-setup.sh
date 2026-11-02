#!/usr/bin/env bash
# File: apps/web/scripts/stt-trial-setup.sh
# Purpose: Downloads the Day 6 speech engine candidates for scripts/stt-trial.ts, each checked
#          against its published SHA-256, into a folder outside the repository (about 1.5 GB):
#          Parakeet TDT 0.6B v2 int8 (sherpa-onnx), sherpa-onnx-node 1.13.8, whisper.cpp b4938
#          (the newest release with Windows binaries), large-v3-turbo q5_0 and small.en models.
#          Safe to run again: finished, verified files are kept.
#          Usage: bash apps/web/scripts/stt-trial-setup.sh
# Used by: the developer, once, before scripts/stt-trial.ts (measure only: nothing here is part of
#          the product)
# Architecture: docs/decisions/ADR-0027-desktop-speech-engine.md; day-06 Stage 1
set -euo pipefail

dir="${KITE_STT_TRIAL_DIR:-$LOCALAPPDATA/kite-stt-trial}"
mkdir -p "$dir/downloads" "$dir/whisper" "$dir/node"

# Downloads a file (resuming a partial one) and checks its SHA-256. Hashed from stdin: with a path
# holding backslashes, sha256sum prefixes its output with a backslash.
fetch() {
  local name="$1" url="$2" sha="$3"
  local file="$dir/downloads/$name"
  if [ -f "$file" ] && [ "$(sha256sum < "$file" | cut -d' ' -f1)" = "$sha" ]; then
    echo "ok (already here): $name"
    return
  fi
  curl -fsSL --retry 3 -C - -o "$file" "$url"
  if [ "$(sha256sum < "$file" | cut -d' ' -f1)" != "$sha" ]; then
    echo "SHA-256 mismatch: $name" >&2
    exit 1
  fi
  echo "ok: $name ($(wc -c < "$file") bytes)"
}

fetch sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2 \
  157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad
fetch whisper-bin-x64.zip \
  https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip \
  c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d
fetch ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin \
  394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2
fetch ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin \
  c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d

# Unpack (from inside the folder: Git Bash tar reads "C:..." as a remote host), and install the Node addon outside the workspace (no change to the product's packages).
[ -d "$dir/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8" ] ||
  (cd "$dir" && tar -xjf downloads/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2)
unzip -oq "$dir/downloads/whisper-bin-x64.zip" -d "$dir/whisper"
(cd "$dir/node" && npm init -y >/dev/null && npm install --no-audit --no-fund --save-exact \
  sherpa-onnx-node@1.13.8 sherpa-onnx-win-x64@1.13.8 >/dev/null)
echo "ready: $dir"
