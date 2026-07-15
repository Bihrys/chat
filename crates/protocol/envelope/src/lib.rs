//! chat-protocol-envelope.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod opaque;
pub mod routing;
#[path = "sender-hiding/mod.rs"]
pub mod sender_hiding;
