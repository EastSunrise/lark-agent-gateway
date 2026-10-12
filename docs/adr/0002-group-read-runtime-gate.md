# ADR 0002: 无法确认读取隔离时禁用 Group Read

状态：接受 fail-closed 行为；未改变规格中的安全边界。

安装的 codex-acp 2.2.2 在每次 turn/start 发送由 AgentMode 生成的 legacy
sandboxPolicy，read-only 模式只有 type=readOnly/networkAccess=false。
CODEX_CONFIG 可以传 named permissions，但不能据此推断 per-turn legacy override
仍保留精确 readable roots。Codex 官方 Profiles 文档还要求不要混用 named permissions 与
legacy sandbox 配置。不能将 cwd 或模型声称“读不到”当作隔离证据。

因此 doctor 尝试真实 ACP security probe，并检查适配器 override。
未能证明所有边界时 GROUP READ DISABLED，Owner 功能继续可用。不使用 Docker fallback，
不 patch 官方依赖、不升级 READ Session、不放宽 HOME 可读范围。

未来适配器能够在每次 turn 保留 split filesystem policy 后，须先更新探针至可信
OS/runtime 级执行证据（包含外部文件、密钥、写入、网络、所有工具路径），再移除此 gate。
当前版本不能宣称完成全部 Group Read 验收。

参考：[Codex Profiles](https://learn.chatgpt.com/docs/permissions)
与安装依赖 node_modules/@agentclientprotocol/codex-acp/dist/index.js 中 sendPrompt/AgentMode。
