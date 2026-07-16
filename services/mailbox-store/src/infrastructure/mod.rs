//! PostgreSQL persistence for the development direct-message vertical slice.

use anyhow::{Context, Result};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use uuid::Uuid;

use crate::domain::{ConversationRecord, MessageRecord};

const MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/mailbox/0001_basic_chat.sql");

#[derive(Clone)]
pub(crate) struct MailboxRepository {
    pool: PgPool,
}

impl MailboxRepository {
    pub(crate) async fn connect() -> Result<Self> {
        let database_url = chat_foundation_config::required("MAILBOX_DATABASE_URL")
            .context("MAILBOX_DATABASE_URL is required")?;
        let pool = PgPoolOptions::new()
            .max_connections(16)
            .connect(&database_url)
            .await
            .context("failed to connect to mailbox database")?;

        sqlx::raw_sql(MIGRATION)
            .execute(&pool)
            .await
            .context("failed to apply mailbox development migration")?;

        Ok(Self { pool })
    }

    pub(crate) async fn healthcheck(&self) -> Result<()> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .context("mailbox database healthcheck failed")?;
        Ok(())
    }

    pub(crate) async fn create_direct_conversation(
        &self,
        actor: Uuid,
        peer: Uuid,
    ) -> Result<ConversationRecord> {
        let (member_a, member_b) = if actor.as_bytes() <= peer.as_bytes() {
            (actor, peer)
        } else {
            (peer, actor)
        };
        let conversation_id = Uuid::now_v7();
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin direct conversation transaction")?;

        let row = sqlx::query(
            r#"
            INSERT INTO direct_conversations (
                conversation_id,
                member_a,
                member_b
            )
            VALUES ($1, $2, $3)
            ON CONFLICT (member_a, member_b)
            DO UPDATE SET member_a = EXCLUDED.member_a
            RETURNING conversation_id, created_at, last_message_at
            "#,
        )
        .bind(conversation_id)
        .bind(member_a)
        .bind(member_b)
        .fetch_one(&mut *transaction)
        .await
        .context("failed to create direct conversation")?;

        let actual_conversation_id: Uuid = row.try_get("conversation_id")?;
        for account_id in [member_a, member_b] {
            sqlx::query(
                r#"
                INSERT INTO conversation_reads (conversation_id, account_id, last_read_seq)
                VALUES ($1, $2, 0)
                ON CONFLICT (conversation_id, account_id) DO NOTHING
                "#,
            )
            .bind(actual_conversation_id)
            .bind(account_id)
            .execute(&mut *transaction)
            .await
            .context("failed to initialize conversation read state")?;
        }

        transaction
            .commit()
            .await
            .context("failed to commit direct conversation transaction")?;

        Ok(ConversationRecord {
            conversation_id: actual_conversation_id,
            peer_account_id: peer,
            created_at: row.try_get("created_at")?,
            last_message_at: row.try_get("last_message_at")?,
            unread_count: 0,
            last_message: None,
        })
    }

    pub(crate) async fn list_conversations(&self, actor: Uuid) -> Result<Vec<ConversationRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT
                c.conversation_id,
                CASE WHEN c.member_a = $1 THEN c.member_b ELSE c.member_a END AS peer_account_id,
                c.created_at,
                c.last_message_at,
                COALESCE(unread.unread_count, 0)::BIGINT AS unread_count,
                last_message.message_seq AS last_message_seq,
                last_message.message_id AS last_message_id,
                last_message.sender_account_id AS last_sender_account_id,
                last_message.client_message_id AS last_client_message_id,
                last_message.payload_format AS last_payload_format,
                last_message.body AS last_body,
                last_message.created_at AS last_created_at
            FROM direct_conversations c
            LEFT JOIN conversation_reads reads
                ON reads.conversation_id = c.conversation_id
               AND reads.account_id = $1
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::BIGINT AS unread_count
                FROM messages m
                WHERE m.conversation_id = c.conversation_id
                  AND m.sender_account_id <> $1
                  AND m.message_seq > COALESCE(reads.last_read_seq, 0)
            ) unread ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    m.message_seq,
                    m.message_id,
                    m.sender_account_id,
                    m.client_message_id,
                    m.payload_format,
                    m.body,
                    m.created_at
                FROM messages m
                WHERE m.conversation_id = c.conversation_id
                ORDER BY m.message_seq DESC
                LIMIT 1
            ) last_message ON TRUE
            WHERE c.member_a = $1 OR c.member_b = $1
            ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
            "#,
        )
        .bind(actor)
        .fetch_all(&self.pool)
        .await
        .context("failed to list conversations")?;

        rows.into_iter()
            .map(|row| -> Result<ConversationRecord> {
                let conversation_id: Uuid = row.try_get("conversation_id")?;
                let last_message_id: Option<Uuid> = row.try_get("last_message_id")?;
                let last_message = match last_message_id {
                    Some(message_id) => Some(MessageRecord {
                        message_seq: row.try_get("last_message_seq")?,
                        message_id,
                        conversation_id,
                        sender_account_id: row.try_get("last_sender_account_id")?,
                        client_message_id: row.try_get("last_client_message_id")?,
                        payload_format: row.try_get("last_payload_format")?,
                        body: row.try_get("last_body")?,
                        created_at: row.try_get("last_created_at")?,
                    }),
                    None => None,
                };

                Ok(ConversationRecord {
                    conversation_id,
                    peer_account_id: row.try_get("peer_account_id")?,
                    created_at: row.try_get("created_at")?,
                    last_message_at: row.try_get("last_message_at")?,
                    unread_count: row.try_get("unread_count")?,
                    last_message,
                })
            })
            .collect()
    }

    pub(crate) async fn ensure_member(&self, conversation_id: Uuid, actor: Uuid) -> Result<bool> {
        let is_member: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM direct_conversations
                WHERE conversation_id = $1
                  AND (member_a = $2 OR member_b = $2)
            )
            "#,
        )
        .bind(conversation_id)
        .bind(actor)
        .fetch_one(&self.pool)
        .await
        .context("failed to verify conversation membership")?;

        Ok(is_member)
    }

    pub(crate) async fn conversation_members(
        &self,
        conversation_id: Uuid,
    ) -> Result<Option<(Uuid, Uuid)>> {
        let row = sqlx::query(
            "SELECT member_a, member_b FROM direct_conversations WHERE conversation_id = $1",
        )
        .bind(conversation_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch conversation members")?;

        row.map(|row| Ok((row.try_get("member_a")?, row.try_get("member_b")?)))
            .transpose()
    }

    pub(crate) async fn list_messages(
        &self,
        conversation_id: Uuid,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<MessageRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT *
            FROM (
                SELECT
                    message_seq,
                    message_id,
                    conversation_id,
                    sender_account_id,
                    client_message_id,
                    payload_format,
                    body,
                    created_at
                FROM messages
                WHERE conversation_id = $1
                  AND ($2::BIGINT IS NULL OR message_seq < $2)
                ORDER BY message_seq DESC
                LIMIT $3
            ) recent
            ORDER BY message_seq ASC
            "#,
        )
        .bind(conversation_id)
        .bind(before_seq)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .context("failed to list messages")?;

        rows.into_iter().map(row_to_message).collect()
    }

    pub(crate) async fn insert_message(
        &self,
        conversation_id: Uuid,
        sender_account_id: Uuid,
        client_message_id: Uuid,
        body: &str,
    ) -> Result<MessageRecord> {
        let message_id = Uuid::now_v7();
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin message transaction")?;

        let row = sqlx::query(
            r#"
            INSERT INTO messages (
                message_id,
                conversation_id,
                sender_account_id,
                client_message_id,
                payload_format,
                body
            )
            VALUES ($1, $2, $3, $4, 0, $5)
            ON CONFLICT (conversation_id, sender_account_id, client_message_id)
            DO UPDATE SET client_message_id = EXCLUDED.client_message_id
            RETURNING
                message_seq,
                message_id,
                conversation_id,
                sender_account_id,
                client_message_id,
                payload_format,
                body,
                created_at
            "#,
        )
        .bind(message_id)
        .bind(conversation_id)
        .bind(sender_account_id)
        .bind(client_message_id)
        .bind(body)
        .fetch_one(&mut *transaction)
        .await
        .context("failed to insert message")?;

        let message = row_to_message(row)?;

        sqlx::query(
            "UPDATE direct_conversations SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2) WHERE conversation_id = $1",
        )
        .bind(conversation_id)
        .bind(message.created_at)
        .execute(&mut *transaction)
        .await
        .context("failed to update conversation activity")?;

        transaction
            .commit()
            .await
            .context("failed to commit message transaction")?;

        Ok(message)
    }

    pub(crate) async fn mark_read(&self, conversation_id: Uuid, actor: Uuid) -> Result<i64> {
        let max_seq: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(message_seq), 0)::BIGINT FROM messages WHERE conversation_id = $1",
        )
        .bind(conversation_id)
        .fetch_one(&self.pool)
        .await
        .context("failed to calculate read position")?;

        sqlx::query(
            r#"
            INSERT INTO conversation_reads (
                conversation_id,
                account_id,
                last_read_seq,
                updated_at
            )
            VALUES ($1, $2, $3, now())
            ON CONFLICT (conversation_id, account_id)
            DO UPDATE SET
                last_read_seq = GREATEST(conversation_reads.last_read_seq, EXCLUDED.last_read_seq),
                updated_at = now()
            "#,
        )
        .bind(conversation_id)
        .bind(actor)
        .bind(max_seq)
        .execute(&self.pool)
        .await
        .context("failed to update read position")?;

        Ok(max_seq)
    }
}

fn row_to_message(row: sqlx::postgres::PgRow) -> Result<MessageRecord> {
    Ok(MessageRecord {
        message_seq: row.try_get("message_seq")?,
        message_id: row.try_get("message_id")?,
        conversation_id: row.try_get("conversation_id")?,
        sender_account_id: row.try_get("sender_account_id")?,
        client_message_id: row.try_get("client_message_id")?,
        payload_format: row.try_get("payload_format")?,
        body: row.try_get("body")?,
        created_at: row.try_get("created_at")?,
    })
}
