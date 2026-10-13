# ADR 0005：暂缓群成员只读

状态：接受（2026-10-13，用户决定“暂不实现”）。

Windows 10 当前 Codex 原生沙箱不能强制指定目录的读取隔离：
restricted-token 拒绝 split filesystem read restrictions；elevated 模式要求 root read；MXC 在该宿主不可用。
不以 cwd、提示词或普通 read-only 模式替代安全边界。

本阶段只交付 Owner 私聊与群聊任务。Group Read 在配置默认值、示例和本机配置中关闭；
成员请求不创建 Agent Session。Doctor 对关闭的探针输出 SKIP，并明确 passed=false，
仍验证已启用的 Owner 能力。启用 Group Read 时仍必须通过原生安全探针。

撤回未部署的 ACP 适配实验及 WSL 安装脚本。不更改 ACP stable v1 或其他架构约束。
未来恢复该功能，须另行提供满足原生 scoped read 隔离要求的运行环境并完成真实验证。
