//! Agent 的本地状态：设备 UUID 的生成与持久化，以及主机名探测。
//!
//! 内置在 CLI 里，因此不再有独立的配置文件：服务地址来自命令行 / 环境变量 /
//! 用户配置，UUID 固定存在 `~/.config/wtow/agent-id`（Windows 为 `%APPDATA%`），
//! 与现成的客户端保持同一套位置约定，便于两边共用一台机器。

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, process};

#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// 反馈中心地址，形如 `wtow.internal:9705`。
    pub server: String,
    /// 设备唯一标识。
    pub uuid: String,
    /// PING 间隔（秒）。
    pub heartbeat_secs: u64,
    /// SEND_FILE 的落地目录，同时作为相对路径的基准。
    pub workdir: PathBuf,
}

/// UUID 文件位置：与 CLI 的 config.toml 同目录。
pub fn id_file_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("wtow").join("agent-id"))
}

/// 读取已有 UUID；不存在或为空时生成并写回。
pub fn load_or_create_uuid() -> Result<String, String> {
    let path =
        id_file_path().ok_or("无法定位配置目录，请用 --uuid 显式指定设备标识".to_string())?;
    if let Ok(existing) = fs::read_to_string(&path) {
        let existing = existing.trim().to_string();
        if !existing.is_empty() {
            return Ok(existing);
        }
    }

    let uuid = generate_uuid();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("创建 {} 失败: {err}", parent.display()))?;
    }
    fs::write(&path, &uuid).map_err(|err| format!("写入 {} 失败: {err}", path.display()))?;
    eprintln!(
        "[wtow agent] 已生成设备标识 {uuid} 并保存到 {}",
        path.display()
    );
    Ok(uuid)
}

/// 已登记的 UUID；没有就返回 None（用于在 feedback 上下文里附带设备标识）。
pub fn existing_uuid() -> Option<String> {
    let path = id_file_path()?;
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 生成一个 UUID v4 形态的标识。
///
/// 不引入 rand crate：以时间戳、进程号、主机名哈希与一次堆地址做种，
/// 走 xorshift64* 展开成 128 bit。它只用于设备标识去重，不承担安全语义。
fn generate_uuid() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0);
    let mut seed = nanos
        ^ ((process::id() as u64) << 32)
        ^ hash_bytes(hostname().as_bytes())
        ^ (&nanos as *const u64 as u64);

    let mut next = || {
        // xorshift64*
        seed ^= seed >> 12;
        seed ^= seed << 25;
        seed ^= seed >> 27;
        seed.wrapping_mul(0x2545_F491_4F6C_DD1D)
    };

    let hi = next();
    let lo = next();
    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&hi.to_be_bytes());
    bytes[8..].copy_from_slice(&lo.to_be_bytes());
    // 打上 RFC 4122 的版本位（4）与变体位（10xx），使其形如标准 UUID。
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    // FNV-1a，够用即可。
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash
}

pub fn hostname() -> String {
    for key in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(value) = env::var(key)
            && !value.trim().is_empty()
        {
            return value.trim().to_string();
        }
    }
    fs::read_to_string("/etc/hostname")
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown-host".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_distinct_uuids() {
        let a = generate_uuid();
        let b = generate_uuid();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
    }

    #[test]
    fn hostname_is_never_empty() {
        assert!(!hostname().trim().is_empty());
    }
}
