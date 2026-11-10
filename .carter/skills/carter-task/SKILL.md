---
name: carter-task
description: 需要拆解任务、更新任务状态、认领任务、或者回答「我现在该做什么」时读它。任务是 .carter 里的基本执行单位，带父子关系与依赖关系；所有操作通过 team 工具的 task_new / task_update / task_status / task_claim / task_release 完成。
---
<!-- carter-skill-version: 3 -->

# 任务

一个任务 = 一件可以独立说「做完了」的事，挂在某个目标下面。

## 父子 vs 依赖：两种不同的关系

* **父子**（`parent_id`）—— 「这件事由哪几件事组成」，拆解用。父任务的进度由子任务
  算出来，它自己的状态不必手动维护得很细。
* **依赖**（`depends_on`）—— 「这件事要等谁先完成」，先后用。

两者**分开写，不要混**：把依赖写成 `parent_id` 会让进度算错，画图时布局也会乱。
父任务与依赖都必须在**同一个目标**里。

## 新建

```json
{
  "action": "task_new",
  "goal_id": "g-…",
  "title": "写序列化",
  "description": "做法、注意事项",
  "parent_id": "t-…",
  "depends_on": ["t-…", "t-…"],
  "priority": "P1",
  "assignee": "小张",
  "estimate_hours": 4,
  "deliverable": "一句话说清交什么",
  "acceptance": ["cargo test 通过", "golden fixture 往返一致"]
}
```

只有 `goal_id` 与 `title` 必填。`depends_on` 是**数组**，一个依赖也写成
`["t-…"]`。回灌里有单独一行 `id = t-…`，拆下一层时用它当 `parent_id`，
排先后时把它放进别的任务的 `depends_on`。

拆一棵树的顺序：先建父任务拿到 id，再建子任务；先建被依赖的，再建依赖它的。

## 推进状态

```json
{ "action": "task_status", "task_id": "t-…", "status": "doing" }
{ "action": "task_status", "task_id": "t-…", "status": "blocked", "blocked_reason": "等上游确认接口" }
{ "action": "task_status", "task_id": "t-…", "status": "done" }
```

* `blocked` 必须带 `blocked_reason`，否则会被拒绝。
* 改成 `done` 时，回灌会告诉你**哪些任务因此可以开工了** —— 那就是下一步。
* **每真的推进一步就更新一次**，不要攒到最后。状态是别人判断「能不能开工」的唯一
  依据，落后于实际的状态比没有状态更坏。

## 修改其它字段

```json
{ "action": "task_update", "task_id": "t-…", "title": "…", "depends_on": ["t-…"] }
```

可改：`title`、`description`、`priority`、`assignee`、`parent_id`、`depends_on`、
`estimate_hours`、`deliverable`、`acceptance`。没给的字段保持原样；
`depends_on` / `acceptance` 给了就是**整列替换**；`parent_id` 传空串变回根任务。

## 指派与认领

```json
{ "action": "assign", "task_id": "t-…", "assignee": "小张", "text": "接口文档在 docs/api.md" }
{ "action": "task_claim", "task_id": "t-…" }
{ "action": "task_release", "task_id": "t-…" }
```

* **指派**（`assign`）：把任务交给某个人，对方会收到通知。原来有人负责、换成别人的
  就是「转交」。`task_new` / `task_update` 里直接写 `assignee` 也会通知。
* **认领**（`task_claim`）：用户自己说「这件我来」。负责人设成用户在团队里的成员 id，
  在事件链上记一条，有远端时立刻推送；**推送失败、或者链上有人先认领了，都算认领
  没成**，工具会撤回本地改动并说是谁 —— 这时换个任务，不要覆盖。
* 已经归别人的任务，`task_claim` 会直接拒绝；真要换人，问过用户之后用 `assign`。

## 拆到多细

一个任务应该是**一个人在一两天内能说「做完了」**的粒度。再大就拆，再小就别建 ——
一堆「改一个字段」的任务只会让人不再看任务图。

`acceptance` 写可验证的标准（「cargo test 通过」），不要写「质量好」。
