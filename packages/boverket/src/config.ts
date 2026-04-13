import type { AgencyConfig } from '@ansvar/swe-fleet-core';

export const CONFIG: AgencyConfig = {
  agency: 'Boverket',
  gazette: 'BFS',
  serverName: 'swedish-building-code-mcp',
  packageName: '@ansvar/swedish-building-code-mcp',
  version: '0.1.0',
  description:
    'Swedish building codes and construction regulations from Boverket (BFS/BBR). ' +
    'Covers building codes, accessibility, energy performance, construction products, planning regulations.',
  indexUrl:
    'https://forfattningssamling.boverket.se/',
  sourceUrl: 'https://www.boverket.se/',
  defaultLicense: 'psi_oppen_data',
  sfsBasis: 'SFS 2010:900',
};

/**
 * Boverket REST API — fully open, no auth required.
 *
 * Endpoints:
 *   GET /v1/forfattningar                    — list + filter by type, BFS number, title, status
 *   GET /v1/forfattningar/{id}               — single regulation metadata
 *   GET /v1/forfattningar/{id}/innehall      — structured JSON content (sections, paragraphs, prescriptions, advice)
 *   GET /v1/forfattningar/{id}/innehall/html — rendered HTML content
 *   GET /v1/forfattningar/sok?text=...       — fulltext search across all regulations
 *
 * 449 total regulations, 137 active, 71 with structured fulltext.
 */
export const BOVERKET_API_BASE = 'https://api.boverket.se/forfattningssamling/v1';
