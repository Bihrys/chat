#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PID_FILE="$ROOT/var/run/pids/minio.pid"
if [[ ! -f "$PID_FILE" ]]; then
    echo "MinIO is not running."
    exit 0
fi
pid="$(cat "$PID_FILE")"
if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in {1..50}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
    done
fi
rm -f "$PID_FILE"
echo "MinIO stopped."
