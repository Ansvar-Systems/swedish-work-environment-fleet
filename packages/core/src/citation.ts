/** Structured citation metadata for grounding and traceability. */
export interface CitationMetadata {
  canonical_ref: string;
  display_text: string;
  aliases: string[];
  source_url: string | null;
  lookup: {
    tool: string;
    args: Record<string, string>;
  };
}

/**
 * Build a citation for a whole regulation.
 *
 * @example
 * buildRegulationCitation('AFS-2006-1', 'Asbest', 'AFS 2006:1', 'https://...')
 */
export function buildRegulationCitation(
  regulationId: string,
  title: string,
  gazetteNumber: string,
  sourceUrl: string | null,
): CitationMetadata {
  return {
    canonical_ref: gazetteNumber,
    display_text: `${gazetteNumber} — ${title}`,
    aliases: [regulationId, gazetteNumber, title],
    source_url: sourceUrl,
    lookup: {
      tool: 'get_regulation',
      args: { regulation_id: regulationId },
    },
  };
}

/**
 * Build a citation for a specific section within a regulation.
 *
 * @example
 * buildSectionCitation('AFS-2006-1/kap-3/p-7', 'Asbest', 'AFS 2006:1', '7', 'https://...')
 */
export function buildSectionCitation(
  sectionId: string,
  regulationTitle: string,
  gazetteNumber: string,
  sectionNumber: string | null,
  sourceUrl: string | null,
): CitationMetadata {
  const sectionLabel = sectionNumber ? ` § ${sectionNumber}` : '';
  return {
    canonical_ref: `${gazetteNumber}${sectionLabel}`,
    display_text: `${gazetteNumber}${sectionLabel} — ${regulationTitle}`,
    aliases: [sectionId, `${gazetteNumber}${sectionLabel}`],
    source_url: sourceUrl,
    lookup: {
      tool: 'get_section',
      args: { section_id: sectionId },
    },
  };
}
