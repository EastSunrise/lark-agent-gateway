# ADR 0001: Gateway 是 Control Plane

接受。依据 implementation-spec.md：官方 @larksuite/channel，ACP stable v1，codex-acp，
SQLite，YAML，本机运行。每个权限 profile 使用独立进程和 ACP Session。Owner 写任务按真实
Repo 串行；Group Read 使用 committed HEAD detached worktree。Group 输出全部 redact，
Owner WRITE 结果不进入后续 READ 会话上下文。隐藏 reasoning 只转状态提示，不保存。

Gateway 不提供 ACP filesystem/terminal 客户端能力，避免绕过 Agent-native sandbox。
重启标记 INTERRUPTED，后续消息在相同 profile 下 load session 或公开摘要恢复。
