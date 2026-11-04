import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * 单二进制构建：Vite 产物 -> Rust 编译期嵌入 -> 输出到 dist/。
 *
 * 用法：
 *   bun run build          当前平台
 *   bun run build:win      Windows
 *   bun run build:mac      macOS
 *   bun run build:linux    Linux
 *
 * 交叉编译限制（故意显式失败，不产出坏文件）：
 *   - macOS 目标只能在 macOS 上链接（缺 Apple SDK），其他平台请交给 CI。
 *   - Linux 目标在非 Linux 主机上走 cargo-zigbuild（需 `cargo install cargo-zigbuild` + zig）。
 */

type Platform = "win" | "mac" | "linux";

interface Plan {
  triple: string;
  useZigbuild: boolean;
}

const host: Platform =
  process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";

function planFor(target: Platform): Plan {
  switch (target) {
    case "win":
      if (host === "win") return { triple: "x86_64-pc-windows-msvc", useZigbuild: false };
      if (host === "linux") return { triple: "x86_64-pc-windows-gnu", useZigbuild: true };
      throw new Error("在 macOS 上交叉编译 Windows 需要 mingw 工具链，请改用 CI。");

    case "linux":
      if (host === "linux") return { triple: "x86_64-unknown-linux-gnu", useZigbuild: false };
      return { triple: "x86_64-unknown-linux-musl", useZigbuild: true };

    case "mac":
      if (host !== "mac") {
        throw new Error(
          "macOS 目标只能在 macOS 上构建（缺 Apple SDK）。请用 .github/workflows/release.yml 出包。",
        );
      }
      return { triple: "aarch64-apple-darwin", useZigbuild: false };
  }
}

function run(args: string[], cwd: string): void {
  console.log(`\n$ ${args.join(" ")}`);
  const result = Bun.spawnSync({ cmd: args, cwd, stdio: ["inherit", "inherit", "inherit"] });
  if (result.exitCode !== 0) {
    throw new Error(`命令失败（exit ${result.exitCode}）：${args.join(" ")}\n${result.stderr}`);
  }
}

/** 从 Cargo.toml 读取 [[bin]] name，避免在脚本里重复项目名。 */
async function binName(serverDir: string): Promise<string> {
  const cargoToml = await Bun.file(join(serverDir, "Cargo.toml")).text();
  const match = cargoToml.match(/\[\[bin\]\][\s\S]*?name\s*=\s*"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error("apps/server/Cargo.toml 中未找到 [[bin]] name");
  }
  return match[1];
}

const target = process.argv[2] as Platform | undefined;
if (target && !["win", "mac", "linux"].includes(target)) {
  throw new Error(`未知目标 \`${target}\`，可选：win / mac / linux`);
}

const root = join(import.meta.dir, "..");
const plan = planFor(target ?? host);
const bin = await binName(join(root, "apps/server"));
const exe = plan.triple.includes("windows") ? ".exe" : "";

// 1. 前端产物（turbo 只构建 web，Rust 由下面的 cargo 命令负责）。
run(["bunx", "turbo", "run", "build", "--filter=./apps/web"], root);

// Vite 的 emptyOutDir 会清掉 .gitkeep；补回去，保证干净检出后 rust-embed 的目录始终存在。
await Bun.write(join(root, "apps/web/dist/.gitkeep"), "");

// 2. Rust 单二进制：dist/ 已就绪，rust-embed 会在编译期嵌入。
//    cargo-zigbuild 是 cargo 的子命令，用它替换 `build` 子命令。
const subcommand = plan.useZigbuild ? "zigbuild" : "build";
run(
  [
    "cargo",
    subcommand,
    "--release",
    "--target",
    plan.triple,
    "--manifest-path",
    "Cargo.toml",
    "--bin",
    bin,
  ],
  root,
);

// 3. 收集产物。
const outDir = join(root, "dist");
await mkdir(outDir, { recursive: true });

const built = join(root, "target", plan.triple, "release", `${bin}${exe}`);
if (!existsSync(built)) {
  throw new Error(`未找到构建产物：${built}`);
}

const finalName = `${basename(bin)}-${plan.triple}${exe}`;
const destination = join(outDir, finalName);
await copyFile(built, destination);

const sizeMb = ((await Bun.file(destination).size) / 1024 / 1024).toFixed(1);
console.log(`\n✓ ${destination}`);
console.log(`  target: ${plan.triple}`);
console.log(`  size:   ${sizeMb} MB`);
