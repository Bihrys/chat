#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PID_DIR="$ROOT/var/run/pids/services"

for name in mailbox-store account-service; do
    pid_file="$PID_DIR/$name.pid"
    if [[ ! -f "$pid_file" ]]; then
        echo "$name is not running."
        continue
    fi

    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid"
        for _ in {1..50}; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.1
        done
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid"
        fi
        echo "stopped $name (pid $pid)"
    else
        echo "$name pid file was stale."
    fi
    rm -f "$pid_file"
done
