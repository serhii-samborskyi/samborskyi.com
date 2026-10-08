import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, types, type PoolClient } from 'pg';

// All BIGINT values in this schema are counts or millisecond timestamps within JS's safe range.
types.setTypeParser(20, (value) => Number(value));
type Row = Record<string, unknown>;
type Parameter = string | number | null | Uint8Array;
export const dataDir = () =>
  path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || 'data');

const schema = `
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, size BIGINT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('audio','image')), created_at BIGINT NOT NULL, content BYTEA);
CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, duration DOUBLE PRECISION NOT NULL DEFAULT 0, audio_id TEXT NOT NULL REFERENCES uploads(id), artwork_id TEXT REFERENCES uploads(id), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')), created_at BIGINT NOT NULL, published_at BIGINT);
CREATE INDEX IF NOT EXISTS idx_releases_status_date ON releases(status,published_at DESC);
CREATE TABLE IF NOT EXISTS subscribers (id TEXT PRIMARY KEY, channel TEXT NOT NULL CHECK(channel IN ('email','telegram','push')), address TEXT NOT NULL, data TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','unsubscribed')), confirm_nonce TEXT NOT NULL, created_at BIGINT NOT NULL, confirmed_at BIGINT, last_confirmation BIGINT NOT NULL DEFAULT 0, UNIQUE(channel,address));
CREATE INDEX IF NOT EXISTS idx_subscribers_status_channel ON subscribers(status,channel);
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES releases(id), subscriber_id TEXT NOT NULL REFERENCES subscribers(id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','skipped')), attempts INTEGER NOT NULL DEFAULT 0, next_attempt BIGINT NOT NULL DEFAULT 0, last_error TEXT, sent_at BIGINT, UNIQUE(release_id,subscriber_id));
CREATE INDEX IF NOT EXISTS idx_deliveries_queue ON deliveries(status,next_attempt);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, type TEXT NOT NULL, release_id TEXT, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_created_type ON events(created_at,type);
CREATE TABLE IF NOT EXISTS event_dedupe (key TEXT PRIMARY KEY, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL);
`;

export function postgresSql(input: string) {
  let sql = input.trim().replace(/;$/, '');
  if (/^INSERT OR IGNORE INTO /i.test(sql))
    sql = sql.replace(/^INSERT OR IGNORE INTO /i, 'INSERT INTO ') + ' ON CONFLICT DO NOTHING';
  let index = 0,
    quoted = false,
    output = '';
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'") {
      if (quoted && sql[i + 1] === "'") {
        output += "''";
        i++;
        continue;
      }
      quoted = !quoted;
    }
    output += char === '?' && !quoted ? `$${++index}` : char;
  }
  return output;
}

class Database {
  readonly postgres: boolean;
  private pool?: Pool;
  private sqlite?: DatabaseSync;
  private ready?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private scope = new AsyncLocalStorage<PoolClient | 'sqlite'>();
  constructor(private url: string) {
    this.postgres = /^postgres(ql)?:\/\//.test(url);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
  async initialize() {
    if (!this.ready)
      this.ready = this.migrate().catch((error) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }
  private async migrate() {
    if (this.postgres) {
      this.pool ??= new Pool({
        connectionString: this.url,
        max: 5,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
      });
      this.pool.on('error', () => console.error('A database connection was interrupted.'));
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(824762001)');
        for (const sql of schema
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean))
          await client.query(sql);
        await client.query('ALTER TABLE uploads ADD COLUMN IF NOT EXISTS content BYTEA');
        await client.query(
          'INSERT INTO schema_migrations(version,applied_at) VALUES(2,$1) ON CONFLICT DO NOTHING',
          [Date.now()],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      const filename = this.url.startsWith('file:')
        ? this.url.startsWith('file://')
          ? fileURLToPath(this.url)
          : path.resolve(/* turbopackIgnore: true */ this.url.slice(5))
        : this.url;
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      this.sqlite = new DatabaseSync(filename);
      this.sqlite.exec(
        'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE',
      );
      try {
        this.sqlite.exec(schema);
        const columns = this.sqlite.prepare('PRAGMA table_info(uploads)').all();
        if (!columns.some((column) => column.name === 'content'))
          this.sqlite.exec('ALTER TABLE uploads ADD COLUMN content BLOB');
        this.sqlite
          .prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,?)')
          .run(Date.now());
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        this.sqlite.close();
        this.sqlite = undefined;
        throw error;
      }
    }
  }
  prepare(sql: string) {
    return {
      get: async (...params: Parameter[]): Promise<Row | undefined> =>
        (await this.query(sql, params, true)).rows[0],
      all: async (...params: Parameter[]): Promise<Row[]> =>
        (await this.query(sql, params, true)).rows,
      run: async (...params: Parameter[]): Promise<{ changes: number }> => ({
        changes: (await this.query(sql, params, false)).changes,
      }),
    };
  }
  private async query(sql: string, params: Parameter[], read: boolean) {
    await this.initialize();
    const current = this.scope.getStore();
    if (this.postgres) {
      const client = current && current !== 'sqlite' ? current : this.pool!;
      const result = await client.query(postgresSql(sql), params);
      return { rows: result.rows as Row[], changes: result.rowCount || 0 };
    }
    const run = async () => {
      const statement = this.sqlite!.prepare(sql);
      if (read)
        return {
          rows: statement.all(...(params as SQLInputValue[])).map((row) => ({ ...row })),
          changes: 0,
        };
      const result = statement.run(...(params as SQLInputValue[]));
      return { rows: [] as Row[], changes: Number(result.changes) };
    };
    return current === 'sqlite' ? run() : this.exclusive(run);
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.initialize();
    if (this.scope.getStore()) return fn();
    if (this.postgres) {
      const client = await this.pool!.connect();
      try {
        await client.query('BEGIN');
        const result = await this.scope.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return this.exclusive(async () => {
      this.sqlite!.exec('BEGIN IMMEDIATE');
      try {
        const result = await this.scope.run('sqlite', fn);
        this.sqlite!.exec('COMMIT');
        return result;
      } catch (error) {
        this.sqlite!.exec('ROLLBACK');
        throw error;
      }
    });
  }
  async lock(key: number) {
    if (this.postgres) {
      if (!this.scope.getStore()) throw new Error('Database locks require a transaction.');
      await this.prepare('SELECT pg_advisory_xact_lock(?)').get(key);
    }
  }
  async close() {
    await this.tail;
    this.sqlite?.close();
    await this.pool?.end();
    databases.delete(this.url);
  }
}
const databases = new Map<string, Database>();
export function db() {
  const url = process.env.DATABASE_URL || path.join(dataDir(), 'studio.sqlite');
  if (process.env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(url) && !url.startsWith('file:'))
    throw new Error('DATABASE_URL must be a PostgreSQL URL or a file: SQLite URL.');
  if (!databases.has(url)) databases.set(url, new Database(url));
  return databases.get(url)!;
}
export const transaction = <T>(fn: () => Promise<T>) => db().transaction(fn);
