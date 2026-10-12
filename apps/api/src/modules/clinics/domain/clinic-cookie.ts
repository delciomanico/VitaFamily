// Leitura do cookie `clinic_refresh_token` (endpoints.md: "independente do cookie refresh_token de
// User", ADR-020). Duplicado de `auth/domain/cookie.ts` — parsing manual, sem `cookie-parser`.
export function parseClinicCookieHeader(header: string | undefined): Record<string, string> {
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

export const CLINIC_REFRESH_TOKEN_COOKIE = "clinic_refresh_token";
