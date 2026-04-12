import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { AgencyConfig } from '../src/types.js';
import { TOOL_DEFINITIONS, createToolHandlers } from '../src/tools.js';
import { seedTestDb } from './helpers/seed-db.js';

const TEST_CONFIG: AgencyConfig = {
  agency: 'AV',
  gazette: 'AFS',
  serverName: 'swedish-work-environment-mcp',
  packageName: '@ansvar/swedish-work-environment-mcp',
  version: '0.1.0',
  description: 'Test',
  indexUrl: 'https://www.av.se/',
  sourceUrl: 'https://www.av.se/',
  defaultLicense: 'psi_oppen_data',
  sfsBasis: 'SFS 1977:1160',
};

describe('TOOL_DEFINITIONS', () => {
  it('has 9 tools', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(9);
  });
});

describe('tool handlers', () => {
  let db: Database.Database;
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;

  beforeEach(() => {
    db = seedTestDb();
    handlers = createToolHandlers(db, TEST_CONFIG);
  });

  afterEach(() => {
    db.close();
  });

  // --- search_regulations ---------------------------------------------------

  it('search_regulations finds "asbest"', () => {
    const result = handlers.search_regulations({ query: 'asbest' }) as {
      results_count: number;
      _meta: unknown;
    };
    expect(result.results_count).toBeGreaterThan(0);
    expect(result._meta).toBeDefined();
  });

  // --- get_regulation -------------------------------------------------------

  it('get_regulation returns AFS-2006-1 with title "Asbest"', () => {
    const result = handlers.get_regulation({ regulation_id: 'AFS-2006-1' }) as {
      title: string;
      table_of_contents: unknown[];
      _citation: unknown;
    };
    expect(result.title).toBe('Asbest');
    expect(result.table_of_contents).toBeDefined();
    expect(result._citation).toBeDefined();
  });

  it('get_regulation returns error for unknown ID', () => {
    const result = handlers.get_regulation({ regulation_id: 'NOPE-999' }) as {
      error: string;
    };
    expect(result.error).toBe('not_found');
  });

  // --- get_section ----------------------------------------------------------

  it('get_section returns section with body containing "Rivning"', () => {
    const result = handlers.get_section({
      section_id: 'AFS-2006-1/kap-3/p-7',
    }) as { body: string };
    expect(result.body).toContain('Rivning');
  });

  // --- list_regulations -----------------------------------------------------

  it('list_regulations returns paginated results', () => {
    const result = handlers.list_regulations({}) as {
      page: number;
      total: number;
      results: unknown[];
    };
    expect(result.page).toBe(1);
    expect(result.total).toBeGreaterThan(0);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('list_regulations filters by status (repealed returns 1)', () => {
    const result = handlers.list_regulations({ status: 'repealed' }) as {
      total: number;
      results: unknown[];
    };
    expect(result.results).toHaveLength(1);
  });

  // --- search_definitions ---------------------------------------------------

  it('search_definitions finds "asbest"', () => {
    const result = handlers.search_definitions({ query: 'asbest' }) as {
      results_count: number;
      results: Array<{ term: string }>;
    };
    expect(result.results_count).toBeGreaterThan(0);
    expect(result.results.some((d) => d.term === 'asbest')).toBe(true);
  });

  // --- get_cross_references -------------------------------------------------

  it('get_cross_references returns refs for AFS-2006-1', () => {
    const result = handlers.get_cross_references({
      regulation_id: 'AFS-2006-1',
    }) as { total: number; by_type: Record<string, unknown[]> };
    expect(result.total).toBeGreaterThan(0);
    expect(result.by_type).toBeDefined();
  });

  // --- validate_citation ----------------------------------------------------

  it('validate_citation returns valid=true for AFS-2006-1', () => {
    const result = handlers.validate_citation({
      citation: 'AFS-2006-1',
    }) as { valid: boolean };
    expect(result.valid).toBe(true);
  });

  it('validate_citation returns valid=false for unknown', () => {
    const result = handlers.validate_citation({
      citation: 'INVALID-999',
    }) as { valid: boolean };
    expect(result.valid).toBe(false);
  });

  // --- list_sources ---------------------------------------------------------

  it('list_sources returns populated sources', () => {
    const result = handlers.list_sources({}) as {
      sources: Array<{ agency: string; last_ingest: string | null }>;
    };
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].agency).toBeDefined();
    expect(result.sources[0].last_ingest).toBeDefined();
  });

  // --- about ----------------------------------------------------------------

  it('about returns server metadata', () => {
    const result = handlers.about({}) as {
      server: string;
      version: string;
      statistics: { regulations: number; sections: number };
      _meta: unknown;
    };
    expect(result.server).toBe('swedish-work-environment-mcp');
    expect(result.version).toBe('0.1.0');
    expect(result.statistics.regulations).toBeGreaterThan(0);
    expect(result.statistics.sections).toBeGreaterThan(0);
    expect(result._meta).toBeDefined();
  });
});
