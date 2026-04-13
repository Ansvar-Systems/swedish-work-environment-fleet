#!/usr/bin/env tsx
/**
 * Ingestion script for Boverket (BFS) regulations.
 *
 * Fetches the Boverket regulation index, scrapes each regulation page,
 * and builds a SQLite database with FTS5 search.
 *
 * Usage:
 *   npx tsx src/ingest.ts [--force] [--fetch-only] [--diff-only]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
  initSchema,
  parseRegulationPage,
  extractDefinitions,
  extractCrossReferences,
  stripHtml,
} from '@ansvar/swe-fleet-core';
import { CONFIG, BOVERKET_API_BASE, BOVERKET_API_KEY } from './config.js';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const FETCH_ONLY = args.includes('--fetch-only');
const DIFF_ONLY = args.includes('--diff-only');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(import.meta.dirname ?? '.', '../data');
const DB_PATH = path.join(DATA_DIR, 'database.db');
const HASHES_PATH = path.join(DATA_DIR, '.source-hashes.json');
const CENSUS_PATH = path.join(DATA_DIR, 'census.json');
const COVERAGE_PATH = path.join(DATA_DIR, 'coverage.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function loadHashes(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(HASHES_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveHashes(hashes: Record<string, string>): void {
  fs.writeFileSync(HASHES_PATH, JSON.stringify(hashes, null, 2));
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AnsvarMCP/0.1 (https://ansvar.eu; data-ingestion)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'sv,en;q=0.5',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RegulationLink {
  id: string;
  number: string;
  url: string;
  title: string;
  status?: string;
  issuedDate?: string | null;
  effectiveDate?: string | null;
}

// ---------------------------------------------------------------------------
// Boverket REST API ingestion (preferred path)
// ---------------------------------------------------------------------------

/** Metadata object returned by GET /forfattningar */
interface BoverketApiRegulation {
  id: string;
  forfattning: string;
  grundforfattning?: string;
  typ: string;
  titel: string;
  forkortning?: string;
  beslutad?: string;
  trycklovad?: string;
  ikraft?: string;
  upphavd?: string | null;
  dokumentlank?: string;
  apiHarFulltext?: boolean;
  apiHarAndringar?: boolean;
}

/** Structured content section from GET /forfattningar/{id}/innehall */
interface BoverketApiSection {
  kategori: string;
  egenskaper?: {
    paragraf?: string;
    rubrik?: string;
    niva?: number;
  };
  block?: Array<{
    typ: string;
    format: string;
    data: string;
  }>;
  underavsnitt?: BoverketApiSection[];
}

async function fetchApiJson<T>(path: string): Promise<T> {
  const url = `${BOVERKET_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AnsvarMCP/0.1 (https://ansvar.eu; data-ingestion)',
      'Accept': 'application/json',
      'Ocp-Apim-Subscription-Key': BOVERKET_API_KEY,
    },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} fetching ${url}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function fetchRegulationListFromApi(): Promise<RegulationLink[]> {
  // Fetch in-force grundforfattning only (exclude repealed)
  const regs = await fetchApiJson<BoverketApiRegulation[]>(
    '/forfattningar?upphavd=nej',
  );

  return regs.map((r) => ({
    id: r.id,
    number: r.forfattning,
    url: r.dokumentlank ?? `${CONFIG.indexUrl}`,
    title: r.titel,
    status: r.upphavd ? 'repealed' : 'in_force',
    issuedDate: r.beslutad ?? null,
    effectiveDate: r.ikraft ?? null,
  }));
}

async function fetchRegulationContentFromApi(
  regId: string,
): Promise<string> {
  // Fetch HTML content for structured parsing
  const res = await fetch(
    `${BOVERKET_API_BASE}/forfattningar/${regId}/innehall/html`,
    {
      headers: {
        'User-Agent': 'AnsvarMCP/0.1 (https://ansvar.eu; data-ingestion)',
        'Accept': 'text/html',
        'Ocp-Apim-Subscription-Key': BOVERKET_API_KEY,
      },
    },
  );
  if (!res.ok) {
    // If HTML endpoint fails (e.g. PDF-only regulation), return empty
    return '';
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Legacy HTML scrape fallback (no longer works — Blazor Server app)
// ---------------------------------------------------------------------------

/**
 * @deprecated Boverket moved to a Blazor Server app in 2025.
 * The HTML listing page no longer contains static content.
 * This function is kept for reference but will return an empty array.
 */
function parseIndexPage(html: string): RegulationLink[] {
  const links: RegulationLink[] = [];
  const seen = new Set<string>();

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = stripHtml(match[2]);

    // Look for BFS YYYY:N pattern
    const bfsMatch = text.match(/BFS\s+(\d{4}:\d+)/i);
    if (!bfsMatch) continue;

    const number = bfsMatch[1];
    const id = `BFS-${number.replace(':', '-')}`;

    if (seen.has(id)) continue;
    seen.add(id);

    const absoluteUrl = href.startsWith('http')
      ? href
      : new URL(href, CONFIG.indexUrl).toString();

    const titleMatch = text.match(/BFS\s+\d{4}:\d+[,\s]*[-–—]\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : text.trim();

    links.push({ id, number, url: absoluteUrl, title });
  }

  return links;
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let regulationLinks: RegulationLink[];
  let useApi = false;

  // -----------------------------------------------------------------------
  // Choose ingestion path: API (preferred) or HTML scrape (legacy fallback)
  // -----------------------------------------------------------------------
  if (BOVERKET_API_KEY) {
    console.log('BOVERKET_API_KEY set — using Boverket REST API.');
    useApi = true;
    regulationLinks = await fetchRegulationListFromApi();
    console.log(`API returned ${regulationLinks.length} regulations.`);
  } else {
    console.log(
      'BOVERKET_API_KEY not set — attempting HTML scrape (legacy path).',
    );
    console.log(`Fetching index: ${CONFIG.indexUrl}`);
    const indexHtml = await fetchPage(CONFIG.indexUrl);
    regulationLinks = parseIndexPage(indexHtml);
    console.log(`Found ${regulationLinks.length} regulations on index page.`);
  }

  if (regulationLinks.length === 0) {
    console.error(
      'No regulations found.\n' +
        '\n' +
        'Boverket moved their regulation listing to a Blazor Server app at\n' +
        'forfattningssamling.boverket.se which cannot be scraped with HTTP fetch.\n' +
        '\n' +
        'To ingest BFS regulations, register for a free API key at:\n' +
        '  https://api-portal.boverket.se/\n' +
        '\n' +
        'Then set BOVERKET_API_KEY in your environment and re-run.\n' +
        'See config.ts for API documentation links.',
    );
    process.exit(1);
  }

  if (FETCH_ONLY) {
    console.log('--fetch-only: printing links and exiting.');
    for (const link of regulationLinks) {
      console.log(`  ${link.id}: ${link.title} -> ${link.url}`);
    }
    process.exit(0);
  }

  const prevHashes = loadHashes();
  const newHashes: Record<string, string> = {};

  const pages: Array<{ link: RegulationLink; html: string; changed: boolean }> = [];

  for (const link of regulationLinks) {
    console.log(`  Fetching ${link.id}: ${useApi ? '(API)' : link.url}`);
    try {
      const html = useApi
        ? await fetchRegulationContentFromApi(link.id)
        : await fetchPage(link.url);
      const hash = sha256(html);
      newHashes[link.id] = hash;

      const changed = FORCE || prevHashes[link.id] !== hash;
      pages.push({ link, html, changed });

      if (!changed) {
        console.log(`    (unchanged)`);
      }
    } catch (err) {
      console.error(`    ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (DIFF_ONLY) {
    const changedCount = pages.filter((p) => p.changed).length;
    console.log(`\n--diff-only: ${changedCount}/${pages.length} regulations changed.`);
    for (const p of pages.filter((pg) => pg.changed)) {
      console.log(`  CHANGED: ${p.link.id}`);
    }
    saveHashes(newHashes);
    process.exit(0);
  }

  console.log(`\nBuilding database at ${DB_PATH}`);
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  initSchema(db);

  const insertReg = db.prepare(`
    INSERT OR REPLACE INTO regulations
      (id, agency, gazette_series, number, title, subject_area, status,
       issued_date, effective_date, repealed_date, amends, amended_by,
       sfs_basis, eu_basis, source_url, license_basis, fetched_at)
    VALUES
      (@id, @agency, @gazette_series, @number, @title, @subject_area, @status,
       @issued_date, @effective_date, @repealed_date, @amends, @amended_by,
       @sfs_basis, @eu_basis, @source_url, @license_basis, @fetched_at)
  `);

  const insertSec = db.prepare(`
    INSERT OR REPLACE INTO sections
      (id, regulation_id, section_type, number, title, body, parent_id, sort_order)
    VALUES
      (@id, @regulation_id, @section_type, @number, @title, @body, @parent_id, @sort_order)
  `);

  const insertDef = db.prepare(`
    INSERT INTO definitions (regulation_id, term, definition, section_id)
    VALUES (@regulation_id, @term, @definition, @section_id)
  `);

  const insertXref = db.prepare(`
    INSERT INTO cross_refs (source_section_id, target_type, target_id, target_label)
    VALUES (@source_section_id, @target_type, @target_id, @target_label)
  `);

  const now = new Date().toISOString();
  let totalSections = 0;
  let totalDefinitions = 0;
  let totalCrossRefs = 0;

  const insertAll = db.transaction(() => {
    for (const { link, html } of pages) {
      insertReg.run({
        id: link.id,
        agency: CONFIG.agency,
        gazette_series: CONFIG.gazette,
        number: link.number,
        title: link.title,
        subject_area: null,
        status: link.status ?? 'in_force',
        issued_date: link.issuedDate ?? null,
        effective_date: link.effectiveDate ?? null,
        repealed_date: null,
        amends: null,
        amended_by: null,
        sfs_basis: CONFIG.sfsBasis,
        eu_basis: null,
        source_url: link.url,
        license_basis: CONFIG.defaultLicense,
        fetched_at: now,
      });

      const sections = parseRegulationPage(html, link.id);
      for (const sec of sections) {
        insertSec.run(sec);
      }
      totalSections += sections.length;

      const defs = extractDefinitions(html, link.id);
      for (const def of defs) {
        insertDef.run({
          regulation_id: def.regulation_id,
          term: def.term,
          definition: def.definition,
          section_id: null,
        });
      }
      totalDefinitions += defs.length;

      // Only extract and insert cross-refs if we have sections
      if (sections.length > 0) {
        const xrefs = extractCrossReferences(html, link.id);
        for (const xref of xrefs) {
          insertXref.run({
            source_section_id: sections[0].id,
            target_type: xref.target_type,
            target_id: xref.target_id,
            target_label: null,
          });
        }
        totalCrossRefs += xrefs.length;
      }
    }

    db.exec(`
      INSERT INTO sections_fts (rowid, body, title, regulation_title, gazette_series)
      SELECT s.rowid, s.body, s.title, r.title, r.gazette_series
      FROM sections s
      JOIN regulations r ON r.id = s.regulation_id
    `);

    db.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_ingest', ?)",
    ).run(now);
    db.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('agency', ?)",
    ).run(CONFIG.agency);
  });

  insertAll();
  db.close();

  saveHashes(newHashes);

  const census = {
    agency: CONFIG.agency,
    gazette: CONFIG.gazette,
    regulations: pages.length,
    sections: totalSections,
    definitions: totalDefinitions,
    cross_references: totalCrossRefs,
    ingested_at: now,
  };
  fs.writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2));

  const coverage = {
    jurisdiction: 'SE',
    agency: CONFIG.agency,
    gazette: CONFIG.gazette,
    total_regulations: pages.length,
    in_force: pages.length,
    repealed: 0,
    total_sections: totalSections,
    total_definitions: totalDefinitions,
    total_cross_references: totalCrossRefs,
    source_url: CONFIG.indexUrl,
    generated_at: now,
  };
  fs.writeFileSync(COVERAGE_PATH, JSON.stringify(coverage, null, 2));

  console.log(`\nIngestion complete.`);
  console.log(`  Regulations: ${pages.length}`);
  console.log(`  Sections:    ${totalSections}`);
  console.log(`  Definitions: ${totalDefinitions}`);
  console.log(`  Cross-refs:  ${totalCrossRefs}`);
  console.log(`  Database:    ${DB_PATH}`);
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
