# Profile 与私有学习记忆

## 资料包族结构

每个科目只有一个资料包族：

```text
profile_families/{subjectId}/
├── active/                         当前唯一可学习版本，只读
├── draft/                          当前唯一可写候选版本
├── archived/
│   └── {YYYYMMDD-HHmmss}/          被替换的历史 active
└── _user/                          不随资料包分享的私有学习记忆
    ├── summaries/
    │   ├── pending/
    │   │   └── {YYYYMMDD-HHmmss}_{sessionId}/
    │   │       ├── session.json
    │   │       ├── attempts/
    │   │       │   └── {questionId}.json
    │   │       └── summary.md
    │   └── archived/
    │       └── {YYYYMMDD-HHmmss}_{sessionId}/
    └── learning_profile.json
```

`active`、`draft` 和每个 archived 目录内部使用同一套 canonical Profile 内容：

```text
profile.json
subject.md
knowledge_index.json
cards/
chapters/
exam_points/
source_map.json
quality_report.md
```

新项目只生成和读取这一种结构，不实现旧 Review Agent 的 legacy fallback。

## 生命周期

### 新建资料包

1. 代码创建资料包族和空的 canonical draft。
2. Profile 构建图读取用户源资料并反复修改 draft。
3. 用户确认后，代码把 draft 移为 active。
4. 用户不满意并明确放弃时，代码删除 draft；源资料不受影响。

### 修订已有资料包

1. 代码把 active 完整复制到 draft，但不复制 `_user`。
2. 修订图只能修改 draft。
3. 用户确认时，旧 active 先移动到 `archived/{timestamp}`，draft 再移动为 active。
4. 用户不满意并明确放弃时，只删除 draft，active 保持原样。

同一资料包族最多存在一个 draft。已有 draft 时再次进入修订，应继续该 draft 或先由用户明确放弃，不能静默覆盖。

## 私有学习记忆

每次学习会话对应一个学习记录批次。逐题结果在题目完成后立即写入 `attempts/`；正常结束时必须生成 `summary.md` 和最终 `session.json`。未正常结束的批次保留已写入题目，并在 session 中标记 `interrupted`。

学习画像不会在每次总结后自动重写。用户在资料包修订入口中手动选择“生成学习画像”时：

1. 代码读取 `summaries/pending/` 下尚未消费的批次。
2. Agent 根据逐题记录和总结生成新的长期学习画像。
3. 代码校验并写入 `learning_profile.json`。
4. 只有画像写入成功后，本次消费的批次才整体移动到 `summaries/archived/`。

生成失败或用户取消时，pending 批次保持原位，避免记录被提前消费。

## 安全约束

- active 永远只读；所有修改发生在 draft。
- `_user` 与资料版本同级，不随 active 复制或归档。
- 启用、放弃和画像消费由代码完成，不由 Agent 自报完成。
- 目录移动前后必须验证目标仍位于配置的数据根目录。
- 归档目录使用时间戳；冲突时追加递增后缀，禁止覆盖旧版本。
