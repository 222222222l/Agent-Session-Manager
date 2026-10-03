import path from 'node:path';
import { claudeCodeAdapter } from '../../vendor/cchistory/claude-code.js';
import { codexAdapter } from '../../vendor/cchistory/codex.js';
import { geminiAdapter } from '../../vendor/cchistory/gemini.js';
import { parseGeminiJson, resumePlan } from '../../vendor/cc-switch/session.js';
import { decodeTranscript } from '../integrations/txcript.js';
import { object, type SessionAdapter, type Diagnostic } from '../model.js';
import { AdapterRegistry } from '../registry.js';

function validateJsonl(text: string, harness: string): { text: string; diagnostics: Diagnostic[] } {
  const lines = text.split('\n');
  const records: Record<string, unknown>[] = [];
  const accepted: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    let record: unknown;
    try { record = JSON.parse(line); }
    catch {
      if (i === lines.length - 1 && !text.endsWith('\n')) {
        diagnostics.push({ code: 'partial-tail', severity: 'warning', message: `Incomplete final line ${i + 1} retained in raw evidence, excluded from projection` });
        continue;
      }
      throw new Error(`Malformed JSONL at line ${i + 1}`);
    }
    if (!object(record)) throw new Error(`Expected JSON object at line ${i + 1}`);
    accepted.push(line);
    records.push(record);
  }
  // Prevent the permissive codec from inventing a random ID for an unrelated file.
  const nativeId = harness === 'claude_code'
    ? records.find(r => typeof r.sessionId === 'string')?.sessionId
    : records.find(r => r.type === 'session_meta' && object(r.payload))?.payload;
  if (harness === 'claude_code' ? typeof nativeId !== 'string' || !nativeId : !object(nativeId) || typeof nativeId.id !== 'string' || !nativeId.id) {
    throw new Error(`No recognized ${harness} session identity; unknown format preserved without indexing`);
  }
  const known = new Set(harness === 'claude_code'
    ? ['user', 'assistant', 'summary', 'custom-title', 'file-history-snapshot', 'progress', 'system', 'queue-operation']
    : ['session_meta', 'response_item', 'event_msg', 'turn_context', 'compacted']);
  const unknown = records.filter(r => typeof r.type !== 'string' || !known.has(r.type)).length;
  if (unknown) diagnostics.push({ code: 'unknown-records', severity: 'warning', message: `${unknown} unrecognized record(s) retained in raw evidence` });
  diagnostics.push({ code: 'derived-view', severity: 'warning', message: 'Normalized view may omit native bookkeeping; raw file is authoritative' });
  return { text: accepted.join('\n') + '\n', diagnostics };
}

export function builtinRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  for (const [profile, id, executable, args] of [
    [claudeCodeAdapter, 'claude_code', 'claude', ['--resume']],
    [codexAdapter, 'codex', 'codex', ['resume']],
  ] as const) {
    const adapter: SessionAdapter = {
      apiVersion: 1, id, version: '1.0.0+txcript.0.14.4', label: id === 'codex' ? 'Codex rollout' : 'Claude Code',
      formats: ['jsonl'], capabilities: { read: true, resume: true },
      discover(context) {
        if (id === 'codex' && context.env.CODEX_HOME) return [path.join(context.env.CODEX_HOME, 'sessions'), path.join(context.env.CODEX_HOME, 'archived_sessions')];
        if (id === 'claude_code' && context.env.CLAUDE_CONFIG_DIR) return [path.join(context.env.CLAUDE_CONFIG_DIR, 'projects')];
        const roots = profile.getDefaultBaseDirCandidates({ homeDir: context.homeDir });
        if (id === 'codex') roots.push(path.join(context.homeDir, '.codex', 'archived_sessions'));
        return roots;
      },
      matches: file => profile.matchesSourceFile(file) && file.endsWith('.jsonl'),
      parse(input) {
        const parsed = validateJsonl(new TextDecoder('utf-8', { fatal: true }).decode(input.bytes), id);
        return { document: decodeTranscript(parsed.text, id), diagnostics: parsed.diagnostics };
      },
      planResume: (document, cwd) => resumePlan(executable, [...args], document.nativeId, cwd),
    };
    registry.register(adapter);
  }
  registry.register({
    apiVersion: 1, id: 'gemini', version: '1.0.0-json', label: 'Gemini CLI (JSON)',
    formats: ['json; JSONL detected but not yet decoded'], capabilities: { read: true, resume: true },
    discover: context => geminiAdapter.getDefaultBaseDirCandidates({ homeDir: context.homeDir })
      .flatMap(root => geminiAdapter.getSourceRoots?.(root) ?? [root]),
    // Capture new JSONL too, but report unsupported instead of silently hiding it.
    matches: file => geminiAdapter.matchesSourceFile(file) || /^session-.*\.(json|jsonl)$/.test(path.basename(file)),
    parse(input) {
      if (input.relativePath.endsWith('.jsonl')) throw new Error('Gemini JSONL is not yet supported; raw evidence retained. Add a versioned JSONL adapter.');
      return parseGeminiJson(new TextDecoder('utf-8', { fatal: true }).decode(input.bytes));
    },
    planResume: (document, cwd) => resumePlan('gemini', ['--resume'], document.nativeId, cwd),
  });
  registry.register({
    apiVersion: 1, id: 'simple', version: '1.0.0+txcript.0.14.4', label: 'Portable Simple transcript',
    formats: ['json'], capabilities: { read: true, resume: false }, matches: file => file.endsWith('.json'),
    parse(input) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
      const raw: unknown = JSON.parse(text);
      if (!object(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.timestamp !== 'string') {
        throw new Error('Simple import requires explicit id and timestamp for repeatable indexing');
      }
      return { document: decodeTranscript(text, 'simple'), diagnostics: [{ code: 'derived-view', severity: 'warning', message: 'Raw Simple JSON retained; unknown fields may not appear in normalized view' }] };
    },
  });
  return registry;
}
