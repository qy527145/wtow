// 部署相关脚本共用的配置读取。`deploy/.env` 是本地文件（已 gitignore），只放部署参数；
// 生产机密（如数据库密码）在服务器上生成并保管，不进仓库。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

export type DeployConfig = {
  sshHost: string;
  remoteDir: string;
  publicBaseUrl: string;
  hostBind: string;
  pgPort: string;
};

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * `deploy/.env` 优先于进程环境变量：bun 会自动把根目录的开发 `.env` 载入 process.env，
 * 里面的 127.0.0.1 地址若占了上风，产物清单和服务器配置都会指向本机。
 * 没有 `deploy/.env` 时（例如只想本地 release）才回落到环境变量。
 */
export function deployConfig(): DeployConfig {
  const file = readEnvFile(join(root, "deploy/.env"));
  const pick = (key: string, fallback: string) => file[key] ?? process.env[key] ?? fallback;
  return {
    sshHost: pick("WTOW_SSH_HOST", "kt"),
    remoteDir: pick("WTOW_REMOTE_DIR", "/opt/wtow"),
    publicBaseUrl: pick("WTOW_PUBLIC_BASE_URL", "http://127.0.0.1:8080").replace(/\/+$/, ""),
    hostBind: pick("WTOW_HOST_BIND", "8090"),
    pgPort: pick("WTOW_PG_PORT", "15432"),
  };
}

export { root };
