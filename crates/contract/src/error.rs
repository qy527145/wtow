use serde::{Deserialize, Serialize};

pub const UNAUTHENTICATED: &str = "UNAUTHENTICATED";
pub const FORBIDDEN_ROLE: &str = "FORBIDDEN_ROLE";
pub const TOKEN_READ_ONLY: &str = "TOKEN_READ_ONLY";
pub const PROJECT_MISMATCH: &str = "PROJECT_MISMATCH";
pub const HUMAN_TRIAGE_REQUIRED: &str = "HUMAN_TRIAGE_REQUIRED";
pub const NOT_FOUND: &str = "NOT_FOUND";
pub const VALIDATION: &str = "VALIDATION";
pub const SLUG_TAKEN: &str = "SLUG_TAKEN";
pub const VERSION_CONFLICT: &str = "VERSION_CONFLICT";
pub const INVALID_TRANSITION: &str = "INVALID_TRANSITION";
pub const RAW_ALREADY_CLAIMED: &str = "RAW_ALREADY_CLAIMED";
pub const RAW_NOT_CLAIMED_BY_YOU: &str = "RAW_NOT_CLAIMED_BY_YOU";
pub const RELATED_NOT_CHECKED: &str = "RELATED_NOT_CHECKED";
pub const EXEC_ALREADY_CLAIMED: &str = "EXEC_ALREADY_CLAIMED";
pub const TARGET_CONFLICT: &str = "TARGET_CONFLICT";
pub const IDEMPOTENCY_KEY_REUSED: &str = "IDEMPOTENCY_KEY_REUSED";
pub const IDEMPOTENCY_IN_PROGRESS: &str = "IDEMPOTENCY_IN_PROGRESS";
pub const INTERNAL: &str = "INTERNAL";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub details: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

/// CLI 退出码，见 DESIGN 11.3。
pub fn exit_code_for_status(status: u16) -> i32 {
    match status {
        401 => 2,
        403 => 7,
        404 => 3,
        409 => 4,
        400 | 422 => 6,
        s if s >= 500 => 5,
        _ => 1,
    }
}
