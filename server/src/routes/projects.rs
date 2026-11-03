use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use contract::dto::{CreateProjectReq, Project, UpdateProjectReq};
use contract::error as code;
use sqlx::Row;

use crate::app::AppState;
use crate::auth::{parse_roles, ProjectCtx, UserCtx};
use crate::error::{AppError, AppResult};

fn project_from_row(row: &sqlx::postgres::PgRow) -> Project {
    Project {
        slug: row.get("slug"),
        name: row.get("name"),
        description: row.get("description"),
        require_human_triage: row.get("require_human_triage"),
        archived: row.get("archived"),
        my_roles: parse_roles(row.get::<Vec<String>, _>("my_roles")),
    }
}

pub async fn list(
    State(st): State<AppState>,
    user: UserCtx,
) -> AppResult<Json<Vec<Project>>> {
    let rows = sqlx::query(
        "SELECT p.slug, p.name, p.description, p.require_human_triage,
                p.archived_at IS NOT NULL AS archived,
                CASE WHEN $2 THEN ARRAY['admin'] ELSE COALESCE(m.roles::text[], '{}') END AS my_roles
           FROM projects p
           LEFT JOIN memberships m ON m.project_id = p.id AND m.user_id = $1
          WHERE m.user_id IS NOT NULL OR $2
          ORDER BY p.slug",
    )
    .bind(user.user_id)
    .bind(user.is_superadmin)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(rows.iter().map(project_from_row).collect()))
}

pub async fn create(
    State(st): State<AppState>,
    user: UserCtx,
    Json(req): Json<CreateProjectReq>,
) -> AppResult<(StatusCode, Json<Project>)> {
    let slug = req.slug.trim().to_lowercase();
    let valid = !slug.is_empty()
        && slug.len() <= 64
        && slug.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if !valid {
        return Err(AppError::validation(
            "slug must be <=64 chars, start alphanumeric, and contain only [a-z0-9_-]",
        ));
    }
    if req.name.trim().is_empty() {
        return Err(AppError::validation("name is required"));
    }

    let mut tx = st.db.begin().await?;
    let row = sqlx::query(
        "INSERT INTO projects (slug, name, description, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id, slug, name, description, require_human_triage,
                   archived_at IS NOT NULL AS archived",
    )
    .bind(&slug)
    .bind(req.name.trim())
    .bind(req.description.trim())
    .bind(user.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::conflict(code::SLUG_TAKEN, format!("slug {slug} is taken")))?;

    sqlx::query(
        "INSERT INTO memberships (project_id, user_id, roles) VALUES ($1, $2, ARRAY['admin']::project_role[])",
    )
    .bind(row.get::<i64, _>("id"))
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let project = Project {
        slug: row.get("slug"),
        name: row.get("name"),
        description: row.get("description"),
        require_human_triage: row.get("require_human_triage"),
        archived: row.get("archived"),
        my_roles: vec![contract::dto::Role::Admin],
    };
    Ok((StatusCode::CREATED, Json(project)))
}

/// 归档项目仍可读，写操作在各自 handler 里拦截。
/// my_roles 返回本次请求的生效角色（令牌取交集、超管按 admin），前端据此决定显示哪些操作。
pub async fn get(State(st): State<AppState>, ctx: ProjectCtx) -> AppResult<Json<Project>> {
    let row = sqlx::query(
        "SELECT slug, name, description, require_human_triage, archived_at IS NOT NULL AS archived
           FROM projects WHERE id = $1",
    )
    .bind(ctx.project_id)
    .fetch_one(&st.db)
    .await?;
    Ok(Json(Project {
        slug: row.get("slug"),
        name: row.get("name"),
        description: row.get("description"),
        require_human_triage: row.get("require_human_triage"),
        archived: row.get("archived"),
        my_roles: ctx.roles.to_vec(),
    }))
}

pub async fn update(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Json(req): Json<UpdateProjectReq>,
) -> AppResult<Json<Project>> {
    ctx.require(contract::dto::Role::Admin)?;
    ctx.require_write()?;
    // 归档后只允许取消归档，其他字段冻结。
    let unarchive_only = req.archived == Some(false)
        && req.name.is_none()
        && req.description.is_none()
        && req.require_human_triage.is_none();
    if ctx.archived && !unarchive_only {
        return Err(AppError::conflict(code::VALIDATION, "project is archived"));
    }
    if req.name.as_deref().is_some_and(|n| n.trim().is_empty()) {
        return Err(AppError::validation("name is required"));
    }
    sqlx::query(
        "UPDATE projects SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            require_human_triage = COALESCE($4, require_human_triage),
            archived_at = CASE WHEN $5::bool IS NULL THEN archived_at
                               WHEN $5 THEN now() ELSE NULL END
          WHERE id = $1",
    )
    .bind(ctx.project_id)
    .bind(req.name.as_deref().map(str::trim))
    .bind(req.description.as_deref().map(str::trim))
    .bind(req.require_human_triage)
    .bind(req.archived)
    .execute(&st.db)
    .await?;
    get(State(st), ctx).await
}
