#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"

TEMPLATE="$ROOT/infra/native/valkey/config/valkey.conf"
RUNTIME_CONFIG="$ROOT/var/run/valkey.conf"

mkdir -p \
    "$ROOT/var/data/valkey" \
    "$ROOT/var/run/pids" \
    "$ROOT/var/logs/infrastructure/valkey"

if valkey-cli -h "$VALKEY_HOST" -p "$VALKEY_PORT" ping >/dev/null 2>&1; then
    echo "Valkey is already running."
    exit 0
fi

escaped_root="${ROOT//\\/\\\\}"
escaped_root="${escaped_root//&/\\&}"
escaped_root="${escaped_root//|/\\|}"

sed \
    -e "s|@ROOT@|$escaped_root|g" \
    -e "s|@VALKEY_PORT@|$VALKEY_PORT|g" \
    "$TEMPLATE" > "$RUNTIME_CONFIG"

valkey-server "$RUNTIME_CONFIG"

for _ in {1..20}; do
    if valkey-cli -h "$VALKEY_HOST" -p "$VALKEY_PORT" ping >/dev/null 2>&1; then
        echo "Valkey started at $VALKEY_HOST:$VALKEY_PORT"
        exit 0
    fi
    sleep 0.1
done

echo "Valkey failed to start. See: $ROOT/var/logs/infrastructure/valkey/valkey.log" >&2
exit 1
