# WTOW 技术设计文档

> 对应需求：[PRD.md](PRD.md)
> 本文在 PRD 基础上引入 **多项目（Project）** 维度：一个部署实例可承载多个互相独立的项目，每个项目拥有自己的成员、令牌、作文与执行管道。

---

## 1. 目标与范围

| 项 | 内容 |
| :--- | :--- |
| 交付形态 | **两个独立交付物**：Web 程序（Rust 服务端 + 内嵌 React 管理台，单二进制）与 CLI（独立二进制、独立版本号）。两者分开构建、分开发布，只通过 HTTP API 契约耦合 |
| 项目模型 | 单部署、多项目、共享库。项目之间数据完全隔离，可独立授权、独立归档 |
| Agent 接入 | CLI 为默认，`wtow skill install` 分发 Skill；MCP 作为可选适配 |
| 不包含 | 服务端模型调用、代码仓库托管、自动验收、多租户计费 |

**核心假设**

1. 自托管为主，单实例即可支撑数十个项目、数百个 Agent。
2. 项目由已登录用户在 Web 端创建，创建者成为该项目的管理员。
3. CLI 通过「服务地址 + 项目标识 + 项目令牌」三元组接入，令牌与项目绑定。

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                   │
│  项目列表 / 原始管道看板 / 分配工作台 / 执行管道 / 成员与令牌  │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS + 会话 Cookie
┌───────────────────────────▼─────────────────────────────────┐
│                     wtow-server (Axum)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │  auth    │ │  raw     │ │  exec    │ │ files / stats  │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ domain（状态机、权限、ID 序列）  │  jobs（认领超时释放） │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 静态资源（rust-embed：web/dist）                        │ │
│  └────────────────────────────────────────────────────────┘ │
└───────┬──────────────────────────────┬──────────────────────┘
        │ SQL                          │ 文件读写
┌───────▼────────┐            ┌────────▼────────┐
│  PostgreSQL    │            │ 本地卷 / S3      │
└────────────────┘            └─────────────────┘

         ┌──────────────────┐  HTTPS + Bearer Token   ┌───────────────────┐
   │  wtow (CLI)      │ ──────────────────────▶ │  wtow-server      │
   │  内嵌 Skill 包    │ ◀─── 安装包 / install.sh ─│  （Web 程序）      │
   └──────────────────┘                         └───────────────────┘
              ▲
              └── 被 Claude Code / 其他 Harness 调用
```

前端与 CLI 共用同一套 REST API，服务端不区分调用方。

**CLI 与 Web 分开交付**：Web 二进制不内嵌 CLI，CLI 也不依赖服务端代码。Web 只额外承担一件事——提供 CLI 的下载页、安装脚本与版本清单。

---

## 3. 技术选型

| 层 | 选型 | 理由 |
| :--- | :--- | :--- |
| Web 框架 | **Axum 0.8** | 与 Tower/Tokio 生态一致，中间件、提取器模型清晰，便于按项目做统一鉴权 |
| 异步运行时 | Tokio | Axum 默认 |
| 数据库 | **PostgreSQL 16** | 需要复合外键、部分索引、JSONB、对象存储之外的并发控制；SQLite 在多项目并发与运维上受限 |
| 数据访问 | **SQLx**（编译期校验 + `sqlx::migrate!`） | 避免 ORM 隐式行为；迁移随二进制打包 |
| 序列化 | serde / serde_json | |
| 认证 | 会话 Cookie（Web）+ Bearer PAT（CLI） | 两种调用方需求不同，分开实现更简单 |
| 密码哈希 | argon2id | |
| 令牌哈希 | SHA-256 | 令牌本身是 256 位随机串，不需要慢哈希 |
| 日志 | tracing + tracing-subscriber | 结构化 |
| 前端 | React 19 + TypeScript + Vite | |
| 路由 / 请求 | TanStack Router + TanStack Query | 类型安全，缓存与失效模型适合看板类页面 |
| 样式 | Tailwind CSS + shadcn/ui | |
| 类型同步 | utoipa → OpenAPI → `openapi-typescript` | 后端改接口，前端类型自动更新 |
| CLI | clap（derive）+ reqwest + tokio | |
| 打包 | rust-embed + 多阶段 Dockerfile | 单二进制交付 |

> 备选：若希望零依赖部署（单文件、无 Postgres），可改用 SQLite + `libsql`。代价是放弃复合外键的强隔离与并发写能力，本文按 Postgres 设计。

---

## 4. 仓库结构

结构沿用 [rust_web](https://github.com/qy527145/rust_web) 模板：一个 Cargo workspace + 一个 bun workspace，Turbo 编排前后端任务。Web 服务端与 CLI 是 workspace 里的两个独立二进制，各自发布：

```
wtow/
├── apps/
│   ├── server/                # ── Web 服务端 ──
│   │   ├── src/
│   │   │   ├── main.rs        # 启动编排：配置 → 迁移 → Router → 优雅停机
│   │   │   ├── config.rs      # 唯一读取环境变量的地方
│   │   │   ├── state.rs       # AppState（连接池 + 配置）
│   │   │   ├── app.rs         # 根 Router：/api/v1、/healthz、安装与下载链路、SPA fallback
│   │   │   ├── api/           # 按领域分模块，各自导出 router()：raw / exec / files / admin / dist …
│   │   │   ├── auth.rs        # 会话、PAT、角色校验、项目上下文提取器
│   │   │   ├── idempotency.rs # 幂等层与认领超时释放
│   │   │   └── assets.rs      # rust-embed
│   │   ├── migrations/        # sqlx 迁移
│   │   └── assets/            # install.sh / install.ps1 / download.html
│   ├── web/                   # React SPA，构建产物 dist/ 嵌入服务端
│   └── cli/                   # ── CLI（独立发布）──
│       ├── src/main.rs
│       └── skill/             # SKILL.md + references/*.md（include_str!）
├── crates/contract/           # 仅 wire 类型与错误码，也是 TS 类型的来源（ts-rs）
├── packages/
│   ├── ui/                    # Web 组件库
│   └── shared/                # TS 类型，src/bindings 由 ts-rs 生成
├── deploy/                    # Dockerfile、compose.yml
├── scripts/                   # build / types / db / release / deploy / smoke
└── docs/{PRD.md,DESIGN.md}
```

- `apps/cli/` 不依赖 `apps/server/` 的任何代码，也不依赖 axum / sqlx；两者只共享 `crates/contract/` 里的 serde DTO 与错误码常量。
- `crates/contract/` 刻意保持小而纯，只为不让接口字段在 Rust 两端与 TS 端各写一遍。若将来拆成多个仓库，它单独版本化发布。
- 服务端与 CLI 共用 workspace 版本号，但分别发布：服务端随部署上线，CLI 由 `bun run release` 打包后经 `/install.sh` 分发，Web 升级不强制 CLI 升级（见 `MIN_CLI_VERSION`）。

---

## 5. 多项目隔离模型

### 5.1 隔离策略

采用**共享库 + 共享 schema + 强制 `project_id`**：

| 方案 | 结论 |
| :--- | :--- |
| 共享库 + `project_id` | ✅ 采用。运维成本最低，跨项目统计容易 |
| 每项目独立 schema | ⚠️ 迁移要为每个 schema 跑一遍，项目数一多就难以维护 |
| 每项目独立数据库 | ❌ 对本期规模是过度设计 |

隔离靠三层保证，而不是靠开发者自觉：

1. **类型层**：所有仓储函数第一个参数是 `ProjectId`（newtype），没有它拿不到连接。
2. **SQL 层**：每张业务表主键为 `(project_id, id)`，关联表用**复合外键**，从数据库层面杜绝跨项目关联。
3. **鉴权层**：请求进入时解析出 `ProjectCtx { project_id, user_id, role }`，后续处理只持有这个上下文。

> 可选加固：启用 Postgres RLS，在每个事务开头 `SET LOCAL app.project_id = ...`，策略统一为 `project_id = current_setting('app.project_id')::bigint`。二期再上，一期先用前两层。

### 5.2 项目标识

- `slug`：人类可读、全局唯一，如 `finance-agent`，用于 URL 与 CLI 配置。
- 项目 ID：内部自增主键，不出现在界面与 CLI 中。
- 项目令牌：与项目绑定，服务端从令牌反查项目；若请求路径中的 slug 与令牌项目不一致，直接 `403 PROJECT_MISMATCH`，防止把 A 项目的令牌贴到 B 项目目录里。

### 5.3 项目内 ID 生成

`RAW-1042`、`EXEC-2011` 在项目内唯一。用计数表在同一事务内分配：

```sql
INSERT INTO project_counters (project_id, kind, next_seq)
VALUES ($1, $2, 1000)
ON CONFLICT (project_id, kind)
DO UPDATE SET next_seq = project_counters.next_seq + 1
RETURNING next_seq;
```

---

## 6. 认证与授权

### 6.1 两条认证通道

| 通道 | 使用方 | 载体 | 存储 |
| :--- | :--- | :--- | :--- |
| 会话 | Web | `wtow_session` HttpOnly Cookie（`Secure`、`SameSite=Lax`） | `sessions` 表，可主动吊销 |
| 个人访问令牌 | CLI / Agent | `Authorization: Bearer wtow_pat_xxx` | `api_tokens.token_hash`（SHA-256） |

### 6.2 角色与权限范围

tester / assigner / developer 是**平级**职责而非等级，因此不用「角色高低」做比较，而用**角色集合**：

- `memberships.roles project_role[]`：一个成员可同时持有多个角色（小团队里分配者兼开发者很常见）。`admin` 隐含全部角色。
- `api_tokens.roles project_role[]`：令牌签发时声明，必须是持有者成员角色的**子集**（`token.roles <@ membership.roles`）。另有 `read_only BOOLEAN`，为真时所有写接口返回 `403 TOKEN_READ_ONLY`。
- 每次请求都重新与当前成员角色取交集：成员被降权后，旧令牌立即随之降权，无需逐个吊销。
- `api_tokens.actor_type`（`human` / `agent`）在签发时指定，写入审计；Web 会话恒为 `human`。

令牌与**单个项目**绑定，因此 CLI 不提供 `project list`；跨项目切换通过本地多 profile 完成（见 11.1）。

**Agent 分配者的判定权**：`merge` / `duplicate` / `ignore` 允许 Agent 直接执行，但请求体必须带 `reason`（非空），审计记录 `actor_type=agent`；任何人可经 `reopen` 撤销。项目设置 `require_human_triage=true` 时，Agent 令牌调用这三个接口返回 `403 HUMAN_TRIAGE_REQUIRED`，改为只能留下建议（`POST /raw/{id}/suggestions`，二期）。

### 6.3 请求上下文

```rust
pub struct ProjectCtx {
    pub project_id: i64,
    pub slug: String,
    pub user_id: i64,
    pub token_id: Option<i64>,   // 会话请求为 None
    pub roles: RoleSet,          // 令牌角色 ∩ 当前成员角色
    pub read_only: bool,
    pub actor_type: ActorType,   // Human | Agent
}
```

提取器负责：解析令牌 → 查项目 → 校验 slug → 校验成员关系 → 计算有效角色 → 注入。handler 用 `ctx.require(Role::Assigner)?` 声明所需角色，缺失返回 `403 FORBIDDEN_ROLE`。所有业务 handler 只接收 `ProjectCtx`，拿不到它就无法访问数据。

---

## 7. 数据模型

### 7.1 枚举

```sql
CREATE TYPE project_role   AS ENUM ('tester','assigner','developer','admin');
CREATE TYPE raw_status     AS ENUM ('Pending','Claimed','Processed','Merged','Duplicate','Ignored');
CREATE TYPE exec_status    AS ENUM ('Queued','InProgress','Done','Cancelled');
CREATE TYPE link_relation  AS ENUM ('split','merge');
CREATE TYPE owner_type     AS ENUM ('raw','exec');
CREATE TYPE actor_type     AS ENUM ('human','agent');
```

### 7.2 项目与用户

```sql
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                   BIGSERIAL PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  require_human_triage BOOLEAN NOT NULL DEFAULT false,
  created_by           BIGINT NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at          TIMESTAMPTZ
);

CREATE TABLE memberships (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roles      project_role[] NOT NULL CHECK (cardinality(roles) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE api_tokens (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   BYTEA NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  roles        project_role[] NOT NULL,
  read_only    BOOLEAN NOT NULL DEFAULT false,
  actor_type   actor_type NOT NULL DEFAULT 'agent',
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         BYTEA PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_counters (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  next_seq   BIGINT NOT NULL DEFAULT 1000,
  PRIMARY KEY (project_id, kind)
);
```

### 7.3 作文表（带项目维度）

```sql
CREATE TABLE raw_compositions (
  project_id       BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id               TEXT NOT NULL,                 -- RAW-1042
  seq              BIGINT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  status           raw_status NOT NULL DEFAULT 'Pending',
  reporter_id      BIGINT NOT NULL REFERENCES users(id),
  claimed_by       BIGINT REFERENCES users(id),
  claimed_at       TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,                   -- 认领者最后一次操作，超时释放按它判断
  merged_into_id   TEXT,                          -- 只指向 raw；并入 exec 走 raw_exec_links
  triage_reason    TEXT,
  version          INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, seq),
  FOREIGN KEY (project_id, merged_into_id) REFERENCES raw_compositions (project_id, id),
  CHECK ((status = 'Claimed') = (claimed_by IS NOT NULL)),
  CHECK ((status IN ('Merged','Duplicate')) = (merged_into_id IS NOT NULL))
);

CREATE INDEX raw_project_status_idx ON raw_compositions (project_id, status, created_at DESC);
CREATE INDEX raw_title_trgm_idx     ON raw_compositions USING GIN (title gin_trgm_ops);
CREATE INDEX raw_desc_trgm_idx      ON raw_compositions USING GIN (description gin_trgm_ops);

CREATE TABLE exec_compositions (
  project_id      BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id              TEXT NOT NULL,                  -- EXEC-2011
  seq             BIGINT NOT NULL,
  instruction     TEXT NOT NULL,
  target_resources TEXT[] NOT NULL DEFAULT '{}',
  status          exec_status NOT NULL DEFAULT 'Queued',
  priority        SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3), -- P0=0 … P3=3
  assigner_id     BIGINT NOT NULL REFERENCES users(id),
  developer_id    BIGINT REFERENCES users(id),
  claimed_at      TIMESTAMPTZ,
  developer_notes TEXT,
  result_links    JSONB NOT NULL DEFAULT '[]',
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, seq)
);

CREATE INDEX exec_pool_idx ON exec_compositions (project_id, status, priority, created_at);
CREATE INDEX exec_targets_idx ON exec_compositions USING GIN (target_resources);

CREATE TABLE raw_exec_links (
  project_id BIGINT NOT NULL,
  raw_id     TEXT NOT NULL,
  exec_id    TEXT NOT NULL,
  relation   link_relation NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, raw_id, exec_id),
  FOREIGN KEY (project_id, raw_id) REFERENCES raw_compositions (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, exec_id) REFERENCES exec_compositions (project_id, id) ON DELETE CASCADE
);

CREATE INDEX links_by_exec_idx ON raw_exec_links (project_id, exec_id);
```

> 复合外键 `(project_id, raw_id)` / `(project_id, exec_id)` 是隔离的关键：任何试图把 A 项目的作文关联到 B 项目的执行的写入，都会在数据库层被拒绝。

### 7.4 附件、审计、幂等

```sql
CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,             -- ATT-xxxx（全局唯一即可）
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_type  owner_type,                   -- 上传时为空，建作文时绑定；24 小时未绑定由后台清理
  owner_id    TEXT,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attach_owner_idx ON attachments (project_id, owner_type, owner_id);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id    BIGINT NOT NULL REFERENCES users(id),
  token_id    BIGINT REFERENCES api_tokens(id),
  actor_type  actor_type NOT NULL,
  action      TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_project_time_idx ON audit_logs (project_id, created_at DESC);

CREATE TABLE idempotency_keys (
  project_id   BIGINT NOT NULL,
  user_id      BIGINT NOT NULL,
  key          TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  request_hash BYTEA NOT NULL,
  response     JSONB,                  -- NULL 表示处理中
  status_code  SMALLINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, key)
);
```

幂等语义：与业务写入同一事务内先 `INSERT ... ON CONFLICT DO NOTHING` 占位。冲突时比对 `endpoint` 与 `request_hash`：不一致返回 `422 IDEMPOTENCY_KEY_REUSED`；一致且已有响应则回放；一致且处理中返回 `409 IDEMPOTENCY_IN_PROGRESS`。

---

## 8. 核心流程

### 8.1 创建项目并接入 Agent

```
用户登录 Web → 新建项目（slug=finance-agent）→ 系统创建 membership(admin)
  → 生成令牌（只显示一次）→ 页面给出接入指引：

   wtow login --base-url https://wtow.internal --project finance-agent --token wtow_pat_xxx
   wtow skill install
```

### 8.2 认领（并发安全）

认领不是加锁，而是条件更新 + 超时释放。原子性由单条 SQL 保证：

```sql
UPDATE raw_compositions
   SET claimed_by = $user, claimed_at = now(), status = 'Claimed', version = version + 1
 WHERE project_id = $p AND id = $id
   AND status = 'Pending' AND claimed_by IS NULL
RETURNING id;
```

影响 0 行 → `409 RAW_ALREADY_CLAIMED`，附当前认领者与时间。

超时释放由后台任务每 5 分钟执行。已有建联的作文直接转 `Processed`，不回到 `Pending`，避免被重复拆分：

```sql
UPDATE raw_compositions r
   SET claimed_by = NULL, claimed_at = NULL, last_activity_at = NULL, version = version + 1,
       status = CASE WHEN EXISTS (SELECT 1 FROM raw_exec_links l
                                   WHERE l.project_id = r.project_id AND l.raw_id = r.id)
                     THEN 'Processed'::raw_status ELSE 'Pending'::raw_status END
 WHERE status = 'Claimed' AND last_activity_at < now() - interval '24 hours';
```

该语句幂等，多实例同时执行无害。它与建联事务的竞态由 8.3 的行锁解决。

### 8.3 创建执行作文（拆分 / 合并）

```
BEGIN
  SELECT ... FROM raw_compositions WHERE id = ANY(source_raw_ids)
    ORDER BY id FOR UPDATE              -- 固定顺序加锁，避免死锁
  校验：每条来源 status='Claimed' AND claimed_by=$me，否则 409 RAW_NOT_CLAIMED_BY_YOU
       （多来源合并须逐条认领；已 Processed 且认领者已清空的作文要追加任务，先 reopen）
  seq  ← 分配 EXEC 序号
  INSERT exec_compositions (status = developer_id ? 'InProgress' : 'Queued')
  FOR EACH raw_id IN source_raw_ids:
      INSERT raw_exec_links (relation = len==1 ? 'split' : 'merge')
  IF close_sources:
      UPDATE raw_compositions SET status='Processed', claimed_by=NULL, claimed_at=NULL ...
  ELSE:
      UPDATE raw_compositions SET last_activity_at=now() ...
  绑定 attachments；INSERT audit_logs
COMMIT
```

全部在同一事务内完成，避免出现「有任务没来源」的孤儿数据。

### 8.4 领取与完成

领取时检查 `target_resources` 是否与其他 `InProgress` 任务相交（`&&`）。有交集时返回 `409 TARGET_CONFLICT`，`details` 列出冲突任务；调用方带 `force=true` 可强制领取，并写入审计。这是提醒而非强锁：平台仍不接管仓库。

```sql
-- 领取：仅当任务在池中
UPDATE exec_compositions
   SET developer_id = $me, claimed_at = now(), status = 'InProgress', version = version + 1
 WHERE project_id = $p AND id = $id AND status = 'Queued' AND developer_id IS NULL
RETURNING id;

-- 完成：仅本人可完成
UPDATE exec_compositions
   SET status = 'Done', developer_notes = $notes, result_links = $links,
       completed_at = now(), version = version + 1
 WHERE project_id = $p AND id = $id AND developer_id = $me AND status = 'InProgress'
RETURNING id;
```

### 8.5 原始作文状态迁移表

下表是唯一权威定义，未列出的迁移一律返回 `409 INVALID_TRANSITION`。

| 从 | 到 | 动作 | 角色 | 前置条件 | 字段变更 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Pending | Claimed | claim | assigner | 无认领者 | 写 `claimed_by/claimed_at/last_activity_at` |
| Claimed | Pending | release | 认领者 / admin | 无建联 | 清认领字段 |
| Claimed | Processed | release | 认领者 / admin | 已有建联 | 清认领字段 |
| Claimed | Processed | exec create | 认领者 | `close_sources=true` | 写建联，清认领字段 |
| Pending / Claimed | Merged | merge | assigner | Claimed 时须为认领者；目标见下 | 写 `merged_into_id/triage_reason`，清认领字段 |
| Pending / Claimed | Duplicate | duplicate | assigner | 同上 | 同上 |
| Pending / Claimed | Ignored | ignore | assigner | 必填 `reason` | 写 `triage_reason`，清认领字段 |
| Claimed | Pending | 超时 | 系统 | 无建联，24 小时无操作 | 清认领字段 |
| Claimed | Processed | 超时 | 系统 | 有建联，24 小时无操作 | 清认领字段 |
| Merged / Duplicate / Ignored / Processed | Pending | reopen | assigner / admin | 必填 `reason` | 清 `merged_into_id/triage_reason`；保留历史建联 |

**合并规则**：`merge` 表示两条内容互补，目标要吸收其信息；`duplicate` 表示内容相同，无新信息。目标不得是自身，且写入时沿 `merged_into_id` 解析到根节点并直接指向根，因此链长恒为 1、不会成环；根必须是 `Pending` / `Claimed` / `Processed`。并入 A 的作文在 A 被 reopen 时不变；A 被并入 B 时，指向 A 的作文在同一事务内改指 B。

### 8.6 执行作文状态迁移表

| 从 | 到 | 动作 | 角色 | 前置条件 | 字段变更 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Queued | InProgress | claim | developer | 无领取者；目标冲突需 `force` | 写 `developer_id/claimed_at` |
| Queued | InProgress | 创建时派单 | assigner | 被派者有 developer 角色 | 同上 |
| InProgress | Queued | release | 领取者 / assigner / admin | 必填 `reason` | 清 `developer_id/claimed_at` |
| InProgress | Done | complete | 领取者 | 必填 `developer_notes` | 写 `completed_at`、`result_links` |
| Queued / InProgress | Cancelled | cancel | assigner / admin | 必填 `reason` | 见下 |
| Done | InProgress | reopen | assigner / admin / 原领取者 | 必填 `reason` | 清 `completed_at`；保留 notes 与 links，旧值入审计；`developer_id` 不变 |

**作废回流**：取消时，若某来源原始作文已无其他未取消的执行作文，则置回 `Pending`（除非 `requeue_sources=false`），避免反馈从系统里消失。

**弃坑处理**：执行作文不做自动超时释放，因为长任务合法存在；`InProgress` 超过 72 小时无更新只在看板和 `/stats` 中标记为「停滞」，由 assigner / admin 决定是否 release。

### 8.7 交付回溯（测试者闭环）

原始作文不新增状态，而由关联执行作文派生 `delivery`：无关联为 `none`；有未结束任务为 `in_progress`；全部 Done 为 `delivered`；全部 Cancelled 为 `cancelled`（已取消的不计入前两者判断）。`GET /raw/{id}` 与 `wtow raw get` 返回该字段，提交者由此查询进度。一期不做主动通知，只在 Web 提供「我提交的」视图。

---

## 9. API 设计

### 9.1 命名空间

所有项目内资源挂在项目路径下，便于缓存、日志与权限提取：

```
/api/v1/auth/*
/api/v1/projects                       # 项目 CRUD
/api/v1/projects/{slug}/members
/api/v1/projects/{slug}/tokens
/api/v1/projects/{slug}/raw/*
/api/v1/projects/{slug}/exec/*
/api/v1/projects/{slug}/files/*
/api/v1/projects/{slug}/stats
```

> 与 PRD 的差异：PRD 中的 `/api/v1/raw/submit` 等路径需加上 `/projects/{slug}` 前缀。建议同步更新 PRD。

### 9.2 主要端点

| 方法 | 路径 | 角色 | 说明 |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/login` | — | 邮箱密码登录，下发会话 Cookie |
| `POST` | `/auth/logout` | 登录用户 | |
| `GET` | `/auth/me` | 登录用户 | 返回用户与所属项目 |
| `POST` | `/projects` | 登录用户 | 创建项目，创建者成为 admin |
| `GET` | `/projects` | 登录用户 | 我参与的项目 |
| `GET` | `/projects/{slug}` | 成员 | 项目详情 |
| `PATCH` | `/projects/{slug}` | admin | 改名、归档 |
| `GET/POST/DELETE` | `/projects/{slug}/members` | admin | 成员管理 |
| `GET/POST/DELETE` | `/projects/{slug}/tokens` | 本人 / admin | 令牌；创建时明文只返回一次 |
| `POST` | `/projects/{slug}/raw` | 全部 | 提交原始作文 |
| `GET` | `/projects/{slug}/raw` | 全部 | 列表（状态、标签、关键词、分页） |
| `GET` | `/projects/{slug}/raw/{id}` | 全部 | 详情 |
| `GET` | `/projects/{slug}/raw/{id}/related` | assigner | 相似候选 |
| `GET` | `/projects/{slug}/raw/{id}/execs` | 全部 | 拆出的执行作文 |
| `PATCH` | `/projects/{slug}/raw/{id}` | assigner | 编辑 |
| `POST` | `/projects/{slug}/raw/{id}/claim` | assigner | 认领 |
| `DELETE` | `/projects/{slug}/raw/{id}/claim` | assigner/admin | 释放 |
| `POST` | `/projects/{slug}/raw/{id}/merge` | assigner | 并入另一条 |
| `POST` | `/projects/{slug}/raw/{id}/duplicate` | assigner | 标记重复 |
| `POST` | `/projects/{slug}/raw/{id}/ignore` | assigner | 不予处理 |
| `POST` | `/projects/{slug}/raw/{id}/reopen` | assigner/admin | 重新打开 |
| `POST` | `/projects/{slug}/exec` | assigner | 创建（拆/合同一入口） |
| `GET` | `/projects/{slug}/exec` | 全部 | 列表（状态、开发者、目标、关键词） |
| `GET` | `/projects/{slug}/exec/{id}` | 全部 | 详情 |
| `GET` | `/projects/{slug}/exec/{id}/raws` | 全部 | 原始来源 |
| `POST` | `/projects/{slug}/exec/{id}/claim` | developer | 领取；`?force=true` 忽略目标冲突 |
| `DELETE` | `/projects/{slug}/exec/{id}/claim` | 领取者 / assigner / admin | 退回池中（必填 `reason`） |
| `POST` | `/projects/{slug}/exec/{id}/reopen` | assigner / admin / 原领取者 | Done 重新打开 |
| `PATCH` | `/projects/{slug}/exec/{id}` | assigner / 领取者 | 状态、优先级、说明、证据 |
| `POST` | `/projects/{slug}/exec/{id}/complete` | 领取者 | 完成 |
| `POST` | `/projects/{slug}/exec/{id}/cancel` | assigner/admin | 作废 |
| `POST` | `/projects/{slug}/files` | 全部 | 附件上传 |
| `GET` | `/projects/{slug}/files/{id}` | 成员 | 下载（签名或鉴权流式返回） |
| `GET` | `/projects/{slug}/stats` | 成员 | 管道水位 |
| `GET` | `/meta` | 公开 | 服务端版本、`api_version`、`min_cli_version`，CLI 启动时校验 |

### 9.3 统一约定

- 错误：HTTP 状态码 + `{"error": {"code", "message", "details"}}`
- 列表：`?page=1&page_size=20` → `{"items": [], "total": 0}`
- 幂等：`POST` 支持 `Idempotency-Key`，24 小时内同 Key 返回首次结果
- 并发：`PATCH` 支持 `If-Match: <version>`，冲突返回 `409 VERSION_CONFLICT`
- 错误码常量集中在 `contract::error`，服务端、CLI 与前端共用同一份定义

---

## 10. 前端设计

### 10.1 页面

| 路由 | 页面 | 要点 |
| :--- | :--- | :--- |
| `/` | 项目列表 | 我参与的项目 + 创建入口 |
| `/p/{slug}` | 项目概览 | 两个管道水位、最近动态 |
| `/p/{slug}/raw` | 原始管道 | 按状态分列，支持认领/合并/标记 |
| `/p/{slug}/workbench` | **分配工作台** | 左：待处理列表与详情；右：执行作文草稿，多选作文 → 一次性建联 |
| `/p/{slug}/exec` | 执行管道 | `Queued / InProgress / Done` 三列，开发者可领取 |
| `/p/{slug}/settings` | 设置 | 成员、角色、令牌、归档 |

### 10.2 交互与数据

- TanStack Query 管理缓存；写操作成功后按 key 精确失效，失败回滚乐观更新。
- 看板刷新：一期用 10s 轮询；二期若需要实时，再引入 SSE（`/projects/{slug}/events`）。
- 分配工作台用「多选 + 草稿面板」替代拖拽，降低实现成本且更贴合「读一篇、产出几条」的实际动作。

### 10.3 使用引导

`/guide`（全局）与 `/p/{slug}/guide`（项目内）提供首次接入流程：安装 CLI → 选项目并生成令牌 → `wtow login`（命令自动填入令牌）→ `wtow skill install` → 按角色给出 Agent 话术与 CLI 示例。新注册用户登录后直接进入该页；概览页在当前用户没有有效令牌时提示接入。

为此，令牌接口对所有成员开放：成员可以给自己签发、查看、吊销令牌（角色仍须是自身角色的子集），管理员可以看到并吊销全部成员的令牌。

### 10.4 类型同步

`utoipa` 标注 handler → `/api/openapi.json` → CI 中 `openapi-typescript` 生成 `web/src/api/schema.d.ts`。接口变更导致前端类型不匹配时构建失败。

当前尚未接入 utoipa。前端类型由 ts-rs 从 `crates/contract/src/dto.rs` 生成到 `packages/shared/src/bindings`（`bun run gen:types`），`bun run check` 会校验产物未过期。

---

## 11. CLI 设计

CLI 是独立交付物：独立仓库目录、独立版本号、独立发布流水线，不依赖服务端代码。启动时请求 `GET /api/v1/meta` 校验 `min_cli_version`，版本过低直接报错并给出 `curl -fsSL <base>/install.sh | sh` 的升级提示。

### 11.1 配置解析优先级

```
--base-url / --project / --token 参数
  > 环境变量 WTOW_BASE_URL / WTOW_PROJECT / WTOW_TOKEN
  > 当前目录向上查找的 .wtow.toml        # 只存 base_url 与 project，不存 token
  > ~/.config/wtow/config.toml           # 多 profile，含 active profile
```

`.wtow.toml` 随仓库提交，Agent 在项目目录下执行命令时自动识别项目；令牌通过环境变量注入，避免进仓库。

```toml
# .wtow.toml
base_url = "https://wtow.internal"
project  = "finance-agent"
```

```bash
export WTOW_TOKEN="wtow_pat_xxx"
```

### 11.2 命令

```bash
wtow login --base-url <url> --project <slug> --token <token>
wtow whoami --json
wtow profile list|use <name>
wtow skill install [--scope user|project] [--dir <skills目录>]

wtow raw submit --title "..." --desc "..." --tag finance --attach ./shot.png
wtow raw list --status Pending --json
wtow raw get RAW-1042
wtow raw claim RAW-1042
wtow raw release RAW-1042
wtow raw related RAW-1042
wtow raw merge RAW-1042 --into RAW-1039
wtow raw duplicate RAW-1042 --of RAW-997

wtow exec create --from RAW-1042,RAW-1039 --instruction "..." --target finance_agent.md --target tools.md --priority P1
wtow raw ignore RAW-1042 --reason "..."
wtow raw reopen RAW-1042 --reason "..."
wtow exec get EXEC-2011
wtow exec release EXEC-2011 --reason "..."
wtow exec cancel EXEC-2011 --reason "..."
wtow exec reopen EXEC-2011 --reason "..."
wtow exec list --status Queued --json
wtow exec claim EXEC-2011
wtow exec complete EXEC-2011 --notes "..." --link "https://git.internal/pull/88"
```

### 11.3 Agent 友好约束

- 所有命令 `--json`，输出字段稳定。
- 退出码：`0` 成功 / `1` 通用 / `2` 未认证 / `3` 不存在 / `4` 状态冲突 / `5` 网络 / `6` 参数 / `7` 无权限或项目不匹配（403）。
- `--from` 接受逗号分隔或重复给出；`--target` 可重复。
- 非交互：不读 stdin，缺参数直接报错并给出可复制命令。
- 所有写命令自动带 `Idempotency-Key`（可用 `--idempotency-key` 覆盖）。
- 启动时校验 `.wtow.toml` 的项目与令牌所属项目是否一致，不一致直接 `7` 退出。

### 11.4 Skill 分发

Skill 文件用 `include_str!` 编进二进制，`wtow skill install` 写到 `~/.claude/skills/wtow/`（或 `./.claude/skills/wtow/`）。SKILL.md 内容见 PRD 第 6 节，CLI 升级时 Skill 同步更新。

---

## 12. 并发、一致性与幂等

| 场景 | 手段 |
| :--- | :--- |
| 两人同时认领同一条作文 | 条件 `UPDATE ... WHERE claimed_by IS NULL`，0 行即 409 |
| 两人同时领取同一条执行作文 | 同上 |
| 重复提交建联请求 | `Idempotency-Key` + `idempotency_keys` 表 |
| 编辑冲突 | `version` + `If-Match` |
| 建联与关闭来源的一致性 | 单事务 |
| ID 序号并发 | `project_counters` 的 UPSERT 行锁 |
| 认领泄漏 | 后台任务定时释放 |
| 后台任务多实例竞争 | 超时释放语句本身幂等；与建联的竞态由 8.3 的 `FOR UPDATE` 行锁解决 |
| 同目标并发开发 | 领取时 `target_resources &&` 检测，`409 TARGET_CONFLICT`，可 `force` |

---

## 13. 检索

- 一期：`pg_trgm` 对 `title`、`description` 建 GIN 索引，支持中文子串模糊匹配；标签用 `tags && ARRAY[...]`。
- `related` 粗排：标签重合数 × 2 + `word_similarity(title)` × 3 + `word_similarity(description)`，召回范围包括非终态原始作文和近 90 天的执行作文，取前 10，返回分值和命中原因。
- 中文短文本在 trigram 下召回偏弱：D1 起用真实样本做召回评测（目标 Top-10 召回 ≥ 80%），不达标再引入 zhparser 或 pgvector。
- 服务端校验去重：`exec create`、`merge`、`duplicate` 要求该认领者在本次认领期内调用过 `related`（记录在审计中），否则返回 `409 RELATED_NOT_CHECKED`；可带 `skip_related_check=true` 跳过，并写入审计。
- 二期：如需语义检索，增加 `pgvector` 与 embedding 列，**由分配者本地 Agent 生成向量**，服务端只存不算——与「服务端不跑模型」的约束一致。

---

## 14. 附件

- 默认存本地卷 `./data/attachments/{project_id}/{yyyy}/{mm}/{uuid}`；可配置切换 S3 / MinIO。
- 上传：`infer` 嗅探真实类型，白名单 `image/png|jpeg|gif`、`text/plain`、`application/json`、`application/zip`，单文件 20MB。
- 不接收外部 URL，避免 SSRF 与链接失效。
- 下载：鉴权后流式返回；S3 模式签发 10 分钟预签名 URL，本地模式用 `HMAC-SHA256(server_secret, id|exp)` 签名的 URL。
- 上传后未绑定到作文的附件 24 小时后由后台任务清理。
- 图文引用：正文（`description` / `instruction`）用 `![说明](ATT-xxx)` 引用附件。写入时校验被引用的附件属于本作文，执行作文还可以引用其来源原始作文的附件，否则返回 `422 VALIDATION`，保证 Agent 不会拿到悬空引用。
- 执行作文详情返回 `attachments`：先列自身附件，再列各来源原始作文的附件，`owner_id` 标明出处。列表接口不带附件。
- CLI 下发：`wtow exec get <id> --download` 把附件下载到 `.wtow/attachments/<id>/`，给每个附件补 `local_path`，并输出 `instruction_local`（ATT 引用已换成本地路径）。Agent 用 Read 工具查看本地图片，从而拿到图文上下文。

---

## 15. 可观测性与运维

- `tracing` + `TraceLayer`，日志字段含 `request_id`、`project_id`、`user_id`、`route`。
- 健康检查：`/healthz`（进程存活）、`/readyz`（数据库连通）。
- 指标（可选）：`metrics` crate 暴露 Prometheus 端点——请求量、延迟、认领冲突数、管道积压。
- 数据库迁移随二进制启动时执行（`sqlx::migrate!`），可用 `WTOW_MIGRATE_ON_START=false` 关闭。
- 备份：`pg_dump` 每日 + 附件目录同步，保留 30 天。

---

## 16. 部署与分发

Web 与 CLI 是两条独立的发布链路，版本号互不绑定。

### 16.1 Web 程序部署

```yaml
# deploy/compose.yml（示意）
services:
  db:
    image: postgres:16
    environment: [POSTGRES_DB=wtow, POSTGRES_USER=wtow, POSTGRES_PASSWORD=...]
    volumes: [db:/var/lib/postgresql/data]
  app:
    build: .
    environment:
      WTOW_BIND: 0.0.0.0:8080
      WTOW_DATABASE_URL: postgres://wtow:...@db/wtow
      WTOW_PUBLIC_BASE_URL: https://wtow.internal
      WTOW_ATTACHMENT_DIR: /data/attachments
      WTOW_RELEASE_DIR: /data/releases      # CLI 产物目录，由 Web 只读下发
    volumes: [data:/data]
    ports: ["8080:8080"]
```

多阶段构建：`node` 构建 `web/dist` → `rust` 编译服务端（`rust-embed` 打包前端）→ `debian-slim` 运行。

### 16.2 CLI 发布

- 独立流水线，版本号独立（semver），与 Web 版本解耦。
- 构建目标：`aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-unknown-linux-musl`、`aarch64-unknown-linux-musl`。
- 产物：`wtow-v1.4.2-aarch64-apple-darwin.tar.gz` + 同名 `.sha256`，连同 `latest.json` 清单推送到 Web 的 `WTOW_RELEASE_DIR`，或由管理员手工上传。
- 打包由 `bun run release`（`scripts/release.ts`）完成：按 `--target` 交叉编译、固定 mtime 与属主保证可复现，并把同一目录下其它架构的条目合并进 `latest.json`；`version` 取自根 `Cargo.toml` 的 `[workspace.package]`，`min_cli_version` 取自服务端常量，避免清单与代码漂移。
- 兼容性：服务端 `/api/v1/meta` 返回 `{ api_version, min_cli_version }`，CLI 启动时校验；低于下限时直接报错并提示升级命令，而不是带着旧协议半途失败。

### 16.3 Web 提供 CLI 的下载与安装

Web 是 CLI 的分发入口，但不参与 CLI 的运行。

| 端点 | 说明 |
| :--- | :--- |
| `GET /download` | 下载页（前端路由），按 UA 推荐平台，展示一键命令 |
| `GET /install.sh` | 安装脚本：检测 OS/ARCH → 下载对应产物 → 校验 sha256 → 落到 `~/.local/bin/wtow` |
| `GET /dl/latest.json` | 版本清单：`{ version, min_cli_version, artifacts: [{ target, url, sha256 }] }` |
| `GET /dl/{artifact}` | 产物下载，`Content-Disposition: attachment` |

项目详情页直接生成该项目专用的接入命令，用户复制即可：

```bash
curl -fsSL https://wtow.internal/install.sh | sh

wtow login --base-url https://wtow.internal \
           --project finance-agent \
           --token wtow_pat_xxx

wtow skill install
```

- 下载与安装**不需要登录**，避免 Agent 前置依赖账号；令牌只在 `login` 时需要。
- 安装脚本强制 HTTPS（`curl --proto '=https'`），并校验 sha256。由于 sha256 与产物同源，`latest.json` 额外用 minisign 签名，公钥在发布时写入 `install.sh` 与 CLI 自身；签名不通过即中止安装。下载地址必须与 `WTOW_PUBLIC_BASE_URL` 同源。

---

## 17. 安全清单

- 令牌只存哈希，明文仅在创建时返回一次；支持按项目吊销。
- 会话 Cookie：`HttpOnly` + `Secure` + `SameSite=Lax`；写操作要求自定义头 `X-Requested-With` 防 CSRF。
- CORS 仅允许 `WTOW_PUBLIC_BASE_URL`。
- 登录与令牌创建接口限流。
- 所有项目内查询强制带 `project_id`，复合外键兜底。
- 附件类型与大小校验，存储路径不暴露原始文件名。
- 审计记录认领、建联、状态迁移、成员与令牌变更。

---

## 18. 测试策略

| 层 | 方式 |
| :--- | :--- |
| 领域逻辑 | 纯函数单测：状态机非法迁移、角色权限 |
| 仓储 | `#[sqlx::test]`，每个用例独立数据库 |
| API | `tower::ServiceExt::oneshot`，覆盖鉴权、隔离、幂等、409 分支 |
| CLI | 集成测试：起临时服务，用 CLI 跑完整「提交 → 认领 → 建联 → 领取 → 完成」 |
| 隔离专项 | 用 A 项目令牌访问 B 项目资源，断言 403/404 |
| 前端 | Vitest 单测 + Playwright 覆盖工作台与看板主路径 |

---

## 19. 里程碑

| 阶段 | 内容 | 验收 |
| :--- | :--- | :--- |
| **D0** | 两个独立项目骨架、项目/用户/成员/令牌、登录、静态资源内嵌 | 能创建项目并发令牌 |
| **D1** | 原始作文提交/列表/详情/认领、附件上传 | 测试者在 Web 上能提交并看到 |
| **D2** | 执行作文创建（拆/合）、关联表、双向追溯、分配工作台 | 分配者能完成一次完整拆解 |
| **D3** | 执行管道、领取/完成、CLI 全量命令、CLI 发布流水线 | Agent 能通过 CLI 走完整闭环 |
| **D4** | 下载页、`install.sh`、`latest.json`、`/meta` 版本校验、`wtow skill install` | 新机器一条命令装好 CLI 并接入项目 |
| **D5** | `related` 检索、统计页、MCP 适配（可选）、SSE、指标 | 按需 |

---

## 20. 待拍板事项

| # | 问题 | 建议 |
| :--- | :--- | :--- |
| 1 | 谁可以创建项目：所有登录用户，还是仅超管 | 所有登录用户，创建者为项目 admin |
| 2 | 是否接入 OIDC / 企业 SSO | 一期先邮箱密码，二期加 |
| 3 | 附件存本地还是对象存储 | 一期本地卷，接口抽象成 `BlobStore` 便于切换 |
| 4 | 是否需要跨项目视图（例如「我所项目」看板） | 一期只做项目列表，不做跨项目聚合 |
| 5 | 检索是否需要中文分词（jieba/zhparser） | 一期 `pg_trgm` 足够，量大再评估 |
| 6 | CLI 与 PRD 的命名统一：`wtow-cli` 还是 `wtow` | **已定**：二进制名 `wtow`，crate 名 `wtow-cli` |
| 8 | Agent 分配者能否自主判定合并 / 重复 | 默认允许并必填 reason；项目可开 `require_human_triage` |
| 9 | 目标冲突是警告还是强锁 | 409 + `force`，平台不做强锁 |
| 7 | CLI 产物由 Web 自托管下发，还是走 GitHub Releases | 自托管，离线环境也能装；`latest.json` 格式与 GitHub Releases 兼容，将来可切换 |
| 8 | 安装脚本要不要支持 Windows | 一期先 macOS / Linux，Windows 用户用 zip 手动安装 |