//! chat-platform-api.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod background;
pub mod biometrics;
pub mod clipboard;
pub mod filesystem;
pub mod notification;
#[path = "secure-keystore/mod.rs"]
pub mod secure_keystore;
