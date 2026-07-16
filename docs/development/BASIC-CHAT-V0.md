# Basic Chat V0 — Local Development Vertical Slice

## Purpose

This phase deliberately completes the smallest real chat product loop before the
end-to-end encryption payload is inserted.

The runtime topology already follows the future deployment shape:

```text
Linux Tauri / browser client
        │
        ├── Account Service  :61002 ──> chat_identity
        │
        └── Mailbox Store    :62003 ──> chat_mailbox
                  │
                  └── WebSocket realtime events
```

All processes still run on the same Linux development computer. Moving the
services to remote hosts later must not require rewriting the conversation UI or
message application model.

## Explicit security status

`Basic Chat V0` is **not E2EE yet**.

The message database stores:

```text
payload_format = 0  => plaintext_dev_v0
body            = development plaintext
```

The plaintext API is guarded by `CHAT_ENV=local`, and the UI displays
`PLAINTEXT DEV V0` in the conversation header. This is an intentional temporary
seam. Do not expose these endpoints to an untrusted network.

The next crypto phase replaces the development body with an opaque encrypted
message envelope while retaining the stable identifiers and product flow:

```text
conversation_id
message_id
client_message_id
message_seq
created_at
```

## Implemented product behavior

- local development profiles;
- direct conversation creation with one canonical conversation per account pair;
- PostgreSQL message persistence;
- idempotent client message IDs scoped to a conversation and sender;
- chronological message history;
- conversation ordering by latest activity;
- unread counters;
- read positions;
- WebSocket realtime delivery events;
- reconnect with exponential backoff;
- state resynchronization from PostgreSQL after reconnect;
- two-client testing on one computer;
- automated HTTP + WebSocket smoke test.

PostgreSQL is the source of truth. WebSocket events are only a low-latency
notification channel, so a disconnect or service restart does not define message
durability.

## One-time setup

```bash
cd ~/Projects/chat
cargo xtask bootstrap
```

## Daily basic-chat development

```bash
cd ~/Projects/chat

cargo xtask infra up
cargo xtask chat up
cargo xtask chat status
cargo xtask chat smoke
cargo xtask linux dev
```

The smoke test creates disposable local accounts, opens a direct conversation,
verifies a WebSocket event, verifies PostgreSQL history, checks the unread count,
and verifies mark-read behavior.

## Test Alice and Bob on the same computer

Keep the Tauri window as Alice. Open the Vite URL printed by `cargo xtask linux
dev` in a regular browser or private browser window as Bob, normally:

```text
http://127.0.0.1:1420/
```

Create/select two different local profiles, start a conversation, and send in
both directions.

Because Tauri and the browser have separate session-storage contexts, they can
act as two clients while all backend services remain on the same machine.

## API summary

### Account Service

```text
GET  /healthz
GET  /readyz
GET  /v1/dev/accounts?query=&limit=
POST /v1/dev/accounts
GET  /v1/dev/accounts/{account_id}
```

### Mailbox Store

All HTTP endpoints below require the development-only header:

```text
X-Chat-Account-Id: <UUID>
```

```text
GET  /healthz
GET  /readyz
GET  /v1/conversations
POST /v1/conversations/direct
GET  /v1/conversations/{conversation_id}/messages
POST /v1/conversations/{conversation_id}/messages
POST /v1/conversations/{conversation_id}/read
GET  /v1/ws?account_id=<UUID>
```

The header/query actor selection is not authentication. It exists only to test
two local clients before the real authentication and device-identity phases.

## Stop only the basic chat services

```bash
cargo xtask chat down
```

Infrastructure can remain running for the next development session.
