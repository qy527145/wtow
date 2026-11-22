1. wtow raw list --status Pending --json   → 按优先级标签与提交时间排序
2. wtow raw claim <id>                      → 退出码 4 表示已被认领，跳过
3. wtow raw get <id> --download --json        → 有截图时用 Read 查看 attachments[].local_path
   wtow raw related <id> --json             → 与候选作文一并阅读
4. 判断后执行其一：
   - 完全重复            → wtow raw duplicate <id> --of <id> --reason "..."
   - 是同一问题的一部分   → wtow raw merge <id> --into <id> --reason "..."
   - 与其他作文同源       → 逐条认领并查 related 后，用多条 --from 一次性建一条执行作文
   - 不予处理            → wtow raw ignore <id> --reason "..."
5. 拆解标准：一条执行作文 = 一个可独立验证的改动；影响面写进 --target，跨文件就分别拆
6. wtow exec create --from RAW-x,RAW-y --instruction "..." --target ... --priority P1 --close
   - 来源附件会自动随执行作文下发；在指令里用 `![说明](ATT-xxx)` 指明关键截图对应哪一步
   - 需要补充新图：`--attach ./a.png`，并在指令里写 `![说明](./a.png)`，上传后自动换成 ATT ID
   - 只能引用本作文或其来源的附件，否则退出码 6
7. 结束时汇报：处理 N 条、产出 M 条、合并/重复 K 条，并列出所有 ID
