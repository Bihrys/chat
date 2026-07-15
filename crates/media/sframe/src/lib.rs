//! chat-media-sframe.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod decrypt;
pub mod encrypt;
#[path = "key-schedule/mod.rs"]
pub mod key_schedule;
