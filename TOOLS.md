# Tool Reference

All five MCP servers in this fleet expose the same 9 tools. The tools are identical in interface — the difference is the underlying regulation database (AFS, BFS, MSBFS, FoHMFS, or SSMFS).

---

## search_regulations

Full-text search across regulations. Returns matching sections with snippets and citations.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Search query in Swedish or English. |
| `status` | string | no | Filter by regulation status: `in_force` or `repealed`. |
| `subject_area` | string | no | Filter by subject area. |
| `limit` | number | no | Max results to return. Default 20, max 100. |

**Returns:** `{ results_count, results: [{ section_id, regulation_id, regulation_title, section_type, number, title, snippet, _citation }], _meta }`

**Example:**
```json
{ "query": "asbest", "limit": 5 }
```

---

## get_regulation

Retrieve a single regulation by ID, including its table of contents.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `regulation_id` | string | yes | Regulation ID, e.g. `"AFS-2006-1"`. |

**Returns:** The regulation record with `table_of_contents` (list of section stubs), `_citation`, and `_meta`. Returns `{ error: "not_found" }` if the ID does not exist.

**Example:**
```json
{ "regulation_id": "AFS-2006-1" }
```

---

## get_section

Retrieve a specific section (paragraph, chapter, appendix) by its full ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `section_id` | string | yes | Section ID, e.g. `"AFS-2006-1/kap-3/p-7"`. |

**Returns:** `{ id, regulation_id, section_type, number, title, body, parent_id, sort_order, _citation, _meta }`. Returns `{ error: "not_found" }` if the ID does not exist.

**Example:**
```json
{ "section_id": "AFS-2006-1/kap-3/p-7" }
```

---

## list_regulations

List regulations with optional filtering. Paginated at 100 items per page.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `status` | string | no | Filter by status: `in_force` or `repealed`. |
| `subject_area` | string | no | Filter by subject area. |
| `page` | number | no | Page number (1-based). Default 1. |

**Returns:** `{ page, total, results: [{ id, number, title, status, subject_area }], _meta }`

**Example:**
```json
{ "status": "in_force", "page": 1 }
```

---

## search_definitions

Search for defined terms across all regulations.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Search term to match against definitions. |

**Returns:** `{ results_count, results: [{ term, definition, regulation_id, section_id }], _meta }`

**Example:**
```json
{ "query": "kemisk risk" }
```

---

## get_cross_references

Get all cross-references from a regulation to SFS laws, EU directives, and SIS standards.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `regulation_id` | string | yes | Regulation ID, e.g. `"AFS-2006-1"`. |

**Returns:** `{ regulation_id, total, by_type: { sfs: [...], eu: [...], sis: [...] }, _meta }`. Each reference includes `target_id`, `target_label`, and `source_section_id`. Returns `{ error: "not_found" }` if the regulation does not exist.

**Example:**
```json
{ "regulation_id": "BFS-2011-6" }
```

---

## validate_citation

Check whether a citation refers to a valid regulation or section in the database.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `citation` | string | yes | Citation to validate. Can be a regulation ID (e.g. `"AFS-2006-1"`) or section ID (e.g. `"AFS-2006-1/kap-3/p-7"`). |

**Returns:** `{ valid: true, type, id, title, ... }` if found, or `{ valid: false, citation, message }` if not.

**Example:**
```json
{ "citation": "AFS-2006-1/kap-3/p-7" }
```

---

## list_sources

List data sources, including the agency, source URL, and last ingest timestamp.

**Parameters:** None.

**Returns:** `{ sources: [{ agency, gazette, source_url, index_url, last_ingest, license, sfs_basis }], _meta }`

**Example:**
```json
{}
```

---

## about

Return server information, database statistics, and a legal disclaimer.

**Parameters:** None.

**Returns:** `{ server, version, description, agency, gazette, jurisdiction, statistics: { regulations, sections, in_force, repealed }, last_ingest, source_url, _meta }`

**Example:**
```json
{}
```
