-- Local-development group conversations. Group payloads remain plaintext until
-- the E2EE group protocol replaces them with opaque envelopes.

CREATE TABLE IF NOT EXISTS group_conversations (
    group_id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL UNIQUE,
    group_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    owner_account_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ,
    dissolved_at TIMESTAMPTZ,
    CHECK (char_length(name) BETWEEN 1 AND 64),
    CHECK (char_length(group_code) BETWEEN 4 AND 32)
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id UUID NOT NULL REFERENCES group_conversations(group_id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    role SMALLINT NOT NULL DEFAULT 0,
    added_by UUID NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, account_id),
    CHECK (role BETWEEN 0 AND 2)
);

CREATE INDEX IF NOT EXISTS idx_group_members_account
    ON group_members(account_id, group_id);

CREATE TABLE IF NOT EXISTS group_reads (
    conversation_id UUID NOT NULL REFERENCES group_conversations(conversation_id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    last_read_seq BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, account_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
    message_seq BIGSERIAL PRIMARY KEY,
    message_id UUID NOT NULL UNIQUE,
    conversation_id UUID NOT NULL REFERENCES group_conversations(conversation_id) ON DELETE CASCADE,
    sender_account_id UUID NOT NULL,
    client_message_id UUID NOT NULL,
    payload_format SMALLINT NOT NULL DEFAULT 0,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, sender_account_id, client_message_id),
    CHECK (char_length(body) BETWEEN 1 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_group_messages_conversation_seq
    ON group_messages(conversation_id, message_seq DESC);
