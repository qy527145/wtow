# wtow 命令

```
wtow login --base-url <url> --project <slug> --token <token> [--profile <name>]
wtow whoami
wtow profile list | use <name>
wtow skill install [--scope user|project]

wtow raw submit --title T --desc D [--tag X]... [--attach FILE]...
wtow raw list [--status S] [--tag X] [--q KW] [--mine] [--page N] [--page-size N]
wtow raw get <id> [--download [DIR]]
wtow raw claim|release|related|execs <id>
wtow raw edit <id> [--title T] [--desc D] [--tag X]... [--if-match V]
wtow raw merge <id> --into <id> --reason R [--skip-related-check]
wtow raw duplicate <id> --of <id> --reason R [--skip-related-check]
wtow raw ignore|reopen <id> --reason R

wtow exec create --from RAW-a,RAW-b --instruction I [--target T]... [--priority P0-P3]
                 [--developer <user_id>] [--close] [--skip-related-check] [--attach FILE]...
wtow exec list [--status S] [--developer N] [--target T] [--q KW]
wtow exec get <id> [--download [DIR]]
wtow exec raws <id>
wtow exec claim <id> [--force]
wtow exec release|cancel|reopen <id> --reason R     (cancel 可加 --no-requeue)
wtow exec complete <id> --notes N [--link URL]...
wtow exec edit <id> [--instruction I] [--priority P] [--target T]... [--notes N] [--link URL]...

wtow file get <ATT-id> [-o PATH]
```

附件：
- 正文用 `![说明](ATT-xxx)` 引用附件；只能引用本作文（执行作文还包括其来源）的附件，否则退出码 6。
- `submit` / `exec create` 的正文里写 `](./a.png)` 且同时 `--attach ./a.png`，会自动换成 `](ATT-xxx)`。
- `exec get` 返回自身与来源原始作文的附件，`owner_id` 标明出处。
- `--download` 默认存到 `.wtow/attachments/<id>/`（目录自带 `.gitignore`），给每个附件补 `local_path`，
  并输出 `instruction_local` / `description_local`：正文中的 ATT 引用已换成本地路径。

全局：`--json`、`--base-url`、`--project`、`--token`、`--idempotency-key`。

退出码：0 成功 / 1 通用 / 2 未认证 / 3 不存在 / 4 状态冲突 / 5 网络或服务端 / 6 参数 / 7 无权限或项目不匹配。
错误以 JSON 输出到 stderr：`{"error":{"code","message","details"}}`。
