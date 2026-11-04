use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

use crate::api;
use crate::api::dist;
use crate::assets;
use crate::state::AppState;

/// 根 Router：`/api/v1` 挂业务接口，其余路径是安装脚本、下载页和 SPA。
pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api/v1", api::router(state.clone()))
        .route("/healthz", get(healthz))
        .route("/install.sh", get(dist::install_sh))
        .route("/install.ps1", get(dist::install_ps1))
        .route("/download", get(dist::download_page))
        .route("/dl/{artifact}", get(dist::artifact))
        // 未命中 API 的请求交给 SPA：有对应静态文件就给文件，否则回退 index.html。
        .fallback(assets::spa)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// 给 compose / 反代用的存活探针，故意不碰数据库。
async fn healthz(State(_st): State<AppState>) -> (StatusCode, &'static str) {
    (StatusCode::OK, "ok")
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use sqlx::postgres::PgPoolOptions;
    use tower::ServiceExt;

    use crate::config::Config;
    use crate::state::AppState;

    /// 连接池惰性建立：只测不碰数据库的路由，不需要真的 Postgres。
    fn state() -> AppState {
        let config = Config {
            database_url: "postgres://u:p@127.0.0.1:1/db".to_owned(),
            bind: "127.0.0.1:0".to_owned(),
            public_base_url: "http://example.test".to_owned(),
            attachment_dir: PathBuf::from("./data/attachments"),
            release_dir: PathBuf::from("./data/releases"),
            superadmin_emails: Vec::new(),
            minisign_pubkey: None,
            log_filter: "info".to_owned(),
        };
        let db = PgPoolOptions::new()
            .connect_lazy(&config.database_url)
            .expect("lazy pool");
        AppState::new(db, Arc::new(config))
    }

    async fn get(path: &str) -> (StatusCode, String) {
        let response = super::router(state())
            .oneshot(
                Request::builder()
                    .uri(path)
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("router is infallible");
        let status = response.status();
        let bytes = response
            .into_body()
            .collect()
            .await
            .expect("body collects")
            .to_bytes();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    #[tokio::test]
    async fn healthz_is_ok() {
        assert_eq!(get("/healthz").await, (StatusCode::OK, "ok".to_owned()));
    }

    #[tokio::test]
    async fn meta_reports_versions() {
        let (status, body) = get("/api/v1/meta").await;
        assert_eq!(status, StatusCode::OK);
        let json: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(json["api_version"], 1);
    }

    #[tokio::test]
    async fn unknown_api_is_json_404() {
        let (status, body) = get("/api/v1/nope").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let json: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(json["error"]["code"], "NOT_FOUND");
    }

    #[tokio::test]
    async fn install_script_uses_configured_base_url() {
        let (status, body) = get("/install.sh").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("http://example.test"));
    }
}
