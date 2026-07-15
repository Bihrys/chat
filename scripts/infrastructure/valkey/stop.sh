#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"
if ! valkey-cli -h "$VALKEY_HOST" -p "$VALKEY_PORT" ping >/dev/null 2>&1; then
    echo "Valkey is not running."
    exit 0
fi
valkey-cli -h "$VALKEY_HOST" -p "$VALKEY_PORT" shutdown
echo "Valkey stopped."
