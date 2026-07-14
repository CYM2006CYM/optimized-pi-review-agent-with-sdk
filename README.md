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
pi install git:github.com/0liveiraaa/pi-study-helper
```

重启 pi 或执行 `/reload` 后生效。

## 环境要求

- [pi](https://pi.dev) `>=0.80.3`
- Node.js `>=22`
- 已配置的模型后端（OpenAI 兼容 API）

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
pi install git:github.com/0liveiraaa/pi-study-helper
# 重启 pi 或 /reload

# 2. 开始学习
/study

# 3. 从笔记构建资料包
/study-build ./我的笔记目录
```

首次加载会自动初始化 `demo-review` 示例资料包。执行 `/study` 即可选择资料包开始学习。

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
