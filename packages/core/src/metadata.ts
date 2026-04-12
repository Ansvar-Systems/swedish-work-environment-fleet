import type { AgencyConfig } from './types.js';

/** Response metadata attached to every tool result. */
export interface Meta {
  disclaimer: string;
  data_age: string | null;
  source_url: string;
  copyright: string;
  server: string;
  version: string;
}

const DISCLAIMER =
  'This data is provided for informational purposes only and does not constitute legal advice. ' +
  'Always verify against the official Swedish government sources.';

/**
 * Build a standard metadata object for a tool response.
 *
 * @param config  Agency-level configuration
 * @param dataAge Optional ISO-8601 timestamp of the last data ingest
 */
export function buildMeta(config: AgencyConfig, dataAge?: string): Meta {
  return {
    disclaimer: DISCLAIMER,
    data_age: dataAge ?? null,
    source_url: config.sourceUrl,
    copyright: `${config.agency} — ${config.defaultLicense}`,
    server: config.serverName,
    version: config.version,
  };
}

/**
 * Return a staleness warning if the data is older than 14 days, or null
 * if the data is fresh enough.
 */
export function buildStalenessWarning(fetchedAt: string): string | null {
  const fetched = new Date(fetchedAt);
  const now = new Date();
  const diffMs = now.getTime() - fetched.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > 14) {
    const rounded = Math.floor(diffDays);
    return `Data was last fetched ${rounded} days ago (${fetchedAt}). Results may not reflect recent regulatory changes.`;
  }

  return null;
}
