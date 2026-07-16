#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Keep the Tauri/Vite/Cargo processes away from the shell's input stream and
# make their output a pipe rather than a terminal. This prevents terminal
# capability probes from leaving OSC/CSI replies in fish's pending input after
# the application window closes.
run_tauri_dev() {
    cd "$ROOT"
    pnpm --dir frontends/linux tauri:dev </dev/null 2>&1 | cat
}

# Some terminals can deliver capability replies a few milliseconds after the
# child process exits. Discard only already-pending input before returning to
# fish; do not change the kitty keyboard-protocol stack or saved stty flags.
flush_pending_terminal_replies() {
    [[ -r /dev/tty && -w /dev/tty ]] || return 0

    sleep 0.12
    if command -v python3 >/dev/null 2>&1; then
        python3 - <<'PY' >/dev/null 2>&1 || true
import os
import termios

fd = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
try:
    termios.tcflush(fd, termios.TCIFLUSH)
finally:
    os.close(fd)
PY
    fi
}

status=0
run_tauri_dev || status=$?
flush_pending_terminal_replies
exit "$status"
