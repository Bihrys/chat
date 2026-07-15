#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
status=0
for item in postgresql valkey minio; do
    echo "== $item =="
    if ! "$ROOT/scripts/infrastructure/$item/status.sh"; then status=1; fi
    echo
done
exit "$status"
