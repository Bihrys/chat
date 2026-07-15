#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"
target="${1:-all}"
PID_DIR="$ROOT/var/run/pids/services"
status=0
while IFS=$'\t' read -r name package env_name; do
    [[ "$target" == "all" || "$target" == "$name" ]] || continue
    pid_file="$PID_DIR/$name.pid"
    if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
        echo "[UP]   $name pid=$(cat "$pid_file") addr=${!env_name}"
    else
        echo "[DOWN] $name addr=${!env_name}"
        status=1
    fi
done < "$ROOT/scripts/services/registry.tsv"
exit "$status"
