use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::Json;
use contract::dto::{
    ActorType, Delivery, ListRawQuery, Page, PatchRawReq, RawComposition, RawStatus, ReasonReq,
    RelatedItem, Role, SubmitRawReq, TriageReq,
};
use contract::error as code;
use serde_json::json;
use sqlx::postgres::PgRow;
use sqlx::{Postgres, Row, Transaction};

use crate::app::AppState;
use crate::auth::ProjectCtx;
use crate::error::{AppError, AppResult};
use crate::routes::files;

const RAW_COLS: &str = "r.id, r.title, r.description, r.tags, r.status::text AS status, r.reporter_id,
    r.claimed_by, r.claimed_at, r.merged_into_id, r.triage_reason, r.version, r.created_at, r.updated_at,
    COALESCE((SELECT CASE
        WHEN count(*) FILTER (WHERE e.status <> 'Cancelled') = 0 THEN 'cancelled'
        WHEN bool_and(e.status IN ('Done','Cancelled')) THEN 'delivered'
        ELSE 'in_progress' END
      FROM raw_exec_links l JOIN exec_compositions e ON e.project_id = l.project_id AND e.id = l.exec_id
     WHERE l.project_id = r.project_id AND l.raw_id = r.id HAVING count(*) > 0), 'none') AS delivery";

pub fn parse_status(s: &str) -> RawStatus {
    match s {
        "Claimed" => RawStatus::Claimed,
        "Processed" => RawStatus::Processed,
        "Merged" => RawStatus::Merged,
        "Duplicate" => RawStatus::Duplicate,
        "Ignored" => RawStatus::Ignored,
        _ => RawStatus::Pending,
    }
}

fn status_str(s: RawStatus) -> &'static str {
    match s {
        RawStatus::Pending => "Pending",
        RawStatus::Claimed => "Claimed",
        RawStatus::Processed => "Processed",
        RawStatus::Merged => "Merged",
        RawStatus::Duplicate => "Duplicate",
        RawStatus::Ignored => "Ignored",
    }
}

fn raw_from_row(row: &PgRow) -> RawComposition {
    let delivery: String = row.get("delivery");
    RawComposition {
        id: row.get("id"),
        title: row.get("title"),
        description: row.get("description"),
        tags: row.get("tags"),
        status: parse_status(row.get::<String, _>("status").as_str()),
        reporter_id: row.get("reporter_id"),
        claimed_by: row.get("claimed_by"),
        claimed_at: row.get("claimed_at"),
        merged_into_id: row.get("merged_into_id"),
        triage_reason: row.get("triage_reason"),
        version: row.get("version"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        delivery: match delivery.as_str() {
            "in_progress" => Delivery::InProgress,
            "delivered" => Delivery::Delivered,
            "cancelled" => Delivery::Cancelled,
            _ => Delivery::None,
        },
        attachments: Vec::new(),
    }
}

pub async fn next_id(tx: &mut Transaction<'_, Postgres>, project_id: i64, kind: &str) -> AppResult<(String, i64)> {
    let seq: i64 = sqlx::query_scalar(
        "INSERT INTO project_counters (project_id, kind, next_seq) VALUES ($1, $2, 1000)
         ON CONFLICT (project_id, kind) DO UPDATE SET next_seq = project_counters.next_seq + 1
         RETURNING next_seq",
    )
    .bind(project_id)
    .bind(kind)
    .fetch_one(&mut **tx)
    .await?;
    Ok((format!("{}-{seq}", kind.to_uppercase()), seq))
}

pub async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &ProjectCtx,
    action: &str,
    object_type: &str,
    object_id: &str,
    detail: serde_json::Value,
) -> AppResult<()> {
    let actor = match ctx.actor_type {
        ActorType::Human => "human",
        ActorType::Agent => "agent",
    };
    sqlx::query(
        "INSERT INTO audit_logs (project_id, actor_id, token_id, actor_type, action, object_type, object_id, detail)
         VALUES ($1, $2, $3, $4::actor_type, $5, $6, $7, $8)",
    )
    .bind(ctx.project_id)
    .bind(ctx.user_id)
    .bind(ctx.token_id)
    .bind(actor)
    .bind(action)
    .bind(object_type)
    .bind(object_id)
    .bind(detail)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn ensure_writable(ctx: &ProjectCtx) -> AppResult<()> {
    ctx.require_write()?;
    if ctx.archived {
        return Err(AppError::conflict(code::INVALID_TRANSITION, "project is archived"));
    }
    Ok(())
}

pub async fn load(st: &AppState, ctx: &ProjectCtx, id: &str) -> AppResult<RawComposition> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {RAW_COLS} FROM raw_compositions r WHERE r.project_id = $1 AND r.id = $2"
    )))
    .bind(ctx.project_id)
    .bind(id)
    .fetch_optional(&st.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("raw {id}")))?;
    let mut raw = raw_from_row(&row);
    raw.attachments = files::list_owned(st, ctx.project_id, "raw", &[id.to_string()]).await?;
    Ok(raw)
}

pub async fn submit(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Json(req): Json<SubmitRawReq>,
) -> AppResult<(StatusCode, Json<RawComposition>)> {
    ensure_writable(&ctx)?;
    let title = req.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::validation("title must be 1-200 characters"));
    }
    if req.description.trim().is_empty() {
        return Err(AppError::validation("description is required"));
    }
    let tags: Vec<String> = req
        .tags
        .iter()
        .map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty())
        .collect();

    let mut tx = st.db.begin().await?;
    let (id, seq) = next_id(&mut tx, ctx.project_id, "raw").await?;
    sqlx::query(
        "INSERT INTO raw_compositions (project_id, id, seq, title, description, tags, reporter_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .bind(seq)
    .bind(title)
    .bind(req.description.trim())
    .bind(&tags)
    .bind(ctx.user_id)
    .execute(&mut *tx)
    .await?;

    files::bind(&mut tx, &ctx, &req.attachment_ids, "raw", &id).await?;
    files::check_refs(&mut tx, ctx.project_id, &req.description, &[("raw", &[id.clone()])]).await?;
    audit(&mut tx, &ctx, "raw.submit", "raw", &id, json!({})).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(load(&st, &ctx, &id).await?)))
}

pub async fn list(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Query(q): Query<ListRawQuery>,
) -> AppResult<Json<Page<RawComposition>>> {
    let page = q.page.unwrap_or(1).max(1);
    let size = q.page_size.unwrap_or(20).clamp(1, 100);
    let filter = "r.project_id = $1
        AND ($2::text IS NULL OR r.status::text = $2)
        AND ($3::text IS NULL OR $3 = ANY(r.tags))
        AND ($4::text IS NULL OR r.title ILIKE '%' || $4 || '%' OR r.description ILIKE '%' || $4 || '%')
        AND ($5::bigint IS NULL OR r.reporter_id = $5)";
    let status = q.status.map(status_str);
    let tag = q.tag.as_deref().map(|t| t.trim().to_lowercase());
    let kw = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(escape_like);
    let mine = q.mine.unwrap_or(false).then_some(ctx.user_id);

    let total: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT count(*) FROM raw_compositions r WHERE {filter}")))
        .bind(ctx.project_id)
        .bind(status)
        .bind(&tag)
        .bind(&kw)
        .bind(mine)
        .fetch_one(&st.db)
        .await?;
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {RAW_COLS} FROM raw_compositions r WHERE {filter}
          ORDER BY r.created_at DESC LIMIT $6 OFFSET $7"
    )))
    .bind(ctx.project_id)
    .bind(status)
    .bind(&tag)
    .bind(&kw)
    .bind(mine)
    .bind(size)
    .bind((page - 1) * size)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(Page { items: rows.iter().map(raw_from_row).collect(), total }))
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

pub async fn get(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
) -> AppResult<Json<RawComposition>> {
    Ok(Json(load(&st, &ctx, &id).await?))
}

pub async fn claim(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
) -> AppResult<Json<RawComposition>> {
    ctx.require(Role::Assigner)?;
    ensure_writable(&ctx)?;
    let mut tx = st.db.begin().await?;
    let n = sqlx::query(
        "UPDATE raw_compositions
            SET claimed_by = $3, claimed_at = now(), last_activity_at = now(), status = 'Claimed',
                version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2 AND status = 'Pending' AND claimed_by IS NULL",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .bind(ctx.user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        let cur = sqlx::query(
            "SELECT status::text AS status, claimed_by, claimed_at FROM raw_compositions
              WHERE project_id = $1 AND id = $2",
        )
        .bind(ctx.project_id)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found(format!("raw {id}")))?;
        let status: String = cur.get("status");
        if status == "Claimed" {
            let at: Option<chrono::DateTime<chrono::Utc>> = cur.get("claimed_at");
            return Err(AppError::conflict(code::RAW_ALREADY_CLAIMED, format!("{id} is already claimed"))
                .with_details(json!({ "claimed_by": cur.get::<Option<i64>, _>("claimed_by"), "claimed_at": at })));
        }
        return Err(AppError::conflict(code::INVALID_TRANSITION, format!("cannot claim {id} in status {status}")));
    }
    audit(&mut tx, &ctx, "raw.claim", "raw", &id, json!({})).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}

pub async fn release(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
) -> AppResult<Json<RawComposition>> {
    ctx.require(Role::Assigner)?;
    ensure_writable(&ctx)?;
    let mut tx = st.db.begin().await?;
    let cur = sqlx::query(
        "SELECT status::text AS status, claimed_by FROM raw_compositions
          WHERE project_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found(format!("raw {id}")))?;
    let status: String = cur.get("status");
    if status != "Claimed" {
        return Err(AppError::conflict(code::INVALID_TRANSITION, format!("cannot release {id} in status {status}")));
    }
    if cur.get::<Option<i64>, _>("claimed_by") != Some(ctx.user_id) && !ctx.roles.has(Role::Admin) {
        return Err(AppError::conflict(code::RAW_NOT_CLAIMED_BY_YOU, format!("{id} is claimed by someone else")));
    }
    sqlx::query(
        "UPDATE raw_compositions r
            SET claimed_by = NULL, claimed_at = NULL, last_activity_at = NULL,
                version = version + 1, updated_at = now(),
                status = CASE WHEN EXISTS (SELECT 1 FROM raw_exec_links l
                                            WHERE l.project_id = r.project_id AND l.raw_id = r.id)
                              THEN 'Processed'::raw_status ELSE 'Pending'::raw_status END
          WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    audit(&mut tx, &ctx, "raw.release", "raw", &id, json!({})).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}

async fn lock_raw(tx: &mut Transaction<'_, Postgres>, ctx: &ProjectCtx, id: &str) -> AppResult<(String, Option<i64>, Option<chrono::DateTime<chrono::Utc>>)> {
    let row = sqlx::query(
        "SELECT status::text AS status, claimed_by, claimed_at FROM raw_compositions
          WHERE project_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(ctx.project_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::not_found(format!("raw {id}")))?;
    Ok((row.get("status"), row.get("claimed_by"), row.get("claimed_at")))
}

/// 本次认领期内调用过 related 才允许建联或合并，见 DESIGN 13。
pub async fn ensure_related_checked(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &ProjectCtx,
    id: &str,
    claimed_at: Option<chrono::DateTime<chrono::Utc>>,
    skip: bool,
) -> AppResult<()> {
    if skip {
        return Ok(());
    }
    let checked: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM audit_logs
                         WHERE project_id = $1 AND actor_id = $2 AND action = 'raw.related'
                           AND object_id = $3 AND ($4::timestamptz IS NULL OR created_at >= $4))",
    )
    .bind(ctx.project_id)
    .bind(ctx.user_id)
    .bind(id)
    .bind(claimed_at)
    .fetch_one(&mut **tx)
    .await?;
    if !checked {
        return Err(AppError::conflict(
            code::RELATED_NOT_CHECKED,
            format!("call related for {id} first, or pass skip_related_check=true"),
        ));
    }
    Ok(())
}

fn ensure_triage_allowed(ctx: &ProjectCtx) -> AppResult<()> {
    ctx.require(Role::Assigner)?;
    ensure_writable(ctx)?;
    if ctx.require_human_triage && ctx.actor_type == ActorType::Agent {
        return Err(AppError::forbidden(code::HUMAN_TRIAGE_REQUIRED, "this project requires a human for triage"));
    }
    Ok(())
}

pub async fn related(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
) -> AppResult<Json<Vec<RelatedItem>>> {
    ctx.require(Role::Assigner)?;
    let me = load(&st, &ctx, &id).await?;
    let rows = sqlx::query(
        "SELECT * FROM (
           SELECT 'raw' AS kind, r.id, r.title, r.status::text AS status,
                  cardinality(ARRAY(SELECT unnest(r.tags) INTERSECT SELECT unnest($3::text[])))::float8 AS tag_hits,
                  word_similarity($4, r.title)::float8 AS t_sim,
                  word_similarity($5, r.description)::float8 AS d_sim
             FROM raw_compositions r
            WHERE r.project_id = $1 AND r.id <> $2 AND r.status IN ('Pending','Claimed','Processed')
           UNION ALL
           SELECT 'exec', e.id, left(e.instruction, 200), e.status::text,
                  0, word_similarity($4, e.instruction)::float8, word_similarity($5, e.instruction)::float8
             FROM exec_compositions e
            WHERE e.project_id = $1 AND e.created_at > now() - interval '90 days'
         ) c
         WHERE tag_hits > 0 OR t_sim > 0.2 OR d_sim > 0.2
         ORDER BY tag_hits * 2 + t_sim * 3 + d_sim DESC
         LIMIT 10",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .bind(&me.tags)
    .bind(&me.title)
    .bind(&me.description)
    .fetch_all(&st.db)
    .await?;
    let items = rows
        .iter()
        .map(|r| {
            let (tag, t, d): (f64, f64, f64) = (r.get("tag_hits"), r.get("t_sim"), r.get("d_sim"));
            let mut reasons = Vec::new();
            if tag > 0.0 {
                reasons.push(format!("{tag} shared tags"));
            }
            if t > 0.2 {
                reasons.push(format!("title similarity {t:.2}"));
            }
            if d > 0.2 {
                reasons.push(format!("description similarity {d:.2}"));
            }
            RelatedItem {
                kind: r.get("kind"),
                id: r.get("id"),
                title: r.get("title"),
                status: r.get("status"),
                score: tag * 2.0 + t * 3.0 + d,
                reasons,
            }
        })
        .collect();

    let mut tx = st.db.begin().await?;
    audit(&mut tx, &ctx, "raw.related", "raw", &id, json!({})).await?;
    sqlx::query("UPDATE raw_compositions SET last_activity_at = now() WHERE project_id = $1 AND id = $2 AND claimed_by = $3")
        .bind(ctx.project_id)
        .bind(&id)
        .bind(ctx.user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(items))
}

pub async fn patch(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(req): Json<PatchRawReq>,
) -> AppResult<Json<RawComposition>> {
    ctx.require(Role::Assigner)?;
    ensure_writable(&ctx)?;
    let if_match = if_match(&headers)?;
    if let Some(t) = &req.title {
        if t.trim().is_empty() || t.trim().chars().count() > 200 {
            return Err(AppError::validation("title must be 1-200 characters"));
        }
    }
    let tags: Option<Vec<String>> = req
        .tags
        .map(|v| v.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect());
    let mut tx = st.db.begin().await?;
    let n = sqlx::query(
        "UPDATE raw_compositions SET
            title = COALESCE($3, title), description = COALESCE($4, description), tags = COALESCE($5, tags),
            version = version + 1, updated_at = now(),
            last_activity_at = CASE WHEN claimed_by = $7 THEN now() ELSE last_activity_at END
          WHERE project_id = $1 AND id = $2 AND ($6::int IS NULL OR version = $6)",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .bind(req.title.as_deref().map(str::trim))
    .bind(req.description.as_deref().map(str::trim))
    .bind(&tags)
    .bind(if_match)
    .bind(ctx.user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        lock_raw(&mut tx, &ctx, &id).await?;
        return Err(AppError::conflict(code::VERSION_CONFLICT, format!("{id} was modified by someone else")));
    }
    if let Some(d) = &req.description {
        files::check_refs(&mut tx, ctx.project_id, d, &[("raw", &[id.clone()])]).await?;
    }
    audit(&mut tx, &ctx, "raw.patch", "raw", &id, json!({})).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}

pub fn if_match(headers: &HeaderMap) -> AppResult<Option<i32>> {
    headers
        .get(header::IF_MATCH)
        .map(|v| {
            v.to_str()
                .ok()
                .map(|s| s.trim().trim_matches('"'))
                .and_then(|s| s.parse::<i32>().ok())
                .ok_or_else(|| AppError::validation("If-Match must be an integer version"))
        })
        .transpose()
}

async fn triage(
    st: &AppState,
    ctx: &ProjectCtx,
    id: &str,
    to: RawStatus,
    req: TriageReq,
) -> AppResult<RawComposition> {
    ensure_triage_allowed(ctx)?;
    let reason = req.reason.trim();
    if reason.is_empty() {
        return Err(AppError::validation("reason is required"));
    }
    let mut tx = st.db.begin().await?;

    let target_root = match (to, req.target_id.as_deref()) {
        (RawStatus::Ignored, _) => None,
        (_, None) => return Err(AppError::validation("target_id is required")),
        (_, Some(t)) => {
            // 按 id 顺序加锁，避免两条互相合并时死锁。
            let (first, second) = if id < t { (id, t) } else { (t, id) };
            lock_raw(&mut tx, ctx, first).await?;
            lock_raw(&mut tx, ctx, second).await?;
            let root: Option<String> = sqlx::query_scalar(
                "SELECT COALESCE(merged_into_id, id) FROM raw_compositions WHERE project_id = $1 AND id = $2",
            )
            .bind(ctx.project_id)
            .bind(t)
            .fetch_one(&mut *tx)
            .await?;
            let root = root.unwrap_or_else(|| t.to_string());
            if root == id {
                return Err(AppError::validation("cannot merge into itself"));
            }
            let root_status: String = sqlx::query_scalar(
                "SELECT status::text FROM raw_compositions WHERE project_id = $1 AND id = $2",
            )
            .bind(ctx.project_id)
            .bind(&root)
            .fetch_one(&mut *tx)
            .await?;
            if !matches!(root_status.as_str(), "Pending" | "Claimed" | "Processed") {
                return Err(AppError::conflict(
                    code::INVALID_TRANSITION,
                    format!("target {root} is {root_status} and cannot absorb others"),
                ));
            }
            Some(root)
        }
    };

    let (status, claimed_by, claimed_at) = lock_raw(&mut tx, ctx, id).await?;
    match status.as_str() {
        "Pending" => {}
        "Claimed" if claimed_by == Some(ctx.user_id) => {}
        "Claimed" => {
            return Err(AppError::conflict(code::RAW_NOT_CLAIMED_BY_YOU, format!("{id} is claimed by someone else")))
        }
        s => return Err(AppError::conflict(code::INVALID_TRANSITION, format!("cannot triage {id} in status {s}"))),
    }
    if to != RawStatus::Ignored {
        ensure_related_checked(&mut tx, ctx, id, claimed_at, req.skip_related_check).await?;
    }

    sqlx::query(
        "UPDATE raw_compositions
            SET status = $3::raw_status, merged_into_id = $4, triage_reason = $5,
                claimed_by = NULL, claimed_at = NULL, last_activity_at = NULL,
                version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(id)
    .bind(status_str(to))
    .bind(&target_root)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    if let Some(root) = &target_root {
        sqlx::query(
            "UPDATE raw_compositions SET merged_into_id = $3, version = version + 1, updated_at = now()
              WHERE project_id = $1 AND merged_into_id = $2",
        )
        .bind(ctx.project_id)
        .bind(id)
        .bind(root)
        .execute(&mut *tx)
        .await?;
    }
    let action = format!("raw.{}", status_str(to).to_lowercase());
    audit(
        &mut tx,
        ctx,
        &action,
        "raw",
        id,
        json!({ "target": target_root, "reason": reason, "skip_related_check": req.skip_related_check }),
    )
    .await?;
    tx.commit().await?;
    load(st, ctx, id).await
}

pub async fn merge(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Json(req): Json<TriageReq>,
) -> AppResult<Json<RawComposition>> {
    Ok(Json(triage(&st, &ctx, &id, RawStatus::Merged, req).await?))
}

pub async fn duplicate(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Json(req): Json<TriageReq>,
) -> AppResult<Json<RawComposition>> {
    Ok(Json(triage(&st, &ctx, &id, RawStatus::Duplicate, req).await?))
}

pub async fn ignore(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Json(req): Json<TriageReq>,
) -> AppResult<Json<RawComposition>> {
    Ok(Json(triage(&st, &ctx, &id, RawStatus::Ignored, req).await?))
}

pub async fn reopen(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Json(req): Json<ReasonReq>,
) -> AppResult<Json<RawComposition>> {
    ctx.require(Role::Assigner)?;
    ensure_writable(&ctx)?;
    let reason = req.reason.trim();
    if reason.is_empty() {
        return Err(AppError::validation("reason is required"));
    }
    let mut tx = st.db.begin().await?;
    let (status, _, _) = lock_raw(&mut tx, &ctx, &id).await?;
    if !matches!(status.as_str(), "Merged" | "Duplicate" | "Ignored" | "Processed") {
        return Err(AppError::conflict(code::INVALID_TRANSITION, format!("cannot reopen {id} in status {status}")));
    }
    sqlx::query(
        "UPDATE raw_compositions
            SET status = 'Pending', merged_into_id = NULL, triage_reason = NULL,
                version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    audit(&mut tx, &ctx, "raw.reopen", "raw", &id, json!({ "from": status, "reason": reason })).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}
