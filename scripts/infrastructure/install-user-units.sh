#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="$HOME/.config/systemd/user"
mkdir -p "$DEST"
for template in "$ROOT"/infra/systemd/templates/*.in; do
    name="$(basename "$template" .in)"
    sed "s|@ROOT@|$ROOT|g" "$template" > "$DEST/$name"
done
systemctl --user daemon-reload
echo "Installed user units. Start with: systemctl --user start chat-infrastructure.target"
