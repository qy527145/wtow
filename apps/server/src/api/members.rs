use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use contract::dto::{Member, Role, UpsertMemberReq, User};
use contract::error as code;
use sqlx::Row;

use crate::auth::{ProjectCtx, parse_roles, roles_to_strings};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub async fn list(State(st): State<AppState>, ctx: ProjectCtx) -> AppResult<Json<Vec<Member>>> {
    let rows = sqlx::query(
        "SELECT u.id AS user_id, u.email, u.display_name, m.roles::text[] AS roles
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.project_id = $1
          ORDER BY u.email",
    )
    .bind(ctx.project_id)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(
        rows.iter()
            .map(|r| Member {
                user_id: r.get("user_id"),
                email: r.get("email"),
                display_name: r.get("display_name"),
                roles: parse_roles(r.get("roles")),
            })
            .collect(),
    ))
}

/// 可添加的候选人：所有已注册但还不在本项目里的用户，仅管理员可见。
pub async fn candidates(State(st): State<AppState>, ctx: ProjectCtx) -> AppResult<Json<Vec<User>>> {
    ctx.require(Role::Admin)?;
    let rows = sqlx::query(
        "SELECT u.id, u.email, u.display_name
           FROM users u
          WHERE NOT EXISTS (
                SELECT 1 FROM memberships m WHERE m.project_id = $1 AND m.user_id = u.id
          )
          ORDER BY u.email",
    )
    .bind(ctx.project_id)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(
        rows.iter()
            .map(|r| User {
                id: r.get("id"),
                email: r.get("email"),
                display_name: r.get("display_name"),
                is_superadmin: false,
            })
            .collect(),
    ))
}

pub async fn upsert(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Json(req): Json<UpsertMemberReq>,
) -> AppResult<(StatusCode, Json<Member>)> {
    ctx.require(Role::Admin)?;
    ctx.require_write()?;
    if req.roles.is_empty() {
        return Err(AppError::validation("roles must not be empty"));
    }
    let roles = roles_to_strings(&req.roles);
    let email = req.email.trim().to_lowercase();

    let user_id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&st.db)
        .await?
        .ok_or_else(|| AppError::not_found(format!("user {email}")))?;

    // 令牌角色必须是成员角色的子集，降权成员时一并收紧其令牌。
    sqlx::query(
        "UPDATE api_tokens SET roles = ARRAY(
             SELECT unnest(roles) INTERSECT SELECT unnest($3::project_role[])
         )::project_role[]
          WHERE project_id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(ctx.project_id)
    .bind(user_id)
    .bind(&roles)
    .execute(&st.db)
    .await?;

    let row = sqlx::query(
        "INSERT INTO memberships (project_id, user_id, roles) VALUES ($1, $2, $3::project_role[])
         ON CONFLICT (project_id, user_id) DO UPDATE SET roles = EXCLUDED.roles
         RETURNING roles::text[] AS roles",
    )
    .bind(ctx.project_id)
    .bind(user_id)
    .bind(&roles)
    .fetch_one(&st.db)
    .await?;

    Ok((
        StatusCode::OK,
        Json(Member {
            user_id,
            email,
            display_name: sqlx::query_scalar("SELECT display_name FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_one(&st.db)
                .await?,
            roles: parse_roles(row.get("roles")),
        }),
    ))
}

pub async fn remove(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, user_id)): Path<(String, i64)>,
) -> AppResult<StatusCode> {
    ctx.require(Role::Admin)?;
    ctx.require_write()?;
    if user_id == ctx.user_id {
        return Err(AppError::conflict(
            code::VALIDATION,
            "cannot remove yourself",
        ));
    }
    let n = sqlx::query("DELETE FROM memberships WHERE project_id = $1 AND user_id = $2")
        .bind(ctx.project_id)
        .bind(user_id)
        .execute(&st.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::not_found("membership"));
    }
    sqlx::query("UPDATE api_tokens SET revoked_at = now() WHERE project_id = $1 AND user_id = $2 AND revoked_at IS NULL")
        .bind(ctx.project_id)
        .bind(user_id)
        .execute(&st.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// 项目成员与候选人。
pub fn router() -> axum::Router<AppState> {
    use axum::routing::{delete, get};
    axum::Router::new()
        .route("/projects/{slug}/members", get(list).put(upsert))
        .route("/projects/{slug}/members/candidates", get(candidates))
        .route("/projects/{slug}/members/{user_id}", delete(remove))
}
