#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target="${1:-all}"
PID_DIR="$ROOT/var/run/pids/services"
while IFS=$'\t' read -r name package env_name; do
    [[ "$target" == "all" || "$target" == "$name" ]] || continue
    pid_file="$PID_DIR/$name.pid"
    if [[ ! -f "$pid_file" ]]; then echo "$name is not running."; continue; fi
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid"; fi
    rm -f "$pid_file"
    echo "stopped $name"
done < "$ROOT/scripts/services/registry.tsv"
