-- Development vertical slice for the first complete one-to-one chat loop.
-- `body` is intentionally plaintext only in CHAT_ENV=local and is marked by
-- payload_format=0. The later E2EE phase replaces this payload with an opaque
-- encrypted envelope without changing conversation/message identifiers.

CREATE TABLE IF NOT EXISTS direct_conversations (
    conversation_id UUID PRIMARY KEY,
    member_a UUID NOT NULL,
    member_b UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ,
    CHECK (member_a <> member_b),
    UNIQUE (member_a, member_b)
);

CREATE TABLE IF NOT EXISTS conversation_reads (
    conversation_id UUID NOT NULL REFERENCES direct_conversations(conversation_id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    last_read_seq BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, account_id)
);

CREATE TABLE IF NOT EXISTS messages (
    message_seq BIGSERIAL PRIMARY KEY,
    message_id UUID NOT NULL UNIQUE,
    conversation_id UUID NOT NULL REFERENCES direct_conversations(conversation_id) ON DELETE CASCADE,
    sender_account_id UUID NOT NULL,
    client_message_id UUID NOT NULL,
    payload_format SMALLINT NOT NULL DEFAULT 0,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, sender_account_id, client_message_id),
    CHECK (char_length(body) BETWEEN 1 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_direct_conversations_member_a
    ON direct_conversations(member_a, last_message_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_direct_conversations_member_b
    ON direct_conversations(member_b, last_message_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
    ON messages(conversation_id, message_seq DESC);
