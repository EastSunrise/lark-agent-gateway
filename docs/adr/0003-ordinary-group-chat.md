# ADR 0003: 支持普通群聊交互

用户明确要求普通群聊交互，覆盖原实施规格的强制 Thread 划分。
架构 invariants 保持不变。官方 Channel SDK 回复设置 replyInThread=false。

feishu.groupReplyMode 默认 chat；thread 保留原行为。
用户选择全群共享；普通群聊 feishu.groupConversationScope 默认 chat，也支持 sender。
上下文仍按 Repo、Agent 隔离；同一会话任务串行；不同 profile 使用独立 Agent Session。
共享上下文只允许 Owner 执行 /new，个人上下文用户可重置自己的会话。
切换模式后会进入新的逻辑会话，不删除旧任务记录，不将旧话题自动合并。
群成员 READ 的 native sandbox gate 与审批限制保持生效。
