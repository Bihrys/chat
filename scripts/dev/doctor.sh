#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"

required=(git cargo rustc rust-analyzer sccache pnpm node initdb pg_ctl psql valkey-server valkey-cli curl pkg-config)
missing=0
for cmd in "${required[@]}"; do
    if command -v "$cmd" >/dev/null 2>&1; then printf '[OK]   %-18s %s\n' "$cmd" "$(command -v "$cmd")"; else printf '[MISS] %-18s\n' "$cmd"; missing=1; fi
done

if pkg-config --exists webkit2gtk-4.1; then
    echo "[OK]   webkit2gtk-4.1 $(pkg-config --modversion webkit2gtk-4.1)"
else
    echo "[MISS] webkit2gtk-4.1"
    missing=1
fi

for cmd in minio mc; do
    if command -v "$cmd" >/dev/null 2>&1; then echo "[OK]   $cmd $(command -v "$cmd")"; else echo "[MISS] $cmd (run scripts/bootstrap/install-minio.sh)"; missing=1; fi
done

[[ -f "$ROOT/.env" ]] && echo "[OK]   .env" || { echo "[MISS] .env"; missing=1; }
exit "$missing"
