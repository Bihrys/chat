//! chat-storage-client.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod attachments;
pub mod cache;
pub mod drafts;
pub mod identity;
pub mod messages;
pub mod search;
#[path = "security-events/mod.rs"]
pub mod security_events;
pub mod sessions;
