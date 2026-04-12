import type Database from 'better-sqlite3';
import type { AgencyConfig } from './types.js';
import { buildMeta } from './metadata.js';
import { buildRegulationCitation, buildSectionCitation } from './citation.js';
import {
  ftsSearch,
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

// ---------------------------------------------------------------------------
// Tool definitions (MCP protocol format)
// ---------------------------------------------------------------------------

/** MCP tool definition shape. */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_regulations',
    description:
      'Full-text search across Swedish work-environment regulations. Returns matching sections with snippets and citations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query in Swedish or English.' },
        status: {
          type: 'string',
          enum: ['in_force', 'repealed'],
          description: 'Filter by regulation status.',
        },
        subject_area: { type: 'string', description: 'Filter by subject area.' },
        limit: {
          type: 'number',
          description: 'Max results to return (default 20, max 100).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_regulation',
    description:
      'Retrieve a single regulation by ID, including its table of contents (list of sections).',
    inputSchema: {
      type: 'object',
      properties: {
        regulation_id: {
          type: 'string',
          description: 'Regulation ID, e.g. "AFS-2006-1".',
        },
      },
      required: ['regulation_id'],
    },
  },
  {
    name: 'get_section',
    description:
      'Retrieve a specific section (paragraph, chapter, appendix) by its full ID.',
    inputSchema: {
      type: 'object',
      properties: {
        section_id: {
          type: 'string',
          description: 'Section ID, e.g. "AFS-2006-1/kap-3/p-7".',
        },
      },
      required: ['section_id'],
    },
  },
  {
    name: 'list_regulations',
    description:
      'List regulations with optional filtering by status or subject area. Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['in_force', 'repealed'],
          description: 'Filter by regulation status.',
        },
        subject_area: { type: 'string', description: 'Filter by subject area.' },
        page: {
          type: 'number',
          description: 'Page number (1-based, default 1). Each page has 100 items.',
        },
      },
    },
  },
  {
    name: 'search_definitions',
    description:
      'Search for defined terms across all regulations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term to match against definitions.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_cross_references',
    description:
      'Get all cross-references from a regulation to SFS laws, EU directives, and SIS standards.',
    inputSchema: {
      type: 'object',
      properties: {
        regulation_id: {
          type: 'string',
          description: 'Regulation ID, e.g. "AFS-2006-1".',
        },
      },
      required: ['regulation_id'],
    },
  },
  {
    name: 'validate_citation',
    description:
      'Check whether a citation refers to a valid regulation or section in the database.',
    inputSchema: {
      type: 'object',
      properties: {
        citation: {
          type: 'string',
          description:
            'Citation to validate. Can be a regulation ID (e.g. "AFS-2006-1") or section ID (e.g. "AFS-2006-1/kap-3/p-7").',
        },
      },
      required: ['citation'],
    },
  },
  {
    name: 'list_sources',
    description:
      'List data sources, including the agency, source URL, and last ingest timestamp.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'about',
    description:
      'Return server information, database statistics, and a legal disclaimer.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/** Handler function signature. */
type ToolHandler = (args: Record<string, unknown>) => unknown;

/**
 * Create a map of tool handler functions backed by the given database
 * and agency configuration.
 */
export function createToolHandlers(
  db: Database.Database,
  config: AgencyConfig,
): Record<string, ToolHandler> {
  const meta = () => {
    const dataAge = getMetadata(db, 'last_ingest');
    return buildMeta(config, dataAge);
  };

  return {
    search_regulations(args) {
      const query = args.query as string;
      const limit = Math.min(Math.max((args.limit as number) || 20, 1), 100);

      let results = ftsSearch(db, query, limit);

      // Optional filters applied post-search
      if (args.status) {
        const status = args.status as string;
        results = results.filter((r) => {
          const reg = getRegulation(db, r.regulation_id);
          return reg?.status === status;
        });
      }
      if (args.subject_area) {
        const area = args.subject_area as string;
        results = results.filter((r) => {
          const reg = getRegulation(db, r.regulation_id);
          return reg?.subject_area === area;
        });
      }

      return {
        results_count: results.length,
        results: results.map((r) => ({
          section_id: r.id,
          regulation_id: r.regulation_id,
          regulation_title: r.regulation_title,
          section_type: r.section_type,
          number: r.number,
          title: r.title,
          snippet: r.snippet,
          _citation: buildSectionCitation(
            r.id,
            r.regulation_title,
            r.gazette_series,
            r.number,
            config.sourceUrl,
          ),
        })),
        _meta: meta(),
      };
    },

    get_regulation(args) {
      const id = args.regulation_id as string;
      const reg = getRegulation(db, id);
      if (!reg) {
        return { error: 'not_found', message: `Regulation "${id}" not found.` };
      }

      const sections = getRegulationSections(db, id);
      const tableOfContents = sections.map((s) => ({
        id: s.id,
        section_type: s.section_type,
        number: s.number,
        title: s.title,
      }));

      return {
        ...reg,
        table_of_contents: tableOfContents,
        _citation: buildRegulationCitation(
          reg.id,
          reg.title,
          `${reg.gazette_series} ${reg.number}`,
          reg.source_url,
        ),
        _meta: meta(),
      };
    },

    get_section(args) {
      const id = args.section_id as string;
      const sec = getSection(db, id);
      if (!sec) {
        return { error: 'not_found', message: `Section "${id}" not found.` };
      }

      return {
        id: sec.id,
        regulation_id: sec.regulation_id,
        section_type: sec.section_type,
        number: sec.number,
        title: sec.title,
        body: sec.body,
        parent_id: sec.parent_id,
        sort_order: sec.sort_order,
        _citation: buildSectionCitation(
          sec.id,
          sec.regulation_title,
          sec.gazette_series,
          sec.number,
          config.sourceUrl,
        ),
        _meta: meta(),
      };
    },

    list_regulations(args) {
      const page = Math.max((args.page as number) || 1, 1);
      const limit = 100;
      const offset = (page - 1) * limit;

      const status = args.status as string | undefined;
      const subjectArea = args.subject_area as string | undefined;

      const rows = listRegulations(db, {
        status,
        subject_area: subjectArea,
        limit,
        offset,
      });

      const total = regulationCount(db, status);

      return {
        page,
        total,
        results: rows.map((r) => ({
          id: r.id,
          number: r.number,
          title: r.title,
          status: r.status,
          subject_area: r.subject_area,
        })),
        _meta: meta(),
      };
    },

    search_definitions(args) {
      const query = args.query as string;
      const defs = getDefinitions(db, query);

      return {
        results_count: defs.length,
        results: defs.map((d) => ({
          term: d.term,
          definition: d.definition,
          regulation_id: d.regulation_id,
          section_id: d.section_id,
        })),
        _meta: meta(),
      };
    },

    get_cross_references(args) {
      const regulationId = args.regulation_id as string;

      // Verify regulation exists
      const reg = getRegulation(db, regulationId);
      if (!reg) {
        return {
          error: 'not_found',
          message: `Regulation "${regulationId}" not found.`,
        };
      }

      const refs = getCrossReferences(db, regulationId);

      // Group by target_type
      const grouped: Record<string, Array<{ target_id: string; target_label: string | null; source_section_id: string }>> = {};
      for (const ref of refs) {
        if (!grouped[ref.target_type]) {
          grouped[ref.target_type] = [];
        }
        grouped[ref.target_type].push({
          target_id: ref.target_id,
          target_label: ref.target_label,
          source_section_id: ref.source_section_id,
        });
      }

      return {
        regulation_id: regulationId,
        total: refs.length,
        by_type: grouped,
        _meta: meta(),
      };
    },

    validate_citation(args) {
      const citation = args.citation as string;

      // Try as regulation ID first
      const reg = getRegulation(db, citation);
      if (reg) {
        return {
          valid: true,
          type: 'regulation',
          id: reg.id,
          title: reg.title,
          status: reg.status,
          _meta: meta(),
        };
      }

      // Try as section ID
      const sec = getSection(db, citation);
      if (sec) {
        return {
          valid: true,
          type: 'section',
          id: sec.id,
          regulation_id: sec.regulation_id,
          title: sec.title,
          _meta: meta(),
        };
      }

      return {
        valid: false,
        citation,
        message: `No regulation or section found for "${citation}".`,
        _meta: meta(),
      };
    },

    list_sources() {
      const lastIngest = getMetadata(db, 'last_ingest');
      const agency = getMetadata(db, 'agency');

      return {
        sources: [
          {
            agency: agency ?? config.agency,
            gazette: config.gazette,
            source_url: config.sourceUrl,
            index_url: config.indexUrl,
            last_ingest: lastIngest ?? null,
            license: config.defaultLicense,
            sfs_basis: config.sfsBasis,
          },
        ],
        _meta: meta(),
      };
    },

    about() {
      const regs = regulationCount(db);
      const secs = sectionCount(db);
      const inForce = regulationCount(db, 'in_force');
      const repealed = regulationCount(db, 'repealed');
      const lastIngest = getMetadata(db, 'last_ingest');

      return {
        server: config.serverName,
        version: config.version,
        description: config.description,
        agency: config.agency,
        gazette: config.gazette,
        jurisdiction: 'SE',
        statistics: {
          regulations: regs,
          sections: secs,
          in_force: inForce,
          repealed,
        },
        last_ingest: lastIngest ?? null,
        source_url: config.sourceUrl,
        _meta: meta(),
      };
    },
  };
}
