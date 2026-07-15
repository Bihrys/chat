#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN_DIR="$ROOT/var/bin"
mkdir -p "$BIN_DIR"

for command in curl sha256sum uname mktemp; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Missing required command: $command" >&2
        exit 1
    fi
done

case "$(uname -m)" in
    x86_64) platform="linux-amd64" ;;
    aarch64|arm64) platform="linux-arm64" ;;
    *) echo "Unsupported architecture for MinIO local-dev bootstrap: $(uname -m)" >&2; exit 1 ;;
esac

MINIO_URL="${MINIO_DOWNLOAD_URL:-https://dl.min.io/server/minio/release/${platform}/minio}"
MINIO_SUM_URL="${MINIO_SHA256_URL:-https://dl.min.io/server/minio/release/${platform}/minio.sha256sum}"
MC_URL="${MC_DOWNLOAD_URL:-https://dl.min.io/client/mc/release/${platform}/mc}"
MC_SUM_URL="${MC_SHA256_URL:-https://dl.min.io/client/mc/release/${platform}/mc.sha256sum}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

download_and_verify() {
    local name="$1" url="$2" sum_url="$3" output="$4"
    echo "Downloading $name..."
    curl --proto '=https' --tlsv1.2 --fail --location --retry 5 --retry-delay 1 --progress-bar "$url" -o "$tmp/$name"
    curl --proto '=https' --tlsv1.2 --fail --location --retry 5 --retry-delay 1 --silent --show-error "$sum_url" -o "$tmp/$name.sha256sum"
    local expected actual
    expected="$(awk 'NF {print $1; exit}' "$tmp/$name.sha256sum")"
    actual="$(sha256sum "$tmp/$name" | awk '{print $1}')"
    if [[ -z "$expected" || "$actual" != "$expected" ]]; then
        echo "$name checksum verification failed." >&2
        echo "expected: ${expected:-<empty>}" >&2
        echo "actual:   $actual" >&2
        exit 1
    fi
    install -m 0755 "$tmp/$name" "$output"
}

download_and_verify minio "$MINIO_URL" "$MINIO_SUM_URL" "$BIN_DIR/minio"
download_and_verify mc "$MC_URL" "$MC_SUM_URL" "$BIN_DIR/mc"
"$BIN_DIR/minio" --version
"$BIN_DIR/mc" --version
