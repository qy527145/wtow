# WTOW (Write to Write) 平台需求规格说明书 (PRD)

> 版本 v1.2（已按 DESIGN 修订：多项目路径、状态迁移表、冲突提醒、交付回溯）

## 1. 业务背景与系统定位

在 Agent 原生开发时代，测试者能持续产出大量非结构化的问题反馈（小作文）。但把这些反馈原样丢给开发者和 Agent，会带来两项额外成本：一是**重复劳动**——同一问题被不同的人反复处理；二是**工作冲突**——两篇作文存在交集，两个 Agent 同时动同一处。

**WTOW (Write to Write / 小作文系统)** 把这段过程拆成两条彼此独立的管道：测试者把反馈投入**原始作文管道**，分配者结合存量作文与历史已完成记录，将原始作文**去重、合并、拆分**成一条条独立的**执行作文**，推入执行作文管道，由开发者或 Agent 消费。

平台只负责存储、检索与流转追踪：**不在服务端运行任何模型，不接管代码仓库，也不判断问题是否真的被修好**。

---

## 2. 核心架构与角色状态机

### 2.1 角色流转

```
[ 测试者 (tester) ] ──提交 raw──> [ 原始作文管道 ]
                                        │
                             认领 / 阅读（含历史）
                                        ▼
                              [ 分配者 (assigner) ]
                         本地 Agent 辅助去重 / 合并 / 拆分
                                        │ 创建 exec + 建立关联
                                        ▼
                              [ 执行作文管道 ]
                                        │ 领取
                                        ▼
                              [ 开发者 (developer) ]
                                        │ 完成并提交说明
                                        ▼
                                   [ 已交付 ]
```

所有角色既可以是人，也可以是 Agent，通过 `actor_type` 区分。

| 角色 | 标识 | 职责 | 入口 |
| :--- | :--- | :--- | :--- |
| 测试者 | `tester` | 提交原始作文，补充上下文与附件 | Web / Skill + CLI |
| 分配者 | `assigner` | 认领、阅读存量与历史、去重合并拆分、产出执行作文 | Web 工作台 + 本地 Agent（Skill + CLI） |
| 开发者 | `developer` | 从执行管道领取任务、完成后提交交付说明 | Skill + CLI |
| 管理员 | `admin` | 用户与令牌管理、强制释放认领、审计查看 | Web / CLI |

权限要点：只有分配者可以认领与加工原始作文；开发者只能操作执行作文；管理员可强制释放他人的认领。

### 2.2 状态机定义

**原始作文（`raw_compositions`）**

```
Pending ──认领──> Claimed ──加工完 / 释放（已建联）──> Processed
   │                 │
   │                 └──释放认领（未建联）──> Pending
   ├─(Pending 或 Claimed)──并入他人──> Merged
   ├─(Pending 或 Claimed)──判定重复──> Duplicate
   └─(Pending 或 Claimed)──不予处理──> Ignored

Merged / Duplicate / Ignored / Processed ──重新打开──> Pending
```

- 认领 24 小时无操作（按最后一次操作时间）自动释放：未建联回 `Pending`，已建联转 `Processed`。
- 产出至少一条执行作文后由 `Claimed` 置为 `Processed`；允许分批建联。
- 完整迁移表（前置条件、角色、字段变更）以 DESIGN 8.5 为准。
- 原始作文另有派生字段 `delivery`（`none` / `in_progress` / `delivered` / `cancelled`），提交者据此追踪交付（DESIGN 8.7）。

**执行作文（`exec_compositions`）**

```
Queued ──派单/领取──> InProgress ──完成──> Done
   │      <──退回池中──      │
   └──────取消────────────┴──> Cancelled
Done ──重新打开──> InProgress
```

- 创建时未指定 `developer_id` 即进入 `Queued` 待领取池。
- 领取时若 `target_resources` 与其他进行中任务相交，返回 `409 TARGET_CONFLICT`，可 `force` 强领——这是平台对「工作冲突」的提醒机制。
- 取消后，若来源原始作文已无其他有效任务，则回到 `Pending`，反馈不会丢失。
- 完整迁移表以 DESIGN 8.6 为准。
- 进入 `Done` 必须填写 `developer_notes`，可选附 `result_links`。

---

## 3. 数据模型设计 (Data Schema)

ID 采用「前缀 + 序号」的可读形式：`RAW-1042`、`EXEC-2011`。

### 3.1 原始小作文表 (`raw_compositions`)

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | VARCHAR(16) | 主键 `RAW-xxxx` |
| `title` | VARCHAR(255) | 简短标题 |
| `description` | TEXT | 详细的图文说明、Bad Case 现场日志上下文 |
| `attachments` | —（独立表） | 附件存于 `attachments` 表，先上传拿 `ATT-xxx`，提交作文时绑定；24 小时未绑定自动清理 |
| `status` | ENUM | `Pending` `Claimed` `Processed` `Merged` `Duplicate` `Ignored` |
| `reporter_id` | BIGINT | 提交者，**由服务端从令牌/会话取得**，不接受请求体传入 |
| `tags` | JSON | 自由标签，用于分组与检索 |
| `claimed_by` | VARCHAR(64) | 当前认领者，可空 |
| `claimed_at` | TIMESTAMP | 认领时间，用于超时释放 |
| `merged_into_id` | TEXT | 合并 / 重复目标（只指向原始作文，恒指向根节点），可空 |
| `last_activity_at` | TIMESTAMP | 认领者最后一次操作时间，用于超时释放 |
| `triage_reason` | TEXT | 合并 / 重复 / 忽略的理由，Agent 操作时必填 |
| `version` | INT | 乐观并发版本号，每次更新自增 |
| `created_at` | TIMESTAMP | 提交时间 |
| `updated_at` | TIMESTAMP | 最后更新时间 |

### 3.2 执行小作文表 (`exec_compositions`)

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | VARCHAR(16) | 主键 `EXEC-xxxx` |
| `instruction` | TEXT | 解耦后的原子化执行指令 |
| `target_resources` | TEXT[] | **影响范围标签**（如 `finance_agent.md`），可多个。领取时用于冲突提醒（409 + `force`），平台不做强锁 |
| `status` | ENUM | `Queued` `InProgress` `Done` `Cancelled` |
| `priority` | ENUM | `P0` / `P1` / `P2` / `P3`，默认 `P2`（库内存 0–3） |
| `assigner_id` | VARCHAR(64) | 创建者（分配者） |
| `developer_id` | VARCHAR(64) | 领取者，**可空**（空即待领取） |
| `claimed_at` | TIMESTAMP | 领取时间 |
| `developer_notes` | TEXT | 交付说明，进入 `Done` 时必填 |
| `result_links` | JSON | 变更证据链接（PR / commit / 文档 / 截图） |
| `version` | INT | 乐观并发版本号 |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |
| `completed_at` | TIMESTAMP | 完成时间 |

### 3.3 原始—执行关联表 (`raw_exec_links`)（新增）

一行代表「一条原始作文」与「一条执行作文」之间的一次建联。**没有这张表，去重与合并就无法追溯。**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | BIGSERIAL | 主键 |
| `raw_id` | VARCHAR(16) | 外键 → `raw_compositions` |
| `exec_id` | VARCHAR(16) | 外键 → `exec_compositions` |
| `relation` | ENUM | `split`（由该作文拆出）/ `merge`（与他人合并而来） |
| `created_by` | VARCHAR(64) | 建立关联的分配者 |
| `created_at` | TIMESTAMP | |

约束：`UNIQUE(raw_id, exec_id)`、`INDEX(exec_id)`。

任何一条执行作文都能回溯到它的全部原始来源；任何一条原始不满，也能查出最终被哪几条执行作文消化。

### 3.4 审计日志 (`audit_logs`)

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | BIGSERIAL | 主键 |
| `actor_id` | VARCHAR(64) | 操作者 |
| `action` | VARCHAR(64) | 如 `raw.claim`、`exec.create`、`raw.merge` |
| `object_type` | VARCHAR(32) | `raw` / `exec` / `user` |
| `object_id` | VARCHAR(32) | 目标 ID |
| `detail` | JSON | 变更前后快照或参数 |
| `created_at` | TIMESTAMP | |

---

## 4. 平台核心 API 矩阵

统一约定：

- 所有项目内路径带 `/api/v1/projects/{slug}` 前缀，下文简写省略。

- 鉴权：`Authorization: Bearer <token>`
- 失败用 HTTP 状态码承载语义，body 为 `{"error": {"code": "", "message": "", "details": {}}}`
- 列表接口统一 `?page=&page_size=`，返回 `{"items": [], "total": 0}`
- `POST` 支持 `Idempotency-Key`；`PATCH` 支持 `If-Match: <version>`，不匹配返回 `409 VERSION_CONFLICT`

### 4.1 `POST /api/v1/projects/{slug}/raw`

测试者（或监控 Agent）上传原始小作文。

```json
{
  "title": "理财Agent在极端边界下出现兜底逻辑覆盖",
  "description": "当用户输入负数时，Agent未触发报错，而是返回了高风险产品...",
  "tags": ["finance", "edge-case"],
  "attachments": ["ATT-82"]
}
```

响应：`{ "id": "RAW-1042", "status": "Pending", "version": 1 }`

### 4.2 `GET /api/v1/projects/{slug}/raw`

分配者获取待处理作文。参数：`status`、`reporter_id`、`delivery`、`claimed_by`、`tag`、`q`、`sort`、分页。

### 4.3 `POST /api/v1/projects/{slug}/raw/{id}/claim` / `DELETE /api/v1/projects/{slug}/raw/{id}/claim`

认领与释放。认领是**温和声明**，不是强制锁：资源被他人占用时返回 409，分配者换一条即可。

```json
// 409 Conflict
{
  "error": {
    "code": "RAW_ALREADY_CLAIMED",
    "message": "RAW-1042 is currently claimed by assigner_02 since 2026-10-30T09:12:00Z."
  }
}
```

### 4.4 `POST /api/v1/projects/{slug}/raw/{id}/merge` / `duplicate` / `ignore` / `reopen`

```json
// 合并：把 RAW-1042 并入 RAW-1039
{ "into_raw_id": "RAW-1039", "reason": "补充了复现步骤" }
```

`duplicate` 请求体为 `{ "of_raw_id": "RAW-997", "reason": "..." }`；`ignore` / `reopen` 请求体为 `{ "reason": "..." }`。

- `merge`：内容互补，目标吸收其信息；`duplicate`：内容相同，无新信息。
- 目标沿链解析到根节点，不允许指向自身，不会成环。
- `Pending` 与 `Claimed`（须为本人认领）均可执行；项目开启 `require_human_triage` 时 Agent 令牌不可调用。
- 调用前须在本次认领期内查过 `related`，否则 `409 RELATED_NOT_CHECKED`（可显式 `skip_related_check`，入审计）。

### 4.5 `POST /api/v1/projects/{slug}/exec`

**拆分与合并共用此接口**——一条来源就是拆，多条来源就是合。

```json
{
  "source_raw_ids": ["RAW-1042", "RAW-1039"],
  "instruction": "在 System Prompt 边界防御条件中，加入对负数输入的强类型拦截校验。",
  "target_resources": ["src/prompts/finance_agent.md"],
  "priority": "P1",
  "developer_id": null,
  "close_sources": true
}
```

响应：

```json
{
  "id": "EXEC-2011",
  "status": "Queued",
  "links": [
    { "raw_id": "RAW-1042", "relation": "merge" },
    { "raw_id": "RAW-1039", "relation": "merge" }
  ]
}
```

服务端行为：同一事务内写 `exec_compositions` 与 `raw_exec_links`；`source_raw_ids` 为 1 条时 `relation=split`，多条时 `merge`；`close_sources=true` 时把相关原始作文置为 `Processed`。所有来源必须处于 `Claimed` 且由调用者认领（多来源须逐条认领），否则 `409 RAW_NOT_CLAIMED_BY_YOU`。

### 4.6 `POST /api/v1/projects/{slug}/exec/{id}/claim` / `DELETE /api/v1/projects/{slug}/exec/{id}/claim`

开发者从待领取池领取任务。被抢返回 `409 EXEC_ALREADY_CLAIMED`；目标与进行中任务相交返回 `409 TARGET_CONFLICT`（`details` 列出冲突任务），带 `force=true` 可强领。`DELETE` 为退回池中，领取者 / assigner / admin 可调用，必填 `reason`。

### 4.7 `POST /api/v1/projects/{slug}/exec/{id}/complete`

```json
{
  "developer_notes": "已完成Prompt边界收紧，回归测试集100%通过。",
  "result_links": ["https://git.internal/pull/88"]
}
```

### 4.8 其他查询接口

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/raw/{id}` | 原始作文详情（含派生字段 `delivery`） |
| `GET` | `/raw/{id}/related` | 相似/关联作文，去重前必查（标签重合 + 标题/描述相似度，含近 90 天执行作文，返回分值与命中原因） |
| `GET` | `/raw/{id}/execs` | 该作文拆出的执行作文 |
| `GET` | `/exec` | 执行作文列表，支持 `status`、`developer_id`、`target_resources`、`q` |
| `GET` | `/exec/{id}` | 执行作文详情 |
| `GET` | `/exec/{id}/raws` | 该任务的原始来源 |
| `GET` | `/stats` | 管道水位：待处理数、待领取数、平均停留时长、停滞任务数 |
| `POST` | `/exec/{id}/cancel` | 作废（必填 `reason`，来源可回流 `Pending`） |
| `POST` | `/exec/{id}/reopen` | Done 重新打开 |
| `GET` | `/api/v1/meta` | 公开：服务端版本与 `min_cli_version` |
| `POST` | `/files` | 附件上传，返回 `attachment_id`（不接受外部 URL，MIME 白名单 + 20MB 上限） |

---

## 5. WTOW 命令行工具 (`wtow`) 规范

所有 Agent Harness 通过 `wtow` 与平台互联。**CLI 同时是人和 Agent 的默认接入面**，Agent 侧再通过随附的 Skill 调用它（见第 6 节）；MCP 仅作可选适配。

### 5.1 命令一览

```bash
# 登录与身份
wtow login --base-url <url> --project <slug> --token <token>
wtow whoami --json                       # 返回 {id, project, roles, actor_type, read_only}
wtow profile list|use <name>
wtow skill install [--scope user|project] [--dir <skills目录>]

# 测试端
wtow raw submit --title="[标题]" --desc="[描述]" --tag finance --attach="[路径]"
wtow raw list --status Pending
wtow raw get RAW-1042                    # 含 delivery 交付状态

# 分配端
wtow raw claim RAW-1042
wtow raw release RAW-1042
wtow raw related RAW-1042                # 去重前必查
wtow raw merge RAW-1042 --into RAW-1039 --reason "..."
wtow raw duplicate RAW-1042 --of RAW-997 --reason "..."
wtow raw ignore RAW-1042 --reason "..."
wtow raw reopen RAW-1042 --reason "..."
wtow exec create --from RAW-1042,RAW-1039 \
  --instruction="..." --target="src/prompts/finance_agent.md" --priority=P1   # --target 可重复
wtow exec cancel EXEC-2011 --reason "..."

# 开发端
wtow exec list --status Queued
wtow exec get EXEC-2011
wtow exec claim EXEC-2011 [--force]       # 目标冲突时退出码 4
wtow exec release EXEC-2011 --reason "..."
wtow exec complete EXEC-2011 --notes="..." --link="https://git.internal/pull/88"
```

Agent 友好要求（硬性）：

- 所有命令支持 `--json`，输出 schema 稳定
- 不读 stdin、不弹确认；缺参数直接失败，并在 stderr 给出可复制的修复命令
- 支持 `--idempotency-key`，重试不产生重复任务
- 支持 `WTOW_BASE_URL` / `WTOW_TOKEN` 环境变量

### 5.2 退出码

| 码 | 含义 |
| :--- | :--- |
| `0` | 成功 |
| `1` | 通用错误 |
| `2` | 未认证 / 令牌失效 |
| `3` | 资源不存在 |
| `4` | 状态冲突（已被认领、状态不允许该迁移） |
| `5` | 网络或服务端错误 |
| `6` | 参数校验失败 |
| `7` | 无权限 / 令牌与项目不匹配（403） |

---

## 6. Agent 接入：Skill + CLI 默认，MCP 可选

平台对外只有一份真实接口：REST API。CLI 与 MCP 都是它的封装；Skill 是写给 Agent 的**流程说明书**，不含任何代码。

### 6.1 为什么默认用 Skill + CLI

| 维度 | Skill + CLI | MCP |
| :--- | :--- | :--- |
| 接入成本 | 装一个二进制 + 拷一个 skill 目录 | 每台机器、每个项目改 MCP 配置，管进程生命周期 |
| 上下文占用 | 仅在触发时加载 | 工具 schema 常驻，每次请求都占 token |
| 组合能力 | `--json` 输出可接 `jq` / `grep` / `sort`，Agent 自由编排 | 只能逐个调用，无法在 shell 里二次加工 |
| 策略载荷 | SKILL.md 能写完整的判断标准与顺序约束 | tool description 太短，装不下业务流程 |
| 调试复现 | 人能敲同样的命令复现 Agent 行为 | 需要专门的 inspector |

WTOW 的动作面很窄，但顺序有讲究（先查 `related` 再拆、先认领再建联），正好落在 Skill 的甜区。MCP 只在没有 shell 的托管环境、或需要平台侧做工具级权限时才启用。

### 6.2 Skill 包结构

```
wtow-skill/
├── SKILL.md              # 入口：触发条件、前置检查、通用红线
└── references/
    ├── tester.md         # 提交原始作文
    ├── assigner.md       # 去重 / 合并 / 拆分
    ├── developer.md      # 领取与完成
    └── cli.md            # 完整命令与退出码
```

随 CLI 一起分发，`wtow skill install` 拷贝到 `~/.claude/skills/wtow/`（`--scope project` 则装到项目内；其他客户端用 `--dir ~/.carter/skills` 之类指定 skills 目录，装到 `<dir>/wtow/`）。

### 6.3 SKILL.md

```markdown
---
name: wtow
description: 读写 WTOW 小作文托管平台。当用户要提交问题反馈/小作文、查看待处理作文、
  把反馈拆成开发任务、或领取/完成开发任务时使用。
---

## 前置检查
1. 运行 `wtow whoami --json`。退出码 2 表示未登录：提示用户执行
   `wtow login --base-url <url> --token <token>`，不要猜测地址。
2. 后续所有命令一律追加 `--json`。

## 按角色分流
- role=tester    → 读 references/tester.md
- role=assigner  → 读 references/assigner.md
- role=developer → 读 references/developer.md

## 红线
- 拆分前必须 `wtow raw related <id>`，不得跳过。
- 有用户在场时，「合并」还是「重复」由用户决定；无人值守时可自行判定，但必须写 `--reason`。退出码 7 表示项目要求人工判定，停下汇报。
- 认领失败（退出码 4）立即换下一条，不要重试超过 2 次。
- 不要修改他人认领中的任务来推进流程。
```

### 6.4 角色手册要点

**assigner.md**

```markdown
1. wtow raw list --status Pending --json   → 按优先级标签与提交时间排序
2. wtow raw claim <id>                      → 退出码 4 表示已被认领，跳过
3. wtow raw related <id> --json             → 与候选作文一并阅读
4. 判断后执行其一：
   - 完全重复            → wtow raw duplicate <id> --of <id>
   - 是同一问题的一部分   → wtow raw merge <id> --into <id>
   - 与其他作文同源       → 用多条 --from 一次性建一条执行作文
5. 拆解标准：一条执行作文 = 一个可独立验证的改动；影响面写进 --target，跨文件就分别拆
6. wtow exec create --from RAW-x,RAW-y --instruction "..." --target ... --priority P1
7. 结束时汇报：处理 N 条、产出 M 条、合并/重复 K 条，并列出所有 ID
```

**developer.md**

```markdown
1. wtow exec list --status Queued --json
2. 选一条（先 priority，再创建时间）；同一时间只领取一条
3. wtow exec claim <id>                  → 退出码 4 表示被抢，换下一条
4. 完成后 wtow exec complete <id> --notes "..." --link "..."
5. 做不完：告知用户，或 `wtow exec release <id> --reason "..."` 退回池中；不要自行取消
6. 领取返回 409 TARGET_CONFLICT：换一条，除非用户明确要求 --force
```

**tester.md**：`wtow raw submit ...`，提交后回显 `RAW-ID` 与看板链接。

### 6.5 MCP 工具清单（可选，默认不启用）

MCP 层由同一套 REST 生成，语义与 CLI 一致。工具与 CLI 命令一一对应：

| 工具 | 对应命令 | 角色 |
| :--- | :--- | :--- |
| `wtow_list_raw` | `raw list` | 分配者 |
| `wtow_get_raw` | `raw get` | 分配者 |
| `wtow_find_related_raw` | `raw related` | 分配者 |
| `wtow_claim_raw` | `raw claim` | 分配者 |
| `wtow_create_exec` | `exec create` | 分配者 |
| `wtow_merge_raw` | `raw merge` | 分配者 |
| `wtow_mark_duplicate` | `raw duplicate` | 分配者 |
| `wtow_search_exec` | `exec list` | 分配者 |
| `wtow_list_exec` | `exec list` | 开发者 |
| `wtow_get_exec` | `exec get` | 开发者 |
| `wtow_claim_exec` | `exec claim` | 开发者 |
| `wtow_complete_exec` | `exec complete` | 开发者 |

```json
{
  "name": "wtow_create_exec",
  "arguments": {
    "source_raw_ids": ["RAW-1042", "RAW-1039"],
    "instruction": "在边界防御中加入负数强类型拦截校验。",
    "target_resources": ["src/prompts/finance_agent.md"],
    "priority": "P1"
  }
}
```

