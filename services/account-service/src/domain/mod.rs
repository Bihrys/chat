//! Account directory, exact-match discovery, and social-graph domain types.

use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub(crate) struct Account {
    pub(crate) account_id: Uuid,
    pub(crate) username: String,
    pub(crate) display_name: String,
    pub(crate) chat_id: String,
    pub(crate) avatar_data_url: Option<String>,
    pub(crate) remark_name: Option<String>,
    pub(crate) source: Option<String>,
    pub(crate) tags: Option<String>,
    pub(crate) friend_permission: i16,
    pub(crate) is_starred: bool,
    pub(crate) is_blocked: bool,
    pub(crate) created_at: OffsetDateTime,
}


#[derive(Clone, Debug)]
pub(crate) struct UiPreferences {
    pub(crate) locale: String,
    pub(crate) theme: String,
    pub(crate) font_size_level: i16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FriendRequestStatus {
    Pending,
    Accepted,
    Rejected,
    Cancelled,
}

impl FriendRequestStatus {
    pub(crate) fn from_i16(value: i16) -> Option<Self> {
        match value {
            0 => Some(Self::Pending),
            1 => Some(Self::Accepted),
            2 => Some(Self::Rejected),
            3 => Some(Self::Cancelled),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct FriendRequestRecord {
    pub(crate) request_id: Uuid,
    pub(crate) sender_account_id: Uuid,
    pub(crate) recipient_account_id: Uuid,
    pub(crate) message: String,
    pub(crate) status: FriendRequestStatus,
    pub(crate) created_at: OffsetDateTime,
    pub(crate) updated_at: OffsetDateTime,
    pub(crate) peer: Account,
}

#[derive(Clone, Debug)]
pub(crate) struct FriendRequestMailbox {
    pub(crate) incoming: Vec<FriendRequestRecord>,
    pub(crate) outgoing: Vec<FriendRequestRecord>,
}
