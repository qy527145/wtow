// 构建 wtow CLI 分发包（Windows + Linux），产出 `dist/cli/` 下的归档与 sha256。
//
//   bun run build:cli                        # Windows x64 + Linux x64/arm64
//   bun run build:cli linux                  # 只构建 Linux
//   bun run build:cli win aarch64-unknown-linux-musl
//   bun run build:cli --dir ./out            # 自定义输出目录（默认 dist/cli）
//
// 与 `bun run release` 的分工：release 面向正式发布（5 个目标 + latest.json + 签名，
// 依赖 cargo-xwin），这里只负责本机能完成的 CLI 打包，便于本地验证和手动分发。
//
// 工具链按主机自动选择：
//   - 目标与主机一致：直接用本机 cargo（Windows 主机 → MSVC，无需 cargo-xwin）。
//   - Linux 目标：cargo-zigbuild + zig，缺 rustup target 时自动补装。
//   - 归档：tar 自动识别 GNU/BSD 方言；zip 优先 `zip`，没有则用 7-Zip。

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { root } from "./config.ts";

type Kind = "win" | "linux";

interface Target {
  triple: string;
  kind: Kind;
  format: "tar.gz" | "zip";
  /** 包内文件名，与安装脚本保持一致。 */
  binary: string;
  label: string;
}

const TARGETS: Target[] = [
  {
    triple: "x86_64-unknown-linux-musl",
    kind: "linux",
    format: "tar.gz",
    binary: "wtow",
    label: "Linux x86_64",
  },
  {
    triple: "aarch64-unknown-linux-musl",
    kind: "linux",
    format: "tar.gz",
    binary: "wtow",
    label: "Linux arm64",
  },
  {
    triple: "x86_64-pc-windows-msvc",
    kind: "win",
    format: "zip",
    binary: "wtow.exe",
    label: "Windows x86_64",
  },
];

const ALIASES: Record<string, string[]> = {
  win: ["x86_64-pc-windows-msvc"],
  windows: ["x86_64-pc-windows-msvc"],
  linux: ["x86_64-unknown-linux-musl", "aarch64-unknown-linux-musl"],
};

/** 解析位置参数与 --dir，返回选中的目标。 */
function selectTargets(args: string[]): { targets: Target[]; outDir: string } {
  let outDir = join(root, "dist/cli");
  const selectors: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dir") {
      const value = args[++i];
      if (!value) throw new Error("--dir 需要一个目录参数");
      outDir = resolve(value);
    } else if (arg.startsWith("--dir=")) {
      outDir = resolve(arg.slice("--dir=".length));
    } else if (arg.startsWith("-")) {
      throw new Error(`未知参数 ${arg}`);
    } else {
      selectors.push(arg);
    }
  }

  if (selectors.length === 0) return { targets: TARGETS, outDir };

  const wanted = new Set<string>();
  for (const selector of selectors) {
    const triples =
      ALIASES[selector] ?? (TARGETS.some((t) => t.triple === selector) ? [selector] : []);
    if (triples.length === 0) {
      throw new Error(
        `未知目标 ${selector}，可选：win / linux / ${TARGETS.map((t) => t.triple).join(" / ")}`,
      );
    }
    for (const triple of triples) wanted.add(triple);
  }
  return { targets: TARGETS.filter((t) => wanted.has(t.triple)), outDir };
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

function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

const host = (await Bun.$`rustc -vV`.quiet().text()).match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("无法从 `rustc -vV` 读取 host target");

const installedRustTargets = new Set<string>();
if (await commandExists("rustup", ["--version"])) {
  const listed = Bun.spawnSync(["rustup", "target", "list", "--installed"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (listed.exitCode === 0) {
    for (const line of listed.stdout.toString().split(/\s+/)) {
      if (line) installedRustTargets.add(line);
    }
  }
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
    if (installedRustTargets.size > 0 && !installedRustTargets.has(t.triple)) {
      console.log(`\n补齐 Rust 标准库：rustup target add ${t.triple}`);
      if ((await run(["rustup", "target", "add", t.triple])) !== 0) {
        throw new Error(`rustup target add ${t.triple} 失败`);
      }
      installedRustTargets.add(t.triple);
    }
    return ["cargo", "zigbuild"];
  }

  if (t.kind === "win") {
    if (await commandExists("cargo-xwin")) return ["cargo", "xwin", "build"];
    throw new Error(
      `在 ${host} 上构建 Windows 目标需要 cargo-xwin：cargo install cargo-xwin。\n` +
        "（在 Windows 主机上重新运行即可直接用本机 MSVC。）",
    );
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

/** GNU tar 用 --owner/--group，BSD tar（macOS）用 --uid/--gid，先探测方言再选参数。 */
const gnuTar = (await Bun.$`tar --version`.quiet().nothrow().text()).includes("GNU tar");
const tarOwnerArgs = gnuTar
  ? ["--owner=0", "--group=0", "--numeric-owner"]
  : ["--uid", "0", "--gid", "0", "--uname", "root", "--gname", "root"];

const sevenZip = Bun.which("7z") ?? Bun.which("7za");
const hasZip = Bun.which("zip") !== null;

async function packTar(stage: string, binary: string, outDir: string, name: string): Promise<void> {
  // 输出用相对文件名并在 outDir 内执行：GNU tar 会把 `C:\...` 当成远程主机。
  const code = await run(["tar", ...tarOwnerArgs, "-czf", name, "-C", stage, binary], outDir);
  if (code !== 0) throw new Error(`tar 打包失败（exit ${code}）`);
}

async function packZip(stage: string, binary: string, outDir: string, name: string): Promise<void> {
  if (hasZip) {
    const code = await run(["zip", "-q", "-9", "-X", "-j", name, join(stage, binary)], outDir);
    if (code !== 0) throw new Error(`zip 打包失败（exit ${code}）`);
    return;
  }
  if (sevenZip) {
    // 在 stage 内执行，7-Zip 才会只存文件名而不是临时目录的完整路径。
    const code = await run(
      [sevenZip, "a", "-tzip", "-mx=9", "-bd", "-y", join(outDir, name), binary],
      stage,
    );
    if (code !== 0) throw new Error(`7-Zip 打包失败（exit ${code}）`);
    return;
  }
  throw new Error("打包 zip 需要 zip 或 7-Zip（7z）命令之一");
}

async function pack(t: Target, built: string, version: string, outDir: string) {
  const name = `wtow-v${version}-${t.triple}.${t.format}`;
  const stage = await mkdtemp(join(tmpdir(), "wtow-build-"));
  try {
    const staged = join(stage, t.binary);
    await copyFile(built, staged);
    // 固定 mtime，重复打包同一二进制得到相同字节。
    await utimes(staged, new Date(0), new Date(0));
    await mkdir(outDir, { recursive: true });
    const dest = join(outDir, name);
    if (t.format === "tar.gz") await packTar(stage, t.binary, outDir, name);
    else await packZip(stage, t.binary, outDir, name);

    const sum = sha256(await readFile(dest));
    await writeFile(`${dest}.sha256`, `${sum}  ${name}\n`);
    const size = ((await Bun.file(dest).size) / 1024 / 1024).toFixed(1);
    return { name, sum, size };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

const { targets, outDir } = selectTargets(process.argv.slice(2));
if (targets.length === 0) throw new Error("没有匹配的目标");

const workspaceToml = await readFile(join(root, "Cargo.toml"), "utf8");
const version = workspaceToml.match(/^version = "([^"]+)"/m)?.[1];
if (!version) throw new Error("Cargo.toml [workspace.package] 中未找到 version");

const results: Awaited<ReturnType<typeof pack>>[] = [];
for (const t of targets) {
  const built = await build(t);
  const result = await pack(t, built, version, outDir);
  console.log(`  ${result.name}  ${result.size} MB  ${result.sum.slice(0, 16)}…`);
  results.push(result);
}

console.log(`\n✓ ${results.length} 个包 → ${outDir}`);
console.log(`  host: ${host}`);
