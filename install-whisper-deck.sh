#!/usr/bin/env bash
# Build and install optional local Whisper support for Deck voice typing.
set -euo pipefail

if (( EUID == 0 )); then
  echo "Run this installer as the deck user, not as root or with sudo." >&2
  echo "The installer invokes sudo only for system package operations." >&2
  exit 1
fi

readonly ROOT="$HOME/.local/share/decky-whatsapp/voice"
readonly SOURCE_REVISION="927cfce34f31707e17f2bff35c349632fb9e2c3a"
readonly SOURCE="$ROOT/whisper.cpp-$SOURCE_REVISION"
readonly BUILD="$SOURCE/build"
readonly MODEL="$ROOT/models/ggml-base.bin"
readonly MODEL_REVISION="5359861c739e955e79d9a303bcbc70fb988958b1"
readonly MODEL_SHA1="465707469ff3a37a2b9b8d8f89f2f99de7299dac"
READONLY_WAS_ENABLED=0
SOURCE_TEMP=""
MODEL_TEMP=""

restore_steamos_readonly() {
  if [[ "$READONLY_WAS_ENABLED" == "1" ]]; then
    echo "Restoring SteamOS read-only mode..."
    if ! sudo steamos-readonly enable; then
      echo "Error: SteamOS read-only mode could not be restored automatically." >&2
      echo "Run: sudo steamos-readonly enable" >&2
      return 1
    fi
    READONLY_WAS_ENABLED=0
  fi
}

cleanup() {
  local exit_status=$?
  trap - EXIT

  if [[ -n "$MODEL_TEMP" ]]; then
    rm -f -- "$MODEL_TEMP" || true
  fi
  if [[ -n "$SOURCE_TEMP" ]]; then
    rm -rf -- "$SOURCE_TEMP" || true
  fi

  if ! restore_steamos_readonly && (( exit_status == 0 )); then
    exit_status=1
  fi
  exit "$exit_status"
}

# Always attempt restoration on errors, interruption, or a normal exit.
trap cleanup EXIT

mkdir -p "$ROOT/models"

needs_toolchain=0
for command_name in cmake c++ curl git sha1sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    needs_toolchain=1
  fi
done

# These headers can be missing even when the compiler command exists.
missing_header_packages=()
if [[ ! -f /usr/include/features.h ]]; then
  missing_header_packages+=(glibc)
  needs_toolchain=1
fi
if [[ ! -f /usr/include/linux/errno.h ]]; then
  missing_header_packages+=(linux-api-headers)
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

  # Pacman's --needed can skip a package whose database version is current
  # even when one of its installed headers is missing. Reinstall only owners
  # of headers that were absent before preparation.
  if (( ${#missing_header_packages[@]} > 0 )); then
    echo "Reinstalling packages for missing system headers..."
    sudo pacman -S --noconfirm "${missing_header_packages[@]}"
  fi

  echo "Installing CMake, compiler, Git, headers, and download tools..."
  sudo pacman -S --needed --noconfirm \
    base-devel cmake curl git glibc linux-api-headers

  # Restore immediately after package operations, before any source/model
  # downloads or compilation. The EXIT trap retries if this fails.
  restore_steamos_readonly || exit 1
fi

for command_name in cmake c++ curl git sha1sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is still missing after preparation: $command_name" >&2
    exit 1
  fi
done

if [[ ! -f /usr/include/features.h ]] || [[ ! -f /usr/include/linux/errno.h ]]; then
  echo "Required system headers are still missing after preparation." >&2
  exit 1
fi

if [[ -e "$SOURCE" ]]; then
  if [[ ! -f "$SOURCE/CMakeLists.txt" ]] \
    || [[ ! -d "$SOURCE/.git" ]] \
    || [[ "$(git -C "$SOURCE" rev-parse HEAD 2>/dev/null || true)" != "$SOURCE_REVISION" ]]; then
    echo "Existing pinned Whisper source directory is incomplete or has the wrong revision: $SOURCE" >&2
    echo "Move it aside yourself if you want the installer to create a fresh checkout." >&2
    exit 1
  fi
else
  SOURCE_TEMP=$(mktemp -d "$ROOT/.whisper.cpp-source.XXXXXX")
  echo "Fetching pinned whisper.cpp source..."
  git clone --quiet --no-checkout https://github.com/ggml-org/whisper.cpp.git "$SOURCE_TEMP"
  git -C "$SOURCE_TEMP" checkout --quiet --detach "$SOURCE_REVISION"
  actual_revision=$(git -C "$SOURCE_TEMP" rev-parse HEAD)
  if [[ "$actual_revision" != "$SOURCE_REVISION" ]] \
    || [[ ! -f "$SOURCE_TEMP/CMakeLists.txt" ]]; then
    echo "The pinned whisper.cpp source checkout failed validation." >&2
    exit 1
  fi
  mv -- "$SOURCE_TEMP" "$SOURCE"
  SOURCE_TEMP=""
fi

echo "Building Whisper locally on the Steam Deck..."
cmake -S "$SOURCE" -B "$BUILD" \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=OFF
cmake --build "$BUILD" --config Release -j2

model_is_valid() {
  [[ -f "$1" ]] \
    && [[ "$(sha1sum "$1" | cut -d ' ' -f 1)" == "$MODEL_SHA1" ]]
}

if ! model_is_valid "$MODEL"; then
  echo "Downloading the pinned Whisper Base model..."
  MODEL_TEMP=$(mktemp "$ROOT/models/.ggml-base.download.XXXXXX")
  curl -L --fail --progress-bar \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/$MODEL_REVISION/ggml-base.bin?download=true" \
    -o "$MODEL_TEMP"
  if ! model_is_valid "$MODEL_TEMP"; then
    echo "The downloaded Whisper model failed SHA-1 integrity validation." >&2
    exit 1
  fi
  mv -f -- "$MODEL_TEMP" "$MODEL"
  MODEL_TEMP=""
fi

CLI="$BUILD/bin/whisper-cli"
if [[ ! -x "$CLI" ]]; then
  CLI="$BUILD/main"
fi
if [[ ! -x "$CLI" ]]; then
  echo "The Whisper executable was not found after building." >&2
  exit 1
fi

# Save the executable and validated model paths consumed by the Decky backend.
printf '%s\n' "$CLI" > "$ROOT/whisper-cli.path"
printf '%s\n' "$MODEL" > "$ROOT/model.path"

echo "Whisper installed successfully."
echo "Executable: $CLI"
echo "Model:     $MODEL"
