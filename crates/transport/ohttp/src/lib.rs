//! chat-transport-ohttp.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod client;
pub mod encapsulation;
#[path = "gateway-client/mod.rs"]
pub mod gateway_client;
