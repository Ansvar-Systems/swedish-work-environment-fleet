import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { initSchema, getSchemaVersion } from '../src/schema.js';

describe('initSchema', () => {
  let db: Database.Database;
  let tmpFile: string | undefined;

  afterEach(() => {
    db?.close();
    if (tmpFile && existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }
  });

  it('creates all tables', () => {
    db = new Database(':memory:');
    initSchema(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];

    const names = tables.map((t) => t.name);

    expect(names).toContain('regulations');
    expect(names).toContain('sections');
    expect(names).toContain('definitions');
    expect(names).toContain('cross_refs');
    expect(names).toContain('metadata');
  });

  it('creates FTS5 index', () => {
    db = new Database(':memory:');
    initSchema(db);

    const fts = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sections_fts'",
      )
      .get() as { name: string } | undefined;

    expect(fts).toBeDefined();
    expect(fts!.name).toBe('sections_fts');
  });

  it('sets journal_mode to delete', () => {
    // In-memory databases always report journal_mode=memory, so use a temp file.
    tmpFile = join(tmpdir(), `schema-test-${Date.now()}.db`);
    db = new Database(tmpFile);
    initSchema(db);

    const result = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('delete');
  });
});

describe('getSchemaVersion', () => {
  it('returns "1" after initSchema', () => {
    const db = new Database(':memory:');
    initSchema(db);

    expect(getSchemaVersion(db)).toBe('1');
    db.close();
  });
});
