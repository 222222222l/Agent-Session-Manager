# GitHub 已有项目评估与采用建议

调研日期：2026-10-03。先完成已有项目检索，再开展存储调研和条件性开发规划。

## 1. 决策结论

**不建议从零再做一个只提供“扫描、列表、搜索、复制恢复命令”的工具。该层已有较好的解决方案。**

- 主要使用 Claude Code、Codex、Gemini CLI、OpenCode：先用 [CC Switch](https://github.com/farion1231/cc-switch)。它已经有会话管理，而不只是供应商配置切换。
- 希望跨 Cursor、CLI 和其他 IDE 历史统一检索、按项目归档：先试 [CCHistory](https://github.com/aaaAlexanderaaa/cchistory)。它比配置切换器更贴近本需求，但项目规模较小，需做恢复演练。
- 希望将 Claude Code 会话交给 Codex 等工具继续：先评估 [txcript](https://github.com/skillsynchq/txcript)，尤其适合作为未来产品的转换组件。
- 仅使用 macOS、希望获得现成桌面体验：优先考虑 [Agent Sessions](https://github.com/jazzyalex/agent-sessions)。它不满足 Windows/Linux 桌面要求。
- 需要多工具原始文件备份：可试 [SessionVault](https://github.com/rush-skills/sessionvault)，先使用本地后端和副本验证；其活跃数据库备份存在需要额外核验的降级路径。

因此分两种结论：**若接受工具组合，先用现有项目；若必须是一个三平台桌面应用，并要求可验证恢复和跨 Agent 交接，仍有自研整合层的价值。** 本次没有验证出覆盖全部要求且恢复可靠性已足够明确的单一产品；这不等于证明此类产品不存在。

“调度”在本阶段解释为：选择项目与执行工具、在正确工作目录续接、跨工具交接上下文。多机器任务队列、自动执行、额度／Token 路由是另一层产品，不作为首版默认需求。

## 2. 证据口径

- **官方**：厂商文档或上游实现，描述公开能力或当时的实现。
- **项目声明**：候选项目自己的 README／格式文档，不能等同于本次实测。
- **源码观察**：本次实际查看相关实现，仍不等于端到端验收。
- **未知**：未取得充分证据，不填成“支持”或“不支持”。

关注度和活动取自 [GitHub 元数据快照](github-evidence.json)。`pushed_at` 是仓库活动指标，可能包含分支或非发布变更；Stars 只反映关注度。部分 release API 查询失败，不能据此判断项目没有发布版本。网页搜索摘要与实时仓库内容有差异时，优先采用实际取得的文件，并保留版本边界。

## 3. 候选项目对比

表中的功能是来源支持的能力范围，未进行候选应用的运行验收。

| 项目 | 形态／平台 | 解决的问题 | 关键边界 | 本次建议 |
| --- | --- | --- | --- | --- |
| [CC Switch](https://github.com/farion1231/cc-switch) | 三平台桌面 | 多 CLI 历史浏览、搜索、原工具续接入口 | 当前会话支持表未列 Cursor IDE／Copilot IDE；一键终端续接有平台差异；配置同步不能直接视为原始会话备份 | CLI 用户首选现成入口 |
| [CCHistory](https://github.com/aaaAlexanderaaa/cchistory) | CLI、TUI、Web、API | 跨来源历史、项目归并、原始证据、导出／导入／合并 | 恢复的是 CCHistory 的库；没有据此证明能恢复到所有原生 IDE 或跨 Agent 原生续接 | 跨 IDE 归档首选试用 |
| [txcript](https://github.com/skillsynchq/txcript) | Rust 库、CLI、WASM；三平台 CLI | 发现、读取、查询、导出、转换并继续会话 | 各方向支持不对称；转换有损；不是完整备份管理或桌面产品 | 优先复用的转换候选 |
| [Agent Sessions](https://github.com/jazzyalex/agent-sessions) | macOS 原生应用 | 多来源检索、阅读和受支持 CLI 续接 | macOS 限定；不能据此推导通用跨 Agent 转换与灾备 | Mac 用户优先试用 |
| [CASS](https://github.com/Dicklesworthstone/coding_agent_session_search) | CLI／TUI；声明三平台 | 广泛连接器、全文／语义检索、面向 Agent 的结构化输出、跨机器检索 | 检索层与原生恢复不同；当前许可证带额外限制 | 可比较体验，不作为默认代码依赖 |
| [SessionVault](https://github.com/rush-skills/sessionvault) | Node CLI；声明三平台 | 多来源增量归档、本地／R2 后端、恢复到指定目录 | 搜索仍列为后续工作；恢复目录不等于原生会话可续接；SQLite 降级备份需核验 | 备份试点候选 |
| [Agent Sessions Sync](https://github.com/Gregor-von-Vitek/agent-sessions-sync) | VS Code 扩展 | Claude、Codex、Cursor CLI 目录经私有 GitHub 仓库同步 | Cursor 路径是 `~/.cursor/chats`；删除会传播；超大文件会跳过；无完整 IDE 数据库覆盖证据 | 适合限定场景，不作为通用灾备 |
| [agent-sessions TUI](https://github.com/vineethkrishnan/agent-sessions) | Node TUI；声明三平台 | 浏览、预览、筛选、原工具续接 | 规模小；缺少统一备份恢复和转换闭环 | 喜欢终端界面时试用 |

额外检索到 [CC Switch Pro](https://github.com/hahahuahai/cc-switch-pro)、[Clodex](https://github.com/avirtual/clodex)、[Codex Session Manager](https://github.com/fengchenzxc/Codex-Session-Manager)。前两者更偏运行工作台，后者主要处理 Codex 数据修复和迁移。本次未进一步验收它们，不据此推荐为全场景解决方案。

## 4. 成熟度与版本快照

| 项目 | Stars（查询时） | 最近 push（UTC 日期） | 许可证／已核实版本信息 |
| --- | ---: | --- | --- |
| CC Switch | 139,707 | 2026-10-03 | API 标识 MIT；核验提交 `793e67d9b321` |
| Agent Sessions | 889 | 2026-10-02 | API 标识 MIT；README 宣传 5.5.1，本次未核实发布资产 |
| CASS | 1,159 | 2026-10-03 | API 为 `NOASSERTION`；LICENSE 是 MIT 加特定主体限制附款 |
| txcript | 148 | 2026-09-29 | Apache-2.0；release API 返回 v0.14.4，2026-09-13 发布 |
| CCHistory | 16 | 2026-07-26 | MIT；release API 返回 v0.3.0，2026-07-02 发布 |
| SessionVault | 2 | 2026-08-15 | API 标识 MIT；README 提示尚未发布到 npm registry |
| Agent Sessions Sync | 2 | 2026-07-16 | API 标识 MIT |
| agent-sessions TUI | 2 | 2026-09-07 | API 标识 MIT |

来源为各仓库 API，见快照。txcript 的格式能力按 `8cd3b0e63f797` 的主分支文档核验，**不能假设全部已进入 v0.14.4 二进制**。试用时必须固定所选版本，并重新输出其能力清单。

CASS 的 [LICENSE](https://github.com/Dicklesworthstone/coding_agent_session_search/blob/306d6e254de767918db41b7f4f28839a77e40932/LICENSE) 明确带额外限制，不能标记为纯 MIT 后直接纳入产品依赖。本计划不复用其实现。

## 5. 对最相关项目的进一步判断

### CC Switch：已有会话入口，但备份范围要单独确认

当前 [README 功能表](https://github.com/farion1231/cc-switch/blob/793e67d9b3210eb527e7d36f2c866a56fae9dec7/README.md) 包含会话浏览、搜索、复制续接命令，说明 macOS 可以一键在终端恢复，OpenClaw／Hermes 的续接尚有限制。仓库中较早的 `session-manager.md` 只规划 Codex／Claude 和 macOS，不能把旧 PRD 当作当前完整能力表。

它适合立即解决 CLI 会话查找问题。但 README 中“云同步”“自动备份”的存在，不足以证明所有 Agent 的原始日志、附件、数据库和原生索引都进入同一个可恢复备份。采购或采用时应验证备份清单，不从功能名称推断数据覆盖。

### CCHistory：最接近跨来源历史资产库

[README](https://github.com/aaaAlexanderaaa/cchistory) 的中心对象是项目下的用户回合，并保留来源证据，提供 Full 与 Lite 两种模式。Full 的导出／导入可迁移管理库；Lite 不具备相同备份闭环。其 `restore-check` 是统计和来源检查的别名，不能当作原 Agent 启动恢复验证。

适合先体验“统一查询、按项目组织、长期保留”。如果它能覆盖个人实际工具，就应优先采用或给它补适配器，而不是另写一套格式解析器。

### txcript：最有价值的复用点，也是需要限定承诺的部分

[支持矩阵和保留边界](https://github.com/skillsynchq/txcript/blob/8cd3b0e63f797b1531a14197f41a0e9eeedec8c6/README.md) 列出 Claude Code、Codex、OpenCode、Cursor CLI／Desktop 等输入和目标，并明确说明：转换搬运历史，目标工具仍使用自己的系统指令和工具，代码文件另行提供。Amp／Hermes 等方向仅可读，不能把“支持 Agent”解释成任意双向转换。

其 [Cursor Desktop 格式说明](https://github.com/skillsynchq/txcript/blob/8cd3b0e63f797b1531a14197f41a0e9eeedec8c6/docs/formats/cursor-desktop.md) 基于指定 macOS 版本逆向。生成新 composer 需要同时满足数据库和界面索引结构，故支持表中的 “Yes” 仍需结合版本和实机验收。

### SessionVault：归档目标明确，但应先做恢复试验

[README](https://github.com/rush-skills/sessionvault) 说明按机器保存增量包，源端删除不删除归档，恢复到用户指定目录，并提供可选加密；加密默认未开启。目录覆盖数量不代表相同数量的完整解析器。

本次查看 [SQLite 复制实现](https://github.com/rush-skills/sessionvault/blob/main/src/sqlite.js)：优先 `VACUUM INTO`，不可用或失败时回退到顺序复制主库及 sidecar。这种回退在并发写入／checkpoint 下**不能推导出一致快照**，即使文件都存在也不够。建议试点要求实际采用快照路径，失败时停止或等应用关闭后重试。依据：[SQLite 官方备份机制](https://sqlite.org/backup.html)。

## 6. 推荐采用顺序与停止自研条件

先用实际工具的少量脱敏副本完成以下验证，预计 2–3 个工作日；这是后续操作计划，本次没有安装或迁移。

1. 使用 CC Switch 检查主要 CLI 历史能否找到、原工具能否续接；Cursor／Copilot 等未覆盖来源单独列出。
2. 使用 CCHistory Full 检查跨来源查询、项目归并和管理库导出／导入。只用 Mac 时可优先换成 Agent Sessions。
3. 使用 SessionVault 本地后端或现有备份系统，在一致快照上完成归档和隔离目录恢复；比较哈希与结构，再由原工具打开选定会话。
4. 仅在需要跨 Agent 时试 txcript。使用虚构项目和新目标会话，检查文本、工具结果、分支、附件及原始会话是否保留。

| 决策门 | 停止自研、采用已有工具 | 继续整合开发 |
| --- | --- | --- |
| 覆盖 | 必需来源可读取，限制可接受 | 关键 IDE 缺失或只能读取残缺文本 |
| 恢复 | 隔离目录可恢复，选定原生恢复流程通过 | 仅能导出 Markdown，无法验证恢复 |
| 交接 | 现成转换／上下文包可用 | 常用迁移方向失败或缺乏损失说明 |
| 体验 | 接受桌面＋CLI／Web 组合 | 单一三平台桌面入口是刚性要求 |

如果四项都满足，直接使用已有项目，取消 [自研计划](03-development-plan.md) 的实现阶段。若不满足，优先贡献适配器或做轻量整合；只有核心数据恢复和统一流程无法通过扩展解决时，才新建独立产品。
