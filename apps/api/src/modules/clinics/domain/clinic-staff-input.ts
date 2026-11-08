// Validação pura da criação de contas da equipa (BR-CLN-05/39, UC-CLN-30): o Admin cria Gestores (receção, omissão) ou
// Médicos (ligados a um profissional). Nunca `CLINIC_ADMIN` (só o Platform Admin cria a raiz). Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export type StaffRole = "CLINIC_MANAGER" | "CLINIC_DOCTOR";

export interface StaffInput {
  email: string;
  role: StaffRole;
  professionalId?: string;
}

export function parseStaffInput(input: { email: unknown; role?: unknown; professionalId?: unknown }): StaffInput {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (email.length === 0) {
    throw new ValidationError([{ field: "email", message: "obrigatório" }], { detail: "E-mail inválido." });
  }
  const role = input.role ?? "CLINIC_MANAGER";
  if (role !== "CLINIC_MANAGER" && role !== "CLINIC_DOCTOR") {
    throw new ValidationError([{ field: "role", message: "CLINIC_MANAGER ou CLINIC_DOCTOR" }], { detail: "Papel inválido." });
  }
  const professionalId = input.professionalId;
  if (professionalId !== undefined && professionalId !== null && typeof professionalId !== "string") {
    throw new ValidationError([{ field: "professionalId", message: "identificador inválido" }], { detail: "Profissional inválido." });
  }
  if (role === "CLINIC_DOCTOR" && !professionalId) {
    throw new ValidationError([{ field: "professionalId", message: "obrigatório para o Médico" }], { detail: "O Médico tem de estar ligado a um profissional." });
  }
  if (role === "CLINIC_MANAGER" && professionalId) {
    throw new ValidationError([{ field: "professionalId", message: "não se aplica ao Gestor" }], { detail: "O Gestor não leva profissional." });
  }
  return { email, role, ...(professionalId ? { professionalId } : {}) };
}
