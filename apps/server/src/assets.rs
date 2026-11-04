use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

/// 前端构建产物，release 编译期嵌入二进制。
/// 目录不存在时（未先构建前端）为空，服务端仍可编译，访问页面时提示先构建。
#[derive(Embed)]
#[folder = "$CARGO_MANIFEST_DIR/../web/dist/"]
#[allow_missing = true]
struct Dist;

/// 未命中 API / 下载链路的请求交给 SPA：有对应静态文件就返回文件，否则回退 index.html 交给前端路由。
pub async fn spa(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    // `/api/v1/*` 由 api 模块的 fallback 返回 JSON 404；这里兜住其它版本前缀。
    if path.starts_with("api/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(file) = (!path.is_empty()).then(|| Dist::get(path)).flatten() {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        // Vite 产出的文件名带内容哈希，可以长期缓存；其余每次校验。
        let cache = if path.starts_with("assets/") {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        };
        return (
            [
                (header::CONTENT_TYPE, mime.as_ref()),
                (header::CACHE_CONTROL, cache),
            ],
            file.data,
        )
            .into_response();
    }
    if looks_like_file(path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match Dist::get("index.html") {
        Some(index) => (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            index.data,
        )
            .into_response(),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "web UI not built: run `bun run build:web`, then rebuild the server\n",
        )
            .into_response(),
    }
}

/// 带扩展名的路径视为静态资源（缺失即 404）；否则视为 SPA 路由。
fn looks_like_file(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|name| name.contains('.'))
}

#[cfg(test)]
mod tests {
    use super::looks_like_file;

    #[test]
    fn detects_static_paths() {
        assert!(looks_like_file("assets/app.js"));
        assert!(looks_like_file("favicon.ico"));
        assert!(!looks_like_file("p/demo/raw"));
        assert!(!looks_like_file(""));
    }
}
