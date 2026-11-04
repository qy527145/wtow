pub mod admin;
pub mod auth;
pub mod dist;
pub mod exec;
pub mod files;
pub mod members;
pub mod meta;
pub mod projects;
pub mod raw;
pub mod tokens;

use axum::Router;

use crate::error::AppError;
use crate::idempotency;
use crate::state::AppState;

/// `/api/v1` 下的全部路由。新增领域模块：`pub mod foo;` 后在 `merge` 里加一行。
///
/// 幂等层挂在整组接口上（而不是单个路由），这样凡是带 `Idempotency-Key` 的写请求都统一生效。
pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .merge(meta::router())
        .merge(auth::router())
        .merge(admin::router())
        .merge(projects::router())
        .merge(members::router())
        .merge(tokens::router())
        .merge(raw::router())
        .merge(exec::router())
        .merge(files::router())
        .route_layer(axum::middleware::from_fn_with_state(
            state,
            idempotency::layer,
        ))
        // 未匹配的 `/api/*` 走 JSON 404，而不是掉进 SPA fallback 返回 HTML。
        .fallback(unknown_api)
}

async fn unknown_api() -> AppError {
    AppError::not_found("endpoint")
}
