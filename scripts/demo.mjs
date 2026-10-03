import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../dist/src/cli-main.js';

await mkdir('.demo', { recursive: true });
const root = await mkdtemp(path.resolve('.demo/run-'));
const source = path.join(root, 'source');
const store = path.join(root, 'store');
await mkdir(source);
await writeFile(path.join(source, 'sample.json'), JSON.stringify({ id: 'demo-session', timestamp: '2026-10-03T00:00:00Z',
  cwd: source, messages: [{ role: 'user', content: '修复缓存：解释 cache invalidation 的方案' }, { role: 'assistant', content: 'Add a cache version and test stale reads.' }] }));
async function run(args) {
  const code = await runCli(args, text => console.log(text));
  if (code !== 0) throw new Error(`Demo command failed: ${args[0]}`);
}
await run(['scan', '--source', 'demo', '--adapter', 'simple', '--root', source, '--store', store]);
let sessions;
await runCli(['list', '--query', '缓存', '--store', store], text => { sessions = JSON.parse(text); });
if (sessions.length !== 1) throw new Error('Demo search failed');
await run(['export', '--id', sessions[0].id, '--target', 'codex', '--out', path.join(root, 'converted'), '--store', store]);
await run(['backup', '--out', path.join(root, 'backup'), '--store', store]);
await run(['verify-backup', '--dir', path.join(root, 'backup')]);
await run(['restore', '--dir', path.join(root, 'backup'), '--out', path.join(root, 'restored')]);
console.log(`Demo complete. Synthetic input, conversion report, backup and restored store: ${root}`);
