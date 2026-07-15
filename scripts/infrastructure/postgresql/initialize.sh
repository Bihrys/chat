#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"

DATA_DIR="$ROOT/var/data/postgresql"
mkdir -p "$DATA_DIR" "$ROOT/var/run/sockets/postgresql" "$ROOT/var/logs/infrastructure/postgresql"

if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
    initdb \
        -D "$DATA_DIR" \
        --username="$POSTGRES_ADMIN_USER" \
        --encoding=UTF8 \
        --locale=C.UTF-8 \
        --auth-local=trust \
        --auth-host=scram-sha-256
fi

"$ROOT/scripts/infrastructure/postgresql/start.sh"

psql \
    -h "$ROOT/var/run/sockets/postgresql" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_ADMIN_USER" \
    -d postgres \
    -f "$ROOT/infra/native/postgresql/init/001-create-databases.sql"

psql \
    -h "$ROOT/var/run/sockets/postgresql" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_ADMIN_USER" \
    -d postgres \
    -f "$ROOT/infra/native/postgresql/init/002-harden-databases.sql"

"$ROOT/scripts/database/configure-local-passwords.sh"
