// `displayName` mínimo (ADR-024/BR-CLN-10): primeiro nome + inicial do último apelido, ex. "Maria S.".
// Duplicado deliberadamente de `appointments/domain/walk-in.ts` (nenhuma aresta nova no grafo de módulos).
export function buildPatientDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) {
    return "";
  }
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = last ? Array.from(last)[0] : undefined;
  return initial ? `${first} ${initial.toLocaleUpperCase("pt-PT")}.` : first;
}
