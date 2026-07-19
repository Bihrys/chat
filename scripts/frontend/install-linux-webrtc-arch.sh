#!/usr/bin/env bash
set -Eeuo pipefail

if ! command -v pacman >/dev/null 2>&1; then
    echo "This helper is for Arch Linux / Manjaro systems using pacman." >&2
    exit 1
fi

sudo pacman -S --needed gst-plugins-bad

echo
for plugin in webrtcbin webrtcdsp; do
    if gst-inspect-1.0 "$plugin" >/dev/null 2>&1; then
        echo "[ok] $plugin is available"
    else
        echo "[error] $plugin is still unavailable" >&2
        exit 1
    fi
done

echo
printf '%s\n' \
  "WebRTC plugins are installed." \
  "Close every running chat client, then start it again with:" \
  "  cargo xtask linux dev"
