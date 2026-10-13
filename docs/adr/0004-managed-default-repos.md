# ADR 0004: 每个群自动创建受管默认 Repo

用户明确要求默认创建，并选择每个群独立 Repo。这覆盖原规格“只从 YAML 注册 Repo”
及“未绑定群必须先执行 /repo bind”的产品规则，不违反 AGENTS.md 的架构 invariants。

首次 Owner 自然语言任务在未绑定群触发创建；非 Owner、查询命令和 help 不创建目录。
默认在 stateDir/repos 创建 Repo；可通过本地配置 repoDefaults.root 指定绝对根目录。
只使用由 chat id hash 生成的仓库名，禁止聊天输入本机路径。
通过官方 Git 初始化 README、gitignore 和首个提交，然后注册/绑定；后续及重启复用。
已有手工绑定优先保留，Owner 仍可 /repo bind 切换项目。
受管 registry 保存于 SQLite managed_repos，并与 YAML registry 一同执行 realpath/Git root 校验。
全群共用上下文不会让群成员获得 WRITE 权限；Group Read native sandbox gate 继续生效。
