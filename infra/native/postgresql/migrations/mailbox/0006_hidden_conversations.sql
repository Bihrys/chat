-- Per-account conversation visibility after deleting a contact without history.

ALTER TABLE conversation_preferences
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS conversation_preferences_hidden_actor_idx
    ON conversation_preferences (account_id, is_hidden, updated_at DESC);
