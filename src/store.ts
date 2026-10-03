import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, lstatSync, realpathSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { identity } from './files.js';
import { searchableText, type SourceConfig, type Capture, type StoredSession, type SessionDocument, type ArchiveCatalog } from './model.js';

/** Manager-owned state only. Never open a provider database through this class. */
export class SessionStore {
  readonly root: string;
  private readonly db: DatabaseSync;
  constructor(root: string) {
    if (existsSync(path.join(root, '.asm-incomplete'))) throw new Error('Incomplete publication; do not open as a manager store');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
    const file = path.join(this.root, 'index.sqlite');
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('Index must not be a symlink');
    this.db = new DatabaseSync(file);
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (version !== 0 && version !== 1) throw new Error(`Unsupported store schema ${version}; upgrade application first`);
      if (version === 0) {
        if (Number(this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()!.n)) throw new Error('Refusing to initialize an unrecognized database');
        this.db.exec(`BEGIN;
          CREATE TABLE sources (id TEXT PRIMARY KEY, json TEXT NOT NULL);
          CREATE TABLE captures (id TEXT PRIMARY KEY, json TEXT NOT NULL);
          CREATE TABLE sessions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, json TEXT NOT NULL, text TEXT NOT NULL);
          CREATE VIRTUAL TABLE session_fts USING fts5(session_id UNINDEXED, text, tokenize='trigram');
          PRAGMA user_version=1;
          COMMIT;`);
      }
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
      chmodSync(file, 0o600);
    } catch (error) { this.db.close(); throw error; }
  }
  close(): void { this.db.close(); }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  source(id: string): SourceConfig | undefined {
    const row = this.db.prepare('SELECT json FROM sources WHERE id=?').get(id);
    return row ? JSON.parse(String(row.json)) as SourceConfig : undefined;
  }
  registerSource(source: SourceConfig): void {
    this.transaction(() => {
      const previous = this.source(source.id);
      if (previous && (previous.root !== source.root || previous.adapterId !== source.adapterId)) throw new Error('Source ID already belongs to a different root or adapter; choose a new ID');
      this.db.prepare('INSERT OR IGNORE INTO sources VALUES (?,?)').run(source.id, JSON.stringify(source));
    });
  }
  capture(id: string): Capture {
    const row = this.db.prepare('SELECT json FROM captures WHERE id=?').get(id);
    if (!row) throw new Error(`Unknown capture: ${id}`);
    return JSON.parse(String(row.json)) as Capture;
  }
  get(id: string): StoredSession {
    const row = this.db.prepare('SELECT json FROM sessions WHERE id=?').get(id);
    if (!row) throw new Error(`Unknown session: ${id}`);
    return JSON.parse(String(row.json)) as StoredSession;
  }
  record(capture: Capture, document?: SessionDocument): StoredSession | undefined {
    return this.transaction(() => {
      const source = this.source(capture.sourceId);
      if (!source) throw new Error('Source must be registered before capture');
      // A transient reparse failure must not invalidate evidence referenced by a good view.
      if (!document && capture.status === 'error') {
        const previous = this.db.prepare('SELECT json FROM captures WHERE id=?').get(capture.id);
        if (previous) {
          const saved = JSON.parse(String(previous.json)) as Capture;
          if (saved.status === 'parsed') capture = { ...saved, diagnostics: capture.diagnostics };
        }
      }
      let session: StoredSession | undefined;
      if (document) {
        const id = identity(source.id, document.nativeId);
        const row = this.db.prepare('SELECT json FROM sessions WHERE id=?').get(id);
        if (row) {
          const existing = JSON.parse(String(row.json)) as StoredSession;
          const oldCapture = this.capture(existing.captureId);
          if (oldCapture.relativePath !== capture.relativePath) throw new Error('Conflicting native session ID in two source files; use separate source IDs');
        }
        session = { id, sourceId: source.id, adapterId: source.adapterId, captureId: capture.id, document };
      }
      this.db.prepare('INSERT INTO captures VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(capture.id, JSON.stringify(capture));
      if (session) this.writeSession(session);
      return session;
    });
  }
  private writeSession(session: StoredSession): void {
    const text = searchableText(session.document);
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,text=excluded.text')
      .run(session.id, session.sourceId, JSON.stringify(session), text);
    this.db.prepare('DELETE FROM session_fts WHERE session_id=?').run(session.id);
    this.db.prepare('INSERT INTO session_fts VALUES (?,?)').run(session.id, text);
  }
  list(options: { query?: string; sourceId?: string; limit?: number } = {}): StoredSession[] {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('limit must be 1..10000');
    const query = options.query ?? '';
    const useIndex = [...query].length >= 3 && !query.includes('\0');
    const predicates: string[] = [];
    const params: (string | number)[] = [];
    if (query) {
      predicates.push(useIndex ? 'id IN (SELECT session_id FROM session_fts WHERE session_fts MATCH ?)' : 'instr(lower(text),lower(?)) > 0');
      params.push(useIndex ? `"${query.replaceAll('"', '""')}"` : query);
    }
    if (options.sourceId) { predicates.push('source_id=?'); params.push(options.sourceId); }
    params.push(limit);
    return this.db.prepare(`SELECT json FROM sessions ${predicates.length ? 'WHERE ' + predicates.join(' AND ') : ''}
      ORDER BY json_extract(json,'$.document.createdAt') DESC, id LIMIT ?`).all(...params)
      .map(row => JSON.parse(String(row.json)) as StoredSession);
  }
  catalog(): ArchiveCatalog {
    return this.transaction(() => ({
      schemaVersion: 1,
      sources: this.db.prepare('SELECT json FROM sources ORDER BY id').all().map(r => JSON.parse(String(r.json)) as SourceConfig),
      captures: this.db.prepare('SELECT json FROM captures ORDER BY id').all().map(r => JSON.parse(String(r.json)) as Capture),
      sessions: this.db.prepare('SELECT json FROM sessions ORDER BY id').all().map(r => JSON.parse(String(r.json)) as StoredSession),
    }));
  }
  /** Restore has already validated the catalog, and always owns a fresh store. */
  importCatalog(catalog: ArchiveCatalog): void {
    this.transaction(() => {
      if (Number(this.db.prepare('SELECT count(*) AS n FROM sources').get()!.n)) throw new Error('Restore requires an empty store');
      for (const source of catalog.sources) this.db.prepare('INSERT INTO sources VALUES (?,?)').run(source.id, JSON.stringify(source));
      for (const capture of catalog.captures) this.db.prepare('INSERT INTO captures VALUES (?,?)').run(capture.id, JSON.stringify(capture));
      for (const session of catalog.sessions) this.writeSession(session);
    });
  }
}
