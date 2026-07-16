//! Messaging application rules.

use chat_server_core::ApiError;
use uuid::Uuid;

const MAX_MESSAGE_CHARS: usize = 10_000;

pub(crate) fn canonical_pair(left: Uuid, right: Uuid) -> Result<(Uuid, Uuid), ApiError> {
    if left == right {
        return Err(ApiError::bad_request(
            "self_conversation_not_allowed",
            "cannot create a direct conversation with the same account",
        ));
    }

    if left.as_bytes() <= right.as_bytes() {
        Ok((left, right))
    } else {
        Ok((right, left))
    }
}

pub(crate) fn validate_message_body(body: &str) -> Result<String, ApiError> {
    let body = body.trim();
    let length = body.chars().count();
    if length == 0 {
        return Err(ApiError::bad_request(
            "empty_message",
            "message body cannot be empty",
        ));
    }
    if length > MAX_MESSAGE_CHARS {
        return Err(ApiError::bad_request(
            "message_too_large",
            format!("text messages are limited to {MAX_MESSAGE_CHARS} characters"),
        ));
    }
    Ok(body.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{canonical_pair, validate_message_body};
    use uuid::Uuid;

    #[test]
    fn canonical_pair_is_order_independent() {
        let first = Uuid::from_u128(1);
        let second = Uuid::from_u128(2);
        assert_eq!(
            canonical_pair(first, second).ok(),
            canonical_pair(second, first).ok()
        );
    }

    #[test]
    fn canonical_pair_rejects_self_conversations() {
        let account = Uuid::from_u128(1);
        assert!(canonical_pair(account, account).is_err());
    }

    #[test]
    fn message_validation_trims_whitespace() {
        assert_eq!(
            validate_message_body("  hello  ").ok().as_deref(),
            Some("hello")
        );
        assert!(validate_message_body("   ").is_err());
    }
}
