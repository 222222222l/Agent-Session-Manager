import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, mkdir, writeFile, rename, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export function hash(data: Uint8Array | string): string { return createHash('sha256').update(data).digest('hex'); }
export function identity(...parts: string[]): string { return hash(JSON.stringify(parts)); }
export function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function assertHash(value: string): void { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid object hash'); }

export async function* walk(root: string, dir = root, depth = 0): AsyncGenerator<string> {
  if (depth > 32) throw new Error('Source nesting exceeds 32 directories');
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(root, file, depth + 1);
    else if (entry.isFile()) yield path.relative(root, file);
  }
}
/** Stable per-file capture; never claims a multi-file transaction or copies live SQLite. */
export async function readStable(root: string, relativePath: string, limit = MAX_FILE_BYTES): Promise<Buffer> {
  const file = path.resolve(root, relativePath);
  if (!inside(root, file)) throw new Error('Source escapes configured root');
  const ls = await lstat(file);
  if (!ls.isFile() || ls.isSymbolicLink() || !inside(root, await realpath(file))) throw new Error('Source is not a contained regular file');
  const fd = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await fd.stat();
    if (before.ino !== ls.ino || before.dev !== ls.dev) throw new Error('Source changed while opening');
    if (before.size > limit) throw new Error(`File exceeds ${limit} byte prototype limit`);
    // Read a bounded snapshot prefix; a growing file must never allocate unbounded memory.
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = await fd.read(bytes, offset, bytes.length - offset, offset);
      if (!chunk.bytesRead) break;
      offset += chunk.bytesRead;
    }
    const after = await fd.stat();
    if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('Source changed during capture; retry after it becomes stable');
    }
    return bytes;
  } finally { await fd.close(); }
}
export async function putObject(root: string, bytes: Buffer): Promise<string> {
  const digest = hash(bytes);
  await mkdir(path.join(root, 'objects'), { recursive: true, mode: 0o700 });
  if ((await lstat(path.join(root, 'objects'))).isSymbolicLink()) throw new Error('Object directory must not be a symlink');
  const file = path.join(root, 'objects', digest);
  try {
    await lstat(file);
    await readObject(root, digest);
    return digest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temp = path.join(root, 'objects', `.pending-${randomUUID()}`);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, file);
  }
  finally { await rm(temp, { force: true }); }
  return digest;
}
export async function readObject(root: string, digest: string): Promise<Buffer> {
  assertHash(digest);
  const bytes = await readStable(await realpath(root), path.join('objects', digest));
  if (hash(bytes) !== digest) throw new Error(`Evidence checksum mismatch: ${digest}`);
  return bytes;
}
export async function assertAbsent(destination: string): Promise<void> {
  try { await lstat(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error(`Destination already exists: ${destination}`);
}
export async function writeNewDirectory(destination: string, build: (stage: string) => Promise<void>): Promise<void> {
  const dest = path.resolve(destination);
  await assertAbsent(dest);
  await mkdir(path.dirname(dest), { recursive: true });
  // Reserve the final name atomically. A failed build removes only our own reservation.
  await mkdir(dest, { mode: 0o700 });
  let stage: string | undefined;
  try {
    await writeFile(path.join(dest, '.asm-incomplete'), 'publication in progress\n', { flag: 'wx', mode: 0o600 });
    stage = await mkdtemp(path.join(path.dirname(dest), '.asm-stage-'));
    await build(stage);
    // Rename into the reservation, not over any existing user data.
    // Windows cannot rename over a directory; publish children then COMMITTED marker last.
    for (const name of await readdir(stage)) await rename(path.join(stage, name), path.join(dest, name));
    await writeFile(path.join(dest, 'COMMITTED'), 'asm-v1\n', { flag: 'wx', mode: 0o600 });
    await rm(path.join(dest, '.asm-incomplete'));
  } catch (error) { await rm(dest, { recursive: true, force: true }); throw error; }
  finally { if (stage) await rm(stage, { recursive: true, force: true }); }
}
