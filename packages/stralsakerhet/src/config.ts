import type { AgencyConfig } from '@ansvar/swe-fleet-core';

export const CONFIG: AgencyConfig = {
  agency: 'SSM',
  gazette: 'SSMFS',
  serverName: 'swedish-radiation-protection-mcp',
  packageName: '@ansvar/swedish-radiation-protection-mcp',
  version: '0.1.0',
  description:
    'Swedish radiation protection and nuclear safety regulations from Stralsakerhetsmyndigheten (SSMFS). ' +
    'Covers radiation protection, nuclear facility safety, medical radiation equipment, radioactive waste.',
  indexUrl:
    'https://www.stralsakerhetsmyndigheten.se/publikationer/foreskrifter/',
  sourceUrl: 'https://www.stralsakerhetsmyndigheten.se/',
  defaultLicense: 'psi_oppen_data',
  sfsBasis: 'SFS 2018:1174',
};
