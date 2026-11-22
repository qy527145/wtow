---
name: wtow
description: 读写 WTOW 小作文托管平台。当用户要提交问题反馈/小作文、查看待处理作文、
  把反馈拆成开发任务、或领取/完成开发任务时使用。
---

## 运行 CLI

本 Skill 自带 `wtow`，不需要全局安装。先按当前平台选中本 Skill 目录下的可执行文件
（Claude Code 会把 `${CLAUDE_SKILL_DIR}` 展开为 skill 目录；其他客户端用实际安装路径替换）：

| 平台 | 可执行文件 |
| --- | --- |
| Windows x64 | `${CLAUDE_SKILL_DIR}/bin/windows-x64/wtow.exe` |
| Linux x64 | `${CLAUDE_SKILL_DIR}/bin/linux-x64/wtow` |
| Linux arm64 | `${CLAUDE_SKILL_DIR}/bin/linux-arm64/wtow` |
| macOS Apple Silicon | `${CLAUDE_SKILL_DIR}/bin/macos-arm64/wtow` |
| macOS Intel | `${CLAUDE_SKILL_DIR}/bin/macos-x64/wtow` |

下文以及 `references/` 中的 `wtow` 都指选中的这个路径。Unix 上首次运行若报
Permission denied，先对该文件执行 `chmod +x`。
若 `bin/` 下没有当前平台的二进制（例如旧版本只装了 Markdown），回退到 PATH 上的 `wtow`。

## 前置检查
1. 运行 `wtow whoami --json`。退出码 2 表示未登录：提示用户执行
   `wtow login --base-url <url> --project <slug> --token <token>`，不要猜测地址。
2. 后续所有命令一律追加 `--json`。

## 按角色分流（roles 可有多个，admin 隐含全部）
- tester    → 读 references/tester.md
- assigner  → 读 references/assigner.md
- developer → 读 references/developer.md
- 完整命令与退出码 → references/cli.md

## 红线
- 拆分前必须 `wtow raw related <id>`，不得跳过。
- 有用户在场时，「合并」还是「重复」由用户决定；无人值守时可自行判定，但必须写 `--reason`。退出码 7 表示项目要求人工判定，停下汇报。
- 认领失败（退出码 4）立即换下一条，不要重试超过 2 次。
- 不要修改他人认领中的任务来推进流程。
