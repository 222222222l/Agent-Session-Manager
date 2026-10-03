# Third-party components

This project includes small source adaptations and an unmodified runtime dependency.
Complete upstream checkouts in `upstream/` are development references, not runtime dependencies.
Exact commits, source paths and checksums are recorded in [upstreams.lock.json](upstreams.lock.json).

| Project | Use | License |
| --- | --- | --- |
| [CC Switch](https://github.com/farion1231/cc-switch) | Gemini message reader and session helpers ported to TypeScript; resume command conventions | MIT, Copyright (c) 2025 Jason Young; [full notice](vendor/cc-switch/LICENSE) |
| [CCHistory](https://github.com/aaaAlexanderaaa/cchistory) | Three unmodified discovery/filter modules, local compatibility shim | MIT, Copyright (c) 2026 CCHistory Contributors; [full notice](vendor/cchistory/LICENSE) |
| [txcript](https://github.com/skillsynchq/txcript) | Published 0.14.4 WASM codecs, called through a local bridge | Apache-2.0; [full license](vendor/txcript/LICENSE) |

Changes to the CC Switch port: explicit diagnostics instead of silently skipping messages;
unknown native messages/tool data retained; structured argv plans instead of executable shell strings;
no source deletion. The CCHistory shim removes its application-specific platform union and unrelated
package coupling. Original selected discovery files are unchanged.

The txcript npm artifact includes its own license. Its published harness list differs from the source
checkout; runtime tests, not the current upstream README alone, establish this application's supported
conversion directions. No txcript cloud/account integration is invoked.

TypeScript, Node.js type declarations and undici-types are development dependencies with their own
licenses in their installed package directories. Preserve the third-party notices and license copies
when redistributing builds. This file does not choose a license for new project-owned code.
