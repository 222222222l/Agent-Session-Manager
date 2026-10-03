import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli-main.js';
import txcript from 'txcript';
import { builtinRegistry, AdapterRegistry, SessionStore, SessionManager, createBackup, verifyBackup, restoreBackup } from '../src/index.js';
import { hash, writeNewDirectory } from '../src/files.js';

const now = '2026-10-03T10:00:00.000Z';
function claude(id = 'shared-id', cwd = '/example/project'): string {
  return [
    { type: 'user', uuid: 'u1', parentUuid: null, sessionId: id, timestamp: now, cwd,
      message: { role: 'user', content: '修复缓存 cache invalidation' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: id, timestamp: now,
      message: { role: 'assistant', content: [{ type: 'text', text: 'I will inspect the cache.' },
        { type: 'tool_use', id: 'tool1', name: 'Read', input: { file_path: 'cache.ts' } }] } },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', sessionId: id, timestamp: now,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'cached = false' }] } },
    { type: 'future-native-state', secret: 'retained-original-value' },
  ].map(x => JSON.stringify(x)).join('\n') + '\n';
}
function codex(): string {
  return [
    { type: 'session_meta', timestamp: now, payload: { id: 'codex-test', timestamp: now, cwd: '/example/project', cli_version: 'test' } },
    { type: 'response_item', timestamp: now, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Check queue ordering' }] } },
    { type: 'response_item', timestamp: now, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Queue ordering verified' }] } },
  ].map(x => JSON.stringify(x)).join('\n') + '\n';
}
async function setup(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'asm-test-'));
  const source = path.join(root, 'source');
  await mkdir(source);
  const store = new SessionStore(path.join(root, 'store'));
  const registry = builtinRegistry();
  const manager = new SessionManager(store, registry);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, source, store, registry, manager };
}
async function seed(ctx: Awaited<ReturnType<typeof setup>>, text = claude()) {
  await writeFile(path.join(ctx.source, 'session.jsonl'), text);
  return ctx.manager.scan({ id: 'laptop', adapterId: 'claude_code', root: ctx.source });
}

test('real txcript ingestion preserves raw bytes, tool pairing and Chinese/English search', async t => {
  const c = await setup(t);
  const original = claude();
  const report = await seed(c, original);
  assert.equal(report.imported, 1);
  assert.ok(report.diagnostics.some(d => d.code === 'unknown-records'));
  const session = c.store.list()[0]!;
  assert.equal(session.document.nativeId, 'shared-id');
  const blocks = session.document.messages.flatMap(m => m.blocks);
  assert.ok(blocks.some(b => b.type === 'tool_use' && b.id === 'tool1'));
  assert.ok(blocks.some(b => b.type === 'tool_result' && b.tool_use_id === 'tool1'));
  assert.equal((await c.manager.raw(session.id)).toString(), original);
  assert.equal((await readFile(path.join(c.source, 'session.jsonl'))).toString(), original);
  assert.equal(c.store.list({ query: '缓存' }).length, 1); // short-query fallback
  assert.equal(c.store.list({ query: 'cache invalidation' }).length, 1); // trigram index
  assert.equal(c.store.list({ query: 'never mentioned' }).length, 0);
});
test('Codex native records use the actual WASM decoder', async t => {
  const c = await setup(t);
  await writeFile(path.join(c.source, 'rollout-test.jsonl'), codex());
  assert.equal((await c.manager.scan({ id: 'codex', adapterId: 'codex', root: c.source })).imported, 1);
  assert.equal(c.store.list()[0]!.document.messages.length, 2);
  assert.equal(c.store.list({ query: 'queue' }).length, 1);
});
test('repeat scans are idempotent and source pruning does not delete archive', async t => {
  const c = await setup(t); await seed(c); await seed(c);
  assert.equal(c.store.catalog().captures.length, 1);
  assert.equal(c.store.list().length, 1);
  await rm(path.join(c.source, 'session.jsonl'));
  await c.manager.scan({ id: 'laptop', adapterId: 'claude_code', root: c.source });
  assert.equal(c.store.list().length, 1);
  assert.equal((await c.manager.raw(c.store.list()[0]!.id)).toString(), claude());
});
test('revisions remain archived while latest session projection is updated', async t => {
  const c = await setup(t); await seed(c);
  await seed(c, claude().replace('cache invalidation', 'cache refreshed'));
  assert.equal(c.store.catalog().captures.length, 2);
  assert.equal(c.store.list().length, 1);
  assert.equal(c.store.list({ query: 'cache refreshed' }).length, 1);
});
test('native IDs are scoped by source and duplicate files are explicit conflicts', async t => {
  const c = await setup(t); await seed(c);
  await c.manager.scan({ id: 'other-machine', adapterId: 'claude_code', root: c.source });
  assert.equal(c.store.list().length, 2);
  await writeFile(path.join(c.source, 'duplicate.jsonl'), claude());
  const report = await c.manager.scan({ id: 'laptop', adapterId: 'claude_code', root: c.source });
  assert.ok(report.diagnostics.some(d => d.severity === 'error' && d.message.includes('Conflicting')));
  assert.equal(c.store.list().length, 2);
});
test('partial trailing record is retained and not passed to codec', async t => {
  const c = await setup(t); const raw = claude() + '{"type":"assistant"';
  const report = await seed(c, raw);
  assert.equal(report.imported, 1);
  assert.ok(report.diagnostics.some(d => d.code === 'partial-tail'));
  assert.equal((await c.manager.raw(c.store.list()[0]!.id)).toString(), raw);
});
test('malformed interior record preserves evidence and does not replace known good session', async t => {
  const c = await setup(t); await seed(c);
  const report = await seed(c, claude() + '{broken}\n');
  assert.equal(report.imported, 0);
  assert.ok(report.diagnostics.some(d => d.severity === 'error'));
  assert.equal(c.store.list().length, 1);
  assert.equal(c.store.catalog().captures.filter(c => c.status === 'error').length, 1);
});
test('Gemini port retains array content, info records and exact tool data; new JSONL fails visibly', async t => {
  const c = await setup(t);
  await writeFile(path.join(c.source, 'session-g.json'), JSON.stringify({ sessionId: 'gemini-id', startTime: now,
    messages: [{ type: 'user', content: [{ text: '你好' }, { text: '世界' }] },
      { type: 'gemini', content: 'Done', toolCalls: [{ name: 'read_file', args: { file: 'a' }, result: 'contents' }] },
      { type: 'info', content: 'system banner' }] }));
  await writeFile(path.join(c.source, 'session-new.jsonl'), '{"sessionId":"new"}\n');
  const report = await c.manager.scan({ id: 'gemini', adapterId: 'gemini', root: c.source });
  assert.equal(report.imported, 1); assert.equal(report.captured, 2);
  assert.ok(report.diagnostics.some(d => d.message.includes('JSONL is not yet supported')));
  assert.equal(c.store.list()[0]!.document.messages.length, 3);
  assert.equal(c.store.list({ query: 'read_file' }).length, 1);
});
test('new-format plugin imports, searches and survives backup without changing core', async t => {
  const c = await setup(t);
  await c.registry.loadPlugin(path.resolve('examples/notebook-adapter.mjs'));
  await writeFile(path.join(c.source, 'example.notebook.json'), JSON.stringify({ format: 'notebook-agent/v1', key: 'novel-id', opened: now, turns: [{ speaker: 'user', body: '新产品格式已接入' }] }));
  assert.equal((await c.manager.scan({ id: 'notebook', adapterId: 'example.notebook', root: c.source })).imported, 1);
  assert.equal(c.store.list({ query: '新产品' }).length, 1);
  await createBackup(c.store, path.join(c.root, 'backup'));
  assert.equal((await verifyBackup(path.join(c.root, 'backup'))).catalog.sessions[0]!.adapterId, 'example.notebook');
});
test('registry rejects duplicate IDs, unknown ABI and incomplete capabilities', () => {
  const registry = new AdapterRegistry(); const adapter = builtinRegistry().get('simple');
  registry.register(adapter);
  assert.throws(() => registry.register(adapter), /Duplicate/);
  assert.throws(() => registry.register({ ...adapter, apiVersion: 2 as 1 }), /API version/);
  assert.throws(() => new AdapterRegistry().register({ ...adapter, capabilities: { read: true, resume: true } }), /descriptor/);
});
test('export uses real txcript conversion and new identity with loss report', async t => {
  const c = await setup(t); await seed(c);
  const session = c.store.list()[0]!;
  const out = path.join(c.root, 'converted');
  await c.manager.exportConversion(session.id, 'codex', out);
  const text = await readFile(path.join(out, 'transcript.txt'), 'utf8');
  const common = JSON.parse(txcript.toCommon(text, 'codex'));
  assert.notEqual(common.meta.id, session.document.nativeId);
  assert.ok(common.messages.some((m: { content: unknown }) => JSON.stringify(m.content).includes('修复缓存')));
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.nativeInstalled, false);
  assert.ok(report.diagnostics.some((d: { code: string }) => d.code === 'lossy-conversion'));
  await assert.rejects(c.manager.exportConversion(session.id, 'codex', out), /already exists/);
  await assert.rejects(c.manager.exportConversion(session.id, 'imaginary', path.join(c.root, 'bad')), /Unvalidated/);
});
test('resume plan uses argv, requires cwd, rejects argument-like session IDs', async t => {
  const c = await setup(t); await seed(c, claude('resume-id', c.source));
  const plan = await c.manager.resume(c.store.list()[0]!.id);
  assert.deepEqual(plan.args, ['--resume', 'resume-id']);
  assert.equal(plan.execute, false);
  await assert.rejects(c.manager.resume(c.store.list()[0]!.id, path.join(c.root, 'missing')));
  const adapter = c.registry.get('claude_code');
  assert.throws(() => adapter.planResume!({ ...c.store.list()[0]!.document, nativeId: '--help' }, c.source), /unsafe/);
});
test('backup verifies and restores into a fresh manager with identical raw evidence', async t => {
  const c = await setup(t); await seed(c);
  const backup = path.join(c.root, 'backup'); const restored = path.join(c.root, 'restored');
  await createBackup(c.store, backup);
  const verified = await verifyBackup(backup);
  assert.equal(verified.catalog.sessions.length, 1);
  await restoreBackup(backup, restored);
  const store = new SessionStore(restored);
  try {
    assert.deepEqual(store.list(), c.store.list());
    const manager = new SessionManager(store, c.registry);
    assert.equal((await manager.raw(store.list()[0]!.id)).toString(), claude());
  } finally { store.close(); }
  await assert.rejects(restoreBackup(backup, restored), /already exists/);
});
test('tampered raw evidence and catalog fail before any restore publication', async t => {
  const c = await setup(t); await seed(c); const backup = path.join(c.root, 'backup');
  await createBackup(c.store, backup);
  const digest = c.store.catalog().captures[0]!.rawHash;
  await writeFile(path.join(backup, 'objects', digest), 'changed');
  await assert.rejects(verifyBackup(backup), /checksum mismatch/);
  await assert.rejects(restoreBackup(backup, path.join(c.root, 'no-restore')));
  assert.ok(!(await readdir(c.root)).includes('no-restore'));
  await writeFile(path.join(backup, 'objects', digest), claude());
  await writeFile(path.join(backup, 'catalog.json'), '{}');
  await assert.rejects(verifyBackup(backup), /Catalog checksum/);
});
test('archive traversal paths and dangling session references are rejected even with recomputed catalog hash', async t => {
  const c = await setup(t); await seed(c); const backup = path.join(c.root, 'backup');
  await createBackup(c.store, backup);
  const catalog = JSON.parse(await readFile(path.join(backup, 'catalog.json'), 'utf8'));
  catalog.sessions[0].captureId = 'absent';
  const text = JSON.stringify(catalog);
  await writeFile(path.join(backup, 'catalog.json'), text);
  const manifest = JSON.parse(await readFile(path.join(backup, 'manifest.json'), 'utf8'));
  manifest.catalogHash = hash(text);
  await writeFile(path.join(backup, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifyBackup(backup), /reference mismatch/);
  catalog.captures[0].relativePath = '..\\outside.jsonl';
  const traversal = JSON.stringify(catalog);
  await writeFile(path.join(backup, 'catalog.json'), traversal);
  manifest.catalogHash = hash(traversal);
  await writeFile(path.join(backup, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifyBackup(backup), /Unsafe capture path/);
});
test('same-byte parse retry recovers, and a later failure preserves the last good view and backup', async t => {
  const c = await setup(t);
  const original = c.registry.get('claude_code');
  let fail = true;
  c.registry.register({ ...original, id: 'retry-agent', parse(input) {
    if (fail) throw new Error('temporary parser failure');
    return original.parse(input);
  } });
  await writeFile(path.join(c.source, 'retry.jsonl'), claude());
  const config = { id: 'retry', adapterId: 'retry-agent', root: c.source };
  assert.equal((await c.manager.scan(config)).imported, 0);
  fail = false;
  assert.equal((await c.manager.scan(config)).imported, 1);
  assert.equal(c.store.catalog().captures.length, 1);
  assert.equal(c.store.catalog().captures[0]!.status, 'parsed');
  fail = true;
  assert.equal((await c.manager.scan(config)).imported, 0);
  assert.equal(c.store.list().length, 1);
  assert.equal(c.store.catalog().captures[0]!.status, 'parsed');
  await createBackup(c.store, path.join(c.root, 'retry-backup'));
  assert.equal((await verifyBackup(path.join(c.root, 'retry-backup'))).catalog.sessions.length, 1);
});
test('incomplete publications are rejected even if a commit marker exists', async t => {
  const c = await setup(t); await seed(c);
  const backup = path.join(c.root, 'incomplete');
  await createBackup(c.store, backup);
  await writeFile(path.join(backup, '.asm-incomplete'), 'interrupted');
  await assert.rejects(verifyBackup(backup), /Incomplete/);
  assert.throws(() => new SessionStore(backup), /Incomplete/);
  assert.ok(!(await readdir(backup)).includes('index.sqlite'));
});
test('source identity cannot be rebound and corrupt stored evidence cannot be reused', async t => {
  const c = await setup(t); await seed(c);
  const another = path.join(c.root, 'another-source'); await mkdir(another);
  await assert.rejects(c.manager.scan({ id: 'laptop', adapterId: 'claude_code', root: another }), /different root/);
  const capture = c.store.catalog().captures[0]!;
  await writeFile(path.join(c.store.root, 'objects', capture.rawHash), 'corrupt');
  const result = await seed(c);
  assert.equal(result.imported, 0);
  assert.ok(result.diagnostics.some(d => d.message.includes('checksum mismatch')));
  await assert.rejects(createBackup(c.store, path.join(c.root, 'invalid-backup')), /checksum mismatch/);
  assert.ok(!(await readdir(c.root)).includes('invalid-backup'));
});
test('failed publication cleans its reservation and preserves other existing data', async t => {
  const c = await setup(t); const destination = path.join(c.root, 'new-output');
  await assert.rejects(writeNewDirectory(destination, async stage => {
    await writeFile(path.join(stage, 'partial'), 'test'); throw new Error('simulated interruption');
  }), /simulated/);
  assert.ok(!(await readdir(c.root)).includes('new-output'));
  await assert.rejects(writeNewDirectory(c.source, async () => {}), /already exists/);
});
test('source symlinks are not followed and a source cannot overlap the manager store', async t => {
  const c = await setup(t); const outside = path.join(c.root, 'outside.jsonl'); await writeFile(outside, claude());
  try { await symlink(outside, path.join(c.source, 'linked.jsonl')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Host cannot create symlinks'); return; } throw error; }
  assert.equal((await c.manager.scan({ id: 'links', adapterId: 'claude_code', root: c.source })).captured, 0);
  await assert.rejects(c.manager.scan({ id: 'overlap', adapterId: 'claude_code', root: c.root }), /contain/);
});
test('CLI contract gives nonzero status for parse failures and reports actual results', async t => {
  const c = await setup(t);
  await writeFile(path.join(c.source, 'bad.jsonl'), '{broken}\n');
  const output: string[] = [];
  const status = await runCli(['scan', '--root', c.source, '--source', 'cli', '--adapter', 'claude_code', '--store', path.join(c.root, 'cli-store')], text => output.push(text));
  assert.equal(status, 2);
  assert.equal(JSON.parse(output.pop()!).captured, 1);
  assert.equal(await runCli(['adapters'], text => output.push(text)), 0);
  assert.equal(JSON.parse(output.pop()!).length, 4);
});
