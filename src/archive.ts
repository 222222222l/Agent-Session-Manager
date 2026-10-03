import { writeFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { hash, identity, assertHash, readObject, putObject, readStable, writeNewDirectory, MAX_FILE_BYTES } from './files.js';
import { object, validateDocument, type ArchiveCatalog } from './model.js';
import { SessionStore } from './store.js';

interface Manifest {
  schemaVersion: 1;
  createdAt: string;
  catalogHash: string;
  objects: { hash: string; size: number }[];
  scope: 'manager-catalog-and-captured-files';
}
function validateCatalog(value: unknown): asserts value is ArchiveCatalog {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.captures) || !Array.isArray(value.sessions)) throw new Error('Unsupported archive catalog');
  const sourceIds = new Map<string, string>();
  for (const source of value.sources) {
    if (!object(source) || typeof source.id !== 'string' || !source.id || typeof source.adapterId !== 'string' || typeof source.root !== 'string' || sourceIds.has(source.id)) throw new Error('Invalid or duplicate source in archive');
    sourceIds.set(source.id, source.adapterId);
  }
  const captures = new Map<string, Record<string, unknown>>();
  const objectSizes = new Map<string, number>();
  for (const capture of value.captures) {
    if (!object(capture) || typeof capture.id !== 'string' || typeof capture.sourceId !== 'string' || !sourceIds.has(capture.sourceId) ||
        typeof capture.relativePath !== 'string' || !capture.relativePath || typeof capture.rawHash !== 'string' ||
        typeof capture.adapterVersion !== 'string' || !capture.adapterVersion ||
        typeof capture.size !== 'number' || !Number.isInteger(capture.size) || capture.size < 0 || capture.size > MAX_FILE_BYTES ||
        typeof capture.capturedAt !== 'string' || !Number.isFinite(Date.parse(capture.capturedAt)) ||
        !['parsed', 'error'].includes(String(capture.status)) || !Array.isArray(capture.diagnostics) ||
        !capture.diagnostics.every(d => object(d) && typeof d.code === 'string' && typeof d.message === 'string' && ['warning','error'].includes(String(d.severity))) || captures.has(capture.id)) throw new Error('Invalid capture in archive');
    assertHash(capture.rawHash);
    const priorSize = objectSizes.get(capture.rawHash);
    if (priorSize !== undefined && priorSize !== capture.size) throw new Error('Conflicting sizes for one evidence object');
    objectSizes.set(capture.rawHash, capture.size);
    const portablePath = capture.relativePath.replaceAll('\\', '/');
    if (portablePath.startsWith('/') || /^[A-Za-z]:/.test(portablePath) || portablePath.split('/').includes('..')) throw new Error('Unsafe capture path in archive');
    if (identity(capture.sourceId, capture.relativePath, capture.rawHash, capture.adapterVersion) !== capture.id) throw new Error('Capture identity mismatch');
    captures.set(capture.id, capture);
  }
  const sessionIds = new Set<string>();
  for (const session of value.sessions) {
    if (!object(session) || typeof session.id !== 'string' || typeof session.sourceId !== 'string' || typeof session.adapterId !== 'string' ||
        typeof session.captureId !== 'string' || sourceIds.get(session.sourceId) !== session.adapterId || sessionIds.has(session.id)) throw new Error('Invalid session in archive');
    validateDocument(session.document);
    const capture = captures.get(session.captureId);
    if (!capture || capture.sourceId !== session.sourceId || capture.status !== 'parsed' || identity(session.sourceId, session.document.nativeId) !== session.id) throw new Error('Session evidence reference mismatch');
    sessionIds.add(session.id);
  }
}

export async function createBackup(store: SessionStore, destination: string): Promise<void> {
  const catalog = store.catalog();
  validateCatalog(catalog);
  const sizes = new Map(catalog.captures.map(c => [c.rawHash, c.size]));
  await writeNewDirectory(destination, async stage => {
    for (const digest of sizes.keys()) await putObject(stage, await readObject(store.root, digest));
    const bytes = Buffer.from(JSON.stringify(catalog, null, 2) + '\n');
    await writeFile(path.join(stage, 'catalog.json'), bytes, { mode: 0o600 });
    const manifest: Manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), catalogHash: hash(bytes),
      objects: [...sizes].map(([hash, size]) => ({ hash, size })), scope: 'manager-catalog-and-captured-files' };
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  });
}

export async function verifyBackup(directory: string): Promise<{ catalog: ArchiveCatalog; manifest: Manifest; root: string }> {
  const root = await realpath(directory);
  try { await lstat(path.join(root, '.asm-incomplete')); throw new Error('Incomplete archive publication'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if ((await readStable(root, 'COMMITTED', 100)).toString() !== 'asm-v1\n') throw new Error('Incomplete archive');
  const manifest: unknown = JSON.parse((await readStable(root, 'manifest.json', 8 * 1024 * 1024)).toString());
  if (!object(manifest) || manifest.schemaVersion !== 1 || manifest.scope !== 'manager-catalog-and-captured-files' ||
      typeof manifest.catalogHash !== 'string' || typeof manifest.createdAt !== 'string' ||
      !Array.isArray(manifest.objects) || manifest.objects.length > 100000) throw new Error('Unsupported backup manifest');
  assertHash(manifest.catalogHash);
  const bytes = await readStable(root, 'catalog.json');
  if (hash(bytes) !== manifest.catalogHash) throw new Error('Catalog checksum mismatch');
  const catalog: unknown = JSON.parse(bytes.toString());
  validateCatalog(catalog);
  const expected = new Map(catalog.captures.map(c => [c.rawHash, c.size]));
  const seen = new Set<string>();
  for (const item of manifest.objects) {
    if (!object(item) || typeof item.hash !== 'string' || typeof item.size !== 'number' ||
        expected.get(item.hash) !== item.size || seen.has(item.hash)) throw new Error('Invalid, missing or duplicate backup object');
    assertHash(item.hash);
    const bytes = await readObject(root, item.hash);
    if (bytes.length !== item.size) throw new Error('Backup object size mismatch');
    seen.add(item.hash);
  }
  if (seen.size !== expected.size) throw new Error('Backup is missing referenced objects');
  return { catalog, manifest: manifest as unknown as Manifest, root };
}
export async function restoreBackup(directory: string, destination: string): Promise<void> {
  const verified = await verifyBackup(directory);
  await writeNewDirectory(destination, async stage => {
    for (const item of verified.manifest.objects) await putObject(stage, await readObject(verified.root, item.hash));
    const store = new SessionStore(stage);
    try { store.importCatalog(verified.catalog); }
    finally { store.close(); }
  });
}
