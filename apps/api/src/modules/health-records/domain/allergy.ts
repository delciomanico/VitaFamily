// Entidade pura `Allergy` (entities.md: categoria C2, FR-HP-01/02) — nome, notas, data relevante;
// "sem catálogos" (D8): campos simples de texto livre, sem lista fechada de alergias conhecidas.
import { ValidationError } from "../../../platform/errors/index.js";

export interface Allergy {
  id: string;
  familyId: string;
  memberId: string;
  name: string;
  notes?: string;
  since?: string;
  createdAt: Date;
}

/** FR-HP-02/R6: nome obrigatório, sem espaços nas pontas, nunca vazio. */
export function assertValidRecordName(name: string, field = "name"): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError([{ field, message: "não pode ser vazio" }], { detail: "Nome inválido." });
  }
  return trimmed;
}
