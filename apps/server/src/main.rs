use std::sync::Arc;

use sqlx::postgres::PgPoolOptions;
use tokio::net::TcpListener;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

mod api;
mod app;
mod assets;
mod auth;
mod config;
mod error;
mod idempotency;
mod state;

use config::Config;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load_dotenv();

    let config = Config::from_env()?;
    init_tracing(&config.log_filter);

    let db = PgPoolOptions::new()
        .max_connections(16)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&db).await?;

    // 名单里的邮箱每次启动都提升为超管；撤销需在面板里操作，不会因从名单删掉而自动降级。
    if !config.superadmin_emails.is_empty() {
        let n = sqlx::query(
            "UPDATE users SET is_superadmin = true WHERE email = ANY($1) AND NOT is_superadmin",
        )
        .bind(&config.superadmin_emails)
        .execute(&db)
        .await?
        .rows_affected();
        tracing::info!(promoted = n, "superadmin emails applied");
    }

    let listener = TcpListener::bind(&config.bind).await?;
    let local_addr = listener.local_addr()?;

    let state = AppState::new(db, Arc::new(config));
    tokio::spawn(idempotency::release_stale_claims(state.clone()));

    tracing::info!(addr = %local_addr, version = env!("CARGO_PKG_VERSION"), "wtow-server listening");

    axum::serve(listener, app::router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("shutdown complete");
    Ok(())
}

/// 从当前目录向上查找 `.env`，再叠加同目录的 `.env.local`（本地密钥，不提交）。
/// 都找不到时静默使用进程环境，便于直接运行发布产物或在容器里注入配置。
fn load_dotenv() {
    for dir in [".", "..", "../.."] {
        let base = std::path::Path::new(dir);
        if base.join(".env").is_file() {
            // `.env.local` 先加载：dotenvy 不覆盖已有变量，先到者优先。
            let _ = dotenvy::from_path(base.join(".env.local"));
            let _ = dotenvy::from_path(base.join(".env"));
            return;
        }
    }
}

fn init_tracing(filter: &str) {
    let env_filter = tracing_subscriber::EnvFilter::try_new(filter)
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }

    tracing::info!("shutdown signal received");
}
