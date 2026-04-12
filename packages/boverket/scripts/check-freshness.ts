#!/usr/bin/env tsx
/**
 * Check data freshness. Exits 1 if last_ingest is older than MAX_STALENESS_DAYS.
 */

import path from 'node:path';
import { openDatabase, getMetadata } from '@ansvar/swe-fleet-core';

const MAX_STALENESS_DAYS = parseInt(process.env.MAX_STALENESS_DAYS ?? '45', 10);
const DATA_DIR = path.resolve(import.meta.dirname ?? '.', '../data');
const DB_PATH =
  process.env.BOVERKET_DB_PATH ??
  process.env.DB_PATH ??
  path.join(DATA_DIR, 'database.db');

const { instance: db, close } = openDatabase(DB_PATH);

try {
  const lastIngest = getMetadata(db, 'last_ingest');

  if (!lastIngest) {
    console.error('No last_ingest metadata found — database may be empty.');
    process.exit(1);
  }

  const ingestDate = new Date(lastIngest);
  const now = new Date();
  const ageDays = (now.getTime() - ingestDate.getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays > MAX_STALENESS_DAYS) {
    console.error(
      `Data is ${Math.floor(ageDays)} days old (threshold: ${MAX_STALENESS_DAYS}). ` +
        `Last ingest: ${lastIngest}`,
    );
    process.exit(1);
  }

  console.log(
    `Data is ${Math.floor(ageDays)} days old (threshold: ${MAX_STALENESS_DAYS}). OK.`,
  );
} finally {
  close();
}
