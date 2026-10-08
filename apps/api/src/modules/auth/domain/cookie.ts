// Leitura do cookie `refresh_token` (authentication.md §1). Parsing manual simples (sem
// `cookie-parser`, que exigiria registar middleware extra na composição) — só a chave que
// interessa a este módulo.
export function parseCookieHeader(header: string | undefined): Record<string, string> {
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

export const REFRESH_TOKEN_COOKIE = "refresh_token";
