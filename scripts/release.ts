// 生成 CLI 发布产物并维护 latest.json，供 /install.sh、/install.ps1 与 /download 下发。见 DESIGN 16.2 / 16.3。
//
//   bun run release                       # 交叉编译全部 5 个目标
//   bun run release --target x86_64-unknown-linux-musl
//   bun run release --base-url http://47.97.189.132:8090 --dir ./data/releases
//
// macOS 用自带的 Apple SDK，Linux 走 cargo-zigbuild（musl 静态链接），Windows 走 cargo-xwin。
// latest.json 最后写，且用临时文件 rename，避免安装脚本读到指向不存在产物的清单。

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { deployConfig, root } from "./config.ts";

type Target = {
  triple: string;
  /** 打包与安装脚本用；windows 是 zip，其余是 tar.gz。 */
  format: "tar.gz" | "zip";
  /** 包内文件名，安装脚本按这个名字取。 */
  binary: string;
  /** 交叉编译器：zigbuild 走 musl，xwin 走 MSVC，cargo 用本机 SDK。 */
  linker: "cargo" | "zigbuild" | "xwin";
  label: string;
};

export const TARGETS: Target[] = [
  {
    triple: "aarch64-apple-darwin",
    format: "tar.gz",
    binary: "wtow",
    linker: "cargo",
    label: "macOS (Apple Silicon)",
  },
  {
    triple: "x86_64-apple-darwin",
    format: "tar.gz",
    binary: "wtow",
    linker: "cargo",
    label: "macOS (Intel)",
  },
  {
    triple: "x86_64-unknown-linux-musl",
    format: "tar.gz",
    binary: "wtow",
    linker: "zigbuild",
    label: "Linux x86_64",
  },
  {
    triple: "aarch64-unknown-linux-musl",
    format: "tar.gz",
    binary: "wtow",
    linker: "zigbuild",
    label: "Linux arm64",
  },
  {
    triple: "x86_64-pc-windows-msvc",
    format: "zip",
    binary: "wtow.exe",
    linker: "xwin",
    label: "Windows x86_64",
  },
];

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function require_(value: string | undefined, what: string): string {
  if (!value) throw new Error(`missing ${what}`);
  return value;
}

function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

const host = require_(
  (await $`rustc -vV`.quiet().text()).match(/^host: (.+)$/m)?.[1],
  "host target from `rustc -vV`",
);
const only = flag("target");
const targets = only ? TARGETS.filter((t) => t.triple === only) : TARGETS;
if (targets.length === 0)
  throw new Error(`unknown --target ${only}，可选：${TARGETS.map((t) => t.triple).join(", ")}`);

const cfg = deployConfig();
const baseUrl = (flag("base-url") ?? cfg.publicBaseUrl).replace(/\/+$/, "");
const outDir = flag("dir") ?? process.env.WTOW_RELEASE_DIR ?? `${root}/data/releases`;

// 版本取自 CLI crate，min_cli_version 取自服务端 /meta，两边始终和实际代码一致。
// 版本在根 Cargo.toml 的 [workspace.package] 里统一维护。
const workspaceToml = await readFile(`${root}/Cargo.toml`, "utf8");
const version = require_(
  workspaceToml.match(/^version = "([^"]+)"/m)?.[1],
  "version in Cargo.toml [workspace.package]",
);
const metaRs = await readFile(`${root}/apps/server/src/api/meta.rs`, "utf8");
const minCliVersion = require_(
  metaRs.match(/MIN_CLI_VERSION: &str = "([^"]+)"/)?.[1],
  "MIN_CLI_VERSION",
);

async function build(t: Target): Promise<string> {
  console.log(`\n▸ ${t.label} (${t.triple})`);
  const flags = ["--release", "-p", "wtow-cli", "--target", t.triple];
  if (t.linker === "zigbuild") {
    // cargo-zigbuild 自身就是子命令，参数直接接在后面，不能再写 build。
    await $`cargo zigbuild ${flags}`.cwd(root);
  } else if (t.linker === "xwin") {
    await $`cargo xwin build ${flags}`.cwd(root);
  } else {
    await $`cargo build ${flags}`.cwd(root);
  }
  // cargo 产物名取自 crate（wtow-cli），而安装脚本和包内文件名要短（wtow），两者不同。
  const built = `${root}/target/${t.triple}/release/${t.triple.includes("windows") ? "wtow-cli.exe" : "wtow-cli"}`;
  await $`test -f ${built}`.quiet();
  return built;
}

async function pack(t: Target, built: string): Promise<{ name: string; sha256: string }> {
  const name = `wtow-v${version}-${t.triple}.${t.format}`;
  const stage = await mkdtemp(join(tmpdir(), "wtow-release-"));
  try {
    const staged = join(stage, t.binary);
    await copyFile(built, staged);
    await $`chmod 755 ${staged}`;
    // 固定 mtime 与属主，重复打包同一二进制得到相同字节；否则每次复制都会带上当前时间。
    const fixed = new Date(0);
    await utimes(staged, fixed, fixed);
    await mkdir(outDir, { recursive: true });
    if (t.format === "tar.gz") {
      await $`tar --uid 0 --gid 0 --uname root --gname root --exclude '._*' -czf ${join(outDir, name)} -C ${stage} ${t.binary}`.env(
        { ...process.env, COPYFILE_DISABLE: "1" },
      );
    } else {
      // -X 去掉扩展属性与 uid/gid，保证同一输入产出同一字节。
      await $`zip -q -9 -X -j ${join(outDir, name)} ${staged}`;
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  const sum = sha256(await readFile(join(outDir, name)));
  await writeFile(`${outDir}/${name}.sha256`, `${sum}  ${name}\n`);
  return { name, sha256: sum };
}

const produced: { target: string; url: string; sha256: string }[] = [];
for (const t of targets) {
  const built = await build(t);
  const { name, sha256: sum } = await pack(t, built);
  console.log(`  ${name}  ${sum.slice(0, 16)}…`);
  produced.push({ target: t.triple, url: `${baseUrl}/dl/${name}`, sha256: sum });
}

// 同一目录可能已含其它目标（尤其按 --target 单独发布时），按 target 合并而不是覆盖。
const manifestPath = join(outDir, "latest.json");
type Artifact = { target: string; url: string; sha256: string };
let previous: Artifact[] = [];
try {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as { artifacts?: Artifact[] };
  previous = parsed.artifacts ?? [];
} catch {
  // 首次发布，没有旧清单。
}
const fresh = new Set(produced.map((a) => a.target));
const order = TARGETS.map((t) => t.triple);
const artifacts = [...previous.filter((a) => !fresh.has(a.target)), ...produced].sort(
  (a, b) => order.indexOf(a.target) - order.indexOf(b.target),
);

// install.sh 用 grep 按行解析，所以每个 artifact 必须独占一行。
const lines = artifacts.map(
  (a) => `    { "target": "${a.target}", "url": "${a.url}", "sha256": "${a.sha256}" }`,
);
const manifest = `{
  "version": "${version}",
  "min_cli_version": "${minCliVersion}",
  "artifacts": [
${lines.join(",\n")}
  ]
}
`;
await writeFile(`${manifestPath}.tmp`, manifest);
await rename(`${manifestPath}.tmp`, manifestPath);

// 配了私钥才签名；没配时安装脚本会提示只校验 sha256。
const key = process.env.WTOW_MINISIGN_SECRET_KEY;
if (key) {
  const has = await $`command -v minisign`.quiet().nothrow();
  if (has.exitCode !== 0)
    throw new Error("WTOW_MINISIGN_SECRET_KEY is set but minisign is not installed");
  await $`minisign -Sm ${manifestPath} -s ${key}`;
  console.log("\nsigned latest.json");
} else {
  console.log("\nnote: WTOW_MINISIGN_SECRET_KEY not set, latest.json is unsigned");
}

console.log(`\n${targets.length} 个产物 → ${outDir}`);
console.log(`  latest.json v${version} (${artifacts.length} targets, base ${baseUrl})`);
console.log(`  build host: ${host}`);
