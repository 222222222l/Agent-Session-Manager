import { realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { AdapterRegistry } from './registry.js';
import { SessionStore } from './store.js';
import { inside, walk, readStable, putObject, readObject, identity, writeNewDirectory } from './files.js';
import { validateDocument, type Capture, type SourceConfig, type Diagnostic, type ResumePlan } from './model.js';
import { convertDocument, TXCRIPT_VERSION } from './integrations/txcript.js';

export async function discoverSources(registry: AdapterRegistry, homeDir = homedir()): Promise<{ adapterId: string; root: string; exists: boolean }[]> {
    const results = [];
    for (const adapter of registry.list()) for (const root of adapter.discover?.({ homeDir, env: process.env }) ?? []) {
      let exists = false;
      try { exists = (await stat(root)).isDirectory(); } catch { /* candidates can be absent */ }
      results.push({ adapterId: adapter.id, root, exists });
    }
    return results;
}

export class SessionManager {
  constructor(readonly store: SessionStore, readonly registry: AdapterRegistry) {}
  async scan(config: SourceConfig): Promise<{ imported: number; captured: number; diagnostics: Diagnostic[] }> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(config.id)) throw new Error('Source ID must contain only letters, numbers, dot, dash or underscore');
    const adapter = this.registry.get(config.adapterId);
    const root = await realpath(config.root);
    if (!(await stat(root)).isDirectory()) throw new Error('Source root must be a directory');
    if (inside(root, this.store.root) || inside(this.store.root, root)) throw new Error('Source and store directories must not contain one another');
    const source = { ...config, root };
    this.store.registerSource(source);
    let imported = 0;
    let captured = 0;
    let visited = 0;
    const diagnostics: Diagnostic[] = [];
    for await (const relativePath of walk(root)) {
      if (++visited > 10000) throw new Error('Source scan exceeds 10000 files; select a narrower root');
      if (!adapter.matches(relativePath)) continue;
      let capture: Capture | undefined;
      try {
        const bytes = await readStable(root, relativePath);
        const rawHash = await putObject(this.store.root, bytes);
        captured++;
        capture = { id: identity(source.id, relativePath, rawHash, adapter.version), sourceId: source.id, relativePath,
          rawHash, size: bytes.length, adapterVersion: adapter.version, capturedAt: new Date().toISOString(), status: 'error', diagnostics: [] };
        const parsed = await adapter.parse({ bytes, relativePath });
        validateDocument(parsed.document);
        if (!Array.isArray(parsed.diagnostics) || !parsed.diagnostics.every(d => d && typeof d.code === 'string' && typeof d.message === 'string' && ['warning','error'].includes(d.severity))) {
          throw new Error('Adapter returned invalid diagnostics');
        }
        if (parsed.diagnostics.some(d => d.severity === 'error')) throw new Error('Adapter reported an error; normalized document was not indexed');
        capture.status = 'parsed';
        capture.diagnostics = parsed.diagnostics;
        this.store.record(capture, parsed.document);
        imported++;
        diagnostics.push(...parsed.diagnostics.map(d => ({ ...d, file: relativePath })));
      } catch (error) {
        const diagnostic: Diagnostic = { code: 'capture-or-parse-failed', severity: 'error', file: relativePath, message: error instanceof Error ? error.message : String(error) };
        diagnostics.push(diagnostic);
        if (capture) this.store.record({ ...capture, status: 'error', diagnostics: [diagnostic] });
      }
    }
    return { imported, captured, diagnostics };
  }
  async raw(sessionId: string): Promise<Buffer> {
    const session = this.store.get(sessionId);
    return readObject(this.store.root, this.store.capture(session.captureId).rawHash);
  }
  async resume(sessionId: string, overrideCwd?: string): Promise<ResumePlan> {
    const session = this.store.get(sessionId);
    const adapter = this.registry.get(session.adapterId);
    if (!adapter.capabilities.resume || !adapter.planResume) throw new Error('Adapter has no native resume capability');
    const cwd = overrideCwd ?? session.document.cwd;
    if (!cwd || !path.isAbsolute(cwd)) throw new Error('Native resume needs an existing absolute working directory; supply --cwd');
    if (!(await stat(cwd)).isDirectory()) throw new Error('Working directory does not exist');
    return adapter.planResume(session.document, await realpath(cwd));
  }
  async exportConversion(sessionId: string, target: string, destination: string): Promise<void> {
    const session = this.store.get(sessionId);
    const capture = this.store.capture(session.captureId);
    // Verify evidence before exporting any derived view.
    await readObject(this.store.root, capture.rawHash);
    const newId = randomUUID();
    const converted = convertDocument(session.document, target, newId);
    await writeNewDirectory(destination, async stage => {
      await writeFile(path.join(stage, 'transcript.txt'), converted.text, { mode: 0o600 });
      await writeFile(path.join(stage, 'report.json'), JSON.stringify({
        schemaVersion: 1, engine: `txcript@${TXCRIPT_VERSION}`, target, newNativeId: newId,
        sourceSessionId: sessionId, rawHash: capture.rawHash, sourceAdapterVersion: capture.adapterVersion,
        nativeInstalled: false, attachmentsCollected: false,
        diagnostics: [...capture.diagnostics, ...converted.diagnostics],
      }, null, 2) + '\n', { mode: 0o600 });
    });
  }
}
