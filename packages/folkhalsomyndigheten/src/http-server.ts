import { openDatabase, startHttpServer } from '@ansvar/swe-fleet-core';
import { CONFIG } from './config.js';

const dbPath =
  process.env.FOHM_DB_PATH ??
  process.env.DB_PATH ??
  'data/database.db';

const { instance: db } = openDatabase(dbPath);
startHttpServer(db, CONFIG);
