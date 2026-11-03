use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, SameSite};
use axum_extra::extract::CookieJar;
use chrono::{Duration, Utc};
use contract::dto::{LoginReq, RegisterReq, UpdateMeReq, User};
use contract::error as code;
use sqlx::Row;

use crate::app::AppState;
use crate::auth::{hash_password, random_hex, sha256, verify_password, UserCtx, SESSION_COOKIE};
use crate::error::{AppError, AppResult};

pub const SESSION_TTL_DAYS: i64 = 30;

fn session_cookie(sid: String) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, sid))
        .http_only(true)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time::Duration::days(SESSION_TTL_DAYS))
        .build()
}

pub async fn register(
    State(st): State<AppState>,
    Json(req): Json<RegisterReq>,
) -> AppResult<(StatusCode, Json<User>)> {
    if !req.email.contains('@') {
        return Err(AppError::validation("invalid email"));
    }
    if req.password.len() < 8 {
        return Err(AppError::validation("password must be at least 8 characters"));
    }
    let hash = hash_password(&req.password)?;
    let row = sqlx::query(
        "INSERT INTO users (email, display_name, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, display_name",
    )
    .bind(req.email.trim().to_lowercase())
    .bind(req.display_name.trim())
    .bind(hash)
    .fetch_optional(&st.db)
    .await?
    .ok_or_else(|| AppError::conflict(code::VALIDATION, "email already registered"))?;
    Ok((StatusCode::CREATED, Json(User {
        id: row.get("id"),
        email: row.get("email"),
        display_name: row.get("display_name"),
    })))
}

pub async fn login(
    State(st): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginReq>,
) -> AppResult<(CookieJar, Json<User>)> {
    let row = sqlx::query(
        "SELECT id, email, display_name, password_hash FROM users
          WHERE email = $1",
    )
    .bind(req.email.trim().to_lowercase())
    .fetch_optional(&st.db)
    .await?
    .ok_or_else(AppError::unauthenticated)?;
    let hash: String = row.get("password_hash");
    if !verify_password(&req.password, &hash) {
        return Err(AppError::unauthenticated());
    }
    let sid = random_hex(32);
    sqlx::query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)")
        .bind(sha256(&sid))
        .bind(row.get::<i64, _>("id"))
        .bind(Utc::now() + Duration::days(SESSION_TTL_DAYS))
        .execute(&st.db)
        .await?;
    Ok((jar.add(session_cookie(sid)), Json(User {
        id: row.get("id"),
        email: row.get("email"),
        display_name: row.get("display_name"),
    })))
}

pub async fn logout(State(st): State<AppState>, jar: CookieJar) -> AppResult<impl IntoResponse> {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE id = $1")
            .bind(sha256(c.value()))
            .execute(&st.db)
            .await?;
    }
    Ok((jar.remove(Cookie::from(SESSION_COOKIE)), StatusCode::NO_CONTENT))
}

pub async fn me(State(st): State<AppState>, user: UserCtx) -> AppResult<Json<User>> {
    let row = sqlx::query("SELECT id, email, display_name FROM users WHERE id = $1")
        .bind(user.user_id)
        .fetch_optional(&st.db)
        .await?
        .ok_or_else(AppError::unauthenticated)?;
    Ok(Json(User {
        id: row.get("id"),
        email: row.get("email"),
        display_name: row.get("display_name"),
    }))
}

pub async fn update_me(
    State(st): State<AppState>,
    user: UserCtx,
    Json(req): Json<UpdateMeReq>,
) -> AppResult<Json<User>> {
    if user.token.as_ref().is_some_and(|t| t.read_only) {
        return Err(AppError::forbidden(code::TOKEN_READ_ONLY, "token is read-only"));
    }
    let name = req.display_name.trim();
    if name.is_empty() {
        return Err(AppError::validation("display_name must not be empty"));
    }
    if name.chars().count() > 64 {
        return Err(AppError::validation("display_name must be at most 64 characters"));
    }
    let row = sqlx::query("UPDATE users SET display_name = $2 WHERE id = $1 RETURNING id, email, display_name")
        .bind(user.user_id)
        .bind(name)
        .fetch_optional(&st.db)
        .await?
        .ok_or_else(AppError::unauthenticated)?;
    Ok(Json(User {
        id: row.get("id"),
        email: row.get("email"),
        display_name: row.get("display_name"),
    }))
}
