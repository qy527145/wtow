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

Web 与 CLI 是两个独立的 Cargo 项目，各自构建、各自发布：

```
wtow/
├── server/                    # ── Web 程序（独立构建）──
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs
│   │   ├── config.rs          # env / TOML 配置
│   │   ├── app.rs             # Router 组装、中间件
│   │   ├── auth/              # 会话、PAT、角色校验
│   │   ├── project/           # 项目上下文提取器
│   │   ├── api/               # raw / exec / files / stats / admin / release
│   │   ├── domain/            # 状态迁移、认领、建联（纯函数 + 事务编排）
│   │   ├── jobs/              # 认领超时释放、幂等键清理
│   │   └── assets.rs          # rust-embed
│   ├── web/                   # React SPA
│   │   ├── src/pages/
│   │   ├── src/components/
│   │   ├── src/api/           # openapi-typescript 生成
│   │   └── vite.config.ts
│   ├── migrations/            # sqlx 迁移
│   └── deploy/{Dockerfile,compose.yml}
├── cli/                       # ── CLI（独立构建、独立版本号）──
│   ├── Cargo.toml
│   ├── src/{main.rs, cmd/, config.rs}
│   └── skill/                 # SKILL.md + references/*.md（include_str!）
├── contract/                  # 仅 wire 类型与错误码，无运行时依赖
│   └── src/{dto.rs, error.rs}
├── releases/                  # 构建产物（tar.gz + sha256），由 Web 下发
└── docs/{PRD.md,DESIGN.md}
```

- `cli/` 不依赖 `server/` 的任何代码，也不依赖 axum / sqlx；两者只共享 `contract/` 里的 serde DTO 与错误码常量。
- `contract/` 刻意做成零依赖的小 crate，只是为了不让接口字段在两边各写一遍。若将来拆成两个仓库，它单独版本化发布，或改为从 OpenAPI 生成。
- `server/` 与 `cli/` 可以分别设置 CI 流水线与发布节奏，Web 升级不强制 CLI 升级。

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

### 6.2 角色

角色是**项目内**的概念（`memberships.role`），同一用户在不同项目可以有不同角色。令牌额外带 `role`，且不得超过持有者在该项目的成员角色——这样可以把「只读令牌」「开发者令牌」安全地塞进 CI。

### 6.3 请求上下文

```rust
pub struct ProjectCtx {
    pub project_id: i64,
    pub slug: String,
    pub user_id: i64,
    pub role: Role,        // Tester | Assigner | Developer | Admin
    pub actor_type: ActorType, // Human | Agent
}
```

提取器负责：解析令牌 → 查项目 → 校验 slug → 校验成员关系 → 注入。所有业务 handler 只接收 `ProjectCtx`，拿不到它就无法访问数据。

---

## 7. 数据模型

### 7.1 枚举

```sql
CREATE TYPE project_role   AS ENUM ('tester','assigner','developer','admin');
CREATE TYPE raw_status     AS ENUM ('Pending','Claimed','Processed','Merged','Duplicate','Ignored');
CREATE TYPE exec_status    AS ENUM ('Queued','InProgress','Done','Cancelled');
CREATE TYPE link_relation  AS ENUM ('split','merge');
CREATE TYPE owner_type     AS ENUM ('raw','exec');
```

### 7.2 项目与用户

```sql
CREATE TABLE projects (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_superadmin BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       project_role NOT NULL,
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
  role         project_role NOT NULL,
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
  merged_into_type TEXT,
  merged_into_id   TEXT,
  version          INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, seq)
);

CREATE INDEX raw_project_status_idx ON raw_compositions (project_id, status, created_at DESC);
CREATE INDEX raw_title_trgm_idx     ON raw_compositions USING GIN (title gin_trgm_ops);

CREATE TABLE exec_compositions (
  project_id      BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id              TEXT NOT NULL,                  -- EXEC-2011
  seq             BIGINT NOT NULL,
  instruction     TEXT NOT NULL,
  target_resource TEXT,
  status          exec_status NOT NULL DEFAULT 'Queued',
  priority        SMALLINT NOT NULL DEFAULT 2,
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
  owner_type  owner_type NOT NULL,
  owner_id    TEXT NOT NULL,
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
  action      TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_project_time_idx ON audit_logs (project_id, created_at DESC);

CREATE TABLE idempotency_keys (
  project_id   BIGINT NOT NULL,
  key          TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  response     JSONB NOT NULL,
  status_code  SMALLINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, key)
);
```

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

超时释放由后台任务每 5 分钟执行：

```sql
UPDATE raw_compositions
   SET claimed_by = NULL, claimed_at = NULL, status = 'Pending', version = version + 1
 WHERE status = 'Claimed' AND claimed_at < now() - interval '24 hours';
```

### 8.3 创建执行作文（拆分 / 合并）

```
BEGIN
  seq  ← 分配 EXEC 序号
  INSERT exec_compositions (status = developer_id ? 'InProgress' : 'Queued')
  FOR EACH raw_id IN source_raw_ids:
      INSERT raw_exec_links (relation = len==1 ? 'split' : 'merge')
  IF close_sources:
      UPDATE raw_compositions SET status='Processed' WHERE id = ANY(source_raw_ids)
  INSERT audit_logs
COMMIT
```

全部在同一事务内完成，避免出现「有任务没来源」的孤儿数据。

### 8.4 领取与完成

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
| `POST` | `/projects/{slug}/exec/{id}/claim` | developer | 领取 |
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

### 10.3 类型同步

`utoipa` 标注 handler → `/api/openapi.json` → CI 中 `openapi-typescript` 生成 `web/src/api/schema.d.ts`。接口变更导致前端类型不匹配时构建失败。

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
wtow project list
wtow skill install [--scope user|project]

wtow raw submit --title "..." --desc "..." --tag finance --attach ./shot.png
wtow raw list --status Pending --json
wtow raw get RAW-1042
wtow raw claim RAW-1042
wtow raw release RAW-1042
wtow raw related RAW-1042
wtow raw merge RAW-1042 --into RAW-1039
wtow raw duplicate RAW-1042 --of RAW-997

wtow exec create --from RAW-1042,RAW-1039 --instruction "..." --target finance_agent.md --priority P1
wtow exec list --status Queued --json
wtow exec claim EXEC-2011
wtow exec complete EXEC-2011 --notes "..." --link "https://git.internal/pull/88"
```

### 11.3 Agent 友好约束

- 所有命令 `--json`，输出字段稳定。
- 退出码：`0` 成功 / `1` 通用 / `2` 未认证 / `3` 不存在 / `4` 状态冲突 / `5` 网络 / `6` 参数。
- 非交互：不读 stdin，缺参数直接报错并给出可复制命令。
- 所有写命令自动带 `Idempotency-Key`（可用 `--idempotency-key` 覆盖）。
- 启动时校验 `.wtow.toml` 的项目与令牌所属项目是否一致，不一致直接 `4` 退出。

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
| 后台任务多实例竞争 | `SELECT ... FOR UPDATE SKIP LOCKED`（为将来多实例预留） |

---

## 13. 检索

- 一期：`pg_trgm` 对 `title`、`description` 建 GIN 索引，支持中文子串模糊匹配；标签用 `tags && ARRAY[...]`。
- `related` 粗排：标签重合数 × 2 + `similarity(title)`，取前 10，返回分值供分配者判断。
- 二期：如需语义检索，增加 `pgvector` 与 embedding 列，**由分配者本地 Agent 生成向量**，服务端只存不算——与「服务端不跑模型」的约束一致。

---

## 14. 附件

- 默认存本地卷 `./data/attachments/{project_id}/{yyyy}/{mm}/{uuid}`；可配置切换 S3 / MinIO。
- 上传：`infer` 嗅探真实类型，白名单 `image/png|jpeg|gif`、`text/plain`、`application/json`、`application/zip`，单文件 20MB。
- 不接收外部 URL，避免 SSRF 与链接失效。
- 下载：鉴权后流式返回，或签发 10 分钟有效的预签名 URL。

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
- 安装脚本强制 HTTPS、校验 sha256，不允许 `latest` 之外的重定向域名。

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
| 6 | CLI 与 PRD 的命名统一：`wtow-cli` 还是 `wtow` | 二进制名用 `wtow`，crate 名 `wtow-cli` |
| 7 | CLI 产物由 Web 自托管下发，还是走 GitHub Releases | 自托管，离线环境也能装；`latest.json` 格式与 GitHub Releases 兼容，将来可切换 |
| 8 | 安装脚本要不要支持 Windows | 一期先 macOS / Linux，Windows 用户用 zip 手动安装 |