import Database from 'better-sqlite3';
import type { Regulation, Section, Definition, CrossRef } from './types.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** A single FTS search hit with snippet and relevance rank. */
export interface FtsResult {
  id: string;
  regulation_id: string;
  section_type: string;
  number: string | null;
  title: string | null;
  body: string;
  regulation_title: string;
  gazette_series: string;
  snippet: string;
  rank: number;
}

/** Wrapper returned by openDatabase for controlled lifecycle. */
export interface DatabaseHandle {
  instance: Database.Database;
  close(): void;
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/** Open a read-only SQLite database at `path`. */
export function openDatabase(path: string): DatabaseHandle {
  const instance = new Database(path, { readonly: true });
  return {
    instance,
    close() {
      instance.close();
    },
  };
}

// ---------------------------------------------------------------------------
// FTS helpers
// ---------------------------------------------------------------------------

/**
 * Remove characters that break FTS5 query syntax.
 *
 * Strips operators (AND, OR, NOT, NEAR), double quotes, parentheses,
 * asterisks, carets, colons, and other FTS5 metacharacters. Returns a
 * trimmed string safe for all tiers.
 */
export function sanitizeFtsQuery(query: string): string {
  let q = query
    // Remove FTS5 column-filter prefix (e.g. "body:")
    .replace(/\b\w+:/g, '')
    // Remove special characters
    .replace(/["""(){}[\]*^~+\-!:;,.<>@#$%&|\\/?]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Remove standalone FTS5 boolean operators
  q = q
    .split(' ')
    .filter((t) => !['AND', 'OR', 'NOT', 'NEAR'].includes(t.toUpperCase()))
    .join(' ');

  return q.trim();
}

/**
 * Tiered FTS5 search with 5 fallback levels.
 *
 * 1. Exact phrase match
 * 2. AND — all terms must appear
 * 3. Prefix — each term with trailing *
 * 4. OR — any term matches
 * 5. LIKE fallback on the base sections table (no ranking)
 */
export function ftsSearch(
  db: Database.Database,
  query: string,
  limit = 20,
): FtsResult[] {
  const clean = sanitizeFtsQuery(query);
  if (!clean) return [];

  const terms = clean.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  // Tiers 1-4 use the FTS5 table with ranking.
  const ftsQuery = `
    SELECT
      s.id,
      s.regulation_id,
      s.section_type,
      s.number,
      s.title,
      s.body,
      r.title AS regulation_title,
      r.gazette_series,
      snippet(sections_fts, 0, '>>>', '<<<', '...', 48) AS snippet,
      rank
    FROM sections_fts
    JOIN sections s ON s.rowid = sections_fts.rowid
    JOIN regulations r ON r.id = s.regulation_id
    WHERE sections_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `;

  const ftsStmt = db.prepare(ftsQuery);

  // Tier 1 — exact phrase
  const phraseMatch = `"${clean}"`;
  try {
    const rows = ftsStmt.all(phraseMatch, limit) as FtsResult[];
    if (rows.length > 0) return rows;
  } catch {
    // FTS5 syntax error — fall through
  }

  // Tier 2 — AND (all terms)
  if (terms.length > 1) {
    const andMatch = terms.join(' AND ');
    try {
      const rows = ftsStmt.all(andMatch, limit) as FtsResult[];
      if (rows.length > 0) return rows;
    } catch {
      // fall through
    }
  }

  // Tier 3 — prefix
  const prefixMatch = terms.map((t) => `${t}*`).join(' OR ');
  try {
    const rows = ftsStmt.all(prefixMatch, limit) as FtsResult[];
    if (rows.length > 0) return rows;
  } catch {
    // fall through
  }

  // Tier 4 — OR (any term)
  if (terms.length > 1) {
    const orMatch = terms.join(' OR ');
    try {
      const rows = ftsStmt.all(orMatch, limit) as FtsResult[];
      if (rows.length > 0) return rows;
    } catch {
      // fall through
    }
  }

  // Tier 5 — LIKE fallback on base table
  const likePattern = `%${clean}%`;
  const likeRows = db
    .prepare(
      `
      SELECT
        s.id,
        s.regulation_id,
        s.section_type,
        s.number,
        s.title,
        s.body,
        r.title AS regulation_title,
        r.gazette_series,
        substr(s.body, 1, 200) AS snippet,
        0 AS rank
      FROM sections s
      JOIN regulations r ON r.id = s.regulation_id
      WHERE s.body LIKE ? OR s.title LIKE ?
      LIMIT ?
    `,
    )
    .all(likePattern, likePattern, limit) as FtsResult[];

  return likeRows;
}

// ---------------------------------------------------------------------------
// Single-record lookups
// ---------------------------------------------------------------------------

/** Fetch a single regulation by ID, or null if not found. */
export function getRegulation(
  db: Database.Database,
  id: string,
): Regulation | null {
  const row = db
    .prepare('SELECT * FROM regulations WHERE id = ?')
    .get(id) as Regulation | undefined;
  return row ?? null;
}

/** Fetch a single section by ID, joined with regulation title and gazette series. */
export function getSection(
  db: Database.Database,
  id: string,
): (Section & { regulation_title: string; gazette_series: string }) | null {
  const row = db
    .prepare(
      `
      SELECT s.*, r.title AS regulation_title, r.gazette_series
      FROM sections s
      JOIN regulations r ON r.id = s.regulation_id
      WHERE s.id = ?
    `,
    )
    .get(id) as
    | (Section & { regulation_title: string; gazette_series: string })
    | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// List / filtered queries
// ---------------------------------------------------------------------------

export interface ListRegulationsOpts {
  status?: string;
  subject_area?: string;
  limit?: number;
  offset?: number;
}

/** Paginated regulation list with optional status/subject_area filters. */
export function listRegulations(
  db: Database.Database,
  opts: ListRegulationsOpts = {},
): Regulation[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts.subject_area) {
    conditions.push('subject_area = ?');
    params.push(opts.subject_area);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  return db
    .prepare(`SELECT * FROM regulations ${where} ORDER BY number LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Regulation[];
}

/** LIKE search on definition term and body. */
export function getDefinitions(
  db: Database.Database,
  query: string,
): Definition[] {
  const pattern = `%${query}%`;
  return db
    .prepare(
      `SELECT * FROM definitions WHERE term LIKE ? OR definition LIKE ? ORDER BY term`,
    )
    .all(pattern, pattern) as Definition[];
}

/** All cross-references for a given regulation (joined via sections). */
export function getCrossReferences(
  db: Database.Database,
  regulationId: string,
): CrossRef[] {
  return db
    .prepare(
      `
      SELECT cr.*
      FROM cross_refs cr
      JOIN sections s ON s.id = cr.source_section_id
      WHERE s.regulation_id = ?
      ORDER BY cr.id
    `,
    )
    .all(regulationId) as CrossRef[];
}

/** All sections for a regulation, ordered by sort_order. */
export function getRegulationSections(
  db: Database.Database,
  regulationId: string,
): Section[] {
  return db
    .prepare(
      `SELECT * FROM sections WHERE regulation_id = ? ORDER BY sort_order`,
    )
    .all(regulationId) as Section[];
}

// ---------------------------------------------------------------------------
// Metadata / counts
// ---------------------------------------------------------------------------

/** Read a single value from the metadata table. */
export function getMetadata(
  db: Database.Database,
  key: string,
): string | undefined {
  const row = db
    .prepare('SELECT value FROM metadata WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

/** Count regulations, optionally filtered by status. */
export function regulationCount(
  db: Database.Database,
  status?: string,
): number {
  if (status) {
    const row = db
      .prepare('SELECT COUNT(*) AS cnt FROM regulations WHERE status = ?')
      .get(status) as { cnt: number };
    return row.cnt;
  }
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM regulations')
    .get() as { cnt: number };
  return row.cnt;
}

/** Total number of sections in the database. */
export function sectionCount(db: Database.Database): number {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM sections')
    .get() as { cnt: number };
  return row.cnt;
}
