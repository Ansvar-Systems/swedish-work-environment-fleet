# Swedish Work Environment Fleet

Five MCP (Model Context Protocol) servers providing structured access to Swedish agency regulations governing the work environment, building safety, emergency preparedness, public health, and radiation protection.

## Agencies

| Package | Agency | Gazette | Description |
|---------|--------|---------|-------------|
| `arbetsmiljo` | Arbetsmiljoverket (AV) | AFS | Occupational safety and health: chemical hazards, asbestos, machinery, ergonomics, construction sites, ventilation |
| `boverket` | Boverket | BFS | Building codes (BBR), construction products, planning and building permits, accessibility, energy performance |
| `msb` | Myndigheten for samhallsskydd och beredskap (MSB) | MSBFS | Fire protection, hazardous materials transport, IT security for essential services, civil protection |
| `folkhalsomyndigheten` | Folkhalsomyndigheten (FoHM) | FoHMFS | Indoor air quality, drinking water, noise limits, hygiene, infection control, environmental health |
| `stralsakerhet` | Stralsakerhetsmyndigheten (SSM) | SSMFS | Radiation protection, nuclear facility safety, medical radiation, radioactive waste, transport of radioactive materials |

## Usage

### npm (stdio transport)

```bash
npm install @ansvar/swedish-work-environment-mcp
```

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "swedish-work-environment": {
      "command": "npx",
      "args": ["@ansvar/swedish-work-environment-mcp"]
    }
  }
}
```

### Docker (HTTP transport)

```bash
docker pull ghcr.io/ansvar-systems/swedish-work-environment-mcp:latest
docker run -p 3000:3000 ghcr.io/ansvar-systems/swedish-work-environment-mcp:latest
```

Each agency has its own image. Replace `swedish-work-environment-mcp` with:
- `swedish-building-code-mcp` (Boverket)
- `swedish-emergency-preparedness-mcp` (MSB)
- `swedish-public-health-mcp` (FoHM)
- `swedish-radiation-protection-mcp` (SSM)

## Tools

All five servers expose the same 9 tools:

- `search_regulations` -- Full-text search across regulations
- `get_regulation` -- Retrieve a regulation by ID
- `get_section` -- Retrieve a specific section by ID
- `list_regulations` -- List regulations with filtering and pagination
- `search_definitions` -- Search defined terms across regulations
- `get_cross_references` -- Get cross-references to SFS laws, EU directives, SIS standards
- `validate_citation` -- Check if a citation refers to a valid regulation or section
- `list_sources` -- List data sources and provenance
- `about` -- Server metadata and database statistics

See [TOOLS.md](TOOLS.md) for full parameter and response schemas.

## Data Sources

All data is sourced from official Swedish government publications under PSI / open data re-use rules. See [sources.yml](sources.yml) for per-agency details including URLs, licenses, and refresh schedules.

## Development

### Prerequisites

- Node.js >= 20
- npm 10+

### Setup

```bash
git clone https://github.com/Ansvar-Systems/swedish-work-environment-fleet.git
cd swedish-work-environment-fleet
npm install
npm run build
```

### Run tests

```bash
npm test
```

### Run ingestion (populate databases)

```bash
npm run build -w packages/core
npx -w packages/arbetsmiljo tsx src/ingest.ts --force
```

Replace `arbetsmiljo` with any package name. Database files (`*.db`) are gitignored and must be generated via ingestion.

### Start a server locally

```bash
npm run serve -w packages/arbetsmiljo
```

## Architecture

This is an npm workspaces monorepo:

```
packages/
  core/          Shared library: database schema, 9 tool implementations, FTS5 search, HTTP server
  arbetsmiljo/   AV ingestion + config
  boverket/      Boverket ingestion + config
  msb/           MSB ingestion + config
  folkhalsomyndigheten/  FoHM ingestion + config
  stralsakerhet/ SSM ingestion + config (PDF extraction)
```

Each agency package provides an ingestion script that fetches regulations from official sources, parses them, and writes a SQLite database. The shared core provides the MCP tool definitions, FTS5 search index, HTTP server, and citation formatting.

## CI/CD

- **CI:** Lint, typecheck, and test on every push
- **GHCR build:** On push to `main`, builds 5 Docker images with fresh ingestion data and pushes to GHCR
- **npm publish:** Publishes all 5 packages to npm on tagged releases
- **Freshness monitoring:** Daily check for data staleness, auto-creates GitHub issues
- **Security scanning:** CodeQL, Semgrep, Trivy, Gitleaks, OpenSSF Scorecard, Dependabot

## License

[Business Source License 1.1](LICENSE)
