import type { Section } from './types.js';

// ---------------------------------------------------------------------------
// HTML entity decoding + tag stripping
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Remove HTML tags and decode common entities (including numeric). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (match) => ENTITY_MAP[match] ?? match)
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .trim();
}

// ---------------------------------------------------------------------------
// Regulation page parser
// ---------------------------------------------------------------------------

/**
 * Parse a Swedish government agency regulation HTML page into Section[].
 *
 * Looks for `<article>` content (falls back to full HTML), splits on
 * `<h1>` / `<h2>` headings, and identifies chapters (`N kap.`) and
 * numbered paragraphs (`N §`).
 */
export function parseRegulationPage(
  html: string,
  regulationId: string,
): Section[] {
  // Extract article content if present
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const content = articleMatch ? articleMatch[1] : html;

  const sections: Section[] = [];
  let sortOrder = 0;
  let currentChapterId: string | null = null;
  let currentChapterNumber: string | null = null;

  // Split into blocks by h1/h2 tags — keep the heading with its block
  const blocks = content.split(/(?=<h[12][^>]*>)/i).filter((b) => b.trim());

  for (const block of blocks) {
    const headingMatch = block.match(/<h([12])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (!headingMatch) {
      // Block without heading — parse paragraphs under current chapter
      parseParagraphs(block, regulationId, currentChapterId, currentChapterNumber, sections, sortOrder);
      sortOrder = sections.length;
      continue;
    }

    const headingText = stripHtml(headingMatch[2]);

    // Check for chapter pattern: "N kap. Title"
    const chapterMatch = headingText.match(/^(\d+)\s+kap\.\s*(.*)/i);
    if (chapterMatch) {
      const chapterNum = chapterMatch[1];
      const chapterTitle = chapterMatch[2].trim();
      const chapterId = `${regulationId}/kap-${chapterNum}`;

      sortOrder++;
      sections.push({
        id: chapterId,
        regulation_id: regulationId,
        section_type: 'chapter',
        number: chapterNum,
        title: chapterTitle || headingText,
        body: headingText,
        parent_id: null,
        sort_order: sortOrder,
      });

      currentChapterId = chapterId;
      currentChapterNumber = chapterNum;

      // Parse paragraphs following this heading within the same block
      const afterHeading = block.replace(/<h[12][^>]*>[\s\S]*?<\/h[12]>/i, '');
      parseParagraphs(afterHeading, regulationId, currentChapterId, currentChapterNumber, sections, sortOrder);
      sortOrder = sections.length;
      continue;
    }

    // Non-chapter heading (e.g. the regulation title in h1)
    sortOrder++;
    const sectionId = `${regulationId}/heading-${sortOrder}`;
    sections.push({
      id: sectionId,
      regulation_id: regulationId,
      section_type: 'heading',
      number: null,
      title: headingText,
      body: headingText,
      parent_id: null,
      sort_order: sortOrder,
    });

    // Parse paragraphs following the heading
    const afterHeading = block.replace(/<h[12][^>]*>[\s\S]*?<\/h[12]>/i, '');
    parseParagraphs(afterHeading, regulationId, currentChapterId, currentChapterNumber, sections, sortOrder);
    sortOrder = sections.length;
  }

  return sections;
}

/**
 * Parse <p> tags for numbered paragraphs (N § pattern).
 */
function parseParagraphs(
  html: string,
  regulationId: string,
  parentId: string | null,
  chapterNumber: string | null,
  sections: Section[],
  startOrder: number,
): void {
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  let order = startOrder;

  while ((match = pRegex.exec(html)) !== null) {
    const rawContent = match[1];
    const text = stripHtml(rawContent);
    if (!text) continue;

    // Check for numbered paragraph: "N §"
    const paraMatch = text.match(/^(\d+)\s*§\s*/);
    if (paraMatch) {
      const paraNumber = paraMatch[1];
      const chapterPart = chapterNumber ? `/kap-${chapterNumber}` : '';
      const sectionId = `${regulationId}${chapterPart}/p-${paraNumber}`;

      order++;
      sections.push({
        id: sectionId,
        regulation_id: regulationId,
        section_type: 'paragraf',
        number: paraNumber,
        title: null,
        body: text,
        parent_id: parentId,
        sort_order: order,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Definition extractor
// ---------------------------------------------------------------------------

/**
 * Extract definitions from HTML content.
 *
 * Looks for `<strong>term</strong>: definition` patterns commonly used
 * in Swedish regulation definition sections.
 */
export function extractDefinitions(
  html: string,
  regulationId: string,
): Array<{ regulation_id: string; term: string; definition: string }> {
  const defs: Array<{ regulation_id: string; term: string; definition: string }> = [];
  const seen = new Set<string>();

  // Match <strong>term</strong>: definition within <p> tags
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(html)) !== null) {
    const pContent = pMatch[1];
    const defRegex = /<strong[^>]*>([\s\S]*?)<\/strong>\s*:\s*([\s\S]*)/i;
    const defMatch = pContent.match(defRegex);

    if (defMatch) {
      const term = stripHtml(defMatch[1]).toLowerCase();
      const definition = stripHtml(defMatch[2]);

      if (term && definition && !seen.has(term)) {
        seen.add(term);
        defs.push({ regulation_id: regulationId, term, definition });
      }
    }
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Cross-reference extractor
// ---------------------------------------------------------------------------

interface ExtractedCrossRef {
  target_type: string;
  target_id: string;
}

/**
 * Extract cross-references to SFS laws, EU directives, and SIS standards
 * from HTML content.
 *
 * Deduplicates by `target_id`.
 */
export function extractCrossReferences(
  html: string,
  _regulationId: string,
): ExtractedCrossRef[] {
  const text = stripHtml(html);
  const refs: ExtractedCrossRef[] = [];
  const seen = new Set<string>();

  function addRef(targetType: string, targetId: string): void {
    if (!seen.has(targetId)) {
      seen.add(targetId);
      refs.push({ target_type: targetType, target_id: targetId });
    }
  }

  // SFS references: SFS 1977:1160
  const sfsRegex = /SFS\s+\d{4}:\d+/g;
  let match: RegExpExecArray | null;
  while ((match = sfsRegex.exec(text)) !== null) {
    addRef('sfs', match[0]);
  }

  // EU directives: direktiv 2009/148/EG or direktiv 2009/148/EU
  const euRegex = /direktiv\s+\d{4}\/\d+\/E[GU]/gi;
  while ((match = euRegex.exec(text)) !== null) {
    addRef('eu_directive', match[0]);
  }

  // SIS standards: SS-EN 12345 or SS 12345
  const sisRegex = /SS(?:-EN)?\s+\d+/g;
  while ((match = sisRegex.exec(text)) !== null) {
    addRef('sis_standard', match[0]);
  }

  return refs;
}
