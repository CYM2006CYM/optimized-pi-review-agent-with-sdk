# Pi Study Helper 领域语言

本文件定义 Pi Study Helper 在产品重构与 SDK 验证中的稳定术语。它只约束项目语言，不记录实现、路线或兼容策略。

## Language

**Pi Study Helper**:
以回路图组织学习活动、复习反馈与资料演进的主产品。
_Avoid_: Pi Review Agent v2, 兼容版 Review Agent, SDK 示例项目

**参考实现 (Reference Implementation)**:
用于提取既有功能、交互场景和验收样例的历史项目；其内部结构和数据契约不构成新产品约束。
_Avoid_: 旧版依赖, 兼容层, 迁移源

**SDK 验证 (SDK Validation)**:
以真实学习产品场景检验 Loop Graph SDK 的能力、边界和开发体验，并形成可复现的反馈证据。
_Avoid_: SDK 演示, 冒烟测试, 主观试用

**学习会话 (Study Session)**:
从用户开始一次学习活动，到系统完成学习情况总结并保存结果为止的一段连续学习过程。
_Avoid_: 单题, Agent Session, 图调用

**学习情况总结 (Learning Outcome Summary)**:
学习会话结束时形成的结构化学习结果，包含表现、薄弱点、待解决问题和后续建议，并作为长期学习画像的输入。
_Avoid_: 退出提示, 聊天摘要, 运行日志

**代码侧业务能力 (Code-side Business Capability)**:
供图中的代码阶段直接执行的产品动作契约，与提供给 Agent 的工具协议相互独立。
_Avoid_: callTool, pi 工具调用, 工具绕过

**资料包族 (Profile Family)**:
同一学习主题的当前可用资料、待确认修订、历史版本和用户私有学习记忆组成的生命周期整体。
_Avoid_: Profile 文件夹, 课程缓存, 单个版本

**活跃资料包 (Active Profile)**:
资料包族中当前唯一可用于学习、且不可被直接修改的资料版本。
_Avoid_: 最新草稿, 当前目录, 可写 Profile

**修订草稿 (Revision Draft)**:
新建或从活跃资料复制得到、允许反复修改并等待用户确认的候选资料版本。
_Avoid_: 临时文件, Active 副本, 已启用版本

**私有学习记忆 (Private Learning Memory)**:
属于用户且不随资料包分享的学习记录、会话总结、历史消费记录和学习画像的集合。
_Avoid_: Profile 内容, `_user` 文件夹, 共享资料

**学习记录批次 (Learning Record Batch)**:
一次学习会话产生的逐题记录与学习情况总结构成的完整记录单元。
_Avoid_: 单题归档, 对话 transcript, 总结文件

**学习画像 (Learning Profile)**:
由用户主动触发、基于尚未消费的学习记录批次归纳出的长期学习状态。
_Avoid_: 会话总结, 自动统计, Profile 资料包

**任务驱动学习 (Task-driven Study)**:
以一道需要作答、检查和消化的学习任务为推进单位，并在任务结束后由用户选择后续方向的学习方式。
_Avoid_: 连续聊天, 题库随机播放, 单次问答
