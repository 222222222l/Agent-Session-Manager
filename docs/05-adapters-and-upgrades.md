# 适配器扩展与上游升级

当前实现为 TypeScript／Node 核心＋CLI。这里是已实现行为的维护说明，优先于前期规划文档中的未来架构。

## 1. 模块边界

| 路径 | 责任 | 不应承担 |
| --- | --- | --- |
| `src/model.ts` | Adapter v1、规范会话、证据和诊断契约 | Agent 名称枚举、上游私有字段规则 |
| `src/registry.ts` | 注册、ABI 检查、显式插件加载 | 扫描用户目录、自动下载插件 |
| `src/adapters/` | 特定格式与发现规则 | 修改索引表或发起原生恢复 |
| `src/integrations/txcript.ts` | WASM 输入输出桥接、转换损失报告 | 唯一权威存档、账号读取 |
| `src/service.ts` | 扫描流程、来源身份、证据先保存、续接／导出计划 | 内置各厂商的 JSON 字段判断 |
| `src/store.ts` | 本项目 SQLite、搜索和管理库版本 | 打开或迁移厂商数据库 |
| `src/files.ts`、`src/archive.ts` | 有界读取、哈希、备份校验、新目录恢复 | 云同步、未实现的原生 IDE 恢复 |
| `vendor/` | 已选取的上游代码与许可证 | 整个上游应用及其全部依赖 |
| `upstream/` | 下载的完整仓库供调研和 diff | 必需运行依赖，自动跟随 main 更新 |

数据库与备份版本为 v1；插件 ABI 为 v1；每个适配器另有版本。三者独立：增加新 Agent 不应升级数据库；改变统一语义或备份结构则需要明确迁移。

当前模型以会话为展示对象。没有把 CCHistory 的 UserTurn 中心模型、CC Switch 的供应商配置层和 txcript 的 Common 类型混成一个公共模型。txcript 特有信息放在 namespaced metadata 中，原始文件另存，未来可更换转换引擎。

## 2. 加一个全新 Agent

参考 [可运行插件](../examples/notebook-adapter.mjs)。它使用与现有工具不同的 `notebook-agent/v1` JSON，默认导出一个 Adapter v1 对象：

1. 选择稳定、唯一的字符串 `id`，例如 `company.agent`；不要增加核心平台枚举。
2. 声明 `apiVersion: 1`、适配器版本、可接受的格式和是否具备续接能力。
3. `matches(relativePath)` 只判断候选；`parse({bytes, relativePath})` 检测内容 schema，并返回规范文档和诊断。
4. `nativeId` 必须稳定。不得因为无法识别格式而随机生成 ID；不能识别应抛出可读错误。
5. 保留未知块为 opaque 内容，或者明确报告它们只在原始证据中。不要伪装成空会话成功导入。
6. 如需原生续接，实现 `planResume(document,cwd)`，只返回 executable＋args＋cwd；不在解析器里启动程序。
7. 加正常、未知版本、损坏记录及升级样本的契约测试，再注册内置适配器或通过 `--plugin` 加载。

```bash
npm run build
npm run asm -- adapters --plugin examples/notebook-adapter.mjs
npm run asm -- scan --plugin examples/notebook-adapter.mjs --adapter example.notebook --source notebook-local --root /absolute/path/to/notebook-sessions --store /absolute/path/to/asm-store
```

插件是用户明确选择的可信代码，与本进程具有相同权限；没有沙箱隔离。插件导入成功不代表其原生恢复能力已经验证。

当前 ABI 面向单文件到单会话；文件大小上限 64 MiB，单次最多检查 10,000 文件、目录深度 32。多文件会话、SQLite 快照和实时 API 应在下一版引入受控捕获接口，而不是让 v1 插件偷偷任意扫描／写磁盘。

## 3. 已支持的来源与能力

| 适配器 | 读取／保留原始文件 | 原 CLI 续接计划 | 转换文件包 |
| --- | --- | --- | --- |
| `claude_code` | 带 sessionId 的 JSONL；容忍未完成尾行并诊断 | `claude --resume ID` | Simple、Claude Code、Codex |
| `codex` | 带 session_meta 的 rollout JSONL | `codex resume ID` | 同上 |
| `gemini` | 旧 JSON，数组正文、未知消息和工具记录保留 | `gemini --resume ID`；缺 cwd 时需显式提供 | 同上；未映射 Gemini 工具块会在报告中列出 |
| `simple` | 需显式 id／timestamp 的交换 JSON | 无原生执行器 | 同上 |
| `example.notebook` | 示例插件；`notebook-agent/v1` | 无 | 文本内容可通过统一模型转换 |

Gemini 新 JSONL 会被捕获并报告“不支持”，不会套用旧 JSON 解析；Cursor／VS Code SQLite 尚未接入。这里只列应用实际验证的方向，不照抄上游库的全部 harness 名单。

## 4. 数据与恢复语义

源文件先保存为 `objects/<sha256>`，随后解析；解析失败的原始字节也保留并记录诊断。扫描只读源目录；符号链接跳过。活动文件检测到变化时报告并等待下次重扫；不会在源数据库上设置 pragma。

会话身份为 `hash(sourceId, nativeId)`；同一 source ID 不允许重新绑定另一个根目录或适配器；不同机器／Profile 用不同 source ID。同来源两文件声明同 native ID 会报告冲突。重复导入相同文件不增加会话，变更内容会保留新的捕获修订。源端删除不删除管理库。

索引用 FTS5 trigram，少于三个字符的查询回退到子串匹配。目前是有界整文件解析和全量重扫，不声称具备前期计划的百万事件性能或持续增量监听。

备份包括 `manifest.json`、`catalog.json` 和被引用的原始对象。SHA-256 用于损坏检测，**没有签名认证或加密**；只应存到用户控制的可信位置。恢复前检查版本、哈希、对象大小和引用关系，再在新目录重建索引。已有目录拒绝覆盖；`.asm-incomplete`／`COMMITTED` 区分未完成发布。已处理异常会清理本次创建的目录；强制断电遗留目录应保留排查或重新恢复到其他新目录，没有宣称全平台断电持久性已验收。

管理库恢复不把文件放回 Claude／Codex／IDE，也不额外收集项目代码、外部图片、检查点或账号配置；会话原文本身可能含敏感内容。恢复后的来源路径仍是原机器路径；可以查询旧归档，在新机器扫描时使用新 source ID。跨机器项目身份映射和原生恢复是后续工作。

## 5. 升级上游的流程

```bash
npm run upstream:fetch
npm run upstream:verify
```

`fetch` 只创建缺失 checkout 并检出锁定提交；对已有 checkout 不执行 reset、不丢弃改动。`verify` 检查已存在 checkout 的 HEAD、选取文件哈希、许可证副本和 txcript 安装版本。运行无需下载上游，因此 CI 可只用已保存的选取文件。

升级步骤：

1. 在参考 checkout 中获取拟采用的新版本，查看相关源文件、许可证和变更记录；已有副本与端到端样本先保留。
2. 更新 verbatim 文件时连同 `upstreams.lock.json` 的 commit／hash 一起改；CC Switch 的移植文件需人工比较，不整文件覆盖。
3. txcript 更新 `package.json` 与 `package-lock.json`，检查实际发布 WASM 的 `harnesses()` 和转换测试，而不仅看 HEAD README。
4. 更新适配器版本，以便同一原始文件可以重新解释。重新导入或将备份恢复后用保留原文构造受控重建流程；当前尚无自动批量重建命令。
5. 跑 `npm test`、`npm run upstream:verify` 和 `npm run demo`，检查失真报告与原始字节保留；若模型或归档改变，再加入显式迁移测试。

Node 核心不依赖上游的完整 UI／数据层，因此不需要跟随三套应用同时做大规模升级。也没有 fork 后自动 merge 上游的隐式行为。

## 6. 当前验证与下一步

已在 Linux、Node 22.22.3 上运行类型构建、集成测试、上游校验和合成数据 CLI 演示。测试入口直接运行 Node test 文件，避免依赖子进程隔离；当前受限环境禁止 Node spawn，CLI 用同一命令处理函数测试，并另行运行实际入口。

已提供 Windows／macOS／Linux × Node 22／24 CI 配置，尚未在远端执行，不能宣称三平台实机认证。测试不会自动读取真实个人会话。Node 22 的 SQLite 实验性提示保留在 stderr。

下一步优先：Gemini JSONL 适配、Cursor 一致性 SQLite 捕获、多文件附件清单、重建／项目映射、分页读取和后台索引。完成这些数据边界后，再接 Tauri 桌面与已验证的原生恢复流程。
