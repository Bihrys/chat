#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"

if command -v mc >/dev/null 2>&1; then
    MC_BIN="$(command -v mc)"
elif [[ -x "$ROOT/var/bin/mc" ]]; then
    MC_BIN="$ROOT/var/bin/mc"
else
    echo "MinIO client (mc) is missing. Run: cargo xtask infra up" >&2
    exit 1
fi

alias_name="chat-local"
"$MC_BIN" alias set "$alias_name" "$OBJECT_STORAGE_ENDPOINT" "$OBJECT_STORAGE_ACCESS_KEY" "$OBJECT_STORAGE_SECRET_KEY" >/dev/null
"$MC_BIN" mb --ignore-existing "$alias_name/$OBJECT_STORAGE_OBJECTS_BUCKET"
"$MC_BIN" mb --ignore-existing "$alias_name/$OBJECT_STORAGE_BACKUPS_BUCKET"
echo "MinIO buckets initialized."
