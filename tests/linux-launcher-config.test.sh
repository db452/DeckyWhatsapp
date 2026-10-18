#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_host() {
  local expected="$1"
  local actual
  actual="$(<"${host_file}")"
  [[ "${actual}" == "${expected}" ]] || fail "expected saved host '${expected}', got '${actual}'"
}

quote_for_shell() {
  printf '%q' "$1"
}

readonly test_root="$(mktemp -d "${TMPDIR:-/tmp}/decky-whatsapp-config-test.XXXXXX")"
readonly config_home="${test_root}/config"
readonly config_dir="${config_home}/decky-whatsapp"
readonly host_file="${config_dir}/deck-host"
readonly launcher="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)/start-decky-whatsapp-linux.sh"
readonly installer="${launcher%/*}/install-decky-whatsapp-linux.sh"
trap 'rm -rf -- "${test_root}"' EXIT

if ! grep -Fq 'valid_deck_host "${deck_host}"' "${installer}"; then
  fail "Linux installer does not use the shared Deck host validator"
fi

output="$(XDG_CONFIG_HOME="${config_home}" bash "${launcher}" --configure-deck-host deck.example.test)"
[[ "${output}" == *"No bridge or SSH tunnel was started"* ]] || fail "configure mode did not report its config-only exit"
[[ "${output}" != *"Using loopback bridge port"* ]] || fail "configure mode continued into bridge startup"
assert_host "deck.example.test"

# The installer places a shortcut outside the project; resolve it before
# loading project helpers, and keep the shortcut path with spaces intact.
shortcut_dir="${test_root}/user local/bin"
mkdir -p -- "${shortcut_dir}"
shortcut="${shortcut_dir}/start-decky-whatsapp-linux.sh"
ln -s -- "${launcher}" "${shortcut}"
if [[ -L "${shortcut}" ]]; then
  output="$(bash "${shortcut}" --help)"
  [[ "${output}" == *"Usage:"* ]] || fail "installer-style symlink could not load the launcher helper for --help"
  output="$(XDG_CONFIG_HOME="${config_home}" bash "${shortcut}" --configure-deck-host shortcut.example.test)"
  [[ "${output}" == *"No bridge or SSH tunnel was started"* ]] || fail "installer-style symlink config did not exit after saving"
  assert_host "shortcut.example.test"
else
  printf 'SKIP: this Windows Git Bash filesystem emulates ln -s as a copy; installer-style symlink checks run on Linux.\n'
fi

printf 'preserve me\n' > "${config_dir}/unrelated-setting"
printf 'malformed host with spaces\n' > "${host_file}"
output="$(XDG_CONFIG_HOME="${config_home}" bash "${launcher}" --configure-deck-host 192.0.2.55)"
[[ "${output}" == *"No valid saved Deck address was found"* ]] || fail "malformed saved host was not reported for replacement"
assert_host "192.0.2.55"
[[ "$(<"${config_dir}/unrelated-setting")" == 'preserve me' ]] || fail "reconfiguration changed an unrelated config file"

if command -v script >/dev/null 2>&1; then
  config_home_q="$(quote_for_shell "${config_home}")"
  launcher_q="$(quote_for_shell "${launcher}")"
  command="XDG_CONFIG_HOME=${config_home_q} bash ${launcher_q} --configure-deck-host"
  output="$(printf '\n' | script -q -e -c "${command}" /dev/null)"
  [[ "${output}" == *"Steam Deck hostname or IP [192.0.2.55]"* ]] || fail "configure prompt did not use the valid saved host as its default"
  assert_host "192.0.2.55"
else
  printf 'SKIP: saved-host prompt-default check requires util-linux script(1).\n'
fi

printf 'Linux launcher config regression checks passed.\n'
