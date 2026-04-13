import type { AgencyConfig } from '@ansvar/swe-fleet-core';

export const CONFIG: AgencyConfig = {
  agency: 'MCF',
  gazette: 'MSBFS',
  serverName: 'swedish-emergency-preparedness-mcp',
  packageName: '@ansvar/swedish-emergency-preparedness-mcp',
  version: '0.1.0',
  description:
    'Swedish emergency preparedness and civil protection regulations from MCF/MSB (MSBFS/MCFFS). ' +
    'Covers fire protection, hazardous materials transport (ADR), IT security for critical infrastructure. ' +
    'MSB was rebranded to MCF (Myndigheten for civilt forsvar) in 2026.',
  indexUrl:
    'https://www.mcf.se/sv/regler/gallande-regler/',
  sourceUrl: 'https://www.mcf.se/',
  defaultLicense: 'psi_oppen_data',
  sfsBasis: 'SFS 2003:778',
};

/**
 * Additional gazette series used by MCF (post-rebrand).
 * Older regulations keep their MSBFS designation;
 * new regulations from 2026+ use MCFFS.
 */
export const GAZETTE_SERIES = ['MSBFS', 'MCFFS'] as const;
