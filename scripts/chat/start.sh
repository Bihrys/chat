#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 "$ROOT/scripts/bootstrap/normalize-local-env.py" >/dev/null
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"

if [[ "$CHAT_ENV" != "local" ]]; then
    echo "Basic Chat V0 plaintext development commands require CHAT_ENV=local." >&2
    exit 1
fi

PID_DIR="$ROOT/var/run/pids/services"
LOG_DIR="$ROOT/var/logs/services"
mkdir -p "$PID_DIR" "$LOG_DIR"

services=(
    "auth-service|chat-service-auth-service|AUTH_SERVICE_ADDR"
    "account-service|chat-service-account-service|ACCOUNT_SERVICE_ADDR"
    "mailbox-store|chat-service-mailbox-store|MAILBOX_STORE_ADDR"
)

# Stop tracked instances before compiling. This deliberately prevents an old
# development binary from continuing to answer /readyz after a new build fails.
"$ROOT/scripts/chat/stop.sh"

cd "$ROOT"
cargo build \
    -p chat-service-auth-service \
    -p chat-service-account-service \
    -p chat-service-mailbox-store

start_service() {
    local name="$1"
    local package="$2"
    local env_name="$3"
    local pid_file="$PID_DIR/$name.pid"
    local log_file="$LOG_DIR/$name.log"

    : > "$log_file"
    nohup "$ROOT/target/debug/$package" >>"$log_file" 2>&1 &
    local pid=$!
    echo "$pid" > "$pid_file"
    echo "started $name (pid $pid, ${!env_name})"

    for _ in {1..80}; do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo "$name exited during startup. Last log lines:" >&2
            tail -n 80 "$log_file" >&2 || true
            rm -f "$pid_file"
            return 1
        fi

        if curl --fail --silent --max-time 1 "http://${!env_name}/readyz" >/dev/null 2>&1; then
            echo "$name is ready."
            return 0
        fi
        sleep 0.1
    done

    echo "$name did not become ready. Last log lines:" >&2
    tail -n 80 "$log_file" >&2 || true
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
    return 1
}

started=()
cleanup_failed_start() {
    if ((${#started[@]} > 0)); then
        "$ROOT/scripts/chat/stop.sh" >/dev/null 2>&1 || true
    fi
}
trap cleanup_failed_start ERR

for entry in "${services[@]}"; do
    IFS='|' read -r name package env_name <<<"$entry"
    start_service "$name" "$package" "$env_name"
    started+=("$name")
done

trap - ERR

cat <<'MSG'
Basic chat services started.

Auth API: http://127.0.0.1:61001
Account API: http://127.0.0.1:61002
Mailbox API / WebSocket: http://127.0.0.1:62003
MSG
