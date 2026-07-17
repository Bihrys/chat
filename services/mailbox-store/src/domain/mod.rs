//! Direct and group conversation domain records for local development.

use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ConversationKind {
    Direct,
    Group,
}

impl ConversationKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Group => "group",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GroupRole {
    Member,
    Admin,
    Owner,
}

impl GroupRole {
    pub(crate) fn from_i16(value: i16) -> Option<Self> {
        match value {
            0 => Some(Self::Member),
            1 => Some(Self::Admin),
            2 => Some(Self::Owner),
            _ => None,
        }
    }

    pub(crate) const fn as_i16(self) -> i16 {
        match self {
            Self::Member => 0,
            Self::Admin => 1,
            Self::Owner => 2,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Member => "member",
            Self::Admin => "admin",
            Self::Owner => "owner",
        }
    }

    pub(crate) const fn can_remove_members(self) -> bool {
        matches!(self, Self::Admin | Self::Owner)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ConversationRecord {
    pub(crate) conversation_id: Uuid,
    pub(crate) kind: ConversationKind,
    pub(crate) peer_account_id: Option<Uuid>,
    pub(crate) group_id: Option<Uuid>,
    pub(crate) group_code: Option<String>,
    pub(crate) group_name: Option<String>,
    pub(crate) group_role: Option<GroupRole>,
    pub(crate) member_count: Option<i64>,
    pub(crate) created_at: OffsetDateTime,
    pub(crate) last_message_at: Option<OffsetDateTime>,
    pub(crate) unread_count: i64,
    pub(crate) is_pinned: bool,
    pub(crate) is_muted: bool,
    pub(crate) last_message: Option<MessageRecord>,
}

#[derive(Clone, Debug)]
pub(crate) struct CommonGroupRecord {
    pub(crate) group_id: Uuid,
    pub(crate) conversation_id: Uuid,
    pub(crate) group_code: String,
    pub(crate) name: String,
}

#[derive(Clone, Debug)]
pub(crate) struct GroupMemberRecord {
    pub(crate) account_id: Uuid,
    pub(crate) role: GroupRole,
    pub(crate) joined_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub(crate) struct GroupRecord {
    pub(crate) group_id: Uuid,
    pub(crate) conversation_id: Uuid,
    pub(crate) group_code: String,
    pub(crate) name: String,
    pub(crate) owner_account_id: Uuid,
    pub(crate) actor_role: GroupRole,
    pub(crate) created_at: OffsetDateTime,
    pub(crate) members: Vec<GroupMemberRecord>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GroupJoinRequestStatus {
    Pending,
    Accepted,
    Rejected,
}

impl GroupJoinRequestStatus {
    pub(crate) const fn from_i16(value: i16) -> Option<Self> {
        match value {
            0 => Some(Self::Pending),
            1 => Some(Self::Accepted),
            2 => Some(Self::Rejected),
            _ => None,
        }
    }

    pub(crate) const fn as_i16(self) -> i16 {
        match self {
            Self::Pending => 0,
            Self::Accepted => 1,
            Self::Rejected => 2,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct GroupDiscoveryRecord {
    pub(crate) group_id: Uuid,
    pub(crate) conversation_id: Uuid,
    pub(crate) group_code: String,
    pub(crate) name: String,
    pub(crate) member_count: i64,
    pub(crate) actor_role: Option<GroupRole>,
    pub(crate) join_request_status: Option<GroupJoinRequestStatus>,
}

#[derive(Clone, Debug)]
pub(crate) struct GroupJoinRequestRecord {
    pub(crate) request_id: Uuid,
    pub(crate) group_id: Uuid,
    pub(crate) applicant_account_id: Uuid,
    pub(crate) message: String,
    pub(crate) status: GroupJoinRequestStatus,
    pub(crate) created_at: OffsetDateTime,
    pub(crate) updated_at: OffsetDateTime,
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
    GroupUpdated {
        group_id: Uuid,
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
