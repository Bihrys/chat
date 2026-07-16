//! Domain records for the first direct-message vertical slice.

use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub(crate) struct ConversationRecord {
    pub(crate) conversation_id: Uuid,
    pub(crate) peer_account_id: Uuid,
    pub(crate) created_at: OffsetDateTime,
    pub(crate) last_message_at: Option<OffsetDateTime>,
    pub(crate) unread_count: i64,
    pub(crate) last_message: Option<MessageRecord>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct MessageRecord {
    pub(crate) message_seq: i64,
    pub(crate) message_id: Uuid,
    pub(crate) conversation_id: Uuid,
    pub(crate) sender_account_id: Uuid,
    pub(crate) client_message_id: Uuid,
    pub(crate) payload_format: i16,
    pub(crate) body: String,
    #[serde(skip)]
    pub(crate) created_at: OffsetDateTime,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub(crate) enum ServerEvent {
    Connected {
        account_id: Uuid,
    },
    MessageCreated {
        message: MessageWire,
    },
    ConversationRead {
        conversation_id: Uuid,
        account_id: Uuid,
        last_read_seq: i64,
    },
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct MessageWire {
    pub(crate) message_seq: i64,
    pub(crate) message_id: Uuid,
    pub(crate) conversation_id: Uuid,
    pub(crate) sender_account_id: Uuid,
    pub(crate) client_message_id: Uuid,
    pub(crate) payload_format: &'static str,
    pub(crate) body: String,
    pub(crate) created_at: String,
}
