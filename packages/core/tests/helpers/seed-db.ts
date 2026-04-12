import Database from 'better-sqlite3';
import { initSchema } from '../../src/schema.js';

/**
 * Create an in-memory test database with realistic fixture data.
 *
 * Returns the open database handle — the caller is responsible for
 * closing it (typically via afterEach).
 */
export function seedTestDb(): Database.Database {
  const db = new Database(':memory:');
  initSchema(db);

  // --- Regulations -----------------------------------------------------------
  const insertReg = db.prepare(`
    INSERT INTO regulations
      (id, agency, gazette_series, number, title, subject_area, status,
       issued_date, effective_date, repealed_date, amends, amended_by,
       sfs_basis, eu_basis, source_url, license_basis, fetched_at)
    VALUES
      (@id, @agency, @gazette_series, @number, @title, @subject_area, @status,
       @issued_date, @effective_date, @repealed_date, @amends, @amended_by,
       @sfs_basis, @eu_basis, @source_url, @license_basis, @fetched_at)
  `);

  insertReg.run({
    id: 'AFS-2006-1',
    agency: 'Arbetsmiljoverket',
    gazette_series: 'AFS',
    number: '2006:1',
    title: 'Asbest',
    subject_area: 'Kemiska risker',
    status: 'in_force',
    issued_date: '2006-02-14',
    effective_date: '2006-09-01',
    repealed_date: null,
    amends: null,
    amended_by: null,
    sfs_basis: 'SFS 1977:1160',
    eu_basis: 'direktiv 2009/148/EG',
    source_url: 'https://www.av.se/arbetsmiljoarbete-och-inspektioner/publikationer/foreskrifter/asbest-afs-20061/',
    license_basis: 'psi_oppen_data',
    fetched_at: '2026-04-10T12:00:00Z',
  });

  insertReg.run({
    id: 'AFS-2011-19',
    agency: 'Arbetsmiljoverket',
    gazette_series: 'AFS',
    number: '2011:19',
    title: 'Kemiska arbetsmiljorisker',
    subject_area: 'Kemiska risker',
    status: 'in_force',
    issued_date: '2011-06-07',
    effective_date: '2012-07-01',
    repealed_date: null,
    amends: null,
    amended_by: null,
    sfs_basis: 'SFS 1977:1160',
    eu_basis: null,
    source_url: 'https://www.av.se/arbetsmiljoarbete-och-inspektioner/publikationer/foreskrifter/kemiska-arbetsmiljorisker-afs-201119/',
    license_basis: 'psi_oppen_data',
    fetched_at: '2026-04-10T12:00:00Z',
  });

  insertReg.run({
    id: 'AFS-2020-1',
    agency: 'Arbetsmiljoverket',
    gazette_series: 'AFS',
    number: '2020:1',
    title: 'Arbetsplatsens utformning',
    subject_area: 'Arbetsplatsens utformning',
    status: 'repealed',
    issued_date: '2020-09-01',
    effective_date: '2021-01-01',
    repealed_date: '2025-01-01',
    amends: null,
    amended_by: 'AFS 2024:2',
    sfs_basis: 'SFS 1977:1160',
    eu_basis: null,
    source_url: 'https://www.av.se/arbetsmiljoarbete-och-inspektioner/publikationer/foreskrifter/arbetsplatsens-utformning-afs-20201/',
    license_basis: 'psi_oppen_data',
    fetched_at: '2026-04-10T12:00:00Z',
  });

  // --- Sections --------------------------------------------------------------
  const insertSec = db.prepare(`
    INSERT INTO sections
      (id, regulation_id, section_type, number, title, body, parent_id, sort_order)
    VALUES
      (@id, @regulation_id, @section_type, @number, @title, @body, @parent_id, @sort_order)
  `);

  insertSec.run({
    id: 'AFS-2006-1/kap-1/p-1',
    regulation_id: 'AFS-2006-1',
    section_type: 'paragraf',
    number: '1',
    title: 'Tillamplighet',
    body: 'Dessa foreskrifter galler arbete med asbest och asbesthaltigt material.',
    parent_id: null,
    sort_order: 1,
  });

  insertSec.run({
    id: 'AFS-2006-1/kap-3/p-7',
    regulation_id: 'AFS-2006-1',
    section_type: 'paragraf',
    number: '7',
    title: 'Rivning',
    body: 'Rivning av asbesthaltigt material ska utforas med metoder som minimerar damm och fiberutsläpp.',
    parent_id: null,
    sort_order: 7,
  });

  insertSec.run({
    id: 'AFS-2011-19/kap-2/p-3',
    regulation_id: 'AFS-2011-19',
    section_type: 'paragraf',
    number: '3',
    title: 'Riskbedomning',
    body: 'Arbetsgivaren ska bedomma riskerna vid arbete med kemiska riskkallor och vidta nodvandiga atgarder.',
    parent_id: null,
    sort_order: 3,
  });

  // --- FTS5 index ------------------------------------------------------------
  const insertFts = db.prepare(`
    INSERT INTO sections_fts (rowid, body, title, regulation_title, gazette_series)
    SELECT s.rowid, s.body, s.title, r.title, r.gazette_series
    FROM sections s
    JOIN regulations r ON r.id = s.regulation_id
  `);
  insertFts.run();

  // --- Definitions -----------------------------------------------------------
  const insertDef = db.prepare(`
    INSERT INTO definitions (regulation_id, term, definition, section_id)
    VALUES (@regulation_id, @term, @definition, @section_id)
  `);

  insertDef.run({
    regulation_id: 'AFS-2006-1',
    term: 'asbest',
    definition: 'Fibrost silikatmineral som tillhor serpentin- eller amfibolgruppen.',
    section_id: 'AFS-2006-1/kap-1/p-1',
  });

  insertDef.run({
    regulation_id: 'AFS-2011-19',
    term: 'hygieniskt gransvarde',
    definition: 'Hogsta godtagbara genomsnittshalt av en luftfororening i inandningsluften.',
    section_id: 'AFS-2011-19/kap-2/p-3',
  });

  // --- Cross-references ------------------------------------------------------
  const insertXref = db.prepare(`
    INSERT INTO cross_refs (source_section_id, target_type, target_id, target_label)
    VALUES (@source_section_id, @target_type, @target_id, @target_label)
  `);

  insertXref.run({
    source_section_id: 'AFS-2006-1/kap-1/p-1',
    target_type: 'sfs',
    target_id: 'SFS 1977:1160',
    target_label: 'Arbetsmiljolagen',
  });

  insertXref.run({
    source_section_id: 'AFS-2006-1/kap-1/p-1',
    target_type: 'eu_directive',
    target_id: 'direktiv 2009/148/EG',
    target_label: 'Asbestdirektivet',
  });

  // --- Metadata --------------------------------------------------------------
  db.prepare(
    "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_ingest', '2026-04-10T12:00:00Z')",
  ).run();
  db.prepare(
    "INSERT OR REPLACE INTO metadata (key, value) VALUES ('agency', 'Arbetsmiljoverket')",
  ).run();

  return db;
}
