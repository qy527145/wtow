// 构建跨平台 Skill 所需的 CLI，写入 `skills/wtow/bin/<platform>/`。
//
// 目录本身就是 `npx skills add` 可识别的 skill：
//   npx skills add qy527145/wtow@wtow        # 或 --skill wtow
// 安装后 SKILL.md 会按当前平台选择 bin/<platform>/wtow（Windows 为 wtow.exe）。
//
//   bun run build:cli              # 当前主机能做的目标（Windows 主机：windows-x64 + linux-x64/arm64）
//   bun run build:cli linux        # 只构建 Linux
//   bun run build:cli --all        # 全部目标，不支持的目标会明确报错
//   bun run build:cli <triple>...  # 精确指定
//
// 目标 → 平台目录（与 `wtow skill install` 的 skill_platform() 一致）：
//   x86_64-pc-windows-msvc      → windows-x64/wtow.exe
//   x86_64-unknown-linux-musl   → linux-x64/wtow
//   aarch64-unknown-linux-musl  → linux-arm64/wtow
//   aarch64-apple-darwin        → macos-arm64/wtow
//   x86_64-apple-darwin         → macos-x64/wtow
//
// 工具链：同构目标用本机 cargo；Linux 走 cargo-zigbuild（缺 rustup target 自动补装）；
// Windows 在非 Windows 主机上走 cargo-xwin；macOS 只能在 macOS 主机上链接。

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./config.ts";

type Kind = "win" | "linux" | "mac";

interface Target {
  triple: string;
  kind: Kind;
  /** skills/wtow/bin/ 下的平台目录，和 SKILL.md 的表格一一对应。 */
  platform: string;
  /** 包内文件名。 */
  binary: string;
  label: string;
}

const TARGETS: Target[] = [
  {
    triple: "x86_64-pc-windows-msvc",
    kind: "win",
    platform: "windows-x64",
    binary: "wtow.exe",
    label: "Windows x86_64",
  },
  {
    triple: "x86_64-unknown-linux-musl",
    kind: "linux",
    platform: "linux-x64",
    binary: "wtow",
    label: "Linux x86_64",
  },
  {
    triple: "aarch64-unknown-linux-musl",
    kind: "linux",
    platform: "linux-arm64",
    binary: "wtow",
    label: "Linux arm64",
  },
  {
    triple: "aarch64-apple-darwin",
    kind: "mac",
    platform: "macos-arm64",
    binary: "wtow",
    label: "macOS arm64",
  },
  {
    triple: "x86_64-apple-darwin",
    kind: "mac",
    platform: "macos-x64",
    binary: "wtow",
    label: "macOS x86_64",
  },
];

const ALIASES: Record<string, string[]> = {
  win: ["x86_64-pc-windows-msvc"],
  windows: ["x86_64-pc-windows-msvc"],
  linux: ["x86_64-unknown-linux-musl", "aarch64-unknown-linux-musl"],
  mac: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
  macos: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
  all: TARGETS.map((t) => t.triple),
};

const SKILL_DIR = join(root, "skills/wtow");

function selectTargets(args: string[], defaults: Target[]): Target[] {
  const selectors = args.filter((arg) => !arg.startsWith("-"));
  const unknown = args.find((arg) => arg.startsWith("-") && arg !== "--all");
  if (unknown) throw new Error(`未知参数 ${unknown}`);

  if (args.includes("--all")) return TARGETS;
  if (selectors.length === 0) return defaults;

  const wanted = new Set<string>();
  for (const selector of selectors) {
    const triples =
      ALIASES[selector] ?? (TARGETS.some((t) => t.triple === selector) ? [selector] : []);
    if (triples.length === 0) {
      throw new Error(
        `未知目标 ${selector}，可选：win / linux / mac / all / ${TARGETS.map((t) => t.triple).join(" / ")}`,
      );
    }
    for (const triple of triples) wanted.add(triple);
  }
  return TARGETS.filter((t) => wanted.has(t.triple));
}

async function run(cmd: string[], cwd = root, quiet = false): Promise<number> {
  if (!quiet) console.log(`\n$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    cwd,
    stdio: quiet ? ["ignore", "ignore", "ignore"] : ["inherit", "inherit", "inherit"],
  });
  return await proc.exited;
}

async function commandExists(cmd: string, args: string[] = ["--version"]): Promise<boolean> {
  try {
    return (await run([cmd, ...args], root, true)) === 0;
  } catch {
    return false;
  }
}

const host = (await Bun.$`rustc -vV`.quiet().text()).match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("无法从 `rustc -vV` 读取 host target");

const installedRustTargets = new Set<string>();
if (await commandExists("rustup")) {
  const listed = Bun.spawnSync(["rustup", "target", "list", "--installed"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (listed.exitCode === 0) {
    for (const line of listed.stdout.toString().split(/\s+/)) {
      if (line) installedRustTargets.add(line);
    }
  }
}

const hasXwin = Bun.which("cargo-xwin") !== null;
const isMacHost = host.endsWith("-apple-darwin");

/** 默认只选当前主机真能产出的目标，避免一条命令因为缺工具链整体失败。 */
function defaultTargets(): Target[] {
  return TARGETS.filter((t) => {
    if (t.triple === host) return true;
    if (t.kind === "linux") return true;
    if (t.kind === "win") return hasXwin;
    return isMacHost;
  });
}

async function ensureRustTarget(triple: string): Promise<void> {
  if (installedRustTargets.size === 0 || installedRustTargets.has(triple)) return;
  console.log(`\n补齐 Rust 标准库：rustup target add ${triple}`);
  if ((await run(["rustup", "target", "add", triple])) !== 0) {
    throw new Error(`rustup target add ${triple} 失败`);
  }
  installedRustTargets.add(triple);
}

let zigbuildChecked = false;
async function ensureToolchain(t: Target): Promise<string[]> {
  if (t.triple === host) return ["cargo", "build"];

  if (t.kind === "linux") {
    if (!zigbuildChecked) {
      zigbuildChecked = true;
      if (!Bun.which("cargo-zigbuild") || !Bun.which("zig")) {
        throw new Error(
          "交叉编译 Linux 需要 cargo-zigbuild 与 zig：\n" +
            "  cargo install cargo-zigbuild\n" +
            "  （zig 需自行安装并加入 PATH）",
        );
      }
    }
    await ensureRustTarget(t.triple);
    return ["cargo", "zigbuild"];
  }

  if (t.kind === "win") {
    if (hasXwin) return ["cargo", "xwin", "build"];
    throw new Error(
      `在 ${host} 上构建 Windows 目标需要 cargo-xwin：cargo install cargo-xwin。\n` +
        "（在 Windows 主机上重新运行即可直接用本机 MSVC。）",
    );
  }

  if (t.kind === "mac") {
    if (!isMacHost) {
      throw new Error("macOS 目标只能在 macOS 主机上构建（缺 Apple SDK），请交给 macOS 或 CI。");
    }
    await ensureRustTarget(t.triple);
    return ["cargo", "build"];
  }

  throw new Error(`不支持的目标 ${t.triple}`);
}

async function build(t: Target): Promise<string> {
  console.log(`\n▸ ${t.label} (${t.triple})`);
  const cmd = await ensureToolchain(t);
  const code = await run([...cmd, "--release", "-p", "wtow-cli", "--target", t.triple]);
  if (code !== 0) throw new Error(`${t.triple} 构建失败（exit ${code}）`);

  const built = join(
    root,
    "target",
    t.triple,
    "release",
    t.kind === "win" ? "wtow-cli.exe" : "wtow-cli",
  );
  if (!existsSync(built)) throw new Error(`未找到构建产物：${built}`);
  return built;
}

async function install(t: Target, built: string): Promise<string> {
  const dest = join(SKILL_DIR, "bin", t.platform, t.binary);
  await mkdir(join(SKILL_DIR, "bin", t.platform), { recursive: true });
  await copyFile(built, dest);
  // Git 在 Windows 上不记录可执行位，提交前用 `git update-index --chmod=+x` 补上。
  if (t.kind !== "win") await chmod(dest, 0o755);
  const size = ((await Bun.file(dest).size) / 1024 / 1024).toFixed(1);
  return `${dest}  ${size} MB`;
}

if (!existsSync(join(SKILL_DIR, "SKILL.md"))) {
  throw new Error(`未找到 ${join(SKILL_DIR, "SKILL.md")}，skills/wtow/ 目录不完整`);
}

const targets = selectTargets(process.argv.slice(2), defaultTargets());
if (targets.length === 0) throw new Error("没有匹配的目标");

const results: string[] = [];
for (const t of targets) {
  const built = await build(t);
  const installed = await install(t, built);
  console.log(`  → ${installed}`);
  results.push(t.platform);
}

console.log(`\n✓ ${results.length} 个平台 → ${join(SKILL_DIR, "bin")}`);
console.log(`  ${results.join(", ")}`);
console.log("\n分发：npx skills add qy527145/wtow@wtow");
console.log("本地：wtow skill install   # 会连同当前可执行文件一起装进 skill");
