-- Per-account chat-list preferences and per-account history clear markers.

CREATE TABLE IF NOT EXISTS conversation_preferences (
    conversation_id UUID NOT NULL,
    account_id UUID NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_muted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, account_id)
);

CREATE TABLE IF NOT EXISTS conversation_clears (
    conversation_id UUID NOT NULL,
    account_id UUID NOT NULL,
    cleared_through_seq BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, account_id)
);

CREATE INDEX IF NOT EXISTS conversation_preferences_actor_idx
    ON conversation_preferences (account_id, is_pinned DESC, updated_at DESC);
