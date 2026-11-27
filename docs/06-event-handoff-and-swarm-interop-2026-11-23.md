# Agent Session Manager：事件式会话交接兼容计划

2026-11-23 · **规划，非已实现功能**。关联 [开发计划](03-development-plan.md) 与 [集成契约](04-integration-contract.md)。

## 为什么更新

Swarm 的事件黑板提示了 **交接信封和 Agent 的完整会话记录应分离**：大量重复转述浪费上下文，但直接跨 CLI 复制对话、私有 checkpoint 或模型隐藏状态也会破坏可恢复性。当前 ASM 已有只读归档、原生续接计划、loss report；应在此之上增加可验证的任务交接索引，而非重造 OrgOS 运行时。

## 实施卡

| 卡 | 优先级 | 变更 | 原因和验收 |
|---|---|---|---|
| ASM-SW0 | P0 | 冻结原版原文哈希、转换 loss、备份恢复与跨来源命名空间测试 | 守住原记录完整性；旧测试全部通过 |
| ASM-SW1 | P1 | 添加 `HandoffEnvelope v1` 只读导出（session/sourceId、projectRef、taskId、lastReviewedEvidenceRef、artifactRefs、originRevision、capabilities、unknowns、expiry） | 让跨平台协作只传必要证据；不能把摘要当原始记录 |
| ASM-SW2 | P1 | 从 OrgOS 事件引用进入 ASM 会话浏览，权限检查后返回本地会话片段/续接计划；不在共享板发布原始消息和凭据 | 保持隐私和会话来源所有权；不同 profile 互不泄漏 |
| ASM-SW3 | P1 | 交接和恢复失败审计：源会话被删除、旧 checkpoint、失效工具/模型、重复交接 | 明确“能读历史”“可生成交接包”“能够原生续接”三种不同结果；错误有证据 |
| ASM-SW4 | P2 | 试验“收到定向新任务→生成续接提案”，**默认需要用户许可**；只输出命令数组，不自动执行 | 避免意外恢复敏感会话；权限拒绝时零进程启动 |

**协议约束**：ASM 不持有 OrgOS Task DAG、消费者游标或租约；OrgOS 不持有 ASM 的原始会话及私人配置。原格式丢失的字段必须列入 loss report。新增 schema 版本化、引用 TTL 和幂等键，发布时提供旧备份恢复回归。当前优先级低于 OrgOS SW1–SW3，不为 Swarm 单独实现复杂桌面管理器。
