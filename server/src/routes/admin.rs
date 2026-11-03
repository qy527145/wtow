//! 超管面板：跨项目查看与操作。项目内的具体操作（成员、令牌、管道）复用项目路由，
//! 超管在 ProjectCtx 里按 admin 计；这里只放项目路由覆盖不到的全局动作。

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use contract::dto::{AdminProject, AdminUpdateUserReq, AdminUser};
use contract::error as code;
use sqlx::Row;

use crate::app::AppState;
use crate::auth::{hash_password, UserCtx};
use crate::error::{AppError, AppResult};
use crate::routes::files;

pub async fn projects(State(st): State<AppState>, user: UserCtx) -> AppResult<Json<Vec<AdminProject>>> {
    user.require_superadmin()?;
    let rows = sqlx::query(
        "SELECT p.slug, p.name, p.description, p.archived_at IS NOT NULL AS archived, p.created_at,
                COALESCE(NULLIF(u.display_name, ''), u.email) AS creator,
                (SELECT count(*) FROM memberships m WHERE m.project_id = p.id) AS member_count,
                r.total AS raw_total, r.pending AS raw_pending,
                e.total AS exec_total, e.open AS exec_open,
                GREATEST(r.last, e.last) AS last_activity_at
           FROM projects p
           JOIN users u ON u.id = p.created_by
          CROSS JOIN LATERAL (
                SELECT count(*) AS total, count(*) FILTER (WHERE status = 'Pending') AS pending,
                       max(updated_at) AS last
                  FROM raw_compositions WHERE project_id = p.id) r
          CROSS JOIN LATERAL (
                SELECT count(*) AS total, count(*) FILTER (WHERE status IN ('Queued','InProgress')) AS open,
                       max(updated_at) AS last
                  FROM exec_compositions WHERE project_id = p.id) e
          ORDER BY p.archived_at IS NOT NULL, p.slug",
    )
    .fetch_all(&st.db)
    .await?;
    Ok(Json(
        rows.iter()
            .map(|r| AdminProject {
                slug: r.get("slug"),
                name: r.get("name"),
                description: r.get("description"),
                archived: r.get("archived"),
                created_at: r.get("created_at"),
                creator: r.get("creator"),
                member_count: r.get("member_count"),
                raw_total: r.get("raw_total"),
                raw_pending: r.get("raw_pending"),
                exec_total: r.get("exec_total"),
                exec_open: r.get("exec_open"),
                last_activity_at: r.get("last_activity_at"),
            })
            .collect(),
    ))
}

/// 彻底删除项目及其全部数据（作文、附件、令牌、审计）。不可恢复，只给超管。
pub async fn delete_project(
    State(st): State<AppState>,
    user: UserCtx,
    Path(slug): Path<String>,
) -> AppResult<StatusCode> {
    user.require_superadmin()?;
    let mut tx = st.db.begin().await?;
    let id: i64 = sqlx::query_scalar("DELETE FROM projects WHERE slug = $1 RETURNING id")
        .bind(&slug)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found(format!("project {slug}")))?;
    // idempotency_keys 没有外键，手动清。
    sqlx::query("DELETE FROM idempotency_keys WHERE project_id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    // 附件按 <project_id>/ 分目录存放；删目录失败只记日志，数据库已是事实来源。
    let dir = files::root().join(id.to_string());
    if let Err(e) = tokio::fs::remove_dir_all(&dir).await {
        if e.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(error = %e, dir = %dir.display(), "remove attachment dir");
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn users(State(st): State<AppState>, user: UserCtx) -> AppResult<Json<Vec<AdminUser>>> {
    user.require_superadmin()?;
    let rows = sqlx::query(
        "SELECT u.id, u.email, u.display_name, u.is_superadmin, u.created_at,
                (SELECT count(*) FROM memberships m WHERE m.user_id = u.id) AS project_count
           FROM users u
          ORDER BY u.email",
    )
    .fetch_all(&st.db)
    .await?;
    Ok(Json(rows.iter().map(admin_user_from_row).collect()))
}

pub async fn update_user(
    State(st): State<AppState>,
    user: UserCtx,
    Path(id): Path<i64>,
    Json(req): Json<AdminUpdateUserReq>,
) -> AppResult<Json<AdminUser>> {
    user.require_superadmin()?;
    // 不允许撤掉自己的超管，避免把最后一个超管锁在门外。
    if id == user.user_id && req.is_superadmin == Some(false) {
        return Err(AppError::conflict(code::VALIDATION, "cannot revoke your own superadmin"));
    }
    let hash = match req.password.as_deref() {
        Some(pw) if pw.len() < 8 => return Err(AppError::validation("password must be at least 8 characters")),
        Some(pw) => Some(hash_password(pw)?),
        None => None,
    };
    let mut tx = st.db.begin().await?;
    let row = sqlx::query(
        "UPDATE users SET
            is_superadmin = COALESCE($2, is_superadmin),
            password_hash = COALESCE($3, password_hash)
          WHERE id = $1
      RETURNING id, email, display_name, is_superadmin, created_at,
                (SELECT count(*) FROM memberships m WHERE m.user_id = users.id) AS project_count",
    )
    .bind(id)
    .bind(req.is_superadmin)
    .bind(&hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found(format!("user {id}")))?;
    if hash.is_some() {
        sqlx::query("DELETE FROM sessions WHERE user_id = $1").bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(admin_user_from_row(&row)))
}

fn admin_user_from_row(r: &sqlx::postgres::PgRow) -> AdminUser {
    AdminUser {
        id: r.get("id"),
        email: r.get("email"),
        display_name: r.get("display_name"),
        is_superadmin: r.get("is_superadmin"),
        project_count: r.get("project_count"),
        created_at: r.get("created_at"),
    }
}
