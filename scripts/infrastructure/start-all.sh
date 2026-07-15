#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python "$ROOT/scripts/bootstrap/normalize-local-env.py" >/dev/null
"$ROOT/scripts/infrastructure/postgresql/start.sh"
"$ROOT/scripts/infrastructure/valkey/start.sh"

have_minio=false
have_mc=false
command -v minio >/dev/null 2>&1 && have_minio=true
command -v mc >/dev/null 2>&1 && have_mc=true
[[ -x "$ROOT/var/bin/minio" ]] && have_minio=true
[[ -x "$ROOT/var/bin/mc" ]] && have_mc=true

if [[ "$have_minio" != true || "$have_mc" != true ]]; then
    echo "MinIO local-development tools are missing; installing project-local binaries..."
    "$ROOT/scripts/bootstrap/install-minio.sh"
fi

"$ROOT/scripts/infrastructure/minio/start.sh"
"$ROOT/scripts/infrastructure/minio/init-buckets.sh"
echo "Native infrastructure is running."
