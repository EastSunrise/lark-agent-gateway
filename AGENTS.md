# Architectural invariants

1. lark-agent-gateway 是 Control Plane，不是 Agent Framework。
2. Feishu 只通过官方 Channel SDK。
3. Agent wire protocol 使用 ACP stable v1。
4. 第一 Agent 使用 codex-acp。
5. 不自定义新的 Agent wire protocol。
6. 不使用 Docker。
7. Group Read 必须由 Agent-native sandbox 真正强制。
8. cwd 不是 security boundary。
9. 不支持 scoped read isolation 的 Agent 不允许服务 Group Members。
10. READ → WRITE 必须创建新的高权限 Agent Session。
11. Group Members 永远不能批准 permission escalation。
12. Owner 的普通 workspace 操作尽量自动完成，越界才审批。
13. 不展示或持久化 hidden reasoning。
14. OpenCodex 属于 Agent/provider 层，Gateway 不感知。
15. 所有外部输入都视为不可信。

如实现需要违反任何一项，停止修改架构，创建 ADR，说明原因和替代设计。
变更后运行 npm run typecheck、npm test、npm run build。
