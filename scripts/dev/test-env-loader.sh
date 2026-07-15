#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

# Simulate the user's older local files: PostgreSQL exists, but the newer
# Valkey/MinIO keys are absent from both files.
cat > "$fixture/.env.example" <<'ENV'
CHAT_ENV=local
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=55432
ENV

cat > "$fixture/.env" <<'ENV'
CHAT_LOG_LEVEL=debug
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=55432
VALKEY_URL=redis://127.0.0.1:56379
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:59000
ENV

load_chat_env "$fixture"

required=(
    POSTGRES_HOST POSTGRES_PORT
    VALKEY_HOST VALKEY_PORT
    MINIO_HOST MINIO_API_PORT MINIO_CONSOLE_PORT
    MINIO_ROOT_USER MINIO_ROOT_PASSWORD
    OBJECT_STORAGE_ENDPOINT
    OBJECT_STORAGE_ACCESS_KEY
    OBJECT_STORAGE_SECRET_KEY
    OBJECT_STORAGE_OBJECTS_BUCKET
    OBJECT_STORAGE_BACKUPS_BUCKET
)

for name in "${required[@]}"; do
    if [[ -z "${!name:-}" ]]; then
        echo "[FAIL] missing environment variable: $name" >&2
        exit 1
    fi
done

[[ "$VALKEY_HOST" == "127.0.0.1" ]]
[[ "$VALKEY_PORT" == "56379" ]]
[[ "$MINIO_HOST" == "127.0.0.1" ]]
[[ "$MINIO_API_PORT" == "59000" ]]

echo "[OK] local environment loader"
