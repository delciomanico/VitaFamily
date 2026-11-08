// Visita presencial manual (BR-CLN-18, state-machines.md `ClinicVisit`). Só da clínica; sem receita. Sem I/O.
import { ConflictError, ValidationError } from "../../../platform/errors/index.js";

export type ClinicVisitStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";

export interface ClinicVisit {
  id: string;
  clinicId: string;
  clinicPatientId: string;
  slotId?: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: ClinicVisitStatus;
  notes?: string;
  outcomeNote?: string;
  cancelNote?: string;
  bookedByClinicAccountId?: string;
  createdAt: Date;
}

export const VISIT_NOTE_MAX = 2000;

const TRANSITIONS: Record<ClinicVisitStatus, ClinicVisitStatus[]> = {
  SCHEDULED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertValidVisitTransition(from: ClinicVisitStatus, to: ClinicVisitStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConflictError({ detail: "Transição de estado inválida para a visita." });
  }
}

/** Cancelar: só visitas `SCHEDULED` e futuras, com motivo obrigatório (mesma regra da consulta, UC-CLN-06). */
export function assertCanCancelVisit(visit: Pick<ClinicVisit, "status" | "scheduledAt">, now: Date): void {
  if (visit.status !== "SCHEDULED" || visit.scheduledAt.getTime() <= now.getTime()) {
    throw new ConflictError({ detail: "Só visitas agendadas e futuras podem ser canceladas." });
  }
  assertValidVisitTransition(visit.status, "CANCELLED");
}

/** Completar: só a visita em curso (`SCHEDULED`, ST4); só `outcomeNote` (sem receita, BR-CLN-06). */
export function assertCanCompleteVisit(visit: Pick<ClinicVisit, "status">): void {
  if (visit.status !== "SCHEDULED") {
    throw new ConflictError({ detail: "Só a visita em curso (SCHEDULED) pode ser completada." });
  }
  assertValidVisitTransition(visit.status, "COMPLETED");
}

export function assertNoPrescription(prescription: unknown): void {
  if (prescription !== undefined && prescription !== null) {
    throw new ValidationError([{ field: "prescription", message: "não aplicável a uma visita presencial manual" }], { detail: "Visitas manuais não têm receita." });
  }
}

export function normalizeVisitNote(raw: string | null | undefined, field: string): string | null {
  const text = raw?.trim();
  if (!text) return null;
  if (text.length > VISIT_NOTE_MAX) {
    throw new ValidationError([{ field, message: `máximo ${String(VISIT_NOTE_MAX)} caracteres` }], { detail: "Texto demasiado longo." });
  }
  return text;
}

/** Intervalos semiabertos `[a, a+dur)`: fim de um = início do outro NÃO sobrepõe (BR-CLN-16). */
export function visitEndsAt(visit: Pick<ClinicVisit, "scheduledAt" | "durationMinutes">): Date {
  return new Date(visit.scheduledAt.getTime() + visit.durationMinutes * 60_000);
}
