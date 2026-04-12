/** Agency-level configuration for an MCP server in the fleet. */
export interface AgencyConfig {
  agency: string;
  gazette: string;
  serverName: string;
  packageName: string;
  version: string;
  description: string;
  indexUrl: string;
  sourceUrl: string;
  defaultLicense: string;
  sfsBasis: string;
}

/** A regulation (foreskrift) issued by a Swedish agency. */
export interface Regulation {
  id: string;
  agency: string;
  gazette_series: string;
  number: string;
  title: string;
  subject_area: string | null;
  status: string;
  issued_date: string | null;
  effective_date: string | null;
  repealed_date: string | null;
  amends: string | null;
  amended_by: string | null;
  sfs_basis: string | null;
  eu_basis: string | null;
  source_url: string;
  license_basis: string;
  fetched_at: string;
}

/** A structural section within a regulation (chapter, paragraph, appendix, etc.). */
export interface Section {
  id: string;
  regulation_id: string;
  section_type: string;
  number: string | null;
  title: string | null;
  body: string;
  parent_id: string | null;
  sort_order: number;
}

/** A defined term extracted from a regulation. */
export interface Definition {
  id?: number;
  regulation_id: string;
  term: string;
  definition: string;
  section_id: string | null;
}

/** A cross-reference from one section to another regulation, directive, or standard. */
export interface CrossRef {
  id?: number;
  source_section_id: string;
  target_type: string;
  target_id: string;
  target_label: string | null;
}

/** Summary statistics about the database contents. */
export interface CoverageStats {
  regulations: number;
  sections: number;
  definitions: number;
  cross_references: number;
  fts_entries: number;
  in_force: number;
  repealed: number;
}
