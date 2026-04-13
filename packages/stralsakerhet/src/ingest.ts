#!/usr/bin/env tsx
/**
 * Ingestion script for Stralsakerhetsmyndigheten (SSMFS) regulations.
 *
 * Fetches the SSM regulation index, scrapes each regulation page,
 * downloads regulation PDFs, extracts text, and builds a SQLite
 * database with FTS5 search.
 *
 * Usage:
 *   npx tsx src/ingest.ts [--force] [--fetch-only] [--diff-only]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { PDFParse } from 'pdf-parse';
import {
  initSchema,
  parseRegulationPage,
  extractDefinitions,
  extractCrossReferences,
  stripHtml,
} from '@ansvar/swe-fleet-core';
import type { Section } from '@ansvar/swe-fleet-core';
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
// PDF fetching & text extraction
// ---------------------------------------------------------------------------

async function fetchPdf(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AnsvarMCP/0.1 (https://ansvar.eu; data-ingestion)',
      'Accept': 'application/pdf',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching PDF ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

/**
 * Find the primary regulation PDF link on a landing page.
 *
 * SSM pages host PDFs under /contentassets/... with links in the HTML.
 * We prefer links whose text or href contains "foreskrift" or the SSMFS
 * number, and skip "vagledning" (guidance) documents.
 */
function findPdfLink(html: string, pageUrl: string): string | null {
  const linkRegex = /<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  const candidates: Array<{ url: string; text: string }> = [];

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = stripHtml(match[2]).toLowerCase();
    const absoluteUrl = href.startsWith('http')
      ? href
      : new URL(href, pageUrl).toString();
    candidates.push({ url: absoluteUrl, text });
  }

  if (candidates.length === 0) return null;

  // Prefer the regulation PDF over guidance docs
  const regulation = candidates.find(
    (c) =>
      (c.text.includes('föreskrift') || c.text.includes('foreskrift') || c.url.includes('ssmfs')) &&
      !c.text.includes('vägledning') &&
      !c.text.includes('vagledning'),
  );
  if (regulation) return regulation.url;

  // Fall back to first non-guidance PDF
  const nonGuidance = candidates.find(
    (c) => !c.text.includes('vägledning') && !c.text.includes('vagledning'),
  );
  if (nonGuidance) return nonGuidance.url;

  // Last resort: first PDF
  return candidates[0].url;
}

/**
 * Parse extracted PDF text into Section objects.
 *
 * Swedish regulations follow a structure of:
 *   N kap. Chapter Title
 *   N § Paragraph text...
 *
 * Some shorter regulations skip chapters entirely and go straight to
 * numbered paragraphs.
 */
function parsePdfText(text: string, regulationId: string): Section[] {
  const sections: Section[] = [];
  let sortOrder = 0;
  let currentChapterId: string | null = null;
  let currentChapterNumber: string | null = null;

  // Normalise line endings and collapse excessive whitespace runs
  const normalised = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  // Split on chapter headings: "N kap. ..."
  const chapterPattern = /^(\d+)\s+kap\.\s*(.*)/m;

  // Check if the document uses chapters at all
  const hasChapters = chapterPattern.test(normalised);

  if (hasChapters) {
    // Split the text at chapter boundaries, keeping the delimiter
    const chapterParts = normalised.split(/(?=^\d+\s+kap\.)/m).filter((p) => p.trim());

    for (const part of chapterParts) {
      const chMatch = part.match(/^(\d+)\s+kap\.\s*(.*)/m);
      if (chMatch) {
        const chapterNum = chMatch[1];
        const chapterTitle = chMatch[2].trim();
        const chapterId = `${regulationId}/kap-${chapterNum}`;

        sortOrder++;
        sections.push({
          id: chapterId,
          regulation_id: regulationId,
          section_type: 'chapter',
          number: chapterNum,
          title: chapterTitle || `${chapterNum} kap.`,
          body: chapterTitle || `${chapterNum} kap.`,
          parent_id: null,
          sort_order: sortOrder,
        });

        currentChapterId = chapterId;
        currentChapterNumber = chapterNum;

        // Extract paragraphs within this chapter (text after the chapter heading)
        const afterHeading = part.substring(chMatch[0].length);
        sortOrder = extractPdfParagraphs(
          afterHeading, regulationId, currentChapterId, currentChapterNumber, sections, sortOrder,
        );
      } else {
        // Text before the first chapter — extract any paragraphs
        sortOrder = extractPdfParagraphs(
          part, regulationId, null, null, sections, sortOrder,
        );
      }
    }
  } else {
    // No chapters — extract paragraphs directly from the full text
    sortOrder = extractPdfParagraphs(
      normalised, regulationId, null, null, sections, sortOrder,
    );
  }

  // If we found no structured sections at all, create a single body section
  // so the regulation is still searchable
  if (sections.length === 0 && normalised.trim().length > 50) {
    sections.push({
      id: `${regulationId}/body`,
      regulation_id: regulationId,
      section_type: 'body',
      number: null,
      title: null,
      body: normalised.trim(),
      parent_id: null,
      sort_order: 1,
    });
  }

  return sections;
}

/**
 * Extract numbered paragraphs (N §) from a block of PDF text.
 * Returns the updated sort order.
 */
function extractPdfParagraphs(
  text: string,
  regulationId: string,
  parentId: string | null,
  chapterNumber: string | null,
  sections: Section[],
  startOrder: number,
): number {
  let order = startOrder;

  // Split on paragraph markers: "N §" at start of line or after whitespace
  const paraParts = text.split(/(?=(?:^|\n)\s*\d+\s*§)/).filter((p) => p.trim());

  for (const part of paraParts) {
    const paraMatch = part.match(/^\s*(\d+)\s*§\s*([\s\S]*)/);
    if (!paraMatch) continue;

    const paraNumber = paraMatch[1];
    const body = paraMatch[2].trim();
    if (!body) continue;

    const chapterPart = chapterNumber ? `/kap-${chapterNumber}` : '';
    const sectionId = `${regulationId}${chapterPart}/p-${paraNumber}`;

    order++;
    sections.push({
      id: sectionId,
      regulation_id: regulationId,
      section_type: 'paragraf',
      number: paraNumber,
      title: null,
      body: `${paraNumber} § ${body}`,
      parent_id: parentId,
      sort_order: order,
    });
  }

  return order;
}

// ---------------------------------------------------------------------------
// Index page parsing — extract links to individual SSMFS regulations
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

    // Look for SSMFS YYYY:N pattern
    const ssmfsMatch = text.match(/SSMFS\s+(\d{4}:\d+)/i);
    if (!ssmfsMatch) continue;

    const number = ssmfsMatch[1];
    const id = `SSMFS-${number.replace(':', '-')}`;

    if (seen.has(id)) continue;
    seen.add(id);

    const absoluteUrl = href.startsWith('http')
      ? href
      : new URL(href, CONFIG.indexUrl).toString();

    const titleMatch = text.match(/SSMFS\s+\d{4}:\d+[,\s]*[-–—]\s*(.+)/i);
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

  const pages: Array<{
    link: RegulationLink;
    html: string;
    pdfText: string | null;
    changed: boolean;
  }> = [];

  for (let i = 0; i < regulationLinks.length; i++) {
    const link = regulationLinks[i];
    console.log(`  [${i + 1}/${regulationLinks.length}] Fetching ${link.id}: ${link.url}`);
    try {
      const html = await fetchPage(link.url);
      const hash = sha256(html);
      newHashes[link.id] = hash;

      const changed = FORCE || prevHashes[link.id] !== hash;

      // Attempt to find and download the regulation PDF
      let pdfText: string | null = null;
      const pdfUrl = findPdfLink(html, link.url);

      if (pdfUrl) {
        console.log(`    Downloading PDF: ${pdfUrl.split('/').pop()}`);
        try {
          const pdfBuffer = await fetchPdf(pdfUrl);
          pdfText = await extractPdfText(pdfBuffer);

          if (!pdfText || pdfText.trim().length < 20) {
            console.warn(`    WARNING: PDF text is empty or too short (likely scanned image) — falling back to HTML`);
            pdfText = null;
          } else {
            console.log(`    Extracted ${pdfText.length} chars from PDF`);
          }
        } catch (pdfErr) {
          console.warn(`    WARNING: PDF extraction failed: ${pdfErr instanceof Error ? pdfErr.message : pdfErr}`);
          pdfText = null;
        }
      } else {
        console.log(`    No PDF link found — using HTML scraper`);
      }

      pages.push({ link, html, pdfText, changed });

      if (!changed) {
        console.log(`    (unchanged)`);
      }

      // Rate limit between fetches
      await new Promise((r) => setTimeout(r, 500));
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

  let pdfSuccessCount = 0;
  let htmlFallbackCount = 0;

  const insertAll = db.transaction(() => {
    for (const { link, html, pdfText } of pages) {
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

      // Use PDF-extracted sections if available, fall back to HTML scraper
      let sections: Section[];
      if (pdfText) {
        sections = parsePdfText(pdfText, link.id);
        pdfSuccessCount++;
      } else {
        sections = parseRegulationPage(html, link.id);
        htmlFallbackCount++;
      }

      for (const sec of sections) {
        insertSec.run(sec);
      }
      totalSections += sections.length;

      // Extract definitions and cross-references
      // Use PDF text wrapped in pseudo-HTML if available, otherwise raw HTML
      const contentForExtraction = pdfText
        ? `<article><p>${pdfText.replace(/\n/g, '</p><p>')}</p></article>`
        : html;

      const defs = extractDefinitions(contentForExtraction, link.id);
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
        const xrefs = extractCrossReferences(contentForExtraction, link.id);
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
  console.log(`  PDF source:  ${pdfSuccessCount} regulations`);
  console.log(`  HTML fallback: ${htmlFallbackCount} regulations`);
  console.log(`  Database:    ${DB_PATH}`);
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
