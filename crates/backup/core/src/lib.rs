//! chat-backup-core.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod archive;
pub mod encryption;
pub mod migration;
#[path = "recovery-key/mod.rs"]
pub mod recovery_key;
pub mod restore;
