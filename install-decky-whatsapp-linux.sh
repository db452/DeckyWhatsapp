#!/usr/bin/env bash
# Deliberately prepare the Linux bridge checkout; this does not install a service or autostart entry.
set -Eeuo pipefail
IFS=$'\n\t'

readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly MIN_NODE_MAJOR=22
readonly DECK_USER="deck"
readonly SSH_DIR="${HOME}/.ssh"
readonly SSH_KEY="${SSH_DIR}/decky_whatsapp_ed25519"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

[[ -r "${PROJECT_DIR}/scripts/launcher-validation.sh" ]] || fail "Missing shared launcher validation helper under ${PROJECT_DIR}/scripts. Re-extract the complete Linux package and retry."
source "${PROJECT_DIR}/scripts/launcher-validation.sh"
[[ -r "${PROJECT_DIR}/scripts/linux-deck-host-config.sh" ]] || fail "Missing shared Deck address config helper under ${PROJECT_DIR}/scripts. Re-extract the complete Linux package and retry."
source "${PROJECT_DIR}/scripts/linux-deck-host-config.sh"

note() {
  printf '\n%s\n' "$*"
}

suggest_deck_host() {
  [[ -f "${PROJECT_DIR}/scripts/suggest-deck-host.mjs" ]] || return 0
  node "${PROJECT_DIR}/scripts/suggest-deck-host.mjs" 2>/dev/null || true
}

trap 'status=$?; printf "Installer stopped at line %s (exit %s).\n" "${BASH_LINENO[0]:-unknown}" "$status" >&2; exit "$status"' ERR

[[ -t 0 ]] || fail "Run this installer in an interactive terminal; it requires explicit consent for optional system-package and SSH-key changes."
[[ "${EUID}" -ne 0 ]] || fail "Run as your regular Linux user. The installer requests sudo only after you approve optional apt package installation."
[[ -f "${PROJECT_DIR}/package.json" && -f "${PROJECT_DIR}/package-lock.json" ]] || fail "Run this script from the DeckyWhatsapp project checkout; package.json or package-lock.json is missing."

# This first release intentionally targets Debian-family x86_64 only. The pinned
# Puppeteer browser bundle does not provide a validated native Linux ARM target.
[[ -r /etc/os-release ]] || fail "Cannot identify this Linux distribution: /etc/os-release is unavailable. Supported initial target: Ubuntu or Debian x86_64."
# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Unsupported distribution '${ID:-unknown}'. The initial installer supports Ubuntu and Debian only; Fedora and other distributions are deferred until dependency/runtime testing." ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "Unsupported architecture '$(uname -m)'. The initial target is x86_64; Linux ARM is excluded until a native browser setup is validated." ;;
esac

node_command="$(command -v node || true)"
npm_command="$(command -v npm || true)"
[[ -n "${node_command}" ]] || fail "Node.js is missing. Install a maintained Node.js 22 or newer release using a user-level version manager or the official Node.js distribution; this installer will not install Node globally. Node 24 LTS is recommended. Then rerun this script."
[[ -n "${npm_command}" ]] || fail "npm is missing. Install a Node.js distribution that includes npm, then rerun this script."

node_version="$(node --version)"
node_version="${node_version#v}"
node_major="${node_version%%.*}"
[[ "${node_major}" =~ ^[0-9]+$ ]] || fail "Could not parse Node.js version '${node_version}'."
(( node_major >= MIN_NODE_MAJOR )) || fail "Node.js ${node_version} is below the required major version ${MIN_NODE_MAJOR}. Node 20 is no longer maintained; install Node 22 or newer (Node 24 LTS recommended) and rerun."

missing_commands=()
for tool in git ssh; do
  command -v "${tool}" >/dev/null 2>&1 || missing_commands+=("${tool}")
done

if ((${#missing_commands[@]})); then
  note "Missing required commands: ${missing_commands[*]}"
  note "Git and OpenSSH client can be installed with Ubuntu/Debian packages: git openssh-client. The installer will not install them without your approval."
fi

required_apt_package_groups=(
  "ca-certificates" "fonts-liberation" "libasound2|libasound2t64"
  "libatk-bridge2.0-0|libatk-bridge2.0-0t64" "libatk1.0-0|libatk1.0-0t64"
  "libc6" "libcairo2" "libcups2|libcups2t64" "libdbus-1-3" "libexpat1"
  "libfontconfig1" "libgbm1" "libgcc-s1" "libglib2.0-0|libglib2.0-0t64"
  "libgtk-3-0|libgtk-3-0t64" "libnspr4" "libnss3" "libpango-1.0-0|libpango-1.0-0t64"
  "libpangocairo-1.0-0|libpangocairo-1.0-0t64" "libstdc++6" "libx11-6"
  "libx11-xcb1" "libxcb1" "libxcomposite1" "libxcursor1" "libxdamage1"
  "libxext6" "libxfixes3" "libxi6" "libxrandr2" "libxrender1" "libxss1" "libxtst6"
)
command -v apt-get >/dev/null 2>&1 || fail "apt-get is unavailable. Install Chromium/Puppeteer system libraries manually using the Puppeteer requirements for your Ubuntu/Debian release."
command -v dpkg-query >/dev/null 2>&1 || fail "dpkg-query is unavailable; cannot verify Puppeteer system libraries on this Debian/Ubuntu installation."

package_is_installed() {
  dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null | grep -qx installed
}

package_group_is_installed() {
  local group="$1"
  local candidate
  local IFS='|'
  for candidate in ${group}; do
    if package_is_installed "${candidate}"; then return 0; fi
  done
  return 1
}

missing_browser_package_groups=()
for package_group in "${required_apt_package_groups[@]}"; do
  package_group_is_installed "${package_group}" || {
    missing_browser_package_groups+=("${package_group//|/ (or )}")
  }
done
missing_required_commands=()
for tool in "${missing_commands[@]}"; do
  case "${tool}" in
    git) package_is_installed git || missing_required_commands+=(git) ;;
    ssh) package_is_installed openssh-client || missing_required_commands+=(openssh-client) ;;
  esac
done

if ((${#missing_browser_package_groups[@]} || ${#missing_required_commands[@]})); then
  note "Missing browser package groups: ${missing_browser_package_groups[*]:-none}"
  note "Missing required tool packages: ${missing_required_commands[*]:-none}"
  note "First consent is only to refresh apt metadata with sudo; no packages will be installed in this step."
  read -r -p "Refresh apt metadata now so the installer can resolve available package candidates? [y/N] " update_answer
  case "${update_answer}" in
    y|Y|yes|YES|Yes) ;;
    *) fail "Apt metadata was not refreshed. Install the required browser libraries/tools manually and rerun." ;;
  esac
  command -v sudo >/dev/null 2>&1 || fail "sudo is unavailable. Refresh apt metadata and install the required packages manually with an administrator."
  sudo apt-get update || fail "apt-get update failed. Check the network and configured Ubuntu/Debian repositories, then rerun."

  resolve_apt_candidate() {
    local package_name="$1"
    local policy_output
    local candidate_version
    policy_output="$(LC_ALL=C apt-cache policy "${package_name}" 2>/dev/null || true)"
    candidate_version="$(printf '%s\n' "${policy_output}" | awk '/^[[:space:]]*Candidate:/ { print $2; exit }')"
    if [[ -n "${candidate_version}" && "${candidate_version}" != "(none)" ]]; then
      printf '%s' "${package_name}"
      return 0
    fi
    return 1
  }

  resolved_apt_packages=()
  for package_group in "${required_apt_package_groups[@]}"; do
    if ! package_group_is_installed "${package_group}"; then
      found_package=""
      IFS='|' read -r -a package_candidates <<< "${package_group}"
      for candidate in "${package_candidates[@]}"; do
        if found_package="$(resolve_apt_candidate "${candidate}")"; then break; fi
      done
      [[ -n "${found_package}" ]] || fail "No installable apt candidate exists for '${package_group//|/, }'. Check the Ubuntu/Debian release and enabled repositories; package installation has not started."
      resolved_apt_packages+=("${found_package}")
    fi
  done
  for package in "${missing_required_commands[@]}"; do
    if ! package_is_installed "${package}"; then
      found_package="$(resolve_apt_candidate "${package}" || true)"
      [[ -n "${found_package}" ]] || fail "No installable apt candidate exists for '${package}'. Check enabled repositories; package installation has not started."
      resolved_apt_packages+=("${found_package}")
    fi
  done

  printf '\nResolved installable apt packages:\n'
  printf '  %s\n' "${resolved_apt_packages[@]}"
  read -r -p "Install exactly these packages with sudo apt-get install? [y/N] " install_answer
  case "${install_answer}" in
    y|Y|yes|YES|Yes)
      sudo apt-get install -y --no-install-recommends "${resolved_apt_packages[@]}" || fail "apt could not install one or more resolved packages: ${resolved_apt_packages[*]}. Check distro support and repository availability; no alternate package will be installed automatically."
      ;;
    *) fail "No packages were installed. Install the resolved package list manually and rerun." ;;
  esac
fi

for tool in git ssh; do
  command -v "${tool}" >/dev/null 2>&1 || fail "${tool} is still unavailable after package setup. Verify the package install, then rerun."
done
for package_group in "${required_apt_package_groups[@]}"; do
  package_group_is_installed "${package_group}" || fail "Required browser package '${package_group//|/, }' is still missing. Check package availability for this Ubuntu/Debian release and install the equivalent manually."
done

note "Runtime detected: Node ${node_version}, npm $(npm --version), $(. /etc/os-release && printf '%s' "${PRETTY_NAME:-$ID}"), x86_64. Node 24 LTS is recommended for new installs."
note "Installing locked Node.js dependencies in ${PROJECT_DIR} with npm ci. Existing .env, WhatsApp authentication/cache directories, and SSH keys are not removed or rewritten by this installer."
cd -- "${PROJECT_DIR}"
npm ci --no-audit --no-fund || fail "npm ci failed. Check network access, the package-lock.json dependency resolution, and npm output; rerun after resolving the issue."

browser_path="$(node -e 'process.stdout.write(require("puppeteer").executablePath())' 2>/dev/null || true)"
if [[ -z "${browser_path}" || ! -x "${browser_path}" ]]; then
  note "Puppeteer Chrome was not found at its expected executable path. If npm install scripts were disabled, run: npx puppeteer browsers install chrome"
  browser_ready=0
else
  ldd_output="$(ldd "${browser_path}" 2>&1 || true)"
  missing_shared_libraries="$(printf '%s\n' "${ldd_output}" | grep 'not found' || true)"
  if [[ -n "${missing_shared_libraries}" ]]; then
    printf 'Puppeteer Chrome is missing shared libraries:\n%s\n' "${missing_shared_libraries}" >&2
    note "Install the Ubuntu/Debian packages matching those libraries, then rerun the installer. Puppeteer package names can vary across releases."
    browser_ready=0
  else
    note "Puppeteer Chrome executable and shared-library checks passed."
    browser_ready=1
  fi
fi

suggested_host="$(suggest_deck_host)"
if [[ -n "${suggested_host}" ]]; then
  read -r -p "Steam Deck hostname or IPv4 address [${suggested_host}]: " deck_host
  deck_host="${deck_host:-${suggested_host}}"
else
  read -r -p "No known Steam Deck hostname resolved. Enter the Steam Deck hostname or IPv4 address manually: " deck_host
fi
valid_deck_host "${deck_host}" || fail "Invalid hostname/address '${deck_host}'. Use a DNS hostname or IPv4 address without spaces, ports, or SSH options."
save_deck_host_config "${deck_host}"
note "Saved the Deck address in this user's private config. Later launches reuse it; override once with DECK_HOST or --deck-host, or change it with --configure-deck-host."
remote="${DECK_USER}@${deck_host}"
note "Checking SSH connectivity to ${remote}. The SSH client may ask you to trust the Deck host key or enter the Deck account password."
ssh_connected=0
if ssh -o ConnectTimeout=8 "${remote}" true; then
  note "SSH connectivity check passed."
  ssh_connected=1
else
  note "SSH connectivity check failed. Verify that SSH is enabled on the Deck, the hostname/IP is correct, and your Deck account can authenticate. You can retry later with: ssh ${remote}"
fi

if ((ssh_connected)); then
  if [[ -e "${SSH_KEY}" || -e "${SSH_KEY}.pub" ]]; then
    note "An SSH key file already exists at ${SSH_KEY} or ${SSH_KEY}.pub. It will not be overwritten."
    if [[ -f "${SSH_KEY}.pub" ]] && command -v ssh-copy-id >/dev/null 2>&1; then
      read -r -p "Add this existing public key to the Steam Deck for passwordless SSH? [y/N] " key_answer
      case "${key_answer}" in
        y|Y|yes|YES|Yes)
          ssh-copy-id -i "${SSH_KEY}.pub" "${remote}" || note "Could not install the existing public key. No key files were replaced; you can retry with: ssh-copy-id -i '${SSH_KEY}.pub' '${remote}'"
          ;;
        *) note "Keeping the existing key unchanged; passwordless SSH setup skipped." ;;
      esac
    else
      note "Passwordless SSH setup skipped because no public key is available or ssh-copy-id is missing. Existing key files were left unchanged."
    fi
  elif command -v ssh-copy-id >/dev/null 2>&1; then
    read -r -p "Create a new DeckyWhatsapp SSH key and offer its public key to the Deck? [y/N] " key_answer
    case "${key_answer}" in
      y|Y|yes|YES|Yes)
        install -d -m 700 "${SSH_DIR}"
        key_temp_dir="$(mktemp -d "${SSH_DIR}/.decky-whatsapp-key.XXXXXX")"
        cleanup_key_temp() {
          case "${key_temp_dir}" in
            "${SSH_DIR}"/.decky-whatsapp-key.*) rm -r -- "${key_temp_dir}" ;;
            *) printf 'Refusing to remove unexpected temporary key directory: %s\n' "${key_temp_dir}" >&2 ;;
          esac
        }
        trap cleanup_key_temp EXIT
        ssh-keygen -t ed25519 -f "${key_temp_dir}/id_ed25519" -C "decky-whatsapp-${USER:-user}"
        if ! ln -- "${key_temp_dir}/id_ed25519" "${SSH_KEY}"; then
          fail "An SSH key appeared at ${SSH_KEY}; refusing to overwrite it. The generated temporary key will be removed."
        fi
        if ! ln -- "${key_temp_dir}/id_ed25519.pub" "${SSH_KEY}.pub"; then
          trap - EXIT
          fail "A public key appeared at ${SSH_KEY}.pub; refusing to overwrite it. The private key is at ${SSH_KEY} and its matching public key is preserved in ${key_temp_dir}/id_ed25519.pub. Inspect and reconcile these paths manually; no existing key file was replaced."
        fi
        chmod 600 "${SSH_KEY}"
        chmod 644 "${SSH_KEY}.pub"
        trap - EXIT
        cleanup_key_temp
        if ssh-copy-id -i "${SSH_KEY}.pub" "${remote}"; then
          if ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "${SSH_KEY}" -o ConnectTimeout=8 "${remote}" true; then
            note "Passwordless SSH verification passed."
          else
            note "The key was offered but passwordless verification failed. Check Deck authorized_keys permissions and retry with: ssh-copy-id -i '${SSH_KEY}.pub' '${remote}'"
          fi
        else
          note "Could not install the new public key. The generated key was preserved at ${SSH_KEY}; retry with: ssh-copy-id -i '${SSH_KEY}.pub' '${remote}'"
        fi
        ;;
      *) note "Passwordless SSH setup skipped; no key was created." ;;
    esac
  else
    note "ssh-copy-id is unavailable, so passwordless SSH setup was skipped without creating a key. Install openssh-client or add a public key manually."
  fi
fi

# A convenience command is optional and never replaces a user-created file.
readonly LINUX_LAUNCHER="${PROJECT_DIR}/start-decky-whatsapp-linux.sh"
if [[ -f "${LINUX_LAUNCHER}" && ! -L "${LINUX_LAUNCHER}" ]]; then
  if [[ ! -x "${LINUX_LAUNCHER}" ]]; then
    if chmod u+x "${LINUX_LAUNCHER}"; then
      note "Marked the project-owned Linux launcher executable."
    else
      note "Could not mark the project-owned launcher executable; run it with bash directly: bash '${LINUX_LAUNCHER}'"
    fi
  fi
fi
if [[ -f "${LINUX_LAUNCHER}" && -x "${LINUX_LAUNCHER}" && ! -L "${LINUX_LAUNCHER}" ]]; then
  shortcut_dir="${HOME}/.local/bin"
  shortcut="${shortcut_dir}/decky-whatsapp"
  if [[ -e "${shortcut}" || -L "${shortcut}" ]]; then
    note "User command already exists; leaving it unchanged: ${shortcut}"
  else
    if mkdir -p -- "${shortcut_dir}"; then
      if ln -s -- "${LINUX_LAUNCHER}" "${shortcut}"; then
        note "Created user-level command shortcut: ${shortcut}"
        case ":${PATH}:" in
          *":${shortcut_dir}:"*) note "Run it with: decky-whatsapp" ;;
          *) note "${shortcut_dir} is not in PATH. Add it to PATH or run the launcher directly: ${LINUX_LAUNCHER}" ;;
        esac
      else
        note "Could not create the shortcut without replacing an existing path. Run the launcher directly: ${LINUX_LAUNCHER}"
      fi
    else
      note "Could not create ${shortcut_dir}. Run the launcher directly: ${LINUX_LAUNCHER}"
    fi
  fi
else
  note "Project-owned Linux launcher not present or not executable; shortcut creation skipped. Task 5.3 will add it."
fi

note "Dependency installation and available checks are complete. No service, login autostart, or scheduled task was installed."
if ((!browser_ready)); then
  note "Before running the bridge, resolve the Puppeteer browser/library issue reported above."
fi
if ((!ssh_connected)); then
  note "Before using the Deck, resolve SSH connectivity to ${remote}."
fi
note "WhatsApp authentication data was not inspected or removed. Start the bridge only by explicitly running the future Task 5.3 launcher."
