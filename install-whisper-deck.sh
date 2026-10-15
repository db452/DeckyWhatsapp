#!/usr/bin/env bash
# Build and install optional local Whisper support for Deck voice typing.
set -euo pipefail

ROOT="$HOME/.local/share/decky-whatsapp/voice"
SOURCE="$ROOT/whisper.cpp"
BUILD="$SOURCE/build"
MODEL="$ROOT/models/ggml-base.bin"
ARCHIVE="$ROOT/whisper.cpp.tar.gz"
READONLY_WAS_ENABLED=0

restore_steamos_readonly() {
  if [[ "$READONLY_WAS_ENABLED" == "1" ]] && command -v steamos-readonly >/dev/null 2>&1; then
    echo "Restoring SteamOS read-only mode..."
    if ! sudo steamos-readonly enable; then
      echo "Warning: SteamOS read-only mode could not be restored automatically." >&2
      echo "Run: sudo steamos-readonly enable" >&2
    fi
  fi
}

# On exit, attempt to restore read-only mode if this run disabled it.
trap restore_steamos_readonly EXIT

mkdir -p "$ROOT/models"

needs_toolchain=0
for command_name in cmake c++ curl tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    needs_toolchain=1
  fi
done

# These headers can be missing even when the compiler command exists.
if [[ ! -f /usr/include/features.h ]] || [[ ! -f /usr/include/linux/errno.h ]]; then
  needs_toolchain=1
fi

if [[ "$needs_toolchain" == "1" ]]; then
  if ! command -v pacman >/dev/null 2>&1; then
    echo "Pacman is required to install the SteamOS build tools." >&2
    exit 1
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to install the SteamOS build tools." >&2
    exit 1
  fi

  echo "SteamOS development tools are missing. Administrator access is required once."
  sudo -v

  if command -v steamos-readonly >/dev/null 2>&1 \
    && steamos-readonly status 2>/dev/null | grep -qi "enabled"; then
    echo "Temporarily disabling SteamOS read-only mode..."
    sudo steamos-readonly disable
    READONLY_WAS_ENABLED=1
  fi

  echo "Preparing the Pacman keyring..."
  sudo pacman-key --init
  sudo pacman-key --populate archlinux

  echo "Installing CMake, compiler, headers, and download tools..."
  sudo pacman -S --needed --noconfirm \
    base-devel cmake curl tar glibc linux-api-headers
fi

for command_name in cmake c++ curl tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is still missing after preparation: $command_name" >&2
    exit 1
  fi
done

if [[ ! -f /usr/include/features.h ]] || [[ ! -f /usr/include/linux/errno.h ]]; then
  echo "Required system headers are still missing after preparation." >&2
  exit 1
fi

if [[ ! -f "$SOURCE/CMakeLists.txt" ]]; then
  rm -rf "$SOURCE"
  echo "Downloading whisper.cpp source archive..."
  curl -L --fail --progress-bar \
    https://github.com/ggerganov/whisper.cpp/archive/refs/heads/master.tar.gz \
    -o "$ARCHIVE"
  mkdir -p "$SOURCE"
  tar -xzf "$ARCHIVE" --strip-components=1 -C "$SOURCE"
  rm -f "$ARCHIVE"
fi

echo "Building Whisper locally on the Steam Deck..."
cmake -S "$SOURCE" -B "$BUILD" \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=OFF
cmake --build "$BUILD" --config Release -j2

# A previous interrupted installer may have left a truncated model behind.
if [[ ! -f "$MODEL" ]] || [[ $(stat -c%s "$MODEL") -lt 100000000 ]]; then
  echo "Downloading the Whisper Base model..."
  MODEL_DOWNLOAD="$MODEL.download"
  rm -f "$MODEL_DOWNLOAD"
  curl -L --fail --progress-bar \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true" \
    -o "$MODEL_DOWNLOAD"
  if [[ $(stat -c%s "$MODEL_DOWNLOAD") -lt 100000000 ]]; then
    rm -f "$MODEL_DOWNLOAD"
    echo "The downloaded Whisper model is incomplete." >&2
    exit 1
  fi
  mv "$MODEL_DOWNLOAD" "$MODEL"
fi

CLI="$BUILD/bin/whisper-cli"
if [[ ! -x "$CLI" ]]; then
  CLI="$BUILD/main"
fi
if [[ ! -x "$CLI" ]]; then
  echo "The Whisper executable was not found after building." >&2
  exit 1
fi

# Save the executable and model paths consumed by the Decky backend.
printf '%s\n' "$CLI" > "$ROOT/whisper-cli.path"
printf '%s\n' "$MODEL" > "$ROOT/model.path"

echo "Whisper installed successfully."
echo "Executable: $CLI"
echo "Model:     $MODEL"
