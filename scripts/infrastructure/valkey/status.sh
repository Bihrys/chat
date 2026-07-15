#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"
valkey-cli -h "$VALKEY_HOST" -p "$VALKEY_PORT" ping
