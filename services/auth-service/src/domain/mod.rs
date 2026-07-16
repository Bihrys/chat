//! Authentication domain records.

use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub(crate) struct Account {
    pub(crate) account_id: Uuid,
    pub(crate) username: String,
    pub(crate) display_name: String,
    pub(crate) chat_id: String,
    pub(crate) avatar_data_url: Option<String>,
    pub(crate) created_at: OffsetDateTime,
}

#[derive(Clone)]
pub(crate) struct Registration {
    pub(crate) username: String,
    pub(crate) username_normalized: String,
    pub(crate) display_name: String,
    pub(crate) password: String,
}

#[derive(Clone, Debug)]
pub(crate) struct LoginIdentity {
    pub(crate) account: Account,
    pub(crate) password_hash: String,
}
