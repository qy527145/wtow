use std::sync::Arc;

use sqlx::PgPool;

use crate::config::Config;

/// 传给 handler 的共享状态。只放廉价可克隆的东西（Arc / 连接池）。
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub server_version: Arc<str>,
}

impl AppState {
    pub fn new(db: PgPool, config: Arc<Config>) -> Self {
        Self {
            db,
            config,
            server_version: env!("CARGO_PKG_VERSION").into(),
        }
    }
}
