#!/usr/bin/env bash
# Deliberately start the local bridge and its foreground SSH tunnel supervisor.
set -Eeuo pipefail
IFS=$'\n\t'

# Resolve installer-created shortcuts before loading project helpers or handling
# options; the launcher may be linked from ~/.local/bin, outside the checkout.
source_path="${BASH_SOURCE[0]}"
while [[ -L "${source_path}" ]]; do
  source_dir="$(cd -P -- "$(dirname -- "${source_path}")" && pwd)"
  link_target="$(readlink -- "${source_path}")"
  if [[ "${link_target}" == /* ]]; then
    source_path="${link_target}"
  else
    source_path="${source_dir}/${link_target}"
  fi
done
PROJECT_ROOT="$(cd -P -- "$(dirname -- "${source_path}")" && pwd)"
source "${PROJECT_ROOT}/scripts/launcher-validation.sh"
source "${PROJECT_ROOT}/scripts/linux-deck-host-config.sh"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

suggest_deck_host() {
  command -v node >/dev/null 2>&1 || return 0
  [[ -f "${PROJECT_ROOT}/scripts/suggest-deck-host.mjs" ]] || return 0
  node "${PROJECT_ROOT}/scripts/suggest-deck-host.mjs" 2>/dev/null || true
}

load_saved_deck_host() {
  read_saved_deck_host || fail "Saved Deck address is invalid or has unsafe ownership/permissions. Reconfigure it with --configure-deck-host."
}

requested_host=""
configure_host=0
configured_host=""
configured_host_provided=0
while (($#)); do
  case "$1" in
    --deck-host)
      (($# >= 2)) || fail "--deck-host requires a hostname or IP address."
      requested_host="$2"
      shift 2
      ;;
    --configure-deck-host)
      configure_host=1
      shift
      if (($#)) && [[ "$1" != -* ]]; then
        configured_host="$1"
        configured_host_provided=1
        shift
      fi
      ;;
    -h|--help)
      printf 'Usage: %s [--deck-host HOST] [--configure-deck-host [HOST]]\n' "${0##*/}"
      printf 'Use --deck-host for a one-time override; --configure-deck-host saves a new default and exits.\n'
      exit 0
      ;;
    *) fail "Unknown launcher option: $1" ;;
  esac
done
if (( configure_host )); then
  [[ -z "${requested_host}" && -z "${DECK_HOST:-}" ]] || fail "Use only one of --configure-deck-host, --deck-host, or DECK_HOST."
  SAVED_DECK_HOST=""
  if ! read_saved_deck_host; then
    SAVED_DECK_HOST=""
    printf 'No valid saved Deck address was found; enter a replacement address.\n'
  fi
  if (( configured_host_provided )); then
    deck_host="${configured_host}"
  else
    [[ -t 0 && -t 1 ]] || fail "Run configuration interactively, or supply the new address: --configure-deck-host HOST."
    if [[ -n "${SAVED_DECK_HOST}" ]]; then
      default_host="${SAVED_DECK_HOST}"
    else
      default_host="$(suggest_deck_host)"
    fi
    if [[ -n "${default_host}" ]]; then
      read -r -p "Steam Deck hostname or IP [${default_host}]: " deck_host
      deck_host="${deck_host:-${default_host}}"
    else
      read -r -p "No known Steam Deck hostname resolved. Enter the Steam Deck hostname or IP address: " deck_host
    fi
  fi
  valid_deck_host "${deck_host}" || fail "Invalid Steam Deck hostname/address. Use a hostname or IP without spaces or SSH options."
  save_deck_host_config "${deck_host}"
  printf 'Saved the default Steam Deck address for this user. No bridge or SSH tunnel was started.\n'
  exit 0
fi
[[ -t 0 && -t 1 ]] || fail "Run this launcher from an interactive terminal. It does not run as a service or in the background."

[[ -f "${PROJECT_ROOT}/package.json" && -f "${PROJECT_ROOT}/package-lock.json" ]] || fail "Could not locate the DeckyWhatsapp package root from ${source_path}."

command -v node >/dev/null 2>&1 || fail "Node.js is unavailable. Run install-decky-whatsapp-linux.sh first."
command -v npm >/dev/null 2>&1 || fail "npm is unavailable. Install Node.js 22 or newer, then run install-decky-whatsapp-linux.sh."
command -v ssh >/dev/null 2>&1 || fail "OpenSSH client is unavailable. Run install-decky-whatsapp-linux.sh first."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "Node.js 22 or newer is required; found $(node --version). Run install-decky-whatsapp-linux.sh again."
[[ -x "${PROJECT_ROOT}/node_modules/.bin/tsx" ]] || fail "Project dependencies are not installed. Run install-decky-whatsapp-linux.sh (npm ci), then retry."

cd -- "${PROJECT_ROOT}"
bridge_port="$(node scripts/read-bridge-port.mjs)" || fail "Configured PORT must be a decimal integer from 1 to 65535."

SAVED_DECK_HOST=""
if [[ -z "${requested_host}" && -z "${DECK_HOST:-}" ]]; then load_saved_deck_host; fi
deck_host="${requested_host:-${DECK_HOST:-${SAVED_DECK_HOST}}}"
if [[ -z "${deck_host}" ]]; then
  suggested_host="$(suggest_deck_host)"
  if [[ -n "${suggested_host}" ]]; then
    printf 'Resolved a suggested Steam Deck hostname: %s.\n' "${suggested_host}"
    read -r -p "Steam Deck hostname or IP [${suggested_host}]: " deck_host
    deck_host="${deck_host:-${suggested_host}}"
  else
    printf 'No known Steam Deck hostname resolved.\n'
    read -r -p "Enter the Steam Deck hostname or IP address manually: " deck_host
  fi
  valid_deck_host "${deck_host}" || fail "Invalid Steam Deck hostname/address. Use a hostname or IP without spaces or SSH options."
  save_deck_host_config "${deck_host}"
  printf 'Saved the default Steam Deck address for this user.\n'
fi
valid_deck_host "${deck_host}" || fail "Invalid Steam Deck hostname/address. Use a hostname or IP without spaces or SSH options."

printf 'Using loopback bridge port %s and Steam Deck %s@%s.\n' "${bridge_port}" "deck" "${deck_host}"
printf 'The bridge will run from the project directory so .env and WhatsApp session/cache locations stay stable.\n'
printf 'Foreground mode: the WhatsApp bridge and SSH tunnel use this same terminal; no second window is opened.\n'
printf 'Press Ctrl+C to stop this launcher, its own tunnel, and its own bridge.\n\n'

exec bash "${PROJECT_ROOT}/keep-ssh-tunnel.sh" \
  --project-root "${PROJECT_ROOT}" \
  --bridge-port "${bridge_port}" \
  --deck-host "${deck_host}"
