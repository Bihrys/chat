//! chat-storage-server.

#![forbid(unsafe_op_in_unsafe_fn)]

#[path = "object-store/mod.rs"]
pub mod object_store;
pub mod postgres;
pub mod redis;
pub mod repositories;
