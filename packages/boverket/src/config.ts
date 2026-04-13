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
 * Boverket API configuration.
 *
 * The old HTML listing at /sv/lag--ratt/forfattningssamling/ was removed.
 * Boverket now hosts regulations on a Blazor Server app at
 * forfattningssamling.boverket.se, which cannot be scraped via HTTP fetch
 * (all content is rendered via SignalR WebSocket).
 *
 * Boverket provides a free REST API documented at:
 *   https://api-portal.boverket.se/reference#api=azu004-digitala-forfattningar
 *   PDF docs: https://www.boverket.se/contentassets/565a41dc66a24bcb9ce29b728135fdd8/
 *     anvandarvillkor-och-teknisk-beskrivning---api-tjanst-for-boverkets-forfattningssamling.pdf
 *
 * API endpoints (require subscription key from api-portal.boverket.se):
 *   GET /forfattningar              — list all regulations (supports ?upphavd=nej for in-force only)
 *   GET /forfattningar/{id}         — single regulation metadata
 *   GET /forfattningar/{id}/innehall — structured content (sections)
 *   GET /forfattningar/{id}/innehall/html — HTML content
 *   GET /forfattningar/sok?text=X   — full-text search
 *
 * Set BOVERKET_API_KEY env var to enable API-based ingestion.
 */
export const BOVERKET_API_BASE = 'https://api.boverket.se';
export const BOVERKET_API_KEY = process.env.BOVERKET_API_KEY ?? '';
