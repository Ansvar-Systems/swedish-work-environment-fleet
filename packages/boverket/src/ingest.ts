#!/usr/bin/env tsx
/**
 * Ingestion script for Boverket (BFS) regulations via their open REST API.
 *
 * The API is fully open — no auth required.
 * Docs: https://api-portal.boverket.se/
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
  extractCrossReferences,
  stripHtml,
} from '@ansvar/swe-fleet-core';
import { CONFIG, BOVERKET_API_BASE } from './config.js';

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

async function fetchApi<T>(endpoint: string): Promise<T> {
  const url = `${BOVERKET_API_BASE}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AnsvarMCP/0.1 (https://ansvar.eu; data-ingestion)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} at ${url}`);
  }
  return res.json() as Promise<T>;
}

async function fetchApiText(endpoint: string): Promise<string> {
  const url = `${BOVERKET_API_BASE}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AnsvarMCP/0.1 (https://ansvar.eu; data-ingestion)',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) return '';
  return res.text();
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface BoverketRegulation {
  id: string;
  forfattning: string;
  grundforfattning?: string;
  typ: string;
  titel: string;
  forkortning?: string;
  beslutad?: string;
  trycklovad?: string;
  ikraft?: string;
  upphavdDatum?: string | null;
  upphavdAv?: string | null;
  dokumentlank?: string;
  apiHarFulltext?: boolean;
  apiHarAndringar?: boolean;
}

interface BoverketSection {
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
  underavsnitt?: BoverketSection[];
}

// ---------------------------------------------------------------------------
// Structured content parser
// ---------------------------------------------------------------------------

interface ParsedSection {
  id: string;
  regulation_id: string;
  section_type: string;
  number: string | null;
  title: string | null;
  body: string;
  parent_id: string | null;
  sort_order: number;
}

function parseStructuredContent(
  sections: BoverketSection[],
  regulationId: string,
  parentId: string | null = null,
  startOrder = 0,
): ParsedSection[] {
  const result: ParsedSection[] = [];
  let order = startOrder;

  for (const sec of sections) {
    order++;
    const kategori = sec.kategori ?? 'unknown';
    const paragraf = sec.egenskaper?.paragraf ?? null;
    const rubrik = sec.egenskaper?.rubrik ?? null;

    // Map Boverket categories to our section types
    let sectionType: string;
    switch (kategori) {
      case 'foreskrift':
        sectionType = 'paragraph';
        break;
      case 'allmant_rad':
        sectionType = 'advice';
        break;
      case 'kapitel':
      case 'avdelning':
        sectionType = 'chapter';
        break;
      case 'avsnitt':
      case 'underavsnitt':
        sectionType = 'section';
        break;
      case 'bilaga':
        sectionType = 'appendix';
        break;
      case 'tabell':
        sectionType = 'table';
        break;
      default:
        sectionType = kategori;
    }

    // Build body from blocks
    let body = '';
    if (sec.block && sec.block.length > 0) {
      const parts: string[] = [];
      for (const block of sec.block) {
        if (!block.data) continue;
        if (block.format === 'html') {
          parts.push(stripHtml(block.data));
        } else {
          parts.push(block.data);
        }
      }
      body = parts.join('\n\n').trim();
    }

    // Skip empty sections
    if (!body && !rubrik && !sec.underavsnitt?.length) continue;

    const sectionId = paragraf
      ? `${regulationId}/p-${paragraf.replace(/\s+/g, '-')}`
      : `${regulationId}/${sectionType}-${order}`;

    result.push({
      id: sectionId,
      regulation_id: regulationId,
      section_type: sectionType,
      number: paragraf,
      title: rubrik,
      body: body || rubrik || '',
      parent_id: parentId,
      sort_order: order,
    });

    // Recurse into underavsnitt
    if (sec.underavsnitt && sec.underavsnitt.length > 0) {
      const children = parseStructuredContent(
        sec.underavsnitt,
        regulationId,
        sectionId,
        order * 100,
      );
      result.push(...children);
      order += children.length;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Fetch regulation list
  console.log('Fetching regulation list from Boverket API...');
  const allRegs = await fetchApi<BoverketRegulation[]>('/forfattningar');
  const notRepealed = allRegs.filter(r => !r.upphavdDatum);
  const withFulltext = allRegs.filter(r => r.apiHarFulltext);
  const activeWithFulltext = notRepealed.filter(r => r.apiHarFulltext);
  console.log(`API returned ${allRegs.length} total, ${notRepealed.length} active, ${withFulltext.length} with fulltext (${activeWithFulltext.length} active+fulltext).`);
  // Ingest all active regulations — those with fulltext get sections, others get metadata only
  const activeRegs = notRepealed;

  if (FETCH_ONLY) {
    console.log('--fetch-only: printing regulations and exiting.');
    for (const r of activeRegs) {
      console.log(`  ${r.id}: ${r.forfattning} — ${r.titel}`);
    }
    process.exit(0);
  }

  // Fetch content for each regulation
  const prevHashes = loadHashes();
  const newHashes: Record<string, string> = {};

  interface RegPage {
    reg: BoverketRegulation;
    sections: BoverketSection[];
    html: string;
    changed: boolean;
  }
  const pages: RegPage[] = [];

  // Fetch content in parallel batches of 20
  const BATCH_SIZE = 20;
  for (let batchStart = 0; batchStart < activeRegs.length; batchStart += BATCH_SIZE) {
    const batch = activeRegs.slice(batchStart, batchStart + BATCH_SIZE);
    const batchEnd = Math.min(batchStart + BATCH_SIZE, activeRegs.length);
    console.log(`  Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: fetching ${batchStart + 1}-${batchEnd} of ${activeRegs.length}`);

    const batchResults = await Promise.allSettled(
      batch.map(async (reg) => {
        let sections: BoverketSection[] = [];
        let html = '';

        // Only fetch content for regulations that have structured fulltext
        if (reg.apiHarFulltext) {
          try {
            // API returns a single root object, not an array
            const root = await fetchApi<BoverketSection>(`/forfattningar/${reg.id}/innehall`);
            // Flatten: use underavsnitt as the section list, or wrap root in array
            sections = root.underavsnitt ?? [root];
          } catch {
            // Content endpoint failed — metadata-only
          }
          html = await fetchApiText(`/forfattningar/${reg.id}/innehall/html`);
        }

        const contentKey = JSON.stringify(sections) + html + reg.titel;
        const hash = sha256(contentKey);

        return { reg, sections, html, hash };
      }),
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const { reg, sections, html, hash } = result.value;
        newHashes[reg.id] = hash;
        const changed = FORCE || prevHashes[reg.id] !== hash;
        pages.push({ reg, sections, html, changed });

        if (sections.length > 0) {
          console.log(`    ${reg.forfattning}: ${sections.length} sections`);
        }
      } else {
        console.error(`    FAILED: ${result.reason}`);
      }
    }

    // Brief pause between batches to be polite
    if (batchStart + BATCH_SIZE < activeRegs.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (DIFF_ONLY) {
    const changedCount = pages.filter(p => p.changed).length;
    console.log(`\n--diff-only: ${changedCount}/${pages.length} regulations changed.`);
    saveHashes(newHashes);
    process.exit(0);
  }

  // Build database
  console.log(`\nBuilding database at ${DB_PATH}`);
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

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

  const insertXref = db.prepare(`
    INSERT INTO cross_refs (source_section_id, target_type, target_id, target_label)
    VALUES (@source_section_id, @target_type, @target_id, @target_label)
  `);

  const now = new Date().toISOString();
  let totalSections = 0;
  let totalCrossRefs = 0;
  let regsWithContent = 0;

  const insertAll = db.transaction(() => {
    for (const { reg, sections, html } of pages) {
      const regId = `BFS-${reg.forfattning.replace(/\s+/g, '-').replace(':', '-')}`;

      insertReg.run({
        id: regId,
        agency: CONFIG.agency,
        gazette_series: CONFIG.gazette,
        number: reg.forfattning,
        title: reg.titel,
        subject_area: reg.forkortning ?? null,
        status: 'in_force',
        issued_date: reg.beslutad ?? null,
        effective_date: reg.ikraft ?? null,
        repealed_date: null,
        amends: reg.grundforfattning ?? null,
        amended_by: null,
        sfs_basis: CONFIG.sfsBasis,
        eu_basis: null,
        source_url: reg.dokumentlank ?? CONFIG.indexUrl,
        license_basis: CONFIG.defaultLicense,
        fetched_at: now,
      });

      // Parse structured content into sections
      if (sections.length > 0) {
        const parsed = parseStructuredContent(sections, regId);
        for (const sec of parsed) {
          insertSec.run(sec);
        }
        totalSections += parsed.length;
        if (parsed.length > 0) regsWithContent++;

        // Extract cross-references from HTML
        if (html && parsed.length > 0) {
          const xrefs = extractCrossReferences(html, regId);
          for (const xref of xrefs) {
            insertXref.run({
              source_section_id: parsed[0].id,
              target_type: xref.target_type,
              target_id: xref.target_id,
              target_label: null,
            });
          }
          totalCrossRefs += xrefs.length;
        }
      }
    }

    // Build FTS5 index
    db.exec(`
      INSERT INTO sections_fts (rowid, body, title, regulation_title, gazette_series)
      SELECT s.rowid, s.body, s.title, r.title, r.gazette_series
      FROM sections s
      JOIN regulations r ON r.id = s.regulation_id
    `);

    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_ingest', ?)").run(now);
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('agency', ?)").run(CONFIG.agency);
  });

  insertAll();
  db.close();

  saveHashes(newHashes);

  const census = {
    agency: CONFIG.agency,
    gazette: CONFIG.gazette,
    regulations: pages.length,
    regulations_with_content: regsWithContent,
    sections: totalSections,
    definitions: 0,
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
    regulations_with_content: regsWithContent,
    repealed: 0,
    total_sections: totalSections,
    total_definitions: 0,
    total_cross_references: totalCrossRefs,
    source_url: `${BOVERKET_API_BASE}/forfattningar`,
    generated_at: now,
  };
  fs.writeFileSync(COVERAGE_PATH, JSON.stringify(coverage, null, 2));

  console.log(`\nIngestion complete.`);
  console.log(`  Regulations:     ${pages.length} (${regsWithContent} with structured content)`);
  console.log(`  Sections:        ${totalSections}`);
  console.log(`  Cross-refs:      ${totalCrossRefs}`);
  console.log(`  Database:        ${DB_PATH}`);
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
