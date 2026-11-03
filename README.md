# WTOW

小作文托管平台：测试者提交原始作文，分配者去重并拆成执行作文，开发者领取后完成。服务端用 Rust（Axum + SQLx + Postgres），配套 `wtow` CLI 和 Agent Skill。设计见 `docs/DESIGN.md`，需求见 `docs/PRD.md`。

## 目录

```
contract/   服务端与 CLI 共用的 DTO 和错误码
server/     HTTP 服务、数据库迁移（server/migrations）、安装脚本与下载页（server/assets）
server/web/ Web 管理台（React 19 + Vite + Tailwind CSS 4 + Radix UI），构建产物 web/dist 由 rust-embed 打进服务端二进制
cli/        wtow 命令行，Skill 文件在 cli/skill 下，编译时打进二进制
scripts/    bun 脚本：数据库管理、.env 透传、冒烟测试
```

## 依赖

- Rust（edition 2024）
- Docker，用来跑 Postgres 16
- bun，用来管理脚本命令和构建前端

## 快速开始

```bash
cp .env.example .env    # 第一次运行时执行
bun run web:install     # 第一次运行时执行，安装前端依赖
bun run web:build       # 构建前端；服务端编译时把 server/web/dist 打包进去
bun run dev             # 启动 Postgres 容器，然后启动服务（迁移自动执行）
```

服务默认监听 `http://127.0.0.1:8080`，浏览器打开即是 Web 管理台；可以用 `curl http://127.0.0.1:8080/healthz` 检查。新注册用户会进入「使用引导」页，按步骤安装 CLI、生成令牌、登录并安装 Skill。

改前端时用 `bun run web:dev` 起 Vite（`http://127.0.0.1:5173`），`/api` 自动代理到 8080，支持热更新。没构建前端就编译服务端也能通过，只是访问页面会提示先执行 `web:build`。

另开一个终端，跑端到端冒烟测试：

```bash
bun run smoke
```

冒烟测试会自动注册用户、创建项目、生成令牌，再用 CLI 走完一遍“提交 → 认领 → 建任务 → 领取 → 完成”的流程。

> 如果本机设置了 HTTP 代理，访问本地服务可能返回 502。加上 `NO_PROXY=127.0.0.1,localhost` 即可。

## 脚本命令

| 命令 | 作用 |
| :--- | :--- |
| `bun run dev` | 启动数据库和服务 |
| `bun run server` | 只启动服务（会读取 `.env`） |
| `bun run db:up` / `db:down` | 启动或停止 Postgres 容器 `wtow-pg`（端口 55432） |
| `bun run db:reset` | 清空数据库，服务下次启动时重新迁移 |
| `bun run db:psql` | 进入 psql |
| `bun run web:install` | 安装前端依赖 |
| `bun run web:dev` | 前端开发服务器（代理 API 到本地服务端） |
| `bun run web:build` | 构建前端到 `server/web/dist` |
| `bun run build` / `build:release` | 构建前端并编译整个 workspace |
| `bun run cli -- <args>` | 用源码运行 CLI，例如 `bun run cli -- raw list --json` |
| `bun run skill:install` | 把 Skill 安装到 `~/.claude/skills/wtow/` |
| `bun run release` | 交叉编译 5 个平台的 CLI 并更新 `latest.json` |
| `bun run deploy` | 一键部署到服务器（见「部署」） |
| `bun run smoke` | 对运行中的服务做端到端冒烟测试 |

## 配置（`.env`）

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `DATABASE_URL` | — | 必填，Postgres 连接串 |
| `WTOW_BIND` | `127.0.0.1:8080` | 监听地址 |
| `WTOW_PUBLIC_BASE_URL` | `http://127.0.0.1:8080` | 对外地址，用于安装脚本和下载页 |
| `WTOW_ATTACHMENT_DIR` | `./data/attachments` | 附件存储目录 |
| `WTOW_RELEASE_DIR` | `./data/releases` | CLI 发布产物与 `latest.json` 所在目录 |
| `WTOW_SUPERADMIN_EMAILS` | 空 | 逗号分隔的邮箱，注册或启动时自动设为超管；超管在侧栏有「超管面板」，能看所有项目、管理用户，进任意项目都按管理员处理 |
| `WTOW_MINISIGN_PUBKEY` | 空 | 配置后，安装脚本会校验 `latest.json` 的签名 |
| `RUST_LOG` | `wtow_server=info` | 日志级别 |

## 手动接入一个项目

推荐直接在 Web 管理台操作：注册 → 新建项目 → 按「接入指引」生成令牌。下面是不用浏览器时的等价 curl 步骤。

1. 注册、登录，然后创建项目。Cookie 会话的写请求必须带 `X-Requested-With` 头：

   ```bash
   B=http://127.0.0.1:8080/api/v1
   curl -X POST $B/auth/register -H 'content-type: application/json' \
     -d '{"email":"me@example.com","display_name":"Me","password":"password123"}'
   curl -c jar -X POST $B/auth/login -H 'content-type: application/json' \
     -d '{"email":"me@example.com","password":"password123"}'
   curl -b jar -X POST $B/projects -H 'content-type: application/json' -H 'x-requested-with: x' \
     -d '{"slug":"demo","name":"Demo"}'
   curl -b jar -X POST $B/projects/demo/tokens -H 'content-type: application/json' -H 'x-requested-with: x' \
     -d '{"name":"agent","roles":["assigner","developer"]}'    # secret 只会返回这一次
   ```

2. 用 CLI 登录，并安装 Skill：

   ```bash
   wtow login --base-url http://127.0.0.1:8080 --project demo --token wtow_pat_xxx
   wtow skill install
   wtow whoami
   ```

CLI 读取配置的优先级：命令行参数 > 环境变量（`WTOW_BASE_URL` / `WTOW_PROJECT` / `WTOW_TOKEN`）> 仓库内的 `.wtow.toml` > 用户配置中当前启用的 profile。完整命令和退出码见 `cli/skill/references/cli.md`。

## 发布 CLI

```bash
bun run release                                        # 交叉编译全部 5 个平台
bun run release --target x86_64-unknown-linux-musl     # 只打一个平台
```

目标平台：macOS（Apple Silicon / Intel）、Linux（x86_64 / arm64，musl 静态链接）、Windows x86_64。Linux 用 `cargo-zigbuild`，Windows 用 `cargo-xwin`，需要先 `rustup target add` 对应 target。产物打成 `wtow-v<ver>-<target>.tar.gz`（Windows 为 `.zip`）放进 `WTOW_RELEASE_DIR`（默认 `./data/releases`），同时生成 `.sha256` 并更新 `latest.json`：同一目录里其它平台的条目会保留，`version` 取自 `cli/Cargo.toml`，`min_cli_version` 取自服务端 `/meta` 的常量，无需手改。打包内容固定 mtime 与属主，同一二进制重复打包得到的 sha256 相同。产物 URL 的前缀取自 `deploy/.env` 的 `WTOW_PUBLIC_BASE_URL`，可用 `--base-url` 覆盖。

设置 `WTOW_MINISIGN_SECRET_KEY` 指向私钥后，脚本会顺带签名 `latest.json`；服务端配置 `WTOW_MINISIGN_PUBKEY` 后，`install.sh` 会强制校验签名（未配置时只校验 sha256 并发警告）。

用户随后按平台用一条命令安装：

```bash
curl -fsSL <base>/install.sh | sh        # macOS / Linux，装到 ~/.local/bin
irm <base>/install.ps1 | iex             # Windows PowerShell，装到 %LOCALAPPDATA%\wtow\bin 并加入 PATH
```

安装脚本默认要求 HTTPS；服务端自己声明的 `WTOW_PUBLIC_BASE_URL` 是 http 时也放行（部署方已选择不上 TLS），其它 http 地址需显式设 `WTOW_ALLOW_HTTP=1`。

`latest.json` 中每个 artifact 必须单独占一行，格式为 `{ "target": ..., "url": ..., "sha256": ... }`——脚本按此格式生成，手工维护时不要压缩成一行。下载页在 `/download`。

## 部署

```bash
cp deploy/.env.example deploy/.env       # 第一次执行，填 ssh 别名和对外地址
bun run deploy                           # 构建前端 → 交叉编译服务端 → 打包 CLI → 上传 → 重启容器 → 健康检查
bun run deploy --skip-cli                # 只改了服务端时，跳过 CLI 打包
bun run deploy --skip-build              # 复用上次编译的服务端二进制
```

服务器上不需要 Rust：服务端在本地编译成 `x86_64-unknown-linux-musl` 静态二进制，和 `deploy/Dockerfile` 一起传上去，基于 alpine 打一个很小的镜像；Postgres 默认用服务器上已有的 `postgres:17`，缺失时走 `docker.1ms.run` 镜像源。服务器目录（默认 `/opt/wtow`）：

| 路径 | 说明 |
| :--- | :--- |
| `.env` | 生产配置。首次部署自动生成随机数据库密码，之后不会被覆盖，改配置直接在服务器上编辑 |
| `compose.yml` | 容器编排，每次部署覆盖 |
| `image/`、`image.prev/` | 当前与上一版的镜像构建上下文，回滚时把 `image.prev` 换回来再 `docker compose up -d --build` |
| `data/attachments` | 附件，生产数据，部署不会删除 |
| `data/releases` | CLI 产物，每次部署以本地为准同步 |

数据库数据在 docker volume `wtow_pgdata`。常用排查命令部署结束时会打印出来。

## 尚未实现

`/stats`、附件签名 URL 与 S3 存储、未绑定附件的清理任务，以及自动化测试。
