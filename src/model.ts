/** Public adapter ABI. Provider IDs and block types are intentionally open strings. */
export interface SessionDocument {
  schemaVersion: 1;
  nativeId: string;
  title: string;
  cwd?: string;
  createdAt: string;
  messages: Message[];
  metadata: Record<string, unknown>;
}
export interface Message {
  role: string;
  timestamp?: string;
  blocks: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}
export interface Diagnostic {
  code: string;
  message: string;
  severity: 'warning' | 'error';
  file?: string;
}
export interface DiscoveryContext { homeDir: string; env: NodeJS.ProcessEnv }
export interface ParseInput { bytes: Uint8Array; relativePath: string }
export interface ParseResult { document: SessionDocument; diagnostics: Diagnostic[] }
export interface ResumePlan {
  executable: string;
  args: string[];
  cwd: string;
  execute: false;
  notes: string[];
}
export interface SessionAdapter {
  apiVersion: 1;
  id: string;
  version: string;
  label: string;
  formats: string[];
  capabilities: { read: true; resume: boolean };
  discover?(context: DiscoveryContext): string[];
  matches(relativePath: string): boolean;
  parse(input: ParseInput): ParseResult | Promise<ParseResult>;
  planResume?(document: SessionDocument, cwd: string): ResumePlan;
}
export interface SourceConfig { id: string; adapterId: string; root: string }
export interface Capture {
  id: string;
  sourceId: string;
  relativePath: string;
  rawHash: string;
  size: number;
  adapterVersion: string;
  capturedAt: string;
  status: 'parsed' | 'error';
  diagnostics: Diagnostic[];
}
export interface StoredSession {
  id: string;
  sourceId: string;
  adapterId: string;
  captureId: string;
  document: SessionDocument;
}
export interface ArchiveCatalog {
  schemaVersion: 1;
  sources: SourceConfig[];
  captures: Capture[];
  sessions: StoredSession[];
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validateDocument(value: unknown): asserts value is SessionDocument {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.nativeId !== 'string' ||
      !value.nativeId.trim() || typeof value.title !== 'string' || typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)) || !object(value.metadata) ||
      (value.cwd !== undefined && typeof value.cwd !== 'string') || !Array.isArray(value.messages)) {
    throw new Error('Invalid session document (schemaVersion 1 required)');
  }
  for (const message of value.messages) {
    if (!object(message) || typeof message.role !== 'string' || !Array.isArray(message.blocks) ||
        !message.blocks.every(object) ||
        (message.timestamp !== undefined && (typeof message.timestamp !== 'string' || !Number.isFinite(Date.parse(message.timestamp)))) ||
        (message.metadata !== undefined && !object(message.metadata))) {
      throw new Error('Invalid message in session document');
    }
  }
}
export function searchableText(doc: SessionDocument): string {
  return [doc.title, doc.cwd ?? '', ...doc.messages.map(m => JSON.stringify(m.blocks))].join('\n');
}
