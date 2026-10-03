import { readFile, access, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const lock = JSON.parse(await readFile('upstreams.lock.json', 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function git(args) {
  const result = spawnSync('git', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git failed with ${result.status}`);
}
async function head(dir) {
  const gitDir = path.join(dir, '.git');
  const value = (await readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
  if (!value.startsWith('ref: ')) return value;
  const ref = value.slice(5);
  try { return (await readFile(path.join(gitDir, ref), 'utf8')).trim(); }
  catch {
    const packed = await readFile(path.join(gitDir, 'packed-refs'), 'utf8');
    return packed.split('\n').find(line => line.endsWith(` ${ref}`))?.split(' ')[0];
  }
}
async function verify(requireCheckouts) {
  for (const repo of lock.repositories) {
    const dir = path.join('upstream', repo.name);
    if (digest(await readFile(path.join('vendor', repo.name, 'LICENSE'))) !== repo.licenseSha256) throw new Error(`${repo.name}: license copy changed`);
    let present = true;
    try { await access(path.join(dir, '.git')); } catch { present = false; }
    if (requireCheckouts && !present) throw new Error(`Missing checkout ${dir}`);
    if (present && await head(dir) !== repo.commit) throw new Error(`${repo.name}: checkout is not pinned commit`);
  }
  for (const file of lock.files) {
    if (file.mode !== 'verbatim') continue;
    if (digest(await readFile(file.localPath)) !== file.sha256) throw new Error(`Vendored copy changed: ${file.localPath}`);
    const source = path.join('upstream', file.repository, file.upstreamPath);
    try { await access(source); } catch { continue; }
    if (digest(await readFile(source)) !== file.sha256) throw new Error(`Upstream file changed: ${source}`);
  }
  const pkg = JSON.parse(await readFile('node_modules/txcript/package.json', 'utf8'));
  if (pkg.version !== lock.runtime.txcript.version) throw new Error('Wrong txcript runtime version');
  console.log('Upstream pins, selected vendor files, license copies and txcript runtime version verified.');
}
const command = process.argv[2] ?? 'verify';
if (command === 'fetch') {
  await mkdir('upstream', { recursive: true });
  for (const repo of lock.repositories) {
    const dir = path.join('upstream', repo.name);
    let present = true; try { await access(dir); } catch { present = false; }
    if (!present) {
      git(['clone', '--filter=blob:none', '--no-checkout', repo.url, dir]);
      git(['-C', dir, 'checkout', '--detach', repo.commit]);
    }
    // Never reset a pre-existing checkout or discard user edits.
  }
  await verify(true);
} else if (command === 'verify') await verify(false);
else throw new Error('Usage: node scripts/upstreams.mjs fetch|verify');
