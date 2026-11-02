use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{Duration, Utc};
use contract::dto::{ActorType, CreateTokenReq, CreatedToken, Role, Token, WhoAmI};
use contract::error as code;
use sqlx::Row;

use crate::app::AppState;
use crate::auth::{parse_role, parse_roles, random_hex, roles_to_strings, sha256, ProjectCtx, RoleSet, PAT_PREFIX};
use crate::error::{AppError, AppResult};

fn token_from_row(row: &sqlx::postgres::PgRow) -> Token {
    let actor: String = row.get("actor_type");
    Token {
        id: row.get("id"),
        name: row.get("name"),
        prefix: row.get("token_prefix"),
        roles: parse_roles(row.get("roles")),
        read_only: row.get("read_only"),
        actor_type: if actor == "human" { ActorType::Human } else { ActorType::Agent },
        revoked: row.get("revoked"),
        user_id: row.get("user_id"),
        owner: row.get("owner"),
        last_used_at: row.get("last_used_at"),
        expires_at: row.get("expires_at"),
        created_at: row.get("created_at"),
    }
}

const TOKEN_COLS: &str = "t.id, t.name, t.token_prefix, t.roles::text[] AS roles, t.read_only,
    t.actor_type::text AS actor_type, t.revoked_at IS NOT NULL AS revoked, t.user_id,
    (SELECT COALESCE(NULLIF(u.display_name, ''), u.email) FROM users u WHERE u.id = t.user_id) AS owner,
    t.last_used_at, t.expires_at, t.created_at";

/// 令牌是个人的：成员只看得到自己的，admin 看全部。
pub async fn list(State(st): State<AppState>, ctx: ProjectCtx) -> AppResult<Json<Vec<Token>>> {
    let only_user = (!ctx.roles.has(Role::Admin)).then_some(ctx.user_id);
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {TOKEN_COLS} FROM api_tokens t
          WHERE t.project_id = $1 AND ($2::bigint IS NULL OR t.user_id = $2)
          ORDER BY t.id"
    )))
    .bind(ctx.project_id)
    .bind(only_user)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(rows.iter().map(token_from_row).collect()))
}

pub async fn create(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Json(req): Json<CreateTokenReq>,
) -> AppResult<(StatusCode, Json<CreatedToken>)> {
    // 任何成员都能给自己签令牌，角色上限由下面的子集校验保证。
    ctx.require_write()?;
    if req.name.trim().is_empty() {
        return Err(AppError::validation("name is required"));
    }
    if req.roles.is_empty() {
        return Err(AppError::validation("roles must not be empty"));
    }
    if let Some(d) = req.expires_in_days {
        if d <= 0 {
            return Err(AppError::validation("expires_in_days must be positive"));
        }
    }
    let roles = roles_to_strings(&req.roles);

    // 令牌角色必须是成员当前角色的子集，admin 隐含全部角色。
    let member_roles: Vec<String> = sqlx::query_scalar(
        "SELECT roles::text[] FROM memberships WHERE project_id = $1 AND user_id = $2",
    )
    .bind(ctx.project_id)
    .bind(ctx.user_id)
    .fetch_optional(&st.db)
    .await?
    .ok_or_else(|| AppError::not_found("membership"))?;
    let held = RoleSet::new(parse_roles(member_roles));
    let missing: Vec<&String> =
        roles.iter().filter(|r| !parse_role(r).map(|r| held.has(r)).unwrap_or(false)).collect();
    if !missing.is_empty() {
        return Err(AppError::forbidden(
            code::FORBIDDEN_ROLE,
            format!("token roles must be a subset of your roles; not held: {missing:?}"),
        ));
    }

    let secret = format!("{PAT_PREFIX}{}", random_hex(32));
    let prefix: String = secret.chars().take(PAT_PREFIX.len() + 8).collect();
    let expires_at = req.expires_in_days.map(|d| Utc::now() + Duration::days(d));
    let actor = match req.actor_type {
        ActorType::Human => "human",
        ActorType::Agent => "agent",
    };

    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "WITH t AS (
           INSERT INTO api_tokens
             (project_id, user_id, name, token_hash, token_prefix, roles, read_only, actor_type, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6::project_role[], $7, $8::actor_type, $9)
           RETURNING *)
         SELECT {TOKEN_COLS} FROM t"
    )))
    .bind(ctx.project_id)
    .bind(ctx.user_id)
    .bind(req.name.trim())
    .bind(sha256(&secret))
    .bind(&prefix)
    .bind(&roles)
    .bind(req.read_only)
    .bind(actor)
    .bind(expires_at)
    .fetch_one(&st.db)
    .await?;

    Ok((StatusCode::CREATED, Json(CreatedToken { token: token_from_row(&row), secret })))
}

pub async fn revoke(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, i64)>,
) -> AppResult<StatusCode> {
    ctx.require_write()?;
    let only_user = (!ctx.roles.has(Role::Admin)).then_some(ctx.user_id);
    let n = sqlx::query(
        "UPDATE api_tokens SET revoked_at = now()
          WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL
            AND ($3::bigint IS NULL OR user_id = $3)",
    )
    .bind(id)
    .bind(ctx.project_id)
    .bind(only_user)
    .execute(&st.db)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::not_found("token"));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn whoami(State(st): State<AppState>, ctx: ProjectCtx) -> AppResult<Json<WhoAmI>> {
    let row = sqlx::query("SELECT email FROM users WHERE id = $1")
        .bind(ctx.user_id)
        .fetch_one(&st.db)
        .await?;
    Ok(Json(WhoAmI {
        id: ctx.user_id,
        email: row.get("email"),
        project: ctx.slug,
        roles: ctx.roles.to_vec(),
        actor_type: ctx.actor_type,
        read_only: ctx.read_only,
    }))
}
