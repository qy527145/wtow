import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * 从 crates/contract 的 DTO 生成 TS 类型到 packages/shared/src/bindings。
 * ts-rs 通过 `cargo test` 导出，输出目录与整数映射见 .cargo/config.toml。
 * 改了 dto.rs / error.rs 之后跑一次；`bun run check` 会校验产物没有过期。
 */

const root = join(import.meta.dir, "..");
const dir = join(root, "packages/shared/src/bindings");

const result = Bun.spawnSync({
  cmd: ["cargo", "test", "-q", "-p", "contract", "export_bindings"],
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});
if (result.exitCode !== 0) {
  throw new Error("ts-rs 导出失败");
}

const names = (await readdir(dir))
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .map((f) => f.slice(0, -3))
  .sort();

const header = "// 由 scripts/types.ts 生成，不要手改。\n";
const body = names.map((n) => `export type * from "./${n}";`).join("\n");
await Bun.write(join(dir, "index.ts"), `${header}${body}\n`);

console.log(`✓ ${names.length} 个类型 → packages/shared/src/bindings`);
