// Entidade pura `Clinic` (entities.md, schema.md §3) e regras simples (BR-CLN-01/02/03). Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export type ClinicType = "PARTNER" | "PRIVATE";
export type ClinicStatus = "ACTIVE" | "ARCHIVED";

export interface Clinic {
  id: string;
  type: ClinicType;
  /** Obrigatório se `type === "PRIVATE"`; ausente se `type === "PARTNER"` (schema.md CHECK). */
  familyId?: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  status: ClinicStatus;
  createdBy?: string;
  createdAt: Date;
}

/** BR-FAM-07/B4 (endpoints.md createPrivateClinic): máx. 10 clínicas privadas por família. */
export const MAX_PRIVATE_CLINICS_PER_FAMILY = 10;

/** Nome obrigatório, sem espaços nas pontas, nunca vazio (mesmo critério de `health-records`). */
export function assertValidClinicName(name: string, field = "name"): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError([{ field, message: "não pode ser vazio" }], { detail: "Nome inválido." });
  }
  return trimmed;
}
