#!/usr/bin/env bash
# dfx panics with TERM=dumb (Cursor agent shell). Force a sane TTY.
set -euo pipefail
export TERM="${TERM:-xterm-256color}"
exec script -q /dev/null bash -c 'exec dfx "$@"' _ "$@"
