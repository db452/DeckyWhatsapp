#!/usr/bin/env bash
# Convenience wrapper for producing the Linux companion ZIP from its allowlist.
set -Eeuo pipefail
IFS=$'\n\t'

readonly REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if command -v python3 >/dev/null 2>&1; then
  PYTHON_COMMAND="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON_COMMAND="$(command -v python)"
else
  printf 'Python 3 is required to package the Linux companion.\n' >&2
  exit 1
fi

exec "${PYTHON_COMMAND}" "${REPO_ROOT}/scripts/package-companions.py" \
  --platform linux \
  --output-dir "${1:-${REPO_ROOT}/releases}"
