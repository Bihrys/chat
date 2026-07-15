#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "============================================================"
echo "0. Local environment loader"
echo "============================================================"

bash scripts/dev/test-env-loader.sh

echo

python scripts/dev/check-dependency-rules.py
cargo metadata --no-deps --format-version 1 >/dev/null
echo "[OK] Cargo metadata"
cargo fmt --all --check
echo "[OK] Formatting"
cargo check --workspace --all-targets
echo "[OK] Workspace check"
cargo clippy --workspace --all-targets -- -D warnings
echo "[OK] Clippy"
cargo nextest run --workspace --no-tests=pass
echo "[OK] Tests"

for frontend in linux windows; do
    if [[ -d "frontends/$frontend/node_modules" ]]; then
        pnpm --dir "frontends/$frontend" typecheck
        echo "[OK] $frontend frontend typecheck"
    else
        echo "[SKIP] frontends/$frontend/node_modules is missing; run pnpm install"
    fi
done

echo "Workspace verification complete."
