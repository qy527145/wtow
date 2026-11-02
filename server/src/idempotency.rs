use axum::body::{to_bytes, Body};
use axum::extract::{FromRequestParts, RawPathParams, Request, State};
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use contract::error as code;
use sqlx::Row;

use crate::app::AppState;
use crate::auth::UserCtx;
use sha2::{Digest, Sha256};
use crate::error::{AppError, AppResult};

const MAX_BODY: usize = 21 * 1024 * 1024;

/// 见 DESIGN 7.4。占位与业务写入不在同一事务：业务失败（5xx）时删除占位，允许重试。
pub async fn layer(State(st): State<AppState>, req: Request, next: Next) -> AppResult<Response> {
    let key = match req.headers().get("idempotency-key").and_then(|v| v.to_str().ok()) {
        Some(k) if req.method() == Method::POST && !k.trim().is_empty() => k.trim().to_string(),
        _ => return Ok(next.run(req).await),
    };
    if key.len() > 128 {
        return Err(AppError::validation("Idempotency-Key must be at most 128 characters"));
    }

    let (mut parts, body) = req.into_parts();
    let user = UserCtx::from_request_parts(&mut parts, &st).await?;
    let slug = RawPathParams::from_request_parts(&mut parts, &st)
        .await
        .ok()
        .and_then(|p| p.iter().find(|(k, _)| *k == "slug").map(|(_, v)| v.to_string()));
    let Some(slug) = slug else {
        return Ok(next.run(Request::from_parts(parts, body)).await);
    };
    let Some(project_id): Option<i64> = sqlx::query_scalar("SELECT id FROM projects WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&st.db)
        .await?
    else {
        return Ok(next.run(Request::from_parts(parts, body)).await);
    };

    let bytes = to_bytes(body, MAX_BODY).await.map_err(|_| AppError::validation("request body too large"))?;
    let endpoint = parts.uri.path().to_string();
    let mut material = endpoint.clone().into_bytes();
    material.push(0);
    material.extend_from_slice(&bytes);
    let hash = Sha256::digest(&material).to_vec();

    sqlx::query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'")
        .execute(&st.db)
        .await?;
    let inserted = sqlx::query(
        "INSERT INTO idempotency_keys (project_id, user_id, key, endpoint, request_hash)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
    )
    .bind(project_id)
    .bind(user.user_id)
    .bind(&key)
    .bind(&endpoint)
    .bind(&hash)
    .execute(&st.db)
    .await?
    .rows_affected();

    if inserted == 0 {
        let row = sqlx::query(
            "SELECT endpoint, request_hash, response, status_code FROM idempotency_keys
              WHERE project_id = $1 AND user_id = $2 AND key = $3",
        )
        .bind(project_id)
        .bind(user.user_id)
        .bind(&key)
        .fetch_one(&st.db)
        .await?;
        if row.get::<String, _>("endpoint") != endpoint || row.get::<Vec<u8>, _>("request_hash") != hash {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                code::IDEMPOTENCY_KEY_REUSED,
                "Idempotency-Key was used for a different request",
            ));
        }
        return match row.get::<Option<i16>, _>("status_code") {
            Some(s) => {
                let status = StatusCode::from_u16(s as u16).unwrap_or(StatusCode::OK);
                let body: serde_json::Value = row.get::<Option<serde_json::Value>, _>("response").unwrap_or_default();
                let mut resp = (status, axum::Json(body)).into_response();
                resp.headers_mut().insert("idempotent-replay", "true".parse().unwrap());
                Ok(resp)
            }
            None => Err(AppError::conflict(code::IDEMPOTENCY_IN_PROGRESS, "a request with this key is in progress")),
        };
    }

    let resp = next.run(Request::from_parts(parts, Body::from(bytes))).await;
    let status = resp.status();
    if status.is_server_error() {
        sqlx::query("DELETE FROM idempotency_keys WHERE project_id = $1 AND user_id = $2 AND key = $3")
            .bind(project_id)
            .bind(user.user_id)
            .bind(&key)
            .execute(&st.db)
            .await?;
        return Ok(resp);
    }
    let (rparts, rbody) = resp.into_parts();
    let rbytes = to_bytes(rbody, MAX_BODY).await.map_err(|e| AppError::internal(format!("read response: {e}")))?;
    let json: serde_json::Value = serde_json::from_slice(&rbytes).unwrap_or(serde_json::Value::Null);
    sqlx::query(
        "UPDATE idempotency_keys SET response = $4, status_code = $5
          WHERE project_id = $1 AND user_id = $2 AND key = $3",
    )
    .bind(project_id)
    .bind(user.user_id)
    .bind(&key)
    .bind(json)
    .bind(status.as_u16() as i16)
    .execute(&st.db)
    .await?;
    Ok(Response::from_parts(rparts, Body::from(rbytes)))
}

/// 每 5 分钟释放 24 小时无操作的认领，见 DESIGN 8.2。语句幂等，多实例并发执行无害。
pub async fn release_stale_claims(st: AppState) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(300));
    loop {
        tick.tick().await;
        let r = sqlx::query(
            "UPDATE raw_compositions r
                SET claimed_by = NULL, claimed_at = NULL, last_activity_at = NULL,
                    version = version + 1, updated_at = now(),
                    status = CASE WHEN EXISTS (SELECT 1 FROM raw_exec_links l
                                                WHERE l.project_id = r.project_id AND l.raw_id = r.id)
                                  THEN 'Processed'::raw_status ELSE 'Pending'::raw_status END
              WHERE status = 'Claimed' AND last_activity_at < now() - interval '24 hours'",
        )
        .execute(&st.db)
        .await;
        match r {
            Ok(r) if r.rows_affected() > 0 => tracing::info!(released = r.rows_affected(), "released stale claims"),
            Ok(_) => {}
            Err(e) => tracing::error!(error = %e, "release stale claims failed"),
        }
    }
}
