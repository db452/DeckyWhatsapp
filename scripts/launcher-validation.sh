# Shared Linux launcher input validation.
normalize_port() {
  local port="$1"
  [[ "${port}" =~ ^[0-9]{1,5}$ ]] || return 1
  while [[ "${#port}" -gt 1 && "${port}" == 0* ]]; do port="${port#0}"; done
  (( 10#${port} >= 1 && 10#${port} <= 65535 )) || return 1
  printf '%s' "$((10#${port}))"
}

valid_deck_host() {
  local host="$1" label
  # Both Linux and Windows launchers support DNS names and IPv4 addresses.
  # IPv6 literals, host:port strings, spaces, and leading-dash SSH options
  # are intentionally rejected so the address remains one safe SSH operand.
  [[ "${#host}" -le 253 && "${host}" =~ ^[A-Za-z0-9.-]+$ ]] || return 1
  [[ "${host}" != .* && "${host}" != *. && "${host}" != *..* ]] || return 1
  local IFS=.
  read -r -a labels <<< "${host}"
  for label in "${labels[@]}"; do
    [[ "${#label}" -le 63 && "${label}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}
