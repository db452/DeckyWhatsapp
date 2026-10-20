#!/usr/bin/env bash
# Owns one foreground bridge and retries only its own reverse SSH tunnel.
set -Eeuo pipefail
IFS=$'\n\t'

PROJECT_ROOT=""
BRIDGE_PORT=""
DECK_HOST=""
while (($#)); do
  case "$1" in
    --project-root) PROJECT_ROOT="${2:-}"; shift 2 ;;
    --bridge-port) BRIDGE_PORT="${2:-}"; shift 2 ;;
    --deck-host) DECK_HOST="${2:-}"; shift 2 ;;
    *) printf 'Unknown tunnel supervisor argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

[[ -t 0 && -t 1 ]] || fail "Run this supervisor from an interactive terminal."
[[ -n "${PROJECT_ROOT}" && -d "${PROJECT_ROOT}" ]] || fail "Project root was not supplied or does not exist."
PROJECT_ROOT="$(cd -P -- "${PROJECT_ROOT}" && pwd)"
source "${PROJECT_ROOT}/scripts/launcher-validation.sh"
[[ -f "${PROJECT_ROOT}/package.json" && -f "${PROJECT_ROOT}/package-lock.json" ]] || fail "Could not find the project manifests under ${PROJECT_ROOT}."
BRIDGE_PORT="$(normalize_port "${BRIDGE_PORT}")" || fail "Bridge port must be a decimal integer from 1 to 65535."
valid_deck_host "${DECK_HOST}" || fail "Invalid Steam Deck hostname/address. Use a DNS hostname or IPv4 address without spaces, ports, or SSH options."
command -v node >/dev/null 2>&1 || fail "Node.js is unavailable."
command -v ssh >/dev/null 2>&1 || fail "OpenSSH client is unavailable."
[[ -r "${PROJECT_ROOT}/scripts/linux-bridge-helper.mjs" ]] || fail "Linux bridge helper is missing from ${PROJECT_ROOT}/scripts; re-extract the complete companion package."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "Node.js 22 or newer is required; found $(node --version)."
command -v timeout >/dev/null 2>&1 || fail "The coreutils timeout command is unavailable; it is required to bound the read-only SSH owner probe."
[[ -x "${PROJECT_ROOT}/node_modules/.bin/tsx" ]] || fail "Project dependencies are missing; run install-decky-whatsapp-linux.sh first."

REMOTE="deck@${DECK_HOST}"
SSH_KEY="${HOME}/.ssh/decky_whatsapp_ed25519"
SSH_AUTH_ARGS=()
if [[ -f "${SSH_KEY}" ]]; then
  SSH_AUTH_ARGS=(-i "${SSH_KEY}" -o IdentitiesOnly=yes)
fi
BRIDGE_PID=""
SSH_PID=""
SSH_START_TIME=""
PROBE_SSH_PID=""
PROBE_SSH_START_TIME=""
BRIDGE_SESSION_ID=""
BRIDGE_START_TIME=""
SSH_LOG_DIR=""
SSH_LOG_FILE=""
SSH_LOG_FIFO=""
SSH_LOGGER_PID=""
SSH_LOGGER_START_TIME=""
SSH_FIFO_KEEPALIVE_FD=""
SSH_CAPTURE_UNVERIFIED=0
STOPPING=0
REMOTE_OWNER="unknown"
AUTH_ATTEMPTED=0
STALE_RECOVERY_ACTIVE=0
STALE_RECOVERY_DEADLINE=0

parse_proc_stat_identity() {
  local stat_line="$1"
  local expected_pid="$2"
  local expected_parent_pid="$3"
  local expected_start_time="${4:-}"
  local record_pid
  local -a stat_fields=()
  record_pid="${stat_line%% *}"
  [[ "${record_pid}" == "${expected_pid}" && "${record_pid}" =~ ^[0-9]+$ ]] || return 1
  [[ "${stat_line#* (}" != "${stat_line}" ]] || return 1
  stat_line="${stat_line##*) }"
  IFS=' ' read -r -a stat_fields <<< "${stat_line}"
  ((${#stat_fields[@]} > 19)) || return 1
  [[ "${stat_fields[1]}" == "${expected_parent_pid}" ]] || return 1
  [[ "${stat_fields[19]}" =~ ^[0-9]+$ ]] || return 1
  [[ -z "${expected_start_time}" || "${stat_fields[19]}" == "${expected_start_time}" ]] || return 1
  [[ "${stat_fields[0]}" != Z* ]] || return 1
  printf '%s' "${stat_fields[19]}"
}

child_start_time() {
  local child_pid="$1"
  local stat_line
  [[ -r "/proc/${child_pid}/stat" ]] || return 1
  IFS= read -r stat_line < "/proc/${child_pid}/stat" || return 1
  parse_proc_stat_identity "${stat_line}" "${child_pid}" "$$"
}

child_is_running() {
  local child_pid="$1"
  local expected_start_time="$2"
  local stat_line
  [[ -n "${child_pid}" && -n "${expected_start_time}" ]] || return 1
  kill -0 "${child_pid}" 2>/dev/null || return 1
  [[ -r "/proc/${child_pid}/stat" ]] || return 1
  IFS= read -r stat_line < "/proc/${child_pid}/stat" || return 1
  parse_proc_stat_identity "${stat_line}" "${child_pid}" "$$" "${expected_start_time}" >/dev/null
}

stop_owned_child() {
  local child_pid="$1"
  local expected_start_time="$2"
  local child_label="$3"
  local attempt
  [[ -n "${child_pid}" ]] || return 0
  if [[ -z "${expected_start_time}" ]]; then
    printf "Cannot verify the launcher's %s PID %s; leaving it untouched and not waiting for it.\n" "${child_label}" "${child_pid}" >&2
    disown "${child_pid}" 2>/dev/null || true
    return 0
  fi
  if child_is_running "${child_pid}" "${expected_start_time}"; then
    printf "Stopping this launcher's %s process (PID %s).\n" "${child_label}" "${child_pid}"
    kill -TERM "${child_pid}" 2>/dev/null || true
    for attempt in {1..50}; do
      child_is_running "${child_pid}" "${expected_start_time}" || break
      sleep 0.1
    done
    if child_is_running "${child_pid}" "${expected_start_time}"; then
      printf "The launcher's %s process did not exit after SIGTERM; stopping only its owned PID %s.\n" "${child_label}" "${child_pid}" >&2
      kill -KILL "${child_pid}" 2>/dev/null || true
    fi
  fi
  disown "${child_pid}" 2>/dev/null || true
}

close_ssh_log_keepalive() {
  if [[ -n "${SSH_FIFO_KEEPALIVE_FD}" ]]; then
    exec {SSH_FIFO_KEEPALIVE_FD}>&-
    SSH_FIFO_KEEPALIVE_FD=""
  fi
}

start_ssh_log_reader() {
  SSH_LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/decky-whatsapp-ssh.XXXXXX")" || return 1
  SSH_LOG_FILE="${SSH_LOG_DIR}/ssh-output"
  SSH_LOG_FIFO="${SSH_LOG_DIR}/ssh-stderr.fifo"
  mkfifo -- "${SSH_LOG_FIFO}" || return 1
  exec {SSH_FIFO_KEEPALIVE_FD}<>"${SSH_LOG_FIFO}" || return 1
  node "${PROJECT_ROOT}/scripts/linux-bridge-helper.mjs" ssh-log-reader "${SSH_LOG_FILE}" {SSH_FIFO_KEEPALIVE_FD}>&- < "${SSH_LOG_FIFO}" &
  SSH_LOGGER_PID=$!
  SSH_LOGGER_START_TIME="$(child_start_time "${SSH_LOGGER_PID}")" || {
    close_ssh_log_keepalive
    disown "${SSH_LOGGER_PID}" 2>/dev/null || true
    SSH_LOGGER_PID=""
    return 1
  }
}

finish_ssh_log_reader() {
  local attempt
  close_ssh_log_keepalive
  [[ -n "${SSH_LOGGER_PID}" ]] || return 0
  for attempt in {1..30}; do
    child_is_running "${SSH_LOGGER_PID}" "${SSH_LOGGER_START_TIME}" || break
    sleep 0.1
  done
  if child_is_running "${SSH_LOGGER_PID}" "${SSH_LOGGER_START_TIME}"; then
    stop_owned_child "${SSH_LOGGER_PID}" "${SSH_LOGGER_START_TIME}" "SSH output reader" || true
  else
    disown "${SSH_LOGGER_PID}" 2>/dev/null || true
  fi
  SSH_LOGGER_PID=""
  SSH_LOGGER_START_TIME=""
}

remove_ssh_log_files() {
  close_ssh_log_keepalive
  if [[ -n "${SSH_LOG_FIFO}" ]]; then rm -f -- "${SSH_LOG_FIFO}" || true; fi
  if [[ -n "${SSH_LOG_FILE}" ]]; then rm -f -- "${SSH_LOG_FILE}" "${SSH_LOG_FILE}.cleanup" || true; fi
  if [[ -n "${SSH_LOG_DIR}" ]]; then rmdir -- "${SSH_LOG_DIR}" 2>/dev/null || true; fi
  SSH_LOG_FIFO=""
  SSH_LOG_FILE=""
  SSH_LOG_DIR=""
}

shutdown_bridge_by_identity() {
  [[ -n "${BRIDGE_SESSION_ID}" ]] && child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}" || return 1
  node "${PROJECT_ROOT}/scripts/linux-bridge-helper.mjs" bridge-shutdown \
    "${BRIDGE_PORT}" "${BRIDGE_PID}" "${BRIDGE_SESSION_ID}"
}

cleanup() {
  local shutdown_requested=0
  (( STOPPING )) && return
  STOPPING=1
  stop_owned_child "${PROBE_SSH_PID}" "${PROBE_SSH_START_TIME}" "diagnostic SSH probe" || true
  PROBE_SSH_PID=""
  PROBE_SSH_START_TIME=""
  stop_owned_child "${SSH_PID}" "${SSH_START_TIME}" "reverse SSH tunnel" || true
  SSH_PID=""
  SSH_START_TIME=""
  if ((SSH_CAPTURE_UNVERIFIED)); then
    printf 'SSH PID identity could not be verified; leaving its bounded output reader and private temporary capture in place rather than interrupting an unverifiable SSH process.\n' >&2
    if [[ -n "${SSH_LOG_FILE}" ]]; then : > "${SSH_LOG_FILE}.cleanup" || true; fi
    if ! child_is_running "${SSH_LOGGER_PID}" "${SSH_LOGGER_START_TIME}"; then remove_ssh_log_files; fi
  else
    finish_ssh_log_reader || true
    stop_owned_child "${SSH_LOGGER_PID}" "${SSH_LOGGER_START_TIME}" "SSH output reader" || true
    SSH_LOGGER_PID=""
    SSH_LOGGER_START_TIME=""
    remove_ssh_log_files
  fi
  if [[ -n "${BRIDGE_PID}" ]] && child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}"; then
    if [[ -n "${BRIDGE_SESSION_ID}" ]] && shutdown_bridge_by_identity; then
      shutdown_requested=1
    fi
    if ((shutdown_requested)); then
      for attempt in {1..100}; do
        child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}" || break
        sleep 0.1
      done
    fi
    if child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}"; then
      printf 'Authenticated shutdown did not stop the owned bridge; sending SIGTERM only to its directly launched process (PID %s).\n' "${BRIDGE_PID}"
      kill -TERM "${BRIDGE_PID}" 2>/dev/null || true
    fi
  fi
  stop_owned_child "${BRIDGE_PID}" "${BRIDGE_START_TIME}" "WhatsApp bridge" || true
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if node "${PROJECT_ROOT}/scripts/linux-bridge-helper.mjs" port-open "${BRIDGE_PORT}"
then
  fail "Local loopback port ${BRIDGE_PORT} is already occupied. Its owner was left running; stop or inspect that session before retrying."
fi

cd -- "${PROJECT_ROOT}"
printf 'Starting the bridge in this terminal. The SSH tunnel starts after the bridge passes its local health check.\n'
printf 'Starting the WhatsApp bridge on 127.0.0.1:%s...\n' "${BRIDGE_PORT}"
HOST=127.0.0.1 PORT="${BRIDGE_PORT}" node --import tsx src/server.ts &
BRIDGE_PID=$!
BRIDGE_START_TIME="$(child_start_time "${BRIDGE_PID}")" || fail "Could not verify the launched bridge's Linux process identity; refusing to monitor or signal an unverifiable PID."

for attempt in {1..30}; do
  child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}" || fail "The bridge process exited or changed identity before it became ready. Check the bridge output above."
  if BRIDGE_SESSION_ID="$(node "${PROJECT_ROOT}/scripts/linux-bridge-helper.mjs" bridge-session \
    "${BRIDGE_PORT}" "${BRIDGE_PID}" 2>/dev/null)" && [[ "${BRIDGE_SESSION_ID}" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    break
  fi
  BRIDGE_SESSION_ID=""
  sleep 1
done
[[ -n "${BRIDGE_SESSION_ID}" ]] || fail "Could not authenticate the local health check to the bridge process this launcher started. No other listener was stopped."

printf 'Bridge is ready. Starting reverse SSH tunnel to %s on remote port %s.\n' "${REMOTE}" "${BRIDGE_PORT}"
printf 'The main SSH connection may prompt for a password. Read-only owner probes always use BatchMode and will not prompt again.\n'

diagnose_remote_owner() {
  local probe_port
  local fingerprint
  REMOTE_OWNER="unknown"
  probe_port="$(node "${PROJECT_ROOT}/scripts/linux-bridge-helper.mjs" reserve-port)" || return 0
  [[ "${probe_port}" =~ ^[0-9]+$ ]] || return 0

  timeout --signal=TERM --kill-after=1s 5s ssh -N -T \
    "${SSH_AUTH_ARGS[@]}" \
    -o BatchMode=yes \
    -o ConnectTimeout=4 \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=5 \
    -o ServerAliveCountMax=1 \
    -L "127.0.0.1:${probe_port}:127.0.0.1:${BRIDGE_PORT}" \
    "${REMOTE}" </dev/null >/dev/null 2>&1 &
  PROBE_SSH_PID=$!
  PROBE_SSH_START_TIME="$(child_start_time "${PROBE_SSH_PID}")" || {
    printf 'Could not verify the bounded diagnostic SSH process identity; leaving it untouched and treating remote ownership as ambiguous.\n' >&2
    disown "${PROBE_SSH_PID}" 2>/dev/null || true
    PROBE_SSH_PID=""
    return 0
  }
  sleep 0.4
  if child_is_running "${PROBE_SSH_PID}" "${PROBE_SSH_START_TIME}"; then
    if fingerprint="$(node "${PROJECT_ROOT}/scripts/linux-bridge-helper.mjs" fingerprint "${probe_port}" 2>/dev/null)"; then :; else fingerprint="unknown"; fi
    case "${fingerprint}" in
      decky-whatsapp|other-http-service) REMOTE_OWNER="${fingerprint}" ;;
      *) REMOTE_OWNER="unknown" ;;
    esac
  fi
  stop_owned_child "${PROBE_SSH_PID}" "${PROBE_SSH_START_TIME}" "diagnostic SSH probe" >/dev/null 2>&1 || true
  PROBE_SSH_PID=""
  PROBE_SSH_START_TIME=""
}

while true; do
  child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}" || fail "The bridge process stopped or changed identity; the tunnel will not be restarted."
  SSH_RECONNECT_ARGS=()
  if ((AUTH_ATTEMPTED)); then SSH_RECONNECT_ARGS+=(-o BatchMode=yes); fi
  if ((STALE_RECOVERY_ACTIVE)); then
    if ((SECONDS >= STALE_RECOVERY_DEADLINE)); then
      fail "The Deck port remained occupied through the bounded stale-tunnel recovery window. Confirm SSH authentication and the optional Deck sshd keepalive setting, inspect the remote port owner, then restart the launcher manually. No remote process was stopped."
    fi
    SSH_RECONNECT_ARGS+=(-v -o BatchMode=yes -o ConnectTimeout=5)
  fi
  start_ssh_log_reader || fail "Could not start the bounded private SSH output reader."
  ssh -N -T \
    "${SSH_AUTH_ARGS[@]}" \
    "${SSH_RECONNECT_ARGS[@]}" \
    -o ConnectTimeout=10 \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 \
    -o TCPKeepAlive=yes \
    -o ExitOnForwardFailure=yes \
    -R "${BRIDGE_PORT}:127.0.0.1:${BRIDGE_PORT}" \
    "${REMOTE}" </dev/tty 2>"${SSH_LOG_FIFO}" {SSH_FIFO_KEEPALIVE_FD}>&- &
  SSH_PID=$!
  AUTH_ATTEMPTED=1
  SSH_START_TIME="$(child_start_time "${SSH_PID}")" || {
    printf 'Could not verify the launched SSH tunnel process identity; refusing to signal or wait for its PID.\n' >&2
    disown "${SSH_PID}" 2>/dev/null || true
    SSH_CAPTURE_UNVERIFIED=1
    SSH_PID=""
    fail "Could not verify the launched SSH tunnel's Linux process identity; refusing to monitor or signal an unverifiable PID."
  }
  printf 'SSH tunnel process launched (PID %s); OpenSSH is connecting and requesting the remote forward. Establishment is not confirmed until authentication succeeds and the forward is accepted.\n' "${SSH_PID}"

  while child_is_running "${SSH_PID}" "${SSH_START_TIME}"; do
    if ! child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}"; then
      printf "The owned bridge process stopped; closing only this launcher's SSH tunnel.\n" >&2
      stop_owned_child "${SSH_PID}" "${SSH_START_TIME}" "reverse SSH tunnel" || true
      SSH_PID=""
      SSH_START_TIME=""
      printf "Bridge stopped; closing this launcher and its owned processes cleanly.\n"
      exit 0
    fi
    sleep 0.3
  done
  if wait "${SSH_PID}"; then SSH_EXIT=0; else SSH_EXIT=$?; fi
  SSH_PID=""
  SSH_START_TIME=""
  finish_ssh_log_reader || true

  if ((AUTH_ATTEMPTED)) && grep -Eiq '(permission denied|authentication failed|no more authentication methods|too many authentication failures|passphrase)' "${SSH_LOG_FILE}"; then
    remove_ssh_log_files
    fail "SSH authentication failed during an automatic reconnect. BatchMode will not prompt for a password or unavailable key passphrase; confirm SSH authentication, then restart the launcher manually."
  fi
  if grep -Eiq '(administratively prohibited|remote forwarding.*disabled)' "${SSH_LOG_FILE}"; then
    remove_ssh_log_files
    fail "The SSH server refused remote forwarding by policy. Ask the Deck administrator to allow remote forwarding; no automatic retry was made."
  fi

  if grep -Eiq 'remote port forwarding failed' "${SSH_LOG_FILE}"; then
    remove_ssh_log_files
    child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}" || fail "The bridge process stopped or changed identity; the tunnel will not be restarted."
    diagnose_remote_owner
    case "${REMOTE_OWNER}" in
      decky-whatsapp)
        fail "A DeckyWhatsapp bridge responds on the Deck port. First-connected session policy preserved; the existing remote session was not changed."
        ;;
      other-http-service)
        fail "An HTTP service responds on the Deck port but is not identified as DeckyWhatsapp. Its owner was left untouched."
        ;;
      *)
        if ((!STALE_RECOVERY_ACTIVE)); then
          STALE_RECOVERY_ACTIVE=1
          STALE_RECOVERY_DEADLINE=$((SECONDS + 90))
          printf 'Remote port owner is ambiguous. Waiting up to 90 seconds and retrying SSH every 5 seconds in BatchMode; no remote process will be stopped.\n'
        else
          printf 'Remote port remains ambiguous; retrying while the bounded 90-second recovery window remains.\n'
        fi
        sleep 5
        continue
        ;;
    esac
  fi
  child_is_running "${BRIDGE_PID}" "${BRIDGE_START_TIME}" || fail "The bridge process stopped or changed identity; the tunnel will not be restarted."
  if ((STALE_RECOVERY_ACTIVE)); then
    if grep -Eiq "remote forward success for:.*listen[[:space:]]+([^[:space:],]+:)?${BRIDGE_PORT}([[:space:],]|$)" "${SSH_LOG_FILE}"; then
      STALE_RECOVERY_ACTIVE=0
      printf 'OpenSSH confirmed the remote forward. Normal tunnel supervision is active.\n'
    elif ((SECONDS >= STALE_RECOVERY_DEADLINE)); then
      remove_ssh_log_files
      fail "SSH did not confirm the remote forward before the bounded recovery window ended. Review SSH diagnostics, confirm authentication and the optional Deck sshd keepalive setting, then restart manually."
    else
      printf 'Recovery SSH exited before OpenSSH confirmed the remote forward; retrying within the bounded window.\n'
      sleep 5
      continue
    fi
  fi
  remove_ssh_log_files
  printf 'SSH tunnel exited with status %s. Checking the remote port without authentication or destructive actions...\n' "${SSH_EXIT}"
  diagnose_remote_owner
  case "${REMOTE_OWNER}" in
    decky-whatsapp)
      fail "A DeckyWhatsapp bridge responds on the Deck port. First-connected session policy preserved; the existing remote session was not changed."
      ;;
    other-http-service)
      fail "An HTTP service responds on the Deck port but is not identified as DeckyWhatsapp. Its owner was left untouched."
      ;;
    *)
      printf 'Remote owner is ambiguous. No remote process was touched; a password-only or unavailable diagnostic SSH login will not prompt a second time. Retrying in 5 seconds.\n'
      sleep 5
      ;;
  esac
done
