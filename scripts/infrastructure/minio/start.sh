#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"
require_command curl

if command -v minio >/dev/null 2>&1; then
    MINIO_BIN="$(command -v minio)"
elif [[ -x "$ROOT/var/bin/minio" ]]; then
    MINIO_BIN="$ROOT/var/bin/minio"
else
    echo "MinIO binary is missing. Run: cargo xtask infra up" >&2
    exit 1
fi

DATA_DIR="$ROOT/var/data/minio"
LOG_DIR="$ROOT/var/logs/infrastructure/minio"
PID_FILE="$ROOT/var/run/pids/minio.pid"
mkdir -p "$DATA_DIR" "$LOG_DIR" "$(dirname "$PID_FILE")"

if curl -fsS "http://$MINIO_HOST:$MINIO_API_PORT/minio/health/live" >/dev/null 2>&1; then
    echo "MinIO is already running."
    exit 0
fi

export MINIO_ROOT_USER MINIO_ROOT_PASSWORD
nohup "$MINIO_BIN" server "$DATA_DIR" \
    --address "$MINIO_HOST:$MINIO_API_PORT" \
    --console-address "$MINIO_HOST:$MINIO_CONSOLE_PORT" \
    >>"$LOG_DIR/minio.log" 2>&1 &
echo $! > "$PID_FILE"

for _ in {1..100}; do
    if curl -fsS "http://$MINIO_HOST:$MINIO_API_PORT/minio/health/live" >/dev/null 2>&1; then
        echo "MinIO started at http://$MINIO_HOST:$MINIO_API_PORT"
        exit 0
    fi
    sleep 0.2
done

if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
fi

echo "MinIO failed to start. See $LOG_DIR/minio.log" >&2
exit 1
