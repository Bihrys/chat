//! Messaging and group-management application rules.

use chat_server_core::ApiError;
use uuid::Uuid;

const MAX_MESSAGE_CHARS: usize = 10_000;
const MAX_STRUCTURED_MESSAGE_CHARS: usize = 16_384;
const MAX_GROUP_NAME_CHARS: usize = 64;
const MAX_INITIAL_GROUP_MEMBERS: usize = 100;
const MAX_GROUP_JOIN_MESSAGE_CHARS: usize = 256;

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

pub(crate) fn validate_structured_message_body(body: &str) -> Result<String, ApiError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(ApiError::bad_request(
            "empty_message",
            "structured message body cannot be empty",
        ));
    }
    if body.chars().count() > MAX_STRUCTURED_MESSAGE_CHARS {
        return Err(ApiError::bad_request(
            "message_too_large",
            format!("structured messages are limited to {MAX_STRUCTURED_MESSAGE_CHARS} characters"),
        ));
    }
    serde_json::from_str::<serde_json::Value>(body).map_err(|_| {
        ApiError::bad_request(
            "invalid_structured_message",
            "structured message body must be valid JSON",
        )
    })?;
    Ok(body.to_owned())
}

pub(crate) fn validate_group_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    let length = name.chars().count();
    if length == 0 || length > MAX_GROUP_NAME_CHARS {
        return Err(ApiError::bad_request(
            "invalid_group_name",
            format!("group name must contain 1-{MAX_GROUP_NAME_CHARS} characters"),
        ));
    }
    Ok(name.to_owned())
}

pub(crate) fn validate_group_lookup_identifier(identifier: &str) -> Result<String, ApiError> {
    let identifier = identifier.trim();
    if identifier.is_empty() || identifier.len() > 64 {
        return Err(ApiError::bad_request(
            "invalid_group_identifier",
            "group identifier must be a group code or UUID",
        ));
    }
    Ok(identifier.to_ascii_uppercase())
}

pub(crate) fn validate_group_join_message(message: &str) -> Result<String, ApiError> {
    let message = message.trim();
    let length = message.chars().count();
    if length == 0 || length > MAX_GROUP_JOIN_MESSAGE_CHARS {
        return Err(ApiError::bad_request(
            "invalid_group_join_message",
            format!("group join message must contain 1-{MAX_GROUP_JOIN_MESSAGE_CHARS} characters"),
        ));
    }
    Ok(message.to_owned())
}

pub(crate) fn validate_initial_group_members(members: &[Uuid]) -> Result<(), ApiError> {
    if members.len() > MAX_INITIAL_GROUP_MEMBERS {
        return Err(ApiError::bad_request(
            "too_many_group_members",
            format!("a group can be created with at most {MAX_INITIAL_GROUP_MEMBERS} contacts"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{canonical_pair, validate_group_name, validate_message_body};
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
    fn validates_message_and_group_name() {
        assert_eq!(
            validate_message_body("  hello  ").ok().as_deref(),
            Some("hello")
        );
        assert!(validate_message_body("   ").is_err());
        assert_eq!(
            validate_group_name("  Team  ").ok().as_deref(),
            Some("Team")
        );
    }
}
