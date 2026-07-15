#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"
if curl -fsS "http://$MINIO_HOST:$MINIO_API_PORT/minio/health/live" >/dev/null 2>&1; then
    echo "MinIO OK: http://$MINIO_HOST:$MINIO_API_PORT"
    exit 0
fi
echo "[DOWN] MinIO: http://$MINIO_HOST:$MINIO_API_PORT" >&2
exit 1
