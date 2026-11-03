use std::path::PathBuf;

use axum::extract::{Multipart, Path, State};
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use chrono::{Datelike, Utc};
use contract::dto::Attachment;
use sqlx::{Postgres, Row, Transaction};

use crate::app::AppState;
use crate::auth::{random_hex, ProjectCtx};
use crate::error::{AppError, AppResult};

pub const MAX_BYTES: usize = 20 * 1024 * 1024;
const ALLOWED: &[&str] =
    &["image/png", "image/jpeg", "image/gif", "text/plain", "application/json", "application/zip"];

pub fn root() -> PathBuf {
    std::env::var("WTOW_ATTACHMENT_DIR").unwrap_or_else(|_| "./data/attachments".into()).into()
}

fn sniff(data: &[u8]) -> Option<&'static str> {
    if let Some(t) = infer::get(data) {
        return ALLOWED.iter().copied().find(|m| *m == t.mime_type());
    }
    // infer 不识别纯文本，这里按 UTF-8 判断并区分 JSON。
    let s = std::str::from_utf8(data).ok()?;
    if serde_json::from_str::<serde_json::Value>(s).is_ok() {
        Some("application/json")
    } else {
        Some("text/plain")
    }
}

pub async fn upload(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    mut mp: Multipart,
) -> AppResult<(StatusCode, Json<Attachment>)> {
    ctx.require_write()?;
    let field = mp
        .next_field()
        .await
        .map_err(|e| AppError::validation(format!("invalid multipart: {e}")))?
        .ok_or_else(|| AppError::validation("file field is required"))?;
    let filename = field
        .file_name()
        .map(|f| f.rsplit(['/', '\\']).next().unwrap_or(f).to_string())
        .filter(|f| !f.is_empty())
        .unwrap_or_else(|| "file".into());
    let data = field.bytes().await.map_err(|e| AppError::validation(format!("upload failed: {e}")))?;
    if data.is_empty() || data.len() > MAX_BYTES {
        return Err(AppError::validation("file must be 1 byte to 20MB"));
    }
    let mime = sniff(&data).ok_or_else(|| AppError::validation("file type not allowed"))?;

    let id = format!("ATT-{}", random_hex(12));
    let now = Utc::now();
    let key = format!("{}/{:04}/{:02}/{}", ctx.project_id, now.year(), now.month(), random_hex(16));
    let path = root().join(&key);
    tokio::fs::create_dir_all(path.parent().unwrap())
        .await
        .map_err(|e| AppError::internal(format!("mkdir: {e}")))?;
    tokio::fs::write(&path, &data).await.map_err(|e| AppError::internal(format!("write: {e}")))?;

    sqlx::query(
        "INSERT INTO attachments (id, project_id, filename, mime, size_bytes, storage_key, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&id)
    .bind(ctx.project_id)
    .bind(&filename)
    .bind(mime)
    .bind(data.len() as i64)
    .bind(&key)
    .bind(ctx.user_id)
    .execute(&st.db)
    .await?;

    Ok((StatusCode::CREATED, Json(Attachment { id, filename, mime: mime.into(), size_bytes: data.len() as i64, owner_id: None })))
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct DownloadQuery {
    #[serde(default)]
    pub download: bool,
}

/// 图片默认 inline，Web 端正文可以直接显示；`?download=1` 强制下载。
/// 允许上传的类型里没有 HTML / SVG，配合 nosniff，inline 不会执行脚本。
pub async fn download(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    axum::extract::Query(q): axum::extract::Query<DownloadQuery>,
) -> AppResult<impl IntoResponse> {
    let row = sqlx::query("SELECT filename, mime, storage_key FROM attachments WHERE project_id = $1 AND id = $2")
        .bind(ctx.project_id)
        .bind(&id)
        .fetch_optional(&st.db)
        .await?
        .ok_or_else(|| AppError::not_found(format!("file {id}")))?;
    let key: String = row.get("storage_key");
    let data = tokio::fs::read(root().join(key)).await.map_err(|_| AppError::not_found(format!("file {id}")))?;
    let filename: String = row.get("filename");
    let safe: String = filename.chars().filter(|c| c.is_ascii_graphic() && *c != '"' || *c == ' ').collect();
    let mime: String = row.get("mime");
    let disposition = if mime.starts_with("image/") && !q.download { "inline" } else { "attachment" };
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CONTENT_DISPOSITION, format!("{disposition}; filename=\"{safe}\"")),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
            (header::CACHE_CONTROL, "private, max-age=3600".to_string()),
        ],
        data,
    ))
}

/// 按 owner_ids 的顺序列出已绑定的附件。
pub async fn list_owned(
    st: &AppState,
    project_id: i64,
    owner_type: &str,
    owner_ids: &[String],
) -> AppResult<Vec<Attachment>> {
    let rows = sqlx::query(
        "SELECT a.id, a.filename, a.mime, a.size_bytes, a.owner_id
           FROM attachments a JOIN unnest($3::text[]) WITH ORDINALITY o(id, ord) ON o.id = a.owner_id
          WHERE a.project_id = $1 AND a.owner_type = $2::owner_type
          ORDER BY o.ord, a.created_at",
    )
    .bind(project_id)
    .bind(owner_type)
    .bind(owner_ids)
    .fetch_all(&st.db)
    .await?;
    Ok(rows
        .iter()
        .map(|a| Attachment {
            id: a.get("id"),
            filename: a.get("filename"),
            mime: a.get("mime"),
            size_bytes: a.get("size_bytes"),
            owner_id: a.get("owner_id"),
        })
        .collect())
}

/// 把调用者刚上传、尚未绑定的附件绑到作文上。
pub async fn bind(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &ProjectCtx,
    ids: &[String],
    owner_type: &str,
    owner_id: &str,
) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let n = sqlx::query(
        "UPDATE attachments SET owner_type = $3::owner_type, owner_id = $4
          WHERE project_id = $1 AND id = ANY($2) AND owner_id IS NULL AND uploaded_by = $5",
    )
    .bind(ctx.project_id)
    .bind(ids)
    .bind(owner_type)
    .bind(owner_id)
    .bind(ctx.user_id)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if n as usize != ids.len() {
        return Err(AppError::validation("some attachments are missing, already bound, or not yours"));
    }
    Ok(())
}

/// 正文里 `![说明](ATT-xxx)` 引用的附件必须属于给定作文，避免出现 Agent 下载不到的悬空引用。
pub async fn check_refs(
    tx: &mut Transaction<'_, Postgres>,
    project_id: i64,
    text: &str,
    owners: &[(&str, &[String])],
) -> AppResult<()> {
    let refs = contract::refs::attachment_refs(text);
    if refs.is_empty() {
        return Ok(());
    }
    let mut found: Vec<String> = Vec::new();
    for (owner_type, ids) in owners {
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM attachments
              WHERE project_id = $1 AND id = ANY($2) AND owner_type = $3::owner_type AND owner_id = ANY($4)",
        )
        .bind(project_id)
        .bind(&refs)
        .bind(*owner_type)
        .bind(*ids)
        .fetch_all(&mut **tx)
        .await?;
        found.extend(rows);
    }
    let missing: Vec<&String> = refs.iter().filter(|r| !found.contains(r)).collect();
    if !missing.is_empty() {
        return Err(AppError::validation(format!(
            "referenced attachments {missing:?} must be attached to this composition or its sources"
        )));
    }
    Ok(())
}
