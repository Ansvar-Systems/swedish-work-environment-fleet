import type { AgencyConfig } from '@ansvar/swe-fleet-core';

export const CONFIG: AgencyConfig = {
  agency: 'Boverket',
  gazette: 'BFS',
  serverName: 'swedish-building-code-mcp',
  packageName: '@ansvar/swedish-building-code-mcp',
  version: '0.1.0',
  description:
    'Swedish building codes and construction regulations from Boverket (BFS/BBR). ' +
    'Covers building codes, accessibility, energy performance, construction products, planning regulations.',
  indexUrl:
    'https://www.boverket.se/sv/lag--ratt/forfattningssamling/',
  sourceUrl: 'https://www.boverket.se/',
  defaultLicense: 'psi_oppen_data',
  sfsBasis: 'SFS 2010:900',
};
