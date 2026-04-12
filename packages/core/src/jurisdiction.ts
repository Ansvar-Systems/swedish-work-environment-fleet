/** Successful jurisdiction validation result. */
export interface JurisdictionOk {
  ok: true;
  jurisdiction: 'SE';
}

/** Failed jurisdiction validation result. */
export interface JurisdictionError {
  ok: false;
  error: string;
}

export type JurisdictionResult = JurisdictionOk | JurisdictionError;

/**
 * Validate that the requested jurisdiction is Sweden.
 *
 * Defaults to 'SE' when no input is provided. Returns an error object
 * for any non-SE value — the fleet only covers Swedish regulations.
 */
export function validateJurisdiction(
  input?: string,
): JurisdictionResult {
  if (!input || input.toUpperCase() === 'SE') {
    return { ok: true, jurisdiction: 'SE' };
  }

  return {
    ok: false,
    error: `This server covers Swedish regulations only (jurisdiction SE). Received: "${input}".`,
  };
}
