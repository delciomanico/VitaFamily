// Entidade pura `MedicalCondition` (entities.md: categoria C3, FR-HP-01/02) — condição atual ou
// histórico médico (`kind`); mesmo critério "sem catálogos" (D8) de `allergy.ts`.
import { ValidationError } from "../../../platform/errors/index.js";

export type ConditionKind = "CONDITION" | "HISTORY";

export interface MedicalCondition {
  id: string;
  familyId: string;
  memberId: string;
  name: string;
  kind: ConditionKind;
  notes?: string;
  since?: string;
  until?: string;
  createdAt: Date;
}

/**
 * schema.md §3 (`medical_conditions` CHECK `until >= since`): comparação lexicográfica de datas
 * ISO (`YYYY-MM-DD`) é válida sem construir `Date` — puro, sem fuso a considerar. `NULL` em
 * qualquer um dos lados nunca viola a regra (mesma lógica a três valores do CHECK em SQL).
 */
export function assertValidConditionDates(since: string | undefined, until: string | undefined, field = "until"): void {
  if (since && until && until < since) {
    throw new ValidationError([{ field, message: "tem de ser posterior ou igual a since" }], {
      detail: "Datas da condição inválidas.",
    });
  }
}
