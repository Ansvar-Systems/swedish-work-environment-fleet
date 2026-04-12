import type { AgencyConfig } from '@ansvar/swe-fleet-core';

export const CONFIG: AgencyConfig = {
  agency: 'AV',
  gazette: 'AFS',
  serverName: 'swedish-work-environment-mcp',
  packageName: '@ansvar/swedish-work-environment-mcp',
  version: '0.1.0',
  description:
    'Swedish work environment regulations from Arbetsmiljoverket (AV). ' +
    'Covers occupational safety, asbestos, chemical hazards, machinery, ergonomics, construction safety.',
  indexUrl:
    'https://www.av.se/arbetsmiljoarbete-och-inspektioner/publikationer/foreskrifter/',
  sourceUrl: 'https://www.av.se/',
  defaultLicense: 'psi_oppen_data',
  sfsBasis: 'SFS 1977:1160',
};
