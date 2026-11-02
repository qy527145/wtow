use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

/// 构建时打包 web/dist；目录不存在时（未先构建前端）为空，见 DESIGN 4。
#[derive(RustEmbed)]
#[folder = "web/dist/"]
#[allow_missing = true]
struct Dist;

/// 未命中 API / 下载链路的请求交给 SPA：有对应静态文件就返回文件，否则回退 index.html 交给前端路由。
pub async fn spa(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.starts_with("api/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(file) = (!path.is_empty()).then(|| Dist::get(path)).flatten() {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        // 文件名带内容哈希，可以长期缓存。
        let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
        return ([(header::CONTENT_TYPE, mime.as_ref()), (header::CACHE_CONTROL, cache)], file.data).into_response();
    }
    match Dist::get("index.html") {
        Some(index) => (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-cache")],
            index.data,
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            "web UI not built: run `bun run web:build`, then rebuild the server",
        )
            .into_response(),
    }
}
