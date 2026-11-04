use axum::extract::{Path, State};
use axum::http::header;
use axum::response::{Html, IntoResponse};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const INSTALL_SH: &str = include_str!("../../assets/install.sh");
const INSTALL_PS1: &str = include_str!("../../assets/install.ps1");
const DOWNLOAD_HTML: &str = include_str!("../../assets/download.html");

pub async fn install_sh(State(st): State<AppState>) -> impl IntoResponse {
    let body = INSTALL_SH
        .replace("__WTOW_BASE_URL__", &st.config.public_base_url)
        .replace(
            "__WTOW_MINISIGN_PUBKEY__",
            st.config.minisign_pubkey.as_deref().unwrap_or_default(),
        );
    (
        [(header::CONTENT_TYPE, "text/x-shellscript; charset=utf-8")],
        body,
    )
}

pub async fn install_ps1(State(st): State<AppState>) -> impl IntoResponse {
    let body = INSTALL_PS1.replace("__WTOW_BASE_URL__", &st.config.public_base_url);
    ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], body)
}

pub async fn download_page(State(st): State<AppState>) -> Html<String> {
    Html(DOWNLOAD_HTML.replace("__WTOW_BASE_URL__", &st.config.public_base_url))
}

pub async fn artifact(
    State(st): State<AppState>,
    Path(name): Path<String>,
) -> AppResult<impl IntoResponse> {
    // 只允许平铺文件名，杜绝路径穿越。
    let valid = !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !valid {
        return Err(AppError::not_found(format!("artifact {name}")));
    }
    let data = tokio::fs::read(st.config.release_dir.join(&name))
        .await
        .map_err(|_| AppError::not_found(format!("artifact {name}")))?;
    let mime = if name.ends_with(".json") {
        "application/json"
    } else {
        "application/octet-stream"
    };
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{name}\""),
            ),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        data,
    ))
}
