import type { AgencyConfig } from '@ansvar/swe-fleet-core';

export const CONFIG: AgencyConfig = {
  agency: 'FoHM',
  gazette: 'FoHMFS',
  serverName: 'swedish-public-health-mcp',
  packageName: '@ansvar/swedish-public-health-mcp',
  version: '0.1.0',
  description:
    'Swedish public health regulations from Folkhalsomyndigheten (FoHMFS). ' +
    'Covers indoor air quality, drinking water, noise limits, hygiene in public spaces, infection control.',
  indexUrl:
    'https://www.folkhalsomyndigheten.se/publikationer-och-material/foreskrifter-och-allmanna-rad/foreskrifter-i-nummerordning/',
  sourceUrl: 'https://www.folkhalsomyndigheten.se/',
  defaultLicense: 'psi_oppen_data',
  sfsBasis: 'SFS 2010:1011',
};
