// Entidade pura `Appointment` (entities.md, categoria C5) e regras simples (BR-APT-01/02,
// state-machines.md "Appointment", ST4). Sem I/O.
import { DomainError, ValidationError } from "../../../platform/errors/index.js";

export type AppointmentStatus = "SCHEDULED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";

export interface Appointment {
  id: string;
  familyId: string;
  memberId: string;
  scheduledAt: Date;
  status: AppointmentStatus;
  professionalName?: string;
  clinicId?: string;
  clinicName?: string;
  reason?: string;
  notes?: string;
  outcomeRequestedAt?: Date;
  createdAt: Date;
}

const ALLOWED_APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ["COMPLETED", "NO_SHOW", "CANCELLED"],
  CANCELLED: ["SCHEDULED"],
  // ST4: correção entre os dois desfechos, nos dois sentidos.
  COMPLETED: ["NO_SHOW"],
  NO_SHOW: ["COMPLETED"],
};

/** state-machines.md "Appointment"/ST4: transições permitidas; idêntico ao atual é sempre idempotente. */
export function assertValidAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_APPOINTMENT_TRANSITIONS[from].includes(to)) {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado da consulta não permitida." });
  }
}

/** UC-APT-01 alternativo: só SCHEDULED ou COMPLETED são estados de criação válidos (AppointmentInput). */
export function assertValidCreationStatus(status: AppointmentStatus): void {
  if (status !== "SCHEDULED" && status !== "COMPLETED") {
    throw new ValidationError([{ field: "status", message: "só SCHEDULED ou COMPLETED" }], { detail: "Estado inicial inválido." });
  }
}
