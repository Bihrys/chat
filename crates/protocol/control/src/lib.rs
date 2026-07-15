//! chat-protocol-control.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod device;
pub mod group;
pub mod receipts;
pub mod security;
#[path = "strong-mode/mod.rs"]
pub mod strong_mode;
