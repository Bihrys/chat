-- Group discovery and moderated join requests for the local-development chat slice.

CREATE TABLE IF NOT EXISTS group_join_requests (
    request_id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES group_conversations(group_id) ON DELETE CASCADE,
    applicant_account_id UUID NOT NULL,
    message TEXT NOT NULL,
    status SMALLINT NOT NULL DEFAULT 0,
    decided_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status BETWEEN 0 AND 2),
    CHECK (char_length(message) BETWEEN 1 AND 256)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_join_request_pending
    ON group_join_requests(group_id, applicant_account_id)
    WHERE status = 0;

CREATE INDEX IF NOT EXISTS idx_group_join_requests_group_status
    ON group_join_requests(group_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_group_join_requests_applicant
    ON group_join_requests(applicant_account_id, created_at DESC);
