import txcript from 'txcript';
import { object, type SessionDocument, type Diagnostic, validateDocument } from '../model.js';

export const TXCRIPT_VERSION = '0.14.4';
export const conversionTargets = ['simple', 'claude_code', 'codex'] as const;

export function decodeTranscript(text: string, harness: string): SessionDocument {
  const common: unknown = JSON.parse(txcript.toCommon(text, harness));
  if (!object(common) || !object(common.meta) || !Array.isArray(common.messages)) throw new Error('Unexpected txcript output');
  const meta = common.meta;
  const document: unknown = {
    schemaVersion: 1, nativeId: meta.id, title: meta.title ?? meta.id,
    ...(typeof meta.cwd === 'string' ? { cwd: meta.cwd } : {}),
    createdAt: meta.timestamp, metadata: { txcript: { version: TXCRIPT_VERSION, meta } },
    messages: common.messages.map((message: unknown) => {
      if (!object(message)) throw new Error('Invalid txcript message');
      const { role, content, timestamp, ...rest } = message;
      return { role, blocks: content, timestamp, metadata: rest };
    }),
  };
  validateDocument(document);
  return document;
}

export function convertDocument(document: SessionDocument, target: string, newId: string): { text: string; diagnostics: Diagnostic[] } {
  if (!(conversionTargets as readonly string[]).includes(target)) throw new Error(`Unvalidated conversion target: ${target}`);
  const diagnostics: Diagnostic[] = [{ code: 'lossy-conversion', severity: 'warning', message:
    'Conversation projection only. Native state, unknown fields, permissions, checkpoints, signatures and external attachments are not guaranteed to transfer. This is not a native restore.' }];
  const previous = document.metadata.txcript;
  const meta = object(previous) && object(previous.meta) ? previous.meta : {};
  const portableTypes = new Set(['text', 'thinking', 'tool_use', 'tool_result', 'image', 'artifact']);
  const messages = document.messages.flatMap((message, i) => {
    if (message.role !== 'user' && message.role !== 'assistant') {
      diagnostics.push({ code: 'omitted-role', severity: 'warning', message: `Message ${i}: role ${message.role} is not representable` });
      return [];
    }
    const blocks = message.blocks.filter((block, j) => {
      if (typeof block.type === 'string' && portableTypes.has(block.type)) return true;
      diagnostics.push({ code: 'omitted-block', severity: 'warning', message: `Message ${i}, block ${j}: unsupported type ${String(block.type)}` });
      return false;
    }).map(block => {
      if (block.type === 'thinking') {
        if (block.signature || block.encrypted) diagnostics.push({ code: 'reasoning-signature-removed', severity: 'warning', message: `Message ${i}: provider-bound reasoning data removed` });
        return { type: 'thinking', text: block.text ?? '' };
      }
      return block;
    });
    return [{ ...message.metadata, role: message.role, content: blocks, timestamp: message.timestamp ?? document.createdAt }];
  });
  const text = txcript.fromCommon(JSON.stringify({
    meta: { ...meta, id: newId, timestamp: document.createdAt, title: document.title, ...(document.cwd ? { cwd: document.cwd } : {}) }, messages,
  }), target);
  return { text, diagnostics };
}
