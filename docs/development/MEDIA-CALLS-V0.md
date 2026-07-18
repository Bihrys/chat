# Multimedia and Calls V0

This local-development slice adds the final pre-encryption message and calling primitives.
It is still a plaintext development protocol and must not be exposed to an untrusted network.

## Implemented

- Nine persisted font-size levels (`0..8`); level `1` is the previous standard size.
- Horizontally resizable conversation/address-book pane with local width persistence.
- Authenticated image, video, voice, sticker, and generic-file messages.
- Image paste from the clipboard, image viewer, video playback, audio playback, and file download.
- Microphone recording with a 60-second V0 limit.
- One-to-one WebRTC audio and video calls with authenticated signaling over the existing mailbox WebSocket.
- Microphone mute, camera enable/disable, reject, busy, and hang-up signaling.
- Server-side persistence of locale, theme, and font level.

## Local storage

Uploaded media bytes are stored below `var/data/chat-media/`. Metadata is stored in
PostgreSQL table `media_objects`. Access to every upload and download is checked against
current conversation membership.

V0 limits:

- images and stickers: 25 MiB
- video, voice, and generic files: 128 MiB
- voice recording from the UI: 60 seconds

## Calls

For same-machine and LAN testing, host ICE candidates can be sufficient. Public-internet
calls require ICE servers controlled by the deployment operator. Configure them as JSON:

```bash
VITE_RTC_ICE_SERVERS='[
  {"urls":"stun:stun.example.net:3478"},
  {"urls":"turn:turn.example.net:3478","username":"chat","credential":"replace-me"}
]'
```

Both call participants must be online in V0. Call signaling is ephemeral and is not stored
as chat history yet.

## Encryption boundary

Do not encrypt only the `body` string. The next phase must replace the V0 payload with a
versioned envelope covering text, media descriptors, stickers, call control, sender device,
message sequence, replay protection, and group epoch. Media bytes must be encrypted before
upload and object identifiers must not reveal plaintext metadata.

## Linux desktop integration notes

- The Tauri Linux client installs a narrowly scoped WebKitGTK permission handler for `UserMediaPermissionRequest`; only microphone/camera capture is granted.
- The same native setup explicitly enables WebKitGTK `enable-webrtc`, media-stream, and inline media playback settings so `RTCPeerConnection` is exposed to the frontend.
- The contact profile card exposes message, audio-call, and video-call entry points.
- Clipboard image paste checks both `DataTransfer.items` and `DataTransfer.files`, which is required for WebKitGTK screenshot clipboard payloads.
- Device capture can still fail when the OS has no usable PipeWire/PulseAudio source or camera device.


### Linux runtime check

Run the built-in diagnostic before testing calls:

```bash
cargo xtask linux webrtc-check
```

It checks the WebKitGTK 4.1 runtime, GStreamer WebRTC plugins, capture
source plugins, PipeWire, and `/dev/video*` camera nodes. A missing camera node
does not block audio calls, but it prevents a real video call.

### Contact deletion and retained history

Deleting a contact is separate from deleting the current account's chat history.
The client can keep the direct conversation visible, or clear it and mark it hidden
for that account. Re-adding the contact and opening the direct conversation removes
the hidden marker.
