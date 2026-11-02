use std::path::PathBuf;

use axum::extract::Path;
use axum::http::header;
use axum::response::{Html, IntoResponse};

use crate::error::{AppError, AppResult};

const INSTALL_SH: &str = include_str!("../../assets/install.sh");
const DOWNLOAD_HTML: &str = include_str!("../../assets/download.html");

fn release_dir() -> PathBuf {
    std::env::var("WTOW_RELEASE_DIR").unwrap_or_else(|_| "./data/releases".into()).into()
}

fn public_base_url() -> String {
    std::env::var("WTOW_PUBLIC_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8080".into())
        .trim_end_matches('/')
        .to_string()
}

pub async fn install_sh() -> impl IntoResponse {
    let body = INSTALL_SH
        .replace("__WTOW_BASE_URL__", &public_base_url())
        .replace("__WTOW_MINISIGN_PUBKEY__", &std::env::var("WTOW_MINISIGN_PUBKEY").unwrap_or_default());
    ([(header::CONTENT_TYPE, "text/x-shellscript; charset=utf-8")], body)
}

pub async fn download_page() -> Html<String> {
    Html(DOWNLOAD_HTML.replace("__WTOW_BASE_URL__", &public_base_url()))
}

pub async fn artifact(Path(name): Path<String>) -> AppResult<impl IntoResponse> {
    // 只允许平铺文件名，杜绝路径穿越。
    let valid = !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !valid {
        return Err(AppError::not_found(format!("artifact {name}")));
    }
    let data = tokio::fs::read(release_dir().join(&name))
        .await
        .map_err(|_| AppError::not_found(format!("artifact {name}")))?;
    let mime = if name.ends_with(".json") { "application/json" } else { "application/octet-stream" };
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\"")),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        data,
    ))
}
