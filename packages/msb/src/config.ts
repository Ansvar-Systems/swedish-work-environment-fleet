import type { AgencyConfig } from '@ansvar/swe-fleet-core';

export const CONFIG: AgencyConfig = {
  agency: 'MSB',
  gazette: 'MSBFS',
  serverName: 'swedish-emergency-preparedness-mcp',
  packageName: '@ansvar/swedish-emergency-preparedness-mcp',
  version: '0.1.0',
  description:
    'Swedish emergency preparedness and civil protection regulations from MSB (MSBFS). ' +
    'Covers fire protection, hazardous materials transport (ADR), IT security for critical infrastructure.',
  indexUrl:
    'https://www.msb.se/sv/regler/forfattningar/',
  sourceUrl: 'https://www.msb.se/',
  defaultLicense: 'psi_oppen_data',
  sfsBasis: 'SFS 2003:778',
};
