use std::env;
use std::path::PathBuf;

use thiserror::Error;

/// 全部运行时配置的唯一来源。
/// 新增变量：在 `from_env` 读取 → 在 `.env` / `.env.example` 补默认值与说明 → 在 README 表格登记。
///
/// 变量沿用 `WTOW_*` 前缀（生产 compose 和服务器上的 `.env` 依赖这些名字），
/// 这里只是把散落在各处的 `std::env::var` 收敛到一处。
#[derive(Debug, Clone)]
pub struct Config {
    /// 必填，Postgres 连接串。
    pub database_url: String,
    /// `WTOW_BIND`，`HOST:PORT` 形式，交给 `TcpListener::bind` 解析。
    pub bind: String,
    /// `WTOW_PUBLIC_BASE_URL`，对外地址，用于安装脚本与下载页，不带尾部斜杠。
    pub public_base_url: String,
    /// `WTOW_ATTACHMENT_DIR`，附件存储根目录。
    pub attachment_dir: PathBuf,
    /// `WTOW_RELEASE_DIR`，CLI 产物与 `latest.json` 所在目录。
    pub release_dir: PathBuf,
    /// `WTOW_SUPERADMIN_EMAILS`，逗号分隔；注册或启动时自动提升为超管。
    pub superadmin_emails: Vec<String>,
    /// `WTOW_MINISIGN_PUBKEY`，配置后 `install.sh` 强制校验 `latest.json` 签名。
    pub minisign_pubkey: Option<String>,
    /// `RUST_LOG`。
    pub log_filter: String,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url = env::var("DATABASE_URL").unwrap_or_default();
        if database_url.trim().is_empty() {
            return Err(ConfigError::MissingDatabaseUrl);
        }

        Ok(Self {
            database_url,
            bind: env::var("WTOW_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_owned()),
            public_base_url: env::var("WTOW_PUBLIC_BASE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8080".to_owned())
                .trim_end_matches('/')
                .to_owned(),
            attachment_dir: env::var("WTOW_ATTACHMENT_DIR")
                .unwrap_or_else(|_| "./data/attachments".to_owned())
                .into(),
            release_dir: env::var("WTOW_RELEASE_DIR")
                .unwrap_or_else(|_| "./data/releases".to_owned())
                .into(),
            superadmin_emails: parse_emails(
                &env::var("WTOW_SUPERADMIN_EMAILS").unwrap_or_default(),
            ),
            minisign_pubkey: env::var("WTOW_MINISIGN_PUBKEY")
                .ok()
                .filter(|v| !v.is_empty()),
            log_filter: env::var("RUST_LOG")
                .unwrap_or_else(|_| "wtow_server=info,tower_http=info".to_owned()),
        })
    }
}

/// 逗号分隔的邮箱列表，去空白、转小写、丢掉空项。
pub fn parse_emails(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect()
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("DATABASE_URL 未设置，无法连接数据库")]
    MissingDatabaseUrl,
}

#[cfg(test)]
mod tests {
    use super::parse_emails;

    #[test]
    fn parses_emails_loosely() {
        assert_eq!(
            parse_emails(" A@x.com, b@y.com ,, "),
            vec!["a@x.com".to_owned(), "b@y.com".to_owned()]
        );
        assert!(parse_emails("").is_empty());
    }
}
