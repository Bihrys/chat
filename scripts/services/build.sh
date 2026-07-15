#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mapfile -t packages < <(awk -F '\t' '{print $2}' "$ROOT/scripts/services/registry.tsv")
args=()
for package in "${packages[@]}"; do args+=( -p "$package" ); done
cd "$ROOT"
cargo build "${args[@]}"
