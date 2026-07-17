CREATE TABLE IF NOT EXISTS media_objects (
    object_id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL,
    owner_account_id UUID NOT NULL,
    media_kind SMALLINT NOT NULL CHECK (media_kind BETWEEN 0 AND 4),
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_len BIGINT NOT NULL CHECK (byte_len > 0 AND byte_len <= 134217728),
    storage_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_objects_conversation_created_idx
    ON media_objects (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_objects_owner_created_idx
    ON media_objects (owner_account_id, created_at DESC);
