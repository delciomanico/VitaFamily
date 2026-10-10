// Entidade pura `Prescription` (entities.md, categoria C4) e regras simples (BR-RX-01, ST1). Sem I/O.
import { DomainError, ValidationError } from "../../../platform/errors/index.js";

export type PrescriptionStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export interface Prescription {
  id: string;
  familyId: string;
  memberId: string;
  issuedOn: string; // date (YYYY-MM-DD)
  doctorName?: string;
  notes?: string;
  status: PrescriptionStatus;
  createdAt: Date;
}

/** BR-RX-01: data de emissão obrigatória e não futura. */
export function assertValidIssuedOn(issuedOn: string, now: Date): void {
  const date = new Date(`${issuedOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field: "issuedOn", message: "data inválida" }], { detail: "Data de emissão inválida." });
  }
  if (date.getTime() > now.getTime()) {
    throw new ValidationError([{ field: "issuedOn", message: "não pode ser futura" }], { detail: "Data de emissão não pode ser futura." });
  }
}

/** BR-RX-01: pelo menos 1 medicamento. */
export function assertHasMedications(count: number): void {
  if (count < 1) {
    throw new ValidationError([{ field: "medications", message: "indique pelo menos um medicamento" }], {
      detail: "Uma receita precisa de pelo menos um medicamento.",
    });
  }
}

const ALLOWED_PRESCRIPTION_TRANSITIONS: Record<PrescriptionStatus, PrescriptionStatus[]> = {
  ACTIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["ACTIVE"],
  CANCELLED: ["ACTIVE"],
};

/** ST1: sem estados finais absolutos — reabrir corrige um engano, nunca recria o passado (ver `medications`). */
export function assertValidPrescriptionTransition(from: PrescriptionStatus, to: PrescriptionStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_PRESCRIPTION_TRANSITIONS[from].includes(to)) {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado da receita não permitida." });
  }
}
