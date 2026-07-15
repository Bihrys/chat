#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
"$ROOT/scripts/infrastructure/minio/stop.sh" || true
"$ROOT/scripts/infrastructure/valkey/stop.sh" || true
"$ROOT/scripts/infrastructure/postgresql/stop.sh" || true
echo "Native infrastructure stopped."
