# 验证记录

2026-10-13，Windows / Node 24.14.0，依赖固定在 package-lock.json。

| 项目 | 状态 |
|---|---|
| TypeScript typecheck/build | 通过 |
| Fake ACP 与控制面测试 | 36 项通过（见 npm test） |
| 六项评审问题回归 | 通过，含长私钥、完整取消、WRITE 恢复、交付重试、ACP 取消、建仓库故障恢复 |
| SQLite v2 → v3 迁移与重复启动 | 通过，保留历史数据，按版本只迁移一次 |
| 真实 Codex initialize / Owner 写 Session | 通过 |
| 真实 Codex 读 README、创建文件、运行验证 | 通过（RUN_CODEX_E2E=1） |
| 飞书凭证 / WebSocket handshake | 通过 |
| 已配置机器人身份 | LarkCli4Agent，与用户截图一致 |
| Windows 独立后台启动 | 已实现并运行；修复临时工具会话结束后不接收消息的问题 |
| 飞书认领、真实消息 → Codex → 回复 | 通过：2026-10-13 21:03 收到私聊，Owner 认领成功，真实 ACP 任务 COMPLETED，回复卡片完成且无错误 |
| 实际飞书审批按钮 / 取消按钮 | 尚未实际点击验收；自动化策略测试通过 |
| Group native read isolation | 原探针失败；用户决定暂缓，配置默认关闭，Doctor 标记 SKIP |
| Doctor 当前启用项 | 本轮通过（退出码 0）；Group Read 为 SKIP，不计为通过 |

没有将“库安装成功”“Session 创建成功”记为真实飞书任务验收。
Group READ 禁用是规格规定的 fail-closed；不能宣称全量闭环已完成。

本轮按用户“暂不实现”的决定撤回未部署的隔离适配和 WSL 安装脚本。
Owner 私聊、普通群聊、群共享上下文、每群默认 Repo 保留；不安装 WSL，不降低隔离要求。
撤回后重新运行 typecheck、build、npm test：全部通过，36 项测试通过，真实 Codex E2E 默认跳过。
Doctor 已重新验证 ACP v1 初始化和 Owner workspace-write 会话；本轮未重复飞书交互按钮验收。
