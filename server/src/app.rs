use std::sync::Arc;

use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub server_version: Arc<str>,
}

impl AppState {
    pub fn new(db: PgPool) -> Self {
        Self { db, server_version: env!("CARGO_PKG_VERSION").into() }
    }
}

/// WTOW_SUPERADMIN_EMAILS：逗号分隔，这些邮箱注册或服务启动时自动成为超管。
pub fn superadmin_emails() -> Vec<String> {
    std::env::var("WTOW_SUPERADMIN_EMAILS")
        .unwrap_or_default()
        .split(',')
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect()
}
