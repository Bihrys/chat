//! chat-foundation-config.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod environment;
pub mod loader;
pub mod validation;

use std::env;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("required environment variable `{name}` is missing")]
    Missing { name: String },
}

/// Loads the nearest `.env` file when one is available.
pub fn load_dotenv() {
    let _ = dotenvy::dotenv();
}

/// Reads a required environment variable.
///
/// # Errors
///
/// Returns [`ConfigError::Missing`] when the variable is not present.
pub fn required(name: &str) -> Result<String, ConfigError> {
    env::var(name).map_err(|_| ConfigError::Missing {
        name: name.to_owned(),
    })
}

/// Reads an optional environment variable.
#[must_use]
pub fn optional(name: &str) -> Option<String> {
    env::var(name).ok()
}
