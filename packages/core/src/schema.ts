import type Database from 'better-sqlite3';

/**
 * Initialise the database schema for a Swedish work-environment MCP.
 *
 * Creates all tables, the FTS5 virtual table, and seeds the
 * schema_version metadata row. Safe to call on an already-initialised
 * database — uses IF NOT EXISTS throughout.
 */
export function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS regulations (
      id TEXT PRIMARY KEY,
      agency TEXT NOT NULL,
      gazette_series TEXT NOT NULL,
      number TEXT NOT NULL,
      title TEXT NOT NULL,
      subject_area TEXT,
      status TEXT NOT NULL DEFAULT 'in_force',
      issued_date TEXT,
      effective_date TEXT,
      repealed_date TEXT,
      amends TEXT,
      amended_by TEXT,
      sfs_basis TEXT,
      eu_basis TEXT,
      source_url TEXT NOT NULL,
      license_basis TEXT NOT NULL DEFAULT 'psi_oppen_data',
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      regulation_id TEXT NOT NULL REFERENCES regulations(id),
      section_type TEXT NOT NULL,
      number TEXT,
      title TEXT,
      body TEXT NOT NULL,
      parent_id TEXT REFERENCES sections(id),
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      regulation_id TEXT NOT NULL REFERENCES regulations(id),
      term TEXT NOT NULL,
      definition TEXT NOT NULL,
      section_id TEXT REFERENCES sections(id)
    );

    CREATE TABLE IF NOT EXISTS cross_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_section_id TEXT NOT NULL REFERENCES sections(id),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_label TEXT
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // FTS5 virtual table — CREATE VIRTUAL TABLE does not support IF NOT EXISTS,
  // so guard with a table-existence check.
  const ftsExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sections_fts'",
    )
    .get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE sections_fts USING fts5(
        body,
        title,
        regulation_title,
        gazette_series,
        content='sections',
        content_rowid='rowid',
        tokenize='unicode61'
      );
    `);
  }

  // Seed schema version (idempotent).
  db.prepare(
    "INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '1')",
  ).run();
}

/** Read the schema_version from the metadata table. */
export function getSchemaVersion(db: Database.Database): string | undefined {
  const row = db
    .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  return row?.value;
}
