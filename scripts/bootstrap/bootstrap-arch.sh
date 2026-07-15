#!/usr/bin/env bash
set -Eeuo pipefail
sudo pacman -Syu
sudo pacman -S --needed \
    base-devel git git-lfs curl wget file jq tree ripgrep \
    cmake ninja clang lld pkgconf protobuf openssl libsodium sqlite sqlcipher libsecret \
    webkit2gtk-4.1 appmenu-gtk-module libappindicator-gtk3 librsvg xdotool \
    pnpm postgresql valkey tcpdump wireshark-cli procps-ng sccache

git lfs install
rustup component add rustfmt clippy rust-analyzer rust-src llvm-tools-preview

for tool in cargo-nextest cargo-deny cargo-audit cargo-watch cargo-llvm-cov cargo-fuzz tauri-cli; do
    case "$tool" in
        cargo-nextest) cmd="cargo-nextest" ;;
        cargo-deny) cmd="cargo-deny" ;;
        cargo-audit) cmd="cargo-audit" ;;
        cargo-watch) cmd="cargo-watch" ;;
        cargo-llvm-cov) cmd="cargo-llvm-cov" ;;
        cargo-fuzz) cmd="cargo-fuzz" ;;
        tauri-cli) cmd="cargo-tauri" ;;
    esac
    command -v "$cmd" >/dev/null 2>&1 || cargo install --locked "$tool"
done

"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-minio.sh"
echo "Arch development dependencies installed."
