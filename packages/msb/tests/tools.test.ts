import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createToolHandlers } from '@ansvar/swe-fleet-core';
import { seedTestDb } from '../../core/tests/helpers/seed-db.js';
import { CONFIG } from '../src/config.js';

describe('msb tool handlers', () => {
  let db: Database.Database;
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;

  beforeEach(() => {
    db = seedTestDb();
    handlers = createToolHandlers(db, CONFIG);
  });

  afterEach(() => {
    db.close();
  });

  it('search_regulations finds content', () => {
    const result = handlers.search_regulations({ query: 'asbest' }) as {
      results_count: number;
      _meta: unknown;
    };
    expect(result.results_count).toBeGreaterThan(0);
    expect(result._meta).toBeDefined();
  });

  it('about returns correct agency and gazette', () => {
    const result = handlers.about({}) as {
      agency: string;
      gazette: string;
      server: string;
      statistics: { regulations: number };
      _meta: unknown;
    };
    expect(result.agency).toBe('MSB');
    expect(result.gazette).toBe('MSBFS');
    expect(result.server).toBe('swedish-emergency-preparedness-mcp');
    expect(result.statistics.regulations).toBeGreaterThan(0);
    expect(result._meta).toBeDefined();
  });

  it('validate_citation works for known regulation', () => {
    const result = handlers.validate_citation({ citation: 'AFS-2006-1' }) as {
      valid: boolean;
      type: string;
    };
    expect(result.valid).toBe(true);
    expect(result.type).toBe('regulation');
  });

  it('validate_citation returns invalid for unknown', () => {
    const result = handlers.validate_citation({ citation: 'NOPE-999' }) as {
      valid: boolean;
    };
    expect(result.valid).toBe(false);
  });
});
