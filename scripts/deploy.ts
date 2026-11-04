// 一键部署到服务器：交叉编译服务端 → 打包 → rsync → 服务器上 docker compose 起容器 → 健康检查。
//
//   bun run deploy                    # 完整部署（编译 + 上传 + 重启）
//   bun run deploy --skip-build       # 复用上次编译的服务端二进制
//   bun run deploy --skip-cli         # 不重新打 CLI 产物包
//   bun run deploy --logs             # 部署完跟一段日志
//
// 服务器布局（默认 /opt/wtow，见 deploy/.env）：
//   .env                 生产配置，首次部署自动生成随机数据库密码，之后人工维护
//   compose.yml          容器编排
//   Dockerfile.app       运行镜像
//   build/wtow-server    交叉编译的静态二进制
//   data/attachments     附件（挂载进容器）
//   data/releases        CLI 产物与 latest.json
//
// 设计要点：
// - 服务器上不装 Rust，本地交叉编译出 x86_64-unknown-linux-musl 静态二进制再上传。
// - 容器镜像跑在 docker.1ms.run 镜像源上，避免直连 Docker Hub。
// - 重复部署是安全的：先在临时目录 prepare，再原子替换 build/，最后 compose up 重建。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { deployConfig, root } from "./config.ts";

const args = process.argv.slice(2);
const has = (name: string) => args.includes(`--${name}`);
const skipBuild = has("skip-build");
const skipCli = has("skip-cli");
const followLogs = has("logs");

const cfg = deployConfig();
const { sshHost, remoteDir } = cfg;
const linuxTarget = "x86_64-unknown-linux-musl";
const t0 = performance.now();
const step = (msg: string) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`);
const done = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);

function require_(value: string | undefined, what: string): string {
  if (!value) throw new Error(`missing ${what}`);
  return value;
}

// ── 0. 预检 ────────────────────────────────────────────────────────────────
step("检查本地环境与目标服务器");
for (const tool of ["cargo", "bun", "rsync", "ssh", "zip"]) {
  const r = await $`command -v ${tool}`.quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`${tool} 未安装`);
}
const zig = await $`command -v cargo-zigbuild`.quiet().nothrow();
if (zig.exitCode !== 0) throw new Error("cargo-zigbuild 未安装：cargo install cargo-zigbuild");
done("本地工具链齐全");

const remoteCheck =
  await $`ssh -o ConnectTimeout=10 ${sshHost} 'docker version --format "{{.Server.Version}}" && docker compose version --short'`
    .quiet()
    .nothrow()
    .text()
    .catch(() => "");
if (!remoteCheck.trim())
  throw new Error(`无法通过 ssh ${sshHost} 连上服务器，或服务器上没有 docker/compose`);
const [dockerVer, composeVer] = remoteCheck.trim().split("\n");
done(`服务器 docker ${dockerVer} / compose ${composeVer}`);

// ── 1. 编译 ────────────────────────────────────────────────────────────────
const serverBin = `${root}/target/${linuxTarget}/release/wtow-server`;
if (skipBuild) {
  await $`test -f ${serverBin}`
    .quiet()
    .nothrow()
    .then((r) => {
      if (r.exitCode !== 0) throw new Error(`--skip-build 但找不到 ${serverBin}`);
    });
  done(`复用 ${serverBin}`);
} else {
  step(`编译服务端（${linuxTarget}，musl 静态链接）`);
  await $`bun run build:web`.cwd(root);
  await $`cargo zigbuild --release --target ${linuxTarget} -p wtow-server`.cwd(root);
  done(
    `${((await readFile(serverBin)).length / 1024 / 1024) | 0} MB → target/${linuxTarget}/release/wtow-server`,
  );
}

// ── 2. CLI 产物 ────────────────────────────────────────────────────────────
// 产物要跟着服务端一起进 data/releases，否则 /install.sh 拿到的是旧清单。
if (skipCli) {
  done("跳过 CLI 打包");
} else {
  step("打包 CLI（5 个平台）");
  await $`bun run scripts/release.ts --base-url ${cfg.publicBaseUrl} --dir ${root}/data/releases`.cwd(
    root,
  );
}

// ── 3. 上传 ────────────────────────────────────────────────────────────────
step(`上传到 ${sshHost}:${remoteDir}`);
// 先建目录前缀，再按需同步。
await $`ssh ${sshHost} 'mkdir -p ${remoteDir}/data/attachments ${remoteDir}/data/releases'`;

// 新镜像的构建上下文（Dockerfile + 二进制）先传到 image.incoming，启动时再整体换成 image/。
const staging = `${remoteDir}/image.incoming`;
await $`ssh ${sshHost} 'rm -rf ${staging} && mkdir -p ${staging}'`;
// macOS 自带 rsync 是 2.6.9，不认 --info=/--no-inc-recursive 等新参数，只用两版都有的。
await $`rsync -az --stats ${serverBin} ${join(root, "deploy/Dockerfile")} ${sshHost}:${staging}/`;
await $`rsync -az ${join(root, "deploy/compose.yml")} ${sshHost}:${remoteDir}/`;

// releases 是只增不减的产物目录，用 --delete 让本地成为唯一事实来源；
// attachments 绝不能用 --delete：服务器上的附件是生产数据，本地没有不代表要删。
await $`rsync -az --delete ${join(root, "data/releases")}/ ${sshHost}:${remoteDir}/data/releases/`;
done("服务端二进制、compose 配置、CLI 产物已同步");

// ── 4. 服务器上起容器 ──────────────────────────────────────────────────────
step("配置并启动容器");

// 生产 .env 首次部署生成，之后不覆盖（里面是线上数据库密码）。
const envTemplate = `# 由 scripts/deploy.ts 于首次部署时生成，之后由人工维护。
WTOW_PG_PASSWORD=__PASSWORD__
WTOW_PUBLIC_BASE_URL=${cfg.publicBaseUrl}
WTOW_HOST_BIND=${cfg.hostBind}
WTOW_PG_PORT=${cfg.pgPort}
WTOW_PG_IMAGE=postgres:17
RUST_LOG=wtow_server=info
TZ=Asia/Shanghai
`;

// 用 openssl 在服务器上现生成密码，口令不经过本地 shell 历史。
const initEnv = `
set -eu
cd ${remoteDir}
if [ ! -f .env ]; then
  pw=$(openssl rand -hex 24)
  cat > .env <<'WTOW_ENV_EOF'
${envTemplate}
WTOW_ENV_EOF
  # 占位符换成真实密码；用 | 做分隔符，hex 密码里不会有它。
  sed -i "s|__PASSWORD__|$pw|" .env
  chmod 600 .env
  echo "  generated .env with a random database password"
else
  echo "  .env 已存在，保持不动"
fi
# 新增或变化的变量以服务器上的 .env 为准；这里只补缺失项，避免覆盖人工改过的值。
grep -q '^WTOW_PG_IMAGE=' .env || echo "WTOW_PG_IMAGE=postgres:17" >> .env
grep -q '^TZ=' .env || echo "TZ=Asia/Shanghai" >> .env
`;
await $`ssh ${sshHost} ${initEnv}`;

// compose 在服务器上解析 .env，所以数据库密码不会回到本地。
const up = `
set -eu
cd ${remoteDir}
# 替换 image/，上一版二进制留在 image.prev 作回滚。
rm -rf image.prev
mv image image.prev 2>/dev/null || true
mv ${staging} image
# 容器内以 uid 10001 运行，而 ./data 是 root 拥有的 bind mount，不改属主会写不进附件。
mkdir -p data/attachments data/releases
chown -R 10001:10001 data/attachments data/releases
docker compose -f compose.yml up -d --build --remove-orphans
`;
await $`ssh ${sshHost} ${up}`;

// ── 5. 健康检查 ────────────────────────────────────────────────────────────
step("等待服务就绪");
const baseUrl = cfg.publicBaseUrl;
const healthUrl = `${baseUrl}/healthz`;
let ready = false;
for (let i = 0; i < 60; i++) {
  const r = await $`curl -fsS --noproxy '*' --max-time 3 ${healthUrl}`.quiet().nothrow();
  if (r.exitCode === 0) {
    ready = true;
    break;
  }
  await Bun.sleep(1000);
}
if (!ready) {
  console.error(`\n\x1b[31m✗ ${healthUrl} 在 60 秒内没有返回 ok\x1b[0m`);
  console.error(`  排查：ssh ${sshHost} 'cd ${remoteDir} && docker compose logs --tail 80 app'`);
  process.exit(1);
}
done(`${healthUrl} 返回 ok`);

// 清单和安装脚本都要能拿到，否则 CLI 装不上。
const version = require_(
  (await $`curl -fsS --noproxy '*' --max-time 5 ${baseUrl}/dl/latest.json`.quiet().text()).match(
    /"version": "([^"]+)"/,
  )?.[1],
  "version in latest.json",
);
const installed = await $`curl -fsS --noproxy '*' --max-time 5 ${baseUrl}/install.sh`
  .quiet()
  .text();
if (!installed.includes("wtow CLI")) throw new Error("/install.sh 内容异常");
done(`latest.json v${version}，install.sh 正常下发`);

const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`\n\x1b[32m部署完成\x1b[0m ${secs}s → ${baseUrl}`);
console.log(`
  管理台  ${baseUrl}
  安装 CLI  curl -fsSL ${baseUrl}/install.sh | sh
  Windows   irm ${baseUrl}/install.ps1 | iex

  查日志  ssh ${sshHost} 'cd ${remoteDir} && docker compose logs -f app'
  进 psql ssh ${sshHost} 'cd ${remoteDir} && docker compose exec db psql -U wtow -d wtow'
`);

if (followLogs) {
  await $`set -e; trap 'ssh ${sshHost} "pkill -f \\"docker compose logs\\" 2>/dev/null" || true' INT TERM; ssh ${sshHost} 'cd ${remoteDir} && docker compose logs -f --tail 50 app'`;
}
