#!/usr/bin/env bash
set -euo pipefail

ROOT="$HOME/.local/share/decky-whatsapp/voice"
SOURCE="$ROOT/whisper.cpp"
BUILD="$SOURCE/build"
MODEL="$ROOT/models/ggml-base.bin"

mkdir -p "$ROOT/models"

if ! command -v cmake >/dev/null 2>&1 || ! command -v c++ >/dev/null 2>&1; then
  echo "cmake and a C++ compiler are required on the Steam Deck."
  echo "Install the SteamOS development tools, then run this script again."
  exit 1
fi

if [ ! -d "$SOURCE/.git" ]; then
  rm -rf "$SOURCE"
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$SOURCE"
  else
    ARCHIVE="$ROOT/whisper.cpp.tar.gz"
    curl -L --fail --progress-bar \
      https://github.com/ggerganov/whisper.cpp/archive/refs/heads/master.tar.gz \
      -o "$ARCHIVE"
    mkdir -p "$SOURCE"
    tar -xzf "$ARCHIVE" --strip-components=1 -C "$SOURCE"
    rm -f "$ARCHIVE"
  fi
fi

cmake -S "$SOURCE" -B "$BUILD" \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=OFF
cmake --build "$BUILD" --config Release -j2

if [ ! -f "$MODEL" ]; then
  curl -L --fail --progress-bar \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true" \
    -o "$MODEL"
fi

CLI="$BUILD/bin/whisper-cli"
if [ ! -x "$CLI" ]; then
  CLI="$BUILD/main"
fi
if [ ! -x "$CLI" ]; then
  echo "The Whisper executable was not found after building."
  exit 1
fi

printf '%s\n' "$CLI" > "$ROOT/whisper-cli.path"
printf '%s\n' "$MODEL" > "$ROOT/model.path"

echo "Whisper installed successfully."
echo "Executable: $CLI"
echo "Model:     $MODEL"
