1. wtow raw submit --title "..." --desc "..." [--tag x] [--attach ./file] --json
   有截图时在描述里写 `![说明](./shot.png)`（与 --attach 路径一致），上传后自动换成附件引用
2. 提交后回显 RAW-ID；之后用 `wtow raw get <id> --json` 查看 `delivery` 字段了解交付进度
   （none / in_progress / delivered / cancelled），`wtow raw list --mine --json` 看自己提交的。
