# Basic Chat V0 — Authenticated Local Development Slice

## Purpose

This phase completes a real account and one-to-one chat loop before the E2EE
message envelope is inserted.

```text
Linux Tauri / browser client
        │
        ├── Auth Service     :61001 ──> chat_auth
        │        │
        │        └── account-service internal contract
        ├── Account Service  :61002 ──> chat_identity
        │
        └── Mailbox Store    :62003 ──> chat_mailbox
                  │
                  └── WebSocket realtime events
```

Each service owns its database. Account and mailbox services validate bearer
sessions through the auth-service introspection API; they do not read
`chat_auth` directly.

## Security status

Registration and login are implemented for local development:

- user-selected username, display name, and password;
- explicit Argon2id password hashes;
- opaque random bearer tokens;
- only token digests are stored in PostgreSQL;
- seven-day local sessions and logout revocation;
- account and mailbox APIs require bearer authentication.

Messages are **not E2EE yet**. `chat_mailbox` still stores:

```text
payload_format = 0  => plaintext_dev_v0
body            = development plaintext
```

All current APIs are restricted to `CHAT_ENV=local`. Do not bind or expose this
slice to an untrusted network. Browser session storage and the WebSocket token
query are temporary local-development choices, not the final production token
transport.

## Implemented behavior

- registration and login with a custom username;
- claiming an old pre-auth local profile by registering its username once;
- authenticated account search;
- one canonical direct conversation per account pair;
- PostgreSQL message persistence and history recovery;
- idempotent client message IDs;
- unread counters and read positions;
- WebSocket realtime events and reconnect;
- two-client testing on one computer;
- automated registration, authentication, HTTP, PostgreSQL, and WebSocket smoke
  test.

PostgreSQL is the source of truth. WebSocket events are only a low-latency
notification channel.

## Daily development

```bash
cd ~/Projects/chat
cargo xtask infra up
cargo xtask chat up
cargo xtask chat status
cargo xtask chat smoke
cargo xtask linux dev
```

`chat up` normalizes the local `.env`, generates the internal local service
credential when it is missing, then starts:

1. `auth-service`;
2. `account-service`;
3. `mailbox-store`.

## Test Alice and Bob on the same computer

Use the Tauri window for Alice and a private browser window for Bob:

```bash
# terminal 1
cargo xtask linux dev

# terminal 2
chromium --incognito http://127.0.0.1:1420/
```

Register two different usernames. Search the second username from the first
client, create a conversation, and send in both directions.

## Public API summary

### Auth Service

```text
POST /v1/auth/register
POST /v1/auth/login
GET  /v1/auth/me
POST /v1/auth/logout
GET  /v1/auth/introspect
```

### Account Service

```text
GET /v1/accounts?query=&limit=
GET /v1/accounts/{account_id}
```

### Mailbox Store

```text
GET  /v1/conversations
POST /v1/conversations/direct
GET  /v1/conversations/{conversation_id}/messages
POST /v1/conversations/{conversation_id}/messages
POST /v1/conversations/{conversation_id}/read
GET  /v1/ws?access_token=<local-development-token>
```

HTTP account and mailbox routes require:

```text
Authorization: Bearer <access-token>
```

## Linux desktop notes

Use the supported launcher:

```bash
cargo xtask linux dev
```

The Tauri configuration uses explicit `pnpm --dir ..` hooks so invoking Tauri
from the native directory also finds the frontend scripts. The launcher does
not manually push or pop the kitty keyboard-protocol stack; fish owns that
state. It only restores ordinary `stty` flags on exit.

The chat layout is fixed to the WebView viewport, with the message list as the
only scrolling chat region. The composer remains in the final grid row and its
textarea grows only to a bounded height, preventing it from moving beyond the
niri-managed window.

## Stop

```bash
cargo xtask chat down
```
