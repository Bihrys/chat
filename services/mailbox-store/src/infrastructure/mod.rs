//! PostgreSQL persistence for local direct and group conversations.

use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use uuid::Uuid;

use crate::domain::{
    ConversationKind, ConversationRecord, GroupDiscoveryRecord, GroupJoinRequestRecord,
    GroupJoinRequestStatus, GroupMemberRecord, GroupRecord, GroupRole, MessageRecord,
};

const DIRECT_MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/mailbox/0001_basic_chat.sql");
const GROUP_MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/mailbox/0002_groups.sql");
const GROUP_DISCOVERY_MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/mailbox/0003_group_discovery.sql");

#[derive(Clone)]
pub(crate) struct MailboxRepository {
    pool: PgPool,
}

impl MailboxRepository {
    pub(crate) async fn connect() -> Result<Self> {
        let database_url = chat_foundation_config::required("MAILBOX_DATABASE_URL")
            .context("MAILBOX_DATABASE_URL is required")?;
        let pool = PgPoolOptions::new()
            .max_connections(20)
            .connect(&database_url)
            .await
            .context("failed to connect to mailbox database")?;

        sqlx::raw_sql(DIRECT_MIGRATION)
            .execute(&pool)
            .await
            .context("failed to apply direct-chat migration")?;
        sqlx::raw_sql(GROUP_MIGRATION)
            .execute(&pool)
            .await
            .context("failed to apply group-chat migration")?;
        sqlx::raw_sql(GROUP_DISCOVERY_MIGRATION)
            .execute(&pool)
            .await
            .context("failed to apply group-discovery migration")?;

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
            r"
            INSERT INTO direct_conversations (conversation_id, member_a, member_b)
            VALUES ($1, $2, $3)
            ON CONFLICT (member_a, member_b)
            DO UPDATE SET member_a = EXCLUDED.member_a
            RETURNING conversation_id, created_at, last_message_at
            ",
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
                r"
                INSERT INTO conversation_reads (conversation_id, account_id, last_read_seq)
                VALUES ($1, $2, 0)
                ON CONFLICT (conversation_id, account_id) DO NOTHING
                ",
            )
            .bind(actual_conversation_id)
            .bind(account_id)
            .execute(&mut *transaction)
            .await
            .context("failed to initialize direct read state")?;
        }
        transaction
            .commit()
            .await
            .context("failed to commit direct conversation")?;

        Ok(ConversationRecord {
            conversation_id: actual_conversation_id,
            kind: ConversationKind::Direct,
            peer_account_id: Some(peer),
            group_id: None,
            group_code: None,
            group_name: None,
            group_role: None,
            member_count: None,
            created_at: row.try_get("created_at")?,
            last_message_at: row.try_get("last_message_at")?,
            unread_count: 0,
            last_message: None,
        })
    }

    pub(crate) async fn list_conversations(&self, actor: Uuid) -> Result<Vec<ConversationRecord>> {
        let direct_rows = sqlx::query(
            r"
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
                ON reads.conversation_id = c.conversation_id AND reads.account_id = $1
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::BIGINT AS unread_count
                FROM messages m
                WHERE m.conversation_id = c.conversation_id
                  AND m.sender_account_id <> $1
                  AND m.message_seq > COALESCE(reads.last_read_seq, 0)
            ) unread ON TRUE
            LEFT JOIN LATERAL (
                SELECT m.message_seq, m.message_id, m.sender_account_id,
                       m.client_message_id, m.payload_format, m.body, m.created_at
                FROM messages m
                WHERE m.conversation_id = c.conversation_id
                ORDER BY m.message_seq DESC
                LIMIT 1
            ) last_message ON TRUE
            WHERE c.member_a = $1 OR c.member_b = $1
            ",
        )
        .bind(actor)
        .fetch_all(&self.pool)
        .await
        .context("failed to list direct conversations")?;

        let group_rows = sqlx::query(
            r"
            SELECT
                g.conversation_id,
                g.group_id,
                g.group_code,
                g.name AS group_name,
                gm.role AS group_role,
                member_count.member_count,
                g.created_at,
                g.last_message_at,
                COALESCE(unread.unread_count, 0)::BIGINT AS unread_count,
                last_message.message_seq AS last_message_seq,
                last_message.message_id AS last_message_id,
                last_message.sender_account_id AS last_sender_account_id,
                last_message.client_message_id AS last_client_message_id,
                last_message.payload_format AS last_payload_format,
                last_message.body AS last_body,
                last_message.created_at AS last_created_at
            FROM group_conversations g
            JOIN group_members gm ON gm.group_id = g.group_id AND gm.account_id = $1
            LEFT JOIN group_reads reads
                ON reads.conversation_id = g.conversation_id AND reads.account_id = $1
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::BIGINT AS unread_count
                FROM group_messages m
                WHERE m.conversation_id = g.conversation_id
                  AND m.sender_account_id <> $1
                  AND m.message_seq > COALESCE(reads.last_read_seq, 0)
            ) unread ON TRUE
            LEFT JOIN LATERAL (
                SELECT m.message_seq, m.message_id, m.sender_account_id,
                       m.client_message_id, m.payload_format, m.body, m.created_at
                FROM group_messages m
                WHERE m.conversation_id = g.conversation_id
                ORDER BY m.message_seq DESC
                LIMIT 1
            ) last_message ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::BIGINT AS member_count
                FROM group_members all_members
                WHERE all_members.group_id = g.group_id
            ) member_count ON TRUE
            WHERE g.dissolved_at IS NULL
            ",
        )
        .bind(actor)
        .fetch_all(&self.pool)
        .await
        .context("failed to list group conversations")?;

        let mut conversations = Vec::with_capacity(direct_rows.len() + group_rows.len());
        for row in direct_rows {
            let conversation_id: Uuid = row.try_get("conversation_id")?;
            conversations.push(ConversationRecord {
                conversation_id,
                kind: ConversationKind::Direct,
                peer_account_id: Some(row.try_get("peer_account_id")?),
                group_id: None,
                group_code: None,
                group_name: None,
                group_role: None,
                member_count: None,
                created_at: row.try_get("created_at")?,
                last_message_at: row.try_get("last_message_at")?,
                unread_count: row.try_get("unread_count")?,
                last_message: optional_message(&row, conversation_id)?,
            });
        }
        for row in group_rows {
            let conversation_id: Uuid = row.try_get("conversation_id")?;
            let role_value: i16 = row.try_get("group_role")?;
            conversations.push(ConversationRecord {
                conversation_id,
                kind: ConversationKind::Group,
                peer_account_id: None,
                group_id: Some(row.try_get("group_id")?),
                group_code: Some(row.try_get("group_code")?),
                group_name: Some(row.try_get("group_name")?),
                group_role: Some(
                    GroupRole::from_i16(role_value)
                        .ok_or_else(|| anyhow!("invalid group role {role_value}"))?,
                ),
                member_count: Some(row.try_get("member_count")?),
                created_at: row.try_get("created_at")?,
                last_message_at: row.try_get("last_message_at")?,
                unread_count: row.try_get("unread_count")?,
                last_message: optional_message(&row, conversation_id)?,
            });
        }
        conversations.sort_by(|left, right| {
            let left_time = left.last_message_at.unwrap_or(left.created_at);
            let right_time = right.last_message_at.unwrap_or(right.created_at);
            right_time.cmp(&left_time)
        });
        Ok(conversations)
    }

    pub(crate) async fn ensure_member(&self, conversation_id: Uuid, actor: Uuid) -> Result<bool> {
        sqlx::query_scalar(
            r"
            SELECT EXISTS(
                SELECT 1 FROM direct_conversations
                WHERE conversation_id = $1 AND (member_a = $2 OR member_b = $2)
                UNION ALL
                SELECT 1
                FROM group_conversations g
                JOIN group_members gm ON gm.group_id = g.group_id
                WHERE g.conversation_id = $1
                  AND g.dissolved_at IS NULL
                  AND gm.account_id = $2
            )
            ",
        )
        .bind(conversation_id)
        .bind(actor)
        .fetch_one(&self.pool)
        .await
        .context("failed to verify conversation membership")
    }

    pub(crate) async fn conversation_members(&self, conversation_id: Uuid) -> Result<Vec<Uuid>> {
        let rows = sqlx::query_scalar::<_, Uuid>(
            r"
            SELECT member_a FROM direct_conversations WHERE conversation_id = $1
            UNION
            SELECT member_b FROM direct_conversations WHERE conversation_id = $1
            UNION
            SELECT gm.account_id
            FROM group_conversations g
            JOIN group_members gm ON gm.group_id = g.group_id
            WHERE g.conversation_id = $1 AND g.dissolved_at IS NULL
            ",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await
        .context("failed to fetch conversation members")?;
        Ok(rows)
    }

    pub(crate) async fn list_messages(
        &self,
        conversation_id: Uuid,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<MessageRecord>> {
        let is_group = self.is_group_conversation(conversation_id).await?;
        let rows = if is_group {
            sqlx::query(
                r"
                SELECT *
                FROM (
                    SELECT message_seq,
                           message_id,
                           conversation_id,
                           sender_account_id,
                           client_message_id,
                           payload_format,
                           body,
                           created_at
                    FROM group_messages
                    WHERE conversation_id = $1
                      AND ($2::BIGINT IS NULL OR message_seq < $2)
                    ORDER BY message_seq DESC
                    LIMIT $3
                ) recent
                ORDER BY message_seq ASC
                ",
            )
            .bind(conversation_id)
            .bind(before_seq)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query(
                r"
                SELECT *
                FROM (
                    SELECT message_seq,
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
                ",
            )
            .bind(conversation_id)
            .bind(before_seq)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
        }
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
        let is_group = self.is_group_conversation(conversation_id).await?;
        let message_id = Uuid::now_v7();
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin message transaction")?;

        let row = if is_group {
            sqlx::query(
                r"
                INSERT INTO group_messages (
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
                RETURNING message_seq,
                          message_id,
                          conversation_id,
                          sender_account_id,
                          client_message_id,
                          payload_format,
                          body,
                          created_at
                ",
            )
            .bind(message_id)
            .bind(conversation_id)
            .bind(sender_account_id)
            .bind(client_message_id)
            .bind(body)
            .fetch_one(&mut *transaction)
            .await
        } else {
            sqlx::query(
                r"
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
                RETURNING message_seq,
                          message_id,
                          conversation_id,
                          sender_account_id,
                          client_message_id,
                          payload_format,
                          body,
                          created_at
                ",
            )
            .bind(message_id)
            .bind(conversation_id)
            .bind(sender_account_id)
            .bind(client_message_id)
            .bind(body)
            .fetch_one(&mut *transaction)
            .await
        }
        .context("failed to insert message")?;

        let message = row_to_message(row)?;
        if is_group {
            sqlx::query(
                r"
                UPDATE group_conversations
                SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2)
                WHERE conversation_id = $1
                ",
            )
            .bind(conversation_id)
            .bind(message.created_at)
            .execute(&mut *transaction)
            .await
            .context("failed to update group conversation activity")?;
        } else {
            sqlx::query(
                r"
                UPDATE direct_conversations
                SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2)
                WHERE conversation_id = $1
                ",
            )
            .bind(conversation_id)
            .bind(message.created_at)
            .execute(&mut *transaction)
            .await
            .context("failed to update direct conversation activity")?;
        }

        transaction
            .commit()
            .await
            .context("failed to commit message transaction")?;
        Ok(message)
    }

    pub(crate) async fn mark_read(&self, conversation_id: Uuid, actor: Uuid) -> Result<i64> {
        let is_group = self.is_group_conversation(conversation_id).await?;
        let max_seq: i64 = if is_group {
            sqlx::query_scalar(
                r"
                SELECT COALESCE(MAX(message_seq), 0)::BIGINT
                FROM group_messages
                WHERE conversation_id = $1
                ",
            )
            .bind(conversation_id)
            .fetch_one(&self.pool)
            .await
        } else {
            sqlx::query_scalar(
                r"
                SELECT COALESCE(MAX(message_seq), 0)::BIGINT
                FROM messages
                WHERE conversation_id = $1
                ",
            )
            .bind(conversation_id)
            .fetch_one(&self.pool)
            .await
        }
        .context("failed to calculate read position")?;

        if is_group {
            sqlx::query(
                r"
                INSERT INTO group_reads (
                    conversation_id,
                    account_id,
                    last_read_seq,
                    updated_at
                )
                VALUES ($1, $2, $3, now())
                ON CONFLICT (conversation_id, account_id)
                DO UPDATE SET
                    last_read_seq = GREATEST(group_reads.last_read_seq, EXCLUDED.last_read_seq),
                    updated_at = now()
                ",
            )
            .bind(conversation_id)
            .bind(actor)
            .bind(max_seq)
            .execute(&self.pool)
            .await
            .context("failed to update group read position")?;
        } else {
            sqlx::query(
                r"
                INSERT INTO conversation_reads (
                    conversation_id,
                    account_id,
                    last_read_seq,
                    updated_at
                )
                VALUES ($1, $2, $3, now())
                ON CONFLICT (conversation_id, account_id)
                DO UPDATE SET
                    last_read_seq = GREATEST(
                        conversation_reads.last_read_seq,
                        EXCLUDED.last_read_seq
                    ),
                    updated_at = now()
                ",
            )
            .bind(conversation_id)
            .bind(actor)
            .bind(max_seq)
            .execute(&self.pool)
            .await
            .context("failed to update direct read position")?;
        }

        Ok(max_seq)
    }

    pub(crate) async fn create_group(
        &self,
        actor: Uuid,
        name: &str,
        member_account_ids: &[Uuid],
    ) -> Result<GroupRecord> {
        let group_id = Uuid::now_v7();
        let conversation_id = Uuid::now_v7();
        let group_code = public_group_code(group_id);
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin group transaction")?;
        let row = sqlx::query(
            r"
            INSERT INTO group_conversations (
                group_id, conversation_id, group_code, name, owner_account_id
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING created_at
            ",
        )
        .bind(group_id)
        .bind(conversation_id)
        .bind(&group_code)
        .bind(name)
        .bind(actor)
        .fetch_one(&mut *transaction)
        .await
        .context("failed to create group")?;
        let created_at = row.try_get("created_at")?;

        let mut members = Vec::new();
        let mut unique_members = Vec::new();
        unique_members.push(actor);
        for account_id in member_account_ids {
            if *account_id != actor && !unique_members.contains(account_id) {
                unique_members.push(*account_id);
            }
        }
        for account_id in unique_members {
            let role = if account_id == actor {
                GroupRole::Owner
            } else {
                GroupRole::Member
            };
            let member_row = sqlx::query(
                r"
                INSERT INTO group_members (group_id, account_id, role, added_by)
                VALUES ($1, $2, $3, $4)
                RETURNING joined_at
                ",
            )
            .bind(group_id)
            .bind(account_id)
            .bind(role.as_i16())
            .bind(actor)
            .fetch_one(&mut *transaction)
            .await
            .context("failed to add initial group member")?;
            sqlx::query(
                r"
                INSERT INTO group_reads (conversation_id, account_id, last_read_seq)
                VALUES ($1, $2, 0)
                ON CONFLICT (conversation_id, account_id) DO NOTHING
                ",
            )
            .bind(conversation_id)
            .bind(account_id)
            .execute(&mut *transaction)
            .await
            .context("failed to initialize group read state")?;
            members.push(GroupMemberRecord {
                account_id,
                role,
                joined_at: member_row.try_get("joined_at")?,
            });
        }
        transaction
            .commit()
            .await
            .context("failed to commit group creation")?;
        Ok(GroupRecord {
            group_id,
            conversation_id,
            group_code,
            name: name.to_owned(),
            owner_account_id: actor,
            actor_role: GroupRole::Owner,
            created_at,
            members,
        })
    }

    pub(crate) async fn get_group(
        &self,
        group_id: Uuid,
        actor: Uuid,
    ) -> Result<Option<GroupRecord>> {
        let row = sqlx::query(
            r"
            SELECT g.group_id, g.conversation_id, g.group_code, g.name,
                   g.owner_account_id, g.created_at, actor_member.role AS actor_role
            FROM group_conversations g
            JOIN group_members actor_member
              ON actor_member.group_id = g.group_id AND actor_member.account_id = $2
            WHERE g.group_id = $1 AND g.dissolved_at IS NULL
            ",
        )
        .bind(group_id)
        .bind(actor)
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch group")?;
        let Some(row) = row else {
            return Ok(None);
        };
        let role_value: i16 = row.try_get("actor_role")?;
        let member_rows = sqlx::query(
            r"
            SELECT account_id, role, joined_at
            FROM group_members
            WHERE group_id = $1
            ORDER BY role DESC, joined_at ASC
            ",
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await
        .context("failed to list group members")?;
        let mut members = Vec::with_capacity(member_rows.len());
        for member in member_rows {
            let member_role: i16 = member.try_get("role")?;
            members.push(GroupMemberRecord {
                account_id: member.try_get("account_id")?,
                role: GroupRole::from_i16(member_role)
                    .ok_or_else(|| anyhow!("invalid group role {member_role}"))?,
                joined_at: member.try_get("joined_at")?,
            });
        }
        Ok(Some(GroupRecord {
            group_id: row.try_get("group_id")?,
            conversation_id: row.try_get("conversation_id")?,
            group_code: row.try_get("group_code")?,
            name: row.try_get("name")?,
            owner_account_id: row.try_get("owner_account_id")?,
            actor_role: GroupRole::from_i16(role_value)
                .ok_or_else(|| anyhow!("invalid actor group role {role_value}"))?,
            created_at: row.try_get("created_at")?,
            members,
        }))
    }

    pub(crate) async fn group_member_ids(&self, group_id: Uuid) -> Result<Vec<Uuid>> {
        let rows: Vec<Uuid> = sqlx::query_scalar(
            r"
            SELECT member.account_id
            FROM group_members member
            JOIN group_conversations g ON g.group_id = member.group_id
            WHERE member.group_id = $1
              AND g.dissolved_at IS NULL
            ",
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await
        .context("failed to list group member ids")?;
        Ok(rows)
    }

    pub(crate) async fn lookup_group(
        &self,
        identifier: &str,
        actor: Uuid,
    ) -> Result<Option<GroupDiscoveryRecord>> {
        let row = sqlx::query(
            r"
            SELECT g.group_id,
                   g.conversation_id,
                   g.group_code,
                   g.name,
                   COUNT(members.account_id)::BIGINT AS member_count,
                   actor_member.role AS actor_role,
                   latest_request.status AS join_request_status
            FROM group_conversations g
            JOIN group_members members ON members.group_id = g.group_id
            LEFT JOIN group_members actor_member
              ON actor_member.group_id = g.group_id
             AND actor_member.account_id = $2
            LEFT JOIN LATERAL (
                SELECT request.status
                FROM group_join_requests request
                WHERE request.group_id = g.group_id
                  AND request.applicant_account_id = $2
                ORDER BY request.created_at DESC
                LIMIT 1
            ) latest_request ON TRUE
            WHERE g.dissolved_at IS NULL
              AND (
                    UPPER(g.group_code) = UPPER($1)
                 OR g.group_id::TEXT = LOWER($1)
              )
            GROUP BY g.group_id,
                     g.conversation_id,
                     g.group_code,
                     g.name,
                     actor_member.role,
                     latest_request.status
            ",
        )
        .bind(identifier)
        .bind(actor)
        .fetch_optional(&self.pool)
        .await
        .context("failed to look up group")?;

        row.map(|row| -> Result<GroupDiscoveryRecord> {
            let actor_role = match row.try_get::<Option<i16>, _>("actor_role")? {
                Some(value) => Some(
                    GroupRole::from_i16(value)
                        .ok_or_else(|| anyhow!("invalid actor group role {value}"))?,
                ),
                None => None,
            };
            let join_request_status = match row.try_get::<Option<i16>, _>("join_request_status")? {
                Some(value) => Some(
                    GroupJoinRequestStatus::from_i16(value)
                        .ok_or_else(|| anyhow!("invalid group join request status {value}"))?,
                ),
                None => None,
            };
            Ok(GroupDiscoveryRecord {
                group_id: row.try_get("group_id")?,
                conversation_id: row.try_get("conversation_id")?,
                group_code: row.try_get("group_code")?,
                name: row.try_get("name")?,
                member_count: row.try_get("member_count")?,
                actor_role,
                join_request_status,
            })
        })
        .transpose()
    }

    pub(crate) async fn create_group_join_request(
        &self,
        group_id: Uuid,
        applicant: Uuid,
        message: &str,
    ) -> Result<Option<GroupJoinRequestRecord>> {
        let request_id = Uuid::now_v7();
        let row = sqlx::query(
            r"
            INSERT INTO group_join_requests (
                request_id,
                group_id,
                applicant_account_id,
                message,
                status
            )
            SELECT $1, g.group_id, $2, $3, 0
            FROM group_conversations g
            WHERE g.group_id = $4
              AND g.dissolved_at IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM group_members member
                  WHERE member.group_id = g.group_id
                    AND member.account_id = $2
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM group_join_requests pending
                  WHERE pending.group_id = g.group_id
                    AND pending.applicant_account_id = $2
                    AND pending.status = 0
              )
            RETURNING request_id,
                      group_id,
                      applicant_account_id,
                      message,
                      status,
                      created_at,
                      updated_at
            ",
        )
        .bind(request_id)
        .bind(applicant)
        .bind(message)
        .bind(group_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to create group join request")?;

        row.map(row_to_group_join_request).transpose()
    }

    pub(crate) async fn list_group_join_requests(
        &self,
        group_id: Uuid,
        actor: Uuid,
    ) -> Result<Option<Vec<GroupJoinRequestRecord>>> {
        let role: Option<i16> = sqlx::query_scalar(
            r"
            SELECT member.role
            FROM group_members member
            JOIN group_conversations g ON g.group_id = member.group_id
            WHERE member.group_id = $1
              AND member.account_id = $2
              AND g.dissolved_at IS NULL
            ",
        )
        .bind(group_id)
        .bind(actor)
        .fetch_optional(&self.pool)
        .await
        .context("failed to verify group join-request permission")?;
        let Some(role) = role.and_then(GroupRole::from_i16) else {
            return Ok(None);
        };
        if !matches!(role, GroupRole::Owner | GroupRole::Admin) {
            return Ok(None);
        }

        let rows = sqlx::query(
            r"
            SELECT request_id,
                   group_id,
                   applicant_account_id,
                   message,
                   status,
                   created_at,
                   updated_at
            FROM group_join_requests
            WHERE group_id = $1
              AND status = 0
            ORDER BY created_at ASC
            ",
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await
        .context("failed to list group join requests")?;
        rows.into_iter()
            .map(row_to_group_join_request)
            .collect::<Result<Vec<_>>>()
            .map(Some)
    }

    pub(crate) async fn respond_group_join_request(
        &self,
        group_id: Uuid,
        request_id: Uuid,
        actor: Uuid,
        accepted: bool,
    ) -> Result<Option<Uuid>> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin group join-request transaction")?;
        let permission = sqlx::query(
            r"
            SELECT g.conversation_id, member.role
            FROM group_conversations g
            JOIN group_members member
              ON member.group_id = g.group_id
             AND member.account_id = $2
            WHERE g.group_id = $1
              AND g.dissolved_at IS NULL
            FOR UPDATE OF g
            ",
        )
        .bind(group_id)
        .bind(actor)
        .fetch_optional(&mut *transaction)
        .await
        .context("failed to verify group join-request decision permission")?;
        let Some(permission) = permission else {
            return Ok(None);
        };
        let role = GroupRole::from_i16(permission.try_get("role")?)
            .ok_or_else(|| anyhow!("invalid group role"))?;
        if !matches!(role, GroupRole::Owner | GroupRole::Admin) {
            return Ok(None);
        }
        let conversation_id: Uuid = permission.try_get("conversation_id")?;

        let request = sqlx::query(
            r"
            SELECT applicant_account_id
            FROM group_join_requests
            WHERE request_id = $1
              AND group_id = $2
              AND status = 0
            FOR UPDATE
            ",
        )
        .bind(request_id)
        .bind(group_id)
        .fetch_optional(&mut *transaction)
        .await
        .context("failed to fetch pending group join request")?;
        let Some(request) = request else {
            return Ok(None);
        };
        let applicant: Uuid = request.try_get("applicant_account_id")?;

        if accepted {
            sqlx::query(
                r"
                INSERT INTO group_members (group_id, account_id, role, added_by)
                VALUES ($1, $2, 0, $3)
                ON CONFLICT (group_id, account_id) DO NOTHING
                ",
            )
            .bind(group_id)
            .bind(applicant)
            .bind(actor)
            .execute(&mut *transaction)
            .await
            .context("failed to add approved group applicant")?;
            sqlx::query(
                r"
                INSERT INTO group_reads (conversation_id, account_id, last_read_seq)
                VALUES ($1, $2, 0)
                ON CONFLICT (conversation_id, account_id) DO NOTHING
                ",
            )
            .bind(conversation_id)
            .bind(applicant)
            .execute(&mut *transaction)
            .await
            .context("failed to initialize approved group applicant read state")?;
        }

        sqlx::query(
            r"
            UPDATE group_join_requests
            SET status = $3,
                decided_by = $4,
                updated_at = now()
            WHERE request_id = $1
              AND group_id = $2
              AND status = 0
            ",
        )
        .bind(request_id)
        .bind(group_id)
        .bind(if accepted {
            GroupJoinRequestStatus::Accepted.as_i16()
        } else {
            GroupJoinRequestStatus::Rejected.as_i16()
        })
        .bind(actor)
        .execute(&mut *transaction)
        .await
        .context("failed to update group join request")?;

        transaction
            .commit()
            .await
            .context("failed to commit group join-request decision")?;
        Ok(Some(applicant))
    }

    pub(crate) async fn add_group_member(
        &self,
        group_id: Uuid,
        actor: Uuid,
        target: Uuid,
    ) -> Result<bool> {
        let Some(group) = self.get_group(group_id, actor).await? else {
            return Ok(false);
        };
        let inserted = sqlx::query(
            r"
            INSERT INTO group_members (group_id, account_id, role, added_by)
            VALUES ($1, $2, 0, $3)
            ON CONFLICT (group_id, account_id) DO NOTHING
            ",
        )
        .bind(group_id)
        .bind(target)
        .bind(actor)
        .execute(&self.pool)
        .await
        .context("failed to add group member")?;
        if inserted.rows_affected() == 0 {
            return Ok(false);
        }
        sqlx::query(
            r"
            INSERT INTO group_reads (conversation_id, account_id, last_read_seq)
            VALUES ($1, $2, 0)
            ON CONFLICT (conversation_id, account_id) DO NOTHING
            ",
        )
        .bind(group.conversation_id)
        .bind(target)
        .execute(&self.pool)
        .await
        .context("failed to initialize added member read state")?;
        Ok(true)
    }

    pub(crate) async fn remove_group_member(
        &self,
        group_id: Uuid,
        actor: Uuid,
        target: Uuid,
    ) -> Result<bool> {
        let Some(group) = self.get_group(group_id, actor).await? else {
            return Ok(false);
        };
        if !group.actor_role.can_remove_members() || target == group.owner_account_id {
            return Ok(false);
        }
        let target_role = group
            .members
            .iter()
            .find(|member| member.account_id == target)
            .map(|member| member.role);
        let Some(target_role) = target_role else {
            return Ok(false);
        };
        if group.actor_role == GroupRole::Admin && target_role != GroupRole::Member {
            return Ok(false);
        }
        let removed =
            sqlx::query("DELETE FROM group_members WHERE group_id = $1 AND account_id = $2")
                .bind(group_id)
                .bind(target)
                .execute(&self.pool)
                .await
                .context("failed to remove group member")?;
        Ok(removed.rows_affected() > 0)
    }

    pub(crate) async fn set_group_member_role(
        &self,
        group_id: Uuid,
        actor: Uuid,
        target: Uuid,
        role: GroupRole,
    ) -> Result<bool> {
        let Some(group) = self.get_group(group_id, actor).await? else {
            return Ok(false);
        };
        if group.actor_role != GroupRole::Owner
            || target == group.owner_account_id
            || role == GroupRole::Owner
        {
            return Ok(false);
        }
        let updated = sqlx::query(
            "UPDATE group_members SET role = $3 WHERE group_id = $1 AND account_id = $2",
        )
        .bind(group_id)
        .bind(target)
        .bind(role.as_i16())
        .execute(&self.pool)
        .await
        .context("failed to update group member role")?;
        Ok(updated.rows_affected() > 0)
    }

    pub(crate) async fn dissolve_group(&self, group_id: Uuid, actor: Uuid) -> Result<bool> {
        let updated = sqlx::query(
            r"
            UPDATE group_conversations
            SET dissolved_at = now()
            WHERE group_id = $1
              AND owner_account_id = $2
              AND dissolved_at IS NULL
            ",
        )
        .bind(group_id)
        .bind(actor)
        .execute(&self.pool)
        .await
        .context("failed to dissolve group")?;
        Ok(updated.rows_affected() > 0)
    }

    async fn is_group_conversation(&self, conversation_id: Uuid) -> Result<bool> {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM group_conversations WHERE conversation_id = $1 AND dissolved_at IS NULL)",
        )
        .bind(conversation_id)
        .fetch_one(&self.pool)
        .await
        .context("failed to identify conversation kind")
    }
}

fn row_to_group_join_request(row: sqlx::postgres::PgRow) -> Result<GroupJoinRequestRecord> {
    let status_value: i16 = row.try_get("status")?;
    Ok(GroupJoinRequestRecord {
        request_id: row.try_get("request_id")?,
        group_id: row.try_get("group_id")?,
        applicant_account_id: row.try_get("applicant_account_id")?,
        message: row.try_get("message")?,
        status: GroupJoinRequestStatus::from_i16(status_value)
            .ok_or_else(|| anyhow!("invalid group join request status {status_value}"))?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn public_group_code(group_id: Uuid) -> String {
    let compact = group_id.simple().to_string().to_ascii_uppercase();
    format!("G{}", &compact[..12])
}

fn optional_message(
    row: &sqlx::postgres::PgRow,
    conversation_id: Uuid,
) -> Result<Option<MessageRecord>> {
    let message_id: Option<Uuid> = row.try_get("last_message_id")?;
    match message_id {
        Some(message_id) => Ok(Some(MessageRecord {
            message_seq: row.try_get("last_message_seq")?,
            message_id,
            conversation_id,
            sender_account_id: row.try_get("last_sender_account_id")?,
            client_message_id: row.try_get("last_client_message_id")?,
            payload_format: row.try_get("last_payload_format")?,
            body: row.try_get("last_body")?,
            created_at: row.try_get("last_created_at")?,
        })),
        None => Ok(None),
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

#[derive(Clone)]
pub(crate) struct ContactVerifier {
    client: reqwest::Client,
    base_url: String,
    internal_token: String,
}

#[derive(Deserialize)]
struct ContactCheckWire {
    are_contacts: bool,
}

impl ContactVerifier {
    pub(crate) fn connect_from_env() -> Result<Self> {
        let address = chat_foundation_config::required("ACCOUNT_SERVICE_ADDR")
            .context("ACCOUNT_SERVICE_ADDR is required")?;
        let internal_token = chat_foundation_config::required("CHAT_INTERNAL_SERVICE_TOKEN")
            .context("CHAT_INTERNAL_SERVICE_TOKEN is required")?;
        if internal_token.trim().is_empty() {
            bail!("CHAT_INTERNAL_SERVICE_TOKEN must not be empty");
        }
        Ok(Self {
            client: reqwest::Client::new(),
            base_url: local_http_base(&address)?,
            internal_token,
        })
    }

    pub(crate) async fn are_contacts(&self, left: Uuid, right: Uuid) -> Result<bool> {
        let response = self
            .client
            .get(format!(
                "{}/v1/internal/contacts/{left}/{right}",
                self.base_url
            ))
            .header("x-chat-internal-token", &self.internal_token)
            .send()
            .await
            .context("failed to reach account-service contact check")?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("account-service contact check returned HTTP {status}: {body}");
        }
        Ok(response
            .json::<ContactCheckWire>()
            .await
            .context("invalid account-service contact response")?
            .are_contacts)
    }
}

fn local_http_base(address: &str) -> Result<String> {
    let address = address.trim().trim_end_matches('/');
    if address.is_empty() {
        bail!("ACCOUNT_SERVICE_ADDR is empty");
    }
    if address.starts_with("http://") || address.starts_with("https://") {
        return Ok(address.to_owned());
    }
    Ok(format!("http://{address}"))
}
