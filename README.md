# Agent Session Manager

[English](README.en.md)

本地会话管理核心与CLI原型，用于显式导入、搜索、查看、转换和备份不同Agent的会话文件。实现采用TypeScript、Node.js、SQLite/FTS5和txcript WASM；原文按SHA-256保存，解析问题和转换损失单独记录。

**当前为0.1.0 Alpha核心，无桌面GUI、原生目录回写或云同步。** `resume`只输出原CLI续接计划，不启动进程；导出文件不等于已经验证的原生续接状态。

## 支持范围

| 来源/功能 | 当前范围 |
| --- | --- |
| Claude Code | 含 `sessionId` 的JSONL；提供CLI续接参数 |
| Codex | 含 `session_meta` 的rollout JSONL；提供CLI续接参数 |
| Gemini CLI | 旧JSON；新JSONL保留原文并报告不支持 |
| Simple/自定义 | 显式ID/时间戳JSON；Adapter API v1插件 |
| 搜索与备份 | SQLite全文搜索、原文修订保留、备份校验、恢复到新目录 |
| 跨Agent转换 | Simple/Claude Code/Codex导出，附损失报告 |
| Cursor/IDE数据库 | 尚未实现 |

来源发现不自动导入；使用不同来源ID隔离不同机器/Profile。备份只覆盖管理库和已捕获文件，不额外收集外部附件、项目代码、账号配置或全部IDE状态。

## 运行

需要Node.js 22.16+（22系列）或24+：

```bash
git clone https://github.com/222222222l/Agent-Session-Manager.git
cd Agent-Session-Manager
npm ci --ignore-scripts
npm test
npm run upstream:verify
npm run demo
```

演示使用合成数据，不读取个人会话。`npm test`会先构建；单独构建为 `npm run build`。初始整合记录报告21项集成测试通过（2026-10-03）；当前状态以实际运行和 [Actions](https://github.com/222222222l/Agent-Session-Manager/actions) 为准，不能从合成测试推定真实IDE迁移已验收。

## CLI

```bash
npm run asm -- adapters
npm run asm -- discover
npm run asm -- scan --adapter claude_code --source laptop-claude --root /absolute/source --store /absolute/store
npm run asm -- list --query "cache" --store /absolute/store
npm run asm -- show --id SESSION_ID --store /absolute/store
npm run asm -- resume --id SESSION_ID --cwd /absolute/project --store /absolute/store
npm run asm -- export --id SESSION_ID --target codex --out /absolute/new-export --store /absolute/store
npm run asm -- backup --out /absolute/new-backup --store /absolute/store
npm run asm -- verify-backup --dir /absolute/new-backup
npm run asm -- restore --dir /absolute/new-backup --out /absolute/new-store
```

`SESSION_ID`取自列表的管理库ID。默认管理库为当前目录 `.asm`，建议显式指定；源与管理库不能互相包含。扫描解析错误返回2、命令错误返回1，原文捕获仍保留。`restore`拒绝覆盖已有目录，不改写原Agent文件。

插件示例：`npm run asm -- adapters --plugin examples/notebook-adapter.mjs`。插件是显式加载的可信JavaScript，不是隔离沙箱。

## 上游与贡献

| 上游 | 复用范围 | 固定来源 |
| --- | --- | --- |
| [CC Switch](https://github.com/farion1231/cc-switch) | Gemini解析/标题时间处理移植、续接参数规则 | `793e67d9b3210eb527e7d36f2c866a56fae9dec7`，MIT |
| [CCHistory](https://github.com/aaaAlexanderaaa/cchistory) | 三个来源发现/文件匹配模块 | `36d209ec878020d80861884a07dfc8217be4461a`，MIT |
| [txcript](https://github.com/skillsynchq/txcript) | WASM `toCommon/fromCommon` 转换 | 运行包0.14.4；源码参考 `8cd3b0e63f797b1531a14197f41a0e9eeedec8c6`，Apache-2.0 |

本项目维护统一模型、证据存储、管理服务与适配边界，不是上述完整应用的合并发行。源码参考提交与npm包版本是不同标识。归属、许可和完整性记录见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[upstreams.lock.json](upstreams.lock.json)。新增代码目前没有统一顶层许可证；上游许可不能自动代表新增代码的许可。

## 限制与进一步验证

源文件只读，但归档原文本身可能包含敏感信息。校验检测损坏，不提供加密或签名认证。当前为有界整文件重扫：单文件64MiB、单次最多10,000文件、目录深度32。后台监听、多文件会话、SQLite一致性捕获和自动索引重建仍是后续工作。

跨Agent转换可能丢失工具、检查点、推理和厂商状态；使用前检查损失报告。适配器应提交脱敏最小样本、产品版本、预期语义与测试，不提交真实会话或令牌。

[整合契约](docs/04-integration-contract.md) · [适配器与升级](docs/05-adapters-and-upgrades.md) · [存储调研](docs/02-session-storage.md) · [开发计划](docs/03-development-plan.md)
