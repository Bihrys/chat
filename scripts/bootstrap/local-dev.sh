#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

python scripts/bootstrap/normalize-local-env.py

for dir in \
    var/data/postgresql var/data/valkey var/data/minio \
    var/logs/infrastructure/postgresql var/logs/infrastructure/valkey var/logs/infrastructure/minio \
    var/logs/services var/run/pids/services var/run/sockets/postgresql
do
    mkdir -p "$dir"
done

if ! command -v minio >/dev/null 2>&1 || ! command -v mc >/dev/null 2>&1; then
    scripts/bootstrap/install-minio.sh
fi

scripts/infrastructure/postgresql/initialize.sh
scripts/infrastructure/valkey/start.sh
scripts/infrastructure/minio/start.sh
scripts/infrastructure/minio/init-buckets.sh
scripts/database/verify-connections.sh

pnpm install
cargo generate-lockfile
cargo fmt --all
cargo metadata --no-deps --format-version 1 >/dev/null

echo
echo "Local development bootstrap complete."
echo "Next: cargo xtask check"
echo "Then: cargo xtask linux dev"
