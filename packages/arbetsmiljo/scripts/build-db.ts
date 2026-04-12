#!/usr/bin/env tsx
/**
 * Create an empty database with the fleet schema.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '@ansvar/swe-fleet-core';

const DATA_DIR = path.resolve(import.meta.dirname ?? '.', '../data');
const DB_PATH = path.join(DATA_DIR, 'database.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

if (fs.existsSync(DB_PATH)) {
  console.log(`Database already exists at ${DB_PATH}`);
  process.exit(0);
}

const db = new Database(DB_PATH);
initSchema(db);
db.close();

console.log(`Empty database created at ${DB_PATH}`);
