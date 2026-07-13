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
