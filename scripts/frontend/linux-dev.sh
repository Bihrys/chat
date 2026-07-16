#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

restore_terminal() {
    if [[ -r /dev/tty && -w /dev/tty ]]; then
        # Pop one kitty keyboard-protocol mode and restore ordinary line input.
        # This keeps Ctrl-C usable when cargo-tauri exits abnormally under fish.
        printf '\033[<u' > /dev/tty 2>/dev/null || true
        stty sane < /dev/tty > /dev/tty 2>/dev/null || true
    fi
}

# cargo-tauri and modern terminals can both negotiate enhanced keyboard input.
# Start from legacy keyboard reporting for this non-interactive launcher.
restore_terminal
trap restore_terminal EXIT HUP INT TERM

cd "$ROOT"
set +e
pnpm --dir frontends/linux tauri:dev
status=$?
set -e
restore_terminal
exit "$status"
