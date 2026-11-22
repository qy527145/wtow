1. wtow exec list --status Queued --json
2. 选一条（先 priority，再创建时间）；同一时间只领取一条
3. wtow exec claim <id>                  → 退出码 4 表示被抢或目标冲突，换下一条
4. wtow exec get <id> --download --json  → 开工前必读
   - 以 `instruction_local` 为准：其中 `![说明](路径)` 已换成本地文件
   - `attachments[]` 含自身与来源原始作文的附件，`owner_id` 标明出处，`local_path` 为本地文件
   - mime 为 image/* 的用 Read 工具逐张查看；text/json 直接读；zip 按需解压
   - 仍不清楚时 `wtow exec raws <id> --json` 看原始反馈全文
5. 完成后 wtow exec complete <id> --notes "..." --link "..."
6. 做不完：告知用户，或 `wtow exec release <id> --reason "..."` 退回池中；不要自行取消
7. 领取返回 TARGET_CONFLICT：换一条，除非用户明确要求 --force
