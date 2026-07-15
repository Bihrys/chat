#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DATA_DIR="$ROOT/var/data/postgresql"
if ! pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
    echo "PostgreSQL is not running."
    exit 0
fi
pg_ctl -D "$DATA_DIR" -m fast stop
echo "PostgreSQL stopped."
