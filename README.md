# lark-agent-gateway

本机 Agent Control Plane：飞书官方 Channel SDK → ACP stable v1 → codex-acp →
Codex App Server → 本机 Git Repo → 飞书任务卡片。

已实现 Owner 私聊/群聊写任务、仓库选择和绑定、持久会话、任务排队、Repo 写锁、
公开摘要恢复、审批一次、拒绝/超时、取消、去重、Streaming 卡片、审计和 Doctor。
群成员任务的 native readable-root 隔离必须通过安全验证。
**当前固定 codex-acp 2.2.2 的受限会话/探针未通过，Group Read 默认禁用。**
不能将 Owner 闭环成功等同于全部验收通过。详见
[安全限制 ADR](docs/adr/0002-group-read-runtime-gate.md) 和 [实施规格](docs/implementation-spec.md)。

## 从零开始

要求 Node.js >=22、Git，以及可用的 Codex 登录或 provider 配置。不使用 Docker。

```powershell
git clone <your-repository-url>
cd lark-agent-gateway
npm ci
Copy-Item config/config.example.yaml config/config.yaml
npm run setup:feishu
```

二维码注册会打印授权链接，扫描后凭证写入 .env.local，不打印 secret。
已有机器人时跳过 setup，将 .env.example 复制为 .env.local 并填写：

```dotenv
LARK_APP_ID=cli_...
LARK_APP_SECRET=...
```

config/config.yaml 只允许预注册的 Git root 绝对路径，禁止聊天输入本机路径：

```yaml
runtime:
  maxConcurrentTasks: 3
agents:
  codex:
    enabled: true
    command: codex-acp
    groupRead: true
repos:
  gateway:
    path: D:/Projects/lark-agent-gateway
    defaultAgent: codex
```

默认状态位置 ~/.lark-agent-gateway；runtime.stateDir 可配置。此工作区开发配置使用
.state。Unix 目录 0700/凭证 0600；Windows 使用当前用户 SID 限制目录和凭证 ACL。
.env.local、config/config.yaml、.state 都在 .gitignore 中。

默认直接使用项目固定 codex-acp 与配套 @openai/codex。首次需要登录：

```powershell
node node_modules/@agentclientprotocol/codex-acp/dist/index.js cli login
# 或使用现有 ~/.codex 登录/provider 配置。
# 可选 CODEX_PATH 指向明确选择的 Codex executable。
npm run doctor -- --connect
npm run dev
```

Doctor 真实检查 ACP initialize、认证/会话创建、Feishu WebSocket（--connect），
以及 Group Read 外部文件、写入、网络和密钥探针。关键项失败返回非零；
群隔离失败时 Owner 仍可启动，群成员不会运行 Agent。

终端打印一次性 10 分钟 Owner claim code，在机器人私聊发送：

```text
/claim <code>
/repo use gateway
读取 README 并说明当前项目
创建一个测试文件并运行测试
```

首次认领成功后，SQLite 永久保存 Owner 身份。也可通过 owner.openId 明确配置，
但不得覆盖已有不同 Owner。其他成员私聊不会运行 Agent。

群聊：邀请机器人，Owner 发 `@机器人 /repo bind gateway`。之后 Owner 可
`@机器人 修改代码并跑测试`，使用真实工作区写会话。
群成员 `@机器人 解释模块` 只有 native security probe 通过才会运行；当前版本会收到禁用说明。
未 @、@all、不绑定仓库均不会触发 Agent。

## 命令与任务

- /help：帮助。
- /repo list、/repo use <repo>（Owner 私聊）、/repo bind <repo>（Owner 群聊）。
- /agent list、/agent use <agent>（Owner）。
- /new：Owner 开始新 Conversation；群成员通过新 Thread 开始。
- /status：当前 Conversation 最近任务状态。
- /stop：取消自己的任务；Owner 可取消当前 Conversation 中所有任务。

群会话按 root/thread + repo + agent 隔离。Owner 与 READ 使用不同进程和 Session，
READ → WRITE 通过公开历史摘要交接；WRITE 的真实工作区输出不回灌 READ。
同 Conversation 串行，不同 Conversation 可并行；同 Repo 只有一个 WRITE Task。
一个任务更新一张卡片，运行时每秒最多约一次；完成时可立即刷新。
Agent 内部 shell 写文件也通过前后 Git 状态检测展示文件变化。

Owner 的 sandbox 外请求发送 Owner 私聊审批卡片，只有批准一次/拒绝。
只有 Owner 可决定；10 分钟过期；取消同步解除等待。
Gateway 不提供 filesystem/terminal ACP client 执行能力，所有执行由 Agent-native sandbox 管控。

重启时 RECEIVED/RUNNING/WAITING_APPROVAL 标记 INTERRUPTED，pending approvals 过期。
下次输入在相同 profile 尝试 ACP load；不支持/失败则用公开摘要新建 Session。
不会声称旧 shell 仍运行。空闲 Session 30 分钟退出；过期 worktree 无 active 引用后回收。

## 手工创建飞书机器人

在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，启用机器人，
配置事件订阅为长连接。订阅 im.message.receive_v1 和 card.action.trigger；
开通接收机器人私聊、群 @消息、发送消息/卡片权限。配置应用可用范围，发布版本，
将机器人加入目标群。应用需支持卡片回调，才能点击取消和审批。
二维码注册优先使用 SDK 官方 registerApp；手工配置时按平台显示的权限需求授权。

## 验证

```powershell
npm run typecheck
npm run build
npm test
$env:RUN_CODEX_E2E='1'; npm test -- tests/integration/codex-e2e.test.ts
npm run doctor -- --connect
npm start
```

Fake ACP 测试包含初始化、新建/load、stream、permission、cancel、error、crash，
以及 message → task → ACP → repo → task card 流水线。
Codex E2E 只在独立临时 Git Repo 中读写与执行验证；需要有效 Codex 登录。
Doctor security-report.json 只保存 checks 和错误原因，不保存 canary、源码或 reasoning。
审计默认不记录完整 prompt、模型回复、源码和 hidden reasoning。
SQLite 持久化公开摘要与脱敏任务输入；Agent 自身历史由 Codex runtime 管理。

实施/验证状态见 [validation.md](docs/validation.md)。全量规格验收未完成前，
禁止宣称群成员隔离已通过或生产可用。
