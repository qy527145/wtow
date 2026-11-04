# AGENTS.md

给 AI Agent 和人类协作者的单一事实来源。项目约束以本文件为准；命令只有这里列出的才是「官方」的。

## 这是什么

WTOW 小作文托管平台：测试者提交原始作文，分配者去重并拆成执行作文，开发者领取后完成。
结构沿用 [rust_web](https://github.com/qy527145/rust_web) 模板：axum 提供 `/api/v1`，React 前端由 Vite 构建后在
release 编译期嵌入服务端二进制（`rust-embed`），生产只部署一个可执行文件。另有 `wtow` CLI 与 Agent Skill。
需求见 `docs/PRD.md`，设计见 `docs/DESIGN.md`。

## 目录

| 路径                        | 职责                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/server/`              | Rust / axum / SQLx。入口 `src/main.rs`，迁移在 `migrations/`，安装脚本与下载页在 `assets/` |
| `apps/server/src/api/`      | 按领域分模块，每个模块导出 `router() -> Router<AppState>`，在 `api/mod.rs` merge           |
| `apps/server/src/app.rs`    | 根 Router：挂 `/api/v1`、`/healthz`、安装/下载链路、SPA fallback                           |
| `apps/server/src/config.rs` | **唯一**读取环境变量的地方                                                                 |
| `apps/server/src/error.rs`  | `AppError` → 统一 JSON 错误响应，错误码常量在 `crates/contract/src/error.rs`               |
| `apps/cli/`                 | `wtow` 命令行；`skill/` 下的 Skill 文件编译时打进二进制                                    |
| `crates/contract/`          | 服务端与 CLI 共用的 DTO / 错误码，也是 TS 类型的来源                                       |
| `apps/web/`                 | React 19 + Vite 8 + Tailwind v4，设计令牌在 `src/index.css` 的 `@theme`                    |
| `packages/ui/`              | 「蓝铅笔」组件库（源码级消费，无需 build）                                                 |
| `packages/shared/`          | TS 类型契约；`src/bindings/` 由 ts-rs 生成                                                 |
| `scripts/`                  | build / init / clean / types，以及 db / deploy / release / smoke                           |
| `deploy/`                   | 生产 compose 与 Dockerfile                                                                 |

## 命令

```bash
bun run init         # 安装依赖 + 准备 .env.local（幂等）
bun run dev          # 起 Postgres，再同时起 Vite (WEB_PORT) 与 axum (WTOW_BIND)，Vite 代理 /api
bun run build        # 当前平台单二进制 → dist/
bun run build:web    # 只构建前端到 apps/web/dist
bun run gen:types    # 从 crates/contract 重新生成 packages/shared/src/bindings
bun run check        # biome + 类型漂移检查 + tsc + cargo fmt --check + clippy -D warnings
bun run test         # cargo test + bun test
bun run fmt          # biome --write + cargo fmt
bun run smoke        # 对运行中的服务做端到端冒烟（需先 bun run dev）
bun run release      # 交叉编译 5 平台 CLI 并更新 latest.json
bun run deploy       # 一键部署到服务器
```

## 规则

1. **环境变量只从 `Config::from_env()` 读**，handler 通过 `State<AppState>` 拿 `st.config`，不要直接用 `std::env`。
   变量名保持 `WTOW_*` 前缀（生产 compose 依赖）。新增变量必须同时更新：`config.rs`、`.env`、
   `.env.example`（带一行注释）、README 表格，涉及生产的再改 `deploy/compose.yml`。
2. **所有业务接口挂在 `/api/v1` 下**，返回 `AppResult<T>`，错误走 `AppError`，错误码用 `contract::error` 里的常量。
   `/healthz`、`/install.sh`、`/install.ps1`、`/download`、`/dl/*` 是根路径，不要挪进 `/api`。
3. **跨语言类型以 `crates/contract` 为准**。改 DTO 后跑 `bun run gen:types` 并提交 `packages/shared/src/bindings/`；
   `bun run check` 会因产物过期而失败。需要比 Rust 类型更窄的 TS 类型时，在 Rust 字段上用 `#[ts(type = "...")]`，
   不要手改 bindings。
4. **写请求带 `Idempotency-Key` 时由 `idempotency::layer` 统一处理**，它挂在整组 `/api/v1` 上；新增路由放进
   `api::router()` 即自动生效。
5. **`apps/web/dist/` 是构建产物，不要手改**。其中的 `.gitkeep` 必须保留；`scripts/build.ts` 会在 Vite 清空目录后补回。
6. 前端组件从 `@wtow/ui` 取，样式用 Tailwind 工具类 + `index.css` 里的令牌；`@source` 已指向 `packages/ui/src`。
   不要引入第二套组件库或设计令牌。
7. 新增 workspace 包：`packages/<name>/package.json` 声明 `exports`，并在 `apps/web` 的
   `tsconfig.json` / `vite.config.ts` / `package.json` 三处补别名与依赖。
8. 数据库变更只加新迁移文件（`apps/server/migrations/NNNN_*.sql`），不改已发布的迁移。

## 配置文件

`.env` 提交，只放非敏感默认值；个人配置与密钥写 `.env.local`（gitignore，优先级更高）。
服务端、bun 脚本、Vite 都读仓库根目录这两份文件。生产配置在服务器的 `/opt/wtow/.env`，由 `deploy/compose.yml` 注入。

## 完成定义

改完代码后至少跑通 `bun run check` 与 `bun run test`。涉及接口行为的改动再起 `bun run dev` 跑一次 `bun run smoke`；
涉及前端可见改动时再跑 `bun run build` 确认单二进制可用。
