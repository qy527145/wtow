use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use contract::dto::{
    CancelExecReq, ClaimExecQuery, CompleteExecReq, CreateExecReq, ExecComposition, ExecStatus, ListExecQuery, Page,
    PatchExecReq, ReasonReq, Role,
};
use contract::error as code;
use serde_json::json;
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::app::AppState;
use crate::auth::ProjectCtx;
use crate::error::{AppError, AppResult};
use crate::routes::files;
use crate::routes::raw::{audit, ensure_related_checked, if_match, next_id};

const EXEC_COLS: &str = "e.id, e.instruction, e.target_resources, e.status::text AS status, e.priority,
    e.assigner_id, e.developer_id, e.claimed_at, e.developer_notes, e.result_links, e.version,
    e.created_at, e.updated_at, e.completed_at,
    ARRAY(SELECT l.raw_id FROM raw_exec_links l
           WHERE l.project_id = e.project_id AND l.exec_id = e.id ORDER BY l.raw_id) AS source_raw_ids";

pub fn parse_status(s: &str) -> ExecStatus {
    match s {
        "InProgress" => ExecStatus::InProgress,
        "Done" => ExecStatus::Done,
        "Cancelled" => ExecStatus::Cancelled,
        _ => ExecStatus::Queued,
    }
}

pub fn status_str(s: ExecStatus) -> &'static str {
    match s {
        ExecStatus::Queued => "Queued",
        ExecStatus::InProgress => "InProgress",
        ExecStatus::Done => "Done",
        ExecStatus::Cancelled => "Cancelled",
    }
}

fn exec_from_row(row: &PgRow) -> ExecComposition {
    ExecComposition {
        id: row.get("id"),
        instruction: row.get("instruction"),
        target_resources: row.get("target_resources"),
        status: parse_status(row.get::<String, _>("status").as_str()),
        priority: row.get("priority"),
        assigner_id: row.get("assigner_id"),
        developer_id: row.get("developer_id"),
        claimed_at: row.get("claimed_at"),
        developer_notes: row.get("developer_notes"),
        result_links: row.get("result_links"),
        version: row.get("version"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        completed_at: row.get("completed_at"),
        source_raw_ids: row.get("source_raw_ids"),
        attachments: Vec::new(),
    }
}

pub async fn load(st: &AppState, ctx: &ProjectCtx, id: &str) -> AppResult<ExecComposition> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {EXEC_COLS} FROM exec_compositions e WHERE e.project_id = $1 AND e.id = $2"
    )))
    .bind(ctx.project_id)
    .bind(id)
    .fetch_optional(&st.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("exec {id}")))?;
    let mut exec = exec_from_row(&row);
    // 详情一次带全图文上下文：自身附件 + 来源原始作文的附件，列表接口不带。
    exec.attachments = files::list_owned(st, ctx.project_id, "exec", &[exec.id.clone()]).await?;
    exec.attachments.extend(files::list_owned(st, ctx.project_id, "raw", &exec.source_raw_ids).await?);
    Ok(exec)
}

pub async fn create(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Json(req): Json<CreateExecReq>,
) -> AppResult<(StatusCode, Json<ExecComposition>)> {
    ctx.require(Role::Assigner)?;
    ctx.require_write()?;
    if ctx.archived {
        return Err(AppError::conflict(code::INVALID_TRANSITION, "project is archived"));
    }
    if req.instruction.trim().is_empty() {
        return Err(AppError::validation("instruction is required"));
    }
    let mut sources = req.source_raw_ids.clone();
    sources.sort();
    sources.dedup();
    if sources.is_empty() {
        return Err(AppError::validation("source_raw_ids must not be empty"));
    }
    let priority = req.priority.unwrap_or(2);
    if !(0..=3).contains(&priority) {
        return Err(AppError::validation("priority must be 0-3"));
    }
    let targets: Vec<String> = req
        .target_resources
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    let mut tx = st.db.begin().await?;
    let rows = sqlx::query(
        "SELECT id, status::text AS status, claimed_by, claimed_at FROM raw_compositions
          WHERE project_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE",
    )
    .bind(ctx.project_id)
    .bind(&sources)
    .fetch_all(&mut *tx)
    .await?;
    if rows.len() != sources.len() {
        let found: Vec<String> = rows.iter().map(|r| r.get("id")).collect();
        let missing: Vec<&String> = sources.iter().filter(|s| !found.contains(s)).collect();
        return Err(AppError::not_found(format!("raw {missing:?}")));
    }
    for r in &rows {
        let id: String = r.get("id");
        let status: String = r.get("status");
        if status != "Claimed" || r.get::<Option<i64>, _>("claimed_by") != Some(ctx.user_id) {
            return Err(AppError::conflict(
                code::RAW_NOT_CLAIMED_BY_YOU,
                format!("{id} must be claimed by you (status {status})"),
            ));
        }
        ensure_related_checked(&mut tx, &ctx, &id, r.get("claimed_at"), req.skip_related_check).await?;
    }

    if let Some(dev) = req.developer_id {
        let is_dev: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2
                              AND roles && ARRAY['developer','admin']::project_role[])",
        )
        .bind(ctx.project_id)
        .bind(dev)
        .fetch_one(&mut *tx)
        .await?;
        if !is_dev {
            return Err(AppError::validation(format!("user {dev} is not a developer in this project")));
        }
    }

    let (id, seq) = next_id(&mut tx, ctx.project_id, "exec").await?;
    sqlx::query(
        "INSERT INTO exec_compositions
            (project_id, id, seq, instruction, target_resources, status, priority, assigner_id, developer_id, claimed_at)
         VALUES ($1, $2, $3, $4, $5, $6::exec_status, $7, $8, $9, CASE WHEN $9::bigint IS NULL THEN NULL ELSE now() END)",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .bind(seq)
    .bind(req.instruction.trim())
    .bind(&targets)
    .bind(if req.developer_id.is_some() { "InProgress" } else { "Queued" })
    .bind(priority)
    .bind(ctx.user_id)
    .bind(req.developer_id)
    .execute(&mut *tx)
    .await?;

    let relation = if sources.len() == 1 { "split" } else { "merge" };
    sqlx::query(
        "INSERT INTO raw_exec_links (project_id, raw_id, exec_id, relation, created_by)
         SELECT $1, unnest($2::text[]), $3, $4::link_relation, $5",
    )
    .bind(ctx.project_id)
    .bind(&sources)
    .bind(&id)
    .bind(relation)
    .bind(ctx.user_id)
    .execute(&mut *tx)
    .await?;

    let close_sql = if req.close_sources {
        "UPDATE raw_compositions SET status = 'Processed', claimed_by = NULL, claimed_at = NULL,
                last_activity_at = NULL, version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = ANY($2)"
    } else {
        "UPDATE raw_compositions SET last_activity_at = now() WHERE project_id = $1 AND id = ANY($2)"
    };
    sqlx::query(close_sql).bind(ctx.project_id).bind(&sources).execute(&mut *tx).await?;

    files::bind(&mut tx, &ctx, &req.attachment_ids, "exec", &id).await?;
    files::check_refs(&mut tx, ctx.project_id, &req.instruction, &[("exec", &[id.clone()]), ("raw", &sources)]).await?;
    audit(
        &mut tx,
        &ctx,
        "exec.create",
        "exec",
        &id,
        json!({ "sources": sources, "close_sources": req.close_sources,
                "skip_related_check": req.skip_related_check, "developer_id": req.developer_id }),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(load(&st, &ctx, &id).await?)))
}

pub async fn list(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Query(q): Query<ListExecQuery>,
) -> AppResult<Json<Page<ExecComposition>>> {
    let page = q.page.unwrap_or(1).max(1);
    let size = q.page_size.unwrap_or(20).clamp(1, 100);
    let filter = "e.project_id = $1
        AND ($2::text IS NULL OR e.status::text = $2)
        AND ($3::bigint IS NULL OR e.developer_id = $3)
        AND ($4::text IS NULL OR $4 = ANY(e.target_resources))
        AND ($5::text IS NULL OR e.instruction ILIKE '%' || $5 || '%')";
    let status = q.status.map(status_str);
    let kw = q
        .q
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));

    let total: i64 =
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT count(*) FROM exec_compositions e WHERE {filter}")))
            .bind(ctx.project_id)
            .bind(status)
            .bind(q.developer_id)
            .bind(&q.target)
            .bind(&kw)
            .fetch_one(&st.db)
            .await?;
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {EXEC_COLS} FROM exec_compositions e WHERE {filter}
          ORDER BY e.priority, e.created_at LIMIT $6 OFFSET $7"
    )))
    .bind(ctx.project_id)
    .bind(status)
    .bind(q.developer_id)
    .bind(&q.target)
    .bind(&kw)
    .bind(size)
    .bind((page - 1) * size)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(Page { items: rows.iter().map(exec_from_row).collect(), total }))
}

pub async fn get(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
) -> AppResult<Json<ExecComposition>> {
    Ok(Json(load(&st, &ctx, &id).await?))
}

/// 执行作文的原始来源。
pub async fn raws(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
) -> AppResult<Json<Vec<contract::dto::RawComposition>>> {
    let exec = load(&st, &ctx, &id).await?;
    let mut out = Vec::with_capacity(exec.source_raw_ids.len());
    for rid in &exec.source_raw_ids {
        out.push(crate::routes::raw::load(&st, &ctx, rid).await?);
    }
    Ok(Json(out))
}

/// 原始作文拆出的执行作文。
pub async fn by_raw(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
) -> AppResult<Json<Vec<ExecComposition>>> {
    crate::routes::raw::load(&st, &ctx, &id).await?;
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {EXEC_COLS} FROM exec_compositions e
           JOIN raw_exec_links l ON l.project_id = e.project_id AND l.exec_id = e.id
          WHERE e.project_id = $1 AND l.raw_id = $2 ORDER BY e.created_at"
    )))
    .bind(ctx.project_id)
    .bind(&id)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(rows.iter().map(exec_from_row).collect()))
}

async fn lock_exec(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ctx: &ProjectCtx,
    id: &str,
) -> AppResult<(String, Option<i64>, Vec<String>)> {
    let row = sqlx::query(
        "SELECT status::text AS status, developer_id, target_resources FROM exec_compositions
          WHERE project_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(ctx.project_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::not_found(format!("exec {id}")))?;
    Ok((row.get("status"), row.get("developer_id"), row.get("target_resources")))
}

fn ensure_writable(ctx: &ProjectCtx) -> AppResult<()> {
    ctx.require_write()?;
    if ctx.archived {
        return Err(AppError::conflict(code::INVALID_TRANSITION, "project is archived"));
    }
    Ok(())
}

fn required_reason(r: &str) -> AppResult<&str> {
    let r = r.trim();
    if r.is_empty() {
        return Err(AppError::validation("reason is required"));
    }
    Ok(r)
}

pub async fn claim(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Query(q): Query<ClaimExecQuery>,
) -> AppResult<Json<ExecComposition>> {
    ctx.require(Role::Developer)?;
    ensure_writable(&ctx)?;
    let mut tx = st.db.begin().await?;
    let (status, dev, targets) = lock_exec(&mut tx, &ctx, &id).await?;
    if status != "Queued" || dev.is_some() {
        return Err(AppError::conflict(code::EXEC_ALREADY_CLAIMED, format!("{id} is {status}"))
            .with_details(json!({ "developer_id": dev })));
    }
    let conflicts: Vec<(String, Option<i64>, Vec<String>)> = if targets.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as(
            "SELECT id, developer_id, target_resources FROM exec_compositions
              WHERE project_id = $1 AND id <> $2 AND status = 'InProgress' AND target_resources && $3
              ORDER BY id",
        )
        .bind(ctx.project_id)
        .bind(&id)
        .bind(&targets)
        .fetch_all(&mut *tx)
        .await?
    };
    if !conflicts.is_empty() && !q.force {
        let details: Vec<_> = conflicts
            .iter()
            .map(|(cid, d, t)| json!({ "id": cid, "developer_id": d, "target_resources": t }))
            .collect();
        return Err(AppError::conflict(code::TARGET_CONFLICT, format!("{id} overlaps in-progress work; pass force=true to claim anyway"))
            .with_details(json!({ "conflicts": details })));
    }
    sqlx::query(
        "UPDATE exec_compositions SET developer_id = $3, claimed_at = now(), status = 'InProgress',
                version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .bind(ctx.user_id)
    .execute(&mut *tx)
    .await?;
    let forced: Vec<&String> = conflicts.iter().map(|c| &c.0).collect();
    audit(&mut tx, &ctx, "exec.claim", "exec", &id, json!({ "force": q.force, "conflicts": forced })).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}

pub async fn release(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Json(req): Json<ReasonReq>,
) -> AppResult<Json<ExecComposition>> {
    ensure_writable(&ctx)?;
    let reason = required_reason(&req.reason)?;
    let mut tx = st.db.begin().await?;
    let (status, dev, _) = lock_exec(&mut tx, &ctx, &id).await?;
    if dev != Some(ctx.user_id) && !ctx.roles.has(Role::Assigner) {
        return Err(AppError::forbidden(code::FORBIDDEN_ROLE, "only the developer, assigner or admin can release"));
    }
    if status != "InProgress" {
        return Err(AppError::conflict(code::INVALID_TRANSITION, format!("cannot release {id} in status {status}")));
    }
    sqlx::query(
        "UPDATE exec_compositions SET developer_id = NULL, claimed_at = NULL, status = 'Queued',
                version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    audit(&mut tx, &ctx, "exec.release", "exec", &id, json!({ "developer_id": dev, "reason": reason })).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}

pub async fn complete(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Json(req): Json<CompleteExecReq>,
) -> AppResult<Json<ExecComposition>> {
    ensure_writable(&ctx)?;
    let notes = req.developer_notes.trim();
    if notes.is_empty() {
        return Err(AppError::validation("developer_notes is required"));
    }
    let mut tx = st.db.begin().await?;
    let (status, dev, _) = lock_exec(&mut tx, &ctx, &id).await?;
    if dev != Some(ctx.user_id) {
        return Err(AppError::forbidden(code::FORBIDDEN_ROLE, "only the developer who claimed it can complete"));
    }
    if status != "InProgress" {
        return Err(AppError::conflict(code::INVALID_TRANSITION, format!("cannot complete {id} in status {status}")));
    }
    sqlx::query(
        "UPDATE exec_compositions SET status = 'Done', developer_notes = $3, result_links = $4,
                completed_at = now(), version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .bind(notes)
    .bind(json!(req.result_links))
    .execute(&mut *tx)
    .await?;
    audit(&mut tx, &ctx, "exec.complete", "exec", &id, json!({})).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}

pub async fn cancel(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Json(req): Json<CancelExecReq>,
) -> AppResult<Json<ExecComposition>> {
    ctx.require(Role::Assigner)?;
    ensure_writable(&ctx)?;
    let reason = required_reason(&req.reason)?;
    let mut tx = st.db.begin().await?;
    let (status, _, _) = lock_exec(&mut tx, &ctx, &id).await?;
    if !matches!(status.as_str(), "Queued" | "InProgress") {
        return Err(AppError::conflict(code::INVALID_TRANSITION, format!("cannot cancel {id} in status {status}")));
    }
    sqlx::query(
        "UPDATE exec_compositions SET status = 'Cancelled', version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    let requeued: Vec<String> = if req.requeue_sources {
        // 来源若已无其他未取消的执行作文，回到 Pending，避免反馈从系统中消失。
        sqlx::query_scalar(
            "UPDATE raw_compositions r
                SET status = 'Pending', claimed_by = NULL, claimed_at = NULL, last_activity_at = NULL,
                    version = version + 1, updated_at = now()
              WHERE r.project_id = $1 AND r.status = 'Processed'
                AND r.id IN (SELECT raw_id FROM raw_exec_links WHERE project_id = $1 AND exec_id = $2)
                AND NOT EXISTS (SELECT 1 FROM raw_exec_links l
                                  JOIN exec_compositions e ON e.project_id = l.project_id AND e.id = l.exec_id
                                 WHERE l.project_id = r.project_id AND l.raw_id = r.id AND e.status <> 'Cancelled')
              RETURNING r.id",
        )
        .bind(ctx.project_id)
        .bind(&id)
        .fetch_all(&mut *tx)
        .await?
    } else {
        Vec::new()
    };
    audit(&mut tx, &ctx, "exec.cancel", "exec", &id, json!({ "reason": reason, "requeued": requeued })).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}

pub async fn reopen(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    Json(req): Json<ReasonReq>,
) -> AppResult<Json<ExecComposition>> {
    ensure_writable(&ctx)?;
    let reason = required_reason(&req.reason)?;
    let mut tx = st.db.begin().await?;
    let (status, dev, _) = lock_exec(&mut tx, &ctx, &id).await?;
    if dev != Some(ctx.user_id) && !ctx.roles.has(Role::Assigner) {
        return Err(AppError::forbidden(code::FORBIDDEN_ROLE, "only the developer, assigner or admin can reopen"));
    }
    if status != "Done" {
        return Err(AppError::conflict(code::INVALID_TRANSITION, format!("cannot reopen {id} in status {status}")));
    }
    let old = sqlx::query(
        "SELECT developer_notes, result_links, completed_at FROM exec_compositions WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE exec_compositions SET status = 'InProgress', completed_at = NULL,
                version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    audit(
        &mut tx,
        &ctx,
        "exec.reopen",
        "exec",
        &id,
        json!({
            "reason": reason,
            "old_notes": old.get::<Option<String>, _>("developer_notes"),
            "old_links": old.get::<serde_json::Value, _>("result_links"),
            "old_completed_at": old.get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at"),
        }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}

pub async fn patch(
    State(st): State<AppState>,
    ctx: ProjectCtx,
    Path((_, id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(req): Json<PatchExecReq>,
) -> AppResult<Json<ExecComposition>> {
    ensure_writable(&ctx)?;
    let if_match = if_match(&headers)?;
    if let Some(p) = req.priority {
        if !(0..=3).contains(&p) {
            return Err(AppError::validation("priority must be 0-3"));
        }
    }
    let mut tx = st.db.begin().await?;
    let (status, dev, _) = lock_exec(&mut tx, &ctx, &id).await?;
    let is_assigner = ctx.roles.has(Role::Assigner);
    let is_dev = dev == Some(ctx.user_id);
    if !is_assigner && !is_dev {
        return Err(AppError::forbidden(code::FORBIDDEN_ROLE, "only the assigner or the developer can edit"));
    }
    // 领取者只能写进展字段，指令、优先级、目标归分配者。
    if !is_assigner && (req.instruction.is_some() || req.priority.is_some() || req.target_resources.is_some()) {
        return Err(AppError::forbidden(code::FORBIDDEN_ROLE, "only an assigner can change instruction, priority or targets"));
    }
    if matches!(status.as_str(), "Done" | "Cancelled") && (req.instruction.is_some() || req.target_resources.is_some()) {
        return Err(AppError::conflict(code::INVALID_TRANSITION, format!("{id} is {status}")));
    }
    let targets: Option<Vec<String>> = req
        .target_resources
        .map(|v| v.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect());
    let n = sqlx::query(
        "UPDATE exec_compositions SET
            instruction = COALESCE($3, instruction), priority = COALESCE($4, priority),
            target_resources = COALESCE($5, target_resources), developer_notes = COALESCE($6, developer_notes),
            result_links = COALESCE($7, result_links), version = version + 1, updated_at = now()
          WHERE project_id = $1 AND id = $2 AND ($8::int IS NULL OR version = $8)",
    )
    .bind(ctx.project_id)
    .bind(&id)
    .bind(req.instruction.as_deref().map(str::trim))
    .bind(req.priority)
    .bind(&targets)
    .bind(req.developer_notes.as_deref().map(str::trim))
    .bind(req.result_links.map(|l| json!(l)))
    .bind(if_match)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::conflict(code::VERSION_CONFLICT, format!("{id} was modified by someone else")));
    }
    if let Some(i) = &req.instruction {
        let sources: Vec<String> = sqlx::query_scalar(
            "SELECT raw_id FROM raw_exec_links WHERE project_id = $1 AND exec_id = $2",
        )
        .bind(ctx.project_id)
        .bind(&id)
        .fetch_all(&mut *tx)
        .await?;
        files::check_refs(&mut tx, ctx.project_id, i, &[("exec", &[id.clone()]), ("raw", &sources)]).await?;
    }
    audit(&mut tx, &ctx, "exec.patch", "exec", &id, json!({})).await?;
    tx.commit().await?;
    Ok(Json(load(&st, &ctx, &id).await?))
}
