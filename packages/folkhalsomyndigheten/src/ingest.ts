#!/usr/bin/env tsx
/**
 * Ingestion script for Folkhalsomyndigheten (FoHMFS) regulations.
 *
 * Fetches the FoHM regulation index, scrapes each regulation page,
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
import { CONFIG } from './config.js';

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
// Index page parsing — extract links to individual FoHMFS regulations
// ---------------------------------------------------------------------------

interface RegulationLink {
  id: string;
  number: string;
  url: string;
  title: string;
}

function parseIndexPage(html: string): RegulationLink[] {
  const links: RegulationLink[] = [];
  const seen = new Set<string>();

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = stripHtml(match[2]);

    // Look for HSLF-FS, FoHMFS, or FHIFS YYYY:N pattern
    const fohmfsMatch = text.match(/(HSLF-FS|FoHMFS|FHIFS)\s+(\d{4}:\d+)/i);
    if (!fohmfsMatch) continue;

    const series = fohmfsMatch[1].toUpperCase();
    const number = fohmfsMatch[2];
    const id = `${series}-${number.replace(':', '-')}`;

    if (seen.has(id)) continue;
    seen.add(id);

    const absoluteUrl = href.startsWith('http')
      ? href
      : new URL(href, CONFIG.indexUrl).toString();

    const titleMatch = text.match(/(?:HSLF-FS|FoHMFS|FHIFS)\s+\d{4}:\d+[,\s]*[-–—]\s*(.+)/i);
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

  console.log(`Fetching index: ${CONFIG.indexUrl}`);
  const indexHtml = await fetchPage(CONFIG.indexUrl);
  const regulationLinks = parseIndexPage(indexHtml);
  console.log(`Found ${regulationLinks.length} regulations on index page.`);

  if (regulationLinks.length === 0) {
    console.error('No regulations found on index page — aborting.');
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
    console.log(`  Fetching ${link.id}: ${link.url}`);
    try {
      const html = await fetchPage(link.url);
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
        status: 'in_force',
        issued_date: null,
        effective_date: null,
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
