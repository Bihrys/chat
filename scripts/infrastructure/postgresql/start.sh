#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"

DATA_DIR="$ROOT/var/data/postgresql"
SOCKET_DIR="$ROOT/var/run/sockets/postgresql"
LOG_DIR="$ROOT/var/logs/infrastructure/postgresql"
LOG_FILE="$LOG_DIR/postgresql.log"
mkdir -p "$SOCKET_DIR" "$LOG_DIR"

if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
    echo "PostgreSQL is not initialized. Run: cargo xtask bootstrap" >&2
    exit 1
fi

if pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
    echo "PostgreSQL is already running."
    exit 0
fi

pg_ctl -D "$DATA_DIR" -l "$LOG_FILE" \
    -o "-h $POSTGRES_HOST -p $POSTGRES_PORT -k $SOCKET_DIR" start

echo "PostgreSQL started at $POSTGRES_HOST:$POSTGRES_PORT"
