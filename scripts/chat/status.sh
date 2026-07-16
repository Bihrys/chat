#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"

PID_DIR="$ROOT/var/run/pids/services"

check() {
    local name="$1"
    local package="$2"
    local address="$3"
    local pid_file="$PID_DIR/$name.pid"
    local expected="$ROOT/target/debug/$package"

    printf '== %s ==\n' "$name"

    if [[ ! -f "$pid_file" ]]; then
        echo "unavailable: pid file is missing"
        return 1
    fi

    local pid
    pid="$(cat "$pid_file")"
    if ! kill -0 "$pid" 2>/dev/null; then
        echo "unavailable: stale pid file ($pid)"
        return 1
    fi

    if [[ -L "/proc/$pid/exe" && -e "$expected" ]]; then
        local actual expected_real
        actual="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
        expected_real="$(readlink -f "$expected" 2>/dev/null || true)"
        if [[ "$actual" == *" (deleted)" || "$actual" != "$expected_real" ]]; then
            echo "unavailable: running process is not the current development binary"
            return 1
        fi
    fi

    if curl --fail --silent --show-error --max-time 2 "http://$address/readyz"; then
        printf ' (pid %s)\n' "$pid"
    else
        echo "unavailable: readiness request failed"
        return 1
    fi
}

failed=0
check "auth-service" "chat-service-auth-service" "$AUTH_SERVICE_ADDR" || failed=1
check "account-service" "chat-service-account-service" "$ACCOUNT_SERVICE_ADDR" || failed=1
check "mailbox-store" "chat-service-mailbox-store" "$MAILBOX_STORE_ADDR" || failed=1
exit "$failed"
