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
