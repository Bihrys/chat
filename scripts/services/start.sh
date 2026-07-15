#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"
target="${1:-all}"
PID_DIR="$ROOT/var/run/pids/services"
LOG_DIR="$ROOT/var/logs/services"
mkdir -p "$PID_DIR" "$LOG_DIR"

"$ROOT/scripts/services/build.sh"

while IFS=$'\t' read -r name package env_name; do
    [[ "$target" == "all" || "$target" == "$name" ]] || continue
    pid_file="$PID_DIR/$name.pid"
    if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
        echo "$name is already running."
        continue
    fi
    nohup "$ROOT/target/debug/$package" >>"$LOG_DIR/$name.log" 2>&1 &
    echo $! > "$pid_file"
    echo "started $name (pid $(cat "$pid_file"), ${!env_name})"
done < "$ROOT/scripts/services/registry.tsv"
