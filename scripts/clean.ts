import { rm } from "node:fs/promises";
import { join } from "node:path";

/** 清理所有构建产物与依赖，保留 apps/web/dist/.gitkeep。 */
const root = join(import.meta.dir, "..");

const targets = [
  "target",
  "node_modules",
  "dist",
  ".turbo",
  "apps/web/node_modules",
  "apps/web/dist",
  "apps/server/node_modules",
  "packages/ui/node_modules",
  "packages/shared/node_modules",
  // 运行时数据（附件、CLI 产物）不在这里清，见 `bun run db:reset`。
];

for (const relative of targets) {
  const path = join(root, relative);
  await rm(path, { recursive: true, force: true });
  console.log(`removed ${relative}`);
}

// rust-embed 要求该目录存在，否则编译失败。
await Bun.write(join(root, "apps/web/dist/.gitkeep"), "");
console.log("restored apps/web/dist/.gitkeep");
