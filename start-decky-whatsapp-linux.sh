#!/usr/bin/env bash
# Deliberately start the local bridge and its foreground SSH tunnel supervisor.
set -Eeuo pipefail
IFS=$'\n\t'

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

[[ -t 0 && -t 1 ]] || fail "Run this launcher from an interactive terminal. It does not run as a service or in the background."

# Resolve shortcut and checkout symlinks before locating package files.
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
[[ -f "${PROJECT_ROOT}/package.json" && -f "${PROJECT_ROOT}/package-lock.json" ]] || fail "Could not locate the DeckyWhatsapp package root from ${source_path}."

command -v node >/dev/null 2>&1 || fail "Node.js is unavailable. Run install-decky-whatsapp-linux.sh first."
command -v npm >/dev/null 2>&1 || fail "npm is unavailable. Install Node.js 22 or newer, then run install-decky-whatsapp-linux.sh."
command -v ssh >/dev/null 2>&1 || fail "OpenSSH client is unavailable. Run install-decky-whatsapp-linux.sh first."
[[ -x "${PROJECT_ROOT}/node_modules/.bin/tsx" ]] || fail "Project dependencies are not installed. Run install-decky-whatsapp-linux.sh (npm ci), then retry."

cd -- "${PROJECT_ROOT}"
bridge_port="$(node --input-type=module -e 'import dotenv from "dotenv"; dotenv.config({ quiet: true }); process.stdout.write(process.env.PORT ?? "8787")')" || fail "Could not read the configured bridge port. Check Node.js and the project configuration."
[[ "${bridge_port}" =~ ^[0-9]+$ ]] || fail "Configured PORT must be an integer from 1 to 65535."
(( bridge_port >= 1 && bridge_port <= 65535 )) || fail "Configured PORT must be an integer from 1 to 65535."

deck_host="${DECK_HOST:-}"
if [[ -z "${deck_host}" ]]; then
  if command -v getent >/dev/null 2>&1 && getent ahostsv4 steamdeck.lan >/dev/null 2>&1; then
    printf 'Found Steam Deck hostname steamdeck.lan.\n'
    read -r -p "Steam Deck hostname or IP [steamdeck.lan]: " deck_host
    deck_host="${deck_host:-steamdeck.lan}"
  else
    printf 'Could not resolve steamdeck.lan.\n'
    read -r -p "Enter the Steam Deck hostname or IP address: " deck_host
  fi
fi
[[ "${deck_host}" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]] || fail "Invalid Steam Deck hostname/address. Use a hostname or IP without spaces or SSH options."

printf 'Using loopback bridge port %s and Steam Deck %s@%s.\n' "${bridge_port}" "deck" "${deck_host}"
printf 'The bridge will run from the project directory so .env and WhatsApp session/cache locations stay stable.\n'
printf 'Press Ctrl+C to stop this launcher, its own tunnel, and its own bridge.\n\n'

exec bash "${PROJECT_ROOT}/keep-ssh-tunnel.sh" \
  --project-root "${PROJECT_ROOT}" \
  --bridge-port "${bridge_port}" \
  --deck-host "${deck_host}"
