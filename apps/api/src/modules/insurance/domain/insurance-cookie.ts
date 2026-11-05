// Leitura do cookie `insurance_refresh_token` (openapi insuranceLogin: independente dos cookies de
// User/ClinicAccount, ADR-021). Parsing manual, sem `cookie-parser`.
export function parseInsuranceCookieHeader(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) {
    return result;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key.length > 0) {
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = value;
      }
    }
  }
  return result;
}

export const INSURANCE_REFRESH_TOKEN_COOKIE = "insurance_refresh_token";
