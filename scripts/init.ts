import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 一键初始化：检查工具链 -> 安装依赖 -> 准备 .env -> 提示下一步。
 * 幂等，可重复执行。
 */

const root = join(import.meta.dir, "..");

function check(cmd: string, args: string[], hint: string): string | null {
  const result = Bun.spawnSync({ cmd: [cmd, ...args], stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    console.warn(`⚠ ${cmd} 不可用：${hint}`);
    return null;
  }
  return result.stdout.toString().trim().split("\n")[0] ?? "";
}

console.log("检查工具链…");
check("bun", ["--version"], "安装 Bun: https://bun.sh");
const cargo = check("cargo", ["--version"], "安装 Rust: https://rustup.rs");
console.log(`  bun   ${Bun.version}`);
console.log(`  cargo ${cargo ?? "(缺失)"}`);

console.log("\n安装依赖…");
const install = Bun.spawnSync({
  cmd: ["bun", "install"],
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});
if (install.exitCode !== 0) {
  throw new Error("依赖安装失败");
}

// .env 已提交（只含非敏感默认值），这里只确保本地密钥文件存在。
const localPath = join(root, ".env.local");
if (!existsSync(localPath)) {
  await Bun.write(
    localPath,
    "# 本地覆盖与密钥，不提交。例如：\n# WTOW_SUPERADMIN_EMAILS=you@example.com\n",
  );
  console.log("\n已创建 .env.local（本地覆盖，不提交）");
} else {
  console.log("\n.env.local 已存在，保持不变");
}

console.log(`
完成。下一步：

  bun run dev       # 起 Postgres，再同时起 Vite 与 axum
  bun run check     # lint + 类型检查 + clippy
  bun run build     # 单二进制构建
`);
