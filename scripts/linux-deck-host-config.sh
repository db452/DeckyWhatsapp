# Shared per-user Steam Deck address storage for the Linux installer and launcher.
_deck_host_config_location() {
  local config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
  [[ "${config_home}" == /* ]] || return 1
  DECK_HOST_CONFIG_DIR="${config_home}/decky-whatsapp"
  DECK_HOST_CONFIG_FILE="${DECK_HOST_CONFIG_DIR}/deck-host"
}

read_saved_deck_host() {
  local owner
  local permissions
  SAVED_DECK_HOST=""
  _deck_host_config_location || return 1
  [[ -e "${DECK_HOST_CONFIG_DIR}" || -L "${DECK_HOST_CONFIG_DIR}" ]] || return 0
  [[ -d "${DECK_HOST_CONFIG_DIR}" && ! -L "${DECK_HOST_CONFIG_DIR}" ]] || return 1
  owner="$(stat -c '%u' -- "${DECK_HOST_CONFIG_DIR}")" || return 1
  [[ "${owner}" == "${EUID}" ]] || return 1
  permissions="$(stat -c '%a' -- "${DECK_HOST_CONFIG_DIR}")" || return 1
  [[ "${permissions}" =~ ^[0-7]+$ ]] || return 1
  (( (8#${permissions} & 077) == 0 )) || return 1
  [[ -e "${DECK_HOST_CONFIG_FILE}" || -L "${DECK_HOST_CONFIG_FILE}" ]] || return 0
  [[ -f "${DECK_HOST_CONFIG_FILE}" && ! -L "${DECK_HOST_CONFIG_FILE}" ]] || return 1
  owner="$(stat -c '%u' -- "${DECK_HOST_CONFIG_FILE}")" || return 1
  permissions="$(stat -c '%a' -- "${DECK_HOST_CONFIG_FILE}")" || return 1
  [[ "${owner}" == "${EUID}" && "${permissions}" =~ ^[0-7]+$ ]] || return 1
  (( (8#${permissions} & 077) == 0 )) || return 1
  IFS= read -r SAVED_DECK_HOST < "${DECK_HOST_CONFIG_FILE}" || [[ -n "${SAVED_DECK_HOST}" ]] || return 1
  valid_deck_host "${SAVED_DECK_HOST}" || { SAVED_DECK_HOST=""; return 1; }
}

save_deck_host_config() {
  local host="$1"
  local temporary_file
  _deck_host_config_location || fail "XDG_CONFIG_HOME must be an absolute path to save the Deck address safely."
  if [[ -e "${DECK_HOST_CONFIG_DIR}" || -L "${DECK_HOST_CONFIG_DIR}" ]]; then
    [[ -d "${DECK_HOST_CONFIG_DIR}" && ! -L "${DECK_HOST_CONFIG_DIR}" ]] || fail "DeckyWhatsapp config path is not a real directory: ${DECK_HOST_CONFIG_DIR}"
    [[ "$(stat -c '%u' -- "${DECK_HOST_CONFIG_DIR}")" == "${EUID}" ]] || fail "DeckyWhatsapp config directory is not owned by this user: ${DECK_HOST_CONFIG_DIR}"
  else
    mkdir -p -- "${DECK_HOST_CONFIG_DIR}" || fail "Could not create user config directory: ${DECK_HOST_CONFIG_DIR}"
  fi
  chmod 700 -- "${DECK_HOST_CONFIG_DIR}" || fail "Could not restrict permissions on ${DECK_HOST_CONFIG_DIR}"
  [[ ! -d "${DECK_HOST_CONFIG_FILE}" ]] || fail "Deck address config path is a directory: ${DECK_HOST_CONFIG_FILE}"
  temporary_file="$(mktemp "${DECK_HOST_CONFIG_DIR}/.deck-host.XXXXXX")" || fail "Could not create a temporary Deck address config."
  chmod 600 -- "${temporary_file}" || { rm -f -- "${temporary_file}"; fail "Could not restrict permissions on temporary Deck config."; }
  if ! printf '%s\n' "${host}" > "${temporary_file}" || ! mv -f -- "${temporary_file}" "${DECK_HOST_CONFIG_FILE}"; then
    rm -f -- "${temporary_file}"
    fail "Could not save the Deck address to ${DECK_HOST_CONFIG_FILE}."
  fi
}
