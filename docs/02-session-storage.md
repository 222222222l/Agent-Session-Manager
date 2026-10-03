# 主流 Agent／IDE 会话存储、读取与续接调研

调研日期：2026-10-03。以下以本地编程 Agent 为主要范围，覆盖 CLI、IDE 内建 Agent、扩展和 SDK。网页聊天与纯云端 Agent 不假定存在本地完整副本。

## 1. 先区分四类数据

| 数据 | 用途 | 能否替代完整会话 |
| --- | --- | --- |
| 原生日志、数据库、附件、状态文件 | 原始证据和潜在恢复材料 | 是基础，但还需对应版本、索引和项目环境 |
| 会话列表、标题、命令历史 | 发现和排序 | 不能，可能不含助手回复或工具输出 |
| 规范化消息、搜索索引 | 统一阅读和检索 | 不能，有些字段会丢失或降级 |
| Markdown／摘要／交接包 | 分享、阅读、跨工具传递上下文 | 不能等价于原生执行状态 |

“导出成功”“能重新阅读”“原工具可以续接”“另一个 Agent 能接手”必须分别验收。

## 2. 平台路径约定

`~` 指运行 Agent 的用户主目录。CLI 的 HOME、IDE 的用户数据目录、WSL 内 HOME、远程 SSH 主机的 HOME 是不同的数据源。

| Electron／VS Code 系应用的 User 根目录候选 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| VS Code | `~/Library/Application Support/Code/User` | `%APPDATA%\Code\User` | `${XDG_CONFIG_HOME:-~/.config}/Code/User` |
| Cursor | `~/Library/Application Support/Cursor/User` | `%APPDATA%\Cursor\User` | `${XDG_CONFIG_HOME:-~/.config}/Cursor/User` |

这些是默认安装的探测候选，`--user-data-dir`、Insiders、Profiles、便携版、容器和远程扩展宿主可能改变位置。实现时接受显式根目录，并记录来源机器、宿主、Profile。不能扫描一个 `Code/User` 就声称找到了所有 IDE 会话。

## 3. 存储和读取矩阵

证据等级：**A** 为上游官方文档／源码；**B** 为适配器作者对私有格式的记录；**C** 为仅路径候选、仍待样本验证。主分支源码不代表所有已发行版本。

| 工具／界面 | 主要存储候选及格式 | 推荐读取／继续方式 | 证据与限制 |
| --- | --- | --- | --- |
| Claude Code CLI／相关 IDE 界面 | `~/.claude/projects/<project-key>/*.jsonl`；消息、工具调用与结果 | 只读解析 JSONL；`claude --resume <id>`；分叉可用 `--fork-session` | A：[工作机制](https://code.claude.com/docs/en/how-claude-code-works)、[CLI](https://code.claude.com/docs/en/cli-reference)。目录关联影响可见范围；文件快照另行处理 |
| Codex CLI／IDE／App 的本地线程 | `$CODEX_HOME` 默认 `~/.codex`；`sessions/` 下 rollout JSONL，归档目录及索引／状态库可能并存 | 展示优先能力探测后的 `thread/list`、`thread/read`；备份原生文件；`codex resume <id>` | A：官方 [App Server](https://learn.chatgpt.com/docs/app-server)、[本地配置](https://developers.openai.com/codex/config-advanced/)；目录细节还参考管理工具扫描实现声明，见下文。App／云端不能只凭名称认定共用存储 |
| Gemini CLI | `~/.gemini/tmp/<project_hash>/chats/`；旧 JSON，当前主分支支持 JSONL，并有子会话布局 | `gemini --list-sessions`；`gemini --resume <uuid>`；按内容识别记录格式 | A：[官方会话文档](https://geminicli.com/docs/cli/session-management/)、[记录服务源码](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts)。项目目录和版本均重要 |
| OpenCode | 默认 `~/.local/share/opencode/`；现有实现含 `opencode.db`，旧版有 `storage/` JSON 树，频道构建可有不同库名 | 优先官方 list／export／import；其次 SQLite 快照读取 | A：[存储文档](https://opencode.ai/docs/troubleshooting/)、[数据库实现](https://github.com/sst/opencode/blob/3a90639cb57619a21e59f544b3e8d23ffed56f48/packages/core/src/database/database.ts)。CLI 命令有版本差异 |
| Cursor IDE | User 根目录下 `globalStorage/state.vscdb`；结合 `workspaceStorage/*/workspace.json`；不同年代有不同键／表 | 先原生历史／导出；自动索引只读 SQLite 快照；回写需固定版本验证 | B：[txcript Cursor Desktop 实测格式记录](https://github.com/skillsynchq/txcript/blob/8cd3b0e63f797b1531a14197f41a0e9eeedec8c6/docs/formats/cursor-desktop.md)，覆盖 macOS Cursor 3.16／3.17.8，不能视作官方跨平台格式承诺 |
| Cursor CLI | `~/.cursor/chats/<workspace-bucket>/<id>/`；`store.db`、`meta.json` 等；库内含 JSON 与二进制图状态 | `agent`／旧 `cursor-agent` 的 list／resume；元数据和正文分开读取 | A：官方 [CLI 历史入口](https://docs.cursor.com/en/cli/using)；B：[CLI 存储记录](https://github.com/skillsynchq/txcript/blob/8cd3b0e63f797b1531a14197f41a0e9eeedec8c6/docs/formats/cursor.md)，其观察版本为 2026.06.26 macOS |
| Cursor SDK／Cloud | SDK 本地默认 SQLite，可配置 JSONL 或自定义 Store；Cloud 在服务端 | SDK list／get／resume 与消息接口；Cloud 使用官方 API | A：[TypeScript SDK](https://cursor.com/docs/sdk/typescript)。SDK Store、CLI Store、IDE Store 不应未经验证合并；本地扫描不会自动读到云端全部历史 |
| GitHub Copilot CLI | `~/.copilot/session-state/<id>/events.jsonl`，以及元数据、计划、检查点、文件；`session-store.db` 是跨会话索引 | 官方 `--resume`／`--continue`；事件日志解析；区分原始记录与搜索库 | A：[配置目录](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)。云同步副本具有独立生命周期 |
| VS Code 内建 Copilot／Chat | `workspaceStorage/<id>/chatSessions/` 下 JSON／JSONL；空窗口、转移会话及编辑状态另有目录／索引 | 官方 Chat 历史和导入导出能力；只读重建来源索引 | A：[ChatSessionStore 源码](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts)、[会话管理](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions)。不能只扫描扩展 globalStorage |
| Cline VS Code 扩展 | 通常在扩展 globalStorage 的 `tasks/<id>/`；`api_conversation_history.json`、`ui_messages.json` 和元数据 | 模型上下文与 UI 事件分别解析，按 task ID 关联；恢复入口由扩展承担 | A：[Cline 存储源码](https://github.com/cline/cline/blob/39ff2359f7e08231281539696e48a166ce49270c/apps/vscode/src/core/storage/disk.ts)。目录根受安装宿主／设置影响 |
| Cline 新 SDK／CLI 核心 | `~/.cline/data/sessions/<id>/<id>.messages.json`，带 schema `version` | 优先读取官方消息契约；不要将它套成旧 VS Code tasks 格式 | A：[messages v1 契约](https://github.com/cline/cline/blob/39ff2359f7e08231281539696e48a166ce49270c/sdk/packages/core/docs/messages-contract-v1.md)。该文件是回放／导出材料，不自动证明原生 import 能力 |
| Roo Code | 扩展任务目录中的 API history、UI messages、task metadata 等 | 独立适配器；不要仅因源于 Cline 就共用全部 schema | A：[文件名](https://github.com/RooCodeInc/Roo-Code/blob/main/src/shared/globalFileNames.ts)、[任务读取](https://github.com/RooCodeInc/Roo-Code/blob/main/src/core/task-persistence/taskMessages.ts)。原生恢复需另测 |
| Continue | 默认 `~/.continue/sessions/<id>.json`，`sessions.json` 为列表 | 读取 JSON history 和项目元数据；原工具历史界面恢复 | A：[路径定义](https://github.com/continuedev/continue/blob/main/core/util/paths.ts)、[读写实现](https://github.com/continuedev/continue/blob/main/core/util/history.ts)。可配置根目录需尊重 |
| Windsurf／Cascade 及其当前产品演进 | 历史探测候选有 `~/.codeium/windsurf/cascade` 和 IDE 用户目录；本次未核实完整稳定 schema | 优先官方历史／分享／引用功能；仅允许标明覆盖范围的原始归档试点 | A：[当前 Cascade 文档](https://docs.devin.ai/desktop/cascade/cascade)；C：[备份注册表](https://github.com/rush-skills/sessionvault/blob/main/src/registry.js)。旧 Windsurf 文档已重定向，不保证新版本沿用旧目录 |

JetBrains AI Assistant／Junie、Trae、Kiro、Antigravity、Kilo、Amp、Aider、Pi、Qwen Code、Kimi Code 等放入第二批。已有项目存在相关扫描器或连接器，但本次没有逐项完成上游版本核验，不能作为首版“完整支持”清单。尤其 JetBrains 原生聊天、其终端内的 Codex／Claude、远端 Agent 应分别建模。

## 4. 重点格式与接口注意事项

### 4.1 Codex：官方接口优先，但要明确副作用与范围

本机只执行了 `codex --version`、`codex resume --help` 和 `codex app-server --help`，得到版本 **0.160.0**，确认了续接命令和 App Server／schema 生成入口；没有启动服务读取个人线程。

官方接口支持线程列表、读取、归档和续接，但本次查到的文档说明：`thread/list` 默认仅包括部分交互来源；归档列表要单独获取；默认列表查询可能扫描 JSONL 并修复元数据，支持时可用 `useStateDbOnly` 约束。严格只读发现应走源文件快照；若使用 App Server，应说明其行为且保留文件扫描补漏。不能把标题筛选 `searchTerm` 当作正文全文搜索。[接口依据](https://learn.chatgpt.com/docs/app-server)

`sessions/YYYY/MM/DD/rollout-*.jsonl`、`archived_sessions/`、`session_index.jsonl`、`state_*.sqlite` 是适配器需要识别的候选，而不是稳定公共磁盘协议。具体例子见 [Codex Session Manager 的数据源说明](https://github.com/fengchenzxc/Codex-Session-Manager/blob/main/README.en.md)。不能硬编码 `state_5.sqlite` 为唯一文件，也不能把 `history.jsonl` 等同于完整 rollout。源码／版本探测阶段需补齐“文件—索引—线程可见性”关系。

### 4.2 Gemini：不要继续用“只有 JSON”的旧结论

实际查看当前 `chatRecordingService.ts`，可见旧 `.json` 迁移／兼容逻辑和 `.jsonl` 文件名生成。适配器应检测内容与记录版本，支持旧快照及新事件流，不能仅按扩展名套 JSON 数组，也不能从 `tmp` 这个目录名认定会话无备份价值。[源码](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts)

### 4.3 Cursor：至少分三种适配器

IDE 数据库、CLI 的每会话数据库、SDK 配置的本地 Store 分别维护能力与版本。IDE 的 `composerHeaders`、`cursorDiskKV`、`composerData` 和 `bubbleId` 等是逆向观察，不是厂商保证；更早版本可能需要别的发现路径。所谓 Agent transcript 文本也不当然等价于包含检查点和引用关系的可续接数据库。[IDE 格式](https://github.com/skillsynchq/txcript/blob/8cd3b0e63f797b1531a14197f41a0e9eeedec8c6/docs/formats/cursor-desktop.md)

官方 SDK 可以恢复自己持久化的 Agent，但本次未取得“SDK 能无条件接管所有 IDE composer”的证据，不能以 SDK 的存在宣布 IDE 原生迁移已解决。[SDK](https://cursor.com/docs/sdk/typescript)

### 4.4 OpenCode：公开导入导出比直接改数据库更合适

传统文档使用 `opencode export <id>`／`opencode import <file>`，v2 文档使用 `opencode session export <id>`／`opencode session import <file>`。应探测版本和帮助后选择命令；开发计划不把两组混为一组通用命令。[传统 CLI](https://dev.opencode.ai/docs/cli/)、[v2 CLI](https://opencode.ai/v2/docs/cli/commands/)

上游数据库实现和 session schema 可用于只读适配，旧 JSON 目录、频道库名和未来迁移需要分别检测，不能凭目录不存在就报告“无历史”。[数据库实现](https://github.com/sst/opencode/blob/3a90639cb57619a21e59f544b3e8d23ffed56f48/packages/core/src/database/database.ts)、[表结构](https://github.com/sst/opencode/blob/3a90639cb57619a21e59f544b3e8d23ffed56f48/packages/core/src/session/sql.ts)

### 4.5 VS Code／Copilot：索引和日志可能分离

本次查看的上游存储代码区分普通 workspace、空窗口和转移会话，支持 JSON／JSONL，并单独维护 `chat.ChatSessionStore.index`。恢复文件但未恢复可见性关联，可能出现“文件在、列表不在”。编辑状态目录也不能直接解释为会话正文。[上游实现](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts)

官方生态已提供跨端会话同步和查询，但范围是其支持的 GitHub／Copilot 会话，不意味着支持任意 Claude／Cursor 原生历史转换。恢复后可能还要运行官方 reindex。[官方会话同步说明](https://code.visualstudio.com/docs/copilot/chat/session-insights)

## 5. 从调研推导出的统一读取策略

以下是设计建议，不是厂商能力声明。

1. **发现**：用户配置根目录优先，随后探测平台默认路径；每个安装实例单独编号。扫描错误、权限不足、未知版本要显式报告。
2. **快照**：SQLite 用 Backup API／一致性快照；JSONL 保存已完整写入的记录边界；JSON 用前后状态检查和重试读取稳定版本。跨多文件只获得单文件一致性时，标明 `best_effort`。
3. **保真归档**：保存必要原始字节、关联附件、清单、哈希与版本；不只保留转换后的消息。
4. **规范化**：提取用户／助手内容、工具调用与结果、父子分支、时间、项目和模型；不能识别的内容保留为 opaque 记录并统计数量。
5. **索引**：本地可重建搜索库，来源定位到文件偏移或 SQLite 表／键；增量检查与定期重扫互补。
6. **续接**：原工具原生 resume 优先；没有稳定能力时提供上下文交接包或手动原生导入入口。

读取接口可以统一，但数据能力不能强行统一。每个适配器分别声明 `discover/read/search/archive/restore_files/restore_native/resume/handoff`，附已验证版本和限制。

## 6. 跨 Agent 交接的边界

把一段可读对话变成另一种 JSON，只解决一部分问题。目标工具可能不认识原工具的调用名、参数、call ID、推理签名、压缩记录和分支；图片路径可能在另一台机器不存在；同一工作目录也可能已切换分支。

建议定义三档：

- **原工具续接**：使用原始会话 ID 和可用环境，保留原执行器语义。
- **有损上下文交接**：建立新会话，携带明确选定的目标、约束、证据、未完成工作和原文引用；向用户显示遗漏内容。
- **实验性原生转换**：通过 txcript 等组件生成目标记录，只开放经过固定版本矩阵验证的方向。

ACP 提供会话生命周期和能力协商，`session/load` 等接口依赖 Agent 声明能力。它有助于统一控制入口，但没有因此将所有厂商磁盘格式或跨模型状态标准化。[ACP 会话协议](https://agentclientprotocol.com/protocol/v1/session-setup)

## 7. 尚需在开发前验证的项目

- 每个首版工具的实际发行版本、安装渠道、三平台路径与脱敏样本；本次查看主分支的项目尤其要补此项。
- SQLite 当前 journal 模式、锁竞争表现，以及主库外的附件／索引关系。
- 同一条会话由 CLI、IDE、Desktop 展示时是否共享 ID 和存储；不能预设总是共享。
- 原生恢复后是否可以正确打开并追加一轮，而不仅是管理器能解析。
- Windows 与 WSL 同时安装、远程 SSH、Profile、目录改名、worktree 和非 Git 项目。
- 云端导出边界、账号权限及本地缓存完整性。首版只承诺本地支持矩阵内的数据。
