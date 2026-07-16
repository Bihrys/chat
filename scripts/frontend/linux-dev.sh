#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SAVED_STTY=""

# fish itself manages the kitty keyboard-protocol stack. Sending CSI < u from
# this wrapper desynchronizes fish and the terminal, which makes Ctrl-C appear
# as literal "^[[99;5u" text after the Tauri window closes. Preserve only the
# POSIX tty flags here and leave keyboard-protocol negotiation to the shell.
if [[ -r /dev/tty && -w /dev/tty ]]; then
    SAVED_STTY="$(stty -g < /dev/tty 2>/dev/null || true)"
fi

restore_terminal() {
    if [[ -n "$SAVED_STTY" && -r /dev/tty && -w /dev/tty ]]; then
        stty "$SAVED_STTY" < /dev/tty > /dev/tty 2>/dev/null || true
    fi
}

trap restore_terminal EXIT HUP INT TERM

cd "$ROOT"
# The development process does not require interactive stdin. Keeping stdin
# away from WebKit/Tauri/cargo prevents a child from consuming or changing the
# shell's terminal input protocol, while Ctrl-C still reaches the foreground
# process group as SIGINT.
pnpm --dir frontends/linux tauri:dev </dev/null
