//! chat-protocol-object.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod descriptor;
pub mod manifest;
#[path = "secure-object/mod.rs"]
pub mod secure_object;
pub mod serialization;
