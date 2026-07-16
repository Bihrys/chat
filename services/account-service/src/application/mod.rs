//! Account, exact lookup, friend-request, and contact validation rules.

use chat_server_core::ApiError;

const USERNAME_MIN: usize = 3;
const USERNAME_MAX: usize = 32;
const DISPLAY_NAME_MAX: usize = 64;
const FRIEND_REQUEST_MESSAGE_MAX: usize = 240;

pub(crate) fn validate_internal_account(
    username: &str,
    username_normalized: &str,
    display_name: &str,
) -> Result<(), ApiError> {
    if !(USERNAME_MIN..=USERNAME_MAX).contains(&username.len())
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        || username.to_ascii_lowercase() != username_normalized
    {
        return Err(ApiError::bad_request(
            "invalid_username",
            "invalid account-service username contract",
        ));
    }
    validate_display_name(display_name)
}

pub(crate) fn validate_display_name(display_name: &str) -> Result<(), ApiError> {
    let display_name = display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > DISPLAY_NAME_MAX {
        return Err(ApiError::bad_request(
            "invalid_display_name",
            format!("display name must contain 1-{DISPLAY_NAME_MAX} characters"),
        ));
    }
    Ok(())
}

pub(crate) fn validate_lookup_identifier(identifier: &str) -> Result<String, ApiError> {
    let identifier = identifier.trim();
    if identifier.is_empty() || identifier.len() > 64 {
        return Err(ApiError::bad_request(
            "invalid_identifier",
            "enter an exact chat ID or account UUID",
        ));
    }
    Ok(identifier.to_owned())
}

pub(crate) fn validate_friend_request_message(message: &str) -> Result<String, ApiError> {
    let message = message.trim();
    let length = message.chars().count();
    if length == 0 || length > FRIEND_REQUEST_MESSAGE_MAX {
        return Err(ApiError::bad_request(
            "invalid_friend_request_message",
            format!(
                "friend request message must contain 1-{FRIEND_REQUEST_MESSAGE_MAX} characters"
            ),
        ));
    }
    Ok(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{validate_friend_request_message, validate_internal_account};

    #[test]
    fn validates_internal_account_contract() {
        assert!(validate_internal_account("Alice_01", "alice_01", "Alice").is_ok());
        assert!(validate_internal_account("Alice-01", "alice-01", "Alice").is_err());
    }

    #[test]
    fn validates_friend_request_message() {
        assert!(validate_friend_request_message("Hi, I am Alice").is_ok());
        assert!(validate_friend_request_message("   ").is_err());
    }
}
