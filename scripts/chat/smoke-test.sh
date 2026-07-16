#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"

if [[ "$CHAT_ENV" != "local" ]]; then
    echo "Basic Chat V0 plaintext development commands require CHAT_ENV=local." >&2
    exit 1
fi

export CHAT_AUTH_SERVICE_URL="http://$AUTH_SERVICE_ADDR"
export CHAT_ACCOUNT_SERVICE_URL="http://$ACCOUNT_SERVICE_ADDR"
export CHAT_MAILBOX_SERVICE_URL="http://$MAILBOX_STORE_ADDR"
node "$ROOT/scripts/chat/smoke-test.mjs"
