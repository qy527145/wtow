use std::net::SocketAddr;

use axum::routing::{get, post};
use axum::Router;
use sqlx::postgres::PgPoolOptions;

mod app;
mod assets;
mod auth;
mod error;
mod idempotency;
mod routes;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "wtow_server=info,tower_http=info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");
    let db = PgPoolOptions::new()
        .max_connections(16)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&db).await?;

    // 名单里的邮箱每次启动都提升为超管；撤销需在面板里操作，不会因从名单删掉而自动降级。
    let superadmins = app::superadmin_emails();
    if !superadmins.is_empty() {
        let n = sqlx::query("UPDATE users SET is_superadmin = true WHERE email = ANY($1) AND NOT is_superadmin")
            .bind(&superadmins)
            .execute(&db)
            .await?
            .rows_affected();
        tracing::info!(promoted = n, "superadmin emails applied");
    }

    let state = app::AppState::new(db);
    tokio::spawn(idempotency::release_stale_claims(state.clone()));

    let api = Router::new()
        .route("/meta", get(routes::meta::meta))
        .route("/auth/register", post(routes::auth::register))
        .route("/auth/login", post(routes::auth::login))
        .route("/auth/logout", post(routes::auth::logout))
        .route("/me", get(routes::auth::me).patch(routes::auth::update_me))
        .route("/admin/projects", get(routes::admin::projects))
        .route("/admin/projects/{slug}", axum::routing::delete(routes::admin::delete_project))
        .route("/admin/users", get(routes::admin::users))
        .route("/admin/users/{id}", axum::routing::patch(routes::admin::update_user))
        .route("/projects", get(routes::projects::list).post(routes::projects::create))
        .route("/projects/{slug}", get(routes::projects::get).patch(routes::projects::update))
        .route("/projects/{slug}/members", get(routes::members::list).put(routes::members::upsert))
        .route("/projects/{slug}/members/candidates", get(routes::members::candidates))
        .route("/projects/{slug}/members/{user_id}", axum::routing::delete(routes::members::remove))
        .route("/projects/{slug}/tokens", get(routes::tokens::list).post(routes::tokens::create))
        .route("/projects/{slug}/tokens/{id}/revoke", post(routes::tokens::revoke))
        .route("/projects/{slug}/whoami", get(routes::tokens::whoami))
        .route("/projects/{slug}/raw", get(routes::raw::list).post(routes::raw::submit))
        .route("/projects/{slug}/raw/{id}", get(routes::raw::get).patch(routes::raw::patch))
        .route("/projects/{slug}/raw/{id}/related", get(routes::raw::related))
        .route("/projects/{slug}/raw/{id}/execs", get(routes::exec::by_raw))
        .route("/projects/{slug}/raw/{id}/merge", post(routes::raw::merge))
        .route("/projects/{slug}/raw/{id}/duplicate", post(routes::raw::duplicate))
        .route("/projects/{slug}/raw/{id}/ignore", post(routes::raw::ignore))
        .route("/projects/{slug}/raw/{id}/reopen", post(routes::raw::reopen))
        .route("/projects/{slug}/exec", get(routes::exec::list).post(routes::exec::create))
        .route("/projects/{slug}/exec/{id}", get(routes::exec::get).patch(routes::exec::patch))
        .route(
            "/projects/{slug}/exec/{id}/claim",
            post(routes::exec::claim).delete(routes::exec::release),
        )
        .route("/projects/{slug}/exec/{id}/complete", post(routes::exec::complete))
        .route("/projects/{slug}/exec/{id}/cancel", post(routes::exec::cancel))
        .route("/projects/{slug}/exec/{id}/reopen", post(routes::exec::reopen))
        .route("/projects/{slug}/exec/{id}/raws", get(routes::exec::raws))
        .route(
            "/projects/{slug}/raw/{id}/claim",
            post(routes::raw::claim).delete(routes::raw::release),
        )
        .route(
            "/projects/{slug}/files",
            post(routes::files::upload)
                .layer(axum::extract::DefaultBodyLimit::max(routes::files::MAX_BYTES + 64 * 1024)),
        )
        .route("/projects/{slug}/files/{id}", get(routes::files::download))
        .route_layer(axum::middleware::from_fn_with_state(state.clone(), idempotency::layer));


    let app = Router::new()
        .nest("/api/v1", api)
        .route("/healthz", get(|| async { "ok" }))
        .route("/install.sh", get(routes::dist::install_sh))
        .route("/install.ps1", get(routes::dist::install_ps1))
        .route("/download", get(routes::dist::download_page))
        .route("/dl/{artifact}", get(routes::dist::artifact))
        .fallback(assets::spa)
        .with_state(state);

    let addr: SocketAddr = std::env::var("WTOW_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse()?;
    tracing::info!(%addr, "wtow-server listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
