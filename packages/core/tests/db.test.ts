import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { seedTestDb } from './helpers/seed-db.js';
import {
  ftsSearch,
  getRegulation,
  getSection,
  listRegulations,
} from '../src/db.js';

describe('database layer', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = seedTestDb();
  });

  afterEach(() => {
    db.close();
  });

  // --- ftsSearch -------------------------------------------------------------

  describe('ftsSearch', () => {
    it('finds "asbest" regulations', () => {
      const results = ftsSearch(db, 'asbest');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.body.toLowerCase().includes('asbest'))).toBe(
        true,
      );
    });

    it('returns empty for nonsense query', () => {
      const results = ftsSearch(db, 'xyzzyflurble12345');
      expect(results).toHaveLength(0);
    });
  });

  // --- getRegulation ---------------------------------------------------------

  describe('getRegulation', () => {
    it('returns full regulation for AFS-2006-1', () => {
      const reg = getRegulation(db, 'AFS-2006-1');
      expect(reg).not.toBeNull();
      expect(reg!.title).toBe('Asbest');
      expect(reg!.agency).toBe('Arbetsmiljoverket');
      expect(reg!.status).toBe('in_force');
      expect(reg!.gazette_series).toBe('AFS');
    });

    it('returns null for unknown ID', () => {
      const reg = getRegulation(db, 'DOES-NOT-EXIST');
      expect(reg).toBeNull();
    });
  });

  // --- getSection ------------------------------------------------------------

  describe('getSection', () => {
    it('returns section with body containing "Rivning"', () => {
      const sec = getSection(db, 'AFS-2006-1/kap-3/p-7');
      expect(sec).not.toBeNull();
      expect(sec!.body).toContain('Rivning');
      expect(sec!.regulation_title).toBe('Asbest');
      expect(sec!.gazette_series).toBe('AFS');
    });
  });

  // --- listRegulations -------------------------------------------------------

  describe('listRegulations', () => {
    it('filters by status — 2 in_force', () => {
      const regs = listRegulations(db, { status: 'in_force' });
      expect(regs).toHaveLength(2);
      expect(regs.every((r) => r.status === 'in_force')).toBe(true);
    });

    it('filters by status — 1 repealed', () => {
      const regs = listRegulations(db, { status: 'repealed' });
      expect(regs).toHaveLength(1);
      expect(regs[0].status).toBe('repealed');
    });

    it('returns all without filter — 3 total', () => {
      const regs = listRegulations(db);
      expect(regs).toHaveLength(3);
    });
  });
});
