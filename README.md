# Pi Study Helper

Pi Study Helper 是一款基于 [pi](https://pi.dev) 和 [Loop Graph SDK](https://github.com/0liveiraaa/pi-loop-graph-sdk) 的任务驱动学习助手，通过回路图组织学习活动、复习反馈与资料演进。

## 功能

- **三种学习模式** — 自由练习、卡片练习、章节学习
- **资料包生命周期** — Active/Draft/Archived 三态管理，安全修订与回滚
- **自动资料构建** — 从 Markdown/txt 笔记自动生成规范化资料包
- **资料包修订** — 安全编辑，含 diff 预览、质量门禁和原子提交/回滚
- **学习画像** — 从累积的会话记录生成长周期学习画像
- **会话恢复** — 中断后可补总结，不丢失已完成题目
- **隐私设计** — 学习记录保存在本地，不随资料包分发

## 安装

一条命令即可：

```bash
pi install git:github.com/CYM2006CYM/optimized-pi-review-agent-with-sdk
```

重启 pi 或执行 `/reload` 后生效。

## 环境要求

- [pi](https://pi.dev) `>=0.80.3`
- Node.js `>=22`
- 已配置的模型后端（OpenAI 兼容 API）

## 配置 API Key（以 DeepSeek 为例）

先在 DeepSeek 开放平台创建 API Key。请勿把真实 Key 写进项目文件、README 或提交到 GitHub。

### 临时配置

在 Windows PowerShell 中执行：

```powershell
$env:DEEPSEEK_API_KEY="你的 API Key"
pi --provider deepseek
```

该设置只对当前 PowerShell 窗口有效，关闭窗口后失效，适合快速测试。

### 永久配置（推荐）

在 Windows PowerShell 中执行：

```powershell
[Environment]::SetEnvironmentVariable(
  "DEEPSEEK_API_KEY",
  "你的 API Key",
  "User"
)
```

执行后关闭并重新打开 PowerShell，让新的环境变量生效，然后启动 Pi：

```powershell
pi --provider deepseek
```

如果需要明确指定模型，可以先查看 Pi 当前支持的模型，再选择一个 DeepSeek 模型：

```powershell
pi --list-models deepseek
pi --provider deepseek --model <模型 ID>
```

进入 Pi 后即可执行 `/study`。不建议通过 `pi --api-key "你的 API Key"` 长期使用 Key，因为命令可能被保存到终端历史中。

## 命令

| 命令 | 说明 |
|------|------|
| `/study [subjectId]` | 启动一次学习会话 |
| `/study-recover` | 处理未完成的学习会话 |
| `/study-profile [subjectId]` | 生成或更新学习画像 |
| `/study-build [sourceDir]` | 从 Markdown/txt 构建新资料包 |
| `/study-revise [subjectId]` | 安全修订活跃资料包 |

## 快速开始

```bash
# 1. 安装扩展
pi install git:github.com/CYM2006CYM/optimized-pi-review-agent-with-sdk
# 重启 pi 或 /reload

# 2. 开始学习
/study

# 3. 从笔记构建资料包
/study-build ./我的笔记目录
```

首次加载会自动初始化 `demo-review` 示例资料包。执行 `/study` 即可选择资料包开始学习。

## 上手体验

下面的流程可以依次体验直接练习、卡片练习、章节学习、学习画像、资料包构建、修订与会话恢复。

> PowerShell 命令在系统终端中执行；以 `/` 开头的命令需要进入 Pi 后执行。

### 0. 确认扩展已加载

从 GitHub 安装后，可在 PowerShell 中检查安装清单并启动 Pi：

```powershell
pi list
pi --provider deepseek
```

如果正在仓库目录中进行本地开发，也可以安装本地版本：

```powershell
cd "C:\Users\win11\Desktop\头脑风暴\pi-study-helper"
pi install .
pi --provider deepseek
```

启动时应看到 `Pi Study Helper 已加载；使用 /study 开始学习`。如果看不到这条提示，请退出 Pi，重新执行安装命令后再启动。

### 1. 直接做题

在 Pi 中输入：

```text
/study demo-review
```

建议依次选择：

1. 范围：第 1 章
2. 学习方式：`练习 · 直接答题`
3. 难度：`S-U · 基础理解`
4. 题型：`单选题`

答题后可以尝试“继续讨论这道题”，并输入：

```text
为什么其他选项不正确？请结合资料逐项解释。
```

随后可在学习功能菜单中体验“下一题”“提高难度”“查看当前目标材料”“查看当前学习总结”或“结束并保存总结”。

### 2. 卡片练习

再次输入：

```text
/study demo-review
```

建议选择第 1 章、`卡片练习 · 先回忆概念`、`主动回忆`卡片、`S-U · 基础理解`和`简答题`。看到卡片标题后先尝试自行回忆，再决定是否查看材料并开始答题。

完成一题后选择“更换卡片/章节”，继续体验“间隔复习”或“交错练习”。

### 3. 章节学习

```text
/study demo-review
```

建议选择第 2 章、`章节学习 · 结合章节材料`、任意小节、`M-U · 综合理解`和`判断题`。该模式会先展示章节内容，再根据当前材料生成题目。

### 4. 生成学习画像

完整结束一次学习会话后输入：

```text
/study-profile demo-review
```

选择要消费的学习记录，检查生成的画像，然后确认保存。建议先完成 3～5 道题，画像会更有参考价值。

### 5. 从示例笔记构建资料包

仓库内置了两篇用于体验构建流程的 Markdown 笔记。在 Pi 中输入：

```text
/study-build "C:\Users\win11\Desktop\头脑风暴\pi-study-helper\fixtures\source-materials\p4-smoke"
```

按提示填写：

```text
资料包 ID：my-learning-demo
科目名称：我的学习方法练习
```

构建完成后选择启用 draft，然后开始学习新资料包：

```text
/study my-learning-demo
```

如果仓库位于其他目录，请把命令中的绝对路径替换为你本机的实际路径。你也可以将路径换成自己的 Markdown/TXT 笔记目录。

### 6. 安全修订资料包

```text
/study-revise my-learning-demo
```

可以输入以下修订意见进行体验：

```text
为主动回忆补充一个大学期末复习场景，并增加一个常见误区。保留现有章节结构，不删除原内容。
```

Agent 会先生成计划和实际文件变更供确认。初次体验可先保留 draft；确认内容符合预期后，再启用修订版。启用时旧 active 会自动归档。

### 7. 恢复未完成会话

先通过 `/study demo-review` 开始一轮学习，完成至少一道题后退出 Pi。重新启动 Pi，然后输入：

```text
/study-recover
```

根据提示选择生成总结并结束，或将会话标记为中断。

推荐按以下顺序完整体验：

```text
/study demo-review
/study-profile demo-review
/study-build "C:\Users\win11\Desktop\头脑风暴\pi-study-helper\fixtures\source-materials\p4-smoke"
/study my-learning-demo
/study-revise my-learning-demo
```

## 项目结构

```
src/
├── application/      # 控制器
├── domain/           # 核心业务逻辑
├── extension/        # Pi 扩展入口
├── graphs/           # Loop Graph 定义
├── infrastructure/   # SDK 封装
├── repositories/     # 数据持久化
├── tui/              # TUI 组件
└── config/           # 配置
tests/                # 测试套件
fixtures/
├── profiles/         # 示例资料包
└── source-materials/ # 构建测试用源文件
```

## 开发

```bash
npm ci
npm test             # 117 项测试
npm run typecheck
npm run verify       # 完整 CI 验证（无需模型）
```

## 协议

MIT — 见 [LICENSE](LICENSE)。

## 相关项目

- [pi-loop-graph-sdk](https://github.com/0liveiraaa/pi-loop-graph-sdk) — Loop Graph SDK 运行时
- [pi-review-agent](https://github.com/0liveiraaa/pi-review-agent) — 参考实现
