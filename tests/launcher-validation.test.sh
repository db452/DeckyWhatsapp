#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "${root}/scripts/launcher-validation.sh"

[[ "$(normalize_port 08787)" == 8787 ]]
[[ "$(normalize_port 00001)" == 1 ]]
[[ "$(normalize_port 65535)" == 65535 ]]
for port in 0 65536 999999 abc 12x 000000; do
  if normalize_port "${port}" >/dev/null 2>&1; then
    printf 'FAIL: accepted invalid port %s\n' "${port}" >&2
    exit 1
  fi
done

for host in steamdeck.lan deck-1.example.test 192.168.1.196; do
  valid_deck_host "${host}" || { printf 'FAIL: rejected supported host %s\n' "${host}" >&2; exit 1; }
done
for host in 'deck:22' '-oProxyCommand=bad' '::1' 'a..b' '.deck' 'deck.' 'bad name'; do
  if valid_deck_host "${host}"; then
    printf 'FAIL: accepted invalid host %s\n' "${host}" >&2
    exit 1
  fi
done

printf 'Launcher validation regression checks passed.\n'
