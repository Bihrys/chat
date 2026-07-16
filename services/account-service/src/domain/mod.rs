//! Public account-directory domain types.

use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub(crate) struct Account {
    pub(crate) account_id: Uuid,
    pub(crate) username: String,
    pub(crate) display_name: String,
    pub(crate) created_at: OffsetDateTime,
}
