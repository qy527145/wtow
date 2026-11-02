---
name: wtow
description: 读写 WTOW 小作文托管平台。当用户要提交问题反馈/小作文、查看待处理作文、
  把反馈拆成开发任务、或领取/完成开发任务时使用。
---

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
