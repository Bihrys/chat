#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target="${1:-all}"
"$ROOT/scripts/services/stop.sh" "$target" || true
"$ROOT/scripts/services/start.sh" "$target"
