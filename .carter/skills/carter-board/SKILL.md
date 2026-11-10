---
name: carter-board
description: 需要做团队回顾、阶段小结、风险盘点，建一块看板或改一块现有看板，或者读看板来总结「大家在关心什么」时读它。看板是一整页由你自由排版的 HTML。
---
<!-- carter-skill-version: 2 -->

# 看板

看板是一页 **HTML**：`.carter/boards/<id>.html`。回顾、阶段小结、风险盘点、方案对比
都行，版式完全由你决定 —— 几列卡片、表格、时间线、图表，按内容挑最清楚的那种。

看板**不**替代任务 —— 看板上写的是「观点」与「结论」，任务是「活」。回顾里冒出来要做
的事，另外用 `task_new` 建成任务，再在看板上写上任务 id（`t-…`）指过去。

## 怎么建、怎么改

用 `team` 工具，不要手写文件（id 要由工具发，标题与关联也由它补进页面）：

* 新建：`board_new` { title, html, goal_id? }
* 改：`board_update` { board_id, html?, title?, goal_id? } —— 给了 `html` 就**整页替换**，
  所以先 `board_list` 找到文件、读出原文，在原文上改完再整页交回去，别把别人加的内容丢了。

一轮结束时会自动提交，不需要自己 `git commit`。

## 页面约定

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>十月回顾</title>                          <!-- 列表里显示的名字 -->
  <meta name="carter-goal" content="g-...">        <!-- 可选：关联的目标 -->
  <style>
    /* 用 var(--text) / var(--bg) 等变量，界面会注入当前主题的值 */
  </style>
</head>
<body>…</body>
</html>
```

* **一个文件自给自足。** 样式、脚本、SVG 全部内联。页面在沙箱里显示，读不到仓库里
  的其他文件，相对路径的 `<img src="./a.png">` 不会显示。要用图表库可以走 CDN。
* **跟着应用主题走。** 界面会往页面里注入这些 CSS 变量（浅色 / 深色自动切换）：
  `--bg` `--bg-card` `--bg-elevated` `--text` `--text-dim` `--border`
  `--accent` `--ok` `--danger` `--tone-blue` `--tone-green` `--tone-orange`
  `--tone-violet` `--tone-pink`（及对应的 `-soft` 背板色）。
  用它们而不是写死 `#fff` / `#000`，深色模式下才不会一片刺眼的白。
* 页面里**不能**用 `localStorage`、不能弹窗跳转主界面 —— 它只是一块展示板。
* 人名写成 `名字`，任务与目标写 id（`t-…` / `g-…`），便于别人对照。

## 写回顾的建议

* 一条只说一件事。三件事揉在一条里，讨论就没法聚焦。
* 「要改的」每一条都尽量带一个可尝试的动作，否则下一轮回顾会发现它原封不动还在。
* 复盘时先读全文再总结，别只看醒目的那几条 —— 一笔带过的往往是没人愿意说的那件事。
