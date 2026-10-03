// TypeScript port/adaptation of CC Switch session_manager/providers/{gemini,utils}.rs
// Copyright (c) 2025 Jason Young. MIT; see LICENSE and upstreams.lock.json.
// Changes: preserve full text/unknown records, explicit diagnostics, no deletion or shell strings.
import type { Message, ParseResult, ResumePlan } from '../../src/model.js';
import { object } from '../../src/model.js';

export function timestamp(value: unknown): string | undefined {
  const millis = typeof value === 'number' ? (value > 1_000_000_000_000 ? value : value * 1000)
    : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(millis) && Math.abs(millis) <= 8.64e15 ? new Date(millis).toISOString() : undefined;
}
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(extractText).filter(Boolean).join('\n');
  if (!object(content)) return '';
  for (const key of ['text', 'input_text', 'output_text']) {
    if (typeof content[key] === 'string') return content[key];
  }
  if (content.type === 'tool_use' || content.type === 'toolCall') return `[Tool: ${String(content.name ?? 'unknown')}]`;
  return extractText(content.content);
}
export function parseGeminiJson(text: string): ParseResult {
  const data: unknown = JSON.parse(text);
  if (!object(data) || typeof data.sessionId !== 'string' || !data.sessionId || !Array.isArray(data.messages)) {
    throw new Error('Unsupported Gemini JSON: sessionId and messages required; JSONL requires a separate adapter');
  }
  const diagnostics: ParseResult['diagnostics'] = [];
  const createdAt = timestamp(data.startTime) ?? '1970-01-01T00:00:00.000Z';
  if (!timestamp(data.startTime)) diagnostics.push({ code: 'missing-time', severity: 'warning', message: 'Missing startTime; indexed at Unix epoch, raw evidence retained' });
  const messages: Message[] = data.messages.map((raw: unknown) => {
    if (!object(raw)) return { role: 'unknown', blocks: [{ type: 'opaque', raw }] };
    const role = raw.type === 'gemini' ? 'assistant' : raw.type === 'user' ? 'user' : 'unknown';
    if (role === 'unknown') diagnostics.push({ code: 'opaque-message', severity: 'warning', message: `Preserved Gemini message type: ${String(raw.type)}` });
    const content = extractText(raw.content);
    const blocks: Record<string, unknown>[] = content ? [{ type: 'text', text: content }] : [];
    // Preserve exact tool calls/results; these are deliberately not relabeled as portable tool calls.
    if (Array.isArray(raw.toolCalls)) for (const call of raw.toolCalls) blocks.push({ type: 'gemini_tool_call', raw: call });
    if (role === 'unknown' || !blocks.length) blocks.push({ type: 'opaque', raw });
    return { role, blocks, timestamp: timestamp(raw.timestamp) ?? createdAt, metadata: { native: raw } };
  });
  const first = messages.find(m => m.role === 'user');
  const title = extractText(first?.blocks) || data.sessionId;
  return { document: {
    schemaVersion: 1, nativeId: data.sessionId, title: [...title].slice(0, 160).join(''), createdAt,
    ...(typeof data.cwd === 'string' ? { cwd: data.cwd } : {}),
    messages, metadata: { native: { ...data, messages: undefined } },
  }, diagnostics };
}
export function resumePlan(executable: string, prefix: string[], nativeId: string, cwd: string): ResumePlan {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(nativeId)) throw new Error('Session ID is unsafe for native CLI resume');
  return { executable, args: [...prefix, nativeId], cwd, execute: false,
    notes: ['Plan only; original agent data and project must still exist. No program was launched.'] };
}
