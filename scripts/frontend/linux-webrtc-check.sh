#!/usr/bin/env bash
set -Eeuo pipefail

failures=0

ok() {
    printf '  [ok] %s\n' "$1"
}

warn() {
    printf '  [warn] %s\n' "$1" >&2
    failures=$((failures + 1))
}

info() {
    printf '  [info] %s\n' "$1"
}

echo "Linux WebRTC runtime check"
missing_webrtc_plugins=0

if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists webkit2gtk-4.1; then
    version="$(pkg-config --modversion webkit2gtk-4.1)"
    ok "WebKitGTK 4.1 detected (${version})"
else
    warn "webkit2gtk-4.1 development/runtime metadata was not found"
fi

if command -v gst-inspect-1.0 >/dev/null 2>&1; then
    for plugin in webrtcbin webrtcdsp; do
        if gst-inspect-1.0 "$plugin" >/dev/null 2>&1; then
            ok "GStreamer plugin ${plugin} is available"
        else
            warn "GStreamer plugin ${plugin} is missing"
            missing_webrtc_plugins=1
        fi
    done

    if gst-inspect-1.0 pipewiresrc >/dev/null 2>&1         || gst-inspect-1.0 v4l2src >/dev/null 2>&1; then
        ok "A camera capture source plugin is available"
    else
        warn "Neither pipewiresrc nor v4l2src is available"
    fi

    if gst-inspect-1.0 pulsesrc >/dev/null 2>&1         || gst-inspect-1.0 pipewiresrc >/dev/null 2>&1         || gst-inspect-1.0 alsasrc >/dev/null 2>&1; then
        ok "An audio capture source plugin is available"
    else
        warn "No PulseAudio, PipeWire, or ALSA capture source plugin was found"
    fi
else
    warn "gst-inspect-1.0 is unavailable; GStreamer plugins cannot be checked"
fi

if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-active --quiet pipewire.service 2>/dev/null; then
        ok "PipeWire user service is active"
    else
        warn "PipeWire user service is not active"
    fi
fi

shopt -s nullglob
camera_nodes=(/dev/video*)
if ((${#camera_nodes[@]} > 0)); then
    ok "Camera device nodes found: ${camera_nodes[*]}"
else
    info "No /dev/video* camera device was found; audio calls can still work, but video calls are unavailable"
fi

if ((missing_webrtc_plugins == 1)); then
    echo
    if command -v pacman >/dev/null 2>&1; then
        echo "Install the missing Arch Linux WebRTC plugins with:"
        echo "  sudo pacman -S --needed gst-plugins-bad"
    elif command -v apt-get >/dev/null 2>&1; then
        echo "Install the missing Debian/Ubuntu WebRTC plugins with:"
        echo "  sudo apt-get install gstreamer1.0-plugins-bad"
    elif command -v dnf >/dev/null 2>&1; then
        echo "Install the missing Fedora WebRTC plugins with:"
        echo "  sudo dnf install gstreamer1-plugins-bad-free gstreamer1-plugins-bad-freeworld"
    fi
    echo "Then verify with: gst-inspect-1.0 webrtcbin"
fi

if ((failures == 0)); then
    echo "WebRTC runtime prerequisites look complete."
    exit 0
fi

echo
echo "${failures} prerequisite check(s) need attention." >&2
exit 1
