# Coverage Summary

Fleet-level overview of the Swedish Work Environment MCP fleet. Five MCP servers, one per agency, covering Swedish workplace safety, building codes, emergency preparedness, public health, and radiation protection regulations.

## Fleet Composition

| Package | Agency | Gazette | Estimated Regulations | Estimated Sections |
|---------|--------|---------|----------------------:|-------------------:|
| arbetsmiljo | Arbetsmiljoverket (AV) | AFS | ~100 | ~4,500 |
| boverket | Boverket | BFS | ~50 | ~2,500 |
| msb | MSB | MSBFS | ~40 | ~1,500 |
| folkhalsomyndigheten | FoHM | FoHMFS | ~30 | ~1,200 |
| stralsakerhet | SSM | SSMFS | ~25 | ~900 |
| **Total** | **5 agencies** | **5 gazette series** | **~245** | **~10,600** |

Exact counts depend on ingestion results. Run `npm run ingest` for each package to get precise numbers written to `data/census.json`.

## Known Gaps

**SIS copyrighted content excluded.** Several Boverket (BFS) and SSM (SSMFS) regulations reference standards published by the Swedish Institute for Standards (SIS). These standards are not available under open data licenses. The database stores `reference_only` stubs with the standard number and title, but the full text is not included. Affected regulations link to SIS via cross-references.

**Non-binding guidance excluded.** Agency guidance documents, handbooks, and advisory publications are not ingested. Only legally binding regulations (foreskrifter) published in each agency's gazette series are included.

**Historical versions excluded.** Only the current consolidated version of each regulation is stored. Previous versions and amendment history are not tracked. The `amends` and `amended_by` fields record relationships between regulations but do not contain historical text.

## Data Refresh

All five packages run monthly ingestion on the 1st of each month at 03:00 UTC via the `ingest.yml` GitHub Actions workflow. Each ingest cycle compares SHA-256 hashes of fetched pages against the previous run. Unchanged regulations are skipped unless `--force` is specified.

Freshness is monitored daily via `check-freshness.yml`. Any package with data older than 45 days triggers a workflow failure.
