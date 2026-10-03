import { parseArgs } from 'node:util';
import { builtinRegistry, SessionStore, SessionManager, discoverSources, createBackup, verifyBackup, restoreBackup } from './index.js';

const help = `Agent Session Manager 0.1 — local prototype (JSON output)

npm run asm -- adapters
npm run asm -- discover [--home PATH]             List candidates; no automatic import
npm run asm -- scan --adapter ID --source NAME --root DIR [--store DIR]
npm run asm -- list [--query TEXT] [--source NAME] [--limit N] [--store DIR]
npm run asm -- show --id SESSION [--store DIR]
npm run asm -- resume --id SESSION [--cwd DIR]    Print argv plan; never launches
npm run asm -- export --id SESSION --target simple|claude_code|codex --out NEW_DIR
npm run asm -- backup --out NEW_DIR [--store DIR]
npm run asm -- verify-backup --dir DIR
npm run asm -- restore --dir BACKUP --out NEW_STORE

Default store: .asm in working directory. --plugin PATH explicitly loads trusted JS code.
Backup covers imported evidence and manager state, not native IDE state or external attachments.
Export is a lossy file conversion, not native installation. Existing destinations are refused.
`;

export async function runCli(argv: string[], output: (text: string) => void = console.log): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    store: { type: 'string' }, adapter: { type: 'string' }, source: { type: 'string' }, root: { type: 'string' },
    id: { type: 'string' }, query: { type: 'string' }, limit: { type: 'string' }, cwd: { type: 'string' },
    out: { type: 'string' }, target: { type: 'string' }, dir: { type: 'string' }, home: { type: 'string' },
    plugin: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' },
  } });
  const command = positionals[0];
  if (values.help || !command) { output(help); return 0; }
  if (positionals.length !== 1) throw new Error('Unexpected positional arguments');
  const required = (key: 'adapter' | 'source' | 'root' | 'id' | 'out' | 'target' | 'dir'): string => {
    const value = values[key]; if (!value) throw new Error(`--${key} is required`); return value;
  };
  const print = (value: unknown) => output(JSON.stringify(value, null, 2));
  const registry = builtinRegistry();
  for (const plugin of values.plugin ?? []) await registry.loadPlugin(plugin);
  if (command === 'adapters') {
    print(registry.list().map(({ id, version, label, apiVersion, formats, capabilities }) => ({ id, version, label, apiVersion, formats, capabilities })));
    return 0;
  }
  if (command === 'discover') {
    print(await discoverSources(registry, values.home)); return 0;
  }
  if (command === 'verify-backup') {
    const result = await verifyBackup(required('dir'));
    print({ verified: true, sessions: result.catalog.sessions.length, objects: result.manifest.objects.length }); return 0;
  }
  if (command === 'restore') {
    await restoreBackup(required('dir'), required('out')); print({ restored: true, destination: values.out, nativeRestored: false }); return 0;
  }
  if (!['scan', 'list', 'show', 'resume', 'export', 'backup'].includes(command)) throw new Error(`Unknown command: ${command}`);
  let status = 0;
  const store = new SessionStore(values.store ?? '.asm');
  try {
    const manager = new SessionManager(store, registry);
    switch (command) {
      case 'scan': {
        const result = await manager.scan({ id: required('source'), adapterId: required('adapter'), root: required('root') });
        print(result); if (result.diagnostics.some(d => d.severity === 'error')) status = 2; break;
      }
      case 'list': print(store.list({ ...(values.query ? { query: values.query } : {}), ...(values.source ? { sourceId: values.source } : {}), ...(values.limit ? { limit: Number(values.limit) } : {}) })); break;
      case 'show': { const session = store.get(required('id')); print({ ...session, capture: store.capture(session.captureId) }); break; }
      case 'resume': print(await manager.resume(required('id'), values.cwd)); break;
      case 'export': await manager.exportConversion(required('id'), required('target'), required('out')); print({ exported: true, destination: values.out, nativeInstalled: false }); break;
      case 'backup': await createBackup(store, required('out')); print({ backedUp: true, destination: values.out }); break;
    }
  } finally { store.close(); }
  return status;
}
