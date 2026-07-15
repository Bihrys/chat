#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"
SOCKET_DIR="$ROOT/var/run/sockets/postgresql"
psql -h "$SOCKET_DIR" -p "$POSTGRES_PORT" -U "$POSTGRES_ADMIN_USER" -d postgres -Atc \
    "SELECT datname FROM pg_database WHERE datname LIKE 'chat_%' ORDER BY datname;"
