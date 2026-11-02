use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use contract::error::{self as code, ErrorBody, ErrorEnvelope};
use serde_json::Value;

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub details: Value,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self { status, code, message: message.into(), details: Value::Null }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = details;
        self
    }

    pub fn unauthenticated() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, code::UNAUTHENTICATED, "authentication required")
    }

    pub fn forbidden(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, code, message)
    }

    pub fn not_found(what: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, code::NOT_FOUND, format!("{} not found", what.into()))
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, code::VALIDATION, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        let m = message.into();
        tracing::error!(error = %m, "internal error");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, code::INTERNAL, "internal error")
    }

    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, message)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!(error = %e, "database error");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, code::INTERNAL, "internal error")
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = ErrorEnvelope {
            error: ErrorBody { code: self.code.to_string(), message: self.message, details: self.details },
        };
        (self.status, Json(body)).into_response()
    }
}
