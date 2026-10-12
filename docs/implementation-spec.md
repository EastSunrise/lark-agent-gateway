# lark-agent-gateway 实施规格

你需要从一个**空目录**开始，实现一个可实际使用的 `lark-agent-gateway`。不要停留在脚手架或 Demo，最终必须完成 Feishu → Gateway → ACP → Codex → 本地 Repo → Feishu 回复的完整闭环。

---

## 1. 产品目标

`lark-agent-gateway` 是运行在用户当前工作 PC 上的 **Agent Control Plane**。

用户不需要打开 ChatGPT/Codex UI，直接通过飞书：

```text
私聊 Owner
→ 提问 / 分析 / 修改代码 / 跑测试 / 完成任务

群聊 Owner
→ @机器人
→ 可以分析，也可以执行修改

群聊其他成员
→ @机器人
→ 可以查询、分析绑定 Repo
→ 严格只读

Agent 需要越权操作
→ 飞书 Approval Card
→ Owner 批准 / 拒绝
```

系统必须支持：

```text
多个 Repo
多个 Feishu Group
持续 Session
长任务
Streaming
Cancel
Approval
未来接多个 ACP Agent
```

第一版只实现 Codex。

不需要同步 ChatGPT Desktop conversation。

---

# 2. 固定架构决策

以下决策不得自行改变：

```text
项目名：
lark-agent-gateway

Channel：
Feishu 官方 @larksuite/channel

Agent 协议：
ACP stable v1

第一 Agent：
@agentclientprotocol/codex-acp

Agent runtime：
Codex App Server（由 codex-acp 管理）

状态：
SQLite

配置：
YAML

语言：
TypeScript / Node.js

运行位置：
当前工作 PC

Docker：
不使用

OpenClaw：
不作为系统依赖

A2A：
第一版不做

Multi-agent orchestration：
第一版不做
```

官方 `@larksuite/channel` 已负责 WebSocket、自动重连、消息标准化、@mention、去重、安全策略、Streaming 和 Card，不重复造这些基础能力。

ACP TypeScript SDK 当前稳定入口仍然是 ACP v1；ACP v2 仍明确标记为 experimental，因此必须使用稳定 v1。

`codex-acp` 是 stdio ACP Server，会启动 Codex App Server 并负责 ACP ↔ Codex 的事件转换，同时已经支持 sandbox mode、permission、shell、file change、MCP、plan 等事件。

---

# 3. 总体架构

```text
                         Feishu
                            │
                            │ WebSocket
                            ▼
                  @larksuite/channel
                            │
                            ▼
┌──────────────────────────────────────────────┐
│             lark-agent-gateway               │
│                                              │
│  Identity                                    │
│  Policy                                      │
│  Repo Registry                               │
│  Conversation Manager                        │
│  Task Manager                                │
│  Approval Manager                            │
│  Agent Process Manager                       │
│  Feishu Presenter                            │
│  Audit                                       │
│                                              │
│                  ACP Client                  │
└───────────────────────┬──────────────────────┘
                        │ ACP v1 / stdio
                        ▼
                 codex-acp
                        │
                        ▼
                Codex App Server
                        │
                        ▼
                 Codex Agent
                        │
                        ▼
                      Repo
```

核心原则：

```text
Feishu = Channel

Gateway = Control Plane

ACP Agent = Reasoning + Execution

Agent-native sandbox = Capability Boundary

MCP = Agent ↔ Tools

Repo = Workspace
```

Gateway **不规划 Agent 每一步怎么工作**。

Gateway 只负责：

```text
谁可以做什么
在哪个 Repo 做
采用什么权限模式
Session 属于哪个 conversation
任务状态
权限申请交给谁审批
结果回复到哪里
```

---

# 4. 权限模型

定义三个语义级别：

```text
READ
WORKSPACE_WRITE
ELEVATED
```

实际行为：

| 场景 | 权限 |
|---|---|
| Owner 私聊 | WORKSPACE_WRITE |
| 其他人私聊 | DENY |
| Owner 群聊 | WORKSPACE_WRITE |
| 群成员 | READ |
| Agent 请求 sandbox 外能力 | Owner Approval |
| 群成员 Agent 请求越权 | 自动拒绝 |

## Owner

Owner 默认可以让 Agent：

```text
读代码
改代码
新增/删除项目文件
lint
test
build
formatter
```

不要每一步都询问用户。

如果 Agent-native sandbox 认为某项操作需要提升权限，则走 Approval。

典型：

```text
网络访问
访问 Repo 外文件
git push
远程 API
deploy
系统级操作
```

## 群成员

群成员始终：

```text
READ
```

任何 ACP `request_permission`：

```text
AUTO_DENY
```

群成员永远不能通过聊天把 READ Session 提升成 WRITE。

---

# 5. Agent-native sandbox

不使用 Docker。

但是也不能简单认为：

```text
read-only = 只能读当前 Repo
```

Codex 的 `read-only` 本身表达的是“允许读、禁止写”；读取范围需要通过 filesystem permission policy 进一步约束。Codex 当前 runtime 已支持精确 readable/writable roots 的 split filesystem policy。

因此 Group Read 的安全模型必须是：

```text
Agent mode:
read-only

Filesystem:
只允许读取指定 Repo View
只允许读取该 Repo 必要的 git metadata
禁止访问其他 Repo
禁止访问用户 HOME
禁止 ~/.ssh
禁止 ~/.aws
禁止其他 credentials

Network:
disabled

Permission escalation:
deny
```

**仅设置 `cwd` 不算安全措施。**

实现中必须真正验证 Agent runtime 能限制 readable roots。

如果某个未来 Agent：

```text
支持 ACP
但 read-only 仍能读取整个 HOME
```

则：

```text
Owner 可以使用
Group Member 禁止使用
```

不增加 Docker fallback。

---

# 6. Codex Security Profile

第一版至少维护两个 Codex profile。

## `group-read`

语义：

```text
INITIAL_AGENT_MODE = read-only

cwd =
Group Repo View

filesystem =
minimal runtime read
+
repo view read
+
required git metadata read

everything else =
deny

network =
deny

permission request =
Gateway auto reject
```

## `owner-write`

语义：

```text
INITIAL_AGENT_MODE = workspace-write

cwd =
真实 Repo

filesystem =
Codex workspace-write policy

permission request =
发送 Feishu Approval
```

不要自动使用：

```text
agent-full-access
danger-full-access
```

`codex-acp` 当前支持 `read-only`、`workspace-write` 等 Agent mode，并允许通过配置控制 sandbox。

安全 profile 应在**创建 Agent process 时确定**。

不要让：

```text
同一个低权限 Agent process
↓
运行中修改成高权限
```

安全边界变化时创建新的 Agent Session。

---

# 7. Repo Registry

Repo 只能由配置注册。

`config/config.yaml`：

```yaml
repos:
  payment:
    path: /absolute/path/payment
    defaultAgent: codex

  frontend:
    path: /absolute/path/frontend
    defaultAgent: codex
```

要求：

```text
必须是 absolute path
启动时 realpath()
必须存在
必须是 Git Repo
禁止 ../ path escape
禁止用户通过飞书输入任意本机 path
```

Owner 私聊：

```text
/repo list
/repo use payment
```

群：

```text
@Agent /repo bind payment
```

只有 Owner 可以 bind。

数据库保存：

```text
chat_id → repo_id
```

不维护人工 group allowlist。

**有 Repo binding 的群才是授权群。**

---

# 8. Group Repo View

群成员默认不直接读取 Owner 的 dirty working tree。

一个新的群 Conversation 创建时：

```text
real repo
   │
   ├── HEAD SHA
   │
   ▼
Gateway 创建 detached git worktree
   │
   ▼
~/.lark-agent-gateway/worktrees/
    payment/<sha>/...
```

Group Agent：

```text
cwd = snapshot worktree
```

这样：

```text
群成员看到 committed HEAD
看不到 Owner 未提交修改
不干扰 Owner 当前开发
Conversation 中代码版本稳定
```

Gateway 创建 worktree，Agent 不负责创建。

允许读取：

```text
snapshot worktree
+
该 worktree 所需的 git admin/common dir
```

不允许读取真实 working tree。

一个 Conversation 固定一个 SHA。

新 Thread / `/new` 才取得新的 HEAD。

---

# 9. Conversation 模型

不要把：

```text
一个群 = 一个 Agent Session
```

## Owner 私聊

Conversation Key：

```text
dm
+ chat_id
+ repo_id
+ agent_id
```

## 群聊

必须按 Thread 隔离：

```text
chat_id
+ thread/root_message
+ repo_id
+ agent_id
```

第一条：

```text
@Agent 分析一下这个 timeout
```

创建：

```text
Logical Conversation C1
```

后续 Thread 内继续复用。

ACP v1 的 Session 本身就是独立 conversation/context，`session/new` 使用绝对 `cwd` 建立该 Session 的主要文件系统上下文。

---

# 10. READ → WRITE handoff

这是必须实现的安全设计。

例如 Alice：

```text
@Agent 这个 bug 怎么修？
```

建立：

```text
Conversation C1
ACP Session R1
profile = group-read
```

Agent 输出方案。

Owner 在同 Thread 回复：

```text
执行这个方案
```

**禁止：**

```text
把 R1 原地改成 write
```

必须：

```text
Conversation C1
      │
      ├─ R1 / group-read
      │
      └─ W1 / owner-write
```

W1 使用真实工作区。

Gateway 给新 Agent 一个 Handoff Context：

```text
原始问题
之前对话摘要
Read Agent 最终分析
建议修改
涉及文件
必要的公开上下文
```

不要把隐藏 reasoning / chain-of-thought 搬过去。

---

# 11. ACP Runtime

使用：

```text
@agentclientprotocol/sdk
```

Gateway 是 ACP Client。

Agent 是 stdio child process。

每个 active Agent Session 第一版可以使用独立 ACP subprocess，优先安全和简单，不需要做复杂 process pool。

生命周期：

```text
spawn agent
   ↓
initialize
   ↓
capability negotiation
   ↓
session/new or resume
   ↓
session/prompt
   ↓
session/update...
   ↓
permission request...
   ↓
session/cancel / close
```

ACP 已标准化 Session 创建、prompt、cancel、resume/load capability 和 permission 流程，不自行定义 wire protocol。

未来 Agent：

```yaml
agents:
  codex:
    command: codex-acp
    groupRead: true

  claude:
    command: claude-agent-acp
    groupRead: false
```

只有通过 group security validation 的 Agent：

```text
groupRead = true
```

---

# 12. Agent Event Normalization

ACP 内部事件统一成 Gateway 自己的 UI Event：

```ts
type GatewayAgentEvent =
  | { type: "status"; text: string }
  | { type: "plan"; items: string[] }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; status: string }
  | { type: "file_change"; paths: string[] }
  | { type: "terminal"; summary: string }
  | { type: "assistant_delta"; text: string }
  | { type: "permission"; approvalId: string }
  | { type: "completed"; summary: string }
  | { type: "error"; message: string };
```

这是**内部 UI abstraction**，不是重新定义 Agent protocol。

不要展示或持久化模型私有 reasoning。

Reasoning event：

```text
只转成：
“正在分析...”
```

不要把 hidden reasoning 内容发到 Feishu。

---

# 13. Task 模型

Message 不等于 Task。

流程：

```text
Feishu Message
     ↓
Conversation
     ↓
Task
     ↓
Agent Session
     ↓
Events
     ↓
Result
```

状态：

```text
RECEIVED
  ↓
RUNNING
  ├─ WAITING_APPROVAL
  │       ↓
  │     RUNNING
  ├─ COMPLETED
  ├─ FAILED
  ├─ CANCELLED
  └─ INTERRUPTED
```

同一 Conversation：

```text
串行 Task
```

不同 Conversation：

```text
允许并行
```

默认：

```yaml
runtime:
  maxConcurrentTasks: 3
```

同一真实 Repo：

```text
同时只允许一个 Owner WRITE Task
```

---

# 14. Approval

核心原则：

> Agent 决定什么时候需要额外能力，Gateway 决定谁能批准。

## Group Member

任何：

```text
session/request_permission
```

直接：

```text
reject
```

## Owner

发送 Feishu Card：

```text
⚠️ Agent 请求权限

Repo
payment

Action
<ACP permission subject>

Reason
<Agent provided reason>

[批准一次]
[拒绝]
```

第一版只暴露：

```text
allow once
reject
```

不要暴露：

```text
allow always
```

Approval 数据必须关联：

```text
approval_id
task_id
session_id
requester
permission payload
created_at
expires_at
status
```

只有 Owner 可以点批准。

ACP 明确允许 Client 根据用户设置自动 allow/reject permission，因此 Group auto-deny 和 Owner interactive approval 都属于标准使用方式。

---

# 15. Feishu 行为

使用官方：

```text
@larksuite/channel
```

SDK 已提供 WebSocket、自动重连、NormalizedMessage、mention、dedup、per-chat queue、Streaming Card 等。

Gateway policy：

```text
DM:
  owner → accept
  non-owner → deny

Group:
  requireMention = true
  mentionAll 不触发
```

群只有绑定 Repo 后才允许执行。

未绑定：

```text
@Agent hello
```

返回：

```text
该群尚未绑定项目。
请 Owner 使用 /repo bind <repo>
```

---

# 16. Owner 初始化

不要要求用户预先知道 Feishu `open_id`。

第一次运行：

```text
Owner 未设置
```

Gateway 在本地终端生成：

```text
Owner claim code: 482731
```

用户私聊机器人：

```text
/claim 482731
```

Gateway 将该 sender open_id 写入 SQLite：

```text
owner_identity
```

Claim code：

```text
一次性
10 分钟过期
成功后永久关闭 bootstrap
```

也允许配置：

```yaml
owner:
  openId: ou_xxx
```

配置存在时跳过 Claim。

---

# 17. Feishu App 初始化

支持两种方式。

推荐实现 CLI：

```text
npm run setup:feishu
```

利用 `@larksuite/channel` 官方 `registerApp()` QR registration 能力完成 App 创建/授权，并保存：

```text
LARK_APP_ID
LARK_APP_SECRET
```

到：

```text
.env.local
```

文件：

```text
chmod 600
.gitignore
```

官方 Channel SDK 当前已直接提供 `registerApp()` QR 注册流程。

同时 README 保留手工创建 Feishu Bot 的说明作为 fallback。

---

# 18. Feishu Commands

第一版只实现：

```text
/help

/repo list
/repo use <repo>
/repo bind <repo>

/agent list
/agent use <agent>

/new
/status
/stop
```

权限：

```text
/repo bind
→ Owner only

/agent use
→ Owner only

/stop
→ requester 可以取消自己的任务
→ Owner 可以取消所有任务
```

自然语言是主要入口。

命令只是 Control Plane 操作。

---

# 19. Feishu UI

简单问答可以普通 Markdown。

真实 Agent Task 使用一张 Streaming Card。

运行中：

```text
🤖 Agent Task

Repo
payment

Agent
Codex

Mode
READ / WRITE

Status
Running

Current
Running tests...

Changed Files
3

[取消]
```

完成：

```text
✅ Completed

Summary
修复 timeout retry...

Files
src/payment/...
tests/...

Verification
128 tests passed
```

不要：

```text
一个 shell event
=
一条 Feishu 消息
```

Card 更新 throttle：

```text
最多约 1 次 / 秒
```

---

# 20. SQLite

数据库文件：

```text
~/.lark-agent-gateway/state.db
```

状态目录：

```text
~/.lark-agent-gateway/
├── state.db
├── logs/
├── worktrees/
└── runtime/
```

目录权限：

```text
0700
```

表：

```sql
owner_identity(
  open_id TEXT PRIMARY KEY,
  claimed_at INTEGER
);

chat_bindings(
  chat_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  default_agent TEXT NOT NULL,
  bound_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

conversations(
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_key TEXT,
  repo_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  repo_revision TEXT,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);

agent_sessions(
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  acp_session_id TEXT,
  profile TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

tasks(
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_session_id TEXT,
  requester_id TEXT NOT NULL,
  input_message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT
);

approvals(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER
);

processed_messages(
  message_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
```

敏感凭证禁止写数据库。

---

# 21. Repo Snapshot Manager

实现：

```ts
interface RepoView {
  repoId: string;
  revision: string;
  cwd: string;
  readRoots: string[];
}

interface RepoViewManager {
  createGroupView(repoId: string): Promise<RepoView>;
  getOwnerView(repoId: string): Promise<RepoView>;
  release(view: RepoView): Promise<void>;
}
```

Group：

```text
git rev-parse HEAD
git worktree add --detach ...
```

Owner：

```text
cwd = realpath(repo)
```

旧 worktree：

```text
无 active conversation 引用
+
超过 retention
→ cleanup
```

默认：

```yaml
worktrees:
  retentionDays: 7
```

---

# 22. Security deny patterns

Group Read 默认禁止读取：

```text
.env
.env.*
*.pem
*.key
*.p12
*.pfx
.npmrc
.pypirc
credentials*
secrets*
```

配置：

```yaml
security:
  groupRead:
    network: false

    deny:
      - "**/.env"
      - "**/.env.*"
      - "**/*.pem"
      - "**/*.key"
```

同时 Group Feishu 输出经过简单 secret redactor：

```text
Private Key
常见 API key
Bearer token
AWS access key
明显 secret assignment
```

检测到：

```text
[REDACTED]
```

Owner 私聊不需要强制 redaction。

---

# 23. Codex integration

Dependency：

```text
@agentclientprotocol/codex-acp
```

不要依赖系统全局版本作为默认。

项目安装固定版本并 commit lockfile。

`codex-acp` npm 包本身包含兼容的 `@openai/codex` dependency，因此默认直接使用其配套 Codex runtime。

如用户已有特定 Codex：

```text
CODEX_PATH=/path/to/codex
```

可以覆盖。

OpenCodex：

```text
继续属于 Codex/provider configuration
```

Gateway 不感知 OpenCodex。

不要实现：

```text
Feishu
→ OpenCodex API
```

---

# 24. 项目目录

从空目录创建：

```text
lark-agent-gateway/
├── src/
│   ├── main.ts
│   │
│   ├── config/
│   │   ├── schema.ts
│   │   └── load.ts
│   │
│   ├── channel/
│   │   └── lark-channel.ts
│   │
│   ├── identity/
│   │   └── owner-service.ts
│   │
│   ├── policy/
│   │   └── policy-engine.ts
│   │
│   ├── repos/
│   │   ├── registry.ts
│   │   ├── repo-view-manager.ts
│   │   └── repo-lock.ts
│   │
│   ├── conversations/
│   │   └── conversation-manager.ts
│   │
│   ├── tasks/
│   │   ├── task-manager.ts
│   │   └── task-state.ts
│   │
│   ├── acp/
│   │   ├── client.ts
│   │   ├── process-manager.ts
│   │   ├── capabilities.ts
│   │   └── event-normalizer.ts
│   │
│   ├── agents/
│   │   └── codex/
│   │       ├── launcher.ts
│   │       ├── profiles.ts
│   │       └── security.ts
│   │
│   ├── approvals/
│   │   └── approval-manager.ts
│   │
│   ├── presenter/
│   │   ├── task-card.ts
│   │   ├── approval-card.ts
│   │   └── reply.ts
│   │
│   ├── commands/
│   │   └── command-router.ts
│   │
│   ├── storage/
│   │   ├── database.ts
│   │   ├── repositories.ts
│   │   └── migrations/
│   │
│   ├── audit/
│   │   └── audit.ts
│   │
│   └── security/
│       └── redactor.ts
│
├── scripts/
│   ├── setup-feishu.ts
│   └── doctor.ts
│
├── config/
│   └── config.example.yaml
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── docs/
│   └── adr/
│       └── 0001-architecture.md
│
├── AGENTS.md
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

没有：

```text
Dockerfile
docker/
compose.yaml
container runtime
```

---

# 25. Dependencies

初始化：

```bash
npm init -y
```

Runtime dependencies：

```text
@larksuite/channel
@agentclientprotocol/sdk
@agentclientprotocol/codex-acp
better-sqlite3
zod
yaml
pino
execa
nanoid
```

Dev：

```text
typescript
tsx
vitest
@types/node
@types/better-sqlite3
```

使用安装时最新 stable 版本并 commit：

```text
package-lock.json
```

禁止使用 ACP experimental v2 import。

---

# 26. npm scripts

至少提供：

```json
{
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "setup:feishu": "tsx scripts/setup-feishu.ts",
    "doctor": "tsx scripts/doctor.ts"
  }
}
```

---

# 27. Doctor

必须实现：

```text
npm run doctor
```

检查：

```text
Node version
Config schema
State directory
SQLite
Git
Repo existence
Repo realpath
Feishu credentials
ACP SDK
codex-acp executable
ACP initialize
Codex authentication
Agent modes/capabilities
Group Read filesystem isolation
Network restriction
```

最重要的是：

```text
Group Read Security Probe
```

创建：

```text
temp repo
allowed.txt

outside directory
secret.txt
```

验证 group-read profile：

```text
allowed.txt → 可以访问
secret.txt → 无法访问
write attempt → 无法执行
network → 无法执行
```

如果 security probe 失败：

```text
GROUP READ DISABLED
```

Gateway 可以继续允许 Owner 私聊使用，但禁止群成员任务。

这是 fail-closed。

---

# 28. Tests

Unit tests 必须覆盖：

```text
Owner / non-owner identity
DM policy
Group policy
Repo binding
Path canonicalization
Conversation key
Task state machine
Approval policy
Command parser
Secret redactor
Message dedup
```

Integration tests：

建立一个：

```text
Fake ACP Agent
```

测试：

```text
initialize
session/new
prompt
stream updates
permission
cancel
error
process crash
```

不要所有测试都依赖真实 Codex。

真实 Codex E2E：

```text
RUN_CODEX_E2E=1 npm test
```

验证：

```text
read task
owner file modification
group read restriction
permission flow
cancel
```

---

# 29. Restart Recovery

Gateway 启动时：

```text
RUNNING
WAITING_APPROVAL
```

任务统一标记：

```text
INTERRUPTED
```

然后根据 ACP capability：

```text
支持 resume/load
→ 尝试恢复 session

不支持
→ 创建新 session
→ 使用 conversation summary 继续
```

不能声称：

```text
Gateway 重启前的 shell process
仍在运行
```

---

# 30. Logging

使用 structured logging。

记录：

```text
taskId
conversationId
chatId
repoId
agent
profile
status
duration
approval result
```

默认不记录：

```text
完整源码
完整 prompt
完整 agent response
credential
hidden reasoning
```

日志目录：

```text
~/.lark-agent-gateway/logs
```

---

# 31. 配置示例

```yaml
runtime:
  maxConcurrentTasks: 3

feishu:
  requireMentionInGroup: true

agents:
  codex:
    enabled: true
    command: codex-acp
    groupRead: true

repos:
  payment:
    path: /Users/me/work/payment
    defaultAgent: codex

  frontend:
    path: /Users/me/work/frontend
    defaultAgent: codex

security:
  groupRead:
    network: false
    deny:
      - "**/.env"
      - "**/.env.*"
      - "**/*.pem"
      - "**/*.key"

worktrees:
  retentionDays: 7
```

`.env.local`：

```text
LARK_APP_ID=
LARK_APP_SECRET=
```

---

# 32. 实施顺序

必须按以下顺序推进，不要先做高级功能。

### Milestone 1 — 本地骨架

完成：

```text
TypeScript project
config
SQLite
logging
Repo Registry
tests
```

要求：

```text
npm run build
npm test
```

全部通过。

### Milestone 2 — Feishu 闭环

完成：

```text
setup:feishu
WebSocket connect
message receive
owner claim
DM reply
group @ detection
```

验收：

```text
Owner 发 hello
Bot 返回 hello
```

### Milestone 3 — ACP Codex 闭环

完成：

```text
spawn codex-acp
initialize
session/new
prompt
session/update
final answer
```

验收：

```text
Owner 私聊：
“解释当前项目 README”

Codex 真正读取 Repo
结果回到 Feishu
```

### Milestone 4 — Owner Agentic Work

完成：

```text
workspace-write
file changes
test command
streaming card
cancel
```

验收：

```text
Owner：
“创建一个测试文件并运行测试”

Agent 实际修改 Repo
测试结果返回 Feishu
```

### Milestone 5 — Group Read

完成：

```text
/repo bind
snapshot worktree
group-read Codex profile
filesystem scope
network deny
```

验收：

```text
群成员：
@Agent 解释 xxx

可以读取绑定 Repo

无法读取：
~/other-repo
~/.ssh
真实 dirty workspace

无法修改 snapshot
```

### Milestone 6 — Approval

完成：

```text
ACP permission request
Feishu Approval Card
allow-once
reject
expiry
```

验收：

```text
Owner Agent 请求 sandbox 外操作
→ Card
→ Approve
→ Agent continuation
```

### Milestone 7 — Recovery / Doctor

完成：

```text
doctor
restart recovery
dedup
security probe
audit
README
AGENTS.md
```

---

# 33. 最终验收

只有以下全部通过，项目才算完成：

| Test | Expected |
|---|---|
| Owner 私聊普通问题 | 正常回答 |
| 非 Owner 私聊 | 不执行 Agent |
| Owner 选择 Repo | 正常 |
| Owner 要求修改代码 | 实际修改真实 Repo |
| Owner 跑 test | 正常 |
| Owner cancel | Agent 被取消 |
| Group 未 @ | 不响应 |
| Group 未 bind Repo | 不运行 Agent |
| Owner bind Repo | 成功 |
| Group Member @Agent | 正常只读回答 |
| Group Member 修改代码 | 失败 |
| Group Member permission escalation | 自动拒绝 |
| Group Member 读取其他 Repo | Agent-native sandbox 阻止 |
| Group Member 读取 `~/.ssh` | Agent-native sandbox 阻止 |
| Group Member 网络请求 | 阻止 |
| Group Member 查看 Owner dirty change | 看不到 |
| Owner 在 Group 提修改要求 | 可以修改真实 Repo |
| Group READ → Owner WRITE | 创建新 Agent Session |
| Permission Request | Owner 收到 Card |
| Approve | Agent 继续 |
| Reject | Agent 不执行 |
| Duplicate Feishu event | 不重复执行 |
| Gateway restart | 状态正确恢复/标 INTERRUPTED |
| Agent crash | Task FAILED，Gateway 不崩 |
| Secret 出现在 Group 输出 | redact |
| `npm run doctor` | 全部关键检查 PASS |

---

# 34. 明确不做

第一版禁止顺手扩 scope：

```text
不做 Web Admin UI
不做 OpenClaw
不做 Docker
不做 Kubernetes
不做 Slack
不做 A2A
不做多 Agent 自动协作
不做 Planner/Reviewer chain
不做自动 PR workflow
不做 ChatGPT Desktop session sync
不做企业 RBAC
```

---

# 35. 工程约束

在根目录创建 `AGENTS.md`，写入以下 architectural invariants：

```text
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
```

如果实现过程中必须违反任意一项：

```text
停止修改架构
创建 ADR
说明原因和替代设计
```

---

# 36. Definition of Done

最终交付物必须包括：

```text
可运行源码
package-lock.json
SQLite migrations
config.example.yaml
.env.example
README.md
AGENTS.md
ADR
unit tests
integration tests
Codex E2E tests
npm run doctor
setup:feishu
```

README 从零开始必须能指导用户完成：

```text
git clone
npm install
npm run setup:feishu
配置 Repo
npm run doctor
npm run dev
Feishu /claim
私聊 Agent
群绑定 Repo
群成员 @Agent
```

最终目标不是“代码已经写了”，而是用户能在真实飞书中完成：

```text
Feishu
→ lark-agent-gateway
→ ACP
→ Codex
→ 本机 Repo
→ 完成任务
→ Feishu 返回结果
```

整个闭环。