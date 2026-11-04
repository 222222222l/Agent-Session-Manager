# Agent Session Manager

[中文](README.md)

A local session-management core and CLI prototype for explicit import, search, inspection, conversion, and backup of Agent session files. It uses TypeScript, Node.js, SQLite/FTS5, and txcript WASM. Raw bytes are preserved by SHA-256; parse diagnostics and conversion losses are recorded separately.

**Version 0.1.0 is an Alpha core without desktop GUI, native-directory writeback, or cloud synchronization.** `resume` emits a native CLI command plan rather than launching a process. Exported files are not proven native continuation state.

## Coverage

| Source/function | Current support |
| --- | --- |
| Claude Code | JSONL containing `sessionId`; native CLI resume arguments |
| Codex | Rollout JSONL containing `session_meta`; native CLI resume arguments |
| Gemini CLI | Legacy JSON; new JSONL is captured raw and reported unsupported |
| Simple/custom | JSON with explicit IDs/timestamps; Adapter API v1 plugins |
| Search/backup | SQLite full-text search, raw revisions, backup verification, restore to a new directory |
| Conversion | Simple/Claude Code/Codex exports with loss reports |
| Cursor/IDE databases | Not implemented |

Discovery does not import automatically. Separate source IDs isolate machines/profiles. Backups cover the management store and captured files, not additional attachments, project code, account configuration, or all IDE state.

## Run

Requires Node.js 22.16+ in the 22 series, or 24+:

```bash
git clone https://github.com/222222222l/Agent-Session-Manager.git
cd Agent-Session-Manager
npm ci --ignore-scripts
npm test
npm run upstream:verify
npm run demo
```

The demo uses synthetic data and does not read personal sessions. `npm test` builds first; use `npm run build` separately if needed. The initial integration record reports 21 passing integration tests on 2026-10-03. Current status depends on actual runs and [Actions](https://github.com/222222222l/Agent-Session-Manager/actions); synthetic tests do not establish real-IDE migration acceptance.

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

Use the store ID returned by `list` as `SESSION_ID`. The default store is `.asm` in the current directory; explicit paths are recommended. Source and store cannot contain each other. Parse errors exit with 2, command errors with 1; captured raw files are retained. `restore` refuses an existing destination and does not write to native Agent files.

Plugin example: `npm run asm -- adapters --plugin examples/notebook-adapter.mjs`. Plugins are explicitly loaded trusted JavaScript, not sandboxed code.

## Provenance and contribution

| Upstream | Reused scope | Pinned source |
| --- | --- | --- |
| [CC Switch](https://github.com/farion1231/cc-switch) | Ported Gemini parsing/title/time handling and resume rules | `793e67d9b3210eb527e7d36f2c866a56fae9dec7`, MIT |
| [CCHistory](https://github.com/aaaAlexanderaaa/cchistory) | Three discovery/file-matching modules | `36d209ec878020d80861884a07dfc8217be4461a`, MIT |
| [txcript](https://github.com/skillsynchq/txcript) | WASM `toCommon/fromCommon` conversion | Runtime package 0.14.4; source reference `8cd3b0e63f797b1531a14197f41a0e9eeedec8c6`, Apache-2.0 |

This project maintains its normalized model, evidence storage, management services, and adapter boundaries; it is not a combined distribution of those complete applications. Source commits and npm package versions are distinct identifiers. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [upstreams.lock.json](upstreams.lock.json). Newly authored code currently has no unified top-level license; upstream licenses do not automatically license that code.

## Limits and further verification

Source files are read-only, but archived text may itself contain sensitive data. Integrity checks detect corruption; they provide no encryption or signature authentication. Scanning currently rescans bounded whole files: 64MiB per file, 10,000 files per scan, depth 32. Background watching, multi-file sessions, consistent SQLite capture, and automatic index rebuilding remain future work.

Cross-Agent conversion may lose tools, checkpoints, reasoning, or proprietary state. Inspect loss reports before use. Adapter contributions should include sanitized minimal samples, product versions, expected semantics, and tests, never real sessions or tokens.

[Integration contract](docs/04-integration-contract.md) · [Adapters/upgrades](docs/05-adapters-and-upgrades.md) · [Storage research](docs/02-session-storage.md) · [Development plan](docs/03-development-plan.md)
