// 生成 CLI 发布产物（tar.gz + sha256）并维护 latest.json，供 /install.sh 与 /download 下发。见 DESIGN 16.2 / 16.3。
//
//   bun run release                    # 只为当前主机架构打包
//   bun run release --target x86_64-unknown-linux-musl
//   bun run release --base-url https://wtow.internal --dir ./data/releases
//
// latest.json 最后写，且用临时文件 rename，避免安装脚本读到指向不存在产物的清单。
import { $ } from "bun";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = `${import.meta.dir}/..`;
const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function require_(value: string | undefined, what: string): string {
  if (!value) throw new Error(`missing ${what}`);
  return value;
}

const host = require_((await $`rustc -vV`.quiet().text()).match(/^host: (.+)$/m)?.[1], "host target from `rustc -vV`");
const target = flag("target") ?? host;
const baseUrl = (flag("base-url") ?? process.env.WTOW_PUBLIC_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const outDir = flag("dir") ?? process.env.WTOW_RELEASE_DIR ?? `${root}/data/releases`;

// 版本取自 CLI crate，min_cli_version 取自服务端 /meta，两边始终和实际代码一致。
const cliToml = await readFile(`${root}/cli/Cargo.toml`, "utf8");
const version = require_(cliToml.match(/^version = "([^"]+)"/m)?.[1], "version in cli/Cargo.toml");
const metaRs = await readFile(`${root}/server/src/routes/meta.rs`, "utf8");
const minCliVersion = require_(metaRs.match(/MIN_CLI_VERSION: &str = "([^"]+)"/)?.[1], "MIN_CLI_VERSION");

console.log(`building wtow-cli v${version} for ${target}…`);
const cargoArgs = ["build", "--release", "-p", "wtow-cli"];
if (target !== host) cargoArgs.push("--target", target);
await $`cargo ${cargoArgs}`.cwd(root);

const built = target === host
  ? `${root}/target/release/wtow-cli`
  : `${root}/target/${target}/release/wtow-cli`;

// 安装脚本解包后直接取 $tmp/wtow，所以包内必须叫 wtow，与 crate 名 wtow-cli 不同。
const stage = await mkdtemp(join(tmpdir(), "wtow-release-"));
const name = `wtow-v${version}-${target}.tar.gz`;
try {
  await copyFile(built, `${stage}/wtow`);
  await $`chmod 755 ${stage}/wtow`;
  // 固定 mtime 与属主，重复打包同一二进制得到相同字节；否则每次复制都会带上当前时间。
  const fixed = new Date(0);
  await utimes(`${stage}/wtow`, fixed, fixed);
  await mkdir(outDir, { recursive: true });
  await $`tar --uid 0 --gid 0 --uname root --gname root --exclude '._*' -czf ${join(outDir, name)} -C ${stage} wtow`
    .env({ ...process.env, COPYFILE_DISABLE: "1" });
} finally {
  await rm(stage, { recursive: true, force: true });
}

const sha256 = createHash("sha256").update(await readFile(join(outDir, name))).digest("hex");
await writeFile(`${outDir}/${name}.sha256`, `${sha256}  ${name}\n`);

// 同一目录可能已含其它架构的产物，按 target 合并而不是覆盖。
const manifestPath = join(outDir, "latest.json");
type Artifact = { target: string; url: string; sha256: string };
let previous: Artifact[] = [];
try {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as { artifacts?: Artifact[] };
  previous = parsed.artifacts ?? [];
} catch {
  // 首次发布，没有旧清单。
}
const artifacts = [
  ...previous.filter((a) => a.target !== target),
  { target, url: `${baseUrl}/dl/${name}`, sha256 },
];

// install.sh 用 grep 按行解析，所以每个 artifact 必须独占一行。
const lines = artifacts.map((a) =>
  `    { "target": "${a.target}", "url": "${a.url}", "sha256": "${a.sha256}" }`);
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

// 配了私钥才签名；没配时 install.sh 会提示只校验 sha256。
const key = process.env.WTOW_MINISIGN_SECRET_KEY;
if (key) {
  const has = await $`command -v minisign`.quiet().nothrow();
  if (has.exitCode !== 0) throw new Error("WTOW_MINISIGN_SECRET_KEY is set but minisign is not installed");
  await $`minisign -Sm ${manifestPath} -s ${key}`;
  console.log("signed latest.json");
} else {
  console.log("note: WTOW_MINISIGN_SECRET_KEY not set, latest.json is unsigned");
}

console.log(`\n${name}\n  sha256 ${sha256}\n  → ${manifestPath}`);
