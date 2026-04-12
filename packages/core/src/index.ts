export type {
  AgencyConfig,
  Regulation,
  Section,
  Definition,
  CrossRef,
  CoverageStats,
} from './types.js';

export { initSchema, getSchemaVersion } from './schema.js';

export type { FtsResult, DatabaseHandle, ListRegulationsOpts } from './db.js';
export {
  openDatabase,
  ftsSearch,
  sanitizeFtsQuery,
  getRegulation,
  getSection,
  listRegulations,
  getDefinitions,
  getCrossReferences,
  getRegulationSections,
  getMetadata,
  regulationCount,
  sectionCount,
} from './db.js';

export type { Meta } from './metadata.js';
export { buildMeta, buildStalenessWarning } from './metadata.js';

export type { JurisdictionOk, JurisdictionError, JurisdictionResult } from './jurisdiction.js';
export { validateJurisdiction } from './jurisdiction.js';

export type { CitationMetadata } from './citation.js';
export { buildRegulationCitation, buildSectionCitation } from './citation.js';
